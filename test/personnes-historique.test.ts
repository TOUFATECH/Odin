// Profil, lot 1 — l'historique par personne noté par la passerelle : des renvois seulement (jamais le texte), avec la
// preuve d'identité ; noté APRÈS le retrait des clés ; une panne de la note n'arrête pas un message ; noter ne change
// pas la réponse d'Odin. Noms inventés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { makeOdin } from './helpers.ts';
import { PROPRIETAIRE, comptes, historiquePersonne } from '../src/muninn/personnes.ts';

class FakeChannel implements Channel {
  readonly name = 'fake';
  readonly interactive = true;
  sent: Array<{ peer: string; text: string }> = [];
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(peer: string, text: string) { this.sent.push({ peer, text }); }
  async stop() {}
}
const attendre = () => new Promise<void>((r) => setImmediate(r));
const CLE = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

test('une demande du propriétaire : une ligne de renvois (session, message, tour, résultat), sans texte, avec sa preuve', async () => {
  const o = makeOdin([{ text: 'noté' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  try {
    await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `retiens ce code ${CLE} merci` });
    await attendre();
    const h = historiquePersonne(o.muninn, PROPRIETAIRE);
    assert.equal(h.length, 1);
    const l = h[0];
    assert.equal(l.sorte, 'demande'); assert.equal(l.session, 'fake:boss'); assert.equal(l.canal, 'fake');
    assert.equal(l.preuve, 'appareil-appaire'); assert.equal(l.partage, false);
    assert.equal(l.resultat, 'reussi');
    const msg = o.muninn.allMessages('fake:boss').find((x) => x.role === 'user')!;
    assert.equal(l.message, msg.id, 'renvoi vers le message, pas une copie');
    assert.ok(l.mission && o.muninn.getMission(l.mission), 'renvoi vers le tour');
    const brut = JSON.stringify(o.muninn.lignesHistorique(() => true));
    assert.doesNotMatch(brut, new RegExp(CLE), 'jamais la clé');
    assert.doesNotMatch(brut, /retiens|merci/, 'jamais le texte');
  } finally { await gw.stop(); o.cleanup(); }
});

test('un membre relié : sa ligne lui est attribuée ; un inconnu non appairé : un compteur, pas de ligne', async () => {
  const o = makeOdin([{ text: 'fait' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  try {
    const u = o.muninn.saveUser({ name: 'Personne B', role: 'member' });
    o.muninn.linkIdentity('fake', 'b1', u.id);
    await gw.handle({ channel: 'fake', peer: 'b1', name: 'B', text: 'note : acheter du pain' });
    await gw.handle({ channel: 'fake', peer: 'x9', name: 'X', text: 'salut' });
    await attendre();
    const h = historiquePersonne(o.muninn, u.id);
    assert.equal(h.length, 1); assert.equal(h[0].qui, u.id); assert.equal(h[0].preuve, 'appareil-appaire');
    assert.equal(o.muninn.lignesHistorique(() => true).length, 1, 'rien pour l\'inconnu');
    assert.equal(o.muninn.inconnus().fake.n, 1);
    assert.ok(ch.sent.some((x) => x.peer === 'x9' && /Code d'appairage/.test(x.text)), 'l\'inconnu reçoit toujours son code');
  } finally { await gw.stop(); o.cleanup(); }
});

/** Ce qu'Odin répond à deux messages, avec la note telle quelle, coupée, ou en panne. */
async function reponses(mode: 'normal' | 'coupee' | 'panne'): Promise<string[]> {
  const o = makeOdin([{ text: 'première réponse' }, { text: 'deuxième réponse' }]);
  if (mode === 'coupee') o.muninn.noterHistorique = () => 0;
  if (mode === 'panne') {
    o.muninn.noterHistorique = () => { throw new Error('disque plein'); };
    o.muninn.appareilPartage = () => { throw new Error('table abîmée'); };
    o.muninn.completerHistorique = () => { throw new Error('renvoi impossible'); };
  }
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  try {
    await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: 'quelle heure est-il à Mamoudzou ?' });
    await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: 'et demain ?' });
    await attendre();
    if (mode === 'normal') assert.equal(o.muninn.lignesHistorique(() => true).length, 2);
    return ch.sent.map((x) => x.text);
  } finally { await gw.stop(); o.cleanup(); }
}

test('noter une demande ne change pas la réponse d\'Odin ; une panne de la note n\'arrête pas un message', async () => {
  const normal = await reponses('normal');
  assert.ok(normal.length >= 2);
  assert.deepEqual(await reponses('coupee'), normal, 'mêmes réponses sans la note');
  assert.deepEqual(await reponses('panne'), normal, 'mêmes réponses quand la note tombe en panne');
});

test('plusieurs messages en file dans une même conversation : chaque demande renvoie à SON tour et à SON message', async () => {
  const o = makeOdin([{ text: 'r1' }, { text: 'r2' }, { text: 'r3' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  try {
    // Envoyés en même temps : les tours passent un par un ; le 2e et le 3e attendent le précédent.
    await Promise.all(['un', 'deux', 'trois'].map((text) => gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text })));
    await attendre();
    const h = historiquePersonne(o.muninn, PROPRIETAIRE);
    const missions = o.muninn.missionsDeSession('fake:boss');
    const messages = o.muninn.allMessages('fake:boss').filter((x) => x.role === 'user');
    assert.equal(missions.length, 3); assert.equal(messages.length, 3);
    assert.deepEqual(h.map((l) => l.resultat), ['reussi', 'reussi', 'reussi']);
    assert.deepEqual(h.map((l) => l.mission), missions.map((m) => m.id), 'la k-ième demande ↔ le k-ième tour');
    assert.deepEqual(h.map((l) => l.message), messages.map((m) => m.id), 'la k-ième demande ↔ le k-ième message');
    const c = comptes(h)[PROPRIETAIRE];
    assert.equal(c.taches, 3); assert.equal(c.succes, 3); assert.equal(c.sansTour, 0);
  } finally { await gw.stop(); o.cleanup(); }
});

test('une commande au milieu de la file : elle reste « sans tour », pas une tâche, et ne décale pas les renvois', async () => {
  const o = makeOdin([{ text: 'r1' }, { text: 'r2' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  try {
    await Promise.all(['un', '/status', 'deux'].map((text) => gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text })));
    await attendre();
    const h = historiquePersonne(o.muninn, PROPRIETAIRE);
    const missions = o.muninn.missionsDeSession('fake:boss');
    assert.equal(missions.length, 2);
    assert.deepEqual(h.map((l) => l.resultat), ['reussi', 'sans_tour', 'reussi']);
    assert.deepEqual(h.map((l) => l.mission), [missions[0].id, undefined, missions[1].id]);
    const c = comptes(h)[PROPRIETAIRE];
    assert.equal(c.taches, 2, 'une commande n\'est pas une tâche confiée'); assert.equal(c.sansTour, 1); assert.equal(c.activites, 3);
  } finally { await gw.stop(); o.cleanup(); }
});
