// Völva sur Telegram (maquette validée « Recherche sur Telegram ») : la réponse en carte — le titre, la réponse avec
// ses numéros de sources en petit, « l'essentiel », les sources en liens, et une ligne « Völva · n sources · heure ».
// HTML de Telegram seulement (b, i, a, blockquote) ; tout le texte venu des sources est échappé. Pur.
import type { Source } from './engine.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n: string) => [...n].map((c) => SUP[c] ?? c).join('');
/** Un titre court tiré de la question (« Comment sécuriser le Wi-Fi ? » → « Sécuriser le Wi-Fi »). */
export function titleOf(q: string): string {
  let t = q.trim().replace(/[?？!.]+$/, '').replace(/^(cherche|trouve|dis-moi|explique-moi|peux-tu me dire)\s+/i, '').replace(/^(comment|pourquoi|quand|où|ou)\s+/i, '').replace(/,?\s+et\s+envoie-moi.*$/i, '').trim();
  t = t.charAt(0).toUpperCase() + t.slice(1); return t.length > 70 ? `${t.slice(0, 69)}…` : t;
}
export function searchCard(e: { q: string; answer: string; sources: Source[]; essentials?: Array<{ title: string; detail?: string }>; at: number }, o: { tz?: string } = {}): string {
  const answer = esc(e.answer).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\s*((?:\[\d{1,2}\])+)/g, (_m, g: string) => ` ${[...g.matchAll(/\d{1,2}/g)].map((x) => sup(x[0])).join('˒')}`).trim();
  const ess = (e.essentials ?? []).slice(0, 4).map((x) => `▫️ ${esc(x.title)}${x.detail ? ` <i>— ${esc(x.detail)}</i>` : ''}`);
  const shown = e.sources.slice(0, 3).map((x) => `<a href="${esc(x.url).replace(/"/g, '&quot;')}">${esc(x.domain.replace(/^www\./, '').replace(/^fr\.wikipedia\.org$/, 'Wikipédia'))}</a>`);
  const more = e.sources.length > 3 ? ` · +${e.sources.length - 3}` : '';
  const hm = new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', ...(o.tz ? { timeZone: o.tz } : {}) });
  return [`<b>${esc(titleOf(e.q))}</b>`, '', answer.slice(0, 2600), ...(ess.length ? ['', `<blockquote>${ess.join('\n')}</blockquote>`] : []), '',
    ...(shown.length ? [`Sources : ${shown.join(' · ')}${more}`] : []), `<i>Völva · ${e.sources.length} source${e.sources.length > 1 ? 's' : ''} · ${hm}</i>`].join('\n');
}
