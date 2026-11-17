// Plugins des compétences : le rangement sur le disque (<home>/competences/plugins.json et constats.json).
// Écriture atomique (fichier temporaire puis renommage), validation, limites, fichier abîmé mis de côté.
// Rien de secret ici : des noms et des compteurs seulement (ni jeton, ni adresse, ni commande).
// Toutes les fonctions sont synchrones : une lecture-modification-écriture ne peut pas être coupée par une autre requête.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { constatsVides } from './graphe.ts';
import type { Constats, FichierPlugins, LienDeclare, PluginRange } from './types.ts';

export const LIMITES = { plugins: 200, skillsParPlugin: 200, mcpParPlugin: 50, liens: 2000, nom: 60, description: 300, octets: 1024 * 1024 } as const;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

/** Une erreur à rendre telle quelle au propriétaire (400, 404). */
export class ErreurPlugins extends Error {
  readonly code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}

export const dossierPlugins = (home: string) => join(home, 'competences');
const fichierPlugins = (home: string) => join(dossierPlugins(home), 'plugins.json');
const fichierConstats = (home: string) => join(dossierPlugins(home), 'constats.json');
const vide = (): FichierPlugins => ({ version: 1, plugins: [], liens: [] });

const estTexte = (v: unknown): v is string => typeof v === 'string';
const listeTextes = (v: unknown): v is string[] => Array.isArray(v) && v.every(estTexte);

const plugin = (p: PluginRange) => Boolean(p) && typeof p === 'object' && estTexte(p.id) && ID_RE.test(p.id) && estTexte(p.nom) && estTexte(p.description ?? '') && listeTextes(p.skills) && listeTextes(p.mcp);
const lienDeclare = (l: LienDeclare) => Boolean(l) && typeof l === 'object' && estTexte(l.skill) && estTexte(l.mcp);
/** La forme générale seulement : un plugin ou un lien fautif est écarté à la lecture, pas tout le fichier. */
function formePlugins(x: unknown): x is FichierPlugins {
  const f = x as FichierPlugins;
  return Boolean(f) && typeof f === 'object' && f.version === 1 && Array.isArray(f.plugins) && Array.isArray(f.liens);
}
function formeConstats(x: unknown): x is Constats {
  const c = x as Constats;
  return Boolean(c) && typeof c === 'object' && c.version === 1 && listeTextes(c.vus) && Boolean(c.skillMcp) && typeof c.skillMcp === 'object' && Boolean(c.mcpTours) && typeof c.mcpTours === 'object';
}

/**
 * Lit un fichier JSON ; « abime » si trop gros, pas du JSON ou de forme inattendue. Une lecture qui échoue pour une
 * raison passagère (fichier occupé, accès refusé) n'est PAS un fichier abîmé : erreur 503, et rien n'est mis de côté.
 */
function lire<T>(f: string, forme: (x: unknown) => x is T): { valeur?: T; abime: boolean } {
  if (!existsSync(f)) return { abime: false };
  let texte: string;
  try {
    if (statSync(f).size > LIMITES.octets) return { abime: true };
    texte = readFileSync(f, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return { abime: false };
    throw new ErreurPlugins(503, 'Le fichier des plugins est occupé pour l\'instant : réessaie dans un moment.');
  }
  try {
    const x = JSON.parse(texte.replace(/^﻿/, '')) as unknown;
    return forme(x) ? { valeur: x, abime: false } : { abime: true };
  } catch { return { abime: true }; }
}

/** Écrit d'un coup : <fichier>.tmp-<pid>-<aléa> puis renommage ; un fichier abîmé est d'abord mis de côté (jamais écrasé). */
function ecrire(f: string, valeur: unknown, mettreDeCote: boolean): void {
  const texte = `${JSON.stringify(valeur, null, 2)}\n`;
  if (Buffer.byteLength(texte) > LIMITES.octets) throw new ErreurPlugins(400, 'Le fichier des plugins dépasserait 1 Mo.');
  mkdirSync(join(f, '..'), { recursive: true });
  if (mettreDeCote && existsSync(f)) renameSync(f, `${f}.abime-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const tmp = `${f}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try { writeFileSync(tmp, texte, { mode: 0o600 }); renameSync(tmp, f); }
  catch (e) { try { rmSync(tmp, { force: true }); } catch { /* rien */ } throw e; }
}

/**
 * Les plugins rangés. Un plugin ou un lien de forme fautive est écarté (les autres restent) ; le fichier est alors
 * dit « abîmé » : à la prochaine écriture, l'original est mis de côté (copie gardée), jamais écrasé.
 */
export function lirePlugins(home: string): { fichier: FichierPlugins; abime: boolean; ecartes?: number } {
  const r = lire(fichierPlugins(home), formePlugins);
  if (!r.valeur) return { fichier: vide(), abime: r.abime };
  const f = r.valeur, vus = new Set<string>();
  const bons = f.plugins.filter((p) => { const ok = plugin(p) && !vus.has(p.id); if (ok) vus.add(p.id); return ok; });
  const liens = f.liens.filter(lienDeclare);
  const ecartes = f.plugins.length - bons.length + f.liens.length - liens.length;
  return { fichier: { version: 1, plugins: bons.map((p) => ({ id: p.id, nom: p.nom, description: p.description ?? '', skills: [...p.skills], mcp: [...p.mcp], cree: String(p.cree ?? ''), modifie: String(p.modifie ?? '') })), liens: liens.map((l) => ({ skill: l.skill, mcp: l.mcp, cree: String(l.cree ?? '') })) }, abime: ecartes > 0, ...(ecartes ? { ecartes } : {}) };
}
function ecrirePlugins(home: string, f: FichierPlugins, abime: boolean): void { ecrire(fichierPlugins(home), f, abime); }

export function lireConstats(home: string): { constats: Constats; abime: boolean } {
  const r = lire(fichierConstats(home), formeConstats);
  return { constats: r.valeur ?? constatsVides(), abime: r.abime };
}
export function ecrireConstats(home: string, c: Constats, abime = false): void { ecrire(fichierConstats(home), c, abime); }

/** Longueur maximale d'un identifiant (celle de ID_RE). */
const MAX_ID = 41;
/**
 * L'identifiant tiré du nom : minuscules, sans accents, tirets ; « -2 », « -3 »… s'il est pris. La base est coupée
 * selon la longueur du suffixe : l'identifiant respecte toujours ID_RE (41 caractères au plus).
 */
export function idDepuisNom(nom: string, pris: Set<string>): string {
  let base = nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (base.length < 2) base = `plugin${base ? `-${base}` : ''}`;
  const couper = (n: number) => base.slice(0, n).replace(/-+$/, '');
  const seul = couper(MAX_ID);
  if (!pris.has(seul)) return seul;
  for (let i = 2; ; i++) { const suffixe = `-${i}`, id = `${couper(MAX_ID - suffixe.length)}${suffixe}`; if (!pris.has(id)) return id; }
}

/** Ce qui existe aujourd'hui (compétences actives, connecteurs branchés), pour valider une écriture. */
export interface References { skills: Set<string>; mcp: Set<string> }

const nettoyerListe = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? '').trim()).filter(Boolean))] : []);

/**
 * Crée (sans id) ou remplace (avec id) un plugin. Chaque référence doit exister aujourd'hui ; une référence déjà
 * présente dans le plugin et disparue depuis peut rester (sinon modifier la description obligerait à la retirer).
 */
export function enregistrerPlugin(home: string, entree: { id?: unknown; nom?: unknown; description?: unknown; skills?: unknown; mcp?: unknown }, refs: References, maintenant: Date): PluginRange {
  const { fichier, abime } = lirePlugins(home);
  const nom = String(entree.nom ?? '').trim(), description = String(entree.description ?? '').trim();
  if (!nom) throw new ErreurPlugins(400, 'Le nom est obligatoire.');
  if (nom.length > LIMITES.nom) throw new ErreurPlugins(400, `Le nom dépasse ${LIMITES.nom} caractères.`);
  if (description.length > LIMITES.description) throw new ErreurPlugins(400, `La description dépasse ${LIMITES.description} caractères.`);
  const skills = nettoyerListe(entree.skills), mcp = nettoyerListe(entree.mcp);
  if (skills.length > LIMITES.skillsParPlugin) throw new ErreurPlugins(400, `Un plugin réunit ${LIMITES.skillsParPlugin} compétences au plus.`);
  if (mcp.length > LIMITES.mcpParPlugin) throw new ErreurPlugins(400, `Un plugin réunit ${LIMITES.mcpParPlugin} connecteurs au plus.`);
  const id = entree.id === undefined || entree.id === null || entree.id === '' ? undefined : String(entree.id);
  const ancien = id === undefined ? undefined : fichier.plugins.find((p) => p.id === id);
  if (id !== undefined && !ancien) throw new ErreurPlugins(404, `Plugin inconnu : « ${id.slice(0, 60)} ».`);
  for (const s of skills) if (!refs.skills.has(s) && !ancien?.skills.includes(s)) throw new ErreurPlugins(400, `Compétence inconnue ou non active : « ${s.slice(0, 80)} ».`);
  for (const m of mcp) if (!refs.mcp.has(m) && !ancien?.mcp.includes(m)) throw new ErreurPlugins(400, `Connecteur inconnu : « ${m.slice(0, 80)} ».`);
  const quand = maintenant.toISOString();
  let p: PluginRange;
  if (ancien) {
    p = { ...ancien, nom, description, skills, mcp, modifie: quand };
    fichier.plugins = fichier.plugins.map((x) => (x.id === ancien.id ? p : x));
  } else {
    if (fichier.plugins.length >= LIMITES.plugins) throw new ErreurPlugins(400, `${LIMITES.plugins} plugins au plus.`);
    p = { id: idDepuisNom(nom, new Set(fichier.plugins.map((x) => x.id))), nom, description, skills, mcp, cree: quand, modifie: quand };
    // Jamais un identifiant hors règle sur le disque (il rendrait le fichier illisible).
    if (!ID_RE.test(p.id)) throw new ErreurPlugins(400, 'Identifiant de plugin impossible à tirer de ce nom.');
    fichier.plugins.push(p);
  }
  ecrirePlugins(home, fichier, abime);
  return p;
}

export function supprimerPlugin(home: string, id: unknown): void {
  const { fichier, abime } = lirePlugins(home);
  const i = fichier.plugins.findIndex((p) => p.id === String(id ?? ''));
  if (i < 0) throw new ErreurPlugins(404, 'Plugin inconnu.');
  fichier.plugins.splice(i, 1);
  ecrirePlugins(home, fichier, abime);
}

/** Relie (ou délie) une compétence et un connecteur, sans plugin. Délier ne retire que le lien DÉCLARÉ. */
export function lier(home: string, skill: unknown, mcp: unknown, relie: boolean, refs: References, maintenant: Date): void {
  const s = String(skill ?? '').trim(), m = String(mcp ?? '').trim();
  if (!s || !m) throw new ErreurPlugins(400, 'Compétence et connecteur obligatoires.');
  const { fichier, abime } = lirePlugins(home);
  const deja = fichier.liens.some((l: LienDeclare) => l.skill === s && l.mcp === m);
  if (relie) {
    if (!refs.skills.has(s)) throw new ErreurPlugins(400, `Compétence inconnue ou non active : « ${s.slice(0, 80)} ».`);
    if (!refs.mcp.has(m)) throw new ErreurPlugins(400, `Connecteur inconnu : « ${m.slice(0, 80)} ».`);
    if (deja) return;
    if (fichier.liens.length >= LIMITES.liens) throw new ErreurPlugins(400, `${LIMITES.liens} liens déclarés au plus.`);
    fichier.liens.push({ skill: s, mcp: m, cree: maintenant.toISOString() });
  } else {
    if (!deja) return;
    fichier.liens = fichier.liens.filter((l) => !(l.skill === s && l.mcp === m));
  }
  ecrirePlugins(home, fichier, abime);
}
