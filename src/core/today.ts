// « Aujourd'hui » : ce qu'Odin devine que tu veux en ouvrant l'application, et le fil de ce qu'il a fait.
// Tout est calculé sans modèle (instantané, gratuit) à partir de tes habitudes, de tes conversations en
// suspens, de tes rappels, de l'état de la maison et de l'heure.

import { NAMES } from '../valhalla/names.ts';
import { existsSync, readFileSync } from 'node:fs';
import { detectHabits, keywords, type Ask } from '../learn/habits.ts';
import type { Thread } from '../muninn/threads.ts';
import type { UndoEntry } from '../undo.ts';

export interface Guess {
  /** Identifiant stable (pour ne pas reproposer ce qui a été écarté). */
  id: string;
  /** Ce qu'on lit sur le bouton. */
  label: string;
  /** Pourquoi Odin le propose (une demi-phrase). */
  why: string;
  /** Message envoyé à Odin si on touche le bouton… */
  prompt?: string;
  /** …ou écran à ouvrir. */
  view?: string;
  score: number;
}

export interface GuessInput {
  now: Date;
  asks: Ask[];
  threads: Thread[];
  reminders: Array<{ at: number; text: string }>;
  findings: Array<{ level: string; title: string; device?: string }>;
  newUnknown: number;
  nextEvent?: { start: number; title: string };
  /** Propositions écartées récemment (id → date). */
  dismissed?: Record<string, number>;
}

const hm = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const short = (t: string, n = 48) => { const x = t.replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

/** Ce que tu veux probablement faire maintenant (pur), du plus probable au moins probable. */
export function guessIntents(g: GuessInput, max = 4): Guess[] {
  const now = g.now.getTime(), minute = g.now.getHours() * 60 + g.now.getMinutes(), h = g.now.getHours(), out: Guess[] = [];
  // 1. Ce qui presse : problème grave, rappel imminent.
  const grave = g.findings.filter((f) => f.level === 'grave');
  if (grave.length) out.push({ id: `alerte:${grave[0].title}`, label: `Régler : ${short(grave[0].title, 40)}`, why: grave[0].device ? `sur ${grave[0].device}` : 'problème de sécurité', view: 'net', score: 100 });
  for (const r of g.reminders.filter((x) => x.at - now < 3 * 3600_000 && x.at > now - 600_000).slice(0, 1)) out.push({ id: `rappel:${r.text}`, label: short(r.text), why: `rappel à ${hm(r.at)}`, prompt: `Aide-moi pour ce rappel : ${r.text}`, score: 90 });
  if (g.nextEvent && g.nextEvent.start - now < 2 * 3600_000 && g.nextEvent.start > now) out.push({ id: `agenda:${g.nextEvent.title}`, label: `Préparer « ${short(g.nextEvent.title, 34)} »`, why: `à ${hm(g.nextEvent.start)}`, prompt: `Prépare-moi pour « ${g.nextEvent.title} » (${hm(g.nextEvent.start)}) : ce qu'il faut savoir, emporter, le trajet.`, score: 85 });
  // 2. Tes habitudes à cette heure-ci (même demande plusieurs jours, à 1 h 30 près).
  for (const hb of detectHabits(g.asks, now)) {
    const near = Math.min(Math.abs(hb.minute - minute), 1440 - Math.abs(hb.minute - minute)) <= 90;
    if (near && (hb.dow == null || hb.dow === g.now.getDay())) out.push({ id: `habitude:${hb.key}`, label: short(hb.sample), why: `tu le demandes souvent vers ${Math.floor(hb.minute / 60)} h`, prompt: hb.sample, score: 70 + Math.min(hb.days, 10) });
  }
  // Demandes faites au moins deux jours différents à cette heure-ci (moins sûr qu'une habitude).
  const groups = new Map<string, { sample: string; days: Set<string>; last: number }>();
  for (const a of g.asks.filter((x) => now - x.t < 21 * 86_400_000)) {
    const d = new Date(a.t), m = d.getHours() * 60 + d.getMinutes();
    if (Math.min(Math.abs(m - minute), 1440 - Math.abs(m - minute)) > 60 || d.toDateString() === g.now.toDateString()) continue;
    const k = keywords(a.text).sort().slice(0, 3).join(' ');
    if (!k) continue;
    const x = groups.get(k) ?? { sample: a.text, days: new Set<string>(), last: 0 };
    x.days.add(d.toDateString()); if (a.t > x.last) { x.last = a.t; x.sample = a.text; }
    groups.set(k, x);
  }
  for (const [k, x] of groups) if (x.days.size >= 2) out.push({ id: `heure:${k}`, label: short(x.sample), why: 'souvent demandé à cette heure', prompt: x.sample, score: 55 + x.days.size });
  // 3. Ce qui est resté en suspens dans une conversation récente.
  for (const t of g.threads.filter((x) => !x.archived && !x.tainted && x.open.length && now - x.updated < 3 * 86_400_000).sort((a, b) => b.updated - a.updated).slice(0, 2)) {
    out.push({ id: `fil:${t.sessionId}`, label: `Reprendre : ${short(t.title || t.goal, 36)}`, why: `reste : ${short(t.open[0], 40)}`, prompt: `On reprend « ${t.title || t.goal} » : où en est-on, et la suite (${t.open[0]}) ?`, score: 60 - (now - t.updated) / 86_400_000 * 5 });
  }
  // 4. La maison et le moment de la journée.
  if (g.newUnknown) out.push({ id: 'reseau:inconnus', label: `${g.newUnknown} appareil${g.newUnknown > 1 ? 's' : ''} inconnu${g.newUnknown > 1 ? 's' : ''} sur le réseau`, why: 'apparu récemment', view: 'net', score: 65 });
  if (h >= 5 && h < 10) out.push({ id: `matin:${g.now.toDateString()}`, label: 'Mon point du matin', why: 'météo, agenda, rappels, maison', prompt: 'Fais-moi mon point du matin.', score: 40 });
  else if (h >= 18 && h < 23) out.push({ id: `soir:${g.now.toDateString()}`, label: 'Le bilan de la journée', why: 'ce qui a été fait, ce qui reste', prompt: 'Fais-moi le bilan de la journée : ce que tu as fait, ce qui reste, demain.', score: 40 });
  else out.push({ id: 'maison:etat', label: 'Tout va bien à la maison ?', why: 'réseau, machines, alertes', prompt: 'Tout va bien à la maison ? Réponds court.', score: 30 });
  // Sans doublon, sans ce qui a été écarté depuis moins de 12 h.
  const seen = new Set<string>(), d = g.dismissed ?? {};
  return out.filter((x) => !(d[x.id] && now - d[x.id] < 12 * 3600_000)).sort((a, b) => b.score - a.score)
    .filter((x) => { const k = (x.prompt ?? x.view ?? x.label).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, max);
}

export interface FeedItem { at: number; text: string; who: 'seul' | 'toi' | 'refusé'; risk: string; undoId?: string; undone?: boolean; why?: string }

/** Des mots pour les outils les plus courants (le reste : le nom de l'outil, mis en mots). */
const TOOL_WORDS: Record<string, string> = {
  calendar_list: 'Lire l\'agenda', calendar_add: 'Ajouter un rendez-vous', net_identify: 'Identifier l\'appareil', net_scan: 'Balayer le réseau', mail_send: 'Envoyer un e-mail', mail_list: 'Lire les e-mails',
  web_fetch: 'Lire la page', web_search: 'Chercher sur le web', shell: 'Lancer une commande', file_write: 'Écrire le fichier', file_read: 'Lire le fichier', file_delete: 'Supprimer le fichier', memory_save: 'Retenir', remind: 'Créer un rappel',
};
const ARG_WORDS: Record<string, string> = { days: 'jours', ip: '', url: '', path: '', query: '', q: '', to: 'à', subject: 'objet', name: '', host: '' };
/** Une ligne lisible à la place du nom technique (« calendar_list {"days":1} » → « Lire l'agenda (1 jour) »). Pur. */
export function humanize(summary: string, appName: (id: string) => string = (x) => x, actionLabel: (mod: string, act: string) => string | undefined = () => undefined): string {
  const s = summary.replace(/\s+/g, ' ').trim();
  let m = /^applis action ([\w-]+) ([\w-]+)(.*)$/.exec(s);
  if (m) return `${appName(m[1])} : ${actionLabel(m[1], m[2]) ?? m[2].replace(/_/g, ' ')}${m[3] ? ` ${m[3].trim()}` : ''}`.trim();
  m = /^(GET|POST|PUT|DELETE|HEAD) (\S+)$/.exec(s);
  if (m) return `${m[1] === 'GET' || m[1] === 'HEAD' ? 'Ouvrir' : 'Envoyer à'} ${m[2]}`;
  m = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\s*(\{.*\})?$/.exec(s);
  if (m) {
    const name = TOOL_WORDS[m[1]] ?? (m[1].charAt(0).toUpperCase() + m[1].slice(1).replace(/_/g, ' '));
    let args = '';
    try {
      const o = m[2] ? JSON.parse(m[2]) as Record<string, unknown> : {};
      args = Object.entries(o).filter(([, v]) => v !== '' && v !== null && typeof v !== 'object').slice(0, 3).map(([k, v]) => {
        const w = ARG_WORDS[k]; if (k === 'days' && typeof v === 'number') return `${v} jour${v > 1 ? 's' : ''}`;
        return w === undefined ? `${k.replace(/_/g, ' ')} : ${String(v).slice(0, 40)}` : `${w ? `${w} ` : ''}${String(v).slice(0, 60)}`;
      }).join(', ');
    } catch { args = m[2].slice(0, 60); }
    return args ? `${name} (${args})` : name;
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fil d'activité (48 h) : ce qu'Odin a fait ou refusé, avec de quoi annuler les fichiers et réglages modifiés. */
export function activityFeed(auditFile: string, undos: UndoEntry[], now = Date.now(), max = 30, appName: (id: string) => string = (x) => NAMES[x] ?? x, actionLabel?: (mod: string, act: string) => string | undefined): FeedItem[] {
  if (!existsSync(auditFile)) return [];
  const rows = readFileSync(auditFile, 'utf8').trim().split('\n').slice(-3000).map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
    .filter((r): r is Record<string, unknown> => Boolean(r) && r!.risk !== 'read' && now - Date.parse(String(r!.t)) < 48 * 3600_000);
  const used = new Set<string>();
  return rows.sort((a, b) => Date.parse(String(b.t)) - Date.parse(String(a.t))).slice(0, max).map((r) => {
    const at = Date.parse(String(r.t));
    const u = undos.find((x) => !used.has(x.id) && x.tool === r.tool && Math.abs(x.at - at) < 120_000);
    if (u) used.add(u.id);
    const who: FeedItem['who'] = r.allowed === false ? 'refusé' : /human|grant/.test(String(r.via ?? '')) ? 'toi' : 'seul';
    return { at, text: humanize(String(r.summary ?? r.tool ?? ''), appName, actionLabel).slice(0, 160), who, risk: String(r.risk ?? ''), undoId: u?.id, undone: u?.undone, ...(who === 'refusé' && r.reason ? { why: String(r.reason).replace(/\s+/g, ' ').slice(0, 140) } : {}) };
  });
}
