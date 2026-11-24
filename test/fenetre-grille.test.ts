// Le modèle de la grille (lot 13 de la maquette validée de l'accueil) : un module de la fenêtre a une largeur sur
// 12 colonnes (`c`) et une hauteur en lignes (`r`), plus une taille à part pour le téléphone (`pc`, `pr`).
// Filet : rien ne change à l'écran. L'ancienne largeur `w` (1, 2 ou 3 colonnes) reste lue et rendue ; 1, 2, 3
// deviennent 4, 8, 12 (même proportion). Ce que reçoivent une tablette « maison » et un membre de la famille ne
// grandit pas. Un vrai Odin d'essai pour la dernière partie (serveur web + applis), par le même chemin que la page.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { GRILLE, MODULES_PAR_PAGE, TAILLES_MOTS, TAILLE_SORTE, cleanLayout, defaultLayout, largeurAncienne, type Widget } from '../src/valhalla/modules/gladsheim.ts';

const IDS = ['var', 'gladsheim', 'midgard', 'vidarr'];
const un = (w: Record<string, unknown>) => cleanLayout({ pages: [{ name: 'P', widgets: [w] }] }, IDS).pages[0].widgets[0] as Widget | undefined;
const TAILLES = ['w', 'c', 'r', 'pc', 'pr'];
const sansTaille = (w: Widget) => Object.fromEntries(Object.entries(w).filter(([k]) => !TAILLES.includes(k)));

// ---------------- Les bornes ----------------
test('la grille de la maquette : 12 colonnes, 4 au téléphone, 7 lignes au plus', () => {
  assert.deepEqual({ ...GRILLE }, { colonnes: 12, colonnesTel: 4, lignesMax: 7 });
  for (const [kind, t] of Object.entries(TAILLE_SORTE)) {
    assert.ok(t.mini[0] >= 1 && t.mini[0] <= 4, `${kind} : mini en largeur tenable par un ancien module d'une colonne (4 sur 12)`);
    assert.ok(t.mini[1] >= 1 && t.mini[1] <= t.r && t.r <= 7, `${kind} : hauteur de départ entre la mini et 7`);
  }
});
test('largeur sur 12 : de la mini de la sorte à 12, les valeurs hors bornes ramenées', () => {
  for (let c = 1; c <= 12; c++) assert.equal(un({ kind: 'heure', c })?.c, Math.max(c, TAILLE_SORTE.heure.mini[0]), `c = ${c}`);
  assert.equal(un({ kind: 'heure', c: 40 })?.c, 12, 'trop large : 12');
  assert.equal(un({ kind: 'heure', c: 0 })?.c, TAILLE_SORTE.heure.mini[0], 'zéro : la mini');
  assert.equal(un({ kind: 'heure', c: -5 })?.c, TAILLE_SORTE.heure.mini[0], 'négatif : la mini');
  assert.equal(un({ kind: 'meteo', c: 1 })?.c, TAILLE_SORTE.meteo.mini[0], 'plus petit que la mini de la météo : la mini');
});
test('hauteur : de la mini de la sorte à 7 lignes, les valeurs hors bornes ramenées', () => {
  for (let r = 1; r <= 7; r++) assert.equal(un({ kind: 'heure', c: 4, r })?.r, Math.max(r, TAILLE_SORTE.heure.mini[1]), `r = ${r}`);
  assert.equal(un({ kind: 'heure', c: 4, r: 30 })?.r, 7);
  assert.equal(un({ kind: 'meteo', c: 4, r: 1 })?.r, TAILLE_SORTE.meteo.mini[1]);
});
test('valeurs fausses refusées : un texte, une virgule, NaN, l\'infini, un objet ne passent pas', () => {
  for (const faux of ['6', 4.5, Number.NaN, Number.POSITIVE_INFINITY, null, true, { c: 6 }, [6]]) {
    const w = un({ kind: 'chiffres', module: 'vidarr', w: 2, c: faux, r: faux, pc: faux, pr: faux })!;
    assert.equal(w.c, 8, `c = ${String(faux)} : la largeur vient de w`);
    assert.equal(w.r, TAILLE_SORTE.chiffres.r, `r = ${String(faux)} : la hauteur de départ`);
    assert.equal('pc' in w || 'pr' in w, false, `pc, pr = ${String(faux)} : rien d'inventé pour le téléphone`);
    assert.ok(Object.values(w).every((x) => typeof x !== 'number' || Number.isInteger(x)), 'que des entiers');
  }
});
test('la largeur rendue en `w` suit la largeur sur 12 (1 à 4 → 1, 5 à 8 → 2, 9 à 12 → 3)', () => {
  assert.deepEqual(Array.from({ length: 12 }, (_, i) => largeurAncienne(i + 1)), [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
  for (let c = 1; c <= 12; c++) { const w = un({ kind: 'heure', c })!; assert.equal(w.w, largeurAncienne(w.c)); }
});

// ---------------- Un ancien rangement ----------------
const ANCIEN: { pages: Array<{ id: string; name: string; maison?: boolean; widgets: Array<Record<string, unknown>> }> } = { pages: [
  { id: 'a0000001', name: 'Maison', maison: true, widgets: [
    { id: 'b0000001', kind: 'heure', w: 1 }, { id: 'b0000002', kind: 'meteo', w: 2, label: 'Dehors' }, { id: 'b0000003', kind: 'chiffres', module: 'midgard', w: 3 },
    { id: 'b0000004', kind: 'bouton', module: 'vidarr', action: 'bloquer', input: { quoi: 'youtube' }, label: 'Bloquer', w: 2 },
    { id: 'b0000005', kind: 'section', module: 'vidarr', section: 'Appareils', w: 1 }, { id: 'b0000006', kind: 'site', module: 'vordr', label: 'Mon site', w: 3 },
  ] },
  { id: 'a0000002', name: 'Réseau', widgets: [{ id: 'b0000007', kind: 'chiffres', module: 'vidarr', w: 2 }, { id: 'b0000008', kind: 'chiffres', module: 'vidarr' }] },
] };
test('un ancien rangement (w 1, 2, 3) se relit sans rien perdre : 1, 2, 3 deviennent 4, 8, 12', () => {
  const l = cleanLayout(ANCIEN, [...IDS, 'vordr']);
  const ws = l.pages.flatMap((p) => p.widgets), avant = ANCIEN.pages.flatMap((p) => p.widgets);
  assert.deepEqual(ws.map((w) => w.id), avant.map((w) => w.id), 'aucun module perdu, même ordre');
  assert.deepEqual(ws.map((w) => w.w), [1, 2, 3, 2, 1, 3, 2, 1], 'l\'ancienne largeur reste rendue');
  assert.deepEqual(ws.map((w) => w.c), [4, 8, 12, 8, 4, 12, 8, 4], 'même proportion sur 12');
  assert.ok(ws.every((w) => w.r === TAILLE_SORTE[w.kind].r), 'la hauteur de départ de sa sorte');
  assert.ok(ws.every((w) => !('pc' in w) && !('pr' in w)), 'aucune taille de téléphone inventée');
  // Le reste, à l'identique (libellé, appli, partie de page, action, réglages).
  assert.deepEqual(ws.map(sansTaille), avant.map((w) => sansTaille(w as unknown as Widget)));
  assert.deepEqual(l.pages.map((p) => [p.id, p.name, p.maison ?? false]), [['a0000001', 'Maison', true], ['a0000002', 'Réseau', false]]);
});
test('un rangement relu se réécrit pareil (relire deux fois ne change rien)', () => {
  const une = cleanLayout(ANCIEN, [...IDS, 'vordr']), deux = cleanLayout(JSON.parse(JSON.stringify(une)), [...IDS, 'vordr']);
  assert.deepEqual(deux, une);
  const neuf = cleanLayout({ pages: [{ id: 'a0000003', name: 'N', widgets: [{ id: 'b0000009', kind: 'meteo', c: 6, r: 5, pc: 4, pr: 3 }] }] }, IDS);
  assert.deepEqual(cleanLayout(JSON.parse(JSON.stringify(neuf)), IDS), neuf);
  assert.deepEqual(neuf.pages[0].widgets[0], { id: 'b0000009', kind: 'meteo', w: 2, c: 6, r: 5, pc: 4, pr: 3 });
});
test('la largeur changée par l\'écran d\'aujourd\'hui (bouton « 1, 2 ou 3 colonnes ») l\'emporte sur une largeur sur 12 périmée', () => {
  // L'écran ne connaît que `w` : il renvoie le module avec son ancien `c` et un `w` changé.
  assert.equal(un({ kind: 'heure', c: 6, w: 3 })?.c, 12, 'w passé de 2 à 3');
  assert.equal(un({ kind: 'heure', c: 6, w: 1 })?.c, 4, 'w passé de 2 à 1');
  assert.equal(un({ kind: 'heure', c: 6, w: 2 })?.c, 6, 'w inchangé : la largeur sur 12 est gardée');
  assert.equal(un({ kind: 'heure', c: 7 })?.c, 7, 'sans w : la largeur sur 12 seule');
  assert.equal(un({ kind: 'heure', c: 6, w: 9 })?.c, 6, 'un w faux ne compte pas');
});
test('la fenêtre de départ porte déjà largeur sur 12 et hauteur', () => {
  const d = defaultLayout(['vidarr', 'ran', 'vordr', 'ullr', 'ymir', 'midgard']);
  const ws = d.pages.flatMap((p) => p.widgets);
  assert.ok(ws.length > 0);
  // Lot 26 : « À faire » et « Ce qu'Odin a fait » partent sur deux colonnes égales (6 sur 12), comme les deux blocs d'avant.
  for (const w of ws) { assert.equal(w.c, w.kind === 'a_faire' || w.kind === 'odin_a_fait' ? 6 : w.w * 4, `${w.kind} ${w.module ?? ''}`); assert.equal(w.r, TAILLE_SORTE[w.kind].r); }
  assert.deepEqual(cleanLayout(JSON.parse(JSON.stringify(d)), ['vidarr', 'ran', 'vordr', 'ullr', 'ymir', 'midgard']), d, 'relue, elle ne change pas');
});
test(`la limite de modules par page est relevée à ${MODULES_PAR_PAGE} (24 avant)`, () => {
  assert.ok(MODULES_PAR_PAGE >= 31, 'l\'écran de départ « maison » de la maquette en a 31');
  const page = (n: number) => cleanLayout({ pages: [{ name: 'P', widgets: Array.from({ length: n }, () => ({ kind: 'heure', w: 1 })) }] }, IDS).pages[0].widgets.length;
  assert.equal(page(31), 31); assert.equal(page(MODULES_PAR_PAGE), MODULES_PAR_PAGE); assert.equal(page(MODULES_PAR_PAGE + 20), MODULES_PAR_PAGE);
});

// ---------------- Le téléphone ----------------
test('téléphone : une taille à part (2 à 4 colonnes, hauteur de la mini à 7), qui ne touche pas la taille de l\'ordinateur', () => {
  const w = un({ kind: 'heure', c: 6, r: 3, pc: 2, pr: 4 })!;
  assert.deepEqual([w.c, w.r, w.pc, w.pr], [6, 3, 2, 4]);
  assert.equal(un({ kind: 'heure', c: 6, pc: 9 })?.pc, GRILLE.colonnesTel, 'trop large : 4');
  assert.equal(un({ kind: 'heure', c: 6, pc: 1 })?.pc, 2, 'une colonne : la moitié de l\'écran (2)');
  assert.equal(un({ kind: 'heure', c: 6, pr: 99 })?.pr, 7);
  assert.equal(un({ kind: 'meteo', c: 6, pr: 1 })?.pr, TAILLE_SORTE.meteo.mini[1]);
  const seul = un({ kind: 'heure', c: 6, pr: 2 })!;
  assert.equal(seul.pr, 2); assert.equal('pc' in seul, false, 'une seule des deux : l\'autre n\'est pas inventée');
  assert.equal(un({ kind: 'heure', w: 3, pc: 2 })?.c, 12, 'la taille du téléphone ne change pas la largeur de l\'ordinateur');
});

// ---------------- La table des tailles en mots (note « widgets par la parole ») ----------------
test('une seule table traduit les tailles en mots en largeurs sur 12', () => {
  const v = Object.values(TAILLES_MOTS);
  assert.deepEqual(Object.keys(TAILLES_MOTS), ['petit', 'moyen', 'grand', 'plein'], 'des codes, pas des phrases');
  assert.ok(v.every((c, i) => Number.isInteger(c) && c >= 1 && c <= 12 && (i === 0 || c > v[i - 1])), 'croissantes, dans la grille');
  assert.equal(TAILLES_MOTS.plein, GRILLE.colonnes);
  for (const c of v) assert.equal(un({ kind: 'chiffres', module: 'vidarr', c })?.c, c, 'chaque taille en mots passe le nettoyage telle quelle');
});

// ---------------- Une tablette « maison » et un membre n'obtiennent rien de plus ----------------
const MDP = 'une-barque-lente-au-bord-du-lac-62';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '', cleMaison = '';
const RANGE = { pages: [
  { id: 'c0000001', name: 'Maison', maison: true, widgets: [
    { id: 'd0000001', kind: 'heure', c: 3, r: 2, pc: 2, pr: 2 }, { id: 'd0000002', kind: 'meteo', w: 2 },
    { id: 'd0000003', kind: 'chiffres', module: 'midgard', c: 6, r: 3 }, { id: 'd0000004', kind: 'chiffres', module: 'var', c: 5, r: 2 },
  ] },
  { id: 'c0000002', name: 'Autre', widgets: [{ id: 'd0000005', kind: 'chiffres', module: 'vidarr', c: 12, r: 4 }] },
] };
const rangee = () => (valhallaOf()!.ctx('gladsheim').settings.fenetre as { pages: Array<{ widgets: Widget[] }> }).pages.flatMap((p) => p.widgets).map((w) => [w.id, w.c, w.r, w.pc, w.pr]);
before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-g', nom: 'Membre G', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-g' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer(v, 'membre-g', MDP); assert.ok(membre, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette grille', droits: 'maison' })).data as { key: string }).key;
  const r = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify(RANGE) } });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('le propriétaire range et relit largeur, hauteur et taille du téléphone', async () => {
  assert.deepEqual(rangee(), [['d0000001', 3, 2, 2, 2], ['d0000002', 8, TAILLE_SORTE.meteo.r, undefined, undefined], ['d0000003', 6, 3, undefined, undefined], ['d0000004', 5, 2, undefined, undefined], ['d0000005', 12, 4, undefined, undefined]]);
  const f = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'fenetre', input: {} });
  // Lot 26 : la page « Aujourd'hui » est lue en premier ; les pages rangées suivent, inchangées.
  const ws = (f.body.data as { pages: Array<{ code?: string; widgets: Widget[] }> }).pages.filter((p) => !p.code).flatMap((p) => p.widgets);
  assert.deepEqual(ws.map((w) => [w.w, w.c, w.r]), [[1, 3, 2], [2, 8, TAILLE_SORTE.meteo.r], [2, 6, 3], [2, 5, 2], [3, 12, 4]]);
});
test('une tablette « maison » reçoit les mêmes modules qu\'avant, avec leur taille et rien d\'autre', async () => {
  const r = await v.json('/api/maison/etat', undefined, { 'x-odin-maison': cleMaison, cookie: '' });
  assert.equal(r.status, 200); assert.equal(r.body.rights, 'maison');
  const ws = (r.body.fenetre as Array<{ id: string; widgets: Array<Record<string, unknown>> }>).flatMap((p) => p.widgets);
  // Comme avant : seulement la page « maison », sans le module d'une appli hors de la famille Maison (Persona).
  assert.deepEqual(ws.map((w) => w.id), ['d0000001', 'd0000002', 'd0000003']);
  assert.deepEqual(ws.map((w) => [w.w, w.c, w.r, w.pc, w.pr]), [[1, 3, 2, 2, 2], [2, 8, TAILLE_SORTE.meteo.r, undefined, undefined], [2, 6, 3, undefined, undefined]]);
  // Les clés d'avant (id, kind, w, title, app, kpis, section, sonde, grave), plus les tailles : rien d'autre.
  const permis = new Set(['id', 'kind', 'w', 'title', 'app', 'kpis', 'section', 'sonde', 'grave', 'c', 'r', 'pc', 'pr']);
  for (const w of ws) assert.deepEqual(Object.keys(w).filter((k) => !permis.has(k)), [], `module ${String(w.id)}`);
});
test('une tablette « maison » ne range pas la fenêtre (les tailles restent)', async () => {
  const avant = rangee();
  const r = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify({ pages: [{ id: 'c0000001', name: 'Maison', maison: true, widgets: [{ id: 'd0000001', kind: 'heure', c: 12, r: 7 }] }] }) } }, { 'x-odin-maison': cleMaison, cookie: '' });
  assert.notEqual(r.body.ok, true); assert.deepEqual(rangee(), avant);
});
test('un membre de la famille, même avec le droit sur Hestia, n\'a ni l\'état de la maison ni le rangement', async () => {
  const e = await v.json('/api/maison/etat', undefined, { cookie: membre });
  assert.ok(e.status === 401 || e.status === 403, `état de la maison : ${e.status}`);
  const avant = rangee();
  const r = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify({ pages: [{ id: 'c0000001', name: 'Maison', maison: true, widgets: [{ id: 'd0000001', kind: 'heure', c: 12, r: 7, pc: 4, pr: 7 }] }] }) } }, { cookie: membre });
  assert.notEqual(r.body.ok, true); assert.deepEqual(rangee(), avant, 'tailles inchangées');
});
