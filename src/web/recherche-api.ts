// Pythie sur le web : la page /recherche (façon Perplexity), son script, et son API /api/recherche/*.
// Réservé à ta session Odin. La page ne construit jamais de HTML à partir du texte des sources.
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FOCUS, toMarkdown, type Focus } from '../valhalla/volva/engine.ts';
import { activeEngines, ask, ENGINES, gather, history } from '../valhalla/modules/volva.ts';
import { assertPublicUrl } from '../heimdall/policy.ts';
import { valhallaOf } from '../valhalla/odin.ts';

const JS = (() => { try { return readFileSync(new URL('./recherche.js', import.meta.url)); } catch { return Buffer.from(''); } })();
const s = (v: unknown) => String(v ?? '');
const json = (res: ServerResponse, code: number, b: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(b)); };
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > 16_384) throw new Error('trop long'); parts.push(c as Buffer); }
  try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return j && typeof j === 'object' ? j as Record<string, unknown> : {}; } catch { return {}; }
}

export async function rechercheRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: { authed: boolean; mascot: string }): Promise<boolean> {
  const p = url.pathname;
  if (p === '/recherche.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' }); res.end(JS); return true; }
  if (p === '/recherche' && req.method === 'GET') {
    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` });
    res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0f1116"><title>Pythie · Odin</title><link rel="icon" href="/favicon.svg"></head><body><noscript>Pythie a besoin de JavaScript.</noscript><template id="mascotte">${d.mascot}</template><script nonce="${nonce}" src="/face.js"></script><script nonce="${nonce}" src="/recherche.js"></script><script nonce="${nonce}" src="/plume.js"></script></body></html>`);
    return true;
  }
  if (!p.startsWith('/api/recherche/')) return false;
  if (!d.authed) { json(res, 401, { ok: false, error: 'connexion requise' }); return true; }
  const v = valhallaOf(); if (!v?.module('volva')) { json(res, 503, { ok: false, error: 'Pythie n\'est pas démarré' }); return true; }
  const ctx = v.ctx('volva');
  if (req.method === 'GET' && p === '/api/recherche/etat') { json(res, 200, { ok: true, engines: activeEngines(ctx).map((e) => ENGINES[e].label.split(' (')[0]), focus: Object.fromEntries(Object.entries(FOCUS).map(([k, x]) => [k, x.label])), ai: Boolean(ctx.ask), history: history(ctx).slice(0, 60).map((h) => ({ id: h.id, q: h.q, at: h.at, thread: h.thread })) }); return true; }
  if (req.method === 'GET' && p === '/api/recherche/entree') { const e = history(ctx).find((h) => h.id === s(url.searchParams.get('id'))); json(res, e ? 200 : 404, e ? { ok: true, entry: e, thread: history(ctx).filter((h) => h.thread === (e.thread ?? e.id) || h.id === (e.thread ?? e.id)).reverse() } : { ok: false, error: 'recherche introuvable' }); return true; }
  if (req.method === 'GET' && p === '/api/recherche/markdown') { const e = history(ctx).find((h) => h.id === s(url.searchParams.get('id'))); if (!e) { json(res, 404, { ok: false }); return true; } res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="volva-${e.id}.md"`, 'cache-control': 'no-store' }); res.end(toMarkdown({ question: e.q, answer: e.answer, sources: e.sources, at: e.at, engines: e.engines })); return true; }
  // Vignettes des onglets Images et Vidéos : passées par Odin (la page n'appelle jamais d'autre site), images
  // publiques seulement, 3 Mo au plus, et rien d'autre qu'une image.
  if (req.method === 'GET' && p === '/api/recherche/vignette') {
    try {
      const u = assertPublicUrl(s(url.searchParams.get('u'))); if (!/^https?:$/.test(u.protocol)) throw new Error('adresse refusée');
      const r = await (ctx.fetch as typeof fetch)(u.toString(), { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' } });
      const type = r.headers.get('content-type') ?? ''; if (!r.ok || !/^image\/(png|jpe?g|gif|webp|avif)$/i.test(type.split(';')[0].trim())) throw new Error('pas une image');
      const b = Buffer.from(await r.arrayBuffer()); if (b.length > 3_000_000) throw new Error('trop lourde');
      res.writeHead(200, { 'content-type': type.split(';')[0].trim(), 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" }); res.end(b);
    } catch { res.writeHead(404); res.end(); }
    return true;
  }
  if (req.method !== 'POST') { json(res, 405, { ok: false }); return true; }
  if (req.headers['x-odin'] !== '1') { json(res, 403, { ok: false, error: 'en-tête x-odin manquant' }); return true; }
  let b: Record<string, unknown>; try { b = await readBody(req); } catch { json(res, 413, { ok: false, error: 'trop long' }); return true; }
  if (p === '/api/recherche/chercher') {
    const q = s(b.question).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 1000); if (!q) { json(res, 400, { ok: false, error: 'pose une question' }); return true; }
    try { json(res, 200, { ok: true, entry: await ask(ctx, q, { focus: (s(b.focus) || 'tout') as Focus, deep: b.approfondie === true, thread: s(b.suite) || undefined }) }); }
    catch (e) { json(res, 200, { ok: false, error: (e as Error).message }); }
    return true;
  }
  if (p === '/api/recherche/medias') {
    // Les onglets Images et Vidéos : la même question, cherchée en images ou en vidéos.
    const q = s(b.question).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 1000), kind = s(b.kind) === 'videos' ? 'videos' : 'images';
    if (!q) { json(res, 400, { ok: false, error: 'pose une question' }); return true; }
    try {
      const g = await gather(ctx, q, kind, 24), seen = new Set<string>(), items: Array<{ title: string; url: string; domain: string; thumb?: string }> = [];
      for (const l of g.lists) for (const r of l.results as Array<{ title: string; url: string; thumb?: string }>) { if (!/^https?:\/\//.test(r.url) || seen.has(r.url)) continue; seen.add(r.url); let d = ''; try { d = new URL(r.url).hostname.replace(/^www\./, ''); } catch { continue; } items.push({ title: r.title, url: r.url, domain: d, ...(r.thumb && /^https?:\/\//.test(r.thumb) ? { thumb: r.thumb } : {}) }); }
      json(res, 200, { ok: true, items: items.slice(0, 30), errors: g.errors });
    } catch (e) { json(res, 200, { ok: false, error: (e as Error).message }); }
    return true;
  }
  json(res, 404, { ok: false, error: 'introuvable' }); return true;
}
