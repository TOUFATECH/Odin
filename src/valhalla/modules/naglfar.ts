// Naglfar — conteneurs : liste, démarrer, arrêter, journaux, piles (compose), images, volumes,
// réseaux, mises à jour d'images. Pilote Docker (ou Podman) de la machine d'Odin.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModCtx, Module } from '../types.ts';

const s = (v: unknown) => String(v ?? '');
const safe = (v: unknown) => { const x = s(v).trim(); if (!/^[\w.:/@-]{1,200}$/.test(x)) throw new Error(`nom invalide : ${x}`); return x; };
async function engine(ctx: ModCtx): Promise<string> { for (const e of ['docker', 'podman']) if (await ctx.has(e)) return e; throw new Error('ni Docker ni Podman sur cette machine (Odin peut l\'installer : demande « installe Docker »)'); }
export function parseLines<T = Record<string, string>>(out: string): T[] { return out.split('\n').map((l) => l.trim()).filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as T]; } catch { return []; } }); }
async function dk(ctx: ModCtx, args: string[], timeoutMs = 60_000) { const e = await engine(ctx); const r = await ctx.run(e, args, { timeoutMs }); if (r.code) throw new Error((r.err || r.out).trim().split('\n').pop() || `${e} a échoué`); return r.out; }
type Ct = { ID: string; Names: string; Image: string; State: string; Status: string; Ports: string; Labels?: string };
async function containers(ctx: ModCtx): Promise<Ct[]> { return parseLines<Ct>(await dk(ctx, ['ps', '-a', '--format', '{{json .}}'])); }
async function stats(ctx: ModCtx): Promise<Map<string, { cpu: string; mem: string }>> {
  try { return new Map(parseLines<{ Name: string; CPUPerc: string; MemUsage: string }>(await dk(ctx, ['stats', '--no-stream', '--format', '{{json .}}'], 20_000)).map((x) => [x.Name, { cpu: x.CPUPerc, mem: x.MemUsage.split('/')[0].trim() }])); } catch { return new Map(); }
}
/** Arrêt demandé par le propriétaire : la surveillance ne doit pas le prendre pour une panne. */
function forget(ctx: ModCtx, name: string): void { const was = (ctx.settings.running as string[] | undefined) ?? []; if (was.includes(name)) ctx.saveSettings({ running: was.filter((n) => n !== name) }); }
const pile = (c: Ct) => /com\.docker\.compose\.project=([^,]+)/.exec(c.Labels ?? '')?.[1] ?? '—';

export const naglfar: Module = {
  id: 'naglfar', name: 'Naglfar', family: 'Machines',
  what: 'Tes conteneurs : les voir, les démarrer, les arrêter, lire leurs journaux, déployer des piles et mettre à jour les images.',
  does: ['liste des conteneurs avec processeur et mémoire', 'démarrer, arrêter, redémarrer', 'journaux', 'déployer une pile (fichier compose)', 'mettre à jour une image et relancer', 'images, volumes, réseaux', 'nettoyage de ce qui ne sert plus (avec ton accord)', 'alerte si un conteneur important s\'arrête'],
  from: ['Portainer CE'], upstream: ['portainer/portainer'],
  words: ['conteneur', 'conteneurs', 'docker', 'podman', 'compose', 'pile', 'stack', 'image', 'images docker', 'volume'],
  actions: [
    { id: 'lister', label: 'Lister les conteneurs', what: 'Tous les conteneurs et leur état', read: true, words: ['liste', 'lister', 'quels conteneurs'], run: async (ctx) => { const c = await containers(ctx); return { text: c.map((x) => `- ${x.Names} · ${x.Image} · ${x.Status}`).join('\n') || 'Aucun conteneur.', data: c }; } },
    { id: 'journaux', label: 'Journaux', what: 'Les 80 dernières lignes', read: true, params: [{ key: 'conteneur', label: 'Conteneur', kind: 'text', required: true }], words: ['journaux', 'logs'], run: async (ctx, i) => { const e = await engine(ctx); const r = await ctx.run(e, ['logs', '--tail', '80', safe(i.conteneur)], { timeoutMs: 20_000 }); return { text: `${r.out}${r.err}`.trim().slice(-6000) || '(vide)' }; } },
    { id: 'demarrer', undo: (i) => ({ action: 'arreter', input: { conteneur: i.conteneur }, label: 'conteneur arrêté' }), label: 'Démarrer', what: 'Démarre un conteneur', params: [{ key: 'conteneur', label: 'Conteneur', kind: 'text', required: true }], words: ['demarre', 'démarre', 'lance'], run: async (ctx, i) => { await dk(ctx, ['start', safe(i.conteneur)]); return { text: `▶ ${s(i.conteneur)} démarré.` }; } },
    { id: 'arreter', undo: (i) => ({ action: 'demarrer', input: { conteneur: i.conteneur }, label: 'conteneur relancé' }), label: 'Arrêter', what: 'Arrête un conteneur', params: [{ key: 'conteneur', label: 'Conteneur', kind: 'text', required: true }], words: ['arrete', 'arrête', 'stop'], run: async (ctx, i) => { const n = safe(i.conteneur); await dk(ctx, ['stop', n]); forget(ctx, n); return { text: `■ ${n} arrêté.` }; } },
    { id: 'redemarrer', label: 'Redémarrer', what: 'Redémarre un conteneur', params: [{ key: 'conteneur', label: 'Conteneur', kind: 'text', required: true }], words: ['redemarre', 'redémarre', 'relance'], run: async (ctx, i) => { await dk(ctx, ['restart', safe(i.conteneur)]); return { text: `↻ ${s(i.conteneur)} redémarré.` }; } },
    { id: 'mettre_a_jour', label: 'Mettre à jour l\'image', what: 'Télécharge la dernière image puis recrée la pile', params: [{ key: 'conteneur', label: 'Conteneur', kind: 'text', required: true }], grave: (i) => `recréer ${s(i.conteneur)} avec une nouvelle image`, run: async (ctx, i) => {
      const c = (await containers(ctx)).find((x) => x.Names === s(i.conteneur)); if (!c) throw new Error('conteneur introuvable');
      await dk(ctx, ['pull', c.Image], 600_000);
      const p = pile(c);
      if (p !== '—') { await dk(ctx, ['compose', '-p', p, 'up', '-d'], 600_000); return { text: `⬆ ${c.Names} : image ${c.Image} à jour, pile ${p} relancée.` }; }
      return { text: `⬆ Image ${c.Image} téléchargée. Ce conteneur n'est pas dans une pile : redémarre-le depuis sa configuration pour l'utiliser.` };
    } },
    { id: 'deployer', label: 'Déployer une pile', what: 'Fichier compose → pile lancée', params: [{ key: 'nom', label: 'Nom de la pile', kind: 'text', required: true }, { key: 'compose', label: 'Fichier compose (YAML)', kind: 'textarea', required: true }], grave: (i) => `déployer la pile ${s(i.nom)}`, run: async (ctx, i) => {
      const name = safe(i.nom).replace(/[^\w-]/g, ''); const dir = join(ctx.dir, 'piles', name); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'compose.yaml'), s(i.compose));
      await dk(ctx, ['compose', '-p', name, '-f', join(dir, 'compose.yaml'), 'up', '-d'], 900_000);
      return { text: `🚢 Pile ${name} déployée.` };
    } },
    { id: 'supprimer', label: 'Supprimer un conteneur', what: 'Supprime un conteneur arrêté (ses volumes sont gardés)', params: [{ key: 'conteneur', label: 'Conteneur', kind: 'text', required: true }], grave: (i) => `supprimer le conteneur ${s(i.conteneur)}`, run: async (ctx, i) => { forget(ctx, safe(i.conteneur)); await dk(ctx, ['rm', safe(i.conteneur)]); return { text: `🗑 ${s(i.conteneur)} supprimé (volumes conservés).` }; } },
    { id: 'nettoyer', label: 'Nettoyer', what: 'Images et réseaux inutilisés', grave: () => 'supprimer les images et réseaux inutilisés', words: ['nettoie', 'place'], run: async (ctx) => { const o = await dk(ctx, ['system', 'prune', '-f'], 600_000); return { text: `🧹 ${o.trim().split('\n').pop()}` }; } },
  ],
  async view(ctx) {
    let cts: Ct[] = [], err = '';
    try { cts = await containers(ctx); } catch (e) { err = (e as Error).message; }
    const st = cts.length ? await stats(ctx) : new Map();
    const imgs = err ? [] : parseLines<{ Repository: string; Tag: string; Size: string }>(await dk(ctx, ['images', '--format', '{{json .}}']).catch(() => ''));
    const vols = err ? [] : parseLines<{ Name: string; Driver: string }>(await dk(ctx, ['volume', 'ls', '--format', '{{json .}}']).catch(() => ''));
    const up = cts.filter((c) => c.State === 'running').length;
    return {
      subtitle: err || `${up} en marche sur ${cts.length}`,
      tabs: ['Conteneurs', 'Piles', 'Images', 'Volumes'],
      kpis: [{ label: 'En marche', value: `${up} / ${cts.length}`, tone: up === cts.length ? 'bon' : 'attention' }, { label: 'Piles', value: String(new Set(cts.map(pile).filter((p) => p !== '—')).size) }, { label: 'Images', value: String(imgs.length) }, { label: 'Volumes', value: String(vols.length) }],
      sections: [
        { kind: 'table', title: 'Conteneurs', columns: ['Conteneur', 'Pile', 'Image', 'CPU', 'Mémoire', 'État'], empty: err || 'Aucun conteneur.', rows: cts.map((c) => ({ cells: [c.Names, pile(c), c.Image, st.get(c.Names)?.cpu ?? '—', st.get(c.Names)?.mem ?? '—', c.Status], tone: c.State === 'running' ? 'bon' : c.State === 'exited' && !/Exited \(0\)/.test(c.Status) ? 'mauvais' : 'neutre', actions: c.State === 'running' ? [{ action: 'journaux', label: 'Journaux', input: { conteneur: c.Names } }, { action: 'redemarrer', label: 'Redémarrer', input: { conteneur: c.Names } }, { action: 'arreter', label: 'Arrêter', input: { conteneur: c.Names } }] : [{ action: 'demarrer', label: 'Démarrer', input: { conteneur: c.Names } }, { action: 'journaux', label: 'Journaux', input: { conteneur: c.Names } }] })) },
        { kind: 'table', title: 'Images', columns: ['Image', 'Version', 'Taille'], rows: imgs.slice(0, 40).map((i) => ({ cells: [i.Repository, i.Tag, i.Size] })) },
      ],
      side: [{ kind: 'form', title: 'Déployer une pile', action: 'deployer', submit: 'Déployer', params: naglfar.actions.find((a) => a.id === 'deployer')!.params! }],
    };
  },
  watch: { every: 120, async run(ctx) {
    let cts: Ct[]; try { cts = await containers(ctx); } catch { return; }
    const was = (ctx.settings.running as string[] | undefined) ?? [];
    const now = cts.filter((c) => c.State === 'running').map((c) => c.Names);
    for (const n of was) if (!now.includes(n)) { const c = cts.find((x) => x.Names === n); ctx.alert({ level: 'haute', title: `Le conteneur « ${n} » s'est arrêté`, detail: c ? c.Status : 'disparu', key: `down:${n}` }); ctx.emit('conteneur_arrete', { conteneur: n }); }
    ctx.saveSettings({ running: now });
  } },
};
