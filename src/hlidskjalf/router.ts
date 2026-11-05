// Bloquer / débloquer un appareil sur la box ou le routeur, par son adresse MAC.
// Odin passe par SSH avec le compte enregistré dans Réglages → Droits et machines (l'IP de la box).
// Il reconnaît tout seul OpenWrt, MikroTik (RouterOS) et un routeur Linux (iptables).
// Les box d'opérateur (Livebox, SFR, Bbox…) n'ont pas d'accès SSH : Odin le dit, et peut passer
// par leur page d'administration avec le navigateur si tu le lui demandes.

import { listMachines, runOnMachine, type Machine } from '../machines/access.ts';

export type RouterKind = 'openwrt' | 'mikrotik' | 'linux';

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;
export const normMac = (m: string): string => m.trim().toLowerCase().replace(/-/g, ':');
export const validMac = (m: string): boolean => MAC_RE.test(normMac(m));
const tag = (mac: string) => `odin-block-${normMac(mac).replace(/:/g, '')}`;

/** Commandes de blocage / déblocage / liste pour chaque type de routeur. Le MAC est validé avant. */
export function routerCommands(kind: RouterKind, mac: string): { block: string; unblock: string; list: string } {
  const m = normMac(mac), t = tag(m);
  if (!MAC_RE.test(m)) throw new Error(`adresse MAC invalide : ${mac}`);
  if (kind === 'openwrt') return {
    // Une règle par appareil : il ne passe plus par le routeur (ni Internet, ni les autres réseaux).
    block: `uci -q delete firewall.${t}; uci set firewall.${t}=rule && uci set firewall.${t}.name='${t}' && uci set firewall.${t}.src='*' && uci set firewall.${t}.dest='*' && uci set firewall.${t}.src_mac='${m}' && uci set firewall.${t}.target='REJECT' && uci set firewall.${t}.enabled='1' && uci commit firewall && /etc/init.d/firewall reload >/dev/null 2>&1; uci -q get firewall.${t}.src_mac`,
    unblock: `uci -q delete firewall.${t}; uci commit firewall && /etc/init.d/firewall reload >/dev/null 2>&1; echo ok`,
    list: `uci show firewall | grep -o "odin-block-[0-9a-f]*\\.src_mac='[^']*'" || true`,
  };
  if (kind === 'mikrotik') return {
    block: `/ip firewall filter remove [find comment="${t}"]; /ip firewall filter add chain=forward src-mac-address=${m.toUpperCase()} action=drop comment="${t}" place-before=0; /ip firewall filter print count-only where comment="${t}"`,
    unblock: `/ip firewall filter remove [find comment="${t}"]; :put ok`,
    list: `/ip firewall filter print terse where comment~"odin-block"`,
  };
  return {
    block: `iptables -D FORWARD -m mac --mac-source ${m} -m comment --comment ${t} -j DROP 2>/dev/null; iptables -I FORWARD 1 -m mac --mac-source ${m} -m comment --comment ${t} -j DROP && iptables -S FORWARD | grep -c ${t}`,
    unblock: `while iptables -D FORWARD -m mac --mac-source ${m} -m comment --comment ${t} -j DROP 2>/dev/null; do :; done; echo ok`,
    list: `iptables -S FORWARD | grep odin-block || true`,
  };
}

/** Le compte de la box : la machine enregistrée dont l'hôte est la passerelle. */
export function routerMachine(home: string, gatewayIp: string | undefined): Machine | undefined {
  const all = listMachines(home);
  return all.find((m) => m.host === gatewayIp) ?? all.find((m) => /box|routeur|router|openwrt|mikrotik|pfsense|gateway|passerelle/i.test(`${m.label ?? ''} ${m.id}`));
}

export async function detectRouter(home: string, m: Machine): Promise<RouterKind> {
  const r = await runOnMachine(home, m, 'cat /etc/openwrt_release 2>/dev/null | head -1; command -v iptables; :put [/system resource get version]', { timeoutMs: 15_000 }).catch(() => ({ code: 1, out: '' }));
  if (/DISTRIB_ID|openwrt/i.test(r.out)) return 'openwrt';
  if (/^\d+\.\d+.*(stable|long-term|testing)|routeros/im.test(r.out)) return 'mikrotik';
  return 'linux';
}

export async function routerAction(home: string, m: Machine, action: 'block' | 'unblock' | 'list', mac = '00:00:00:00:00:00'): Promise<{ ok: boolean; kind: RouterKind; out: string }> {
  const kind = await detectRouter(home, m);
  const cmd = routerCommands(kind, mac)[action];
  const r = await runOnMachine(home, m, kind === 'linux' && m.user !== 'root' ? `sudo -n sh -c ${JSON.stringify(cmd)}` : cmd, { timeoutMs: 30_000 });
  return { ok: r.code === 0, kind, out: r.out.trim().slice(0, 2000) };
}
