// Ymir — les machines virtuelles et conteneurs de tes serveurs de virtualisation, tous serveurs réunis
// (mode « Asgard ») : ressources, démarrer, arrêter, redémarrer, instantanés, sauvegarde d'une machine
// (via Sindri en mode Andvari), alertes si une machine importante s'arrête ou si un nœud sature.

import { pveApi, type PveResource } from '../../tools/proxmox.ts';
import type { ModCtx, Module } from '../types.ts';

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

export const ymir: Module = {
  id: 'ymir', name: 'Ymir', family: 'Machines',
  what: 'Tes machines virtuelles et conteneurs, sur tous tes serveurs de virtualisation.',
  does: ['tous les serveurs réunis (mode Asgard) : nœuds, machines, conteneurs', 'processeur, mémoire, disque de chaque machine', 'démarrer, arrêt propre, arrêt forcé, redémarrer', 'instantanés et retour en arrière (avec ton accord)', 'sauvegarde d\'une machine (Sindri, mode Andvari)', 'alerte si une machine s\'arrête ou si un nœud sature'],
  from: ['Proxmox VE', 'Proxmox Datacenter Manager'], upstream: ['proxmox/pve-manager'],
  modes: ['Asgard · tous les serveurs', 'Andvari · sauvegarde des machines'],
  words: ['machine virtuelle', 'machines virtuelles', 'vm', 'proxmox', 'conteneur lxc', 'lxc', 'hyperviseur', 'virtualisation', 'instantane', 'snapshot', 'noeud', 'nœud'],
  actions: [
    { id: 'machines', label: 'Machines virtuelles', what: 'Toutes les machines et leur état', read: true, words: ['liste', 'machines', 'vm'], run: async (ctx) => { const { res, errors } = await resources(ctx); const vms = res.filter((r) => r.vmid); return { text: `${vms.map((r) => `- ${r.vmid} ${r.name} (${r.type === 'lxc' ? 'conteneur' : 'VM'}, ${r.server}/${r.node}) · ${r.status} · ${gb(r.mem)} / ${gb(r.maxmem)}`).join('\n') || 'Aucune machine (Réglages → Proxmox).'}${errors.length ? `\n⚠ ${errors.join(' ; ')}` : ''}` }; } },
    { id: 'demarrer', label: 'Démarrer', what: 'Démarre une machine', params: [{ key: 'vmid', label: 'Numéro', kind: 'number', required: true }], words: ['demarre', 'démarre', 'allume'], run: async (ctx, i) => ({ text: await act(ctx, Number(i.vmid), 'start') }) },
    { id: 'arreter', label: 'Arrêt propre', what: 'Éteint proprement une machine', params: [{ key: 'vmid', label: 'Numéro', kind: 'number', required: true }], grave: (i) => `éteindre la machine ${s(i.vmid)}`, words: ['eteins', 'éteins', 'arrete', 'arrête'], run: async (ctx, i) => ({ text: await act(ctx, Number(i.vmid), 'shutdown') }) },
    { id: 'redemarrer', label: 'Redémarrer', what: 'Redémarre une machine', params: [{ key: 'vmid', label: 'Numéro', kind: 'number', required: true }], grave: (i) => `redémarrer la machine ${s(i.vmid)}`, run: async (ctx, i) => ({ text: await act(ctx, Number(i.vmid), 'reboot') }) },
    { id: 'instantane', label: 'Instantané', what: 'Photo de la machine à cet instant', params: [{ key: 'vmid', label: 'Numéro', kind: 'number', required: true }, { key: 'nom', label: 'Nom', kind: 'text', default: '' }], run: async (ctx, i) => ({ text: await act(ctx, Number(i.vmid), 'snapshot', { snapname: s(i.nom) || `odin-${ctx.now().toISOString().slice(0, 16).replace(/[-:T]/g, '')}` }) }) },
    { id: 'revenir', label: 'Revenir à un instantané', what: 'Remet la machine dans l\'état de l\'instantané', params: [{ key: 'vmid', label: 'Numéro', kind: 'number', required: true }, { key: 'nom', label: 'Instantané', kind: 'text', required: true }], grave: (i) => `remettre la machine ${s(i.vmid)} à l'instantané ${s(i.nom)} (les changements depuis sont perdus)`, run: async (ctx, i) => ({ text: await act(ctx, Number(i.vmid), 'rollback', { snapname: s(i.nom) }) }) },
    { id: 'serveur', label: 'Ajouter un serveur', what: 'Relier un serveur de virtualisation (jeton d\'API dans le coffre)', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'adresse', label: 'Adresse (https://…:8006)', kind: 'text', required: true }], run: (ctx, i) => { const list = ((ctx.settings.servers as PveServer[]) ?? []).filter((x) => x.name !== s(i.nom)); ctx.saveSettings({ servers: [...list, { name: s(i.nom), url: s(i.adresse).trim() }] }); return { text: `🔗 Serveur ${s(i.nom)} ajouté. Range son jeton d'API dans le coffre (${list.length ? `PROXMOX_TOKEN_${s(i.nom).toUpperCase().replace(/[^A-Z0-9]/g, '_')}` : 'PROXMOX_TOKEN'}).` }; } },
  ],
  async view(ctx) {
    const { res, errors } = await resources(ctx), nodes = res.filter((r) => r.type === 'node'), vms = res.filter((r) => r.vmid);
    const cpu = nodes.length ? Math.round((nodes.reduce((a, n) => a + (n.cpu ?? 0), 0) / nodes.length) * 100) : 0, mem = nodes.reduce((a, n) => a + (n.mem ?? 0), 0), maxmem = nodes.reduce((a, n) => a + (n.maxmem ?? 0), 0);
    return {
      subtitle: errors.length ? `⚠ ${errors.join(' ; ')}` : servers(ctx).length ? `${servers(ctx).length} serveur(s) · ${nodes.length} nœud(s)` : 'Aucun serveur relié : ajoute-en un à droite.',
      tabs: ['Ymir · machines', 'Asgard · serveurs', 'Andvari · sauvegardes'],
      kpis: [{ label: 'Processeur', value: `${cpu} %`, pct: cpu, tone: cpu > 85 ? 'attention' : 'bon' }, { label: 'Mémoire', value: `${gb(mem)} / ${gb(maxmem)}`, pct: maxmem ? Math.round((mem / maxmem) * 100) : 0 }, { label: 'Machines actives', value: `${vms.filter((v) => v.status === 'running').length} / ${vms.length}` }],
      sections: [{ kind: 'table', title: 'Machines', columns: ['N°', 'Machine', 'Type', 'Serveur / nœud', 'Processeur', 'Mémoire', 'État'], empty: 'Aucune machine.', rows: vms.sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0)).map((v) => ({ cells: [String(v.vmid), v.name ?? '', v.type === 'lxc' ? 'conteneur' : 'VM', `${v.server} / ${v.node}`, `${Math.round((v.cpu ?? 0) * 100)} %`, `${gb(v.mem)} / ${gb(v.maxmem)}`, v.status ?? ''], tone: v.status === 'running' ? 'bon' : 'neutre', actions: v.status === 'running' ? [{ action: 'instantane', label: 'Instantané', input: { vmid: v.vmid } }, { action: 'redemarrer', label: 'Redémarrer', input: { vmid: v.vmid } }, { action: 'arreter', label: 'Arrêter', input: { vmid: v.vmid } }] : [{ action: 'demarrer', label: 'Démarrer', input: { vmid: v.vmid } }] })) }],
      side: [{ kind: 'list', title: 'Asgard · nœuds', items: nodes.map((n) => ({ title: `${n.server} / ${n.node}`, detail: `${Math.round((n.cpu ?? 0) * 100)} % CPU · ${gb(n.mem)} / ${gb(n.maxmem)}`, tone: n.status === 'online' ? 'bon' : 'mauvais' })), empty: 'Aucun nœud.' }, { kind: 'form', title: 'Relier un serveur', action: 'serveur', submit: 'Ajouter', params: ymir.actions[6].params! }],
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
