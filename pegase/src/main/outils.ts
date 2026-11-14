// Petits outils du processus principal.
import { randomBytes } from 'node:crypto';

export const nouvelId = (prefixe = ''): string => prefixe + randomBytes(9).toString('base64url');

/** Transforme ce que la personne tape en adresse : une adresse, un nom de domaine, ou une recherche. */
export function versAdresse(texte: string, moteur: string, odin?: string): string {
  const t = texte.trim();
  if (!t) return '';
  // javascript: et data: tapés dans la barre ne sont jamais exécutés (on cherche le texte à la place).
  if (/^(javascript|data|vbscript):/i.test(t)) return adresseRecherche(t, moteur, odin);
  if (/^(https?|file|pegase|about|view-source):/i.test(t)) return t;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?(\/.*)?$/i.test(t)) return `http://${t}`;
  if (!/\s/.test(t) && /^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(t)) return `https://${t}`;
  return adresseRecherche(t, moteur, odin);
}

export function adresseRecherche(q: string, moteur: string, odin?: string): string {
  const e = encodeURIComponent(q);
  if (moteur === 'pythie' && odin) return `${odin}/?q=${e}`;
  if (moteur === 'google') return `https://www.google.com/search?q=${e}`;
  if (moteur === 'qwant') return `https://www.qwant.com/?q=${e}`;
  return `https://duckduckgo.com/?q=${e}`;
}

/** Le domaine lisible d'une adresse (sans « www. »). */
export function domaine(url: string): string {
  try { const u = new URL(url); return u.protocol.startsWith('http') ? u.hostname.replace(/^www\./, '') : url; } catch { return url; }
}

export const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
