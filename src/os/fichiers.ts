// Odin OS — l'appli Fichiers : le dossier personnel de l'utilisateur d'Odin, et rien d'autre.
// Garde-fous : on ne sort jamais du dossier personnel (liens symboliques compris), les dossiers cachés
// (.odin, .ssh, .config…) sont hors d'atteinte, supprimer = mettre à la corbeille (réversible).

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';

export const CORBEILLE = join('.local', 'share', 'Trash');
const MAX_TEXTE = 1024 * 1024, MAX_IMAGE = 4 * 1024 * 1024, MAX_ENTREES = 2000;
const IMAGES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' };
export class Refus extends Error {}
/** Sous Windows et macOS, le système range réglages, clés et données d'applis dans un dossier qu'il cache lui-même : hors d'atteinte aussi. */
const RESERVES = process.platform === 'win32' ? ['appdata'] : process.platform === 'darwin' ? ['library'] : [];
const reserve = (premier: string | undefined): boolean => !!premier && RESERVES.includes(premier.toLowerCase());

/** Le dossier personnel (testable : on peut en passer un autre). */
export const maison = (m?: string): string => realpathSync(m ?? homedir());
const dedans = (racine: string, c: string): boolean => c === racine || c.startsWith(racine + sep);
export const nomValide = (n: unknown): n is string => typeof n === 'string' && n.length > 0 && n.length <= 200 && !/[/\\\u0000-\u001f]/.test(n) && n !== '.' && n !== '..' && !n.startsWith('.');

/**
 * Transforme un chemin donné par le bureau en chemin sûr. Refuse : hors du dossier personnel, un dossier caché
 * (sauf la corbeille), un lien symbolique qui mène ailleurs.
 */
export function resoudre(chemin: unknown, m?: string): string {
  const racine = maison(m), brut = String(chemin ?? '').replace(/\u0000/g, '');
  const c = resolve(racine, brut.startsWith('~') ? `.${brut.slice(1)}` : brut || '.');
  if (!dedans(racine, c)) throw new Refus('Ce dossier est hors de ton espace personnel.');
  const relatif = c.slice(racine.length + 1), corbeille = join(CORBEILLE, 'files');
  if (relatif && relatif !== corbeille && !relatif.startsWith(corbeille + sep) && (relatif.split(sep).some((p) => p.startsWith('.')) || reserve(relatif.split(sep)[0]))) throw new Refus('Les dossiers cachés (réglages, clés, données d\'Odin) ne s\'ouvrent pas depuis Fichiers.');
  // Le premier ancêtre qui existe doit, une fois les liens suivis, rester dans le dossier personnel.
  let ancetre = c; while (!existsSync(ancetre) && ancetre !== racine) ancetre = dirname(ancetre);
  if (!dedans(racine, realpathSync(ancetre))) throw new Refus('Ce chemin passe par un lien qui sort de ton espace personnel.');
  return c;
}

export interface Entree { nom: string; dossier: boolean; taille: number | null; modifie: number }
export function lister(chemin: unknown, m?: string): { ok: true; chemin: string; maison: string; parent: string | null; entrees: Entree[] } {
  const racine = maison(m), c = resoudre(chemin, m);
  // Premier passage : les dossiers habituels existent (comme sur n'importe quel bureau).
  if (c === racine) for (const d of ['Bureau', 'Documents', 'Images', 'Musique', 'Téléchargements', 'Vidéos']) { try { if (!existsSync(join(racine, d))) mkdirSync(join(racine, d)); } catch { /* dossier personnel en lecture seule */ } }
  if (c === join(racine, CORBEILLE, 'files') && !existsSync(c)) mkdirSync(c, { recursive: true });
  let noms: string[]; try { if (!statSync(c).isDirectory()) throw new Error('fichier'); noms = readdirSync(c); } catch { throw new Refus('Dossier introuvable.'); }
  const entrees: Entree[] = [];
  for (const nom of noms) {
    if (nom.startsWith('.') || (c === racine && reserve(nom)) || entrees.length >= MAX_ENTREES) continue;
    try { const s = statSync(join(c, nom)); entrees.push({ nom, dossier: s.isDirectory(), taille: s.isDirectory() ? null : s.size, modifie: Math.round(s.mtimeMs) }); } catch { /* lien cassé : ignoré */ }
  }
  return { ok: true, chemin: c, maison: racine, parent: c === racine ? null : (dirname(c).startsWith(join(racine, '.local')) ? racine : dirname(c)), entrees };
}

export function lire(chemin: unknown, m?: string): { ok: true; nom: string; chemin: string; taille: number; genre: 'texte' | 'image' | 'autre'; texte?: string; image?: string } {
  const c = resoudre(chemin, m); let s; try { s = statSync(c); } catch { throw new Refus('Fichier introuvable.'); }
  if (!s.isFile()) throw new Refus('Ce n\'est pas un fichier.');
  const base = { ok: true as const, nom: basename(c), chemin: c, taille: s.size }, type = IMAGES[extname(c).toLowerCase()];
  if (type && s.size <= MAX_IMAGE) return { ...base, genre: 'image', image: `data:${type};base64,${readFileSync(c).toString('base64')}` };
  if (s.size <= MAX_TEXTE) { const b = readFileSync(c); if (!b.subarray(0, 8192).includes(0)) return { ...base, genre: 'texte', texte: b.toString('utf8') }; }
  return { ...base, genre: 'autre' };
}

/** Un nom libre dans un dossier : « a.txt », puis « a (2).txt »… */
function libre(dossier: string, nom: string): string {
  if (!existsSync(join(dossier, nom))) return nom;
  const ext = extname(nom), tronc = nom.slice(0, nom.length - ext.length);
  for (let i = 2; i < 1000; i++) if (!existsSync(join(dossier, `${tronc} (${i})${ext}`))) return `${tronc} (${i})${ext}`;
  throw new Refus('Trop de fichiers du même nom.');
}
export function operer(action: string, d: Record<string, unknown>, m?: string): { ok: true; chemin?: string; text?: string } {
  const racine = maison(m), c = resoudre(d.chemin, m), corbeille = join(racine, CORBEILLE);
  const dansCorbeille = dedans(corbeille, c);
  switch (action) {
    case 'dossier': case 'nouveau': {
      if (!nomValide(d.nom)) throw new Refus('Ce nom ne convient pas (pas de « / », pas de point au début).');
      if (dansCorbeille) throw new Refus('On ne crée rien dans la corbeille.');
      const cible = resoudre(join(c, d.nom), m); if (existsSync(cible)) throw new Refus('Ce nom existe déjà ici.');
      if (action === 'dossier') mkdirSync(cible); else writeFileSync(cible, '', { flag: 'wx' });
      return { ok: true, chemin: cible };
    }
    case 'renommer': {
      if (!nomValide(d.nom)) throw new Refus('Ce nom ne convient pas (pas de « / », pas de point au début).');
      if (c === racine || dansCorbeille || !existsSync(c)) throw new Refus('Impossible de renommer cet élément.');
      const cible = resoudre(join(dirname(c), d.nom), m); if (existsSync(cible)) throw new Refus('Ce nom existe déjà ici.');
      renameSync(c, cible); return { ok: true, chemin: cible };
    }
    case 'corbeille': {
      if (c === racine || dansCorbeille || !existsSync(c) || dirname(c) === racine && ['Bureau', 'Documents', 'Images', 'Musique', 'Téléchargements', 'Vidéos'].includes(basename(c))) throw new Refus('Cet élément ne se met pas à la corbeille.');
      // Corbeille standard (XDG) : le fichier va dans files/, sa fiche (d'où il vient, quand) dans info/.
      mkdirSync(join(corbeille, 'files'), { recursive: true }); mkdirSync(join(corbeille, 'info'), { recursive: true });
      const nom = libre(join(corbeille, 'files'), basename(c));
      writeFileSync(join(corbeille, 'info', `${nom}.trashinfo`), `[Trash Info]\nPath=${encodeURI(c)}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`);
      renameSync(c, join(corbeille, 'files', nom));
      return { ok: true, text: 'Mis à la corbeille.' };
    }
    case 'ecrire': {
      const texte = String(d.texte ?? ''); if (Buffer.byteLength(texte) > 2 * MAX_TEXTE) throw new Refus('Texte trop long pour l\'éditeur (2 Mo au plus).');
      if (dansCorbeille || !existsSync(c) || !lstatSync(c).isFile()) throw new Refus('Ce fichier ne peut pas être enregistré ici.');
      writeFileSync(c, texte); return { ok: true };
    }
    case 'vider': {
      if (d.confirm !== true) throw new Refus('Vider la corbeille efface les fichiers pour de bon : confirmation demandée.');
      for (const sous of ['files', 'info']) { const dir = join(corbeille, sous); if (existsSync(dir)) for (const f of readdirSync(dir)) rmSync(join(dir, f), { recursive: true, force: true }); }
      return { ok: true, text: 'Corbeille vidée.' };
    }
    default: throw new Refus('Action inconnue.');
  }
}
