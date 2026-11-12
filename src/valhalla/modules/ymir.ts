// Ymir — les machines virtuelles et conteneurs de tes serveurs de virtualisation, tous serveurs réunis
// (mode « Asgard ») : ressources, démarrer, arrêter, redémarrer, instantanés, sauvegarde d'une machine
// (via Sindri en mode Andvari), alertes si une machine importante s'arrête ou si un nœud sature.

import { pveApi, type PveResource } from '../../tools/proxmox.ts';
import type { ModCtx, Module } from '../types.ts';
import { mkdir } from 'node:fs/promises';
import { autoName, freePort, parseMounts, parsePorts, usedPorts, type Kind } from '../parc.ts';
import { restartOf } from '../hringhorni/engine.ts';
import { engine as ctEngine } from './naglfar.ts';

export interface PveServer { name: string; url: string; token?: string }
const s = (v: unknown) => String(v ?? '');
const gb = (n?: number) => (n ? `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} Go` : '—');
function servers(ctx: ModCtx): PveServer[] {
  const list = (ctx.settings.servers as PveServer[] | undefined) ?? [];
  return list.map((x, i) => ({ ...x, token: x.token ?? process.env[i === 0 ? 'PROXMOX_TOKEN' : `PROXMOX_TOKEN_${x.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] })).filter((x) => x.url && x.token);
}
type Res = PveResource & { server: string };
export async function resources(ctx: ModCtx, api = pveApi): Promise<{ res: Res[]; errors: string[] }> {
  const res: Res[] = [], errors: string[] = [];
  await Promise.all(servers(ctx).map(async (sv) => { try { for (const r of await api(sv.url, sv.token!, 'GET', '/cluster/resources') as PveResource[]) res.push({ ...r, server: sv.name }); } catch (e) { errors.push(`${sv.name} : ${(e as Error).message}`); } }));
  return { res, errors };
}
async function act(ctx: ModCtx, vmid: number, what: string, extra?: Record<string, string>): Promise<string> {
  const { res } = await resources(ctx), g = res.find((r) => r.vmid === vmid);
  if (!g) throw new Error(`aucune machine n° ${vmid}`);
  const sv = servers(ctx).find((x) => x.name === g.server)!, base = `/nodes/${encodeURIComponent(g.node)}/${g.type}/${vmid}`;
  const path = what === 'snapshot' ? `${base}/snapshot` : what === 'rollback' ? `${base}/snapshot/${encodeURIComponent(extra?.snapname ?? '')}/rollback` : `${base}/status/${what}`;
  const task = await pveApi(sv.url, sv.token!, 'POST', path, extra);
  return `${g.name ?? vmid} (${g.server}) : ${what} lancé (tâche ${s(task).slice(-24)}).`;
}

/** Une machine du parc, quel que soit son type (même suivi, mêmes boutons). */
export interface Unit { key: string; kind: Kind; name: string; auto: string; state: 'en marche' | 'arrêtée' | 'en installation'; ip?: string; what?: string; cpu?: number; ram?: number; where: string; module: string; ref: Record<string, unknown> }
const pct = (a?: number, b?: number) => (a !== undefined && b ? Math.round((a / b) * 100) : undefined);
/** Tout le parc : Proxmox (VM, LXC), Docker (Naglfar), ordinateurs installés par le réseau (Þjálfi). Les noms automatiques restent les mêmes. */
export async function parc(ctx: ModCtx): Promise<{ units: Unit[]; errors: string[] }> {
  const names = { ...((ctx.settings.noms as Record<string, string> | undefined) ?? {}) }, taken = new Set(Object.values(names)), errors: string[] = [], units: Unit[] = [];
  const name = (key: string, kind: Kind, what: string) => { if (!names[key]) { names[key] = autoName(kind, what, taken); taken.add(names[key]); } return names[key]; };
  const [pve, dk, pcs] = await Promise.all([
    servers(ctx).length ? resources(ctx).catch((e) => ({ res: [] as Res[], errors: [(e as Error).message] })) : Promise.resolve({ res: [] as Res[], errors: [] }),
    ctx.call('naglfar', 'lister', {}, 'le parc de machines').then((r) => (r.data as Array<{ Names: string; Image: string; State: string; Status: string; Ports: string; Labels?: string }>) ?? []).catch(() => []),
    ctx.call('thjalfi', 'machines', {}, 'le parc de machines').then((r) => (r.data as Array<{ mac: string; host?: string; ip?: string; step?: string; isoName?: string }>) ?? []).catch(() => []),
  ]);
  errors.push(...pve.errors);
  for (const r of pve.res.filter((x) => x.vmid)) { const kind: Kind = r.type === 'lxc' ? 'LXC' : 'VM', key = `${kind.toLowerCase()}:${r.server}:${r.vmid}`;
    units.push({ key, kind, name: r.name ?? `${kind} ${r.vmid}`, auto: name(key, kind, r.name ?? String(r.vmid)), state: r.status === 'running' ? 'en marche' : 'arrêtée', what: `${r.server} / ${r.node}`, cpu: r.cpu !== undefined ? Math.round(r.cpu * 100) : undefined, ram: pct(r.mem, r.maxmem), where: r.server, module: 'ymir', ref: { vmid: r.vmid } }); }
  const piles = new Map<string, typeof dk>();
  for (const c of dk) { const pj = /com\.docker\.compose\.project=([^,]+)/.exec(c.Labels ?? '')?.[1]; if (pj) { piles.set(pj, [...(piles.get(pj) ?? []), c]); continue; }
    const key = `dk:${c.Names}`; units.push({ key, kind: 'Docker', name: c.Names, auto: name(key, 'Docker', c.Image), state: c.State === 'running' ? 'en marche' : 'arrêtée', what: c.Image, where: 'Docker', module: 'naglfar', ref: { conteneur: c.Names } }); }
  for (const [pj, cs] of piles) { const key = `pile:${pj}`; units.push({ key, kind: 'Pile', name: pj, auto: name(key, 'Pile', pj), state: cs.some((c) => c.State === 'running') ? 'en marche' : 'arrêtée', what: `${cs.length} conteneur(s)`, where: 'Docker', module: 'naglfar', ref: { pile: pj } }); }
  for (const m of pcs) { const key = `pc:${m.mac}`; units.push({ key, kind: 'PC', name: m.host ?? m.mac, auto: name(key, 'PC', m.isoName ?? m.host ?? 'pc'), state: m.step && !/fini|termin|done|pr[eê]t/i.test(m.step) ? 'en installation' : 'en marche', ip: m.ip, what: m.isoName, where: 'réseau', module: 'thjalfi', ref: { mac: m.mac } }); }
  if (JSON.stringify(names) !== JSON.stringify(ctx.settings.noms ?? {})) ctx.saveSettings({ noms: names });
  return { units, errors };
}
export interface Step { t: string; state: 'ok' | 'corrigé' | 'échec'; ms: number; note?: string }
/** Installe un conteneur Docker et le vérifie : image, dossiers, ports (un port pris → le suivant libre), santé, suivi. */
export async function installDocker(ctx: ModCtx, i: Record<string, unknown>, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<{ steps: Step[]; name: string; ports: Array<{ host: number; inner: number }>; ok: boolean }> {
  const image = s(i.image).trim(); if (!/^[\w.\/:@-]{1,200}$/.test(image)) throw new Error(`image invalide : ${image}`);
  const ports = parsePorts(s(i.ports)), mounts = parseMounts(s(i.dossiers)), steps: Step[] = [];
  const mem = s(i.memoire).trim(), cpus = s(i.coeurs).trim(); if (mem && !/^\d+(\.\d+)?[mg]$/i.test(mem)) throw new Error('mémoire : par exemple 4g ou 512m'); if (cpus && !/^\d+(\.\d+)?$/.test(cpus)) throw new Error('cœurs : un nombre');
  const step = async (t: string, f: () => Promise<string | { note: string; fixed?: boolean } | void>) => { const t0 = Date.now(); try { const r = await f(); const note = typeof r === 'string' ? r : r?.note; steps.push({ t, state: typeof r === 'object' && r?.fixed ? 'corrigé' : 'ok', ms: Date.now() - t0, ...(note ? { note } : {}) }); return true; } catch (e) { steps.push({ t, state: 'échec', ms: Date.now() - t0, note: (e as Error).message.slice(0, 300) }); return false; } };
  const eng = ctEngine();
  const { units } = await parc(ctx), name = s(i.nom).trim() ? s(i.nom).trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').slice(0, 60) : autoName('Docker', image, units.map((u) => u.auto).concat(units.map((u) => u.name)));
  const final: Array<{ host: number; inner: number; proto: 'tcp' | 'udp' }> = [];
  const done = await step('Vérifier le moteur d\'Odin', async () => { const t = await (eng as { getTools?: () => Promise<unknown> }).getTools?.(); return t ? 'prêt, sans démon (ni Docker ni Podman)' : 'prêt'; })
    && await step('Télécharger l\'image', async () => { const img = await eng.pull(image); return `${img.names.at(-1)} · ${(img.size / 1e6).toFixed(0)} Mo, empreintes vérifiées`; })
    && await step('Créer les dossiers', async () => { for (const m of mounts.filter((x) => !x.ro)) await mkdir(m.host, { recursive: true }); return mounts.length ? mounts.map((m) => `${m.host} → ${m.inner}${m.ro ? ' (lecture seule)' : ''}`).join(' · ') : 'aucun dossier'; })
    && await step('Choisir les ports', async () => {
      const ss = (await ctx.run('ss', ['-ltnH'], { timeoutMs: 5000 }).catch(() => ({ out: '' }))).out;
      const used = usedPorts([], ss), fixes: string[] = [];
      for (const c of eng.ps()) for (const p of c.spec.ports) used.add(p.host);
      for (const p of ports) { const h = freePort(p.host, used); used.add(h); if (h !== p.host) fixes.push(`${p.host} déjà pris → ${h}`); final.push({ host: h, inner: p.inner, proto: p.proto }); }
      return fixes.length ? { note: fixes.join(' · '), fixed: true } : final.map((p) => `${p.host} → ${p.inner}`).join(' · ') || 'aucun port';
    })
    && await step('Démarrer le conteneur', async () => { await eng.run({ image, name, ports: final, mounts, restart: restartOf(s(i.redemarrage) || 'unless-stopped'), memory: mem || undefined, cpus: cpus || undefined }); return name; })
    && await step('Vérifier la santé', async () => {
      for (let k = 0; k < 6; k++) { await wait(500); const st = eng.find(name).state; if (st.status === 'sorti' || st.status === 'arrêté') throw new Error(`le conteneur s'est arrêté : ${eng.logs(name, 3).map((l) => l.text).join(' / ') || st.error || `code ${st.exitCode}`}`); }
      return 'en marche';
    });
  if (done) await step('Brancher le suivi (Vörðr)', async () => { const p = final[0]; if (!p) return 'pas de port : suivi du conteneur par Naglfar'; await ctx.call('vordr', 'ajouter', { nom: name, genre: 'tcp', cible: `127.0.0.1:${p.host}`, groupe: 'Machines' }, 'nouveau conteneur installé'); return `sonde sur le port ${p.host}`; });
  return { steps, name, ports: final, ok: steps.every((x) => x.state !== 'échec') };
}
const STATE_ICON: Record<Step['state'], string> = { ok: '✓', corrigé: '↻', échec: '✗' };
export const ymir: Module = {
  id: 'ymir', name: 'Ymir', family: 'Machines',
  what: 'Tes machines virtuelles et conteneurs, sur tous tes serveurs de virtualisation.',
  does: ['tous les serveurs réunis (mode Asgard) : nœuds, machines, conteneurs', 'processeur, mémoire, disque de chaque machine', 'démarrer, arrêt propre, arrêt forcé, redémarrer', 'instantanés et retour en arrière (avec ton accord)', 'sauvegarde d\'une machine (Sindri, mode Andvari)', 'alerte si une machine s\'arrête ou si un nœud sature'],
  from: ['Proxmox VE', 'Proxmox Datacenter Manager'], upstream: ['proxmox/pve-manager'],
  modes: ['Asgard · tous les serveurs', 'Andvari · sauvegarde des machines'],
  words: ['machine virtuelle', 'machines virtuelles', 'vm', 'proxmox', 'toutes mes machines', 'parc de machines', 'conteneur lxc', 'lxc', 'hyperviseur', 'virtualisation', 'instantane', 'snapshot', 'noeud', 'nœud'],
  actions: [
    { id: 'parc', label: 'Toutes mes machines', what: 'Ordinateurs installés par le réseau, VM, LXC et conteneurs Docker, avec leur nom automatique', read: true, words: ['toutes mes machines', 'mon parc', 'parc de machines'], run: async (ctx) => {
      const { units, errors } = await parc(ctx);
      return { text: units.length ? units.map((u) => `- ${u.kind} · ${u.name} (${u.auto}) · ${u.state}${u.ip ? ` · ${u.ip}` : ''}${u.what ? ` · ${u.what}` : ''}`).join('\n') + (errors.length ? `\n⚠ ${errors.join(' ; ')}` : '') : 'Aucune machine pour l\'instant.', data: { units, errors } };
    } },
    { id: 'installer_docker', label: 'Installer un conteneur', what: 'Sur le moteur d\'Odin (sans Docker ni démon) : image téléchargée et vérifiée, dossiers créés, ports libres choisis, démarrage, santé vérifiée, suivi branché',
      params: [{ key: 'image', label: 'Image (ex. jellyfin/jellyfin:10.11.1)', kind: 'text', required: true }, { key: 'nom', label: 'Nom (vide : nom automatique dk-…)', kind: 'text', default: '' }, { key: 'ports', label: 'Ports (8096:8096, …)', kind: 'text', default: '' }, { key: 'dossiers', label: 'Dossiers (/data/x:/config, /media:/media:ro)', kind: 'text', default: '' }, { key: 'memoire', label: 'Mémoire max (4g)', kind: 'text', default: '' }, { key: 'coeurs', label: 'Cœurs max', kind: 'text', default: '' }],
      grave: (i) => `installer le conteneur ${s(i.image)}`, words: ['installe le conteneur', 'installe l\'image'], run: async (ctx, i) => {
        const r = await installDocker(ctx, i);
        return { text: `${r.ok ? '✅' : '⚠️'} ${r.name} : ${r.ok ? 'installé et vérifié' : 'installation arrêtée'}\n${r.steps.map((x) => `${STATE_ICON[x.state]} ${x.t}${x.note ? ` — ${x.note}` : ''} (${(x.ms / 1000).toFixed(1)} s)`).join('\n')}`, data: r };
      } },
    { id: 'machines', label: 'Machines virtuelles', what: 'Toutes les machines et leur état', read: true, words: ['liste', 'machines', 'vm'], run: async (ctx) => { const { res, errors } = await resources(ctx); const vms = res.filter((r) => r.vmid); return { text: `${vms.map((r) => `- ${r.vmid} ${r.name} (${r.type === 'lxc' ? 'conteneur' : 'VM'}, ${r.server}/${r.node}) · ${r.status} · ${gb(r.mem)} / ${gb(r.maxmem)}`).join('\n') || 'Aucune machine (Réglages → Proxmox).'}${errors.length ? `\n⚠ ${errors.join(' ; ')}` : ''}` }; } },
    { id: 'demarrer', undo: (i) => ({ action: 'arreter', input: { vmid: i.vmid }, label: 'machine virtuelle arrêtée' }), label: 'Démarrer', what: 'Démarre une machine', params: [{ key: 'vmid', label: 'Numéro', kind: 'number', required: true }], words: ['demarre', 'démarre', 'allume'], run: async (ctx, i) => ({ text: await act(ctx, Number(i.vmid), 'start') }) },
    { id: 'arreter', label: 'Arrêt propre', what: 'Éteint proprement une machine', params: [{ key: 'vmid', label: 'Numéro', kind: 'number', required: true }], grave: (i) => `éteindre la machine ${s(i.vmid)}`, words: ['eteins', 'éteins', 'arrete', 'arrête'], run: async (ctx, i) => { const text = await act(ctx, Number(i.vmid), 'shutdown'); /* arrêt demandé : la surveillance ne doit pas le prendre pour une panne */ ctx.saveSettings({ running: ((ctx.settings.running as number[] | undefined) ?? []).filter((x) => x !== Number(i.vmid)) }); return { text }; } },
    { id: 'redemarrer', label: 'Redémarrer', what: 'Redémarre une machine', params: [{ key: 'vmid', label: 'Numéro', kind: 'number', required: true }], grave: (i) => `redémarrer la machine ${s(i.vmid)}`, run: async (ctx, i) => ({ text: await act(ctx, Number(i.vmid), 'reboot') }) },
    { id: 'instantane', label: 'Instantané', what: 'Photo de la machine à cet instant', params: [{ key: 'vmid', label: 'Numéro', kind: 'number', required: true }, { key: 'nom', label: 'Nom', kind: 'text', default: '' }], run: async (ctx, i) => ({ text: await act(ctx, Number(i.vmid), 'snapshot', { snapname: s(i.nom) || `odin-${ctx.now().toISOString().slice(0, 16).replace(/[-:T]/g, '')}` }) }) },
    { id: 'revenir', label: 'Revenir à un instantané', what: 'Remet la machine dans l\'état de l\'instantané', params: [{ key: 'vmid', label: 'Numéro', kind: 'number', required: true }, { key: 'nom', label: 'Instantané', kind: 'text', required: true }], grave: (i) => `remettre la machine ${s(i.vmid)} à l'instantané ${s(i.nom)} (les changements depuis sont perdus)`, run: async (ctx, i) => ({ text: await act(ctx, Number(i.vmid), 'rollback', { snapname: s(i.nom) }) }) },
    { id: 'serveur', label: 'Ajouter un serveur', what: 'Relier un serveur de virtualisation (jeton d\'API dans le coffre)', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'adresse', label: 'Adresse (https://…:8006)', kind: 'text', required: true }], run: (ctx, i) => { const list = ((ctx.settings.servers as PveServer[]) ?? []).filter((x) => x.name !== s(i.nom)); ctx.saveSettings({ servers: [...list, { name: s(i.nom), url: s(i.adresse).trim() }] }); return { text: `🔗 Serveur ${s(i.nom)} ajouté. Range son jeton d'API dans le coffre (${list.length ? `PROXMOX_TOKEN_${s(i.nom).toUpperCase().replace(/[^A-Z0-9]/g, '_')}` : 'PROXMOX_TOKEN'}).` }; } },
  ],
  async view(ctx) {
    const p = await parc(ctx).catch(() => ({ units: [] as Unit[], errors: [] as string[] }));
    const { res, errors } = await resources(ctx), nodes = res.filter((r) => r.type === 'node'), vms = res.filter((r) => r.vmid);
    const cpu = nodes.length ? Math.round((nodes.reduce((a, n) => a + (n.cpu ?? 0), 0) / nodes.length) * 100) : 0, mem = nodes.reduce((a, n) => a + (n.mem ?? 0), 0), maxmem = nodes.reduce((a, n) => a + (n.maxmem ?? 0), 0);
    return {
      subtitle: errors.length ? `⚠ ${errors.join(' ; ')}` : servers(ctx).length ? `${servers(ctx).length} serveur(s) · ${nodes.length} nœud(s)` : 'Aucun serveur relié : ajoute-en un à droite.',
      tabs: ['Ymir · machines', 'Asgard · serveurs', 'Andvari · sauvegardes'],
      kpis: [{ label: 'Processeur', value: `${cpu} %`, pct: cpu, tone: cpu > 85 ? 'attention' : 'bon' }, { label: 'Mémoire', value: `${gb(mem)} / ${gb(maxmem)}`, pct: maxmem ? Math.round((mem / maxmem) * 100) : 0 }, { label: 'Machines actives', value: `${vms.filter((v) => v.status === 'running').length} / ${vms.length}` }],
      sections: [
        ...(['PC', 'VM', 'LXC', 'Docker', 'Pile'] as Kind[]).map((k) => ({ kind: 'cards' as const, title: { PC: 'Ordinateurs', VM: 'Machines virtuelles', LXC: 'Conteneurs LXC', Docker: 'Conteneurs (images Docker)', Pile: 'Groupes de conteneurs' }[k], empty: k === 'Docker' ? 'Aucun conteneur : « Installer un conteneur ».' : 'Aucune.',
          items: p.units.filter((u) => u.kind === k).map((u) => ({ title: u.name, sub: `${u.auto}${u.ip ? ` · ${u.ip}` : ''}${u.what ? ` · ${u.what}` : ''}`, badge: u.state, tone: u.state === 'en marche' ? 'bon' as const : 'neutre' as const, ...(u.cpu !== undefined ? { progress: u.cpu, meta: `processeur ${u.cpu} %${u.ram !== undefined ? ` · mémoire ${u.ram} %` : ''}` } : {}),
            actions: u.kind === 'PC' ? [] : u.kind === 'Pile' ? [] : u.module === 'naglfar' ? [u.state === 'en marche' ? { action: 'arreter', label: 'Arrêter', input: u.ref, module: 'naglfar' } : { action: 'demarrer', label: 'Démarrer', input: u.ref, module: 'naglfar' }, { action: 'journaux', label: 'Journal', input: u.ref, module: 'naglfar' }, { action: 'supprimer', label: 'Supprimer', input: u.ref, module: 'naglfar' }]
              : [u.state === 'en marche' ? { action: 'arreter', label: 'Arrêter', input: u.ref } : { action: 'demarrer', label: 'Démarrer', input: u.ref }, { action: 'instantane', label: 'Instantané', input: u.ref }] })) })).filter((x) => x.items.length || x.title === 'Conteneurs Docker'),
        { kind: 'form', title: 'Installer un conteneur', action: 'installer_docker', params: [{ key: 'image', label: 'Image (ex. jellyfin/jellyfin)', kind: 'text', required: true }, { key: 'ports', label: 'Ports (8096:8096)', kind: 'text', default: '' }, { key: 'dossiers', label: 'Dossiers (/data/x:/config)', kind: 'text', default: '' }], submit: 'Installer' },
        { kind: 'table', title: 'Machines', columns: ['N°', 'Machine', 'Type', 'Serveur / nœud', 'Processeur', 'Mémoire', 'État'], empty: 'Aucune machine.', rows: vms.sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0)).map((v) => ({ cells: [String(v.vmid), v.name ?? '', v.type === 'lxc' ? 'conteneur' : 'VM', `${v.server} / ${v.node}`, `${Math.round((v.cpu ?? 0) * 100)} %`, `${gb(v.mem)} / ${gb(v.maxmem)}`, v.status ?? ''], tone: v.status === 'running' ? 'bon' : 'neutre', actions: v.status === 'running' ? [{ action: 'instantane', label: 'Instantané', input: { vmid: v.vmid } }, { action: 'redemarrer', label: 'Redémarrer', input: { vmid: v.vmid } }, { action: 'arreter', label: 'Arrêter', input: { vmid: v.vmid } }] : [{ action: 'demarrer', label: 'Démarrer', input: { vmid: v.vmid } }] })) }],
      side: [{ kind: 'list', title: 'Asgard · nœuds', items: nodes.map((n) => ({ title: `${n.server} / ${n.node}`, detail: `${Math.round((n.cpu ?? 0) * 100)} % CPU · ${gb(n.mem)} / ${gb(n.maxmem)}`, tone: n.status === 'online' ? 'bon' : 'mauvais' })), empty: 'Aucun nœud.' }, { kind: 'form', title: 'Relier un serveur', action: 'serveur', submit: 'Ajouter', params: ymir.actions.find((a) => a.id === 'serveur')?.params ?? [] }],
    };
  },
  watch: { every: 180, async run(ctx) {
    const { res } = await resources(ctx); if (!res.length) return;
    const was = (ctx.settings.running as number[] | undefined) ?? [], now = res.filter((r) => r.vmid && r.status === 'running').map((r) => r.vmid!);
    for (const id of was) if (!now.includes(id)) { const r = res.find((x) => x.vmid === id); ctx.alert({ level: 'haute', title: `La machine ${r?.name ?? id} s'est arrêtée`, key: `vm:${id}` }); ctx.emit('vm_arretee', { vmid: id, nom: r?.name }); }
    for (const n of res.filter((r) => r.type === 'node')) { if (n.status !== 'online') ctx.alert({ level: 'critique', title: `Nœud ${n.node} injoignable`, key: `node:${n.node}` }); else if ((n.mem ?? 0) / (n.maxmem || 1) > 0.95) ctx.alert({ level: 'haute', title: `Nœud ${n.node} : mémoire saturée`, key: `nodemem:${n.node}` }); }
    ctx.saveSettings({ running: now });
  } },
};
