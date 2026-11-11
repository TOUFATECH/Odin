// API de l'espace Automatisations : état de n8n, automatisations, modèles, pont avec le Cerveau.

import { hookToken, lanIp, listExecutions, listWorkflows, n8nStatus, setActive, createWorkflow, templates } from '../automation/n8n.ts';
import { setConfigValue } from '../config.ts';
import type { Odin } from '../runtime.ts';
import { writeSecret } from '../settings.ts';
import { createFromDescription, installN8n, n8nCfg, odinUrlForN8n } from '../tools/automation.ts';

let installing: Promise<string> | undefined;

export async function flowsState(odin: Odin): Promise<unknown> {
  const c = n8nCfg(odin.cfg), st = await n8nStatus(c);
  const open = c.url.replace('127.0.0.1', lanIp()).replace('localhost', lanIp());
  let workflows: unknown[] = [], failed = 0;
  if (st.keyOk) {
    const [wfs, ex] = await Promise.all([listWorkflows(c), listExecutions(c, undefined, 100).catch(() => [])]);
    const lastBy = new Map<string, { status?: string; startedAt?: string }>();
    for (const e of ex) if (!lastBy.has(e.workflowId)) lastBy.set(e.workflowId, e);
    failed = ex.filter((e) => e.status === 'error' && Date.now() - Date.parse(e.startedAt ?? '') < 86_400_000).length;
    workflows = wfs.map((w) => ({ id: w.id, name: w.name, active: w.active, updatedAt: w.updatedAt, nodes: (w.nodes ?? []).map((n) => n.type.replace(/^.*\./, '')), last: lastBy.get(w.id) ?? null, link: `${open}/workflow/${w.id}` }));
  }
  return {
    ok: true, ...st, installing: Boolean(installing), url: c.url, open, workflows, failed,
    templates: templates('', '').map((t) => ({ id: t.id, name: t.name, what: t.what })),
    bridge: { hookUrl: `${odinUrlForN8n(odin.cfg)}/api/hook`, tokenHint: `${hookToken(odin.paths.home).slice(0, 4)}…`, brainWebhooks: odin.cfg.automation?.brainWebhooks ?? [] },
  };
}

export async function flowsPost(odin: Odin, path: string, b: Record<string, unknown>): Promise<unknown> {
  const c = n8nCfg(odin.cfg), s = (x: unknown) => String(x ?? '');
  try {
    switch (path) {
      case '/api/flows/install':
        if (!installing) installing = installN8n(odin.paths.home).finally(() => { setTimeout(() => { installing = undefined; }, 1000); });
        return { ok: true, text: await installing };
      case '/api/flows/key': {
        const k = s(b.key).trim();
        if (!/^[\w.-]{20,}$/.test(k)) return { ok: false, error: 'clé invalide' };
        writeSecret(odin.paths, 'N8N_API_KEY', k);
        const st = await n8nStatus({ ...c, key: k });
        return st.keyOk ? { ok: true } : { ok: false, error: st.error ?? 'n8n ne répond pas' };
      }
      case '/api/flows/url': { const u = s(b.url).trim(); if (!/^https?:\/\/[^\s]+$/.test(u)) return { ok: false, error: 'adresse invalide' }; setConfigValue(odin.paths, ['automation', 'n8nUrl'], u.replace(/\/$/, '')); odin.cfg.automation = { ...odin.cfg.automation, n8nUrl: u.replace(/\/$/, '') }; return { ok: true }; }
      case '/api/flows/create': {
        const ctx = { llm: (sys: string, user: string, max?: number) => odin.agent.deps.router.complete({ system: sys, messages: [{ role: 'user', content: user }], tools: [], maxTokens: max ?? 4000 }, { minTier: 'standard', purpose: 'automatisation', need: 'code' }).then((r) => r.text), careCfg: odin.cfg, home: odin.paths.home };
        return await createFromDescription(ctx, s(b.description));
      }
      case '/api/flows/template': {
        const t = templates(odinUrlForN8n(odin.cfg), hookToken(odin.paths.home)).find((x) => x.id === s(b.id));
        if (!t) return { ok: false, error: 'modèle inconnu' };
        const w = await createWorkflow(c, t.wf);
        return { ok: true, id: w.id, link: `${c.url.replace('127.0.0.1', lanIp())}/workflow/${w.id}` };
      }
      case '/api/flows/toggle': { const w = await setActive(c, s(b.id), b.on === true); return { ok: true, active: w.active }; }
      case '/api/flows/token': return { ok: true, token: hookToken(odin.paths.home) };
      case '/api/flows/webhooks': {
        const list = s(b.urls).split(/[\s,]+/).filter((u) => /^https?:\/\/\S+$/.test(u)).slice(0, 10);
        setConfigValue(odin.paths, ['automation', 'brainWebhooks'], list);
        odin.cfg.automation = { ...odin.cfg.automation, brainWebhooks: list };
        return { ok: true, urls: list };
      }
      default: return undefined;
    }
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
