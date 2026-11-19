// Classement des agents dans le routeur : l'ordre suit le classement (places 1 à 10, l'agent local d'Odin toujours
// dedans), bascule sur l'agent suivant quand le premier se tait (pas de premier mot, pas de réponse complète) ou refuse
// (quota, erreur), sans jamais rejouer une action ; chaque appel noté avec la place de l'agent.
// Faux agents seulement : aucun appel à un vrai service, horloge injectée (aucune vraie attente de 30 s).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from '../src/providers/http.ts';
import { withRouteContext, type RouteContext, type RouteEntry } from '../src/providers/journal.ts';
import * as R from '../src/providers/router.ts';
import { fournisseurSansModele } from '../src/brain/porte-modele.ts';
import { odinPaths, type OdinConfig } from '../src/config.ts';
import type { CompletionRequest, ModelResponse, Provider } from '../src/types.ts';

const req = { system: 's', messages: [{ role: 'user' as const, content: 'x' }], tools: [], maxTokens: 10 };
const okResp = (text: string, extra: Partial<ModelResponse> = {}): ModelResponse => ({ text, toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end', ...extra });
const laisser = () => new Promise((r) => setImmediate(r));

/** Faux agent : compte ses appels, garde la dernière demande reçue. */
function agent(name: string, fn: (r: CompletionRequest) => Promise<ModelResponse>): Provider & { appels: CompletionRequest[] } {
  const appels: CompletionRequest[] = [];
  return { name, appels, complete: (r) => { appels.push(r); return fn(r); } };
}
/** Agent muet : ne dit jamais rien ; il s'arrête seulement quand on l'interrompt. */
const muet = (name: string) => agent(name, (r) => new Promise((_, rej) => { r.signal?.addEventListener('abort', () => rej(new Error('aborted'))); }));
const route = (p: Provider, cfg: Partial<R.Route['cfg']> = {}): R.Route => ({ provider: p, cfg: { kind: 'openai', model: p.name.split(':')[1] ?? p.name, ...cfg } });

/** Horloge d'essai : le temps n'avance que quand l'essai le dit. */
function horloge() {
  let t = 0, n = 0;
  const minuteurs = new Map<number, { a: number; fn: () => void }>();
  return {
    now: () => t,
    minuteur: { poser: (fn: () => void, ms: number) => { const id = ++n; minuteurs.set(id, { a: t + ms, fn }); return id; }, retirer: (id: unknown) => { minuteurs.delete(id as number); } },
    avancer(ms: number) {
      const fin = t + ms;
      for (;;) {
        const dus = [...minuteurs.entries()].filter(([, m]) => m.a <= fin).sort((x, y) => x[1].a - y[1].a);
        if (!dus.length) break;
        const [id, m] = dus[0]; minuteurs.delete(id); t = m.a; m.fn();
      }
      t = fin;
    },
  };
}

function routeur(routes: R.Route[], classement: string[] | undefined, h = horloge()) {
  const r = new R.Router(routes, 2, async () => undefined, { now: h.now, minuteur: h.minuteur, classement } as never);
  const journal: RouteEntry[] = [];
  r.onRoute = (e) => journal.push(e);
  return { r, h, journal };
}

test('le classement garde l\'agent local d\'Odin, 10 places au plus, sans doublon', () => {
  assert.equal(typeof R.normaliserClassement, 'function');
  const L = R.AGENT_LOCAL;
  assert.equal(R.normaliserClassement(undefined), undefined);
  assert.equal(R.normaliserClassement('anthropic:a'), undefined);
  assert.deepEqual(R.normaliserClassement(['anthropic:a', 'kimi:k']), ['anthropic:a', 'kimi:k', L]);
  assert.deepEqual(R.normaliserClassement([]), [L]);
  assert.deepEqual(R.normaliserClassement([L, 'a', ' a ', '', 'b', 3]), [L, 'a', 'b']);
  const onze = Array.from({ length: 11 }, (_, i) => `s:m${i}`);
  const c = R.normaliserClassement(onze)!;
  assert.equal(c.length, 10); assert.equal(c[9], L); assert.equal(c[8], 's:m8');
  assert.deepEqual(R.normaliserClassement([...onze.slice(0, 3), L, ...onze.slice(3)]), [...onze.slice(0, 3), L, ...onze.slice(3, 9)]);
});

test('sans classement écrit : l\'ordre automatique d\'aujourd\'hui est gardé à l\'identique', () => {
  const routes = [route(agent('anthropic:claude-opus', async () => okResp('a')), { kind: 'anthropic' }), route(agent('deepseek:flash', async () => okResp('b')))];
  const avant = new R.Router(routes).order().map((x) => x.provider.name);
  const { r } = routeur(routes, undefined);
  assert.deepEqual(r.order().map((x) => x.provider.name), avant);
  assert.equal((r as unknown as { classement?: string[] }).classement, undefined);
});

test('classement : l\'ordre suit les places, pas le palier ni le prix ; un agent non classé ne reçoit rien', () => {
  const routes = [
    route(agent('anthropic:claude-opus', async () => okResp('a')), { kind: 'anthropic', tier: 'strong' }),
    route(agent('deepseek:flash', async () => okResp('b')), { priceInPerM: 0.1, priceOutPerM: 0.1 }),
    route(agent('kimi:k2', async () => okResp('c'))),
  ];
  const { r } = routeur(routes, ['kimi:k2', 'anthropic:claude-opus']);
  assert.deepEqual(r.order({ minTier: 'strong', cheapest: true }).map((x) => x.provider.name), ['kimi:k2', 'anthropic:claude-opus']);
  // La case « pas de données personnelles » écarte toujours l'agent pour une tâche privée.
  const { r: r2 } = routeur([routes[0], route(routes[2].provider, { personal: false })], ['kimi:k2', 'anthropic:claude-opus']);
  assert.deepEqual(r2.order({ need: 'maison' }).map((x) => x.provider.name), ['anthropic:claude-opus']);
});

test('Router.fromConfig : seuls les agents classés sont montés, dans l\'ordre du classement', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'odin-classement-'));
  const env = ['ESSAI_CLE_A', 'ESSAI_CLE_D', 'ESSAI_CLE_K'];
  for (const k of env) process.env[k] = 'k';
  try {
    const cfg = {
      providers: [
        { kind: 'anthropic', model: 'claude-x', apiKeyEnv: 'ESSAI_CLE_A' },
        { kind: 'openai', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'ESSAI_CLE_D' },
        { kind: 'openai', model: 'kimi-k2', baseUrl: 'https://api.moonshot.ai/v1', apiKeyEnv: 'ESSAI_CLE_K' },
      ],
      routing: { quotaPauseMin: 15 },
    } as unknown as OdinConfig;
    const sans = R.Router.fromConfig(cfg, [], odinPaths(tmp));
    assert.equal(sans.routes.length, 3);
    const avec = R.Router.fromConfig({ ...cfg, routing: { ...cfg.routing, classement: ['deepseek:deepseek-flash', 'anthropic:claude-x'] } } as OdinConfig, [], odinPaths(tmp));
    assert.deepEqual(avec.order().map((x) => x.provider.name), ['deepseek:deepseek-flash', 'anthropic:claude-x']);
    assert.deepEqual((avec as unknown as { classement: string[] }).classement, ['deepseek:deepseek-flash', 'anthropic:claude-x', R.AGENT_LOCAL]);
    // Classement qui ne nomme aucun agent connecté : rien ne part, la place vide de l'agent local prend le relais (runtime).
    assert.throws(() => R.Router.fromConfig({ ...cfg, routing: { ...cfg.routing, classement: [R.AGENT_LOCAL] } } as OdinConfig, [], odinPaths(tmp)), /Aucun fournisseur/);
  } finally { for (const k of env) delete process.env[k]; rmSync(tmp, { recursive: true, force: true }); }
});

test('muet 30 s → l\'agent suivant prend le tour ; la place et la raison sont notées, sans le contenu', async () => {
  const a = muet('anthropic:a'), b = agent('deepseek:b', async (r) => { r.onDelta?.('salut'); return okResp('salut'); });
  const { r, h, journal } = routeur([route(a), route(b)], ['anthropic:a', 'deepseek:b']);
  const morceaux: string[] = [];
  const p = r.complete({ ...req, messages: [{ role: 'user', content: 'mon secret 1234' }], onDelta: (t) => morceaux.push(t) });
  await laisser();
  h.avancer(29_999); await laisser();
  assert.equal(b.appels.length, 0, 'avant 30 s, on attend encore');
  h.avancer(1); await laisser();
  const out = await p;
  assert.equal(out.providerName, 'deepseek:b');
  assert.equal(a.appels[0].signal?.aborted, true, 'l\'agent abandonné est interrompu');
  assert.deepEqual(morceaux, ['salut']);
  assert.equal(journal.length, 1);
  const e = journal[0];
  assert.equal(e.provider, 'deepseek:b');
  assert.match(e.reason, /place 2 du classement/);
  assert.match(e.reason, /place 1 .*pas de premier mot en 30 s/);
  const essais = e.attempts as Array<R.RouteAttempt & { place?: number }>;
  assert.equal(essais[0].provider, 'anthropic:a'); assert.equal(essais[0].place, 1); assert.equal(essais[0].ok, false); assert.equal(essais[0].ms, 30_000);
  assert.match(essais[0].error!, /pas de premier mot en 30 s/);
  assert.equal(essais[1].place, 2); assert.equal(essais[1].ok, true);
  assert.ok(!JSON.stringify(e).includes('1234'), 'le contenu du message ne va pas au journal');
  assert.match(out.notice ?? '', /place 2/);
});

test('premier mot dit, mais pas de réponse complète en 3 min → suivant ; délais réglables', async () => {
  const a = agent('anthropic:a', (r) => { r.onDelta?.('Je '); return new Promise((_, rej) => { r.signal?.addEventListener('abort', () => rej(new Error('aborted'))); }); });
  const b = agent('deepseek:b', async () => okResp('fini'));
  const h = horloge();
  const r = new R.Router([route(a), route(b)], 2, async () => undefined, { now: h.now, minuteur: h.minuteur, classement: ['anthropic:a', 'deepseek:b'], delais: { premierMotMs: 5_000, reponseMs: 60_000 } } as never);
  const journal: RouteEntry[] = []; r.onRoute = (e) => journal.push(e);
  const p = r.complete({ ...req, onDelta: () => undefined });
  await laisser();
  h.avancer(59_999); await laisser();
  assert.equal(b.appels.length, 0, 'le premier mot est arrivé : on attend la réponse complète');
  h.avancer(1); await laisser();
  assert.equal((await p).text, 'fini');
  assert.match(journal[0].attempts[0].error!, /pas de réponse complète en 60 s/);
  assert.match(new R.DelaiAgent('reponse', R.DELAI_REPONSE_MS).message, /pas de réponse complète en 3 min/);
});

test('quota épuisé → suivant, place notée ; aucun nouvel essai sur l\'agent à bout de quota', async () => {
  const a = agent('anthropic:a', async () => { throw new HttpError(402, 'credit balance is too low', null); });
  const b = agent('deepseek:b', async () => okResp('ok'));
  const { r, journal } = routeur([route(a), route(b)], ['anthropic:a', 'deepseek:b']);
  const out = await r.complete(req);
  assert.equal(out.providerName, 'deepseek:b');
  assert.equal(a.appels.length, 1);
  assert.match(journal[0].reason, /place 2 du classement/);
  assert.match(journal[0].reason, /place 1 .*quota/);
  assert.ok(r.pausedNow().some((x) => x.name === 'anthropic:a'));
});

test('bascule sans rejouer : la réponse tardive de l\'agent abandonné (avec une action) n\'est jamais rendue', async () => {
  let repondreTard!: (r: ModelResponse) => void;
  const a = agent('anthropic:a', () => new Promise((res) => { repondreTard = res; }));
  const b = agent('deepseek:b', async () => okResp('par b'));
  const { r, h } = routeur([route(a), route(b)], ['anthropic:a', 'deepseek:b']);
  const vus: string[] = [];
  const p = r.complete({ ...req, tools: [{ name: 'mail_envoyer', description: 'd', inputSchema: { type: 'object' } }], onDelta: (t: string) => vus.push(t) } as never);
  await laisser();
  // Avec des outils, seul le délai de réponse complète joue (un appel d'outil ne donne aucun « mot »).
  h.avancer(R.DELAI_REPONSE_MS); await laisser();
  const out = await p;
  assert.equal(out.text, 'par b'); assert.deepEqual(out.toolCalls, []);
  // L'agent abandonné finit quand même par répondre, avec une action : rien ne sort.
  a.appels[0].onDelta?.('trop tard');
  repondreTard(okResp('', { toolCalls: [{ id: 'x', name: 'mail_envoyer', input: {} }], stopReason: 'tool_use' }));
  await laisser();
  assert.deepEqual(vus, []);
  assert.equal(a.appels.length, 1); assert.equal(b.appels.length, 1);
});

test('un agent qui a déjà agi dans le tour n\'est pas remplacé en cours de route : on s\'arrête et on le dit', async () => {
  let n = 0;
  const a = agent('anthropic:a', async () => { n++; if (n === 1) return okResp('', { toolCalls: [{ id: 'x', name: 'fichier_ecrire', input: {} }], stopReason: 'tool_use' }); throw new HttpError(402, 'credit balance is too low', null); });
  const b = agent('deepseek:b', async () => okResp('par b'));
  const { r, journal } = routeur([route(a), route(b)], ['anthropic:a', 'deepseek:b']);
  const outils = { ...req, tools: [{ name: 'fichier_ecrire', description: 'd', inputSchema: { type: 'object' } }] } as never;
  const ctx: RouteContext = { turnId: 't1', sessionId: 's', channel: 'web', request: '', entries: [] };
  await withRouteContext(ctx, async () => {
    const r1 = await r.complete(outils);
    assert.equal(r1.toolCalls.length, 1);
    await assert.rejects(() => r.complete(outils), /déjà commencé à agir/);
  });
  assert.equal(b.appels.length, 0, 'aucun autre agent ne reprend une action commencée');
  const fin = journal.at(-1)!;
  assert.equal(fin.ok, false); assert.match(fin.reason, /déjà commencé à agir/);
  // Un autre tour repart du classement normal.
  const out = await withRouteContext({ ...ctx, turnId: 't2', entries: [] }, () => r.complete(outils));
  assert.equal(out.providerName, 'deepseek:b');
});

test('l\'agent local d\'Odin tient sa place dans le classement (sans modèle : « pas encore », puis le suivant)', async () => {
  // La route de l'agent local est montée ici à la main : au démarrage, elle n'existe aujourd'hui que quand aucun
  // agent n'est connecté (le routeur seul ne la crée pas).
  const local: R.Route = { provider: fournisseurSansModele('fr'), cfg: { kind: 'mock', model: 'aucun-modele' } };
  const b = agent('deepseek:b', async () => okResp('par b'));
  const { r, journal } = routeur([route(b), local], [R.AGENT_LOCAL, 'deepseek:b']);
  assert.deepEqual(r.order().map((x) => x.provider.name), ['aucun-modele', 'deepseek:b']);
  assert.equal((await r.complete(req)).providerName, 'deepseek:b');
  assert.match(journal[0].reason, /place 2 du classement/);
  // Classement où l'agent local est en tête mais n'a pas de route : l'agent connecté garde sa vraie place (2).
  const { r: r2, journal: j2 } = routeur([route(b)], [R.AGENT_LOCAL, 'deepseek:b']);
  await r2.complete(req);
  assert.match(j2[0].reason, /^place 2 du classement/);
});

test('sans classement : aucun délai ajouté, aucune bascule sur silence (comportement d\'aujourd\'hui)', async () => {
  const a = muet('anthropic:a'), b = agent('deepseek:b', async () => okResp('b'));
  const { r, h } = routeur([route(a), route(b)], undefined);
  const ac = new AbortController();
  const p = r.complete({ ...req, signal: ac.signal, onDelta: () => undefined }).catch((e: Error) => e);
  await laisser();
  h.avancer(10 * 60_000); await laisser();
  assert.equal(b.appels.length, 0);
  ac.abort(); await p;
});

test('un agent qui travaille sans écrire de texte (long appel d\'outil) n\'est pas coupé au « premier mot »', async () => {
  // Les fournisseurs ne disent « un mot » que pour du texte : un appel d'outil en cours d'écriture, ou un raisonnement,
  // ne compte pas. Avec des outils, l'agent n'est donc pas coupé à 30 s ; seul le délai de réponse complète joue.
  const outils = [{ name: 'fichier_ecrire', description: 'd', inputSchema: { type: 'object' } }];
  const enCours: Array<(r: ModelResponse) => void> = [];
  const a = agent('anthropic:a', (r) => new Promise((res, rej) => { enCours.push(res); r.signal?.addEventListener('abort', () => rej(new Error('aborted'))); }));
  const b = agent('deepseek:b', async () => okResp('par b'));
  const { r, h } = routeur([route(a), route(b)], ['anthropic:a', 'deepseek:b']);
  const ctx: RouteContext = { turnId: 't-outil', sessionId: 's', channel: 'web', request: '', entries: [] };
  await withRouteContext(ctx, async () => {
    // Premier pas : 40 s sans texte, puis une action.
    const p1 = r.complete({ ...req, tools: outils, onDelta: () => undefined } as never);
    await laisser(); h.avancer(40_000); await laisser();
    assert.equal(b.appels.length, 0, 'pas de bascule pendant que l\'agent écrit son action');
    enCours[0](okResp('', { toolCalls: [{ id: '1', name: 'fichier_ecrire', input: {} }], stopReason: 'tool_use' }));
    assert.equal((await p1).providerName, 'anthropic:a');
    // Pas suivant (tour verrouillé sur cet agent) : encore 40 s sans texte, le tour continue au lieu de s'arrêter.
    const p2 = r.complete({ ...req, tools: outils, onDelta: () => undefined } as never).then((x) => x.text, (e: Error) => `ERREUR ${e.message}`);
    await laisser(); h.avancer(40_000); await laisser();
    enCours[1]?.(okResp('écrit'));
    assert.equal(await p2, 'écrit');
  });
  assert.equal(b.appels.length, 0);
});

test('une place du classement qui ne nomme aucun agent utilisable est signalée (une faute ne coupe pas tout en silence)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'odin-classement-'));
  process.env.ESSAI_CLE_D2 = 'k';
  const vus: string[] = [];
  const avant = console.error;
  console.error = (...x: unknown[]) => { vus.push(x.map(String).join(' ')); };
  try {
    const cfg = { providers: [{ kind: 'openai', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'ESSAI_CLE_D2' }], routing: { quotaPauseMin: 15, classement: ['claude', 'deepseek:deepseek-flash'] } } as unknown as OdinConfig;
    const r = R.Router.fromConfig(cfg, [], odinPaths(tmp));
    assert.deepEqual(r.order().map((x) => x.provider.name), ['deepseek:deepseek-flash']);
    assert.ok(vus.some((l) => /place 1/.test(l) && l.includes('claude')), `signalé : ${vus.join(' | ')}`);
    assert.ok(!vus.some((l) => l.includes(R.AGENT_LOCAL)), 'l\'agent local n\'est pas une faute');
    // Tout le classement est faux : rien ne part (prudent), mais c'est dit.
    vus.length = 0;
    assert.throws(() => R.Router.fromConfig({ ...cfg, routing: { ...cfg.routing, classement: ['claude'] } } as OdinConfig, [], odinPaths(tmp)), /Aucun fournisseur/);
    assert.ok(vus.some((l) => /place 1/.test(l) && l.includes('claude')));
    assert.ok(vus.some((l) => /aucun agent du classement/i.test(l)));
  } finally { console.error = avant; delete process.env.ESSAI_CLE_D2; rmSync(tmp, { recursive: true, force: true }); }
});

test('l\'avis de bascule nomme les agents en clair (ni identifiant brut, ni place vide interne)', async () => {
  const local: R.Route = { provider: fournisseurSansModele('fr'), cfg: { kind: 'mock', model: 'aucun-modele' } };
  const b = agent('deepseek:b', async () => okResp('par b'));
  const { r } = routeur([route(b), local], [R.AGENT_LOCAL, 'deepseek:b']);
  const n1 = (await r.complete(req)).notice ?? '';
  assert.match(n1, /place 2/);
  assert.ok(!n1.includes('aucun-modele') && !n1.includes('deepseek:b'), n1);
  const a = agent('anthropic:a', async () => { throw new HttpError(402, 'credit balance is too low', null); });
  const { r: r2 } = routeur([route(a), route(b)], ['anthropic:a', 'deepseek:b']);
  const n2 = (await r2.complete(req)).notice ?? '';
  assert.ok(!/anthropic:a|deepseek:b/.test(n2.split('Quota')[0]), n2);
});

test('journal : le routeur n\'ajoute aucun contenu de message ; seul le début de la demande donné par le tour y figure, comme avant', async () => {
  const a = agent('anthropic:a', async () => { throw new HttpError(402, 'credit balance is too low', null); });
  const b = agent('deepseek:b', async () => okResp('réponse 5678'));
  const { r, journal } = routeur([route(a), route(b)], ['anthropic:a', 'deepseek:b']);
  const ctx: RouteContext = { turnId: 't', sessionId: 's', channel: 'web', request: 'début masqué', entries: [] };
  await withRouteContext(ctx, () => r.complete({ ...req, messages: [{ role: 'user', content: 'mon secret 1234' }] }));
  const e = journal[0];
  assert.equal(e.request, 'début masqué', 'le champ « request » vient du tour (masqué par le journal), pas du routeur');
  const sansRequest = JSON.stringify({ ...e, request: '' });
  assert.ok(!sansRequest.includes('1234') && !sansRequest.includes('5678'), sansRequest);
});
