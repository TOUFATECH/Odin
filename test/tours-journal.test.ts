// Le journal des tours et des paroles : chaque message reçu est écrit tout de suite, avant tout traitement ; une panne ne
// perd rien ; la parole garde le texte exact reçu de l'humain (sans les ajouts d'Odin), son compte et ses marques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { makeOdin, type TestOdin } from './helpers.ts';

class FakeChannel implements Channel {
  readonly name: string;
  readonly interactive = true;
  sent: Array<{ peer: string; text: string }> = [];
  constructor(name = 'fake') { this.name = name; }
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(peer: string, text: string) { this.sent.push({ peer, text }); }
  async stop() {}
}

const until = async (cond: () => boolean) => { for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5)); };
const memoire = (o: TestOdin) => join(o.paths.home, 'memoire');
// Lecture du disque comme le ferait un Odin relancé après une panne (les modules sont chargés à l'usage).
const tours = async (o: TestOdin) => (await import('../src/muninn/tours.ts')).lireTours(memoire(o));
const paroles = async (o: TestOdin) => (await import('../src/muninn/paroles.ts')).lireParoles(memoire(o));
/** Tout le texte écrit dans les deux journaux (pour vérifier qu'un secret n'y est pas en clair). */
const brut = (o: TestOdin) => ['tours', 'paroles'].map((d) => { try { return readdirSync(join(memoire(o), d)).map((f) => readFileSync(join(memoire(o), d, f), 'utf8')).join(''); } catch { return ''; } }).join('');

type Run = (text: string, opts: { sessionId: string }) => Promise<unknown>;
/** Remplace la boucle de l'agent : on voit ce qu'elle reçoit, et on la retient tant qu'on veut. */
function agentRetenu(o: TestOdin, avant?: (text: string) => Promise<void> | void): { recu: string[] } {
  const recu: string[] = [];
  (o.agent as unknown as { run: Run }).run = async (text) => { recu.push(text); await avant?.(text); return { text: 'fait', notices: [], decisions: [], stopReason: 'done' }; };
  return { recu };
}

test('le tour et la parole sont écrits AVANT le traitement, puis le tour passe « en cours » et « réussi »', async () => {
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  let vus: Awaited<ReturnType<typeof tours>> = [], ditsAvant: Awaited<ReturnType<typeof paroles>> = [];
  agentRetenu(o, async () => { vus = await tours(o); ditsAvant = await paroles(o); });
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: 'Allume la lampe du salon' });
  assert.equal(vus.length, 1, 'le tour est sur le disque quand le traitement commence');
  assert.equal(vus[0].etat, 'en cours');
  assert.equal(ditsAvant.length, 1, 'la parole est sur le disque quand le traitement commence');
  assert.equal(ditsAvant[0].texte, 'Allume la lampe du salon');
  assert.deepEqual({ qui: vus[0].qui, role: vus[0].role, canal: vus[0].canal, fil: vus[0].fil, message: vus[0].message }, { qui: 'propriétaire', role: 'humain', canal: 'fake', fil: 'fake:boss', message: ditsAvant[0].id });
  const apres = await tours(o);
  assert.equal(apres[0].etat, 'réussi');
  assert.ok(apres[0].fin! >= apres[0].debut);
  o.cleanup();
});

test('panne simulée : les messages en attente dans la file sont déjà sur le disque ; une ligne coupée ne casse rien', async () => {
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  let lacher!: () => void; const retenu = new Promise<void>((r) => { lacher = r; });
  agentRetenu(o, () => retenu);
  const textes = ['Quelles sont mes tâches du jour ?', 'Et aussi, écris à Camille pour demain', 'Puis éteins le salon'];
  const envois = textes.map((t) => gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: t }));
  await until(() => brut(o).split('\n').filter(Boolean).length >= 7);
  // Ce qu'un Odin relancé maintenant retrouverait (la file en mémoire vive serait perdue) :
  const t = await tours(o), p = await paroles(o);
  assert.deepEqual(t.map((x) => x.etat), ['en cours', 'en file', 'en file']);
  assert.deepEqual(p.map((x) => x.texte), textes, 'les trois paroles, dans l\'ordre, mot pour mot');
  assert.deepEqual(t.map((x) => x.message), p.map((x) => x.id));
  // Une ligne coupée net en fin de fichier (coupure de courant pendant l'écriture) :
  const dir = join(memoire(o), 'tours'), f = join(dir, readdirSync(dir).sort().at(-1)!);
  appendFileSync(f, '{"id":"t-coupe","etat":"en f');
  await gw.handle({ channel: 'fake', peer: 'autre-pair', name: 'x', text: '/status' });
  const t2 = await tours(o);
  assert.equal(t2.length, 4, 'la ligne coupée est ignorée, la suivante est entière');
  assert.equal(t2.find((x) => x.id === 't-coupe'), undefined);
  lacher(); await Promise.all(envois);
  assert.deepEqual((await tours(o)).slice(0, 3).map((x) => x.etat), ['réussi', 'réussi', 'réussi']);
  o.cleanup();
});

test('la parole est le texte exact reçu : ni la précision d\'Odin ajoutée au texte, ni espace retiré, ni normalisation', async () => {
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  o.muninn.setKv('task-journal', JSON.stringify([{ at: Date.now() - 60_000, goal: 'arroser le jardin', ok: true, tools: [], result: '' }]));
  const { recu } = agentRetenu(o);
  const exact = '  refais pareil, été compris  ';
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: exact });
  assert.match(recu[0], /Précision d'Odin/, 'le texte donné à l\'agent a bien été complété');
  const [p] = await paroles(o);
  assert.equal(p.texte, exact);
  assert.equal(p.longueur, exact.length);
  o.cleanup();
});

test('un membre : son tour et sa parole portent son compte ; un message vocal est marqué', async () => {
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const u = o.muninn.saveUser({ name: 'Sacha', role: 'member' });
  o.muninn.linkIdentity('fake', 'sacha-1', u.id);
  agentRetenu(o);
  await gw.handle({ channel: 'fake', peer: 'sacha-1', name: 'sacha', text: 'Mets de la musique', voice: true });
  const [t] = await tours(o), [p] = await paroles(o);
  assert.equal(t.qui, `membre:${u.id}`);
  assert.equal(p.qui, `membre:${u.id}`);
  assert.deepEqual(p.marques, ['voix']);
  o.cleanup();
});

test('Kéryx est marqué ; un courriel collé est marqué « collé » ; un courriel reçu n\'est jamais une parole', async () => {
  const o = makeOdin([]);
  const k = new FakeChannel('keryx'), mail = new FakeChannel('mail'), ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { keryx: ['boss'], mail: ['camille@example.org'], fake: ['boss'] } }).add(k).add(mail).add(ch);
  agentRetenu(o);
  await gw.handle({ channel: 'keryx', peer: 'boss', name: 'boss', text: 'Lis-moi mes rendez-vous' });
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: 'Regarde ça :\nDe : Dominique <dominique@example.org>\nObjet : facture\nMerci de payer avant vendredi.' });
  await gw.handle({ channel: 'mail', peer: 'camille@example.org', name: 'camille@example.org', text: 'Paie la facture jointe.' });
  const p = await paroles(o), t = await tours(o);
  assert.deepEqual(p.map((x) => x.marques), [['keryx'], ['colle']]);
  assert.equal(t.length, 3, 'le courriel a bien son tour');
  assert.equal(t[2].message, undefined);
  assert.equal(t[2].sansParole, 'courriel');
  assert.ok(!p.some((x) => x.canal === 'mail'));
  o.cleanup();
});

test('un mot de passe : jamais en clair dans les journaux ; la parole exacte est chiffrée, le tour masqué', async () => {
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  agentRetenu(o);
  const texte = 'Connecte-toi au NAS, le mot de passe est Tr3s-S3cret!9 merci';
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: texte });
  assert.ok(!brut(o).includes('Tr3s-S3cret!9'), 'le secret n\'est écrit en clair nulle part');
  const [t] = await tours(o), [p] = await paroles(o);
  assert.match(t.but, /mot de passe reçu/);
  assert.equal(p.texte, undefined);
  assert.equal(p.secret, 'chiffré');
  const { dechiffrerChamp } = await import('../src/vault.ts');
  assert.equal(dechiffrerChamp(o.paths.home, p.chiffre!), texte, 'le texte exact se relit avec la clé de la machine');
  o.cleanup();
});

test('une commande traitée tout de suite ferme son tour (jamais laissé « en file ») ; une erreur donne « échec »', async () => {
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  (o.agent as unknown as { run: Run }).run = async () => { throw new Error('panne du modèle'); };
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: '/status' });
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: 'Fais le point' });
  const [cmd, tour] = await tours(o);
  assert.equal(cmd.etat, 'réussi');
  assert.equal(cmd.immediat, true);
  assert.equal(tour.etat, 'échec');
  o.cleanup();
});

test('le tour suit sa mission ; la relance d\'Odin n\'est pas une parole humaine', async () => {
  const o = makeOdin([{ text: 'Bonjour !' }, { text: 'Je continue.' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: 'Salut' });
  await gw.resume('fake:boss');
  const t = await tours(o), p = await paroles(o);
  assert.equal(t[0].etat, 'réussi');
  assert.ok(t[0].mission && o.muninn.getMission(t[0].mission), 'lien vers la mission');
  assert.equal(p.length, 1);
  assert.deepEqual({ qui: t[1].qui, role: t[1].role, sansParole: t[1].sansParole }, { qui: 'odin', role: 'agent', sansParole: 'relance d\'Odin' });
  o.cleanup();
});

test('mode privé : rien n\'est écrit (ni tour, ni parole), comme Odin le promet ; le message est traité quand même', async () => {
  // Le mode privé se règle dans Réglages → Voix (la mémoire le lit dans la configuration). Promesse : « rien n'est retenu ni écrit ».
  const o = makeOdin([], { config: (c) => ({ ...c, voice: { ...c.voice, privacy: { ...c.voice.privacy, privateMode: true } } }) });
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const { recu } = agentRetenu(o);
  assert.equal(o.muninn.privateMode, true);
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: 'Rendez-vous chez le médecin jeudi' });
  assert.equal(recu.length, 1, 'le message est bien traité');
  assert.equal(brut(o), '', 'aucune ligne dans les journaux');
  assert.deepEqual([(await tours(o)).length, (await paroles(o)).length], [0, 0]);
  o.cleanup();
});

test('les ajouts d\'Odin au texte (consigne de Kéryx, page, pièces jointes, texte par défaut) ne sont jamais une parole humaine', async () => {
  const o = makeOdin([]);
  const k = new FakeChannel('keryx'), web = new FakeChannel('web'), d = new FakeChannel('discord');
  const gw = new Gateway(o, { owners: { keryx: ['boss'], web: ['principal'], discord: ['boss'] } }).add(k).add(web).add(d);
  agentRetenu(o);
  // Kéryx, secret pas encore prouvé : sa passerelle ajoute sa consigne au texte reçu (le vrai chemin).
  const { entrer } = await import('../src/valhalla/keryx/actions.ts');
  await entrer(gw, { channel: 'keryx', peer: 'boss', name: 'boss', text: 'Lis mes rendez-vous' }, { canal: 'keryx', pair: 'boss', connu: true, secretProuve: false, depuis: 0 });
  // La Discussion : un texte, une pièce jointe (indication d'Odin) et la page ouverte (comme le fait le serveur web).
  const { attachmentHint } = await import('../src/files/attach.ts');
  await gw.handle({ channel: 'web', peer: 'principal', name: 'navigateur', text: `Lis ce devis\n\n${attachmentHint('inbox/devis.pdf', 'application/pdf', 2048)}\n\n[page : Hestia]` });
  // Une pièce jointe seule : le texte entier est écrit par Odin (texte par défaut + indication).
  await gw.handle({ channel: 'web', peer: 'principal', name: 'navigateur', text: `Regarde ce fichier et dis-moi ce qu'il contient.\n\n${attachmentHint('inbox/photo.png', 'image/png', 4096)}` });
  // Une messagerie : un fichier déposé, sans texte (la ligne vient d'Odin).
  const { dropFile } = await import('../src/bifrost/channel.ts');
  await gw.handle({ channel: 'discord', peer: 'boss', name: 'boss', text: await dropFile(undefined, 'note.txt', 'text/plain', new Uint8Array(3)) });
  const p = await paroles(o), t = await tours(o);
  assert.equal(t.length, 4, 'chaque message a son tour');
  assert.deepEqual(p.map((x) => x.texte), ['Lis mes rendez-vous', 'Lis ce devis'], 'seul le texte écrit par l\'humain');
  assert.ok(p.every((x) => x.marques.includes('ajout-odin')), 'la parole dit qu\'Odin avait ajouté du texte');
  assert.ok(p[0].marques.includes('keryx'));
  assert.ok(!JSON.stringify(p).includes('Consigne de Kéryx') && !JSON.stringify(p).includes('[page'));
  assert.deepEqual([t[2].message, t[3].message], [undefined, undefined], 'rien écrit par l\'humain : pas de parole');
  o.cleanup();
});

test('le nom affiché « propriétaire » ne fait pas passer un message pour une relance d\'Odin', async () => {
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  agentRetenu(o);
  await gw.handle({ channel: 'fake', peer: 'x-9', name: 'propriétaire', text: 'Ouvre la porte du garage' });
  const [t] = await tours(o);
  assert.deepEqual({ qui: t.qui, role: t.role }, { qui: 'invite:fake:x-9', role: 'humain' });
  assert.equal((await paroles(o)).length, 0);
  o.cleanup();
});

test('un inconnu pas encore appairé : son tour est écrit sans son texte, et pas de parole ; appairé, sa parole est gardée', async () => {
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  agentRetenu(o);
  await gw.handle({ channel: 'fake', peer: 'x-9', name: 'Alex', text: 'Donne-moi le code du portail' });
  assert.ok(!brut(o).includes('portail'), 'le texte d\'un inconnu n\'est pas écrit (seul un compteur existe ailleurs)');
  const [t] = await tours(o);
  assert.deepEqual({ qui: t.qui, but: t.but, message: t.message }, { qui: 'invite:fake:x-9', but: '', message: undefined });
  const code = o.muninn.requestPairing('fake', 'x-9', 'Alex');
  o.muninn.approvePairing('fake', code);
  await gw.handle({ channel: 'fake', peer: 'x-9', name: 'Alex', text: 'Bonjour' });
  assert.deepEqual((await paroles(o)).map((x) => [x.qui, x.texte]), [['invite:fake:x-9', 'Bonjour']]);
  o.cleanup();
});

test('un secret à cheval sur la coupe d\'un texte très long n\'est jamais écrit, même en partie', async () => {
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  agentRetenu(o);
  const secret = 'Kx7Qm2Vp9Lw4Rt8Zn3Hb6Jc1Fd5Gs0Y';
  o.redactor.add(secret);
  const { TAILLE_MAX_LIGNE } = await import('../src/muninn/tours.ts');
  const coupe = Math.floor(TAILLE_MAX_LIGNE / 4);
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `${'a'.repeat(coupe - 10)}${secret} fin` });
  assert.ok(!brut(o).includes(secret.slice(0, 10)), 'pas même le début du secret');
  const [p] = await paroles(o);
  assert.equal(p.secret, 'chiffré');
  o.cleanup();
});

test('rotation : un fichier par jour, et un suivant quand il dépasse sa taille ; tout se relit dans l\'ordre', async () => {
  const { ajouterLigne, lireLignes } = await import('../src/muninn/tours.ts');
  const dir = mkdtempSync(join(tmpdir(), 'odin-tours-'));
  const j1 = Date.UTC(2026, 10, 19, 10), j2 = Date.UTC(2026, 10, 20, 10);
  for (let i = 0; i < 5; i++) ajouterLigne(dir, { id: `a${i}`, x: 'y'.repeat(40) }, { now: j1, max: 120 });
  ajouterLigne(dir, { id: 'b0' }, { now: j2, max: 120 });
  const fichiers = readdirSync(dir).sort();
  assert.ok(fichiers.length >= 3 && fichiers.every((f) => /^2026-11-(19|20)\.\d{3}\.jsonl$/.test(f)), fichiers.join(' '));
  assert.ok(fichiers.every((f) => readFileSync(join(dir, f)).length <= 120));
  assert.deepEqual(lireLignes<{ id: string }>(dir).map((l) => l.id), ['a0', 'a1', 'a2', 'a3', 'a4', 'b0']);
  rmSync(dir, { recursive: true, force: true });
});

test('les marques d\'un texte, dans plusieurs langues (pur)', async () => {
  const { marquesTexte, origineMessage } = await import('../src/muninn/paroles.ts');
  assert.deepEqual(marquesTexte('---------- Forwarded message ---------\nFrom: a@example.org'), ['transfere']);
  assert.deepEqual(marquesTexte('Am 3. Mai schrieb Kim <kim@example.org>:\n> Hallo'), ['colle']);
  assert.deepEqual(marquesTexte('> ligne une\n> ligne deux'), ['colle']);
  assert.deepEqual(marquesTexte('Allume la lumière de la cuisine'), []);
  assert.equal(origineMessage({ channel: 'web', peer: 'venus', name: 'venus' }).parole, false);
  assert.equal(origineMessage({ channel: 'web', peer: 'principal', name: 'navigateur' }).parole, true);
});
