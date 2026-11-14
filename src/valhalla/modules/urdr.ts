// Alexandrie — tes bases de données, comme Supabase, et Alexandrie Studio comme Prisma Studio.
// Bases PostgreSQL créées par Odin dans son moteur de conteneurs (Hringhorni), bases existantes reliées
// (PostgreSQL ; MySQL et MongoDB pour les sauvegardes de Arche ; zéro SQLite). Tables, colonnes, liens entre tables,
// lignes avec filtres, tri et pages ; une modification n'est écrite qu'avec ton accord ; SQL libre en lecture
// seule (la base elle-même refuse d'écrire), et tout ce qui écrit passe par ton accord avec une sauvegarde
// Arche juste avant. Chaque requête est notée dans le journal.
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { bases, findBase, open, saveBases, setPassword, slug, useHostOf, type Base, type Kind } from '../urdr/bases.ts';
import { isRead, OPS, type Filter, type Op, type Value } from '../urdr/db.ts';
import { engine } from './naglfar.ts';
import { databaseFor, serverBase, SERVER, SERVER_IP, PG_VERSION } from '../urdr/serveur.ts';
import type { ActionResult, ModCtx, Module, Param, Section } from '../types.ts';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { exportMarkdown, exportSql, exportSvg, lireSchema, placer, sqlDe, type Changement, type Positions } from '../urdr/schema.ts';

const s = (v: unknown) => String(v ?? '').trim();
export const PG_IMAGE = `postgres:${PG_VERSION}`;
const BASE: Param = { key: 'base', label: 'Base', kind: 'text', required: true };
const TABLE: Param = { key: 'table', label: 'Table', kind: 'text', required: true };
const json = <T>(v: unknown, d: T): T => { if (v && typeof v === 'object') return v as T; const t = s(v); if (!t) return d; try { return JSON.parse(t) as T; } catch { throw new Error(`format attendu : JSON (${t.slice(0, 40)}…)`); } };
const cell = (v: Value) => (v === null ? '∅' : v.length > 80 ? `${v.slice(0, 79)}…` : v);

// Une base hébergée par Odin : on la joint par l'IP de son conteneur sur le pont odin0 (rien n'est publié dehors).
useHostOf((b) => { try { const c = engine().find(b.conteneur!); if (c.state.status !== 'en marche') return undefined; return c.state.ip ? { host: c.state.ip, port: 5432 } : { host: '127.0.0.1', port: Number(c.spec.env.PGPORT ?? 5432) }; } catch { return undefined; } });

interface Entry { at: string; base: string; sql: string; ok: boolean; result: string; write: boolean; by?: string }
const journalFile = (ctx: ModCtx) => join(ctx.dir, 'journal.jsonl');
function note(ctx: ModCtx, e: Omit<Entry, 'at'>) { mkdirSync(ctx.dir, { recursive: true, mode: 0o700 }); appendFileSync(journalFile(ctx), JSON.stringify({ at: ctx.now().toISOString(), ...e, sql: e.sql.slice(0, 2000) }) + '\n', { mode: 0o600 }); }
export function journal(ctx: ModCtx, n = 50): Entry[] { try { return readFileSync(journalFile(ctx), 'utf8').trim().split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l) as Entry).reverse(); } catch { return []; } }

async function withDb<T>(ctx: ModCtx, name: string, f: (b: Base, d: Awaited<ReturnType<typeof open>>) => Promise<T>): Promise<T> {
  const b = findBase(ctx.home, name), d = await open(ctx.home, b);
  try { return await f(b, d); } finally { await d.close().catch(() => undefined); }
}
/** Sauvegarde Arche juste avant une écriture (si Arche sait faire pour cette base) ; un échec n'empêche pas, mais il est dit. */
async function before(ctx: ModCtx, b: Base): Promise<string> {
  try { const r = await ctx.call('skuld', 'sauvegarder', { base: b.id, raison: 'avant une modification' }, `sauvegarder ${b.nom} avant de la modifier`); return r.ok === false ? `⚠ sauvegarde avant modification impossible : ${r.text}` : '💾 sauvegarde faite juste avant.'; }
  catch (e) { return `⚠ sauvegarde avant modification impossible : ${(e as Error).message}`; }
}
// ---------------- Schéma dessiné (comme drawDB) : positions gardées par base, exports remis à l'appareil.
const positionsDe = (ctx: ModCtx, base: string): Positions => { try { return JSON.parse(readFileSync(join(ctx.dir, 'schemas', `${base.replace(/[^\w-]/g, '_')}.json`), 'utf8')) as Positions; } catch { return {}; } };
function exporter(ctx: ModCtx, nom: string, contenu: string | Buffer): { nom: string; ref: string } {
  const sous = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`, f = nom.replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 80) || 'export';
  mkdirSync(join(ctx.dir, 'exports', sous), { recursive: true }); writeFileSync(join(ctx.dir, 'exports', sous, f), contenu); return { nom, ref: `export:${sous}/${f}` };
}
const changementsDe = (v: unknown): Changement[] => { const l = json<Changement[]>(v, []); if (!Array.isArray(l) || !l.length) throw new Error('aucun changement à appliquer'); if (l.length > 200) throw new Error('trop de changements d\'un coup (200 au plus)'); return l; };
const table = (cols: string[], rows: Array<Array<Value>>, max = 30) => [cols.join(' | '), ...rows.slice(0, max).map((r) => r.map(cell).join(' | ')), ...(rows.length > max ? [`… ${rows.length - max} lignes de plus`] : [])].join('\n');

export const urdr: Module & { similaires: string[] } = {
  id: 'urdr', name: 'Alexandrie', family: 'Données',
  what: 'Tes bases de données comme Supabase : créer une base PostgreSQL, relier les tiennes, parcourir et modifier les tables comme un tableur (Alexandrie Studio, comme Prisma Studio), SQL avec journal.',
  does: ['créer une base PostgreSQL dans le moteur de conteneurs d\'Odin (mot de passe généré, rangé dans le coffre)', 'relier une base PostgreSQL existante (zéro SQLite)', 'tables, colonnes, clés et liens entre tables', 'lignes avec filtres, tri et pages (Alexandrie Studio)', 'modifier, ajouter ou supprimer une ligne avec ton accord', 'SQL en lecture seule garantie par la base ; ce qui écrit demande ton accord et Arche sauvegarde juste avant', 'journal de toutes les requêtes'],
  from: ['Supabase', 'Prisma Studio', 'drawDB'], upstream: ['supabase/supabase', 'prisma/studio'],
  similaires: ['Supabase', 'Prisma Studio', 'drawDB', 'pgAdmin', 'DBeaver'],
  words: ['base de donnees', 'base de données', 'bases de données', 'postgres', 'postgresql', 'sql', 'requete sql', 'requête sql', 'table', 'tables', 'supabase', 'prisma', 'studio', 'urdr', 'urðr'],
  actions: [
    { id: 'bases', label: 'Mes bases', what: 'La liste de tes bases', read: true, words: ['mes bases sql', 'mes bases postgres', 'quelles bases sql'], run: (ctx) => { const l = bases(ctx.home); return { text: l.map((b) => `- ${b.nom} · ${b.type}${b.conteneur ? ` · hébergée par Odin (${b.conteneur})` : ` · ${b.hote}:${b.port}/${b.base}`}`).join('\n') || 'Aucune base pour l\'instant : « crée une base » ou « relie une base ».', data: l }; } },
    { id: 'relier', label: 'Relier une base', what: 'Ajoute une base existante (essai de connexion avant) ; le mot de passe va dans le coffre', quick: false, params: [
      { key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'type', label: 'Type', kind: 'select', options: ['postgres', 'mysql', 'mongodb'], default: 'postgres' },
      { key: 'hote', label: 'Adresse', kind: 'text', default: '127.0.0.1' }, { key: 'port', label: 'Port', kind: 'number', default: 5432 }, { key: 'utilisateur', label: 'Utilisateur', kind: 'text', default: 'postgres' },
      { key: 'mot_de_passe', label: 'Mot de passe', kind: 'password' }, { key: 'base', label: 'Nom de la base', kind: 'text', default: 'postgres' },
      { key: 'ssl', label: 'Chiffrement', kind: 'select', options: ['si-possible', 'obligatoire', 'non'], default: 'si-possible' }], run: async (ctx, i) => {
      const type = (s(i.type) || 'postgres') as Kind; if (!['postgres', 'mysql', 'mongodb'].includes(type)) throw new Error(type === ('sqlite' as Kind) ? 'zéro SQLite dans Odin : passe la base en PostgreSQL (Alexandrie t\'en crée une)' : 'type inconnu');
      const nom = s(i.nom); if (!nom) throw new Error('quel nom ?'); const l = bases(ctx.home); if (l.some((b) => b.nom.toLowerCase() === nom.toLowerCase())) throw new Error(`${nom} existe déjà`);
      let id = slug(nom); while (l.some((b) => b.id === id)) id = `${id}-${randomBytes(2).toString('hex')}`;
      const b: Base = { id, nom, type, hote: s(i.hote) || '127.0.0.1', port: Number(i.port) || ({ postgres: 5432, mysql: 3306, mongodb: 27017 } as Record<string, number>)[type], utilisateur: s(i.utilisateur) || undefined, base: s(i.base) || undefined, ssl: (s(i.ssl) || 'si-possible') as Base['ssl'], ajoutee: ctx.now().toISOString() };
      const pw = s(i.mot_de_passe);
      if (pw) setPassword(ctx.home, id, pw);
      let tables = 0;
      if (type === 'postgres') { try { const d = await open(ctx.home, b); tables = (await d.tables()).length; await d.close(); } catch (e) { setPassword(ctx.home, id, undefined); throw new Error(`connexion impossible : ${(e as Error).message}`); } }
      saveBases(ctx.home, [...l, b]);
      if (pw) await ctx.call('brisingamen', 'ajouter', { nom: `Base · ${nom}`, identifiant: b.utilisateur ?? '', mot_de_passe: pw, site: `${b.hote}:${b.port}`, coffre: 'TOUFATECH' }, `ranger le mot de passe de la base ${nom}`).catch(() => undefined);
      return { text: `🗄 ${nom} reliée${type === 'postgres' ? ` (${tables} tables)` : ' (sauvegardes par Arche)'}.${pw ? ' Mot de passe rangé dans le coffre.' : ''}` };
    } },
    { id: 'creer', label: 'Créer une base', what: 'Une nouvelle base dans LA base de données d\'Odin (PostgreSQL, créée la première fois), avec son propre compte ; mot de passe dans le coffre ; sauvegarde chaque nuit par Arche', quick: false, params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }],
      grave: (i, ctx) => `créer la base ${s(i.nom)}${ctx && !serverBase(ctx.home) ? ` (et la base de données d'Odin : un conteneur ${PG_IMAGE}, la première fois)` : ''}`, words: ['cree une base', 'crée une base', 'nouvelle base'], run: async (ctx, i) => {
      const nom = s(i.nom); if (!nom) throw new Error('quel nom ?');
      const e = engine();
      const j = e.startJob('installer', PG_IMAGE, async (report) => {
        report({ phase: 'démarrer', done: 0, total: 1 }, serverBase(ctx.home) ? 'Base d\'Odin : vérification' : 'Base d\'Odin : création (la première fois)');
        const r = await databaseFor(ctx.home, e, nom, 'postgres');
        await ctx.call('brisingamen', 'ajouter', { nom: `Base · ${nom}`, identifiant: r.info.user, mot_de_passe: r.info.password, site: 'Base d\'Odin (odin-pg)', coffre: 'TOUFATECH' }, `ranger le mot de passe de la base ${nom}`).catch(() => undefined);
        await ctx.call('skuld', 'plan', { base: r.base.id, toutes: 'nuit', heure: 3 }, `sauvegarder chaque nuit la base ${nom}`).catch(() => undefined);
        if (r.serverCreated) await ctx.call('skuld', 'plan', { base: SERVER, toutes: 'nuit', heure: 2 }, 'sauvegarder chaque nuit la base d\'Odin entière').catch(() => undefined);
        return { note: `Base « ${r.info.database} » ${r.created ? 'créée' : 'déjà là'} dans la base d'Odin · sauvegardée chaque nuit` };
      }, `base ${nom}`);
      return { text: `🗄 Base ${nom} en préparation dans la base de données d'Odin${serverBase(ctx.home) ? '' : ' (créée la première fois : quelques minutes)'} : suis-la dans Argo. Mot de passe généré et rangé dans le coffre, sauvegarde chaque nuit.`, data: { job: j.id } };
    } },
    { id: 'acces', label: 'Accès d\'une appli', what: 'Ce qu\'une appli doit utiliser pour joindre sa base (le mot de passe reste dans le coffre)', read: true, params: [BASE], run: (ctx, i) => { const b = findBase(ctx.home, s(i.base)); return { text: b.conteneur ? `${b.nom} : hôte ${b.conteneur === SERVER ? `${SERVER} (${SERVER_IP})` : b.conteneur}, port 5432, base ${b.base}, compte ${b.utilisateur} ; mot de passe dans le coffre (« Base · ${b.nom} »).` : `${b.nom} : ${b.hote}:${b.port}/${b.base}, compte ${b.utilisateur ?? '—'}.` }; } },
    { id: 'oublier', label: 'Retirer de la liste', what: 'Retire une base de la liste d\'Alexandrie (la base elle-même et ses données ne sont pas touchées)', params: [BASE], quick: false, run: (ctx, i) => { const b = findBase(ctx.home, s(i.base)); saveBases(ctx.home, bases(ctx.home).filter((x) => x.id !== b.id)); setPassword(ctx.home, b.id, undefined); return { text: `${b.nom} retirée de la liste (données intactes${b.conteneur ? `, conteneur ${b.conteneur} toujours là` : ''}).` }; } },
    { id: 'ouvrir', label: 'Ouvrir', what: 'Ouvre une base (et une table) dans la page d\'Alexandrie', read: true, quiet: true, params: [BASE, { ...TABLE, required: false }], run: (ctx, i) => { const b = findBase(ctx.home, s(i.base)); ctx.saveSettings({ courante: { base: b.id, table: s(i.table) || undefined, page: 0, filtres: [] } }); return { text: `📂 ${b.nom}${s(i.table) ? ` · ${s(i.table)}` : ''}` }; } },
    { id: 'tables', label: 'Tables', what: 'Les tables d\'une base, leurs lignes et leurs liens', read: true, params: [BASE], words: ['quelles tables'], run: (ctx, i) => withDb(ctx, s(i.base), async (b, d) => { const t = await d.tables(), r = await d.relations(); return { text: `${b.nom} : ${t.length} tables\n${t.map((x) => `- ${x.name} (${x.rows} lignes)`).join('\n')}${r.length ? `\nLiens :\n${r.map((x) => `- ${x.from}.${x.column} → ${x.to}.${x.toColumn}`).join('\n')}` : ''}`, data: { tables: t, liens: r } }; }) },
    { id: 'colonnes', label: 'Colonnes', what: 'Les colonnes d\'une table (type, clé, lien)', read: true, params: [BASE, TABLE], run: (ctx, i) => withDb(ctx, s(i.base), async (_b, d) => { const c = await d.columns(s(i.table)); return { text: c.map((x) => `- ${x.name} · ${x.type}${x.pk ? ' · clé' : ''}${x.nullable ? '' : ' · obligatoire'}${x.ref ? ` · → ${x.ref.table}.${x.ref.column}` : ''}`).join('\n'), data: c }; }) },
    { id: 'lignes', label: 'Lignes', what: 'Les lignes d\'une table, avec filtres, tri et pages', read: true, external: true, params: [BASE, TABLE, { key: 'filtres', label: 'Filtres (JSON : [{"col":"ville","op":"=","value":"Mamoudzou"}])', kind: 'text', default: '' }, { key: 'tri', label: 'Trier par', kind: 'text', default: '' }, { key: 'sens', label: 'Sens', kind: 'select', options: ['asc', 'desc'], default: 'asc' }, { key: 'page', label: 'Page', kind: 'number', default: 1 }, { key: 'par_page', label: 'Lignes par page', kind: 'number', default: 25 }], run: (ctx, i) => withDb(ctx, s(i.base), async (_b, d) => {
      const filters = json<Filter[]>(i.filtres, []), per = Math.min(500, Math.max(1, Number(i.par_page) || 25)), page = Math.max(1, Number(i.page) || 1);
      for (const f of filters) if (!OPS.includes(f.op as Op)) throw new Error(`opérateur inconnu : ${f.op} (${OPS.join(', ')})`);
      const r = await d.rows(s(i.table), { filters, sort: s(i.tri) || undefined, dir: s(i.sens) === 'desc' ? 'desc' : 'asc', limit: per, offset: (page - 1) * per });
      return { text: `${r.total} lignes · page ${page} / ${Math.max(1, Math.ceil(r.total / per))}\n${table(r.columns, r.rows)}`, data: r };
    }) },
    { id: 'modifier', label: 'Modifier une ligne', what: 'Écrit les cases modifiées d\'une ligne (repérée par sa clé)', quick: false, params: [BASE, TABLE, { key: 'cle', label: 'Clé (JSON : {"id":"126"})', kind: 'text', required: true }, { key: 'changements', label: 'Changements (JSON : {"ville":"Chirongui"})', kind: 'textarea', required: true }],
      grave: (i) => { const c = (() => { try { return Object.keys(json<Record<string, Value>>(i.changements, {})); } catch { return []; } })(); return `modifier ${c.length > 1 ? `${c.length} cases` : `la case ${c[0] ?? '?'}`} de ${s(i.table)} (${s(i.cle)}) dans ${s(i.base)}`; }, run: (ctx, i) => withDb(ctx, s(i.base), async (b, d) => {
      const key = json<Record<string, Value>>(i.cle, {}), ch = json<Record<string, Value>>(i.changements, {});
      const n = await d.update(s(i.table), key, ch); note(ctx, { base: b.nom, sql: `UPDATE ${s(i.table)} SET ${Object.keys(ch).join(', ')} WHERE ${JSON.stringify(key)}`, ok: true, result: `${n} ligne`, write: true });
      return { text: n ? `✏ ${s(i.table)} : ${n} ligne modifiée.` : 'Aucune ligne trouvée avec cette clé (déjà supprimée ?).', ok: n > 0 };
    }) },
    { id: 'ajouter_ligne', label: 'Ajouter une ligne', what: 'Ajoute une ligne (les cases vides prennent leur valeur par défaut)', quick: false, params: [BASE, TABLE, { key: 'valeurs', label: 'Valeurs (JSON : {"nom":"Awa"})', kind: 'textarea', default: '{}' }],
      grave: (i) => `ajouter une ligne dans ${s(i.table)} (${s(i.base)})`, run: (ctx, i) => withDb(ctx, s(i.base), async (b, d) => { const v = json<Record<string, Value>>(i.valeurs, {}); const n = await d.insert(s(i.table), v); note(ctx, { base: b.nom, sql: `INSERT INTO ${s(i.table)} (${Object.keys(v).join(', ')})`, ok: true, result: `${n} ligne`, write: true }); return { text: `➕ Ligne ajoutée dans ${s(i.table)}.` }; }) },
    { id: 'supprimer_ligne', label: 'Supprimer une ligne', what: 'Supprime une ligne (repérée par sa clé) ; Arche sauvegarde la base juste avant', quick: false, params: [BASE, TABLE, { key: 'cle', label: 'Clé (JSON)', kind: 'text', required: true }],
      grave: (i) => `supprimer la ligne ${s(i.cle)} de ${s(i.table)} (${s(i.base)})`, run: (ctx, i) => withDb(ctx, s(i.base), async (b, d) => { const save = await before(ctx, b); const n = await d.remove(s(i.table), json<Record<string, Value>>(i.cle, {})); note(ctx, { base: b.nom, sql: `DELETE FROM ${s(i.table)} WHERE ${s(i.cle)}`, ok: true, result: `${n} ligne`, write: true }); return { text: `🗑 ${n} ligne supprimée de ${s(i.table)}. ${save}` }; }) },
    { id: 'sql', label: 'Lancer du SQL', what: 'Une instruction SQL : une lecture passe tout de suite (la base refuse d\'écrire) ; ce qui modifie demande ton accord, avec une sauvegarde Arche juste avant', params: [BASE, { key: 'requete', label: 'Requête', kind: 'textarea', required: true }], external: true,
      grave: (i) => (isRead(s(i.requete)) ? undefined : `lancer sur ${s(i.base)} une requête qui modifie la base : ${s(i.requete).slice(0, 160)}`), words: ['lance la requete', 'requete sql'], run: (ctx, i) => withDb(ctx, s(i.base), async (b, d): Promise<ActionResult> => {
      const q = s(i.requete), write = !isRead(q); let save = '';
      if (write) save = await before(ctx, b);
      try {
        const r = await d.sql(q, write); note(ctx, { base: b.nom, sql: q, ok: true, result: r.columns.length ? `${r.rows.length} lignes · ${r.ms} ms` : `${r.command} · ${r.ms} ms`, write });
        return { text: `${r.columns.length ? table(r.columns, r.rows) : r.command}\n(${r.ms} ms)${save ? `\n${save}` : ''}`, data: r };
      } catch (e) { note(ctx, { base: b.nom, sql: q, ok: false, result: (e as Error).message, write }); return { text: `❌ ${(e as Error).message}`, ok: false }; }
    }) },
    { id: 'schema_base', label: 'Schéma de la base', what: 'Les tables, colonnes, clés, liens et index d\'une base, avec leur place sur le dessin', read: true, params: [BASE], words: ['schema de la base', 'dessine la base'], run: (ctx, i) => withDb(ctx, s(i.base), async (b, d) => {
      const sc = await lireSchema(d), pos = placer(sc, positionsDe(ctx, b.id));
      return { text: `${b.nom} : ${sc.tables.length} table(s), ${sc.liens.length} lien(s)\n${sc.tables.map((t) => `- ${t.nom} (${t.colonnes.map((c) => `${c.nom}${c.pk ? ' 🔑' : ''}${c.ref ? ` → ${c.ref.table}.${c.ref.colonne}` : ''}`).join(', ')})`).join('\n')}`, data: { base: b.id, schema: sc, positions: pos } };
    }) },
    { id: 'placer_tables', label: 'Garder la place des tables', what: 'Les positions des tables sur le dessin (envoyées par la page)', quick: false, quiet: true, params: [BASE, { key: 'positions', label: 'Positions (JSON)', kind: 'textarea', required: true }], run: (ctx, i) => {
      const b = findBase(ctx.home, s(i.base)), p = json<Positions>(i.positions, {}), propre: Positions = {};
      for (const [k, v] of Object.entries(p).slice(0, 500)) if (k.length <= 130 && Number.isFinite(v?.x) && Number.isFinite(v?.y)) propre[k] = { x: Math.max(0, Math.min(20000, Math.round(v.x))), y: Math.max(0, Math.min(20000, Math.round(v.y))) };
      mkdirSync(join(ctx.dir, 'schemas'), { recursive: true }); writeFileSync(join(ctx.dir, 'schemas', `${b.id.replace(/[^\w-]/g, '_')}.json`), JSON.stringify(propre));
      return { text: `📌 Place de ${Object.keys(propre).length} table(s) gardée.` };
    } },
    { id: 'sql_schema', label: 'SQL des changements', what: 'Le SQL qui ferait les changements dessinés (table, colonne, lien) : rien n\'est lancé', read: true, quick: false, params: [BASE, { key: 'changements', label: 'Changements (JSON)', kind: 'textarea', required: true }, { key: 'dialecte', label: 'Pour', kind: 'select', options: ['postgres', 'mysql'], default: 'postgres' }], run: (ctx, i) => withDb(ctx, s(i.base), async (_b, d) => {
      const sql = sqlDe(changementsDe(i.changements), await lireSchema(d), s(i.dialecte) === 'mysql' ? 'mysql' : 'postgres');
      return { text: sql.join('\n\n'), data: { sql } };
    }) },
    { id: 'appliquer_schema', label: 'Appliquer les changements du schéma', what: 'Lance le SQL des changements dessinés, d\'un seul bloc (tout ou rien), après une sauvegarde Arche', quick: false, params: [BASE, { key: 'changements', label: 'Changements (JSON)', kind: 'textarea', required: true }],
      grave: (i) => { let n = 0; try { n = changementsDe(i.changements).length; } catch { /* dit plus loin */ } return `modifier la structure de la base ${s(i.base)} (${n} changement(s) : tables, colonnes ou liens ajoutés)`; },
      run: (ctx, i) => withDb(ctx, s(i.base), async (b, d): Promise<ActionResult> => {
        let sql: string[]; try { sql = sqlDe(changementsDe(i.changements), await lireSchema(d)); } catch (e) { return { ok: false, text: `Rien n'est lancé : ${(e as Error).message}.` }; }
        const save = await before(ctx, b);
        try { await d.sql('BEGIN', true); for (const q of sql) await d.sql(q, true); await d.sql('COMMIT', true); }
        catch (e) { await d.sql('ROLLBACK', true).catch(() => undefined); note(ctx, { base: b.nom, sql: sql.join('\n'), ok: false, result: (e as Error).message, write: true }); return { ok: false, text: `❌ La base a refusé : ${(e as Error).message}. Rien n'a été changé (tout ou rien).${save ? `\n${save}` : ''}` }; }
        note(ctx, { base: b.nom, sql: sql.join('\n'), ok: true, result: `${sql.length} changement(s) du schéma`, write: true });
        return { text: `✅ ${sql.length} changement(s) appliqué(s) à ${b.nom} :\n${sql.join('\n')}${save ? `\n${save}` : ''}`, data: { sql } };
      }) },
    { id: 'exporter_schema', label: 'Exporter le schéma', what: 'Le schéma en SQL (PostgreSQL ou MySQL), en image (SVG, PNG) ou en dictionnaire des données (Markdown), à télécharger', read: true, quick: false, params: [BASE, { key: 'format', label: 'Format', kind: 'select', options: ['sql-postgres', 'sql-mysql', 'svg', 'png', 'markdown'], default: 'sql-postgres' }], run: (ctx, i) => withDb(ctx, s(i.base), async (b, d): Promise<ActionResult> => {
      const sc = await lireSchema(d), f = s(i.format) || 'sql-postgres', base = b.nom.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'base';
      if (f === 'markdown') { const m = exportMarkdown(sc, b.nom); return { text: `📘 Dictionnaire des données de ${b.nom}.`, fichiers: [exporter(ctx, `${base} - dictionnaire.md`, m)], data: { contenu: m } }; }
      if (f === 'svg' || f === 'png') {
        const svg = exportSvg(sc, positionsDe(ctx, b.id), `Schéma de ${b.nom}`);
        if (f === 'svg') return { text: `🖼 Schéma de ${b.nom} en SVG.`, fichiers: [exporter(ctx, `${base} - schéma.svg`, svg)], data: { contenu: svg } };
        const tmp = join(ctx.dir, 'exports', `rendu-${randomBytes(3).toString('hex')}`); mkdirSync(join(ctx.dir, 'exports'), { recursive: true }); writeFileSync(`${tmp}.svg`, svg);
        try { for (const [cmd, args] of [['rsvg-convert', ['-o', `${tmp}.png`, `${tmp}.svg`]], ['convert', [`${tmp}.svg`, `${tmp}.png`]]] as Array<[string, string[]]>) { if (!await ctx.has(cmd)) continue; const r = await ctx.run(cmd, args, { timeoutMs: 60_000 }); if (r.code === 0 && existsSync(`${tmp}.png`)) return { text: `🖼 Schéma de ${b.nom} en PNG.`, fichiers: [exporter(ctx, `${base} - schéma.png`, readFileSync(`${tmp}.png`))] }; } }
        finally { rmSync(`${tmp}.svg`, { force: true }); rmSync(`${tmp}.png`, { force: true }); }
        return { ok: false, text: 'Aucun programme pour faire un PNG ici (rsvg-convert ou ImageMagick) : prends le SVG, ou installe « librsvg2-bin ».' };
      }
      const dia = f === 'sql-mysql' ? 'mysql' : 'postgres', sql = exportSql(sc, dia);
      return { text: `🧾 Schéma de ${b.nom} en SQL ${dia === 'mysql' ? 'MySQL' : 'PostgreSQL'}.`, fichiers: [exporter(ctx, `${base} - schéma ${dia}.sql`, sql)], data: { contenu: sql } };
    }) },
    { id: 'journal', label: 'Journal des requêtes', what: 'Les dernières requêtes lancées', read: true, run: (ctx) => { const l = journal(ctx, 30); return { text: l.map((e) => `${e.at.slice(0, 16).replace('T', ' ')} · ${e.base} · ${e.ok ? '✓' : '✗'} ${e.result} · ${e.sql.slice(0, 100)}`).join('\n') || 'Journal vide.', data: l }; } },
  ],
  async view(ctx) {
    const l = bases(ctx.home), cur = ctx.settings.courante as { base?: string; table?: string; page?: number; filtres?: Filter[] } | undefined;
    const sections: Section[] = [{ kind: 'cards', title: 'Tes bases', items: l.map((b) => ({ title: b.nom, sub: `${({ postgres: 'PostgreSQL', mysql: 'MySQL / MariaDB', mongodb: 'MongoDB' })[b.type]}${b.version ? ` ${b.version}` : ''} · ${b.conteneur ? 'hébergée par Odin' : `${b.hote}:${b.port}`}`, badge: b.id === cur?.base ? 'ouverte' : undefined, tone: 'neutre' as const, actions: [{ action: 'ouvrir', label: 'Ouvrir', input: { base: b.id } }, { action: 'sauvegarder', label: 'Sauvegarder', input: { base: b.id }, module: 'skuld' }] })), empty: 'Aucune base : « Créer une base PostgreSQL » ou « Relier une base ».' }];
    const kpis = [{ label: 'Bases', value: String(l.length) }, { label: 'Requêtes (24 h)', value: String(journal(ctx, 1000).filter((e) => Date.parse(e.at) > ctx.now().getTime() - 864e5).length) }];
    const b = cur?.base ? l.find((x) => x.id === cur.base) : undefined;
    if (b && b.type === 'postgres') {
      try {
        await withDb(ctx, b.id, async (_b, d) => {
          const t = await d.tables(); kpis.push({ label: `Tables de ${b.nom}`, value: String(t.length) });
          sections.push({ kind: 'table', title: `${b.nom} · tables`, columns: ['Table', 'Lignes'], rows: t.map((x) => ({ cells: [x.name, String(x.rows)], tone: x.name === cur?.table ? 'bon' as const : undefined, actions: [{ action: 'ouvrir', label: 'Voir', input: { base: b.id, table: x.name } }] })), empty: 'Aucune table.' });
          if (cur?.table && t.some((x) => x.name === cur.table)) {
            const r = await d.rows(cur.table, { filters: cur.filtres ?? [], limit: 25, offset: (cur.page ?? 0) * 25 });
            sections.push({ kind: 'table', title: `Studio · ${cur.table} (${r.total} lignes)`, columns: r.columns, rows: r.rows.map((row) => ({ cells: row.map(cell), actions: r.key.every((k) => r.columns.includes(k)) ? [{ action: 'supprimer_ligne', label: 'Supprimer', input: { base: b.id, table: cur.table!, cle: JSON.stringify(Object.fromEntries(r.key.map((k) => [k, row[r.columns.indexOf(k)]]))) } }] : [] })), empty: 'Table vide.' });
          }
        });
      } catch (e) { sections.push({ kind: 'text', title: b.nom, text: `Connexion impossible : ${(e as Error).message}`, tone: 'mauvais' }); }
      sections.push({ kind: 'form', title: 'SQL', action: 'sql', params: [{ ...BASE, default: b.id }, { key: 'requete', label: 'Requête', kind: 'textarea', required: true, default: cur?.table ? `select * from ${cur.table} limit 20` : 'select now()' }], submit: 'Lancer' });
    }
    const side: Section[] = [{ kind: 'log', title: 'Journal des requêtes', lines: journal(ctx, 15).map((e) => `${e.at.slice(11, 16)} ${e.ok ? '✓' : '✗'} ${e.base} · ${e.sql.slice(0, 60)} → ${e.result}`) }];
    return { subtitle: 'Bases de données · Studio · SQL', kpis, sections, side };
  },
  /** Un export du schéma (dans le dossier des exports d'Alexandrie seulement). */
  retrait(ctx, ref) {
    if (!ref.startsWith('export:')) return undefined;
    const rep = join(ctx.dir, 'exports'), f = resolve(rep, ref.slice(7)); if (!f.startsWith(resolve(rep) + sep)) return undefined;
    try { const v = realpathSync(f); return v.startsWith(realpathSync(rep) + sep) ? v : undefined; } catch { return undefined; }
  },
};
