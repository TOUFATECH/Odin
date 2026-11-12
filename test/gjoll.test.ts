// Gjöll (VPN) de A à Z : mise en route pas à pas, appareils (QR code, fichier .conf, modifier, fin d'accès),
// réglages du tunnel, allumer / éteindre. Les commandes système sont simulées : rien ne touche la machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { clientConf, confName, expired, serverConf, type Peer, type Server } from '../src/valhalla/modules/gjoll.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

function world(o: { wg?: boolean; up?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'gjoll-')), ran: string[] = [];
  let wg = o.wg ?? true, up = o.up ?? false;
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async (cmd, args) => {
      const line = `${cmd} ${args.join(' ')}`; ran.push(line);
      if (cmd === 'sh' && /command -v (\S+)/.test(args.join(' '))) { const c = /command -v (\S+)/.exec(args.join(' '))![1]; return { code: c === 'wg' || c === 'wg-quick' ? (wg ? 0 : 1) : ['apt-get', 'systemctl', 'iptables', 'install'].includes(c) ? 0 : 1, out: '', err: '' }; }
      if (cmd === 'apt-get' && args[0] === 'install') { wg = true; return { code: 0, out: '', err: '' }; }
      if (cmd === 'wg' && args[0] === 'show' && args.length === 2) return { code: up ? 0 : 1, out: '', err: '' };
      if (cmd === 'wg-quick' && args[0] === 'up') { up = true; return { code: 0, out: '', err: '' }; }
      if (cmd === 'wg-quick' && args[0] === 'down') { up = false; return { code: 0, out: '', err: '' }; }
      if (cmd === 'ip') return { code: 0, out: 'default via 192.168.1.1 dev eth0', err: '' };
      return { code: 0, out: '', err: '' };
    },
    fetch: (async (url: string) => ({ text: async () => (String(url).includes('ipify') ? '203.0.113.7' : '') })) as unknown as typeof fetch,
    notify: async () => {}, autonomy: () => 'equilibre',
  });
  return { v, ran, home, end: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
const act = async (v: Valhalla, a: string, i: Record<string, unknown> = {}) => v.act('gjoll', a, i);

test('Gjöll : la mise en route se fait pas à pas, chaque étape avec son bouton, et disparaît une fois finie', async () => {
  const w = world({ wg: false });
  try {
    const steps = async () => { const view = await w.v.module('gjoll')!.view(w.v.ctx('gjoll'), new URLSearchParams()); return view.sections.find((s) => s.kind === 'steps') as { items: Array<{ title: string; done: boolean; action?: string }> } | undefined; };
    let st = await steps();
    assert.deepEqual(st?.items.map((x) => [x.done, x.action]), [[false, 'installer'], [false, 'detecter'], [false, 'port'], [false, 'allumer'], [false, undefined], [false, undefined]]);
    assert.match((await act(w.v, 'installer')).text, /WireGuard installé/);
    assert.ok(w.ran.some((c) => c === 'apt-get install -y wireguard-tools'));
    assert.match((await act(w.v, 'detecter')).text, /203\.0\.113\.7/);
    await act(w.v, 'port', { ouvert: true });
    assert.match((await act(w.v, 'allumer')).text, /Tunnel wg0 à jour/);
    assert.ok(w.ran.includes('systemctl enable wg-quick@wg0'), 'redémarre avec la machine');
    st = await steps();
    assert.deepEqual(st?.items.map((x) => x.done), [true, true, true, true, false, false]);
    await act(w.v, 'ajouter', { nom: 'Téléphone de Awa', tout: true });
    w.v.ctx('gjoll').saveSettings({ seen: ['Téléphone de Awa'] });
    assert.equal(await steps(), undefined, 'tout est fait : l\'assistant laisse la place');
    assert.match((await act(w.v, 'eteindre')).text, /Tunnel coupé/);
    assert.ok(w.ran.includes('wg-quick down wg0') && w.ran.includes('systemctl disable wg-quick@wg0'));
  } finally { w.end(); }
});

test('Gjöll : un appareil ajouté donne tout de suite son QR code et son fichier ; on le modifie, on le coupe à une date', async () => {
  const w = world({ up: true });
  try {
    await act(w.v, 'detecter');
    const r = await act(w.v, 'ajouter', { nom: 'PC bureau', tout: false, fin: '2026-12-31' });
    const d = r.data as { svg: string; conf: string; filename: string };
    assert.match(d.svg, /^<svg/); assert.equal(d.filename, 'maison-PC-bureau.conf');
    assert.match(d.conf, /\[Interface\]\nPrivateKey = .+\nAddress = 10\.8\.0\.2\/32\nDNS = 192\.168\.1\.1\n/);
    assert.match(d.conf, /Endpoint = 203\.0\.113\.7:51820\nAllowedIPs = 10\.8\.0\.0\/24/); assert.doesNotMatch(d.conf, /0\.0\.0\.0\/0/, 'maison seulement');
    // Le fichier serveur, sur disque, est privé et contient l'appareil.
    assert.match(readFileSync(join(w.v.ctx('gjoll').dir, 'wg0.conf'), 'utf8'), /# PC bureau\nPublicKey = /);
    { const r = await act(w.v, 'ajouter', { nom: 'PC bureau' }); assert.equal(r.ok, false); assert.match(r.text, /déjà ce nom/); }
    { const r = await act(w.v, 'ajouter', { nom: 'x', fin: '31/12/2026' }); assert.equal(r.ok, false); assert.match(r.text, /2026-12-31/); }
    // Fichier .conf à télécharger, QR code.
    assert.equal(((await act(w.v, 'telecharger', { nom: 'PC bureau' })).data as { filename: string }).filename, 'maison-PC-bureau.conf');
    assert.match(((await act(w.v, 'qr', { nom: 'PC bureau' })).data as { svg: string }).svg, /^<svg/);
    // Modifier : nouveau nom, tout le trafic.
    assert.match((await act(w.v, 'modifier', { nom: 'PC bureau', nouveau_nom: 'PC Awa', tout: 'oui', maillage: 'inchangé', fin: '' })).text, /« PC Awa » modifié · accès jusqu'au 2026-12-31\. Rescanne son QR code/);
    assert.match(((await act(w.v, 'telecharger', { nom: 'PC Awa' })).data as { conf: string }).conf, /AllowedIPs = 0\.0\.0\.0\/0, ::\/0/);
    // La fin d'accès arrive : coupé tout seul, avec une alerte ; rouvert avec une nouvelle date.
    const peers = () => w.v.ctx('gjoll').settings.peers as Peer[];
    assert.deepEqual(expired(peers(), new Date('2027-01-01T08:00:00Z')).map((p) => p.name), ['PC Awa']);
    assert.deepEqual(expired(peers(), new Date('2026-12-31T08:00:00Z')), [], 'le dernier jour compte encore');
    const g = { ...w.v.ctx('gjoll'), now: () => new Date('2027-01-02T08:00:00Z') };
    Object.defineProperty(g, 'settings', { get: () => w.v.ctx('gjoll').settings });
    const mod = allModules({ paths: { home: w.home, workspace: w.home }, cfg: DEFAULT_CONFIG } as never).find((m) => m.id === 'gjoll')!;
    await mod.watch!.run(g as never);
    assert.equal(peers()[0].enabled, false);
    assert.ok(w.v.alerts({ module: 'gjoll' }).some((a) => /Accès VPN de « PC Awa » terminé/.test(a.title)));
    assert.doesNotMatch(serverConf(g.settings.server as Server, peers()), /# PC Awa/, 'coupé : retiré du tunnel');
    await mod.actions.find((a) => a.id === 'modifier')!.run(g as never, { nom: 'PC Awa', nouveau_nom: '', tout: 'inchangé', maillage: 'inchangé', fin: '2027-06-30' });
    assert.equal(peers()[0].enabled, true, 'nouvelle date : rouvert');
    // Désactivé à la main : une nouvelle date ne le rallume pas.
    await act(w.v, 'activer', { nom: 'PC Awa', actif: false });
    await act(w.v, 'modifier', { nom: 'PC Awa', nouveau_nom: '', tout: 'inchangé', maillage: 'inchangé', fin: '2027-09-30' });
    assert.equal(peers()[0].enabled, false);
  } finally { w.end(); }
});

test('Gjöll : réglages du tunnel (port, MTU, maintien) vérifiés et appliqués aux deux bouts', async () => {
  const w = world({ up: true });
  try {
    await act(w.v, 'ajouter', { nom: 'Tel', tout: true });
    w.v.ctx('gjoll').saveSettings({ portOpened: true });
    { const r = await act(w.v, 'serveur', { port: 51820, mtu: '900', keepalive: 25 }); assert.equal(r.ok, false); assert.match(r.text, /MTU entre 1280 et 1500/); }
    { const r = await act(w.v, 'serveur', { port: 70000, mtu: '', keepalive: 25 }); assert.equal(r.ok, false); assert.match(r.text, /port entre 1 et 65535/); }
    assert.match((await act(w.v, 'serveur', { port: 51999, mtu: '1280', keepalive: 15 })).text, /Port 51999 · MTU 1280 · maintien 15 s\. Ouvre le port 51999/);
    assert.equal(w.v.ctx('gjoll').settings.portOpened, false, 'nouveau port : à rouvrir sur la box');
    const sv = w.v.ctx('gjoll').settings.server as Server, p = (w.v.ctx('gjoll').settings.peers as Peer[])[0];
    assert.match(serverConf(sv, [p]), /ListenPort = 51999\nPrivateKey = .+\nMTU = 1280\n/);
    assert.match(clientConf(sv, p), /MTU = 1280[\s\S]*:51999\n[\s\S]*PersistentKeepalive = 15/);
    assert.equal(confName({ ...p, name: 'Tél. d\'Élodie / 2' }), 'maison-Tel-d-Elodie-2.conf');
  } finally { w.end(); }
});

test('Gjöll : sans WireGuard ni installeur, Odin le dit au lieu de faire semblant', async () => {
  const w = world({ wg: false });
  try {
    const v2 = new Valhalla(w.home, allModules({ paths: { home: w.home, workspace: w.home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: 'absent' }), fetch: (async () => ({ text: async () => 'pas une adresse' })) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
    try {
      const r = await v2.act('gjoll', 'installer', {});
      assert.equal(r.ok, false); assert.match(r.text, /wireguard\.com\/install/);
      { const r = await v2.act('gjoll', 'detecter', {}); assert.equal(r.ok, false); assert.match(r.text, /introuvable/); }
    } finally { v2.stop(); }
  } finally { w.end(); }
});
