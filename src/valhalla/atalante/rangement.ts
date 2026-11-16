// Atalante · avant et après un téléchargement.
// Avant : le lien est vérifié (lienPropre), une adresse de la maison demande ton accord (lienDeMaison), le nom est
// résolu pour voir où il mène vraiment, et Asclépios dit si le site est connu comme dangereux (refus si connu, ou
// score de 70 ou plus).
// Après : le fichier passe par la quarantaine d'abord (quarantaineDabord, commun à tout Odin). Bloqué : il reste en
// quarantaine. Sain : une ISO ou une image disque va chez Hydre (importer_iso), un installateur chez Hermès
// (importer_logiciel), le reste est rangé par type dans le dossier réglé. Rien n'est recopié de leur code.
import { lookup } from 'node:dns/promises';
import { existsSync, mkdirSync, renameSync, copyFileSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { ModCtx } from '../types.ts';
import { hoteInterdit, lienDeMaison, lienPropre } from '../lien.ts';
import { isPrivateHost } from '../../heimdall/policy.ts';
import { quarantaineDabord, type Passage } from '../ullr/garde.ts';
import { MOTIF_LOGICIEL } from '../forge/logiciels.ts';

export type Resoudre = (hote: string) => Promise<string[]>;
export const RESOUDRE_SYSTEME: Resoudre = async (h) => (await lookup(h, { all: true })).map((a) => a.address);
export const SCORE_REFUS = 70;

export type Type = 'Documents' | 'Images' | 'Vidéos' | 'Musique' | 'Archives' | 'Autres';
export const TYPES: Type[] = ['Documents', 'Images', 'Vidéos', 'Musique', 'Archives', 'Autres'];
const EXT: Record<Exclude<Type, 'Autres'>, RegExp> = {
  Documents: /\.(pdf|docx?|odt|xlsx?|ods|pptx?|odp|txt|md|rtf|csv|epub)$/i,
  Images: /\.(jpe?g|png|gif|webp|svg|bmp|tiff?|heic|avif)$/i,
  'Vidéos': /\.(mp4|mkv|avi|mov|webm|m4v|wmv|flv)$/i,
  Musique: /\.(mp3|flac|ogg|opus|wav|m4a|aac|wma)$/i,
  Archives: /\.(7z|rar|tar|gz|tgz|bz2|xz|zst)$/i,
};
export const MOTIF_IMAGE_DISQUE = /\.(iso|img|qcow2|vmdk|vdi|vhdx?)$/i;
/** Où va un fichier sain : Hydre (ISO, image disque), Hermès (installateur), ou un dossier par type. Pur. */
export function destinationDe(nom: string): { vers: 'ymir' | 'fjalar' } | { vers: 'dossier'; type: Type } {
  if (MOTIF_IMAGE_DISQUE.test(nom)) return { vers: 'ymir' };
  if (MOTIF_LOGICIEL.test(nom) && !/\.zip$/i.test(nom)) return { vers: 'fjalar' };
  for (const [t, re] of Object.entries(EXT)) if (re.test(nom)) return { vers: 'dossier', type: t as Type };
  return { vers: 'dossier', type: /\.zip$/i.test(nom) ? 'Archives' : 'Autres' };
}

/** L'hôte et le chemin d'un lien, sans paramètres ni identifiant (pour l'historique). Pur. */
export function lienSansParametres(lien: string): string { try { const u = new URL(lien); return `${u.host}${u.pathname}`; } catch { return '?'; } }

/**
 * Le lien est-il acceptable ? Lève une erreur claire sinon. `maison` : ton accord pour une adresse de ton réseau
 * (l'action d'ajout est alors grave). Rend le lien vérifié.
 */
export async function avant(ctx: ModCtx, lien: string, o: { maison?: boolean; resoudre?: Resoudre } = {}): Promise<URL> {
  const u = lienPropre(lien);
  if (lienDeMaison(lien) && !o.maison) throw new Error('ce lien pointe vers ton réseau : il faut ton accord');
  const adresses = await (o.resoudre ?? RESOUDRE_SYSTEME)(u.hostname.replace(/^\[|\]$/g, '')).catch(() => [] as string[]);
  if (adresses.some(hoteInterdit)) throw new Error(`${u.hostname} mène à la machine d'Odin elle-même ou à une adresse réservée : refusé`);
  if (!o.maison && adresses.some((a) => isPrivateHost(a))) throw new Error(`${u.hostname} mène à une adresse de ton réseau : donne plutôt son adresse IP (Odin te demandera ton accord)`);
  await avisSite(ctx, u.toString());
  return u;
}
/** Asclépios connaît-il ce site comme dangereux ? (refus si oui, ou score de 70 ou plus). */
export async function avisSite(ctx: ModCtx, lien: string): Promise<void> {
  if (!ctx.modules().some((m) => m.id === 'ullr')) return;
  const r = await ctx.call('ullr', 'adresse', { lien }, 'Atalante vérifie le site avant de télécharger', { interne: true }).catch(() => undefined);
  const d = r?.data as { connu?: unknown; score?: number } | undefined;
  if (d?.connu) throw new Error('Asclépios connaît ce site comme dangereux : téléchargement refusé');
  if ((d?.score ?? 0) >= SCORE_REFUS) throw new Error(`Asclépios juge ce lien risqué (score ${d!.score}/100) : téléchargement refusé`);
}

export interface Arrive { verdict: 'sain' | 'bloque' | 'douteux'; rangement: string; chemin?: string; texte: string; passage: Passage }
const libre = (dossier: string, nom: string) => {
  let f = join(dossier, nom); const e = extname(nom), b = basename(nom, e);
  for (let k = 2; existsSync(f) && k < 1000; k++) f = join(dossier, `${b} (${k})${e}`);
  return f;
};
const deplacer = (de: string, vers: string) => { try { renameSync(de, vers); } catch { copyFileSync(de, vers); rmSync(de, { force: true }); } };

/** Après le téléchargement : quarantaine d'abord, puis Hydre, Hermès ou un dossier par type. */
export async function apres(ctx: ModCtx, fichier: string, o: { source: string; dossier: string }): Promise<Arrive> {
  const nom = basename(fichier);
  const p = await quarantaineDabord({ origine: 'Atalante · téléchargement', fichier, source: o.source }, ctx);
  if (p.bloque) return { verdict: 'bloque', rangement: 'quarantaine', texte: `bloqué par Asclépios : ${p.menace ?? p.texte}`, passage: p };
  const verdict: Arrive['verdict'] = p.ok ? 'sain' : 'douteux';
  const d = destinationDe(nom);
  if (d.vers !== 'dossier' && ctx.modules().some((m) => m.id === d.vers)) {
    const r = d.vers === 'ymir'
      ? await ctx.call('ymir', 'importer_iso', { chemin: fichier }, 'Atalante range une ISO téléchargée', { interne: true }).catch((e) => ({ ok: false, text: (e as Error).message }))
      : await ctx.call('fjalar', 'importer_logiciel', { chemin: fichier }, 'Atalante range un logiciel téléchargé', { interne: true }).catch((e) => ({ ok: false, text: (e as Error).message }));
    if (r.ok !== false) return { verdict, rangement: d.vers === 'ymir' ? 'Hydre (ISO)' : 'Hermès (logiciels)', texte: r.text.slice(0, 200), passage: p };
  }
  const type = d.vers === 'dossier' ? d.type : 'Autres', dossier = join(o.dossier, type);
  mkdirSync(dossier, { recursive: true });
  const dest = libre(dossier, nom);
  if (existsSync(fichier)) deplacer(fichier, dest);
  return { verdict, rangement: type, chemin: dest, texte: `rangé dans ${type}`, passage: p };
}
