// Le ménage du magasin de mesures : les relevés à la minute de plus de 31 jours sont effacés tout seuls, une fois
// par jour et une première fois peu après le démarrage, sans minuterie ; avant d'effacer un jour, toutes ses
// heures sont dans le fichier des heures (une heure coupée par un arrêt d'Odin est calculée et rangée d'abord) ;
// rien n'est effacé si cette écriture échoue ou si l'horloge de la machine paraît fausse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Metrics } from '../src/valhalla/metrics.ts';

const MIN = 60_000, H = 3600_000, J = 864e5;
const PRIVE = { prive: true } as const;
const deux = (n: number) => String(n).padStart(2, '0');
/** Le jour local d'un instant, comme le magasin nomme ses fichiers. */
const jour = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`; };
const mois = (t: number) => jour(t).slice(0, 7);
/**
 * Il y a `n` jours, vers l'heure locale `h`:`mn`, ramené au début de son heure rangée (une heure ronde en temps
 * universel : dans un fuseau décalé d'une demi-heure, 10 h locale n'est pas le début d'une heure du magasin).
 */
const ilYa = (depuis: number, n: number, h: number, mn = 0) => { const d = new Date(depuis); d.setDate(d.getDate() - n); d.setHours(h, mn, 0, 0); return Math.floor(d.getTime() / H) * H; };
/** Lance `f` dans le fuseau `tz`, puis remet celui d'avant. */
function dansLeFuseau<T>(tz: string, f: () => T): T {
  const avant = process.env.TZ; process.env.TZ = tz;
  try { return f(); } finally { if (avant === undefined) delete process.env.TZ; else process.env.TZ = avant; }
}
const dossier = () => mkdtempSync(join(tmpdir(), 'odin-menage-'));
function magasin(depart: number) { const dir = dossier(), clock = { t: depart }; const m = new Metrics(dir, () => clock.t); return { m, dir, clock, fin: () => rmSync(dir, { recursive: true, force: true }) }; }
/** Écrit des lignes de minutes dans le fichier du jour, comme le rangement le fait. */
const minutes = (dir: string, lignes: Array<[number, Record<string, number>]>) => { for (const [t, v] of lignes) appendFileSync(join(dir, `${jour(t)}.jsonl`), `${JSON.stringify({ t, v })}\n`); };
/** Toutes les moyennes par heure rangées : « instant|série » → [moyenne, min, max] et le nombre de fois. */
function heures(dir: string) {
  const vu = new Map<string, [number, number, number]>(), fois = new Map<string, number>();
  for (const f of readdirSync(dir)) {
    if (!/^heures-\d{4}-\d{2}\.jsonl$/.test(f)) continue;
    for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) { if (!l) continue; try { const x = JSON.parse(l) as { t: number; v: Record<string, [number, number, number]> }; for (const [k, v] of Object.entries(x.v)) { vu.set(`${x.t}|${k}`, v); fois.set(`${x.t}|${k}`, (fois.get(`${x.t}|${k}`) ?? 0) + 1); } } catch { /* ligne coupée */ } }
  }
  return { vu, fois };
}
/** Laisse passer les tours de boucle où le ménage automatique travaille. */
const attendre = async () => { for (let i = 0; i < 300; i++) await new Promise((r) => setImmediate(r)); };

test('il part tout seul après un démarrage et au changement de jour, sans minuterie ; seuls les fichiers de minutes de plus de 31 jours partent', async (t) => {
  const t0 = new Date(2026, 10, 26, 9, 0, 30).getTime(), { m, dir, clock, fin } = magasin(t0);
  const ailleurs = dossier();
  try {
    const vieux40 = ilYa(t0, 40, 10), vieux35 = ilYa(t0, 35, 10), pile = ilYa(t0, 31, 10);
    minutes(dir, [[vieux40, { 'eir.cpu': 4 }], [vieux35, { 'eir.cpu': 6 }], [pile, { 'eir.cpu': 8 }]]);
    // Ce qui n'est jamais touché : un fichier d'heures, un autre fichier, un dossier ou un lien au nom d'un jour.
    const fHeures = join(dir, 'heures-2025-01.jsonl'), avantHeures = `${JSON.stringify({ t: new Date(2025, 0, 5, 3).getTime(), v: { 'eir.cpu': [1, 1, 1] } })}\n`;
    writeFileSync(fHeures, avantHeures);
    for (const f of ['notes.txt', '2020-01-01.jsonl.bak', 'x2020-01-02.jsonl']) writeFileSync(join(dir, f), 'à garder');
    mkdirSync(join(dir, '2020-01-03.jsonl'));
    const cible = join(ailleurs, 'cible.jsonl'); writeFileSync(cible, 'à garder');
    let lien = false; try { symlinkSync(cible, join(dir, '2020-01-04.jsonl')); lien = true; } catch { t.diagnostic('lien symbolique impossible ici : cette partie est sautée'); }
    // Un lien vers un dossier (une jonction sous Windows, permise sans droits d'administrateur).
    let jonction = false; try { symlinkSync(ailleurs, join(dir, '2020-01-05.jsonl'), 'junction'); jonction = true; } catch { t.diagnostic('jonction impossible ici : cette partie est sautée'); }
    // Le premier rangement après le démarrage : le ménage part, mais après le rangement (la minute n'attend pas).
    m.put({ 'eir.cpu': 1 }); clock.t += MIN; m.put({ 'eir.cpu': 2 });
    assert.ok(existsSync(join(dir, `${jour(vieux40)}.jsonl`)), 'le rangement ne fait pas le ménage lui-même');
    await attendre();
    assert.ok(!existsSync(join(dir, `${jour(vieux40)}.jsonl`)) && !existsSync(join(dir, `${jour(vieux35)}.jsonl`)), 'les jours de plus de 31 jours partent');
    assert.ok(existsSync(join(dir, `${jour(pile)}.jsonl`)), 'un fichier de 31 jours pile reste');
    assert.ok(readFileSync(fHeures, 'utf8').startsWith(avantHeures), 'un fichier d\'heures garde toutes ses lignes');
    for (const f of ['notes.txt', '2020-01-01.jsonl.bak', 'x2020-01-02.jsonl']) assert.equal(readFileSync(join(dir, f), 'utf8'), 'à garder', f);
    assert.ok(existsSync(join(dir, '2020-01-03.jsonl')), 'un dossier n\'est jamais effacé');
    if (lien) assert.ok(existsSync(join(dir, '2020-01-04.jsonl')), 'un lien n\'est jamais suivi ni effacé');
    if (jonction) assert.ok(existsSync(join(dir, '2020-01-05.jsonl')) && existsSync(cible), 'une jonction n\'est jamais suivie ni effacée');
    assert.equal(readFileSync(cible, 'utf8'), 'à garder');
    const premier = m.dernierMenage; assert.ok(premier, 'le ménage dit ce qu\'il a fait');
    assert.equal(premier.effaces, 2);
    // Le dossier, le lien et la jonction au nom d'un jour ne sont même pas ouverts (ni lus, ni comptés « gardés »).
    assert.equal(premier.gardes, 0); assert.equal(premier.illisibles, 0);
    // Le même jour, d'autres rangements : pas d'autre ménage.
    for (let i = 0; i < 10; i++) { clock.t += MIN; m.put({ 'eir.cpu': i }); }
    await attendre();
    assert.equal(m.dernierMenage, premier, 'une fois par jour');
    // Le lendemain : un nouveau ménage, tout seul.
    const demain = t0 + J; minutes(dir, [[ilYa(demain, 32, 10), { 'eir.cpu': 3 }]]);
    clock.t = demain; m.put({ 'eir.cpu': 1 }); clock.t += MIN; m.put({ 'eir.cpu': 1 });
    await attendre();
    assert.notEqual(m.dernierMenage, premier);
    assert.ok(!existsSync(join(dir, `${jour(ilYa(demain, 32, 10))}.jsonl`)));
    // Un redémarrage le même jour : un ménage de plus, peu après.
    const vieux33 = ilYa(clock.t, 33, 11); minutes(dir, [[vieux33, { 'eir.cpu': 9 }]]);
    const m2 = new Metrics(dir, () => clock.t); clock.t += MIN; m2.put({ 'eir.cpu': 1 }); clock.t += MIN; m2.put({ 'eir.cpu': 1 });
    await attendre();
    assert.ok(!existsSync(join(dir, `${jour(vieux33)}.jsonl`)), 'après un démarrage');
  } finally { fin(); rmSync(ailleurs, { recursive: true, force: true }); }
});

test('aucune minuterie dans le magasin : le ménage part du rangement qui existe', () => {
  const src = readFileSync(new URL('../src/valhalla/metrics.ts', import.meta.url), 'utf8');
  assert.ok(!src.includes('setInterval(') && !src.includes('setTimeout('));
});

test('une heure coupée par un arrêt est calculée et rangée avant l\'effacement, sans doublon', () => {
  const t0 = new Date(2026, 10, 26, 12, 0, 0).getTime(), { m, dir, fin } = magasin(t0);
  try {
    const h10 = ilYa(t0, 40, 10), h11 = h10 + H;
    const lignes: Array<[number, Record<string, number>]> = [[h10, { a: 10 }], [h10 + MIN, { a: 20, b: 5 }], [h11, { a: 1 }], [h11 + MIN, { a: 3 }], [h11 + 30 * MIN, { b: 7 }]];
    minutes(dir, lignes);
    // L'heure de 10 h est déjà rangée pour « a » (pas pour « b ») ; l'heure de 11 h a été coupée par un arrêt.
    appendFileSync(join(dir, `heures-${mois(h10)}.jsonl`), `${JSON.stringify({ t: h10, v: { a: [15, 10, 20] } })}\n`);
    const b = m.menage();
    assert.equal(b.effaces, 1); assert.equal(b.gardes, 0);
    assert.ok(!existsSync(join(dir, `${jour(h10)}.jsonl`)));
    const { vu, fois } = heures(dir);
    assert.deepEqual(vu.get(`${h10}|a`), [15, 10, 20]); assert.deepEqual(vu.get(`${h10}|b`), [5, 5, 5]);
    assert.deepEqual(vu.get(`${h11}|a`), [2, 1, 3]); assert.deepEqual(vu.get(`${h11}|b`), [7, 7, 7]);
    assert.ok([...fois.values()].every((n) => n === 1), 'aucune heure en double');
    // Les lectures au-delà de 31 jours rendent ces heures.
    assert.deepEqual(m.points('a', t0 - 60 * J, t0), [[h10, 15], [h11, 2]]);
    assert.deepEqual(m.points('b', t0 - 60 * J, t0), [[h10, 5], [h11, 7]]);
    // Le même jour revenu (une copie remise) : effacé encore, toujours sans doublon.
    minutes(dir, lignes); m.menage();
    assert.ok([...heures(dir).fois.values()].every((n) => n === 1));
    assert.deepEqual(m.points('a', t0 - 60 * J, t0), [[h10, 15], [h11, 2]]);
  } finally { fin(); }
});

test('l\'heure encore en mémoire d\'un magasin qui tourne est rangée une seule fois', () => {
  const vieux = new Date(2026, 9, 1, 10, 0, 30).getTime(), { m, dir, clock, fin } = magasin(vieux);
  try {
    m.put({ a: 2 }); clock.t += MIN; m.put({ a: 4 }); m.flush();
    clock.t += 40 * J; m.menage();
    clock.t += MIN; m.put({ a: 1 }); clock.t += MIN; m.put({ a: 1 }); m.flush();
    assert.ok([...heures(dir).fois.values()].every((n) => n === 1));
    assert.deepEqual(m.points('a', vieux - 2 * H, vieux + 2 * H), [[Math.floor(vieux / H) * H, 3]]);
  } finally { fin(); }
});

test('si l\'écriture des heures échoue, le jour n\'est pas effacé ; une ligne coupée au bout du fichier des heures ne gêne pas', () => {
  const t0 = new Date(2026, 10, 26, 12, 0, 0).getTime(), { m, dir, fin } = magasin(t0);
  try {
    const h = ilYa(t0, 40, 10), f = join(dir, `${jour(h)}.jsonl`), fh = join(dir, `heures-${mois(h)}.jsonl`);
    minutes(dir, [[h, { a: 4 }]]);
    mkdirSync(fh); // l'écriture des heures ne peut pas se faire
    const b = m.menage();
    assert.equal(b.effaces, 0); assert.equal(b.gardes, 1); assert.ok(existsSync(f), 'gardé, nouvel essai le lendemain');
    rmSync(fh, { recursive: true });
    writeFileSync(fh, '{"t":12,"v":{"a":[1'); // une ligne coupée (un arrêt brutal pendant une écriture)
    assert.equal(m.menage().effaces, 1);
    assert.deepEqual(heures(dir).vu.get(`${h}|a`), [4, 4, 4]);
  } finally { fin(); }
});

test('un fichier de minutes à moitié illisible : ses bonnes lignes comptent, les autres sont dites', () => {
  const t0 = new Date(2026, 10, 26, 12, 0, 0).getTime(), { m, dir, fin } = magasin(t0);
  try {
    const h = ilYa(t0, 40, 10);
    writeFileSync(join(dir, `${jour(h)}.jsonl`), `${JSON.stringify({ t: h, v: { a: 4 } })}\npas du json\n{"t":"x","v":{}}\n${JSON.stringify({ t: h + MIN, v: { a: 6 } })}\n{"t":12`);
    const b = m.menage();
    assert.equal(b.effaces, 1); assert.equal(b.illisibles, 3);
    assert.deepEqual(heures(dir).vu.get(`${h}|a`), [5, 4, 6]);
  } finally { fin(); }
});

test('une horloge reculée ou sautée d\'un an : rien n\'est effacé ce jour-là', () => {
  const t0 = new Date(2026, 10, 26, 12, 0, 0).getTime(), { m, dir, clock, fin } = magasin(t0);
  try {
    const vieux = ilYa(t0, 40, 10), futur = ilYa(t0, -2, 10);
    minutes(dir, [[vieux, { a: 1 }], [futur, { a: 2 }]]);
    let b = m.menage();
    assert.equal(b.effaces, 0); assert.equal(b.horloge, 'reculee'); assert.ok(existsSync(join(dir, `${jour(vieux)}.jsonl`)));
    rmSync(join(dir, `${jour(futur)}.jsonl`));
    // Le dernier rangement date de plus d'un an : la date de la machine a sauté.
    clock.t = t0 + 400 * J; minutes(dir, [[clock.t, { a: 3 }]]);
    b = m.menage();
    assert.equal(b.effaces, 0); assert.equal(b.horloge, 'sautee'); assert.ok(existsSync(join(dir, `${jour(vieux)}.jsonl`)));
    assert.equal(m.prune(31), 0);
    // Le lendemain, la nouvelle date tient encore : rien n'est effacé tant que le saut a moins de 31 jours
    // (une date fausse qui dure plusieurs jours ne fait pas partir les vrais jours récents).
    const saut = clock.t;
    clock.t += J; minutes(dir, [[clock.t, { a: 3 }]]);
    b = m.menage();
    assert.equal(b.effaces, 0); assert.equal(b.horloge, 'sautee'); assert.ok(existsSync(join(dir, `${jour(vieux)}.jsonl`)));
    // Trente-deux jours après le saut, la nouvelle date est la bonne : le ménage reprend, les heures rangées d'abord.
    clock.t = saut + 32 * J; minutes(dir, [[clock.t, { a: 3 }]]);
    b = m.menage();
    assert.equal(b.horloge, undefined); assert.equal(b.effaces, 2);
    assert.ok(!existsSync(join(dir, `${jour(vieux)}.jsonl`)));
    assert.deepEqual(heures(dir).vu.get(`${Math.floor(vieux / H) * H}|a`), [1, 1, 1]);
  } finally { fin(); }
});

test('une date sautée pendant plusieurs jours n\'efface aucun vrai jour récent, et rien de ce qui vient de la fausse date', () => {
  const t0 = new Date(2026, 10, 26, 12, 0, 30).getTime(), { m, dir, clock, fin } = magasin(t0);
  try {
    // Vingt vrais jours de relevés, puis la date de la machine saute en 2099 et y reste cinq jours.
    const vrais: number[] = []; for (let d = 0; d < 20; d++) { const h = ilYa(t0, d, 10); vrais.push(h); minutes(dir, [[h, { a: d }]]); }
    const faux = new Date(2099, 0, 10, 12, 0, 30).getTime();
    for (let j = 0; j < 5; j++) {
      clock.t = faux + j * J; m.put({ a: 1 }); clock.t += MIN; m.put({ a: 2 }); m.flush();
      const b = m.menage();
      assert.equal(b.effaces, 0, `jour ${j + 1} de la date fausse`); assert.equal(b.horloge, 'sautee');
    }
    for (const h of vrais) assert.ok(existsSync(join(dir, `${jour(h)}.jsonl`)), `le vrai jour ${jour(h)} reste`);
    // La date revient : les fichiers de 2099 paraissent venir du futur, rien n'est effacé (ni eux, ni les vrais jours).
    clock.t = t0 + J;
    const b = m.menage();
    assert.equal(b.effaces, 0); assert.equal(b.horloge, 'reculee');
    for (const h of vrais) assert.ok(existsSync(join(dir, `${jour(h)}.jsonl`)));
    assert.ok(existsSync(join(dir, `${jour(faux)}.jsonl`)), 'un fichier de la fausse date n\'est jamais effacé par le ménage');
  } finally { fin(); }
});

test('si les heures ajoutées ne se relisent pas dans le fichier des heures, le jour n\'est pas effacé', (t) => {
  const t0 = new Date(2026, 10, 26, 12, 0, 0).getTime(), { m, dir, fin } = magasin(t0);
  const h = ilYa(t0, 40, 10), f = join(dir, `${jour(h)}.jsonl`), fh = join(dir, `heures-${mois(h)}.jsonl`);
  try {
    minutes(dir, [[h, { a: 4 }]]);
    // Un fichier des heures lisible, mais où l'on ne peut pas écrire : la lecture réussit, l'ajout échoue sans bruit.
    const autre = `${JSON.stringify({ t: h - 5 * H, v: { a: [1, 1, 1] } })}\n`;
    writeFileSync(fh, autre); chmodSync(fh, 0o444);
    try { appendFileSync(fh, 'x'); t.skip('fichier en lecture seule impossible ici'); return; } catch { /* l'ajout échoue : c'est ce que l'on veut */ }
    const b = m.menage();
    assert.equal(b.effaces, 0); assert.equal(b.gardes, 1); assert.equal(b.heures, 0);
    assert.ok(existsSync(f), 'gardé : son heure n\'est pas dans le fichier des heures');
    assert.equal(readFileSync(fh, 'utf8'), autre);
  } finally { try { chmodSync(fh, 0o644); } catch { /* */ } fin(); }
});

test('heure d\'hiver ou d\'été : un fichier de 31 jours pile reste, et rien de ce que les lectures relisent ne part', () => {
  dansLeFuseau('Europe/Paris', () => {
    // Le 20/11 à 23 h 30 (heure d'hiver) : le 20/10 (heure d'été) a 31 jours pile sur le calendrier.
    const now = new Date(2026, 10, 20, 23, 30).getTime(), { m, dir, fin } = magasin(now);
    try {
      const pile = ilYa(now, 31, 10), avant = ilYa(now, 32, 10);
      minutes(dir, [[pile, { a: 1 }], [avant, { a: 2 }]]);
      const b = m.menage();
      assert.ok(existsSync(join(dir, `${jour(pile)}.jsonl`)), `le ${jour(pile)} (31 jours pile) reste`);
      assert.ok(!existsSync(join(dir, `${jour(avant)}.jsonl`))); assert.equal(b.effaces, 1);
      // Ces deux heures, plus vieilles que la fenêtre des minutes, se lisent par leurs moyennes rangées.
      assert.deepEqual(m.points('a', now - 60 * J, now), [[avant, 2], [pile, 1]]);
    } finally { fin(); }
    // Le 20/04 à 0 h 30 (heure d'été) : les lectures relisent encore les minutes du 19/03 après 23 h 30.
    const ete = new Date(2027, 3, 20, 0, 30).getTime(), s = magasin(ete);
    try {
      const tard = new Date(2027, 2, 19, 23, 45).getTime();
      minutes(s.dir, [[tard, { a: 7 }]]);
      const lu = s.m.points('a', ete - 31 * J, ete);
      assert.deepEqual(lu, [[tard, 7]]);
      s.m.menage();
      assert.ok(existsSync(join(s.dir, `${jour(tard)}.jsonl`)), 'un jour encore relu en minutes reste');
      assert.deepEqual(s.m.points('a', ete - 31 * J, ete), lu);
    } finally { s.fin(); }
  });
});

test('une heure à cheval sur deux jours (fuseau décalé d\'une demi-heure) est rangée entière, une seule fois', () => {
  dansLeFuseau('Asia/Kolkata', () => {
    const t0 = new Date(2026, 10, 26, 12, 0, 0).getTime(), { m, dir, fin } = magasin(t0);
    try {
      // 23 h 40 et 0 h 10 locales : la même heure rangée (18 h en temps universel), sur deux fichiers de jour.
      const soir = new Date(2026, 9, 10, 23, 40).getTime(), nuit = new Date(2026, 9, 11, 0, 10).getTime(), h = Math.floor(soir / H) * H;
      assert.equal(Math.floor(nuit / H) * H, h); assert.notEqual(jour(soir), jour(nuit));
      minutes(dir, [[soir, { a: 2 }], [nuit, { a: 4 }]]);
      const b = m.menage();
      assert.equal(b.effaces, 2);
      const { vu, fois } = heures(dir);
      assert.deepEqual(vu.get(`${h}|a`), [3, 2, 4], 'les deux moitiés de l\'heure comptent');
      assert.equal(fois.get(`${h}|a`), 1);
      assert.deepEqual(m.points('a', t0 - 60 * J, t0), [[h, 3]]);
    } finally { fin(); }
  });
});

test('après le ménage, une courbe d\'un an garde toutes ses heures et les 31 derniers jours ne changent pas', () => {
  const now = Math.floor(new Date(2026, 10, 26, 12, 0, 0).getTime() / H) * H, debut = now - 365 * J;
  const dir = dossier(), clock = { t: debut };
  try {
    let m = new Metrics(dir, () => clock.t), n = 0; const vus: Array<[number, number]> = [];
    for (let t = debut + 17 * MIN, i = 0; t < now; t += 6 * H + 7 * MIN, i++) {
      clock.t = t; m.put({ 'eir.cpu': i % 97 }, t); vus.push([Math.floor(t / MIN) * MIN, i % 97]);
      // Un arrêt d'Odin de temps en temps (il écrit sa minute, l'heure en cours reste en mémoire et se perd).
      if (++n % 5 === 0) { clock.t = t + 30_000; m.flush(); m = new Metrics(dir, () => clock.t); }
    }
    m.flush(); clock.t = now;
    const minutesFrom = now - 31 * J, from = debut - H;
    const attendu: Array<[number, number]> = [...vus.filter(([t]) => t < minutesFrom).map(([t, v]): [number, number] => [Math.floor(t / H) * H, v]), ...vus.filter(([t]) => t >= minutesFrom)];
    const lire = () => new Metrics(dir, () => now).points('eir.cpu', from, now);
    const recentAvant = new Metrics(dir, () => now).points('eir.cpu', minutesFrom, now);
    assert.ok(lire().length < attendu.length, 'avant le ménage, des heures coupées manquent');
    const b = new Metrics(dir, () => now).menage();
    assert.ok(b.effaces > 300, `${b.effaces} jours effacés`);
    assert.deepEqual(lire(), attendu, 'aucune heure perdue');
    assert.deepEqual(new Metrics(dir, () => now).points('eir.cpu', minutesFrom, now), recentAvant, 'les 31 derniers jours, à l\'identique');
    assert.ok(readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).every((f) => f.slice(0, 10) >= jour(now - 31 * J)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('une série réservée au propriétaire suit le même ménage et reste fermée au-delà de 31 jours', () => {
  const t0 = new Date(2026, 10, 26, 12, 0, 0).getTime(), { m, dir, fin } = magasin(t0);
  try {
    const h = ilYa(t0, 40, 10), n = 'appareils.zb_prise.puissance';
    minutes(dir, [[h, { [n]: 800, 'eir.cpu': 3 }], [h + MIN, { [n]: 820 }]]);
    assert.equal(m.menage().effaces, 1);
    assert.deepEqual(m.points(n, t0 - 60 * J, t0), []);
    assert.deepEqual(m.series(n, t0 - 60 * J, t0), []);
    assert.equal(m.fn(n, 'last', 60 * J), undefined);
    assert.ok(!m.names('', {}).includes(n));
    assert.deepEqual(m.points(n, t0 - 60 * J, t0, PRIVE), [[h, 810]]);
    assert.deepEqual(m.points('eir.cpu', t0 - 60 * J, t0), [[h, 3]]);
  } finally { fin(); }
});

test('une erreur du ménage ne casse ni le rangement ni la lecture', async () => {
  const t0 = new Date(2026, 10, 26, 12, 0, 30).getTime(), { m, dir, clock, fin } = magasin(t0);
  try {
    rmSync(dir, { recursive: true, force: true }); // le dossier a disparu
    assert.doesNotThrow(() => { m.put({ a: 1 }); clock.t += MIN; m.put({ a: 2 }); m.flush(); });
    assert.doesNotThrow(() => m.menage());
    await attendre();
    mkdirSync(dir, { recursive: true });
    clock.t += MIN; m.put({ a: 3 }); clock.t += MIN; m.put({ a: 4 });
    assert.ok(existsSync(join(dir, `${jour(clock.t)}.jsonl`)), 'le rangement repart');
    assert.equal(m.fn('a', 'last', H), 4);
  } finally { fin(); }
});

test('le coût d\'un rangement ordinaire ne change pas : le ménage passe hors du rangement, un jour à la fois', async (t) => {
  const t0 = new Date(2026, 10, 26, 12, 0, 30).getTime(), { m, dir, clock, fin } = magasin(t0);
  try {
    // Trente vieux jours bien remplis.
    for (let d = 32; d < 62; d++) { const h = ilYa(t0, d, 0), lignes: string[] = []; for (let i = 0; i < 1440; i++) lignes.push(JSON.stringify({ t: h + i * MIN, v: { 'eir.cpu': i % 50, 'eir.mem': 40 } })); writeFileSync(join(dir, `${jour(h)}.jsonl`), `${lignes.join('\n')}\n`); }
    const vieux = () => readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < jour(t0 - 31 * J)).length;
    m.put({ 'eir.cpu': 1 }); clock.t += MIN;
    let d = performance.now(); m.put({ 'eir.cpu': 2 }); const premier = performance.now() - d;
    assert.equal(vieux(), 30, 'le rangement qui lance le ménage n\'a lu aucun vieux fichier');
    await new Promise((r) => setImmediate(r));
    assert.ok(vieux() >= 29, 'un jour à la fois, pas trente d\'un coup');
    await attendre();
    assert.equal(vieux(), 0);
    const apres = m.dernierMenage;
    d = performance.now(); for (let i = 0; i < 300; i++) { clock.t += MIN; m.put({ 'eir.cpu': i }); } const ordinaire = (performance.now() - d) / 300;
    await attendre();
    assert.equal(m.dernierMenage, apres, 'aucun ménage pendant les rangements ordinaires');
    t.diagnostic(`rangement qui lance le ménage : ${premier.toFixed(2)} ms ; rangement ordinaire : ${ordinaire.toFixed(3)} ms en moyenne`);
  } finally { fin(); }
});
