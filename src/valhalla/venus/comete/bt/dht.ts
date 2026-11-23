// Comète · partage de fichiers : chercher des pairs dans le DHT (BEP 5), en simple CLIENT : Odin pose la question
// « qui a ce partage ? » (get_peers) de nœud en nœud, sans jamais répondre aux autres ni garder de table publique
// (drapeau « lecture seule », BEP 43). Bornes : 300 questions par recherche, 8 en vol, 2 000 nœuds connus, réponse de
// 8 ko au plus ; les adresses des nœuds et des pairs passent par la même garde que les pairs (jamais la maison).
import { createSocket, type Socket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { dico, ecrire, liste, lire, octets } from './bencode.ts';
import { adressePermise, portValide, resoudreSur, type Resoudre } from './garde.ts';
import { pairsCompacts, type Pair } from './tracker.ts';

/** Les nœuds d'amorce publics habituels du DHT (on n'y envoie que des questions get_peers / find_node). */
export const AMORCES_DHT = ['router.bittorrent.com:6881', 'dht.transmissionbt.com:6881', 'router.utorrent.com:6881'];
const MAX_QUESTIONS = 300, EN_VOL = 8, MAX_NOEUDS = 2000;
interface Noeud { id: Buffer; ip: string; port: number; demande?: boolean }

/** Les nœuds « compacts » (26 octets : id, IPv4, port), filtrés. Pur. */
export function noeudsCompacts(b: Buffer, essai = false): Noeud[] {
  const out: Noeud[] = [];
  for (let k = 0; k + 26 <= b.length && out.length < 200; k += 26) {
    const ip = `${b[k + 20]}.${b[k + 21]}.${b[k + 22]}.${b[k + 23]}`, port = b.readUInt16BE(k + 24);
    if (portValide(port) && adressePermise(ip, essai)) out.push({ id: Buffer.from(b.subarray(k, k + 20)), ip, port });
  }
  return out;
}
const distance = (a: Buffer, b: Buffer) => { const d = Buffer.alloc(20); for (let i = 0; i < 20; i++) d[i] = a[i] ^ b[i]; return d; };

/**
 * Cherche des pairs pour une empreinte. Recommence toutes les 5 minutes tant que `signal` n'est pas levé.
 * `amorces` : « nom:port » (résolus et vérifiés comme les autres adresses).
 */
export function chercherDht(empreinte: Buffer, surPair: (p: Pair) => void, signal: AbortSignal, o: { amorces: string[]; resoudre: Resoudre; essai: boolean; journal?: (t: string) => void }): void {
  if (!o.amorces.length || signal.aborted) return;
  const s: Socket = createSocket('udp4'), monId = randomBytes(20);
  const attente = new Map<string, { ip: string; port: number; ok: (r: Record<string, unknown>) => void }>();
  s.on('error', () => undefined);
  s.on('message', (m, ri) => {
    if (m.length > 8192) return;
    let d: ReturnType<typeof dico>; try { d = dico(lire(m, { taille: 8192, profondeur: 6, elements: 1000 }).valeur); } catch { return; }
    const t = octets(d?.t)?.toString('hex'); if (!t) return;
    const a = attente.get(t); if (!a || a.ip !== ri.address || a.port !== ri.port) return;
    attente.delete(t); const r = dico(d!.r); if (r) a.ok(r as Record<string, unknown>);
  });
  const questionner = (n: Noeud): Promise<Record<string, unknown> | undefined> => new Promise((ok) => {
    const t = randomBytes(2), cle = t.toString('hex');
    const h = setTimeout(() => { attente.delete(cle); ok(undefined); }, 4000);
    attente.set(cle, { ip: n.ip, port: n.port, ok: (r) => { clearTimeout(h); ok(r); } });
    s.send(ecrire({ t, y: Buffer.from('q'), q: Buffer.from('get_peers'), ro: 1, a: { id: monId, info_hash: empreinte } }), n.port, n.ip, () => undefined);
  });
  const recherche = async (): Promise<number> => {
    const noeuds = new Map<string, Noeud>(); let questions = 0, trouves = 0;
    for (const a of o.amorces) {
      const k = a.lastIndexOf(':'), port = Number(a.slice(k + 1));
      try { if (portValide(port)) { const ip = await resoudreSur(a.slice(0, k), o.resoudre, o.essai); noeuds.set(`${ip}:${port}`, { id: Buffer.alloc(20), ip, port }); } } catch { /* amorce refusée ou introuvable */ }
    }
    while (!signal.aborted && questions < MAX_QUESTIONS) {
      const l = [...noeuds.values()].filter((n) => !n.demande).sort((x, y) => Buffer.compare(distance(x.id, empreinte), distance(y.id, empreinte))).slice(0, EN_VOL);
      if (!l.length) break;
      await Promise.all(l.map(async (n) => {
        n.demande = true; questions++;
        const r = await questionner(n); if (!r) return;
        for (const v of liste(r.values as never) ?? []) { const b = octets(v); if (b) for (const p of pairsCompacts(b, false, o.essai)) { trouves++; surPair(p); } }
        const nb = octets(r.nodes as never);
        if (nb) for (const x of noeudsCompacts(nb, o.essai)) { const k = `${x.ip}:${x.port}`; if (!noeuds.has(k) && noeuds.size < MAX_NOEUDS) noeuds.set(k, x); }
      }));
    }
    return trouves;
  };
  const boucle = async () => {
    try {
      while (!signal.aborted) {
        const n = await recherche(); o.journal?.(`DHT : ${n} pair(s) trouvé(s)`);
        await new Promise<void>((ok) => { const h = setTimeout(ok, 300_000); signal.addEventListener('abort', () => { clearTimeout(h); ok(); }, { once: true }); });
      }
    } finally { try { s.close(); } catch { /* déjà fermé */ } }
  };
  s.bind(0, () => { void boucle(); });
  signal.addEventListener('abort', () => { for (const a of attente.values()) a.ok({}); attente.clear(); }, { once: true });
}
