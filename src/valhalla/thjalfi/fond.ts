// Genèse · les images de fond de l'écran texte (iPXE) : une image PNG de 1024 × 768 par thème, dessinée par
// Odin lui-même (aucune bibliothèque, aucun fichier téléchargé). iPXE la pose sous le menu (« console --picture ») ;
// les zones claires restent sombres pour que le texte se lise. Fonctions pures, résultat gardé en mémoire.
import { deflateSync } from 'node:zlib';

export const W = 1024, H = 768;
type RGB = [number, number, number];

/** Un PNG 24 bits (RGB, sans entrelacement), le format le plus simple lu par iPXE. Pur. */
export function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1); }
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
let CRC: Uint32Array | undefined;
function crc32(b: Buffer): number {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}

/** Une toile RGB et quelques pinceaux (dégradé, disque, bande, points). */
class Canvas {
  px = new Uint8Array(W * H * 3);
  set(x: number, y: number, c: RGB, a = 1) {
    if (x < 0 || y < 0 || x >= W || y >= H) return; const i = ((y | 0) * W + (x | 0)) * 3;
    for (let k = 0; k < 3; k++) this.px[i + k] = Math.round(this.px[i + k] * (1 - a) + c[k] * a);
  }
  gradient(f: (x: number, y: number) => RGB) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = f(x / W, y / H), i = (y * W + x) * 3; this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; } }
  disc(cx: number, cy: number, r: number, f: (dx: number, dy: number, d: number) => [RGB, number]) {
    for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy); if (d > r + 1) continue; const [c, a] = f(dx, dy, d); this.set(x, y, c, a * Math.min(1, r + 1 - d));
    }
  }
  rect(x0: number, y0: number, w: number, h: number, c: RGB, a = 1) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a); }
  /** Le cadre sombre où s'écrit le menu (maquette) : le décor reste visible autour et un peu à travers. */
  panel(fill: RGB, border: RGB, a = 0.8) {
    const x0 = 28, y0 = 50, x1 = W - 28, y1 = H - 44;
    this.rect(x0, y0, x1 - x0, y1 - y0, fill, a);
    this.rect(x0, y0, x1 - x0, 2, border, 0.9); this.rect(x0, y1 - 2, x1 - x0, 2, border, 0.9); this.rect(x0, y0, 2, y1 - y0, border, 0.9); this.rect(x1 - 2, y0, 2, y1 - y0, border, 0.9);
  }
}
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * Math.max(0, Math.min(1, t)))) as RGB;
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** Un hasard qui donne toujours la même image. */
function rnd(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

const DRAW: Record<string, (c: Canvas) => void> = {
  // Matrix : noir, colonnes de petits signes verts qui « tombent » (plus clairs en tête de colonne)
  matrix(c) {
    c.gradient(() => [0, 0, 0]); const r = rnd(7), green: RGB = [61, 255, 122];
    for (let col = 0; col < W / 16; col++) {
      if (r() < 0.25) continue; const x0 = col * 16 + 3, len = 6 + Math.floor(r() * 26), top = Math.floor(r() * (H / 16)) - 10;
      for (let j = 0; j < len; j++) {
        const y0 = (top + j) * 16; if (y0 < -16 || y0 > H) continue; const a = j === len - 1 ? 0.95 : 0.12 + 0.45 * (j / len), col2 = j === len - 1 ? [200, 255, 210] as RGB : green;
        const bits = Math.floor(r() * 32768); // un signe : grille de 3 × 5 « pixels » de 3 px
        for (let k = 0; k < 15; k++) if (bits & (1 << k)) c.rect(x0 + (k % 3) * 3, y0 + Math.floor(k / 3) * 3, 2, 2, col2, a);
      }
    }
  },
  // Lune : nuit grise, grande lune en haut à droite avec ses cratères, quelques étoiles
  lune(c) {
    c.gradient((x, y) => mix(hex('#2a2d3e'), hex('#0b0c14'), Math.hypot(x - 0.8, y - 0.2) * 1.2));
    const r = rnd(3); for (let i = 0; i < 140; i++) c.set(Math.floor(r() * W), Math.floor(r() * H), [255, 255, 255], 0.3 + r() * 0.6);
    const cx = 860, cy = 150, R = 105;
    c.disc(cx, cy, R + 40, (_dx, _dy, d) => [[255, 250, 230], d > R ? 0.12 * (1 - (d - R) / 40) : 0]);
    c.disc(cx, cy, R, (dx, dy) => [mix(hex('#fbf8ef'), hex('#a9a391'), (dx + dy + R) / (2.4 * R)), 1]);
    for (const [x, y, rr] of [[-35, -25, 18], [25, 30, 26], [20, -50, 11], [-50, 35, 9], [55, -5, 8]]) c.disc(cx + x, cy + y, rr, () => [[150, 140, 120], 0.35]);
  },
  // Aurore boréale : nuit bleue, rideaux verts et violets qui ondulent dans le haut du ciel
  aurore(c) {
    c.gradient((x, y) => {
      let col = mix(hex('#06101e'), hex('#0b1c33'), y);
      const g = Math.exp(-(((y - (0.26 + 0.09 * Math.sin(x * 5.5))) / (y < 0.26 + 0.09 * Math.sin(x * 5.5) ? 0.16 : 0.035)) ** 2)) * (0.55 + 0.45 * Math.sin(x * 47) ** 2);
      const v = Math.exp(-(((y - (0.4 + 0.06 * Math.sin(x * 4 + 2))) / (y < 0.4 + 0.06 * Math.sin(x * 4 + 2) ? 0.12 : 0.03)) ** 2)) * (0.5 + 0.5 * Math.sin(x * 31 + 1) ** 2);
      col = mix(col, hex('#3dffb0'), g * 0.55); col = mix(col, hex('#7c4dff'), v * 0.5); return col;
    });
    const r = rnd(5); for (let i = 0; i < 90; i++) c.set(Math.floor(r() * W), Math.floor(r() * H * 0.7), [255, 255, 255], 0.3 + r() * 0.5);
  },
  // Néon : violet profond, horizon rose et quadrillage cyan qui fuit vers le bas
  neon(c) {
    c.gradient((_x, y) => (y < 0.62 ? mix(hex('#12002a'), hex('#3a0a5c'), y / 0.62) : mix(hex('#1a0036'), hex('#001a3a'), (y - 0.62) / 0.38)));
    c.rect(0, Math.round(H * 0.62) - 1, W, 3, hex('#ff4fd8'), 0.9);
    for (let i = 1; i < 14; i++) { const t = (i / 14) ** 2, y = Math.round(H * 0.62 + t * H * 0.38); c.rect(0, y, W, 1, hex('#3af0ff'), 0.25 + 0.4 * t); }
    for (let i = -16; i <= 16; i++) { for (let y = Math.round(H * 0.62); y < H; y++) { const t = (y - H * 0.62) / (H * 0.38), x = W / 2 + i * (20 + t * 70); c.set(x, y, hex('#3af0ff'), 0.2 + 0.4 * t); } }
  },
};
const PANEL: Record<string, [string, string]> = { matrix: ['#000a03', '#1f8f3a'], lune: ['#0d0f18', '#8a8676'], aurore: ['#06101e', '#3dffb0'], neon: ['#12002a', '#3af0ff'] };
export const TEXT_BACKGROUNDS = Object.keys(DRAW);
const cache = new Map<string, Buffer>();
/** Le fond PNG d'un thème texte (gardé en mémoire après le premier dessin). */
export function textBackground(theme: string): Buffer | undefined {
  const d = DRAW[theme]; if (!d) return undefined;
  let b = cache.get(theme); if (!b) { const c = new Canvas(); d(c); const [f, br] = PANEL[theme]; c.panel(hex(f), hex(br)); b = png(W, H, c.px); cache.set(theme, b); }
  return b;
}
/** Un fichier envoyé est-il bien une image PNG (fond texte) ou JPEG / PNG (fond graphique) ? Pur. */
export function imageKind(b: Uint8Array): 'png' | 'jpeg' | undefined {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  return undefined;
}
