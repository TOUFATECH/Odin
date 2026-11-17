// Médias reçus : parcours des boîtes ISO BMFF (MP4, MOV, 3GP, HEIF, AVIF, CR3) et lecture des images HEIF / HEIC /
// AVIF (meta : hdlr, pitm, iinf, iloc, iprp/ipco/ipma, iref). Une boîte de taille 0 va jusqu'à la fin de son parent ;
// taille 1 → taille 64 bits (refusée au-delà du fichier) ; une taille entre 2 et 7 arrête le parcours.

import type { Contexte, FicheEnCours } from './contrat.ts';
import { ErreurFormat } from './contrat.ts';
import { ajouterChamp, remarque } from './champs.ts';
import type { Source } from './octets.ts';
import { nettoyerTexte } from './octets.ts';
import { coupure, lireTiff } from './tiff.ts';
import { lireXmp } from './xmp.ts';

export interface Boite { type: string; debut: number; donnees: number; fin: number; uuid?: string }

/** Les boîtes d'un intervalle d'un fichier (en-têtes lus un par un). */
export function* boitesSource(src: Source, debut: number, fin: number, ctx: Contexte): Generator<Boite> {
  let p = debut;
  const limite = Math.min(fin, src.taille);
  while (p + 8 <= limite) {
    ctx.budget.pas();
    const h = src.lire(p, 32);
    if (h.length < 8) return;
    const b = enTete(h, 0, p, limite);
    yield b;
    if (b.fin <= p) return;
    p = b.fin;
  }
}

/** Les boîtes d'un intervalle d'un tampon. */
export function* boitesBuf(buf: Buffer, debut: number, fin: number, ctx: Contexte): Generator<Boite> {
  let p = debut;
  const limite = Math.min(fin, buf.length);
  while (p + 8 <= limite) {
    ctx.budget.pas();
    const b = enTete(buf, p, p, limite);
    // En tampon, les positions sont celles du tampon.
    yield b;
    if (b.fin <= p) return;
    p = b.fin;
  }
}

/** Lit un en-tête de boîte : `h` contient au moins 8 octets à partir de `o` ; `pos` est la position réelle. */
function enTete(h: Buffer, o: number, pos: number, limite: number): Boite {
  let taille = h.readUInt32BE(o);
  const type = h.toString('latin1', o + 4, o + 8);
  let entete = 8;
  if (taille === 1) {
    if (h.length < o + 16) throw new ErreurFormat(`boîte ${type} tronquée`);
    const big = h.readBigUInt64BE(o + 8);
    if (big > BigInt(Number.MAX_SAFE_INTEGER) || Number(big) > limite - pos) throw new ErreurFormat(`boîte ${nomType(type)} de taille 64 bits impossible`);
    taille = Number(big); entete = 16;
    if (taille < 16) throw new ErreurFormat(`boîte ${nomType(type)} de taille ${taille}`);
  } else if (taille === 0) taille = limite - pos;
  else if (taille < 8) throw new ErreurFormat(`boîte ${nomType(type)} de taille ${taille}`);
  if (pos + taille > limite) throw new ErreurFormat(`boîte ${nomType(type)} plus longue que son parent`);
  const b: Boite = { type, debut: pos, donnees: pos + entete, fin: pos + taille };
  if (type === 'uuid') {
    if (h.length < o + entete + 16 || taille < entete + 16) throw new ErreurFormat('boîte uuid tronquée');
    b.uuid = h.toString('hex', o + entete, o + entete + 16);
    b.donnees += 16;
  }
  return b;
}
const nomType = (t: string) => { let r = ''; for (const c of t) r += c >= ' ' && c <= '~' ? c : '?'; return r; };

/** Trouve la première boîte d'un type dans un tampon (un niveau). */
export function trouver(buf: Buffer, debut: number, fin: number, type: string, ctx: Contexte): Boite | undefined {
  for (const b of boitesBuf(buf, debut, fin, ctx)) if (b.type === type) return b;
  return undefined;
}

// ─────────────────────────────── HEIF / HEIC / AVIF ───────────────────────────────

interface Element { id: number; type: string; nom: string; mime?: string; methode: number; base: number; extents: Array<{ off: number; len: number }> }

/** Lit les métadonnées d'une image HEIF / HEIC / AVIF. */
export function lireHeif(src: Source, f: FicheEnCours, ctx: Contexte): void {
  let meta: Boite | undefined;
  for (const b of boitesSource(src, 0, src.taille, ctx)) { if (b.type === 'meta') { meta = b; break; } }
  if (!meta) throw new ErreurFormat('HEIF sans boîte meta');
  if (meta.fin - meta.donnees > 16 * 1024 * 1024) throw new ErreurFormat('boîte meta trop grande');
  const m = src.lire(meta.debut, meta.fin - meta.debut);
  const D = meta.donnees - meta.debut + 4;     // FullBox
  const B = ctx.budget.bornes;
  const elements = new Map<number, Element>();
  let primaire = 0;
  const props: Boite[] = [];
  const assoc = new Map<number, number[]>();
  const refs: Array<{ type: string; de: number; vers: number[] }> = [];
  let idat: Boite | undefined;
  for (const b of boitesBuf(m, D, m.length, ctx)) {
    const v = m[b.donnees];
    switch (b.type) {
      case 'hdlr': { const t = m.toString('latin1', b.donnees + 8, b.donnees + 12); if (t !== 'pict') remarque(f, `HEIF : gestionnaire ${nomType(t)}`); break; }
      case 'pitm': primaire = v === 0 ? m.readUInt16BE(b.donnees + 4) : m.readUInt32BE(b.donnees + 4); break;
      case 'idat': idat = b; break;
      case 'iinf': {
        const n = v === 0 ? m.readUInt16BE(b.donnees + 4) : m.readUInt32BE(b.donnees + 4);
        if (n > B.heifElements) throw new ErreurFormat(`HEIF : ${n} éléments annoncés`);
        let k = 0;
        for (const e of boitesBuf(m, b.donnees + (v === 0 ? 6 : 8), b.fin, ctx)) {
          if (e.type !== 'infe' || ++k > n) continue;
          const ve = m[e.donnees];
          if (ve < 2) continue;
          let p = e.donnees + 4;
          const id = ve === 2 ? m.readUInt16BE(p) : m.readUInt32BE(p); p += ve === 2 ? 2 : 4;
          p += 2;
          const type = m.toString('latin1', p, p + 4); p += 4;
          const zn = m.indexOf(0, p); const nom = m.toString('utf8', p, zn >= 0 && zn < e.fin ? zn : e.fin); p = (zn >= 0 && zn < e.fin ? zn : e.fin) + 1;
          let mime: string | undefined;
          if (type === 'mime' && p < e.fin) { const zm = m.indexOf(0, p); mime = m.toString('latin1', p, zm >= 0 && zm < e.fin ? zm : e.fin); }
          elements.set(id, { id, type, nom, mime, methode: 0, base: 0, extents: [] });
        }
        break;
      }
      case 'iloc': {
        let p = b.donnees + 4;
        const a = m[p], c = m[p + 1]; p += 2;
        const tOff = a >> 4, tLen = a & 15, tBase = c >> 4, tIdx = v === 1 || v === 2 ? c & 15 : 0;
        for (const t of [tOff, tLen, tBase, tIdx]) if (![0, 4, 8].includes(t)) throw new ErreurFormat('HEIF : iloc invalide');
        const lireN = (t: number) => { if (p + t > b.fin) throw new ErreurFormat('HEIF : iloc tronqué'); const r = t === 0 ? 0 : t === 4 ? m.readUInt32BE(p) : Number(m.readBigUInt64BE(p)); p += t; if (!Number.isSafeInteger(r)) throw new ErreurFormat('HEIF : décalage impossible'); return r; };
        const n = v < 2 ? m.readUInt16BE(p) : m.readUInt32BE(p); p += v < 2 ? 2 : 4;
        if (n > B.heifElements) throw new ErreurFormat(`HEIF : ${n} emplacements annoncés`);
        for (let i = 0; i < n; i++) {
          ctx.budget.pas();
          const id = v < 2 ? m.readUInt16BE(p) : m.readUInt32BE(p); p += v < 2 ? 2 : 4;
          let methode = 0;
          if (v === 1 || v === 2) { methode = m.readUInt16BE(p) & 15; p += 2; }
          p += 2;
          const base = lireN(tBase);
          const ne = m.readUInt16BE(p); p += 2;
          if (ne > B.heifExtents) throw new ErreurFormat(`HEIF : ${ne} morceaux pour un élément`);
          const extents: Array<{ off: number; len: number }> = [];
          for (let k = 0; k < ne; k++) { if (tIdx) lireN(tIdx); extents.push({ off: lireN(tOff), len: lireN(tLen) }); }
          const el = elements.get(id);
          if (el) { el.methode = methode; el.base = base; el.extents = extents; }
        }
        break;
      }
      case 'iprp': {
        for (const c of boitesBuf(m, b.donnees, b.fin, ctx)) {
          if (c.type === 'ipco') for (const pr of boitesBuf(m, c.donnees, c.fin, ctx)) { props.push(pr); if (props.length > B.heifElements) throw new ErreurFormat('HEIF : trop de propriétés'); }
          else if (c.type === 'ipma') {
            const vv = m[c.donnees], fl = m[c.donnees + 3];
            let p = c.donnees + 4;
            const n = m.readUInt32BE(p); p += 4;
            if (n > B.heifElements) throw new ErreurFormat(`HEIF : ${n} associations annoncées`);
            for (let i = 0; i < n && p < c.fin; i++) {
              ctx.budget.pas();
              const id = vv < 1 ? m.readUInt16BE(p) : m.readUInt32BE(p); p += vv < 1 ? 2 : 4;
              const k = m[p++];
              const l: number[] = [];
              for (let j = 0; j < k; j++) { if (fl & 1) { l.push(m.readUInt16BE(p) & 0x7fff); p += 2; } else { l.push(m[p] & 0x7f); p += 1; } }
              assoc.set(id, l);
            }
          }
        }
        break;
      }
      case 'iref': {
        for (const r of boitesBuf(m, b.donnees + 4, b.fin, ctx)) {
          let p = r.donnees;
          const de = v === 0 ? m.readUInt16BE(p) : m.readUInt32BE(p); p += v === 0 ? 2 : 4;
          const n = m.readUInt16BE(p); p += 2;
          const vers: number[] = [];
          for (let i = 0; i < n && p < r.fin; i++) { vers.push(v === 0 ? m.readUInt16BE(p) : m.readUInt32BE(p)); p += v === 0 ? 2 : 4; }
          refs.push({ type: r.type, de, vers });
          if (refs.length > B.heifElements) throw new ErreurFormat('HEIF : trop de références');
        }
        break;
      }
      default: break;
    }
  }
  const lireElement = (el: Element): Buffer | undefined => {
    if (el.methode === 2) { remarque(f, 'HEIF : élément construit par référence (méthode 2) ignoré'); return undefined; }
    const morceaux: Buffer[] = [];
    let total = 0;
    for (const x of el.extents) {
      const off = el.base + x.off;
      if (x.len > 4 * 1024 * 1024 || total + x.len > 4 * 1024 * 1024) throw new ErreurFormat('HEIF : élément de métadonnées trop gros');
      if (el.methode === 1) {
        if (!idat || idat.donnees + off + x.len > idat.fin) throw new ErreurFormat('HEIF : morceau hors de idat');
        morceaux.push(m.subarray(idat.donnees + off, idat.donnees + off + x.len));
      } else {
        if (off + x.len > src.taille || x.len === 0) throw new ErreurFormat('HEIF : morceau hors du fichier');
        morceaux.push(src.lire(off, x.len));
      }
      total += x.len;
    }
    return Buffer.concat(morceaux);
  };
  // EXIF : élément 'Exif' lié à l'image principale par cdsc, sinon le premier.
  const exifs = [...elements.values()].filter((e) => e.type === 'Exif');
  const lie = exifs.find((e) => refs.some((r) => r.type === 'cdsc' && r.de === e.id && r.vers.includes(primaire)));
  const exif = lie ?? exifs[0];
  if (exif) {
    try {
      const d = lireElement(exif);
      if (d && d.length > 4) {
        const dec = d.readUInt32BE(0);
        if (4 + dec < d.length) lireTiff(d.subarray(4 + dec), f, ctx, 'EXIF');
      }
    } catch (e) { coupure(f, `EXIF : ${(e as Error).message}`); }
  }
  const xmp = [...elements.values()].find((e) => e.type === 'mime' && (e.mime ?? '').startsWith('application/rdf+xml'));
  if (xmp) { try { const d = lireElement(xmp); if (d) lireXmp(nettoyerTexte(d, 'utf-8', { max: B.xmp }).texte, f, ctx); } catch (e) { coupure(f, `XMP : ${(e as Error).message}`); } }
  // Dimensions et rotation de l'image principale.
  const ps = (assoc.get(primaire) ?? []).map((i) => props[i - 1]).filter(Boolean);
  const ispe = ps.find((p) => p.type === 'ispe');
  if (ispe) { f.largeur = m.readUInt32BE(ispe.donnees + 4); f.hauteur = m.readUInt32BE(ispe.donnees + 8); }
  const irot = ps.find((p) => p.type === 'irot');
  const imir = ps.find((p) => p.type === 'imir');
  if (irot) {
    const cw = (360 - (m[irot.donnees] & 3) * 90) % 360;
    const code = cw === 90 ? 6 : cw === 180 ? 3 : cw === 270 ? 8 : 1;
    const textes: Record<number, string> = { 1: 'normale', 3: 'tournée de 180°', 6: 'tournée de 90° (sens horaire)', 8: 'tournée de 270° (sens horaire)' };
    f.orientation = { code, texte: textes[code] + (imir ? ' + miroir' : '') };
    f.champs = f.champs.filter((c) => c.cle !== 'orientation');
    ajouterChamp(f, ctx, 'orientation', f.orientation.texte, 'HEIF:irot', { brut: cw });
  } else if (imir) remarque(f, 'image en miroir (imir)');
  const grille = elements.get(primaire)?.type === 'grid';
  if (grille) remarque(f, 'image en grille de tuiles');
  const nbImages = [...elements.values()].filter((e) => e.type === 'hvc1' || e.type === 'av01' || e.type === 'grid' || e.type === 'jpeg').length;
  if (nbImages > 1 && !grille) remarque(f, `${nbImages} images dans le fichier`);
}
