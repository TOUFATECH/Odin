// Noûs — L'AIGUILLEUR PRÊT EN MÉMOIRE VIVE.
//
// L'aiguilleur (aiguilleur.ts) refait à chaque démarrage l'index de ses quelque 23 000 paires : environ une seconde de
// processeur et quelques centaines de mégaoctets pris puis rendus. Ce module garde ce travail PRÊT :
//   1. en mémoire vive, pour toute la vie du processus : un aiguilleur refait (matière changée, essais, banc) reprend le
//      même cœur d'index sans rien recalculer ; la place est demandée au comptable de la mémoire (budget-memoire.ts) et
//      rendue dès que la machine en manque ;
//   2. sur le disque, dans le dossier d'Odin (cerveau-reseau/aiguilleur-preparation.bin), d'un démarrage à l'autre.
// Une préparation relue est VÉRIFIÉE avant de servir : son empreinte (les paires, les réglages, le texte du code qui
// fait l'index, la version de Node et de ses tables Unicode, l'ordre des octets de la machine) doit être celle de la
// matière d'aujourd'hui (sinon : périmée), le contenu doit avoir la somme de contrôle écrite dans son en-tête (sinon :
// abîmée), et ses tableaux doivent tenir debout (bornes, ordre, nombres finis). Refusée, elle est effacée, refaite et
// réécrite ; elle ne sert jamais telle quelle. La somme de contrôle protège d'un fichier abîmé, pas d'un fichier
// fabriqué exprès : qui peut écrire dans cerveau-reseau peut aussi écrire le fichier des corrections (même confiance).
// Le résultat est le MÊME index, nombre pour nombre : les réponses ne changent pas (essai test/aiguilleur-pret.test.ts,
// banc test/rapidite/aiguilleur-pret.ts).
//
// Ce qui change sur le disque pendant qu'Odin tourne :
//   - le fichier des corrections est regardé à CHAQUE demande (une seule lecture de ses dates et taille) et, sans
//     demande, au moins une fois par seconde : une correction retirée à la main n'est plus jamais servie, et la
//     préparation qui la contenait est effacée, en mémoire comme sur le disque ;
//   - une correction que le propriétaire fait oublier passe par oublierCorrection : retirée du fichier, de tout ce qui
//     est gardé en mémoire et du disque, sur-le-champ, et chaque aiguilleur vivant de ce dossier est refait ;
//   - un dossier de matière donné à part (essais, outils) est regardé au plus une fois par seconde ; la matière du
//     dépôt fait partie du code et ne change pas pendant qu'Odin tourne : elle n'est pas regardée ;
//   - une correction apprise rend la préparation du disque périmée : elle est effacée aussitôt.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { endianness } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { rendre, reserver, surPression } from '../budget-memoire.ts';
import {
  codeDuCoeur, creerAiguilleurSync, fichierCorrections, IndexNgrammes, retirerCorrection,
  type Aiguilleur, type CoeurIndex, type ContexteAiguilleur, type Correction, type OptionsAiguilleur, type Paire, type Reglages, type ReponseAiguilleur,
} from './aiguilleur.ts';

/** Version du format du fichier (changer la disposition des octets la change). */
export const FORMAT_PREPARATION = 1;
const MAGIE = 'ODINAIG1';
/** Taille maximale d'une préparation relue (au-delà, elle n'est pas lue : refaite). */
export const PREPARATION_OCTETS_MAX = 256 * 1024 * 1024;
const ENTETE_OCTETS_MAX = 64 * 1024;
/** Nom de la réservation auprès du comptable de la mémoire. */
export const NOM_RESERVATION = 'aiguilleur-pret';
/** Place estimée d'une entrée du vocabulaire (chaîne courte + table d'association), en octets. */
const OCTETS_PAR_GRAMME = 72;
/** Sans demande, le fichier des corrections est regardé à cet intervalle (ms) ; un dossier de matière donné à part, au plus à cet intervalle. */
export const VERIFICATION_MS = 1000;
/** Nombre de cœurs gardés en mémoire au plus (un par matière ; deux couvrent un changement de matière en marche). */
export const GARDES_MAX = 2;

export const fichierPreparation = (home: string): string => join(home, 'cerveau-reseau', 'aiguilleur-preparation.bin');

// ------------------------------------------------------------------------------------------------ empreinte
/** Réglages lus seulement au moment du vote (jamais par le cœur de l'index : n-grammes, IDF, poids des paires). */
const REGLAGES_DU_VOTE = new Set(['k', 'puissance', 'poidsMots', 'rangR', 'bonusContexte', 'poidsPrecedent', 'contexte', 'viseSeul', 'viseTrois', 'prior', 'vote', 'parAppli', 'couvertureMin', 'couvertureNMin', 'couvertureDecider', 'margePreference', 'rapportHorsChamp', 'perteHorsChamp', 'poidsCentre', 'plisGroupes', 'casMax']);
/** Empreinte de tout ce dont dépend le cœur d'un index : une préparation d'empreinte différente est périmée. */
export function empreinteCoeur(paires: Paire[], R: Reglages): string {
  const h = createHash('sha256');
  h.update(`format ${FORMAT_PREPARATION}\n`);
  // Les réglages qui ne servent qu'au vote sont laissés de côté (la même préparation sert aux deux variantes du banc) ;
  // tout autre réglage, y compris un réglage ajouté plus tard, compte : dans le doute, la préparation est refaite.
  const reglagesDuCoeur = Object.fromEntries(Object.entries(R).filter(([k]) => !REGLAGES_DU_VOTE.has(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  h.update(JSON.stringify({ R: reglagesDuCoeur, node: process.versions.node, v8: process.versions.v8, icu: process.versions.icu ?? null, unicode: process.versions.unicode ?? null, octets: endianness() }));
  h.update(codeDuCoeur());
  h.update(`\n${paires.length}\n`);
  for (const p of paires) h.update(`${JSON.stringify([p.texte, p.appli, p.poids ?? 1, Boolean(p.demande)])}\n`);
  return h.digest('hex');
}

/** Place prise en mémoire par un cœur (Mo, arrondie au-dessus). */
export function moDe(c: CoeurIndex): number {
  const octets = c.idf.byteLength + c.debut.byteLength + c.postDoc.byteLength + c.postPoids.byteLength + c.vocab.size * OCTETS_PAR_GRAMME;
  return Math.ceil(octets / 1_048_576);
}

// ------------------------------------------------------------------------------------------------ en mémoire vive
interface Garde { coeur: CoeurIndex; mo: number }
/** Les cœurs gardés, du plus ancien au plus récent (une nouvelle préparation pousse les anciennes si la place manque). */
const GARDES = new Map<string, Garde>();
let averti = false;
const totalGarde = () => { let t = 0; for (const g of GARDES.values()) t += g.mo; return t; };

/** Oublie tout ce qui est gardé en mémoire et rend la place au comptable. */
export function oublierPreparations(): void { GARDES.clear(); rendre(NOM_RESERVATION); }
/** Ce qui est gardé en mémoire (essais, journal). */
export function preparationsGardees(): { nombre: number; mo: number } { return { nombre: GARDES.size, mo: totalGarde() }; }

/** Garde un cœur si le comptable le permet (quitte à oublier les plus anciens) ; sinon ne garde rien. */
function garder(emp: string, coeur: CoeurIndex): boolean {
  if (!averti) { averti = true; surPression(oublierPreparations); }
  const mo = moDe(coeur);
  GARDES.delete(emp);
  // Pas plus de GARDES_MAX cœurs, quel que soit le budget : les plus anciens partent d'abord.
  while (GARDES.size >= GARDES_MAX) GARDES.delete(GARDES.keys().next().value!);
  for (;;) {
    if (reserver(NOM_RESERVATION, totalGarde() + mo)) { GARDES.set(emp, { coeur, mo }); return true; }
    const plusAncien = GARDES.keys().next();
    if (plusAncien.done) break;
    GARDES.delete(plusAncien.value);
  }
  // Rien ne tient : la réservation suit ce qui reste gardé (rien).
  if (GARDES.size === 0) rendre(NOM_RESERVATION); else reserver(NOM_RESERVATION, totalGarde());
  return false;
}
function oublier(emp: string): void {
  if (!GARDES.delete(emp)) return;
  if (GARDES.size === 0) rendre(NOM_RESERVATION); else reserver(NOM_RESERVATION, totalGarde());
}

// ------------------------------------------------------------------------------------------------ sur le disque
const aligner = (n: number) => (n + 7) & ~7;

/** Les octets d'une préparation : en-tête (avec empreinte et somme de contrôle), puis les tableaux et le vocabulaire. */
export function encoderPreparation(emp: string, n: number, c: CoeurIndex): Buffer | undefined {
  const grammes = [...c.vocab.keys()];
  // L'ordre des identifiants doit être celui de la table (0, 1, 2…) ; un n-gramme ne contient jamais U+0000 (nettoyé).
  let i = 0; for (const [g, id] of c.vocab) { if (id !== i++ || g.includes('\u0000')) return undefined; }
  const vocab = Buffer.from(grammes.join('\u0000'), 'utf16le');
  const doc = c.postDoc instanceof Uint16Array ? 'u16' : 'i32';
  const morceaux = [c.idf, c.debut, c.postDoc, c.postPoids].map((t) => Buffer.from(t.buffer, t.byteOffset, t.byteLength));
  morceaux.push(vocab);
  const tailles = morceaux.map((m) => m.length);
  let total = 0; for (const t of tailles) total += aligner(t);
  const charge = Buffer.alloc(total);
  let pos = 0; for (const m of morceaux) { m.copy(charge, pos); pos += aligner(m.length); }
  const entete = Buffer.from(JSON.stringify({
    format: FORMAT_PREPARATION, empreinte: emp, n, grammes: grammes.length, postings: c.postPoids.length, doc, facteurInconnu: c.facteurInconnu, tailles,
    somme: createHash('sha256').update(charge).digest('hex'),
  }), 'utf8');
  const tete = Buffer.alloc(aligner(MAGIE.length + 4 + entete.length));
  tete.write(MAGIE, 0, 'latin1'); tete.writeUInt32LE(entete.length, MAGIE.length); entete.copy(tete, MAGIE.length + 4);
  return Buffer.concat([tete, charge]);
}

/**
 * Relit une préparation et la vérifie entièrement. Rend le cœur, ou la raison du refus (« périmée » : faite pour une
 * autre matière ; « abîmée » : tout le reste). Ne lève jamais d'exception.
 */
export function decoderPreparation(buf: Buffer, emp: string, n: number): { coeur: CoeurIndex } | { refus: string } {
  try {
    if (buf.length < MAGIE.length + 4 || buf.toString('latin1', 0, MAGIE.length) !== MAGIE) return { refus: 'abîmée : ce n\'est pas une préparation de l\'aiguilleur' };
    const lg = buf.readUInt32LE(MAGIE.length);
    if (lg > ENTETE_OCTETS_MAX || MAGIE.length + 4 + lg > buf.length) return { refus: 'abîmée : en-tête hors bornes' };
    const e = JSON.parse(buf.toString('utf8', MAGIE.length + 4, MAGIE.length + 4 + lg)) as Record<string, unknown>;
    if (e.format !== FORMAT_PREPARATION) return { refus: 'périmée : autre format' };
    if (e.empreinte !== emp) return { refus: 'périmée : faite pour une autre matière, d\'autres réglages ou un autre code' };
    const G = e.grammes, P = e.postings, tailles = e.tailles, f = e.facteurInconnu;
    const entier = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
    if (e.n !== n || !entier(G) || !entier(P) || (e.doc !== 'u16' && e.doc !== 'i32') || typeof f !== 'number' || !Number.isFinite(f) || f <= 0) return { refus: 'abîmée : en-tête incohérent' };
    if (e.doc === 'u16' && n > 0xffff) return { refus: 'abîmée : indices trop courts pour le nombre de paires' };
    const largeur = e.doc === 'u16' ? 2 : 4;
    const attendu = [8 * G, 4 * (G + 1), largeur * P, 4 * P];
    if (!Array.isArray(tailles) || tailles.length !== 5 || !tailles.every(entier) || attendu.some((t, i) => tailles[i] !== t)) return { refus: 'abîmée : tailles incohérentes' };
    const debutCharge = aligner(MAGIE.length + 4 + lg);
    let total = 0; for (const t of tailles as number[]) total += aligner(t);
    if (debutCharge + total !== buf.length) return { refus: 'abîmée : longueur inattendue' };
    const charge = buf.subarray(debutCharge);
    if (createHash('sha256').update(charge).digest('hex') !== e.somme) return { refus: 'abîmée : somme de contrôle fausse' };
    // Des tableaux neufs (copiés) : alignés, et indépendants du tampon lu.
    const parts: ArrayBuffer[] = []; let pos = 0;
    for (const t of tailles as number[]) { parts.push(charge.buffer.slice(charge.byteOffset + pos, charge.byteOffset + pos + t) as ArrayBuffer); pos += aligner(t); }
    const idf = new Float64Array(parts[0]), debut = new Int32Array(parts[1]);
    const postDoc = e.doc === 'u16' ? new Uint16Array(parts[2]) : new Int32Array(parts[2]), postPoids = new Float32Array(parts[3]);
    // Les tableaux tiennent debout : listes dans l'ordre et dans les bornes, paires connues, nombres finis.
    if (debut[0] !== 0 || debut[G] !== P) return { refus: 'abîmée : listes inversées hors bornes' };
    for (let g = 0; g < G; g++) if (debut[g + 1] < debut[g] || !Number.isFinite(idf[g])) return { refus: 'abîmée : listes inversées ou IDF incohérents' };
    for (let p = 0; p < P; p++) if (postDoc[p] >= n || postDoc[p] < 0 || !Number.isFinite(postPoids[p])) return { refus: 'abîmée : liste inversée hors bornes' };
    const grammes = G ? Buffer.from(parts[4]).toString('utf16le').split('\u0000') : [];
    if (grammes.length !== G) return { refus: 'abîmée : vocabulaire incohérent' };
    const vocab = new Map<string, number>();
    for (let i = 0; i < G; i++) vocab.set(grammes[i], i);
    if (vocab.size !== G) return { refus: 'abîmée : vocabulaire en double' };
    return { coeur: { vocab, idf, debut, postDoc, postPoids, facteurInconnu: f } };
  } catch (x) {
    return { refus: `abîmée : ${String((x as Error)?.message ?? x).slice(0, 120)}` };
  }
}

function lirePreparation(home: string, emp: string, n: number): { coeur?: CoeurIndex; refus?: string } {
  const f = fichierPreparation(home);
  let taille: number;
  try { taille = statSync(f).size; } catch { return {}; }
  if (taille > PREPARATION_OCTETS_MAX) return { refus: `abîmée : trop grosse (${taille} octets)` };
  let buf: Buffer;
  try { buf = readFileSync(f); } catch (x) { return { refus: `illisible : ${String((x as Error)?.message ?? x).slice(0, 120)}` }; }
  const r = decoderPreparation(buf, emp, n);
  return 'coeur' in r ? { coeur: r.coeur } : { refus: r.refus };
}

function ecrirePreparation(home: string, emp: string, n: number, c: CoeurIndex): void {
  const octets = encoderPreparation(emp, n, c);
  if (!octets || octets.length > PREPARATION_OCTETS_MAX) return;
  const f = fichierPreparation(home), tmp = `${f}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    mkdirSync(join(home, 'cerveau-reseau'), { recursive: true });
    writeFileSync(tmp, octets, { mode: 0o600 });
    renameSync(tmp, f);
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* rien à retirer */ }
    // Réécriture impossible (lecture seule, disque plein, fichier verrouillé) : l'ancienne ne doit pas rester.
    effacerPreparation(home);
  }
}
/** Efface la préparation du disque (périmée), même en lecture seule. */
export function effacerPreparation(home: string): void {
  const f = fichierPreparation(home);
  try { rmSync(f, { force: true }); return; } catch { /* lecture seule ? */ }
  try { chmodSync(f, 0o600); rmSync(f, { force: true }); } catch { /* verrouillée : rien de plus à faire ici */ }
}

// ------------------------------------------------------------------------------------------------ fabrique de l'index
export interface OptionsPret {
  /** Garder le cœur en mémoire vive (défaut : oui, dans la place que donne le comptable). */
  memoire?: boolean;
  /** Garder la préparation sur le disque, dans le dossier d'Odin (défaut : oui, si `home` est donné). */
  disque?: boolean;
  /** Vérifier à la demande (au plus une fois par seconde) si la matière ou les corrections ont changé sur le disque (défaut : oui). */
  surveiller?: boolean;
}
interface Origine { de: 'calcul' | 'memoire' | 'fichier'; raison?: string; empreinte: string }

/** La fabrique d'index qui cherche un cœur prêt (mémoire, puis disque), sinon le calcule et le garde. */
function fabrique(home: string | undefined, op: OptionsPret, origine: { v?: Origine }): (paires: Paire[], R: Reglages) => IndexNgrammes {
  return (paires, R) => {
    const emp = empreinteCoeur(paires, R);
    const enMemoire = op.memoire === false ? undefined : GARDES.get(emp);
    if (enMemoire) {
      // Rafraîchit l'ordre (le plus récent en dernier).
      GARDES.delete(emp); GARDES.set(emp, enMemoire);
      origine.v = { de: 'memoire', empreinte: emp };
      return new IndexNgrammes(paires, R, enMemoire.coeur);
    }
    let raison: string | undefined;
    if (home && op.disque !== false) {
      const lu = lirePreparation(home, emp, paires.length);
      if (lu.coeur) {
        if (op.memoire !== false) garder(emp, lu.coeur);
        origine.v = { de: 'fichier', empreinte: emp };
        return new IndexNgrammes(paires, R, lu.coeur);
      }
      raison = lu.refus;
      // Refusée (périmée, abîmée) : effacée tout de suite, avant même de recalculer (elle peut contenir une
      // correction retirée depuis, et la réécriture peut échouer).
      if (raison) effacerPreparation(home);
    }
    const ix = new IndexNgrammes(paires, R);
    if (op.memoire !== false) garder(emp, ix.coeur);
    if (home && op.disque !== false) ecrirePreparation(home, emp, paires.length, ix.coeur);
    origine.v = { de: 'calcul', empreinte: emp, ...(raison ? { raison } : {}) };
    return ix;
  };
}

/** Signature d'un fichier (taille, dates, identifiant) : une seule lecture des métadonnées, pas du contenu. */
function signatureFichier(f: string): string {
  try { const s = statSync(f); return `${s.size}|${s.mtimeMs}|${s.ctimeMs}|${s.ino}`; } catch { return 'absent'; }
}
/** Signature d'un dossier de matière : noms, tailles et dates de ses fichiers .json. */
function signatureDossier(dossier: string): string {
  try { return readdirSync(dossier).filter((x) => x.toLowerCase().endsWith('.json')).sort().map((n) => `${n}|${signatureFichier(join(dossier, n))}`).join('\n'); } catch { return 'absent'; }
}

// ------------------------------------------------------------------------------------------------ aiguilleurs vivants
/** Ce que l'oubli et la ronde du disque savent d'un aiguilleur vivant (tenu faiblement : un aiguilleur jeté s'en va). */
interface Vivant { home: string; regarderCorrections(): void; toutOublier(): void }
const VIVANTS = new Set<WeakRef<Vivant>>();
let ronde: ReturnType<typeof setInterval> | undefined;
function inscrire(v: Vivant): void {
  VIVANTS.add(new WeakRef(v));
  if (!ronde) { ronde = setInterval(faireLaRonde, VERIFICATION_MS); ronde.unref?.(); }
}
/** Sans demande, le fichier des corrections de chaque aiguilleur vivant est regardé (il ne retient pas le processus). */
function faireLaRonde(): void {
  for (const r of VIVANTS) {
    const v = r.deref();
    if (!v) { VIVANTS.delete(r); continue; }
    try { v.regarderCorrections(); } catch { /* la demande suivante regardera aussi */ }
  }
  if (!VIVANTS.size && ronde) { clearInterval(ronde); ronde = undefined; }
}

/**
 * Le propriétaire fait oublier une correction : elle est retirée du fichier des corrections, de tout ce qui est gardé
 * en mémoire vive (cœurs gardés, aiguilleurs vivants de ce dossier : refaits à la demande suivante) et de la
 * préparation du disque, sur-le-champ. Même si elle n'était plus dans le fichier, rien de gardé ne la contient après.
 */
export function oublierCorrection(home: string, demande: string): { ok: true; retiree: boolean } | { ok: false; raison: string } {
  const r = retirerCorrection(home, demande);
  oublierPreparations();
  effacerPreparation(home);
  for (const ref of VIVANTS) { const v = ref.deref(); if (v && v.home === home) v.toutOublier(); }
  return r;
}

/**
 * L'aiguilleur, prêt : mêmes options et mêmes réponses que creerAiguilleurSync, avec le cœur de l'index gardé en
 * mémoire vive et sur le disque (vérifié avant usage), et les corrections surveillées.
 */
export function creerAiguilleurPret(o: OptionsAiguilleur & OptionsPret): Aiguilleur {
  const op: OptionsPret = { memoire: o.memoire, disque: o.disque, surveiller: o.surveiller };
  const surveiller = op.surveiller !== false;
  const origine: { v?: Origine } = {};
  const construire = (): { a: Aiguilleur; emp?: string } => {
    origine.v = undefined;
    const a = creerAiguilleurSync({ ...o, index: fabrique(o.home, op, origine) });
    // (lu par une variable : le compilateur croit encore à la remise à zéro ci-dessus)
    const v = origine.v as Origine | undefined;
    if (v) { a.bilan.preparationDe = v.de; if (v.raison) a.bilan.preparationRaison = v.raison; }
    return { a, emp: v?.empreinte };
  };
  // Signatures prises AVANT de lire : un changement pendant la construction sera vu à la demande suivante.
  const sigCorrections = () => (o.home ? signatureFichier(fichierCorrections(o.home)) : '');
  const sigMatiere = () => (typeof o.matiere === 'string' ? signatureDossier(o.matiere) : '');
  let sc = surveiller ? sigCorrections() : '';
  let sm = surveiller ? sigMatiere() : '';
  /** L'aiguilleur en service ; absent après un oubli : refait à la demande suivante (rien de l'ancien n'est gardé). */
  let courant: { a: Aiguilleur; emp?: string } | undefined = construire();
  let vu = performance.now();
  /** Les corrections ont changé : tout ce qui peut contenir l'ancienne liste est oublié, en mémoire et sur le disque. */
  const toutOublier = () => {
    courant = undefined;
    oublierPreparations();
    if (o.home) effacerPreparation(o.home);
    if (surveiller) sc = sigCorrections();
  };
  const regarderCorrections = () => { if (surveiller && courant && sigCorrections() !== sc) toutOublier(); };
  const actuel = () => {
    if (surveiller) {
      if (sigCorrections() !== sc) toutOublier();
      if (typeof o.matiere === 'string') {
        const t = performance.now();
        if (t - vu >= VERIFICATION_MS) {
          vu = t;
          const m = sigMatiere();
          // La matière a changé : la préparation de l'ancienne matière est oubliée, l'aiguilleur refait.
          if (m !== sm) { sm = m; if (courant?.emp) oublier(courant.emp); courant = undefined; }
        }
      }
    }
    return (courant ??= construire());
  };
  const vivant: Vivant | undefined = o.home ? { home: o.home, regarderCorrections, toutOublier } : undefined;
  if (vivant) inscrire(vivant);
  const enveloppe: Aiguilleur & { readonly vivant?: Vivant } = {
    // (tenu par l'enveloppe : la liste des vivants ne le tient que faiblement)
    vivant,
    get bilan() { return actuel().a.bilan; },
    aiguiller(phrase: string, ctx?: ContexteAiguilleur): ReponseAiguilleur { return actuel().a.aiguiller(phrase, ctx); },
    apprendre(c: Correction) {
      const ce = actuel();
      const r = ce.a.apprendre(c);
      if (r.ok) {
        // Les corrections font partie de la matière de l'index : ce qui est gardé pour l'ancienne liste est périmé.
        if (ce.emp) oublier(ce.emp);
        if (o.home) effacerPreparation(o.home);
        if (surveiller) sc = sigCorrections();
      }
      return r;
    },
  };
  return enveloppe;
}
