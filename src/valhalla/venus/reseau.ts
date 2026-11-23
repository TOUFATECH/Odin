// Vénus · le réseau de Delta et de Comète : une requête qui se connecte À L'ADRESSE VÉRIFIÉE, et à aucune autre.
// Avant, le nom était vérifié (résolu, puis comparé aux adresses interdites), puis `fetch` le résolvait une seconde
// fois : un nom qui change de réponse entre les deux (une source ou un lien piégé) menait Odin vers sa propre machine
// ou vers la maison. Ici le nom est résolu UNE fois, chaque adresse est vérifiée, et la connexion part vers l'adresse
// vérifiée (le nom reste dans l'en-tête Host et pour le certificat HTTPS). Aucune redirection n'est suivie, rien
// n'est décompressé (pas d'Accept-Encoding : pas de bombe de compression).
import { request as requeteHttp } from 'node:http';
import { request as requeteHttps } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type Resoudre = (hote: string) => Promise<string[]>;

const SANS_CORPS = new Set([204, 205, 304]);

/**
 * Un fetch qui ne se connecte qu'à une adresse vérifiée. `refuser(adresse)` rend la raison d'un refus (ou rien) ;
 * TOUTES les adresses du nom doivent passer. GET et HEAD seulement (Delta et Comète n'envoient rien d'autre).
 */
export function fetchVerifie(o: { resoudre: Resoudre; refuser: (adresse: string) => string | undefined }): Fetch {
  return async (url, init = {}) => {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('seules les adresses http et https sont acceptées');
    const methode = (init.method ?? 'GET').toUpperCase();
    if (methode !== 'GET' && methode !== 'HEAD') throw new Error('requête refusée');
    const hote = u.hostname.replace(/^\[|\]$/g, '');
    const adresses = isIP(hote) ? [hote] : await o.resoudre(hote).catch(() => [] as string[]);
    if (!adresses.length) throw new Error(`${hote.slice(0, 80)} : nom introuvable`);
    for (const a of adresses) { const r = o.refuser(a); if (r) throw new Error(r); }
    const cible = adresses.find((a) => isIP(a) === 4) ?? adresses[0]; // IPv4 d'abord : toutes les maisons ne sortent pas en IPv6
    const entetes: Record<string, string> = {};
    new Headers(init.headers as ConstructorParameters<typeof Headers>[0]).forEach((v, k) => { if (k !== 'host' && k !== 'accept-encoding') entetes[k] = v; });
    entetes.host = u.host;
    return new Promise<Response>((ok, ko) => {
      const req = (u.protocol === 'https:' ? requeteHttps : requeteHttp)({
        host: cible, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: `${u.pathname}${u.search}`, method: methode, headers: entetes,
        ...(u.protocol === 'https:' && !isIP(hote) ? { servername: hote } : {}), ...(init.signal ? { signal: init.signal } : {}), agent: false,
      }, (res) => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) { if (v === undefined) continue; for (const x of Array.isArray(v) ? v : [v]) h.append(k, x); }
        const statut = res.statusCode ?? 0;
        if (statut < 200 || statut > 599) { res.destroy(); ko(new Error(`réponse invalide (${statut})`)); return; }
        const corps = methode === 'HEAD' || SANS_CORPS.has(statut) ? (res.resume(), null) : Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>;
        ok(new Response(corps, { status: statut, headers: h }));
      });
      req.on('error', (e) => ko(new Error(`connexion impossible (${(e as NodeJS.ErrnoException).code ?? 'erreur'})`)));
      req.end();
    });
  };
}

/**
 * Un fetch dont chaque réponse est bornée : au-delà de `max` octets reçus, la lecture s'arrête en erreur (un serveur
 * qui annonce une petite taille puis envoie sans fin ne remplit pas le disque).
 */
export function fetchBorne(f: Fetch, max: number): Fetch {
  return async (url, init) => {
    const r = await f(url, init);
    if (!r.body) return r;
    let n = 0; const lecteur = r.body.getReader();
    const borne = new ReadableStream<Uint8Array>({
      async pull(c) {
        const { done, value } = await lecteur.read();
        if (done) { c.close(); return; }
        n += value.length;
        if (n > max) { await lecteur.cancel().catch(() => undefined); c.error(new Error(`le site envoie plus que la taille annoncée (${max} octets) : arrêté`)); return; }
        c.enqueue(value);
      },
      cancel: (raison) => lecteur.cancel(raison),
    });
    return new Response(borne, { status: r.status, headers: r.headers });
  };
}
