// Partage des pages d'applis · la page figée, en lecture seule.
// Une page HTML sans script, sans formulaire, sans bouton, sans lien, sans image et sans rien à charger : seulement
// du texte, des tableaux et des dessins simples (barres, courbes) écrits dans la page. Une seule feuille de style,
// désignée par son empreinte dans la politique de contenu : même une balise glissée dans les données ne pourrait ni
// lancer un script ni changer l'apparence. Tout ce qui vient des données est échappé.

import { createHash } from 'node:crypto';
import type { Tone } from '../types.ts';
import { fiche, nombreFr, voisins } from './markdown.ts';
import { groupes, manques, vide, type PageExport, type SectionExport } from './page.ts';

/** La feuille de style des pages de partage (clair et sombre selon l'appareil). */
export const STYLE = `:root{color-scheme:light dark;--bg:#F4F5F7;--card:#fff;--ink:#14171C;--muted:#555B66;--line:#D3D7DE;--accent:#2F5BD3;--good:#1B6E36;--warn:#8F4B00;--bad:#B42318;--soft:#EDF0F4}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--card:#1B1E23;--ink:#ECEEF1;--muted:#A9AFB9;--line:#343943;--accent:#7EA0F2;--good:#6CCB8B;--warn:#F0B056;--bad:#F97066;--soft:#23272E}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.bandeau{background:var(--soft);border-bottom:1px solid var(--line);padding:10px 16px;font-size:14px;color:var(--muted);text-align:center}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}
main.etroit{max-width:560px}
h1{font-size:28px;line-height:1.2;margin:0 0 6px}h2{font-size:20px;margin:0 0 12px}h3{font-size:17px;margin:0 0 10px}
p{margin:0 0 12px}
.quoi{color:var(--muted)}.sous{font-weight:600;margin-bottom:18px}
.sec{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin:0 0 16px}
.onglet{font-size:22px;margin:28px 0 12px;padding:0 0 6px;border-bottom:2px solid var(--line)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:0 0 16px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.kpi small{display:block;color:var(--muted);font-size:13px}.kpi b{font-size:20px;overflow-wrap:anywhere}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
th{background:var(--soft);font-weight:600}
ul,ol{margin:0;padding:0 0 0 22px}li{margin:0 0 8px;overflow-wrap:anywhere}li small{color:var(--muted)}
pre{margin:0;padding:12px;background:var(--soft);border-radius:10px;font:13px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.texte{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.vide{color:var(--muted);font-style:italic;margin:0}
.bon{color:var(--good)}.attention{color:var(--warn)}.mauvais{color:var(--bad)}
.cartes{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.carte{border:1px solid var(--line);border-radius:12px;padding:12px;overflow-wrap:anywhere}.carte small{display:block;color:var(--muted)}
.badge{display:inline-block;margin-top:6px;padding:2px 8px;border-radius:999px;background:var(--soft);font-size:13px}
svg{display:block;width:100%}
.barre{height:10px;margin-top:8px}.barre .f{fill:var(--soft)}.barre .v{fill:var(--accent)}
.barres td{border:0;padding:5px 8px}.barres td:first-child{width:36%}.barres td:last-child{white-space:nowrap;font-weight:600;text-align:right;width:1%}
.courbe{height:auto}.courbe .axe{stroke:var(--line);stroke-width:1}.courbe text{fill:var(--muted);font-size:11px}
.trace{fill:none;stroke-width:2;stroke-linejoin:round}
.s0{stroke:var(--accent)}.s1{stroke:#0E8C8C}.s2{stroke:#8A5BD0}.s3{stroke:#6B7280}.sbon{stroke:var(--good)}.sattention{stroke:var(--warn)}.smauvais{stroke:var(--bad)}
.p0{color:var(--accent)}.p1{color:#0E8C8C}.p2{color:#8A5BD0}.p3{color:#6B7280}.pbon{color:var(--good)}.pattention{color:var(--warn)}.pmauvais{color:var(--bad)}
.legende{margin:8px 0 0;font-size:14px;color:var(--muted)}.legende span{margin-right:14px;white-space:nowrap}
.etat{font-size:13px;color:var(--muted);margin-left:6px}.etat.fait{color:var(--good)}
.notes{color:var(--muted);font-size:14px;font-style:italic}
.pied{margin:24px 0 0;font-size:13px;color:var(--muted);text-align:center}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.liens a{display:block;margin:10px 0;padding:12px 14px;border:1px solid var(--line);border-radius:12px;color:var(--accent);text-decoration:none;font-weight:600}
.liens a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}`;
/** L'empreinte de la feuille de style, pour la politique de contenu (`style-src 'sha256-…'`). */
export const STYLE_HASH = createHash('sha256').update(STYLE).digest('base64');

/** Échappe un texte pour l'écrire dans la page. */
export const h = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const classe = (t: Tone | undefined) => (t ? ` class="${t}"` : '');
/** Pour qui ne voit pas la couleur : l'état dit en mots, lu par les lecteurs d'écran. */
const dit = (t: Tone | undefined) => (t === 'mauvais' ? '<span class="sr">Problème : </span>' : t === 'attention' ? '<span class="sr">À surveiller : </span>' : '');
const n2 = (v: number) => (Math.round(v * 10) / 10).toString();

function table(colonnes: string[], lignes: Array<{ cells: string[]; tone?: Tone }>, c = ''): string {
  return `<div class="tw"><table${c ? ` class="${c}"` : ''}><thead><tr>${colonnes.map((x) => `<th scope="col">${h(x)}</th>`).join('')}</tr></thead><tbody>${lignes.map((r) => `<tr${classe(r.tone)}>${colonnes.map((_x, j) => `<td>${j === 0 ? dit(r.tone) : ''}${h(r.cells[j] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const barre = (part: number) => `<svg class="barre" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="f" width="100" height="10"/><rect class="v" width="${n2(Math.max(0, Math.min(100, part * 100)))}" height="10"/></svg>`;

function courbe(s: Extract<SectionExport, { kind: 'courbe' }>): string {
  const W = 640, H = 180, P = 44, n = Math.max(2, s.labels.length), max = Math.max(1, ...s.series.flatMap((x) => x.points));
  const X = (i: number) => P + (i * (W - P - 8)) / (n - 1), Y = (v: number) => H - 22 - (Math.max(0, v) / max) * (H - 34);
  const fmt = (v: number) => (s.unit ? `${v >= 100 ? Math.round(v) : nombreFr(Math.round(v * 10) / 10)} ${s.unit}` : nombreFr(Math.round(v * 10) / 10));
  const cl = (i: number) => (s.series[i].tone ? s.series[i].tone! : String(i % 4));
  const pas = Math.max(1, Math.ceil(s.labels.length / 6));
  const axes = [0, 0.5, 1].map((k) => `<text x="0" y="${n2(Y(max * k) + 4)}">${h(fmt(max * k))}</text><line class="axe" x1="${P}" x2="${W - 8}" y1="${n2(Y(max * k))}" y2="${n2(Y(max * k))}"/>`).join('');
  const bas = s.labels.map((l, i) => (i % pas === 0 ? `<text x="${n2(X(i))}" y="${H - 6}" text-anchor="middle">${h(l)}</text>` : '')).join('');
  const traces = s.series.map((x, i) => `<polyline class="trace s${cl(i)}" points="${x.points.slice(0, n).map((v, k) => `${n2(X(k))},${n2(Y(v))}`).join(' ')}"/>`).join('');
  const resume = `${s.title} : ${s.series.map((x) => `${x.name} ${fmt(x.points.at(-1) ?? 0)}`).join(', ')}`;
  return `<svg class="courbe" viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(resume)}">${axes}${bas}${traces}</svg><p class="legende">${s.series.map((x, i) => `<span><b class="p${cl(i)}" aria-hidden="true">● </b>${h(x.name)} : ${h(fmt(x.points.at(-1) ?? 0))}</span>`).join('')}</p>`;
}

function section(s: SectionExport, t: 'h2' | 'h3'): string {
  const rien = vide(s), titre = `<${t}>${h(s.title || 'Sans titre')}</${t}>`;
  const corps = ((): string => {
    if (rien) return `<p class="vide">${h(rien)}</p>`;
    switch (s.kind) {
      case 'table': return table(s.columns, s.rows);
      case 'list': return `<ul>${s.items.map((i) => `<li${classe(i.tone)}>${dit(i.tone)}<b>${h(i.title)}</b>${i.detail ? ` — ${h(i.detail)}` : ''}${i.meta ? ` <small>${h(i.meta)}</small>` : ''}</li>`).join('')}</ul>`;
      case 'cards': return `<div class="cartes">${s.items.map((c) => `<div class="carte"><b${classe(c.tone)}>${dit(c.tone)}${h(c.title)}</b>${c.sub ? `<small>${h(c.sub)}</small>` : ''}${c.meta ? `<small>${h(c.meta)}</small>` : ''}${c.badge ? `<span class="badge">${h(c.badge)}</span>` : ''}${c.progress !== undefined ? `${barre(c.progress)}<span class="sr">${Math.round(c.progress * 100)} %</span>` : ''}</div>`).join('')}</div>`;
      case 'log': return `<pre>${h(s.lines.join('\n'))}</pre>`;
      case 'text': return `<p class="texte${s.tone ? ` ${s.tone}` : ''}">${dit(s.tone)}${h(s.text)}</p>`;
      case 'bars': { const max = Math.max(1, ...s.items.map((i) => i.value)); return `<table class="barres"><tbody>${s.items.map((i) => `<tr><td>${h(i.label)}</td><td>${barre(i.value / max)}</td><td>${h(i.display ?? nombreFr(i.value))}</td></tr>`).join('')}</tbody></table>`; }
      case 'courbe': return courbe(s);
      case 'steps': return `<ol>${s.items.map((i) => `<li><b>${h(i.title)}</b>${i.detail ? ` — ${h(i.detail)}` : ''}<span class="etat${i.done ? ' fait' : ''}">${i.done ? 'Fait' : 'À faire'}</span></li>`).join('')}</ol>`;
      case 'graph': return `<p class="vide">${s.nodes.length} point${s.nodes.length > 1 ? 's' : ''}, ${s.edges.length} lien${s.edges.length > 1 ? 's' : ''}${s.period ? ` · ${h(s.period)}` : ''}</p>${table(['Point', 'Détail', 'Fiche', 'Relié à'], s.nodes.map((n) => ({ cells: [n.label, n.sub ?? '', fiche(s, n.id), voisins(s, n.id)] })))}`;
    }
  })();
  return `<section class="sec">${titre}${corps}</section>`;
}

/** Une page de partage entière (copie figée, ou simple message). `bandeau` : la ligne d'information du haut. */
export function pageHtml(o: { titre: string; bandeau?: string; corps: string; etroit?: boolean }): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><meta name="referrer" content="no-referrer"><title>${h(o.titre)}</title><style>${STYLE}</style></head><body>${o.bandeau ? `<div class="bandeau" role="note">${h(o.bandeau)}</div>` : ''}<main${o.etroit ? ' class="etroit"' : ''}>${o.corps}<p class="pied">Partagé avec Odin · lecture seule</p></main></body></html>`;
}

/** La copie figée d'une page d'appli, en HTML sans script. Pur. */
export function enHtml(p: PageExport, bandeau: string): string {
  const out: string[] = [`<h1>${h(p.app.name)}</h1>`, `<p class="quoi">${h(p.app.what)}</p>`];
  if (p.subtitle) out.push(`<p class="sous">${h(p.subtitle)}</p>`);
  if (p.kpis.length) out.push(`<h2 class="sr">Chiffres clés</h2><div class="kpis">${p.kpis.map((k) => `<div class="kpi"><small>${h(k.label)}</small><b${classe(k.tone)}>${dit(k.tone)}${h(k.value)}</b>${k.pct !== undefined ? barre(k.pct / 100) : ''}</div>`).join('')}</div>`);
  for (const g of groupes(p)) {
    if (g.onglet) out.push(`<h2 class="onglet">${h(g.onglet)}</h2>`);
    for (const s of g.sections) out.push(section(s, g.onglet ? 'h3' : 'h2'));
  }
  if (!p.kpis.length && !p.sections.length) out.push('<p class="vide">Cette page n\'a rien à montrer pour l\'instant.</p>');
  const notes = manques(p);
  if (notes.length) out.push(`<div class="notes">${notes.map((n) => `<p>${h(n)}</p>`).join('')}</div>`);
  return pageHtml({ titre: `${p.app.name} · copie partagée`, bandeau, corps: out.join('') });
}
