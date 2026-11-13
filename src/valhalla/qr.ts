// QR codes (norme ISO 18004), écrits pour Odin : mode octet, correction L ou M, versions 1 à 20.
// Sert aux configurations VPN (Vortex), à l'appairage, aux liens de réservation (Chronos).
// Sortie : matrice de booléens, ou image SVG.

type Ecc = 'L' | 'M';
// [codes de correction par bloc, blocs groupe 1, données par bloc g1, blocs groupe 2, données par bloc g2]
const TABLE: Record<Ecc, number[][]> = {
  L: [[7, 1, 19], [10, 1, 34], [15, 1, 55], [20, 1, 80], [26, 1, 108], [18, 2, 68], [20, 2, 78], [24, 2, 97], [30, 2, 116], [18, 2, 68, 2, 69], [20, 4, 81], [24, 2, 92, 2, 93], [26, 4, 107], [30, 3, 115, 1, 116], [22, 5, 87, 1, 88], [24, 5, 98, 1, 99], [28, 1, 107, 5, 108], [30, 5, 120, 1, 121], [28, 3, 113, 4, 114], [28, 3, 107, 5, 108]],
  M: [[10, 1, 16], [16, 1, 28], [26, 1, 44], [18, 2, 32], [24, 2, 43], [16, 4, 27], [18, 4, 31], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44], [30, 1, 50, 4, 51], [22, 6, 36, 2, 37], [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42], [28, 7, 45, 3, 46], [28, 10, 46, 1, 47], [26, 9, 43, 4, 44], [26, 3, 44, 11, 45], [26, 3, 41, 13, 42]],
};
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]];
const REMAINDER = (v: number) => (v >= 2 && v <= 6 ? 7 : v >= 14 && v <= 20 ? 3 : 0);

// --- Corps de Galois GF(256), polynôme 0x11d
const EXP = new Array<number>(512), LOG = new Array<number>(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsGen(n: number): number[] { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); } g = ng; } return g; }
export function rsEncode(data: number[], n: number): number[] { const g = rsGen(n), r = [...data, ...new Array(n).fill(0)]; for (let i = 0; i < data.length; i++) { const c = r[i]; if (c) for (let j = 0; j < g.length; j++) r[i + j] ^= mul(g[j], c); } return r.slice(data.length); }

function bch(value: number, poly: number, bits: number): number { let v = value << bits; const top = Math.floor(Math.log2(poly)); while (v && Math.floor(Math.log2(v)) >= top) v ^= poly << (Math.floor(Math.log2(v)) - top); return (value << bits) | v; }

export function encode(text: string | Buffer, ecc: Ecc = 'M', forceMask?: number): boolean[][] {
  const data = typeof text === 'string' ? Buffer.from(text, 'utf8') : text;
  let v = 0, spec: number[] = [];
  for (let i = 0; i < 20; i++) { spec = TABLE[ecc][i]; const cap = spec[1] * spec[2] + (spec[3] ?? 0) * (spec[4] ?? 0), cbits = i + 1 < 10 ? 8 : 16; if (4 + cbits + data.length * 8 <= cap * 8) { v = i + 1; break; } }
  if (!v) throw new Error('texte trop long pour un QR code');
  const [ecn, b1, d1, b2 = 0, d2 = 0] = spec, total = b1 * d1 + b2 * d2;
  // Bits : mode octet, longueur, données, terminateur, bourrage.
  const bits: number[] = [], push = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4); push(data.length, v < 10 ? 8 : 16); for (const b of data) push(b, 8);
  for (let i = 0; i < 4 && bits.length < total * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const cw: number[] = []; for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0; cw.length < total; p ^= 1) cw.push(p ? 0x11 : 0xec);
  // Blocs, correction, entrelacement.
  const blocks: number[][] = []; let k = 0;
  for (let i = 0; i < b1; i++) { blocks.push(cw.slice(k, k + d1)); k += d1; }
  for (let i = 0; i < b2; i++) { blocks.push(cw.slice(k, k + d2)); k += d2; }
  const ecs = blocks.map((b) => rsEncode(b, ecn)), out: number[] = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecn; i++) for (const e of ecs) out.push(e[i]);
  // Matrice et zones réservées.
  const size = 17 + 4 * v, m: Array<Array<boolean | null>> = Array.from({ length: size }, () => new Array(size).fill(null)), fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (r: number, c: number, val: boolean) => { m[r][c] = val; fixed[r][c] = true; };
  const finder = (r: number, c: number) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) { const rr = r + i, cc = c + j; if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue; const on = i >= 0 && i <= 6 && j >= 0 && j <= 6 && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)); set(rr, cc, on); } };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[v - 1];
  for (const r of al) for (const c of al) { if ((r < 9 && c < 9) || (r < 9 && c > size - 10) || (r > size - 10 && c < 9)) continue; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1); }
  for (let i = 0; i < 9; i++) { if (!fixed[8][i]) { fixed[8][i] = true; m[8][i] = false; } if (!fixed[i][8]) { fixed[i][8] = true; m[i][8] = false; } }
  for (let i = 0; i < 8; i++) { fixed[8][size - 1 - i] = true; m[8][size - 1 - i] = false; fixed[size - 1 - i][8] = true; m[size - 1 - i][8] = false; }
  set(size - 8, 8, true); // module sombre obligatoire
  if (v >= 7) { const vi = bch(v, 0x1f25, 12); for (let i = 0; i < 18; i++) { const b = ((vi >> i) & 1) === 1, r = Math.floor(i / 3), c = size - 11 + (i % 3); set(r, c, b); set(c, r, b); } }
  // Placement en zigzag.
  const stream: number[] = []; for (const c of out) for (let i = 7; i >= 0; i--) stream.push((c >> i) & 1); for (let i = 0; i < REMAINDER(v); i++) stream.push(0);
  let idx = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let n = 0; n < size; n++) {
      const up = ((size - 1 - col) >> 1) % 2 === 0, r = up ? size - 1 - n : n;
      for (const c of [col, col - 1]) if (!fixed[r][c]) m[r][c] = stream[idx++] === 1;
    }
  }
  const MASKS = [(r: number, c: number) => (r + c) % 2 === 0, (r: number) => r % 2 === 0, (_r: number, c: number) => c % 3 === 0, (r: number, c: number) => (r + c) % 3 === 0, (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0, (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];
  const build = (mask: number): boolean[][] => {
    const g = m.map((row, r) => row.map((x, c) => (fixed[r][c] ? Boolean(x) : Boolean(x) !== MASKS[mask](r, c))));
    const fi = bch(((ecc === 'L' ? 1 : 0) << 3) | mask, 0x537, 10) ^ 0x5412;
    for (let i = 0; i < 15; i++) {
      const b = ((fi >> i) & 1) === 1;
      if (i < 6) g[i][8] = b; else if (i < 8) g[i + 1][8] = b; else g[size - 15 + i][8] = b;
      if (i < 8) g[8][size - 1 - i] = b; else if (i < 9) g[8][7] = b; else g[8][14 - i] = b;
    }
    return g;
  };
  const penalty = (g: boolean[][]) => {
    let p = 0;
    for (const line of [...g, ...g[0].map((_x, c) => g.map((row) => row[c]))]) { let run = 1; for (let i = 1; i <= line.length; i++) { if (i < line.length && line[i] === line[i - 1]) run++; else { if (run >= 5) p += run - 2; run = 1; } } const s = line.map((x) => (x ? 1 : 0)).join(''); p += 40 * ((s.match(/(?=10111010000|00001011101)/g) ?? []).length); }
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) if (g[r][c] === g[r + 1][c] && g[r][c] === g[r][c + 1] && g[r][c] === g[r + 1][c + 1]) p += 3;
    const dark = g.flat().filter(Boolean).length; p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return p;
  };
  if (forceMask !== undefined) return build(forceMask);
  let best = build(0), bp = penalty(best);
  for (let k2 = 1; k2 < 8; k2++) { const g = build(k2), p = penalty(g); if (p < bp) { best = g; bp = p; } }
  return best;
}

export function svg(text: string, o: { ecc?: Ecc; scale?: number; margin?: number } = {}): string {
  const g = encode(text, o.ecc ?? 'M'), s = o.scale ?? 6, mg = o.margin ?? 4, n = g.length + mg * 2;
  let d = '';
  g.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + mg} ${r + mg}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * s}" height="${n * s}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
