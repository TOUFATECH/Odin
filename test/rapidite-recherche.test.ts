// Rapidité de la recherche vérifiée (src/research), sans rien retirer à la validation.
// Faux web local (test/rapidite/web.ts) : sites normaux, un site LENT (30 s), une page LOURDE (3 Mo), un site qui
// répond 429. Faux modèle sans délai : le temps mesuré est celui d'Odin.
// 1. La collecte n'attend plus la page la plus lente ; les pages non lues sont dites (limites) ; même verdict et mêmes
//    groupes de sources qu'en lisant tout (les mêmes fausses pages).
// 2. Une page HTML énorme n'est pas lue en entier pour une recherche.
// 3. Un site qui répond 429 n'est réessayé qu'une fois, avec une attente courte.
// RAPIDITE_SRC : dossier d'une autre copie de src (pour rejouer l'essai sur l'ancienne version).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { brancher, fauxLlm, fauxWeb } from './rapidite/web.ts';

const src = process.env.RAPIDITE_SRC ? pathToFileURL(join(process.env.RAPIDITE_SRC, 'x')).href.replace(/x$/, '') : new URL('../src/', import.meta.url).href;
const { research } = await import(`${src}research/research.ts`) as typeof import('../src/research/research.ts');
const { politeFetch } = await import(`${src}research/fetch.ts`) as typeof import('../src/research/fetch.ts');
const LECTURE = (await import(`${src}research/fetch.ts`) as { LECTURE_RECHERCHE?: object }).LECTURE_RECHERCHE ?? {};

const web = await fauxWeb(); brancher(web);
test.after(() => web.fermer());
let run = 100;
async function chercher(scenario: 'propre' | 'realiste' | 'contra-lente' | 'officiel-lent' | 'deux-groupes') {
  const journal: Array<{ role: string; debut: number; fin: number }> = [];
  const t0 = performance.now();
  let redacteur = '';
  const llm = fauxLlm(0, journal), etapes: Array<{ t: number; e: string }> = [];
  const r = await research('Combien consomme le NAS Synology DS923+ ?', {
    onStep: (e) => etapes.push({ t: performance.now(), e }),
    llm: async (s, u) => { if (s.startsWith('Tu es le RÉDACTEUR')) redacteur = u; return llm(s, u); },
    depth: 'normale', provider: 'searxng', searxngUrl: `http://127.0.0.1:${web.port}/moteur/${scenario}/r${++run}`, env: {},
  });
  const lire = etapes.find((x) => x.e.startsWith('Je lis')), apres = etapes.find((x) => x.e.startsWith('J\'évalue'));
  return { r, ms: performance.now() - t0, collecte: lire && apres ? apres.t - lire.t : NaN, redacteur, groupes: new Set(r.sources.map((s) => s.cluster)).size, verdicts: r.claims.map((c) => `${c.verdict}/${c.independent}`) };
}

test('web propre : toutes les pages lues (la 2e page d\'un site tient dans le délai), même verdict et mêmes groupes', async () => {
  const x = await chercher('propre');
  assert.deepEqual(x.verdicts, ['confirmé/5'], `verdict : ${x.verdicts}`);
  assert.equal(x.groupes, 5);
  assert.deepEqual(x.r.nonLues ?? [], [], 'aucune page abandonnée sur un web propre');
  assert.ok(x.collecte < 6500, `collecte sur un web propre : ${Math.round(x.collecte)} ms`);
});

test('web réaliste (site lent 30 s, 429, page lourde) : la collecte n\'attend pas 50 s, et le verdict n\'est pas « confirmé » sur ce qui manque', async () => {
  const x = await chercher('realiste');
  // Le site lent (30 s) n'est jamais lu : avant, il échouait au bout de 25 s et le verdict restait « confirmé » ;
  // maintenant il est abandonné, nommé, et le verdict est « probable » avec sa raison.
  assert.deepEqual(x.verdicts, ['probable/4'], `verdict : ${x.verdicts}`);
  assert.match(x.r.claims[0]?.limite ?? '', /non lue/);
  assert.equal(x.groupes, 4);
  assert.ok(x.collecte < 8000, `collecte réaliste : ${Math.round(x.collecte)} ms`);
  assert.ok(x.r.errors.some((e) => /lent-r\d+\.test/.test(e)), 'le site lent doit figurer dans les erreurs');
  assert.match(x.redacteur, /PAGES NON LUES[\s\S]*lent-r\d+\.test/, 'le rédacteur doit savoir quelles pages n\'ont pas été lues (limites)');
});

// Aller plus vite ne doit JAMAIS rendre le verdict plus optimiste.
test('une contradiction lente (recherche contradictoire, 7 s) est attendue : le verdict reste « incertain »', async () => {
  const x = await chercher('contra-lente');
  assert.equal(x.r.claims[0]?.verdict, 'incertain', `verdict : ${x.verdicts} ; non lues : ${x.r.errors.join(' | ')}`);
});

test('la seule source officielle est lente (7 s) : elle est attendue, et confirme comme avant', async () => {
  const x = await chercher('officiel-lent');
  assert.equal(x.r.claims[0]?.verdict, 'confirmé', `verdict : ${x.verdicts} ; non lues : ${x.r.errors.join(' | ')}`);
  assert.ok(x.r.sources.some((s) => s.tier === 'officiel'), 'la source officielle doit avoir été lue');
});

test('deux groupes « pour » et une 3e page lente non lue : jamais « confirmé » sur ce qui manque, et c\'est dit', async () => {
  const x = await chercher('deux-groupes');
  const c = x.r.claims[0];
  if (c?.verdict !== 'incertain') {
    assert.notEqual(c?.verdict, 'confirmé', `verdict « confirmé » alors qu'une page n'a pas été lue : ${x.r.errors.join(' | ')}`);
    assert.match(c?.limite ?? '', /non lue/, 'la raison du verdict prudent doit être écrite');
    assert.ok((x.r.nonLues ?? []).some((e) => /contre-lent/.test(e)), 'la page non lue doit être nommée');
    assert.match(x.redacteur, /contre-lent/, 'le rédacteur doit savoir quelle page manque');
  }
});

test('une page coupée (plus de 1 Mo) est signalée comme lue en partie', async () => {
  const morceau = new TextEncoder().encode(`<p>${'paragraphe '.repeat(5000)}</p>\n`);
  let envoye = 0;
  const fetcher = (async () => new Response(new ReadableStream({ pull(c) { if (envoye >= 1_100_000) { c.close(); return; } envoye += morceau.length; c.enqueue(morceau); } }), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })) as unknown as typeof fetch;
  const p = await politeFetch('https://long-essai.test/article', { fetcher, ...LECTURE });
  assert.equal((p as { tronquee?: boolean }).tronquee, true, 'la page coupée doit le dire');
});

test('l\'outil web_research dit TOUTES les pages non lues, avant les erreurs des moteurs', async () => {
  const { webResearch } = await import(`${src}tools/research.ts`) as typeof import('../src/tools/research.ts');
  const { Mnemosyne } = await import(`${src}muninn/store.ts`) as typeof import('../src/muninn/store.ts');
  const ctx = { sessionId: 'essai', channel: 'essai', peer: 'moi', workspace: '.', muninn: new Mnemosyne(':memory:'), signal: new AbortController().signal, isTainted: () => false, fullAccess: false, llm: fauxLlm(0, []), search: { provider: 'searxng' as const, searxngUrl: `http://127.0.0.1:${web.port}/moteur/realiste/r${++run}` } };
  const out = await webResearch.run({ question: 'Combien consomme le NAS Synology DS923+ ?', depth: 'normale' }, ctx as never);
  const texte = typeof out === 'string' ? out : out.output;
  const meta = texte.slice(texte.lastIndexOf('— Moteurs'));
  assert.equal((meta.match(/lent-r\d+\.test : pas lue à temps/g) ?? []).length, 2, `les deux pages du site lent doivent être dites : ${meta}`);
  const autres = meta.indexOf(' · non lues : ');
  assert.ok(autres < 0 || meta.indexOf('pas lue à temps') < autres, `les pages non lues passent avant les erreurs des moteurs : ${meta}`);
});

test('une page HTML énorme n\'est pas lue en entier pour une recherche', async () => {
  let tire = 0;
  const morceau = new TextEncoder().encode(`<p>${'remplissage '.repeat(5000)}</p>\n`);
  const fetcher = (async () => new Response(new ReadableStream({ pull(c) { if (tire >= 3_000_000) { c.close(); return; } tire += morceau.length; c.enqueue(morceau); } }), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })) as unknown as typeof fetch;
  await politeFetch('https://lourd-essai.test/page', { fetcher, ...LECTURE });
  assert.ok(tire < 1_200_000, `${tire} octets lus pour une page de 3 Mo`);
});

test('un site qui répond 429 n\'est réessayé qu\'une fois, avec une attente courte', async () => {
  let appels = 0;
  const fetcher = (async () => { appels++; return new Response('trop', { status: 429, headers: { 'retry-after': '3' } }); }) as unknown as typeof fetch;
  const t0 = performance.now();
  await assert.rejects(politeFetch('https://surcharge-essai.test/x', { fetcher, pause: () => 0, ...LECTURE }), /429/);
  const ms = performance.now() - t0;
  assert.equal(appels, 2);
  assert.ok(ms < 4500, `${Math.round(ms)} ms`);
});
