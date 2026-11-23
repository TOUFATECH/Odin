// Banc d'actions « BA-1 » : le BANC FIGÉ. Deux jeux d'épisodes qui ne changent plus :
//   - le banc de PORTE (480 épisodes, 80 par compétence) : la porte « Essai puis mesure » le consulte pendant
//     l'entraînement et ne rend à la boucle que « gardé » ou « refusé » ;
//   - le banc CACHÉ (600 épisodes, 100 par compétence) : mesuré à part, ouvert seulement à la fin de tous les essais.
//
// Ce fichier ne rend que des COMPTES (mesurer) : jamais le détail d'un épisode. Ce que l'apprenant reçoit d'un épisode
// (vueApprenant) ne contient jamais la réponse. Ce fichier n'écrit rien sur le disque.
//
// Le MANIFESTE (test/soul-banc/jeux/actions-manifeste.json) donne l'empreinte SHA-256 de chaque fichier du banc : les
// deux jeux, le monde W, le monde et le vérificateur en code, et ce fichier. Il fixe aussi l'ordre des épisodes (un
// vecteur réussi / raté se lit dans cet ordre, sans aucune phrase en clair) et leurs comptes. Tout est relu avant
// chaque chargement : un seul écart, un fichier manquant, un ordre ou un compte qui ne correspond plus aux jeux, et
// tout s'arrête (BancAltere). Les fins de ligne ne comptent pas (comme pour le noyau d'Odin).
//
// Un manifeste peut être refait par quiconque écrit dans le dépôt. Ce qui le protège, c'est SA PROPRE EMPREINTE,
// retenue AILLEURS : celui qui lance les essais la note avant de lancer (dans sa commande, puis dans l'en-tête du
// journal et du fichier scellé) et la donne à chaque chargement. Elle ne doit jamais être calculée par le processus
// qui charge le banc : ce serait se croire soi-même. Ce fichier ne sait pas écrire un manifeste ; l'outil qui fige le
// banc vit hors du dépôt.
//
// Le CONTRÔLE DE FUITE (controleFuites) compare les phrases d'un lot d'entraînement à celles du banc : la même phrase,
// la même après normalisation, une phrase très proche (Jaccard des trigrammes ≥ 0,8), ou le même SQUELETTE (la même
// tournure, où seules les valeurs changent). Ce qui ressemble est à retirer de l'ENTRAÎNEMENT, jamais du banc. Il se
// lance avant le départ, dans un processus à part de la boucle.
//
//   node --disable-warning=ExperimentalWarning test/soul-banc/actions/banc.ts verifier [empreinte attendue du manifeste]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Index, type Degre } from '../fuites.ts';
import { chargerMonde, plat, type Monde } from './monde.ts';
import { COMPETENCES, verifier, type Competence, type Episode, type Proposition } from './verificateur.ts';

export const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
export const FICHIERS = {
  porte: 'test/soul-banc/jeux/actions-porte.json',
  cache: 'test/soul-banc/jeux/actions-cache.json',
  monde: 'test/soul-banc/jeux/actions-monde.json',
  manifeste: 'test/soul-banc/jeux/actions-manifeste.json',
  code: ['test/soul-banc/actions/monde.ts', 'test/soul-banc/actions/verificateur.ts', 'test/soul-banc/actions/banc.ts'],
} as const;
export type Partie = 'porte' | 'cache';
export interface Jeu { version: number; banc: string; partie: Partie; fige: boolean; origine: string; episodes: Episode[] }
export interface Manifeste {
  version: number; banc: string; algorithme: 'sha256';
  /** chemin (depuis la racine du dépôt) → « sha256:… » */
  fichiers: Record<string, string>;
  /** l'ordre fixe des épisodes, par leur empreinte courte */
  ordre: Record<Partie, string[]>;
  comptes: Record<Partie, Record<string, number>>;
}

/** Le banc a changé depuis qu'il a été figé : on ne mesure plus rien. */
export class BancAltere extends Error {
  ecarts: string[];
  constructor(ecarts: string[]) { super(`Le banc d'actions a changé depuis qu'il a été figé (${ecarts.join(', ')}) : tout s'arrête.`); this.name = 'BancAltere'; this.ecarts = ecarts; }
}

/** L'empreinte d'un fichier texte (fins de ligne ramenées à « \n »). */
export function empreinteFichier(chemin: string): string { return `sha256:${createHash('sha256').update(readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')).digest('hex')}`; }
/** L'empreinte courte d'un épisode : elle le désigne dans les journaux, sans sa phrase. */
export function empreinteCourte(ep: Pick<Episode, 'id' | 'langue' | 'phrase'>): string { return createHash('sha256').update(`${ep.id}\0${ep.langue}\0${ep.phrase}`).digest('hex').slice(0, 10); }
/**
 * L'empreinte du manifeste lui-même. À noter par celui qui lance, AVANT de lancer, puis à donner à chaque chargement.
 * Ne jamais s'en servir pour fabriquer, dans le même processus, la valeur qu'on donne à chargerBanc.
 */
export function empreinteManifeste(racine: string = RACINE): string { return empreinteFichier(join(racine, FICHIERS.manifeste)); }

const lireJeu = (racine: string, partie: Partie): Jeu => JSON.parse(readFileSync(join(racine, FICHIERS[partie]), 'utf8').replace(/^﻿/, '')) as Jeu;
const comptesDe = (j: Jeu): Record<string, number> => { const c: Record<string, number> = { total: j.episodes.length }; for (const k of COMPETENCES) c[k] = j.episodes.filter((e) => e.competence === k).length; return c; };
const pareil = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const trie = (o: Record<string, unknown> | undefined): Array<[string, unknown]> => Object.entries(o ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
/**
 * Relit tout : l'empreinte du manifeste (contre celle retenue ailleurs), l'empreinte de chaque fichier, l'ordre et les
 * comptes des épisodes. Rend le manifeste si tout est intact ; sinon lève BancAltere avec la liste des écarts.
 * `empreinteAttendue` : l'empreinte du manifeste notée avant de lancer (« sha256:… »). Sans elle, rien ne se charge.
 */
export function verifierManifeste(empreinteAttendue: string, racine: string = RACINE): Manifeste {
  if (typeof empreinteAttendue !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(empreinteAttendue)) throw new BancAltere(['empreinte attendue du manifeste absente ou mal écrite']);
  let man: Manifeste, vue = '';
  try { vue = empreinteManifeste(racine); man = JSON.parse(readFileSync(join(racine, FICHIERS.manifeste), 'utf8').replace(/^﻿/, '')) as Manifeste; } catch { throw new BancAltere([FICHIERS.manifeste]); }
  const ecarts: string[] = [];
  if (vue !== empreinteAttendue) ecarts.push(`${FICHIERS.manifeste} (son empreinte n'est pas celle qui a été notée)`);
  if (!man || typeof man !== 'object' || man.version !== 1 || man.banc !== 'BA-1' || man.algorithme !== 'sha256' || !pareil(Object.keys(man).sort(), ['algorithme', 'banc', 'comptes', 'fichiers', 'ordre', 'version'])) ecarts.push(`${FICHIERS.manifeste} (forme)`);
  const attendus = [...FICHIERS.code, FICHIERS.cache, FICHIERS.monde, FICHIERS.porte];
  for (const f of attendus) {
    let e = '';
    try { e = empreinteFichier(join(racine, f)); } catch { /* fichier manquant : un écart */ }
    if (!e || man?.fichiers?.[f] !== e) ecarts.push(f);
  }
  for (const f of Object.keys(man?.fichiers ?? {})) if (!(attendus as string[]).includes(f)) ecarts.push(f);
  // L'ordre et les comptes écrits dans le manifeste doivent être ceux des jeux.
  for (const partie of ['porte', 'cache'] as const) {
    try {
      const j = lireJeu(racine, partie);
      if (j.fige !== true || j.partie !== partie || j.banc !== 'BA-1') ecarts.push(`${FICHIERS[partie]} (pas un jeu figé « ${partie} »)`);
      if (!pareil(man?.ordre?.[partie], j.episodes.map(empreinteCourte))) ecarts.push(`${FICHIERS.manifeste} (ordre ${partie})`);
      if (!pareil(trie(man?.comptes?.[partie]), trie(comptesDe(j)))) ecarts.push(`${FICHIERS.manifeste} (comptes ${partie})`);
    } catch { if (!ecarts.includes(FICHIERS[partie])) ecarts.push(FICHIERS[partie]); }
  }
  if (!pareil(Object.keys(man?.ordre ?? {}).sort(), ['cache', 'porte']) || !pareil(Object.keys(man?.comptes ?? {}).sort(), ['cache', 'porte'])) ecarts.push(`${FICHIERS.manifeste} (parties)`);
  if (ecarts.length) throw new BancAltere([...new Set(ecarts)].sort());
  return man;
}

export interface Banc { partie: Partie; monde: Monde; episodes: Episode[]; manifeste: Manifeste; /** l'empreinte du manifeste, telle qu'elle a été donnée et vérifiée : à écrire dans l'en-tête du journal */ empreinteManifeste: string }
/**
 * Charge une partie du banc, après avoir tout relu (un écart : BancAltere, rien n'est chargé).
 * `empreinteAttendue` : l'empreinte du manifeste notée avant de lancer. Elle vient de celui qui lance, jamais d'un calcul fait ici.
 */
export function chargerBanc(partie: Partie, empreinteAttendue: string, racine: string = RACINE): Banc {
  const manifeste = verifierManifeste(empreinteAttendue, racine);
  const jeu = lireJeu(racine, partie);
  return { partie, monde: chargerMonde(join(racine, FICHIERS.monde)), episodes: jeu.episodes, manifeste, empreinteManifeste: empreinteAttendue };
}

// ------------------------------------------------------------------------------------------------ mesurer
/** Ce que l'apprenant voit d'un épisode : la demande et son petit contexte. Rien de ce qu'on attend. */
export interface Vue { phrase: string; langue: string; ecriture: string; contexte?: Episode['contexte'] }
export const vueApprenant = (ep: Episode): Vue => ({ phrase: ep.phrase, langue: ep.langue, ecriture: ep.ecriture, ...(ep.contexte ? { contexte: { ...ep.contexte } } : {}) });
export type Apprenant = (vue: Vue) => Proposition | Promise<Proposition>;
export interface Mesure {
  n: number; k: number;
  parCompetence: Record<Competence, { k: number; n: number }>;
  /** les fautes de sûreté : ce compteur doit rester à zéro, aucune réussite ne le compense */
  fautesSurete: number;
  /** réussi (1) ou raté (0) par épisode, dans l'ordre fixe du manifeste — pour les comparaisons par paires */
  vecteur: number[];
}
/**
 * Fait passer le banc à un apprenant. Chaque épisode repart de l'état de départ du monde. Ne rend que des comptes.
 * Une réponse qui n'a pas la forme attendue compte pour un échec, sans arrêter la mesure — et la sûreté est quand même
 * regardée sur tout ce qu'elle propose. Un apprenant qui plante sur un épisode : échec de cet épisode (rien n'a été
 * proposé). Si le jugement lui-même ne peut pas se faire, on ne sait pas ce qui serait parti : échec, et compté comme
 * une faute de sûreté, par prudence.
 */
export async function mesurer(banc: Pick<Banc, 'monde' | 'episodes'>, apprenant: Apprenant): Promise<Mesure> {
  const parCompetence = Object.fromEntries(COMPETENCES.map((c) => [c, { k: 0, n: 0 }])) as Mesure['parCompetence'];
  const vecteur: number[] = [];
  let k = 0, fautesSurete = 0;
  for (const ep of banc.episodes) {
    let reussi = false, repondu = false, p: unknown;
    try { p = await apprenant(vueApprenant(ep)); repondu = true; } catch { /* échec de cet épisode */ }
    if (repondu) {
      try { const v = verifier(banc.monde, ep, p as Proposition); reussi = v.reussi; if (v.fauteSurete) fautesSurete++; } catch { fautesSurete++; }
    }
    parCompetence[ep.competence].n++; if (reussi) { parCompetence[ep.competence].k++; k++; }
    vecteur.push(reussi ? 1 : 0);
  }
  return { n: banc.episodes.length, k, parCompetence, fautesSurete, vecteur };
}

// ------------------------------------------------------------------------------------------------ contrôle de fuite
/** Une phrase, et les valeurs propres à son épisode (ses réglages attendus) : elles sont masquées dans le squelette. */
export interface PhraseNommee { id: string; phrase: string; valeurs?: string[] }
/** Les phrases d'une liste d'épisodes, avec leurs valeurs. */
export const phrasesDe = (episodes: Episode[]): PhraseNommee[] => episodes.map((e) => ({ id: e.id, phrase: e.phrase, valeurs: (e.attendu.etapes ?? []).flatMap((x) => [...Object.values(x.reglages ?? {}), ...Object.values(x.contient ?? {})]).map(String) }));
/** Toutes les phrases du banc (porte et caché), après avoir tout relu. À n'appeler que du côté du banc. */
export function phrasesDuBanc(empreinteAttendue: string, racine: string = RACINE): PhraseNommee[] {
  verifierManifeste(empreinteAttendue, racine);
  return (['porte', 'cache'] as const).flatMap((p) => phrasesDe(lireJeu(racine, p).episodes));
}
/** Les noms des objets du monde (appareils et caméras dans chaque langue, scènes, personnes, conteneurs, machines, rendez-vous), du plus long au plus court. */
export function nomsDuMonde(monde: Monde): string[] {
  const noms = new Set<string>();
  for (const a of [...monde.foyer.appareils, ...monde.foyer.cameras]) { noms.add(plat(a.nom)); for (const v of Object.values(a.mentions)) noms.add(plat(v)); }
  for (const x of [...monde.foyer.scenes, ...monde.foyer.personnes]) noms.add(plat(x.nom));
  for (const [k, o] of Object.entries(monde.etat)) {
    const sorte = k.slice(0, k.indexOf(':')), id = k.slice(k.indexOf(':') + 1);
    if (sorte === 'conteneur' || sorte === 'machine') noms.add(plat(id));
    if (sorte === 'conteneur') noms.add(plat(o.image));
    if (sorte === 'profil') noms.add(plat(o.nom));
    if (sorte === 'rdv') noms.add(plat(o.titre));
  }
  return [...noms].filter((x) => x.length >= 2).sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
}
/**
 * Le squelette d'une phrase : ses valeurs (réglages de l'épisode, objets du monde, adresses, sites, nombres) sont
 * remplacées par un jeton. Deux phrases de même squelette sont la même tournure avec d'autres valeurs.
 */
export function squelette(noms: string[], p: PhraseNommee): string {
  let t = ` ${plat(p.phrase)} `;
  for (const v of [...(p.valeurs ?? [])].map(plat).filter((v) => v.length >= 3).sort((a, b) => b.length - a.length)) t = t.split(v).join(' § ');
  for (const n of noms) if (n.length >= 3) t = t.split(n).join(' § ');
  return t.replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, ' § ').replace(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\b/g, ' § ').replace(/\d+/g, ' § ').replace(/(\s*§\s*)+/g, ' § ').replace(/\s+/g, ' ').trim();
}
/** Un squelette trop court (une valeur seule, deux mots) ne dit rien : il n'entre pas dans la comparaison. */
export const squeletteUtile = (s: string): boolean => { const n = s.replace(/[§\s]/g, '').length; return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s) ? n >= 4 : n >= 8; };
export interface ControleFuites { /** les épisodes d'entraînement à retirer */ aRetirer: string[]; comptes: Record<Degre, number> & { total: number; squelette: number } }
/**
 * Les phrases d'entraînement qui ressemblent à une phrase du banc. On les retire de l'entraînement ; le banc ne change
 * jamais. Avec `monde`, le contrôle regarde aussi les squelettes : la même tournure avec d'autres valeurs est une fuite.
 */
export function controleFuites(entrainement: PhraseNommee[], banc: PhraseNommee[], o: { seuil?: number; monde?: Monde } = {}): ControleFuites {
  const seuil = o.seuil ?? 0.8, noms = o.monde ? nomsDuMonde(o.monde) : undefined;
  const index = new Index(banc.map((b) => ({ texte: b.phrase, source: b.id })));
  const squelettes = noms ? new Index(banc.map((b) => ({ texte: squelette(noms, b), source: b.id })).filter((x) => squeletteUtile(x.texte))) : undefined;
  const comptes = { total: 0, exacte: 0, normalisee: 0, quasi: 0, squelette: 0 }, aRetirer: string[] = [];
  for (const e of entrainement) {
    const r = index.chercher(e.phrase, seuil);
    if (r) { aRetirer.push(e.id); comptes.total++; comptes[r.degre]++; continue; }
    const s = noms ? squelette(noms, e) : '';
    if (squelettes && squeletteUtile(s) && squelettes.chercher(s, seuil)) { aRetirer.push(e.id); comptes.total++; comptes.squelette++; }
  }
  return { aRetirer, comptes };
}

// ------------------------------------------------------------------------------------------------ commande
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const vue = empreinteManifeste(), attendue = process.argv[3] ?? '';
    console.log(`Empreinte du manifeste : ${vue}`);
    if (!attendue) { console.log('Aucune empreinte attendue donnée : seule la cohérence interne est relue (fichiers, ordre, comptes). Cela ne prouve pas que le banc est celui qui a été figé.'); }
    const m = verifierManifeste(attendue || vue);
    console.log(`Banc ${m.banc} ${attendue ? 'intact' : 'cohérent'} : ${Object.keys(m.fichiers).length} fichiers, ${m.ordre.porte.length} épisodes de porte, ${m.ordre.cache.length} cachés.`);
    for (const [f, e] of Object.entries(m.fichiers)) console.log(`  ${e}  ${f}`);
  } catch (e) { console.error(String((e as Error).message ?? e)); process.exitCode = 1; }
}
