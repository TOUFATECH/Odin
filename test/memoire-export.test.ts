// Exporter toute la mémoire d'Odin (Réglages, propriétaire seul) : une archive .zip lisible partout, faite de fichiers
// texte ouverts (JSON lignes, JSON, Markdown) et d'un LISEZ-MOI qui décrit chaque fichier et chaque champ. Aucun secret :
// un secret posé exprès dans un souvenir, une leçon, une note du Cerveau, une conversation, un titre, un tour, une fiche
// de personne et une compétence n'apparaît nulle part dans l'archive (ni dans un contenu, ni dans un nom de fichier).
// Le texte reste du texte. Un vrai Odin d'essai, dans un dossier temporaire, sur un port libre, pour la route.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { Mnemosyne } from '../src/muninn/store.ts';
import { changerTour, ouvrirTour } from '../src/muninn/tours.ts';
import { Vault } from '../src/brain/vault.ts';
import { Athena } from '../src/yggdrasil/skills.ts';
import { Redactor } from '../src/heimdall/redact.ts';
import { DESCRIPTIONS, VERSION_FORMAT, decrire, exporterMemoire } from '../src/muninn/export-memoire.ts';
import { exportMemoireRoute } from '../src/web/export-memoire-api.ts';

// Les secrets posés exprès (fabriqués ici, pour qu'aucun ne soit écrit tel quel dans le dépôt).
const CONNU = ['coffre', 'Lanterne', '7391', 'quai'].join('-'); // une valeur connue du masqueur (comme une valeur du coffre)
const CLE = `sk-ant-${'Q7w'.repeat(12)}`; // une clé reconnue à sa forme
const CHIFFRE = `odc1:${Buffer.from('champ privé chiffré').toString('base64')}`; // un champ chiffré avec la clé de la machine
const SECRETS = [CONNU, CLE, CHIFFRE, 'odc1:'];
const PIEGE = '<img src=x onerror=alert(1)> **gras** ```fin```';

/** Lit une archive .zip (répertoire central, puis chaque fichier) ; vérifie la somme de contrôle et la taille. */
function dezipper(b: Buffer): Map<string, string> {
  const e = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(e >= 0, 'fin d\'archive trouvée');
  const n = b.readUInt16LE(e + 10), debut = b.readUInt32LE(e + 16), out = new Map<string, string>();
  let p = debut;
  for (let i = 0; i < n; i++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50, 'entrée du répertoire central');
    const flags = b.readUInt16LE(p + 8), methode = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), cs = b.readUInt32LE(p + 20), us = b.readUInt32LE(p + 24);
    const nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const nom = b.subarray(p + 46, p + 46 + nl).toString('utf8');
    assert.ok(flags & 0x0800, 'noms en UTF-8');
    assert.equal(b.readUInt32LE(off), 0x04034b50, 'en-tête local');
    const lnl = b.readUInt16LE(off + 26), lxl = b.readUInt16LE(off + 28), data = b.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + cs);
    const brut = methode === 8 ? inflateRawSync(data) : data;
    assert.equal(brut.length, us, `taille de ${nom}`); assert.equal(crc32(brut), crc, `somme de contrôle de ${nom}`);
    assert.ok(!out.has(nom), `un seul ${nom}`);
    out.set(nom, brut.toString('utf8'));
    p += 46 + nl + xl + cl;
  }
  return out;
}

function aucunSecret(fichiers: Map<string, string>): void {
  for (const [nom, texte] of fichiers) for (const s of SECRETS) {
    assert.ok(!nom.includes(s), `un secret dans le nom ${nom}`);
    assert.ok(!texte.includes(s), `un secret dans ${nom}`);
  }
}

/** Les clés d'un objet (et des messages d'une conversation) doivent toutes être décrites dans le LISEZ-MOI. */
function champsDecrits(nom: string, o: Record<string, unknown>): void {
  const d = decrire(nom); assert.ok(d?.champs, `${nom} a ses champs décrits`);
  for (const k of Object.keys(o)) assert.ok(k in d!.champs!, `champ « ${k} » de ${nom} décrit`);
  if (Array.isArray(o.messages)) for (const m of o.messages as Array<Record<string, unknown>>) for (const k of Object.keys(m)) assert.ok(`messages[].${k}` in d!.champs!, `champ messages[].${k} de ${nom} décrit`);
  if (Array.isArray(o.identites)) for (const m of o.identites as Array<Record<string, unknown>>) for (const k of Object.keys(m)) assert.ok(`identites[].${k}` in d!.champs!, `champ identites[].${k} de ${nom} décrit`);
}

/** Pose une mémoire complète (avec un secret dans chaque endroit) dans un dossier temporaire. */
function memoireDEssai(dir: string, masqueur: Redactor) {
  const mu = new Mnemosyne(join(dir, 'memoire'));
  mu.remember(`Le portail de la cour s'ouvre avec ${CONNU}`, 'owner', 'fact', 'maison', { subject: 'maison', topic: 'portail', source: 'conversation web' });
  mu.remember('La box Internet est au salon', 'agent', 'fact', 'reseau', { source: `outil ${CHIFFRE}` });
  mu.remember(`Ne jamais coller ${CLE} dans un message`, 'owner', 'lesson');
  mu.ensureSession('web:principal', 'web', 'principal'); mu.ensureSession('telegram:1001', 'telegram', '1001');
  mu.setKv('title:principal', `Réglages du portail ${CONNU}`);
  mu.addMessage('web:principal', { role: 'user', content: `voici la clé ${CLE}` });
  mu.addMessage('web:principal', { role: 'assistant', content: PIEGE });
  mu.addMessage('web:principal', { role: 'tool', content: 'sortie brute d\'un outil', toolName: 'shell' });
  mu.addMessage('telegram:1001', { role: 'user', content: `bonjour, mot de passe : ${CONNU}` });
  const u = mu.saveUser({ name: 'Camille', role: 'member' });
  mu.linkIdentity('telegram', '1001', u.id);
  mu.ecrireNotePersonne(u.id, `Camille garde le double des clés (${CONNU})`);
  const t = ouvrirTour(mu.dir!, { qui: 'propriétaire', role: 'humain', canal: 'web', fil: 'web:principal', but: `ouvre le portail avec ${CONNU}` });
  changerTour(mu.dir!, t.id, 'réussi', { agent: 'odin-local' });
  const cerveau = new Vault(join(dir, 'cerveau'));
  mkdirSync(join(dir, 'cerveau', 'Projets'), { recursive: true });
  writeFileSync(join(dir, 'cerveau', 'Projets', 'Jardin.md'), `---\ntype: projet\n---\n# Jardin\nCode du cadenas : ${CONNU}\n${CHIFFRE}\n`);
  writeFileSync(join(dir, 'cerveau', 'Idée libre.md'), 'Une idée, avec [[Jardin]].\n');
  const skills = new Athena(join(dir, 'skills'), join(dir, 'skills', '_drafts'));
  mkdirSync(join(dir, 'skills', 'arroser'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'arroser', 'SKILL.md'), `---\nname: arroser\ndescription: Arroser le jardin\nversion: 2\norigin: human\nstatus: active\nsig: ${'e'.repeat(64)}\n---\n\nOuvrir la vanne avec ${CONNU}.\n`);
  skills.propose({ name: 'tailler', description: 'Tailler la haie', body: 'Une fois par mois.', reason: 'demandé' });
  return { mu, cerveau, skills, masquer: (x: string) => masqueur.redact(x), tour: t.id };
}

// ---------------------------------------------------------------- l'archive, sans serveur

test('l\'archive : chaque sorte de mémoire, chaque fichier et chaque champ décrits, aucun secret, le texte reste du texte', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-export-memoire-'));
  try {
    const masqueur = new Redactor(); masqueur.add(CONNU);
    const s = memoireDEssai(dir, masqueur);
    const morceaux: Buffer[] = [];
    const bilan = await exporterMemoire({ mu: s.mu, cerveau: s.cerveau, competences: s.skills, masquer: s.masquer, maintenant: Date.UTC(2026, 10, 19, 10, 0) }, (b) => { morceaux.push(b); });
    const zip = Buffer.concat(morceaux), f = dezipper(zip);
    assert.ok(morceaux.length > f.size, 'écrite en flux, fichier par fichier (pas en un seul bloc)');
    assert.equal(bilan.fichiers, f.size); assert.equal(bilan.octets, zip.length);
    const noms = [...f.keys()].sort();
    for (const attendu of ['LISEZ-MOI.md', 'souvenirs.jsonl', 'lecons.jsonl', 'personnes.jsonl', 'tours.jsonl', 'cerveau/Projets/Jardin.md', 'cerveau/Idée libre.md', 'competences/arroser/SKILL.md', 'competences/_brouillons/tailler/SKILL.md'])
      assert.ok(noms.includes(attendu), `${attendu} dans l'archive (${noms.join(', ')})`);
    assert.equal(noms.filter((n) => n.startsWith('conversations/') && n.endsWith('.json')).length, 2, 'les deux conversations, en JSON');
    assert.equal(noms.filter((n) => n.startsWith('conversations/') && n.endsWith('.md')).length, 2, 'et en Markdown');
    // Chaque fichier est décrit, et le LISEZ-MOI porte la version du format, la date et chaque description.
    const lisez = f.get('LISEZ-MOI.md')!;
    for (const n of noms) assert.ok(decrire(n), `${n} est décrit`);
    assert.match(lisez, new RegExp(`Version du format : ${VERSION_FORMAT}\\b`)); assert.match(lisez, /2026-11-19T10:00:00\.000Z/);
    for (const d of DESCRIPTIONS) { assert.ok(lisez.includes(d.fichier), `${d.fichier} dans le LISEZ-MOI`); for (const c of Object.keys(d.champs ?? {})) assert.ok(lisez.includes(`\`${c}\``), `champ ${c} dans le LISEZ-MOI`); }
    // Chaque champ de chaque ligne est décrit.
    const lignes = (n: string) => f.get(n)!.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    for (const n of ['souvenirs.jsonl', 'lecons.jsonl', 'personnes.jsonl', 'tours.jsonl']) for (const o of lignes(n)) champsDecrits(n, o);
    for (const n of noms.filter((x) => x.endsWith('.json'))) champsDecrits(n, JSON.parse(f.get(n)!));
    // Le contenu : souvenirs (avec leur source et leurs dates), leçons à part, personnes sans secret, tours.
    const souv = lignes('souvenirs.jsonl');
    assert.equal(souv.length, 2); assert.ok(souv.every((x) => x.kind !== 'lesson'));
    assert.equal(souv.find((x) => x.subject === 'maison')?.source, 'conversation web');
    assert.match(String(souv[0].created_at), /^\d{4}-\d{2}-\d{2}T/); assert.match(String(souv[0].last_used_at), /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(lignes('lecons.jsonl').length, 1);
    const pers = lignes('personnes.jsonl'); assert.equal(pers.length, 1); assert.equal(pers[0].nom, 'Camille');
    assert.deepEqual(pers[0].identites, [{ canal: 'telegram', pair: '1001', partage: false }]);
    const tours = lignes('tours.jsonl'); assert.equal(tours.length, 1); assert.equal(tours[0].id, s.tour); assert.equal(tours[0].etat, 'réussi'); assert.equal(tours[0].agent, 'odin-local');
    // Les conversations : ni sortie d'outil ; le texte exact en JSON ; en Markdown, dans un bloc de code (jamais interprété).
    const conv = noms.filter((n) => n.startsWith('conversations/') && n.endsWith('.json')).map((n) => JSON.parse(f.get(n)!) as { id: string; title: string; messages: Array<{ role: string; content: string }> });
    const princ = conv.find((c) => c.id === 'web:principal')!;
    assert.deepEqual(princ.messages.map((m) => m.role), ['user', 'assistant'], 'pas de sortie d\'outil');
    assert.equal(princ.messages[1].content, PIEGE, 'le texte exact');
    assert.match(princ.title, /^Réglages du portail /, 'le titre donné par le propriétaire');
    const md = f.get(noms.find((n) => n.startsWith('conversations/') && n.endsWith('.md') && f.get(n)!.includes('alert(1)'))!)!;
    const blocs = [...md.matchAll(/\n(`{4,})\n([\s\S]*?)\n\1\n/g)].map((b) => b[2]);
    assert.ok(blocs.includes(PIEGE),'le message piège est dans un bloc de code plus long que ses propres accents graves');
    for (const t of Object.values(Object.fromEntries(f))) assert.ok(!t.includes('sortie brute d\'un outil'));
    // Les compétences : sans leur signature (empreinte faite avec la clé de la machine).
    assert.ok(!f.get('competences/arroser/SKILL.md')!.includes('sig:'));
    assert.match(f.get('competences/arroser/SKILL.md')!, /Ouvrir la vanne avec \[SECRET\]/);
    // Aucun secret, nulle part.
    aucunSecret(f);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('la route seule : le propriétaire dans son navigateur, rien d\'autre (membre, clé d\'API, port direct, autre site)', async () => {
  const mu = new Mnemosyne(':memory:'); mu.remember('un souvenir', 'owner');
  const appeler = async (o: { qui?: { proprio: true } | { login: string }; direct?: string; entetes?: Record<string, string>; methode?: string; chemin?: string }) => {
    let statut = 0; const parts: Buffer[] = []; let entetes: Record<string, string> = {};
    const res = { writeHead: (c: number, h?: Record<string, string>) => { statut = c; entetes = h ?? {}; return res; }, write: (b: Buffer) => { parts.push(Buffer.from(b)); return true; }, end: (b?: string | Buffer) => { if (b) parts.push(Buffer.from(b)); }, once: () => res, destroy: () => {} };
    const req = { method: o.methode ?? 'GET', headers: { 'x-odin': '1', ...(o.entetes ?? {}) } };
    const vu = await exportMemoireRoute(req as never, res as never, new URL(o.chemin ?? '/api/memoire/export', 'http://odin.example.org'), { qui: () => o.qui, direct: o.direct, sources: () => ({ mu, masquer: (t) => t }) });
    return { vu, statut, entetes, corps: Buffer.concat(parts) };
  };
  const ok = await appeler({ qui: { proprio: true } });
  assert.equal(ok.statut, 200); assert.equal(ok.entetes['content-type'], 'application/zip');
  assert.match(ok.entetes['content-disposition'], /^attachment; filename="memoire-odin-\d{4}-\d{2}-\d{2}\.zip"$/);
  assert.equal(ok.entetes['x-content-type-options'], 'nosniff'); assert.equal(ok.entetes['cache-control'], 'no-store');
  assert.ok(dezipper(ok.corps).has('souvenirs.jsonl'));
  for (const [cas, o] of [
    ['un membre', { qui: { login: 'camille' } }],
    ['personne', {}],
    ['le port direct d\'une appli', { qui: { proprio: true }, direct: 'var' }],
    ['la clé d\'API', { qui: { proprio: true }, entetes: { authorization: 'Bearer abc' } }],
    ['sans l\'en-tête de l\'interface', { qui: { proprio: true }, entetes: { 'x-odin': '' } }],
    ['depuis un autre site', { qui: { proprio: true }, entetes: { 'sec-fetch-site': 'cross-site' } }],
  ] as const) {
    const r = await appeler(o as Parameters<typeof appeler>[0]);
    assert.equal(r.statut, 403, cas); assert.ok(!r.corps.toString('latin1').includes('souvenir'), `${cas} : rien de la mémoire`);
  }
  assert.equal((await appeler({ qui: { proprio: true }, methode: 'POST' })).statut, 405, 'lecture seule');
  assert.equal((await appeler({ qui: { proprio: true }, chemin: '/api/memoire/autre' })).vu, false, 'une autre adresse n\'est pas la sienne');
});

// ---------------------------------------------------------------- la route, dans un vrai Odin d'essai

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '';
const MDP = 'une-lanterne-verte-au-bout-du-quai-41';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';

/** La connexion d'une personne de Persona à l'interface d'Odin, comme un navigateur : rend le cookie de sa session. */
async function entrer(o: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${o.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, o.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${o.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: o.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => m.id === 'var') });
  v.o.cfg.web.portsParAppli = false;
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-e', nom: 'Membre E', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  assert.equal((await va.act('var', 'donner_acces', { appli: 'odin', qui: '@membre-e' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer(v, 'membre-e', MDP); assert.ok(membre);
  v.o.redactor.add(CONNU);
  const mu = v.o.muninn;
  mu.remember(`Le portail s'ouvre avec ${CONNU}`, 'owner', 'fact', '', { source: 'conversation web' });
  mu.ensureSession('web:principal', 'web', 'principal');
  mu.addMessage('web:principal', { role: 'user', content: `bonjour ${CLE}` });
  mu.addMessage('web:principal', { role: 'assistant', content: PIEGE });
  ouvrirTour(mu.dir!, { qui: 'propriétaire', role: 'humain', canal: 'web', fil: 'web:principal', but: `bonjour ${CONNU}` });
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('GET /api/memoire/export : le propriétaire reçoit l\'archive ; un membre, une clé, une visite, un autre site : rien', async () => {
  const r = await fetch(`${v.url}/api/memoire/export`, { headers: { cookie: v.session, 'x-odin': '1' } });
  assert.equal(r.status, 200, await r.clone().text().catch(() => ''));
  assert.equal(r.headers.get('content-type'), 'application/zip'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const f = dezipper(Buffer.from(await r.arrayBuffer()));
  assert.ok(f.has('LISEZ-MOI.md') && f.has('souvenirs.jsonl') && f.has('tours.jsonl'));
  assert.match(f.get('souvenirs.jsonl')!, /Le portail s'ouvre avec \[SECRET\]/);
  assert.ok([...f.values()].some((t) => t.includes(JSON.stringify(PIEGE))), 'le texte exact, en JSON');
  aucunSecret(f);
  const refus = async (cas: string, h: Record<string, string>, attendu: number) => {
    const x = await fetch(`${v.url}/api/memoire/export`, { headers: h, redirect: 'manual' });
    const corps = Buffer.from(await x.arrayBuffer()).toString('latin1');
    assert.equal(x.status, attendu, cas); assert.ok(!corps.includes('portail') && !corps.includes('PK'), `${cas} : rien de la mémoire`);
  };
  await refus('un membre', { cookie: membre, 'x-odin': '1' }, 403);
  await refus('la clé d\'API', { authorization: `Bearer ${v.token}`, 'x-odin': '1' }, 403);
  await refus('une clé inconnue (tablette)', { authorization: 'Bearer cle-de-tablette-inconnue', 'x-odin': '1' }, 401);
  await refus('une visite', { 'x-odin': '1' }, 401);
  await refus('un lien ouvert depuis un autre site', { cookie: v.session, 'x-odin': '1', 'sec-fetch-site': 'cross-site' }, 403);
  await refus('sans l\'en-tête de l\'interface', { cookie: v.session }, 403);
});

// ---------------------------------------------------------------- un navigateur qui coupe, un navigateur lent, le bouton

/** Une mémoire faite de conversations au texte peu compressible (pour remplir la ligne vers le navigateur). */
function grosseMemoire(n: number, taille: number): Mnemosyne {
  const mu = new Mnemosyne(':memory:');
  for (let i = 0; i < n; i++) { const id = `web:c-${i}`; mu.ensureSession(id, 'web', `c-${i}`); mu.addMessage(id, { role: 'user', content: randomBytes(taille).toString('base64') }); }
  return mu;
}

test('un téléchargement coupé par le navigateur : l\'export s\'arrête au lieu de rester suspendu', async () => {
  const mu = grosseMemoire(120, 150_000);
  let fini: Promise<boolean> | undefined;
  const srv = createServer((req, res) => { fini = exportMemoireRoute(req, res, new URL(req.url!, 'http://odin.example.org'), { qui: () => ({ proprio: true }), sources: () => ({ mu, masquer: (t) => t }) }); });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  let minuterie: NodeJS.Timeout | undefined;
  try {
    const ac = new AbortController();
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/memoire/export`, { headers: { 'x-odin': '1' }, signal: ac.signal });
    assert.equal(r.status, 200);
    await r.body!.getReader().read(); ac.abort(); // le navigateur lit un morceau, puis coupe
    const issue = await Promise.race([fini!.then(() => 'fini'), new Promise<string>((ok) => { minuterie = setTimeout(ok, 15_000, 'suspendu'); })]);
    assert.equal(issue, 'fini', 'l\'export se termine (il ne garde pas la mémoire copiée pour toujours)');
  } finally { clearTimeout(minuterie); srv.closeAllConnections(); srv.close(); }
});

test('un navigateur lent : chaque attente retire ses écouteurs (aucun ne s\'accumule)', async () => {
  const mu = grosseMemoire(30, 2_000);
  const res = Object.assign(new EventEmitter(), {
    destroyed: false, ecrits: 0,
    writeHead() { return res; },
    write() { res.ecrits++; setImmediate(() => res.emit('drain')); return false; }, // il prend chaque morceau, mais lentement
    end() { setImmediate(() => res.emit('close')); },
    destroy() { res.destroyed = true; },
  });
  const avert: string[] = [], surAvert = (w: Error) => { avert.push(w.name); };
  process.on('warning', surAvert);
  try {
    assert.equal(await exportMemoireRoute({ method: 'GET', headers: { 'x-odin': '1' } } as never, res as never, new URL('http://odin.example.org/api/memoire/export'), { qui: () => ({ proprio: true }), sources: () => ({ mu, masquer: (t) => t }) }), true);
    await new Promise((ok) => setImmediate(ok));
    assert.ok(res.ecrits > 20, 'beaucoup d\'attentes');
    assert.equal(res.destroyed, false, 'l\'archive est allée au bout');
    assert.equal(res.listenerCount('drain'), 0, 'plus aucun écouteur « drain »');
    assert.ok(res.listenerCount('close') <= 1, `écouteurs « close » : ${res.listenerCount('close')}`);
    assert.deepEqual(avert.filter((n) => n === 'MaxListenersExceededWarning'), []);
  } finally { process.off('warning', surAvert); }
});

test('pendant l\'export, Odin reste disponible : la compression ne bloque pas le reste', async () => {
  const mu = grosseMemoire(1, 3_000_000);
  let tours = 0, actif = true;
  const tic = () => { if (actif) { tours++; setImmediate(tic); } };
  setImmediate(tic);
  try { await exporterMemoire({ mu, masquer: (t) => t }, () => {}); } finally { actif = false; }
  assert.ok(tours > 0, 'Odin a pu faire autre chose pendant la compression');
});

test('le LISEZ-MOI dit la vérité : les secrets RECONNUS sont masqués, et toutes les conversations gardées partent', async () => {
  const parts: Buffer[] = [];
  await exporterMemoire({ mu: new Mnemosyne(':memory:'), masquer: (t) => t }, (b) => { parts.push(b); });
  const l = dezipper(Buffer.concat(parts)).get('LISEZ-MOI.md')!;
  assert.doesNotMatch(l, /^Aucun secret\b/m, 'pas de promesse absolue');
  assert.match(l, /secrets reconnus/); assert.match(l, /relis/i, 'un secret non reconnu peut rester : il est prévenu');
  assert.match(l, /membres/); assert.match(l, /invités/); assert.match(l, /mode privé/);
});

test('le bouton des Réglages : occupé pendant l\'export, l\'état écrit à côté (prête, refusée, coupée en route, injoignable)', async () => {
  const ui = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
  assert.match(ui, /id="vo-exportMem"[^>]*aria-describedby="vo-memQuoi"/, 'le bouton est décrit par une ligne visible');
  assert.match(ui, /<p class="sub" id="vo-memQuoi"[^>]*>[^<]*souvenirs/i, 'ce qui part, écrit en clair (pas seulement en infobulle)');
  assert.match(ui, /class="status" id="vo-memEtat" role="status"/, 'un état à côté du bouton');
  assert.match(ui, /\$\('#vo-exportMem'\)\.addEventListener\('click', \(e\) => exporterMemoireUI\(e\.currentTarget, \(t, ok\) => st\('#vo-memEtat', t, ok\)\)\)/);
  const i = ui.indexOf('async function exporterMemoireUI('); assert.ok(i >= 0, 'la fonction du bouton');
  let j = ui.indexOf('{', i), prof = 0;
  for (; j < ui.length; j++) { if (ui[j] === '{') prof++; else if (ui[j] === '}' && --prof === 0) break; }
  const source = ui.slice(i, j + 1);
  const essayer = async (reponse: () => Promise<Response>, dejaOccupe = false) => {
    const etats: Array<[string, boolean | undefined]> = [], cliques: string[] = [];
    const b = { disabled: dejaOccupe, attrs: new Map<string, string>(), setAttribute(k: string, x: string) { this.attrs.set(k, x); }, removeAttribute(k: string) { this.attrs.delete(k); } };
    let appels = 0, occupePendant = false;
    const fetchF = async () => { appels++; occupePendant = b.disabled && b.attrs.get('aria-busy') === 'true'; return reponse(); };
    const el = (_t: string, a: Record<string, string>) => ({ ...a, click() { cliques.push(a.download); }, remove() {} });
    const fn = new Function('fetch', 'el', 'document', 'URL', 'setTimeout', `${source}; return exporterMemoireUI;`)(fetchF, el, { body: { append() {} } }, { createObjectURL: () => 'blob:essai', revokeObjectURL() {} }, () => 0);
    await fn(b, (t: string, ok?: boolean) => { etats.push([t, ok]); });
    return { etats, cliques, appels, occupePendant, occupeApres: b.disabled, occupeAttr: b.attrs.has('aria-busy') };
  };
  const ok = await essayer(async () => new Response(new Blob(['PK']), { headers: { 'content-disposition': 'attachment; filename="memoire-odin-2026-11-19.zip"' } }));
  assert.equal(ok.occupePendant, true, 'bouton désactivé pendant l\'export'); assert.equal(ok.occupeApres, false); assert.equal(ok.occupeAttr, false);
  assert.equal(ok.etats[0][1], undefined, 'l\'état « en cours » d\'abord'); assert.ok(ok.etats[0][0]);
  assert.deepEqual(ok.cliques, ['memoire-odin-2026-11-19.zip']); assert.equal(ok.etats.at(-1)![1], true);
  const refus = await essayer(async () => new Response(JSON.stringify({ ok: false, error: 'Réservé au propriétaire.' }), { status: 403 }));
  assert.deepEqual(refus.etats.at(-1), ['Réservé au propriétaire.', false]); assert.deepEqual(refus.cliques, []); assert.equal(refus.occupeApres, false);
  const coupe = await essayer(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0x50, 0x4b])); c.error(new Error('coupé')); } })));
  assert.equal(coupe.etats.at(-1)![1], false, 'une archive coupée en route est dite, pas enregistrée'); assert.deepEqual(coupe.cliques, []); assert.equal(coupe.occupeApres, false);
  const loin = await essayer(async () => { throw new TypeError('réseau'); });
  assert.equal(loin.etats.at(-1)![1], false); assert.equal(loin.occupeApres, false);
  const double = await essayer(async () => new Response('PK'), true);
  assert.equal(double.appels, 0, 'un second clic pendant l\'export ne relance rien');
});
