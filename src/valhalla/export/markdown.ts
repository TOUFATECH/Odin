// Export des pages d'applis · Markdown et JSON.
// Le Markdown se lit tel quel et s'ouvre dans Obsidian, GitHub ou un éditeur de texte. Ce qui vient des données est
// échappé : une case de tableau ne peut pas devenir un titre, un lien ou du HTML dans le lecteur de l'utilisateur.

import { groupes, manques, provenance, vide, type PageExport, type SectionExport } from './page.ts';
import type { Tone } from '../types.ts';

const lettre = /[A-Za-z0-9À-ÿ]/;
/** Un texte venu des données, sur une ligne, sans effet de mise en forme. Pur. */
export function ligne(t: string): string {
  return t.replace(/\s*\n\s*/g, ' ').replace(/[\\`*[\]<>]/g, '\\$&')
    .replace(/_/g, (_m, i: number, s: string) => (lettre.test(s[i - 1] ?? '') && lettre.test(s[i + 1] ?? '') ? '_' : '\\_'))
    .replace(/~~/g, '\\~\\~').replace(/&(?=#?\w+;)/g, '\\&');
}
/** Une case de tableau : comme une ligne, et la barre verticale ne coupe pas la case. Pur. */
export const cellule = (t: string) => t.split('\n').map((x) => ligne(x).replace(/\|/g, '\\|')).join('<br>').trim();
/** Un paragraphe venu des données : les retours à la ligne sont gardés ; une ligne ne devient ni un titre ni un trait. Pur. */
export function paragraphe(t: string): string {
  return t.split('\n').map((l) => ligne(l.trim()).replace(/^(#{1,6})(?=\s|$)/, '\\$1').replace(/^(=+|-{2,}|-(?=\s*$))\s*$/, '\\$&')).join('  \n').replace(/(?: {2}\n){2,}/g, '\n\n').trim();
}
const marque = (t: Tone | undefined) => (t === 'mauvais' ? '⛔ ' : t === 'attention' ? '⚠ ' : '');
const tableau = (colonnes: string[], lignes: string[][]) => [`| ${colonnes.map(cellule).join(' | ')} |`, `|${colonnes.map(() => ' --- ').join('|')}|`, ...lignes.map((l) => `| ${l.join(' | ')} |`)].join('\n');
/** Un bloc de journal : une clôture plus longue que toute suite d'accents graves du texte. */
function bloc(lignes: string[]): string {
  const texte = lignes.join('\n'), plus = Math.max(3, ...(texte.match(/`+/g) ?? []).map((x) => x.length + 1));
  return `${'`'.repeat(plus)}text\n${texte}\n${'`'.repeat(plus)}`;
}
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Les voisins d'un point du graphe, par leur nom (8 au plus, puis « +N »). */
export function voisins(s: Extract<SectionExport, { kind: 'graph' }>, id: string): string {
  const nom = new Map(s.nodes.map((n) => [n.id, n.label])), vus = new Set<string>();
  for (const e of s.edges) { if (e.a === id && e.b !== id) vus.add(e.b); else if (e.b === id && e.a !== id) vus.add(e.a); }
  const l = [...vus].map((x) => nom.get(x) ?? x);
  return l.length > 8 ? `${l.slice(0, 8).join(', ')}, +${l.length - 8}` : l.join(', ');
}
/** La fiche d'un point du graphe en une ligne : sous-titre, pastilles, « clé : valeur ». */
export function fiche(s: Extract<SectionExport, { kind: 'graph' }>, id: string): string {
  const d = s.details[id]; if (!d) return '';
  return [d.subtitle, ...(d.chips ?? []).map((c) => c.label), ...(d.rows ?? []).map((r) => `${r.k} : ${r.v}`), ...(d.list?.items.length ? [`${d.list.title} : ${d.list.items.map((i) => (i.meta ? `${i.text} (${i.meta})` : i.text)).join(', ')}`] : [])].filter(Boolean).join(' ; ');
}
/** Les colonnes d'une courbe : l'étiquette, puis une colonne par série (avec l'unité). */
export const colonnesCourbe = (s: Extract<SectionExport, { kind: 'courbe' }>) => ['', ...s.series.map((x) => (s.unit ? `${x.name} (${s.unit})` : x.name))];
export const nombreFr = (v: number) => (Number.isInteger(v) ? String(v) : v.toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

function section(s: SectionExport, niveau: string): string {
  const titre = `${niveau} ${ligne(s.title) || 'Sans titre'}`, rien = vide(s);
  if (rien) return `${titre}\n\n_${ligne(rien)}_`;
  switch (s.kind) {
    case 'table': return `${titre}\n\n${tableau(s.columns, s.rows.map((r) => r.cells.map((c, j) => (j === 0 ? marque(r.tone) : '') + cellule(c))))}`;
    case 'list': return `${titre}\n\n${s.items.map((i) => `- ${marque(i.tone)}**${ligne(i.title)}**${i.detail ? ` — ${ligne(i.detail)}` : ''}${i.meta ? ` _(${ligne(i.meta)})_` : ''}`).join('\n')}`;
    case 'cards': return `${titre}\n\n${s.items.map((c) => `- ${marque(c.tone)}**${ligne(c.title)}**${[c.sub, c.badge, c.meta].filter(Boolean).map((x) => ` — ${ligne(x!)}`).join('')}${c.progress !== undefined ? ` — ${pct(c.progress)}` : ''}`).join('\n')}`;
    case 'log': return `${titre}\n\n${bloc(s.lines)}`;
    case 'text': return `${titre}\n\n${marque(s.tone)}${paragraphe(s.text)}`;
    case 'bars': return `${titre}\n\n${tableau(['Nom', 'Valeur'], s.items.map((i) => [cellule(i.label), cellule(i.display ?? nombreFr(i.value))]))}`;
    case 'courbe': return `${titre}\n\n${tableau(colonnesCourbe(s), s.labels.map((l, i) => [cellule(l), ...s.series.map((x) => nombreFr(x.points[i] ?? 0))]))}`;
    case 'steps': return `${titre}\n\n${s.items.map((i, n) => `${n + 1}. [${i.done ? 'x' : ' '}] **${ligne(i.title)}**${i.detail ? ` — ${ligne(i.detail)}` : ''}`).join('\n')}`;
    case 'graph': return `${titre}\n\n_${s.nodes.length} point${s.nodes.length > 1 ? 's' : ''}, ${s.edges.length} lien${s.edges.length > 1 ? 's' : ''}${s.period ? ` · ${ligne(s.period)}` : ''}_\n\n${tableau(['Point', 'Détail', 'Fiche', 'Relié à'], s.nodes.map((n) => [cellule(n.label), cellule(n.sub ?? ''), cellule(fiche(s, n.id)), cellule(voisins(s, n.id))]))}`;
  }
}

/** La page en Markdown. Pur. */
export function enMarkdown(p: PageExport): string {
  const out: string[] = [`# ${ligne(p.app.name)}`, ligne(p.app.what), `_${ligne(provenance(p))}_`];
  if (p.subtitle) out.push(`> ${ligne(p.subtitle)}`);
  if (p.kpis.length) out.push(`## Chiffres clés\n\n${p.kpis.map((k) => `- ${marque(k.tone)}**${ligne(k.label)}** : ${ligne(k.value)}`).join('\n')}`);
  for (const g of groupes(p)) {
    if (g.onglet) out.push(`## ${ligne(g.onglet)}`);
    for (const s of g.sections) out.push(section(s, g.onglet ? '###' : '##'));
  }
  if (!p.kpis.length && !p.sections.length) out.push('_Cette page n\'a rien à montrer pour l\'instant._');
  const notes = manques(p);
  if (notes.length) out.push(`---\n\n${notes.map((n) => `_${ligne(n)}_`).join('  \n')}`);
  return `${out.filter(Boolean).join('\n\n')}\n`;
}

/** La page en JSON : les données propres (mêmes mots que le modèle des pages), sans bouton, formulaire ni dessin. Pur. */
export const enJson = (p: PageExport): string => `${JSON.stringify(p, null, 2)}\n`;
