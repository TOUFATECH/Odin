// Noûs — LA MATIÈRE PAR LANGUE de l'aiguilleur (src/brain/nous/matiere/<code>.json).
//
// Un fichier par langue (code ISO 639-1 ou 639-3, éventuellement suivi d'une variante : « fr », « swb », « buc »,
// « ary », « pt-br »), écrit à la main, qui donne des façons de demander chaque appli et chaque action, et des demandes
// qu'Odin ne sait pas traiter du tout (« hors champ ») :
//   {
//     "langue": "<code>", "ecriture": "latin|arabe|cyrillique|han|kana|devanagari|hangul…",
//     "origine": "…", "aRelire": true | false, "complet": true (facultatif : le fichier couvre toutes les applis),
//     "applis": { "<appli>": { "*": ["façon de demander l'appli sans viser d'action", …], "<action>": ["…", …] } },
//     "horsChamp": ["demande qu'Odin ne sait pas traiter", …]
//   }
// Les listes sont ALIGNÉES d'une langue à l'autre quand un fichier traduit un autre : la phrase n de « appli.action »
// dit la même idée dans chaque langue (ses « sœurs »). `null` garde la place d'une phrase retirée, pour que l'alignement
// tienne ; il n'est ni lu ni compté comme écarté. Chaque paire porte son groupe (« appli.action#n ») : la validation
// croisée met les sœurs dans le même pli (une traduction ne peut pas aider à retrouver sa propre phrase).
// Le chargeur ne plante jamais Odin : un fichier abîmé (illisible, trop gros, de mauvaise forme) est refusé en entier et
// c'est dit ; une appli ou une action inconnue est écartée (le reste du fichier est gardé) et c'est dit ; une phrase vide,
// trop longue ou en double est écartée et comptée. L'aiguilleur s'en sert comme d'une source de plus (paires « demande »).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROLE, type Paire } from './aiguilleur.ts';

/** Le dossier de la matière dans le dépôt. */
export const DOSSIER_MATIERE = fileURLToPath(new URL('./matiere/', import.meta.url));
/**
 * Taille maximale d'un fichier de matière (au-delà, il n'est pas lu). Les plus gros du dépôt font moins de 100 Kio ;
 * 1 Mio d'idéogrammes coûtait déjà 5 s et plus de 400 Mo à la construction (relecture du tour 2, P6).
 */
export const MATIERE_OCTETS_MAX = 1024 * 1024;
/** Taille maximale de toute la matière lue (au-delà, les fichiers suivants ne sont pas lus, et c'est dit). */
export const MATIERE_TOTAL_OCTETS_MAX = 4 * 1024 * 1024;
/** Longueur maximale d'une phrase de matière (caractères). */
export const PHRASE_MAX = 500;
/** Nombre maximal de phrases gardées par fichier. */
export const PHRASES_MAX = 50_000;
/** Clé d'une phrase « pour l'appli, sans action précise ». */
export const SANS_ACTION = '*';

export interface FichierMatiere {
  langue: string; ecriture: string; origine: string; aRelire: boolean; complet?: boolean;
  applis: Record<string, Record<string, Array<string | null>>>;
  horsChamp: Array<string | null>;
}
export interface BilanFichier {
  fichier: string; langue?: string;
  /** Refusé en entier (et pourquoi) ; sinon undefined. */
  refus?: string;
  paires: number; horsChamp: number; applis: number;
  /** Identifiants écartés : « appli » ou « appli.action » inconnus. */
  inconnus: string[];
  /** Phrases écartées : vides, trop longues, pas du texte, en double dans le fichier. */
  ecartees: number;
  complet: boolean; aRelire: boolean;
}
export interface BilanMatiere { fichiers: BilanFichier[]; paires: number; refuses: number; inconnus: number; ecartees: number }

/** Code de langue : deux ou trois lettres (ISO 639-1 ou 639-3), et une variante facultative (« pt-br », « zh-hant »). */
export const CODE_LANGUE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
const cleDe = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();

/**
 * Lit un fichier de matière déjà décodé et le remet en paires. `applis` : les applis connues et leurs actions.
 * Rend le refus si la forme est fausse (rien n'est gardé), sinon les paires et ce qui a été écarté.
 */
export function lireFichierMatiere(x: unknown, applis: Map<string, Set<string>>, nom = '?'): { paires: Paire[]; bilan: BilanFichier } {
  const bilan: BilanFichier = { fichier: nom, paires: 0, horsChamp: 0, applis: 0, inconnus: [], ecartees: 0, complet: false, aRelire: true };
  const refuser = (raison: string) => ({ paires: [] as Paire[], bilan: { ...bilan, refus: raison } });
  const f = x as FichierMatiere;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return refuser('ce n\'est pas un objet JSON');
  if (typeof f.langue !== 'string' || !CODE_LANGUE.test(f.langue)) return refuser('« langue » absente ou pas un code de langue (deux ou trois lettres, variante facultative)');
  bilan.langue = f.langue;
  if (typeof f.ecriture !== 'string' || !f.ecriture.trim()) return refuser('« ecriture » absente');
  if (typeof f.origine !== 'string' || !f.origine.trim()) return refuser('« origine » absente');
  if (typeof f.aRelire !== 'boolean') return refuser('« aRelire » doit valoir true ou false');
  if (f.complet !== undefined && typeof f.complet !== 'boolean') return refuser('« complet » doit valoir true ou false');
  if (!f.applis || typeof f.applis !== 'object' || Array.isArray(f.applis)) return refuser('« applis » doit être un objet');
  if (f.horsChamp !== undefined && !Array.isArray(f.horsChamp)) return refuser('« horsChamp » doit être une liste');
  for (const [id, acts] of Object.entries(f.applis)) {
    if (!acts || typeof acts !== 'object' || Array.isArray(acts)) return refuser(`« applis.${id} » doit être un objet`);
    for (const [a, l] of Object.entries(acts)) if (!Array.isArray(l)) return refuser(`« applis.${id}.${a} » doit être une liste`);
  }
  bilan.aRelire = f.aRelire; bilan.complet = f.complet === true;
  const paires: Paire[] = [], vues = new Set<string>(), source = `matiere:${f.langue}`;
  const pousser = (t: unknown, appli: string | null, action: string | null, groupe: string): void => {
    if (t === null) return; // place vide d'une phrase retirée (garde l'alignement des traductions)
    if (paires.length >= PHRASES_MAX) { bilan.ecartees++; return; }
    if (typeof t !== 'string') { bilan.ecartees++; return; }
    const texte = t.replace(CONTROLE, ' ').replace(/\s+/gu, ' ').trim();
    const k = cleDe(texte);
    if (!k || [...texte].length > PHRASE_MAX) { bilan.ecartees++; return; }
    const kk = `${appli ?? ''}\u0000${action ?? ''}\u0000${k}`;
    if (vues.has(kk)) { bilan.ecartees++; return; }
    vues.add(kk);
    paires.push({ texte, appli, action, source, demande: true, poids: 1, groupe });
  };
  for (const id of Object.keys(f.applis).sort()) {
    const acts = applis.get(id);
    if (!acts) { bilan.inconnus.push(id); continue; }
    bilan.applis++;
    for (const a of Object.keys(f.applis[id]).sort()) {
      if (a !== SANS_ACTION && !acts.has(a)) { bilan.inconnus.push(`${id}.${a}`); continue; }
      f.applis[id][a].forEach((t, n) => pousser(t, id, a === SANS_ACTION ? null : a, `${id}.${a}#${n}`));
    }
  }
  const avant = paires.length;
  (f.horsChamp ?? []).forEach((t, n) => pousser(t, null, null, `horsChamp#${n}`));
  bilan.horsChamp = paires.length - avant;
  bilan.paires = paires.length;
  return { paires, bilan };
}

/**
 * Lit tous les fichiers <code>.json du dossier (absent : aucune matière, sans erreur). Ne lève jamais d'exception :
 * tout refus est dans le bilan.
 */
export function lireMatiere(applis: Map<string, Set<string>>, dossier: string = DOSSIER_MATIERE): { paires: Paire[]; bilan: BilanMatiere } {
  const bilan: BilanMatiere = { fichiers: [], paires: 0, refuses: 0, inconnus: 0, ecartees: 0 };
  let noms: string[];
  try { noms = readdirSync(dossier).filter((n) => n.toLowerCase().endsWith('.json')).sort(); } catch { return { paires: [], bilan }; }
  const paires: Paire[] = [];
  const langues = new Set<string>();
  let total = 0;
  for (const nom of noms) {
    const vide: BilanFichier = { fichier: nom, paires: 0, horsChamp: 0, applis: 0, inconnus: [], ecartees: 0, complet: false, aRelire: true };
    let b: BilanFichier | undefined, p: Paire[] = [];
    try {
      const chemin = join(dossier, nom), taille = statSync(chemin).size;
      if (taille > MATIERE_OCTETS_MAX) b = { ...vide, refus: `trop gros (${taille} octets, ${MATIERE_OCTETS_MAX} au plus)` };
      else if (total + taille > MATIERE_TOTAL_OCTETS_MAX) b = { ...vide, refus: `toute la matière dépasserait ${MATIERE_TOTAL_OCTETS_MAX} octets : non lu` };
      else {
        let x: unknown;
        try { x = JSON.parse(readFileSync(chemin, 'utf8').replace(/^﻿/, '')); } catch (e) { x = undefined; b = { ...vide, refus: `JSON illisible : ${String((e as Error)?.message ?? e).slice(0, 120)}` }; }
        if (x !== undefined) {
          const r = lireFichierMatiere(x, applis, nom); b = r.bilan; p = r.paires;
          if (!b.refus && `${b.langue}.json` !== nom) { b = { ...b, refus: `le nom du fichier ne suit pas la langue (« ${b.langue} » attendu dans ${b.langue}.json)` }; p = []; }
          else if (!b.refus && langues.has(b.langue!)) { b = { ...b, refus: `langue « ${b.langue} » déjà lue` }; p = []; }
        }
      }
    } catch (e) { b = { ...vide, refus: `illisible : ${String((e as Error)?.message ?? e).slice(0, 120)}` }; }
    b ??= { ...vide, refus: 'illisible' };
    if (b.refus) { bilan.refuses++; p = []; b = { ...b, paires: 0, horsChamp: 0 }; } else { langues.add(b.langue!); try { total += statSync(join(dossier, nom)).size; } catch { /* déjà lu */ } }
    bilan.fichiers.push(b); bilan.inconnus += b.inconnus.length; bilan.ecartees += b.ecartees;
    for (const x of p) paires.push(x);
  }
  bilan.paires = paires.length;
  return { paires, bilan };
}
