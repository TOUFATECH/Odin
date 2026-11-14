// Ulysse · le calcul des trajets (aucun fichier, aucun réseau : que des fonctions pures, écrites pour Odin).
// Des positions d'un téléphone (heure, latitude, longitude, précision) on tire :
//   - les points aberrants à écarter (trop imprécis, ou un aller-retour impossible) ;
//   - les arrêts (on est resté au même endroit) et les trajets entre deux arrêts (distance, durée, vitesse) ;
//   - un tracé allégé pour le dessin, et un fichier GPX 1.1.
// Les téléphones n'envoient pas tous au même rythme (un point toutes les dix secondes en mode « déplacement », un point
// tous les 500 m ou toutes les demi-heures en mode économe) : un long silence au même endroit compte comme un arrêt,
// et ce qui est deviné est dit (« fin estimée », « tracé estimé »), jamais présenté comme mesuré.

/** Une position gardée : heure (millisecondes), latitude, longitude, précision (m), vitesse (km/h), altitude (m). */
export interface Pt { t: number; lat: number; lon: number; acc?: number; vel?: number; alt?: number }
/** Un arrêt : de quand à quand, où (le centre des positions), sur combien de positions. */
export interface Arret { debut: number; fin: number; lat: number; lon: number; n: number; /** l'heure de départ est déduite (le téléphone n'a rien envoyé au moment du départ) */ finEstimee: boolean }
/** Un trajet entre deux arrêts (`de` et `vers` : rangs dans la liste des arrêts, -1 s'il n'y en a pas). */
export interface Trajet { debut: number; fin: number; points: Pt[]; metres: number; /** un long moment sans position : le tracé est une ligne droite à cet endroit */ trou: boolean; /** l'heure de départ est déduite */ departEstime: boolean; de: number; vers: number }
export interface Decoupe { arrets: Arret[]; trajets: Trajet[] }
export interface Reglages {
  /** rayon (m) dans lequel on est « au même endroit » */ rayon: number;
  /** durée (ms) à partir de laquelle rester au même endroit est un arrêt */ pause: number;
  /** précision (m) au-delà de laquelle une position est écartée */ precision: number;
  /** vitesse (km/h) qu'un aller-retour ne peut pas dépasser */ vitesse: number;
  /** silence (ms) qui, à lui seul, fait un arrêt ; et au-delà duquel un tracé est « à trou » */ silence: number;
  /** allure (km/h) supposée pour estimer l'heure d'un départ que le téléphone n'a pas vu */ allure: number;
}
export const REGLAGES: Reglages = { rayon: 120, pause: 5 * 60_000, precision: 250, vitesse: 160, silence: 20 * 60_000, allure: 25 };

const RAD = Math.PI / 180;
/** Distance entre deux points (mètres, formule de haversine sur une Terre ronde de 6 371 km). */
export function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Vitesse (km/h) qu'il aurait fallu pour aller de `a` à `b`. */
function allure(a: Pt, b: Pt): number {
  const d = distance(a, b), dt = b.t - a.t;
  return dt > 0 ? (d / 1000) / (dt / 3_600_000) : d > 0 ? Infinity : 0;
}

/**
 * Trie les positions, retire les doublons et écarte les points aberrants :
 *   - trop imprécis (le téléphone annonce plus de `precision` mètres d'erreur) ;
 *   - un aller-retour impossible : un à trois points où il aurait fallu aller puis revenir à plus de `vitesse` km/h ;
 *   - au tout début ou à la toute fin, un saut plus rapide qu'un avion de ligne.
 */
export function nettoyer(brut: Pt[], o: Reglages = REGLAGES): { points: Pt[]; ecartes: Pt[] } {
  const ecartes: Pt[] = [], tri = brut.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180).sort((a, b) => a.t - b.t);
  const pts: Pt[] = [];
  for (const p of tri) {
    const d = pts.at(-1);
    // Deux positions au même instant : on garde la plus précise.
    if (d && d.t === p.t) { if ((p.acc ?? 1e9) < (d.acc ?? 1e9)) pts[pts.length - 1] = p; continue; }
    if ((p.acc ?? 0) > o.precision) { ecartes.push(p); continue; }
    pts.push(p);
  }
  let i = 1;
  while (i < pts.length - 1) {
    let k = 0;
    for (let n = 1; n <= 3 && i + n < pts.length; n++) {
      const avant = pts[i - 1], premier = pts[i], dernier = pts[i + n - 1], apres = pts[i + n];
      if (allure(avant, premier) > o.vitesse && allure(dernier, apres) > o.vitesse && distance(avant, apres) < 0.5 * Math.max(distance(avant, premier), distance(dernier, apres))) { k = n; break; }
    }
    if (k) ecartes.push(...pts.splice(i, k)); else i++;
  }
  const FOU = 1000;
  while (pts.length >= 2 && allure(pts[0], pts[1]) > FOU && distance(pts[0], pts[1]) > 2000) ecartes.push(pts.shift()!);
  while (pts.length >= 2 && allure(pts[pts.length - 2], pts[pts.length - 1]) > FOU && distance(pts[pts.length - 2], pts[pts.length - 1]) > 2000) ecartes.push(pts.pop()!);
  return { points: pts, ecartes: ecartes.sort((a, b) => a.t - b.t) };
}

/** Longueur d'un tracé (m). Les pas de moins de 15 m ne comptent pas : à l'arrêt, le GPS tremble et ferait des kilomètres. */
export function longueur(points: Array<{ lat: number; lon: number }>): number {
  let m = 0, ancre = points[0];
  for (let k = 1; k < points.length; k++) { const d = distance(ancre, points[k]); if (d >= 15 || k === points.length - 1) { m += d; ancre = points[k]; } }
  return m;
}

interface Grappe { i: number; j: number; lat: number; lon: number; debut: number; fin: number; estimee: boolean }
interface Sejour { ga: number; gb: number; lat: number; lon: number; debut: number; fin: number; n: number; estimee: boolean }

/**
 * Découpe une suite de positions (déjà nettoyées, dans l'ordre, sans coupure au milieu) en arrêts et en trajets.
 *   1. Les positions qui restent dans le même rayon forment une grappe.
 *   2. Si le téléphone se tait longtemps après une grappe puis reparaît ailleurs, on est resté sur place : la fin de
 *      l'arrêt est estimée (l'heure du point suivant, moins le temps du chemin à une allure ordinaire).
 *   3. Une grappe qui dure au moins `pause`, sans dériver d'un bout à l'autre, est un arrêt.
 *   4. Deux arrêts de suite au même endroit, à peine quittés, n'en font qu'un.
 *   5. Ce qui sépare deux arrêts est un trajet ; avant le premier arrêt et après le dernier aussi, s'il y a du chemin.
 */
export function decouper(pts: Pt[], o: Reglages = REGLAGES): Decoupe {
  const n = pts.length, arrets: Arret[] = [], trajets: Trajet[] = [];
  if (!n) return { arrets, trajets };
  const grappes: Grappe[] = [];
  for (let i = 0; i < n;) {
    let lat = pts[i].lat, lon = pts[i].lon, c = 1, j = i;
    while (j + 1 < n) {
      const q = pts[j + 1];
      if (distance({ lat: lat / c, lon: lon / c }, q) > o.rayon + Math.min(q.acc ?? 0, o.rayon)) break;
      lat += q.lat; lon += q.lon; c++; j++;
    }
    grappes.push({ i, j, lat: lat / c, lon: lon / c, debut: pts[i].t, fin: pts[j].t, estimee: false });
    i = j + 1;
  }
  const mParMs = o.allure / 3.6 / 1000;
  for (const g of grappes) {
    const q = pts[g.j + 1]; if (!q) continue;
    const chemin = distance(g, q) / mParMs, reste = (q.t - g.fin) - chemin;
    if (reste >= (g.fin - g.debut >= o.pause ? o.pause : o.silence)) { g.fin = q.t - chemin; g.estimee = true; }
  }
  // Une promenade lente reste longtemps « dans le rayon » sans être un arrêt : le début et la fin de la grappe s'éloignent.
  const centre = (a: number, b: number) => { let la = 0, lo = 0; for (let k = a; k <= b; k++) { la += pts[k].lat; lo += pts[k].lon; } return { lat: la / (b - a + 1), lon: lo / (b - a + 1) }; };
  const derive = (g: Grappe) => { const c = g.j - g.i + 1, t = Math.floor(c / 3); return c < 6 ? 0 : distance(centre(g.i, g.i + t - 1), centre(g.j - t + 1, g.j)); };
  const sejours: Sejour[] = [];
  grappes.forEach((g, k) => {
    if (g.fin - g.debut < o.pause || derive(g) > 0.6 * o.rayon) return;
    const c = g.j - g.i + 1, prev = sejours.at(-1);
    if (prev && distance(prev, g) <= 1.5 * o.rayon && g.debut - prev.fin <= 10 * 60_000 && pts.slice(grappes[prev.gb].j + 1, g.i).every((p) => distance(prev, p) <= 2.5 * o.rayon)) {
      const tout = prev.n + c;
      prev.lat = (prev.lat * prev.n + g.lat * c) / tout; prev.lon = (prev.lon * prev.n + g.lon * c) / tout; prev.n = tout; prev.fin = g.fin; prev.estimee = g.estimee; prev.gb = k;
    } else sejours.push({ ga: k, gb: k, lat: g.lat, lon: g.lon, debut: g.debut, fin: g.fin, n: c, estimee: g.estimee });
  });
  for (const s of sejours) arrets.push({ debut: s.debut, fin: s.fin, lat: s.lat, lon: s.lon, n: s.n, finEstimee: s.estimee });
  const trajet = (de: number, vers: number, i0: number, i1: number): void => {
    const a = sejours[de], b = sejours[vers], milieu = pts.slice(i0, i1);
    const points: Pt[] = [...(a ? [{ t: a.fin, lat: a.lat, lon: a.lon }] : []), ...milieu, ...(b ? [{ t: b.debut, lat: b.lat, lon: b.lon }] : [])];
    if (points.length < 2) return;
    const metres = longueur(points);
    // Un bout de chemin sans arrêt d'un côté (début ou fin des positions) : seulement s'il y a vraiment du chemin.
    if ((!a || !b) && metres < Math.max(200, o.rayon)) return;
    trajets.push({ debut: points[0].t, fin: points[points.length - 1].t, points, metres, trou: points.some((p, k) => k > 0 && p.t - points[k - 1].t > o.silence), departEstime: Boolean(a?.estimee), de: a ? de : -1, vers: b ? vers : -1 });
  };
  if (!sejours.length) { trajet(-1, -1, 0, n); return { arrets, trajets }; }
  trajet(-1, 0, 0, grappes[sejours[0].ga].i);
  for (let k = 0; k + 1 < sejours.length; k++) trajet(k, k + 1, grappes[sejours[k].gb].j + 1, grappes[sejours[k + 1].ga].i);
  trajet(sejours.length - 1, -1, grappes[sejours[sejours.length - 1].gb].j + 1, n);
  return { arrets, trajets };
}

/**
 * Allège un tracé pour le dessin (méthode de Douglas et Peucker) : les points à moins de `tolerance` mètres de la
 * ligne sont retirés ; la tolérance double tant qu'il reste plus de `max` points. Le premier et le dernier restent.
 */
export function simplifier<P extends { lat: number; lon: number }>(points: P[], tolerance = 8, max = 1200): P[] {
  if (points.length <= 2) return points;
  const k = Math.cos(points[0].lat * RAD), X = (p: P) => p.lon * k * 111_320, Y = (p: P) => p.lat * 110_540;
  const passe = (tol: number): P[] => {
    const garde = new Uint8Array(points.length), pile: Array<[number, number]> = [[0, points.length - 1]];
    garde[0] = garde[points.length - 1] = 1;
    while (pile.length) {
      const [a, b] = pile.pop()!; if (b - a < 2) continue;
      const ax = X(points[a]), ay = Y(points[a]), dx = X(points[b]) - ax, dy = Y(points[b]) - ay, l2 = dx * dx + dy * dy;
      let loin = 0, rang = -1;
      for (let i = a + 1; i < b; i++) {
        const px = X(points[i]) - ax, py = Y(points[i]) - ay, t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
        const d = Math.hypot(px - t * dx, py - t * dy);
        if (d > loin) { loin = d; rang = i; }
      }
      if (rang >= 0 && loin > tol) { garde[rang] = 1; pile.push([a, rang], [rang, b]); }
    }
    return points.filter((_p, i) => garde[i]);
  };
  let tol = tolerance, out = passe(tol);
  while (out.length > max && tol < 5000) { tol *= 2; out = passe(tol); }
  return out;
}

/** Un endroit où l'on s'arrête souvent : le centre de ses arrêts, leur nombre, le temps passé, le dernier passage. */
export interface Groupe { lat: number; lon: number; visites: number; duree: number; dernier: number; /** rang (dans la liste donnée) de l'arrêt le plus récent du groupe */ exemple: number }
/** Regroupe des arrêts par endroit (les plus longs d'abord ; un arrêt rejoint le groupe dont le centre est à moins de `rayon`). */
export function regrouper(arrets: Array<{ debut: number; fin: number; lat: number; lon: number }>, rayon = 150): Groupe[] {
  const groupes: Array<Groupe & { poids: number }> = [];
  const ordre = arrets.map((a, i) => ({ a, i })).sort((x, y) => (y.a.fin - y.a.debut) - (x.a.fin - x.a.debut));
  for (const { a, i } of ordre) {
    const duree = Math.max(0, a.fin - a.debut), g = groupes.find((x) => distance(x, a) <= rayon);
    if (!g) { groupes.push({ lat: a.lat, lon: a.lon, visites: 1, duree, dernier: a.fin, exemple: i, poids: 1 }); continue; }
    g.lat = (g.lat * g.poids + a.lat) / (g.poids + 1); g.lon = (g.lon * g.poids + a.lon) / (g.poids + 1); g.poids++;
    g.visites++; g.duree += duree; if (a.fin > g.dernier) { g.dernier = a.fin; g.exemple = i; }
  }
  return groupes.sort((x, y) => y.duree - x.duree).map(({ poids: _p, ...g }) => g);
}

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const deg = (v: number) => String(Math.round(v * 1e6) / 1e6);
/**
 * Un fichier GPX 1.1 (le format d'échange des GPS, https://www.topografix.com/GPX/1/1) : un `trk` par trajet, un `wpt`
 * par arrêt. Les éléments sont écrits dans l'ordre que le schéma impose, les heures en temps universel.
 */
export function gpx(o: { nom: string; cree: number; trajets: Array<{ nom: string; points: Pt[] }>; arrets?: Array<{ nom: string; lat: number; lon: number; debut: number }> }): string {
  let s = 90, w = 180, n = -90, e = -180, vu = false;
  for (const l of [...o.trajets.map((t) => t.points), o.arrets ?? []]) for (const p of l) { vu = true; if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat; if (p.lon < w) w = p.lon; if (p.lon > e) e = p.lon; }
  const bornes = vu ? `<bounds minlat="${deg(s)}" minlon="${deg(w)}" maxlat="${deg(n)}" maxlon="${deg(e)}"/>` : '';
  const lignes = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Odin - Ulysse" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    `  <metadata><name>${xml(o.nom)}</name><time>${iso(o.cree)}</time>${bornes}</metadata>`];
  for (const a of o.arrets ?? []) lignes.push(`  <wpt lat="${deg(a.lat)}" lon="${deg(a.lon)}"><time>${iso(a.debut)}</time><name>${xml(a.nom)}</name></wpt>`);
  for (const t of o.trajets) {
    lignes.push(`  <trk><name>${xml(t.nom)}</name><trkseg>`);
    for (const p of t.points) lignes.push(`    <trkpt lat="${deg(p.lat)}" lon="${deg(p.lon)}">${p.alt !== undefined ? `<ele>${Math.round(p.alt)}</ele>` : ''}<time>${iso(p.t)}</time></trkpt>`);
    lignes.push('  </trkseg></trk>');
  }
  lignes.push('</gpx>', '');
  return lignes.join('\n');
}
