// Achille · les petits outils : encoder et décoder un texte, lire un jeton JWT (sans vérifier sa signature, et le dire),
// comparer deux réponses, et masquer les valeurs secrètes avant de les écrire au journal. Tout est pur.

export const MASQUE = '●●●●';
const NOMS_SECRETS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key']);
/** Un nom d'en-tête ou de paramètre dont la valeur est secrète ? */
export const nomSecret = (n: string) => NOMS_SECRETS.has(n.toLowerCase()) || /token|key|secret|pass|session/i.test(n);
/** Les en-têtes, avec les valeurs secrètes remplacées par ●●●●. */
export function masquerEntetes(h: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) { if (v === undefined) continue; out[k.toLowerCase()] = nomSecret(k) ? MASQUE : (Array.isArray(v) ? v.join(', ') : String(v)).slice(0, 500); }
  return out;
}
/** Le lien, avec les valeurs des paramètres secrets (?token=, ?api_key=…) remplacées par ●●●● ; sans identifiant. */
export function masquerUrl(raw: string): string {
  try {
    const u = new URL(raw); u.username = ''; u.password = '';
    for (const k of [...u.searchParams.keys()]) if (nomSecret(k)) u.searchParams.set(k, MASQUE);
    return u.toString().replace(/%E2%97%8F/g, '●');
  } catch { return raw.replace(/([?&][^=&]*(?:token|key|secret|pass|session)[^=&]*=)[^&#]*/gi, `$1${MASQUE}`); }
}

// ---------------------------------------------------------------- Encodeur et décodeur
export const FORMATS = ['base64', 'base64url', 'url', 'html', 'hex'] as const;
export type Format = typeof FORMATS[number];
const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
export function encoder(f: Format, t: string): string {
  switch (f) {
    case 'base64': return Buffer.from(t, 'utf8').toString('base64');
    case 'base64url': return Buffer.from(t, 'utf8').toString('base64url');
    case 'url': return encodeURIComponent(t);
    case 'html': return t.replace(/[&<>"']/g, (c) => ENT[c]);
    case 'hex': return Buffer.from(t, 'utf8').toString('hex');
  }
}
export function decoder(f: Format, t: string): string {
  switch (f) {
    case 'base64': { const x = t.replace(/\s+/g, ''); if (!/^[A-Za-z0-9+/]*={0,2}$/.test(x)) throw new Error('ce n\'est pas du base64'); return Buffer.from(x, 'base64').toString('utf8'); }
    case 'base64url': { const x = t.trim(); if (!/^[A-Za-z0-9_-]*={0,2}$/.test(x)) throw new Error('ce n\'est pas du base64url'); return Buffer.from(x, 'base64url').toString('utf8'); }
    case 'url': try { return decodeURIComponent(t.replace(/\+/g, ' ')); } catch { throw new Error('encodage URL invalide'); }
    case 'html': return t.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (_m, e: string) => {
      const l = e.toLowerCase();
      if (l.startsWith('#x')) return String.fromCodePoint(parseInt(l.slice(2), 16));
      if (l.startsWith('#')) return String.fromCodePoint(Number(l.slice(1)));
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' } as Record<string, string>)[l] ?? _m;
    });
    case 'hex': { const x = t.replace(/\s+/g, ''); if (!/^(?:[0-9a-f]{2})*$/i.test(x)) throw new Error('ce n\'est pas de l\'hexadécimal'); return Buffer.from(x, 'hex').toString('utf8'); }
  }
}
/** Lit un jeton JWT SANS vérifier sa signature (Achille n'a pas la clé) : c'est dit dans `note`. */
export function lireJwt(t: string): { entete: unknown; charge: unknown; note: string; expire?: string } {
  const p = t.trim().split('.');
  if (p.length < 2) throw new Error('ce n\'est pas un jeton JWT (trois parties séparées par des points)');
  const lire = (x: string) => { try { return JSON.parse(Buffer.from(x, 'base64url').toString('utf8')) as unknown; } catch { throw new Error('jeton JWT illisible'); } };
  const charge = lire(p[1]) as { exp?: number };
  return { entete: lire(p[0]), charge, note: 'Signature NON vérifiée : ce décodage montre le contenu, il ne prouve pas que le jeton est authentique.', ...(typeof charge?.exp === 'number' ? { expire: new Date(charge.exp * 1000).toISOString() } : {}) };
}

// ---------------------------------------------------------------- Comparaison de deux réponses
export interface Reponse { code: number; entetes: Record<string, string>; corps: string }
export interface Difference { code?: [number, number]; entetes: Array<{ nom: string; a?: string; b?: string }>; lignes: Array<{ genre: '=' | '-' | '+'; texte: string }>; tronque: boolean; identiques: boolean }
/** Compare deux réponses : code, en-têtes, et différence ligne par ligne des 2000 premières lignes. */
export function comparer(a: Reponse, b: Reponse): Difference {
  const ent: Difference['entetes'] = [];
  for (const k of [...new Set([...Object.keys(a.entetes), ...Object.keys(b.entetes)])].sort()) if (a.entetes[k] !== b.entetes[k]) ent.push({ nom: k, ...(a.entetes[k] !== undefined ? { a: a.entetes[k] } : {}), ...(b.entetes[k] !== undefined ? { b: b.entetes[k] } : {}) });
  const la = a.corps.split('\n'), lb = b.corps.split('\n'), tronque = la.length > 2000 || lb.length > 2000;
  const lignes = diff(la.slice(0, 2000), lb.slice(0, 2000));
  return { ...(a.code !== b.code ? { code: [a.code, b.code] as [number, number] } : {}), entetes: ent, lignes, tronque, identiques: a.code === b.code && !ent.length && lignes.every((l) => l.genre === '=') && !tronque };
}
/** Différence ligne par ligne (plus longue sous-suite commune). */
export function diff(a: string[], b: string[]): Difference['lignes'] {
  const n = a.length, m = b.length, w = m + 1, t = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = a[i] === b[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  const out: Difference['lignes'] = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ genre: '=', texte: a[i] }); i++; j++; } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) out.push({ genre: '-', texte: a[i++] }); else out.push({ genre: '+', texte: b[j++] });
  }
  while (i < n) out.push({ genre: '-', texte: a[i++] });
  while (j < m) out.push({ genre: '+', texte: b[j++] });
  return out;
}
