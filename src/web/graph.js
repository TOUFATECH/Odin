// Graphe d'Odin, le même que celui du Cerveau, pour les Applis et la carte de la Maison : des points reliés,
// qu'on déplace, qu'on zoome et qu'on touche pour ouvrir. Chaque point peut porter des pastilles :
// rouge (alerte, problème, avec le nombre), orange (à surveiller), bleue (mise à jour / nouveauté) ;
// un point gris est hors ligne. Les points gardent leur place quand les données se rafraîchissent.
//   const g = OdinGraph.mount(boîte, { nodes, edges, onOpen, label })   puis   g.update({ nodes, edges })
//   node : { id, label, sub?, color?, hub?, size?, off?, alert?: { n, level: 'grave'|'attention' }, update?: n, title?, selected? }
//   edge : [a, b]  ou  { a, b, w?: épaisseur 0-6, arrow?: 'to'|'both', title?, color?, dash? } ; opts.onEdge(a, b) au clic sur un lien
//   node.ring : couleur d'un anneau (nouvel appareil, site dangereux…) ; node.square : carré (Odin, box, Internet)
(() => {
  'use strict';
  if (window.OdinGraph) return;
  const css = `
.og.og-dark{--ink:#E4E6EA;--panel:#1E1F22;--muted:#9AA0A8;--line:#33363b;--field:#3a3d43;background:#1E1F22;color:#E4E6EA}
.og{position:relative;height:min(68vh,640px);min-height:360px;border:1px solid var(--line);border-radius:16px;background:color-mix(in srgb,var(--panel) 70%,var(--bg));overflow:hidden;touch-action:none}
.og canvas{display:block;width:100%;height:100%;cursor:grab}.og canvas.drag{cursor:grabbing}.og canvas.on{cursor:pointer}
.og-bar{position:absolute;left:10px;top:10px;right:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;pointer-events:none}
.og-bar>*{pointer-events:auto}.og-bar input{flex:1 1 180px;max-width:280px;min-height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--field);background:var(--panel);color:inherit}
.og-bar .sub{font-size:12.5px;color:var(--muted);background:var(--panel);padding:4px 8px;border-radius:8px}
.og-z{position:absolute;right:10px;bottom:10px;display:flex;flex-direction:column;gap:6px}.og-z button{width:36px;height:36px;border-radius:10px;border:1px solid var(--field);background:var(--panel);color:inherit;font-size:18px;cursor:pointer}
.og-leg{position:absolute;left:10px;bottom:10px;display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--muted);background:color-mix(in srgb,var(--panel) 85%,transparent);padding:5px 9px;border-radius:9px}
.og-leg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.og-alt{margin-top:8px}.og-alt summary{cursor:pointer;min-height:36px;display:flex;align-items:center;color:var(--muted);font-size:14px}
.og-alt ul{columns:2 220px;margin:6px 0 0;padding-left:18px}.og-alt li.og-ic{list-style:none;display:flex;gap:8px;align-items:flex-start;break-inside:avoid;margin:0 0 8px -18px}.og-alt li.og-ic>.og-li-ic{flex:none;border-radius:7px}.og-what{color:var(--muted);font-size:13px}.og-alt button{border:0;background:none;color:inherit;text-decoration:underline;padding:2px 0;cursor:pointer;text-align:left}
.og-card{position:absolute;z-index:5;width:min(330px,calc(100% - 20px));pointer-events:none;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.4);padding:12px 14px;display:grid;gap:8px;font-size:13px;line-height:1.45;opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s}
.og-card.on{opacity:1;transform:none}.og-card[hidden]{display:none}
@media (max-width:860px){.og{height:62vh}.og-leg{display:none}}`;
  const RED = '#EE6A55', ORANGE = '#F0A040', BLUE = '#4F9DDE', GREEN = '#57C98A';
  const el = (t, a = {}, ...kids) => { const n = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); } for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k))); return n; };
  const cssVar = (n, d, at = document.documentElement) => getComputedStyle(at).getPropertyValue(n).trim() || d;

  function mount(host, opts) {
    if (!document.getElementById('ogCss')) document.head.append(el('style', { id: 'ogCss' }, css));
    const cv = el('canvas', { role: 'img', 'aria-label': opts.label || 'Graphe' });
    const q = el('input', { type: 'search', placeholder: opts.search || 'Chercher…', 'aria-label': opts.search || 'Chercher dans le graphe' });
    const count = el('span', { class: 'sub' });
    const legend = opts.legend || [[RED, 'alerte / problème'], [ORANGE, 'à surveiller'], [BLUE, 'mise à jour'], ['#7d8791', 'hors ligne']];
    const leg = el('div', { class: 'og-leg', 'aria-hidden': 'true' }, ...legend.map(([c, l]) => el('span', {}, el('i', { style: `background:${c}` }), l)));
    const zb = (t, l, f) => el('button', { type: 'button', 'aria-label': l, onclick: f }, t);
    const box = el('div', { class: `og${opts.dark ? ' og-dark' : ''}` }, cv, el('div', { class: 'og-bar' }, q, count), leg, el('div', { class: 'og-z' }, zb('+', 'Zoomer', () => zoom(1.25)), zb('−', 'Dézoomer', () => zoom(0.8)), zb('⤢', 'Tout voir', () => fit())));
    const alt = el('details', { class: 'og-alt' }, el('summary', {}, 'Voir le graphe en liste'), el('ul', {}));
    const card = el('div', { class: 'og-card', hidden: true, 'aria-hidden': 'true' }); box.append(card);
    host.replaceChildren(box, alt);
    const ctx = cv.getContext('2d');
    let hoverEdge = null; let nodes = [], edges = [], byId = new Map(), view = { x: 0, y: 0, k: 1 }, hover = null, drag = null, pan = null, heat = 1, raf = 0, fitted = false, query = '';
    const pos = new Map(); // id → {x, y} gardé entre deux mises à jour

    function setData(d) {
      const old = byId;
      nodes = d.nodes.map((n) => { const o = old.get(n.id) || pos.get(n.id); const a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 200; return { ...n, img: n.icon && window.OdinAppIcons?.image ? window.OdinAppIcons.image(n.icon, n.label, () => draw()) : undefined, x: o ? o.x : Math.cos(a) * r, y: o ? o.y : Math.sin(a) * r, vx: 0, vy: 0, fixed: o?.fixed || false }; });
      byId = new Map(nodes.map((n) => [n.id, n]));
      edges = d.edges.map((e) => (Array.isArray(e) ? { a: e[0], b: e[1] } : e)).filter((e) => byId.has(e.a) && byId.has(e.b) && e.a !== e.b).map((e) => Object.assign([byId.get(e.a), byId.get(e.b)], { w: e.w || 0, arrow: e.arrow || '', title: e.title || '', color: e.color || '', dash: Boolean(e.dash) }));
      opts.onEdge = d.onEdge ?? opts.onEdge; opts.onOpen = d.onOpen ?? opts.onOpen; opts.counter = d.counter ?? opts.counter;
      for (const n of nodes) n.deg = 0;
      for (const [a, b] of edges) { a.deg++; b.deg++; }
      const fresh = nodes.some((n) => !old.has(n.id) && !pos.has(n.id));
      heat = Math.max(heat, fresh ? 1 : 0.15);
      count.textContent = opts.counter ? opts.counter(nodes, edges) : `${nodes.length} points · ${edges.length} liens`;
      alt.lastChild.replaceChildren(...nodes.filter((n) => !n.hub).sort((a, b) => a.label.localeCompare(b.label, 'fr')).map((n) => el('li', { class: n.icon ? 'og-ic' : null }, n.icon && window.OdinAppIcons?.image ? el('img', { src: window.OdinAppIcons.image(n.icon, n.label).src, width: 26, height: 26, alt: '', class: 'og-li-ic' }) : '', el('button', { type: 'button', onclick: () => opts.onOpen?.(n.id) }, n.label), n.what ? el('span', { class: 'og-what' }, ` — ${n.what}`) : '', n.alert?.n ? ` · ${n.alert.n} alerte(s)` : '', n.update ? ` · ${n.update} nouveauté(s)` : '', n.off ? ' · hors ligne' : '')));
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
    /** Pointe de flèche au bord du point d'arrivée (le sens de la communication). */
    function arrowHead(a, b, color, w = 0) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, r = radius(b) + 3, L = (9 + w * 1.5) / Math.sqrt(view.k), W = L * 0.55;
      const tx = b.x - ux * r, ty = b.y - uy * r;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - ux * L - uy * W, ty - uy * L + ux * W); ctx.lineTo(tx - ux * L + uy * W, ty - uy * L - ux * W); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    }
    function dot(x, y, r, c, ring) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); if (ring) { ctx.lineWidth = 2 / view.k; ctx.strokeStyle = ring; ctx.stroke(); } }
    function draw() {
      const { w, h, dpr } = size(); if (!w) return;
      // Couleurs lues sur la boîte du graphe : un graphe « sombre » (comme le Cerveau) garde son fond sombre dans le thème clair.
      const ink = cssVar('--ink', '#E6ECEF', box), bg = cssVar('--panel', '#172533', box), line = cssVar('--muted', '#A9B8C4', box);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + view.x, h / 2 + view.y); ctx.scale(view.k, view.k);
      const focus = hover ? neighbours(hover) : null;
      const match = (n) => !query || `${n.label} ${n.sub || ''} ${n.search || ''}`.toLowerCase().includes(query);
      ctx.lineWidth = 1 / view.k;
      for (const e of edges) {
        const [a, b] = e, on = focus ? focus.has(a) && focus.has(b) : true, lit = e === hoverEdge;
        ctx.globalAlpha = lit ? 1 : on ? (focus ? 0.85 : e.arrow ? 0.55 : 0.28) : 0.05; ctx.strokeStyle = lit ? ink : e.color || (focus && on ? ink : line);
        ctx.lineWidth = (1 + (e.w || 0) + (lit ? 1.5 : 0)) / view.k;
        if (e.dash) ctx.setLineDash([6 / view.k, 5 / view.k]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        if (e.dash) ctx.setLineDash([]);
        if (e.arrow) { arrowHead(a, b, ctx.strokeStyle, e.w); if (e.arrow === 'both') arrowHead(b, a, ctx.strokeStyle, e.w); }
      }
      ctx.lineWidth = 1 / view.k;
      ctx.globalAlpha = 1;
      for (const n of nodes) {
        const r = radius(n), dim = (focus && !focus.has(n)) || !match(n);
        ctx.globalAlpha = dim ? 0.18 : 1;
        if (query && match(n)) dot(n.x, n.y, r + 6, 'transparent', GREEN);
        if (n.selected) { dot(n.x, n.y, r + 8, 'transparent', BLUE); dot(n.x, n.y, r + 11, 'transparent', BLUE); }
        if (n.ring) { dot(n.x, n.y, r + 5, 'transparent', n.ring); dot(n.x, n.y, r + 6.5, 'transparent', n.ring); }
        if (n.square) { const c = n.off ? '#7d8791' : n.color || BLUE; ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(n.x - r, n.y - r, r * 2, r * 2, r * 0.3) : ctx.rect(n.x - r, n.y - r, r * 2, r * 2); ctx.fill(); if (n === hover) { ctx.lineWidth = 2 / view.k; ctx.strokeStyle = ink; ctx.stroke(); } }
        else if (n.img && n.img.complete && n.img.naturalWidth) { const s = r * 2, rr = r * 0.46; ctx.save(); if (n.off) ctx.filter = 'grayscale(1) brightness(.75)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(n.x - r, n.y - r, s, s, rr) : ctx.rect(n.x - r, n.y - r, s, s); ctx.closePath(); ctx.save(); ctx.clip(); ctx.drawImage(n.img, n.x - r, n.y - r, s, s); ctx.restore(); ctx.filter = 'none'; if (n === hover) { ctx.lineWidth = 2.5 / view.k; ctx.strokeStyle = ink; ctx.stroke(); } ctx.restore(); }
        else dot(n.x, n.y, r, n.off ? '#7d8791' : n.color || (n.hub ? GREEN : '#E8EAEC'), n === hover ? ink : null);
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
    const pickEdge = (p) => { let best = null, bd = Infinity; for (const e of edges) { const [a, b] = e, dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)), d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)); if (d < (5 + (e.w || 0)) / view.k && d < bd) { bd = d; best = e; } } return best; };
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
      const p = at(e), n = pick(p), ed = n || !opts.onEdge ? null : pickEdge(p);
      if (n !== hover || ed !== hoverEdge) { hover = n; hoverEdge = ed; cv.classList.toggle('on', !!(n || ed)); const c = n && opts.card ? opts.card(n) : null; cv.title = c ? '' : n ? (n.title || n.label) : ed ? (ed.title || `${ed[0].label} → ${ed[1].label}`) : ''; showCard(n, c); draw(); }
    });
    const up = (e) => {
      touches.delete(e.pointerId); if (touches.size < 2) pinch = null;
      if (drag && !drag.moved) { drag.n.fixed = false; opts.onOpen?.(drag.n.id); }
      if (pan && !pan.moved) { const ed = opts.onEdge && pickEdge(at(e)); if (ed) opts.onEdge(ed[0].id, ed[1].id); else { hover = null; draw(); } }
      drag = pan = null; cv.classList.remove('drag');
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (!drag && !pan) { hover = null; showCard(null); draw(); } });
    /** La fiche de l'appli survolée, posée à côté du point (du côté où il y a de la place). */
    function showCard(n, c) {
      if (!n || !c) { card.classList.remove('on'); card.hidden = true; return; }
      card.replaceChildren(c); card.hidden = false;
      const { w, h } = size(), sx = w / 2 + view.x + n.x * view.k, sy = h / 2 + view.y + n.y * view.k, r = radius(n) * view.k, cw = card.offsetWidth, ch = card.offsetHeight;
      let x = sx + r + 14; if (x + cw > w - 8) x = sx - r - 14 - cw; x = Math.max(8, Math.min(w - cw - 8, x));
      const y = Math.max(8, Math.min(h - ch - 8, sy - ch / 2));
      card.style.left = `${x}px`; card.style.top = `${y}px`; requestAnimationFrame(() => card.classList.add('on'));
    }
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
