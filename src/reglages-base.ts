// Les réglages d'Odin dans Alexandrie : la base d'Odin (« ODIN_ODIN », nomBase('odin')), table `reglages.reglages`
// (clé → valeur JSON, date de mise à jour, empreinte du contenu).
//
// - Au démarrage, Odin joint d'abord sa base (amorcerReglages), y lit ses réglages, les recopie dans ses fichiers, PUIS
//   démarre le reste (qui lit les fichiers comme avant). La base fait foi.
// - Chaque enregistrement (config.json, réglages.json des applis, réglages de la mémoire : réveil…) part dans la base
//   (journal d'attente sur le disque d'abord : rien n'est perdu si elle est arrêtée).
// - Les fichiers restent comme COPIE DE SECOURS, tenue à jour : base absente au démarrage (pas encore installée,
//   panne), Odin démarre avec elle et le dit (alerte) ; quand la base revient, ce qui a changé entre-temps part dans la
//   base, puis la base fait foi et la copie est resynchronisée.
// - Premier démarrage avec la base : les réglages des fichiers y sont copiés une fois (les fichiers restent).
// - Un fichier modifié hors d'Odin (à la main, par « odin model » sans passerelle) est plus récent que la base : il y
//   est envoyé au lieu d'être écrasé.
// - JAMAIS de secret dans la base : les réglages des applis qui gardent des secrets, et tout réglage qui contient un
//   mot de passe, un jeton, une empreinte ou une clé d'API connue, restent seulement en fichier. Les valeurs privées
//   (numéros, adresses, position) sont chiffrées avec la clé de la machine (prive.ts), dans la base comme en fichier.
//
// Ce qu'il faut pour joindre la base reste en fichier (amorce) : valhalla/urdr/base-odin.json (où est le serveur :
// mode, adresse, port, compte administrateur) et les mots de passe des bases (valhalla/urdr/secrets.json, fichier
// bloqué + coffre). `ODIN_BASE=non` : pas de base, les réglages restent en fichiers comme avant.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { BaseOdin, utiliserBase, type AppliBase, type DefAppli, type OptionsBase } from './valhalla/base/index.ts';
import { cibleGardee } from './valhalla/base/serveur.ts';
import { INVENTAIRE } from './valhalla/base/inventaire.ts';
import { erreursConfig } from './config.ts';
import { fermer, fermerKv, ouvrir, ouvrirKv, PRIVES_CONFIG, privesAppli } from './prive.ts';
import { ecouterReglages, KV_REGLAGES } from './reglages-note.ts';
import type { AlertIn } from './valhalla/types.ts';

/** La partie « réglages » de la base d'Odin. */
export const DEF_REGLAGES: DefAppli = {
  id: 'reglages', appli: 'odin', schema: 'reglages',
  migrations: [{
    v: 1, nom: 'réglages d\'Odin et des applis',
    sql: `CREATE TABLE reglages (cle text PRIMARY KEY, valeur jsonb NOT NULL, maj timestamptz NOT NULL, empreinte text NOT NULL);
CREATE VIEW v_reglages AS SELECT cle, maj FROM reglages;
GRANT SELECT ON v_reglages TO odin_lecture`,
  }],
  ecritures: {
    // la plus récente gagne (la date vient d'Odin : celle du fichier enregistré)
    poser: 'INSERT INTO reglages (cle, valeur, maj, empreinte) VALUES ($1, $2::jsonb, $3::timestamptz, $4) ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur, maj = EXCLUDED.maj, empreinte = EXCLUDED.empreinte WHERE reglages.maj <= EXCLUDED.maj',
    retirer: 'DELETE FROM reglages WHERE cle = $1 AND maj <= $2::timestamptz',
  },
};
/** Le dossier du journal d'attente des réglages. */
export const dossierReglages = (home: string) => join(home, 'reglages-base');

// ---------------- Les clés ----------------
/** Clé d'un fichier : son chemin dans le dossier d'Odin, avec « / ». Seuls ces fichiers-là (jamais ailleurs). */
const CLE_FICHIER = /^(config\.json|valhalla\/réglages\.json|valhalla\/[a-z][a-z0-9_]{1,30}\/réglages\.json)$/;
const PREFIXE_KV = 'memoire:';
const cleValide = (c: string) => CLE_FICHIER.test(c) || (c.startsWith(PREFIXE_KV) && KV_REGLAGES.includes(c.slice(PREFIXE_KV.length)));
export function cleDeFichier(home: string, fichier: string): string | undefined {
  const r = relative(resolve(home), resolve(fichier)).split(sep).join('/');
  return CLE_FICHIER.test(r) ? r : undefined;
}
const fichierDe = (home: string, cle: string) => join(home, ...cle.split('/'));

// ---------------- Jamais de secret dans la base ----------------
/** Les applis qui gardent des secrets (inventaire d'Alexandrie) : leurs réglages restent en fichier. */
const APPLIS_SECRETES = new Set(Object.entries(INVENTAIRE).filter(([, l]) => l.some((r) => r.raison === 'secret')).map(([id]) => id));
const CLE_SECRETE = /^(password|passwd|pass|pwd|mdp|mot_?de_?passe|motdepasse|token|tokens|jeton|jetons|secret|secrets|api_?key|apikey|private_?key|cle_?privee|hash|empreinte_?mdp)$/i;
/** Les valeurs secrètes connues (clés d'API, jetons de l'environnement d'Odin) : jamais copiées dans la base. */
function valeursSecretes(): string[] {
  return Object.entries(process.env).filter(([k, v]) => /KEY|TOKEN|SECRET|PASS/i.test(k) && typeof v === 'string' && v.length >= 12).map(([, v]) => v!);
}
/** Pourquoi ce réglage reste seulement en fichier (secret), ou rien. */
export function resteEnFichier(cle: string, valeur: unknown): string | undefined {
  const m = /^valhalla\/([a-z0-9_]+)\/réglages\.json$/.exec(cle);
  if (m && APPLIS_SECRETES.has(m[1])) return `réglages de ${m[1]} : l'appli garde des secrets`;
  let r: string | undefined;
  const connues = valeursSecretes();
  const pas = (n: unknown, ch: string): void => {
    if (r) return;
    if (typeof n === 'string') { if (connues.some((s) => n.includes(s))) r = `${ch} : valeur secrète`; return; }
    if (Array.isArray(n)) { n.forEach((x, i) => pas(x, `${ch}[${i}]`)); return; }
    if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) { if (CLE_SECRETE.test(k)) { r = `${ch}.${k} : secret`; return; } pas(v, `${ch}.${k}`); }
  };
  pas(valeur, cle);
  return r;
}

// ---------------- Empreinte (sur le contenu déchiffré, clés triées : la base réordonne les objets JSON) ----------------
const canonique = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonique).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonique((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
};
export function empreinte(home: string, cle: string, valeur: unknown): string {
  const clair = cle.startsWith(PREFIXE_KV) ? ouvrirKv(home, cle.slice(PREFIXE_KV.length), String(valeur ?? '')) : ouvrir(home, valeur);
  return createHash('sha256').update(canonique(clair)).digest('hex');
}

/** Ce qui part dans la base : les valeurs privées chiffrées (même si la copie locale est encore d'avant le chiffrement). */
function pourLaBase(home: string, cle: string, valeur: unknown): unknown {
  if (cle.startsWith(PREFIXE_KV)) return fermerKv(home, cle.slice(PREFIXE_KV.length), String(valeur ?? ''));
  if (cle === 'config.json') return fermer(home, valeur, PRIVES_CONFIG);
  const m = /^valhalla\/([a-z0-9_]+)\/réglages\.json$/.exec(cle);
  return m && privesAppli(m[1]).length ? fermer(home, valeur, privesAppli(m[1])) : valeur;
}

// ---------------- Le stockage (la base ; remplaçable dans les essais) ----------------
export interface EnBase { valeur: unknown; maj: number; empreinte: string }
export interface Stockage {
  /** tout ce qui est dans la base (erreur si elle ne répond pas) */
  lire(): Promise<Map<string, EnBase>>;
  /** note une écriture (journal d'attente, puis la base dès que possible) */
  poser(cle: string, valeur: unknown, maj: number, empreinte: string): void;
  retirer(cle: string, maj: number): void;
}
export function stockageDe(a: AppliBase): Stockage {
  return {
    async lire() {
      const r = await a.q('SELECT cle, valeur::text, (extract(epoch from maj) * 1000)::bigint::text, empreinte FROM reglages');
      return new Map(r.rows.map((x) => [x[0]!, { valeur: JSON.parse(x[1]!) as unknown, maj: Number(x[2]), empreinte: x[3]! }]));
    },
    poser(cle, valeur, maj, emp) { a.ecrire(['poser', cle, JSON.stringify(valeur), new Date(maj).toISOString(), emp]); },
    retirer(cle, maj) { a.ecrire(['retirer', cle, new Date(maj).toISOString()]); },
  };
}

type Kv = { getKv(k: string): string | undefined | null; setKv(k: string, v: string): void; kvBrut?(k: string): string | undefined };
interface Local { valeur: unknown; maj: number; fichier?: string }

/** Les réglages du dossier d'Odin (fichiers) et, si donnée, de la mémoire. */
function locaux(home: string, kv?: Kv): Map<string, Local> {
  const l = new Map<string, Local>();
  const lire = (cle: string) => {
    const f = fichierDe(home, cle); if (!existsSync(f)) return;
    try { l.set(cle, { valeur: JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')) as unknown, maj: Math.floor(statSync(f).mtimeMs), fichier: f }); }
    catch { /* fichier abîmé : la base le remplacera */ }
  };
  lire('config.json'); lire('valhalla/réglages.json');
  const v = join(home, 'valhalla');
  if (existsSync(v)) for (const d of readdirSync(v)) { const c = `valhalla/${d}/réglages.json`; if (CLE_FICHIER.test(c)) lire(c); }
  // la mémoire n'a pas de date par réglage : la base fait foi (ses changements faits ici sont déjà partis par l'attente)
  if (kv) for (const k of KV_REGLAGES) { const x = kv.kvBrut?.(k) ?? kv.getKv(k); if (x) l.set(PREFIXE_KV + k, { valeur: x, maj: 0 }); }
  return l;
}

let suspendu = false;
/** Écrit un réglage venu de la base dans la copie locale (fichier remplacé d'un coup, à la date de la base). */
function ecrireLocal(home: string, cle: string, b: EnBase, kv?: Kv): boolean {
  if (cle.startsWith(PREFIXE_KV)) {
    if (!kv) return false;
    suspendu = true; try { kv.setKv(cle.slice(PREFIXE_KV.length), String(b.valeur ?? '')); } finally { suspendu = false; }
    return true;
  }
  if (cle === 'config.json') { const e = erreursConfig(ouvrir(home, b.valeur)); if (e.length) { console.error(`[réglages] config.json de la base refusé (${e[0]}) : la copie locale est gardée`); return false; } }
  const f = fichierDe(home, cle), t = `${f}.tmp`;
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(t, JSON.stringify(b.valeur, null, 2), { mode: 0o600 }); renameSync(t, f);
  try { utimesSync(f, b.maj / 1000, b.maj / 1000); } catch { /* date du fichier : sans effet */ }
  return true;
}

export interface Bilan { versBase: string[]; depuisBase: string[]; gardes: string[] }
/**
 * Met d'accord la base et la copie locale. Seulement dans la copie : envoyé (premier démarrage avec la base). Seulement
 * dans la base : recopié. Différents : la base fait foi, sauf un fichier plus récent qu'elle (modifié hors d'Odin).
 * `kv` absent : les réglages de la mémoire ne sont pas touchés (la mémoire n'est pas encore ouverte).
 */
export async function synchroniser(home: string, stock: Stockage, kv?: Kv): Promise<Bilan> {
  const base = await stock.lire(), ici = locaux(home, kv), bilan: Bilan = { versBase: [], depuisBase: [], gardes: [] };
  for (const cle of new Set([...ici.keys(), ...base.keys()])) {
    if (!cleValide(cle) || (cle.startsWith(PREFIXE_KV) && !kv)) continue;
    const L = ici.get(cle), B = base.get(cle);
    const pourquoi = resteEnFichier(cle, L?.valeur ?? B?.valeur);
    if (pourquoi) { bilan.gardes.push(cle); continue; }
    const eL = L ? empreinte(home, cle, L.valeur) : '';
    if (L && (!B || (eL !== B.empreinte && L.maj > B.maj))) { stock.poser(cle, pourLaBase(home, cle, L.valeur), L.maj || Date.now(), eL); bilan.versBase.push(cle); continue; }
    if (B && (!L || eL !== B.empreinte) && ecrireLocal(home, cle, B, kv)) bilan.depuisBase.push(cle);
  }
  return bilan;
}

/** Envoie dans la base chaque réglage enregistré (sauf ceux qui restent en fichier). */
function ecouter(home: string, stock: Stockage): () => void {
  return ecouterReglages(home, (n) => {
    if (n.fichier) {
      const cle = cleDeFichier(home, n.fichier); if (!cle || !existsSync(n.fichier)) return;
      const valeur = JSON.parse(readFileSync(n.fichier, 'utf8')) as unknown;
      if (resteEnFichier(cle, valeur)) return;
      stock.poser(cle, pourLaBase(home, cle, valeur), Math.floor(statSync(n.fichier).mtimeMs), empreinte(home, cle, valeur));
    } else if (n.kv && !suspendu && KV_REGLAGES.includes(n.kv)) {
      const cle = PREFIXE_KV + n.kv;
      if (!n.valeur) stock.retirer(cle, Date.now());
      else if (!resteEnFichier(cle, n.valeur)) stock.poser(cle, pourLaBase(home, cle, n.valeur), Date.now(), empreinte(home, cle, n.valeur));
    }
  });
}

// ---------------- Au démarrage d'Odin ----------------
export type Source = 'base' | 'copie' | 'sans-base';
export interface Amorce {
  source: Source;
  message: string;
  base?: BaseOdin;
  bilan?: Bilan;
  /** après l'ouverture de la mémoire d'Odin : ses réglages (réveil…) mis d'accord avec la base */
  brancherMemoire(kv: Kv): Promise<void>;
  /** les alertes (Alexandrie) : « réglages lus dans la copie locale », puis « de nouveau dans la base » */
  brancherAlertes(alert: (a: AlertIn) => void): void;
  /** quand la base revient et change des réglages en marche (les services sont alors relancés) */
  surChangement(f: (cles: string[]) => void): void;
  /** la base répond de nouveau : la base fait foi, la copie est resynchronisée (appelé tout seul quand elle revient) */
  resynchroniser(): Promise<void>;
  /** n'écoute plus les enregistrements (la base elle-même est arrêtée par demarrerBaseOdin) */
  arreter(): void;
}
export interface OptionsAmorce extends Pick<OptionsBase, 'cible' | 'hringhorni' | 'verifierMs' | 'log'> {
  /** combien de temps attendre la base avant de démarrer avec la copie (défaut : 20 s si elle a déjà servi, 3 s sinon) */
  attenteMs?: number;
  /** remplace la base (essais) */
  stockage?: Stockage;
}
const ALERTE = 'reglages:copie';

/**
 * Joint la base d'Odin et y lit les réglages AVANT le démarrage du reste. Rend l'état (base, copie locale ou pas de
 * base) ; la base préparée ici est celle d'Odin (utiliserBase), reprise ensuite par demarrerBaseOdin.
 */
export async function amorcerReglages(home: string, o: OptionsAmorce = {}): Promise<Amorce> {
  const log = o.log ?? ((t: string) => console.log(`[réglages] ${t}`));
  let alerter: ((a: AlertIn) => void) | undefined, changement: ((cles: string[]) => void) | undefined, memoire: Kv | undefined;
  const am: Amorce = {
    source: 'sans-base', message: 'Pas de base d\'Odin (ODIN_BASE=non) : les réglages restent en fichiers.',
    async brancherMemoire() { /* remplacé plus bas */ },
    brancherAlertes(f) { alerter = f; if (am.source === 'copie') f({ level: 'moyenne', title: 'Réglages lus dans la copie locale', detail: am.message, steps: ['Odin marche avec la dernière copie de ses réglages (fichiers du dossier d\'Odin).', 'Les changements faits maintenant attendent sur le disque et partiront dans la base dès qu\'elle revient.', 'Regarde l\'état de la base dans Alexandrie (« état de la base d\'Odin »).'], key: ALERTE }); },
    surChangement(f) { changement = f; },
    async resynchroniser() { /* remplacé plus bas */ },
    arreter() { /* remplacé plus bas */ },
  };
  if (!o.stockage && /^(non|0|false|off)$/i.test(process.env.ODIN_BASE ?? '')) return am;

  let b: BaseOdin | undefined, a: AppliBase | undefined, stock: Stockage;
  if (o.stockage) stock = o.stockage;
  else {
    b = new BaseOdin(home, { cible: o.cible, hringhorni: o.hringhorni, verifierMs: o.verifierMs, log: o.log });
    utiliserBase(b);
    a = b.appli(DEF_REGLAGES, dossierReglages(home));
    stock = stockageDe(a);
  }
  am.base = b;
  const arreterEcoute = ecouter(home, stock);
  const lireBase = async (kv?: Kv): Promise<Bilan> => {
    const r = await synchroniser(home, stock, kv);
    if (r.versBase.length) log(`envoyés dans la base : ${r.versBase.join(', ')}`);
    if (r.depuisBase.length) log(`relus dans la base : ${r.depuisBase.join(', ')}`);
    return r;
  };
  if (b) {
    const deja = Boolean(o.cible ?? cibleGardee(home)), ms = o.attenteMs ?? (deja ? 20_000 : 3_000);
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([b.demarrer().catch(() => undefined), new Promise((r) => { minuterie = setTimeout(r, ms); minuterie.unref?.(); })]);
    clearTimeout(minuterie);
  }
  try {
    // Base absente : la cause seule (le message entier de la base, emboîté ici, redirait « ne répond pas »).
    if (a && !a.prete) throw new Error(a.erreur ?? (b?.etat === 'absente' && b.cause ? b.cause : b?.message) ?? 'la base d\'Odin ne répond pas');
    am.bilan = await lireBase();
    am.source = 'base'; am.message = 'Réglages lus dans la base d\'Odin (Alexandrie).';
  } catch (e) {
    am.source = 'copie';
    am.message = `La base d'Odin ne répond pas au démarrage (${(e as Error).message}) : Odin démarre avec la dernière copie locale de ses réglages.`;
    log(am.message);
  }
  am.brancherMemoire = async (kv) => {
    memoire = kv;
    if (am.source === 'base') { try { await lireBase(kv); } catch (e) { log(`réglages de la mémoire : ${(e as Error).message}`); } }
  };
  // La base revient (ou se rebranche) : ce qui attendait est parti, la base fait foi, la copie est resynchronisée.
  const revenue = async () => {
    try {
      const r = await lireBase(memoire);
      const avant = am.source; am.source = 'base'; am.message = 'Réglages lus dans la base d\'Odin (Alexandrie).';
      if (avant === 'copie') alerter?.({ level: 'info', title: 'Réglages de nouveau dans la base', detail: `La base d'Odin répond : ses réglages font foi, la copie locale est à jour${r.depuisBase.length ? ` (${r.depuisBase.length} réglage(s) relu(s))` : ''}.`, key: ALERTE });
      const fichiers = r.depuisBase.filter((c) => !c.startsWith(PREFIXE_KV));
      if (fichiers.length) changement?.(fichiers);
    } catch (e) { log(`resynchronisation : ${(e as Error).message}`); }
  };
  const surPrete = () => { void revenue(); };
  a?.on('prete', surPrete);
  am.resynchroniser = revenue;
  am.arreter = () => { arreterEcoute(); a?.off('prete', surPrete); };
  return am;
}
