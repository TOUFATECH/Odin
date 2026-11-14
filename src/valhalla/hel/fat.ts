// Perséphone · FAT12/16/32 et exFAT : lire la géométrie d'un volume, et retrouver les fichiers effacés AVEC leur nom.
// Sur ces systèmes, effacer un fichier ne fait que marquer son entrée de dossier (premier octet à E5 sur FAT, bit
// « en service » retiré sur exFAT) et libérer ses grappes : le nom, la taille et la première grappe restent écrits
// tant que rien n'est venu par-dessus. On relit donc les dossiers, on repère ces entrées, et on reprend les grappes
// encore libres. Lecture seule. Formats : spécification FAT de Microsoft (fatgen103) et spécification exFAT.
import { champ, propre, u64le } from './octets.ts';
import type { Lecteur } from './support.ts';

// ---------------------------------------------------------------- géométrie
export interface Bpb {
  bits: 12 | 16 | 32; bps: number; spc: number; reserves: number; nbFat: number; entreesRacine: number; secteurs: number; media: number; tailleFat: number;
  /** FAT32 : grappe du dossier racine, et secteur où est rangée la copie du secteur de démarrage */
  racine: number; copie: number;
  premierSecteurDonnees: number; grappes: number; etiquette?: string; serie?: string;
}
/** Le premier secteur d'un volume FAT : rend sa géométrie si les nombres se tiennent, sinon rien. Pur. */
export function lireBpb(b: Buffer): Bpb | undefined {
  if (b.length < 512 || b[510] !== 0x55 || b[511] !== 0xaa || !(b[0] === 0xeb || b[0] === 0xe9)) return undefined;
  const bps = b.readUInt16LE(11), spc = b[13], reserves = b.readUInt16LE(14), nbFat = b[16], entreesRacine = b.readUInt16LE(17), media = b[21], fat16 = b.readUInt16LE(22);
  const pow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
  if (![512, 1024, 2048, 4096].includes(bps) || !pow2(spc) || reserves < 1 || nbFat < 1 || nbFat > 2 || !(media === 0xf0 || media >= 0xf8)) return undefined;
  const tailleFat = fat16 || b.readUInt32LE(36), secteurs = b.readUInt16LE(19) || b.readUInt32LE(32); if (!tailleFat || !secteurs) return undefined;
  const racineSecteurs = Math.ceil((entreesRacine * 32) / bps), premierSecteurDonnees = reserves + nbFat * tailleFat + racineSecteurs, grappes = Math.floor((secteurs - premierSecteurDonnees) / spc);
  if (grappes < 1) return undefined;
  const bits = grappes < 4085 ? 12 : grappes < 65525 ? 16 : 32;
  if (bits === 32 ? (fat16 !== 0 || entreesRacine !== 0) : (fat16 === 0 || entreesRacine === 0)) return undefined;
  // La table d'allocation doit pouvoir porter toutes les grappes.
  if (tailleFat * bps < Math.ceil(((grappes + 2) * bits) / 8)) return undefined;
  const racine = bits === 32 ? b.readUInt32LE(44) : 0; if (bits === 32 && (racine < 2 || racine >= grappes + 2)) return undefined;
  const o = bits === 32 ? 64 : 36, signe = b[o + 2] === 0x29 || b[o + 2] === 0x28;
  return { bits, bps, spc, reserves, nbFat, entreesRacine, secteurs, media, tailleFat, racine, copie: bits === 32 ? b.readUInt16LE(50) : 0, premierSecteurDonnees, grappes,
    ...(signe && champ(b, o + 7, 11) ? { etiquette: champ(b, o + 7, 11) } : {}), ...(signe ? { serie: b.readUInt32LE(o + 3).toString(16).toUpperCase().padStart(8, '0').replace(/^(....)/, '$1-') } : {}) };
}
export interface Exfat { bps: number; spc: number; secteurs: number; debutFat: number; tailleFat: number; debutGrappes: number; grappes: number; racine: number; serie: string }
/** Le premier secteur d'un volume exFAT. Pur. */
export function lireExfat(b: Buffer): Exfat | undefined {
  if (b.length < 512 || b.toString('latin1', 3, 11) !== 'EXFAT   ' || b[510] !== 0x55 || b[511] !== 0xaa) return undefined;
  for (let i = 11; i < 64; i++) if (b[i] !== 0) return undefined;
  const dBps = b[108], dSpc = b[109]; if (dBps < 9 || dBps > 12 || dSpc > 25 - dBps || b[110] < 1 || b[110] > 2) return undefined;
  const secteurs = u64le(b, 72), debutFat = b.readUInt32LE(80), tailleFat = b.readUInt32LE(84), debutGrappes = b.readUInt32LE(88), grappes = b.readUInt32LE(92), racine = b.readUInt32LE(96);
  if (!Number.isFinite(secteurs) || debutFat < 24 || !tailleFat || debutGrappes < debutFat + tailleFat || !grappes || racine < 2 || racine > grappes + 1) return undefined;
  if (debutGrappes + grappes * 2 ** dSpc > secteurs) return undefined;
  return { bps: 2 ** dBps, spc: 2 ** dSpc, secteurs, debutFat, tailleFat, debutGrappes, grappes, racine, serie: b.readUInt32LE(100).toString(16).toUpperCase().padStart(8, '0').replace(/^(....)/, '$1-') };
}
/** La somme de contrôle de la zone de démarrage d'exFAT (11 premiers secteurs, sauf trois octets qui changent). Pur. */
export function sommeExfat(zone: Buffer, bps: number): number {
  let s = 0; const n = 11 * bps;
  for (let i = 0; i < n; i++) { if (i === 106 || i === 107 || i === 112) continue; s = (((s & 1) ? 0x80000000 : 0) + (s >>> 1) + zone[i]) >>> 0; }
  return s;
}

// ---------------------------------------------------------------- fichiers effacés, avec leur nom
export interface Efface {
  /** dossier d'origine (« DCIM/100CANON ») et nom du fichier */
  chemin: string; nom: string; taille: number;
  /** où sont ses octets dans le volume : [position, longueur] */
  morceaux: Array<[number, number]>;
  /** « récupérable » : ses grappes sont libres et se suivent ; « incertain » : en plusieurs morceaux ou en partie repris ; « écrasé » : sa place a été reprise */
  etat: 'récupérable' | 'incertain' | 'écrasé';
  note?: string;
  /** date de dernière modification écrite dans l'entrée */
  modifie?: string;
}
export interface OptionsEffaces {
  /** au plus tant de fichiers (protège la mémoire) */
  max?: number; arret?: { stop: boolean };
  /** le début d'un fichier ressemble-t-il à ce que son nom annonce ? (rien : on ne sait pas dire) */
  signature?(nom: string, tete: Buffer): boolean | undefined;
}
const nomSur = (t: string) => propre(t, 200).replace(/[/\\:*?"<>|]/g, '_').replace(/^\.+$/, '_') || '_';
const dateDos = (d: number, t: number): string | undefined => { const a = (d >> 9) + 1980, m = (d >> 5) & 15, j = d & 31; if (!m || !j || m > 12) return undefined; const p = (n: number) => String(n).padStart(2, '0'); return `${a}-${p(m)}-${p(j)} ${p((t >> 11) & 31)}:${p((t >> 5) & 63)}`; };
/** Range des grappes en morceaux qui se suivent : [position en octets, longueur], bornés à la taille du fichier. */
function enMorceaux(grappes: number[], pos: (c: number) => number, octets: number, taille: number): Array<[number, number]> {
  const out: Array<[number, number]> = []; let reste = taille;
  for (let i = 0; i < grappes.length && reste > 0; i++) {
    const n = Math.min(octets, reste), p = pos(grappes[i]), d = out.at(-1);
    if (d && d[0] + d[1] === p) d[1] += n; else out.push([p, n]);
    reste -= n;
  }
  return out;
}
/** Une table lue par pages, avec quelques pages gardées en mémoire (une table d'allocation peut peser des centaines de Mo). */
function parPages(l: Lecteur, debut: number, longueur: number) {
  const PAGE = 65536, pages = new Map<number, Buffer>();
  const page = async (n: number) => { let p = pages.get(n); if (!p) { p = await l.lire(debut + n * PAGE, Math.min(PAGE + 8, longueur - n * PAGE)); if (pages.size >= 96) pages.delete(pages.keys().next().value!); pages.set(n, p); } return p; };
  return async (o: number, n: number): Promise<Buffer | undefined> => { if (o < 0 || o + n > longueur) return undefined; const p = await page(Math.floor(o / PAGE)), d = o % PAGE; return d + n <= p.length ? p.subarray(d, d + n) : undefined; };
}

/** Les fichiers effacés d'un volume FAT12, FAT16 ou FAT32 (`l` : le volume, depuis son premier secteur). */
export async function effacesFat(l: Lecteur, o: OptionsEffaces = {}): Promise<Efface[]> {
  const g = lireBpb(await l.lire(0, 512)); if (!g) throw new Error('ce n\'est pas un volume FAT lisible');
  const octets = g.bps * g.spc, max = o.max ?? 20000, out: Efface[] = [], finChaine = g.bits === 12 ? 0xff8 : g.bits === 16 ? 0xfff8 : 0x0ffffff8;
  const table = parPages(l, g.reserves * g.bps, g.tailleFat * g.bps);
  const entree = async (c: number): Promise<number> => {
    if (c < 2 || c >= g.grappes + 2) return finChaine;
    if (g.bits === 12) { const b = await table(c + (c >> 1), 2); return b ? (c & 1 ? b.readUInt16LE(0) >> 4 : b.readUInt16LE(0) & 0xfff) : finChaine; }
    const b = await table(c * (g.bits / 8), g.bits / 8); return !b ? finChaine : g.bits === 16 ? b.readUInt16LE(0) : b.readUInt32LE(0) & 0x0fffffff;
  };
  const pos = (c: number) => (g.premierSecteurDonnees + (c - 2) * g.spc) * g.bps;
  /** Le contenu d'un dossier en service : on suit sa chaîne de grappes. */
  const chaine = async (c: number): Promise<Buffer> => { const morceaux: Buffer[] = [], vues = new Set<number>(); while (c >= 2 && c < g.grappes + 2 && !vues.has(c) && morceaux.length < 2048) { vues.add(c); morceaux.push(await l.lire(pos(c), octets)); c = await entree(c); if (c >= finChaine || c === 0) break; } return Buffer.concat(morceaux); };
  /** Le contenu d'un dossier effacé : sa chaîne a disparu, on prend les grappes libres qui suivent tant qu'elles ressemblent à un dossier. */
  const dossierEfface = async (c: number): Promise<Buffer> => { const morceaux: Buffer[] = []; while (c >= 2 && c < g.grappes + 2 && morceaux.length < 64 && await entree(c) === 0) { const b = await l.lire(pos(c), octets); if (!morceaux.length && !(b[0] === 0x2e && b[11] & 0x10)) break; morceaux.push(b); if (b[octets - 32] === 0) break; c++; } return Buffer.concat(morceaux); };
  const faits = new Set<number>();
  const parcours = async (d: Buffer, chemin: string, niveau: number): Promise<void> => {
    let longs: string[] = [], longsEffaces = false;
    for (let i = 0; i + 32 <= d.length; i += 32) {
      if (out.length >= max || o.arret?.stop) return;
      const e = d.subarray(i, i + 32), premier = e[0], attr = e[11]; if (premier === 0) break;
      if (attr === 0x0f) {
        // Un morceau de nom long (13 caractères), rangé avant l'entrée courte, le dernier morceau en premier.
        const u = Buffer.concat([e.subarray(1, 11), e.subarray(14, 26), e.subarray(28, 32)]); let n = 0; while (n < 26 && !(u[n] === 0 && u[n + 1] === 0) && !(u[n] === 0xff && u[n + 1] === 0xff)) n += 2;
        if (!longs.length) longsEffaces = premier === 0xe5; longs.push(u.subarray(0, n).toString('utf16le')); continue;
      }
      const efface = premier === 0xe5, long = longs.length && longsEffaces === efface ? longs.reverse().join('') : ''; longs = [];
      if (attr & 0x08) continue;
      const base = e.subarray(0, 8).toString('latin1').trimEnd(), ext = e.subarray(8, 11).toString('latin1').trimEnd();
      const court = `${e[12] & 0x08 ? base.toLowerCase() : base}${ext ? `.${e[12] & 0x10 ? ext.toLowerCase() : ext}` : ''}`;
      // Le premier caractère d'un nom court effacé est perdu (remplacé par la marque) : « _ » à sa place.
      const nom = nomSur(long || (efface ? `_${court.slice(1)}` : court)), grappe = (g.bits === 32 ? e.readUInt16LE(20) * 65536 : 0) + e.readUInt16LE(26), taille = e.readUInt32LE(28);
      if (attr & 0x10) {
        if (base === '.' || base === '..' || niveau >= 24 || grappe < 2 || faits.has(grappe)) continue; faits.add(grappe);
        await parcours(efface ? await dossierEfface(grappe) : await chaine(grappe), chemin ? `${chemin}/${nom}` : nom, niveau + 1); continue;
      }
      if (!efface || taille === 0) continue;
      const f: Efface = { chemin, nom, taille, morceaux: [], etat: 'écrasé', ...(dateDos(e.readUInt16LE(24), e.readUInt16LE(22)) ? { modifie: dateDos(e.readUInt16LE(24), e.readUInt16LE(22)) } : {}) };
      let c = grappe;
      // FAT32 : certains systèmes remettent à zéro la moitié haute du numéro de grappe en effaçant. Si le début ne
      // ressemble pas à ce que le nom annonce, on essaie les autres moitiés hautes possibles.
      if (g.bits === 32 && grappe < 65536 && g.grappes + 2 > 65536 && o.signature) {
        const va = async (x: number) => x >= 2 && x < g.grappes + 2 && await entree(x) === 0 && o.signature!(nom, await l.lire(pos(x), 64));
        if (await va(c) === false || (c >= 2 && await entree(c) !== 0)) { for (let h = 1; h * 65536 + grappe < g.grappes + 2; h++) if (await va(h * 65536 + grappe) === true) { c = h * 65536 + grappe; f.note = 'première grappe retrouvée par son contenu'; break; } }
      }
      if (c < 2 || c >= g.grappes + 2) { f.note = 'son emplacement n\'est plus lisible'; out.push(f); continue; }
      if (await entree(c) !== 0) { f.note = 'sa place a été reprise par un autre fichier'; out.push(f); continue; }
      const besoin = Math.ceil(taille / octets), prises: number[] = []; let sauts = 0;
      for (let x = c; prises.length < besoin && x < g.grappes + 2; x++) { if (await entree(x) === 0) prises.push(x); else sauts++; }
      f.morceaux = enMorceaux(prises, pos, octets, taille);
      if (prises.length < besoin) { f.etat = 'incertain'; f.note = 'il manque la fin (plus assez de place libre après son début)'; }
      else if (sauts) { f.etat = 'incertain'; f.note = 'il était peut-être rangé en plusieurs morceaux : contenu à vérifier'; }
      else f.etat = 'récupérable';
      out.push(f);
    }
  };
  const racine = g.bits === 32 ? await chaine(g.racine) : await l.lire((g.reserves + g.nbFat * g.tailleFat) * g.bps, g.entreesRacine * 32);
  await parcours(racine, '', 0);
  return out;
}

/** Les fichiers effacés d'un volume exFAT (`l` : le volume, depuis son premier secteur). */
export async function effacesExfat(l: Lecteur, o: OptionsEffaces = {}): Promise<Efface[]> {
  const g = lireExfat(await l.lire(0, 512)); if (!g) throw new Error('ce n\'est pas un volume exFAT lisible');
  const octets = g.bps * g.spc, max = o.max ?? 20000, out: Efface[] = [];
  const table = parPages(l, g.debutFat * g.bps, g.tailleFat * g.bps);
  const suivante = async (c: number) => { const b = await table(c * 4, 4); return b ? b.readUInt32LE(0) : 0xffffffff; };
  const pos = (c: number) => (g.debutGrappes + (c - 2) * g.spc) * g.bps, valide = (c: number) => c >= 2 && c < g.grappes + 2;
  const contenu = async (c: number, longueur: number, sansChaine: boolean): Promise<Buffer> => {
    const morceaux: Buffer[] = [], vues = new Set<number>(), nb = Math.min(4096, Math.ceil(longueur / octets) || 4096);
    while (valide(c) && !vues.has(c) && morceaux.length < nb) { vues.add(c); morceaux.push(await l.lire(pos(c), octets)); c = sansChaine ? c + 1 : await suivante(c); }
    return Buffer.concat(morceaux);
  };
  const racine = await contenu(g.racine, 0, false);
  // La carte des grappes occupées (un bit par grappe) : son entrée est dans le dossier racine.
  let libre = async (_c: number): Promise<boolean> => true;
  for (let i = 0; i + 32 <= racine.length && racine[i] !== 0; i += 32) if (racine[i] === 0x81) {
    const c = racine.readUInt32LE(i + 20), n = u64le(racine, i + 24); if (!valide(c) || !Number.isFinite(n)) break;
    const carte = parPages(l, pos(c), n); libre = async (x) => { const b = await carte((x - 2) >> 3, 1); return b ? (b[0] & (1 << ((x - 2) & 7))) === 0 : false; }; break;
  }
  const faits = new Set<number>();
  const parcours = async (d: Buffer, chemin: string, niveau: number): Promise<void> => {
    for (let i = 0; i + 32 <= d.length; i += 32) {
      if (out.length >= max || o.arret?.stop) return;
      const type = d[i]; if (type === 0) break; if ((type & 0x7f) !== 0x05) continue;
      // Une entrée « fichier » (en service : 85, effacée : 05), suivie de sa suite (C0 / 40) puis de son nom (C1 / 41).
      const efface = !(type & 0x80), secondaires = d[i + 1], attr = d.readUInt16LE(i + 4), s = i + 32;
      if (secondaires < 2 || s + secondaires * 32 > d.length || (d[s] & 0x7f) !== 0x40 || Boolean(d[s] & 0x80) === efface) continue;
      const sansChaine = Boolean(d[s + 1] & 0x02), longueurNom = d[s + 3], grappe = d.readUInt32LE(s + 20), taille = u64le(d, s + 24);
      let nom = ''; for (let k = 1; k < secondaires && nom.length < longueurNom; k++) { const n = s + k * 32; if ((d[n] & 0x7f) !== 0x41) break; nom += d.subarray(n + 2, n + 32).toString('utf16le'); }
      nom = nomSur(nom.slice(0, longueurNom).replace(/\0.*$/s, '')); i += secondaires * 32;
      if (!Number.isFinite(taille)) continue;
      if (attr & 0x10) {
        if (niveau >= 24 || !valide(grappe) || faits.has(grappe) || (efface && !await libre(grappe))) continue; faits.add(grappe);
        await parcours(await contenu(grappe, taille, sansChaine || efface), chemin ? `${chemin}/${nom}` : nom, niveau + 1); continue;
      }
      if (!efface || taille === 0) continue;
      const t = d.readUInt32LE(i - secondaires * 32 + 12), f: Efface = { chemin, nom, taille, morceaux: [], etat: 'écrasé', ...(dateDos(t >>> 16, t & 0xffff) ? { modifie: dateDos(t >>> 16, t & 0xffff) } : {}) };
      if (!valide(grappe)) { f.note = 'son emplacement n\'est plus lisible'; out.push(f); continue; }
      if (!await libre(grappe)) { f.note = 'sa place a été reprise par un autre fichier'; out.push(f); continue; }
      const besoin = Math.ceil(taille / octets), prises: number[] = []; let sauts = 0, suivi = false;
      if (!sansChaine) {
        // Le fichier était en plusieurs morceaux : sa chaîne est peut-être encore écrite dans la table.
        const vues = new Set<number>(); let c = grappe;
        while (valide(c) && !vues.has(c) && await libre(c) && prises.length < besoin) { vues.add(c); prises.push(c); c = await suivante(c); }
        if (prises.length === besoin) suivi = true; else prises.length = 0;
      }
      if (!suivi) for (let x = grappe; prises.length < besoin && valide(x); x++) { if (await libre(x)) prises.push(x); else sauts++; }
      f.morceaux = enMorceaux(prises, pos, octets, taille);
      if (prises.length < besoin) { f.etat = 'incertain'; f.note = 'il manque la fin (plus assez de place libre après son début)'; }
      else if (sauts || (!sansChaine && !suivi)) { f.etat = 'incertain'; f.note = 'il était peut-être rangé en plusieurs morceaux : contenu à vérifier'; }
      else f.etat = 'récupérable';
      out.push(f);
    }
  };
  await parcours(racine, '', 0);
  return out;
}
