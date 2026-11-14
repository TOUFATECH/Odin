// Logos — « la pensée » : le moteur d'Odin qui comprend une demande SANS modèle d'IA.
// Il lit la phrase, choisit l'appli et l'action (mots-clés des applis, verbes, noms des choses que
// l'appli connaît : conteneurs, caméras, appareils, plans…), remplit les réglages à partir de la
// phrase (adresse IP, nom, durée, jour, heure, texte entre guillemets), et pose une question quand
// il manque quelque chose. Il ne devine pas : en dessous d'un seuil de certitude, il ne tente rien.
// Il ne lance rien lui-même : il rend une décision, exécutée ensuite sous Heimdall (mêmes règles et
// mêmes accords que si un modèle l'avait demandée).

import { isIP } from 'node:net';
import { parseWhen } from '../cron/reminders.ts';
import { LINKS, USAGES } from './links.ts';
import { forgetsId } from './names.ts';
import type { Valhalla } from './service.ts';
import type { Action, Module, Param, View } from './types.ts';

export type Understood =
  | { kind: 'action'; module: string; action: string; input: Record<string, unknown>; label: string; read: boolean; /** Une partie de la phrase n'est pas expliquée par cette appli et cette action : Odin devine. Avec une IA sous la main, c'est à elle de comprendre. */ doubt?: string; /** Le doute porte sur un détail d'une demande qui était bien pour cette appli (utile à dire) ; sinon la demande n'avait sans doute rien à voir. */ near?: boolean }
  | { kind: 'ask'; module: string; action: string; input: Record<string, unknown>; missing: string; text: string }
  | { kind: 'manip'; id: string; keep: boolean }
  | { kind: 'say'; text: string; /** Odin hésite (deux applis possibles, action floue) : avec une IA sous la main, c'est à elle de trancher. */ unsure?: boolean };

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
const STOP = new Set('le la les l un une des du de d au aux a et ou en dans sur pour par avec sans ce cet cette ces mon ma mes ton ta tes son sa ses moi me m toi te t il elle on nous vous je j tu est es suis sont que qu qui quoi stp svp merci odin peux pourrais veux voudrais faut fais faire est-ce s il plait bonjour salut donc alors bien tres tout tous toute toutes y ne pas plus maintenant vite'.split(' '));
/** Racine grossière d'un mot français (suffit pour rapprocher « redémarre », « redémarrer », « redémarrage »). */
export function stem(w: string): string {
  const x = norm(w).replace(/[^a-z0-9]/g, '');
  if (x.length <= 3) return x;
  // Noms en « -ier » : gardés entiers (« fichier » n'est pas « fiche », « dossier » n'est pas « dos »).
  if (/^(?:fichier|dossier|calendrier|courrier|clavier|papier|atelier|premier|dernier|entier|janvier|fevrier|particulier|quartier|chantier|panier|cahier|metier)s?$/.test(x)) return x.replace(/s$/, '');
  let r = x.replace(/(issements?|ements?|ations?|ages?|eurs?|euses?|erai[st]?|eront|erez|erons|aient|ait|ais|ant|ees?|ies?|ez|ons|ent|er|ir|is|it|es|e|s|x)$/, '');
  // Verbes en « -ier » : « vérifier », « vérifiez », « vérifiait » rejoignent « vérifie » (« étudier » / « étudie », « copier » / « copie »).
  if (r.length >= 4 && /[^aeiouy]i$/.test(r) && /^(?:er|ez|ons|ent|ait|ais|aient|ant|erai[st]?|eront|erez|erons)$/.test(x.slice(r.length))) r = r.slice(0, -1);
  return r.length >= 3 ? r : x;
}
const tokens = (t: string) => norm(t).split(/[^a-z0-9.:/@_-]+/).map((w) => w.replace(/^(?:[ldjmtsnc]|qu)'/, '')).filter((w) => w && !STOP.has(w));

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
  [/^(regarder)/, ['regarde', 'mets', 'lance', 'ouvre']],
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
const TYPED = /^(ip|id|vmid|pid|port|minutes|duree|jour|date|heure|contact|lien|url|adresse)$/;
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
    if (p.kind === 'select') { const o = pickName(text, p.options ?? []) ?? (p.options ?? []).find((x) => s.includes(stem(x)) && stem(x).length >= 4) ?? (p.options ?? []).find((x) => s.split(/[^a-z0-9]+/).some((w) => w.length >= 3 && !STOP.has(w) && norm(x).includes(w))); if (o) input[p.key] = o; continue; }
    // Un chemin écrit dans la phrase désigne plus sûrement qu'un nom connu.
    if (/^(chemin|fichier|dossier)$/.test(k)) { const path = /(?:^|\s)((?:~|\.{0,2})?\/[^\s"'«»]+|[A-Za-z]:\\[^\s"'«»]+)/.exec(text)?.[1]; if (path) { input[p.key] = path.replace(/[.,;:!?]+$/, ''); continue; }
      // À défaut, un nom de fichier seul (« rapport.pdf ») : l'appli le cherchera là où les fichiers arrivent.
      const bare = k === 'dossier' ? undefined : /(?:^|\s)([\w(][\w.()-]*\.[A-Za-z][A-Za-z0-9]{1,4})(?=[\s,;:!?]|$)/.exec(text)?.[1]; if (bare && !/^https?:/i.test(bare)) { input[p.key] = bare; continue; } }
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
      const n = after ? Number(after[1]) : numbers[usedNum];
      if (n !== undefined && !Number.isNaN(n)) { input[p.key] = n; if (!after) usedNum++; }
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
  while (i < words.length) { const w = key(words[i]); if (!w || STOP.has(w) || vs.has(stem(w))) i++; else break; }
  while (i < words.length && nouned < 3) { const w = key(words[i]); if (!w || STOP.has(w)) { i++; continue; } if (ns.has(stem(w))) { i++; nouned++; } else break; }
  while (i < words.length && (!key(words[i]) || STOP.has(key(words[i])))) i++;
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
  .split(/[^a-z0-9.:/@_-]+/).map((w) => w.replace(/^(?:[ldjmtsnc]|qu)'/, '').replace(/^[.:/@_-]+|[.:/@_-]+$/g, '')).filter((w) => w && (w === 'odin' || !STOP.has(w)));
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
  const known = (w: string) => { const s = stem(w); return mod.has(s) || act.has(s) || LIGHT.has(w); };
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
  if (left.length) { const u = [...new Set(left)]; return { text: `je ne suis pas sûr d'avoir tout compris (${u.slice(0, 3).map((w) => `« ${w} »`).join(', ')})`, near: e.designated && u.length === 1 }; }
  return undefined;
}

/**
 * Comprend une demande. `session` permet de finir une demande en deux messages (« il me manque… »).
 * Renvoie undefined quand rien n'est compris avec assez de certitude.
 */
export async function understand(v: Valhalla, text: string, session = 'principal', now = new Date()): Promise<Understood | undefined> {
  const s = norm(text); if (!s) return undefined;
  const mods = v.modules();

  // 1. Une question restée en attente : la réponse complète la demande.
  const wait = pending.get(session);
  if (wait && now.getTime() - wait.at < 5 * 60_000) {
    pending.delete(session);
    if (/^(non|annule|laisse|laisse tomber|rien|stop|oublie)\b/.test(s)) return { kind: 'say', text: 'D\'accord, j\'abandonne cette demande.' };
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
  const body = text.replace(/^\s*(?:dis|dites)[- ](?:moi|nous|donc|voir)\b[\s,:]*/i, '').replace(/^\s*(?:odin|s'il te pla[iî]t|stp|svp)[\s,:]+/i, '');
  const toks = tokens(body), stems = new Set(toks.map(stem)), sb = norm(body);
  const has = (w: string) => { const n = norm(w); return n.includes(' ') ? new RegExp(`(?:^|[\\s'])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|x|es)?(?=[\\s,.;:!?]|$)`).test(sb) : stems.has(stem(n)) || toks.includes(n); };
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
      let rest = strip(tail(body, verbs, thing ? [target.key, target.label.replace(/\(.*$/, '')] : [...m.words, m.name, ...m.from, 'appli', 'application']), input);
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
