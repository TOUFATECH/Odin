// Skuld — la sauvegarde de tes bases de données, comme Portabase : PostgreSQL, SQLite, MySQL / MariaDB,
// MongoDB ; plans (chaque heure, toutes les 6 h, chaque nuit, chaque semaine), durée de garde (jours,
// semaines, mois), chaque sauvegarde relue pour être sûre, historique, restauration avec ton accord
// (dans une nouvelle base à côté, conseillé, ou par-dessus après une sauvegarde de l'état actuel).
// Les bases viennent d'Urðr ; les archives restent sur la machine d'Odin (dossier protégé).
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bases, findBase, password, saveBases, setPassword, type Base } from '../urdr/bases.ts';
import { dump, extOf, keep, restore, verify, type Tools } from '../skuld/dump.ts';
import { engine } from './naglfar.ts';
import type { ModCtx, Module, Section } from '../types.ts';

const s = (v: unknown) => String(v ?? '').trim();
export type Every = 'heure' | '6h' | 'nuit' | 'semaine';
export interface Plan { base: string; toutes: Every; heure: number; garde: { jours: number; semaines: number; mois: number }; actif: boolean }
export interface Entry { at: string; base: string; ok: boolean; fichier?: string; taille?: number; verif?: string; erreur?: string; raison?: string; ms: number }

let tools: (ctx: ModCtx) => Tools = (ctx) => ({ inContainer: (ct, argv) => engine().execArgs(ct, argv), has: (c) => ctx.has(c) });
export function useTools(f: (ctx: ModCtx) => Tools) { tools = f; }

const plans = (ctx: ModCtx): Plan[] => (ctx.settings.plans as Plan[] | undefined) ?? [];
const archDir = (ctx: ModCtx, b: Base) => join(ctx.dir, 'archives', b.id);
const histFile = (ctx: ModCtx) => join(ctx.dir, 'historique.jsonl');
export function history(ctx: ModCtx, n = 200): Entry[] { try { return readFileSync(histFile(ctx), 'utf8').trim().split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l) as Entry).reverse(); } catch { return []; } }
function record(ctx: ModCtx, e: Entry) { mkdirSync(ctx.dir, { recursive: true, mode: 0o700 }); appendFileSync(histFile(ctx), JSON.stringify(e) + '\n', { mode: 0o600 }); }
const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const archives = (ctx: ModCtx, b: Base) => { const d = archDir(ctx, b); try { return readdirSync(d).filter((f) => !f.endsWith('.tmp')).sort().reverse().map((f) => ({ f, path: join(d, f), at: f.slice(0, 19).replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})$/, '$1:$2:$3') + 'Z', size: statSync(join(d, f)).size })); } catch { return []; } };
const mo = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} Go` : n > 1e6 ? `${(n / 1e6).toFixed(0)} Mo` : `${Math.max(1, Math.round(n / 1e3))} ko`);
const when = (e: Every, h: number) => ({ heure: 'chaque heure', '6h': 'toutes les 6 h', nuit: `chaque nuit à ${h} h`, semaine: `chaque dimanche à ${h} h` })[e];

/** La sauvegarde est-elle due ? (plan, dernière réussie, maintenant) */
export function due(p: Plan, last: Date | undefined, now: Date): boolean {
  if (!p.actif) return false; if (!last) return true;
  const age = now.getTime() - last.getTime(), h = 3600_000;
  if (p.toutes === 'heure') return age >= h - 60_000;
  if (p.toutes === '6h') return age >= 6 * h - 60_000;
  const atHour = now.getHours() === p.heure;
  if (p.toutes === 'nuit') return age >= 20 * h && atHour;
  return age >= 6 * 24 * h && atHour && now.getDay() === 0;
}

/** Sauvegarde, relit, applique la durée de garde ; note tout dans l'historique. */
export async function backupNow(ctx: ModCtx, b: Base, raison = 'à la main'): Promise<Entry> {
  const t0 = Date.now(), at = ctx.now(), dir = archDir(ctx, b); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${stamp(at)}.${extOf(b)}`), tmp = `${file}.tmp`;
  try {
    const t = tools(ctx); await dump(ctx.home, b, tmp, t);
    const v = await verify(b, tmp, t); renameSync(tmp, file);
    const e: Entry = { at: at.toISOString(), base: b.id, ok: true, fichier: file, taille: statSync(file).size, verif: v, raison, ms: Date.now() - t0 }; record(ctx, e);
    const p = plans(ctx).find((x) => x.base === b.id);
    if (p) { const all = archives(ctx, b), k = keep(all.map((a) => a.at), p.garde, at); for (const a of all) if (!k.has(a.at)) rmSync(a.path, { force: true }); }
    return e;
  } catch (err) { rmSync(tmp, { force: true }); const e: Entry = { at: at.toISOString(), base: b.id, ok: false, erreur: (err as Error).message, raison, ms: Date.now() - t0 }; record(ctx, e); return e; }
}
const pick = (ctx: ModCtx, b: Base, q: string) => { const l = archives(ctx, b); if (!l.length) throw new Error(`aucune sauvegarde de ${b.nom}`); if (!q) return l[0]; const a = l.find((x) => x.f.startsWith(q) || x.at.startsWith(q) || x.at.replace('T', ' ').startsWith(q)); if (!a) throw new Error(`sauvegarde introuvable : ${q} (la plus récente : ${l[0].at})`); return a; };

export const skuld: Module = {
  id: 'skuld', name: 'Skuld', family: 'Données',
  what: 'La sauvegarde de tes bases de données (comme Portabase) : plans, durée de garde, chaque sauvegarde relue, restauration avec ton accord.',
  does: ['PostgreSQL (pg_dump, dans le conteneur pour une base hébergée par Odin), SQLite (copie à chaud), MySQL / MariaDB (mysqldump), MongoDB (mongodump)', 'plans : chaque heure, toutes les 6 h, chaque nuit, chaque semaine', 'durée de garde : jours, puis une par semaine, puis une par mois', 'chaque sauvegarde est relue (base rouverte ou archive listée)', 'restaurer dans une nouvelle base à côté (conseillé) ou par-dessus, toujours avec ton accord', 'sauvegarde automatique avant toute requête Urðr qui modifie une base', 'alerte si une sauvegarde échoue'],
  from: ['Portabase'], upstream: ['Portabase/portabase'],
  words: ['sauvegarde de la base', 'sauvegarder la base', 'sauvegarde des bases', 'backup base', 'pg_dump', 'restaurer la base', 'portabase', 'skuld'],
  actions: [
    { id: 'sauvegarder', label: 'Sauvegarder maintenant', what: 'Sauvegarde une base tout de suite et relit la sauvegarde', params: [{ key: 'base', label: 'Base', kind: 'text', required: true }, { key: 'raison', label: 'Pourquoi', kind: 'text', default: 'à la main' }], words: ['sauvegarde la base', 'sauvegarde maintenant'], run: async (ctx, i) => {
      const b = findBase(ctx.home, s(i.base)), e = await backupNow(ctx, b, s(i.raison) || 'à la main');
      return e.ok ? { text: `💾 ${b.nom} sauvegardée (${mo(e.taille!)}, ${e.verif}).` } : { text: `❌ Sauvegarde de ${b.nom} impossible : ${e.erreur}`, ok: false };
    } },
    { id: 'plan', label: 'Planifier', what: 'Sauvegardes automatiques d\'une base et durée de garde', quick: false, params: [{ key: 'base', label: 'Base', kind: 'text', required: true }, { key: 'toutes', label: 'Quand', kind: 'select', options: ['nuit', 'heure', '6h', 'semaine'], default: 'nuit' }, { key: 'heure', label: 'Heure (nuit, semaine)', kind: 'number', default: 3 }, { key: 'jours', label: 'Garder tout pendant (jours)', kind: 'number', default: 7 }, { key: 'semaines', label: 'Puis une par semaine (semaines)', kind: 'number', default: 4 }, { key: 'mois', label: 'Puis une par mois (mois)', kind: 'number', default: 6 }, { key: 'actif', label: 'Actif', kind: 'boolean', default: true }], run: (ctx, i) => {
      const b = findBase(ctx.home, s(i.base)), toutes = (['heure', '6h', 'nuit', 'semaine'].includes(s(i.toutes)) ? s(i.toutes) : 'nuit') as Every, n = (v: unknown, d: number, max: number) => { const x = v === undefined || v === '' ? d : Math.floor(Number(v)); return Number.isFinite(x) ? Math.min(max, Math.max(0, x)) : d; };
      const p: Plan = { base: b.id, toutes, heure: Math.min(23, Math.max(0, Math.floor(Number(i.heure ?? 3)) || 0)), garde: { jours: n(i.jours, 7, 3650), semaines: n(i.semaines, 4, 520), mois: n(i.mois, 6, 240) }, actif: i.actif !== false && s(i.actif) !== 'false' };
      ctx.saveSettings({ plans: [...plans(ctx).filter((x) => x.base !== b.id), p] });
      return { text: `🗓 ${b.nom} : ${p.actif ? when(p.toutes, p.heure) : 'plan en pause'} · garde ${p.garde.jours} j, ${p.garde.semaines} sem., ${p.garde.mois} mois.` };
    } },
    { id: 'historique', label: 'Historique', what: 'Les dernières sauvegardes', read: true, params: [{ key: 'base', label: 'Base (vide : toutes)', kind: 'text', default: '' }], run: (ctx, i) => { const b = s(i.base) ? findBase(ctx.home, s(i.base)).id : ''; const h = history(ctx, 300).filter((e) => !b || e.base === b).slice(0, 30); return { text: h.map((e) => `${e.at.slice(0, 16).replace('T', ' ')} · ${e.base} · ${e.ok ? `✓ ${mo(e.taille ?? 0)} · ${e.verif}` : `✗ ${e.erreur}`}`).join('\n') || 'Aucune sauvegarde pour l\'instant.', data: h }; } },
    { id: 'archives', label: 'Sauvegardes gardées', what: 'Les sauvegardes encore présentes d\'une base', read: true, params: [{ key: 'base', label: 'Base', kind: 'text', required: true }], run: (ctx, i) => { const b = findBase(ctx.home, s(i.base)), l = archives(ctx, b); return { text: l.map((a) => `- ${a.at.slice(0, 16).replace('T', ' ')} · ${mo(a.size)}`).join('\n') || `Aucune sauvegarde de ${b.nom}.`, data: l.map((a) => ({ at: a.at, taille: a.size })) }; } },
    { id: 'restaurer', label: 'Restaurer', what: 'Restaure une sauvegarde : dans une nouvelle base à côté (conseillé) ou par-dessus (une sauvegarde de l\'état actuel est faite avant)', quick: false, params: [{ key: 'base', label: 'Base', kind: 'text', required: true }, { key: 'quand', label: 'Sauvegarde (date, vide : la plus récente)', kind: 'text', default: '' }, { key: 'ou', label: 'Où', kind: 'select', options: ['nouvelle base', 'par-dessus'], default: 'nouvelle base' }],
      grave: (i) => (s(i.ou) === 'par-dessus' ? `restaurer ${s(i.base)} PAR-DESSUS la base actuelle (sauvegarde ${s(i.quand) || 'la plus récente'})` : `restaurer ${s(i.base)} dans une nouvelle base (sauvegarde ${s(i.quand) || 'la plus récente'})`), run: async (ctx, i) => {
      const b = findBase(ctx.home, s(i.base)), a = pick(ctx, b, s(i.quand)), over = s(i.ou) === 'par-dessus', t = tools(ctx);
      if (over) { const pre = await backupNow(ctx, b, 'avant une restauration'); if (!pre.ok) throw new Error(`je n'écrase pas ${b.nom} sans sauvegarde de l'état actuel : ${pre.erreur}`); }
      const name = over ? (b.base ?? b.nom) : `${(b.base ?? b.id).replace(/[^\w]/g, '_')}_restauree_${a.at.slice(0, 10).replace(/-/g, '')}`.slice(0, 60);
      const file = b.type === 'sqlite' && !over ? join(dirname(b.fichier!), `${b.id}-restauree-${a.at.slice(0, 10)}.sqlite`) : undefined;
      if (file && existsSync(file)) throw new Error(`${file} existe déjà`);
      const got = await restore(ctx.home, b, a.path, { new: !over, name, file }, t);
      if (!over) { const l = bases(ctx.home); let id = `${b.id}-restauree`; while (l.some((x) => x.id === id)) id += '-2'; saveBases(ctx.home, [...l, { ...b, id, nom: `${b.nom} (restaurée ${a.at.slice(0, 10)})`, ...(file ? { fichier: file } : { base: name }), ajoutee: ctx.now().toISOString() }]); const pw = password(ctx.home, b.id); if (pw) setPassword(ctx.home, id, pw); }
      record(ctx, { at: ctx.now().toISOString(), base: b.id, ok: true, fichier: a.path, raison: over ? 'restaurée par-dessus' : `restaurée dans ${got}`, ms: 0 });
      return { text: over ? `♻ ${b.nom} restaurée par-dessus avec la sauvegarde du ${a.at.slice(0, 16).replace('T', ' ')} (l'état d'avant est sauvegardé).` : `♻ Sauvegarde du ${a.at.slice(0, 16).replace('T', ' ')} restaurée dans une nouvelle base : ${got}. Ouvre-la dans Urðr pour comparer.` };
    } },
  ],
  view(ctx) {
    const l = bases(ctx.home), h = history(ctx, 500), ps = plans(ctx);
    const last = (id: string) => h.find((e) => e.base === id), fails = l.filter((b) => last(b.id)?.ok === false).length;
    const sections: Section[] = [
      { kind: 'cards', title: 'Bases suivies', items: l.map((b) => { const p = ps.find((x) => x.base === b.id), e = last(b.id), arch = archives(ctx, b); return { title: b.nom, sub: `${({ postgres: 'PostgreSQL', sqlite: 'SQLite', mysql: 'MySQL / MariaDB', mongodb: 'MongoDB' })[b.type]} · ${p ? (p.actif ? `${when(p.toutes, p.heure)} · garde ${p.garde.jours} j · ${p.garde.semaines} sem. · ${p.garde.mois} mois` : 'plan en pause') : 'pas de plan'}`, badge: e ? (e.ok ? `ok · ${e.at.slice(5, 16).replace('T', ' ')}` : 'échec') : 'jamais', tone: e ? (e.ok ? 'bon' as const : 'mauvais' as const) : 'attention' as const, meta: `${arch.length} sauvegarde${arch.length > 1 ? 's' : ''} · ${mo(arch.reduce((n, a) => n + a.size, 0))}`, actions: [{ action: 'sauvegarder', label: 'Sauvegarder', input: { base: b.id } }, ...(arch.length ? [{ action: 'restaurer', label: 'Restaurer', input: { base: b.id, ou: 'nouvelle base' } }] : []), ...(p ? [] : [{ action: 'plan', label: 'Chaque nuit', input: { base: b.id, toutes: 'nuit' } }])] }; }), empty: 'Aucune base : ajoute-les dans Urðr (créer ou relier).' },
      { kind: 'table', title: 'Historique', columns: ['Quand', 'Base', 'État', 'Taille', 'Détail'], rows: h.slice(0, 20).map((e) => ({ cells: [e.at.slice(0, 16).replace('T', ' '), l.find((b) => b.id === e.base)?.nom ?? e.base, e.ok ? 'ok' : 'échec', e.taille ? mo(e.taille) : '—', e.ok ? `${e.verif ?? e.raison ?? ''}` : e.erreur ?? ''], tone: e.ok ? undefined : 'mauvais' as const })), empty: 'Aucune sauvegarde pour l\'instant.' },
    ];
    return { subtitle: 'Sauvegarde des bases de données', kpis: [{ label: 'Bases', value: String(l.length) }, { label: 'Avec un plan', value: String(ps.filter((p) => p.actif).length) }, { label: 'En échec', value: String(fails), tone: fails ? 'mauvais' : 'bon' }], sections };
  },
  watch: { every: 60, async run(ctx) {
    const now = ctx.now(), h = history(ctx, 2000);
    for (const p of plans(ctx)) {
      let b: Base; try { b = findBase(ctx.home, p.base); } catch { continue; }
      const lastOk = h.find((e) => e.base === b.id && e.ok && e.raison !== 'restaurée par-dessus'), lastTry = h.find((e) => e.base === b.id);
      if (!due(p, lastOk ? new Date(lastOk.at) : undefined, now)) continue;
      if (lastTry && !lastTry.ok && now.getTime() - Date.parse(lastTry.at) < 3600_000) continue; // un essai par heure après un échec
      const e = await backupNow(ctx, b, 'plan');
      if (!e.ok) ctx.alert({ level: 'haute', title: `💾 Sauvegarde de ${b.nom} ratée`, detail: e.erreur, key: `skuld-${b.id}`, steps: ['Regarde l\'erreur dans Skuld', 'Mot de passe changé ? redonne-le dans Urðr (« relier » à nouveau)', 'Puis « Sauvegarder maintenant »'], fix: { action: 'sauvegarder', label: 'Réessayer', input: { base: b.id } } });
    }
  } },
};
