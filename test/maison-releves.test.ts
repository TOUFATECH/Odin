// Les relevés gardés de la maison : ce que mesurent les prises et les capteurs est rangé dans le magasin de
// mesures d'Odin (un point par minute au plus), sous un nom de série fait de l'identifiant nettoyé de
// l'appareil ; l'énergie d'un jour se calcule au fuseau d'Odin, et une absence n'est jamais un zéro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Metrics, setMetrics, metrics, okName, type Point } from '../src/valhalla/metrics.ts';
import * as A from '../src/valhalla/modules/appareils.ts';
import type { Device } from '../src/valhalla/modules/appareils.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const MIN = 60_000, H = 3600_000;
/** Ces relevés sont réservés au propriétaire : une lecture ne les rend que si elle le demande expressément. */
const PRIVE = { prive: true } as const;
const dossier = () => mkdtempSync(join(tmpdir(), 'odin-releves-'));
/** Un magasin neuf, à une horloge qu'on règle. */
function magasin(depart: number) { const dir = dossier(), clock = { t: depart }; const m = new Metrics(dir, () => clock.t); setMetrics(m); return { m, dir, clock, fin: () => { setMetrics(undefined); rmSync(dir, { recursive: true, force: true }); } }; }
const capteur = (id: string, unit: string | undefined, extra: Partial<Device> = {}): Device => ({ id, name: 'Radiateur de Lina', kind: 'capteur', room: 'Bureau', network: 'Prise flashée', attrs: {}, ...(unit ? { unit } : {}), ...extra });

test('une prise qui mesure : ses watts et son énergie sont gardés, au bon instant, à la bonne valeur', () => {
  const t0 = Date.UTC(2026, 10, 20, 9, 30, 12), { m, fin } = magasin(t0);
  try {
    const w = capteur('tasmota_0A0B0C0D0E0F_ENERGY_Power', 'W'), e = capteur('tasmota_0A0B0C0D0E0F_ENERGY_Today', 'kWh');
    assert.equal(A.garderReleve(w, '42.5', t0), true);
    assert.equal(A.garderReleve(e, '1.234', t0), true);
    m.flush();
    const nw = A.nomSerie(w.id, 'puissance')!, ne = A.nomSerie(e.id, 'energie')!;
    assert.deepEqual(m.points(nw, t0 - H, t0 + H, PRIVE), [[Math.floor(t0 / MIN) * MIN, 42.5]]);
    assert.deepEqual(m.points(ne, t0 - H, t0 + H, PRIVE), [[Math.floor(t0 / MIN) * MIN, 1.234]]);
    // Une énergie donnée en Wh est rangée en kWh (une seule unité par série d'énergie).
    const wh = capteur('zb_compteur_energy', 'Wh');
    A.garderReleve(wh, '2500', t0 + MIN); m.flush();
    assert.deepEqual(m.points(A.nomSerie(wh.id, 'energie')!, t0 - H, t0 + H, PRIVE).map((p) => p[1]), [2.5]);
    // Un capteur (température) : sa valeur.
    const th = capteur('tasmota_0A0B0C0D0E0F_AM2301_Temperature', '°C');
    A.garderReleve(th, '21.4', t0 + 2 * MIN); m.flush();
    assert.deepEqual(m.points(A.nomSerie(th.id, 'valeur')!, t0 - H, t0 + H, PRIVE).map((p) => p[1]), [21.4]);
  } finally { fin(); }
});

test('par le relais : un relevé reçu est gardé ; hors ligne, rien ; le nom et la pièce ne sont dans aucune série', async () => {
  const t0 = Date.UTC(2026, 10, 20, 9, 30, 0), { m, clock, fin } = magasin(t0);
  const saved = process.env.MQTT_PASSWORD; process.env.MQTT_PASSWORD = 'relais-de-test';
  const settings: Record<string, unknown> = { port: 0 };
  const ctx = { home: '', dir: '', settings, saveSettings: (p: Record<string, unknown>) => Object.assign(settings, p), alert: () => {}, emit: () => {}, now: () => new Date(clock.t) } as unknown as ModCtx;
  try {
    await A.appareils.start!(ctx);
    const b = A.brokerOf()!;
    b.publish('tasmota/discovery/0A0B0C0D0E0F/config', JSON.stringify({ mac: '0A0B0C0D0E0F', t: 'prise_essai', ft: '%prefix%/%topic%/', tp: ['cmnd', 'stat', 'tele'], rl: [1], dn: 'Radiateur de Lina', onln: 'Online', ofln: 'Offline' }));
    b.publish('tasmota/discovery/0A0B0C0D0E0F/sensors', JSON.stringify({ sn: { ENERGY: { Power: 0, Today: 0 } } }));
    for (const d of Object.values(settings.devices as Record<string, Device>)) d.room = 'Bureau';
    b.publish('tele/prise_essai/SENSOR', JSON.stringify({ ENERGY: { Power: 815.2, Today: 3.25 } }));
    // La prise elle-même (relais ON) n'est pas un relevé.
    b.publish('stat/prise_essai/RESULT', JSON.stringify({ POWER: 'ON' }));
    m.flush();
    const p = A.nomSerie('tasmota_0A0B0C0D0E0F_ENERGY_Power', 'puissance')!, e = A.nomSerie('tasmota_0A0B0C0D0E0F_ENERGY_Today', 'energie')!;
    assert.deepEqual(m.points(p, t0 - H, t0 + H, PRIVE), [[t0, 815.2]]);
    assert.deepEqual(m.points(e, t0 - H, t0 + H, PRIVE), [[t0, 3.25]]);
    assert.deepEqual(m.names('appareils.', PRIVE).sort(), [e, p].sort());
    // Hors ligne : aucun relevé de plus, aucun zéro.
    clock.t = t0 + 5 * MIN;
    b.publish('tele/prise_essai/LWT', 'Offline');
    m.flush();
    assert.deepEqual(m.points(p, t0 - H, t0 + H, PRIVE), [[t0, 815.2]]);
    // Ni le nom de l'appareil, ni la pièce, dans un nom de série.
    for (const n of m.names('', PRIVE)) assert.ok(!/radiateur|lina|bureau/i.test(n), n);
  } finally { A.appareils.stop!(); if (saved === undefined) delete process.env.MQTT_PASSWORD; else process.env.MQTT_PASSWORD = saved; fin(); }
});

test('jamais un zéro à la place d\'une absence : état illisible, vide, infini, invraisemblable', () => {
  const t0 = Date.UTC(2026, 10, 20, 10, 0, 0), { m, fin } = magasin(t0);
  try {
    const w = capteur('zb_prise_power', 'W');
    let t = t0;
    for (const st of ['', 'on', 'off', 'ON', 'unavailable', 'NaN', 'Infinity', '-Infinity', '1e400', '12abc', '0x10', ' ', 'null', '5e9', '-5e9', '[]', '{}', 'true']) { assert.equal(A.garderReleve(w, st, t), false, st); t += MIN; }
    const e = capteur('zb_prise_energy', 'kWh');
    assert.equal(A.garderReleve(e, '-3', t), false); // une énergie cumulée n'est jamais négative
    m.flush();
    assert.deepEqual(m.names('appareils.', PRIVE), []);
    // Pas de relevé ce jour-là : pas de donnée, pas 0.
    assert.equal(A.energieDuJour([], '2026-11-20', 'Europe/Paris'), undefined);
    assert.equal(A.energieDuJour([[Date.UTC(2026, 10, 18, 12), 1], [Date.UTC(2026, 10, 18, 13), 2]], '2026-11-20', 'Europe/Paris'), undefined);
    // Un seul relevé dans le jour : rien de mesurable, pas 0.
    assert.equal(A.energieDuJour([[Date.UTC(2026, 10, 20, 12), 1]], '2026-11-20', 'Europe/Paris'), undefined);
    // Un jour ou un fuseau illisibles : pas de donnée.
    assert.equal(A.energieDuJour([[Date.UTC(2026, 10, 20, 12), 1], [Date.UTC(2026, 10, 20, 13), 2]], '20/11/2026', 'Europe/Paris'), undefined);
    assert.equal(A.energieDuJour([[Date.UTC(2026, 10, 20, 12), 1], [Date.UTC(2026, 10, 20, 13), 2]], '2026-11-20', 'Pas/Un_Fuseau'), undefined);
    // Sans fuseau : pas de repli sur celui de la machine.
    assert.equal(A.energieDuJour([[Date.UTC(2026, 10, 20, 12), 1], [Date.UTC(2026, 10, 20, 13), 2]], '2026-11-20', ''), undefined);
    assert.equal(A.energieDuJour([[Date.UTC(2026, 10, 20, 12), 1], [Date.UTC(2026, 10, 20, 13), 2]], '2026-11-20', undefined as unknown as string), undefined);
  } finally { fin(); }
});

test('un appareil qui ne mesure pas (lampe, interrupteur, détecteur) n\'écrit rien', () => {
  const t0 = Date.UTC(2026, 10, 20, 11, 0, 0), { m, fin } = magasin(t0);
  try {
    const lampe: Device = { id: 'zb_lampe', name: 'Lampe', kind: 'lumière', room: '', network: 'Zigbee', attrs: {} };
    const inter: Device = { id: 'tasmota_0A0B0C0D0E0F_1', name: 'Prise', kind: 'prise', room: '', network: 'Prise flashée', attrs: {} };
    const porte: Device = { id: 'zb_porte', name: 'Porte', kind: 'détecteur', room: '', network: 'Zigbee', attrs: {} };
    const reglage: Device = { id: 'zb_reglage', name: 'Réglage', kind: 'réglage', room: '', network: 'Zigbee', attrs: {}, unit: 'W' };
    for (const d of [lampe, inter, porte, reglage]) for (const st of ['ON', 'OFF', '1', '0', '42']) assert.equal(A.garderReleve(d, st, t0), false, `${d.kind} ${st}`);
    m.flush();
    assert.deepEqual(m.names('appareils.', PRIVE), []);
  } finally { fin(); }
});

test('un appareil bavard : un point par minute au plus, et c\'est le premier relevé de la minute', () => {
  const t0 = Date.UTC(2026, 10, 20, 12, 0, 0), { m, fin } = magasin(t0);
  try {
    const w = capteur('zb_bavard_power', 'W');
    let gardes = 0;
    for (let i = 0; i < 3 * 600; i++) if (A.garderReleve(w, String(100 + i), t0 + i * 100)) gardes++; // 10 relevés par seconde pendant 3 minutes
    m.flush();
    assert.equal(gardes, 3);
    assert.deepEqual(m.points(A.nomSerie(w.id, 'puissance')!, t0 - H, t0 + H, PRIVE), [[t0, 100], [t0 + MIN, 700], [t0 + 2 * MIN, 1300]]);
  } finally { fin(); }
});

test('un identifiant piégé ne casse rien et n\'écrit rien d\'inattendu', () => {
  const t0 = Date.UTC(2026, 10, 20, 13, 0, 0), { m, fin } = magasin(t0);
  try {
    const pieges = ['__proto__', 'constructor', 'x'.repeat(5000), '../../etc/passwd', 'a/b', 'a_b', 'a.b', 'é ; rm -rf', `\u0000${String.fromCharCode(0x202e)}`, '<script>', 'hasOwnProperty'];
    let t = t0;
    for (const id of pieges) { assert.doesNotThrow(() => A.garderReleve(capteur(id, 'W'), '10', t)); t += MIN; }
    assert.equal(A.garderReleve(capteur('', 'W'), '10', t), false);
    m.flush();
    const noms = m.names('appareils.', PRIVE);
    assert.equal(noms.length, pieges.length);
    for (const n of noms) { assert.ok(okName(n), n); assert.match(n, /^appareils\.[A-Za-z0-9_-]{1,80}\.puissance$/); }
    // Deux identifiants que le nettoyage rapprocherait gardent deux séries.
    assert.notEqual(A.nomSerie('a/b', 'puissance'), A.nomSerie('a_b', 'puissance'));
    // Le même identifiant donne toujours le même nom.
    assert.equal(A.nomSerie('a/b', 'puissance'), A.nomSerie('a/b', 'puissance'));
    assert.equal(({} as Record<string, unknown>).puissance, undefined);
    assert.equal(Object.getPrototypeOf({}), Object.prototype);
    for (const f of readdirSync(m.dir)) assert.match(f, /^(\d{4}-\d{2}-\d{2}|heures-\d{4}-\d{2})\.jsonl$/);
  } finally { fin(); }
});

test('un identifiant fait du nom ou de la pièce (annonce du réseau) ne les laisse pas passer dans le nom de série', () => {
  const t0 = Date.UTC(2026, 10, 20, 14, 0, 0), { m, fin } = magasin(t0);
  try {
    // Une annonce prend unique_id, ou sinon « <nœud>_<objet> » du sujet, souvent tirés du nom choisi par la famille.
    const annonce = A.fromDiscovery('homeassistant/sensor/maison-salon/salon_puissance/config', JSON.stringify({ name: 'Puissance du salon', unit_of_measurement: 'W', state_topic: 'essai/salon/puissance' }))!;
    assert.equal(annonce.id, 'maison-salon_salon_puissance');
    const ids = [annonce.id, 'radiateur_chambre_lina_power', 'Radiateur de Lina'];
    let t = t0;
    for (const id of ids) { assert.equal(A.garderReleve(capteur(id, 'W'), '42', t), true, id); t += MIN; }
    m.flush();
    const noms = m.names('appareils.', PRIVE);
    assert.equal(noms.length, ids.length);
    for (const n of noms) { assert.match(n, /^appareils\.[0-9a-f]{16}\.puissance$/); assert.ok(!/salon|chambre|lina|radiateur|maison/i.test(n), n); }
    // Stable : le même identifiant donne toujours la même série ; deux mesures, deux séries.
    assert.equal(A.nomSerie(ids[1], 'puissance'), A.nomSerie(ids[1], 'puissance'));
    assert.notEqual(A.nomSerie(ids[1], 'puissance'), A.nomSerie(ids[1], 'energie'));
  } finally { fin(); }
});

test('sans magasin de mesures (Odin d\'essai sans service) : rien ne casse, rien n\'est écrit', () => {
  setMetrics(undefined);
  assert.equal(metrics(), undefined);
  assert.equal(A.garderReleve(capteur('zb_prise_power', 'W'), '42', Date.now()), false);
});

// --- L'énergie d'un jour (fonction pure), au fuseau d'Odin.
/** Un compteur qui avance de `pas` kWh toutes les `ecart` ms, de `de` à `a` (exclu). */
const compteur = (de: number, a: number, ecart: number, pas: number, depart = 0): Point[] => { const out: Point[] = []; let v = depart; for (let t = de; t < a; t += ecart) { out.push([t, Math.round(v * 1e6) / 1e6]); v += pas; } return out; };

test('le total du jour : au fuseau d\'Odin, jamais celui de la machine ni UTC', () => {
  // Kiritimati est à UTC+14 : son 20 novembre va du 19 à 10:00 UTC au 20 à 10:00 UTC.
  const pts = compteur(Date.UTC(2026, 10, 19, 0), Date.UTC(2026, 10, 21, 0), 10 * MIN, 0.01);
  assert.equal(A.energieDuJour(pts, '2026-11-20', 'Pacific/Kiritimati'), 1.44);
  // Le même relevé, compté au fuseau de Los Angeles (UTC-8) pour le 19 : du 19 à 08:00 UTC au 20 à 08:00 UTC.
  assert.equal(A.energieDuJour(pts, '2026-11-19', 'America/Los_Angeles'), 1.44);
  // Le 19 à Kiritimati : relevés seulement à partir de 14:00 (heure de là-bas), soit 59 écarts ; compté en UTC, ce serait 1,43.
  assert.equal(A.energieDuJour(pts, '2026-11-19', 'Pacific/Kiritimati'), 0.59);
  // Le 21 à Kiritimati : de minuit (là-bas) au dernier relevé, 84 écarts ; en UTC, ce jour n'a aucun relevé.
  assert.equal(A.energieDuJour(pts, '2026-11-21', 'Pacific/Kiritimati'), 0.84);
});

test('le total du jour : changement d\'heure (23 h au printemps, 25 h à l\'automne)', () => {
  // Paris, 29 mars 2026 : 23 heures (du 28 à 23:00 UTC au 29 à 22:00 UTC).
  const printemps = compteur(Date.UTC(2026, 2, 28, 12), Date.UTC(2026, 2, 30, 12), 10 * MIN, 0.01);
  assert.equal(A.energieDuJour(printemps, '2026-03-29', 'Europe/Paris'), 1.38);
  // Paris, 25 octobre 2026 : 25 heures (du 24 à 22:00 UTC au 25 à 23:00 UTC).
  const automne = compteur(Date.UTC(2026, 9, 24, 12), Date.UTC(2026, 9, 26, 12), 10 * MIN, 0.01);
  assert.equal(A.energieDuJour(automne, '2026-10-25', 'Europe/Paris'), 1.5);
});

test('le total du jour : compteur qui repart de zéro (minuit, coupure), qui recule, trou dans les relevés', () => {
  const j = Date.UTC(2026, 10, 20, 0), tz = 'UTC';
  // Remis à zéro à minuit (énergie « du jour ») : le relevé d'après minuit compte depuis zéro.
  const minuit: Point[] = [[j - 20 * MIN, 5.0], [j - 10 * MIN, 5.1], [j, 0.01], [j + 10 * MIN, 0.02], [j + 20 * MIN, 0.05]];
  assert.equal(A.energieDuJour(minuit, '2026-11-20', tz), 0.05);
  // Coupure au milieu du jour : le compteur repart d'en bas, l'énergie d'après la coupure s'ajoute.
  const coupure: Point[] = [[j + H, 2.0], [j + 2 * H, 2.1], [j + 3 * H, 0.05], [j + 4 * H, 0.15]];
  assert.equal(A.energieDuJour(coupure, '2026-11-20', tz), 0.25);
  // Un relevé qui recule un peu : ignoré, rien n'est compté deux fois.
  const recule: Point[] = [[j + H, 2.0], [j + 2 * H, 2.1], [j + 3 * H, 2.08], [j + 4 * H, 2.2]];
  assert.equal(A.energieDuJour(recule, '2026-11-20', tz), 0.2);
  // Un trou de six heures dans le même jour : l'énergie du trou est dans l'écart du compteur.
  const trou: Point[] = [[j + H, 1.0], [j + 2 * H, 1.5], [j + 8 * H, 4.5], [j + 9 * H, 5.0]];
  assert.equal(A.energieDuJour(trou, '2026-11-20', tz), 4);
  // Un trou qui passe minuit : l'énergie du trou n'est pas mise sur ce jour ; on repart du premier relevé du jour.
  const nuit: Point[] = [[j - 3 * H, 1.0], [j + 2 * H, 2.0], [j + 3 * H, 2.4]];
  assert.equal(A.energieDuJour(nuit, '2026-11-20', tz), 0.4);
  // Un compteur qui ne bouge pas : un vrai zéro mesuré (deux relevés), pas une absence.
  assert.equal(A.energieDuJour([[j + H, 3], [j + 2 * H, 3]], '2026-11-20', tz), 0);
  // Des points dans le désordre ou illisibles ne changent rien.
  const melange: Point[] = [[j + 2 * H, 2.1], [j + H, 2.0], [j + 3 * H, Number.NaN], [j + 4 * H, 2.3]];
  assert.equal(A.energieDuJour(melange, '2026-11-20', tz), 0.3);
});

test('le ménage du magasin passe sur ces séries (les minutes de plus de 31 jours partent)', () => {
  const vieux = Date.UTC(2026, 9, 1, 12), { m, clock, fin } = magasin(vieux);
  try {
    const w = capteur('zb_prise_power', 'W'), n = A.nomSerie(w.id, 'puissance')!;
    A.garderReleve(w, '40', vieux); m.flush();
    assert.equal(m.points(n, vieux - H, vieux + H, PRIVE).length, 1);
    const minutes = () => readdirSync(m.dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && readFileSync(join(m.dir, f), 'utf8').includes(n));
    assert.equal(minutes().length, 1);
    clock.t = vieux + 40 * 864e5;
    assert.ok(m.prune(31) >= 1);
    assert.deepEqual(minutes(), []);
  } finally { fin(); }
});

test('réservés au propriétaire : sans le demander expressément, aucune lecture du magasin ne rend ces relevés', () => {
  const t0 = Date.UTC(2026, 10, 20, 9, 30, 0), { m, clock, fin } = magasin(t0);
  try {
    const w = capteur('zb_prise_power', 'W'), n = A.nomSerie(w.id, 'puissance')!;
    assert.equal(A.garderReleve(w, '815', t0), true);
    m.put({ 'eir.cpu': 12 }, t0);
    // Tant que la minute n'est pas écrite, puis une fois écrite sur le disque : le même refus.
    for (const ecrit of [false, true]) {
      if (ecrit) m.flush();
      // Sans le demander : ni son nom, ni un point, ni une courbe, ni une valeur, ni l'export.
      assert.deepEqual(m.names(), ['eir.cpu'], `les noms (écrit : ${ecrit})`);
      assert.deepEqual(m.names('appareils.'), []);
      assert.deepEqual(m.names(n), []);
      assert.deepEqual(m.points(n, t0 - H, t0 + H), []);
      assert.deepEqual(m.series(n, t0 - H, t0 + H), []);
      for (const f of ['avg', 'min', 'max', 'last', 'delta', 'count'] as const) assert.equal(m.fn(n, f, 2 * H), undefined, f);
      assert.equal(m.prometheus(), `# TYPE odin_eir_cpu gauge\nodin_eir_cpu 12 ${t0}\n`);
      // Une autre casse ne contourne rien.
      assert.deepEqual(m.points(n.toUpperCase(), t0 - H, t0 + H), []);
      assert.deepEqual(m.names('APPAREILS.'), []);
      // En le demandant (un code réservé au propriétaire) : tout est là.
      assert.deepEqual(m.names('', PRIVE), [n, 'eir.cpu'].sort());
      assert.deepEqual(m.points(n, t0 - H, t0 + H, PRIVE), [[t0, 815]]);
      assert.equal(m.series(n, t0 - H, t0 + H, 120, PRIVE).length, 1);
      assert.equal(m.fn(n, 'last', 2 * H, PRIVE), 815);
      // Les autres séries ne changent pas, avec ou sans la demande.
      assert.deepEqual(m.points('eir.cpu', t0 - H, t0 + H), [[t0, 12]]);
      assert.equal(m.fn('eir.cpu', 'last', 2 * H), 12);
    }
    // Plus tard, relu dans les fichiers du jour (au-delà de la mémoire des deux dernières heures) : le même refus.
    clock.t = t0 + 5 * H;
    assert.deepEqual(m.points(n, t0 - H, t0 + 5 * H), []);
    assert.deepEqual(m.points(n, t0 - H, t0 + 5 * H, PRIVE), [[t0, 815]]);
    assert.ok(!m.prometheus().includes('appareils'));
    // Une série écrite avec une autre casse (« Appareils. ») reste réservée : la garde ne dépend pas de la casse.
    const autre = 'Appareils.x.puissance';
    m.put({ [autre]: 7 }, clock.t);
    for (const ecrit of [false, true]) {
      if (ecrit) m.flush();
      assert.deepEqual(m.names(), ['eir.cpu'], `autre casse, les noms (écrit : ${ecrit})`);
      assert.deepEqual(m.names('Appareils.'), []);
      assert.deepEqual(m.points(autre, clock.t - H, clock.t + H), []);
      assert.deepEqual(m.series(autre, clock.t - H, clock.t + H), []);
      assert.equal(m.fn(autre, 'last', 2 * H), undefined);
      assert.ok(!/appareils/i.test(m.prometheus()));
      assert.deepEqual(m.points(autre, clock.t - H, clock.t + H, PRIVE), [[clock.t, 7]]);
    }
  } finally { fin(); }
});
