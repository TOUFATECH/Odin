// Le visage d'Odin (src/web/face.js), essayé sans navigateur : la palette des 66 émotions (la même que côté serveur),
// les yeux en pastille (décision 1), la couleur le temps de l'émotion puis celle du thème (décision 2), l'arbitrage
// entre émotions, l'habituation, le sens des anciens appels (set, flash, base) et le style posé par le fichier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as humeurs from '../src/mood/mood.ts';

interface Ligne { id: string; nom: string; famille: string; degre: number; emoji: string; tint: string[]; dure: number; socle: string }
interface Dessin { id: string; forme: string; genre: string; mesure: number[][]; yeux: string[]; sourcils: string; bouche: string; joues: string; sous: string; extras: string; vars: Record<string, string | number>; classes: string[]; entree: string; tint: string[] }
interface Vue { id: string; couleur: boolean; vif: boolean; parle: boolean; reveil: number | null }
interface Etat { fond: string; fondPose: boolean; emo: { id: string; de: number; a: number } | null; tenus: Array<{ qui: string; id: string; a: number }>; parle: { a: number } | null; dernier: { ok: boolean; ms: number; geste: boolean } | null }
interface Action { type: string; id?: string; ms?: number; qui?: string; oui?: boolean; couleur?: boolean; force?: boolean; sansHabitude?: boolean; raison?: string; source?: string }
interface Visage {
  MOODS: Record<string, Ligne>;
  FAMILLES: Record<string, { nom: string; base: string; valence: number; eveil: number; ids: string[] }>;
  liste(): Ligne[]; connu(id: unknown): string; socle(id: string): string; echelle(id: string): string[]; monter(id: string): string; descendre(id: string): string; duree(id: string, ms?: number): number;
  dessin(id: string, o?: { taille?: string; vif?: boolean; parle?: boolean }): Dessin;
  tintBase(hex: string | null): void;
  ressent(el: unknown, id: string, o?: object): number; geste(el: unknown, nom: string): boolean; set(el: unknown, id: string, passing?: boolean): void; all(id: string): void;
  etat(el: unknown): { id: string; couleur: boolean; teinte: string; fond: string; emotion: unknown; tenu: string | null; parle: boolean };
  couleur(el: unknown): string[]; sound(nom: string): void; soundOn: boolean;
  pur: { etatNeuf(): Etat; agir(e: Etat, a: Action, t: number): Etat; vue(e: Etat, t: number): Vue; DEG: Record<string, number[]> };
  CSS: string;
}

const SOURCE = readFileSync(new URL('../src/web/face.js', import.meta.url), 'utf8');
/** Charge face.js hors navigateur : une fenêtre vide, aucune page. */
function charger(): Visage {
  const window: { OdinFace?: Visage } = {};
  runInNewContext(SOURCE, { window, setTimeout, clearTimeout });
  assert.ok(window.OdinFace, 'face.js pose window.OdinFace');
  return window.OdinFace;
}
/** Copie simple (les objets viennent d'un autre contexte : on compare leur contenu). */
const net = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const F = charger(), { etatNeuf, agir, vue, DEG } = F.pur;
/** La palette, recopiée dans ce contexte. */
const liste = (f: Visage = F): Ligne[] => net(f.liste());
const ressent = (e: Etat, id: string, t: number, o: Partial<Action> = {}) => agir(e, { type: 'ressent', id, ...o }, t);
const ok = (e: Etat) => { assert.ok(e.dernier); return e.dernier; };

const ORIGINE = ['neutre', 'joie', 'rire', 'amour', 'fierte', 'excite', 'clin', 'malice', 'surprise', 'reflexion', 'concentration', 'confus', 'inquiet', 'triste', 'colere', 'peur', 'gene', 'fatigue', 'ecoute', 'regarde', 'parle', 'cache'];
// Les 16 familles du contrat : nom, humeur de base, valence, éveil, et leur échelle (du plus léger au plus fort).
const FAMILLES: Record<string, [string, string, number, number, string]> = {
  joie: ['Joie', 'joie', 1, 2, 'serenite contentement joie rire euphorie'],
  tristesse: ['Tristesse', 'triste', -1, 0, 'melancolie triste chagrin pleurs'],
  colere: ['Colère', 'colere', -1, 2, 'agacement frustration colere rage'],
  peur: ['Peur', 'peur', -1, 2, 'inquiet apprehension peur terreur panique'],
  surprise: ['Surprise', 'surprise', 0, 2, 'etonnement surprise stupeur'],
  degout: ['Dégoût', 'confus', -1, 1, 'moue degout mepris'],
  amour: ['Amour et lien', 'amour', 1, 1, 'confiance tendresse gratitude admiration amour'],
  fierte: ['Fierté et assurance', 'fierte', 1, 1, 'satisfaction assurance fierte determination'],
  gene: ['Gêne', 'gene', -1, 1, 'timidite gene culpabilite honte'],
  envie: ['Envie', 'malice', -1, 1, 'envie jalousie'],
  attente: ['Attente', 'excite', 1, 2, 'curiosite interet espoir impatience enthousiasme excite'],
  manque: ['Déception et manque', 'triste', -1, 0, 'ennui nostalgie deception solitude'],
  fatigue: ['Fatigue', 'fatigue', -1, 0, 'lassitude fatigue epuisement sommeil'],
  esprit: ['Esprit', 'reflexion', 0, 1, 'clin reflexion doute concentration confus malice'],
  calme: ['Soulagement et calme', 'neutre', 1, 0, 'neutre calme soulagement'],
  dialogue: ['Dialogue', 'ecoute', 0, 1, 'ecoute regarde parle cache'],
};
const EMPREINTE = 'bfda46af5ad69ece7d40e4acbe8ec02cb302d61279781f3c539e669b8c99e1c6';
const TAILLES = ['grand', 'petit', 'mini'];

test('face.js se charge sans navigateur, deux fois de suite, sans état partagé', () => {
  const a = charger(), b = charger();
  assert.notEqual(a, b); assert.notEqual(a.MOODS, b.MOODS);
  a.tintBase('#22AA66');
  assert.equal(a.MOODS.neutre.tint[1], '#22AA66'); assert.equal(b.MOODS.neutre.tint[1], '#3F82F0', 'le second chargement ne voit pas le premier');
  // Sans page : les appels qui touchent une mascotte ne font rien et ne lèvent rien.
  assert.equal(a.ressent(null, 'joie'), 0); assert.equal(a.ressent({}, 'joie'), 0); assert.equal(a.geste({}, 'sursaut'), false);
  a.set(null, 'joie'); a.all('joie'); a.sound('joie'); a.sound('appel');
  assert.deepEqual(net(a.etat({})), { id: 'neutre', famille: 'calme', degre: 1, couleur: false, teinte: '#22AA66', fond: 'neutre', emotion: null, tenu: null, parle: false });
  assert.deepEqual(net(a.couleur(null)), net(a.MOODS.neutre.tint));
  for (const nom of ['MOODS', 'FAMILLES', 'set', 'all', 'flash', 'base', 'own', 'sound', 'mute', 'blinkSounds', 'tintBase', 'soundOn', 'liste', 'connu', 'socle', 'echelle', 'monter', 'descendre', 'duree', 'ressent', 'fond', 'tenir', 'lacher', 'parole', 'geste', 'etat', 'couleur', 'dessin', 'pur', 'CSS']) assert.ok(nom in a, `OdinFace.${nom}`);
  assert.deepEqual(Object.keys(a.pur).sort(), ['DEG', 'agir', 'etatNeuf', 'vue']);
  assert.deepEqual(net(DEG), { pic: [0, 260, 420, 600], exa: [0, 1.06, 1.12, 1.2], monte: [0, 900, 500, 250], retour: [0, 1200, 1800, 2600], plafond: [0, 20000, 60000, 120000], ampli: [0, .6, 1, 1.25] });
});

test('palette : 66 émotions, 16 familles, l\'empreinte du contrat', () => {
  const L = liste(), ids = L.map((m) => m.id);
  assert.equal(L.length, 66); assert.equal(new Set(ids).size, 66, 'identifiants uniques');
  assert.deepEqual(net(Object.keys(F.MOODS)), net(ids), 'MOODS et liste() dans le même ordre');
  for (const o of ORIGINE) assert.ok(ids.includes(o), `humeur d'origine gardée : ${o}`);
  const texte = L.map((m) => `${m.id}|${m.nom}|${m.famille}|${m.degre}|${m.emoji}|${m.tint.join(',')}|${m.dure}|${m.socle}`).sort().join('\n');
  assert.equal(createHash('sha256').update(texte, 'utf8').digest('hex'), EMPREINTE, 'une ligne diffère du tableau du contrat : corriger la ligne, jamais l\'empreinte');
  assert.deepEqual(Object.keys(F.FAMILLES), Object.keys(FAMILLES));
  for (const [f, [nom, base, valence, eveil, echelle]] of Object.entries(FAMILLES)) {
    assert.deepEqual(net(F.FAMILLES[f]), { nom, base, valence, eveil, ids: echelle.split(' ') }, f);
    assert.ok(ORIGINE.includes(base), `${f} : base d'origine`);
  }
  assert.deepEqual(net(ids), Object.values(FAMILLES).flatMap((x) => x[4].split(' ')), 'l\'ordre de la liste est celui du tableau');
  for (const m of L) {
    const M = F.MOODS[m.id];
    assert.deepEqual([M.id, M.nom, M.famille, M.degre, M.emoji, M.dure, M.socle], [m.id, m.nom, m.famille, m.degre, m.emoji, m.dure, m.socle], m.id);
    assert.ok(/^[a-z]+$/.test(m.id), `identifiant simple : ${m.id}`);
    assert.ok([1, 2, 3].includes(m.degre), m.id);
    assert.ok(ORIGINE.includes(m.socle), `${m.id} : socle parmi les 22 d'origine`);
    if (ORIGINE.includes(m.id)) assert.equal(m.socle, m.id, `${m.id} : une humeur d'origine est son propre socle`);
    assert.ok(m.dure * 1000 <= DEG.plafond[m.degre], `${m.id} : durée typique sous le plafond de son degré`);
    assert.equal([...m.emoji].length, 1, `${m.id} : une icône d'un seul caractère`);
    assert.equal(F.socle(m.id), m.socle); assert.equal(F.connu(m.id), m.id);
  }
  assert.equal(F.connu('nimporte'), 'neutre'); assert.equal(F.connu(undefined), 'neutre'); assert.equal(F.connu('toString'), 'neutre');
  assert.equal(F.socle('nimporte'), 'nimporte');
});

test('même palette que le serveur (src/mood/mood.ts)', (t) => {
  const S = humeurs as unknown as { MOODS: Record<string, { label: string; famille?: string; degre?: number; emoji?: string; tint?: readonly string[]; dure?: number; socle?: string }>; MOOD_IDS: string[]; MOOD_EMOJI: Record<string, string>; FAMILLES?: Record<string, { nom: string; base: string; valence: number; eveil: number }> };
  if (!S.FAMILLES) return void t.skip('la palette du serveur n\'est pas encore posée (lot « vie »)');
  const L = liste();
  assert.deepEqual([...S.MOOD_IDS].sort(), L.map((m) => m.id).sort(), 'mêmes identifiants');
  assert.deepEqual(S.MOOD_IDS.slice(0, 20), ORIGINE.slice(0, 20), 'les 20 premières dans l\'ordre d\'origine (pack d\'émojis Telegram)');
  assert.deepEqual(S.MOOD_IDS.slice(20, 22), ['parle', 'cache']);
  assert.deepEqual(S.MOOD_IDS.slice(22), L.map((m) => m.id).filter((id) => !ORIGINE.includes(id)), 'puis les nouvelles dans l\'ordre du tableau');
  for (const m of L) {
    const s = S.MOODS[m.id];
    assert.ok(s, `${m.id} existe côté serveur`);
    assert.deepEqual([s.label, s.famille, s.degre, s.emoji, [...(s.tint ?? [])], s.dure, s.socle], [m.nom, m.famille, m.degre, m.emoji, net(m.tint), m.dure, m.socle], m.id);
    assert.equal(S.MOOD_EMOJI[m.id], m.emoji, `${m.id} : même icône`);
  }
  for (const [f, x] of Object.entries(F.FAMILLES)) assert.deepEqual(net(S.FAMILLES[f]), { nom: x.nom, base: x.base, valence: x.valence, eveil: x.eveil }, f);
});

test('décision 1 : des yeux en pastille partout, carrés pour la seule concentration', () => {
  for (const m of liste()) for (const taille of TAILLES) for (const vif of [true, false]) {
    const D = F.dessin(m.id, { taille, vif });
    // Seule exception avec la concentration : l'endormi a les yeux fermés (deux pastilles couchées).
    if (m.id === 'sommeil') { assert.equal(D.genre, 'ferme', 'endormi : yeux fermés'); for (const [l, h] of D.mesure) assert.ok(l >= 2.5 * h, 'endormi : une pastille couchée'); continue; }
    assert.equal(D.genre, 'pastille', `${m.id} (${taille})`);
    assert.equal(D.mesure.length, 2); assert.equal(D.yeux.length, 2);
    for (const [largeur, hauteur] of D.mesure) {
      const rapport = hauteur / largeur;
      if (m.id === 'concentration') assert.ok(rapport >= .8 && rapport <= 1.25, `concentration : yeux carrés (${rapport})`);
      else assert.ok(hauteur >= 1.5 * largeur - 1e-9, `${m.id} (${taille}) : pastille debout, rapport ${rapport.toFixed(2)}`);
    }
    for (const oeil of D.yeux) assert.match(oeil, /class="eye( plein)?"/, `${m.id} : chaque œil est un dessin plein, jamais un trait`);
    // Le corps peut s'écraser (affaissé, tassé) : les yeux sont remis à leur forme.
    const sx = Number(D.vars['--o-sx']), sy = Number(D.vars['--o-sy']), yx = Number(D.vars['--o-yx']), yy = Number(D.vars['--o-yy']);
    assert.ok(Math.abs(sx * yx - sy * yy) < 0.002, `${m.id} : le corps n'aplatit pas les yeux`);
  }
  const carres = liste().filter((m) => F.dessin(m.id).mesure.some(([l, h]) => h / l < 1.5 - 1e-9)).map((m) => m.id);
  // Deux exceptions voulues par le propriétaire : l'endormi (yeux fermés) et la concentration (yeux carrés).
  assert.deepEqual(carres, ['sommeil', 'concentration'], "yeux fermés pour l'endormi, carrés pour la seule concentration");
  assert.ok(!SOURCE.includes('squint'), 'l\'ancienne forme aplatie a disparu');
  assert.match(SOURCE, /const FORMES_LIBRES = false;/, 'les formes libres (arcs, cœurs, étoiles) restent éteintes');
  // Le repos : la pastille 9 × 22 d'origine.
  assert.deepEqual(net(F.dessin('neutre').mesure), [[9, 22], [9, 22]]);
});

const rvb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function teinteDe(h: string): number {
  const [r, g, b] = rvb(h).map((v) => v / 255), max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const t = 60 * (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return t < 0 ? t + 360 : t;
}
const lumiere = (h: string) => { const [r, g, b] = rvb(h).map((v) => { const x = v / 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };

test('couleurs : 4 teintes valides, toutes distinctes, lisibles ; colère et rage rouges ; le thème ne touche que le repos', () => {
  const L = liste();
  for (const m of L) {
    assert.equal(m.tint.length, 4, m.id);
    for (const t of m.tint) assert.match(t, /^#[0-9A-F]{6}$/, `${m.id} : ${t}`);
    assert.ok(1.05 / (lumiere(m.tint[1]) + .05) >= 1.6, `${m.id} : le blanc des yeux se lit sur sa couleur`);
  }
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    if (L[i].id === 'neutre' || L[j].id === 'neutre') continue;
    const a = rvb(L[i].tint[1]), b = rvb(L[j].tint[1]);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= 12, `couleurs trop proches : ${L[i].id} et ${L[j].id}`);
  }
  for (const id of ['colere', 'rage']) { const t = teinteDe(F.MOODS[id].tint[1]); assert.ok(t <= 15 || t >= 345, `${id} est rouge (${t.toFixed(0)}°)`); }
  // La couleur du thème : seule l'humeur de repos change, et la liste garde le bleu d'origine.
  const G = charger(), avant = net(G.MOODS);
  G.tintBase('#22AA66');
  for (const m of liste(G)) {
    if (m.id === 'neutre') { assert.equal(G.MOODS.neutre.tint[1], '#22AA66'); assert.equal(G.MOODS.neutre.tint.length, 4); for (const t of G.MOODS.neutre.tint) assert.match(t, /^#[0-9a-f]{6}$/i); }
    else assert.deepEqual(net(G.MOODS[m.id]), avant[m.id], m.id);
  }
  assert.deepEqual(net(liste(G).find((m) => m.id === 'neutre')?.tint), ['#2F6FE0', '#3F82F0', '#7EAEF8', '#C3DBFF']);
  assert.deepEqual(net(G.couleur(null)), net(G.MOODS.neutre.tint), 'au repos, il porte la couleur du thème');
  G.tintBase('pas une couleur'); assert.deepEqual(net(G.MOODS.neutre.tint), ['#2F6FE0', '#3F82F0', '#7EAEF8', '#C3DBFF'], 'couleur invalide : retour à l\'origine');
  G.tintBase('#22AA66'); G.tintBase(null); assert.deepEqual(net(G.MOODS.neutre.tint), ['#2F6FE0', '#3F82F0', '#7EAEF8', '#C3DBFF']);
});

const BOUCHES_PLEINES = /class="(dit |baille )?plein( bord)?"/;
const signature = (D: Dessin) => JSON.stringify([D.forme, D.mesure, D.vars['--edx'], D.tint, D.sourcils, D.bouche, D.joues, D.sous, D.extras, D.vars['--o-rot'], D.vars['--o-px'], D.vars['--o-py'], D.vars['--o-sx'], D.vars['--o-sy'], D.classes.filter((c) => c.startsWith('c-')), D.entree]);

test('dessin : complet pour les 66 émotions, 66 visages différents (yeux, couleur, mouvement), trois tailles, rien d\'autre que les yeux', () => {
  const VARS = ['--lsx', '--lsy', '--rsx', '--rsy', '--edx', '--edy', '--o-gx', '--o-gy', '--o-suivi', '--o-rot', '--o-px', '--o-py', '--o-sx', '--o-sy', '--o-clign', '--o-orbite', '--o-aura', '--o-c0', '--o-c2'];
  const vus = new Map<string, string>();
  for (const m of liste()) {
    for (const taille of TAILLES) for (const vif of [true, false]) for (const parle of [false, true]) {
      const D = F.dessin(m.id, { taille, vif, parle }), texte = JSON.stringify(D);
      assert.ok(!/undefined|NaN|null/.test(texte), `${m.id} (${taille}) : dessin complet`);
      for (const v of VARS) assert.ok(v in D.vars, `${m.id} : variable ${v}`);
      assert.ok(D.classes.includes(`o-${taille}`)); assert.equal(D.classes.filter((c) => c.startsWith('c-')).length, 1, `${m.id} : une seule boucle`);
      assert.deepEqual(net(D.tint), net(F.MOODS[m.id].tint)); assert.equal(D.id, m.id);
      for (const bout of [...D.yeux, D.sourcils, D.bouche, D.joues, D.sous, D.extras]) {
        assert.equal(typeof bout, 'string');
        assert.equal((bout.match(/<(?!\/)/g) ?? []).length, (bout.match(/\/>|<\//g) ?? []).length, `${m.id} : balises fermées`);
      }
    }
    const D = F.dessin(m.id), s = signature(D);
    assert.ok(!vus.has(s), `même visage : ${m.id} et ${vus.get(s)}`); vus.set(s, m.id);
    // Tout petit : toujours rien d'autre que les yeux.
    const mini = F.dessin(m.id, { taille: 'mini' }), petit = F.dessin(m.id, { taille: 'petit' });
    assert.equal(mini.sourcils, '', `${m.id} : pas de sourcils en tout petit`); assert.equal(mini.joues, ''); assert.equal(petit.joues, '');
    if (mini.bouche) assert.match(mini.bouche, BOUCHES_PLEINES, `${m.id} : bouche pleine en tout petit`);
    assert.ok(mini.extras.length <= petit.extras.length && petit.extras.length <= D.extras.length, `${m.id} : moins de détails quand il est petit`);
    assert.ok(Number(mini.mesure[0][0]) > Number(petit.mesure[0][0]) && Number(petit.mesure[0][0]) > Number(D.mesure[0][0]), `${m.id} : des yeux plus grands quand il est petit`);
    // Il parle : seule la boucle du corps change, sans bouche ; le reste est celui de l'émotion.
    const dit = F.dessin(m.id, { parle: true });
    assert.deepEqual([dit.yeux, dit.sourcils, dit.extras, dit.sous, dit.joues, dit.mesure, dit.tint], [D.yeux, D.sourcils, D.extras, D.sous, D.joues, D.mesure, D.tint], `${m.id} : il parle avec le visage de son émotion`);
    assert.equal(dit.bouche, '', `${m.id} : il parle sans bouche`);
    const boucle = D.classes.find((c) => c.startsWith('c-')), boucleDit = dit.classes.find((c) => c.startsWith('c-'));
    assert.equal(boucleDit, ['c-rire', 'c-sanglot', 'c-tremble', 'c-secoue', 'c-affole'].includes(boucle ?? '') ? boucle : 'c-parle', m.id);
    // Fond adouci : respiration, posture à mi-ampleur, peu d'extras, aucun geste d'arrivée.
    const doux = F.dessin(m.id, { vif: false });
    assert.ok(doux.classes.includes('c-souffle'), `${m.id} : le fond respire`); assert.equal(doux.entree, '');
    assert.ok(Math.abs(parseFloat(String(doux.vars['--o-rot'])) * 2 - parseFloat(String(D.vars['--o-rot']))) < 0.02, `${m.id} : posture à mi-ampleur`);
    assert.ok(doux.extras.length <= D.extras.length); assert.ok(!doux.classes.includes('o-vive'));
    // (Le clin d'œil ne se lit que par son animation : adouci, son œil droit est dessiné plus court.)
    if (m.id !== 'clin') assert.deepEqual(doux.yeux, D.yeux, `${m.id} : mêmes yeux, adouci ou non`);
  }
  assert.equal(vus.size, 66);
  // Quelques visages précis, tels que décrits.
  // RÈGLE DU PROPRIÉTAIRE : Odin n'a que ses deux yeux en pastille et sa couleur. Ni bouche, ni sourcils, ni joues, ni dents,
  // ni larmes, ni aucun ajout, pour les 66 émotions, à toutes les tailles, vif ou adouci, qu'il parle ou non, figé ou non.
  for (const m of liste()) for (const taille of TAILLES) for (const vif of [true, false]) for (const parle of [false, true]) for (const fige of [false, true]) {
    const D = F.dessin(m.id, { taille, vif, parle, fige } as never);
    const dort = m.id === 'sommeil';
    assert.deepEqual([D.sourcils, D.bouche, D.joues, D.sous], ['', '', '', ''], `${m.id} (${taille}) : ni bouche, ni sourcils, ni joues`);
    // Seul ajout permis par le propriétaire : les « zzz » de l'endormi.
    if (dort) assert.equal((D.extras.match(/</g) ?? []).length, (D.extras.match(/<path class="zz /g) ?? []).length, 'endormi : rien d\'autre que des zzz');
    else assert.equal(D.extras, '', `${m.id} (${taille}) : rien d'autre que les yeux`);
    assert.equal(D.yeux.length, 2, `${m.id} : deux yeux`);
    for (const o of D.yeux) {
      assert.equal((o.match(/</g) ?? []).length, 1, `${m.id} : un œil = une seule forme, d'une seule couleur`);
      assert.match(o, dort ? /^<rect class="plein ferme"/ : /^<(rect|path) class="eye plein"/, `${m.id} : une pastille pleine`);
    }
    assert.equal(D.genre, dort ? 'ferme' : 'pastille', `${m.id} : des yeux en pastille (fermés pour l'endormi)`);
  }
  // Chaque émotion a ses pastilles à elle : 66 paires d'yeux différentes (forme, taille, écart, hauteur), sans compter la couleur ni le mouvement.
  const paires = new Map<string, string>();
  for (const m of liste()) { const D = F.dessin(m.id), k = JSON.stringify([D.forme, D.mesure, D.vars['--edx'], D.vars['--edy']]); assert.ok(!paires.has(k), `mêmes yeux : ${m.id} et ${paires.get(k)}`); paires.set(k, m.id); }
  assert.equal(paires.size, 66);
  assert.match(SOURCE, /const YEUX_SEULS = true;/, 'la règle « yeux seuls » est allumée');
  // L'endormi : yeux fermés, zzz au-dessus de lui, et toujours pas de bouche.
  { const D = F.dessin('sommeil'); assert.equal(D.forme, 'ferme'); assert.match(D.extras, /class="zz /); assert.equal(D.bouche, ''); assert.equal((D as Dessin & { encre: string }).encre, '#fff'); }
  assert.ok(F.dessin('cache').classes.includes('sans-clin') && F.dessin('cache').classes.includes('sans-coup'));
  assert.ok(F.dessin('rage').classes.includes('o-vive')); assert.ok(!F.dessin('colere').classes.includes('o-vive'));
  assert.deepEqual(net(F.dessin('neutre')), net({ ...F.dessin('neutre'), sourcils: '', bouche: '', joues: '', sous: '', extras: '', entree: '', classes: ['c-souffle', 'o-grand'] }), 'au repos : deux pastilles, rien d\'autre');
  assert.equal(F.dessin('inconnu').id, 'neutre'); assert.ok(F.dessin('joie', { taille: 'nimporte' }).classes.includes('o-grand'));
});

test('style : chaque classe a sa règle, chaque animation ses images clés, mouvement réduit respecté', () => {
  const css = F.CSS, ui = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
  // Les petites animations d'yeux d'origine restent celles de la page (ui.html).
  const PAGE = ['e-bob', 'e-giggle', 'e-pulse', 'e-sparkle', 'e-sly', 'e-pop', 'e-ponder', 'e-dart', 'e-sink', 'e-shiver', 'e-shy', 'e-attent', 'e-talk', 'm-look'];
  const classes = new Set<string>(), gestes = new Set<string>();
  for (const m of liste()) for (const taille of TAILLES) for (const vif of [true, false]) for (const parle of [false, true]) {
    const D = F.dessin(m.id, { taille, vif, parle });
    for (const c of D.classes) classes.add(c);
    if (D.entree) gestes.add(D.entree);
  }
  for (const c of classes) {
    assert.match(c, /^(e-|c-|m-|o-|sans-)/, `classe hors des préfixes du visage : ${c}`);
    if (PAGE.includes(c)) assert.ok(ui.includes(`.odin.${c} `), `${c} : règle attendue dans ui.html`);
    else if (c.startsWith('c-')) assert.ok(css.includes(`\n.${c} .body{`), `${c} : règle de boucle (poids 0,2,0)`);
    else if (c !== 'o-grand') assert.ok(css.includes(`.odin.${c}`), `${c} : règle dans le style du visage`); // la grande taille est celle par défaut
  }
  for (const g of ['sursaut', 'bond', 'recul', 'tasse', 'gonfle', 'fond', 'penche', 'fremit', 'hoche']) assert.ok(css.includes(`\n.odin.g-${g} .body{animation:g-${g} `), `geste ${g}`);
  for (const g of gestes) assert.ok(css.includes(`.odin.g-${g} .body{`), `geste d'arrivée ${g}`);
  for (const b of ['souffle', 'lent', 'vif', 'rebond', 'sautille', 'rire', 'tremble', 'frisson', 'sanglot', 'gronde', 'secoue', 'balance', 'battement', 'dodeline', 'trepigne', 'hoche', 'affole', 'parle', 'fige']) assert.ok(css.includes(`\n.c-${b} .body{`), `boucle ${b}`);
  // Chaque animation citée a ses images clés ici (ou vient de la page, dans la liste permise).
  const cles = new Set([...css.matchAll(/@keyframes ([\w-]+)/g)].map((x) => x[1]));
  const PERMIS = ['o-breathe', 'o-blink', 'o-glance', 'e-bob', 'e-giggle', 'e-pulse', 'e-sparkle', 'e-sly', 'e-pop', 'e-ponder', 'e-dart', 'e-sink', 'e-shiver', 'e-shy', 'e-attent'];
  const citees = [...css.matchAll(/animation:([a-z][\w-]*)/g)].map((x) => x[1]).filter((n) => n !== 'none');
  assert.ok(citees.length > 40);
  for (const n of citees) assert.ok(cles.has(n) || PERMIS.includes(n), `animation sans images clés : ${n}`);
  for (const n of cles) { assert.match(n, /^(c|g|x|f)-/, `nom d'animation nouveau : ${n}`); assert.ok(!ui.includes(`@keyframes ${n}{`), `${n} ne redéfinit pas une animation d'ui.html`); assert.ok(citees.includes(n), `images clés inutiles : ${n}`); }
  // Plus aucun ajout dessiné sur le visage (règle « yeux seuls »).
  assert.equal(liste().filter((m) => m.id !== 'sommeil').map((m) => { const D = F.dessin(m.id); return D.extras + D.bouche + D.sourcils + D.joues + D.sous; }).join(''), '');
  assert.ok(css.includes('@media (prefers-reduced-motion:reduce){.odin *{animation:none!important;transition:none!important}}'), 'mouvement réduit : ni boucle, ni geste, ni fondu');
  assert.ok(css.includes('.odin stop{transition:stop-color var(--o-fondu,.7s) ease}'), 'fondu de couleur réglable');
  assert.ok(css.includes('.odin.angry stop.s1,.odin.angry stop.s2,.odin.angry stop.s3,.odin.angry stop.s4{animation:none}'), 'plus de retour forcé au bleu');
  assert.ok(css.indexOf('.odin.o-vive stop.s2{') > css.indexOf('.odin.angry stop.s1'), 'la rage bat, même pendant la colère au toucher');
  assert.ok(css.includes('var(--lookx,0px)*var(--o-suivi,1)'), 'le regard suit le pointeur, plus ou moins selon l\'humeur');
  assert.ok(!/<\/(style|script)/i.test(SOURCE), 'le fichier peut être inséré tel quel dans une page');
  assert.ok(!/<\/(style|script)/i.test(css));
});

test('décision 2 : en couleur le temps de l\'émotion (2 minutes au plus), puis la couleur du thème', () => {
  let e = ressent(etatNeuf(), 'joie', 0);
  assert.deepEqual(net(ok(e)), { ok: true, ms: 25_000, geste: true });
  assert.deepEqual(net(vue(e, 10)), { id: 'joie', couleur: true, vif: true, parle: false, reveil: 25_000 });
  assert.equal(vue(e, 24_999).couleur, true);
  assert.deepEqual(net(vue(e, 25_000)), { id: 'neutre', couleur: false, vif: false, parle: false, reveil: null });
  // Rage : 90 s en rouge, puis 3 s un cran plus bas sans couleur, puis le fond.
  e = ressent(etatNeuf(), 'rage', 0);
  assert.deepEqual(net(vue(e, 89_999)), { id: 'rage', couleur: true, vif: true, parle: false, reveil: 90_000 });
  assert.deepEqual(net(vue(e, 90_000)), { id: 'colere', couleur: false, vif: false, parle: false, reveil: 93_000 });
  assert.deepEqual(net(vue(e, 93_000)), { id: 'neutre', couleur: false, vif: false, parle: false, reveil: null });
  // Une émotion de degré 2 ne retombe pas par paliers.
  e = ressent(etatNeuf(), 'colere', 0); assert.equal(vue(e, 40_000).id, 'neutre');
  // Jamais plus que le plafond du degré, quoi qu'on demande.
  assert.equal(F.duree('neutre'), 0); assert.equal(F.duree('nimporte'), 0); assert.equal(F.duree('joie'), 25_000); assert.equal(F.duree('joie', 100), 600); assert.equal(F.duree('joie', 3000), 3000);
  for (const m of liste()) {
    assert.ok(F.duree(m.id, 3_600_000) <= 120_000, m.id); assert.ok(F.duree(m.id, 3_600_000) <= DEG.plafond[m.degre], m.id); assert.ok(F.duree(m.id) <= DEG.plafond[m.degre], m.id);
    if (m.id === 'neutre') { assert.equal(ok(ressent(etatNeuf(), 'neutre', 0)).ms, 0); continue; }
    const x = ressent(etatNeuf(), m.id, 0, { ms: 3_600_000 });
    assert.equal(ok(x).ms, DEG.plafond[m.degre], m.id); assert.equal(vue(x, 1).couleur, true, m.id);
    assert.equal(vue(x, DEG.plafond[m.degre]).couleur, false, `${m.id} : plus de couleur passé son plafond`);
    assert.equal(vue(x, DEG.plafond[m.degre] + 3000).id, 'neutre', `${m.id} : retour au repos`);
  }
  // Un état tenu : sa couleur 20 s, puis seul le visage reste ; lâché tout seul au bout de 10 minutes.
  e = agir(etatNeuf(), { type: 'tenir', id: 'ecoute', qui: 'essai' }, 0);
  assert.deepEqual(net(vue(e, 19_999)), { id: 'ecoute', couleur: true, vif: true, parle: false, reveil: 20_000 });
  assert.deepEqual(net(vue(e, 20_000)), { id: 'ecoute', couleur: false, vif: true, parle: false, reveil: 600_000 });
  assert.equal(vue(e, 599_999).id, 'ecoute'); assert.equal(vue(e, 600_000).id, 'neutre');
  e = agir(etatNeuf(), { type: 'tenir', id: 'cache', qui: 'essai', ms: 5000 }, 0);
  assert.deepEqual([vue(e, 4999).id, vue(e, 4999).couleur, vue(e, 5000).id], ['cache', true, 'neutre']);
  // Tenu sans arrêt (on écrit pendant une minute) : la couleur ne repart pas à chaque fois.
  e = etatNeuf(); for (let t = 0; t <= 60_000; t += 2000) e = agir(e, { type: 'tenir', id: 'ecoute', qui: 'saisie', ms: 2500 }, t);
  assert.deepEqual([vue(e, 60_001).id, vue(e, 60_001).couleur], ['ecoute', false]);
  // Lâché puis repris aussitôt : même chose ; repris bien plus tard : la couleur revient.
  e = agir(etatNeuf(), { type: 'tenir', id: 'ecoute', qui: 'a' }, 0); e = agir(e, { type: 'lacher', qui: 'a' }, 30_000); e = agir(e, { type: 'tenir', id: 'ecoute', qui: 'a' }, 31_000);
  assert.equal(vue(e, 31_001).couleur, false);
  e = agir(agir(e, { type: 'lacher', qui: 'a' }, 40_000), { type: 'tenir', id: 'ecoute', qui: 'a' }, 100_000); assert.equal(vue(e, 100_001).couleur, true);
  // Le fond n'est jamais en couleur.
  e = agir(etatNeuf(), { type: 'fond', id: 'ennui' }, 0);
  for (const t of [0, 1, 1000, 60_000, 3_600_000, 86_400_000]) assert.deepEqual(net(vue(e, t)), { id: 'ennui', couleur: false, vif: false, parle: false, reveil: null });
  // 24 heures sans rien lui demander : jamais de couleur.
  e = etatNeuf(); for (let t = 0; t <= 86_400_000; t += 60_000) assert.equal(vue(e, t).couleur, false);
  e = agir(agir(ressent(etatNeuf(), 'rage', 0), { type: 'fond', id: 'solitude' }, 10), { type: 'tenir', id: 'regarde', qui: 'x', ms: 0 }, 20);
  for (let t = 123_100; t <= 86_400_000; t += 300_000) assert.equal(vue(e, t).couleur, false, `à ${t} ms`);
  assert.equal(vue(e, 86_400_000).id, 'solitude');
  // Les fonctions pures ne changent jamais l'état qu'on leur donne.
  const fige = JSON.stringify(e); agir(e, { type: 'ressent', id: 'joie', force: true }, 700_000); agir(e, { type: 'pose', id: 'cache' }, 700_000); vue(e, 700_000);
  assert.equal(JSON.stringify(e), fige);
});

test('arbitrage entre émotions, habituation, état tenu', () => {
  // Une plus faible n'interrompt pas une forte toute fraîche ; plus haut dans la même famille : tout de suite.
  let e = ressent(etatNeuf(), 'peur', 0);
  e = ressent(e, 'curiosite', 500); assert.equal(ok(e).ms, 0); assert.equal(vue(e, 600).id, 'peur');
  e = ressent(e, 'terreur', 700); assert.equal(ok(e).ms, 45_000); assert.equal(vue(e, 700).id, 'terreur');
  e = ressent(e, 'peur', 800); assert.equal(ok(e).ms, 0, 'même famille, plus bas : refusée'); assert.equal(vue(e, 900).id, 'terreur');
  e = ressent(e, 'neutre', 900); assert.equal(ok(e).ok, false); e = ressent(e, 'nimporte', 900); assert.equal(ok(e).ok, false); assert.equal(vue(e, 900).id, 'terreur');
  // Un éclat de joie pendant une colère commencée 1 s plus tôt : refusé. Passé 6 s, une autre émotion peut venir.
  e = ressent(etatNeuf(), 'colere', 0);
  e = agir(e, { type: 'flash', id: 'joie', ms: 1500 }, 1000); assert.deepEqual(net(ok(e)), { ok: false, ms: 0, geste: false }); assert.equal(vue(e, 1001).id, 'colere');
  e = agir(e, { type: 'flash', id: 'joie', ms: 1500 }, 5999); assert.equal(ok(e).ms, 0);
  e = agir(e, { type: 'flash', id: 'joie', ms: 1500 }, 6000); assert.equal(ok(e).ms, 1500); assert.deepEqual([vue(e, 6001).id, vue(e, 7500).id], ['joie', 'neutre']);
  // Une émotion courte cède plus vite : 60 % de sa durée.
  e = ressent(etatNeuf(), 'surprise', 0, { ms: 2000 }); assert.equal(ok(ressent(e, 'ennui', 1100)).ok, false); assert.equal(ok(ressent(e, 'ennui', 1200)).ok, true);
  // À degré égal, le rang de la famille tranche (peur 9, colère 8, surprise 7, tristesse 6, joie 5…).
  assert.equal(vue(ressent(ressent(etatNeuf(), 'joie', 0), 'peur', 100), 101).id, 'peur');
  assert.equal(vue(ressent(ressent(etatNeuf(), 'peur', 0), 'joie', 100), 101).id, 'peur');
  assert.equal(vue(ressent(ressent(etatNeuf(), 'triste', 0), 'colere', 100), 101).id, 'colere');
  // Un degré plus grand passe toujours ; avec « force », tout passe.
  assert.equal(vue(ressent(ressent(etatNeuf(), 'peur', 0), 'euphorie', 100), 101).id, 'euphorie');
  e = ressent(ressent(etatNeuf(), 'rage', 0), 'curiosite', 10, { force: true }); assert.equal(ok(e).ms, 10_000); assert.equal(vue(e, 11).id, 'curiosite');
  e = ressent(ressent(etatNeuf(), 'rage', 0), 'agacement', 10, { force: true }); assert.equal(vue(e, 11).id, 'agacement');
  assert.equal(vue(e, 8010).id, 'neutre', 'une émotion remplacée ne retombe pas par paliers');
  // Même émotion redemandée pendant qu'elle dure : prolongée, sans geste, jamais au-delà de début + plafond.
  e = ressent(etatNeuf(), 'joie', 0); e = ressent(e, 'joie', 20_000);
  assert.deepEqual(net(ok(e)), { ok: true, ms: 12_500, geste: false }); assert.equal(e.emo?.a, 32_500); assert.equal(e.emo?.de, 0);
  for (let t = 21_000; t < 60_000; t += 1000) { e = ressent(e, 'joie', t, { ms: 3_600_000 }); assert.equal(e.emo?.de, 0); assert.ok((e.emo?.a ?? 0) <= 60_000, `à ${t}`); assert.equal(ok(e).ms, (e.emo?.a ?? 0) - t); }
  assert.equal(e.emo?.a, 60_000); assert.equal(vue(e, 60_000).couleur, false);
  e = ressent(ressent(etatNeuf(), 'joie', 0), 'joie', 1000, { force: true }); assert.equal(e.emo?.de, 0, 'même avec « force », la même émotion est prolongée');
  // Habituation : trois fois la même en 90 s.
  e = ressent(etatNeuf(), 'joie', 0);
  e = ressent(e, 'joie', 30_000); assert.deepEqual([e.emo?.id, (e.emo?.a ?? 0) - (e.emo?.de ?? 0), ok(e).geste], ['joie', 15_000, false], '2e fois : 60 % de la durée, sans geste');
  e = ressent(e, 'joie', 60_000); assert.deepEqual([e.emo?.id, (e.emo?.a ?? 0) - (e.emo?.de ?? 0), ok(e).geste], ['contentement', 5000, false], '3e fois : un cran plus bas, moitié moins longtemps');
  e = ressent(e, 'joie', 80_000); assert.equal(e.emo?.id, 'contentement', '4e fois : toujours usée');
  e = ressent(e, 'joie', 80_000 + 200_000); assert.deepEqual([e.emo?.id, (e.emo?.a ?? 0) - (e.emo?.de ?? 0), ok(e).geste], ['joie', 25_000, true], 'le temps a passé : elle revient entière');
  // 90 s après la fin de la précédente, pas après son début.
  e = ressent(etatNeuf(), 'pleurs', 0); e = ressent(e, 'pleurs', 70_000 + 89_999); assert.equal((e.emo?.a ?? 0) - (e.emo?.de ?? 0), 42_000);
  e = ressent(ressent(etatNeuf(), 'pleurs', 0), 'pleurs', 70_000 + 90_000); assert.equal((e.emo?.a ?? 0) - (e.emo?.de ?? 0), 70_000);
  // Sans habituation sur demande ; les états de dialogue ne s'usent pas ; un éclat s'use comme le reste.
  e = ressent(ressent(etatNeuf(), 'joie', 0), 'joie', 30_000, { sansHabitude: true }); assert.equal((e.emo?.a ?? 0) - (e.emo?.de ?? 0), 25_000);
  e = ressent(ressent(ressent(etatNeuf(), 'regarde', 0), 'regarde', 21_000), 'regarde', 42_000); assert.deepEqual([e.emo?.id, (e.emo?.a ?? 0) - (e.emo?.de ?? 0)], ['regarde', 20_000]);
  e = etatNeuf(); for (const t of [0, 3000, 6000]) e = agir(e, { type: 'flash', id: 'joie', ms: 2200 }, t);
  assert.deepEqual([e.emo?.id, (e.emo?.a ?? 0) - (e.emo?.de ?? 0)], ['contentement', 1100]);
  // Tout en bas de l'échelle, elle ne peut que raccourcir.
  e = etatNeuf(); for (const t of [0, 10_000, 20_000]) e = ressent(e, 'agacement', t); assert.deepEqual([e.emo?.id, (e.emo?.a ?? 0) - (e.emo?.de ?? 0)], ['agacement', 4000]);
  // État tenu : une émotion de degré 2 née après lui passe devant 4 s, puis il revient et elle continue dessous.
  e = agir(etatNeuf(), { type: 'tenir', id: 'ecoute', qui: 'x' }, 0); e = ressent(e, 'colere', 1000);
  assert.deepEqual(net(vue(e, 1001)), { id: 'colere', couleur: true, vif: true, parle: false, reveil: 5000 });
  assert.equal(vue(e, 4999).id, 'colere'); assert.deepEqual([vue(e, 5000).id, vue(e, 5000).couleur], ['ecoute', true]);
  assert.equal(e.emo?.a, 41_000); e = agir(e, { type: 'lacher', qui: 'x' }, 6000); assert.deepEqual([vue(e, 6001).id, vue(e, 6001).couleur, vue(e, 41_000).id], ['colere', true, 'neutre']);
  // Une émotion légère ne passe pas devant ; une émotion née avant l'état tenu non plus (même dans la même milliseconde).
  e = ressent(agir(etatNeuf(), { type: 'tenir', id: 'cache', qui: 'x' }, 0), 'curiosite', 1000); assert.equal(ok(e).ok, true); assert.equal(vue(e, 1001).id, 'cache');
  e = agir(ressent(etatNeuf(), 'colere', 0), { type: 'tenir', id: 'cache', qui: 'x' }, 0); assert.equal(vue(e, 0).id, 'cache'); assert.equal(vue(e, 1).id, 'cache');
  // Plusieurs demandeurs : le plus récent se voit ; le même demandeur remplace le sien.
  e = agir(agir(etatNeuf(), { type: 'tenir', id: 'ecoute', qui: 'a' }, 0), { type: 'tenir', id: 'regarde', qui: 'b' }, 10); assert.equal(vue(e, 11).id, 'regarde');
  e = agir(e, { type: 'tenir', id: 'cache', qui: 'a' }, 20); assert.equal(vue(e, 21).id, 'cache'); assert.equal(e.tenus.length, 2);
  e = agir(e, { type: 'lacher', qui: 'a' }, 30); assert.equal(vue(e, 31).id, 'regarde'); e = agir(e, { type: 'lacher', qui: 'b' }, 40); assert.equal(vue(e, 41).id, 'neutre');
  e = agir(agir(etatNeuf(), { type: 'tenir', id: 'ecoute' }, 0), { type: 'lacher' }, 10); assert.equal(e.tenus.length, 0, 'demandeur par défaut');
  // Il parle par-dessus l'expression en cours, et s'arrête seul.
  e = agir(ressent(etatNeuf(), 'triste', 0), { type: 'parole', oui: true, ms: 3000 }, 10);
  assert.deepEqual(net(vue(e, 20)), { id: 'triste', couleur: true, vif: true, parle: true, reveil: 3010 }); assert.equal(vue(e, 3010).parle, false);
  e = agir(agir(etatNeuf(), { type: 'parole', oui: true }, 0), { type: 'parole', oui: false }, 500); assert.equal(vue(e, 501).parle, false);
  assert.equal(vue(agir(etatNeuf(), { type: 'parole', oui: true }, 0), 600_000).parle, false, 'garde-fou : il ne parle pas plus de 10 minutes sans qu\'on le redise');
  // Échelles : monter et descendre restent dans la famille.
  assert.deepEqual(net(F.echelle('colere')), ['agacement', 'frustration', 'colere', 'rage']);
  assert.deepEqual([F.monter('colere'), F.monter('rage'), F.descendre('colere'), F.descendre('agacement'), F.descendre('joie'), F.monter('nimporte')], ['rage', 'rage', 'frustration', 'agacement', 'contentement', 'calme']);
  for (const m of liste()) { assert.equal(F.MOODS[F.monter(m.id)].famille, m.famille); assert.equal(F.MOODS[F.descendre(m.id)].famille, m.famille); assert.ok(F.echelle(m.id).includes(m.id)); }
});

test('anciens appels : flash, base et set gardent leur signature et prennent un sens précis', () => {
  const pose = (e: Etat, id: string, t: number, couleur = false) => agir(e, { type: 'pose', id, couleur }, t);
  // flash : un état de dialogue est tenu le temps demandé, et ignoré si un état est déjà tenu.
  let e = agir(etatNeuf(), { type: 'flash', id: 'ecoute', ms: 1500 }, 0);
  assert.deepEqual(net(e.tenus.map((x) => [x.qui, x.id, x.a])), [['flash', 'ecoute', 1500]]); assert.deepEqual([vue(e, 1499).id, vue(e, 1500).id], ['ecoute', 'neutre']);
  e = agir(pose(etatNeuf(), 'cache', 0), { type: 'flash', id: 'ecoute', ms: 1500 }, 100);
  assert.equal(ok(e).ok, false); assert.equal(vue(e, 101).id, 'cache'); assert.equal(e.tenus.length, 1);
  e = agir(pose(etatNeuf(), 'cache', 0), { type: 'flash', id: 'concentration', ms: 1500 }, 100); assert.equal(vue(e, 101).id, 'cache');
  e = agir(etatNeuf(), { type: 'flash', id: 'concentration' }, 0); assert.deepEqual([vue(e, 2199).id, vue(e, 2200).id], ['concentration', 'neutre'], 'durée par défaut : 2,2 s');
  // Un éclat qui suit un autre éclat (on écrit : un toutes les 900 ms) le prolonge sans trou, et sa couleur ne repart pas.
  e = etatNeuf(); for (let t = 0; t <= 45_000; t += 900) { e = agir(e, { type: 'flash', id: 'ecoute', ms: 1600 }, t); assert.equal(vue(e, t + 899).id, 'ecoute', `à ${t}`); assert.equal(ok(e).geste, t === 0, 'un seul geste d\'arrivée'); }
  assert.deepEqual([e.tenus.length, vue(e, 45_100).couleur, vue(e, 46_600).id], [1, false, 'neutre']);
  e = agir(agir(etatNeuf(), { type: 'flash', id: 'concentration', ms: 1600 }, 0), { type: 'flash', id: 'regarde', ms: 1600 }, 800); assert.deepEqual([vue(e, 801).id, e.tenus.length], ['regarde', 1], 'le plus récent des deux éclats se voit');
  // flash('neutre') ou d'une humeur inconnue : rien ; d'une émotion : ressentie le temps demandé.
  for (const id of ['neutre', 'nimporte']) { e = agir(ressent(etatNeuf(), 'joie', 0), { type: 'flash', id, ms: 1500 }, 100); assert.equal(ok(e).ok, false); assert.equal(vue(e, 101).id, 'joie'); }
  e = agir(etatNeuf(), { type: 'flash', id: 'surprise', ms: 900 }, 0); assert.deepEqual([vue(e, 1).id, vue(e, 1).couleur, vue(e, 900).id], ['surprise', true, 'neutre']);
  // Un éclat d'émotion pendant un état tenu : il passe devant (degré 2) puis l'état tenu revient.
  e = agir(pose(etatNeuf(), 'ecoute', 0), { type: 'flash', id: 'joie', ms: 2000 }, 100); assert.deepEqual([vue(e, 101).id, vue(e, 2100).id], ['joie', 'ecoute']);

  // base : l'humeur d'une réponse, en couleur le temps de sa durée ; sans moteur de vie, elle devient aussi le fond.
  e = agir(etatNeuf(), { type: 'base', id: 'joie' }, 0);
  assert.deepEqual([e.emo?.id, e.fond, e.fondPose, ok(e).ms], ['joie', 'joie', false, 25_000]);
  assert.deepEqual(net(vue(e, 1)), { id: 'joie', couleur: true, vif: true, parle: false, reveil: 25_000 });
  assert.deepEqual(net(vue(e, 25_000)), { id: 'joie', couleur: false, vif: false, parle: false, reveil: 600_000 }, 'après l\'émotion : son visage adouci, sans couleur');
  assert.equal(vue(e, 600_000).id, 'neutre', 'au bout de 10 minutes, le visage aussi revient au calme');
  e = agir(etatNeuf(), { type: 'base', id: 'fatigue' }, 0); assert.deepEqual([vue(e, 3_600_000).id, vue(e, 3_600_000).couleur], ['fatigue', false], 'un fond de fatigue peut rester');
  // base('neutre') ne coupe pas une émotion en cours.
  e = agir(ressent(etatNeuf(), 'colere', 0), { type: 'base', id: 'neutre' }, 1000);
  assert.deepEqual([vue(e, 1001).id, vue(e, 1001).couleur, e.emo?.a], ['colere', true, 40_000]);
  // base d'un état de dialogue ou de la concentration : tenu au nom de « base », lâché par la base suivante.
  e = agir(etatNeuf(), { type: 'base', id: 'concentration' }, 0); assert.deepEqual(net(e.tenus.map((x) => [x.qui, x.id])), [['base', 'concentration']]); assert.equal(e.emo, null);
  e = agir(e, { type: 'base', id: 'joie' }, 1000); assert.equal(e.tenus.length, 0); assert.equal(vue(e, 1001).id, 'joie');
  e = agir(agir(etatNeuf(), { type: 'base', id: 'ecoute' }, 0), { type: 'base', id: 'neutre' }, 1000); assert.equal(e.tenus.length, 0); assert.equal(vue(e, 1001).id, 'neutre');
  // Une réponse ne coupe pas une émotion plus forte toute fraîche, et s'use comme les autres.
  e = agir(ressent(etatNeuf(), 'rage', 0), { type: 'base', id: 'joie' }, 1000); assert.equal(ok(e).ms, 0); assert.equal(vue(e, 1001).id, 'rage');
  e = etatNeuf(); for (const t of [0, 30_000, 60_000]) e = agir(e, { type: 'base', id: 'joie' }, t); assert.equal(e.emo?.id, 'contentement');
  // Dès que fond() a servi une fois, base() ne touche plus au fond.
  e = agir(agir(etatNeuf(), { type: 'fond', id: 'ennui' }, 0), { type: 'base', id: 'fatigue' }, 100);
  assert.deepEqual([e.fond, e.fondPose, e.emo?.id], ['ennui', true, 'fatigue']); assert.equal(vue(e, 30_100).id, 'ennui');
  e = agir(e, { type: 'base', id: 'neutre' }, 40_000); assert.equal(e.fond, 'ennui');
  e = agir(agir(e, { type: 'fond', id: 'neutre' }, 50_000), { type: 'base', id: 'triste' }, 50_100); assert.equal(e.fond, 'neutre', 'même revenu au calme, le fond reste celui du moteur de vie');

  // set : cache puis joie sans « passing » : cache lâché, aucune couleur.
  e = pose(etatNeuf(), 'cache', 0); assert.deepEqual(net(e.tenus.map((x) => [x.qui, x.id])), [['set', 'cache']]); assert.equal(vue(e, 1).id, 'cache');
  e = pose(e, 'joie', 1000);
  assert.equal(e.tenus.length, 0); assert.equal(e.emo, null); assert.deepEqual([vue(e, 1001).id, vue(e, 1001).couleur, vue(e, 1001).vif], ['joie', false, false]);
  for (let t = 1001; t < 700_000; t += 9973) assert.equal(vue(e, t).couleur, false);
  // set(id, true) : la couleur tout de suite, même par-dessus une émotion plus forte.
  e = pose(ressent(etatNeuf(), 'rage', 0), 'joie', 10, true); assert.deepEqual([vue(e, 10).id, vue(e, 10).couleur, ok(e).ms], ['joie', true, 25_000]);
  e = pose(pose(etatNeuf(), 'joie', 0, true), 'joie', 1000, true); assert.equal((e.emo?.a ?? 0) - (e.emo?.de ?? 0), 25_000, 'pas d\'habituation pour set');
  // Les humeurs rendues une à une (autocollants) : chacune se voit tout de suite, dans sa couleur, dans la même milliseconde.
  e = etatNeuf();
  for (const m of liste()) { e = pose(e, m.id, 5, true); assert.deepEqual([vue(e, 5).id, vue(e, 5).couleur], [m.id, m.id !== 'neutre'], m.id); }
  // set('parle') : seulement la bouche, par-dessus l'émotion ; coupée par le set suivant d'une autre humeur.
  e = pose(ressent(etatNeuf(), 'triste', 0), 'parle', 10);
  assert.deepEqual(net(vue(e, 11)), { id: 'triste', couleur: true, vif: true, parle: true, reveil: 30_000 }); assert.equal(e.tenus.length, 0);
  e = pose(e, 'neutre', 2000); assert.equal(vue(e, 2001).parle, false);
  e = pose(pose(pose(etatNeuf(), 'cache', 0), 'parle', 10), 'cache', 20); assert.deepEqual([vue(e, 21).id, vue(e, 21).parle], ['cache', false]);
  // set d'un état de dialogue : tenu au nom de « set » ; le set suivant le remplace.
  e = pose(pose(etatNeuf(), 'ecoute', 0), 'regarde', 10); assert.deepEqual(net(e.tenus.map((x) => [x.qui, x.id])), [['set', 'regarde']]);
  e = pose(e, 'neutre', 20); assert.equal(e.tenus.length, 0); assert.equal(vue(e, 21).id, 'neutre');
  // set sans « passing » : il ne colore jamais ; il garde l'émotion de la même humeur (réponse en cours), pas une autre.
  e = pose(pose(agir(etatNeuf(), { type: 'base', id: 'joie' }, 0), 'ecoute', 5000), 'joie', 9000); assert.deepEqual([vue(e, 9001).id, vue(e, 9001).couleur], ['joie', true]);
  e = pose(ressent(etatNeuf(), 'colere', 0), 'neutre', 1000); assert.deepEqual([vue(e, 1001).id, vue(e, 1001).couleur], ['neutre', false], 'sans moteur de vie : ce qu\'on pose se voit');
  e = pose(ressent(agir(etatNeuf(), { type: 'fond', id: 'ennui' }, 0), 'colere', 10), 'neutre', 1000);
  assert.deepEqual([vue(e, 1001).id, e.fond], ['colere', 'ennui'], 'avec le moteur de vie : set ne touche ni à l\'émotion ni au fond');
  assert.equal(vue(pose(etatNeuf(), 'nimporte', 0), 1).id, 'neutre');
});

test('garde-fous du fichier : aucun hasard, rien qui trahisse un outil, anciens noms gardés', () => {
  assert.ok(!/Math\.random/.test(SOURCE), 'aucun hasard dans le visage');
  assert.ok(!/\bIA\b|\bAI\b|intelligence artificielle|claude|anthropic|chatgpt|openai|\bLLM\b/i.test(SOURCE.replace(/[\u{1F000}-\u{1FFFF}]/gu, '')), 'aucune mention d\'IA');
  assert.ok(!/\._flash\s*=|\._passing/.test(SOURCE), 'plus rien n\'est rangé dans el._flash');
  assert.ok(!/OdinVie|OdinCompanion/.test(SOURCE), 'le visage ne cite jamais le moteur de vie ni le compagnon');
  assert.match(SOURCE, /\(typeof window !== 'undefined' \? window : globalThis\)|const G = typeof window !== 'undefined' \? window : globalThis;/);
  assert.match(SOURCE, /G\.OdinFace = \{/);
  // Les classes que le visage pose ou retire sur la mascotte restent dans ses préfixes.
  for (const m of SOURCE.matchAll(/classList\.(?:add|remove)\(([^)]*)\)/g)) for (const c of m[1].matchAll(/'([^']+)'|`([^`$]+)\$/g)) assert.match(c[1] ?? c[2], /^(e-|c-|g-|m-|o-|sans-)/, `classe hors préfixe : ${m[0]}`);
  // Le rendu des autocollants demande la couleur de l'humeur.
  assert.match(readFileSync(new URL('../tools/render-moods.cjs', import.meta.url), 'utf8'), /OdinFace\.set\(document\.querySelector\('\.odin'\), m, true\)/);
});

// ---------- Corrections après relecture ----------
const contraste = (a: string, b: string) => { const x = lumiere(a), y = lumiere(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
/** La couleur du corps sous les traits : à mi-chemin des deux premières teintes. */
const sousTraits = (t: string[]) => `#${rvb(t[0]).map((v, i) => Math.round((v + rvb(t[1])[i]) / 2).toString(16).padStart(2, '0')).join('')}`;
type DessinEncre = Dessin & { encre: string };

test('usure et retombée : un cran plus léger seulement dans les vraies échelles', () => {
  const troisFois = (id: string) => { let e = etatNeuf(); const vus: string[] = []; for (const t of [0, 40_000, 80_000]) { e = ressent(e, id, t); vus.push(e.emo?.id ?? ''); } return { vus, e }; };
  // Esprit, attente, manque, gêne, amour… ne sont pas des échelles d'intensité : la 3e fois garde l'émotion, en plus court et sans geste.
  for (const id of ['malice', 'confus', 'reflexion', 'enthousiasme', 'espoir', 'deception', 'solitude', 'admiration', 'culpabilite', 'calme', 'mepris', 'jalousie']) {
    const { vus, e } = troisFois(id);
    assert.deepEqual(vus, [id, id, id], `${id} : jamais une autre émotion à sa place`);
    assert.equal((e.emo?.a ?? 0) - (e.emo?.de ?? 0), Math.max(600, Math.round(F.duree(id) * .5)), `${id} : moitié moins longtemps`); assert.equal(ok(e).geste, false);
  }
  assert.ok(!troisFois('confus').vus.includes('concentration'), 'trois « perplexe » ne montrent jamais les yeux carrés');
  // Les vraies échelles descendent d'un cran.
  assert.deepEqual(troisFois('joie').vus, ['joie', 'joie', 'contentement']);
  assert.deepEqual(troisFois('colere').vus, ['colere', 'colere', 'frustration']);
  assert.deepEqual(troisFois('triste').vus, ['triste', 'triste', 'melancolie']);
  assert.deepEqual(troisFois('surprise').vus, ['surprise', 'surprise', 'etonnement']);
  assert.deepEqual(troisFois('fatigue').vus, ['fatigue', 'fatigue', 'lassitude']);
  assert.deepEqual(troisFois('peur').vus, ['peur', 'peur', 'apprehension']);
  // Retombée après un degré 3 : la panique retombe en peur (pas en terreur), la rage en colère ; hors échelle, le même visage sans couleur.
  const retombe = (id: string) => { const e = ressent(etatNeuf(), id, 0), fin = e.emo?.a ?? 0; return [vue(e, fin + 100).id, vue(e, fin + 100).couleur, vue(e, fin + 3000).id]; };
  assert.deepEqual(retombe('panique'), ['peur', false, 'neutre']);
  assert.deepEqual(retombe('rage'), ['colere', false, 'neutre']);
  assert.deepEqual(retombe('terreur'), ['peur', false, 'neutre']);
  assert.deepEqual(retombe('amour'), ['amour', false, 'neutre']);
  assert.deepEqual(retombe('honte'), ['honte', false, 'neutre']);
});

test('yeux : les pastilles restent blanches quelle que soit la situation (émotions, thèmes, fêtes) ; ombre douce sur un corps clair', async () => {
  const encreDe = (id: string, f: Visage = F) => (f.dessin(id) as DessinEncre).encre;
  // RÈGLE DU PROPRIÉTAIRE : la pastille reste blanche, pour les 66 émotions, à toutes les tailles.
  for (const m of liste()) for (const taille of TAILLES) assert.equal((F.dessin(m.id, { taille }) as DessinEncre).encre, '#fff', `${m.id} (${taille}) : yeux blancs`);
  // Y compris sur les corps clairs (joie, espoir, étonnement…), où le blanc se lit mal : c'est l'ombre derrière la pastille qui aide.
  const clairs = liste().filter((m) => contraste('#ffffff', sousTraits(m.tint)) < 2.5).map((m) => m.id);
  assert.ok(clairs.includes('joie') && clairs.includes('espoir') && clairs.length >= 8, `${clairs.length} émotions au corps clair`);
  for (const id of clairs) assert.equal(encreDe(id), '#fff', id);
  // Au repos, il a la couleur du thème : blanc pour chaque couleur de mascotte des thèmes et pour chaque couleur de fête.
  const themes = [...readFileSync(new URL('../src/web/themes.js', import.meta.url), 'utf8').matchAll(/"?mascot"?\s*:\s*['"](#[0-9a-fA-F]{6})['"]/g)].map((x) => x[1]);
  assert.ok(themes.length >= 40, `${themes.length} couleurs de thème lues`);
  const { EVENTS } = await import('../src/valhalla/fetes.ts');
  const f = charger();
  for (const c of [...themes, ...EVENTS.map((e) => e.color)]) { f.tintBase(c); assert.equal(encreDe('neutre', f), '#fff', `repos ${c} : yeux blancs`); }
  // Le 1er mai (corps sombre) comme le Ramadan (corps clair) : toujours blancs.
  f.tintBase('#2a2f3a'); assert.equal(encreDe('neutre', f), '#fff');
  f.tintBase('#f2f2f2'); assert.equal(encreDe('neutre', f), '#fff');
  assert.match(SOURCE, /const encre = \(\) => W;/, 'l\'encre des yeux est toujours le blanc');
  assert.match(SOURCE, /\.odin\.ev-dark-eyes\{--o-encre:#fff\}/, 'plus d\'yeux sombres un jour de fête');
  assert.match(SOURCE, /el\.style\.setProperty\('--o-ombre', ombre\(t\)\)/, 'ombre douce derrière la pastille sur un corps clair');
  // La couleur portée pose son encre ; l'œil reste une pastille d'une seule couleur (pas de goutte dedans).
  assert.match(SOURCE, /el\.style\.setProperty\('--o-encre', encre\(t\)\)/);
  assert.ok(contraste('#ffffff', '#4A98EC') >= 2.5); assert.ok(!F.dessin('gratitude').yeux[0].includes('#4A98EC'));
});

test('ce que Chrome peint : jamais une pose et une animation de transform sur le même élément', () => {
  const css = F.CSS;
  // Le corps : la posture est dans `transform` ; ses boucles et ses gestes animent translate, rotate et scale.
  assert.ok(css.includes('\n.odin .body{transform-origin:60px 60px;transform:translate(var(--o-px,0px),var(--o-py,0px)) rotate(var(--o-rot,0deg)) scale(var(--o-sx,1),var(--o-sy,1));transition:transform '));
  const cles = [...css.matchAll(/@keyframes ((?:c|g)-[\w-]+)\{(.*)\}\n/g)];
  assert.ok(cles.length >= 26, `${cles.length} animations du corps`);
  for (const [, nom, corps] of cles) {
    assert.ok(!corps.includes('transform'), `${nom} : anime translate, rotate, scale (pas transform)`);
    // Chaque propriété animée est donnée à toutes les étapes (sinon elle sauterait une étape).
    const etapes = [...corps.matchAll(/\{([^}]*)\}/g)].map((x) => x[1].split(';').map((d) => d.split(':')[0]).sort().join(','));
    assert.equal(new Set(etapes).size, 1, `${nom} : mêmes propriétés à chaque étape (${[...new Set(etapes)].join(' | ')})`);
  }
  // Le regard et la taille des yeux : chacun sur son groupe, sous ceux que la page anime (.eyes, .brow).
  assert.ok(css.includes('\n.odin .body .eyes{scale:none;translate:none}'));
  assert.match(css, /\n\.odin \.body \.eyes \.regard\{[^}]*scale:calc\(var\(--o-ty,1\)\*var\(--o-yx,1\)\)[^}]*translate:calc\(var\(--lookx,0px\)\*var\(--o-suivi,1\)/);
  assert.match(css, /\n\.odin \.eyes \.brow\.l,\.odin \.eyes \.brow\.r\{[^}]*scale:none;translate:none/);
  assert.match(css, /\n\.odin \.eyes \.brow\.l \.taille\{scale:calc\(var\(--lsx,1\)\*var\(--o-exa,1\)\)/);
  assert.match(css, /\n\.odin \.eyes \.brow\.r \.taille\{scale:calc\(var\(--rsx,1\)\*var\(--o-exa,1\)\)/);
  assert.ok(SOURCE.includes('<g class="regard"><g class="brow l"><g class="taille">${D.yeux[0]}</g></g><g class="brow r"><g class="taille">${D.yeux[1]}</g></g></g>'));
  // Plus aucune règle du visage ne pose rotate, scale ou translate sur le corps, .eyes ou .brow eux-mêmes.
  for (const r of css.matchAll(/\n([^{}\n@]*)\{([^}]*)\}/g)) {
    const cible = (r[1].trim().split(',').pop() ?? '').trim();
    if (/(\.body|\.eyes|\.brow(\.[lr])?)$/.test(cible)) assert.ok(!/(?:^|;)(?:scale|translate|rotate):(?!none)/.test(r[2]), `pose sur un élément animé : ${cible}`);
  }
});

test('mouvement réduit, gestes et fondus : le clin d\'œil reste lisible, le geste d\'arrivée n\'est pas perdu, la rage s\'efface d\'un bloc', () => {
  // Rien ne bouge : l'œil droit du clin d'œil est dessiné plus court (toujours une pastille debout), un sourcil se lève.
  const fige = { fige: true } as { taille?: string };
  const anime = F.dessin('clin'), fixe = F.dessin('clin', fige), doux = F.dessin('clin', { vif: false });
  assert.ok(anime.classes.includes('e-clin')); assert.deepEqual(net(anime.mesure), [[9, 22], [9, 22]]);
  for (const D of [fixe, doux]) {
    assert.ok(!D.classes.includes('e-clin')); assert.equal(D.forme, 'uneven'); assert.equal(D.genre, 'pastille');
    assert.deepEqual(net(D.mesure), [[9, 22], [9, 14]]); for (const [l, h] of D.mesure) assert.ok(h >= 1.5 * l);
    assert.notDeepEqual(net(D.yeux), net(anime.yeux));
  }
  assert.equal(fixe.sourcils, ''); assert.equal(anime.sourcils, '');
  // Les autres émotions ne changent pas quand rien ne bouge (décision 1 tenue dans les deux cas).
  for (const m of liste()) if (m.id !== 'clin') assert.deepEqual(net(F.dessin(m.id, fige).yeux), net(F.dessin(m.id).yeux), m.id);
  assert.ok(SOURCE.includes('dessin(N.r.id, { taille: N.taille, vif: N.r.vif, parle: N.r.parle, fige: reduit() })'));
  assert.match(readFileSync(new URL('../tools/render-moods.cjs', import.meta.url), 'utf8'), /reducedMotion: 'reduce'/, 'les autocollants (images fixes) dessinent le clin d\'œil');
  // Le geste d'arrivée dû reste dû si une autre demande arrive avant la pose ; un geste demandé (le sursaut de l'appel) n'est pas écrasé.
  assert.ok(SOURCE.includes('const veut = Boolean(o.entree) || v.du === N.cle; v.du = \'\';'));
  assert.match(SOURCE, /if \(veut\) v\.du = N\.cle;\s*\n\s*phase\(v, 100, \(\) => \{ pose\(\); entree\(\); \}\);/);
  assert.ok(SOURCE.includes('if (Date.now() >= v.voulu) jouer(el, v, D.entree);'));
  assert.ok(SOURCE.includes('jouer(el, v, nom); v.voulu = Date.now() + GESTES[nom]; return true;'));
  // La teinte qui bat (rage) est retirée avant de repeindre : pas d'anneau qui revient avant les autres teintes.
  const passer = SOURCE.slice(SOURCE.indexOf('function passer('), SOURCE.indexOf('function emettre('));
  assert.ok(passer.indexOf('el.classList.remove(\'o-vive\')') > 0 && passer.indexOf('el.classList.remove(\'o-vive\')') < passer.indexOf('teinter(el, N.teintes)'));
  // Aucune bouche, à aucune taille.
  for (const id of ['chagrin', 'panique', 'epuisement', 'sommeil', 'rage', 'rire']) { assert.equal(F.dessin(id).bouche, '', id); assert.equal(F.dessin(id, { taille: 'mini' }).bouche, '', id); }
});
