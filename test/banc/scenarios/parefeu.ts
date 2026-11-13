// Cerbère contre le VRAI pare-feu (nftables) : un « attaquant » dans un réseau isolé essaie d'entrer,
// rate cinq mots de passe SSH, se fait bannir, et ses connexions sont vraiment coupées par le noyau.

import { createServer } from 'node:net';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { garmr } from '../../../src/valhalla/modules/garmr.ts';
import { sh, until, type Scenario } from '../lib.ts';

const NS = 'odinbanc-att', HOST_IP = '203.0.113.1', ATT_IP = '203.0.113.9';

export const parefeu: Scenario = {
  id: 'pare-feu', title: 'Cerbère ↔ pare-feu nftables', mode: 'réel',
  what: 'Un attaquant simulé dans un réseau isolé : échecs SSH lus dans un journal, bannissement, paquets vraiment bloqués, récidive, débannissement.',
  async run(t) {
    t.needRoot(); await t.need('nft', 'ip');
    if ((await sh('ip', ['netns', 'add', NS])).code !== 0) { await sh('ip', ['netns', 'del', NS]); if ((await sh('ip', ['netns', 'add', NS])).code !== 0) t.skip('impossible de créer un réseau isolé (netns)'); }
    t.onEnd(async () => { await sh('ip', ['link', 'del', 'ob-h']); await sh('ip', ['netns', 'del', NS]); });
    const hadTable = (await sh('nft', ['list', 'table', 'inet', 'odin'])).code === 0;
    t.onEnd(async () => { await sh('nft', ['delete', 'element', 'inet', 'odin', 'garmr4', `{ ${ATT_IP} }`]); if (!hadTable) await sh('nft', ['delete', 'table', 'inet', 'odin']); });
    for (const c of [['link', 'add', 'ob-h', 'type', 'veth', 'peer', 'name', 'ob-a'], ['link', 'set', 'ob-a', 'netns', NS], ['addr', 'add', `${HOST_IP}/24`, 'dev', 'ob-h'], ['link', 'set', 'ob-h', 'up'],
      ['-n', NS, 'addr', 'add', `${ATT_IP}/24`, 'dev', 'ob-a'], ['-n', NS, 'link', 'set', 'ob-a', 'up'], ['-n', NS, 'link', 'set', 'lo', 'up']]) {
      const r = await sh('ip', c); if (r.code) t.skip(`réseau isolé impossible : ${r.err.trim()}`);
    }
    // Le « vrai service » que l'attaquant vise.
    const srv = createServer((s) => { s.end('bienvenue\n'); }); await new Promise<void>((r) => srv.listen(0, HOST_IP, r));
    t.onEnd(() => srv.close());
    const port = (srv.address() as { port: number }).port;
    const attack = async () => (await sh('ip', ['netns', 'exec', NS, process.execPath, '-e',
      `const s=require('net').connect(${port},'${HOST_IP}');s.setTimeout(1500,()=>{console.log('BLOQUE');process.exit(0)});s.on('data',()=>{console.log('ENTRE');process.exit(0)});s.on('error',()=>{console.log('BLOQUE');process.exit(0)})`], { timeoutMs: 8000 })).out.trim();

    const { v, alerts, events } = t.valhalla([garmr]);
    const ctx = v.ctx('garmr'), log = join(t.tmp(), 'auth.log');
    // Seul ce journal d'essai est lu : les vrais journaux de la machine ne sont pas touchés par le banc.
    writeFileSync(log, ''); ctx.saveSettings({ logs: [log], useJournal: false, useSystemLogs: false });
    await garmr.start!(ctx);
    t.match((await sh('nft', ['list', 'chain', 'inet', 'odin', 'entree'])).out, /ip saddr @garmr4 drop/, 'Cerbère a posé sa règle dans le pare-feu');
    t.ok(await until(async () => (await attack()) === 'ENTRE', 5000), 'avant : l\'attaquant atteint le service');

    // Première lecture (rien), puis cinq mots de passe ratés.
    await garmr.watch!.run(ctx);
    for (let i = 0; i < 5; i++) appendFileSync(log, `Nov 11 10:00:0${i} serveur sshd[1234]: Failed password for root from ${ATT_IP} port 4${i}000 ssh2\n`);
    await garmr.watch!.run(ctx);
    t.ok(alerts.some((a) => a.title === `${ATT_IP} banni`), 'cinq échecs SSH lus dans le journal → bannissement et alerte', JSON.stringify(alerts));
    t.ok(events.some((e) => e.type === 'banni' && e.data.ip === ATT_IP), 'événement « banni » émis');
    t.match((await sh('nft', ['list', 'set', 'inet', 'odin', 'garmr4'])).out, new RegExp(`${ATT_IP.replace(/\./g, '\\.')} timeout 1h`), 'l\'adresse est dans le pare-feu pour 1 h');
    t.eq(await attack(), 'BLOQUE', 'après : les connexions de l\'attaquant sont vraiment coupées');
    t.match((await v.act('garmr', 'bannis')).text, new RegExp(ATT_IP.replace(/\./g, '\\.')), 'la liste des bannis le montre');

    const un = await v.act('garmr', 'debannir', { ip: ATT_IP });
    t.ok(un.ok && (await attack()) === 'ENTRE', 'débanni : il passe de nouveau', un.text);
    const again = await v.act('garmr', 'bannir', { ip: ATT_IP, raison: 'récidive' });
    t.match(again.text, /4 h.*récidive n°2/, 'récidive : durée multipliée par 4');
    t.eq(await attack(), 'BLOQUE', 'récidive : bloqué de nouveau');

    // Redémarrage de la machine simulé : le pare-feu a tout oublié, Cerbère remet les bannissements valables.
    await sh('nft', ['flush', 'set', 'inet', 'odin', 'garmr4']);
    t.eq(await attack(), 'ENTRE', '(pare-feu vidé : il repasse)');
    await garmr.start!(ctx);
    t.eq(await attack(), 'BLOQUE', 'au redémarrage, Cerbère remet les bannissements encore valables');

    t.match((await v.act('garmr', 'bannir', { ip: '192.168.1.10' })).text, /protégée/, 'le réseau local n\'est jamais banni');
    await v.act('garmr', 'proteger', { ip: '198.51.100.7' });
    t.match((await v.act('garmr', 'bannir', { ip: '198.51.100.7' })).text, /protégée/, 'une adresse de la liste blanche n\'est jamais bannie');
    t.match((await v.act('garmr', 'bannir', { ip: '1.2.3.4; nft flush ruleset' })).text, /invalide/, 'une adresse piégée est refusée');
  },
};
