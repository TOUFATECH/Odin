// OpenAI Codex avec ton abonnement ChatGPT (comme `hermes auth add openai-codex`).
//
// - Connexion « Se connecter avec ChatGPT » (OAuth + PKCE). Odin a SA propre connexion, rangée dans
//   ~/.odin/codex-auth.json (droits 600) : jamais partagée avec Codex CLI ni Hermes, car le jeton de
//   rafraîchissement change à chaque renouvellement et deux programmes sur la même copie se
//   déconnecteraient l'un l'autre.
// - Machine sans navigateur (LXC, serveur) : on ouvre le lien ailleurs ; après la connexion, le
//   navigateur arrive sur http://localhost:1455/auth/callback?code=… (page introuvable si Odin n'est
//   pas sur cette machine) : il suffit de recopier cette adresse dans Odin.
// - Les appels passent par l'API Responses de Codex (https://chatgpt.com/backend-api/codex), en flux.
// Aucune dépendance : fetch + node:crypto + node:http.

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import type { OdinPaths } from '../config.ts';
import type { CompletionRequest, Message, ModelResponse, Provider, ToolCall } from '../types.ts';
import { HttpError } from './http.ts';
import { parseArgs } from './openai.ts';

export const CODEX = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  redirectUri: 'http://localhost:1455/auth/callback',
  callbackPort: 1455,
  baseUrl: 'https://chatgpt.com/backend-api/codex',
  scope: 'openid profile email offline_access',
};

export interface CodexAuth {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  account_id: string;
  email?: string;
  plan?: string;
  expires_at: number;
  last_refresh: number;
}

export const codexAuthFile = (paths: OdinPaths) => join(paths.home, 'codex-auth.json');

export function loadCodexAuth(paths: OdinPaths): CodexAuth | undefined {
  try { return JSON.parse(readFileSync(codexAuthFile(paths), 'utf8')) as CodexAuth; } catch { return undefined; }
}
export function saveCodexAuth(paths: OdinPaths, a: CodexAuth): void {
  const f = codexAuthFile(paths);
  writeFileSync(f, JSON.stringify(a, null, 2), { mode: 0o600 });
  try { chmodSync(f, 0o600); } catch { /* Windows */ }
}
export function removeCodexAuth(paths: OdinPaths): void { rmSync(codexAuthFile(paths), { force: true }); }

/** Lit les « claims » d'un JWT sans le vérifier (seulement pour l'identifiant de compte et l'e-mail). */
export function jwtClaims(token: string | undefined): Record<string, unknown> {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as Record<string, unknown>; } catch { return {}; }
}
function fromTokens(t: { access_token: string; refresh_token?: string; id_token?: string; expires_in?: number }, prev?: CodexAuth): CodexAuth {
  const id = jwtClaims(t.id_token ?? prev?.id_token), acc = jwtClaims(t.access_token);
  const auth = (id['https://api.openai.com/auth'] ?? acc['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>;
  const accountId = String(auth.chatgpt_account_id ?? prev?.account_id ?? '');
  const exp = Number(acc.exp) ? Number(acc.exp) * 1000 : Date.now() + (t.expires_in ?? 3600) * 1000;
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? prev?.refresh_token ?? '',
    id_token: t.id_token ?? prev?.id_token,
    account_id: accountId,
    email: String(id.email ?? prev?.email ?? ''),
    plan: String(auth.chatgpt_plan_type ?? prev?.plan ?? ''),
    expires_at: exp,
    last_refresh: Date.now(),
  };
}

// ---------------- Connexion (OAuth + PKCE) ----------------

export interface CodexLogin { url: string; state: string; verifier: string; createdAt: number }
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Prépare une connexion : lien à ouvrir + secret PKCE à garder en mémoire jusqu'au retour. */
export function startCodexLogin(): CodexLogin {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(24));
  const q = new URLSearchParams({
    response_type: 'code', client_id: CODEX.clientId, redirect_uri: CODEX.redirectUri, scope: CODEX.scope,
    code_challenge: challenge, code_challenge_method: 'S256', id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true', state, originator: 'codex_cli_rs',
  });
  return { url: `${CODEX.authorizeUrl}?${q}`, state, verifier, createdAt: Date.now() };
}

/** Accepte l'adresse complète de retour (…/auth/callback?code=…&state=…) ou le code seul. */
export function parseCallback(input: string): { code: string; state?: string } {
  const s = input.trim();
  if (/^https?:\/\//.test(s) || s.includes('code=')) {
    const u = new URL(/^https?:\/\//.test(s) ? s : `http://x/?${s.replace(/^\?/, '')}`);
    const err = u.searchParams.get('error');
    if (err) throw new Error(`connexion refusée : ${u.searchParams.get('error_description') ?? err}`);
    const code = u.searchParams.get('code');
    if (!code) throw new Error('adresse sans « code= » : recopie l\'adresse complète affichée après la connexion');
    return { code, state: u.searchParams.get('state') ?? undefined };
  }
  if (!/^[\w.~-]{8,}$/.test(s)) throw new Error('code de connexion invalide');
  return { code: s };
}

/** Échange le code contre les jetons et les enregistre. */
export async function finishCodexLogin(paths: OdinPaths, login: CodexLogin, callback: string, fetcher: typeof fetch = fetch): Promise<CodexAuth> {
  if (Date.now() - login.createdAt > 15 * 60_000) throw new Error('connexion expirée (15 min) : recommence');
  const { code, state } = parseCallback(callback);
  if (state && state !== login.state) throw new Error('cette adresse ne correspond pas à la connexion en cours : recommence');
  const res = await fetcher(CODEX.tokenUrl, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CODEX.redirectUri, client_id: CODEX.clientId, code_verifier: login.verifier }),
  });
  if (!res.ok) throw new Error(`connexion refusée par OpenAI (HTTP ${res.status}) : ${(await res.text()).slice(0, 200)}`);
  const auth = fromTokens(await res.json() as { access_token: string; refresh_token: string; id_token: string; expires_in?: number });
  if (!auth.refresh_token) throw new Error('OpenAI n\'a pas renvoyé de jeton de rafraîchissement');
  if (!auth.account_id) throw new Error('compte ChatGPT introuvable dans la réponse (abonnement Plus, Pro, Business… requis)');
  saveCodexAuth(paths, auth);
  return auth;
}

/** Écoute http://localhost:1455/auth/callback pour finir la connexion toute seule quand le navigateur est sur la même machine. */
export function listenCodexCallback(paths: OdinPaths, login: CodexLogin, done: (r: { ok: boolean; error?: string; email?: string }) => void): Server | undefined {
  const srv = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://localhost');
    if (u.pathname !== '/auth/callback') { res.writeHead(404); return void res.end(); }
    try {
      const a = await finishCodexLogin(paths, login, `http://localhost${req.url}`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>Odin</title><body style="font:16px system-ui;background:#0B0E14;color:#E8E6E1;display:grid;place-items:center;height:100vh;margin:0"><p>✓ Odin est connecté à ChatGPT (Codex). Tu peux fermer cet onglet.</p>');
      done({ ok: true, email: a.email });
    } catch (e) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end((e as Error).message);
      done({ ok: false, error: (e as Error).message });
    } finally { setTimeout(() => srv.close(), 500); }
  });
  srv.on('error', () => { /* port 1455 occupé (Codex CLI, Hermes…) : on se contente du copier-coller */ });
  try { srv.listen(CODEX.callbackPort, '127.0.0.1'); } catch { return undefined; }
  setTimeout(() => srv.close(), 15 * 60_000).unref?.();
  return srv;
}

// ---------------- Jetons : rafraîchissement ----------------

const refreshing = new Map<string, Promise<CodexAuth>>();
/** Jeton valide (rafraîchi s'il expire dans moins de 5 min, ou si force). Un seul rafraîchissement à la fois. */
export async function codexToken(paths: OdinPaths, force = false, fetcher: typeof fetch = fetch): Promise<CodexAuth> {
  const cur = loadCodexAuth(paths);
  if (!cur) throw new Error('Odin n\'est pas connecté à ChatGPT : Réglages → Modèle → « Se connecter avec ChatGPT », ou « odin auth add openai-codex »');
  if (!force && cur.expires_at - Date.now() > 5 * 60_000) return cur;
  const key = paths.home;
  if (!refreshing.has(key)) {
    refreshing.set(key, (async () => {
      const res = await fetcher(CODEX.tokenUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: CODEX.clientId, grant_type: 'refresh_token', refresh_token: cur.refresh_token, scope: 'openid profile email' }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200);
        if (res.status === 400 || res.status === 401) throw new Error(`connexion ChatGPT expirée ou révoquée (reconnecte-toi : Réglages → Modèle) — ${body}`);
        throw new HttpError(res.status, body, res.headers.get('retry-after'));
      }
      const next = fromTokens(await res.json() as { access_token: string; refresh_token?: string; id_token?: string; expires_in?: number }, cur);
      saveCodexAuth(paths, next);
      return next;
    })().finally(() => refreshing.delete(key)));
  }
  return refreshing.get(key)!;
}

// ---------------- Fournisseur (API Responses de Codex) ----------------

/** Historique Odin → éléments « input » de l'API Responses (pur, testable). */
export function toResponsesInput(messages: Message[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: m.content }, ...(m.images ?? []).map((i) => ({ type: 'input_image', image_url: `data:${i.mime};base64,${i.data}` }))] });
    } else if (m.role === 'tool') {
      out.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.content });
    } else {
      if (m.content) out.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: m.content }] });
      for (const c of m.toolCalls ?? []) out.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.input) });
    }
  }
  return out;
}

/** Lit un flux SSE de l'API Responses et reconstruit la réponse (pur, testable). */
export function parseResponsesStream(raw: string): ModelResponse {
  let text = '';
  const calls: ToolCall[] = [];
  let usage = { inputTokens: 0, outputTokens: 0 }, incomplete = false, failed = '';
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
    if (!data || data === '[DONE]') continue;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(data) as Record<string, unknown>; } catch { continue; }
    const type = String(ev.type ?? '');
    if (type === 'response.output_text.delta') text += String(ev.delta ?? '');
    else if (type === 'response.output_item.done') {
      const it = ev.item as Record<string, unknown> | undefined;
      if (it?.type === 'function_call') calls.push({ id: String(it.call_id ?? it.id ?? `call_${calls.length}`), name: String(it.name), input: parseArgs(String(it.arguments ?? '')) });
      if (it?.type === 'message' && !text) for (const c of (it.content as Array<Record<string, unknown>> | undefined) ?? []) if (c.type === 'output_text') text += String(c.text ?? '');
    } else if (type === 'response.completed' || type === 'response.incomplete') {
      const r = ev.response as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined;
      usage = { inputTokens: r?.usage?.input_tokens ?? 0, outputTokens: r?.usage?.output_tokens ?? 0 };
      if (type === 'response.incomplete') incomplete = true;
    } else if (type === 'response.failed' || type === 'error') {
      const r = (ev.response as { error?: { message?: string } } | undefined)?.error ?? (ev as { error?: { message?: string }; message?: string });
      failed = String((r as { message?: string }).message ?? (ev as { message?: string }).message ?? 'échec');
    }
  }
  if (failed && !text && !calls.length) throw new Error(`Codex : ${failed}`);
  return { text, toolCalls: calls, usage, stopReason: calls.length ? 'tool_use' : incomplete ? 'max_tokens' : 'end' };
}

export class CodexProvider implements Provider {
  readonly name: string;
  private paths: OdinPaths;
  private fetcher: typeof fetch;
  private baseUrl: string;
  constructor(paths: OdinPaths, name = 'openai-codex', baseUrl = CODEX.baseUrl, fetcher: typeof fetch = fetch) {
    this.paths = paths; this.name = name; this.baseUrl = baseUrl; this.fetcher = fetcher;
  }

  async complete(req: CompletionRequest): Promise<ModelResponse> {
    const body = JSON.stringify({
      model: req.model,
      instructions: req.system,
      input: toResponsesInput(req.messages),
      tools: req.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema, strict: false })),
      tool_choice: 'auto',
      parallel_tool_calls: true,
      store: false,
      stream: true,
      include: [],
    });
    const call = async (auth: CodexAuth) => this.fetcher(`${this.baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', accept: 'text/event-stream',
        authorization: `Bearer ${auth.access_token}`, 'chatgpt-account-id': auth.account_id,
        'OpenAI-Beta': 'responses=experimental', originator: 'codex_cli_rs',
      },
      body, signal: req.signal,
    });
    let auth = await codexToken(this.paths, false, this.fetcher);
    let res = await call(auth);
    if (res.status === 401) { auth = await codexToken(this.paths, true, this.fetcher); res = await call(auth); }
    if (!res.ok) throw new HttpError(res.status, await res.text(), res.headers.get('retry-after'));
    return parseResponsesStream(await res.text());
  }
}

/** Modèles proposés par défaut (la liste réelle dépend de l'abonnement ; on peut en saisir un autre). */
export const CODEX_MODELS = ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4-mini'];
