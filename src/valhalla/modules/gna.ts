// Ulysse (Gná · Trajets) — l'historique des positions des téléphones de la famille, et la carte des trajets.
// Les positions arrivent déjà dans Hestia (appli OwnTracks sur le téléphone) ; Hestia n'en garde que la dernière.
// Ici, CHAQUE MEMBRE DÉCIDE pour lui : son historique est éteint au départ ; il l'allume, le met en pause, choisit
// combien de temps il est gardé (30 jours, 90 jours, 1 an), l'efface (tout, une période, un trajet), et dit si le
// propriétaire d'Odin peut voir ses trajets. Le propriétaire peut le faire pour lui, en déclarant son accord : c'est
// noté dans le journal du membre, qui le voit sur sa page (/trajets, avec ses identifiants OwnTracks) et peut tout arrêter.
// Les positions sont découpées en arrêts et en trajets (distance, durée, vitesse ; points aberrants écartés), les lieux
// fréquents sont nommés par le membre (« Maison », « Bureau »), le trajet se dessine dans la page et s'exporte en GPX.
// Vie privée : tout reste dans le dossier de l'appli (fermé aux outils de fichiers) ; le texte des réponses (ce que
// lisent l'IA, Logos et les autres assistants) ne contient jamais une coordonnée ; aucune alerte n'en contient ;
// rien ne part vers Internet, sauf le fond de carte si tu l'allumes (éteint au départ, expliqué avant).
// Écrit pour Odin d'après ce que font les applis de suivi de trajets (Dawarich, OwnTracks Recorder) : aucun code repris.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JOUR, balayer, changer, choixDe, cleJour, compter, coupuresDe, debutJour, deposer, effacer, jourValide, joursGardes, membresConnus, menageExports, oublier, positions, retrouver, souci, voisine, type Choix, type Lieu } from '../gna/historique.ts';
import { REGLAGES, decouper, distance, gpx, nettoyer, regrouper, simplifier, type Decoupe, type Pt } from '../gna/trajets.ts';
import { famille } from './gladsheim.ts';
import type { ActionResult, ModCtx, Module, Param, Section } from '../types.ts';

const s = (v: unknown) => String(v ?? '').trim();
const oui = (v: unknown) => v === true || /^(true|oui|1)$/i.test(s(v));
const plier = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
/** Qui demande : le propriétaire d'Odin (dans Odin), ou un membre de la famille (sur sa page, avec ses identifiants). */
export type Qui = { proprio: true } | { membre: string };
export const PROPRIO: Qui = { proprio: true };
interface Membre { id: string; nom: string }
/** L'adresse de la page des membres, sur l'adresse d'Odin. */
export const PAGE_MEMBRES = '/trajets';
const DUREES: Record<string, number> = { '30 jours': 30, '90 jours': 90, '1 an': 365 };
const dureeTxt = (j: number) => Object.entries(DUREES).find(([, n]) => n === j)?.[0] ?? `${j} jours`;
const OSM_TUILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// ---------------- Petits textes ----------------
const km = (m: number) => `${(m / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
const temps = (ms: number) => { const mn = Math.max(0, Math.round(ms / 60_000)); return mn < 60 ? `${mn} min` : mn < 1440 ? `${Math.floor(mn / 60)} h ${String(mn % 60).padStart(2, '0')}` : `${Math.floor(mn / 1440)} j ${Math.floor((mn % 1440) / 60)} h`; };
const kmh = (m: number, ms: number) => (ms >= 60_000 ? Math.round((m / 1000 / (ms / 3_600_000)) * 10) / 10 : 0);
const kmhTxt = (v: number) => (v ? `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km/h` : '');
const hm = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const jourTxt = (cle: string) => new Date(debutJour(cle)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dateTxt = (t: number) => new Date(t).toLocaleDateString('fr-FR');
const pl = (n: number, un: string, plusieurs = `${un}s`) => `${n.toLocaleString('fr-FR')} ${n > 1 ? plusieurs : un}`;
const arrondi = (v: number) => Math.round(v * 1e5) / 1e5;
/** Le lien « ouvrir dans OpenStreetMap » d'un point (le site ne reçoit ce point que si on clique). */
const osm = (lat: number, lon: number) => `https://www.openstreetmap.org/?mlat=${arrondi(lat)}&mlon=${arrondi(lon)}#map=17/${arrondi(lat)}/${arrondi(lon)}`;

// ---------------- Les membres (tenus par Hestia) ----------------
const membres = (ctx: ModCtx): Membre[] => (famille(join(ctx.dir, '..', 'gladsheim')) ?? []).map((m) => ({ id: m.id, nom: m.name }));
const estProprio = (q: Qui): q is { proprio: true } => 'proprio' in q;
/** Le membre désigné : soi-même sur la page d'un membre ; pour le propriétaire, par son prénom (ou son identifiant interne). */
function trouver(ctx: ModCtx, qui: Qui, v: unknown, lecture = false): Membre {
  const l = membres(ctx);
  if (!estProprio(qui)) { const m = l.find((x) => x.id === qui.membre); if (!m) throw new Error('Ton accès n\'existe plus : demande au propriétaire d\'Odin de te rajouter dans Hestia.'); return m; }
  if (!l.length) throw new Error('Aucun membre pour l\'instant. Ajoute-en un dans Hestia (« Ajouter un membre (OwnTracks) »), puis installe l\'appli OwnTracks sur son téléphone.');
  const t = s(v), m = l.find((x) => x.id === t) ?? l.find((x) => plier(x.nom) === plier(t));
  if (m) return m;
  if (t) throw new Error(`Je ne connais pas de membre « ${t.slice(0, 40)} ». Membres : ${l.map((x) => x.nom).join(', ')}.`);
  const vus = lecture ? l.filter((x) => { const c = choixDe(ctx.dir, x.id); return c.visible && c.etat !== 'éteint'; }) : l;
  if (vus.length === 1) return vus[0];
  throw new Error(lecture && !vus.length ? `Aucun membre ne te montre ses trajets pour l'instant. Chacun décide sur sa page (${PAGE_MEMBRES} sur l'adresse d'Odin) ; tu peux aussi le régler pour lui, avec son accord, dans l'onglet Réglages.` : `Pour quel membre ? (${l.map((x) => x.nom).join(', ')})`);
}
/** Le propriétaire ne lit les trajets d'un membre que si ce membre l'a accepté. */
function lisible(ctx: ModCtx, qui: Qui, m: Membre): Choix {
  const c = choixDe(ctx.dir, m.id);
  if (estProprio(qui) && !c.visible) throw new Error(`Les trajets de ${m.nom} ne sont visibles que par ${m.nom}, sur sa page (${PAGE_MEMBRES} sur l'adresse d'Odin, avec ses identifiants OwnTracks). ${m.nom} peut choisir de te les montrer dans ses réglages ; tu peux aussi le régler ici, avec son accord.`);
  return c;
}
/** « L'historique de Nour » pour le propriétaire, « Ton historique » pour le membre lui-même (et de même pour les positions). */
const H = (qui: Qui, m: Membre) => (estProprio(qui) ? `L'historique de ${m.nom}` : 'Ton historique');
const h = (qui: Qui, m: Membre) => (estProprio(qui) ? `l'historique de ${m.nom}` : 'ton historique');
const P = (qui: Qui, m: Membre) => (estProprio(qui) ? `Les positions de ${m.nom}` : 'Tes positions');
const p = (qui: Qui, m: Membre) => (estProprio(qui) ? `les positions de ${m.nom}` : 'tes positions');
const par = (qui: Qui, m: Membre) => (estProprio(qui) ? 'le propriétaire' : m.nom);

// ---------------- Une journée : arrêts, trajets, coupures ----------------
interface ArretJ { genre: 'arret'; n: number; debut: number; fin: number; lat: number; lon: number; lieu?: string; finEstimee: boolean; avant: boolean; apres: boolean }
interface TrajetJ { genre: 'trajet'; n: number; debut: number; fin: number; points: Pt[]; metres: number; estime: boolean; de?: string; vers?: string }
interface CoupureJ { genre: 'coupure'; debut: number; fin: number }
type Etape = ArretJ | TrajetJ | CoupureJ;
interface Journee { jour: string; etapes: Etape[]; ecartes: number; metres: number; duree: number; trajets: number; arrets: number }

/** Le lieu nommé où se trouve un point (le plus proche, dans son rayon). */
function lieuDe(lieux: Lieu[], pt: { lat: number; lon: number }): Lieu | undefined {
  let best: Lieu | undefined, d0 = Infinity;
  for (const l of lieux) { const d = distance(l, pt); if (d <= l.rayon && d < d0) { best = l; d0 = d; } }
  return best;
}
/** Découpe des positions en morceaux que ne traverse aucune coupure (pause, effacement), puis chaque morceau en arrêts et trajets. */
function morceaux(pts: Pt[], coupes: Array<[number, number]>): Array<Decoupe & { ecartes: Pt[] }> {
  const lots: Pt[][] = [];
  for (const pt of pts) {
    const prev = lots.at(-1)?.at(-1);
    if (!prev || coupes.some(([x, y]) => Math.max(x, prev.t) < Math.min(y, pt.t))) lots.push([pt]); else lots.at(-1)!.push(pt);
  }
  return lots.map((l) => { const n = nettoyer(l, REGLAGES); return { ...decouper(n.points, REGLAGES), ecartes: n.ecartes }; });
}
/** Les étapes d'un jour : les arrêts qui le touchent, les trajets qui y commencent, les coupures. */
function journee(dir: string, id: string, c: Choix, jour: string, now: number): Journee {
  const d0 = debutJour(jour), d1 = debutJour(jour, 1), limite = now - c.conservation * JOUR;
  let pts = positions(dir, id, d0 - JOUR, d1 + JOUR);
  // Un téléphone qui ne bouge pas n'envoie rien : la dernière position d'avant et la première d'après disent où l'on était.
  if (!pts.some((x) => x.t < d0)) { const v = voisine(dir, id, d0 - JOUR, 'avant'); if (v) pts.unshift(v); }
  if (!pts.some((x) => x.t >= d1)) { const v = voisine(dir, id, d1 + JOUR, 'apres'); if (v) pts.push(v); }
  pts = pts.filter((x) => x.t >= limite);
  const coupes = coupuresDe(c, now), etapes: Etape[] = []; let ecartes = 0;
  for (const m of morceaux(pts, coupes)) {
    ecartes += m.ecartes.filter((x) => x.t >= d0 && x.t < d1).length;
    const noms = m.arrets.map((x) => lieuDe(c.lieux, x)?.nom);
    m.arrets.forEach((x, k) => { if (x.fin > d0 && x.debut < d1) etapes.push({ genre: 'arret', n: 0, debut: x.debut, fin: x.fin, lat: x.lat, lon: x.lon, ...(noms[k] ? { lieu: noms[k] } : {}), finEstimee: x.finEstimee, avant: x.debut < d0, apres: x.fin >= d1 }); });
    for (const t of m.trajets) if (t.debut >= d0 && t.debut < d1) etapes.push({ genre: 'trajet', n: 0, debut: t.debut, fin: t.fin, points: t.points, metres: t.metres, estime: t.trou || t.departEstime, ...(noms[t.de] ? { de: noms[t.de] } : {}), ...(noms[t.vers] ? { vers: noms[t.vers] } : {}) });
  }
  for (const [x, y] of coupes) if (y > d0 && x < d1) etapes.push({ genre: 'coupure', debut: x, fin: y });
  etapes.sort((x, y) => x.debut - y.debut || (x.genre === 'arret' ? -1 : 1));
  let nt = 0, na = 0, metres = 0, duree = 0;
  for (const e of etapes) { if (e.genre === 'trajet') { e.n = ++nt; metres += e.metres; duree += e.fin - e.debut; } else if (e.genre === 'arret') e.n = ++na; }
  return { jour, etapes, ecartes, metres, duree, trajets: nt, arrets: na };
}
const resumes = new Map<string, { sig: string; km: number; trajets: number }>();
/** Le résumé d'un jour (distance, nombre de trajets), gardé en mémoire tant que rien ne change sur le disque. */
function resumeJour(dir: string, id: string, c: Choix, jour: string, now: number): { jour: string; km: number; trajets: number } {
  const f = (k: string) => { try { const st = statSync(join(dir, 'positions', id, `${k}.jsonl`)); return `${st.size}:${st.mtimeMs}`; } catch { return '-'; } };
  const sig = [f(cleJour(debutJour(jour, -1))), f(jour), f(cleJour(debutJour(jour, 1))), JSON.stringify(c.coupures), c.conservation, c.etat, cleJour(now)].join('|'), cle = `${dir}\n${id}\n${jour}`, vu = resumes.get(cle);
  if (vu && vu.sig === sig) return { jour, km: vu.km, trajets: vu.trajets };
  const j = journee(dir, id, c, jour, now), r = { sig, km: Math.round(j.metres / 100) / 10, trajets: j.trajets };
  resumes.set(cle, r); if (resumes.size > 2000) resumes.delete(resumes.keys().next().value!);
  return { jour, km: r.km, trajets: r.trajets };
}
/** Le jour demandé : « 2026-11-12 », « 12/11/2026 », « hier », « avant-hier », rien (aujourd'hui). Jamais un jour à venir. */
export function quelJour(i: Record<string, unknown>, now: number): string {
  const dit = s(i.date) || s(i.jour), brut = plier(dit), auj = cleJour(now);
  if (!brut || brut === 'aujourd\'hui' || brut === 'aujourdhui') return auj;
  if (brut === 'hier') return cleJour(debutJour(auj, -1));
  if (/^avant[- ]hier$/.test(brut)) return cleJour(debutJour(auj, -2));
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(brut), fr = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(brut);
  let y = 0, m = 0, d = 0;
  if (iso) { y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]); }
  else if (fr) { d = Number(fr[1]); m = Number(fr[2]); y = fr[3] ? (fr[3].length === 2 ? 2000 + Number(fr[3]) : Number(fr[3])) : new Date(now).getFullYear(); }
  else throw new Error(`Je n'ai pas compris le jour « ${dit.slice(0, 30)} ». Écris-le comme 2026-11-12, 12/11/2026, « hier » ou « avant-hier ».`);
  const cle = (yy: number) => `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!jourValide(cle(y))) throw new Error(`Le jour « ${dit.slice(0, 30)} » n'existe pas.`);
  // Un jour sans année, ou compris comme l'an prochain : un trajet est toujours passé.
  if (cle(y) > auj && jourValide(cle(y - 1))) y -= 1;
  return cle(y);
}

// ---------------- Le fond de carte en ligne (éteint au départ) ----------------
interface Fond { allume: boolean; serveur: string }
const fond = (ctx: ModCtx): Fond => { const f = (ctx.settings.fond ?? {}) as Partial<Fond>; return { allume: f.allume === true, serveur: s(f.serveur) || OSM_TUILES }; };
const hoteDe = (u: string) => { try { return new URL(u.replace(/\{[zxy]\}/g, '0')).host; } catch { return ''; } };
const serveurValide = (u: string) => /^https?:\/\//.test(u) && ['{z}', '{x}', '{y}'].every((k) => u.includes(k)) && Boolean(hoteDe(u)) && !/\s/.test(u);
const attribution = (f: Fond) => (f.serveur === OSM_TUILES ? '© les contributeurs d\'OpenStreetMap' : `Fond de carte : ${hoteDe(f.serveur)}`);
const enCours = new Map<string, Promise<string>>(), pris: number[] = [];
/**
 * Une image du fond de carte (256 × 256), gardée 7 jours dans le dossier de l'appli puis redemandée « si elle a changé ».
 * Les règles du serveur d'OpenStreetMap sont suivies : Odin se nomme, garde les images, n'en télécharge jamais d'avance.
 */
async function tuile(ctx: ModCtx, z: number, x: number, y: number): Promise<string> {
  const f = fond(ctx);
  if (!f.allume) throw new Error('Le fond de carte en ligne est éteint : la carte est dessinée par Odin seul.');
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error('Cette image du fond de carte n\'existe pas.');
  const fichier = join(ctx.dir, 'tuiles', hoteDe(f.serveur).replace(/[^\w.-]/g, '_'), String(z), String(x), `${y}.img`);
  const lue = (): string | undefined => { try { const b = readFileSync(fichier); return b.length ? `data:${b[0] === 0xff ? 'image/jpeg' : b[0] === 0x52 ? 'image/webp' : 'image/png'};base64,${b.toString('base64')}` : undefined; } catch { return undefined; } };
  const now = ctx.now().getTime();
  let age = Infinity; try { age = now - statSync(fichier).mtimeMs; } catch { /* pas encore gardée */ }
  if (age < 7 * JOUR && age > -JOUR) { const d = lue(); if (d) return d; }
  const deja = enCours.get(fichier); if (deja) return deja;
  // Jamais de téléchargement en masse : 600 images neuves par heure au plus (une carte en demande une vingtaine).
  while (pris.length && Math.abs(now - pris[0]) > 3_600_000) pris.shift();
  if (pris.length >= 600) { const d = lue(); if (d) return d; throw new Error('Trop d\'images du fond de carte demandées en une heure : réessaie plus tard (la carte reste lisible sans fond).'); }
  pris.push(now);
  const tache = (async () => {
    try {
      const r = await ctx.fetch(f.serveur.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)), { headers: { 'user-agent': 'Odin-Ulysse/1 (+https://github.com/TOUFATECH/Odin)', accept: 'image/png,image/*;q=0.8', ...(Number.isFinite(age) ? { 'if-modified-since': new Date(now - age).toUTCString() } : {}) }, signal: AbortSignal.timeout(12_000) });
      if (r.status === 304) { try { utimesSync(fichier, new Date(now), new Date(now)); } catch { /* fichier parti */ } const d = lue(); if (d) return d; }
      if (!r.ok) throw new Error(`le serveur du fond de carte a répondu ${r.status}`);
      const b = Buffer.from(await r.arrayBuffer());
      if (!b.length || b.length > 2_000_000 || !/^image\//.test(r.headers.get('content-type') ?? 'image/png')) throw new Error('le serveur du fond de carte n\'a pas rendu une image');
      mkdirSync(dirname(fichier), { recursive: true, mode: 0o700 }); writeFileSync(fichier, b, { mode: 0o600 });
      try { utimesSync(fichier, new Date(now), new Date(now)); } catch { /* heure du fichier non réglable */ }
      return lue() ?? '';
    } catch (e) {
      const d = lue(); if (d) return d;   // serveur injoignable : l'image déjà gardée sert encore
      throw new Error(`Fond de carte indisponible (${(e as Error).message}). La carte reste lisible sans fond.`);
    } finally { enCours.delete(fichier); }
  })();
  enCours.set(fichier, tache);
  return tache;
}
function menageTuiles(dir: string, now: number): void {
  const vider = (d: string): boolean => {
    let noms: string[] = []; try { noms = readdirSync(d); } catch { return false; }
    let reste = 0;
    for (const n of noms) { const f = join(d, n); try { const st = statSync(f); if (st.isDirectory()) { if (vider(f)) rmSync(f, { recursive: true, force: true }); else reste++; } else if (now - st.mtimeMs > 30 * JOUR) rmSync(f, { force: true }); else reste++; } catch { /* déjà parti */ } }
    return reste === 0;
  };
  if (existsSync(join(dir, 'tuiles'))) vider(join(dir, 'tuiles'));
}

// ---------------- Ce que la page reçoit, et le texte pour les autres ----------------
function pourPage(j: Journee) {
  return j.etapes.map((e) => {
    if (e.genre === 'coupure') return { genre: e.genre, debut: e.debut, fin: e.fin, debutTxt: hm(e.debut), finTxt: hm(e.fin) };
    if (e.genre === 'arret') {
      const mi = (Math.max(e.debut, debutJour(j.jour)) + Math.min(e.fin, debutJour(j.jour, 1) - 1)) / 2;
      return { genre: e.genre, n: e.n, debut: e.debut, fin: e.fin, debutTxt: hm(e.debut), finTxt: hm(e.fin), duree: temps(e.fin - e.debut), lat: arrondi(e.lat), lon: arrondi(e.lon), ...(e.lieu ? { lieu: e.lieu } : {}), finEstimee: e.finEstimee, avant: e.avant, apres: e.apres, osm: osm(e.lat, e.lon), repere: { jour: cleJour(mi), heure: hm(mi) } };
    }
    return { genre: e.genre, n: e.n, debut: e.debut, fin: e.fin, debutTxt: hm(e.debut), finTxt: hm(e.fin), km: km(e.metres), duree: temps(e.fin - e.debut), vitesse: kmhTxt(kmh(e.metres, e.fin - e.debut)), estime: e.estime, ...(e.de ? { de: e.de } : {}), ...(e.vers ? { vers: e.vers } : {}), points: simplifier(e.points).map((x) => [arrondi(x.lat), arrondi(x.lon), x.t]) };
  });
}
/** Le texte d'une journée (pour Logos, l'IA et les autres assistants) : des heures, des distances, des noms de lieux, jamais une coordonnée. */
function texteJour(m: Membre, j: Journee): string {
  const tete = `Trajets de ${m.nom}, ${jourTxt(j.jour)} : `;
  if (!j.etapes.some((e) => e.genre !== 'coupure')) return `${tete}rien de gardé ce jour-là.`;
  const lignes = j.etapes.map((e) => (e.genre === 'coupure' ? `- ${hm(e.debut)} → ${hm(e.fin)} : rien de gardé (pause, ou effacé)`
    : e.genre === 'arret' ? `- arrêt ${e.avant ? 'depuis la veille' : hm(e.debut)} → ${e.apres ? 'le lendemain' : `${e.finEstimee ? 'vers ' : ''}${hm(e.fin)}`} (${temps(e.fin - e.debut)}) · ${e.lieu ?? 'lieu sans nom'}`
      : `- trajet ${e.estime ? 'vers ' : ''}${hm(e.debut)} → ${hm(e.fin)} · ${km(e.metres)} · ${temps(e.fin - e.debut)}${kmh(e.metres, e.fin - e.debut) ? ` · ${kmhTxt(kmh(e.metres, e.fin - e.debut))}` : ''}${e.de || e.vers ? ` · ${e.de ?? 'lieu sans nom'} → ${e.vers ?? 'lieu sans nom'}` : ''}${e.estime ? ' (tracé estimé : le téléphone s\'est tu un moment)' : ''}`));
  return `${tete}${pl(j.trajets, 'trajet')}, ${km(j.metres)}, ${temps(j.duree)} en déplacement${j.ecartes ? `, ${pl(j.ecartes, 'point aberrant écarté', 'points aberrants écartés')}` : ''}.\n${lignes.join('\n')}`;
}
/** Les arrêts des 60 derniers jours, regroupés par endroit : ceux qui ont un nom, et ceux qui reviennent souvent sans en avoir. */
function frequents(dir: string, id: string, c: Choix, now: number) {
  const de = now - Math.min(60, c.conservation) * JOUR, pts = c.etat === 'éteint' ? [] : positions(dir, id, de, now + 60_000);
  const arrets = morceaux(pts, coupuresDe(c, now)).flatMap((m) => m.arrets).filter((x) => x.fin - x.debut >= 10 * 60_000);
  const groupes = regrouper(arrets, 150);
  const lieux = c.lieux.map((l) => { const g = groupes.filter((x) => distance(x, l) <= l.rayon); return { id: l.id, nom: l.nom, lat: arrondi(l.lat), lon: arrondi(l.lon), rayon: l.rayon, visites: g.reduce((n, x) => n + x.visites, 0), duree: temps(g.reduce((n, x) => n + x.duree, 0)), osm: osm(l.lat, l.lon) }; });
  const suggestions = groupes.filter((g) => !lieuDe(c.lieux, g) && (g.visites >= 2 || g.duree >= 3_600_000)).slice(0, 6).map((g) => { const x = arrets[g.exemple], mi = (x.debut + x.fin) / 2; return { lat: arrondi(g.lat), lon: arrondi(g.lon), visites: g.visites, duree: temps(g.duree), dernier: dateTxt(g.dernier), osm: osm(g.lat, g.lon), repere: { jour: cleJour(mi), heure: hm(mi) } }; });
  return { lieux, suggestions };
}

// ---------------- Les demandes (du propriétaire dans Odin, ou d'un membre sur sa page) ----------------
/** La période à effacer : un trajet d'un jour, des jours entiers, ou tout. */
function periode(ctx: ModCtx, m: Membre, c: Choix, i: Record<string, unknown>, now: number): { de: number; a: number; quoi: string; court: string; tout: boolean } {
  const n = Number(i.trajet);
  if (s(i.trajet)) {
    const jour = quelJour({ jour: s(i.jour) || s(i.du) }, now), t = Number.isInteger(n) ? journee(ctx.dir, m.id, c, jour, now).etapes.find((e) => e.genre === 'trajet' && e.n === n) : undefined;
    if (!t) throw new Error(`Il n'y a pas de trajet n° ${s(i.trajet).slice(0, 6)} le ${jourTxt(jour)}.`);
    // Les arrêts des deux bouts restent : seul le chemin entre eux est effacé.
    return { de: t.debut + 1, a: t.fin - 1, quoi: `le trajet de ${hm(t.debut)} à ${hm(t.fin)} du ${jourTxt(jour)}`, court: 'un trajet', tout: false };
  }
  if (!s(i.du) && !s(i.au) && !s(i.jour)) return { de: 0, a: now + JOUR, quoi: 'tout l\'historique', court: 'tout l\'historique', tout: true };
  const du = quelJour({ jour: s(i.du) || s(i.jour) || s(i.au) }, now), au = quelJour({ jour: s(i.au) || s(i.du) || s(i.jour) }, now);
  if (au < du) throw new Error('La fin de la période est avant son début.');
  return { de: debutJour(du), a: debutJour(au, 1) - 1, quoi: du === au ? `le ${jourTxt(du)}` : `du ${jourTxt(du)} au ${jourTxt(au)}`, court: du === au ? 'une journée' : 'une période', tout: false };
}
/** Pourquoi une demande est grave (elle efface, elle ouvre vers Internet, elle engage quelqu'un d'autre) : l'accord est demandé avant. */
export function gravite(ctx: ModCtx | undefined, qui: Qui, action: string, brut: Record<string, unknown>): string | undefined {
  if (!ctx) return undefined;
  const prenom = plier(s(brut.membre)), i = prenom ? Object.fromEntries(Object.entries(brut).map(([k, v]) => [k, !['membre', 'nom', 'ancien'].includes(k) && typeof v === 'string' && plier(v) === prenom ? '' : v])) : brut;
  try {
    if (action === 'fond_de_carte') return estProprio(qui) && oui(i.allume) && !fond(ctx).allume ? `afficher un fond de carte venu d'Internet : Odin demandera à ${hoteDe(s(i.serveur) || fond(ctx).serveur) || 'ce serveur'} les images de la zone que tu regardes (ce serveur verra l'adresse d'Odin et cette zone, jamais les points ni les trajets)` : undefined;
    if (!['allumer', 'eteindre', 'effacer', 'conservation', 'partage'].includes(action)) return undefined;
    const m = trouver(ctx, qui, i.membre), c = choixDe(ctx.dir, m.id), now = ctx.now().getTime();
    if (action === 'allumer') return estProprio(qui) && c.etat !== 'allumé' && oui(i.accord) ? `garder ${p(qui, m)} pendant ${dureeTxt(DUREES[s(i.conservation)] ?? c.conservation)} (tu confirmes que ${m.nom} est d'accord : c'est noté dans son journal)` : undefined;
    if (action === 'eteindre') { const n = compter(ctx.dir, m.id); return c.etat === 'éteint' && !n ? undefined : `éteindre ${h(qui, m)} et effacer tout ce qui est gardé (${pl(n, 'position')})`; }
    if (action === 'effacer') { const x = periode(ctx, m, c, i, now); return `effacer ${x.quoi} dans ${h(qui, m)} (${pl(compter(ctx.dir, m.id, x.de, x.a), 'position')})`; }
    if (action === 'conservation') { const j = DUREES[s(i.duree)]; if (!j || j >= c.conservation) return undefined; const n = compter(ctx.dir, m.id, 0, now - j * JOUR); return n ? `garder ${p(qui, m)} ${dureeTxt(j)} au lieu de ${dureeTxt(c.conservation)} (${pl(n, 'position plus vieille sera effacée', 'positions plus vieilles seront effacées')})` : undefined; }
    if (action === 'partage') return oui(i.visible) && !c.visible && (!estProprio(qui) || oui(i.accord)) ? (estProprio(qui) ? `voir les trajets de ${m.nom} (tu confirmes que ${m.nom} est d'accord : c'est noté dans son journal)` : 'montrer tes trajets au propriétaire d\'Odin') : undefined;
  } catch { /* la demande elle-même dira ce qui ne va pas */ }
  return undefined;
}

/**
 * Une demande, pour le propriétaire ou pour un membre. Ne lève jamais d'erreur : un refus revient en clair (`ok: false`).
 * Le texte rendu ne contient jamais de coordonnée ; les points à dessiner sont dans `data`, que seule la page lit.
 */
export async function demande(ctx: ModCtx, qui: Qui, action: string, i: Record<string, unknown> = {}): Promise<ActionResult> {
  // Logos (le mode sans IA) met parfois le prénom reconnu dans tous les réglages en texte (« efface les trajets de Nour ») :
  // ce prénom ne vaut que pour « membre ».
  const prenom = plier(s(i.membre)), propre = prenom ? Object.fromEntries(Object.entries(i).map(([k, v]) => [k, !['membre', 'nom', 'ancien'].includes(k) && typeof v === 'string' && plier(v) === prenom ? '' : v])) : i;
  try { return await faire(ctx, qui, action, propre); }
  catch (e) { return { ok: false, text: (e as Error).message }; }
}
async function faire(ctx: ModCtx, qui: Qui, action: string, i: Record<string, unknown>): Promise<ActionResult> {
  const dir = ctx.dir, now = ctx.now().getTime(), proprio = estProprio(qui);
  switch (action) {
    case 'etat': {
      const l = proprio ? membres(ctx) : [trouver(ctx, qui, '')], f = fond(ctx);
      const fiches = l.map((m) => {
        const c = choixDe(dir, m.id), vu = !proprio || c.visible, jours = vu && c.etat !== 'éteint' ? joursGardes(dir, m.id).filter((j) => debutJour(j, 1) > now - c.conservation * JOUR) : [];
        return { id: m.id, nom: m.nom, etat: c.etat, ...(c.depuis ? { depuis: dateTxt(c.depuis) } : {}), conservation: c.conservation, conservationTxt: dureeTxt(c.conservation), visible: c.visible, lisible: vu,
          journal: c.journal.slice(-30).reverse().map((n) => ({ quand: `${dateTxt(n.at)} à ${hm(n.at)}`, par: n.par, quoi: `${n.quoi}${vu && n.detail ? ` ${n.detail}` : ''}` })),
          jours: jours.slice(-14).map((j) => resumeJour(dir, m.id, c, j, now)), ...(jours.length ? { premier: jours[0], dernier: jours[jours.length - 1] } : {}), lieux: vu ? c.lieux.length : 0 };
      });
      const ligne = (x: (typeof fiches)[number]) => `- ${x.nom} : historique ${x.etat === 'pause' ? 'en pause' : x.etat}${x.etat !== 'éteint' ? `${x.depuis ? ` depuis le ${x.depuis}` : ''}, gardé ${x.conservationTxt}` : ''}, trajets visibles par ${proprio ? (x.visible ? `toi et ${x.nom}` : `${x.nom} seulement`) : (x.visible ? 'toi et le propriétaire d\'Odin' : 'toi seulement')}`;
      return { text: fiches.length ? fiches.map(ligne).join('\n') : 'Aucun membre pour l\'instant. Ajoute-en un dans Hestia (« Ajouter un membre (OwnTracks) »).',
        data: { qui: proprio ? 'proprio' : 'membre', membres: fiches, fond: { allume: f.allume, attribution: attribution(f), ...(proprio ? { serveur: f.serveur, hote: hoteDe(f.serveur) } : {}) }, aujourdhui: cleJour(now), adresse: PAGE_MEMBRES, durees: Object.keys(DUREES) } };
    }
    case 'trajets': {
      const jour = quelJour(i, now);
      // « mes trajets » dit au propriétaire, sans prénom, quand plusieurs membres lui montrent leurs trajets : une ligne pour chacun.
      if (proprio && !s(i.membre)) {
        const vus = membres(ctx).filter((m) => { const c = choixDe(dir, m.id); return c.visible && c.etat !== 'éteint'; });
        if (vus.length > 1) return { text: vus.map((m) => texteJour(m, journee(dir, m.id, choixDe(dir, m.id), jour, now)).split('\n')[0]).join('\n') };
      }
      const m = trouver(ctx, qui, i.membre, true), c = lisible(ctx, qui, m);
      if (c.etat === 'éteint') return { ok: false, text: `${H(qui, m)} est éteint : rien n'est gardé. ${proprio ? `Pour l'allumer avec l'accord de ${m.nom} : onglet Réglages.` : 'Allume-le dans l\'onglet Réglages si tu veux revoir tes trajets.'}` };
      const j = journee(dir, m.id, c, jour, now), jours = joursGardes(dir, m.id).filter((x) => debutJour(x, 1) > now - c.conservation * JOUR);
      return { text: texteJour(m, j), data: { membre: { id: m.id, nom: m.nom }, jour, libelle: jourTxt(jour), aujourdhui: cleJour(now), precedent: jours.filter((x) => x < jour).at(-1), suivant: jours.find((x) => x > jour), total: { km: km(j.metres), duree: temps(j.duree), vitesse: kmhTxt(kmh(j.metres, j.duree)), trajets: j.trajets, arrets: j.arrets, ecartes: j.ecartes }, etapes: pourPage(j) } };
    }
    case 'lieux': {
      const m = trouver(ctx, qui, i.membre, true), c = lisible(ctx, qui, m), f = frequents(dir, m.id, c, now);
      const t = f.lieux.length ? f.lieux.map((l) => `- ${l.nom} : ${pl(l.visites, 'passage')} en 60 jours (${l.duree} sur place)`).join('\n') : 'Aucun lieu nommé pour l\'instant.';
      return { text: `${proprio ? `Lieux nommés de ${m.nom}` : 'Tes lieux nommés'} :\n${t}${f.suggestions.length ? `\n${pl(f.suggestions.length, 'endroit fréquent', 'endroits fréquents')} sans nom : donne-leur un nom dans l'onglet Lieux.` : ''}`, data: { membre: { id: m.id, nom: m.nom }, lieux: f.lieux, suggestions: f.suggestions } };
    }
    case 'allumer': {
      const m = trouver(ctx, qui, i.membre), avant = choixDe(dir, m.id), j = DUREES[s(i.conservation)] ?? avant.conservation, montre = i.visible === undefined || s(i.visible) === '' ? avant.visible : oui(i.visible);
      if (avant.etat === 'allumé' && j === avant.conservation && montre === avant.visible) return { text: `${H(qui, m)} est déjà allumé (gardé ${dureeTxt(j)}).` };
      if (proprio && !oui(i.accord)) return { ok: false, text: `${H(qui, m)} ne s'allume qu'avec son accord : coche « ${m.nom} est d'accord » (ou c'est ton propre téléphone). Sans accord, rien n'est gardé.` };
      const accord = proprio ? ` Accord de ${m.nom} déclaré par le propriétaire.` : '';
      changer(dir, m.id, (c) => {
        const verbe = c.etat === 'pause' ? 'repris' : c.etat === 'éteint' ? 'allumé' : 'réglé';
        if (c.etat === 'pause' && c.pauseDepuis !== undefined) c.coupures.push([c.pauseDepuis, now]);
        if (c.etat === 'éteint') { c.depuis = now; c.coupures = []; }
        delete c.pauseDepuis;
        c.journal.push({ at: now, par: par(qui, m), quoi: `Historique ${verbe} : positions gardées ${dureeTxt(j)}.${accord}` });
        if (montre !== c.visible) c.journal.push({ at: now, par: par(qui, m), quoi: montre ? `Trajets montrés au propriétaire d'Odin.${accord}` : `Trajets visibles par ${m.nom} seulement.` });
        c.etat = 'allumé'; c.conservation = j; c.visible = montre;
      });
      return { text: proprio ? `📍 Historique de ${m.nom} allumé : ses positions sont gardées ${dureeTxt(j)}, puis effacées toutes seules. C'est noté : tu as déclaré son accord le ${dateTxt(now)}. ${m.nom} peut le mettre en pause, l'effacer ou l'éteindre à tout moment sur sa page (${PAGE_MEMBRES} sur l'adresse d'Odin).` : `📍 Ton historique est allumé : tes positions sont gardées ${dureeTxt(j)}, puis effacées toutes seules. Tu peux le mettre en pause, l'effacer ou l'éteindre à tout moment.` };
    }
    case 'pause': {
      const m = trouver(ctx, qui, i.membre), avant = choixDe(dir, m.id);
      if (avant.etat !== 'allumé') return { ok: false, text: avant.etat === 'pause' ? `${H(qui, m)} est déjà en pause.` : `${H(qui, m)} est éteint : il n'y a rien à mettre en pause.` };
      changer(dir, m.id, (c) => { c.etat = 'pause'; c.pauseDepuis = now; c.journal.push({ at: now, par: par(qui, m), quoi: 'Historique mis en pause : plus aucune position n\'est gardée.' }); });
      return { text: `⏸ ${H(qui, m)} est en pause : plus aucune position n'est gardée. Ce qui était déjà gardé reste, jusqu'à la fin de sa conservation.` };
    }
    case 'eteindre': {
      const m = trouver(ctx, qui, i.membre), avant = choixDe(dir, m.id), n = compter(dir, m.id);
      if (avant.etat === 'éteint' && !n) return { text: `${H(qui, m)} est déjà éteint : rien n'est gardé.` };
      oublier(dir, m.id);
      // Éteindre retire aussi l'accord de montrer ses trajets : si l'historique est rallumé un jour, il repart visible par le membre seul.
      changer(dir, m.id, (c) => { c.etat = 'éteint'; c.visible = false; delete c.depuis; delete c.pauseDepuis; c.coupures = []; c.journal.push({ at: now, par: par(qui, m), quoi: 'Historique éteint : tout ce qui était gardé est effacé.', ...(n ? { detail: `(${pl(n, 'position')})` } : {}) }); });
      return { text: `⏹ ${H(qui, m)} est éteint : ${n ? `${pl(n, 'position effacée', 'positions effacées')}, ` : ''}plus rien n'est gardé.` };
    }
    case 'conservation': {
      const m = trouver(ctx, qui, i.membre), avant = choixDe(dir, m.id), j = DUREES[s(i.duree)];
      if (!j) return { ok: false, text: `Durées possibles : ${Object.keys(DUREES).join(', ')}.` };
      if (j === avant.conservation) return { text: `${P(qui, m)} sont déjà gardées ${dureeTxt(j)}.` };
      if (proprio && j > avant.conservation && !oui(i.accord)) return { ok: false, text: `Garder plus longtemps les positions de ${m.nom} demande son accord : coche « ${m.nom} est d'accord » (ou c'est ton propre téléphone).` };
      changer(dir, m.id, (c) => { c.conservation = j; c.journal.push({ at: now, par: par(qui, m), quoi: `Conservation : ${dureeTxt(j)} (au lieu de ${dureeTxt(avant.conservation)}).${proprio && j > avant.conservation ? ` Accord de ${m.nom} déclaré par le propriétaire.` : ''}` }); });
      const n = balayer(dir, m.id, now);
      return { text: `🗓 ${P(qui, m)} sont gardées ${dureeTxt(j)}, puis effacées toutes seules.${n ? ` ${pl(n, 'position plus vieille vient d\'être effacée', 'positions plus vieilles viennent d\'être effacées')}.` : ''}` };
    }
    case 'partage': {
      const m = trouver(ctx, qui, i.membre), avant = choixDe(dir, m.id), montre = oui(i.visible);
      if (montre === avant.visible) return { text: proprio ? (montre ? `Tu vois déjà les trajets de ${m.nom}.` : `Les trajets de ${m.nom} ne sont déjà visibles que par ${m.nom}.`) : (montre ? 'Le propriétaire d\'Odin voit déjà tes trajets.' : 'Tes trajets ne sont déjà visibles que par toi.') };
      if (proprio && montre && !oui(i.accord)) return { ok: false, text: `Voir les trajets de ${m.nom} demande son accord : coche « ${m.nom} est d'accord » (ou c'est ton propre téléphone).` };
      changer(dir, m.id, (c) => { c.visible = montre; c.journal.push({ at: now, par: par(qui, m), quoi: montre ? `Trajets montrés au propriétaire d'Odin.${proprio ? ` Accord de ${m.nom} déclaré par le propriétaire.` : ''}` : `Trajets visibles par ${m.nom} seulement.` }); });
      return { text: proprio ? (montre ? `👁 Tu peux maintenant voir les trajets de ${m.nom}. C'est noté : tu as déclaré son accord le ${dateTxt(now)}. ${m.nom} peut l'arrêter à tout moment sur sa page (${PAGE_MEMBRES} sur l'adresse d'Odin).` : `🔒 Les trajets de ${m.nom} ne sont plus visibles que par ${m.nom}.`) : (montre ? '👁 Le propriétaire d\'Odin peut maintenant voir tes trajets. Tu peux l\'arrêter à tout moment.' : '🔒 Tes trajets ne sont plus visibles que par toi.') };
    }
    case 'effacer': {
      const m = trouver(ctx, qui, i.membre), c = choixDe(dir, m.id), x = periode(ctx, m, c, i, now);
      const n = x.tout ? compter(dir, m.id) : effacer(dir, m.id, x.de, x.a);
      if (x.tout) oublier(dir, m.id);
      changer(dir, m.id, (k) => {
        // Rien de ce qui a été pris avant cet effacement ne sera gardé plus tard (un téléphone resté sans réseau envoie en retard).
        if (x.tout) { k.coupures = []; if (k.etat !== 'éteint') k.depuis = now; if (k.etat === 'pause') k.pauseDepuis = now; } else k.coupures.push([x.de, x.a]);
        k.journal.push({ at: now, par: par(qui, m), quoi: `Effacé : ${x.court}.`, detail: `(${x.quoi}, ${pl(n, 'position')})` });
      });
      return { text: `🗑 ${pl(n, 'position effacée', 'positions effacées')} dans ${h(qui, m)} : ${x.quoi}.` };
    }
    case 'nommer_lieu': {
      const m = trouver(ctx, qui, i.membre), c = lisible(ctx, qui, m), nom = s(i.nom).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!nom) return { ok: false, text: 'Donne un nom au lieu (« Maison », « Bureau »…).' };
      const rayon = Math.max(50, Math.min(1000, Math.round(Number(i.rayon) || 150)));
      if (s(i.ancien)) {
        const ancien = c.lieux.find((l) => l.id === s(i.ancien) || plier(l.nom) === plier(s(i.ancien)));
        if (!ancien) return { ok: false, text: `Je ne connais pas de lieu « ${s(i.ancien).slice(0, 40)} ».` };
        if (c.lieux.some((l) => l.id !== ancien.id && plier(l.nom) === plier(nom))) return { ok: false, text: `Un autre lieu s'appelle déjà « ${nom} ».` };
        changer(dir, m.id, (k) => { k.lieux = k.lieux.map((l) => (l.id === ancien.id ? { ...l, nom, ...(s(i.rayon) ? { rayon } : {}) } : l)); });
        return { text: `📌 « ${ancien.nom} » s'appelle maintenant « ${nom} ».` };
      }
      if (c.lieux.some((l) => plier(l.nom) === plier(nom))) return { ok: false, text: `Un lieu s'appelle déjà « ${nom} ». Choisis un autre nom, ou retire l'ancien.` };
      const hh = /^(\d{1,2})[:h](\d{2})$/.exec(s(i.heure));
      if (!hh || Number(hh[1]) > 23 || Number(hh[2]) > 59) return { ok: false, text: 'Dis où : le jour et l\'heure d\'un arrêt à cet endroit (2026-11-12 à 08:30). Le plus simple : le bouton « Nommer » d\'un arrêt, dans l\'onglet Trajets.' };
      const jour = quelJour(i, now), [y, mo, d] = jour.split('-').map(Number), t = new Date(y, mo - 1, d, Number(hh[1]), Number(hh[2]), 30).getTime(), ecart = (e: ArretJ) => Math.max(0, e.debut - t, t - e.fin);
      const arret = journee(dir, m.id, c, jour, now).etapes.filter((e): e is ArretJ => e.genre === 'arret').sort((e, f) => ecart(e) - ecart(f))[0];
      if (!arret || ecart(arret) > 5 * 60_000) return { ok: false, text: `Je ne trouve pas d'arrêt le ${jourTxt(jour)} à ${s(i.heure)}. Regarde les arrêts du jour dans l'onglet Trajets.` };
      if (c.lieux.length >= 40) return { ok: false, text: '40 lieux nommés au plus : retire-en un avant d\'en ajouter.' };
      changer(dir, m.id, (k) => { k.lieux.push({ id: Math.random().toString(36).slice(2, 10), nom, lat: arret.lat, lon: arret.lon, rayon }); });
      return { text: `📌 « ${nom} » : ce lieu est nommé (dans un rayon de ${rayon} m). Les arrêts à cet endroit porteront ce nom.` };
    }
    case 'retirer_lieu': {
      const m = trouver(ctx, qui, i.membre), c = lisible(ctx, qui, m), l = c.lieux.find((x) => x.id === s(i.nom) || plier(x.nom) === plier(s(i.nom)));
      if (!l) return { ok: false, text: `Je ne connais pas de lieu « ${s(i.nom).slice(0, 40)} ».` };
      changer(dir, m.id, (k) => { k.lieux = k.lieux.filter((x) => x.id !== l.id); });
      return { text: `Lieu « ${l.nom} » retiré. Les trajets ne changent pas.` };
    }
    case 'exporter': {
      const m = trouver(ctx, qui, i.membre, true), c = lisible(ctx, qui, m);
      if (c.etat === 'éteint') return { ok: false, text: `${H(qui, m)} est éteint : il n'y a rien à exporter.` };
      const du = quelJour(i, now), au = s(i.au) ? quelJour({ jour: i.au }, now) : du, n = Number(i.trajet);
      if (au < du) return { ok: false, text: 'La fin de la période est avant son début.' };
      if ((debutJour(au) - debutJour(du)) / JOUR > 366) return { ok: false, text: 'Un an au plus par fichier : exporte en plusieurs fois.' };
      const trajets: Array<{ nom: string; points: Pt[] }> = [], arrets = new Map<number, { nom: string; lat: number; lon: number; debut: number }>();
      for (let k = du; k <= au; k = cleJour(debutJour(k, 1))) {
        for (const e of journee(dir, m.id, c, k, now).etapes) {
          if (e.genre === 'trajet' && (!s(i.trajet) || e.n === n)) trajets.push({ nom: `${k} ${hm(e.debut)} → ${hm(e.fin)}${e.de || e.vers ? ` · ${e.de ?? '?'} → ${e.vers ?? '?'}` : ''}`, points: e.points });
          if (e.genre === 'arret' && !s(i.trajet)) arrets.set(e.debut, { nom: e.lieu ?? `Arrêt ${hm(e.debut)}`, lat: e.lat, lon: e.lon, debut: e.debut });
        }
      }
      if (!trajets.length) return { ok: false, text: s(i.trajet) ? `Il n'y a pas de trajet n° ${s(i.trajet).slice(0, 6)} le ${jourTxt(du)}.` : `Aucun trajet ${du === au ? `le ${jourTxt(du)}` : `du ${jourTxt(du)} au ${jourTxt(au)}`} : rien à exporter.` };
      const nom = `trajets-${plier(m.nom).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'membre'}-${du}${au !== du ? `_${au}` : ''}${s(i.trajet) ? `-trajet-${n}` : ''}.gpx`;
      const ref = deposer(dir, m.id, nom, gpx({ nom: `Trajets de ${m.nom} · ${du === au ? du : `${du} → ${au}`}`, cree: now, trajets, arrets: [...arrets.values()] }));
      return { text: `📦 Fichier GPX prêt : ${pl(trajets.length, 'trajet')}, ${pl(trajets.reduce((x, t) => x + t.points.length, 0), 'point')}${arrets.size ? `, ${pl(arrets.size, 'arrêt')}` : ''}. Tu as une heure pour le télécharger ; ensuite Odin l'efface.`, fichiers: [{ nom, ref }] };
    }
    case 'fond_de_carte': {
      if (!proprio) return { ok: false, text: 'Le fond de carte en ligne se règle dans Odin, par son propriétaire.' };
      // Sans rien demander de précis (« fond de carte »), on dit seulement où on en est : rien ne change.
      if (i.allume === undefined && !s(i.serveur)) { const f = fond(ctx); return { text: f.allume ? `Le fond de carte en ligne est allumé (${hoteDe(f.serveur)}) : ce serveur voit l'adresse d'Odin et la zone regardée, jamais les points ni les trajets.` : 'Le fond de carte en ligne est éteint : la carte est dessinée par Odin seul. Il s\'allume dans l\'onglet Réglages d\'Ulysse.' }; }
      const veut = i.allume === undefined ? fond(ctx).allume : oui(i.allume), serveur = s(i.serveur) || fond(ctx).serveur;
      if (!serveurValide(serveur)) return { ok: false, text: 'L\'adresse du serveur du fond de carte doit commencer par https:// et contenir {z}, {x} et {y}, comme https://tile.openstreetmap.org/{z}/{x}/{y}.png' };
      ctx.saveSettings({ fond: { allume: veut, serveur } });
      return { text: veut ? `🗺 Fond de carte en ligne allumé : pour dessiner le fond, Odin demande à ${hoteDe(serveur)} les images de la zone regardée, et les garde 7 jours. Ce serveur voit l'adresse d'Odin et la zone, jamais les points ni les trajets.` : '🗺 Fond de carte en ligne éteint : la carte est dessinée par Odin seul, sans rien demander à Internet.' };
    }
    case 'tuile': return { text: 'Image du fond de carte.', data: { image: await tuile(ctx, Number(i.z), Number(i.x), Number(i.y)) } };
    default: return { ok: false, text: 'Demande inconnue.' };
  }
}

/** Le ménage : conservation de chacun, membres retirés de Hestia, fichiers préparés, vieilles images du fond de carte. */
export function menage(ctx: ModCtx): void {
  const now = ctx.now().getTime(), connus = famille(join(ctx.dir, '..', 'gladsheim'));
  // Si la liste des membres de Hestia est illisible, on ne touche à rien : on n'efface jamais l'historique de quelqu'un par erreur.
  const ids = connus ? new Set(connus.map((m) => m.id)) : undefined;
  for (const id of membresConnus(ctx.dir)) { if (!ids || ids.has(id)) balayer(ctx.dir, id, now); else oublier(ctx.dir, id, true); }
  menageExports(ctx.dir, now); menageTuiles(ctx.dir, now);
}

const MEMBRE: Param = { key: 'membre', label: 'Membre (prénom)', kind: 'text', required: true };
const ACCORD: Param = { key: 'accord', label: 'Accord : il ou elle est d\'accord (ou c\'est mon téléphone)', kind: 'boolean', default: false };
const act = (id: string) => (ctx: ModCtx, i: Record<string, unknown>) => demande(ctx, PROPRIO, id, i);
const grave = (id: string) => (i: Record<string, unknown>, ctx?: ModCtx) => gravite(ctx, PROPRIO, id, i);

export const gna: Module = {
  id: 'gna', name: 'Ulysse', family: 'Maison',
  what: 'Les trajets de la famille : l\'historique des positions des téléphones, que chaque membre allume, met en pause ou efface lui-même, découpé en trajets et en arrêts, et dessiné sur une carte. Rien ne sort d\'Odin.',
  does: ['historique éteint au départ : chaque membre l\'allume, le met en pause ou l\'efface (tout, une période, un trajet) quand il veut, sur sa page (/trajets) avec ses identifiants OwnTracks', 'le propriétaire peut le régler pour un membre en déclarant son accord : c\'est noté dans le journal du membre, qui peut tout arrêter', 'durée de conservation au choix (30 jours, 90 jours, 1 an) : les vieilles positions sont effacées toutes seules', 'trajets et arrêts par jour : distance, durée, vitesse moyenne ; points aberrants écartés ; ce qui est estimé est dit', 'lieux fréquents nommés par le membre (« Maison », « Bureau »), sans service extérieur', 'carte dessinée par Odin (tracé à l\'échelle, départ, arrivée, arrêts), lien « ouvrir dans OpenStreetMap » pour un point', 'fond de carte en ligne éteint au départ (les images demandées révèlent la zone regardée)', 'export d\'un trajet, d\'un jour ou d\'une période en GPX', 'un membre ne voit que ses trajets ; le propriétaire ne voit ceux d\'un membre que si ce membre l\'a accepté ; aucune position dans une alerte ni dans le texte donné à l\'IA'],
  from: ['Dawarich', 'OwnTracks Recorder'], upstream: ['Freika/dawarich', 'owntracks/recorder'],
  words: ['trajets', 'mes trajets', 'carte des trajets', 'historique des trajets', 'historique des positions', 'historique de position', 'lieux fréquents', 'lieux frequents'],
  actions: [
    { id: 'trajets', label: 'Trajets d\'un jour', what: 'Les trajets et les arrêts d\'un jour : heures, distance, durée, vitesse, lieux nommés (jamais de coordonnée dans le texte)', read: true, quick: false, external: true, words: ['mes trajets', 'trajets d\'hier', 'trajets du jour', 'trajets d\'aujourd\'hui', 'ou suis-je alle', 'où suis-je allé'],
      params: [{ key: 'membre', label: 'Membre (prénom ; vide : celui qui te montre ses trajets)', kind: 'text', default: '' }, { key: 'jour', label: 'Jour', kind: 'select', options: ['aujourd\'hui', 'hier', 'avant-hier'], default: 'aujourd\'hui' }, { key: 'date', label: 'Ou une date (2026-11-12)', kind: 'text', default: '' }], run: act('trajets') },
    { id: 'etat', label: 'Historique de chacun', what: 'Qui garde son historique (éteint, allumé, en pause), combien de temps, et qui te montre ses trajets', read: true, quick: false, words: ['historique des trajets', 'historique des positions', 'qui garde son historique'], run: act('etat') },
    { id: 'lieux', label: 'Lieux fréquents', what: 'Les lieux nommés d\'un membre et le nombre de passages (jamais de coordonnée dans le texte)', read: true, quick: false, external: true, words: ['lieux fréquents', 'lieux frequents'], params: [{ key: 'membre', label: 'Membre (prénom ; vide : celui qui te montre ses trajets)', kind: 'text', default: '' }], run: act('lieux') },
    { id: 'allumer', label: 'Allumer l\'historique', what: 'Garde les positions d\'un membre, avec son accord (noté dans son journal). Sans accord, rien n\'est gardé.', quick: false, words: ['allume l\'historique des trajets', 'garde les trajets'],
      params: [MEMBRE, ACCORD, { key: 'conservation', label: 'Gardées pendant', kind: 'select', options: Object.keys(DUREES), default: '90 jours' }, { key: 'visible', label: 'Je peux voir ses trajets', kind: 'boolean', default: false }], grave: grave('allumer'), run: act('allumer') },
    { id: 'pause', label: 'Mettre l\'historique en pause', what: 'Plus aucune position n\'est gardée ; ce qui l\'était reste jusqu\'à la fin de sa conservation', quick: false, words: ['mets en pause l\'historique des trajets'], params: [MEMBRE], run: act('pause') },
    { id: 'eteindre', label: 'Éteindre l\'historique', what: 'Arrête de garder les positions d\'un membre et efface tout ce qui était gardé', quick: false, words: ['eteins l\'historique des trajets', 'éteins l\'historique des trajets'], params: [MEMBRE], grave: grave('eteindre'), run: act('eteindre') },
    { id: 'conservation', label: 'Durée de conservation', what: 'Combien de temps les positions d\'un membre sont gardées avant d\'être effacées toutes seules', quick: false, params: [MEMBRE, { key: 'duree', label: 'Gardées pendant', kind: 'select', options: Object.keys(DUREES), required: true }, ACCORD], grave: grave('conservation'), run: act('conservation') },
    { id: 'partage', label: 'Voir les trajets d\'un membre', what: 'Un membre accepte (ou non) que le propriétaire d\'Odin voie ses trajets ; son accord est noté', quick: false, params: [MEMBRE, { key: 'visible', label: 'Je peux voir ses trajets', kind: 'boolean', default: true }, ACCORD], grave: grave('partage'), run: act('partage') },
    { id: 'effacer', label: 'Effacer des trajets', what: 'Efface l\'historique d\'un membre : tout, des jours entiers, ou un seul trajet', quick: false, words: ['efface les trajets', 'efface l\'historique des trajets'],
      params: [MEMBRE, { key: 'du', label: 'Du (2026-11-01 ; « du » et « au » vides : tout)', kind: 'text', default: '' }, { key: 'au', label: 'Au (2026-11-05)', kind: 'text', default: '' }, { key: 'trajet', label: 'Ou un seul trajet du jour « du » (son numéro)', kind: 'number' }], grave: grave('effacer'), run: act('effacer') },
    { id: 'nommer_lieu', label: 'Nommer un lieu', what: 'Donne un nom (« Maison », « Bureau ») à l\'endroit d\'un arrêt : les arrêts à cet endroit porteront ce nom', quick: false, words: ['nomme ce lieu', 'nomme le lieu'],
      params: [MEMBRE, { key: 'nom', label: 'Nom du lieu', kind: 'text', required: true }, { key: 'jour', label: 'Jour d\'un arrêt à cet endroit (2026-11-12)', kind: 'text', default: '' }, { key: 'heure', label: 'Heure pendant cet arrêt (08:30)', kind: 'text', default: '' }, { key: 'rayon', label: 'Rayon (mètres)', kind: 'number', default: 150 }, { key: 'ancien', label: 'Ou renommer ce lieu (son nom actuel)', kind: 'text', default: '' }], run: act('nommer_lieu') },
    { id: 'retirer_lieu', label: 'Retirer un lieu', what: 'Retire le nom d\'un lieu (les trajets ne changent pas)', quick: false, params: [MEMBRE, { key: 'nom', label: 'Nom du lieu', kind: 'text', required: true }], run: act('retirer_lieu') },
    { id: 'exporter', label: 'Exporter en GPX', what: 'Prépare un fichier GPX (le format des GPS) : un trajet, un jour ou une période. Le fichier se télécharge dans la page.', quick: false, words: ['exporte en gpx', 'export gpx', 'exporte les trajets'],
      params: [MEMBRE, { key: 'jour', label: 'Jour (2026-11-12 ; vide : aujourd\'hui)', kind: 'text', default: '' }, { key: 'au', label: 'Jusqu\'au (pour une période)', kind: 'text', default: '' }, { key: 'trajet', label: 'Un seul trajet (son numéro dans le jour)', kind: 'number' }], run: act('exporter') },
    { id: 'fond_de_carte', label: 'Fond de carte en ligne', what: 'Affiche (ou non) un fond de carte venu d\'Internet sous les trajets. Éteint au départ : les images demandées révèlent la zone regardée.', quick: false,
      params: [{ key: 'allume', label: 'Allumé', kind: 'boolean' }, { key: 'serveur', label: 'Serveur des images (vide : OpenStreetMap)', kind: 'text', default: '', help: 'Ton propre serveur si tu en as un : https://…/{z}/{x}/{y}.png' }], grave: grave('fond_de_carte'), run: act('fond_de_carte') },
    { id: 'tuile', label: 'Image du fond de carte', what: 'Une image du fond de carte, pour la page (seulement si le fond en ligne est allumé)', read: true, quiet: true, quick: false, params: [{ key: 'z', label: 'Zoom', kind: 'number', required: true }, { key: 'x', label: 'Colonne', kind: 'number', required: true }, { key: 'y', label: 'Ligne', kind: 'number', required: true }], run: act('tuile') },
  ],
  retrait: (ctx, ref) => retrouver(ctx.dir, ref),
  start(ctx) { try { menage(ctx); } catch { /* le ménage repassera */ } },
  watch: { every: 900, run(ctx) {
    menage(ctx);
    // Un souci d'écriture ou de lecture : une alerte, sans aucune position.
    const x = souci(ctx.dir, true);
    if (x) ctx.alert({ level: 'haute', title: 'Trajets : l\'historique n\'est plus gardé comme prévu', detail: `Odin a un souci avec le dossier des trajets : ${x.quoi}. Tant que ce n'est pas réglé, des positions peuvent ne pas être gardées.`, key: 'gna-dossier', steps: ['Ouvre Hygie : reste-t-il de la place sur le disque ?', 'Ouvre Ulysse, onglet Réglages : l\'historique de chaque membre est-il toujours comme il l\'a choisi ?', 'Si un historique est repassé à « éteint », son membre le rallume lui-même (ou toi, avec son accord).'] });
  } },
  view(ctx) {
    const l = membres(ctx), cs = l.map((m) => ({ m, c: choixDe(ctx.dir, m.id) })), f = fond(ctx);
    const sections: Section[] = [
      { kind: 'text', title: 'Trajets', onglet: 'Trajets', text: 'Les trajets, les arrêts et la carte se regardent dans la page d\'Ulysse. Tu peux aussi demander « mes trajets » ou « trajets d\'hier ».' },
      { kind: 'text', title: 'Lieux', onglet: 'Lieux', text: 'Chaque membre nomme ses lieux fréquents (« Maison », « Bureau ») : les arrêts à cet endroit portent alors ce nom. Aucun service extérieur ne cherche les adresses.' },
      { kind: 'table', title: 'Historique de chacun', onglet: 'Réglages', columns: ['Membre', 'Historique', 'Gardé', 'Trajets visibles par'], empty: 'Aucun membre : ajoute-en un dans Hestia (« Ajouter un membre (OwnTracks) »).',
        rows: cs.map(({ m, c }) => ({ cells: [m.nom, c.etat === 'pause' ? 'en pause' : c.etat, c.etat === 'éteint' ? 'rien' : dureeTxt(c.conservation), c.visible ? `toi et ${m.nom}` : `${m.nom} seulement`], tone: c.etat === 'allumé' ? 'bon' as const : undefined, actions: c.etat === 'allumé' ? [{ action: 'pause', label: 'Mettre en pause', input: { membre: m.nom } }] : [] })) },
      { kind: 'text', title: 'Vie privée', onglet: 'Réglages', text: `Chaque membre décide pour lui, sur sa page (${PAGE_MEMBRES} sur l'adresse d'Odin, avec ses identifiants OwnTracks). Les positions restent sur la machine d'Odin : elles ne vont ni dans une alerte, ni dans le texte donné à l'IA. Fond de carte en ligne : ${f.allume ? `allumé (${hoteDe(f.serveur)})` : 'éteint'}.` },
    ];
    return {
      subtitle: `${pl(l.length, 'membre')} · ${pl(cs.filter((x) => x.c.etat === 'allumé').length, 'historique allumé', 'historiques allumés')} · rien ne sort d'Odin`,
      kpis: [{ label: 'Membres', value: String(l.length) }, { label: 'Historiques allumés', value: String(cs.filter((x) => x.c.etat === 'allumé').length) }, { label: 'En pause', value: String(cs.filter((x) => x.c.etat === 'pause').length) }, { label: 'Fond de carte', value: f.allume ? 'en ligne' : 'éteint' }],
      onglets: ['Trajets', 'Lieux', 'Réglages'], sections,
    };
  },
};
