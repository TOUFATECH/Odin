// Théia — l'œil local d'Odin : voir les images, lire tout document (OCR), comprendre le contexte d'une vidéo, SANS aucun
// serveur ni modèle en ligne. Cette page sert à ESSAYER : on lui donne une image, un document ou une vidéo, elle dit ce
// qu'elle y voit avec sa confiance et le temps MESURÉ, et on peut la corriger. Tant qu'aucun vrai poids ouvert n'a
// tourné, elle le dit honnêtement (« codé, pas encore essayé sur du vrai modèle ») plutôt que d'inventer.
//
// L'œil (encodeur d'images/texte, modèle image→texte, OCR) est calculé par le moteur d'Odin à partir de modèles OUVERTS
// téléchargés une fois ; il est chargé par la barrière src/vision/index.ts (Lot A). Si un poids manque, Théia dégrade
// proprement : les documents restent lus nativement (documents.ts), et la vision dit qu'elle n'est pas prête.
import { basename, join } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { Action, ActionResult, ModCtx, Module } from '../types.ts';
import { lireDocument, extDe, FORMATS_NATIFS } from './documents.ts';
import { memoireImages } from './memoire-images.ts';
import { brancherTheia, dirPoids } from './base.ts';
import type { Oeil } from '../../vision/index.ts';

const s = (v: unknown) => String(v ?? '').trim();
const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);

/** L'œil, ouvert une fois par machine. Chargé par import tardif : si la barrière (Lot A) ou un poids manque, undefined. */
let cacheOeil: { home: string; oeil: Oeil } | undefined;
export async function ouvrirOeilLocal(home: string): Promise<Oeil | undefined> {
  if (cacheOeil?.home === home && cacheOeil.oeil.pret) return cacheOeil.oeil;
  try {
    const vision = await import('../../vision/index.ts');
    const oeil = await vision.ouvrirOeil({ cache: dirPoids(home) });
    cacheOeil = { home, oeil };
    return oeil;
  } catch { return undefined; }
}

/** Résout un fichier déposé dans l'atelier de Théia (jamais hors de ce dossier : on ne garde que le nom de base). */
function fichierAtelier(ctx: ModCtx, ref: string): string {
  const nom = basename(s(ref).replace(/^atelier:/, ''));
  return join(ctx.dir, 'atelier', nom);
}

// ------------------------------------------------------------------ Actions
const lireDoc: Action = {
  id: 'lire_document', label: 'Lire un document', read: true, external: true,
  what: 'OpenDocument (.odt/.ods/.odp), RTF, HTML : le texte et la structure, lus nativement sans aucun logiciel de bureautique',
  words: ['lis le document', 'lis ce document', 'ouvre le document', 'theia document'],
  params: [{ key: 'fichier', label: 'Fichier (atelier:nom)', kind: 'text', required: true, depot: {} }],
  run(ctx, i) {
    const f = fichierAtelier(ctx, s(i.fichier));
    if (!existsSync(f) || !statSync(f).isFile()) throw new Error(`fichier introuvable : ${basename(f)}`);
    const d = lireDocument(readFileSync(f), f);
    if (!d.lu) return { text: d.partiel ? `${basename(f)} : ${d.via} — lu en partie seulement (ce format n'est pas encore décodé nativement par Théia).` : `${basename(f)} : rien n'a pu être lu (${d.via}).`, data: { via: d.via, partiel: d.partiel } };
    const apercu = d.texte.length > 4000 ? `${d.texte.slice(0, 4000)}\n…` : d.texte;
    return { text: `${basename(f)} · lu nativement (${d.via})\n\n${apercu}`, data: { via: d.via, blocs: d.blocs.length, lu: true } };
  },
};

const voir: Action = {
  id: 'voir', label: 'Voir une image', read: true, external: true,
  what: 'Décrit une image (ce qu\'on y voit, le texte lu) avec la confiance et le temps mesuré ; locale, rien n\'est envoyé dehors',
  words: ['vois l image', 'decris l image', 'qu y a t il sur l image', 'theia vois'],
  params: [{ key: 'fichier', label: 'Image (atelier:nom)', kind: 'text', required: true, depot: {} }, { key: 'question', label: 'Question (facultatif)', kind: 'text', default: '' }],
  async run(ctx, i) {
    const f = fichierAtelier(ctx, s(i.fichier));
    if (!existsSync(f) || !statSync(f).isFile()) throw new Error(`image introuvable : ${basename(f)}`);
    const oeil = await ouvrirOeilLocal(ctx.home);
    if (!oeil || !oeil.pret) return { text: 'L\'œil de Théia n\'est pas encore prêt sur cette machine : aucun modèle de vision ouvert n\'a été calculé/téléchargé (codé, pas encore essayé sur du vrai modèle). Les documents, eux, sont lus nativement.', data: { pret: false } };
    const { visionLocale } = await import('./vision-locale.ts');
    const ext = extDe(f) || 'jpg';
    const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[ext] ?? 'image/jpeg';
    const texte = await visionLocale(oeil)(s(i.question) || 'Décris précisément cette image : ce qu\'on voit (personnes, lieu, objets, actions, ambiance), puis recopie le texte lisible. N\'invente rien.', [{ mime, data: readFileSync(f).toString('base64') }]);
    return { text: texte, data: { modele: oeil.modele, aVLM: oeil.aVLM }, ok: true };
  },
};

const retrouver: Action = {
  id: 'retrouver', label: 'Retrouver une image par une phrase', read: true,
  what: 'Cherche parmi les images rangées celles qui ressemblent le plus à une phrase (plongements, local)',
  words: ['retrouve l image', 'quelle image montre', 'theia retrouve'],
  params: [{ key: 'phrase', label: 'Phrase', kind: 'text', required: true }, { key: 'combien', label: 'Combien', kind: 'number', default: 5 }],
  async run(ctx, i) {
    const phrase = s(i.phrase); if (!phrase) throw new Error('phrase vide');
    const mem = memoireImages(ctx.dir, ctx.home);
    if (!mem.taille) return { text: 'Aucune image n\'est encore rangée dans la mémoire d\'images de Théia.', data: { taille: 0 } };
    const oeil = await ouvrirOeilLocal(ctx.home);
    if (!oeil || !oeil.pret) return { text: 'L\'œil de Théia n\'est pas encore prêt : impossible de calculer le plongement de la phrase (codé, pas encore essayé sur du vrai modèle).', data: { pret: false } };
    const res = await mem.retrouverParPhrase(oeil, phrase, Math.max(1, Math.min(20, Number(i.combien) || 5)));
    return { text: res.length ? res.map((r) => `${r.source} · ressemblance ${pct((r.score + 1) / 2)} %`).join('\n') : 'Rien trouvé.', data: { resultats: res } };
  },
};

const corriger: Action = {
  id: 'corriger', label: 'Corriger ce que Théia voit', read: false,
  what: 'Dire le bon mot (« c\'est le salon », « c\'est mon chien ») : Théia s\'en servira pour apprendre sur place',
  words: ['corrige', 'c est le', 'c est mon', 'theia corrige'],
  params: [{ key: 'image', label: 'Image (atelier:nom)', kind: 'text', required: true }, { key: 'etiquette', label: 'Le bon mot', kind: 'text', required: true }],
  run(ctx, i) {
    const image = basename(s(i.image).replace(/^atelier:/, '')), etiquette = s(i.etiquette);
    if (!image || !etiquette) throw new Error('image et bon mot requis');
    const liste = (ctx.settings.corrections as Array<{ id: string; image: string; etiquette: string; at: string }> | undefined) ?? [];
    const c = { id: `${Date.now().toString(36)}`, image, etiquette, at: ctx.now().toISOString() };
    ctx.saveSettings({ corrections: [c, ...liste].slice(0, 500) });
    return { text: `C\'est noté : « ${image} » → « ${etiquette} ». Théia s\'en servira pour apprendre une petite tête au-dessus des plongements.`, data: { correction: c } };
  },
};

export const theia: Module = {
  id: 'theia', name: 'Théia', family: 'Données',
  what: 'L\'œil d\'Odin : voir les images, lire tout document (même scannés, par OCR), et comprendre le contexte d\'une vidéo entière — chez toi, sans aucun serveur ni modèle en ligne.',
  does: [
    'lit nativement OpenDocument (.odt/.ods/.odp), RTF et HTML (en plus de Word, Excel, PowerPoint et PDF-texte), sans logiciel de bureautique',
    'extrait l\'image pleine page des PDF scannés pour les lire par OCR (texte reconnu par l\'œil)',
    'décrit une image : ce qu\'on y voit et le texte lisible, avec la confiance et le temps mesuré',
    'retrouve une image rangée à partir d\'une phrase (plongements, en local)',
    'comprend le contexte d\'une vidéo : résumé, chapitres datés, lieux, personnages décrits, actions, fil, ton',
    'repère et suit personnes, animaux, véhicules et objets DANS une vidéo, et compte ; événements (entrée, colis, chute, feu)',
    'on peut la corriger (« c\'est le salon ») : elle apprend une petite tête sur place',
    'rien n\'est envoyé dehors ; la reconnaissance de visages est éteinte par défaut et très encadrée',
  ],
  // Les logiciels équivalents ne sont nommés QUE dans « Alternative à » (SIMILAIRES de names.ts), jamais ici.
  from: [], upstream: [],
  words: ['theia', 'théia', 'vois', 'regarde l image', 'lis le document scanne', 'ocr', 'contexte de la video', 'decris la photo', 'l oeil d odin'],
  depot: (ctx) => ({ dossier: join(ctx.dir, 'atelier'), ref: (nom) => `atelier:${nom}` }),
  actions: [lireDoc, voir, retrouver, corriger],
  start(ctx) { brancherTheia(ctx.dir); }, // pose la base THEIA_ODIN (sinon elle n'est jamais créée).
  view(ctx) {
    const mem = memoireImages(ctx.dir, ctx.home);
    const corrections = (ctx.settings.corrections as Array<{ image: string; etiquette: string; at: string }> | undefined) ?? [];
    const pret = cacheOeil?.home === ctx.home && cacheOeil.oeil.pret;
    const etatOeil = pret ? `œil prêt (modèle ${cacheOeil!.oeil.modele || '—'}${cacheOeil!.oeil.aVLM ? ', décrit les images' : ', étiquettes seulement'})` : 'œil pas encore sollicité ou non prêt (les documents restent lus nativement)';
    return {
      subtitle: `${etatOeil} · ${mem.taille} image(s) rangée(s)`,
      sections: [
        { kind: 'form', title: 'Lire un document', action: 'lire_document', submit: 'Lire', params: [{ key: 'fichier', label: 'Fichier', kind: 'text', required: true, depot: {}, help: `OpenDocument (.odt/.ods/.odp), RTF, HTML, ou un format déjà natif (Word, Excel, PowerPoint, PDF-texte). Formats natifs de Théia : ${FORMATS_NATIFS.join(', ')}.` }] },
        { kind: 'form', title: 'Voir une image', action: 'voir', submit: 'Voir', aide: 'La description affiche la confiance et le temps mesuré. Tant qu\'aucun vrai modèle ouvert n\'a tourné, Théia le dit.', params: [{ key: 'fichier', label: 'Image', kind: 'text', required: true, depot: {} }, { key: 'question', label: 'Question (facultatif)', kind: 'text' }] },
        { kind: 'form', title: 'Retrouver une image par une phrase', action: 'retrouver', submit: 'Retrouver', params: [{ key: 'phrase', label: 'Phrase', kind: 'text', required: true }, { key: 'combien', label: 'Combien', kind: 'number', default: 5 }] },
        { kind: 'table', title: 'Dernières corrections', columns: ['Quand', 'Image', 'Le bon mot'], rows: corrections.slice(0, 20).map((c) => ({ cells: [c.at.slice(0, 16).replace('T', ' '), c.image, c.etiquette] })), empty: 'Aucune correction pour l\'instant.' },
      ],
    };
  },
};
