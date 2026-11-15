// Alexandrie — le déménagement : avant, toutes les applis partageaient UNE base « odin » (un schéma par appli) ;
// maintenant chaque appli a SA base (PEGASE_ODIN, PERSONA_ODIN…). Au premier branchement d'une appli, ce qui était
// dans l'ancienne base est COPIÉ dans la sienne (même schéma, mêmes tables : ses migrations sont déjà passées),
// recompté, puis noté (`<schéma>._demenagement`) : le refaire ne double rien et ne recopie rien.
//
// Rien n'est perdu : l'ancienne base « odin » n'est jamais modifiée ni effacée (c'est la copie de secours, visible dans
// Alexandrie). Une copie incomplète n'est pas notée : elle sera reprise au prochain démarrage (lignes déjà là ignorées).
import { ident } from './noms.ts';
import type { Executeur } from './renommage.ts';

export const ANCIENNE_BASE = 'odin';
const EXCLUES = '{_migrations,_demenagement}';
const LOT = 1000;

export interface Demenagement { tables: string[]; lignes: number; deja?: boolean }

/**
 * Copie le schéma `schema` de l'ancienne base (`src`, connexion administrateur) vers la base de l'appli (`dst`).
 * `filtre` : seulement les lignes dont la colonne passe `garder` (les journaux d'une appli dans le journal commun).
 */
export async function demenager(src: Executeur, dst: Executeur, schema: string, o: { source?: string; filtre?: { colonne: string; garder(valeur: string): boolean } } = {}): Promise<Demenagement> {
  const s = ident(schema), source = o.source ?? ANCIENNE_BASE;
  await dst.simple(`CREATE TABLE IF NOT EXISTS ${s}._demenagement (source text PRIMARY KEY, lignes bigint NOT NULL, fait timestamptz NOT NULL DEFAULT now())`);
  if ((await dst.query(`SELECT lignes FROM ${s}._demenagement WHERE source = $1`, [source])).rows.length) return { tables: [], lignes: 0, deja: true };
  const noter = (n: number) => dst.query(`INSERT INTO ${s}._demenagement (source, lignes) VALUES ($1, $2) ON CONFLICT (source) DO NOTHING`, [source, n]);
  if (!(await src.query('SELECT 1 FROM information_schema.schemata WHERE schema_name = $1', [schema])).rows.length) { await noter(0); return { tables: [], lignes: 0 }; }
  const tablesDe = async (c: Executeur) => new Set((await c.query('SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = $2 AND table_name <> ALL($3::text[])', [schema, 'BASE TABLE', EXCLUES])).rows.map((r) => r[0]!));
  const colonnesDe = async (c: Executeur, t: string) => (await c.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position', [schema, t])).rows.map((r) => r[0]!);
  const ici = await tablesDe(dst), faites: string[] = []; let total = 0;
  for (const t of [...(await tablesDe(src))].sort()) {
    if (!ici.has(t)) continue; // une table que la nouvelle version n'a plus : laissée dans l'ancienne base
    const cs = await colonnesDe(src, t), cd = new Set(await colonnesDe(dst, t)), cols = cs.filter((c) => cd.has(c));
    if (!cols.length) continue;
    const q = `${s}.${ident(t)}`, liste = cols.map(ident).join(', ');
    const f = o.filtre && cs.includes(o.filtre.colonne) ? o.filtre : undefined;
    // Les valeurs de la colonne présentes dans l'ancienne base, gardées par le filtre (les noms des journaux de l'appli).
    const valeurs = f ? (await src.query(`SELECT DISTINCT ${ident(f.colonne)}::text FROM ${q}`)).rows.map((r) => r[0] ?? '').filter((v) => f.garder(v)) : [];
    if (f && !valeurs.length) continue;
    const ou = f ? ` WHERE ${ident(f.colonne)}::text = ANY($1::text[])` : '', pf = f ? [`{${valeurs.map((v) => `"${v.replace(/["\\]/g, '\\$&')}"`).join(',')}}`] : [];
    const avant = Number((await src.query(`SELECT count(*) FROM ${q}${ou}`, pf)).rows[0][0]);
    for (let n = 0; n < avant; n += LOT) {
      const lot = (await src.query(`SELECT json_agg(x)::text FROM (SELECT ${liste} FROM ${q}${ou} ORDER BY ctid LIMIT ${LOT} OFFSET ${n}) x`, pf)).rows[0][0];
      if (!lot) break;
      await dst.query(`INSERT INTO ${q} (${liste}) SELECT ${liste} FROM json_populate_recordset(NULL::${q}, $1::json) ON CONFLICT DO NOTHING`, [lot]);
    }
    // Les compteurs (bigserial) repartent après la plus grande valeur copiée.
    for (const [c] of (await dst.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_default LIKE $3', [schema, t, 'nextval(%'])).rows) {
      await dst.query(`SELECT setval(pg_get_serial_sequence($1, $2), GREATEST(COALESCE(max(${ident(c!)}), 0), 1)) FROM ${q}`, [`${s}.${ident(t)}`, c!]);
    }
    const apres = Number((await dst.query(`SELECT count(*) FROM ${q}${ou}`, pf)).rows[0][0]);
    if (apres < avant) throw new Error(`déménagement incomplet de ${schema}.${t} (${apres}/${avant}) : repris au prochain démarrage, l'ancienne base reste intacte`);
    faites.push(t); total += avant;
  }
  await noter(total);
  return { tables: faites, lignes: total };
}
