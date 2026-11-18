// La ligne du bouton « Lire » de Vénus (« [▶ Vénus : identifiant] ») n'est qu'un repère pour la discussion de
// l'application, qui en fait un bouton. Ailleurs (Telegram, Signal, WhatsApp, tout canal qui n'est pas l'application, la
// mascotte de la maison), elle est retirée et la réponse garde son texte. Aucun service réel, dossiers temporaires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { ligneLireVenus, sansLigneLireVenus } from '../src/valhalla/modules/venus.ts';
import { maisonRoute } from '../src/web/maison-api.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { makeOdin } from './helpers.ts';

const TEXTE = '« Serie Lumen » S02E05 est dans ta bibliothèque de Vénus : ouvre Vénus → Odéon → « Serie Lumen » et clique « ► Lire » sur S02E05, il se lit dans le navigateur.';
const REPONSE = `${TEXTE}\n\n${ligneLireVenus('serie:serie-lumen:s2e5')}`;

class Canal implements Channel {
  readonly interactive = true;
  sent: string[] = [];
  readonly name: string;
  constructor(name: string) { this.name = name; }
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(_peer: string, text: string) { this.sent.push(text); }
  async stop() {}
}

test('la règle commune : la ligne part, le texte reste ; une ligne qui n\'a pas la forme attendue n\'est pas touchée', () => {
  assert.equal(sansLigneLireVenus(REPONSE), TEXTE);
  assert.equal(sansLigneLireVenus(TEXTE), TEXTE, 'sans ligne : rien ne change');
  const autre = `${TEXTE}\n\n[▶ Vénus : https://ailleurs.example/x]`;
  assert.equal(sansLigneLireVenus(autre), autre, 'pas la forme d\'un identifiant : laissée telle quelle');
  assert.equal(sansLigneLireVenus(`${REPONSE}\n\nEt voilà.`), `${TEXTE}\n\nEt voilà.`, 'au milieu d\'une réponse aussi');
});

test('passerelle : Telegram, Signal, WhatsApp et tout canal qui n\'est pas l\'application reçoivent la réponse SANS la ligne ; l\'application la garde', async () => {
  const o = makeOdin([]);
  try {
    const canaux = ['telegram', 'signal', 'whatsapp', 'web'].map((n) => new Canal(n));
    const gw = new Gateway(o, { owners: {} });
    for (const c of canaux) gw.add(c);
    for (const c of canaux) await c.send('boss', `${REPONSE} [humeur:joie]`);
    for (const c of canaux.filter((x) => x.name !== 'web')) {
      assert.doesNotMatch(c.sent[0], /\[▶ Vénus/, c.name);
      assert.doesNotMatch(c.sent[0], /\[humeur:/, `${c.name} : l'humeur part toujours`);
      assert.ok(c.sent[0].includes('clique « ► Lire » sur S02E05'), `${c.name} : le texte reste — ${c.sent[0]}`);
    }
    const web = canaux.find((x) => x.name === 'web')!;
    assert.match(web.sent[0], /\[▶ Vénus : serie:serie-lumen:s2e5\]/, 'l\'application garde la ligne (elle en fait un bouton)');
  } finally { o.cleanup(); }
});

// Le message que reçoit un appareil abonné aux notifications (RFC 8291), relu avec les clés de cet appareil d'essai.
function dechiffrer(corps: Buffer, ua: ReturnType<typeof createECDH>, auth: Buffer): { body: string } {
  const sel = corps.subarray(0, 16), n = corps[20], as = corps.subarray(21, 21 + n), ct = corps.subarray(21 + n);
  const ikm = Buffer.from(hkdfSync('sha256', ua.computeSecret(as), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), as]), 32));
  const cle = Buffer.from(hkdfSync('sha256', ikm, sel, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), nonce = Buffer.from(hkdfSync('sha256', ikm, sel, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cle, nonce); d.setAuthTag(ct.subarray(-16));
  const clair = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  return JSON.parse(clair.subarray(0, clair.lastIndexOf(2)).toString('utf8')) as { body: string };
}

test('passerelle : la légende d\'une photo et la notification envoyée à tous les appareils sont sans la ligne', async () => {
  const o = makeOdin([]);
  const avant = globalThis.fetch, envois: Buffer[] = [];
  try {
    // Un appareil abonné (clés d'essai) ; aucun envoi ne quitte la machine : l'appel est gardé ici.
    const ua = createECDH('prime256v1'); ua.generateKeys(); const auth = randomBytes(16);
    writeFileSync(join(o.paths.home, 'push.json'), JSON.stringify([{ endpoint: 'https://fcm.googleapis.com/fcm/send/essai', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } }]));
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => { envois.push(Buffer.from(init?.body as Uint8Array)); return new Response(null, { status: 201 }); }) as typeof fetch;
    class CanalPhoto extends Canal { legendes: string[] = []; async sendPhoto(_peer: string, _img: Uint8Array, legende?: string) { this.legendes.push(legende ?? ''); } }
    const tg = new CanalPhoto('telegram');
    const gw = new Gateway(o, { owners: { telegram: ['boss'] } });
    gw.add(tg);
    const photo = join(o.paths.home, 'photo.jpg'); writeFileSync(photo, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await gw.notifyOwner(`${REPONSE} [humeur:joie]`, { urgent: true, photo });
    for (let i = 0; i < 100 && !envois.length; i++) await new Promise((ok) => setTimeout(ok, 20));
    assert.equal(tg.legendes.length, 1, 'la photo est partie avec sa légende');
    assert.doesNotMatch(tg.legendes[0], /\[▶ Vénus/, 'légende de la photo');
    assert.ok(tg.legendes[0].includes('clique « ► Lire » sur S02E05'), `la légende garde le texte — ${tg.legendes[0]}`);
    assert.equal(envois.length, 1, 'la notification est partie vers l\'appareil abonné');
    const m = dechiffrer(envois[0], ua, auth);
    assert.doesNotMatch(m.body, /\[▶ Vénus/, 'notification envoyée à tous');
    assert.ok(m.body.startsWith('« Serie Lumen » S02E05 est dans ta bibliothèque'), `la notification garde le texte — ${m.body}`);
  } finally { globalThis.fetch = avant; o.cleanup(); }
});

test('maison : la réponse rendue hors de la page (mascotte, tablette) est sans la ligne', async () => {
  const home = mkdtempSync(join(tmpdir(), 'venus-hors-appli-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never), {
    run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => { throw new Error('réseau coupé'); }) as unknown as typeof fetch,
    notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(),
  });
  setValhalla(v);
  try {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ texte: 'lance-moi Serie Lumen S02E05' }))]), { method: 'POST', headers: { 'x-odin': '1', 'content-type': 'application/json' } }) as unknown as IncomingMessage;
    let corps = '', code = 0;
    const res = { writeHead(c: number) { code = c; return this; }, end(b?: string) { corps = b ?? ''; }, setHeader() {} } as unknown as ServerResponse;
    const fait = await maisonRoute(req, res, new URL('http://x/api/maison/dire'), { authed: true, name: 'Awa', mascot: '', fail: () => {}, ask: async () => `${REPONSE} [humeur:joie]` });
    assert.equal(fait, true); assert.equal(code, 200);
    const r = JSON.parse(corps) as { ok: boolean; text: string };
    assert.equal(r.ok, true);
    assert.equal(r.text, TEXTE);
  } finally { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); }
});
