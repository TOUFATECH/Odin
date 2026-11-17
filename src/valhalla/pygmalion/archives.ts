// Pygmalion — archiver et compresser, écrit dans Odin (node:zlib) : créer et ouvrir des .zip et des .tar.gz.
// Ouvrir une archive est la partie dangereuse ; tout est vérifié AVANT d'écrire quoi que ce soit :
//   - chaque nom d'entrée : relatif, sans « .. », sans lecteur (« C: »), sans barre inverse, sans nom réservé de Windows,
//     sans caractère de contrôle ; sinon l'archive entière est refusée ;
//   - les liens (symboliques ou durs) et les entrées spéciales d'un tar sont refusés ;
//   - deux entrées au même nom (à la casse ou aux accents près), ou un nom à la fois fichier et dossier : refusées ;
//   - nombre d'entrées, taille décompressée totale et rapport décompressé/compressé bornés (bombe de décompression) ;
//   - l'extraction se fait dans un dossier NEUF (dans le dossier de sortie), sans jamais écraser ni sortir.
import { gunzipSync, gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { unzip, zip } from '../../files/zip.ts';
import { BORNES, type FichierArchive } from './types.ts';

const RESERVE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Un nom d'entrée d'archive sûr (« dossier/fichier.txt »), ou une erreur qui dit pourquoi. */
export function nomEntreeSur(nom: string): string {
  const n = String(nom ?? '');
  if (!n || n.length > 400) throw new Error('nom d\'entrée vide ou trop long');
  if (/[\u0000-\u001f\u007f]/.test(n)) throw new Error(`nom d'entrée avec un caractère de contrôle : refusé`);
  if (n.includes('\\')) throw new Error(`barre inverse dans « ${n} » : refusé`);
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) throw new Error(`chemin absolu « ${n} » : refusé`);
  const parts = n.replace(/\/+$/, '').split('/');
  for (const p of parts) {
    if (p === '' || p === '.' || p === '..') throw new Error(`chemin « ${n} » qui sort ou tourne en rond : refusé`);
    if (RESERVE.test(p) || /[<>:"|?*]/.test(p) || /[. ]$/.test(p)) throw new Error(`nom « ${p} » impossible sous Windows : refusé`);
  }
  return parts.join('/');
}

/**
 * Les noms d'une archive, vérifiés ENSEMBLE avant toute écriture : deux entrées au même nom (comparées sans la casse et
 * après normalisation Unicode, comme le disque de Windows les verrait) ou un nom qui serait à la fois un fichier et un
 * dossier (« a » et « a/b ») font refuser l'archive entière — sinon l'une avalerait l'autre en silence ou l'extraction
 * s'arrêterait à mi-chemin. `dossiers` : les entrées de dossier explicites (« a/ »).
 */
export function verifierNoms(fichiers: string[], dossiers: string[] = []): void {
  const cle = (n: string) => n.normalize('NFC').toLowerCase();
  const vusF = new Set<string>(), vusD = new Set<string>();
  for (const d of dossiers) vusD.add(cle(d.replace(/\/+$/, '')));
  for (const f of fichiers) {
    const k = cle(f);
    if (vusF.has(k)) throw new Error(`entrée en double « ${f} » (même nom à la casse ou aux accents près) : archive refusée`);
    vusF.add(k);
    const parts = k.split('/');
    for (let i = 1; i < parts.length; i++) vusD.add(parts.slice(0, i).join('/'));
  }
  for (const k of vusF) if (vusD.has(k)) throw new Error(`« ${k} » serait à la fois un fichier et un dossier : archive refusée`);
}

/** Crée une archive .zip. */
export function creerZip(fichiers: FichierArchive[]): Buffer {
  const vus = new Set<string>();
  const entrees = fichiers.map((f) => { const nom = nomEntreeSur(f.nom); if (vus.has(nom.toLowerCase())) throw new Error(`entrée en double : ${nom}`); vus.add(nom.toLowerCase()); return { name: nom, data: f.octets }; });
  const total = entrees.reduce((s, e) => s + e.data.length, 0);
  if (entrees.length > BORNES.entrees || total > BORNES.archiveDecompressee) throw new Error('archive trop grande');
  return zip(entrees);
}

// ------------------------------------------------------------------ tar (ustar, d'après la norme publique POSIX)
const octal = (n: number, l: number) => n.toString(8).padStart(l - 1, '0') + '\0';
function entete(nom: string, taille: number, mtime: number, type: '0' | '5'): Buffer {
  const b = Buffer.alloc(512);
  let prefixe = '', court = nom;
  if (Buffer.byteLength(nom) > 100) {
    const i = nom.lastIndexOf('/', 155);
    if (i <= 0 || Buffer.byteLength(nom.slice(i + 1)) > 100 || Buffer.byteLength(nom.slice(0, i)) > 155) throw new Error(`nom trop long pour une archive tar : ${nom}`);
    prefixe = nom.slice(0, i); court = nom.slice(i + 1);
  }
  b.write(court, 0, 100, 'utf8');
  b.write(octal(type === '5' ? 0o755 : 0o644, 8), 100, 'ascii');
  b.write(octal(0, 8), 108, 'ascii'); b.write(octal(0, 8), 116, 'ascii'); // ni utilisateur ni groupe
  b.write(octal(taille, 12), 124, 'ascii');
  b.write(octal(Math.floor(mtime / 1000), 12), 136, 'ascii');
  b.write('        ', 148, 'ascii');
  b.write(type, 156, 'ascii');
  b.write('ustar\0', 257, 'ascii'); b.write('00', 263, 'ascii');
  b.write(prefixe, 345, 155, 'utf8');
  let somme = 0; for (const x of b) somme += x;
  b.write(`${somme.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return b;
}

/** Crée une archive .tar.gz (ustar, compressée gzip). */
export function creerTarGz(fichiers: FichierArchive[], mtime = 0): Buffer {
  const morceaux: Buffer[] = [];
  const vus = new Set<string>();
  let total = 0;
  for (const f of fichiers) {
    const nom = nomEntreeSur(f.nom);
    if (vus.has(nom.toLowerCase())) throw new Error(`entrée en double : ${nom}`);
    vus.add(nom.toLowerCase());
    total += f.octets.length;
    if (vus.size > BORNES.entrees || total > BORNES.archiveDecompressee) throw new Error('archive trop grande');
    morceaux.push(entete(nom, f.octets.length, mtime, '0'), f.octets, Buffer.alloc((512 - (f.octets.length % 512)) % 512));
  }
  morceaux.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(morceaux), { level: 9 });
}

/** Le contenu d'un tar (déjà décompressé), vérifié entrée par entrée. Les liens et entrées spéciales sont refusés. */
export function lireTarStrict(tar: Buffer): FichierArchive[] {
  const out: FichierArchive[] = [];
  let p = 0, total = 0, paxNom: string | undefined;
  while (p + 512 <= tar.length) {
    const h = tar.subarray(p, p + 512);
    if (h.every((x) => x === 0)) break;
    let somme = 0; for (let i = 0; i < 512; i++) somme += i >= 148 && i < 156 ? 32 : h[i];
    const declaree = parseInt(h.subarray(148, 156).toString('ascii').replace(/\0.*$/, '').trim(), 8);
    if (declaree !== somme) throw new Error('archive tar abîmée (somme de contrôle)');
    const type = String.fromCharCode(h[156] || 48);
    const taille = parseInt(h.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim() || '0', 8);
    if (!Number.isFinite(taille) || taille < 0) throw new Error('archive tar abîmée (taille)');
    const z = (b: Buffer) => { const i = b.indexOf(0); return (i < 0 ? b : b.subarray(0, i)).toString('utf8'); };
    const nomBrut = paxNom ?? ((z(h.subarray(345, 500)) ? `${z(h.subarray(345, 500))}/` : '') + z(h.subarray(0, 100)));
    paxNom = undefined;
    const corps = tar.subarray(p + 512, p + 512 + taille);
    if (corps.length < taille) throw new Error('archive tar tronquée');
    p += 512 + Math.ceil(taille / 512) * 512;
    if (type === 'x') { const m = /\d+ path=([^\n]*)\n/.exec(corps.toString('utf8')); if (m) paxNom = m[1]; continue; }
    if (type === 'g') continue;
    if (type === '5') { nomEntreeSur(nomBrut); continue; }
    if (type !== '0' && type !== '7') throw new Error(`entrée « ${nomBrut} » de type ${type === '1' ? 'lien dur' : type === '2' ? 'lien symbolique' : `spécial (${type})`} : refusée`);
    total += taille;
    if (out.length + 1 > BORNES.entrees || total > BORNES.archiveDecompressee) throw new Error('archive trop grande une fois ouverte');
    out.push({ nom: nomEntreeSur(nomBrut), octets: Buffer.from(corps) });
  }
  return out;
}

/** L'inventaire d'un zip SANS rien décompresser (répertoire central) : noms, tailles annoncées. */
export function inventaireZip(buf: Buffer): Array<{ nom: string; taille: number; compresse: number }> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('archive zip invalide');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Array<{ nom: string; taille: number; compresse: number }> = [];
  for (let k = 0; k < n; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('répertoire zip invalide');
    const compresse = buf.readUInt32LE(p + 20), taille = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const attrs = buf.readUInt32LE(p + 38);
    const nom = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    // un lien symbolique Unix (type S_IFLNK dans les attributs externes) : refusé
    if (((attrs >>> 16) & 0o170000) === 0o120000) throw new Error(`entrée « ${nom} » : lien symbolique, refusée`);
    out.push({ nom, taille, compresse });
    p += 46 + nl + xl + cl;
  }
  return out;
}

/** Ouvre une archive en mémoire, vérifiée. Rend ses fichiers (rien n'est écrit). */
export function ouvrirArchive(buf: Buffer, genre: 'zip' | 'tar.gz'): FichierArchive[] {
  if (genre === 'zip') {
    const inv = inventaireZip(buf);
    if (inv.length > BORNES.entrees) throw new Error(`trop d'entrées (${inv.length})`);
    const total = inv.reduce((s, e) => s + e.taille, 0);
    if (total > BORNES.archiveDecompressee) throw new Error('archive trop grande une fois ouverte');
    if (total > Math.max(1, buf.length) * BORNES.ratio && total > 1024 * 1024) throw new Error('rapport de compression suspect (bombe de décompression) : refusée');
    for (const e of inv) if (!e.nom.endsWith('/')) nomEntreeSur(e.nom);
    verifierNoms(inv.filter((e) => !e.nom.endsWith('/')).map((e) => e.nom), inv.filter((e) => e.nom.endsWith('/')).map((e) => e.nom));
    // unzip borne chaque entrée à sa taille annoncée : une archive qui ment sur sa taille est arrêtée là.
    const m = unzip(buf, BORNES.archiveDecompressee);
    const fichiers = [...m.entries()].map(([nom, octets]) => ({ nom: nomEntreeSur(nom), octets }));
    verifierNoms(fichiers.map((f) => f.nom));
    return fichiers;
  }
  let tar: Buffer;
  try { tar = gunzipSync(buf, { maxOutputLength: Math.min(BORNES.archiveDecompressee + 1024 * 1024, Math.max(64 * 1024, buf.length * BORNES.ratio)) }); }
  catch (e) { throw new Error(/maxOutputLength|larger than|Cannot create/.test(String((e as Error).message)) ? 'trop grande une fois décompressée (bombe de décompression) : refusée' : 'archive gzip abîmée'); }
  const fichiers = lireTarStrict(tar);
  verifierNoms(fichiers.map((f) => f.nom));
  return fichiers;
}

/** Extrait une archive dans un dossier NEUF (créé ici, sous le dossier de sortie), sans jamais écraser ni sortir. */
export function extraire(buf: Buffer, genre: 'zip' | 'tar.gz', dossierNeuf: string): string[] {
  const fichiers = ouvrirArchive(buf, genre); // tout est vérifié AVANT la première écriture
  if (!isAbsolute(dossierNeuf)) throw new Error('dossier d\'extraction : chemin complet attendu');
  if (existsSync(dossierNeuf)) throw new Error('le dossier d\'extraction existe déjà : rien n\'est écrasé');
  // le parent au besoin, puis le dossier lui-même SANS « recursive » : s'il est apparu entre-temps, EEXIST — on ne
  // prend jamais pour « neuf » (et on n'effacerait jamais en cas d'erreur) un dossier qui n'a pas été créé ici
  mkdirSync(dirname(dossierNeuf), { recursive: true });
  mkdirSync(dossierNeuf);
  const reel = realpathSync(dossierNeuf);
  const ecrits: string[] = [];
  try {
    for (const f of fichiers) {
      const cible = join(reel, ...f.nom.split('/'));
      const r = relative(reel, cible);
      if (!r || r.startsWith('..') || isAbsolute(r)) throw new Error(`entrée « ${f.nom} » hors du dossier : refusée`);
      mkdirSync(dirname(cible), { recursive: true });
      if (relative(reel, realpathSync(dirname(cible))).startsWith('..')) throw new Error('dossier d\'extraction détourné : refusé');
      writeFileSync(cible, f.octets, { flag: 'wx' });
      ecrits.push(f.nom);
    }
  } catch (e) {
    // une erreur en cours de route ne laisse pas une extraction à moitié faite : le dossier NEUF (créé ici) est retiré
    rmSync(reel, { recursive: true, force: true });
    throw e;
  }
  return ecrits;
}
