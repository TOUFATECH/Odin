// Nébuleuse — le serveur des fichiers (derrière le proxy Valgrind) :
//   - « fichiers.exemple.fr » : l'espace de chacun, réservé aux personnes connectées par Persona (le proxy
//     transmet l'identité ; elle n'est crue que si la demande vient de la machine elle-même, le proxy) ;
//   - « partage.exemple.fr » : public, seulement les liens de partage (/p/…), les dépôts, la lecture des
//     notes secrètes (/n/…) et le WebDAV (/dav/, avec un mot de passe d'appli) pour monter tes fichiers
//     sur un ordinateur ou un téléphone.
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, renameSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import * as S from './store.ts';

export interface Who { login: string; name?: string; groups: string[] }
export interface SpaceView { id: string; name: string; root: string; write: boolean; quota: number; versions: number; perso?: boolean }
export interface Link { id: string; hash: string; space: string; path: string; kind: 'partage' | 'depot' | 'envoi'; by: string; created: number; expires: number; pass?: string; max?: number; downloads: number; label?: string; off?: boolean }
export interface Hub {
  conf(): { privateHost: string; publicHost: string; maxUpload: number };
  spaces(w: Who): SpaceView[];
  space(w: Who, id: string): SpaceView | undefined;
  /** espace « système » d'un lien (sans contrôle de personne : le lien en donne le droit) */
  spaceById(id: string): SpaceView | undefined;
  used(sp: SpaceView): number;
  links(): Link[]; saveLinks(l: Link[]): void;
  newLink(w: Who, x: Omit<Link, 'id' | 'hash' | 'by' | 'created' | 'downloads'> & { password?: string }): { link: Link; token: string };
  passOk(l: Link, pass: string): boolean;
  putNote(ct: string, iv: string, hours: number, by: string): string;
  takeNote(id: string): { ct: string; iv: string } | undefined | 'expirée';
  hasNote(id: string): boolean;
  /** antivirus : `ok` faux → le fichier est mis de côté, pas publié */
  scan(file: string, name: string, w: string, sp: SpaceView, rel: string): Promise<{ ok: boolean; why?: string; id?: string }>;
  appAuth(login: string, pass: string): Who | undefined;
  log(e: { what: string; who?: string; space?: string; path?: string; ip?: string; detail?: string }): void;
  tooMany(ip: string): boolean; fail(ip: string, why: string): void;
  mascot(): string;
}

const esc = (x: unknown) => String(x ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const v4 = (a: string) => a.replace(/^::ffff:/, '');
const local = (q: IncomingMessage) => { const a = v4(q.socket.remoteAddress ?? ''); return a === '127.0.0.1' || a === '::1'; };
const visitor = (q: IncomingMessage) => (local(q) ? String(q.headers['x-real-ip'] ?? q.headers['cf-connecting-ip'] ?? '127.0.0.1') : v4(q.socket.remoteAddress ?? '')).split(',')[0].trim();
const hostOf = (q: IncomingMessage) => String((local(q) && q.headers['x-forwarded-host']) || q.headers.host || '').toLowerCase().replace(/:\d+$/, '');
export const human = (b: number) => { const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${i ? (Math.round(b * 10) / 10).toLocaleString('fr-FR') : b} ${u[i]}`; };
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.heic': 'image/heic', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.json': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8' };
/** Ce qui peut s'afficher dans le navigateur sans risque (le reste se télécharge). Pur. */
export const inlineType = (name: string) => MIME[extname(name).toLowerCase()];
const json = (r: ServerResponse, code: number, x: unknown) => { r.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); r.end(JSON.stringify(x)); };
const nonce = () => randomBytes(12).toString('base64');
const SEC = (n: string) => ({ 'content-security-policy': `default-src 'none'; script-src 'nonce-${n}'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'cache-control': 'no-store' });
async function body(q: IncomingMessage, max = 1_000_000): Promise<string> { let s = ''; for await (const c of q) { s += c; if (s.length > max) throw new Error('trop long'); } return s; }
const disp = (name: string, inline: boolean) => `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** Envoie un fichier (avec reprise « Range » pour les vidéos et les gros téléchargements). */
function sendFile(q: IncomingMessage, r: ServerResponse, abs: string, name: string, inline: boolean): void {
  const st = statSync(abs), type = inline ? inlineType(name) : undefined;
  const h: Record<string, string> = { 'content-type': type ?? 'application/octet-stream', 'content-disposition': disp(name, Boolean(type)), 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox", 'cache-control': 'private, max-age=0' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(q.headers.range ?? ''));
  if (m && st.size) {
    let a = m[1] ? Number(m[1]) : st.size - Number(m[2]), b = m[1] && m[2] ? Number(m[2]) : st.size - 1;
    if (!m[1]) b = st.size - 1; a = Math.max(0, a); b = Math.min(st.size - 1, b);
    if (a > b) { r.writeHead(416, { 'content-range': `bytes */${st.size}` }); r.end(); return; }
    r.writeHead(206, { ...h, 'content-range': `bytes ${a}-${b}/${st.size}`, 'content-length': String(b - a + 1) });
    if (q.method === 'HEAD') { r.end(); return; } createReadStream(abs, { start: a, end: b }).pipe(r); return;
  }
  r.writeHead(200, { ...h, 'content-length': String(st.size) }); if (q.method === 'HEAD') { r.end(); return; } createReadStream(abs).pipe(r);
}

export class FilesServer {
  private srv?: http.Server; port = 0;
  private hub: Hub;
  constructor(hub: Hub) { this.hub = hub; }
  async start(port = 0, host = '127.0.0.1'): Promise<number> {
    this.srv = http.createServer((q, r) => { void this.handle(q, r).catch((e) => { if (!r.headersSent) json(r, 400, { ok: false, error: (e as Error).message }); else r.destroy(); }); });
    this.srv.requestTimeout = 0; this.srv.headersTimeout = 30_000;
    await new Promise<void>((ok, ko) => { this.srv!.once('error', ko); this.srv!.listen(port, host, () => ok()); });
    this.port = (this.srv.address() as AddressInfo).port; return this.port;
  }
  stop(): void { this.srv?.close(); this.srv?.closeAllConnections(); this.srv = undefined; }

  /** Qui fait la demande (identité posée par le proxy après Persona), seulement depuis la machine elle-même. */
  private who(q: IncomingMessage): Who | undefined {
    if (!local(q)) return undefined;
    const login = String(q.headers['remote-user'] ?? '').trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(login)) return undefined;
    return { login, groups: String(q.headers['remote-groups'] ?? '').split(',').map((g) => g.trim().toLowerCase()).filter(Boolean) };
  }

  private async handle(q: IncomingMessage, r: ServerResponse): Promise<void> {
    const u = new URL(q.url ?? '/', 'http://x'), c = this.hub.conf(), host = hostOf(q);
    const isPublic = Boolean(c.publicHost) && host === c.publicHost;
    if (u.pathname.startsWith('/dav')) return this.dav(q, r, u);
    if (isPublic || u.pathname.startsWith('/p/') || /^\/n\/[\w-]+$/.test(u.pathname)) return this.publicRoutes(q, r, u, isPublic);
    const w = this.who(q);
    if (!w) { r.writeHead(401, { 'content-type': 'text/html; charset=utf-8', ...SEC(nonce()) }); r.end(this.card('Connexion nécessaire', '<h1>Connecte-toi d\'abord</h1><p>Ces fichiers sont réservés aux personnes connectées par le portail d\'Odin. Ouvre-les par leur adresse (ex. fichiers.exemple.fr) : Odin te demandera ton identifiant.</p>')); return; }
    if (q.method !== 'GET' && q.method !== 'HEAD' && q.headers['x-skid'] !== '1') return json(r, 403, { ok: false, error: 'demande refusée (protection contre les sites tiers)' });
    return this.privateRoutes(q, r, u, w);
  }

  // ---------------- L'espace de chacun ----------------
  private async privateRoutes(q: IncomingMessage, r: ServerResponse, u: URL, w: Who): Promise<void> {
    const P = u.pathname, g = (k: string) => u.searchParams.get(k) ?? '', ip = visitor(q);
    const sp = (id: string, write = false) => { const x = this.hub.space(w, id); if (!x) throw new Error('espace inconnu ou non autorisé'); if (write && !x.write) throw new Error('tu peux lire cet espace, pas y écrire'); return x; };
    if (P === '/' && q.method === 'GET') { const n = nonce(); r.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...SEC(n) }); r.end(appPage(n, this.hub.mascot(), this.hub.conf().publicHost)); return; }
    if (P === '/api/moi') return json(r, 200, { ok: true, login: w.login, groups: w.groups, spaces: this.hub.spaces(w).map((x) => ({ id: x.id, name: x.name, write: x.write, perso: Boolean(x.perso), quota: x.quota, used: this.hub.used(x) })), publicHost: this.hub.conf().publicHost });
    if (P === '/api/liste') { const x = sp(g('e')); return json(r, 200, { ok: true, entries: S.list(x.root, g('p')) }); }
    if (P === '/api/chercher') { const x = sp(g('e')); return json(r, 200, { ok: true, entries: S.search(x.root, g('q')) }); }
    if (P === '/api/versions') { const x = sp(g('e')); return json(r, 200, { ok: true, versions: S.versions(x.root, g('p')) }); }
    if (P === '/api/corbeille') { const x = sp(g('e')); return json(r, 200, { ok: true, items: S.trash(x.root).filter((t) => x.write || t.by === w.login).reverse() }); }
    if (P === '/f' && (q.method === 'GET' || q.method === 'HEAD')) { const x = sp(g('e')), f = S.inside(x.root, g('p')); if (!existsSync(f) || statSync(f).isDirectory()) throw new Error('fichier introuvable'); this.hub.log({ what: 'téléchargement', who: w.login, space: x.id, path: g('p'), ip }); return sendFile(q, r, f, basename(f), g('voir') === '1'); }
    if (P === '/zip') { const x = sp(g('e')), files = S.filesUnder(x.root, g('p')); r.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': disp(`${basename(g('p')) || x.name}.zip`, false), 'cache-control': 'no-store' }); this.hub.log({ what: 'archive', who: w.login, space: x.id, path: g('p') || '/', ip }); await S.zipTo(r, files); r.end(); return; }
    if (P === '/api/televerser' && q.method === 'POST') {
      const x = sp(g('e'), true), dir = S.inside(x.root, g('p')), name = S.cleanName(decodeURIComponent(String(q.headers['x-nom'] ?? '')));
      const len = Number(q.headers['content-length'] ?? 0), room = x.quota ? x.quota - this.hub.used(x) : Infinity;
      if (len && len > Math.min(room, this.hub.conf().maxUpload)) throw new Error(room < len ? `plus assez de place dans « ${x.name} » (${human(Math.max(0, room))} libres)` : 'fichier trop gros');
      const got = await S.receive(x.root, q as AsyncIterable<Buffer>, Math.min(room, this.hub.conf().maxUpload));
      const rel = [S.cleanRel(g('p')), name].filter(Boolean).join('/');
      const v = await this.hub.scan(got.tmp, name, w.login, x, rel);
      if (!v.ok) { this.hub.log({ what: 'mis de côté (antivirus)', who: w.login, space: x.id, path: rel, ip, detail: v.why }); return json(r, 202, { ok: false, quarantine: true, error: `« ${name} » a été mis de côté par l'antivirus (${v.why}). Le propriétaire d'Odin est prévenu.` }); }
      const replace = q.headers['x-remplacer'] === '1', final = replace ? name : S.freeName(dir, name), relF = [S.cleanRel(g('p')), final].filter(Boolean).join('/');
      if (replace) S.keepVersion(x.root, relF, x.versions, w.login);
      renameSync(got.tmp, join(dir, final)); S.setAuthor(x.root, relF, w.login);
      this.hub.log({ what: 'envoi', who: w.login, space: x.id, path: relF, ip, detail: human(got.size) });
      return json(r, 200, { ok: true, path: relF, size: got.size });
    }
    if (q.method === 'POST') {
      const b = JSON.parse(await body(q) || '{}') as Record<string, string>, x = () => sp(b.e, true);
      switch (P) {
        case '/api/dossier': { const s = x(), rel = [S.cleanRel(b.p), S.cleanName(b.nom)].filter(Boolean).join('/'); S.mkdir(s.root, rel); S.setAuthor(s.root, rel, w.login); return json(r, 200, { ok: true, path: rel }); }
        case '/api/renommer': { const s = x(); return json(r, 200, { ok: true, path: S.rename(s.root, b.p, b.nom) }); }
        case '/api/deplacer': { const s = x(); return json(r, 200, { ok: true, path: S.move(s.root, b.p, b.vers ?? '') }); }
        case '/api/supprimer': { const s = x(); const t = S.toTrash(s.root, b.p, w.login); this.hub.log({ what: 'corbeille', who: w.login, space: s.id, path: b.p, ip }); return json(r, 200, { ok: true, id: t.id }); }
        case '/api/restaurer': { const s = x(); return json(r, 200, { ok: true, path: S.restore(s.root, b.id) }); }
        case '/api/restaurer_version': { const s = x(); S.restoreVersion(s.root, b.p, b.id, s.versions, w.login); return json(r, 200, { ok: true }); }
        case '/api/lien': {
          const s = sp(b.e, b.type === 'depot'), days = Math.min(365, Math.max(1, Number(b.jours) || 7)), rel = S.cleanRel(b.p);
          if (!existsSync(S.inside(s.root, rel))) throw new Error('introuvable');
          const { link, token } = this.hub.newLink(w, { space: s.id, path: rel, kind: b.type === 'depot' ? 'depot' : b.type === 'envoi' ? 'envoi' : 'partage', expires: Date.now() + days * 864e5, password: b.motdepasse || undefined, max: Number(b.max) || undefined, label: (b.titre || basename(rel) || s.name).slice(0, 80) });
          this.hub.log({ what: `lien ${link.kind}`, who: w.login, space: s.id, path: rel, ip });
          return json(r, 200, { ok: true, url: `https://${this.hub.conf().publicHost || 'partage'}/p/${token}`, id: link.id, expires: link.expires });
        }
        case '/api/couper_lien': { const l = this.hub.links(); const it = l.find((y) => y.id === b.id && (y.by === w.login || w.groups.includes('admins'))); if (!it) throw new Error('lien inconnu'); it.off = true; this.hub.saveLinks(l); return json(r, 200, { ok: true }); }
        case '/api/note': { if (!/^[A-Za-z0-9+/=]{16,400000}$/.test(b.ct ?? '') || !/^[A-Za-z0-9+/=]{16,24}$/.test(b.iv ?? '')) throw new Error('note invalide'); const id = this.hub.putNote(b.ct, b.iv, Math.min(24 * 30, Math.max(1, Number(b.heures) || 24)), w.login); return json(r, 200, { ok: true, url: `https://${this.hub.conf().publicHost || 'partage'}/n/${id}` }); }
      }
    }
    if (P === '/api/liens') return json(r, 200, { ok: true, links: this.hub.links().filter((l) => l.by === w.login || w.groups.includes('admins')).map((l) => ({ id: l.id, kind: l.kind, space: l.space, path: l.path, label: l.label, expires: l.expires, downloads: l.downloads, max: l.max, pass: Boolean(l.pass), off: Boolean(l.off) || l.expires < Date.now() })).reverse() });
    json(r, 404, { ok: false, error: 'inconnu' });
  }

  // ---------------- Le public : liens, dépôts, notes ----------------
  private async publicRoutes(q: IncomingMessage, r: ServerResponse, u: URL, isPublic: boolean): Promise<void> {
    const ip = visitor(q), n = nonce(), page = (code: number, title: string, html: string) => { r.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...SEC(n) }); r.end(this.card(title, html, n)); };
    const note = /^\/n\/([\w-]{8,40})$/.exec(u.pathname);
    if (note) {
      if (q.method === 'POST') { if (q.headers['x-skid'] !== '1') return json(r, 403, { ok: false }); const x = this.hub.takeNote(note[1]); if (x === 'expirée' || !x) return json(r, 410, { ok: false, error: x === 'expirée' ? 'Cette note a expiré.' : 'Cette note a déjà été lue ou n\'existe pas.' }); this.hub.log({ what: 'note lue (effacée)', ip }); return json(r, 200, { ok: true, ...x }); }
      if (!this.hub.hasNote(note[1])) return page(410, 'Note introuvable', '<h1>Note déjà lue</h1><p>Cette note a été lue (elle s\'efface après lecture), a expiré, ou n\'a jamais existé.</p>');
      return page(200, 'Note secrète', NOTE_READ(n));
    }
    const m = /^\/p\/([A-Za-z0-9_-]{20,60})(\/.*)?$/.exec(u.pathname);
    if (!m) { if (!isPublic) return json(r, 404, { ok: false }); return page(404, 'Rien ici', '<h1>Rien ici</h1><p>Ce lien n\'existe pas.</p>'); }
    const token = m[1], sub = m[2] ?? '', hash = createHash('sha256').update(token).digest('hex'), all = this.hub.links(), l = all.find((x) => x.hash === hash);
    if (!l || l.off) return page(404, 'Lien coupé', '<h1>Lien introuvable</h1><p>Ce lien n\'existe pas ou a été coupé par la personne qui l\'a créé.</p>');
    if (l.expires < Date.now()) return page(410, 'Lien expiré', `<h1>Lien expiré</h1><p>Ce lien a expiré le ${esc(new Date(l.expires).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }))}. Demande un nouveau lien.</p>`);
    if (l.max && l.downloads >= l.max && l.kind !== 'depot') return page(410, 'Lien épuisé', '<h1>Lien épuisé</h1><p>Le nombre de téléchargements prévu est atteint.</p>');
    const sp = this.hub.spaceById(l.space); if (!sp) return page(404, 'Lien coupé', '<h1>Lien introuvable</h1><p>L\'espace n\'existe plus.</p>');
    // Mot de passe : un cookie propre à ce lien, posé après la bonne réponse.
    const ck = `skid_${l.id}`, proof = l.pass ? createHash('sha256').update(`${l.hash}:${l.pass}`).digest('hex').slice(0, 40) : '';
    const has = !l.pass || (String(q.headers.cookie ?? '').split(/;\s*/).some((c) => { const [k, v] = c.split('='); return k === ck && v && v.length === proof.length && timingSafeEqual(Buffer.from(v), Buffer.from(proof)); }));
    if (q.method === 'POST' && sub === '/mot-de-passe') {
      if (this.hub.tooMany(ip)) return page(429, 'Trop d\'essais', '<h1>Trop d\'essais</h1><p>Réessaie dans un quart d\'heure.</p>');
      const f = new URLSearchParams(await body(q, 4000)), ok = this.hub.passOk(l, f.get('mot_de_passe') ?? '');
      if (!ok) { this.hub.fail(ip, `mot de passe faux sur un lien de partage (${l.label ?? l.id})`); return page(401, 'Mot de passe', this.passForm(token, l, true)); }
      r.writeHead(303, { location: `/p/${token}`, 'set-cookie': `${ck}=${proof}; Path=/p/${token}; HttpOnly; SameSite=Lax; Secure; Max-Age=86400` }); r.end(); return;
    }
    if (!has) return page(401, 'Mot de passe', this.passForm(token, l, false));
    const base = S.inside(sp.root, l.path);
    if (l.kind === 'depot') {
      if (q.method === 'POST' && sub === '/envoyer') {
        if (q.headers['x-skid'] !== '1') return json(r, 403, { ok: false });
        const name = S.cleanName(decodeURIComponent(String(q.headers['x-nom'] ?? ''))), room = sp.quota ? sp.quota - this.hub.used(sp) : Infinity;
        const got = await S.receive(sp.root, q as AsyncIterable<Buffer>, Math.min(room, this.hub.conf().maxUpload));
        const rel = [l.path, name].filter(Boolean).join('/'), v = await this.hub.scan(got.tmp, name, `dépôt ${l.label ?? ''}`, sp, rel);
        if (!v.ok) return json(r, 202, { ok: false, error: `« ${name} » a été refusé par l'antivirus.` });
        const final = S.freeName(base, name); renameSync(got.tmp, join(base, final)); S.setAuthor(sp.root, [l.path, final].filter(Boolean).join('/'), `dépôt (${ip})`);
        l.downloads++; this.hub.saveLinks(all); this.hub.log({ what: 'dépôt reçu', space: sp.id, path: rel, ip, detail: human(got.size) });
        return json(r, 200, { ok: true });
      }
      return page(200, 'Déposer des fichiers', DEPOT(n, token, l));
    }
    const files = S.filesUnder(sp.root, l.path).slice(0, 5000);
    if (sub === '/zip' || (sub === '/f' && files.length)) {
      const one = sub === '/f' ? files[Number(u.searchParams.get('i') ?? 0)] : undefined;
      if (sub === '/f' && !one) return page(404, 'Introuvable', '<h1>Fichier introuvable</h1>');
      if (!(q.headers.range && one)) { l.downloads++; this.hub.saveLinks(all); this.hub.log({ what: 'lien téléchargé', space: sp.id, path: one ? one.name : l.path, ip, detail: l.label }); }
      if (one) return sendFile(q, r, one.abs, basename(one.name), u.searchParams.get('voir') === '1');
      r.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': disp(`${l.label || 'fichiers'}.zip`, false), 'cache-control': 'no-store' }); await S.zipTo(r, files); r.end(); return;
    }
    const total = files.reduce((a, f) => a + f.size, 0), by = esc(l.by);
    return page(200, l.label ?? 'Fichiers partagés', `<h1>${by} t'a envoyé ${files.length} fichier${files.length > 1 ? 's' : ''}</h1><p>${esc(l.label ?? '')} · ${esc(human(total))} en tout<br>Ce lien expire le ${esc(new Date(l.expires).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</p>
<ul class="files">${files.slice(0, 200).map((f, i) => `<li><a href="/p/${token}/f?i=${i}">${esc(f.name)}</a><span>${esc(human(f.size))}</span></li>`).join('')}${files.length > 200 ? `<li><span>… et ${files.length - 200} autres (dans l'archive)</span></li>` : ''}</ul>
${files.length > 1 || existsSync(base) && statSync(base).isDirectory() ? `<a class="btn" href="/p/${token}/zip">Tout télécharger (.zip)</a>` : `<a class="btn" href="/p/${token}/f?i=0">Télécharger</a>`}<p class="small">Fichiers vérifiés par l'antivirus d'Odin.</p>`);
  }
  private passForm(token: string, l: Link, bad: boolean): string {
    return `<h1>${esc(l.by)} a protégé ce lien</h1><p>${esc(l.label ?? '')}</p>${bad ? '<p class="err" role="alert">Mot de passe faux.</p>' : ''}<form method="post" action="/p/${token}/mot-de-passe"><label for="pw">Mot de passe donné par ${esc(l.by)}</label><input id="pw" name="mot_de_passe" type="password" autocomplete="off" required autofocus><button type="submit">Ouvrir</button></form>`;
  }
  private card(title: string, html: string, n = ''): string {
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>
:root{--bg:#f4f5f7;--panel:#fff;--ink:#1c1f24;--muted:#4b5563;--line:#d1d5db;--accent:#2563eb;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#16181c;--panel:#23262c;--ink:#f3f4f6;--muted:#c3c7ce;--line:#3f444c;--accent:#3b82f6;--bad:#fca5a5}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:440px;padding:28px 18px;display:flex;flex-direction:column;gap:12px}.card{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:22px;display:flex;flex-direction:column;gap:12px}
.m{width:88px;height:88px;margin:0 auto}.m svg{width:100%;height:100%}.m .orbit{display:none}
h1{margin:0;font-size:21px;text-align:center}p{margin:0;color:var(--muted);line-height:1.5;text-align:center}label{font-size:14px;font-weight:600}
input,textarea,select{width:100%;min-height:48px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--ink);padding:0 14px;font-size:16px;font-family:inherit}textarea{padding:12px 14px;min-height:150px;resize:vertical}
button,.btn{display:flex;align-items:center;justify-content:center;min-height:50px;border-radius:12px;border:0;background:var(--accent);color:#fff;font-size:16px;font-weight:600;cursor:pointer;width:100%;text-decoration:none}.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
form{display:flex;flex-direction:column;gap:10px}.err{color:var(--bad)}.small{font-size:12px}
.files{margin:0;padding:0;list-style:none;border:1px solid var(--line);border-radius:12px;max-height:320px;overflow:auto}.files li{display:flex;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);font-size:14px}.files li:last-child{border:0}.files a{color:var(--ink);overflow-wrap:anywhere}.files span{color:var(--muted);white-space:nowrap}
.out{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px;font-size:15px;text-align:left}progress{width:100%}
</style></head><body><main><div class="m" aria-hidden="true">${this.hub.mascot()}</div><div class="card">${html}</div></main>${n ? '' : ''}</body></html>`;
  }

  // ---------------- WebDAV (lecteur réseau : Windows, Mac, Linux, applis de fichiers du téléphone) ----------------
  private async dav(q: IncomingMessage, r: ServerResponse, u: URL): Promise<void> {
    const ip = visitor(q);
    const auth = /^Basic\s+(.+)$/i.exec(String(q.headers.authorization ?? ''))?.[1];
    const deny = () => { r.writeHead(401, { 'www-authenticate': 'Basic realm="Fichiers d\'Odin", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' }); r.end('Identifiant et mot de passe d\'appli demandés.'); };
    if (this.hub.tooMany(ip)) { r.writeHead(429); r.end(); return; }
    if (!auth) return deny();
    const [login, ...rest] = Buffer.from(auth, 'base64').toString('utf8').split(':'), w = this.hub.appAuth(login.trim().toLowerCase(), rest.join(':'));
    if (!w) { this.hub.fail(ip, 'mot de passe d\'appli faux (WebDAV)'); return deny(); }
    const parts = decodeURIComponent(u.pathname).replace(/^\/dav\/?/, '').split('/').filter(Boolean), M = q.method ?? 'GET';
    const xmlOut = (code: number, x: string) => { r.writeHead(code, { 'content-type': 'application/xml; charset=utf-8', dav: '1, 2' }); r.end(`<?xml version="1.0" encoding="utf-8"?>\n${x}`); };
    if (M === 'OPTIONS') { r.writeHead(200, { dav: '1, 2', allow: 'OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND, LOCK, UNLOCK', 'ms-author-via': 'DAV' }); r.end(); return; }
    const href = (segs: string[], dir: boolean) => `/dav/${segs.map(encodeURIComponent).join('/')}${dir && segs.length ? '/' : ''}`;
    const prop = (segs: string[], name: string, dir: boolean, size: number, mtime: number) => `<d:response><d:href>${esc(href(segs, dir))}</d:href><d:propstat><d:prop><d:displayname>${esc(name)}</d:displayname>${dir ? '<d:resourcetype><d:collection/></d:resourcetype>' : `<d:resourcetype/><d:getcontentlength>${size}</d:getcontentlength><d:getcontenttype>${esc(inlineType(name) ?? 'application/octet-stream')}</d:getcontenttype>`}<d:getlastmodified>${new Date(mtime).toUTCString()}</d:getlastmodified><d:getetag>"${Math.floor(mtime)}-${size}"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    if (!parts.length) {
      if (M !== 'PROPFIND' && M !== 'GET' && M !== 'HEAD') { r.writeHead(403); r.end(); return; }
      const sps = this.hub.spaces(w);
      if (M !== 'PROPFIND') { r.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); r.end(sps.map((x) => x.id).join('\n')); return; }
      return xmlOut(207, `<d:multistatus xmlns:d="DAV:">${prop([], 'Fichiers d\'Odin', true, 0, Date.now())}${String(q.headers.depth ?? '1') === '0' ? '' : sps.map((x) => prop([x.id], x.name, true, 0, Date.now())).join('')}</d:multistatus>`);
    }
    const sp = this.hub.space(w, parts[0]); if (!sp) { r.writeHead(404); r.end(); return; }
    const rel = parts.slice(1).join('/'), abs = S.inside(sp.root, rel), exists = existsSync(abs), isDir = exists && statSync(abs).isDirectory();
    const needW = !['GET', 'HEAD', 'PROPFIND'].includes(M); if (needW && !sp.write) { r.writeHead(403); r.end('lecture seule'); return; }
    switch (M) {
      case 'PROPFIND': {
        if (!exists) { r.writeHead(404); r.end(); return; }
        const st = statSync(abs), me = prop(parts, basename(abs) || sp.name, isDir, isDir ? 0 : st.size, st.mtimeMs);
        const kids = isDir && String(q.headers.depth ?? '1') !== '0' ? S.list(sp.root, rel).map((e) => prop([...parts, e.name], e.name, e.dir, e.size, e.mtime)).join('') : '';
        return xmlOut(207, `<d:multistatus xmlns:d="DAV:">${me}${kids}</d:multistatus>`);
      }
      case 'GET': case 'HEAD': if (!exists || isDir) { r.writeHead(isDir ? 405 : 404); r.end(); return; } this.hub.log({ what: 'téléchargement (WebDAV)', who: w.login, space: sp.id, path: rel, ip }); return sendFile(q, r, abs, basename(abs), false);
      case 'PUT': {
        if (!rel || isDir) { r.writeHead(409); r.end(); return; }
        const room = sp.quota ? sp.quota - this.hub.used(sp) : Infinity, got = await S.receive(sp.root, q as AsyncIterable<Buffer>, Math.min(room, this.hub.conf().maxUpload));
        const v = await this.hub.scan(got.tmp, basename(abs), w.login, sp, rel); if (!v.ok) { r.writeHead(403); r.end('refusé par l\'antivirus'); return; }
        if (!existsSync(dirname(abs))) { r.writeHead(409); r.end(); return; }
        if (exists) S.keepVersion(sp.root, rel, sp.versions, w.login);
        renameSync(got.tmp, abs); S.setAuthor(sp.root, S.cleanRel(rel), w.login); this.hub.log({ what: 'envoi (WebDAV)', who: w.login, space: sp.id, path: rel, ip, detail: human(got.size) });
        r.writeHead(exists ? 204 : 201); r.end(); return;
      }
      case 'MKCOL': if (exists) { r.writeHead(405); r.end(); return; } S.mkdir(sp.root, rel); r.writeHead(201); r.end(); return;
      case 'DELETE': if (!exists || !rel) { r.writeHead(404); r.end(); return; } S.toTrash(sp.root, rel, w.login); r.writeHead(204); r.end(); return;
      case 'MOVE': case 'COPY': {
        const dest = new URL(String(q.headers.destination ?? ''), 'http://x'), dp = decodeURIComponent(dest.pathname).replace(/^\/dav\/?/, '').split('/').filter(Boolean);
        if (dp[0] !== sp.id || dp.length < 2) { r.writeHead(502); r.end(); return; }
        const to = S.inside(sp.root, dp.slice(1).join('/')), over = existsSync(to);
        if (over && String(q.headers.overwrite ?? 'T') === 'F') { r.writeHead(412); r.end(); return; }
        if (over) S.toTrash(sp.root, dp.slice(1).join('/'), w.login);
        if (M === 'MOVE') renameSync(abs, to); else { const { cpSync } = await import('node:fs'); cpSync(abs, to, { recursive: true }); }
        r.writeHead(over ? 204 : 201); r.end(); return;
      }
      // Verrous : acceptés pour que Windows et Mac écrivent (Odin n'écrit jamais à moitié, le verrou est symbolique).
      case 'LOCK': { const t = `opaquelocktoken:${randomBytes(16).toString('hex')}`; r.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'lock-token': `<${t}>` }); r.end(`<?xml version="1.0" encoding="utf-8"?><d:prop xmlns:d="DAV:"><d:lockdiscovery><d:activelock><d:locktype><d:write/></d:locktype><d:lockscope><d:exclusive/></d:lockscope><d:depth>0</d:depth><d:timeout>Second-3600</d:timeout><d:locktoken><d:href>${t}</d:href></d:locktoken></d:activelock></d:lockdiscovery></d:prop>`); return; }
      case 'UNLOCK': r.writeHead(204); r.end(); return;
      default: r.writeHead(405); r.end();
    }
  }
}

// ---------------- Pages publiques (petits scripts, nonce) ----------------
const NOTE_READ = (n: string) => `<h1>Note secrète</h1><p id="t">Elle s'efface dès que tu l'ouvres : personne ne pourra la relire.</p><div id="out" class="out" hidden></div><button id="go" type="button">Lire la note</button>
<script nonce="${n}">
const go=document.getElementById('go'),out=document.getElementById('out'),t=document.getElementById('t');
const b64=(s)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
go.onclick=async()=>{go.disabled=true;try{const k=new URLSearchParams(location.hash.slice(1)).get('k');if(!k)throw new Error('Clé absente du lien (la partie après « # »).');
const r=await fetch(location.pathname,{method:'POST',headers:{'x-skid':'1'}});const j=await r.json();if(!j.ok)throw new Error(j.error);
const key=await crypto.subtle.importKey('raw',b64(k.replace(/-/g,'+').replace(/_/g,'/')),'AES-GCM',false,['decrypt']);
const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(j.iv)},key,b64(j.ct));out.textContent=new TextDecoder().decode(pt);out.hidden=false;go.hidden=true;t.textContent='La note est effacée d\\'Odin. Copie-la si tu en as besoin.';history.replaceState(null,'',location.pathname);}
catch(e){t.textContent=e.message;go.hidden=true;}};
</script>`;
const DEPOT = (n: string, token: string, l: Link) => `<h1>Déposer des fichiers pour ${esc(l.by)}</h1><p>${esc(l.label ?? '')}<br>Dépôt ouvert jusqu'au ${esc(new Date(l.expires).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }))}</p>
<label for="f">Fichiers</label><input id="f" type="file" multiple><button id="go" type="button">Envoyer</button><progress id="pg" value="0" max="1" hidden></progress><p id="st" role="status"></p>
<script nonce="${n}">
const f=document.getElementById('f'),go=document.getElementById('go'),pg=document.getElementById('pg'),st=document.getElementById('st');
const up=(file)=>new Promise((ok)=>{const x=new XMLHttpRequest();x.open('POST','/p/${token}/envoyer');x.setRequestHeader('x-skid','1');x.setRequestHeader('x-nom',encodeURIComponent(file.name));x.upload.onprogress=(e)=>{pg.value=e.loaded/(e.total||1);};x.onload=()=>{let j={};try{j=JSON.parse(x.responseText);}catch{}ok(j.ok?'':(j.error||'refusé'));};x.onerror=()=>ok('coupé');x.send(file);});
go.onclick=async()=>{if(!f.files.length)return;go.disabled=true;pg.hidden=false;const bad=[];for(const file of f.files){st.textContent='Envoi de '+file.name+'…';const e=await up(file);if(e)bad.push(file.name+' : '+e);}st.textContent=bad.length?bad.join(' · '):'✓ Envoyé, merci !';go.disabled=false;f.value='';pg.hidden=true;};
</script>`;

// ---------------- L'appli des fichiers (fichiers.exemple.fr) ----------------
function appPage(n: string, mascot: string, publicHost: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>Fichiers · Odin</title><style>
:root{--bg:#f4f5f7;--side:#eceef1;--panel:#fff;--ink:#1c1f24;--muted:#4b5563;--line:#d7dbe0;--sel:#e3ecfb;--accent:#2563eb;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#16181c;--side:#1c1f24;--panel:#1f2228;--ink:#f3f4f6;--muted:#b9bec6;--line:#2f333a;--sel:#26303d;--accent:#3b82f6;--bad:#fca5a5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
button{font:inherit;color:inherit}[hidden]{display:none!important}.app{display:flex;min-height:100vh}
nav{width:240px;flex-shrink:0;background:var(--side);border-right:1px solid var(--line);padding:18px 12px;display:flex;flex-direction:column;gap:4px}
.me{display:flex;align-items:center;gap:10px;margin:0 0 14px}.me .mm{width:36px;height:36px}.me .mm svg{width:100%;height:100%}.me .mm .orbit{display:none}.me b{display:block}.me small{color:var(--muted)}
nav button{display:flex;justify-content:space-between;gap:8px;text-align:left;min-height:42px;padding:8px 12px;border-radius:10px;border:0;background:transparent;cursor:pointer;font-size:15px}nav button[aria-current=true]{background:var(--sel);font-weight:600}nav button small{color:var(--muted);font-size:12px}
nav hr{border:0;border-top:1px solid var(--line);margin:8px 0;width:100%}.quota{margin-top:auto;font-size:12px;color:var(--muted)}.bar{height:6px;border-radius:3px;background:var(--line);margin-top:6px}.bar i{display:block;height:6px;border-radius:3px;background:var(--accent)}
main{flex:999 1 560px;min-width:0;padding:20px 24px;display:flex;flex-direction:column;gap:14px}
.top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.crumbs{font-size:14px;color:var(--muted)}.crumbs button{border:0;background:none;padding:4px;cursor:pointer;color:var(--muted)}.crumbs button:last-child{color:var(--ink);font-weight:700}
.search{margin-left:auto;min-width:220px;flex:0 1 300px;min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:0 12px;font-size:15px}
.tools{display:flex;gap:8px;flex-wrap:wrap}.b{min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--line);background:var(--panel);cursor:pointer;font-size:14px}.b.p{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}.b:disabled{opacity:.5}
.body{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}.list{flex:999 1 420px;min-width:0;background:var(--panel);border:1px dashed var(--line);border-radius:16px;overflow:hidden}.list.drag{border-color:var(--accent);background:var(--sel)}
.row{display:grid;grid-template-columns:minmax(0,1fr) 90px 150px 90px;gap:12px;align-items:center;width:100%;padding:11px 14px;border:0;border-bottom:1px solid var(--line);background:transparent;text-align:left;cursor:pointer;font-size:14px}.row.h{cursor:default;font-size:12px;color:var(--muted)}.row[aria-selected=true]{background:var(--sel)}.row .n{display:flex;align-items:center;gap:10px;min-width:0}.row .n span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row .m{color:var(--muted)}
.tag{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0}
.hint{padding:14px;text-align:center;font-size:13px;color:var(--muted)}aside{flex:1 1 280px;max-width:340px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px}
aside .pv{border-radius:12px;background:var(--bg);min-height:120px;display:grid;place-items:center;overflow:hidden;color:var(--muted);font-size:13px}aside .pv img,aside .pv video{max-width:100%;max-height:260px}aside h2{margin:0;font-size:16px;overflow-wrap:anywhere}aside p{margin:0;font-size:13px;color:var(--muted);line-height:1.6}
.vers{display:flex;justify-content:space-between;align-items:center;font-size:13px}.lk{border:0;background:none;color:var(--accent);cursor:pointer;min-height:36px}
dialog{border:1px solid var(--line);border-radius:18px;background:var(--panel);color:var(--ink);padding:20px;width:min(440px,calc(100vw - 24px))}dialog form{display:flex;flex-direction:column;gap:10px}dialog label{font-size:14px;font-weight:600}dialog input,dialog select,dialog textarea{min-height:46px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--ink);padding:0 12px;font-size:16px;font-family:inherit}dialog textarea{min-height:140px;padding:10px 12px}
.out{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px;font-size:14px}#st{min-height:20px;font-size:13px}progress{width:100%}
@media (max-width:760px){.app{flex-direction:column}nav{width:auto;border-right:0;border-bottom:1px solid var(--line);flex-direction:row;align-items:center;overflow-x:auto;padding:10px 12px;gap:6px}nav #spaces{display:flex;gap:6px}nav button{white-space:nowrap;flex-shrink:0;min-height:44px}.me{margin:0 6px 0 0;flex-shrink:0}.me small,nav hr{display:none}nav .quota{display:none}.search{flex:1 1 100%;min-width:0;margin-left:0}.row{grid-template-columns:minmax(0,1fr) 80px}.row .m.w,.row .m.who{display:none}aside{max-width:none}main{padding:14px}}
</style></head><body><div class="app">
<nav aria-label="Espaces"><div class="me"><span class="mm" aria-hidden="true">${mascot}</span><span><b id="me">…</b><small id="grp"></small></span></div><div id="spaces"></div><hr>
<button type="button" id="nLinks">Mes liens de partage</button><button type="button" id="nSend">Envoyer de gros fichiers</button><button type="button" id="nNote">Note secrète</button><button type="button" id="nTrash">Corbeille</button>
<div class="quota" id="quota"></div></nav>
<main><div class="top"><div class="crumbs" id="crumbs"></div><input class="search" id="q" type="search" placeholder="Chercher (nom)" aria-label="Chercher"></div>
<div class="tools"><button class="b p" type="button" id="up">Téléverser</button><input id="file" type="file" multiple hidden><button class="b" type="button" id="mk">Nouveau dossier</button><button class="b" type="button" id="share">Partager par lien</button><button class="b" type="button" id="drop">Demander des fichiers</button><button class="b" type="button" id="zip">Tout télécharger (.zip)</button></div>
<div id="st" role="status"></div><progress id="pg" value="0" max="1" hidden></progress>
<div class="body"><div class="list" id="list"></div><aside id="det" hidden></aside></div></main></div>
<dialog id="dlg"><form method="dialog" id="dlgf"></form></dialog>
<script nonce="${n}">
const $=(s)=>document.querySelector(s),el=(t,a={},...k)=>{const e=document.createElement(t);for(const[x,v]of Object.entries(a)){if(x.startsWith('on'))e.addEventListener(x.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(x,v===true?'':v);}for(const c of k.flat())if(c!=null&&c!==false)e.append(c);return e;};
const api=async(u,b)=>{const r=await fetch(u,b===undefined?{}:{method:'POST',headers:{'content-type':'application/json','x-skid':'1'},body:JSON.stringify(b)});const j=await r.json().catch(()=>({ok:false,error:'réponse illisible'}));if(!j.ok&&!j.quarantine)throw new Error(j.error||'échec');return j;};
const hum=(b)=>{const u=['o','Ko','Mo','Go','To'];let i=0;while(b>=1024&&i<4){b/=1024;i++;}return (i?Math.round(b*10)/10:b).toLocaleString('fr-FR')+' '+u[i];};
const when=(t)=>new Date(t).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const TAG={pdf:['PDF','#B8321F'],jpg:['IMG','#1E7A4C'],jpeg:['IMG','#1E7A4C'],png:['IMG','#1E7A4C'],gif:['IMG','#1E7A4C'],webp:['IMG','#1E7A4C'],heic:['IMG','#1E7A4C'],mp4:['VID','#A85A06'],mov:['VID','#A85A06'],webm:['VID','#A85A06'],mp3:['SON','#7c3aed'],m4a:['SON','#7c3aed'],wav:['SON','#7c3aed'],xlsx:['XLS','#1E7A4C'],csv:['XLS','#1E7A4C'],docx:['DOC','#2563eb'],doc:['DOC','#2563eb'],txt:['TXT','#5f6672'],md:['TXT','#5f6672'],zip:['ZIP','#5f6672']};
const tagOf=(e)=>e.dir?['DOS','#4F9DDE']:(TAG[(e.name.split('.').pop()||'').toLowerCase()]||['FIC','#5f6672']);
let me=null,cur=null,path='',entries=[],sel=null;const st=(t)=>{$('#st').textContent=t;};
async function boot(){me=await api('/api/moi');$('#me').textContent=me.login;$('#grp').textContent=me.groups.join(' · ');cur=me.spaces[0]||null;drawSpaces();if(cur)await open('');else st('Aucun espace pour toi : demande au propriétaire d\\'Odin.');}
function drawSpaces(){$('#spaces').replaceChildren(...me.spaces.map((s)=>el('button',{type:'button','aria-current':String(cur&&s.id===cur.id),onclick:()=>{cur=s;drawSpaces();open('');}},el('span',{},s.name),el('small',{},s.write?'lire · écrire':'lire'))));
if(cur){$('#quota').replaceChildren(cur.name+' : '+hum(cur.used)+(cur.quota?' sur '+hum(cur.quota):''),cur.quota?el('div',{class:'bar'},el('i',{style:'width:'+Math.min(100,Math.round(cur.used/cur.quota*100))+'%'})):'');}
for(const b of ['#up','#mk','#drop'])$(b).disabled=!(cur&&cur.write);}
async function open(p){path=p;sel=null;$('#det').hidden=true;try{entries=(await api('/api/liste?e='+encodeURIComponent(cur.id)+'&p='+encodeURIComponent(p))).entries;draw();}catch(e){st('✗ '+e.message);}}
function crumbs(){const parts=path?path.split('/'):[];$('#crumbs').replaceChildren(el('button',{type:'button',onclick:()=>open('')},cur.name),...parts.map((x,i)=>[' › ',el('button',{type:'button',onclick:()=>open(parts.slice(0,i+1).join('/'))},x)]));}
function draw(list=entries){crumbs();$('#list').replaceChildren(el('div',{class:'row h'},el('span',{},'Nom'),el('span',{},'Taille'),el('span',{class:'m w'},'Modifié'),el('span',{class:'m who'},'Par')),
...list.map((e)=>{const[t,c]=tagOf(e);return el('button',{type:'button',class:'row','aria-selected':String(sel===e),onclick:()=>{sel=e;draw(list);detail(e);},ondblclick:()=>e.dir?open(e.path):null},el('span',{class:'n'},el('span',{class:'tag',style:'background:'+c},t),el('span',{},e.name)),el('span',{class:'m'},e.dir?'—':hum(e.size)),el('span',{class:'m w'},when(e.mtime)),el('span',{class:'m who'},e.by||''));}),
el('div',{class:'hint'},list.length?'':'Dossier vide. ',cur.write?'Dépose des fichiers ici pour les téléverser · chaque fichier est vérifié par l\\'antivirus d\\'Odin':'Lecture seule'));}
async function detail(e){const d=$('#det');d.hidden=false;const url='/f?e='+encodeURIComponent(cur.id)+'&p='+encodeURIComponent(e.path);const ext=(e.name.split('.').pop()||'').toLowerCase();
const pv=el('div',{class:'pv'},e.dir?'Dossier':['jpg','jpeg','png','gif','webp','avif'].includes(ext)?el('img',{src:url+'&voir=1',alt:e.name}):['mp4','webm','mov'].includes(ext)?el('video',{src:url+'&voir=1',controls:true}):['mp3','m4a','ogg','wav'].includes(ext)?el('audio',{src:url+'&voir=1',controls:true}):['txt','md','csv','json','log'].includes(ext)?el('pre',{style:'margin:0;padding:10px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;font-size:12px;text-align:left;width:100%'},'…'):'Aperçu indisponible');
if(pv.firstChild&&pv.firstChild.tagName==='PRE')fetch(url+'&voir=1',{headers:{range:'bytes=0-4095'}}).then((r)=>r.text()).then((x)=>{pv.firstChild.textContent=x||'(vide)';}).catch(()=>{});
const acts=el('div',{class:'tools'},e.dir?el('button',{class:'b p',type:'button',onclick:()=>open(e.path)},'Ouvrir'):el('a',{class:'b p',href:url,style:'display:inline-flex;align-items:center;text-decoration:none'},'Télécharger'),
cur.write?el('button',{class:'b',type:'button',onclick:()=>ask('Renommer',[['nom','Nouveau nom',e.name]],async(v)=>{await api('/api/renommer',{e:cur.id,p:e.path,nom:v.nom});open(path);})},'Renommer'):'',
cur.write?el('button',{class:'b',type:'button',onclick:async()=>{if(!confirm('Mettre « '+e.name+' » à la corbeille ? (récupérable 30 jours)'))return;await api('/api/supprimer',{e:cur.id,p:e.path});st('✓ À la corbeille.');open(path);}},'Supprimer'):'',
el('button',{class:'b',type:'button',onclick:()=>shareDlg(e.path,'partage')},'Partager'));
const vers=e.dir?[]:(await api('/api/versions?e='+encodeURIComponent(cur.id)+'&p='+encodeURIComponent(e.path)).catch(()=>({versions:[]}))).versions;
d.replaceChildren(pv,el('h2',{},e.name),el('p',{},(e.dir?'Dossier':hum(e.size))+' · modifié '+when(e.mtime)+(e.by?' par '+e.by:'')),acts,
vers.length?el('b',{style:'font-size:13px'},'Versions précédentes'):'',...vers.slice(0,8).map((v)=>el('div',{class:'vers'},el('span',{},when(v.at)+(v.by?' · '+v.by:'')+' · '+hum(v.size)),cur.write?el('button',{class:'lk',type:'button',onclick:async()=>{await api('/api/restaurer_version',{e:cur.id,p:e.path,id:v.id});st('✓ Version restaurée (l\\'actuelle est gardée).');open(path);}},'Restaurer'):'')));}
function ask(title,fields,done,extra){const f=$('#dlgf');f.replaceChildren(el('h2',{style:'margin:0;font-size:18px'},title),...(extra?[extra]:[]),...fields.map(([k,l,v,t])=>[el('label',{for:'f_'+k},l),t==='select'?el('select',{id:'f_'+k},...v.map((o)=>el('option',{value:o[0]},o[1]))):t==='area'?el('textarea',{id:'f_'+k}):el('input',{id:'f_'+k,value:v||'',type:t||'text',autocomplete:'off'})]).flat(),el('div',{id:'dout',role:'status'}),el('div',{class:'tools'},el('button',{class:'b p',type:'button',onclick:async()=>{const v={};for(const[k]of fields)v[k]=$('#f_'+k).value;try{const r=await done(v);if(r){$('#dout').replaceChildren(r);}else $('#dlg').close();}catch(x){$('#dout').textContent='✗ '+x.message;}}},'Valider'),el('button',{class:'b',type:'button',onclick:()=>$('#dlg').close()},'Fermer')));$('#dlg').showModal();}
function linkOut(u){return el('div',{style:'display:flex;flex-direction:column;gap:8px'},el('div',{class:'out'},u),el('button',{class:'b p',type:'button',onclick:()=>{navigator.clipboard.writeText(u).then(()=>st('✓ Lien copié.'));}},'Copier le lien'));}
function shareDlg(p,type){ask(type==='depot'?'Demander des fichiers (dépôt)':'Partager par lien',[['jours','Le lien marche pendant','7'],['motdepasse','Mot de passe (conseillé)','','password'],...(type==='depot'?[]:[['max','Téléchargements au plus (vide : sans limite)','']])],async(v)=>{const r=await api('/api/lien',{e:cur.id,p,type,jours:v.jours,motdepasse:v.motdepasse,max:v.max});return linkOut(r.url);});}
$('#share').onclick=()=>shareDlg(sel?sel.path:path,'partage');$('#drop').onclick=()=>shareDlg(path,'depot');
$('#mk').onclick=()=>ask('Nouveau dossier',[['nom','Nom','']],async(v)=>{await api('/api/dossier',{e:cur.id,p:path,nom:v.nom});open(path);});
$('#zip').onclick=()=>{location.href='/zip?e='+encodeURIComponent(cur.id)+'&p='+encodeURIComponent(sel&&sel.dir?sel.path:path);};
const upOne=(file,dir)=>new Promise((ok)=>{const x=new XMLHttpRequest();x.open('POST','/api/televerser?e='+encodeURIComponent(cur.id)+'&p='+encodeURIComponent(dir));x.setRequestHeader('x-skid','1');x.setRequestHeader('x-nom',encodeURIComponent(file.name));x.upload.onprogress=(e)=>{$('#pg').value=e.loaded/(e.total||1);};x.onload=()=>{let j={};try{j=JSON.parse(x.responseText);}catch{}ok(j.ok?'':(j.error||'refusé'));};x.onerror=()=>ok('connexion coupée');x.send(file);});
async function upload(files,dir=path){if(!cur||!cur.write)return;$('#pg').hidden=false;const bad=[];let i=0;for(const f of files){i++;st('Envoi '+i+'/'+files.length+' : '+f.name+' ('+hum(f.size)+')…');const e=await upOne(f,dir);if(e)bad.push(f.name+' : '+e);}$('#pg').hidden=true;st(bad.length?'✗ '+bad.join(' · '):'✓ '+files.length+' fichier(s) envoyé(s), vérifiés par l\\'antivirus.');me=await api('/api/moi');cur=me.spaces.find((s)=>s.id===cur.id)||cur;drawSpaces();if(dir===path)open(path);return bad;}
$('#up').onclick=()=>$('#file').click();$('#file').onchange=()=>{upload([...$('#file').files]);$('#file').value='';};
const L=$('#list');L.addEventListener('dragover',(e)=>{e.preventDefault();L.classList.add('drag');});L.addEventListener('dragleave',()=>L.classList.remove('drag'));L.addEventListener('drop',(e)=>{e.preventDefault();L.classList.remove('drag');if(e.dataTransfer.files.length)upload([...e.dataTransfer.files]);});
let qt=0;$('#q').oninput=()=>{clearTimeout(qt);qt=setTimeout(async()=>{const v=$('#q').value.trim();if(!v)return open(path);const r=await api('/api/chercher?e='+encodeURIComponent(cur.id)+'&q='+encodeURIComponent(v));draw(r.entries);},250);};
$('#nTrash').onclick=async()=>{const r=await api('/api/corbeille?e='+encodeURIComponent(cur.id));const f=$('#dlgf');f.replaceChildren(el('h2',{style:'margin:0;font-size:18px'},'Corbeille · '+cur.name),el('p',{style:'margin:0;font-size:13px'},'Gardé 30 jours, puis effacé.'),...(r.items.length?r.items.map((t)=>el('div',{class:'vers'},el('span',{},t.path+' · '+when(t.at)+(t.by?' · '+t.by:'')),cur.write?el('button',{class:'lk',type:'button',onclick:async()=>{await api('/api/restaurer',{e:cur.id,id:t.id});st('✓ Remis à sa place.');$('#dlg').close();open(path);}},'Restaurer'):'')):[el('p',{},'Vide.')]),el('button',{class:'b',type:'button',onclick:()=>$('#dlg').close()},'Fermer'));$('#dlg').showModal();};
$('#nLinks').onclick=async()=>{const r=await api('/api/liens');const f=$('#dlgf');f.replaceChildren(el('h2',{style:'margin:0;font-size:18px'},'Mes liens'),...(r.links.length?r.links.map((l)=>el('div',{class:'vers'},el('span',{},(l.kind==='depot'?'Dépôt · ':'')+(l.label||l.path)+' · '+(l.off?'coupé/expiré':'jusqu\\'au '+when(l.expires))+' · '+l.downloads+(l.kind==='depot'?' reçu(s)':' téléchargement(s)')+(l.pass?' · 🔒':'')),l.off?'':el('button',{class:'lk',type:'button',onclick:async()=>{await api('/api/couper_lien',{id:l.id});$('#nLinks').click();}},'Couper'))):[el('p',{},'Aucun lien.')]),el('button',{class:'b',type:'button',onclick:()=>$('#dlg').close()},'Fermer'));$('#dlg').showModal();};
$('#nSend').onclick=()=>{const perso=me.spaces.find((s)=>s.perso&&s.write)||(cur&&cur.write?cur:null);if(!perso)return st('✗ Pas d\\'espace où écrire.');const inp=el('input',{type:'file',multiple:true,id:'sf'});
ask('Envoyer de gros fichiers',[['jours','Le lien marche pendant (jours)','7'],['motdepasse','Mot de passe (conseillé)','','password']],async(v)=>{const files=[...inp.files];if(!files.length)throw new Error('choisis des fichiers');const dir='Envois/'+new Date().toISOString().slice(0,16).replace('T',' ').replace(':','h');
await api('/api/dossier',{e:perso.id,p:'',nom:'Envois'}).catch(()=>{});await api('/api/dossier',{e:perso.id,p:'Envois',nom:dir.slice(7)});const prev=cur;cur=perso;const bad=await upload(files,dir);cur=prev;if(bad&&bad.length)throw new Error(bad.join(' · '));
const r=await api('/api/lien',{e:perso.id,p:dir,type:'envoi',jours:v.jours,motdepasse:v.motdepasse,titre:files.length===1?files[0].name:files.length+' fichiers'});return linkOut(r.url);},el('div',{style:'display:flex;flex-direction:column;gap:6px'},el('label',{for:'sf'},'Fichiers'),inp));};
$('#nNote').onclick=()=>ask('Note secrète',[['texte','Ton message','', 'area'],['heures','Si personne ne la lit, effacée dans',[['24','1 jour'],['1','1 heure'],['168','7 jours']],'select']],async(v)=>{if(!v.texte.trim())throw new Error('écris un message');
const key=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12)),k=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']);const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode(v.texte)));
const b64=(a)=>{let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s);};const r=await api('/api/note',{ct:b64(ct),iv:b64(iv),heures:v.heures});
return linkOut(r.url+'#k='+b64(key).replace(/\\+/g,'-').replace(/\\//g,'_'));},el('p',{style:'margin:0;font-size:13px'},'Chiffrée dans ton navigateur : Odin ne peut pas la lire. Elle s\\'efface dès qu\\'on l\\'a lue.'));
boot().catch((e)=>st('✗ '+e.message));
</script></body></html>`;
}
