// Petite requête HTTP(S) vers un appareil du réseau local (certificat auto-signé accepté : c'est
// la règle chez les appareils maison). Utilisée par Home Assistant, CalDAV… Jamais pour Internet.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface LanResponse { status: number; text: string; json<T = unknown>(): T }

export function lanRequest(url: string, o: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<LanResponse> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(url); } catch { reject(new Error(`adresse invalide : ${url}`)); return; }
    const body = o.body;
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, {
      method: o.method ?? 'GET', rejectUnauthorized: false, timeout: o.timeoutMs ?? 20_000,
      headers: { 'user-agent': 'Odin/1.0', ...(o.headers ?? {}), ...(body !== undefined ? { 'content-length': String(Buffer.byteLength(body)) } : {}) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => { if (text.length < 5_000_000) text += d; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text, json: <T>() => JSON.parse(text) as T }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`${u.host} ne répond pas`)); });
    req.on('error', (e) => reject(new Error(`${u.host} injoignable : ${e.message}`)));
    if (body !== undefined) req.write(body);
    req.end();
  });
}
