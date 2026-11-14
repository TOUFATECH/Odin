// Accès réseau des applis d'Odin : quand un service démarre (proxy, VPN, DNS…), son port est ouvert sur
// la machine d'Odin (pare-feu ufw ou firewalld, par Cerbère). Sans pare-feu actif, rien à faire. L'accès
// depuis Internet passe ensuite par la box (UPnP, Vortex / Valgrind) ou le tunnel Cloudflare (Bifröst).
import { execFile } from 'node:child_process';
import type { ModCtx } from './types.ts';

/** Ouvre ces ports sur la machine ; rend une petite phrase à ajouter au résultat (vide si rien à dire). */
export async function openOnHost(ctx: ModCtx, ports: Array<[number, 'tcp' | 'udp', string]>): Promise<string> {
  const done: string[] = [], bad: string[] = [];
  for (const [port, proto, why] of ports) {
    if (!port) continue;
    const r = await ctx.call('garmr', 'ouvrir_port', { port, proto, pour: why, par: why }, `ouvrir le port ${port}/${proto} pour ${why}`).catch((e) => ({ ok: false, text: (e as Error).message }));
    if (r.ok === false) bad.push(`${port}/${proto} : ${r.text.replace(/^Cerbère · Ouvrir un port : /, '')}`); else if (!/déjà joignable/.test(r.text)) done.push(`${port}/${proto}`);
  }
  return `${done.length ? `\n🔓 Pare-feu de la machine : ${done.join(', ')} ouvert(s).` : ''}${bad.length ? `\n⚠ Pare-feu : ${bad.join(' ; ')}` : ''}`;
}

// ---------------- Qui écoute sur la machine (pour dire « déjà pris, et par qui ») ----------------
export interface Listener { proto: 'tcp' | 'udp'; port: number; addr: string; prog?: string; pid?: number }
/** « ss -tulnpH » → ce qui écoute (protocole, port, adresse, programme quand la machine le dit). Pur. */
export function readListeners(out: string): Listener[] {
  const l: Listener[] = [];
  for (const line of out.split('\n')) {
    const c = line.trim().split(/\s+/); if (c.length < 5 || !/^(tcp|udp)$/.test(c[0])) continue;
    const k = c[4].lastIndexOf(':'), port = Number(c[4].slice(k + 1)); if (k < 0 || !Number.isInteger(port) || port < 1) continue;
    const u = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
    l.push({ proto: c[0] as 'tcp' | 'udp', port, addr: c[4].slice(0, k).replace(/^\[|\]$/g, '').replace(/%.*$/, ''), ...(u ? { prog: u[1], pid: Number(u[2]) } : {}) });
  }
  return l;
}
/** Les écoutes de la machine, maintenant (liste vide quand « ss » manque : Windows, Mac). */
export function listeners(): Promise<Listener[]> {
  return new Promise((ok) => { execFile('ss', ['-tulnpH'], { timeout: 4000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (e, out) => ok(e ? [] : readListeners(String(out)))); });
}
/** Qui tient ce port ? « « nginx » (programme n° 812) » ; rien quand la machine ne le dit pas. */
export async function holderOf(port: number, proto: 'tcp' | 'udp' = 'tcp', l?: Listener[]): Promise<string | undefined> {
  const x = (l ?? await listeners()).filter((y) => y.proto === proto && y.port === port), named = x.find((y) => y.prog) ?? x[0];
  if (!named) return undefined;
  if (named.pid === process.pid) return 'Odin lui-même (un autre de ses services)';
  return named.prog ? `« ${named.prog} » (programme n° ${named.pid})` : undefined;
}
/**
 * Un service n'a pas pu se mettre à l'écoute : la raison en clair (port déjà pris et par qui, droits manquants),
 * avec quoi faire. Toute autre erreur est rendue telle quelle.
 */
export async function explainListen(e: unknown): Promise<string> {
  const x = e as NodeJS.ErrnoException & { port?: number }, port = Number(x?.port);
  if (x?.code === 'EADDRINUSE' && port > 0) { const who = await holderOf(port, x.syscall === 'bind' ? 'udp' : 'tcp'); return `le port ${port} est déjà pris par ${who ?? 'un autre programme'} : arrête ce programme, ou change de port, puis relance`; }
  if (x?.code === 'EACCES' && port > 0) return port < 1024 ? `le port ${port} est sous 1024 et demande les droits d'administrateur : lance Odin en administrateur, ou choisis un port à partir de 1024` : `la machine refuse d'ouvrir le port ${port} (droits manquants)`;
  return (e as Error)?.message ?? String(e);
}
