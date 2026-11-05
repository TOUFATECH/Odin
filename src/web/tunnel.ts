// Accès à Odin depuis l'extérieur, sans ouvrir de port sur ta box :
// - Tailscale (conseillé) : Odin n'est visible QUE de tes appareils Tailscale, à une adresse
//   https://<machine>.<ton-réseau>.ts.net avec un vrai certificat ;
// - Cloudflare (tunnel rapide) : une adresse https://….trycloudflare.com ouverte sur Internet,
//   toujours protégée par ton jeton et le blocage des essais ratés.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { withAdmin } from '../machines/access.ts';

export type TunnelKind = 'tailscale' | 'cloudflare';
export interface TunnelState { kind: TunnelKind | 'none'; url?: string; error?: string; running: boolean }

const has = (bin: string) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' }).status === 0;
export const tunnelAvailable = () => ({ tailscale: has('tailscale'), cloudflare: has('cloudflared') });
export const INSTALL: Record<TunnelKind, string> = {
  tailscale: 'curl -fsSL https://tailscale.com/install.sh | sudo sh && sudo tailscale up',
  cloudflare: 'curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$(dpkg --print-architecture).deb && sudo dpkg -i /tmp/cloudflared.deb',
};

/** Adresse Cloudflare trouvée dans la sortie de cloudflared (pur, testable). */
export const parseCloudflareUrl = (out: string) => /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(out)?.[0];
/** Nom Tailscale de la machine (pur, testable). */
export function parseTailscaleName(statusJson: string): string | undefined {
  try { const n = (JSON.parse(statusJson) as { Self?: { DNSName?: string } }).Self?.DNSName; return n ? n.replace(/\.$/, '') : undefined; } catch { return undefined; }
}

class Tunnel {
  state: TunnelState = { kind: 'none', running: false };
  private child?: ChildProcess;

  async start(kind: TunnelKind, port: number, tls: boolean, home: string): Promise<TunnelState> {
    this.stop(home);
    const target = `${tls ? 'https+insecure' : 'http'}://127.0.0.1:${port}`;
    if (kind === 'tailscale') {
      if (!has('tailscale')) return (this.state = { kind, running: false, error: 'Tailscale n\'est pas installé sur la machine d\'Odin.' });
      const a = withAdmin(`sudo tailscale serve --bg --https=443 ${target}`, home);
      const r = spawnSync('/bin/sh', ['-c', a.command], { env: { ...process.env, ...a.env }, encoding: 'utf8', timeout: 60_000 });
      if (r.status !== 0) return (this.state = { kind, running: false, error: `tailscale serve : ${(r.stderr || r.stdout).trim().slice(0, 300)} (Tailscale est-il connecté ? « sudo tailscale up »)` });
      const name = parseTailscaleName(spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 20_000 }).stdout ?? '');
      return (this.state = { kind, running: true, url: name ? `https://${name}/` : undefined });
    }
    if (!has('cloudflared')) return (this.state = { kind, running: false, error: 'cloudflared n\'est pas installé sur la machine d\'Odin.' });
    const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', tls ? `https://127.0.0.1:${port}` : `http://127.0.0.1:${port}`, ...(tls ? ['--no-tls-verify'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    this.state = { kind, running: true };
    let out = '';
    const url = await new Promise<string | undefined>((resolve) => {
      const t = setTimeout(() => resolve(undefined), 30_000);
      const on = (d: Buffer) => { out += d.toString(); const u = parseCloudflareUrl(out); if (u) { clearTimeout(t); resolve(u); } };
      child.stdout?.on('data', on); child.stderr?.on('data', on);
      child.on('exit', () => { clearTimeout(t); resolve(undefined); });
    });
    child.on('exit', () => { if (this.child === child) this.state = { ...this.state, running: false }; });
    return (this.state = url ? { kind, running: true, url: `${url}/` } : { kind, running: false, error: `cloudflared n'a pas donné d'adresse : ${out.trim().split('\n').slice(-2).join(' ').slice(0, 300)}` });
  }

  stop(home?: string): void {
    if (this.child) { try { this.child.kill(); } catch { /* déjà arrêté */ } this.child = undefined; }
    if (this.state.kind === 'tailscale' && this.state.running && home) {
      const a = withAdmin('sudo tailscale serve --https=443 off', home);
      spawnSync('/bin/sh', ['-c', a.command], { env: { ...process.env, ...a.env }, timeout: 30_000 });
    }
    this.state = { kind: 'none', running: false };
  }
}

export const tunnel = new Tunnel();
