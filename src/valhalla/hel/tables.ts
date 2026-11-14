// Perséphone · les tables de partitions : lire une table MBR (avec ses partitions logiques) ou GPT (table
// principale au début du disque, copie de secours à la fin, chacune avec ses deux sommes de contrôle), et
// fabriquer les octets d'une table à écrire. Rien ici n'écrit sur un support : on rend des octets et des positions.
// Formats : spécification UEFI (GPT) et table de partitions classique du PC (MBR).
import { randomUUID } from 'node:crypto';
import { crc32, ecrireU64le, guidOctets, guidTexte, propre, u64le } from './octets.ts';
import type { Lecteur } from './support.ts';

export const GUID = {
  linux: '0FC63DAF-8483-4772-8E79-3D69D8477DE4', swap: '0657FD6D-A4AB-43C4-84E5-0933C84B4F4F', microsoft: 'EBD0A0A2-B9E5-4433-87C0-68B6B72699C7',
  esp: 'C12A7328-F81F-11D2-BA4B-00A0C93EC93B',
} as const;
const NOMS_GUID: Record<string, string> = {
  [GUID.linux]: 'Linux', [GUID.swap]: 'Mémoire d\'échange (swap)', [GUID.microsoft]: 'Données (Windows, clé, carte)', [GUID.esp]: 'Démarrage EFI',
  'E3C9E316-0B5C-4DB8-817D-F92DF00215AE': 'Réservée Microsoft', 'DE94BBA4-06D1-4D40-A16A-BFD50179D6AC': 'Récupération Windows', '21686148-6449-6E6F-744E-656564454649': 'Démarrage BIOS',
  'E6D6D379-F507-44C2-A23C-238F2A3DF928': 'LVM (Linux)', 'A19D880F-05FC-4D3B-A006-743F0F84911E': 'RAID (Linux)', 'CA7D7CCB-63ED-4C53-861C-1742536059CC': 'Chiffrée LUKS (Linux)',
  '933AC7E1-2EB4-4F13-B844-0E14E2AEF915': 'Linux (dossiers personnels)', '4F68BCE3-E8CD-4DB1-96E7-FBCAF984B709': 'Linux (système)', '48465300-0000-11AA-AA11-00306543ECAC': 'Mac (HFS+)', '7C3457EF-0000-11AA-AA11-00306543ECAC': 'Mac (APFS)',
};
const NOMS_MBR: Record<number, string> = {
  0x01: 'FAT12', 0x04: 'FAT16', 0x06: 'FAT16', 0x0e: 'FAT16', 0x0b: 'FAT32', 0x0c: 'FAT32', 0x07: 'NTFS ou exFAT', 0x82: 'Mémoire d\'échange (swap)', 0x83: 'Linux', 0x8e: 'LVM (Linux)',
  0xfd: 'RAID (Linux)', 0xef: 'Démarrage EFI', 0xee: 'Protection GPT', 0x05: 'Étendue', 0x0f: 'Étendue', 0x85: 'Étendue', 0x27: 'Récupération Windows', 0xaf: 'Mac (HFS+)', 0xa5: 'FreeBSD',
};
const ETENDUE = new Set([0x05, 0x0f, 0x85]);
export const nomGuid = (g: string) => NOMS_GUID[g.toUpperCase()] ?? 'Autre';
export const nomMbr = (t: number) => NOMS_MBR[t] ?? `Autre (0x${t.toString(16).padStart(2, '0')})`;

export interface Partition {
  numero: number;
  /** premier secteur et nombre de secteurs */
  debut: number; secteurs: number;
  /** le type en clair (« Linux », « Démarrage EFI »…) et son code (GUID ou 0xNN) */
  genre: string; code: string;
  nom?: string; guid?: string; amorce?: boolean; logique?: boolean;
}
export interface EtatGpt {
  /** la signature « EFI PART » est là */
  present: boolean; lba: number; enteteJuste: boolean; entreesJustes: boolean;
  guid?: string; premier?: number; dernier?: number; autre?: number; partitions: Partition[];
  /** les entrées telles qu'elles sont sur le disque (quand leur somme de contrôle est juste) */
  entrees?: Buffer; nb?: number; tailleEntree?: number;
}
export interface Table {
  genre: 'gpt' | 'mbr' | 'aucune';
  /** taille d'un secteur, et nombre de secteurs du support */
  secteur: number; secteurs: number;
  partitions: Partition[]; remarques: string[];
  mbr: { signature: boolean; valide: boolean; protecteur: boolean; partitions: Partition[] };
  gpt: { principal: EtatGpt; secours: EtatGpt };
}

function lireMbr(s0: Buffer, total: number): Table['mbr'] {
  const out: Table['mbr'] = { signature: s0.length >= 512 && s0[510] === 0x55 && s0[511] === 0xaa, valide: false, protecteur: false, partitions: [] };
  if (!out.signature) return out;
  let ok = true;
  for (let i = 0; i < 4; i++) {
    const o = 446 + i * 16, etat = s0[o], type = s0[o + 4], debut = s0.readUInt32LE(o + 8), n = s0.readUInt32LE(o + 12);
    if (etat !== 0 && etat !== 0x80) ok = false;
    if (type === 0) { if (debut !== 0 || n !== 0) ok = false; continue; }
    if (debut === 0 || n === 0 || debut >= total) ok = false;
    if (type === 0xee) out.protecteur = true;
    out.partitions.push({ numero: i + 1, debut, secteurs: n, genre: nomMbr(type), code: `0x${type.toString(16).padStart(2, '0')}`, ...(etat === 0x80 ? { amorce: true } : {}) });
  }
  out.valide = ok; if (!ok) { out.partitions = []; out.protecteur = false; }
  return out;
}
/** Les partitions logiques rangées dans une partition étendue (chaîne de petits secteurs de table). */
async function logiques(l: Lecteur, sec: number, total: number, etendue: Partition): Promise<Partition[]> {
  const out: Partition[] = []; let suivant = 0;
  for (let n = 0; n < 128; n++) {
    const ici = etendue.debut + suivant; if (ici >= total) break;
    const b = await l.lire(ici * sec, 512); if (b.length < 512 || b[510] !== 0x55 || b[511] !== 0xaa) break;
    const t0 = b[446 + 4], d0 = b.readUInt32LE(446 + 8), n0 = b.readUInt32LE(446 + 12);
    if (t0 !== 0 && n0 > 0 && ici + d0 + n0 <= total) out.push({ numero: 5 + out.length, debut: ici + d0, secteurs: n0, genre: nomMbr(t0), code: `0x${t0.toString(16).padStart(2, '0')}`, logique: true });
    const t1 = b[462 + 4], d1 = b.readUInt32LE(462 + 8);
    if (!ETENDUE.has(t1) || d1 === 0 || d1 <= suivant) break;
    suivant = d1;
  }
  return out;
}
async function lireGpt(l: Lecteur, lba: number, sec: number): Promise<EtatGpt> {
  const vide: EtatGpt = { present: false, lba, enteteJuste: false, entreesJustes: false, partitions: [] };
  if (lba < 1 || (lba + 1) * sec > l.taille) return vide;
  const h = await l.lire(lba * sec, sec);
  if (h.length < 92 || h.toString('latin1', 0, 8) !== 'EFI PART') return vide;
  const e: EtatGpt = { ...vide, present: true };
  const taille = h.readUInt32LE(12); if (taille < 92 || taille > h.length) return e;
  const copie = Buffer.from(h.subarray(0, taille)); copie.writeUInt32LE(0, 16);
  e.enteteJuste = crc32(copie) === h.readUInt32LE(16); if (!e.enteteJuste) return e;
  const moi = u64le(h, 24), lbaEntrees = u64le(h, 72), nb = h.readUInt32LE(80), te = h.readUInt32LE(84);
  e.autre = u64le(h, 32); e.premier = u64le(h, 40); e.dernier = u64le(h, 48); e.guid = guidTexte(h, 56); e.nb = nb; e.tailleEntree = te;
  // Un en-tête juste mais rangé ailleurs que là où il dit être : il a été copié, on ne s'y fie pas.
  if (moi !== lba || nb < 1 || nb > 4096 || te < 128 || te > 4096 || te % 8 !== 0 || !Number.isFinite(lbaEntrees) || lbaEntrees * sec + nb * te > l.taille) { e.enteteJuste = false; return e; }
  const t = await l.lire(lbaEntrees * sec, nb * te);
  e.entreesJustes = t.length === nb * te && crc32(t) === h.readUInt32LE(88); if (!e.entreesJustes) return e;
  e.entrees = t;
  for (let i = 0; i < nb; i++) {
    const o = i * te; if (t.subarray(o, o + 16).every((x) => x === 0)) continue;
    const type = guidTexte(t, o), debut = u64le(t, o + 32), fin = u64le(t, o + 40);
    if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin < debut) continue;
    const nom = propre(t.subarray(o + 56, o + Math.min(te, 128)).toString('utf16le').replace(/\0.*$/s, ''), 36);
    e.partitions.push({ numero: i + 1, debut, secteurs: fin - debut + 1, genre: nomGuid(type), code: type, guid: guidTexte(t, o + 16), ...(nom ? { nom } : {}) });
  }
  return e;
}
/** Lit la table de partitions d'un support : GPT (principale et copie de secours) ou MBR. */
export async function lireTable(l: Lecteur): Promise<Table> {
  let sec = l.secteur || 512;
  // Un fichier image d'un disque à secteurs de 4096 octets : la table GPT est alors à l'octet 4096.
  if (sec === 512 && l.taille >= 8192) { const a = await l.lire(512, 8), b = await l.lire(4096, 8); if (a.toString('latin1') !== 'EFI PART' && b.toString('latin1') === 'EFI PART') sec = 4096; }
  const total = Math.floor(l.taille / sec), s0 = await l.lire(0, 512), mbr = lireMbr(s0, total);
  const principal = await lireGpt(l, 1, sec);
  let secours = await lireGpt(l, total - 1, sec);
  if (!secours.entreesJustes && principal.enteteJuste && Number.isFinite(principal.autre) && principal.autre !== total - 1) { const x = await lireGpt(l, principal.autre!, sec); if (x.present) secours = x; }
  const t: Table = { genre: 'aucune', secteur: sec, secteurs: total, partitions: [], remarques: [], mbr, gpt: { principal, secours } };
  if (principal.entreesJustes) {
    t.genre = 'gpt'; t.partitions = principal.partitions;
    if (!secours.entreesJustes) t.remarques.push(secours.present ? 'La copie de secours de la table (à la fin du support) est abîmée.' : 'La copie de secours de la table (à la fin du support) a disparu.');
    if (!mbr.protecteur) t.remarques.push('Le premier secteur n\'annonce plus la table GPT (protection absente) : certains systèmes ne verront pas les partitions.');
  } else if (secours.entreesJustes) {
    t.genre = 'gpt'; t.partitions = secours.partitions;
    t.remarques.push(principal.present ? 'La table principale (au début du support) est abîmée ; sa copie de secours, à la fin, est intacte.' : 'La table principale (au début du support) a disparu ; sa copie de secours, à la fin, est intacte.');
  } else if (mbr.valide && mbr.partitions.some((p) => p.code !== '0xee')) {
    t.genre = 'mbr'; t.partitions = [...mbr.partitions];
    for (const p of mbr.partitions) if (ETENDUE.has(Number(p.code))) t.partitions.push(...await logiques(l, sec, total, p));
    for (const p of t.partitions) if (p.debut + p.secteurs > total) t.remarques.push(`La partition ${p.numero} dépasse la fin du support.`);
  } else {
    if (principal.present || secours.present) t.remarques.push('Il reste des traces d\'une table GPT, mais ses sommes de contrôle sont fausses : elle est abîmée.');
    else if (mbr.protecteur) t.remarques.push('Le premier secteur annonce une table GPT, mais elle a disparu (au début et à la fin du support).');
    else if (mbr.valide) t.remarques.push('La table de partitions est vide.');
    else t.remarques.push('Aucune table de partitions lisible.');
  }
  return t;
}

// ---------------------------------------------------------------- fabriquer une table (des octets, rien n'est écrit ici)
export interface Ecriture { pos: number; data: Buffer; quoi: string }
export interface Voulue { debut: number; secteurs: number; /** GUID du type (GPT) */ type: string; /** code du type (MBR) */ code: number; guid?: string; nom?: string; amorce?: boolean }

const chs = (lba: number): [number, number, number] => { const c = Math.floor(lba / (255 * 63)); if (c > 1023) return [0xfe, 0xff, 0xff]; const h = Math.floor(lba / 63) % 255, s = (lba % 63) + 1; return [h, (s & 0x3f) | ((c >> 2) & 0xc0), c & 0xff]; };
function entreeMbr(b: Buffer, i: number, p: { debut: number; secteurs: number; code: number; amorce?: boolean }): void {
  const o = 446 + i * 16; b[o] = p.amorce ? 0x80 : 0; b.set(chs(p.debut), o + 1); b[o + 4] = p.code; b.set(chs(p.debut + p.secteurs - 1), o + 5);
  b.writeUInt32LE(p.debut, o + 8); b.writeUInt32LE(p.secteurs, o + 12);
}
/** Le premier secteur d'une table MBR : le code de démarrage et la signature du disque déjà là sont gardés. */
export function construireMbr(actuel: Buffer, parts: Voulue[], total: number): Ecriture[] {
  if (parts.length > 4) throw new Error('une table MBR ne porte que 4 partitions principales');
  const tri = [...parts].sort((a, b) => a.debut - b.debut);
  tri.forEach((p, i) => {
    if (p.debut < 1 || p.secteurs < 1 || p.debut + p.secteurs > total) throw new Error('une partition sort du support');
    if (p.debut + p.secteurs > 0xffffffff) throw new Error('support trop grand pour une table MBR (plus de 2 To) : il faut une table GPT');
    if (i > 0 && p.debut < tri[i - 1].debut + tri[i - 1].secteurs) throw new Error('deux partitions se chevauchent');
  });
  const b = Buffer.alloc(512); actuel.copy(b, 0, 0, Math.min(446, actuel.length)); b.fill(0, 446);
  tri.forEach((p, i) => entreeMbr(b, i, p)); b[510] = 0x55; b[511] = 0xaa;
  return [{ pos: 0, data: b, quoi: 'premier secteur (table MBR)' }];
}
/** Les octets d'une table GPT complète à partir de ses entrées déjà rangées (`nb` entrées de `te` octets). */
function gptDepuisEntrees(o: { secteur: number; secteurs: number; entrees: Buffer; nb: number; te: number; guidDisque: string; premier: number; dernier: number; actuel: Buffer }): { mbr: Ecriture; principal: Ecriture[]; secours: Ecriture[] } {
  const sec = o.secteur, total = o.secteurs, nSec = Math.ceil((o.nb * o.te) / sec), bloc = Buffer.alloc(nSec * sec); o.entrees.copy(bloc, 0, 0, o.nb * o.te);
  const crcEntrees = crc32(o.entrees.subarray(0, o.nb * o.te)), lbaSecours = total - 1, lbaEntreesSecours = total - 1 - nSec;
  const entete = (moi: number, autre: number, lbaEntrees: number): Buffer => {
    const h = Buffer.alloc(sec); h.write('EFI PART', 0, 'latin1'); h.writeUInt32LE(0x00010000, 8); h.writeUInt32LE(92, 12);
    ecrireU64le(h, moi, 24); ecrireU64le(h, autre, 32); ecrireU64le(h, o.premier, 40); ecrireU64le(h, o.dernier, 48); guidOctets(o.guidDisque).copy(h, 56);
    ecrireU64le(h, lbaEntrees, 72); h.writeUInt32LE(o.nb, 80); h.writeUInt32LE(o.te, 84); h.writeUInt32LE(crcEntrees, 88);
    h.writeUInt32LE(crc32(h.subarray(0, 92)), 16); return h;
  };
  // Le premier secteur « protecteur » : une seule entrée de type EE qui couvre le disque ; le code de démarrage déjà là est gardé.
  const m = Buffer.alloc(512); o.actuel.copy(m, 0, 0, Math.min(446, o.actuel.length)); m.fill(0, 446);
  m[446] = 0; m.set([0x00, 0x02, 0x00], 447); m[450] = 0xee; m.set([0xff, 0xff, 0xff], 451); m.writeUInt32LE(1, 454); m.writeUInt32LE(Math.min(total - 1, 0xffffffff), 458); m[510] = 0x55; m[511] = 0xaa;
  return {
    mbr: { pos: 0, data: m, quoi: 'premier secteur (protection de la table GPT)' },
    principal: [{ pos: sec, data: entete(1, lbaSecours, 2), quoi: 'en-tête de la table GPT' }, { pos: 2 * sec, data: bloc, quoi: 'entrées de la table GPT' }],
    secours: [{ pos: lbaEntreesSecours * sec, data: bloc, quoi: 'copie de secours des entrées (fin du support)' }, { pos: lbaSecours * sec, data: entete(lbaSecours, 1, lbaEntreesSecours), quoi: 'copie de secours de l\'en-tête (fin du support)' }],
  };
}
/** Une table GPT neuve (128 entrées) pour ces partitions : premier secteur, table principale et copie de secours. */
export function construireGpt(o: { secteur: number; secteurs: number; partitions: Voulue[]; guidDisque?: string; actuel: Buffer }): Ecriture[] {
  const sec = o.secteur, nb = 128, te = 128, nSec = Math.ceil((nb * te) / sec), premier = 2 + nSec, dernier = o.secteurs - 2 - nSec;
  if (o.partitions.length > nb) throw new Error('trop de partitions');
  const tri = [...o.partitions].sort((a, b) => a.debut - b.debut), entrees = Buffer.alloc(nb * te);
  tri.forEach((p, i) => {
    if (p.debut < premier || p.debut + p.secteurs - 1 > dernier) throw new Error(`une partition ne laisse pas la place de la table GPT (elle doit tenir entre les secteurs ${premier} et ${dernier})`);
    if (i > 0 && p.debut < tri[i - 1].debut + tri[i - 1].secteurs) throw new Error('deux partitions se chevauchent');
    const e = i * te; guidOctets(p.type).copy(entrees, e); guidOctets(p.guid ?? randomUUID()).copy(entrees, e + 16);
    ecrireU64le(entrees, p.debut, e + 32); ecrireU64le(entrees, p.debut + p.secteurs - 1, e + 40); entrees.write((p.nom ?? '').slice(0, 35), e + 56, 'utf16le');
  });
  const g = gptDepuisEntrees({ secteur: sec, secteurs: o.secteurs, entrees, nb, te, guidDisque: o.guidDisque ?? randomUUID(), premier, dernier, actuel: o.actuel });
  return [g.mbr, ...g.principal, ...g.secours];
}
/**
 * Réparer une table GPT dont une des deux copies est intacte : la copie abîmée est refaite à l'identique à partir
 * de l'autre (mêmes partitions, mêmes identifiants). On n'écrit que le côté abîmé.
 */
export function reparerGpt(t: Table, actuel: Buffer): { ecritures: Ecriture[]; depuis: 'principale' | 'secours' } | undefined {
  const p = t.gpt.principal, s = t.gpt.secours, bon = p.entreesJustes ? p : s.entreesJustes ? s : undefined;
  if (!bon?.entrees || !bon.nb || !bon.tailleEntree || !bon.guid) return undefined;
  const nSec = Math.ceil((bon.nb * bon.tailleEntree) / t.secteur);
  const g = gptDepuisEntrees({ secteur: t.secteur, secteurs: t.secteurs, entrees: bon.entrees, nb: bon.nb, te: bon.tailleEntree, guidDisque: bon.guid, premier: bon.premier ?? 2 + nSec, dernier: bon.dernier ?? t.secteurs - 2 - nSec, actuel });
  const e: Ecriture[] = [];
  if (!t.mbr.protecteur) e.push(g.mbr);
  if (!p.entreesJustes) e.push(...g.principal);
  if (!s.entreesJustes || s.lba !== t.secteurs - 1) e.push(...g.secours);
  return e.length ? { ecritures: e, depuis: p.entreesJustes ? 'principale' : 'secours' } : undefined;
}
