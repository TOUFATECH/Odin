// Mathésis — les interdits du propriétaire : un sujet, un site ou un dossier qu'Odin ne doit jamais chercher, lire
// ni regarder. Purs, sauf le rangement (magasin). Un interdit ne se lève que par le propriétaire.
import { resolve, sep } from 'node:path';
import type { Magasin } from './magasin.ts';
import type { Interdits } from './types.ts';
import { plier } from './outils.ts';

export const interditsVides = (): Interdits => ({ sujets: [], sites: [], dossiers: [] });

/** Un nom de site ramené à sa forme simple (« https://www.Exemple.fr/x » → « exemple.fr »). */
export function siteSimple(x: string): string {
  const s = String(x ?? '').trim().toLowerCase();
  let h = s;
  try { if (/^[a-z]+:\/\//.test(s)) h = new URL(s).hostname; } catch { /* garde le texte */ }
  return h.replace(/^\*\./, '').replace(/^www\./, '').replace(/\.+$/, '').replace(/\/.*$/, '');
}

/** Un sujet est-il interdit ? (un des sujets interdits apparaît, replié, dans le texte) */
export function sujetInterdit(i: Interdits, texte: string): boolean {
  const net = (x: string) => plier(x).replace(/[^a-z0-9]+/g, ' ').trim();
  const t = ` ${net(texte)} `;
  return i.sujets.some((s) => { const p = net(s); return p.length > 0 && t.includes(` ${p} `); });
}

/** Une adresse est-elle sur un site interdit ? (le site lui-même et tous ses sous-domaines) */
export function siteInterdit(i: Interdits, url: string): boolean {
  let h: string;
  try { h = new URL(url).hostname.toLowerCase().replace(/\.+$/, ''); } catch { return true; } // illisible : interdit
  return i.sites.some((s) => { const x = siteSimple(s); return x.length > 0 && (h === x || h.endsWith(`.${x}`)); });
}

/** Un chemin est-il dans un dossier interdit ? (point de branchement : le réseau de la maison, passage suivant) */
export function dossierInterdit(i: Interdits, chemin: string): boolean {
  const c = resolve(chemin).toLowerCase();
  return i.dossiers.some((d) => { const x = resolve(d).toLowerCase(); return c === x || c.startsWith(x.endsWith(sep) ? x : x + sep); });
}

/** Les interdits rangés, avec ajout et retrait. */
export class RegistreInterdits {
  private readonly magasin: Magasin;
  constructor(magasin: Magasin) { this.magasin = magasin; }
  lire(): Interdits { const i = this.magasin.lire<Interdits>('interdits', interditsVides()); return { sujets: [...(i.sujets ?? [])], sites: [...(i.sites ?? [])], dossiers: [...(i.dossiers ?? [])] }; }
  interdire(genre: keyof Interdits, valeur: string): Interdits {
    const v = genre === 'sites' ? siteSimple(valeur) : String(valeur ?? '').trim();
    if (!v) throw new Error('interdit vide');
    const i = this.lire();
    if (!i[genre].includes(v)) i[genre] = [...i[genre], v].slice(-500);
    this.magasin.ecrire('interdits', i);
    return i;
  }
  permettre(genre: keyof Interdits, valeur: string): Interdits {
    const v = genre === 'sites' ? siteSimple(valeur) : String(valeur ?? '').trim();
    const i = this.lire();
    i[genre] = i[genre].filter((x) => x !== v);
    this.magasin.ecrire('interdits', i);
    return i;
  }
}
