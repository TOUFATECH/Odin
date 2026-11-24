// Vortex · « Ajouter un appareil » (maquette « Réseau » validée, lot R8). Ici, la partie pure (aucune prise réseau, aucun
// fichier, aucune commande) : ce que le propriétaire a tapé est vérifié avant de créer quoi que ce soit.
//  - `nomAppareil` : le nom, nettoyé et borné (il part dans un fichier de configuration et un nom de fichier) ;
//  - `accesDemande` : toute la maison, Internet par la maison, ou seulement certaines adresses de la maison ;
//  - `finDemandee` : la date de fin, une vraie date ;
//  - `dessinSur` : le dessin du QR code que la page reçoit (des cases, rien d'autre).
import { isPrivateV4 } from '../../hlidskjalf/discover.ts';
import { dessin, traceSur, type DessinQr } from '../qr.ts';

/** Ce que le propriétaire choisit pour l'accès d'un appareil. */
export type Acces = 'maison' | 'internet' | 'adresses';
export const ACCES: readonly Acces[] = ['maison', 'internet', 'adresses'];
/** Au plus tant d'adresses dans « seulement certaines adresses » (la configuration doit tenir dans un QR code). */
export const MAX_ADRESSES = 12;

/**
 * Le nom d'un appareil : lettres et chiffres de toutes les écritures (avec leurs signes : voyelles du thaï, du hindi, de
 * l'arabe…), espaces et . _ ' - ; 40 caractères au plus ; espaces en trop retirés. Aucun caractère caché ni de mise en page.
 */
export function nomAppareil(v: unknown): string {
  const n = String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!/^[\p{L}\p{N}\p{M} _.'-]{1,40}$/u.test(n) || !/[\p{L}\p{N}]/u.test(n) || /^\p{M}/u.test(n)) throw new Error('nom : lettres, chiffres, espaces, 40 au plus');
  return n;
}

const octets = (ip: string): number[] | undefined => { const p = ip.split('.').map(Number); return p.length === 4 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ? p : undefined; };
const nombre = (p: number[]): number => ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
/** « 10.0.0.0/24 » → son début, sa fin et sa taille ; mal écrit : rien. */
function plage(cidr: string): { debut: number; fin: number; bits: number } | undefined {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/.exec(cidr.trim()); if (!m) return undefined;
  const p = octets(m[1]), bits = m[2] === undefined ? 32 : Number(m[2]); if (!p || bits < 0 || bits > 32) return undefined;
  const taille = 2 ** (32 - bits), debut = Math.floor(nombre(p) / taille) * taille;
  return { debut, fin: debut + taille - 1, bits };
}
const enTexte = (n: number): string => [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.');

/**
 * « Seulement certaines adresses » : chaque adresse (ou petit réseau) doit être DANS un réseau de la maison ouvert au VPN.
 * Jamais une adresse d'Internet, jamais « tout ». Rend la liste remise au propre (« 10.0.0.10/32 »). Pur.
 */
export function adressesSeules(texte: unknown, maison: readonly string[]): string[] {
  const l = String(texte ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  if (!l.length) throw new Error('écris au moins une adresse de la maison (10.0.0.10), ou choisis un autre accès. Rien n\'est créé.');
  if (l.length > MAX_ADRESSES) throw new Error(`${MAX_ADRESSES} adresses au plus. Rien n'est créé.`);
  const ouverts = maison.map(plage).filter((x): x is NonNullable<ReturnType<typeof plage>> => Boolean(x)), out: string[] = [];
  for (const brut of l) {
    if (brut.length > 18) throw new Error('adresse attendue sous la forme 10.0.0.10 ou 10.0.0.0/28. Rien n\'est créé.');
    const p = plage(brut);
    if (!p || p.bits < 16) throw new Error(`« ${brut.replace(/[^0-9./]/g, '?')} » : adresse attendue sous la forme 10.0.0.10 ou 10.0.0.0/28. Rien n'est créé.`);
    const propre = `${enTexte(p.debut)}/${p.bits}`;
    if (!isPrivateV4(enTexte(p.debut)) || !isPrivateV4(enTexte(p.fin))) throw new Error(`${propre} n'est pas une adresse de la maison. Rien n'est créé.`);
    if (!ouverts.some((o) => p.debut >= o.debut && p.fin <= o.fin)) throw new Error(`${propre} n'est dans aucun réseau de la maison ouvert au VPN (${maison.join(', ') || 'aucun'}). Rien n'est créé.`);
    if (!out.includes(propre)) out.push(propre);
  }
  return out;
}

/**
 * L'accès demandé. `acces` (la page) passe avant `tout` (l'ancien réglage) : « internet » = tout le trafic par la maison,
 * « maison » = les réseaux de la maison, « adresses » = seulement celles données. Pur.
 */
export function accesDemande(i: { acces?: unknown; tout?: unknown; adresses?: unknown }, maison: readonly string[]): { full: boolean; seules?: string[] } {
  const a = String(i.acces ?? '').trim();
  if (!a) return { full: i.tout !== false };
  if (!(ACCES as readonly string[]).includes(a)) throw new Error('accès : « maison », « internet » ou « adresses ». Rien n\'est créé.');
  if (a === 'internet') return { full: true };
  if (a === 'maison') return { full: false };
  return { full: false, seules: adressesSeules(i.adresses, maison) };
}

/** La date de fin d'accès : vide (sans fin), ou une vraie date AAAA-MM-JJ. Pur. */
export function finDemandee(v: unknown): string {
  const fin = String(v ?? '').trim(); if (!fin) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fin), d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : undefined;
  if (!m || !d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== fin) throw new Error('date attendue sous la forme 2026-12-31');
  return fin;
}

/** Le dessin du QR code d'une configuration : des cases et leur marge blanche. `undefined` : la configuration est trop longue pour un QR code. */
export function dessinSur(conf: string): DessinQr | undefined {
  try { const q = dessin(conf, { ecc: 'L', margin: 4 }); return traceSur(q.d) ? q : undefined; } catch { return undefined; }
}
