// Pygmalion — le dossier de sortie sûr. Un fichier produit est TOUJOURS écrit dans le dossier prévu, jamais ailleurs :
//   - le nom est nettoyé (aucun séparateur, aucun « .. », aucun nom réservé de Windows — CON, PRN, AUX, NUL, COM1…,
//     LPT1… —, aucun point ni espace final, aucun caractère interdit, 120 caractères au plus) ;
//   - le dossier est résolu en son chemin RÉEL et la destination doit y rester ; une destination qui est un lien ou une
//     jonction est refusée ;
//   - rien n'est ÉCRASÉ : si le nom existe, on en prend un autre (« nom (2).ext ») ; remplacer n'est possible qu'avec
//     l'accord explicite du propriétaire ET seulement pour une création d'Odin (jamais un fichier à lui) ;
//   - écriture atomique (fichier temporaire, puis posé par un lien qui échoue si le nom a été pris entre-temps) : une
//     coupure ne laisse jamais un fichier à moitié écrit, et un fichier apparu entre le contrôle et la pose n'est pas écrasé.
import { constants, copyFileSync, linkSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path';
import { randomBytes } from 'node:crypto';

const RESERVES = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$|clock\$)$/i;

/** Un nom de fichier sûr (sans chemin), avec son extension. Lève si rien d'utilisable ne reste. */
export function nomSur(brut: string, ext: string): string {
  let n = String(brut ?? '').normalize('NFC')
    // contrôles, interdits Windows, séparateurs, caractères invisibles et de sens d'écriture (noms trompeurs)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]/g, ' ')
    .replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').trim()
    .replace(/^[.\s-]+|[.\s]+$/g, '');
  n = n.slice(0, 120).replace(/[.\s]+$/g, '');
  const e = ext.replace(/^\.+/, '').toLowerCase();
  // l'extension déjà présente n'est pas doublée
  if (n.toLowerCase().endsWith(`.${e}`)) n = n.slice(0, -(e.length + 1)).replace(/[.\s]+$/g, '');
  const racine = n.split('.')[0];
  if (!n || RESERVES.test(racine)) n = `creation-odin${n ? `-${n}` : ''}`;
  return `${n}.${e}`;
}

/** Le chemin réel d'un dossier de sortie (créé au besoin). */
export function dossierReel(dossier: string): string {
  if (!isAbsolute(dossier)) throw new Error('dossier de sortie : chemin complet attendu');
  mkdirSync(dossier, { recursive: true });
  return realpathSync(dossier);
}

/** Ce chemin est-il DANS ce dossier (ou égal) ? Pur (insensible à la casse sous Windows, via path.relative). */
export function dedans(chemin: string, dossier: string): boolean {
  const r = relative(dossier, chemin);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

/**
 * Pose `tmp` sous le nom `cible` SANS JAMAIS écraser : si `cible` existe (même apparu une fraction de seconde après le
 * contrôle, par une synchronisation ou un autre programme), lève EEXIST et rien n'est remplacé. Un lien dur échoue si la
 * destination existe ; là où les liens durs ne sont pas permis, copie exclusive (COPYFILE_EXCL). Le temporaire est retiré.
 */
export function poserSansEcraser(tmp: string, cible: string): void {
  try { linkSync(tmp, cible); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw e;
    copyFileSync(tmp, cible, constants.COPYFILE_EXCL);
  }
  unlinkSync(tmp);
}

export interface Ecrit { chemin: string; relatif: string; remplace: boolean }

/**
 * Écrit un fichier dans le dossier de sortie, sans jamais écraser ni sortir. `remplacer` : accord explicite du
 * propriétaire ET le fichier existant est une création d'Odin restée telle quelle (`estCreation`, qui reçoit aussi le
 * chemin complet pour comparer le contenu actuel) — sinon un nouveau nom est pris.
 */
export function ecrireSur(dossier: string, nom: string, octets: Buffer, o: { remplacer?: boolean; estCreation?: (relatif: string, chemin: string) => boolean } = {}): Ecrit {
  const reel = dossierReel(dossier);
  const ext = extname(nom).slice(1) || 'bin';
  const base = basename(nom, extname(nom));
  let cible = join(reel, nom), n = 1;
  const tmp = join(reel, `.pygmalion-${randomBytes(6).toString('hex')}.tmp`);
  writeFileSync(tmp, octets, { flag: 'wx', mode: 0o644 });
  try {
    for (;;) {
      if (!dedans(cible, reel) || dirname(cible) !== reel) throw new Error('destination hors du dossier de sortie : refusée');
      let st;
      try { st = lstatSync(cible); } catch { st = undefined; }
      if (!st) {
        // posé sans jamais écraser ; si le nom a été pris entre le contrôle et la pose, on regarde ce nom à nouveau
        try { poserSansEcraser(tmp, cible); return { chemin: cible, relatif: relative(reel, cible), remplace: false }; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; continue; }
      }
      if (st.isSymbolicLink()) throw new Error('la destination est un lien : refusée');
      if (o.remplacer && st.isFile() && o.estCreation?.(relative(reel, cible), cible)) {
        renameSync(tmp, cible); // une création d'Odin restée telle quelle, avec l'accord du propriétaire
        return { chemin: cible, relatif: relative(reel, cible), remplace: true };
      }
      n++;
      if (n > 999) throw new Error('trop de fichiers du même nom');
      cible = join(reel, `${base} (${n}).${ext}`);
    }
  } finally { rmSync(tmp, { force: true }); }
}
