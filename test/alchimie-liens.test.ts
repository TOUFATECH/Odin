// Alchimie : conversions faites par Odin lui-même dans l'appli (sans outil), dossiers surveillés, et conversion
// depuis un lien (téléchargement sûr, antivirus avant conversion). Aucun accès réseau : les sites sont simulés.
// L'échantillon « dangereux » est le fichier de test standard des antivirus (EICAR), inoffensif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { convertible, tourDeVeille } from '../src/valhalla/modules/dvalinn.ts';
import { hoteInterdit, lienDeMaison, lienPropre, nomDeLien, telecharger } from '../src/valhalla/lien.ts';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const SRT = '1\n00:00:01,000 --> 00:00:03,500\nBonjour Mayotte\n\n2\n00:00:04,000 --> 00:00:06,000\nÀ bientôt\n';
const sh = (cmd: string, args: string[], o: { timeoutMs?: number } = {}) => new Promise<{ code: number; out: string; err: string }>((ok) => execFile(cmd, args, { timeout: o.timeoutMs ?? 120000, maxBuffer: 1 << 24 }, (e, out, err) => ok({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 1) : 0, out: String(out), err: String(err) })));

/** Un faux Internet : chaque adresse rend une réponse ; tout ce qui est demandé est noté (adresse, en-tête d'authentification). */
function fauxSites(sites: Record<string, (req: { auth: string | null }) => Response>) {
  const vus: Array<{ url: string; auth: string | null }> = [];
  const f = (async (u: URL | string, init?: RequestInit) => {
    const url = String(u), auth = new Headers(init?.headers).get('authorization');
    vus.push({ url, auth });
    assert.equal(init?.redirect, 'manual', 'les redirections sont suivies une à une, pour être revérifiées');
    const s = sites[url]; if (!s) return new Response('introuvable', { status: 404 });
    return s({ auth });
  }) as unknown as typeof fetch;
  return { f, vus };
}
const sansDns = async () => [] as string[];

test('lien : ce qui est accepté, refusé, ou soumis à ton accord (pur)', () => {
  for (const h of ['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.8.9.1', '[::1]', '0.0.0.0', '169.254.169.254', 'fe80::1', 'metadata.google.internal', '::ffff:127.0.0.1']) assert.ok(hoteInterdit(h), h);
  for (const h of ['192.168.1.10', '10.0.0.5', 'nas.local', 'exemple.fr', '8.8.8.8']) assert.ok(!hoteInterdit(h), h);
  assert.ok(lienDeMaison('http://192.168.1.10/films/a.mkv') && lienDeMaison('http://nas.local/a.srt') && lienDeMaison('https://10.0.0.5:8443/x') && lienDeMaison('http://[::ffff:192.168.1.5]/x'));
  assert.ok(!lienDeMaison('https://exemple.fr/a.srt') && !lienDeMaison('http://127.0.0.1/a') && !lienDeMaison('ftp://192.168.1.10/a') && !lienDeMaison('pas un lien') && !lienDeMaison(undefined));
  assert.equal(lienPropre(' https://exemple.fr/a%20b.srt ').pathname, '/a%20b.srt');
  assert.throws(() => lienPropre('file:///etc/passwd'), /http et https/); assert.throws(() => lienPropre('ftp://exemple.fr/a'), /http et https/); assert.throws(() => lienPropre('exemple.fr/a.srt'), /lien invalide/);
  assert.throws(() => lienPropre('https://awa:secret@exemple.fr/a.csv'), /dans leurs cases/);
  for (const u of ['http://127.0.0.1:3000/compte.json', 'http://localhost/x', 'http://[::1]/x', 'http://2130706433/x', 'http://0x7f.1/x', 'http://[::ffff:127.0.0.1]/x', 'http://169.254.169.254/latest/meta-data/', 'http://0.0.0.0/x'])
    assert.throws(() => lienPropre(u), /refusée/, u);
  // Le nom du fichier : jamais de chemin, jamais de fichier caché ; l'extension vient du type quand le lien n'en a pas.
  const u = (x: string) => new URL(x);
  assert.equal(nomDeLien(u('https://exemple.fr/sous-titres/Film%20%C3%A9t%C3%A9.srt')), 'Film été.srt');
  assert.equal(nomDeLien(u('https://exemple.fr/dl?id=4'), 'attachment; filename="../../evasion.json"'), 'evasion.json');
  assert.equal(nomDeLien(u('https://exemple.fr/dl'), 'attachment; filename*=UTF-8\'\'r%C3%A9sum%C3%A9.pdf'), 'résumé.pdf');
  assert.equal(nomDeLien(u('https://exemple.fr/dl'), 'attachment; filename=C:\\Users\\x\\.ssh\\cle'), 'cle');
  assert.equal(nomDeLien(u('https://exemple.fr/'), null, 'application/json; charset=utf-8'), 'fichier.json');
  assert.equal(nomDeLien(u('https://exemple.fr/export'), null, 'text/csv'), 'export.csv');
  assert.equal(nomDeLien(u('https://exemple.fr/.htaccess')), 'htaccess'); assert.equal(nomDeLien(u('https://exemple.fr/a%2F..%2Fb.txt')), 'b.txt');
  assert.ok(!/[\\/]/.test(nomDeLien(u('https://exemple.fr/x'), 'attachment; filename="a/b\\c:d*e.txt"')));
});

test('lien : téléchargement sûr (redirections revérifiées, taille limitée, mot de passe pour le seul site du lien)', async () => {
  const { f, vus } = fauxSites({
    'https://exemple.test/film.srt': () => new Response(SRT, { headers: { 'content-type': 'application/x-subrip' } }),
    'https://exemple.test/ancien': () => new Response(null, { status: 302, headers: { location: '/film.srt' } }),
    'https://exemple.test/piege': () => new Response(null, { status: 302, headers: { location: 'http://192.168.1.10/secret.json' } }),
    'https://exemple.test/piege-odin': () => new Response(null, { status: 301, headers: { location: 'http://127.0.0.1:3000/compte.json' } }),
    'https://exemple.test/boucle': () => new Response(null, { status: 302, headers: { location: '/boucle' } }),
    'https://exemple.test/prive.csv': ({ auth }) => (auth === `Basic ${Buffer.from('awa:Secret 42!').toString('base64')}` ? new Response('nom;tel\nAwa;0639\n') : new Response('non', { status: 401 })),
    'https://exemple.test/ailleurs': () => new Response(null, { status: 302, headers: { location: 'https://autre.test/liste.csv' } }),
    'https://autre.test/liste.csv': () => new Response('a;b\n1;2\n'),
    'https://exemple.test/en-clair': () => new Response(null, { status: 302, headers: { location: 'http://exemple.test/liste.csv' } }),
    'http://exemple.test/liste.csv': () => new Response('a;b\n1;2\n'),
    'https://exemple.test/menteur': () => new Response('x'.repeat(5000)),
    'https://exemple.test/annonce-gros': () => new Response('petit', { headers: { 'content-length': '999999999' } }),
    'https://exemple.test/vide': () => new Response(''),
    'http://192.168.1.10/partage/notes.yaml': () => new Response('ville: Mamoudzou\n'),
    'http://192.168.1.10/secret.json': () => new Response('{"secret":1}'),
  });
  const o = { max: 1000, resoudre: sansDns };
  let r = await telecharger(f, 'https://exemple.test/film.srt', o); assert.equal(r.data.toString(), SRT); assert.equal(r.type, 'application/x-subrip');
  r = await telecharger(f, 'https://exemple.test/ancien', o); assert.equal(r.url.toString(), 'https://exemple.test/film.srt', 'redirection suivie');
  await assert.rejects(telecharger(f, 'https://exemple.test/piege', o), /renvoie vers une adresse de ton réseau/);
  assert.ok(!vus.some((v) => v.url.includes('192.168.1.10')), 'l\'adresse de la maison n\'a jamais été contactée');
  await assert.rejects(telecharger(f, 'https://exemple.test/piege-odin', { ...o, maison: true }), /refusée/, 'vers Odin lui-même : jamais, même avec accord');
  await assert.rejects(telecharger(f, 'https://exemple.test/boucle', o), /trop de redirections/);
  await assert.rejects(telecharger(f, 'https://exemple.test/absent', o), /a répondu 404/);
  await assert.rejects(telecharger(f, 'https://exemple.test/menteur', o), /trop gros/, 'la limite tient même si le site n\'annonce pas la taille');
  await assert.rejects(telecharger(f, 'https://exemple.test/annonce-gros', o), /trop gros/);
  await assert.rejects(telecharger(f, 'https://exemple.test/vide', o), /rien renvoyé/);
  // Une adresse de la maison : refusée sans accord, suivie avec.
  await assert.rejects(telecharger(f, 'http://192.168.1.10/partage/notes.yaml', o), /adresse de ton réseau/);
  assert.equal((await telecharger(f, 'http://192.168.1.10/partage/notes.yaml', { ...o, maison: true })).data.toString(), 'ville: Mamoudzou\n');
  // Un nom public qui mène en fait à la maison ou à Odin lui-même (DNS) : refusé.
  await assert.rejects(telecharger(f, 'https://exemple.test/film.srt', { max: 1000, resoudre: async () => ['192.168.1.77'] }), /adresse de ton réseau/);
  await assert.rejects(telecharger(f, 'https://exemple.test/film.srt', { max: 1000, maison: true, resoudre: async () => ['127.0.0.1'] }), /refusé/);
  await assert.rejects(telecharger(f, 'https://exemple.test/film.srt', { max: 1000, resoudre: async () => ['::ffff:10.0.0.3'] }), /adresse de ton réseau/);
  // Identifiant et mot de passe : envoyés au site du lien, jamais à un autre site après une redirection.
  await assert.rejects(telecharger(f, 'https://exemple.test/prive.csv', o), /demande un identifiant/);
  await assert.rejects(telecharger(f, 'https://exemple.test/prive.csv', { ...o, compte: { utilisateur: 'awa', motDePasse: 'faux' } }), /refuse cet identifiant/);
  assert.match((await telecharger(f, 'https://exemple.test/prive.csv', { ...o, compte: { utilisateur: 'awa', motDePasse: 'Secret 42!' } })).data.toString(), /Awa;0639/);
  vus.length = 0;
  await telecharger(f, 'https://exemple.test/ailleurs', { ...o, compte: { utilisateur: 'awa', motDePasse: 'Secret 42!' } });
  assert.ok(vus.find((v) => v.url === 'https://exemple.test/ailleurs')?.auth, 'le site du lien reçoit le mot de passe');
  assert.equal(vus.find((v) => v.url === 'https://autre.test/liste.csv')?.auth, null, 'un autre site ne le reçoit jamais');
  await telecharger(f, 'https://exemple.test/en-clair', { ...o, compte: { utilisateur: 'awa', motDePasse: 'Secret 42!' } });
  assert.equal(vus.find((v) => v.url === 'http://exemple.test/liste.csv')?.auth, null, 'ni le même site redemandé sans chiffrement (https → http)');
});

test('Alchimie : convertit elle-même, surveille un dossier, convertit depuis un lien (antivirus d\'abord)', { timeout: 120000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'alchimie-'));
  const { f, vus } = fauxSites({
    'https://exemple.test/sous-titres/film.srt': () => new Response(SRT),
    'https://exemple.test/dl?id=4': () => new Response('[{"nom":"Awa","ville":"Mamoudzou"},{"nom":"Saïd","ville":"Koungou"}]', { headers: { 'content-disposition': 'attachment; filename="../../clients.json"', 'content-type': 'application/json' } }),
    'https://exemple.test/outil.txt': () => new Response(EICAR),
    'https://exemple.test/tableau.csv': () => new Response('nom;ville\nPiege;Nulle part\n'),
    'https://exemple.test/piege': () => new Response(null, { status: 302, headers: { location: 'http://192.168.1.10/secret.json' } }),
    'https://exemple.test/compte.json': () => new Response('{"a":1}'),
    'https://exemple.test/photo.xyz': () => new Response('???'),
    'http://192.168.1.10/partage/notes.yaml': () => new Response('ville: Mamoudzou\nhabitants: 71437\n'),
    'https://exemple.test/prive/liste.csv': ({ auth }) => (auth ? new Response('nom;tel\nAwa;0639\n') : new Response('non', { status: 401 })),
  });
  const notes: string[] = [];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: (c, a, o) => sh(c, a, o), fetch: f, notify: async (t) => { notes.push(t); }, autonomy: () => 'equilibre' });
  const ctx = v.ctx('dvalinn'), at = join(ctx.dir, 'atelier'); mkdirSync(at, { recursive: true });
  const mod = v.module('dvalinn')!;
  try {
    // 1. Sans aucun outil : sous-titres, données, contacts. Rien n'est écrasé.
    writeFileSync(join(at, 'film.srt'), SRT);
    let r = await v.act('dvalinn', 'convertir', { fichier: 'film.srt', format: 'vtt' }); assert.match(r.text, /✅ film\.srt → film\.vtt/, r.text);
    assert.match(readFileSync(join(at, 'film.vtt'), 'utf8'), /^WEBVTT\n\n(1\n)?00:00:01\.000 --> 00:00:03\.500\nBonjour Mayotte/);
    r = await v.act('dvalinn', 'convertir', { fichier: 'film.srt', format: 'vtt' }); assert.match(r.text, /film.*\.vtt/); assert.equal(readdirSync(at).filter((x) => x.endsWith('.vtt')).length, 2, 'un deuxième résultat ne remplace pas le premier');
    writeFileSync(join(at, 'clients.json'), '[{"nom":"Awa","code":"0976"},{"nom":"Saïd","code":"0269"}]');
    r = await v.act('dvalinn', 'convertir', { fichier: 'clients.json', format: 'csv' }); assert.match(r.text, /clients\.csv/, r.text);
    assert.match(readFileSync(join(at, 'clients.csv'), 'utf8'), /nom[;,]code\r?\nAwa[;,]0976\r?\nSaïd[;,]0269/);
    r = await v.act('dvalinn', 'convertir', { fichier: 'clients.json', format: 'yaml' }); assert.match(readFileSync(join(at, 'clients.yaml'), 'utf8'), /- nom: Awa\n {2}code: ["']0976["']/);
    writeFileSync(join(at, 'amis.vcf'), 'BEGIN:VCARD\nVERSION:3.0\nFN:Awa Saïd\nTEL;TYPE=CELL:+262639000000\nEND:VCARD\n');
    r = await v.act('dvalinn', 'convertir', { fichier: 'amis.vcf', format: 'csv' }); assert.match(readFileSync(join(at, 'amis.csv'), 'utf8'), /Awa Saïd/);
    assert.match((await v.act('dvalinn', 'convertir', { fichier: 'film.srt', format: 'mp3' })).text, /pas possible : un fichier \.srt \(sous-titres\) se convertit en vtt, ass, lrc, txt/, 'une conversion impossible dit ce qui est possible');
    assert.match((await v.act('dvalinn', 'outils')).text, /Alchimie elle-même \(rien à installer\).*sous-titres → srt, vtt/);
    assert.ok(convertible('a.srt', 'vtt') && convertible('a.json', 'csv') && convertible('a.mov', 'mp4') && !convertible('a.srt', 'mp4') && !convertible('a.xyz', 'pdf') && !convertible('a.mp4', 'mp4'));
    assert.ok(mod.from.includes('KnifeLemon/Filee') && mod.upstream.includes('KnifeLemon/Filee'));
    // « Filee » écrit seul se réduirait à « fil » pour le mode sans IA : une phrase de tous les jours ne doit pas ouvrir Alchimie.
    assert.doesNotMatch((await v.order('mon fils a de la fièvre')).text, /File d'attente|vidéo\(s\)/);

    // 2. Dossier surveillé : ce qui arrive est converti tout seul, une fois ; un fichier encore en cours d'écriture attend.
    mkdirSync(join(at, 'entrees'));
    const vieux = (p: string, s = 60) => { const t = new Date(Date.now() - s * 1000); utimesSync(p, t, t); };
    writeFileSync(join(at, 'entrees', 'a.srt'), SRT); vieux(join(at, 'entrees', 'a.srt'));
    writeFileSync(join(at, 'entrees', 'en-cours.srt'), SRT); // modifié à l'instant : pas encore
    writeFileSync(join(at, 'entrees', 'photo.png'), 'pas des sous-titres'); vieux(join(at, 'entrees', 'photo.png'));
    writeFileSync(join(at, 'entrees', '.cache.srt'), SRT); vieux(join(at, 'entrees', '.cache.srt'));
    r = await v.act('dvalinn', 'surveiller', { dossier: 'entrees', format: 'vtt' }); assert.match(r.text, /Dossier atelier:entrees surveillé.*1 fichier\(s\) déjà converti/, r.text);
    assert.deepEqual(readdirSync(join(at, 'entrees', 'convertis')), ['a.vtt']);
    assert.equal(await tourDeVeille(v.ctx('dvalinn')), 0, 'rien de nouveau : rien n\'est refait');
    vieux(join(at, 'entrees', 'en-cours.srt')); assert.equal(await tourDeVeille(v.ctx('dvalinn')), 1, 'le fichier fini d\'écrire est converti au tour suivant');
    assert.deepEqual(readdirSync(join(at, 'entrees', 'convertis')).sort(), ['a.vtt', 'en-cours.vtt']);
    writeFileSync(join(at, 'entrees', 'a.srt'), SRT + '\n3\n00:00:07,000 --> 00:00:08,000\nFin\n'); vieux(join(at, 'entrees', 'a.srt'), 30);
    assert.equal(await tourDeVeille(v.ctx('dvalinn')), 1, 'un fichier modifié est reconverti'); assert.equal(readdirSync(join(at, 'entrees', 'convertis')).length, 3, 'sans écraser le premier résultat');
    // sept fichiers d'un coup : cinq par tour au plus, le reste au tour suivant
    for (let k = 0; k < 7; k++) { writeFileSync(join(at, 'entrees', `lot-${k}.srt`), SRT); vieux(join(at, 'entrees', `lot-${k}.srt`)); }
    assert.equal(await tourDeVeille(v.ctx('dvalinn')), 5); assert.equal(await tourDeVeille(v.ctx('dvalinn')), 2); assert.equal(await tourDeVeille(v.ctx('dvalinn')), 0);
    // un fichier abîmé ne bloque pas les autres et n'est pas réessayé sans fin
    writeFileSync(join(at, 'entrees', 'casse.json'), '{pas du json'); vieux(join(at, 'entrees', 'casse.json'));
    r = await v.act('dvalinn', 'surveiller', { dossier: 'entrees', format: 'csv' }); assert.match(r.text, /converti en csv/);
    assert.equal(await tourDeVeille(v.ctx('dvalinn')), 0);
    let vue = await mod.view(v.ctx('dvalinn'), new URLSearchParams());
    const surv = vue.sections.find((x) => x.title === 'Dossiers surveillés'); assert.ok(surv && surv.kind === 'table' && surv.rows.length === 1 && surv.rows[0].cells[0] === 'atelier:entrees' && surv.rows[0].cells[1] === 'csv', 'un dossier n\'est surveillé qu\'une fois (le nouveau format remplace l\'ancien)');
    const hist = vue.sections.find((x) => x.title === 'Dernières conversions'); assert.ok(hist && hist.kind === 'table' && hist.rows.some((x) => x.tone === 'mauvais' && /casse\.json → csv \(dossier surveillé\)/.test(x.cells[1]) && /JSON illisible \(ligne 1, colonne 2\)/.test(x.cells[2])), JSON.stringify(hist));
    assert.match((await v.act('dvalinn', 'surveiller', { dossier: 'absent', format: 'vtt' })).text, /introuvable/);
    assert.match((await v.act('dvalinn', 'surveiller', { dossier: 'entrees', format: 'zzz' })).text, /format inconnu/);
    assert.match((await v.act('dvalinn', 'surveiller', { dossier: '../../etc', format: 'pdf' })).text, /interdit/);
    r = await v.act('dvalinn', 'ne_plus_surveiller', { dossier: 'atelier:entrees' }); assert.match(r.text, /plus surveillé/);
    writeFileSync(join(at, 'entrees', 'apres.srt'), SRT); vieux(join(at, 'entrees', 'apres.srt')); assert.equal(await tourDeVeille(v.ctx('dvalinn')), 0);
    assert.ok(existsSync(join(at, 'entrees', 'a.srt')), 'les originaux restent');

    // 3. Depuis un lien : téléchargé, vérifié par l'antivirus, converti, rangé dans atelier:arrivees.
    r = await v.act('dvalinn', 'depuis_lien', { lien: 'https://exemple.test/sous-titres/film.srt', format: 'vtt' }); assert.match(r.text, /✅ film\.srt .* téléchargé, vérifié, converti → atelier:arrivees\/film\.vtt/, r.text);
    assert.match(readFileSync(join(at, 'arrivees', 'film.vtt'), 'utf8'), /^WEBVTT/); assert.equal(readFileSync(join(at, 'arrivees', 'film.srt'), 'utf8'), SRT, 'l\'original est gardé');
    r = await v.act('dvalinn', 'depuis_lien', { lien: 'https://exemple.test/dl?id=4', format: 'csv' }); assert.match(r.text, /clients\.json .* → atelier:arrivees\/clients\.csv/, r.text);
    assert.ok(!existsSync(join(home, 'clients.json')) && !existsSync(join(ctx.dir, 'clients.json')), 'un nom piégé ne sort pas du dossier d\'arrivée');
    // l'échantillon de test des antivirus : enregistré mais jamais converti
    r = await v.act('dvalinn', 'depuis_lien', { lien: 'https://exemple.test/outil.txt', format: 'pdf' }); assert.equal(r.ok, false); assert.match(r.text, /fichier suspect .* je ne le convertis pas/, r.text);
    assert.ok(!readdirSync(join(at, 'arrivees')).some((x) => x.endsWith('.pdf'))); assert.ok(existsSync(join(at, 'arrivees', 'outil.txt')), 'un fichier de test reste là, sans être ouvert');
    // un fichier reconnu dangereux par son empreinte (ici : un tableau inoffensif déclaré « connu » pour l'essai) part en quarantaine
    const mauvais = 'nom;ville\nPiege;Nulle part\n', hsb = join(home, 'essai.hsb');
    writeFileSync(hsb, `${createHash('sha256').update(mauvais).digest('hex')}:${Buffer.byteLength(mauvais)}:Essai.Lien-1\n`);
    assert.match((await v.act('ullr', 'importer', { chemin: hsb })).text, /1 empreinte\(s\) importée\(s\)/);
    r = await v.act('dvalinn', 'depuis_lien', { lien: 'https://exemple.test/tableau.csv', format: 'json' }); assert.equal(r.ok, false);
    assert.match(r.text, /fichier suspect \(Malware connu : Essai\.Lien-1\) : je ne le convertis pas\. Je l'ai mis en quarantaine/, r.text);
    assert.ok(!existsSync(join(at, 'arrivees', 'tableau.csv')) && !existsSync(join(at, 'arrivees', 'tableau.json')), 'ni l\'original ni un résultat ne restent dans l\'atelier');
    assert.match((await v.act('ullr', 'quarantaine')).text, /tableau\.csv/);
    // refus : redirection vers la maison, Odin lui-même, fichier protégé, type inconnu, identifiants dans le lien
    assert.match((await v.act('dvalinn', 'depuis_lien', { lien: 'https://exemple.test/piege', format: 'csv' })).text, /renvoie vers une adresse de ton réseau/);
    assert.match((await v.act('dvalinn', 'depuis_lien', { lien: 'http://127.0.0.1:3000/compte.json', format: 'csv' })).text, /refusée/);
    assert.match((await v.act('dvalinn', 'depuis_lien', { lien: 'http://[::ffff:127.0.0.1]:3000/x.json', format: 'csv' })).text, /refusée/);
    assert.match((await v.act('dvalinn', 'depuis_lien', { lien: 'file:///etc/passwd', format: 'pdf' })).text, /http et https/);
    assert.match((await v.act('dvalinn', 'depuis_lien', { lien: 'https://exemple.test/compte.json', format: 'csv' })).text, /protégé/);
    assert.match((await v.act('dvalinn', 'depuis_lien', { lien: 'https://exemple.test/photo.xyz', format: 'pdf' })).text, /ne sais pas convertir/);
    assert.match((await v.act('dvalinn', 'depuis_lien', { lien: 'https://awa:secret@exemple.test/prive/liste.csv', format: 'json' })).text, /dans leurs cases/);
    assert.ok(!vus.some((x) => /192\.168|127\.0\.0\.1|7f00/.test(x.url)), 'aucune adresse interne n\'a été contactée');
    // une adresse de la maison : action grave (ton accord), puis ça marche
    const act = mod.actions.find((a) => a.id === 'depuis_lien')!;
    assert.match(act.grave!({ lien: 'http://192.168.1.10/partage/notes.yaml', format: 'json' }) ?? '', /pointe vers ton réseau \(192\.168\.1\.10\)/);
    assert.equal(act.grave!({ lien: 'https://exemple.test/sous-titres/film.srt', format: 'vtt' }), undefined, 'un lien public ne demande pas d\'accord');
    assert.ok(act.external, 'le résultat vient d\'ailleurs : donnée non fiable pour l\'IA');
    r = await v.act('dvalinn', 'depuis_lien', { lien: 'http://192.168.1.10/partage/notes.yaml', format: 'json' }); assert.match(r.text, /notes\.json/, r.text);
    assert.deepEqual(JSON.parse(readFileSync(join(at, 'arrivees', 'notes.json'), 'utf8')), { ville: 'Mamoudzou', habitants: 71437 });
    // avec identifiant et mot de passe : jamais gardés
    assert.match((await v.act('dvalinn', 'depuis_lien', { lien: 'https://exemple.test/prive/liste.csv', format: 'json' })).text, /demande un identifiant/);
    r = await v.act('dvalinn', 'depuis_lien', { lien: 'https://exemple.test/prive/liste.csv', format: 'json', utilisateur: 'awa', mot_de_passe: 'Secret 42!' }); assert.match(r.text, /liste\.json/, r.text);
    assert.equal(act.params!.find((p) => p.key === 'mot_de_passe')!.kind, 'password');
    for (const fichier of readdirSync(ctx.dir)) { const p = join(ctx.dir, fichier); try { assert.ok(!readFileSync(p, 'utf8').includes('Secret 42!'), `le mot de passe n'est gardé nulle part (${fichier})`); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EISDIR') throw e; } }
    vue = await mod.view(v.ctx('dvalinn'), new URLSearchParams());
    assert.ok(vue.sections.some((x) => x.kind === 'form' && x.action === 'depuis_lien') && vue.sections.some((x) => x.kind === 'form' && x.action === 'surveiller'));
    assert.ok(!existsSync(join(ctx.dir, 'travail')) || readdirSync(join(ctx.dir, 'travail')).length === 0, 'dossiers de travail nettoyés');
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});
