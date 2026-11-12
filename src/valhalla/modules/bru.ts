// Brú — le pont vers Internet par Cloudflare (tunnel nommé) : tes sites et applis d'Odin accessibles de
// l'extérieur sous ton nom de domaine, sans ouvrir de port sur la box. Avec la clé Cloudflare (Réglages →
// Accès), Odin crée le tunnel, ajoute tout seul les enregistrements DNS de chaque nom chez Cloudflare et les
// règles du tunnel, puis le fait tourner et le surveille.
// Le protocole du tunnel de Cloudflare n'est pas public : Odin pilote le programme officiel « cloudflared »
// (licence Apache 2.0), qu'il télécharge lui-même dans son dossier et vérifie (empreinte SHA-256 publiée par
// GitHub). Rien à installer à la main.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphDetail, GraphEdge, GraphNode, ModCtx, Module, Tone } from '../types.ts';
import { proxyServer } from './valgrind.ts';
import { postNotice } from '../notices.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const CF = 'https://api.cloudflare.com/client/v4';
export interface Published { hostname: string; service: string; zone: string; zoneId: string; recordId?: string; at: number }
interface TunnelInfo { id: string; name: string; account: string }
let child: ChildProcess | undefined, childLog = '', lastStatus: { status: string; connections: number; at: number } | undefined;
const token = () => process.env.CLOUDFLARE_API_TOKEN || undefined;
let odinWeb: (() => { port: number; tls: boolean }) | undefined;
/** Où répond l'interface d'Odin elle-même (pour la publier sous ton domaine). */
export function setOdinWeb(f: typeof odinWeb): void { odinWeb = f; }
const tunnelOf = (ctx: ModCtx) => ctx.settings.tunnel as TunnelInfo | undefined;
const published = (ctx: ModCtx): Published[] => (ctx.settings.published as Published[] | undefined) ?? [];
const tokenFile = (ctx: ModCtx) => join(ctx.dir, 'jeton-tunnel');

/** Appel à l'API de Cloudflare avec la clé de l'utilisateur (jamais affichée ni écrite dans les journaux). */
async function cf<T>(ctx: ModCtx, path: string, o: { method?: string; body?: unknown } = {}): Promise<T> {
  const k = token(); if (!k) throw new Error('clé Cloudflare absente : colle-la dans Réglages → Accès → « Clé Cloudflare »');
  const base = s(ctx.settings.apiBase) || CF;
  const r = await ctx.fetch(`${base}${path}`, { method: o.method ?? 'GET', headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json' }, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}), signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({})) as { success?: boolean; result?: T; errors?: Array<{ code?: number; message?: string }> };
  if (!r.ok || j.success === false) {
    const m = j.errors?.map((e) => e.message).filter(Boolean).join(' ; ') || `HTTP ${r.status}`;
    throw new Error(`Cloudflare : ${m}${r.status === 403 || r.status === 401 ? ' (la clé n\'a pas ce droit : il faut « Cloudflare Tunnel : modifier » sur le compte et « DNS : modifier » + « Zone : lire » sur le domaine)' : ''}`);
  }
  return j.result as T;
}
/** La zone Cloudflare qui contient ce nom (nas.exemple.fr → exemple.fr). */
export async function zoneFor(ctx: ModCtx, host: string): Promise<{ id: string; name: string; account: string }> {
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const name = parts.slice(i).join('.');
    const z = await cf<Array<{ id: string; name: string; account: { id: string } }>>(ctx, `/zones?name=${encodeURIComponent(name)}`);
    if (z.length) return { id: z[0].id, name: z[0].name, account: z[0].account.id };
  }
  throw new Error(`le domaine de ${host} n'est pas dans ton compte Cloudflare (ajoute-le d'abord chez Cloudflare)`);
}

// ---------------- Le programme cloudflared ----------------
/** Le nom du fichier à télécharger pour cette machine. Pur. */
export function assetName(platform = process.platform, arch = process.arch): string {
  const a = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : arch === 'arm' ? 'arm' : arch === 'ia32' ? '386' : '';
  if (!a) throw new Error(`processeur ${arch} non pris en charge par cloudflared`);
  if (platform === 'linux') return `cloudflared-linux-${a}`;
  if (platform === 'win32') return `cloudflared-windows-${a}.exe`;
  throw new Error(`système ${platform} : installe cloudflared à la main (brew install cloudflared), Odin le trouvera`);
}
const binPath = (ctx: ModCtx) => s(ctx.settings.bin) || join(ctx.home, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
async function ensureBinary(ctx: ModCtx): Promise<string> {
  const p = binPath(ctx); if (existsSync(p)) return p;
  if (s(ctx.settings.bin)) throw new Error(`programme introuvable : ${p}`);
  const name = assetName(), api = s(ctx.settings.releaseApi) || 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest';
  const rel = await (await ctx.fetch(api, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) })).json() as { tag_name?: string; body?: string; assets?: Array<{ name: string; browser_download_url: string; digest?: string }> };
  const a = rel.assets?.find((x) => x.name === name); if (!a) throw new Error(`cloudflared ${rel.tag_name ?? ''} : pas de fichier ${name}`);
  // L'empreinte publiée (champ « digest » de GitHub, sinon la liste SHA-256 des notes de version).
  const want = /^sha256:([a-f0-9]{64})$/.exec(a.digest ?? '')?.[1] ?? new RegExp(`${name.replace(/[.]/g, '\\.')}:\\s*([a-f0-9]{64})`).exec(rel.body ?? '')?.[1];
  if (!want) throw new Error('empreinte du programme introuvable : téléchargement refusé (Odin n\'exécute rien qu\'il n\'a pas pu vérifier)');
  const bin = Buffer.from(await (await ctx.fetch(a.browser_download_url, { signal: AbortSignal.timeout(180_000) })).arrayBuffer());
  const got = createHash('sha256').update(bin).digest('hex');
  if (got !== want) throw new Error(`empreinte différente (${got.slice(0, 12)}… au lieu de ${want.slice(0, 12)}…) : fichier refusé`);
  mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, bin, { mode: 0o755 }); try { chmodSync(p, 0o755); } catch { /* Windows */ }
  ctx.saveSettings({ binVersion: rel.tag_name });
  return p;
}
function launch(ctx: ModCtx, bin: string): void {
  stopChild();
  const t = readFileSync(tokenFile(ctx), 'utf8').trim();
  // Le jeton passe par l'environnement (jamais sur la ligne de commande, visible des autres programmes).
  const c = spawn(bin, ['tunnel', '--no-autoupdate', 'run'], { env: { ...process.env, TUNNEL_TOKEN: t }, stdio: ['ignore', 'pipe', 'pipe'] });
  child = c; childLog = '';
  const keep = (d: Buffer) => { childLog = (childLog + d.toString()).slice(-6000); };
  c.stdout?.on('data', keep); c.stderr?.on('data', keep);
  c.on('exit', (code) => { if (child === c) { child = undefined; ctx.emit('tunnel_arrete', { code: code ?? -1 }); } });
}
function stopChild(): void { if (child) { try { child.kill(); } catch { /* déjà arrêté */ } child = undefined; } }

// ---------------- Règles du tunnel et DNS ----------------
interface Ingress { hostname?: string; service: string; originRequest?: Record<string, unknown> }
/** Les règles du tunnel avec ce nom ajouté (ou remplacé), la règle « 404 » toujours à la fin. Pur. */
export function withRule(list: Ingress[], hostname: string, service: string, hostHeader = hostname): Ingress[] {
  const rest = list.filter((r) => r.hostname && r.hostname !== hostname);
  const https = service.startsWith('https://');
  return [...rest, { hostname, service, originRequest: { httpHostHeader: hostHeader, ...(https ? { noTLSVerify: true, originServerName: hostname } : {}) } }, { service: 'http_status:404' }];
}
export const withoutRule = (list: Ingress[], hostname: string): Ingress[] => [...list.filter((r) => r.hostname && r.hostname !== hostname), { service: 'http_status:404' }];
async function ingress(ctx: ModCtx, t: TunnelInfo): Promise<Ingress[]> {
  const c = await cf<{ config?: { ingress?: Ingress[] } }>(ctx, `/accounts/${t.account}/cfd_tunnel/${t.id}/configurations`).catch(() => ({ config: { ingress: [] } }));
  return c.config?.ingress ?? [];
}
async function setIngress(ctx: ModCtx, t: TunnelInfo, list: Ingress[]): Promise<void> { await cf(ctx, `/accounts/${t.account}/cfd_tunnel/${t.id}/configurations`, { method: 'PUT', body: { config: { ingress: list } } }); }

async function status(ctx: ModCtx, t: TunnelInfo): Promise<{ status: string; connections: number }> {
  const r = await cf<{ status?: string; connections?: unknown[] }>(ctx, `/accounts/${t.account}/cfd_tunnel/${t.id}`);
  lastStatus = { status: r.status ?? 'inconnu', connections: r.connections?.length ?? 0, at: Date.now() };
  return lastStatus;
}
const ST: Record<string, string> = { healthy: 'en bonne santé', degraded: 'dégradé', down: 'coupé', inactive: 'jamais connecté' };

// ---------------- Le graphe ----------------
export function bridgeGraph(t: TunnelInfo | undefined, pub: Published[], running: boolean, st?: { status: string; connections: number }): { nodes: GraphNode[]; edges: GraphEdge[]; details: Record<string, GraphDetail> } {
  const ok = running && st?.status === 'healthy';
  const nodes: GraphNode[] = [{ id: 'cloudflare', label: 'Cloudflare', sub: 'Internet', square: true, size: 14, color: '#F0A040' }, { id: 'odin', label: 'Odin · Brú', sub: t ? `tunnel ${t.name}` : 'pas de tunnel', square: true, size: 18, color: running ? '#4F9DDE' : '#7d8791', hub: true }];
  const edges: GraphEdge[] = [{ a: 'cloudflare', b: 'odin', w: ok ? 4 : 1, color: ok ? '#57C98A' : undefined, dash: !running }], details: Record<string, GraphDetail> = {};
  details.odin = { kind: 'Tunnel Cloudflare', title: t ? t.name : 'Pas encore de tunnel', subtitle: t ? `identifiant ${t.id.slice(0, 8)}…` : 'clé Cloudflare dans Réglages → Accès, puis « Créer le tunnel »', chips: [{ label: running ? 'Programme en marche' : 'Arrêté', tone: running ? 'bon' : 'neutre' }, ...(st ? [{ label: `Cloudflare : ${ST[st.status] ?? st.status}`, tone: (st.status === 'healthy' ? 'bon' : st.status === 'degraded' ? 'attention' : 'mauvais') as Tone }] : [])], rows: [{ k: 'Connexions', v: st ? `${st.connections} vers Cloudflare` : '—' }, { k: 'Noms publiés', v: String(pub.length) }], actions: [{ action: running ? 'arreter' : 'demarrer', label: running ? 'Arrêter le tunnel' : 'Démarrer le tunnel', input: {}, primary: !running }] };
  const zones = [...new Set(pub.map((p) => p.zone))];
  for (const z of zones) { nodes.push({ id: `z:${z}`, label: z, sub: 'domaine chez Cloudflare', square: true, size: 11, color: '#F6C177' }); edges.push({ a: 'cloudflare', b: `z:${z}`, w: 2, color: '#F6C177' }); }
  for (const p of pub) {
    const id = `h:${p.hostname}`;
    nodes.push({ id, label: p.hostname, sub: `→ ${p.service}`, size: 8, color: ok ? '#57C98A' : '#E8EAEC' });
    edges.push({ a: `z:${p.zone}`, b: id, dash: true, color: '#F6C177' }, { a: id, b: 'odin', w: 1 });
    details[id] = { kind: 'Nom publié sur Internet', title: p.hostname, subtitle: `https://${p.hostname} → ${p.service}`, rows: [{ k: 'DNS', v: `CNAME → ${t ? `${t.id.slice(0, 8)}….cfargotunnel.com` : 'tunnel'} (proxifié)`, src: 'ajouté par Odin chez Cloudflare' }, { k: 'Publié le', v: new Date(p.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) }], actions: [{ action: 'depublier', label: 'Retirer d\'Internet', input: { domaine: p.hostname } }] };
  }
  return { nodes, edges, details };
}

export const bru: Module = {
  id: 'bru', name: 'Brú', family: 'Accès',
  what: 'Le pont vers Internet par Cloudflare : tes sites et applis d\'Odin accessibles de l\'extérieur sous ton nom de domaine, sans ouvrir de port sur la box. Les DNS sont ajoutés tout seuls chez Cloudflare.',
  does: ['tunnel Cloudflare nommé créé avec ta clé, sans ouvrir de port sur la box', 'chaque nom ajouté au proxy Valgrind (et le portail de Vár) est publié tout seul : règle du tunnel + enregistrement DNS chez Cloudflare', 'certificat HTTPS public fourni par Cloudflare', 'vraie adresse du visiteur transmise (bannissements et accès par adresses restent justes)', 'programme officiel cloudflared téléchargé et vérifié par Odin (empreinte), redémarré s\'il s\'arrête', 'santé du tunnel surveillée (Cloudflare), alerte s\'il tombe', 'retirer un nom d\'Internet : règle et DNS enlevés (seulement ceux d\'Odin)', 'graphe : Cloudflare, tes domaines, les noms publiés, Odin'],
  from: ['cloudflared (Cloudflare Tunnel)'], upstream: ['cloudflare/cloudflared'],
  words: ['tunnel cloudflare', 'cloudflare tunnel', 'accessible de l\'extérieur', 'accès extérieur', 'publier sur internet', 'mettre en ligne', 'sans ouvrir de port'],
  actions: [
    { id: 'verifier', label: 'Vérifier la clé', what: 'La clé Cloudflare marche-t-elle, et quels domaines voit-elle ?', read: true, run: async (ctx) => {
      const t = await cf<{ status: string }>(ctx, '/user/tokens/verify');
      const z = await cf<Array<{ name: string; status: string }>>(ctx, '/zones?per_page=50');
      return { text: `🔑 Clé ${t.status === 'active' ? 'active' : t.status}. Domaines : ${z.map((x) => `${x.name}${x.status === 'active' ? '' : ` (${x.status})`}`).join(', ') || 'aucun (ajoute ton domaine chez Cloudflare)'}.` };
    } },
    { id: 'creer', label: 'Créer le tunnel', what: 'Un tunnel nommé chez Cloudflare (une fois)', quick: false, params: [{ key: 'domaine', label: 'Ton domaine chez Cloudflare (ex. exemple.fr)', kind: 'text', required: true }, { key: 'nom', label: 'Nom du tunnel', kind: 'text', default: 'odin' }], run: async (ctx, i) => {
      if (tunnelOf(ctx)) throw new Error(`un tunnel existe déjà (${tunnelOf(ctx)!.name})`);
      const z = await zoneFor(ctx, s(i.domaine).toLowerCase()), name = (s(i.nom) || 'odin').replace(/[^\w-]/g, '-').slice(0, 40);
      const existing = await cf<Array<{ id: string; name: string }>>(ctx, `/accounts/${z.account}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`);
      const t = existing[0] ?? await cf<{ id: string; name: string }>(ctx, `/accounts/${z.account}/cfd_tunnel`, { method: 'POST', body: { name, config_src: 'cloudflare' } });
      const tk = await cf<string>(ctx, `/accounts/${z.account}/cfd_tunnel/${t.id}/token`);
      mkdirSync(ctx.dir, { recursive: true }); writeFileSync(tokenFile(ctx), tk, { mode: 0o600 });
      ctx.saveSettings({ tunnel: { id: t.id, name: t.name, account: z.account }, zone: z.name });
      await setIngress(ctx, { id: t.id, name: t.name, account: z.account }, [{ service: 'http_status:404' }]);
      return { text: `🌉 Tunnel « ${t.name} » ${existing[0] ? 'retrouvé' : 'créé'} chez Cloudflare (domaine ${z.name}). « Démarrer le tunnel » pour le relier à Odin.` };
    } },
    { id: 'demarrer', label: 'Démarrer le tunnel', what: 'Odin se relie à Cloudflare (télécharge le programme la première fois)', run: async (ctx) => {
      const t = tunnelOf(ctx); if (!t) throw new Error('crée d\'abord le tunnel');
      const bin = await ensureBinary(ctx); launch(ctx, bin); ctx.saveSettings({ on: true });
      await new Promise((r) => setTimeout(r, Number(ctx.settings.waitMs ?? 4000)));
      if (!child) return { ok: false, text: `Le tunnel s'est arrêté tout de suite : ${childLog.trim().split('\n').slice(-2).join(' ').slice(0, 300)}` };
      const st = await status(ctx, t).catch(() => undefined);
      return { text: `✅ Tunnel en marche${st ? ` (Cloudflare : ${ST[st.status] ?? st.status}, ${st.connections} connexion(s))` : ''}. ${published(ctx).length} nom(s) publié(s).` };
    } },
    { id: 'arreter', label: 'Arrêter le tunnel', what: 'Tes noms publiés ne répondent plus depuis Internet', quick: false, grave: () => 'couper l\'accès depuis Internet à tous les noms publiés', run: (ctx) => { stopChild(); ctx.saveSettings({ on: false }); return { text: '⏹ Tunnel arrêté : plus d\'accès depuis Internet par Cloudflare.' }; } },
    { id: 'publier_odin', label: 'Publier Odin', what: 'L\'interface d\'Odin sous ton domaine (ex. odin.exemple.fr), pour la gérer depuis le téléphone', params: [{ key: 'domaine', label: 'Nom pour Odin (ex. odin.exemple.fr)', kind: 'text', required: true }], run: async (ctx, i) => {
      const w = odinWeb?.(); if (!w) throw new Error('interface d\'Odin introuvable');
      // Odin se publie lui-même : le nom demandé est remplacé par « localhost » pour que l'interface l'accepte ; la
      // vraie adresse du visiteur arrive par Cloudflare (Odin ne le prend jamais pour la machine elle-même : jeton,
      // mot de passe et blocage des essais s'appliquent).
      const r = await bru.actions.find((a) => a.id === 'publier')!.run(ctx, { domaine: i.domaine, cible: `${w.tls ? 'https' : 'http'}://localhost:${w.port}`, hote: 'localhost', remplacer: false });
      if (r.ok === false) return r;
      ctx.saveSettings({ odinHost: s(i.domaine).toLowerCase() });
      return { text: `${r.text}\n📱 Ouvre https://${s(i.domaine).toLowerCase()} sur ton téléphone et connecte-toi avec ton e-mail et ton mot de passe d'Odin.` };
    } },
    { id: 'publier', label: 'Publier un nom', what: 'Ce nom devient accessible depuis Internet (règle du tunnel + DNS chez Cloudflare)', params: [{ key: 'domaine', label: 'Nom (ex. nas.exemple.fr)', kind: 'text', required: true }, { key: 'cible', label: 'Vers (vide : le proxy Valgrind d\'Odin)', kind: 'text', default: '' }, { key: 'hote', label: 'Nom transmis au service (vide : le même)', kind: 'text', default: '' }, { key: 'remplacer', label: 'Remplacer un enregistrement DNS existant', kind: 'boolean', default: false }], run: async (ctx, i) => {
      const t = tunnelOf(ctx); if (!t) throw new Error('crée d\'abord le tunnel');
      const host = s(i.domaine).toLowerCase(); if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) throw new Error('nom invalide');
      const service = s(i.cible) || `https://localhost:${proxyServer()?.httpsPort ?? Number(ctx.settings.proxyHttps ?? 443)}`;
      if (!/^(https?|tcp|ssh|rdp):\/\/[\w.-]+(:\d+)?\/?$/.test(service)) throw new Error('cible invalide (ex. http://192.168.1.10:8080)');
      const z = await zoneFor(ctx, host);
      // DNS : un CNAME vers le tunnel ; on ne remplace jamais un enregistrement existant sans ton accord.
      const target = `${t.id}.cfargotunnel.com`;
      const recs = await cf<Array<{ id: string; type: string; content: string }>>(ctx, `/zones/${z.id}/dns_records?name=${encodeURIComponent(host)}`);
      const mine = recs.find((r) => r.type === 'CNAME' && r.content === target), other = recs.filter((r) => r !== mine);
      if (other.length && i.remplacer !== true) postNotice({ level: 'souci', module: 'bru', title: `${host} a déjà un enregistrement DNS chez Cloudflare`, detail: `${other.map((r) => `${r.type} → ${r.content}`).join(', ')}. Odin ne l'a pas écrasé : ce nom n'est pas publié.`, steps: ['Si l\'ancien enregistrement ne sert plus, publie avec « Remplacer ».', 'Sinon, choisis un autre nom.'], actions: [{ module: 'bru', action: 'publier', input: { domaine: host, remplacer: true }, label: 'Remplacer et publier', primary: true }], page: { app: 'bru' }, source: 'info' });
      if (other.length && i.remplacer !== true) return { ok: false, text: `${host} a déjà ${other.map((r) => `un enregistrement ${r.type} → ${r.content}`).join(', ')} chez Cloudflare. Je ne l'écrase pas : coche « Remplacer » si c'est voulu.` };
      for (const r of other) await cf(ctx, `/zones/${z.id}/dns_records/${r.id}`, { method: 'DELETE' });
      const rec = mine ?? await cf<{ id: string }>(ctx, `/zones/${z.id}/dns_records`, { method: 'POST', body: { type: 'CNAME', name: host, content: target, proxied: true, ttl: 1, comment: 'Odin · tunnel Brú' } });
      await setIngress(ctx, t, withRule(await ingress(ctx, t), host, service, s(i.hote) || host));
      ctx.saveSettings({ published: [...published(ctx).filter((p) => p.hostname !== host), { hostname: host, service, zone: z.name, zoneId: z.id, recordId: rec.id, at: Date.now() }] });
      ctx.emit('publie', { nom: host, cible: service });
      postNotice({ level: 'ok', module: 'bru', title: `${host} est publié sur Internet par le tunnel Cloudflare`, detail: `DNS ajouté chez Cloudflare (CNAME vers le tunnel), vers ${service}.`, steps: [`Ouvre https://${host} (quelques minutes pour les DNS).`], page: { app: 'bru' }, source: 'info' });
      return { text: `🌍 https://${host} est publié sur Internet par le tunnel (→ ${service}).${other.length ? ` Ancien enregistrement remplacé.` : ''}${child ? '' : ' Démarre le tunnel pour qu\'il réponde.'}` };
    }, undo: (i) => ({ action: 'depublier', input: { domaine: i.domaine }, label: 'Retirer d\'Internet' }) },
    { id: 'depublier', label: 'Retirer un nom d\'Internet', what: 'Règle du tunnel et DNS enlevés (seulement ce qu\'Odin a ajouté)', quick: false, params: [{ key: 'domaine', label: 'Nom', kind: 'text', required: true }], run: async (ctx, i) => {
      const t = tunnelOf(ctx), host = s(i.domaine).toLowerCase(), p = published(ctx).find((x) => x.hostname === host);
      if (!t || !p) throw new Error(`${host} n'est pas publié par Odin`);
      await setIngress(ctx, t, withoutRule(await ingress(ctx, t), host));
      const recs = await cf<Array<{ id: string; type: string; content: string }>>(ctx, `/zones/${p.zoneId}/dns_records?name=${encodeURIComponent(host)}`);
      for (const r of recs) if (r.type === 'CNAME' && r.content === `${t.id}.cfargotunnel.com`) await cf(ctx, `/zones/${p.zoneId}/dns_records/${r.id}`, { method: 'DELETE' });
      ctx.saveSettings({ published: published(ctx).filter((x) => x.hostname !== host) });
      return { text: `🗑 ${host} n'est plus accessible depuis Internet (règle et DNS retirés).` };
    } },
    { id: 'etat', label: 'État du tunnel', what: 'Santé chez Cloudflare, noms publiés, dernières lignes du programme', read: true, run: async (ctx) => {
      const t = tunnelOf(ctx); if (!t) return { text: 'Pas de tunnel : colle ta clé Cloudflare dans Réglages → Accès, puis « Créer le tunnel ».' };
      const st = await status(ctx, t).catch((e) => ({ status: (e as Error).message, connections: 0 }));
      return { text: [`Tunnel ${t.name} : ${child ? 'programme en marche' : 'arrêté'} · Cloudflare : ${ST[st.status] ?? st.status} (${st.connections} connexion(s)).`, ...published(ctx).map((p) => `- https://${p.hostname} → ${p.service}`), childLog ? `Dernières lignes : ${childLog.trim().split('\n').slice(-3).join(' | ').slice(0, 400)}` : ''].filter(Boolean).join('\n') };
    } },
  ],
  view(ctx) {
    const t = tunnelOf(ctx), pub = published(ctx), hasKey = Boolean(token());
    return {
      subtitle: t ? `Tunnel ${t.name} · ${child ? 'en marche' : 'arrêté'} · ${pub.length} nom(s) sur Internet` : hasKey ? 'Clé présente : crée le tunnel.' : 'Colle d\'abord ta clé Cloudflare dans Réglages → Accès.',
      kpis: [{ label: 'Tunnel', value: child ? 'en marche' : 'arrêté', tone: child ? 'bon' : 'neutre' }, { label: 'Cloudflare', value: lastStatus ? ST[lastStatus.status] ?? lastStatus.status : '—', tone: lastStatus?.status === 'healthy' ? 'bon' : lastStatus ? 'attention' : undefined }, { label: 'Noms publiés', value: String(pub.length) }],
      sections: [
        ...(t && child && pub.length ? [] : [{ kind: 'steps' as const, title: 'Mettre en route', items: [
          { title: 'Coller la clé Cloudflare', detail: 'Réglages → Accès → « Clé Cloudflare ». Droits : Compte › Cloudflare Tunnel : modifier ; Zone › DNS : modifier ; Zone › Zone : lire.', done: hasKey },
          { title: 'Créer le tunnel', detail: 'Avec ton domaine chez Cloudflare (formulaire à droite).', done: Boolean(t) },
          { title: 'Démarrer le tunnel', detail: 'Odin télécharge et vérifie le programme cloudflared la première fois.', done: Boolean(child), action: t ? 'demarrer' : undefined, button: 'Démarrer' },
          { title: 'Publier un nom', detail: 'Tout seul quand tu ajoutes un site au proxy Valgrind, ou à droite.', done: pub.length > 0 },
        ] }]),
        { kind: 'graph', title: 'Graphe du pont', ...bridgeGraph(t, pub, Boolean(child), lastStatus), legend: [['#F0A040', 'Cloudflare'], ['#F6C177', 'ton domaine'], ['#57C98A', 'nom publié qui répond'], ['#4F9DDE', 'Odin']] },
        { kind: 'table', title: 'Noms publiés sur Internet', columns: ['Nom', 'Vers', 'Domaine'], empty: 'Aucun pour l\'instant.', rows: pub.map((p) => ({ cells: [p.hostname, p.service, p.zone], actions: [{ action: 'depublier', label: 'Retirer', input: { domaine: p.hostname } }] })) },
        ...(childLog ? [{ kind: 'log' as const, title: 'Programme cloudflared', lines: childLog.trim().split('\n').slice(-15) }] : []),
      ],
      side: [{ kind: 'form', title: 'Créer le tunnel', action: 'creer', submit: 'Créer', params: bru.actions.find((a) => a.id === 'creer')!.params! }, { kind: 'form', title: 'Publier un nom', action: 'publier', submit: 'Publier', params: bru.actions.find((a) => a.id === 'publier')!.params! }],
    };
  },
  async start(ctx) { if (ctx.settings.on === true && tunnelOf(ctx) && existsSync(tokenFile(ctx))) { try { launch(ctx, await ensureBinary(ctx)); } catch (e) { ctx.alert({ level: 'haute', title: 'Le tunnel Cloudflare n\'a pas pu démarrer', detail: (e as Error).message, key: 'bru-demarrage' }); } } },
  stop() { stopChild(); },
  // Chaque minute : le programme tourne-t-il ? Toutes les 5 minutes : la santé vue par Cloudflare.
  watch: { every: 60, async run(ctx) {
    const t = tunnelOf(ctx); if (!t || ctx.settings.on !== true) return;
    if (!child) { try { launch(ctx, await ensureBinary(ctx)); ctx.emit('tunnel_relance', {}); } catch { /* alerte au tour suivant */ } }
    if (lastStatus && Date.now() - lastStatus.at < 290_000) return;
    try { const st = await status(ctx, t); if (st.status === 'down' || st.status === 'inactive') ctx.alert({ level: 'haute', title: 'Le tunnel Cloudflare est coupé', detail: `Cloudflare le voit « ${ST[st.status]} » : tes noms publiés ne répondent plus depuis Internet. Odin relance le programme ; vérifie la connexion de la box.`, key: 'bru-coupe', steps: ['Vérifie la box : voyants, Internet de la maison.', 'Si la clé Cloudflare a été supprimée ou a expiré, colle-en une nouvelle dans Réglages → Accès.', 'Relance le tunnel (bouton) ; en attendant, le VPN reste possible si son port est ouvert.'], fix: { action: 'demarrer', label: 'Relancer le tunnel' } }); }
    catch { /* API injoignable : on réessaiera */ }
  } },
};
