// Nébuleuse : rangement sûr (chemins, versions, corbeille, archive .zip), synchronisation de dossiers,
// serveur des fichiers (droits par groupe, envois, liens de partage avec mot de passe, dépôt, notes secrètes
// lues une seule fois, WebDAV avec mot de passe d'appli), antivirus sur les fichiers reçus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../src/valhalla/skidbladnir/store.ts';
import { plan, syncPair } from '../src/valhalla/skidbladnir/sync.ts';
import { inlineType } from '../src/valhalla/skidbladnir/server.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { filesServer, rights, slug } from '../src/valhalla/modules/skidbladnir.ts';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

test('rangement : chemins sûrs, versions, corbeille, archive .zip lisible', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skid-')), out = mkdtempSync(join(tmpdir(), 'skid-o-'));
  try {
    assert.throws(() => S.cleanRel('../etc/passwd'), /interdit/); assert.throws(() => S.cleanName('.versions'), /invalide/); assert.equal(S.cleanName('a/b'), 'ab', 'pas de chemin dans un nom');
    assert.equal(S.cleanRel('/a//b/./c/'), 'a/b/c');
    symlinkSync('/etc', join(root, 'dehors')); assert.throws(() => S.inside(root, 'dehors/passwd'), /lien vers l'extérieur/);
    S.mkdir(root, 'Vacances'); writeFileSync(join(root, 'Vacances', 'liste.txt'), 'v1');
    S.keepVersion(root, 'Vacances/liste.txt', 2, 'awa'); writeFileSync(join(root, 'Vacances', 'liste.txt'), 'v2');
    S.keepVersion(root, 'Vacances/liste.txt', 2, 'ali'); writeFileSync(join(root, 'Vacances', 'liste.txt'), 'v3');
    await new Promise((r) => setTimeout(r, 5)); S.keepVersion(root, 'Vacances/liste.txt', 2, 'sara'); writeFileSync(join(root, 'Vacances', 'liste.txt'), 'v4');
    const vs = S.versions(root, 'Vacances/liste.txt'); assert.equal(vs.length, 2, 'seulement les 2 dernières versions'); assert.equal(vs[0].by, 'sara');
    S.restoreVersion(root, 'Vacances/liste.txt', vs[1].id, 2, 'awa'); assert.equal(readFileSync(join(root, 'Vacances', 'liste.txt'), 'utf8'), 'v2');
    assert.deepEqual(S.list(root, '').map((e) => e.name), ['Vacances'], 'dossiers d\'Odin et liens cachés');
    const t = S.toTrash(root, 'Vacances/liste.txt', 'awa'); assert.ok(!existsSync(join(root, 'Vacances', 'liste.txt')));
    writeFileSync(join(root, 'Vacances', 'liste.txt'), 'autre');
    assert.match(S.restore(root, t.id), /liste \(restauré .*\)\.txt$/, 'place prise : remis sous un autre nom');
    S.toTrash(root, 'Vacances/liste.txt'); assert.equal(S.purge(root, 30), 0); assert.equal(S.purge(root, 0), 1);
    assert.equal(S.freeName(join(root, 'Vacances'), 'photo.jpg'), 'photo.jpg');
    assert.deepEqual(S.search(root, 'restaure').length, 1);
    writeFileSync(join(root, 'Vacances', 'é photo.jpg'), Buffer.alloc(70_000, 7));
    const zf = join(out, 'a.zip'), { createWriteStream } = await import('node:fs'), ws = createWriteStream(zf);
    await S.zipTo(ws, S.filesUnder(root, 'Vacances')); await new Promise<void>((ok) => ws.end(ok));
    const check = execFileSync('python3', ['-I', '-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(sorted(z.namelist()))', zf], { encoding: 'utf8' });
    assert.match(check, /^None\n/, 'CRC justes'); assert.match(check, /é photo\.jpg/);
    assert.equal(inlineType('a.html'), undefined, 'une page web se télécharge, jamais affichée'); assert.equal(inlineType('a.svg'), undefined); assert.equal(inlineType('a.JPG'), 'image/jpeg');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});

test('synchro : nouveaux, modifiés, supprimés (corbeille), conflits gardés, sens unique', () => {
  const A = mkdtempSync(join(tmpdir(), 'skA-')), B = mkdtempSync(join(tmpdir(), 'skB-'));
  try {
    assert.deepEqual(plan(new Map([['a', { size: 1, mtime: 1 }]]), new Map(), {}, 'deux'), [{ path: 'a', op: 'AB' }]);
    assert.deepEqual(plan(new Map([['a', { size: 1, mtime: 1 }]]), new Map(), { a: { size: 1, mtime: 1 } }, 'deux'), [{ path: 'a', op: 'delA' }], 'supprimé de l\'autre côté');
    assert.deepEqual(plan(new Map(), new Map([['b', { size: 1, mtime: 1 }]]), {}, 'vers_dossier'), [], 'sens unique : ce qui n\'est que dans le dossier reste');
    mkdirSync(join(A, 'photos')); writeFileSync(join(A, 'photos', 'p1.jpg'), 'aa'); writeFileSync(join(B, 'notes.txt'), 'bb');
    let r = syncPair(A, B, 'deux'); assert.deepEqual([r.copiedAB, r.copiedBA], [['photos/p1.jpg'], ['notes.txt']]);
    assert.equal(readFileSync(join(B, 'photos', 'p1.jpg'), 'utf8'), 'aa');
    r = syncPair(A, B, 'deux'); assert.equal(r.copiedAB.length + r.copiedBA.length, 0, 'rien de nouveau');
    // Modifié d'un côté.
    writeFileSync(join(B, 'notes.txt'), 'bb modifié'); utimesSync(join(B, 'notes.txt'), new Date(), new Date(Date.now() + 5000));
    r = syncPair(A, B, 'deux'); assert.deepEqual(r.copiedBA, ['notes.txt']); assert.equal(readFileSync(join(A, 'notes.txt'), 'utf8'), 'bb modifié');
    // Supprimé dans B → mis de côté dans A (jamais effacé).
    rmSync(join(B, 'photos', 'p1.jpg')); const gone: string[] = [];
    r = syncPair(A, B, 'deux', { trashA: (p) => { gone.push(p); rmSync(join(A, p)); } }); assert.deepEqual(gone, ['photos/p1.jpg']);
    // Conflit : les deux ont changé → les deux versions gardées.
    writeFileSync(join(A, 'notes.txt'), 'version A'); utimesSync(join(A, 'notes.txt'), new Date(), new Date(Date.now() + 20_000));
    writeFileSync(join(B, 'notes.txt'), 'version B!'); utimesSync(join(B, 'notes.txt'), new Date(), new Date(Date.now() + 10_000));
    r = syncPair(A, B, 'deux', { nameB: 'clé USB' }); assert.equal(r.conflicts.length, 1); assert.match(r.conflicts[0], /notes \(conflit clé USB .*\)\.txt/);
    assert.equal(readFileSync(join(A, 'notes.txt'), 'utf8'), 'version A'); assert.equal(readFileSync(join(B, 'notes.txt'), 'utf8'), 'version A');
    assert.equal(readFileSync(join(A, r.conflicts[0]), 'utf8'), 'version B!'); assert.ok(existsSync(join(B, r.conflicts[0])));
  } finally { rmSync(A, { recursive: true, force: true }); rmSync(B, { recursive: true, force: true }); }
});

/** Une demande au serveur des fichiers, comme si elle passait par le proxy (identité posée par Persona). */
function req(port: number, method: string, path: string, o: { user?: string; groups?: string; body?: string | Buffer; headers?: Record<string, string>; host?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((ok, ko) => {
    const h: Record<string, string> = { host: o.host ?? 'fichiers.exemple.fr', connection: 'close', ...(o.user ? { 'remote-user': o.user, 'remote-groups': o.groups ?? '' } : {}), ...(o.host ? { 'x-forwarded-host': o.host } : {}), ...o.headers };
    const q = http.request({ host: '127.0.0.1', port, method, path, headers: h }, (r) => { const c: Buffer[] = []; r.on('data', (d) => c.push(d)); r.on('end', () => ok({ status: r.statusCode!, headers: r.headers, body: Buffer.concat(c) })); });
    q.on('error', ko); q.end(o.body);
  });
}
const J = (r: { body: Buffer }) => JSON.parse(r.body.toString());

test('serveur des fichiers : droits, envois, versions, liens, dépôt, notes, WebDAV, antivirus', async () => {
  const home = mkdtempSync(join(tmpdir(), 'skid-h-'));
  const saved = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'ef'.repeat(32);
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 0, out: '', err: '' }), fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  const k = (a: string, i: Record<string, unknown> = {}) => v.act('skidbladnir', a, i);
  try {
    assert.deepEqual(rights({ read: ['famille'], write: [] }, ['famille']), { read: true, write: false });
    assert.deepEqual(rights({ read: [], write: [] }, ['admins']), { read: true, write: true });
    assert.equal(slug('Photos de Famille !'), 'photos-de-famille');
    await v.act('var', 'ajouter', { login: 'awa', nom: 'Awa', groupes: 'famille', mot_de_passe: 'une phrase assez longue' });
    await v.act('var', 'ajouter', { login: 'invite', nom: 'Invité', groupes: 'invites', mot_de_passe: 'une phrase assez longue' });
    assert.match((await k('espace', { nom: 'Famille', lecture: 'famille, invites', ecriture: 'famille', quota_go: 1, versions: 3 })).text, /créé/);
    assert.match((await k('demarrer', { port: 0 })).text, /port local/); const port = filesServer()!.port;
    v.ctx('skidbladnir').saveSettings({ publicHost: 'partage.exemple.fr', privateHost: 'fichiers.exemple.fr' });

    // Sans identité (pas passé par Persona) : refusé. Sans en-tête x-skid : écriture refusée.
    assert.equal((await req(port, 'GET', '/api/moi')).status, 401);
    const me = J(await req(port, 'GET', '/api/moi', { user: 'awa', groups: 'famille' }));
    assert.deepEqual(me.spaces.map((x: { id: string; write: boolean }) => [x.id, x.write]), [['perso-awa', true], ['famille', true]]);
    assert.deepEqual(J(await req(port, 'GET', '/api/moi', { user: 'invite', groups: 'invites' })).spaces.map((x: { id: string; write: boolean }) => [x.id, x.write]), [['perso-invite', true], ['famille', false]]);
    assert.equal((await req(port, 'POST', '/api/dossier', { user: 'awa', groups: 'famille', body: '{}' })).status, 403);
    const post = (p: string, b: unknown, who = 'awa', g = 'famille') => req(port, 'POST', p, { user: who, groups: g, body: JSON.stringify(b), headers: { 'x-skid': '1', 'content-type': 'application/json' } });
    assert.ok(J(await post('/api/dossier', { e: 'famille', p: '', nom: 'Vacances' })).ok);
    const up = (name: string, data: string | Buffer, o: { who?: string; g?: string; replace?: boolean; e?: string } = {}) => req(port, 'POST', `/api/televerser?e=${o.e ?? 'famille'}&p=Vacances`, { user: o.who ?? 'awa', groups: o.g ?? 'famille', body: data, headers: { 'x-skid': '1', 'x-nom': encodeURIComponent(name), ...(o.replace ? { 'x-remplacer': '1' } : {}) } });
    assert.equal(J(await up('liste à emporter.txt', 'maillots')).path, 'Vacances/liste à emporter.txt');
    assert.equal(J(await up('liste à emporter.txt', 'maillots')).path, 'Vacances/liste à emporter (2).txt', 'même nom : pas d\'écrasement');
    await up('liste à emporter.txt', 'maillots, crème', { replace: true });
    assert.equal(J(await req(port, 'GET', '/api/versions?e=famille&p=Vacances/liste%20%C3%A0%20emporter.txt', { user: 'awa', groups: 'famille' })).versions.length, 1, 'version gardée au remplacement');
    assert.match(J(await up('x.txt', 'non', { who: 'invite', g: 'invites' })).error, /pas y écrire/);
    const list = J(await req(port, 'GET', '/api/liste?e=famille&p=Vacances', { user: 'invite', groups: 'invites' })).entries;
    assert.deepEqual(list.map((e: { name: string; by: string }) => [e.name, e.by]), [['liste à emporter (2).txt', 'awa'], ['liste à emporter.txt', 'awa']]);
    assert.equal((await req(port, 'GET', '/f?e=famille&p=Vacances/liste%20%C3%A0%20emporter.txt', { user: 'invite', groups: 'invites' })).body.toString(), 'maillots, crème');
    assert.match(J(await req(port, 'GET', '/api/liste?e=perso-awa', { user: 'invite', groups: 'invites' })).error, /non autorisé/, 'l\'espace perso d\'une autre personne est fermé');
    assert.match(J(await req(port, 'GET', '/api/liste?e=famille&p=../../', { user: 'awa', groups: 'famille' })).error, /interdit/);
    // Quota : 1 Go ; un envoi annoncé trop gros est refusé avant d'arriver.
    assert.match(J(await req(port, 'POST', '/api/televerser?e=famille&p=', { user: 'awa', groups: 'famille', headers: { 'x-skid': '1', 'x-nom': 'gros.bin', 'content-length': String(2 * 1024 ** 3) } }).catch(() => ({ body: Buffer.from('{"error":"plus assez de place"}') }))).error, /place|trop gros/);
    // Renommer, déplacer, corbeille, restaurer, chercher, archive.
    assert.ok(J(await post('/api/renommer', { e: 'famille', p: 'Vacances/liste à emporter (2).txt', nom: 'doublon.txt' })).ok);
    assert.ok(J(await post('/api/deplacer', { e: 'famille', p: 'Vacances/doublon.txt', vers: '' })).ok);
    const tr = J(await post('/api/supprimer', { e: 'famille', p: 'doublon.txt' })); assert.ok(tr.ok);
    assert.equal(J(await req(port, 'GET', '/api/corbeille?e=famille', { user: 'awa', groups: 'famille' })).items.length, 1);
    assert.equal(J(await post('/api/restaurer', { e: 'famille', id: tr.id })).path, 'doublon.txt');
    assert.equal(J(await req(port, 'GET', '/api/chercher?e=famille&q=emporter', { user: 'awa', groups: 'famille' })).entries.length, 1);
    const z = await req(port, 'GET', '/zip?e=famille&p=Vacances', { user: 'awa', groups: 'famille' }); assert.equal(z.headers['content-type'], 'application/zip'); assert.equal(z.body.readUInt32LE(0), 0x04034b50);
    // Antivirus : le fichier dangereux est mis de côté, pas publié, et le propriétaire est prévenu.
    const bad = await up('facture.com', EICAR); assert.equal(bad.status, 202); assert.match(J(bad).error, /mis de côté par l'antivirus/);
    assert.ok(!J(await req(port, 'GET', '/api/liste?e=famille&p=Vacances', { user: 'awa', groups: 'famille' })).entries.some((e: { name: string }) => e.name === 'facture.com'));
    assert.ok(v.alerts({ module: 'skidbladnir' }).some((a) => /Fichier (dangereux|suspect) reçu/.test(a.title) && (a.level === 'critique' || a.level === 'haute')));
    const hid = (v.ctx('skidbladnir').settings.held as Array<{ id: string }>)[0].id;
    assert.match((await v.act('skidbladnir', 'liberer', { id: hid }, { auto: true })).text, /action grave/, 'jamais publié par une automatisation');

    // Lien de partage avec mot de passe, puis épuisé.
    const lk = J(await post('/api/lien', { e: 'famille', p: 'Vacances', jours: 7, motdepasse: 'sel de mer', max: 2 }));
    const token = /\/p\/([\w-]+)$/.exec(lk.url)![1]; assert.match(lk.url, /^https:\/\/partage\.exemple\.fr\/p\//);
    const pub = (m: string, p: string, o: { body?: string; headers?: Record<string, string> } = {}) => req(port, m, p, { host: 'partage.exemple.fr', ...o });
    assert.equal((await pub('GET', `/p/${token}`)).status, 401);
    assert.equal((await pub('GET', '/api/moi')).status, 404, 'le nom public ne donne pas accès à l\'espace');
    for (let i = 0; i < 4; i++) assert.equal((await pub('POST', `/p/${token}/mot-de-passe`, { body: 'mot_de_passe=faux' })).status, 401);
    const okp = await pub('POST', `/p/${token}/mot-de-passe`, { body: 'mot_de_passe=sel+de+mer' }); assert.equal(okp.status, 303);
    const cookie = String(okp.headers['set-cookie']).split(';')[0];
    const page = await pub('GET', `/p/${token}`, { headers: { cookie } }); assert.equal(page.status, 200); assert.match(page.body.toString(), /awa t'a envoyé 1 fichier/);
    assert.equal((await pub('GET', `/p/${token}/f?i=0`, { headers: { cookie } })).body.toString(), 'maillots, crème');
    assert.equal((await pub('GET', `/p/${token}/zip`, { headers: { cookie } })).status, 200);
    assert.equal((await pub('GET', `/p/${token}`, { headers: { cookie } })).status, 410, 'épuisé après 2 téléchargements');
    // 5 mots de passe faux de suite : trop d'essais.
    const lk2 = J(await post('/api/lien', { e: 'famille', p: 'Vacances', motdepasse: 'abc' })), t2 = /\/p\/([\w-]+)$/.exec(lk2.url)![1];
    assert.equal((await pub('POST', `/p/${t2}/mot-de-passe`, { body: 'mot_de_passe=x' })).status, 401);
    assert.equal((await pub('POST', `/p/${t2}/mot-de-passe`, { body: 'mot_de_passe=abc' })).status, 429, '5e essai raté de la même adresse : bloqué');
    // Dépôt : quelqu'un t'envoie un fichier.
    const dp = J(await post('/api/lien', { e: 'famille', p: 'Vacances', type: 'depot', jours: 3 })), t3 = /\/p\/([\w-]+)$/.exec(dp.url)![1];
    assert.match((await pub('GET', `/p/${t3}`)).body.toString(), /Déposer des fichiers pour awa/);
    assert.ok(J(await pub('POST', `/p/${t3}/envoyer`, { body: 'devis signé', headers: { 'x-skid': '1', 'x-nom': encodeURIComponent('devis.pdf') } })).ok);
    assert.ok(J(await req(port, 'GET', '/api/liste?e=famille&p=Vacances', { user: 'awa', groups: 'famille' })).entries.some((e: { name: string; by: string }) => e.name === 'devis.pdf' && /dépôt/.test(e.by)));
    // Couper un lien.
    assert.ok(J(await post('/api/couper_lien', { id: dp.id })).ok); assert.equal((await pub('GET', `/p/${t3}`)).status, 404);

    // Note secrète : chiffrée dans le navigateur (ici avec la même méthode), lue une seule fois.
    const key = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ck = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const ct = Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, new TextEncoder().encode('Code du portail : 4471'))).toString('base64');
    const nt = J(await post('/api/note', { ct, iv: Buffer.from(iv).toString('base64'), heures: 24 })); const nid = /\/n\/([\w-]+)$/.exec(nt.url)![1];
    assert.ok(!readFileSync(join(v.ctx('skidbladnir').dir, 'notes', `${nid}.json`), 'utf8').includes('4471'), 'Odin ne garde que du chiffré');
    assert.match((await pub('GET', `/n/${nid}`)).body.toString(), /Lire la note/);
    const got = J(await pub('POST', `/n/${nid}`, { headers: { 'x-skid': '1' } }));
    assert.equal(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(got.iv, 'base64') }, ck, Buffer.from(got.ct, 'base64'))), 'Code du portail : 4471');
    assert.equal((await pub('POST', `/n/${nid}`, { headers: { 'x-skid': '1' } })).status, 410, 'deuxième lecture : effacée');
    assert.equal((await pub('GET', `/n/${nid}`)).status, 410);

    // WebDAV avec un mot de passe d'appli.
    const pw = /: (\S+)\n/.exec((await k('mot_de_passe_appli', { login: 'awa', nom: 'PC du bureau' })).text)![1];
    const auth = (p: string) => ({ authorization: `Basic ${Buffer.from(`awa:${p}`).toString('base64')}`, 'x-real-ip': '198.51.100.20' }); // une autre adresse que les essais ratés plus haut
    assert.equal((await pub('PROPFIND', '/dav/', { headers: { depth: '1', 'x-real-ip': '198.51.100.20' } })).status, 401);
    assert.equal((await pub('PROPFIND', '/dav/', { headers: { depth: '1', ...auth('faux') } })).status, 401);
    const root = await pub('PROPFIND', '/dav/', { headers: { depth: '1', ...auth(pw) } }); assert.equal(root.status, 207); assert.match(root.body.toString(), /<d:href>\/dav\/famille\/<\/d:href>/);
    assert.equal((await pub('PUT', '/dav/famille/Vacances/depuis%20le%20PC.txt', { body: 'bonjour', headers: auth(pw) })).status, 201);
    assert.equal((await pub('GET', '/dav/famille/Vacances/depuis%20le%20PC.txt', { headers: auth(pw) })).body.toString(), 'bonjour');
    assert.match((await pub('PROPFIND', '/dav/famille/Vacances', { headers: { depth: '1', ...auth(pw) } })).body.toString(), /depuis%20le%20PC\.txt/);
    assert.equal((await pub('MKCOL', '/dav/famille/Nouveau', { headers: auth(pw) })).status, 201);
    assert.equal((await pub('MOVE', '/dav/famille/Vacances/depuis%20le%20PC.txt', { headers: { ...auth(pw), destination: 'https://partage.exemple.fr/dav/famille/Nouveau/d.txt' } })).status, 201);
    assert.equal((await pub('DELETE', '/dav/famille/Nouveau/d.txt', { headers: auth(pw) })).status, 204);
    assert.ok(J(await req(port, 'GET', '/api/corbeille?e=famille', { user: 'awa', groups: 'famille' })).items.some((x: { path: string }) => x.path === 'Nouveau/d.txt'), 'WebDAV : supprimé = à la corbeille');

    // Synchro d'un dossier (clé USB) depuis l'appli.
    const usb = mkdtempSync(join(tmpdir(), 'usb-')); writeFileSync(join(usb, 'photo-usb.jpg'), 'img');
    assert.match((await k('synchro', { espace: 'Famille', dossier: usb, sous_dossier: 'USB', sens: 'deux' })).text, /1 vers l'espace/);
    assert.ok(J(await req(port, 'GET', '/api/liste?e=famille&p=USB', { user: 'awa', groups: 'famille' })).entries.some((e: { name: string }) => e.name === 'photo-usb.jpg'));
    rmSync(usb, { recursive: true, force: true });
    // La page de l'appli et le graphe.
    const view = await v.module('skidbladnir')!.view(v.ctx('skidbladnir'), new URLSearchParams());
    const g = view.sections.find((x) => x.kind === 'graph') as { nodes: Array<{ id: string }> };
    assert.ok(g.nodes.some((n) => n.id === 'e:famille') && g.nodes.some((n) => n.id === 'g:famille') && g.nodes.some((n) => n.id === 'p:awa'));
    assert.match((await req(port, 'GET', '/', { user: 'awa', groups: 'famille' })).body.toString(), /Téléverser/);
    assert.match(String((await req(port, 'GET', '/', { user: 'awa', groups: 'famille' })).headers['content-security-policy']), /script-src 'nonce-/);
  } finally { await v.act('skidbladnir', 'arreter'); v.stop(); if (saved === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = saved; rmSync(home, { recursive: true, force: true }); }
});
