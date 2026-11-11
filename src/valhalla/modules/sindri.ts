// Sindri — le forgeron des sauvegardes : un seul moteur pour tout sauvegarder (dossiers, Saga, Odin,
// partages des PC du foyer en mode « Hvergelmir », exports de machines virtuelles en mode « Andvari »).
// Chiffré (AES-256-GCM) avant d'écrire, dédupliqué (un même morceau n'est stocké qu'une fois),
// instantanés datés, rétention (jours, semaines, mois), restauration et vérification.

import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, openSync, readSync, closeSync, utimesSync, chmodSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { ModCtx, Module } from '../types.ts';
import { walk } from './ullr.ts';

const CHUNK = 1024 * 1024;
export interface FileEntry { path: string; size: number; mtime: number; mode: number; chunks: string[] }
export interface Snapshot { id: string; at: string; plan: string; paths: string[]; files: FileEntry[]; bytes: number; added: number }
export interface Plan { name: string; paths: string[]; repo: string; at: string; keep: { last: number; daily: number; weekly: number; monthly: number }; /** machines virtuelles à figer (instantané Ymir) avant la sauvegarde */ vms?: number[]; exclude?: string[] }

export class Repo {
  readonly root: string; private key: Buffer; private mac: Buffer;
  constructor(root: string, password: string) {
    this.root = root;
    mkdirSync(join(root, 'data'), { recursive: true }); mkdirSync(join(root, 'snapshots'), { recursive: true });
    const cf = join(root, 'config');
    let salt: Buffer;
    if (existsSync(cf)) { const c = JSON.parse(readFileSync(cf, 'utf8')); salt = Buffer.from(c.salt, 'hex'); this.derive(password, salt); if (this.check(Buffer.from(c.check, 'base64')) !== 'sindri') throw new Error('mot de passe du dépôt incorrect'); }
    else { salt = randomBytes(16); this.derive(password, salt); writeFileSync(cf, JSON.stringify({ v: 1, salt: salt.toString('hex'), check: this.seal(Buffer.from('sindri')).toString('base64') })); }
    this.key ??= Buffer.alloc(0); this.mac ??= Buffer.alloc(0);
  }
  private derive(pw: string, salt: Buffer) { const k = scryptSync(pw, salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); this.key = k.subarray(0, 32); this.mac = k.subarray(32); }
  private check(b: Buffer): string { try { return this.open(b).toString(); } catch { return ''; } }
  seal(plain: Buffer): Buffer { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', this.key, iv); const z = gzipSync(plain, { level: 6 }); const body = Buffer.concat([c.update(z), c.final()]); return Buffer.concat([iv, c.getAuthTag(), body]); }
  open(b: Buffer): Buffer { const d = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return gunzipSync(Buffer.concat([d.update(b.subarray(28)), d.final()])); }
  /** Identifiant d'un morceau : empreinte à clé (on ne peut pas deviner le contenu à partir du nom). */
  id(plain: Buffer): string { return createHmac('sha256', this.mac).update(plain).digest('hex'); }
  private chunkPath(id: string) { return join(this.root, 'data', id.slice(0, 2), id); }
  has(id: string) { return existsSync(this.chunkPath(id)); }
  put(plain: Buffer): { id: string; added: boolean } { const id = this.id(plain); if (this.has(id)) return { id, added: false }; mkdirSync(dirname(this.chunkPath(id)), { recursive: true }); const tmp = `${this.chunkPath(id)}.tmp`; writeFileSync(tmp, this.seal(plain)); renameSync(tmp, this.chunkPath(id)); return { id, added: true }; }
  get(id: string): Buffer { return this.open(readFileSync(this.chunkPath(id))); }
  saveSnapshot(s: Snapshot) { writeFileSync(join(this.root, 'snapshots', s.id), this.seal(Buffer.from(JSON.stringify(s)))); }
  snapshots(): Snapshot[] { return readdirSync(join(this.root, 'snapshots')).filter((f) => !f.endsWith('.oublié')).map((f) => JSON.parse(this.open(readFileSync(join(this.root, 'snapshots', f))).toString()) as Snapshot).sort((a, b) => b.at.localeCompare(a.at)); }
  forget(id: string) { renameSync(join(this.root, 'snapshots', id), join(this.root, 'snapshots', `${id}.oublié`)); }
}

export function backup(repo: Repo, plan: Pick<Plan, 'name' | 'paths' | 'exclude'>, now = new Date()): Snapshot {
  const files: FileEntry[] = []; let bytes = 0, added = 0;
  const ex = (plan.exclude ?? []).map((x) => new RegExp(x));
  for (const root of plan.paths) for (const f of walk(resolve(root))) {
    if (ex.some((r) => r.test(f))) continue;
    let st; try { st = statSync(f); } catch { continue; }
    const chunks: string[] = []; let fd: number;
    try { fd = openSync(f, 'r'); } catch { continue; }
    try { const buf = Buffer.alloc(CHUNK); let n: number; while ((n = readSync(fd, buf, 0, CHUNK, null)) > 0) { const r = repo.put(Buffer.from(buf.subarray(0, n))); chunks.push(r.id); if (r.added) added += n; } } finally { closeSync(fd); }
    files.push({ path: f, size: st.size, mtime: st.mtimeMs, mode: st.mode & 0o777, chunks }); bytes += st.size;
  }
  const s: Snapshot = { id: `${now.toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`, at: now.toISOString(), plan: plan.name, paths: plan.paths, files, bytes, added };
  repo.saveSnapshot(s);
  return s;
}
export function restore(repo: Repo, snap: Snapshot, target: string, filter = ''): number {
  let n = 0;
  for (const f of snap.files) {
    if (filter && !f.path.includes(filter)) continue;
    const out = join(target, relative('/', f.path)); mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.concat(f.chunks.map((c) => repo.get(c))));
    try { chmodSync(out, f.mode); utimesSync(out, new Date(f.mtime), new Date(f.mtime)); } catch { /* droits */ }
    n++;
  }
  return n;
}
export function verify(repo: Repo, snap: Snapshot): { ok: number; bad: string[] } { const bad: string[] = []; let ok = 0; for (const id of new Set(snap.files.flatMap((f) => f.chunks))) { try { repo.get(id); ok++; } catch { bad.push(id); } } return { ok, bad }; }
/** Rétention : garde les N derniers, puis un par jour, semaine, mois. Renvoie les instantanés à oublier. */
export function toForget(snaps: Snapshot[], keep: Plan['keep']): Snapshot[] {
  const sorted = [...snaps].sort((a, b) => b.at.localeCompare(a.at)), kept = new Set<string>();
  sorted.slice(0, keep.last).forEach((s) => kept.add(s.id));
  const bucket = (fmt: (d: Date) => string, n: number) => { const seen = new Set<string>(); for (const s of sorted) { const k = fmt(new Date(s.at)); if (seen.size >= n) break; if (!seen.has(k)) { seen.add(k); kept.add(s.id); } } };
  bucket((d) => d.toISOString().slice(0, 10), keep.daily);
  bucket((d) => { const t = new Date(d); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); }, keep.weekly);
  bucket((d) => d.toISOString().slice(0, 7), keep.monthly);
  return sorted.filter((s) => !kept.has(s.id));
}

const s = (v: unknown) => String(v ?? '');
const plans = (ctx: ModCtx): Plan[] => (ctx.settings.plans as Plan[] | undefined) ?? [];
function repoOf(ctx: ModCtx, path: string): Repo { const pw = process.env.SINDRI_PASSWORD; if (!pw) throw new Error('mot de passe des sauvegardes absent : range-le dans le coffre (SINDRI_PASSWORD)'); return new Repo(path, pw); }
const human = (b: number) => { const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${Math.round(b * 10) / 10} ${u[i]}`; };
async function runPlan(ctx: ModCtx, p: Plan): Promise<string> {
  // Mode Andvari (lien Sindri → Ymir) : un instantané de chaque machine virtuelle du plan, juste avant la sauvegarde.
  const vmNotes: string[] = [];
  for (const vmid of p.vms ?? []) { const r = await ctx.call('ymir', 'instantane', { vmid, nom: `sindri-${ctx.now().toISOString().slice(0, 10).replace(/-/g, '')}` }, `avant la sauvegarde « ${p.name} »`).catch((e) => ({ ok: false, text: (e as Error).message })); vmNotes.push(`${r.ok === false ? '✗' : '✓'} machine ${vmid}`); }
  const repo = repoOf(ctx, p.repo), t0 = Date.now(), snap = backup(repo, p, ctx.now());
  const old = toForget(repo.snapshots().filter((x) => x.plan === p.name), p.keep); for (const o of old) repo.forget(o.id);
  const last = { at: ctx.now().toISOString(), ok: true, files: snap.files.length, bytes: snap.bytes, added: snap.added, ms: Date.now() - t0 };
  ctx.saveSettings({ last: { ...((ctx.settings.last as Record<string, unknown>) ?? {}), [p.name]: last } });
  ctx.emit('sauvegarde_ok', { plan: p.name, fichiers: snap.files.length, octets: snap.bytes });
  return `💾 ${p.name} : ${snap.files.length} fichiers (${human(snap.bytes)}), ${human(snap.added)} de nouveau, en ${Math.round((Date.now() - t0) / 1000)} s.${old.length ? ` ${old.length} ancien(s) instantané(s) retiré(s).` : ''}${vmNotes.length ? ` Instantanés des machines virtuelles : ${vmNotes.join(', ')}.` : ''}`;
}

export const sindri: Module = {
  id: 'sindri', name: 'Sindri', family: 'Machines',
  what: 'Les sauvegardes : chiffrées, dédupliquées, planifiées, vérifiées, et la restauration d\'un fichier ou de tout.',
  does: ['sauvegarde chiffrée (AES-256) avant d\'écrire quoi que ce soit', 'déduplication : un morceau identique n\'est stocké qu\'une fois', 'plans planifiés (heure par jour) avec rétention (derniers, jours, semaines, mois)', 'dépôts sur disque USB, partage réseau ou serveur monté', 'restauration d\'un fichier, d\'un dossier ou de tout', 'vérification de l\'intégrité chaque semaine', 'mode Hvergelmir : partages des PC du foyer', 'mode Andvari : exports de machines virtuelles', 'alerte si une sauvegarde échoue ou prend du retard'],
  from: ['Restic', 'UrBackup', 'Proxmox Backup Server'], upstream: ['restic/restic', 'uroni/urbackup_backend', 'proxmox/proxmox-backup'],
  modes: ['Hvergelmir · PC du foyer', 'Andvari · machines virtuelles'],
  words: ['sauvegarde', 'sauvegardes', 'sauvegarder', 'backup', 'restaurer', 'restauration', 'récupérer un fichier', 'recuperer', 'instantane', 'instantané', 'archive'],
  actions: [
    { id: 'plans', label: 'Plans de sauvegarde', what: 'Ce qui est sauvegardé, où et quand', read: true, words: ['plans', 'quoi est sauvegarde'], run: (ctx) => { const l = (ctx.settings.last as Record<string, { at: string; ok: boolean; files: number }>) ?? {}; return { text: plans(ctx).map((p) => `- ${p.name} : ${p.paths.join(', ')} → ${p.repo} · chaque jour à ${p.at} · dernière : ${l[p.name] ? `${l[p.name].ok ? '✓' : '✗'} ${l[p.name].at.slice(0, 16).replace('T', ' ')}` : 'jamais'}`).join('\n') || 'Aucun plan.' }; } },
    { id: 'creer', label: 'Nouveau plan', what: 'Quoi, où, quand', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'dossiers', label: 'Dossiers (un par ligne)', kind: 'textarea', required: true }, { key: 'depot', label: 'Dépôt (dossier de destination)', kind: 'text', required: true }, { key: 'heure', label: 'Heure', kind: 'text', default: '02:00' }], run: (ctx, i) => {
      const p: Plan = { name: s(i.nom), paths: s(i.dossiers).split('\n').map((x) => x.trim()).filter(Boolean), repo: s(i.depot).trim(), at: /^\d\d:\d\d$/.test(s(i.heure)) ? s(i.heure) : '02:00', keep: { last: 3, daily: 7, weekly: 4, monthly: 12 } };
      for (const d of p.paths) if (!existsSync(d)) throw new Error(`dossier introuvable : ${d}`);
      repoOf(ctx, p.repo);
      ctx.saveSettings({ plans: [...plans(ctx).filter((x) => x.name !== p.name), p] });
      return { text: `🗓 Plan « ${p.name} » : chaque jour à ${p.at}, ${p.paths.length} dossier(s) → ${p.repo}.` };
    } },
    { id: 'machines', label: 'Machines virtuelles du plan (Andvari)', what: 'Avant chaque sauvegarde de ce plan, Ymir prend un instantané de ces machines virtuelles', params: [{ key: 'plan', label: 'Plan', kind: 'text', required: true }, { key: 'vms', label: 'Numéros des machines (séparés par des virgules ; vide = aucune)', kind: 'text', default: '' }], run: (ctx, i) => {
      const p = plans(ctx).find((x) => x.name === s(i.plan)); if (!p) throw new Error('plan inconnu');
      const vms = s(i.vms).split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 1e9);
      ctx.saveSettings({ plans: plans(ctx).map((x) => (x.name === p.name ? { ...x, vms } : x)) });
      return { text: vms.length ? `🧊 Plan « ${p.name} » : instantané des machines ${vms.join(', ')} avant chaque sauvegarde.` : `Plan « ${p.name} » : plus d'instantané de machine virtuelle.` };
    } },
    { id: 'sauvegarder', label: 'Sauvegarder maintenant', what: 'Lance un plan tout de suite', params: [{ key: 'plan', label: 'Plan', kind: 'text', required: true }], words: ['sauvegarde maintenant', 'lance la sauvegarde'], run: async (ctx, i) => { const p = plans(ctx).find((x) => x.name === s(i.plan)) ?? plans(ctx)[0]; if (!p) throw new Error('aucun plan'); return { text: await runPlan(ctx, p) }; } },
    { id: 'instantanes', label: 'Instantanés', what: 'Les versions disponibles d\'un plan', read: true, params: [{ key: 'plan', label: 'Plan', kind: 'text' }], run: (ctx, i) => { const p = plans(ctx).find((x) => x.name === s(i.plan)) ?? plans(ctx)[0]; if (!p) return { text: 'Aucun plan.' }; const l = repoOf(ctx, p.repo).snapshots().filter((x) => x.plan === p.name); return { text: l.map((x) => `- ${x.id} · ${x.at.slice(0, 16).replace('T', ' ')} · ${x.files.length} fichiers · ${human(x.bytes)}`).join('\n') || 'Aucun instantané.', data: l.map((x) => ({ id: x.id, at: x.at, files: x.files.length })) }; } },
    { id: 'chercher', label: 'Chercher un fichier', what: 'Dans quelles versions se trouve un fichier', read: true, params: [{ key: 'nom', label: 'Nom ou bout de chemin', kind: 'text', required: true }], words: ['retrouve', 'retrouver', 'version d hier', 'ancien'], run: (ctx, i) => { const out: string[] = []; for (const p of plans(ctx)) for (const sn of repoOf(ctx, p.repo).snapshots()) for (const f of sn.files) if (f.path.includes(s(i.nom))) out.push(`- ${sn.at.slice(0, 16).replace('T', ' ')} · ${f.path} (${human(f.size)}) · instantané ${sn.id}`); return { text: out.slice(0, 40).join('\n') || 'Introuvable dans les sauvegardes.' }; } },
    { id: 'restaurer', label: 'Restaurer', what: 'Remet des fichiers d\'un instantané dans un dossier (jamais par-dessus sans ton accord)', params: [{ key: 'instantane', label: 'Instantané', kind: 'text', required: true }, { key: 'filtre', label: 'Seulement les chemins contenant', kind: 'text' }, { key: 'vers', label: 'Restaurer dans', kind: 'text', default: '' }], grave: (i) => (s(i.vers) === '/' ? 'restaurer par-dessus les fichiers actuels' : undefined), run: (ctx, i) => {
      for (const p of plans(ctx)) { const repo = repoOf(ctx, p.repo); const sn = repo.snapshots().find((x) => x.id === s(i.instantane)); if (sn) { const to = s(i.vers) || join(ctx.dir, 'restaurés', sn.id); const n = restore(repo, sn, to, s(i.filtre)); return { text: `↩ ${n} fichier(s) restauré(s) dans ${to}.` }; } }
      throw new Error('instantané introuvable');
    } },
    { id: 'verifier', label: 'Vérifier', what: 'Relit et déchiffre le dernier instantané de chaque plan', read: true, run: (ctx) => { const out: string[] = []; for (const p of plans(ctx)) { const repo = repoOf(ctx, p.repo); const sn = repo.snapshots().find((x) => x.plan === p.name); if (!sn) continue; const v = verify(repo, sn); out.push(`${v.bad.length ? '✗' : '✓'} ${p.name} : ${v.ok} morceaux lisibles${v.bad.length ? `, ${v.bad.length} ABÎMÉS` : ''}`); if (v.bad.length) ctx.alert({ level: 'critique', title: `Sauvegarde ${p.name} abîmée`, detail: `${v.bad.length} morceaux illisibles`, key: `verify:${p.name}` }); } return { text: out.join('\n') || 'Aucun plan.' }; } },
  ],
  view(ctx) {
    const l = (ctx.settings.last as Record<string, { at: string; ok: boolean; files: number; bytes: number; added: number; error?: string }>) ?? {};
    const ps = plans(ctx), late = ps.filter((p) => !l[p.name] || Date.now() - Date.parse(l[p.name].at) > 36 * 3600_000);
    return {
      subtitle: process.env.SINDRI_PASSWORD ? 'Tout est chiffré avant de partir.' : '⚠ Range d\'abord un mot de passe de sauvegarde dans le coffre (SINDRI_PASSWORD).',
      tabs: ['Sindri · dossiers', 'Hvergelmir · PC du foyer', 'Andvari · machines virtuelles'],
      kpis: [{ label: 'Plans', value: String(ps.length) }, { label: 'En retard', value: String(late.length), tone: late.length ? 'attention' : 'bon' }, { label: 'Dernière réussie', value: Object.values(l).filter((x) => x.ok).sort((a, b) => b.at.localeCompare(a.at))[0]?.at.slice(0, 16).replace('T', ' ') ?? '—' }],
      sections: [{ kind: 'table', title: 'Plans', columns: ['Plan', 'Dossiers', 'Dépôt', 'Quand', 'Dernière'], empty: 'Aucun plan : crée-en un à droite.', rows: ps.map((p) => ({ cells: [p.name, p.paths.join(', '), p.repo, `chaque jour ${p.at}`, l[p.name] ? `${l[p.name].ok ? '✓' : '✗'} ${l[p.name].at.slice(5, 16).replace('T', ' ')} · ${human(l[p.name].bytes ?? 0)}` : 'jamais'], tone: !l[p.name] ? 'attention' : l[p.name].ok ? 'bon' : 'mauvais', actions: [{ action: 'sauvegarder', label: 'Maintenant', input: { plan: p.name } }, { action: 'instantanes', label: 'Versions', input: { plan: p.name } }] })) }],
      side: [{ kind: 'form', title: 'Nouveau plan', action: 'creer', submit: 'Créer', params: sindri.actions[1].params! }, { kind: 'form', title: 'Retrouver un fichier', action: 'chercher', submit: 'Chercher', params: sindri.actions[4].params! }],
    };
  },
  watch: { every: 60, async run(ctx) {
    const now = ctx.now(), hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const l = (ctx.settings.last as Record<string, { at: string }>) ?? {};
    for (const p of plans(ctx)) {
      if (p.at === hm && (!l[p.name] || now.getTime() - Date.parse(l[p.name].at) > 3600_000)) {
        try { await runPlan(ctx, p); } catch (e) { ctx.saveSettings({ last: { ...l, [p.name]: { at: now.toISOString(), ok: false, error: (e as Error).message } } }); ctx.alert({ level: 'haute', title: `Sauvegarde « ${p.name} » échouée`, detail: (e as Error).message, key: `fail:${p.name}` }); ctx.emit('sauvegarde_echec', { plan: p.name, erreur: (e as Error).message }); }
      } else if (l[p.name] && now.getTime() - Date.parse(l[p.name].at) > 50 * 3600_000) ctx.alert({ level: 'haute', title: `Sauvegarde « ${p.name} » en retard`, detail: `Dernière : ${l[p.name].at.slice(0, 16).replace('T', ' ')}`, key: `late:${p.name}` });
    }
    if (now.getDay() === 0 && hm === '04:30') await Promise.resolve(sindri.actions[6].run(ctx, {})).catch(() => undefined);
  } },
};
