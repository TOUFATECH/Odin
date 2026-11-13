// Interprète — le messager MCP d'Odin, dans les deux sens.
//   Client : Odin se branche sur des serveurs MCP (programme local en stdio, ou adresse HTTP) et
//            leurs outils deviennent des outils d'Odin, toujours sous Heimdall (accord, contenu non fiable).
//   Serveur : Odin expose ses applis en MCP (/mcp, jeton obligatoire) pour d'autres assistants ;
//            lectures et actions simples seulement, jamais d'action grave.
// Protocole JSON-RPC 2.0, version MCP 2025-06-18 (repli accepté sur les versions précédentes).

import { spawn, type ChildProcess } from 'node:child_process';
import type { Valhalla } from './service.ts';

export const PROTOCOL = '2025-06-18';
/** Versions du protocole qu'Odin sait parler (la négociation renvoie celle du client si elle est ici, sinon la plus récente d'Odin). */
export const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
export interface McpTool { name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string } }
export interface McpServerConf { name: string; kind: 'stdio' | 'http'; command?: string; args?: string[]; url?: string; enabled: boolean; env?: string[] }
type Pending = { res: (v: unknown) => void; rej: (e: Error) => void; t: ReturnType<typeof setTimeout> };

/** Contenu d'un résultat d'outil MCP → texte. */
export function contentText(r: unknown): string {
  const x = r as { content?: Array<{ type: string; text?: string; mimeType?: string; resource?: { text?: string; uri?: string } }>; structuredContent?: unknown; isError?: boolean };
  const parts = (x?.content ?? []).map((c) => c.type === 'text' ? c.text ?? '' : c.type === 'resource' ? c.resource?.text ?? c.resource?.uri ?? '' : `[${c.type}${c.mimeType ? ` ${c.mimeType}` : ''}]`);
  if (!parts.length && x?.structuredContent !== undefined) parts.push(JSON.stringify(x.structuredContent));
  return `${x?.isError ? '✗ ' : ''}${parts.join('\n')}`.trim();
}
/** Réponse HTTP MCP : JSON simple ou flux SSE (on garde le message qui porte l'id attendu). */
export function parseHttpReply(ct: string, text: string, id: number): unknown {
  if (/event-stream/.test(ct)) {
    for (const block of text.split(/\n\n+/)) {
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { const m = JSON.parse(data) as { id?: number }; if (m.id === id) return m; } catch { /* bloc incomplet */ }
    }
    throw new Error('réponse SSE sans résultat');
  }
  return JSON.parse(text);
}

export class McpClient {
  private proc?: ChildProcess;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private session?: string;
  tools: McpTool[] = [];
  info?: { name?: string; version?: string };
  readonly conf: McpServerConf;
  private fetcher: typeof fetch;
  private token?: string;
  constructor(conf: McpServerConf, fetcher: typeof fetch = fetch, token?: string) { this.conf = conf; this.fetcher = fetcher; this.token = token; }

  async connect(): Promise<McpTool[]> {
    if (this.conf.kind === 'stdio') {
      if (!this.conf.command) throw new Error('commande manquante');
      const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG };
      for (const k of this.conf.env ?? []) if (process.env[k]) env[k] = process.env[k];
      this.proc = spawn(this.conf.command, this.conf.args ?? [], { stdio: ['pipe', 'pipe', 'ignore'], env });
      this.proc.on('exit', () => { for (const p of this.pending.values()) { clearTimeout(p.t); p.rej(new Error('serveur MCP arrêté')); } this.pending.clear(); });
      this.proc.stdout!.on('data', (d: Buffer) => { this.buf += d.toString('utf8'); let i; while ((i = this.buf.indexOf('\n')) >= 0) { const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); if (line) this.onMessage(line); } if (this.buf.length > 8 * 1024 * 1024) this.buf = ''; });
    }
    const init = await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'odin', version: '1' } }) as { serverInfo?: { name?: string; version?: string } };
    this.info = init?.serverInfo;
    await this.notify('notifications/initialized');
    this.tools = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) { const r = await this.request('tools/list', cursor ? { cursor } : {}) as { tools?: McpTool[]; nextCursor?: string }; this.tools.push(...(r?.tools ?? [])); cursor = r?.nextCursor; if (!cursor) break; }
    return this.tools;
  }
  close(): void { this.proc?.kill(); this.proc = undefined; }
  async call(name: string, args: Record<string, unknown>): Promise<string> { return contentText(await this.request('tools/call', { name, arguments: args }, 120_000)); }

  private onMessage(line: string): void {
    let m: { id?: number; result?: unknown; error?: { message?: string }; method?: string };
    try { m = JSON.parse(line); } catch { return; }
    if (m.id !== undefined && this.pending.has(m.id) && !m.method) { const p = this.pending.get(m.id)!; this.pending.delete(m.id); clearTimeout(p.t); if (m.error) p.rej(new Error(m.error.message ?? 'erreur MCP')); else p.res(m.result); return; }
    // Requêtes du serveur (ping, échantillonnage…) : on répond poliment, sans rien accorder.
    if (m.method && m.id !== undefined) this.write({ jsonrpc: '2.0', id: m.id, ...(m.method === 'ping' ? { result: {} } : { error: { code: -32601, message: 'non pris en charge par Odin' } }) });
  }
  private write(o: unknown): void { this.proc?.stdin?.write(`${JSON.stringify(o)}\n`); }
  private async notify(method: string): Promise<void> {
    if (this.conf.kind === 'stdio') { this.write({ jsonrpc: '2.0', method }); return; }
    await this.http({ jsonrpc: '2.0', method }, 0).catch(() => undefined);
  }
  private async http(msg: unknown, id: number): Promise<unknown> {
    const h: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL };
    if (this.session) h['mcp-session-id'] = this.session;
    if (this.token) h.authorization = `Bearer ${this.token}`;
    const r = await this.fetcher(this.conf.url!, { method: 'POST', headers: h, body: JSON.stringify(msg), signal: AbortSignal.timeout(120_000) });
    const sid = r.headers.get('mcp-session-id'); if (sid) this.session = sid;
    if (r.status === 202 || !id) return undefined;
    if (!r.ok) throw new Error(`${this.conf.name} : HTTP ${r.status}${r.status === 401 ? ' (jeton refusé)' : ''}`);
    const m = parseHttpReply(r.headers.get('content-type') ?? '', await r.text(), id) as { result?: unknown; error?: { message?: string } };
    if (m.error) throw new Error(m.error.message ?? 'erreur MCP');
    return m.result;
  }
  private request(method: string, params: unknown, timeout = 30_000): Promise<unknown> {
    const id = this.nextId++, msg = { jsonrpc: '2.0', id, method, params };
    if (this.conf.kind === 'http') return this.http(msg, id);
    return new Promise((res, rej) => { const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`${this.conf.name} : pas de réponse (${method})`)); }, timeout); this.pending.set(id, { res, rej, t }); this.write(msg); });
  }
}

// ---------------------------------------------------------------- Serveur MCP d'Odin
interface Rpc { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown> }
/** Outils exposés : une entrée par appli (action au choix), plus le conseil et la liste. */
export function serverTools(v: Valhalla): McpTool[] {
  const safe = (m: ReturnType<Valhalla['modules']>[number]) => m.actions.filter((a) => !a.grave);
  return [
    { name: 'odin_applis', description: 'Liste des applis d\'Odin et ce que fait chacune.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'odin_conseil', description: 'Pour un besoin en français : quelle appli d\'Odin utiliser, pourquoi et comment.', inputSchema: { type: 'object', properties: { besoin: { type: 'string' } }, required: ['besoin'] }, annotations: { readOnlyHint: true } },
    ...v.modules().filter((m) => safe(m).length).map((m) => ({ name: `odin_${m.id}`, description: `${m.name} — ${m.what} Actions : ${safe(m).map((a) => `${a.id} (${a.what}${a.params?.length ? ` ; réglages : ${a.params.map((p) => `${p.key}${p.required ? '*' : ''}`).join(', ')}` : ''})`).join(' · ')}.`, inputSchema: { type: 'object', properties: { action: { type: 'string', enum: safe(m).map((a) => a.id) }, entree: { type: 'object', description: 'réglages de l\'action' } }, required: ['action'] }, annotations: { readOnlyHint: safe(m).every((a) => a.read), destructiveHint: false } })),
  ];
}
export async function serverHandle(v: Valhalla, msg: Rpc, advise: (need: string) => string): Promise<unknown | undefined> {
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined) return undefined; // notification
  switch (msg.method) {
    case 'initialize': return ok({ protocolVersion: SUPPORTED.includes(String(msg.params?.protocolVersion)) ? String(msg.params?.protocolVersion) : PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'odin', title: 'Odin', version: '1' }, instructions: 'Applis d\'Odin (sécurité, machines, sauvegardes, maison, caméras, rendez-vous…). Les actions graves ne sont pas disponibles ici : elles se valident dans Odin.' });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: serverTools(v) });
    case 'tools/call': {
      const name = String(msg.params?.name ?? ''), args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const text = (t: string, isError = false) => ok({ content: [{ type: 'text', text: t }], isError });
      if (name === 'odin_applis') return text(v.modules().map((m) => `- ${m.name} (${m.family}) : ${m.what}`).join('\n'));
      if (name === 'odin_conseil') return text(advise(String(args.besoin ?? '')));
      const m = v.module(name.replace(/^odin_/, '')); if (!m) return err(-32602, `outil inconnu : ${name}`);
      const a = m.actions.find((x) => x.id === String(args.action)); if (!a) return text(`Action inconnue. Actions : ${m.actions.filter((x) => !x.grave).map((x) => x.id).join(', ')}`, true);
      const input = (args.entree && typeof args.entree === 'object' ? args.entree : {}) as Record<string, unknown>;
      const r = await v.act(m.id, a.id, input, { auto: true, by: 'assistant', why: 'demandé par un autre assistant (MCP)' });
      return text(r.text, r.ok === false);
    }
    default: return err(-32601, `méthode inconnue : ${msg.method}`);
  }
}
