// Loki — un seul moteur de pièges à pirates, avec un module par protocole. Chaque piège imite un
// service vulnérable, note tout (adresse, identifiants essayés, commandes, fichiers envoyés), capture
// les logiciels malveillants pour Ullr, et fait bannir l'attaquant de tes vrais services par Garmr.
// Les pièges sont éteints par défaut : tu choisis lesquels allumer et sur quels ports.

import { createHash, randomBytes } from 'node:crypto';
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, isIP, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { isPrivateV4 } from '../../hlidskjalf/discover.ts';
import type { ModCtx, Module } from '../types.ts';

export interface Trap { id: string; name: string; proto: string; what: string; port: number; udp?: boolean }
export const TRAPS: Trap[] = [
  { id: 'narfi', name: 'Narfi', proto: 'Telnet', what: 'faux terminal : identifiants et commandes des robots, téléchargements capturés', port: 2323 },
  { id: 'fenrir', name: 'Fenrir', proto: 'SSH (enlisement)', what: 'retient les robots SSH des heures en leur envoyant une bannière sans fin', port: 2222 },
  { id: 'sshid', name: 'Narfi-SSH', proto: 'SSH (identification)', what: 'note la version et l\'outil de chaque robot SSH', port: 2200 },
  { id: 'skoll', name: 'Sköll', proto: 'Web', what: 'faux site (WordPress, phpMyAdmin, .env) : chemins sondés et mots de passe essayés', port: 8081 },
  { id: 'hel', name: 'Hel', proto: 'Elasticsearch', what: 'fausse base Elasticsearch ouverte', port: 9201 },
  { id: 'thrym', name: 'Thrym', proto: 'Redis', what: 'faux Redis sans mot de passe : commandes d\'attaque notées', port: 6380 },
  { id: 'skrymir', name: 'Skrymir', proto: 'Mail (SMTP)', what: 'faux relais de mail : identifiants et spams capturés', port: 2525 },
  { id: 'jormungandr', name: 'Jörmungandr', proto: 'FTP', what: 'faux FTP : identifiants et fichiers déposés capturés', port: 2121 },
  { id: 'muspel', name: 'Muspel', proto: 'Modbus (automates)', what: 'faux automate industriel', port: 5020 },
  { id: 'bergelmir', name: 'Bergelmir', proto: 'Android ADB', what: 'faux téléphone Android en débogage ouvert', port: 5556 },
  { id: 'logi', name: 'Logi', proto: 'Téléphonie (SIP)', what: 'fausse centrale téléphonique : tentatives d\'appels frauduleux', port: 5061, udp: true },
  { id: 'hraesvelg', name: 'Hræsvelg', proto: 'Amplification (UDP)', what: 'repère les attaques par déni de service sans jamais répondre', port: 11212, udp: true },
  { id: 'surtr', name: 'Surtr', proto: 'Tous ports', what: 'piège à tout : note les premiers octets sur des ports choisis', port: 2375 },
];

export interface Hit { at: string; trap: string; ip: string; port: number; kind: 'connexion' | 'identifiants' | 'commande' | 'requête' | 'capture'; detail: string }

const FAKE_PASSWD = 'root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\nadmin:x:1000:1000:admin:/home/admin:/bin/bash\n';
/** Réponses du faux terminal (Narfi). */
export function fakeShell(cmd: string): string {
  const c = cmd.trim(), first = c.split(/\s+/)[0];
  if (!c) return '';
  if (/^uname/.test(c)) return 'Linux srv-prod 5.15.0-91-generic #101-Ubuntu SMP x86_64 GNU/Linux';
  if (first === 'whoami') return 'root';
  if (first === 'id') return 'uid=0(root) gid=0(root) groups=0(root)';
  if (first === 'pwd') return '/root';
  if (first === 'ls') return 'backup.tar.gz  notes.txt  scripts';
  if (/^cat .*\/etc\/passwd/.test(c)) return FAKE_PASSWD.trim();
  if (/^cat .*\/proc\/cpuinfo/.test(c)) return 'processor\t: 0\nmodel name\t: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz\nprocessor\t: 1';
  if (/^(wget|curl|tftp|ftpget)\b/.test(c)) return `${first}: connexion à l'hôte… terminé.`;
  if (/^(cd|chmod|rm|echo|export|history|unset|nohup|sh|bash)\b/.test(c)) return '';
  if (first === 'ps') return '  PID TTY          TIME CMD\n    1 ?        00:00:03 systemd\n  612 ?        00:00:00 sshd\n  901 pts/0    00:00:00 bash';
  if (first === 'free') return '              total        used        free\nMem:        8152004     2134512     6017492';
  if (first === 'exit' || first === 'logout') return '__EXIT__';
  return `-bash: ${first}: command not found`;
}
export const urlsIn = (c: string) => [...c.matchAll(/(https?|ftp):\/\/[^\s'";|&]+/g)].map((m) => m[0]);

export class LokiEngine {
  private servers = new Map<string, Server | UdpSocket>();
  private ctx: ModCtx;
  constructor(ctx: ModCtx) { this.ctx = ctx; }
  get home() { return this.ctx.dir; }
  get file() { return join(this.ctx.dir, 'attaques.jsonl'); }
  record(h: Omit<Hit, 'at'>): void {
    const hit: Hit = { ...h, at: this.ctx.now().toISOString() };
    appendFileSync(this.file, `${JSON.stringify(hit)}\n`);
    this.ctx.emit('piege', { piège: h.trap, ip: h.ip, type: h.kind, détail: h.detail });
    const counts = (this.ctx.settings.byIp as Record<string, number> | undefined) ?? {};
    counts[h.ip] = (counts[h.ip] ?? 0) + 1; this.ctx.saveSettings({ byIp: counts });
    if ((h.kind === 'identifiants' || h.kind === 'commande' || h.kind === 'capture') && this.ctx.settings.ban !== false && isIP(h.ip) && !isPrivateV4(h.ip)) void this.ctx.call('garmr', 'bannir', { ip: h.ip, raison: `piège ${h.trap} (${h.kind})`, source: 'Loki', minutes: 1440 }).catch(() => undefined);
  }
  async capture(trap: string, ip: string, url: string): Promise<void> {
    // On ne va chercher que des adresses publiques (jamais ton réseau), 10 Mo au plus ; rien n'est exécuté.
    try {
      const host = new URL(url).hostname; if (isPrivateV4(host) || host === 'localhost') return;
      const r = await this.ctx.fetch(url, { signal: AbortSignal.timeout(20_000) }); if (!r.ok) return;
      const buf = Buffer.from(await r.arrayBuffer()).subarray(0, 10 * 1024 * 1024);
      const dir = join(this.ctx.dir, 'captures'); mkdirSync(dir, { recursive: true, mode: 0o700 });
      const sha = createHash('sha256').update(buf).digest('hex'), f = join(dir, `${sha}.bin`);
      writeFileSync(f, buf, { mode: 0o600 });
      this.record({ trap, ip, port: 0, kind: 'capture', detail: `${url} → ${sha.slice(0, 16)}… (${buf.length} o)` });
      // Le fichier reste à l'écart (jamais exécuté) ; le verdict d'Ullr part avec l'alerte.
      const verdict = await this.ctx.call('ullr', 'fichier', { chemin: f }).then((r) => (r.ok === false ? '' : r.text.split('\n')[0]), () => '');
      this.ctx.alert({ level: 'haute', title: 'Loki a capturé un fichier déposé par un pirate', detail: `${url} envoyé par ${ip} — ${buf.length} octets, gardé à l'écart (jamais exécuté). Ullr : ${verdict || 'analyse indisponible'}`, key: `cap:${sha}`, data: { fichier: f, verdict } });
    } catch { /* téléchargement impossible */ }
  }
  private tcp(t: Trap, onConn: (s: Socket, ip: string) => void): Server {
    const srv = createServer((sock) => {
      const ip = (sock.remoteAddress ?? '').replace(/^::ffff:/, '');
      sock.setTimeout(t.id === 'fenrir' ? 0 : 120_000, () => sock.destroy());
      sock.on('error', () => {});
      this.record({ trap: t.name, ip, port: t.port, kind: 'connexion', detail: t.proto });
      onConn(sock, ip);
    });
    srv.maxConnections = 200;
    return srv;
  }
  private lines(sock: Socket, on: (line: string) => void): void { let buf = ''; sock.on('data', (d) => { buf += d.toString('latin1').replace(/\xff[\xfb-\xfe]./g, ''); if (buf.length > 65536) { sock.destroy(); return; } let i; while ((i = buf.search(/\r?\n/)) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + (buf[i] === '\r' ? 2 : 1)); on(l); } }); }
  build(t: Trap): Server | UdpSocket {
    const rec = (ip: string, kind: Hit['kind'], detail: string) => this.record({ trap: t.name, ip, port: t.port, kind, detail: detail.slice(0, 500) });
    switch (t.id) {
      case 'fenrir': return this.tcp(t, (s) => { const iv = setInterval(() => { if (s.destroyed) return clearInterval(iv); s.write(`${randomBytes(8).toString('hex')}\r\n`); }, 10_000); s.on('close', () => clearInterval(iv)); });
      case 'sshid': return this.tcp(t, (s, ip) => { s.write('SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.6\r\n'); s.once('data', (d) => { rec(ip, 'requête', `client : ${d.toString('latin1').split('\r\n')[0].slice(0, 120)}`); s.end(); }); });
      case 'narfi': return this.tcp(t, (s, ip) => {
        let stage = 0, user = '';
        s.write('\r\nUbuntu 22.04.3 LTS\r\nsrv-prod login: ');
        this.lines(s, (l) => {
          if (stage === 0) { user = l.trim(); stage = 1; s.write('Password: '); return; }
          if (stage === 1) { rec(ip, 'identifiants', `${user} / ${l.trim()}`); stage = 2; s.write('\r\nWelcome to Ubuntu 22.04.3 LTS\r\n\r\nroot@srv-prod:~# '); return; }
          rec(ip, 'commande', l);
          for (const u of urlsIn(l)) void this.capture(t.name, ip, u);
          const out = fakeShell(l); if (out === '__EXIT__') { s.end('logout\r\n'); return; }
          s.write(`${out ? `${out.replace(/\n/g, '\r\n')}\r\n` : ''}root@srv-prod:~# `);
        });
      });
      case 'skoll': return this.tcp(t, (s, ip) => {
        let raw = '';
        s.on('data', (d) => {
          raw += d.toString('latin1'); if (!raw.includes('\r\n\r\n') && raw.length < 16384) return;
          const [head, body = ''] = raw.split('\r\n\r\n'), [line] = head.split('\r\n'), path = line.split(' ')[1] ?? '/';
          const ua = /user-agent:\s*(.*)/i.exec(head)?.[1] ?? '';
          rec(ip, 'requête', `${line.slice(0, 200)} · ${ua.slice(0, 80)}`);
          const creds = /(?:log|user(?:name)?|pma_username)=([^&]*)&(?:pwd|pass(?:word)?|pma_password)=([^&]*)/i.exec(body);
          if (creds) rec(ip, 'identifiants', `${decodeURIComponent(creds[1])} / ${decodeURIComponent(creds[2])}`);
          let page = '<html><head><title>Log In &lsaquo; Blog &#8212; WordPress</title></head><body class="login"><form name="loginform" method="post" action="/wp-login.php"><input name="log"><input type="password" name="pwd"><input type="submit" value="Log In"></form></body></html>';
          if (/\.env/.test(path)) page = 'APP_ENV=production\nDB_HOST=127.0.0.1\nDB_USERNAME=app\nDB_PASSWORD=Pr0d-2024!\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n';
          else if (/phpmyadmin|pma/i.test(path)) page = '<html><head><title>phpMyAdmin</title></head><body><form method="post"><input name="pma_username"><input type="password" name="pma_password"></form></body></html>';
          s.end(`HTTP/1.1 ${creds ? 302 : 200} OK\r\nServer: Apache/2.4.52 (Ubuntu)\r\nX-Powered-By: PHP/7.4.3\r\nContent-Type: text/html\r\nContent-Length: ${Buffer.byteLength(page)}\r\nConnection: close\r\n${creds ? 'Location: /wp-admin/\r\n' : ''}\r\n${page}`);
        });
      });
      case 'hel': return this.tcp(t, (s, ip) => { s.once('data', (d) => { rec(ip, 'requête', d.toString('latin1').split('\r\n')[0].slice(0, 200)); const b = JSON.stringify({ name: 'prod-es-01', cluster_name: 'elasticsearch', version: { number: '7.10.2' }, tagline: 'You Know, for Search' }); s.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${b.length}\r\n\r\n${b}`); }); });
      case 'thrym': return this.tcp(t, (s, ip) => { this.lines(s, (l) => { if (!l || /^[*$]/.test(l)) return; rec(ip, 'commande', l); for (const u of urlsIn(l)) void this.capture(t.name, ip, u); const c = l.trim().split(/\s+/)[0].toUpperCase(); s.write(c === 'PING' ? '+PONG\r\n' : c === 'INFO' ? '$61\r\n# Server\r\nredis_version:5.0.7\r\nos:Linux 5.15.0 x86_64\r\nrole:master\r\n' : '+OK\r\n'); }); });
      case 'skrymir': return this.tcp(t, (s, ip) => {
        let data = false, mail = '';
        s.write('220 mail.srv-prod.local ESMTP Postfix (Ubuntu)\r\n');
        this.lines(s, (l) => {
          if (data) { if (l === '.') { data = false; rec(ip, 'capture', `courrier de ${mail.length} caractères : ${mail.slice(0, 200)}`); s.write('250 2.0.0 Ok: queued\r\n'); mail = ''; } else if (mail.length < 200_000) mail += `${l}\n`; return; }
          const c = l.slice(0, 4).toUpperCase();
          if (c === 'AUTH') { const b = l.split(' ')[2]; if (b) rec(ip, 'identifiants', Buffer.from(b, 'base64').toString('utf8').replace(/\0/g, ' / ').trim()); s.write('235 2.7.0 Authentication successful\r\n'); }
          else if (c === 'EHLO' || c === 'HELO') s.write('250-mail.srv-prod.local\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
          else if (c === 'DATA') { data = true; s.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
          else if (c === 'QUIT') s.end('221 2.0.0 Bye\r\n');
          else { rec(ip, 'commande', l); s.write('250 2.1.0 Ok\r\n'); }
        });
      });
      case 'jormungandr': return this.tcp(t, (s, ip) => {
        let user = '';
        s.write('220 (vsFTPd 3.0.3)\r\n');
        this.lines(s, (l) => {
          const [c, ...a] = l.split(' '), arg = a.join(' ');
          switch (c.toUpperCase()) {
            case 'USER': user = arg; s.write('331 Please specify the password.\r\n'); break;
            case 'PASS': rec(ip, 'identifiants', `${user} / ${arg}`); s.write('230 Login successful.\r\n'); break;
            case 'SYST': s.write('215 UNIX Type: L8\r\n'); break;
            case 'PWD': s.write('257 "/" is the current directory\r\n'); break;
            case 'QUIT': s.end('221 Goodbye.\r\n'); break;
            default: rec(ip, 'commande', l); s.write(/^(STOR|RETR|PASV|PORT|LIST)/i.test(c) ? '425 Use PORT or PASV first.\r\n' : '200 OK.\r\n');
          }
        });
      });
      case 'muspel': return this.tcp(t, (s, ip) => { s.on('data', (d) => { if (d.length < 8) return; rec(ip, 'requête', `Modbus fonction ${d[7]} (unité ${d[6]})`); const tid = d.subarray(0, 2), fn = d[7]; const regs = Buffer.from([0x00, 0x2a, 0x01, 0x5e, 0x00, 0x00, 0x03, 0xe8]); const pdu = fn === 3 || fn === 4 ? Buffer.concat([Buffer.from([fn, regs.length]), regs]) : Buffer.from([fn | 0x80, 0x01]); const mb = Buffer.alloc(7); tid.copy(mb, 0); mb.writeUInt16BE(0, 2); mb.writeUInt16BE(pdu.length + 1, 4); mb[6] = d[6]; s.write(Buffer.concat([mb, pdu])); }); });
      case 'bergelmir': return this.tcp(t, (s, ip) => { s.once('data', (d) => { rec(ip, 'requête', `ADB : ${d.toString('latin1').replace(/[^\x20-\x7e]/g, '.').slice(0, 160)}`); s.end(); }); });
      case 'surtr': return this.tcp(t, (s, ip) => { s.once('data', (d) => { rec(ip, 'requête', d.toString('latin1').replace(/[^\x20-\x7e]/g, '.').slice(0, 200)); s.end(); }); });
      case 'logi': case 'hraesvelg': {
        const u = createSocket('udp4');
        u.on('message', (m, r) => {
          const ip = r.address; this.record({ trap: t.name, ip, port: t.port, kind: 'requête', detail: m.toString('latin1').split('\r\n')[0].replace(/[^\x20-\x7e]/g, '.').slice(0, 200) });
          // Logi répond comme une vraie centrale (petite réponse) ; Hræsvelg ne répond jamais (pas d'amplification).
          if (t.id === 'logi' && /^(REGISTER|INVITE|OPTIONS)/.test(m.toString('latin1'))) { const via = /^(Via:.*)$/mi.exec(m.toString('latin1'))?.[1] ?? ''; u.send(`SIP/2.0 401 Unauthorized\r\n${via}\r\nWWW-Authenticate: Digest realm="asterisk", nonce="${randomBytes(8).toString('hex')}"\r\nContent-Length: 0\r\n\r\n`, r.port, ip); }
        });
        u.on('error', () => {});
        return u;
      }
      default: throw new Error(`piège inconnu : ${t.id}`);
    }
  }
  start(t: Trap, port = t.port): Promise<void> {
    return new Promise((res, rej) => {
      const s = this.build(t);
      if ('bind' in s && t.udp) { (s as UdpSocket).once('error', rej); (s as UdpSocket).bind(port, () => { this.servers.set(t.id, s); res(); }); }
      else { (s as Server).once('error', rej); (s as Server).listen(port, () => { this.servers.set(t.id, s); res(); }); }
    });
  }
  stop(id?: string): void { for (const [k, s] of [...this.servers]) if (!id || k === id) { try { 'close' in s && (s as Server).close(); } catch { /* déjà fermé */ } this.servers.delete(k); } }
  running(): string[] { return [...this.servers.keys()]; }
  hits(limit = 300): Hit[] { if (!existsSync(this.file)) return []; return readFileSync(this.file, 'utf8').trim().split('\n').slice(-limit).reverse().flatMap((l) => { try { return [JSON.parse(l) as Hit]; } catch { return []; } }); }
}

let engine: LokiEngine | undefined;
/** Un moteur par installation : si le contexte change (autre dossier d'Odin), l'ancien est arrêté. */
const eng = (ctx: ModCtx) => { if (engine && engine.home !== ctx.dir) { engine.stop(); engine = undefined; } return (engine ??= new LokiEngine(ctx)); };
const on = (ctx: ModCtx): Record<string, number> => (ctx.settings.on as Record<string, number> | undefined) ?? {};

export const loki: Module = {
  id: 'loki', name: 'Loki', family: 'Sécurité',
  what: 'Pièges à pirates : de faux services qui attirent les attaquants, notent tout et les font bannir.',
  does: TRAPS.map((t) => `${t.name} — ${t.proto} : ${t.what}`).concat(['identifiants essayés, commandes, chemins sondés : tout est noté', 'logiciels malveillants capturés et analysés par Ullr', 'attaquant banni de tes vrais services par Garmr', 'console centrale et statistiques (origine, protocoles, mots de passe les plus essayés)']),
  from: ['T-Pot', 'OpenCanary', 'Modern Honey Network', 'CommunityHoneyNetwork', 'Cowrie', 'Endlessh', 'Heralding', 'Dionaea', 'SNARE', 'TANNER', 'ElasticPot', 'RedisHoneyPot', 'Mailoney', 'Wordpot', 'Honeytrap', 'Conpot', 'ADBHoney', 'DDoSPot', 'SentryPeer'],
  upstream: ['telekom-security/tpotce', 'cowrie/cowrie', 'skeeto/endlessh', 'thinkst/opencanary', 'mushorg/conpot'],
  modes: TRAPS.map((t) => `${t.name} · ${t.proto}`),
  words: ['piege', 'piège', 'pieges', 'pièges', 'honeypot', 'pirate', 'pirates', 'attaquant', 'attaquants', 'leurre', 'tarpit'],
  actions: [
    { id: 'allumer', undo: (i) => ({ action: 'eteindre', input: { piege: i.piege }, label: 'piège éteint' }), label: 'Allumer un piège', what: 'Démarre un piège sur un port', params: [{ key: 'piege', label: 'Piège', kind: 'select', options: TRAPS.map((t) => t.id), required: true }, { key: 'port', label: 'Port (vide = par défaut)', kind: 'number' }], grave: (i) => `ouvrir le piège ${String(i.piege)} sur le réseau`, words: ['allume', 'active', 'ouvre'], run: async (ctx, i) => {
      const t = TRAPS.find((x) => x.id === String(i.piege) || x.name.toLowerCase() === String(i.piege).toLowerCase()); if (!t) throw new Error('piège inconnu');
      const port = Number(i.port) || t.port; eng(ctx).stop(t.id); await eng(ctx).start(t, port);
      ctx.saveSettings({ on: { ...on(ctx), [t.id]: port } });
      return { text: `🪤 ${t.name} (${t.proto}) écoute sur le port ${port}.${port >= 1024 ? ' Pour attirer les robots sur le port standard, ajoute une redirection sur ta box ou ton pare-feu.' : ''}` };
    } },
    { id: 'eteindre', label: 'Éteindre un piège', what: 'Arrête un piège', params: [{ key: 'piege', label: 'Piège', kind: 'select', options: TRAPS.map((t) => t.id), required: true }], run: (ctx, i) => { eng(ctx).stop(String(i.piege)); const o = on(ctx); delete o[String(i.piege)]; ctx.saveSettings({ on: o }); return { text: `⏹ ${String(i.piege)} éteint.` }; } },
    { id: 'activite', external: true, label: 'Activité des pièges', what: 'Ce que les pirates ont tenté', read: true, words: ['activite', 'activité', 'attaques', 'quoi de neuf'], run: (ctx) => { const h = eng(ctx).hits(40); return { text: h.map((x) => `- ${x.at.slice(5, 16).replace('T', ' ')} ${x.trap} · ${x.ip} · ${x.kind} : ${x.detail}`).join('\n') || 'Aucune activité.', data: h }; } },
    { id: 'statistiques', label: 'Statistiques', what: 'Origines, mots de passe essayés, pièges les plus touchés', read: true, run: (ctx) => { const h = eng(ctx).hits(5000); const by = (k: (x: Hit) => string) => Object.entries(h.reduce<Record<string, number>>((a, x) => { const v = k(x); if (v) a[v] = (a[v] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8); return { text: `Pièges : ${by((x) => x.trap).map(([k, v]) => `${k} ${v}`).join(', ')}\nAdresses : ${by((x) => x.ip).map(([k, v]) => `${k} (${v})`).join(', ')}\nIdentifiants les plus essayés : ${by((x) => (x.kind === 'identifiants' ? x.detail : '')).map(([k, v]) => `${k} ×${v}`).join(', ') || '—'}` }; } },
  ],
  async start(ctx) { for (const [id, port] of Object.entries(on(ctx))) { const t = TRAPS.find((x) => x.id === id); if (t) await eng(ctx).start(t, port).catch((e) => ctx.alert({ level: 'moyenne', title: `Piège ${t.name} : port ${port} indisponible`, detail: (e as Error).message, key: `port:${id}` })); } },
  stop() { engine?.stop(); },
  view(ctx) {
    const e = eng(ctx), h = e.hits(2000), day = h.filter((x) => Date.now() - Date.parse(x.at) < 86_400_000), ips = new Set(day.map((x) => x.ip));
    const creds = Object.entries(h.filter((x) => x.kind === 'identifiants').reduce<Record<string, number>>((a, x) => ({ ...a, [x.detail]: (a[x.detail] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return {
      subtitle: `${e.running().length} piège(s) allumé(s) sur ${TRAPS.length}`,
      tabs: TRAPS.map((t) => t.name),
      kpis: [{ label: 'Attaques 24 h', value: String(day.length) }, { label: 'Adresses uniques 24 h', value: String(ips.size) }, { label: 'Captures', value: String(h.filter((x) => x.kind === 'capture').length), tone: h.some((x) => x.kind === 'capture') ? 'attention' : 'neutre' }, { label: 'Pièges allumés', value: `${e.running().length} / ${TRAPS.length}` }],
      sections: [
        { kind: 'table', title: 'Pièges', columns: ['Piège', 'Protocole', 'Ce qu\'il fait', 'Port', 'État'], rows: TRAPS.map((t) => { const p = on(ctx)[t.id]; return { cells: [t.name, t.proto, t.what, String(p ?? t.port), e.running().includes(t.id) ? 'allumé' : 'éteint'], tone: e.running().includes(t.id) ? 'bon' : 'neutre', actions: [e.running().includes(t.id) ? { action: 'eteindre', label: 'Éteindre', input: { piege: t.id } } : { action: 'allumer', label: 'Allumer', input: { piege: t.id } }] }; }) },
        { kind: 'table', title: 'Activité récente', columns: ['Quand', 'Piège', 'Adresse', 'Type', 'Détail'], empty: 'Aucune activité pour l\'instant.', rows: h.slice(0, 60).map((x) => ({ cells: [x.at.slice(5, 16).replace('T', ' '), x.trap, x.ip, x.kind, x.detail], tone: x.kind === 'capture' ? 'mauvais' : x.kind === 'identifiants' ? 'attention' : undefined })) },
      ],
      side: [{ kind: 'list', title: 'Identifiants les plus essayés', items: creds.map(([k, v]) => ({ title: k, meta: `×${v}` })), empty: 'Rien encore.' }, { kind: 'text', title: 'Sécurité des pièges', text: 'Les pièges imitent des services sans jamais exécuter ce qu\'on leur envoie. Ils ne touchent pas à tes données. Les fichiers capturés restent isolés et sont analysés par Ullr.' }],
    };
  },
};
