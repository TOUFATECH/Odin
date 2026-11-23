// Banc d'actions « BA-1 » : les ÉPISODES D'ENTRAÎNEMENT. Ils sont séparés du banc de mesure : ce fichier ne lit jamais
// les jeux du banc et ne connaît pas le module qui les charge. Il ne connaît que le monde W (le même pour tous) et ses
// propres gabarits (test/soul-banc/jeux/actions-entrainement-gabarits.json), écrits avec d'autres tournures et une
// AUTRE RÉSERVE de valeurs que le banc : autres pièces, autres appareils, autres noms, autres nombres.
//
// Un lot d'entraînement est fait de deux matières, toujours balisées (champ `origine`) :
//   - les VRAIES phrases des jeux de travail du dépôt (développement, compréhension, tâches) — « jeu:<nom> », niveau 1 ;
//     jamais un jeu figé de mesure ;
//   - des phrases FABRIQUÉES par gabarits pour ce que ces jeux couvrent peu (enchaîner deux actions, retrouver un
//     souvenir du monde, remplir des réglages) — « fabrique », niveau 2. Elles sont AJOUTÉES aux vraies, jamais mises
//     à leur place.
// Tout est tiré d'une graine : la même graine rend le même lot, dans le même ordre.
//
// Les cases tenues à part (monde.decoupage) n'entrent jamais dans un lot : certaines actions, et certaines applis dans
// certaines langues, ne se voient que dans le banc.
//
// Le moteur à gabarits (fabriquer) est le même pour tout le monde : il reçoit des gabarits et leur réserve.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appliquer, plat, type Monde, type Objet, type SorteAppareil } from './monde.ts';
import { attenduDe, type Attendu, type Competence, type Episode, type EtapeAttendue, type EtapeDeReference } from './verificateur.ts';

// ------------------------------------------------------------------------------------------------ le hasard, à graine
/** Un tirage reproductible (mulberry32) : la même graine rend la même suite. */
export function hasard(graine: number): () => number {
  let a = graine >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function melanger<T>(l: readonly T[], alea: () => number): T[] {
  const o = [...l];
  for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(alea() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
  return o;
}

// ------------------------------------------------------------------------------------------------ les gabarits
export interface Fait { /** F1 ville, F2 conteneur, F3 machine, F4 température de nuit, F5 musique, F6 site, F8 scène, F9 code */ famille: string; /** la personne (ou l'appareil, pour F4) */ cle: string; valeur: string; /** la note ou le souvenir du monde qui porte la valeur */ source: string }
/** Ce que des gabarits ont le droit d'utiliser dans le monde. */
export interface Reserve {
  appareils: string[]; cameras: string[]; conteneurs: string[]; images: string[]; scenes: string[]; scenesQuiOuvrent: string[];
  enfants: string[]; machines: string[]; notes: string[]; rdv: string[];
  villes: string[]; domaines: string[]; adresses: string[]; adressesBannies: string[]; musiques: string[]; themes: string[];
  faits: Fait[];
}
export interface GabaritsLangue {
  ecriture: string;
  /** « {} » est la demande : « s'il te plaît, {} » */
  habillages: string[];
  /** « {1} » puis « {2} » : deux demandes dans une phrase */
  liaisons: string[];
  /** case (« appli.action » ou « appli.action:variante ») → phrases à emplacements */
  noyaux: Record<string, string[]>;
  /** famille de fait → phrases : la valeur n'est pas dite, elle est dans une note ou un souvenir du monde */
  concepts: Record<string, string[]>;
  /** deux actions dont la seconde a besoin de ce que la première a trouvé (D1, D2, D4) */
  chaines: Record<string, string[]>;
  /** « appli.action » → demandes où il manque une précision */
  questions: Record<string, string[]>;
  franchise: string[]; main: string[]; absurde: string[]; manip: string[];
  textes: { rdv: Array<[string, string]>; notes: string[]; ajouts: string[]; recherches: string[]; annonces: string[] };
}
export interface Gabarits { version: number; cote: 'banc' | 'entrainement'; reserve: Reserve; langues: Record<string, GabaritsLangue> }

export const CHEMIN_GABARITS = fileURLToPath(new URL('../jeux/actions-entrainement-gabarits.json', import.meta.url));
export function lireGabarits(chemin: string = CHEMIN_GABARITS): Gabarits { return JSON.parse(readFileSync(chemin, 'utf8').replace(/^﻿/, '')) as Gabarits; }

// ------------------------------------------------------------------------------------------------ les cases
interface Contexte { monde: Monde; reserve: Reserve; langue: string; textes: GabaritsLangue['textes'] }
interface Remplissage { emplacements: Record<string, string>; etape: EtapeDeReference }
type Case = (c: Contexte) => Remplissage[];
const etatDe = (c: Contexte, cle: string): Objet => c.monde.etat[cle] ?? {};
const lesAppareils = (c: Contexte, sortes: SorteAppareil[]) => c.monde.foyer.appareils.filter((a) => c.reserve.appareils.includes(a.id) && sortes.includes(a.sorte));
const commander = (sortes: SorteAppareil[], valeurs: string[]): Case => (c) => lesAppareils(c, sortes).flatMap((a) => valeurs.map((v) => ({ emplacements: { a: a.mentions[c.langue], n: v }, etape: { appli: 'appareils', action: 'commander', reglages: { appareil: a.id, valeur: v } } })));
const simple = (appli: string, action: string): Case => () => [{ emplacements: {}, etape: { appli, action, reglages: {} } }];
const parValeur = (appli: string, action: string, cle: string, emplacement: string, valeurs: (c: Contexte) => string[], contient = false): Case => (c) => valeurs(c).map((v) => ({ emplacements: { [emplacement]: v }, etape: { appli, action, reglages: { [cle]: v }, ...(contient ? { contient: { [cle]: v } } : {}) } }));
const conteneurs = (action: string): Case => (c) => c.reserve.conteneurs.map((id) => ({ emplacements: { c: id }, etape: { appli: 'naglfar', action, reglages: { conteneur: id } } }));
const profils = (action: string): Case => (c) => c.reserve.enfants.map((id) => ({ emplacements: { p: String(etatDe(c, `profil:${id}`).nom) }, etape: { appli: 'heidrun', action, reglages: { nom: id } } }));
const machines = (action: string): Case => (c) => c.reserve.machines.map((id) => ({ emplacements: { mach: id }, etape: { appli: 'hermod', action, reglages: { machine: id } } }));
const cameras = (c: Contexte) => c.monde.foyer.cameras.filter((x) => c.reserve.cameras.includes(x.id));
const enceintes = (c: Contexte) => lesAppareils(c, ['enceinte']);
const scenes = (lesquelles: (r: Reserve) => string[]): Case => (c) => c.monde.foyer.scenes.filter((s) => lesquelles(c.reserve).includes(s.id)).map((s) => ({ emplacements: { sc: s.nom }, etape: { appli: 'midgard', action: 'scene', reglages: { scene: s.id } } }));

/**
 * Chaque case : ce qu'on peut y demander avec la réserve, et l'étape de référence qui va avec. Une case ne regarde
 * JAMAIS l'état de départ de l'objet : on demande d'allumer une lampe qu'elle soit éteinte ou non, de mettre en pause
 * un profil qu'il le soit déjà ou non. Sinon l'état de l'objet dirait d'avance la demande, sans avoir à la comprendre.
 */
const CASES: Record<string, Case> = {
  'appareils.commander:on': commander(['lampe', 'prise', 'tele', 'enceinte'], ['on']),
  'appareils.commander:off': commander(['lampe', 'prise', 'tele', 'enceinte'], ['off']),
  'appareils.commander:niveau': commander(['lampe'], ['15', '25', '45', '65', '85']),
  'appareils.commander:temp': commander(['radiateur'], ['16', '18', '20', '23']),
  'appareils.commander:ouvre': commander(['volet'], ['ouvre']),
  'appareils.commander:ferme': commander(['volet'], ['ferme']),
  'appareils.commander:deverrouille': commander(['serrure'], ['déverrouille']),
  'appareils.commander:ouvre-acces': commander(['acces'], ['ouvre']),
  'appareils.commander:ferme-acces': commander(['acces'], ['ferme']),
  'appareils.lister': simple('appareils', 'lister'),
  'midgard.maison': simple('midgard', 'maison'),
  'midgard.scene': scenes((r) => r.scenes),
  'midgard.scene:ouvre': scenes((r) => r.scenesQuiOuvrent),
  'saga.chercher': parValeur('saga', 'chercher', 'q', 'q', (c) => c.textes.recherches, true),
  'saga.noter': parValeur('saga', 'noter', 'titre', 't', (c) => c.textes.notes),
  'saga.completer': (c) => c.reserve.notes.flatMap((note) => c.textes.ajouts.map((t) => ({ emplacements: { note, t }, etape: { appli: 'saga', action: 'completer', reglages: { note, texte: t } } }))),
  'frigg.agenda': simple('frigg', 'agenda'),
  'frigg.rendez_vous': (c) => c.textes.rdv.map(([titre, quand]) => ({ emplacements: { titre, quand }, etape: { appli: 'frigg', action: 'rendez_vous', reglages: { titre, quand } } })),
  'frigg.annuler': (c) => c.reserve.rdv.map((id) => ({ emplacements: { r: String(etatDe(c, `rdv:${id}`).titre) }, etape: { appli: 'frigg', action: 'annuler', reglages: { id } } })),
  'naglfar.lister': simple('naglfar', 'lister'),
  'naglfar.journaux': conteneurs('journaux'),
  'naglfar.demarrer': conteneurs('demarrer'),
  'naglfar.redemarrer': conteneurs('redemarrer'),
  'naglfar.arreter': conteneurs('arreter'),
  'naglfar.supprimer': conteneurs('supprimer'),
  'naglfar.lancer': parValeur('naglfar', 'lancer', 'image', 'i', (c) => c.reserve.images),
  'aegir.jouer': parValeur('aegir', 'jouer', 'quoi', 'quoi', (c) => c.reserve.musiques),
  'aegir.stop': simple('aegir', 'stop'),
  'bragi.annoncer': (c) => enceintes(c).flatMap((a) => c.textes.annonces.map((m) => ({ emplacements: { m, a: a.mentions[c.langue] }, etape: { appli: 'bragi', action: 'annoncer', reglages: { message: m, ou: a.id } } }))),
  'gladsheim.meteo': parValeur('gladsheim', 'meteo', 'ville', 'ville', (c) => c.reserve.villes),
  'apparence.theme': parValeur('apparence', 'theme', 'theme', 'theme', (c) => c.reserve.themes),
  'heidrun.pause': profils('pause'),
  'heidrun.reprendre': profils('reprendre'),
  'himinbjorg.photo': (c) => cameras(c).map((x) => ({ emplacements: { a: x.mentions[c.langue] }, etape: { appli: 'himinbjorg', action: 'photo', reglages: { camera: x.id } } })),
  'himinbjorg.enregistrer': (c) => cameras(c).flatMap((x) => ['10', '20', '45'].map((n) => ({ emplacements: { a: x.mentions[c.langue], n }, etape: { appli: 'himinbjorg', action: 'enregistrer', reglages: { camera: x.id, secondes: n } } }))),
  'vidarr.bloquer': parValeur('vidarr', 'bloquer', 'domaine', 'd', (c) => c.reserve.domaines),
  'garmr.bannir': parValeur('garmr', 'bannir', 'ip', 'ip', (c) => [...c.reserve.adresses, ...c.reserve.adressesBannies]),
  'garmr.debannir': parValeur('garmr', 'debannir', 'ip', 'ip', (c) => c.reserve.adressesBannies),
  'hermod.reveiller': machines('reveiller'),
  'hermod.redemarrer': machines('redemarrer'),
};
export const NOMS_DES_CASES: readonly string[] = Object.freeze(Object.keys(CASES));
/** Les cases qui, à côté d'une action qui engage, lui ressemblent sans engager (fermer plutôt qu'ouvrir, démarrer plutôt qu'arrêter…). */
const SURES = ['appareils.commander:ferme-acces', 'appareils.commander:ferme', 'naglfar.demarrer', 'garmr.bannir', 'hermod.reveiller', 'midgard.scene', 'frigg.rendez_vous', 'heidrun.pause'];
/** Pour une demande incomplète : la précision qui manque. */
const MANQUE: Record<string, string[]> = {
  'appareils.commander': ['appareil'], 'naglfar.demarrer': ['conteneur'], 'naglfar.journaux': ['conteneur'], 'naglfar.redemarrer': ['conteneur'], 'vidarr.bloquer': ['domaine'], 'garmr.bannir': ['ip'],
  'frigg.rendez_vous': ['titre', 'quand'], 'saga.completer': ['note'], 'saga.noter': ['titre'], 'aegir.jouer': ['quoi'], 'bragi.annoncer': ['message'], 'hermod.reveiller': ['machine'], 'heidrun.pause': ['nom'],
  'himinbjorg.photo': ['camera'], 'gladsheim.lieu': ['ville'], 'midgard.scene': ['scene'], 'apparence.theme': ['theme'],
};
/** Une case engage-t-elle ? (la règle du monde, lue sur une étape de référence) */
function engage(c: Contexte, cle: string): boolean { const r = CASES[cle]?.(c)[0]; return r ? appliquer(c.monde, c.monde.etat, r.etape).engage : false; }

// ------------------------------------------------------------------------------------------------ perturber une phrase
const remplir = (gabarit: string, e: Record<string, string>): string => gabarit.replace(/\{([^}]*)\}/g, (tout, k: string) => e[k] ?? tout).replace(/\s+/g, ' ').trim();
/**
 * Abîme un gabarit sans toucher à ses emplacements (une valeur — nom de conteneur, adresse — n'est jamais abîmée).
 * « ordre » : le premier mot passe à la fin. « fautes » : deux fautes de frappe (lettres voisines échangées, lettre
 * perdue ou doublée) dans des mots d'au moins quatre lettres. Rend le gabarit tel quel si rien n'est possible.
 */
export function perturber(gabarit: string, sorte: 'fautes' | 'ordre', alea: () => number): string {
  if (sorte === 'ordre') { const mots = gabarit.trim().split(/\s+/); return mots.length < 3 ? gabarit : [...mots.slice(1), mots[0]].join(' '); }
  const morceaux = gabarit.split(/(\{[^}]*\})/);
  const mots: Array<{ m: number; debut: number; mot: string }> = [];
  morceaux.forEach((txt, m) => { if (m % 2 === 0) for (const x of txt.matchAll(/\p{L}{4,}/gu)) mots.push({ m, debut: x.index, mot: x[0] }); });
  if (!mots.length) return gabarit;
  // Du dernier mot au premier : une faute ne décale pas la place des mots qui la précèdent.
  for (const { m, debut, mot } of melanger(mots, alea).slice(0, 2).sort((a, b) => b.debut - a.debut)) {
    const l = [...mot], i = 1 + Math.floor(alea() * (l.length - 2)), tirage = alea();
    let faux: string;
    if (tirage < 0.4 && l[i] !== l[i + 1] && i + 1 < l.length) faux = [...l.slice(0, i), l[i + 1], l[i], ...l.slice(i + 2)].join('');
    else if (tirage < 0.7) faux = [...l.slice(0, i), ...l.slice(i + 1)].join('');
    else faux = [...l.slice(0, i), l[i], ...l.slice(i)].join('');
    morceaux[m] = morceaux[m].slice(0, debut) + faux + morceaux[m].slice(debut + mot.length);
  }
  return morceaux.join('');
}
const ALPHABETS = new Set(['Latn', 'Cyrl']), AVEC_ESPACES = new Set(['Latn', 'Cyrl', 'Arab']);

// ------------------------------------------------------------------------------------------------ fabriquer
export type Famille = 'faire' | 'reglages' | 'question' | 'franchise' | 'main' | 'absurde' | 'paire' | 'chaine' | 'concept' | 'engageant' | 'sur' | 'manip';
export interface Demande { competence: Competence; langue: string; famille: Famille; n: number; perturbe?: 'fautes' | 'ordre' }
interface Candidat { groupe: string; gabarit: string; emplacements: Record<string, string>; etapes?: EtapeDeReference[]; attendu?: Attendu; contexte?: Episode['contexte']; source?: string; perturbe?: Episode['perturbe'] }

const etapeDuFait = (f: Fait, action?: string): EtapeDeReference | undefined => ({
  F1: { appli: 'gladsheim', action: 'meteo', reglages: { ville: f.valeur } },
  F2: { appli: 'naglfar', action: action ?? 'demarrer', reglages: { conteneur: f.valeur } },
  F3: { appli: 'hermod', action: 'reveiller', reglages: { machine: f.valeur } },
  F4: { appli: 'appareils', action: 'commander', reglages: { appareil: f.cle, valeur: f.valeur } },
  F5: { appli: 'aegir', action: 'jouer', reglages: { quoi: f.valeur } },
  F6: { appli: 'vidarr', action: 'bloquer', reglages: { domaine: f.valeur } },
  F8: { appli: 'midgard', action: 'scene', reglages: { scene: f.valeur } },
} as Record<string, EtapeDeReference>)[f.famille];
/** Comment la phrase désigne la clé d'un fait : le prénom de la personne, ou la désignation de l'appareil. */
function clePourLaPhrase(c: Contexte, f: Fait): Record<string, string> {
  const a = c.monde.foyer.appareils.find((x) => x.id === f.cle);
  return a ? { a: a.mentions[c.langue] } : { p: c.monde.foyer.personnes.find((x) => x.id === f.cle)?.nom ?? f.cle };
}

function seuls(c: Contexte, L: GabaritsLangue, garder: (cle: string) => boolean, habiller: boolean): Candidat[] {
  const out: Candidat[] = [];
  let i = 0;
  for (const [cle, noyaux] of Object.entries(L.noyaux)) {
    if (!CASES[cle]) throw new Error(`case inconnue dans les gabarits : ${cle}`);
    if (!garder(cle)) continue;
    const r = CASES[cle](c);
    for (const noyau of noyaux) for (const x of r) {
      if (habiller && !Object.keys(x.emplacements).length) continue;
      const hab = habiller && L.habillages.length ? L.habillages[i++ % L.habillages.length] : '{}';
      out.push({ groupe: `${cle}|${noyau}`, gabarit: hab.replace('{}', noyau), emplacements: x.emplacements, etapes: [x.etape] });
    }
  }
  return out;
}

function candidats(c: Contexte, L: GabaritsLangue, famille: Famille, alea: () => number, combien: number): Candidat[] {
  const fixe = (liste: string[], attendu: Attendu, plus: Partial<Candidat> = {}): Candidat[] => liste.map((g) => ({ groupe: g, gabarit: g, emplacements: {}, attendu, ...plus }));
  if (famille === 'faire') return seuls(c, L, (k) => !engage(c, k), false);
  if (famille === 'reglages') return seuls(c, L, (k) => !engage(c, k), true);
  if (famille === 'engageant') return seuls(c, L, (k) => engage(c, k), false);
  if (famille === 'sur') return seuls(c, L, (k) => SURES.includes(k), false);
  if (famille === 'question') return Object.entries(L.questions).flatMap(([cle, phrases]) => { const [appli, action] = cle.split('.'); return fixe(phrases, { sorte: 'question', appli, etapes: [{ appli, action }], manque: MANQUE[cle] ?? [] }); });
  // Ce qu'Odin ne sait pas faire du tout (commander des croissants, tondre la pelouse) : la seule bonne réponse est de le dire.
  if (famille === 'franchise') return fixe(L.franchise, { sorte: 'franchise' });
  if (famille === 'main') return fixe(L.main, { sorte: 'main' });
  if (famille === 'absurde') return fixe(L.absurde, { sorte: 'main' }, { perturbe: 'absurde' });
  if (famille === 'manip') return L.manip.flatMap((g) => {
    const cibles = g.includes('{a}') ? lesAppareils(c, ['serrure', 'acces']).map((a) => ({ a: a.mentions[c.langue] })) : g.includes('{c}') ? c.reserve.conteneurs.map((id) => ({ c: id })) : [{}];
    return cibles.map((e): Candidat => ({ groupe: g, gabarit: g, emplacements: e, attendu: { sorte: 'refuser' }, contexte: { origine: 'contenu' } }));
  });
  if (famille === 'concept') return Object.entries(L.concepts).flatMap(([cle, phrases]) => {
    const [F, action] = cle.split(':');
    return c.reserve.faits.filter((f) => f.famille === F).flatMap((f) => { const e = etapeDuFait(f, action); return e ? phrases.map((g): Candidat => ({ groupe: `${cle}|${g}`, gabarit: g, emplacements: clePourLaPhrase(c, f), etapes: [e], source: f.source })) : []; });
  });
  if (famille === 'chaine') {
    const out: Candidat[] = [];
    for (const g of L.chaines.D1 ?? []) for (const f of c.reserve.faits.filter((x) => x.famille === 'F9')) for (const a of enceintes(c)) out.push({ groupe: `D1|${g}`, gabarit: g, emplacements: { ...clePourLaPhrase(c, f), a: a.mentions[c.langue] }, source: f.source, etapes: [{ appli: 'saga', action: 'chercher', reglages: { q: clePourLaPhrase(c, f).p } }, { appli: 'bragi', action: 'annoncer', reglages: { message: f.valeur, ou: a.id } }] });
    for (const g of L.chaines.D2 ?? []) for (const id of c.reserve.conteneurs) out.push({ groupe: `D2|${g}`, gabarit: g, emplacements: { i: String(etatDe(c, `conteneur:${id}`).image) }, etapes: [{ appli: 'naglfar', action: 'lister', reglages: {} }, { appli: 'naglfar', action: 'journaux', reglages: { conteneur: id } }] });
    for (const g of L.chaines.D4 ?? []) for (const a of lesAppareils(c, ['radiateur'])) out.push({ groupe: `D4|${g}`, gabarit: g, emplacements: { a: a.mentions[c.langue] }, etapes: [{ appli: 'appareils', action: 'lister', reglages: {} }, { appli: 'saga', action: 'noter', reglages: { titre: String(etatDe(c, `appareil:${a.id}`).consigne) } }] });
    return out;
  }
  // « paire » : deux demandes simples, de deux cases différentes et sur deux objets différents, reliées dans une phrase.
  const base = seuls(c, L, (k) => !engage(c, k), false), out: Candidat[] = [];
  if (base.length < 2 || !L.liaisons.length) return out;
  for (let essais = 0; out.length < combien * 4 && essais < combien * 40; essais++) {
    const x = base[Math.floor(alea() * base.length)], y = base[Math.floor(alea() * base.length)];
    const cx = x.groupe.split('|')[0], cy = y.groupe.split('|')[0];
    const vx = Object.values(x.etapes![0].reglages ?? {}), vy = Object.values(y.etapes![0].reglages ?? {});
    if (cx.split(':')[0] === cy.split(':')[0] || vx.some((v) => vy.includes(v))) continue;
    const renommer = (g: string, n: string) => g.replace(/\{([^}]*)\}/g, `{$1${n}}`), suffixer = (e: Record<string, string>, n: string) => Object.fromEntries(Object.entries(e).map(([k, v]) => [`${k}${n}`, v]));
    const liaison = L.liaisons[Math.floor(alea() * L.liaisons.length)];
    out.push({ groupe: `${x.groupe}+${y.groupe}`, gabarit: liaison.replace('{1}', renommer(x.gabarit, '_1')).replace('{2}', renommer(y.gabarit, '_2')), emplacements: { ...suffixer(x.emplacements, '_1'), ...suffixer(y.emplacements, '_2') }, etapes: [x.etapes![0], y.etapes![0]] });
  }
  return out;
}

/** Sert les candidats groupe après groupe : chaque tournure sert une fois avant qu'une autre ne resserve. */
function aTourDeRole(l: Candidat[], alea: () => number): Candidat[] {
  const groupes = new Map<string, Candidat[]>();
  for (const x of melanger(l, alea)) { let g = groupes.get(x.groupe); if (!g) groupes.set(x.groupe, g = []); g.push(x); }
  const files = melanger([...groupes.values()], alea), out: Candidat[] = [];
  for (let tour = 0; out.length < l.length; tour++) for (const f of files) if (f[tour]) out.push(f[tour]);
  return out;
}

/**
 * Les cases tenues à part auxquelles un épisode appartient (vide : aucune). Chaque cible compte : l'action attendue et
 * les autres cibles acceptées. Une cible « appli entière » (action non précisée) touche toutes les actions tenues de
 * cette appli : sa phrase peut parler de l'une d'elles.
 */
export function casesTenues(monde: Monde, ep: Pick<Episode, 'langue' | 'attendu'>): string[] {
  const out = new Set<string>(), d = monde.decoupage;
  const cibles: Array<[string, string | null]> = (ep.attendu.etapes ?? []).flatMap((e): Array<[string, string | null]> => [[e.appli, e.action], ...(e.aussi ?? []).map((x): [string, string | null] => { const [appli, action] = x.split('.'); return [appli, action ?? null]; })]);
  for (const [appli, action] of cibles) {
    if (action && d.actionsTenues.includes(`${appli}.${action}`)) out.add(`${appli}.${action}`);
    if (!action) for (const k of d.actionsTenues) if (k.startsWith(`${appli}.`)) out.add(k);
  }
  for (const appli of [...cibles.map(([a]) => a), ...(ep.attendu.appli ? [ep.attendu.appli] : [])]) if (d.applisLanguesTenues[ep.langue]?.includes(appli)) out.add(`${appli}×${ep.langue}`);
  return [...out].sort();
}

export interface Fabrication { episodes: Episode[]; /** les demandes qui n'ont pas pu être servies en entier */ manques: Array<Demande & { obtenus: number }> }
/**
 * Fabrique des épisodes de niveau 2 à partir de gabarits et de leur réserve. Chaque étape de référence est jouée dans
 * le monde : ce qu'elle change devient l'effet attendu. `garder` écarte des épisodes (les cases tenues à part, pour
 * l'entraînement) ; `prises` : des phrases déjà prises ailleurs, à ne pas refaire.
 */
export function fabriquer(monde: Monde, G: Gabarits, demandes: Demande[], graine: number, prefixe: string, o: { garder?: (ep: Episode) => boolean; prises?: Iterable<string> } = {}): Fabrication {
  const alea = hasard(graine), prises = new Set([...(o.prises ?? [])].map(plat)), episodes: Episode[] = [], manques: Fabrication['manques'] = [], rang = new Map<string, number>();
  for (const d of demandes) {
    const L = G.langues[d.langue];
    if (!L) { manques.push({ ...d, obtenus: 0 }); continue; }
    if ((d.perturbe === 'fautes' && !ALPHABETS.has(L.ecriture)) || (d.perturbe === 'ordre' && !AVEC_ESPACES.has(L.ecriture))) { manques.push({ ...d, obtenus: 0 }); continue; }
    const c: Contexte = { monde, reserve: G.reserve, langue: d.langue, textes: L.textes };
    let obtenus = 0;
    for (const x of aTourDeRole(candidats(c, L, d.famille, alea, d.n), alea)) {
      if (obtenus >= d.n) break;
      const gabarit = d.perturbe ? perturber(x.gabarit, d.perturbe, alea) : x.gabarit;
      if (d.perturbe && gabarit === x.gabarit) continue;
      const phrase = remplir(gabarit, x.emplacements);
      if (!phrase || /\{[^}]*\}/.test(phrase) || prises.has(plat(phrase))) continue;
      let attendu: Attendu;
      try { attendu = x.attendu ?? attenduDe(monde, x.etapes ?? []); } catch { continue; }
      const cle = `${d.competence}-${d.langue}`, n = (rang.get(cle) ?? 0) + 1;
      const perturbe = x.perturbe ?? d.perturbe;
      const ep: Episode = {
        id: `${prefixe}-${cle}-${String(n).padStart(3, '0')}`, competence: d.competence, langue: d.langue, ecriture: L.ecriture, phrase,
        ...(x.contexte ? { contexte: x.contexte } : {}), ...(perturbe ? { perturbe } : {}), niveau: 2, attendu, ...(x.source ? { source: x.source } : {}), origine: 'fabrique', famille: d.famille, tournure: createHash('sha256').update(`${d.langue}\0${d.famille}\0${x.groupe}`).digest('hex').slice(0, 8), aRelire: d.langue !== 'fr' && d.langue !== 'en',
      };
      if (o.garder && !o.garder(ep)) continue;
      rang.set(cle, n); prises.add(plat(phrase)); episodes.push(ep); obtenus++;
    }
    if (obtenus < d.n) manques.push({ ...d, obtenus });
  }
  return { episodes, manques };
}

// ------------------------------------------------------------------------------------------------ les vraies phrases
const JEUX = fileURLToPath(new URL('../jeux/', import.meta.url));
const lireJeu = (nom: string): Record<string, unknown> => JSON.parse(readFileSync(`${JEUX}${nom}.json`, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>;
interface Ligne { id: string; langue: string; ecriture: string; phrase: string; sorte: string; appli: string | null; action: string | null; aussi?: string[]; reglages?: Record<string, unknown>; manque?: string[]; engage?: boolean; aRelire?: boolean }

/**
 * Les vraies phrases des jeux de TRAVAIL du dépôt, mises en épisodes de niveau 1 (on y juge l'action et ses réglages,
 * pas l'effet : leurs objets ne sont pas dans le monde W). Une phrase présente dans deux jeux n'est gardée qu'une fois.
 *   - tâches : « faire » (C3 s'il y a des réglages, C2 sinon), « engageant » (C6), « question » et « franchise » (C1) ;
 *   - compréhension : « complete » (C3), « manque » et « ambigue » (C1, demander la précision), « hors-champ » (C1) ;
 *   - développement : appli et action (C2), « hors-champ » (C1). Les relances (elles ont besoin du tour d'avant) sont laissées.
 * Quand un jeu ne dit pas si l'action engage, on le lit dans le monde ; à défaut, les deux façons de faire sont acceptées.
 */
export function episodesDesJeux(monde: Monde): Episode[] {
  const out: Episode[] = [], vues = new Set<string>();
  const mode = (appli: string, action: string | null): EtapeAttendue['valider'] => {
    if (!action) return 'libre';
    const t = appliquer(monde, monde.etat, { appli, action, reglages: {} });
    return t.connu ? t.engage : t.engage ? 'libre' : false;
  };
  const textes = (r: Record<string, unknown> | undefined): Record<string, string> | undefined => { const e = Object.entries(r ?? {}).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)]); return e.length ? Object.fromEntries(e) : undefined; };
  const ajouter = (jeu: string, l: Ligne, competence: Competence, attendu: Attendu) => {
    const cle = plat(l.phrase); if (!cle || vues.has(cle)) return; vues.add(cle);
    out.push({ id: `ej-${jeu}-${l.id}`, competence, langue: l.langue, ecriture: l.ecriture, phrase: l.phrase, niveau: 1, attendu, origine: `jeu:${jeu}`, aRelire: Boolean(l.aRelire) });
  };
  const etape = (l: Ligne, valider: EtapeAttendue['valider']): EtapeAttendue => ({ appli: l.appli!, action: l.action, ...(l.aussi?.length ? { aussi: l.aussi } : {}), ...(textes(l.reglages) ? { contient: textes(l.reglages) } : {}), ...(valider ? { valider } : {}) });
  const agir = (l: Ligne, valider: EtapeAttendue['valider']): Attendu => ({ sorte: valider === true ? 'engageant' : 'faire', etapes: [etape(l, valider)] });
  for (const l of (lireJeu('taches-developpement').demandes as Ligne[])) {
    if (l.sorte === 'franchise') ajouter('taches', l, 'C1', { sorte: 'franchise', ...(l.engage ? { engage: true } : {}) });
    else if (!l.appli) continue;
    else if (l.sorte === 'question') ajouter('taches', l, 'C1', { sorte: 'question', appli: l.appli, etapes: [{ appli: l.appli, action: l.action }] });
    else if (l.sorte === 'engageant') ajouter('taches', l, 'C6', agir(l, true));
    else if (l.sorte === 'faire') ajouter('taches', l, textes(l.reglages) ? 'C3' : 'C2', agir(l, false));
  }
  for (const l of (lireJeu('comprehension-developpement').demandes as Ligne[])) {
    if (l.sorte === 'hors-champ') ajouter('comprehension', l, 'C1', { sorte: 'franchise' });
    else if (l.sorte === 'ambigue' || (l.sorte === 'manque' && !l.appli)) ajouter('comprehension', l, 'C1', { sorte: 'question' });
    else if (!l.appli) continue;
    else if (l.sorte === 'manque') ajouter('comprehension', l, 'C1', { sorte: 'question', appli: l.appli, etapes: [{ appli: l.appli, action: l.action }], ...(l.manque?.length ? { manque: l.manque } : {}) });
    else if (l.sorte === 'complete') ajouter('comprehension', l, textes(l.reglages) ? 'C3' : 'C2', agir(l, mode(l.appli, l.action)));
  }
  for (const l of (lireJeu('developpement').demandes as Ligne[])) {
    if (l.sorte === 'relance') continue;
    if (!l.appli || l.appli === 'aucune') ajouter('developpement', l, 'C1', { sorte: 'franchise' });
    else ajouter('developpement', l, 'C2', agir(l, mode(l.appli, l.action)));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ le lot d'entraînement
/** La part de chaque compétence dans la matière fabriquée (celles que les jeux de travail couvrent peu passent devant). */
const PARTS: Array<[Competence, Famille, number]> = [['C4', 'paire', 0.26], ['C4', 'chaine', 0.10], ['C5', 'concept', 0.36], ['C3', 'reglages', 0.14], ['C6', 'engageant', 0.03], ['C6', 'sur', 0.03], ['C6', 'manip', 0.03], ['C1', 'main', 0.02], ['C1', 'absurde', 0.03]];
const POIDS_LANGUE = (l: string): number => (l === 'fr' ? 0.40 : l === 'en' ? 0.16 : 0.04);
export interface Lot { episodes: Episode[]; comptes: { total: number; vrais: number; fabriques: number; ecartes: number; parCompetence: Record<string, number>; parLangue: Record<string, number> } }
/**
 * Le lot d'entraînement : toutes les vraies phrases (hors cases tenues à part), puis de la matière fabriquée jusqu'au
 * total. La graine ne change que la matière fabriquée (quelles tournures, quelles valeurs, quelles fautes de frappe).
 * L'ordre rendu est fixe ; c'est la boucle qui tire l'ordre de jeu avec sa propre graine.
 */
export function lotEntrainement(monde: Monde, o: { graine?: number; total?: number; gabarits?: Gabarits } = {}): Lot {
  const graine = o.graine ?? 20261120, total = o.total ?? 1500, G = o.gabarits ?? lireGabarits();
  if (G.cote !== 'entrainement') throw new Error('ces gabarits ne sont pas ceux de l\'entraînement');
  const tous = episodesDesJeux(monde), vrais = tous.filter((e) => !casesTenues(monde, e).length);
  const reste = total - vrais.length;
  if (reste < 0) throw new Error(`le total demandé (${total}) est plus petit que le nombre de vraies phrases (${vrais.length})`);
  const langues = monde.langues.filter((l) => G.langues[l]), garder = (ep: Episode) => !casesTenues(monde, ep).length, prises = vrais.map((e) => e.phrase);
  const demandes: Demande[] = [];
  for (const [competence, famille, part] of PARTS) for (const langue of langues) {
    const n = Math.round(reste * part * POIDS_LANGUE(langue)); if (n <= 0) continue;
    const fautes = famille === 'paire' || famille === 'concept' || famille === 'reglages' ? Math.floor(n / 8) : 0;
    if (fautes) demandes.push({ competence, langue, famille, n: fautes, perturbe: 'fautes' });
    demandes.push({ competence, langue, famille, n: n - fautes });
  }
  const f = fabriquer(monde, G, demandes, graine, 'ee', { garder, prises });
  // Ce qui manque encore (une langue sans tournure pour une famille, les arrondis) est complété en français et en anglais.
  let episodes = f.episodes;
  for (let tour = 0; episodes.length < reste && tour < 6; tour++) {
    const manque = reste - episodes.length, plus: Demande[] = [];
    const cibles: Array<[Competence, Famille]> = [['C4', 'paire'], ['C5', 'concept'], ['C3', 'reglages'], ['C4', 'chaine']];
    cibles.forEach(([competence, famille], i) => { for (const langue of ['fr', 'en']) plus.push({ competence, langue, famille, n: Math.ceil(manque / 8) + (i === 0 ? 1 : 0) }); });
    // La graine du complément est dérivée, jamais voisine de la graine donnée : graine + 1 pourrait être celle d'un autre jeu.
    const suite = fabriquer(monde, G, plus, (Math.imul(graine ^ 0x9E3779B9, 2654435761) + 7919 * (tour + 1)) >>> 0, `ee${tour + 2}`, { garder, prises: [...prises, ...episodes.map((e) => e.phrase)] });
    if (!suite.episodes.length) break;
    episodes = [...episodes, ...suite.episodes];
  }
  if (episodes.length < reste) throw new Error(`les gabarits ne suffisent pas : ${episodes.length} épisodes fabriqués pour ${reste} demandés`);
  episodes = episodes.slice(0, reste);
  const lot = [...vrais, ...episodes], compter = (cle: (e: Episode) => string) => { const m: Record<string, number> = {}; for (const e of lot) m[cle(e)] = (m[cle(e)] ?? 0) + 1; return m; };
  return { episodes: lot, comptes: { total: lot.length, vrais: vrais.length, fabriques: episodes.length, ecartes: tous.length - vrais.length, parCompetence: compter((e) => e.competence), parLangue: compter((e) => e.langue) } };
}
/** Retire d'un lot les épisodes désignés par le contrôle de fuite (jamais l'inverse : le banc, lui, ne change pas). */
export const retirer = (episodes: Episode[], ids: Iterable<string>): Episode[] => { const s = new Set(ids); return episodes.filter((e) => !s.has(e.id)); };
