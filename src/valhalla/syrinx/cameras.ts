// Syrinx — le réflexe des caméras : quand Cyclope (himinbjorg) enregistre un clip ET que l'écoute de cette caméra est
// allumée (éteinte par défaut), Syrinx écoute SEULEMENT les sons (verre cassé, alarme, pleurs, aboiement…), jamais la
// parole, et prévient. Codé, pas encore essayé sur du vrai matériel (un vrai micro de caméra).
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import type { MomentSon, OptionsAnalyse } from '../../audio/contrat.ts';
import type { ActionResult, ModCtx } from '../types.ts';
import { dirPoidsSons } from './base.ts';
import { codeErreur, modeleSonsLocal, oreille, texteErreur } from './bande-son.ts';
import { rangerAnalyse, shaFichierFlux } from './magasin.ts';

export const HONNETE_MATERIEL = 'codé, pas encore essayé sur du vrai matériel';
export const MIN_PAS = 3;
/** Attente avant de réessayer un clip refusé parce que l'oreille est occupée (une seule fois). */
export const ATTENTE_OCCUPE_MS = 3000;

/**
 * Juge s'il faut prévenir : seulement les moments de famille « alerte » qui durent au moins `minPas` pas de 160 ms, et
 * pas si une alerte de cette caméra a déjà été donnée il y a moins de `antiRafaleMs`. Rend le plus probable. Pur.
 */
export function jugerAlerte(m: MomentSon[], o: { minPas: number; dernier?: number; maintenant: number; antiRafaleMs: number }): MomentSon | undefined {
  if (o.dernier !== undefined && o.maintenant - o.dernier < o.antiRafaleMs) return undefined;
  return m.filter((x) => x.famille === 'alerte' && x.pas >= o.minPas).sort((a, b) => b.pMax - a.pMax)[0];
}

/** La dernière alerte donnée par caméra (en mémoire : rien n'est rangé pour l'anti-rafale). */
const dernieres = new Map<string, number>();
/** (essais) oublie l'anti-rafale. */
export function oublierAntiRafale(): void { dernieres.clear(); }

const pct = (x: number) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)} %`;

/** L'action « ecouter_clip » : appelée par le réflexe, jamais par des mots. */
export async function ecouterClip(ctx: ModCtx, i: Record<string, unknown>, prive: boolean): Promise<ActionResult> {
  const camera = String(i.camera ?? '').trim().slice(0, 120), fichier = String(i.fichier ?? '');
  const ecoutees = Array.isArray(ctx.settings.camerasEcoutees) ? (ctx.settings.camerasEcoutees as unknown[]).map(String) : [];
  if (!camera || !ecoutees.includes(camera)) return { text: `${camera || 'caméra'} : écoute de cette caméra éteinte (allume-la dans Syrinx → Réglages).`, data: { ecoute: false } };
  // Le fichier doit être un clip de Cyclope : chemin réel sous himinbjorg/clips (jamais ailleurs, liens suivis).
  let racine = '', reel = '';
  try { racine = realpathSync(join(dirname(ctx.dir), 'himinbjorg', 'clips')); reel = realpathSync(fichier); } catch { throw new Error('refus : ce fichier n\'est pas un clip de caméra'); }
  if (!reel.startsWith(racine + sep)) throw new Error('refus : ce fichier n\'est pas un clip de caméra');
  const or = await oreille();
  if (!or) return { text: 'L\'oreille n\'est pas encore prête sur cette machine.', data: { pret: false } };
  const modele = await modeleSonsLocal(dirPoidsSons(ctx.home));
  if (!modele) return { text: `${camera} : modèle de sons : pas téléchargé (22 Mo, Apache-2.0) — rien n'est écouté.`, data: { pret: false } };
  // La voie des clips (sons seuls, 2 minutes au plus) : une alerte n'attend pas derrière un long son déposé.
  const opts: OptionsAnalyse & { priorite: 'clip' } = { sonsSeuls: true, ecouter: null, demander: null, modele, avecEmpreinte: false, maxSec: 120, priorite: 'clip' };
  let r;
  for (let essai = 0; ; essai++) {
    try { r = await or.analyserSon({ fichier: reel }, opts); break; }
    catch (e) {
      if (codeErreur(e) === 'occupe' && essai < 1) { await new Promise((ok) => setTimeout(ok, ATTENTE_OCCUPE_MS)); continue; }
      // Jamais perdu en silence : le propriétaire sait qu'un clip n'a pas été écouté.
      if (codeErreur(e) === 'occupe') ctx.alert({ level: 'moyenne', title: `Clip de ${camera} non écouté (oreille occupée)`, detail: `${basename(reel)} : trop de clips à la fois ; regarde-le dans Cyclope — ${HONNETE_MATERIEL}`, key: `son:${camera}:occupe` });
      return { ok: false, text: `${camera} : ${texteErreur(e)}` };
    }
  }
  const a = r.analyse, seuils = (ctx.settings.seuils as Record<string, number> | undefined) ?? {};
  // Un seuil réglé par le propriétaire pour une étiquette passe avant celui du modèle.
  const moments = a.sons.moments.filter((m) => !(typeof seuils[m.cle] === 'number' && m.pMax < seuils[m.cle]));
  const maintenant = ctx.now().getTime(), antiRafaleMs = Math.max(0, Number(ctx.settings.antiRafaleMin ?? 10)) * 60_000;
  const m = jugerAlerte(moments, { minPas: MIN_PAS, dernier: dernieres.get(camera), maintenant, antiRafaleMs });
  if (!prive) {
    try {
      const sha = await shaFichierFlux(reel), st = statSync(reel);
      rangerAnalyse(ctx, ctx.home, { sourceRef: `clip:${camera}/${basename(reel)}`, shaFichier: sha, taille: st.size, mtime: Math.round(st.mtimeMs), analyse: a, prive, quand: ctx.now() });
    } catch { /* le rangement ne doit pas empêcher l'alerte */ }
  }
  if (!m) return { text: `${camera} : rien d'inquiétant entendu.`, data: { alerte: false } };
  dernieres.set(camera, maintenant);
  const seuil = typeof seuils[m.cle] === 'number' ? seuils[m.cle] : a.sons.etiquettes.find((e) => e.indice === m.indice)?.seuil ?? 0;
  ctx.alert({ level: 'haute', title: `${m.libelle} : ${camera}`, detail: `probabilité ${pct(m.pMax)} (seuil ${pct(seuil)}) sur ${m.pas} pas de 160 ms — ${HONNETE_MATERIEL}`, key: `son:${camera}:${m.cle}` });
  return { text: `${camera} : ${m.libelle} entendu (${pct(m.pMax)}). ${HONNETE_MATERIEL}.`, data: { alerte: true, cle: m.cle } };
}
