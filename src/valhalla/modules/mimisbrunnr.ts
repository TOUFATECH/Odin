// Chroniques — les journaux réunis (comme OpenSearch / Graylog, en petit) : le journal du système (journald),
// les fichiers de /var/log (système, connexions, serveur web…), et le fil des alertes d'Odin, lus au même
// endroit. Recherche par mot, gravité, source et période ; les messages qui se répètent sont regroupés ;
// des règles « si ce message revient N fois en M minutes, préviens-moi ». Lecture seule : rien n'est effacé.
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import type { Kpi, ModCtx, Module, Tone } from '../types.ts';

export type Niveau = 'erreur' | 'attention' | 'info' | 'debug';
export interface Ligne { t: number; source: string; niveau: Niveau; texte: string; hote?: string; prog?: string }
export interface Regle { id: string; motif: string; fois: number; minutes: number; niveau: 'moyenne' | 'haute' }
const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));

/** La gravité d'un message : priorité syslog si on l'a, sinon les mots du message. Pur. */
export function niveauDe(texte: string, prio?: number): Niveau {
  if (prio !== undefined && Number.isFinite(prio)) return prio <= 3 ? 'erreur' : prio === 4 ? 'attention' : prio === 7 ? 'debug' : 'info';
  if (/\b(error|erreur|fail(ed|ure)?|échec|critical|fatal|panic|denied|refused|segfault)\b/i.test(texte)) return 'erreur';
  if (/\b(warn(ing)?|attention|deprecated|timeout|retry)\b/i.test(texte)) return 'attention';
  if (/\bdebug\b/i.test(texte)) return 'debug';
  return 'info';
}
/** Une ligne du journal du système (journalctl -o json). Pur. */
export function lireJournald(l: string): Ligne | undefined {
  try {
    const o = JSON.parse(l) as Record<string, unknown>, msg = Array.isArray(o.MESSAGE) ? Buffer.from(o.MESSAGE as number[]).toString('utf8') : s(o.MESSAGE);
    if (!msg) return undefined;
    return { t: Math.round(Number(o.__REALTIME_TIMESTAMP) / 1000) || 0, source: 'système', niveau: niveauDe(msg, o.PRIORITY === undefined ? undefined : Number(o.PRIORITY)), texte: msg.slice(0, 1000), hote: s(o._HOSTNAME) || undefined, prog: s(o.SYSLOG_IDENTIFIER || o._COMM) || undefined };
  } catch { return undefined; }
}
const MOIS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** Une ligne de fichier : syslog classique (« Nov 13 15:04:01 hôte prog[12]: message »), ISO 8601, ou journal web. Pur. */
export function lireLigne(l: string, source: string, now = new Date()): Ligne | undefined {
  if (!l.trim()) return undefined;
  let m = /^([A-Z][a-z]{2})\s+(\d{1,2}) (\d\d):(\d\d):(\d\d) (\S+) ([^:[\s]+)(?:\[\d+\])?:\s?(.*)$/.exec(l);
  if (m && m[1] in MOIS) { let d = new Date(now.getFullYear(), MOIS[m[1]], Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])); if (d.getTime() > now.getTime() + 864e5) d = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()); return { t: d.getTime(), source, niveau: niveauDe(m[8]), texte: m[8].slice(0, 1000), hote: m[6], prog: m[7] }; }
  m = /^(\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?)\s+(?:(\S+)\s+)?(.*)$/.exec(l);
  if (m && !Number.isNaN(Date.parse(m[1].replace(' ', 'T')))) return { t: Date.parse(m[1].replace(' ', 'T')), source, niveau: niveauDe(m[3]), texte: `${m[2] ? `${m[2]} ` : ''}${m[3]}`.slice(0, 1000) };
  m = /\[(\d\d)\/([A-Z][a-z]{2})\/(\d{4}):(\d\d):(\d\d):(\d\d) ([+-]\d{4})\] "([^"]*)" (\d{3})/.exec(l);
  if (m) { const code = Number(m[9]); return { t: Date.parse(`${m[3]}-${String(MOIS[m[2]] + 1).padStart(2, '0')}-${m[1]}T${m[4]}:${m[5]}:${m[6]}${m[7].slice(0, 3)}:${m[7].slice(3)}`), source, niveau: code >= 500 ? 'erreur' : code >= 400 ? 'attention' : 'info', texte: l.slice(0, 1000) }; }
  return { t: 0, source, niveau: niveauDe(l), texte: l.slice(0, 1000) };
}
/** Le « modèle » d'un message (chiffres, adresses, identifiants remplacés) pour regrouper ceux qui se répètent. Pur. */
export function modele(texte: string): string {
  return texte.replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, '<ip>').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>').replace(/\b[0-9a-f]{12,}\b/gi, '<id>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>').replace(/\s+/g, ' ').trim().slice(0, 160);
}
export interface Filtre { q?: string; niveau?: Niveau | ''; source?: string; depuis?: number }
/** Les lignes qui correspondent (mots tous présents, sans tenir compte des majuscules). Pur. */
export function filtrer(l: Ligne[], f: Filtre): Ligne[] {
  const mots = s(f.q).toLowerCase().split(/\s+/).filter(Boolean), ordre: Niveau[] = ['erreur', 'attention', 'info', 'debug'];
  return l.filter((x) => (!f.depuis || x.t >= f.depuis) && (!f.source || x.source === f.source) && (!f.niveau || ordre.indexOf(x.niveau) <= ordre.indexOf(f.niveau))
    && mots.every((m) => `${x.texte} ${x.prog ?? ''} ${x.hote ?? ''}`.toLowerCase().includes(m)));
}
/** Les messages les plus fréquents (par modèle). Pur. */
export function regrouper(l: Ligne[], n = 15): Array<{ modele: string; fois: number; niveau: Niveau; exemple: string; dernier: number }> {
  const g = new Map<string, { modele: string; fois: number; niveau: Niveau; exemple: string; dernier: number }>();
  for (const x of l) { const k = `${x.prog ?? ''} ${modele(x.texte)}`.trim(), o = g.get(k); if (o) { o.fois++; if (x.t > o.dernier) { o.dernier = x.t; o.exemple = x.texte; } } else g.set(k, { modele: k, fois: 1, niveau: x.niveau, exemple: x.texte, dernier: x.t }); }
  return [...g.values()].sort((a, b) => b.fois - a.fois).slice(0, n);
}
/** Le message contient-il le motif ? Texte simple, sans tenir compte des majuscules ; « a|b » = l'un ou l'autre.
 *  (Pas d'expression régulière : un motif mal écrit pourrait figer Odin.) Pur. */
export function contient(texte: string, motif: string): boolean {
  const t = texte.toLowerCase(); return motif.toLowerCase().split('|').map((x) => x.trim()).filter(Boolean).some((x) => t.includes(x));
}
/** Une règle déclenchée ? (le motif revient au moins « fois » fois dans les « minutes » dernières minutes). Pur. */
export function declenche(r: Regle, l: Ligne[], now: number): number {
  const n = l.filter((x) => x.t >= now - r.minutes * 60_000 && x.t <= now + 60_000 && contient(x.texte, r.motif)).length;
  return n >= r.fois ? n : 0;
}

/** Les fichiers lus par défaut (ceux qui existent ; les tiens s'ajoutent dans les réglages). */
const FICHIERS = ['/var/log/syslog', '/var/log/messages', '/var/log/auth.log', '/var/log/secure', '/var/log/kern.log', '/var/log/nginx/error.log', '/var/log/nginx/access.log', '/var/log/apache2/error.log', '/var/log/caddy/access.log'];
/** Les dernières lignes d'un fichier : on ne lit que la fin (un journal de plusieurs Go ne remplit pas la mémoire). */
export function finDeFichier(f: string, octets = 2_000_000): string[] {
  let fd: number | undefined;
  try {
    const st = statSync(f); if (!st.isFile()) return [];
    const n = Math.min(st.size, octets), b = Buffer.alloc(n); fd = openSync(f, 'r'); readSync(fd, b, 0, n, st.size - n);
    return b.toString('utf8').split('\n').slice(st.size > octets ? 1 : 0);
  } catch { return []; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* déjà fermé */ } }
}
async function collecter(ctx: ModCtx, heures = 24): Promise<Ligne[]> {
  const now = ctx.now(), depuis = now.getTime() - heures * 3600_000, out: Ligne[] = [];
  if (process.platform === 'linux' && ctx.settings.journald !== false) {
    const r = await ctx.run('journalctl', ['-o', 'json', '--no-pager', '-n', '8000', `--since=-${heures}h`, '--output-fields=MESSAGE,PRIORITY,SYSLOG_IDENTIFIER,_COMM,_HOSTNAME'], { timeoutMs: 20_000 });
    if (!r.code) for (const l of r.out.split('\n')) { const x = lireJournald(l); if (x) out.push(x); }
  }
  const fichiers = [...FICHIERS, ...((ctx.settings.fichiers as string[] | undefined) ?? [])];
  for (const f of [...new Set(fichiers)]) if (existsSync(f)) { const src = f.split('/').slice(-2).join('/'); for (const l of finDeFichier(f)) { const x = lireLigne(l, src, now); if (x && (!x.t || x.t >= depuis)) out.push(x.t ? x : { ...x, t: statSafe(f) }); } }
  for (const a of ctx.alerts({ limit: 500 })) { const t = Date.parse(a.at); if (t >= depuis) out.push({ t, source: 'Odin', niveau: a.level === 'critique' || a.level === 'haute' ? 'erreur' : a.level === 'moyenne' ? 'attention' : 'info', texte: `${a.title}${a.detail ? ` — ${a.detail}` : ''}`.slice(0, 1000), prog: a.module }); }
  return out.sort((a, b) => b.t - a.t);
}
const statSafe = (f: string) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
const TONE: Record<Niveau, Tone> = { erreur: 'mauvais', attention: 'attention', info: 'neutre', debug: 'neutre' };
const heure = (t: number) => (t ? new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

export const mimisbrunnr: Module = {
  id: 'mimisbrunnr', name: 'Chroniques', family: 'Machines',
  what: 'Les journaux réunis (comme OpenSearch) : le journal du système, les fichiers de /var/log et les alertes d\'Odin, cherchés au même endroit, avec les messages qui se répètent regroupés et des règles qui te préviennent.',
  does: ['journal du système (journald) et fichiers de /var/log (système, connexions, noyau, serveurs web)', 'fil des alertes de toutes les applis d\'Odin', 'recherche par mots, gravité, source et période', 'messages répétés regroupés (les chiffres et adresses ne comptent pas)', 'courbe des erreurs heure par heure', 'règles : « si ce message revient N fois en M minutes, préviens-moi »', 'tes propres fichiers de journal en plus'],
  from: ['OpenSearch', 'Graylog', 'Loki'], upstream: ['opensearch-project/OpenSearch', 'Graylog2/graylog2-server', 'grafana/loki'],
  words: ['journaux du système', 'journaux système', 'logs du système', 'logs système', 'syslog', 'journalctl', 'chroniques', 'erreurs du système', 'mimisbrunnr', 'opensearch', 'graylog'],
  actions: [
    { id: 'chercher', label: 'Chercher dans les journaux', what: 'Mots, gravité minimale, source et période', read: true, external: true, params: [{ key: 'q', label: 'Mots', kind: 'text', default: '' }, { key: 'niveau', label: 'Gravité minimale', kind: 'select', options: ['', 'erreur', 'attention', 'info', 'debug'], default: '' }, { key: 'source', label: 'Source (vide : toutes)', kind: 'text', default: '' }, { key: 'heures', label: 'Dernières heures', kind: 'number', default: 24 }],
      words: ['cherche dans les journaux du système', 'erreurs du système', 'que disent les journaux du système'], run: async (ctx, i) => {
        const h = Math.max(1, Math.min(24 * 30, Number(i.heures) || 24)), l = filtrer(await collecter(ctx, h), { q: s(i.q), niveau: s(i.niveau) as Niveau, source: s(i.source) });
        return { text: l.length ? `${l.length} ligne(s) :\n${l.slice(0, 40).map((x) => `- ${heure(x.t)} [${x.niveau}] ${x.source}${x.prog ? ` · ${x.prog}` : ''} : ${x.texte.slice(0, 200)}`).join('\n')}` : 'Rien trouvé.', data: l.slice(0, 500) };
      } },
    { id: 'repetes', label: 'Messages qui se répètent', what: 'Les messages les plus fréquents sur la période', words: ['messages qui se répètent dans les journaux du système'], read: true, external: true, params: [{ key: 'heures', label: 'Dernières heures', kind: 'number', default: 24 }], run: async (ctx, i) => {
      const g = regrouper(await collecter(ctx, Math.max(1, Number(i.heures) || 24)));
      return { text: g.length ? g.map((x) => `- ${x.fois} × [${x.niveau}] ${x.modele}`).join('\n') : 'Aucun message.', data: g };
    } },
    { id: 'regle', label: 'Ajouter une règle', what: 'Préviens-moi si ce message revient trop souvent', words: ['ajoute une règle sur les journaux du système'], params: [{ key: 'motif', label: 'Mots à repérer (ex. Failed password ; « a|b » = l\'un ou l\'autre)', kind: 'text', required: true }, { key: 'fois', label: 'Nombre de fois', kind: 'number', default: 10 }, { key: 'minutes', label: 'En combien de minutes', kind: 'number', default: 5 }, { key: 'niveau', label: 'Importance', kind: 'select', options: ['moyenne', 'haute'], default: 'moyenne' }],
      run: (ctx, i) => {
        const motif = s(i.motif).trim().slice(0, 200); if (!motif) throw new Error('motif vide');
        const r: Regle = { id: `r${Date.now().toString(36)}`, motif, fois: Math.max(1, Math.min(10_000, Number(i.fois) || 10)), minutes: Math.max(1, Math.min(1440, Number(i.minutes) || 5)), niveau: s(i.niveau) === 'haute' ? 'haute' : 'moyenne' };
        ctx.saveSettings({ regles: [...((ctx.settings.regles as Regle[] | undefined) ?? []), r] });
        return { text: `🔔 Règle ajoutée : « ${r.motif} » ${r.fois} fois en ${r.minutes} min → alerte ${r.niveau}.` };
      } },
    { id: 'retirer_regle', label: 'Retirer une règle', what: 'Supprime une règle d\'alerte', words: ['retire une règle des journaux du système'], params: [{ key: 'id', label: 'Règle (identifiant ou motif)', kind: 'text', required: true }], run: (ctx, i) => {
      const l = (ctx.settings.regles as Regle[] | undefined) ?? [], k = s(i.id).trim(), rest = l.filter((r) => r.id !== k && r.motif !== k);
      if (rest.length === l.length) throw new Error('règle introuvable'); ctx.saveSettings({ regles: rest }); return { text: 'Règle retirée.' };
    } },
    { id: 'fichier', label: 'Lire un fichier de journal en plus', what: 'Ajoute un fichier (ex. le journal d\'une de tes applis)', words: ['ajoute un fichier aux journaux du système'], params: [{ key: 'chemin', label: 'Chemin du fichier', kind: 'text', required: true }], run: (ctx, i) => {
      const f = s(i.chemin).trim(); if (!f.startsWith('/') || f.includes('\0')) throw new Error('chemin absolu attendu'); if (!existsSync(f)) throw new Error('fichier introuvable');
      ctx.saveSettings({ fichiers: [...new Set([...((ctx.settings.fichiers as string[] | undefined) ?? []), f])] }); return { text: `📄 ${f} est lu avec les autres journaux.` };
    } },
  ],
  async view(ctx, q) {
    const l = await collecter(ctx, 24), f = filtrer(l, { q: q.get('q') ?? '', niveau: (q.get('niveau') ?? '') as Niveau }), now = ctx.now().getTime();
    const err = l.filter((x) => x.niveau === 'erreur').length, warn = l.filter((x) => x.niveau === 'attention').length, sources = [...new Set(l.map((x) => x.source))];
    const heures = Array.from({ length: 24 }, (_, k) => now - (23 - k) * 3600_000);
    const kpis: Kpi[] = [{ label: 'Lignes (24 h)', value: String(l.length) }, { label: 'Erreurs', value: String(err), tone: err ? 'mauvais' : 'bon' }, { label: 'Attention', value: String(warn), tone: warn ? 'attention' : 'bon' }, { label: 'Sources', value: String(sources.length), hint: sources.join(', ') }];
    const regles = (ctx.settings.regles as Regle[] | undefined) ?? [];
    return {
      subtitle: `${sources.length} source(s) · dernières 24 h`, kpis,
      sections: [
        { kind: 'courbe', title: 'Erreurs et avertissements, heure par heure', labels: heures.map((t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit' })), series: [{ name: 'erreurs', tone: 'mauvais', points: heures.map((t) => l.filter((x) => x.niveau === 'erreur' && x.t > t - 3600_000 && x.t <= t).length) }, { name: 'attention', tone: 'attention', points: heures.map((t) => l.filter((x) => x.niveau === 'attention' && x.t > t - 3600_000 && x.t <= t).length) }] },
        { kind: 'table', title: 'Messages qui se répètent', columns: ['Fois', 'Gravité', 'Message'], empty: 'Aucun message.', rows: regrouper(l, 12).map((x) => ({ cells: [String(x.fois), x.niveau, x.modele], tone: TONE[x.niveau] })) },
        { kind: 'table', title: 'Derniers messages', columns: ['Heure', 'Source', 'Programme', 'Message'], empty: 'Rien pour cette recherche.', rows: f.slice(0, 80).map((x) => ({ cells: [heure(x.t), x.source, x.prog ?? '', x.texte.slice(0, 240)], tone: TONE[x.niveau] })) },
        { kind: 'form', title: 'Chercher', action: 'chercher', submit: 'Chercher', params: [{ key: 'q', label: 'Mots', kind: 'text', default: '' }, { key: 'niveau', label: 'Gravité minimale', kind: 'select', options: ['', 'erreur', 'attention', 'info'], default: '' }, { key: 'heures', label: 'Dernières heures', kind: 'number', default: 24 }] },
      ],
      side: [{ kind: 'list', title: 'Règles d\'alerte', empty: 'Aucune règle. Ex. « Failed password » 10 fois en 5 min.', items: regles.map((r) => ({ title: r.motif, detail: `${r.fois} fois en ${r.minutes} min → ${r.niveau}`, meta: r.id })) }],
    };
  },
  watch: { every: 120, async run(ctx) {
    const regles = (ctx.settings.regles as Regle[] | undefined) ?? []; if (!regles.length) return;
    const l = await collecter(ctx, Math.ceil(Math.max(...regles.map((r) => r.minutes)) / 60) || 1), now = ctx.now().getTime();
    const hors = l.filter((x) => !(x.source === 'Odin' && x.prog === 'mimisbrunnr'));   // jamais ses propres alertes : une règle se relancerait toute seule
    for (const r of regles) { const n = declenche(r, hors, now); if (n) ctx.alert({ level: r.niveau, title: `Chroniques : « ${r.motif} » ${n} fois en ${r.minutes} min`, detail: hors.find((x) => contient(x.texte, r.motif))?.texte.slice(0, 300), key: `chroniques:${r.id}:${Math.floor(now / (r.minutes * 60_000))}` }); }
  } },
};
