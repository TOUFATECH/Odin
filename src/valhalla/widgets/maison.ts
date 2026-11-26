// La famille « Maison » des widgets : le bouton sur mesure (une action de n'importe quelle appli, d'un geste).
// Une action grave n'est jamais servie à une tablette « maison » ni à un membre ; une action « propriétaire seul »
// n'est servie qu'à lui. Le bouton passe toujours par l'action de l'appli, avec son accord (rien ne change ici).
// Puis les petits chiffres de la maison (maquette validée « Accueil ») : les appareils allumés, les lumières allumées,
// les serrures verrouillées, la température, l'humidité et les watts que mesurent les prises. Ils lisent les appareils
// que l'écran de la maison reçoit déjà (Midgard), la valeur du moment seulement, et ne commandent rien. Une mesure n'est
// jamais inventée : un appareil hors ligne ou muet depuis plus de 24 h n'entre pas dans le chiffre, et le chiffre le dit ;
// sans appareil, l'état « vide » (jamais un 0 à la place d'une absence). Un membre n'en reçoit aucun : l'écran de la
// maison ne lui donne rien aujourd'hui ; une tablette « maison », qui reçoit déjà ces appareils, oui (public « maison »).
import type { AppareilVu, EtatWidget, Lecteur, SorteWidget, SourceWidget } from './sorte.ts';
// (« Température » et « Humidité » : une pièce ou un capteur choisi, comme pour les widgets d'un appareil)
import { avecChoix, selonLeChoix } from './maison-appareils.ts';

const PETIT = { mini: [2, 1], r: 1 } as const;
export const etiquette: NonNullable<SorteWidget['nettoyer']> = (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; };
/** Muet depuis plus de 24 h : la règle de Constellation (appareils.ts, « Muets depuis 24 h »). */
const MUET_APRES = 86_400_000;
export const frais = (a: AppareilVu, t: number) => a.enLigne !== false && !(typeof a.vuA === 'number' && t - a.vuA > MUET_APRES);
const mot = (v: string) => String(v ?? '').trim().toLowerCase();
/** Les sortes d'appareils qui s'allument (ni un capteur, ni un volet, ni une serrure, ni un bouton). */
export const ALLUMABLES = ['lumière', 'prise', 'ventilateur', 'clim', 'lecteur', 'aspirateur', 'sirène'];
const EN_MARCHE = new Set(['on', 'true', 'playing', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only', 'cleaning']);
const A_L_ARRET = new Set(['off', 'false', 'idle', 'standby', 'paused', 'docked']);
/** Allumé (vrai), éteint (faux), ou on ne sait pas (rien) : jamais deviné. */
export function enMarche(a: AppareilVu): boolean | undefined {
  const e = mot(a.etat); if (!e) return undefined;
  if (a.marche && e === mot(a.marche)) return true;
  if (a.arret && e === mot(a.arret)) return false;
  return EN_MARCHE.has(e) ? true : A_L_ARRET.has(e) ? false : undefined;
}
const VERROUILLEE = new Set(['locked', 'verrouille', 'verrouillé', 'verrouillee', 'verrouillée']);
const OUVERTE = new Set(['unlocked', 'open', 'deverrouille', 'déverrouillé', 'deverrouillee', 'déverrouillée']);
/** Un nombre écrit en entier (comme un relevé, appareils.ts) ; sinon rien. */
export const nombre = (v: string): number | undefined => { const t = String(v ?? '').trim(); return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) && Number.isFinite(Number(t)) ? Number(t) : undefined; };
const arrondi = (v: number, n: number) => Math.round(v * 10 ** n) / 10 ** n;

/** La lecture commune : jamais pour un membre ; Midgard muette : rien ; puis le calcul de la sorte. */
export const lecture = (calcul: (liste: readonly AppareilVu[], t: number, unites: string) => EtatWidget) => async (_w: unknown, src: SourceWidget, l: Lecteur): Promise<EtatWidget> => {
  if (l.qui === 'membre') return { etat: 'refuse', raison: 'proprietaire_seul' };
  if (!src.appareilsMaison) return { etat: 'source_absente', raison: 'pas_encore_lu' };
  const a = await src.appareilsMaison();
  if (!a || !Array.isArray(a.appareils)) return { etat: 'source_absente', raison: 'appli_muette' };
  return calcul(a.appareils, src.maintenant(), a.unites);
};
/** Sans nouvelles : hors ligne, muet depuis plus de 24 h, ou n'a encore rien dit (un état vide). */
export const sansNouvelles = (a: AppareilVu, t: number) => !frais(a, t) || !mot(a.etat);
/**
 * Combien sont allumés, sur combien (jamais compté allumé sans le savoir) ; `muets` : sans nouvelles ; `inconnus` (rendu
 * seulement s'il y en a) : en ligne, mais d'un état qu'Odin ne lit pas (une clim qui publie un nombre).
 */
export const calculAllumes = (garder: (a: AppareilVu) => boolean) => (liste: readonly AppareilVu[], t: number): EtatWidget => {
  const les = liste.filter(garder); if (!les.length) return { etat: 'vide', raison: 'aucun_appareil' };
  let n = 0, muets = 0, inconnus = 0;
  for (const a of les) { if (sansNouvelles(a, t)) { muets++; continue; } const m = enMarche(a); if (m === true) n++; else if (m === undefined) inconnus++; }
  return { etat: 'ok', at: t, donnee: { n, sur: les.length, muets, ...(inconnus ? { inconnus } : {}) } };
};
const allumes = (garder: (a: AppareilVu) => boolean) => lecture(calculAllumes(garder));
/**
 * Une mesure des capteurs : `valeur` rend le nombre dans l'unité montrée, ou rien (pas cette mesure, illisible ou
 * invraisemblable). La moyenne (ou la somme) des capteurs frais ; `n` : combien sont comptés ; `ecartes` : hors ligne,
 * muets ou illisibles ; la pièce de l'unique capteur compté ; l'heure de la plus vieille mesure comptée (son âge vrai) ;
 * `ageInconnu` : une mesure comptée n'a pas d'heure (l'entité d'une box reliée) : son âge n'est pas affirmé.
 */
const calculMesure = (est: (a: AppareilVu, liste: readonly AppareilVu[]) => boolean, valeur: (a: AppareilVu, unites: string) => number | undefined, o: { somme?: boolean; decimales: number; unite?: (u: string) => string }) => (liste: readonly AppareilVu[], t: number, unites: string): EtatWidget => {
  const les = liste.filter((a) => a.sorte === 'capteur' && est(a, liste)); if (!les.length) return { etat: 'vide', raison: 'aucun_appareil' };
  const pris: Array<{ a: AppareilVu; v: number }> = [];
  for (const a of les) { const v = frais(a, t) ? valeur(a, unites) : undefined; if (v !== undefined) pris.push({ a, v }); }
  if (!pris.length) return { etat: 'vide', raison: 'mesures_muettes' };
  const total = pris.reduce((x, p) => x + p.v, 0), ages = pris.map((p) => p.a.vuA).filter((x): x is number => typeof x === 'number');
  const piece = pris.length === 1 ? pris[0].a.piece : '';
  return { etat: 'ok', at: ages.length ? Math.min(...ages) : t, donnee: {
    valeur: arrondi(o.somme ? total : total / pris.length, o.decimales), ...(o.unite ? { unite: o.unite(unites) } : {}), n: pris.length, ecartes: les.length - pris.length, ...(piece ? { piece } : {}), ...(ages.length < pris.length ? { ageInconnu: true } : {}) } };
};
const mesure = (est: (a: AppareilVu, liste: readonly AppareilVu[]) => boolean, valeur: (a: AppareilVu, unites: string) => number | undefined, o: { somme?: boolean; decimales: number; unite?: (u: string) => string }) => lecture(calculMesure(est, valeur, o));
/** Le capteur d'une puce de module (Tasmota sur ESP32 publie la température de sa puce) : pas une mesure de la maison. */
const puce = (a: AppareilVu) => /(^|\s)ESP32[._]Temperature(\s|$)/i.test(a.ids) || /^tasmota_[0-9a-f]+_ESP32_/i.test(a.ids);
/** Un capteur porté par une prise : il partage un lien (un sujet d'état, un module Tasmota) avec un appareil « prise ». */
const surUnePrise = (a: AppareilVu, liste: readonly AppareilVu[]) => Boolean(a.liens?.length) && liste.some((p) => p.sorte === 'prise' && p.liens?.some((l) => a.liens!.includes(l)));
const DEGRES = ['°C', '°F'];
/** Une température en °C ou °F, rendue dans les unités d'Odin ; au-delà de -50 à 100 °C, pas une mesure de la maison. */
function degres(a: AppareilVu, unites: string): number | undefined {
  const n = nombre(a.etat); if (n === undefined) return undefined;
  const c = a.unite === '°F' ? (n - 32) * 5 / 9 : n;
  return c < -50 || c > 100 ? undefined : unites === 'imperial' ? c * 9 / 5 + 32 : c;
}
/** Une humidité en % (une clé « humid » : le niveau d'une pile, en % lui aussi, n'en est pas une), de 0 à 100. */
const humidite = (a: AppareilVu) => { const n = nombre(a.etat); return n === undefined || n < 0 || n > 100 ? undefined : n; };
/** Des watts mesurés (W ou kW), dans les bornes d'un relevé de puissance (appareils.ts). */
const watts = (a: AppareilVu) => { const n = nombre(a.etat); if (n === undefined) return undefined; const w = a.unite === 'kW' ? n * 1000 : n; return w < -1e5 || w > 1e5 ? undefined : w; };
/** Les serrures : verrouillées, ouvertes, sans nouvelles, d'un état inconnu (le compte de « maison_serrures », plus bas). */
export const calculSerrures = (liste: readonly AppareilVu[], t: number): EtatWidget => {
  const les = liste.filter((a) => a.sorte === 'serrure'); if (!les.length) return { etat: 'vide', raison: 'aucun_appareil' };
  let n = 0, ouvertes = 0, muets = 0, inconnus = 0;
  for (const a of les) { if (sansNouvelles(a, t)) { muets++; continue; } const e = mot(a.etat); if (VERROUILLEE.has(e)) n++; else if (OUVERTE.has(e)) ouvertes++; else inconnus++; }
  return { etat: 'ok', at: t, donnee: { n, sur: les.length, ouvertes, muets, ...(inconnus ? { inconnus } : {}) } };
};
/** Les capteurs de chaque mesure (une température : la puce d'un module n'en est pas une ; une humidité : une clé « humid »). */
export const estTemperature = (a: AppareilVu) => a.sorte === 'capteur' && DEGRES.includes(a.unite) && !puce(a);
export const estHumidite = (a: AppareilVu) => a.sorte === 'capteur' && a.unite === '%' && /humid/i.test(a.ids);
export const calculTemperature = calculMesure(estTemperature, degres, { decimales: 1, unite: (u) => (u === 'imperial' ? 'F' : 'C') });
const base = { famille: 'maison', applis: ['midgard'], taille: PETIT, styles: ['simple'], public: 'maison', posable: true, nettoyer: etiquette } as const;

export const SORTES_MAISON = [
  {
    id: 'bouton', famille: 'maison', applis: 'choisie', taille: { mini: [2, 1], r: 2 }, styles: ['simple'], public: 'maison', posable: true,
    nettoyer: (o, out, t) => {
      out.action = t.str(o.action, 40); out.label = t.str(o.label, 40) || out.action; if (!out.action) return false;
      const inp = (o.input && typeof o.input === 'object' ? o.input : {}) as Record<string, unknown>;
      out.input = Object.fromEntries(Object.entries(inp).slice(0, 12).filter(([k]) => /^[a-z_][a-z0-9_]{0,30}$/i.test(k)).map(([k, v]) => [k, t.str(v, 300)]));
      return true;
    },
    lire: async (w, src, l): Promise<EtatWidget> => {
      const m = w.module ? src.appli(w.module) : undefined;
      if (!m) return { etat: 'source_absente', raison: 'appli_absente' };
      if (!w.action) return { etat: 'vide', raison: 'action_non_choisie' };
      const a = src.action(m.id, w.action, w.input ?? {});
      if (!a) return { etat: 'source_absente', raison: 'action_absente' };
      if (a.grave && l.qui !== 'proprietaire') return { etat: 'refuse', raison: 'action_grave', appli: m.id };
      if (a.proprietaireSeul && l.qui !== 'proprietaire') return { etat: 'refuse', raison: 'proprietaire_seul', appli: m.id };
      return { etat: 'ok', at: src.maintenant(), donnee: { titre: w.label || a.label, appli: m.id, grave: a.grave } };
    },
  },
  // Les appareils allumés, sur tous ceux qui s'allument.
  { id: 'maison_allumes', ...base, lire: allumes((a) => ALLUMABLES.includes(a.sorte)) },
  // Les lumières allumées, sur le vrai nombre de lumières.
  { id: 'maison_lumieres', ...base, lire: allumes((a) => a.sorte === 'lumière') },
  // Les serrures : verrouillées, sur combien ; `ouvertes` : déverrouillées ; `muets` : sans nouvelles ; `inconnus` (rendu
  // seulement s'il y en a) : en ligne, d'un état qu'Odin ne lit pas (« jammed » : bloquée). Un capteur de porte n'est pas
  // compté (Odin ne sait pas lequel de ses détecteurs est une porte).
  {
    id: 'maison_serrures', ...base,
    lire: lecture(calculSerrures),
  },
  // La température : la puce d'un module n'en est pas une.
  { id: 'maison_temperature', ...base, nettoyer: avecChoix, lire: selonLeChoix(lecture(calculTemperature), estTemperature) },
  { id: 'maison_humidite', ...base, nettoyer: avecChoix, lire: selonLeChoix(mesure(estHumidite, humidite, { decimales: 0 }), estHumidite) },
  // Les watts : ce que mesurent les prises (des capteurs en W ou kW portés par une prise), additionnés ; jamais toute la
  // maison : un compteur général, ou un capteur qu'Odin ne sait pas relier à une prise (une box reliée), n'est pas compté.
  { id: 'maison_watts', ...base, lire: mesure((a, liste) => (a.unite === 'W' || a.unite === 'kW') && surUnePrise(a, liste), watts, { somme: true, decimales: 0 }) },
] as const satisfies readonly SorteWidget[];
