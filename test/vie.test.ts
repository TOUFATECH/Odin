// Odin vivant : la vie intérieure de la mascotte (src/web/vie.js), essayée hors navigateur.
// Le cœur du moteur est fait de fonctions pures (l'horloge et le contexte sont des paramètres) : on le charge sans
// page, on lui fait vivre des journées entières par pas de 2 secondes, et on vérifie que tout ce qu'il fait a une
// raison, que rien n'est tiré au sort, et que les règles validées tiennent (jamais de déplacement quand la personne
// écrit, humeur de fond lente, émotions courtes, appel entendu tout de suite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { FAMILLES, MOODS, isMood } from '../src/mood/mood.ts';

const lire = (f: string) => readFileSync(new URL(`../src/web/${f}`, import.meta.url), 'utf8');
const SOURCE = lire('vie.js');
/* eslint-disable @typescript-eslint/no-explicit-any */
type Sortie = { type: 'fond' | 'emotion' | 'comportement'; id: string; raison: string; ms?: number; force?: boolean; plan?: unknown[][]; duree?: number; urgent?: boolean };
type Fait = { t?: number; k: string; p?: number; id?: string; texte?: string; x?: number; y?: number };
type Etat = any;
type Ctx = Record<string, unknown>;
interface Coeur {
  CONST: any;
  hache(t: string): number; rythme(h: number): number; impulsion(faits: Fait[], poids: Record<string, number>, tau: number, now: number): number;
  caractereDuJour(o: { jour: string; fete: { id: string; nom: string } | null }): { id: string; nom: string; causes: string[] };
  causesDites(causes: string[], fete: { id: string; nom: string } | null): string;
  besoins(etat: Etat, ctx: Ctx, now: number): Record<string, number>;
  fondSuivant(etat: Etat, B: Record<string, number>, ctx: Ctx, now: number): { id: string; force: boolean; raison: string } | null;
  emotionPour(fait: Fait, etat: Etat, B: Record<string, number>, ctx: Ctx, now: number): { id: string; raison: string; ms?: number; force?: boolean } | null;
  choisir(etat: Etat, B: Record<string, number>, ctx: Ctx, now: number): { id: string; score: number } | null;
  avancer(etat: Etat, entree: { faits: Fait[]; ctx: Ctx }, now: number): { etat: Etat; sorties: Sortie[] };
  nouvelEtat(sauve: unknown, now: number): Etat; resumer(etat: Etat): any;
  pourquoi(etat: Etat, ctx: Ctx, now: number): { fait: string; raison: string; phrase: string };
  estAppel(texte: string, mot?: string): { appel: boolean; seul: boolean; reste: string; force: number };
  lireSaisie(texte: string, avant?: string): { signe: string; humeur: string };
  emotion(id: string): { id: string; famille: string; degre: number; valence: number } | null;
  repli(id: string): string; dureeRepli(id: string): number;
}
/** Charge vie.js sans navigateur : seulement `window`, aucune page. */
function charger(): Coeur { const bac = { window: {} as Record<string, unknown> }; runInNewContext(SOURCE, bac); return bac.window.OdinVieCoeur as Coeur; }
const C = charger();
/** Les objets du cœur viennent d'un autre bac : on les aplatit avant de les comparer. */
const plat = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const S = 1000, MIN = 60 * S, H = 60 * MIN;
/** Le 16 novembre 2026 à 8 h (un lundi) : un instant fixe, pour des essais rejouables. */
const T0 = Date.UTC(2026, 10, 16, 8, 0, 0);
const heureA = (t: number, h0 = 8) => ((((t - T0) / H + h0) % 24) + 24) % 24;
const CTX: Ctx = { jour: '2026-11-16', present: true, inactifMs: 10 * S, ecrit: false, survol: false, tenu: false, occupe: false, fenetre: false, promenade: true, reduit: false, tactile: false, graves: 0, nonLues: 0, sommeil: false, fete: null, emotion: null, cible: null, visible: true };
/** Un état neuf avec un caractère choisi (pour des chiffres ronds : « curieux » ne change ni l'ennui, ni l'agacement, ni la compagnie). */
function etatNeuf(now: number, caractere = 'curieux', jour = '2026-11-16'): Etat {
  const e = C.nouvelEtat(null, now); e.jour = jour; e.feteId = ''; e.caractere = { id: caractere, nom: C.CONST.CARACTERES[caractere].nom, causes: ['jour'] }; return e;
}
interface Pas { t: number; ctx: Ctx; sorties: Sortie[]; etat: Etat }
/**
 * Fait vivre le moteur de `debut` à `debut + duree`, par pas de 2 secondes, avec un faux visage qui accepte tout
 * (l'émotion demandée devient l'émotion en cours, pour sa durée). `ctx(t, etat)` et `faits(t)` décrivent la scène.
 */
function vivre(o: { etat: Etat; debut: number; duree: number; h0?: number; ctx?: (t: number, e: Etat) => Ctx; faits?: (t: number) => Fait[]; chaque?: (p: Pas) => void }) {
  let e = o.etat, emo: { id: string; famille: string; degre: number; valence: number; jusque: number } | null = null, avecEmotion = 0, pas = 0, suite = 0, plusLong = 0;
  const journal: Array<{ t: number; s: Sortie; ctx: Ctx }> = [];
  // `choix` : la suite de ses choix (« repos » quand rien ne lui a fait envie) ; `appels`, `tenus` : les instants où on l'a appelé, où on le tenait.
  const choix: string[] = [], appels: number[] = [], tenus: number[] = [];
  for (let t = o.debut; t < o.debut + o.duree; t += 2 * S) {
    if (emo && t >= emo.jusque) emo = null;
    const ctx: Ctx = { ...CTX, heure: heureA(t, o.h0), ...(o.ctx ? o.ctx(t, e) : {}), emotion: emo }, faits = o.faits ? o.faits(t) : [];
    if (faits.some((f) => f.k === 'appel')) appels.push(t);
    if (ctx.tenu) tenus.push(t);
    const r = C.avancer(e, { faits, ctx }, t), sorties = plat(r.sorties);
    e = r.etat;
    for (const s of sorties) {
      journal.push({ t, s, ctx });
      if (s.type === 'emotion') { const m = C.emotion(s.id)!; emo = { ...m, jusque: t + (s.ms ?? (isMood(s.id) ? MOODS[s.id].dure * S : 15 * S)) }; }
      if (s.type === 'comportement' && s.id !== 'repos') choix.push(s.id);
    }
    if (!sorties.some((s) => s.type === 'comportement' && s.id !== 'repos') && e.histo[e.histo.length - 1] === 'repos' && choix[choix.length - 1] !== 'repos') choix.push('repos');
    o.chaque?.({ t, ctx, sorties, etat: e });
    pas++; if (emo) { avecEmotion++; suite++; plusLong = Math.max(plusLong, suite); } else suite = 0;
  }
  return { etat: e, journal, choix, appels, tenus, avecEmotion, pas, plusLong: plusLong * 2 * S };
}
const comportements = <T extends { t: number; s: Sortie }>(j: T[]): T[] => j.filter((x) => x.s.type === 'comportement' && x.s.id !== 'repos');
const emotions = (j: Array<{ t: number; s: Sortie }>) => j.filter((x) => x.s.type === 'emotion').map((x) => x.s.id);
/** Ceux qu'il ne choisit pas librement : les urgences, et le geste de travail. */
const IMPOSES = new Set(['venir', 'veiller', 'travailler']);

test('vie.js : le cœur est pur (ni page, ni horloge, ni hasard), servi et chargé avant companion.js', () => {
  const lignes = SOURCE.split('\n'), coupe = lignes.findIndex((l) => l.includes('typeof document === \'undefined\''));
  assert.ok(coupe > 100, 'la ligne qui sépare le cœur du branchement existe');
  const coeur = lignes.slice(0, coupe).join('\n');
  for (const interdit of ['Math.random', 'Date.now', 'document', 'localStorage', 'setTimeout', 'fetch']) assert.ok(!coeur.includes(interdit), `le cœur ne cite pas ${interdit}`);
  for (const f of ['vie.js', 'companion.js', 'mascotte.js']) {
    const src = lire(f);
    assert.ok(!src.includes('Math.random'), `${f} : aucun tirage au sort`);
    assert.doesNotMatch(src, /(?<![\p{L}])IA(?![\p{L}])|intelligence artificielle|\bClaude\b|\bGPT\b|\bLLM\b/u, `${f} ne cite aucune IA`);
  }
  assert.ok(!SOURCE.includes('innerHTML'), 'vie.js n\'écrit jamais de HTML');
  assert.doesNotMatch(SOURCE, /preventDefault/, 'vie.js lit le clavier sans jamais rien empêcher');
  // Chargé hors navigateur : le cœur est là, la partie page ne s'est pas lancée.
  const bac = { window: {} as Record<string, unknown> }; runInNewContext(SOURCE, bac);
  assert.ok(bac.window.OdinVieCoeur); assert.equal(bac.window.OdinVie, undefined);
  for (const nom of ['CONST', 'hache', 'rythme', 'caractereDuJour', 'besoins', 'fondSuivant', 'emotionPour', 'choisir', 'avancer', 'nouvelEtat', 'resumer', 'pourquoi', 'estAppel', 'lireSaisie']) assert.ok(nom in (bac.window.OdinVieCoeur as object), `OdinVieCoeur.${nom}`);
  // Servi comme companion.js, et chargé juste avant lui, avec le jeton.
  const serveur = readFileSync(new URL('../src/web/server.ts', import.meta.url), 'utf8'), ui = lire('ui.html');
  assert.match(serveur, /const VIE_JS = .*readFileSync\(new URL\('\.\/vie\.js'/);
  assert.match(serveur, /url\.pathname === '\/vie\.js'\) \{ res\.writeHead\(200, \{ 'content-type': 'text\/javascript; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' \}\); return void res\.end\(VIE_JS\)/);
  assert.match(ui, /<script nonce="__NONCE__" src="\/vie\.js"><\/script>\s*<script nonce="__NONCE__" src="\/companion\.js"><\/script>/);
  assert.ok(ui.indexOf('src="/face.js"') < ui.indexOf('src="/vie.js"'), 'le visage est chargé d\'abord');
});

test('companion.js : plus de battement au hasard, des plans, et des gestes seulement sur le dessin entier', () => {
  const src = lire('companion.js');
  assert.doesNotMatch(src, /function tick\b|setInterval\(tick/);
  assert.match(src, /setInterval\(sync, 1500\)/);
  assert.match(src, /window\.OdinCompanion = \{ go: .*act, lookAt, sync, pin: .*tip, untip, jouer, arreter, etat \}/);
  // Ses nouveaux gestes : uniquement « #buddyRoam > svg », et seulement si les animations sont permises.
  const css = /const CSS = `([\s\S]*?)`;/.exec(src)?.[1] ?? '';
  const bloc = /@media \(prefers-reduced-motion:no-preference\)\{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? '';
  for (const nom of ['act-baille', 'act-etire', 'act-soupir', 'act-signe', 'act-roule', 'act-tremble']) assert.match(bloc, new RegExp(`#buddyRoam\\.${nom} > svg\\{`), `${nom} est défini sous « animations permises »`);
  for (const regle of bloc.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('@keyframes'))) assert.match(regle, /^#buddyRoam(\.[a-z-]+)? > svg\{/, `règle hors du dessin entier : ${regle.slice(0, 60)}`);
  assert.doesNotMatch(css.replace(bloc, ''), /\.act-/, 'aucun geste hors du bloc « animations permises »');
  // Ses poses (assis, dort, boude) se voient aussi en mouvement réduit : posées hors du bloc, d'un coup (la transition, elle, reste dans le bloc), toujours sur le dessin entier.
  const hors = css.replace(bloc, '');
  for (const nom of ['v-assis', 'v-dort', 'v-boude']) { assert.match(hors, new RegExp(`\\n {2}#buddyRoam\\.${nom} > svg\\{transform-origin:50% 92%;transform:`), `${nom} : visible même en mouvement réduit`); assert.ok(!bloc.includes(nom)); }
  assert.ok(bloc.includes('#buddyRoam > svg{transition:transform ') && !hors.includes('#buddyRoam > svg{transition'));
  for (const regle of hors.split('\n').map((l) => l.trim()).filter((l) => /\.v-(assis|dort|boude)/.test(l))) assert.match(regle, /^#buddyRoam\.v-[a-z]+ > svg\{/, `pose hors du dessin entier : ${regle.slice(0, 60)}`);
  // Les classes du visage (e- c- g- m- o- sans-) ne sont jamais touchées ici.
  assert.doesNotMatch(src, /classList\.(add|remove|toggle)\(['`](e|c|g|m|o|sans)-/);
  const masc = lire('mascotte.js');
  assert.match(masc, /n >= 12 \? \['stupeur', 'surprise'\] : n >= 8 \? \['etonnement', 'surprise'\] : n >= 4 \? \['interet', 'regarde'\] : \['curiosite', 'regarde'\]/);
  assert.match(masc, /F\.lacher\?\.\(b, 'appel'\); F\.ressent\(b, id, \{ ms: 900, force: true, sansHabitude: true, source: 'clics' \}\)/);
});

test('la palette que le moteur connaît est celle du serveur', () => {
  const E = plat(C.CONST.EMOTIONS) as Record<string, { famille: string; degre: number }>;
  assert.equal(Object.keys(E).length, 66);
  for (const [id, m] of Object.entries(E)) { assert.ok(isMood(id), `${id} existe côté serveur`); if (isMood(id)) { assert.equal(m.famille, MOODS[id].famille, id); assert.equal(m.degre, MOODS[id].degre, id); } }
  const F = plat(C.CONST.FAMILLES) as Record<string, [string, number]>;
  assert.deepEqual(Object.keys(F), Object.keys(FAMILLES));
  for (const [f, [base, valence]] of Object.entries(F)) { assert.equal(base, FAMILLES[f as keyof typeof FAMILLES].base, f); assert.equal(valence, FAMILLES[f as keyof typeof FAMILLES].valence, f); }
  // Les expressions demandées au visage existent : dispositions de fond, signes de la saisie, replis sur un ancien visage.
  assert.deepEqual(plat(C.CONST.FOND_VISAGE), { eveille: 'neutre', enjoue: 'contentement', somnolent: 'lassitude', endormi: 'sommeil', soucieux: 'inquiet', boudeur: 'moue', en_manque: 'solitude', las: 'ennui', alerte: 'inquiet' });
  for (const h of Object.values(plat(C.CONST.SIGNES) as Record<string, string>)) if (h) assert.ok(isMood(h), `expression de saisie ${h}`);
  const origine = new Set(Object.keys(MOODS).slice(0, 22));
  for (const id of Object.keys(E)) assert.ok(origine.has(C.repli(id)), `le repli de ${id} est une humeur d'origine`);
  assert.equal(C.repli('inquiet'), 'inquiet'); assert.equal(C.repli('apprehension'), 'peur'); assert.equal(C.repli('curiosite'), 'regarde'); assert.equal(C.repli('enthousiasme'), 'excite'); assert.equal(C.repli('rage'), 'colere');
  assert.deepEqual([C.dureeRepli('calme'), C.dureeRepli('joie'), C.dureeRepli('rage')], [8000, 20000, 60000]);
  // Tout identifiant écrit en dur dans le cœur après « id: » est connu : une émotion du serveur, un comportement, une disposition, un caractère ou une sorte de fait.
  const coeur = SOURCE.slice(0, SOURCE.indexOf('typeof document === \'undefined\''));
  const connus = new Set<string>([...Object.keys(MOODS), ...(plat(C.CONST.COMPORTEMENTS) as string[]), ...(plat(C.CONST.FONDS) as string[]), 'alerte', 'attentif', ...Object.keys(plat(C.CONST.CARACTERES)), ...(plat(C.CONST.SORTES) as string[])]);
  let vus = 0;
  for (const m of coeur.matchAll(/\bid: ([^;{}]*?)(?=, [a-zA-Z]+:|[;}])/g)) for (const q of m[1].matchAll(/'([a-z_]+)'/g)) { vus++; assert.ok(connus.has(q[1]), `identifiant inconnu dans le cœur : ${q[1]}`); }
  assert.ok(vus > 60, 'la lecture du source a bien trouvé les identifiants');
});

test('besoins : des fonctions pures de l\'heure et des faits datés', () => {
  // 2 h du matin, debout depuis 15 h : épuisé. 10 h, debout depuis 1 h : en pleine forme.
  let e = etatNeuf(T0); e.eveilDepuis = T0 - 15 * H;
  assert.ok(C.besoins(e, { ...CTX, heure: 2 }, T0).energie < .2);
  e = etatNeuf(T0); e.eveilDepuis = T0 - 1 * H;
  for (const car of Object.keys(plat(C.CONST.CARACTERES))) { const x = etatNeuf(T0, car); x.eveilDepuis = T0 - H; assert.ok(C.besoins(x, { ...CTX, heure: 10 }, T0).energie >= .9, `10 h, caractère ${car}`); }
  assert.ok(Math.abs(C.besoins(e, { ...CTX, heure: 10 }, T0).fatigue - (1 - C.besoins(e, { ...CTX, heure: 10 }, T0).energie)) < 1e-9);
  assert.ok(C.besoins(e, { ...CTX, heure: 10, sommeil: true }, T0).energie <= .15, 'mode sommeil : énergie plafonnée');
  // Le rythme sur 24 heures, interpolé.
  assert.equal(C.rythme(10), 1); assert.equal(C.rythme(3), .10); assert.ok(Math.abs(C.rythme(6.5) - .575) < 1e-9); assert.ok(Math.abs(C.rythme(23.5) - .29) < 1e-9); assert.equal(C.rythme(24), C.rythme(0));
  // Curiosité : 0,45 au changement de page, puis elle s'efface.
  let r = C.avancer(etatNeuf(T0, 'calme'), { faits: [{ k: 'page', id: 'home' }], ctx: { ...CTX, heure: 10 } }, T0);
  const cur = (t: number) => C.besoins(r.etat, { ...CTX, heure: 10 }, t).curiosite;
  assert.ok(Math.abs(cur(T0) - .45) < 1e-9); assert.ok(cur(T0 + 90 * S) < .2); assert.ok(cur(T0 + 5 * MIN) < .05);
  // Compagnie : rien pendant 20 minutes, puis elle monte jusqu'à 1 en 100 minutes ; un appel la remet à zéro.
  e = etatNeuf(T0);
  const comp = (x: Etat, t: number) => C.besoins(x, { ...CTX, heure: 10 }, t).compagnie;
  assert.equal(comp(e, T0 + 19 * MIN), 0); assert.ok(Math.abs(comp(e, T0 + 70 * MIN) - .5) < .01); assert.equal(comp(e, T0 + 120 * MIN), 1);
  r = C.avancer(e, { faits: [{ k: 'appel', id: 'toucher' }], ctx: { ...CTX, heure: 10 } }, T0 + 120 * MIN);
  assert.equal(comp(r.etat, T0 + 121 * MIN), 0);
  assert.ok(comp(e, T0 + 120 * MIN) > C.besoins(e, { ...CTX, heure: 10, present: false }, T0 + 120 * MIN).compagnie, 'absent : il lui en faut moins');
  // Inquiétude : à 1 tant qu'une urgence n'est pas vue.
  assert.equal(C.besoins(e, { ...CTX, heure: 10, graves: 1 }, T0).inquietude, 1);
  assert.equal(C.besoins(e, { ...CTX, heure: 10 }, T0).inquietude, 0);
  // Ennui : rien pendant 4 minutes, plein à 15 minutes ; une promenade le chasse.
  const ennui = (x: Etat, t: number) => C.besoins(x, { ...CTX, heure: 10 }, t).ennui;
  assert.equal(ennui(e, T0 + 4 * MIN), 0); assert.ok(Math.abs(ennui(e, T0 + 9.5 * MIN) - .5) < 1e-9); assert.equal(ennui(e, T0 + 15 * MIN), 1);
  e.dernier.promenade = T0 + 15 * MIN; assert.equal(ennui(e, T0 + 16 * MIN), 0);
  // Une impulsion ne dépasse jamais 1, et tout reste entre 0 et 1.
  assert.equal(C.impulsion([{ t: T0, k: 'x' }, { t: T0, k: 'x' }, { t: T0, k: 'x' }], { x: .6 }, MIN, T0), 1);
  r = C.avancer(etatNeuf(T0), { faits: [{ k: 'bloque' }, { k: 'bloque' }, { k: 'embete' }, { k: 'merci' }, { k: 'appris' }, { k: 'alerte', p: 1 }, { k: 'alerte_reglee' }, { k: 'caresse' }], ctx: { ...CTX, heure: 3, graves: 1 } }, T0);
  for (const [k, v] of Object.entries(C.besoins(r.etat, { ...CTX, heure: 3, graves: 1 }, T0))) assert.ok(v >= 0 && v <= 1, `${k} entre 0 et 1`);
  assert.equal(C.hache('odin'), C.hache('odin')); assert.notEqual(C.hache('odin'), C.hache('odim'));
});

test('caractère du jour : une fonction pure du jour et de la fête', () => {
  const noel = { id: 'noel', nom: 'Noël' };
  const un = plat(C.caractereDuJour({ jour: '2026-11-16', fete: null }));
  for (let i = 0; i < 100; i++) assert.deepEqual(plat(C.caractereDuJour({ jour: '2026-11-16', fete: null })), un);
  const jours = Array.from({ length: 14 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
  assert.ok(new Set(jours.map((j) => C.caractereDuJour({ jour: j, fete: null }).id)).size >= 4, 'au moins 4 caractères en 14 jours');
  // Sur une année : tous les caractères existent, toujours une cause, un nom et une phrase en français.
  const annee = new Set<string>();
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d++) {
    const jour = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, fete = d === 25 && m === 12 ? noel : d === 7 ? { id: 'famille', nom: 'Anniversaire de Awa' } : null;
    const c = C.caractereDuJour({ jour, fete }); annee.add(c.id);
    assert.ok(c.causes.length > 0, `${jour} : une cause`);
    if (fete) assert.ok(c.id === 'enjoue' || c.id === 'calin', `${jour} : un jour de fête, il est joueur ou affectueux`);
    const dit = `${c.nom} : ${C.causesDites(plat(c.causes), fete)}`;
    assert.doesNotMatch(dit, /undefined|NaN|null/); assert.match(dit, /^[a-zéêèû]+ : c'est /);
  }
  assert.equal(annee.size, 6, 'les six caractères se rencontrent dans l\'année');
  // Les causes viennent du jour : samedi, lundi, fête…
  assert.equal(C.causesDites(['samedi', 'fete'], noel), 'c\'est samedi et c\'est Noël');
  assert.equal(C.causesDites(['jour'], null), 'c\'est mon humeur du jour');
  assert.equal(C.causesDites(['famille'], { id: 'anniversaire', nom: 'Ton anniversaire' }), 'c\'est ton anniversaire');
  assert.equal(C.causesDites(['fete'], { id: 'travail', nom: 'Fête du travail' }), 'c\'est la fête du travail');
  const samedi = C.caractereDuJour({ jour: '2026-12-26', fete: null });
  if (samedi.id === 'enjoue') assert.deepEqual(plat(samedi.causes), ['samedi']);
  assert.deepEqual(plat(C.caractereDuJour({ jour: '2026-12-25', fete: noel }).causes).includes('jour'), false);
  // Le moteur le refait quand le jour change, et le dit au repos.
  let e = C.avancer(C.nouvelEtat(null, T0), { faits: [], ctx: { ...CTX, heure: 8, jour: '2026-12-25', fete: noel } }, T0).etat;
  assert.ok(['enjoue', 'calin'].includes(e.caractere.id));
  e = C.avancer(e, { faits: [], ctx: { ...CTX, heure: 8, jour: '2026-12-28', fete: null } }, T0 + 2 * S).etat;
  assert.deepEqual(plat(e.caractere), plat(C.caractereDuJour({ jour: '2026-12-28', fete: null })));
});

test('disposition de fond : lente, forcée seulement par une urgence, un appel ou la fin d\'une bouderie', () => {
  const B0 = { energie: .9, fatigue: .1, curiosite: 0, compagnie: 0, ennui: 0, fierte: 0, inquietude: 0, soulagement: 0, agacement: 0, tendresse: 0 };
  /** Fait tourner fondSuivant pendant `duree`, avec des besoins qui changent à chaque pas ; rend les changements. */
  const tourner = (e: Etat, duree: number, besoin: (k: number) => Partial<typeof B0>, ctx: Ctx = {}) => {
    const changements: Array<{ t: number; id: string; force: boolean }> = [];
    for (let k = 0, t = T0; t < T0 + duree; t += 2 * S, k++) {
      const r = C.fondSuivant(e, { ...B0, ...besoin(k) }, { ...CTX, heure: 10, ...ctx }, t);
      if (r) { e.fond = { id: r.id, depuis: t }; if (!r.force) e.seuils.fondLibre = t; changements.push({ t: t - T0, id: r.id, force: r.force }); }
      e.t = t; e.dernierePresence = t;
    }
    return changements;
  };
  const pret = () => { const e = etatNeuf(T0); delete e.fond.neuf; e.fond = { id: 'eveille', depuis: T0 - 10 * MIN }; return e; };
  // Un besoin qui oscille autour d'un seuil toutes les 2 secondes : un changement au plus en 5 minutes.
  for (const [nom, bas, haut] of [['fatigue', .64, .66], ['fatigue', .6, .7], ['ennui', .58, .62], ['ennui', .68, .72], ['ennui', .62, .74], ['inquietude', .44, .46], ['inquietude', .5, .6], ['compagnie', .69, .71], ['compagnie', .62, .76], ['fierte', .49, .51], ['fierte', .5, .6]] as Array<[string, number, number]>) {
    const ch = tourner(pret(), 5 * MIN, (k) => ({ [nom]: k % 2 ? haut : bas }));
    assert.ok(ch.length <= 1, `${nom} qui oscille entre ${bas} et ${haut} : ${ch.length} changements (${ch.map((c) => c.id).join(', ')})`);
  }
  // Les durées minimales sont tenues : sa raison disparue, il garde quand même sa disposition le temps prévu.
  for (const [id, mini] of [['somnolent', 180], ['soucieux', 120], ['las', 120], ['en_manque', 120], ['enjoue', 60]] as Array<[string, number]>) {
    const e = pret(); e.fond = { id, depuis: T0 };
    const ch = tourner(e, 6 * MIN, () => ({}));
    assert.equal(ch.length, 1, id); assert.equal(ch[0].id, 'eveille'); assert.ok(ch[0].t >= mini * S && ch[0].t <= mini * S + 2 * S, `${id} tient ${mini} s (quitté à ${ch[0].t / S} s)`);
  }
  // Deux changements libres ne se suivent jamais à moins d'une minute.
  const libres = tourner(pret(), 20 * MIN, (k) => ({ fatigue: Math.floor(k / 20) % 2 ? .9 : .1, ennui: Math.floor(k / 33) % 2 ? .9 : 0 })).filter((c) => !c.force);
  assert.ok(libres.length >= 2); for (let i = 1; i < libres.length; i++) assert.ok(libres[i].t - libres[i - 1].t >= 60 * S);
  // Une urgence : fond « alerte » au battement même, quoi qu'il fasse ; l'urgence vue, il en sort tout de suite.
  let r = C.avancer(etatNeuf(T0), { faits: [], ctx: { ...CTX, heure: 10 } }, T0);
  r = C.avancer(r.etat, { faits: [{ k: 'alerte', p: 1, texte: 'Disque en panne' }], ctx: { ...CTX, heure: 10, graves: 1 } }, T0 + 2 * S);
  assert.equal(r.etat.fond.id, 'alerte'); assert.ok(r.sorties.some((s) => s.type === 'fond' && s.id === 'alerte'));
  assert.ok(r.sorties.some((s) => s.type === 'emotion' && s.id === 'peur' && s.force === true), 'alerte grave : peur, avec force');
  assert.ok(r.sorties.some((s) => s.type === 'comportement' && s.id === 'veiller' && s.urgent === true));
  r = C.avancer(r.etat, { faits: [{ k: 'alerte_reglee' }], ctx: { ...CTX, heure: 10, graves: 0 } }, T0 + 4 * S);
  assert.notEqual(r.etat.fond.id, 'alerte'); assert.equal(r.etat.comportement, null);
  assert.ok(r.sorties.some((s) => s.type === 'emotion' && s.id === 'soulagement'));
  // Tu lui parles (fenêtre ouverte) : attentif tout de suite, puis 5 secondes encore après la fin.
  r = C.avancer(etatNeuf(T0), { faits: [], ctx: { ...CTX, heure: 10, fenetre: true } }, T0);
  assert.equal(r.etat.fond.id, 'attentif');
  r = C.avancer(r.etat, { faits: [], ctx: { ...CTX, heure: 10 } }, T0 + 4 * S); assert.equal(r.etat.fond.id, 'attentif');
  r = C.avancer(r.etat, { faits: [], ctx: { ...CTX, heure: 10 } }, T0 + 6 * S); assert.notEqual(r.etat.fond.id, 'attentif');
});

test('bouderie : 90 secondes au plus, puis 5 minutes sans rebouder ; une caresse y met fin', () => {
  const secouer = (t: number) => (t >= T0 + 70 * S && (t - T0) % (20 * S) === 0 ? [{ k: 'embete' }] : []);
  const v = vivre({ etat: etatNeuf(T0), debut: T0, duree: 12 * MIN, h0: 10, faits: secouer });
  const fonds = v.journal.filter((x) => x.s.type === 'fond').map((x) => ({ t: x.t - T0, id: x.s.id }));
  const boude = fonds.filter((f) => f.id === 'boudeur');
  assert.ok(boude.length >= 2, 'secoué sans arrêt, il boude, s\'arrête, puis reboude plus tard');
  for (const b of boude) { const fin = fonds.find((f) => f.t > b.t)!; assert.ok(fin && fin.t - b.t <= 90 * S, `la bouderie dure ${(fin.t - b.t) / S} s`); assert.ok(fin.t - b.t >= 30 * S); }
  for (let i = 1; i < boude.length; i++) { const finAvant = fonds.find((f) => f.t > boude[i - 1].t)!; assert.ok(boude[i].t - finAvant.t >= 5 * MIN, 'pas de nouvelle bouderie avant 5 minutes'); }
  assert.ok(comportements(v.journal).some((x) => x.s.id === 'bouder' && /Je boude un instant : tu m'as secoué \d+ fois\./.test(x.s.raison)));
  // Une caresse : fin de la bouderie au battement même, et soulagement.
  const quelquesSecousses = (t: number): Fait[] => (t >= T0 + 70 * S && t < T0 + 2 * MIN && (t - T0) % (10 * S) === 0 ? [{ k: 'embete' }] : []);
  let boudeA = 0;
  vivre({ etat: etatNeuf(T0), debut: T0, duree: 4 * MIN, h0: 10, faits: quelquesSecousses, chaque: (p) => { if (!boudeA && p.etat.fond.id === 'boudeur') boudeA = p.t; } });
  assert.ok(boudeA > 0, 'secoué plusieurs fois, il boude');
  const boudeur = vivre({ etat: etatNeuf(T0), debut: T0, duree: boudeA - T0 + 2 * S, h0: 10, faits: quelquesSecousses }).etat;
  assert.equal(boudeur.fond.id, 'boudeur'); assert.equal(boudeur.comportement?.id, 'bouder');
  const r = C.avancer(boudeur, { faits: [{ k: 'caresse' }], ctx: { ...CTX, heure: 10 } }, boudeA + 6 * S);
  assert.notEqual(r.etat.fond.id, 'boudeur'); assert.ok(r.sorties.some((s) => s.type === 'emotion' && s.id === 'soulagement'));
  assert.equal(r.etat.comportement, null, 'il ne boude plus');
  assert.ok(r.sorties.some((s) => s.type === 'comportement' && s.id === 'repos'), 'sa pose de boudeur est retirée');
});

test('sommeil : il somnole après 180 secondes d\'absence, et un appel le réveille tout de suite', () => {
  // 2 h du matin, la personne s'en va à T0 + 60 s.
  const depart = T0 + 60 * S;
  const scene = (t: number): Ctx => ({ present: t < depart, inactifMs: t < depart ? 5 * S : t - depart + 5 * S });
  const v = vivre({ etat: etatNeuf(T0), debut: T0, duree: 10 * MIN, h0: 2, ctx: scene });
  const dodo = comportements(v.journal).find((x) => x.s.id === 'somnoler');
  const vuA = depart - 2 * S; // le dernier battement où elle était là
  assert.ok(dodo, 'il finit par somnoler'); assert.ok(dodo!.t - vuA >= 180 * S, `somnoler ${(dodo!.t - vuA) / S} s après la dernière présence`);
  assert.ok(!v.journal.some((x) => x.s.type === 'fond' && x.s.id === 'endormi' && x.t - vuA < 180 * S), 'pas endormi avant 180 secondes d\'absence');
  assert.match(dodo!.s.raison, /^Je somnole : il est 2 h du matin et rien ne bouge depuis \d+ min\.$/);
  assert.deepEqual(plat(dodo!.s.plan), [['aller', 'coin'], ['pose', 'dort']]);
  assert.equal(v.etat.fond.id, 'endormi'); assert.equal(v.etat.comportement.id, 'somnoler');
  assert.equal(comportements(v.journal).filter((x) => x.s.id === 'somnoler').length, 1, 'un seul somme, pas un par battement');
  // On l'appelle : réveillé au battement même, il vient, s'étonne, puis reste las.
  const t1 = T0 + 10 * MIN;
  const r = C.avancer(v.etat, { faits: [{ k: 'appel', id: 'clavier' }], ctx: { ...CTX, heure: 2.2, present: true, inactifMs: 0 } }, t1);
  assert.equal(r.etat.fond.id, 'attentif', 'il n\'est plus endormi');
  const venir = r.sorties.find((s) => s.type === 'comportement' && s.id === 'venir')!;
  assert.ok(venir && venir.urgent); assert.equal(venir.raison, 'Tu m\'as appelé.');
  const ordre = plat(r.sorties).filter((s) => s.type === 'comportement').map((s) => s.id);
  assert.deepEqual(ordre, ['repos', 'venir'], 'sa pose de dormeur est retirée avant qu\'il vienne');
  assert.deepEqual(plat(venir.plan), [['regarder', 'personne'], ['aller', 'personne'], ['geste', 'etire', 1800]], 'appelé au clavier, il vient ; il dormait : il s\'étire');
  // Touché (il est déjà sous le doigt) : il ne se déplace pas.
  const touche = C.avancer(v.etat, { faits: [{ k: 'appel', id: 'toucher' }], ctx: { ...CTX, heure: 2.2, present: true, inactifMs: 0 } }, t1).sorties.find((s) => s.id === 'venir')!;
  assert.deepEqual(plat(touche.plan), [['regarder', 'personne'], ['geste', 'etire', 1800]]);
  assert.ok(r.sorties.some((s) => s.type === 'emotion' && s.id === 'etonnement' && s.ms === 3000));
  const apres = vivre({ etat: r.etat, debut: t1 + 2 * S, duree: 10 * S, h0: 2.2, ctx: () => ({ present: true, inactifMs: 1000 }) });
  assert.ok(emotions(apres.journal).includes('lassitude'), 'après l\'étonnement : la lassitude de celui qu\'on réveille');
  assert.notEqual(apres.etat.fond.id, 'endormi', 'il ne se rendort pas tant que tu es là');
});

test('émotions : chaque fait a la sienne, au degré juste', () => {
  const suite = (faits: Fait[], ecart = 4 * S, ctx: Ctx = {}) => {
    let e = etatNeuf(T0); const out: string[][] = [];
    faits.forEach((f, i) => { const r = C.avancer(e, { faits: [f], ctx: { ...CTX, heure: 10, ...ctx } }, T0 + (i + 1) * ecart); e = r.etat; out.push(plat(r.sorties).filter((s) => s.type === 'emotion').map((s) => s.id)); });
    return { emo: out, etat: e };
  };
  // Trois secousses rapprochées : agacé, frustré, puis fâché.
  assert.deepEqual(suite([{ k: 'embete' }, { k: 'embete' }, { k: 'embete' }]).emo, [['agacement'], ['frustration'], ['colere']]);
  // Quatre échecs en cinq minutes.
  assert.deepEqual(suite([{ k: 'echec' }, { k: 'echec' }, { k: 'echec' }, { k: 'echec' }], 30 * S).emo, [['deception'], ['triste'], ['frustration'], ['colere']]);
  // Un blocage : colère ; la rage seulement au deuxième en dix minutes.
  const bloc = suite([{ k: 'bloque' }, { k: 'bloque' }], MIN);
  assert.deepEqual(bloc.emo, [['colere'], ['rage']]);
  assert.deepEqual(suite([{ k: 'bloque' }, { k: 'bloque' }], 11 * MIN).emo, [['colere'], ['colere']], 'deux blocages à plus de dix minutes : pas de rage');
  let r = C.avancer(etatNeuf(T0), { faits: [{ k: 'bloque' }], ctx: { ...CTX, heure: 10 } }, T0);
  assert.equal(r.sorties.find((s) => s.type === 'emotion')!.force, true);
  // Alertes : un souci inquiète, trois en dix minutes font craindre ; une urgence fait peur (avec force), trois terrifient.
  assert.deepEqual(suite([{ k: 'alerte', p: .45 }, { k: 'alerte', p: .45 }, { k: 'alerte', p: .45 }], MIN).emo, [['inquiet'], ['inquiet'], ['apprehension']]);
  assert.deepEqual(suite([{ k: 'alerte', p: 1 }, { k: 'alerte', p: 1 }, { k: 'alerte', p: 1 }], MIN, { graves: 1 }).emo, [['peur'], ['peur'], ['terreur']]);
  // L'urgence réglée : soulagé, puis calme quand le soulagement est passé.
  let e = C.avancer(etatNeuf(T0), { faits: [{ k: 'alerte', p: 1 }], ctx: { ...CTX, heure: 10, graves: 1 } }, T0).etat;
  const v = vivre({ etat: e, debut: T0 + 2 * S, duree: 40 * S, h0: 10, faits: (t) => (t === T0 + 4 * S ? [{ k: 'alerte_reglee' }] : []) });
  const emo = v.journal.filter((x) => x.s.type === 'emotion');
  assert.deepEqual(emo.map((x) => x.s.id), ['soulagement', 'calme']);
  assert.ok(emo[1].t - emo[0].t >= 12 * S && emo[1].t - emo[0].t <= 16 * S); assert.equal(emo[1].s.ms, 6000);
  assert.ok(comportements(v.journal).some((x) => x.s.id === 'souffler' && x.s.raison === 'Ouf : tu as vu l\'urgence.'));
  // Il dit ce qui est vrai (l'urgence a été vue, pas « réglée »), et un seul récit : plus de souci ni de ronde ensuite.
  assert.deepEqual(emo.map((x) => x.s.raison), ['tu as vu l\'urgence', 'tu t\'en occupes']);
  const apresVue = vivre({ etat: e, debut: T0 + 2 * S, duree: 6 * MIN, h0: 10, faits: (t) => (t === T0 + 4 * S ? [{ k: 'alerte_reglee' }] : []) });
  assert.ok(!apresVue.journal.some((x) => x.t > T0 + 4 * S && (x.s.id === 'soucieux' || x.s.id === 'ronde' || /pas réglé|est réglée|rentré dans l'ordre/.test(x.s.raison))), 'après « ouf », il ne dit pas le contraire');
  assert.ok(C.besoins(apresVue.etat, { ...CTX, heure: 10 }, T0 + 30 * S).inquietude < .1, 'une alerte vue ne l\'inquiète plus');
  // Réussites : content, puis joyeux, puis fier quand elles s'enchaînent ; appris : fier, ou euphorique (une fois par dix minutes).
  assert.deepEqual(suite([{ k: 'reussite' }, { k: 'reussite' }, { k: 'reussite' }]).emo, [['contentement'], ['joie'], ['fierte']]);
  assert.deepEqual(suite([{ k: 'appris', p: .5 }, { k: 'appris', p: .9 }, { k: 'appris', p: .9 }], MIN).emo, [['fierte'], ['euphorie'], ['fierte']]);
  assert.deepEqual(suite([{ k: 'merci' }, { k: 'caresse' }]).emo, [['gratitude'], ['tendresse']]);
  // Une page : curieux, une fois par page et par minute ; le caractère curieux s'y intéresse davantage.
  assert.deepEqual(suite([{ k: 'page', id: 'home' }, { k: 'page', id: 'home' }, { k: 'page', id: 'net' }]).emo, [['interet'], [], ['interet']]);
  r = C.avancer(etatNeuf(T0, 'calme'), { faits: [{ k: 'page', id: 'home', texte: 'Maison' }], ctx: { ...CTX, heure: 10 } }, T0);
  assert.deepEqual(plat(r.sorties.find((s) => s.type === 'emotion')), { type: 'emotion', id: 'curiosite', raison: 'tu viens d\'ouvrir Maison' });
  // Les appels : content ; trois en une minute, il s'en amuse ; cinq, ça l'agace.
  assert.deepEqual(suite(Array.from({ length: 5 }, () => ({ k: 'appel', id: 'toucher' })), 6 * S).emo, [['contentement'], ['contentement'], ['malice'], ['malice'], ['agacement']]);
  // Une émotion venue d'un autre écran : seulement le temps qui reste ; déjà montrée ici : rien à redemander.
  r = C.avancer(etatNeuf(T0), { faits: [{ k: 'humeur', id: 'euphorie', p: 7000 }, { k: 'humeur', id: 'joie' }, { k: 'humeur', id: 'inconnue', p: 5000 }], ctx: { ...CTX, heure: 10 } }, T0);
  assert.deepEqual(plat(r.sorties.filter((s) => s.type === 'emotion')).map((s) => [s.id, s.ms]), [['euphorie', 7000]]);
  // Une sorte de fait inconnue est ignorée, sans erreur.
  r = C.avancer(etatNeuf(T0), { faits: [{ k: 'nimporte' }, { k: 'survol' }], ctx: { ...CTX, heure: 10 } }, T0);
  assert.deepEqual(plat(r.etat.faits).map((f: Fait) => f.k), ['survol']);
  // Chaque émotion sortie existe dans la palette du serveur, et a une raison.
  for (const s of [...v.journal.map((x) => x.s), ...r.sorties]) if (s.type === 'emotion') { assert.ok(isMood(s.id)); assert.ok(s.raison.length > 0); }
});

test('24 heures sans aucun fait : des émotions rares et courtes', () => {
  for (const [nom, scene] of [
    ['quelqu\'un est là, sans rien faire', (): Ctx => ({ present: true, inactifMs: 10 * S })],
    ['personne', (t: number): Ctx => ({ present: false, inactifMs: t - T0 + 5 * MIN })],
    ['là, mais il ne peut pas se promener', (): Ctx => ({ present: true, inactifMs: 10 * S, promenade: false })],
  ] as Array<[string, (t: number) => Ctx]>) for (const car of ['calme', 'enjoue', 'reveur']) {
    const v = vivre({ etat: etatNeuf(T0, car), debut: T0, duree: 24 * H, ctx: scene });
    assert.ok(v.plusLong <= 120 * S, `${nom}, ${car} : aucun épisode de plus de 120 s (${v.plusLong / S} s)`);
    assert.ok(v.avecEmotion / v.pas < .15, `${nom}, ${car} : ${(100 * v.avecEmotion / v.pas).toFixed(1)} % du temps avec une émotion`);
    for (const x of v.journal) if (x.s.type === 'emotion') assert.ok(isMood(x.s.id), `${x.s.id} existe côté serveur`);
    // Même quand rien ne se passe, il ne répète pas le même geste à cadence fixe pendant des heures.
    const soupirs = comportements(v.journal).filter((x) => x.s.id === 'soupirer').length;
    assert.ok(soupirs <= 60, `${nom}, ${car} : ${soupirs} soupirs en 24 h`);
  }
});

/** Une journée animée et rejouable : pages, réussites, échecs, appels, frappe, absences, nuit. Aucun hasard : tout vient de l'heure. */
function journee(car: string, duree = 20 * H) {
  const hasard = (t: number, sel: number) => C.hache(`${Math.floor((t - T0) / (2 * S))}:${sel}`) % 1000;
  const scene = (t: number): Ctx => {
    const m = Math.floor((t - T0) / MIN);
    const absent = (m % 180) >= 150;                       // 30 minutes d'absence toutes les 3 heures
    const ecrit = !absent && (m % 60) >= 20 && (m % 60) < 30; // 10 minutes de frappe par heure
    return { present: !absent, inactifMs: absent ? ((m % 180) - 150) * MIN + 30 * S : ecrit ? 500 : ((t - T0) / (2 * S)) % 40 < 5 ? 500 : 20 * S, ecrit, promenade: (m % 240) < 200, reduit: (m % 600) >= 560, tenu: hasard(t, 9) === 0 };
  };
  const faits = (t: number): Fait[] => {
    const m = Math.floor((t - T0) / MIN), out: Fait[] = [];
    if ((m % 180) >= 150) return out;
    if (hasard(t, 1) < 4) out.push({ k: 'page', id: ['home', 'apps', 'net', 'settings'][hasard(t, 2) % 4], texte: 'Maison' });
    if (hasard(t, 3) < 3) out.push({ k: 'reussite', id: `z${hasard(t, 4)}`, texte: 'Sauvegarde terminée', x: 400, y: 300 });
    if (hasard(t, 5) < 1) out.push({ k: 'echec', id: `e${hasard(t, 4)}`, texte: 'Erreur de connexion', x: 420, y: 320 });
    if (hasard(t, 6) < 1) out.push({ k: 'appel', id: hasard(t, 7) % 2 ? 'toucher' : 'clavier' });
    if (hasard(t, 8) < 1) out.push({ k: 'echange' });
    return out;
  };
  const cible = (e: Etat, t: number) => { const f = [...e.faits].reverse().find((x: Fait) => (x.k === 'reussite' || x.k === 'echec') && typeof x.x === 'number' && t - (x.t ?? 0) < 20 * S); return f ? { cle: f.id, sorte: f.k, texte: f.texte, x: f.x, y: f.y } : null; };
  return vivre({ etat: etatNeuf(T0, car), debut: T0, duree, ctx: (t, e) => ({ ...scene(t), cible: cible(e, t) }), faits });
}

test('comportements : une journée simulée, tout a une raison et rien ne se répète', () => {
  const v = journee('curieux');
  const C1 = comportements(v.journal), libres = C1.filter((x) => !IMPOSES.has(x.s.id));
  const faitsVus = new Set(C1.map((x) => x.s.id));
  for (const id of ['venir', 'saluer', 'observer_page', 'aller_voir', 'promenade', 'bailler', 'regarder_travailler', 'se_reposer', 'sautiller']) assert.ok(faitsVus.has(id), `la journée a montré « ${id} » (vus : ${[...faitsVus].join(', ')})`);
  // Chaque choix a une raison : non vide, 120 caractères au plus, sans « undefined » ni « NaN ».
  for (const x of v.journal) {
    assert.ok(x.s.raison.length > 0 && x.s.raison.length <= 120, `raison de ${x.s.id} : « ${x.s.raison} »`);
    assert.doesNotMatch(x.s.raison, /undefined|NaN|null|\[object/, x.s.id);
    if (x.s.type === 'comportement') assert.match(x.s.raison, /^[A-ZÉ].*[.!]$/, `une phrase : « ${x.s.raison} »`);
  }
  // Jamais deux fois de suite le même choix (rester tranquille compte pour un choix ; les urgences et le geste de travail ne sont pas des choix).
  for (const jeu of [v, journee('enjoue', 12 * H), vivre({ etat: etatNeuf(T0, 'reveur'), debut: T0, duree: 12 * H, h0: 20, ctx: () => ({ present: true, inactifMs: 20 * S }) })]) {
    assert.ok(jeu.choix.length > 20);
    for (let i = 1; i < jeu.choix.length; i++) assert.ok(jeu.choix[i] !== jeu.choix[i - 1] || jeu.choix[i] === 'repos' || IMPOSES.has(jeu.choix[i]), `deux fois de suite : ${jeu.choix[i]}`);
  }
  // Aucun déplacement quand la personne écrit, le tient, a coupé la promenade, ou demande moins d'animations ; ni geste en mouvement réduit.
  for (const x of C1) {
    const aller = (x.s.plan ?? []).some((p) => p[0] === 'aller'), geste = (x.s.plan ?? []).some((p) => p[0] === 'geste');
    if (x.ctx.ecrit || x.ctx.tenu || x.ctx.reduit || x.ctx.promenade === false) assert.ok(!aller, `${x.s.id} : un déplacement alors que ${x.ctx.ecrit ? 'la personne écrit' : x.ctx.tenu ? 'elle le tient' : x.ctx.reduit ? 'le mouvement est réduit' : 'la promenade est coupée'}`);
    if (x.ctx.reduit) assert.ok(!geste, `${x.s.id} : un geste en mouvement réduit`);
  }
  assert.ok(C1.some((x) => x.ctx.ecrit), 'il fait quand même quelque chose quand la personne écrit (regard, expression)');
  // Au moins 8 secondes entre la fin d'un comportement choisi et le début du suivant (sauf quand il se lève d'un repos).
  for (let i = 1; i < libres.length; i++) {
    const a = libres[i - 1], b = libres[i]; if (a.s.id === 'somnoler' || a.s.id === 'se_reposer') continue;
    const entre = C1.some((x) => IMPOSES.has(x.s.id) && x.t > a.t && x.t <= b.t);
    if (!entre && (a.s.duree ?? 0) < 5 * MIN) assert.ok(b.t - (a.t + (a.s.duree ?? 0)) >= 8 * S, `${a.s.id} puis ${b.s.id} : ${(b.t - a.t - (a.s.duree ?? 0)) / S} s`);
  }
  // Un déplacement choisi par 45 secondes au plus, 12 par dix minutes.
  const allers = libres.filter((x) => (x.s.plan ?? []).some((p) => p[0] === 'aller')).map((x) => x.t);
  assert.ok(allers.length > 10);
  for (let i = 1; i < allers.length; i++) assert.ok(allers[i] - allers[i - 1] >= 45 * S, `deux déplacements à ${(allers[i] - allers[i - 1]) / S} s`);
  for (const t of allers) assert.ok(allers.filter((u) => u > t - 10 * MIN && u <= t).length <= 12);
  // Un appel : il vient au battement même, quoi qu'il fasse (sauf si on le tient à ce moment-là).
  const instants = [...new Set(v.appels)];
  assert.ok(instants.length >= 10, `${instants.length} appels dans la journée`);
  for (const t of instants) {
    const venu = v.journal.some((x) => x.t === t && x.s.type === 'comportement' && x.s.id === 'venir' && x.s.urgent === true);
    assert.ok(venu || v.tenus.includes(t), `appel à ${(t - T0) / MIN} min : il vient tout de suite`);
  }
  // Le même scénario rejoué donne exactement les mêmes sorties.
  const rejoue = journee('curieux');
  assert.deepEqual(rejoue.journal.map((x) => [x.t, x.s]), v.journal.map((x) => [x.t, x.s]));
  assert.deepEqual(plat(rejoue.etat), plat(v.etat));
});

test('comportements : bâiller la nuit, se rapprocher sans insister, regarder travailler sans bouger', () => {
  // 2 h du matin, quelqu'un est là : il bâille, et dit pourquoi.
  let v = vivre({ etat: etatNeuf(T0), debut: T0, duree: 20 * MIN, h0: 2, ctx: () => ({ present: true, inactifMs: 10 * S }) });
  const baille = comportements(v.journal).filter((x) => x.s.id === 'bailler');
  assert.ok(baille.length >= 2, 'il bâille plusieurs fois');
  assert.ok(baille[0].s.raison.includes('il est 2 h'), baille[0].s.raison);
  assert.deepEqual(plat(baille[0].s.plan), [['geste', 'baille', 2400]]);
  assert.ok(emotions(v.journal).some((id) => id === 'fatigue' || id === 'lassitude'), 'le bâillement vient avec la fatigue sur son visage');
  assert.ok(!comportements(v.journal).some((x) => x.s.id === 'jouer' || x.s.id === 'promenade'), 'fatigué, il ne joue pas et ne se promène pas');
  // En plein jour, debout depuis longtemps : la raison n'est plus l'heure.
  const e = etatNeuf(T0); e.eveilDepuis = T0 - 20 * H; e.dernier['f:echange'] = T0;
  v = vivre({ etat: e, debut: T0, duree: 3 * H, h0: 19, ctx: () => ({ present: true, inactifMs: 10 * S }) });
  assert.ok(comportements(v.journal).some((x) => x.s.id === 'bailler' && /^Je bâille : (je suis debout depuis \d+ h|il est \d+ h)\.$/.test(x.s.raison)));
  // Compagnie : 3 approches par heure au plus ; après 2 approches sans réponse, il s'arrête au moins 30 minutes, et le dit par sa déception.
  const seul = etatNeuf(T0, 'calin'); seul.eveilDepuis = T0 - 3 * H;
  v = vivre({ etat: seul, debut: T0, duree: 6 * H, h0: 10, ctx: () => ({ present: true, inactifMs: 20 * S }) });
  const approches = comportements(v.journal).filter((x) => x.s.id === 'se_rapprocher').map((x) => x.t);
  assert.ok(approches.length >= 2 && approches.length <= 4, `il vient vers toi, sans insister (${approches.length} fois en 6 h)`);
  for (const t of approches) assert.ok(approches.filter((u) => u > t - H && u <= t).length <= 3, '3 par heure au plus');
  assert.ok(approches[1] - approches[0] >= 10 * MIN, '10 minutes de repos entre deux approches');
  if (approches[2]) assert.ok(approches[2] - approches[1] >= 30 * MIN, `après 2 approches ignorées : arrêt de 30 minutes (${(approches[2] - approches[1]) / MIN} min)`);
  // Sa déception et sa solitude, il les montre une fois chacune : pas la même raison redite toute la journée.
  assert.equal(emotions(v.journal).filter((id) => id === 'deception').length, 1); assert.equal(emotions(v.journal).filter((id) => id === 'solitude').length, 1);
  const raisons = v.journal.filter((x) => x.s.type === 'emotion').map((x) => x.s.raison);
  assert.equal(raisons.filter((r) => r === 'je suis venu vers toi deux fois, sans réponse').length, 1);
  // « En manque » ne reste pas son visage pendant des heures : 20 minutes, puis il passe à autre chose.
  const fonds = v.journal.filter((x) => x.s.type === 'fond');
  let enManque = 0; fonds.forEach((x, i) => { if (x.s.id === 'en_manque') enManque += (fonds[i + 1]?.t ?? T0 + 6 * H) - x.t; });
  assert.ok(enManque > 0 && enManque <= 25 * MIN, `en manque ${Math.round(enManque / MIN)} min sur 6 h`);
  assert.match(comportements(v.journal).find((x) => x.s.id === 'se_rapprocher')!.s.raison, /^Je me rapproche : on ne s'est pas parlé depuis \d+ h\.$/);
  // Une réponse (un échange) : il n'est plus en manque, et ne revient pas à la charge.
  const r = C.avancer(v.etat, { faits: [{ k: 'echange' }], ctx: { ...CTX, heure: 16 } }, T0 + 6 * H);
  assert.equal(r.etat.rapprocher.rates, 0);
  const suite = vivre({ etat: r.etat, debut: T0 + 6 * H + 2 * S, duree: 15 * MIN, h0: 16, ctx: () => ({ present: true, inactifMs: 20 * S }) });
  assert.ok(!comportements(suite.journal).some((x) => x.s.id === 'se_rapprocher'));
  // La personne écrit depuis plus de 20 secondes : il s'assoit et la regarde, sans aucun déplacement.
  const ecrit = etatNeuf(T0, 'studieux'); ecrit.eveilDepuis = T0 - 2 * H;
  v = vivre({ etat: ecrit, debut: T0, duree: 6 * MIN, h0: 10, ctx: () => ({ present: true, inactifMs: 300, ecrit: true }) });
  const regarde = comportements(v.journal).find((x) => x.s.id === 'regarder_travailler');
  assert.ok(regarde, `il regarde travailler (${comportements(v.journal).map((x) => x.s.id).join(', ')})`);
  assert.ok(regarde!.t - T0 >= 20 * S); assert.deepEqual(plat(regarde!.s.plan), [['pose', 'assis'], ['regarder', 'personne']]);
  assert.match(regarde!.s.raison, /^Je te regarde travailler : tu écris depuis /);
  for (const x of comportements(v.journal)) assert.ok(!(x.s.plan ?? []).some((p) => p[0] === 'aller'), `${x.s.id} sans déplacement pendant la frappe`);
  assert.ok(v.journal.some((x) => x.s.type === 'comportement' && x.s.id === 'repos' && JSON.stringify(x.s.plan) === '[["pose",null]]'), 'la pose est retirée à la fin');
  // Odin travaille : un geste « avance » toutes les 8 secondes, rien d'autre.
  v = vivre({ etat: etatNeuf(T0), debut: T0, duree: MIN, h0: 10, ctx: () => ({ present: true, inactifMs: 20 * S, occupe: true }) });
  const travail = comportements(v.journal);
  assert.ok(travail.length >= 6 && travail.every((x) => x.s.id === 'travailler' && x.s.raison === 'Je travaille sur ta demande.'));
  for (let i = 1; i < travail.length; i++) assert.equal(travail[i].t - travail[i - 1].t, 8 * S);
  assert.equal(v.etat.fond.id, 'attentif');
  // Retour après une longue absence : il salue, et dit depuis combien de temps.
  const parti = etatNeuf(T0); parti.jourSalue = '2026-11-16'; parti.dernierePresence = T0 - 45 * MIN;
  v = vivre({ etat: parti, debut: T0, duree: 30 * S, h0: 10, ctx: () => ({ present: true, inactifMs: 500 }) });
  assert.equal(comportements(v.journal)[0].s.id, 'saluer'); assert.equal(comportements(v.journal)[0].s.raison, 'Te revoilà après 45 min.');
  assert.deepEqual(emotions(v.journal), ['joie']);
  // Après un long trou (plus de 4 heures) : il se réveille, s'étonne, s'étire, puis salue.
  const nuit = etatNeuf(T0); nuit.jourSalue = '2026-11-16'; nuit.dernierePresence = T0 - 5 * H; nuit.eveilDepuis = T0 - 20 * H;
  v = vivre({ etat: nuit, debut: T0, duree: MIN, h0: 8, ctx: () => ({ present: true, inactifMs: 500 }) });
  assert.deepEqual(comportements(v.journal).map((x) => x.s.id).slice(0, 2), ['s_etirer', 'saluer']);
  assert.equal(comportements(v.journal)[0].s.raison, 'Je m\'étire : je viens de me réveiller.');
  assert.ok(emotions(v.journal).includes('etonnement')); assert.equal(v.etat.eveilDepuis, T0, 'il est debout depuis maintenant');
  // Un jour de fête, à la première présence : il rit et fait une pirouette, en disant pourquoi.
  const noel = { id: 'noel', nom: 'Noël' };
  v = vivre({ etat: C.nouvelEtat(null, T0), debut: T0, duree: MIN, h0: 10, ctx: () => ({ present: true, inactifMs: 500, jour: '2026-12-25', fete: noel }) });
  assert.ok(emotions(v.journal).includes('rire'));
  assert.ok(comportements(v.journal).some((x) => x.s.id === 'pirouette' && x.s.raison === 'C\'est Noël !'), comportements(v.journal).map((x) => `${x.s.id} ${x.s.raison}`).join(' | '));
});

test('pourquoi : une phrase courte, jamais vide, qui dit ce qu\'il fait ou son caractère du jour', () => {
  const e = C.avancer(etatNeuf(T0, 'enjoue', '2026-12-26'), { faits: [], ctx: { ...CTX, heure: 10, jour: '2026-12-26', present: false, inactifMs: 0 } }, T0).etat;
  e.caractere = { id: 'enjoue', nom: 'joueur', causes: ['samedi'] }; e.comportement = null; e.passe = null; e.fond = { id: 'eveille', depuis: T0 };
  assert.deepEqual(plat(C.pourquoi(e, { ...CTX, heure: 10, jour: '2026-12-26' }, T0 + S)), { fait: 'repos', raison: 'c\'est samedi', phrase: 'Je suis d\'humeur joueuse aujourd\'hui : c\'est samedi.' });
  e.caractere = { id: 'enjoue', nom: 'joueur', causes: ['samedi', 'fete'] };
  assert.equal(C.pourquoi(e, { ...CTX, heure: 10, fete: { id: 'noel', nom: 'Noël' } }, T0 + S).phrase, 'Je suis d\'humeur joueuse aujourd\'hui : c\'est samedi et c\'est Noël.');
  // En train de faire quelque chose : il dit quoi et pourquoi.
  const r = C.avancer(etatNeuf(T0), { faits: [{ k: 'appel', id: 'toucher' }], ctx: { ...CTX, heure: 10 } }, T0);
  assert.deepEqual(plat(C.pourquoi(r.etat, { ...CTX, heure: 10 }, T0 + S)), { fait: 'venir', raison: 'Tu m\'as appelé', phrase: 'Tu m\'as appelé.' });
  // Chaque disposition a sa phrase ; aucune ne dépasse 120 caractères, même avec un texte très long.
  for (const fond of ['alerte', 'attentif', 'endormi', 'somnolent', 'soucieux', 'boudeur', 'en_manque', 'las', 'enjoue', 'eveille']) {
    const x = etatNeuf(T0); x.fond = { id: fond, depuis: T0 };
    const p = C.pourquoi(x, { ...CTX, heure: 2 }, T0 + 20 * MIN);
    assert.ok(p.phrase.length > 0 && p.phrase.length <= 120 && p.raison.length > 0 && p.fait === 'repos', fond); assert.doesNotMatch(p.phrase, /undefined|NaN/); assert.match(p.phrase, /^J|^T/);
  }
  const long = C.avancer(etatNeuf(T0), { faits: [], ctx: { ...CTX, heure: 10, inactifMs: 5 * S, cible: { cle: 'x', sorte: 'nouveau', texte: 'x'.repeat(300), x: 10, y: 10 } } }, T0 + 20 * S);
  for (const s of long.sorties) assert.ok(s.raison.length <= 120);
  assert.ok(C.pourquoi(C.nouvelEtat(null, T0), {}, T0).phrase.length > 0, 'même sans rien savoir, il a quelque chose à dire');
});

test('« il répond quand je l\'appelle » : reconnaître un appel, lire la saisie', () => {
  const a = (t: string) => plat(C.estAppel(t));
  assert.deepEqual(a('Odin ?'), { appel: true, seul: true, reste: '', force: 2 });
  assert.deepEqual(a('hé odin'), { appel: true, seul: true, reste: '', force: 1 });
  assert.deepEqual(a('dis Odin, allume le salon'), { appel: true, seul: false, reste: 'allume le salon', force: 1 });
  assert.deepEqual(a('tu es là odin ?'), { appel: true, seul: true, reste: 'tu es là', force: 2 });
  assert.equal(a('ODIN !!').force, 3); assert.equal(a('odin, odin !').force, 3); assert.equal(a('odin').force, 1); assert.equal(a('Odin !').force, 2);
  for (const t of ['Bonjour Odin', 'ok odin', 'Salut Odin !', 'coucou odin', 'Odin, tu dors ?', 'réveille-toi Odin', 'Audin ?', 'odin allume la lumière', 'Éteins tout, Odin']) assert.equal(a(t).appel, true, t);
  for (const t of ['parle-moi d\'Odin', 'la page d\'odin', 'je cherche pour odin', 'un mot sur Odin', 'odinette', 'le dieu Odin est borgne', 'bonjour', '', 'c\'est pour l\'Odin']) assert.equal(a(t).appel, false, t);
  assert.equal(a('Odin, tu dors ?').seul, true); assert.equal(a('Odin, quelle heure est-il ?').seul, false); assert.equal(a('Odin, quelle heure est-il ?').reste, 'quelle heure est-il ?');
  assert.equal(C.estAppel('Jarvis ?', 'jarvis').appel, true); assert.equal(C.estAppel('Jarvis ?').appel, false);
  // La saisie : un signe, et l'expression qui va avec.
  const table: Array<[string, string, string]> = [
    ['odin ?', 'appel', 'ecoute'], ['comment ça marche', 'question', 'curiosite'], ['il fait beau ?', 'question', 'curiosite'], ['allume le salon', 'ordre', 'determination'], ['Éteins la télé', 'ordre', 'determination'],
    ['merci beaucoup', 'merci', 'tendresse'], ['bonjour toi', 'salut', 'contentement'], ['ça marche pas', 'souci', 'inquiet'], ['le wifi est lent', 'souci', 'inquiet'], ['fais vite', 'urgent', 'apprehension'],
    ['IL FAUT QUE TU VIENNES', 'urgent', 'apprehension'], ['tu es nul', 'reproche', 'gene'], ['a'.repeat(180), 'long', 'interet'], ['un\ndeux\ntrois', 'long', 'interet'], ['je note une idée', 'neutre', 'ecoute'],
    ['voici ma clé sk-abcd1234efgh5678', 'secret', 'cache'], ['0123456789abcdef0123456789abcdef01234567', 'secret', 'cache'],
  ];
  for (const [texte, signe, humeur] of table) { assert.deepEqual(plat(C.lireSaisie(texte, '')), { signe, humeur }, texte.slice(0, 30)); assert.ok(isMood(humeur)); }
  assert.deepEqual(plat(C.lireSaisie('je', 'je voulais te dire que')), { signe: 'efface', humeur: 'etonnement' });
  assert.deepEqual(plat(C.lireSaisie('', '')), { signe: 'vide', humeur: '' });
  assert.notEqual(C.lireSaisie('excellent travail', '').signe, 'souci', '« lent » dans « excellent » n\'est pas un souci');
  // Le même signe deux fois de suite ne change rien : même texte, même lecture.
  assert.deepEqual(plat(C.lireSaisie('allume le salon', 'allume le salo')), plat(C.lireSaisie('allume le salon', 'allume le salo')));
  assert.equal(C.lireSaisie('allume le salon et la cuisine', 'allume le salon').signe, C.lireSaisie('allume le salon', 'allume le').signe);
});

test('persistance : ce qu\'on garde tient en peu de place et redonne le même Odin', () => {
  const v = journee('curieux', 14 * H), fin = T0 + 14 * H;
  const garde = JSON.stringify(C.resumer(v.etat));
  assert.ok(garde.length < 2000, `${garde.length} caractères`);
  for (const car of ['enjoue', 'calin']) assert.ok(JSON.stringify(C.resumer(journee(car, 6 * H).etat)).length < 2000);
  // Relu tout de suite : la disposition, les délais, le caractère et ce qu'il sait reviennent.
  const e = C.nouvelEtat(JSON.parse(garde), fin + 5 * S);
  assert.equal(e.fond.id, v.etat.fond.id); assert.equal(Math.round(e.fond.depuis / S), Math.round(v.etat.fond.depuis / S));
  assert.deepEqual(plat(e.caractere), plat(v.etat.caractere)); assert.equal(e.jour, '2026-11-16'); assert.equal(e.jourSalue, v.etat.jourSalue);
  assert.deepEqual(plat(e.histo), plat(v.etat.histo));
  for (const [k, t] of Object.entries(plat(v.etat.dernier) as Record<string, number>)) if (fin - t < 3 * H) assert.ok(Math.abs(e.dernier[k] - t) <= S, `délai de ${k}`);
  assert.ok(Math.abs(e.eveilDepuis - v.etat.eveilDepuis) <= S); assert.ok(Math.abs(e.dernierePresence - v.etat.dernierePresence) <= S);
  assert.equal(e.comportement, null, 'le comportement en cours n\'est pas gardé');
  assert.ok(e.faits.length > 0 && e.faits.length <= 20);
  const b0 = C.besoins(v.etat, { ...CTX, heure: 22 }, fin), b1 = C.besoins(e, { ...CTX, heure: 22 }, fin);
  for (const k of ['energie', 'compagnie', 'ennui']) assert.ok(Math.abs(b0[k] - b1[k]) < .02, `${k} : ${b0[k]} puis ${b1[k]}`);
  // Il ne refait pas tout de suite ce qu'il vient de faire (les repos reviennent).
  const suite = vivre({ etat: e, debut: fin + 6 * S, duree: 20 * S, h0: 22, ctx: () => ({ present: true, inactifMs: 20 * S }) });
  assert.ok(!comportements(suite.journal).some((x) => x.s.id === 'saluer'), 'pas de nouveau bonjour au rechargement');
  // Gardé il y a plus de 30 minutes : la disposition est recalculée au premier battement.
  const somnolent = plat(C.resumer(v.etat)); somnolent.fond = ['boudeur', -10];
  assert.equal(C.nouvelEtat(somnolent, fin + 10 * S).fond.id, 'boudeur');
  const vieux = C.nouvelEtat(somnolent, fin + 31 * MIN);
  assert.equal(vieux.fond.id, 'eveille'); assert.equal(vieux.fond.neuf, true);
  // Un autre jour : un nouveau caractère, dès le premier battement.
  const lendemain = C.avancer(C.nouvelEtat(JSON.parse(garde), fin + 10 * H), { faits: [], ctx: { ...CTX, heure: 8, jour: '2026-11-17' } }, fin + 10 * H).etat;
  assert.equal(lendemain.jour, '2026-11-17'); assert.deepEqual(plat(lendemain.caractere), plat(C.caractereDuJour({ jour: '2026-11-17', fete: null })));
  // Une sauvegarde abîmée ou étrangère ne casse rien.
  for (const mauvais of [null, 42, 'x', {}, { v: 2 }, { v: 1, t: 'hier' }, { v: 1, t: fin + H }, { v: 1, t: fin, fond: ['inconnu', 0], dernier: { a: 'b' }, faits: [[1], ['x', 'page'], [0, 'inconnu']], caractere: { id: 'pirate' }, histo: [1, 'voler'], seuils: null }]) {
    const x = C.nouvelEtat(mauvais, fin + S);
    assert.equal(x.v, 1); assert.equal(x.fond.id, 'eveille'); assert.deepEqual(plat(x.faits), []); assert.deepEqual(plat(x.histo), []);
    assert.doesNotThrow(() => C.avancer(x, { faits: [], ctx: { ...CTX, heure: 9 } }, fin + 2 * S));
  }
});

// ---------- Corrections après relecture ----------
/** Le visage (face.js), sa logique pure : pour vérifier ce qui se voit quand le moteur et la page lui parlent. */
function chargerVisage() {
  const window: Record<string, any> = {};
  runInNewContext(lire('face.js'), { window, setTimeout, clearTimeout });
  return window.OdinFace as { pur: { etatNeuf(): any; agir(e: any, a: Record<string, unknown>, t: number): any; vue(e: any, t: number): { id: string; couleur: boolean } }; duree(id: string, ms?: number): number };
}
const coeurPlus = C as Coeur & {
  marcheRatee(etat: Etat, now: number, id?: string): Etat; visageFond(id: string, ctx?: Ctx | null): string;
  notifFraiche(at: number, depuis: number, nonLues: number): boolean; faitDeNotification(n: { title?: string; level?: string; kind?: string }): Fait;
  sorteDeMessage(txt: string): string; jugerZone(memo: Record<string, unknown>, txt: string, now: number): string | null;
};

test('notifications : une vieille notification chargée en retard n\'est pas une nouvelle ; une information n\'est pas une réussite', () => {
  const demarre = T0;
  // Datée d'il y a 26 heures, liste arrivée après le premier battement : pas une nouvelle. Arrivée après le démarrage : oui. Déjà lue : non.
  assert.equal(coeurPlus.notifFraiche(T0 - 26 * H, demarre, 0), false); assert.equal(coeurPlus.notifFraiche(T0 - 26 * H, demarre, 3), false);
  assert.equal(coeurPlus.notifFraiche(T0 - 5 * S, demarre, 1), true); assert.equal(coeurPlus.notifFraiche(T0 + 10 * MIN, demarre, 1), true);
  assert.equal(coeurPlus.notifFraiche(T0 + 10 * MIN, demarre, 0), false, 'déjà lue'); assert.equal(coeurPlus.notifFraiche(Number.NaN, demarre, 1), false, 'sans date');
  // Ce que chaque notification lui fait.
  assert.deepEqual(plat(coeurPlus.faitDeNotification({ title: 'Disque du NAS plein', level: 'grave' })), { k: 'alerte', p: 1, texte: 'Disque du NAS plein' });
  assert.deepEqual(plat(coeurPlus.faitDeNotification({ title: 'Imprimante hors ligne', level: 'souci' })), { k: 'alerte', p: .45, texte: 'Imprimante hors ligne' });
  assert.equal(coeurPlus.faitDeNotification({ title: 'J\'ai retenu ta préférence', level: 'ok', kind: 'Décision d\'Odin' }).k, 'appris');
  assert.equal(coeurPlus.faitDeNotification({ title: 'Sauvegarde terminée', level: 'ok' }).k, 'reussite');
  assert.deepEqual(plat(coeurPlus.faitDeNotification({ title: 'Pluie prévue à 17 h', level: 'ok', kind: 'Météo' })), { k: 'nouveau', texte: 'Pluie prévue à 17 h' });
  // Quatre informations de suite : curieux, mais ni fierté, ni « vient de réussir », ni sautillement.
  let e = etatNeuf(T0); const vus: Sortie[] = [];
  for (let i = 0; i < 4; i++) { const r = C.avancer(e, { faits: [coeurPlus.faitDeNotification({ title: `Pluie prévue à ${15 + i} h`, level: 'ok' })], ctx: { ...CTX, heure: 10 } }, T0 + i * 20 * S); e = r.etat; vus.push(...plat(r.sorties)); }
  const v = vivre({ etat: e, debut: T0 + 82 * S, duree: 2 * MIN, h0: 10 });
  const tout = [...vus, ...v.journal.map((x) => x.s)];
  assert.ok(!tout.some((s) => s.id === 'sautiller' || /vient de réussir/.test(s.raison)), 'une information n\'est pas une réussite');
  assert.equal(C.besoins(e, { ...CTX, heure: 10 }, T0 + 62 * S).fierte, 0); assert.ok(C.besoins(e, { ...CTX, heure: 10 }, T0 + 62 * S).curiosite > 0);
  // Le branchement juge la date (plus « le premier relevé »), et l'urgence vue.
  assert.match(SOURCE, /if \(C\.notifFraiche\(Date\.parse\(tete\.at \|\| ''\), demarreLe, nonLues\)\) noter\(C\.faitDeNotification\(tete\)\);/);
  assert.ok(!SOURCE.includes('notifVue !== undefined ||'));
});

test('« Merci Odin » est un merci, pas un appel', () => {
  for (const t of ['merci', 'Merci Odin', 'Merci Odin !', 'Odin, merci beaucoup', 'Super, merci Odin', 'bravo odin']) assert.deepEqual(plat(C.lireSaisie(t)), { signe: 'merci', humeur: 'tendresse' }, t);
  for (const t of ['Odin', 'Odin ?', 'Hé Odin, tu es là ?', 'Odin, allume la lumière']) assert.equal(C.lireSaisie(t).signe, 'appel', t);
  assert.equal(C.estAppel('Merci Odin').appel, true, 'c\'est aussi un appel : au branchement de choisir le merci');
  // Envoyé : un merci est noté, et dans ce cas il ne « vient » pas.
  assert.match(SOURCE, /if \(C\.lireSaisie\(texte, ''\)\.signe === 'merci'\) noter\(\{ k: 'merci' \}\); else \{ const a = C\.estAppel\(texte\); if \(a\.appel\) appeler\(/);
  assert.equal((SOURCE.match(/try \{ surMessage\(/g) ?? []).length, 2, 'au clavier et à l\'envoi');
  assert.match(SOURCE, /if \(now - messageLe < 2000\) return; messageLe = now;/, 'le même message vu deux fois (Entrée, puis l\'envoi) ne compte qu\'une fois');
  const r = C.avancer(etatNeuf(T0), { faits: [{ k: 'merci' }], ctx: { ...CTX, heure: 10 } }, T0);
  assert.deepEqual(plat(r.sorties.filter((s) => s.type === 'emotion').map((s) => s.id)), ['gratitude']); assert.ok(!r.sorties.some((s) => s.id === 'venir'));
  assert.ok(C.besoins(r.etat, { ...CTX, heure: 10 }, T0).fierte > .4);
});

test('faits périmés : notés pendant que l\'onglet était caché ou en pause, ils sont rangés sans émotion ni geste', () => {
  // Trois faits notés à T0, vus 2 heures plus tard (onglet caché entre-temps) : aucun n'est rejoué.
  const vieux: Fait[] = [{ t: T0, k: 'echec', texte: 'Envoi' }, { t: T0, k: 'appris', p: .9 }, { t: T0, k: 'humeur', id: 'joie', p: 20_000 }, { t: T0, k: 'appel', id: 'toucher' }];
  let r = C.avancer(etatNeuf(T0), { faits: vieux, ctx: { ...CTX, heure: 10 } }, T0 + 2 * H);
  assert.ok(!r.sorties.some((s) => s.type === 'emotion' && ['deception', 'euphorie', 'fierte', 'joie', 'contentement'].includes(s.id) && !/revoilà/.test(s.raison)), JSON.stringify(plat(r.sorties)));
  assert.ok(!r.sorties.some((s) => s.id === 'venir'), 'il ne « vient » pas pour un appel vieux de 2 heures');
  assert.deepEqual(plat(r.etat.faits.filter((f: Fait) => f.t === T0).map((f: Fait) => f.k)).sort(), ['appel', 'appris', 'echec', 'humeur'], 'ils restent dans sa mémoire');
  // Frais (moins de 10 secondes) : il réagit ; à 11 secondes : plus.
  r = C.avancer(etatNeuf(T0), { faits: [{ t: T0, k: 'echec' }], ctx: { ...CTX, heure: 10 } }, T0 + 9 * S); assert.deepEqual(plat(r.sorties.filter((s) => s.type === 'emotion').map((s) => s.id)), ['deception']);
  r = C.avancer(etatNeuf(T0), { faits: [{ t: T0, k: 'echec' }], ctx: { ...CTX, heure: 10 } }, T0 + 11 * S); assert.equal(r.sorties.filter((s) => s.type === 'emotion').length, 0);
  r = C.avancer(etatNeuf(T0), { faits: [{ t: T0, k: 'appel', id: 'clavier' }], ctx: { ...CTX, heure: 10 } }, T0 + 2 * S); assert.ok(r.sorties.some((s) => s.id === 'venir'));
  // Une émotion venue d'un autre écran : le temps passé est retranché de ce qui lui restait.
  r = C.avancer(etatNeuf(T0), { faits: [{ t: T0, k: 'humeur', id: 'joie', p: 20_000 }], ctx: { ...CTX, heure: 10 } }, T0 + 6 * S);
  assert.equal(r.sorties.find((s) => s.type === 'emotion' && s.id === 'joie')?.ms, 14_000);
  r = C.avancer(etatNeuf(T0), { faits: [{ t: T0, k: 'humeur', id: 'joie', p: 5_000 }], ctx: { ...CTX, heure: 10 } }, T0 + 8 * S);
  assert.ok(!r.sorties.some((s) => s.type === 'emotion' && s.id === 'joie'), 'plus rien à montrer');
  // Une rafale de la même sorte dans le même battement : une seule émotion (celle du dernier), pas une par fait.
  r = C.avancer(etatNeuf(T0), { faits: Array.from({ length: 40 }, () => ({ k: 'echec' })), ctx: { ...CTX, heure: 10 } }, T0);
  assert.deepEqual(plat(r.sorties.filter((s) => s.type === 'emotion').map((s) => s.id)), ['colere']); assert.equal(r.etat.faits.filter((f: Fait) => f.k === 'echec').length, 40);
  // En pause, un appel ne laisse rien pour plus tard (il répond tout de suite, c'est tout).
  assert.match(SOURCE, /if \(actif\) noter\(g\);/);
});

test('messages de la page : un texte qui s\'écrit petit à petit ne fait ni 40 faits ni une colère ; une zone qui défile ne noie pas sa mémoire', () => {
  // La fiche d'une zone, comme la tient companion.js : chaque changement est daté, puis on juge quand elle se calme.
  const zone = () => ({ fois: [] as number[] }) as Record<string, unknown> & { fois: number[] };
  // Une phrase d'aide de 43 mots contenant « erreur », écrite mot à mot en 5,5 s : la zone défile, rien n'est noté.
  let z = zone(); const mots = Array.from({ length: 43 }, (_, i) => (i === 20 ? 'erreur' : `mot${i}`)); let notes = 0;
  mots.forEach((_, i) => { z.fois.push(T0 + i * 128); if (z.fois.length > 8) z.fois.shift(); });
  if (coeurPlus.jugerZone(z, mots.join(' '), T0 + 43 * 128 + 800)) notes++;
  assert.equal(notes, 0, 'au plus un fait (ici aucun : la zone défilait)');
  // Posé d'un coup : un seul fait, et un texte long qui contient « erreur » n'est pas un échec.
  z = zone(); z.fois.push(T0);
  assert.equal(coeurPlus.jugerZone(z, mots.join(' '), T0 + 800), 'nouveau'); assert.ok(mots.join(' ').length > 120);
  assert.equal(coeurPlus.sorteDeMessage('✗ Erreur : mot de passe invalide'), 'echec'); assert.equal(coeurPlus.sorteDeMessage('✓ Enregistré'), 'reussite'); assert.equal(coeurPlus.sorteDeMessage('3 appareils en ligne'), 'nouveau');
  // Le même message réaffiché 3 secondes après : pas un nouvel échec (5 minutes).
  z = zone(); z.fois.push(T0); assert.equal(coeurPlus.jugerZone(z, '✗ Erreur d\'envoi', T0 + 800), 'echec');
  z.fois.push(T0 + 3 * S); assert.equal(coeurPlus.jugerZone(z, '✗ Erreur d\'envoi', T0 + 3 * S + 800), null);
  z.fois.push(T0 + 6 * MIN); assert.equal(coeurPlus.jugerZone(z, '✗ Erreur d\'envoi', T0 + 6 * MIN + 800), 'echec', 'après 5 minutes, c\'est de nouveau un fait');
  // « Envoi… » puis « ✓ Envoyé » une seconde après : le résultat passe (ce n'est pas la même sorte de message).
  z = zone(); z.fois.push(T0); assert.equal(coeurPlus.jugerZone(z, 'Envoi…', T0 + 800), 'nouveau');
  z.fois.push(T0 + 1000); assert.equal(coeurPlus.jugerZone(z, '✓ Envoyé, c\'est terminé', T0 + 1800), 'reussite');
  // « Analyse en cours : N % » toutes les 2 secondes pendant 3 minutes : rien (elle défile), puis le résultat une fois calmée.
  z = zone(); notes = 0;
  for (let i = 0; i < 90; i++) { const t = T0 + i * 2 * S; z.fois.push(t); if (z.fois.length > 8) z.fois.shift(); if (coeurPlus.jugerZone(z, `Analyse en cours : ${i} %`, t + 800)) notes++; }
  assert.ok(notes <= 1, `${notes} faits pour une zone qui défile`);
  z.fois.push(T0 + 200 * S); assert.equal(coeurPlus.jugerZone(z, '✓ Analyse terminée', T0 + 200 * S + 12 * S), 'reussite');

  // Le cœur : le même message réécrit au même endroit coup sur coup ne compte qu'une fois (un seul échec, une seule émotion).
  let e = etatNeuf(T0), emo: string[] = [];
  for (let i = 0; i < 5; i++) { const r = C.avancer(e, { faits: [{ k: 'echec', id: 'z1', texte: `Erreur ${i}`, x: 10, y: 10 }], ctx: { ...CTX, heure: 10 } }, T0 + i * 300); e = r.etat; emo.push(...r.sorties.filter((s) => s.type === 'emotion').map((s) => s.id)); }
  assert.equal(e.faits.filter((f: Fait) => f.k === 'echec').length, 1); assert.deepEqual(emo, ['deception']); assert.ok(!emo.includes('colere'));
  // Des échecs distincts (sans zone) se comptent toujours un par un.
  e = etatNeuf(T0); for (let i = 0; i < 4; i++) e = C.avancer(e, { faits: [{ k: 'echec' }], ctx: { ...CTX, heure: 10 } }, T0 + i * 300).etat;
  assert.equal(e.faits.filter((f: Fait) => f.k === 'echec').length, 4);
  // Une alerte, une réussite, un merci, puis 3 minutes de nouveautés (une toutes les 2 secondes) : sa mémoire garde ce qui pèse.
  e = C.avancer(etatNeuf(T0), { faits: [{ k: 'alerte', p: .45 }, { k: 'reussite' }, { k: 'merci' }, { k: 'caresse' }], ctx: { ...CTX, heure: 10 } }, T0).etat;
  const temoin = C.besoins(e, { ...CTX, heure: 10 }, T0 + 3 * MIN);
  for (let t = T0 + 2 * S; t <= T0 + 3 * MIN; t += 2 * S) e = C.avancer(e, { faits: [{ k: 'nouveau', id: `n${t}`, texte: 'Analyse en cours' }], ctx: { ...CTX, heure: 10 } }, t).etat;
  const apres = C.besoins(e, { ...CTX, heure: 10 }, T0 + 3 * MIN);
  for (const k of ['inquietude', 'fierte', 'tendresse']) { assert.ok(temoin[k] > .05, `${k} : ${temoin[k]}`); assert.ok(Math.abs(apres[k] - temoin[k]) < 1e-9, `${k} : ${apres[k]} (attendu ${temoin[k]})`); }
  assert.ok(e.faits.filter((f: Fait) => f.k === 'nouveau').length <= C.CONST.faitsLegers); assert.equal(C.CONST.faitsLegers, 30);
  for (const k of ['alerte', 'reussite', 'merci', 'caresse']) assert.equal(e.faits.filter((f: Fait) => f.k === k).length, 1, k);

  // companion.js : il attend que la zone se calme (800 ms), une fiche par zone, et laisse le cœur juger.
  const comp = lire('companion.js');
  assert.match(comp, /z\.t = setTimeout\(\(\) => zoneCalme\(zone, z\), 800\);/);
  assert.match(comp, /zonesLive\.set\(zone, z = \{ t: 0, id: `z\$\{\+\+zoneN\}`, fois: \[\] \}\)/);
  assert.match(comp, /const k = juger\(z, txt, Date\.now\(\)\); if \(!k\) return;\s*\n\s*V\.noter\(\{ k, id: z\.id, /);
  assert.ok(!comp.includes('liveSeen') && !comp.includes('cleTexte'), 'plus de clé faite du texte entier');
});

test('contact et manque : une caresse ou un merci comptent, un survol ou une page un peu', () => {
  const comp = (x: Etat, t: number) => C.besoins(x, { ...CTX, heure: 10 }, t).compagnie;
  const e = etatNeuf(T0, 'curieux'); e.eveilDepuis = T0 - 3 * H;
  assert.ok(comp(e, T0) >= .99, 'trois heures sans contact : en manque');
  for (const k of ['echange', 'appel', 'merci', 'caresse']) { const x = plat(e); x.dernier[`f:${k}`] = T0; assert.equal(comp(x, T0 + MIN), 0, `${k} : un vrai contact`); assert.ok(comp(x, T0 + 89 * MIN) < .7); }
  for (const k of ['survol', 'page']) {
    const x = plat(e); x.dernier[`f:${k}`] = T0;
    assert.ok(comp(x, T0 + MIN) > .15 && comp(x, T0 + MIN) < .3, `${k} : un petit contact (${comp(x, T0 + MIN)})`);
    assert.ok(comp(x, T0 + 45 * MIN) < .7, 'tu travailles avec lui : pas en manque'); assert.ok(comp(x, T0 + 60 * MIN) >= .7, 'une heure sans rien : il lui manque quelqu\'un');
  }
  // Huit heures avec lui sans lui parler, en ouvrant une page toutes les 30 minutes : jamais « en manque ».
  const v = vivre({ etat: etatNeuf(T0, 'calin'), debut: T0, duree: 8 * H, h0: 9, ctx: (t) => ({ present: true, inactifMs: ((t - T0) % (40 * S)) }), faits: (t) => ((t - T0) % (30 * MIN) === 0 ? [{ k: 'page', id: `p${(t - T0) / (30 * MIN)}` }] : []) });
  assert.ok(!v.journal.some((x) => x.s.id === 'en_manque' || x.s.id === 'solitude' || x.s.id === 'se_rapprocher'), 'il ne se dit pas seul quand on travaille avec lui');
});

test('quand il travaille ou qu\'on lui parle : un fond (pensif, à l\'écoute), plus un état tenu qui cachait ses émotions', () => {
  assert.equal(coeurPlus.visageFond('attentif', { occupe: true }), 'reflexion'); assert.equal(coeurPlus.visageFond('attentif', { occupe: false }), 'ecoute'); assert.equal(coeurPlus.visageFond('attentif', null), 'ecoute');
  for (const [id, vis] of Object.entries(plat(C.CONST.FOND_VISAGE) as Record<string, string>)) assert.equal(coeurPlus.visageFond(id, {}), vis);
  assert.equal(coeurPlus.visageFond('inconnu', {}), 'neutre');
  assert.ok(!SOURCE.includes('f.tenir(el, \'ecoute\', \'vie\')'), 'plus d\'écoute tenue par le moteur');
  assert.match(SOURCE, /const id = etat\.fond\.id, vis = C\.visageFond\(id, dernierCtx\);/); assert.match(SOURCE, /f\.fond\(el, vis\);/);
  // À l'appel : l'écoute est tenue 1,5 seconde (pas 8), le visage d'abord, le sursaut ensuite.
  assert.match(SOURCE, /f\.tenir\(el, 'ecoute', 'appel', 1500\); if \(typeof f\.geste === 'function' && !f\.geste\(el, 'sursaut'\)/);
  assert.ok(!SOURCE.includes('\'appel\', 8000'));
  // Avec le vrai visage : appelé pendant qu'il dort, « étonné : tu me réveilles » se voit, puis « las ».
  const F = chargerVisage(); let f = F.pur.agir(F.pur.etatNeuf(), { type: 'fond', id: 'sommeil' }, 0);
  f = F.pur.agir(f, { type: 'tenir', id: 'ecoute', qui: 'appel', ms: 1500 }, 1000);
  f = F.pur.agir(f, { type: 'ressent', id: 'etonnement', ms: 3000, source: 'vie' }, 1060);
  f = F.pur.agir(f, { type: 'fond', id: 'ecoute' }, 1060);
  assert.equal(F.pur.vue(f, 1100).id, 'ecoute'); assert.deepEqual([F.pur.vue(f, 2600).id, F.pur.vue(f, 2600).couleur], ['etonnement', true], 'l\'écoute de l\'appel ne le cache plus');
  f = F.pur.agir(f, { type: 'ressent', id: 'lassitude', source: 'vie' }, 4260); assert.equal(F.pur.vue(f, 4300).id, 'lassitude');
  // L'humeur d'une réponse arrivée pendant qu'on lui parle (fond « à l'écoute ») : visible tout de suite, pour toute sa durée, même légère.
  for (const id of ['clin', 'contentement', 'joie']) {
    let g = F.pur.agir(F.pur.etatNeuf(), { type: 'fond', id: 'ecoute' }, 0); g = F.pur.agir(g, { type: 'base', id }, 1000);
    const fin = 1000 + F.duree(id);
    assert.deepEqual([F.pur.vue(g, 1100).id, F.pur.vue(g, fin - 100).id, F.pur.vue(g, fin - 100).couleur], [id, id, true], id);
    assert.deepEqual([F.pur.vue(g, fin + 4000).id, F.pur.vue(g, fin + 4000).couleur], ['ecoute', false]);
  }
  // Il travaille (fond pensif, rien de tenu) : les éclats des outils passent.
  let w = F.pur.agir(F.pur.etatNeuf(), { type: 'fond', id: 'reflexion' }, 0);
  w = F.pur.agir(w, { type: 'flash', id: 'regarde', ms: 1600 }, 1000); assert.equal(F.pur.vue(w, 1100).id, 'regarde');
  w = F.pur.agir(w, { type: 'flash', id: 'concentration', ms: 1600 }, 3000); assert.equal(F.pur.vue(w, 3100).id, 'concentration'); assert.equal(F.pur.vue(w, 5000).id, 'reflexion');
  // Clics rapides sur lui (mascotte.js) : chaque palier se voit, même juste après le « content » de l'appel.
  let k = F.pur.agir(F.pur.etatNeuf(), { type: 'tenir', id: 'ecoute', qui: 'appel', ms: 1500 }, 0);
  k = F.pur.agir(k, { type: 'ressent', id: 'contentement', source: 'vie' }, 60);
  const vusClics: string[] = [];
  [['curiosite', 400], ['curiosite', 800], ['interet', 1200], ['interet', 1600], ['etonnement', 3200], ['stupeur', 4800]].forEach(([id, t]) => {
    k = F.pur.agir(k, { type: 'lacher', qui: 'appel' }, t as number);
    k = F.pur.agir(k, { type: 'ressent', id, ms: 900, force: true, sansHabitude: true, source: 'clics' }, t as number);
    assert.ok(k.dernier.ms > 0, `${id} accordé`); vusClics.push(F.pur.vue(k, (t as number) + 50).id);
  });
  assert.deepEqual(vusClics, ['curiosite', 'curiosite', 'interet', 'interet', 'etonnement', 'stupeur']);
});

test('autonome dès les premières minutes : de petits gestes qui ont chacun leur raison, et une promenade qui ne ment pas', () => {
  // Quelqu'un est là, rien de neuf, la souris bouge toutes les 25 secondes : pour chaque caractère, il fait quelque chose dans la première minute et demie, et au moins 4 choses en 5 minutes.
  for (const car of Object.keys(plat(C.CONST.CARACTERES))) {
    const v = vivre({ etat: etatNeuf(T0, car), debut: T0, duree: 6 * MIN, h0: 15, ctx: (t) => ({ present: true, inactifMs: (t - T0) % (25 * S) }) });
    const faits = comportements(v.journal).filter((x) => x.t - T0 < 5 * MIN);
    assert.ok(faits.length >= 4, `${car} : ${faits.length} comportements en 5 minutes (${faits.map((x) => x.s.id).join(', ')})`);
    assert.ok(faits[0].t - T0 <= 90 * S, `${car} : premier geste à ${(faits[0].t - T0) / S} s`);
    assert.ok(new Set(faits.map((x) => x.s.id)).size >= 3, `${car} : au moins 3 gestes différents`);
    for (const x of faits) { assert.match(x.s.raison, /^[A-ZÉ].*[.!]$/); assert.ok(x.s.raison.length <= 120); }
    for (let i = 1; i < v.choix.length; i++) assert.ok(v.choix[i] !== v.choix[i - 1] || v.choix[i] === 'repos', `${car} : deux fois de suite ${v.choix[i]}`);
    // Dans les 6 premières minutes (2 pour un caractère joueur) : il a changé de place au moins une fois, et dit depuis quand il n'avait pas bougé.
    const balade = comportements(v.journal).find((x) => x.s.id === 'promenade');
    assert.ok(balade, `${car} : une promenade en 6 minutes (${comportements(v.journal).map((x) => x.s.id).join(', ')})`);
    if (car === 'enjoue') assert.ok(balade.t - T0 <= 2 * MIN, `joueur : il bouge avant 2 minutes (${(balade.t - T0) / S} s)`);
    assert.match(balade.s.raison, /^Je me dégourdis : je n'ai pas bougé depuis (\d+ min|moins d'une minute)\.$/);
  }
  // Les trois petits gestes existent, chacun avec sa raison.
  const ids = plat(C.CONST.COMPORTEMENTS) as string[];
  for (const id of ['regarder_personne', 'suivre_regard', 'regarder_autour']) assert.ok(ids.includes(id), id);
  // Tu reviens après un silence : il te regarde.
  let v = vivre({ etat: etatNeuf(T0), debut: T0, duree: 3 * MIN, h0: 15, ctx: (t) => ({ present: true, inactifMs: t - T0 < 50 * S ? t - T0 : (t - T0 - 50 * S) % (3 * S) }) });
  const regard = comportements(v.journal).find((x) => x.s.id === 'regarder_personne');
  assert.ok(regard && regard.t - T0 >= 50 * S && regard.t - T0 <= 70 * S, 'il te regarde quand tu reviens');
  assert.match(regard.s.raison, /^Je te regarde : tu bouges de nouveau après (moins d'une minute|\d+ min) sans un geste\.$/);
  // Tu écris : aucun de ces petits gestes (il ne te distrait pas), et jamais de déplacement.
  v = vivre({ etat: etatNeuf(T0), debut: T0, duree: 5 * MIN, h0: 15, ctx: (t) => ({ present: true, ecrit: true, inactifMs: (t - T0) % (4 * S) }) });
  assert.ok(!comportements(v.journal).some((x) => ['regarder_personne', 'suivre_regard', 'regarder_autour', 'promenade'].includes(x.s.id)));
  // Une page ouverte au chargement : il la découvre (encore valable quand le salut est passé).
  v = vivre({ etat: etatNeuf(T0), debut: T0, duree: 30 * S, h0: 15, ctx: () => ({ present: true, inactifMs: 2 * S }), faits: (t) => (t === T0 ? [{ k: 'page', id: 'today', texte: 'Aujourd\'hui' }] : []) });
  assert.ok(comportements(v.journal).some((x) => x.s.id === 'observer_page'), comportements(v.journal).map((x) => x.s.id).join(', '));

  // La promenade décidée mais impossible (aucun chemin libre) : il n'a pas bougé, il ne le dit pas, et n'insiste pas.
  let e = etatNeuf(T0); e.dernier.bouge = T0 - 10 * MIN; e.histo = ['repos']; e.prochain = T0; e.jourSalue = e.jour;
  let r = C.avancer(e, { faits: [], ctx: { ...CTX, heure: 15, inactifMs: 12 * S } }, T0 + 6 * MIN);
  const choisi = r.sorties.find((s) => s.type === 'comportement' && s.id !== 'repos');
  assert.equal(choisi?.id, 'promenade', JSON.stringify(plat(r.sorties))); assert.equal(r.etat.dernier.bouge, T0 + 6 * MIN); assert.equal(r.etat.marche.length, 1);
  const rate = coeurPlus.marcheRatee(r.etat, T0 + 6 * MIN + 50, 'promenade');
  assert.equal(rate.comportement, null); assert.equal(rate.marche.length, 0); assert.equal(rate.dernier.bouge, T0 - 10 * MIN, 'il n\'a pas bougé');
  assert.doesNotMatch(C.pourquoi(rate, { ...CTX, heure: 15 }, T0 + 6 * MIN + 100).phrase, /dégourdis/);
  const suite = vivre({ etat: rate, debut: T0 + 6 * MIN + 2 * S, duree: 118 * S, h0: 15, ctx: () => ({ present: true, inactifMs: 12 * S }) });
  assert.ok(!comportements(suite.journal).some((x) => (x.s.plan ?? []).some((p) => p[0] === 'aller')), 'pas de nouvelle tentative pendant 2 minutes');
  assert.ok(comportements(suite.journal).length >= 1, 'il fait autre chose');
  // Un autre comportement que celui en cours : seul le délai est posé.
  assert.deepEqual(plat(coeurPlus.marcheRatee(r.etat, T0 + 6 * MIN + 50, 'ronde').comportement), plat(r.etat.comportement));
  assert.match(SOURCE, /comp\.jouer\(s\.plan, \(fin, info\) => \{ if \(info && info\.refus && !info\.bouge && etat\)/);

  // Il ne sautille que pour une vraie joie (venue du moteur ou d'une réponse), pas pour un éclat (une case cochée).
  const joie = (source: string) => ({ ...CTX, heure: 15, emotion: { id: 'joie', famille: 'joie', degre: 2, valence: 1, jusque: T0 + MIN, source } });
  e = etatNeuf(T0); e.histo = ['repos']; e.prochain = T0; e.jourSalue = e.jour;
  assert.ok(!C.avancer(e, { faits: [], ctx: joie('flash') }, T0 + 5 * S).sorties.some((s) => s.id === 'sautiller'));
  assert.ok(C.avancer(e, { faits: [], ctx: joie('base') }, T0 + 5 * S).sorties.some((s) => s.id === 'sautiller'));
  assert.ok(C.avancer(e, { faits: [], ctx: joie('vie') }, T0 + 5 * S).sorties.some((s) => s.id === 'sautiller'));
});

test('companion.js, mascotte.js, ui.html, notices.js : les corrections de la relecture restent en place', () => {
  const comp = lire('companion.js'), masc = lire('mascotte.js'), ui = lire('ui.html'), notices = lire('notices.js');
  // --- companion.js ---
  // Changement de page : il attend que la page soit posée, et ressort en fondu (plus de go(null) dans l'instant).
  assert.match(comp, /if \(v !== view\) \{\s*\n\s*view = v; pinnedUntil = 0; arreter\(\);\s*\n[^\n]*\n\s*attendrePage\(\);/);
  assert.match(comp, /if \(now - Math\.max\(mutAt, debut\) < 300 && now - debut < 1500\) \{ pageT = setTimeout\(essai, 100\); return; \}/);
  assert.match(comp, /if \(pageT\) return;\s*\n\s*if \(!pos\) \{ attendrePage\(\); return; \}/);
  // Il disparaît d'un coup (rien ne s'affiche sous lui pendant qu'il s'efface) et ressort en fondu ; du contenu apparu sous lui : il n'en sort pas à pied.
  assert.match(comp, /bud\.classList\.add\('v-vite', 'slip'\);/); assert.ok(comp.includes('.odin.roam.v-vite{transition:none!important}'));
  assert.match(comp, /bud\.classList\.remove\('v-vite'\); void bud\.offsetWidth;[^\n]*\n\s*bud\.classList\.remove\('slip'\);/);
  assert.match(comp, /const ici = under\(pos\.x, pos\.y, size\);\s*\n\s*if \(ici\.t \|\| ici\.c \|\| ici\.z\) \{ if \(wander\) return false; slip\(p, then\); return true; \}/);
  // En marche : il regarde devant lui, et finit en fondu si du contenu est apparu.
  assert.match(comp, /if \(pris \|\| gene\(under\(devant\.x, devant\.y, size\)\)\) \{ const p = pris \? choose\(null\) : \{ x: e\.x, y: e\.y, s \}; if \(p\) \{ slip\(p, then\); return; \} \}/);
  // Sur une commande faute de mieux : il recherche dès que la page a changé.
  assert.match(comp, /if \(urgent && mutAt > chercheLe\) retryAt = Math\.min\(retryAt, chercheLe \+ 1500\);/);
  // Une promenade essaie d'autres places (4 au plus) quand le chemin est pris, et dit au demandeur s'il a bougé.
  assert.match(comp, /for \(let k = 0; k < 4 && !refus && !parti; k\+\+\) \{\s*\n\s*const p = placePour\(a, b, vues\);/);
  assert.match(comp, /if \(!parti\) vues\.push\(\{ x: p\.x, y: p\.y \}\);/);
  assert.match(comp, /if \(want\?\.sauf\?\.length && want\.sauf\.some\(\(q\) => Math\.hypot\(x - q\.x, y - q\.y\) < 160\)\) continue;/);
  assert.match(comp, /P\.fin\?\.\(true, P\.info\)/); assert.match(comp, /P\.fin\?\.\(false, P\.info\)/); assert.match(comp, /if \(!deja\) P\.info\.refus = true;/);
  // Sur téléphone : toute sa place répond au doigt (un disque transparent hors du corps).
  assert.match(comp, /c\.setAttribute\('class', 'touche'\); c\.setAttribute\('cx', '60'\); c\.setAttribute\('cy', '60'\); c\.setAttribute\('r', '60'\); c\.setAttribute\('fill', 'transparent'\);/);
  assert.ok(comp.includes('#buddyRoam .touche{pointer-events:all;cursor:pointer}'));
  // Mouvement réduit : seul le fondu reste, ses yeux ne sautent pas pour suivre la souris.
  assert.ok(comp.includes('@media (prefers-reduced-motion:reduce){.odin.roam.path{transition:opacity .25s!important}}'));
  assert.match(comp, /if \(d < 240 && !reduce\.matches\) lookAt\(e\.clientX, e\.clientY\);/);
  // La mesure de la page ne regarde chaque élément qu'une fois ; sa pastille est prévenue quand il bouge.
  assert.match(comp, /scanMemo = new Map\(\)/); assert.match(comp, /if \(!m\.txt\) m\.txt = textRects\(top\);/);
  assert.match(comp, /function put\(x, y\) \{[^\n]*suivi\(\); \}/); assert.match(comp, /function setSize\(s\) \{[^\n]*suivi\(\); \}/);
  // --- mascotte.js ---
  // Règle du propriétaire : les yeux restent blancs, même un jour de fête (la classe des yeux sombres n'est plus jamais posée).
  assert.match(masc, /o\.classList\.remove\('ev-dark-eyes'\);/); assert.ok(!masc.includes("toggle('ev-dark-eyes'"));
  assert.ok(!masc.includes('ev-dark-eyes .eye'), 'plus aucune règle d\'yeux sombres'); assert.ok(!masc.includes('const sombre'));
  // Carnaval : le loup qui couvrait les yeux n'est plus dessiné.
  assert.match(masc, /masque: '',/);
  // --- ui.html ---
  // Plus aucun tirage au sort autour de la mascotte.
  const lignes = ui.split('\n');
  lignes.forEach((l, i) => { if (/Math\.random/.test(l)) assert.ok(!/OdinFace|moodFlash|moodBase|\bact\(|goTo\(|goHome\(/.test(lignes.slice(Math.max(0, i - 1), i + 2).join('\n')), `hasard près de la mascotte, ligne ${i + 1} : ${l.trim().slice(0, 90)}`); });
  assert.ok(!/moodFlash\(\[[^\]]*\]\[Math\.floor\(Math\.random/.test(ui)); assert.ok(!/OdinFace\?\.flash\([a-z]+, \[[^\]]*\]\[Math\.floor\(Math\.random/.test(ui));
  // Odin en liberté répond lui-même à l'appel ; les autres réagissent à tour de rôle ; avec le moteur de vie, la fatigue et les gestes de la Discussion viennent de lui.
  assert.ok(ui.includes('if (f.classList.contains(\'roam\') && window.OdinVie?.actif) return;'));
  assert.ok(ui.includes('window.OdinFace?.flash(f, [\'joie\', \'clin\', \'surprise\'][Math.min(f._taps.length, 3) - 1], 2200);'));
  assert.ok(ui.includes('if (baseMood !== \'fatigue\' && !window.OdinVie?.actif) moodBase(\'fatigue\');'));
  assert.ok(ui.includes('if (A.roam && !window.OdinVie?.actif && idle > 20_000 && thread && '));
  assert.ok(ui.includes('moodFlash(b.dataset.view === \'settings\' ? \'concentration\' : \'regarde\', 1300)'), 'plus de « joie » à chaque clic de navigation');
  // Le nom affiché d'une humeur vient de la palette (les 44 nouvelles n'affichent plus leur identifiant).
  assert.ok(ui.includes('t.textContent = window.OdinFace?.MOODS?.[m]?.nom || MOOD_LABEL[m] || m;'));
  // L'humeur d'une réponse arrivée pendant une tenue est montrée à la fin.
  assert.ok(ui.includes('if (!held) moodHold._avant = baseMood; held++;'));
  assert.ok(ui.includes('const neuf = baseMood !== moodHold._avant; buddies().forEach((b) => { window.OdinFace?.set(b, baseMood); if (neuf) window.OdinFace?.base(b, baseMood); });'));
  // (Avec le vrai visage et le moteur de vie : « set » seul ne montrait rien ; « set » puis « base » montre l'humeur en couleur.)
  const F = chargerVisage(); let f = F.pur.agir(F.pur.etatNeuf(), { type: 'fond', id: 'neutre' }, 0);
  f = F.pur.agir(f, { type: 'pose', id: 'ecoute' }, 1000);
  const seul = F.pur.agir(f, { type: 'pose', id: 'triste' }, 9000); assert.equal(F.pur.vue(seul, 9100).id, 'neutre', 'l\'ancien appel perdait l\'humeur');
  f = F.pur.agir(F.pur.agir(f, { type: 'pose', id: 'triste' }, 9000), { type: 'base', id: 'triste' }, 9000);
  assert.deepEqual([F.pur.vue(f, 9100).id, F.pur.vue(f, 9100).couleur, F.pur.vue(f, 9000 + 29_000).id], ['triste', true, 'triste']);
  // Discussion : la place de repos de sa copie se lit sur le déplacement en cours, pas sur sa cible.
  assert.ok(ui.includes('t = getComputedStyle(bud).translate.split(\' \').map(parseFloat);'));
  assert.ok(!ui.includes('const rx = parseFloat(bud.style.getPropertyValue(\'--rx\')) || 0'));
  // --- vie.js : dans la Discussion, un geste de sa décision va à sa copie.
  assert.match(SOURCE, /if \(!comp \|\| !bud \|\| bud\.hidden\) \{ gesteDiscussion\(s\); return; \}/);
  for (const classe of new Set(Object.values(JSON.parse((/const GESTES_DISCUSSION = (\{[^}]*\})/.exec(SOURCE)?.[1] ?? '{}').replace(/(\w+):/g, '"$1":').replace(/'/g, '"')) as Record<string, string>))) assert.ok(ui.includes(`.chat-buddy.${classe} `), `${classe} existe pour la copie de la Discussion`);
  // --- notices.js ---
  // La pastille ne se replace plus à chaque image quand Odin est immobile ; la petite fenêtre se met à côté de lui quand il n'y a de place ni au-dessus ni au-dessous.
  assert.ok(notices.includes('if (calme < 3) raf = requestAnimationFrame(placeBubble);'));
  assert.ok(notices.includes('function follow() { calme = 0; if (!raf) raf = requestAnimationFrame(placeBubble); }'));
  assert.match(notices, /window\.OdinNotices = \{ boot, suivre: follow, /);
  assert.ok(notices.includes('if (a) { const g = a.r.left - w - 12, d = a.r.right + 12; if (g >= m) x = g; else if (d + w <= innerWidth - m) x = d; }'));
});
