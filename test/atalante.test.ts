// Atalante : morceaux en parallèle, reprise après coupure, ETag qui change, débit, empreinte (juste, fausse,
// voisine), refus d'un site dangereux, quarantaine, rangement (Hydre, Hermès, par type), file chiffrée, historique
// sans paramètres, tâche des heures creuses dans Talos. Faux serveur local, faux Asclépios.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { tacheEnPause } from '../src/valhalla/automatismes.ts';
import { brancherGarde, type Passage } from '../src/valhalla/ullr/garde.ts';
import { decouper, telechargerMorceaux } from '../src/valhalla/atalante/morceaux.ts';
import { destinationDe } from '../src/valhalla/atalante/rangement.ts';
import { dansPlage } from '../src/valhalla/atalante/file.ts';
import { attendreAtalante, reseauAtalante } from '../src/valhalla/modules/atalante.ts';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const etat = { contenu: randomBytes(3 * 1024 * 1024 + 123), etag: '"v1"', modifie: '', ifRange: [] as string[], couper: 0, range: true, sums: false, requetes: 0 };
const petits: Record<string, Buffer> = { '/doc.pdf': Buffer.from('%PDF-1.4 bonjour'), '/image.iso': Buffer.from('CD001 image disque'), '/setup.exe': Buffer.from('MZ installateur'), '/eicar.txt': Buffer.from('fichier piégé'), '/musique.mp3': Buffer.from('ID3 son') };
const srv = createServer((req, res) => {
  const u = new URL(req.url!, 'http://x'); etat.requetes++;
  if (u.pathname === '/data.bin.sha256') { if (!etat.sums) { res.writeHead(404); res.end(); return; } res.end(`${sha(etat.contenu)}  data.bin\n`); return; }
  if (u.pathname === '/court') { res.writeHead(302, { location: 'http://malveillant.test/x.exe' }); res.end(); return; }
  const corps = u.pathname === '/data.bin' ? etat.contenu : petits[u.pathname];
  if (!corps) { res.writeHead(404); res.end(); return; }
  const m =/bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? ''));
  // If-Range comme le veut la norme : un validateur faible, ou différent, et la plage est ignorée (200, tout le fichier).
  const ir = req.headers['if-range'] as string | undefined;
  const plageOk = !ir || (!/^W\//.test(ir) && (ir === etat.etag || ir === etat.modifie));
  if (ir) etat.ifRange.push(ir);
  if (m && etat.range && plageOk) {
    const debut = Number(m[1]), fin = m[2] ? Number(m[2]) : corps.length - 1, part = corps.subarray(debut, fin + 1);
    res.writeHead(206, { 'content-range': `bytes ${debut}-${fin}/${corps.length}`, 'content-length': part.length, 'accept-ranges': 'bytes', ...(etat.etag ? { etag: etat.etag } : {}), ...(etat.modifie ? { 'last-modified': etat.modifie } : {}) });
    if (etat.couper > 0 && part.length > 1000) { etat.couper--; res.write(part.subarray(0, Math.floor(part.length / 2))); setTimeout(() => res.destroy(), 20); return; }
    res.end(part); return;
  }
  res.writeHead(200, { 'content-length': corps.length, ...(etat.etag ? { etag: etat.etag } : {}) }); res.end(corps);
});
let base = '';
const home = mkdtempSync(join(tmpdir(), 'atalante-'));
after(() => { srv.close(); brancherGarde(undefined); reseauAtalante(); rmSync(home, { recursive: true, force: true }); });
const local: typeof fetch = (u, i) => fetch(String(u).replace('http://dl.exemple.test', base), i);

test('découpage et plage d\'heures creuses', () => {
  assert.equal(decouper(500_000, 4).length, 1, 'petit fichier : un seul morceau');
  const d = decouper(10 * 1024 * 1024, 4); assert.equal(d.length, 4); assert.equal(d[0].debut, 0); assert.equal(d[3].fin, 10 * 1024 * 1024 - 1);
  assert.equal(decouper(100 * 1024 * 1024, 20).length, 8);
  assert.equal(dansPlage('02:00', { debut: '23:00', fin: '07:00' }), true); assert.equal(dansPlage('12:00', { debut: '23:00', fin: '07:00' }), false);
  assert.deepEqual(destinationDe('ubuntu.iso'), { vers: 'ymir' }); assert.deepEqual(destinationDe('setup.exe'), { vers: 'fjalar' });
  assert.deepEqual(destinationDe('a.pdf'), { vers: 'dossier', type: 'Documents' }); assert.deepEqual(destinationDe('a.zip'), { vers: 'dossier', type: 'Archives' });
});

test('morceaux : parallèle, coupure puis reprise, ETag qui change, sans Range, débit, empreinte', async () => {
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening'); base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const dir = mkdtempSync(join(tmpdir(), 'atalante-m-'));
  try {
    const url = 'http://dl.exemple.test/data.bin';
    // Coupure au milieu : erreur, morceaux gardés ; relancé, il reprend et le fichier est juste.
    etat.couper = 2;
    await assert.rejects(telechargerMorceaux(local, { url, nom: 'data.bin', dossier: dir, morceaux: 3 }));
    assert.ok(readdirSync(dir).some((f) => f.startsWith('.data.bin.part')), 'morceaux gardés');
    etat.couper = 0;
    const r = await telechargerMorceaux(local, { url, nom: 'data.bin', dossier: dir, morceaux: 3 });
    assert.equal(r.morceaux, 3); assert.equal(r.sha256, sha(etat.contenu)); assert.equal(sha(readFileSync(r.chemin)), sha(etat.contenu));
    assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith('.')), [], 'fichiers de travail effacés');
    rmSync(r.chemin);
    // ETag changé entre deux passages : repart de zéro, et le nouveau contenu est juste.
    etat.couper = 2;
    await assert.rejects(telechargerMorceaux(local, { url, nom: 'data.bin', dossier: dir, morceaux: 3 }));
    etat.couper = 0; etat.contenu = randomBytes(3 * 1024 * 1024 + 7); etat.etag = '"v2"';
    const r2 = await telechargerMorceaux(local, { url, nom: 'data.bin', dossier: dir, morceaux: 3 });
    assert.equal(r2.sha256, sha(etat.contenu)); rmSync(r2.chemin);
    // Empreinte de l'éditeur : juste (voisine), puis fausse (fichier supprimé).
    etat.sums = true;
    const r3 = await telechargerMorceaux(local, { url, nom: 'data.bin', dossier: dir }); assert.equal(r3.verifie, true); assert.equal(r3.empreinteDe, 'voisin'); rmSync(r3.chemin);
    etat.sums = false;
    await assert.rejects(telechargerMorceaux(local, { url, nom: 'data.bin', dossier: dir, empreinte: 'a'.repeat(64) }), /empreinte fausse/);
    assert.equal(existsSync(join(dir, 'data.bin')), false); assert.deepEqual(readdirSync(dir), []);
    // Serveur sans reprise : un seul flux (download de la forge).
    etat.range = false;
    const r4 = await telechargerMorceaux(local, { url, nom: 'data.bin', dossier: dir }); assert.equal(r4.morceaux, 1); assert.equal(r4.sha256, sha(etat.contenu)); rmSync(r4.chemin);
    etat.range = true;
    // Débit limité : 3 Mo à 6 Mo/s, au moins ~0,4 s.
    const t0 = Date.now(); const r5 = await telechargerMorceaux(local, { url, nom: 'data.bin', dossier: dir, debitMo: 6 }); rmSync(r5.chemin);
    assert.ok(Date.now() - t0 >= 350, `débit respecté (${Date.now() - t0} ms)`);
    // ETag faible (W/…) : jamais dans If-Range (le serveur renverrait tout, sans fin). Sans date : un seul flux, et ça marche.
    etat.etag = 'W/"x"'; etat.ifRange.length = 0;
    const r6 = await telechargerMorceaux(local, { url, nom: 'data.bin', dossier: dir, morceaux: 3 });
    assert.equal(r6.morceaux, 1); assert.equal(r6.sha256, sha(etat.contenu)); rmSync(r6.chemin);
    assert.ok(!etat.ifRange.some((x) => x.startsWith('W/')), 'jamais un ETag faible dans If-Range');
    // ETag faible mais date de modification : plusieurs morceaux, If-Range porte la date.
    etat.modifie = 'Mon, 16 Nov 2026 08:00:00 GMT';
    const r7 = await telechargerMorceaux(local, { url, nom: 'data.bin', dossier: dir, morceaux: 3 });
    assert.equal(r7.morceaux, 3); assert.equal(r7.sha256, sha(etat.contenu)); rmSync(r7.chemin);
    assert.ok(etat.ifRange.includes(etat.modifie), 'If-Range porte la date');
    // Ni ETag ni date : un seul flux (rien ne dirait si les morceaux mélangent deux versions).
    etat.etag = ''; etat.modifie = '';
    const r8 = await telechargerMorceaux(local, { url, nom: 'data.bin', dossier: dir, morceaux: 3 });
    assert.equal(r8.morceaux, 1); assert.equal(r8.sha256, sha(etat.contenu)); rmSync(r8.chemin);
    etat.etag = '"v2"';
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('dans Odin : site dangereux refusé, quarantaine, Hydre, Hermès, rangement, file chiffrée, heures creuses', async () => {
  reseauAtalante({ resoudre: async (h) => (h === 'dl.exemple.test' || h === 'malveillant.test' ? ['203.0.113.10'] : []) });
  brancherGarde(async (a): Promise<Passage> => {
    const mal = /eicar/.test(a.fichier ?? '');
    return { ok: !mal, bloque: mal, analyse: true, sha256: '0'.repeat(64), taille: 1, score: mal ? 100 : 0, pourquoi: mal ? ['essai'] : [], texte: mal ? 'menace d\'essai' : 'rien', gardien: 'asclepios', ...(mal ? { menace: 'Essai.Atalante' } : {}) };
  });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { notify: async () => {}, autonomy: () => 'equilibre', fetch: local } as never);
  const mod = (id: string) => v.modules().find((m) => m.id === id)!;
  const remplacer = (m: string, a: string, run: (i: Record<string, unknown>) => unknown) => { const act = mod(m).actions.find((x) => x.id === a)!, avant = act.run; act.run = (async (_c: unknown, i: Record<string, unknown>) => run(i)) as typeof act.run; return () => { act.run = avant; }; };
  const appels: string[] = [];
  const remettre = [
    remplacer('ullr', 'adresse', (i) => ({ text: '', data: /malveillant/.test(String(i.lien)) ? { connu: { what: 'malware' }, score: 100 } : { connu: undefined, score: 0 } })),
    remplacer('ymir', 'importer_iso', (i) => { appels.push(`ymir:${String(i.chemin).split(/[\\/]/).pop()}`); return { text: 'ISO rangée' }; }),
    remplacer('fjalar', 'importer_logiciel', (i) => { appels.push(`fjalar:${String(i.chemin).split(/[\\/]/).pop()}`); return { text: 'logiciel rangé' }; }),
  ];
  const ctx = v.ctx('atalante'), rangement = join(home, 'rangement'), evts: string[] = [];
  v.events.on('event', (e: { module: string; type: string }) => { if (e.module === 'atalante') evts.push(e.type); });
  try {
    ctx.saveSettings({ dossier: rangement });
    const refus = await v.act('atalante', 'ajouter', { lien: 'http://malveillant.test/x.exe' });
    assert.equal(refus.ok, false); assert.match(refus.text, /dangereux/);
    // Un lien propre qui redirige vers un site connu d'Asclépios : refusé au saut, rien n'est téléchargé.
    assert.equal((await v.act('atalante', 'ajouter', { lien: 'http://dl.exemple.test/court', nom: 'court.exe' })).ok, true, 'le premier lien est propre');
    await attendreAtalante();
    const court = (await v.act('atalante', 'file', {})).text;
    assert.match(court, /court\.exe · echec · .*dangereux/, court);
    assert.equal(existsSync(join(rangement, 'Autres', 'court.exe')), false);
    assert.ok(mod('atalante').actions.find((a) => a.id === 'ajouter')!.grave?.({ lien: 'http://192.168.1.5/f.iso' }), 'une adresse de la maison demande l\'accord');
    assert.equal(mod('atalante').actions.find((a) => a.id === 'ajouter')!.grave?.({ lien: 'http://dl.exemple.test/f.iso' }), undefined);
    for (const f of ['doc.pdf?sig=TRESSECRET', 'image.iso', 'setup.exe', 'eicar.txt', 'musique.mp3']) assert.equal((await v.act('atalante', 'ajouter', { lien: `http://dl.exemple.test/${f}` })).ok, true, f);
    await attendreAtalante();
    assert.ok(existsSync(join(rangement, 'Documents', 'doc.pdf')), 'rangé par type');
    assert.ok(existsSync(join(rangement, 'Musique', 'musique.mp3')));
    assert.deepEqual(appels.sort(), ['fjalar:setup.exe', 'ymir:image.iso']);
    assert.equal(existsSync(join(rangement, 'Autres', 'eicar.txt')), false, 'bloqué : pas rangé');
    assert.ok(evts.includes('bloque') && evts.includes('termine'));
    const file = readFileSync(join(ctx.dir, 'file.json'), 'utf8');
    assert.doesNotMatch(file, /dl\.exemple\.test|TRESSECRET/); assert.match(file, /odc1:/);
    const hist = readFileSync(join(ctx.dir, 'historique.jsonl'), 'utf8');
    assert.doesNotMatch(hist, /TRESSECRET|sig=/); assert.match(hist, /dl\.exemple\.test\/doc\.pdf/);
    // Heures creuses : la tâche est dans Talos, et sa pause est respectée.
    const id = 'tache:atalante:heures_creuses';
    assert.ok(v.automatismes.lignes().some((l) => l.id === id));
    assert.equal((await v.act('atalante', 'ajouter', { lien: 'http://dl.exemple.test/data.bin', nom: 'nuit.bin', heures_creuses: true })).ok, true);
    await attendreAtalante();
    assert.equal(existsSync(join(rangement, 'Autres', 'nuit.bin')), false, 'attend les heures creuses');
    assert.equal((v.automatismes.pause(id, true, { confirme: true }) as { ok: boolean }).ok, true); assert.equal(tacheEnPause('atalante', 'heures_creuses'), true);
    await v.act('atalante', 'heures_creuses'); await attendreAtalante();
    assert.equal(existsSync(join(rangement, 'Autres', 'nuit.bin')), false, 'en pause dans Talos : rien ne part');
    v.automatismes.pause(id, false);
    await v.act('atalante', 'heures_creuses'); await attendreAtalante();
    assert.ok(existsSync(join(rangement, 'Autres', 'nuit.bin')), 'heures creuses ouvertes : téléchargé');
    assert.doesNotMatch(JSON.stringify(await mod('atalante').view(ctx, new URLSearchParams())), /undefined|NaN|\[object Object\]/);
  } finally { for (const f of remettre) f(); v.stop(); }
});
