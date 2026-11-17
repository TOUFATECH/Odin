// La recherche par le sens gardée prête (src/brain/nous/sens-vif.ts) : mêmes réponses, dans le même ordre, que l'ancien
// chemin (store.nearest de src/muninn/store.ts, gardé ici comme RÉFÉRENCE), sur un fil et réparti sur plusieurs ; un
// souvenir oublié disparaît tout de suite ; ce qui change dans la mémoire est vu à la synchronisation ; la mémoire prise
// est bornée par le comptable et rendue sous pression ; sans rien de gardé, l'appelant reste juste (ancien chemin).
process.env.ODIN_ESSAI = '1';
// Le comptable lit la mémoire libre à chaque demande : une machine « libre » fixe pour que les essais ne dépendent pas
// des autres programmes ; les essais de refus et de pression changent ces réglages et les remettent.
process.env.ODIN_MEMOIRE_LIBRE_MO = '100000';
delete process.env.ODIN_MEMOIRE_MARGE_MO;
delete process.env.ODIN_MEMOIRE_PLAFOND_MO;

import assert from 'node:assert/strict';
import test from 'node:test';
import { Mnemosyne } from '../src/muninn/store.ts';
import { budgetLibreMo, rendre, reserver } from '../src/brain/budget-memoire.ts';
import { SensVif, classerParLeSens, normeSens, SEUIL_SENS } from '../src/brain/nous/sens-vif.ts';
import { decoder } from '../src/muninn/vecteurs-ram.ts';

const MODELE = 'noos-v7-p1';
function hasard(graine: number): () => number {
  let s = graine >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Vecteurs « comme Soul » : une composante commune (les plongements moyennés se ressemblent tous un peu) + du bruit. */
function vecteurs(n: number, dim: number, graine: number): Float32Array[] {
  const h = hasard(graine), commun = Float32Array.from({ length: dim }, () => h() - 0.5);
  return Array.from({ length: n }, () => Float32Array.from({ length: dim }, (_, i) => commun[i] * 0.9 + (h() - 0.5)));
}

/** Une mémoire du produit remplie : n souvenirs, leurs vecteurs ; quelques égalités exactes (vecteurs copiés). */
function memoireRemplie(n: number, dim: number, graine = 1): { mem: Mnemosyne; ids: number[]; vs: Float32Array[] } {
  const mem = new Mnemosyne(':memory:');
  const vs = vecteurs(n, dim, graine), ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const { id } = mem.remember(`souvenir numéro ${i} graine ${graine}`, 'owner', 'fact');
    ids.push(id);
    // Un sur dix reprend le vecteur d'un autre : des scores EXACTEMENT égaux, départagés par l'ordre de rangement.
    const v = i % 10 === 9 ? vs[i - 3] : vs[i];
    vs[i] = v;
    mem.setVector(id, MODELE, v);
  }
  return { mem, ids, vs };
}
/** Les lignes de vecteurs telles que la mémoire les garde (dans son ordre) — c'est ce que l'ancien chemin parcourt. */
const lignesDe = (mem: Mnemosyne) => [...(mem as unknown as { vectors: { values(): Iterable<{ id: number; model: string; vec: string }> } }).vectors.values()]
  .filter((l) => l.model === MODELE).map((l) => ({ id: l.id, cle: l.vec, vec: () => decoder(l.vec) }));
const vivantDe = (mem: Mnemosyne) => (id: number | string) => { const m = mem.getMemory(Number(id)); return Boolean(m && (m.superseded_by === null || m.superseded_by === undefined) && m.origin !== 'untrusted'); };

function pareil(mem: Mnemosyne, sv: SensVif, q: Float32Array, limite: number, msg: string): void {
  const ancien = mem.nearest(MODELE, q, limite).map((r) => r.id);
  const neuf = sv.chercher(MODELE, q, limite, { vivant: vivantDe(mem) });
  assert.ok(neuf, `${msg} : l'index devrait être prêt`);
  assert.deepEqual(neuf.map((x) => x.id), ancien, msg);
}

test('Mêmes réponses, même ordre que l\'ancien chemin — un fil, puis réparti sur plusieurs fils', () => {
  const { mem } = memoireRemplie(700, 128, 3);
  const un = new SensVif({ nom: 'essai-un', fils: 0 });
  const plusieurs = new SensVif({ nom: 'essai-plusieurs', fils: 3, seuilParallele: 0 });
  try {
    assert.ok(un.synchroniser(MODELE, lignesDe(mem)));
    assert.ok(plusieurs.synchroniser(MODELE, lignesDe(mem)));
    const qs = vecteurs(40, 128, 99);
    for (const [i, q] of qs.entries()) for (const lim of [1, 6, 50, 1000]) {
      pareil(mem, un, q, lim, `un fil, question ${i}, limite ${lim}`);
      pareil(mem, plusieurs, q, lim, `plusieurs fils, question ${i}, limite ${lim}`);
    }
    assert.equal(plusieurs.compte.derniersFils, 4, 'la recherche a bien été répartie sur 3 fils + le principal');
    assert.equal(plusieurs.compte.derniersCompares, 700, 'tous les souvenirs sont comparés');
    assert.ok(plusieurs.compte.enParallele > 0);
  } finally { un.fermer(); plusieurs.fermer(); }
});

test('Égalités exactes : départagées par l\'ordre de rangement, comme l\'ancien tri stable', () => {
  const mem = new Mnemosyne(':memory:');
  const v = Float32Array.from({ length: 16 }, (_, i) => (i % 3) - 1 + 0.25);
  const ids: number[] = [];
  for (let i = 0; i < 12; i++) { const { id } = mem.remember(`égal ${i}`, 'owner'); ids.push(id); mem.setVector(id, MODELE, v); }
  const sv = new SensVif({ nom: 'essai-egal', fils: 2, seuilParallele: 0 });
  try {
    sv.synchroniser(MODELE, lignesDe(mem));
    pareil(mem, sv, v, 6, 'tous égaux');
    // Un vecteur REMPLACÉ garde sa place (comme la table de la mémoire) ; un souvenir ajouté va à la fin.
    mem.setVector(ids[0], MODELE, v); sv.ajouter(ids[0], MODELE, v);
    const { id: neuf } = mem.remember('égal neuf', 'owner'); mem.setVector(neuf, MODELE, v); sv.ajouter(neuf, MODELE, v);
    pareil(mem, sv, v, 20, 'après remplacement et ajout');
  } finally { sv.fermer(); }
});

test('Une question d\'une autre longueur que les vecteurs : même calcul que l\'ancien chemin', () => {
  const { mem } = memoireRemplie(200, 64, 5);
  const sv = new SensVif({ nom: 'essai-longueur', fils: 2, seuilParallele: 0 });
  try {
    sv.synchroniser(MODELE, lignesDe(mem));
    for (const q of [...vecteurs(5, 40, 7), ...vecteurs(5, 90, 8)]) pareil(mem, sv, q, 10, `question de ${q.length}`);
  } finally { sv.fermer(); }
});

test('Oublier : le souvenir disparaît TOUT DE SUITE de ce qui est gardé, sans attendre une synchronisation', () => {
  const { mem, ids, vs } = memoireRemplie(300, 32, 11);
  const sv = new SensVif({ nom: 'essai-oubli', fils: 2, seuilParallele: 0 });
  try {
    sv.synchroniser(MODELE, lignesDe(mem));
    const cible = ids[42], q = vs[42];
    assert.equal(sv.chercher(MODELE, q, 1, { vivant: vivantDe(mem) })![0].id, cible);
    mem.forget(cible); sv.oublier(cible);
    assert.ok(!sv.a(cible));
    assert.ok(!sv.chercher(MODELE, q, 300, { vivant: vivantDe(mem) })!.some((x) => x.id === cible), 'le souvenir oublié ne ressort plus');
    assert.equal(sv.taille, 299);
    pareil(mem, sv, q, 300, 'après l\'oubli');
    // Rien du vecteur oublié ne reste dans le tableau gardé.
    const mat = (sv as unknown as { mat: Float32Array }).mat;
    assert.ok(mat.subarray(299 * 32, 300 * 32).every((x) => x === 0), 'la place libérée est remise à zéro');
    // Oublié dans la mémoire mais pas encore dans l'index : le filtre « vivant » l'écarte quand même.
    const autre = ids[7]; mem.forget(autre);
    assert.ok(!sv.chercher(MODELE, vs[7], 300, { vivant: vivantDe(mem) })!.some((x) => x.id === autre));
  } finally { sv.fermer(); }
});

test('Synchroniser : un vecteur changé, ajouté ou retiré dans la mémoire est vu ; rien n\'est redécodé pour rien', () => {
  const { mem, ids } = memoireRemplie(100, 24, 21);
  const sv = new SensVif({ nom: 'essai-synchro', fils: 0 });
  try {
    sv.synchroniser(MODELE, lignesDe(mem));
    const [nouveau] = vecteurs(1, 24, 77);
    mem.setVector(ids[5], MODELE, nouveau);           // changé
    mem.forget(ids[6]);                               // retiré
    const { id: ajoute } = mem.remember('un souvenir de plus', 'owner'); mem.setVector(ajoute, MODELE, vecteurs(1, 24, 78)[0]);
    let decodes = 0;
    const lignes = lignesDe(mem).map((l) => ({ ...l, vec: () => { decodes++; return l.vec(); } }));
    assert.ok(sv.synchroniser(MODELE, lignes));
    assert.equal(decodes, 2, 'seuls le vecteur changé et le nouveau sont décodés');
    assert.ok(!sv.a(ids[6]) && sv.a(ajoute));
    assert.equal(sv.chercher(MODELE, nouveau, 1, { vivant: vivantDe(mem) })![0].id, ids[5]);
    for (const q of vecteurs(10, 24, 79)) pareil(mem, sv, q, 8, 'après synchronisation');
    // Un autre modèle (nouvelle version de Soul) : l'index n'est pas prêt pour lui → ancien chemin.
    assert.equal(sv.chercher('noos-v8-p1', nouveau, 3, { vivant: vivantDe(mem) }), null);
  } finally { sv.fermer(); }
});

test('Mémoire bornée par le comptable : refus au-delà, index vidé, l\'appelant reste juste par l\'ancien chemin', () => {
  const { mem } = memoireRemplie(2000, 128, 31);
  const sv = new SensVif({ nom: 'essai-borne', fils: 0, plafondMo: 1 });
  try {
    // 2 000 vecteurs de 128 nombres ≈ 1,1 Mo de tableaux : au-delà du plafond de 1 Mo.
    assert.equal(sv.synchroniser(MODELE, lignesDe(mem)), false);
    assert.equal(sv.pret, false);
    assert.equal(sv.memoireMo, 0, 'tout est rendu au comptable');
    assert.ok(sv.compte.refus > 0);
    const q = vecteurs(1, 128, 32)[0];
    assert.equal(sv.chercher(MODELE, q, 6, { vivant: vivantDe(mem) }), null, 'pas prêt : null');
    // « Odin reste juste, seulement plus lent » : l'appelant prend l'ancien chemin.
    const reponse = sv.chercher(MODELE, q, 6, { vivant: vivantDe(mem) })?.map((x) => x.id) ?? mem.nearest(MODELE, q, 6).map((r) => r.id);
    assert.deepEqual(reponse, mem.nearest(MODELE, q, 6).map((r) => r.id));
  } finally { sv.fermer(); }
  // Le plafond COMMUN du comptable (toutes les parts ensemble) : même chose.
  process.env.ODIN_MEMOIRE_PLAFOND_MO = '1';
  const sv2 = new SensVif({ nom: 'essai-borne-commun', fils: 0 });
  try {
    assert.equal(sv2.synchroniser(MODELE, lignesDe(mem)), false);
    assert.equal(sv2.memoireMo, 0);
  } finally { sv2.fermer(); delete process.env.ODIN_MEMOIRE_PLAFOND_MO; }
  // Et sous le plafond, il est accepté et compté.
  const sv3 = new SensVif({ nom: 'essai-borne-ok', fils: 0 });
  try {
    assert.ok(sv3.synchroniser(MODELE, lignesDe(mem)));
    assert.ok(sv3.memoireMo >= 1 && sv3.memoireMo <= 4, `${sv3.memoireMo} Mo`);
  } finally { sv3.fermer(); }
});

test('Sous pression (la machine manque de mémoire) : tout est vidé et rendu, puis reconstruit quand elle va mieux', () => {
  const { mem } = memoireRemplie(500, 64, 41);
  const sv = new SensVif({ nom: 'essai-pression', fils: 2, seuilParallele: 0 });
  try {
    assert.ok(sv.synchroniser(MODELE, lignesDe(mem)));
    const q = vecteurs(1, 64, 42)[0];
    assert.ok(sv.chercher(MODELE, q, 6, { vivant: vivantDe(mem) }));
    assert.ok(sv.memoireMo > 0);
    process.env.ODIN_MEMOIRE_LIBRE_MO = '10'; // sous la marge
    assert.equal(budgetLibreMo(), 0);         // le comptable voit la pression et prévient
    assert.equal(sv.taille, 0); assert.equal(sv.pret, false); assert.equal(sv.memoireMo, 0);
    assert.ok(sv.compte.videsSousPression >= 1);
    assert.equal(sv.chercher(MODELE, q, 6, { vivant: vivantDe(mem) }), null);
    process.env.ODIN_MEMOIRE_LIBRE_MO = '100000';
    assert.ok(sv.synchroniser(MODELE, lignesDe(mem)));
    pareil(mem, sv, q, 6, 'reconstruit après la pression');
  } finally { sv.fermer(); process.env.ODIN_MEMOIRE_LIBRE_MO = '100000'; }
});

test('Classer une liste de souvenirs donnée par le sens (la fonction promise au Cerveau)', () => {
  const vs = vecteurs(60, 48, 51), q = vecteurs(1, 48, 52)[0];
  vs[10] = vs[3]; // une égalité : l'ordre de la liste départage
  const liste = vs.map((vec, i) => ({ id: `note-${i}`, vec }));
  const qn = normeSens(q);
  const reference = liste.map((s, i) => { let d = 0; for (let k = 0; k < 48; k++) d += s.vec[k] * q[k]; return { s, i, score: d / (normeSens(s.vec) * qn) }; })
    .filter((x) => x.score > SEUIL_SENS).sort((a, b) => b.score - a.score).slice(0, 7);
  const r = classerParLeSens(q, liste, { limite: 7 });
  assert.deepEqual(r.map((x) => x.souvenir.id), reference.map((x) => x.s.id));
  assert.deepEqual(r.map((x) => x.score), reference.map((x) => x.score));
  // Sans vecteur dans la liste : celui que l'index garde pour cet identifiant.
  const sv = new SensVif({ nom: 'essai-classer', fils: 0 });
  try {
    for (const s of liste) sv.ajouter(s.id, MODELE, s.vec);
    const r2 = classerParLeSens(q, liste.map((s) => ({ id: s.id })), { limite: 7, depuis: sv, modele: MODELE });
    assert.deepEqual(r2.map((x) => x.souvenir.id), reference.map((x) => x.s.id));
    sv.oublier('note-3');
    assert.ok(!classerParLeSens(q, [{ id: 'note-3' }], { depuis: sv, modele: MODELE, seuil: -2 }).length, 'oublié : plus classé');
  } finally { sv.fermer(); }
});

// ------------------------------------------------------------------------------------------------ après relecture
test('Sous pression pendant une recherche (fils pas encore prêts) : null, jamais « rien trouvé »', () => {
  const { mem, vs } = memoireRemplie(400, 64, 5);
  const sv = new SensVif({ nom: 'essai-pression-recherche', fils: 2, seuilParallele: 0 });
  try {
    assert.ok(sv.synchroniser(MODELE, lignesDe(mem)));
    // L'index est prêt, ses fils ne sont pas encore créés : la demande au comptable pour les fils voit la pression.
    process.env.ODIN_MEMOIRE_LIBRE_MO = '10';
    const r = sv.chercher(MODELE, vs[3], 6, { vivant: vivantDe(mem) });
    process.env.ODIN_MEMOIRE_LIBRE_MO = '100000';
    assert.equal(r, null, 'rien de gardé : l\'appelant doit reprendre l\'ancien chemin');
    assert.equal(sv.pret, false);
    assert.ok(mem.nearest(MODELE, vs[3], 6).length > 0, 'l\'ancien chemin, lui, trouve');
  } finally { sv.fermer(); process.env.ODIN_MEMOIRE_LIBRE_MO = '100000'; }
});

test('Un souvenir oublié ne laisse RIEN en mémoire vive (pas même son empreinte) ; vider efface les empreintes', () => {
  const mem = new Mnemosyne(':memory:');
  const v = Float32Array.from({ length: 16 }, (_, i) => i + 1);
  const { id } = mem.remember('secret à oublier', 'owner', 'fact'); mem.setVector(id, MODELE, v);
  const { id: autre } = mem.remember('un autre', 'owner', 'fact'); mem.setVector(autre, MODELE, v.map((x) => -x));
  const sv = new SensVif({ nom: 'essai-empreinte', fils: 0 });
  const empreintes = () => (sv as unknown as { empreintes: Map<unknown, unknown> }).empreintes;
  try {
    sv.synchroniser(MODELE, lignesDe(mem));
    assert.ok(empreintes().has(id));
    sv.oublier(id);
    assert.ok(!sv.a(id) && !empreintes().has(id), 'ni le vecteur ni son empreinte ne restent');
    assert.ok(empreintes().has(autre));
    sv.vider('essai');
    assert.equal(empreintes().size, 0, 'vider ne garde aucune empreinte');
  } finally { sv.fermer(); }
});

test('Oubli dans la mémoire : l\'index l\'apprend seul, tout de suite ; sans « vivant », pas de réponse (ancien chemin)', () => {
  const { mem, ids, vs } = memoireRemplie(50, 16, 23);
  const sv = new SensVif({ nom: 'essai-oubli-seul', fils: 0 });
  try {
    sv.synchroniser(MODELE, lignesDe(mem));
    mem.forget(ids[4]); // sans appeler sv.oublier : c'est la mémoire qui prévient
    assert.ok(!sv.a(ids[4]), 'retiré de l\'index dès l\'oubli');
    assert.ok(!(sv as unknown as { empreintes: Map<unknown, unknown> }).empreintes.has(ids[4]));
    pareil(mem, sv, vs[4], 6, 'après un oubli dans la mémoire');
    // Sans filtre « vivant », l'index ne répond pas : un souvenir venu du dehors ne peut pas sortir par lui.
    assert.equal((sv.chercher as (m: string, q: Float32Array, l: number) => unknown).call(sv, MODELE, vs[4], 6), null);
    assert.equal(sv.compte.sansVivant, 1);
    // Un souvenir venu du dehors (non fiable) est écarté comme par l'ancien chemin.
    const { id: dehors } = mem.remember('venu du web', 'untrusted', 'fact'); mem.setVector(dehors, MODELE, vs[0]);
    sv.synchroniser(MODELE, lignesDe(mem));
    assert.ok(sv.a(dehors));
    pareil(mem, sv, vs[0], 6, 'un souvenir non fiable ne sort pas');
  } finally { sv.fermer(); }
});

test('Deux index du même nom ne partagent pas leur part au comptable', () => {
  const { mem } = memoireRemplie(3000, 128, 7);
  const x = new SensVif({ fils: 0 }), y = new SensVif({ fils: 0 });
  try {
    assert.notEqual(x.nom, y.nom);
    assert.ok(x.synchroniser(MODELE, lignesDe(mem)) && y.synchroniser(MODELE, lignesDe(mem)));
    assert.ok(y.memoireMo >= 2);
    x.fermer();
    // y garde ses vecteurs : sa part reste comptée, un tiers n'obtient pas tout le plafond.
    process.env.ODIN_MEMOIRE_PLAFOND_MO = '10';
    const tiers = reserver('essai-tiers', 10);
    rendre('essai-tiers');
    assert.equal(tiers, false, 'la part de y est toujours comptée');
    assert.ok(reserver('essai-tiers', 10 - y.memoireMo), 'le reste du plafond, lui, est accordé');
    rendre('essai-tiers');
  } finally { delete process.env.ODIN_MEMOIRE_PLAFOND_MO; x.fermer(); y.fermer(); }
});

test('Après un vidage (changement de modèle), la répartition sur les cœurs reprend et le reste', async () => {
  const { mem, vs } = memoireRemplie(400, 64, 13);
  const sv = new SensVif({ nom: 'essai-fils-reprise', fils: 2, seuilParallele: 0 });
  const viv = vivantDe(mem);
  try {
    sv.synchroniser(MODELE, lignesDe(mem)); sv.chercher(MODELE, vs[1], 6, { vivant: viv });
    assert.equal(sv.compte.derniersFils, 3);
    sv.synchroniser('noos-v8-p1', []);     // vidé : les anciens fils sont arrêtés
    sv.synchroniser(MODELE, lignesDe(mem)); // reconstruit : de nouveaux fils
    sv.chercher(MODELE, vs[1], 6, { vivant: viv });
    await new Promise((r) => setTimeout(r, 1500)); // la fin des anciens fils arrive maintenant
    pareil(mem, sv, vs[1], 6, 'après la fin des anciens fils');
    assert.equal(sv.compte.derniersFils, 3, 'toujours réparti sur 2 fils + le principal');
    assert.equal((sv as unknown as { filsCasses: boolean }).filsCasses, false);
  } finally { sv.fermer(); }
});

test('Un index fermé n\'est plus suivi (ni pression, ni oublis) : rien ne le retient', () => {
  const fermes: SensVif[] = [];
  for (let i = 0; i < 50; i++) { const sv = new SensVif({ nom: `essai-ferme-${i}`, fils: 0 }); sv.ajouter(i, MODELE, new Float32Array([1, 2, 3])); sv.fermer(); fermes.push(sv); }
  assert.ok(fermes.every((sv) => !sv.suivi));
  const ouvert = new SensVif({ nom: 'essai-ouvert', fils: 0 });
  try {
    assert.ok(ouvert.suivi);
    ouvert.ajouter(1, MODELE, new Float32Array([1, 2, 3])); ouvert.fermer();
    assert.ok(!ouvert.suivi);
    ouvert.ajouter(1, MODELE, new Float32Array([1, 2, 3]));
    assert.ok(ouvert.suivi, 'rouvert : de nouveau suivi');
  } finally { ouvert.fermer(); }
});

test('Limites inhabituelles : comme l\'ancien chemin (0, négative, à virgule, NaN, infinie)', () => {
  const { mem, vs } = memoireRemplie(200, 32, 17);
  const sv = new SensVif({ nom: 'essai-limites', fils: 0 });
  try {
    sv.synchroniser(MODELE, lignesDe(mem));
    for (const q of vs.slice(0, 5)) for (const lim of [0, -1, -3, 2.5, NaN, Infinity, -Infinity]) pareil(mem, sv, q, lim, `limite ${lim}`);
    // Et pour une liste donnée.
    const liste = vs.slice(0, 30).map((vec, i) => ({ id: i, vec }));
    const tout = classerParLeSens(vs[0], liste).map((x) => x.souvenir.id);
    for (const lim of [-1, 2.5, NaN]) assert.deepEqual(classerParLeSens(vs[0], liste, { limite: lim }).map((x) => x.souvenir.id), tout.slice(0, lim), `liste, limite ${lim}`);
  } finally { sv.fermer(); }
});

test('Classer avec l\'index d\'un AUTRE modèle : il ne note rien', () => {
  const v = vecteurs(2, 16, 4);
  const sv = new SensVif({ nom: 'essai-autre-modele', fils: 0 });
  try {
    sv.ajouter('n1', 'noos-v1-p1', v[0]);
    assert.equal(classerParLeSens(v[0], [{ id: 'n1' }], { depuis: sv, modele: 'noos-v2-p1' }).length, 0, 'autre modèle');
    assert.equal(classerParLeSens(v[0], [{ id: 'n1' }], { depuis: sv }).length, 0, 'modèle non dit');
    assert.equal(classerParLeSens(v[0], [{ id: 'n1' }], { depuis: sv, modele: 'noos-v1-p1' }).length, 1, 'le bon modèle');
  } finally { sv.fermer(); }
});

test('Un fil de calcul qui ne répond plus ne bloque pas Odin : attente courte, puis un seul fil, mêmes réponses', async () => {
  const { mem, vs } = memoireRemplie(600, 64, 61);
  const sv = new SensVif({ nom: 'essai-fil-muet', fils: 2, seuilParallele: 0 });
  try {
    sv.synchroniser(MODELE, lignesDe(mem));
    pareil(mem, sv, vs[2], 6, 'avant');
    assert.equal(sv.compte.derniersFils, 3);
    // Un fil s'arrête sans que l'index le sache (comme un fil privé de processeur : il ne répond plus).
    const fil = (sv as unknown as { fils: Array<{ w: { removeAllListeners(e: string): unknown; terminate(): Promise<number> } }> }).fils[0].w;
    fil.removeAllListeners('exit'); fil.removeAllListeners('error');
    await fil.terminate();
    const a = performance.now();
    pareil(mem, sv, vs[2], 6, 'fil muet');
    const ms = performance.now() - a;
    assert.ok(ms < 500, `${ms.toFixed(0)} ms : le fil principal n'attend pas 2 s`);
    assert.equal(sv.compte.attentesDepassees, 1);
    assert.equal(sv.compte.derniersFils, 1, 'repris sur un seul fil');
    pareil(mem, sv, vs[3], 6, 'pendant la pause des fils');
    assert.equal(sv.compte.derniersFils, 1, 'les fils sont laissés de côté un moment');
  } finally { sv.fermer(); }
});
