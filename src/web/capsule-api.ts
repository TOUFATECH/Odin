// Écho · la porte des capsules de dictée (PC du parc) : POST /api/rodd/capsule, avec le jeton de la capsule
// (« Authorization: Bearer … »), le son en corps (WAV), et `?mode=` pour la mise en forme. Rend le texte à taper.
//
// - Jeton inconnu : 401 et un essai raté compté (même limite que les autres jetons d'Odin).
// - « 100 % local » : une dictée venue d'ailleurs que du réseau de la maison est refusée (la voix ne sort pas).
// - Le texte dicté est une donnée : « Odin, … » n'y devient JAMAIS un ordre (une capsule ne commande rien).
// - Le son n'est pas gardé (sauf « Garder l'audio brut », comme toute voix, voir audio-brut.ts).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { OdinConfig } from '../config.ts';
import { posteDuJeton } from '../valhalla/rodd/capsule.ts';
import { dictee, MODES, type Mode } from '../valhalla/modules/rodd.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import { hear, sttReady } from '../voice/voice.ts';

type Voix = OdinConfig['voice'];
const json = (res: ServerResponse, code: number, corps: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(corps)); };

/** Une adresse du réseau de la maison (ou la machine elle-même) ? Pur. */
export function adresseMaison(ip: string): boolean {
  const a = ip.replace(/^fwd:/, '').replace(/^::ffff:/i, '').trim();
  if (isIP(a) === 4) { const [x, y] = a.split('.').map(Number); return x === 10 || x === 127 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127); }
  if (isIP(a) === 6) return a === '::1' || /^f[cd]/i.test(a) || /^fe[89ab]/i.test(a);
  return false;
}

async function lire(req: IncomingMessage, max: number): Promise<Buffer | undefined> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return undefined; parts.push(c as Buffer); }
  return Buffer.concat(parts);
}

export interface OptionsCapsule {
  ip: string; home: string; voix: () => Voix;
  /** un essai de jeton raté (limite d'essais d'Odin) */
  echec: () => void;
  /** transcription (essais : remplacée) */
  entendre?: (audio: Uint8Array, mime: string, v: Voix) => Promise<{ text: string; language?: string }>;
}

export async function capsuleRoute(req: IncomingMessage, res: ServerResponse, url: URL, o: OptionsCapsule): Promise<boolean> {
  if (url.pathname !== '/api/rodd/capsule') return false;
  if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' }); res.end(); return true; }
  const jeton = /^Bearer\s+([a-f0-9]{64})$/i.exec(String(req.headers.authorization ?? ''))?.[1]?.toLowerCase() ?? '';
  const capsule = jeton ? posteDuJeton(o.home, jeton) : undefined;
  if (!capsule) { o.echec(); json(res, 401, { ok: false, error: 'capsule inconnue : réinstalle-la depuis Satellites' }); return true; }
  const v = o.voix();
  if (v.localOnly && !adresseMaison(o.ip)) { json(res, 403, { ok: false, error: '« 100 % local » : Odin ne reçoit la voix que depuis le réseau de la maison.' }); return true; }
  const entendre = o.entendre ?? ((a, m, vv) => hear(a, m, vv));
  if (!o.entendre && !sttReady(v)) { json(res, 200, { ok: false, error: 'L\'écoute n\'est pas encore installée sur Odin : dis-lui « installe la voix locale ».' }); return true; }
  const audio = await lire(req, 25 * 1024 * 1024);
  if (!audio) { json(res, 413, { ok: false, error: 'enregistrement trop long (25 Mo au plus)' }); return true; }
  if (!audio.length) { json(res, 400, { ok: false, error: 'enregistrement vide' }); return true; }
  const va = valhallaOf(); if (!va) { json(res, 503, { ok: false, error: 'applis non démarrées' }); return true; }
  try {
    const h = await entendre(new Uint8Array(audio), String(req.headers['content-type'] ?? 'audio/wav'), v);
    const m = url.searchParams.get('mode') ?? '', mode = ((MODES as readonly string[]).includes(m) ? m : capsule.mode) as Mode;
    const r = await dictee(va.ctx('rodd'), h.text, { mode, ou: `Capsule · ${capsule.poste}`, ordres: false });
    json(res, 200, { ok: true, texte: r.data.texte, brut: r.data.brut, poste: capsule.poste, ...(h.language ? { lang: h.language } : {}) });
  } catch (e) { json(res, 200, { ok: false, error: (e as Error).message.slice(0, 300) }); }
  return true;
}
