// Pythie : les questions posées, gardées chez toi (questions.json du dossier de Pythie) pour les suggestions
// pendant la frappe. Réglable (« noter les questions ») et effaçable ; rien ne part ailleurs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModCtx } from '../types.ts';

const MAX = 200;
const fichier = (ctx: ModCtx) => join(ctx.dir, 'questions.json');

export function questionsRecentes(ctx: ModCtx): Array<{ q: string; at: number }> {
  try {
    const l = JSON.parse(readFileSync(fichier(ctx), 'utf8')) as unknown;
    return Array.isArray(l) ? l.filter((x): x is { q: string; at: number } => Boolean(x) && typeof (x as { q?: unknown }).q === 'string' && typeof (x as { at?: unknown }).at === 'number').slice(0, MAX) : [];
  } catch { return []; }
}
function garder(ctx: ModCtx, l: Array<{ q: string; at: number }>): void {
  try { mkdirSync(ctx.dir, { recursive: true }); writeFileSync(fichier(ctx), JSON.stringify(l.slice(0, MAX))); } catch { /* disque plein */ }
}
/** Note une question (la plus récente en tête, sans doublon, 200 au plus) ; rien si le réglage est coupé. */
export function noterQuestion(ctx: ModCtx, q: string): void {
  if (ctx.settings.noterQuestions === false) return;
  const t = String(q ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); if (!t) return;
  const cle = t.toLowerCase();
  garder(ctx, [{ q: t, at: Date.now() }, ...questionsRecentes(ctx).filter((x) => x.q.toLowerCase() !== cle)]);
}
export function effacerQuestions(ctx: ModCtx): void { garder(ctx, []); }
