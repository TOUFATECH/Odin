// Les BROUILLONS de réécriture : le morceau qu'Odin a écrit pour une partie de son code, gardé HORS du code, en
// attendant que le propriétaire le voie. Rien ici n'écrit dans un fichier du code d'Odin : un brouillon est seulement
// rangé, relu, refusé ou dit « périmé ». L'appliquer est une autre porte (celle du noyau), qui n'est pas ici.
//
// Rangés dans <dossier d'Odin>/brouillons-code/<id>.json, chiffrés avec la clé de la machine (prive.ts) : le fichier
// visé, son empreinte au moment du brouillon, le texte complet d'après et son empreinte, qui l'a demandé (rôle, nom,
// canal), le texte de la demande marqué « non vérifié », la date, l'état.
//
// Refusé pour tous : un fichier hors du code d'Odin, dans .git ou node_modules, un fichier qui n'existe pas encore, un
// autre nom que le vrai nom du fichier (flux NTFS, nom court, point ou espace final), un dossier d'Odin placé dans le code,
// un texte au-delà de la taille permise, un texte qui contient une clé, un mot de passe ou un jeton reconnus par le
// masquage d'Odin (heimdall/redact.ts), un demandeur au rôle inconnu, et au-delà des plafonds par personne.
// Refusé EN PLUS pour un membre : le noyau, le code sensible, et tout fichier que l'un ou l'autre charge — calculé à
// chaque demande (fermeture.ts), jamais une liste écrite à la main.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { appPath } from '../tools/self.ts';
import { RACINE_APPLI, cheminReelRelatif, empreinteFichier, estNoyau, estSensible } from '../heimdall/noyau.ts';
import { Redactor } from '../heimdall/redact.ts';
import { refuserDossierReelEnEssai } from '../vault.ts';
import { ecrireFichierPrive, lireFichierPrive } from '../prive.ts';
import { cleChemin, fichiersGardes } from './fermeture.ts';

export type EtatBrouillon = 'proposé' | 'refusé' | 'appliqué' | 'périmé';
export type RoleDemandeur = 'proprietaire' | 'membre';
export interface Demandeur { role: RoleDemandeur; nom: string; canal: string }

export interface Brouillon {
  id: string;
  /** Le fichier visé, relatif au dossier du code, en « / ». */
  fichier: string;
  /** Empreinte SHA-256 du fichier au moment du brouillon (fins de ligne ramenées à « \n »). */
  empreinteAvant: string;
  /** Le texte complet du fichier après réécriture. */
  apres: string;
  empreinteApres: string;
  demandePar: Demandeur;
  /** Les mots de la demande : jamais une instruction, montrés à part. */
  demande: { texte: string; nonVerifie: true };
  date: string;
  etat: EtatBrouillon;
  /** Quand et pourquoi l'état a changé (refus, fichier changé). */
  change?: { date: string; pourquoi: string };
}

/** Taille la plus grande d'un texte d'après (octets) ; les mots de la demande (caractères). */
export const TAILLE_MAX = 256 * 1024;
export const DEMANDE_MAX = 4000;
/** Plafonds par personne : brouillons encore « proposés », et brouillons créés sur 24 heures (tous états). */
export const PLAFONDS = { enAttente: 5, parJour: 20 } as const;

export const DOSSIER_BROUILLONS = 'brouillons-code';
const ID = /^[0-9a-f]{32}$/;
const dossier = (home: string): string => { refuserDossierReelEnEssai(home, 'les brouillons de code'); return join(home, DOSSIER_BROUILLONS); };
const empreinteTexte = (t: string): string => createHash('sha256').update(t.replace(/\r\n/g, '\n')).digest('hex');
const personne = (d: Demandeur): string => `${d.role}:${d.canal}:${d.nom}`.normalize('NFC').toLowerCase();

export interface OptionsBrouillon {
  /** Dossier du code d'Odin (par défaut, celui de ce code). */
  racine?: string;
  maintenant?: number;
  /** Le masquage des secrets (par défaut : celui d'Odin, avec les secrets connus de l'environnement). */
  masqueur?: Redactor;
  /** Remplaçables pour les essais. Une fois branchés, le nom et le canal comptés doivent venir de la session reconnue, jamais de la demande. */
  plafonds?: { enAttente: number; parJour: number };
}

export interface DemandeBrouillon { fichier: string; apres: string; demandePar: Demandeur; demande: string }
export type ResultatBrouillon = { ok: true; brouillon: Brouillon } | { ok: false; raison: string };

const refus = (raison: string): ResultatBrouillon => ({ ok: false, raison });

const CONTROLE = /[\u0000-\u001F\u007F]/;
const nomRefuse = (n: string): string => `Nom refusé (flux, nom court, point ou espace final, caractère de contrôle : seul le vrai nom du fichier est accepté) : ${JSON.stringify(n)}`;
const insensible = process.platform === 'win32' || process.platform === 'darwin';
const enSlash = (x: string): string => x.replace(/\\/g, '/');
const memeChemin = (a: string, b: string): boolean => insensible ? enSlash(a).toLowerCase() === enSlash(b).toLowerCase() : enSlash(a) === enSlash(b);

/**
 * Le chemin réel, relatif au dossier du code, d'un fichier visé ; ou la raison du refus. N'écrit rien.
 * Seul le VRAI nom du fichier est accepté : un autre nom qui mène au même fichier (flux NTFS « x.ts::$DATA » ou
 * « dossier:$I30:$INDEX_ALLOCATION », nom court « DECISI~1.TS », point ou espace final, caractère de contrôle) ne serait
 * pas reconnu comme noyau, code sensible ou fichier chargé : il est refusé, pour tous.
 */
export function fichierVise(fichier: string, racine = RACINE_APPLI): { rel: string } | { raison: string } {
  if (CONTROLE.test(fichier)) return { raison: nomRefuse(fichier) };
  let abs: string;
  try { abs = appPath(fichier, racine); } catch (e) { return { raison: (e as Error).message }; }
  const rel = cheminReelRelatif(abs, racine);
  if (rel === undefined) return { raison: `Hors du code d'Odin : ${fichier}` };
  const r = rel.replace(/\\/g, '/');
  if (r.split('/').some((s) => s.includes(':') || /[. ]$/.test(s))) return { raison: nomRefuse(fichier) };
  if (/^(\.git|node_modules)(\/|$)/i.test(r) || /\/(\.git|node_modules)(\/|$)/i.test(r)) return { raison: `Dossier interdit : ${r}` };
  // Le nom que le système donne lui-même au fichier (noms courts et flux résolus) doit être celui-ci, à la casse près.
  if (existsSync(abs)) {
    let vrai: string | undefined;
    try { vrai = relative(realpathSync.native(racine), realpathSync.native(abs)); } catch { vrai = undefined; }
    if (vrai === undefined || !memeChemin(vrai, r)) return { raison: nomRefuse(fichier) };
    return { rel: enSlash(vrai) };
  }
  return { rel: r };
}

/** Les brouillons ne sont jamais rangés dans le dossier du code (ni dans celui-ci, ni dans `racine`). */
const dansLeCode = (home: string, racine: string): boolean =>
  [racine, RACINE_APPLI].some((x) => cheminReelRelatif(join(home, DOSSIER_BROUILLONS), x) !== undefined);

/** Crée un brouillon (rien n'est écrit dans le code). Rend le brouillon rangé, ou la raison du refus. */
export function creerBrouillon(home: string, d: DemandeBrouillon, o: OptionsBrouillon = {}): ResultatBrouillon {
  const racine = o.racine ?? RACINE_APPLI;
  const qui = d.demandePar;
  if (!qui || (qui.role !== 'proprietaire' && qui.role !== 'membre')) return refus('Demandeur inconnu : seuls le propriétaire et un membre peuvent demander une réécriture.');
  if (typeof qui.nom !== 'string' || !qui.nom.trim() || typeof qui.canal !== 'string' || !qui.canal.trim()) return refus('Demandeur sans nom ou sans canal.');
  if (typeof d.apres !== 'string' || typeof d.demande !== 'string' || typeof d.fichier !== 'string') return refus('Demande incomplète.');
  if (dansLeCode(home, racine)) return refus('Les brouillons ne sont jamais rangés dans le dossier du code d\'Odin : donne un autre dossier d\'Odin.');

  const vise = fichierVise(d.fichier, racine);
  if ('raison' in vise) return refus(vise.raison);
  const abs = join(racine, vise.rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) return refus(`Ce fichier n'existe pas dans le code d'Odin : ${vise.rel}`);

  if (qui.role === 'membre') {
    if (estNoyau(vise.rel)) return refus(`Un membre ne peut pas faire réécrire le noyau d'Odin (ses garde-fous) : ${vise.rel}`);
    if (estSensible(vise.rel)) return refus(`Un membre ne peut pas faire réécrire le code sensible d'Odin (ce qui fait tenir ses validations) : ${vise.rel}`);
    const gardes = fichiersGardes(racine).tous;
    if (gardes.has(cleChemin(vise.rel))) return refus(`Un membre ne peut pas faire réécrire un fichier chargé par le noyau ou le code sensible d'Odin : ${vise.rel}`);
  }

  if (Buffer.byteLength(d.apres, 'utf8') > TAILLE_MAX) return refus(`Texte trop long : au plus ${TAILLE_MAX} octets.`);
  if (statSync(abs).size > TAILLE_MAX) return refus(`Fichier trop long pour un brouillon : au plus ${TAILLE_MAX} octets.`);
  if (d.demande.length > DEMANDE_MAX) return refus(`Demande trop longue : au plus ${DEMANDE_MAX} caractères.`);

  // Jamais un secret rangé dans un brouillon : le masquage d'Odin, tel quel, sur tout ce qui serait gardé.
  const masqueur = o.masqueur ?? Redactor.fromEnv();
  for (const t of [d.apres, d.demande, qui.nom, qui.canal]) if (masqueur.redact(t) !== t) return refus('Le texte contient une clé, un mot de passe ou un jeton : rien n\'est gardé.');

  const maintenant = o.maintenant ?? Date.now();
  const plafonds = o.plafonds ?? PLAFONDS;
  const siens = listerBrouillons(home).filter((b) => personne(b.demandePar) === personne(qui));
  if (siens.filter((b) => b.etat === 'proposé').length >= plafonds.enAttente) return refus(`Déjà ${plafonds.enAttente} brouillons en attente pour cette personne.`);
  if (siens.filter((b) => maintenant - Date.parse(b.date) < 24 * 3600_000).length >= plafonds.parJour) return refus(`Déjà ${plafonds.parJour} brouillons en 24 heures pour cette personne.`);

  const b: Brouillon = {
    id: randomBytes(16).toString('hex'),
    fichier: vise.rel,
    empreinteAvant: empreinteFichier(abs),
    apres: d.apres,
    empreinteApres: empreinteTexte(d.apres),
    demandePar: { role: qui.role, nom: qui.nom, canal: qui.canal },
    demande: { texte: d.demande, nonVerifie: true },
    date: new Date(maintenant).toISOString(),
    etat: 'proposé',
  };
  ranger(home, b, racine);
  return { ok: true, brouillon: b };
}

function ranger(home: string, b: Brouillon, racine = RACINE_APPLI): void {
  if (dansLeCode(home, racine)) throw new Error('Les brouillons ne sont jamais rangés dans le dossier du code d\'Odin.');
  const d = dossier(home);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  ecrireFichierPrive(home, join(d, `${b.id}.json`), b);
}

/** Un brouillon par son identifiant ; undefined s'il n'existe pas, est illisible ou si son texte ne correspond plus à son empreinte. */
export function lireBrouillon(home: string, id: string): Brouillon | undefined {
  if (!ID.test(id)) return undefined;
  const b = lireFichierPrive<Brouillon>(home, join(dossier(home), `${id}.json`));
  if (!b || b.id !== id || typeof b.apres !== 'string' || empreinteTexte(b.apres) !== b.empreinteApres) return undefined;
  return b;
}

/** Tous les brouillons lisibles, du plus ancien au plus récent. */
export function listerBrouillons(home: string): Brouillon[] {
  let noms: string[] = [];
  try { noms = readdirSync(dossier(home)); } catch { return []; }
  return noms.filter((n) => n.endsWith('.json')).map((n) => lireBrouillon(home, n.slice(0, -5))).filter((b): b is Brouillon => !!b)
    .sort((x, y) => x.date.localeCompare(y.date));
}

/**
 * Le brouillon, avec son état revu : un brouillon « proposé » dont le fichier a changé depuis (ou a disparu, ou n'est
 * plus dans le code) devient « périmé », et c'est rangé. N'écrit jamais dans le code.
 */
export function revoirBrouillon(home: string, id: string, racine = RACINE_APPLI, maintenant = Date.now()): Brouillon | undefined {
  const b = lireBrouillon(home, id);
  if (!b || b.etat !== 'proposé') return b;
  const vise = fichierVise(b.fichier, racine);
  let actuelle: string | undefined;
  if ('rel' in vise && vise.rel === b.fichier) { try { actuelle = empreinteFichier(join(racine, vise.rel)); } catch { actuelle = undefined; } }
  if (actuelle === b.empreinteAvant) return b;
  const p: Brouillon = { ...b, etat: 'périmé', change: { date: new Date(maintenant).toISOString(), pourquoi: actuelle === undefined ? 'le fichier a disparu ou n\'est plus dans le code' : 'le fichier a changé depuis le brouillon' } };
  ranger(home, p, racine);
  return p;
}

/** Refuse un brouillon encore « proposé » (rien n'est écrit dans le code). Rend le brouillon, ou undefined. Le pourquoi passe par le masquage. */
export function refuserBrouillon(home: string, id: string, pourquoi = 'refusé', maintenant = Date.now(), masqueur: Redactor = Redactor.fromEnv()): Brouillon | undefined {
  const b = lireBrouillon(home, id);
  if (!b || b.etat !== 'proposé') return b;
  const r: Brouillon = { ...b, etat: 'refusé', change: { date: new Date(maintenant).toISOString(), pourquoi: masqueur.redact(pourquoi).slice(0, 200) } };
  ranger(home, r);
  return r;
}
