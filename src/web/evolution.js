// Arbre d'évolution d'Odin, en système solaire : le soleil, c'est Odin (sa version) ; chaque planète est une
// appli ou une partie d'Odin, sur son orbite, avec ses lunes (ses dernières évolutions). Une planète touchée
// affiche toutes ses évolutions, datées (nouveautés, améliorations, corrections) ; la ligne du bas suit les
// versions dans l'ordre. Les données viennent de /api/evolutions (l'historique des mises à jour).
(() => {
  'use strict';
  if (window.OdinEvolution) return;
  const $ = (s, r = document) => r.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a = {}, ...kids) => { const n = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (v === undefined || v === null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); } for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k))); return n; };
  const sv = (t, a = {}, ...kids) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) { if (v === undefined || v === null) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, String(v)); } for (const k of kids) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k))); return n; };
  const fmt = (d) => { try { return new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };
  const COLORS = ['#4F9DDE', '#4CB782', '#E3833F', '#C46BD6', '#E6C04A', '#5BB8B0', '#E0607E', '#9C8CE0', '#7AA2C8', '#D9884A', '#6FC3E8', '#B7C35A', '#E07FB0', '#8E9BAA'];
  const KIND = { nouveauté: '★', amélioration: '▲', correction: '✓' };

  const css = `
.evo{position:fixed;inset:0;z-index:90;background:var(--bg,#0b0d12);display:flex;flex-direction:column;color:var(--ink,inherit)}
.evo-h{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}.evo-h h2{margin:0;font-size:19px;flex:1}
.evo-h .sub{font-size:13px;color:var(--muted)}
.evo-f{display:flex;gap:6px;flex-wrap:wrap}.evo-f button[aria-pressed="true"]{outline:2px solid var(--accent);outline-offset:1px}
.evo-x{width:40px;height:40px;border-radius:12px;border:1px solid var(--line);background:transparent;color:inherit;font-size:20px;cursor:pointer}
.evo-b{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,400px)}
.evo-sky{position:relative;min-height:0;overflow:hidden}.evo-sky svg{width:100%;height:100%;display:block}
.evo-sky .orb{fill:none;stroke:var(--line);stroke-dasharray:3 5}
.evo-sky .pl{cursor:pointer}.evo-sky .pl:focus{outline:none}.evo-sky .pl:focus-visible circle.core,.evo-sky .pl.on circle.core{stroke:var(--ink,#fff);stroke-width:3}
.evo-sky text{fill:var(--ink,#fff);font-size:13px;font-weight:500;paint-order:stroke;stroke:var(--bg,#000);stroke-width:4px;stroke-linejoin:round}.evo-sky text.n{fill:#fff;stroke:rgba(0,0,0,.35);stroke-width:2px;font-weight:700}.evo-sky .sunt,.evo-sky .sunv{fill:#3a2500;stroke:none}
.evo-sky .sunt{font-size:15px;font-weight:600}
@media (prefers-reduced-motion:no-preference){.evo-sky .spin{animation:evoSpin var(--d,120s) linear infinite;transform-origin:var(--cx) var(--cy)}@keyframes evoSpin{to{transform:rotate(360deg)}}.evo-sky:hover .spin,.evo-sky.stop .spin{animation-play-state:paused}}
.evo-side{border-left:1px solid var(--line);overflow:auto;padding:14px 16px}
.evo-side h3{margin:0 0 4px;font-size:17px}.evo-side .what{color:var(--muted);font-size:13px;margin:0 0 12px}
.evo-it{border-left:3px solid var(--c,var(--accent));padding:4px 0 8px 10px;margin:0 0 10px;overflow-wrap:anywhere}
.evo-it b{display:block}.evo-it small{color:var(--muted)}.evo-it ul{margin:4px 0 0;padding-left:18px;font-size:13.5px}
.evo-line{display:flex;gap:0;overflow-x:auto;padding:12px 18px 16px 24px;border-top:1px solid var(--line);scroll-snap-type:x proximity}
.evo-line>:first-child{margin-left:12px}.evo-v{flex:none;position:relative;min-width:150px;max-width:220px;padding:14px 12px 0 0;scroll-snap-align:start;background:none;border:0;color:inherit;text-align:left;cursor:pointer}
.evo-v::before{content:"";position:absolute;left:0;right:0;top:5px;height:2px;background:var(--line)}
.evo-v::after{content:"";position:absolute;left:0;top:0;width:12px;height:12px;border-radius:50%;background:var(--accent)}
.evo-v b{display:block;font-size:14px}.evo-v small{color:var(--muted);font-size:12px;display:block}.evo-v span{display:block;font-size:12.5px;margin-top:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
@media (max-width:860px){.evo-h{flex-wrap:wrap;padding:10px 12px;gap:8px}.evo-h>div:first-child{flex:1 1 calc(100% - 56px);order:1}.evo-x{order:2}.evo-f{order:3;flex:1 1 100%;flex-wrap:nowrap;overflow-x:auto}.evo-f .btn{flex:none}.evo-b{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(340px,52vh) auto;overflow:auto}.evo-sky text{font-size:20px}.evo-sky text.n{font-size:18px}.evo-side{border-left:0;border-top:1px solid var(--line);overflow:visible}.evo-line{padding:8px 12px 10px 18px}.evo-v{min-width:130px}}`;

  let root = null, data = null, filter = 'tout', sel = null, lastFocus = null;
  const items = () => (data?.evolutions || []).filter((e) => filter === 'tout' || e.kind === filter);
  const byId = () => new Map((data?.evolutions || []).map((e) => [e.id, e]));

  function sky() {
    const W = 1000, H = 760, cx = W / 2, cy = H / 2;
    const planets = (data.planets || []).filter((p) => p.items.some((id) => items().some((e) => e.id === id)));
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Système d'Odin : ${planets.length} planètes autour du soleil Odin ${data.sun.version}` });
    const defs = sv('defs', {}, sv('radialGradient', { id: 'evoSun' }, sv('stop', { offset: '0', 'stop-color': '#FFE3A0' }), sv('stop', { offset: '.6', 'stop-color': '#EDB03D' }), sv('stop', { offset: '1', 'stop-color': '#E19B1F', 'stop-opacity': '.85' })));
    svg.append(defs);
    // Orbites : deux anneaux pour que tout tienne, les planètes les plus riches au plus près du soleil
    const sorted = [...planets].sort((a, b) => b.count - a.count);
    const rings = [[0, Math.min(6, sorted.length), 200], [6, sorted.length, 330]];
    for (const [, , r] of rings) svg.append(sv('ellipse', { class: 'orb', cx, cy, rx: r * 1.15, ry: r }));
    sorted.forEach((p, i) => {
      const [a, b, r] = rings[i < 6 ? 0 : 1], n = Math.max(1, b - a), k = i - a;
      const ang = (k / n) * Math.PI * 2 - Math.PI / 2 + (i < 6 ? 0 : Math.PI / n);
      const x = cx + Math.cos(ang) * r * 1.15, y = cy + Math.sin(ang) * r;
      const mine = items().filter((e) => p.items.includes(e.id));
      const size = 14 + Math.min(26, Math.sqrt(mine.length) * 4);
      const color = COLORS[(data.planets.indexOf(p)) % COLORS.length];
      const g = sv('g', { class: `pl${sel === p.id ? ' on' : ''}`, tabindex: '0', role: 'button', 'aria-label': `${p.name} : ${mine.length} évolution${mine.length > 1 ? 's' : ''}, dernière le ${fmt(p.last)}`, onclick: () => pick(p.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(p.id); } } });
      // Lunes : les dernières évolutions de la planète, en ronde
      const moons = sv('g', { class: 'spin', style: `--cx:${x}px;--cy:${y}px;--d:${40 + i * 7}s` });
      mine.slice(0, 8).forEach((e, j, arr) => { const a2 = (j / arr.length) * Math.PI * 2; moons.append(sv('circle', { cx: x + Math.cos(a2) * (size + 12), cy: y + Math.sin(a2) * (size + 12), r: e.kind === 'nouveauté' ? 4.5 : 3, fill: color, opacity: e.kind === 'correction' ? '.55' : '.9' })); });
      g.append(sv('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: color, 'stroke-opacity': '.18', 'stroke-width': 1.5 }), moons,
        sv('circle', { class: 'core', cx: x, cy: y, r: size, fill: color }),
        sv('text', { x, y: y + size + 28, 'text-anchor': 'middle' }, p.name),
        sv('text', { x, y: y + 5, 'text-anchor': 'middle', class: 'n' }, String(mine.length)));
      svg.append(g);
    });
    const sun = sv('g', { class: 'pl', tabindex: '0', role: 'button', 'aria-label': `Odin ${data.sun.version} : toutes les évolutions`, onclick: () => pick(null), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(null); } } },
      sv('circle', { cx, cy, r: 70, fill: 'url(#evoSun)' }), sv('circle', { cx, cy, r: 92, fill: '#FFE3A0', opacity: '.12' }),
      sv('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', class: 'sunt' }, 'Odin'), sv('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', class: 'sunv' }, `v${data.sun.version}`));
    svg.append(sun);
    return svg;
  }

  function side() {
    const ids = byId();
    const p = sel ? data.planets.find((x) => x.id === sel) : null;
    const list = (p ? p.items.map((id) => ids.get(id)).filter(Boolean) : data.evolutions).filter((e) => filter === 'tout' || e.kind === filter);
    const color = p ? COLORS[data.planets.indexOf(p) % COLORS.length] : '';
    return [
      el('h3', {}, p ? p.name : `Odin ${data.sun.version}`),
      el('p', { class: 'what' }, p ? `${p.what} · ${list.length} évolution${list.length > 1 ? 's' : ''}` : `Toutes les mises à jour depuis le ${fmt(data.sun.since)} : ${list.length}. Touche une planète pour ne voir que la sienne.`),
      ...list.slice(0, 200).map((e) => el('div', { class: 'evo-it', style: color ? `--c:${color}` : '' },
        el('b', {}, `${KIND[e.kind] || ''} ${e.version ? `v${e.version} — ` : ''}${e.title}`),
        el('small', {}, `${fmt(e.date)} à ${String(e.at).slice(11, 16)} · ${e.kind}${p ? '' : ` · ${e.planets.map((x) => data.planets.find((y) => y.id === x)?.name).filter(Boolean).join(', ')}`}`),
        e.details.length ? el('ul', {}, ...e.details.slice(0, 8).map((d) => el('li', {}, d))) : null,
        el('button', { class: 'btn small', type: 'button', style: 'margin-top:6px', onclick: () => { close(); window.OdinGuide?.ask?.(`Explique-moi cette mise à jour du ${fmt(e.date)} et comment m'en servir : « ${e.title} »${e.details.length ? ` (${e.details.slice(0, 4).join(' ; ')})` : ''}`); } }, 'Odin, explique-moi'))),
    ];
  }
  function line() {
    return (data.versions || []).slice().reverse().map((v) => el('button', { class: 'evo-v', type: 'button', onclick: () => { sel = null; render(); const it = [...root.querySelectorAll('.evo-it b')].find((b) => b.textContent.includes(`v${v.version} —`)); it?.scrollIntoView({ block: 'start', behavior: 'smooth' }); } },
      el('b', {}, `v${v.version}`), el('small', {}, fmt(v.date)), el('span', {}, v.title)));
  }
  function render() {
    if (!root) return;
    $('.evo-sky', root).replaceChildren(sky());
    $('.evo-side', root).replaceChildren(...side());
    for (const b of root.querySelectorAll('.evo-f button')) b.setAttribute('aria-pressed', String(b.dataset.k === filter));
  }
  function pick(id) { sel = id; render(); $('.evo-side', root).scrollTop = 0; }

  async function open() {
    if (root) return;
    lastFocus = document.activeElement;
    if (!document.getElementById('evoCss')) document.head.append(el('style', { id: 'evoCss' }, css));
    root = el('div', { class: 'evo', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'evoTitle' },
      el('div', { class: 'evo-h' }, el('div', { style: 'flex:1;min-width:0' }, el('h2', { id: 'evoTitle' }, 'Arbre d\'évolution'), el('div', { class: 'sub', id: 'evoSub' }, 'Chargement…')),
        el('div', { class: 'evo-f', role: 'group', 'aria-label': 'Afficher' }, ...[['tout', 'Tout'], ['nouveauté', '★ Nouveautés'], ['amélioration', '▲ Améliorations'], ['correction', '✓ Corrections']].map(([k, l]) => el('button', { class: 'btn small', type: 'button', 'data-k': k, onclick: () => { filter = k; render(); } }, l))),
        el('button', { class: 'evo-x', type: 'button', 'aria-label': 'Fermer l\'arbre d\'évolution', onclick: close }, '×')),
      el('div', { class: 'evo-b' }, el('div', { class: 'evo-sky' }), el('div', { class: 'evo-side', tabindex: '0', 'aria-live': 'polite' })),
      el('nav', { class: 'evo-line', 'aria-label': 'Les versions, dans l\'ordre' }));
    document.body.append(root);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    $('.evo-x', root).focus();
    try { data = await (await fetch('/api/evolutions', { headers: { 'x-odin': '1' } })).json(); } catch { data = null; }
    if (!root) return;
    if (!data?.ok || !data.evolutions?.length) { $('.evo-side', root).replaceChildren(el('p', {}, 'Je n\'ai pas trouvé l\'historique des mises à jour.')); $('#evoSub').textContent = ''; return; }
    $('#evoSub').textContent = `Odin ${data.sun.version} · ${data.sun.total} évolutions depuis le ${fmt(data.sun.since)} · dernière mise à jour le ${fmt(data.evolutions[0].date)}`;
    $('.evo-line', root).replaceChildren(...line());
    render();
    // La ligne des versions s'ouvre sur les plus récentes
    requestAnimationFrame(() => { const l = $('.evo-line', root); if (l) l.scrollLeft = l.scrollWidth; });
  }
  function close() { root?.remove(); root = null; sel = null; filter = 'tout'; lastFocus?.focus?.({ preventScroll: true }); }
  window.OdinEvolution = { open, close };
})();
