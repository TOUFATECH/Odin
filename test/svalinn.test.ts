// Zéphyr : l'analyse du Wi-Fi (réseaux autour, canaux, note), la Livebox (connexion, lecture, réglages),
// les corrections avec accord, la sauvegarde avant, le retour automatique, le QR code invités, le secret du mot de passe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assess, bestChannel, parseIw, parseNmcli, secuOf, wifiQr } from '../src/valhalla/svalinn/analyse.ts';
import { Livebox } from '../src/valhalla/svalinn/livebox.ts';
import { hours, svalinn } from '../src/valhalla/modules/svalinn.ts';
import { setDiscoveryTarget } from '../src/valhalla/upnp.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { isSecretFile } from '../src/heimdall/policy.ts';
import { fakeLivebox } from './fake-livebox.ts';
import type { Module } from '../src/valhalla/types.ts';

const NMCLI = ['*:Maison:AA\\:BB\\:CC\\:00\\:00\\:01:6:2437 MHz:78:WPA2', ' :Voisin 1:AA\\:BB\\:CC\\:00\\:00\\:02:6:2437 MHz:70:WPA2', ' :Voisin 2:AA\\:BB\\:CC\\:00\\:00\\:03:6:2437 MHz:55:WPA2 WPA3', ' :Voisin 3:AA\\:BB\\:CC\\:00\\:00\\:04:5:2432 MHz:40:WPA2',
  ' :Café:AA\\:BB\\:CC\\:00\\:00\\:05:1:2412 MHz:30:', ' :Loin:AA\\:BB\\:CC\\:00\\:00\\:06:11:2462 MHz:12:WPA2', ' :Maison 5G:AA\\:BB\\:CC\\:00\\:00\\:07:44:5220 MHz:70:WPA2'].join('\n');
const IW = `BSS aa:bb:cc:00:00:01(on wlan0) -- associated
\tfreq: 2437
\tsignal: -48.00 dBm
\tSSID: Maison
\tcapability: ESS Privacy ShortSlotTime (0x0411)
\tRSN:\t * Version: 1
\t\t * Authentication suites: PSK
\tWPS:\t * Version: 1.0
\tHT operation:
\t\t * primary channel: 6
BSS aa:bb:cc:00:00:02(on wlan0)
\tfreq: 5220
\tsignal: -70.00 dBm
\tSSID: Voisin
\tRSN:\t * Version: 1
\t\t * Authentication suites: PSK SAE
`;

test('Zéphyr : réseaux autour (nmcli, iw), chiffrement, meilleur canal', () => {
  const n = parseNmcli(NMCLI);
  assert.equal(n.length, 7); assert.equal(n[0].bssid, 'AA:BB:CC:00:00:01'); assert.ok(n[0].mine); assert.equal(n[4].security, 'ouvert');
  const iw = parseIw(IW);
  assert.equal(iw.length, 2); assert.deepEqual([iw[0].chan, iw[0].wps, iw[0].mine, iw[0].security], [6, true, true, 'WPA2']); assert.equal(iw[1].security, 'WPA2 WPA3'); assert.equal(iw[1].chan, 44);
  assert.deepEqual(['WPA2-Personal', 'WPA2-WPA3-Personal', 'WPA3-Personal', 'WPA2 WPA3', 'WPA1', 'WEP', ''].map(secuOf), ['WPA2', 'WPA2/WPA3', 'WPA3', 'WPA2/WPA3', 'WPA', 'WEP', 'ouvert']);
  const c = bestChannel(n, 6);
  assert.equal(c.best, 11, 'le 11 est le plus libre'); assert.equal(c.voisins, 2); assert.ok(c.nowCrowd > c.bestCrowd);
});

test('Zéphyr : la note et les corrections, le plus urgent d\'abord ; rien d\'inconnu ne coûte de points', () => {
  const a = assess({ security: 'WPA2', wps: true, upnp: true, remoteAdmin: true, defaultPassword: true, channel: bestChannel(parseNmcli(NMCLI), 6) });
  assert.deepEqual(a.fixes.map((f) => f.id), ['wps', 'mot_de_passe', 'chiffrement', 'distance', 'upnp', 'canal']);
  assert.equal(a.note, 100 - 18 - 15 - 12 - 12 - 8 - 5); assert.equal(a.verdict, 'dangereux');
  assert.deepEqual(a.fixes.find((f) => f.id === 'canal')!.change, { kind: 'canal', chan: 11 });
  const u = assess({});
  assert.equal(u.note, 100); assert.equal(u.fixes[0].level, 'à vérifier');
  assert.equal(assess({ security: 'ouvert' }).verdict, 'dangereux');
  assert.equal(assess({ security: 'WPA3', wps: false, upnp: false }).fixes.length, 0);
  assert.equal(wifiQr('Maison;Invités', 'p:ss'), 'WIFI:T:WPA;S:Maison\\;Invités;P:p\\:ss;;');
});

test('Zéphyr : la Livebox (connexion, lecture, réglages et inverse)', async () => {
  const { box, handle } = fakeLivebox();
  const f = (async (u: string | URL, i?: RequestInit) => handle(String(u), i) ?? new Response('', { status: 404 })) as typeof fetch;
  await assert.rejects(new Livebox('box.test', 'faux', { fetch: f }).login(), /mot de passe de la box refusé/);
  const d = new Livebox('box.test', 'mot-de-passe-box', { fetch: f }), st = await d.read();
  assert.equal(st.model, 'Livebox 6'); assert.equal(st.vaps.length, 2); assert.equal(st.vaps[0].band, '2,4 GHz'); assert.equal(st.radios.find((r) => r.band === '2,4 GHz')?.channel, 6);
  assert.deepEqual([st.upnp, st.remote, st.guest], [true, true, false]); assert.equal(st.devices.filter((x) => x.active && x.wifi).length, 4);
  assert.deepEqual(await d.apply({ kind: 'wps', on: false }, st), { kind: 'wps', on: true }); assert.equal(box.state.wps, false);
  assert.deepEqual(await d.apply({ kind: 'securite', mode: 'WPA2/WPA3' }, st), { kind: 'securite', mode: 'WPA2' }); assert.equal(box.state.mode, 'WPA2-WPA3-Personal');
  assert.deepEqual(await d.apply({ kind: 'canal', chan: 11 }, st), { kind: 'canal', chan: 6 }); assert.equal(box.state.chan, 11);
  await d.apply({ kind: 'upnp', on: false }, st); await d.apply({ kind: 'distance', on: false }, st); await d.apply({ kind: 'invites', on: true }, st);
  assert.deepEqual([box.state.upnp, box.state.remote, box.state.guest], [false, false, true]);
});

test('Zéphyr dans Odin : relier la box (coffre), analyser, corriger avec accord, sauvegarde, retour automatique', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-svalinn-'));
  setDiscoveryTarget({ host: '127.0.0.1', port: 9, timeoutMs: 200 });
  try {
    const { box, handle } = fakeLivebox(); let now = new Date('2026-11-13T10:00:00Z'); const coffre: string[] = [];
    const fakeVault: Module = { id: 'brisingamen', name: 'Thésauros', family: 'Accès', what: '', does: [], from: [], upstream: [], words: [], actions: [{ id: 'ajouter', label: 'Ajouter', what: '', run: (_c, i) => { coffre.push(String(i.nom)); return { text: 'ok' }; } }], view: () => ({ sections: [] }) };
    const v = new Valhalla(home, [svalinn, fakeVault], {
      now: () => now,
      fetch: (async (u: string | URL, i?: RequestInit) => { const url = String(u); if (/speed\.cloudflare\.com/.test(url)) return new Response(new Uint8Array(1_000_000)); return handle(url, i) ?? new Response('', { status: 404 }); }) as typeof fetch,
      run: async (cmd, args) => {
        if (cmd === 'sh') return { code: /command -v (nmcli|ip)$/.test(args[1]) ? 0 : 1, out: '', err: '' };
        if (cmd === 'nmcli') return { code: 0, out: NMCLI, err: '' };
        if (cmd === 'ip' && args[0] === 'route') return { code: 0, out: 'default via 192.168.1.1 dev eth0', err: '' };
        if (cmd === 'ip') return { code: 0, out: '192.168.1.20 dev eth0 lladdr aa:bb:cc:00:00:99 REACHABLE\n', err: '' };
        return { code: 1, out: '', err: '' };
      },
    });
    let r = await v.act('svalinn', 'etat');
    assert.match(r.text, /box non reliée/); assert.match(r.text, /Chiffrement WPA2 seul/, 'sans box : ce que voit la carte Wi-Fi');
    r = await v.act('svalinn', 'relier_box', { adresse: 'box.test', marque: 'livebox', utilisateur: 'admin', mot_de_passe: 'mot-de-passe-box' });
    assert.match(r.text, /connexion réussie, mot de passe rangé dans le coffre/); assert.deepEqual(coffre, ['Box internet (Zéphyr)']);
    assert.ok(isSecretFile(join(home, 'valhalla', 'svalinn', 'secrets.json')), 'fichier de secrets bloqué pour les outils');
    assert.doesNotMatch(JSON.stringify(await svalinn.view(v.ctx('svalinn'), new URLSearchParams())), /mot-de-passe-box/, 'jamais affiché');
    r = await v.act('svalinn', 'etat');
    assert.match(r.text, /Livebox 6/); assert.match(r.text, /\[urgent\] WPS activé/); assert.match(r.text, /Box visible depuis Internet/); assert.match(r.text, /Canal 6 encombré/);
    assert.ok(v.alerts({ module: 'svalinn' }).some((a) => /WPS activé/.test(a.title)), 'alerte pour l\'urgent');
    const grave = v.action('svalinn', 'corriger')!.a.grave!({ correction: 'wps' }, v.ctx('svalinn'));
    assert.match(grave!, /WPS activé → couper sur la box/, 'action grave : ton accord d\'abord');
    r = await v.act('svalinn', 'corriger', { correction: 'wps' });
    assert.match(r.text, /WPS coupé : fait\. État de la box sauvegardé/); assert.equal(box.state.wps, false);
    assert.equal(readdirSync(join(home, 'valhalla', 'svalinn', 'sauvegardes')).length, 1);
    // Retour automatique : 3 min plus tard, seul 1 appareil sur 4 est revenu → l'ancien réglage revient.
    box.state.wifiActive = 1; now = new Date(now.getTime() + 181_000);
    await svalinn.watch!.run(v.ctx('svalinn'));
    assert.equal(box.state.wps, true, 'WPS remis'); assert.ok(v.alerts({ module: 'svalinn' }).some((a) => /WPS coupé annulé tout seul/.test(a.title)));
    // Tout revenu : rien n'est annulé.
    box.state.wifiActive = 4; r = await v.act('svalinn', 'corriger', { correction: 'canal' }); assert.equal(box.state.chan, 11);
    now = new Date(now.getTime() + 181_000); await svalinn.watch!.run(v.ctx('svalinn')); assert.equal(box.state.chan, 11, 'gardé');
    r = await v.act('svalinn', 'annuler'); assert.match(r.text, /canal 2,4 GHz → 11 annulé/); assert.equal(box.state.chan, 6);
    // Historique des appareils, débit, QR invités.
    assert.ok(existsSync(join(home, 'valhalla', 'svalinn', 'appareils.jsonl')));
    r = await v.act('svalinn', 'tester_debit'); assert.match(r.text, /Mb\/s/);
    r = await v.act('svalinn', 'qr_invites'); assert.equal(r.ok, false);
    await v.act('svalinn', 'regler', { invites_nom: 'Maison-Invités', invites_mdp: 'bienvenue-2026', retour: true });
    r = await v.act('svalinn', 'qr_invites'); assert.match(String((r.data as { svg: string }).svg), /^<svg/);
    assert.doesNotMatch(readFileSync(join(home, 'valhalla', 'svalinn', 'etat.json'), 'utf8'), /mot-de-passe-box|bienvenue-2026/, 'l\'état ne garde aucun mot de passe');
    r = await v.act('svalinn', 'invites', { allume: true }); assert.equal(box.state.guest, true);
    v.stop();
  } finally { setDiscoveryTarget(undefined); rmSync(home, { recursive: true, force: true }); }
});

test('Zéphyr : 24 barres d\'appareils, la dernière = maintenant', () => {
  const now = new Date('2026-11-13T10:30:00Z');
  const h = hours([{ at: '2026-11-13T10:20:00Z', n: 7 }, { at: '2026-11-13T09:10:00Z', n: 3 }, { at: '2026-11-12T09:00:00Z', n: 99 }], now);
  assert.equal(h.length, 24); assert.equal(h[23], 7); assert.equal(h[22], 3); assert.ok(!h.includes(99));
});
