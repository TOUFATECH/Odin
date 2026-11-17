// Reconnaître la langue d'un texte, sur la machine, sans modèle ni serveur (note « toutes les langues », étape 2).
// UN SEUL reconnaisseur pour tout Odin (texte écrit ; la voix et les documents doivent s'en servir aussi).
//  1. Les PROFILS de langue (`src/langue/profils.json`, des données fabriquées par `fabriquer-profils.ts` à partir de
//     phrases publiques sous licence libre) : la vraisemblance des trigrammes de caractères du texte, pour chacune des
//     centaines de langues et des écritures qu'ils contiennent. Aucune liste de langues dans ce code.
//  2. Les langues qu'Odin COMPREND (fichiers `src/langue/langues/<code>.json`) ajoutent leurs petits mots : utile sur une
//     demande très courte (« pause my VM »).
// Il rend la langue ET une confiance (0 à 1). Quand il ne sait pas (texte trop court, deux langues proches au coude à
// coude), `langue` est absente : il le DIT. Il ne rend JAMAIS le français par défaut ; c'est l'appelant qui choisit sa
// langue de repli (celle de la personne, sinon le français). Pur, hors la lecture des profils (une fois).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { langues } from './tables.ts';
import { trigrammes } from './trigrammes.ts';
import type { Profils } from './fabriquer-profils.ts';

export interface LangueReconnue {
  /** Code de la langue : celui du fichier de langue d'Odin quand il en a un (« fr », « en »), sinon le code ISO 639-3 (« rus »). Absent quand ce n'est pas sûr. */
  langue?: string;
  /** 0 à 1. En dessous de SEUIL_SUR, `langue` est absente. */
  confiance: number;
  /** La meilleure hypothèse, même incertaine (pour dire « peut-être de l'espagnol »). */
  hypothese?: string;
  /** Le nom de la langue (en français), quand on le connaît. */
  nom?: string;
}

export const SEUIL_SUR = 0.6;
/** A priori par la taille du profil, et appoint par petit mot d'une langue qu'Odin comprend (réglés sur les phrases d'essai). */
const PRIOR = 40, BONUS = 400;

let profils: Profils | null | undefined;
function lesProfils(): Profils | null {
  if (profils !== undefined) return profils;
  const f = fileURLToPath(new URL('./profils.json', import.meta.url));
  try { profils = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as Profils : null; } catch { profils = null; }
  return profils;
}
/** Combien de langues le reconnaisseur connaît (profils). */
export const languesReconnues = (): number => Object.keys(lesProfils()?.langues ?? {}).length;

/** ISO 639-3 → code du fichier de langue d'Odin (« fra » → « fr »), pour les langues qu'il comprend. */
function versCode(iso3: string): string {
  for (const t of langues().values()) if (t.iso3 === iso3) return t.code;
  return iso3;
}
/** Le nom d'une langue en français (« rus » → « russe »), sans liste à nous : celle du système. */
export function nomDeLangue(code: string): string | undefined {
  try { const n = new Intl.DisplayNames(['fr'], { type: 'language' }).of(code); return n && n !== code && !/^[a-z]{2,3}(?:-[a-z]+)?$/i.test(n) ? n : undefined; } catch { return undefined; }
}

export function reconnaitre(texte: string): LangueReconnue {
  const ts = trigrammes(texte);
  if (!ts.length) return { confiance: 0 };
  const p = lesProfils();
  const scores = new Map<string, number>();
  if (p) for (const [code, l] of Object.entries(p.langues)) {
    let s = 0; for (const t of ts) s += l.tri[t] ?? p.plancher;
    // Un a priori : une langue très peu représentée (ancienne, construite) l'emporte moins vite sur une phrase courte.
    scores.set(code, (s + PRIOR * Math.log10(Math.max(10, l.phrases))) / ts.length);
  }
  // Les petits mots des langues qu'Odin comprend : un appoint, compté par mot (utile quand la demande est très courte).
  const mots = texte.toLowerCase().normalize('NFC').split(/[^\p{L}']+/u).filter(Boolean);
  for (const t of langues().values()) {
    if (!t.iso3) continue;
    const petits = new Set([...t.petitsMots, ...t.indices].map((w) => w.toLowerCase()));
    const n = mots.filter((w) => petits.has(w) || petits.has(w.replace(/^(?:[ldjmtsnc]|qu)'/, ''))).length;
    if (n && scores.has(t.iso3)) scores.set(t.iso3, scores.get(t.iso3)! + (BONUS * n) / ts.length);
  }
  // Une écriture qui n'appartient qu'à une langue tranche d'abord : des kana, c'est du japonais ; du hangul, du coréen.
  const lettres = [...texte].filter((c) => /\p{L}/u.test(c));
  const part = (re: RegExp) => lettres.filter((c) => re.test(c)).length / Math.max(1, lettres.length);
  for (const [re, iso3] of [[/[\p{Script=Hiragana}\p{Script=Katakana}]/u, 'jpn'], [/\p{Script=Hangul}/u, 'kor']] as Array<[RegExp, string]>) {
    if (part(re) >= 0.2 && scores.has(iso3)) { const code = versCode(iso3); return { langue: code, confiance: 0.95, hypothese: code, nom: nomDeLangue(iso3) }; }
  }
  const tri = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (!tri.length) return { confiance: 0 };
  // Des idéogrammes sans kana : une langue chinoise (le japonais, lui, a ses kana) ; le dialecte reste à départager.
  if (part(/\p{Script=Han}/u) >= 0.5 && tri[0][0] !== 'jpn') { const code = versCode(tri[0][0]); return { langue: code, confiance: 0.9, hypothese: code, nom: nomDeLangue(tri[0][0]) }; }
  // Le second, c'est la meilleure langue d'un AUTRE groupe (deux langues très proches ne se départagent pas sur une phrase).
  const groupe = (p?.groupes ?? []).find((g) => g.includes(tri[0][0])) ?? [tri[0][0]];
  const premier = tri[0], second = tri.find(([c]) => !groupe.includes(c));
  // La confiance grandit avec l'écart au second ET avec la longueur du texte (quelques lettres ne prouvent rien).
  const ecart = premier[1] - (second?.[1] ?? premier[1] - 100);
  const confiance = Math.round((1 - Math.exp(-(ecart * Math.min(ts.length, 40)) / 800)) * 100) / 100;
  const code = versCode(premier[0]);
  // Un nom même pour une variété que le système ne nomme pas : celui de la langue la mieux représentée de son groupe
  // (« apc » → « arabe »).
  const nom = nomDeLangue(premier[0]) ?? groupe.filter((c) => nomDeLangue(c)).sort((a, b) => (p?.langues[b]?.phrases ?? 0) - (p?.langues[a]?.phrases ?? 0)).map((c) => nomDeLangue(c))[0];
  const r: LangueReconnue = { confiance, hypothese: code, nom };
  return confiance >= SEUIL_SUR ? { ...r, langue: code } : r;
}
