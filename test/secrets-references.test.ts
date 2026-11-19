// Les références au coffre : un agent n'a jamais la valeur d'un secret, il écrit « coffre:Nom/champ » et le serveur la
// remplace par la valeur juste avant l'outil, seulement aux places permises, dans le coffre de la personne qui demande.
// Demande du propriétaire (19/11, section 86) : « les mots de passe, ils sont jamais visibles dans la conversation de
// l'agent IA. L'agent IA, en fait, il demande de remplir un mot de passe et ensuite c'est le serveur qui lui-même vient
// remplir ce mot de passe » ; pour la box (19/11) : « il les supprime les conserves nulle part et le mettre directement
// dans le coffre et c'est tout il fait le travail ».
// Et deux restes du branchement : la chronologie de Kéryx ne garde plus le texte d'origine d'un message qui portait un
// secret ; l'écho « 🎙 … » d'un vocal (Discord, Signal, Slack) ne part plus avant le tri, ni jamais s'il portait un secret.
//
// Toutes les valeurs sont tirées au hasard à chaque essai : aucune n'est un vrai secret. La recherche se fait octet par
// octet (UTF-8 et UTF-16) dans tout le dossier d'Odin d'essai et le dossier des clés, hors du coffre chiffré de Thésauros.
// Aucun appel réel : outils remplacés par des espions (en mémoire vive), messageries par de faux réseaux.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { DiscordChannel } from '../src/bifrost/channels/discord.ts';
import { SignalChannel } from '../src/bifrost/channels/signal.ts';
import { SlackChannel } from '../src/bifrost/channels/slack.ts';
import { deciderPuisLancer } from '../src/heimdall/executer.ts';
import { Heimdall, type ApprovalRequest } from '../src/heimdall/policy.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { load, rangerSecrets, store, type Item } from '../src/valhalla/modules/brisingamen.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import { machineOnboard, adminEnable } from '../src/tools/onboard.ts';
import { tryDirect, type DirectDeps } from '../src/core/direct.ts';
import { CanalKeryx } from '../src/valhalla/keryx/canal.ts';
import { _reinitialiser, poserSecret } from '../src/valhalla/keryx/auth.ts';
import { configurerTrace, lire } from '../src/valhalla/keryx/trace.ts';
import type { ReglagesKeryx } from '../src/valhalla/keryx/types.ts';
import type { Tool } from '../src/tools/registry.ts';
import { browserFor, browserOpen, browserType } from '../src/tools/browser.ts';
import { describeLook } from '../src/browser/browser.ts';
import { call, makeOdin, type TestOdin } from './helpers.ts';

const CLE_ESSAI = randomBytes(32).toString('hex');
const ouvrirCoffre = () => { process.env.BRISINGAMEN_KEY = CLE_ESSAI; };
const fermerCoffre = () => { delete process.env.BRISINGAMEN_KEY; };
/** Une valeur au hasard qui a l'air d'un mot de passe (lettres, chiffre, signe). */
const valeur = (prefixe = 'Qz8') => `${prefixe}-${randomBytes(9).toString('hex')}#K`;

class FakeChannel implements Channel {
  readonly name: string;
  readonly interactive = true;
  sent: Array<{ peer: string; text: string }> = [];
  constructor(name = 'fake') { this.name = name; }
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(peer: string, text: string) { this.sent.push({ peer, text }); }
  async stop() {}
}

function fichiers(d: string): string[] {
  if (!d || !existsSync(d)) return [];
  const out: string[] = [];
  for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) out.push(...fichiers(p)); else out.push(p); }
  return out;
}
/** Les fichiers du dossier d'essai et du dossier des clés (hors coffre chiffré de Thésauros) qui contiennent une valeur. */
function traces(home: string, valeurs: string[]): string[] {
  const out: string[] = [];
  for (const f of [home, process.env.ODIN_CLE_DIR ?? ''].flatMap(fichiers)) {
    if (f.endsWith(join('brisingamen', 'coffre.bin'))) continue;
    const b = readFileSync(f);
    for (const v of valeurs) if (b.includes(Buffer.from(v, 'utf8')) || b.includes(Buffer.from(v, 'utf16le'))) out.push(`${f.slice(home.length)} ⊃ ${v}`);
  }
  return out;
}
const ctxCoffre = (o: TestOdin): ModCtx => { const dir = join(o.paths.home, 'valhalla', 'brisingamen'); mkdirSync(dir, { recursive: true }); return { home: o.paths.home, dir, now: () => new Date() } as unknown as ModCtx; };
/** Un élément ajouté au coffre (avec un site, si donné), au coffre du propriétaire ou d'un membre. */
function ajouter(o: TestOdin, it: Partial<Item> & { name: string }): void {
  const c = ctxCoffre(o), items = load(c);
  items.push({ id: randomBytes(6).toString('hex'), type: 'identifiant', folder: 'Personnel', updated: new Date().toISOString(), ...it } as Item);
  store(c, items);
}
/** Un outil espion : il note ce qu'il reçoit (en mémoire vive) et rend une sortie qui recopie le champ reçu. */
function espion(name: string, risk: Tool['risk'], champ: string, recu: Array<Record<string, unknown>>, sortie?: (v: string) => string): Tool {
  return { name, description: '', risk, schema: { type: 'object', properties: {} }, async run(i) { recu.push({ ...i }); const v = String(i[champ] ?? ''); return sortie ? sortie(v) : `reçu : ${v}`; } } as Tool;
}
const ctxOutil = (o: TestOdin, auteur: { role: 'owner' | 'member' | 'guest'; nom: string }, channel = 'web', peer = 'principal') => ({
  sessionId: `${channel}:${peer}`, channel, peer, workspace: o.paths.home, home: o.paths.home, muninn: o.muninn, auteur,
  redactor: { redact: (x: string) => x, add() {} }, isTainted: () => false, signal: new AbortController().signal,
}) as never;
/**
 * Le navigateur d'Odin (UN par dossier d'Odin, partagé par toutes les conversations, la recherche web et les tâches)
 * remplacé par un faux, sans rien lancer : `url` est la page RÉELLEMENT ouverte (undefined : navigateur fermé).
 */
function fauxNavigateur(home: string, url?: string): { url?: string } {
  const etat: { url?: string } = { url };
  const b = browserFor(home) as unknown as { look(): Promise<unknown> };
  Object.defineProperty(b, 'running', { get: () => etat.url !== undefined, configurable: true });
  b.look = async () => ({ url: etat.url ?? 'about:blank', title: '', items: [], text: '', scroll: { y: 0, max: 0 } });
  return etat;
}
/** Les vrais outils du navigateur (nom, risque, résumé), dont l'action est remplacée : la sortie porte la page ouverte. */
const sortiePage = (url: string | undefined, corps: string) => ({ output: `<untrusted source="${url ?? 'about:blank'}">\n${corps}\n</untrusted>`, tainted: true });
function taperEspion(nav: { url?: string }, recu: Array<Record<string, unknown>>): Tool {
  return { ...browserType, async run(i: Record<string, unknown>) { recu.push({ ...i }); return sortiePage(nav.url, `champ ${String(i.element)} : ${String(i.text)}`); } } as Tool;
}

test('contrôle : la recherche trouve bien une valeur écrite quelque part', async () => {
  const o = makeOdin([]);
  const { writeFileSync } = await import('node:fs');
  const v = valeur();
  writeFileSync(join(o.paths.home, 'temoin.txt'), `x${v}x`);
  assert.equal(traces(o.paths.home, [v]).length, 1);
  o.cleanup();
});

test('agent factice : il reçoit « coffre:Box/mot de passe », appelle machine_onboard avec la référence ; l\'outil reçoit la vraie valeur ; la valeur n\'est nulle part ailleurs', async () => {
  ouvrirCoffre();
  const o = makeOdin([call('machine_onboard', { host: '192.0.2.10', password: 'coffre:Box/mot de passe' }), { text: 'Fait.' }], { approve: true });
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const recuAgent: string[] = [];
  const run = o.agent.run.bind(o.agent);
  (o.agent as unknown as { run: typeof run }).run = async (text, opts) => { recuAgent.push(text); return run(text, opts); };
  const vrai = machineOnboard.run;
  const recuOutil: string[] = [];
  // L'outil espion : il garde en mémoire vive ce qu'il reçoit et le recopie dans sa sortie (pour vérifier qu'elle est retirée).
  machineOnboard.run = async (i) => { recuOutil.push(String(i.password)); return `connecté à 192.0.2.10 avec ${String(i.password)}`; };
  const mdp = valeur();
  try {
    const tour = gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `box identifiant admin7 / mot de passe ${mdp}` });
    // Prendre la main sur une machine demande ta validation (sur le canal) : le propriétaire répond « oui ».
    for (let k = 0; k < 200 && !ch.sent.some((x) => /oui ou non/i.test(x.text)) && recuOutil.length === 0; k++) await new Promise((r) => setTimeout(r, 30));
    if (ch.sent.some((x) => /oui ou non/i.test(x.text))) await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: 'oui' });
    await tour;
    for (let k = 0; k < 100 && o.provider.calls.length < 2; k++) await new Promise((r) => setTimeout(r, 30));
    await new Promise((r) => setTimeout(r, 300)); // les écritures différées (journaux, mémoire)
  } finally { machineOnboard.run = vrai; }
  assert.deepEqual(recuOutil, [mdp], 'l\'outil reçoit la vraie valeur, une fois');
  const vu = JSON.stringify([o.provider.calls, recuAgent, ch.sent, o.approvals]);
  assert.ok(!vu.includes(mdp) && !vu.includes('admin7'), 'ni le modèle, ni l\'agent, ni le canal, ni la demande de validation ne voient la valeur');
  assert.match(JSON.stringify(o.provider.calls), /connecté à 192\.0\.2\.10 avec \[coffre:Box\/mot de passe\]/, 'la sortie de l\'outil repart avec la référence');
  assert.deepEqual(traces(o.paths.home, [mdp, 'admin7']), [], 'aucun fichier (paroles, tours, conversation, journaux, journal des actions) ne porte la valeur');
  o.cleanup(); fermerCoffre();
});

test('le serveur remplace juste avant l\'outil : la demande de validation, le journal des actions et la sortie gardent la référence ; une erreur aussi', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  const mdp = valeur();
  rangerSecrets(ctxCoffre(o), { role: 'owner', id: '', nom: '' }, [{ nom: 'Proxmox', champ: 'mot de passe', valeur: mdp }]);
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall(DEFAULT_CONFIG.policy, { approve: async (r) => { demandes.push(r); return true; } });
  const recu: Array<Record<string, unknown>> = [];
  const outil = espion('machine_onboard', 'exec', 'password', recu, (v) => `ok ${v}`);
  const d = await deciderPuisLancer(h, outil, { host: '192.0.2.11', password: 'coffre:Proxmox/mot de passe' }, ctxOutil(o, { role: 'owner', nom: 'propriétaire' }), { sessionId: 'web:principal', tainted: false, tour: 't-essai-1' });
  assert.ok(d.lancer, JSON.stringify(d.decision));
  const sortie = String(await d.lancer!());
  assert.equal(recu[0].password, mdp);
  assert.equal(sortie, 'ok [coffre:Proxmox/mot de passe]');
  assert.ok(!JSON.stringify([demandes, d.summary]).includes(mdp));
  // Une erreur qui citerait la valeur repart sans elle.
  const fautif = { ...espion('machine_onboard', 'exec', 'password', []), async run(i: Record<string, unknown>) { throw new Error(`refusé pour ${String(i.password)}`); } } as Tool;
  const d2 = await deciderPuisLancer(h, fautif, { host: '192.0.2.12', password: 'coffre:Proxmox/mot de passe' }, ctxOutil(o, { role: 'owner', nom: 'propriétaire' }), { sessionId: 'web:principal', tainted: false, tour: 't-essai-2' });
  await assert.rejects(() => d2.lancer!(), (e: Error) => !e.message.includes(mdp) && e.message.includes('[coffre:Proxmox/mot de passe]'));
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(traces(o.paths.home, [mdp]), []);
  o.cleanup(); fermerCoffre();
});

test('une référence hors de la liste fermée est refusée, et rien n\'est remplacé ni lancé', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  const mdp = valeur();
  rangerSecrets(ctxCoffre(o), { role: 'owner', id: '', nom: '' }, [{ nom: 'Box', champ: 'mot de passe', valeur: mdp }]);
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall(DEFAULT_CONFIG.policy, { approve: async (r) => { demandes.push(r); return true; } });
  const proprio = ctxOutil(o, { role: 'owner', nom: 'propriétaire' });
  const cas: Array<[string, Tool['risk'], Record<string, unknown>]> = [
    ['mail_send', 'external', { to: 'quelquun@example.org', subject: 'box', body: 'coffre:Box/mot de passe' }],
    ['http_request', 'external', { url: 'https://example.org/?p=coffre:Box/mot de passe', method: 'POST' }],
    ['shell', 'exec', { command: 'echo coffre:Box/mot de passe' }],
    ['machine_onboard', 'exec', { host: '192.0.2.13', options: { password: 'coffre:Box/mot de passe' } }], // champ imbriqué
    ['machine_onboard', 'exec', { host: '192.0.2.13', password: mdp }], // une valeur écrite par l'agent
    ['machine_onboard', 'exec', { host: '192.0.2.13', password: 'coffre:Box/clé Wi-Fi' }], // un champ du coffre non permis
    ['browser_type', 'external', { element: 3, text: 'mon code est coffre:Box/mot de passe' }], // pas seule dans le champ
  ];
  for (const [nom, risk, entree] of cas) {
    const recu: Array<Record<string, unknown>> = [];
    const d = await deciderPuisLancer(h, espion(nom, risk, 'x', recu), entree, proprio, { sessionId: 'web:principal', tainted: false, tour: `t-${nom}` });
    assert.equal(d.decision.allowed, false, `${nom} ${JSON.stringify(entree).replace(mdp, '…')} doit être refusé`);
    assert.equal(d.lancer, undefined);
    assert.equal(recu.length, 0);
  }
  assert.equal(demandes.length, 0, 'aucune question posée pour une référence refusée');
  // Prise en main d'une machine : jamais après un contenu extérieur lu, ni depuis une tâche automatique.
  for (const e of [{ tainted: true }, { tainted: false, suspicious: true }, { tainted: false, unattended: true }, { tainted: false, automatique: true }]) {
    const d = await deciderPuisLancer(h, espion('machine_onboard', 'exec', 'password', []), { host: '192.0.2.14', password: 'coffre:Box/mot de passe' }, proprio, { sessionId: 'web:principal', tour: 't-propre', ...e });
    assert.equal(d.decision.allowed, false, JSON.stringify(e));
  }
  o.cleanup(); fermerCoffre();
});

test('remplir un identifiant de site : seulement sur la page de CE site, et seulement l\'identifiant ou le mot de passe', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  const mdp = valeur(), id = `jo-${randomBytes(4).toString('hex')}`;
  ajouter(o, { name: 'Banque', user: id, password: mdp, url: 'https://banque.example' });
  ajouter(o, { name: 'Sans site', password: valeur() });
  const h = new Heimdall(DEFAULT_CONFIG.policy, { approve: async () => true });
  const proprio = ctxOutil(o, { role: 'owner', nom: 'propriétaire' });
  const recu: Array<Record<string, unknown>> = [];
  const nav = fauxNavigateur(o.paths.home);
  const taper = taperEspion(nav, recu);
  // La page ouverte est celle d'un autre site : refusé.
  nav.url = 'https://banque.example.piege.test/login';
  assert.equal((await deciderPuisLancer(h, taper, { element: 4, text: 'coffre:Banque/mot de passe' }, proprio, { sessionId: 'web:principal', tainted: true, tour: 't-site-1' })).decision.allowed, false);
  // Navigateur fermé (aucune page) : refusé.
  nav.url = undefined;
  assert.equal((await deciderPuisLancer(h, taper, { element: 4, text: 'coffre:Banque/mot de passe' }, proprio, { sessionId: 'web:principal', tainted: true, tour: 't-site-2' })).decision.allowed, false);
  // Un élément sans site : refusé.
  nav.url = 'https://banque.example/login';
  assert.equal((await deciderPuisLancer(h, taper, { element: 4, text: 'coffre:Sans site/mot de passe' }, proprio, { sessionId: 'web:principal', tainted: true, tour: 't-site-3' })).decision.allowed, false);
  assert.equal(recu.length, 0);
  // La bonne page : l'identifiant puis le mot de passe sont tapés par le serveur ; la sortie repart sans eux.
  for (const [champ, v] of [['identifiant', id], ['mot de passe', mdp]] as const) {
    const d = await deciderPuisLancer(h, taper, { element: 4, text: `coffre:Banque/${champ}` }, proprio, { sessionId: 'web:principal', tainted: true, tour: `t-site-${champ}` });
    assert.ok(d.lancer, JSON.stringify(d.decision));
    const res = await d.lancer!();
    const sortie = typeof res === 'string' ? res : res.output;
    assert.equal(recu.at(-1)!.text, v);
    assert.ok(!sortie.includes(v), sortie);
  }
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(traces(o.paths.home, [mdp]), []);
  o.cleanup(); fermerCoffre();
});

test('un seul navigateur, partagé : la page vérifiée est celle ouverte À L\'INSTANT (une recherche web, une autre conversation a pu le mener ailleurs, même pendant la question) ; la question dit l\'élément du coffre et le site', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  try {
    const mdp = valeur();
    ajouter(o, { name: 'Banque', user: 'jo-1', password: mdp, url: 'https://banque.example' });
    const nav = fauxNavigateur(o.paths.home, 'https://banque.example/login');
    const demandes: ApprovalRequest[] = [];
    let pendantLaQuestion: (() => void) | undefined;
    const h = new Heimdall(DEFAULT_CONFIG.policy, { approve: async (r) => { demandes.push(r); pendantLaQuestion?.(); return true; } });
    const proprio = ctxOutil(o, { role: 'owner', nom: 'propriétaire' });
    const recu: Array<Record<string, unknown>> = [];
    const taper = taperEspion(nav, recu);
    const ouvrir = { ...browserOpen, async run() { return sortiePage(nav.url, 'connexion'); } } as Tool;
    // 1) L'outil du navigateur ouvre la banque, dans cette conversation.
    const d0 = await deciderPuisLancer(h, ouvrir, { url: 'https://banque.example/login' }, proprio, { sessionId: 'web:principal', tainted: true, tour: 't-nav-0' });
    await d0.lancer!();
    // 2) Une recherche web (même conversation, sans outil « browser_ ») ou une autre conversation mène le MÊME navigateur ailleurs.
    nav.url = 'https://piege.example/';
    const d1 = await deciderPuisLancer(h, taper, { element: 4, text: 'coffre:Banque/mot de passe' }, proprio, { sessionId: 'web:principal', tainted: true, tour: 't-nav-1' });
    assert.equal(d1.decision.allowed, false, 'la page réellement ouverte n\'est pas la banque');
    assert.equal(recu.length, 0);
    // 3) De retour sur la banque : permis ; la question dit quel élément du coffre part et sur quel site, jamais la valeur.
    nav.url = 'https://banque.example/login';
    const avant = demandes.length;
    const d2 = await deciderPuisLancer(h, taper, { element: 4, text: 'coffre:Banque/mot de passe' }, proprio, { sessionId: 'web:principal', tainted: true, tour: 't-nav-2' });
    assert.ok(d2.lancer, JSON.stringify(d2.decision));
    assert.equal(demandes.length, avant + 1, 'une question au propriétaire');
    const q = demandes.at(-1)!.summary;
    assert.match(q, /« Banque — mot de passe » de ton coffre/, q);
    assert.match(q, /sur https:\/\/banque\.example\b/, q);
    assert.ok(!JSON.stringify(demandes).includes(mdp));
    await d2.lancer!();
    assert.deepEqual(recu.map((x) => x.text), [mdp]);
    // 4) La page change PENDANT la question (après la vérification, avant l'outil) : rien ne part.
    pendantLaQuestion = () => { nav.url = 'https://piege.example/'; };
    const d3 = await deciderPuisLancer(h, taper, { element: 5, text: 'coffre:Banque/mot de passe' }, proprio, { sessionId: 'web:principal', tainted: true, tour: 't-nav-3' });
    pendantLaQuestion = undefined;
    assert.ok(d3.lancer, JSON.stringify(d3.decision));
    await assert.rejects(() => d3.lancer!(), /n'est pas le site de « Banque ».*rien n'est parti/);
    assert.equal(recu.length, 1, 'la valeur n\'est tapée qu\'une fois, sur la banque');
  } finally { o.cleanup(); fermerCoffre(); }
});

test('la valeur tapée ne revient pas par la lecture suivante : le mot de passe remplacé est confié au masqueur (élément ajouté après le démarrage, coffre d\'un membre)', async () => {
  ouvrirCoffre();
  const o = makeOdin([]); // démarré coffre vide : les éléments sont ajoutés ensuite (Thésauros, la conversation)
  try {
    const mdp = valeur(), mdpMembre = valeur('Me5');
    ajouter(o, { name: 'Banque', user: 'jo-2', password: mdp, url: 'https://banque.example' });
    const u = o.muninn.saveUser({ name: 'Sacha', role: 'member' });
    o.muninn.linkIdentity('fake', 'sacha-1', u.id);
    rangerSecrets(ctxCoffre(o), { role: 'member', id: u.id, nom: 'Sacha' }, [{ nom: 'Box', champ: 'mot de passe', valeur: mdpMembre }]);
    const nav = fauxNavigateur(o.paths.home, 'https://banque.example/login');
    const h = new Heimdall(DEFAULT_CONFIG.policy, { approve: async () => true });
    const avecMasqueur = (c: never) => ({ ...(c as object), redactor: o.redactor }) as never;
    const d1 = await deciderPuisLancer(h, taperEspion(nav, []), { element: 7, text: 'coffre:Banque/mot de passe' }, avecMasqueur(ctxOutil(o, { role: 'owner', nom: 'propriétaire' })), { sessionId: 'web:principal', tainted: true, tour: 't-m-1' });
    await d1.lancer!();
    const d2 = await deciderPuisLancer(h, espion('admin_enable', 'exec', 'password', []), { password: 'coffre:Box/mot de passe' }, avecMasqueur(ctxOutil(o, { role: 'member', nom: 'Sacha' }, 'fake', 'sacha-1')), { sessionId: 'fake:sacha-1', tainted: false, tour: 't-m-2' });
    await d2.lancer!();
    // La lecture suivante de la page (un champ texte montre ce qu'on y a tapé), telle que l'agent la reçoit (masqueur).
    const look = describeLook({ url: 'https://banque.example/login', title: 'Connexion', items: [{ n: 7, kind: 'champ', name: 'Recherche', value: mdp }], text: `bienvenue ${mdpMembre}`, scroll: { y: 0, max: 0 } });
    const versAgent = o.redactor.redact(look);
    assert.ok(!versAgent.includes(mdp), versAgent);
    assert.ok(!versAgent.includes(mdpMembre), versAgent);
  } finally { o.cleanup(); fermerCoffre(); }
});

test('le refus après un contenu extérieur dit comment repartir à neuf (« /new » ou « masque la conversation »)', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  try {
    rangerSecrets(ctxCoffre(o), { role: 'owner', id: '', nom: '' }, [{ nom: 'Box', champ: 'mot de passe', valeur: valeur() }]);
    const h = new Heimdall(DEFAULT_CONFIG.policy, { approve: async () => true });
    const d = await deciderPuisLancer(h, espion('machine_onboard', 'exec', 'password', []), { host: '192.0.2.16', password: 'coffre:Box/mot de passe' }, ctxOutil(o, { role: 'owner', nom: 'propriétaire' }), { sessionId: 'web:principal', tainted: true, tour: 't-neuf' });
    assert.equal(d.decision.allowed, false);
    assert.match(d.decision.allowed ? '' : d.decision.reason, /« \/new » ou « masque la conversation »/);
  } finally { o.cleanup(); fermerCoffre(); }
});

test('le coffre d\'un autre : un membre ne lit que le sien, le propriétaire le sien ; un invité, rien', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  const u = o.muninn.saveUser({ name: 'Sacha', role: 'member' });
  o.muninn.linkIdentity('fake', 'sacha-1', u.id);
  const aProprio = valeur('Pr1'), aMembre = valeur('Me2'), nasProprio = valeur('Na3'), veloMembre = valeur('Ve4');
  rangerSecrets(ctxCoffre(o), { role: 'owner', id: '', nom: '' }, [{ nom: 'Box', champ: 'mot de passe', valeur: aProprio }, { nom: 'NAS', champ: 'mot de passe', valeur: nasProprio }]);
  rangerSecrets(ctxCoffre(o), { role: 'member', id: u.id, nom: 'Sacha' }, [{ nom: 'Box', champ: 'mot de passe', valeur: aMembre }, { nom: 'Vélo', champ: 'mot de passe', valeur: veloMembre }]);
  const h = new Heimdall(DEFAULT_CONFIG.policy, { approve: async () => true });
  const membre = ctxOutil(o, { role: 'member', nom: 'Sacha' }, 'fake', 'sacha-1');
  const proprio = ctxOutil(o, { role: 'owner', nom: 'propriétaire' });
  const invite = ctxOutil(o, { role: 'guest', nom: 'Alex' }, 'fake', 'x-9');
  const essai = async (ctx: never, ref: string, tour: string) => {
    const recu: Array<Record<string, unknown>> = [];
    const d = await deciderPuisLancer(h, espion('admin_enable', 'exec', 'password', recu), { password: ref }, ctx, { sessionId: 'fake:x', tainted: false, tour });
    if (d.lancer) await d.lancer();
    return { permis: d.decision.allowed, recu: recu.map((x) => String(x.password)), raison: d.decision.allowed ? '' : d.decision.reason };
  };
  // Le même nom « Box » : chacun reçoit SA valeur.
  assert.deepEqual((await essai(membre, 'coffre:Box/mot de passe', 'm1')).recu, [aMembre]);
  assert.deepEqual((await essai(proprio, 'coffre:Box/mot de passe', 'p1')).recu, [aProprio]);
  // Le NAS du propriétaire, demandé par le membre : refusé ; le Vélo du membre, demandé par le propriétaire : refusé.
  const m2 = await essai(membre, 'coffre:NAS/mot de passe', 'm2');
  assert.equal(m2.permis, false); assert.deepEqual(m2.recu, []); assert.match(m2.raison, /n'est pas dans ton coffre/);
  const p2 = await essai(proprio, 'coffre:Vélo/mot de passe', 'p2');
  assert.equal(p2.permis, false); assert.deepEqual(p2.recu, []); assert.match(p2.raison, /n'est pas dans ton coffre/);
  // Un invité : rien.
  const g = await essai(invite, 'coffre:Box/mot de passe', 'g1');
  assert.equal(g.permis, false); assert.deepEqual(g.recu, []);
  // Aucune raison de refus ne porte une valeur.
  assert.ok(![m2.raison, p2.raison, g.raison].join(' ').match(new RegExp([aProprio, aMembre, nasProprio, veloMembre].map((x) => x.replace(/[#-]/g, '\\$&')).join('|'))));
  o.cleanup(); fermerCoffre();
});

test('coffre fermé au moment d\'agir : rien ne part', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  rangerSecrets(ctxCoffre(o), { role: 'owner', id: '', nom: '' }, [{ nom: 'Box', champ: 'mot de passe', valeur: valeur() }]);
  const h = new Heimdall(DEFAULT_CONFIG.policy, { approve: async () => true });
  const recu: Array<Record<string, unknown>> = [];
  const d = await deciderPuisLancer(h, espion('admin_enable', 'exec', 'password', recu), { password: 'coffre:Box/mot de passe' }, ctxOutil(o, { role: 'owner', nom: 'propriétaire' }), { sessionId: 'web:principal', tainted: false, tour: 't-ferme' });
  assert.ok(d.lancer);
  fermerCoffre();
  await assert.rejects(() => d.lancer!(), /coffre est fermé.*rien n'est parti/);
  assert.equal(recu.length, 0);
  o.cleanup();
});

test('la liste fermée est écrite dans le noyau : trois places, figée ; une référence se lit jusqu\'au dernier « / »', async () => {
  const r = await import('../src/heimdall/references-coffre.ts');
  assert.deepEqual(r.PLACES_PERMISES.map((p) => `${p.outil}.${p.champ}`), ['machine_onboard.password', 'admin_enable.password', 'browser_type.text']);
  assert.ok(Object.isFrozen(r.PLACES_PERMISES) && r.PLACES_PERMISES.every((p) => Object.isFrozen(p) && Object.isFrozen(p.champsDuCoffre)));
  assert.deepEqual(r.lireReference('coffre:Reçu le 2026-11-19 à 13:00/mot de passe'), { nom: 'Reçu le 2026-11-19 à 13:00', champ: 'mot de passe' });
  assert.deepEqual(r.lireReference('  coffre:a/b/identifiant '), { nom: 'a/b', champ: 'identifiant' });
  assert.equal(r.lireReference('coffre: ouvert/fermé'), undefined);
  assert.equal(r.referencesDe('note_save', { text: 'le coffre : ouvert/fermé' }).refus, undefined, 'une phrase ordinaire n\'est pas une référence');
  assert.ok(r.memeSite('https://banque.example', 'https://banque.example/login?x=1'));
  assert.ok(!r.memeSite('https://banque.example', 'http://banque.example/login'));
  assert.ok(!r.memeSite('https://banque.example', 'https://banque.example.piege.test/'));
});

test('les outils : « password » attend une référence ; une référence restée telle quelle n\'est jamais utilisée', async () => {
  assert.ok((machineOnboard.schema as { properties: Record<string, unknown> }).properties.password);
  assert.ok((adminEnable.schema as { properties: Record<string, unknown> }).properties.password);
  assert.doesNotMatch(machineOnboard.description + adminEnable.description, /secret:dernier/);
  assert.match(machineOnboard.description, /coffre:Nom\/mot de passe/);
  const o = makeOdin([]);
  const ctx = { home: o.paths.home, paths: o.paths, redactor: { redact: (x: string) => x, add() {} } } as never;
  assert.match(String(await machineOnboard.run({ host: '192.0.2.15', password: 'coffre:Box/mot de passe' }, ctx)), /n'a pas été remplacée/);
  assert.match(String(await adminEnable.run({ password: 'coffre:Box/mot de passe' }, ctx)), /n'a pas été remplacée/);
  o.cleanup();
});

test('sans IA : le mot de passe de ce poste rangé au coffre → admin_enable reçoit sa référence', async () => {
  const appels: Array<[string, Record<string, unknown>]> = [];
  const kv = new Map<string, string>();
  const d: DirectDeps = { run: async (n, i) => { appels.push([n, i]); return { ok: true, content: 'fait' }; }, has: () => true, sessionId: 's', kv: { getKv: (k) => kv.get(k), setKv: (k, v) => { kv.set(k, v); } }, adminSecret: true };
  const r = await tryDirect('le mot de passe admin de ce poste est [rangé au coffre : Reçu le 2026-11-19 à 13:00 — mot de passe]', d);
  assert.ok(r.done);
  assert.deepEqual(appels, [['admin_enable', { password: 'coffre:Reçu le 2026-11-19 à 13:00/mot de passe' }]]);
});

// ---------------------------------------------------------------------------------------------------------------
// Kéryx : la chronologie ne garde plus le texte d'origine d'un message qui portait un secret.

const reglages = (numeros: string[]): ReglagesKeryx => ({ ligne: 'aucune', numeros, autonomieApresSecret: 'equilibre', actionGraveParAppel: 'interdite', surveillances: [] } as ReglagesKeryx);

test('Kéryx : le texte d\'origine d\'un message avec secret n\'est plus écrit (remis à Odin ou non) ; un message ordinaire reste lisible', async () => {
  ouvrirCoffre();
  _reinitialiser();
  const o = makeOdin([]);
  try {
    (o.agent as unknown as { run: () => Promise<unknown> }).run = async () => ({ text: 'fait', notices: [], decisions: [], stopReason: 'done' });
    configurerTrace(o.paths.home);
    poserSecret(o.paths.home, 'c0de-maison');
    let onInb: ((m: Inbound) => Promise<void>) | undefined;
    const envois: string[] = [];
    const transport: Channel = { name: 'tg', interactive: true, start: async (cb) => { onInb = cb; }, send: async (_p, t) => { envois.push(t); }, stop: async () => {} };
    const canal = new CanalKeryx(o.paths.home, transport, () => reglages(['42']));
    const gw = new Gateway(o, { owners: { keryx: ['42'] } }).add(canal);
    await canal.start((m) => gw.handle(m));
    const mdp = valeur(), mdp2 = valeur('In2');
    await onInb!({ channel: 'tg', peer: '42', name: 'moi', text: 'code c0de-maison' });
    await onInb!({ channel: 'tg', peer: '42', name: 'moi', text: `le mot de passe du NAS est ${mdp}` });
    await onInb!({ channel: 'tg', peer: '99', name: 'inconnu', text: `mot de passe du NAS : ${mdp2}` });
    await onInb!({ channel: 'tg', peer: '42', name: 'moi', text: 'résume mes mails importants' });
    await new Promise((r) => setTimeout(r, 200));
    const lu = await lire({ n: 200 });
    const tout = JSON.stringify(lu);
    assert.ok(!tout.includes(mdp) && !tout.includes(mdp2), 'aucune entrée de la chronologie ne porte la valeur');
    const entrants = lu.filter((x) => x.sens === 'entrant').map((x) => x.texte);
    assert.ok(entrants.some((t) => t.includes('secret : retiré')), JSON.stringify(entrants));
    assert.ok(entrants.some((t) => t.includes('[secret retiré — non gardé]')), JSON.stringify(entrants));
    assert.ok(entrants.includes('résume mes mails importants'), 'un message ordinaire reste lisible');
    assert.deepEqual(traces(o.paths.home, [mdp, mdp2]), []);
    assert.ok(!envois.join('\n').includes(mdp) && !envois.join('\n').includes(mdp2));
  } finally { o.cleanup(); fermerCoffre(); }
});

test('Kéryx : la nouvelle du tri passe au transport (il efface chez lui le message qui portait un secret ; l\'écho d\'un vocal part seulement sans secret) ; un envoi marqué secret n\'est pas gardé dans la chronologie', async () => {
  ouvrirCoffre();
  _reinitialiser();
  const o = makeOdin([]);
  try {
    (o.agent as unknown as { run: () => Promise<unknown> }).run = async () => ({ text: 'fait', notices: [], decisions: [], stopReason: 'done' });
    configurerTrace(o.paths.home);
    poserSecret(o.paths.home, 'c0de-maison');
    let onInb: ((m: Inbound) => Promise<void>) | undefined;
    const remis: Inbound[] = [];
    const vus: Array<{ m: Inbound; secret: boolean }> = [];
    const envois: string[] = [];
    // Le transport sous Kéryx (un robot Telegram, par exemple) : il reconnaît SES messages à l'objet qu'il a remis.
    const transport = {
      name: 'tg', interactive: true,
      start: async (cb: (m: Inbound) => Promise<void>) => { onInb = async (m) => { remis.push(m); await cb(m); }; },
      send: async (_p: string, t: string) => { envois.push(t); }, stop: async () => {},
      apresTriSecrets: async (m: Inbound, secret: boolean) => { vus.push({ m, secret }); return secret ? 'efface' as const : undefined; },
    } as Channel;
    const canal = new CanalKeryx(o.paths.home, transport, () => reglages(['42']));
    const gw = new Gateway(o, { owners: { keryx: ['42'] } }).add(canal);
    await canal.start((m) => gw.handle(m));
    const mdp = valeur();
    await onInb!({ channel: 'tg', peer: '42', name: 'moi', text: 'code c0de-maison' });
    await onInb!({ channel: 'tg', peer: '42', name: 'moi', text: `le mot de passe du NAS est ${mdp}` });
    await onInb!({ channel: 'tg', peer: '42', name: 'moi', text: 'allume la lampe du salon', voice: true });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(vus.length, 2, 'le transport est prévenu pour chaque message remis à Odin');
    assert.ok(vus[0].m === remis[1] && vus[0].secret === true, 'le message avec un secret : à effacer chez le transport');
    assert.ok(vus[1].m === remis[2] && vus[1].secret === false, 'le vocal sans secret : son écho peut partir');
    // Un envoi marqué secret (le nouveau mot de passe d'une machine) : parti en privé, pas gardé dans la chronologie.
    const nouveau = valeur('Nv6');
    await canal.send('42', `Nouveau mot de passe de la machine : ${nouveau}`, { secret: true });
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(envois.some((t) => t.includes(nouveau)), 'il part bien, en privé');
    const tout = JSON.stringify(await lire({ n: 200 }));
    assert.ok(!tout.includes(nouveau) && !tout.includes(mdp), 'la chronologie ne garde ni l\'un ni l\'autre');
    assert.deepEqual(traces(o.paths.home, [mdp, nouveau]), []);
  } finally { o.cleanup(); fermerCoffre(); }
});

// ---------------------------------------------------------------------------------------------------------------
// L'écho « 🎙 … » d'un vocal : après le tri, et jamais s'il portait un secret (Discord, Signal, Slack).

const agentMuet = (o: TestOdin) => { (o.agent as unknown as { run: () => Promise<unknown> }).run = async () => ({ text: 'fait', notices: [], decisions: [], stopReason: 'done' }); };
const octets = () => new Response(new Uint8Array([1, 2, 3]));

test('Discord, vocal : l\'écho est coupé quand il porte un secret, gardé sinon', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  try {
    agentMuet(o);
    const envois: string[] = [];
    const faux = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/channels/') && u.endsWith('/messages')) { envois.push(String(init?.body ?? '')); return new Response(JSON.stringify({ id: 'm' })); }
      if (u.endsWith('/users/@me/channels')) return new Response(JSON.stringify({ id: 'dm1' }));
      return octets();
    }) as typeof fetch;
    let dit = '';
    const dc = new DiscordChannel('t', { transcribe: async () => dit }, faux);
    const gw = new Gateway(o, { owners: { discord: ['u1'] } }).add(dc);
    const vocal = (id: string) => (dc as unknown as { onMsg(m: unknown, cb: (m: Inbound) => Promise<void>): Promise<void> }).onMsg({ id, channel_id: 'dm1', content: '', author: { id: 'u1', username: 'boss' }, attachments: [{ url: `https://cdn.invalid/${id}.ogg`, filename: 'v.ogg', content_type: 'audio/ogg', size: 3 }] }, (m) => gw.handle(m));
    const mdp = valeur();
    dit = `le mot de passe de la box est ${mdp}`; await vocal('a1');
    dit = 'allume la lampe du salon'; await vocal('a2');
    const echos = envois.filter((b) => b.includes('🎙'));
    assert.equal(echos.length, 1, JSON.stringify(envois));
    assert.match(echos[0], /allume la lampe/);
    assert.ok(!envois.join('').includes(mdp));
  } finally { o.cleanup(); fermerCoffre(); }
});

test('Signal, vocal : l\'écho est coupé quand il porte un secret, gardé sinon', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  try {
    agentMuet(o);
    const envois: string[] = [];
    let n = 0;
    const faux = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/v1/receive/')) return new Response(JSON.stringify([{ envelope: { sourceNumber: '+33600', dataMessage: { message: '', attachments: [{ id: `a${++n}`, contentType: 'audio/aac', size: 3 }] } } }]));
      if (u.endsWith('/v2/send')) { envois.push(String(init?.body ?? '')); return new Response('{}'); }
      return octets();
    }) as typeof fetch;
    let dit = '';
    const sg = new SignalChannel('http://signal.invalid', '+33700', { transcribe: async () => dit }, faux);
    const gw = new Gateway(o, { owners: { signal: ['+33600'] } }).add(sg);
    const enCours: Array<Promise<void>> = [];
    const lire1 = async () => { await sg.poll((m) => { const p = gw.handle(m); enCours.push(p); return p; }); await Promise.all(enCours); };
    const mdp = valeur();
    dit = `le mot de passe de la box est ${mdp}`; await lire1();
    dit = 'allume la lampe du salon'; await lire1();
    const echos = envois.filter((b) => b.includes('🎙'));
    assert.equal(echos.length, 1, JSON.stringify(envois));
    assert.match(echos[0], /allume la lampe/);
    assert.ok(!envois.join('').includes(mdp));
  } finally { o.cleanup(); fermerCoffre(); }
});

test('Slack, vocal : l\'écho est coupé quand il porte un secret, gardé sinon', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  try {
    agentMuet(o);
    const envois: string[] = [];
    const faux = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('https://slack.com/api/')) { envois.push(String(init?.body ?? '')); return new Response(JSON.stringify({ ok: true, ts: '1', channel: { id: 'D1' } })); }
      return octets();
    }) as typeof fetch;
    let dit = '';
    const sl = new SlackChannel('xoxb-essai', 'xapp-essai', { transcribe: async () => dit }, faux);
    const gw = new Gateway(o, { owners: { slack: ['U1'] } }).add(sl);
    const vocal = () => (sl as unknown as { onEvent(e: unknown, cb: (m: Inbound) => Promise<void>): Promise<void> }).onEvent({ type: 'message', channel_type: 'im', user: 'U1', channel: 'D1', text: '', subtype: 'file_share', files: [{ name: 'v.m4a', mimetype: 'audio/mp4', url_private: 'https://files.invalid/v.m4a', size: 3 }] }, (m) => gw.handle(m));
    const mdp = valeur();
    dit = `le mot de passe de la box est ${mdp}`; await vocal();
    dit = 'allume la lampe du salon'; await vocal();
    const echos = envois.filter((b) => b.includes('🎙'));
    assert.equal(echos.length, 1, JSON.stringify(envois));
    assert.match(echos[0], /allume la lampe/);
    assert.ok(!envois.join('').includes(mdp));
  } finally { o.cleanup(); fermerCoffre(); }
});
