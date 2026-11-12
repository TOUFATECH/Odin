// Naglfar — tes conteneurs, sur le moteur d'Odin (Hringhorni) : sans Docker, sans Podman, sans démon.
// Lancer une appli à partir d'une image Docker, la voir, la démarrer, l'arrêter, lire son journal, lancer une
// commande dedans, la mettre à jour, la supprimer (avec ton accord). Les mêmes commandes que dans un terminal
// marchent aussi dans la discussion : « run -d -p 8080:80 nginx », « ps », « logs web », « stop web »…
import { Engine, restartOf, type Ctr } from '../hringhorni/engine.ts';
import { cli, parseArgs, splitLine, psTable, VALUES, VERBS } from '../hringhorni/cli.ts';
import { defineService, removeService, services, startService, stopService, tuneService } from '../hringhorni/services.ts';
import { bytes, cgStat, human, load, vertical, type CgStat } from '../hringhorni/scale.ts';
import { join } from 'node:path';
import { databaseFor, needsDb } from '../urdr/serveur.ts';
import type { ModCtx, Module, Param } from '../types.ts';

const s = (v: unknown) => String(v ?? '');
const safe = (v: unknown) => { const x = s(v).trim(); if (!/^[\w.:/@-]{1,200}$/.test(x)) throw new Error(`nom invalide : ${x}`); return x; };
/** Le moteur (remplaçable dans les essais). */
export type EngineLike = Pick<Engine, 'ps' | 'find' | 'start' | 'stop' | 'restart' | 'rm' | 'run' | 'logs' | 'images' | 'pull' | 'rmi' | 'execArgs' | 'inspect' | 'findImage' | 'jobs' | 'runJob' | 'pullJob' | 'startJob' | 'resize'>;
let make: () => EngineLike = () => new Engine();
let cached: EngineLike | null = null;
export function useEngine(f: () => EngineLike): void { make = f; cached = null; }
export const engine = (): EngineLike => (cached ??= make());

/** Arrêt demandé par le propriétaire : la surveillance ne doit pas le prendre pour une panne. */
function forget(ctx: ModCtx, name: string): void { const was = (ctx.settings.running as string[] | undefined) ?? []; if (was.includes(name)) ctx.saveSettings({ running: was.filter((n) => n !== name) }); }
const line = (c: Ctr) => `- ${c.spec.name} · ${c.spec.image} · ${c.state.status}${c.spec.ports.length ? ` · ${c.spec.ports.map((p) => `${p.host}→${p.inner}`).join(', ')}` : ''}`;
const CT: Param = { key: 'conteneur', label: 'Conteneur', kind: 'text', required: true };
const LANCER: Param[] = [
  { key: 'image', label: 'Image (ex. jellyfin/jellyfin:10.11.1)', kind: 'text', required: true },
  { key: 'nom', label: 'Nom (vide : nom automatique dk-…)', kind: 'text', default: '' },
  { key: 'ports', label: 'Ports (8096:8096, 7359:7359/udp)', kind: 'text', default: '' },
  { key: 'dossiers', label: 'Dossiers (/data/jf:/config, /media:/media:ro)', kind: 'text', default: '' },
  { key: 'env', label: 'Variables (une par ligne : CLE=valeur)', kind: 'textarea', default: '' },
  { key: 'redemarrage', label: 'Redémarrage', kind: 'select', options: ['unless-stopped', 'always', 'on-failure', 'no'], default: 'unless-stopped' },
  { key: 'memoire', label: 'Mémoire max (2g)', kind: 'text', default: '' },
  { key: 'coeurs', label: 'Cœurs max', kind: 'text', default: '' },
  { key: 'base', label: 'Base de données', kind: 'select', options: ['selon l\'appli', 'PostgreSQL d\'Odin', 'aucune'], default: 'selon l\'appli' },
];
/** Une commande « comme dans un terminal » : grave ou pas selon ce qu'elle fait. */
export function graveOf(lineText: string): string | undefined {
  const [v, ...rest] = splitLine(lineText); const verb = (v ?? '').toLowerCase();
  if (verb === 'run') return `lancer un conteneur (${rest.filter((x) => !x.startsWith('-')).slice(-1)[0] ?? 'image'})`;
  if (verb === 'rm') return `supprimer le conteneur ${rest.filter((x) => !x.startsWith('-')).join(', ')}`;
  if (verb === 'rmi') return `supprimer l'image ${rest.filter((x) => !x.startsWith('-')).join(', ')}`;
  if (verb === 'exec') return `lancer une commande dans ${rest.filter((x) => !x.startsWith('-'))[0] ?? 'un conteneur'}`;
  if (verb === 'service' && ['create', 'run'].includes(rest[0] ?? '')) return `créer un service mis à l'échelle (${rest.filter((x) => !x.startsWith('-')).slice(-1)[0] ?? 'image'})`;
  if (verb === 'service' && ['rm', 'stop'].includes(rest[0] ?? '')) return `${rest[0] === 'rm' ? 'supprimer' : 'arrêter'} le service ${rest[1] ?? ''} (le site ne répond plus)`;
  return undefined;
}
const env = (t: string) => Object.fromEntries(t.split('\n').map((l) => l.trim()).filter((l) => /^[A-Za-z_]\w*=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

export const naglfar: Module = {
  id: 'naglfar', name: 'Naglfar', family: 'Machines',
  what: 'Tes conteneurs, sur le moteur d\'Odin (sans Docker ni Podman, sans démon) : lancer une appli depuis une image Docker, la suivre, l\'arrêter, lire son journal, la mettre à jour.',
  does: ['lancer une appli à partir d\'une image Docker (Docker Hub, GHCR, Quay…)', 'liste des conteneurs, démarrer, arrêter, redémarrer', 'journal de chaque conteneur', 'lancer une commande dedans', 'mettre à jour l\'image et relancer avec les mêmes réglages', 'images présentes, nettoyage', 'les commandes run, ps, stop, start, rm, logs, exec, pull, images aussi dans la discussion', 'ports publiés, dossiers partagés, limites de mémoire et de processeur, relance automatique'],
  from: ['Portainer CE', 'Podman'], upstream: [],
  words: ['conteneur', 'conteneurs', 'docker', 'podman', 'image', 'images docker', 'hringhorni', 'moteur de conteneurs'],
  actions: [
    { id: 'lister', label: 'Lister les conteneurs', what: 'Tous les conteneurs et leur état', read: true, words: ['liste', 'lister', 'quels conteneurs'], run: async () => { const c = engine().ps(true); return { text: c.map(line).join('\n') || 'Aucun conteneur.', data: c.map((x) => ({ Names: x.spec.name, Image: x.spec.image, State: x.state.status === 'en marche' ? 'running' : 'exited', Status: x.state.status, Ports: x.spec.ports.map((p) => `${p.host}->${p.inner}`).join(', '), Labels: '' })) }; } },
    { id: 'journaux', label: 'Journaux', what: 'Les 80 dernières lignes', read: true, params: [CT], words: ['journaux', 'logs'], run: async (_ctx, i) => ({ text: engine().logs(safe(i.conteneur), 80).map((l) => l.text).join('\n') || '(journal vide)' }) },
    { id: 'demarrer', undo: (i) => ({ action: 'arreter', input: { conteneur: i.conteneur }, label: 'conteneur arrêté' }), label: 'Démarrer', what: 'Démarre un conteneur', params: [CT], words: ['demarre', 'démarre', 'lance le conteneur'], run: async (ctx, i) => { const c = await engine().start(safe(i.conteneur)); ctx.saveSettings({ running: [...new Set([...((ctx.settings.running as string[]) ?? []), c.spec.name])] }); return { text: `▶ ${c.spec.name} démarré.` }; } },
    { id: 'arreter', undo: (i) => ({ action: 'demarrer', input: { conteneur: i.conteneur }, label: 'conteneur relancé' }), label: 'Arrêter', what: 'Arrête un conteneur', params: [CT], words: ['arrete', 'arrête', 'stoppe'], run: async (ctx, i) => { forget(ctx, safe(i.conteneur)); const c = await engine().stop(safe(i.conteneur)); return { text: `⏹ ${c.spec.name} arrêté.` }; } },
    { id: 'redemarrer', label: 'Redémarrer', what: 'Redémarre un conteneur', params: [CT], words: ['redemarre', 'redémarre', 'relance'], run: async (_ctx, i) => { const c = await engine().restart(safe(i.conteneur)); return { text: `🔄 ${c.spec.name} redémarré.` }; } },
    { id: 'lancer', label: 'Lancer une appli', what: 'Récupère l\'image si besoin, crée le conteneur et le démarre ; une appli qui a besoin d\'une base la reçoit dans la base d\'Odin', params: LANCER, grave: (i) => `lancer un conteneur à partir de ${s(i.image)}${(s(i.base) && !/selon/.test(s(i.base)) ? !/aucune/i.test(s(i.base)) : needsDb(s(i.image))) ? ' (avec sa base dans la base de données d\'Odin)' : ''}`, words: ['lance l\'image', 'installe le conteneur'], run: async (ctx, i) => {
      const image = safe(i.image), name = s(i.nom).trim() || undefined;
      const opts = { image, name, ports: s(i.ports), mounts: s(i.dossiers), env: env(s(i.env)), restart: restartOf(s(i.redemarrage) || 'unless-stopped'), memory: s(i.memoire).trim() || undefined, cpus: s(i.coeurs).trim() || undefined };
      const wantDb = s(i.base) && !/selon/.test(s(i.base)) ? !/^(aucune|non|no)$/i.test(s(i.base)) : needsDb(image);
      const e = engine();
      // Avec base : le serveur d'Odin (créé si besoin), la base de l'appli et ses variables, puis l'appli ; sauvegarde chaque nuit.
      const j = !wantDb ? e.runJob(opts) : e.startJob('installer', image, async (report, set) => {
        if (!e.findImage(image)) await e.pull(image, () => {}, (p) => report(p));
        report({ phase: 'démarrer', done: 0, total: 1 }, 'Préparation de sa base (base de données d\'Odin)');
        const app = name ?? image.split('/').pop()!.split(':')[0];
        const db = await databaseFor(ctx.home, e, app, image);
        report({ phase: 'démarrer', done: 1, total: 1 });
        const c = await e.run({ ...opts, env: { ...db.env, ...opts.env } }); set({ name: c.spec.name });
        await ctx.call('brisingamen', 'ajouter', { nom: `Base · ${c.spec.name}`, identifiant: db.info.user, mot_de_passe: db.info.password, site: 'Base d\'Odin (odin-pg)', coffre: 'TOUFATECH' }, `ranger le mot de passe de la base de ${c.spec.name}`).catch(() => undefined);
        await ctx.call('skuld', 'plan', { base: db.base.id, toutes: 'nuit', heure: 3 }, `sauvegarder chaque nuit la base de ${c.spec.name}`).catch(() => undefined);
        return { container: c.spec.name, name: c.spec.name, note: `${c.spec.name} en marche · sa base « ${db.info.database} » dans la base d'Odin, sauvegardée chaque nuit` };
      }, name);
      if (name) ctx.saveSettings({ running: [...new Set([...((ctx.settings.running as string[]) ?? []), name])] });
      return { text: `🚢 Installation de ${image} lancée${wantDb ? ', avec sa base dans la base de données d\'Odin (sauvegardée chaque nuit)' : ''} : la barre de progression est dans Naglfar (téléchargement, montage, démarrage).`, data: { job: j.id } };
    } },
    { id: 'executer', label: 'Commande dans un conteneur', what: 'Lance une commande dans un conteneur en marche et montre sa réponse', params: [CT, { key: 'commande', label: 'Commande', kind: 'text', required: true }], grave: (i) => `lancer « ${s(i.commande)} » dans ${s(i.conteneur)}`, external: true, run: async (_ctx, i) => {
      const out: string[] = []; const code = await cli(['exec', safe(i.conteneur), ...splitLine(s(i.commande))], { out: (t) => out.push(t), err: (t) => out.push(t), interactive: false }, engine() as Engine);
      return { text: `${out.join('\n').slice(-6000) || '(rien)'}${code ? `\n(code ${code})` : ''}`, ok: code === 0 };
    } },
    { id: 'mettre_a_jour', label: 'Mettre à jour l\'image', what: 'Récupère la dernière image puis recrée le conteneur avec les mêmes réglages', params: [CT], grave: (i) => `recréer ${s(i.conteneur)} avec la nouvelle image`, words: ['mets a jour le conteneur'], run: async (_ctx, i) => {
      const e = engine(), c = e.find(safe(i.conteneur)), old = e.findImage(c.spec.image)?.id, sp = c.spec;
      e.startJob('mettre à jour', sp.image, async (report, set) => {
        const img = await e.pull(sp.image, () => {}, (p) => report(p));
        if (img.id === old) return { note: `${sp.name} : déjà la dernière version` };
        report({ phase: 'démarrer', done: 1, total: 1 }, `Relance de ${sp.name} avec la nouvelle image`);
        await e.rm(sp.id, true);
        const n = await e.run({ image: sp.image, name: sp.name, cmd: sp.cmd, env: sp.env, ports: sp.ports, mounts: sp.mounts, restart: sp.restart, memory: sp.memory, cpus: sp.cpus, user: sp.user, workdir: sp.workdir, hostname: sp.hostname, network: sp.network, labels: sp.labels });
        set({ container: n.spec.name }); return { note: `${n.spec.name} relancé avec la nouvelle image (${img.id.slice(0, 12)})` };
      }, sp.name);
      return { text: `⬆ Mise à jour de ${sp.name} lancée : suis-la dans Naglfar.` };
    } },
    { id: 'supprimer', label: 'Supprimer un conteneur', what: 'Supprime un conteneur (ses dossiers partagés sont gardés)', params: [CT], grave: (i) => `supprimer le conteneur ${s(i.conteneur)}`, run: async (ctx, i) => { forget(ctx, safe(i.conteneur)); const sp = await engine().rm(safe(i.conteneur), true); return { text: `🗑 ${sp.name} supprimé (dossiers partagés conservés).` }; } },
    { id: 'images', label: 'Images', what: 'Les images présentes', read: true, words: ['quelles images'], run: () => { const l = engine().images(); return { text: l.map((x) => `- ${x.names.join(', ')} · ${(x.size / 1e6).toFixed(0)} Mo`).join('\n') || 'Aucune image.', data: l.map((x) => ({ names: x.names, id: x.id.slice(0, 12), size: x.size })) }; } },
    { id: 'tirer', label: 'Récupérer une image', what: 'Télécharge une image (vérifiée) sans rien lancer', params: [{ key: 'image', label: 'Image', kind: 'text', required: true }], words: ['telecharge l\'image', 'recupere l\'image'], run: async (_ctx, i) => { engine().pullJob(safe(i.image)); return { text: `⬇ Récupération de ${safe(i.image)} lancée : suis-la dans Naglfar.` }; } },
    { id: 'supprimer_image', label: 'Supprimer une image', what: 'Supprime une image qui ne sert plus', params: [{ key: 'image', label: 'Image', kind: 'text', required: true }], grave: (i) => `supprimer l'image ${s(i.image)}`, run: async (_ctx, i) => { const img = await engine().rmi(safe(i.image)); return { text: `🗑 Image ${img.names.join(', ')} supprimée.` }; } },
    { id: 'nettoyer', label: 'Nettoyer', what: 'Supprime les images qu\'aucun conteneur n\'utilise', grave: () => 'supprimer les images inutilisées', words: ['nettoie', 'place'], run: async () => {
      const e = engine(), used = new Set(e.ps(true).map((c) => c.spec.imageId)), out: string[] = [];
      for (const img of e.images()) if (!used.has(img.id)) { await e.rmi(img.id); out.push(img.names.join(', ')); }
      return { text: out.length ? `🧹 Images supprimées : ${out.join(' ; ')}` : '🧹 Rien à nettoyer.' };
    } },
    { id: 'services', label: 'Services mis à l\'échelle', what: 'Les services en plusieurs copies : copies prêtes, visiteurs, pourquoi', read: true, words: ['mise a l\'echelle', 'autoscaling', 'combien de copies'], run: () => { const l = services(engine() as Engine); return { text: l.map(({ spec: sp, state: st }) => `- ${sp.name} · ${st.status} · ${st.replicas.filter((r) => r.healthy).length} copies (${sp.scale.min}-${sp.scale.max}) · ${st.active} visiteurs · ${st.reason}`).join('\n') || 'Aucun service mis à l\'échelle.', data: l }; } },
    { id: 'creer_service', label: 'Créer un service mis à l\'échelle', what: 'Une appli en plusieurs copies derrière un répartiteur : le moteur ajoute ou retire des copies selon les visiteurs, le processeur et la mémoire', quick: false, params: [
      { key: 'nom', label: 'Nom (minuscules)', kind: 'text', required: true }, { key: 'image', label: 'Image', kind: 'text', required: true }, { key: 'ports', label: 'Ports (8080:80)', kind: 'text', required: true },
      { key: 'min', label: 'Copies au moins', kind: 'number', default: 2 }, { key: 'max', label: 'Copies au plus', kind: 'number', default: 10 }, { key: 'coeurs', label: 'Cœurs par copie', kind: 'text', default: '1' }, { key: 'memoire', label: 'Mémoire par copie', kind: 'text', default: '512m' },
      { key: 'visiteurs', label: 'Visiteurs en même temps par copie', kind: 'number', default: 100 }, { key: 'cible_cpu', label: 'Processeur visé (%)', kind: 'number', default: 70 }, { key: 'budget', label: 'Part de la machine pour les conteneurs (%)', kind: 'number', default: 80 },
      { key: 'sante', label: 'Page de santé (ex. /health ; vide : le port répond)', kind: 'text', default: '' }, { key: 'env', label: 'Variables (une par ligne)', kind: 'textarea', default: '' }],
      grave: (i) => `créer le service ${s(i.nom)} (${s(i.image)}, ${s(i.min) || 2} à ${s(i.max) || 10} copies)`, run: async (ctx, i) => {
      const e = engine() as Engine, image = safe(i.image), name = s(i.nom).trim().toLowerCase();
      if (!e.findImage(image)) await e.pull(image);
      defineService(e, { name, image, ports: s(i.ports), env: env(s(i.env)), min: Number(i.min) || 2, max: Number(i.max) || 10, cpus: s(i.coeurs) || '1', memory: s(i.memoire) || '512m', conns: Number(i.visiteurs) || 100, cpu: Number(i.cible_cpu) || 70, budgetPct: Number(i.budget) || 80, health: s(i.sante) || undefined });
      const st = await startService(e, name); ctx.saveSettings({ services: [...new Set([...((ctx.settings.services as string[]) ?? []), name])] });
      return { text: `📈 ${name} : ${st.replicas.filter((r) => r.healthy).length} copie(s) prête(s) sur ${s(i.ports)}, de ${Number(i.min) || 2} à ${Number(i.max) || 10} selon les visiteurs.` };
    } },
    { id: 'regler_service', label: 'Régler la mise à l\'échelle', what: 'Copies min / max, visiteurs par copie, processeur visé, part de la machine (pris en compte tout de suite)', quick: false, params: [{ key: 'service', label: 'Service', kind: 'text', required: true }, { key: 'min', label: 'Copies au moins', kind: 'number' }, { key: 'max', label: 'Copies au plus', kind: 'number' }, { key: 'visiteurs', label: 'Visiteurs par copie', kind: 'number' }, { key: 'cible_cpu', label: 'Processeur visé (%)', kind: 'number' }, { key: 'budget', label: 'Part de la machine (%)', kind: 'number' }],
      run: (_ctx, i) => { const n = (k: string) => (i[k] === undefined || i[k] === '' ? undefined : Number(i[k])); const sp = tuneService(engine() as Engine, safe(i.service), { min: n('min'), max: n('max'), conns: n('visiteurs'), cpu: n('cible_cpu'), budgetPct: n('budget') }); return { text: `📈 ${sp.name} : ${sp.scale.min} à ${sp.scale.max} copies · ${sp.scale.conns} visiteurs par copie · processeur visé ${sp.scale.cpu} % · ${sp.budgetPct} % de la machine au plus.` }; } },
    { id: 'demarrer_service', label: 'Démarrer un service', what: 'Relance un service et ses copies', params: [{ key: 'service', label: 'Service', kind: 'text', required: true }], run: async (ctx, i) => { const st = await startService(engine() as Engine, safe(i.service)); ctx.saveSettings({ services: [...new Set([...((ctx.settings.services as string[]) ?? []), safe(i.service)])] }); return { text: `▶ ${safe(i.service)} : ${st.replicas.filter((r) => r.healthy).length} copie(s) prête(s).` }; } },
    { id: 'arreter_service', label: 'Arrêter un service', what: 'Laisse finir les visiteurs en cours puis arrête toutes les copies', params: [{ key: 'service', label: 'Service', kind: 'text', required: true }], grave: (i) => `arrêter le service ${s(i.service)} (le site ne répondra plus)`, run: async (ctx, i) => { ctx.saveSettings({ services: ((ctx.settings.services as string[]) ?? []).filter((x) => x !== safe(i.service)) }); await stopService(engine() as Engine, safe(i.service)); return { text: `⏹ ${safe(i.service)} arrêté.` }; } },
    { id: 'supprimer_service', label: 'Supprimer un service', what: 'Arrête et supprime un service (l\'image et les dossiers partagés restent)', params: [{ key: 'service', label: 'Service', kind: 'text', required: true }], grave: (i) => `supprimer le service ${s(i.service)}`, run: async (ctx, i) => { ctx.saveSettings({ services: ((ctx.settings.services as string[]) ?? []).filter((x) => x !== safe(i.service)) }); await removeService(engine() as Engine, safe(i.service)); return { text: `🗑 Service ${safe(i.service)} supprimé.` }; } },
    { id: 'grandir', label: 'Grandir tout seul', what: 'Un conteneur seul (une base de données) reçoit plus de mémoire et de processeur quand il en a besoin, sans arrêt, entre deux bornes', quick: false, params: [CT, { key: 'memoire', label: 'Mémoire min-max (1g-8g)', kind: 'text', default: '1g-8g' }, { key: 'coeurs', label: 'Cœurs min-max (1-4)', kind: 'text', default: '1-4' }],
      run: async (_ctx, i) => { const c = await engine().resize(safe(i.conteneur), { grow: `${s(i.memoire) || '1g-8g'}/${s(i.coeurs) || '1-4'}` }); return { text: `🌱 ${c.spec.name} grandit tout seul : mémoire ${s(i.memoire) || '1g-8g'}, cœurs ${s(i.coeurs) || '1-4'} (aujourd'hui ${c.spec.memory} · ${c.spec.cpus} cœurs).` }; } },
    { id: 'commande', label: 'Commande', what: 'Une commande comme dans un terminal : run, ps, stop, start, restart, rm, logs, exec, pull, images, rmi, inspect', quick: false, params: [{ key: 'ligne', label: 'Commande (ex. run -d -p 8080:80 nginx)', kind: 'text', required: true }], grave: (i) => graveOf(s(i.ligne)), external: true, run: async (ctx, i) => {
      const argv = splitLine(s(i.ligne)); if (!VERBS.includes((argv[0] ?? '').toLowerCase())) throw new Error(`commande inconnue : ${argv[0] ?? ''} (${VERBS.join(', ')})`);
      argv[0] = argv[0].toLowerCase();
      const out: string[] = []; const code = await cli(argv, { out: (t) => out.push(t), err: (t) => out.push(t), interactive: false }, engine() as Engine);
      if (argv[0] === 'stop' || argv[0] === 'rm') for (const n of argv.slice(1).filter((x) => !x.startsWith('-'))) forget(ctx, n);
      return { text: out.join('\n').slice(-8000) || '✓', ok: code === 0 };
    } },
  ],
  async view() {
    const e = engine(); let cts: Ctr[] = [], err = '';
    try { cts = e.ps(true); } catch (x) { err = (x as Error).message; }
    const imgs = err ? [] : e.images(), up = cts.filter((c) => c.state.status === 'en marche').length;
    const jobs = err ? [] : e.jobs(), live = jobs.filter((j) => !j.ended);
    let svcs: ReturnType<typeof services> = []; try { svcs = services(e as Engine); } catch { /* pas de service */ }
    return {
      subtitle: err || `${up} en marche sur ${cts.length} · moteur d'Odin, sans démon`,
      tabs: ['Conteneurs', 'Images'],
      kpis: [...(live.length ? [{ label: 'Installations en cours', value: String(live.length), tone: 'attention' as const }] : []), { label: 'En marche', value: `${up} / ${cts.length}`, tone: up === cts.length ? 'bon' : 'attention' }, { label: 'Images', value: String(imgs.length) }, { label: 'Place des images', value: `${(imgs.reduce((a, i) => a + i.size, 0) / 1e9).toFixed(1)} Go` }],
      refreshMs: live.length ? 1200 : svcs.some((x) => x.state.status === 'en marche') ? 5000 : undefined,
      sections: [
        ...(jobs.length ? [{ kind: 'cards' as const, title: 'Installations', items: jobs.slice(0, 8).map((j) => ({
          title: j.name ?? j.image, sub: `${j.kind === 'récupérer' ? 'Récupérer' : j.kind === 'mettre à jour' ? 'Mettre à jour' : 'Installer'} · ${j.image}`, progress: j.pct / 100,
          badge: j.phase === 'télécharger' ? 'téléchargement' : j.phase === 'monter' ? 'montage' : j.phase === 'démarrer' ? 'démarrage' : j.phase === 'fini' ? 'terminé' : j.phase === 'échec' ? 'échec' : 'en attente',
          tone: j.phase === 'échec' ? 'mauvais' as const : j.phase === 'fini' ? 'bon' as const : 'attention' as const,
          meta: `${j.note} · ${j.pct} %${j.ended ? ` · ${new Date(j.ended).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}`,
          actions: j.container && j.phase === 'fini' ? [{ action: 'journaux', label: 'Journal', input: { conteneur: j.container } }] : [],
        })) }] : []),
        ...(svcs.length ? [{ kind: 'cards' as const, title: 'Mise à l\'échelle automatique', items: svcs.map(({ spec: sp, state: st }) => { const ok = st.replicas.filter((r) => r.healthy).length; return {
          title: sp.name, sub: `${sp.image} · ${sp.ports.map((p) => `${p.host}→${p.inner}`).join(', ')} · ${sp.scale.min} à ${sp.scale.max} copies · ${sp.per.cpus} cœur / ${sp.per.memory} chacune`,
          badge: st.status === 'en marche' ? `${ok} copie${ok > 1 ? 's' : ''}` : st.status, tone: st.status !== 'en marche' ? 'neutre' as const : ok < sp.scale.min ? 'attention' as const : 'bon' as const, progress: ok / Math.max(1, sp.scale.max),
          meta: `${st.active} visiteurs en cours · ${st.rate} nouveaux/s · ${st.reason}${st.refused ? ` · ${st.refused} refusés` : ''}`,
          actions: [st.status === 'arrêté' ? { action: 'demarrer_service', label: 'Démarrer', input: { service: sp.name } } : { action: 'arreter_service', label: 'Arrêter', input: { service: sp.name } }, { action: 'regler_service', label: 'Régler', input: { service: sp.name } }, { action: 'supprimer_service', label: 'Supprimer', input: { service: sp.name } }] }; }) },
          ...svcs.filter(({ state: st }) => st.history.length > 2).slice(0, 2).map(({ spec: sp, state: st }) => { const h = st.history.slice(-60); return { kind: 'courbe' as const, title: `${sp.name} · copies et visiteurs`, labels: h.map((x) => x.at.slice(11, 16)), series: [{ name: 'visiteurs en cours', tone: 'neutre' as const, points: h.map((x) => x.active) }, { name: 'copies × 10', tone: 'bon' as const, points: h.map((x) => x.copies * 10) }] }; })] : []),
        { kind: 'cards', title: 'Conteneurs', empty: err || 'Aucun conteneur : « Lancer une appli », ou dans la discussion « run -d -p 8080:80 nginx ».', items: cts.map((c) => ({
          title: c.spec.name, sub: `${c.spec.labels['odin.service'] ? `copie de ${c.spec.labels['odin.service']} · ` : ''}${c.spec.labels['odin.grandir'] ? `grandit tout seul (${c.spec.memory} · ${c.spec.cpus} cœurs) · ` : ''}${c.spec.image}${c.state.ip ? ` · ${c.state.ip}` : ''}${c.spec.ports.length ? ` · ${c.spec.ports.map((p) => `${p.host}→${p.inner}`).join(', ')}` : ''}`,
          badge: c.state.status, tone: c.state.status === 'en marche' ? 'bon' as const : c.state.status === 'redémarre' ? 'attention' as const : 'neutre' as const,
          actions: [c.state.status === 'en marche' ? { action: 'arreter', label: 'Arrêter', input: { conteneur: c.spec.name } } : { action: 'demarrer', label: 'Démarrer', input: { conteneur: c.spec.name } }, { action: 'journaux', label: 'Journal', input: { conteneur: c.spec.name } }, { action: 'mettre_a_jour', label: 'Mettre à jour', input: { conteneur: c.spec.name } }, { action: 'supprimer', label: 'Supprimer', input: { conteneur: c.spec.name } }],
        })) },
        { kind: 'table', title: 'Images', columns: ['Image', 'Identifiant', 'Taille'], empty: 'Aucune image.', rows: imgs.flatMap((i) => i.names.map((n) => ({ cells: [n, i.id.slice(0, 12), `${(i.size / 1e6).toFixed(0)} Mo`] }))) },
        { kind: 'text', title: 'Dans la discussion aussi', text: 'Écris directement : run -d --name web -p 8080:80 nginx · ps · logs web · stop web · start web · exec web ls / · pull alpine · images · rm web. Lancer, supprimer et exec demandent ton accord.' },
      ],
      side: [{ kind: 'form', title: 'Lancer une appli', action: 'lancer', submit: 'Lancer', params: LANCER.slice(0, 4) }],
    };
  },
  watch: { every: 30, async run(ctx) {
    let cts: Ctr[]; try { cts = engine().ps(true); } catch { return; }
    await grow(ctx, cts);
    // un service voulu dont le répartiteur a disparu (machine redémarrée, plantage) : relancé
    for (const n of (ctx.settings.services as string[] | undefined) ?? []) {
      const x = services(engine() as Engine).find((v) => v.spec.name === n);
      if (x && x.state.status === 'arrêté') { try { await startService(engine() as Engine, n); ctx.alert({ level: 'moyenne', title: `Service « ${n} » relancé`, detail: x.state.error ?? 'son répartiteur s\'était arrêté', key: `svc:${n}` }); } catch (e2) { ctx.alert({ level: 'haute', title: `Service « ${n} » arrêté`, detail: (e2 as Error).message, key: `svc:${n}` }); } }
    }
    const was = (ctx.settings.running as string[] | undefined) ?? [];
    const now = cts.filter((c) => c.state.status === 'en marche' || c.state.status === 'redémarre').map((c) => c.spec.name);
    // Arrêté à la main (odin stop, bouton, discussion) : ce n'est pas une panne. Seul un conteneur sorti tout seul (ou disparu) alerte.
    // Supprimé à la main (rm) : plus là, pas une panne non plus.
    for (const n of was) if (!now.includes(n) && cts.find((x) => x.spec.name === n)?.state.status === 'sorti') { const c = cts.find((x) => x.spec.name === n); ctx.alert({ level: 'haute', title: `Le conteneur « ${n} » s'est arrêté`, detail: c ? `${c.state.status}${c.state.exitCode !== undefined ? ` (code ${c.state.exitCode})` : ''}${c.state.error ? ` — ${c.state.error}` : ''}` : 'disparu', key: `down:${n}` }); ctx.emit('conteneur_arrete', { conteneur: n }); }
    ctx.saveSettings({ running: now });
  } },
};
export { psTable };

/** Grandir en place : les conteneurs marqués « grandir » (bases de données) reçoivent plus de mémoire / de processeur. */
const prevStat = new Map<string, CgStat>(), lowSince = new Map<string, number>();
async function grow(ctx: ModCtx, cts: Ctr[]): Promise<void> {
  for (const c of cts) {
    const g = c.spec.labels['odin.grandir']; if (!g || c.state.status !== 'en marche') continue;
    const cur = cgStat(join('/sys/fs/cgroup/odin', c.id.slice(0, 12))), prev = prevStat.get(c.id); if (!cur) continue; prevStat.set(c.id, cur); if (!prev) continue;
    const l = load(prev, cur), [m, k] = g.split('/'), [m0, m1] = m.split('-').map(bytes), [k0, k1] = k.split('-').map(Number);
    const calmNow = l.cpu < 25 && l.mem < 40, since = calmNow ? (lowSince.get(c.id) ?? Date.now()) : undefined; if (since) lowSince.set(c.id, since); else lowSince.delete(c.id);
    const r = vertical({ memory: bytes(c.spec.memory) || m0, cpus: Number(c.spec.cpus) || k0 }, { ...l, usedMem: cur.memCurrent }, { minMem: m0, maxMem: m1, minCpus: k0, maxCpus: k1 }, !!since && Date.now() - since > 30 * 60_000);
    if (!r.reason) continue;
    await engine().resize(c.spec.name, { memory: human(r.memory), cpus: String(r.cpus) }).catch(() => undefined);
    if (since) lowSince.set(c.id, Date.now());
    ctx.alert({ level: 'info', title: `🌱 ${c.spec.name} ajusté`, detail: r.reason, key: `grandir:${c.spec.name}` });
  }
}

const IMAGE = /^[a-z0-9][a-z0-9._/:@-]{0,200}$/;
/**
 * Une ligne de la discussion qui est une commande de conteneurs (« run -d -p 8080:80 nginx », « ps », « logs web »…),
 * écrite comme dans un terminal, sans « odin » devant. Rend la ligne si c'en est une, sinon rien : « stop la musique »
 * n'est pas pour les conteneurs (« la » n'est pas un conteneur connu). Pur, sauf la liste des conteneurs.
 */
export function chatCommand(text: string, known: () => string[] = () => engine().ps(true).flatMap((c) => [c.spec.name, c.id.slice(0, 12)])): string | undefined {
  let argv: string[]; try { argv = splitLine(text.trim()); } catch { return undefined; }
  const verb = (argv[0] ?? '').toLowerCase(); if (!VERBS.includes(verb)) return undefined;
  if (verb === 'service') { const sub = (argv[1] ?? '').toLowerCase(); return ['ls', 'ps', 'create', 'run', 'start', 'stop', 'rm', 'scale'].includes(sub) || argv.length === 1 ? argv.map((x) => (/[\s'"]/.test(x) || !x ? `'${x.replace(/'/g, `'"'"'`)}'` : x)).join(' ') : undefined; }
  let a; try { a = parseArgs(argv.slice(1), new Set([...VALUES, ...(verb === 'stop' || verb === 'restart' ? ['t'] : [])])); } catch { return undefined; }
  const words = a.rest;
  const ok = (() => {
    if (verb === 'ps' || verb === 'images' || verb === 'image') return words.length === 0;
    if (verb === 'pull' || verb === 'rmi') return words.length >= 1 && words.every((w) => IMAGE.test(w));
    if (verb === 'run') return words.length >= 1 && IMAGE.test(words[0]) && (Object.keys(a.flags).length + Object.keys(a.opts).length + Object.keys(a.multi).length > 0 || /[/:.@]/.test(words[0]) || words.length === 1);
    if (verb === 'scale') { try { return words.length >= 1 && services(engine() as Engine).some((x) => x.spec.name === words[0]); } catch { return false; } }
    let names: string[] = []; try { names = known(); } catch { return false; }
    if (verb === 'exec' || verb === 'logs' || verb === 'log' || verb === 'inspect' || verb === 'resize') return words.length >= 1 && names.includes(words[0]);
    return words.length >= 1 && words.every((w) => names.includes(w));
  })();
  return ok ? [verb, ...argv.slice(1)].map((x) => (/[\s'"]/.test(x) || !x ? `'${x.replace(/'/g, `'"'"'`)}'` : x)).join(' ') : undefined;
}
