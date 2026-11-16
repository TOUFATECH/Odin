// La page de résultats classique d'Odin (/recherche?q=…) : la liste fusionnée par Lyncée, rendue ici, sans aucun
// script. Tout texte venu d'un moteur passe par esc() ; un lien n'est gardé que s'il est en http(s). Pur.
import { CATEGORIES, type Categorie } from '../valhalla/volva/lyncee/types.ts';
import type { ReponseLyncee } from '../valhalla/volva/lyncee/meta.ts';

/** Le nom du moteur dans les navigateurs (16 caractères au plus) : le même dans la description et dans la balise du head. */
export const NOM_MOTEUR = 'Odin';
/** La balise qui fait connaître le moteur au navigateur (dans le head de chaque page de recherche). */
export const LIEN_RECHERCHE = `<link rel="search" type="application/opensearchdescription+xml" title="${NOM_MOTEUR}" href="/opensearch.xml">`;
/** Les couleurs et la police de la page de recherche validée (reprises telles quelles). */
export const STYLE_COMMUN = `@font-face{font-family:Plex;src:url(/fonts/ibm-plex-sans-latin-400-normal.woff2) format('woff2');font-weight:400}@font-face{font-family:Plex;src:url(/fonts/ibm-plex-sans-latin-600-normal.woff2) format('woff2');font-weight:600}
:root{--bg1:#cfe9f2;--bg2:#e7f5f2;--glass:rgba(255,255,255,.82);--glass2:rgba(255,255,255,.6);--line:rgba(16,54,58,.1);--text:#10363a;--muted:#5c7477;--acc:#0b7f7c;--acc2:#0f9a8f;--soft:#e3f2f0;--ok:#1f9d55;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg1:#0c1d22;--bg2:#10292a;--glass:rgba(22,38,42,.88);--glass2:rgba(22,38,42,.6);--line:rgba(255,255,255,.09);--text:#e8f3f2;--muted:#9bb3b4;--acc:#2ec4b6;--acc2:#18a999;--soft:rgba(46,196,182,.12);--ok:#34c77b;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(1200px 800px at 80% -10%,var(--bg2),transparent 60%),linear-gradient(170deg,var(--bg1),var(--bg2));background-attachment:fixed;color:var(--text);font:15.5px/1.55 Plex,system-ui,-apple-system,'Segoe UI',sans-serif;overflow-x:hidden}
a{color:var(--acc)}:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.card{background:var(--glass);border:1px solid var(--line);border-radius:22px;box-shadow:0 10px 30px rgba(16,54,58,.08)}
.act{border:1px solid var(--line);background:var(--glass2);border-radius:12px;padding:7px 12px;display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:600;text-decoration:none;color:var(--text)}`;

/** Le texte prêt à poser dans du HTML (contenu ou attribut entre guillemets). Pur. */
export const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Une adresse http(s) réécrite proprement (sans identifiants), sinon '' (javascript:, data:, adresse illisible…). Pur. */
export function lienSur(url: unknown): string {
  try {
    const u = new URL(String(url ?? ''));
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return '';
    return u.toString();
  } catch { return ''; }
}

const ORDRE: Categorie[] = ['web', 'actualites', 'images', 'videos', 'savoir'];
const adresse = (q: string, cat: Categorie, p = 1, mode?: string) => `/recherche?q=${encodeURIComponent(q)}${cat !== 'web' ? `&cat=${cat}` : ''}${p > 1 ? `&p=${p}` : ''}${mode ? `&mode=${mode}` : ''}`;
const vignette = (u: string) => `/api/recherche/vignette?u=${encodeURIComponent(u)}`;
const heure = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
function date(t: string | undefined): string {
  if (!t) return '';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t.slice(0, 40) : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** La page complète. */
export function pageListe(r: ReponseLyncee, o: { q: string; cat: Categorie; p: number }): string {
  const { q, cat, p } = o;
  const onglets = ORDRE.map((c) => `<a href="${esc(adresse(q, c))}"${c === cat ? ' aria-current="page"' : ''}>${esc(CATEGORIES[c].label)}</a>`).join('');
  let corps = '';
  if (cat === 'images') {
    corps = `<div class="grille">${r.resultats.map((x) => {
      const h = lienSur(x.url), t = lienSur(x.thumb); if (!h || !t) return '';
      return `<a class="img card" href="${esc(h)}" rel="noopener noreferrer"><img src="${esc(vignette(t))}" loading="lazy" alt="${esc(x.title)}"><span>${esc(x.domain)}</span></a>`;
    }).join('')}</div>`;
  } else {
    corps = `<ol class="liste">${r.resultats.map((x) => {
      const h = lienSur(x.url); if (!h) return '';
      const t = cat === 'videos' ? lienSur(x.thumb) : '';
      const quand = cat === 'actualites' ? date(x.published) : '';
      return `<li class="res${t ? ' vid' : ''}">${t ? `<a class="mini" href="${esc(h)}" rel="noopener noreferrer"><img src="${esc(vignette(t))}" loading="lazy" alt=""></a>` : ''}<div><div class="dom">${esc(x.domain)}${quand ? ` · ${esc(quand)}` : ''}</div><a class="tit" href="${esc(h)}" rel="noopener noreferrer">${esc(x.title || x.domain)}</a>${x.snippet ? `<p>${esc(x.snippet)}</p>` : ''}<div class="vu">vu par ${esc(x.engines.join(', '))}</div></div></li>`;
    }).join('')}</ol>`;
  }
  const vide = !r.resultats.length ? `<div class="card vide"><b>Aucun résultat${r.erreurs.length || r.pauses.length ? ' pour l\'instant' : ''}.</b><p>Essaie d'autres mots, un autre onglet, ou demande à Pythie une réponse rédigée.</p></div>` : '';
  const pauses = r.pauses.map((m) => `<li>${esc(m.etiquette)} : ${m.etat === 'coupe' ? 'coupé dans les réglages de Pythie' : `en pause${m.jusqua ? ` jusqu'à ${esc(heure(m.jusqua))}` : ''}`}${m.raison ? ` (${esc(m.raison)})` : ''}</li>`).join('');
  const nav = [p > 1 ? `<a class="act" href="${esc(adresse(q, cat, p - 1))}">← Page précédente</a>` : '', r.suivante && p < 10 ? `<a class="act" href="${esc(adresse(q, cat, p + 1))}">Page suivante →</a>` : ''].join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0f1116"><meta name="referrer" content="no-referrer"><title>${esc(q)} · Odin</title><link rel="icon" href="/favicon.svg">${LIEN_RECHERCHE}
<style>${STYLE_COMMUN}
.page{max-width:980px;margin:0 auto;padding:14px 16px 40px;display:flex;flex-direction:column;gap:14px}
.haut{padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.ligne{display:flex;gap:10px;align-items:center}.marque{font-weight:600;font-size:18px;text-decoration:none;color:var(--text);flex:none}
form{display:flex;gap:8px;flex:1;min-width:0}form input[type=search]{flex:1;min-width:0;border:1px solid var(--line);background:var(--glass2);border-radius:14px;padding:10px 14px;font:inherit;color:inherit}
form button{border:0;background:var(--acc);color:#fff;border-radius:14px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer}
nav.onglets{display:flex;gap:2px;background:var(--glass2);border:1px solid var(--line);border-radius:14px;padding:3px;overflow-x:auto}nav.onglets a{border-radius:11px;padding:7px 14px;font-size:13.5px;color:var(--muted);text-decoration:none;white-space:nowrap}nav.onglets a[aria-current]{background:var(--glass);color:var(--text);font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.pythie{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.pythie .act.fort{background:var(--acc);color:#fff;border-color:transparent}
.liste{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.res{background:var(--glass);border:1px solid var(--line);border-radius:18px;padding:12px 16px;display:flex;gap:12px;min-width:0}.res>div{min-width:0;flex:1}
.dom{font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tit{font-size:16.5px;font-weight:600;color:var(--acc);text-decoration:none;overflow-wrap:anywhere}.tit:hover{text-decoration:underline}
.res p{margin:4px 0 0;font-size:14.5px;overflow-wrap:anywhere}.vu{font-size:12px;color:var(--muted);margin-top:4px}
.mini{flex:none;width:160px;max-width:38%}.mini img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:12px;background:var(--soft);display:block}
.grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}.img{display:flex;flex-direction:column;gap:4px;padding:6px;text-decoration:none;color:var(--muted);font-size:12px;border-radius:16px;min-width:0}.img img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;background:var(--soft)}.img span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vide{padding:16px 18px}.vide p{margin:6px 0 0;color:var(--muted)}
footer{padding:14px 16px;font-size:13.5px;color:var(--muted);display:flex;flex-direction:column;gap:8px}footer ul{margin:0;padding-left:20px}.nav{display:flex;gap:8px;flex-wrap:wrap}
@media (max-width:600px){.ligne{flex-wrap:wrap}form{flex-basis:100%}.mini{width:110px}}
</style></head><body><div class="page">
<header class="card haut"><div class="ligne"><a class="marque" href="/">Odin</a><form method="get" action="/recherche" role="search"><input type="search" name="q" value="${esc(q)}" maxlength="400" aria-label="Rechercher" autocomplete="off"><input type="hidden" name="cat" value="${esc(cat)}"><button type="submit">Chercher</button></form></div>
<nav class="onglets" aria-label="Catégories">${onglets}</nav>
<div class="pythie"><a class="act fort" href="${esc(adresse(q, 'web', 1, 'pythie'))}">Réponse rédigée par Pythie</a><span class="doux" style="font-size:13px;color:var(--muted)">Page ${p}${r.duCache ? ' · déjà cherché il y a peu' : ''}</span></div></header>
<main>${vide}${corps}</main>
<footer class="card"><div>Moteurs qui ont répondu : ${r.moteurs.length ? esc(r.moteurs.join(', ')) : 'aucun'} · recherche par Lyncée, le moteur de Pythie.</div>${pauses ? `<div>Moteurs en pause :<ul>${pauses}</ul></div>` : ''}${r.erreurs.length ? `<div>Problèmes :<ul>${r.erreurs.slice(0, 8).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}${nav ? `<div class="nav">${nav}</div>` : ''}<div class="nav"><a class="act" href="/recherche/navigateurs">Odin dans ton navigateur</a><a class="act" href="/recherche">Pythie</a></div></footer>
</div></body></html>`;
}
