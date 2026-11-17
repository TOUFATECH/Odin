// Médias reçus : préparer le rangement d'un fichier compris (rien n'est écrit ici). Ce qu'il faut apprendre (faits
// tirés SEULEMENT de la fiche et des textes lus ou dits, jamais d'un résumé), le fait de réception, la note du Cerveau
// (sensibles masqués, sujets en liens [[…]] pour que le Cerveau relie de lui-même), la fiche complète à garder sur la
// machine, et la décision de supprimer le fichier d'origine : seulement un téléchargement d'Odin INSCRIT au registre
// (telecharges.ts) avec la même empreinte, déjà compris sans manque, jamais un fichier du propriétaire.
// Aucun fait ne contient une position, une heure de prise de vue, un numéro de série, un compte ou un courriel.
// Les étiquettes du fichier sont un CONTENU EXTÉRIEUR : une valeur ne devient un fait ou un sujet que si elle a l'air
// d'un nom (courte, sans ponctuation de phrase ni lien) et qu'elle ne ressemble pas à une consigne.

import { realpathSync } from 'node:fs';
import { relative, sep } from 'node:path';
import type { Compris } from './comprendre.ts';
import { comprisEnTexte } from './comprendre.ts';
import type { Briques, CodeManque, Famille } from './contrat.ts';
import { nomLangue } from './langues-codes.ts';
import { bornerGraphemes, pourAffichage } from './octets.ts';
import { estTelechargementInscrit } from './telecharges.ts';

export type Provenance = 'joint' | 'telecharge' | 'bibliotheque' | 'camera' | 'messagerie';
export interface PreparationRangement {
  /** L'apport pour apprendreDeTout (src/learn/apprendre-de-tout.ts), sans rien de sensible dans les faits. */
  apport: { sorte: 'lecture'; source: string; date: number; faits: Array<{ texte: string; sujet?: string; cle?: string }>; texte?: string };
  /**
   * Le fait de réception. `proprietaire: true` SEULEMENT si l'auteur est vérifié comme le propriétaire ; son texte ne
   * contient jamais le nom ni le titre du fichier (choisis par l'expéditeur) : ils sont dans `source`.
   */
  reception: { sorte: 'note'; source: string; date: number; proprietaire: boolean; faits: Array<{ texte: string; sujet?: string }> };
  /** La note du Cerveau (genre « média ») : titre, corps en Markdown (sensibles masqués, sujets en [[liens]]), étiquettes, sujets à relier. */
  note: { titre: string; corps: string; etiquettes: string[]; sujets: string[]; genre: Famille };
  /** La fiche complète (avec sensibles) à garder SUR LA MACHINE, en JSON. */
  ficheLocale: { empreinte: string; compris: Compris };
  /** Suppression du fichier d'origine après rangement. */
  suppression: { supprimer: boolean; raison: string };
}

export interface OptionsRangement {
  provenance: Provenance; chemin: string; workspace: string; quand: number; canal?: string;
  /**
   * Vrai seulement si l'auteur est VÉRIFIÉ comme le propriétaire (page locale, caméra). Défaut : vrai pour 'joint',
   * 'camera' et 'bibliotheque', faux pour 'messagerie' et 'telecharge' (l'expéditeur peut être un tiers).
   */
  parLeProprietaire?: boolean;
  /** Le détecteur de consignes (src/heimdall) : une valeur qui ressemble à un ordre ne devient ni fait ni sujet. */
  detecterConsignes?: Briques['detecterConsignes'];
}

const MOTS_FAMILLE: Record<Famille, string> = { image: 'L\'image', son: 'Le son', video: 'La vidéo', document: 'Le document', texte: 'Le texte', 'sous-titres': 'Les sous-titres', archive: 'L\'archive', inconnu: 'Le fichier' };
const UN_FAMILLE: Record<Famille, string> = { image: 'une image', son: 'un son', video: 'une vidéo', document: 'un document', texte: 'un texte', 'sous-titres': 'des sous-titres', archive: 'une archive', inconnu: 'un fichier' };
const d2 = (n: number) => String(n).padStart(2, '0');

/** Les manques qui empêchent de supprimer : le fichier n'est pas encore vraiment compris, on pourra le reprendre. */
const MANQUES_A_REPRENDRE: CodeManque[] = ['transcription', 'ocr', 'vision', 'ffmpeg', 'echec', 'arrete', 'oreille', 'trop-long', 'document'];

let segMots: Intl.Segmenter | undefined;
/**
 * Vrai si une valeur a l'air d'un NOM (artiste, album, appareil…) : 80 graphèmes au plus, 8 mots au plus, aucune
 * ponctuation de phrase ni de lien (« ! ? : ; @ < > { } [ ] | \ », « http », « www », une fin de phrase suivie d'un
 * mot). Analyse caractère par caractère et par Intl.Segmenter : aucune expression régulière sur le contenu.
 */
export function ressembleAUnNom(v: string): boolean {
  const t = v.trim();
  if (!t || [...t].length > 80) return false;
  const bas = t.toLowerCase();
  if (bas.includes('http') || bas.includes('www.') || bas.includes('://')) return false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if ('!?:;@<>{}[]|\\\n'.includes(c) || c === '¿' || c === '¡' || c === '؟' || c === '。' || c === '！' || c === '？') return false;
    if (c === '.' && t[i + 1] === ' ' && i + 2 < t.length && t[i + 2].toLowerCase() === t[i + 2] && t[i + 2].toUpperCase() !== t[i + 2]) return false;
  }
  let mots = 0;
  for (const s of (segMots ??= new Intl.Segmenter(undefined, { granularity: 'word' })).segment(t)) if (s.isWordLike && ++mots > 8) return false;
  return mots > 0;
}

/** Un lien [[…]] du Cerveau : sans crochets, barre, dièse ni saut de ligne. */
function lien(s: string): string {
  let r = '';
  for (const c of s) r += '[]|#\n\r'.includes(c) ? ' ' : c;
  return `[[${r.trim()}]]`;
}

export function preparerRangement(c: Compris, o: OptionsRangement): PreparationRangement {
  const f = c.fiche;
  const consigne = (x: string): boolean => {
    if (!o.detecterConsignes) return false;
    try { return !!o.detecterConsignes(x.slice(0, 2000))?.suspect; } catch { return true; }   // détecteur en échec : prudence
  };
  /** La valeur d'une clé, seulement si elle n'est pas sensible, a l'air d'un nom et n'est pas une consigne. */
  const val = (k: string) => {
    const x = f.champs.find((y) => y.cle === k && !y.sensible);
    if (!x) return undefined;
    const v = pourAffichage(x.valeur, 160);
    return ressembleAUnNom(v) && !consigne(v) ? v : undefined;
  };
  const titre = val('titre'), artiste = val('artiste'), album = val('album'), compositeur = val('compositeur'), label = val('label'), distributeur = val('distributeur');
  const marque = val('appareil_marque'), modele = val('appareil_modele'), auteur = val('auteur_document'), origine = val('origine');
  const appareil = modele && marque && modele.toLowerCase().startsWith(marque.toLowerCase()) ? modele : [marque, modele].filter(Boolean).join(' ') || undefined;
  const fam = c.nature.famille;
  const nom = pourAffichage(c.fichier.nom, 160);
  const nomSur = ressembleAUnNom(nom) && !consigne(nom) ? nom : 'sans nom';
  const quoi = titre ? `« ${titre} »` : `« ${nomSur} »`;
  const faits: PreparationRangement['apport']['faits'] = [];
  const ajouter = (texte: string, sujet?: string, cle?: string) => { if (faits.length < 32) faits.push({ texte: bornerGraphemes(texte, 300, true), ...(sujet ? { sujet } : {}), ...(cle ? { cle } : {}) }); };
  if (fam === 'son') {
    if (artiste) ajouter(`La musique ${quoi} est interprétée par ${artiste}`, artiste, 'artiste');
    if (album) ajouter(`${quoi} fait partie de l'album « ${album} »`, album, 'album');
    if (compositeur) ajouter(`${quoi} a pour compositeur ${compositeur}`, compositeur, 'compositeur');
    if (label) ajouter(`${quoi} est paru chez le label ${label}`, label, 'label');
    if (distributeur) ajouter(`${quoi} est distribué par ${distributeur}`, distributeur, 'distributeur');
    if (origine) ajouter(`${quoi} a pour origine ${origine}`, undefined, 'origine');
  }
  if (fam === 'document' && auteur) ajouter(`Le document ${quoi} a pour auteur ${auteur}`, auteur, 'auteur_document');
  if ((fam === 'image' || fam === 'video') && appareil) ajouter(`${MOTS_FAMILLE[fam]} ${quoi} a été ${fam === 'video' ? 'filmée' : 'prise'} avec un appareil ${appareil}`, appareil, 'appareil');
  for (const l of c.langues) {
    if (!l.code || l.confiance < 0.6) continue;
    const verbe = l.partie === 'parole' || l.partie === 'paroles de chanson' ? 'parlé' : 'écrit';
    ajouter(`${MOTS_FAMILLE[fam]} ${quoi} est ${verbe}${fam === 'video' || fam === 'image' || fam === 'sous-titres' ? (fam === 'sous-titres' ? 's' : 'e') : ''} en ${nomLangue(l.code)}${l.partie === 'texte à l\'image' ? ' (texte de l\'image)' : ''}`, undefined, 'langue');
  }
  // Sujets à relier : artiste, album, compositeur, label, titre, appareil, ville et pays déclarés (texte, jamais de coordonnées).
  const ville = val('ville'), pays = val('pays');
  const sujets = [...new Set([artiste, album, compositeur, label, titre, appareil, ville, pays, origine].filter((x): x is string => !!x))].slice(0, 16);
  const texte = [c.texteLu?.texte, c.dit?.nettoye].filter(Boolean).join('\n\n');
  const date = new Date(o.quand);
  const jour = `${d2(date.getDate())}/${d2(date.getMonth() + 1)}/${date.getFullYear()}`;
  const source = `fichier:${nom}`;
  const etiquettes = [...new Set(['média', fam, c.nature.format, ...(c.langue?.code ? [c.langue.code] : []), o.provenance, ...(o.canal ? [o.canal] : [])])];
  const proprietaire = o.parLeProprietaire ?? (o.provenance === 'joint' || o.provenance === 'camera' || o.provenance === 'bibliotheque');
  // Le texte du fait de réception ne contient que des mots d'Odin (nature, date, canal) : le nom et le titre, choisis
  // par l'expéditeur, restent dans `source`.
  const canal = o.canal && ressembleAUnNom(o.canal) ? pourAffichage(o.canal, 40) : undefined;
  const texteReception = proprietaire
    ? `Le propriétaire m'a donné ${UN_FAMILLE[fam]} (${c.nature.nom}) le ${jour}${canal ? ` par ${canal}` : ''}`
    : `J'ai reçu ${UN_FAMILLE[fam]} (${c.nature.nom}) le ${jour}${canal ? ` par ${canal}` : ''}, d'un expéditeur non vérifié`;
  const corpsSujets = sujets.length ? `\n\nSujets : ${sujets.map(lien).join(' · ')}` : '';
  return {
    apport: { sorte: 'lecture', source, date: o.quand, faits, ...(texte ? { texte: bornerGraphemes(texte, 24 * 1024) } : {}) },
    reception: { sorte: 'note', source, date: o.quand, proprietaire, faits: [{ texte: texteReception }] },
    note: { titre: titre ?? nomSur, corps: `# ${titre ?? nomSur}\n\n${comprisEnTexte(c, { sensibles: 'masquer' })}${corpsSujets}\n`, etiquettes, sujets, genre: fam },
    ficheLocale: { empreinte: c.fichier.empreinte, compris: c },
    suppression: decisionSuppression(c, o),
  };
}

/** Supprimer seulement un téléchargement d'Odin inscrit, déjà compris sans manque à reprendre. */
function decisionSuppression(c: Compris, o: OptionsRangement): { supprimer: boolean; raison: string } {
  const d = peutSupprimer(o.chemin, { provenance: o.provenance, workspace: o.workspace, empreinte: c.fichier.empreinte });
  if (!d.supprimer) return d;
  const manque = c.manque.find((m) => MANQUES_A_REPRENDRE.includes(m.code));
  if (manque) return { supprimer: false, raison: `gardé jusqu'à ce que ${manque.quoi} soit possible (${manque.raison}) : on pourra le reprendre` };
  return d;
}

const chiffresSeuls = (s: string) => s.length > 0 && [...s].every((ch) => ch >= '0' && ch <= '9');

/**
 * Vrai SEULEMENT pour un téléchargement d'Odin : provenance « telecharge », chemin réel sous les dossiers de travail du
 * workspace (un FICHIER dedans, jamais le dossier lui-même), ET inscrit au registre des téléchargements avec la même
 * empreinte SHA-256 (`empreinte` : celle de Compris.fichier). Sans empreinte ou sans inscription : rien n'est supprimé.
 */
export function peutSupprimer(chemin: string, o: { provenance: Provenance; workspace: string; empreinte?: string }): { supprimer: boolean; raison: string } {
  if (o.provenance !== 'telecharge') return { supprimer: false, raison: 'c\'est ton fichier : je le garde' };
  let reel: string, ws: string;
  try { reel = realpathSync(chemin); ws = realpathSync(o.workspace); } catch { return { supprimer: false, raison: 'chemin introuvable : rien n\'est supprimé' }; }
  const rel = relative(ws, reel);
  if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`) || /^[a-zA-Z]:/.test(rel) || rel.startsWith(sep)) return { supprimer: false, raison: 'le fichier n\'est pas dans le dossier de travail d\'Odin : je le garde' };
  const parties = rel.split(sep);
  let dossierDeTravail = false;
  if ((parties[0] === '.odin-tmp' || parties[0] === 'videos') && parties.length >= 2 && parties[parties.length - 1]) dossierDeTravail = true;
  if (parties[0] === 'inbox' && parties.length === 2) {
    const n = parties[1];
    const p = n.lastIndexOf('.');
    if (n.startsWith('image-') && p > 6 && chiffresSeuls(n.slice(6, p)) && p < n.length - 1) dossierDeTravail = true;
  }
  if (!dossierDeTravail) return { supprimer: false, raison: 'ce n\'est pas un fichier temporaire d\'Odin : je le garde' };
  if (!estTelechargementInscrit(o.workspace, reel, o.empreinte)) return { supprimer: false, raison: 'pas inscrit au registre des téléchargements d\'Odin (ou modifié depuis) : je le garde' };
  return { supprimer: true, raison: 'téléchargement d\'Odin, déjà compris et rangé' };
}
