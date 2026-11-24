// Arche (identifiant interne naglfar ; nom affiché lu dans names.ts) — tes conteneurs, sur le moteur d'Odin (Hringhorni) : sans démon.
// Lancer une appli à partir d'une image Docker, la voir, la démarrer, l'arrêter, lire son journal, lancer une
// commande dedans, la mettre à jour, la supprimer (avec ton accord). Les mêmes commandes que dans un terminal
// marchent aussi dans la discussion : « run -d -p 8080:80 nginx », « ps », « logs web », « stop web »…
import { Engine, restartOf, type Ctr } from '../hringhorni/engine.ts';
import { cli, parseArgs, splitLine, psTable, VALUES, VERBS } from '../hringhorni/cli.ts';
import { defineService, removeService, services, startService, stopService, tuneService } from '../hringhorni/services.ts';
import { appPort, describe as portsText, ODIN_PORTS, APP_PORTS, WEB, SERVICES_RANGE, DIRECT_RANGE, reserved } from '../ports.ts';
import { parsePorts, placePorts, usedPorts } from '../parc.ts';
import { budget, bytes, cgStat, human, load, vertical, type CgStat } from '../hringhorni/scale.ts';
import { join } from 'node:path';
import { databaseFor, needsDb, roleOf, SERVER as PG_SERVER } from '../urdr/serveur.ts';
import { bases as urdrBases } from '../urdr/bases.ts';
import type { ModCtx, Module, Param } from '../types.ts';
import { verifierVersions, type Version } from '../hringhorni/versions.ts';
import { spawn } from 'node:child_process';
import { lstatSync, realpathSync, rmSync, statfsSync } from 'node:fs';
import type { ReseauVu, VolumeVu } from '../hringhorni/engine.ts';
import { cpus, homedir, totalmem } from 'node:os';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { defaultDir, NOM_OBJET } from '../hringhorni/store.ts';
import { actionJournal, avecJournal } from '../vidarr/qui-a-fait.ts';
import { NAMES } from '../names.ts';
import type { Action } from '../types.ts';
import { analyserComposition, arreterPile, demarrerPile, deployerPile, NOM_PILE, pile, piles, supprimerPile, vraiCheminLinux, type Analyse, type Garde, type MoteurPile } from '../hringhorni/composition.ts';

/** Le nom affiché de l'appli (un seul endroit : src/valhalla/names.ts). */
export const nomArche = (): string => NAMES.naglfar ?? 'Arche';
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

// Nouvelles versions des images (comme What's Up Docker) : le registre est interrogé toutes les 6 heures au plus.
const versionsDe = (ctx: ModCtx) => (ctx.settings.versions as Version[] | undefined) ?? [];
async function controlerVersions(ctx: ModCtx): Promise<Version[]> {
  const e = engine(), cts = e.ps(true).filter((c) => !c.spec.labels['odin.service']);
  const l = await verifierVersions(e.images(), cts.map((c) => ({ nom: c.spec.name, image: c.spec.image })), { fetch: ctx.fetch, quand: ctx.now().toISOString() });
  ctx.saveSettings({ versions: l, versionsQuand: ctx.now().getTime() });
  for (const v of l.filter((x) => x.nouvelle)) ctx.alert({ level: 'info', title: `Nouvelle version de ${v.image}`, detail: `Le registre propose une image plus récente que celle de ${v.conteneurs.join(', ')} (rien n'est changé tout seul).`, key: `version:${v.image}:${v.distante}`, fix: { module: 'naglfar', action: 'mettre_a_jour', label: `Mettre à jour ${v.conteneurs[0]}`, input: { conteneur: v.conteneurs[0] } } });
  return l;
}
export const naglfar: Module & { similaires: string[] } = {
  id: 'naglfar', name: nomArche(), family: 'Machines',
  what: 'Tes conteneurs, sur le moteur d\'Odin (rien d\'autre à installer, aucun service qui tourne en plus) : lancer une appli depuis une image de conteneur, la suivre, l\'arrêter, lire son journal, la mettre à jour.',
  does: ['lancer une appli à partir d\'une image de conteneur (registres publics)', 'liste des conteneurs, démarrer, arrêter, redémarrer', 'journal de chaque conteneur', 'lancer une commande dedans', 'mettre à jour l\'image et relancer avec les mêmes réglages', 'images présentes, nettoyage', 'les commandes run, ps, stop, start, rm, logs, exec, pull, images aussi dans la discussion', 'ports publiés, dossiers partagés, limites de mémoire et de processeur, relance automatique'],
  from: ['Portainer CE', 'Podman'], upstream: [],
  similaires: ['Portainer CE', 'Podman', 'Arcane', "What's Up Docker", 'Dozzle', 'CapRover'],
  words: ['conteneur', 'conteneurs', 'docker', 'podman', 'image', 'images docker', 'hringhorni', 'moteur de conteneurs'],
  actions: [
    { id: 'lister', label: 'Lister les conteneurs', what: 'Tous les conteneurs et leur état', read: true, words: ['liste', 'lister', 'quels conteneurs'], run: async () => { const c = engine().ps(true); return { text: c.map(line).join('\n') || 'Aucun conteneur.', data: c.map((x) => ({ Names: x.spec.name, Image: x.spec.image, State: x.state.status === 'en marche' ? 'running' : 'exited', Status: x.state.status, Ports: x.spec.ports.map((p) => `${p.host}->${p.inner}`).join(', '), Labels: '' })) }; } },
    { id: 'journaux', label: 'Journaux', what: 'Les 80 dernières lignes', read: true, params: [CT], words: ['journaux', 'logs'], run: async (_ctx, i) => ({ text: engine().logs(safe(i.conteneur), 80).map((l) => l.text).join('\n') || '(journal vide)' }) },
    { id: 'demarrer', undo: (i) => ({ action: 'arreter', input: { conteneur: i.conteneur }, label: 'conteneur arrêté' }), label: 'Démarrer', what: 'Démarre un conteneur', params: [CT], words: ['demarre', 'démarre', 'lance le conteneur'], run: async (ctx, i) => { const c = await engine().start(safe(i.conteneur)); ctx.saveSettings({ running: [...new Set([...((ctx.settings.running as string[]) ?? []), c.spec.name])] }); return { text: `▶ ${c.spec.name} démarré.` }; } },
    { id: 'arreter', undo: (i) => ({ action: 'demarrer', input: { conteneur: i.conteneur }, label: 'conteneur relancé' }), label: 'Arrêter', what: 'Arrête un conteneur', params: [CT], words: ['arrete', 'arrête', 'stoppe'], run: async (ctx, i) => { forget(ctx, safe(i.conteneur)); const c = await engine().stop(safe(i.conteneur)); return { text: `⏹ ${c.spec.name} arrêté.` }; } },
    { id: 'redemarrer', label: 'Redémarrer', what: 'Redémarre un conteneur', params: [CT], words: ['redemarre', 'redémarre', 'relance'], run: async (_ctx, i) => { const c = await engine().restart(safe(i.conteneur)); return { text: `🔄 ${c.spec.name} redémarré.` }; } },
    { id: 'lancer', label: 'Lancer une appli', what: 'Récupère l\'image si besoin, crée le conteneur et le démarre ; une appli qui a besoin d\'une base la reçoit dans la base d\'Odin', params: LANCER, grave: (i) => `lancer un conteneur à partir de ${s(i.image)}${(s(i.base) && !/selon/.test(s(i.base)) ? !/aucune/i.test(s(i.base)) : needsDb(s(i.image))) ? ' (avec sa base dans la base de données d\'Odin)' : ''}${s(i.dossiers).trim() ? `, avec accès à ces dossiers de ta machine : ${s(i.dossiers).trim()}` : ''}${s(i.ports).trim() ? `, ports ouverts : ${s(i.ports).trim()}` : ''}`, words: ['lance l\'image', 'installe le conteneur'], run: async (ctx, i) => {
      const image = safe(i.image), name = s(i.nom).trim() || undefined;
      const known = appPort(image), e = engine();
      // Un port déjà pris (par un autre programme, une autre appli installée, ou gardé par Odin) : le suivant libre, et on le dit.
      // (Avant, le conteneur démarrait sans son port, avec une seule ligne dans son journal.)
      const used = usedPorts([], (await ctx.run('ss', ['-ltnH'], { timeoutMs: 5000 }).catch(() => ({ out: '' }))).out);
      for (const c of e.ps()) for (const p of c.spec.ports) used.add(p.host);
      for (const r of reserved()) if (r !== known?.host) used.add(r);
      const placed = placePorts(parsePorts(s(i.ports) || (known ? `${known.host}:${known.inner}` : '')), used);
      const opts = { image, name, ports: placed.ports, mounts: s(i.dossiers), env: env(s(i.env)), restart: restartOf(s(i.redemarrage) || 'unless-stopped'), memory: s(i.memoire).trim() || undefined, cpus: s(i.coeurs).trim() || undefined };
      const wantDb = s(i.base) && !/selon/.test(s(i.base)) ? !/^(aucune|non|no)$/i.test(s(i.base)) : needsDb(image);
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
      return { text: `🚢 Installation de ${image} lancée${wantDb ? ', avec sa base dans la base de données d\'Odin (sauvegardée chaque nuit)' : ''} : la barre de progression est dans ${nomArche()} (téléchargement, montage, démarrage).${placed.ports.length ? `\nPort${placed.ports.length > 1 ? 's' : ''} : ${placed.ports.map((p) => `${p.host} → ${p.inner}`).join(' · ')}${placed.moved.length ? ` (${placed.moved.join(' · ')})` : ''}.` : ''}`, data: { job: j.id, ports: placed.ports } };
    } },
    { id: 'executer', label: 'Commande dans un conteneur', what: 'Lance une commande dans un conteneur en marche et montre sa réponse', params: [CT, { key: 'commande', label: 'Commande', kind: 'text', required: true }], grave: (i) => `lancer « ${s(i.commande)} » dans ${s(i.conteneur)}`, external: true, run: async (_ctx, i) => {
      const out: string[] = []; const code = await cli(['exec', safe(i.conteneur), ...splitLine(s(i.commande))], { out: (t) => out.push(t), err: (t) => out.push(t), interactive: false }, engine() as Engine);
      return { text: `${out.join('\n').slice(-6000) || '(rien)'}${code ? `\n(code ${code})` : ''}`, ok: code === 0 };
    } },
    { id: 'nouvelles_versions', label: 'Nouvelles versions des images', what: 'Demande aux registres si une image plus récente existe pour chaque conteneur (rien n\'est téléchargé ni changé)', read: true, external: true, words: ['nouvelles versions des images', 'mises a jour des conteneurs', 'nouvelles versions des conteneurs'], run: async (ctx) => {
      const l = await controlerVersions(ctx), n = l.filter((x) => x.nouvelle);
      return { text: l.length ? `${n.length ? `⬆ ${n.length} image(s) avec une nouvelle version` : '✅ Toutes les images sont à jour'} :\n${l.map((v) => `- ${v.image} (${v.conteneurs.join(', ')}) : ${v.erreur ? `pas vérifiée (${v.erreur})` : v.nouvelle ? 'nouvelle version disponible' : 'à jour'}`).join('\n')}` : 'Aucun conteneur à vérifier.', data: l };
    } },
    { id: 'mettre_a_jour', label: 'Mettre à jour l\'image', what: 'Récupère la dernière image puis recrée le conteneur avec les mêmes réglages', params: [CT], grave: (i) => `recréer ${s(i.conteneur)} avec la nouvelle image`, words: ['mets a jour le conteneur'], run: async (_ctx, i) => {
      const e = engine(), c = e.find(safe(i.conteneur)), old = e.findImage(c.spec.image)?.id, sp = c.spec;
      e.startJob('mettre à jour', sp.image, async (report, set) => {
        const img = await e.pull(sp.image, () => {}, (p) => report(p));
        if (img.id === old) return { note: `${sp.name} : déjà la dernière version` };
        report({ phase: 'démarrer', done: 1, total: 1 }, `Relance de ${sp.name} avec la nouvelle image`);
        await e.rm(sp.id, true);
        const n = await e.run({ image: sp.image, name: sp.name, cmd: sp.cmd, env: sp.env, ports: sp.ports, mounts: sp.mounts, restart: sp.restart, memory: sp.memory, cpus: sp.cpus, user: sp.user, workdir: sp.workdir, hostname: sp.hostname, network: sp.network, reseau: sp.reseau, labels: sp.labels });
        set({ container: n.spec.name }); return { note: `${n.spec.name} relancé avec la nouvelle image (${img.id.slice(0, 12)})` };
      }, sp.name);
      return { text: `⬆ Mise à jour de ${sp.name} lancée : suis-la dans ${nomArche()}.` };
    } },
    { id: 'supprimer', label: 'Supprimer un conteneur', what: 'Supprime un conteneur (ses dossiers partagés sont gardés)', params: [CT], grave: (i) => `supprimer le conteneur ${s(i.conteneur)}`, run: async (ctx, i) => { forget(ctx, safe(i.conteneur)); const sp = await engine().rm(safe(i.conteneur), true); return { text: `🗑 ${sp.name} supprimé (dossiers partagés conservés).` }; } },
    { id: 'images', label: 'Images', what: 'Les images présentes', read: true, words: ['quelles images'], run: () => { const l = engine().images(); return { text: l.map((x) => `- ${x.names.join(', ')} · ${(x.size / 1e6).toFixed(0)} Mo`).join('\n') || 'Aucune image.', data: l.map((x) => ({ names: x.names, id: x.id.slice(0, 12), size: x.size })) }; } },
    { id: 'tirer', label: 'Récupérer une image', what: 'Télécharge une image (vérifiée) sans rien lancer', params: [{ key: 'image', label: 'Image', kind: 'text', required: true }], words: ['telecharge l\'image', 'recupere l\'image', 'derniere version de l\'image'], run: async (_ctx, i) => { engine().pullJob(safe(i.image)); return { text: `⬇ Récupération de ${safe(i.image)} lancée : suis-la dans ${nomArche()}.` }; } },
    { id: 'supprimer_image', label: 'Supprimer une image', what: 'Supprime une image qui ne sert plus', params: [{ key: 'image', label: 'Image', kind: 'text', required: true }], grave: (i) => `supprimer l'image ${s(i.image)}`, run: async (_ctx, i) => { const img = await engine().rmi(safe(i.image)); return { text: `🗑 Image ${img.names.join(', ')} supprimée.` }; } },
    { id: 'nettoyer', label: 'Nettoyer', what: 'Supprime les images qu\'aucun conteneur n\'utilise', grave: () => 'supprimer les images inutilisées', words: ['nettoie', 'place'], run: async () => {
      const e = engine(), used = new Set(e.ps(true).map((c) => c.spec.imageId)), out: string[] = [];
      for (const img of e.images()) if (!used.has(img.id)) { await e.rmi(img.id); out.push(img.names.join(', ')); }
      return { text: out.length ? `🧹 Images supprimées : ${out.join(' ; ')}` : '🧹 Rien à nettoyer.' };
    } },
    { id: 'ports', label: 'Les ports des applis', what: 'Chaque appli et son port, au même endroit (Odin, ses services réseau, les applis installées)', read: true, words: ['quels ports', 'les ports', 'ports des applis', 'tableau des ports', 'ip du conteneur', 'adresse du conteneur', 'acces du conteneur'], run: (ctx) => {
      const mods = ctx.modules(), own = mods.map((m) => `- ${m.name} : ${portsText(m.id)}`), apps = APP_PORTS.map((a) => `- ${a.name} : ${a.host} → ${a.inner} dans le conteneur`);
      return { text: `Interface d'Odin : ${WEB}\nServices réseau d'Odin :\n${ODIN_PORTS.filter((p) => p.app !== 'odin').map((p) => `- ${p.name} : ${p.port}/${p.proto.toUpperCase()} · ${p.what} (${p.where})`).join('\n')}\nApplis d'Odin :\n${own.join('\n')}\nApplis installées (ports fixes) :\n${apps.join('\n')}\nServices mis à l'échelle : ${SERVICES_RANGE[0]}-${SERVICES_RANGE[1]}\nPorts directs des applis d'Odin (proposés) : ${DIRECT_RANGE[0]}-${DIRECT_RANGE[1]} · voir « ports directs » (Thermopyles) ou Réglages → Ports`, data: { odin: ODIN_PORTS, applis: APP_PORTS.map((a) => ({ name: a.name, host: a.host, inner: a.inner })), modules: mods.map((m) => ({ id: m.id, name: m.name, ports: portsText(m.id) })) } };
    } },
    { id: 'services', label: 'Services mis à l\'échelle', what: 'Les services en plusieurs copies : copies prêtes, visiteurs, pourquoi', read: true, words: ['mise a l\'echelle', 'autoscaling', 'combien de copies'], run: () => { const l = services(engine() as Engine); return { text: l.map(({ spec: sp, state: st }) => `- ${sp.name} · ${st.status} · ${st.replicas.filter((r) => r.healthy).length} copies (${sp.scale.min}-${sp.scale.max}) · ${st.active} visiteurs · ${st.reason}`).join('\n') || 'Aucun service mis à l\'échelle.', data: l.map((x) => { const b = budget(x.spec.budgetPct, { cpus: x.spec.budget?.cpus, memory: x.spec.budget?.memory ? bytes(x.spec.budget.memory) : undefined }), per = { cpus: Number(x.spec.per.cpus) || 1, memory: bytes(x.spec.per.memory) }, n = x.state.replicas.length; return { ...x, budget: { cpus: b.cpus, memory: b.memory, usedCpus: n * per.cpus, usedMemory: n * per.memory, room: Math.max(0, Math.min(Math.floor((b.cpus - n * per.cpus) / per.cpus), per.memory ? Math.floor((b.memory - n * per.memory) / per.memory) : Infinity)) } }; }) }; } },
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
  async view(ctx) {
    const e = engine(); let cts: Ctr[] = [], err = '';
    try { cts = e.ps(true); } catch (x) { err = (x as Error).message; }
    const pgBases = (() => { try { return urdrBases(ctx.home).filter((b) => b.conteneur === PG_SERVER); } catch { return []; } })();
    const imgs = err ? [] : e.images(), up = cts.filter((c) => c.state.status === 'en marche').length;
    const jobs = err ? [] : e.jobs(), live = jobs.filter((j) => !j.ended);
    let svcs: ReturnType<typeof services> = []; try { svcs = services(e as Engine); } catch { /* pas de service */ }
    return {
      subtitle: !moteurIci() ? TEXTES_ARCHE.pasDeMoteur : err || `${up} en marche sur ${cts.length} · moteur d'Odin, sans démon`,
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
        // Une appli qui a sa base dans la base d'Odin : un bouton l'ouvre dans Alexandrie Studio.
        { kind: 'cards', title: 'Conteneurs', empty: err || 'Aucun conteneur : « Lancer une appli », ou dans la discussion « run -d -p 8080:80 » suivi du nom de l\'image.', items: cts.map((c) => ({
          title: c.spec.name, sub: `${c.spec.labels['odin.service'] ? `copie de ${c.spec.labels['odin.service']} · ` : ''}${c.spec.labels['odin.grandir'] ? `grandit tout seul (${c.spec.memory} · ${c.spec.cpus} cœurs) · ` : ''}${c.spec.image}${c.state.ip ? ` · ${c.state.ip}` : ''}${c.spec.ports.length ? ` · ${c.spec.ports.map((p) => `${p.host}→${p.inner}`).join(', ')}` : ''}`,
          badge: c.state.status, tone: c.state.status === 'en marche' ? 'bon' as const : c.state.status === 'redémarre' ? 'attention' as const : 'neutre' as const,
          actions: [c.state.status === 'en marche' ? { action: 'arreter', label: 'Arrêter', input: { conteneur: c.spec.name } } : { action: 'demarrer', label: 'Démarrer', input: { conteneur: c.spec.name } }, { action: 'journaux', label: 'Journal', input: { conteneur: c.spec.name } }, { action: 'mettre_a_jour', label: 'Mettre à jour', input: { conteneur: c.spec.name } }, { action: 'supprimer', label: 'Supprimer', input: { conteneur: c.spec.name } }, ...(() => { const b = pgBases.find((x) => x.nom === c.spec.name || x.utilisateur === roleOf(c.spec.name)); return b ? [{ action: 'ouvrir', label: 'Sa base (Alexandrie)', input: { base: b.id }, module: 'urdr' }] : []; })()],
        })) },
        { kind: 'table', title: 'Nouvelles versions', columns: ['Image', 'Conteneurs', 'État'], empty: 'Pas encore vérifié : « Nouvelles versions des images » (fait aussi toutes les 6 heures).', rows: versionsDe(ctx).map((v) => ({ cells: [v.image, v.conteneurs.join(', '), v.erreur ? `pas vérifiée : ${v.erreur}` : v.nouvelle ? 'nouvelle version' : 'à jour'], ...(v.nouvelle ? { tone: 'attention' as const, actions: [{ action: 'mettre_a_jour', label: 'Mettre à jour', input: { conteneur: v.conteneurs[0] } }] } : {}) })) },
        { kind: 'table', title: 'Images', columns: ['Image', 'Identifiant', 'Taille'], empty: 'Aucune image.', rows: imgs.flatMap((i) => i.names.map((n) => ({ cells: [n, i.id.slice(0, 12), `${(i.size / 1e6).toFixed(0)} Mo`] }))) },
        { kind: 'text', title: 'Dans la discussion aussi', text: 'Écris directement : run -d --name web -p 8080:80 <image> · ps · logs web · stop web · start web · exec web ls / · pull <image> · images · rm web. Lancer, supprimer et exec demandent ton accord.' },
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
    for (const n of was) if (!now.includes(n) && cts.find((x) => x.spec.name === n)?.state.status === 'sorti') { const c = cts.find((x) => x.spec.name === n); ctx.alert({ level: 'haute', title: `Le conteneur « ${n} » s'est arrêté`, detail: c ? `${c.state.status}${c.state.exitCode !== undefined ? ` (code ${c.state.exitCode})` : ''}${c.state.error ? ` — ${c.state.error}` : ''}` : 'disparu', key: `down:${n}`, lien: 'naglfar-alerte-conteneur' }); ctx.emit('conteneur_arrete', { conteneur: n }); }
    ctx.saveSettings({ running: now });
    if (ctx.now().getTime() - Number(ctx.settings.versionsQuand ?? 0) > 6 * 3600_000 && cts.length) await controlerVersions(ctx).catch(() => undefined);
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

// ---------------------------------------------------------------------------------------------------------------
// Lot K1 (maquette « Arche et Hydre » validée le 23/11) : le tableau de bord et la fiche d'un conteneur.
//   - lectures : `tableau` (ce qui tourne, processeur, mémoire, disque, arrêtés, mises à jour connues), `fiche` (ports,
//     dossiers, variables aux secrets masqués, redémarrage, limites, données) et `journal_direct` (les dernières lignes,
//     relues à chaque appel et BORNÉES : le moteur ne lit que la fin du fichier, au plus 400 lignes de 2 000 caractères
//     renvoyées, secrets des variables masqués) ;
//   - gestes, au propriétaire seul et notés dans « qui a fait quoi » : `geste_fiche` (démarrer, arrêter,
//     redémarrer), `ressources` (mémoire et cœurs), `terminal` (UNE commande à la fois, après confirmation : pas de
//     terminal interactif aujourd'hui), `supprimer_fiche` (ses données sont GARDÉES par défaut ; les effacer exige
//     son nom tapé à l'identique, et seuls ses dossiers en écriture qui ne sont ni près de la racine, ni le dossier
//     personnel, ni partagés avec un autre conteneur, ni dans les données d'Odin peuvent partir).
// Ailleurs que sous Linux, il n'y a pas de moteur aujourd'hui : le tableau le dit (et ce qui viendra), les gestes refusent.
// ---------------------------------------------------------------------------------------------------------------
/** Les textes du serveur pour le tableau et la fiche (la page a les siens, dans MOTS). */
export const TEXTES_ARCHE = {
  pasDeMoteur: 'Pas de moteur de conteneurs sur ce PC aujourd\'hui : le moteur d\'Odin ne marche que sous Linux.',
  avenir: 'À venir sur Windows : les conteneurs dans le sous-système Linux livré avec Windows (WSL2), avec les mêmes écrans. En attendant, rien ne se lance ici.',
  nomFaux: 'Pour effacer ses données, écris son nom exact (« {nom} ») : rien n\'a été supprimé.',
  interactif: '« {cmd} » attend qu\'on tape dedans : il n\'y a pas encore de terminal interactif. Lance une commande qui finit seule (par exemple « ls -la », « cat fichier », « df -h »).',
  occupe: 'Une commande tourne déjà dans {nom} : attends qu\'elle finisse (une seule à la fois).',
  arrete: '{nom} est arrêté : démarre-le pour lancer une commande dedans.',
  tropLongue: 'Commande trop longue (500 caractères au plus).',
  vide: 'Quelle commande ?',
};
const remplir = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_m, k: string) => v[k] ?? '');
/** Ce que le tableau et les gestes demandent au système (remplaçable dans les essais : aucun vrai conteneur). */
export const systemeArche = {
  plateforme: (): string => process.platform,
  stat: (c: Ctr): CgStat | undefined => cgStat(join('/sys/fs/cgroup/odin', c.id.slice(0, 12))),
  disque: (dir: string): { libre: number; total: number } | undefined => { try { const x = statfsSync(dir); return { libre: x.bavail * x.bsize, total: x.blocks * x.bsize }; } catch { return undefined; } },
  coeurs: (): number => cpus().length || 1,
  dossierMoteur: (): string => (engine() as Partial<Engine>).store?.dir ?? defaultDir(),
  maison: (): string => homedir(),
};
const moteurIci = () => systemeArche.plateforme() === 'linux';
function exigerMoteur(): void { if (!moteurIci()) throw new Error(`${TEXTES_ARCHE.pasDeMoteur} ${TEXTES_ARCHE.avenir}`); }

// ---- secrets : jamais montrés (journal, fiche, sortie du terminal) ----
const CLE_SECRETE_ENV = /(pass|pwd|secret|token|jeton|cle|key|api|auth|cred|priv|cert|salt|session|cookie|signature|dsn|database_url)/i;
export const estSecrete = (cle: string): boolean => CLE_SECRETE_ENV.test(cle);
/** Les valeurs des variables qui ressemblent à des secrets (les plus longues d'abord, pour masquer sans laisser de bout). */
export function secretsDe(env: Record<string, string>): string[] {
  const l = Object.entries(env ?? {}).filter(([k, v]) => estSecrete(k) && String(v ?? '').length >= 4).map(([, v]) => String(v));
  // Un mot de passe glissé dans une adresse (« postgres://appli:motdepasse@hôte/base »), quelle que soit la variable.
  for (const v of Object.values(env ?? {})) for (const m of String(v ?? '').matchAll(/\/\/[^\s:/@]+:([^\s@/]{4,})@/g)) l.push(decodeURIComponent(m[1]), m[1]);
  return [...new Set(l)].sort((a, b) => b.length - a.length);
}
const MASQUE = '••••••';
/** Masque les secrets connus et ce qui y ressemble (« password=… », « Bearer … », « utilisateur:motdepasse@ »). Pur. */
export function masquer(t: string, secrets: string[] = []): string {
  let x = String(t ?? '');
  for (const v of secrets) if (v) x = x.split(v).join(MASQUE);
  // (« "password": "…" » : la clé peut être entre guillemets, comme dans une ligne JSON)
  // (le nom est borné, 64 caractères de part et d'autre : sans borne, une longue ligne « pass.pass.pass… » prenait un
  // temps cubique et bloquait Odin entier)
  x = x.replace(/\b([\w.-]{0,64}?(?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth)[\w.-]{0,64})(["']?\s*[=:]\s*)((?:Bearer|Basic|Token)\s+)?("[^"]*"|'[^']*'|[^\s,;&]+)/gi, (_m, k: string, sp: string, schema?: string) => `${k}${sp}${schema ?? ''}${MASQUE}`);
  x = x.replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${MASQUE}`);
  x = x.replace(/(\/\/[^\s:/@]+:)[^\s@/]+@/g, `$1${MASQUE}@`);
  return x;
}
/** Une ligne écrite par un programme, rendue sûre à montrer comme du texte : sans couleurs du terminal ni caractères de contrôle. */
const nettoyer = (t: string) => String(t ?? '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');

// ---- le journal, borné ----
export const JOURNAL_MAX = 400, LIGNE_MAX = 2000;
export interface LigneJournal { at: string; flux: 'sortie' | 'erreur'; texte: string; coupee?: boolean }
/** Les dernières lignes du journal d'un conteneur (après `depuis` si donné) : bornées, nettoyées, secrets masqués. */
export function journalBorne(c: Ctr, o: { depuis?: string; n?: number } = {}): { lignes: LigneJournal[]; borne: number } {
  const n = Math.min(JOURNAL_MAX, Math.max(1, Math.floor(Number(o.n) || 200))), secrets = secretsDe(c.spec.env);
  let l = engine().logs(c.spec.name, JOURNAL_MAX);   // le moteur ne lit que la fin du fichier (2 Mo au plus), jamais tout
  if (o.depuis) l = l.filter((x) => x.at > String(o.depuis));
  return { borne: JOURNAL_MAX, lignes: l.slice(-n).map((x) => {
    // Masqué AVANT d'être coupé : un secret à cheval sur la borne ne laisse aucun bout visible.
    const t = masquer(nettoyer(x.text), secrets), coupee = t.length > LIGNE_MAX;
    return { at: x.at, flux: x.stream === 'e' ? 'erreur' as const : 'sortie' as const, texte: coupee ? t.slice(0, LIGNE_MAX) : t, ...(coupee ? { coupee } : {}) };
  }) };
}

// ---- les données d'un conteneur (ses dossiers en écriture) ----
const DOSSIERS_PERSO = /^(images|pictures|photos|videos|vidéos|musique|music|documents|bureau|desktop|telechargements|téléchargements|downloads|public|modeles|modèles|templates)$/i;
/** Un dossier à toi, même rangé plus bas (« …/Documents/notes », « /mnt/c/Users/moi/Images/… ») : jamais effacé. */
const PERSO_PLUS_BAS = /^(images|pictures|photos|videos|vidéos|musique|music|documents|bureau|desktop|telechargements|téléchargements|downloads|onedrive|dropbox)$/i;
/** Les dossiers du système (Linux, et Windows vu depuis Linux) : jamais effacés, même si un conteneur y écrit. */
const SYSTEME_RACINE = /^(etc|usr|bin|sbin|lib|lib32|lib64|libx32|boot|dev|proc|sys|run|root|snap|var|opt|lost\+found)$/i;
const SYSTEME_PARTOUT = /^(windows|program files|program files \(x86\)|programdata|system32)$/i;
/** Un système qui ne distingue pas les majuscules (Windows, macOS) : « C:\Odin » et « c:\odin » sont le même dossier. */
const sansCasse = () => process.platform === 'win32' || process.platform === 'darwin';
const pour = (p: string) => { const r = resolve(p); return sansCasse() ? r.toLowerCase() : r; };
const dedansOuEgal = (p: string, racine: string) => { const a = pour(p), b = pour(racine); return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep); };
const morceaux = (p: string) => resolve(p).split(/[\\/]+/).filter(Boolean).filter((x, i) => !(i === 0 && /^[a-z]:$/i.test(x)));
const vrai = (p: string): string | undefined => { try { return realpathSync.native(p); } catch { return undefined; } };
export interface Donnee { dossier: string; dedans: string; effacable: boolean; raison?: string; /** le vrai chemin vérifié (liens suivis) : c'est lui qui est effacé */ reel?: string }
/** Pourquoi ce chemin ne peut pas être effacé (undefined : il peut). Vérifié sur le chemin écrit ET sur le vrai chemin. */
function pourquoiGarder(p: string, odinHome: string): string | undefined {
  const parts = morceaux(p), maison = systemeArche.maison();
  if (parts.length < 3) return 'trop près de la racine du disque';
  if (SYSTEME_RACINE.test(parts[0]) || parts.some((x) => SYSTEME_PARTOUT.test(x))) return 'un dossier du système';
  if (dedansOuEgal(maison, p) || pour(dirname(resolve(p))) === pour(maison) || DOSSIERS_PERSO.test(basename(p)) || parts.some((x) => PERSO_PLUS_BAS.test(x))) return 'ton dossier personnel, ou un de tes dossiers à toi';
  if (dedansOuEgal(p, odinHome) || dedansOuEgal(odinHome, p)) return 'les données d\'Odin';
  try { const d = systemeArche.dossierMoteur(); if (dedansOuEgal(p, d) || dedansOuEgal(d, p)) return 'le moteur de conteneurs d\'Odin'; } catch { /* pas de moteur */ }
  return undefined;
}
/** Les dossiers où le conteneur ÉCRIT, et pour chacun s'il peut être effacé avec lui (jamais un dossier système ou personnel). */
export function donneesDe(c: Ctr, tous: Ctr[], odinHome: string): Donnee[] {
  return c.spec.mounts.filter((m) => !m.ro).map((m) => {
    const refus = (r: string): Donnee => ({ dossier: m.host, dedans: m.inner, effacable: false, raison: r });
    // Un volume nommé (lot K2) ne part jamais avec le conteneur : il se supprime dans « Volumes », quand plus rien ne s'en sert.
    if (m.volume) return { dossier: `volume ${m.volume}`, dedans: m.inner, effacable: false, raison: 'un volume : il reste, et se supprime dans « Volumes » quand plus rien ne s\'en sert' };
    if (!isAbsolute(m.host)) return refus('trop près de la racine du disque');
    const r1 = pourquoiGarder(m.host, odinHome); if (r1) return refus(r1);
    let reel: string | undefined;
    try { if (lstatSync(m.host).isSymbolicLink()) return refus('c\'est un lien vers un autre dossier'); reel = vrai(m.host); } catch { return refus('ce dossier n\'existe plus'); }
    if (!reel) return refus('ce dossier n\'existe plus');
    // Un lien ou une jonction posé PLUS HAUT dans le chemin : le vrai dossier est vérifié lui aussi.
    const r2 = pourquoiGarder(reel, odinHome); if (r2) return refus(pour(reel) === pour(m.host) ? r2 : `${r2} (par un lien plus haut dans le chemin)`);
    const ici = [m.host, reel];
    const autre = tous.find((x) => x.id !== c.id && x.spec.mounts.some((y) => [y.host, vrai(y.host)].some((h) => h && ici.some((p) => dedansOuEgal(h, p) || dedansOuEgal(p, h)))));
    if (autre) return refus(`aussi utilisé par ${autre.spec.name}`);
    return { dossier: m.host, dedans: m.inner, effacable: true, reel };
  });
}

// ---- le tableau de bord ----
const precedent = new Map<string, CgStat>();
const REDEMARRAGE: Record<string, string> = { 'sauf-arret': 'sauf si je l\'arrête', toujours: 'toujours', 'si-erreur': 'si erreur', non: 'jamais' };
const enErreur = (c: Ctr) => c.state.status === 'sorti' && ((c.state.exitCode ?? 0) !== 0 || Boolean(c.state.error));
function mesure(c: Ctr): { cpu?: number; memoire?: number; memoireMax?: number } {
  if (c.state.status !== 'en marche') { precedent.delete(c.id); return {}; }
  const cur = systemeArche.stat(c); if (!cur) return {};
  const prev = precedent.get(c.id); precedent.set(c.id, cur);
  const cpu = prev && cur.at > prev.at ? Math.max(0, Math.min(100, ((cur.usageUsec - prev.usageUsec) / ((cur.at - prev.at) * 1000) / systemeArche.coeurs()) * 100)) : undefined;
  return { ...(cpu === undefined ? {} : { cpu: Math.round(cpu * 10) / 10 }), memoire: cur.memCurrent, memoireMax: cur.memMax };
}
export function tableauArche(ctx: ModCtx): Record<string, unknown> {
  const plateforme = systemeArche.plateforme();
  if (!moteurIci()) return { moteur: false, nom: nomArche(), plateforme, raison: TEXTES_ARCHE.pasDeMoteur, avenir: TEXTES_ARCHE.avenir, conteneurs: [] };
  const e = engine(); let cts: Ctr[] = [], erreur = '';
  try { cts = e.ps(true); } catch (x) { erreur = (x as Error).message; }
  const vers = versionsDe(ctx).filter((v) => v.nouvelle);
  const l = cts.map((c) => { const m = mesure(c); return {
    nom: c.spec.name, id: c.id.slice(0, 12), image: c.spec.image, etat: c.state.status, enMarche: c.state.status === 'en marche', enErreur: enErreur(c),
    depuis: c.state.status === 'en marche' ? c.state.startedAt : c.state.finishedAt, ip: c.state.ip, ports: c.spec.ports.map((p) => ({ hote: p.host, dedans: p.inner, proto: p.proto ?? 'tcp' })),
    erreur: c.state.error ? masquer(nettoyer(c.state.error), secretsDe(c.spec.env)).slice(0, 300) : undefined, code: c.state.exitCode, relances: c.state.restarts ?? 0,
    service: c.spec.labels['odin.service'] || undefined, pile: c.spec.labels['odin.pile'] || undefined, limiteMemoire: c.spec.memory ? bytes(c.spec.memory) : undefined, coeurs: c.spec.cpus ? Number(c.spec.cpus) : undefined,
    majDispo: vers.some((v) => v.conteneurs.includes(c.spec.name)), ...m,
  }; });
  const imgs = erreur ? [] : e.images(), d = systemeArche.disque(systemeArche.dossierMoteur());
  const on = l.filter((x) => x.enMarche);
  return {
    moteur: true, nom: nomArche(), plateforme, erreur: erreur || undefined, conteneurs: l,
    totaux: { total: l.length, enMarche: on.length, enErreur: l.filter((x) => x.enErreur).length, arretes: l.filter((x) => !x.enMarche && !x.enErreur).length,
      cpu: on.some((x) => x.cpu !== undefined) ? Math.round(on.reduce((a, x) => a + (x.cpu ?? 0), 0) * 10) / 10 : undefined, memoire: on.reduce((a, x) => a + (x.memoire ?? 0), 0), memoireMachine: totalmem(), coeurs: systemeArche.coeurs() },
    disque: { images: imgs.reduce((a, i) => a + i.size, 0), nbImages: imgs.length, ...(d ?? {}) },
    majs: vers.map((v) => ({ image: v.image, conteneurs: v.conteneurs })),
    installations: erreur ? 0 : e.jobs().filter((j) => !j.ended).length,
    // lot K3 : combien de piles (l'onglet « Piles » de la page se montre dès qu'il y en a une)
    piles: erreur ? 0 : (() => { try { return piles(e as unknown as MoteurPile).length; } catch { return 0; } })(),
  };
}
export function ficheArche(ctx: ModCtx, nom: string): Record<string, unknown> {
  exigerMoteur();
  const e = engine(), c = e.find(nom), tous = e.ps(true), sp = c.spec, secrets = secretsDe(sp.env);
  const b = (() => { try { return urdrBases(ctx.home).filter((x) => x.conteneur === PG_SERVER).find((x) => x.nom === sp.name || x.utilisateur === roleOf(sp.name)); } catch { return undefined; } })();
  return {
    nom: sp.name, id: c.id.slice(0, 12), image: sp.image, cree: sp.created, etat: c.state.status, enMarche: c.state.status === 'en marche', enErreur: enErreur(c),
    depuis: c.state.startedAt, finiLe: c.state.finishedAt, code: c.state.exitCode, erreur: c.state.error ? masquer(nettoyer(c.state.error), secrets).slice(0, 300) : undefined, relances: c.state.restarts ?? 0, ip: c.state.ip,
    ports: sp.ports.map((p) => ({ hote: p.host, dedans: p.inner, proto: p.proto ?? 'tcp' })),
    dossiers: sp.mounts.map((m) => ({ hote: m.volume ? `volume ${m.volume}` : m.host, dedans: m.inner, lecture: m.ro, ...(m.volume ? { volume: m.volume } : {}) })),
    variables: Object.entries(sp.env).map(([k, v]) => (estSecrete(k) ? { cle: k, valeur: MASQUE, secrete: true } : { cle: k, valeur: masquer(nettoyer(String(v)), secrets).slice(0, 300) })),
    redemarrage: REDEMARRAGE[sp.restart] ?? sp.restart, limiteMemoire: sp.memory, limiteCoeurs: sp.cpus, grandir: sp.labels['odin.grandir'] || undefined, reseau: sp.network === 'hote' ? 'celui de la machine' : sp.network === 'aucun' ? 'aucun (ni Internet ni la maison)' : sp.reseau ? `le réseau à part « ${sp.reseau} »` : 'le réseau des conteneurs',
    service: sp.labels['odin.service'] || undefined, base: b ? { id: b.id, nom: b.nom } : undefined,
    donnees: donneesDe(c, tous, ctx.home).map(({ reel: _r, ...x }) => x), majDispo: versionsDe(ctx).some((v) => v.nouvelle && v.conteneurs.includes(sp.name)),
    ...mesure(c),
  };
}

// ---- le terminal : une commande à la fois ----
const INTERACTIFS = /^(vi|vim|nvim|nano|emacs|pico|joe|less|more|most|top|htop|btop|watch|man|ssh|telnet|ftp|screen|tmux|mc|irb|ipython|psql|mysql|mariadb|sqlite3|redis-cli|mongo|mongosh|node|python\d?(\.\d+)?|bash|sh|zsh|ash|dash|fish|ksh|su|sudo|login|passwd)$/;
/** Vrai si la commande attend qu'on tape dedans (un éditeur, un interpréteur ou un interpréteur de commandes sans rien à lancer). Pur. */
export function attendQuOnTape(argv: string[]): boolean {
  const p = (argv[0] ?? '').split('/').pop() ?? '';
  if (!INTERACTIFS.test(p)) return p === 'tail' && argv.some((a) => a === '-f' || a === '-F' || a === '--follow');
  if (/^(sudo|su|passwd|login)$/.test(p)) return true;
  // « sh -c 'ls' », « python3 -c … », « psql -c … », « mysql -e … », « node -e … » finissent seuls.
  if (argv.some((a) => /^-(c|e|-command|-eval|-execute)$/.test(a))) return false;
  if (/^(python\d?(\.\d+)?|node|bash|sh|zsh|ash|dash)$/.test(p) && argv.length > 1 && !argv[1].startsWith('-')) return false; // un script donné
  return !/^(--version|-v|-V|--help)$/.test(argv[1] ?? '');
}
const enCoursTerminal = new Set<string>();
export const TERMINAL = { delaiMs: 30_000, sortieMax: 64 * 1024 };
async function lancerUne(c: Ctr, argv: string[]): Promise<{ sortie: string; code: number; coupee: boolean; tropLong: boolean; ms: number }> {
  const x = await engine().execArgs(c.spec.name, argv), t0 = Date.now();
  return new Promise((ok) => {
    let out = '', coupee = false, tropLong = false, fini = false, grace: ReturnType<typeof setTimeout> | undefined;
    // Son propre groupe de processus (hors Windows) : l'outil qui entre dans le conteneur se dédouble, et ce qu'il lance
    // (ou laisse derrière lui : « sh -c 'sleep 9999 &' ») est tué avec lui ; tuer le seul premier processus laisserait
    // le reste tourner, la sortie ouverte, et l'action ne rendrait jamais la main (une seule commande à la fois : bloquée).
    const groupe = process.platform !== 'win32';
    const p = spawn(x.cmd, x.args, { env: x.env, stdio: ['ignore', 'pipe', 'pipe'], detached: groupe });
    const tuer = () => { try { if (groupe && p.pid) process.kill(-p.pid, 'SIGKILL'); else p.kill('SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* déjà parti */ } } };
    const finir = (code: number, sortie = out) => {
      if (fini) return; fini = true; clearTimeout(minuteur); if (grace) clearTimeout(grace);
      p.stdout?.destroy(); p.stderr?.destroy();
      ok({ sortie, code, coupee, tropLong, ms: Date.now() - t0 });
    };
    const prendre = (b: Buffer) => { if (out.length >= TERMINAL.sortieMax) { coupee = true; return; } out += b.toString('utf8'); if (out.length > TERMINAL.sortieMax) { out = out.slice(0, TERMINAL.sortieMax); coupee = true; } };
    p.stdout?.on('data', prendre); p.stderr?.on('data', prendre);
    const minuteur = setTimeout(() => { tropLong = true; tuer(); grace = setTimeout(() => finir(137), 2000); }, TERMINAL.delaiMs);
    p.on('error', (er) => finir(127, er.message));
    // Fini, mais un programme laissé derrière garde la sortie ouverte : il est arrêté, et l'action rend la main.
    p.on('exit', (code) => { if (!fini && !grace) grace = setTimeout(() => { tuer(); finir(code ?? 1); }, 500); });
    p.on('close', (code) => finir(code ?? 1));
  });
}

const CT_ARCHE: Param = { key: 'conteneur', label: 'Conteneur', kind: 'text', required: true };
const nomOuTel = (i: Record<string, unknown>) => s(i.conteneur).trim().slice(0, 80);
/** Le tableau, la fiche et le journal (lectures) ; les gestes de la fiche, au propriétaire seul et notés (« qui a fait quoi »). */
// Ces trois lectures ne sont pas marquées « read » : le banc figé de Soul photographie les lectures du catalogue
// (test/soul-banc/jeux/actions-monde.json, sous empreinte) ; elles ne changent rien et restent ouvertes (pas « propriétaire seul »).
const actionsK1: Action[] = [
  { id: 'tableau', label: 'Tableau de bord', what: 'Ce qui tourne, processeur, mémoire, disque, conteneurs arrêtés et mises à jour connues', quick: false, quiet: true, run: (ctx) => {
    const t = tableauArche(ctx) as { moteur: boolean; raison?: string; avenir?: string; totaux?: { enMarche: number; total: number; arretes: number; enErreur: number } };
    return { text: t.moteur ? `${t.totaux!.enMarche} en marche sur ${t.totaux!.total} · ${t.totaux!.arretes} arrêté(s) · ${t.totaux!.enErreur} en erreur` : `${t.raison} ${t.avenir}`, data: t };
  } },
  { id: 'fiche', label: 'Fiche d\'un conteneur', what: 'Ports, dossiers, variables (secrets masqués), redémarrage, limites, ses données', quick: false, quiet: true, params: [CT_ARCHE], run: (ctx, i) => {
    const f = ficheArche(ctx, safe(i.conteneur)); return { text: `${String(f.nom)} · ${String(f.image)} · ${String(f.etat)}`, data: f };
  } },
  { id: 'journal_direct', label: 'Journal en direct', what: `Les dernières lignes du journal d'un conteneur (au plus ${JOURNAL_MAX}, relues à chaque fois, secrets masqués)`, quick: false, quiet: true, external: true,
    params: [CT_ARCHE, { key: 'depuis', label: 'Après cette heure', kind: 'text', default: '' }, { key: 'n', label: 'Combien de lignes', kind: 'number', default: 200 }], run: (_ctx, i) => {
      exigerMoteur(); const c = engine().find(safe(i.conteneur)), j = journalBorne(c, { depuis: s(i.depuis) || undefined, n: Number(i.n) || undefined });
      return { text: j.lignes.map((l) => l.texte).join('\n') || '(journal vide)', data: { conteneur: c.spec.name, enMarche: c.state.status === 'en marche', ...j } };
    } },
  { id: 'geste_fiche', label: 'Démarrer, arrêter ou redémarrer', what: 'Le geste de la fiche d\'un conteneur', quick: false, proprietaireSeul: true,
    params: [CT_ARCHE, { key: 'geste', label: 'Geste', kind: 'select', options: ['redemarrer', 'arreter', 'demarrer'], required: true }],
    grave: (i) => (s(i.geste) === 'arreter' ? `arrêter le conteneur ${nomOuTel(i)} (ce qu'il sert ne répond plus jusqu'à ce que tu le relances)` : undefined),
    run: async (ctx, i) => {
      exigerMoteur(); const n = safe(i.conteneur), g = s(i.geste), e = engine();
      if (g === 'arreter') { forget(ctx, n); const c = await e.stop(n); return { text: `⏹ ${c.spec.name} arrêté.` }; }
      if (g === 'demarrer') { const c = await e.start(n); ctx.saveSettings({ running: [...new Set([...((ctx.settings.running as string[]) ?? []), c.spec.name])] }); return { text: `▶ ${c.spec.name} démarré.` }; }
      if (g === 'redemarrer') { const c = await e.restart(n); return { text: `🔄 ${c.spec.name} redémarré.` }; }
      throw new Error(`geste inconnu : ${g.slice(0, 20)}`);
    } },
  { id: 'ressources', label: 'Ressources d\'un conteneur', what: 'Mémoire et cœurs permis, changés sans l\'arrêter', quick: false, proprietaireSeul: true,
    params: [CT_ARCHE, { key: 'memoire', label: 'Mémoire max (512m, 2g)', kind: 'text', default: '' }, { key: 'coeurs', label: 'Cœurs max (0.5, 2)', kind: 'text', default: '' }],
    run: async (_ctx, i) => {
      exigerMoteur(); const m = s(i.memoire).trim(), k = s(i.coeurs).trim().replace(',', '.');
      if (!m && !k) throw new Error('donne la mémoire ou les cœurs');
      if (m && !/^\d+(\.\d+)?[kmg]$/i.test(m)) throw new Error(`mémoire illisible : ${m.slice(0, 20)} (ex. 512m, 2g)`);
      if (m && bytes(m) < 16 * 1024 ** 2) throw new Error('16 Mo au moins');
      if (k && !(Number(k) >= 0.1 && Number(k) <= systemeArche.coeurs())) throw new Error(`cœurs : entre 0,1 et ${systemeArche.coeurs()}`);
      const c = await engine().resize(safe(i.conteneur), { memory: m || undefined, cpus: k || undefined });
      return { text: `🎚 ${c.spec.name} : ${c.spec.memory ?? 'mémoire libre'} · ${c.spec.cpus ?? 'tous les'} cœurs.` };
    } },
  { id: 'terminal', label: 'Une commande dans un conteneur', what: 'Une seule commande, avec les droits du conteneur, après ta confirmation (pas encore de terminal interactif)', quick: false, proprietaireSeul: true, external: true,
    params: [CT_ARCHE, { key: 'commande', label: 'Commande', kind: 'text', required: true }],
    // Une commande plus longue que ce que montre la confirmation le dit (rien de caché sans qu'il le sache).
    grave: (i) => `lancer « ${s(i.commande).trim().slice(0, 120)}${s(i.commande).trim().length > 120 ? ` … » (${s(i.commande).trim().length - 120} caractères de plus, pas montrés ici)` : ' »'} dans ${nomOuTel(i)} : elle agit dans le conteneur avec ses droits, et ce qu'elle change ne se défait pas tout seul`,
    run: async (_ctx, i) => {
      exigerMoteur();
      const ligne = s(i.commande).trim(); if (!ligne) throw new Error(TEXTES_ARCHE.vide); if (ligne.length > 500) throw new Error(TEXTES_ARCHE.tropLongue);
      const argv = splitLine(ligne), c = engine().find(safe(i.conteneur));
      if (c.state.status !== 'en marche') throw new Error(remplir(TEXTES_ARCHE.arrete, { nom: c.spec.name }));
      if (attendQuOnTape(argv)) throw new Error(remplir(TEXTES_ARCHE.interactif, { cmd: argv.slice(0, 2).join(' ').slice(0, 60) }));
      if (enCoursTerminal.has(c.id)) throw new Error(remplir(TEXTES_ARCHE.occupe, { nom: c.spec.name }));
      enCoursTerminal.add(c.id);
      try {
        const r = await lancerUne(c, argv), sortie = masquer(nettoyer(r.sortie), secretsDe(c.spec.env)).trimEnd();
        const fin = r.tropLong ? `\n(arrêtée au bout de ${TERMINAL.delaiMs / 1000} s)` : r.coupee ? '\n(sortie coupée à 64 Ko)' : '';
        return { ok: r.code === 0, text: `${sortie || '(rien)'}${fin}${r.code ? `\n(code ${r.code})` : ''}`, data: { conteneur: c.spec.name, commande: ligne, sortie, code: r.code, coupee: r.coupee, tropLong: r.tropLong, ms: r.ms } };
      } finally { enCoursTerminal.delete(c.id); }
    } },
  { id: 'supprimer_fiche', label: 'Supprimer un conteneur (garde-fou)', what: 'Supprime un conteneur ; ses données sont gardées, sauf si tu écris son nom pour les effacer aussi', quick: false, proprietaireSeul: true,
    params: [CT_ARCHE, { key: 'donnees', label: 'Ses données', kind: 'select', options: ['garder', 'effacer'], default: 'garder' }, { key: 'nom_tape', label: 'Son nom, pour effacer ses données', kind: 'text', default: '' }],
    grave: (i) => (s(i.donnees) === 'effacer' ? `supprimer le conteneur ${nomOuTel(i)} ET effacer ses données : elles ne pourront pas revenir` : `supprimer le conteneur ${nomOuTel(i)} (ses données sont gardées)`),
    run: async (ctx, i) => {
      exigerMoteur();
      const e = engine(), c = e.find(safe(i.conteneur)), effacer = s(i.donnees) === 'effacer';
      // Le nom tapé est vérifié AVANT de toucher à quoi que ce soit.
      if (effacer && s(i.nom_tape).trim() !== c.spec.name) throw new Error(remplir(TEXTES_ARCHE.nomFaux, { nom: c.spec.name }));
      const d = donneesDe(c, e.ps(true), ctx.home);
      forget(ctx, c.spec.name);
      await e.rm(c.spec.name, true);
      const parties: string[] = [], gardees = effacer ? d.filter((x) => !x.effacable) : d;
      if (effacer) for (const x of d.filter((y) => y.effacable)) { try { rmSync(x.reel ?? x.dossier, { recursive: true, force: true }); parties.push(x.dossier); } catch (er) { gardees.push({ ...x, effacable: false, raison: (er as Error).message }); } }
      const t = [`🗑 ${c.spec.name} supprimé (l'image reste, réutilisable).`,
        parties.length ? `Données effacées : ${parties.join(', ')}.` : '',
        gardees.length ? `Données gardées : ${gardees.map((x) => `${x.dossier}${effacer && x.raison ? ` (${x.raison})` : ''}`).join(', ')}.` : ''].filter(Boolean).join('\n');
      return { text: t, data: { conteneur: c.spec.name, effacees: parties, gardees: gardees.map((x) => x.dossier) } };
    } },
];
/** Les actions du lot K1, déjà passées par « qui a fait quoi » (et sa lecture, au propriétaire seul). */
export const actionsArche: Action[] = [...avecJournal('naglfar_actes', actionsK1), actionJournal('naglfar_actes', nomArche())];
naglfar.actions.push(...actionsArche);

// ---------------------------------------------------------------------------------------------------------------
// Lot K2 (même maquette) : les volumes et les réseaux.
//   - volumes nommés : créer, lister (taille comptée sans suivre les liens et bornée, qui s'en sert), supprimer
//     SEULEMENT un volume que plus aucun conteneur n'utilise (même arrêté), avec son nom tapé à l'identique ; jamais
//     un volume qui passe par un lien, ni un dossier du système, personnel, d'Odin ou trop près de la racine ;
//   - sauvegarde des volumes par Phénix : un plan « Volumes d'Arche » (chaque nuit, 02:15) qui contient les volumes
//     cochés. Phénix ne sait pas encore retirer un plan : le dernier volume coché ne se décoche pas (dit franchement) ;
//   - réseaux : celui de tous les conteneurs, des réseaux à part (chacun son pont, isolé des autres, avec ou sans
//     Internet) et « aucun » ; un réseau à part ne se retire que si plus aucun conteneur ne l'utilise.
// Gestes au propriétaire seul et notés ; lectures ouvertes. Sans moteur (Windows aujourd'hui) : la page le dit.
// ---------------------------------------------------------------------------------------------------------------
export const TEXTES_K2 = {
  plan: 'Volumes d\'Arche',
  nomFaux: 'Pour supprimer le volume, écris son nom exact (« {nom} ») : rien n\'a été supprimé.',
  phenixAbsent: 'Phénix (la sauvegarde) n\'a pas répondu : {raison}',
  phenixRetrait: 'Phénix ne sait pas encore retirer un plan : « {nom} » est le dernier volume du plan « {plan} », il reste sauvegardé chaque nuit. Pour l\'arrêter, coche d\'abord un autre volume, ou attends que Phénix sache retirer un plan.',
};
type MoteurK2 = Pick<Engine, 'ps' | 'volumes' | 'createVolume' | 'rmVolume' | 'utilisateursVolume' | 'reseaux' | 'createReseau' | 'rmReseau'>;
const k2 = () => engine() as unknown as MoteurK2;
const VOLUME: Param = { key: 'volume', label: 'Volume', kind: 'text', required: true };
const RESEAU: Param = { key: 'reseau', label: 'Réseau', kind: 'text', required: true };
const nomObjet = (v: unknown, quoi: string) => { const x = s(v).trim(); if (!NOM_OBJET.test(x)) throw new Error(`nom de ${quoi} invalide : ${x.slice(0, 64)} (minuscules, chiffres, - _ .)`); return x; };
const sauves = (ctx: ModCtx): Record<string, string> => ({ ...((ctx.settings.volumesSauves as Record<string, string> | undefined) ?? {}) });
const depotVolumes = (ctx: ModCtx) => s(ctx.settings.depotVolumes).trim() || join(ctx.home, 'Sauvegardes', 'volumes');

/** Pourquoi le vrai dossier d'un volume ne peut pas être effacé (undefined : il peut). Le moteur a déjà vérifié qu'il est
 *  exactement là où il range ses volumes, sans lien ; ici : jamais un dossier du système, personnel, d'Odin. */
export function pourquoiGarderVolume(reel: string, odinHome: string): string | undefined {
  // Le nom du volume (dernier morceau) est choisi par lui (« photos », « documents ») : seul l'endroit où il est rangé compte.
  const parts = morceaux(reel), haut = parts.slice(0, -1), maison = systemeArche.maison();
  if (parts.length < 3) return 'trop près de la racine du disque';
  if (SYSTEME_RACINE.test(parts[0]) && !/^(var|opt)$/i.test(parts[0])) return 'un dossier du système';
  if (haut.some((x) => SYSTEME_PARTOUT.test(x))) return 'un dossier du système';
  if (dedansOuEgal(maison, reel) || pour(dirname(resolve(reel))) === pour(maison) || DOSSIERS_PERSO.test(basename(dirname(resolve(reel)))) || haut.some((x) => PERSO_PLUS_BAS.test(x))) return 'ton dossier personnel, ou un de tes dossiers à toi';
  if (dedansOuEgal(odinHome, reel) || dedansOuEgal(reel, odinHome)) return 'les données d\'Odin';
  return undefined;
}
/** Une raison montrée à tous (la lecture est ouverte) : sa première ligne, sans aucun chemin de la machine. */
const raisonSure = (t: unknown) => String(t ?? '').split('\n')[0].replace(/(?:[A-Za-z]:)?[\\/][^\s«»"'()]*/g, '…').slice(0, 200);
/** Les instantanés du plan des volumes dans Phénix (vide si Phénix n'en a pas, ou ne répond pas). */
async function derniereSauvegarde(ctx: ModCtx): Promise<{ derniere?: string; phenix: boolean; raison?: string }> {
  try {
    // Phénix rend le PREMIER plan venu quand le nom demandé n'existe pas : d'abord vérifier que le plan des volumes existe,
    // sinon la date d'un autre plan passerait pour celle des volumes (« Phénix en garde les sauvegardes », à tort).
    const pl = await ctx.call('sindri', 'plans', {}, 'voir si les volumes ont un plan de sauvegarde');
    if (pl.ok === false) return { phenix: false, raison: raisonSure(pl.text) };
    if (!String(pl.text ?? '').split('\n').some((l) => l.startsWith(`- ${TEXTES_K2.plan} : `))) return { phenix: true };
    const r = await ctx.call('sindri', 'instantanes', { plan: TEXTES_K2.plan }, 'voir quand les volumes ont été sauvegardés');
    if (r.ok === false) return { phenix: false, raison: raisonSure(r.text) };
    const l = Array.isArray(r.data) ? (r.data as Array<{ at?: string }>).map((x) => String(x.at ?? '')).filter(Boolean).sort() : [];
    return { derniere: l.at(-1), phenix: true };
  } catch (e) { return { phenix: false, raison: raisonSure((e as Error).message) }; }
}
export async function volumesArche(ctx: ModCtx): Promise<Record<string, unknown>> {
  if (!moteurIci()) return { moteur: false, nom: nomArche(), plateforme: systemeArche.plateforme(), raison: TEXTES_ARCHE.pasDeMoteur, avenir: TEXTES_ARCHE.avenir, volumes: [] };
  const l: VolumeVu[] = k2().volumes(), sv = sauves(ctx), ph = await derniereSauvegarde(ctx);
  return {
    moteur: true, nom: nomArche(), plan: TEXTES_K2.plan, phenix: ph.phenix, phenixRaison: ph.raison, derniere: ph.derniere,
    volumes: l.map((v) => ({ nom: v.nom, cree: v.cree, octets: v.octets, fichiers: v.fichiers, compteCoupe: v.compteCoupe, utilisePar: v.utilisePar, sansConteneur: v.utilisePar.length === 0,
      sauvegarde: Boolean(sv[v.nom]), jamaisSauvegarde: !sv[v.nom] || !ph.derniere || ph.derniere < sv[v.nom] })),
  };
}
export function reseauxArche(): Record<string, unknown> {
  if (!moteurIci()) return { moteur: false, nom: nomArche(), plateforme: systemeArche.plateforme(), raison: TEXTES_ARCHE.pasDeMoteur, avenir: TEXTES_ARCHE.avenir, reseaux: [] };
  const e = k2(), l: ReseauVu[] = e.reseaux(), cts = e.ps(true);
  return {
    moteur: true, nom: nomArche(),
    reseaux: [
      ...l.map((r) => ({ nom: r.nom, genre: r.defaut ? 'tous' : 'a-part', sousReseau: `${r.sousReseau}.0/24`, pont: r.pont, internet: r.internet, isole: !r.defaut, cree: r.cree, conteneurs: r.conteneurs })),
      { nom: 'aucun', genre: 'aucun', internet: false, isole: true, conteneurs: cts.filter((c) => c.spec.network === 'aucun').map((c) => c.spec.name) },
      ...(cts.some((c) => c.spec.network === 'hote') ? [{ nom: 'machine', genre: 'machine', internet: true, isole: false, conteneurs: cts.filter((c) => c.spec.network === 'hote').map((c) => c.spec.name) }] : []),
    ],
  };
}
/** Le plan « Volumes d'Arche » de Phénix, refait avec ces volumes (Phénix remplace un plan du même nom). */
async function planVolumes(ctx: ModCtx, noms: string[], why: string): Promise<string> {
  const vols = k2().volumes(), dirs = noms.map((n) => vols.find((v) => v.nom === n)?.dossier).filter((d): d is string => !!d);
  if (!dirs.length) throw new Error('aucun volume à sauvegarder');
  let r; try { r = await ctx.call('sindri', 'creer', { nom: TEXTES_K2.plan, dossiers: dirs.join('\n'), destination: 'disque', depot: depotVolumes(ctx), heure: '02:15' }, why); }
  catch (e) { throw new Error(remplir(TEXTES_K2.phenixAbsent, { raison: (e as Error).message.slice(0, 200) })); }
  if (r.ok === false) throw new Error(remplir(TEXTES_K2.phenixAbsent, { raison: String(r.text ?? '').split('\n')[0].slice(0, 200) }));
  return String(r.text ?? '');
}
// Les lectures ne sont pas marquées « read » (comme K1 : le banc figé de Soul photographie les lectures du catalogue).
const actionsK2: Action[] = [
  { id: 'volumes', label: 'Volumes', what: 'Les volumes des conteneurs : taille, qui s\'en sert, sauvegardé ou non par Phénix', quick: false, quiet: true, run: async (ctx) => {
    const v = await volumesArche(ctx) as { moteur: boolean; raison?: string; avenir?: string; volumes: Array<{ nom: string; octets: number; utilisePar: string[]; sauvegarde: boolean }> };
    return { text: v.moteur ? (v.volumes.map((x) => `- ${x.nom} · ${(x.octets / 1e6).toFixed(1)} Mo · ${x.utilisePar.length ? `utilisé par ${x.utilisePar.join(', ')}` : 'sans conteneur'}${x.sauvegarde ? ' · sauvegardé chaque nuit' : ''}`).join('\n') || 'Aucun volume.') : `${v.raison} ${v.avenir}`, data: v };
  } },
  { id: 'reseaux', label: 'Réseaux', what: 'Les réseaux des conteneurs : celui de tous, les réseaux à part (isolés), « aucun », et qui est dessus', quick: false, quiet: true, run: () => {
    const r = reseauxArche() as { moteur: boolean; raison?: string; avenir?: string; reseaux: Array<{ nom: string; sousReseau?: string; conteneurs: string[] }> };
    return { text: r.moteur ? r.reseaux.map((x) => `- ${x.nom}${x.sousReseau ? ` · ${x.sousReseau}` : ''} · ${x.conteneurs.length} conteneur(s)`).join('\n') : `${r.raison} ${r.avenir}`, data: r };
  } },
  { id: 'creer_volume', label: 'Créer un volume', what: 'Un volume nommé, rangé par le moteur, qui reste quand le conteneur part', quick: false, proprietaireSeul: true,
    params: [{ key: 'nom', label: 'Nom (minuscules, chiffres, - _ .)', kind: 'text', required: true }],
    run: (_ctx, i) => { exigerMoteur(); const v = k2().createVolume(nomObjet(i.nom, 'volume')); return { text: `📦 Volume « ${v.nom} » créé. Donne-le à un conteneur avec « ${v.nom}:/dossier/dedans ».` }; } },
  { id: 'supprimer_volume', label: 'Supprimer un volume (garde-fou)', what: 'Supprime un volume que plus aucun conteneur n\'utilise, avec son nom tapé ; ses données ne reviennent pas', quick: false, proprietaireSeul: true,
    params: [VOLUME, { key: 'nom_tape', label: 'Son nom, pour confirmer', kind: 'text', default: '' }],
    grave: (i) => `supprimer le volume ${s(i.volume).trim().slice(0, 64)} et toutes ses données : elles ne pourront pas revenir (sauf sauvegarde de Phénix)`,
    run: async (ctx, i) => {
      exigerMoteur();
      const nom = nomObjet(i.volume, 'volume');
      // Le nom tapé est vérifié AVANT de toucher à quoi que ce soit.
      if (s(i.nom_tape).trim() !== nom) throw new Error(remplir(TEXTES_K2.nomFaux, { nom }));
      const v = k2().rmVolume(nom, (reel) => pourquoiGarderVolume(reel, ctx.home));
      // Il était dans le plan de Phénix : le plan est refait sans lui (ses anciennes sauvegardes restent lisibles).
      const sv = sauves(ctx), etait = Boolean(sv[nom]); let phenix = '';
      if (etait) {
        delete sv[nom]; ctx.saveSettings({ volumesSauves: sv });
        if (Object.keys(sv).length) phenix = await planVolumes(ctx, Object.keys(sv), `retirer le volume supprimé ${nom} de la sauvegarde`).then(() => ' Phénix ne le sauvegarde plus (ses anciennes sauvegardes restent lisibles).', (e: Error) => ` Phénix n'a pas pu refaire son plan : ${e.message.slice(0, 160)}`);
        else phenix = ` Phénix ne sait pas encore retirer un plan : le plan « ${TEXTES_K2.plan} » reste, vide (rien n'y est plus sauvegardé ; un volume recréé sous ce nom y repartirait).`;
      }
      return { text: `🗑 Volume « ${v.nom} » supprimé avec ses données.${phenix}`, data: { volume: v.nom } };
    } },
  { id: 'sauvegarde_volume', label: 'Sauvegarder un volume chaque nuit', what: 'Ajoute ou retire un volume du plan « Volumes d\'Arche » de Phénix (chaque nuit à 02:15)', quick: false, proprietaireSeul: true,
    params: [VOLUME, { key: 'sauver', label: 'Sauvegardé chaque nuit', kind: 'select', options: ['oui', 'non'], default: 'oui' }],
    run: async (ctx, i) => {
      exigerMoteur();
      const nom = nomObjet(i.volume, 'volume'), oui = s(i.sauver) !== 'non', sv = sauves(ctx);
      if (!k2().volumes().some((v) => v.nom === nom)) throw new Error(`volume inconnu : ${nom}`);
      if (oui === Boolean(sv[nom])) return { text: oui ? `« ${nom} » est déjà sauvegardé chaque nuit.` : `« ${nom} » n'est pas sauvegardé.` };
      const reste = Object.keys(sv).filter((n) => n !== nom);
      if (!oui && !reste.length) throw new Error(remplir(TEXTES_K2.phenixRetrait, { nom, plan: TEXTES_K2.plan }));
      const noms = oui ? [...reste, nom] : reste;
      await planVolumes(ctx, noms, oui ? `sauvegarder chaque nuit le volume ${nom}` : `ne plus sauvegarder le volume ${nom}`);
      if (oui) sv[nom] = ctx.now().toISOString(); else delete sv[nom];
      ctx.saveSettings({ volumesSauves: sv });
      return { text: oui ? `💾 « ${nom} » est sauvegardé chaque nuit par Phénix (plan « ${TEXTES_K2.plan} », 02:15, dans ${depotVolumes(ctx)}).` : `« ${nom} » n'est plus sauvegardé (ses anciennes sauvegardes restent dans Phénix).`, data: { volume: nom, sauvegarde: oui, plan: TEXTES_K2.plan } };
    } },
  { id: 'creer_reseau', label: 'Créer un réseau à part', what: 'Un réseau à lui (son pont), isolé des autres réseaux des conteneurs, avec ou sans Internet', quick: false, proprietaireSeul: true,
    params: [{ key: 'nom', label: 'Nom (minuscules, chiffres, - _ .)', kind: 'text', required: true }, { key: 'internet', label: 'Internet', kind: 'select', options: ['oui', 'non'], default: 'oui' }],
    run: (_ctx, i) => { exigerMoteur(); const r = k2().createReseau(nomObjet(i.nom, 'réseau'), { internet: s(i.internet) !== 'non' }); return { text: `🔀 Réseau « ${r.nom} » créé : ${r.sousReseau}.0/24, ${r.internet ? 'Internet oui' : 'sans Internet'}, les autres conteneurs : non. Son pont est monté au premier conteneur qui s'y branche.`, data: r }; } },
  { id: 'supprimer_reseau', label: 'Retirer un réseau à part', what: 'Retire un réseau à part que plus aucun conteneur n\'utilise (son pont et ses règles partent avec lui)', quick: false, proprietaireSeul: true,
    params: [RESEAU], grave: (i) => `retirer le réseau ${s(i.reseau).trim().slice(0, 64)} (son pont et ses règles)`,
    run: async (_ctx, i) => { exigerMoteur(); const r = await k2().rmReseau(nomObjet(i.reseau, 'réseau')); return { text: `🗑 Réseau « ${r.nom} » retiré.` }; } },
];
naglfar.actions.push(...avecJournal('naglfar_actes', actionsK2));

// ---------------------------------------------------------------------------------------------------------------
// Lot K3 (même maquette) : la composition et les piles.
//   - `verifier_pile` lit un fichier de composition (lecture stricte et bornée, hringhorni/composition.ts) et dit ce
//     qui est accepté, changé, refusé ; rien n'est lancé ni écrit ;
//   - `deployer_pile` ne part QUE si aucune ligne n'est refusée : son réseau à part, ses volumes, ses images, ses
//     conteneurs, démarrés dans l'ordre des dépendances (suivi dans « Installations ») ;
//   - `piles` (lecture) : chaque pile, son état, son ordre, ses conteneurs, son fichier (secrets masqués) ;
//   - `demarrer_pile`, `arreter_pile` (dans l'ordre inverse), `supprimer_pile` : ses volumes GARDÉS par défaut ; les
//     effacer (son nom tapé) ne touche que ses dossiers à elle (« Ses dossiers seulement », choix du propriétaire).
// Gestes au propriétaire seul et notés ; lecture ouverte. Sans moteur (Windows aujourd'hui) : la page le dit.
// ---------------------------------------------------------------------------------------------------------------
export const TEXTES_K3_ARCHE = {
  nomFaux: 'Pour effacer ses volumes, écris le nom exact de la pile (« {nom} ») : rien n\'a été supprimé.',
  refusee: 'Rien n\'est déployé tant qu\'une ligne est refusée : {n} ligne(s) à retirer ou corriger dans le fichier.',
  sansAdmin: 'Une pile a besoin d\'un réseau à part : il faut Odin en administrateur sur cette machine.',
  occupee: 'La pile « {nom} » est déjà en train de changer : attends que ce soit fini.',
};
type MoteurK3 = MoteurPile & { rootless?: boolean; startJob?: Engine['startJob'] };
const k3 = () => engine() as unknown as MoteurK3;
const PILE: Param = { key: 'pile', label: 'Pile', kind: 'text', required: true };
const COMPOSE: Param = { key: 'compose', label: 'Fichier de composition', kind: 'textarea', required: true };
const NOM_NOUVELLE: Param = { key: 'nom', label: 'Nom de la pile (minuscules, chiffres, -)', kind: 'text', default: '' };
const pilesEnCours = new Set<string>();
const nomPile = (v: unknown) => { const x = s(v).trim(); if (!NOM_PILE.test(x)) throw new Error(`nom de pile invalide : ${x.slice(0, 40)} (minuscules, chiffres, -)`); return x; };
/** Ce que l'analyse doit protéger, et ce qui existe déjà chez le moteur (noms, ports pris). */
async function gardeK3(ctx: ModCtx): Promise<Garde> {
  const g: Garde = { maison: systemeArche.maison(), odin: ctx.home, autres: [process.env.ODIN_CLE_DIR ?? ''].filter(Boolean), vraiChemin: vraiCheminLinux };
  try { g.moteur = systemeArche.dossierMoteur(); } catch { /* pas de moteur */ }
  if (!moteurIci()) return g;
  // Les ports qu'un programme de ce PC écoute déjà (ssh, un serveur…) : comme « Lancer une appli ». Sans cette liste,
  // « 22:22 » était dit « libre sur ce PC » et le conteneur aurait pris les connexions de ce port.
  const ecoute = usedPorts([], (await ctx.run('ss', ['-ltnH'], { timeoutMs: 5000 }).catch(() => ({ out: '' }))).out);
  try {
    const e = k3(), cts = e.ps(true);
    g.conteneurs = cts.map((c) => c.spec.name); g.volumes = e.store.volumes().map((v) => v.nom); g.reseaux = e.store.reseaux().map((r) => r.nom); g.piles = piles(e).map((p) => p.nom);
    const pris = new Map<number, string>();
    for (const c of cts) for (const p of c.spec.ports) pris.set(p.host, c.spec.name);
    for (const r of reserved()) if (!pris.has(r)) pris.set(r, 'gardé par Odin');
    for (const p of ecoute) if (!pris.has(p)) pris.set(p, 'un programme de ce PC l\'écoute déjà');
    g.portsPris = pris;
  } catch { /* moteur illisible : l'analyse le dira au déploiement */ }
  return g;
}
/** L'analyse telle que la page la montre : jamais la valeur d'une variable (seulement son nom). */
function analyseVue(a: Analyse): Record<string, unknown> {
  return { nom: a.nom, ok: a.ok, ordre: a.ordre, constats: a.constats, refus: a.refus,
    services: a.services.map((x) => ({ service: x.service, conteneur: x.conteneur, image: x.image, ports: x.ports.map((p) => ({ hote: p.host, dedans: p.inner, proto: p.proto })), volumes: x.montages.map((m) => ({ volume: m.volume, dossier: m.host, dedans: m.inner, lecture: m.ro })), variables: Object.keys(x.env), memoire: x.memory, depend: x.depend, reseau: x.reseau === '' ? 'aucun' : x.reseau })),
    volumes: a.volumes, reseaux: a.reseaux };
}
const resumeAnalyse = (a: Analyse) => a.constats.map((c) => `${c.ton === 'ok' ? '✓' : c.ton === 'refus' ? '✗' : '!'} ${c.quoi} : ${c.texte}`).join('\n');
/** Le fichier d'une pile tel qu'on le montre : les valeurs des variables secrètes (et ce qui ressemble à un secret) masquées. */
export function masquerFichier(t: string): string {
  const env: Record<string, string> = {}, autres: string[] = [];
  // (une ligne à la fois : « environment: » ne prend jamais la ligne d'après comme sa valeur, ce qui laissait la
  // première variable en clair)
  for (const m of String(t).matchAll(/^[ \t]*-?[ \t]*["']?([A-Za-z_][A-Za-z0-9_]*)["']?[ \t]*[:=][ \t]*(.+?)[ \t]*$/gm)) {
    const v = m[2].replace(/^["']|["']$/g, ''); env[m[1]] = v;
    // « ADMIN_PW », « …_PASSPHRASE » : aussi des mots de passe
    if (/(?:^|_)pw(?:_|$)|passphrase|passwd/i.test(m[1]) && v.length >= 4) autres.push(v);
  }
  // Un mot de passe donné à une commande (« --requirepass motdepasse », « --password=… ») : masqué aussi.
  const x = String(t).replace(/(--?[\w-]{0,40}(?:pass|pwd|secret|token|apikey|api-key)[\w-]{0,40}(?:=|\s+))("[^"\n]*"|'[^'\n]*'|[^\s"',\]]+)/gi, (_m, k: string) => `${k}••••••`);
  return masquer(x, [...secretsDe(env), ...autres].sort((a, b) => b.length - a.length));
}
export function pilesArche(): Record<string, unknown> {
  if (!moteurIci()) return { moteur: false, nom: nomArche(), plateforme: systemeArche.plateforme(), raison: TEXTES_ARCHE.pasDeMoteur, avenir: TEXTES_ARCHE.avenir, piles: [] };
  const e = k3(), tous = e.ps(true);
  return {
    moteur: true, nom: nomArche(),
    piles: piles(e).map((p) => {
      const cs = p.services.map((x) => ({ ...x, c: tous.find((c) => c.spec.name === x.conteneur && c.spec.labels['odin.pile'] === p.nom) }));
      const on = cs.filter((x) => x.c?.state.status === 'en marche').length, presents = cs.filter((x) => x.c).length;
      return {
        nom: p.nom, cree: p.cree, ordre: p.ordre, etat: presents && on === presents ? 'en marche' : on ? 'en partie' : 'arrêtée', enMarche: on, total: cs.length, manquants: cs.filter((x) => !x.c).map((x) => x.conteneur),
        services: p.ordre.map((n) => cs.find((x) => x.service === n)).filter((x): x is (typeof cs)[number] => !!x).map((x) => ({ service: x.service, conteneur: x.conteneur, image: x.image, etat: x.c?.state.status ?? 'absent', ports: (x.c?.spec.ports ?? []).map((q) => ({ hote: q.host, dedans: q.inner, proto: q.proto })) })),
        // (son fichier n'est pas dans la liste, ouverte : il se lit par « fichier_pile », au propriétaire seul)
        volumes: p.volumes, volumesPropres: p.volumesPropres, reseaux: p.reseaux,
      };
    }),
  };
}
// La lecture n'est pas marquée « read » (comme K1 et K2 : le banc figé de Soul photographie les lectures du catalogue).
const actionsK3: Action[] = [
  { id: 'piles', label: 'Piles', what: 'Les piles (plusieurs conteneurs décrits ensemble) : état, ordre de démarrage, conteneurs, fichier', quick: false, quiet: true, run: () => {
    const d = pilesArche() as { moteur: boolean; raison?: string; avenir?: string; piles: Array<{ nom: string; etat: string; enMarche: number; total: number }> };
    return { text: d.moteur ? d.piles.map((p) => `- ${p.nom} · ${p.etat} · ${p.enMarche}/${p.total} en marche`).join('\n') || 'Aucune pile.' : `${d.raison} ${d.avenir}`, data: d };
  } },
  // Le fichier d'une pile peut porter des secrets que le masque ne reconnaît pas (une adresse secrète, un mot de passe
  // donné à une commande) : il n'est montré qu'au propriétaire en personne (ni un membre, ni une tablette, ni une
  // automatisation), et masqué quand même. Une lecture : pas notée dans « qui a fait quoi ».
  { id: 'fichier_pile', label: 'Fichier d\'une pile', what: 'Le fichier de composition d\'une pile (secrets masqués), au propriétaire seul', quick: false, quiet: true, proprietaireSeul: true, params: [PILE],
    run: (_ctx, i) => {
      exigerMoteur(); const n = nomPile(i.pile), p = pile(k3(), n); if (!p) throw new Error(`pile inconnue : ${n}`);
      const f = masquerFichier(p.fichier); return { text: f, data: { pile: n, fichier: f } };
    } },
  { id: 'verifier_pile', label: 'Vérifier un fichier de composition', what: 'Lit le fichier et dit ce qui est accepté, changé ou refusé (rien n\'est lancé)', quick: false, proprietaireSeul: true, params: [COMPOSE, NOM_NOUVELLE],
    run: async (ctx, i) => { const a = analyserComposition(s(i.compose), { nom: s(i.nom).trim() || undefined, garde: await gardeK3(ctx) }); return { ok: true, text: resumeAnalyse(a), data: { moteur: moteurIci(), ...analyseVue(a) } }; } },
  { id: 'deployer_pile', label: 'Déployer une pile', what: 'Crée et démarre les conteneurs d\'un fichier de composition, dans l\'ordre (refusé tant qu\'une ligne est refusée)', quick: false, proprietaireSeul: true, params: [COMPOSE, NOM_NOUVELLE],
    grave: (i) => { const a = analyserComposition(s(i.compose), { nom: s(i.nom).trim() || undefined }); const dossiers = a.services.flatMap((x) => x.montages.filter((m) => m.host).map((m) => m.host)); return `déployer la pile « ${a.nom.slice(0, 40)} » : ${a.services.length} conteneur(s) (${a.services.map((x) => x.image).join(', ').slice(0, 300)})${a.services.some((x) => x.ports.length) ? `, ports ouverts : ${a.services.flatMap((x) => x.ports.map((p) => p.host)).join(', ')}` : ''}${dossiers.length ? `, avec accès à ces dossiers de ta machine : ${dossiers.join(', ')}` : ''}`; },
    run: async (ctx, i) => {
      exigerMoteur(); const e = k3();
      if (e.rootless) throw new Error(TEXTES_K3_ARCHE.sansAdmin);
      const fichier = s(i.compose), a = analyserComposition(fichier, { nom: s(i.nom).trim() || undefined, garde: await gardeK3(ctx) });
      if (!a.ok) return { ok: false, text: `${remplir(TEXTES_K3_ARCHE.refusee, { n: String(a.refus.length) })}\n${a.refus.map((r) => `✗ ${r}`).join('\n')}`, data: analyseVue(a) };
      if (pilesEnCours.has(a.nom)) throw new Error(remplir(TEXTES_K3_ARCHE.occupee, { nom: a.nom }));
      if (!e.startJob) throw new Error('moteur sans suivi des installations');
      pilesEnCours.add(a.nom);
      const j = e.startJob('installer', `pile ${a.nom}`, async (report) => {
        try {
          await deployerPile(e, a, fichier, (t, fait, total) => report({ phase: fait >= total ? 'fini' : 'monter', done: fait, total }, t));
          return { name: a.nom, note: `pile ${a.nom} en marche (${a.ordre.join(', puis ')})` };
        } finally { pilesEnCours.delete(a.nom); }
      }, a.nom);
      return { text: `🚢 Déploiement de la pile « ${a.nom} » lancé : ${a.ordre.join(', puis ')}. Suis-le dans ${nomArche()}.`, data: { job: j.id, pile: a.nom, ordre: a.ordre } };
    } },
  { id: 'demarrer_pile', label: 'Démarrer une pile', what: 'Démarre ses conteneurs, chacun après ceux dont il dépend', quick: false, proprietaireSeul: true, params: [PILE],
    run: async (ctx, i) => {
      exigerMoteur(); const n = nomPile(i.pile); if (pilesEnCours.has(n)) throw new Error(remplir(TEXTES_K3_ARCHE.occupee, { nom: n }));
      pilesEnCours.add(n);
      try { const l = await demarrerPile(k3(), n); ctx.saveSettings({ running: [...new Set([...((ctx.settings.running as string[]) ?? []), ...l])] }); return { text: l.length ? `▶ Pile « ${n} » : ${l.join(', puis ')} démarré(s).` : `La pile « ${n} » tourne déjà.`, data: { pile: n, demarres: l } }; }
      finally { pilesEnCours.delete(n); }
    } },
  { id: 'arreter_pile', label: 'Arrêter une pile', what: 'Arrête ses conteneurs, dans l\'ordre inverse', quick: false, proprietaireSeul: true, params: [PILE],
    grave: (i) => `arrêter la pile ${s(i.pile).trim().slice(0, 40)} (ce qu'elle sert ne répond plus jusqu'à ce que tu la relances)`,
    run: async (ctx, i) => {
      exigerMoteur(); const n = nomPile(i.pile); if (pilesEnCours.has(n)) throw new Error(remplir(TEXTES_K3_ARCHE.occupee, { nom: n }));
      pilesEnCours.add(n);
      try { const l = await arreterPile(k3(), n); for (const x of l) forget(ctx, x); return { text: l.length ? `⏹ Pile « ${n} » : ${l.join(', puis ')} arrêté(s).` : `La pile « ${n} » est déjà arrêtée.`, data: { pile: n, arretes: l } }; }
      finally { pilesEnCours.delete(n); }
    } },
  { id: 'supprimer_pile', label: 'Supprimer une pile (garde-fou)', what: 'Supprime ses conteneurs ; ses volumes sont gardés, sauf si tu écris son nom pour effacer ses dossiers à elle', quick: false, proprietaireSeul: true,
    params: [PILE, { key: 'volumes', label: 'Ses volumes', kind: 'select', options: ['garder', 'effacer'], default: 'garder' }, { key: 'nom_tape', label: 'Son nom, pour effacer ses volumes', kind: 'text', default: '' }],
    grave: (i) => (s(i.volumes) === 'effacer' ? `supprimer la pile ${s(i.pile).trim().slice(0, 40)} ET effacer les volumes qu'elle a créés : ils ne pourront pas revenir (sauf sauvegarde de Phénix)` : `supprimer la pile ${s(i.pile).trim().slice(0, 40)} (ses conteneurs ; ses volumes sont gardés)`),
    run: async (ctx, i) => {
      exigerMoteur(); const n = nomPile(i.pile), effacer = s(i.volumes) === 'effacer', e = k3();
      // Le nom tapé est vérifié AVANT de toucher à quoi que ce soit.
      if (effacer && s(i.nom_tape).trim() !== n) throw new Error(remplir(TEXTES_K3_ARCHE.nomFaux, { nom: n }));
      const p = pile(e, n); if (!p) throw new Error(`pile inconnue : ${n}`);
      if (pilesEnCours.has(n)) throw new Error(remplir(TEXTES_K3_ARCHE.occupee, { nom: n }));
      pilesEnCours.add(n);
      try {
        for (const x of p.services) forget(ctx, x.conteneur);
        const r = await supprimerPile(e, n, { effacerVolumes: effacer, garde: (reel) => pourquoiGarderVolume(reel, ctx.home) });
        const t = [`🗑 Pile « ${n} » supprimée : ${r.conteneurs.join(', ') || 'aucun conteneur'} (les images restent).`,
          r.reseauxRetires.length ? `Réseau retiré : ${r.reseauxRetires.join(', ')}.` : '',
          r.volumesEffaces.length ? `Volumes effacés : ${r.volumesEffaces.join(', ')}.` : '',
          r.volumesGardes.length ? `Volumes gardés : ${r.volumesGardes.map((v) => `${v.nom}${effacer ? ` (${v.raison})` : ''}`).join(', ')}.` : ''].filter(Boolean).join('\n');
        return { text: t, data: { pile: n, ...r } };
      } finally { pilesEnCours.delete(n); }
    } },
];
// (la lecture du fichier n'est pas un changement : hors du journal « qui a fait quoi »)
naglfar.actions.push(...avecJournal('naglfar_actes', actionsK3.filter((a) => a.id !== 'fichier_pile')), ...actionsK3.filter((a) => a.id === 'fichier_pile'));
