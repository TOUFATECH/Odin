// Andromède, lot S2 « Catalogue et versions » (maquette validée « Genèse · Systèmes ») : plusieurs versions par source,
// lues sur les sites officiels (faux sites ici : rien n'est téléchargé pour de vrai), la file de téléchargement (un à
// la fois, annulable, retirer de la file), l'empreinte vérifiée pour chaque version choisie, le disque plein refusé
// AVANT d'écrire, les gestes réservés au propriétaire, et « à déposer » pour ce qui ne se télécharge pas seul.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { canauxDe, ISO, parSerie, serieDe, versionsDe } from '../src/valhalla/forge/sources.ts';
import { download, espaceDisque, fileRevue, MARGE_DISQUE, refusPlace, versionPropre } from '../src/valhalla/forge/forge.ts';
import { entrees, groupeDe, metaDe } from '../src/valhalla/forge/store.ts';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** De faux sites officiels. Les gros fichiers arrivent en morceaux, lentement : on compte combien se téléchargent en même temps. */
function fakeWeb() {
  const routes = new Map<string, string | Buffer>(), hits: string[] = [], portes = new Map<string, Promise<void>>();
  let actifs = 0, maxActifs = 0, lent = 0;
  const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input); hits.push(`${init?.method ?? 'GET'} ${url}`);
    await portes.get(url); // une réponse retenue (le site met du temps) : l'essai décide quand elle part
    const body = routes.get(url); if (body === undefined) return new Response('introuvable', { status: 404 });
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (!/\.iso$/.test(url)) return new Response(buf, { status: 200, headers: { 'content-length': String(buf.length) } });
    const signal = init?.signal;
    let i = 0, fini = false; actifs++; maxActifs = Math.max(maxActifs, actifs);
    const fin = () => { if (!fini) { fini = true; actifs--; } };
    const stream = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (signal?.aborted) { fin(); c.error(signal.reason ?? new Error('annulé')); return; }
        if (lent) await pause(lent);
        if (i >= buf.length) { fin(); c.close(); return; }
        c.enqueue(new Uint8Array(buf.subarray(i, i + 64))); i += 64;
      },
      cancel() { fin(); },
    });
    return new Response(stream, { status: 200, headers: { 'content-length': String(buf.length) } });
  };
  return { routes, hits, portes, fetch: fetchFn, get maxActifs() { return maxActifs; }, set lent(ms: number) { lent = ms; } };
}

const ISO_U = (v: string) => Buffer.from(`ISO Ubuntu ${v} `.repeat(40));
/** Le site d'Ubuntu : un index de dossiers par version, un fichier d'empreintes dans chacun. */
function ubuntu(web: ReturnType<typeof fakeWeb>, o: { faux?: string } = {}) {
  web.routes.set('https://releases.ubuntu.com/', ['24.04.3/', '24.04/', '22.04.5/', '22.04/', '20.04.6/', 'noble/', '../'].map((d) => `<a href="${d}">${d}</a>`).join('\n'));
  for (const v of ['24.04.3', '22.04.5', '20.04.6']) {
    const f = `ubuntu-${v}-desktop-amd64.iso`, b = ISO_U(v);
    web.routes.set(`https://releases.ubuntu.com/${v}/SHA256SUMS`, `${o.faux === v ? 'f'.repeat(64) : sha(b)} *${f}\n${sha('x')} *ubuntu-${v}-live-server-amd64.iso\n`);
    web.routes.set(`https://releases.ubuntu.com/${v}/${f}`, b);
  }
}

function world() {
  const home = mkdtempSync(join(tmpdir(), 'forge-cat-')), web = fakeWeb(), alerts: Array<{ level: string; title: string; detail?: string }> = [];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: web.fetch as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  v.events.on('alert', (a: { level: string; title: string; detail?: string }) => alerts.push(a));
  const dir = join(home, 'nas', 'iso');
  const eitri = () => v.module('eitri') as unknown as { _file: () => Promise<void>; _jobs: () => unknown[] };
  const libre = espaceDisque.libre;
  return { v, web, alerts, home, dir, eitri, act: (a: string, i: Record<string, unknown> = {}, o = {}) => v.act('eitri', a, i, o),
    end: () => { espaceDisque.libre = libre; v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
const fichiers = (d: string): string[] => { const out: string[] = []; const walk = (x: string, r: string) => { if (!existsSync(x)) return; for (const n of readdirSync(x, { withFileTypes: true })) { if (n.isDirectory()) walk(join(x, n.name), `${r}${n.name}/`); else out.push(`${r}${n.name}`); } }; walk(d, ''); return out.sort(); };

test('outils purs : séries, une version par série, canaux (la LTS d\'avant pour Ubuntu), file relue avec méfiance, place', () => {
  assert.deepEqual(['24.04.3', '24.04', '8.4-1', '22.1', '42-1.1', '2025.3', '3.20.3', '9.5', '25H2'].map(serieDe), ['24.04', '24.04', '8.4', '22', '42.1', '2025', '3.20', '9', '25H2']);
  const r = (version: string) => ({ version, file: '', url: '' });
  assert.deepEqual(parSerie([r('22.04.5'), r('24.04'), r('24.04.3'), r('22.04'), r('20.04.6')]).map((x) => x.version), ['24.04.3', '22.04.5', '20.04.6']);
  assert.equal(parSerie(Array.from({ length: 20 }, (_, k) => r(`${k + 1}.0.0`))).length, 8, 'huit séries au plus');
  const u = ISO.find((x) => x.id === 'ubuntu')!, d = ISO.find((x) => x.id === 'proxmox')!;
  assert.deepEqual(canauxDe(u, [r('22.04.5'), r('24.04.3'), r('20.04.6')]).map((x) => `${x.version}:${x.canal}:${x.defaut}`), ['24.04.3:LTS:true', '22.04.5:ancienne:true', '20.04.6:ancienne:false']);
  assert.deepEqual(canauxDe(d, [r('8.4-1'), r('9.0-1')]).map((x) => `${x.version}:${x.canal}:${x.defaut}`), ['9.0-1:dernière:true', '8.4-1:ancienne:false']);
  // Une version qui viendrait d'une page : jamais un chemin, une adresse, ni un texte sans fin.
  assert.deepEqual(['24.04.3', ' 9.0-1 ', '../x', 'a/b', 'https://x', 'v'.repeat(61), '', 3].map(versionPropre), ['24.04.3', '9.0-1', '', '', '', '', '', '']);
  assert.deepEqual(fileRevue([{ source: 'ubuntu', nom: 'Ubuntu', version: '24.04.3', ajoute: 1 }, { source: 'ubuntu', version: '24.04.3' }, { source: 'x', version: '../a' }, null, 'x', { source: 'debian', version: '13.2.0', taille: -4 }]).map((x) => `${x.source}:${x.version}:${x.taille ?? ''}`), ['ubuntu:24.04.3:', 'debian:13.2.0:']);
  assert.equal(fileRevue(Array.from({ length: 30 }, (_, k) => ({ source: `s${k}`, version: '1' }))).length, 20);
  assert.equal(refusPlace(undefined, 10), undefined, 'taille inconnue : la vérification se fait au début de la réponse');
  assert.equal(refusPlace(1000, undefined), undefined);
  assert.equal(refusPlace(1000, MARGE_DISQUE + 2000), undefined);
  assert.match(refusPlace(1000, MARGE_DISQUE + 500)!, /pas assez de place/);
  assert.match(refusPlace(1000, MARGE_DISQUE + 2000, 1500)!, /en comptant la file/);
  // Le rangement du catalogue.
  const g = (id: string) => { const s = ISO.find((x) => x.id === id)!; return groupeDe(metaDe(s), s.family, s.name); };
  assert.deepEqual(['windows11', 'ubuntu', 'ubuntu-server', 'proxmox', 'truenas', 'clonezilla', 'memtest', 'freebsd', 'macos', 'debian', 'debian-dvd', 'debian-arm64', 'rocky', 'windows-server'].map(g), ['windows', 'linux', 'serveur', 'serveur', 'serveur', 'outil', 'outil', 'serveur', 'autre', 'linux', 'linux', 'linux', 'serveur', 'serveur']);
});

test('versions publiées : lues sur le site officiel (index et empreintes), sans télécharger ; gardées pour le catalogue', async () => {
  const w = world();
  try {
    ubuntu(w.web);
    w.web.routes.set('https://enterprise.proxmox.com/iso/SHA256SUMS', ['9.0-1', '8.4-1', '8.3-1', '8.4-0'].map((v) => `${sha(v)}  proxmox-ve_${v}.iso`).join('\n'));
    const r = await w.act('versions', { nom: 'ubuntu' });
    const l = (r.data as { versions: Array<{ version: string; canal: string; defaut: boolean }> }).versions;
    assert.deepEqual(l.map((x) => `${x.version}:${x.canal}:${x.defaut}`), ['24.04.3:LTS:true', '22.04.5:ancienne:true', '20.04.6:ancienne:false']);
    const p = (await w.act('versions', { nom: 'proxmox' })).data as { versions: Array<{ version: string }> };
    assert.deepEqual(p.versions.map((x) => x.version), ['9.0-1', '8.4-1', '8.3-1']);
    assert.ok(!w.web.hits.some((h) => /\.iso$/.test(h)), 'aucune image téléchargée pour lire les versions');
    assert.ok(!w.web.hits.some((h) => h.includes('/22.04.5/')), 'les empreintes d\'une ancienne version ne sont lues qu\'au moment de la télécharger');
    // Le Store les montre ensuite sans relire le site.
    const n = w.web.hits.length, st = (await w.act('store', { q: 'ubuntu bureau' })).data as { entrees: Array<{ id: string; versions?: unknown[]; groupe?: string }> };
    const e = st.entrees.find((x) => x.id === 'ubuntu')!;
    assert.equal(e.versions?.length, 3); assert.equal(e.groupe, 'linux'); assert.equal(w.web.hits.length, n);
    // Une source « à déposer » : pas de liste, la page officielle et le dossier.
    const m = await w.act('versions', { nom: 'esxi' });
    assert.deepEqual((m.data as { versions: unknown[] }).versions, []); assert.match(m.text, /support\.broadcom\.com/);
  } finally { w.end(); }
});

test('la file : une version choisie, empreinte vérifiée dans SON dossier, un seul téléchargement à la fois, puis le suivant', async () => {
  const w = world();
  try {
    await w.act('dossier', { chemin: w.dir });
    ubuntu(w.web); w.web.lent = 3;
    const a = await w.act('mettre_en_file', { nom: 'ubuntu', version: '22.04.5' });
    assert.equal(a.ok, true, a.text); assert.match(a.text, /téléchargement lancé/);
    const b = await w.act('mettre_en_file', { nom: 'ubuntu', version: '24.04.3' });
    assert.equal(b.ok, true, b.text); assert.match(b.text, /attend son tour \(après Ubuntu \(bureau, LTS\) 22\.04\.5\)/);
    // Pendant ce temps : la file se lit, un doublon est refusé.
    const f = (await w.act('file')).data as { enCours?: { version: string }; file: Array<{ version: string }> };
    assert.equal(f.enCours?.version, '22.04.5'); assert.deepEqual(f.file.map((x) => x.version), ['24.04.3']);
    assert.match((await w.act('mettre_en_file', { nom: 'ubuntu', version: '24.04.3' })).text, /déjà dans la file/);
    assert.match((await w.act('mettre_en_file', { nom: 'ubuntu', version: '22.04.5' })).text, /se télécharge déjà/);
    await w.eitri()._file();
    assert.equal(w.web.maxActifs, 1, 'jamais deux téléchargements en même temps');
    // L'ancienne version choisie reste à côté de la nouvelle : rien n'est rangé ni effacé pour elle.
    const l = fichiers(w.dir);
    assert.ok(l.some((x) => x.endsWith('ubuntu-22.04.5-desktop-amd64.iso')) && l.some((x) => x.endsWith('ubuntu-24.04.3-desktop-amd64.iso')), l.join(', '));
    assert.ok(!l.some((x) => x.includes('.part')));
    const h = (await w.act('historique', { n: 20 })).text;
    assert.match(h, /téléchargé · Ubuntu \(bureau, LTS\) 22\.04\.5 .*empreinte de l'éditeur vérifiée/);
    assert.match(h, /téléchargé · Ubuntu \(bureau, LTS\) 24\.04\.3 .*empreinte de l'éditeur vérifiée/);
    // Déjà là : refusé sans rien relire.
    assert.match((await w.act('mettre_en_file', { nom: 'ubuntu', version: '22.04.5' })).text, /déjà dans ton dossier/);
  } finally { w.end(); }
});

test('seulement ce que le site officiel publie ; empreinte fausse : fichier jeté, jamais gardé', async () => {
  const w = world();
  try {
    await w.act('dossier', { chemin: w.dir });
    ubuntu(w.web, { faux: '20.04.6' });
    const n = await w.act('mettre_en_file', { nom: 'ubuntu', version: '18.04.6' });
    assert.equal(n.ok, false); assert.match(n.text, /pas publiée sur le site officiel/);
    for (const v of ['../../etc', 'https://ailleurs.example/x.iso', 'a b']) assert.match((await w.act('mettre_en_file', { nom: 'ubuntu', version: v })).text, /illisible/);
    assert.ok(!w.web.hits.some((h) => h.includes('ailleurs')));
    const r = await w.act('mettre_en_file', { nom: 'ubuntu', version: '20.04.6' }); assert.equal(r.ok, true, r.text);
    await w.eitri()._file();
    assert.ok(!fichiers(w.dir).some((x) => x.includes('20.04.6')), 'le fichier à l\'empreinte fausse n\'est pas gardé');
    assert.match((await w.act('historique', { n: 5 })).text, /empreinte fausse · Ubuntu \(bureau, LTS\) 20\.04\.6/);
    assert.ok(w.alerts.some((x) => /empreinte fausse, fichier jeté/.test(x.title)));
  } finally { w.end(); }
});

test('jamais un fichier non vérifié : l\'éditeur publie une empreinte, elle manque → rien ne part', async () => {
  const w = world();
  try {
    await w.act('dossier', { chemin: w.dir });
    const base = 'https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/';
    w.web.routes.set(base, ['alpine-standard-3.22.1-x86_64.iso', 'alpine-standard-3.22.1-x86_64.iso.sha256', 'alpine-standard-3.21.4-x86_64.iso'].map((d) => `<a href="${d}">${d}</a>`).join(''));
    w.web.routes.set(`${base}alpine-standard-3.21.4-x86_64.iso`, Buffer.from('alpine'.repeat(50)));
    const v = (await w.act('versions', { nom: 'alpine' })).data as { versions: Array<{ version: string }> };
    assert.deepEqual(v.versions.map((x) => x.version), ['3.22.1', '3.21.4']);
    assert.equal((await w.act('mettre_en_file', { nom: 'alpine', version: '3.21.4' })).ok, true);
    await w.eitri()._file();
    assert.ok(!w.web.hits.includes(`GET ${base}alpine-standard-3.21.4-x86_64.iso`), 'l\'image n\'est même pas demandée');
    assert.deepEqual(fichiers(w.dir).filter((x) => x.includes('alpine')), []);
    assert.match((await w.act('historique', { n: 5 })).text, /échec · Alpine Linux 3\.21\.4 · l'éditeur publie une empreinte/);
  } finally { w.end(); }
});

test('disque plein : refusé AVANT (taille connue à l\'ajout, ou annoncée au début de la réponse), jamais au milieu', async () => {
  const w = world();
  try {
    await w.act('dossier', { chemin: w.dir });
    ubuntu(w.web);
    // Taille connue (le Store l'a lue) : refusée dès l'ajout, rien n'est demandé au site.
    w.web.routes.set('https://enterprise.proxmox.com/iso/SHA256SUMS', `${sha('p')}  proxmox-ve_9.0-1.iso`);
    await w.act('versions', { nom: 'proxmox' });
    w.v.ctx('eitri').saveSettings({ vues: { proxmox: { version: '9.0-1', at: Date.now(), taille: 6 * 1024 ** 3 } } });
    espaceDisque.libre = () => 2 * 1024 ** 3;
    const r = await w.act('mettre_en_file', { nom: 'proxmox', version: '9.0-1' });
    assert.equal(r.ok, false); assert.match(r.text, /pas assez de place sur le disque : il faut 6,50 Go .*il reste 2,00 Go/);
    assert.deepEqual(((await w.act('file')).data as { file: unknown[] }).file, []);
    // Taille inconnue : la réponse du site la donne ; refusé avant d'écrire le moindre octet.
    espaceDisque.libre = () => MARGE_DISQUE + 10;
    const u = await w.act('mettre_en_file', { nom: 'ubuntu', version: '22.04.5' }); assert.equal(u.ok, true, u.text);
    await w.eitri()._file();
    assert.deepEqual(fichiers(w.dir).filter((x) => x.includes('ubuntu')), [], 'ni fichier, ni morceau entamé');
    assert.match((await w.act('historique', { n: 5 })).text, /échec · Ubuntu \(bureau, LTS\) 22\.04\.5 · pas assez de place/);
    assert.ok(w.alerts.some((x) => /pas assez de place/.test(x.title)));
  } finally { w.end(); }
});

test('arrêter le téléchargement en cours : la file continue ; retirer de la file : rien n\'est effacé', async () => {
  const w = world();
  try {
    await w.act('dossier', { chemin: w.dir });
    ubuntu(w.web); w.web.lent = 15;
    await w.act('mettre_en_file', { nom: 'ubuntu', version: '24.04.3' });
    await w.act('mettre_en_file', { nom: 'ubuntu', version: '22.04.5' });
    await w.act('mettre_en_file', { nom: 'ubuntu', version: '20.04.6' });
    const rf = await w.act('retirer_de_la_file', { nom: 'ubuntu', version: '20.04.6' });
    assert.equal(rf.ok, true); assert.deepEqual((rf.data as { file: Array<{ version: string }> }).file.map((x) => x.version), ['22.04.5']);
    assert.match((await w.act('retirer_de_la_file', { nom: 'ubuntu', version: '20.04.6' })).text, /n'est pas dans la file/);
    for (let k = 0; k < 100 && !w.eitri()._jobs().length; k++) await pause(10);
    assert.match((await w.act('retirer_de_la_file', { nom: 'ubuntu', version: '24.04.3' })).text, /se télécharge déjà : utilise « Arrêter »/);
    assert.match((await w.act('annuler', { nom: 'ubuntu' })).text, /Arrêté/);
    w.web.lent = 0;
    await w.eitri()._file();
    const l = fichiers(w.dir);
    assert.ok(l.some((x) => x.endsWith('ubuntu-22.04.5-desktop-amd64.iso')), 'le suivant de la file est passé');
    assert.ok(!l.some((x) => x.endsWith('ubuntu-24.04.3-desktop-amd64.iso')) && !l.some((x) => x.includes('20.04.6')));
  } finally { w.end(); }
});

test('une version listée par son dossier (« 42 ») et publiée sous son nom complet (« 42-1.1 ») : la même, jamais deux fois', async () => {
  const w = world();
  try {
    await w.act('dossier', { chemin: w.dir });
    const base = 'https://download.fedoraproject.org/pub/fedora/linux/releases/';
    w.web.routes.set(base, ['40/', '41/', '42/'].map((d) => `<a href="${d}">${d}</a>`).join(''));
    for (const [v, f] of [['42', '42-1.1'], ['41', '41-1.4']]) {
      const dir = `${base}${v}/Workstation/x86_64/iso/`, nom = `Fedora-Workstation-Live-${f}.x86_64.iso`, b = Buffer.from(`fedora ${f}`.repeat(30));
      w.web.routes.set(dir, `<a href="Fedora-Workstation-${f}-x86_64-CHECKSUM">x</a><a href="${nom}">x</a>`);
      w.web.routes.set(`${dir}Fedora-Workstation-${f}-x86_64-CHECKSUM`, `SHA256 (${nom}) = ${sha(b)}\n`);
      w.web.routes.set(`${dir}${nom}`, b);
    }
    const l = (await w.act('versions', { nom: 'fedora' })).data as { versions: Array<{ version: string }> };
    assert.deepEqual(l.versions.map((x) => x.version), ['42', '41', '40']);
    // « la dernière » (vide) : lue sous son nom complet, trouvée dans la liste par sa série.
    const r = await w.act('mettre_en_file', { nom: 'fedora' }); assert.equal(r.ok, true, r.text); assert.match(r.text, /42-1\.1/);
    await w.eitri()._file();
    assert.ok(fichiers(w.dir).some((x) => x.endsWith('Fedora-Workstation-Live-42-1.1.x86_64.iso')), fichiers(w.dir).join(', '));
    assert.match((await w.act('mettre_en_file', { nom: 'fedora', version: '42' })).text, /déjà dans ton dossier/);
    // La 41 choisie dans la liste : son empreinte est lue dans SON dossier.
    assert.equal((await w.act('mettre_en_file', { nom: 'fedora', version: '41' })).ok, true);
    await w.eitri()._file();
    assert.match((await w.act('historique', { n: 5 })).text, /téléchargé · Fedora Workstation 41-1\.4 .*empreinte de l'éditeur vérifiée/);
  } finally { w.end(); }
});

test('« Télécharger » pendant un autre téléchargement : il attend son tour au lieu d\'être refusé', async () => {
  const w = world();
  try {
    await w.act('dossier', { chemin: w.dir });
    ubuntu(w.web); w.web.lent = 3;
    w.web.routes.set('https://enterprise.proxmox.com/iso/SHA256SUMS', `${sha(Buffer.from('P'.repeat(300)))}  proxmox-ve_9.0-1.iso`);
    w.web.routes.set('https://enterprise.proxmox.com/iso/proxmox-ve_9.0-1.iso', Buffer.from('P'.repeat(300)));
    await w.act('mettre_en_file', { nom: 'ubuntu', version: '22.04.5' });
    const t = await w.act('telecharger', { nom: 'proxmox' });
    assert.match(t.text, /Proxmox VE 9\.0-1 attend son tour/);
    await w.eitri()._file();
    assert.equal(w.web.maxActifs, 1);
    assert.ok(fichiers(w.dir).some((x) => x.endsWith('proxmox-ve_9.0-1.iso')));
  } finally { w.end(); }
});

test('gestes réservés au propriétaire : télécharger, mettre en file, retirer, arrêter ; les lectures restent ouvertes', async () => {
  const w = world();
  try {
    ubuntu(w.web);
    for (const o of [{ qui: 'member' as const }, { qui: 'guest' as const }, { auto: true }, { by: 'odin' as const }, { marque: true }]) {
      for (const [a, i] of [['telecharger', { nom: 'ubuntu' }], ['mettre_en_file', { nom: 'ubuntu', version: '22.04.5' }], ['retirer_de_la_file', { nom: 'ubuntu' }], ['annuler', { nom: '' }], ['telecharger_en_ligne', { index: 'github', ref: 'a/b' }]] as const) {
        const r = await w.act(a, i, o);
        assert.equal(r.ok, false, `${a} ${JSON.stringify(o)}`); assert.match(r.text, /seul le propriétaire/);
      }
    }
    assert.ok(!w.web.hits.some((h) => /\.iso$/.test(h)));
    assert.deepEqual(((await w.act('file', {}, { qui: 'member' })).data as { file: unknown[] }).file, []);
  } finally { w.end(); }
});

test('« à déposer » : ce que l\'éditeur ne laisse pas télécharger seul ; Odin dit où déposer le fichier, sans rien contourner', async () => {
  const w = world();
  try {
    await w.act('dossier', { chemin: w.dir });
    for (const a of ['mettre_en_file', 'telecharger']) {
      const r = await w.act(a, { nom: 'windows-server' });
      assert.equal(r.ok, false); assert.match(r.text, /formulaire/); assert.match(r.text, /microsoft\.com\/fr-fr\/evalcenter/); assert.ok(r.text.includes(w.dir), 'le dossier où déposer le fichier');
    }
    assert.equal(w.web.hits.length, 0, 'rien n\'est demandé au site');
    // Le Store le range dans son groupe, marqué manuel.
    const e = entrees({ sources: ISO.filter((x) => x.id === 'windows-server'), presents: new Map(), suivis: new Set(), vues: {}, enCours: new Set() })[0];
    assert.deepEqual([e.etat, e.groupe], ['manuel', 'serveur']);
  } finally { w.end(); }
});

test('les sources qui ne publient que leur dernière version (dépôt GitHub) : une seule version proposée', async () => {
  const web = fakeWeb();
  web.routes.set('https://api.github.com/repos/stevenshiau/clonezilla/releases/latest', JSON.stringify({ tag_name: '3.2.1-9', html_url: 'https://github.com/stevenshiau/clonezilla/releases/x', assets: [{ name: 'clonezilla-live-3.2.1-9-amd64.iso', browser_download_url: 'https://github.com/x/clonezilla-live-3.2.1-9-amd64.iso', size: 400, digest: `sha256:${'a'.repeat(64)}` }] }));
  const l = await versionsDe(web.fetch as never, ISO.find((x) => x.id === 'clonezilla')!);
  assert.deepEqual(l.map((x) => [x.version, x.size, x.sha256]), [['3.2.1-9', 400, 'a'.repeat(64)]]);
});

// ---------------------------------------------------------------- relecture adverse du lot S2
test('relecture · téléchargement d\'une source officielle : https seulement, jamais la maison ni la machine, chaque redirection revérifiée', async () => {
  const d = mkdtempSync(join(tmpdir(), 'forge-redir-'));
  try {
    const corps = Buffer.from('image officielle '.repeat(20));
    const vus: string[] = [];
    // Un faux réseau : sans « manual », la redirection est suivie sans rien dire (comme fetch) ; un hôte inconnu répond « secret ».
    const routes: Record<string, { loc?: string; body?: Buffer }> = {
      'https://officiel.example.org/a.iso': { loc: 'https://miroir.example.net/a.iso' }, 'https://miroir.example.net/a.iso': { body: corps },
      'https://officiel.example.org/b.iso': { loc: 'http://169.254.169.254/latest/meta-data/' },
      'https://officiel.example.org/c.iso': { loc: 'https://127.0.0.1:9/c.iso' },
      'https://officiel.example.org/d.iso': { loc: 'http://miroir.example.net/d.iso' },
      'https://officiel.example.org/e.iso': { loc: 'https://[::1]/e.iso' },
      'https://officiel.example.org/f.iso': { loc: '//192.168.1.1/f.iso' },
    };
    const f = async (u: string, init?: RequestInit): Promise<Response> => {
      vus.push(u); let url = u, x = routes[u];
      for (let k = 0; init?.redirect !== 'manual' && x?.loc && k < 5; k++) { url = new URL(x.loc, url).toString(); vus.push(url); x = routes[url] ?? { body: Buffer.from('secret de la maison') }; }
      if (x?.loc) return new Response(null, { status: 302, headers: { location: x.loc } });
      return new Response(x?.body ?? Buffer.from('secret de la maison'), { status: 200 });
    };
    const surete = { resoudre: async (h: string) => (h === 'piege.example.org' ? ['10.0.0.5'] : ['93.184.215.14']) };
    // Directement une adresse qui n'est pas un site public en https : rien n'est même demandé.
    for (const url of ['http://officiel.example.org/a.iso', 'https://192.168.1.10/a.iso', 'https://[::1]/a.iso', 'https://[::ffff:7f00:1]/a.iso', 'https://localhost/a.iso', 'https://169.254.169.254/a.iso', 'https://2130706433/a.iso', 'https://nas.local/a.iso', 'https://piege.example.org/a.iso']) {
      vus.length = 0;
      await assert.rejects(download(f, { version: '1', file: 'a.iso', url }, d, { surete }), /refusée/, url);
      assert.deepEqual(vus, [], `${url} : rien n'est demandé`);
    }
    // Une redirection vers la maison, la machine, ou en http : refusée, rien n'est écrit.
    for (const k of ['b', 'c', 'd', 'e', 'f']) {
      await assert.rejects(download(f, { version: '1', file: `${k}.iso`, url: `https://officiel.example.org/${k}.iso` }, d, { surete }), /refusée/, k);
    }
    assert.deepEqual(readdirSync(d), [], 'ni fichier, ni morceau entamé');
    assert.ok(!vus.some((u) => /169\.254|127\.0\.0\.1|\[::1\]|192\.168|^http:/.test(u)), vus.join(' '));
    // Un miroir public en https (Fedora, kernel.org) : suivi normalement.
    const r = await download(f, { version: '1', file: 'a.iso', url: 'https://officiel.example.org/a.iso', sha256: sha(corps) }, d, { surete });
    assert.equal(r.checked, true); assert.deepEqual(readdirSync(d), ['a.iso']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('relecture · un nom de fichier que Windows détourne (flux caché « : », nom réservé, point final) : refusé sans rien demander', async () => {
  const d = mkdtempSync(join(tmpdir(), 'forge-nom-'));
  try {
    const vus: string[] = [];
    const f = async (u: string) => { vus.push(u); return new Response(Buffer.from('x'), { status: 200 }); };
    for (const file of ['a:b.iso', 'CON.iso', 'nul.1.2.exe', 'com1', 'LPT9.txt', 'x.iso.', 'x.iso ', 'a\u0001b.iso', 'a|b.iso', 'a?.iso']) {
      await assert.rejects(download(f, { version: '1', file, url: 'https://officiel.example.org/x' }, d), /nom de fichier invalide/, JSON.stringify(file));
    }
    assert.deepEqual(vus, []); assert.deepEqual(readdirSync(d), []);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('relecture · le disque se remplit pendant l\'écriture : le morceau entamé est effacé (le disque ne reste pas plein), jamais marqué prêt', async () => {
  const d = mkdtempSync(join(tmpdir(), 'forge-plein-'));
  try {
    let n = 0;
    const f = async () => new Response(new ReadableStream<Uint8Array>({ pull(c) { if (n++ < 3) c.enqueue(new Uint8Array(64)); else c.error(Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })); } }), { status: 200 });
    await assert.rejects(download(f, { version: '1', file: 'gros.iso', url: 'https://officiel.example.org/gros.iso' }, d), (e: Error & { code?: string }) => e.code === 'PLACE' && /plein/.test(e.message));
    assert.deepEqual(readdirSync(d), [], 'ni fichier, ni morceau entamé');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('relecture · la dernière version d\'Alpine : le « .sha256 » publié est illisible → rien n\'est téléchargé sans empreinte', async () => {
  const w = world();
  try {
    await w.act('dossier', { chemin: w.dir });
    const base = 'https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/';
    w.web.routes.set(base, ['alpine-standard-3.22.1-x86_64.iso', 'alpine-standard-3.22.1-x86_64.iso.sha256'].map((x) => `<a href="${x}">${x}</a>`).join(''));
    w.web.routes.set(`${base}alpine-standard-3.22.1-x86_64.iso.sha256`, '<html>maintenance</html>');
    w.web.routes.set(`${base}alpine-standard-3.22.1-x86_64.iso`, Buffer.from('alpine'.repeat(50)));
    const t = await w.act('telecharger', { nom: 'alpine' });
    assert.ok(!w.web.hits.includes(`GET ${base}alpine-standard-3.22.1-x86_64.iso`), `l'image n'est pas demandée : ${t.text}`);
    assert.deepEqual(fichiers(w.dir).filter((x) => x.includes('alpine')), []);
  } finally { w.end(); }
});

test('relecture · « Arrêter » pendant la préparation (lien et empreinte en lecture) : rien ne part ensuite', async () => {
  const w = world();
  try {
    await w.act('dossier', { chemin: w.dir });
    ubuntu(w.web);
    await w.act('versions', { nom: 'ubuntu' });
    let ouvrir = () => {}; w.web.portes.set('https://releases.ubuntu.com/22.04.5/SHA256SUMS', new Promise<void>((ok) => { ouvrir = ok; }));
    assert.equal((await w.act('mettre_en_file', { nom: 'ubuntu', version: '22.04.5' })).ok, true);
    assert.equal(((await w.act('file')).data as { enCours?: { prepare?: boolean } }).enCours?.prepare, true, 'la carte montre « Préparation… » et « Arrêter »');
    assert.match((await w.act('annuler', { nom: 'ubuntu' })).text, /Arrêté/);
    ouvrir(); await w.eitri()._file();
    assert.ok(!w.web.hits.some((h) => h.endsWith('ubuntu-22.04.5-desktop-amd64.iso')), 'l\'image n\'est pas demandée');
    assert.deepEqual(fichiers(w.dir).filter((x) => x.includes('ubuntu')), []);
    assert.equal(((await w.act('file')).data as { enCours?: unknown }).enCours, undefined);
  } finally { w.end(); }
});

test('relecture · la lecture « file » ne donne pas le dossier de la machine', async () => {
  const w = world();
  try {
    await w.act('dossier', { chemin: w.dir });
    const d = (await w.act('file', {}, { qui: 'member' })).data as Record<string, unknown>;
    assert.ok(!('dossier' in d) && !JSON.stringify(d).includes('nas'), JSON.stringify(d));
  } finally { w.end(); }
});
