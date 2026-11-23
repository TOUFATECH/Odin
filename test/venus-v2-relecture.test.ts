// Vénus, lot V2 (relecture) : le lecteur de Venus (src/valhalla/venus/app/lecteur.js) dans un faux navigateur, sans
// Odin derrière (les réponses d'Odin sont écrites ici) :
//   - après un enchaînement d'épisodes, fermer le lecteur rend à la page son défilement (comme player.js) ;
//   - fermer le lecteur ne laisse ni écouteur de clavier ni circuit audio du mode nuit derrière lui ;
//   - « Épisode suivant » au milieu d'un épisode garde la vraie position : l'épisode n'est pas noté « vu » ;
//   - la barre de commandes défile au lieu de couper son dernier bouton (ordinateur, 1280 px).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { attendre, FDoc, FEl, type FVideo } from './venus-v2-dom.ts';

const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
const lire = (f: string) => readFileSync(new URL(f, APP), 'utf8');
type Fn = (...a: unknown[]) => unknown;
interface Envoi { chemin: string; corps?: Record<string, unknown> }

const EP = (n: number) => `serie:brume:s1e${n}`;
const infoDe = (id: string, o: Record<string, unknown> = {}) => {
  const n = Number(/e(\d+)$/.exec(id)?.[1] ?? 1);
  return { id, title: 'Brume', duration: 1800, mode: 'direct', position: 0, watched: false, subs: [], audio: [], chapters: [], segments: null, present: true,
    type: 'episode', showId: 'serie:brume', itemId: id, season: 1, episode: n, next: n < 3 ? { id: EP(n + 1), season: 1, episode: n + 1 } : null,
    prev: n > 1 ? { id: EP(n - 1), season: 1, episode: n - 1 } : null, seasonEpisodes: [], ...o };
};

const ouverts: Array<{ fermer(): void }> = [];
after(() => { for (const l of ouverts) l.fermer(); });

/** Un faux navigateur qui ne charge que planetes.js et lecteur.js ; fetch répond à la place d'Odin. */
function navigateur(o: { nuit?: boolean } = {}) {
  const doc = new FDoc(), envois: Envoi[] = [], stock = new Map<string, string>(), ecoute = new Map<string, Fn[]>();
  const audio = { crees: 0, fermes: 0 };
  if (o.nuit) stock.set('vn_night_moi', 'true');
  const noeud = () => ({ connect() {}, disconnect() {}, threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, gain: { value: 0 } });
  class AudioContext { state = 'running'; destination = noeud(); constructor() { audio.crees++; } createMediaElementSource() { return noeud(); } createDynamicsCompressor() { return noeud(); } createGain() { return noeud(); } resume() { return Promise.resolve(); } close() { audio.fermes++; this.state = 'closed'; return Promise.resolve(); } }
  const win: Record<string, unknown> = {
    navigator: { language: 'fr-FR' }, innerWidth: 1280, innerHeight: 800, AudioContext,
    addEventListener: (t: string, f: Fn) => { ecoute.set(t, [...(ecoute.get(t) ?? []), f]); }, removeEventListener: (t: string, f: Fn) => { ecoute.set(t, (ecoute.get(t) ?? []).filter((x) => x !== f)); },
    localStorage: { getItem: (k: string) => stock.get(k) ?? null, setItem: (k: string, v: string) => { stock.set(k, String(v)); }, removeItem: (k: string) => { stock.delete(k); } },
    fetch: async (chemin: string, i: { body?: string } = {}) => {
      envois.push({ chemin, ...(i.body ? { corps: JSON.parse(i.body) as Record<string, unknown> } : {}) });
      const m = /^\/venus\/api\/lecture\/(.+)$/.exec(chemin);
      const corps = m ? infoDe(decodeURIComponent(m[1])) : { ok: true };
      return { ok: true, status: 200, json: async () => corps, text: async () => JSON.stringify(corps) };
    },
  };
  const ctx = vm.createContext({ ...win, document: doc, Intl, setTimeout, clearTimeout, setInterval, clearInterval });
  (ctx as Record<string, unknown>).window = ctx;
  vm.runInContext(lire('planetes.js'), ctx); vm.runInContext(lire('lecteur.js'), ctx);
  const LV = (ctx as Record<string, unknown>).VenusLecteur as { ouvrir(id: string, o?: Record<string, unknown>): Promise<{ root: FEl; video: FVideo }>; fermer(): void; ouvert(): unknown };
  ouverts.push(LV);
  return { doc, LV, envois, audio, ecoute, nbClavier: () => (doc.ecoute.get('keydown') ?? []).length };
}

test('après un enchaînement d’épisodes, fermer le lecteur rend son défilement à la page', async () => {
  const N = navigateur();
  N.doc.body.style.overflow = '';
  await N.LV.ouvrir(EP(1), { profil: 'moi' });
  assert.equal(N.doc.body.style.overflow, 'hidden', 'pendant la lecture, la page ne défile pas');
  await N.LV.ouvrir(EP(2), { profil: 'moi' }); // l'épisode suivant remplace le premier lecteur
  N.LV.fermer();
  assert.equal(N.LV.ouvert(), null);
  assert.equal(N.doc.body.style.overflow, '', 'la page défile de nouveau (player.js : overflow = \'\')');
});

test('fermer le lecteur ne laisse ni écouteur de clavier ni circuit audio du mode nuit', async () => {
  const N = navigateur({ nuit: true }), avant = N.nbClavier();
  const p = await N.LV.ouvrir(EP(1), { profil: 'moi' });
  p.root.emettre('pointerdown'); // le premier geste branche le mode nuit
  assert.equal(N.audio.crees, 1, 'le mode nuit se branche au premier geste');
  N.LV.fermer();
  assert.equal(N.nbClavier(), avant, 'aucun écouteur de clavier ne reste après la fermeture');
  assert.equal(N.audio.fermes, 1, 'le circuit audio du mode nuit est fermé');
  // Un lecteur fermé avant tout geste : rien ne reste non plus, et une touche plus tard ne rebranche rien.
  const N2 = navigateur({ nuit: true }), avant2 = N2.nbClavier();
  await N2.LV.ouvrir(EP(1), { profil: 'moi' }); N2.LV.fermer();
  assert.equal(N2.nbClavier(), avant2, 'l’attente du premier geste est retirée');
  N2.doc.touche('x'); assert.equal(N2.audio.crees, 0, 'aucun circuit audio créé pour un lecteur fermé');
});

test('« Épisode suivant » au milieu d’un épisode : la vraie position est gardée, l’épisode n’est pas « vu »', async () => {
  const N = navigateur();
  const p = await N.LV.ouvrir(EP(1), { profil: 'moi' });
  p.video.duration = 1800; p.video.currentTime = 120;
  N.doc.activeElement = N.doc.body; N.doc.touche('n');
  await attendre(50);
  const rep = N.envois.filter((e) => e.chemin === '/venus/reprise' && e.corps?.cible === EP(1));
  assert.ok(rep.length >= 1, 'la reprise part');
  assert.ok(rep.every((e) => e.corps!.position_s === 120), `position gardée (reçu : ${rep.map((e) => e.corps!.position_s).join(', ')})`);
  assert.ok(N.envois.some((e) => e.chemin === `/venus/api/lecture/${encodeURIComponent(EP(2))}`), 'l’épisode 2 s’ouvre');
  // Tout près de la fin, passer au suivant le note bien « vu » (comme la fin de l'épisode).
  const p2 = N.LV.ouvert() as { video: FVideo }; await attendre(20);
  p2.video.duration = 1800; p2.video.currentTime = 1790; N.doc.touche('n'); await attendre(50);
  const fin = N.envois.filter((e) => e.chemin === '/venus/reprise' && e.corps?.cible === EP(2));
  assert.ok(fin.some((e) => e.corps!.position_s === 1800), 'fin proche : « vu »');
  N.LV.fermer();
});

test('ordinateur (1280 px) : la barre de commandes défile au lieu de couper son dernier bouton', () => {
  const css = lire('css/odin.css');
  assert.match(css, /\.p-controls\s*\{[^}]*overflow-x:\s*auto/, 'la barre défile si elle est trop large');
  assert.match(css, /\.p-controls\s*>\s*\*\s*\{[^}]*flex-shrink:\s*0/, 'les boutons gardent leur taille');
});
