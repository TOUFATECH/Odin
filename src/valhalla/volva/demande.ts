// Pythie depuis la discussion : « Odin, fais-moi une recherche sur … », « cherche des vidéos de … »,
// « montre-moi 10 résultats », « … en tableau », « … dans le navigateur », « … à voix haute ».
// Ce fichier est pur : il comprend la demande et écrit les résultats en Markdown. L'interface (pages/rendu.js) en fait
// des cartes (image, titre, texte), un tableau, une liste, une grille d'images, des vidéos ou des sons ; sur Telegram,
// le même texte reste lisible tel quel.

import type { Source } from './engine.ts';

/** Combien de résultats par défaut (réglable : « montre-moi 10 résultats » est gardé comme réglage). */
export const RESULTATS_DEFAUT = 5;
export const RESULTATS_MAX = 20;
export type Sorte = 'pages' | 'videos' | 'images' | 'sons';
export type Affichage = 'cartes' | 'tableau' | 'liste' | 'navigateur' | 'audio';
export interface Demande { q: string; n?: number; sorte: Sorte; affichage?: Affichage }

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, '\'').replace(/\s+/g, ' ').trim();
const NOMBRES: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, quinze: 15, vingt: 20 };
const NB = `(\\d{1,2}|${Object.keys(NOMBRES).join('|')})`;
const SORTE = '(resultats?|liens?|sites?|pages?|videos?|images?|sons?|audios?|musiques?|podcasts?)';
const sorteDe = (w: string): Sorte => (/^video/.test(w) ? 'videos' : /^image/.test(w) ? 'images' : /^(son|audio|musique|podcast)/.test(w) ? 'sons' : 'pages');
const nombre = (w: string) => { const n = /^\d+$/.test(w) ? Number(w) : NOMBRES[w] ?? 0; return n >= 1 ? Math.min(RESULTATS_MAX, n) : undefined; };

/**
 * La demande de recherche, ou rien si la phrase n'en est pas une (alors une autre appli ou l'IA s'en charge).
 * Volontairement étroit : « cherche un hôtel à Paris » reste à l'IA ; il faut « recherche », « sur internet » ou
 * « des vidéos / des images / des sons de … ».
 */
export function parseDemande(text: string): Demande | undefined {
  let s = fold(text).replace(/^(?:odin|dis odin|hey odin)\s*[,:]?\s+/, '').replace(/[\s,]*(?:s'il te plait|stp|merci)\s*[.!?]*$/, '').replace(/\s*[.!?]+$/, '');
  if (!s || s.length > 200) return undefined;
  let affichage: Affichage | undefined;
  // Comment montrer les résultats (ces mots sont retirés de la question).
  const COMMENT: Array<[RegExp, Affichage]> = [
    [/\s*,?\s*(?:en|sous forme de|dans un) (?:tableau|table)\b/, 'tableau'],
    [/\s*,?\s*(?:en|sous forme de) cartes?\b/, 'cartes'],
    [/\s*,?\s*(?:en|sous forme de) (?:liste|texte)\b/, 'liste'],
    [/\s*,?\s*(?:dans|sur|avec) (?:le|mon|un) navigateur\b|\s*,?\s*(?:dans|sur) (?:la page|pythie)(?: de recherche)?\b/, 'navigateur'],
    [/\s*,?\s*(?:a voix haute|en audio|a l'oral|et lis[- ]les(?:[- ]moi)?|et lis[- ]moi les resultats|et lis[- ]moi tout ca)\b/, 'audio'],
  ];
  for (const [re, a] of COMMENT) if (re.test(s)) { affichage = a; s = s.replace(re, ' ').replace(/\s+/g, ' ').trim(); }
  let n: number | undefined, sorte: Sorte = 'pages', q = '';
  // « montre-moi 10 résultats (sur …) », « donne-moi 6 vidéos de … »
  const combien = new RegExp(`^(?:montre|donne|affiche|trouve|cherche)(?:[- ]moi)? ${NB} ${SORTE}(?: (?:sur|de|des|du|d'|pour|a propos de|concernant) ?(.+))?$`).exec(s);
  if (combien) { n = nombre(combien[1]); sorte = sorteDe(combien[2]); q = (combien[3] ?? '').trim(); return n ? { q: q && original(text, q), n, sorte, affichage } : undefined; }
  // « fais-moi une recherche (web) (sur) … »
  const fais = /^(?:fais|fait|lance|faire|peux[- ]tu faire|tu peux faire)(?:[- ]moi)? une (?:petite )?recherche(?: (?:web|internet|sur internet|sur le web|en ligne|google))?(?: (?:de|des) (videos?|images?|sons?|musiques?))?(?: (?:sur|de|des|du|d'|a propos de|pour|concernant))? ?(.+)$/.exec(s);
  // (« cherche sur internet le prix de … » n'en fait pas partie : c'est une question, l'IA y répond avec Pythie et ses sources.)
  // « cherche des vidéos de chats », « trouve-moi des images de la tour Eiffel », « cherche des sons de pluie »
  const medias = /^(?:cherche|recherche|trouve|montre|donne)(?:[- ]moi)? (?:des|quelques) (videos?|images?|sons?|musiques?|podcasts?) (?:de|du|des|d'|sur|pour|a propos de) ?(.+)$/.exec(s);
  if (fais) { sorte = fais[1] ? sorteDe(fais[1]) : 'pages'; q = fais[2]; }
  else if (medias) { sorte = sorteDe(medias[1]); q = medias[2]; }
  else return undefined;
  // « … 10 résultats » à la fin de la phrase
  const fin = new RegExp(`\\s*,?\\s*(?:avec |et montre(?:[- ]moi)? |donne[- ]moi )?${NB} ${SORTE}$`).exec(q);
  if (fin) { n = nombre(fin[1]); q = q.slice(0, fin.index); }
  q = q.replace(/^(?:sur|de|des|du|d'|a propos de|pour)\s+/, '').trim();
  if (q.length < 2) return undefined;
  // La question telle qu'elle a été écrite (accents compris), retrouvée dans le texte d'origine.
  return { q: original(text, q), n, sorte, affichage };
}
/** Retrouve les mots de la question dans la phrase d'origine (avec ses accents et majuscules). */
function original(text: string, q: string): string {
  const t = text.replace(/[’`]/g, '\''), f = fold(t);
  if (f.length !== t.length) return q; // les accents ont changé la longueur : la forme sans accents suffit
  const i = f.indexOf(q); return i >= 0 ? t.slice(i, i + q.length) : q;
}

/** Un morceau de texte venu d'un site, rendu inoffensif pour le Markdown (ni crochets, ni retour à la ligne, ni code). */
const net = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[[\]`|*_<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const safeUrl = (u: string) => (/^https?:\/\/[^\s()<>"'`]+$/i.test(u) ? u : '');

/**
 * Les résultats en Markdown : un bloc « ```resultats <affichage> <sorte> » (cartes, tableau, liste, grille, vidéos, sons)
 * dont chaque ligne est « - [Titre](adresse) ![](image) — texte ». Pur.
 */
export function resultatsMarkdown(sources: Source[], o: { q: string; sorte?: Sorte; affichage?: Affichage; n?: number }): string {
  const sorte = o.sorte ?? 'pages', aff = o.affichage === 'tableau' || o.affichage === 'liste' ? o.affichage : sorte === 'images' ? 'grille' : 'cartes';
  const lignes = sources.slice(0, o.n ?? sources.length).map((x) => {
    const url = safeUrl(x.url); if (!url) return '';
    const th = x.thumb ? safeUrl(x.thumb) : '';
    return `- [${net(x.title, 140) || x.domain}](${url})${th ? ` ![](${th})` : ''} — ${net(x.snippet, 320) || x.domain}`;
  }).filter(Boolean);
  const quoi = sorte === 'videos' ? 'vidéo' : sorte === 'images' ? 'image' : sorte === 'sons' ? 'son' : 'résultat';
  if (!lignes.length) return `Aucun${sorte === 'pages' ? '' : 'e'} ${quoi} trouvé${sorte === 'pages' ? '' : 'e'} pour « ${net(o.q, 120)} ».`;
  return `**${lignes.length} ${quoi}${lignes.length > 1 ? 's' : ''}** pour « ${net(o.q, 120)} » (Pythie)\n\n\`\`\`resultats ${aff} ${sorte}\n${lignes.join('\n')}\n\`\`\``;
}

/** Les résultats dits à voix haute : le titre et le début du texte de chacun. Pur. */
export function resultatsParles(sources: Source[], q: string): string {
  return [`Voici ce que j'ai trouvé sur ${net(q, 120)}.`, ...sources.map((x, i) => `${i + 1}. ${net(x.title, 140)}. ${net(x.snippet, 220)}`)].join('\n');
}
