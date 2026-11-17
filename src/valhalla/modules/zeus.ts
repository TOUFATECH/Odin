// Zeus (identifiant « zeus ») — la météo comparée. Plusieurs sources côte à côte (Open-Meteo et ses modèles :
// Centre européen, Météo-France, DWD ICON, NOAA GFS), le modèle de recherche STRATA de NVIDIA quand un serveur
// avec carte NVIDIA est branché, un verdict par jour (vert « OK », jaune « Diffère », rouge « Souci », toujours avec
// son mot), le bilan « qui avait vu juste » d'après le temps mesuré, et les 1, 2, 3 prochains mois.
// La page MONTRE TOUJOURS LES SOURCES. Rien n'est inventé : une source muette ou qui ne prévoit pas si loin le dit.
// Le lieu vient du lieu d'Odin (Hestia, chiffré) ; Zeus ne garde jamais ni le nom du lieu, ni sa position.
// Le travail est dans `src/valhalla/zeus/` : sources.ts (adresses, modèles), comparer.ts (seuils, verdicts),
// strata.ts (contrat du serveur STRATA), saisonnier.ts (mois), bilan.ts (journal et scores).

import type { ActionResult, ModCtx, Module, RythmeAppli, Section, TacheAppli, Tone } from '../types.ts';
import { lieuCourant } from '../lieu.ts';
import { tacheEnPause } from '../automatismes.ts';
import { fuseauOdin, lireRythme, murale, phrase, prochaine, verifierRythme, type Rythme } from '../../draupnir/rythme.ts';
import { adressesDe, LIGNE_SOURCES, lireJours, lireMultiModeles, MODELES, modele, modelesChoisis, REFERENCE, urlArchive, urlPrevisions, urlSaisonMois, urlSaisonSemaines, type JourValeurs, type Point, type Valeurs } from '../zeus/sources.ts';
import { COURT_GRANDEUR, GRANDEURS, MOT, NOM_GRANDEUR, PHRASE_VERT, pire, TON, valeurTexte, verdictDuJour, verdictGrandeur, type Couleur, type Prediction, type Verdict } from '../zeus/comparer.ts';
import { adresseStrataValide, etat as etatStrata, PAS_DE_SERVEUR, PAS_SI_LOIN, PLUS_INTERROGE } from '../zeus/strata.ts';
import { lignesMois, lireEc46, lireSeas5, moisAVenir, type AnomalieMois, type AnomalieSemaine, type LigneMois } from '../zeus/saisonnier.ts';
import { bilan as calculerBilan, decaler, empreinteLieu, journal, type Entree } from '../zeus/bilan.ts';

const s = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)).trim();
export const REGLE_LIEU = 'Règle d\'abord le lieu dans Hestia';
export const TEXTE_REFERENCE = 'Information récupérée : Open-Meteo, meilleur modèle pour ce lieu';
export const TEXTE_MESURE = 'Mesure : archive Open-Meteo (réanalyse ERA5 et analyse ECMWF), pas une station ; elle vient du même centre que deux des modèles comparés';
const COURT_STRATA = 'STRATA';

// ---------------- Le lieu (jamais gardé par Zeus) ----------------
export interface LieuZeus extends Point { nom: string; fuseau: string }
export function lieuZeus(): LieuZeus | undefined {
  const l = lieuCourant();
  if (!l || typeof l.lat !== 'number' || typeof l.lon !== 'number' || !Number.isFinite(l.lat) || !Number.isFinite(l.lon)) return undefined;
  return { nom: l.nom, lat: l.lat, lon: l.lon, fuseau: fuseauOdin(l.fuseau) };
}
const aujourdhui = (now: Date, fuseau: string) => { const m = murale(now.getTime(), fuseau); return `${m.y}-${String(m.mo).padStart(2, '0')}-${String(m.d).padStart(2, '0')}`; };

// ---------------- Les prévisions comparées (en mémoire, 30 minutes) ----------------
export interface Comparaison { at: number; cle: string; modeles: string[]; parModele: Record<string, JourValeurs[]>; pannes: string[]; jours: string[] }
const cache = new Map<string, Comparaison>();
const cacheSaison = new Map<string, { at: number; cle: string; seas5: AnomalieMois[] | 'panne'; ec46: AnomalieSemaine[] | 'panne' }>();

async function json(ctx: ModCtx, url: string, ms = 15_000): Promise<unknown> {
  const r = await ctx.fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`réponse ${r.status}`);
  return await r.json();
}
/** Les prévisions de chaque modèle choisi. Une seule question à Open-Meteo ; si elle échoue, une par modèle, pour savoir lequel est en panne. */
export async function comparaison(ctx: ModCtx, lieu: LieuZeus, frais = false): Promise<Comparaison> {
  const modeles = modelesChoisis(ctx.settings.modeles), a = adressesDe(ctx.settings);
  const cle = `${a.previsions}|${lieu.lat}|${lieu.lon}|${modeles.join(',')}`, c = cache.get(ctx.dir);
  if (!frais && c && c.cle === cle && Date.now() - c.at < 30 * 60_000) return c;
  let parModele: Record<string, JourValeurs[]> = {}; const pannes: string[] = [];
  try { parModele = lireMultiModeles(await json(ctx, urlPrevisions(a.previsions, lieu, modeles)), modeles); }
  catch {
    const l = await Promise.all(modeles.map(async (m) => { try { return [m, lireMultiModeles(await json(ctx, urlPrevisions(a.previsions, lieu, [m])), [m])[m]] as const; } catch { return [m, undefined] as const; } }));
    for (const [m, v] of l) if (v) parModele[m] = v;
  }
  for (const m of modeles) if (!parModele[m]) pannes.push(m);
  const jours = (parModele[REFERENCE] ?? Object.values(parModele)[0] ?? []).map((x) => x.jour);
  const r: Comparaison = { at: Date.now(), cle, modeles, parModele, pannes, jours };
  cache.set(ctx.dir, r);
  return r;
}
const vide: Valeurs = { tmax: null, tmin: null, pluie: null, vent: null };
const valeursDe = (c: Comparaison, m: string, jour: string): Valeurs | undefined => { const x = c.parModele[m]?.find((y) => y.jour === jour); return x ? { tmax: x.tmax, tmin: x.tmin, pluie: x.pluie, vent: x.vent } : undefined; };

// ---------------- STRATA : plus interrogé depuis le 17/11/2026 (un modèle qui n'est pas celui d'Odin) ----------------
// Il ne reste que la ligne grise qui le dit ; une ancienne réponse gardée n'est plus lue ni comparée.
interface StrataGarde { at: string; ok: false; couleur: 'gris'; texte: string }
const adresseStrata = (ctx: ModCtx) => s(ctx.settings.strata);
const strataGarde = (ctx: ModCtx): StrataGarde | undefined => { const g = ctx.settings.strataDernier; return g && typeof g === 'object' && !(g as { ok?: unknown }).ok && typeof (g as { texte?: unknown }).texte === 'string' ? g as StrataGarde : undefined; };
/** La ligne STRATA, toujours grise : « Non branché » sans réglage, sinon la raison pour laquelle il n'est plus interrogé. */
export function ligneStrata(ctx: ModCtx): { titre: string; detail: string; tone: Tone; mot: string } {
  if (!adresseStrata(ctx)) return { titre: 'STRATA · Non branché', detail: PAS_DE_SERVEUR, tone: 'neutre', mot: 'Non branché' };
  return { titre: 'STRATA · —', detail: strataGarde(ctx)?.texte ?? PLUS_INTERROGE, tone: 'neutre', mot: '—' };
}
/** Ce qu'il y a à dire de STRATA : rien n'est demandé au serveur, la réponse gardée dit seulement pourquoi. */
async function interrogerStrata(ctx: ModCtx): Promise<StrataGarde> {
  const e = await etatStrata(ctx.fetch, adresseStrata(ctx));
  const g: StrataGarde = { at: ctx.now().toISOString(), ok: false, couleur: e.couleur, texte: e.texte };
  ctx.saveSettings({ strataDernier: g });
  return g;
}

// ---------------- Les verdicts du jour ----------------
export interface JourCompare { jour: string; ref: Valeurs | null; preds: Prediction[]; verdict: Verdict & { details: unknown[] } }
const court = (m: string) => modele(m)?.court ?? m;
export function joursCompares(ctx: ModCtx, c: Comparaison, n: number): JourCompare[] {
  const refPanne = c.pannes.includes(REFERENCE);
  return c.jours.slice(0, n).map((jour) => {
    const ref = refPanne ? null : valeursDe(c, REFERENCE, jour) ?? vide;
    const preds: Prediction[] = c.modeles.filter((m) => m !== REFERENCE).map((m) => (c.pannes.includes(m) ? { source: court(m), panne: true } : { source: court(m), valeurs: valeursDe(c, m, jour) ?? null }));
    return { jour, ref, preds, verdict: verdictDuJour(ref, preds) };
  });
}
const nomJour = (jour: string) => new Date(`${jour}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const nombre = (g: keyof Valeurs, v: number | null | undefined) => (v === null || v === undefined ? '—' : g === 'pluie' ? String(Math.round(v * 10) / 10).replace('.', ',') : String(Math.round(v)));
function lignesTableau(ctx: ModCtx, j: JourCompare): Array<{ cells: string[]; tone?: Tone }> {
  return GRANDEURS.map((g) => {
    const preds = j.preds.map((p) => `${p.source} ${p.panne ? '✗' : nombre(g, p.valeurs?.[g])}${p.nonComptees?.includes(g) ? ' (approché)' : ''}`);
    if (!j.preds.some((p) => p.source === COURT_STRATA)) preds.push(`${COURT_STRATA} —`);
    const couleurs: Couleur[] = j.ref === null ? ['rouge'] : j.preds.map((p) => (p.panne ? 'rouge' : p.nonComptees?.includes(g) ? 'gris' : verdictGrandeur(g, j.ref?.[g], p.valeurs?.[g], p.source).couleur));
    const c = pire(couleurs);
    return { cells: [nomJour(j.jour), COURT_GRANDEUR[g], MOT[c], j.ref ? valeurTexte(g, j.ref[g]) : '✗', preds.join(' · ')], tone: TON[c] };
  });
}
/** La tuile STRATA du verdict (grise « Non branché » sans serveur, jamais verte sans réponse). */
const tuileStrata = (st: { titre: string; detail: string; mot: string; tone: Tone }) => ({ title: st.titre.split(' · ')[0], badge: st.mot, sub: st.detail, tone: st.tone });
function texteJours(l: JourCompare[]): string {
  return l.map((j) => `${j.verdict.couleur === 'vert' ? '🟢' : j.verdict.couleur === 'jaune' ? '🟡' : j.verdict.couleur === 'rouge' ? '🔴' : '⚪'} ${nomJour(j.jour)} · ${j.verdict.mot} · ${j.verdict.phrase}`).join('\n');
}

// ---------------- Le relevé et la mesure (tâches de Talos) ----------------
interface Passage { at: string; ok: boolean; texte: string }
const NOMS_SOURCES = (id: string) => (id === 'strata' ? 'STRATA' : modele(id)?.nom ?? id);
function noterPannes(ctx: ModCtx, jour: string, enPanne: string[], repondu: string[]): void {
  const p = { ...((ctx.settings.pannes as Record<string, { n: number; jour: string }> | undefined) ?? {}) };
  for (const src of repondu) delete p[src];
  for (const src of enPanne) {
    const x = p[src];
    if (x?.jour === jour) continue;
    const n = x && x.jour === decaler(jour, -1) ? x.n + 1 : 1;
    p[src] = { n, jour };
    if (n === 3) {
      ctx.emit('source_en_panne', { source: src, nom: NOMS_SOURCES(src), jours: n });
      ctx.alert({ level: 'moyenne', title: `Zeus : ${NOMS_SOURCES(src)} ne répond plus depuis 3 jours`, detail: 'Ses prédictions ne sont plus comparées ni comptées dans le bilan tant qu\'elle reste muette.', key: `zeus:panne:${src}` });
    }
  }
  ctx.saveSettings({ pannes: p });
}
/** Garde ce que chaque source prévoit pour J+1 à J+3 (sans nom ni position du lieu). */
export async function releverPrevisions(ctx: ModCtx, lieu: LieuZeus): Promise<ActionResult> {
  const c = await comparaison(ctx, lieu, true), auj = aujourdhui(ctx.now(), lieu.fuseau), at = ctx.now().toISOString(), lieuH = empreinteLieu(ctx, lieu), j = journal(ctx);
  let n = 0;
  const garder = (src: string, jour: string, v: Valeurs) => {
    const ech = Math.round((Date.parse(`${jour}T12:00:00Z`) - Date.parse(`${auj}T12:00:00Z`)) / 86_400_000);
    if (ech < 1 || ech > 3 || [v.tmax, v.tmin, v.pluie, v.vent].every((x) => x === null)) return;
    j.ajouter({ t: 'prevu', at, jour, src, ech, tmax: v.tmax, tmin: v.tmin, pluie: v.pluie, vent: v.vent, lieu: lieuH }); n++;
  };
  for (const m of c.modeles) if (!c.pannes.includes(m)) for (let k = 1; k <= 3; k++) { const jour = decaler(auj, k), v = valeursDe(c, m, jour); if (v) garder(m, jour, v); }
  const pannes = [...c.pannes], repondu = c.modeles.filter((m) => !c.pannes.includes(m));
  let strata = '';
  if (adresseStrata(ctx)) {
    strata = ` · ${(await interrogerStrata(ctx)).texte}`;
  }
  noterPannes(ctx, auj, pannes, repondu);
  const texte = `🌦 Relevé : ${n} prédiction(s) gardée(s) pour J+1 à J+3${pannes.length ? ` · sans réponse : ${pannes.map(NOMS_SOURCES).join(', ')}` : ''}${strata}.`;
  const ok = !c.pannes.includes(REFERENCE);
  ctx.saveSettings({ dernierReleve: { at, ok, texte } satisfies Passage });
  ctx.emit('releve', { gardees: n, pannes: pannes.length });
  return { ok, text: texte };
}
/** Lit le temps mesuré des 7 derniers jours (archive Open-Meteo) et le garde à côté des prédictions. */
export async function lireMesures(ctx: ModCtx, lieu: LieuZeus): Promise<ActionResult> {
  const auj = aujourdhui(ctx.now(), lieu.fuseau), at = ctx.now().toISOString(), a = adressesDe(ctx.settings);
  let jours: JourValeurs[];
  try { jours = lireJours(await json(ctx, urlArchive(a.archive, lieu, decaler(auj, -7), decaler(auj, -1)))); }
  catch {
    const texte = 'Souci : l\'archive d\'Open-Meteo ne répond pas, bilan non mis à jour.';
    ctx.saveSettings({ dernierBilan: { at, ok: false, texte } satisfies Passage });
    return { ok: false, text: texte };
  }
  const lieuH = empreinteLieu(ctx, lieu), j = journal(ctx), deja = new Map<string, string>();
  for (const e of j.tout()) if (e.t === 'mesure' && e.lieu === lieuH) deja.set(e.jour, JSON.stringify([e.tmax, e.tmin, e.pluie, e.vent]));
  let n = 0;
  for (const x of jours) {
    if ([x.tmax, x.tmin, x.pluie, x.vent].every((v) => v === null) || x.jour >= auj) continue;
    if (deja.get(x.jour) === JSON.stringify([x.tmax, x.tmin, x.pluie, x.vent])) continue;
    j.ajouter({ t: 'mesure', at, jour: x.jour, tmax: x.tmax, tmin: x.tmin, pluie: x.pluie, vent: x.vent, lieu: lieuH }); n++;
  }
  const texte = `📏 Bilan : ${n} jour(s) mesuré(s) ajouté(s) (archive Open-Meteo).`;
  ctx.saveSettings({ dernierBilan: { at, ok: true, texte } satisfies Passage });
  ctx.emit('bilan', { jours: n });
  return { ok: true, text: texte };
}

// ---------------- Les tâches (Talos) ----------------
const PERMIS: Array<RythmeAppli['genre']> = ['jour', 'heures'];
const TACHES = {
  releve: { nom: 'Relevé des prévisions', quoi: 'Garde ce que chaque source prévoit pour J+1 à J+3 (STRATA compris s\'il est branché).', cle: 'rythmeReleve', dernier: 'dernierReleve', defaut: { genre: 'jour', heure: '06:30' } as Rythme, input: { quoi: 'prevu' } },
  bilan: { nom: 'Bilan des prédictions', quoi: 'Lit le temps mesuré des 7 derniers jours (archive Open-Meteo) pour dire qui avait vu juste.', cle: 'rythmeBilan', dernier: 'dernierBilan', defaut: { genre: 'jour', heure: '07:00' } as Rythme, input: { quoi: 'mesure' } },
} as const;
type IdTache = keyof typeof TACHES;
export function rythmeTache(ctx: ModCtx, id: IdTache): Rythme {
  const r = lireRythme(ctx.settings[TACHES[id].cle]);
  return r && PERMIS.includes(r.genre) ? r : TACHES[id].defaut;
}
const dernierPassage = (ctx: ModCtx, id: IdTache): Passage | undefined => { const d = ctx.settings[TACHES[id].dernier]; return d && typeof d === 'object' ? d as Passage : undefined; };
function tachesZeus(): TacheAppli[] {
  return (Object.keys(TACHES) as IdTache[]).map((id) => ({
    id, nom: TACHES[id].nom, quoi: TACHES[id].quoi, permis: PERMIS,
    rythme: (ctx: ModCtx) => rythmeTache(ctx, id) as RythmeAppli,
    regler: (ctx: ModCtx, r: RythmeAppli) => {
      const v = verifierRythme(r); if (!v.ok) throw new Error(v.error);
      if (!PERMIS.includes(v.rythme.genre)) throw new Error('Zeus se règle chaque jour à une heure, ou toutes les n heures.');
      ctx.saveSettings({ [TACHES[id].cle]: v.rythme });
    },
    lancer: { action: 'releve', input: TACHES[id].input },
    dernier: (ctx: ModCtx) => dernierPassage(ctx, id),
    prochain: (ctx: ModCtx, now: Date) => prochaine(rythmeTache(ctx, id), now, lieuZeus()?.fuseau),
  }));
}
/** Une tâche est due quand son prochain passage, compté depuis le dernier (ou depuis 24 h), est arrivé. */
export function tacheDue(ctx: ModCtx, id: IdTache, now: Date, fuseau?: string): boolean {
  const d = dernierPassage(ctx, id), depuis = d ? Date.parse(d.at) : now.getTime() - 86_400_000;
  const n = prochaine(rythmeTache(ctx, id), new Date(Number.isFinite(depuis) ? depuis : now.getTime() - 86_400_000), fuseau);
  return Boolean(n && n.getTime() <= now.getTime());
}
const occupe = new Set<string>();

// ---------------- Le saisonnier (en mémoire, 6 heures) ----------------
async function saison(ctx: ModCtx, lieu: LieuZeus, frais = false): Promise<LigneMois[]> {
  const a = adressesDe(ctx.settings), cle = `${a.saisonnier}|${lieu.lat}|${lieu.lon}`, c = cacheSaison.get(ctx.dir);
  let x = c && c.cle === cle && !frais && Date.now() - c.at < 6 * 3600_000 ? c : undefined;
  if (!x) {
    const [s5, e46] = await Promise.all([
      json(ctx, urlSaisonMois(a.saisonnier, lieu), 20_000).then(lireSeas5).catch(() => 'panne' as const),
      json(ctx, urlSaisonSemaines(a.saisonnier, lieu), 20_000).then(lireEc46).catch(() => 'panne' as const),
    ]);
    x = { at: Date.now(), cle, seas5: s5, ec46: e46 }; cacheSaison.set(ctx.dir, x);
  }
  return lignesMois(moisAVenir(ctx.now(), lieu.fuseau, 3), x.seas5, x.ec46);
}
function verdictPluieMois(l: LigneMois): { mot: string; tone: Tone } {
  if (l.seas5 === 'panne' || l.ec46 === 'panne') return { mot: MOT.rouge, tone: TON.rouge };
  const a = l.seas5?.pluie, b = l.ec46?.pluie;
  if (a === null || a === undefined || b === null || b === undefined) return { mot: MOT.gris, tone: TON.gris };
  return (Math.abs(a) < 5 && Math.abs(b) < 5) || a * b > 0 ? { mot: MOT.vert, tone: TON.vert } : { mot: MOT.jaune, tone: TON.jaune };
}
function texteMois(l: LigneMois): string {
  return `${l.nom} · ${l.verdict.mot} · ${l.verdict.phrase}\n  ECMWF SEAS5 : ${l.texteSeas5}\n  ECMWF EC46 : ${l.texteEc46}\n  ${l.strata}`;
}

// ---------------- Le module ----------------
const PAS_DE_LIEU: ActionResult = { ok: false, text: `📍 ${REGLE_LIEU} (onglet Lieu, ou « ma ville est … ») : Zeus a besoin d'un lieu avec sa position.` };
const nomsModeles = (l: string[]) => l.map((m) => modele(m)?.nom ?? m).join(', ');
const B = (onglet: string) => ({ onglet });

export const zeus: Module = {
  id: 'zeus', name: 'Zeus', family: 'Maison',
  what: 'Met côte à côte les prévisions météo de plusieurs sources (Centre européen, Météo-France, DWD ICON, NOAA GFS, et STRATA de NVIDIA s\'il a son serveur), dit chaque jour si elles s\'accordent, puis qui avait vu juste d\'après le temps mesuré, et regarde les trois prochains mois ; chaque adresse utilisée est affichée.',
  does: [
    'Comparer, jour par jour, l\'information récupérée (Open-Meteo, meilleur modèle pour ce lieu) avec les autres modèles : vert « OK », jaune « Diffère » avec l\'écart, rouge « Souci »',
    'Brancher un serveur STRATA (modèle de recherche de NVIDIA Earth-2) sur une machine avec carte NVIDIA, avec un contrat d\'échange documenté ; sans serveur, la ligne le dit, sans jamais inventer de valeur',
    'Garder chaque matin ce que chaque source prévoit pour J+1 à J+3, puis le comparer au temps mesuré (archive Open-Meteo) : score de chaque source sur 14 jours',
    'Prévisions des 1, 2 et 3 prochains mois en écart à la normale (ECMWF SEAS5 et EC46), comparées entre elles',
    'Montrer toutes les adresses d\'où vient la météo dans Odin, ce qu\'elles donnent, leur portée et qui s\'en sert',
    'Prévenir quand une source ne répond plus depuis 3 jours',
  ],
  from: ['Open-Meteo', 'STRATA', 'Windy', 'Meteoblue'], upstream: ['open-meteo/open-meteo', 'NVlabs/STRATA'],
  words: ['prévisions côte à côte', 'compare les prévisions', 'comparer les prévisions', 'comparaison des prévisions', 'prévisions saisonnières', 'météo dans un mois', 'météo des prochains mois', 'strata', 'sources météo', 'les prévisions étaient justes', 'qui avait prévu juste', 'fiabilité des prévisions', 'zeus'],
  actions: [
    { id: 'comparer', label: 'Prévisions côte à côte', what: 'Les prévisions de chaque source côte à côte, avec un verdict par jour (OK, Diffère, Souci)', read: true, external: true,
      params: [{ key: 'jours', label: 'Nombre de jours', kind: 'number', default: 7, help: '1 à 16' }],
      words: ['previsions cote a cote', 'les sources sont d accord'], run: async (ctx, i) => {
        const lieu = lieuZeus(); if (!lieu) return PAS_DE_LIEU;
        const n = Math.max(1, Math.min(16, Math.round(Number(i.jours) || 7)));
        const c = await comparaison(ctx, lieu), l = joursCompares(ctx, c, n), st = ligneStrata(ctx);
        return { ok: !c.pannes.includes(REFERENCE), text: `${TEXTE_REFERENCE} · lieu ${lieu.nom}.\nModèles : ${nomsModeles(c.modeles)}.\n${texteJours(l)}\n${st.titre} : ${st.detail}`, data: l.map((j) => ({ jour: j.jour, couleur: j.verdict.couleur, mot: j.verdict.mot, phrase: j.verdict.phrase })) };
      } },
    { id: 'bilan', label: 'Qui avait vu juste', what: 'Le score de chaque source sur les 14 derniers jours, face au temps mesuré', read: true,
      words: ['les previsions etaient justes', 'qui avait prevu juste', 'bilan des previsions'], run: (ctx) => {
        const lieu = lieuZeus(); if (!lieu) return PAS_DE_LIEU;
        const l = calculerBilan(journal(ctx).tout(), empreinteLieu(ctx, lieu), aujourdhui(ctx.now(), lieu.fuseau));
        if (!l.length) return { text: `Pas encore de relevé : Zeus garde chaque matin ce que prévoit chaque source, il faut quelques jours avant le premier score.\n${TEXTE_MESURE}.` };
        return { text: `${l.map((x) => `${x.verdict.mot} · ${NOMS_SOURCES(x.src)} à J+${x.ech} : ${x.jours ? `${x.justes}/${x.jours} jours justes · ` : ''}${x.verdict.phrase}`).join('\n')}\n${TEXTE_MESURE}.`, data: l };
      } },
    { id: 'mois', label: 'Les prochains mois', what: 'Le temps des 1, 2 ou 3 prochains mois en écart à la normale (ECMWF SEAS5 et EC46)', read: true,
      params: [{ key: 'mois', label: 'Dans combien de mois', kind: 'select', options: ['1', '2', '3'], default: '1' }],
      words: ['meteo dans un mois', 'meteo dans deux mois', 'meteo dans trois mois', 'previsions saisonnieres'], run: async (ctx, i) => {
        const lieu = lieuZeus(); if (!lieu) return PAS_DE_LIEU;
        const k = Math.max(0, Math.min(3, Math.round(Number(i.mois ?? 1)))), l = await saison(ctx, lieu);
        const choix = i.mois === undefined || i.mois === '' ? l : l.filter((x) => x.rang === k);
        return { text: `Source : Open-Meteo, prévisions saisonnières (ECMWF SEAS5 et EC46, même centre européen).\n${choix.map(texteMois).join('\n')}`, data: choix };
      } },
    { id: 'sources', label: 'Sources de la météo', what: 'Chaque adresse d\'où vient la météo dans Odin, ce qu\'elle donne, sa portée et qui s\'en sert', read: true,
      words: ['sources meteo', 'd ou vient la meteo', 'ou recuperes tu la meteo'], run: (ctx) => {
        const a = adressesDe(ctx.settings), adr: Record<string, string> = { [LIGNE_SOURCES[0].adresse]: a.geocodage, [LIGNE_SOURCES[1].adresse]: a.previsions, [LIGNE_SOURCES[2].adresse]: a.archive, [LIGNE_SOURCES[3].adresse]: a.saisonnier };
        return { text: LIGNE_SOURCES.map((x) => `• ${x.nom} — ${adr[x.adresse] ?? x.adresse}\n  ${x.donne} Portée : ${x.portee}\n  Qui s'en sert : ${x.qui}`).join('\n') + `\nModèles comparés : ${MODELES.map((m) => `${m.nom} (${m.id})`).join(', ')}.\nServeur STRATA : ${adresseStrata(ctx) || 'aucun'}.`, data: LIGNE_SOURCES };
      } },
    { id: 'regler_strata', label: 'Adresse du serveur STRATA', what: 'L\'adresse du serveur STRATA (une machine avec carte NVIDIA, sur ton réseau) ; vide pour le débrancher',
      params: [{ key: 'adresse', label: 'Adresse du serveur STRATA', kind: 'text', help: 'Ex. http://192.168.1.50:8000 (réseau de la maison) ou https://… ; vide : débranché' }],
      words: ['brancher strata', 'serveur strata'], run: (ctx, i) => {
        const t = s(i.adresse);
        if (!t) { ctx.saveSettings({ strata: '', strataDernier: '' }); return { ok: true, text: `STRATA débranché. ${PAS_DE_SERVEUR}.` }; }
        const v = adresseStrataValide(t); if (!v.ok) return { ok: false, text: `Adresse refusée : ${v.raison}.` };
        ctx.saveSettings({ strata: v.url, strataDernier: '' });
        return { ok: true, text: `Adresse STRATA gardée : ${v.url}. ${PLUS_INTERROGE}` };
      } },
    { id: 'essayer_strata', label: 'Essayer le serveur STRATA', what: 'Dit où en est STRATA (il n\'est plus interrogé : aucun appel)',
      words: ['essaie strata', 'essayer le serveur strata'], run: async (ctx) => {
        if (!adresseStrata(ctx)) return { ok: false, text: `${PAS_DE_SERVEUR}. Règle d'abord son adresse (onglet Sources).` };
        await interrogerStrata(ctx);
        const l = ligneStrata(ctx);
        return { ok: false, text: `${l.titre} : ${l.detail}` };
      } },
    { id: 'releve', label: 'Faire le relevé maintenant', what: 'Garde ce que chaque source prévoit (prevu), lit le temps mesuré (mesure), ou les deux',
      params: [{ key: 'quoi', label: 'Quoi', kind: 'select', options: ['tout', 'prevu', 'mesure'], default: 'tout' }],
      words: ['fais le releve zeus', 'releve meteo zeus'], quiet: true, run: async (ctx, i) => {
        const lieu = lieuZeus(); if (!lieu) return PAS_DE_LIEU;
        const q = s(i.quoi) || 'tout', out: ActionResult[] = [];
        if (q === 'tout' || q === 'prevu') out.push(await releverPrevisions(ctx, lieu));
        if (q === 'tout' || q === 'mesure') out.push(await lireMesures(ctx, lieu));
        return { ok: out.every((x) => x.ok !== false), text: out.map((x) => x.text).join('\n') };
      } },
    { id: 'modeles', label: 'Modèles comparés', what: 'Choisir les modèles comparés parmi la liste (l\'information récupérée est toujours gardée)',
      params: [{ key: 'modeles', label: 'Modèles (séparés par des virgules)', kind: 'text', help: MODELES.map((m) => m.id).join(', ') }],
      words: ['change les modeles zeus', 'modeles compares zeus'], run: (ctx, i) => {
        const l = modelesChoisis(i.modeles);
        ctx.saveSettings({ modeles: l }); cache.delete(ctx.dir);
        return { ok: true, text: `Modèles comparés : ${nomsModeles(l)}.` };
      } },
  ],
  async view(ctx) {
    const [C, Bi, M, So] = ['Comparer', 'Bilan', 'Mois', 'Sources'];
    const sections: Section[] = [], side: Section[] = [], lieu = lieuZeus(), st = ligneStrata(ctx), a = adressesDe(ctx.settings);
    const modeles = modelesChoisis(ctx.settings.modeles);
    let kpis: Array<{ label: string; value: string; tone?: Tone }> = [];
    // Comparer
    if (!lieu) {
      sections.push({ ...B(C), kind: 'text', title: 'Lieu', text: `${REGLE_LIEU} : Zeus compare les prévisions de l'endroit où est Odin.`, tone: 'attention' });
      sections.push({ ...B(C), kind: 'cards', title: 'Verdict', items: [tuileStrata(st)] });
    } else {
      const c = await comparaison(ctx, lieu), l = joursCompares(ctx, c, 7);
      sections.push({ ...B(C), kind: 'text', title: 'Source', text: `${TEXTE_REFERENCE}. Source : Open-Meteo (${a.previsions}), modèles ${nomsModeles(c.modeles)} ; lieu : ${lieu.nom}.${c.pannes.length ? ` Sans réponse : ${nomsModeles(c.pannes)}.` : ''}` });
      // Des tuiles : le mot du verdict y est dans sa pastille colorée (vert pour OK), en thème clair comme en sombre.
      sections.push({ ...B(C), kind: 'cards', title: 'Verdict', items: [...l.map((j) => ({ title: nomJour(j.jour), badge: j.verdict.mot, sub: j.verdict.phrase, tone: j.verdict.ton })), tuileStrata(st)], empty: 'Aucune prévision reçue.' });
      sections.push({ ...B(C), kind: 'text', title: 'Comment lire', text: 'Vert « OK » : écart de 2 °C au plus, même genre de pluie, vent à 15 km/h près. Jaune « Diffère » : l\'écart est donné. Rouge « Souci » : source muette, valeur impossible ou écart très grand. Gris « — » : la source ne prévoit pas si loin.' });
      // Le verdict en 3e colonne : il reste visible à 390 px, sans faire défiler le tableau.
      sections.push({ ...B(C), kind: 'table', title: 'Jour par jour', columns: ['Jour', 'Grandeur', 'Verdict', 'Récupérée', 'Prédictions'], rows: l.flatMap((j) => lignesTableau(ctx, j)), empty: 'Aucune prévision reçue.' });
      const n = l.filter((j) => j.verdict.couleur === 'vert').length;
      kpis = [{ label: 'Jours d\'accord', value: `${n}/${l.length}`, tone: l.length && n === l.length ? 'bon' : 'attention' }, { label: 'Sources', value: String(c.modeles.length - c.pannes.length), tone: c.pannes.length ? 'mauvais' : 'bon' }, { label: 'STRATA', value: st.mot }];
    }
    // Bilan
    if (lieu) {
      const l = calculerBilan(journal(ctx).tout(), empreinteLieu(ctx, lieu), aujourdhui(ctx.now(), lieu.fuseau));
      sections.push({ ...B(Bi), kind: 'table', title: 'Qui avait vu juste (14 derniers jours)', columns: ['Source', 'Verdict', 'Échéance', 'Jours justes'], rows: l.map((x) => ({ cells: [NOMS_SOURCES(x.src), x.verdict.mot, `J+${x.ech}`, `${x.justes}/${x.jours}`], tone: x.verdict.ton })), empty: 'Pas encore de relevé : il faut quelques jours avant le premier score.' });
    } else sections.push({ ...B(Bi), kind: 'text', title: 'Bilan', text: REGLE_LIEU, tone: 'attention' });
    sections.push({ ...B(Bi), kind: 'text', title: 'D\'où vient la mesure', text: `${TEXTE_MESURE}. Un jour est juste quand toutes ses grandeurs sont vertes face à la mesure.` });
    const dr = dernierPassage(ctx, 'releve'), db = dernierPassage(ctx, 'bilan');
    side.push({ ...B(Bi), kind: 'list', title: 'Tâches (Talos)', items: (['releve', 'bilan'] as IdTache[]).map((id) => { const d = id === 'releve' ? dr : db; return { title: TACHES[id].nom, detail: `${phrase(rythmeTache(ctx, id))}${d ? ` · dernier passage : ${d.texte}` : ' · pas encore passé'}`, ...(d ? { tone: (d.ok ? 'bon' : 'mauvais') as Tone } : {}) }; }) });
    side.push({ ...B(Bi), kind: 'actions', title: 'Maintenant', boutons: [{ action: 'releve', label: 'Faire le relevé maintenant', input: { quoi: 'tout' }, primary: true }] });
    // Mois
    if (lieu) {
      const l = await saison(ctx, lieu);
      sections.push({ ...B(M), kind: 'table', title: 'Les prochains mois (écart à la normale)', columns: ['Mois', 'Grandeur', 'Verdict', 'SEAS5', 'EC46'], rows: l.flatMap((x) => {
        const p = verdictPluieMois(x);
        const t5 = x.seas5 === 'panne' ? 'ne répond pas' : x.seas5?.t === null || !x.seas5 ? '—' : x.texteSeas5.split(' ; ')[0];
        const p5 = x.seas5 === 'panne' ? 'ne répond pas' : x.seas5?.pluie === null || !x.seas5 ? '—' : x.texteSeas5.split(' ; ')[1] ?? '—';
        const t46 = x.ec46 === 'panne' ? 'ne répond pas' : !x.ec46 ? 'ne prévoit pas si loin' : x.texteEc46.split(' ; ')[0];
        const p46 = x.ec46 === 'panne' ? 'ne répond pas' : !x.ec46 ? 'ne prévoit pas si loin' : x.texteEc46.split(' ; ')[1] ?? '—';
        return [{ cells: [x.nom, 'Température', x.verdict.mot, t5, t46], tone: x.verdict.ton }, { cells: [x.nom, 'Pluie', p.mot, p5, p46], tone: p.tone }];
      }) });
      sections.push({ ...B(M), kind: 'text', title: 'STRATA', text: `${PAS_SI_LOIN} : pas de colonne STRATA pour les mois.`, tone: 'neutre' });
      sections.push({ ...B(M), kind: 'cards', title: 'Verdict des mois', items: l.map((x) => ({ title: x.nom, badge: x.verdict.mot, sub: x.verdict.phrase, tone: x.verdict.ton })) });
    } else sections.push({ ...B(M), kind: 'text', title: 'Mois', text: REGLE_LIEU, tone: 'attention' });
    sections.push({ ...B(M), kind: 'text', title: 'À savoir', text: `Source : Open-Meteo, prévisions saisonnières (${a.saisonnier}). SEAS5 (moyenne de 51 membres) donne un écart par mois ; EC46 un écart par semaine jusqu'à 46 jours, regroupé ici par mois (au moins 2 semaines). Les deux viennent du même centre européen : ce ne sont pas deux sources indépendantes. ${PAS_SI_LOIN}.` });
    // Sources
    const adr: Record<string, string> = { [LIGNE_SOURCES[0].adresse]: a.geocodage, [LIGNE_SOURCES[1].adresse]: a.previsions, [LIGNE_SOURCES[2].adresse]: a.archive, [LIGNE_SOURCES[3].adresse]: a.saisonnier };
    sections.push({ ...B(So), kind: 'table', title: 'D\'où vient la météo dans Odin', columns: ['Adresse', 'Ce qu\'elle donne', 'Portée', 'Qui s\'en sert'], rows: LIGNE_SOURCES.map((x) => ({ cells: [`${x.nom} · ${adr[x.adresse] ?? x.adresse}`, x.donne, x.portee, x.qui] })) });
    sections.push({ ...B(So), kind: 'table', title: 'Modèles comparés', columns: ['Modèle', 'Qui le fait tourner', 'Portée', 'Comparé'], rows: MODELES.map((m) => ({ cells: [`${m.nom} (${m.id})`, m.qui, m.portee, modeles.includes(m.id) ? 'oui' : 'non'] })) });
    side.push({ ...B(So), kind: 'form', title: 'Adresse du serveur STRATA', action: 'regler_strata', submit: 'Enregistrer', params: [{ key: 'adresse', label: 'Adresse du serveur STRATA', kind: 'text', default: adresseStrata(ctx), help: 'Une machine Linux avec carte NVIDIA, sur ton réseau (contrat : docs/strata-contrat.md). Vide : débranché.' }], aide: st.detail });
    side.push({ ...B(So), kind: 'actions', title: 'STRATA', boutons: [{ action: 'essayer_strata', label: 'Essayer le serveur STRATA', primary: true }], aide: PLUS_INTERROGE });
    side.push({ ...B(So), kind: 'form', title: 'Modèles comparés', action: 'modeles', submit: 'Garder ces modèles', params: [{ key: 'modeles', label: 'Modèles (séparés par des virgules)', kind: 'text', default: modeles.join(', '), help: MODELES.map((m) => m.id).join(', ') }] });
    return { subtitle: lieu ? `Météo comparée · ${lieu.nom}` : 'Météo comparée', kpis, onglets: [C, Bi, M, So], sections, side };
  },
  taches: () => tachesZeus(),
  watch: { every: 300, async run(ctx) {
    const lieu = lieuZeus(); if (!lieu || occupe.has(ctx.dir)) return;
    occupe.add(ctx.dir);
    try {
      const now = ctx.now();
      if (tacheDue(ctx, 'releve', now, lieu.fuseau) && !tacheEnPause('zeus', 'releve')) await releverPrevisions(ctx, lieu).catch(() => undefined);
      if (tacheDue(ctx, 'bilan', now, lieu.fuseau) && !tacheEnPause('zeus', 'bilan')) await lireMesures(ctx, lieu).catch(() => undefined);
    } finally { occupe.delete(ctx.dir); }
  } },
};
export { PHRASE_VERT };
export type { Entree };
