// Asclépios — la base de connaissances de l'antivirus : empreintes de malwares, indicateurs (sites, adresses,
// applis espionnes), règles importées, failles exploitées. Elle se met à jour depuis des sources publiques,
// et chaque mise à jour est un PAQUET VERSIONNÉ ET SIGNÉ : vérifié avant d'être chargé, testé avant d'être
// activé (pas de faux positif sur des fichiers sains, le fichier de test EICAR toujours détecté), et
// annulable (retour à la version d'avant). Chaque donnée garde sa source, sa date et sa licence.
// Rien de confidentiel ne part jamais : seules des empreintes (jamais des fichiers) sont comparées en ligne.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { importYara, unzip } from './engine.ts';

const H = 32, HREC = 35;            // empreinte : 32 octets + famille (2) + source (1)
const IREC = 9;                     // indicateur : 8 octets (empreinte tronquée de « genre:valeur ») + source (1)
/** url : adresse qui distribue un malware · page : adresse d'une page d'hameçonnage · domaine / hameçonnage / espion : noms de sites · paquet : appli Android */
export type IocKind = 'domaine' | 'url' | 'page' | 'ip' | 'paquet' | 'hameçonnage' | 'espion';
export interface Stamp { id: string; at: string; count: number; licence: string; sha256?: string; note?: string }
export interface Kev { cve: string; vendor: string; product: string; name: string; added: string; ransomware: boolean }
export interface Manifest { version: number; at: string; previous: number; files: Record<string, string>; sources: Stamp[]; hashes: number; iocs: number; families: number; rules: Record<string, { imported: number; skipped: number }>; note?: string }
export interface Patch { hashes?: Array<{ sha: string; family?: string }>; iocs?: Array<{ kind: IocKind; value: string }>; yara?: Record<string, string>; kev?: Kev[]; stamp: Stamp }

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const iocKey = (kind: IocKind, value: string) => createHash('sha256').update(`${kind}:${normIoc(kind, value)}`).digest().subarray(0, 8);
export function normIoc(kind: IocKind, v: string): string {
  let x = v.trim().toLowerCase();
  if (kind === 'url' || kind === 'page') x = x.replace(/^hxxp/, 'http').replace(/\[\.\]/g, '.').replace(/#.*$/, '').replace(/\/+$/, '');
  if (kind === 'domaine' || kind === 'hameçonnage' || kind === 'espion') x = x.replace(/^[a-z]+:\/\//, '').replace(/[/:?#].*$/, '').replace(/^www\./, '').replace(/\.$/, '');
  if (kind === 'ip') x = x.replace(/:\d+$/, '');
  return x;
}
/** Recherche dans un tampon d'enregistrements triés (clé en tête). */
function find(buf: Buffer, rec: number, key: Buffer): number {
  let lo = 0, hi = buf.length / rec - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1, c = buf.compare(key, 0, key.length, mid * rec, mid * rec + key.length); if (c === 0) return mid; if (c > 0) hi = mid - 1; else lo = mid + 1; }
  return -1;
}
/** Fusionne des enregistrements triés (anciens) avec des nouveaux, sans doublon ; un nouveau complète l'ancien s'il apporte une famille. */
function merge(old: Buffer, fresh: Buffer[], rec: number, keyLen: number): Buffer {
  fresh.sort((a, b) => a.compare(b, 0, keyLen, 0, keyLen));
  const out: Buffer[] = []; let i = 0, j = 0; const n = old.length / rec;
  const cmp = (a: Buffer, ao: number, b: Buffer, bo: number) => a.compare(b, bo, bo + keyLen, ao, ao + keyLen);
  let last: Buffer | undefined;
  const push = (b: Buffer) => { if (last && cmp(last, 0, b, 0) === 0) { if (rec === HREC && last.readUInt16LE(H) === 0 && b.readUInt16LE(H) !== 0) { last = Buffer.from(b); out[out.length - 1] = last; } return; } last = b; out.push(b); };
  while (i < n || j < fresh.length) {
    if (j >= fresh.length || (i < n && cmp(old, i * rec, fresh[j], 0) <= 0)) { push(old.subarray(i * rec, i * rec + rec)); i++; } else { push(fresh[j]); j++; }
  }
  return Buffer.concat(out);
}

export class Intel {
  readonly dir: string;
  private hashes = Buffer.alloc(0); private iocs = Buffer.alloc(0); private families: string[] = ['']; private srcs: string[] = [''];
  private man?: Manifest; private yaraTexts: Array<{ source: string; text: string }> = []; private kevList: Kev[] = [];
  constructor(dir: string) { this.dir = join(dir, 'signatures'); mkdirSync(this.dir, { recursive: true, mode: 0o700 }); }

  // ---------------- Clé de signature de cette installation
  private keys(): { publicKey: string; privateKey: string } {
    const f = join(this.dir, 'cle-signatures.json');
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as { publicKey: string; privateKey: string };
    const k = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    writeFileSync(f, JSON.stringify(k), { mode: 0o600 });
    return k;
  }
  publicKey(): string { return this.keys().publicKey; }

  // ---------------- Chargement (avec vérification)
  private vdir(v: number): string { return join(this.dir, `v${v}`); }
  current(): number { try { return Number(readFileSync(join(this.dir, 'courant'), 'utf8')) || 0; } catch { return 0; } }
  versions(): Manifest[] { return readdirSync(this.dir).filter((d) => /^v\d+$/.test(d)).map((d) => { try { return JSON.parse(readFileSync(join(this.dir, d, 'manifeste.json'), 'utf8')) as Manifest; } catch { return undefined; } }).filter((m): m is Manifest => Boolean(m)).sort((a, b) => b.version - a.version); }
  /** Vérifie un paquet : signature du manifeste, puis empreinte de chaque fichier. Renvoie la raison du refus. */
  check(v: number): string | undefined {
    const d = this.vdir(v);
    try {
      const raw = readFileSync(join(d, 'manifeste.json')), sig = Buffer.from(readFileSync(join(d, 'manifeste.sig'), 'utf8'), 'base64');
      if (!verify(null, raw, createPublicKey(this.publicKey()), sig)) return 'signature invalide (le paquet a été modifié ou ne vient pas de cette installation)';
      const m = JSON.parse(raw.toString('utf8')) as Manifest;
      for (const [name, want] of Object.entries(m.files)) { const f = join(d, name); if (!existsSync(f) || sha(readFileSync(f)) !== want) return `fichier « ${name} » modifié ou manquant`; }
      return undefined;
    } catch (e) { return `paquet illisible (${(e as Error).message.slice(0, 80)})`; }
  }
  /** Charge la version courante ; si elle est abîmée, revient à la dernière version saine. */
  load(): { version: number; refused: Array<{ version: number; why: string }> } {
    const refused: Array<{ version: number; why: string }> = [];
    for (const v of [this.current(), ...this.versions().map((m) => m.version)].filter((x, i, a) => x > 0 && a.indexOf(x) === i)) {
      const why = this.check(v); if (why) { refused.push({ version: v, why }); continue; }
      const d = this.vdir(v);
      this.man = JSON.parse(readFileSync(join(d, 'manifeste.json'), 'utf8')) as Manifest;
      this.hashes = existsSync(join(d, 'empreintes.bin')) ? readFileSync(join(d, 'empreintes.bin')) : Buffer.alloc(0);
      this.iocs = existsSync(join(d, 'indicateurs.bin')) ? readFileSync(join(d, 'indicateurs.bin')) : Buffer.alloc(0);
      const meta = existsSync(join(d, 'noms.json')) ? JSON.parse(readFileSync(join(d, 'noms.json'), 'utf8')) as { families: string[]; sources: string[] } : { families: [''], sources: [''] };
      this.families = meta.families; this.srcs = meta.sources;
      this.kevList = existsSync(join(d, 'failles.json')) ? JSON.parse(readFileSync(join(d, 'failles.json'), 'utf8')) as Kev[] : [];
      this.yaraTexts = existsSync(join(d, 'regles')) ? readdirSync(join(d, 'regles')).filter((f) => f.endsWith('.yar')).map((f) => ({ source: f.replace(/\.yar$/, ''), text: readFileSync(join(d, 'regles', f), 'utf8') })) : [];
      if (v !== this.current()) writeFileSync(join(this.dir, 'courant'), String(v));
      return { version: v, refused };
    }
    this.man = undefined; this.hashes = Buffer.alloc(0); this.iocs = Buffer.alloc(0); this.families = ['']; this.srcs = ['']; this.kevList = []; this.yaraTexts = [];
    return { version: 0, refused };
  }
  manifest(): Manifest | undefined { return this.man; }
  hashCount(): number { return this.hashes.length / HREC; }
  iocCount(): number { return this.iocs.length / IREC; }
  yara(): Array<{ source: string; text: string }> { return this.yaraTexts; }
  kev(): Kev[] { return this.kevList; }

  // ---------------- Recherches
  hash(sha256: string): { family?: string; source: string } | undefined {
    if (!/^[a-f0-9]{64}$/i.test(sha256) || !this.hashes.length) return undefined;
    const i = find(this.hashes, HREC, Buffer.from(sha256, 'hex')); if (i < 0) return undefined;
    return { family: this.families[this.hashes.readUInt16LE(i * HREC + H)] || undefined, source: this.srcs[this.hashes[i * HREC + H + 2]] || 'base d\'Odin' };
  }
  ioc(kind: IocKind, value: string): { source: string } | undefined {
    if (!this.iocs.length || !value) return undefined;
    const i = find(this.iocs, IREC, iocKey(kind, value)); return i < 0 ? undefined : { source: this.srcs[this.iocs[i * IREC + 8]] || 'base d\'Odin' };
  }
  /** Un site est-il connu comme dangereux ? On essaie l'adresse complète, puis le nom du site et ses domaines parents. */
  site(url: string): { what: 'malware' | 'hameçonnage' | 'logiciel espion'; source: string } | undefined {
    const u = this.ioc('url', url); if (u) return { what: 'malware', source: u.source };
    const pg = this.ioc('page', url); if (pg) return { what: 'hameçonnage', source: pg.source };
    const labels = normIoc('domaine', url).split('.');
    for (let i = 0; i < Math.max(1, labels.length - 1); i++) {
      const d = labels.slice(i).join('.');
      const m = this.ioc('domaine', d); if (m) return { what: 'malware', source: m.source };
      const p = this.ioc('hameçonnage', d); if (p) return { what: 'hameçonnage', source: p.source };
      const s = this.ioc('espion', d); if (s) return { what: 'logiciel espion', source: s.source };
    }
    return undefined;
  }

  // ---------------- Nouvelle version (transaction : préparée, testée, signée, puis activée)
  /**
   * Construit la version suivante à partir de la courante + des apports. `validate` reçoit la version
   * candidate (chargée à part) et renvoie une raison de refus : rien n'est activé si le test échoue.
   */
  build(patches: Patch[], validate?: (candidate: Intel) => string | undefined, now = new Date()): Manifest {
    const cur = this.current(), next = Math.max(cur, ...this.versions().map((m) => m.version), 0) + 1, tmp = join(this.dir, `v${next}.tmp`), d = this.vdir(next);
    rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
    if (cur && existsSync(join(this.vdir(cur), 'regles'))) cpSync(join(this.vdir(cur), 'regles'), join(tmp, 'regles'), { recursive: true });
    const families = [...this.families], srcs = [...this.srcs];
    const idx = (list: string[], v: string, max: number) => { if (!v) return 0; let i = list.indexOf(v); if (i < 0 && list.length < max) { list.push(v); i = list.length - 1; } return Math.max(i, 0); };
    const hrecs: Buffer[] = [], irecs: Buffer[] = []; let kev = this.kevList;
    const rules: Manifest['rules'] = { ...(this.man?.rules ?? {}) };
    const stamps = new Map((this.man?.sources ?? []).map((s) => [s.id, s]));
    for (const p of patches) {
      const s = idx(srcs, p.stamp.id, 250);
      for (const h of p.hashes ?? []) { if (!/^[a-f0-9]{64}$/i.test(h.sha)) continue; const r = Buffer.alloc(HREC); Buffer.from(h.sha, 'hex').copy(r); r.writeUInt16LE(idx(families, (h.family ?? '').slice(0, 60), 65_000), H); r[H + 2] = s; hrecs.push(r); }
      for (const x of p.iocs ?? []) { const v = normIoc(x.kind, x.value); if (v.length < 4 || v.length > 2000) continue; const r = Buffer.alloc(IREC); iocKey(x.kind, v).copy(r); r[8] = s; irecs.push(r); }
      for (const [name, text] of Object.entries(p.yara ?? {})) { mkdirSync(join(tmp, 'regles'), { recursive: true }); writeFileSync(join(tmp, 'regles', `${name.replace(/[^\w.-]/g, '_')}.yar`), text); }
      if (p.kev) kev = p.kev;
      stamps.set(p.stamp.id, p.stamp);
    }
    const hashes = merge(this.hashes, hrecs, HREC, H), iocs = merge(this.iocs, irecs, IREC, 8);
    writeFileSync(join(tmp, 'empreintes.bin'), hashes); writeFileSync(join(tmp, 'indicateurs.bin'), iocs);
    writeFileSync(join(tmp, 'noms.json'), JSON.stringify({ families, sources: srcs })); writeFileSync(join(tmp, 'failles.json'), JSON.stringify(kev));
    // Compte des règles comprises par le moteur, fichier par fichier (les autres sont écartées, et comptées).
    if (existsSync(join(tmp, 'regles'))) for (const f of readdirSync(join(tmp, 'regles')).filter((x) => x.endsWith('.yar'))) { const src = f.replace(/\.yar$/, ''), r = importYara(readFileSync(join(tmp, 'regles', f), 'utf8'), src); rules[src] = { imported: r.rules.length, skipped: r.skipped }; }
    const files: Record<string, string> = {};
    const walk = (rel: string) => { for (const e of readdirSync(join(tmp, rel), { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(r); else files[r] = sha(readFileSync(join(tmp, r))); } };
    walk('');
    const man: Manifest = { version: next, at: now.toISOString(), previous: cur, files, sources: [...stamps.values()], hashes: hashes.length / HREC, iocs: iocs.length / IREC, families: families.length - 1, rules };
    const raw = Buffer.from(JSON.stringify(man, null, 1));
    writeFileSync(join(tmp, 'manifeste.json'), raw); writeFileSync(join(tmp, 'manifeste.sig'), sign(null, raw, createPrivateKey(this.keys().privateKey)).toString('base64'));
    rmSync(d, { recursive: true, force: true }); renameSync(tmp, d);
    // Essai de la version candidate avant de l'activer.
    if (validate) {
      const cand = new Intel(join(this.dir, '..'));
      const why = (() => { const bad = cand.check(next); if (bad) return bad; cand.loadVersion(next); return validate(cand); })();
      if (why) { rmSync(d, { recursive: true, force: true }); throw new Error(`mise à jour refusée : ${why}. La version ${cur || 'de base'} reste en service.`); }
    }
    writeFileSync(join(this.dir, 'courant'), String(next));
    this.load();
    // On garde les trois dernières versions (pour revenir en arrière), pas plus.
    for (const m of this.versions().slice(3)) rmSync(this.vdir(m.version), { recursive: true, force: true });
    return man;
  }
  /** Charge une version précise sans changer la version courante (essai avant activation). */
  loadVersion(v: number): void { const keep = this.current(); writeFileSync(join(this.dir, 'courant'), String(v)); try { this.load(); } finally { writeFileSync(join(this.dir, 'courant'), String(keep)); } }
  /** Retour à la version précédente (encore sur le disque). */
  rollback(): Manifest {
    const prev = this.versions().find((m) => m.version < this.current());
    if (!prev) throw new Error('aucune version précédente à reprendre');
    const why = this.check(prev.version); if (why) throw new Error(`la version ${prev.version} n'est plus saine : ${why}`);
    writeFileSync(join(this.dir, 'courant'), String(prev.version)); this.load();
    return prev;
  }
}

// ---------------------------------------------------------------- Lecture des formats des sources
/** Une ligne CSV → ses champs (guillemets, virgules dans les champs, espaces après les virgules). */
export function csvLine(l: string): string[] {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}
/** Export CSV de MalwareBazaar : date, sha256, md5, sha1, déposant, nom, type, mime, famille (signature), … */
export function parseMbCsv(text: string): Array<{ sha: string; family?: string }> {
  const out: Array<{ sha: string; family?: string }> = [];
  for (const l of text.split('\n')) {
    if (!l.trim() || l.startsWith('#')) continue;
    const c = csvLine(l), s = c.find((x) => /^[a-f0-9]{64}$/i.test(x)); if (!s) continue;
    const fam = c[8] && !/^(n\/a|null|none|)$/i.test(c[8]) && !/^[a-f0-9]{32,}$/i.test(c[8]) ? c[8] : undefined;
    out.push({ sha: s.toLowerCase(), family: fam });
  }
  return out;
}
export const parseHashList = (text: string) => text.split('\n').map((l) => l.trim().toLowerCase()).filter((l) => /^[a-f0-9]{64}$/.test(l)).map((s) => ({ sha: s }));
/** Signatures d'empreintes au format ClamAV (.hsb) : « empreinte:taille:nom ». Seules les SHA-256 sont reprises. */
export const parseClamHsb = (text: string) => text.split('\n').map((l) => /^([a-f0-9]{64}):[\d*]+:([^:\s]+)/i.exec(l.trim())).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => ({ sha: m[1].toLowerCase(), family: m[2] }));
/** ThreatFox : réponse de l'API (data: [...]) ou export (objet par identifiant). */
export function parseThreatFox(json: string): { hashes: Array<{ sha: string; family?: string }>; iocs: Array<{ kind: IocKind; value: string }> } {
  const hashes: Array<{ sha: string; family?: string }> = [], iocs: Array<{ kind: IocKind; value: string }> = [];
  let j: unknown; try { j = JSON.parse(json); } catch { return { hashes, iocs }; }
  const rows = (Array.isArray((j as { data?: unknown[] }).data) ? (j as { data: unknown[] }).data : Object.values(j as Record<string, unknown>).flat()) as Array<Record<string, unknown>>;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const v = String(r.ioc ?? r.ioc_value ?? ''), t = String(r.ioc_type ?? ''), fam = String(r.malware_printable ?? r.malware ?? '') || undefined;
    if (Number(r.confidence_level ?? 100) < 50 || !v) continue;      // les indicateurs peu sûrs ne sont pas repris
    if (t === 'sha256_hash') hashes.push({ sha: v.toLowerCase(), family: fam });
    else if (t === 'ip:port') iocs.push({ kind: 'ip', value: v });
    else if (t === 'domain') iocs.push({ kind: 'domaine', value: v });
    else if (t === 'url') iocs.push({ kind: 'url', value: v });
  }
  return { hashes, iocs };
}
export const parseUrls = (text: string, kind: IocKind = 'url') => text.split('\n').map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l)).map((value) => ({ kind, value }));
export const parseDomains = (text: string, kind: IocKind) => text.split('\n').map((l) => l.trim().replace(/^(0\.0\.0\.0|127\.0\.0\.1)\s+/, '')).filter((l) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(l)).map((value) => ({ kind, value }));
/** Indicateurs d'applis espionnes (stalkerware-indicators, YAML) : paquets Android, sites, serveurs. */
export function parseStalkerware(yaml: string): Array<{ kind: IocKind; value: string }> {
  const out: Array<{ kind: IocKind; value: string }> = []; let key = '';
  for (const l of yaml.split('\n')) {
    const k = /^\s*([a-z_0-9]+):\s*$/.exec(l); if (k) { key = k[1]; continue; }
    const v = /^\s*-\s+([^\s#]+)\s*$/.exec(l)?.[1]; if (!v) { if (/^\s*[a-z_]+:\s*\S/.test(l)) key = ''; continue; }
    if (key === 'packages') out.push({ kind: 'paquet', value: v });
    else if (key === 'websites' || key === 'domains') out.push({ kind: 'espion', value: v });
    else if (key === 'ips') out.push({ kind: 'ip', value: v });
  }
  return out;
}
export function parseKev(json: string): Kev[] {
  try { return ((JSON.parse(json) as { vulnerabilities?: Array<Record<string, string>> }).vulnerabilities ?? []).map((v) => ({ cve: v.cveID, vendor: v.vendorProject, product: v.product, name: v.vulnerabilityName, added: v.dateAdded, ransomware: /known/i.test(v.knownRansomwareCampaignUse ?? '') && !/unknown/i.test(v.knownRansomwareCampaignUse ?? '') })).filter((k) => /^CVE-\d{4}-\d+$/.test(k.cve)); } catch { return []; }
}

// ---------------------------------------------------------------- Les sources
export interface FetchCtx { fetch: typeof fetch; key(name: string): string | undefined; url(id: string, fallback: string): string; now(): Date }
export interface Source {
  id: string; name: string; what: string; home: string; gives: string;
  /** automatique : mise à jour toute seule · à la demande : interrogée pour un fichier suspect · référence : documentation, non branchée */
  mode: 'automatique' | 'à la demande' | 'référence';
  needs?: string; licence: string; everyHours?: number; on?: boolean;
  fetch?(c: FetchCtx): Promise<Omit<Patch, 'stamp'> & { count: number; note?: string }>;
}
const get = async (c: FetchCtx, url: string, headers: Record<string, string> = {}, ms = 120_000): Promise<Buffer> => {
  const r = await c.fetch(url, { headers, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${new URL(url).hostname} a répondu ${r.status}${r.status === 401 || r.status === 403 ? ' (clé refusée ou accès non autorisé)' : ''}`);
  return Buffer.from(await r.arrayBuffer());
};
const needKey = (c: FetchCtx, name: string) => { const k = c.key(name); if (!k) throw new Error(`clé absente du coffre (${name})`); return k; };
/** Fichiers de règles repris de signature-base (Florian Roth), licence DRL 1.1 : sous-ensemble compris par Asclépios. */
export const SIGBASE = ['gen_susp_obfuscation', 'crime_ransom_generic', 'gen_powershell_susp', 'gen_susp_lnk_files', 'gen_metasploit_payloads', 'gen_cn_hacktools', 'thor-webshells'];
export const SOURCES: Source[] = [
  { id: 'malwarebazaar', name: 'MalwareBazaar', what: 'Empreintes SHA-256 et familles des malwares récents', home: 'https://bazaar.abuse.ch/', gives: 'empreintes', mode: 'automatique', needs: 'ABUSE_CH_KEY', everyHours: 6, on: true, licence: 'Données CC0 ; clé gratuite (auth.abuse.ch) ; usage raisonnable, offre payante pour un usage commercial',
    fetch: async (c) => { const key = needKey(c, 'ABUSE_CH_KEY'); const raw = await get(c, c.url('malwarebazaar', `https://mb-api.abuse.ch/v2/files/exports/${key}/recent.csv`), { 'Auth-Key': key }); const z = raw.subarray(0, 2).toString('latin1') === 'PK' ? unzip(raw).entries.find((e) => e.data)?.data ?? raw : raw; const hashes = parseMbCsv(z.toString('utf8')); return { hashes, count: hashes.length }; } },
  { id: 'threatfox', name: 'ThreatFox', what: 'Indicateurs de menace récents : serveurs de commande, sites, empreintes', home: 'https://threatfox.abuse.ch/', gives: 'indicateurs', mode: 'automatique', needs: 'ABUSE_CH_KEY', everyHours: 6, on: true, licence: 'Données CC0 ; même clé abuse.ch',
    fetch: async (c) => { const key = needKey(c, 'ABUSE_CH_KEY'); const r = await c.fetch(c.url('threatfox', 'https://threatfox-api.abuse.ch/api/v1/'), { method: 'POST', headers: { 'Auth-Key': key, 'content-type': 'application/json' }, body: JSON.stringify({ query: 'get_iocs', days: 3 }), signal: AbortSignal.timeout(120_000) }); if (!r.ok) throw new Error(`ThreatFox a répondu ${r.status}`); const p = parseThreatFox(await r.text()); return { ...p, count: p.hashes.length + p.iocs.length }; } },
  { id: 'urlhaus', name: 'URLhaus', what: 'Adresses web qui distribuent des malwares en ce moment', home: 'https://urlhaus.abuse.ch/', gives: 'sites', mode: 'automatique', needs: 'ABUSE_CH_KEY', everyHours: 6, on: true, licence: 'Données CC0 ; même clé abuse.ch',
    fetch: async (c) => { const key = needKey(c, 'ABUSE_CH_KEY'); const t = (await get(c, c.url('urlhaus', 'https://urlhaus.abuse.ch/downloads/text_online/'), { 'Auth-Key': key })).toString('utf8'); const urls = parseUrls(t); const iocs = [...urls, ...[...new Set(urls.map((u) => normIoc('domaine', u.value)))].filter((h) => !/^\d+\.\d+\.\d+\.\d+$/.test(h)).map((value) => ({ kind: 'domaine' as IocKind, value }))]; return { iocs, count: urls.length }; } },
  { id: 'openphish', name: 'OpenPhish (flux public)', what: 'Pages d\'hameçonnage actives', home: 'https://openphish.com/', gives: 'hameçonnage', mode: 'automatique', everyHours: 12, on: true, licence: 'Flux communautaire gratuit ; conditions d\'OpenPhish (pas de revente)',
    fetch: async (c) => { const t = (await get(c, c.url('openphish', 'https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt'))).toString('utf8'); const urls = parseUrls(t, 'page'); return { iocs: [...urls, ...[...new Set(urls.map((u) => normIoc('hameçonnage', u.value)))].filter((h) => !/(vercel\.app|github\.io|pages\.dev|web\.app|weebly\.com|blogspot\.com|google\.com|firebaseapp\.com|netlify\.app|wixsite\.com|r2\.dev|workers\.dev)$/.test(h)).map((value) => ({ kind: 'hameçonnage' as IocKind, value }))], count: urls.length }; } },
  { id: 'phishing-database', name: 'Phishing.Database', what: 'Noms de sites d\'hameçonnage actifs (liste très large)', home: 'https://github.com/mitchellkrogza/Phishing.Database', gives: 'hameçonnage', mode: 'automatique', everyHours: 24, on: false, licence: 'Projet libre sur GitHub (voir la licence du dépôt) ; liste lourde (11 Mo), à activer si tu veux',
    fetch: async (c) => { const t = (await get(c, c.url('phishing-database', 'https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-domains-ACTIVE.txt'), {}, 300_000)).toString('utf8'); const iocs = parseDomains(t, 'hameçonnage'); return { iocs, count: iocs.length }; } },
  { id: 'stalkerware', name: 'Stalkerware Indicators', what: 'Applis espionnes pour téléphone : noms de paquets, sites et serveurs', home: 'https://github.com/AssoEchap/stalkerware-indicators', gives: 'logiciels espions', mode: 'automatique', everyHours: 72, on: true, licence: 'Projet libre de l\'association Echap (voir la licence du dépôt, à citer)',
    fetch: async (c) => { const iocs = parseStalkerware((await get(c, c.url('stalkerware', 'https://raw.githubusercontent.com/AssoEchap/stalkerware-indicators/master/ioc.yaml'))).toString('utf8')); return { iocs, count: iocs.length }; } },
  { id: 'signature-base', name: 'signature-base (règles YARA)', what: 'Règles de détection : portes dérobées de sites, outils de piratage, scripts dissimulés, rançongiciels', home: 'https://github.com/Neo23x0/signature-base', gives: 'règles', mode: 'automatique', everyHours: 168, on: true, licence: 'Detection Rule License 1.1 (auteur à citer : Florian Roth)',
    fetch: async (c) => { const yara: Record<string, string> = {}; let n = 0; const miss: string[] = []; for (const f of SIGBASE) { try { yara[`signature-base.${f}`] = (await get(c, `${c.url('signature-base', 'https://raw.githubusercontent.com/Neo23x0/signature-base/master/yara')}/${f}.yar`)).toString('utf8'); n++; } catch { miss.push(f); } } if (!n) throw new Error('aucun fichier de règles récupéré'); return { yara, count: n, note: miss.length ? `fichiers absents : ${miss.join(', ')}` : undefined }; } },
  { id: 'yara-forge', name: 'YARA Forge (noyau)', what: 'Sélection de règles YARA de nombreux auteurs, triées et testées contre les faux positifs', home: 'https://yarahq.github.io/', gives: 'règles', mode: 'automatique', everyHours: 168, on: false, licence: 'Chaque règle garde la licence de son auteur (indiquée dans la règle)',
    fetch: async (c) => { const z = unzip(await get(c, c.url('yara-forge', 'https://github.com/YARAHQ/yara-forge/releases/latest/download/yara-forge-rules-core.zip'), {}, 300_000), { maxEach: 64 * 1024 * 1024 }); const y = z.entries.find((e) => /\.yar$/.test(e.name) && e.data); if (!y?.data) throw new Error('archive de règles illisible'); return { yara: { 'yara-forge.core': y.data.toString('utf8') }, count: 1 }; } },
  { id: 'cisa-kev', name: 'CISA KEV', what: 'Failles réellement exploitées par des attaquants (à corriger en premier)', home: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', gives: 'failles', mode: 'automatique', everyHours: 24, on: true, licence: 'Domaine public (gouvernement des États-Unis)',
    fetch: async (c) => { let t = ''; for (const u of [c.url('cisa-kev', 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'), 'https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json']) { try { t = (await get(c, u)).toString('utf8'); if (parseKev(t).length) break; } catch { /* source suivante */ } } const kev = parseKev(t); if (!kev.length) throw new Error('catalogue indisponible'); return { kev, count: kev.length }; } },
  { id: 'virustotal', name: 'VirusTotal', what: 'Avis de dizaines d\'antivirus sur une empreinte (jamais d\'envoi de fichier)', home: 'https://www.virustotal.com/', gives: 'réputation', mode: 'à la demande', needs: 'VT_API_KEY', licence: 'Clé gratuite : 4 demandes par minute, 500 par jour, interdite dans un produit ou service commercial' },
  { id: 'malwarebazaar-api', name: 'MalwareBazaar (recherche)', what: 'Famille et étiquettes d\'une empreinte', home: 'https://bazaar.abuse.ch/api/', gives: 'réputation', mode: 'à la demande', needs: 'ABUSE_CH_KEY', licence: 'Même clé abuse.ch ; usage raisonnable' },
  { id: 'circl', name: 'CIRCL hashlookup', what: 'Fichiers connus de logiciels légitimes : évite les fausses alertes', home: 'https://www.circl.lu/services/hashlookup/', gives: 'fichiers sains', mode: 'à la demande', licence: 'Service public gratuit du CIRCL (Luxembourg)' },
  { id: 'firehol', name: 'FireHOL et Feodo Tracker', what: 'Adresses IP malveillantes (botnets, serveurs de commande)', home: 'https://iplists.firehol.org/', gives: 'adresses IP', mode: 'automatique', licence: 'Listes publiques ; gérées par l\'appli Méduse (connexions sortantes)' },
  { id: 'clamav', name: 'ClamAV', what: 'Référence technique ; signatures d\'empreintes au format .hsb importables', home: 'https://www.clamav.net/', gives: 'référence', mode: 'référence', licence: 'Moteur GPL non intégré (moteur d\'Odin fait maison) ; ses signatures ont leurs propres conditions' },
  { id: 'malpedia', name: 'Malpedia', what: 'Fiches des familles de malwares et règles YARA', home: 'https://malpedia.caad.fkie.fraunhofer.de/', gives: 'référence', mode: 'référence', needs: 'compte Malpedia', licence: 'Accès sur invitation ; conditions propres' },
  { id: 'otx', name: 'AlienVault OTX', what: 'Indicateurs partagés par la communauté', home: 'https://otx.alienvault.com/', gives: 'référence', mode: 'référence', needs: 'clé OTX', licence: 'Clé gratuite ; conditions d\'OTX' },
  { id: 'kaspersky', name: 'Kaspersky OpenTIP', what: 'Réputation de fichiers, sites et adresses', home: 'https://opentip.kaspersky.com/', gives: 'référence', mode: 'référence', needs: 'clé OpenTIP', licence: 'Selon accès et conditions de Kaspersky' },
  { id: 'attack', name: 'MITRE ATT&CK', what: 'Classement des techniques d\'attaque : chaque détection d\'Asclépios porte son code (ex. T1105)', home: 'https://attack.mitre.org/', gives: 'référence', mode: 'référence', licence: 'Libre d\'usage avec mention ; ce n\'est pas une base de signatures' },
  { id: 'nvd', name: 'NVD', what: 'Toutes les failles connues (CVE)', home: 'https://nvd.nist.gov/', gives: 'référence', mode: 'référence', licence: 'Domaine public ; Asclépios suit d\'abord les failles réellement exploitées (CISA KEV)' },
  { id: 'androzoo', name: 'AndroZoo', what: 'Collection d\'applis Android pour la recherche', home: 'https://androzoo.uni.lu/', gives: 'référence', mode: 'référence', needs: 'accord universitaire', licence: 'Accès soumis à conditions' },
  { id: 'wdsi', name: 'Microsoft Security Intelligence', what: 'Documentation des menaces Windows', home: 'https://www.microsoft.com/en-us/wdsi', gives: 'référence', mode: 'référence', licence: 'Documentation' },
  { id: 'objective-see', name: 'Objective-See', what: 'Recherches et indicateurs sur macOS', home: 'https://objective-see.org/', gives: 'référence', mode: 'référence', licence: 'Documentation et outils libres' },
];

// ---------------------------------------------------------------- Réputation à la demande (empreinte seulement)
export interface Reputation { sha: string; at: string; vt?: { malicious: number; suspicious: number; harmless: number; undetected: number; label?: string; name?: string } | 'inconnu'; mb?: { family?: string; tags: string[]; type?: string } | 'inconnu'; circl?: { name?: string; product?: string } | 'inconnu'; errors?: string[] }
export async function reputation(sha256: string, c: FetchCtx, o: { vt?: boolean; mb?: boolean; circl?: boolean } = { vt: true, mb: true, circl: true }): Promise<Reputation> {
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('empreinte SHA-256 attendue (64 caractères)');
  const out: Reputation = { sha: sha256.toLowerCase(), at: c.now().toISOString(), errors: [] };
  const vtKey = c.key('VT_API_KEY'), abKey = c.key('ABUSE_CH_KEY');
  if (o.vt !== false && vtKey) {
    try { const r = await c.fetch(`${c.url('virustotal', 'https://www.virustotal.com/api/v3/files')}/${out.sha}`, { headers: { 'x-apikey': vtKey }, signal: AbortSignal.timeout(30_000) });
      if (r.status === 404) out.vt = 'inconnu'; else if (r.status === 429) out.errors!.push('VirusTotal : quota atteint (4 par minute, 500 par jour)'); else if (!r.ok) out.errors!.push(`VirusTotal : ${r.status}`);
      else { const a = ((await r.json()) as { data?: { attributes?: { last_analysis_stats?: Record<string, number>; popular_threat_classification?: { suggested_threat_label?: string }; meaningful_name?: string } } }).data?.attributes; const s = a?.last_analysis_stats ?? {}; out.vt = { malicious: s.malicious ?? 0, suspicious: s.suspicious ?? 0, harmless: s.harmless ?? 0, undetected: s.undetected ?? 0, label: a?.popular_threat_classification?.suggested_threat_label, name: a?.meaningful_name }; }
    } catch (e) { out.errors!.push(`VirusTotal : ${(e as Error).message.slice(0, 80)}`); }
  }
  if (o.mb !== false && abKey) {
    try { const r = await c.fetch(c.url('malwarebazaar-api', 'https://mb-api.abuse.ch/api/v1/'), { method: 'POST', headers: { 'Auth-Key': abKey, 'content-type': 'application/x-www-form-urlencoded' }, body: `query=get_info&hash=${out.sha}`, signal: AbortSignal.timeout(30_000) });
      const j = (await r.json()) as { query_status?: string; data?: Array<{ signature?: string; tags?: string[]; file_type?: string }> };
      out.mb = j.query_status === 'ok' && j.data?.[0] ? { family: j.data[0].signature || undefined, tags: j.data[0].tags ?? [], type: j.data[0].file_type } : 'inconnu';
    } catch (e) { out.errors!.push(`MalwareBazaar : ${(e as Error).message.slice(0, 80)}`); }
  }
  if (o.circl !== false) {
    try { const r = await c.fetch(`${c.url('circl', 'https://hashlookup.circl.lu/lookup/sha256')}/${out.sha}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
      if (r.status === 404) out.circl = 'inconnu'; else if (r.ok) { const j = (await r.json()) as Record<string, unknown>; out.circl = { name: String(j.FileName ?? '') || undefined, product: String((j as { ProductName?: string }).ProductName ?? (j as { 'hashlookup:parent-total'?: number })['hashlookup:parent-total'] ?? '') || undefined }; }
    } catch (e) { out.errors!.push(`CIRCL : ${(e as Error).message.slice(0, 80)}`); }
  }
  if (!out.errors!.length) delete out.errors;
  return out;
}
/** Résumé lisible d'une réputation, et ce qu'elle change au verdict. */
export function reputationText(r: Reputation): { text: string; malicious: boolean; trusted: boolean } {
  const parts: string[] = []; let malicious = false, trusted = false;
  if (r.vt && r.vt !== 'inconnu') { const n = r.vt.malicious + r.vt.suspicious, total = n + r.vt.harmless + r.vt.undetected; parts.push(`VirusTotal : ${n} antivirus sur ${total} le jugent dangereux${r.vt.label ? ` (${r.vt.label})` : ''}`); if (r.vt.malicious >= 5) malicious = true; if (n === 0 && total >= 40) trusted = true; } else if (r.vt === 'inconnu') parts.push('VirusTotal : jamais vu');
  if (r.mb && r.mb !== 'inconnu') { parts.push(`MalwareBazaar : malware connu${r.mb.family ? ` (${r.mb.family})` : ''}`); malicious = true; } else if (r.mb === 'inconnu') parts.push('MalwareBazaar : inconnu');
  if (r.circl && r.circl !== 'inconnu') { parts.push(`CIRCL : fichier connu d'un logiciel légitime${r.circl.name ? ` (${r.circl.name})` : ''}`); trusted = true; } else if (r.circl === 'inconnu') parts.push('CIRCL : pas dans les logiciels connus');
  for (const e of r.errors ?? []) parts.push(e);
  return { text: parts.join(' · ') || 'Aucune source de réputation disponible (ajoute une clé VirusTotal ou abuse.ch dans le coffre).', malicious, trusted: trusted && !malicious };
}
