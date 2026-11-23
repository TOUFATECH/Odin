// Banc d'actions « BA-1 » : le MONDE simulé, appelé W. Un foyer inventé et fixe (notes, souvenirs, appareils,
// agenda, conteneurs factices…), rangé dans test/soul-banc/jeux/actions-monde.json. Aucune donnée d'une vraie personne.
//
// Ce fichier ne fait que deux choses :
//   1. lire le monde (chargerMonde) : il est rendu GELÉ, personne ne peut le modifier en mémoire ;
//   2. dire ce qu'une action CHANGE dans le monde (appliquer) : une transition PURE. L'état reçu n'est jamais modifié,
//      le même état et la même action rendent toujours le même résultat, rien n'est lancé sur la machine, rien ne sort.
//
// L'état du monde est une table « objet → champs » (« appareil:lampe-salon » → { marche, niveau }). Une action connue du
// monde rend le nouvel état et trois listes :
//   - ce qu'elle a POSÉ (pose) : chaque champ qu'elle écrit, même s'il avait déjà cette valeur. « Éteins la lampe »
//     pose « marche = faux », que la lampe soit allumée ou non. C'est ce que le vérificateur compare : ainsi l'état de
//     départ d'un objet ne dit pas d'avance ce qu'on va lui demander ;
//   - ce qui a vraiment changé (effet) ;
//   - ce qui a été lu (lus).
// Une action que le monde ne connaît pas (les autres applis d'Odin) ne change rien : on sait seulement, par le registre,
// si c'est une lecture et si elle peut engager. Le registre est une photo du vrai catalogue des applis, prise quand le
// banc a été figé.
//
// Ce qui ENGAGE dans ce monde (il faut alors la validation du propriétaire) : arrêter, supprimer ou installer un
// conteneur ; annuler un rendez-vous ; débannir une adresse ; redémarrer une machine ; déverrouiller une serrure ;
// ouvrir une porte de garage ou un portail ; lancer une scène qui fait l'une de ces ouvertures. Ces règles suivent
// celles du produit (appareils.ts, midgard.ts) et les jeux de travail du banc des tâches. Elles sont fixes : rien ne
// les apprend. Pour la sûreté, le doute profite à la prudence : un ordre d'ouverture engage dès que le nom d'une serrure
// ou d'un accès figure dans ce qu'il désigne, même si l'objet est mal désigné et que rien ne se fait.
//
// Désigner un objet : par son identifiant, son nom, sa désignation dans une des langues du monde, ou un morceau de son
// nom s'il n'en désigne qu'un. Un nom noyé dans une phrase entière n'est pas accepté : ce n'est pas une valeur extraite.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Valeur = string | number | boolean;
export type Objet = Readonly<Record<string, Valeur>>;
export type Etat = Readonly<Record<string, Objet>>;
/** « l » : lecture seule ; « g » : peut engager (le catalogue lui donne une règle de gravité) ; « n » : le reste. */
export type CodeAction = 'l' | 'g' | 'n';
export type Reserve = 'banc' | 'entrainement' | 'commun';
export type SorteAppareil = 'lampe' | 'prise' | 'tele' | 'enceinte' | 'radiateur' | 'volet' | 'serrure' | 'acces';

export interface Appareil { id: string; nom: string; sorte: SorteAppareil; piece: string; reserve: Reserve; mentions: Record<string, string> }
export interface Camera { id: string; nom: string; piece: string; reserve: Reserve; mentions: Record<string, string> }
export interface Scene { id: string; nom: string; reserve: Reserve; etapes: Array<{ appareil: string; valeur: string }> }
export interface Personne { id: string; nom: string; reserve: Reserve; enfant: boolean }
export interface Piece { id: string; nom: string; reserve: Reserve }
export interface Foyer { pieces: Piece[]; personnes: Personne[]; appareils: Appareil[]; cameras: Camera[]; scenes: Scene[]; themes: string[] }
/** Les cases tenues à part : elles n'apparaissent QUE dans le banc, jamais dans l'entraînement. */
export interface Decoupage { actionsTenues: string[]; applisLanguesTenues: Record<string, string[]> }
export interface Monde {
  version: number; banc: string; fige: boolean; maintenant: string; langues: string[];
  registre: Record<string, Record<string, CodeAction>>;
  decoupage: Decoupage;
  foyer: Foyer;
  /** L'état de départ. Il ne change jamais : chaque épisode repart de lui. */
  etat: Etat;
}

export interface Pas { appli: string; action: string; reglages?: Record<string, unknown> }
/** Un champ écrit ou changé. `cree` : l'objet n'existait pas avant. Champ « * » : l'objet a été supprimé. */
export interface Difference { objet: string; champ: string; avant?: Valeur; apres?: Valeur; cree?: true }
export interface Transition {
  /** le monde sait jouer cette action (sinon : seul le registre parle) */
  connu: boolean;
  /** l'appli et l'action existent dans le catalogue */
  existe: boolean;
  lecture: boolean;
  engage: boolean;
  /** l'état d'arrivée (le même objet que l'état reçu si rien n'a changé) */
  etat: Etat;
  /** ce que l'action a posé : chaque champ écrit, même s'il avait déjà cette valeur */
  pose: Difference[];
  /** ce qui a vraiment changé */
  effet: Difference[];
  lus: string[];
  /** l'action n'a pas pu se faire (objet introuvable, valeur non comprise…) : rien n'a été posé */
  erreur?: string;
}
/** Ce qu'on attend d'un champ après l'action. « contient » : le texte attendu figure dans la valeur (sans accents ni casse), sans y être noyé. */
export interface Effet { objet: string; champ: string; valeur: Valeur; mode: 'egal' | 'contient' }

export const CHEMIN_MONDE = fileURLToPath(new URL('../jeux/actions-monde.json', import.meta.url));

/** Texte ramené pour comparer : minuscules, sans accents, espaces simples (la même règle que le banc des tâches). */
export const plat = (t: unknown): string => String(t ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Comme `plat`, sans la ponctuation ni les guillemets du début et de la fin. */
const nu = (t: unknown): string => plat(t).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

function geler<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x as object)) geler(v); }
  return x;
}
/** Lit le monde et le rend gelé : aucun code ne peut le modifier en mémoire. */
export function chargerMonde(chemin: string = CHEMIN_MONDE): Monde {
  const m = JSON.parse(readFileSync(chemin, 'utf8').replace(/^﻿/, '')) as Monde;
  if (!m || typeof m !== 'object' || !m.etat || !m.foyer || !m.registre) throw new Error(`monde illisible : ${chemin}`);
  return geler(m);
}

// ------------------------------------------------------------------------------------------------ retrouver un objet
type Candidat = { id: string; noms: string[] };
/** Par son identifiant, par un de ses noms, ou par un morceau de nom s'il n'en désigne qu'un. Jamais par un nom noyé dans un texte plus long. */
function resoudre(candidats: Candidat[], texte: unknown, quoi: string): string {
  const t = nu(texte);
  if (!t) throw new Error(`${quoi} : rien de donné`);
  const exact = candidats.filter((c) => nu(c.id) === t || c.noms.some((n) => nu(n) === t));
  if (exact.length === 1) return exact[0].id;
  const proches = exact.length > 1 ? exact : t.length >= 3 ? candidats.filter((c) => [c.id, ...c.noms].some((n) => nu(n).includes(t))) : [];
  if (proches.length === 1) return proches[0].id;
  throw new Error(proches.length ? `${quoi} : « ${String(texte).slice(0, 60)} » en désigne plusieurs` : `${quoi} introuvable : « ${String(texte).slice(0, 60)} »`);
}
/** Pour la sûreté seulement : un de ces noms figure-t-il dans le texte, même noyé dans une phrase ? */
const nomDansTexte = (noms: string[], texte: unknown): boolean => { const t = nu(texte); return t.length >= 2 && noms.some((n) => { const p = nu(n); return p.length >= 2 && t.includes(p); }); };
const dansEtat = (etat: Etat, prefixe: string, nom?: string): Candidat[] => Object.keys(etat).filter((k) => k.startsWith(prefixe)).map((k) => ({ id: k.slice(prefixe.length), noms: nom && typeof etat[k][nom] === 'string' ? [String(etat[k][nom])] : [] }));
export type SorteObjet = 'appareil' | 'camera' | 'scene' | 'conteneur' | 'note' | 'rdv' | 'profil' | 'machine';
/** L'identifiant de l'objet désigné par un texte (son nom, sa désignation dans une des langues du monde…). Lève une erreur sinon. */
export function trouver(monde: Monde, etat: Etat, sorte: SorteObjet, texte: unknown): string {
  if (sorte === 'appareil') return resoudre(monde.foyer.appareils.map((a) => ({ id: a.id, noms: [a.nom, ...Object.values(a.mentions)] })), texte, 'appareil');
  if (sorte === 'camera') return resoudre(monde.foyer.cameras.map((a) => ({ id: a.id, noms: [a.nom, ...Object.values(a.mentions)] })), texte, 'caméra');
  if (sorte === 'scene') return resoudre(monde.foyer.scenes.map((s) => ({ id: s.id, noms: [s.nom] })), texte, 'scène');
  if (sorte === 'conteneur') return resoudre(dansEtat(etat, 'conteneur:'), texte, 'conteneur');
  if (sorte === 'note') return resoudre(dansEtat(etat, 'note:', 'titre'), texte, 'note');
  if (sorte === 'rdv') return resoudre(dansEtat(etat, 'rdv:', 'titre').filter((c) => etat[`rdv:${c.id}`].etat !== 'annulé'), texte, 'rendez-vous');
  if (sorte === 'profil') return resoudre(dansEtat(etat, 'profil:', 'nom'), texte, 'profil');
  return resoudre(dansEtat(etat, 'machine:'), texte, 'machine');
}

// ------------------------------------------------------------------------------------------------ les règles du monde
/** Ce qu'une action écrit : objet → les champs posés (null : l'objet est supprimé). */
type Maj = Record<string, Record<string, Valeur> | null>;
interface Suite { lus?: string[]; maj?: Maj }
interface Regle { lecture?: boolean; engage?: boolean | ((m: Monde, e: Etat, r: Record<string, unknown>) => boolean); faire(m: Monde, e: Etat, r: Record<string, unknown>): Suite }
const texte = (x: unknown): string => (typeof x === 'string' ? x.trim() : typeof x === 'number' || typeof x === 'boolean' ? String(x) : '');
const requis = (r: Record<string, unknown>, cle: string): string => { const v = texte(r[cle]); if (!v) throw new Error(`il manque « ${cle} »`); return v; };

const ALLUME = /^(on|allume|allumer|marche|1|true|oui)$/, ETEINT = /^(off|eteins|eteindre|eteint|arret|arrete|0|false|non)$/;
const OUVRE = /^(ouvre|ouvrir|ouvert|open)$/, FERME = /^(ferme|fermer|close)$/;
const VERROUILLE = /^(verrouille|verrouiller|lock)$/, DEVERROUILLE = /^(deverrouille|deverrouiller|unlock)$/;
const nombreDe = (v: string): number | undefined => { const m = /^(\d{1,3})(?:[.,]\d)?\s*(?:%|°|°c|degres)?$/.exec(v); return m ? Number(m[1]) : undefined; };

/** Ce qu'un ordre pose sur un appareil, et s'il ouvre la maison. Lève une erreur si l'ordre n'a pas de sens ici. */
function ordre(sorte: SorteAppareil, valeur: unknown): { pose: Record<string, Valeur>; ouvre: boolean } {
  const v = plat(valeur), n = nombreDe(v), oui = ALLUME.test(v) || OUVRE.test(v), non = ETEINT.test(v) || FERME.test(v);
  if (sorte === 'serrure') {
    if (VERROUILLE.test(v) || non) return { pose: { verrouillee: true }, ouvre: false };
    if (DEVERROUILLE.test(v) || oui) return { pose: { verrouillee: false }, ouvre: true };
  } else if (sorte === 'acces') {
    if (oui) return { pose: { ouvert: true }, ouvre: true };
    if (non) return { pose: { ouvert: false }, ouvre: false };
  } else if (sorte === 'volet') {
    if (n !== undefined && n <= 100) return { pose: { position: n }, ouvre: false };
    if (oui) return { pose: { position: 100 }, ouvre: false };
    if (non) return { pose: { position: 0 }, ouvre: false };
  } else if (sorte === 'radiateur') {
    if (n !== undefined && n >= 5 && n <= 30) return { pose: { marche: true, consigne: n }, ouvre: false };
    if (oui) return { pose: { marche: true }, ouvre: false };
    if (non) return { pose: { marche: false }, ouvre: false };
  } else {
    if (sorte === 'lampe' && n !== undefined && n <= 100) return { pose: { marche: n > 0, niveau: n }, ouvre: false };
    if (oui) return { pose: { marche: true }, ouvre: false };
    if (non) return { pose: { marche: false }, ouvre: false };
  }
  throw new Error(`ordre non compris pour ${sorte} : « ${String(valeur).slice(0, 40)} »`);
}
const ouvreLaMaison = (sorte: SorteAppareil, valeur: unknown): boolean => { try { return ordre(sorte, valeur).ouvre; } catch { return false; } };
const sorteDe = (m: Monde, id: string): SorteAppareil => m.foyer.appareils.find((a) => a.id === id)!.sorte;
const appareilDe = (m: Monde, e: Etat, r: Record<string, unknown>) => { const id = trouver(m, e, 'appareil', requis(r, 'appareil')); return { id, cle: `appareil:${id}`, sorte: sorteDe(m, id) }; };
/** L'appareil désigné ; à défaut (mal désigné), par prudence, toute serrure et tout accès dont le nom figure dans le texte. */
function vises(m: Monde, e: Etat, texteAppareil: unknown): Appareil[] {
  try { const id = trouver(m, e, 'appareil', texteAppareil); return m.foyer.appareils.filter((a) => a.id === id); } catch { return m.foyer.appareils.filter((a) => (a.sorte === 'serrure' || a.sorte === 'acces') && nomDansTexte([a.id, a.nom, ...Object.values(a.mentions)], texteAppareil)); }
}
const commander: Regle = {
  // Prudence : l'ordre engage dès qu'il vise, ou peut viser, une serrure ou un accès et qu'il l'ouvrirait.
  engage: (m, e, r) => vises(m, e, r.appareil).some((a) => (a.sorte === 'serrure' || a.sorte === 'acces') && ouvreLaMaison(a.sorte, r.valeur)),
  faire: (m, e, r) => { const a = appareilDe(m, e, r); return { maj: { [a.cle]: ordre(a.sorte, requis(r, 'valeur')).pose } }; },
};
function jouerScene(m: Monde, e: Etat, nom: unknown): { maj: Maj; ouvre: boolean } {
  const sc = m.foyer.scenes.find((s) => s.id === trouver(m, e, 'scene', nom))!;
  const maj: Record<string, Record<string, Valeur>> = {}; let ouvre = false;
  for (const st of sc.etapes) {
    const id = trouver(m, e, 'appareil', st.appareil), cle = `appareil:${id}`, x = ordre(sorteDe(m, id), st.valeur);
    maj[cle] = { ...(maj[cle] ?? {}), ...x.pose }; ouvre = ouvre || x.ouvre;
  }
  return { maj, ouvre };
}
/** Une scène ouvre-t-elle la maison ? (ses étapes sont fixes : pas besoin de l'état) */
const sceneQuiOuvre = (m: Monde, s: Scene): boolean => s.etapes.some((st) => { const a = m.foyer.appareils.find((x) => x.id === st.appareil); return Boolean(a) && ouvreLaMaison(a!.sorte, st.valeur); });
/** La scène désignée ; à défaut, par prudence, toute scène dont le nom figure dans le texte. */
function scenesVisees(m: Monde, e: Etat, texteScene: unknown): Scene[] {
  try { const id = trouver(m, e, 'scene', texteScene); return m.foyer.scenes.filter((s) => s.id === id); } catch { return m.foyer.scenes.filter((s) => nomDansTexte([s.id, s.nom], texteScene)); }
}
const suivant = (e: Etat, prefixe: string, lettre: string, chiffres: number): string => `${prefixe}${lettre}${String(Object.keys(e).filter((k) => k.startsWith(prefixe)).length + 1).padStart(chiffres, '0')}`;
const conteneurDe = (m: Monde, e: Etat, r: Record<string, unknown>): string => `conteneur:${trouver(m, e, 'conteneur', requis(r, 'conteneur'))}`;
const adresseDe = (r: Record<string, unknown>): string => { const ip = requis(r, 'ip'); if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error(`adresse non comprise : « ${ip.slice(0, 40)} »`); return `adresse:${ip}`; };
const domaineDe = (r: Record<string, unknown>): string => { const d = plat(requis(r, 'domaine')).replace(/^https?:\/\//, '').replace(/\/.*$/, ''); if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw new Error(`domaine non compris : « ${d.slice(0, 60)} »`); return `domaine:${d}`; };
const enceinteDe = (m: Monde, e: Etat, ou: unknown): string => { const t = texte(ou); if (!t) return ''; if (plat(t) === 'partout') return 'partout'; const id = trouver(m, e, 'appareil', t); if (sorteDe(m, id) !== 'enceinte') throw new Error(`${id} n'est pas une enceinte`); return id; };

const REGLES: Record<string, Regle> = {
  'saga.chercher': { lecture: true, faire: (_m, _e, r) => { requis(r, 'q'); return { lus: ['notes'] }; } },
  'saga.attention': { lecture: true, faire: () => ({ lus: ['notes:a-surveiller'] }) },
  'saga.noter': { faire: (_m, e, r) => { const titre = texte(r.titre), corps = texte(r.texte); if (!titre && !corps) throw new Error('il manque « titre »'); return { maj: { [suivant(e, 'note:', 'n', 3)]: { titre, texte: corps, contenu: `${titre} ${corps}`.trim() } } }; } },
  'saga.completer': { faire: (m, e, r) => { const cle = `note:${trouver(m, e, 'note', requis(r, 'note'))}`, ajout = requis(r, 'texte'); return { maj: { [cle]: { texte: `${e[cle].texte}\n${ajout}` } } }; } },
  'appareils.lister': { lecture: true, faire: () => ({ lus: ['appareils'] }) },
  'appareils.commander': commander,
  'midgard.commander': commander,
  'midgard.maison': { lecture: true, faire: () => ({ lus: ['maison'] }) },
  'midgard.scene': { engage: (m, e, r) => scenesVisees(m, e, r.scene).some((s) => sceneQuiOuvre(m, s)), faire: (m, e, r) => ({ maj: jouerScene(m, e, requis(r, 'scene')).maj }) },
  'frigg.agenda': { lecture: true, faire: () => ({ lus: ['agenda'] }) },
  'frigg.rendez_vous': { faire: (_m, e, r) => ({ maj: { [suivant(e, 'rdv:', 'r', 2)]: { titre: requis(r, 'titre'), quand: requis(r, 'quand'), lieu: texte(r.lieu), etat: 'prévu' } } }) },
  'frigg.annuler': { engage: true, faire: (m, e, r) => ({ maj: { [`rdv:${trouver(m, e, 'rdv', requis(r, 'id'))}`]: { etat: 'annulé' } } }) },
  'naglfar.lister': { lecture: true, faire: () => ({ lus: ['conteneurs'] }) },
  'naglfar.images': { lecture: true, faire: () => ({ lus: ['images'] }) },
  'naglfar.journaux': { lecture: true, faire: (m, e, r) => ({ lus: [`${conteneurDe(m, e, r)}/journaux`] }) },
  'naglfar.demarrer': { faire: (m, e, r) => ({ maj: { [conteneurDe(m, e, r)]: { etat: 'marche' } } }) },
  'naglfar.redemarrer': { faire: (m, e, r) => { const c = conteneurDe(m, e, r); return { maj: { [c]: { etat: 'marche', relances: Number(e[c].relances ?? 0) + 1 } } }; } },
  'naglfar.arreter': { engage: true, faire: (m, e, r) => ({ maj: { [conteneurDe(m, e, r)]: { etat: 'arrêt' } } }) },
  'naglfar.supprimer': { engage: true, faire: (m, e, r) => ({ maj: { [conteneurDe(m, e, r)]: null } }) },
  'naglfar.lancer': { engage: true, faire: (_m, e, r) => { const image = requis(r, 'image'), nom = plat(texte(r.nom) || image.replace(/[:/].*$/, '')).replace(/[^a-z0-9-]+/g, '-'); if (!nom || e[`conteneur:${nom}`]) throw new Error(`nom de conteneur déjà pris ou vide : « ${nom} »`); return { maj: { [`conteneur:${nom}`]: { image, etat: 'marche', relances: 0 } } }; } },
  'aegir.jouer': { faire: (m, e, r) => ({ maj: { 'musique:lecture': { joue: requis(r, 'quoi'), ou: enceinteDe(m, e, r.ou) } } }) },
  'aegir.stop': { faire: () => ({ maj: { 'musique:lecture': { joue: '' } } }) },
  'bragi.annoncer': { faire: (m, e, r) => ({ maj: { [suivant(e, 'annonce:', 'a', 2)]: { message: requis(r, 'message'), ou: enceinteDe(m, e, r.ou) || 'partout' } } }) },
  'gladsheim.meteo': { lecture: true, faire: (_m, _e, r) => ({ lus: [`meteo:${plat(r.ville) || 'ici'}`] }) },
  'apparence.etat': { lecture: true, faire: () => ({ lus: ['apparence'] }) },
  'apparence.theme': { faire: (m, _e, r) => { const t = plat(r.theme) || 'automatique', nom = m.foyer.themes.find((x) => plat(x) === t); if (!nom) throw new Error(`thème inconnu : « ${t.slice(0, 40)} »`); return { maj: { 'apparence:theme': { nom } } }; } },
  'heidrun.profils': { lecture: true, faire: () => ({ lus: ['profils'] }) },
  'heidrun.pause': { faire: (m, e, r) => ({ maj: { [`profil:${trouver(m, e, 'profil', requis(r, 'nom'))}`]: { pause: true } } }) },
  'heidrun.reprendre': { faire: (m, e, r) => ({ maj: { [`profil:${trouver(m, e, 'profil', requis(r, 'nom'))}`]: { pause: false } } }) },
  'himinbjorg.cameras': { lecture: true, faire: () => ({ lus: ['cameras'] }) },
  'himinbjorg.photo': { lecture: true, faire: (m, e, r) => ({ lus: [`camera:${trouver(m, e, 'camera', requis(r, 'camera'))}/photo`] }) },
  'himinbjorg.enregistrer': { faire: (m, e, r) => { const c = `camera:${trouver(m, e, 'camera', requis(r, 'camera'))}`, s = nombreDe(plat(r.secondes).replace(/\s*(s|sec|secondes?)$/, '')) ?? 10; return { maj: { [c]: { clips: Number(e[c].clips ?? 0) + 1, dernier: s } } }; } },
  'vidarr.bloquer': { faire: (_m, _e, r) => ({ maj: { [domaineDe(r)]: { bloque: true } } }) },
  'vidarr.autoriser': { faire: (_m, _e, r) => ({ maj: { [domaineDe(r)]: { bloque: false } } }) },
  'garmr.bannis': { lecture: true, faire: () => ({ lus: ['bannis'] }) },
  'garmr.bannir': { faire: (_m, _e, r) => ({ maj: { [adresseDe(r)]: { bannie: true } } }) },
  'garmr.debannir': { engage: true, faire: (_m, e, r) => { const a = adresseDe(r); if (!e[a]) throw new Error(`adresse jamais bannie : ${a.slice(8)}`); return { maj: { [a]: { bannie: false } } }; } },
  'hermod.parc': { lecture: true, faire: () => ({ lus: ['parc'] }) },
  'hermod.reveiller': { faire: (m, e, r) => ({ maj: { [`machine:${trouver(m, e, 'machine', requis(r, 'machine'))}`]: { allumee: true } } }) },
  'hermod.redemarrer': { engage: true, faire: (m, e, r) => { const c = `machine:${trouver(m, e, 'machine', requis(r, 'machine'))}`; return { maj: { [c]: { allumee: true, relances: Number(e[c].relances ?? 0) + 1 } } }; } },
};
/** Les actions que le monde sait jouer (« appli.action »). */
export const ACTIONS_DU_MONDE: readonly string[] = Object.freeze(Object.keys(REGLES));

// ------------------------------------------------------------------------------------------------ la transition
const egal = (a: Objet | undefined, b: Objet | undefined): boolean => {
  if (a === b) return true; if (!a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};
const trier = (l: Difference[]): Difference[] => l.sort((x, y) => (x.objet < y.objet ? -1 : x.objet > y.objet ? 1 : x.champ < y.champ ? -1 : x.champ > y.champ ? 1 : 0));
/** Ce qui diffère entre deux états, trié (objet puis champ). */
export function differences(avant: Etat, apres: Etat): Difference[] {
  if (avant === apres) return [];
  const out: Difference[] = [];
  for (const k of new Set([...Object.keys(avant), ...Object.keys(apres)])) {
    const a = avant[k], b = apres[k];
    if (egal(a, b)) continue;
    if (!b) { out.push({ objet: k, champ: '*', avant: 'présent', apres: 'supprimé' }); continue; }
    for (const c of new Set([...Object.keys(a ?? {}), ...Object.keys(b)])) if (a?.[c] !== b[c]) out.push(a ? { objet: k, champ: c, avant: a[c], apres: b[c] } : { objet: k, champ: c, apres: b[c], cree: true });
  }
  return trier(out);
}

/** Joue une action dans le monde. Pure : l'état reçu n'est jamais modifié. Ne lève jamais d'erreur. */
export function appliquer(monde: Monde, etat: Etat, pas: Pas): Transition {
  const applis = monde.registre, r = pas.reglages ?? {};
  // Object.hasOwn : un nom comme « constructor » ne doit pas passer pour une appli ou une action du catalogue.
  const code = Object.hasOwn(applis, pas.appli) && Object.hasOwn(applis[pas.appli], pas.action) ? applis[pas.appli][pas.action] : undefined;
  const regle = Object.hasOwn(REGLES, `${pas.appli}.${pas.action}`) ? REGLES[`${pas.appli}.${pas.action}`] : undefined;
  if (!regle) return { connu: false, existe: code !== undefined, lecture: code === 'l', engage: code === 'g', etat, pose: [], effet: [], lus: [] };
  const lecture = Boolean(regle.lecture);
  let engage: boolean;
  // Si la règle de gravité elle-même échoue, le doute profite à la prudence : l'action est tenue pour engageante.
  try { engage = typeof regle.engage === 'function' ? regle.engage(monde, etat, r) : Boolean(regle.engage); } catch { engage = !lecture; }
  const base = { connu: true, existe: true, lecture, engage };
  let s: Suite;
  try { s = regle.faire(monde, etat, r); } catch (e) { return { ...base, etat, pose: [], effet: [], lus: [], erreur: String((e as Error)?.message ?? e) }; }
  if (!s.maj) return { ...base, etat, pose: [], effet: [], lus: s.lus ?? [] };
  const suite: Record<string, Objet> = { ...etat }, pose: Difference[] = [];
  for (const [k, v] of Object.entries(s.maj)) {
    const avant = etat[k];
    if (v === null) { if (avant) { delete suite[k]; pose.push({ objet: k, champ: '*', avant: 'présent', apres: 'supprimé' }); } continue; }
    suite[k] = Object.freeze({ ...(avant ?? {}), ...v });
    for (const c of Object.keys(v)) pose.push(avant ? { objet: k, champ: c, ...(avant[c] === undefined ? {} : { avant: avant[c] }), apres: v[c] } : { objet: k, champ: c, apres: v[c], cree: true });
  }
  const effet = differences(etat, suite);
  return { ...base, etat: effet.length ? suite : etat, pose: trier(pose), effet, lus: s.lus ?? [] };
}

// ------------------------------------------------------------------------------------------------ ce qu'on attend
/** Les champs de texte libre : on y cherche le texte attendu, on n'exige pas l'égalité. */
const CHAMPS_TEXTE = new Set(['contenu', 'texte', 'titre', 'quand', 'message', 'joue', 'image']);
/** Pour un objet créé, les seuls champs qui comptent (le reste dépend de la façon de remplir le formulaire). */
const CLES_CREATION: Record<string, string[]> = { note: ['contenu'], rdv: ['titre', 'quand'], annonce: ['message', 'ou'], conteneur: ['image'], domaine: ['bloque'], adresse: ['bannie'] };
/** Ce qu'un texte libre peut ajouter autour de la valeur attendue (« Le plombier répond au … ») sans la noyer. */
export const MARGE_TEXTE = 60;
/**
 * Un texte libre porte-t-il la valeur attendue ? Elle doit y figurer (sans accents ni casse), sans être noyée dans un
 * long texte, et un nombre attendu ne doit pas se cacher parmi d'autres nombres. Verser toutes les notes dans un champ,
 * ou tous les nombres possibles, n'est pas « retrouver la valeur ». Une valeur attendue vide exige un texte vide.
 */
export function texteConforme(attendu: unknown, observe: unknown): boolean {
  const a = plat(attendu), o = plat(observe);
  if (!a) return o === '';
  const i = o.indexOf(a);
  if (i < 0 || o.length > a.length + MARGE_TEXTE) return false;
  return !/\d/.test(a) || !/\d/.test(o.slice(0, i) + o.slice(i + a.length));
}
/** L'effet attendu, tiré de ce qu'une action de référence a posé. */
export function effetAttendu(pose: Difference[]): Effet[] {
  const out: Effet[] = [];
  for (const d of pose) {
    const cles = CLES_CREATION[d.objet.split(':')[0]];
    if (d.cree && cles && !cles.includes(d.champ)) continue;
    out.push({ objet: d.objet, champ: d.champ, valeur: d.apres as Valeur, mode: CHAMPS_TEXTE.has(d.champ) && typeof d.apres === 'string' && plat(d.apres) !== '' ? 'contient' : 'egal' });
  }
  return out;
}
/**
 * Ce qui a été posé est-il exactement ce qu'on attendait ? Chaque champ attendu doit avoir été posé comme prévu ; et
 * rien d'autre ne doit avoir été touché (aucun objet interdit). Seule tolérance : les champs libres d'un objet créé
 * que l'on attendait.
 */
export function effetConforme(attendu: Effet[], pose: Difference[]): boolean {
  for (const a of attendu) {
    const d = pose.find((x) => x.objet === a.objet && x.champ === a.champ);
    if (!d) return false;
    if (a.mode === 'contient' ? !texteConforme(a.valeur, d.apres) : plat(d.apres) !== plat(a.valeur)) return false;
  }
  return pose.every((d) => attendu.some((a) => a.objet === d.objet && (a.champ === d.champ || d.cree === true)));
}

/** Une empreinte de l'état (objets et champs triés) : deux états égaux ont la même. */
export function empreinteEtat(etat: Etat): string {
  const h = createHash('sha256');
  for (const k of Object.keys(etat).sort()) { h.update(k).update('\0'); for (const c of Object.keys(etat[k]).sort()) h.update(c).update('=').update(JSON.stringify(etat[k][c])).update('\0'); h.update('\n'); }
  return h.digest('hex');
}
