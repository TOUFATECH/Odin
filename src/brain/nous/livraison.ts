// Noûs — le MODÈLE DE DÉPART livré avec Odin (« Soul » de départ). Le propriétaire (17/11) : « quand je vais déployer le
// modèle, ce sera le modèle entraîné qui doit être déployé. » Un Odin installé ne part donc jamais d'un réseau vide.
//
// Trois temps, trois règles :
//  1. FABRIQUER (chez TOUFATECH, jamais chez le propriétaire) : un corpus « livraison » fait UNIQUEMENT de ce qu'Odin est
//     (applis, actions et leurs tournures, liens, guide, compétences LIVRÉES dans le dépôt, paires « demande → appli ·
//     action ») — pas une note, pas un souvenir, pas une page lue chez qui que ce soit. Contrôle par TÉMOINS : des phrases
//     semées (un nom, un appareil, un site absorbé, une phrase de note) ; une seule qui ressort = livraison refusée.
//  2. RANGER dans le dépôt (`modeles/soul-depart/`) : les poids en demi-précision (sans les moments de l'optimiseur), le
//     découpage, un manifeste (version, gabarit, empreintes SHA-256, date, corpus, mesure sur le banc public en bits par
//     octet) et la licence d'Odin. Rien n'y est scellé par une clé de machine : c'est notre modèle, sur notre texte.
//  3. INSTALLER au premier lancement : seulement s'il n'existe AUCUN point de reprise ; empreintes vérifiées ; re-scellé
//     avec la clé de la machine comme un point de reprise ordinaire ; le pilote garde SON découpage (celui du point) et
//     l'entraînement sur place continue à partir de lui. Une mise à jour n'entre en service que si elle fait mieux sur le
//     banc LOCAL, comparée en bits par octet (deux découpages ne se comparent pas par morceau).
//
// Rien ici ne suppose une langue : les témoins sont cherchés comme des suites de caractères (repliées en minuscules,
// forme normalisée), les mesures se font en octets.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fabriquerDepart, type SourcesDepart } from './corpus-depart.ts';
import { fileBornee, type NoosDeps } from './deps.ts';
import { auBanc, preparerJeux, type ExempleTexte } from './preparation.ts';
import { lireDecoupageSerialise, decoupageAJour, SPECIAUX, type DecoupageSerialise } from './decoupage.ts';
import { ecrireReprise, lireReprise, listerReprises, prochainNumero } from './reprise.ts';
import { Reseau, perteSur, disposition } from './calcul.ts';
import { avecPoids, TAILLES, type Hyper } from './tailles.ts';
import type { OdinPourNous } from './file-odin.ts';
import { plierComparable } from './oubli.ts';

/** Un exemple du corpus de livraison (texte + sorte). */
export type ExempleTexteLivre = ExempleTexte;
export const FORMAT_LIVRAISON = 1;
export const FICHIERS = { poids: 'soul-depart.bin', decoupage: 'decoupage.json', manifeste: 'manifeste.json', licence: 'LICENCE' } as const;

// ------------------------------------------------------------------------------------------------------------------
// 1. Le corpus de livraison

/** Les compétences LIVRÉES dans le dépôt (templates/skills/<nom>/SKILL.md) : leur nom et leur description. */
export function competencesLivrees(racineDepot: string): Array<{ name: string; description: string }> {
  const dir = join(racineDepot, 'templates', 'skills');
  const out: Array<{ name: string; description: string }> = [];
  let noms: string[] = [];
  try { noms = readdirSync(dir); } catch { return out; }
  for (const n of noms.sort()) {
    let t = '';
    try { t = readFileSync(join(dir, n, 'SKILL.md'), 'utf8'); } catch { continue; }
    const tete = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t)?.[1] ?? '';
    const champ = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(tete)?.[1]?.trim().replace(/^["']|["']$/g, '');
    out.push({ name: champ('name') ?? n, description: champ('description') ?? '' });
  }
  return out;
}

/**
 * Les sources du mode « livraison » : celles du premier corpus SANS les notes ni les souvenirs (rien de privé), et des
 * compétences limitées à celles du dépôt. Toute partie absente est sautée.
 */
export function sourcesLivraison(s: Omit<SourcesDepart, 'notes' | 'souvenirs' | 'competences'>, racineDepot: string): SourcesDepart {
  return { modules: s.modules, liens: s.liens, usages: s.usages, survol: s.survol, competences: competencesLivrees(racineDepot) };
}

export interface BilanCorpusLivraison { exemples: number; textes: number; paires: number; octets: number; empreinte: string; nonResolues: string[]; sources: Record<string, number> }

/**
 * Fabrique le corpus de livraison : rien que ce qu'Odin est. Les notes et souvenirs éventuellement présents dans les
 * sources sont IGNORÉS (choix « livraison »). Rend les exemples (texte + sorte) et un bilan. Pur (aucune écriture).
 */
export function corpusLivraison(sources: SourcesDepart): { exemples: ExempleTexte[]; bilan: BilanCorpusLivraison } {
  const file = fileBornee(500_000);
  const deps: NoosDeps = { cfg: { learning: { observe: true }, nous: { actif: true } }, privateMode: () => false, essai: false, file };
  const b = fabriquerDepart('', deps, 'livraison', sources);
  const exemples: ExempleTexte[] = [];
  for (const e of file.prendre(500_000)) {
    const texte = e.texte || (e.demande && e.reponse ? `${e.demande}\n${e.reponse}` : '');
    if (texte.trim()) exemples.push({ texte, sorte: e.sorte });
  }
  const h = createHash('sha256');
  let octets = 0;
  for (const e of exemples) { const b2 = Buffer.from(`${e.sorte}\u0000${e.texte}\u0001`, 'utf8'); h.update(b2); octets += Buffer.byteLength(e.texte, 'utf8'); }
  return {
    exemples,
    bilan: {
      exemples: exemples.length, textes: b.textes, paires: b.paires, octets, empreinte: h.digest('hex'), nonResolues: b.nonResolues,
      sources: { applis: sources.modules?.length ?? 0, actions: (sources.modules ?? []).reduce((n, m) => n + (m.actions?.length ?? 0), 0), liens: (sources.liens?.length ?? 0) + (sources.usages?.length ?? 0), guide: Object.keys(sources.survol ?? {}).length, competences: sources.competences?.length ?? 0 },
    },
  };
}

/** Une forme comparable d'un texte : sans accents, sans casse, sans ponctuation ni espaces (« Élodie Mbaé » = « elodie
 *  mbae » = « ÉLODIE-MBAÉ »). Lettres et chiffres de toutes les écritures gardés : aucune hypothèse de langue. */
const plierTexte = (t: string): string => plierComparable(t);

/** Les témoins retrouvés dans des textes (chacun cherché comme une suite de caractères repliée). Pur. */
export function temoinsTrouves(textes: Iterable<string>, temoins: string[]): string[] {
  const cherches = temoins.map((t) => ({ t, p: plierTexte(t) })).filter((x) => x.p.length >= 3);
  const trouves = new Set<string>();
  for (const brut of textes) {
    const p = plierTexte(brut);
    for (const c of cherches) if (!trouves.has(c.t) && p.includes(c.p)) trouves.add(c.t);
    if (trouves.size === cherches.length) break;
  }
  return [...trouves];
}

// ------------------------------------------------------------------------------------------------------------------
// Demi-précision (float16, IEEE 754) : 2 octets par poids. Écrit à la main (aucun paquet ajouté).

const f32 = new Float32Array(1), u32v = new Uint32Array(f32.buffer);
export function versDemi(x: number): number {
  f32[0] = x; const b = u32v[0];
  const signe = (b >>> 16) & 0x8000, exp = (b >>> 23) & 0xff, mant = b & 0x7fffff;
  if (exp === 0xff) return signe | 0x7c00 | (mant ? 0x200 : 0);              // infini, NaN
  const e = exp - 127 + 15;
  if (e >= 0x1f) return signe | 0x7c00;                                       // trop grand : infini
  if (e <= 0) {                                                               // sous-normal ou zéro
    if (e < -10) return signe;
    const m = (mant | 0x800000) >>> (1 - e);
    return signe | ((m + 0x1000 + ((m >>> 13) & 1) - 1) >>> 13);              // arrondi au pair
  }
  let r = signe | (e << 10) | (mant >>> 13);
  const reste = mant & 0x1fff;
  if (reste > 0x1000 || (reste === 0x1000 && (r & 1))) r++;                  // arrondi au plus proche, au pair
  return r;
}
export function depuisDemi(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >>> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 0x1f) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}
export function poidsEnDemi(p: Float32Array): Buffer {
  const b = Buffer.alloc(p.length * 2);
  for (let i = 0; i < p.length; i++) b.writeUInt16LE(versDemi(p[i]), i * 2);
  return b;
}
export function poidsDepuisDemi(b: Buffer): Float32Array {
  const p = new Float32Array(b.length >>> 1);
  for (let i = 0; i < p.length; i++) p[i] = depuisDemi(b.readUInt16LE(i * 2));
  return p;
}

// ------------------------------------------------------------------------------------------------------------------
// Mesure en BITS PAR OCTET (comparable entre deux découpages différents).

/** Les bits par octet d'un réseau sur des textes (même règle de découpe que l'entraînement). */
export function bitsParOctet(r: Reseau, dec: DecoupageSerialise, textes: string[]): number {
  const d = lireDecoupageSerialise(dec), T = r.disp.T;
  let nats = 0, octets = 0;
  for (const t of textes) {
    const ids = d.encoder(t);
    const seq = new Int32Array(ids.length + 2); seq[0] = SPECIAUX.BOS; seq.set(ids, 1); seq[seq.length - 1] = SPECIAUX.EOS;
    for (let i = 0; i < seq.length - 1; i += T) {
      const c = seq.slice(i, Math.min(seq.length, i + T));
      if (c.length < 2) continue;
      nats += perteSur(r, [c]) * (c.length - 1);
    }
    octets += Buffer.byteLength(t, 'utf8');
  }
  return octets ? nats / (octets * Math.LN2) : NaN;
}

/** Le banc PUBLIC d'un corpus de livraison : les textes tenus à part (même règle que l'entraînement). */
export function bancPublic(exemples: ExempleTexte[], max = 64): string[] {
  return exemples.filter((e) => auBanc(e.texte)).slice(0, max).map((e) => e.texte);
}

// ------------------------------------------------------------------------------------------------------------------
// 2. Exporter un point de reprise (fabriqué en mode « livraison ») vers modeles/soul-depart/

export interface Manifeste {
  format: number;
  nom: 'soul-depart';
  version: number;
  date: string;
  gabarit: Hyper;
  poids: { nombre: number; precision: 'float16' };
  decoupage: { vocab: number; version: number; fusions: number };
  corpus: BilanCorpusLivraison;
  entrainement: { pas: number; graine: number; courbe: Array<{ pas: number; perte: number }> };
  mesures: { bancPublic: { textes: number; bitsParOctet: number } };
  temoins: { cherches: number; trouves: number };
  fichiers: Record<string, string>; // nom → sha256
}

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/**
 * Exporte le point de reprise `n` (ou le dernier) du dossier d'Odin JETABLE `home` vers `sortie`. Refuse si un témoin
 * ressort du corpus, du découpage ou du manifeste. Écrit d'un seul coup (dossier temporaire puis renommage).
 */
export async function exporterModeleDepart(o: {
  home: string; n?: number; sortie: string; corpus: { exemples: ExempleTexte[]; bilan: BilanCorpusLivraison }; temoins: string[]; version: number; licence: string; maintenant?: () => number;
  /** Où écrire l'épingle (un essai, un banc). Prime sur `epinglerProduit`. */
  epingle?: string;
  /**
   * Écrire l'épingle du PRODUIT (`fichierEpingle()`, dans le code d'Odin) : seulement sur demande explicite (l'outil :
   * `--epingler`). Sans elle, l'épingle va À CÔTÉ du modèle exporté (`<sortie>/epingle.json`) : un export d'essai vers un
   * dossier jetable ne touche jamais au produit.
   */
  epinglerProduit?: boolean;
}): Promise<{ ok: true; manifeste: Manifeste; epingle: string } | { ok: false; raison: string }> {
  // Le point de reprise doit venir de CE corpus contrôlé, dans un dossier d'Odin qui n'a rien lu d'autre (constat 7).
  const prov = lireProvenance(o.home);
  if (!prov || prov.corpus !== o.corpus.bilan.empreinte) return { ok: false, raison: 'le point de reprise ne vient pas de ce corpus de livraison (provenance absente ou différente)' };
  if (existsSync(join(o.home, 'cerveau-reseau', 'corpus')) || existsSync(join(o.home, 'memoire.db'))) return { ok: false, raison: 'ce dossier d\'Odin a un corpus ou une mémoire à lui : il n\'est pas « neuf », livraison refusée' };
  const trouvesCorpus = temoinsTrouves(o.corpus.exemples.map((e) => e.texte), o.temoins);
  if (trouvesCorpus.length) return { ok: false, raison: `livraison refusée : ${trouvesCorpus.length} témoin(s) dans le corpus` };
  const ck = await lireReprise(o.home, o.n);
  if (!ck) return { ok: false, raison: 'aucun point de reprise lisible dans ce dossier d\'Odin' };
  const dec: DecoupageSerialise = { vocab: ck.decoupage.vocab, version: ck.decoupage.version, fusions: Int32Array.from(ck.decoupage.fusions) };
  if (!decoupageAJour(dec)) return { ok: false, raison: 'le découpage du point de reprise est d\'une ancienne règle : refaire le modèle' };
  const vocabTextes = vocabulaire(dec);
  const trouvesDec = temoinsTrouves(vocabTextes, o.temoins);
  if (trouvesDec.length) return { ok: false, raison: `livraison refusée : ${trouvesDec.length} témoin(s) dans le découpage` };
  const r = new Reseau(ck.hyper, ck.poids);
  const banc = bancPublic(o.corpus.exemples);
  const bpo = banc.length ? bitsParOctet(r, dec, banc) : NaN;
  const poidsBuf = poidsEnDemi(ck.poids);
  const decBuf = Buffer.from(JSON.stringify({ vocab: dec.vocab, version: dec.version, fusions: Array.from(dec.fusions) }), 'utf8');
  const licBuf = readFileSync(o.licence);
  const manifeste: Manifeste = {
    format: FORMAT_LIVRAISON, nom: 'soul-depart', version: o.version, date: new Date((o.maintenant ?? Date.now)()).toISOString(),
    gabarit: ck.hyper, poids: { nombre: ck.poids.length, precision: 'float16' },
    decoupage: { vocab: dec.vocab, version: dec.version, fusions: dec.fusions.length },
    corpus: o.corpus.bilan, entrainement: { pas: ck.pas, graine: ck.graine, courbe: ck.courbe.slice(-200) },
    mesures: { bancPublic: { textes: banc.length, bitsParOctet: Math.round(bpo * 10_000) / 10_000 } },
    temoins: { cherches: o.temoins.length, trouves: 0 },
    fichiers: { [FICHIERS.poids]: sha(poidsBuf), [FICHIERS.decoupage]: sha(decBuf), [FICHIERS.licence]: sha(licBuf) },
  };
  const texteManifeste = JSON.stringify(manifeste, null, 1);
  if (temoinsTrouves([texteManifeste], o.temoins).length) return { ok: false, raison: 'livraison refusée : un témoin dans le manifeste' };
  const tmp = `${o.sortie}.tmp-${process.pid}`;
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, FICHIERS.poids), poidsBuf);
  writeFileSync(join(tmp, FICHIERS.decoupage), decBuf);
  writeFileSync(join(tmp, FICHIERS.licence), licBuf);
  writeFileSync(join(tmp, FICHIERS.manifeste), texteManifeste);
  if (existsSync(o.sortie)) { const vieux = `${o.sortie}.ancien-${process.pid}`; renameSync(o.sortie, vieux); renameSync(tmp, o.sortie); try { (await import('node:fs')).rmSync(vieux, { recursive: true, force: true }); } catch { /* rien */ } }
  else renameSync(tmp, o.sortie);
  // L'épingle : celle du PRODUIT (dans le code d'Odin, l'installation n'acceptera que CE manifeste) seulement sur demande ;
  // sinon à côté du modèle exporté, qui sert alors d'essai et ne peut rien changer à ce qu'Odin installe.
  const ep = o.epingle ?? (o.epinglerProduit === true ? fichierEpingle() : join(o.sortie, EPINGLE_A_COTE));
  writeFileSync(`${ep}.tmp`, `${JSON.stringify({ version: o.version, manifeste: sha(texteManifeste) } satisfies Epingle, null, 1)}\n`); renameSync(`${ep}.tmp`, ep);
  return { ok: true, manifeste, epingle: ep };
}

/** Les morceaux du découpage en texte (pour y chercher des témoins). */
export function vocabulaire(dec: DecoupageSerialise): string[] {
  const d = lireDecoupageSerialise(dec);
  const out: string[] = [];
  for (let i = 8 + 256; i < 8 + 256 + dec.fusions.length / 2 + 1 && i < dec.vocab; i++) { try { out.push(d.decoder([i])); } catch { /* id hors du découpage */ } }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------
// 3. Lire (et vérifier) le modèle livré

export interface ModeleDepart { manifeste: Manifeste; hyper: Hyper; dec: DecoupageSerialise; poids: Float32Array }

/** Lit le modèle de départ de `dossier` en vérifiant CHAQUE empreinte du manifeste. Ne lève jamais. */
/** Le gabarit est-il EXACTEMENT un gabarit connu (TAILLES), avec son vrai nombre de poids ? (rien d'autre n'est chargé) */
export function gabaritConnu(g: Hyper | undefined): boolean {
  if (!g || typeof g !== 'object') return false;
  const t = (TAILLES as Record<string, Omit<Hyper, 'poids'>>)[String(g.taille)];
  if (!t) return false;
  for (const k of Object.keys(t) as Array<keyof typeof t>) if (t[k] !== g[k]) return false;
  try { return g.poids === avecPoids(t).poids && g.poids === disposition(g).total; } catch { return false; }
}

/**
 * L'ÉPINGLE : l'empreinte du manifeste livré, gardée HORS du dossier du modèle, dans le code d'Odin (fichier
 * `src/brain/nous/modele-depart-epingle.json`, que la vérification d'intégrité d'Odin protège). Changer les poids ET
 * refaire leur empreinte dans le manifeste ne suffit donc plus : le manifeste lui-même ne correspond plus à l'épingle.
 * Écrite par l'export (chez TOUFATECH), lue par l'installation.
 */
export const fichierEpingle = (): string => fileURLToPath(new URL('./modele-depart-epingle.json', import.meta.url));
export interface Epingle { version: number; manifeste: string }
/** Le nom de l'épingle écrite À CÔTÉ d'un modèle exporté sans `epinglerProduit` (jamais lue par l'installation). */
export const EPINGLE_A_COTE = 'epingle.json';
export function lireEpingle(f = fichierEpingle()): Epingle | undefined {
  try { const j = JSON.parse(readFileSync(f, 'utf8')) as Epingle; return Number.isInteger(j.version) && /^[0-9a-f]{64}$/.test(j.manifeste) ? j : undefined; } catch { return undefined; }
}

export function lireModeleDepart(dossier: string, o: { epingle?: string } = {}): { ok: true; modele: ModeleDepart } | { ok: false; raison: string } {
  try {
    const brutManifeste = readFileSync(join(dossier, FICHIERS.manifeste));
    if (brutManifeste.length > 1024 * 1024) return { ok: false, raison: 'manifeste trop gros' };
    // 1. L'épingle (dans le code d'Odin) dit QUEL manifeste est le bon ; sans épingle, rien n'est installé.
    const ep = lireEpingle(o.epingle);
    if (!ep) return { ok: false, raison: 'aucune épingle du modèle de départ dans le code d\'Odin : rien n\'est installé' };
    if (sha(brutManifeste) !== ep.manifeste) return { ok: false, raison: 'le manifeste ne correspond pas à l\'épingle du code d\'Odin (modèle modifié ou d\'une autre version)' };
    const manifeste = JSON.parse(brutManifeste.toString('utf8')) as Manifeste;
    if (manifeste.format !== FORMAT_LIVRAISON || manifeste.nom !== 'soul-depart' || manifeste.version !== ep.version) return { ok: false, raison: 'manifeste inconnu' };
    // 2. Un gabarit EXACTEMENT connu : la taille des poids est alors bornée et vérifiée AVANT toute lecture.
    if (!gabaritConnu(manifeste.gabarit)) return { ok: false, raison: 'gabarit inconnu (seuls les gabarits d\'Odin sont acceptés)' };
    const attendus: Record<string, number> = { [FICHIERS.poids]: manifeste.gabarit.poids * 2 };
    for (const nom of [FICHIERS.poids, FICHIERS.decoupage, FICHIERS.licence]) {
      const attendu = manifeste.fichiers?.[nom];
      if (!attendu) return { ok: false, raison: `empreinte manquante : ${nom}` };
      let taille = 0; try { taille = statSync(join(dossier, nom)).size; } catch { return { ok: false, raison: `fichier manquant : ${nom}` }; }
      if (attendus[nom] !== undefined ? taille !== attendus[nom] : taille > 4 * 1024 * 1024) return { ok: false, raison: `taille inattendue : ${nom}` };
      const b = readFileSync(join(dossier, nom));
      if (sha(b) !== attendu) return { ok: false, raison: `empreinte fausse : ${nom} (fichier modifié ou abîmé)` };
    }
    const j = JSON.parse(readFileSync(join(dossier, FICHIERS.decoupage), 'utf8')) as { vocab: number; version: number; fusions: number[] };
    if (j.vocab !== manifeste.gabarit.vocab || !Array.isArray(j.fusions)) return { ok: false, raison: 'découpage différent du gabarit' };
    const dec: DecoupageSerialise = { vocab: j.vocab, version: j.version, fusions: Int32Array.from(j.fusions) };
    if (!decoupageAJour(dec)) return { ok: false, raison: 'découpage d\'une ancienne règle' };
    const poids = poidsDepuisDemi(readFileSync(join(dossier, FICHIERS.poids)));
    if (poids.length !== disposition(manifeste.gabarit).total) return { ok: false, raison: 'nombre de poids différent du gabarit' };
    for (let i = 0; i < poids.length; i++) if (!Number.isFinite(poids[i])) return { ok: false, raison: 'poids non finis' };
    return { ok: true, modele: { manifeste, hyper: manifeste.gabarit, dec, poids } };
  } catch (e) { return { ok: false, raison: `illisible : ${String((e as Error)?.message ?? e).slice(0, 120)}` }; }
}

// ------------------------------------------------------------------------------------------------------------------
// 4. L'installer au premier lancement, et 5. la mise à jour

/** Le dossier du modèle livré dans le dépôt (à côté de src/). */
export const dossierModeleLivre = (): string => fileURLToPath(new URL('../../../modeles/soul-depart/', import.meta.url));

/** La provenance d'un point de reprise fabriqué pour la livraison : l'empreinte du corpus de livraison sur lequel il a été
 *  entraîné (écrite par l'outil d'entraînement, vérifiée par l'export). */
const fichierProvenance = (home: string) => join(home, 'cerveau-reseau', 'provenance-livraison.json');
export function ecrireProvenance(home: string, corpus: string): void { mkdirSync(join(home, 'cerveau-reseau'), { recursive: true }); writeFileSync(fichierProvenance(home), JSON.stringify({ corpus }), { mode: 0o600 }); }
export function lireProvenance(home: string): { corpus: string } | undefined { try { const j = JSON.parse(readFileSync(fichierProvenance(home), 'utf8')) as { corpus?: unknown }; return typeof j.corpus === 'string' ? { corpus: j.corpus } : undefined; } catch { return undefined; } }

export interface EtatDepartInstalle { version: number; quand: string; point: number; empreinte: string; bitsParOctet?: number }
const fichierInstalle = (home: string) => join(home, 'cerveau-reseau', 'depart-installe.json');
export function departInstalle(home: string): EtatDepartInstalle | undefined { try { return JSON.parse(readFileSync(fichierInstalle(home), 'utf8')) as EtatDepartInstalle; } catch { return undefined; } }

/**
 * Au premier lancement : installe le modèle de départ s'il n'existe AUCUN point de reprise. Vérifie les empreintes,
 * puis l'écrit comme un point de reprise ordinaire, SCELLÉ avec la clé de la machine (moments de l'optimiseur à zéro :
 * l'entraînement sur place repart de ces poids). Rien si Noûs est coupé ou en mode privé. Ne lève jamais.
 */
export async function installerModeleDepart(odin: OdinPourNous, o: { dossier?: string; maintenant?: () => number; epingle?: string } = {}): Promise<{ installe: boolean; raison: string; point?: number }> {
  try {
    const c = odin.cfg;
    if (c.nous?.actif === false) return { installe: false, raison: 'Noûs est en pause' };
    if (c.voice?.privacy?.privateMode === true) return { installe: false, raison: 'mode privé' };
    const home = odin.paths.home;
    if (listerReprises(home).length) return { installe: false, raison: 'un point de reprise existe déjà : rien n\'est écrasé' };
    const dossier = o.dossier ?? dossierModeleLivre();
    if (!existsSync(join(dossier, FICHIERS.manifeste))) return { installe: false, raison: 'aucun modèle de départ livré avec cette version' };
    const lu = lireModeleDepart(dossier, { epingle: o.epingle });
    if (!lu.ok) return { installe: false, raison: `modèle de départ refusé : ${lu.raison}` };
    const m = lu.modele, n = prochainNumero(home);
    const zeros = new Float32Array(m.poids.length);
    const chemin = await ecrireReprise(home, n, { hyper: m.hyper, decoupage: m.dec, poids: m.poids, m: zeros, v: new Float32Array(m.poids.length), pas: 0, graine: m.manifeste.entrainement.graine, courbe: [], modeleVersion: n + 1 });
    // Chargé POUR ESSAI avant d'être gardé : s'il ne se charge pas (ou ne sait pas plonger un texte), le point est retiré
    // et Odin reste sans modèle de départ — jamais un Soul cassé pour toujours (constat 2).
    const essai = await chargerPourEssai(home);
    if (essai !== true) { try { rmSync(chemin, { force: true }); } catch { /* rien */ } return { installe: false, raison: `modèle de départ refusé au chargement : ${essai}` }; }
    const etat: EtatDepartInstalle = { version: m.manifeste.version, quand: new Date((o.maintenant ?? Date.now)()).toISOString(), point: n, empreinte: m.manifeste.fichiers[FICHIERS.poids], bitsParOctet: m.manifeste.mesures.bancPublic.bitsParOctet };
    writeFileSync(`${fichierInstalle(home)}.tmp`, JSON.stringify(etat), { mode: 0o600 }); renameSync(`${fichierInstalle(home)}.tmp`, fichierInstalle(home));
    return { installe: true, raison: `modèle de départ v${m.manifeste.version} installé`, point: n };
  } catch (e) { return { installe: false, raison: `panne : ${String((e as Error)?.message ?? e).slice(0, 120)}` }; }
}

/** Charge le moteur du dernier point et lui fait plonger une phrase ; rend `true` ou la raison de l'échec. */
async function chargerPourEssai(home: string): Promise<true | string> {
  let m: Awaited<ReturnType<typeof import('./moteur.ts').chargerMoteur>> | undefined;
  try {
    const { chargerMoteur } = await import('./moteur.ts');
    m = await chargerMoteur(home);
    if (!m) return 'point de reprise illisible';
    const v = await m.plonger('essai', AbortSignal.timeout(20_000));
    return v.length && Array.from(v).every(Number.isFinite) ? true : 'plongement invalide';
  } catch (e) { return String((e as Error)?.message ?? e).slice(0, 120); }
  finally { try { await m?.arreter(); } catch { /* rien */ } }
}

/** La décision de mise à jour (pure) : le nouveau modèle de départ n'entre en service que s'il fait MIEUX sur le banc
 *  local, en bits par octet (une marge évite d'échanger pour un bruit de mesure). */
export function deciderMiseAJour(bpoService: number, bpoNouveau: number, marge = 0.005): { remplacer: boolean; gain: number } {
  if (!Number.isFinite(bpoNouveau)) return { remplacer: false, gain: 0 };
  if (!Number.isFinite(bpoService)) return { remplacer: true, gain: NaN };
  const gain = bpoService - bpoNouveau;
  return { remplacer: gain > marge, gain };
}

/**
 * Une mise à jour d'Odin apporte un modèle de départ plus récent alors qu'un point de reprise (appris sur place) existe :
 * les deux sont mesurés sur le banc LOCAL en bits par octet ; le nouveau n'est écrit comme nouveau point en service que
 * s'il fait mieux (le point appris sur place reste, pour le retour arrière : deux points gardés). Jamais rien d'écrasé
 * avant que le remplaçant ait gagné. Ne lève jamais.
 */
export async function proposerMiseAJour(odin: OdinPourNous, bancLocal: string[], o: { dossier?: string; maintenant?: () => number; epingle?: string } = {}): Promise<{ remplace: boolean; raison: string; bpoService?: number; bpoNouveau?: number }> {
  try {
    const home = odin.paths.home;
    const deja = departInstalle(home);
    const dossier = o.dossier ?? dossierModeleLivre();
    const lu = lireModeleDepart(dossier, { epingle: o.epingle });
    if (!lu.ok) return { remplace: false, raison: `modèle de départ refusé : ${lu.raison}` };
    if (deja && deja.version >= lu.modele.manifeste.version) return { remplace: false, raison: 'déjà à jour' };
    const ck = await lireReprise(home);
    if (!ck) return { remplace: false, raison: 'aucun point en service : c\'est l\'installation, pas une mise à jour' };
    if (!bancLocal.length) return { remplace: false, raison: 'banc local vide : on ne remplace rien sans mesure' };
    const decService: DecoupageSerialise = { vocab: ck.decoupage.vocab, version: ck.decoupage.version, fusions: Int32Array.from(ck.decoupage.fusions) };
    const bpoService = bitsParOctet(new Reseau(ck.hyper, ck.poids), decService, bancLocal);
    const bpoNouveau = bitsParOctet(new Reseau(lu.modele.hyper, lu.modele.poids), lu.modele.dec, bancLocal);
    const d = deciderMiseAJour(bpoService, bpoNouveau);
    if (!d.remplacer) return { remplace: false, raison: 'le nouveau modèle de départ ne fait pas mieux sur le banc local : le modèle appris sur place reste en service', bpoService, bpoNouveau };
    const n = prochainNumero(home), m = lu.modele;
    await ecrireReprise(home, n, { hyper: m.hyper, decoupage: m.dec, poids: m.poids, m: new Float32Array(m.poids.length), v: new Float32Array(m.poids.length), pas: 0, graine: m.manifeste.entrainement.graine, courbe: [], modeleVersion: n + 1 });
    const etat: EtatDepartInstalle = { version: m.manifeste.version, quand: new Date((o.maintenant ?? Date.now)()).toISOString(), point: n, empreinte: m.manifeste.fichiers[FICHIERS.poids], bitsParOctet: bpoNouveau };
    writeFileSync(`${fichierInstalle(home)}.tmp`, JSON.stringify(etat), { mode: 0o600 }); renameSync(`${fichierInstalle(home)}.tmp`, fichierInstalle(home));
    return { remplace: true, raison: `modèle de départ v${m.manifeste.version} mis en service (meilleur de ${(bpoService - bpoNouveau).toFixed(3)} bit par octet)`, bpoService, bpoNouveau };
  } catch (e) { return { remplace: false, raison: `panne : ${String((e as Error)?.message ?? e).slice(0, 120)}` }; }
}

/** (outil) Copie la licence d'Odin à côté du modèle (si l'export ne l'a pas fait). */
export function copierLicence(racineDepot: string, sortie: string): void { copyFileSync(join(racineDepot, 'LICENSE'), join(sortie, FICHIERS.licence)); }

/** (outil) Les jeux d'entraînement d'un corpus de livraison (même préparation que le pilote). */
export function jeuxLivraison(exemples: ExempleTexte[], dec: DecoupageSerialise, o: { contexte?: number; graine?: number; maxSequences?: number } = {}) {
  return preparerJeux(exemples, dec, { contexte: o.contexte ?? 128, graine: o.graine ?? 0x0d1a, maxSequences: o.maxSequences ?? 4096 });
}

// ------------------------------------------------------------------------------------------------------------------
// (outil) Entraîner en PLUSIEURS passages

/** Bits par octet d'un entraîneur (par sa façade) sur des textes : même règle que `bitsParOctet`, sans charger le réseau. */
export async function bitsParOctetEntraineur(e: { perteSur(j: Int32Array[]): Promise<number>; hyper: { contexte: number } }, dec: DecoupageSerialise, textes: string[]): Promise<number> {
  const d = lireDecoupageSerialise(dec), T = e.hyper.contexte;
  let nats = 0, octets = 0;
  for (const t of textes) {
    const ids = d.encoder(t);
    const seq = new Int32Array(ids.length + 2); seq[0] = SPECIAUX.BOS; seq.set(ids, 1); seq[seq.length - 1] = SPECIAUX.EOS;
    for (let i = 0; i < seq.length - 1; i += T) {
      const c = seq.slice(i, Math.min(seq.length, i + T));
      if (c.length >= 2) nats += (await e.perteSur([c])) * (c.length - 1);
    }
    octets += Buffer.byteLength(t, 'utf8');
  }
  return octets ? nats / (octets * Math.LN2) : NaN;
}

export interface PassageEntrainement { passage: number; pas: number; perte: number; bitsParOctet: number; garde: boolean; secondes: number }
/**
 * Entraîne en PLUSIEURS passages sur les données (une séance du moteur n'en fait qu'un) : après chaque passage, la mesure
 * sur le banc public (bits par octet) ; un point de reprise n'est écrit que s'il fait MIEUX (d'au moins `marge`) — le
 * dernier point écrit est donc toujours le meilleur. Arrêt au bout de `maxPassages`, du temps donné, ou après `patience`
 * passages sans progrès. Chaque passage remélange les données (graine du passage). Rend le bilan, passage par passage.
 */
export async function entrainerPassages(o: {
  e: { seance(lots: Iterable<{ entrees: Int32Array[]; roles?: Int32Array[] }>, s: { dureeMs: number; fils: number; signal: AbortSignal; graine: number }): Promise<{ pas: number; perte: number }>; perteSur(j: Int32Array[]): Promise<number>; ecrire(n: number): Promise<string>; hyper: { contexte: number } };
  exemples: ExempleTexte[]; dec: DecoupageSerialise; banc: string[]; dureeMs: number; fils?: number;
  maxPassages?: number; patience?: number; marge?: number; graine?: number; maxSequences?: number; signal?: AbortSignal;
  /** Le numéro du premier point écrit (après ceux qui existent déjà : `prochainNumero(home)`). */
  premier?: number;
  /** Appelé après chaque passage (le journal de l'outil). */
  surPassage?: (p: PassageEntrainement) => void;
}): Promise<{ passages: PassageEntrainement[]; depart: number; meilleur: number; points: number; arret: 'passages' | 'temps' | 'sans-progres' | 'interrompu' }> {
  const graine = o.graine ?? 0x0d1a, maxPassages = Math.max(1, o.maxPassages ?? 20), patience = Math.max(1, o.patience ?? 3), marge = o.marge ?? 0.002;
  const t0 = performance.now(), fin = t0 + o.dureeMs;
  const depart = await bitsParOctetEntraineur(o.e, o.dec, o.banc);
  let meilleur = depart, sansMieux = 0, points = 0;
  const passages: PassageEntrainement[] = [];
  let arret: 'passages' | 'temps' | 'sans-progres' | 'interrompu' = 'passages';
  for (let p = 1; p <= maxPassages; p++) {
    if (o.signal?.aborted) { arret = 'interrompu'; break; }
    const reste = fin - performance.now(); if (reste < 1000) { arret = 'temps'; break; }
    const jeux = jeuxLivraison(o.exemples, o.dec, { contexte: o.e.hyper.contexte, graine: graine + p, maxSequences: o.maxSequences ?? 100_000 });
    const ac = new AbortController(); const coupe = () => ac.abort(); o.signal?.addEventListener('abort', coupe, { once: true });
    const av = await o.e.seance([{ entrees: jeux.entrainement, ...(jeux.roles ? { roles: jeux.roles as Int32Array[] } : {}) }], { dureeMs: reste, fils: o.fils ?? 1, signal: ac.signal, graine: graine + p });
    o.signal?.removeEventListener('abort', coupe);
    const b = await bitsParOctetEntraineur(o.e, o.dec, o.banc);
    const garde = b < meilleur - marge;
    if (garde) { meilleur = b; sansMieux = 0; await o.e.ecrire((o.premier ?? 0) + points++); } else sansMieux++;
    const x: PassageEntrainement = { passage: p, pas: av.pas, perte: av.perte, bitsParOctet: b, garde, secondes: Math.round((performance.now() - t0) / 1000) };
    passages.push(x); o.surPassage?.(x);
    if (sansMieux >= patience) { arret = 'sans-progres'; break; }
    if (p === maxPassages) arret = 'passages';
  }
  // Rien de mieux que le départ (cas extrême) : on écrit quand même un point, pour que l'export ait de quoi lire.
  if (points === 0) await o.e.ecrire((o.premier ?? 0) + points++);
  return { passages, depart, meilleur, points, arret };
}
