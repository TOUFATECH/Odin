// Cerveau de secours : quand aucun modèle d'IA n'est joignable (plus d'Internet, plus de clé, Claude,
// ChatGPT, OpenRouter et le modèle local tous en panne), Odin répond quand même avec ce qu'il sait :
// sa mémoire, ses fiches, ses conversations passées, l'état de la maison, tes rappels, ton budget.
// Il comprend aussi quelques demandes simples sans IA (rappels, réseau, heure). La question est gardée
// et il y répond pour de vrai dès qu'un modèle revient.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Muninn } from '../muninn/store.ts';
import { isReminderJob, parseWhen, reminderText, whenFr } from '../cron/reminders.ts';
import { allThreads } from '../muninn/threads.ts';

export interface OfflineDeps { muninn: Muninn; home?: string; inventory?: { list(f: { status: 'all' }): Array<{ ip: string; label: string; name: string; hostname: string; kind: string; status: string }> } }
export interface QueuedAsk { text: string; sessionId: string; channel: string; peer: string; at: number; tries: number }
export const QUEUE_KEY = 'offline-queue';

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");
const STOP = new Set('les des une un le la de du et ou en au aux pour par sur avec dans ce cette ces mes mon ma tes ton ta est sont quoi comment quel quelle quels quelles qui que tu me moi il elle on nous vous peux est-ce stp svp odin bonjour salut dis donne fais'.split(' '));
const words = (t: string) => norm(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));

/** Garde la question pour y répondre quand un modèle revient. */
export function queueAsk(kv: Pick<Muninn, 'getKv' | 'setKv'>, q: Omit<QueuedAsk, 'tries'>): void {
  let l: QueuedAsk[] = []; try { l = JSON.parse(kv.getKv(QUEUE_KEY) ?? '[]') as QueuedAsk[]; } catch { /* vide */ }
  if (l.some((x) => x.text === q.text && x.sessionId === q.sessionId)) return;
  l.push({ ...q, tries: 0 }); kv.setKv(QUEUE_KEY, JSON.stringify(l.slice(-20)));
}

/** Réponse sans modèle. */
export function offlineAnswer(d: OfflineDeps, text: string, ctx: { channel: string; peer: string }, now = new Date()): { text: string; handled: boolean } {
  const s = norm(text), parts: string[] = [];
  let handled = false;
  // 1. Demandes comprises sans IA
  if (/\b(quelle heure|on est quel jour|quelle date|quel jour)\b/.test(s) && (handled = true)) parts.push(`Il est ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, ${now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`);
  const rem = /\brappelle[- ]moi\b(?: de| d')?\s*(.+)/i.exec(text);
  if (rem) {
    const when = parseWhen(rem[1], now);
    if (when && when.getTime() > now.getTime()) {
      const what = rem[1].replace(/\b(demain|apres[- ]demain|ce soir|ce matin|dans \S+ \S+|(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)( prochain)?|a \d{1,2}\s*h(\d{2})?|\d{1,2}\s*h(\d{2})?|le \d{1,2}( \w+)?)\b/gi, '').replace(/\s+/g, ' ').trim() || rem[1];
      d.muninn.addJob({ id: `rem_${now.getTime().toString(36)}`, cron: '@reminder', prompt: what.slice(0, 500), channel: ctx.channel, peer: ctx.peer, next_run: when.getTime(), tainted: 0 });
      parts.push(`🔔 C'est noté : je te rappelle « ${what} » ${whenFr(when)}.`); handled = true;
    } else parts.push('Je n\'ai pas compris quand te le rappeler (essaie « demain 9h » ou « dans 20 min »).');
  }
  if (/\b(mes rappels|rappels|qu'est-ce que j'ai (aujourd'hui|demain)|mon programme)\b/.test(s) && !rem) {
    const l = d.muninn.listJobs().filter(isReminderJob).sort((a, b) => a.next_run - b.next_run).slice(0, 8);
    handled = true;
    parts.push(l.length ? `Tes rappels :\n${l.map((j) => `- ${whenFr(new Date(j.next_run))} : ${reminderText(j)}`).join('\n')}` : 'Aucun rappel programmé.');
  }
  if (/\b(reseau|appareils?|machines?|qui est (a la maison|la)|connectes?|en ligne)\b/.test(s) && d.inventory) {
    const devs = d.inventory.list({ status: 'all' }), on = devs.filter((x) => x.status === 'online');
    const phones = on.filter((x) => /phone|telephone|iphone|android|pixel|galaxy/i.test(`${x.kind} ${x.name} ${x.hostname} ${x.label}`));
    parts.push(`Réseau (dernier relevé) : ${on.length}/${devs.length} appareils en ligne.${phones.length ? ` Téléphones présents : ${phones.map((x) => x.label || x.name || x.hostname || x.ip).join(', ')}.` : ''}`);
  }
  // 2. Ce que je sais (mémoire, fiches, conversations passées)
  const known: string[] = [];
  try { for (const m of d.muninn.recall(text, 5)) if (m.origin !== 'untrusted') known.push(`- ${m.content.replace(/\s+/g, ' ').slice(0, 300)}`); } catch { /* mémoire indisponible */ }
  const ws = words(text);
  if (ws.length) {
    for (const t of allThreads(d.muninn).filter((x) => !x.tainted)) {
      const hay = norm(`${t.title} ${t.goal} ${t.state} ${t.facts.join(' ')}`);
      if (ws.filter((w) => hay.includes(w)).length >= Math.min(2, ws.length)) known.push(`- (conversation du ${new Date(t.updated).toLocaleDateString('fr-FR')}) ${t.state.slice(0, 250)}${t.facts.length ? ` — ${t.facts.slice(-3).join(' ; ')}` : ''}`);
      if (known.length >= 8) break;
    }
    const nd = d.home ? join(d.home, 'notes') : '';
    if (nd && existsSync(nd)) for (const f of readdirSync(nd).filter((x) => x.endsWith('.md'))) {
      const body = readFileSync(join(nd, f), 'utf8');
      if (ws.filter((w) => norm(body).includes(w)).length >= Math.min(2, ws.length)) known.push(`- (fiche ${f.replace(/\.md$/, '')}) ${body.replace(/^#.*\n/, '').replace(/\s+/g, ' ').slice(0, 400)}`);
    }
  }
  if (known.length && !rem) parts.push(`Voici ce que je sais à ce sujet :\n${[...new Set(known)].slice(0, 8).join('\n')}`);
  if (!parts.length) parts.push('Je n\'ai rien en mémoire sur ce sujet pour l\'instant.');
  return { handled, text: `${parts.join('\n\n')}\n\n🔌 ${handled ? 'Fait sans modèle d\'IA (aucun n\'est joignable).' : 'Aucun modèle d\'IA joignable : réponse tirée de ma mémoire. Je garde ta question et j\'y réponds pour de vrai dès qu\'un modèle revient.'}` };
}
