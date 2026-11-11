// valhalla : Odin utilise toutes ses applis (sécurité, machines, sauvegardes, maison, caméras, voix,
// rendez-vous, veille…), choisit la bonne pour un besoin et explique qui fait quoi.
// Les actions graves passent par Heimdall (ton accord) ; les lectures sont libres.

import { understand } from '../valhalla/huginn.ts';
import { LINKS, USAGES } from '../valhalla/links.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import type { Valhalla } from '../valhalla/service.ts';
import { obj, str, type Tool } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
const parse = (v: unknown): Record<string, unknown> => { if (v && typeof v === 'object') return v as Record<string, unknown>; const t = s(v).trim(); if (!t) return {}; try { return JSON.parse(t) as Record<string, unknown>; } catch { throw new Error('entree : JSON attendu'); } };

/** Pour un besoin : l'appli choisie, pourquoi, comment, et la chaîne d'applis si c'est un usage connu. */
export function advise(v: Valhalla, need: string): string {
  const found = v.find(need).slice(0, 3);
  const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const usage = USAGES.find((u) => norm(need).split(/\s+/).filter((w) => w.length > 4).some((w) => norm(u.need).includes(w)));
  if (!found.length && !usage) return 'Aucune appli d\'Odin ne correspond clairement. Dis-le autrement, ou envoie-moi le lien GitHub d\'un projet qui fait ça : je l\'étudie (Kvasir).';
  const name = (id: string) => v.module(id)?.name ?? id;
  const out: string[] = [];
  if (found[0]) {
    const { m, action } = found[0];
    out.push(`➡ **${m.name}** — ${m.what}`, v.describe(m).split('\n').slice(1).join('\n'));
    if (action) out.push(`Action conseillée : « ${action.label} » — ${action.what}${action.grave ? ' (avec ton accord)' : ''}.`);
    const l = LINKS.filter((x) => x.from === m.id || x.to === m.id);
    if (l.length) out.push(`Liens : ${l.map((x) => `${name(x.from)} → ${name(x.to)} quand ${x.when} (${x.does})`).join(' ; ')}.`);
  }
  if (usage) out.push(`Pour « ${usage.need} » : ${usage.chain.map(name).join(' → ')}. ${usage.why}`);
  if (found.length > 1) out.push(`Aussi possible : ${found.slice(1).map((f) => `${f.m.name} (${f.m.what.split(':')[0].toLowerCase()})`).join(', ')}.`);
  return out.join('\n');
}

export const valhallaTool: Tool = {
  name: 'valhalla',
  description: 'Les applis d\'Odin (Eir santé machine, Skögul processus, Forseti alertes et conformité, Garmr bannissement, Geri connexions, Ullr antivirus, Loki pièges, Naglfar conteneurs, Ymir machines virtuelles, Sindri sauvegardes, Brísingamen mots de passe, Gjöll VPN, Hermóðr parc de machines, Appareils (relais MQTT), Brokkr modules ESP/Tasmota, Midgard maison et scènes, Himinbjörg caméras, Bragi voix, Freyja (Venus, films, séries, télé, enregistrements), Ægir musique, Frigg rendez-vous, Kvasir veille GitHub, Saga, Runes, Draupnir). « manips » (ce qu\'Odin a fait seul) ; « manip » (appli = code de la manip, quoi = garder ou annuler) ; « lister » ; « expliquer » (appli) ; « conseiller » (besoin : quelle appli, pourquoi, comment, liens) ; « etat » (appli : sa page en texte) ; « action » (appli, action, entree JSON) ; « alertes » ; « liens ». Un lien GitHub envoyé par le propriétaire → action Kvasir « etudier ».',
  risk: 'exec',
  schema: obj({ action: { type: 'string', enum: ['lister', 'expliquer', 'conseiller', 'etat', 'action', 'alertes', 'liens', 'auto', 'manips', 'manip'] }, appli: str('nom de l\'appli'), besoin: str('pour conseiller : le besoin en français'), quoi: str('pour action : identifiant de l\'action'), entree: str('pour action : réglages JSON') }, ['action']),
  summarize: (i) => `applis ${s(i.action)} ${s(i.appli)} ${s(i.quoi)} ${s(i.besoin)}`.slice(0, 140),
  lookup: (i) => {
    const a = s(i.action); if (a === 'manip') return s(i.quoi) !== 'annuler'; // garder ne change rien ; annuler lance l'action inverse
    if (a !== 'action') return true;
    const f = valhallaOf()?.action(s(i.appli), s(i.quoi)); return Boolean(f?.a.read);
  },
  grave: (i) => {
    const v = valhallaOf(); if (!v) return undefined;
    // Annuler une manip = lancer son action inverse : si celle-ci est grave, ton accord est demandé.
    if (s(i.action) === 'manip' && s(i.quoi) === 'annuler') { const x = v.manips({ limit: 500 }).find((m) => m.id === s(i.appli)); const f = x?.undo ? v.action(x.undo.module ?? x.module, x.undo.action) : undefined; try { return f?.a.grave?.(x!.undo!.input, v.ctx(f.m.id)); } catch { return undefined; } }
    if (s(i.action) !== 'action') return undefined;
    const f = v.action(s(i.appli), s(i.quoi)); try { return f?.a.grave?.(parse(i.entree), v.ctx(f.m.id)); } catch { return undefined; }
  },
  async run(i, ctx) {
    const v = valhallaOf(); if (!v) return 'Les applis d\'Odin ne sont pas démarrées (lance Odin en service).';
    const a = s(i.action);
    if (a === 'lister') { const fam = [...new Set(v.modules().map((m) => m.family))]; return fam.map((f) => `**${f}**\n${v.modules().filter((m) => m.family === f).map((m) => `- ${m.name} : ${m.what}`).join('\n')}`).join('\n\n'); }
    if (a === 'liens') return [`Liens entre applis (tous automatiques) :`, ...LINKS.filter((l) => l.kind !== 'soin').map((l) => `- ${v.module(l.from)?.name} → ${v.module(l.to)?.name} : quand ${l.when}, ${l.does}`), '', 'Ce qu\'Odin répare tout seul (tu peux garder ou annuler) :', ...LINKS.filter((l) => l.kind === 'soin').map((l) => `- ${v.module(l.from)?.name} : quand ${l.when}, ${l.does}`), '', 'Usages de prédilection :', ...USAGES.map((u) => `- ${u.need} : ${u.chain.map((c) => v.module(c)?.name ?? c).join(' → ')}`)].join('\n');
    if (a === 'alertes') { const l = v.alerts({ limit: 20 }); return l.length ? l.map((x) => `- ${x.at.slice(5, 16).replace('T', ' ')} ${x.level} · ${v.module(x.module)?.name ?? x.module} : ${x.title}${x.count > 1 ? ` (×${x.count})` : ''}`).join('\n') : 'Aucune alerte.'; }
    if (a === 'conseiller') return advise(v, s(i.besoin || i.appli));
    if (a === 'manips') { const l = v.manips({ limit: 20 }); return l.length ? l.map((x) => `- [${x.id}] ${x.at.slice(5, 16).replace('T', ' ')} · ${x.label} — ${x.text} · ${x.state}${x.undo ? '' : ' (pas d\'annulation automatique)'}`).join('\n') : 'Aucune manip faite par Odin de lui-même.'; }
    if (a === 'manip') { const r = await v.decide(s(i.appli), s(i.quoi) !== 'annuler'); return r.text; }
    // Sans IA (Huginn) : comprend la demande ; une lecture est lancée tout de suite, le reste est expliqué
    // (une action qui change quelque chose passe par « action », donc par Heimdall).
    if (a === 'auto') {
      const u = await understand(v, s(i.besoin), ctx?.sessionId ?? 'principal');
      if (!u) return '';
      if (u.kind === 'say' || u.kind === 'ask') return u.text;
      if (u.kind === 'action' && u.read) { const r = await v.act(u.module, u.action, u.input, { auto: true }); return `${u.label}\n${r.text}`; }
      return advise(v, s(i.besoin));
    }
    const m = v.module(s(i.appli)); if (!m) return `Appli inconnue : ${s(i.appli)}. Applis : ${v.modules().map((x) => x.name).join(', ')}.`;
    if (a === 'expliquer') return `${v.describe(m)}\nActions : ${m.actions.map((x) => `${x.id} (${x.label}${x.params?.length ? ` : ${x.params.map((p) => `${p.key}${p.required ? '*' : ''}`).join(', ')}` : ''})`).join(' · ')}`;
    if (a === 'etat') {
      const view = await m.view(v.ctx(m.id), new URLSearchParams());
      const kp = (view.kpis ?? []).map((k) => `${k.label} : ${k.value}`).join(' · ');
      const sec = view.sections.map((x) => x.kind === 'table' ? `${x.title} :\n${x.rows.slice(0, 15).map((r) => `- ${r.cells.join(' · ')}`).join('\n') || `  ${x.empty ?? 'vide'}`}` : x.kind === 'list' ? `${x.title} :\n${x.items.slice(0, 15).map((it) => `- ${it.title}${it.detail ? ` — ${it.detail}` : ''}`).join('\n') || '  vide'}` : x.kind === 'text' ? `${x.title} : ${x.text}` : x.kind === 'log' ? `${x.title} :\n${x.lines.slice(-10).join('\n')}` : x.kind === 'bars' ? `${x.title} : ${x.items.map((b) => `${b.label} ${b.display ?? b.value}`).join(', ')}` : '').filter(Boolean).join('\n\n');
      return `**${m.name}** — ${view.subtitle ?? ''}\n${kp}\n\n${sec}`.slice(0, 6000);
    }
    // Qui agit ? Toi quand tu le demandes dans une discussion ; Odin de lui-même dans une tâche sans surveillance
    // (veille, tâche planifiée, mission) : là, l'action est notée comme une manip (garder / annuler).
    if (a === 'action') { const alone = /^(auto|breaker|journal|cron|mission):/.test(ctx?.sessionId ?? ''); const r = await v.act(m.id, s(i.quoi), parse(i.entree), alone ? { by: 'odin', why: 'pendant une tâche sans surveillance' } : {}); return r.text; }
    return 'Action inconnue.';
  },
};
