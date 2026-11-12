// Hringhorni — récupérer une image depuis un registre (Docker Hub, GHCR, Quay, un registre privé…),
// selon le protocole ouvert de distribution OCI. Pas de Docker ni de Podman : Odin parle au registre lui-même.
// Chaque morceau téléchargé est vérifié (empreinte sha256) avant d'être gardé.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface Ref { registry: string; repo: string; tag: string; digest?: string; name: string }

/** « nginx » → docker.io/library/nginx:latest ; « ghcr.io/a/b:1.2 » ; « x@sha256:… ». */
export function parseRef(input: string): Ref {
  const s = input.trim();
  if (!/^[a-z0-9][a-z0-9._\-/:@]*$/i.test(s) || s.length > 255) throw new Error(`nom d'image invalide : ${input}`);
  let rest = s, digest: string | undefined;
  const at = rest.indexOf('@'); if (at >= 0) { digest = rest.slice(at + 1); rest = rest.slice(0, at); if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error(`empreinte invalide : ${digest}`); }
  let tag = 'latest'; const slash = rest.lastIndexOf('/'), colon = rest.lastIndexOf(':');
  if (colon > slash) { tag = rest.slice(colon + 1); rest = rest.slice(0, colon); }
  if (!/^[\w][\w.-]{0,127}$/.test(tag)) throw new Error(`étiquette invalide : ${tag}`);
  const parts = rest.split('/');
  let registry = 'docker.io';
  if (parts.length > 1 && (/[.:]/.test(parts[0]) || parts[0] === 'localhost')) registry = parts.shift()!;
  let repo = parts.join('/').toLowerCase();
  if (registry === 'docker.io' && !repo.includes('/')) repo = `library/${repo}`;
  if (!repo || repo.split('/').some((p) => !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(p))) throw new Error(`nom d'image invalide : ${input}`);
  const short = registry === 'docker.io' ? repo.replace(/^library\//, '') : `${registry}/${repo}`;
  return { registry, repo, tag, digest, name: `${short}:${tag}${digest ? `@${digest}` : ''}` };
}
/** Adresse réelle du registre (Docker Hub répond sur registry-1) ; http seulement en local. */
export function baseUrl(registry: string): string {
  const host = registry === 'docker.io' ? 'registry-1.docker.io' : registry;
  return `${/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? 'http' : 'https'}://${host}`;
}

export const MT = {
  index: 'application/vnd.oci.image.index.v1+json',
  list: 'application/vnd.docker.distribution.manifest.list.v2+json',
  oci: 'application/vnd.oci.image.manifest.v1+json',
  docker: 'application/vnd.docker.distribution.manifest.v2+json',
};
export interface Descriptor { mediaType: string; digest: string; size: number; platform?: { os: string; architecture: string; variant?: string } }
export interface Manifest { schemaVersion: number; mediaType?: string; config: Descriptor; layers: Descriptor[] }
export interface ImageConfig { architecture?: string; os?: string; config?: { Env?: string[]; Cmd?: string[]; Entrypoint?: string[]; WorkingDir?: string; User?: string; ExposedPorts?: Record<string, unknown>; Volumes?: Record<string, unknown>; Labels?: Record<string, string>; StopSignal?: string }; rootfs?: { diff_ids: string[] } ; created?: string }

/** L'architecture de cette machine, dans les mots des registres. */
export function platform(): { os: string; architecture: string; variant?: string } {
  const a = process.arch;
  return { os: 'linux', architecture: a === 'x64' ? 'amd64' : a === 'arm64' ? 'arm64' : a === 'arm' ? 'arm' : a === 'ia32' ? '386' : a, ...(a === 'arm' ? { variant: 'v7' } : {}) };
}

export interface Pull { ref: Ref; manifestDigest: string; manifest: Manifest; config: ImageConfig; configDigest: string }
type Fetch = typeof fetch;

/** Un client de registre : jeton anonyme (ou identifiants) demandé seulement quand le registre le réclame. */
export class Registry {
  private token = '';
  private ref: Ref; private f: Fetch; private auth?: { user: string; pass: string };
  constructor(ref: Ref, f: Fetch = fetch, auth?: { user: string; pass: string }) { this.ref = ref; this.f = f; this.auth = auth; }
  private async req(path: string, accept?: string): Promise<Response> {
    const url = `${baseUrl(this.ref.registry)}/v2/${this.ref.repo}/${path}`;
    const go = () => this.f(url, { headers: { ...(accept ? { accept } : {}), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) }, redirect: 'follow' });
    let r = await go();
    if (r.status === 401 && !this.token) {
      const h = r.headers.get('www-authenticate') ?? '';
      await r.body?.cancel();
      this.token = await this.login(h);
      r = await go();
    }
    if (r.status === 404) throw new Error(`introuvable sur le registre : ${this.ref.name}`);
    if (r.status === 401 || r.status === 403) throw new Error(`le registre refuse l'accès à ${this.ref.name} (image privée ?)`);
    if (r.status === 429) throw new Error('le registre limite les téléchargements : réessaie plus tard');
    if (!r.ok) throw new Error(`registre : erreur ${r.status} pour ${this.ref.name}`);
    return r;
  }
  private async login(h: string): Promise<string> {
    const m = /^Bearer\s+(.*)$/i.exec(h); if (!m) throw new Error('le registre demande une connexion inconnue');
    const p: Record<string, string> = {}; for (const x of m[1].matchAll(/(\w+)="([^"]*)"/g)) p[x[1]] = x[2];
    if (!p.realm || !/^https?:\/\//.test(p.realm)) throw new Error('adresse de connexion du registre invalide');
    const u = new URL(p.realm); if (p.service) u.searchParams.set('service', p.service); u.searchParams.set('scope', p.scope ?? `repository:${this.ref.repo}:pull`);
    const r = await this.f(u, { headers: this.auth ? { authorization: `Basic ${Buffer.from(`${this.auth.user}:${this.auth.pass}`).toString('base64')}` } : {} });
    if (!r.ok) throw new Error(`connexion au registre refusée (${r.status})`);
    const j = (await r.json()) as { token?: string; access_token?: string };
    const t = j.token ?? j.access_token; if (!t) throw new Error('le registre n\'a pas donné de jeton'); return t;
  }
  /** Le manifeste pour cette machine (choisi dans la liste multi-architecture si besoin). */
  async manifest(): Promise<{ digest: string; manifest: Manifest }> {
    const accept = [MT.index, MT.list, MT.oci, MT.docker].join(', ');
    const want = this.ref.digest ?? this.ref.tag;
    let r = await this.req(`manifests/${want}`, accept), raw = Buffer.from(await r.arrayBuffer()), digest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
    if (this.ref.digest && digest !== this.ref.digest) throw new Error('le manifeste reçu ne correspond pas à l\'empreinte demandée');
    let j = JSON.parse(raw.toString('utf8')) as Manifest & { manifests?: Descriptor[]; mediaType?: string };
    if (j.manifests) {
      const pf = platform(), list = j.manifests.filter((m) => m.platform && m.platform.os !== 'unknown');
      const pick = list.find((m) => m.platform!.os === pf.os && m.platform!.architecture === pf.architecture && (!pf.variant || !m.platform!.variant || m.platform!.variant === pf.variant))
        ?? list.find((m) => m.platform!.os === pf.os && m.platform!.architecture === pf.architecture);
      if (!pick) throw new Error(`pas de version de ${this.ref.name} pour ${pf.architecture} (disponibles : ${list.map((m) => m.platform!.architecture).join(', ') || 'aucune'})`);
      r = await this.req(`manifests/${pick.digest}`, [MT.oci, MT.docker].join(', ')); raw = Buffer.from(await r.arrayBuffer()); digest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
      if (digest !== pick.digest) throw new Error('manifeste altéré (empreinte différente)');
      j = JSON.parse(raw.toString('utf8'));
    }
    if (!j.config || !Array.isArray(j.layers)) throw new Error(`format d'image non pris en charge pour ${this.ref.name} (schéma ${j.schemaVersion})`);
    return { digest, manifest: j };
  }
  /** Télécharge un morceau vers `file`, en vérifiant sa taille et son empreinte ; rien n'est gardé s'il est faux. */
  async blob(d: Descriptor, file: string, onBytes?: (n: number) => void): Promise<void> {
    if (!/^sha256:[a-f0-9]{64}$/.test(d.digest)) throw new Error(`empreinte non prise en charge : ${d.digest}`);
    const ok = await stat(file).then((s) => s.size === d.size).catch(() => false); if (ok) return;
    const r = await this.req(`blobs/${d.digest}`); if (!r.body) throw new Error('réponse vide du registre');
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.part`, h = createHash('sha256'); let n = 0;
    const src = Readable.fromWeb(r.body as never);
    src.on('data', (c: Buffer) => { h.update(c); n += c.length; onBytes?.(c.length); if (n > d.size) src.destroy(new Error('morceau plus gros qu\'annoncé')); });
    try { await pipeline(src, createWriteStream(tmp, { mode: 0o600 })); } catch (e) { await rm(tmp, { force: true }); throw e; }
    const got = `sha256:${h.digest('hex')}`;
    if (got !== d.digest || n !== d.size) { await rm(tmp, { force: true }); throw new Error(`morceau altéré (${d.digest.slice(7, 19)}) : téléchargement refusé`); }
    await rename(tmp, file);
  }
}
