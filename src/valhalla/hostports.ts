// Accès réseau des applis d'Odin : quand un service démarre (proxy, VPN, DNS…), son port est ouvert sur
// la machine d'Odin (pare-feu ufw ou firewalld, par Cerbère). Sans pare-feu actif, rien à faire. L'accès
// depuis Internet passe ensuite par la box (UPnP, Vortex / Valgrind) ou le tunnel Cloudflare (Bifröst).
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
