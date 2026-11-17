// Prónoia — lot 3 : prévoir les événements de la maison, par des ESTIMATIONS statistiques écrites dans Odin, à partir
// d'« événements datés d'une appli » (journal de Valhalla, détections de Théia ou de Syrinx, mesures, météo de Zeus),
// reçus sans dépendre du code de ces applis :
//   - rythme quotidien : un même événement revient à peu près à la même heure ; confiance = (jours où il est venu dans
//     la fenêtre + 1) ÷ (jours observés + 2) — une fréquence lissée, rien de plus ;
//   - tendance : une mesure qui monte vers un seuil (disque qui se remplit) ; droite des moindres carrés, confiance
//     bornée par la qualité de l'ajustement (R²) et le nombre de points ;
//   - météo : la probabilité DONNÉE par la prévision météo est relayée telle quelle (non recalculée), et dite comme telle.
// Un événement sur un tiers n'entre jamais ici (filtré en amont par le moteur). Pur : testable avec une fausse horloge.
import { hhmm } from '../../learn/habits.ts';
import type { EvenementDate, Prevision, Source } from './types.ts';

const MIN = 60_000, HEURE = 3_600_000, JOUR = 86_400_000;
/** Combien de jours on regarde en arrière pour un rythme. */
export const FENETRE_JOURS = 28;

/** La clé de rapprochement d'un événement : appli/type[/clé]. */
export const cleEvenement = (ev: Pick<EvenementDate, 'appli' | 'type' | 'cle'>): string => `${ev.appli}/${ev.type}${ev.cle ? `/${ev.cle}` : ''}`;
/** Une prévision météo (elle porte une probabilité) — à distinguer d'une observation. */
export const estPrevisionMeteo = (ev: EvenementDate): boolean => typeof ev.probabilite === 'number' && typeof ev.pour === 'number';

const jourLocal = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const minuteDuJour = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const aMinute = (jourMs: number, minute: number) => { const d = new Date(jourMs); d.setHours(Math.floor(minute / 60), minute % 60, 0, 0); return d.getTime(); };
const mediane = (l: number[]) => { const s = [...l].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** Une estimation avant d'en faire une prévision (le moteur lui donne un id, une date, un état). */
export type Estimation = Omit<Prevision, 'id' | 'cree' | 'etat'>;

/** Ce qui sert de libellé lisible : « porte ouverte (garage) » ; jamais le nom d'une personne (filtré en amont). */
const libelle = (ev: Pick<EvenementDate, 'type' | 'cle' | 'appli'>) => `${ev.type.replace(/_/g, ' ')}${ev.cle ? ` (${ev.cle})` : ''}`;

/** Rythmes quotidiens : les événements qui reviennent vers la même heure, prévus dans l'horizon donné. */
export function rythmes(evs: EvenementDate[], maintenant: number, horizonMs = 24 * HEURE): Estimation[] {
  const debut = maintenant - FENETRE_JOURS * JOUR;
  const recents = evs.filter((e) => e.at >= debut && e.at <= maintenant && !estPrevisionMeteo(e) && typeof e.valeur !== 'number');
  // Les jours où chaque appli a envoyé quelque chose : les jours « observés » (sans eux, on ne peut rien juger).
  const joursAppli = new Map<string, Set<string>>();
  for (const e of evs.filter((x) => x.at >= debut && x.at <= maintenant)) { const s = joursAppli.get(e.appli) ?? new Set(); s.add(jourLocal(e.at)); joursAppli.set(e.appli, s); }
  const parCle = new Map<string, EvenementDate[]>();
  for (const e of recents) { const k = cleEvenement(e); parCle.set(k, [...(parCle.get(k) ?? []), e]); }
  const out: Estimation[] = [];
  for (const [cle, l] of parCle) {
    // La première occurrence de chaque jour.
    const premiers = new Map<string, number>();
    for (const e of l) { const j = jourLocal(e.at); if (!premiers.has(j) || premiers.get(j)! > e.at) premiers.set(j, e.at); }
    if (premiers.size < 3) continue;
    const mins = [...premiers.values()].map(minuteDuJour);
    const med = mediane(mins);
    const ecarts = mins.map((m) => Math.abs(m - med));
    const tol = Math.max(20, Math.min(90, 2 * mediane(ecarts)));
    const k = mins.filter((m) => Math.abs(m - med) <= tol).length;
    const D = Math.max(premiers.size, joursAppli.get(l[0].appli)?.size ?? 0);
    if (k < 3) continue;
    const confiance = (k + 1) / (D + 2);
    // La prochaine occurrence : aujourd'hui si la fenêtre n'est pas passée et qu'il n'est pas déjà venu, sinon demain.
    const aujourdHui = aMinute(maintenant, med);
    const dejaVenu = premiers.has(jourLocal(maintenant)) && Math.abs(minuteDuJour(premiers.get(jourLocal(maintenant))!) - med) <= tol;
    let attendu = aujourdHui;
    if (dejaVenu || aujourdHui + tol * MIN < maintenant) { const demain = new Date(maintenant); demain.setDate(demain.getDate() + 1); attendu = aMinute(demain.getTime(), med); } // « demain », pas « + 24 h » (changement d'heure)
    if (attendu - tol * MIN - maintenant > horizonMs) continue;
    const sources: Source[] = [{ type: 'rythme', detail: `${k} jour(s) sur ${D} observé(s), vers ${hhmm(med)} (± ${tol} min), d'après ${l[0].appli}` }];
    out.push({ sorte: 'evenement', quoi: libelle(l[0]), cle, des: attendu - tol * MIN, attendu, echeance: attendu + tol * MIN, confiance, sources, verifiable: true });
  }
  return out;
}

/** Tendances : une mesure qui monte vers son seuil et l'atteindrait dans l'horizon donné. */
export function tendances(evs: EvenementDate[], maintenant: number, horizonMs = 7 * JOUR): Estimation[] {
  const parCle = new Map<string, EvenementDate[]>();
  for (const e of evs) if (typeof e.valeur === 'number' && typeof e.seuil === 'number' && e.at <= maintenant && e.at >= maintenant - 14 * JOUR) { const k = cleEvenement(e); parCle.set(k, [...(parCle.get(k) ?? []), e]); }
  const out: Estimation[] = [];
  for (const [cle, l0] of parCle) {
    const l = l0.sort((a, b) => a.at - b.at).slice(-30);
    if (l.length < 5) continue;
    const seuil = l[l.length - 1].seuil!, actuel = l[l.length - 1].valeur!;
    if (actuel >= seuil) continue;
    const xs = l.map((e) => (e.at - maintenant) / JOUR), ys = l.map((e) => e.valeur!);
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, y) => s + y, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    if (!sxx || !syy) continue;
    const pente = sxy / sxx; // par jour
    if (pente <= 0) continue;
    const r2 = (sxy * sxy) / (sxx * syy);
    const ordonnee = my - pente * mx;
    const joursAvant = (seuil - ordonnee) / pente;
    const attendu = maintenant + joursAvant * JOUR;
    if (attendu <= maintenant || attendu - maintenant > horizonMs) continue;
    const marge = Math.max(HEURE, 0.25 * (attendu - maintenant));
    const confiance = Math.min(0.9, r2 * Math.min(1, l.length / 10));
    out.push({
      sorte: 'evenement', quoi: `${libelle(l[0])} atteindra ${seuil} (aujourd'hui ${Math.round(actuel * 10) / 10})`, cle: `${cle}#seuil`,
      des: attendu - marge, attendu, echeance: attendu + marge, confiance,
      sources: [{ type: 'tendance', detail: `${l.length} mesures, +${Math.round(pente * 100) / 100} par jour en moyenne (ajustement R² = ${Math.round(r2 * 100) / 100})` }],
      verifiable: true,
    });
  }
  return out;
}

/** Météo : la probabilité annoncée par la prévision (Zeus) est relayée telle quelle, sans être recalculée. */
export function meteo(evs: EvenementDate[], maintenant: number, horizonMs = 48 * HEURE): Estimation[] {
  const parCle = new Map<string, EvenementDate>();
  for (const e of evs) if (estPrevisionMeteo(e) && e.pour! > maintenant && e.pour! - maintenant <= horizonMs && e.at <= maintenant) {
    const k = cleEvenement(e), d = parCle.get(k);
    if (!d || d.at < e.at) parCle.set(k, e); // la plus récente prévision météo fait foi
  }
  return [...parCle.entries()].map(([cle, e]) => ({
    sorte: 'evenement' as const, quoi: `${libelle(e)} annoncé par la météo`, cle,
    des: e.pour! - HEURE, attendu: e.pour!, echeance: e.pour! + HEURE, confiance: e.probabilite!,
    sources: [{ type: 'meteo' as const, detail: `probabilité donnée par la prévision météo (${e.appli}), relayée sans être recalculée` }],
    // vérifiable seulement si la même appli a déjà envoyé des OBSERVATIONS de ce type (sinon : périmée, pas ratée)
    verifiable: evs.some((x) => !estPrevisionMeteo(x) && cleEvenement(x) === cle),
  }));
}
