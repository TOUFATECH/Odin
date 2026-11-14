// Tirésias (durinn) : la santé et la vitesse des disques.
// - Les sorties de smartctl : des exemples écrits pour l'essai d'après le format JSON documenté de smartmontools
//   (page de manuel smartctl(8), option --json, et notes de version 7.x), dans test/fixtures/durinn : disque dur sain,
//   disque dur avec secteurs réalloués, SSD SATA usé, NVMe, clé USB derrière un pont inconnu (sans SMART), disque en
//   échec, disque endormi. Un faux « smartctl » (petit script) les rend comme le vrai, mis en tête du PATH.
// - smartctl réel : lancé pour de vrai s'il est installé (dans une machine virtuelle, il n'y a rien à lire : c'est vérifié).
// - Le test de vitesse : lancé pour de vrai dans un dossier temporaire (petite taille), fichier bien effacé ensuite.
// - Un autre poste : par un vrai serveur SSH local (sauté sans sshd ou sans droits d'administrateur).
// - L'historique et les alertes : avec l'horloge d'Odin avancée (ctx.now()).
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { saveMachine } from '../src/machines/access.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { understand } from '../src/valhalla/huginn.ts';
import { durinn, oublierMemoire, trouver } from '../src/valhalla/modules/durinn.ts';
import { avertissements, cleDisque, juger, lireScan, lireSmart, versionDe } from '../src/valhalla/durinn/smart.ts';
import { aChange, alertesDe, courbe, noter, tendanceDe } from '../src/valhalla/durinn/suivi.ts';
import { comparer, controler, lireDd, volumeDe, volumes, type Resultat } from '../src/valhalla/durinn/vitesse.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import type { Module, Section } from '../src/valhalla/types.ts';

const FIX = join(import.meta.dirname, 'fixtures', 'durinn');
const fx = (n: string) => readFileSync(join(FIX, `${n}.json`), 'utf8');
const VARIANTES = JSON.parse(fx('variantes')) as Record<string, unknown>;
const root = process.getuid?.() === 0;
const a = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd} || ls /usr/sbin/${cmd}`], { encoding: 'utf8' }).status === 0;
const VRAI_SMARTCTL = ['/usr/sbin/smartctl', '/usr/local/sbin/smartctl', '/sbin/smartctl'].find((f) => existsSync(f));

/** Le faux smartctl : rend les exemples du dossier `d` (« sda.json », « sdc.sat.json » avec -d sat, « dort.json » si « sda.dort » existe et -n standby). */
function fauxSmartctl(d: string): string {
  mkdirSync(join(d, 'bin'), { recursive: true });
  for (const f of readdirSync(FIX)) if (f !== 'variantes.json') copyFileSync(join(FIX, f), join(d, f));
  const s = join(d, 'bin', 'smartctl');
  writeFileSync(s, `#!/bin/sh
D='${d}'
echo "$*" >> "$D/appels.log"
t=""; dev=""; scan=""; veille=""
while [ $# -gt 0 ]; do
  case "$1" in
    --scan) scan=1 ;;
    --version) echo "smartctl 7.4 2023-08-01 r5530 [x86_64-linux] (local build)"; exit 0 ;;
    -d) shift; t="$1" ;;
    -n) shift; veille="$1" ;;
    -*) ;;
    *) dev="$1" ;;
  esac
  shift
done
if [ -n "$scan" ]; then cat "$D/scan.json"; exit 0; fi
n=$(basename "$dev")
if [ -n "$veille" ] && [ -f "$D/$n.dort" ]; then cat "$D/dort.json"; exit 2; fi
if [ -n "$t" ] && [ -f "$D/$n.$t.json" ]; then cat "$D/$n.$t.json"; exit 0; fi
if [ ! -f "$D/$n.json" ]; then echo '{"json_format_version":[1,0],"smartctl":{"version":[7,4],"messages":[{"string":"'"$dev"': No such device","severity":"error"}],"exit_status":2}}'; exit 2; fi
cat "$D/$n.json"
`);
  chmodSync(s, 0o755);
  return join(d, 'bin');
}
/** Remplace la réponse d'un disque (pour faire évoluer sa santé d'un jour à l'autre). */
const poser = (d: string, disque: string, variante: string) => writeFileSync(join(d, `${disque}.json`), JSON.stringify(VARIANTES[variante]));
const sansDisque = (d: string, disque: string) => {
  const s = JSON.parse(readFileSync(join(d, 'scan.json'), 'utf8')) as { devices: Array<{ name: string }> };
  s.devices = s.devices.filter((x) => x.name !== `/dev/${disque}`); writeFileSync(join(d, 'scan.json'), JSON.stringify(s));
};

/** Un faux module « hel » (récupération), pour vérifier le bouton quand l'appli est là. */
const HEL: Module = { id: 'hel', name: 'Perséphone', family: 'Données', what: 'récupération (essai)', does: [], from: [], upstream: [], words: [], actions: [{ id: 'ouvrir', label: 'Ouvrir un disque', what: 'essai', read: true, params: [{ key: 'disque', label: 'Disque', kind: 'text' }], run: (_c, i) => ({ text: `ouvert ${String(i.disque)}` }) }], view: () => ({ sections: [] }) };

interface Monde { v: Valhalla; home: string; faux: string; envoyes: string[]; avance: (h: number) => void; fin: () => void }
function monde(o: { faux?: boolean; hel?: boolean; run?: ConstructorParameters<typeof Valhalla>[2]['run'] } = {}): Monde {
  oublierMemoire();
  const home = mkdtempSync(join(tmpdir(), 'durinn-')), faux = join(home, 'faux-smart'), envoyes: string[] = [];
  let clock = new Date('2026-11-13T09:00:00');
  const path = process.env.PATH;
  if (o.faux !== false) process.env.PATH = `${fauxSmartctl(faux)}:${path}`;
  const mods = allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never);
  const v = new Valhalla(home, o.hel ? [...mods, HEL] : mods, { notify: async (t: string) => { envoyes.push(t); }, autonomy: () => 'equilibre', now: () => clock, ...(o.run ? { run: o.run } : {}) } as never);
  return { v, home, faux, envoyes, avance: (h) => { clock = new Date(clock.getTime() + h * 3600_000); }, fin: () => { oublierMemoire(); v.stop(); process.env.PATH = path; rmSync(home, { recursive: true, force: true }); } };
}
const alertes = (w: Monde) => w.v.alerts({ module: 'durinn' });
/** Les nombres français s'écrivent avec une espace fine insécable (« 21 204 ») : ramenée à une espace simple pour les essais. */
const ns = (t: string) => t.replace(/[\u202f\u00a0]/g, ' ');
const act = async (w: Monde, action: string, input: Record<string, unknown> = {}) => { const r = await w.v.act('durinn', action, input); return { ...r, text: ns(r.text) }; };
const reels = (n: string) => !/^vd/.test(n);
const vue = (w: Monde, q: Record<string, string> = {}) => w.v.module('durinn')!.view(w.v.ctx('durinn'), new URLSearchParams(q));
const section = (s: Section[], titre: RegExp) => s.find((x) => 'title' in x && titre.test(String(x.title ?? '')));

// ---------------------------------------------------------------- pur
test('Tirésias · lire smartctl : verdict en clair pour chaque genre de disque (exemples au format smartmontools)', () => {
  const sda = lireSmart(fx('sda'), { chemin: '/dev/sda' });
  assert.equal(sda.genre, 'disque dur'); assert.equal(sda.etat, 'bon'); assert.equal(sda.modele, 'WDC WD40EFRX-68N32N0'); assert.equal(sda.tours, 5400);
  assert.deepEqual([sda.temperature, sda.heures, sda.allumages, sda.realloues, sda.attente, sda.illisibles], [34, 21204, 312, 0, 0, 0]);
  assert.ok(sda.valeurs.length >= 15 && sda.valeurs.every((x) => x.explication.length > 20), 'chaque valeur SMART est expliquée');
  assert.match(sda.valeurs.find((x) => x.id === '5')!.explication, /Zéro est la valeur normale\. Ici : zéro, parfait\./);
  assert.equal(ns(sda.valeurs.find((x) => x.id === '9')!.valeur), '21 204 h (2 ans 5 mois)');

  const sdb = lireSmart(fx('sdb'));
  assert.equal(sdb.etat, 'attention');
  assert.deepEqual(sdb.raisons.map((r) => r.cle), ['realloues', 'attente']);
  assert.match(ns(sdb.raisons[0].texte), /^48 secteurs réalloués : /);

  const ssd = lireSmart(fx('sde'));
  assert.equal(ssd.genre, 'SSD'); assert.equal(ssd.usure, 88); assert.equal(ssd.etat, 'attention');
  assert.match(ssd.raisons[0].texte, /Usure à 88 %/); assert.equal(Math.round(ssd.ecrit! / 1e12), 264, 'quantité écrite : 264 To');

  const nvme = lireSmart(fx('nvme0'));
  assert.equal(nvme.genre, 'NVMe'); assert.equal(nvme.etat, 'bon'); assert.deepEqual([nvme.usure, nvme.reserve, nvme.critique, nvme.temperature], [3, 100, 0, 41]);
  assert.equal(nvme.valeurs.find((x) => x.id === 'critical_warning')!.valeur, 'aucun');

  const mort = lireSmart(fx('sdd'));
  assert.equal(mort.etat, 'mauvais'); assert.equal(mort.passe, false);
  assert.deepEqual(mort.raisons.filter((r) => r.niveau === 'mauvais').map((r) => r.cle), ['smart', 'autotest', 'realloues', 'attente', 'illisibles']);
  assert.match(mort.raisons[1].texte, /\(échec de lecture\)/, 'la raison est traduite');
  assert.equal(mort.valeurs.find((x) => x.id === '5')!.etat, 'mauvais', 'sous le seuil du fabricant');

  const usb = lireSmart(fx('sdc'), { chemin: '/dev/sdc' });
  assert.equal(usb.smart, 'non'); assert.equal(usb.etat, 'inconnu');
  assert.match(usb.messages[0], /^boîtier USB que smartctl ne connaît pas \(0x0781:0x5567\)/);

  const dort = lireSmart(fx('dort'), { veille: true });
  assert.equal(dort.enVeille, true, 'un disque qui dort n\'est pas réveillé');
  assert.equal(lireSmart('pas du json').smart, 'non', 'sortie illisible : pas d\'erreur levée');

  // NVMe : une surchauffe seule n'est pas une panne ; lecture seule et fiabilité perdue, si.
  const chaud = lireSmart(JSON.stringify(VARIANTES.nvme_chaud_use));
  assert.equal(chaud.etat, 'attention'); assert.ok(!chaud.raisons.some((r) => r.cle === 'smart'));
  const crit = lireSmart(JSON.stringify(VARIANTES.nvme_critique));
  assert.equal(crit.etat, 'mauvais'); assert.match(crit.raisons.map((r) => r.texte).join(' '), /lecture seule/);
  assert.deepEqual(avertissements(12), ['le disque n\'est plus fiable (trop d\'erreurs)', 'le disque s\'est mis en lecture seule : il n\'accepte plus d\'écriture']);

  // Ce qui monte compte : la même valeur, en hausse sur 30 jours, fait passer de Attention à Mauvais.
  assert.equal(juger(sdb, { depuis: '1er novembre', realloues: 12 }).etat, 'mauvais');
  assert.equal(juger(sda, { depuis: '1er novembre', crc: 3 }).etat, 'attention', 'erreurs de câble : attention seulement');

  assert.deepEqual(lireScan(fx('scan')).map((d) => d.chemin), ['/dev/sda', '/dev/sdb', '/dev/sdc', '/dev/sdd', '/dev/sde', '/dev/nvme0']);
  assert.equal(versionDe(fx('scan')), '7.4'); assert.equal(versionDe('smartctl 6.6'), undefined);
  const tous = [sda, sdb, nvme].map((d, k) => ({ ...d, nom: ['sda', 'sdb', 'nvme0'][k] }));
  assert.equal(trouver(tous, '/dev/sda1')?.nom, 'sda'); assert.equal(trouver(tous, 'nvme0n1p2')?.nom, 'nvme0'); assert.equal(trouver(tous, 'barracuda')?.nom, undefined);
  assert.equal(trouver(tous, 'ST2000')?.nom, 'sdb'); assert.equal(cleDisque(sda), 'WDC-WD40EFRX-68N32N0_WD-WCC7K0XXXXXA');
});

test('Tirésias · historique : un relevé par jour, un de plus à chaque changement ; alertes quand ça se dégrade (pur)', () => {
  const j1 = new Date('2026-11-01T10:00:00'), sdb = lireSmart(fx('sdb')); sdb.nom = 'sdb';
  let n = noter(undefined, sdb, j1);
  assert.equal(n.suivi.releves.length, 1);
  n = noter(n.suivi, { ...sdb, temperature: 45 }, new Date('2026-11-01T15:00:00'));
  assert.equal(n.suivi.releves.length, 1, 'même jour, rien d\'important n\'a changé : le relevé du jour est mis à jour');
  assert.equal(n.suivi.releves[0].tmax, 45, 'la température la plus haute du jour est gardée');
  const plus = lireSmart(JSON.stringify(VARIANTES.sdb_plus)); plus.nom = 'sdb';
  n = noter(n.suivi, plus, new Date('2026-11-01T18:00:00'));
  assert.equal(n.suivi.releves.length, 2, 'un secteur de plus le même jour : un relevé de plus'); assert.equal(n.suivi.releves[1].ch, true);
  assert.ok(aChange(n.suivi.releves[0], n.suivi.releves[1]));
  const t = tendanceDe(n.suivi.releves.slice(0, 1), { r: 60, p: 2 }, new Date('2026-11-20T10:00:00'));
  assert.deepEqual(t, { depuis: '1er novembre', realloues: 12 });
  const a = alertesDe(plus, n.avant, n.suivi, new Date('2026-11-01T18:00:00'), { etapes: ['Sauvegarde d\'abord.'] });
  assert.deepEqual(a.alertes.map((x) => [x.level, x.title]), [['haute', 'Disque sdb (ST2000DM001-1ER164 2 To) : 12 secteurs réalloués de plus']]);
  assert.match(a.alertes[0].detail!, /Il en compte 60 \(48 le 1er novembre\)/); assert.deepEqual(a.alertes[0].steps, ['Sauvegarde d\'abord.']);
  const c = courbe([n.suivi], 'r'); assert.deepEqual(c, { labels: ['01/11'], series: [{ name: 'sdb · ST2000DM001-1ER164', points: [60] }] });
});

test('Tirésias · vitesse : où tester, place, comparaison, réponse de dd (pur)', () => {
  const mounts = '/dev/sda2 / ext4 rw,relatime 0 0\nproc /proc proc rw 0 0\n/dev/sdb1 /mnt/donn\\040ees ext4 rw 0 0\n/dev/sdc1 /media/cd iso9660 ro 0 0\ntmpfs /tmp tmpfs rw 0 0\n/dev/loop0 /snap/x squashfs ro 0 0\n';
  assert.deepEqual(volumes(mounts).map((v) => v.point), ['/', '/mnt/donn ees']);
  assert.equal(volumeDe('/mnt/donn ees/photos', mounts)?.source, '/dev/sdb1');
  assert.throws(() => controler('relatif', 1), /chemin complet/); assert.throws(() => controler('/dev', 1), /jamais sur un disque brut/);
  assert.throws(() => controler(tmpdir(), 1e15), /pas assez de place : il reste .* il en faut/);
  const r = (l: number, e: number, quand: string): Resultat => ({ id: quand, quand, poste: '', nomPoste: 'cette machine', dossier: '/', octets: 1, dureeS: 1, direct: true, reserves: [], mesures: { seq1m_q8: { lecture: { moS: l, acces: 1, latMs: 1 }, ecriture: { moS: e, acces: 1, latMs: 1 } } } });
  assert.match(comparer(r(300, 100, '2026-11-13T10:00:00Z'), r(500, 200, '2026-11-01T10:00:00Z'))!, /lecture séquentielle −40 %, écriture séquentielle −50 %\. Une baisse aussi nette/);
  // GNU dd, puis BSD / macOS.
  const gnu = lireDd('---DOSSIER /home/x\n---FS ext2/ext3\n---LIBRE 1000\n---ECRITURE direct\n32+0 records in\n32+0 records out\n33554432 bytes (34 MB, 32 MiB) copied, 0.25 s, 134 MB/s\n---LECTURE direct\n33554432 bytes (34 MB, 32 MiB) copied, 0.1 s, 336 MB/s\n---FIN\n');
  assert.deepEqual([Math.round(gnu.ecriture!.moS), gnu.ecriture!.mode, Math.round(gnu.lecture!.moS), gnu.fini, gnu.libre], [134, 'direct', 336, true, 1024000]);
  const bsd = lireDd('---ECRITURE cache\n33554432 bytes transferred in 0.500000 secs (67108864 bytes/sec)\n---LECTURE cache\n33554432 bytes transferred in 0.1 secs (335544320 bytes/sec)\n---FIN');
  assert.deepEqual([Math.round(bsd.ecriture!.moS), bsd.ecriture!.mode, bsd.lecture!.mode], [67, 'cache', 'cache']);
});

// ---------------------------------------------------------------- de bout en bout, faux smartctl
test('Tirésias · de bout en bout (faux smartctl dans le PATH) : état de chaque disque, alertes, historique, page à onglets', { timeout: 120_000 }, async () => {
  const w = monde();
  try {
    const r = await act(w, 'sante');
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /^Santé des disques · cette machine\n/);
    for (const re of [/🟢 sda · WDC WD40EFRX-68N32N0 4 To \(disque dur 5 400 tr\/min\) : Bon · 34 °C/, /🟠 sdb · ST2000DM001-1ER164 2 To .* : Attention/, /🔴 sdd · .* : Mauvais/, /🟠 sde · Samsung SSD 860 EVO 500GB .* usure 88 %/, /🟢 nvme0 · Samsung SSD 970 EVO Plus 1TB 1 To \(NVMe\) : Bon/, /⚪ sdc · SanDisk Cruzer Blade .*boîtier USB que smartctl ne connaît pas/]) assert.match(r.text, re);
    assert.match(r.text, /Un disque peut quand même tomber en panne d'un coup : garde toujours une sauvegarde\./, 'jamais de promesse à 100 %');
    const appels = readFileSync(join(w.faux, 'appels.log'), 'utf8');
    assert.match(appels, /-d sat \/dev\/sdc/); assert.match(appels, /-d scsi \/dev\/sdc/, 'pont USB inconnu : SAT essayé, puis SCSI pour au moins son identité');

    // Premières alertes : le disque en échec (critique, avec quoi faire), les disques à surveiller.
    const al = alertes(w);
    const sdd = al.find((x) => /^Disque sdd .* : état Mauvais$/.test(x.title));
    assert.ok(sdd, al.map((x) => x.title).join(' | ')); assert.equal(sdd!.level, 'critique');
    assert.match(sdd!.steps![0], /^Sauvegarde tout de suite ce qui compte sur ce disque, vers un AUTRE disque/); assert.match(sdd!.steps![1], /remplacement/);
    assert.ok(al.some((x) => /^Disque sdb .* : à surveiller$/.test(x.title)));
    assert.ok(al.some((x) => /^Disque sde .* : usure à 88 %$/.test(x.title) && x.level === 'moyenne'));
    assert.ok(!al.some((x) => /sda|nvme0/.test(x.title)), 'pas d\'alerte pour les disques sains');
    // Atlas : la fiche des disques fixes, une seule fois.
    await new Promise((ok) => setTimeout(ok, 200));
    assert.match((await w.v.act('askr', 'chercher', { q: 'WD-WCC7K0XXXXXA' })).text, /Disque WDC WD40EFRX-68N32N0 4 To/);

    // Relu le même jour : pas de relevé de plus, pas d'alerte de plus.
    const n = alertes(w).length; w.avance(1);
    await act(w, 'sante');
    assert.equal(alertes(w).length, n, 'rien n\'a changé : aucune alerte de plus');
    assert.match((await act(w, 'historique', { disque: 'sdb' })).text, /^sdb · ST2000DM001-1ER164 : 1 relevé\(s\) depuis le 13 novembre · état Attention/);

    // Le lendemain : sdb perd 12 secteurs de plus, le NVMe chauffe et s'use.
    w.avance(24); poser(w.faux, 'sdb', 'sdb_plus'); poser(w.faux, 'nvme0', 'nvme_chaud_use');
    await act(w, 'sante');
    const titres = alertes(w).map((x) => x.title);
    // +12 secteurs en un jour : sdb bascule en Mauvais, une seule alerte qui dit tout (la hausse, et quoi faire).
    const sdbMauvais = alertes(w).find((x) => x.title === 'Disque sdb (ST2000DM001-1ER164 2 To) : état Mauvais');
    assert.ok(sdbMauvais, titres.join(' | ')); assert.equal(sdbMauvais!.level, 'critique');
    assert.match(ns(sdbMauvais!.detail!), /Secteurs réalloués en hausse : \+12 depuis le 13 novembre\. Le disque continue de s'abîmer\..*Sauvegarde d'abord ce qui compte, remplace le disque ensuite\./);
    assert.ok(titres.some((t) => /^Disque nvme0 .* : avertissement critique$/.test(t)));
    assert.ok(titres.some((t) => /^Disque nvme0 .* : usure à 91 %$/.test(t)));
    assert.ok(titres.some((t) => /^Disque nvme0 .* trop chaud : 83 °C$/.test(t)));
    const h = (await act(w, 'historique', { disque: 'sdb' })).text;
    assert.match(h, /2 relevé\(s\) depuis le 13 novembre/); assert.match(h, /secteurs réalloués 48 → 60/);
    // La tendance compte : +12 en un jour fait passer sdb en Mauvais.
    assert.match((await act(w, 'sante', { disque: 'sdb' })).text, /🔴 sdb .*: Mauvais[\s\S]*Secteurs réalloués en hausse : \+12 depuis le 13 novembre/);

    // La page : 4 onglets, l'état de chaque disque d'un coup d'œil dans le premier.
    const p = await vue(w);
    assert.deepEqual(p.onglets, ['Disques', 'Historique', 'Vitesse', 'Réglages']);
    const cartes = p.sections[0] as Extract<Section, { kind: 'cards' }>;
    assert.equal(cartes.kind, 'cards'); assert.equal(cartes.onglet, 'Disques');
    assert.deepEqual(cartes.items.map((x) => `${x.title.split(' · ')[0]}:${x.badge}`).filter(reels), ['sda:Bon', 'sdb:Mauvais', 'sdc:Inconnu', 'sdd:Mauvais', 'sde:Attention', 'nvme0:Attention'], 'les disques virtuels de la machine d\'essai sont montrés à part, sans état');
    assert.ok(!cartes.items.some((x) => x.actions?.some((y) => y.module === 'hel')), 'sans l\'appli de récupération, pas de bouton vers elle');
    assert.ok(section(p.sections, /^Valeurs SMART de sd[bd], expliquées$/), 'le disque le plus mal en point est ouvert en détail');
    const temp = section(p.sections, /^Température \(/) as Extract<Section, { kind: 'courbe' }>;
    assert.equal(temp.onglet, 'Historique'); assert.deepEqual(temp.labels, ['13/11', '14/11']);
    assert.ok(section(p.sections, /^Secteurs réalloués$/)); assert.ok(section(p.sections, /^Usure des SSD$/));
    assert.equal((section(p.sections, /^Changer une température d'alerte$/) as { onglet?: string }).onglet, 'Réglages');
    assert.deepEqual(p.kpis?.map((k) => `${k.label}=${k.value}`).slice(1, 4), ['Bon=1', 'Attention=2', 'Mauvais=2']);
    for (const s of [...p.sections, ...(p.side ?? [])]) assert.ok(p.onglets!.includes(s.onglet ?? 'Disques'), `section « ${String((s as { title?: string }).title)} » dans un onglet connu`);

    // Ouvrir un disque : son détail et ses valeurs expliquées.
    assert.match((await act(w, 'ouvrir', { disque: 'nvme0' })).text, /^📂 🟠 nvme0/);
    const p2 = await vue(w), detail = section(p2.sections, /^Valeurs SMART de nvme0, expliquées$/) as Extract<Section, { kind: 'table' }>;
    assert.ok(detail.rows.some((x) => x.cells[0] === 'Avertissement critique' && /température/.test(x.cells[1])));
    assert.match((await act(w, 'smart', { disque: 'sdd' })).text, /^sdd \(ST3000DM001-1CH166 3 To\) · disque dur 7 200 tr\/min · état Mauvais[\s\S]*- Secteurs réalloués : 1450 \(note 3 \(pire 3, seuil 36\)\) ⚠ — /);

    // Le surlendemain : le NVMe se met en lecture seule → état Mauvais, alerte critique.
    w.avance(24); poser(w.faux, 'nvme0', 'nvme_critique');
    await act(w, 'sante');
    assert.ok(alertes(w).some((x) => /^Disque nvme0 .* : état Mauvais$/.test(x.title) && x.level === 'critique'));

    // Un disque fixe qui ne répond plus du tout.
    w.avance(24); sansDisque(w.faux, 'sde');
    await act(w, 'sante');
    assert.ok(alertes(w).some((x) => /^Disque sde .* : il ne répond plus$/.test(x.title)));

    // La surveillance ne réveille pas un disque qui dort : sa dernière lecture est montrée, en le disant.
    writeFileSync(join(w.faux, 'sda.dort'), ''); w.avance(1);
    await w.v.module('durinn')!.watch!.run(w.v.ctx('durinn'));
    assert.match(readFileSync(join(w.faux, 'appels.log'), 'utf8'), /-n standby \/dev\/sda/);
    const p3 = await vue(w), c3 = p3.sections.find((x) => x.kind === 'cards') as Extract<Section, { kind: 'cards' }>;
    assert.equal(c3.items.find((x) => x.title.startsWith('sda'))?.badge, 'Bon (dort)');

    // Réglages : la température d'alerte d'un disque dur.
    assert.equal((await act(w, 'seuils', { genre: 'disque dur', attention: 30, alerte: 33 })).ok, true);
    w.avance(1); await act(w, 'sante');
    assert.ok(alertes(w).some((x) => /^Disque sda .* trop chaud : 34 °C$/.test(x.title)), 'la nouvelle limite compte');
    assert.equal((await act(w, 'seuils', { genre: 'SSD', attention: 80, alerte: 70 })).ok, false);
  } finally { w.fin(); }
});

test('Tirésias · liens : avec l\'appli de récupération, un disque Mauvais propose de récupérer ses fichiers ; Hygie renvoie vers le détail', { timeout: 60_000 }, async () => {
  const w = monde({ hel: true });
  try {
    await act(w, 'sante');
    const p = await vue(w), c = p.sections.find((x) => x.kind === 'cards') as Extract<Section, { kind: 'cards' }>;
    const b = c.items.find((x) => x.title.startsWith('sdd'))!.actions!.find((x) => x.module === 'hel');
    assert.deepEqual(b, { module: 'hel', action: 'ouvrir', label: 'Récupérer les fichiers (Perséphone)', input: { disque: '/dev/sdd' } });
    assert.match((await w.v.act(b!.module!, b!.action, b!.input)).text, /ouvert \/dev\/sdd/);
    assert.ok(!c.items.find((x) => x.title.startsWith('sda'))!.actions!.some((x) => x.module === 'hel'), 'pas pour un disque sain');
    assert.match(alertes(w).find((x) => /sdd/.test(x.title))!.steps!.join(' '), /Perséphone peut tenter de les récupérer/);
  } finally { w.fin(); }
});

test('Tirésias · smartctl absent : dit clairement quoi installer, et propose de le faire', { timeout: 30_000 }, async () => {
  const w = monde({ faux: false, run: async (cmd: string) => ({ code: cmd === 'sh' ? 1 : 0, out: '', err: '' }) });
  try {
    const r = await act(w, 'sante');
    assert.equal(r.ok, false); assert.match(r.text, /^smartctl n'est pas installé sur cette machine.*sudo apt install smartmontools/);
    const p = await vue(w), etapes = p.sections.find((x) => x.kind === 'steps') as Extract<Section, { kind: 'steps' }>;
    assert.equal(etapes.items[0].action, 'installer');
    assert.match(w.v.module('durinn')!.actions.find((x) => x.id === 'installer')!.grave!({}, w.v.ctx('durinn')) ?? '', /installer le paquet « smartmontools »/);
  } finally { w.fin(); }
});

test('Tirésias · le vrai smartctl de cette machine', { skip: !VRAI_SMARTCTL ? 'smartctl n\'est pas installé ici' : false, timeout: 60_000 }, async () => {
  const w = monde({ faux: false });
  try {
    const r = await act(w, 'sante');
    assert.notEqual((r.data as { panne?: string } | undefined)?.panne, 'absent', r.text);
    assert.equal(r.ok, true, r.text);
    const vrais = (r.data as { disques: Array<{ nom: string; etat: string }> }).disques;
    // Machine virtuelle (disques virtio) : smartctl ne voit rien, chaque disque est montré sans état, et c'est dit.
    if (vrais.every((d) => /^(vd|xvd)/.test(d.nom))) assert.match(r.text, /Cette machine est virtuelle : ses disques n'ont pas de SMART/);
    else assert.ok(vrais.length > 0);
    console.log(`smartctl réel (${VRAI_SMARTCTL}) :\n${r.text}`);
  } finally { w.fin(); }
});

// ---------------------------------------------------------------- le test de vitesse, pour de vrai
test('Tirésias · test de vitesse réel dans un fichier de test : mesures, fichier effacé, comparaison, refus, arrêt, ménage', { timeout: 180_000 }, async () => {
  const w = monde(), lieu = mkdtempSync(join(tmpdir(), 'durinn-vitesse-'));
  try {
    const r1 = await act(w, 'banc', { dossier: lieu, taille: '32 Mo', secondes: 0.3 });
    assert.equal(r1.ok, true, r1.text);
    for (const re of [/^⏱ Test de vitesse · /, /Séquentiel 1 Mo, 8 accès à la fois : lecture [\d, ]+ Mo\/s · écriture [\d, ]+ Mo\/s/, /Aléatoire 4 Ko, 32 accès à la fois : lecture .* accès\/s\)/, /Aléatoire 4 Ko, un accès à la fois/, /Le fichier de test a été effacé\.$/]) assert.match(r1.text, re);
    assert.deepEqual(readdirSync(lieu), [], 'le fichier de test est effacé');
    const res = r1.data as Resultat; assert.ok(res.mesures.seq1m_q8!.lecture!.moS > 0 && res.mesures.rnd4k_q32!.ecriture!.acces > 0);
    console.log(r1.text);
    w.avance(24);
    const r2 = await act(w, 'banc', { dossier: lieu, taille: '32 Mo', secondes: 0.3 });
    assert.match(r2.text, /Par rapport au test du 13\/11\/2026 : lecture séquentielle [+−]?\d+ %/);
    const p = await vue(w), t = section(p.sections, /^Résultats gardés$/) as Extract<Section, { kind: 'table' }>;
    assert.equal(t.rows.length, 2); assert.equal(t.onglet, 'Vitesse'); assert.ok(section(p.sections, /^Débit séquentiel dans le temps/));
    assert.match((await act(w, 'resultats')).text, /Tests d'avant :/);

    // Refus clairs, rien de créé.
    assert.match((await act(w, 'banc', { dossier: '/dev', taille: '32 Mo' })).text, /jamais sur un disque brut/);
    assert.match((await act(w, 'banc', { dossier: join(lieu, 'absent'), taille: '32 Mo' })).text, /n'existe pas/);
    assert.match((await act(w, 'banc', { dossier: 'relatif', taille: '32 Mo' })).text, /chemin complet/);

    // Un test long continue tout seul (durée annoncée) ; on peut l'arrêter, et son fichier est effacé.
    w.v.ctx('durinn').saveSettings({ attenteVitesse: 300 });
    const long = await act(w, 'banc', { dossier: lieu, taille: '128 Mo', secondes: 10 });
    assert.match(long.text, /^⏱ Test de vitesse lancé dans .* \(fichier de 128 Mo\) : il dure environ \d+ secondes\./);
    assert.match((await act(w, 'banc', { dossier: lieu })).text, /déjà en cours/);
    const enCours = await vue(w); assert.ok(section(enCours.sections, /^Test de vitesse en cours$/)); assert.equal(enCours.refreshMs, 2000);
    assert.match((await act(w, 'interrompre')).text, /^⏹ Test de vitesse arrêté .* Le fichier de test a été effacé\./);
    assert.deepEqual(readdirSync(lieu), [], 'fichier effacé après l\'arrêt');

    // Odin coupé net pendant un test : au démarrage suivant, le fichier laissé est effacé.
    const reste = join(lieu, 'odin-test-vitesse-0123456789.tmp'); writeFileSync(reste, 'x');
    writeFileSync(join(w.v.ctx('durinn').dir, 'test-en-cours.json'), JSON.stringify({ fichier: reste }));
    durinn.start!(w.v.ctx('durinn'));
    assert.equal(existsSync(reste), false); assert.ok(alertes(w).some((x) => /un fichier de test de vitesse a été effacé/.test(x.title)));
    // Et jamais un autre fichier que celui du test.
    const autre = join(lieu, 'precieux.txt'); writeFileSync(autre, 'x');
    writeFileSync(join(w.v.ctx('durinn').dir, 'test-en-cours.json'), JSON.stringify({ fichier: autre }));
    durinn.start!(w.v.ctx('durinn')); assert.equal(existsSync(autre), true);
  } finally { rmSync(lieu, { recursive: true, force: true }); w.fin(); }
});

// ---------------------------------------------------------------- un autre poste, par un vrai SSH
const peutSsh = root && a('sshd') && a('ssh') && a('ssh-keygen') && a('dd');
const libre = () => new Promise<number>((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });
const ouvert = (port: number) => new Promise<boolean>((res) => { const s = connect({ host: '127.0.0.1', port }); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });
test('Tirésias · un autre poste Linux par un vrai SSH : santé de ses disques, page, alerte, surveillance, test de vitesse ; Windows refusé avec explication', { skip: !peutSsh ? 'sshd absent ou pas administrateur' : false, timeout: 180_000 }, async () => {
  const w = monde(), dir = mkdtempSync(join(tmpdir(), 'durinn-ssh-')), lieu = mkdtempSync(join(tmpdir(), 'durinn-ssh-vitesse-')), enfants: ChildProcess[] = [];
  try {
    const port = await libre(); mkdirSync('/run/sshd', { recursive: true }); mkdirSync(join(dir, 'ssh'));
    for (const k of ['hote', 'client']) execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'ssh', k)]);
    copyFileSync(join(dir, 'ssh', 'client.pub'), join(dir, 'ssh', 'autorises')); chmodSync(join(dir, 'ssh', 'autorises'), 0o600);
    // Le poste a « son » smartctl (le faux, avec les mêmes disques) en tête de son PATH.
    writeFileSync(join(dir, 'ssh', 'sshd_config'), `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${dir}/ssh/hote\nPidFile ${dir}/ssh/sshd.pid\nAuthorizedKeysFile ${dir}/ssh/autorises\nPermitRootLogin yes\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nLogLevel ERROR\nSetEnv PATH=${join(w.faux, 'bin')}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\n`);
    const sshd = spawnSync('sh', ['-c', 'command -v sshd || echo /usr/sbin/sshd'], { encoding: 'utf8' }).stdout.trim().split('\n')[0];
    enfants.push(spawn(sshd, ['-D', '-e', '-f', join(dir, 'ssh', 'sshd_config')], { stdio: 'ignore' }));
    for (let k = 0; k < 80 && !(await ouvert(port)); k++) await new Promise((ok) => setTimeout(ok, 100));
    copyFileSync(join(dir, 'ssh', 'client'), join(w.home, 'id_ed25519')); copyFileSync(join(dir, 'ssh', 'client.pub'), join(w.home, 'id_ed25519.pub')); chmodSync(join(w.home, 'id_ed25519'), 0o600);
    saveMachine(w.home, { label: 'serveur-disques', host: '127.0.0.1', user: 'root', port, via: 'ssh' });
    saveMachine(w.home, { label: 'PC-Fatima', host: '192.168.1.20', user: 'Fatima', password: 'x', via: 'smb' });

    const log = () => (existsSync(join(w.faux, 'appels.log')) ? readFileSync(join(w.faux, 'appels.log'), 'utf8') : ''), avant = log().length;
    const r = await act(w, 'sante', { poste: 'serveur-disques' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /^Santé des disques · serveur-disques\n/); assert.match(r.text, /🔴 sdd · ST3000DM001-1CH166/);
    assert.ok(log().length > avant, 'smartctl lancé sur le poste, par SSH');
    assert.ok(alertes(w).some((x) => x.title === 'Disque sdd (ST3000DM001-1CH166 3 To) sur serveur-disques : état Mauvais'), alertes(w).map((x) => x.title).join(' | '));
    assert.match(alertes(w).find((x) => /sur serveur-disques : état Mauvais/.test(x.title))!.steps![0], /Sauvegarde tout de suite ce qui compte sur ce disque de serveur-disques/);

    // La page, sur ce poste (« Sur quel poste ? »).
    const p = await vue(w, { poste: 'serveur-disques' });
    assert.match(p.subtitle ?? '', /^serveur-disques · \d+ disque\(s\) · 2 bon\(s\), 2 à surveiller, 1 mauvais/);
    assert.deepEqual(p.postes?.choix.map((c) => c.nom), ['Cette machine', 'serveur-disques'], 'le PC Windows n\'est pas proposé (lecture par SSH)');
    assert.equal(p.postes?.actuel, p.postes?.choix[1].id);

    // Windows : dit ce qui est possible, sans le promettre.
    const win = await act(w, 'sante', { poste: 'PC-Fatima' });
    assert.equal(win.ok, false); assert.match(win.text, /ne se lit pas à travers un partage.*CrystalDiskInfo/);

    // Surveillance : relu toutes les 6 heures par la surveillance périodique.
    assert.match((await act(w, 'surveiller', { poste: 'serveur-disques' })).text, /^👁 Les disques de serveur-disques sont surveillés/);
    const n1 = log().split('\n').length;
    w.avance(1); await w.v.module('durinn')!.watch!.run(w.v.ctx('durinn'));
    const n2 = log().split('\n').length;
    w.avance(6); await w.v.module('durinn')!.watch!.run(w.v.ctx('durinn'));
    const l3 = log().split('\n');
    assert.ok(l3.slice(n2 - 1).some((x) => /-n standby \/dev\/sdb/.test(x)), 'au bout de 6 heures, le poste est relu (sans réveiller ses disques)');
    assert.ok(n2 >= n1);

    // Test de vitesse sur le poste (séquentiel, avec dd) : action grave, fichier effacé.
    const banc = w.v.module('durinn')!.actions.find((x) => x.id === 'banc')!;
    assert.match(banc.grave!({ poste: 'serveur-disques', dossier: lieu, taille: '32 Mo' }, w.v.ctx('durinn')) ?? '', /^écrire un fichier de test de 32 Mo sur serveur-disques/);
    assert.equal(banc.grave!({ dossier: lieu }, w.v.ctx('durinn')), undefined, 'sur la machine d\'Odin, rien de grave (fichier de test seulement)');
    const v = await act(w, 'banc', { poste: 'serveur-disques', dossier: lieu, taille: '32 Mo' });
    assert.equal(v.ok, true, v.text);
    assert.match(v.text, /^⏱ Test de vitesse sur serveur-disques · /); assert.match(v.text, /Séquentiel 1 Mo, un accès à la fois : lecture [\d, ]+ Mo\/s · écriture [\d, ]+ Mo\/s/);
    assert.match(v.text, /seul le débit séquentiel est mesuré/);
    assert.deepEqual(readdirSync(lieu), [], 'le fichier de test du poste est effacé');
    const plein = await act(w, 'banc', { poste: 'serveur-disques', dossier: '/nexiste/pas', taille: '32 Mo' });
    assert.equal(plein.ok, false); assert.match(plein.text, /le dossier \/nexiste\/pas n'existe pas sur serveur-disques/);
    console.log(v.text);
  } finally { for (const e of enfants) { try { e.kill('SIGKILL'); } catch { /* fini */ } } rmSync(dir, { recursive: true, force: true }); rmSync(lieu, { recursive: true, force: true }); w.fin(); }
});

// ---------------------------------------------------------------- Logos (sans IA)
test('Tirésias · les phrases sans IA arrivent chez lui, les phrases banales non', async () => {
  const w = monde({ faux: false });
  try {
    const vers = async (t: string) => { const u = await understand(w.v, t) as { kind: string; module?: string; action?: string } | undefined; return u?.kind === 'action' ? `${u.module}>${u.action}` : u?.kind ?? 'rien'; };
    for (const [t, attendu] of [
      ['santé du disque', 'durinn>sante'], ['quelle est la santé de mes disques ?', 'durinn>sante'], ['température des disques', 'durinn>sante'],
      ['montre les valeurs smart', 'durinn>smart'], ['teste la vitesse du disque', 'durinn>banc'], ['lance un test de vitesse du disque', 'durinn>banc'],
      ['historique des disques', 'durinn>historique'], ['arrête le test de vitesse', 'durinn>interrompre'], ['usure du ssd', 'durinn>sante'],
    ]) assert.equal(await vers(t), attendu, t);
    for (const t of ['mon fils a de la fièvre', 'quelle température fait-il demain ?', 'la vitesse de ma connexion internet', 'mets de la musique', 'état de la machine', 'disque plein']) assert.doesNotMatch(await vers(t), /^durinn/, t);
  } finally { w.fin(); }
});
