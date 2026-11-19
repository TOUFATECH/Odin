// Les secrets reçus dans la conversation, branchés à l'entrée unique d'Odin (la passerelle).
// Demande du propriétaire (19/11) : « quand on lui envoie, il met dans son coffre, il supprime du chat automatiquement
// tous les clés […] il les supprime les conserves nulle part et le mettre directement dans le coffre » ; le journal des
// paroles : « le mot de passe est dans le coffre et supprimer du texte le texte et le texte qui est gardé sans le mot de
// passe » ; le secret d'un membre : « Son propre coffre ».
//
// Ordre vérifié : trier → ranger (coffre de la bonne personne) → remplacer le texte → seulement ensuite la parole, le tour,
// la conversation, la mémoire, l'agent. Toutes les valeurs sont tirées au hasard à chaque essai : aucune n'est un vrai
// secret. La recherche se fait octet par octet (UTF-8 et UTF-16) dans tout le dossier d'Odin d'essai et le dossier des
// clés, hors du coffre chiffré de Thésauros ; aucun appel réel à une messagerie (faux canal, fetch remplacé).

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { TelegramChannel } from '../src/bifrost/channels/telegram.ts';
import { WhatsAppChannel } from '../src/bifrost/channels/whatsapp.ts';
import { load, type Item } from '../src/valhalla/modules/brisingamen.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import { makeOdin, type TestOdin } from './helpers.ts';

const CLE_ESSAI = randomBytes(32).toString('hex');
const ouvrirCoffre = () => { process.env.BRISINGAMEN_KEY = CLE_ESSAI; };
const fermerCoffre = () => { delete process.env.BRISINGAMEN_KEY; };
/** Une valeur au hasard qui a l'air d'un mot de passe (lettres, chiffre, signe). */
const valeur = (prefixe = 'Qz8') => `${prefixe}-${randomBytes(9).toString('hex')}#K`;

class FakeChannel implements Channel {
  readonly name: string;
  readonly interactive = true;
  sent: Array<{ peer: string; text: string }> = [];
  constructor(name = 'fake') { this.name = name; }
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(peer: string, text: string) { this.sent.push({ peer, text }); }
  async stop() {}
}

/** Tous les fichiers sous `d` (récursif). */
function fichiers(d: string): string[] {
  if (!d || !existsSync(d)) return [];
  const out: string[] = [];
  for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) out.push(...fichiers(p)); else out.push(p); }
  return out;
}
/** Les fichiers du dossier d'essai (hors coffre chiffré de Thésauros) qui contiennent une des valeurs. */
function traces(home: string, valeurs: string[]): string[] {
  const out: string[] = [];
  for (const f of [home, process.env.ODIN_CLE_DIR ?? ''].flatMap(fichiers)) {
    if (f.endsWith(join('brisingamen', 'coffre.bin'))) continue;
    const b = readFileSync(f);
    for (const v of valeurs) if (b.includes(Buffer.from(v, 'utf8')) || b.includes(Buffer.from(v, 'utf16le'))) out.push(`${f.slice(home.length)} ⊃ ${v === valeurs[0] ? 'valeur' : 'autre valeur'}`);
  }
  return out;
}
const coffre = (o: TestOdin): Item[] => load({ dir: join(o.paths.home, 'valhalla', 'brisingamen') } as unknown as ModCtx);
const aCoffre = (o: TestOdin) => existsSync(join(o.paths.home, 'valhalla', 'brisingamen', 'coffre.bin'));

/** Garde la vraie boucle de l'agent (conversation, mémoire, modèle simulé) et note ce qu'elle reçoit. */
function agentEspionne(o: TestOdin): string[] {
  const recu: string[] = [];
  const run = o.agent.run.bind(o.agent);
  (o.agent as unknown as { run: typeof run }).run = async (text, opts) => { recu.push(text); return run(text, opts); };
  return recu;
}
/** Tout ce qui est sorti de la machine d'essai, ou vers l'agent : réponses au canal, texte donné à l'agent, appels au modèle. */
const sorties = (o: TestOdin, ch: { sent: unknown[] } | undefined, recu: string[]) => JSON.stringify([ch?.sent ?? [], recu, o.provider.calls]);

test('contrôle : la recherche trouve bien une valeur écrite quelque part (sinon les essais suivants ne prouvent rien)', () => {
  const o = makeOdin([]);
  const v = valeur();
  writeFileSync(join(o.paths.home, 'temoin.txt'), `x${v}x`);
  writeFileSync(join(o.paths.home, 'temoin16.txt'), Buffer.from(v, 'utf16le'));
  assert.equal(traces(o.paths.home, [v]).length, 2);
  o.cleanup();
});

test('« box identifiant admin7 / mot de passe … » : au coffre « Box » ; la valeur n\'est nulle part ailleurs, ni chez l\'agent ni chez le modèle', async () => {
  ouvrirCoffre();
  const o = makeOdin([{ text: 'C\'est noté.' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const recu = agentEspionne(o);
  const mdp = valeur();
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `box identifiant admin7 / mot de passe ${mdp}` });
  // Rangé dans UN élément, au coffre du propriétaire.
  const box = coffre(o).filter((i) => i.name === 'Box');
  assert.equal(box.length, 1, 'un élément « Box »');
  assert.equal(box[0].user, 'admin7');
  assert.equal(box[0].password, mdp);
  assert.equal(box[0].membre, undefined, 'coffre du propriétaire');
  // Nulle part ailleurs : paroles, tours, messages, résumés, journaux, et ce qu'ont reçu l'agent et le modèle.
  assert.deepEqual(traces(o.paths.home, [mdp, 'admin7']), []);
  const s = sorties(o, ch, recu);
  assert.ok(!s.includes(mdp) && !s.includes('admin7'), 'ni l\'agent, ni le modèle, ni le canal ne voient la valeur');
  assert.ok(recu.length === 1 && recu[0].includes('[rangé au coffre : Box — mot de passe]'), 'l\'agent reçoit le texte remplacé');
  // Une ligne, sans valeur.
  assert.ok(ch.sent.some((x) => x.text.includes('J\'ai rangé au coffre : Box — identifiant, mot de passe')), JSON.stringify(ch.sent.map((x) => x.text)));
  // La parole garde le texte sans le secret, marquée « secret retiré » ; aucune copie, même chiffrée.
  const { lireParoles } = await import('../src/muninn/paroles.ts');
  const [p] = lireParoles(join(o.paths.home, 'memoire'));
  assert.equal(p.secret, 'retiré');
  assert.equal(p.chiffre, undefined, 'plus de copie chiffrée du texte exact');
  assert.equal(p.texte, 'box identifiant [rangé au coffre : Box — identifiant] / mot de passe [rangé au coffre : Box — mot de passe]');
  o.cleanup(); fermerCoffre();
});

test('le tri passe AVANT la parole et le tour : quand le traitement commence, le disque ne porte déjà que le texte remplacé', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const mdp = valeur();
  let avant: string[] = ['pas vu'];
  (o.agent as unknown as { run: (t: string) => Promise<unknown> }).run = async () => { avant = traces(o.paths.home, [mdp]); return { text: 'fait', notices: [], decisions: [], stopReason: 'done' }; };
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `Le mot de passe du NAS est ${mdp}` });
  assert.deepEqual(avant, []);
  assert.equal(coffre(o).find((i) => i.name === 'NAS')?.password, mdp);
  o.cleanup(); fermerCoffre();
});

test('deux mots de passe dans le même message : les deux rangés, aucun ne reste', async () => {
  ouvrirCoffre();
  const o = makeOdin([{ text: 'ok' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const recu = agentEspionne(o);
  const a = valeur('Box9'), b = valeur('Wifi7');
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `Voici la box : identifiant admin7, mot de passe ${a} et le wifi mot de passe ${b}` });
  const c = coffre(o);
  assert.equal(c.find((i) => i.name === 'Box')?.password, a);
  assert.equal(c.find((i) => i.name === 'Wi-Fi')?.password, b);
  assert.deepEqual(traces(o.paths.home, [a, b]), []);
  const s = sorties(o, ch, recu);
  assert.ok(!s.includes(a) && !s.includes(b));
  o.cleanup(); fermerCoffre();
});

test('coffre fermé : rien n\'est gardé, nulle part (pas même chiffré) ; la personne l\'apprend', async () => {
  fermerCoffre();
  const o = makeOdin([{ text: 'ok' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const recu = agentEspionne(o);
  const mdp = valeur();
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `box identifiant admin7 / mot de passe ${mdp}` });
  assert.equal(aCoffre(o), false, 'aucun coffre écrit');
  assert.deepEqual(traces(o.paths.home, [mdp, 'admin7']), []);
  assert.ok(!sorties(o, ch, recu).includes(mdp));
  assert.ok(ch.sent.some((x) => x.text.includes('Ton coffre est fermé : je n\'ai rien gardé, renvoie-le quand il sera ouvert')), JSON.stringify(ch.sent.map((x) => x.text)));
  assert.ok(recu[0].includes('coffre fermé, non gardé') && !recu[0].includes('rangé au coffre'), 'le texte ne prétend pas que c\'est rangé');
  o.cleanup();
});

test('un membre : son propre coffre ; un inconnu : rien rangé ; un courriel : rien rangé', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  const ch = new FakeChannel(), mail = new FakeChannel('mail');
  const gw = new Gateway(o, { owners: { fake: ['boss'], mail: ['boss@example.org'] } }).add(ch).add(mail);
  (o.agent as unknown as { run: () => Promise<unknown> }).run = async () => ({ text: 'fait', notices: [], decisions: [], stopReason: 'done' });
  const u = o.muninn.saveUser({ name: 'Sacha', role: 'member' });
  o.muninn.linkIdentity('fake', 'sacha-1', u.id);
  const m1 = valeur('Sa1'), m2 = valeur('In2'), m3 = valeur('Ml3');
  await gw.handle({ channel: 'fake', peer: 'sacha-1', name: 'sacha', text: `le mot de passe de la box est ${m1}` });
  await gw.handle({ channel: 'fake', peer: 'x-9', name: 'Alex', text: `le mot de passe de la box est ${m2}` });
  await gw.handle({ channel: 'mail', peer: 'boss@example.org', name: 'boss@example.org', text: `le mot de passe de la box est ${m3}` });
  const c = coffre(o);
  assert.equal(c.length, 1, JSON.stringify(c.map((i) => [i.name, i.membre])));
  assert.equal(c[0].membre, u.id, 'dans le coffre de Sacha');
  assert.equal(c[0].password, m1);
  assert.deepEqual(traces(o.paths.home, [m1, m2, m3]), []);
  assert.ok(!JSON.stringify([ch.sent, mail.sent]).includes(m2));
  o.cleanup(); fermerCoffre();
});

test('code à usage unique : retiré, jamais rangé ; IBAN : laissé dans le texte, pas rangé', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const recu: string[] = [];
  (o.agent as unknown as { run: (t: string) => Promise<unknown> }).run = async (t) => { recu.push(t); return { text: 'fait', notices: [], decisions: [], stopReason: 'done' }; };
  const code = String(100000 + (randomBytes(3).readUIntBE(0, 3) % 900000));
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `le code de vérification est ${code}` });
  const iban = 'FR7630006000011234567890189';
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `mon IBAN ${iban} pour le virement` });
  assert.equal(aCoffre(o), false, 'rien rangé');
  assert.deepEqual(traces(o.paths.home, [code]), []);
  assert.ok(!recu[0].includes(code) && !recu[0].includes('rangé au coffre'), recu[0]);
  assert.equal(recu[1], `mon IBAN ${iban} pour le virement`, 'l\'IBAN reste lisible');
  o.cleanup(); fermerCoffre();
});

test('un secret dit à voix haute : rien gardé, retiré partout, et la personne l\'apprend', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  (o.agent as unknown as { run: () => Promise<unknown> }).run = async () => ({ text: 'fait', notices: [], decisions: [], stopReason: 'done' });
  const mdp = valeur();
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `le mot de passe de la box est ${mdp}`, voice: true });
  assert.equal(aCoffre(o), false);
  assert.deepEqual(traces(o.paths.home, [mdp]), []);
  assert.ok(ch.sent.some((x) => /voix haute/.test(x.text)), JSON.stringify(ch.sent));
  o.cleanup(); fermerCoffre();
});

test('un secret « probable » ne remplace pas une valeur déjà au coffre : retiré, gardé nulle part, et la personne l\'apprend', async () => {
  ouvrirCoffre();
  const o = makeOdin([{ text: 'Quel est le mot de passe de la box ?' }, { text: 'ok' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const recu = agentEspionne(o);
  const mdp = valeur();
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `box identifiant admin7 / mot de passe ${mdp}` });
  await new Promise((r) => setTimeout(r, 200));
  const reponse = `Livebox${randomBytes(3).toString('hex')}`; // une réponse à la question d'Odin : « probable », pas sûre
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: reponse });
  const box = coffre(o).find((i) => i.name === 'Box');
  assert.equal(box?.password, mdp, 'la valeur sûre reste');
  assert.equal(box?.history?.length ?? 0, 0, 'rien n\'est passé dans l\'historique');
  assert.deepEqual(traces(o.paths.home, [reponse, mdp]), [], 'la réponse n\'est gardée nulle part');
  assert.ok(!sorties(o, ch, recu).includes(reponse));
  assert.ok(ch.sent.some((x) => x.text.includes('il y en a déjà un au coffre')), JSON.stringify(ch.sent.map((x) => x.text)));
  o.cleanup(); fermerCoffre();
});

test('une valeur sûre qui en remplace une autre : la ligne le dit (l\'ancienne est dans l\'historique du coffre)', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  (o.agent as unknown as { run: () => Promise<unknown> }).run = async () => ({ text: 'fait', notices: [], decisions: [], stopReason: 'done' });
  const a = valeur('Na1'), b = valeur('Na2');
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `mot de passe du NAS : ${a}` });
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `mot de passe du NAS : ${b}` });
  const nas = coffre(o).find((i) => i.name === 'NAS');
  assert.equal(nas?.password, b);
  assert.equal(nas?.history?.length, 1);
  assert.ok(ch.sent.some((x) => x.text.includes('remplacé : NAS — mot de passe') && x.text.includes('historique')), JSON.stringify(ch.sent.map((x) => x.text)));
  assert.deepEqual(traces(o.paths.home, [a, b]), []);
  o.cleanup(); fermerCoffre();
});

test('panne du tri ou message trop long : le texte n\'est pas gardé, et la personne l\'apprend', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const recu: string[] = [];
  (o.agent as unknown as { run: (t: string) => Promise<unknown> }).run = async (t) => { recu.push(t); return { text: 'fait', notices: [], decisions: [], stopReason: 'done' }; };
  const mdp = valeur();
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `mot de passe du NAS : ${mdp} ${'x'.repeat(200_001)}` });
  assert.ok(ch.sent.some((x) => x.text.includes('trop long')), JSON.stringify(ch.sent.map((x) => x.text.slice(0, 200))));
  const vrai = (gw as unknown as { secretsEntrants: unknown }).secretsEntrants;
  (gw as unknown as { secretsEntrants: () => never }).secretsEntrants = () => { throw new Error('panne'); };
  const mdp2 = valeur();
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `mot de passe du NAS : ${mdp2}` });
  (gw as unknown as { secretsEntrants: unknown }).secretsEntrants = vrai;
  assert.ok(ch.sent.some((x) => x.text.includes('pas pu vérifier')), JSON.stringify(ch.sent.map((x) => x.text.slice(0, 200))));
  assert.deepEqual(traces(o.paths.home, [mdp, mdp2]), []);
  assert.ok(!JSON.stringify([ch.sent, recu]).includes(mdp) && !JSON.stringify([ch.sent, recu]).includes(mdp2));
  o.cleanup(); fermerCoffre();
});

// ---------------------------------------------------------------------------------------------------------------
// Les messageries (faux réseau : fetch remplacé, aucun appel réel).

type Appel = { methode: string; corps: Record<string, unknown> };
function fauxTelegram(): { appels: Appel[]; remettre(): void } {
  const appels: Appel[] = [];
  const vrai = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url), methode = u.split('/').at(-1)!.split('?')[0];
    const corps = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    appels.push({ methode, corps });
    const json = (x: unknown) => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } });
    if (methode === 'getFile') return json({ ok: true, result: { file_path: 'voice/v.ogg' } });
    if (u.includes('/file/bot')) return new Response(new Uint8Array([1, 2, 3]));
    if (methode === 'sendMessage') return json({ ok: true, result: { message_id: 900 + appels.length } });
    return json({ ok: true, result: true });
  }) as typeof fetch;
  return { appels, remettre: () => { globalThis.fetch = vrai; } };
}
const entree = (tg: TelegramChannel, m: Record<string, unknown>) => (tg as unknown as { toInbound(m: unknown): Promise<Inbound | undefined> }).toInbound(m);
const maintenantS = () => Math.floor(Date.now() / 1000);

test('Telegram : le message qui contenait un secret est supprimé (chaque niveau) ; un message ordinaire ne l\'est pas', async () => {
  ouvrirCoffre();
  const net = fauxTelegram();
  const o = makeOdin([]);
  try {
    (o.agent as unknown as { run: () => Promise<unknown> }).run = async () => ({ text: 'fait', notices: [], decisions: [], stopReason: 'done' });
    const tg = new TelegramChannel('0:essai', 'https://telegram.invalid', { progress: false });
    const gw = new Gateway(o, { owners: { telegram: ['42'] } }).add(tg);
    const jeton = `ghp_${randomBytes(18).toString('hex')}`; // forme sûre (niveau 1), valeur au hasard
    const mdp = valeur(); // annoncé (niveau 2)
    const pw3 = valeur('Bx3'); // « box : admin / … » (niveau 3, probable)
    const textes = [`garde ce jeton ${jeton}`, `mot de passe du NAS : ${mdp}`, `box : admin / ${pw3}`, 'Allume la lampe du salon'];
    for (const [k, text] of textes.entries()) {
      const inb = await entree(tg, { message_id: 10 + k, date: maintenantS(), chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Boss' }, text });
      await gw.handle(inb!);
    }
    const supprimes = net.appels.filter((a) => a.methode === 'deleteMessage').map((a) => a.corps.message_id);
    assert.deepEqual([...new Set(supprimes)].sort(), [10, 11, 12], JSON.stringify(net.appels.map((a) => a.methode)));
    const envoye = JSON.stringify(net.appels.filter((a) => a.methode !== 'deleteMessage'));
    for (const v of [jeton, mdp, pw3]) assert.ok(!envoye.includes(v), 'aucune valeur renvoyée vers Telegram');
    assert.match(envoye, /effac[ée] de Telegram/);
    assert.match(envoye, /si ce n'en était pas un, dis-le/, 'le secret probable est signalé');
    assert.deepEqual(traces(o.paths.home, [jeton, mdp, pw3]), []);
  } finally { net.remettre(); o.cleanup(); fermerCoffre(); }
});

test('Telegram : groupe ou message de plus de 48 h → pas de suppression, on demande de le faire', async () => {
  ouvrirCoffre();
  const net = fauxTelegram();
  const o = makeOdin([]);
  try {
    (o.agent as unknown as { run: () => Promise<unknown> }).run = async () => ({ text: 'fait', notices: [], decisions: [], stopReason: 'done' });
    const tg = new TelegramChannel('0:essai', 'https://telegram.invalid', { progress: false });
    const gw = new Gateway(o, { owners: { telegram: ['42', '-7'] } }).add(tg);
    const a = valeur(), b = valeur();
    await gw.handle((await entree(tg, { message_id: 20, date: maintenantS(), chat: { id: -7, type: 'group' }, from: { id: 42 }, text: `mot de passe du NAS : ${a}` }))!);
    await gw.handle((await entree(tg, { message_id: 21, date: maintenantS() - 49 * 3600, chat: { id: 42, type: 'private' }, from: { id: 42 }, text: `mot de passe du NAS : ${b}` }))!);
    assert.deepEqual(net.appels.filter((x) => x.methode === 'deleteMessage'), []);
    assert.match(JSON.stringify(net.appels), /supprime-le toi-m[êe]me/);
  } finally { net.remettre(); o.cleanup(); fermerCoffre(); }
});

test('Telegram, vocal : l\'écho « 🎙 … » est coupé quand il porte un secret, gardé sinon', async () => {
  ouvrirCoffre();
  const net = fauxTelegram();
  const o = makeOdin([]);
  try {
    (o.agent as unknown as { run: () => Promise<unknown> }).run = async () => ({ text: 'fait', notices: [], decisions: [], stopReason: 'done' });
    const mdp = valeur();
    let dit = '';
    const tg = new TelegramChannel('0:essai', 'https://telegram.invalid', { progress: false, transcribe: async () => dit });
    const gw = new Gateway(o, { owners: { telegram: ['42'] } }).add(tg);
    dit = `le mot de passe de la box est ${mdp}`;
    await gw.handle((await entree(tg, { message_id: 30, date: maintenantS(), chat: { id: 42, type: 'private' }, from: { id: 42 }, voice: { file_id: 'f1', mime_type: 'audio/ogg' } }))!);
    dit = 'allume la lampe du salon';
    await gw.handle((await entree(tg, { message_id: 31, date: maintenantS(), chat: { id: 42, type: 'private' }, from: { id: 42 }, voice: { file_id: 'f2', mime_type: 'audio/ogg' } }))!);
    await new Promise((r) => setTimeout(r, 20));
    const echos = net.appels.filter((x) => x.methode === 'sendMessage' && String(x.corps.text).startsWith('🎙'));
    assert.equal(echos.length, 1, JSON.stringify(echos));
    assert.match(String(echos[0].corps.text), /allume la lampe/);
    assert.ok(!JSON.stringify(net.appels).includes(mdp));
    assert.deepEqual(net.appels.filter((x) => x.methode === 'deleteMessage').map((x) => x.corps.message_id), [30], 'le vocal qui portait le secret est supprimé');
  } finally { net.remettre(); o.cleanup(); fermerCoffre(); }
});

test('WhatsApp, vocal : écho coupé pour un secret (et la personne doit supprimer son message elle-même)', async () => {
  ouvrirCoffre();
  const o = makeOdin([]);
  const envois: string[] = [];
  const faux = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/messages')) { envois.push(String(init?.body ?? '')); return new Response('{}'); }
    if (u.includes('graph.facebook.com/v21.0/m')) return new Response(JSON.stringify({ url: 'https://media.invalid/x', mime_type: 'audio/ogg' }));
    return new Response(new Uint8Array([1, 2, 3]));
  }) as typeof fetch;
  try {
    (o.agent as unknown as { run: () => Promise<unknown> }).run = async () => ({ text: 'fait', notices: [], decisions: [], stopReason: 'done' });
    const mdp = valeur();
    let dit = '';
    const wa = new WhatsAppChannel({ token: 't', phoneId: 'p', verifyToken: 'v', appSecret: 's' }, { transcribe: async () => dit }, faux);
    const gw = new Gateway(o, { owners: { whatsapp: ['33600'] } }).add(wa);
    await wa.start((m) => gw.handle(m));
    const msg = (Wid: string) => (wa as unknown as { onMsg(m: unknown, n: Map<string, string>): Promise<void> }).onMsg({ from: '33600', type: 'audio', audio: { id: Wid } }, new Map());
    dit = `le mot de passe de la box est ${mdp}`; await msg('m1');
    dit = 'allume la lampe du salon'; await msg('m2');
    const echos = envois.filter((b) => b.includes('🎙'));
    assert.equal(echos.length, 1, JSON.stringify(envois));
    assert.match(echos[0], /allume la lampe/);
    assert.ok(!envois.join('').includes(mdp));
    assert.match(envois.join(''), /Supprime ton message toi-m[êe]me/);
  } finally { o.cleanup(); fermerCoffre(); }
});
