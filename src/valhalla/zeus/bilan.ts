// Zeus — « les prédictions étaient-elles correctes ? ». Chaque matin, Zeus garde ce que chaque source prévoit pour
// J+1 à J+3 ; ensuite, il lit ce qui a été réellement mesuré (archive d'Open-Meteo) et compare. Le journal « zeus »
// va dans la base de l'appli (ZEUS_ODIN). Il ne garde NI le nom du lieu, NI sa position : seulement une empreinte
// courte (HMAC) de la position arrondie, pour ne pas mélanger deux lieux si Odin déménage.

import { createHmac, randomBytes } from 'node:crypto';
import { journalDe, type Journal } from '../base/journal.ts';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';
import { arrondi, type Point, type Valeurs } from './sources.ts';
import { comparerGrandeur, GRANDEURS, MOT, TON, type Couleur, type Grandeur, type Verdict } from './comparer.ts';

export type EntreePrevu = { t: 'prevu'; at: string; jour: string; src: string; ech: number; lieu: string } & Valeurs;
export type EntreeMesure = { t: 'mesure'; at: string; jour: string; lieu: string } & Valeurs;
export type Entree = EntreePrevu | EntreeMesure;

export const journal = (ctx: { dir: string }): Journal<Entree> => journalDe<Entree>(ctx, 'zeus', 'releves.jsonl', { garder: 20000 });

const sels = new Map<string, string>();
/**
 * L'empreinte courte d'un lieu : ni nom, ni coordonnées. HMAC avec un sel propre à Zeus, gardé chiffré par la clé de
 * la machine dans ses réglages (sans le sel, on ne peut pas retrouver la position en essayant toutes les cases).
 */
export function empreinteLieu(ctx: { home: string; settings: Record<string, unknown>; saveSettings(p: Record<string, unknown>): void }, p: Point): string {
  let sel = sels.get(ctx.home) ?? '';
  const garde = ctx.settings.selLieu;
  if (!sel && typeof garde === 'string' && garde) { try { sel = dechiffrerChamp(ctx.home, garde); } catch { sel = ''; } }
  if (!/^[0-9a-f]{32}$/.test(sel)) {
    sel = randomBytes(16).toString('hex');
    try { ctx.saveSettings({ selLieu: chiffrerChamp(ctx.home, sel) }); } catch { /* coffre indisponible : sel de cette session seulement */ }
  }
  sels.set(ctx.home, sel);
  return createHmac('sha256', Buffer.from(sel, 'hex')).update(`zeus-lieu\n${arrondi(p.lat).toFixed(2)},${arrondi(p.lon).toFixed(2)}`).digest('hex').slice(0, 12);
}

export const ECHEANCES_BILAN = [1, 3];
export const JOURS_BILAN = 14;
export const JOURS_MINIMUM = 5;
export interface ScoreSource { src: string; ech: number; justes: number; jours: number; verdict: Verdict }

const decaler = (jour: string, k: number) => { const d = new Date(`${jour}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
export { decaler };
const v = (couleur: Couleur, phrase: string): Verdict => ({ couleur, mot: MOT[couleur], ton: TON[couleur], phrase });

/** Un jour est juste quand toutes ses grandeurs connues sont vertes face à la mesure ; rien de comparable : non compté. */
export function jourJuste(prevu: Valeurs, mesure: Valeurs, grandeurs: Grandeur[] = GRANDEURS): boolean | undefined {
  const c = grandeurs.map((g) => comparerGrandeur(g, mesure[g], prevu[g]).couleur).filter((x) => x !== 'gris');
  return c.length ? c.every((x) => x === 'vert') : undefined;
}
/** Le verdict d'un score : 80 % ou plus = vert ; 50 % ou plus = jaune ; moins = rouge ; moins de 5 jours = gris. */
export function verdictScore(justes: number, jours: number): Verdict {
  if (jours < JOURS_MINIMUM) return v('gris', `pas encore assez de jours (${jours}/${JOURS_MINIMUM})`);
  const p = justes / jours;
  return p >= 0.8 ? v('vert', 'Prédictions justes') : p >= 0.5 ? v('jaune', 'Prédictions parfois fausses') : v('rouge', 'Souci : prédictions souvent fausses');
}
/**
 * Le bilan des 14 derniers jours (avant `aujourdhui`), par source et par échéance (J+1, J+3), pour ce lieu.
 * Pour chaque jour : la dernière mesure et la dernière prédiction gardées.
 */
export function bilan(entrees: Entree[], lieu: string, aujourdhui: string, o: { jours?: number; echeances?: number[] } = {}): ScoreSource[] {
  const debut = decaler(aujourdhui, -(o.jours ?? JOURS_BILAN));
  const dansFenetre = (j: string) => j >= debut && j < aujourdhui;
  const mesures = new Map<string, EntreeMesure>(), prevus = new Map<string, EntreePrevu>(), sources: string[] = [];
  for (const e of entrees) {
    if (e.lieu !== lieu || !dansFenetre(e.jour)) continue;
    if (e.t === 'mesure') mesures.set(e.jour, e);
    else { prevus.set(`${e.src}|${e.ech}|${e.jour}`, e); if (!sources.includes(e.src)) sources.push(e.src); }
  }
  const out: ScoreSource[] = [];
  for (const src of sources) for (const ech of o.echeances ?? ECHEANCES_BILAN) {
    let justes = 0, jours = 0;
    for (const [jour, m] of mesures) {
      const p = prevus.get(`${src}|${ech}|${jour}`); if (!p) continue;
      const j = jourJuste(p, m); if (j === undefined) continue;
      jours++; if (j) justes++;
    }
    out.push({ src, ech, justes, jours, verdict: verdictScore(justes, jours) });
  }
  return out;
}
