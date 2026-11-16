// Les vignettes des résultats (images, miniatures de vidéos, icônes de sites), passées par Odin. L'adresse vient
// d'un moteur : elle n'est PAS FIABLE. Le nom est résolu une seule fois, toutes ses adresses doivent être publiques,
// puis Odin se connecte à l'adresse vérifiée elle-même (jamais une deuxième résolution du nom), à chaque saut.
import { request as requeteHttp, type IncomingHttpHeaders } from 'node:http';
import { request as requeteHttps } from 'node:https';
import { isIP } from 'node:net';
import { adresseVerifiee } from './adresse-publique.ts';

const MAX = 3_000_000;
const ACCEPTE = 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon';
/** Les seuls types rendus. Jamais de SVG (il peut contenir du script). */
const TYPES = /^image\/(png|jpe?g|gif|webp|avif|x-icon|vnd\.microsoft\.icon)$/i;

/** Une requête GET vers `u`, connectée à l'adresse `ip` déjà vérifiée. */
export type Transport = (u: URL, ip: string, signal: AbortSignal) => Promise<Response>;

const versEntetes = (h: IncomingHttpHeaders) => {
  const out = new Headers();
  for (const [k, v] of Object.entries(h)) if (typeof v === 'string') out.set(k, v); else if (Array.isArray(v)) out.set(k, v.join(', '));
  return out;
};

/** Le vrai transport : la résolution de nom est remplacée par l'adresse vérifiée (le nom reste dans Host et TLS). */
export const transportReseau: Transport = (u, ip, signal) => new Promise<Response>((ok, ko) => {
  const famille = isIP(ip) || 4, nom = u.hostname.replace(/^\[|\]$/g, '');
  const req = (u.protocol === 'https:' ? requeteHttps : requeteHttp)(u, {
    method: 'GET', signal, headers: { accept: ACCEPTE, 'user-agent': 'Odin-recherche/1' },
    ...(u.protocol === 'https:' && !isIP(nom) ? { servername: nom } : {}),
    lookup: ((_h: string, o: { all?: boolean } | undefined, cb: (e: Error | null, a: unknown, f?: number) => void) => {
      if (o?.all) cb(null, [{ address: ip, family: famille }]); else cb(null, ip, famille);
    }) as never,
  }, (res) => {
    const parts: Buffer[] = []; let total = 0;
    res.on('data', (c: Buffer) => { total += c.length; if (total > MAX + 1) { res.destroy(); ko(new Error('trop lourde')); return; } parts.push(c); });
    res.on('error', ko);
    res.on('end', () => {
      const st = res.statusCode ?? 502;
      try { ok(new Response([204, 205, 304].includes(st) ? null : Buffer.concat(parts), { status: st, headers: versEntetes(res.headers) })); } catch (e) { ko(e); }
    });
  });
  req.on('error', ko); req.end();
});

let transport: Transport = transportReseau;
/** Pour les essais seulement : un transport simulé (sans argument : le vrai revient). */
export function remplacerTransport(t?: Transport): void { transport = t ?? transportReseau; }

/** La vignette : une image publique de 3 Mo au plus, deux redirections au plus (chacune vérifiée), sinon une erreur. */
export async function chercherVignette(adresse: string, signal: AbortSignal = AbortSignal.timeout(8000)): Promise<{ type: string; corps: Buffer }> {
  let { u, ip } = await adresseVerifiee(adresse), r: Response | undefined;
  for (let k = 0; k < 3; k++) {
    r = await transport(u, ip, signal);
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null; if (!loc) break;
    void r.body?.cancel().catch(() => {});
    ({ u, ip } = await adresseVerifiee(new URL(loc, u)));
  }
  const type = (r?.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!r?.ok || !TYPES.test(type)) throw new Error('pas une image');
  const corps = Buffer.from(await r.arrayBuffer()); if (corps.length > MAX) throw new Error('trop lourde');
  return { type, corps };
}
