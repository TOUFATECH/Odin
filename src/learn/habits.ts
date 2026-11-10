// Habitudes : Odin apprend de toi et devient autonome là où tu le lui as montré.
//
// 1. Routines : ce que tu lui demandes souvent, à peu près à la même heure (chaque jour, ou le même
//    jour de la semaine), il le remarque. Il te propose de le préparer tout seul juste avant ; en
//    mode autonome ou Breaker, il le met en place directement et te prévient.
// 2. Confiance : une action « importante » que tu acceptes 3 fois de suite sans jamais la refuser,
//    il la fait ensuite seul (et te le dit). Un seul « non » la remet sous ton contrôle.
//    Jamais pour le grave, jamais après lecture d'un contenu non fiable.
// Tout est pur ou passe par le clé-valeur de Muninn : testable, et rien ne quitte la machine.

import { EventEmitter } from 'node:events';

/** « learned » (kv, confiance) : Odin vient d'apprendre à faire seul une action. */
export const habitEvents = new EventEmitter();

export interface Kv { getKv(k: string): string | undefined | null; setKv(k: string, v: string): void }
const read = <T>(kv: Kv, k: string, d: T): T => { try { const v = kv.getKv(k); return v ? JSON.parse(v) as T : d; } catch { return d; } };
const write = (kv: Kv, k: string, v: unknown) => kv.setKv(k, JSON.stringify(v));

// ------------------------------------------------------------------ journal des demandes

export interface Ask { t: number; text: string; tools: string[] }
export const ASK_KEY = 'habit-asks';
/** Outils qui ne disent rien de la demande elle-même. */
const NOISE_TOOLS = /^(memory_|skill_read|session_search|schedule_list|reminder_list|self_info)/;

/** Retient une demande du propriétaire (60 jours au plus, 600 entrées). */
export function recordAsk(kv: Kv, text: string, tools: string[], now = Date.now()): void {
  const t = text.trim();
  if (t.length < 12 || /^\/|^(oui|non|ok|merci|stop)\b/i.test(t) || /rappelle[- ]moi|mot de passe/i.test(t)) return;
  const l = read<Ask[]>(kv, ASK_KEY, []).filter((a) => now - a.t < 60 * 86_400_000);
  l.push({ t: now, text: t.slice(0, 240), tools: [...new Set(tools.filter((x) => !NOISE_TOOLS.test(x)))].slice(0, 8) });
  write(kv, ASK_KEY, l.slice(-600));
}

const STOP = new Set('les des une un le la de du et ou en au aux pour par sur avec dans ce cette ces mes mon ma tes ton ta est sont fais fait faire peux peut tu moi me te il elle on nous vous qui que quoi comment quel quelle quels quelles est-ce stp svp merci aujourd hui maintenant encore bien tout tous toute aussi donne dis dit montre regarde veux voudrais bonjour salut odin'.split(' '));
/** Mots qui portent le sens d'une demande (pur). */
export function keywords(text: string): string[] {
  return [...new Set(text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)).map((w) => w.slice(0, 7)))];
}
const jaccard = (a: string[], b: string[]) => { const B = new Set(b); const i = a.filter((x) => B.has(x)).length; return i / (new Set([...a, ...b]).size || 1); };

export interface Habit {
  /** Identifiant stable (mots-clés triés). */
  key: string;
  /** La demande telle que tu la fais (la plus récente). */
  sample: string;
  /** Heure habituelle, en minutes depuis minuit. */
  minute: number;
  /** Jour de la semaine (0 = dimanche) pour une habitude hebdomadaire ; absent = chaque jour. */
  dow?: number;
  /** Nombre de jours différents où tu l'as demandé. */
  days: number;
}

/**
 * Habitudes repérées dans le journal (pur) : la même demande, au moins 3 jours différents sur les
 * 3 dernières semaines, à 2 h près ; ou le même jour de la semaine 3 semaines de suite.
 */
export function detectHabits(asks: Ask[], now = Date.now()): Habit[] {
  const recent = asks.filter((a) => now - a.t < 28 * 86_400_000);
  const groups: Array<{ kw: string[]; tools: string; items: Ask[] }> = [];
  for (const a of recent) {
    const kw = keywords(a.text), tools = a.tools.slice().sort().join(',');
    if (kw.length < 1) continue;
    const g = groups.find((x) => jaccard(x.kw, kw) >= 0.5 || (tools && x.tools === tools && jaccard(x.kw, kw) >= 0.25));
    if (g) { g.items.push(a); for (const w of kw) if (!g.kw.includes(w)) g.kw.push(w); } else groups.push({ kw, tools, items: [a] });
  }
  const out: Habit[] = [];
  for (const g of groups) {
    // Une demande par jour (la première de la journée)
    const byDay = new Map<string, Ask>();
    for (const a of g.items) { const d = new Date(a.t), k = d.toDateString(); if (!byDay.has(k) || byDay.get(k)!.t > a.t) byDay.set(k, a); }
    const firsts = [...byDay.values()];
    if (firsts.length < 3) continue;
    const mins = (l: Ask[]) => l.map((a) => { const d = new Date(a.t); return d.getHours() * 60 + d.getMinutes(); }).sort((x, y) => x - y);
    const median = (l: number[]) => l[Math.floor(l.length / 2)];
    // Les mots présents dans au moins la moitié des demandes : le cœur de l'habitude
    const core = g.kw.filter((w) => g.items.filter((a) => keywords(a.text).includes(w)).length * 2 >= g.items.length).sort();
    const key = (core.length ? core : g.kw.slice(0, 4).sort()).join(' ');
    const sample = g.items.slice().sort((a, b) => b.t - a.t)[0].text;
    // Chaque jour, à heure fixe
    const m = mins(firsts), mid = median(m), close = m.filter((x) => Math.abs(x - mid) <= 120);
    const recentDays = firsts.filter((a) => now - a.t < 21 * 86_400_000).length;
    // « chaque jour » : des jours rapprochés (un écart moyen de 3 jours au plus), sinon c'est peut-être hebdomadaire
    const dayNums = firsts.map((a) => Math.floor((now - a.t) / 86_400_000)).sort((x, y) => x - y);
    const avgGap = (dayNums.at(-1)! - dayNums[0]) / Math.max(1, dayNums.length - 1);
    if (close.length >= 3 && recentDays >= 3 && close.length / m.length >= 0.6 && avgGap <= 3) { out.push({ key, sample, minute: median(close), days: close.length }); continue; }
    // Le même jour de la semaine
    for (let dow = 0; dow < 7; dow++) {
      const same = firsts.filter((a) => new Date(a.t).getDay() === dow);
      const weeks = new Set(same.map((a) => Math.floor((now - a.t) / (7 * 86_400_000))));
      const sm = mins(same), smid = sm.length ? median(sm) : 0;
      if (weeks.size >= 3 && sm.filter((x) => Math.abs(x - smid) <= 120).length >= 3) { out.push({ key, sample, minute: smid, dow, days: same.length }); break; }
    }
  }
  return out;
}

/** Tâche planifiée qui anticipe l'habitude : 10 minutes avant l'heure habituelle (pur). */
export function habitCron(h: Habit): string {
  const m = (h.minute - 10 + 1440) % 1440;
  return `${m % 60} ${Math.floor(m / 60)} * * ${h.dow ?? '*'}`;
}
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const hhmm = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
export const habitWhen = (h: Habit) => `${h.dow != null ? `le ${DAYS[h.dow]}` : 'chaque jour'} vers ${hhmm(h.minute)}`;
export const habitPrompt = (h: Habit) => `[habitude] Le propriétaire te demande souvent ceci ${habitWhen(h)} : « ${h.sample} ». Fais-le maintenant, comme il le voudrait, et envoie-lui directement le résultat (court, sans lui reposer la question).`;

// ------------------------------------------------------------------ habitudes connues

export interface Known { key: string; state: 'proposed' | 'active' | 'refused'; at: number; jobId?: string; habit: Habit }
export const KNOWN_KEY = 'habits-known';
export const knownHabits = (kv: Kv) => read<Known[]>(kv, KNOWN_KEY, []);
export function setKnown(kv: Kv, k: Known): void { write(kv, KNOWN_KEY, [...knownHabits(kv).filter((x) => x.key !== k.key), k].slice(-100)); }
export function forgetHabit(kv: Kv, key: string): Known | undefined { const l = knownHabits(kv), hit = l.find((x) => x.key === key); if (hit) write(kv, KNOWN_KEY, l.filter((x) => x !== hit)); return hit; }
/** Habitudes nouvelles, ni déjà proposées, ni actives, ni refusées (une habitude refusée ne revient jamais). */
export function newHabits(kv: Kv, now = Date.now()): Habit[] {
  const known = knownHabits(kv);
  return detectHabits(read<Ask[]>(kv, ASK_KEY, []), now).filter((h) => !known.some((k) => k.key === h.key || jaccard(k.key.split(' '), h.key.split(' ')) >= 0.5));
}
/** La dernière proposition encore en attente de réponse (24 h). */
export function pendingProposal(kv: Kv, now = Date.now()): Known | undefined {
  return knownHabits(kv).filter((k) => k.state === 'proposed' && now - k.at < 86_400_000).sort((a, b) => b.at - a.at)[0];
}

// ------------------------------------------------------------------ confiance apprise

export interface Trust { key: string; tool: string; example: string; yes: number; no: number; streak: number; last: number; learned?: number }
export const TRUST_KEY = 'habit-trust';
/** Nombre d'accords de suite pour qu'Odin le fasse seul. */
export const TRUST_AFTER = 2;
export const trusts = (kv: Kv) => read<Trust[]>(kv, TRUST_KEY, []);

/** Ta réponse à une demande de validation. Renvoie la confiance si elle vient d'être acquise. */
export function recordAnswer(kv: Kv, key: string, tool: string, example: string, yes: boolean, now = Date.now()): Trust | undefined {
  const l = trusts(kv);
  let t = l.find((x) => x.key === key);
  if (!t) { t = { key, tool, example: example.slice(0, 160), yes: 0, no: 0, streak: 0, last: now }; l.push(t); }
  t.last = now; t.example = example.slice(0, 160);
  let gained: Trust | undefined;
  if (yes) { t.yes++; t.streak++; if (t.streak >= TRUST_AFTER && !t.learned && t.no === 0) { t.learned = now; gained = t; } }
  else { t.no++; t.streak = 0; t.learned = undefined; }
  write(kv, TRUST_KEY, l.slice(-200));
  if (gained) habitEvents.emit('learned', kv, gained);
  return gained;
}
/** Odin peut-il le faire seul ? (appris, jamais refusé, utilisé depuis moins de 90 jours) */
export function trusted(kv: Kv, key: string, now = Date.now()): Trust | undefined {
  const t = trusts(kv).find((x) => x.key === key);
  return t && t.learned && t.no === 0 && now - t.last < 90 * 86_400_000 ? t : undefined;
}
/** « Redemande-moi » : la confiance retombe (la dernière apprise si aucune clé). */
export function revokeTrust(kv: Kv, key?: string): Trust | undefined {
  const l = trusts(kv);
  const t = key ? l.find((x) => x.key === key || x.tool === key) : l.filter((x) => x.learned).sort((a, b) => (b.learned ?? 0) - (a.learned ?? 0))[0];
  if (!t) return undefined;
  t.learned = undefined; t.streak = 0; t.no++;
  write(kv, TRUST_KEY, l);
  return t;
}
export function touchTrust(kv: Kv, key: string, now = Date.now()): void { const l = trusts(kv), t = l.find((x) => x.key === key); if (t) { t.last = now; t.yes++; write(kv, TRUST_KEY, l); } }
