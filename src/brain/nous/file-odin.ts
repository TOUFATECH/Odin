// Noûs dans un Odin lancé — étape 1 : UNE file d'apprentissage et son lecteur.
//
// La file est créée UNE fois ici et donnée à tous ceux qui nourrissent Noûs (Mathésis, Prónoia, Archytas, le premier
// corpus). La passerelle la vide périodiquement vers le CORPUS sur disque (src/brain/nous/corpus.ts) : tranches par jour
// et par source, chiffrées avec la clé de la machine (coffre, AES-256-GCM), doublons retirés, part plafonnée par source,
// et la place totale bornée par `nous.disqueMaxMo`. Aucun calcul de réseau ici : on range seulement.
//
// Garde : rien si Noûs est coupé (`nous.actif`), en mode privé, en démonstration ; rien sans la clé de la machine
// (jamais un corpus en clair). Jamais sur le chemin de réponse : appelé par la tâche périodique de la passerelle.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ensureVault, exportMachineKey, open as ouvrirCoffre, seal } from '../../vault.ts';
import { Corpus, type ExempleCorpus, type MagasinTranches, type Scellage } from './corpus.ts';
import { lireDecoupageSerialise } from './decoupage.ts';
import { fileBornee, type FileApprentissage, type NoosDeps } from './deps.ts';
import { surOubliSouvenir } from '../../muninn/store.ts';
import { ecrireOublis, filtreOublis, lireOublis, noterOubli, sansOublis, type FiltreOublis } from './oubli.ts';

/** LA file d'apprentissage d'Odin (une seule, en mémoire, bornée à 10 000 exemples). */
export const fileNousOdin: FileApprentissage = fileBornee(10_000);

/** Ce dont Noûs a besoin d'Odin (sa configuration, le mode privé, la démonstration). */
export interface OdinPourNous {
  cfg: { learning?: { observe?: boolean }; nous?: { actif?: boolean; disqueMaxMo?: number; corpusDepart?: string }; voice?: { privacy?: { privateMode?: boolean } } };
  demo?: boolean;
  paths: { home: string };
  /** La mémoire d'Odin (facultative) : on y lit la pause de l'initiative posée par « stop » (clé `initiative-pause`). */
  muninn?: { getKv(k: string): string | undefined };
}

/** Les dépendances de `nourrir()` pour un Odin lancé : la file unique, la garde (coupé, privé, démo). */
export function depsNousOdin(odin: OdinPourNous): NoosDeps {
  brancherOubli(odin.paths?.home);
  const prive = (): boolean => { try { return odin.cfg.voice?.privacy?.privateMode === true; } catch { return true; } };
  return {
    cfg: { learning: { observe: odin.cfg.learning?.observe !== false }, nous: { actif: odin.cfg.nous?.actif !== false } },
    privateMode: prive, demo: odin.demo === true, file: fileNousOdin,
  };
}

/**
 * L'oubli d'un souvenir (muninn.forget) prévient Noûs : le registre des oublis de ce dossier d'Odin le note, la file
 * d'attente est purgée tout de suite, le corpus au prochain vidage. Branché une fois par dossier d'Odin.
 */
const oublisBranches = new Set<string>();
export function brancherOubli(home: string | undefined): void {
  if (!home || oublisBranches.has(home)) return;
  oublisBranches.add(home);
  surOubliSouvenir.add((m) => noterOubli(home, { id: m.id, texte: m.content }, fileNousOdin));
}

/** Le dossier du corpus. */
export const dossierCorpus = (home: string): string => join(home, 'cerveau-reseau', 'corpus');

/** Les tranches sur le disque : écriture atomique (fichier temporaire puis renommage), noms sûrs seulement. */
export function magasinDisque(dir: string): MagasinTranches {
  const sur = (nom: string) => /^tranche-[0-9]{0,8}-[a-z0-9_-]{1,40}\.bin$/.test(nom);
  return {
    lire: (nom) => { if (!sur(nom)) return undefined; try { return readFileSync(join(dir, nom)); } catch { return undefined; } },
    ecrire: (nom, buf) => {
      if (!sur(nom)) throw new Error(`nom de tranche refusé : ${nom}`);
      mkdirSync(dir, { recursive: true });
      const tmp = join(dir, `.${nom}.tmp`);
      writeFileSync(tmp, buf, { mode: 0o600 }); renameSync(tmp, join(dir, nom));
    },
    lister: () => { try { return readdirSync(dir).filter(sur).sort(); } catch { return []; } },
    effacer: (nom) => { if (sur(nom)) rmSync(join(dir, nom), { force: true }); },
    // Ajout à la fin : seuls les nouveaux exemples sont écrits (un arrêt au milieu laisse une fin tronquée, sautée à la lecture).
    ajouterFin: (nom, buf) => { if (!sur(nom)) throw new Error(`nom de tranche refusé : ${nom}`); mkdirSync(dir, { recursive: true }); appendFileSync(join(dir, nom), buf, { mode: 0o600 }); },
  };
}

/** Le scellage par la clé de la machine (aucune clé : aucune écriture — jamais un corpus en clair). */
export function scellageMachine(home: string): Scellage | undefined {
  try { ensureVault(home); } catch { return undefined; }
  const cle = exportMachineKey(home);
  if (!cle) return undefined;
  return { sceller: (b) => seal(cle, b, 'corpus-nous'), ouvrir: (b) => ouvrirCoffre(cle, b, 'corpus-nous') };
}

/** La place prise par le corpus (octets). */
export function tailleCorpus(dir: string): number {
  let n = 0;
  try { for (const f of readdirSync(dir)) { try { n += statSync(join(dir, f)).size; } catch { /* disparu */ } } } catch { /* pas encore de dossier */ }
  return n;
}

/**
 * Le découpage d'ATTENTE : les octets seuls (aucune fusion apprise). Il est sans perte (on retrouve le texte exact) ;
 * la première séance de nuit apprendra le vrai découpage sur ce corpus et le réencodera.
 */
const decoupageOctets = lireDecoupageSerialise({ vocab: 4096, version: 0, fusions: new Int32Array(0) });

/** La famille d'une source (« mathesis:page… » → « mathesis ») : une tranche par jour et par famille. */
const famille = (source: string) => (String(source || 'inconnue').split(':')[0] || 'inconnue').toLowerCase();

export interface BilanVidage { pris: number; ecrits: number; ignores: number; octets: number; ms: number; raison?: string }

/** Les plafonds par famille de source (contre l'empoisonnement : une seule source ne peut pas tout remplir). */
export const PLAFOND_PAR_SOURCE = 200_000;

/**
 * Vide (au plus `max` exemples de) la file vers le corpus. Rend ce qui a été fait et ce que ça a coûté. Ne lève jamais.
 * Quand le corpus atteint `disqueMaxMo`, plus rien n'est écrit (les exemples pris sont laissés, et c'est dit).
 */
export function viderVersCorpus(odin: OdinPourNous, o: { max?: number; file?: FileApprentissage; dir?: string; maintenant?: () => number } = {}): BilanVidage {
  const t0 = performance.now();
  const bilan: BilanVidage = { pris: 0, ecrits: 0, ignores: 0, octets: 0, ms: 0 };
  const fin = (raison?: string) => { bilan.ms = Math.round((performance.now() - t0) * 10) / 10; if (raison) bilan.raison = raison; return bilan; };
  try {
    const file = o.file ?? fileNousOdin;
    brancherOubli(odin.paths.home);
    // L'oubli passe AVANT tout (même Noûs coupé) : le corpus est purgé des souvenirs effacés depuis le dernier passage.
    const oublis = lireOublis(odin.paths.home);
    if (oublis.aPurger) { const p = purgerOublis(odin.paths.home, o.dir ?? dossierCorpus(odin.paths.home), oublis); if (p.raison) bilan.raison = p.raison; }
    const filtre = filtreOublis(oublis);
    if (odin.cfg.nous?.actif === false) { file.vider(); return fin('Noûs est coupé : rien n\'est rangé (la file est vidée)'); }
    if (odin.demo) { file.vider(); return fin('démonstration : rien n\'est rangé'); }
    if (odin.cfg.voice?.privacy?.privateMode === true) { file.vider(); return fin('mode privé : rien n\'est rangé'); }
    if (!file.taille()) return fin();
    const dir = o.dir ?? dossierCorpus(odin.paths.home);
    const plafond = Math.max(1, Number(odin.cfg.nous?.disqueMaxMo ?? 2000)) * 1024 * 1024;
    if (tailleCorpus(dir) >= plafond) return fin(`corpus plein (${Math.round(plafond / 1048576)} Mo, réglage « disque ») : rien n'est ajouté`);
    const scel = scellageMachine(odin.paths.home);
    if (!scel) return fin('clé de la machine indisponible : rien n\'est écrit (jamais en clair)');
    const pris = file.prendre(Math.max(1, Math.min(2000, o.max ?? 500)));
    bilan.pris = pris.length;
    const corpus = corpusDe(dir, scel);
    const groupes = new Map<string, { jour: string; source: string; ex: ExempleCorpus[] }>();
    // La place qui reste : chaque morceau prend 4 octets dans une tranche (plus l'en-tête de l'exemple). On s'arrête
    // AVANT de dépasser, pas après : un seul passage ne peut pas faire déborder le plafond.
    let reste = plafond - tailleCorpus(dir);
    for (const e of pris) {
      const brut = [e.texte, e.demande && e.reponse ? `${e.demande}\n${e.reponse}` : ''].filter(Boolean)[0] ?? '';
      // Un souvenir oublié (ou une de ses lignes) n'entre plus jamais dans le corpus.
      const texte = sansOublis(brut, e.idSouvenir, filtre) ?? '';
      if (!texte.trim()) { bilan.ignores++; continue; }
      const morceaux = decoupageOctets.encoder(texte.slice(0, 20_000));
      reste -= morceaux.length * 4 + 64;
      if (reste < 0) { bilan.ignores++; bilan.raison = `corpus plein (${Math.round(plafond / 1048576)} Mo, réglage « disque ») : le reste n'est pas ajouté`; continue; }
      bilan.octets += morceaux.length;
      const jour = new Date(e.at || (o.maintenant ?? Date.now)()).toISOString().slice(0, 10).replace(/-/g, '');
      const source = famille(e.source), k = `${jour}|${source}`;
      const g = groupes.get(k) ?? { jour, source, ex: [] };
      g.ex.push({ morceaux, sorte: e.sorte, fiable: e.fiable, ...(e.idSouvenir !== undefined ? { idSouvenir: e.idSouvenir } : {}) });
      groupes.set(k, g);
    }
    for (const g of groupes.values()) {
      const n = corpus.ajouter(g.jour, g.source, g.ex, PLAFOND_PAR_SOURCE);
      bilan.ecrits += n; bilan.ignores += g.ex.length - n;
    }
    return fin();
  } catch (e) { return fin(`panne : ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
}

/**
 * Purge le corpus des souvenirs oubliés : chaque tranche relue une fois, réécrite sans eux (une ligne oubliée retirée
 * d'un texte qui en avait d'autres). Sans clé de la machine, rien ne peut être relu : la purge attend (et c'est dit).
 */
export function purgerOublis(home: string, dir: string, r = lireOublis(home)): { touches: number; raison?: string } {
  try {
    const scel = scellageMachine(home);
    if (!scel) return { touches: 0, raison: 'clé de la machine indisponible : l\'oubli dans le corpus attend' };
    const f: FiltreOublis = filtreOublis(r);
    const corpus = corpusDe(dir, scel);
    const touches = corpus.oublierSi((e) => {
      const avant = decoupageOctets.decoder(e.morceaux);
      const apres = sansOublis(avant, e.idSouvenir, f);
      if (apres === undefined) return undefined;
      return apres === avant ? e : { ...e, morceaux: decoupageOctets.encoder(apres) };
    });
    ecrireOublis(home, { ...r, aPurger: false });
    return { touches };
  } catch (e) { return { touches: 0, raison: `oubli dans le corpus : panne (${String((e as Error)?.message ?? e).slice(0, 80)})` }; }
}

// Un Corpus par dossier, gardé : il retient les empreintes et les comptes (aucune relecture du disque à chaque ajout).
const corpusOuverts = new Map<string, Corpus>();
function corpusDe(dir: string, scel: Scellage): Corpus {
  let c = corpusOuverts.get(dir);
  if (!c) { c = new Corpus(magasinDisque(dir), scel); corpusOuverts.set(dir, c); if (corpusOuverts.size > 8) corpusOuverts.delete(corpusOuverts.keys().next().value!); }
  return c;
}
/** (essais, oubli) ferme les corpus gardés : la prochaine écriture relit le disque. */
export function fermerCorpus(): void { corpusOuverts.clear(); }

/** L'état du corpus pour la page (taille réelle, nombre d'exemples, par source). Lit les tranches : appelé à la demande. */
export function etatCorpus(home: string, dir = dossierCorpus(home)): { octets: number; exemples: number; parSource: Array<{ source: string; n: number }> } {
  const octets = tailleCorpus(dir);
  const scel = existsSync(dir) ? scellageMachine(home) : undefined;
  if (!scel) return { octets, exemples: 0, parSource: [] };
  const corpus = new Corpus(magasinDisque(dir), scel), m = magasinDisque(dir);
  const par = new Map<string, number>();
  let total = 0;
  for (const nom of m.lister()) {
    const source = nom.replace(/^tranche-[0-9]*-/, '').replace(/\.bin$/, '');
    const n = corpus.compterSource(source);
    if (!par.has(source)) { par.set(source, n); total += n; }
  }
  return { octets, exemples: total, parSource: [...par.entries()].map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n) };
}
