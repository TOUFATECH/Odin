// Comète · partage de fichiers : le format « bencode » (fichiers .torrent, réponses des trackers, messages du DHT et
// des pairs). Lecture BORNÉE : taille totale, profondeur, nombre d'éléments, longueur des nombres ; rien n'est jamais
// exécuté, tout est une donnée. La lecture garde la place exacte du dictionnaire « info » (son empreinte SHA-1 est
// l'identité du partage : on la calcule sur les octets reçus, jamais sur une réécriture).

export type Valeur = Buffer | number | Valeur[] | { [cle: string]: Valeur };
export interface Bornes { taille: number; profondeur: number; elements: number }
export const BORNES_DEFAUT: Bornes = { taille: 8 * 1024 * 1024, profondeur: 32, elements: 200_000 };

export class ErreurBencode extends Error {}

/**
 * Lit un bencode. `info` : la place [début, fin) du dictionnaire « info » de premier niveau s'il y en a un.
 * `fin` : où la lecture s'est arrêtée (les messages du protocole des pairs collent des octets après le dictionnaire).
 * `reste` : accepte des octets après la valeur (sinon erreur).
 */
export function lire(b: Buffer, o: Partial<Bornes> & { reste?: boolean } = {}): { valeur: Valeur; fin: number; info?: [number, number] } {
  const bornes = { ...BORNES_DEFAUT, ...o };
  if (b.length > bornes.taille) throw new ErreurBencode(`trop gros (${b.length} octets, ${bornes.taille} au plus)`);
  let i = 0, elements = 0, info: [number, number] | undefined;
  const octet = () => { if (i >= b.length) throw new ErreurBencode('fin inattendue'); return b[i]; };
  const nombreJusque = (fin: number): number => {
    const debut = i; let neg = false;
    if (octet() === 0x2d) { neg = true; i++; }
    const d0 = i;
    while (octet() !== fin) { const c = b[i]; if (c < 0x30 || c > 0x39) throw new ErreurBencode('nombre invalide'); i++; if (i - d0 > 18) throw new ErreurBencode('nombre trop long'); }
    if (i === d0) throw new ErreurBencode('nombre vide');
    if (b[d0] === 0x30 && i - d0 > 1) throw new ErreurBencode('nombre avec zéro en tête');
    if (neg && b[d0] === 0x30) throw new ErreurBencode('moins zéro');
    const n = Number(b.toString('latin1', debut, i)); i++;
    return n;
  };
  const valeur = (prof: number, haut: boolean): Valeur => {
    if (prof > bornes.profondeur) throw new ErreurBencode(`trop imbriqué (plus de ${bornes.profondeur} niveaux)`);
    if (++elements > bornes.elements) throw new ErreurBencode(`trop d'éléments (plus de ${bornes.elements})`);
    const c = octet();
    if (c === 0x69) { i++; return nombreJusque(0x65); } // i…e
    if (c === 0x6c) { // l…e
      i++; const l: Valeur[] = [];
      while (octet() !== 0x65) l.push(valeur(prof + 1, false));
      i++; return l;
    }
    if (c === 0x64) { // d…e
      i++; const d: { [cle: string]: Valeur } = Object.create(null);
      while (octet() !== 0x65) {
        const cle = chaine().toString('utf8'), d0 = i;
        if (Object.prototype.hasOwnProperty.call(d, cle)) throw new ErreurBencode('clé en double');
        const v = valeur(prof + 1, false);
        if (haut && cle === 'info' && !Buffer.isBuffer(v) && !Array.isArray(v) && typeof v === 'object') info = [d0, i];
        d[cle] = v;
      }
      i++; return d;
    }
    if (c >= 0x30 && c <= 0x39) return chaine();
    throw new ErreurBencode('octet inattendu');
  };
  const chaine = (): Buffer => {
    const d0 = i;
    while (octet() !== 0x3a) { const c = b[i]; if (c < 0x30 || c > 0x39) throw new ErreurBencode('longueur invalide'); i++; if (i - d0 > 10) throw new ErreurBencode('longueur trop longue'); }
    if (i === d0) throw new ErreurBencode('longueur vide');
    const n = Number(b.toString('latin1', d0, i)); i++;
    if (n > b.length - i) throw new ErreurBencode('chaîne plus longue que le reste');
    const s = b.subarray(i, i + n); i += n; return s;
  };
  const v = valeur(0, true);
  if (!o.reste && i !== b.length) throw new ErreurBencode('octets en trop après la valeur');
  return { valeur: v, fin: i, ...(info ? { info } : {}) };
}

/** Écrit un bencode (clés triées). Les textes sont écrits en UTF-8. */
export function ecrire(v: Valeur | string | boolean | undefined | null): Buffer {
  const out: Buffer[] = [];
  const w = (x: Valeur | string): void => {
    if (typeof x === 'number') { if (!Number.isSafeInteger(x)) throw new ErreurBencode('nombre non entier'); out.push(Buffer.from(`i${x}e`)); return; }
    if (typeof x === 'string') { const b = Buffer.from(x, 'utf8'); out.push(Buffer.from(`${b.length}:`), b); return; }
    if (Buffer.isBuffer(x)) { out.push(Buffer.from(`${x.length}:`), x); return; }
    if (Array.isArray(x)) { out.push(Buffer.from('l')); for (const e of x) w(e); out.push(Buffer.from('e')); return; }
    out.push(Buffer.from('d'));
    for (const k of Object.keys(x).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) { const e = x[k]; if (e === undefined) continue; w(k); w(e); }
    out.push(Buffer.from('e'));
  };
  w(v as Valeur);
  return Buffer.concat(out);
}

// ---------------------------------------------------------------- Petits lecteurs typés (jamais de confiance)
export const dico = (v: Valeur | undefined): { [cle: string]: Valeur } | undefined => (v && typeof v === 'object' && !Buffer.isBuffer(v) && !Array.isArray(v) ? v : undefined);
export const liste = (v: Valeur | undefined): Valeur[] | undefined => (Array.isArray(v) ? v : undefined);
export const octets = (v: Valeur | undefined): Buffer | undefined => (Buffer.isBuffer(v) ? v : undefined);
export const texte = (v: Valeur | undefined): string | undefined => (Buffer.isBuffer(v) ? v.toString('utf8') : undefined);
export const entier = (v: Valeur | undefined): number | undefined => (typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined);
