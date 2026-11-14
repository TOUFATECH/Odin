// « Demander l'accès » : un nouvel appareil (téléphone, PC) qui n'a pas le jeton demande à entrer.
// Odin prévient le propriétaire (Telegram, écrans déjà connectés) avec un code à 6 chiffres affiché des
// deux côtés ; le propriétaire touche Autoriser, et l'appareil entre sans avoir recopié de jeton.
// Rien n'est donné sans ce geste : la demande expire en 10 minutes et le nombre de demandes est limité.

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export interface PairRequest { id: string; code: string; device: string; ip: string; at: number; state: 'attente' | 'ok' | 'refus' }
interface Entry extends PairRequest { secret: string }

const TTL = 10 * 60_000;

/** Nom lisible de l'appareil à partir de son navigateur (pur). */
export function deviceName(ua = ''): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'appareil';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navigateur';
  return `${br} sur ${os}`;
}

export class Pairing {
  private reqs = new Map<string, Entry>();
  private perIp = new Map<string, number[]>();

  /** Nouvelle demande. undefined si trop de demandes (3 par appareil et par 10 min, 5 en attente au plus). */
  request(ua: string, ip: string, now = Date.now(), device?: string): (PairRequest & { secret: string }) | undefined {
    this.prune(now);
    const hits = (this.perIp.get(ip) ?? []).filter((t) => now - t < TTL);
    if (hits.length >= 3 || this.pending(now).length >= 5) return undefined;
    this.perIp.set(ip, [...hits, now]);
    const e: Entry = { id: randomBytes(6).toString('hex'), secret: randomBytes(24).toString('hex'), code: String(randomInt(0, 1_000_000)).padStart(6, '0'), device: device ?? deviceName(ua), ip, at: now, state: 'attente' };
    this.reqs.set(e.id, e);
    return { ...e };
  }

  /** Décision du propriétaire. */
  decide(id: string, ok: boolean, now = Date.now()): PairRequest | undefined {
    this.prune(now);
    const e = this.reqs.get(id);
    if (!e || e.state !== 'attente') return e ? strip(e) : undefined;
    e.state = ok ? 'ok' : 'refus';
    return strip(e);
  }

  /** Le navigateur qui a fait la demande vient voir où elle en est (avec son secret). Un « ok » ne sert qu'une fois. */
  collect(secret: string, now = Date.now()): PairRequest['state'] | 'inconnue' {
    this.prune(now);
    const b = Buffer.from(String(secret));
    for (const e of this.reqs.values()) {
      const s = Buffer.from(e.secret);
      if (s.length === b.length && timingSafeEqual(s, b)) { if (e.state !== 'attente') this.reqs.delete(e.id); return e.state; }
    }
    return 'inconnue';
  }

  pending(now = Date.now()): PairRequest[] { this.prune(now); return [...this.reqs.values()].filter((e) => e.state === 'attente').map(strip); }

  private prune(now: number): void { for (const [k, e] of this.reqs) if (now - e.at > TTL) this.reqs.delete(k); }
}

const strip = (e: Entry): PairRequest => ({ id: e.id, code: e.code, device: e.device, ip: e.ip, at: e.at, state: e.state });
