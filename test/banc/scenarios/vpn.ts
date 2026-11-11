// Gjöll contre un VRAI WireGuard : la maison (cette machine), un « téléphone » dans un réseau isolé
// qui scanne la configuration d'Odin, et un « NAS » sur le réseau de la maison. Le téléphone doit
// joindre la maison par le tunnel chiffré, puis le NAS derrière elle ; désactivé, il ne passe plus.

import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gjoll, keypair, type Server } from '../../../src/valhalla/modules/gjoll.ts';
import { has, sh, until, type Scenario } from '../lib.ts';

const TEL = 'odinbanc-tel', NAS = 'odinbanc-nas', IFACE = 'obwg0';

async function freeUdp(): Promise<number> { return new Promise((res, rej) => { const s = createSocket('udp4'); s.once('error', rej); s.bind(0, () => { const p = s.address().port; s.close(() => res(p)); }); }); }

export const vpn: Scenario = {
  id: 'vpn', title: 'Gjöll ↔ WireGuard', mode: 'réel',
  what: 'Un vrai tunnel WireGuard : un téléphone simulé se connecte avec la configuration du QR code, atteint la maison puis un appareil du réseau local ; désactivation et révocation coupent l\'accès.',
  async run(t) {
    t.needRoot(); await t.need('wg', 'wg-quick', 'ip');
    const kernel = (await sh('ip', ['link', 'add', 'obwgprobe', 'type', 'wireguard'])).code === 0;
    if (kernel) await sh('ip', ['link', 'del', 'obwgprobe']);
    else if (!(await has('wireguard-go'))) t.skip('ni module WireGuard dans le noyau, ni wireguard-go');
    t.note(kernel ? 'WireGuard du noyau.' : 'WireGuard en espace utilisateur (wireguard-go) : le noyau de cette machine n\'a pas le module.');
    if (existsSync(`/etc/wireguard/${IFACE}.conf`)) t.skip(`/etc/wireguard/${IFACE}.conf existe déjà : le banc n'y touche pas`);

    // Réseaux : « Internet » entre le téléphone et la maison ; réseau local de la maison avec un NAS.
    for (const ns of [TEL, NAS]) { await sh('ip', ['netns', 'del', ns]); if ((await sh('ip', ['netns', 'add', ns])).code) t.skip('impossible de créer un réseau isolé (netns)'); }
    t.onEnd(async () => { for (const l of ['ob-s', 'ob-l']) await sh('ip', ['link', 'del', l]); for (const ns of [TEL, NAS]) await sh('ip', ['netns', 'del', ns]); });
    const ip = async (...a: string[]) => { const r = await sh('ip', a); if (r.code) t.skip(`réseau d'essai impossible : ${r.err.trim()}`); };
    await ip('link', 'add', 'ob-s', 'type', 'veth', 'peer', 'name', 'ob-t'); await ip('link', 'set', 'ob-t', 'netns', TEL);
    await ip('addr', 'add', '10.99.0.1/24', 'dev', 'ob-s'); await ip('link', 'set', 'ob-s', 'up');
    await ip('-n', TEL, 'addr', 'add', '10.99.0.2/24', 'dev', 'ob-t'); await ip('-n', TEL, 'link', 'set', 'ob-t', 'up'); await ip('-n', TEL, 'link', 'set', 'lo', 'up');
    await ip('link', 'add', 'ob-l', 'type', 'veth', 'peer', 'name', 'ob-n'); await ip('link', 'set', 'ob-n', 'netns', NAS);
    await ip('addr', 'add', '192.168.77.1/24', 'dev', 'ob-l'); await ip('link', 'set', 'ob-l', 'up');
    await ip('-n', NAS, 'addr', 'add', '192.168.77.10/24', 'dev', 'ob-n'); await ip('-n', NAS, 'link', 'set', 'ob-n', 'up'); await ip('-n', NAS, 'link', 'set', 'lo', 'up');
    // Le NAS : un petit serveur web qui dit qui lui parle.
    t.spawn('ip', ['netns', 'exec', NAS, process.execPath, '-e', `require('http').createServer((q,r)=>r.end('NAS vu depuis '+q.socket.remoteAddress)).listen(8080,'192.168.77.10')`]);
    const fromPhone = async (url: string) => (await sh('ip', ['netns', 'exec', TEL, process.execPath, '-e',
      `const q=require('http').get('${url}',{timeout:2500},(r)=>{let d='';r.on('data',(c)=>d+=c);r.on('end',()=>{console.log(d);process.exit(0)})});q.on('timeout',()=>{console.log('COUPE');process.exit(0)});q.on('error',()=>{console.log('COUPE');process.exit(0)})`], { timeoutMs: 9000 })).out.trim();

    const { v, events } = t.valhalla([gjoll]);
    const ctx = v.ctx('gjoll'), port = await freeUdp();
    const sv: Server = { ...keypair(), net: '10.213.77', port, endpoint: '10.99.0.1', dns: '192.168.77.1', iface: IFACE, lan: ['192.168.77.0/24'] };
    ctx.saveSettings({ server: sv });
    t.onEnd(async () => { await sh('wg-quick', ['down', IFACE], { timeoutMs: 20_000 }); rmSync(`/etc/wireguard/${IFACE}.conf`, { force: true }); });

    t.eq(await fromPhone('http://192.168.77.10:8080/'), 'COUPE', 'avant : le téléphone, dehors, ne voit pas le NAS de la maison');
    t.ok((await v.act('gjoll', 'ajouter', { nom: 'x' }, { auto: true })).ok === false, 'ouvrir un accès VPN est refusé sans ton accord (automatisation)');

    const add = await v.act('gjoll', 'ajouter', { nom: 'Téléphone', tout: false });
    t.ok(add.ok && /Tunnel obwg0 à jour/.test(add.text), 'appareil ajouté et tunnel allumé sur la maison', add.text);
    t.match((await sh('wg', ['show', IFACE, 'listen-port'])).out.trim(), new RegExp(`^${port}$`), 'le tunnel écoute sur le port choisi');

    const qr = await v.act('gjoll', 'qr', { nom: 'Téléphone' });
    const data = qr.data as { svg: string; conf: string };
    t.ok(/<svg/.test(data.svg) && /AllowedIPs = 10\.213\.77\.0\/24, 192\.168\.77\.0\/24/.test(data.conf) && /DNS = 192\.168\.77\.1/.test(data.conf), 'QR code prêt : la configuration ouvre le VPN et le réseau de la maison', data.conf.replace(/(PrivateKey|PresharedKey) = .*/g, '$1 = •••'));

    // Le téléphone « scanne » : il utilise exactement cette configuration (sans la ligne DNS, inutile ici).
    const telConf = join(t.tmp(), 'obtel0.conf');
    writeFileSync(telConf, data.conf.replace(/^DNS = .*\n/m, ''), { mode: 0o600 });
    const up = await sh('ip', ['netns', 'exec', TEL, 'wg-quick', 'up', telConf], { timeoutMs: 30_000 });
    t.onEnd(() => sh('ip', ['netns', 'exec', TEL, 'wg-quick', 'down', telConf], { timeoutMs: 20_000 }));
    t.ok(up.code === 0, 'le téléphone monte le tunnel avec la configuration d\'Odin', up.err.split('\n').slice(-3).join(' | '));

    // La maison répond sur son adresse du VPN (10.213.77.1) : joignable seulement par le tunnel.
    const house = createServer((_q, r) => r.end('maison')); await new Promise<void>((r) => house.listen(8081, '10.213.77.1', r)); t.onEnd(() => house.close());
    t.ok(await until(async () => (await fromPhone('http://10.213.77.1:8081/')) === 'maison', 12_000, 500), 'le téléphone joint la maison par le tunnel chiffré');
    const hs = Number((await sh('wg', ['show', IFACE, 'latest-handshakes'])).out.trim().split(/\s+/)[1] ?? 0);
    t.ok(hs > 0 && Date.now() / 1000 - hs < 120, 'poignée de main WireGuard faite (échange de clés réussi)');
    const seen = await fromPhone('http://192.168.77.10:8080/');
    t.match(seen, /^NAS vu depuis 192\.168\.77\.1$/, 'le téléphone atteint le NAS de la maison à travers le VPN');
    t.match((await v.act('gjoll', 'appareils')).text, /Téléphone \(10\.213\.77\.2\) · connecté/, 'Gjöll voit l\'appareil connecté');
    await gjoll.watch!.run(ctx);
    t.ok(events.some((e) => e.type === 'vpn_connecte' && e.data.appareil === 'Téléphone'), 'événement « appareil connecté au VPN » émis');
    const view = await gjoll.view(ctx, new URLSearchParams());
    t.ok(view.kpis?.some((k) => k.label === 'Connectés' && k.value === '1'), 'la page indique 1 appareil connecté');

    const off = await v.act('gjoll', 'activer', { nom: 'Téléphone', actif: false });
    t.ok(off.ok && await until(async () => (await fromPhone('http://192.168.77.10:8080/')) === 'COUPE', 8000, 500), 'désactivé : le téléphone ne passe plus', off.text);
    const on = await v.act('gjoll', 'activer', { nom: 'Téléphone', actif: true });
    t.ok(on.ok && await until(async () => /^NAS vu/.test(await fromPhone('http://192.168.77.10:8080/')), 12_000, 500), 'réactivé : il repasse, sans couper le tunnel', on.text);
    const rev = await v.act('gjoll', 'revoquer', { nom: 'Téléphone' });
    t.ok(rev.ok && await until(async () => (await fromPhone('http://192.168.77.10:8080/')) === 'COUPE', 8000, 500) && !(await sh('wg', ['show', IFACE, 'peers'])).out.trim(), 'révoqué : sa clé n\'existe plus sur la maison', rev.text);

    // Mode « tout le trafic » : seulement la configuration (le routage complet d'un téléphone ne se simule pas ici).
    await v.act('gjoll', 'ajouter', { nom: 'Portable', tout: true });
    const full = ((await v.act('gjoll', 'qr', { nom: 'Portable' })).data as { conf: string }).conf;
    t.match(full, /AllowedIPs = 0\.0\.0\.0\/0, ::\/0/, 'mode « tout le trafic » : la configuration envoie tout par la maison');
    const conf = (await sh('cat', [`/etc/wireguard/${IFACE}.conf`])).out;
    t.ok(/PostUp = .*MASQUERADE|PostUp = .*masquerade/.test(conf) && /ip_forward=1/.test(conf), 'la maison fait suivre le trafic du VPN (Internet et réseau local)');
  },
};
