// Proxmox VE : voir et piloter les machines virtuelles et conteneurs LXC.
// Adresse dans Réglages (proxmox.url, ex. https://192.168.1.10:8006) ; jeton d'API dans PROXMOX_TOKEN
// (format « utilisateur@pam!nom=secret », créé dans Proxmox : Datacenter → Permissions → API Tokens).
// Le certificat auto-signé de Proxmox est accepté (réseau local) ; le jeton n'est jamais affiché.

import { request } from 'node:https';
import { obj, str, type Tool, type ToolContext } from './registry.ts';

const s = (v: unknown) => String(v ?? '');

export interface PveResource { type: string; node: string; vmid?: number; name?: string; status?: string; maxmem?: number; mem?: number; cpu?: number; uptime?: number; maxdisk?: number; disk?: number }

/** Appel à l'API Proxmox (pur côté réseau : renvoie data ou lève une erreur lisible). */
export function pveApi(base: string, token: string, method: 'GET' | 'POST', path: string, body?: Record<string, string>, timeoutMs = 15_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(`${base.replace(/\/$/, '')}/api2/json${path}`); } catch { reject(new Error('adresse Proxmox invalide (ex. https://192.168.1.10:8006)')); return; }
    const data = body ? new URLSearchParams(body).toString() : undefined;
    const req = request({ hostname: u.hostname, port: u.port || 8006, path: u.pathname + u.search, method, rejectUnauthorized: false, timeout: timeoutMs,
      headers: { authorization: `PVEAPIToken=${token}`, accept: 'application/json', ...(data ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let txt = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => { txt += d; });
      res.on('end', () => {
        if ((res.statusCode ?? 0) >= 400) { reject(new Error(`Proxmox : HTTP ${res.statusCode} ${(res.statusMessage ?? '').slice(0, 120)}${res.statusCode === 401 ? ' (jeton refusé : vérifie PROXMOX_TOKEN et ses droits)' : ''}`)); return; }
        try { resolve((JSON.parse(txt) as { data: unknown }).data); } catch { reject(new Error('réponse Proxmox illisible')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Proxmox ne répond pas')); });
    req.on('error', (e) => reject(new Error(`Proxmox injoignable : ${e.message}`)));
    if (data) req.write(data);
    req.end();
  });
}

function conf(ctx: ToolContext): { url: string; token: string } {
  const url = ctx.proxmox?.url ?? '', token = process.env.PROXMOX_TOKEN ?? '';
  if (!url || !token) throw new Error('Proxmox n\'est pas configuré : Réglages → Proxmox (adresse et jeton d\'API).');
  return { url, token };
}

const gb = (n?: number) => (n ? `${(n / 1024 ** 3).toFixed(1)} Go` : '?');
/** Liste lisible des ressources (pur, testable). */
export function formatResources(rs: PveResource[]): string {
  const nodes = rs.filter((r) => r.type === 'node');
  const guests = rs.filter((r) => r.type === 'qemu' || r.type === 'lxc').sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0));
  const lines = nodes.map((n) => `Nœud ${n.node} : ${n.status ?? '?'} · CPU ${Math.round((n.cpu ?? 0) * 100)} % · mémoire ${gb(n.mem)} / ${gb(n.maxmem)}`);
  for (const g of guests) lines.push(`${g.status === 'running' ? '●' : '○'} ${g.vmid} ${g.name ?? ''} · ${g.type === 'lxc' ? 'conteneur LXC' : 'machine virtuelle'} · ${g.status ?? '?'} · nœud ${g.node}${g.status === 'running' ? ` · mémoire ${gb(g.mem)} / ${gb(g.maxmem)}` : ''}`);
  return lines.join('\n') || 'Aucune ressource.';
}

export const proxmoxList: Tool = {
  name: 'proxmox_list',
  description: 'Liste les nœuds, machines virtuelles et conteneurs LXC de Proxmox, avec leur état et leur mémoire.',
  risk: 'read',
  schema: obj({}),
  async run(_i, ctx) {
    const { url, token } = conf(ctx);
    return formatResources(await pveApi(url, token, 'GET', '/cluster/resources') as PveResource[]);
  },
};

const ACTIONS = ['start', 'shutdown', 'stop', 'reboot', 'snapshot', 'rollback'] as const;
export const proxmoxAction: Tool = {
  name: 'proxmox_action',
  description: 'Agit sur une machine virtuelle ou un conteneur Proxmox (par numéro vmid) : start, shutdown (arrêt propre), stop (arrêt forcé), reboot, snapshot (instantané nommé), rollback (revenir à l\'instantané « name »).',
  risk: 'exec',
  schema: obj({ vmid: str('numéro de la VM ou du conteneur (ex. 101)'), action: str(`une de : ${ACTIONS.join(', ')}`), name: str('nom de l\'instantané (snapshot)') }, ['vmid', 'action']),
  summarize: (i) => `Proxmox : ${s(i.action)} sur ${s(i.vmid)}${i.name ? ` (${s(i.name)})` : ''}`,
  async run(i, ctx) {
    const { url, token } = conf(ctx);
    const action = s(i.action) as typeof ACTIONS[number];
    if (!ACTIONS.includes(action)) return `Action inconnue : ${action} (${ACTIONS.join(', ')})`;
    const vmid = Number(i.vmid);
    const rs = await pveApi(url, token, 'GET', '/cluster/resources?type=vm') as PveResource[];
    const g = rs.find((r) => r.vmid === vmid);
    if (!g) return `Aucune VM ni conteneur n° ${vmid}.`;
    const base = `/nodes/${encodeURIComponent(g.node)}/${g.type}/${vmid}`;
    if (action === 'rollback') {
      if (!s(i.name)) return 'Donne le nom de l\'instantané (name).';
      return `Retour à l'instantané « ${s(i.name)} » demandé pour ${g.name ?? vmid} (tâche ${s(await pveApi(url, token, 'POST', `${base}/snapshot/${encodeURIComponent(s(i.name))}/rollback`))}).`;
    }
    if (action === 'snapshot') {
      const name = (s(i.name) || `odin-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`).replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[^A-Za-z]/, 's$&').slice(0, 40);
      const task = await pveApi(url, token, 'POST', `${base}/snapshot`, { snapname: name, description: 'Instantané créé par Odin' });
      return `Instantané « ${name} » demandé pour ${g.name ?? vmid} (tâche ${s(task)}).`;
    }
    const task = await pveApi(url, token, 'POST', `${base}/status/${action}`);
    return `${action} demandé pour ${g.name ?? vmid} (${g.type === 'lxc' ? 'conteneur' : 'VM'} ${vmid}) — tâche ${s(task)}.`;
  },
};

export const PROXMOX_TOOLS: Tool[] = [proxmoxList, proxmoxAction];
