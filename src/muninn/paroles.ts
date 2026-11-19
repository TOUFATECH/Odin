// Les paroles humaines : le texte EXACT reçu d'un humain (tel qu'il arrive à l'entrée unique d'Odin, avant la précision
// de langue, la relecture Plume, l'enveloppe d'un non-propriétaire ou le retrait des secrets), avec son compte, son canal,
// l'heure et des marques (voix, Kéryx, collé, transféré). Écrites tout de suite, avant tout traitement, dans un journal en
// ajout seul : <mémoire>/paroles/AAAA-MM-JJ.NNN.jsonl. Jamais un message d'Odin, d'une page, d'un courriel ou d'un outil.
//
// Ce qu'Odin ajoute lui-même au texte avant de le remettre à l'entrée unique (consigne de Kéryx, page ouverte, pièces
// jointes, texte par défaut) n'est pas une parole : il est retiré, et la parole porte la marque « ajout-odin ».
// Mode privé : rien n'est écrit (ni tour, ni parole), comme Odin le promet. Un inconnu pas encore appairé : son tour est
// écrit sans son texte, et il n'a pas de parole (comme ailleurs : un compteur, sans texte).
//
// Un secret dans le message : l'entrée unique l'a déjà retiré du texte (et rangé au coffre) avant d'arriver ici. Décision
// du propriétaire (19/11) : « Si il y a un mot de passe, le mot de passe est dans le coffre et supprimer du texte le texte
// et le texte qui est gardé sans le mot de passe ». La parole garde donc le texte SANS le secret, marquée « retiré » ;
// aucune copie du texte exact, même chiffrée. Ce qu'un masquage reconnaît encore ici (clé, mot de passe annoncé, valeur
// connue) est masqué de la même façon : un secret n'est jamais écrit.

import { join } from 'node:path';
import { extraireCles } from '../heimdall/redact.ts';
import { extractSecret } from '../machines/onboard.ts';
import { ajouterLigne, changerTour, etatDeMission, lireLignes, nouvelId, ouvrirTour, TAILLE_MAX_LIGNE, type EtatTour } from './tours.ts';

export type Marque = 'voix' | 'keryx' | 'colle' | 'transfere' | 'ajout-odin';

export interface Parole {
  id: string;
  at: number;
  /** Le compte : « propriétaire », « membre:<id> », « invite:<canal>:<pair> ». */
  qui: string;
  canal: string;
  pair: string;
  /** Le texte écrit par l'humain ; s'il portait un secret, le texte SANS le secret (`secret` vaut alors « retiré »). */
  texte?: string;
  /** Lignes d'avant le 19/11 seulement : le texte exact chiffré (« odc1:… »). Plus jamais écrit. */
  chiffre?: string;
  /** Il portait un secret, retiré du texte (« retiré »). « chiffré » : lignes d'avant le 19/11 seulement. */
  secret?: 'chiffré' | 'retiré';
  /** Lignes d'avant le 19/11 seulement : le texte masqué, à côté de `chiffre`. Plus jamais écrit. */
  masque?: string;
  marques: Marque[];
  /** Longueur du texte écrit par l'humain (en caractères). */
  longueur: number;
  /** Texte trop long : coupé à la taille d'une ligne. */
  coupe?: true;
}

/** Le dossier des paroles, dans la mémoire d'Odin. */
export const dossierParoles = (memoire: string): string => join(memoire, 'paroles');
/** Au-delà, le texte est coupé (une ligne reste de taille bornée). */
const TEXTE_MAX = Math.floor(TAILLE_MAX_LIGNE / 4);

// Un message transféré (en-tête de transfert, dans les langues courantes des messageries et des courriels).
const TRANSFERT = /-{2,}\s*(forwarded message|message transf[ée]r[ée]|weitergeleitete nachricht|mensaje reenviado|messaggio inoltrato|mensagem encaminhada|doorgestuurd bericht|пересланное сообщение|ileti iletildi)\s*-{2,}|^\s*(fwd?|tr|wg|rv|enc)\s*:\s*\S/im;
// Un bloc collé : en-tête d'un message d'origine, citation « > », « Le … a écrit : », en-têtes de courriel.
const ORIGINE = /-{2,}\s*(original message|message d'origine|ursprüngliche nachricht|mensaje original|messaggio originale|mensagem original|oorspronkelijk bericht)\s*-{2,}/i;
const A_ECRIT = /^\s*(on .{3,120} wrote:|le .{3,120} a écrit\s?:|am .{3,120} schrieb .{0,80}:|el .{3,120} escribió:|il .{3,120} ha scritto:|em .{3,120} escreveu:|op .{3,120} schreef .{0,80}:)\s*$/im;
const EN_TETE = /^\s*(from|de|von|da|van|to|à|an|para|a|cc|sent|envoyé|gesendet|enviado|inviato|verzonden|date|datum|fecha|data|subject|objet|betreff|asunto|oggetto|assunto|onderwerp)\s*:\s*\S/gim;

// Les blocs qu'Odin ajoute à la fin du texte reçu, une ligne chacun, collés après « \n\n » (ou « \n » entre deux pièces
// jointes) : la consigne de Kéryx (valhalla/keryx/actions.ts), la page ouverte et la photo de la caméra (web/server.ts),
// l'indication d'une pièce jointe (files/attach.ts), un fichier déposé par une messagerie (bifrost/channel.ts, dropFile).
const AJOUT_ODIN = /(?:^|\n\n|\n)\[(?:Consigne de Kéryx : |page : |Photo prise par la caméra : inbox\/|Fichier reçu : inbox\/|Fichier reçu mais non enregistré : |Pièce jointe bloquée par l'antivirus : |(?:Image|Vidéo|Audio|Document|Archive|Fichier) joint : inbox\/)[^\n]*\]$/;
// Le texte qu'Odin met à la place quand la personne n'a rien écrit (web/server.ts : photo, pièces jointes).
const PAR_DEFAUT = new Set(['Regarde ce que je te montre et dis-moi ce que tu vois.', 'Regarde ces fichiers et dis-moi ce qu\'ils contiennent.', 'Regarde ce fichier et dis-moi ce qu\'il contient.']);

/** Le texte écrit par l'humain : le texte reçu sans les blocs ajoutés par Odin à la fin (ni son texte par défaut). Pur. */
export function partHumaine(texte: string): { texte: string; ajout: boolean } {
  let t = texte, ajout = false;
  for (let m = AJOUT_ODIN.exec(t); m; m = AJOUT_ODIN.exec(t)) { t = t.slice(0, m.index); ajout = true; }
  if (ajout && PAR_DEFAUT.has(t.trim())) t = '';
  return { texte: t, ajout };
}

// La relance d'une mission par Odin (gateway.ts, resume() : nom « propriétaire » et l'un de ces textes).
const RELANCE = /^(?:Continue la mission là où tu t'étais arrêté\.|Odin a redémarré pendant ta mission : reprends-la là où tu t'étais arrêté \(vérifie d'abord ce qui est déjà fait\)\.|Reprends la mission « [\s\S]{0,120} » \(essai \d+\) : vérifie ce qui est déjà fait, puis termine-la\.)$/;

/** Les marques d'un texte reçu : collé, transféré. Pur. */
export function marquesTexte(texte: string): Marque[] {
  const out: Marque[] = [];
  if (TRANSFERT.test(texte)) out.push('transfere');
  const enTetes = new Set((texte.match(EN_TETE) ?? []).map((l) => l.trim().split(/\s*:/)[0].toLowerCase()));
  const cites = texte.split('\n').filter((l) => /^\s*>/.test(l)).length;
  if (ORIGINE.test(texte) || A_ECRIT.test(texte) || enTetes.size >= 2 || cites >= 2) out.push('colle');
  return out;
}

/**
 * D'où vient un message arrivé à l'entrée unique : d'un humain (et on garde sa parole), ou pas. Pur.
 * Le choix prudent : quand on ne sait pas qui a écrit, pas de parole (le tour est écrit quand même).
 */
export function origineMessage(m: { channel: string; peer: string; name: string; voice?: boolean }, texte = ''): { humain: boolean; parole: boolean; raison?: string; marques: Marque[] } {
  const marques: Marque[] = [];
  if (m.voice) marques.push('voix');
  // La relance d'une mission par Odin lui-même : le nom « propriétaire » ET l'un de ses textes. Le nom seul vient de
  // l'expéditeur (une messagerie le laisse choisir) : alors c'est un humain, sans parole (on ne sait pas qui a écrit).
  if (m.name === 'propriétaire') return RELANCE.test(texte) ? { humain: false, parole: false, raison: 'relance d\'Odin', marques } : { humain: true, parole: false, raison: 'nom « propriétaire » donné par l\'expéditeur', marques };
  // Un courriel reçu : jamais une parole (l'expéditeur d'un courriel s'imite facilement).
  if (m.channel === 'mail') return { humain: true, parole: false, raison: 'courriel', marques };
  if (m.channel === 'web') {
    // La Discussion, la caméra de l'interface (name « navigateur ») et le raccourci du téléphone (jeton du propriétaire).
    if (m.name === 'navigateur' || m.name === 'raccourci') return { humain: true, parole: true, marques: [...marques, ...marquesTexte(texte)] };
    // Orphée : ce que la personne a dit, transcrit.
    if (m.peer === 'voix') return { humain: true, parole: true, marques: [...new Set<Marque>([...marques, 'voix']), ...marquesTexte(texte)] };
    // Vénus fabrique ses propres demandes (sous-titres d'une vidéo…) : pas un humain.
    if (m.peer === 'venus') return { humain: false, parole: false, raison: 'page d\'Odin', marques };
    // L'écran de la maison, Pégase, ou une autre page : on ne sait pas ici qui a écrit.
    return { humain: true, parole: false, raison: 'auteur inconnu (page d\'Odin)', marques };
  }
  if (m.channel === 'keryx') marques.push('keryx');
  return { humain: true, parole: true, marques: [...marques, ...marquesTexte(texte)] };
}

/**
 * Le texte masqué d'un message (clés, mot de passe, valeurs connues du coffre) et s'il portait un secret. Pur, sauf
 * `masquer` (le masqueur d'Odin, qui connaît les valeurs du coffre).
 */
export function sansSecret(texte: string, masquer: (s: string) => string = (s) => s): { texte: string; secret: boolean } {
  let t = extraireCles(texte).text;
  t = extractSecret(t).text;
  t = masquer(t);
  return { texte: t, secret: t !== texte };
}

// Les marques posées par le tri de l'entrée unique (« [rangé au coffre : Box — mot de passe] », « [secret reçu — …] »).
const MARQUES_TRI = /\[(?:rangé au coffre : [^[\]\n]{1,300}|secret reçu — [^[\]\n]{1,80}|secret dit à voix haute — non gardé|code à usage unique reçu — non gardé|IBAN retiré — non gardé)\]/gu;
/**
 * `sansSecret` autour des marques du tri, jamais sur elles : « mot de passe du NAS est [rangé au coffre : …] » ne doit pas
 * faire prendre « [rangé » pour un mot de passe. Seulement quand l'entrée a retiré des secrets. Pur, sauf `masquer`.
 */
export function sansSecretApresTri(texte: string, masquer: (s: string) => string = (s) => s): { texte: string; secret: boolean } {
  let out = '', k = 0, secret = false;
  for (const m of texte.matchAll(MARQUES_TRI)) {
    const s = sansSecret(texte.slice(k, m.index), masquer);
    out += s.texte + m[0]; secret ||= s.secret; k = m.index + m[0].length;
  }
  const s = sansSecret(texte.slice(k), masquer);
  return { texte: out + s.texte, secret: secret || s.secret };
}

/**
 * Écrit la parole d'un humain, tout de suite. `secretRetire` : l'entrée unique a déjà retiré un secret de ce texte.
 * Aucune copie du texte exact quand il portait un secret (décision du propriétaire, 19/11) : le texte gardé est celui sans.
 */
export function noterParole(memoire: string, _home: string, p: { qui: string; canal: string; pair: string; texte: string; marques: Marque[]; masquer?: (s: string) => string; secretRetire?: boolean }, now = Date.now()): Parole {
  const base: Parole = { id: nouvelId('p', now), at: now, qui: p.qui, canal: p.canal, pair: p.pair, marques: [...new Set(p.marques)], longueur: p.texte.length };
  // Masqué sur le texte ENTIER, puis coupé : un secret à cheval sur la coupe ne serait plus reconnu.
  const s = p.secretRetire ? sansSecretApresTri(p.texte, p.masquer) : sansSecret(p.texte, p.masquer);
  const garde = s.texte.slice(0, TEXTE_MAX);
  const coupe = garde.length < s.texte.length ? { coupe: true as const } : {};
  const l: Parole = s.secret || p.secretRetire ? { ...base, texte: garde, secret: 'retiré', ...coupe } : { ...base, texte: garde, ...coupe };
  ajouterLigne(dossierParoles(memoire), l, { now });
  return l;
}

/** Les paroles relues du disque, dans l'ordre d'arrivée (une ligne abîmée par une panne est ignorée). */
export function lireParoles(memoire: string): Parole[] {
  return lireLignes<Parole>(dossierParoles(memoire)).filter((p) => typeof p.id === 'string' && typeof p.at === 'number');
}

/** Le suivi d'un tour ouvert à l'arrivée d'un message. N'échoue jamais : une écriture impossible est dite, sans bloquer le message. */
export interface SuiviTour { readonly id: string; enCours(): void; finir(etat: EtatTour): void }

/** Ce que l'entrée unique fournit (la mémoire d'Odin). Qui parle n'est PAS décidé ici : l'entrée (code sensible) le dit. */
export interface SourcesArrivee {
  dir: string | null;
  privateMode: boolean;
  missionsDeSession(sessionId: string): Array<{ id: string; status: string; started_at: number }>;
}

const rien: SuiviTour = { id: '', enCours() {}, finir() {} };
const dire = (e: unknown) => console.error('[tours]', (e as Error).message);

/**
 * À l'arrivée d'un message, AVANT tout traitement : écrit la parole (si c'est un humain) puis le tour « en file ».
 * Rend de quoi le passer « en cours » puis à son état final (pris de sa mission quand elle existe).
 */
export function noterArrivee(mem: SourcesArrivee, home: string, masquer: (s: string) => string, m: { channel: string; peer: string; name: string; text: string; voice?: boolean }, auteur: { proprietaire: boolean; compte?: { id: string; role: string }; appaire: boolean; /** L'entrée a déjà retiré un secret de `m.text`. */ secretRetire?: boolean }, now = Date.now()): SuiviTour {
  // Mode privé : rien n'est écrit (« rien n'est retenu ni écrit »), ni le tour ni la parole.
  if (!mem.dir || mem.privateMode) return rien;
  const memoire = mem.dir, fil = `${m.channel}:${m.peer}`;
  try {
    const h = partHumaine(m.text);
    const o = origineMessage(m, h.texte);
    const proprietaire = auteur.proprietaire, u = proprietaire ? undefined : auteur.compte;
    const qui = !o.humain ? 'odin' : proprietaire || u?.role === 'owner' ? 'propriétaire' : u?.role === 'member' ? `membre:${u.id}` : `invite:${m.channel}:${m.peer}`;
    // Un inconnu pas encore appairé (la passerelle lui envoie un code) : ni son texte ni sa parole ne sont écrits.
    const inconnu = o.humain && !proprietaire && !u && !auteur.appaire;
    const raison = inconnu ? 'inconnu pas encore appairé' : !o.parole ? o.raison : !h.texte ? 'rien d\'écrit par l\'humain' : undefined;
    const marques: Marque[] = h.ajout ? [...o.marques, 'ajout-odin'] : o.marques;
    const parole = raison === undefined ? noterParole(memoire, home, { qui, canal: m.channel, pair: m.peer, texte: h.texte, marques, masquer, secretRetire: auteur.secretRetire }, now) : undefined;
    const sans = auteur.secretRetire ? sansSecretApresTri : sansSecret;
    const tour = ouvrirTour(memoire, {
      qui, role: o.humain ? 'humain' : 'agent', canal: m.channel, fil, // le but : masqué sur le texte entier (un secret coupé en deux ne serait plus reconnu), puis coupé à 300
      but: inconnu ? '' : sans(m.text, masquer).texte.replace(/\s+/g, ' ').trim(),
      ...(parole ? { message: parole.id } : { sansParole: raison ?? 'aucune' }),
    }, now);
    let depuis = 0, fini = false;
    return {
      id: tour.id,
      enCours() { if (fini || depuis) return; depuis = Date.now(); try { changerTour(memoire, tour.id, 'en cours', {}, depuis); } catch (e) { dire(e); } },
      finir(etat) {
        if (fini) return; fini = true;
        try {
          if (!depuis) return changerTour(memoire, tour.id, etat, { immediat: true });
          const mi = mem.missionsDeSession(fil).filter((x) => x.started_at >= depuis).at(-1);
          changerTour(memoire, tour.id, etatDeMission(mi?.status) ?? etat, mi ? { mission: mi.id } : {});
        } catch (e) { dire(e); }
      },
    };
  } catch (e) { dire(e); return rien; }
}
