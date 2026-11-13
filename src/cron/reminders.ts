// Rappels intelligents : dates en français courant (« vendredi 9h », « dans 2 heures », « demain soir »),
// rappels récurrents (« tous les mois le 5 »), relances tant que ce n'est pas fait, « plus tard ».
// Tout est pur (testable) sauf les petites fonctions de stockage, qui passent par le clé-valeur de Mnémosyne.

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const NUM: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50 };

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const nb = (x: string) => (/^\d+$/.test(x) ? Number(x) : NUM[x] ?? NaN);
const dayIdx = (w: string) => DAYS.findIndex((d) => norm(d) === w.replace(/s$/, ''));
const monthIdx = (w: string) => MONTHS.findIndex((m) => norm(m) === w || norm(m).slice(0, 4) === w.slice(0, 4));

/** Heure dite dans le texte : « 18h », « 18h30 », « 18:30 », « à 9 heures », « midi », « minuit », « 7h du soir ». */
export function parseTime(t: string): { h: number; m: number } | undefined {
  const s = norm(t);
  if (/\bmidi\b/.test(s) && !/apres[- ]midi/.test(s)) return { h: 12, m: 0 };
  if (/\bminuit\b/.test(s)) return { h: 0, m: 0 };
  const x = /\b(\d{1,2})\s*(?:h|heures?|:)\s*(\d{2})?\b/.exec(s) ?? /\ba (\d{1,2})\b(?!\s*(?:min|jour|semaine|mois|\/))/.exec(s);
  if (!x) return undefined;
  let h = Number(x[1]); const m = Number(x[2] ?? 0);
  if (h < 12 && /\b(du soir|de l'apres[- ]midi|pm)\b/.test(s)) h += 12;
  if (h > 23 || m > 59) return undefined;
  return { h, m };
}

/** Moment de la journée sans heure précise. */
function partOfDay(s: string): { h: number; m: number } | undefined {
  if (/\bce matin|\bmatin\b/.test(s)) return { h: 9, m: 0 };
  if (/apres[- ]midi/.test(s)) return { h: 15, m: 0 };
  if (/\bce soir|\bsoir\b/.test(s)) return { h: 19, m: 0 };
  if (/\bcette nuit\b/.test(s)) return { h: 22, m: 0 };
  return undefined;
}

/**
 * Date et heure d'un rappel à partir du français courant. Renvoie undefined si rien n'est compris.
 * Exemples : « 2026-11-05 18:30 », « 05/11 à 9h », « demain », « vendredi 14h », « dans 20 min »,
 * « dans 1h30 », « ce soir », « le 5 décembre », « lundi prochain à 8h ».
 */
export function parseWhen(text: string, now = new Date()): Date | undefined {
  const s = norm(text);
  // Format technique
  const iso = /(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2}))?/.exec(s);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] ?? 9), Number(iso[5] ?? 0));
  // Durée relative : dans 20 min, dans 2 heures, dans une demi-heure, dans 1h30, dans 3 jours
  if (/\bdans une demi[- ]heure\b/.test(s)) return new Date(now.getTime() + 30 * 60_000);
  const hm = /\bdans (\d{1,2})\s*h\s*(\d{1,2})\b/.exec(s);
  if (hm) return new Date(now.getTime() + (Number(hm[1]) * 60 + Number(hm[2])) * 60_000);
  const rel = /\bdans (\d+|\w+) ?(min(?:ute)?s?|mn|h|heures?|jours?|semaines?|mois)\b/.exec(s);
  if (rel) {
    const n = nb(rel[1]); if (!Number.isFinite(n)) return undefined;
    const u = rel[2];
    if (/^(min|mn)/.test(u)) return new Date(now.getTime() + n * 60_000);
    if (/^h/.test(u)) return new Date(now.getTime() + n * 3600_000);
    const d = new Date(now);
    if (/^jour/.test(u)) d.setDate(d.getDate() + n); else if (/^semaine/.test(u)) d.setDate(d.getDate() + 7 * n); else d.setMonth(d.getMonth() + n);
    const t = parseTime(s) ?? partOfDay(s); if (t) d.setHours(t.h, t.m, 0, 0);
    return d;
  }
  const time = parseTime(s) ?? partOfDay(s);
  const at = (d: Date, dflt = { h: 9, m: 0 }) => { const t = time ?? dflt; d.setHours(t.h, t.m, 0, 0); return d; };
  const base = new Date(now);
  // Jour/mois(/année) : 05/11, 5/11/2026
  const dm = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s);
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : now.getFullYear();
    const d = at(new Date(y, Number(dm[2]) - 1, Number(dm[1])));
    if (!dm[3] && d.getTime() < now.getTime() - 60_000) d.setFullYear(y + 1);
    return d;
  }
  // « le 5 décembre », « le 5 », « 5 décembre »
  const dmo = /\b(?:le )?(\d{1,2}|1er) (janv\w*|fevr\w*|mars|avr\w*|mai|juin|juil\w*|aout|sept\w*|oct\w*|nov\w*|dec\w*)(?: (\d{4}))?\b/.exec(s);
  if (dmo) {
    const mo = monthIdx(dmo[2]); if (mo < 0) return undefined;
    const d = at(new Date(dmo[3] ? Number(dmo[3]) : now.getFullYear(), mo, parseInt(dmo[1], 10)));
    if (!dmo[3] && d.getTime() < now.getTime() - 60_000) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  const dom = /\ble (\d{1,2}|1er)\b(?! ?(?:h|:|heures?))/.exec(s);
  if (dom) {
    const d = at(new Date(now.getFullYear(), now.getMonth(), parseInt(dom[1], 10)));
    if (d.getTime() < now.getTime() - 60_000) d.setMonth(d.getMonth() + 1);
    return d;
  }
  if (/\bapres[- ]demain\b/.test(s)) { base.setDate(base.getDate() + 2); return at(base); }
  if (/\bdemain\b/.test(s)) { base.setDate(base.getDate() + 1); return at(base); }
  const wd = /\b(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\b/.exec(s);
  if (wd) {
    const target = dayIdx(wd[1]);
    let add = (target - now.getDay() + 7) % 7;
    const d = at(new Date(now));
    if (add === 0 && (d.getTime() <= now.getTime() || /prochain/.test(s))) add = 7;
    d.setDate(d.getDate() + add);
    return d;
  }
  if (/\bsemaine prochaine\b/.test(s)) { base.setDate(base.getDate() + ((8 - base.getDay()) % 7 || 7)); return at(base); }
  if (time) {
    // Une heure seule (« à 18h », « ce soir ») : aujourd'hui, ou demain si c'est déjà passé.
    const d = at(base);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }
  return undefined;
}

/**
 * Répétition en français → expression cron (minute heure jour mois jour-semaine).
 * « tous les jours à 8h », « chaque lundi 9h », « en semaine à 7h30 », « tous les mois le 5 »,
 * « tous les ans le 3 mars », « toutes les 2 heures », ou une expression cron déjà écrite.
 */
export function parseRepeat(text: string, now = new Date()): string | undefined {
  const raw = text.trim();
  if (/^[\d*/,-]+( [\d*/,-]+){4}$/.test(raw)) return raw;
  const s = norm(raw);
  if (!s) return undefined;
  const t = parseTime(s) ?? partOfDay(s) ?? { h: 9, m: 0 };
  const hm = `${t.m} ${t.h}`;
  const every = /toutes les (\d+|\w+) ?(heures?|h|minutes?|min)\b/.exec(s);
  if (every) { const n = nb(every[1]); if (!Number.isFinite(n) || n < 1) return undefined; return /^h/.test(every[2]) ? `0 */${n} * * *` : `*/${Math.max(5, n)} * * * *`; }
  if (/toutes les heures|chaque heure/.test(s)) return '0 * * * *';
  if (/en semaine|du lundi au vendredi|jours ouvres/.test(s)) return `${hm} * * 1-5`;
  if (/(le |chaque |tous les )?week[- ]?ends?/.test(s) && /(chaque|tous les)/.test(s)) return `${hm} * * 0,6`;
  const days = [...s.matchAll(/\b(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)s?\b/g)].map((x) => dayIdx(x[1]));
  if (days.length && /(chaque|tous les|toutes les|le |les )/.test(s)) return `${hm} * * ${[...new Set(days)].sort().join(',')}`;
  if (/(tous les|chaque) (jours?|soirs?|matins?)|quotidien/.test(s)) return `${hm} * * *`;
  if (/(toutes les|chaque) semaines?|hebdo/.test(s)) return `${hm} * * ${now.getDay()}`;
  const yr = /(tous les ans|chaque annee|annuel).*?\b(\d{1,2}|1er) (janv\w*|fevr\w*|mars|avr\w*|mai|juin|juil\w*|aout|sept\w*|oct\w*|nov\w*|dec\w*)/.exec(s) ?? /\b(\d{1,2}|1er) (janv\w*|fevr\w*|mars|avr\w*|mai|juin|juil\w*|aout|sept\w*|oct\w*|nov\w*|dec\w*).*(tous les ans|chaque annee)/.exec(s);
  if (yr) { const dd = /(tous|chaque|annuel)/.test(yr[1]) ? yr[2] : yr[1], mm = /(tous|chaque|annuel)/.test(yr[1]) ? yr[3] : yr[2]; return `${hm} ${parseInt(dd, 10)} ${monthIdx(mm) + 1} *`; }
  if (/(tous les|chaque) mois|mensuel|de chaque mois|par mois/.test(s)) {
    const d = /\ble (\d{1,2}|1er)\b(?! ?(?:h|:))/.exec(s);
    return `${hm} ${d ? parseInt(d[1], 10) : now.getDate()} * *`;
  }
  if (/(tous les|chaque) ans?|annuel/.test(s)) return `${hm} ${now.getDate()} ${now.getMonth() + 1} *`;
  return undefined;
}

// ------------------------------------------------------------------ relances

/** Un rappel envoyé qui attend « c'est fait » : il revient tant qu'on ne l'a pas réglé. */
export interface Nag { id: string; text: string; channel: string; peer: string; n: number; next: number; at: number }
export interface Kv { getKv(k: string): string | undefined | null; setKv(k: string, v: string): void }

export const NAG_KEY = 'reminder-nags';
/** Relances : 30 min, puis 1 h, puis 2 h ; 3 relances au plus, puis il laisse tomber (sans bruit). */
export const NAG_STEPS_MIN = [30, 60, 120];

export function nags(kv: Kv): Nag[] { try { return JSON.parse(kv.getKv(NAG_KEY) ?? '[]') as Nag[]; } catch { return []; } }
function saveNags(kv: Kv, l: Nag[]): void { kv.setKv(NAG_KEY, JSON.stringify(l.slice(-50))); }

/** Le rappel vient d'être envoyé : on prépare sa relance. */
export function armNag(kv: Kv, r: Omit<Nag, 'n' | 'next' | 'at'>, now = Date.now()): void {
  const l = nags(kv).filter((x) => x.id !== r.id);
  l.push({ ...r, n: 0, at: now, next: now + NAG_STEPS_MIN[0] * 60_000 });
  saveNags(kv, l);
}
/** Relances dues maintenant (et mise à jour de la suivante ; au-delà de la dernière, le rappel est oublié). */
export function dueNags(kv: Kv, now = Date.now()): Nag[] {
  const l = nags(kv), due: Nag[] = [], keep: Nag[] = [];
  for (const x of l) {
    if (x.next > now) { keep.push(x); continue; }
    const n = x.n + 1;
    due.push({ ...x, n });
    if (n < NAG_STEPS_MIN.length) keep.push({ ...x, n, next: now + NAG_STEPS_MIN[n] * 60_000 });
  }
  if (due.length) saveNags(kv, keep);
  return due;
}
/** « C'est fait » ou « plus tard » : plus de relance pour ce rappel (le dernier envoyé à ce destinataire si id absent). */
export function clearNag(kv: Kv, id?: string, peer?: string): Nag | undefined {
  const l = nags(kv);
  const hit = id ? l.find((x) => x.id === id) : l.filter((x) => !peer || x.peer === peer).sort((a, b) => b.at - a.at)[0];
  if (hit) saveNags(kv, l.filter((x) => x !== hit));
  return hit;
}

/** Réponse en texte à un rappel : « fait », « c'est bon », « payé »… ou « plus tard », « dans 20 min », « demain ». */
export function reminderReply(text: string, now = new Date()): { done: true } | { snooze: Date } | undefined {
  const s = norm(text).replace(/[.!]+$/, '');
  if (s.length > 60) return undefined;
  if (/^(c'?est )?(fait|regle|paye|termine|fini|bon|ok c'?est fait)\b|^(c'?est )?bon\b|^done\b|^j'?(ai|l'ai) (fait|paye|regle)/.test(s)) return { done: true };
  if (/^(plus tard|rappelle[- ]moi( plus tard| dans .+| demain.*| ce soir.*| a .+)?|pas maintenant|apres)$/.test(s) || /^(dans .+|demain.*|ce soir.*)$/.test(s)) {
    const when = parseWhen(s, now);
    return { snooze: when && when.getTime() > now.getTime() ? when : new Date(now.getTime() + 3600_000) };
  }
  return undefined;
}

/** Préfixe des rappels récurrents (tâche planifiée qui envoie un rappel au lieu de lancer le modèle). */
export const REMINDER_PREFIX = '[rappel] ';
export const isReminderJob = (j: { cron: string; prompt: string }) => j.cron === '@reminder' || j.prompt.startsWith(REMINDER_PREFIX);
export const reminderText = (j: { prompt: string }) => j.prompt.startsWith(REMINDER_PREFIX) ? j.prompt.slice(REMINDER_PREFIX.length) : j.prompt;

/** Pour l'affichage : « vendredi 7 novembre à 18:30 ». */
export const whenFr = (d: Date) => d.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(/ (\d{2}:\d{2})$/, ' à $1').replace(/ à à /, ' à ');
