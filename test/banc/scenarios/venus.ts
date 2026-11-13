// Vénus contre un VRAI serveur Venus (le dépôt TOUFATECH/Venus, lancé pour l'occasion avec une
// bibliothèque d'essai) : un film fabriqué sur place, une chaîne d'essai, une « télé » simulée qui
// garde Venus ouvert. Odin cherche, lance sur la télé, programme et annule des enregistrements,
// et prévient quand un enregistrement échoue.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { venus as freyja } from '../../../src/valhalla/modules/venus.ts';
import { freePort, sh, until, type Scenario, type T } from '../lib.ts';

const TV_UA = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36';

function venusDir(): string | undefined {
  const c = [process.env.BANC_VENUS_DIR, resolve('..', 'Venus'), resolve('..', 'venus'), join(homedir(), 'Venus'), join(homedir(), 'venus')].filter(Boolean) as string[];
  return c.find((d) => existsSync(join(d, 'server', 'index.js')) && existsSync(join(d, 'server', 'dvr.js')));
}

interface Booted { url: string; key: string; admin: string; pin: string; password: string }
async function boot(t: T, dir: string): Promise<Booted> {
  const port = await freePort(), url = `http://127.0.0.1:${port}`, data = t.tmp('banc-venus-'), films = join(t.tmp('banc-films-'), 'films');
  mkdirSync(join(films, 'Le Voyage (2024)'), { recursive: true });
  // Un vrai fichier vidéo (Venus ignore les fichiers de moins de 5 Mo).
  const film = await sh('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25,noise=alls=30:allf=t', '-f', 'lavfi', '-i', 'sine=f=440', '-t', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2200k', '-c:a', 'aac', '-y', join(films, 'Le Voyage (2024)', 'Le Voyage (2024).mp4')], { timeoutMs: 120_000 });
  if (film.code) t.skip(`film d'essai impossible à fabriquer : ${film.err.split('\n')[0]}`);
  const srv = t.spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: dir, env: { ...process.env, DATA_DIR: data, MOVIES_PATH: films, SHOWS_PATH: '', PORT: String(port), HOST: '127.0.0.1' } });
  if (!(await until(async () => (await fetch(`${url}/api/status`)).ok, 30_000, 300))) throw new Error(`Venus n'a pas démarré : ${srv.log().slice(-400)}`);
  const j = async (path: string, body: unknown, token?: string) => { const r = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); const x = await r.json() as Record<string, unknown>; if (!r.ok) throw new Error(`${path} : ${String(x.error)}`); return x; };
  const password = `Banc-${randomBytes(9).toString('base64url')}-7`, pin = '4729';
  const admin = String((await j('/api/setup', { password, name: 'Odin', pin, serverName: 'Venus du banc', moviesPath: films, showsPath: '' })).token);
  const key = String((await j('/api/admin/apikeys', { name: 'Odin (banc)' }, admin)).key);
  // Une chaîne d'essai dont le flux ne répond pas (aucune vraie chaîne n'est utilisée par le banc).
  const m3u = join(data, 'banc.m3u');
  writeFileSync(m3u, '#EXTM3U\n#EXTINF:-1 tvg-id="banc.essai" tvg-name="Chaîne du banc" group-title="Banc",Chaîne du banc\nhttp://127.0.0.1:9/flux.m3u8\n');
  await j('/api/admin/libraries', { type: 'iptv', name: 'Banc', path: m3u }, admin);
  await j('/api/admin/scan', {}, admin);
  const lib = async (q = '') => await (await fetch(`${url}/api/library${q}`, { headers: { 'x-api-key': key } })).json() as Array<{ title: string }>;
  if (!(await until(async () => (await lib()).some((x) => x.title === 'Le Voyage') && (await lib('?type=channel')).some((x) => x.title === 'Chaîne du banc'), 60_000, 500))) throw new Error(`la bibliothèque d'essai n'apparaît pas : ${srv.log().slice(-400)}`);
  return { url, key, admin, pin, password };
}

/** Une télé du salon : connectée au foyer, profil choisi, Venus ouvert (flux d'événements). */
async function tv(t: T, b: Booted): Promise<{ opened: string[] }> {
  const login = await (await fetch(`${b.url}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': TV_UA }, body: JSON.stringify({ password: b.password }) })).json() as { token: string };
  await fetch(`${b.url}/api/profiles/1/select`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${login.token}`, 'user-agent': TV_UA }, body: JSON.stringify({ pin: b.pin }) });
  const ctrl = new AbortController(), opened: string[] = [];
  t.onEnd(() => ctrl.abort());
  const res = await fetch(`${b.url}/api/events`, { headers: { authorization: `Bearer ${login.token}`, 'user-agent': TV_UA }, signal: ctrl.signal });
  void (async () => {
    const dec = new TextDecoder(); let buf = '';
    try { for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) { buf += dec.decode(chunk, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); if (/^event: control/m.test(block)) { const d = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? '{}') as { cmd?: string; url?: string }; if (d.cmd === 'open' && d.url) opened.push(d.url); } } } } catch { /* fermé à la fin */ }
  })();
  return { opened };
}

export const venus: Scenario = {
  id: 'venus', title: 'Vénus ↔ Venus', mode: 'réel',
  what: 'Le vrai serveur Venus lancé avec un film et une chaîne d\'essai, et une télé simulée : chercher, lancer sur la télé, ma liste, enregistrer, annuler, alerte d\'échec.',
  async run(t) {
    await t.need('ffmpeg');
    const dir = venusDir();
    if (!dir) t.skip('dépôt Venus introuvable : indique son dossier avec BANC_VENUS_DIR=/chemin/Venus');
    const b = await boot(t, dir!);
    const salon = await tv(t, b);
    const had = process.env.VENUS_API_KEY; process.env.VENUS_API_KEY = b.key;
    t.onEnd(() => { if (had === undefined) delete process.env.VENUS_API_KEY; else process.env.VENUS_API_KEY = had; });
    const mod = freyja(() => b.url);
    const { v, alerts, events } = t.valhalla([mod]);
    const act = (a: string, i: Record<string, unknown> = {}) => v.act('freyja', a, i);

    t.match((await act('etat')).text, /Venus du banc .* profil Odin/, 'Vénus joint Venus avec sa clé API (nom du serveur, profil)');
    t.match((await act('chercher', { quoi: 'voyage' })).text, /Le Voyage \(2024\)/, 'recherche dans la bibliothèque : le film est trouvé');
    const screens = await act('ecrans');
    t.ok(await until(async () => /\(télé\)/.test((await act('ecrans')).text), 5000), 'la télé du salon apparaît dans les écrans ouverts', screens.text);

    const play = await act('regarder', { quoi: 'le voyage' });
    t.ok(play.ok && /« Le Voyage » lancé sur/.test(play.text), 'Odin lance le film sur la télé', play.text);
    t.ok(await until(() => salon.opened.includes('/lecture/le-voyage-2024'), 5000), 'la télé reçoit l\'ordre d\'ouvrir la lecture du film', JSON.stringify(salon.opened));
    const chan = await act('regarder', { quoi: 'Chaîne du banc', ou: 'tizen' });
    t.ok(chan.ok && await until(() => salon.opened.some((u) => /^\/tv\/\d+-[\w-]+$/.test(u)), 5000), 'une chaîne se lance aussi (page de la chaîne ouverte sur la télé)', `${chan.text} ${JSON.stringify(salon.opened)}`);
    t.match((await act('regarder', { quoi: 'film qui n\'existe pas' })).text, /Je ne trouve pas/, 'titre inconnu : Odin le dit, rien n\'est lancé');

    const items = await (await fetch(`${b.url}/api/library`, { headers: { 'x-api-key': b.key } })).json() as Array<{ id: number; title: string }>;
    await fetch(`${b.url}/api/items/${items.find((x) => x.title === 'Le Voyage')!.id}/mylist`, { method: 'POST', headers: { 'x-api-key': b.key, 'content-type': 'application/json' }, body: '{}' });
    t.match((await act('ma_liste')).text, /Le Voyage \(2024\)/, '« Ma liste » est lue');
    t.ok((await act('programme')).ok, 'le guide des programmes est interrogé sans erreur');

    // Enregistrements : programmé puis annulé ; un autre échoue (flux mort) → alerte.
    const later = await act('enregistrer_plage', { chaine: 'Chaîne du banc', debut: `${(new Date().getHours() + 2) % 24}:15`, minutes: 30, titre: 'Journal du banc' });
    t.ok(later.ok, 'enregistrement programmé sur une chaîne, à une heure donnée', later.text);
    t.match((await act('enregistrements')).text, /Journal du banc · Chaîne du banc · .* · programmé/, 'il apparaît « programmé »');
    const cancel = await act('annuler_enregistrement', { titre: 'journal du banc' });
    t.ok(cancel.ok && !/Journal du banc/.test((await act('enregistrements')).text), 'annulation d\'un enregistrement programmé', cancel.text);

    const now = await act('enregistrer_plage', { chaine: 'Chaîne du banc', minutes: 2, titre: 'Direct du banc' });
    t.ok(now.ok, 'enregistrement lancé tout de suite', now.text);
    const failed = await until(async () => /Direct du banc .* échoué/.test((await act('enregistrements')).text), 45_000, 1000);
    t.ok(failed, 'le flux ne répond pas : Venus marque l\'enregistrement « échoué »', (await act('enregistrements')).text);
    await mod.watch!.run(v.ctx('freyja'));
    t.ok(alerts.some((a) => /Enregistrement échoué : Direct du banc/.test(a.title)), 'Vénus t\'alerte de l\'enregistrement échoué', JSON.stringify(alerts));
    t.ok(events.some((e) => e.type === 'enregistrement_echoue'), 'événement « enregistrement échoué » émis');
    const n = alerts.length; await mod.watch!.run(v.ctx('freyja'));
    t.ok(alerts.length === n, 'la même panne n\'est pas signalée deux fois');

    const view = await mod.view(v.ctx('freyja'), new URLSearchParams());
    t.ok(view.kpis?.some((k) => k.label === 'Écrans ouverts' && k.value === '1') && view.kpis?.some((k) => k.label === 'Enregistrements échoués' && k.value === '1'), 'la page montre l\'écran ouvert et l\'échec', JSON.stringify(view.kpis));

    const ask = await act('demander', { titre: 'Un film absent', type: 'film' });
    t.ok(ask.ok === false && /Seerr/.test(ask.text), 'demande de titre sans service de demandes relié : message clair', ask.text);
    process.env.VENUS_API_KEY = 'vk_fausse_cle_du_banc';
    const bad = await act('etat');
    t.ok(bad.ok === false && !bad.text.includes(b.key), 'clé API fausse : refus clair, sans rien divulguer', bad.text);
    process.env.VENUS_API_KEY = b.key;
  },
};
