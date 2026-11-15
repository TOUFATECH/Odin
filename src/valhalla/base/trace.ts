// Alexandrie — la traçabilité des liens d'Odin avec les bases des applis : chaque lecture ou écriture d'Odin dans la base
// d'une appli, chaque migration, chaque déménagement et chaque renommage est noté (qui, quelle base, quelles tables,
// quand, pourquoi — JAMAIS les valeurs). Le journal « liens_bases » vit dans la base d'Alexandrie (ALEXANDRIE_ODIN),
// avec repli fichier tant qu'elle n'est pas prête. Les consultations sont aussi retenues par la mémoire d'Odin
// (Mnémosyne) : il peut répondre « quand as-tu regardé la base de Phénix ? ».
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fichierJsonl, Journal } from './journal.ts';
import { nomAffiche } from './noms.ts';

export type Operation = 'lecture' | 'ecriture' | 'migration' | 'renommage' | 'demenagement' | 'creation';
export interface Trace {
  at: string;
  /** qui agit : « Odin (discussion) », « Odin (Alexandrie) », « Odin (démarrage) »… */
  qui: string;
  /** l'appli dont c'est la base (identifiant) */
  appli: string;
  /** le nom de la base (PHENIX_ODIN…) */
  base: string;
  tables: string[];
  op: Operation;
  /** pourquoi (texte court, jamais une valeur lue) */
  pourquoi: string;
  /** nombre de lignes lues, copiées ou écrites (un nombre, jamais leur contenu) */
  lignes?: number;
  ok?: boolean;
}

const journaux = new Map<string, Journal<Trace>>();
function journalDe(home: string): Journal<Trace> {
  let j = journaux.get(home);
  if (!j) { const d = join(home, 'valhalla', 'urdr'); mkdirSync(d, { recursive: true, mode: 0o700 }); j = new Journal<Trace>('liens_bases', d, { garder: 5000, rangement: fichierJsonl<Trace>(join(d, 'liens-bases.jsonl'), 5000) }); journaux.set(home, j); }
  return j;
}

/** La mémoire d'Odin, branchée au démarrage (odin.ts) : une phrase par consultation, rangée sous le sujet de l'appli. */
type Memoire = (texte: string, sujet: string) => void;
let memoire: Memoire | undefined;
export function brancherMemoire(f: Memoire | undefined): void { memoire = f; }

const nettoyer = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Note un lien d'Odin avec une base (et le retient en mémoire si c'est une lecture ou une écriture d'Odin). */
export function tracer(home: string, e: Omit<Trace, 'at' | 'tables' | 'pourquoi'> & { tables?: string[]; pourquoi?: string; quand?: Date }): Trace {
  const t: Trace = { at: (e.quand ?? new Date()).toISOString(), qui: nettoyer(e.qui), appli: e.appli, base: e.base, tables: [...new Set((e.tables ?? []).map((x) => x.slice(0, 63)))].slice(0, 20), op: e.op, pourquoi: nettoyer(e.pourquoi ?? ''), ...(e.lignes !== undefined ? { lignes: e.lignes } : {}), ...(e.ok !== undefined ? { ok: e.ok } : {}) };
  try { journalDe(home).ajouter(t); } catch (x) { console.error(`[base] trace : ${(x as Error).message}`); }
  if (memoire && (t.op === 'lecture' || t.op === 'ecriture')) {
    const quand = t.at.slice(0, 16).replace('T', ' à ');
    try { memoire(`Le ${quand}, Odin a ${t.op === 'lecture' ? 'regardé' : 'écrit dans'} la base de ${nomAffiche(t.appli)} (${t.base})${t.tables.length ? `, ${t.tables.length > 1 ? 'tables' : 'table'} ${t.tables.join(', ')}` : ''}${t.pourquoi ? `, pour : ${t.pourquoi}` : ''}.`, `base ${nomAffiche(t.appli)}`); } catch { /* mémoire indisponible : le journal suffit */ }
  }
  return t;
}

/** Les traces (les plus récentes d'abord), d'une appli ou de toutes. */
export function traces(home: string, o: { appli?: string; n?: number } = {}): Trace[] {
  return journalDe(home).tout().filter((t) => !o.appli || t.appli === o.appli).slice(-(o.n ?? 50)).reverse();
}

/** Les tables nommées dans une requête (FROM, JOIN, INTO, UPDATE) : pour la trace, jamais les valeurs. */
export function tablesDe(sql: string): string[] {
  const sansTexte = sql.replace(/'(?:[^']|'')*'/g, "''");
  const out = new Set<string>();
  for (const m of sansTexte.matchAll(/\b(?:from|join|into|update|table)\s+((?:"[^"]+"|[\w$]+)(?:\s*\.\s*(?:"[^"]+"|[\w$]+))?)/gi)) out.add(m[1].replace(/\s+/g, '').replace(/"/g, ''));
  return [...out].filter((x) => !/^(select|lateral|only)$/i.test(x)).slice(0, 20);
}
