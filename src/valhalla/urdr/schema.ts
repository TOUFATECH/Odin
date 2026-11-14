// Alexandrie · le schéma d'une base dessiné (l'idée de drawDB, code maison : rien n'en est repris) :
// tables, colonnes, clés primaires, clés étrangères et index lus dans la vraie base ; placement automatique lisible,
// positions gardées ; ce qu'on ajoute sur le dessin (table, colonne, lien) devient du SQL, qui n'est lancé qu'avec
// ton accord ; exports SQL (PostgreSQL, MySQL), image (SVG, PNG) et dictionnaire des données (Markdown).
import type { Driver } from './db.ts';

export interface ColonneS { nom: string; type: string; nul: boolean; defaut?: string; pk: boolean; ref?: { table: string; colonne: string } }
export interface TableS { nom: string; colonnes: ColonneS[]; index: Array<{ nom: string; def: string }>; lignes: number }
export interface Schema { tables: TableS[]; liens: Array<{ de: string; colonne: string; vers: string; versColonne: string }> }
export type Positions = Record<string, { x: number; y: number }>;

/** Le schéma réel d'une base PostgreSQL (lecture seule). */
export async function lireSchema(d: Driver): Promise<Schema> {
  const t = await d.tables(), liens = (await d.relations()).map((r) => ({ de: r.from, colonne: r.column, vers: r.to, versColonne: r.toColumn }));
  const idx = await d.sql(`select case when schemaname = 'public' then tablename else schemaname || '.' || tablename end, indexname, indexdef from pg_indexes where schemaname not in ('pg_catalog', 'information_schema') order by 1, 2`, false);
  const tables: TableS[] = [];
  for (const x of t.slice(0, 300)) {
    const c = await d.columns(x.name);
    tables.push({ nom: x.name, lignes: x.rows, colonnes: c.map((k) => ({ nom: k.name, type: k.type, nul: k.nullable, pk: k.pk, ...(k.default ? { defaut: k.default } : {}), ...(k.ref ? { ref: { table: k.ref.table, colonne: k.ref.column } } : {}) })),
      index: idx.rows.filter((r) => r[0] === x.name).map((r) => ({ nom: r[1] ?? '', def: r[2] ?? '' })) });
  }
  return { tables, liens };
}

// ---------------------------------------------------------------- placement
export const LARGEUR = 230, LIGNE = 22, TETE = 34;
export const hauteur = (t: TableS) => TETE + Math.max(1, t.colonnes.length) * LIGNE + 8;
/**
 * Placement automatique : les tables sont rangées en colonnes selon leurs liens (une table qui pointe vers une autre
 * est à sa droite), puis du haut vers le bas ; les positions déjà gardées sont respectées. Pur.
 */
export function placer(s: Schema, gardees: Positions = {}): Positions {
  const niveau = new Map<string, number>(), noms = s.tables.map((t) => t.nom);
  const vers = (n: string) => s.liens.filter((l) => l.de === n && l.vers !== n).map((l) => l.vers);
  const calc = (n: string, pile: Set<string>): number => {
    if (niveau.has(n)) return niveau.get(n)!; if (pile.has(n)) return 0;
    pile.add(n); const v = vers(n).filter((x) => noms.includes(x)); const k = v.length ? 1 + Math.max(...v.map((x) => calc(x, pile))) : 0; pile.delete(n);
    niveau.set(n, k); return k;
  };
  for (const n of noms) calc(n, new Set());
  const out: Positions = {}, bas = new Map<number, number>();
  for (const t of [...s.tables].sort((a, b) => (niveau.get(a.nom)! - niveau.get(b.nom)!) || a.nom.localeCompare(b.nom))) {
    if (gardees[t.nom]) { out[t.nom] = gardees[t.nom]; continue; }
    const k = niveau.get(t.nom)!, y = bas.get(k) ?? 20;
    out[t.nom] = { x: 20 + k * (LARGEUR + 90), y }; bas.set(k, y + hauteur(t) + 40);
  }
  return out;
}

// ---------------------------------------------------------------- changements faits sur le dessin → SQL
export type Dialecte = 'postgres' | 'mysql';
export type Changement =
  | { op: 'table'; nom: string; colonnes: Array<{ nom: string; type: string; nul?: boolean; pk?: boolean; defaut?: string }> }
  | { op: 'colonne'; table: string; colonne: { nom: string; type: string; nul?: boolean; defaut?: string } }
  | { op: 'lien'; table: string; colonne: string; vers: string; versColonne: string };
const NOM = /^[A-Za-z_][A-Za-z0-9_]{0,62}(\.[A-Za-z_][A-Za-z0-9_]{0,62})?$/;
/** Les types acceptés sur le dessin (et leur équivalent MySQL). */
export const TYPES: Record<string, string> = {
  'serial': 'INT AUTO_INCREMENT', 'bigserial': 'BIGINT AUTO_INCREMENT', 'integer': 'INT', 'int': 'INT', 'bigint': 'BIGINT', 'smallint': 'SMALLINT', 'numeric': 'DECIMAL', 'real': 'FLOAT', 'double precision': 'DOUBLE',
  'boolean': 'BOOLEAN', 'text': 'TEXT', 'varchar': 'VARCHAR(255)', 'character varying': 'VARCHAR(255)', 'date': 'DATE', 'timestamp': 'DATETIME', 'timestamp without time zone': 'DATETIME', 'timestamptz': 'TIMESTAMP', 'timestamp with time zone': 'TIMESTAMP',
  'time': 'TIME', 'uuid': 'CHAR(36)', 'json': 'JSON', 'jsonb': 'JSON', 'bytea': 'BLOB',
};
const typeSur = (t: string): string => {
  const x = t.trim().toLowerCase(), m = /^(varchar|character varying|numeric|char)\s*\((\d{1,4})(?:\s*,\s*(\d{1,2}))?\)$/.exec(x);
  if (m) return `${m[1]}(${m[2]}${m[3] ? `,${m[3]}` : ''})`;
  if (!Object.hasOwn(TYPES, x)) throw new Error(`type inconnu : « ${t.slice(0, 40)} » (${Object.keys(TYPES).slice(0, 12).join(', ')}…)`);
  return x;
};
const DEFAUT = /^(null|true|false|now\(\)|current_timestamp|current_date|-?\d+(\.\d+)?|'(?:[^'\\]|'')*')$/i;
const defautSur = (d: string | undefined) => { if (d === undefined || d === '') return undefined; if (!DEFAUT.test(d.trim())) throw new Error(`valeur par défaut refusée : « ${d.slice(0, 40)} » (un nombre, 'un texte', true, false, now())`); return d.trim(); };
const q = (n: string, dia: Dialecte) => n.split('.').map((p) => (dia === 'mysql' ? `\`${p}\`` : `"${p}"`)).join('.');
const typeDe = (t: string, dia: Dialecte) => { const x = typeSur(t); if (dia === 'postgres') return x; const m = /^(varchar|character varying|numeric|char)\((.+)\)$/.exec(x); return m ? `${m[1] === 'numeric' ? 'DECIMAL' : m[1] === 'char' ? 'CHAR' : 'VARCHAR'}(${m[2]})` : TYPES[x]; };
const nom = (n: string, quoi: string) => { if (!NOM.test(n)) throw new Error(`nom de ${quoi} refusé : « ${n.slice(0, 40)} » (lettres sans accent, chiffres et _ ; 63 caractères au plus)`); return n; };

/** Le SQL d'une liste de changements, vérifiés contre le schéma actuel. Pur. Lève une erreur claire au premier problème. */
export function sqlDe(changements: Changement[], s: Schema, dia: Dialecte = 'postgres'): string[] {
  const tables = new Map(s.tables.map((t) => [t.nom, new Set(t.colonnes.map((c) => c.nom))])), out: string[] = [];
  for (const c of changements) {
    if (c.op === 'table') {
      nom(c.nom, 'table'); if (tables.has(c.nom)) throw new Error(`la table ${c.nom} existe déjà`);
      if (!c.colonnes.length) throw new Error(`la table ${c.nom} n'a aucune colonne`);
      const cols = c.colonnes.map((k) => { nom(k.nom, 'colonne'); const d = defautSur(k.defaut); return `  ${q(k.nom, dia)} ${typeDe(k.type, dia)}${k.pk ? ' PRIMARY KEY' : k.nul === false ? ' NOT NULL' : ''}${d ? ` DEFAULT ${d}` : ''}`; });
      if (new Set(c.colonnes.map((k) => k.nom)).size !== c.colonnes.length) throw new Error(`deux colonnes de ${c.nom} ont le même nom`);
      out.push(`CREATE TABLE ${q(c.nom, dia)} (\n${cols.join(',\n')}\n);`); tables.set(c.nom, new Set(c.colonnes.map((k) => k.nom)));
    } else if (c.op === 'colonne') {
      const t = tables.get(c.table); if (!t) throw new Error(`table inconnue : ${c.table}`); nom(c.colonne.nom, 'colonne');
      if (t.has(c.colonne.nom)) throw new Error(`la colonne ${c.table}.${c.colonne.nom} existe déjà`);
      const d = defautSur(c.colonne.defaut);
      out.push(`ALTER TABLE ${q(c.table, dia)} ADD COLUMN ${q(c.colonne.nom, dia)} ${typeDe(c.colonne.type, dia)}${c.colonne.nul === false ? ' NOT NULL' : ''}${d ? ` DEFAULT ${d}` : ''};`); t.add(c.colonne.nom);
    } else {
      const t = tables.get(c.table), v = tables.get(c.vers); if (!t) throw new Error(`table inconnue : ${c.table}`); if (!v) throw new Error(`table inconnue : ${c.vers}`);
      if (!t.has(c.colonne)) throw new Error(`colonne inconnue : ${c.table}.${c.colonne}`); if (!v.has(c.versColonne)) throw new Error(`colonne inconnue : ${c.vers}.${c.versColonne}`);
      const cn = `${c.table.replace(/\W/g, '_')}_${c.colonne}_fkey`.slice(0, 63);
      out.push(`ALTER TABLE ${q(c.table, dia)} ADD CONSTRAINT ${q(cn, dia)} FOREIGN KEY (${q(c.colonne, dia)}) REFERENCES ${q(c.vers, dia)} (${q(c.versColonne, dia)});`);
    }
  }
  return out;
}

/** Tout le schéma en SQL (pour recréer la base ailleurs). Pur. */
export function exportSql(s: Schema, dia: Dialecte): string {
  const lignes = [`-- Schéma exporté par Odin (Alexandrie) · ${dia === 'mysql' ? 'MySQL / MariaDB' : 'PostgreSQL'}`, ''];
  const typeExp = (t: string) => { try { return typeDe(t, dia); } catch { return dia === 'mysql' ? 'TEXT' : t; } };
  for (const t of s.tables) {
    const pks = t.colonnes.filter((c) => c.pk).map((c) => q(c.nom, dia));
    const cols = t.colonnes.map((c) => {
      const serie = /^nextval\(/.test(c.defaut ?? ''), type = serie ? (/bigint/.test(c.type) ? (dia === 'mysql' ? 'BIGINT AUTO_INCREMENT' : 'bigserial') : (dia === 'mysql' ? 'INT AUTO_INCREMENT' : 'serial')) : typeExp(c.type);
      const d = !serie && c.defaut && DEFAUT.test(c.defaut.replace(/::[\w ]+$/, '')) ? ` DEFAULT ${c.defaut.replace(/::[\w ]+$/, '')}` : '';
      return `  ${q(c.nom, dia)} ${type}${c.nul ? '' : ' NOT NULL'}${d}`;
    });
    if (pks.length) cols.push(`  PRIMARY KEY (${pks.join(', ')})`);
    lignes.push(`CREATE TABLE ${q(t.nom, dia)} (\n${cols.join(',\n')}\n);`);
    for (const i of t.index) if (!/_pkey$/.test(i.nom) && /^CREATE (UNIQUE )?INDEX/i.test(i.def)) { const m = /^CREATE (UNIQUE )?INDEX \S+ ON (?:ONLY )?\S+ USING \w+ \((.+)\)$/i.exec(i.def); if (m && /^[\w", ]+$/.test(m[2])) lignes.push(`CREATE ${m[1] ?? ''}INDEX ${q(i.nom, dia)} ON ${q(t.nom, dia)} (${m[2].split(',').map((x) => q(x.trim().replace(/"/g, ''), dia)).join(', ')});`); }
    lignes.push('');
  }
  for (const l of s.liens) lignes.push(`ALTER TABLE ${q(l.de, dia)} ADD FOREIGN KEY (${q(l.colonne, dia)}) REFERENCES ${q(l.vers, dia)} (${q(l.versColonne, dia)});`);
  return `${lignes.join('\n').trim()}\n`;
}

/** Le dictionnaire des données en Markdown. Pur. */
export function exportMarkdown(s: Schema, base: string): string {
  const cell = (t: string) => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const out = [`# Dictionnaire des données · ${cell(base)}`, '', `${s.tables.length} table(s), ${s.liens.length} lien(s).`, ''];
  for (const t of s.tables) {
    out.push(`## ${cell(t.nom)}`, '', `Environ ${t.lignes} ligne(s).`, '', '| Colonne | Type | Vide permis | Défaut | Clé | Lien |', '|---|---|---|---|---|---|');
    for (const c of t.colonnes) out.push(`| ${cell(c.nom)} | ${cell(c.type)} | ${c.nul ? 'oui' : 'non'} | ${cell(c.defaut ?? '')} | ${c.pk ? 'primaire' : ''} | ${c.ref ? `→ ${cell(c.ref.table)}.${cell(c.ref.colonne)}` : ''} |`);
    if (t.index.length) out.push('', `Index : ${t.index.map((i) => `\`${i.nom}\``).join(', ')}`);
    out.push('');
  }
  return out.join('\n');
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Le dessin du schéma en SVG (tables en boîtes, liens entre colonnes). Pur. */
export function exportSvg(s: Schema, pos: Positions, titre: string): string {
  const p = placer(s, pos), ys = (t: TableS, c: string) => p[t.nom].y + TETE + Math.max(0, t.colonnes.findIndex((k) => k.nom === c)) * LIGNE + LIGNE / 2;
  const W = Math.max(400, ...s.tables.map((t) => p[t.nom].x + LARGEUR + 20)), H = Math.max(200, ...s.tables.map((t) => p[t.nom].y + hauteur(t) + 20));
  const parNom = new Map(s.tables.map((t) => [t.nom, t]));
  const liens = s.liens.flatMap((l) => {
    const a = parNom.get(l.de), b = parNom.get(l.vers); if (!a || !b) return [];
    const x1 = p[a.nom].x + (p[b.nom].x >= p[a.nom].x ? LARGEUR : 0), x2 = p[b.nom].x + (p[b.nom].x >= p[a.nom].x ? 0 : LARGEUR), y1 = ys(a, l.colonne), y2 = ys(b, l.versColonne), m = (x1 + x2) / 2;
    return [`<path d="M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}" fill="none" stroke="#64748b" stroke-width="1.6" marker-end="url(#fl)"/>`];
  });
  const boites = s.tables.map((t) => {
    const { x, y } = p[t.nom], h = hauteur(t);
    return `<g><rect x="${x}" y="${y}" width="${LARGEUR}" height="${h}" rx="8" fill="#ffffff" stroke="#cbd5e1"/><rect x="${x}" y="${y}" width="${LARGEUR}" height="${TETE - 4}" rx="8" fill="#0f766e"/><text x="${x + 10}" y="${y + 20}" font-family="sans-serif" font-size="13" font-weight="700" fill="#ffffff">${esc(t.nom)}</text>${t.colonnes.map((c, i) => `<text x="${x + 10}" y="${y + TETE + i * LIGNE + 15}" font-family="monospace" font-size="11.5" fill="#0f172a">${c.pk ? '🔑 ' : c.ref ? '↗ ' : ''}${esc(c.nom)}</text><text x="${x + LARGEUR - 10}" y="${y + TETE + i * LIGNE + 15}" font-family="monospace" font-size="10.5" fill="#64748b" text-anchor="end">${esc(c.type.slice(0, 22))}${c.nul ? '' : ' *'}</text>`).join('')}</g>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n<title>${esc(titre)}</title>\n<defs><marker id="fl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#64748b"/></marker></defs>\n<rect width="${W}" height="${H}" fill="#f8fafc"/>\n${liens.join('\n')}\n${boites.join('\n')}\n</svg>\n`;
}
