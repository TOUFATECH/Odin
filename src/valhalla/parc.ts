// Le parc de machines d'Hydre (maquettes validées) : ordinateurs installés par le réseau (Genèse), VM et LXC
// (Proxmox), conteneurs et piles Docker (Argo) réunis, avec les mêmes noms automatiques (pc-, vm-, lxc-, dk-,
// pile-) et le même suivi. Calculs purs : noms, ports libres, lecture des ports déjà pris.

export type Kind = 'PC' | 'VM' | 'LXC' | 'Docker' | 'Pile';
export const PREFIX: Record<Kind, string> = { PC: 'pc', VM: 'vm', LXC: 'lxc', Docker: 'dk', Pile: 'pile' };

/** « Jellyfin/Jellyfin:10.11 » → « jellyfin » ; « Windows 11 Pro » → « windows-11-pro ». */
export function slug(x: string): string {
  const base = String(x || 'machine').split('/').pop()!.split(':')[0].split('@')[0];
  return base.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'machine';
}
/** Un nom automatique libre : préfixe du type, ce qu'elle est, numéro (dk-jellyfin-01, vm-debian-02…). */
export function autoName(kind: Kind, what: string, taken: Iterable<string>): string {
  const t = new Set(taken), stem = `${PREFIX[kind]}-${slug(what)}`;
  for (let n = 1; n < 100; n++) { const name = `${stem}-${String(n).padStart(2, '0')}`; if (!t.has(name)) return name; }
  return `${stem}-${Date.now().toString(36)}`;
}
/** Ports déjà pris : sortie « docker ps » (Ports) et « ss -ltn ». */
export function usedPorts(dockerPorts: string[], ss = ''): Set<number> {
  const out = new Set<number>();
  for (const p of dockerPorts) for (const m of String(p).matchAll(/:(\d{1,5})->/g)) out.add(Number(m[1]));
  for (const line of ss.split('\n')) { const m = /\s(?:\S*?):(\d{1,5})\s/.exec(` ${line} `); if (m && /LISTEN/i.test(line)) out.add(Number(m[1])); }
  return out;
}
/** Le port voulu s'il est libre, sinon le suivant libre (on ne touche jamais à ce qui tourne déjà). */
export function freePort(want: number, used: Set<number>): number {
  for (let p = want; p < want + 200 && p < 65536; p++) if (!used.has(p)) return p;
  throw new Error(`aucun port libre après ${want}`);
}
export interface PortMap { host: number; inner: number; proto: 'tcp' | 'udp' }
/** « 8096:8096, 8920:8920/udp, 3000 » → liste propre (refuse le reste). */
export function parsePorts(x: string): PortMap[] {
  return String(x || '').split(/[,\s]+/).filter(Boolean).map((p) => {
    const m = /^(\d{1,5})(?::(\d{1,5}))?(?:\/(tcp|udp))?$/.exec(p.trim()); if (!m) throw new Error(`port invalide : ${p}`);
    const host = Number(m[1]), inner = Number(m[2] ?? m[1]); if (host < 1 || host > 65535 || inner < 1 || inner > 65535) throw new Error(`port invalide : ${p}`);
    return { host, inner, proto: (m[3] as 'udp') ?? 'tcp' };
  });
}
export interface Mount { host: string; inner: string; ro: boolean }
/** « /data/medias:/media:ro, /data/jellyfin:/config » → montages (chemins absolus seulement, jamais / ni /etc…). */
export function parseMounts(x: string): Mount[] {
  return String(x || '').split(/[,\n]+/).map((v) => v.trim()).filter(Boolean).map((v) => {
    const [host, inner, mode] = v.split(':');
    if (!host?.startsWith('/') || !inner?.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(host + inner)) throw new Error(`dossier invalide : ${v}`);
    if (/^\/(etc|bin|sbin|usr|boot|proc|sys|dev|root|var\/run\/docker\.sock)?\/?$/.test(host) || host === '/var/run/docker.sock') throw new Error(`dossier refusé (système) : ${host}`);
    return { host, inner, ro: mode === 'ro' };
  });
}
