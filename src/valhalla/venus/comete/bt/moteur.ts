// Comète · le moteur de partage de fichiers (protocole BitTorrent v1, écrit dans Odin, aucun logiciel à côté).
// Il prend un lien magnet ou un lien http(s) vers un fichier .torrent, télécharge SEULEMENT la vidéo voulue dans le
// dossier de travail de Comète, et rend son chemin : la suite (taille, vidéo seulement, antivirus, mise à part si
// douteux, rangement) est la chaîne de Comète, la même que pour un lien direct.
//
// Réglages (le propriétaire, Vénus → Réglages → Demandes → Comète) : pairs à la fois, envoi aux autres (pendant le
// téléchargement seulement, débit, ratio, durée), DHT, écoute entrante. Par défaut : connexions SORTANTES seulement
// (aucun port ouvert, aucune ouverture de port demandée à la box), envoi limité à 100 Ko/s et au ratio 1, coupé dès
// que le fichier est fini.
import { createServer, type Server, type Socket } from 'node:net';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';
import type { ModCtx } from '../../../types.ts';
import type { MagasinVenus } from '../../base.ts';
import { magasinVenus } from '../../base.ts';
import { chercherDht, AMORCES_DHT } from './dht.ts';
import { adressePermise, type Resoudre } from './garde.ts';
import { lireInfo, lireMagnet, lireTorrent, type Partage } from './metainfo.ts';
import { lirePoignee, poignee, PROTOCOLE } from './pair.ts';
import { Session } from './session.ts';
import type { Fetch, Pair } from './tracker.ts';

// ---------------------------------------------------------------- Réglages du propriétaire
export interface ReglagesPartage {
  maxPairs: number; dht: boolean;
  envoiPendant: boolean; envoiKo: number; ratio: number; dureeMin: number;
  /** après la fin : coupé (question posée au propriétaire ; seule réponse construite : coupé) */ apresFin: 'coupe';
  ecoute: boolean; portEcoute: number;
}
export const REGLAGES_PARTAGE_DEFAUT: ReglagesPartage = { maxPairs: 30, dht: true, envoiPendant: true, envoiKo: 100, ratio: 1, dureeMin: 0, apresFin: 'coupe', ecoute: false, portEcoute: 0 };
const borne = (v: unknown, min: number, max: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
export function reglagesPartage(mag: MagasinVenus): ReglagesPartage {
  const d = mag.get('acq_reglages', 'partage')?.data ?? {}, D = REGLAGES_PARTAGE_DEFAUT;
  return {
    maxPairs: Math.round(borne(d.maxPairs, 1, 50, D.maxPairs)), dht: d.dht === undefined ? D.dht : d.dht === true,
    envoiPendant: d.envoiPendant === undefined ? D.envoiPendant : d.envoiPendant === true, envoiKo: Math.round(borne(d.envoiKo, 0, 100_000, D.envoiKo)),
    ratio: borne(d.ratio, 0, 10, D.ratio), dureeMin: Math.round(borne(d.dureeMin, 0, 7 * 24 * 60, D.dureeMin)), apresFin: 'coupe',
    ecoute: d.ecoute === true && Number(d.portEcoute) > 1023, portEcoute: Math.round(borne(d.portEcoute, 0, 65535, 0)),
  };
}
export function reglerPartage(mag: MagasinVenus, p: Partial<ReglagesPartage>): ReglagesPartage {
  const r: ReglagesPartage = { ...reglagesPartage(mag) };
  if (p.maxPairs !== undefined) r.maxPairs = Math.round(borne(p.maxPairs, 1, 50, r.maxPairs));
  if (p.dht !== undefined) r.dht = !!p.dht;
  if (p.envoiPendant !== undefined) r.envoiPendant = !!p.envoiPendant;
  if (p.envoiKo !== undefined) r.envoiKo = Math.round(borne(p.envoiKo, 0, 100_000, r.envoiKo));
  if (p.ratio !== undefined) r.ratio = borne(p.ratio, 0, 10, r.ratio);
  if (p.dureeMin !== undefined) r.dureeMin = Math.round(borne(p.dureeMin, 0, 7 * 24 * 60, r.dureeMin));
  if (p.portEcoute !== undefined) { const n = Math.round(Number(p.portEcoute)); if (n !== 0 && !(n > 1023 && n < 65536)) throw new Error("port d'écoute : entre 1024 et 65535 (0 = aucun)"); r.portEcoute = n; }
  if (p.ecoute !== undefined) { if (p.ecoute && !(r.portEcoute > 1023)) throw new Error("l'écoute entrante demande un port (1024 à 65535)"); r.ecoute = !!p.ecoute; }
  mag.poser('acq_reglages', 'partage', { ...r }); return reglagesPartage(mag);
}
/** Une phrase sur les réglages. Pur. */
export const ligneReglagesPartage = (r: ReglagesPartage): string =>
  `partage de fichiers : ${r.maxPairs} pairs au plus · DHT ${r.dht ? 'oui' : 'non'} · envoi ${r.envoiPendant && r.envoiKo > 0 ? `pendant le téléchargement, ${r.envoiKo} Ko/s, ratio ${r.ratio || 'libre'}${r.dureeMin ? `, ${r.dureeMin} min au plus` : ''}` : 'coupé'} · coupé à la fin · ${r.ecoute ? `écoute sur le port ${r.portEcoute} (à ouvrir toi-même sur ta box)` : 'connexions sortantes seulement'}`;

// ---------------------------------------------------------------- L'écoute entrante (seulement si réglée)
const sessions = new Map<string, Session>();
let serveur: { s: Server; port: number } | undefined;
function inscrire(empreinte: Buffer, s: Session, ecoute: number | undefined, essai: boolean): () => void {
  const k = empreinte.toString('hex'); sessions.set(k, s);
  if (ecoute && (!serveur || serveur.port !== ecoute)) { serveur?.s.close(); serveur = { s: ecouter(ecoute, essai), port: ecoute }; }
  return () => { if (sessions.get(k) === s) sessions.delete(k); if (!sessions.size && serveur) { serveur.s.close(); serveur = undefined; } };
}
function ecouter(port: number, essai: boolean): Server {
  const srv = createServer({ pauseOnConnect: false }, (sock: Socket) => {
    const ip = (sock.remoteAddress ?? '').replace(/^::ffff:/, ''), rport = sock.remotePort ?? 0;
    if (!adressePermise(ip, essai) || sessions.size === 0) { sock.destroy(); return; }
    let recu = Buffer.alloc(0); const h = setTimeout(() => sock.destroy(), 10_000);
    sock.on('error', () => undefined);
    const lireDebut = (d: Buffer) => {
      recu = Buffer.concat([recu, d]); if (recu.length > 4096) { sock.destroy(); return; }
      if (recu.length >= 20 && !recu.subarray(0, 20).equals(PROTOCOLE)) { sock.destroy(); return; }
      if (recu.length < 68) return;
      clearTimeout(h); sock.off('data', lireDebut);
      try {
        const d0 = lirePoignee(recu), s = sessions.get(d0.empreinte.toString('hex'));
        if (!s) { sock.destroy(); return; }
        sock.write(poignee(d0.empreinte, s.idPair));
        if (!s.accueillir(sock, { ip, port: rport }, d0.extension, recu.subarray(68))) sock.destroy();
      } catch { sock.destroy(); }
    };
    sock.on('data', lireDebut);
  });
  srv.on('error', (e) => console.error(`[venus] comète : écoute du partage impossible (${(e as NodeJS.ErrnoException).code ?? 'erreur'})`));
  srv.maxConnections = 60;
  srv.listen(port);
  return srv;
}

// ---------------------------------------------------------------- Le moteur
export interface DepsPartage { reseau: () => Fetch; resoudre: Resoudre; essai: () => boolean; amorcesDht?: () => string[]; patience?: number }
const ESSAI: { amorces?: string[]; patience?: number } = {};
/** (essais seulement) les amorces du DHT et la patience (ms) — jamais réglé hors des essais. */
export function reglerEssaiPartage(o: { amorces?: string[]; patience?: number } = {}): void { ESSAI.amorces = o.amorces; ESSAI.patience = o.patience; }

const souche = (nom: string) => nom.slice(0, nom.length - extname(nom).length);
const travailDe = (dossier: string, nom: string) => join(dossier, `${souche(nom)}.partage`);
const deplacer = (de: string, vers: string) => { try { renameSync(de, vers); } catch { copyFileSync(de, vers); rmSync(de, { force: true }); } };
/** Lit une réponse sans dépasser `max` octets. */
async function lireBorne(r: Response, max: number): Promise<Buffer> {
  const l = r.body?.getReader(); if (!l) return Buffer.alloc(0);
  const m: Buffer[] = []; let n = 0;
  for (;;) { const { done, value } = await l.read(); if (done) break; n += value.length; if (n > max) { await l.cancel().catch(() => undefined); throw new Error('fichier .torrent trop gros'); } m.push(Buffer.from(value)); }
  return Buffer.concat(m);
}
const pairDe = (x: string): Pair | undefined => { const m = /^\[?([0-9a-f:.]+)\]?:(\d{1,5})$/i.exec(x); return m ? { ip: m[1], port: Number(m[2]) } : undefined; };

export interface OptionsMoteur { nom: string; dossier: string; signal: AbortSignal; progression: (fait: number, total?: number) => void; tailleMax: number; debitMo?: number; place?: (taille: number) => void; cible?: { saison?: number; episode?: number } }

/** Le moteur de partage, prêt à s'inscrire dans Comète. */
export function moteurPartage(deps: DepsPartage) {
  return {
    id: 'partage' as const, nom: 'partage de fichiers (Odin)',
    sait: (r: { genre: string; lien: string }) => r.genre === 'partage' && (/^magnet:\?/i.test(r.lien) || /^https?:\/\//i.test(r.lien)),
    async telecharger(ctx: ModCtx, lien: string, o: OptionsMoteur): Promise<{ chemin: string; taille: number }> {
      const mag = magasinVenus(ctx.home, ctx.dir), r = reglagesPartage(mag), essai = deps.essai();
      const travail = travailDe(o.dossier, o.nom); mkdirSync(travail, { recursive: true, mode: 0o700 });
      let empreinte: Buffer, partage: Partage | undefined, trackers: string[] = [], pairs: Pair[] = [];
      const infoGardee = join(travail, 'info.bin');
      if (/^magnet:/i.test(lien)) {
        const m = lireMagnet(lien); empreinte = m.empreinte; trackers = m.trackers; pairs = m.pairs.map(pairDe).filter((p): p is Pair => !!p);
      } else {
        const gardee = join(travail, 'partage.torrent');
        let brut: Buffer;
        if (existsSync(gardee)) brut = readFileSync(gardee);
        else {
          const rep = await deps.reseau()(lien, { redirect: 'manual', signal: AbortSignal.any([o.signal, AbortSignal.timeout(30_000)]), headers: { accept: 'application/x-bittorrent' } });
          if (rep.status !== 200) { await rep.body?.cancel().catch(() => undefined); throw new Error(`le fichier .torrent ne vient pas (réponse ${rep.status})`); }
          brut = await lireBorne(rep, 8 * 1024 * 1024);
        }
        partage = lireTorrent(brut); empreinte = partage.empreinte; trackers = partage.trackers;
        if (!existsSync(gardee)) writeFileSync(gardee, brut, { mode: 0o600 });
      }
      if (!partage && existsSync(infoGardee)) {
        const b = readFileSync(infoGardee);
        if (createHash('sha1').update(b).digest().equals(empreinte)) partage = lireInfo(b, empreinte, trackers);
      }
      const amorces = essai ? (ESSAI.amorces ?? []) : (deps.amorcesDht?.() ?? AMORCES_DHT);
      const s = new Session({
        empreinte, ...(partage ? { partage } : {}), trackers, pairs, dossier: travail, ...(o.cible ? { voulu: o.cible } : {}),
        signal: o.signal, progression: o.progression, tailleMax: o.tailleMax, ...(o.place ? { place: o.place } : {}), ...(o.debitMo ? { debitMo: o.debitMo } : {}),
        envoi: { pendant: r.envoiPendant, debitKo: r.envoiKo, ratio: r.ratio, dureeMin: r.dureeMin },
        reseau: deps.reseau(), resoudre: deps.resoudre, essai, maxPairs: r.maxPairs, port: r.ecoute ? r.portEcoute : 6881,
        ...(r.dht && amorces.length ? { dht: (e: Buffer, sur: (p: Pair) => void, sig: AbortSignal) => chercherDht(e, sur, sig, { amorces, resoudre: deps.resoudre, essai }) } : {}),
        ...((essai ? ESSAI.patience : deps.patience) ? { patience: (essai ? ESSAI.patience : deps.patience)! } : {}),
        inscrire: (e, x) => inscrire(e, x, r.ecoute ? r.portEcoute : undefined, essai),
        surPartage: (p) => { try { writeFileSync(infoGardee, p.info, { mode: 0o600 }); } catch { /* gardé la prochaine fois */ } },
      });
      const res = await s.lancer();
      const final = join(o.dossier, `${souche(o.nom)}${extname(res.chemin)}`);
      deplacer(res.chemin, final);
      rmSync(travail, { recursive: true, force: true });
      return { chemin: final, taille: res.taille };
    },
    nettoyer(dossier: string, nom: string): void {
      rmSync(travailDe(dossier, nom), { recursive: true, force: true });
      for (const e of ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.ts', '.wmv', '.flv', '.bin']) rmSync(join(dossier, `${souche(nom)}${e}`), { force: true });
    },
  };
}
