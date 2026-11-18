// Les langues d'Odin, rangées en DONNÉES : un fichier par langue dans `src/langue/langues/<code>.json`. Ajouter une langue,
// c'est ajouter un fichier, sans toucher au code de Logos ni des réponses. Chaque fichier peut donner :
//  - `petitsMots` : les mots sans sens propre (pour la reconnaître et pour les laisser de côté en cherchant le sens) ;
//  - `indices` : des mots courants propres à la langue, pour la reconnaître seulement ;
//  - `formes` : des formes d'un mot ramenées à sa racine (« viruses » → « virus ») ;
//  - `applis` : des tournures qui S'AJOUTENT à celles d'une appli (clé « appli ») ou d'une action (« appli.action ») ;
//  - `reglages` : les mots qui annoncent un réglage chiffré d'une action (clé « appli.action.réglage ») : « season 2 »,
//    « Staffel 2 » ; « {n} » marque la place du nombre quand le mot l'entoure ou le suit (« 第{n}話 ») ;
//  - `pasEncoreMots` : les mots qui désignent ce qu'Odin ne sait pas encore faire (mêmes clés que PAS_ENCORE) ;
//  - `heure`, `abandon` : « quelle heure est-il », « laisse tomber » dans cette langue ;
//  - `textes` et `pasEncore` : ce qu'Odin répond sans modèle dans cette langue ;
//  - `modeles` : ce qu'une fonction dit tant que le modèle d'Odin qu'elle attend n'est pas entraîné (voir pas-entraine.ts).
// RECONNAÎTRE une langue ne demande pas de fichier ici : les profils (`profils.json`, des centaines de langues) s'en
// chargent. Un fichier ici sert à la COMPRENDRE sans modèle et à y RÉPONDRE ; sans lui, Odin dit la langue reconnue et
// qu'il lui faut un modèle de langue pour la comprendre.
// Le shimaoré et le kibushi viendront de la matière fournie par le propriétaire (jamais inventés ici).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface TableLangue {
  code: string;
  /** Le code ISO 639-3 de la langue (celui des profils de reconnaissance). */
  iso3?: string;
  nom: string;
  petitsMots: string[];
  /** Mots courants propres à la langue, pour la reconnaître seulement (jamais laissés de côté par Logos). */
  indices: string[];
  formes: Record<string, string>;
  applis: Record<string, string[]>;
  reglages: Record<string, string[]>;
  pasEncoreMots: Record<string, string[]>;
  heure: string[];
  abandon: string[];
  textes: Partial<Record<CleTexte, string>>;
  pasEncore: Record<string, { quoi: string; proche: string }>;
  /** Les sortes de modèles (« d'écoute », « de voix »…) et ce que chaque fonction en attente dit d'elle-même. */
  modeles: { sortes: Record<string, string>; choses: Record<string, { quoi: string; proche: string }> };
}
export type CleTexte = 'rienCompris' | 'garde' | 'pasEncore' | 'pasCetteLangue' | 'ilMeManque' | 'jeNeConnaisPas' | 'heure' | 'abandonne' | 'faitSansIA' | 'modelePasEntraine';

const DOSSIER = fileURLToPath(new URL('./langues/', import.meta.url));
let cache: Map<string, TableLangue> | undefined;

/** Toutes les langues connues (lues une fois). Un fichier illisible est laissé de côté, jamais bloquant. */
export function langues(): Map<string, TableLangue> {
  if (cache) return cache;
  const m = new Map<string, TableLangue>();
  if (existsSync(DOSSIER)) for (const f of readdirSync(DOSSIER).filter((x) => x.endsWith('.json')).sort()) {
    try {
      const j = JSON.parse(readFileSync(DOSSIER + f, 'utf8')) as Partial<TableLangue>;
      if (!j.code) continue;
      m.set(j.code, { code: j.code, iso3: j.iso3, nom: j.nom ?? j.code, petitsMots: j.petitsMots ?? [], indices: j.indices ?? [], formes: j.formes ?? {}, applis: j.applis ?? {}, reglages: j.reglages ?? {}, pasEncoreMots: j.pasEncoreMots ?? {}, heure: j.heure ?? [], abandon: j.abandon ?? [], textes: j.textes ?? {}, pasEncore: j.pasEncore ?? {}, modeles: { sortes: j.modeles?.sortes ?? {}, choses: j.modeles?.choses ?? {} } });
    } catch { /* fichier de langue illisible : ignoré */ }
  }
  cache = m;
  return m;
}
export const table = (code: string | undefined): TableLangue | undefined => (code ? langues().get(code) : undefined);

/** Une langue que Logos COMPREND (elle a des tournures d'applis), pas seulement reconnue. */
export const comprise = (code: string | undefined): boolean => code === 'fr' || Object.keys(table(code)?.applis ?? {}).length > 0;

/** Une langue dans laquelle Odin sait RÉPONDRE sans modèle (ses textes sont écrits). */
export const parlee = (code: string | undefined): boolean => Boolean(table(code)?.textes.rienCompris);

/** Les petits mots des langues que Logos comprend (minuscules), à laisser de côté en cherchant le sens. */
export function tousPetitsMots(): Set<string> {
  // Seulement les langues que Logos comprend : celles qu'il reconnaît sans les comprendre ne lui retirent aucun mot.
  const s = new Set<string>(); for (const t of langues().values()) if (comprise(t.code)) for (const w of t.petitsMots) s.add(w.toLowerCase()); return s;
}
/** Toutes les formes ramenées à leur racine, toutes langues. */
export function toutesFormes(): Record<string, string> {
  const o: Record<string, string> = {}; for (const t of langues().values()) Object.assign(o, t.formes); return o;
}
/** Les tournures ajoutées à une appli (`cle` = « appli ») ou à une action (« appli.action »), toutes langues. */
export function motsAjoutes(cle: string): string[] {
  const out: string[] = []; for (const t of langues().values()) for (const w of t.applis[cle] ?? []) if (!out.includes(w)) out.push(w); return out;
}
/** Les mots qui annoncent un réglage chiffré (`cle` = « appli.action.réglage »), toutes langues. */
export function motsDuReglage(cle: string): string[] {
  const out: string[] = []; for (const t of langues().values()) for (const w of t.reglages[cle] ?? []) if (!out.includes(w)) out.push(w); return out;
}

/**
 * Un texte dans la langue demandée, ses {variables} remplies. S'il manque dans cette langue : en français (jamais vide).
 */
export function texte(code: string | undefined, cle: CleTexte, vars: Record<string, string> = {}): string {
  const brut = table(code)?.textes[cle] ?? table('fr')?.textes[cle] ?? '';
  return brut.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
}

/** Une écriture sans espaces entre les mots (chinois, japonais, thaï…) : on cherche les mots DANS la phrase. */
export const SANS_ESPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
