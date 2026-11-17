// Outils communs de l'interface.
import type { Etat, PegaseApi } from '../commun/types';
import odinIcones from './odin-icones.json';

export const api = (window as unknown as { pegase: PegaseApi }).pegase;
export const APPS = odinIcones as Record<string, { nom: string; svg: string }>;

export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Une image sûre (http, https, data:image) ou rien. */
export const srcSure = (u?: string): string => (u && /^(https?:|data:image\/)/.test(u) ? u : '');

export const appIcone = (id: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(APPS[id]?.svg ?? '')}`;

export function domaine(url: string): string {
  try { const u = new URL(url); if (u.protocol === 'pegase:') return `pegase://${u.host}`; return u.hostname.replace(/^www\./, '') || url; } catch { return url; }
}

/** La couleur (classe c0…c7) d'une lettre, tirée du texte pour qu'elle reste la même. */
export function couleurDe(t: string): number { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 8; }

/** L'icône d'un site : son favicon, sinon une lettre de couleur. */
export function iconeSite(url: string, icone?: string, titre?: string, cls = 'ic'): string {
  const s = srcSure(icone);
  const app = appliDe(url);
  if (app) return `<img class="${cls}" src="${appIcone(app)}" alt="">`;
  const d = url.startsWith('pegase://') ? (titre || 'P') : domaine(url) || titre || '?';
  const l = d === 'Nouvel onglet' ? '+' : d.replace(/^pegase:\/\//, '').slice(0, 1).toUpperCase();
  if (s) return `<img class="${cls}" src="${esc(s)}" alt="" loading="lazy" data-l="${esc(l)}" data-c="${couleurDe(domaine(url))}">`;
  return `<span class="ltr c${couleurDe(domaine(url))}${cls === 'ic' ? '' : ' ' + cls}" aria-hidden="true">${esc(l)}</span>`;
}

let odinUrl = '';
export function setOdin(u?: string): void { odinUrl = (u || '').replace(/\/$/, ''); }
export function getOdin(): string { return odinUrl; }
/** Une adresse d'Odin qui ouvre une de ses applis (#app=<id>) → l'identifiant de l'appli. */
export function appliDe(url: string): string | null {
  if (!odinUrl || !url.startsWith(odinUrl)) return null;
  const m = /#app=([a-z0-9_-]+)/.exec(url); return m && APPS[m[1]] ? m[1] : null;
}

export const PAGES_INTERNES: Record<string, string> = {
  accueil: 'Nouvel onglet', favoris: 'Favoris', historique: 'Historique', reglages: 'Réglages', telechargements: 'Téléchargements',
  agenda: 'Agenda', importer: 'Importer', profil: 'Ton profil', synchro: 'Synchro Odin', aide: 'Aide',
};
export function titreOnglet(url: string, titre: string): string {
  if (url.startsWith('pegase://')) { const n = url.slice(9).replace(/\/.*$/, ''); return PAGES_INTERNES[n] ?? titre ?? url; }
  return titre || domaine(url);
}

export function quand(t: number): string {
  const d = new Date(t), now = new Date();
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(now) - jour(d)) / 86400000);
  if (ecart === 0) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (ecart === 1) return 'hier';
  if (ecart < 7) return d.toLocaleDateString('fr-FR', { weekday: 'long' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
export function taille(o: number): string {
  if (o < 1024) return `${o} o`;
  if (o < 1024 * 1024) return `${Math.round(o / 1024)} Ko`;
  if (o < 1024 ** 3) return `${(o / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
  return `${(o / 1024 ** 3).toFixed(2).replace('.', ',')} Go`;
}
export function minutes(s: number): string { if (!Number.isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60), r = Math.floor(s % 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`; }

export type Ctx = { etat: () => Etat; rendre: () => void; toast: (t: string) => void; ouvrir: (url: string, nouvel?: boolean) => void };

export const LOGO = (taille = 72) => `<img class="logo" width="${taille}" height="${taille}" src="${new URL('./pegase.svg', import.meta.url).href}" alt="Pégase">`;
