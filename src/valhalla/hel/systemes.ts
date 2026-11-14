// Perséphone · reconnaître le début d'un système de fichiers, et retrouver les partitions perdues d'un support.
// Chaque système laisse une marque à une place connue : on la cherche, puis on vérifie que le reste se tient
// (tailles, sommes de contrôle, copies de secours) avant d'y croire. Reconnus : ext2/3/4, NTFS, FAT12/16/32, exFAT,
// XFS, Btrfs et la mémoire d'échange de Linux (swap). Écrit d'après la documentation publique de chaque format.
import { champ, crc32c, propre, taille as tailleLisible, u64be, u64le, uuidTexte } from './octets.ts';
import { lireBpb, lireExfat, sommeExfat, type Bpb } from './fat.ts';
import type { Lecteur } from './support.ts';
import { GUID, type EtatGpt } from './tables.ts';

export type Genre = 'ext2' | 'ext3' | 'ext4' | 'ntfs' | 'fat12' | 'fat16' | 'fat32' | 'exfat' | 'xfs' | 'btrfs' | 'swap';
export interface Trouvee {
  /** octet où commence la partition, et sa taille en octets */
  debut: number; taille: number; genre: Genre;
  etiquette?: string; uuid?: string;
  /** « sûre » : une somme de contrôle ou une seconde preuve ; « probable » : la marque et des tailles cohérentes */
  coherence: 'sûre' | 'probable' | 'douteuse';
  notes: string[];
  /** partition de démarrage EFI (une FAT avec un dossier « EFI » à sa racine) */
  esp?: boolean;
  /** le début a été déduit d'une copie de secours : le vrai premier secteur est abîmé */
  parSecours?: boolean;
}
export const NOM_GENRE: Record<Genre, string> = { ext2: 'ext2 (Linux)', ext3: 'ext3 (Linux)', ext4: 'ext4 (Linux)', ntfs: 'NTFS (Windows)', fat12: 'FAT12', fat16: 'FAT16', fat32: 'FAT32', exfat: 'exFAT', xfs: 'XFS (Linux)', btrfs: 'Btrfs (Linux)', swap: 'Mémoire d\'échange (swap)' };
const pow2 = (n: number) => n > 0 && Number.isInteger(Math.log2(n));

// ---------------------------------------------------------------- ext2 / ext3 / ext4
interface SuperExt { blocs: number; bs: number; parGroupe: number; premier: number; groupe: number; etiquette: string; uuid: string; genre: Genre; somme?: boolean }
/** Le superbloc ext (1024 octets) est-il plausible ? Vérifie la marque et que les nombres se tiennent entre eux. */
function superExt(s: Buffer): SuperExt | undefined {
  if (s.length < 1024 || s.readUInt16LE(56) !== 0xef53) return undefined;
  const log = s.readUInt32LE(24); if (log > 6) return undefined;
  const bs = 1024 << log, inodes = s.readUInt32LE(0), parGroupe = s.readUInt32LE(32), inodesParGroupe = s.readUInt32LE(40), premier = s.readUInt32LE(20);
  const compat = s.readUInt32LE(92), incompat = s.readUInt32LE(96), ro = s.readUInt32LE(100);
  const blocs = s.readUInt32LE(4) + (incompat & 0x80 ? s.readUInt32LE(336) * 2 ** 32 : 0);
  if (!blocs || !inodes || !parGroupe || !inodesParGroupe || parGroupe > 8 * bs || inodesParGroupe > 8 * bs) return undefined;
  if (premier !== (bs === 1024 ? 1 : 0) || s.readUInt32LE(72) > 4 || s.readUInt32LE(76) > 1) return undefined;
  const groupes = Math.ceil((blocs - premier) / parGroupe); if (inodes !== groupes * inodesParGroupe) return undefined;
  const genre: Genre = (incompat & 0x2c0) || (ro & 0x478) ? 'ext4' : compat & 0x4 ? 'ext3' : 'ext2';
  return { blocs, bs, parGroupe, premier, groupe: s.readUInt16LE(90), etiquette: champ(s, 120, 16), uuid: uuidTexte(s, 104), genre, ...(ro & 0x400 ? { somme: crc32c(s.subarray(0, 1020)) === s.readUInt32LE(1020) } : {}) };
}
async function ext(l: Lecteur, p: number): Promise<Trouvee | undefined> {
  if (p < 0 || p + 2048 > l.taille) return undefined;
  const x = superExt(await l.lire(p + 1024, 1024)); if (!x || x.groupe !== 0) return undefined;
  const t: Trouvee = { debut: p, taille: x.blocs * x.bs, genre: x.genre, ...(x.etiquette ? { etiquette: x.etiquette } : {}), uuid: x.uuid, coherence: 'probable', notes: [] };
  if (x.somme === true) t.coherence = 'sûre';
  else if (x.somme === false) { t.coherence = 'douteuse'; t.notes.push('la somme de contrôle du superbloc est fausse'); }
  else {
    // Sans somme de contrôle : la copie de secours du superbloc (début du groupe 1) doit porter le même identifiant.
    const q = p + (x.premier + x.parGroupe) * x.bs;
    if (q + 1024 <= l.taille) { const y = superExt(await l.lire(q, 1024)); if (y && y.uuid === x.uuid && y.groupe === 1) t.coherence = 'sûre'; }
  }
  return t;
}
/** Une copie de secours du superbloc ext vue à l'octet `q` : où commencerait la partition ? */
async function extParSecours(l: Lecteur, q: number, s: Buffer): Promise<Trouvee | undefined> {
  const x = superExt(s); if (!x || x.groupe === 0) return undefined;
  const p = q - (x.premier + x.groupe * x.parGroupe) * x.bs; if (p < 0 || p % 512 !== 0) return undefined;
  const direct = await ext(l, p); if (direct) return direct;
  return { debut: p, taille: x.blocs * x.bs, genre: x.genre, ...(x.etiquette ? { etiquette: x.etiquette } : {}), uuid: x.uuid, coherence: x.somme === false ? 'douteuse' : 'probable', parSecours: true, notes: ['le premier superbloc est abîmé : début retrouvé grâce à une copie de secours (« e2fsck -b » saura le refaire)'] };
}

// ---------------------------------------------------------------- NTFS
async function etiquetteNtfs(l: Lecteur, mft: number, enreg: number): Promise<string | undefined> {
  if (enreg < 512 || enreg > 65536) return undefined;
  const r = await l.lire(mft + 3 * enreg, enreg); if (r.length < enreg || r.toString('latin1', 0, 4) !== 'FILE') return undefined;
  // Les deux derniers octets de chaque secteur de l'enregistrement sont rangés à part : on les remet.
  const usa = r.readUInt16LE(4), n = r.readUInt16LE(6); if (usa + n * 2 <= r.length) for (let i = 1; i < n; i++) { const o = i * 512 - 2; if (o + 2 <= r.length) r.copy(r, o, usa + i * 2, usa + i * 2 + 2); }
  for (let o = r.readUInt16LE(20), tours = 0; o + 24 <= r.length && tours < 64; tours++) {
    const type = r.readUInt32LE(o), len = r.readUInt32LE(o + 4); if (type === 0xffffffff || len < 24 || o + len > r.length) break;
    if (type === 0x60 && r[o + 8] === 0) { const n2 = r.readUInt32LE(o + 16), d = o + r.readUInt16LE(o + 20); if (d + n2 <= r.length) return propre(r.subarray(d, d + n2).toString('utf16le'), 40) || undefined; }
    o += len;
  }
  return undefined;
}
async function ntfs(l: Lecteur, p: number): Promise<Trouvee | undefined> {
  if (p < 0 || p + 512 > l.taille) return undefined;
  const b = await l.lire(p, 512); if (b.length < 512 || b.toString('latin1', 3, 11) !== 'NTFS    ' || b[510] !== 0x55 || b[511] !== 0xaa) return undefined;
  const bps = b.readUInt16LE(11), brut = b[13], spc = brut <= 0x80 ? brut : 2 ** (256 - brut), total = u64le(b, 40), mftLcn = u64le(b, 48);
  if (![512, 1024, 2048, 4096].includes(bps) || !pow2(spc) || !Number.isFinite(total) || total < 16 || !Number.isFinite(mftLcn)) return undefined;
  const grappe = bps * spc, v = b.readInt8(64), enreg = v > 0 ? v * grappe : 2 ** -v, tailleP = (total + 1) * bps;
  const t = (debut: number): Trouvee => ({ debut, taille: tailleP, genre: 'ntfs', uuid: b.subarray(72, 80).toString('hex').toUpperCase(), coherence: 'sûre', notes: [] });
  const fichier = async (debut: number) => debut >= 0 && debut + mftLcn * grappe + 4 <= l.taille && (await l.lire(debut + mftLcn * grappe, 4)).toString('latin1') === 'FILE';
  if (await fichier(p)) { const x = t(p), e = await etiquetteNtfs(l, p + mftLcn * grappe, enreg); if (e) x.etiquette = e; return x; }
  // Ce secteur est peut-être la copie de secours, rangée dans le dernier secteur de la partition.
  const q = p - total * bps;
  if (await fichier(q)) {
    const premier = await l.lire(q, 512), x = t(q), e = await etiquetteNtfs(l, q + mftLcn * grappe, enreg); if (e) x.etiquette = e;
    if (premier.toString('latin1', 3, 11) !== 'NTFS    ') { x.parSecours = true; x.coherence = 'probable'; x.notes.push('le premier secteur est abîmé : début retrouvé grâce à sa copie de secours (« ntfsfix » ou « chkdsk » saura le refaire)'); }
    return x;
  }
  return undefined;
}

// ---------------------------------------------------------------- FAT12 / FAT16 / FAT32
const debutFat = (f: Buffer, g: Bpb) => f.length >= 8 && f[0] === g.media && f[1] === 0xff && (g.bits === 12 ? f[2] === 0xff : g.bits === 16 ? f[2] === 0xff && (f[3] & 0x3f) === 0x3f : (f[3] & 0x0f) === 0x0f && f[4] === 0xff);
/** L'étiquette et le dossier « EFI » d'une FAT, lus dans les premières entrées de son dossier racine. */
async function racineFat(l: Lecteur, p: number, g: Bpb): Promise<{ etiquette?: string; efi: boolean }> {
  const pos = g.bits === 32 ? p + (g.premierSecteurDonnees + (g.racine - 2) * g.spc) * g.bps : p + (g.reserves + g.nbFat * g.tailleFat) * g.bps;
  const d = await l.lire(pos, Math.min(g.bits === 32 ? g.bps * g.spc : g.entreesRacine * 32, 16384)); let etiquette: string | undefined, efi = false;
  for (let o = 0; o + 32 <= d.length; o += 32) {
    if (d[o] === 0) break; if (d[o] === 0xe5 || d[o + 11] === 0x0f) continue;
    if (d[o + 11] & 0x08) etiquette ??= propre(d.subarray(o, o + 11).toString('latin1'), 11);
    else if (d[o + 11] & 0x10 && d.subarray(o, o + 11).toString('latin1') === 'EFI        ') efi = true;
  }
  return { ...(etiquette ? { etiquette } : {}), efi };
}
async function fat(l: Lecteur, p: number): Promise<Trouvee | undefined> {
  if (p < 0 || p + 512 > l.taille) return undefined;
  const g = lireBpb(await l.lire(p, 512)); if (!g) return undefined;
  const rend = async (debut: number, secours: boolean): Promise<Trouvee> => {
    const r = await racineFat(l, debut, g), e = r.etiquette ?? (g.etiquette && g.etiquette !== 'NO NAME' ? g.etiquette : undefined);
    return { debut, taille: g.secteurs * g.bps, genre: `fat${g.bits}` as Genre, ...(e ? { etiquette: e } : {}), ...(g.serie ? { uuid: g.serie } : {}), coherence: secours ? 'probable' : 'sûre', notes: secours ? ['le premier secteur est abîmé : début retrouvé grâce à sa copie de secours'] : [], ...(r.efi ? { esp: true } : {}), ...(secours ? { parSecours: true } : {}) };
  };
  if (debutFat(await l.lire(p + g.reserves * g.bps, 8), g)) return rend(p, false);
  // FAT32 : ce secteur est peut-être la copie de secours du premier (rangée quelques secteurs plus loin).
  if (g.bits === 32 && g.copie > 0 && g.copie < g.reserves) {
    const q = p - g.copie * g.bps;
    if (q >= 0 && debutFat(await l.lire(q + g.reserves * g.bps, 8), g)) return rend(q, !lireBpb(await l.lire(q, 512)));
  }
  return undefined;
}

// ---------------------------------------------------------------- exFAT
async function exfat(l: Lecteur, p: number): Promise<Trouvee | undefined> {
  if (p < 0 || p + 512 > l.taille) return undefined;
  const g = lireExfat(await l.lire(p, 512)); if (!g) return undefined;
  const zone = await l.lire(p, 12 * g.bps); if (zone.length < 12 * g.bps || sommeExfat(zone, g.bps) !== zone.readUInt32LE(11 * g.bps)) return undefined;
  const fatLa = async (debut: number) => { const f = await l.lire(debut + g.debutFat * g.bps, 8); return f.length === 8 && f.readUInt32LE(0) === 0xfffffff8 && f.readUInt32LE(4) === 0xffffffff; };
  const rend = async (debut: number, secours: boolean): Promise<Trouvee> => {
    const t: Trouvee = { debut, taille: g.secteurs * g.bps, genre: 'exfat', uuid: g.serie, coherence: secours ? 'probable' : 'sûre', notes: secours ? ['le premier secteur est abîmé : début retrouvé grâce à sa copie de secours'] : [], ...(secours ? { parSecours: true } : {}) };
    const d = await l.lire(debut + (g.debutGrappes + (g.racine - 2) * g.spc) * g.bps, Math.min(g.bps * g.spc, 16384));
    for (let o = 0; o + 32 <= d.length && d[o] !== 0; o += 32) if (d[o] === 0x83 && d[o + 1] > 0 && d[o + 1] <= 11) { t.etiquette = propre(d.subarray(o + 2, o + 2 + d[o + 1] * 2).toString('utf16le'), 22); break; }
    return t;
  };
  if (await fatLa(p)) return rend(p, false);
  // La zone de démarrage est copiée 12 secteurs plus loin : ce secteur est peut-être cette copie.
  const q = p - 12 * g.bps;
  if (q >= 0 && await fatLa(q)) return rend(q, !lireExfat(await l.lire(q, 512)));
  return undefined;
}

// ---------------------------------------------------------------- XFS
async function xfs(l: Lecteur, p: number): Promise<Trouvee | undefined> {
  if (p < 0 || p + 512 > l.taille) return undefined;
  const b = await l.lire(p, 512); if (b.length < 512 || b.toString('latin1', 0, 4) !== 'XFSB') return undefined;
  const bs = b.readUInt32BE(4), blocs = u64be(b, 8), parGroupe = b.readUInt32BE(84), groupes = b.readUInt32BE(88), sect = b.readUInt16BE(102), inode = b.readUInt16BE(104);
  if (!pow2(bs) || bs < 512 || bs > 65536 || !Number.isFinite(blocs) || !parGroupe || !groupes || !pow2(sect) || sect < 512 || sect > 32768 || !pow2(inode) || inode < 256 || inode > 2048) return undefined;
  if (blocs > groupes * parGroupe || blocs <= (groupes - 1) * parGroupe) return undefined;
  // Chaque groupe porte une copie du superbloc ; le secteur suivant dit le numéro du groupe (0 : le vrai début).
  const a = await l.lire(p + sect, 16); if (a.toString('latin1', 0, 4) !== 'XAGF') return undefined;
  const no = a.readUInt32BE(8), e = champ(b, 108, 12);
  const t: Trouvee = { debut: p - no * parGroupe * bs, taille: blocs * bs, genre: 'xfs', ...(e ? { etiquette: e } : {}), uuid: uuidTexte(b, 32), coherence: 'sûre', notes: [] };
  if (no === 0) return t;
  if (no >= groupes || t.debut < 0) return undefined;
  if ((await l.lire(t.debut, 4)).toString('latin1') === 'XFSB') return xfs(l, t.debut);
  return { ...t, coherence: 'probable', parSecours: true, notes: ['le premier secteur est abîmé : début retrouvé grâce à une copie de secours (« xfs_repair » saura le refaire)'] };
}

// ---------------------------------------------------------------- Btrfs
const BTRFS = 65536;
async function btrfs(l: Lecteur, q: number): Promise<Trouvee | undefined> {
  // `q` : l'octet où se trouve un superbloc Btrfs (il dit lui-même à quelle distance du début il est rangé).
  if (q < 0 || q + 4096 > l.taille) return undefined;
  const b = await l.lire(q, 4096); if (b.length < 4096 || b.toString('latin1', 64, 72) !== '_BHRfS_M') return undefined;
  const ou = u64le(b, 48), total = u64le(b, 201 + 8), sect = b.readUInt32LE(144), noeud = b.readUInt32LE(148);
  if (![BTRFS, 64 * 1024 * 1024, 256 * 1024 ** 3].includes(ou) || !Number.isFinite(total) || total < 1024 * 1024 || !pow2(sect) || sect < 512 || sect > 65536 || !pow2(noeud)) return undefined;
  const juste = b.readUInt16LE(196) !== 0 ? undefined : ((~crc32c(b.subarray(32))) >>> 0) === b.readUInt32LE(0), debut = q - ou, e = champ(b, 299, 256);
  if (debut < 0 || juste === false) return undefined;
  const t: Trouvee = { debut, taille: total, genre: 'btrfs', ...(e ? { etiquette: propre(e, 40) } : {}), uuid: uuidTexte(b, 32), coherence: juste ? 'sûre' : 'probable', notes: [] };
  if (ou === BTRFS) return t;
  const premier = await btrfs(l, debut + BTRFS); if (premier) return premier;
  return { ...t, coherence: 'probable', parSecours: true, notes: ['le premier superbloc est abîmé : début retrouvé grâce à une copie de secours (« btrfs rescue super-recover » saura le refaire)'] };
}

// ---------------------------------------------------------------- mémoire d'échange de Linux
async function swap(l: Lecteur, fin: number): Promise<Trouvee | undefined> {
  // `fin` : l'octet juste après la marque « SWAPSPACE2 », qui termine la première page de la zone.
  for (const page of [4096, 8192, 16384, 65536]) {
    const p = fin - page; if (p < 0 || p % 512 !== 0) continue;
    const h = await l.lire(p + 1024, 48); if (h.length < 48 || h.readUInt32LE(0) !== 1) continue;
    const derniere = h.readUInt32LE(4), abimees = h.readUInt32LE(8); if (!derniere || abimees > derniere) continue;
    const e = champ(h, 28, 16);
    return { debut: p, taille: (derniere + 1) * page, genre: 'swap', ...(e ? { etiquette: e } : {}), uuid: uuidTexte(h, 12), coherence: 'probable', notes: [] };
  }
  return undefined;
}

/** Y a-t-il un système de fichiers qui commence exactement à l'octet `p` ? */
export async function reconnaitre(l: Lecteur, p: number): Promise<Trouvee | undefined> {
  if (p < 0 || p + 512 > l.taille) return undefined;
  const b = await l.lire(p, 4096);
  const tente = async (f: () => Promise<Trouvee | undefined>) => { const t = await f(); return t && t.debut === p ? t : undefined; };
  if (b.length >= 512 && b[510] === 0x55 && b[511] === 0xaa) {
    const nom = b.toString('latin1', 3, 11);
    const t = nom === 'NTFS    ' ? await tente(() => ntfs(l, p)) : nom === 'EXFAT   ' ? await tente(() => exfat(l, p)) : await tente(() => fat(l, p));
    if (t) return t;
  }
  if (b.length >= 4 && b.toString('latin1', 0, 4) === 'XFSB') { const t = await tente(() => xfs(l, p)); if (t) return t; }
  if (b.length >= 2048 && b.readUInt16LE(1080) === 0xef53) { const t = await ext(l, p); if (t) return t; }
  if (b.length >= 4096 && b.toString('latin1', 4086, 4096) === 'SWAPSPACE2') { const t = await tente(() => swap(l, p + 4096)); if (t) return t; }
  if (p + BTRFS + 4096 <= l.taille) { const t = await tente(() => btrfs(l, p + BTRFS)); if (t) return t; }
  return undefined;
}

// ---------------------------------------------------------------- chercher les partitions perdues
export interface Recherche { trouvees: Trouvee[]; /** tables GPT entières vues ailleurs qu'à leur place habituelle */ gpt: EtatGpt[]; arretee: boolean; octets: number }
export interface OptionsRecherche {
  /** « rapide » : seulement aux endroits où une partition commence d'habitude ; « complète » : chaque secteur */
  profondeur: 'rapide' | 'complète';
  surAvance?(octets: number, trouvees: number): void;
  /** mis à vrai pour arrêter */
  arret?: { stop: boolean };
  /** lire les tables GPT vues en route (donnée par l'appelant pour ne pas dépendre des tables ici) */
  gptEn?(lba: number): Promise<EtatGpt | undefined>;
}
const pause = () => new Promise<void>((r) => setImmediate(r));
/**
 * Parcourt le support à la recherche des débuts de systèmes de fichiers. Lecture seule, mémoire bornée (un bloc à
 * la fois), et la main est rendue entre deux blocs pour qu'Odin continue de répondre.
 */
export async function chercherPartitions(l: Lecteur, o: OptionsRecherche): Promise<Recherche> {
  const vues = new Map<number, Trouvee>(), gpt: EtatGpt[] = [], sec = l.secteur || 512;
  const note = (t: Trouvee | undefined) => { if (!t || t.debut < 0) return; const old = vues.get(t.debut); if (!old || (old.parSecours && !t.parSecours)) vues.set(t.debut, t); };
  let pos = 0, arretee = false;
  if (o.profondeur === 'rapide') {
    // Les débuts habituels : chaque mégaoctet (disques récents), et les anciennes frontières de « cylindres ».
    const MIO = 1024 * 1024, CYL = 16065 * 512, PISTE = 63 * 512; let n = 0;
    const suivant = (p: number) => Math.min(Math.floor(p / MIO) * MIO + MIO, Math.floor(p / CYL) * CYL + CYL, p < Math.floor(p / CYL) * CYL + PISTE ? Math.floor(p / CYL) * CYL + PISTE : Infinity);
    while (pos < l.taille) {
      if (o.arret?.stop) { arretee = true; break; }
      let t = await reconnaitre(l, pos);
      // Une copie de secours du superbloc ext peut se trouver ici même (début d'un groupe de blocs).
      if (!t) { const s = await l.lire(pos, 1024); if (s.length === 1024 && s.readUInt16LE(56) === 0xef53) t = await extParSecours(l, pos, s); }
      if (!t && pos + 512 <= l.taille) { const b = await l.lire(pos, 512); if (b.toString('latin1', 3, 11) === 'NTFS    ') t = await ntfs(l, pos); }
      note(t);
      // Dans une partition sûre, rien d'autre à chercher : on saute à sa fin.
      pos = t && t.debut === pos && t.coherence === 'sûre' && t.taille > 0 ? Math.max(suivant(pos), Math.floor((pos + t.taille) / 512) * 512) : suivant(pos);
      if (++n % 64 === 0) { o.surAvance?.(Math.min(pos, l.taille), vues.size); await pause(); }
    }
    // La copie de secours de NTFS est dans le tout dernier secteur de la partition : rarement sur une frontière.
  } else {
    const BLOC = 4 * 1024 * 1024;
    while (pos < l.taille) {
      if (o.arret?.stop) { arretee = true; break; }
      const b = await l.lire(pos, BLOC + 1024), fin = Math.min(BLOC, b.length);
      for (let i = 0; i + 512 <= fin; i += 512) {
        const a = pos + i;
        if (b[i + 510] === 0x55 && b[i + 511] === 0xaa) {
          const nom = b.toString('latin1', i + 3, i + 11);
          if (nom === 'NTFS    ') note(await ntfs(l, a)); else if (nom === 'EXFAT   ') note(await exfat(l, a)); else if ((b[i] === 0xeb || b[i] === 0xe9) && lireBpb(b.subarray(i, i + 512))) note(await fat(l, a));
        }
        if (b[i] === 0x58 && b[i + 1] === 0x46 && b[i + 2] === 0x53 && b[i + 3] === 0x42) note(await xfs(l, a));
        if (b[i + 56] === 0x53 && b[i + 57] === 0xef && i + 1024 <= b.length) { const s = b.subarray(i, i + 1024), x = superExt(s); if (x) note(x.groupe === 0 ? await ext(l, a - 1024) : await extParSecours(l, a, Buffer.from(s))); }
        if (b[i + 64] === 0x5f && b[i + 65] === 0x42 && b.toString('latin1', i + 64, i + 72) === '_BHRfS_M') note(await btrfs(l, a));
        if (b[i + 502] === 0x53 && b[i + 503] === 0x57 && b.toString('latin1', i + 502, i + 512) === 'SWAPSPACE2') note(await swap(l, a + 512));
        if (b[i] === 0x45 && b[i + 1] === 0x46 && a % sec === 0 && b.toString('latin1', i, i + 8) === 'EFI PART' && o.gptEn) { const lba = a / sec; if (lba !== 1 && lba !== Math.floor(l.taille / sec) - 1) { const g = await o.gptEn(lba); if (g?.entreesJustes) gpt.push(g); } }
      }
      pos += fin; o.surAvance?.(Math.min(pos, l.taille), vues.size); await pause();
    }
  }
  return { trouvees: [...vues.values()].sort((a, b) => a.debut - b.debut), gpt, arretee, octets: Math.min(pos, l.taille) };
}

// ---------------------------------------------------------------- la table qu'on propose d'écrire
export interface Prevue { debut: number; secteurs: number; genre: string; etiquette?: string; /** type GPT et code MBR */ type: string; code: number; guid?: string; nom?: string; amorce?: boolean }
const TYPES: Record<Genre, { type: string; code: number }> = {
  ext2: { type: GUID.linux, code: 0x83 }, ext3: { type: GUID.linux, code: 0x83 }, ext4: { type: GUID.linux, code: 0x83 }, xfs: { type: GUID.linux, code: 0x83 }, btrfs: { type: GUID.linux, code: 0x83 },
  swap: { type: GUID.swap, code: 0x82 }, ntfs: { type: GUID.microsoft, code: 0x07 }, exfat: { type: GUID.microsoft, code: 0x07 }, fat12: { type: GUID.microsoft, code: 0x01 }, fat16: { type: GUID.microsoft, code: 0x0e }, fat32: { type: GUID.microsoft, code: 0x0c },
};
/**
 * Choisit, parmi les systèmes retrouvés, ceux qui peuvent former une table : dans l'ordre, sans chevauchement,
 * qui tiennent dans le support. Ce qui est écarté est dit dans `ecartees`. Pur.
 */
export function choisir(trouvees: Trouvee[], secteur: number, secteurs: number): { prevues: Prevue[]; ecartees: string[] } {
  const prevues: Prevue[] = [], ecartees: string[] = []; let fin = 0, derniere: Trouvee | undefined;
  const rang = { 'sûre': 2, probable: 1, douteuse: 0 } as const;
  for (const t of [...trouvees].sort((a, b) => a.debut - b.debut || rang[b.coherence] - rang[a.coherence])) {
    const qui = `${NOM_GENRE[t.genre]} à ${tailleLisible(t.debut)} du début`;
    if (t.coherence === 'douteuse') { ecartees.push(`${qui} : trop douteuse`); continue; }
    if (t.debut % secteur !== 0 || t.taille <= 0) { ecartees.push(`${qui} : début ou taille impossibles`); continue; }
    const debut = t.debut / secteur, n = Math.ceil(t.taille / secteur);
    if (debut < 1) { ecartees.push(`${qui} : elle occupe tout le support, sans table de partitions (rien à réparer)`); continue; }
    if (debut + n > secteurs) { ecartees.push(`${qui} : elle dépasse la fin du support (${tailleLisible(t.taille)} annoncés)`); continue; }
    if (debut < fin) {
      // Chevauchement : on garde la plus sûre ; à égalité, celle qui était déjà là (la première).
      if (derniere && rang[t.coherence] > rang[derniere.coherence]) { const old = prevues.pop()!; ecartees.push(`${old.genre} au secteur ${old.debut} : chevauche une partition plus sûre`); }
      else { ecartees.push(`${qui} : à l'intérieur d'une autre partition (sans doute un fichier qui contient un système de fichiers)`); continue; }
    }
    const e = t.esp ? { type: GUID.esp, code: 0xef } : TYPES[t.genre];
    prevues.push({ debut, secteurs: n, genre: t.esp ? 'Démarrage EFI (FAT)' : NOM_GENRE[t.genre], ...(t.etiquette ? { etiquette: t.etiquette } : {}), ...e });
    fin = debut + n; derniere = t;
  }
  return { prevues, ecartees };
}
