// Le serveur DNS de Víðarr : il écoute (UDP et TCP), reconnaît l'appareil qui demande, applique ses
// règles (réécritures locales, exceptions, services coupés, recherche sécurisée, listes, menaces), répond
// tout de suite pour ce qui est bloqué, cherche le reste (cache, puis amont), vérifie aussi les alias
// de la réponse, et note tout dans le journal (requêtes, temps, qui, pourquoi).

import dgram from 'node:dgram';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { RCODE, TYPE, dataText, parse, query as mkQuery, rdata, reuse, respond, typeName, type Answer, type Message } from './wire.ts';
import { addRule, cleanDomain, emptyList, judge, safeSearchFor, servicesList, type Compiled, type Verdict } from './rules.ts';
import { DnsCache, forward, parseUpstream, type Forwarder, type RecursiveOpts } from './resolve.ts';

export interface ClientRule {
  id: string; name: string;
  /** adresses IP ou réseaux (192.168.1.20, 10.8.0.0/24) */
  ids: string[];
  /** filtrage : 'global' (comme tout le monde), 'oui', 'non' */
  filtering?: 'global' | 'oui' | 'non';
  parental?: boolean; safeSearch?: boolean; services?: string[];
  /** serveurs amont propres à cet appareil (vide = ceux de tout le monde) */
  upstreams?: string[];
  /** liste blanche : cet appareil ne peut joindre que ces domaines */
  onlyThese?: string[];
}
export interface LogEntry { t: number; client: string; clientName?: string; name: string; type: string; status: 'ok' | 'cache' | 'bloqué' | 'réécrit' | 'erreur' | 'refusé'; rule?: string; list?: string; upstream?: string; ms: number; answer?: string; rcode: string }
export interface Lists { name: string; c: Compiled; kind: 'blocage' | 'menace' | 'parental' | 'autorisation' }
export interface DnsSettings {
  filtering: boolean; mode: 'ip_nulle' | 'nxdomain' | 'refuse' | 'ip_perso'; blockIp4?: string; blockIp6?: string; blockTtl: number;
  upstreams: string[]; fallback: string[]; strategy: 'parallele' | 'ordre' | 'rapide';
  cache: { size: number; minTtl: number; maxTtl: number; optimistic: boolean };
  rateLimit: number; refuseAny: boolean; safeSearch: boolean; parental: boolean; services: string[];
  /** jusqu'à quand le filtrage est en pause (ms) */
  pausedUntil?: number;
  /** noms locaux : domaine → adresses ou nom (réécritures, zones de la maison) */
  rewrites: Record<string, string[]>;
  clients: ClientRule[];
  /** domaines bloqués / autorisés à la main (règles perso, même syntaxe que les listes) */
  custom: string[];
  /** bloquer les noms en .local / sans point vers l'extérieur, et les PTR des adresses privées */
  privateReverse: boolean;
}
export const DEFAULTS: DnsSettings = {
  filtering: true, mode: 'ip_nulle', blockTtl: 10, upstreams: ['https://dns.quad9.net/dns-query', 'https://cloudflare-dns.com/dns-query'], fallback: ['9.9.9.9', '1.1.1.1'], strategy: 'rapide',
  cache: { size: 10_000, minTtl: 0, maxTtl: 86400, optimistic: true }, rateLimit: 50, refuseAny: true, safeSearch: false, parental: false, services: [],
  rewrites: {}, clients: [], custom: [], privateReverse: true,
};

const ip4 = (s: string) => { const p = s.split('.').map(Number); return p.length === 4 && p.every((x) => x >= 0 && x < 256) ? ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0 : undefined; };
export function ipMatches(spec: string, ip: string): boolean {
  const a = ip.replace(/^::ffff:/, '');
  if (!spec.includes('/')) return spec === a;
  const [net, b] = spec.split('/'), n = ip4(net), x = ip4(a), bits = Number(b);
  if (n === undefined || x === undefined || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((n & mask) >>> 0) === ((x & mask) >>> 0);
}
const PRIVATE_PTR = /\.(10|127|(1(6|7|8|9)|2\d|3[01])\.172|168\.192|254\.169)\.in-addr\.arpa$|^(?:\d+\.){0,3}(10|127)\.in-addr\.arpa$/;

export interface ServerDeps {
  settings: () => DnsSettings; lists: () => Lists[];
  /** nom d'un appareil d'après son adresse (registre des appareils, VPN) */
  nameOf?: (ip: string) => string | undefined;
  /** une machine a demandé un domaine de la liste des menaces */
  onThreat?: (e: LogEntry) => void;
  /** une machine dépasse la limite de requêtes */
  onFlood?: (ip: string, perSecond: number) => void;
  log?: (e: LogEntry) => void;
  now?: () => number; fetch?: typeof fetch; ca?: string | Buffer; recursive?: RecursiveOpts;
}

export class DnsServer {
  udp: dgram.Socket[] = []; tcp: net.Server[] = []; cache: DnsCache; port = 0; addresses: string[] = [];
  private rate = new Map<string, number[]>(); private flooded = new Map<string, number>();
  private now: () => number;
  private d: ServerDeps;
  constructor(d: ServerDeps) {
    this.d = d;
    this.now = d.now ?? Date.now;
    const c = d.settings().cache;
    this.cache = new DnsCache({ max: c.size, minTtl: c.minTtl, maxTtl: c.maxTtl, optimistic: c.optimistic, now: this.now });
  }

  /** Écoute sur `port` : toutes les adresses si possible, sinon chaque adresse de la machine une à une (quand un autre résolveur occupe 127.0.0.53). */
  async start(port: number, hosts?: string[]): Promise<string[]> {
    const bindUdp = (host: string) => new Promise<dgram.Socket>((ok, ko) => { const s = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4'); s.once('error', ko); s.bind(port, host, () => { s.off('error', ko); ok(s); }); });
    const bindTcp = (host: string, p: number) => new Promise<net.Server>((ok, ko) => { const s = net.createServer((c) => this.onTcp(c)); s.once('error', ko); s.listen(p, host, () => { s.off('error', ko); ok(s); }); });
    const tryHosts = async (list: string[]) => {
      for (const h of list) {
        try { const u = await bindUdp(h); const p = (u.address() as { port: number }).port; let t: net.Server; try { t = await bindTcp(h, p); } catch (e) { u.close(); throw e; } u.on('message', (m, r) => { void this.onUdp(u, m, r); }); this.udp.push(u); this.tcp.push(t); this.port = p; this.addresses.push(h); if (port === 0) port = p; } catch (e) { if (list.length === 1) throw e; }
      }
    };
    if (hosts?.length) await tryHosts(hosts);
    else {
      try { await tryHosts(['0.0.0.0']); } catch {
        const own = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4').map((i) => i!.address);
        await tryHosts([...new Set(['127.0.0.1', ...own])]);
      }
    }
    if (!this.udp.length) throw new Error(`le port ${port} est déjà pris sur cette machine`);
    return this.addresses;
  }
  stop(): void { for (const s of this.udp) s.close(); for (const s of this.tcp) s.close(); this.udp = []; this.tcp = []; this.addresses = []; }

  private async onUdp(s: dgram.Socket, m: Buffer, r: dgram.RemoteInfo): Promise<void> {
    let out = await this.handle(m, r.address);
    if (!out) return;
    // Réponse trop longue pour l'UDP sans EDNS : tronquée, le client repose la question en TCP.
    let limit = 512; try { const q = parse(m); const opt = q.ar.find((x) => x.type === TYPE.OPT); if (opt) limit = Math.max(512, Math.min(4096, opt.cls)); } catch { /* question illisible */ }
    if (out.length > limit) { try { out = respond(parse(m), { tc: true }); } catch { return; } }
    // Le serveur a pu être arrêté pendant qu'on cherchait la réponse : on n'écrit plus sur une prise fermée.
    if (!this.udp.includes(s)) return;
    try { s.send(out, r.port, r.address); } catch { /* prise fermée entre-temps */ }
  }
  private onTcp(c: net.Socket): void {
    let buf = Buffer.alloc(0); c.setTimeout(10_000, () => c.destroy());
    c.on('data', async (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) {
        const m = buf.subarray(2, 2 + buf.readUInt16BE(0)); buf = buf.subarray(2 + m.length);
        const out = await this.handle(m, c.remoteAddress ?? '');
        if (out && !c.destroyed) { const l = Buffer.alloc(2); l.writeUInt16BE(out.length); c.write(Buffer.concat([l, out])); }
      }
    });
    c.on('error', () => {});
  }

  /** Le client qui demande : sa fiche (par adresse) et son nom. */
  clientOf(ip: string): { rule?: ClientRule; name?: string } {
    const s = this.d.settings(), a = ip.replace(/^::ffff:/, '');
    const rule = s.clients.find((c) => c.ids.some((x) => ipMatches(x, a)));
    return { rule, name: rule?.name ?? this.d.nameOf?.(a) };
  }
  /** Pourquoi ce nom serait bloqué, autorisé ou réécrit pour cet appareil (sans rien demander dehors). */
  verdict(name: string, ip = ''): Verdict & { why?: string } | undefined {
    const s = this.d.settings(), { rule } = this.clientOf(ip), n = cleanDomain(name);
    const filtering = rule?.filtering === 'oui' ? true : rule?.filtering === 'non' ? false : s.filtering && !(s.pausedUntil && this.now() < s.pausedUntil);
    // Les noms de la maison passent toujours, même filtrage coupé.
    const local = s.rewrites[n] ?? Object.entries(s.rewrites).find(([k]) => k.startsWith('*.') && n.endsWith(k.slice(1)))?.[1];
    if (local) return { action: 'rewrite', rule: `${n} → ${local.join(', ')}`, list: 'Noms de la maison', to: local };
    if (rule?.onlyThese?.length && !rule.onlyThese.some((d) => n === cleanDomain(d) || n.endsWith(`.${cleanDomain(d)}`))) return { action: 'block', rule: 'pas dans la liste autorisée de cet appareil', list: rule.name };
    const lists = this.d.lists();
    // Les menaces sont bloquées même filtrage coupé (sauf exception explicite).
    const custom = this.customList(), allowCustom = judge(custom, n, 'Règles perso');
    if (allowCustom?.action === 'allow') return allowCustom;
    for (const l of lists.filter((x) => x.kind === 'autorisation')) { const v = judge(l.c, n, l.name); if (v?.action === 'allow') return v; }
    for (const l of lists.filter((x) => x.kind === 'menace')) { const v = judge(l.c, n, l.name); if (v?.action === 'block') return { ...v, why: 'menace' }; }
    if (!filtering) return undefined;
    const services = [...new Set([...(rule?.services ?? []), ...s.services])];
    if (services.length) { const v = judge(servicesList(services), n, 'Services coupés'); if (v?.action === 'block') return v; }
    const safe = (rule?.safeSearch ?? s.safeSearch) ? safeSearchFor(n) : undefined;
    if (safe && n !== safe.to) return { action: 'rewrite', rule: `recherche sécurisée ${safe.label}`, list: 'Recherche sécurisée', to: [safe.to] };
    if (allowCustom) return allowCustom;
    for (const l of lists.filter((x) => x.kind === 'blocage' || (x.kind === 'parental' && (rule?.parental ?? s.parental)))) { const v = judge(l.c, n, l.name); if (v) return v; }
    return undefined;
  }
  private customCache?: { key: string; c: Compiled };
  private customList(): Compiled {
    const s = this.d.settings(), key = s.custom.join('\n');
    if (this.customCache?.key !== key) { const c = emptyList(); for (const l of s.custom) addRule(c, l); this.customCache = { key, c }; }
    return this.customCache.c;
  }

  /** Répond à une question (rend le message à renvoyer, ou rien si elle est ignorée). */
  async handle(raw: Buffer, ip: string): Promise<Buffer | undefined> {
    const t0 = this.now(), s = this.d.settings();
    let q: Message; try { q = parse(raw); } catch { return undefined; }
    if (q.qr || !q.qd.length) return undefined;
    const qq = q.qd[0], { name: cname } = this.clientOf(ip);
    const entry: LogEntry = { t: t0, client: ip.replace(/^::ffff:/, ''), clientName: cname, name: qq.name, type: typeName(qq.type), status: 'ok', ms: 0, rcode: 'NOERROR' };
    const done = (out: Buffer, e: Partial<LogEntry>) => { Object.assign(entry, e, { ms: this.now() - t0 }); try { const m = parse(out); entry.rcode = Object.entries(RCODE).find(([, v]) => v === m.rcode)?.[0] ?? String(m.rcode); if (!entry.answer && m.an.length) entry.answer = m.an.slice(0, 4).map((r) => dataText(out, r)).join(', '); } catch { /* */ } this.d.log?.(entry); return out; };
    // Limite de requêtes par machine (une boucle, un virus, une attaque).
    if (s.rateLimit > 0) {
      const now = this.now(), list = (this.rate.get(entry.client) ?? []).filter((x) => now - x < 1000); list.push(now); this.rate.set(entry.client, list);
      if (list.length > s.rateLimit) { if (now - (this.flooded.get(entry.client) ?? 0) > 60_000) { this.flooded.set(entry.client, now); this.d.onFlood?.(entry.client, list.length); } return undefined; }
    }
    if (q.opcode !== 0) return done(respond(q, { rcode: RCODE.NOTIMP }), { status: 'refusé', rule: 'opération non prise en charge' });
    if (s.refuseAny && qq.type === TYPE.ANY) return done(respond(q, { rcode: RCODE.NOTIMP }), { status: 'refusé', rule: 'requête ANY refusée' });
    // Noms internes qui ne doivent pas partir sur Internet (adresses privées inverses, noms sans point).
    if (s.privateReverse && (PRIVATE_PTR.test(qq.name) || (!qq.name.includes('.') && qq.name !== '' && !s.rewrites[qq.name]))) {
      return done(respond(q, { rcode: RCODE.NXDOMAIN }), { status: 'refusé', rule: 'nom privé : ne part pas sur Internet' });
    }
    const v = this.verdict(qq.name, ip);
    if (v?.action === 'block') {
      if (v.why === 'menace') this.d.onThreat?.({ ...entry, rule: v.rule, list: v.list });
      return done(this.blocked(q), { status: 'bloqué', rule: v.rule, list: v.list });
    }
    if (v?.action === 'rewrite') {
      const out = await this.rewritten(q, v.to, ip);
      return done(out, { status: 'réécrit', rule: v.rule, list: v.list });
    }
    // Cache, puis amont.
    const dnssec = q.ar.some((r) => r.type === TYPE.OPT && (r.ttl & 0x8000));
    const { rule } = this.clientOf(ip), key = this.cache.key(qq.name, qq.type, dnssec) + (rule?.upstreams?.length ? `|${rule.id}` : '');
    const hit = this.cache.get(key);
    if (hit) {
      if (hit.stale) void this.fetch(raw, q, rule?.upstreams).then((r) => this.cache.put(key, r.raw, r.upstream)).catch(() => {});
      const out = reuse(hit.raw, q.id, hit.age, hit.stale ? 30 : 0);
      const chk = this.checkAnswer(out, ip); if (chk) return done(this.blocked(q), { status: 'bloqué', rule: chk.rule, list: chk.list });
      return done(out, { status: 'cache', upstream: hit.upstream });
    }
    try {
      const r = await this.fetch(raw, q, rule?.upstreams);
      this.cache.put(key, r.raw, r.upstream);
      const chk = this.checkAnswer(r.raw, ip); if (chk) return done(this.blocked(q), { status: 'bloqué', rule: chk.rule, list: chk.list });
      return done(r.raw, { status: 'ok', upstream: r.upstream });
    } catch (e) {
      return done(respond(q, { rcode: RCODE.SERVFAIL }), { status: 'erreur', rule: (e as Error).message });
    }
  }
  private fetch(raw: Buffer, q: Message, own?: string[]): Promise<{ raw: Buffer; upstream: string }> {
    const s = this.d.settings(), f: Forwarder = { strategy: s.strategy, upstreams: (own?.length ? own : s.upstreams).map(parseUpstream), fetch: this.d.fetch, ca: this.d.ca, recursive: this.d.recursive };
    return forward(raw, q, f).catch((e) => (s.fallback.length && !own?.length ? forward(raw, q, { ...f, strategy: 'ordre', upstreams: s.fallback.map(parseUpstream) }) : Promise.reject(e)));
  }
  /** Les alias d'une réponse sont vérifiés aussi : un pisteur caché derrière un nom propre est bloqué quand même. */
  private checkAnswer(out: Buffer, ip: string): { rule: string; list: string } | undefined {
    try {
      const m = parse(out);
      for (const r of m.an) if (r.type === TYPE.CNAME) { const t = dataText(out, r), v = this.verdict(t, ip); if (v?.action === 'block') return { rule: `alias ${t} : ${v.rule}`, list: v.list }; }
    } catch { /* */ }
    return undefined;
  }
  private blocked(q: Message): Buffer {
    const s = this.d.settings(), qq = q.qd[0], ttl = s.blockTtl;
    if (s.mode === 'nxdomain') return respond(q, { rcode: RCODE.NXDOMAIN });
    if (s.mode === 'refuse') return respond(q, { rcode: RCODE.REFUSED });
    const v4 = s.mode === 'ip_perso' ? s.blockIp4 ?? '0.0.0.0' : '0.0.0.0', v6 = s.mode === 'ip_perso' ? s.blockIp6 ?? '::' : '::';
    if (qq.type === TYPE.A) return respond(q, { an: [{ name: qq.name, type: TYPE.A, ttl, data: rdata.a(v4) }] });
    if (qq.type === TYPE.AAAA) return respond(q, { an: [{ name: qq.name, type: TYPE.AAAA, ttl, data: rdata.aaaa(v6) }] });
    return respond(q, {});
  }
  private async rewritten(q: Message, to: string[], ip: string): Promise<Buffer> {
    const qq = q.qd[0], an: Answer[] = [];
    const ips = to.filter((x) => /^[\d.]+$/.test(x) || x.includes(':')), names = to.filter((x) => !ips.includes(x));
    if (ips.length) {
      for (const x of ips) { if (qq.type === TYPE.A && /^[\d.]+$/.test(x)) an.push({ name: qq.name, type: TYPE.A, ttl: 300, data: rdata.a(x) }); if (qq.type === TYPE.AAAA && x.includes(':')) an.push({ name: qq.name, type: TYPE.AAAA, ttl: 300, data: rdata.aaaa(x) }); }
      return respond(q, { an, aa: true });
    }
    if (names.length) {
      const target = cleanDomain(names[0]); an.push({ name: qq.name, type: TYPE.CNAME, ttl: 300, data: rdata.name(target) });
      if (qq.type !== TYPE.CNAME) {
        // On résout la cible pour l'appareil (comme le ferait un résolveur).
        const sub = await this.handle(Buffer.from(reuseQuestion(target, qq.type, q.id)), ip);
        if (sub) { try { const m = parse(sub); for (const r of m.an) an.push({ name: r.name, type: r.type, ttl: r.ttl, data: Buffer.from(r.type === TYPE.CNAME ? rdata.name(dataText(sub, r)) : r.data) }); } catch { /* */ } }
      }
      return respond(q, { an });
    }
    return respond(q, {});
  }
}
const reuseQuestion = (name: string, type: number, id: number) => mkQuery(name, type, { id, edns: false });
