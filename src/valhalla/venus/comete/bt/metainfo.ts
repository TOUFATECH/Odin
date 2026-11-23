// Comète · partage de fichiers : ce que décrit un partage (fichier .torrent ou lien magnet). Version 1 du format ;
// un partage « hybride » (v1 + v2) est lu par sa partie v1 ; un partage v2 seul est refusé proprement.
// Les chemins des fichiers d'un partage sont des DONNÉES venues d'inconnus : chaque morceau est vérifié (aucun « .. »,
// aucun chemin absolu, aucun nom réservé de Windows, aucun caractère de contrôle, longueur bornée) et tout reste sous
// le dossier de travail de Comète.
import { createHash } from 'node:crypto';
import { dico, entier, lire, liste, octets, texte, type Valeur } from './bencode.ts';

export interface FichierPartage { chemin: string[]; taille: number; debut: number; rembourrage?: boolean }
export interface Partage {
  empreinte: Buffer; nom: string; tailleMorceau: number; morceaux: Buffer[]; fichiers: FichierPartage[]; total: number;
  trackers: string[]; prive: boolean; /** les octets exacts du dictionnaire info (pour le servir aux autres pairs) */ info: Buffer;
}
export interface Magnet { empreinte: Buffer; nom?: string; trackers: string[]; pairs: string[] }

export const MAX_FICHIERS = 10_000;
export const MAX_MORCEAUX = 1_000_000;
/** un morceau de plus de 32 Mo : refusé (la mémoire des morceaux en cours est bornée par là) */
export const MAX_TAILLE_MORCEAU = 32 * 1024 * 1024;
export const MAX_TRACKERS = 50;

const RESERVES = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;
/** Un morceau de chemin venu d'un partage, vérifié. Lève une erreur s'il est piégé. Pur. */
export function morceauSur(brut: string): string {
  const x = brut.normalize('NFC');
  if (!x || x === '.' || x === '..') throw new Error(`chemin piégé dans le partage (« ${x.slice(0, 40)} »)`);
  if (/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/.test(x)) throw new Error('chemin piégé dans le partage (caractère interdit)');
  if (/^\s/.test(x)) throw new Error('chemin piégé dans le partage (espace en tête)');
  if (/[.\s]$/.test(x)) throw new Error('chemin piégé dans le partage (point ou espace final)');
  if (RESERVES.test(x.split('.')[0] ?? '') || RESERVES.test(x)) throw new Error(`chemin piégé dans le partage (nom réservé « ${x.slice(0, 20)} »)`);
  if (Buffer.byteLength(x) > 200) throw new Error('chemin piégé dans le partage (nom trop long)');
  return x;
}
/** Un chemin complet (liste de morceaux), vérifié : 1 à 16 niveaux, 1 000 caractères au plus. Pur. */
export function cheminSur(morceaux: string[]): string[] {
  if (!morceaux.length || morceaux.length > 16) throw new Error('chemin piégé dans le partage (profondeur)');
  const l = morceaux.map(morceauSur);
  if (l.join('/').length > 1000) throw new Error('chemin piégé dans le partage (trop long)');
  return l;
}

const MSG_V2 = "partage de la version 2 seule : pas encore pris par Comète (seuls les partages v1 ou hybrides le sont)";

/** Lit le dictionnaire « info » (déjà vérifié par son empreinte) et le reste du .torrent. Pur. */
export function lireInfo(infoBrut: Buffer, empreinte: Buffer, trackers: string[] = []): Partage {
  const info = dico(lire(infoBrut).valeur); if (!info) throw new Error('partage illisible (info)');
  const tailleMorceau = entier(info['piece length']);
  const pieces = octets(info.pieces);
  if (!pieces) { if (dico(info['file tree']) || entier(info['meta version']) === 2) throw new Error(MSG_V2); throw new Error('partage illisible (pas de liste des morceaux)'); }
  if (!tailleMorceau || tailleMorceau < 1024 || tailleMorceau > MAX_TAILLE_MORCEAU) throw new Error('partage illisible (taille des morceaux)');
  if (pieces.length % 20 !== 0 || pieces.length / 20 > MAX_MORCEAUX) throw new Error('partage illisible (liste des morceaux)');
  const nomBrut = texte(info['name.utf-8']) ?? texte(info.name);
  if (!nomBrut) throw new Error('partage sans nom');
  const nom = morceauSur(nomBrut);
  const fichiers: FichierPartage[] = []; let total = 0;
  const l = liste(info.files);
  if (l) {
    if (!l.length || l.length > MAX_FICHIERS) throw new Error(`partage avec trop de fichiers (${l.length})`);
    const vus = new Set<string>();
    for (const e of l) {
      const f = dico(e), t = entier(f?.length), p = liste(f?.['path.utf-8']) ?? liste(f?.path);
      if (!f || t === undefined || t < 0 || !p) throw new Error('partage illisible (fichier)');
      const attr = texte(f.attr) ?? '';
      const morceaux = p.map((x: Valeur) => { const s = texte(x); if (s === undefined) throw new Error('partage illisible (chemin)'); return s; });
      const chemin = cheminSur([nom, ...morceaux]), cle = chemin.join('/').toLowerCase();
      if (!attr.includes('p')) { if (vus.has(cle)) throw new Error('partage avec deux fichiers du même nom'); vus.add(cle); }
      fichiers.push({ chemin, taille: t, debut: total, ...(attr.includes('p') ? { rembourrage: true } : {}) }); total += t;
    }
  } else {
    const t = entier(info.length); if (t === undefined || t < 0) throw new Error('partage illisible (taille)');
    fichiers.push({ chemin: [nom], taille: t, debut: 0 }); total = t;
  }
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('partage vide');
  const n = Math.ceil(total / tailleMorceau);
  if (n !== pieces.length / 20) throw new Error('partage illisible (le nombre de morceaux ne correspond pas à la taille)');
  const morceaux: Buffer[] = []; for (let k = 0; k < n; k++) morceaux.push(pieces.subarray(k * 20, k * 20 + 20));
  return { empreinte, nom, tailleMorceau, morceaux, fichiers, total, trackers: trackers.slice(0, MAX_TRACKERS), prive: entier(info.private) === 1, info: infoBrut };
}

/** Lit un fichier .torrent (8 Mo au plus). Pur. */
export function lireTorrent(b: Buffer): Partage {
  const r = lire(b, { taille: 8 * 1024 * 1024 });
  const d = dico(r.valeur); if (!d || !r.info) throw new Error('fichier .torrent illisible');
  const infoBrut = b.subarray(r.info[0], r.info[1]);
  const empreinte = createHash('sha1').update(infoBrut).digest();
  const trackers: string[] = [];
  const t0 = texte(d.announce); if (t0) trackers.push(t0);
  for (const niveau of liste(d['announce-list']) ?? []) for (const x of liste(niveau) ?? []) { const t = texte(x); if (t) trackers.push(t); }
  return lireInfo(Buffer.from(infoBrut), empreinte, [...new Set(trackers.filter(trackerValide))]);
}

/** Une adresse de tracker acceptable dans sa forme (http, https, udp). Pur. */
export const trackerValide = (t: string): boolean => { try { const u = new URL(t); return /^(https?|udp):$/.test(u.protocol) && !!u.hostname && t.length <= 500 && !u.username && !u.password; } catch { return false; } };

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(t: string): Buffer | undefined {
  let bits = 0, v = 0; const out: number[] = [];
  for (const c of t.toUpperCase()) { const k = B32.indexOf(c); if (k < 0) return undefined; v = (v << 5) | k; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
/** Lit un lien magnet (empreinte v1 obligatoire). Pur. */
export function lireMagnet(lien: string): Magnet {
  if (lien.length > 8000) throw new Error('lien magnet trop long');
  if (!/^magnet:\?/i.test(lien)) throw new Error("ce n'est pas un lien magnet");
  const q = new URLSearchParams(lien.slice(lien.indexOf('?') + 1));
  let empreinte: Buffer | undefined, v2 = false;
  for (const xt of q.getAll('xt')) {
    const m = /^urn:btih:([0-9a-f]{40}|[a-z2-7]{32})$/i.exec(xt);
    if (m) empreinte = m[1].length === 40 ? Buffer.from(m[1], 'hex') : base32(m[1]);
    else if (/^urn:btmh:/i.test(xt)) v2 = true;
  }
  if (!empreinte || empreinte.length !== 20) throw new Error(v2 ? MSG_V2 : 'lien magnet sans empreinte lisible');
  if (empreinte.every((x) => x === 0)) throw new Error('lien magnet invalide (empreinte nulle)');
  const nom = q.get('dn')?.replace(/[\u0000-\u001f]/g, ' ').slice(0, 300) || undefined;
  const trackers = [...new Set(q.getAll('tr').filter(trackerValide))].slice(0, MAX_TRACKERS);
  const pairs = q.getAll('x.pe').filter((p) => /^[\w.\-[\]:]{3,80}$/.test(p)).slice(0, 50);
  return { empreinte, ...(nom ? { nom } : {}), trackers, pairs };
}

/** Un lien de partage valable dans sa forme (magnet lisible ou lien http(s) vers un .torrent). Pur. */
export function lienPartageValide(lien: string): boolean {
  if (/^magnet:/i.test(lien)) { try { lireMagnet(lien); return true; } catch { return false; } }
  try { const u = new URL(lien); return /^https?:$/.test(u.protocol) && !u.username && !u.password; } catch { return false; }
}

// ---------------------------------------------------------------- Le choix du fichier voulu (la vidéo seulement)
const EXT_VIDEO = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.ts', '.wmv', '.flv']);
const ext = (n: string) => { const k = n.lastIndexOf('.'); return k > 0 ? n.slice(k).toLowerCase() : ''; };
/** Le fichier à prendre : la vidéo de l'épisode voulu, sinon la plus grosse vidéo (les « sample » écartés). Pur. */
export function choisirFichier(p: Partage, voulu?: { saison?: number; episode?: number }): number {
  const videos = p.fichiers.map((f, k) => ({ f, k })).filter(({ f }) => !f.rembourrage && EXT_VIDEO.has(ext(f.chemin[f.chemin.length - 1])) && f.taille > 0 && !/(^|[\W_])sample([\W_]|$)/i.test(f.chemin[f.chemin.length - 1]));
  if (!videos.length) throw new Error("aucune vidéo dans ce partage : rien n'est téléchargé");
  let l = videos;
  if (voulu?.saison !== undefined && voulu.episode !== undefined) {
    const ep = videos.filter(({ f }) => { const m = /[Ss](\d{1,2})[\s.\-_]*[Ee](\d{1,4})/.exec(f.chemin[f.chemin.length - 1]); return m && Number(m[1]) === voulu.saison && Number(m[2]) === voulu.episode; });
    const marque = videos.some(({ f }) => /[Ss]\d{1,2}[\s.\-_]*[Ee]\d{1,4}/.test(f.chemin[f.chemin.length - 1]));
    if (ep.length) l = ep; else if (marque || videos.length > 1) throw new Error(`l'épisode S${String(voulu.saison).padStart(2, '0')}E${String(voulu.episode).padStart(2, '0')} n'est pas dans ce partage`);
  }
  return l.reduce((a, b) => (b.f.taille > a.f.taille ? b : a)).k;
}
/** Les morceaux qui touchent un fichier : [premier, dernier]. Pur. */
export function morceauxDe(p: Partage, k: number): [number, number] {
  const f = p.fichiers[k];
  return [Math.floor(f.debut / p.tailleMorceau), Math.floor((f.debut + f.taille - 1) / p.tailleMorceau)];
}
/** La taille d'un morceau (le dernier est plus court). Pur. */
export const tailleDe = (p: Partage, i: number): number => (i === p.morceaux.length - 1 ? p.total - i * p.tailleMorceau : p.tailleMorceau);
