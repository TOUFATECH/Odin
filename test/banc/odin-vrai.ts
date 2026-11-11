// Un VRAI Odin lancé pour le banc : passerelle, interface web, applis (Valhalla). Sert aux scénarios
// qui attaquent ou parcourent l'interface comme le ferait un visiteur (sécurité, affichage).

import { Gateway } from '../../src/bifrost/gateway.ts';
import { WebChannel, ensureWebToken } from '../../src/web/server.ts';
import { allModules, startValhalla, valhallaOf } from '../../src/valhalla/odin.ts';
import type { Module } from '../../src/valhalla/types.ts';
import type { Script } from '../../src/providers/mock.ts';
import { makeOdin, type TestOdin } from '../helpers.ts';
import { freePort, type T } from './lib.ts';

export const COMPTE = { prenom: 'Awa', nom: 'Saïd', email: 'awa@exemple.yt', password: 'un-cheval-bleu-traverse-mamoudzou' };
export interface VraiOdin { o: TestOdin; url: string; port: number; token: string; web: WebChannel; notified: string[]; /** cookie de session (si le compte a été créé) */ session: string; json(path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> }

/** Démarre Odin sur un port libre. `compte` : crée le compte du propriétaire et ouvre une session. */
export async function vraiOdin(t: T, opts: { script?: Script; modules?: (o: TestOdin) => Module[]; compte?: boolean; valhalla?: boolean } = {}): Promise<VraiOdin> {
  const saved = { MQTT_PASSWORD: process.env.MQTT_PASSWORD, BRISINGAMEN_KEY: process.env.BRISINGAMEN_KEY };
  t.onEnd(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const o = makeOdin(opts.script ?? [{ text: 'ok' }]); t.onEnd(() => o.cleanup());
  const port = await freePort(), token = ensureWebToken(o.paths), notified: string[] = [];
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  const web = new WebChannel(o, { scanNetwork: async () => undefined }, { port, host: '127.0.0.1', token, access: 'local', scryptN: 1024 });
  gw.add(web); await gw.start(); t.onEnd(() => gw.stop());
  if (opts.valhalla !== false) { const stop = startValhalla(o, async (text) => { notified.push(text); }, { modules: opts.modules ? opts.modules(o) : allModules(o) }); t.onEnd(stop); if (!valhallaOf()) throw new Error('Valhalla n\'a pas démarré'); }
  const url = `http://127.0.0.1:${port}`;
  let session = '';
  const json: VraiOdin['json'] = async (path, body, headers = {}) => {
    const r = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-odin': '1' }), ...(session && !('cookie' in headers) && !('authorization' in headers) ? { cookie: session } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' });
    const text = await r.text(); let parsed: Record<string, unknown> = {};
    try { const j = JSON.parse(text) as unknown; parsed = j && typeof j === 'object' ? j as Record<string, unknown> : { value: j }; } catch { parsed = { text }; }
    return { status: r.status, body: parsed, headers: r.headers };
  };
  if (opts.compte) {
    const r = await fetch(`${url}/api/account/create`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1', cookie: `odin_token=${token}` }, body: JSON.stringify(COMPTE) });
    session = r.headers.getSetCookie().find((c) => c.startsWith('odin_session='))?.split(';')[0] ?? '';
    if (!session) throw new Error(`compte de test non créé (${r.status})`);
  }
  return { o, url, port, token, web, notified, get session() { return session; }, json };
}
