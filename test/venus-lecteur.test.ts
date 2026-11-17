// Le lecteur de Vénus (src/web/pages/venus-lecteur.js) sur un film que le navigateur ne lit pas tel quel (converti à la
// volée par Odin) : la barre de temps montre la durée ENTIÈRE connue d'Odin, un saut redemande le flux à partir de la
// position voulue (?depuis=), le temps affiché vaut position demandée + temps écoulé, les sous-titres suivent le
// décalage et la reprise garde la vraie position. Un film lu tel quel par le navigateur ne change pas (contrôles du
// navigateur, aucune barre à part). Sans navigateur : logique pure, puis un faux document minimal.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../src/web/pages/venus-lecteur.js', import.meta.url), 'utf8');
type Fn = (...a: unknown[]) => unknown;

// ---------------- Un faux document, juste ce que le lecteur utilise ----------------
class FNode { textContent = ''; parent: FEl | null = null; }
class FEl extends FNode {
  tagName: string; children: FNode[] = []; attrs: Record<string, string> = {}; style: Record<string, string> = {};
  className = ''; hidden = false; ecoute: Record<string, Array<(e: unknown) => void>> = {};
  // propriétés d'un <video> / <input> / <track> (sans effet ici)
  controls = false; src = ''; currentTime = 0; duration = NaN; paused = true; muted = false; value = ''; disabled = false;
  textTracks: unknown[] = []; track: unknown = null;
  constructor(tag: string) { super(); this.tagName = tag.toUpperCase(); }
  // Comme un vrai navigateur : l'attribut reflète la propriété (controls, src, hidden).
  setAttribute(k: string, v: string) { this.attrs[k] = v; if (k === 'hidden') this.hidden = true; if (k === 'controls') this.controls = true; if (k === 'src') this.src = v; }
  removeAttribute(k: string) { delete this.attrs[k]; if (k === 'src') this.src = ''; }
  addEventListener(t: string, f: (e: unknown) => void) { (this.ecoute[t] ||= []).push(f); }
  append(...k: FNode[]) { for (const c of k) { c.parent = this; this.children.push(c); } }
  prepend(...k: FNode[]) { for (const c of k.reverse()) { c.parent = this; this.children.unshift(c); } }
  insertBefore(n: FNode, ref: FNode) { n.parent = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, n); }
  replaceChildren(...k: FNode[]) { this.children = []; this.append(...k); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  pleinEcran = 0; refuserLecture = false;
  requestFullscreen() { this.pleinEcran++; return Promise.resolve(); }
  // refuserLecture : comme un navigateur qui attend un geste (NotAllowedError).
  play() { if (this.refuserLecture) return Promise.reject(Object.assign(new Error('geste attendu'), { name: 'NotAllowedError' })); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() { /* rien */ }
}
const tous = (n: FNode, ok: (e: FEl) => boolean, acc: FEl[] = []): FEl[] => { if (n instanceof FEl) { if (ok(n)) acc.push(n); for (const c of n.children) tous(c, ok, acc); } return acc; };
const texte = (n: FNode): string => (n instanceof FEl ? n.textContent + n.children.map(texte).join('') : n.textContent);
const tirer = (n: FEl, type: string, e: Record<string, unknown> = {}) => { for (const f of n.ecoute[type] || []) f({ type, target: n, preventDefault() { e.defaut = true; }, ...e }); };

function monter(planMode: string | null) {
  const body = new FEl('body'), head = new FEl('head');
  const docEcoute: Record<string, Array<(e: unknown) => void>> = {};
  const envois: Array<{ url: string; corps?: unknown }> = [];
  const document = {
    body, head, documentElement: body,
    createElement: (t: string) => new FEl(t),
    createTextNode: (s: string) => Object.assign(new FNode(), { textContent: s }),
    getElementById: () => null,
    addEventListener: (t: string, f: (e: unknown) => void) => { (docEcoute[t] ||= []).push(f); },
    removeEventListener: () => {},
  };
  const fetch = async (url: string, o: { body?: string } = {}) => {
    envois.push({ url, corps: o.body ? JSON.parse(o.body) : undefined });
    return { ok: true, json: async () => (planMode ? { pret: true, mode: planMode } : {}) };
  };
  const win: { OdinVenusLecteur?: { ouvrir: Fn; fermer: Fn; logique: Record<string, Fn> } } = {};
  const ctx = vm.createContext({ window: win, document, fetch, Node: FNode, setTimeout, clearTimeout, AbortController, URLSearchParams });
  vm.runInContext(SRC, ctx, { filename: 'venus-lecteur.js' });
  const clavier = (key: string, target: unknown = body) => { const e: Record<string, unknown> = { key, target }; for (const f of docEcoute.keydown || []) f({ key, target, preventDefault() { e.defaut = true; } }); return e; };
  return { win, body, envois, clavier };
}
// Les objets rendus par le lecteur viennent d'un autre contexte (vm) : on les compare à plat.
const plat = (x: unknown) => JSON.parse(JSON.stringify(x));
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------- Logique pure ----------------
test('logique : film converti ou lu tel quel, durée affichée, temps affiché', () => {
  const L = monter(null).win.OdinVenusLecteur!.logique;
  assert.equal(L.estConverti({ pret: true, mode: 'mp4' }), true);
  assert.equal(L.estConverti({ pret: true, mode: 'hls' }), true);
  assert.equal(L.estConverti({ pret: false, mode: 'mp4', error: 'FFmpeg est introuvable' }), true, 'converti même si FFmpeg manque (l\'erreur est dite ailleurs)');
  assert.equal(L.estConverti({ pret: true, mode: 'direct' }), false, 'lu tel quel');
  assert.equal(L.estConverti(null), false, 'plan inconnu : on garde le lecteur du navigateur (prudent)');
  assert.equal(L.estConverti({ pret: false, error: 'introuvable' }), false);
  // Durée : celle d'Odin pour un converti (le navigateur ne voit qu'une durée qui grandit) ; celle du navigateur sinon.
  assert.equal(L.dureeAffichee(5400.7, 12, true), 5400, 'converti : durée entière connue d\'Odin');
  assert.equal(L.dureeAffichee(5400, Infinity, true), 5400);
  assert.equal(L.dureeAffichee(0, 12, true), 0, 'converti sans durée connue : on ne l\'invente pas');
  assert.equal(L.dureeAffichee(5400, 5399.5, false), 5399.5, 'lu tel quel : la durée du navigateur, inchangé');
  assert.equal(L.dureeAffichee(5400, NaN, false), 5400);
  assert.equal(L.texteTemps(4205, 7200), '1:10:05 / 2:00:00');
  assert.equal(L.texteTemps(65, 0), '1:05', 'sans durée connue : le temps seul');
});

test('logique : position après un saut, pas du clavier, position gardée pour la reprise', () => {
  const L = monter(null).win.OdinVenusLecteur!.logique;
  assert.equal(L.positionReelle(4200, 5.6), 4205.6, 'position demandée + temps écoulé dans le flux');
  assert.equal(L.positionReelle(0, 12), 12);
  assert.equal(L.cibleSaut(4200.9, 7200), 4200, 'secondes entières (comme ?depuis=)');
  assert.equal(L.cibleSaut(-30, 7200), 0, 'jamais avant le début');
  assert.equal(L.cibleSaut(9000, 7200), 7199, 'jamais après la fin');
  assert.equal(L.cibleSaut(9000, 0), 9000, 'durée inconnue : pas de borne haute');
  assert.equal(L.pasClavier('ArrowRight'), 10);
  assert.equal(L.pasClavier('ArrowLeft'), -10);
  assert.equal(L.pasClavier('a'), 0);
  // Reprise : pendant l'attente d'un saut, la position gardée est celle demandée (pas 0 du nouveau flux).
  assert.equal(L.positionReprise(4200, 30, null), 4230);
  assert.equal(L.positionReprise(600, 0, 4200), 4200, 'saut en attente : la position demandée');
  assert.deepEqual(plat(L.corpsReprise({ id: 'f1', type: 'film' }, L.positionReprise(4200, 30.4, null), L.dureeAffichee(7200, Infinity, true))), { cible: 'f1', type: 'film', position_s: 4230, duree_s: 7200 });
  // avecDepuis (déjà là) : inchangé.
  assert.equal(L.avecDepuis('/venus/flux/f1', 4200), '/venus/flux/f1?depuis=4200');
  assert.equal(L.avecDepuis('/venus/flux/f1', 0), '/venus/flux/f1');
});

test('logique : les sous-titres suivent le décalage du flux', () => {
  const L = monter(null).win.OdinVenusLecteur!.logique;
  assert.deepEqual(plat(L.decalerSousTitre(4210, 4214, 4200)), { debut: 10, fin: 14 });
  assert.deepEqual(plat(L.decalerSousTitre(4198, 4203, 4200)), { debut: 0, fin: 3 }, 'à cheval : commence tout de suite');
  assert.equal(L.decalerSousTitre(100, 104, 4200), null, 'déjà passé : retiré');
  assert.deepEqual(plat(L.decalerSousTitre(100, 104, 0)), { debut: 100, fin: 104 }, 'sans décalage : inchangé');
});

// ---------------- Avec un faux document ----------------
test('film converti : barre à soi avec la durée entière, saut par ?depuis=, temps et reprise justes, clavier', async () => {
  const { win, body, envois, clavier } = monter('mp4');
  const ouvert = await win.OdinVenusLecteur!.ouvrir({ id: 'film:a', titre: 'Essai', type: 'film', duree_s: 3600 }, { delaiSaut: 20 }) as Record<string, unknown>;
  assert.ok(ouvert, 'lecteur ouvert');
  assert.ok(envois.some((e) => e.url === '/venus/plan/film%3Aa'), 'le lecteur demande à Odin comment le titre se lit');
  const video = tous(body, (e) => e.tagName === 'VIDEO')[0];
  assert.equal(video.controls, false, 'converti : pas la barre du navigateur (elle montrerait une durée qui grandit)');
  assert.equal(video.src, '/venus/flux/film%3Aa');
  const barre = tous(body, (e) => e.className === 'vl-barre')[0];
  assert.ok(barre, 'une barre de temps à soi');
  const curseur = tous(barre, (e) => e.tagName === 'INPUT')[0];
  assert.equal(curseur.attrs.max, '3600', 'la barre couvre toute la durée');
  const temps = tous(barre, (e) => e.className === 'vl-temps')[0];
  assert.equal(temps.textContent, '0:00 / 1:00:00', 'durée entière affichée dès l\'ouverture');
  // Saut par le curseur : nouvelle adresse à partir de la position, attente visible.
  curseur.value = '1200'; tirer(curseur, 'input'); tirer(curseur, 'change');
  const att = tous(body, (e) => e.className === 'vl-attente')[0];
  assert.equal(att.hidden, false, 'l\'attente après un saut se voit');
  assert.match(att.textContent, /20:00/);
  await attendre(60);
  assert.equal(video.src, '/venus/flux/film%3Aa?depuis=1200', 'le flux est redemandé à partir de la position');
  // Le nouveau flux part de 0 : temps affiché = position demandée + temps écoulé.
  video.currentTime = 5; tirer(video, 'playing'); tirer(video, 'timeupdate');
  assert.equal(att.hidden, true, 'l\'attente disparaît quand l\'image revient');
  assert.equal(temps.textContent, '20:05 / 1:00:00');
  assert.equal(curseur.value, '1205');
  // Reprise : la vraie position (pas 5 s), la durée entière (pas Infinity).
  video.duration = Infinity; tirer(video, 'pause');
  const rep = envois.filter((e) => e.url === '/venus/reprise').pop();
  assert.deepEqual(rep?.corps, { cible: 'film:a', type: 'film', position_s: 1205, duree_s: 3600 });
  // Clavier : flèche droite = +10 s depuis la vraie position (deux appuis rapides n'en font qu'un saut).
  assert.equal(clavier('ArrowRight').defaut, true);
  clavier('ArrowRight');
  await attendre(60);
  assert.equal(video.src, '/venus/flux/film%3Aa?depuis=1225');
  clavier('ArrowLeft'); await attendre(60);
  assert.equal(video.src, '/venus/flux/film%3Aa?depuis=1215');
  // Fermer : la conversion en cours est coupée (plus de flux demandé).
  win.OdinVenusLecteur!.fermer();
  assert.equal(video.src, '');
});

test('film converti avec reprise : départ à la position gardée, pas de saut dans le tuyau', async () => {
  const { win, body } = monter('mp4');
  await win.OdinVenusLecteur!.ouvrir({ id: 'f2', type: 'film', duree_s: 3600, reprise_s: 600 }, { delaiSaut: 20 });
  const video = tous(body, (e) => e.tagName === 'VIDEO')[0];
  assert.equal(video.src, '/venus/flux/f2?depuis=600');
  tirer(video, 'loadedmetadata');
  assert.equal(video.currentTime, 0, 'converti : on ne cherche pas dans le flux (il commence déjà à 600 s)');
  video.currentTime = 3; tirer(video, 'playing'); tirer(video, 'timeupdate');
  assert.equal(tous(body, (e) => e.className === 'vl-temps')[0].textContent, '10:03 / 1:00:00');
  win.OdinVenusLecteur!.fermer();
});

test('film lu tel quel par le navigateur : inchangé (contrôles du navigateur, aucune barre à part, flèches libres)', async () => {
  const { win, body, clavier } = monter('direct');
  await win.OdinVenusLecteur!.ouvrir({ id: 'f3', type: 'film', duree_s: 3600, reprise_s: 600 }, { delaiSaut: 20 });
  const video = tous(body, (e) => e.tagName === 'VIDEO')[0];
  assert.equal(video.controls, true);
  assert.equal(video.src, '/venus/flux/f3?depuis=600');
  assert.equal(tous(body, (e) => e.className === 'vl-barre').length, 0);
  tirer(video, 'loadedmetadata');
  assert.equal(video.currentTime, 600, 'reprise par le navigateur, comme avant');
  assert.equal(clavier('ArrowRight').defaut, undefined, 'les flèches restent au navigateur');
  win.OdinVenusLecteur!.fermer();
  assert.equal(video.src, '/venus/flux/f3?depuis=600', 'rien de changé à la fermeture');
});

test('film converti en plein écran : la barre à soi reste visible (le plein écran prend tout le lecteur)', async () => {
  const { win, body } = monter('mp4');
  await win.OdinVenusLecteur!.ouvrir({ id: 'f4', type: 'film', duree_s: 3600 }, { delaiSaut: 20 });
  const racine = tous(body, (e) => e.className === 'vl')[0];
  const cadre = tous(body, (e) => e.className === 'vl-cadre')[0];
  const btn = tous(body, (e) => e.tagName === 'BUTTON' && texte(e) === 'Plein écran')[0];
  tirer(btn, 'click');
  assert.equal(racine.pleinEcran, 1, 'converti : tout le lecteur passe en plein écran');
  assert.equal(cadre.pleinEcran, 0);
  assert.ok(tous(racine, (e) => e.className === 'vl-barre').length === 1, 'la barre est dans ce qui est en plein écran');
  win.OdinVenusLecteur!.fermer();
});

test('film lu tel quel en plein écran : le cadre, comme avant (contrôles du navigateur)', async () => {
  const { win, body } = monter('direct');
  await win.OdinVenusLecteur!.ouvrir({ id: 'f5', type: 'film', duree_s: 3600 }, {});
  const racine = tous(body, (e) => e.className === 'vl')[0];
  const cadre = tous(body, (e) => e.className === 'vl-cadre')[0];
  tirer(tous(body, (e) => e.tagName === 'BUTTON' && texte(e) === 'Plein écran')[0], 'click');
  assert.equal(cadre.pleinEcran, 1);
  assert.equal(racine.pleinEcran, 0);
  win.OdinVenusLecteur!.fermer();
});

test('saut fait en pause, lecture refusée par le navigateur : l\'attente ne reste pas affichée', async () => {
  const { win, body } = monter('mp4');
  await win.OdinVenusLecteur!.ouvrir({ id: 'f6', type: 'film', duree_s: 3600 }, { delaiSaut: 20 });
  const video = tous(body, (e) => e.tagName === 'VIDEO')[0];
  const att = tous(body, (e) => e.className === 'vl-attente')[0];
  video.pause(); video.refuserLecture = true;
  const curseur = tous(body, (e) => e.className === 'vl-curseur')[0];
  curseur.value = '900'; tirer(curseur, 'input'); tirer(curseur, 'change');
  assert.equal(att.hidden, false, 'l\'attente se voit pendant le saut');
  await attendre(60);
  assert.equal(video.src, '/venus/flux/f6?depuis=900');
  assert.equal(att.hidden, true, 'lecture refusée : l\'attente est retirée (le bouton Lecture reste là)');
  // La position gardée reste celle demandée, même sans image.
  assert.equal(tous(body, (e) => e.className === 'vl-temps')[0].textContent, '15:00 / 1:00:00');
  win.OdinVenusLecteur!.fermer();
});

test('film lu tel quel : pendant la question à Odin, une attente se voit (pas d\'écran noir muet)', async () => {
  const { win, body } = monter('direct');
  const p = win.OdinVenusLecteur!.ouvrir({ id: 'f7', type: 'film', duree_s: 3600 }, {}) as Promise<unknown>;
  const att = tous(body, (e) => e.className === 'vl-attente')[0];
  assert.equal(att.hidden, false, 'attente visible pendant la question');
  await p;
  assert.equal(att.hidden, true, 'lu tel quel : l\'attente est retirée, le navigateur prend la main');
  win.OdinVenusLecteur!.fermer();
});

test('film converti : les vraies pistes de sous-titres sont recalées à chaque saut (retirées, puis remises)', async () => {
  const { win, body } = monter('mp4');
  await win.OdinVenusLecteur!.ouvrir({ id: 'f8', type: 'film', duree_s: 3600, sousTitres: [{ lang: 'xx', label: 'Piste' }] }, { delaiSaut: 20 });
  const video = tous(body, (e) => e.tagName === 'VIDEO')[0];
  const c1 = { startTime: 100, endTime: 104 }, c2 = { startTime: 1210, endTime: 1214 };
  const piste = { cues: [c1, c2] as Array<typeof c1>, addCue(c: typeof c1) { this.cues.push(c); }, removeCue(c: typeof c1) { this.cues = this.cues.filter((x) => x !== c); } };
  video.textTracks = [piste];
  const curseur = tous(body, (e) => e.className === 'vl-curseur')[0];
  curseur.value = '1200'; tirer(curseur, 'input'); tirer(curseur, 'change');
  await attendre(60);
  assert.equal(piste.cues.includes(c1), false, 'sous-titre passé : retiré');
  assert.deepEqual([c2.startTime, c2.endTime], [10, 14], 'recalé sur le flux qui part de 1200');
  curseur.value = '50'; tirer(curseur, 'input'); tirer(curseur, 'change');
  await attendre(60);
  assert.equal(piste.cues.includes(c1), true, 'retour en arrière : remis');
  assert.deepEqual([c1.startTime, c1.endTime], [50, 54]);
  assert.deepEqual([c2.startTime, c2.endTime], [1160, 1164]);
  win.OdinVenusLecteur!.fermer();
});

test('YouTube : pas de plan demandé, lecteur du navigateur comme avant', async () => {
  const { win, body, envois } = monter('mp4');
  await win.OdinVenusLecteur!.ouvrir({ id: 'yt1', source: 'yt', type: 'youtube', duree_s: 300 }, { ecrans: false });
  assert.equal(envois.filter((e) => e.url.startsWith('/venus/plan/')).length, 0);
  assert.equal(tous(body, (e) => e.tagName === 'VIDEO')[0].controls, true);
  assert.equal(texte(body).includes('vl-barre'), false);
  win.OdinVenusLecteur!.fermer();
});
