// Couper un lien écrit entre applis (livraison L1) : les 21 liens à point unique se coupent et se rétablissent depuis la
// page des automatisations, par la pause qui existe déjà (identifiants « lien: »). Une confirmation ; un lien qui protège
// cite sa raison, lève une alerte haute à clé propre, se rétablit seul (1 h par défaut, 24 h au plus). Chaque geste est
// journalisé. Le lien coupé n'agit plus ; un état abîmé ne coupe rien. Seule la session du navigateur du propriétaire
// peut couper : ni la clé d'accès, ni un membre, ni un invité, ni une automatisation, ni une action d'appli, ni l'agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { Automatismes, brancherPauseGlobale, couperLien, etatLien, journalLiens, lienCoupe, type HoteAutomatismes, type LienACouper } from '../src/valhalla/automatismes.ts';
import { LINKS, wireReflexes } from '../src/valhalla/links.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import type { AlertIn, Module } from '../src/valhalla/types.ts';
import { execute, type Workflow } from '../src/draupnir/engine.ts';
import { CATALOG } from '../src/draupnir/nodes.ts';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { relierProprietaire } from '../src/valhalla/sso/etat.ts';
import { startDraupnir } from '../src/draupnir/odin.ts';

const SRC = new URL('../src/', import.meta.url);
const lire = (f: string) => readFileSync(new URL(f, SRC), 'utf8');

/** Un registre sur un dossier neuf, à l'horloge simulée, qui note les alertes et les alertes vues. */
function banc(fichier?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'liens-coupes-'));
  if (fichier !== undefined) writeFileSync(join(dir, 'automatismes.json'), fichier);
  let now = new Date('2026-11-17T10:00:00Z');
  const alertes: Array<{ module: string } & AlertIn & { id: string }> = [], vues: string[] = [];
  const hote: HoteAutomatismes = {
    dir, now: () => now, modules: () => [], ctx: () => ({}) as never,
    alert: (module, a) => { const x = { module, ...a, id: `a${alertes.length + 1}` }; alertes.push(x); return x; },
    ack: (ids) => { vues.push(...ids); },
    act: async () => ({ ok: true, text: '' }),
  };
  const A = new Automatismes(hote);
  return { dir, A, alertes, vues, get now() { return now; }, set now(d: Date) { now = d; }, fin: () => rmSync(dir, { recursive: true, force: true }) };
}
const QUI = 'le propriétaire (essai)';
const nonProtege: LienACouper = { id: 'frigg-runes-fiche-client', nom: 'Chronos → Papyrus', de: 'frigg', protege: false, qui: QUI };
const protege: LienACouper = { id: 'capteur-geri', nom: 'Méduse → Asclépios', de: 'geri', protege: { raison: 'le signal aide Asclépios à reconnaître une attaque' }, qui: QUI };

test('un lien qui ne protège pas : confirmation, coupé jusqu\'à ce qu\'on le rétablisse, journalisé', () => {
  const b = banc();
  try {
    const sans = couperLien(nonProtege, true) as { ok: boolean; code?: string; confirm?: string };
    assert.equal(sans.ok, false); assert.equal(sans.code, 'accord'); assert.match(sans.confirm ?? '', /jusqu'à ce que tu le rétablisses/);
    assert.equal(lienCoupe('frigg-runes-fiche-client'), false, 'sans confirmation, rien n\'est coupé');
    const r = couperLien(nonProtege, true, { confirme: true, jusqua: new Date(b.now.getTime() + 3600_000).toISOString() }) as { ok: boolean; coupe?: { jusqua?: string } };
    assert.equal(r.ok, true); assert.equal(r.coupe?.jusqua, undefined, 'pas de fin : il reste coupé');
    assert.equal(lienCoupe('frigg-runes-fiche-client'), true);
    b.now = new Date(b.now.getTime() + 30 * 86_400_000);
    assert.equal(lienCoupe('frigg-runes-fiche-client'), true, 'toujours coupé un mois plus tard');
    assert.equal(b.alertes.length, 1); assert.equal(b.alertes[0].level, 'moyenne');
    assert.equal(couperLien(nonProtege, false).ok, true);
    assert.equal(lienCoupe('frigg-runes-fiche-client'), false);
    assert.deepEqual(b.vues, ['a1'], 'au rétablissement, l\'alerte est vue');
    assert.deepEqual(journalLiens().map((g) => [g.lien, g.geste, g.par]), [['frigg-runes-fiche-client', 'coupé', QUI], ['frigg-runes-fiche-client', 'rétabli', QUI]]);
    assert.ok(journalLiens().every((g) => !Number.isNaN(Date.parse(g.at))), 'chaque geste a son heure');
    // Relu au redémarrage : le journal est sur le disque, dans automatismes.json.
    const e = JSON.parse(readFileSync(join(b.dir, 'automatismes.json'), 'utf8'));
    assert.equal(e.journal.length, 2);
  } finally { b.fin(); }
});

test('un lien qui protège : la confirmation cite sa raison, alerte haute, 1 h par défaut, 24 h au plus, se rétablit seul', () => {
  const b = banc();
  try {
    const sans = couperLien(protege, true) as { ok: boolean; code?: string; confirm?: string };
    assert.equal(sans.code, 'accord'); assert.match(sans.confirm ?? '', /Ce lien protège : le signal aide Asclépios à reconnaître une attaque/);
    assert.equal(b.alertes.length, 0);
    const r = couperLien(protege, true, { confirme: true }) as { ok: boolean; coupe?: { jusqua?: string } };
    assert.equal(r.ok, true); assert.equal(Date.parse(r.coupe!.jusqua!) - b.now.getTime(), 3600_000, '1 h par défaut');
    assert.equal(b.alertes.length, 1); assert.equal(b.alertes[0].level, 'haute'); assert.equal(b.alertes[0].module, 'geri');
    // Renouvelé, avec 48 h demandées : 24 h au plus ; l'alerte d'avant est vue, une nouvelle la remplace.
    const r2 = couperLien(protege, true, { confirme: true, jusqua: new Date(b.now.getTime() + 48 * 3600_000).toISOString() }) as { coupe?: { jusqua?: string } };
    assert.equal(Date.parse(r2.coupe!.jusqua!) - b.now.getTime(), 24 * 3600_000);
    assert.deepEqual(b.vues, ['a1']); assert.equal(b.alertes.length, 2);
    // Couper, rétablir, recouper dans la même minute : deux alertes de plus, chacune avec sa propre clé.
    couperLien(protege, false); couperLien(protege, true, { confirme: true });
    assert.equal(b.alertes.length, 3);
    assert.equal(new Set(b.alertes.map((a) => a.key)).size, 3, 'chaque coupure a sa propre clé d\'alerte');
    // Une fin dans le passé est refusée.
    assert.equal((couperLien(protege, true, { confirme: true, jusqua: new Date(b.now.getTime() - 1).toISOString() }) as { code?: string }).code, 'invalide');
    // L'échéance : rétabli tout seul, l'alerte vue, le geste journalisé.
    b.now = new Date(b.now.getTime() + 3600_000 + 1);
    assert.equal(lienCoupe('capteur-geri'), false);
    assert.ok(b.vues.includes('a3'));
    assert.equal(journalLiens().at(-1)?.geste, 'rétabli'); assert.match(journalLiens().at(-1)!.par, /fin de la durée/);
  } finally { b.fin(); }
});

test('la pause ne coupe un lien que par couperLien : un appel direct (une action d\'appli, v.act) est refusé', async () => {
  const home = mkdtempSync(join(tmpdir(), 'liens-coupes-act-'));
  // Une appli dont l'action essaie de couper un lien par la pause du registre, avec la confirmation.
  let v: Valhalla | undefined;
  const essaie: Module = { id: 'gna', name: 'Essai', family: 'Maison', what: 'essai', does: [], from: [], upstream: [], words: [], view: () => ({ sections: [] }),
    actions: [{ id: 'couper', label: 'Couper', what: 'essai', input: {}, run: () => {
      const r = v!.automatismes.pause('lien:frigg-runes-fiche-client', true, { confirme: true }) as { ok: boolean; error?: string };
      const r2 = v!.automatismes.pause('lien:capteur-geri', false) as { ok: boolean };
      return { ok: r.ok || r2.ok, text: r.error ?? '' };
    } }] } as unknown as Module;
  v = new Valhalla(home, [essaie], {});
  try {
    const r = await v.act('gna', 'couper', {}, { by: 'toi' });
    assert.equal(r.ok, false); assert.match(r.text, /que depuis la page/);
    assert.equal(lienCoupe('frigg-runes-fiche-client'), false);
    assert.equal(v.automatismes.journalLiens().length, 0);
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('un état de pause abîmé ou illisible ne coupe RIEN', () => {
  const ids = ['frigg-runes-fiche-client', 'capteur-geri', 'capteur-garmr', 'naglfar-soin-relance-conteneur', 'skogul-ullr-processus-suspect', 'ymir-soin-relance-machine', 'idunn-soin-essai-deploiement'];
  const fin = new Date('2026-11-17T11:00:00Z').toISOString(), depuis = '2026-11-17T09:00:00Z';
  const abimes = [
    '{ ceci n\'est pas du JSON',
    JSON.stringify({ pauses: 'lien:capteur-geri' }),
    JSON.stringify({ pauses: {
      'lien:frigg-runes-fiche-client': 'coupé',
      'lien:capteur-geri': { depuis, protege: true, lien: true }, // protège mais sans fin
      'lien:capteur-garmr': { depuis, jusqua: '2026-11-25T00:00:00Z', protege: true, lien: true }, // plus de 24 h
      'lien:naglfar-soin-relance-conteneur': { depuis: 'hier', protege: false, lien: true },
      'lien:skogul-ullr-processus-suspect': { depuis, jusqua: 'bientôt', protege: true, lien: true },
      'lien:ymir-soin-relance-machine': { depuis, jusqua: fin }, // ni marque, ni « protège »
      'lien:idunn-soin-essai-deploiement': { depuis, protege: 'non', lien: true },
    } }),
  ];
  for (const f of abimes) {
    const b = banc(f);
    try { for (const id of ids) assert.equal(lienCoupe(id), false, `${f.slice(0, 40)} : ${id}`); } finally { b.fin(); }
  }
  // Témoin : le même fichier, en règle, coupe bien.
  const b = banc(JSON.stringify({ pauses: { 'lien:capteur-geri': { depuis, jusqua: fin, protege: true, lien: true }, 'lien:frigg-runes-fiche-client': { depuis, protege: false, lien: true } } }));
  try { assert.equal(lienCoupe('capteur-geri'), true); assert.equal(lienCoupe('frigg-runes-fiche-client'), true); assert.deepEqual(etatLien('capteur-geri'), { depuis, jusqua: fin }); } finally { b.fin(); }
});

test('une coupure abîmée ne reste pas affichée : son entrée est retirée, son alerte vue, le geste journalisé', async () => {
  const depuis = '2026-11-17T09:00:00Z';
  const b = banc(JSON.stringify({ pauses: {
    'lien:capteur-geri': { depuis, protege: true, lien: true, alerte: 'x7' }, // protège mais sans fin
    'lien:frigg-runes-fiche-client': { depuis: 'hier', protege: false, lien: true, alerte: 'x8' },
  } }));
  try {
    // L'horloge du registre (30 s) passe : rien n'est coupé, et Odin ne le dit plus.
    await b.A.verifierDus();
    assert.equal(lienCoupe('capteur-geri'), false); assert.equal(lienCoupe('frigg-runes-fiche-client'), false);
    assert.deepEqual([...b.vues].sort(), ['x7', 'x8'], 'l\'alerte d\'une coupure abîmée est vue');
    const e = JSON.parse(readFileSync(join(b.dir, 'automatismes.json'), 'utf8'));
    assert.deepEqual(Object.keys(e.pauses), [], 'l\'entrée abîmée est retirée');
    assert.deepEqual(journalLiens().map((g) => [g.lien, g.geste]).sort(), [['capteur-geri', 'rétabli'], ['frigg-runes-fiche-client', 'rétabli']]);
  } finally { b.fin(); }
});

test('pendant le « Stop » général, un lien qui protège arrivé à sa fin se rétablit et son alerte est vue', async () => {
  const b = banc();
  brancherPauseGlobale(() => true);
  try {
    assert.equal(couperLien(protege, true, { confirme: true }).ok, true);
    b.now = new Date(b.now.getTime() + 3600_000 + 1);
    await b.A.verifierDus();
    assert.deepEqual(b.vues, ['a1'], 'l\'alerte ne reste pas jusqu\'à la fin du « Stop »');
    assert.equal(journalLiens().at(-1)?.geste, 'rétabli');
  } finally { brancherPauseGlobale(() => false); b.fin(); }
});

/** Une Valhalla réduite à ce que lit wireReflexes, qui note les actions lancées et les appels à `observe`. */
function valhallaReflexes() {
  const events = new EventEmitter(), actes: string[] = [], observes: string[] = [];
  let enCours = '';
  const v = {
    events, modules: () => [{ id: 'ullr' }],
    // observe(v.ctx('ullr'), e) lit d'abord ctx.dir : on note l'appli de l'événement et on s'arrête là.
    ctx: (id: string) => (id === 'ullr' ? { get dir(): string { observes.push(enCours); throw new Error('arrêt de l\'essai'); } } : { settings: { scenes: [{ name: 'Intrusion' }] } }),
    act: (m: string, a: string) => { actes.push(`${m}.${a}`); return Promise.resolve({ ok: true, text: '' }); },
    alert: () => undefined, autonomy: () => 'equilibre',
  };
  const emit = (module: string, type: string, data: Record<string, unknown>) => { enCours = module; events.emit('event', { module, type, data }); };
  return { v: v as never, actes, observes, emit };
}
const EVENEMENTS: Array<[string, string, string, Record<string, unknown>, string]> = [
  ['frigg-runes-fiche-client', 'frigg', 'reservation', { name: 'Nour', contact: 'x', start: '2026-11-18T10:00:00Z', service: 'coupe' }, 'runes.client'],
  ['himinbjorg-midgard-scene-intrusion', 'himinbjorg', 'mouvement', { 'caméra': 'entrée' }, 'midgard.scene'],
  ['himinbjorg-syrinx-ecoute-clip', 'himinbjorg', 'clip', { 'caméra': 'entrée', fichier: 'c.mp4' }, 'syrinx.ecouter_clip'],
  ['idunn-soin-essai-deploiement', 'idunn', 'deploiement_ok', { production: true, site: 'blog' }, 'idunn.tester'],
  ['naglfar-soin-relance-conteneur', 'naglfar', 'conteneur_arrete', { conteneur: 'web' }, 'naglfar.demarrer'],
  ['ymir-soin-relance-machine', 'ymir', 'vm_arretee', { vmid: 101 }, 'ymir.demarrer'],
  ['skogul-ullr-processus-suspect', 'skogul', 'suspect', { pid: 4242 }, 'ullr.fichier'],
];

test('wireReflexes : un lien coupé n\'agit plus, rétabli il agit ; couper un capteur ne coupe que lui', async () => {
  const b = banc(), orig = console.error; console.error = () => undefined;
  const w = valhallaReflexes(), stop = wireReflexes(w.v, { retryMs: 20 });
  try {
    for (const [id, m, type, data, acte] of EVENEMENTS) {
      const l: LienACouper = { id, nom: id, de: m, protege: LINKS.find((x) => x.id === id)!.protege ? { raison: 'essai' } : false, qui: QUI };
      assert.equal(couperLien(l, true, { confirme: true }).ok, true, id);
      w.actes.length = 0; w.emit(m, type, { ...data, n: 1 });
      assert.ok(!w.actes.includes(acte), `${id} coupé : ${acte} ne part pas`);
      couperLien(l, false);
      // Un autre objet (sinon le soin, une fois par heure, se tairait) : rétabli, le lien agit de nouveau.
      w.emit(m, type, { ...data, conteneur: 'web2', vmid: 102, site: 'blog2', pid: 4243, name: 'Lilo' });
      assert.ok(w.actes.includes(acte), `${id} rétabli : ${acte} part`);
    }
    // Les capteurs : un seul appel à observe, filtré par l'appli. Couper Méduse ne coupe que Méduse.
    const geri: LienACouper = { id: 'capteur-geri', nom: 'geri', de: 'geri', protege: { raison: 'essai' }, qui: QUI };
    couperLien(geri, true, { confirme: true });
    w.observes.length = 0;
    w.emit('geri', 'malveillant', { ip: '203.0.113.9', programme: 'x' });
    w.emit('garmr', 'banni', { ip: '203.0.113.9' });
    w.emit('loki', 'piege', { ip: '203.0.113.9' });
    assert.deepEqual(w.observes, ['garmr', 'loki']);
    couperLien(geri, false); w.observes.length = 0; w.emit('geri', 'malveillant', { ip: '203.0.113.9' });
    assert.deepEqual(w.observes, ['geri']);
    // Le doublon var → Asclépios se coupe au point du capteur de Persona.
    couperLien({ id: 'capteur-var', nom: 'var', de: 'var', protege: { raison: 'essai' }, qui: QUI }, true, { confirme: true });
    w.observes.length = 0; w.emit('var', 'verrouillage', { ip: '203.0.113.9' }); w.emit('valgrind', 'scan', { ip: '203.0.113.9' });
    assert.deepEqual(w.observes, ['valgrind']);
    // Némésis : la même coupure arrête l'analyse et son signal.
    couperLien({ id: 'skogul-ullr-processus-suspect', nom: 's', de: 'skogul', protege: { raison: 'essai' }, qui: QUI }, true, { confirme: true });
    w.observes.length = 0; w.actes.length = 0; w.emit('skogul', 'suspect', { pid: 77 });
    assert.deepEqual([w.observes, w.actes], [[], []]);
    // Phénix : coupé pendant l'attente de la relance, la relance ne part pas ; rétabli, elle part.
    const sv: LienACouper = { id: 'sindri-soin-relance-sauvegarde', nom: 's', de: 'sindri', protege: { raison: 'essai' }, qui: QUI };
    w.actes.length = 0; w.emit('sindri', 'sauvegarde_echec', { plan: 'photos' });
    couperLien(sv, true, { confirme: true });
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(!w.actes.includes('sindri.sauvegarder'), 'coupé pendant l\'attente : pas de relance');
    w.emit('sindri', 'sauvegarde_echec', { plan: 'documents' });
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(!w.actes.includes('sindri.sauvegarder'), 'coupé : pas de relance');
    couperLien(sv, false); w.emit('sindri', 'sauvegarde_echec', { plan: 'musique' });
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(w.actes.includes('sindri.sauvegarder'), 'rétabli : la relance part');
  } finally { stop(); console.error = orig; b.fin(); }
});

test('wireReflexes demande, pour chacun des 21 liens à point unique, s\'il est coupé (et pour aucun autre)', () => {
  const src = lire('valhalla/links.ts'), wire = src.slice(src.indexOf('export function wireReflexes'), src.indexOf('/** Modèles d\'automatisations'));
  const lus = new Set([...wire.matchAll(/lienCoupe\('([a-z0-9-]+)'\)/g)].map((m) => m[1]));
  if (/lienCoupe\(`capteur-\$\{m\}`\)/.test(wire)) for (const l of LINKS) if (l.id.startsWith('capteur-')) lus.add(l.id);
  const attendus = LINKS.filter((l) => 'par' in l.coupure && l.coupure.par === 'reflexe').map((l) => ('memePointQue' in l.coupure && l.coupure.memePointQue) || l.id);
  assert.equal(LINKS.filter((l) => 'par' in l.coupure && l.coupure.par === 'reflexe').length, 21);
  assert.deepEqual([...lus].sort(), [...new Set(attendus)].sort());
});

// ---------------------------------------------------------------- Qui peut couper

/** Tous les fichiers de src/ (chemin relatif, texte). */
function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = [], base = fileURLToPath(SRC);
  const tour = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) tour(p); else if (/\.(ts|js|mjs|html)$/.test(n)) out.push([relative(base, p).replace(/\\/g, '/'), readFileSync(p, 'utf8')]); } };
  tour(base); return out;
}

test('seule la route de la page importe la fonction qui coupe ; aucune action, aucun bloc, aucun outil ne la cite', () => {
  const tous = sources();
  assert.ok(tous.length > 100);
  const importent = tous.filter(([, t]) => /import[^;]*\bcouperLien\b[^;]*from/.test(t)).map(([f]) => f);
  assert.deepEqual(importent, ['web/talos-api.ts'], 'un fichier autre que la route de la page importe couperLien');
  const citent = tous.filter(([, t]) => /\bcouperLien\b/.test(t)).map(([f]) => f).sort();
  assert.deepEqual(citent, ['valhalla/automatismes.ts', 'web/talos-api.ts']);
  // Ni une appli, ni un bloc de Talos, ni un outil de l'agent ne vise la pause d'un lien.
  for (const [f, t] of tous) if (/^(valhalla\/modules|valhalla\/[a-z]+\/|draupnir|tools|core|mcp|brain)\//.test(f) && f !== 'valhalla/automatismes.ts') {
    assert.doesNotMatch(t, /automatisme\/pause|pause\(\s*['`]lien:/, f);
  }
  // La route ne coupe qu'avec la session du propriétaire, que server.ts calcule (jamais avec la clé d'accès).
  const api = lire('web/talos-api.ts');
  assert.match(api, /if \(o\.sessionProprio !== true\) return ko\('interdit'/);
  const srv = lire('web/server.ts');
  const m = /draupnirPost\(this\.odin, url\.pathname, body, \{ sessionProprio: ([^}]+) \}\)/.exec(srv);
  assert.ok(m, 'server.ts donne sessionProprio à draupnirPost');
  assert.match(m![1], /this\.who\(req\) === 'session'/); assert.match(m![1], /this\.accounts\.valid\(this\.sessionOf\(req\)\)/);
  assert.match(m![1], /!req\.headers\.authorization/); assert.match(m![1], /url\.search === ''/);
});

const lienDe = (body: Record<string, unknown>, id: string) => (body.liens as Array<{ id: string; coupe?: unknown; coupable: boolean }>).find((x) => x.id === id)!;

test('la route : le propriétaire coupe et rétablit ; la clé d\'accès, un membre, un invité, sans session, une automatisation : refusés', { timeout: 120_000 }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => undefined;
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'brisingamen'].includes(m.id)) }), va = valhallaOf()!;
    tt.onEnd(startDraupnir(v.o, async () => undefined));
    relierProprietaire(va.ctx('var'));
    const ID = 'lien:capteur-geri', P = '/api/draupnir/automatisme/pause';
    const coupe = async () => lienDe((await v.json('/api/draupnir/automatismes')).body, ID).coupe;
    // Le propriétaire, par sa session : accord (la raison), puis coupé, puis rétabli.
    const a = await v.json(P, { id: ID, pause: true });
    assert.equal(a.body.code, 'accord', JSON.stringify(a.body)); assert.match(String(a.body.confirm), /Ce lien protège/);
    assert.equal(await coupe(), undefined);
    const c = await v.json(P, { id: ID, pause: true, confirme: true });
    assert.equal(c.body.ok, true, JSON.stringify(c.body));
    assert.ok((await coupe()) as { jusqua?: string } | undefined, 'coupé');
    assert.equal((await v.json(P, { id: ID, pause: false })).body.ok, true);
    assert.equal(await coupe(), undefined, 'rétabli');
    // Un lien qui n'est pas à point unique ne se coupe pas d'ici, même par le propriétaire.
    assert.equal((await v.json(P, { id: 'lien:loki-garmr-bannir-pirate', pause: true, confirme: true })).body.ok, false);
    const tentatives: Array<[string, Promise<{ status: number; body: Record<string, unknown> }>]> = [
      ['clé d\'accès en Bearer', v.json(P, { id: ID, pause: true, confirme: true }, { authorization: `Bearer ${v.token}` })],
      ['session + clé en Bearer', v.json(P, { id: ID, pause: true, confirme: true }, { cookie: v.session, authorization: `Bearer ${v.token}` })],
      ['session + clé en paramètre', v.json(`${P}?token=${v.token}`, { id: ID, pause: true, confirme: true })],
      ['session + clé en X-API-Key', v.json(P, { id: ID, pause: true, confirme: true }, { cookie: v.session, 'x-api-key': v.token })],
      ['sans session', v.json(P, { id: ID, pause: true, confirme: true }, { cookie: '' })],
    ];
    for (const [quoi, p] of tentatives) {
      const r = await p;
      assert.notEqual(r.body.ok, true, `${quoi} : refusé (${r.status} ${JSON.stringify(r.body).slice(0, 120)})`);
      assert.equal(await coupe(), undefined, `${quoi} : rien n'est coupé`);
    }
    // Rétablir non plus, avec la clé : couper par le propriétaire, essayer de rétablir avec la clé.
    await v.json(P, { id: ID, pause: true, confirme: true });
    assert.notEqual((await v.json(P, { id: ID, pause: false }, { authorization: `Bearer ${v.token}` })).body.ok, true);
    assert.ok(await coupe(), 'toujours coupé');
    await v.json(P, { id: ID, pause: false });
    // Une automatisation (créée puis exécutée, comme le ferait l'agent) : un bloc d'appel web vers cette route, avec la clé.
    // Deux gardes la refusent : le bloc ne vise pas Odin lui-même (il peut s'arrêter là), et la route refuse la clé
    // d'accès (prouvé à part ci-dessus, en Bearer, en paramètre et en X-API-Key). Ici, on vérifie le résultat : rien n'est coupé.
    const flux: Workflow = { id: 'w', name: 'Essai', active: false, nodes: [
      { id: '1', name: 'Go', type: 'déclencheur.manuel', params: {} },
      { id: '2', name: 'Appel', type: 'web.requête', params: { url: `${v.url}${P}`, méthode: 'POST', identifiant: 'ODIN_CLE', entêtes: { 'x-odin': '1', 'content-type': 'application/json' }, corps: JSON.stringify({ id: ID, pause: true, confirme: true }) } },
    ], connections: { Go: [[{ node: 'Appel' }]] } } as never;
    await execute(flux, CATALOG, { secret: (n: string) => (n === 'ODIN_CLE' ? v.token : undefined), fetch: globalThis.fetch } as never);
    assert.equal(await coupe(), undefined, 'une automatisation ne coupe pas un lien');
    // Un membre de la famille (avec sa session) et un invité (sans) : refusés.
    for (const [login, groupe] of [['nour', 'famille'], ['lilo', 'invite']]) {
      const mdp = `${login}-ciel-de-sable-sous-la-pluie-27`;
      assert.equal((await va.act('var', 'ajouter', { login, nom: login, groupes: groupe, email: `${login}@exemple.yt`, mot_de_passe: mdp })).ok, true);
      let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' });
      const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
      r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: login, motdepasse: mdp }) });
      r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' });
      const cookie = r.headers.getSetCookie().find((x) => x.startsWith('odin_session='))?.split(';')[0] ?? '';
      if (groupe === 'famille') assert.ok(cookie, `${login} a une session`);
      const m = await v.json(P, { id: ID, pause: true, confirme: true }, { cookie });
      assert.notEqual(m.body.ok, true, `${login} (${groupe}) : refusé (${m.status})`);
      assert.equal(await coupe(), undefined, `${login} : rien n'est coupé`);
    }
  } finally { Object.assign(console, orig); await tt.end(); }
});

test('la page : un interrupteur sur les 21 liens seulement, « coupé jusqu\'à », « Rétablir »', () => {
  const win: Record<string, any> = {};
  const code = lire('web/pages/talos-automatismes.js');
  vm.runInNewContext(code, { window: win });
  const L = win.OdinAutomatismes.logique;
  assert.equal(L.etatCoupe({ coupable: true }), '');
  assert.equal(L.etatCoupe({ coupable: true, coupe: { depuis: '2026-11-17T10:00:00Z' } }), 'Coupé');
  assert.match(L.etatCoupe({ coupable: true, coupe: { depuis: '2026-11-17T10:00:00Z', jusqua: '2026-11-17T11:00:00Z' } }), /^Coupé jusqu'à /);
  const f = /function ligneLien\(l\) \{[\s\S]*?\n {2}\}/.exec(code)?.[0] ?? '';
  assert.match(f, /l\.coupable \? interrupteur\(l\)/, 'l\'interrupteur seulement sur un lien coupable');
  assert.match(f, /phraseCoupure\(l\.coupure\)/, 'les autres gardent leur phrase');
  const g = /function interrupteur\(l\) \{[\s\S]*?\n {2}\}/.exec(code)?.[0] ?? '';
  assert.match(g, /role: 'switch'/); assert.match(g, /'aria-checked'/); assert.match(g, /Rétablir/);
  assert.match(code, /\.au-sw\{[^}]*min-height:44px/);
});
