// Genèse · le menu PXE, lot S9 (maquette validée « Genèse · Systèmes ») : l'ordre des systèmes, les systèmes cachés,
// l'entrée par défaut (jamais une entrée qui installe ou peut effacer pour un PC non autorisé, ni au bout du délai), le
// délai, la disposition, et les textes envoyés au chargeur iPXE nettoyés (ni guillemet, ni retour, ni « ${…} »).
// Le vrai Odin (Valhalla) dans des dossiers temporaires neufs ; les PC qui démarrent sont SIMULÉS (aucun port ouvert,
// aucun vrai réseau, aucun vrai PC).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { after, test } from 'node:test';
import { menu, type Recipe } from '../src/valhalla/thjalfi/recipes.ts';
import { defautSur, famillesGroupees, idsPropres, installe, lireMenu, menuPxeCfg, ordonner, texteIpxe, visibles } from '../src/valhalla/thjalfi/menu-pxe.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const LIVE: Recipe = { kind: 'casper', label: 'Linux Mint (démarrage)', auto: false, os: 'linux', kernel: 'casper/vmlinuz', initrd: ['casper/initrd'] };
const UBUNTU: Recipe = { kind: 'ubuntu', label: 'Ubuntu (installation automatique)', auto: true, os: 'linux', kernel: 'casper/vmlinuz', initrd: ['casper/initrd'] };
const INCONNUE: Recipe = { kind: 'iso', label: 'ISO démarrée telle quelle', auto: false, os: 'outil' };
const CLONE: Recipe = { kind: 'debian-live', label: 'Clonezilla (démarrage)', auto: false, os: 'outil', kernel: 'live/vmlinuz', initrd: ['live/initrd.img'] };
const fam = (e: { name: string }) => (/win/i.test(e.name) ? 'Windows' : /clone/i.test(e.name) ? 'Outils' : 'Linux');
const items = (script: string) => script.split('\n').filter((l) => /^item /.test(l));

test('menu PXE : les textes envoyés au chargeur iPXE ne cassent jamais son script', () => {
  assert.equal(texteIpxe('Ubuntu « 24.04 » d\'été'), 'Ubuntu 24.04 d ete');
  for (const piege of ['a"b', 'a\'b', 'x${base}y', 'x\ny', 'x\r\ny', 'a || reboot', 'a && shell', '# rien', 'a`b`', '$(sel)', '--gap', '-- -x']) {
    const t = texteIpxe(piege);
    assert.doesNotMatch(t, /["'`$\n\r{}|&#]/, `nettoyé : ${JSON.stringify(piege)} → ${t}`);
    assert.doesNotMatch(t, /^-/, 'ne commence jamais par un tiret (iPXE le lirait comme une option)');
  }
  assert.equal(texteIpxe('x'.repeat(80), 20).length, 20);
  // Un nom de système piégé : sa ligne du menu ne garde rien de dangereux, et aucune ligne de commande n'est ajoutée.
  const nom = 'Ubuntu"\n:local\nshell ${base} || chain http://ailleurs/x \'y\'';
  const m = menu({ base: 'http://192.0.2.1:16000', mac: '52:54:00:00:00:01', entries: [{ id: 'ubu', name: nom, recipe: LIVE }], def: 'local', timeout: 5 });
  const ligne = items(m).find((l) => l.startsWith('item e-ubu '))!;
  assert.ok(ligne, 'le système est au menu');
  assert.doesNotMatch(ligne.slice('item e-ubu '.length), /["'$\n{}|]/);
  assert.equal(m.split('\n').filter((l) => l === ':local').length, 1, 'aucune étiquette ajoutée par le nom');
  assert.doesNotMatch(m, /^(chain http:\/\/ailleurs|shell \$\{base\})/m, 'aucune commande ajoutée par le nom');
  const charge = m.split('\n').find((l) => l.startsWith('echo Chargement : '))!;
  assert.doesNotMatch(charge, /["'$|]/, 'la ligne « Chargement » est nettoyée aussi');
  // Un identifiant qui ne serait pas sûr (il sert d'étiquette) n'est jamais écrit ; une adresse MAC fausse non plus.
  const m2 = menu({ base: 'http://o:1', mac: 'aa:bb${x}', entries: [{ id: 'x y\nshell', name: 'X', recipe: LIVE }], def: 'x y\nshell', timeout: 5 });
  assert.doesNotMatch(m2, /x y|\$\{x\}/); assert.match(m2, /choose --default local /);
});

test('menu PXE : ordre choisi, systèmes cachés, disque du PC toujours proposé en dernier', () => {
  const list = [{ id: 'win11', name: 'Win11' }, { id: 'ubu', name: 'Ubuntu' }, { id: 'clone', name: 'Clonezilla' }, { id: 'mint', name: 'Mint' }];
  // Sans ordre choisi : par famille (comme avant).
  assert.deepEqual(ordonner(list, menuPxeCfg({}), fam).map((x) => x.id), ['win11', 'ubu', 'mint', 'clone']);
  // L'ordre choisi d'abord ; un système arrivé depuis (mint) se range derrière.
  assert.deepEqual(ordonner(list, menuPxeCfg({ ordre: ['clone', 'ubu', 'win11'] }), fam).map((x) => x.id), ['clone', 'ubu', 'win11', 'mint']);
  assert.deepEqual(visibles(list, menuPxeCfg({ caches: ['ubu'] })).map((x) => x.id), ['win11', 'clone', 'mint']);
  assert.deepEqual(visibles(list, menuPxeCfg({ caches: ['ubu'] }), ['ubu']).map((x) => x.id), ['win11', 'ubu', 'clone', 'mint'], 'le système d\'un PC autorisé reste à son menu');
  assert.deepEqual(idsPropres(['ok-1', 'ok-1', 'PAS OK', '${x}', 3, 'b']), ['ok-1', 'b']);
  assert.equal(famillesGroupees(['a', 'a', 'b'], (x) => x), true); assert.equal(famillesGroupees(['a', 'b', 'a'], (x) => x), false);

  const entries = [{ id: 'clone', name: 'Clonezilla', recipe: CLONE }, { id: 'ubu', name: 'Ubuntu', recipe: UBUNTU }, { id: 'win11', name: 'Win11', recipe: INCONNUE }];
  const m = menu({ base: 'http://o:1', mac: '52:54:00:00:00:02', entries, def: 'local', timeout: 10, family: fam, libre: true });
  const ids = items(m).map((l) => /^item (\S+)/.exec(l)![1]).filter((x) => x !== '--gap');
  assert.deepEqual(ids, ['e-clone', 'e-ubu', 'e-win11', 'local', 'shell'], 'l\'ordre choisi, puis le disque du PC, en dernier');
  assert.match(m, /--- OUTILS -+\nitem e-clone [^\n]+\nitem --gap -- --- LINUX/, 'chaque famille d\'un seul tenant : les intertitres restent');
  const melange = menu({ base: 'http://o:1', mac: '52:54:00:00:00:02', entries: [entries[1], entries[0], { id: 'mint', name: 'Mint', recipe: LIVE }], def: 'local', timeout: 10, family: fam, libre: true });
  assert.doesNotMatch(melange, /item --gap -- ---/, 'familles mélangées : pas d\'intertitre répété');
  assert.deepEqual(items(melange).map((l) => /^item (\S+)/.exec(l)![1]).filter((x) => x.startsWith('e-')), ['e-ubu', 'e-clone', 'e-mint']);
  const groupe = menu({ base: 'http://o:1', mac: '52:54:00:00:00:02', entries: [entries[1], entries[0]], def: 'local', timeout: 10, family: fam, libre: true });
  assert.match(groupe, /item --gap -- --- LINUX -+\nitem e-ubu [^\n]+\nitem --gap -- --- OUTILS/, 'familles d\'un seul tenant : les intertitres restent');
  // L'aperçu de la page relit le vrai script.
  const a = lireMenu(m);
  assert.equal(a.defaut, 'local'); assert.equal(a.delai, 10);
  assert.deepEqual(a.lignes.filter((l) => !l.gap).map((l) => l.id), ['clone', 'ubu', 'win11', 'local', 'shell']);
  assert.match(a.titre, /ODIN/);
});

test('menu PXE : une entrée qui installe ou peut effacer n\'est jamais le défaut d\'un PC non autorisé', () => {
  assert.equal(installe(UBUNTU), true); assert.equal(installe(INCONNUE), true, 'une ISO inconnue : on ne sait pas ce qu\'elle fait');
  assert.equal(installe(undefined), true); assert.equal(installe(LIVE), false); assert.equal(installe(CLONE), false);
  const list = [{ id: 'ubu', name: 'Ubuntu', recipe: UBUNTU }, { id: 'mint', name: 'Mint', recipe: LIVE }, { id: 'x', name: 'X', recipe: INCONNUE }];
  assert.deepEqual(defautSur('mint', list), { def: 'mint' });
  assert.equal(defautSur('ubu', list).def, 'local'); assert.match(defautSur('ubu', list).refus!, /installe/);
  assert.equal(defautSur('x', list).def, 'local'); assert.equal(defautSur('parti', list).def, 'local');
  assert.equal(defautSur('ecran', list).def, 'ecran'); assert.equal(defautSur('disque', list).def, 'local');
  // Une entrée par défaut absente du menu (cachée) : le disque.
  const m = menu({ base: 'http://o:1', mac: '52:54:00:00:00:03', entries: [list[1]], def: 'ubu', timeout: 10 });
  assert.match(m, /choose --default local --timeout 10000 /);
});

// ------------------------------------------------------------------ de bout en bout, avec Odin
const FIX = join(import.meta.dirname, 'fixtures', 'thjalfi');
async function odin() {
  const home = mkdtempSync(join(tmpdir(), 'odin-s9-')); dossiers.push(home);
  const iso = join(home, 'iso'); mkdirSync(iso, { recursive: true });
  for (const f of readdirSync(FIX)) writeFileSync(join(iso, f.replace(/\.gz$/, '')), gunzipSync(readFileSync(join(FIX, f))));
  const saved = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'ab'.repeat(32);
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('aucun réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date() } as never);
  await v.act('eitri', 'dossier', { chemin: iso });
  v.ctx('thjalfi').saveSettings({ ports: { http: 0, tftp: 0, dhcp: 0, pxe: 0, client: 0 }, ip: '127.0.0.1', mode: 'aucun' });
  const mod = v.modules().find((m) => m.id === 'thjalfi')! as unknown as { serveurSimule: (c: unknown) => { simuler: (m: string, u: string, f: string) => Promise<{ status: number; body: string }> } };
  const get = async (u: string) => (await mod.serveurSimule(v.ctx('thjalfi')).simuler('GET', u, '192.168.1.50')).body;
  const fin = () => { v.stop(); if (saved === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = saved; };
  return { v, get, fin, reglages: () => v.ctx('thjalfi').settings };
}
const UB = 'ubuntu-24-04-3-live-server-amd64', MEM = 'memtest86plus-7-20', DEB = 'debian-13-1-0-amd64-netinst';

test('menu PXE (Odin) : lire, ranger, cacher, délai ; le défaut refusé s\'il installe ; propriétaire seul', async () => {
  const o = await odin();
  try {
    const r0 = await o.v.act('thjalfi', 'menu_pxe');
    assert.notEqual(r0.ok, false, r0.text);
    const d0 = r0.data as { entrees: Array<{ id: string; installe: boolean; cache: boolean }>; defaut: string; delai: number; apercu: { lignes: Array<{ id: string; gap?: boolean }>; defaut: string } };
    assert.ok(d0.entrees.length >= 4, 'les ISO prêtes de la bibliothèque');
    assert.equal(d0.defaut, 'disque'); assert.equal(d0.apercu.defaut, 'local');
    assert.ok(d0.entrees.find((e) => e.id === UB)?.installe, 'Ubuntu Server installe');
    assert.equal(d0.apercu.lignes.filter((l) => !l.gap).at(-2)?.id, 'local', 'aperçu : le disque du PC en dernier (avant la ligne de commande)');

    // Membre, automatisation, Odin seul : refusé (propriétaire seul), même la lecture (adresses, systèmes).
    for (const qui of [{ qui: 'member' as const }, { auto: true }, { by: 'odin' as const }]) {
      for (const [id, input] of [['menu_pxe', {}], ['menu_pxe_regler', { defaut: 'disque' }]] as const) {
        const r = await o.v.act('thjalfi', id, input, qui); assert.equal(r.ok, false, `${id} refusé (${JSON.stringify(qui)})`); assert.match(r.text, /propriétaire/);
      }
    }

    // Une entrée qui installe ne peut pas être celle par défaut : refusé, rien n'a changé.
    const avant = JSON.stringify(o.reglages());
    for (const id of [UB, MEM, DEB]) {
      const r = await o.v.act('thjalfi', 'menu_pxe_regler', { defaut: id });
      assert.equal(r.ok, false, id); assert.match(r.text, /Refusé/); assert.match(r.text, /Rien n'a changé/);
    }
    const iso = await o.v.act('thjalfi', 'iso_par_defaut', { iso: 'ubuntu' }); assert.equal(iso.ok, false, 'ni par l\'ancienne action'); assert.match(iso.text, /Refusé/);
    assert.equal(JSON.stringify(o.reglages()), avant);

    // Ranger et cacher ; délai ; disposition.
    const ordre = [MEM, DEB, UB];
    const r1 = await o.v.act('thjalfi', 'menu_pxe_regler', { ordre: JSON.stringify(ordre), caches: JSON.stringify([DEB, '${x}', 'inconnu-1']), delai: 30, disposition: 'liste' });
    assert.notEqual(r1.ok, false, r1.text);
    assert.deepEqual((o.reglages().menuPxe as { caches: string[] }).caches, [DEB], 'seulement des systèmes connus');
    assert.equal(o.reglages().delai, 30); assert.equal((o.reglages().ecran as { disposition: string }).disposition, 'liste');
    const menuInconnu = await o.get('/menu.ipxe?mac=52:54:00:99:00:01&fw=efi');
    const ids = items(menuInconnu).map((l) => /^item (\S+)/.exec(l)![1]).filter((x) => x.startsWith('e-'));
    assert.deepEqual(ids.slice(0, 2), [`e-${MEM}`, `e-${UB}`], 'l\'ordre choisi');
    assert.ok(!ids.includes(`e-${DEB}`), 'Debian caché du menu'); assert.doesNotMatch(menuInconnu, new RegExp(`:e-${DEB}`));
    assert.match(menuInconnu, /choose --default local --timeout 30000 /, 'PC inconnu : le disque, après le délai choisi');
    // Le même ordre sur l'écran graphique, sans le système caché, et un choix d'un système caché refusé.
    const etat = JSON.parse(await o.get('/ecran/etat?mac=52:54:00:99:00:01')) as { systemes: Array<{ id: string }>; ordre: string[]; defaut: string; delai: number };
    assert.deepEqual(etat.systemes.map((x) => x.id).slice(0, 2), [MEM, UB]); assert.ok(!etat.systemes.some((x) => x.id === DEB));
    assert.equal(etat.defaut, 'disque'); assert.equal(etat.delai, 30);
    const non = JSON.parse(await o.get(`/ecran/choisir?mac=52:54:00:99:00:01&iso=${DEB}&mode=installer`)) as { ok: boolean };
    assert.equal(non.ok, false, 'un système caché ne se choisit pas sur l\'écran');

    // Un brouillon donne son aperçu sans rien enregistrer.
    const br = await o.v.act('thjalfi', 'menu_pxe', { ordre: JSON.stringify([UB, MEM]), caches: '[]', delai: 0 });
    const ab = (br.data as { apercu: { lignes: Array<{ id: string; gap?: boolean }>; delai: number } }).apercu;
    assert.deepEqual(ab.lignes.filter((l) => !l.gap && !['', 'ecran'].includes(l.id)).map((l) => l.id).slice(0, 2), [UB, MEM]); assert.equal(ab.delai, 0);
    assert.equal(o.reglages().delai, 30, 'rien enregistré');

    // L'écran d'Odin par défaut, puis le disque.
    assert.notEqual((await o.v.act('thjalfi', 'menu_pxe_regler', { defaut: 'ecran' })).ok, false);
    assert.match(await o.get('/menu.ipxe?mac=52:54:00:99:00:02&fw=efi'), /choose --default ecran /);
    assert.notEqual((await o.v.act('thjalfi', 'menu_pxe_regler', { defaut: 'disque' })).ok, false);
    assert.match(await o.get('/menu.ipxe?mac=52:54:00:99:00:03&fw=efi'), /choose --default local /);
  } finally { o.fin(); }
});

test('menu PXE (Odin) : un ancien réglage qui installait par défaut ne démarre plus seul ; un PC autorisé garde son système', async () => {
  const o = await odin();
  try {
    // Un réglage d'avant le lot S9 (Ubuntu par défaut pour tous) : le PC inconnu a son disque par défaut.
    o.v.ctx('thjalfi').saveSettings({ defaut: UB, delai: 10, menuPxe: { ordre: [], caches: [UB] } });
    const m = await o.get('/menu.ipxe?mac=52:54:00:99:00:10&fw=efi');
    assert.match(m, /choose --default local --timeout 10000 /, 'jamais une installation au bout du délai');
    assert.doesNotMatch(m, new RegExp(`item e-${UB}`), 'caché pour ce PC');
    // Un PC autorisé pour Ubuntu (lot S6, « le proposer au menu ») : son système reste à SON menu, même caché pour les autres.
    const r = await o.v.act('thjalfi', 'autoriser', { mac: '52:54:00:99:00:11', iso: 'ubuntu', nom: 'Bureau 2' });
    assert.notEqual(r.ok, false, r.text);
    const m2 = await o.get('/menu.ipxe?mac=52:54:00:99:00:11&fw=efi');
    assert.match(m2, new RegExp(`item e-${UB} `)); assert.match(m2, new RegExp(`choose --default e-${UB} `));
    assert.doesNotMatch(m2, /autoinstall/, 'sans « effacer et installer », rien ne s\'installe tout seul');
    // La page dit pourquoi le défaut enregistré n'est pas suivi.
    const d = (await o.v.act('thjalfi', 'menu_pxe')).data as { defaut: string; defautRefuse?: string };
    assert.equal(d.defaut, 'disque'); assert.ok(d.defautRefuse);
  } finally { o.fin(); }
});

// ------------------------------------------------------------------ relecture du lot S9 (en adversaire)
test('relecture S9 : textes piégés (Unicode qui se replie, 10 000 caractères, vide) ; le script garde ses seules étiquettes', () => {
  // Pleine chasse, barres et dièse « ressemblants », tirets longs, zéro largeur, retour Unicode : rien ne revient en ASCII dangereux.
  for (const piege of ['＄｛ｂａｓｅ｝', 'ǀǀ reboot', '＃x', '‐‐gap', 'a\u2028shell', 'a\u0085b', 'x\u200b${y}', '\u202eevil', '"; chain http://x', '']) {
    const t = texteIpxe(piege);
    assert.match(t, /^[A-Za-z0-9 ._()+-]*$/, JSON.stringify(piege)); assert.doesNotMatch(t, /^-/);
  }
  const long = 'Å'.repeat(10_000);
  const m = menu({ base: 'http://o:1', mac: '52:54:00:00:00:09', entries: [{ id: 'a', name: long, recipe: LIVE }, { id: 'b', name: '', recipe: LIVE }, { id: 'c', name: '\n\n', recipe: LIVE }], def: 'a', timeout: 5 });
  for (const l of m.split('\n')) assert.ok(l.length < 400, `ligne courte : ${l.length}`);
  assert.match(m, /^item e-b b - /m, 'un nom vide : l\'identifiant le remplace');
  assert.match(m, /^item e-c c - /m);
  const etiquettes = m.split('\n').filter((l) => /^:/.test(l));
  assert.deepEqual(etiquettes, [':local', ':shell', ':e-a', ':e-b', ':e-c', ':echec'], 'aucune étiquette ajoutée');
  // Un délai piégé dans menu() : jamais négatif ni NaN dans « choose ».
  for (const timeout of [-5, Number.NaN, 1e12]) {
    const c = /choose --default (\S+) --timeout (\S+) /.exec(menu({ base: 'http://o:1', mac: '', entries: [], def: 'local', timeout }))!;
    assert.match(c[2], /^\d+$/, `délai ${timeout} → ${c[2]}`);
  }
});

test('relecture S9 (Odin) : valeurs piégées à menu_pxe_regler ; le défaut ne devient jamais une installation ; délai borné', async () => {
  const o = await odin();
  try {
    o.v.ctx('thjalfi').saveSettings({ ecran: { actif: false } });
    for (const defaut of ['${x}', '../ubuntu', 'ecran', 'x'.repeat(10_000), UB.toUpperCase(), ` ${UB} `, 'win11-24h2-french-x64', '[]', 'disque\nshell']) {
      const avant = JSON.stringify(o.reglages());
      const r = await o.v.act('thjalfi', 'menu_pxe_regler', { defaut });
      if (r.ok === false) assert.equal(JSON.stringify(o.reglages()), avant, `refusé, rien n'a changé (${defaut.slice(0, 20)})`);
      const m = await o.get('/menu.ipxe?mac=52:54:00:77:00:01&fw=efi');
      assert.match(m, /choose --default (local|ecran) /, `PC inconnu : le disque ou l'écran (${defaut.slice(0, 20)})`);
    }
    for (const [delai, attendu] of [[-5, 0], ['abc', 0], [1e309, 300], ['9999', 300], [7.6, 8]] as const) {
      assert.notEqual((await o.v.act('thjalfi', 'menu_pxe_regler', { delai })).ok, false);
      assert.equal(o.reglages().delai, attendu, `délai ${delai}`);
      const c = /choose --default \S+ --timeout (\d+) /.exec(await o.get('/menu.ipxe?mac=52:54:00:77:00:02&fw=efi'))!;
      assert.equal(Number(c[1]), attendu * 1000);
    }
    // Un réglage écrit à la main (fichier abîmé, ancienne version) : ni l'ordre ni les cachés ne cassent le menu.
    o.v.ctx('thjalfi').saveSettings({ defaut: UB, menuPxe: { ordre: 'pas-une-liste', caches: [{ x: 1 }, '${x}', UB, UB] } });
    const m = await o.get('/menu.ipxe?mac=52:54:00:77:00:03&fw=efi');
    assert.match(m, /choose --default local /); assert.doesNotMatch(m, new RegExp(`item e-${UB} `));
    const etat = JSON.parse(await o.get('/ecran/etat?mac=52:54:00:77:00:03')) as { defaut: string; systemes: Array<{ id: string }> };
    assert.equal(etat.defaut, 'disque', 'l\'écran graphique ne démarre pas seul une installation'); assert.ok(!etat.systemes.some((x) => x.id === UB));
  } finally { o.fin(); }
});

test('relecture S9 (Odin) : un PC autorisé (installation automatique) garde la sienne ; aucun AUTRE PC ne la reçoit, ni l\'aperçu', async () => {
  const o = await odin();
  try {
    const A = '52:54:00:66:00:0a', B = '52:54:00:66:00:0b';
    assert.notEqual((await o.v.act('thjalfi', 'autoriser', { mac: A, iso: 'ubuntu', auto: true })).ok, false);
    // Le propriétaire cache Ubuntu du menu de tous.
    assert.notEqual((await o.v.act('thjalfi', 'menu_pxe_regler', { caches: JSON.stringify([UB]) })).ok, false);
    const ma = await o.get(`/menu.ipxe?mac=${A}&fw=efi`);
    assert.match(ma, /autoinstall/, 'le PC autorisé garde son installation automatique (lot S6)');
    for (const autre of [B, B.toUpperCase(), B.replace(/:/g, '-')]) {
      const mb = await o.get(`/menu.ipxe?mac=${encodeURIComponent(autre)}&fw=efi`);
      assert.doesNotMatch(mb, /autoinstall|seed\//, `aucun autre PC ne la reçoit (${autre})`);
      assert.doesNotMatch(mb, new RegExp(`item e-${UB} `), 'caché pour les autres');
      assert.match(mb, /choose --default local /);
    }
    const ap = (await o.v.act('thjalfi', 'menu_pxe')).data as { apercu: { lignes: Array<{ id: string; texte: string }>; defaut: string } };
    assert.ok(!ap.apercu.lignes.some((l) => l.id === UB), 'l\'aperçu (PC inconnu) ne montre pas le système caché');
    assert.equal(ap.apercu.defaut, 'local');
  } finally { o.fin(); }
});

test('relecture S9 (Odin) : l\'aperçu est le menu servi à un PC inconnu, ligne pour ligne (ordre, cachés, défaut, délai, écran)', async () => {
  const o = await odin();
  try {
    const cas: Array<Record<string, unknown>> = [{}, { ordre: JSON.stringify([MEM, DEB]), caches: JSON.stringify([UB]), delai: 30 }, { defaut: 'ecran', delai: 0 }, { caches: '[]', defaut: 'disque', delai: 5 }];
    for (const c of cas) {
      if (Object.keys(c).length) assert.notEqual((await o.v.act('thjalfi', 'menu_pxe_regler', c)).ok, false);
      const vu = lireMenu(await o.get(`/menu.ipxe?mac=52:54:00:55:00:01&fw=efi`));
      const ap = ((await o.v.act('thjalfi', 'menu_pxe')).data as { apercu: ReturnType<typeof lireMenu> }).apercu;
      assert.deepEqual(ap.lignes, vu.lignes, `mêmes lignes (${JSON.stringify(c)})`);
      assert.equal(ap.defaut, vu.defaut); assert.equal(ap.delai, vu.delai);
      assert.equal(vu.titre.replace(/\s*\([^)]*\)\s*$/, ''), ap.titre);
    }
  } finally { o.fin(); }
});
