// Logos — « la pensée » : le moteur d'Odin qui comprend une demande SANS modèle d'IA.
// Il lit la phrase, choisit l'appli et l'action (mots-clés des applis, verbes, noms des choses que
// l'appli connaît : conteneurs, caméras, appareils, plans…), remplit les réglages à partir de la
// phrase (adresse IP, nom, durée, jour, heure, texte entre guillemets), et pose une question quand
// il manque quelque chose. Il ne devine pas : en dessous d'un seuil de certitude, il ne tente rien.
// Il ne lance rien lui-même : il rend une décision, exécutée ensuite sous Heimdall (mêmes règles et
// mêmes accords que si un modèle l'avait demandée).

import { isIP } from 'node:net';
import { accord } from '../core/genre.ts';
import { parseWhen } from '../cron/reminders.ts';
import { LINKS, USAGES } from './links.ts';
import { forgetsId } from './names.ts';
import type { Valhalla } from './service.ts';
import type { Action, Module, Param, View } from './types.ts';
import { motsAjoutes, motsDuReglage, SANS_ESPACES, toutesFormes, tousPetitsMots, langues } from '../langue/tables.ts';
import { reconnaitre } from '../langue/reconnaitre.ts';
import { magasinVenus } from './venus/base.ts';
import { lireDemande, norm as normTitre, trouverOeuvre } from './venus/bibliotheque.ts';
import { refusAppli } from './sso/acces.ts';

export type Understood =
  | { kind: 'action'; module: string; action: string; input: Record<string, unknown>; label: string; read: boolean; /** Une partie de la phrase n'est pas expliquée par cette appli et cette action : Odin devine. Avec une IA sous la main, c'est à elle de comprendre. */ doubt?: string; /** Le doute porte sur un détail d'une demande qui était bien pour cette appli (utile à dire) ; sinon la demande n'avait sans doute rien à voir. */ near?: boolean }
  | { kind: 'ask'; module: string; action: string; input: Record<string, unknown>; missing: string; text: string }
  | { kind: 'manip'; id: string; keep: boolean }
  | { kind: 'say'; text: string; /** Odin hésite (deux applis possibles, action floue) : avec une IA sous la main, c'est à elle de trancher. */ unsure?: boolean };

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
const STOP = new Set('le la les l un une des du de d au aux a et ou en dans sur pour par avec sans ce cet cette ces mon ma mes ton ta tes son sa ses moi me m toi te t il elle on nous vous je j tu est es suis sont que qu qui quoi stp svp merci odin peux pourrais veux voudrais faut fais faire est-ce s il plait bonjour salut donc alors bien tres tout tous toute toutes y ne pas plus maintenant vite'.split(' '));
// Les petits mots des autres langues connues (`src/langue/langues/*.json`) : laissés de côté comme les nôtres.
for (const w of tousPetitsMots()) STOP.add(norm(w));
/** Formes ramenées à leur racine, toutes langues (« viruses » → « virus »). */
const FORMES = Object.fromEntries(Object.entries(toutesFormes()).map(([k, v]) => [norm(k), norm(v)]));
/** Racine grossière d'un mot français (suffit pour rapprocher « redémarre », « redémarrer », « redémarrage »). */
export function stem(w: string): string {
  const x0 = norm(w).replace(/[^\p{L}\p{N}]/gu, ''), x = FORMES[x0] ?? x0;
  if (x.length <= 3 || SANS_ESPACES.test(x)) return x;
  // Noms en « -ier » : gardés entiers (« fichier » n'est pas « fiche », « dossier » n'est pas « dos »).
  if (/^(?:fichier|dossier|calendrier|courrier|clavier|papier|atelier|premier|dernier|entier|janvier|fevrier|particulier|quartier|chantier|panier|cahier|metier|restaurant)s?$/.test(x)) return x.replace(/s$/, ''); // « restaurant » n'est pas « restaurer »
  let r = x.replace(/(issements?|ements?|ations?|ages?|eurs?|euses?|erai[st]?|eront|erez|erons|aient|ait|ais|ant|ees?|ies?|ez|ons|ent|er|ir|is|it|es|e|s|x)$/, '');
  // Verbes en « -ier » : « vérifier », « vérifiez », « vérifiait » rejoignent « vérifie » (« étudier » / « étudie », « copier » / « copie »).
  if (r.length >= 4 && /[^aeiouy]i$/.test(r) && /^(?:er|ez|ons|ent|ait|ais|aient|ant|erai[st]?|eront|erez|erons)$/.test(x.slice(r.length))) r = r.slice(0, -1);
  return r.length >= 3 ? r : x;
}
const tokens = (t: string) => norm(t).split(/[^\p{L}\p{N}.:/@_-]+/u).map((w) => w.replace(/^(?:[ldjmtsnc]|qu)'/, '')).filter((w) => w && !STOP.has(w));

/** Verbes qui veulent dire la même chose qu'un nom d'action (clé : début du nom de l'action). */
const SYN: Array<[RegExp, string[]]> = [
  [/^(demarrer|allumer|activer|lancer|executer|jouer)/, ['demarre', 'lance', 'allume', 'active', 'start', 'execute', 'joue', 'mets']],
  [/^(arreter|eteindre|stop|desactiver)/, ['arrete', 'stoppe', 'stop', 'eteins', 'coupe', 'desactive']],
  [/^redemarrer/, ['redemarre', 'relance', 'restart', 'reboot']],
  [/^(lister|liste|etat|appareils|machines|cameras|plans|bannis|serveurs|parc|bases|agenda|maison|connexions|alertes|ecrans|enregistrements|programme|instantanes|activite|statistiques|carnet|quarantaine|voix|inventaire|ma_liste)/, ['liste', 'montre', 'affiche', 'voir', 'quels', 'quelles', 'quel', 'quelle', 'etat', 'combien', 'ou en est']],
  [/^(ajouter|creer|creer_scene|nouveau|prestation|suivre|radio|dossier|regle)/, ['ajoute', 'cree', 'nouveau', 'nouvelle', 'declare']],
  [/^(retirer|supprimer|revoquer|annuler|annuler_enregistrement|debannir)/, ['retire', 'supprime', 'enleve', 'efface', 'revoque', 'annule', 'oublie', 'debranche']],
  [/^(chercher|verifier|analyser|fichier|fuites|conformite|bilan)/, ['cherche', 'trouve', 'recherche', 'retrouve', 'verifie', 'controle', 'analyse', 'scanne', 'teste']],
  [/^(mettre_a_jour|empreintes|listes|indexer)/, ['mets a jour', 'mettre a jour', 'update', 'actualise', 'rafraichis']],
  [/^(dire|annoncer|gjallarhorn)/, ['dis', 'annonce', 'previens', 'parle']],
  [/^(sauvegarder)/, ['sauvegarde', 'backup']],
  [/^(restaurer|revenir)/, ['restaure', 'recupere', 'reviens', 'remets']],
  [/^(bannir)/, ['bannis', 'bloque', 'interdis']],
  [/^(photo)/, ['photo', 'image', 'capture', 'regarde la camera', 'montre la camera']],
  [/^(journaux|journal)/, ['journaux', 'journal', 'logs', 'log']],
  [/^(regarder)/, ['regarde', 'mets', 'lance', 'ouvre', 'joue']],
  [/^(enregistrer|enregistrer_plage|instantane)/, ['enregistre', 'garde une copie', 'instantane', 'snapshot']],
  [/^(reserver|reservation)/, ['reserve', 'prends rendez-vous', 'rendez-vous pour']],
  [/^(generer)/, ['genere', 'invente', 'propose un mot de passe']],
  [/^(reveiller)/, ['reveille', 'wake']],
  [/^(tuer)/, ['tue', 'kill', 'termine le processus']],
  [/^(commander|scene|commande)/, ['regle', 'mets', 'ouvre', 'ferme', 'allume', 'eteins', 'lance la scene']],
  [/^(deployer|brancher|appairer|pont|acces|adresse)/, ['deploie', 'installe', 'branche', 'relie', 'appaire', 'connecte']],
  [/^(qr)/, ['qr', 'code qr', 'flashe']],
  [/^(surveiller|evenements|controler)/, ['surveille', 'evenements', 'que se passe', 'quoi de neuf']],
];

/** Les verbes qui demandent de lire un titre (ceux des actions « regarder… ») : « lance-moi … » y perd son pronom. */
const VERBES_LIRE = new Set(SYN.filter(([re]) => re.test('regarder')).flatMap(([, syn]) => syn).map(stem));

/** « laisse tomber » dans les autres langues connues. */
const ABANDON = [...langues().values()].flatMap((t) => t.abandon).map(norm).filter((x) => x.length > 1);
const enrichis = new WeakMap<Module, Module>();
/**
 * L'appli avec les tournures des autres langues (`src/langue/langues/*.json`) AJOUTÉES aux siennes : Logos les comprend
 * comme les mots français. Ajouter une langue = ajouter un fichier, sans toucher à ce code.
 */
export function avecLangues(m: Module): Module {
  const deja = enrichis.get(m); if (deja) return deja;
  const plus = motsAjoutes(m.id);
  const actions = m.actions.map((a) => {
    const w = motsAjoutes(`${m.id}.${a.id}`);
    // Les mots qui annoncent un réglage chiffré dans ces langues (« season », « Staffel », « 第{n}話 ») : portés par le réglage.
    const params = a.params?.map((p): ParamLu => { const mots = motsDuReglage(`${m.id}.${a.id}.${p.key}`); return mots.length ? { ...p, mots } : p; });
    const autres = Boolean(params?.some((p, k) => p !== a.params![k]));
    return w.length || autres ? { ...a, ...(w.length ? { words: [...(a.words ?? []), ...w] } : {}), ...(autres ? { params } : {}) } : a;
  });
  const r = plus.length || actions.some((a, k) => a !== m.actions[k]) ? { ...m, words: [...m.words, ...plus], actions } : m;
  enrichis.set(m, r); return r;
}

/** Un réglage avec les mots des autres langues qui l'annoncent (`reglages` des fichiers de langue). */
type ParamLu = Param & { mots?: string[] };
/** Minuscules, sans accents, SANS toucher aux espaces : chaque caractère garde sa place (sert à retirer un passage du texte dit). */
const plat = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
const echappe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Un nombre annoncé par un des mots d'un réglage dans les autres langues (`t` déjà mis à plat) : « season 2 »,
 * « Staffel 2 », « temporada 2 » (le mot, puis le nombre) ; « 第10話 », « 7話 » (« {n} » marque la place du nombre).
 * Le passage le plus tôt dans la phrase l'emporte, le plus long à égalité. Jamais un nombre seul.
 */
function nombreNomme(t: string, mots: string[]): { n: number; debut: number; fin: number } | undefined {
  let best: { n: number; debut: number; fin: number } | undefined;
  for (const w of mots) {
    const x = plat(w).trim(); if (!x) continue;
    const [avant, apres] = x.includes('{n}') ? x.split('{n}') : [x, ''];
    const colle = SANS_ESPACES.test(x);
    const re = new RegExp(`${colle || !avant ? '' : '(?<![\\p{L}\\p{N}])'}${echappe(avant)}${!colle && avant && !apres ? '\\p{L}*' : ''}\\s*(?:n[o°]\\s*)?(?<!\\p{N})(\\d{1,4})(?!\\p{N})${apres ? `\\s*${echappe(apres)}` : ''}`, 'u');
    const m = re.exec(t); if (!m) continue;
    if (!best || m.index < best.debut || (m.index === best.debut && m.index + m[0].length > best.fin)) best = { n: Number(m[1]), debut: m.index, fin: m.index + m[0].length };
  }
  return best;
}

/** Noms connus de l'appli (ce que sa page affiche) : conteneurs, caméras, appareils, plans… par réglage. */
type Names = Map<string, string[]>;
const cache = new Map<string, { at: number; names: Names }>();
async function namesOf(v: Valhalla, m: Module): Promise<Names> {
  const hit = cache.get(m.id); if (hit && Date.now() - hit.at < 30_000) return hit.names;
  const names: Names = new Map();
  const add = (k: string, val: unknown) => { const x = String(val ?? '').trim(); if (!x || x.length > 80) return; const l = names.get(k) ?? []; if (!l.includes(x)) l.push(x); names.set(k, l); };
  try {
    const view = await Promise.race([Promise.resolve(m.view(v.ctx(m.id), new URLSearchParams())), new Promise<View>((_r, rej) => setTimeout(() => rej(new Error('lent')), 2500))]);
    for (const sec of [...view.sections, ...(view.side ?? [])]) {
      if (sec.kind === 'table') for (const r of sec.rows) { add('*', r.cells[0]); for (const a of r.actions ?? []) for (const [k, val] of Object.entries(a.input)) add(k, val); }
      if (sec.kind === 'list') for (const it of sec.items) add('*', it.title);
      if (sec.kind === 'cards') for (const it of sec.items) { add('*', it.title); for (const x of it.actions ?? []) for (const [k, val] of Object.entries(x.input ?? {})) add(k, val); }
      // Une carte de boutons (« Analyse rapide », « Tout analyser », « Ou un seul dossier ») : ce que ses boutons et sa liste envoient.
      if (sec.kind === 'actions') { for (const bt of sec.boutons) for (const [k, val] of Object.entries(bt.input ?? {})) add(k, val); for (const x of sec.liste?.valeurs ?? []) add(sec.liste!.champ, x.valeur); }
      // Les postes proposés par un formulaire (« Voir un autre poste ») : « … sur serveur-web » désigne ce poste.
      if (sec.kind === 'form') for (const fp of sec.params ?? []) if (fp.key === 'poste' && fp.kind === 'select') for (const o of fp.options ?? []) add('poste', o);
    }
    // « Sur quel poste ? » en haut de la page : les postes qu'elle propose (sauf la machine d'Odin elle-même).
    for (const c of view.postes?.choix ?? []) if (c.id) add('poste', c.nom);
  } catch { /* page indisponible : on se passera des noms */ }
  cache.set(m.id, { at: Date.now(), names });
  return names;
}
/** Le nom connu le plus long présent dans la phrase. */
function pickName(text: string, list: string[]): string | undefined {
  const t = ` ${norm(text)} `;
  return [...list].sort((a, b) => b.length - a.length).find((n) => { const x = norm(n); return x.length >= 2 && new RegExp(`(^|[^a-z0-9])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t); });
}

/** Durée en minutes dans la phrase (« pendant 2 heures », « 30 min », « 1 jour »). */
export function minutesIn(text: string): number | undefined {
  const m = /(\d+(?:[.,]\d+)?)\s*(minutes?|min|mn|heures?|h|jours?|j|semaines?)\b/.exec(norm(text)); if (!m) return undefined;
  const n = Number(m[1].replace(',', '.')), u = m[2];
  return Math.round(n * (/^(h|heure)/.test(u) ? 60 : /^(j|jour)/.test(u) ? 1440 : /^sem/.test(u) ? 10_080 : 1));
}
/** Réglages qui reçoivent du texte libre (jamais cherchés parmi les noms connus). */
const FREE = /^(q|texte|message|note|contenu|resume|commande|raison|etapes|dossiers|horaires|parties|proprietes|chaines|compose|variables|quoi|besoin|fonction|statut|identifiant|mot_de_passe|totp|wifi|odin|depot|source|site|domaines|ids|sujet|entree|valeur|cible|projet|equipe|zone|pages|demande|branche|modele|proprietaire|deploiement|outil|arguments)$/;
/** Réglages qui ont une forme précise (adresse IP, numéro, date, heure…) : jamais remplis avec « le reste de la phrase ». */
// (« debut » : le moment où commence un extrait, « 1:30 » ; jamais le reste de la phrase.)
const TYPED = /^(ip|id|vmid|pid|port|minutes|duree|jour|date|heure|debut|contact|lien|url|adresse)$/;
/** Mots courants qui peuvent s'afficher dans une page sans désigner une chose de l'appli. */
const COMMON = /^(aujourd'hui|demain|hier|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|oui|non|etat|liste|total|aucun|aucune|tout|tous|toutes|actif|inactif|ici|maison|salon)$/;
const QUOTED = /"([^"]{1,2000})"|«\s*([^»]{1,2000}?)\s*»|“([^”]{1,2000})”/;

/** Remplit les réglages d'une action à partir de la phrase. Renvoie ce qui a été trouvé. */
export function fill(a: Action, text: string, names: Names, now = new Date()): Record<string, unknown> {
  const input: Record<string, unknown> = {}, s = norm(text), params = a.params ?? [];
  const quoted = QUOTED.exec(text), quote = quoted ? (quoted[1] ?? quoted[2] ?? quoted[3]) : undefined;
  const ip = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)?.find((x) => isIP(x)) ?? text.match(/\b[0-9a-f:]{3,}:[0-9a-f:]+\b/gi)?.find((x) => isIP(x));
  const url = /\bhttps?:\/\/[^\s"'<>]+|\brtsps?:\/\/[^\s"'<>]+/i.exec(text)?.[0];
  const repo = /\b(?:github\.com\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/.exec(text.replace(/https?:\/\//, ''))?.[0];
  // Un nom de site écrit sans « https:// » (« surveille le site toufatech.com »).
  const domain = /(?:^|[\s«"'(])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?:\/[^\s"'«»]*)?(?=[\s,;:!?»"')]|\.?$)/i.exec(text)?.[1];
  const mail = /[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/i.exec(text)?.[0], phone = /(?:\+\d{1,3}[\s.]?)?(?:\d[\s.]?){9,12}\d/.exec(text)?.[0]?.trim();
  const mac = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i.exec(text)?.[0];
  const when = parseWhen(s, now);
  const hour = /\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/.exec(s);
  const dayIso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text)?.[1];
  const numbers = (s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ' ').replace(/\d{4}-\d{2}-\d{2}/g, ' ').match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).map((x) => Number(x.replace(',', '.')));
  let usedQuote = false, usedNum = 0;
  const creates = /^(ajouter|creer|nouveau|prestation|radio|liste|regle|suivre|deployer|preparer|creer_scene|noter|reserver|serveur)/.test(a.id);
  for (const p of params) {
    const k = norm(p.key), lab = norm(p.label);
    if (/^(valeur|etat)$/.test(k)) {
      // « allume », « éteins », « ouvre », « ferme », « à 22 degrés », « à 50 % ».
      const num = /\b(\d{1,3}(?:[.,]\d)?)\s*(%|pour ?cent|°|degres?)/.exec(s);
      const val = num ? `${num[1].replace(',', '.')}${/%|cent/.test(num[2]) ? '%' : ''}` : /\b(allume|active|demarre|mets en marche)/.test(s) ? 'on' : /\b(eteins|eteint|coupe|desactive|arrete)/.test(s) ? 'off' : /\b(deverrouille)/.test(s) ? 'deverrouiller' : /\b(verrouille)/.test(s) ? 'verrouiller' : /\b(ouvre)/.test(s) ? 'ouvrir' : /\b(ferme)/.test(s) ? 'fermer' : undefined;
      if (val) { input[p.key] = val; continue; }
    }
    // Réglage qui désigne une chose existante (pas un texte libre, pas un nom à créer) : on cherche parmi les noms connus.
    const refers = !FREE.test(k) && !TYPED.test(k) && !(creates && /^(nom|titre)$/.test(k));
    const known = [...(names.get(p.key) ?? []), ...(refers && p.kind === 'text' ? names.get('*') ?? [] : [])];
    const named = pickName(text, known);
    if (p.kind === 'boolean') { if (new RegExp(`\\b(sans|pas de|desactive|non)\\b.{0,20}\\b${stem(lab.split(' ')[0])}`).test(s)) input[p.key] = false; else if (new RegExp(`\\b(avec|active|oui)\\b.{0,20}\\b${stem(lab.split(' ')[0])}`).test(s)) input[p.key] = true; continue; }
    // La langue d'un texte à traiter (« fix this: i has went… » → l'anglais), reconnue sur la phrase quand elle est sûre.
    if (k === 'langue' && p.kind === 'select') { const l = reconnaitre(text).langue; const o = l ? (p.options ?? []).find((x) => x === l || x.startsWith(`${l}-`)) : undefined; if (o) { input[p.key] = o; continue; } }
    if (p.kind === 'select') { const o = pickName(text, p.options ?? []) ?? (p.options ?? []).find((x) => s.includes(stem(x)) && stem(x).length >= 4) ?? (p.options ?? []).find((x) => s.split(/[^a-z0-9]+/).some((w) => w.length >= 3 && !STOP.has(w) && norm(x).includes(w))); if (o) input[p.key] = o; continue; }
    // Un chemin écrit dans la phrase désigne plus sûrement qu'un nom connu.
    if (/^(chemin|fichier|dossier)$/.test(k)) { const path = /(?:^|\s)((?:~|\.{0,2})?\/[^\s"'«»]+|[A-Za-z]:\\[^\s"'«»]+)/.exec(text)?.[1]; if (path) { input[p.key] = path.replace(/[.,;:!?]+$/, ''); continue; }
      // À défaut, un nom de fichier seul (« rapport.pdf ») : l'appli le cherchera là où les fichiers arrivent.
      const bare = k === 'dossier' ? undefined : /(?:^|\s)((?:inbox\/)?[\w(][\w.()-]*\.[A-Za-z][A-Za-z0-9]{1,4})(?=[\s,;:!?]|$)/.exec(text)?.[1]; if (bare && !/^https?:/i.test(bare)) { input[p.key] = bare; continue; } }
    // Un format de fichier (« convertis ce fichier en PDF »).
    // Une ville nommée (« … à Paris », « la météo de Saint-Denis de la Réunion », « au Port ») : avec sa majuscule, telle
    // qu'on l'écrit. Le DERNIER lieu introduit par « à / au / en » l'emporte (« pour Noël à Lyon » → Lyon, « le match de Paul
    // à Brest » → Brest) ; « de » seulement s'il n'y en a pas (« la météo de Saint-Denis »). « au Port » → « Le Port ».
    if (k === 'ville') {
      const lieux = [...text.matchAll(/(?:^|\s)(à|a|au|aux|en|de|du)\s+((?:[A-ZÀ-Ý][\p{L}'-]+)(?:\s+(?:de la|de l'|de|du|des|sur)\s+[A-ZÀ-Ý][\p{L}'-]+|[\s-]+[A-ZÀ-Ý][\p{L}'-]+){0,3})/gu)];
      const lieu = lieux.filter((x) => /^(?:à|a|au|aux|en)$/i.test(x[1])).at(-1) ?? lieux.at(-1);
      if (lieu) { input[p.key] = (/^au$/i.test(lieu[1]) ? 'Le ' : /^aux$/i.test(lieu[1]) ? 'Les ' : '') + lieu[2].replace(/[\s,.;:!?]+$/, ''); continue; }
    }
    if (k === 'format') { const f = /\b(?:en|vers|to|into|a|in|zu|nach)\s+(?:un |une |du |format |a |an )?\.?(pdfa|pdf|docx|odt|rtf|txt|html|md|jpe?g|png|webp|avif|gif|bmp|tiff|ico|mp4|mkv|webm|mov|avi|mp3|m4a|flac|wav|ogg|opus|aac|xlsx|ods|csv|tsv|json|yaml|toml|xml|srt|vtt|ass|lrc|vcf|ics|geojson|kml|gpx|zip|tar|epub|mobi|azw3|pptx|odp)\b/.exec(s)?.[1]; if (f) { input[p.key] = f.replace('jpeg', 'jpg'); continue; } }
    if (named) { input[p.key] = named; continue; }
    if (/^(ip|adresse_ip)$/.test(k) || (/adresse/.test(lab) && /\bip\b/.test(lab))) { if (ip) input[p.key] = ip; else if (mac && /mac/.test(lab)) input[p.key] = mac; continue; }
    if (/^(lien|url|adresse|source|site|flux)$/.test(k)) { if (url) input[p.key] = url; else if (k === 'adresse' && /\bsite\b/.test(lab) && domain) input[p.key] = domain; else if (/^(lien)$/.test(k) && repo && /github|depot|lien/.test(lab + s)) input[p.key] = repo; else if (ip && /adresse/.test(k)) input[p.key] = ip; if (input[p.key] !== undefined) continue; }
    if (/^(minutes|duree)$/.test(k)) { const mn = minutesIn(text); if (mn !== undefined) input[p.key] = mn; continue; }
    if (/^(jour|date)$/.test(k)) { if (dayIso) input[p.key] = dayIso; else if (when) input[p.key] = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`; continue; }
    if (/^(heure|debut|fin)$/.test(k)) { if (hour) input[p.key] = `${hour[1].padStart(2, '0')}:${hour[2] ?? '00'}`; continue; }
    if (/^(contact|email|mail|telephone)$/.test(k)) { if (mail ?? phone) input[p.key] = mail ?? phone; continue; }
    if (/^(machine)$/.test(k) && mac) { input[p.key] = mac; continue; }
    if (p.kind === 'number' || /^(vmid|pid|port|id)$/.test(k)) {
      const after = new RegExp(`\\b(?:${[k, ...lab.split(/[^a-z]+/).filter((x) => x.length > 2)].map(stem).filter(Boolean).join('|')})\\w*\\s*(?:n[o°]\\s*)?(\\d+)`).exec(s);
      // … ou annoncé par un mot d'une autre langue (« season 2 », « Staffel 2 », « 第10話 »).
      const dit = after ? undefined : nombreNomme(s, (p as ParamLu).mots ?? []);
      const n = after ? Number(after[1]) : dit ? dit.n : numbers[usedNum];
      if (n !== undefined && !Number.isNaN(n)) { input[p.key] = n; if (!after && !dit) usedNum++; }
      continue;
    }
    if (/^(nom|client)$/.test(k) && creates) { const who = /(?:au nom de|pour|de la part de|nomm[ée]e?|appel[ée]e?)\s+((?:[A-ZÀ-Ý][\p{L}'-]+)(?:\s+[A-ZÀ-Ý][\p{L}'-]+){0,2})/u.exec(text)?.[1]; if (who) { input[p.key] = who; continue; } }
    // Texte libre : d'abord ce qui est entre guillemets.
    if (quote !== undefined && !usedQuote && (p.kind === 'text' || p.kind === 'textarea')) { input[p.key] = quote; usedQuote = true; }
  }
  return input;
}

/** Ce qui reste de la phrase une fois retirés le verbe de commande et le nom de la chose (« cherche dans mes notes … »). */
function tail(text: string, verbs: string[], nouns: string[]): string {
  const vs = new Set(verbs.flatMap((d) => tokens(d)).map(stem)), ns = new Set(nouns.flatMap((d) => tokens(d)).map(stem));
  const words = text.replace(/^[\s,.;:!?]+|[\s.;!?]+$/g, '').split(/\s+/);
  const key = (w: string) => norm(w).replace(/^(?:[ldjmtsnc]|qu)'/, '').replace(/[^a-z0-9-]/g, '');
  let i = 0, nouned = 0;
  // Les noms propres de la liste (le nom de l'appli, « Dédale », « Vénus ») ne sont jamais pris pour le début d'un titre.
  const propres = new Set(nouns.filter((d) => /^\p{Lu}/u.test(d.trim())).flatMap((d) => tokens(d)).map(stem));
  // Un petit mot écrit avec sa majuscule au milieu de la phrase et suivi d'un autre mot à majuscule (« lance-moi Les Trois
  // Lunes ») ouvre un nom propre : il en fait partie et reste.
  const ouvreUnNom = (k: number) => k > 0 && /^\p{Lu}/u.test(words[k]) && /^\p{Lu}/u.test(words[k + 1] ?? '');
  while (i < words.length) { const w = key(words[i]); if (!w || (STOP.has(w) && !ouvreUnNom(i)) || vs.has(stem(w))) i++; else break; }
  // Un mot écrit avec sa majuscule au milieu de la phrase (« lance Serie Lumen », « le film Film Orage ») est le début
  // d'un nom propre, un titre : il reste entier, même s'il ressemble à un mot de l'appli.
  while (i < words.length && nouned < 3) { const w = key(words[i]); if (!w || (STOP.has(w) && !ouvreUnNom(i))) { i++; continue; } if (ns.has(stem(w)) && !(i > 0 && /^\p{Lu}/u.test(words[i]) && !propres.has(stem(w)))) { i++; nouned++; } else break; }
  while (i < words.length && (!key(words[i]) || (STOP.has(key(words[i])) && !ouvreUnNom(i)))) i++;
  return words.slice(i).join(' ').replace(/^(?:que\s+|qu'|de\s+|d'|:\s*)/i, '').trim();
}
/** Retire du texte libre ce qui a déjà servi à un autre réglage (date, heure, durée, téléphone, adresse). */
function strip(rest: string, input: Record<string, unknown>): string {
  let r = ` ${rest} `;
  if (input.jour !== undefined || input.date !== undefined) r = r.replace(/\s(?:pour\s+)?(?:apr[eè]s[- ]demain|demain|aujourd'hui|ce soir|ce matin|(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?:\s+prochain)?|le\s+\d{1,2}(?:[/.-]\d{1,2}(?:[/.-]\d{2,4})?|\s+\p{L}+)?|\d{4}-\d{2}-\d{2})(?=\s)/giu, ' ');
  if (input.valeur !== undefined) r = r.replace(/\s(?:[àa]\s+)?\d{1,3}(?:[.,]\d)?\s*(?:%|pour ?cent|°c?|degr[eé]s?)(?=\s)/gi, ' ');
  if (input.heure !== undefined) r = r.replace(/\s(?:[àa]\s+)?\d{1,2}\s*(?:h|:)\s*(?:\d{2})?(?=\s)/gi, ' ');
  if (input.minutes !== undefined || input.duree !== undefined) r = r.replace(/\s(?:pendant|durant|pour)?\s*\d+(?:[.,]\d+)?\s*(?:minutes?|min|mn|heures?|h|jours?|j|semaines?)(?=\s)/gi, ' ');
  for (const val of Object.values(input)) { const u = String(val ?? ''); if (u.length >= 2 && typeof val !== 'boolean') r = r.replace(new RegExp(`(^|\\s)(?:(?:pendant|durant|sur|pour|de|du|au|à|a)\\s+)?${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i'), ' '); }
  return r.replace(/\s+(?:pour|de|du|à|a|au|sur|et)\s*$/i, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Retire du texte libre « <mot du réglage> N » quand ce N a rempli un réglage chiffré de l'action, lu comme dans `fill`
 * (son nom et son intitulé, à la racine) : « Serie Lumen saison 2 épisode 5 » → « Serie Lumen » quand saison = 2 et
 * épisode = 5. Aucune liste de mots ici : ce sont les mots de l'action elle-même.
 */
function sansNombresDits(rest: string, a: Action, input: Record<string, unknown>): string {
  let retire = false;
  // Les mots des autres langues (« season 2 », « Staffel 2 », « 第10話 ») : le passage qui a donné CE nombre part, là où il est.
  const parLangue = new Set<string>();
  for (const p of a.params ?? []) {
    const n = input[p.key], m = typeof n === 'number' ? nombreNomme(plat(rest), (p as ParamLu).mots ?? []) : undefined;
    if (m && m.n === n && plat(rest).length === rest.length) { rest = `${rest.slice(0, m.debut)} ${rest.slice(m.fin)}`.replace(/\s+/g, ' ').trim(); parLangue.add(p.key); retire = true; }
  }
  const ws = rest.split(/\s+/).filter(Boolean);
  for (const p of a.params ?? []) {
    const k = norm(p.key), n = input[p.key];
    if (!(p.kind === 'number' || /^(vmid|pid|port|id)$/.test(k)) || typeof n !== 'number' || parLangue.has(p.key)) continue;
    const racines = [k, ...norm(p.label).split(/[^a-z]+/).filter((x) => x.length > 2)].map(stem).filter(Boolean);
    for (let i = 0; i < ws.length - 1; i++) {
      // (le petit mot élidé devant, « l'épisode 2 », est lu comme dans `tokens`)
      const w = norm(ws[i]).replace(/^(?:[ldjmtsnc]|qu)'/, '').replace(/[^\p{L}\p{N}]/gu, '');
      if (!w || !racines.some((x) => w.startsWith(x))) continue;
      const j = /^n[o°]$/.test(norm(ws[i + 1])) ? i + 2 : i + 1;
      if (j < ws.length && Number(ws[j].replace(/[,;:!?.]+$/, '')) === n) { ws.splice(i, j - i + 1); retire = true; break; }
    }
  }
  // Ce qui annonçait ces nombres et reste en bout de titre (« … à la », « … à de la », « Titre, ») part aussi : sinon il
  // serait pris pour un lieu ou un écran. Seulement des petits mots (toutes langues connues) et la ponctuation.
  if (retire) while (ws.length > 1) { const d = ws.length - 1, w = norm(ws[d]).replace(/[^\p{L}\p{N}]/gu, ''); if (!w || STOP.has(w)) ws.pop(); else { ws[d] = ws[d].replace(/[,;:]+$/, ''); break; } }
  return ws.join(' ');
}

interface Pending { module: string; action: string; input: Record<string, unknown>; missing: string; at: number }
const pending = new Map<string, Pending>();
export const forgetPending = (session: string) => pending.delete(session);

function describe(v: Valhalla, m: Module): string {
  const name = (id: string) => v.module(id)?.name ?? id;
  const links = LINKS.filter((l) => l.from === m.id || l.to === m.id);
  const usages = USAGES.filter((u) => u.chain.includes(m.id));
  return [v.describe(m),
    links.length ? `Liens avec les autres applis :\n${links.map((l) => `- ${name(l.from)} → ${name(l.to)} : quand ${l.when}, ${l.does}`).join('\n')}` : '',
    usages.length ? `Utile pour : ${usages.map((u) => `${u.need} (${u.chain.map(name).join(' → ')})`).join(' ; ')}.` : '',
    `Exemples : ${examples(m).slice(0, 4).map((e) => `« ${e} »`).join(', ')}.`].filter(Boolean).join('\n');
}
/** Les mots qui prouvent qu'on demande CETTE action : ses mots, son nom, ses verbes synonymes (pas son intitulé, souvent un simple nom). */
const verbsOf = (a: Action) => new Set([...(a.words ?? []), a.id.replace(/_/g, ' '), ...SYN.filter(([re]) => re.test(a.id)).flatMap(([, syn]) => syn)].flatMap((x) => tokens(x)).map(stem));
/**
 * La demande dit-elle le VERBE de cette action (un de ses mots, son nom, un synonyme), dans n'importe quelle langue connue ?
 * Sert à ne jamais proposer une action dont seul le réglage a été deviné quand l'ordre lui-même n'a pas été dit
 * (« apaga la máquina … » n'est pas « cloner une machine »).
 */
export function verbeDit(v: Valhalla, text: string, moduleId: string, actionId: string): boolean {
  const m = v.modules().map(avecLangues).find((x) => x.id === moduleId), a = m?.actions.find((x) => x.id === actionId);
  if (!a) return false;
  const verbs = verbsOf(a);
  return words(text).some((w) => verbs.has(stem(w)));
}
/** Les mots des actions qui ne font que montrer (« processus », « alertes », « appareils ») : ils nomment des choses, pas des ordres. */
const verbsOfShows = (m: Module) => new Set(m.actions.filter((x) => x.read && !(x.params ?? []).some((p) => p.required)).flatMap((x) => [...(x.words ?? []), x.id.replace(/_/g, ' ')]).flatMap((x) => tokens(x)).map(stem));
/** Une expression est-elle dans ce texte (au pluriel près, apostrophes et traits d'union comme des espaces) ? */
function within(text: string, expr: string): boolean {
  const flat = (x: string) => norm(x).replace(/['-]/g, ' ').replace(/\s+/g, ' ').trim(), n = flat(expr);
  return n.length > 0 && new RegExp(`(?:^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|x|es)?(?=[\\s,.;:!?]|$)`).test(flat(text));
}

/**
 * Phrases d'exemple tirées des actions de l'appli (pour l'aide et la mascotte). Chacune doit marcher
 * telle quelle, sans IA, y compris quand une IA est disponible : un test les passe toutes à Logos.
 * Dans l'ordre : l'intitulé de l'action quand il nomme l'appli (« lister les conteneurs »), sinon une
 * expression que l'action déclare (« vérifie les sauvegardes »), sinon son verbe suivi de la chose
 * (« démarre conteneur <conteneur> »). Une action qu'on ne sait pas dire sûrement n'a pas d'exemple.
 */
export function examples(m: Module): string[] {
  const thing = m.words[0] ?? norm(m.name);
  const mine = (t: string) => [...m.words, m.name].some((w) => within(t, w));
  const out: string[] = [];
  for (const a of m.actions.slice(0, 8)) {
    // La forme accentuée quand l'appli la donne (« etat » → « état »).
    const pretty = (w: string) => (a.words ?? []).find((x) => x !== w && norm(x) === norm(w) && x !== norm(x)) ?? w;
    const need = (a.params ?? []).filter((p) => p.required);
    const label = a.label.replace(/\s*\(.*\)\s*$/, '').toLowerCase();
    const multi = (a.words ?? []).find((w) => w.trim().includes(' ')), first = a.words?.[0];
    const base = tokens(label).length >= 2 && mine(label) ? label
      : multi ? pretty(multi)
      : first ? `${pretty(first)}${norm(first).includes(norm(thing).slice(0, 5)) ? '' : ` ${thing}`}`
      : mine(label) ? label : `${label} ${thing}`;
    // Une action qui change quelque chose se demande avec son verbe : un simple intitulé (« alertes à voix haute ») ne suffit pas.
    if (!a.read) { const verbs = verbsOf(a); if (!tokens(base).some((w) => verbs.has(stem(w)))) continue; }
    out.push(`${base}${need.length ? ` ${need.map((p) => `<${norm(p.label).split(' (')[0]}>`).join(' ')}` : ''}`.replace(/\s+/g, ' ').trim());
  }
  return out.length ? out : [thing];
}

/** Mots passe-partout : ils n'engagent à rien de précis, quelle que soit l'action. */
const LIGHT = new Set('lance lancer montre montrer affiche afficher donne donner voir dis dire vas va mets mettre liste lister etat actuel actuelle actuels actuelles moment encore deja ici quel quelle quels quelles combien'.split(' '));
/** Début d'une phrase à comprendre (« si le colis est arrivé », « que j'aime bien »), pas d'un nom ni d'un texte à transmettre. */
const CLAUSE = /^(?:si|s'|que|qu'|qui|quand|comme|ou|ce qu|ce que|ce qui|pour que|afin|car|parce|comment|pourquoi|combien|lequel|laquelle|je|j'|tu|il|elle|on|nous|vous|ils|elles|c'est|ca)(?:\s|'|$)/;
/** Réglages qui portent un message à transmettre tel quel (une phrase y est à sa place). */
const MESSAGE = /^(texte|message|note|contenu|annonce|article|articles|sujet)$/;
/** Les mots d'une demande, pour mesurer ce qui est expliqué (« montre-moi » → « montre », « fera-t-il » → « fera »). */
const words = (t: string) => norm(t.replace(/,\s*odin\s*[.!?]*\s*$/i, '').replace(/-t-(?:il|elle|on|ils|elles)\b/gi, ' ').replace(/-(?:moi|toi|nous|le|la|les|lui|leur|en|y|tu|je|il|elle|on|ils|elles|ce)\b/gi, ' '))
  .split(/[^\p{L}\p{N}.:/@_-]+/u).map((w) => w.replace(/^(?:[ldjmtsnc]|qu)'/, '').replace(/^[.:/@_-]+|[.:/@_-]+$/g, '')).filter((w) => w && (w === 'odin' || !STOP.has(w)));
const stemsOf = (list: string[]) => new Set(list.flatMap((x) => tokens(x)).map(stem));
/** Vocabulaire d'une appli (ses mots, son nom, d'où elle vient). */
const vocab = (m: Module) => stemsOf([...m.words, m.name, ...(forgetsId(m.id) ? [] : [m.id]), ...m.from, ...(m.modes ?? []).map((x) => x.split(' ')[0])]);

interface Evidence {
  body: string; m: Module; a: Action; input: Record<string, unknown>; names: Names;
  /** Texte pris dans le reste de la phrase ; `thing` : il doit nommer une chose que l'appli connaît (appareil, conteneur…). */
  captured?: { key: string; required: boolean; text: string; thing: boolean };
  /** L'appli est nommée par une chose (un de ses noms, son nom, une chose qu'elle connaît), pas seulement par un verbe en tête. */
  designated: boolean;
  /** L'action a été prise faute de mieux (« l'état de l'appli »), sans mot qui la demande. */
  fallback: boolean;
}
/**
 * Ce qui, dans la phrase, n'est PAS expliqué par l'appli et l'action choisies. Rend la raison du doute,
 * ou undefined quand tout est expliqué : le verbe de tête, chaque mot, et le texte libre s'il y en a un.
 */
function doubtOf(e: Evidence): { text: string; near: boolean } | undefined {
  const { m, a, input } = e, toks = words(e.body); if (!toks.length) return undefined;
  const far = (text: string) => ({ text, near: false }), near = (text: string) => ({ text, near: e.designated });
  const mod = vocab(m);
  const act = stemsOf([...(a.words ?? []), a.id.replace(/_/g, ' '), a.label, ...SYN.filter(([re]) => re.test(a.id)).flatMap(([, syn]) => syn)]);
  const par = stemsOf((a.params ?? []).flatMap((p) => [p.key.replace(/_/g, ' '), p.label.replace(/\(.*$/, '')]));
  // Le texte libre pris dans le reste de la phrase : seulement s'il est indispensable à l'action, que l'appli
  // est nommée par une chose (pas seulement par un verbe), et que ce n'est pas une phrase à comprendre.
  const cap = e.captured;
  if (cap) {
    // Ce qui précède le texte pris (« … que j'aime bien », « … si le colis est arrivé ») dit si c'est une phrase à comprendre.
    const nb = norm(e.body), at = nb.lastIndexOf(norm(cap.text)), before = at > 0 ? nb.slice(0, at).trim() : '';
    const clause = CLAUSE.test(norm(cap.text)) || /(?:^|\s)(?:que|qu'|si|qui|quand|comme|dont)$/.test(before);
    if (clause && !MESSAGE.test(norm(cap.key))) return far('c\'est une phrase à comprendre, pas un nom à chercher');
    if (!cap.required || !e.designated) return far(`je devinais ce qu'il fallait donner à ${m.name}`);
    // Une chose à commander (appareil, conteneur, machine…) doit être une chose que je connais par son nom.
    if (cap.thing) return near(`je ne connais pas « ${cap.text.slice(0, 40)} » dans ${m.name}`);
  }
  // Ce que la phrase désigne : valeurs prises dans la phrase (hors texte libre) et noms connus de l'appli (conteneur, caméra, plan…).
  const named = new Set<string>(), free = new Set<string>(cap ? words(cap.text).map(stem) : []);
  for (const [k, val] of Object.entries(input)) if (k !== cap?.key && (typeof val === 'string' || typeof val === 'number')) for (const w of words(String(val))) named.add(stem(w));
  for (const list of e.names.values()) for (const n of list) if (norm(n).length >= 2 && pickName(e.body, [n])) for (const w of words(n)) named.add(stem(w));
  const has = (k: string) => input[k] !== undefined && input[k] !== '';
  const duration = has('minutes') || has('duree'), day = has('jour') || has('date'), hour = has('heure') || has('debut') || has('fin');
  const number = (a.params ?? []).some((p) => (p.kind === 'number' || /^(vmid|pid|port|id|valeur|etat)$/.test(norm(p.key))) && has(p.key));
  const typed = (w: string) => (/^\d+(?:[.,]\d+)?$/.test(w) && (duration || day || hour || number))
    || (/^(?:minutes?|min|mn|heures?|h|jours?|j|semaines?|pendant|durant)$/.test(w) && duration)
    || (/^(?:\d{1,2}h(?:\d{2})?|\d{1,2}:\d{2}|h|heures?)$/.test(w) && (hour || day))
    || (/^(?:demain|apres-demain|aujourd'hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|prochain|prochaine|soir|matin|midi|apres-midi|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)$/.test(w) && (day || hour))
    || (/^(?:degres?|pourcent|cent)$/.test(w) && has('valeur'));
  // Une écriture sans espaces (japonais, chinois…) : le mot est « expliqué » s'il contient une tournure de l'appli ou de l'action.
  const sansEspaces = [...m.words, ...(a.words ?? [])].map(norm).filter((x) => SANS_ESPACES.test(x));
  const known = (w: string) => { const s = stem(w); return mod.has(s) || act.has(s) || LIGHT.has(w) || (SANS_ESPACES.test(w) && sansEspaces.some((x) => w.includes(x))); };
  // Une action qui change quelque chose se demande avec son verbe (ou un de ses mots) : son intitulé seul, souvent un
  // simple nom (« alertes à voix haute »), ne dit pas s'il faut l'activer, la couper ou juste la montrer.
  if (!a.read) {
    const verbs = verbsOf(a); if (!toks.some((w) => verbs.has(stem(w)))) return near(`je ne sais pas ce que tu veux faire avec ${m.name} (${a.label})`);
    // … et en disant sur quoi : une chose de l'appli, une valeur (adresse, nom, dossier…), ou une phrase que l'action
    // déclare mot pour mot (« lance la sauvegarde »). « Mets à jour » tout court ne dit pas quoi mettre à jour.
    const valued = Object.entries(input).some(([k, val]) => k !== cap?.key && val !== undefined && val !== '');
    const whole = (a.words ?? []).some((w) => { if (!w.trim().includes(' ')) return false; const x = new Set(words(w).map(stem)); return toks.every((t) => x.has(stem(t)) || LIGHT.has(t)); });
    if (!e.designated && !valued && !whole && !cap) return far(`je ne vois pas sur quoi porte « ${a.label} » (${m.name})`);
  }
  // Action prise faute de mieux (« l'état de l'appli ») alors que la phrase demande autre chose (« quel film regarder ») : pas sûr.
  if (e.fallback) { const other = new Set(m.actions.filter((x) => x.id !== a.id).flatMap((x) => [...verbsOf(x)])); const verb = toks.find((w) => !LIGHT.has(w) && other.has(stem(w)) && !act.has(stem(w)) && !verbsOfShows(m).has(stem(w))); if (verb) return far(`tu parles de « ${verb} », mais je ne vois pas quelle action de ${m.name} tu demandes`); }
  // Le mot de tête (le verbe, le plus souvent) doit être celui de l'appli ou de l'action, ou désigner une de ses choses :
  // jamais un autre ordre (« installe … », « bloque … ») rangé d'office dans un texte libre.
  const lead = toks[0];
  if (!known(lead) && !par.has(stem(lead)) && !named.has(stem(lead))) return far(`« ${lead} » n'est pas une action que je connais pour ${m.name}`);
  const left = toks.filter((w) => !known(w) && !par.has(stem(w)) && !named.has(stem(w)) && !free.has(stem(w)) && !typed(w));
  if (left.length) { const u = [...new Set(left)]; return { text: `je ne suis pas ${accord('sûr', 'sûre')} d'avoir tout compris (${u.slice(0, 3).map((w) => `« ${w} »`).join(', ')})`, near: e.designated && u.length === 1 }; }
  return undefined;
}

/**
 * Comprend une demande. `session` permet de finir une demande en deux messages (« il me manque… »).
 * Renvoie undefined quand rien n'est compris avec assez de certitude.
 */
export async function understand(v: Valhalla, text: string, session = 'principal', now = new Date()): Promise<Understood | undefined> {
  const w = pending.get(session), attendait = Boolean(w && now.getTime() - w.at < 5 * 60_000);
  const r = await comprendre(v, text, session, now);
  // Une réponse à une question en attente, ou une demande comprise sans doute : rien à revoir.
  if (attendait || r?.kind === 'manip' || (r?.kind === 'say' && !r.unsure)) return r;
  // Une personne sans droit sur Vénus : sa bibliothèque n'est pas lue (la réponse ne dit pas qu'un titre existe).
  if (refusAppli('freyja')) return r;
  const regarde = r?.kind === 'action' && r.module === 'freyja' && r.action === 'regarder';
  if (r?.kind === 'action' && !r.doubt) {
    // Sauf « regarder » avec un titre qui n'est pas EXACTEMENT dans la bibliothèque, quand la phrase en dit un (« Spiel den
    // Film Été Glacé » : en allemand chaque nom a sa majuscule, et « Film » restait collé au titre).
    if (!regarde) return r;
    try { if (titresDeVenus(v).has(exacte(lireDemande(String(r.input.quoi ?? '')).titre))) return r; } catch { return r; }
  }
  const t = titreALire(v, text, session, now);
  if (!t) {
    // « Spiel ein Spiel » (jouer à un jeu) : le verbe seul, sans titre ni mot de Vénus (« film », « série »), ne lui pose pas
    // la question « quel titre ? » (la réponse suivante serait prise pour un titre).
    if (r?.kind === 'ask' && r.module === 'freyja' && r.action === 'regarder' && r.missing === 'quoi') {
      const f = v.module('freyja'), voc = f ? vocab(avecLangues(f)) : new Set<string>();
      if (!tokens(corpsDe(text)).some((w) => voc.has(stem(w)))) { pending.delete(session); return undefined; }
    }
    if (!r || r.kind !== 'action' || !regarde) return r;
    // Pas de titre de la bibliothèque, quand seuls les mots des autres langues (« play », « ponme », « Spiel », « 再生して »)
    // ont mené à « regarder » : deviné loin de la phrase (« Spiel Nebelwald », « ponme Nuit Rouge »), ou un titre que la
    // recherche de Vénus elle-même ne trouve pas (« Spiel den Film Nuit Rouge », « Pon Brume en la tele del salón »), rien ne
    // part vers Vénus : rien n'est deviné, jamais une réponse fausse. Les verbes d'avant (« mets Inception sur la télé »)
    // ne changent pas : Vénus répond elle-même que le titre n'est pas dans la bibliothèque, et comment l'ajouter.
    if (!parMotsAjoutes(text)) return r;
    if (r.doubt && !r.near) return undefined;
    return dansVenus(v, r.input) ? r : undefined;
  }
  // Un titre exact de la bibliothèque après un verbe de lecture. Il ne remplace que ce qui n'a rien donné de sûr : rien, une
  // hésitation, ou Vénus elle-même. Si une AUTRE appli a posé une question ou agi avec un doute (« mets la lumière » quand un
  // film s'appelle « La Lumière »), la demande n'est jamais détournée en silence : je propose les deux.
  // (Sauf quand l'autre appli n'a été devinée que par le verbe de lecture, ou par rien, et que le titre est dit tel quel :
  // « joue Brume », « lance-moi les trois lunes s03e07 », « play Les Trois Lunes ». « ouvre le portail » — un mot retiré devant
  // le titre — et « mets la lumière » — « lumière » est un mot de l'autre appli — restent une question.)
  if (r?.kind === 'ask') pending.delete(session);
  if (!r || r.kind === 'say' || r.module === 'freyja') return t.u;
  if (t.tel && !nommee(v, r.module, text, t.verbe)) return t.u;
  const autre = r.kind === 'action' ? r.label : `${v.module(r.module)?.name ?? r.module} · ${v.action(r.module, r.action)?.a.label ?? r.action}`;
  const titre = String((t.u.kind === 'action' ? t.u.input.quoi : '') ?? '').slice(0, 80);
  // La phrase qui lève le doute dit « film » ou « série » (« regarde le film La Lumière ») : elle est alors comprise sans doute.
  let sorte = '';
  try { const o = trouverOeuvre(magasinVenus(v.ctx('freyja').home, v.ctx('freyja').dir), lireDemande(titre).titre); sorte = o?.data.type === 'film' ? 'le film ' : o?.data.type === 'serie' ? 'la série ' : ''; } catch { /* sans exemple */ }
  return { kind: 'say', unsure: true, text: `Tu parles de ${autre}, ou de regarder « ${titre} » (Vénus) ? Redis-le avec le nom de l'appli${sorte ? ` (pour Vénus : « regarde ${sorte}${titre} »)` : ''}.` };
}

/**
 * Un mot de la phrase, hors du verbe de lecture employé, est-il à cette appli (ses mots, son nom, les mots de ses actions,
 * toutes langues connues) ? Une écriture sans espaces compte quand un mot de l'appli y est collé.
 */
function nommee(v: Valhalla, id: string, text: string, verbe: string[]): boolean {
  const m0 = v.module(id); if (!m0) return true;
  const m = avecLangues(m0), liste = [...m.words, m.name, ...(forgetsId(m.id) ? [] : [m.id]), ...m.from, ...m.actions.flatMap((a) => a.words ?? [])];
  const siens = stemsOf(liste), colles = liste.map(norm).filter((x) => SANS_ESPACES.test(x)), lu = new Set(verbe.map(stem));
  return tokens(corpsDe(text)).filter((w) => !lu.has(stem(w))).some((w) => {
    if (siens.has(stem(w))) return true;
    if (!SANS_ESPACES.test(w)) return false;
    const reste = verbe.filter((x) => SANS_ESPACES.test(x)).reduce((acc, x) => acc.split(norm(x)).join(' '), w);
    return colles.some((x) => reste.includes(x));
  });
}

/**
 * La phrase commence (ou, sans espaces, finit) par un mot que les fichiers de langue ajoutent à l'action « regarder » de
 * Vénus (« play », « put on », « ponme », « Spiel », « 再生して ») : ce sont eux qui l'y ont menée.
 */
function parMotsAjoutes(text: string): boolean {
  const corps = norm(corpsDe(text)).replace(/^[\s,.;:!?¡¿]+|[\s.;!?]+$/g, '');
  return motsAjoutes('freyja.regarder').map(norm).filter(Boolean)
    .some((w) => (SANS_ESPACES.test(w) ? corps.includes(w) : corps === w || corps.startsWith(`${w} `)));
}

/**
 * La recherche de Vénus elle-même (son action « regarder ») trouve-t-elle ce titre ? Un mot, des mots du titre, à la casse
 * et aux accents près, ou le titre avant les nombres de saison et d'épisode donnés à part. En cas de doute (bibliothèque
 * illisible, serveur Vénus à part relié), oui : rien ne change pour lui.
 */
function dansVenus(v: Valhalla, input: Record<string, unknown>): boolean {
  if (process.env.VENUS_API_KEY) return true;
  try {
    const c = v.ctx('freyja'), M = magasinVenus(c.home, c.dir), quoi = String(input.quoi ?? ''), dem = lireDemande(quoi);
    if (!dem.titre) return true;
    if (trouverOeuvre(M, dem.titre) || trouverOeuvre(M, quoi)) return true;
    const nums = [input.saison, input.episode].filter((x) => typeof x === 'number'), w = dem.titre.split(' ');
    const at = w.findIndex((x) => nums.includes(Number(x.replace(/[,;:!?.()[\]]/g, ''))));
    for (let k = at; k >= Math.max(1, at - 1); k--) if (trouverOeuvre(M, w.slice(0, k).join(' '))) return true;
    return false;
  } catch { return true; }
}

/**
 * Un titre mis à plat pour une comparaison EXACTE, toutes écritures gardées (« プレイリストCalme » n'est pas « Calme ») :
 * seuls les accents, la casse et les signes entre les mots ne comptent pas.
 */
const exacte = (t: string) => plat(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Les titres de la bibliothèque de Vénus, mis à plat ; seulement ceux que sa recherche sait retrouver (lettres latines, chiffres). */
function titresDeVenus(v: Valhalla): Set<string> {
  const c = v.ctx('freyja');
  return new Set(magasinVenus(c.home, c.dir).liste('oeuvres').map((e) => String(e.data.titre ?? '')).filter((t) => normTitre(t)).map(exacte));
}

/** La phrase sans ce qui la précède (« dis-moi », « Odin, ») et sans le pronom collé à un verbe de lecture en tête. */
function corpsDe(text: string): string {
  // Le pronom collé à un verbe de lecture en tête (« lance-moi … », « mets-moi … », verbes de « regarder ») est retiré comme
  // plus bas pour les expressions (sbx) : le verbe est alors reconnu, et il n'est plus pris pour le début du titre.
  // (Pas pour les autres verbes : « trouve-moi une idée de cadeau » reste une demande pour une IA.)
  return text.replace(/^\s*(?:dis|dites)[- ](?:moi|nous|donc|voir)\b[\s,:]*/i, '').replace(/^\s*(?:odin|s'il te pla[iî]t|stp|svp)[\s,:]+/i, '')
    .replace(/^(\s*)(\p{L}+)-(?:moi|lui|nous|leur)(?=[\s,.;:!?]|$)/u, (tout, sp: string, verbe: string) => (VERBES_LIRE.has(stem(verbe)) ? sp + verbe : tout));
}

/**
 * « lance-moi Brume », « joue Brume », « mets-moi Jardin Noir S02E10 » : un verbe de lecture en tête (ceux de l'action
 * « regarder » de Vénus et de la ligne SYN « regarder », plus ses tournures des autres langues connues), suivi EXACTEMENT
 * d'un titre de la bibliothèque de Vénus (à la casse, aux accents, à un S02E10 / 2x10 près ; les petits mots devant,
 * « moi », « le », peuvent tomber, jamais un mot du titre). Rien d'autre n'est deviné : un titre absent de la bibliothèque,
 * ou approché, ne vient pas ici. Sert quand le reste de Logos n'a rien compris de sûr (aucun titre ne dit « film »).
 * Les autres langues connues (`src/langue/langues/*.json`) donnent leurs verbes (« play », « put on », « ponme », « Spiel »),
 * leurs mots de saison et d'épisode (« season 2 », « Staffel 2 », « 第10話 ») ; une écriture sans espaces dont le verbe vient
 * à la FIN (« Jardin Noirのシーズン2第10話を再生して ») est lue depuis la fin, sans rien changer aux autres langues.
 */
/** Un titre lu : la demande, le titre dit tel quel (aucun mot retiré devant), et le verbe de lecture employé. */
type TitreLu = { u: Understood; tel: boolean; verbe: string[] };
function titreALire(v: Valhalla, text: string, session: string, now: Date): TitreLu | undefined {
  try {
    const f = v.action?.('freyja', 'regarder'); if (!f) return undefined;
    const a = avecLangues(f.m).actions.find((x) => x.id === 'regarder') ?? f.a;
    const verbes = new Set([...VERBES_LIRE, ...(a.words ?? []).filter((w) => !w.trim().includes(' ')).map(stem)]);
    const titres = titresDeVenus(v);
    const cle = (w: string) => norm(w).replace(/^(?:[ldjmtsnc]|qu)'/, '').replace(/[^\p{L}\p{N}-]/gu, '');
    // Les mots de Vénus et de l'action (« film », « movie », « película », « 映画 »), toutes langues connues.
    const siens = [...avecLangues(f.m).words, ...(a.words ?? [])].filter((w) => !w.trim().includes(' '));
    const devant = new Set(siens.map(cle));
    /**
     * Le titre dit, s'il est EXACTEMENT dans la bibliothèque : seuls les petits mots et les mots de Vénus devant (« the movie »,
     * « den Film ») peuvent tomber, jamais un mot du titre.
     */
    const titreDit = (quoi: string): string | undefined => {
      const ws = quoi.split(/\s+/).filter(Boolean);
      for (let k = 0; k < ws.length; k++) {
        const q = ws.slice(k).join(' '), n = exacte(lireDemande(q).titre);
        if (n && titres.has(n)) return q;
        if (!STOP.has(cle(ws[k])) && !devant.has(cle(ws[k]))) break;
      }
      return undefined;
    };
    /** Saison et épisode annoncés par un mot (« saison 2 », « season 2 », « Staffel 2 », « 第10話 ») : jamais un nombre seul. */
    const nombres = (quoi: string): { reste: string; input: Record<string, unknown> } => {
      const pris = fill(a, quoi, new Map(), now), input: Record<string, unknown> = {};
      let reste = quoi;
      for (const p of a.params ?? []) { const n = pris[p.key]; if (typeof n !== 'number') continue; const r = sansNombresDits(reste, a, { [p.key]: n }); if (r !== reste) { reste = r; input[p.key] = n; } }
      return { reste, input };
    };
    const lire = (quoi: string, verbe: string[]): TitreLu | undefined => {
      const { reste, input } = nombres(quoi), q = titreDit(reste);
      return q ? { u: finish(v, f.m, f.a, { quoi: q, ...input }, session, now), tel: q === reste.split(/\s+/).filter(Boolean).join(' '), verbe } : undefined;
    };
    const corps = corpsDe(text).replace(/^[\s,.;:!?]+|[\s.;!?]+$/g, '');
    // 1. Le verbe en tête (« lance-moi Brume », « play Brume », « put on Brume », « ponme Brume », « Spiel Brume »).
    const ws = corps.split(/\s+/);
    const groupe = (a.words ?? []).map((w) => norm(w).split(' ')).filter((g) => g.length > 1).find((g) => g.every((x, i) => norm(ws[i] ?? '') === x));
    const k0 = verbes.has(stem(ws[0])) ? 1 : groupe?.length ?? 0;
    if (k0 && ws.length > k0) return lire(ws.slice(k0).join(' '), ws.slice(0, k0).map(norm));
    // 2. Une écriture sans espaces, verbe à la fin (« Brumeを再生して ») : le verbe, puis les petits mots collés (« を »,
    //    « の »), les mots de l'appli (« 映画 ») et les guillemets autour du titre tombent ; tous viennent des fichiers de langue.
    if (!SANS_ESPACES.test(corps) || plat(corps).length !== corps.length) return undefined;
    const colles = (l: string[]) => l.map(plat).filter((w) => SANS_ESPACES.test(w)).sort((x, y) => y.length - x.length);
    const fin = colles(a.words ?? []).find((w) => plat(corps).endsWith(w)); if (!fin) return undefined;
    const petits = colles([...STOP]), noms = colles(siens);
    const SIGNES = /^[\s、。・,.!?！？「」『』"“”()（）]/u;
    const rogner = (t: string, devant: boolean, liste: string[]): string => {
      for (;;) {
        const p = plat(t), sig = devant ? SIGNES.exec(t) : SIGNES.exec(t.slice(-1));
        if (sig && t) { t = devant ? t.slice(1) : t.slice(0, -1); continue; }
        const w = liste.find((x) => (devant ? p.startsWith(x) : p.endsWith(x)) && x.length < p.length);
        if (!w) return t;
        t = devant ? t.slice(w.length) : t.slice(0, -w.length);
      }
    };
    const { reste, input } = nombres(rogner(corps.slice(0, corps.length - fin.length), false, petits));
    const avant = rogner(reste, false, petits), q = rogner(avant, true, [...noms, ...petits]).trim();
    const dit = titreDit(q);
    return dit === q ? { u: finish(v, f.m, f.a, { quoi: q, ...input }, session, now), tel: q === avant.trim(), verbe: [fin] } : undefined;
  } catch { /* bibliothèque illisible : rien de deviné */ }
  return undefined;
}

async function comprendre(v: Valhalla, text: string, session: string, now: Date): Promise<Understood | undefined> {
  const s = norm(text); if (!s) return undefined;
  const mods = v.modules().map(avecLangues);

  // 1. Une question restée en attente : la réponse complète la demande.
  const wait = pending.get(session);
  if (wait && now.getTime() - wait.at < 5 * 60_000) {
    pending.delete(session);
    if (/^(non|annule|laisse|laisse tomber|rien|stop|oublie)\b/.test(s) || ABANDON.some((x) => s === x || s.startsWith(`${x} `))) return { kind: 'say', text: 'D\'accord, j\'abandonne cette demande.' };
    const f = v.action(wait.module, wait.action);
    if (f) {
      const p = (f.a.params ?? []).find((x) => x.key === wait.missing)!;
      const got = fill({ ...f.a, params: [p] }, text, await namesOf(v, f.m), now)[p.key];
      const value = got ?? (p.kind === 'number' ? Number(s.replace(',', '.')) : text.trim().replace(/^["«“]\s*|\s*["»”]$/g, ''));
      if (p.kind !== 'number' || !Number.isNaN(value)) return finish(v, f.m, f.a, { ...wait.input, [p.key]: value }, session, now);
    }
  }

  // 2. Les manips d'Odin : garder, annuler, voir.
  if (/^(mes|tes|les) manips?\b|qu'(as-tu|est-ce que tu as) fait|ce que tu as fait|quelles manips/.test(s)) {
    const l = v.manips({ limit: 12 });
    return { kind: 'say', text: l.length ? `Mes dernières manips :\n${l.map((x) => `- [${x.id}] ${x.at.slice(5, 16).replace('T', ' ')} · ${x.label} — ${x.text} · ${x.state}${x.state === 'à décider' ? ` → « garde ${x.id} » ou « annule ${x.id} »` : x.decidedBy ? ` (par ${x.decidedBy})` : ''}`).join('\n')}` : 'Je n\'ai rien fait de moi-même pour l\'instant.' };
  }
  const dec = /^(garde|garder|valide|valider|conserve|ok pour|annule|annuler|defais|defaire|reviens sur)\s+(?:la |le |les )?(?:manips?\s+)?(tout|toutes|tous|la derniere|derniere|dernier|[a-z][a-z0-9]{3})\s*(?:manips?)?$/.exec(s);
  if (dec) {
    const id = dec[2].replace(/^la /, ''), keep = /^(garde|valide|conserve|ok)/.test(dec[1]);
    if (/^(tout|toutes|tous|derniere|dernier)$/.test(id) || v.manips({ limit: 500 }).some((x) => x.id === id)) return { kind: 'manip', id, keep };
  }

  // 3. Explications.
  const explain = /^(?:c'est quoi|qu'est-ce que(?: c'est)?|a quoi sert|a quoi ca sert|explique(?:-moi)?|presente(?:-moi)?|comment (?:marche|fonctionne)|parle-moi de|decris|que fait|que sait faire)\s+(.+?)\??$/.exec(s);
  if (explain) {
    const asked = /^(l'appli|l'application|le module|la page)\b/.test(explain[1]), subject = explain[1].replace(/^(l'appli|l'application|le module|la page|l')\s*/, '').replace(/^(?:des |de |du |d')/, '').trim();
    const byId = v.module(subject), exact = byId && forgetsId(byId.id) && norm(subject) === norm(byId.id) ? undefined : byId, m = exact ?? v.find(explain[1])[0]?.m;
    // Sûr seulement si c'est bien l'appli qu'on demande : par son nom (« explique Cerbère »), ou « l'appli … » avec ses mots à elle.
    // « Explique-moi Docker », « c'est quoi un VPN » : c'est la notion qu'on veut, pas la fiche de mon appli.
    if (m) { const own = vocab(m), byName = norm(subject) === norm(m.name) || (!forgetsId(m.id) && norm(subject) === norm(m.id)); return { kind: 'say', text: describe(v, m), ...(byName || (asked && words(subject).every((w) => own.has(stem(w)))) ? {} : { unsure: true }) }; }
  }
  if (/\b(qui fait quoi|liens? entre (les |tes |mes )?applis?)\b/.test(s)) return { kind: 'say', text: ['Les liens entre mes applis (tous automatiques) :', ...LINKS.map((l) => `- ${v.module(l.from)?.name ?? l.from} → ${v.module(l.to)?.name ?? l.to} : quand ${l.when}, ${l.does}`)].join('\n') };

  // 4. Choisir l'appli (d'après ce dont on parle), puis l'action (d'après le verbe et ce que la phrase fournit).
  const body = corpsDe(text);
  const toks = tokens(body), stems = new Set(toks.map(stem)), sb = norm(body);
  // Une expression de plusieurs mots (« crée une vm », « cherche un document ») est aussi reconnue quand le pronom est collé
  // au verbe (« crée-moi une vm », « cherche-moi un document »). Les mots isolés, eux, ne changent pas.
  const sbx = sb.replace(/([a-z])-(?:moi|lui|nous|leur)(?=[\s,.;:!?]|$)/g, '$1');
  const has = (w: string) => { const n = norm(w); if (SANS_ESPACES.test(n)) return sb.includes(n); if (!n.includes(' ')) return stems.has(stem(n)) || toks.includes(n); const re = new RegExp(`(?:^|[\\s'])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|x|es)?(?=[\\s,.;:!?]|$)`); return re.test(sb) || re.test(sbx); };
  const listing = /^(?:mes|les|liste|lister|quels?|quelles?|montre|affiche|voir|etat|combien|ou en|qui est|qui sont|qu'est-ce qu)\b/.test(sb);
  const none: Names = new Map(), strong = new Set<string>();
  // Une question ne lance jamais une action qui change quelque chose : seulement une lecture.
  const question = /\?\s*$/.test(body) || /^(?:quand|pourquoi|comment|est-ce|combien|ou |qui |quel|quelle|quels|quelles|a quelle|depuis quand|y a-t-il|il y a)\b/.test(sb);
  const badIp = /\b\d{1,3}(?:\.\d{1,3}){3}\b/.exec(body)?.[0];
  if (badIp && !isIP(badIp)) return { kind: 'say', text: `« ${badIp} » n'est pas une adresse IP valide (quatre nombres de 0 à 255).` };
  const lead = stem(toks[0] ?? '');
  const own = new Map<string, number>(); for (const mm of mods) for (const aa of mm.actions) for (const k of new Set((aa.words ?? []).filter((w) => !w.includes(' ')).map(stem))) own.set(k, (own.get(k) ?? 0) + 1);
  const actionScore = (m: Module, a: Action, names: Names): number => {
    let as = 0;
    // Un mot écrit avec et sans accent (« activite », « activité ») ne compte qu'une fois.
    for (const w of new Set((a.words ?? []).map(norm))) if (has(w)) as += w.includes(' ') ? 4 : 3;
    for (const part of a.id.split('_')) if (part.length > 2 && stems.has(stem(part))) as += 2;
    for (const w of tokens(a.label)) if (w.length > 3 && stems.has(stem(w))) as += 1.5;
    for (const [re, syn] of SYN) if (re.test(a.id) && syn.some(has)) { as += 2; break; }
    // Le verbe en tête de phrase (« tue… », « annule… », « redémarre… ») pèse davantage : c'est l'ordre donné.
    if (lead && as > 0 && ([...(a.words ?? []), a.id.split('_')[0]].some((w) => stem(w) === lead) || SYN.some(([re, syn]) => re.test(a.id) && syn.some((x) => stem(x) === lead)))) as += 2;
    if (question && !a.read) return -10;
    // Ce que la phrase fournit : une adresse IP pour « bannir », un nom de conteneur pour « arrêter »…
    // Preuve nette : une expression exacte de l'action, ou son verbe propre (qu'aucune autre action n'emploie) en tête de phrase.
    if ((a.words ?? []).some((w) => (w.includes(' ') && has(w)) || (stem(w) === lead && lead.length >= 5 && own.get(lead) === 1))) strong.add(`${m.id}.${a.id}`);
    const need = (a.params ?? []).filter((p) => p.required);
    if (need.length) {
      const got = fill(a, body, names, now), n = need.filter((p) => got[p.key] !== undefined).length;
      // Un texte libre encore vide n'est pas un manque : il sera pris dans le reste de la phrase.
      const lacking = need.filter((p) => got[p.key] === undefined && !(FREE.test(norm(p.key)) && (p.kind === 'text' || p.kind === 'textarea'))).length;
      as += n * 2 - lacking * (as > 0 ? 1.5 : 0);
      if (n > 0 && as > n * 2) strong.add(`${m.id}.${a.id}`);
      if (listing && !a.read && n === 0) as -= 4;
    } else if (listing) as += a.read ? 1 : -4;   // « les analyses », « mes sauvegardes » : on demande à voir, pas à lancer
    return as;
  };
  const verbish = (m: Module, w: string) => m.actions.some((a) => (a.words ?? []).some((x) => norm(x) === norm(w))) || SYN.some(([, syn]) => syn.includes(norm(w)));
  const scored = mods.map((m) => {
    let ms = 0, nouns = 0;
    // Un mot qui est aussi un verbe d'action (« allume », « dis », « joue ») désigne moins sûrement l'appli
    // qu'un nom : à égalité, l'appli désignée par un nom passe devant.
    for (const w of m.words) if (has(w)) { ms += w.includes(' ') ? 3 : 2; if (!verbish(m, w)) nouns++; }
    if (has(m.name) || (!forgetsId(m.id) && has(m.id))) ms += 5;
    for (const x of m.from) if (has(x)) ms += 4;
    for (const x of m.modes ?? []) if (has(x.split(' ')[0])) ms += 3;
    let best: Action | undefined, bs = 0;
    for (const a of m.actions) { const as = actionScore(m, a, none); if (as > bs) { bs = as; best = a; } }
    return { m, ms, nouns, best, bs };
  }).filter((x) => x.ms > 0 || x.bs >= 3);
  if (!scored.length) return undefined;
  const order = () => scored.sort((a, b) => (b.ms - a.ms) || (b.nouns - a.nouns) || (b.bs - a.bs));
  order();
  // Les noms connus départagent (« arrête web » : le conteneur « web » désigne Argo).
  for (const c of [...scored].sort((a, b) => (b.ms + b.bs) - (a.ms + a.bs)).slice(0, 4)) {
    const names = await namesOf(v, c.m), mine = [...names.values()].flat().filter((n) => norm(n).length >= 3 && !COMMON.test(norm(n)));
    if (pickName(body, mine)) { c.ms += 3; c.nouns++; c.bs = 0; c.best = undefined; for (const a of c.m.actions) { const as = actionScore(c.m, a, names); if (as > c.bs) { c.bs = as; c.best = a; } } }
  }
  order();
  const top = scored[0], second = scored[1];
  // Certitude : l'appli doit être désignée (mot-clé, nom, ou nom d'une de ses choses), ou l'action très nette.
  //  - appli désignée : il faut en plus un verbe, ou une phrase qui ressemble à une demande (courte, ou qui commence par un verbe ou « les / mes / quels… ») ;
  //  - appli non désignée : il faut une action sans ambiguïté (expression exacte, ou réglage fourni comme une adresse IP).
  const first = stem(toks[0] ?? ''), verbFirst = SYN.some(([, syn]) => syn.some((x) => stem(x) === first)) || top.m.actions.some((x) => (x.words ?? []).some((w) => stem(w) === first));
  const commandLike = listing || verbFirst || toks.length <= 4;
  const narrative = /^(?:j'ai|j'avais|je |on a |on avait |nous |il |elle |ils |elles |hier|ce matin|tout a l'heure|l'autre jour)/.test(sb) || /\b(?:etait|etaient|c'etait|a ete|ont ete|avait|avaient)\b/.test(sb);
  const sure = top.ms >= 2 ? (top.bs >= 2 || (commandLike && !narrative)) : (top.bs >= 4 && Boolean(top.best) && strong.has(`${top.m.id}.${top.best!.id}`));
  if (!sure || (narrative && top.bs < 4)) return undefined;
  if (second && top.ms === second.ms && Math.abs(top.bs - second.bs) < 0.5 && top.bs < 3) return { kind: 'say', text: `Tu parles de ${top.m.name} (${top.m.what.split(':')[0].toLowerCase()}) ou de ${second.m.name} (${second.m.what.split(':')[0].toLowerCase()}) ? Redis-le avec le nom de l'appli.`, unsure: true };

  if (/\b(j'ai besoin|besoin d|quelle appli|quel outil|comment je fais pour|comment faire pour)\b/.test(s)) return undefined; // conseil : traité par l'outil (chaîne d'applis)
  type Cand = (typeof scored)[number];
  /** Ce qu'on tirerait de la phrase pour cette appli : l'action, ses réglages, et le doute qui reste. */
  const build = async (c: Cand): Promise<{ m: Module; a: Action; input: Record<string, unknown>; names: Names; doubt?: { text: string; near: boolean } } | undefined> => {
    const m = c.m, names = await namesOf(v, m);
    let a = c.bs >= 2 ? c.best : undefined;
    // Pas de verbe clair : l'état de l'appli (sa première lecture sans réglage).
    a ??= m.actions.find((x) => x.read && !(x.params ?? []).some((p) => p.required));
    if (!a) return undefined;
    const input = fill(a, body, names, now);
    let captured: Evidence['captured'];
    // Le reste de la phrase sert au réglage libre encore vide (« cherche dans mes notes facture orange »).
    // (Une liste d'exclusions, ou un dossier facultatif, ne se devinent pas dans le reste d'une phrase.)
    const free = (a.params ?? []).filter((p) => (p.kind === 'text' || p.kind === 'textarea') && input[p.key] === undefined && !TYPED.test(norm(p.key)) && !/^exclusions$/.test(p.key) && !(/^(dossier|chemin|fichier)$/.test(p.key) && !p.required));
    const target = free.find((p) => p.required) ?? (free.length === 1 && !a.read ? free[0] : free.find((p) => /^(q|quoi|texte|message)$/.test(p.key)));
    // Un identifiant ne se devine pas dans une phrase : s'il manque, Odin le demande (en montrant ceux qu'il connaît).
    if (target && (a.params ?? []).filter((p) => p.required && input[p.key] === undefined).length <= 1) {
      const verbs = [...(a.words ?? []), a.label, a.id.replace(/_/g, ' '), ...SYN.filter(([re]) => re.test(a!.id)).flatMap(([, syn]) => syn), 'prends', 'fais', 'donne'];
      // Texte libre : on retire aussi le nom de l'appli (« cherche dans mes notes … »). Nom d'une chose
      // (appareil, machine, conteneur) : on ne retire que le mot qui dit son genre (« le conteneur web » → « web »).
      const naming = /^(nom|titre)$/.test(target.key) && /^(ajouter|creer|nouveau|prestation|radio|liste|regle|suivre|deployer|preparer|creer_scene|noter|serveur)/.test(a.id); // un nom à créer, pas une chose existante
      const thing = !FREE.test(norm(target.key)) && !naming;
      let rest = strip(sansNombresDits(tail(body, verbs, thing ? [target.key, target.label.replace(/\(.*$/, '')] : [...m.words, m.name, ...m.from, 'appli', 'application']), a, input), input);
      // « corrige ça : je sui aller… » : un texte à transmettre, donné après deux-points, est pris tel quel (avec son « je »).
      const apres = MESSAGE.test(norm(target.key)) ? /:\s+(\S.*)$/s.exec(body)?.[1] : undefined;
      if (apres) rest = apres.trim();
      if (thing) rest = rest.replace(/^(?:de |du |des |d')/i, '');
      // « … sur la télé », « … dans le salon » : le lieu va dans son réglage.
      const where = (a.params ?? []).find((p) => p.key === 'ou' && (input.ou === undefined || input.ou === '' || input.ou === p.default));
      const place = where ? /^(.+?)\s+(?:sur|dans|au|aux|à|a)\s+(?:la |le |l'|les )?([\p{L}0-9' -]{2,40})$/u.exec(rest) : null;
      if (place && where) { rest = place[1].trim(); input[where.key] = place[2].trim(); }
      if (rest && rest.length <= 2000 && !/^(stp|svp|merci)$/i.test(rest)) { input[target.key] = rest; captured = { key: target.key, required: Boolean(target.required), text: rest, thing }; }
    }
    // Ce que la phrase ne dit pas n'est pas « expliqué » : le doute se mesure avant de compléter d'office.
    // L'appli est « désignée » par une chose : un de ses mots qui n'est pas un verbe d'action (à la racine près), son nom, ou une chose qu'elle connaît.
    // Un mot de l'appli la désigne quand il est employé comme un NOM : ailleurs qu'en tête de phrase (« lance la sauvegarde »),
    // après un déterminant (« mes enregistrements »), ou sous une forme qui n'est pas un ordre (« sauvegardes »).
    // En tête et à l'impératif (« sauvegarde cette idée », « enregistre ce contact », « note pour plus tard »), c'est un verbe : il ne désigne rien.
    const orders = new Set([...SYN.flatMap(([, syn]) => syn), ...m.actions.filter((x) => !(x.read && !(x.params ?? []).some((p) => p.required))).flatMap((x) => x.words ?? [])].filter((w) => !w.includes(' ')).map(norm));
    const ws = words(body), first = ws[0] ?? '', determined = /^(?:le|la|les|l'|mes|mon|ma|un|une|des|du|ce|cet|cette|ces|quels?|quelles?)(?:\s|')/.test(norm(body));
    const asNoun = (w: string) => w.trim().includes(' ') || ws.slice(1).some((x) => stem(x) === stem(w)) || (stem(first) === stem(w) && (determined || !orders.has(first)));
    const byThing = m.words.some((w) => has(w) && asNoun(w)) || has(m.name) || (!forgetsId(m.id) && has(m.id)) || m.from.some(has)
      || [...names.values()].flat().some((n) => norm(n).length >= 3 && !COMMON.test(norm(n)) && Boolean(pickName(body, [n])));
    return { m, a, input, names, doubt: doubtOf({ body, m, a, input, names, captured, designated: byThing, fallback: !(c.bs >= 2 && c.best) }) };
  };
  let pick = await build(top);
  if (!pick) return { kind: 'say', text: describe(v, top.m), unsure: true };
  // L'appli la mieux notée laisse des mots de côté alors qu'une autre explique toute la phrase : c'est l'autre qu'on voulait
  // (« processus gourmands » : Hygie, pas Némésis ; « appareils vpn » : Vortex, pas Appareils ; « fiches des applis » : Thot, pas Papyrus).
  if (pick.doubt) for (const c of scored.slice(1, 4)) {
    if (!(c.ms >= 2 && c.bs >= 2) && !(c.bs >= 4 && c.best && strong.has(`${c.m.id}.${c.best.id}`))) continue;
    const alt = await build(c);
    if (alt && !alt.doubt) { pick = alt; break; }
  }
  const { m, a, input, names } = pick;
  for (const p of a.params ?? []) { const only = names.get(p.key); if (p.required && input[p.key] === undefined && only?.length === 1 && !a.grave) input[p.key] = only[0]; }
  const done = finish(v, m, a, input, session, now);
  return done.kind === 'action' && pick.doubt ? { ...done, doubt: pick.doubt.text, near: pick.doubt.near } : done;
}

function finish(v: Valhalla, m: Module, a: Action, input: Record<string, unknown>, session: string, now: Date): Understood {
  for (const p of a.params ?? []) if (input[p.key] === undefined && p.default !== undefined && !p.required) input[p.key] = p.default;
  const missing = (a.params ?? []).find((p) => p.required && (input[p.key] === undefined || input[p.key] === ''));
  if (missing) {
    pending.set(session, { module: m.id, action: a.id, input, missing: missing.key, at: now.getTime() });
    if (pending.size > 200) for (const [k, p] of pending) if (now.getTime() - p.at > 5 * 60_000) pending.delete(k);
    const known = (cache.get(m.id)?.names.get(missing.key) ?? []).slice(0, 8);
    return { kind: 'ask', module: m.id, action: a.id, input, missing: missing.key, text: `${m.name} · ${a.label} : il me manque « ${ask(missing)} »${known.length ? ` (${known.join(', ')})` : ''}. Donne-le-moi (ou dis « laisse tomber »).` };
  }
  return { kind: 'action', module: m.id, action: a.id, input, label: `${m.name} · ${a.label}`, read: Boolean(a.read) };
}
const ask = (p: Param) => p.label.replace(/\s*\(.*\)\s*$/, '') + (p.options?.length ? ` (${p.options.slice(0, 8).join(', ')})` : '');

/** L'aide du mode sans IA : une ligne par famille d'applis, avec des phrases qui marchent. */
export function helpText(v: Valhalla): string {
  const fam = [...new Set(v.modules().map((m) => m.family))];
  return fam.map((f) => `${f} : ${v.modules().filter((m) => m.family === f).map((m) => `${m.name} (« ${examples(m)[0]} »)`).join(', ')}`).join('\n');
}

// ---------------------------------------------------------------- Logos pour la voix
export { apprendreVoix, correctionDite, corrigerVoix, vocabulaire } from './huginn-voix.ts';
import { corrigerVoix as corriger, vocabulaire as vocab_voix, type Correction } from './huginn-voix.ts';
/**
 * Une phrase DITE (transcrite, donc parfois de travers) : Logos corrige d'abord les mots qui sonnent comme un mot
 * connu (« nase » → NAS), puis comprend la phrase corrigée. `doute` : la ligne à dire quand la correction est incertaine.
 */
export async function comprendreVoix(v: Valhalla, text: string, session = 'principal', o: { home?: string; prononciations?: Record<string, string>; now?: Date } = {}): Promise<{ compris: Understood | undefined; texte: string; corrections: Correction[]; doute?: string }> {
  const c = corriger(text, vocab_voix({ modules: v.modules(), home: o.home, prononciations: o.prononciations }));
  return { compris: await understand(v, c.texte, session, o.now), texte: c.texte, corrections: c.corrections, ...(c.doute ? { doute: c.doute } : {}) };
}
