// Banc d'actions « BA-1 » : l'APPRENANT. Ce qui, dans la boucle, propose une réponse à une demande et apprend de ce que
// le vérificateur en dit. Trois choses apprennent, toutes rangées dans un ÉTAT en JSON (copiable, comparable par
// empreinte, remis exactement en place après un refus de la porte) :
//   - l'AIGUILLAGE : « cette demande → cette appli et cette action ». En vrai, c'est l'aiguilleur d'Odin
//     (src/brain/nous/aiguilleur.ts : creerAiguilleurSync, apprendre) dans un dossier d'Odin jetable ; pour les essais,
//     un petit aiguilleur de poche (même rôle, quelques paires). Une leçon n'est apprise que d'une réponse que le
//     vérificateur a jugée TOUTE juste. Ici, le vérificateur tient la place du geste du propriétaire : c'est permis
//     dans un Odin jetable, jamais dans le vrai ;
//   - les GESTES à emplacements (la forme des acquis de src/learn/acquis.ts) : « cette forme de phrase → cette
//     décision et ces actions, avec ces emplacements ». Seule la VALEUR change d'une fois sur l'autre. Un geste qui
//     échoue deux fois est oublié (même règle que `used` des acquis) ;
//   - les LIENS (les synapses de src/brain/neurones.ts : nouvelle, forceDe, renforcer) entre les mots d'une demande,
//     les personnes qu'elle nomme, et les notes ou souvenirs du monde. Ils servent à retrouver une valeur qui n'est que
//     dans une note (compétence C5). Les liens « écrits » (une note qui nomme une personne) existent dès le départ.
//
// Les améliorations de l'entraînement B, chacune activable seule (réglages) :
//   - B1 « exploration » : la boucle peut demander les essais suivants (2e et 3e choix, autres façons de remplir les
//     réglages, autres décisions). JAMAIS un essai qui engage, ni sur un ordre venu d'un contenu extérieur ;
//   - B2 « facteur signé » : après un échec, la voie fautive baisse un peu — un contre-exemple « pas cette appli pour
//     cette demande » si l'appli était fausse ; les liens APPRIS qui ont mené à la note si la valeur était fausse, sans
//     jamais descendre sous leur base. Un lien écrit ne baisse JAMAIS ;
//   - B3 (pratiquer selon le progrès) est dans la boucle : il choisit quels épisodes sont pratiqués au deuxième passage
//     (tirage avec remise), pas ce qui est appris.
//
// CE QUI N'APPREND JAMAIS : la sûreté. Une action qui engage (règle du monde, ou registre « peut engager ») demande
// toujours la validation ; un ordre venu d'un contenu extérieur qui changerait quelque chose est toujours refusé. Ces
// règles sont écrites ici, en dur ; aucune mise à jour ne les touche.
//
// L'apprenant ne voit d'un épisode que la VUE (phrase, langue, écriture, petit contexte) : jamais ce qu'on attend. Il
// connaît le monde W (le même pour l'entraînement et le banc : les notes ne changent jamais, seuls les liens, rangés à
// part, changent) et la liste de ses propres actions avec leurs emplacements (ce que le catalogue d'Odin sait déjà).
// Il ne lit aucun fichier : le monde, la fabrique d'aiguillage et l'état lui sont donnés.
import { createHash } from 'node:crypto';
import { appliquer, plat, type Monde } from './monde.ts';
import type { Decision, EtapeProposee, Proposition, Verdict } from './verificateur.ts';
import { forceDe, nouvelle, renforcer, R as RN, type Origine, type Synapse } from '../../../src/brain/neurones.ts';
import { MAX_STEPS } from '../../../src/learn/acquis.ts';

// ------------------------------------------------------------------------------------------------ types
/** Ce que l'apprenant voit d'un épisode (la même forme que `vueApprenant` du banc). */
export interface Vue { phrase: string; langue: string; ecriture: string; contexte?: { origine?: 'proprietaire' | 'contenu'; appli?: string; heure?: string } }
export interface Choix { appli: string | null; action: string | null }
/** Une leçon de l'aiguillage : cette demande va à cette appli et cette action (appli nulle : « pas encore », passer la main). */
export interface Lecon { demande: string; appli: string | null; action: string | null }
export interface Aiguillage {
  aiguiller(phrase: string, ctx?: { appli?: string }): { choix: Choix[]; decision: 'seul' | 'trois' | 'main' };
  apprendre(l: Lecon): boolean;
}
/** Construit un aiguillage à partir des leçons déjà apprises (dans cet ordre). */
export type FabriqueAiguillage = (lecons: readonly Lecon[]) => Aiguillage;

/** Un geste : une forme de phrase (valeurs remplacées par « §sorte »), une décision, des étapes à emplacements. */
export interface Geste {
  forme: string; decision: Decision;
  /** « §i » : l'identifiant de la i-ème valeur de la phrase ; « §si » : la valeur telle qu'elle est dite ; sinon : une valeur fixe */
  etapes: Array<{ appli: string; action: string; reglages: Record<string, string> }>;
  appli?: string; manque?: string[];
  ok: number; echecs: number;
}
export interface ContreExemple { demande: string; appli: string }
export type Lien = Synapse & { o: Origine };
export interface EtatApprenant { v: 1; lecons: Lecon[]; contre: ContreExemple[]; gestes: Geste[]; liens: Lien[]; horloge: number }
export type Maj = Record<'aiguilleur' | 'geste' | 'geste_oublie' | 'liens_plus' | 'liens_moins' | 'contre_ex', number>;
export const majVide = (): Maj => ({ aiguilleur: 0, geste: 0, geste_oublie: 0, liens_plus: 0, liens_moins: 0, contre_ex: 0 });

export interface ReglagesApprenant {
  /** faux : le témoin. Rien n'est jamais mis à jour. */
  apprend: boolean;
  /** B1 : `essais` rend plus que le premier choix. */
  exploration: boolean;
  /** B2 : contre-exemples et liens qui baissent après un échec. */
  facteurSigne: boolean;
  /** B1 : combien d'essais au plus pour un épisode (le premier compris). */
  essaisMax: number;
  /** B2 : ressemblance (trigrammes) à partir de laquelle un contre-exemple touche une demande. */
  seuilContre: number;
}
export const REGLAGES_APPRENANT: ReglagesApprenant = Object.freeze({ apprend: true, exploration: false, facteurSigne: false, essaisMax: 6, seuilContre: 0.5 });

/** Ce qui a mené à une proposition : de quoi apprendre ensuite, voie par voie. */
export interface Trace {
  source: 'geste' | 'aiguillage' | 'decision';
  /** le rang du choix de l'aiguillage (1, 2, 3) ; 0 pour un geste ou une décision sans action */
  rangChoix: number;
  forme: string; valeurs: Valeur[];
  /** les notes ou souvenirs d'où vient une valeur, et les liens qui y ont mené */
  notes: Array<{ note: string; liens: string[] }>;
}
export interface Essai { proposition: Proposition; trace: Trace; /** au moins une étape engage (règle du monde ou registre) */ engage: boolean }
/** Une valeur reconnue dans un texte : ce qui est dit, sa sorte, et l'objet du monde qu'elle désigne. */
export interface Valeur { surface: string; sorte: string; id?: string }

// ------------------------------------------------------------------------------------------------ petites aides
const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
const trigrammes = (t: string): Set<string> => { const s = ` ${plat(t)} `, out = new Set<string>(); for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3)); return out; };
export function ressemblance(a: Set<string>, b: Set<string>): number { if (!a.size || !b.size) return 0; let c = 0; for (const x of a) if (b.has(x)) c++; return c / (a.size + b.size - c); }
const echapper = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Les mots d'une demande (4 lettres au moins), sans accents ni casse, sans doublon, dans l'ordre. */
export const motsDe = (t: string): string[] => [...new Set((plat(t).match(/[\p{L}\p{N}]{4,}/gu) ?? []))];

// ------------------------------------------------------------------------------------------------ les emplacements des actions
/**
 * Les emplacements des actions que le monde sait jouer : ce que le catalogue d'Odin dit déjà de ses propres actions
 * (nom de chaque réglage, et sa sorte). « ? » en fin de nom : facultatif.
 */
export const EMPLACEMENTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'saga.chercher': ['q:texte'], 'saga.attention': [], 'saga.noter': ['titre:texte', 'texte?:texte'], 'saga.completer': ['note:note', 'texte:texte'],
  'appareils.lister': [], 'appareils.commander': ['appareil:appareil', 'valeur:valeur'], 'midgard.commander': ['appareil:appareil', 'valeur:valeur'],
  'midgard.maison': [], 'midgard.scene': ['scene:scene'],
  'frigg.agenda': [], 'frigg.rendez_vous': ['titre:texte', 'quand:quand', 'lieu?:texte'], 'frigg.annuler': ['id:rdv'],
  'naglfar.lister': [], 'naglfar.images': [], 'naglfar.journaux': ['conteneur:conteneur'], 'naglfar.demarrer': ['conteneur:conteneur'],
  'naglfar.redemarrer': ['conteneur:conteneur'], 'naglfar.arreter': ['conteneur:conteneur'], 'naglfar.supprimer': ['conteneur:conteneur'], 'naglfar.lancer': ['image:texte'],
  'aegir.jouer': ['quoi:texte', 'ou?:enceinte'], 'aegir.stop': [], 'bragi.annoncer': ['message:texte', 'ou?:enceinte'], 'gladsheim.meteo': ['ville:ville'],
  'apparence.etat': [], 'apparence.theme': ['theme:theme'], 'heidrun.profils': [], 'heidrun.pause': ['nom:profil'], 'heidrun.reprendre': ['nom:profil'],
  'himinbjorg.cameras': [], 'himinbjorg.photo': ['camera:camera'], 'himinbjorg.enregistrer': ['camera:camera', 'secondes?:nombre'],
  'vidarr.bloquer': ['domaine:domaine'], 'vidarr.autoriser': ['domaine:domaine'], 'garmr.bannis': [], 'garmr.bannir': ['ip:ip'], 'garmr.debannir': ['ip:ip'],
  'hermod.parc': [], 'hermod.reveiller': ['machine:machine'], 'hermod.redemarrer': ['machine:machine'],
});
/** Les mots d'un ordre, dans quelques langues : ce qu'Odin sait déjà des verbes de la maison (rien n'est appris ici). */
const ORDRES: Array<[string, RegExp]> = [
  ['deverrouille', /\b(deverrouill|debloqu|unlock|desbloque|entriegel|sblocc|destranc|ontgrendel|отопр|kilidini ac|fungua kufuli|解锁|解除)/],
  ['verrouille', /\b(verrouill|lock|bloquea la|cierra con llave|verriegel|blocca|tranca|vergrendel|запри|kilitle|funga kufuli|锁上|ロック)/],
  ['on', /\b(allum|turn on|switch on|enciend|encend|einschalt|schalte .* ein|mach .* an|accend|liga|ligar|aanzet|zet .* aan|включ|ac\b|washa|打开|点亮|开|つけ|شغل|أشعل)/],
  ['off', /\b(etein|etei|turn off|switch off|apag|ausschalt|mach .* aus|spegn|deslig|uitzet|zet .* uit|выключ|kapat|zima|关|消し|أطفئ)/],
  ['ouvre', /\b(ouvr|leve|monte|open|raise|abr|offne|hoch|apri|alza|abra|levant|открой|подними|ac|fungua|拉开|开|開け|افتح)/],
  ['ferme', /\b(ferm|baiss|descend|close|lower|cierr|baj|schlie|runter|chiud|abbass|fech|baix|sluit|закрой|опусти|kapat|funga|关上|閉め|أغلق)/],
];

// ------------------------------------------------------------------------------------------------ lire les valeurs d'un texte
interface Nom { texte: string; sorte: string; id: string }
/** Les noms d'objets du monde, du plus long au plus court (pour reconnaître le plus long d'abord). */
function nomsDu(monde: Monde): Nom[] {
  const out: Nom[] = [];
  const ajouter = (texte: string, sorte: string, id: string) => { const t = plat(texte); if (t.length >= 3) out.push({ texte: t, sorte, id }); };
  for (const a of monde.foyer.appareils) { ajouter(a.nom, a.sorte === 'enceinte' ? 'enceinte' : 'appareil', a.id); for (const v of Object.values(a.mentions)) ajouter(v.replace(/^(la|le|les|l'|the|el|die|der|das|il|lo|o|a|de|het)\s+/i, ''), a.sorte === 'enceinte' ? 'enceinte' : 'appareil', a.id); }
  for (const c of monde.foyer.cameras) { ajouter(c.nom, 'camera', c.id); for (const v of Object.values(c.mentions)) ajouter(v.replace(/^(la|le|les|l'|the|el|die|der|das|il|lo|o|a|de|het)\s+/i, ''), 'camera', c.id); }
  for (const s of monde.foyer.scenes) { ajouter(s.nom, 'scene', s.id); ajouter(s.id, 'scene', s.id); }
  for (const t of monde.foyer.themes) ajouter(t, 'theme', t);
  for (const [k, o] of Object.entries(monde.etat)) {
    const sorte = k.slice(0, k.indexOf(':')), id = k.slice(k.indexOf(':') + 1);
    if (sorte === 'conteneur' || sorte === 'machine') ajouter(id, sorte, id);
    if (sorte === 'profil' && typeof o.nom === 'string') ajouter(o.nom, 'profil', id);
    if (sorte === 'rdv' && typeof o.titre === 'string') ajouter(o.titre, 'rdv', id);
    if (sorte === 'note' && typeof o.titre === 'string') ajouter(o.titre, 'note', id);
  }
  return out.sort((a, b) => b.texte.length - a.texte.length || (a.texte < b.texte ? -1 : 1));
}
const FORMES: Array<[string, RegExp]> = [
  ['cite', /[«"“]\s*([^»"”]{2,60}?)\s*[»"”]/gu],
  ['ip', /\b(\d{1,3}(?:\.\d{1,3}){3})\b/g],
  ['domaine', /\b((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?)\b/gi],
  ['quand', /((?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana)\s*(?:a|at|um|alle|as|om)?\s*\d{1,2}\s*(?:h|:)\s*\d{0,2}|\d{1,2}\s*h\s*\d{0,2})/giu],
  ['nombre', /(\d{1,4}(?:[.,]\d+)?)\s*(?:%|°c?|degres|secondes?|sec|s\b)?/gu],
];
/**
 * Les valeurs d'un texte, dans l'ordre où elles apparaissent : objets du monde (par leur nom ou leur désignation),
 * citations, adresses, domaines, moments, nombres. Deux valeurs ne se chevauchent jamais (la plus longue gagne).
 */
export function lireValeurs(monde: Monde, texte: string, noms: Nom[] = nomsDu(monde)): Valeur[] {
  const t = plat(texte), prises: Array<{ debut: number; fin: number; v: Valeur }> = [];
  const libre = (d: number, f: number) => prises.every((p) => f <= p.debut || d >= p.fin);
  const formes = (quelles: string[]) => { for (const [sorte, re] of FORMES) if (quelles.includes(sorte)) for (const m of t.matchAll(re)) { const d = m.index! + m[0].indexOf(m[1]); if (libre(d, d + m[1].length)) prises.push({ debut: d, fin: d + m[1].length, v: { surface: m[1].trim(), sorte } }); } };
  // Les adresses et les domaines d'abord ; puis les objets du monde (un nom entre guillemets reste un objet) ; puis
  // les citations, les moments, les nombres.
  formes(['ip', 'domaine']);
  for (const n of noms) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${echapper(n.texte)})(?=$|[^\\p{L}\\p{N}])`, 'gu');
    for (const m of t.matchAll(re)) { const d = m.index! + m[1].length; if (libre(d, d + n.texte.length)) prises.push({ debut: d, fin: d + n.texte.length, v: { surface: n.texte, sorte: n.sorte, id: n.id } }); }
  }
  formes(['cite', 'quand', 'nombre']);
  return prises.sort((a, b) => a.debut - b.debut).map((p) => p.v);
}
/** La forme d'une phrase : ses valeurs remplacées par « §sorte ». Les personnes restent (une valeur tirée d'une note dépend d'elles). */
export function formeDe(monde: Monde, phrase: string, valeurs: Valeur[] = lireValeurs(monde, phrase)): string {
  let t = plat(phrase);
  for (const v of valeurs) t = t.replace(v.surface, ` §${v.sorte} `);
  return t.replace(/[^\p{L}\p{N}§ ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------------------------------------ l'état
const T0 = Date.UTC(2026, 10, 17, 10);
/** Deux heures entre deux épisodes : un usage n'est jamais « trop rapproché » du précédent (espacement d'une heure). */
export const PAS_HORLOGE = 2 * 3_600_000;
/** L'état de départ : aucune leçon, aucun geste, et les liens ÉCRITS du monde (une note ou un souvenir qui nomme une personne). */
export function etatInitial(monde: Monde): EtatApprenant {
  const liens: Lien[] = [];
  for (const [k, o] of Object.entries(monde.etat)) {
    if (!k.startsWith('note:') && !k.startsWith('souvenir:')) continue;
    const texte = plat(`${o.titre ?? ''} ${o.texte ?? ''}`);
    for (const p of monde.foyer.personnes) if (new RegExp(`(^|[^\\p{L}])${echapper(plat(p.nom))}($|[^\\p{L}])`, 'u').test(texte)) liens.push({ ...nouvelle(`p:${p.id}`, `n:${k}`, 'ecrit', T0), o: 'ecrit' });
  }
  return canonique({ v: 1, lecons: [], contre: [], gestes: [], liens, horloge: T0 });
}
/** L'état rangé toujours de la même façon (liens par identifiant, gestes par forme) : même contenu, même texte, même empreinte. */
export function canonique(e: EtatApprenant): EtatApprenant {
  const c = JSON.parse(JSON.stringify(e)) as EtatApprenant;
  c.liens.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); c.gestes.sort((a, b) => (a.forme < b.forme ? -1 : a.forme > b.forme ? 1 : 0));
  return c;
}
export const empreinteApprenant = (e: EtatApprenant): string => `sha256:${sha(JSON.stringify(canonique(e)))}`;

// ------------------------------------------------------------------------------------------------ l'aiguilleur de poche
/**
 * Un petit aiguilleur (pour les essais et les essais rapides) : trigrammes de caractères, le plus proche voisin vote.
 * Ce n'est pas l'aiguilleur d'Odin : il en tient le rôle sur un petit monde. Les leçons comptent double.
 */
export function aiguilleurDePoche(paires: ReadonlyArray<{ texte: string; appli: string | null; action: string | null }>, o: { seul?: number; main?: number } = {}): FabriqueAiguillage {
  const seuilSeul = o.seul ?? 0.45, seuilMain = o.main ?? 0.12;
  return (lecons) => {
    const base = paires.map((p) => ({ ...p, g: trigrammes(p.texte), poids: 1 }));
    const appris: typeof base = [];
    const ajouter = (l: Lecon) => { const k = plat(l.demande), i = appris.findIndex((x) => plat(x.texte) === k); if (i >= 0) appris.splice(i, 1); appris.push({ texte: l.demande, appli: l.appli, action: l.action, g: trigrammes(l.demande), poids: 2 }); };
    for (const l of lecons) ajouter(l);
    return {
      aiguiller(phrase) {
        const g = trigrammes(phrase), notes = new Map<string, { appli: string | null; action: string | null; s: number }>();
        for (const p of [...base, ...appris]) {
          const s = ressemblance(g, p.g) * p.poids, k = `${p.appli}.${p.action}`, x = notes.get(k);
          if (!x || s > x.s) notes.set(k, { appli: p.appli, action: p.action, s });
        }
        const tri = [...notes.values()].sort((a, b) => b.s - a.s || (`${a.appli}.${a.action}` < `${b.appli}.${b.action}` ? -1 : 1));
        const choix = tri.slice(0, 3).map(({ appli, action }) => ({ appli, action }));
        const s0 = tri[0]?.s ?? 0, s1 = tri[1]?.s ?? 0;
        return { choix, decision: !choix.length || s0 < seuilMain || choix[0].appli === null ? 'main' : s0 >= seuilSeul && s0 - s1 > 0.05 ? 'seul' : 'trois' };
      },
      apprendre(l) { ajouter(l); return true; },
    };
  };
}

// ------------------------------------------------------------------------------------------------ l'aiguilleur d'Odin
/**
 * L'aiguilleur d'Odin, sur les applis du produit, dans un dossier d'Odin JETABLE. La calibration (quelques minutes la
 * première fois) est faite une seule fois dans `cache` (un dossier jetable partagé par les runs : rien d'autre n'y est
 * écrit) ; chaque construction (au départ, puis après un refus de la porte) écrit les leçons de l'état dans le fichier
 * des corrections de `home`, puis refait l'index avec cette calibration. Chaque leçon nouvelle passe par `apprendre` de
 * l'aiguilleur, avec la seule provenance qu'il accepte : ici, c'est le vérificateur qui tient la place du geste du
 * propriétaire (Odin jetable seulement).
 */
export async function fabriqueAiguilleurOdin(o: { home: string; cache: string }): Promise<FabriqueAiguillage & { bilan: () => Record<string, unknown> }> {
  const { allModules } = await import('../../../src/valhalla/odin.ts');
  const { USAGES } = await import('../../../src/valhalla/links.ts');
  const { SURVOL } = await import('../../../src/valhalla/survol.ts');
  const { creerAiguilleurSync, fichierCorrections, PROVENANCE_ACCEPTEE } = await import('../../../src/brain/nous/aiguilleur.ts');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const mods = allModules({ paths: { home: o.home, workspace: o.home }, cfg: { venus: {}, voice: {} } } as never);
  const options = { modules: mods, usages: USAGES, survol: SURVOL, reglages: { poidsMots: 0 } };
  const calibration = creerAiguilleurSync({ ...options, home: o.cache }).bilan.calibration;
  let dernier: Record<string, unknown> = {};
  const fabrique = ((lecons: readonly Lecon[]) => {
    const f = fichierCorrections(o.home); mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify({ version: 1, corrections: lecons.map((l) => ({ demande: l.demande, appli: l.appli, action: l.action, provenance: PROVENANCE_ACCEPTEE })) }));
    const a = creerAiguilleurSync({ ...options, home: o.home, calibration });
    dernier = { ...a.bilan, calibration: undefined };
    return {
      aiguiller(phrase: string, ctx?: { appli?: string }) { const r = a.aiguiller(phrase, ctx); return { choix: r.choix.map((c) => ({ appli: c.appli, action: c.action })), decision: r.decision }; },
      apprendre(l: Lecon) { return a.apprendre({ demande: l.demande, appli: l.appli, action: l.action, provenance: PROVENANCE_ACCEPTEE }).ok; },
    };
  }) as FabriqueAiguillage & { bilan: () => Record<string, unknown> };
  fabrique.bilan = () => dernier;
  return fabrique;
}

// ------------------------------------------------------------------------------------------------ l'apprenant
export class Apprenant {
  readonly monde: Monde; readonly reglages: ReglagesApprenant;
  private e: EtatApprenant;
  private aig!: Aiguillage;
  private readonly fabrique: FabriqueAiguillage;
  private readonly noms: Nom[];
  private readonly notes: Array<{ cle: string; texte: string; brut: string }>;
  private liens = new Map<string, Lien>();
  private contreG: Array<{ g: Set<string>; appli: string }> = [];
  private gestes = new Map<string, Geste>();

  constructor(monde: Monde, fabrique: FabriqueAiguillage, etat?: EtatApprenant, reglages: Partial<ReglagesApprenant> = {}) {
    this.monde = monde; this.fabrique = fabrique; this.reglages = { ...REGLAGES_APPRENANT, ...reglages };
    this.noms = nomsDu(monde);
    this.notes = Object.entries(monde.etat).filter(([k]) => k.startsWith('note:') || k.startsWith('souvenir:')).map(([k, o]) => ({ cle: k, brut: `${o.titre ?? ''}. ${o.texte ?? ''}`, texte: plat(`${o.titre ?? ''} ${o.texte ?? ''}`) }));
    this.e = canonique(etat ?? etatInitial(monde));
    this.charger(this.e);
  }

  /** Remet l'apprenant EXACTEMENT dans cet état (l'aiguillage est refait à partir de ses leçons). */
  charger(etat: EtatApprenant): void {
    this.e = canonique(etat);
    this.aig = this.fabrique(this.e.lecons);
    this.liens = new Map(this.e.liens.map((l) => [l.id, l]));
    this.contreG = this.e.contre.map((c) => ({ g: trigrammes(c.demande), appli: c.appli }));
    this.gestes = new Map(this.e.gestes.map((g) => [g.forme, g]));
  }
  /** Une copie de l'état, rangée (les liens et les gestes vivent dans des tables : on les y reprend). */
  etat(): EtatApprenant { return canonique({ ...this.e, liens: [...this.liens.values()], gestes: [...this.gestes.values()] }); }
  empreinte(): string { return empreinteApprenant(this.etat()); }
  /** Avance l'horloge des liens d'un épisode (rien d'autre ne bouge). */
  avancer(): void { if (this.reglages.apprend) this.e.horloge += PAS_HORLOGE; }

  // -------------------------------------------------------------------------- proposer
  /** Le premier choix : ce que l'apprenant répond, sans explorer. */
  proposer(vue: Vue): Essai { return this.essais(vue, 1)[0]; }
  /**
   * Les essais, du premier choix aux suivants (B1). Sans exploration, ou sur un ordre venu d'un contenu extérieur :
   * le premier seul. Les suivants ne contiennent JAMAIS une étape qui engage. Pas de doublon.
   */
  essais(vue: Vue, max = this.reglages.exploration ? this.reglages.essaisMax : 1): Essai[] {
    const valeurs = lireValeurs(this.monde, vue.phrase, this.noms), forme = formeDe(this.monde, vue.phrase, valeurs);
    const out: Essai[] = [], vus = new Set<string>();
    const pousser = (x: Essai | undefined): boolean => {
      if (!x) return false;
      const k = JSON.stringify(x.proposition);
      if (vus.has(k)) return false;
      if (out.length > 0 && x.engage) return false;   // jamais d'exploration sur ce qui engage
      vus.add(k); out.push(x); return out.length >= max;
    };
    const exterieur = vue.contexte?.origine === 'contenu';
    // Un ordre venu d'un contenu extérieur (page, message, document) : une lecture seule passe ; tout le reste, y
    // compris ce que l'aiguillage ne sait pas placer, est refusé. Pas d'exploration. Règle fixe, jamais apprise.
    if (exterieur) {
      const c = this.aiguiller(vue).choix[0];
      const x = c?.appli && c.action ? this.remplir(vue, c, 1, forme, valeurs, 1)[0] : undefined;
      return [x && x.proposition.etapes?.length && x.proposition.decision === 'seul' ? x : { ...this.decision('refuser', forme, valeurs) }];
    }
    // 1. Un geste appris pour cette forme de phrase.
    const g = this.gestes.get(forme);
    if (g && pousser(this.depuisGeste(vue, g, valeurs, forme))) return out;
    // 2. L'aiguillage : chaque choix, puis d'autres façons de le remplir.
    const r = this.aiguiller(vue);
    // L'aiguillage ne sait pas (hors du champ, ou trop incertain) : passer la main est le premier choix.
    if (r.decision === 'main' && pousser(this.decision('main', forme, valeurs))) return out;
    if (exterieur && out.length) return out;
    const parties = this.parties(vue.phrase);
    for (let rang = 1; rang <= r.choix.length; rang++) {
      const c = r.choix[rang - 1];
      if (c.appli === null) { if (pousser(this.decision('main', forme, valeurs))) return out; continue; }
      if (rang === 1 && parties.length === 2) {
        const deux = this.deuxEtapes(vue, parties, forme, valeurs);
        if (deux && pousser(deux)) return out;
      }
      for (const x of this.remplir(vue, c, rang, forme, valeurs, rang === 1 ? max : 2)) if (pousser(x)) return out;
      if (max === 1 && out.length) return out;
      if (exterieur) return out;
    }
    // 3. Les autres sortes de réponse : dire franchement « je ne sais pas faire », passer la main.
    if (!out.length) pousser(this.decision('main', forme, valeurs));
    pousser(this.decision('ne-sait-pas', forme, valeurs));
    pousser(this.decision('main', forme, valeurs));
    return out;
  }

  /** Ce que l'aiguillage choisit pour une vue, contre-exemples compris (pour la signature du comportement). */
  aiguillage(vue: Vue): { choix: Choix[]; decision: 'seul' | 'trois' | 'main' } { return this.aiguiller(vue); }
  /** L'aiguillage, avec les contre-exemples (B2) : une appli écartée pour une demande voisine recule en dernier. */
  private aiguiller(vue: Vue): { choix: Choix[]; decision: 'seul' | 'trois' | 'main' } {
    const r = this.aig.aiguiller(vue.phrase, vue.contexte?.appli ? { appli: vue.contexte.appli } : undefined);
    if (!this.reglages.facteurSigne || !this.contreG.length || !r.choix.length) return r;
    const g = trigrammes(vue.phrase), ecartees = new Set(this.contreG.filter((c) => ressemblance(g, c.g) >= this.reglages.seuilContre).map((c) => c.appli));
    if (!ecartees.size) return r;
    const choix = [...r.choix.filter((c) => !c.appli || !ecartees.has(c.appli)), ...r.choix.filter((c) => c.appli && ecartees.has(c.appli))];
    return { choix, decision: choix[0] !== r.choix[0] && r.decision === 'seul' ? 'trois' : r.decision };
  }
  /** Deux intentions dans une phrase : coupée sur un mot qui enchaîne (dans quelques langues). */
  private parties(phrase: string): string[] {
    const p = phrase.split(/\s*(?:;|,?\s+(?:puis|ensuite|et ensuite|et juste apres|et, juste après|et juste après|then|and then|after that|dann|danach|und dann|luego|despues|después|y luego|poi|dopo|depois|e depois|daarna|en dan|затем|потом|sonra|kisha|halafu|ثم|然后|再|それから))\s+/iu).map((x) => x.trim()).filter((x) => x.length >= 4);
    return p.length === 2 ? p : [];
  }
  private deuxEtapes(vue: Vue, parties: string[], forme: string, valeurs: Valeur[]): Essai | undefined {
    const etapes: EtapeProposee[] = []; const notes: Trace['notes'] = [];
    for (const p of parties) {
      const c = this.aig.aiguiller(p).choix[0];
      if (!c?.appli || !c.action) return undefined;
      const x = this.remplir({ ...vue, phrase: p }, c, 1, forme, lireValeurs(this.monde, p, this.noms), 1)[0];
      if (!x || !x.proposition.etapes?.length) return undefined;
      etapes.push(...x.proposition.etapes); notes.push(...x.trace.notes);
    }
    return this.finir(vue, etapes, { source: 'aiguillage', rangChoix: 1, forme, valeurs, notes });
  }
  private decision(d: Decision, forme: string, valeurs: Valeur[], appli?: string, manque?: string[]): Essai {
    return { proposition: { decision: d, ...(appli ? { appli } : {}), ...(manque ? { manque } : {}) }, trace: { source: 'decision', rangChoix: 0, forme, valeurs, notes: [] }, engage: false };
  }
  private depuisGeste(vue: Vue, g: Geste, valeurs: Valeur[], forme: string): Essai | undefined {
    if (g.decision !== 'seul' && g.decision !== 'valider') return { ...this.decision(g.decision, forme, valeurs, g.appli, g.manque), trace: { source: 'geste', rangChoix: 0, forme, valeurs, notes: [] } };
    const etapes: EtapeProposee[] = [];
    for (const st of g.etapes) {
      const reglages: Record<string, string> = {};
      for (const [k, v] of Object.entries(st.reglages)) {
        const m = /^§(s?)(\d+)$/.exec(v);
        if (!m) { reglages[k] = v; continue; }
        const x = valeurs[Number(m[2])];
        if (!x) return undefined;
        reglages[k] = m[1] || !x.id ? x.surface : x.id;
      }
      etapes.push({ appli: st.appli, action: st.action, ...(Object.keys(reglages).length ? { reglages } : {}) });
    }
    return this.finir(vue, etapes, { source: 'geste', rangChoix: 0, forme, valeurs, notes: [] });
  }

  /** Les façons de remplir les réglages d'un choix (au plus `max`), la plus probable d'abord. Un emplacement requis introuvable : demander la précision. */
  private remplir(vue: Vue, c: Choix, rang: number, forme: string, valeurs: Valeur[], max: number): Essai[] {
    if (!c.appli) return [this.decision('main', forme, valeurs)];
    if (!c.action) return [this.decision('preciser', forme, valeurs, c.appli, ['action'])];
    const cible = `${c.appli}.${c.action}`, emps = EMPLACEMENTS[cible];
    const trace = (notes: Trace['notes']): Trace => ({ source: 'aiguillage', rangChoix: rang, forme, valeurs, notes });
    if (!emps) {
      // Une action que le monde ne joue pas : ses réglages sont les valeurs reconnues dans la phrase, par leur forme.
      const v = valeurs.map((x) => x.id ?? x.surface).concat((plat(vue.phrase).match(/\b[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)+\b|\b\p{L}*\d[\p{L}\p{N}]*\b/gu) ?? []));
      const uniques = [...new Set(v)].slice(0, 8);
      return [this.finir(vue, [{ appli: c.appli, action: c.action, ...(uniques.length ? { reglages: { valeurs: uniques.join(' ') } } : {}) }], trace([]))];
    }
    // Pour chaque emplacement, les valeurs possibles (de la phrase d'abord, puis des notes et souvenirs).
    const parEmplacement: Array<{ nom: string; requis: boolean; options: Array<{ valeur: string; note?: { note: string; liens: string[] } }> }> = [];
    for (const e of emps) {
      const [nomBrut, sorte] = e.split(':'), requis = !nomBrut.endsWith('?'), nom = nomBrut.replace('?', '');
      const options = this.valeursPour(vue, sorte, valeurs);
      if (!options.length && requis) return [this.decision('preciser', forme, valeurs, c.appli, [nom])];
      parEmplacement.push({ nom, requis, options });
    }
    // Le premier remplissage, puis un emplacement à la fois sur sa valeur suivante.
    const combos: number[][] = [parEmplacement.map(() => 0)];
    for (let i = 0; i < parEmplacement.length && combos.length < max; i++) for (let j = 1; j < parEmplacement[i].options.length && combos.length < max; j++) { const k = parEmplacement.map(() => 0); k[i] = j; combos.push(k); }
    return combos.map((k) => {
      const reglages: Record<string, string> = {}, notes: Trace['notes'] = [];
      parEmplacement.forEach((p, i) => { const o = p.options[k[i]]; if (!o) return; reglages[p.nom] = o.valeur; if (o.note) notes.push(o.note); });
      return this.finir(vue, [{ appli: c.appli!, action: c.action!, ...(Object.keys(reglages).length ? { reglages } : {}) }], trace(notes));
    });
  }

  /** Les valeurs possibles d'une sorte d'emplacement : de la phrase, puis (si rien) des notes que les mots et les liens désignent. */
  private valeursPour(vue: Vue, sorte: string, valeurs: Valeur[]): Array<{ valeur: string; note?: { note: string; liens: string[] } }> {
    const t = plat(vue.phrase);
    const tirer = (vs: Valeur[], texte: string): string[] => {
      const out: string[] = [];
      if (sorte === 'valeur') {
        for (const v of vs) if (v.sorte === 'nombre') out.push(v.surface.replace(/[^\d.,]/g, ''));
        for (const [mot, re] of ORDRES) if (re.test(texte)) out.push(mot);
        return out;
      }
      if (sorte === 'texte' || sorte === 'quand') { for (const v of vs) if (v.sorte === (sorte === 'quand' ? 'quand' : 'cite')) out.push(v.surface); return out; }
      if (sorte === 'ville') return [];
      if (sorte === 'nombre') return vs.filter((v) => v.sorte === 'nombre').map((v) => v.surface.replace(/[^\d.,]/g, ''));
      for (const v of vs) if (v.sorte === sorte) out.push(v.id ?? v.surface);
      return out;
    };
    const direct = [...new Set(tirer(valeurs, t))].map((valeur) => ({ valeur }));
    if (sorte === 'texte' && !direct.length) {
      // Un texte libre sans guillemets : ce qui suit un deux-points, ou la fin de la phrase après le verbe et l'objet.
      const apres = /[:：]\s*(.{3,60})$/u.exec(vue.phrase);
      if (apres) direct.push({ valeur: apres[1].trim() });
    }
    if (sorte === 'valeur' && direct.length < 3) for (const v of ['on', 'off', 'ouvre', 'ferme']) if (!direct.some((d) => d.valeur === v)) direct.push({ valeur: v });
    if (direct.length && sorte !== 'ville') return direct.slice(0, 4);
    // Rien dans la phrase : les notes et souvenirs (C5), par les mots et par les liens.
    const out: Array<{ valeur: string; note: { note: string; liens: string[] } }> = [];
    for (const n of this.rappel(vue.phrase).slice(0, 3)) {
      const vs = sorte === 'ville' ? (n.brut.match(/(?<=\s)\p{Lu}[\p{Ll}\p{M}-]{2,}/gu) ?? []).filter((x) => !this.estPersonne(x) && !n.brut.startsWith(x)).map((x) => ({ surface: x, sorte: 'ville' })) : lireValeurs(this.monde, n.brut, this.noms);
      for (const v of sorte === 'ville' ? vs.map((x) => x.surface) : tirer(vs as Valeur[], n.texte)) if (!out.some((o) => o.valeur === v)) out.push({ valeur: v, note: { note: n.cle, liens: n.liens } });
    }
    return out.slice(0, 4);
  }
  private estPersonne(x: string): boolean { return this.monde.foyer.personnes.some((p) => plat(p.nom) === plat(x)); }
  /** Les points d'une demande dans le graphe des liens : ses mots, et les personnes qu'elle nomme. */
  private points(phrase: string): string[] {
    const t = plat(phrase);
    return [...motsDe(phrase).slice(0, 12).map((m) => `m:${m}`), ...this.monde.foyer.personnes.filter((p) => new RegExp(`(^|[^\\p{L}])${echapper(plat(p.nom))}($|[^\\p{L}])`, 'u').test(t)).map((p) => `p:${p.id}`)];
  }
  /** Les notes et souvenirs les plus proches d'une demande : mots en commun, plus deux fois la force des liens qui y mènent. */
  rappel(phrase: string): Array<{ cle: string; brut: string; texte: string; score: number; liens: string[] }> {
    const mots = motsDe(phrase), pts = this.points(phrase), now = this.e.horloge, out = [];
    for (const n of this.notes) {
      let s = 0; const liens: string[] = [];
      for (const m of mots) if (n.texte.includes(m)) s += 1;
      for (const p of pts) { const id = cleLien(p, `n:${n.cle}`), l = this.liens.get(id); if (l) { s += 2 * forceDe(l, l.o, now); liens.push(id); } }
      if (s > 0) out.push({ ...n, score: s, liens });
    }
    return out.sort((a, b) => b.score - a.score || (a.cle < b.cle ? -1 : 1));
  }

  /** Met les étapes en proposition, avec la SÛRETÉ écrite en dur : ce qui engage demande la validation ; un contenu extérieur qui ferait changer quelque chose est refusé. */
  private finir(vue: Vue, etapes: EtapeProposee[], trace: Trace): Essai {
    let engage = false, lectureSeule = true;
    const marquees = etapes.slice(0, MAX_STEPS).map((s) => {
      const x = this.regle(s);
      engage ||= x.engage; lectureSeule &&= x.lecture;
      return { ...s, ...(x.engage ? { valider: true } : {}) };
    });
    if (vue.contexte?.origine === 'contenu' && !lectureSeule) return { proposition: { decision: 'refuser' }, trace: { ...trace, source: 'decision' }, engage: false };
    const toutes = marquees.every((s) => s.valider), aucune = marquees.every((s) => !s.valider);
    const proposition: Proposition = { decision: toutes ? 'valider' : 'seul', etapes: aucune || toutes ? marquees.map(({ valider: _v, ...r }) => r) : marquees };
    return { proposition, trace, engage };
  }
  /** Ce que le monde dit d'une étape (lecture ? engage ?), ou à défaut le registre. Dans le doute, elle engage. */
  private regle(s: EtapeProposee): { lecture: boolean; engage: boolean } {
    const code = this.monde.registre[s.appli]?.[s.action];
    try { const t = appliquer(this.monde, this.monde.etat, { appli: s.appli, action: s.action, reglages: s.reglages }); if (t.connu) return { lecture: t.lecture, engage: t.engage && !t.lecture }; } catch { /* le registre parle */ }
    if (code === 'l') return { lecture: true, engage: false };
    if (code === 'n') return { lecture: false, engage: false };
    return { lecture: false, engage: true };
  }

  // -------------------------------------------------------------------------- apprendre
  /**
   * Apprend de ce que le vérificateur a dit d'un essai. Rien pour le témoin. Une réponse TOUTE juste : une leçon
   * d'aiguillage, un geste, les liens qui ont mené à la note renforcés. Un échec : un geste fautif compte un échec
   * (oublié au deuxième) ; avec le facteur signé (B2), la voie fautive baisse. Une réponse tolérée n'apprend rien.
   */
  retenir(vue: Vue, essai: Essai, v: Pick<Verdict, 'toutJuste' | 'issue' | 'voie' | 'fauteSurete' | 'detail'>): Maj {
    const maj = majVide();
    if (!this.reglages.apprend) return maj;
    const p = essai.proposition, tr = essai.trace;
    if (v.toutJuste && !v.fauteSurete) {
      // L'aiguillage : la demande et sa première action (ou « pas encore », pour passer la main).
      const premiere = p.etapes?.[0];
      const lecon: Lecon | undefined = premiere ? { demande: vue.phrase, appli: premiere.appli, action: premiere.action } : p.decision === 'main' ? { demande: vue.phrase, appli: null, action: null } : undefined;
      if (lecon && vue.contexte?.origine !== 'contenu') {
        const k = plat(lecon.demande), i = this.e.lecons.findIndex((l) => plat(l.demande) === k);
        const meme = i >= 0 && this.e.lecons[i].appli === lecon.appli && this.e.lecons[i].action === lecon.action;
        if (!meme && this.aig.apprendre(lecon)) { if (i >= 0) this.e.lecons.splice(i, 1); this.e.lecons.push(lecon); maj.aiguilleur = 1; }
      }
      // Le geste : la forme de la phrase, la décision, les étapes avec leurs emplacements.
      const ancien = this.gestes.get(tr.forme);
      const geste = this.gesteDe(p, tr);
      if (geste && (!ancien || JSON.stringify({ ...ancien, ok: 0, echecs: 0 }) !== JSON.stringify({ ...geste, ok: 0, echecs: 0 }))) { this.gestes.set(tr.forme, geste); maj.geste = 1; }
      else if (ancien && ancien.echecs) ancien.echecs = 0;   // un geste qui réussit repart de zéro échec (rien d'autre ne change : pas de porte pour rien)
      // Les liens : ce qui a servi ensemble se relie (mots et personnes de la demande ↔ la note d'où vient la valeur).
      for (const n of tr.notes) for (const pt of this.points(vue.phrase).slice(0, 8)) {
        const id = cleLien(pt, `n:${n.note}`);
        let l = this.liens.get(id);
        if (!l) { if (this.liens.size >= RN.TOTAL_APPRIS) continue; l = { ...nouvelle(pt, `n:${n.note}`, 'appris', this.e.horloge), o: 'appris' }; this.liens.set(id, l); }
        if (renforcer(l, 1, this.e.horloge, l.o) > 0) maj.liens_plus++;
      }
      return maj;
    }
    if (v.issue === 'succes') return maj;   // tolérée : rien à en apprendre
    // Un échec.
    if (tr.source === 'geste') {
      const g = this.gestes.get(tr.forme);
      if (g && ++g.echecs >= 2) { this.gestes.delete(tr.forme); maj.geste_oublie = 1; }
    }
    if (!this.reglages.facteurSigne || v.fauteSurete) return maj;
    const appliFausse = p.etapes?.[0]?.appli ?? p.appli;
    if ((v.voie === 'appli' || v.detail?.appli === false) && appliFausse && vue.contexte?.origine !== 'contenu') {
      if (!this.e.contre.some((c) => c.appli === appliFausse && plat(c.demande) === plat(vue.phrase))) {
        this.e.contre.push({ demande: vue.phrase, appli: appliFausse }); this.contreG.push({ g: trigrammes(vue.phrase), appli: appliFausse }); maj.contre_ex = 1;
      }
    }
    if (v.voie === 'reglages') {
      for (const n of tr.notes) for (const id of n.liens) {
        const l = this.liens.get(id);
        if (!l || l.o !== 'appris') continue;   // un lien écrit ne baisse jamais
        const base = RN.BASE[l.o], w = forceDe(l, l.o, this.e.horloge), apres = Math.max(base, w - RN.PAS * w);
        l.w = apres; l.t = this.e.horloge;
        if (apres < w) maj.liens_moins++;
      }
    }
    return maj;
  }
  /** Le geste à retenir d'une réponse juste : les valeurs de la phrase deviennent des emplacements. */
  private gesteDe(p: Proposition, tr: Trace): Geste | undefined {
    if (!tr.forme) return undefined;
    if (p.decision !== 'seul' && p.decision !== 'valider') return { forme: tr.forme, decision: p.decision, etapes: [], ...(p.appli ? { appli: p.appli } : {}), ...(p.manque ? { manque: [...p.manque] } : {}), ok: 1, echecs: 0 };
    const etapes = (p.etapes ?? []).slice(0, MAX_STEPS).map((s) => {
      const reglages: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.reglages ?? {})) {
        const x = String(v), i = tr.valeurs.findIndex((y) => y.id === x), j = tr.valeurs.findIndex((y) => plat(y.surface) === plat(x));
        reglages[k] = i >= 0 ? `§${i}` : j >= 0 ? `§s${j}` : x;
      }
      return { appli: s.appli, action: s.action, reglages };
    });
    return { forme: tr.forme, decision: p.decision, etapes, ok: 1, echecs: 0 };
  }
  /** Quelques nombres sur l'état (pour le journal et les essais). */
  bilan(): { lecons: number; gestes: number; contre: number; liens: number; liensAppris: number } {
    return { lecons: this.e.lecons.length, gestes: this.gestes.size, contre: this.e.contre.length, liens: this.liens.size, liensAppris: [...this.liens.values()].filter((l) => l.o === 'appris').length };
  }
  /** Un lien (pour les essais). */
  lien(x: string, y: string): Lien | undefined { return this.liens.get(cleLien(x, y)); }
  /** Pose un lien appris (pour les essais : préparer un lien fautif). */
  poserLien(x: string, y: string, w: number): void { const l: Lien = { ...nouvelle(x, y, 'appris', this.e.horloge), o: 'appris' }; l.w = w; this.liens.set(l.id, l); }
}
const cleLien = (x: string, y: string): string => (x < y ? `${x}\u0001${y}` : `${y}\u0001${x}`);
