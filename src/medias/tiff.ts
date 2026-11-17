// Médias reçus : TIFF / BigTIFF / EXIF / GPS / Interop / IFD1 (vignette) / SubIFD (RAW), d'après TIFF 6.0 et Exif
// 2.32/3.0. Décalages relatifs au début du bloc TIFF ; chaque IFD visité une seule fois (une boucle est évitée) ;
// compte × taille vérifié avant toute lecture. Les valeurs codées sont traduites par des tables fermées.

import type { Contexte, FicheEnCours } from './contrat.ts';
import { ErreurFormat } from './contrat.ts';
import { ajouterChamp, ajouterDate, ajouterImage, ajouterManque, candidatPosition, candidatPrise, remarque } from './champs.ts';
import { dateDepuisParties, instantNaif, lireDateExif, partiesDe } from './dates.ts';
import { creerPosition, degresDepuisDms } from './lieux.ts';
import { decimal, nettoyerTexte } from './octets.ts';
import { lireXmp } from './xmp.ts';
import { lire8bim, lireIptc } from './iptc.ts';

const TAILLE_TYPE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 };

interface Entree { tag: number; type: number; count: number; pos: number; taille: number }

export const ORIENTATIONS: Record<number, string> = {
  1: 'normale', 2: 'miroir horizontal', 3: 'tournée de 180°', 4: 'miroir vertical', 5: 'miroir + 270°',
  6: 'tournée de 90° (sens horaire)', 7: 'miroir + 90°', 8: 'tournée de 270° (sens horaire)',
};
const PROGRAMMES: Record<number, string> = { 0: 'non défini', 1: 'manuel', 2: 'programme normal', 3: 'priorité à l\'ouverture', 4: 'priorité à la vitesse', 5: 'créatif', 6: 'action', 7: 'portrait', 8: 'paysage' };
const MESURES: Record<number, string> = { 0: 'inconnue', 1: 'moyenne', 2: 'pondérée centrale', 3: 'spot', 4: 'multi-spot', 5: 'matricielle', 6: 'partielle', 255: 'autre' };
const BALANCES: Record<number, string> = { 0: 'automatique', 1: 'manuelle' };
const MODES: Record<number, string> = { 0: 'automatique', 1: 'manuel', 2: 'bracketing automatique' };
const SCENES: Record<number, string> = { 0: 'standard', 1: 'paysage', 2: 'portrait', 3: 'scène de nuit' };
const table = (t: Record<number, string>, n: number | undefined) => (n === undefined ? undefined : t[n] ?? `code ${n}`);

const RETOUCHE = ['photoshop', 'lightroom', 'gimp', 'snapseed', 'affinity', 'pixelmator', 'picsart', 'canva'];

/** Des octets ASCII imprimables terminés par NUL ? */
function texteEnLigne(b: Buffer, p: number, n: number): boolean {
  for (let i = 0; i < n - 1; i++) { const c = b[p + i]; if (c < 0x20 || c > 0x7e) return false; }
  return b[p + n - 1] === 0;
}

/** Une coupure de lecture : la fiche devient partielle (première raison gardée) et une remarque est écrite. */
export function coupure(f: FicheEnCours, raison: string): void {
  if (!f.partiel) f.partiel = raison;
  remarque(f, raison);
}

export interface InfoTiff { marque?: string; modele?: string; dng: boolean; lu: boolean }

/** Lit un bloc TIFF complet (EXIF d'un JPEG, eXIf d'un PNG, TIFF entier…). `base` = position du bloc dans le fichier. */
export function lireTiff(b: Buffer, f: FicheEnCours, ctx: Contexte, origine = 'EXIF', base = 0): InfoTiff {
  const info: InfoTiff = { dng: false, lu: false };
  if (b.length < 8) throw new ErreurFormat('bloc TIFF trop court');
  const le = b[0] === 0x49 && b[1] === 0x49;
  if (!le && !(b[0] === 0x4d && b[1] === 0x4d)) throw new ErreurFormat('en-tête TIFF invalide');
  const u16 = (p: number) => { if (p < 0 || p + 2 > b.length) throw new ErreurFormat('lecture hors limite'); return le ? b.readUInt16LE(p) : b.readUInt16BE(p); };
  const u32 = (p: number) => { if (p < 0 || p + 4 > b.length) throw new ErreurFormat('lecture hors limite'); return le ? b.readUInt32LE(p) : b.readUInt32BE(p); };
  const u64 = (p: number) => {
    if (p < 0 || p + 8 > b.length) throw new ErreurFormat('lecture hors limite');
    const v = le ? b.readBigUInt64LE(p) : b.readBigUInt64BE(p);
    if (v > BigInt(b.length)) throw new ErreurFormat('décalage 64 bits hors du bloc');
    return Number(v);
  };
  const magie = u16(2);
  const big = magie === 43;
  if (magie !== 42 && !big) throw new ErreurFormat('en-tête TIFF invalide');
  if (big && (u16(4) !== 8 || u16(6) !== 0)) throw new ErreurFormat('en-tête BigTIFF invalide');
  const bornes = ctx.budget.bornes;
  const vus = new Set<number>();
  let ifdLus = 0;

  const lireIfd = (off: number, nom: string): { entrees: Map<number, Entree>; suivant: number } | undefined => {
    if (!off) return undefined;
    if (vus.has(off)) { coupure(f, `${origine} : boucle de décalages évitée (${nom})`); return undefined; }
    if (off < 8 || off >= b.length) { coupure(f, `${origine} : IFD hors du bloc (${nom})`); return undefined; }
    if (++ifdLus > bornes.ifd) { coupure(f, `${origine} : plus de ${bornes.ifd} IFD`); return undefined; }
    vus.add(off);
    ctx.budget.profondeur(ifdLus);
    const n = big ? u64(off) : u16(off);
    const tailleEntree = big ? 20 : 12, debut = off + (big ? 8 : 2);
    if (n > bornes.ifdEntrees) throw new ErreurFormat(`${origine} : IFD de ${n} entrées (au plus ${bornes.ifdEntrees})`);
    if (debut + n * tailleEntree > b.length) throw new ErreurFormat(`${origine} : IFD plus long que le bloc`);
    const entrees = new Map<number, Entree>();
    for (let i = 0; i < n; i++) {
      ctx.budget.pas();
      const p = debut + i * tailleEntree;
      const tag = u16(p), type = u16(p + 2), count = big ? u64(p + 4) : u32(p + 4);
      const t = TAILLE_TYPE[type];
      if (!t) continue;
      const taille = count * t;
      const enLigne = big ? 8 : 4;
      let pos: number;
      if (taille <= enLigne) {
        pos = p + (big ? 12 : 8);
        // Tolérance : texte court écrit par décalage (contraire à TIFF 6.0, mais vu dans des fichiers fabriqués).
        if (type === 2 && !big && count > 1 && !texteEnLigne(b, pos, count)) {
          const o = u32(pos);
          if (o >= 8 && o + count <= b.length && b[o + count - 1] === 0 && texteEnLigne(b, o, count)) { pos = o; remarque(f, `${origine} : étiquette 0x${tag.toString(16)} mal écrite (texte court par décalage)`); }
        }
      } else {
        pos = big ? u64(p + 12) : u32(p + 8);
        if (pos + taille > b.length || pos < 0) throw new ErreurFormat(`${origine} : étiquette 0x${tag.toString(16)} : compte × taille plus grand que le bloc`);
      }
      entrees.set(tag, { tag, type, count, pos, taille });
    }
    const suivant = debut + n * tailleEntree + (big ? 8 : 4) <= b.length ? (big ? u64(debut + n * tailleEntree) : u32(debut + n * tailleEntree)) : 0;
    return { entrees, suivant };
  };

  // Valeurs.
  const nums = (e: Entree | undefined, max = 64): number[] => {
    if (!e) return [];
    const r: number[] = [], t = TAILLE_TYPE[e.type];
    for (let i = 0; i < Math.min(e.count, max); i++) {
      const p = e.pos + i * t;
      switch (e.type) {
        case 1: case 7: r.push(b[p]); break;
        case 6: r.push(b.readInt8(p)); break;
        case 3: r.push(u16(p)); break;
        case 8: r.push(le ? b.readInt16LE(p) : b.readInt16BE(p)); break;
        case 4: case 13: r.push(u32(p)); break;
        case 9: r.push(le ? b.readInt32LE(p) : b.readInt32BE(p)); break;
        case 11: r.push(le ? b.readFloatLE(p) : b.readFloatBE(p)); break;
        case 12: r.push(le ? b.readDoubleLE(p) : b.readDoubleBE(p)); break;
        case 16: case 18: r.push(u64(p)); break;
        default: break;
      }
    }
    return r;
  };
  const num = (e: Entree | undefined) => nums(e, 1)[0];
  let denNul = false;
  const rats = (e: Entree | undefined, max = 8): Array<number | undefined> => {
    if (!e || (e.type !== 5 && e.type !== 10)) return e ? nums(e, max) : [];
    const r: Array<number | undefined> = [];
    for (let i = 0; i < Math.min(e.count, max); i++) {
      const p = e.pos + i * 8;
      const a = e.type === 5 ? u32(p) : (le ? b.readInt32LE(p) : b.readInt32BE(p));
      const d = e.type === 5 ? u32(p + 4) : (le ? b.readInt32LE(p + 4) : b.readInt32BE(p + 4));
      if (d === 0) { denNul = true; r.push(undefined); } else r.push(a / d);
    }
    return r;
  };
  const rat = (e: Entree | undefined) => rats(e, 1)[0];
  const octets = (e: Entree | undefined) => (e ? b.subarray(e.pos, e.pos + e.taille) : Buffer.alloc(0));
  const ascii = (e: Entree | undefined): { t: string; douteux: boolean; brut: Buffer } => {
    const brut = octets(e);
    const u = nettoyerTexte(brut, 'utf-8', { nul: true });
    if (!u.encodageDouteux) return { t: u.texte, douteux: false, brut };
    return { t: nettoyerTexte(brut, 'latin1', { nul: true }).texte, douteux: true, brut };
  };
  const texte = (cle: string, e: Entree | undefined, tag: number, o: { sensible?: boolean } = {}) => {
    if (!e) return;
    const a = ascii(e);
    ajouterChamp(f, ctx, cle, a.t, `${origine}:0x${tag.toString(16).padStart(4, '0').toUpperCase()}`, { encodageDouteux: a.douteux, sensible: o.sensible });
  };
  const src = (tag: number) => `${origine}:0x${tag.toString(16).padStart(4, '0').toUpperCase()}`;

  // IFD0 et sa chaîne.
  const premier = big ? u64(8) : u32(4);
  const ifd0 = lireIfd(premier, 'IFD0');
  if (!ifd0) throw new ErreurFormat(`${origine} : aucun IFD lisible`);
  const e0 = ifd0.entrees;
  const ifd1 = ifd0.suivant ? lireIfd(ifd0.suivant, 'IFD1') : undefined;
  // Les IFD suivants (pages) sont seulement comptés.
  let suivant = ifd1?.suivant ?? 0, pages = ifd1 ? 2 : 1;
  while (suivant && pages < bornes.ifd) { const x = lireIfd(suivant, `IFD${pages}`); if (!x) break; pages++; suivant = x.suivant; }
  if (pages > 2) remarque(f, `${pages} images dans le TIFF`);
  const sous = (tag: number, nom: string) => { const o = num(e0.get(tag)); return o ? lireIfd(o, nom)?.entrees : undefined; };
  const eExif = sous(0x8769, 'Exif') ?? new Map<number, Entree>();
  const eGps = sous(0x8825, 'GPS');
  const eInterop = eExif.has(0xa005) ? (() => { const o = num(eExif.get(0xa005)); return o ? lireIfd(o, 'Interop')?.entrees : undefined; })() : undefined;
  if (eInterop?.has(1)) ajouterChamp(f, ctx, 'x:interop', ascii(eInterop.get(1)).t, `${origine}:Interop`, { nom: 'Interopérabilité', groupe: 'technique' });
  info.lu = true;

  // Appareil, logiciel, textes.
  const marque = e0.has(0x010f) ? ascii(e0.get(0x010f)).t : undefined;
  const modele = e0.has(0x0110) ? ascii(e0.get(0x0110)).t : undefined;
  info.marque = marque; info.modele = modele;
  texte('appareil_marque', e0.get(0x010f), 0x010f);
  texte('appareil_modele', e0.get(0x0110), 0x0110);
  texte('description', e0.get(0x010e), 0x010e);
  texte('artiste', e0.get(0x013b), 0x013b);
  if (e0.has(0x0131)) {
    const l = ascii(e0.get(0x0131)).t;
    texte('logiciel', e0.get(0x0131), 0x0131);
    const bas = l.toLowerCase();
    const r = RETOUCHE.find((x) => bas.includes(x));
    if (r) remarque(f, `image passée par ${l} (retouche possible)`);
  }
  if (e0.has(0x8298)) {
    const brut = octets(e0.get(0x8298));
    const k = brut.indexOf(0);
    const photographe = nettoyerTexte(k >= 0 ? brut.subarray(0, k) : brut, 'utf-8').texte;
    const editeur = k >= 0 ? nettoyerTexte(brut.subarray(k + 1), 'utf-8', { nul: true }).texte : '';
    const v = [photographe, editeur ? `éditeur : ${editeur}` : ''].filter(Boolean).join(' ; ');
    if (v) ajouterChamp(f, ctx, 'droits', v, src(0x8298));
  }
  const xp = (cle: string, tag: number) => {
    const e = e0.get(tag); if (!e) return;
    const t = nettoyerTexte(octets(e), 'utf-16le', { nul: true }).texte;
    if (!t) return;
    if (cle === 'mots_cles') ajouterChamp(f, ctx, cle, t, src(tag), { valeurs: t.split(';').map((x) => x.trim()) });
    else ajouterChamp(f, ctx, cle, t, src(tag));
  };
  xp('titre', 0x9c9b); xp('commentaire', 0x9c9c); xp('artiste', 0x9c9d); xp('mots_cles', 0x9c9e);
  if (e0.has(0x9c9f)) { const t = nettoyerTexte(octets(e0.get(0x9c9f)), 'utf-16le', { nul: true }).texte; if (t) ajouterChamp(f, ctx, 'x:sujet', t, src(0x9c9f), { nom: 'Sujet', groupe: 'œuvre' }); }

  // Orientation.
  const or = num(e0.get(0x0112));
  if (or !== undefined) {
    if (ORIENTATIONS[or]) { f.orientation = { code: or, texte: ORIENTATIONS[or] }; ajouterChamp(f, ctx, 'orientation', ORIENTATIONS[or], src(0x0112), { brut: or }); }
    else remarque(f, `orientation inconnue (code ${or})`);
  }

  // Dimensions (TIFF/RAW : la plus grande des IFD0 et SubIFD ; sinon PixelXDimension de l'EXIF).
  let L = num(e0.get(0x0100)), H = num(e0.get(0x0101));
  const subs = nums(e0.get(0x014a), bornes.subIfd);
  for (const [i, o] of subs.entries()) {
    const s = lireIfd(o, `SubIFD${i}`)?.entrees;
    const l = num(s?.get(0x0100)), h = num(s?.get(0x0101));
    if (l && h && (!L || !H || l * h > L * H)) { L = l; H = h; }
  }
  if (!L || !H) { L = num(eExif.get(0xa002)); H = num(eExif.get(0xa003)); }
  if (L && H && L < 1_000_000 && H < 1_000_000 && !f.largeur) { f.largeur = L; f.hauteur = H; }
  const bits = nums(e0.get(0x0102), 8);
  if (bits.length && origine === 'TIFF') ajouterChamp(f, ctx, 'profondeur_couleurs', `${bits.length} composante(s) de ${bits[0]} bits`, src(0x0102));
  if (e0.has(0xc612)) { info.dng = true; ajouterChamp(f, ctx, 'x:dng', nums(e0.get(0xc612), 4).join('.'), src(0xc612), { nom: 'Version DNG', groupe: 'technique' }); }

  // Blocs inclus : XMP, IPTC, ressources Photoshop.
  if (e0.has(0x02bc)) { try { lireXmp(nettoyerTexte(octets(e0.get(0x02bc)), 'utf-8', { max: bornes.xmp }).texte, f, ctx, 'XMP'); } catch (e) { coupure(f, `XMP : ${(e as Error).message}`); } }
  if (e0.has(0x83bb)) { try { lireIptc(octets(e0.get(0x83bb)), f, ctx); } catch (e) { coupure(f, `IPTC : ${(e as Error).message}`); } }
  if (e0.has(0x8649)) { try { lire8bim(octets(e0.get(0x8649)), f, ctx); } catch (e) { coupure(f, `Photoshop : ${(e as Error).message}`); } }

  // Dates.
  const m = ctx.maintenant;
  const fuseauDe = (tag: number) => (eExif.has(tag) ? ascii(eExif.get(tag)).t : undefined);
  const sousSec = (tag: number) => (eExif.has(tag) ? ascii(eExif.get(tag)).t : undefined);
  // L'heure d'enregistrement par l'appareil dit, le plus souvent, l'heure de la prise de vue : elle est sensible.
  if (e0.has(0x0132)) ajouterDate(f, ctx, 'date_modification', lireDateExif(ascii(e0.get(0x0132)).t, 'modification', m, { fuseau: fuseauDe(0x9010), sousSec: sousSec(0x9290) }), src(0x0132), { sensible: true });
  if (eExif.has(0x9004)) ajouterDate(f, ctx, 'date_numerisation', lireDateExif(ascii(eExif.get(0x9004)).t, 'numérisation', m, { fuseau: fuseauDe(0x9012), sousSec: sousSec(0x9292) }), src(0x9004));

  // GPS.
  let gpsUtcMs: number | undefined;
  let prise = eExif.has(0x9003) ? lireDateExif(ascii(eExif.get(0x9003)).t, 'prise de vue', m, { fuseau: fuseauDe(0x9011), sousSec: sousSec(0x9291) }) : undefined;
  if (eGps) {
    const ds = eGps.has(0x1d) ? ascii(eGps.get(0x1d)).t : undefined;
    const ts = rats(eGps.get(0x07), 3);
    if (ds && ts.length === 3 && ts.every((x) => x !== undefined)) {
      const d = lireDateExif(`${ds} 00:00:00`, 'GPS', m);
      if (d) {
        const p = partiesDe(d);
        const [h, mi, s] = ts as number[];
        if (h >= 0 && h < 24 && mi >= 0 && mi < 60 && s >= 0 && s < 61) {
          gpsUtcMs = Date.UTC(p.a, (p.mo ?? 1) - 1, p.j ?? 1, 0, 0, 0) + Math.round((h * 3600 + mi * 60 + s) * 1000);
          ctx.travail.gpsUtc = `${new Date(gpsUtcMs).toISOString().slice(0, 19)}Z`;
        }
      }
    }
    // Fuseau déduit du GPS (si la date n'en a pas).
    if (prise && !prise.fuseau && gpsUtcMs !== undefined) {
      const naif = instantNaif(prise);
      if (naif !== undefined && Math.abs(naif - gpsUtcMs) < 24 * 3600_000) {
        const ecart = Math.round((naif - gpsUtcMs) / (15 * 60_000)) * 15;
        if (ecart >= -12 * 60 && ecart <= 14 * 60) prise = dateDepuisParties({ ...partiesDe(prise), fuseauMin: ecart }, 'prise de vue', m, 'déduit du GPS') ?? prise;
      }
    }
    const lat = rats(eGps.get(0x02), 3), lon = rats(eGps.get(0x04), 3);
    const latRef = eGps.has(0x01) ? ascii(eGps.get(0x01)).t : 'N', lonRef = eGps.has(0x03) ? ascii(eGps.get(0x03)).t : 'E';
    if (lat.length || lon.length) {
      const la = lat.length === 3 && lat.every((x) => x !== undefined) ? degresDepuisDms(lat[0]!, lat[1]!, lat[2]!, latRef) : undefined;
      const lo = lon.length === 3 && lon.every((x) => x !== undefined) ? degresDepuisDms(lon[0]!, lon[1]!, lon[2]!, lonRef) : undefined;
      if (la === undefined || lo === undefined) ajouterManque(f, { quoi: 'la position', raison: 'coordonnées GPS illisibles (dénominateur nul ou minutes/secondes impossibles)', code: 'illisible' });
      else {
        const altRefN = num(eGps.get(0x05)) ?? 0;
        let alt = rat(eGps.get(0x06));
        if (alt !== undefined && (altRefN === 1 || altRefN === 3)) alt = -alt;
        const precision = rat(eGps.get(0x1f));
        const dir = rat(eGps.get(0x11));
        const dirRef = eGps.has(0x10) ? ascii(eGps.get(0x10)).t.toUpperCase() : undefined;
        let fiab: 'probable' | 'douteuse' = 'probable';
        if (precision !== undefined && precision > 1000) fiab = 'douteuse';
        if (gpsUtcMs !== undefined && prise) {
          const ref = prise.utc ? Date.parse(prise.utc) : instantNaif(prise);
          if (ref !== undefined && Math.abs(ref - gpsUtcMs) > 24 * 3600_000) { fiab = 'douteuse'; remarque(f, 'la position GPS date d\'un autre moment que la photo (dernier point connu ?)'); }
        }
        const p = creerPosition({
          lat: la, lon: lo, altitudeM: alt, altitudeRef: altRefN >= 2 ? 'ellipsoïde' : 'mer', directionDeg: dir,
          directionRef: dirRef === 'M' ? 'magnétique' : dirRef === 'T' ? 'vrai' : undefined, precisionM: precision, quandUtc: ctx.travail.gpsUtc,
          source: `${origine} GPS`, fiabilite: fiab,
        });
        candidatPosition(f, ctx, p, 1);
      }
    }
    if (eGps.has(0x12)) ajouterChamp(f, ctx, 'x:gps_datum', ascii(eGps.get(0x12)).t, `${origine} GPS:0x0012`, { nom: 'Référentiel GPS', groupe: 'lieu' });
  }
  if (prise) candidatPrise(ctx, prise, 1, src(0x9003));
  else if (eExif.has(0x9003)) remarque(f, 'date de prise de vue vide ou impossible');

  // Réglages.
  const ex = rat(eExif.get(0x829a));
  if (ex !== undefined && ex > 0) ajouterChamp(f, ctx, 'exposition', ex < 1 ? `1/${Math.round(1 / ex)} s` : `${decimal(ex)} s`, src(0x829a), { brut: ex });
  const fn = rat(eExif.get(0x829d));
  if (fn !== undefined && fn > 0) ajouterChamp(f, ctx, 'ouverture', `f/${decimal(fn)}`, src(0x829d), { brut: fn });
  const iso = num(eExif.get(0x8827));
  if (iso) ajouterChamp(f, ctx, 'iso', String(iso), src(0x8827), { brut: iso });
  const foc = rat(eExif.get(0x920a));
  if (foc !== undefined && foc > 0) ajouterChamp(f, ctx, 'focale', `${decimal(foc)} mm`, src(0x920a), { brut: foc });
  const f35 = num(eExif.get(0xa405));
  if (f35) ajouterChamp(f, ctx, 'focale_35', `${f35} mm`, src(0xa405), { brut: f35 });
  const flash = num(eExif.get(0x9209));
  if (flash !== undefined) {
    const mode = (flash >> 3) & 3;
    ajouterChamp(f, ctx, 'flash', `${flash & 1 ? 'déclenché' : 'non déclenché'}${mode === 1 ? ' (forcé)' : mode === 2 ? ' (désactivé)' : mode === 3 ? ' (automatique)' : ''}`, src(0x9209), { brut: flash });
  }
  const code = (cle: string, tag: number, t: Record<number, string>) => { const v = table(t, num(eExif.get(tag))); if (v) ajouterChamp(f, ctx, cle, v, src(tag), { brut: num(eExif.get(tag)) }); };
  code('programme', 0x8822, PROGRAMMES); code('mesure', 0x9207, MESURES); code('balance_blancs', 0xa403, BALANCES);
  code('mode_exposition', 0xa402, MODES); code('type_scene', 0xa406, SCENES);
  const corr = rat(eExif.get(0x9204));
  if (corr !== undefined) ajouterChamp(f, ctx, 'correction', `${corr > 0 ? '+' : corr < 0 ? '−' : ''}${decimal(Math.abs(corr))} EV`, src(0x9204), { brut: corr });

  // Objectif, numéros de série, propriétaire.
  const lmake = eExif.has(0xa433) ? ascii(eExif.get(0xa433)).t : '', lmod = eExif.has(0xa434) ? ascii(eExif.get(0xa434)).t : '';
  const spec = rats(eExif.get(0xa432), 4);
  let specTxt = '';
  if (spec.length === 4 && spec[0] !== undefined) {
    const [f1, f2, n1, n2] = spec;
    specTxt = `${decimal(f1!)}${f2 !== undefined && f2 !== f1 ? `–${decimal(f2)}` : ''} mm${n1 !== undefined && n1 > 0 ? ` f/${decimal(n1)}${n2 !== undefined && n2 !== n1 && n2 > 0 ? `–${decimal(n2)}` : ''}` : ''}`;
  }
  const obj = [lmake && !lmod.startsWith(lmake) ? lmake : '', lmod, !lmod && specTxt ? specTxt : ''].filter(Boolean).join(' ');
  if (obj) ajouterChamp(f, ctx, 'objectif', obj, `${origine}:0xA433 + 0xA434`);
  texte('numero_serie_boitier', eExif.get(0xa431), 0xa431);
  texte('numero_serie_objectif', eExif.get(0xa435), 0xa435);
  texte('proprietaire_appareil', eExif.get(0xa430), 0xa430);
  texte('identifiant', eExif.get(0xa420), 0xa420);
  if (eExif.has(0x927c)) remarque(f, `MakerNote présent, ${eExif.get(0x927c)!.taille} octets (non lu)`);
  if (eExif.has(0x9286)) {
    const uc = octets(eExif.get(0x9286));
    if (uc.length > 8) {
      const pre = uc.toString('latin1', 0, 8), corps = uc.subarray(8);
      let t = '', douteux = false;
      if (pre.startsWith('ASCII')) t = nettoyerTexte(corps, 'utf-8', { nul: true }).texte;
      else if (pre.startsWith('UNICODE')) t = nettoyerTexte(corps, le ? 'utf-16le' : 'utf-16be', { nul: true }).texte;
      else if (pre.startsWith('JIS')) t = nettoyerTexte(corps, 'shift_jis', { nul: true }).texte;
      else { const r = nettoyerTexte(corps, 'utf-8', { nul: true }); t = r.texte; douteux = true; }
      if (t) ajouterChamp(f, ctx, 'commentaire', t, src(0x9286), { encodageDouteux: douteux });
    }
  }
  if (eExif.has(0x9000)) ajouterChamp(f, ctx, 'x:exif_version', ascii(eExif.get(0x9000)).t, src(0x9000), { nom: 'Version EXIF', groupe: 'technique' });

  // Vignette (IFD1).
  if (ifd1) {
    const o = num(ifd1.entrees.get(0x0201)), n = num(ifd1.entrees.get(0x0202));
    if (o && n && o + n <= b.length && n <= bornes.imageJointe && b[o] === 0xff && b[o + 1] === 0xd8) {
      ajouterImage(f, { role: 'vignette', format: 'jpeg', decalage: base + o, taille: n, codage: 'brut' });
    }
  }
  if (denNul) remarque(f, `${origine} : valeur rationnelle de dénominateur nul ignorée`);
  return info;
}
