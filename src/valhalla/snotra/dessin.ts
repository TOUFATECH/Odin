// Plume · tableaux blancs (formes à main levée, comme un tableau de réunion) et schémas d'infrastructure en 3D
// isométrique (serveurs, PC, box, NAS, caméras, nuage, reliés entre eux). Code maison : rien n'est repris
// d'Excalidraw ni de FossFLOW. Ici : le modèle, sa vérification (ce qui vient de la page n'est jamais cru tel quel)
// et le dessin en SVG pour l'export. La page (src/web/pages/snotra.js) dessine la même chose pour l'édition.

export type TypeForme = 'rect' | 'ellipse' | 'fleche' | 'trait' | 'texte';
export interface Forme { id: string; t: TypeForme; x: number; y: number; w: number; h: number; /** trait libre : points relatifs à (x, y), à plat [x0, y0, x1, y1…] */ pts?: number[]; texte?: string; couleur: string; fond?: string; ep: number }
export const GENRES_BLOC = ['serveur', 'pc', 'box', 'nas', 'camera', 'nuage', 'telephone', 'imprimante', 'switch'] as const;
export type GenreBloc = (typeof GENRES_BLOC)[number];
export interface Bloc { id: string; genre: GenreBloc; gx: number; gy: number; nom: string; ip?: string }
export interface Lien { de: string; vers: string; nom?: string }
export interface Dessin { id: string; nom: string; genre: 'tableau' | 'schema'; formes: Forme[]; blocs: Bloc[]; liens: Lien[]; maj: string }

const MAX_FORMES = 5000, MAX_POINTS = 4000, BORNE = 100_000;
const nombre = (x: unknown, min = -BORNE, max = BORNE) => { const n = Number(x); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n * 10) / 10)) : 0; };
const couleur = (x: unknown, d: string) => (typeof x === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(x) ? x : d);
const texte = (x: unknown, n = 500) => (typeof x === 'string' ? x : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, n);
const ident = (x: unknown, i: number) => (typeof x === 'string' && /^[\w-]{1,40}$/.test(x) ? x : `f${i}`);

/** Un dessin venu de la page : tout est vérifié et borné (nombres, couleurs, textes, quantités). Pur. */
export function nettoyer(o: unknown, defaut: { id: string; nom: string; genre: Dessin['genre']; maj: string }): Dessin {
  const x = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const genre = x.genre === 'schema' || defaut.genre === 'schema' ? 'schema' : 'tableau';
  const formes: Forme[] = (Array.isArray(x.formes) ? x.formes : []).slice(0, MAX_FORMES).flatMap((f, i): Forme[] => {
    const y = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>, t = String(y.t) as TypeForme;
    if (!['rect', 'ellipse', 'fleche', 'trait', 'texte'].includes(t)) return [];
    const out: Forme = { id: ident(y.id, i), t, x: nombre(y.x), y: nombre(y.y), w: nombre(y.w), h: nombre(y.h), couleur: couleur(y.couleur, '#1f2937'), ep: nombre(y.ep, 1, 24) || 2 };
    if (t === 'trait') { const p = (Array.isArray(y.pts) ? y.pts : []).slice(0, MAX_POINTS * 2).map((n) => nombre(n)); if (p.length < 4) return []; out.pts = p.length % 2 ? p.slice(0, -1) : p; }
    if (t === 'texte') { out.texte = texte(y.texte, 2000); if (!out.texte.trim()) return []; }
    if ((t === 'rect' || t === 'ellipse') && typeof y.fond === 'string') out.fond = couleur(y.fond, 'none');
    return [out];
  });
  const blocs: Bloc[] = (Array.isArray(x.blocs) ? x.blocs : []).slice(0, 500).flatMap((b, i): Bloc[] => {
    const y = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>, g = String(y.genre) as GenreBloc;
    if (!GENRES_BLOC.includes(g)) return [];
    const ip = texte(y.ip, 45).trim();
    return [{ id: ident(y.id, i), genre: g, gx: nombre(y.gx, -200, 200), gy: nombre(y.gy, -200, 200), nom: texte(y.nom, 60).trim() || g, ...(ip ? { ip } : {}) }];
  });
  const ids = new Set(blocs.map((b) => b.id));
  const liens: Lien[] = (Array.isArray(x.liens) ? x.liens : []).slice(0, 2000).flatMap((l): Lien[] => {
    const y = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>, de = String(y.de), vers = String(y.vers), nom = texte(y.nom, 40).trim();
    return ids.has(de) && ids.has(vers) && de !== vers ? [{ de, vers, ...(nom ? { nom } : {}) }] : [];
  });
  return { id: defaut.id, nom: texte(x.nom, 80).trim() || defaut.nom, genre, formes: genre === 'tableau' ? formes : [], blocs: genre === 'schema' ? blocs : [], liens: genre === 'schema' ? liens : [], maj: defaut.maj };
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Le rectangle qui contient tout le dessin d'un tableau. */
function bornes(fs: Forme[]): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const f of fs) {
    const xs = f.t === 'trait' ? f.pts!.filter((_, i) => i % 2 === 0).map((p) => f.x + p) : [f.x, f.x + f.w], ys = f.t === 'trait' ? f.pts!.filter((_, i) => i % 2 === 1).map((p) => f.y + p) : [f.y, f.y + f.h];
    if (f.t === 'texte') { const l = (f.texte ?? '').split('\n'); xs.push(f.x + Math.max(...l.map((x) => x.length)) * 9); ys.push(f.y + l.length * 22); }
    a = Math.min(a, ...xs); b = Math.min(b, ...ys); c = Math.max(c, ...xs); d = Math.max(d, ...ys);
  }
  return Number.isFinite(a) ? [a, b, c, d] : [0, 0, 400, 300];
}

/** Le SVG d'un tableau blanc (fond blanc, marge de 20). Pur. */
export function svgTableau(t: Dessin): string {
  const [a, b, c, d] = bornes(t.formes), m = 20, W = r1(c - a + 2 * m), H = r1(d - b + 2 * m);
  const corps = t.formes.map((f) => {
    const st = `stroke="${f.couleur}" stroke-width="${f.ep}" fill="${f.fond ?? 'none'}" stroke-linecap="round" stroke-linejoin="round"`;
    const x = Math.min(f.x, f.x + f.w), y = Math.min(f.y, f.y + f.h), w = Math.abs(f.w), h = Math.abs(f.h);
    if (f.t === 'rect') return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="6" ${st}/>`;
    if (f.t === 'ellipse') return `<ellipse cx="${r1(x + w / 2)}" cy="${r1(y + h / 2)}" rx="${r1(w / 2)}" ry="${r1(h / 2)}" ${st}/>`;
    if (f.t === 'fleche') return `<line x1="${f.x}" y1="${f.y}" x2="${r1(f.x + f.w)}" y2="${r1(f.y + f.h)}" ${st} marker-end="url(#pointe)"/>`;
    if (f.t === 'trait') return `<polyline points="${f.pts!.reduce<string[]>((o, p, i) => (i % 2 ? (o[o.length - 1] += `,${r1(f.y + p)}`, o) : (o.push(String(r1(f.x + p))), o)), []).join(' ')}" ${st}/>`;
    return `<text x="${f.x}" y="${f.y}" fill="${f.couleur}" font-family="sans-serif" font-size="18">${(f.texte ?? '').split('\n').map((l, i) => `<tspan x="${f.x}" dy="${i ? 22 : 18}">${esc(l)}</tspan>`).join('')}</text>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${r1(a - m)} ${r1(b - m)} ${W} ${H}">\n<title>${esc(t.nom)}</title>\n<defs><marker id="pointe" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs>\n<rect x="${r1(a - m)}" y="${r1(b - m)}" width="${W}" height="${H}" fill="#ffffff"/>\n${corps}\n</svg>\n`;
}

// ---------------------------------------------------------------- schémas isométriques
/** Taille d'une case de la grille isométrique (losange de 64 × 32). */
export const CASE = { w: 64, h: 32 };
/** Couleurs (dessus, gauche, droite) et hauteur de chaque genre de bloc. */
export const STYLE_BLOC: Record<GenreBloc, { dessus: string; gauche: string; droite: string; haut: number; nom: string }> = {
  serveur: { dessus: '#60a5fa', gauche: '#2563eb', droite: '#1d4ed8', haut: 46, nom: 'Serveur' },
  pc: { dessus: '#a78bfa', gauche: '#7c3aed', droite: '#6d28d9', haut: 26, nom: 'PC' },
  box: { dessus: '#fbbf24', gauche: '#d97706', droite: '#b45309', haut: 12, nom: 'Box' },
  nas: { dessus: '#34d399', gauche: '#059669', droite: '#047857', haut: 34, nom: 'NAS' },
  camera: { dessus: '#f87171', gauche: '#dc2626', droite: '#b91c1c', haut: 16, nom: 'Caméra' },
  nuage: { dessus: '#e5e7eb', gauche: '#cbd5e1', droite: '#94a3b8', haut: 0, nom: 'Nuage' },
  telephone: { dessus: '#f472b6', gauche: '#db2777', droite: '#be185d', haut: 10, nom: 'Téléphone' },
  imprimante: { dessus: '#9ca3af', gauche: '#6b7280', droite: '#4b5563', haut: 20, nom: 'Imprimante' },
  switch: { dessus: '#22d3ee', gauche: '#0891b2', droite: '#0e7490', haut: 8, nom: 'Switch' },
};
/** Où tombe le centre d'une case (gx, gy) à l'écran. Pur. */
export const versEcran = (gx: number, gy: number): [number, number] => [(gx - gy) * (CASE.w / 2), (gx + gy) * (CASE.h / 2)];

/** Un bloc isométrique en SVG (sans le texte). Pur. */
export function svgBloc(b: Pick<Bloc, 'genre' | 'gx' | 'gy'>): string {
  const [cx, cy] = versEcran(b.gx, b.gy), s = STYLE_BLOC[b.genre], w = CASE.w / 2 - 6, h = CASE.h / 2 - 3, H = s.haut;
  if (b.genre === 'nuage') return `<g><ellipse cx="${cx - 14}" cy="${cy - 8}" rx="18" ry="11" fill="${s.gauche}"/><ellipse cx="${cx + 12}" cy="${cy - 10}" rx="20" ry="13" fill="${s.droite}"/><ellipse cx="${cx}" cy="${cy - 18}" rx="18" ry="12" fill="${s.dessus}"/></g>`;
  const p = (pts: number[][]) => pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');
  const dessus = p([[cx, cy - h - H], [cx + w, cy - H], [cx, cy + h - H], [cx - w, cy - H]]);
  const gauche = p([[cx - w, cy - H], [cx, cy + h - H], [cx, cy + h], [cx - w, cy]]);
  const droite = p([[cx + w, cy - H], [cx, cy + h - H], [cx, cy + h], [cx + w, cy]]);
  return `<g><polygon points="${gauche}" fill="${s.gauche}"/><polygon points="${droite}" fill="${s.droite}"/><polygon points="${dessus}" fill="${s.dessus}" stroke="#ffffff" stroke-opacity="0.5"/></g>`;
}

/** Le SVG d'un schéma isométrique (grille, liens, blocs, étiquettes). Pur. */
export function svgSchema(t: Dessin): string {
  const pos = new Map(t.blocs.map((b) => [b.id, versEcran(b.gx, b.gy)]));
  const pts = [...pos.values()], xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const a = (xs.length ? Math.min(...xs) : 0) - 90, b = (ys.length ? Math.min(...ys) : 0) - 90, W = (xs.length ? Math.max(...xs) : 0) + 90 - a, H = (ys.length ? Math.max(...ys) : 0) + 70 - b;
  const liens = t.liens.map((l) => { const p = pos.get(l.de)!, q = pos.get(l.vers)!; return `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="#475569" stroke-width="2.5" stroke-dasharray="6 4"/>${l.nom ? `<text x="${r1((p[0] + q[0]) / 2)}" y="${r1((p[1] + q[1]) / 2 - 4)}" font-family="sans-serif" font-size="11" fill="#334155" text-anchor="middle">${esc(l.nom)}</text>` : ''}`; }).join('\n');
  const blocs = [...t.blocs].sort((x, y) => x.gx + x.gy - (y.gx + y.gy)).map((x) => { const [cx, cy] = pos.get(x.id)!; return `${svgBloc(x)}<text x="${cx}" y="${cy + 30}" font-family="sans-serif" font-size="12" font-weight="600" fill="#0f172a" text-anchor="middle">${esc(x.nom)}</text>${x.ip ? `<text x="${cx}" y="${cy + 44}" font-family="monospace" font-size="10" fill="#475569" text-anchor="middle">${esc(x.ip)}</text>` : ''}`; }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${r1(W)}" height="${r1(H)}" viewBox="${r1(a)} ${r1(b)} ${r1(W)} ${r1(H)}">\n<title>${esc(t.nom)}</title>\n<rect x="${r1(a)}" y="${r1(b)}" width="${r1(W)}" height="${r1(H)}" fill="#f8fafc"/>\n${liens}\n${blocs}\n</svg>\n`;
}
export const svgDe = (t: Dessin) => (t.genre === 'schema' ? svgSchema(t) : svgTableau(t));

/** Le genre de bloc d'un appareil de l'inventaire (d'après son type ou son nom). Pur. */
export function genreAppareil(kind: string, nom = ''): GenreBloc {
  const k = `${kind} ${nom}`.toLowerCase();
  if (/routeur|router|box|livebox|freebox|gateway|passerelle|modem/.test(k)) return 'box';
  if (/nas|synology|qnap|stockage/.test(k)) return 'nas';
  if (/cam|camera|caméra/.test(k)) return 'camera';
  if (/phone|téléphone|telephone|mobile|android|iphone|tablette|tablet/.test(k)) return 'telephone';
  if (/print|imprim/.test(k)) return 'imprimante';
  if (/switch|commutateur|point d'accès|access point|wifi/.test(k)) return 'switch';
  if (/serveur|server|proxmox|vm|hyperviseur/.test(k)) return 'serveur';
  return 'pc';
}
/** Range des appareils en schéma : la box au centre, les autres en couronnes autour, chacun relié à la box. Pur. */
export function schemaDepuis(appareils: Array<{ nom: string; genre: GenreBloc; ip?: string }>, base: { id: string; nom: string; maj: string }): Dessin {
  const blocs: Bloc[] = [], liens: Lien[] = [];
  const box = appareils.find((a) => a.genre === 'box');
  blocs.push({ id: 'b0', genre: 'nuage', gx: -3, gy: -3, nom: 'Internet' });
  blocs.push({ id: 'b1', genre: 'box', gx: 0, gy: 0, nom: box?.nom ?? 'Box', ...(box?.ip ? { ip: box.ip } : {}) });
  liens.push({ de: 'b0', vers: 'b1' });
  const autres = appareils.filter((a) => a !== box).slice(0, 120);
  // Couronnes de cases autour de la box : 8 places à 2 cases, 16 à 4 cases, etc.
  let n = 0;
  for (let r = 2; n < autres.length; r += 2) for (let gx = -r; gx <= r && n < autres.length; gx += 2) for (let gy = -r; gy <= r && n < autres.length; gy += 2) {
    if (Math.max(Math.abs(gx), Math.abs(gy)) !== r) continue;
    if (gx === -3 && gy === -3) continue;
    const a = autres[n++], id = `b${n + 1}`;
    blocs.push({ id, genre: a.genre, gx, gy, nom: a.nom.slice(0, 60), ...(a.ip ? { ip: a.ip } : {}) }); liens.push({ de: 'b1', vers: id });
  }
  return { ...base, genre: 'schema', formes: [], blocs, liens };
}
