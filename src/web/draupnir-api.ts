// API web de Draupnir (automatisations) et de Runes (pages et bases), plus les adresses publiques
// des automatisations : /h/<chemin secret> (webhook) et /f/<chemin secret> (formulaire hébergé par Odin).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { CATALOG, NODES } from '../draupnir/nodes.ts';
import { flowFromDescription, importN8n, templates } from '../draupnir/service.ts';
import type { Odin } from '../runtime.ts';
import { secretHint, writeSecret } from '../settings.ts';
import { draupnirOf } from '../tools/draupnir.ts';
import { runesOf } from '../tools/runes.ts';
import type { NoteMeta } from '../brain/vault.ts';

const s = (v: unknown) => String(v ?? '');
const ctxOf = (odin: Odin) => ({ home: odin.paths.home, careCfg: odin.cfg, workspace: odin.paths.workspace });
const outs = (type: string, params: Record<string, unknown>) => { const d = CATALOG.get(type); const o = d?.outputs; return typeof o === 'function' ? o(params) : o ?? ['sortie']; };

export function catalogForUi() {
  return NODES.map((n) => ({ type: n.type, label: n.label, group: n.group, what: n.what, trigger: Boolean(n.trigger), inputs: n.inputs ?? ['entrée'], outputs: typeof n.outputs === 'function' ? null : n.outputs ?? ['sortie'], params: n.params }));
}

export async function draupnirGet(odin: Odin, path: string, q: URLSearchParams, base: string): Promise<unknown> {
  const d = draupnirOf(); if (!d) return { ok: false, error: 'Draupnir n\'est pas démarré' };
  switch (path) {
    case '/api/draupnir/state': {
      const creds = Object.keys(process.env).filter((k) => /^DRAUPNIR_[A-Z0-9_]+$/.test(k)).map((k) => ({ name: k.slice(9), ...secretHint(k) }));
      return { ok: true, base, flows: d.list().map((w) => { const r = d.runs(w.id, 5); return { id: w.id, name: w.name, active: w.active, nodes: w.nodes.map((n) => ({ name: n.name, type: n.type, label: CATALOG.get(n.type)?.label ?? n.type })), updatedAt: w.updatedAt, last: r[0] ? { status: r[0].status, at: r[0].startedAt, error: r[0].error } : null, failed: r.filter((x) => x.status === 'erreur').length }; }), catalog: catalogForUi(), templates: templates().map((t) => ({ id: t.id, name: t.name, what: t.what })), creds };
    }
    case '/api/draupnir/flow': {
      const w = d.get(s(q.get('id'))); if (!w) return { ok: false, error: 'automatisation introuvable' };
      return { ok: true, flow: w, outputs: Object.fromEntries(w.nodes.map((n) => [n.name, outs(n.type, n.params)])), runs: d.runs(w.id, 20), versions: d.versions(w.id) };
    }
    default: return undefined;
  }
}

export async function draupnirPost(odin: Odin, path: string, b: Record<string, unknown>): Promise<unknown> {
  const d = draupnirOf(); if (!d) return { ok: false, error: 'Draupnir n\'est pas démarré' };
  try {
    switch (path) {
      case '/api/draupnir/save': return { ok: true, flow: d.save(b.flow as never) };
      case '/api/draupnir/toggle': return { ok: true, flow: d.setActive(s(b.id), b.on === true) };
      case '/api/draupnir/trash': d.trash(s(b.id)); return { ok: true };
      case '/api/draupnir/run': return { ok: true, run: await d.run(s(b.id), Array.isArray(b.items) ? b.items as never : undefined, 'test', s(b.start) || undefined, { stopAfter: s(b.stopAfter) || undefined, pinned: (b.pinned ?? undefined) as never }) };
      case '/api/draupnir/restore': return { ok: true, flow: d.restore(s(b.id), Number(b.at)) };
      case '/api/draupnir/template': { const t = templates().find((x) => x.id === s(b.id)); if (!t) return { ok: false, error: 'modèle inconnu' }; return { ok: true, flow: d.save({ ...t.flow, active: false }) }; }
      case '/api/draupnir/import': { const src = typeof b.json === 'string' ? JSON.parse(b.json) : b.json; const r = importN8n(src as never); return { ok: true, flow: d.save({ ...r.flow, active: false }), todo: r.todo }; }
      case '/api/draupnir/create': {
        const llm = (sys: string, user: string) => odin.agent.deps.router.complete({ system: sys, messages: [{ role: 'user', content: user }], tools: [], maxTokens: 6000 }, { minTier: 'standard', purpose: 'automatisation', need: 'code' }).then((r) => r.text);
        return { ok: true, flow: d.save({ ...(await flowFromDescription(llm, s(b.description))), active: false }) };
      }
      case '/api/draupnir/secret': {
        const name = s(b.name).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
        if (!/^[A-Z0-9_]{2,40}$/.test(name)) return { ok: false, error: 'nom invalide (lettres, chiffres, _)' };
        writeSecret(odin.paths, `DRAUPNIR_${name}`, s(b.value));
        return { ok: true, name };
      }
      default: return undefined;
    }
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

// ---------------------------------------------------------------- Runes

export function runesGet(odin: Odin, path: string, q: URLSearchParams): unknown {
  const r = runesOf(ctxOf(odin));
  try {
    switch (path) {
      case '/api/runes/bases': return { ok: true, bases: r.bases().map((b) => ({ id: b.id, name: b.name, icon: b.icon ?? '', folder: b.folder, count: r.rows(b.id).length, views: b.views.length })) };
      case '/api/runes/query': { const x = r.query(s(q.get('base')), s(q.get('view')) || undefined, { q: s(q.get('q')) }); return { ok: true, ...x }; }
      case '/api/runes/page': { const p = s(q.get('path')); return { ok: true, children: r.children(p), comments: r.comments(p), history: r.history(p).slice(0, 30), base: r.baseOf(p)?.id ?? null }; }
      default: return undefined;
    }
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
export function runesCsv(odin: Odin, base: string): string { return runesOf(ctxOf(odin)).exportCsv(base); }

export async function runesPost(odin: Odin, path: string, b: Record<string, unknown>, tell: (t: string) => Promise<void>): Promise<unknown> {
  const r = runesOf(ctxOf(odin));
  try {
    switch (path) {
      case '/api/runes/base/create': return { ok: true, base: r.createBase(s(b.name), (b.props ?? []) as never) };
      case '/api/runes/base/update': return { ok: true, base: r.updateBase(s(b.id), b.patch as never) };
      case '/api/runes/prop/add': return { ok: true, base: r.addProp(s(b.base), b.prop as never) };
      case '/api/runes/prop/rename': return { ok: true, base: r.renameProp(s(b.base), s(b.key), s(b.label)) };
      case '/api/runes/prop/remove': return { ok: true, base: r.removeProp(s(b.base), s(b.key)) };
      case '/api/runes/view/save': return { ok: true, base: r.saveView(s(b.base), b.view as never) };
      case '/api/runes/view/remove': return { ok: true, base: r.removeView(s(b.base), s(b.view)) };
      case '/api/runes/row/add': return { ok: true, path: r.addRow(s(b.base), s(b.title) || 'Sans titre', (b.props ?? {}) as NoteMeta, s(b.body), s(b.template) || undefined) };
      case '/api/runes/row/update': {
        const u = r.updateRow(s(b.path), (b.props ?? {}) as NoteMeta, s(b.base) || undefined);
        for (const a of u.fired) {
          if (a.then.kind === 'prévenir') await tell(`📋 ${a.then.text} — ${u.path.split('/').pop()?.replace(/\.md$/, '')}`).catch(() => {});
          if (a.then.kind === 'draupnir') void draupnirOf()?.call(a.then.flow, [{ json: { fiche: u.path, ...(b.props as object) } }], 0).catch(() => {});
        }
        return { ok: true, path: u.path, fired: u.fired.length };
      }
      case '/api/runes/child': return { ok: true, path: r.childPage(s(b.parent), s(b.title) || 'Sans titre', s(b.body)) };
      case '/api/runes/comment': return { ok: true, comments: r.comment(s(b.path), 'Toi', s(b.text)) };
      case '/api/runes/comment/resolve': return { ok: true, comments: r.resolveComment(s(b.path), s(b.id)) };
      case '/api/runes/restore': return { ok: true, path: r.restoreVersion(s(b.path), Number(b.at)) };
      case '/api/runes/import': return { ok: true, count: r.importCsv(s(b.base), s(b.csv)) };
      default: return undefined;
    }
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

// ---------------------------------------------------------------- Adresses publiques

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
async function body(req: IncomingMessage, max = 256 * 1024): Promise<string> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) throw new Error('trop gros'); parts.push(c as Buffer); }
  return Buffer.concat(parts).toString('utf8');
}
function page(res: ServerResponse, code: number, title: string, inner: string): void {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'referrer-policy': 'no-referrer' });
  res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{color-scheme:light dark;--bg:#F4F5F7;--card:#fff;--ink:#14171C;--muted:#555B66;--line:#D3D7DE;--accent:#2F5BD3;--bad:#B42318}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--card:#1B1E23;--ink:#ECEEF1;--muted:#A9AFB9;--line:#343943;--accent:#7EA0F2;--bad:#F97066}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:560px;margin:0 auto;padding:32px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px}
h1{font-size:24px;margin:0 0 8px}p{margin:0 0 16px;color:var(--muted)}
label{display:block;font-weight:600;margin:14px 0 6px}
input,textarea,select{width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit;font:inherit}
textarea{min-height:120px}
button{margin-top:20px;min-height:48px;width:100%;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{color:var(--bad);font-weight:600}.foot{margin-top:16px;font-size:13px;color:var(--muted);text-align:center}
</style></head><body><main><div class="card">${inner}</div><div class="foot">Propulsé par Odin</div></main></body></html>`);
}

/** /h/… et /f/… : sans connexion, chemin secret, débit limité. Renvoie true si la requête a été traitée. */
export async function publicRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const m = /^\/(h|f)\/([\w-]{12,64})$/.exec(url.pathname);
  if (!m) return false;
  const d = draupnirOf();
  if (!d) { res.writeHead(503); res.end(); return true; }
  if (m[1] === 'h') {
    let raw = ''; try { raw = req.method === 'GET' ? '' : await body(req, 1024 * 1024); } catch { res.writeHead(413); res.end(); return true; }
    let data: unknown = raw;
    const ct = String(req.headers['content-type'] ?? '');
    if (/json/.test(ct) || /^\s*[[{]/.test(raw)) { try { data = JSON.parse(raw); } catch { /* texte */ } } else if (/urlencoded/.test(ct)) data = Object.fromEntries(new URLSearchParams(raw));
    const r = await d.webhook(m[2], data, Object.fromEntries(url.searchParams), req.method ?? 'GET');
    res.writeHead(r.status, { 'content-type': typeof r.body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    return true;
  }
  const def = d.form(m[2]);
  if (!def) { page(res, 404, 'Formulaire introuvable', '<h1>Formulaire introuvable</h1><p>Ce lien n\'est plus actif.</p>'); return true; }
  let error = '', values: Record<string, string> = {};
  if (req.method === 'POST') {
    try { values = Object.fromEntries(new URLSearchParams(await body(req))); } catch { values = {}; }
    if (values._site) { page(res, 200, def.title, `<h1>${esc(def.title)}</h1><p>${esc(def.thanks)}</p>`); return true; } // piège à robots
    const r = await d.submitForm(m[2], values);
    if (r.ok) { page(res, 200, def.title, `<h1>${esc(def.title)}</h1><p>${esc(r.thanks ?? 'Merci.')}</p>`); return true; }
    error = r.error ?? 'erreur';
  }
  const fields = def.fields.map((f) => {
    const id = `f_${f.key}`, req2 = f.required ? ' required' : '', v = esc(values[f.key] ?? '');
    const input = f.kind === 'long' ? `<textarea id="${id}" name="${f.key}"${req2}>${v}</textarea>` : f.kind === 'choix' ? `<select id="${id}" name="${f.key}"${req2}><option value="">—</option>${f.choices.map((c) => `<option${values[f.key] === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>` : `<input id="${id}" name="${f.key}" type="${f.kind === 'email' ? 'email' : 'text'}" value="${v}"${req2}${f.kind === 'email' ? ' autocomplete="email"' : ''}>`;
    return `<label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}`;
  }).join('');
  page(res, error ? 400 : 200, def.title, `<h1>${esc(def.title)}</h1>${def.intro ? `<p>${esc(def.intro)}</p>` : ''}${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}<form method="post">${fields}<div style="position:absolute;left:-9999px" aria-hidden="true"><label for="f_site">Site</label><input id="f_site" name="_site" tabindex="-1" autocomplete="off"></div><button type="submit">Envoyer</button></form>`);
  return true;
}
