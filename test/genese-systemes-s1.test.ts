// Genèse · Systèmes, lot S1 (côté serveur) : l'action en lecture « systemes » réunit la bibliothèque d'ISO d'Hydre
// (bibliotheque_iso) et l'état d'Andromède (téléchargements en cours, versions plus récentes, fichiers jetés pour une
// empreinte fausse). Chaque carte a son état VRAI ; rien n'est écrit ; seul le propriétaire la lit (ni un membre, ni une
// automatisation, ni la clé d'API, ni une tablette « maison »). Données fausses, dossiers temporaires neufs, aucun réseau.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as T from '../src/valhalla/modules/thjalfi.ts';
import type { Module, ModCtx } from '../src/valhalla/types.ts';

const X = T as unknown as Record<string, any>;
const G = 1024 ** 3;
const dossiers: string[] = [];
const neuf = (n: string) => { const d = mkdtempSync(join(tmpdir(), `odin-s1-${n}-`)); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const NOW = new Date(2026, 10, 23, 12, 0).getTime();
const fiche = (nom: string, o: Record<string, unknown> = {}) => ({ id: nom, nom, chemin: `E:\\ISO\\${nom}`, taille: 5 * G, ajoute: 1, origine: 'andromede', antivirus: { at: 1, verdict: 'sain', texte: '' }, sha256: 'a'.repeat(64), editeur: true, ...o });
const FICHES = [
  fiche('ubuntu-24.04.1-desktop-amd64.iso', { systeme: 'Linux', detail: 'Ubuntu 24.04.1', version: '24.04.1', edition: 'bureau', taille: 5.8 * G }),
  fiche('Win11_24H2_French_x64.iso', { systeme: 'Windows', detail: 'Windows 11', edition: 'Pro', taille: 5.4 * G }),
  fiche('ubuntu-24.04.1-live-server-amd64.iso', { systeme: 'Linux', detail: 'Ubuntu Server 24.04.1', edition: 'serveur', taille: 2.6 * G }),
  fiche('Fedora-Workstation-Live-x86_64-41.iso', { systeme: 'Linux', detail: 'Fedora 41', antivirus: { at: 1, verdict: 'non analysé', texte: '' }, sha256: undefined, editeur: undefined, taille: 2.2 * G }),
  fiche('gparted-live-1.6.0-amd64.iso', { systeme: 'Autre', detail: 'GParted Live 1.6.0', editeur: false, taille: 0.6 * G }),
  fiche('debian-12.7.0-amd64-DVD-1.iso', { systeme: 'Linux', detail: 'Debian 12.7.0', ancienne: true, taille: 3.7 * G }),
];
const IMAGES = [
  { id: 'ubuntu-24-04-1-desktop-amd64', chemin: 'E:/ISO/ubuntu-24.04.1-desktop-amd64.iso', demarre: true, prete: true },
  { id: 'win11-24h2-french-x64', chemin: 'e:/iso/Win11_24H2_French_x64.iso', demarre: true, prete: true },
  { id: 'ubuntu-24-04-1-live-server-amd64', chemin: 'E:/ISO/ubuntu-24.04.1-live-server-amd64.iso', demarre: true, prete: true },
  { id: 'fedora-workstation-live-x86-64-41', chemin: 'E:/ISO/Fedora-Workstation-Live-x86_64-41.iso', demarre: true, prete: false },
  { id: 'gparted-live-1-6-0-amd64', chemin: 'E:/ISO/gparted-live-1.6.0-amd64.iso', demarre: false, prete: true },
];
const DISPOS = [{ chemin: 'E:\\ISO\\ubuntu-24.04.1-desktop-amd64.iso', etat: 'nouvelle version', derniere: '24.04.2', source: 'ubuntu-desktop' }, { chemin: 'E:\\ISO\\Win11_24H2_French_x64.iso', etat: 'à jour', source: 'windows-11' }];
const SURV = [
  { id: 'debian', nom: 'Debian', derniere: '12.8.0', presents: ['12.7.0'], enCours: { recu: 2.3 * G, total: 3.7 * G, pct: 62 } },
  { id: 'linux-mint', nom: 'Linux Mint', derniere: '22', presents: [] },
  { id: 'ubuntu-desktop', nom: 'Ubuntu', derniere: '24.04.2', presents: ['24.04.1'] },
];
const HIST = [
  '- 23/11/2026 11:02:10 · nouvelle version · Debian 12.8.0 · tu as 12.7.0',
  '- 23/11/2026 10:40:00 · empreinte fausse · Linux Mint 22 · l\'empreinte ne correspond pas à celle publiée par l\'éditeur',
  '- 23/11/2026 10:39:00 · nouvelle version · Linux Mint 22 · pas encore dans le dossier',
  '- 22/11/2026 10:00:00 · téléchargé · Ubuntu 24.04.1 · 5,8 Go',
  '- 22/11/2026 09:00:00 · empreinte fausse · Ubuntu 24.04.1 · ancienne',
].join('\n');
// L'historique d'Andromède rend les lignes du plus récent au plus ancien : Ubuntu, jeté le 22 à 9 h, a été retéléchargé
// à 10 h (plus de carte « empreinte fausse ») ; Linux Mint, jeté ce matin, l'est encore.
const assembler = (o: Record<string, unknown> = {}) => X.assemblerSystemes({ fiches: FICHES, images: IMAGES, disponibles: DISPOS, surveilles: SURV, historique: HIST, place: { total: 1024 * G, libre: 900 * G }, now: NOW, ...o });
const carte = (d: { cartes: Array<Record<string, any>> }, re: RegExp) => d.cartes.find((c) => re.test(`${c.nom} ${c.version ?? ''}`.trim()))!;

test('S1 · chaque carte a son état vrai : prêt (empreinte de l\'éditeur, antivirus propre), mise à jour, vérification', () => {
  assert.equal(typeof X.assemblerSystemes, 'function', 'assemblerSystemes exporté par modules/thjalfi.ts');
  const d = assembler();
  const u = carte(d, /^Ubuntu 24\.04\.1$/);
  assert.equal(u.etat, 'pret'); assert.equal(u.empreinte, 'editeur'); assert.equal(u.antivirus, 'propre');
  assert.deepEqual(u.maj, { version: '24.04.2', source: 'ubuntu-desktop' }, 'mise à jour disponible (Andromède)');
  assert.equal(u.deployable, true); assert.equal(u.iso, 'ubuntu-24-04-1-desktop-amd64', 'l\'image que connaît la clé USB');
  assert.equal(u.famille, 'linux'); assert.equal(u.genre, 'bureau');
  const w = carte(d, /^Windows 11/);
  assert.equal(w.famille, 'windows'); assert.equal(w.maj, undefined, 'à jour : pas de mise à jour'); assert.equal(w.deployable, true, 'chemin Windows lu sans tenir compte de la casse ni des barres');
  const f = carte(d, /^Fedora/);
  assert.equal(f.etat, 'verification'); assert.equal(f.antivirus, 'en_cours'); assert.equal(f.deployable, false); assert.equal(f.raison, 'verification');
  assert.equal(f.empreinte, undefined, 'pas d\'empreinte avant la vérification');
  const g = carte(d, /^GParted/);
  assert.equal(g.famille, 'outil'); assert.equal(g.empreinte, 'calculee', 'l\'éditeur ne publie pas d\'empreinte : notée par Odin');
  assert.equal(g.deployable, false, 'Odin ne sait pas la démarrer'); assert.equal(g.raison, 'inconnu');
  assert.equal(carte(d, /^Ubuntu Server/).famille, 'serveur');
  assert.ok(!d.cartes.some((c: Record<string, unknown>) => /12\.7\.0/.test(String(c.nom))), 'l\'ancienne version (old) n\'a pas de carte');
});

test('S1 · téléchargement en cours (progression), empreinte fausse (fichier jeté), empreinte changée, antivirus', () => {
  const d = assembler();
  const deb = d.cartes.find((c: Record<string, any>) => c.etat === 'telechargement');
  assert.ok(deb, 'carte du téléchargement en cours');
  assert.equal(deb.nom, 'Debian'); assert.equal(deb.version, '12.8.0'); assert.equal(deb.source, 'debian');
  assert.deepEqual(deb.telechargement, { recu: 2.3 * G, total: 3.7 * G, pct: 62 }); assert.equal(deb.deployable, false);
  const mint = d.cartes.find((c: Record<string, any>) => c.etat === 'empreinte_fausse');
  assert.ok(mint, 'carte « empreinte fausse : fichier jeté »');
  assert.equal(mint.nom, 'Linux Mint'); assert.equal(mint.version, '22'); assert.equal(mint.source, 'linux-mint'); assert.equal(mint.deployable, false);
  assert.match(mint.pourquoi, /empreinte/);
  assert.equal(d.cartes.filter((c: Record<string, any>) => c.etat === 'empreinte_fausse').length, 1, 'Ubuntu, jeté puis retéléchargé : plus de carte « jeté »');
  // Un fichier jeté il y a plus de 14 jours n'est plus montré ; un fichier qui se retélécharge non plus.
  assert.equal(X.assemblerSystemes({ fiches: [], images: [], disponibles: [], surveilles: SURV, historique: HIST, now: NOW + 30 * 864e5 }).cartes.filter((c: Record<string, any>) => c.etat === 'empreinte_fausse').length, 0);
  const encore = X.assemblerSystemes({ fiches: [], images: [], disponibles: [], surveilles: [{ ...SURV[1], enCours: { recu: 1, total: 10, pct: 10 } }], historique: HIST, now: NOW });
  assert.ok(!encore.cartes.some((c: Record<string, any>) => c.etat === 'empreinte_fausse' && c.source === 'linux-mint'));
  // Retéléchargé après : plus jeté.
  const apres = X.jetesDeLHistorique(['- 23/11/2026 11:00:00 · téléchargé · Linux Mint 22 · 2,8 Go', '- 23/11/2026 10:40:00 · empreinte fausse · Linux Mint 22 · x'].join('\n'), SURV, NOW);
  assert.deepEqual(apres, []);
  const ab = X.assemblerSystemes({ fiches: [fiche('a.iso', { systeme: 'Linux', detail: 'Arch Linux 2026.11.01', verifiee: { at: 1, ok: false, texte: 'abîmé' } }), fiche('b.iso', { systeme: 'Linux', detail: 'Kali 2026.3', antivirus: { at: 1, verdict: 'à vérifier', texte: '' } }), fiche('c.iso', { systeme: 'Linux', detail: 'Alpine 3.21', antivirus: { at: 1, verdict: 'bloqué', texte: '' } })], images: [], disponibles: [], surveilles: [], historique: '', now: NOW });
  assert.equal(ab.cartes[0].empreinte, 'changee'); assert.equal(ab.cartes[1].antivirus, 'a_verifier'); assert.equal(ab.cartes[2].etat, 'bloque'); assert.equal(ab.cartes[2].deployable, false);
});

test('S1 · les quatre chiffres : prêts, en cours (téléchargement + vérification), place, mises à jour', () => {
  const d = assembler();
  assert.equal(d.chiffres.prets, 3, 'Ubuntu, Windows, Ubuntu Server');
  assert.equal(d.chiffres.enCours, 2, 'Debian qui se télécharge, Fedora qui se vérifie');
  assert.deepEqual(d.chiffres.premier, { nom: 'Debian', pct: 62 });
  assert.equal(d.chiffres.majs, 1);
  assert.equal(d.place.total, 1024 * G);
  assert.equal(Math.round(d.place.utilise / G * 10), Math.round((5.8 + 5.4 + 2.6 + 2.2 + 0.6 + 3.7) * 10), 'tout le dossier des ISO (anciennes comprises)');
  const vide = X.assemblerSystemes({ fiches: [], images: [], disponibles: [], surveilles: [], historique: '', now: NOW });
  assert.deepEqual(vide.chiffres, { prets: 0, enCours: 0, majs: 0 });
});

// ------------------------------------------------------------------ l'action, par la vraie porte
/** Hydre et Andromède d'essai : les mêmes actions (lecture), données fausses ; tout appel est noté. */
function faux(appels: string[]): Module[] {
  const m = (id: string, acts: Record<string, (i: Record<string, unknown>) => { text: string; data?: unknown }>) => ({ id, name: id, family: 'Essai', what: 'essai', does: [], from: [], upstream: [], words: [],
    actions: Object.entries(acts).map(([aid, run]) => ({ id: aid, label: aid, what: aid, read: true, run: async (_c: unknown, i: Record<string, unknown>) => { appels.push(`${id}.${aid}`); return run(i); } })) }) as unknown as Module;
  return [
    m('ymir', { bibliotheque_iso: () => ({ text: 'x', data: { dossier: '', isos: FICHES } }) }),
    m('eitri', { disponibles: () => ({ text: 'x', data: { fichiers: DISPOS } }), surveilles: () => ({ text: 'x', data: { surveilles: SURV } }), historique: () => ({ text: HIST }) }),
  ];
}

test('S1 · « systemes » : action en lecture, propriétaire seul ; elle n\'écrit rien et n\'appelle que des lectures', async () => {
  const a = X.thjalfi().actions.find((x: Record<string, unknown>) => x.id === 'systemes');
  assert.ok(a, 'action systemes dans Genèse');
  assert.equal(a.read, true); assert.equal(a.proprietaireSeul, true); assert.equal(a.grave, undefined);
  const { Valhalla } = await import('../src/valhalla/service.ts');
  const appels: string[] = [], home = neuf('va');
  const v = new Valhalla(home, [X.thjalfi(), ...faux(appels)], { fetch: (async () => { throw new Error('aucun réseau'); }) as never, run: async () => ({ code: 1, out: '', err: 'aucune commande' }), notify: async () => {} });
  try {
    await v.activer('thjalfi', true);
    const fichiers = () => JSON.stringify(readdirSync(home, { recursive: true }).map(String).filter((f) => statSync(join(home, f)).isFile()).sort());
    const avant = fichiers();
    const r = await v.act('thjalfi', 'systemes', {});
    assert.equal(r.ok, true, r.text);
    const d = r.data as { cartes: Array<Record<string, unknown>>; chiffres: Record<string, unknown> };
    assert.ok(d.cartes.some((c) => c.etat === 'telechargement') && d.cartes.some((c) => c.etat === 'empreinte_fausse') && d.cartes.some((c) => c.maj));
    for (const x of appels) assert.match(x, /^(ymir\.bibliotheque_iso|eitri\.(disponibles|surveilles|historique))$/, `seulement des lectures : ${x}`);
    assert.equal(fichiers(), avant, 'aucun fichier écrit');
    // Ni un membre, ni une automatisation, ni un autre assistant, ni Odin seul.
    for (const qui of [{ qui: 'member' as const }, { qui: 'guest' as const }, { auto: true }, { by: 'automatisation' as const }, { by: 'odin' as const }]) {
      const n = await v.act('thjalfi', 'systemes', {}, qui);
      assert.equal(n.ok, false, JSON.stringify(qui)); assert.match(n.text, /propriétaire/);
      assert.equal(n.data, undefined, 'rien ne fuit');
    }
    // La clé d'API (sans la session du propriétaire) : refusée à la porte.
    const { setValhalla } = await import('../src/valhalla/odin.ts');
    const { valhallaPost } = await import('../src/web/valhalla-api.ts');
    setValhalla(v);
    const api = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action: 'systemes', input: {} }) as { ok: boolean; code?: string; data?: unknown };
    assert.equal(api.ok, false); assert.equal(api.code, 'proprietaire'); assert.equal(api.data, undefined);
    const p = await valhallaPost('/api/valhalla/act', { module: 'thjalfi', action: 'systemes', input: {} }, { sessionProprio: true }) as { ok: boolean };
    assert.equal(p.ok, true, 'depuis la session du propriétaire');
  } finally { v.stop(); }
});

test('S1 · une tablette « maison » ne lit pas les systèmes (bouton de sa page refusé)', async () => {
  const { T: Banc } = await import('./banc/lib.ts');
  const { vraiOdin } = await import('./banc/odin-vrai.ts');
  const { allModules, valhallaOf } = await import('../src/valhalla/odin.ts');
  const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const od = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['gladsheim', 'thjalfi'].includes(m.id)) });
    const va = valhallaOf()!;
    const f = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify({ pages: [{ id: 'a1b2c3d4', name: 'Maison', maison: true, widgets: [{ id: 'b0000001', kind: 'bouton', w: 1, module: 'thjalfi', action: 'systemes', label: 'Systèmes', input: {} }] }] }) });
    assert.equal(f.ok, true, f.text);
    const cle = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette entrée', droits: 'maison' })).data as { key: string }).key;
    const r = await od.json('/api/maison/fenetre', { id: 'b0000001' }, { cookie: '', 'x-odin-maison': cle });
    assert.notEqual(r.body.ok, true, JSON.stringify(r.body));
    assert.match(String(r.body.text), /propriétaire/);
    assert.equal(r.body.data, undefined);
    // Le propriétaire, depuis sa session, la lit.
    const p = await od.json('/api/valhalla/act', { module: 'thjalfi', action: 'systemes', input: {} });
    assert.equal(p.body.ok, true, JSON.stringify(p.body).slice(0, 300));
  } finally { await tt.end(); Object.assign(console, orig); }
});

void ({} as ModCtx);

// ------------------------------------------------------------------ relecture du lot S1
test('relecture S1 · historique : une autre source au nom voisin (« Windows 11 (ARM 64) ») n\'est pas prise pour « Windows 11 »', () => {
  const surv = [{ id: 'windows-11', nom: 'Windows 11', derniere: '24H2' }];
  const l = X.jetesDeLHistorique('- 23/11/2026 10:40:00 · empreinte fausse · Windows 11 (ARM 64) 24H2 · empreinte', surv, NOW);
  assert.equal(l.length, 1);
  assert.equal(l[0].source, undefined, 'pas de « Retélécharger » vers la mauvaise source');
  assert.equal(l[0].nom, 'Windows 11 (ARM 64) 24H2');
  const ok = X.jetesDeLHistorique('- 23/11/2026 10:40:00 · empreinte fausse · Windows 11 24H2 · empreinte', surv, NOW);
  assert.equal(ok[0].source, 'windows-11'); assert.equal(ok[0].version, '24H2');
});

test('relecture S1 · une image que Genèse sait démarrer mais pas encore « prête » : la raison est la vérification, pas « ne sait pas démarrer »', () => {
  const d = X.assemblerSystemes({ fiches: [FICHES[0]], images: [{ ...IMAGES[0], prete: false }], disponibles: [], surveilles: [], historique: '', now: NOW });
  assert.equal(d.cartes[0].deployable, false); assert.equal(d.cartes[0].raison, 'verification');
});
