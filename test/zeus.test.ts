// Zeus — la météo comparée. Un faux Open-Meteo (node:http sur 127.0.0.1, branché par les réglages d'adresse de Zeus)
// renvoie le format multi-modèles (suffixes _best_match, _ecmwf_ifs025…) : jamais Internet pendant ces essais.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { regionDe, setLieuCourant } from '../src/valhalla/lieu.ts';
import { tacheEnPause } from '../src/valhalla/automatismes.ts';
import { murale } from '../src/draupnir/rythme.ts';
import { adressesDe, arrondi, IDS_MODELES, LIGNE_SOURCES, lireMultiModeles, modelesChoisis, OPEN_METEO, purgerPositionsEnClair, REFERENCE, urlPrevisions } from '../src/valhalla/zeus/sources.ts';
import { categoriePluie, comparerGrandeur, PHRASE_VERT, valeurImpossible, verdictDuJour, verdictGrandeur } from '../src/valhalla/zeus/comparer.ts';
import { lignesMois, lireEc46, lireSeas5, moisAVenir, regrouperEc46, texteTemperature, textePluie, verdictSaison } from '../src/valhalla/zeus/saisonnier.ts';
import { bilan, decaler, jourJuste, verdictScore, type Entree } from '../src/valhalla/zeus/bilan.ts';
import { PAS_DE_SERVEUR, PAS_SI_LOIN } from '../src/valhalla/zeus/strata.ts';
import { comparaison, joursCompares, lieuZeus, REGLE_LIEU, TEXTE_MESURE, TEXTE_REFERENCE } from '../src/valhalla/modules/zeus.ts';
import { checkLocalAlerts } from '../src/guard/alerts.ts';
import type { ModCtx, Section } from '../src/valhalla/types.ts';

const LIEU = { nom: 'Villessai', lat: 48.8566, lon: 2.3522, fuseau: 'Europe/Paris' };
const auj = () => { const m = murale(Date.now(), LIEU.fuseau); return `${m.y}-${String(m.mo).padStart(2, '0')}-${String(m.d).padStart(2, '0')}`; };

// ---------------------------------------------------------------- Fonctions pures

test('sources : adresses exactes, modèles vérifiés, position arrondie, découpage des suffixes et null gardés', () => {
  assert.equal(OPEN_METEO.geocodage, 'https://geocoding-api.open-meteo.com/v1/search');
  assert.equal(OPEN_METEO.previsions, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(OPEN_METEO.archive, 'https://archive-api.open-meteo.com/v1/archive');
  assert.equal(OPEN_METEO.saisonnier, 'https://seasonal-api.open-meteo.com/v1/seasonal');
  assert.deepEqual(IDS_MODELES, ['best_match', 'ecmwf_ifs025', 'ecmwf_aifs025_single', 'meteofrance_seamless', 'icon_seamless', 'gfs_seamless']);
  assert.deepEqual(modelesChoisis('icon_seamless, inconnu'), ['best_match', 'icon_seamless']);
  assert.deepEqual(modelesChoisis(undefined), IDS_MODELES);
  const u = urlPrevisions(OPEN_METEO.previsions, { lat: 48.85661, lon: 2.35222 }, ['best_match', 'icon_seamless']);
  assert.match(u, /latitude=48\.86&longitude=2\.35&/); assert.match(u, /models=best_match,icon_seamless/); assert.match(u, /forecast_days=16/);
  assert.equal(arrondi(48.85661), 48.86);
  // Réglages : une adresse http(s) remplace celle d'Open-Meteo ; le reste ne bouge pas.
  const a = adressesDe({ adressePrevisions: 'http://127.0.0.1:9/v1/forecast/', adresseArchive: 'ftp://x' });
  assert.equal(a.previsions, 'http://127.0.0.1:9/v1/forecast'); assert.equal(a.archive, OPEN_METEO.archive);
  const l = lireMultiModeles({ daily: { time: ['2026-11-16', '2026-11-17'], temperature_2m_max_best_match: [20, 21], temperature_2m_min_best_match: [10, 11], precipitation_sum_best_match: [0, 2.5], wind_speed_10m_max_best_match: [20, 25], temperature_2m_max_meteofrance_seamless: [19, null], temperature_2m_min_meteofrance_seamless: [9, null], precipitation_sum_meteofrance_seamless: [0, null], wind_speed_10m_max_meteofrance_seamless: [18, null] } }, ['best_match', 'meteofrance_seamless', 'gfs_seamless']);
  assert.deepEqual(l.best_match[1], { jour: '2026-11-17', tmax: 21, tmin: 11, pluie: 2.5, vent: 25 });
  assert.deepEqual(l.meteofrance_seamless[1], { jour: '2026-11-17', tmax: null, tmin: null, pluie: null, vent: null });
  assert.equal(l.gfs_seamless, undefined, 'un modèle absent de la réponse n\'a pas d\'entrée');
  // Un seul modèle demandé : sans suffixe.
  assert.equal(lireMultiModeles({ daily: { time: ['2026-11-16'], temperature_2m_max: [5] } }, ['icon_seamless']).icon_seamless[0].tmax, 5);
  // Chaque source affichée a son adresse, ce qu'elle donne, sa portée et qui s'en sert.
  for (const s of LIGNE_SOURCES) assert.ok(s.adresse.startsWith('https://') && s.donne && s.portee && s.qui, s.nom);
});

test('comparer : seuils, phrases exactes, mots qui doublent la couleur', () => {
  const ref = { tmax: 20, tmin: 10, pluie: 0, vent: 20 };
  const vert = verdictDuJour(ref, [{ source: 'ECMWF', valeurs: { tmax: 21.5, tmin: 9, pluie: 0.4, vent: 30 } }]);
  assert.deepEqual([vert.couleur, vert.mot, vert.ton, vert.phrase], ['vert', 'OK', 'bon', 'Prédiction et information récupérée correctes']);
  const jaune = verdictDuJour(ref, [{ source: 'AIFS', valeurs: { tmax: 23.5, tmin: 10, pluie: 0, vent: 20 } }, { source: 'ICON', valeurs: { tmax: 22.5, tmin: 10, pluie: 0, vent: 20 } }]);
  assert.deepEqual([jaune.couleur, jaune.mot, jaune.ton], ['jaune', 'Diffère', 'attention']);
  assert.equal(jaune.phrase, 'Prédiction diffère : AIFS annonce 23,5 °C, l\'information récupérée 20 °C (écart +3,5 °C)', 'le plus grand écart');
  const grand = verdictDuJour(ref, [{ source: 'GFS', valeurs: { tmax: 27, tmin: 10, pluie: 0, vent: 20 } }]);
  assert.deepEqual([grand.couleur, grand.mot], ['rouge', 'Souci']);
  assert.equal(grand.phrase, 'Souci : GFS écart très grand (température max : 27 °C contre 20 °C)');
  const panne = verdictDuJour(ref, [{ source: 'GFS', panne: true }, { source: 'AIFS', valeurs: { tmax: 23.5, tmin: 10, pluie: 0, vent: 20 } }]);
  assert.equal(panne.phrase, 'Souci : GFS ne répond pas'); assert.equal(panne.mot, 'Souci');
  const absurde = verdictDuJour(ref, [{ source: 'ICON', valeurs: { tmax: 80, tmin: 10, pluie: 0, vent: 20 } }]);
  assert.equal(absurde.couleur, 'rouge'); assert.match(absurde.phrase, /^Souci : ICON valeur impossible \(température max de 80 °C\)$/);
  assert.match(valeurImpossible({ tmax: 10, tmin: 12 }) ?? '', /minimum/);
  assert.equal(valeurImpossible({ tmax: 10, tmin: 10.4 }), undefined, 'min > max de moins de 0,5 : arrondis tolérés');
  assert.match(valeurImpossible({ pluie: -1 }) ?? '', /pluie/); assert.match(valeurImpossible({ vent: 401 }) ?? '', /vent/);
  const gris = verdictDuJour(ref, [{ source: 'MF', valeurs: { tmax: null, tmin: null, pluie: null, vent: null } }]);
  assert.deepEqual([gris.couleur, gris.mot, gris.ton], ['gris', '—', 'neutre']); assert.match(gris.phrase, /ne prévoit pas si loin/);
  assert.equal(verdictGrandeur('tmax', 20, null, 'MF').phrase, 'MF ne prévoit pas si loin');
  assert.equal(verdictDuJour(null, []).phrase, 'Souci : l\'information récupérée ne répond pas');
  // Pluie : catégories, tolérance, sec contre forte.
  assert.deepEqual([categoriePluie(0.9), categoriePluie(1), categoriePluie(9.9), categoriePluie(10)], ['sec', 'faible', 'faible', 'forte']);
  assert.equal(comparerGrandeur('pluie', 0, 0.8).couleur, 'vert');
  assert.equal(comparerGrandeur('pluie', 3, 8).couleur, 'jaune', 'même catégorie mais 5 mm d\'écart');
  assert.equal(comparerGrandeur('pluie', 20, 28).couleur, 'vert', '50 % de 20 mm = 10 mm de tolérance');
  assert.equal(comparerGrandeur('pluie', 0, 12).couleur, 'rouge');
  // Aux bornes des catégories : 0,2 mm d'écart reste vert (la même bruine), au-delà de la tolérance c'est jaune.
  assert.deepEqual([[0.9, 1.1], [1.1, 0.9], [9.9, 10.1], [10.1, 9.9]].map(([r, p]) => comparerGrandeur('pluie', r, p).couleur), ['vert', 'vert', 'vert', 'vert']);
  assert.equal(comparerGrandeur('pluie', 0.5, 3.5).couleur, 'jaune', 'sec contre faible, 3 mm d\'écart');
  assert.equal(verdictDuJour(ref, [{ source: 'ICON', valeurs: { ...ref, pluie: 0.9 } }]).couleur, 'vert');
  // Vent.
  assert.deepEqual([15, 30, 31].map((d) => comparerGrandeur('vent', 20, 20 + d).couleur), ['vert', 'jaune', 'rouge']);
  // Température : bornes incluses.
  assert.deepEqual([2, 5, 5.1].map((d) => comparerGrandeur('tmin', 10, 10 - d).couleur), ['vert', 'jaune', 'rouge']);
  // Le vent approché de STRATA n'est pas compté.
  assert.equal(verdictDuJour(ref, [{ source: 'STRATA', valeurs: { ...ref, vent: 90 }, nonComptees: ['vent'] }]).couleur, 'vert');
});

test('les tuiles du verdict : OK en vert, Diffère en jaune, Souci en rouge (règles de la page)', () => {
  // Les verdicts sont des tuiles (kind « cards ») : leur pastille prend la couleur du ton, en thème clair comme en sombre.
  const css = readFileSync(join(import.meta.dirname, '..', 'src', 'web', 'valhalla.js'), 'utf8');
  assert.ok(css.includes('.va-tuile.va-tone-bon .va-tuile-b{color:var(--good)}'), 'la pastille OK est verte');
  assert.ok(css.includes('.va-tuile.va-tone-bon{border-left:3px solid var(--good)}'), 'la tuile OK a son liseré vert');
  assert.ok(css.includes('.va-tuile.va-tone-attention .va-tuile-b{color:var(--warn)}'));
  assert.ok(css.includes('.va-tuile.va-tone-mauvais .va-tuile-b{color:var(--bad)}'));
  assert.ok(css.includes('el(\'span\', { class: \'va-tuile-b\' }, c.badge)'), 'le mot est écrit dans la pastille');
});

test('saisonnier : SEAS5 par mois, EC46 regroupé par mois (2 semaines au moins), textes, verdicts, STRATA honnête', () => {
  assert.equal(texteTemperature(1), 'plus chaud que d\'habitude de 1 °C');
  assert.equal(texteTemperature(-0.6), 'plus frais que d\'habitude de 0,6 °C');
  assert.equal(textePluie(-10), 'plus sec que d\'habitude (−10 mm sur le mois)');
  assert.match(textePluie(2), /proche de la normale/);
  assert.deepEqual(moisAVenir(new Date('2026-11-16T10:00:00Z'), 'Europe/Paris'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  const sem = lireEc46({ weekly: { time: ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14'], temperature_2m_anomaly: [1, 1.2, 0.8, 1, 0.5, null, null], precipitation_anomaly: [-2, -3, -1, -4, 1, null, null] } });
  const nov = regrouperEc46(sem, '2026-11')!;
  assert.equal(nov.semaines, 5, 'les semaines qui COMMENCENT en novembre (le 30 compris)'); assert.equal(Math.round(nov.t * 100) / 100, 0.9); assert.equal(nov.pluie, -9);
  assert.equal(regrouperEc46(sem, '2026-12'), undefined, 'une seule semaine connue en décembre : pas assez');
  const s5 = lireSeas5({ monthly: { time: ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01'], temperature_2m_anomaly_ecmwf_seas5_ensemble_mean: [1.4, -0.5, 0.2, 0.9], precipitation_anomaly_ecmwf_seas5_ensemble_mean: [-12, 3, 30, 0], wind_speed_10m_anomaly_ecmwf_seas5_ensemble_mean: [0, 0, 0, 0] } });
  assert.deepEqual(s5[0], { mois: '2026-11', t: 1.4, pluie: -12, vent: 0 });
  const l = lignesMois(['2026-11', '2026-12', '2027-01', '2027-02'], s5, sem);
  assert.deepEqual(l.map((x) => x.verdict.mot), ['OK', '—', '—', '—']);
  assert.equal(l[1].texteEc46, 'EC46 ne prévoit pas si loin');
  for (const x of l) assert.equal(x.strata, PAS_SI_LOIN);
  assert.equal(PAS_SI_LOIN, 'STRATA ne prévoit pas au-delà de quelques jours');
  assert.equal(verdictSaison({ t: 1 }, { t: -0.8 }).mot, 'Diffère');
  assert.match(verdictSaison({ t: 1 }, { t: -0.8 }).phrase, /^Prédiction diffère : EC46 annonce −0,8 °C, SEAS5 \+1 °C \(écart 1,8 °C\)$/);
  assert.equal(verdictSaison('panne', { t: 1 }).phrase, 'Souci : ECMWF SEAS5 ne répond pas');
  assert.equal(lignesMois(['2026-11'], 'panne', sem)[0].verdict.couleur, 'rouge');
});

test('bilan : jour juste, scores vert / jaune / rouge, moins de 5 jours en gris', () => {
  const m = { tmax: 20, tmin: 10, pluie: 0, vent: 20 };
  assert.equal(jourJuste(m, m), true); assert.equal(jourJuste({ ...m, tmax: 24 }, m), false);
  assert.equal(jourJuste({ tmax: null, tmin: null, pluie: null, vent: null }, m), undefined);
  assert.equal(verdictScore(4, 4).phrase, 'pas encore assez de jours (4/5)'); assert.equal(verdictScore(4, 4).couleur, 'gris');
  assert.deepEqual([verdictScore(8, 10).phrase, verdictScore(5, 10).phrase, verdictScore(4, 10).phrase], ['Prédictions justes', 'Prédictions parfois fausses', 'Souci : prédictions souvent fausses']);
  const today = '2026-11-16', e: Entree[] = [];
  for (let k = 1; k <= 10; k++) {
    const jour = decaler(today, -k);
    e.push({ t: 'mesure', at: '', jour, ...m, lieu: 'abc' });
    e.push({ t: 'prevu', at: '', jour, src: 'ecmwf_ifs025', ech: 1, ...m, lieu: 'abc' });
    e.push({ t: 'prevu', at: '', jour, src: 'gfs_seamless', ech: 1, ...m, tmax: k % 2 ? 26 : 20, lieu: 'abc' });
    e.push({ t: 'prevu', at: '', jour, src: 'icon_seamless', ech: 3, ...m, tmax: 30, lieu: 'abc' });
    e.push({ t: 'prevu', at: '', jour, src: 'ecmwf_ifs025', ech: 1, ...m, tmax: 40, lieu: 'autre-lieu' });
  }
  const b = bilan(e, 'abc', today), de = (src: string, ech: number) => b.find((x) => x.src === src && x.ech === ech)!;
  assert.deepEqual([de('ecmwf_ifs025', 1).justes, de('ecmwf_ifs025', 1).jours, de('ecmwf_ifs025', 1).verdict.couleur], [10, 10, 'vert']);
  assert.deepEqual([de('gfs_seamless', 1).justes, de('gfs_seamless', 1).verdict.couleur], [5, 'jaune']);
  assert.equal(de('icon_seamless', 3).verdict.couleur, 'rouge');
  assert.equal(de('ecmwf_ifs025', 3).verdict.couleur, 'gris');
  assert.equal(bilan(e.filter((x) => x.jour >= decaler(today, -3)), 'abc', today).find((x) => x.src === 'ecmwf_ifs025' && x.ech === 1)!.verdict.phrase, 'pas encore assez de jours (3/5)');
});

// ---------------------------------------------------------------- Le faux Open-Meteo

interface Faux { url: string; srv: Server; vus: string[]; panne: Set<string>; archive: boolean; fermer(): Promise<void> }
async function fauxOpenMeteo(): Promise<Faux> {
  const vus: string[] = [], panne = new Set<string>();
  const base = auj(), jours = Array.from({ length: 7 }, (_, k) => decaler(base, k));
  const serie = (m: string, v: string): Array<number | null> => jours.map((_, k) => {
    if (m === 'meteofrance_seamless' && k >= 5) return null;
    const r = { temperature_2m_max: 20, temperature_2m_min: 10, precipitation_sum: 0, wind_speed_10m_max: 20 }[v] ?? 0;
    if (m === 'ecmwf_aifs025_single' && k === 1 && v === 'temperature_2m_max') return 23.5;
    if (m === 'icon_seamless' && k === 2 && v === 'temperature_2m_max') return 80;
    return r;
  });
  const etat = { archive: true };
  const srv = createServer((q, r) => {
    const u = new URL(q.url ?? '/', 'http://x'); vus.push(`${u.pathname}?${u.searchParams.toString()}`);
    const json = (code: number, o: unknown) => { r.writeHead(code, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    if (u.pathname === '/v1/forecast') {
      const models = (u.searchParams.get('models') ?? 'best_match').split(',');
      if (models.some((m) => panne.has(m))) return json(500, { error: true, reason: 'panne' });
      const daily: Record<string, unknown> = { time: jours };
      for (const m of models) for (const v of ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_speed_10m_max']) daily[models.length > 1 ? `${v}_${m}` : v] = serie(m, v);
      return json(200, { latitude: 48.86, longitude: 2.35, timezone: 'Europe/Paris', daily });
    }
    if (u.pathname === '/v1/archive') {
      if (!etat.archive) return json(500, {});
      const d = Array.from({ length: 7 }, (_, k) => decaler(base, k - 7));
      return json(200, { daily: { time: d, temperature_2m_max: d.map(() => 20), temperature_2m_min: d.map(() => 10), precipitation_sum: d.map(() => 0), wind_speed_10m_max: d.map(() => 20) } });
    }
    if (u.pathname === '/v1/seasonal') {
      const m0 = new Date(`${base.slice(0, 7)}-01T00:00:00Z`);
      if (u.searchParams.get('monthly')) {
        const t = Array.from({ length: 6 }, (_, k) => new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() + k, 1)).toISOString().slice(0, 10));
        return json(200, { monthly: { time: t, temperature_2m_anomaly: [1.2, 0.5, -0.4, 0.8, 0, 0], precipitation_anomaly: [-10, 3, 20, 0, 0, 0], wind_speed_10m_anomaly: [0, 0, 0, 0, 0, 0] } });
      }
      const t = Array.from({ length: 9 }, (_, k) => new Date(m0.getTime() + k * 7 * 86_400_000).toISOString().slice(0, 10));
      return json(200, { weekly: { time: t, temperature_2m_anomaly: t.map((_, k) => (k < 6 ? 1 : null)), precipitation_anomaly: t.map((_, k) => (k < 6 ? -2 : null)) } });
    }
    json(404, {});
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  const port = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, srv, vus, panne, get archive() { return etat.archive; }, set archive(v: boolean) { etat.archive = v; }, fermer: () => new Promise<void>((ok) => srv.close(() => ok())) };
}
function monde() {
  const home = mkdtempSync(join(tmpdir(), 'zeus-'));
  const mods = allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), v = new Valhalla(home, mods);
  return { v, home, mod: v.modules().find((m) => m.id === 'zeus')!, ctx: v.ctx('zeus') as ModCtx, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
const brancher = (ctx: ModCtx, f: Faux) => ctx.saveSettings({ adresseGeocodage: `${f.url}/v1/search`, adressePrevisions: `${f.url}/v1/forecast`, adresseArchive: `${f.url}/v1/archive`, adresseSaisonnier: `${f.url}/v1/seasonal` });
const section = (s: Section[], titre: string) => s.find((x) => x.title === titre);
const run = (w: ReturnType<typeof monde>, a: string, i: Record<string, unknown> = {}) => w.mod.actions.find((x) => x.id === a)!.run(w.ctx, i);

test('Zeus sans lieu : la page le dit, la ligne STRATA reste là, aucun appel', async (tt) => {
  setLieuCourant(undefined);
  const vrai = globalThis.fetch; let appels = 0;
  globalThis.fetch = (async () => { appels++; throw new Error('aucun appel attendu'); }) as typeof fetch; tt.after(() => { globalThis.fetch = vrai; });
  const w = monde();
  try {
    assert.equal(lieuZeus(), undefined);
    const vue = await w.mod.view(w.ctx, new URLSearchParams());
    assert.deepEqual(vue.onglets, ['Comparer', 'Bilan', 'Mois', 'Sources']);
    assert.match(JSON.stringify(vue), new RegExp(REGLE_LIEU));
    const l = section(vue.sections, 'Verdict') as Extract<Section, { kind: 'cards' }>;
    assert.equal(l.items[0].sub, PAS_DE_SERVEUR); assert.equal(l.items[0].tone, 'neutre'); assert.equal(l.items[0].badge, 'Non branché');
    assert.match((await run(w, 'comparer')).text, /Règle d'abord le lieu dans Hestia/);
    assert.doesNotMatch(JSON.stringify(vue), /undefined|NaN|\[object Object\]/);
    assert.equal(appels, 0, 'sans lieu, Zeus ne demande rien à personne');
  } finally { w.fin(); }
});

test('Zeus avec un faux Open-Meteo : verdicts par jour, gris au-delà de la portée, panne, STRATA non branché, sources, mois', async (tt) => {
  const f = await fauxOpenMeteo(); tt.after(() => f.fermer());
  setLieuCourant({ ...LIEU, region: regionDe('FR') }); tt.after(() => setLieuCourant(undefined));
  const w = monde(); tt.after(() => w.fin());
  brancher(w.ctx, f);
  const vue = await w.mod.view(w.ctx, new URLSearchParams());
  assert.doesNotMatch(JSON.stringify(vue), /undefined|NaN|\[object Object\]/);
  // La position part arrondie à 0,01°, jamais plus précise.
  assert.ok(f.vus.some((x) => x.startsWith('/v1/forecast') && x.includes('latitude=48.86') && x.includes('longitude=2.35')));
  assert.ok(!f.vus.some((x) => x.includes('48.8566')), 'jamais la position exacte');
  // Source affichée.
  const src = section(vue.sections, 'Source') as Extract<Section, { kind: 'text' }>;
  assert.match(src.text, new RegExp(`^${TEXTE_REFERENCE}`)); assert.ok(src.text.includes(`${f.url}/v1/forecast`));
  // Verdict : J0 vert, J1 jaune (AIFS 23,5), J2 rouge (ICON 80 °C), STRATA non branché en gris.
  // Des tuiles (pas une liste) : la tuile « bon » a sa pastille verte, le mot y est écrit.
  const v = section(vue.sections, 'Verdict') as Extract<Section, { kind: 'cards' }>;
  assert.equal(v.kind, 'cards');
  assert.equal(v.items.length, 8);
  assert.deepEqual(v.items.slice(0, 3).map((x) => [x.badge, x.tone]), [['OK', 'bon'], ['Diffère', 'attention'], ['Souci', 'mauvais']]);
  assert.equal(v.items[0].sub, PHRASE_VERT);
  assert.equal(v.items[1].sub, 'Prédiction diffère : AIFS annonce 23,5 °C, l\'information récupérée 20 °C (écart +3,5 °C)');
  assert.equal(v.items[2].sub, 'Souci : ICON valeur impossible (température max de 80 °C)');
  assert.equal(v.items[5].sub, PHRASE_VERT, 'Météo-France ne prévoit plus à J+5 : les autres sources comptent encore');
  assert.equal(v.items[7].sub, PAS_DE_SERVEUR); assert.equal(v.items[7].tone, 'neutre'); assert.equal(v.items[7].badge, 'Non branché');
  // Tableau étroit : le verdict en 3e colonne (visible à 390 px), prédictions côte à côte, STRATA « — », MF « — » au-delà de sa portée.
  const t = section(vue.sections, 'Jour par jour') as Extract<Section, { kind: 'table' }>;
  assert.deepEqual(t.columns, ['Jour', 'Grandeur', 'Verdict', 'Récupérée', 'Prédictions']);
  assert.equal(t.rows[0].cells[4], 'ECMWF 20 · AIFS 20 · MF 20 · ICON 20 · GFS 20 · STRATA —');
  assert.ok(t.rows[5 * 4].cells[4].includes('MF —'));
  for (const r of t.rows) assert.ok(['OK', 'Diffère', 'Souci', '—'].includes(r.cells[2]), 'un mot, jamais la couleur seule');
  // Onglet Sources : chaque adresse.
  const so = section(vue.sections, 'D\'où vient la météo dans Odin') as Extract<Section, { kind: 'table' }>;
  const tout = JSON.stringify(so.rows);
  for (const a of [`${f.url}/v1/search`, `${f.url}/v1/forecast`, `${f.url}/v1/archive`, `${f.url}/v1/seasonal`, 'https://nominatim.openstreetmap.org/reverse', 'https://huggingface.co/nvidia/strata']) assert.ok(tout.includes(a), a);
  assert.ok(vue.side?.some((x) => x.kind === 'form' && x.title === 'Adresse du serveur STRATA'));
  assert.ok(vue.side?.some((x) => x.kind === 'actions' && x.boutons.some((b) => b.label === 'Essayer le serveur STRATA')));
  assert.match((await run(w, 'sources')).text, /seasonal/);
  // Mois : 4 lignes de mois (en cours, +1, +2, +3) × 2 grandeurs, EC46 « ne prévoit pas si loin » après 6 semaines, colonne STRATA.
  const mo = section(vue.sections, 'Les prochains mois (écart à la normale)') as Extract<Section, { kind: 'table' }>;
  assert.deepEqual(mo.columns, ['Mois', 'Grandeur', 'Verdict', 'SEAS5', 'EC46']);
  assert.equal(mo.rows.length, 8);
  assert.equal(mo.rows[0].cells[3], 'plus chaud que d\'habitude de 1,2 °C'); assert.equal(mo.rows[0].cells[2], 'OK');
  assert.equal(mo.rows[4].cells[4], 'ne prévoit pas si loin');
  assert.match((section(vue.sections, 'STRATA') as Extract<Section, { kind: 'text' }>).text, /STRATA ne prévoit pas au-delà de quelques jours/);
  assert.equal(section(vue.sections, 'Verdict des mois')?.kind, 'cards');
  const m2 = await run(w, 'mois', { mois: '2' });
  assert.match(m2.text, /EC46 ne prévoit pas si loin/); assert.match(m2.text, /STRATA ne prévoit pas au-delà de quelques jours/);
  // Un modèle en panne (500) : chaque jour en rouge « GFS ne répond pas ».
  f.panne.add('gfs_seamless');
  const c = await comparaison(w.ctx, lieuZeus()!, true);
  assert.deepEqual(c.pannes, ['gfs_seamless']);
  const j = joursCompares(w.ctx, c, 3);
  assert.equal(j[0].verdict.phrase, 'Souci : GFS ne répond pas'); assert.equal(j[0].verdict.mot, 'Souci');
  // La référence en panne.
  f.panne.add(REFERENCE);
  const sansRef = joursCompares(w.ctx, await comparaison(w.ctx, lieuZeus()!, true), 1)[0];
  assert.equal(sansRef.ref, null, 'sans référence, aucune valeur inventée');
  assert.equal(sansRef.verdict.phrase, 'Souci : l\'information récupérée ne répond pas');
  f.panne.clear();
});

test('Zeus : relevé, mesure, bilan, sans jamais garder ni position ni nom ; tâches visibles dans Talos et mises en pause', async (tt) => {
  const f = await fauxOpenMeteo(); tt.after(() => f.fermer());
  setLieuCourant({ ...LIEU, region: regionDe('FR') }); tt.after(() => setLieuCourant(undefined));
  const w = monde(); tt.after(() => w.fin());
  brancher(w.ctx, f);
  // Talos : la veille et les deux tâches sont visibles, avec une vraie action.
  const ids = w.v.automatismes.lignes().map((l) => l.id);
  for (const id of ['veille:zeus', 'tache:zeus:releve', 'tache:zeus:bilan']) assert.ok(ids.includes(id), id);
  assert.equal(w.v.automatismes.ligne('tache:zeus:releve')!.phrase, 'Tous les jours à 6 h 30');
  assert.equal((w.v.automatismes.rythme('tache:zeus:bilan', { genre: 'jour', heure: '08:15' }) as { ok: boolean }).ok, true);
  assert.deepEqual({ ...(w.ctx.settings.rythmeBilan as object) }, { genre: 'jour', heure: '08:15' });
  assert.equal((w.v.automatismes.rythme('tache:zeus:bilan', { genre: 'mois', jour: 1, heure: '08:15' }) as { ok: boolean }).ok, false);
  // En pause : la surveillance ne lance rien.
  for (const t of ['releve', 'bilan']) { w.v.automatismes.pause(`tache:zeus:${t}`, true, { confirme: true }); assert.equal(tacheEnPause('zeus', t), true); }
  f.vus.length = 0;
  await w.mod.watch!.run(w.ctx);
  assert.equal(f.vus.length, 0, 'en pause : aucun appel');
  for (const t of ['releve', 'bilan']) w.v.automatismes.pause(`tache:zeus:${t}`, false);
  await w.mod.watch!.run(w.ctx);
  assert.ok(f.vus.some((x) => x.startsWith('/v1/forecast')) && f.vus.some((x) => x.startsWith('/v1/archive')), 'les deux tâches dues sont passées');
  assert.match((w.ctx.settings.dernierReleve as { texte: string }).texte, /prédiction\(s\) gardée\(s\)/);
  // Le journal : J+1 à J+3 par source, puis les mesures des 7 derniers jours ; jamais la position ni le nom.
  const j = await import('../src/valhalla/zeus/bilan.ts');
  const e = j.journal(w.ctx).tout();
  assert.ok(e.filter((x) => x.t === 'prevu').length >= 15); assert.equal(e.filter((x) => x.t === 'mesure').length, 7);
  // (les heures « at » sont écartées : « 12:48.861Z » contiendrait « 48.86 » par hasard)
  const brut = JSON.stringify(e.map(({ at: _at, ...x }) => x));
  for (const k of ['lat', 'lon', 'ville', 'villeNom']) assert.equal(w.ctx.settings[k], undefined, `Zeus ne garde pas ${k}`);
  for (const x of ['48.85', '48.86', '2.35', 'Villessai']) assert.ok(!brut.includes(x), `ni position ni nom (${x})`);
  for (const f2 of fichiers(w.home)) { const t = readFileSync(f2, 'utf8'); for (const x of ['48.8566', '2.3522', 'Villessai']) assert.ok(!t.includes(x), `${f2} : ${x}`); }
  // Un relevé deux fois : les mesures ne se doublent pas.
  await run(w, 'releve', { quoi: 'mesure' });
  assert.equal(j.journal(w.ctx).tout().filter((x) => x.t === 'mesure').length, 7);
  // Des prédictions du passé (comme si Zeus tournait depuis 6 jours) : le score apparaît.
  const lieuH = e[0].lieu, today = auj();
  for (let k = 1; k <= 6; k++) j.journal(w.ctx).ajouter({ t: 'prevu', at: '', jour: decaler(today, -k), src: 'gfs_seamless', ech: 1, tmax: 20, tmin: 10, pluie: 0, vent: 20, lieu: lieuH });
  const b = await run(w, 'bilan');
  assert.match(b.text, /OK · NOAA GFS à J\+1 : 6\/6 jours justes · Prédictions justes/);
  assert.ok(b.text.includes(TEXTE_MESURE));
  const vue = await w.mod.view(w.ctx, new URLSearchParams());
  const t = section(vue.sections, 'Qui avait vu juste (14 derniers jours)') as Extract<Section, { kind: 'table' }>;
  assert.ok(t.rows.some((r) => r.cells[0] === 'NOAA GFS' && r.cells[1] === 'OK' && r.cells[3] === '6/6' && r.tone === 'bon'));
  // L'archive en panne : rouge, rien d'inventé.
  f.archive = false;
  const r = await run(w, 'releve', { quoi: 'mesure' });
  assert.equal(r.ok, false); assert.match(r.text, /^Souci : l'archive/);
  // Une source muette 3 jours de suite : une alerte « moyenne » et l'événement source_en_panne.
  f.panne.add('gfs_seamless');
  const emis: string[] = []; const alertes: string[] = [];
  const ctx3 = { ...w.ctx, emit: (t: string) => { emis.push(t); }, alert: (a: { title: string; level: string }) => { alertes.push(`${a.level}:${a.title}`); } } as ModCtx;
  const real = Date.now();
  for (let k = 0; k < 3; k++) { (ctx3 as { now: () => Date }).now = () => new Date(real + k * 86_400_000); await (await import('../src/valhalla/modules/zeus.ts')).releverPrevisions(ctx3, lieuZeus()!); }
  assert.ok(emis.includes('source_en_panne')); assert.deepEqual(alertes, ['moyenne:Zeus : NOAA GFS ne répond plus depuis 3 jours']);
});
function fichiers(d: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) out.push(...fichiers(p)); else out.push(p); }
  return out;
}

test('les adresses écrites dans Hestia (gladsheim.ts) sont celles du module météo unique', () => {
  const g = readFileSync(new URL('../src/valhalla/modules/gladsheim.ts', import.meta.url), 'utf8');
  for (const k of ['geocodage', 'previsions'] as const) {
    const u = new URL(OPEN_METEO[k]);
    assert.ok(g.includes(`'${u.origin}'`) && g.includes(`}${u.pathname}?`), `Hestia : ${OPEN_METEO[k]}`);
  }
  for (const f of ['../src/bifrost/briefing.ts', '../src/guard/alerts.ts']) {
    const t = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(t, /open-meteo\.com/, `${f} passe par OPEN_METEO`); assert.doesNotMatch(t, /weather-geo|setKv\(k,/, `${f} n'écrit plus de position`);
  }
});

test('confidentialité : les anciennes positions en clair sont purgées au démarrage, le fichier compacté ; les alertes n\'en écrivent plus', async (tt) => {
  // purgerPositionsEnClair seul.
  const kv = new Map<string, string>([['weather-geo:paris', '{"lat":48.85}'], ['alerts-seen', 'x']]); let compacte = 0;
  const m = { kvPrefix: (p: string) => Object.fromEntries([...kv].filter(([k]) => k.startsWith(p)).map(([k, v]) => [k.slice(p.length), v])), setKv: (k: string, v: string) => { if (v) kv.set(k, v); else kv.delete(k); }, compacterKv: () => { compacte++; } };
  assert.equal(purgerPositionsEnClair(m), 1); assert.deepEqual([...kv.keys()], ['alerts-seen']); assert.equal(compacte, 1);
  assert.equal(purgerPositionsEnClair(m), 0); assert.equal(compacte, 1, 'rien à purger : pas de réécriture');
  // Un vrai Odin d'essai dont la mémoire contient une position en clair.
  const { makeOdin } = await import('./helpers.ts');
  const { startValhalla } = await import('../src/valhalla/odin.ts');
  const { gladsheim } = await import('../src/valhalla/modules/gladsheim.ts');
  const { zeus } = await import('../src/valhalla/modules/zeus.ts');
  const od = makeOdin([{ text: 'ok' }]); tt.after(() => od.cleanup());
  od.muninn.setKv('weather-geo:villessai', JSON.stringify({ lat: 48.8566, lon: 2.3522, name: 'Villessai' }));
  od.muninn.compacterKv?.();
  const avant = fichiers(od.paths.home).filter((f) => readFileSync(f, 'utf8').includes('weather-geo'));
  assert.ok(avant.length >= 1, 'la position est bien écrite avant le démarrage');
  const stop = startValhalla(od, async () => {}, { modules: [gladsheim, zeus] }); tt.after(() => stop());
  assert.equal(od.muninn.getKv('weather-geo:villessai'), undefined);
  for (const f of avant) assert.doesNotMatch(readFileSync(f, 'utf8'), /weather-geo|48\.8566/, `${f} ne garde plus la position`);
  // Les alertes : la position vient du lieu d'Odin, seule « alerts-seen » est écrite.
  setLieuCourant({ ...LIEU, region: regionDe('FR') }); tt.after(() => setLieuCourant(undefined));
  const ecrit: string[] = [], appels: string[] = [];
  const fauxFetch = (async (u: string | URL) => { appels.push(String(u)); return new Response(JSON.stringify(String(u).includes('forecast') ? { daily: { time: ['2026-11-16'], precipitation_sum: [0], wind_gusts_10m_max: [0], weather_code: [0] } } : { results: [] }), { status: 200 }); }) as typeof fetch;
  await checkLocalAlerts({ getKv: () => undefined, setKv: (k) => { ecrit.push(k); } }, 'Villessai', '', new Date(), fauxFetch);
  assert.deepEqual(ecrit, ['alerts-seen']);
  assert.ok(appels.some((x) => x.startsWith(`${OPEN_METEO.previsions}?latitude=48.8566`)), 'la prévision part du lieu d\'Odin, sans géocodage');
  assert.ok(!appels.some((x) => x.startsWith(OPEN_METEO.geocodage)));
});
