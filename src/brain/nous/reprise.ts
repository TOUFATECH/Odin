// Points de reprise de Noûs — l'état complet du réseau, scellé et écrit d'un seul coup.
//
// Garde-fous du propriétaire :
//  - VIE PRIVÉE : les poids retiennent ce que Noûs a lu (donc des données privées). Ils sont chiffrés au repos avec
//    la CLÉ DE LA MACHINE (src/vault.ts), jamais en clair, jamais dans le dépôt, jamais envoyés dehors.
//  - NE JAMAIS EMPIRER : écriture d'un seul coup (fichier .tmp puis renameSync) : jamais un point de reprise à
//    moitié écrit. Numérotés. Le nom est lié au contenu par l'« AAD » noos:reprise:<n> (un fichier dont l'AAD ne
//    correspond pas est rejeté). On ne garde qu'un ou deux points (réglable).
//
// Rangés hors du dépôt : <home>/cerveau-reseau/reprise-<n>.bin (home = ~/.odin par défaut).

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chiffrerChamp, exportMachineKey, open, seal } from '../../vault.ts';
import { lireDecoupageSerialise, type DecoupageConcret, type DecoupageSerialise } from './decoupage.ts';
import type { Hyper } from './tailles.ts';

const DOSSIER = 'cerveau-reseau';
const VERSION_FORMAT = 1;
const aad = (n: number): string => `noos:reprise:${n}`;

export interface ContenuReprise {
  hyper: Hyper;
  decoupage: DecoupageSerialise;
  poids: Float32Array;
  m: Float32Array;
  v: Float32Array;
  pas: number;
  graine: number;
  courbe: Array<{ pas: number; perte: number }>;
  modeleVersion?: number;
}
export interface RepriseLue extends Omit<ContenuReprise, 'decoupage'> { n: number; decoupage: DecoupageConcret; modeleVersion: number; /** La version rangée du découpage n'est pas celle qu'on recalcule : découpage d'une ancienne règle. */ decoupageAncien: boolean }

/** Dossier des points de reprise (créé au besoin). */
export function dossierReprise(home: string): string { const d = join(home, DOSSIER); mkdirSync(d, { recursive: true }); return d; }
const cheminDe = (home: string, n: number): string => join(dossierReprise(home), `reprise-${n}.bin`);

/** La clé de la machine pour Noûs (créée si besoin, comme le reste des secrets d'Odin). */
function cleMachine(home: string): Buffer {
  let k = exportMachineKey(home);
  if (!k) { chiffrerChamp(home, ''); k = exportMachineKey(home); } // force la création du coffre et de la clé
  if (!k) throw new Error('clé de la machine indisponible : impossible de sceller un point de reprise');
  return k;
}

const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
const octetsDe = (a: ArrayBufferView): Buffer => Buffer.from(a.buffer as ArrayBuffer, a.byteOffset, a.byteLength);

/** Écrit le point de reprise n, scellé, d'un seul coup, puis purge les plus vieux (plafond disque : on ne garde
 *  que `garder` points, défaut 2). Renvoie son chemin. */
export async function ecrireReprise(home: string, n: number, c: ContenuReprise, garder = 2): Promise<string> {
  const key = cleMachine(home);
  const entete = {
    v: VERSION_FORMAT,
    hyper: c.hyper,
    decoupage: { vocab: c.decoupage.vocab, version: c.decoupage.version, fusions: Buffer.from(octetsDe(c.decoupage.fusions)).toString('base64') },
    pas: c.pas, graine: c.graine, modeleVersion: c.modeleVersion ?? 1,
    courbe: c.courbe.slice(-500),
    lenP: c.poids.length, lenM: c.m.length, lenV: c.v.length,
  };
  const enteteBuf = Buffer.from(JSON.stringify(entete), 'utf8');
  const blob = Buffer.concat([u32(enteteBuf.length), enteteBuf, octetsDe(c.poids), octetsDe(c.m), octetsDe(c.v)]);
  const scelle = seal(key, blob, aad(n));
  const chemin = cheminDe(home, n), tmp = `${chemin}.tmp`;
  writeFileSync(tmp, scelle, { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch { /* Windows : droits du profil */ }
  renameSync(tmp, chemin); // atomique : jamais un fichier à moitié écrit
  if (Number.isFinite(garder) && garder >= 0) nettoyerReprises(home, garder); // plafond disque : on ne laisse pas les reprise-*.bin s'accumuler
  return chemin;
}

/** Numéros de points de reprise présents, du plus grand au plus petit. */
export function listerReprises(home: string): number[] {
  const d = join(home, DOSSIER);
  if (!existsSync(d)) return [];
  const ns: number[] = [];
  for (const f of readdirSync(d)) { const m = /^reprise-(\d+)\.bin$/.exec(f); if (m) ns.push(Number(m[1])); }
  return ns.sort((a, b) => b - a);
}

function lireFichier(home: string, n: number): RepriseLue {
  const key = cleMachine(home);
  const scelle = readFileSync(cheminDe(home, n));
  const blob = open(key, scelle, aad(n)); // lève si l'AAD ne correspond pas (fichier d'un autre n, altéré)
  const lenE = blob.readUInt32LE(0);
  const entete = JSON.parse(blob.subarray(4, 4 + lenE).toString('utf8')) as {
    v: number; hyper: Hyper; decoupage: { vocab: number; version: number; fusions: string };
    pas: number; graine: number; modeleVersion?: number; courbe: Array<{ pas: number; perte: number }>; lenP: number; lenM: number; lenV: number;
  };
  // NE JAMAIS EMPIRER : un point de reprise d'une version de format inconnue (écrit par une version future) est
  // refusé net, pour ne pas réinterpréter en silence des poids d'un autre format. lireReprise capte et rend undefined.
  if (entete.v !== VERSION_FORMAT) throw new Error('version de point de reprise inconnue : ' + entete.v);
  let off = 4 + lenE;
  const prendre = (len: number): Float32Array => { const a = new Float32Array(len); Buffer.from(a.buffer).set(blob.subarray(off, off + len * 4)); off += len * 4; return a; };
  const poids = prendre(entete.lenP), m = prendre(entete.lenM), vv = prendre(entete.lenV);
  const fusionsBuf = Buffer.from(entete.decoupage.fusions, 'base64');
  const fusions = new Int32Array(fusionsBuf.length / 4); Buffer.from(fusions.buffer).set(fusionsBuf);
  const decoupage = lireDecoupageSerialise({ vocab: entete.decoupage.vocab, version: entete.decoupage.version, fusions });
  return { n, hyper: entete.hyper, decoupage, poids, m, v: vv, pas: entete.pas, graine: entete.graine, courbe: entete.courbe ?? [], modeleVersion: entete.modeleVersion ?? 1, decoupageAncien: decoupage.version !== entete.decoupage.version };
}

/** Lit le point de reprise n (ou le plus récent lisible si n est omis). undefined si aucun n'est valable. */
export async function lireReprise(home: string, n?: number): Promise<RepriseLue | undefined> {
  if (typeof n === 'number') { try { return lireFichier(home, n); } catch { return undefined; } }
  for (const num of listerReprises(home)) { try { return lireFichier(home, num); } catch { /* fichier abîmé : on essaie le précédent */ } }
  return undefined;
}

/** Ne garde que les `garder` points de reprise les plus récents (défaut 2). */
export function nettoyerReprises(home: string, garder = 2): void {
  const ns = listerReprises(home);
  for (const n of ns.slice(Math.max(0, garder))) { try { rmSync(cheminDe(home, n), { force: true }); } catch { /* rien */ } }
}

/** Le prochain numéro de point de reprise (dernier + 1, ou 0). */
export function prochainNumero(home: string): number { const ns = listerReprises(home); return ns.length ? ns[0] + 1 : 0; }
