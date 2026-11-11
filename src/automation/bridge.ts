// Pont entre les automatisations (n8n) et Odin.
//   handleHook : ce que n8n demande à Odin via /api/hook (clé dédiée, actions limitées, 60 par minute).
//   watchBrain : prévient les adresses n8n choisies quand une note du Cerveau change.
// Le contenu reçu d'une automatisation est traité comme une donnée (jamais comme un ordre de toi) :
// « ask » passe par l'agent en mode non fiable, sous Heimdall.

import { timingSafeEqual } from 'node:crypto';
import { vaultEvents, TYPES, type NoteMeta } from '../brain/vault.ts';
import type { Odin } from '../runtime.ts';
import { brainOf } from '../tools/brain.ts';
import { hookToken } from './n8n.ts';

const hits: number[] = [];
export function hookAllowed(home: string, given: string | undefined, now = Date.now()): boolean {
  const t = hookToken(home), g = Buffer.from(given ?? ''), want = Buffer.from(t);
  if (g.length !== want.length || !timingSafeEqual(g, want)) return false;
  while (hits.length && now - hits[0] > 60_000) hits.shift();
  if (hits.length >= 60) return false;
  hits.push(now);
  return true;
}

export async function handleHook(odin: Odin, b: Record<string, unknown>, tell: (text: string) => Promise<void>): Promise<{ ok: boolean; text?: string; path?: string; error?: string }> {
  const s = (x: unknown) => String(x ?? '').slice(0, 20_000);
  const v = brainOf({ home: odin.paths.home, careCfg: odin.cfg, workspace: odin.paths.workspace });
  switch (s(b.action)) {
    case 'note': {
      const type = TYPES[s(b.type)] ? s(b.type) : 'note';
      return { ok: true, path: v.create(s(b.titre || b.title) || 'Note d\'automatisation', type, odin.redactor.redact(s(b.contenu || b.content)), { source: 'automatisation', fiable: false } as NoteMeta) };
    }
    case 'ajouter': return { ok: true, path: v.append(s(b.note), odin.redactor.redact(s(b.texte || b.text)), s(b.section) || undefined) };
    case 'notify': { await tell(`🔁 ${s(b.text).slice(0, 2000)}`); return { ok: true }; }
    case 'capture':
    case 'ask': {
      const text = b.action === 'capture' ? `Capture ceci dans mon Cerveau avec cerveau_capturer (source : automatisation n8n) : ${s(b.source || b.text)}` : s(b.text);
      if (!text.trim()) return { ok: false, error: 'texte vide' };
      // Non fiable : ce que l'automatisation transporte (article, mail…) ne peut pas donner d'ordre grave.
      const r = await odin.agent.run(text, { sessionId: 'auto:n8n', channel: 'automatisation', peer: 'n8n', trusted: false, unattended: true });
      const out = r.text.trim();
      if (b.action === 'ask' && (s(b.send) === 'oui' || (s(b.send) === 'si-utile' && out && !/^\s*rien\b/i.test(out)))) await tell(out);
      return { ok: true, text: out };
    }
    default: return { ok: false, error: 'action inconnue (capture, note, ajouter, notify, ask)' };
  }
}

/** Notes du Cerveau qui changent → adresses n8n (une seule fois par note et par 10 s). */
export function watchBrain(odin: Odin): () => void {
  const last = new Map<string, number>();
  const on = (e: { path: string; kind: string; title?: string; type?: string }) => {
    const urls = odin.cfg.automation?.brainWebhooks ?? [];
    if (!urls.length) return;
    const k = `${e.kind}:${e.path}`, now = Date.now();
    if (now - (last.get(k) ?? 0) < 10_000) return;
    last.set(k, now);
    for (const u of urls) if (/^https?:\/\//.test(u)) void fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...e, at: new Date(now).toISOString() }), signal: AbortSignal.timeout(10_000) }).catch(() => {});
  };
  vaultEvents.on('change', on);
  return () => vaultEvents.off('change', on);
}
