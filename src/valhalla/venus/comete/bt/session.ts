// Comète · partage de fichiers : un téléchargement. Trouve des pairs (trackers, DHT, pairs donnés par le lien),
// récupère la description du partage si on n'a qu'un lien magnet (BEP 9, vérifiée par son empreinte), puis demande
// les morceaux de la vidéo choisie à plusieurs pairs, vérifie CHAQUE morceau (SHA-1) avant de l'écrire, rejette un
// pair qui envoie un morceau faux (le morceau est redemandé ailleurs), et garde l'état pour la reprise.
//
// Bornes : pairs connectés (réglage, 50 au plus), pairs connus (2 000), morceaux en mémoire (64 Mo), demandes en vol
// par pair (16), demandes reçues par pair (64), description du partage (8 Mo). Connexions SORTANTES seulement (une
// écoute entrante n'existe que si le propriétaire l'a réglée, et elle passe par `accueillir`).
// Envoi aux autres pairs : seulement pendant le téléchargement, limité (débit, ratio, durée), coupé à la fin.
import { createHash, randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import type { Socket } from 'node:net';
import { extname } from 'node:path';
import { entier, lire } from './bencode.ts';
import { adressePermise, portValide, type Resoudre } from './garde.ts';
import { choisirFichier, lireInfo, morceauSur, tailleDe, type Partage } from './metainfo.ts';
import { aMorceau, BLOC, connecter, Connexion, ecrireMessage, ID_EXT_METADONNEES, lirePoigneeEtendue, poigneeEtendue, poserBit, type Message } from './pair.ts';
import { Stockage } from './stockage.ts';
import { annonceHttp, annonceUdp, type Fetch, type Pair } from './tracker.ts';

export interface ReglagesEnvoi { /** envoyer aux autres pendant le téléchargement */ pendant: boolean; /** Ko/s */ debitKo: number; /** s'arrêter quand on a envoyé ratio × la taille */ ratio: number; /** minutes au plus */ dureeMin: number }
export interface OptionsSession {
  empreinte: Buffer; partage?: Partage; trackers: string[]; pairs: Pair[];
  dossier: string; voulu?: { saison?: number; episode?: number };
  signal: AbortSignal; progression: (fait: number, total?: number) => void; tailleMax: number; place?: (n: number) => void;
  debitMo?: number; envoi: ReglagesEnvoi;
  reseau: Fetch; resoudre: Resoudre; essai: boolean;
  /** cherche des pairs dans le DHT (rien si absent ou partage privé) */ dht?: (empreinte: Buffer, surPair: (p: Pair) => void, signal: AbortSignal) => void;
  maxPairs: number; port: number;
  /** temps sans aucun pair avant d'abandonner (ms) */ patience?: number;
  /** pour que l'écoute entrante (réglage du propriétaire) trouve ce téléchargement */ inscrire?: (empreinte: Buffer, s: Session) => () => void;
  journal?: (t: string) => void;
  /** la description vient d'être reçue et vérifiée (pour la garder : reprise sans la redemander) */ surPartage?: (p: Partage) => void;
}
export interface Resultat { chemin: string; taille: number; partage: Partage; envoye: number; recu: number; bannis: string[] }

const MAX_CONNUS = 2000, MAX_META = 8 * 1024 * 1024, MEMOIRE = 64 * 1024 * 1024, EN_VOL = 16, MAX_DEMANDES_RECUES = 64;
interface EnCours { index: number; buf: Buffer; recus: number; aDemander: number[]; demandes: Set<number> }
interface Lui {
  c: Connexion; cle: string; champ: Buffer; etouffeNous: boolean; nousInteresse: boolean; onEtouffe: boolean; interesse: boolean;
  pieces: Map<number, EnCours>; enVol: number; dernierRecu: number; demandes: Array<{ index: number; debut: number; longueur: number }>;
  ext: Record<string, number>; tailleMeta?: number; meta?: { parts: Buffer[]; recues: number; depuis: number; taille: number }; metaServies: number;
}
const cleDe = (p: Pair) => `${p.ip.includes(':') ? `[${p.ip}]` : p.ip}:${p.port}`;
/** Un identifiant de pair : un préfixe de logiciel neutre, puis 12 octets au hasard (rien de la machine). */
export const nouvelIdPair = (): Buffer => Buffer.concat([Buffer.from('-OD0100-'), randomBytes(12)]);

export class Session {
  readonly idPair = nouvelIdPair();
  partage?: Partage; private stockage?: Stockage;
  private connus = new Map<string, { p: Pair; essaye?: number }>();
  private eux = new Set<Lui>(); private enConnexion = 0;
  /** pairs rejetés (« adresse:port ») ; une adresse rejetée 3 fois l'est entièrement */ readonly bannis = new Set<string>(); private rejetsIp = new Map<string, number>();
  private banni(p: Pair): boolean { return this.bannis.has(cleDe(p)) || (this.rejetsIp.get(p.ip) ?? 0) >= 3; }
  private rarete: Uint16Array = new Uint16Array(0);
  private assignes = new Map<number, Set<Lui>>(); private ecriture = new Set<number>(); private memoire = 0;
  recu = 0; envoye = 0; private fenetreRecu = 0; private fenetreEnvoi = 0; private fenetreDebut = Date.now();
  private debut = Date.now(); private dernierPair = Date.now(); private trackersVus = new Map<string, number>();
  private fini = false; private erreur?: Error; private resoudreFin?: () => void; 
  private ac = new AbortController();
  private o: OptionsSession;
  constructor(o: OptionsSession) { this.o = o; this.partage = o.partage; }

  private noter(t: string) { this.o.journal?.(t); }
  get envoiPermis(): boolean {
    const e = this.o.envoi, taille = this.stockage?.tailleFichier ?? 0;
    return e.pendant && !this.fini && e.debitKo > 0 && (e.ratio <= 0 || this.envoye < e.ratio * taille) && (e.dureeMin <= 0 || Date.now() - this.debut < e.dureeMin * 60_000);
  }

  async lancer(): Promise<Resultat> {
    const sig = this.o.signal; if (sig.aborted) throw new Error('arrêté');
    const stop = () => this.terminer(new Error('arrêté')); sig.addEventListener('abort', stop, { once: true });
    const desinscrire = this.o.inscrire?.(this.o.empreinte, this);
    for (const p of this.o.pairs) this.ajouterPair(p);
    // Le battement de la session (interne, aucun travail planifié) : un coup toutes les 500 ms, le suivant
    // seulement quand le précédent est fini (jamais deux à la fois), et plus rien dès la fin de la session.
    let tick: ReturnType<typeof setTimeout> | undefined, arrete = false;
    const battre = () => { tick = setTimeout(() => { void this.battement().catch((e) => this.terminer(e as Error)).finally(() => { if (!this.fini && !arrete) battre(); }); }, 500); };
    battre();
    try {
      if (this.partage) await this.preparer();
      void this.annoncer('started');
      if (this.o.dht && !this.partage?.prive) { try { this.o.dht(this.o.empreinte, (p) => this.ajouterPair(p), this.ac.signal); } catch (e) { this.noter(`DHT : ${(e as Error).message}`); } }
      this.remplir();
      if (!this.fini) await new Promise<void>((ok) => { this.resoudreFin = ok; if (this.fini) ok(); });
      if (this.erreur) throw this.erreur;
      const st = this.stockage!; const taille = st.tailleFichier;
      await st.fermer(); st.nettoyerTravail();
      return { chemin: st.chemin, taille, partage: this.partage!, envoye: this.envoye, recu: this.recu, bannis: [...this.bannis] };
    } finally {
      arrete = true; clearTimeout(tick); sig.removeEventListener('abort', stop); desinscrire?.();
      this.ac.abort(); for (const l of [...this.eux]) l.c.fermer('fin');
      if (this.erreur) await this.stockage?.fermer().catch(() => undefined);
      void this.annoncer('stopped').catch(() => undefined);
    }
  }
  private terminer(e?: Error): void {
    if (this.fini) return; this.fini = true; if (e) this.erreur = e;
    this.ac.abort(); for (const l of [...this.eux]) l.c.fermer('fin');
    this.resoudreFin?.();
  }

  // ---------------------------------------------------------------- Les pairs
  ajouterPair(p: Pair): void {
    if (this.fini || !portValide(p.port) || !adressePermise(p.ip, this.o.essai) || this.banni(p)) return;
    const k = cleDe(p); if (this.connus.has(k) || this.connus.size >= MAX_CONNUS) return;
    this.connus.set(k, { p }); this.dernierPair = Date.now();
  }
  private remplir(): void {
    if (this.fini) return;
    const now = Date.now();
    for (const [k, x] of this.connus) {
      if (this.eux.size + this.enConnexion >= this.o.maxPairs) break;
      if (this.banni(x.p) || [...this.eux].some((l) => l.cle === k)) continue;
      if (x.essaye && now - x.essaye < 120_000) continue;
      x.essaye = now; this.enConnexion++;
      connecter(x.p.ip, x.p.port, this.o.empreinte, this.idPair, this.ac.signal)
        .then(({ socket, distant, reste }) => { this.brancher(socket, x.p, distant.extension, reste); })
        .catch(() => undefined).finally(() => { this.enConnexion--; });
    }
  }
  /** Une connexion ENTRANTE déjà passée par la poignée de main (écoute réglée par le propriétaire). */
  accueillir(socket: Socket, p: Pair, extension: boolean, reste: Buffer): boolean {
    if (this.fini || this.banni(p) || !adressePermise(p.ip, this.o.essai) || this.eux.size >= this.o.maxPairs) return false;
    this.brancher(socket, p, extension, reste); return true;
  }
  private brancher(socket: Socket, p: Pair, extension: boolean, reste: Buffer): void {
    if (this.fini || this.banni(p)) { socket.destroy(); return; }
    const l = {} as Lui;
    Object.assign(l, { cle: cleDe(p), champ: Buffer.alloc(this.partage ? Math.ceil(this.partage.morceaux.length / 8) : 0), etouffeNous: true, nousInteresse: false, onEtouffe: true, interesse: false, pieces: new Map(), enVol: 0, dernierRecu: Date.now(), demandes: [], ext: {}, metaServies: 0 });
    l.c = new Connexion(socket, p.ip, p.port, (m) => this.message(l, m), () => this.perdu(l));
    this.eux.add(l); this.dernierPair = Date.now();
    if (this.stockage && this.o.envoi.pendant && this.stockage.octetsFaits > 0) l.c.envoyer(ecrireMessage.bitfield(this.stockage.champ()));
    if (extension) l.c.envoyer(poigneeEtendue(this.partage?.info.length));
    if (reste.length) l.c.recevoir(reste);
  }
  private perdu(l: Lui): void {
    if (!this.eux.delete(l)) return;
    for (const e of l.pieces.values()) this.liberer(l, e);
    if (this.partage) for (let i = 0; i < this.rarete.length; i++) if (aMorceau(l.champ, i) && this.rarete[i] > 0) this.rarete[i]--;
    if (!this.fini) setImmediate(() => this.remplir());
  }
  private bannir(l: Lui, pourquoi: string): void { this.bannis.add(l.cle); this.rejetsIp.set(l.c.ip, (this.rejetsIp.get(l.c.ip) ?? 0) + 1); this.noter(`pair ${l.cle} rejeté : ${pourquoi}`); l.c.fermer(pourquoi); }

  private message(l: Lui, m: Message): void {
    switch (m.t) {
      case 'keepalive': case 'inconnu': case 'port': return;
      case 'choke': l.etouffeNous = true; for (const e of [...l.pieces.values()]) { if (e.recus === 0) this.liberer(l, e); else { e.aDemander = [...new Set([...e.aDemander, ...e.demandes])].sort((a, b) => a - b); e.demandes.clear(); } } l.enVol = 0; return;
      case 'unchoke': l.etouffeNous = false; this.demander(l); return;
      case 'interested': l.interesse = true; this.choisirEnvois(); return;
      case 'notinterested': l.interesse = false; return;
      case 'have': {
        if (this.partage) { if (m.index >= this.partage.morceaux.length) throw new Error('morceau inconnu'); if (!aMorceau(l.champ, m.index)) { poserBit(l.champ, m.index); this.rarete[m.index]++; } }
        else { if (m.index >= 1_000_000) throw new Error('morceau inconnu'); if (l.champ.length <= m.index >> 3) l.champ = Buffer.concat([l.champ, Buffer.alloc((m.index >> 3) + 1 - l.champ.length)]); poserBit(l.champ, m.index); }
        this.interet(l); this.demander(l); return;
      }
      case 'bitfield': {
        if (m.champ.length > 125_000) throw new Error('champ trop long');
        if (this.partage) { if (m.champ.length !== Math.ceil(this.partage.morceaux.length / 8)) throw new Error('champ de bits de mauvaise taille'); for (let i = 0; i < this.rarete.length; i++) if (aMorceau(l.champ, i) && this.rarete[i] > 0) this.rarete[i]--; l.champ = m.champ; for (let i = 0; i < this.rarete.length; i++) if (aMorceau(m.champ, i)) this.rarete[i]++; }
        else l.champ = m.champ;
        this.interet(l); this.demander(l); return;
      }
      case 'request': {
        if (l.onEtouffe || !this.envoiPermis || !this.stockage) return;
        if (m.longueur === 0 || m.longueur > 2 * BLOC || !this.stockage.aLe(m.index) || m.debut + m.longueur > tailleDe(this.partage!, m.index)) return;
        if (l.demandes.length >= MAX_DEMANDES_RECUES) return;
        l.demandes.push({ index: m.index, debut: m.debut, longueur: m.longueur }); void this.servir(); return;
      }
      case 'cancel': l.demandes = l.demandes.filter((d) => !(d.index === m.index && d.debut === m.debut && d.longueur === m.longueur)); return;
      case 'piece': this.bloc(l, m.index, m.debut, m.bloc); return;
      case 'ext': this.etendu(l, m.id, m.dico, m.suite); return;
    }
  }

  // ---------------------------------------------------------------- La description du partage (lien magnet, BEP 9)
  private etendu(l: Lui, id: number, d: Record<string, unknown>, suite: Buffer): void {
    if (id === 0) {
      const h = lirePoigneeEtendue(d as never); l.ext = h.ext; if (h.tailleMeta && !l.meta) l.tailleMeta = h.tailleMeta; // (une taille changée pendant la réception est ignorée)
      this.chercherMeta(); return;
    }
    if (id !== ID_EXT_METADONNEES) return;
    const type = entier((d as never)['msg_type']), k = entier((d as never)['piece']);
    if (type === undefined || k === undefined || k < 0) return;
    if (type === 0) { // un pair nous demande la description : seulement si on envoie, et seulement si on l'a
      const idLui = l.ext.ut_metadata; if (!idLui) return;
      // Comptée dans l'envoi (débit, ratio, durée) ; deux fois la description au plus par pair ; rien si sa file d'envoi déborde.
      const info = this.partage?.info; this.fenetre();
      if (!info || !this.envoiPermis || k * BLOC >= info.length || l.metaServies >= 2 * Math.ceil(info.length / BLOC) || l.c.enAttente >= 256 * 1024 || this.fenetreEnvoi >= this.o.envoi.debitKo * 1000) { l.c.envoyer(ecrireMessage.ext(idLui, { msg_type: 2, piece: k })); return; }
      const part = info.subarray(k * BLOC, (k + 1) * BLOC); l.metaServies++; this.envoye += part.length; this.fenetreEnvoi += part.length;
      l.c.envoyer(ecrireMessage.ext(idLui, { msg_type: 1, piece: k, total_size: info.length }, part)); return;
    }
    if (!l.meta || this.partage) return;
    if (type === 2) { l.meta = undefined; this.noter(`pair ${l.c.ip} : description refusée`); this.chercherMeta(); return; }
    if (type !== 1) return;
    const t = l.meta.taille, n = Math.ceil(t / BLOC);
    if (k >= n || l.meta.parts[k] || suite.length !== (k === n - 1 ? t - BLOC * (n - 1) : BLOC)) { this.bannir(l, 'description du partage invalide'); this.chercherMeta(); return; }
    l.meta.parts[k] = Buffer.from(suite); l.meta.recues++; l.dernierRecu = Date.now();
    if (l.meta.recues < n) return;
    const info = Buffer.concat(l.meta.parts); l.meta = undefined;
    if (!createHash('sha1').update(info).digest().equals(this.o.empreinte)) { this.bannir(l, 'description du partage fausse (empreinte)'); this.chercherMeta(); return; }
    try { lire(info); this.partage = lireInfo(info, this.o.empreinte, this.o.trackers); }
    catch (e) { this.terminer(e as Error); return; }
    this.noter('description du partage reçue et vérifiée');
    try { this.o.surPartage?.(this.partage); } catch { /* garder la description est un plus, pas une condition */ }
    void this.preparer().catch((e) => this.terminer(e as Error));
  }
  private chercherMeta(): void {
    if (this.partage || this.fini) return;
    if ([...this.eux].some((x) => x.meta)) return;
    const l = [...this.eux].find((x) => x.ext.ut_metadata && x.tailleMeta && x.tailleMeta <= MAX_META);
    if (!l) return;
    const n = Math.ceil(l.tailleMeta! / BLOC);
    l.meta = { parts: new Array(n), recues: 0, depuis: Date.now(), taille: l.tailleMeta! };
    for (let k = 0; k < n; k++) l.c.envoyer(ecrireMessage.ext(l.ext.ut_metadata, { msg_type: 0, piece: k }));
  }

  // ---------------------------------------------------------------- Les morceaux
  private async preparer(): Promise<void> {
    const p = this.partage!;
    const k = choisirFichier(p, this.o.voulu), f = p.fichiers[k];
    if (f.taille > this.o.tailleMax) throw new Error(`vidéo trop grosse (${Math.round(f.taille / 1e6)} Mo) pour la taille maximale réglée`);
    const nom = `video${extname(morceauSur(f.chemin[f.chemin.length - 1])).toLowerCase()}`;
    const st = new Stockage(p, k, this.o.dossier, nom);
    const deja = (() => { try { return statSync(st.chemin).size; } catch { return 0; } })();
    this.o.place?.(Math.max(0, f.taille - deja));
    await st.ouvrir();
    const gardes = await st.reprendre();
    if (gardes) this.noter(`reprise : ${gardes} morceau(x) déjà vérifié(s) gardé(s)`);
    this.stockage = st; this.rarete = new Uint16Array(p.morceaux.length);
    this.o.progression(st.octetsFaits, f.taille);
    for (const l of [...this.eux]) {
      const n8 = Math.ceil(p.morceaux.length / 8);
      if (l.champ.length > n8 && l.champ.subarray(n8).some((x) => x !== 0)) { l.c.fermer('champ de bits de mauvaise taille'); continue; }
      l.champ = Buffer.concat([l.champ.subarray(0, n8), Buffer.alloc(Math.max(0, n8 - l.champ.length))]);
      for (let i = 0; i < p.morceaux.length; i++) if (aMorceau(l.champ, i)) this.rarete[i]++;
      this.interet(l); this.demander(l);
    }
    if (st.fini) this.terminer();
  }
  private interet(l: Lui): void {
    const st = this.stockage; if (!st) return;
    let veut = false; for (let i = st.premier; i <= st.dernier && !veut; i++) if (!st.aLe(i) && aMorceau(l.champ, i)) veut = true;
    if (veut && !l.nousInteresse) { l.nousInteresse = true; l.c.envoyer(ecrireMessage.interested()); }
    else if (!veut && l.nousInteresse) { l.nousInteresse = false; l.c.envoyer(ecrireMessage.notinterested()); }
  }
  private get debitAtteint(): boolean { const d = (this.o.debitMo ?? 0) * 1e6; if (!d) return false; this.fenetre(); return this.fenetreRecu >= d * ((Date.now() - this.fenetreDebut) / 1000 + 0.25); }
  private fenetre(): void { if (Date.now() - this.fenetreDebut >= 1000) { this.fenetreDebut = Date.now(); this.fenetreRecu = 0; this.fenetreEnvoi = 0; } }
  private choisirMorceau(l: Lui): number | undefined {
    const st = this.stockage!, tm = this.partage!.tailleMorceau;
    let best: number | undefined, rare = Infinity;
    const memoireOk = this.memoire + tm <= MEMOIRE || this.memoire === 0;
    if (memoireOk) for (let i = st.premier; i <= st.dernier; i++) {
      if (st.aLe(i) || this.ecriture.has(i) || this.assignes.has(i) || !aMorceau(l.champ, i)) continue;
      if (this.rarete[i] < rare) { rare = this.rarete[i]; best = i; }
    }
    if (best !== undefined) return best;
    // Fin du téléchargement : un morceau déjà demandé à un autre peut l'être aussi à celui-ci (le premier juste gagne).
    if (!memoireOk || st.nbRestants > 8) return undefined;
    for (const [i, s] of this.assignes) if (s.size < 2 && !s.has(l) && !st.aLe(i) && !this.ecriture.has(i) && aMorceau(l.champ, i)) return i;
    return undefined;
  }
  private demander(l: Lui): void {
    const st = this.stockage; if (!st || this.fini || l.etouffeNous || !l.c.ouverte) return;
    const p = this.partage!, parPiece = Math.ceil(p.tailleMorceau / BLOC), maxPieces = Math.min(4, Math.max(1, Math.ceil(EN_VOL / parPiece)));
    while (l.enVol < EN_VOL && !this.debitAtteint) {
      let e = [...l.pieces.values()].find((x) => x.aDemander.length);
      if (!e) {
        if (l.pieces.size >= maxPieces) break;
        const i = this.choisirMorceau(l); if (i === undefined) break;
        const t = tailleDe(p, i), blocs: number[] = []; for (let d = 0; d < t; d += BLOC) blocs.push(d);
        e = { index: i, buf: Buffer.alloc(t), recus: 0, aDemander: blocs, demandes: new Set() };
        l.pieces.set(i, e); this.memoire += t;
        let s = this.assignes.get(i); if (!s) this.assignes.set(i, s = new Set()); s.add(l);
      }
      const d = e.aDemander.shift()!, lg = Math.min(BLOC, e.buf.length - d);
      e.demandes.add(d); l.enVol++; l.c.envoyer(ecrireMessage.request(e.index, d, lg));
    }
  }
  private liberer(l: Lui, e: EnCours): void {
    if (!l.pieces.delete(e.index)) return;
    this.memoire -= e.buf.length; l.enVol = Math.max(0, l.enVol - e.demandes.size);
    const s = this.assignes.get(e.index); s?.delete(l); if (s && !s.size) this.assignes.delete(e.index);
  }
  private bloc(l: Lui, index: number, debut: number, b: Buffer): void {
    const e = l.pieces.get(index);
    if (!e || !e.demandes.has(debut) || b.length !== Math.min(BLOC, e.buf.length - debut)) return; // non demandé : ignoré (rien n'est écrit)
    e.demandes.delete(debut); l.enVol = Math.max(0, l.enVol - 1); b.copy(e.buf, debut); e.recus += b.length; l.dernierRecu = Date.now();
    this.recu += b.length; this.fenetre(); this.fenetreRecu += b.length;
    if (e.recus >= e.buf.length) void this.verifier(l, e).catch((err) => this.terminer(err as Error));
    this.demander(l);
  }
  private async verifier(l: Lui, e: EnCours): Promise<void> {
    const st = this.stockage!, i = e.index;
    this.liberer(l, e);
    if (!createHash('sha1').update(e.buf).digest().equals(this.partage!.morceaux[i])) { this.bannir(l, `morceau ${i} faux (empreinte)`); for (const x of this.eux) this.demander(x); return; }
    if (st.aLe(i) || this.ecriture.has(i)) { this.demander(l); return; }
    this.ecriture.add(i);
    for (const x of [...(this.assignes.get(i) ?? [])]) { const y = x.pieces.get(i); if (y) { for (const d of y.demandes) x.c.envoyer(ecrireMessage.cancel(i, d, Math.min(BLOC, y.buf.length - d))); this.liberer(x, y); } }
    try { await st.ecrire(i, e.buf); } finally { this.ecriture.delete(i); }
    if (this.o.envoi.pendant) for (const x of this.eux) x.c.envoyer(ecrireMessage.have(i));
    for (const x of this.eux) { this.interet(x); this.demander(x); }
    this.o.progression(st.octetsFaits, st.tailleFichier);
    if (st.fini) this.terminer();
  }

  // ---------------------------------------------------------------- L'envoi aux autres (limité)
  private choisirEnvois(): void {
    const permis = this.envoiPermis; let n = 0;
    for (const l of this.eux) {
      const garder = permis && l.interesse && n < 4;
      if (garder) n++;
      if (garder && l.onEtouffe) { l.onEtouffe = false; l.c.envoyer(ecrireMessage.unchoke()); }
      else if (!garder && !l.onEtouffe) { l.onEtouffe = true; l.demandes = []; l.c.envoyer(ecrireMessage.choke()); }
    }
  }
  private servant = false;
  private async servir(): Promise<void> {
    if (this.servant || !this.stockage) return; this.servant = true;
    try {
      for (let tour = 0; tour < 64; tour++) {
        if (!this.envoiPermis) { this.choisirEnvois(); return; }
        this.fenetre(); if (this.fenetreEnvoi >= this.o.envoi.debitKo * 1000) return;
        const l = [...this.eux].find((x) => !x.onEtouffe && x.demandes.length && x.c.enAttente < 256 * 1024); if (!l) return;
        const d = l.demandes.shift()!;
        // Seulement le bloc demandé (16 ko), lu sur le disque : le morceau a été vérifié à son écriture et à la reprise
        // (relire et revérifier le morceau entier à chaque bloc laissait un pair faire lire 32 Mo par 16 ko envoyés).
        const bloc = await this.stockage.lireBloc(d.index, d.debut, d.longueur).catch(() => undefined); if (!bloc) return;
        l.c.envoyer(ecrireMessage.piece(d.index, d.debut, bloc)); this.envoye += bloc.length; this.fenetreEnvoi += bloc.length;
      }
    } finally { this.servant = false; }
  }

  // ---------------------------------------------------------------- Trackers, battement
  private async annoncer(evenement?: 'started' | 'stopped'): Promise<void> {
    const reste = this.stockage ? this.stockage.tailleFichier - this.stockage.octetsFaits : (this.partage?.total ?? 1);
    const a = { empreinte: this.o.empreinte, idPair: this.idPair, port: this.o.port, envoye: this.envoye, recu: this.recu, reste, ...(evenement ? { evenement } : {}) };
    await Promise.all([...new Set([...this.o.trackers, ...(this.partage?.trackers ?? [])])].slice(0, 20).map(async (t) => {
      if (evenement !== 'stopped') { const x = this.trackersVus.get(t); if (x && Date.now() < x) return; this.trackersVus.set(t, Date.now() + 60_000); }
      try {
        const r = t.startsWith('udp:') ? await annonceUdp(t, a, { resoudre: this.o.resoudre, essai: this.o.essai, signal: evenement === 'stopped' ? AbortSignal.timeout(3000) : this.ac.signal }) : await annonceHttp(this.o.reseau, t, a, this.o.essai);
        if (evenement === 'stopped') return;
        this.trackersVus.set(t, Date.now() + r.intervalle * 1000);
        for (const p of r.pairs) this.ajouterPair(p);
        this.remplir();
      } catch (e) { if (evenement !== 'stopped') { this.trackersVus.set(t, Date.now() + 120_000); this.noter(`tracker : ${(e as Error).message.slice(0, 120)}`); } }
    }));
  }
  private async battement(): Promise<void> {
    if (this.fini) return;
    const now = Date.now();
    for (const l of [...this.eux]) {
      if (l.enVol > 0 && now - l.dernierRecu > 30_000) l.c.fermer('trop lent');
      if (l.meta && now - l.meta.depuis > 30_000) { l.meta = undefined; l.c.fermer('description trop lente'); }
    }
    this.chercherMeta();
    if (this.stockage) this.o.progression(this.stockage.octetsFaits, this.stockage.tailleFichier);
    this.choisirEnvois(); void this.servir();
    for (const l of this.eux) this.demander(l);
    this.remplir();
    void this.annoncer();
    if (!this.eux.size && !this.enConnexion && now - this.dernierPair > (this.o.patience ?? 600_000)) this.terminer(new Error(this.partage ? 'plus aucun pair ne partage ce fichier : réessaie plus tard (ce qui est vérifié est gardé)' : 'aucun pair trouvé pour ce lien'));
    if (this.eux.size) this.dernierPair = now;
  }
}
