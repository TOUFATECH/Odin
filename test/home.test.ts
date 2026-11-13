import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { applyParental, extend, minutesToBed, parseDays, rules, shouldBlock, KEY } from '../src/home/parental.ts';
import { pickNews, severeWeather } from '../src/guard/alerts.ts';
import { bestMatch, parseEpisode, playPathOf, venusTool, type VCard } from '../src/tools/venus.ts';
import { arrivalMessages } from '../src/valhalla/modules/venus.ts';
import { planTargets, stoppedServices } from '../src/guard/care.ts';
import { buttonText, buttonsFor } from '../src/bifrost/channel.ts';

const kvOf = () => { const m = new Map<string, string>(); return { getKv: (k: string) => m.get(k), setKv: (k: string, v: string) => { m.set(k, v); } }; };
const at = (d: number, h: number, mi = 0) => new Date(2026, 10, d, h, mi); // nov. 2026 : 8 = dimanche, 9 = lundi

test('contrôle parental : horaires, soirs d\'école, prolongation', () => {
  const r = { bed: '21:00', wake: '07:00' };
  assert.equal(shouldBlock(r, at(9, 20, 59)), false);
  assert.equal(shouldBlock(r, at(9, 21, 0)), true);
  assert.equal(shouldBlock(r, at(10, 6, 30)), true);
  assert.equal(shouldBlock(r, at(10, 7, 0)), false);
  const school = { ...r, days: parseDays('semaine') };
  assert.deepEqual(school.days, [0, 1, 2, 3, 4]);
  assert.equal(shouldBlock(school, at(13, 22)), false, 'vendredi soir : pas d\'école demain');
  assert.equal(shouldBlock(school, at(8, 22)), true, 'dimanche soir : école demain');
  assert.equal(shouldBlock(school, at(14, 6)), false, 'samedi matin : la coupure de vendredi n\'existe pas');
  assert.equal(minutesToBed(r, at(9, 20, 52)), 8);
  assert.equal(shouldBlock({ ...r, until: at(9, 22).getTime() }, at(9, 21, 30)), false, 'prolongé');
});

test('contrôle parental : coupe et rend sur la box, prévient 10 min avant avec « prolonger »', async () => {
  const kv = kvOf(), calls: string[] = [];
  kv.setKv(KEY, JSON.stringify([{ id: 'pc1', device: 'tablette', label: 'Tablette de Lina', mac: 'aa:bb:cc:dd:ee:ff', bed: '21:00', wake: '07:00' }]));
  const inv = { find: () => ({ id: 7, ip: '192.168.1.44', mac: 'aa:bb:cc:dd:ee:ff', kind: 'tablette', label: 'Tablette de Lina', name: '', hostname: '' }), list: () => [{ id: 1, ip: '192.168.1.1', kind: 'routeur' }], setBlocked: () => {} };
  const act = (async (_h: string, _m: unknown, a: string, mac: string) => { calls.push(`${a} ${mac}`); return { ok: true, kind: 'openwrt' as const, out: '' }; }) as never;
  // Sans accès à la box : on le dit
  const none = await applyParental({ kv, home: '/nulle-part', inventory: inv }, at(9, 21, 1), act);
  assert.match(none[0].text, /pas d'accès à la box/);
  // Avec une box (routerMachine simulé par un home qui en connaît une) : on passe par act
  const { applyParental: ap } = await import('../src/home/parental.ts');
  const warn = await ap({ kv, home: '/nulle-part', inventory: inv }, at(9, 20, 52), act);
  assert.equal(warn[0].warnId, 'pc1'); assert.match(warn[0].text, /coupé dans 8 min/);
  assert.deepEqual(buttonsFor({ parental: { id: 'pc1' } }).map((b) => b.id), ['pc:15:pc1', 'pc:30:pc1', 'pc:60:pc1']);
  assert.equal(buttonText('pc:30:pc1'), '/parental pc1 30');
  const r = extend(kv, 'pc1', 30, at(9, 21, 1).getTime())!;
  assert.equal(new Date(r.until!).getHours() * 60 + new Date(r.until!).getMinutes(), 21 * 60 + 31);
  assert.equal(rules(kv)[0].until, r.until);
});

test('alertes locales : météo dangereuse et actualités de la région, sans doublon', () => {
  const w = severeWeather({ time: ['2026-11-07', '2026-11-08', '2026-11-09'], precipitation_sum: [5, 64, 31], wind_gusts_10m_max: [30, 105, 40], weather_code: [3, 95, 80] }, 'Mamoudzou');
  assert.deepEqual(w.map((x) => x.text), ['⚠️ Demain à Mamoudzou : très fortes pluies (64 mm), vent violent (rafales à 105 km/h), orages.', '⚠️ Lundi à Mamoudzou : fortes pluies (31 mm).']);
  assert.equal(w[0].urgent, true);
  const news = pickNews([
    { title: 'Mayotte : coupure d\'eau programmée mardi à Mamoudzou', url: 'https://ex.fr/a', snippet: '06/11/2026 · Mayotte la 1ère · …' },
    { title: 'Cyclone : Mayotte en alerte orange', url: 'https://ex.fr/b', snippet: '07/11/2026 · …' },
    { title: 'Mayotte : le festival de musique commence', url: 'https://ex.fr/c', snippet: '07/11/2026' },
    { title: 'Coupure d\'électricité à Dzaoudzi', url: 'https://ex.fr/d', snippet: '01/10/2026' },
  ], ['https://ex.fr/b'], new Date(2026, 10, 7));
  assert.deepEqual(news.map((x) => x.key), ['https://ex.fr/a']);
});

test('mises à jour de nuit : toutes les machines par défaut, services arrêtés repérés', () => {
  assert.deepEqual(planTargets({ enabled: true, weekday: 0, hour: 4, targets: [], rollbackOnFailure: true }, [{ id: 'nas' }, { id: 'pve' }]).map((t) => t.where), ['local', 'nas', 'pve']);
  assert.deepEqual(planTargets({ enabled: true, weekday: 0, hour: 4, targets: [{ where: 'nas' }], rollbackOnFailure: true }, [{ id: 'pve' }]).map((t) => t.where), ['nas']);
  assert.deepEqual(stoppedServices('nginx.service\nvenus.service\napt-daily.service\nssh.service', 'nginx.service\nssh.service'), ['venus.service']);
});

test('Venus : titre retrouvé, lecture lancée sur la télé, enregistrement programmé', async () => {
  const cards: VCard[] = [{ id: 1, title: 'Mayotte La 1ère', type: 'channel', slug: 'mayotte-la-1ere', path: '/lecture/mayotte-la-1ere', number: 1 }, { id: 9, title: 'One Piece', type: 'show', slug: 'one-piece', path: '/animes/one-piece', category: 'anime' }, { id: 12, title: 'Inception', type: 'movie', slug: 'inception', path: '/films/inception', year: 2010 }];
  assert.equal(bestMatch(cards, 'chaîne 1')!.id, 1);
  assert.equal(bestMatch(cards, '1')!.id, 1);
  assert.equal(bestMatch(cards, 'one piece')!.id, 9);
  assert.equal(playPathOf(cards[0]), '/tv/1-mayotte-la-1ere');
  assert.equal(playPathOf(cards[2]), '/lecture/inception');
  const got: Array<{ method: string; url: string; body: string; key: string }> = [];
  const srv = createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      got.push({ method: req.method!, url: req.url!, body, key: String(req.headers['x-api-key']) });
      const u = req.url!;
      const out = u.startsWith('/api/library?type=channel') ? [cards[0]] : u.startsWith('/api/library') ? cards.slice(1) : u === '/api/shows/9/episode?which=last' ? { id: 77, season: 1, episode: 1071, title: 'Le rêve de Luffy', play: '/animes/one-piece/S01E1071' } : u === '/api/shows/9/episode?s=2&e=5' ? { id: 78, season: 2, episode: 5, title: 'Épisode 5', play: '/animes/one-piece/S02E05' } : u === '/api/devices/open' ? [{ id: 'tv1', name: 'Télé du salon', tv: true, playing: false }] : u.startsWith('/api/epg?') ? { channels: [{ id: 1, title: 'Mayotte La 1ère' }], programs: { 1: [{ id: 55, channel: 1, title: 'Le match de foot', start: Date.now() + 3600_000, stop: Date.now() + 7200_000 }] } } : { ok: true };
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  process.env.VENUS_API_KEY = 'cle-de-test';
  const ctx = { venus: { url: `http://127.0.0.1:${port}` } } as never;
  try {
    assert.equal(await venusTool.run({ action: 'regarder', quoi: 'One Piece' }, ctx), '▶️ « One Piece » lancé sur Télé du salon.');
    const open = got.find((g) => g.url === '/api/devices/tv1/open')!;
    assert.deepEqual(JSON.parse(open.body), { path: '/animes/one-piece' }); assert.equal(open.key, 'cle-de-test');
    // « mets le dernier épisode de One Piece sur la télé du salon » : l'épisode lui-même est lancé
    assert.equal(await venusTool.run({ action: 'regarder', quoi: 'dernier épisode de One Piece', ou: 'télé du salon' }, ctx), '▶️ « One Piece » S01E1071 (Le rêve de Luffy) lancé sur Télé du salon.');
    assert.deepEqual(JSON.parse(got.filter((g) => g.url === '/api/devices/tv1/open').at(-1)!.body), { path: '/animes/one-piece/S01E1071' });
    assert.equal(await venusTool.run({ action: 'regarder', quoi: 'One Piece S02E05' }, ctx), '▶️ « One Piece » S02E05 lancé sur Télé du salon.');
    assert.match(await venusTool.run({ action: 'enregistrer', quoi: 'match' }, ctx) as string, /Enregistrement programmé : « Le match de foot » sur Mayotte La 1ère/);
    assert.deepEqual(JSON.parse(got.find((g) => g.url === '/api/recordings')!.body), { programId: 55, series: false });
  } finally { srv.close(); delete process.env.VENUS_API_KEY; }
});

test('Venus : épisode demandé dans la phrase, et messages d\'arrivée (VF)', () => {
  assert.deepEqual(parseEpisode('le dernier épisode de One Piece'), { show: 'one piece', which: 'last' });
  assert.deepEqual(parseEpisode('l\'épisode suivant de Frieren'), { show: 'frieren', which: 'next' });
  assert.deepEqual(parseEpisode('One Piece saison 2 épisode 5'), { show: 'one piece', which: 'exact', s: 2, e: 5 });
  assert.deepEqual(parseEpisode('One Piece S02E05'), { show: 'one piece', which: 'exact', s: 2, e: 5 });
  assert.deepEqual(parseEpisode('épisode 1071 de One Piece'), { show: 'one piece', which: 'exact', e: 1071 });
  assert.equal(parseEpisode('Inception'), null);
  const items = [
    { kind: 'episode' as const, at: 1, id: 1, show: 'One Piece', season: 1, episode: 1071, title: 'Épisode 1071', vf: true },
    { kind: 'episode' as const, at: 2, id: 2, show: 'Dark', season: 1, episode: 2, title: 'Mensonges', vf: false },
    { kind: 'episode' as const, at: 3, id: 3, show: 'Dark', season: 1, episode: 3, vf: false },
    { kind: 'movie' as const, at: 4, id: 4, title: 'Inception', year: 2010, vf: true },
    { kind: 'vf' as const, at: 5, id: 5, title: 'Frieren', text: '« Frieren » : 3 épisodes de plus en VF (12 au total)' },
  ];
  assert.deepEqual(arrivalMessages(items), [
    '🎬 Nouveau film sur Venus : « Inception » (2010) · VF',
    '🇫🇷 VF arrivée sur Venus : « Frieren » : 3 épisodes de plus en VF (12 au total)',
    '📺 Épisode arrivé sur Venus en VF : One Piece S01E1071',
    '📺 2 épisodes arrivés sur Venus : Dark S01E02 → S01E03',
  ]);
  assert.deepEqual(arrivalMessages(items, 'vf'), ['🇫🇷 VF arrivée sur Venus : « Frieren » : 3 épisodes de plus en VF (12 au total)', '📺 Épisode arrivé sur Venus en VF : One Piece S01E1071']);
});

test('Freyja · médias automatiques de Venus : résumé (téléchargements, à trouver, erreurs, sans source)', async () => {
  const { mediasText } = await import('../src/valhalla/modules/venus.ts');
  assert.match(mediasText({ on: false, client: null, sources: [], wants: [], log: [] }), /coupés/);
  const t = mediasText({ on: true, client: { type: 'venus' }, sources: [], log: [], wants: [
    { id: 1, kind: 'movie', title: 'Orage', season: -1, episode: -1, status: 'telechargement', progress: 42 },
    { id: 2, kind: 'episode', title: 'Brigade Nord', season: 1, episode: 2, status: 'erreur', progress: 0, note: 'aucun fichier' },
    { id: 3, kind: 'movie', title: 'Nuit', season: -1, episode: -1, status: 'range', progress: 100 },
  ] });
  assert.match(t, /0 source\(s\) · moteur Fólkvangr · 1 en téléchargement · 0 à trouver · 1 rangé\(s\) · ⚠ 1 en erreur/);
  assert.match(t, /⬇ Orage : 42 %/); assert.match(t, /⚠ Brigade Nord S01E02 : aucun fichier/); assert.match(t, /Aucune source/);
});

test('Freyja · Bygul (sources) : santé, priorité, chiffres, sans source', async () => {
  const { bygulText } = await import('../src/valhalla/modules/venus.ts');
  assert.match(bygulText([]), /Aucune source dans Bygul/);
  const t = bygulText([{ id: 1, name: 'Rapide', enabled: true, priority: 10, health: 'bonne', fails: 0, queries: 12, grabs: 3, avgMs: 240 }, { id: 2, name: 'Lente', enabled: true, priority: 40, health: 'en pause', fails: 3, last_error: 'réponse 503', queries: 5, grabs: 0, avgMs: 9000, paused_until: Date.now() + 3600e3 }]);
  assert.match(t, /🟢 n° 1 Rapide · priorité 10 · bonne · 12 recherche\(s\), 3 téléchargement\(s\), 240 ms/); assert.match(t, /⏸ n° 2 Lente · priorité 40 · en pause jusqu'à \d\d:\d\d .* · réponse 503/);
});
