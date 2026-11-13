// Les fiches des applis dans le Cerveau : tout ce qu'il faut pour comprendre Odin (applis, liens, modes de
// fonctionnement), et rien de ce que tu y as réglé (adresses, noms d'appareils, mots de passe).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Vault, vaultEvents } from '../src/brain/vault.ts';
import { appSheet, sheets, syncSheets } from '../src/valhalla/fiches.ts';
import { LINKS } from '../src/valhalla/links.ts';
import { DEFAULT_CONFIG, odinPaths } from '../src/config.ts';
import { allModules, seedBrain } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';

function world() {
  const home = mkdtempSync(join(tmpdir(), 'odin-fiches-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: join(home, 'workspace') }, cfg: { venus: { url: 'http://192.168.77.10:8096' }, voice: {} } } as never), { notify: async () => {} });
  return { home, v, vault: new Vault(join(home, 'cerveau')), end: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

test('Fiches : une par appli, plus la liste, les liens et le mode de fonctionnement', () => {
  const w = world();
  try {
    const all = w.v.modules(), list = sheets(all);
    assert.equal(list.length, all.length + 3);
    for (const m of all) {
      const s = appSheet(m, all);
      assert.equal(s.path, `Odin/Applis/${m.name}`);
      assert.ok(s.body.startsWith(`# ${m.name}\n\n> ${m.what.slice(0, 30)}`), `${m.name} : titre et rôle`);
      for (const d of m.does) assert.ok(s.body.includes(d.replace(/\[\[.*$/, '')), `${m.name} : « ${d.slice(0, 40)} »`);
      for (const a of m.actions) assert.ok(s.body.includes(`**${a.label}**`), `${m.name} : action ${a.label}`);
      assert.match(s.body, /## Comment lui parler[\s\S]*« /, `${m.name} : exemples de demandes`);
      // Chaque lien annoncé est dans la fiche des deux applis concernées.
      for (const l of LINKS.filter((x) => x.from === m.id || x.to === m.id)) assert.ok(s.body.includes(l.does), `${m.name} : lien ${l.from}>${l.to}`);
    }
    // Les liens [[…]] pointent tous vers une fiche qui existe.
    const titles = new Set(list.map((s) => s.path.split('/').pop()));
    for (const s of list) for (const m of s.body.matchAll(/\[\[([^\]|#]+)/g)) assert.ok(titles.has(m[1]), `${s.path} : lien vers « ${m[1]} »`);
    const how = list.find((s) => s.path.endsWith('Comment fonctionne Odin'))!.body;
    for (const re of [/Sans IA connectée[\s\S]*Huginn/, /Odin Breaker/, /garde » ou « annule/, /commandes destructrices sont interdites/, /jamais un ordre/]) assert.match(how, re);
    assert.match(list.find((s) => s.path.endsWith('Liens entre les applis'))!.body, new RegExp(`${LINKS.length} liens`));
  } finally { w.end(); }
});

test('Fiches : aucun réglage, aucune adresse, aucun secret — même si les applis en ont plein', async () => {
  const w = world();
  const saved = { HA_TOKEN: process.env.HA_TOKEN, MQTT_PASSWORD: process.env.MQTT_PASSWORD };
  try {
    Object.assign(process.env, { HA_TOKEN: 'JETON-SECRET-HA-123', MQTT_PASSWORD: 'MOTDEPASSE-RELAIS-456' });
    w.v.ctx('midgard').saveSettings({ haUrl: 'http://192.168.77.20:8123', scenes: [{ name: 'Scène-Privée-Zanzibar', steps: [] }] });
    w.v.ctx('himinbjorg').saveSettings({ cameras: [{ name: 'Caméra-Chambre-Privée', url: 'rtsp://admin:motdepasse-camera@192.168.77.30/flux' }] });
    w.v.ctx('ymir').saveSettings({ servers: [{ name: 'pve-prive', url: 'https://192.168.77.40:8006' }] });
    w.v.ctx('garmr').saveSettings({ banned: [{ ip: '203.0.113.77' }] });
    w.v.ctx('ullr').saveSettings({ exceptions: { paths: ['/home/awa/dossier-prive'], hashes: [], rules: [] } });
    const r = syncSheets(w.vault, w.v.modules());
    assert.equal(r.written, r.total);
    const text = w.vault.all(true).map((n) => `${n.path}\n${JSON.stringify(n.meta)}\n${n.body}`).join('\n');
    for (const leak of ['JETON-SECRET', 'MOTDEPASSE-RELAIS', '192.168.77.', 'Zanzibar', 'Caméra-Chambre', 'motdepasse-camera', 'pve-prive', '203.0.113.77', 'dossier-prive']) assert.ok(!text.includes(leak), `« ${leak} » ne doit pas être dans les fiches`);
    assert.ok(text.length > 30_000, 'les fiches sont bien remplies');
  } finally { for (const [k, val] of Object.entries(saved)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; } w.end(); }
});

test('Fiches : tenues à jour sans bruit, tes notes sont gardées, une note à toi n\'est jamais écrasée', () => {
  const w = world();
  try {
    const events: unknown[] = [], on = (e: unknown) => events.push(e); vaultEvents.on('change', on);
    try {
      // Une note que tu as écrite toi-même, du même nom qu'une appli.
      w.vault.write('Odin/Applis/Sirènes', { type: 'note' }, '# Sirènes\n\nMa note à moi sur les sirènes.');
      events.length = 0;
      const all = w.v.modules(), first = syncSheets(w.vault, all);
      assert.equal(first.written, first.total - 1, 'toutes sauf la tienne');
      assert.equal(events.length, 0, 'aucune automatisation « note créée » n\'est déclenchée par ces fiches');
      assert.match(readFileSync(join(w.home, 'cerveau', 'Odin', 'Applis', 'Sirènes.md'), 'utf8'), /Ma note à moi sur les sirènes/);
      assert.equal(syncSheets(w.vault, all).written, 0, 'rien à réécrire au deuxième passage');
      // Tu ajoutes tes notes sous « Mes notes » ; la fiche change côté Odin : tes notes restent.
      const f = join(w.home, 'cerveau', 'Odin', 'Applis', 'Asclépios.md'), mine = 'Clé abuse.ch demandée le 12 novembre. Penser à tester EICAR chaque mois.';
      w.vault.write('Odin/Applis/Asclépios', w.vault.read('Odin/Applis/Asclépios')!.meta, readFileSync(f, 'utf8').replace(/^---[\s\S]*?---\n/, '').replace(/_Écris ici[^\n]*_/, mine));
      const changed = all.map((m) => (m.id === 'ullr' ? { ...m, what: 'Antivirus (description changée par une mise à jour d\'Odin).' } : m));
      assert.equal(syncSheets(w.vault, changed).written, 2, 'la fiche de l\'appli et la liste des applis');
      const after = readFileSync(f, 'utf8');
      assert.match(after, /description changée par une mise à jour/); assert.ok(after.includes(mine), 'tes notes sont gardées');
      assert.match(after, /tenue par: Odin/);
      // Le graphe du Cerveau relie les applis entre elles, et un incident retrouve la fiche de l'appli.
      const g = w.vault.graph({});
      const id = (t: string) => g.nodes.find((n) => n.title === t)?.id;
      assert.ok(g.edges.some((e) => (e.from === id('Asclépios') && e.to === id('Cerbère')) || (e.from === id('Cerbère') && e.to === id('Asclépios'))), 'Asclépios et Cerbère sont reliés dans le graphe');
      assert.equal(w.vault.find('Asclépios')?.path, 'Odin/Applis/Asclépios.md');
      assert.ok(w.vault.search('quarantaine antivirus', 5).some((r) => r.note.path === 'Odin/Applis/Asclépios.md'), 'la recherche du Cerveau trouve la fiche');
    } finally { vaultEvents.off('change', on); }
  } finally { w.end(); }
});

test('Fiches : Saga peut les remettre à jour à la demande, sans IA', async () => {
  const w = world();
  try {
    const r = await w.v.order('mets à jour les fiches des applis dans le Cerveau');
    assert.match(r.text, /fiches dans le Cerveau \(dossier « Odin »\)/);
    assert.ok(w.vault.all(true).some((n) => n.path === "Odin/Les applis d'Odin.md"));
    assert.equal(w.v.manips().length, 0, 'simple tenue de registre : pas de manip');
  } finally { w.end(); }
});

test('Cerveau actif dès l\'installation : « odin init » y écrit les fiches, avant le premier lancement, sans IA', () => {
  const root = mkdtempSync(join(tmpdir(), 'odin-neuf-')), home = join(root, '.odin');
  try {
    // 1. La vraie commande de l'installateur, sur un dossier vide, sans aucune clé d'IA.
    const env: NodeJS.ProcessEnv = { ...process.env, ODIN_HOME: home }; for (const k of Object.keys(env)) if (/_API_KEY$|_TOKEN$/.test(k)) delete env[k];
    const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, '..', 'bin', 'odin.mjs'), 'init'], { env, encoding: 'utf8' });
    const n = allModules({ paths: odinPaths(home), cfg: DEFAULT_CONFIG } as never).length;
    assert.match(out, new RegExp(`Cerveau prêt : ${n + 3} fiches`));
    const dir = join(home, 'cerveau', 'Odin');
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.md')).sort(), ['Comment fonctionne Odin.md', 'Les applis d\'Odin.md', 'Liens entre les applis.md']);
    assert.equal(readdirSync(join(dir, 'Applis')).length, n, 'une fiche par appli');
    assert.match(readFileSync(join(dir, 'Applis', 'Arachné.md'), 'utf8'), /tenue par: Odin[\s\S]*# Arachné[\s\S]*## Comment lui parler[\s\S]*## Ses liens avec les autres applis/);
    // 2. Relancer l'installation ne réécrit rien et ne touche pas à ce que tu as noté.
    const mine = join(dir, 'Applis', 'Asclépios.md'); writeFileSync(mine, `${readFileSync(mine, 'utf8').replace(/_Écris ici[^_]*_/, '')}Ma note à moi.\n`);
    assert.match(execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, '..', 'bin', 'odin.mjs'), 'init'], { env, encoding: 'utf8' }), /Déjà initialisé\.[\s\S]*Cerveau prêt : \d+ fiches[^\n]*déjà à jour/);
    assert.match(readFileSync(mine, 'utf8'), /## Mes notes[\s\S]*Ma note à moi\./);
    // 3. La même fonction sert au lancement : rien à refaire si tout est à jour.
    assert.deepEqual(seedBrain({ paths: odinPaths(home), cfg: DEFAULT_CONFIG } as never), { written: 0, total: n + 3 });
    assert.ok(!existsSync(join(home, 'cerveau', 'Odin', 'Applis', 'undefined.md')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Fiches : une appli renommée garde sa fiche (et tes notes dedans) sous son nouveau nom', () => {
  const w = world();
  try {
    const all = w.v.modules();
    // La fiche d'avant, au nom d'Ullr, avec une note à toi
    syncSheets(w.vault, all.map((m) => (m.id === 'ullr' ? { ...m, name: 'Ullr' } : m)));
    const old = w.vault.read('Odin/Applis/Ullr')!; w.vault.write('Odin/Applis/Ullr', old.meta, old.body.replace(/_Écris ici[^\n]*_/, 'Ma note sur l\'antivirus.'));
    syncSheets(w.vault, all);
    assert.equal(w.vault.read('Odin/Applis/Ullr'), undefined, 'l\'ancienne fiche n\'existe plus');
    assert.match(w.vault.read('Odin/Applis/Asclépios')!.body, /# Asclépios[\s\S]*Ma note sur l'antivirus\./);
  } finally { w.end(); }
});
