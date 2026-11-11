// Graphe d'Odin, le même que celui du Cerveau, pour les Applis et la carte de la Maison : des points reliés,
// qu'on déplace, qu'on zoome et qu'on touche pour ouvrir. Chaque point peut porter des pastilles :
// rouge (alerte, problème, avec le nombre), orange (à surveiller), bleue (mise à jour / nouveauté) ;
// un point gris est hors ligne. Les points gardent leur place quand les données se rafraîchissent.
//   const g = OdinGraph.mount(boîte, { nodes, edges, onOpen, label })   puis   g.update({ nodes, edges })
//   node : { id, label, sub?, color?, hub?, size?, off?, alert?: { n, level: 'grave'|'attention' }, update?: n, title? }
(() => {
  'use strict';
  if (window.OdinGraph) return;
  const css = `
.og{position:relative;height:min(68vh,640px);min-height:360px;border:1px solid var(--line);border-radius:16px;background:color-mix(in srgb,var(--panel) 70%,var(--bg));overflow:hidden;touch-action:none}
.og canvas{display:block;width:100%;height:100%;cursor:grab}.og canvas.drag{cursor:grabbing}.og canvas.on{cursor:pointer}
.og-bar{position:absolute;left:10px;top:10px;right:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;pointer-events:none}
.og-bar>*{pointer-events:auto}.og-bar input{flex:1 1 180px;max-width:280px;min-height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--field);background:var(--panel);color:inherit}
.og-bar .sub{font-size:12.5px;color:var(--muted);background:var(--panel);padding:4px 8px;border-radius:8px}
.og-z{position:absolute;right:10px;bottom:10px;display:flex;flex-direction:column;gap:6px}.og-z button{width:36px;height:36px;border-radius:10px;border:1px solid var(--field);background:var(--panel);color:inherit;font-size:18px;cursor:pointer}
.og-leg{position:absolute;left:10px;bottom:10px;display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--muted);background:color-mix(in srgb,var(--panel) 85%,transparent);padding:5px 9px;border-radius:9px}
.og-leg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.og-alt{margin-top:8px}.og-alt summary{cursor:pointer;min-height:36px;display:flex;align-items:center;color:var(--muted);font-size:14px}
.og-alt ul{columns:2 220px;margin:6px 0 0;padding-left:18px}.og-alt button{border:0;background:none;color:inherit;text-decoration:underline;padding:2px 0;cursor:pointer;text-align:left}
@media (max-width:860px){.og{height:62vh}.og-leg{display:none}}`;
  const RED = '#EE6A55', ORANGE = '#F0A040', BLUE = '#4F9DDE', GREEN = '#57C98A';
  const el = (t, a = {}, ...kids) => { const n = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); } for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k))); return n; };
  const cssVar = (n, d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;

  function mount(host, opts) {
    if (!document.getElementById('ogCss')) document.head.append(el('style', { id: 'ogCss' }, css));
    const cv = el('canvas', { role: 'img', 'aria-label': opts.label || 'Graphe' });
    const q = el('input', { type: 'search', placeholder: opts.search || 'Chercher…', 'aria-label': opts.search || 'Chercher dans le graphe' });
    const count = el('span', { class: 'sub' });
    const leg = el('div', { class: 'og-leg', 'aria-hidden': 'true' }, el('span', {}, el('i', { style: `background:${RED}` }), 'alerte / problème'), el('span', {}, el('i', { style: `background:${ORANGE}` }), 'à surveiller'), el('span', {}, el('i', { style: `background:${BLUE}` }), 'mise à jour'), el('span', {}, el('i', { style: 'background:#7d8791' }), 'hors ligne'));
    const zb = (t, l, f) => el('button', { type: 'button', 'aria-label': l, onclick: f }, t);
    const box = el('div', { class: 'og' }, cv, el('div', { class: 'og-bar' }, q, count), leg, el('div', { class: 'og-z' }, zb('+', 'Zoomer', () => zoom(1.25)), zb('−', 'Dézoomer', () => zoom(0.8)), zb('⤢', 'Tout voir', () => fit())));
    const alt = el('details', { class: 'og-alt' }, el('summary', {}, 'Voir le graphe en liste'), el('ul', {}));
    host.replaceChildren(box, alt);
    const ctx = cv.getContext('2d');
    let nodes = [], edges = [], byId = new Map(), view = { x: 0, y: 0, k: 1 }, hover = null, drag = null, pan = null, heat = 1, raf = 0, fitted = false, query = '';
    const pos = new Map(); // id → {x, y} gardé entre deux mises à jour

    function setData(d) {
      const old = byId;
      nodes = d.nodes.map((n) => { const o = old.get(n.id) || pos.get(n.id); const a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 200; return { ...n, x: o ? o.x : Math.cos(a) * r, y: o ? o.y : Math.sin(a) * r, vx: 0, vy: 0, fixed: o?.fixed || false }; });
      byId = new Map(nodes.map((n) => [n.id, n]));
      edges = d.edges.filter(([a, b]) => byId.has(a) && byId.has(b) && a !== b).map(([a, b]) => [byId.get(a), byId.get(b)]);
      for (const n of nodes) n.deg = 0;
      for (const [a, b] of edges) { a.deg++; b.deg++; }
      const fresh = nodes.some((n) => !old.has(n.id) && !pos.has(n.id));
      heat = Math.max(heat, fresh ? 1 : 0.15);
      count.textContent = opts.counter ? opts.counter(nodes, edges) : `${nodes.length} points · ${edges.length} liens`;
      alt.lastChild.replaceChildren(...nodes.filter((n) => !n.hub).sort((a, b) => a.label.localeCompare(b.label, 'fr')).map((n) => el('li', {}, el('button', { type: 'button', onclick: () => opts.onOpen?.(n.id) }, n.label), n.alert?.n ? ` · ${n.alert.n} alerte(s)` : '', n.update ? ` · ${n.update} nouveauté(s)` : '', n.off ? ' · hors ligne' : '')));
      kick();
    }
    const radius = (n) => (n.size || (n.hub ? 15 : 9 + Math.min(10, Math.sqrt(n.deg || 0) * 2.4)));

    // ---------- Forces ----------
    function step() {
      const N = nodes.length;
      for (let i = 0; i < N; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < N; j++) {
          const b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy || 0.01;
          if (d2 > 640000) continue;
          const f = 5200 / d2, d = Math.sqrt(d2); dx /= d; dy /= d;
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        }
      }
      for (const [a, b] of edges) {
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, want = a.hub && b.hub ? 170 : a.hub || b.hub ? 120 : 160, f = (d - want) * 0.012;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      for (const n of nodes) {
        n.vx -= n.x * 0.004; n.vy -= n.y * 0.004;
        if (n.fixed || n === drag?.n) { n.vx = n.vy = 0; continue; }
        n.vx *= 0.82; n.vy *= 0.82;
        const lim = 30 * heat + 2; n.x += Math.max(-lim, Math.min(lim, n.vx * heat)); n.y += Math.max(-lim, Math.min(lim, n.vy * heat));
        pos.set(n.id, { x: n.x, y: n.y, fixed: n.fixed });
      }
      heat *= 0.985;
    }
    function kick() { if (!raf) raf = requestAnimationFrame(loop); }
    function loop() {
      raf = 0;
      if (!box.isConnected) return;
      if (heat > 0.02) { for (let i = 0; i < 2; i++) step(); }
      if (!fitted && heat < 0.4 && nodes.length) { fit(); fitted = true; }
      draw();
      if (heat > 0.02 || drag) raf = requestAnimationFrame(loop);
    }

    // ---------- Dessin ----------
    function size() { const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); } return { w: r.width, h: r.height, dpr }; }
    const neighbours = (n) => { const s = new Set([n]); for (const [a, b] of edges) { if (a === n) s.add(b); if (b === n) s.add(a); } return s; };
    function dot(x, y, r, c, ring) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); if (ring) { ctx.lineWidth = 2 / view.k; ctx.strokeStyle = ring; ctx.stroke(); } }
    function draw() {
      const { w, h, dpr } = size(); if (!w) return;
      const ink = cssVar('--ink', '#E6ECEF'), bg = cssVar('--panel', '#172533'), line = cssVar('--muted', '#A9B8C4');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + view.x, h / 2 + view.y); ctx.scale(view.k, view.k);
      const focus = hover ? neighbours(hover) : null;
      const match = (n) => !query || `${n.label} ${n.sub || ''} ${n.search || ''}`.toLowerCase().includes(query);
      ctx.lineWidth = 1 / view.k;
      for (const [a, b] of edges) {
        const on = focus ? focus.has(a) && focus.has(b) : true;
        ctx.globalAlpha = on ? (focus ? 0.8 : 0.28) : 0.05; ctx.strokeStyle = focus && on ? ink : line;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const n of nodes) {
        const r = radius(n), dim = (focus && !focus.has(n)) || !match(n);
        ctx.globalAlpha = dim ? 0.18 : 1;
        if (query && match(n)) dot(n.x, n.y, r + 6, 'transparent', GREEN);
        dot(n.x, n.y, r, n.off ? '#7d8791' : n.color || (n.hub ? GREEN : '#E8EAEC'), n === hover ? ink : null);
        // Pastilles : alerte (rouge / orange, avec le nombre), mise à jour (bleue), hors ligne (point gris)
        let bx = n.x + r * 0.72, by = n.y - r * 0.72;
        if (n.alert?.n) { const c = n.alert.level === 'grave' ? RED : ORANGE, br = 7.5; dot(bx, by, br, c, bg); ctx.fillStyle = '#fff'; ctx.font = `700 ${9.5}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n.alert.n > 99 ? '99+' : String(n.alert.n), bx, by + 0.5); bx -= 15; }
        if (n.update) { dot(bx, by, 5.5, BLUE, bg); bx -= 12; }
        // Nom (et sous-titre) sous le point, lisible sur le fond
        const big = n.hub || n === hover || view.k > 0.9 || (n.alert?.n);
        if (big || view.k > 0.55) {
          ctx.font = `${n.hub ? 600 : 500} ${n.hub ? 13 : 12}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.lineWidth = 4 / view.k; ctx.strokeStyle = bg; ctx.strokeText(n.label, n.x, n.y + r + 4); ctx.fillStyle = ink; ctx.fillText(n.label, n.x, n.y + r + 4);
          if (n.sub && (n === hover || view.k > 1.3)) { ctx.font = '11px ui-monospace,monospace'; ctx.strokeText(n.sub, n.x, n.y + r + 19); ctx.fillStyle = line; ctx.fillText(n.sub, n.x, n.y + r + 19); }
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---------- Gestes ----------
    const at = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - r.width / 2 - view.x) / view.k, y: (e.clientY - r.top - r.height / 2 - view.y) / view.k }; };
    const pick = (p) => { let best = null, bd = Infinity; for (const n of nodes) { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < radius(n) + 6 / view.k && d < bd) { bd = d; best = n; } } return best; };
    const touches = new Map(); let pinch = null;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId); touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k }; drag = pan = null; return; }
      const n = pick(at(e));
      if (n) { drag = { n, sx: e.clientX, sy: e.clientY, moved: false }; heat = Math.max(heat, 0.3); kick(); } else pan = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
      cv.classList.add('drag');
    });
    cv.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size === 2) { const [a, b] = [...touches.values()]; view.k = Math.min(4, Math.max(0.2, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)); draw(); return; }
      if (drag) { const p = at(e); if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true; drag.n.x = p.x; drag.n.y = p.y; drag.n.fixed = true; pos.set(drag.n.id, { x: p.x, y: p.y, fixed: true }); heat = Math.max(heat, 0.25); kick(); return; }
      if (pan) { if (Math.hypot(e.clientX - pan.sx, e.clientY - pan.sy) > 4) pan.moved = true; view.x = pan.vx + e.clientX - pan.sx; view.y = pan.vy + e.clientY - pan.sy; draw(); return; }
      const n = pick(at(e)); if (n !== hover) { hover = n; cv.classList.toggle('on', !!n); cv.title = n ? (n.title || n.label) : ''; draw(); }
    });
    const up = (e) => {
      touches.delete(e.pointerId); if (touches.size < 2) pinch = null;
      if (drag && !drag.moved) { drag.n.fixed = false; opts.onOpen?.(drag.n.id); }
      if (pan && !pan.moved) { hover = null; draw(); }
      drag = pan = null; cv.classList.remove('drag');
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (!drag && !pan) { hover = null; draw(); } });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2, k2 = Math.min(4, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); view.x = mx - ((mx - view.x) * k2) / view.k; view.y = my - ((my - view.y) * k2) / view.k; view.k = k2; draw(); }, { passive: false });
    function zoom(f) { view.k = Math.min(4, Math.max(0.2, view.k * f)); view.x *= f; view.y *= f; draw(); }
    function fit() {
      if (!nodes.length) return; const { w, h } = size(); if (!w) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
      const k = Math.min(2, Math.max(0.25, Math.min((w - 60) / (x1 - x0 + 80), (h - 90) / (y1 - y0 + 100))));
      view = { k, x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k + 14 }; draw();
    }
    q.addEventListener('input', () => { query = q.value.trim().toLowerCase(); draw(); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const n = nodes.find((x) => !x.hub && `${x.label} ${x.sub || ''} ${x.search || ''}`.toLowerCase().includes(query)); if (n) opts.onOpen?.(n.id); } });
    new ResizeObserver(() => draw()).observe(box);
    setData(opts);
    return { update: setData, fit, el: box };
  }
  window.OdinGraph = { mount };
})();
