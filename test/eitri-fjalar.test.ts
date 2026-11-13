// Andromède (ISO) et Hermès (logiciels) : reconnaître les fichiers d'un dossier, trouver la dernière version sur
// les sites officiels (faux sites ici), télécharger avec l'empreinte de l'éditeur, reprendre un fichier entamé,
// garder 2 versions, programmer, résumé du jour, antivirus sur les installateurs, sources à soi, historique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { cmpVersion, customSource, highest, ISO, parseIndex, parseSums, SOFT } from '../src/valhalla/forge/sources.ts';
import { due, monogram, nextRun, scan, toPrune } from '../src/valhalla/forge/forge.ts';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** De faux sites officiels : une adresse → un contenu (avec la reprise « Range » pour les gros fichiers). */
function fakeWeb() {
  const routes = new Map<string, string | Buffer>(); const hits: string[] = [];
  const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input); hits.push(url);
    const body = routes.get(url); if (body === undefined) return new Response('introuvable', { status: 404 });
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const range = /bytes=(\d+)-/.exec(String((init?.headers as Record<string, string> | undefined)?.range ?? ''));
    if (range) { const from = Number(range[1]); return new Response(buf.subarray(from), { status: 206, headers: { 'content-length': String(buf.length - from) } }); }
    return new Response(buf, { status: 200, headers: { 'content-length': String(buf.length), 'content-type': 'application/octet-stream' } });
  };
  return { routes, hits, fetch: fetchFn };
}

function world() {
  const home = mkdtempSync(join(tmpdir(), 'eitri-')), web = fakeWeb(), alerts: Array<{ level: string; title: string; detail?: string }> = [];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: web.fetch as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  v.events.on('alert', (a: { level: string; title: string; detail?: string }) => alerts.push(a));
  const dir = join(home, 'nas', 'iso'), sdir = join(home, 'nas', 'logiciels');
  return { v, web, alerts, home, dir, sdir, act: (m: string, a: string, i: Record<string, unknown> = {}) => v.act(m, a, i), end: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

test('outils purs : versions, empreintes, index, programmation, ménage, motifs', () => {
  assert.ok(cmpVersion('24.04.10', '24.04.9') > 0 && cmpVersion('2025.01.01', '2024.12.01') > 0 && cmpVersion('1.0', '1.0rc1') > 0 && cmpVersion('12.10.0', '12.10.0') === 0 && cmpVersion('9.6', '10.0') < 0);
  const s = parseSums(`${'a'.repeat(64)} *ubuntu-24.04.3-desktop-amd64.iso\n${'b'.repeat(64)}  ./debian-12.11.0-amd64-netinst.iso\nSHA256 (Fedora-Workstation-Live-42-1.1.x86_64.iso) = ${'c'.repeat(64)}\n# commentaire\n`);
  assert.deepEqual([...s.keys()], ['ubuntu-24.04.3-desktop-amd64.iso', 'debian-12.11.0-amd64-netinst.iso', 'Fedora-Workstation-Live-42-1.1.x86_64.iso']);
  assert.deepEqual(parseIndex('<a href="../">..</a><a href="24.04.3/">24.04.3/</a><a href="https://x.org/">x</a><a href="22.04.5/">x</a><a href="/icons/a.png">i</a>'), ['24.04.3/', '22.04.5/']);
  assert.deepEqual(highest(['22.04.5/', '24.04.3/', '24.10/', '24.04.10/'], /^(\d\d\.04(?:\.\d+)?)\/$/), { name: '24.04.10/', version: '24.04.10' });
  // Programmation : chaque vendredi à 03:00 ; une date unique.
  const p = { days: [5], at: '03:00', auto: true }, thu = new Date('2026-11-12T10:00:00');
  assert.equal(nextRun(p, thu)!.toString(), new Date('2026-11-13T03:00:00').toString());
  assert.ok(!due(p, thu, 0) && due(p, new Date('2026-11-13T03:00:30'), 0) && !due(p, new Date('2026-11-13T09:00:00'), new Date('2026-11-13T03:00:30').getTime()));
  assert.ok(due({ ...p, date: '2026-12-01' }, new Date('2026-12-01T03:01:00'), 0) && !due({ ...p, date: '2026-12-01' }, new Date('2026-12-02T03:01:00'), new Date('2026-12-01T03:01:00').getTime()));
  assert.equal(nextRun({ ...p, date: '2020-01-01' }, thu), undefined);
  // Ménage : on garde les 2 plus récentes.
  const src = ISO.find((x) => x.id === 'ubuntu')!, f = (v: string) => ({ source: src, version: v, path: `/x/${v}`, size: 1, mtime: 0 });
  assert.deepEqual(toPrune([f('24.04.1'), f('24.04.3'), f('24.04.2')], 2).map((x) => x.version), ['24.04.1']);
  assert.deepEqual(toPrune([f('24.04.1'), f('24.04.3'), f('24.04.2')], 1).map((x) => x.version), ['24.04.2', '24.04.1']);
  // Reconnaître les noms de fichiers réels.
  const rec = (n: string) => [...ISO, ...SOFT].find((x) => x.match.test(n))?.id;
  assert.deepEqual(['ubuntu-24.04.3-desktop-amd64.iso', 'debian-12.11.0-amd64-netinst.iso', 'Win11_25H2_French_x64.iso', 'proxmox-ve_9.0-1.iso', 'archlinux-2025.11.01-x86_64.iso', 'Fedora-Workstation-Live-42-1.1.x86_64.iso', 'Firefox Setup 145.0.exe', '7z2501-x64.exe', 'npp.8.8.7.Installer.x64.exe', 'node-v24.11.1-x64.msi', 'vacances.jpg'].map(rec), ['ubuntu', 'debian', 'windows11', 'proxmox', 'arch', 'fedora', 'firefox', '7zip', 'notepadpp', 'node', undefined]);
  const c = customSource({ id: 'perso-x', name: 'X', kind: 'logiciel', repo: 'a/b', pattern: 'MonOutil-{version}-x64.exe' });
  assert.equal(c.match.exec('MonOutil-2.3.1-x64.exe')?.[1], '2.3.1'); assert.ok(!c.match.test('MonOutil-2.3.1-x64.exe.bak'));
  assert.throws(() => customSource({ id: 'y', name: 'Y', kind: 'logiciel', url: 'https://x/y.exe', pattern: 'sans-version.exe' }), /\{version\}/);
  assert.match(monogram('Proxmox VE', '#E57000'), /^data:image\/svg\+xml;base64,/);
  assert.match(Buffer.from(monogram('<script>', 'red').split(',')[1], 'base64').toString(), /fill="#6B7280"/);
});

test('sources officielles (faux sites) : Ubuntu, Debian, Fedora, GitHub, Firefox, VS Code, Node.js', async () => {
  const w = fakeWeb(), f = w.fetch as never;
  w.routes.set('https://releases.ubuntu.com/', '<a href="22.04.5/">22.04.5/</a><a href="24.04.3/">24.04.3/</a><a href="25.10/">25.10/</a>');
  w.routes.set('https://releases.ubuntu.com/24.04.3/SHA256SUMS', `${'1'.repeat(64)} *ubuntu-24.04.3-desktop-amd64.iso\n${'2'.repeat(64)} *ubuntu-24.04.3-live-server-amd64.iso\n`);
  assert.deepEqual(await ISO.find((x) => x.id === 'ubuntu')!.latest!(f), { version: '24.04.3', file: 'ubuntu-24.04.3-desktop-amd64.iso', url: 'https://releases.ubuntu.com/24.04.3/ubuntu-24.04.3-desktop-amd64.iso', sha256: '1'.repeat(64) });
  w.routes.set('https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/SHA256SUMS', `${'3'.repeat(64)}  debian-13.2.0-amd64-netinst.iso\n${'4'.repeat(64)}  debian-edu-13.2.0-amd64-netinst.iso\n`);
  assert.equal((await ISO.find((x) => x.id === 'debian')!.latest!(f)).version, '13.2.0');
  w.routes.set('https://download.fedoraproject.org/pub/fedora/linux/releases/', '<a href="41/">41/</a><a href="43/">43/</a><a href="test/">test/</a>');
  w.routes.set('https://download.fedoraproject.org/pub/fedora/linux/releases/43/Workstation/x86_64/iso/', '<a href="Fedora-Workstation-43-1.6-x86_64-CHECKSUM">c</a><a href="Fedora-Workstation-Live-43-1.6.x86_64.iso">i</a>');
  w.routes.set('https://download.fedoraproject.org/pub/fedora/linux/releases/43/Workstation/x86_64/iso/Fedora-Workstation-43-1.6-x86_64-CHECKSUM', `SHA256 (Fedora-Workstation-Live-43-1.6.x86_64.iso) = ${'5'.repeat(64)}\n`);
  const fe = await ISO.find((x) => x.id === 'fedora')!.latest!(f); assert.equal(fe.version, '43-1.6'); assert.equal(fe.sha256, '5'.repeat(64));
  w.routes.set('https://api.github.com/repos/ip7z/7zip/releases/latest', JSON.stringify({ tag_name: '25.01', html_url: 'https://github.com/ip7z/7zip/releases/tag/25.01', assets: [{ name: '7z2501-arm64.exe', browser_download_url: 'https://x/a', size: 1 }, { name: '7z2501-x64.exe', browser_download_url: 'https://github.com/ip7z/7zip/releases/download/25.01/7z2501-x64.exe', size: 1600000, digest: `sha256:${'6'.repeat(64)}` }] }));
  assert.deepEqual(await SOFT.find((x) => x.id === '7zip')!.latest!(f), { version: '2501', file: '7z2501-x64.exe', url: 'https://github.com/ip7z/7zip/releases/download/25.01/7z2501-x64.exe', sha256: '6'.repeat(64), size: 1600000, page: 'https://github.com/ip7z/7zip/releases/tag/25.01' });
  w.routes.set('https://product-details.mozilla.org/1.0/firefox_versions.json', JSON.stringify({ LATEST_FIREFOX_VERSION: '145.0.1' }));
  w.routes.set('https://ftp.mozilla.org/pub/firefox/releases/145.0.1/SHA256SUMS', `${'7'.repeat(64)}  win64/fr/Firefox Setup 145.0.1.exe\n${'8'.repeat(64)}  win64/de/Firefox Setup 145.0.1.exe\n`);
  const ff = await SOFT.find((x) => x.id === 'firefox')!.latest!(f); assert.equal(ff.sha256, '7'.repeat(64)); assert.equal(ff.url, 'https://ftp.mozilla.org/pub/firefox/releases/145.0.1/win64/fr/Firefox%20Setup%20145.0.1.exe');
  w.routes.set('https://update.code.visualstudio.com/api/update/win32-x64/stable/latest', JSON.stringify({ name: '1.106.2', productVersion: '1.106.2', url: 'https://vscode.download.prss.microsoft.com/x/VSCodeSetup-x64-1.106.2.exe', sha256hash: '9'.repeat(64) }));
  assert.equal((await SOFT.find((x) => x.id === 'vscode')!.latest!(f)).file, 'VSCodeSetup-x64-1.106.2.exe');
  w.routes.set('https://nodejs.org/dist/index.json', JSON.stringify([{ version: 'v25.2.0', lts: false, files: ['win-x64-msi'] }, { version: 'v24.11.1', lts: 'Krypton', files: ['win-x64-msi'] }]));
  w.routes.set('https://nodejs.org/dist/v24.11.1/SHASUMS256.txt', `${'a'.repeat(64)}  node-v24.11.1-x64.msi\n`);
  assert.deepEqual(await SOFT.find((x) => x.id === 'node')!.latest!(f), { version: '24.11.1', file: 'node-v24.11.1-x64.msi', url: 'https://nodejs.org/dist/v24.11.1/node-v24.11.1-x64.msi', sha256: 'a'.repeat(64), page: 'https://nodejs.org/' });
  await assert.rejects(ISO.find((x) => x.id === 'arch')!.latest!(f), /répond 404/);
});

test('Andromède : dossier, reconnaître, vérifier, télécharger (empreinte), reprise, garder 2, Windows manuel, historique, vue', async () => {
  const w = world();
  try {
    assert.equal((await w.act('eitri', 'dossier', { chemin: '/etc/iso' })).ok, false);
    mkdirSync(w.dir, { recursive: true });
    writeFileSync(join(w.dir, 'ubuntu-24.04.2-desktop-amd64.iso'), 'ancienne ubuntu'); mkdirSync(join(w.dir, 'Debian'));
    writeFileSync(join(w.dir, 'Debian', 'debian-13.2.0-amd64-netinst.iso'), 'debian'); writeFileSync(join(w.dir, 'Win11_25H2_French_x64.iso'), 'windows'); writeFileSync(join(w.dir, 'notes.txt'), '?');
    assert.match((await w.act('eitri', 'dossier', { chemin: w.dir })).text, /3 ISO\(s\) reconnu\(s\), 1 non reconnu/);
    const iso3 = Buffer.alloc(300_000, 7), iso4 = Buffer.alloc(200_000, 9);
    w.web.routes.set('https://releases.ubuntu.com/', '<a href="24.04.3/">24.04.3/</a>');
    w.web.routes.set('https://releases.ubuntu.com/24.04.3/SHA256SUMS', `${sha(iso3)} *ubuntu-24.04.3-desktop-amd64.iso\n`);
    w.web.routes.set('https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/SHA256SUMS', `${'0'.repeat(64)}  debian-13.2.0-amd64-netinst.iso\n`);
    // Vérifier sans télécharger.
    const ver = (await w.act('eitri', 'verifier')).text;
    assert.match(ver, /🆕 Ubuntu \(bureau, LTS\) : 24\.04\.2 → 24\.04\.3/); assert.match(ver, /✔ Debian \(netinst\) : 13\.2\.0 → 13\.2\.0/); assert.match(ver, /ℹ Windows 11 .*manuel \(https:\/\/www\.microsoft\.com/);
    assert.ok(!w.web.hits.some((h) => h.endsWith('.iso')), 'rien téléchargé');
    // Un fichier entamé (coupure) : la reprise demande la suite seulement.
    mkdirSync(join(w.dir, 'Ubuntu'), { recursive: true }); writeFileSync(join(w.dir, 'Ubuntu', '.ubuntu-24.04.3-desktop-amd64.iso.part'), iso3.subarray(0, 100_000));
    w.web.routes.set('https://releases.ubuntu.com/24.04.3/ubuntu-24.04.3-desktop-amd64.iso', iso3);
    const up = (await w.act('eitri', 'mettre_a_jour')).text;
    assert.match(up, /✅ Ubuntu \(bureau, LTS\) 24\.04\.3 \(293 Ko\), empreinte vérifiée/); assert.match(up, /✔ Debian \(netinst\) 13\.2\.0 : à jour/);
    assert.deepEqual(readFileSync(join(w.dir, 'Ubuntu', 'ubuntu-24.04.3-desktop-amd64.iso')), iso3);
    assert.ok(existsSync(join(w.dir, 'ubuntu-24.04.2-desktop-amd64.iso')), '2 versions gardées : l\'ancienne reste');
    assert.ok(w.alerts.some((a) => a.title === '⬇ Ubuntu (bureau, LTS) 24.04.3 : téléchargement') && w.alerts.some((a) => a.title === '✅ Ubuntu (bureau, LTS) 24.04.3 téléchargé'));
    // Nouvelle version : la plus ancienne (24.04.2) est retirée, on garde 24.04.3 et 24.04.4.
    w.web.routes.set('https://releases.ubuntu.com/', '<a href="24.04.3/">24.04.3/</a><a href="24.04.4/">24.04.4/</a>');
    w.web.routes.set('https://releases.ubuntu.com/24.04.4/SHA256SUMS', `${sha(iso4)} *ubuntu-24.04.4-desktop-amd64.iso\n`);
    w.web.routes.set('https://releases.ubuntu.com/24.04.4/ubuntu-24.04.4-desktop-amd64.iso', iso4);
    assert.match((await w.act('eitri', 'telecharger', { nom: 'ubuntu' })).text, /24\.04\.4 .* · retiré : 24\.04\.2/);
    assert.ok(!existsSync(join(w.dir, 'ubuntu-24.04.2-desktop-amd64.iso')));
    assert.deepEqual(readdirSync(join(w.dir, 'Ubuntu')).sort(), ['ubuntu-24.04.3-desktop-amd64.iso', 'ubuntu-24.04.4-desktop-amd64.iso']);
    // Empreinte fausse : le fichier est jeté, alerte rouge.
    w.web.routes.set('https://releases.ubuntu.com/', '<a href="24.04.5/">24.04.5/</a>');
    w.web.routes.set('https://releases.ubuntu.com/24.04.5/SHA256SUMS', `${'f'.repeat(64)} *ubuntu-24.04.5-desktop-amd64.iso\n`);
    w.web.routes.set('https://releases.ubuntu.com/24.04.5/ubuntu-24.04.5-desktop-amd64.iso', Buffer.from('pirate'));
    assert.match((await w.act('eitri', 'telecharger', { nom: 'Ubuntu (bureau, LTS)' })).text, /❌ .*empreinte fausse/);
    assert.ok(!readdirSync(join(w.dir, 'Ubuntu'), { withFileTypes: true }).some((d) => d.name.includes('24.04.5')));
    assert.ok(w.alerts.some((a) => a.level === 'critique' && /empreinte fausse/.test(a.title)));
    // Windows : jamais téléchargé automatiquement.
    const win = await w.act('eitri', 'telecharger', { nom: 'windows11' }); assert.equal(win.ok, false); assert.match(win.text, /Microsoft ne permet pas/);
    // Fichier abîmé (contrôle des empreintes).
    writeFileSync(join(w.dir, 'Ubuntu', 'ubuntu-24.04.3-desktop-amd64.iso'), 'abîmé');
    const ctl = (await w.act('eitri', 'controler')).text; assert.match(ctl, /❌ ubuntu-24\.04\.3/); assert.match(ctl, /✔ ubuntu-24\.04\.4/);
    // Historique et vue (cartes avec icône).
    const h = (await w.act('eitri', 'historique', { n: 50 })).text;
    for (const x of ['téléchargé · Ubuntu (bureau, LTS) 24.04.3', 'supprimé · Ubuntu (bureau, LTS) 24.04.2', 'empreinte fausse · Ubuntu (bureau, LTS) 24.04.5', 'abîmé', 'vérifié · Debian (netinst) 13.2.0']) assert.ok(h.includes(x), x);
    const view = await w.v.module('eitri')!.view(w.v.ctx('eitri'), new URLSearchParams());
    const cards = view.sections.find((x) => x.kind === 'cards' && x.title === 'Mes ISO') as { items: Array<{ title: string; icon?: string; badge?: string }> };
    assert.deepEqual(cards.items.map((c) => c.title).sort(), ['Debian (netinst)', 'Ubuntu (bureau, LTS)', 'Windows 11']);
    assert.ok(cards.items.every((c) => c.icon?.startsWith('data:image/')), 'icône (pavé de couleur hors ligne)');
    assert.equal(cards.items.find((c) => c.title === 'Windows 11')!.badge, 'manuel');
    assert.ok(view.sections.some((x) => x.kind === 'list' && x.title === 'Fichiers non reconnus'));
  } finally { w.end(); }
});

test('Andromède : programmer, prévenir sans télécharger, résumé du jour', async () => {
  const w = world();
  try {
    mkdirSync(w.dir, { recursive: true }); await w.act('eitri', 'dossier', { chemin: w.dir });
    assert.match((await w.act('eitri', 'programmer', { jours: 'lun, ven', heure: '6h30', auto: false })).text, /Chaque lun, ven à 06:30 : vérification, et je te préviens/);
    assert.equal((await w.act('eitri', 'programmer', { jours: 'lundi, foo' })).ok, false);
    assert.match((await w.act('eitri', 'suivre', { nom: 'debian' })).text, /Debian \(netinst\) suivi/);
    w.web.routes.set('https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/SHA256SUMS', `${'0'.repeat(64)}  debian-13.2.0-amd64-netinst.iso\n`);
    const mod = w.v.module('eitri') as unknown as { _cycle: (c: unknown, why: string) => Promise<string> };
    assert.match(await mod._cycle(w.v.ctx('eitri'), 'programmé'), /🆕 Debian \(netinst\) 13\.2\.0 disponible \(tu as rien\)/);
    assert.ok(w.alerts.some((a) => a.title === '🆕 Debian (netinst) 13.2.0 disponible'));
    assert.ok(!w.web.hits.some((h) => h.endsWith('.iso')));
    // Résumé du jour (heure déjà passée) : envoyé une seule fois.
    await w.act('eitri', 'programmer', { date: '2099-01-01', heure: '03:00' });
    w.v.ctx('eitri').saveSettings({ resume: '00:00' });
    await w.v.module('eitri')!.watch!.run(w.v.ctx('eitri')); await w.v.module('eitri')!.watch!.run(w.v.ctx('eitri'));
    const r = w.alerts.filter((a) => a.title === '📰 Andromède : le résumé du jour'); assert.equal(r.length, 1); assert.match(r[0].detail ?? '', /nouvelle\(s\) version\(s\) vue\(s\)/);
  } finally { w.end(); }
});

test('Hermès : installateurs depuis GitHub, antivirus (mis de côté), source à soi', async () => {
  const w = world();
  try {
    mkdirSync(w.sdir, { recursive: true }); await w.act('fjalar', 'dossier', { chemin: w.sdir });
    writeFileSync(join(w.sdir, '7z2408-x64.exe'), 'ancien 7zip');
    const exe = Buffer.from(`MZ${'propre'.repeat(1000)}`);
    w.web.routes.set('https://api.github.com/repos/ip7z/7zip/releases/latest', JSON.stringify({ tag_name: '25.01', html_url: 'h', assets: [{ name: '7z2501-x64.exe', browser_download_url: 'https://github.com/ip7z/7zip/releases/download/25.01/7z2501-x64.exe', size: exe.length, digest: `sha256:${sha(exe)}` }] }));
    w.web.routes.set('https://github.com/ip7z/7zip/releases/download/25.01/7z2501-x64.exe', exe);
    assert.match((await w.act('fjalar', 'mettre_a_jour')).text, /✅ 7-Zip 2501 .*empreinte vérifiée/);
    assert.ok(existsSync(join(w.sdir, '7-Zip', '7z2501-x64.exe')) && existsSync(join(w.sdir, '7z2408-x64.exe')));
    // Un installateur piégé (fichier test EICAR) : mis de côté, l'ancien reste.
    const bad = Buffer.from(EICAR);
    w.web.routes.set('https://api.github.com/repos/pbatard/rufus/releases/latest', JSON.stringify({ tag_name: 'v4.11', html_url: 'h', assets: [{ name: 'rufus-4.11.exe', browser_download_url: 'https://github.com/pbatard/rufus/releases/download/v4.11/rufus-4.11.exe', size: bad.length, digest: `sha256:${sha(bad)}` }] }));
    w.web.routes.set('https://github.com/pbatard/rufus/releases/download/v4.11/rufus-4.11.exe', bad);
    assert.match((await w.act('fjalar', 'telecharger', { nom: 'rufus' })).text, /🛡 Rufus 4\.11 mis de côté/);
    assert.ok(!existsSync(join(w.sdir, 'Rufus', 'rufus-4.11.exe')) && existsSync(join(w.sdir, '.mis-de-cote', 'rufus-4.11.exe')));
    assert.ok(w.alerts.some((a) => a.level === 'critique' && /Rufus 4\.11 mis de côté/.test(a.title)));
    // Une source à soi (dépôt GitHub + motif).
    assert.equal((await w.act('fjalar', 'ajouter_source', { nom: 'Outil', depot: 'pas un depot', motif: 'x-{version}.exe' })).ok, false);
    assert.equal((await w.act('fjalar', 'ajouter_source', { nom: 'Outil', adresse: 'http://x/y.exe', motif: 'y-{version}.exe' })).ok, false);
    assert.match((await w.act('fjalar', 'ajouter_source', { nom: 'MonOutil', depot: 'toufatech/monoutil', motif: 'MonOutil-{version}-x64.exe' })).text, /MonOutil ajouté et suivi/);
    const tool = Buffer.from('outil');
    w.web.routes.set('https://api.github.com/repos/toufatech/monoutil/releases/latest', JSON.stringify({ tag_name: 'v2.0.0', html_url: 'h', assets: [{ name: 'MonOutil-2.0.0-x64.exe', browser_download_url: 'https://github.com/toufatech/monoutil/releases/download/v2.0.0/MonOutil-2.0.0-x64.exe', size: 5 }, { name: 'SHA256SUMS', browser_download_url: 'https://github.com/toufatech/monoutil/releases/download/v2.0.0/SHA256SUMS', size: 90 }] }));
    w.web.routes.set('https://github.com/toufatech/monoutil/releases/download/v2.0.0/SHA256SUMS', `${sha(tool)}  MonOutil-2.0.0-x64.exe\n`);
    w.web.routes.set('https://github.com/toufatech/monoutil/releases/download/v2.0.0/MonOutil-2.0.0-x64.exe', tool);
    assert.match((await w.act('fjalar', 'telecharger', { nom: 'MonOutil' })).text, /✅ MonOutil 2\.0\.0 .*empreinte vérifiée/);
    assert.ok(existsSync(join(w.sdir, 'Autres', 'MonOutil-2.0.0-x64.exe')));
    assert.match((await w.act('fjalar', 'catalogue')).text, /Ajoutés par toi :\n- ★ MonOutil/);
    assert.match((await w.act('fjalar', 'retirer_source', { nom: 'MonOutil' })).text, /retiré/);
    assert.equal((await w.act('fjalar', 'retirer_source', { nom: 'firefox' })).ok, false);
  } finally { w.end(); }
});
