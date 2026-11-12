// Les pouvoirs d'Odin (maquettes validées) : 36 pouvoirs, chacun détruit ou fait apparaître un élément avec sa
// propre matière. Feu : il prend feu et brûle de bas en haut (flammes, braises, fumée). Foudre : arcs électriques
// puis explosion. Glace : il se congèle, la glace craque puis explose. Lumière : il se désintègre en particules.
// Sable : il s'efface en grains et part en fumée. Vent : il tourne et zigzague jusqu'à disparaître. Etc.
// Quand : un onglet ou une fenêtre s'ouvre ou se ferme, tu supprimes quelque chose (et, en option, un petit éclat
// là où tu cliques). Partout : l'interface d'Odin, l'écran de la maison (Glaðsheimr), ordinateur, téléphone.
// Règles : désactivés au départ ; coupés = plus rien et l'animation en cours s'arrête ; jamais pendant une vidéo,
// ni si l'appareil demande moins d'animations. Un pouvoir ne supprime rien : l'élément est déjà fermé, le pouvoir
// joue sur une copie (un « fantôme ») et ne retarde rien.
(() => {
  'use strict';
  if (window.OdinPowers) return;
  const reduce = matchMedia('(prefers-reduced-motion:reduce)');
  const DEF = { actif: false, quand: { ouvre: true, ferme: true, supprime: true, fenetre: true, clic: false }, choix: 'favoris', favoris: ['feu', 'foudre', 'glace', 'lumiere'], force: 'normale', son: false, pouvoir: undefined };
  let cfg = { ...DEF, quand: { ...DEF.quand } };
  try { const c = JSON.parse(localStorage.getItem('odin.pouvoirs') || 'null'); if (c && typeof c === 'object') cfg = { ...cfg, ...c, quand: { ...DEF.quand, ...(c.quand || {}) } }; } catch { /* */ }
  const R = (a, b) => a + Math.random() * (b - a), Ri = (a, b) => Math.round(R(a, b)), pick = (l) => l[Math.floor(Math.random() * l.length)];
  const GOLD = ['#fff3c0', '#ffd36a', '#ffffff', '#ffe9a0'];
  // ---------------------------------------------------------------- les 36 pouvoirs
  // kit : façon de détruire ; shot : ce qu'Odin lance ; c : couleur ; extra : décor du pouvoir autour de l'élément
  const P = {
    feu: { name: 'Boule de feu', c: '#ff7a1a', kit: 'engulf', shot: 'none', appear: 'fire' },
    jet: { name: 'Rayon de feu', c: '#ff8a1a', kit: 'beam', shot: 'none', appear: 'fire' },
    lave: { name: 'Lave', c: '#ff5a00', kit: 'melt', shot: 'lava', drip: '#ff8a1a', fx: 'sepia(1) saturate(6) hue-rotate(-30deg) brightness(1.2)', appear: 'fire' },
    meteores: { name: 'Météores', c: '#ff6a1a', kit: 'meteor', many: true, shot: 'none', appear: 'fire' },
    comete: { name: 'Comète', c: '#ff9a2a', kit: 'meteor', shot: 'none', appear: 'light', pc: ['#fff3c0', '#ffd36a', '#ff7a1a'] },
    vague: { name: 'Vague', c: '#3d9cf0', kit: 'wash', shot: 'wave', appear: 'light', pc: ['#bfe6ff', '#3d9cf0', '#ffffff'] },
    bulles: { name: 'Bulles', c: '#7fd4ff', kit: 'lift', shot: 'bubbles', appear: 'light', pc: ['#bfe9ff', '#7fd4ff'] },
    glace: { name: 'Glace', c: '#7fd4ff', kit: 'ice', shot: 'shards', appear: 'ice' },
    blizzard: { name: 'Blizzard', c: '#cfeeff', kit: 'ice', shot: 'snow', appear: 'ice' },
    rochers: { name: 'Rochers', c: '#b08a5a', kit: 'crush', shot: 'rocks', appear: 'light', pc: ['#c3a27a', '#8a7058'] },
    seisme: { name: 'Séisme', c: '#ffb35a', kit: 'fall', shot: 'quake', appear: 'light', pc: ['#ffb35a', '#8a7058'] },
    sable: { name: 'Tempête de sable', c: '#e0b870', kit: 'dis', shot: 'sand', dir: 'h', pc: ['#e0b870', '#c79a52', '#f2d49a'], dx: [24, 50], dy: [-8, 10], glow: 0, fx: 'sepia(1) saturate(1.6) brightness(1.1)', smoke: '#b8a284', appear: 'light' },
    cristaux: { name: 'Cristaux', c: '#b48cff', kit: 'pop', shot: 'crystals', shard: ['#6b46c8', '#e6d9ff'], appear: 'light', pc: ['#e6d9ff', '#b48cff'] },
    tornade: { name: 'Tornade', c: '#cfe3f0', kit: 'twist', shot: 'tornado', appear: 'light', pc: ['#ffffff', '#cfe3f0'] },
    rafale: { name: 'Rafale', c: '#e8f2ff', kit: 'zig', shot: 'wind', appear: 'light', pc: ['#ffffff', '#e8f2ff'] },
    foudre: { name: 'Foudre', c: '#f5d020', kit: 'zap', shot: 'bolt', appear: 'light', pc: ['#fffbe0', '#f5d020'] },
    orage: { name: 'Orage', c: '#9fb4ff', kit: 'zap', shot: 'storm', appear: 'light', pc: ['#dfe6ff', '#9fb4ff'] },
    etoiles: { name: 'Étoiles filantes', c: '#ffd36a', kit: 'dis', shot: 'stars', dir: 'h', pc: GOLD, dx: [-4, 18], dy: [-34, -12], fx: 'brightness(1.9) saturate(1.5)', appear: 'light' },
    soleil: { name: 'Rayon de soleil', c: '#ffe066', kit: 'dis', shot: 'sun', dir: 'v', pc: GOLD, dx: [-6, 6], dy: [-36, -16], fx: 'brightness(2.4) saturate(.6)', appear: 'light' },
    aurore: { name: 'Aurore boréale', c: '#3dffb0', kit: 'dis', shot: 'aurora', dir: 'h', pc: ['#3dffb0', '#7c4dff', '#3dd6ff', '#b8ffe6'], dx: [-6, 16], dy: [-34, -14], fx: 'hue-rotate(110deg) brightness(1.7)', appear: 'light' },
    trounoir: { name: 'Trou noir', c: '#9a6bff', kit: 'suck', shot: 'orb', appear: 'light', pc: ['#c9a8ff', '#9a6bff'] },
    lianes: { name: 'Lianes', c: '#4fc35a', kit: 'drag', shot: 'vines', appear: 'light', pc: ['#8fe08a', '#4fc35a'] },
    petales: { name: 'Pétales', c: '#ff9ac8', kit: 'dis', shot: 'petals', dir: 'h', pc: ['#ffc4dd', '#ff9ac8', '#ffe0ee', '#ffffff'], dx: [6, 28], dy: [6, 28], size: [5, 7], shape: '50% 0', glow: 0, rot: true, fx: 'hue-rotate(-40deg) brightness(1.5) saturate(1.5)', appear: 'light' },
    feuilles: { name: 'Feuilles d\'automne', c: '#ff9a3d', kit: 'zig', shot: 'leaves', appear: 'light', pc: ['#ff9a3d', '#e85d2a', '#f2c14a'] },
    poison: { name: 'Poison', c: '#8aff5a', kit: 'melt', shot: 'poison', drip: '#8aff5a', fx: 'hue-rotate(70deg) saturate(2.2) brightness(1.2)', appear: 'light', pc: ['#b8ff8a', '#8aff5a'] },
    laser: { name: 'Laser des yeux', c: '#ff2a2a', kit: 'halves', shot: 'laser', appear: 'light', pc: ['#ffd0d0', '#ff2a2a'] },
    runes: { name: 'Runes', c: '#ffd36a', kit: 'dis', shot: 'runes', dir: 'h', pc: GOLD, dx: [-6, 14], dy: [-30, -12], fx: 'sepia(1) saturate(4) brightness(1.7)', appear: 'light' },
    onde: { name: 'Onde de choc', c: '#9fd0ff', kit: 'pop', shot: 'ring', shard: ['#283044', '#b8dcff'], appear: 'light', pc: ['#dff0ff', '#9fd0ff'] },
    ombre: { name: 'Ombre', c: '#9a6bff', kit: 'dis', shot: 'veil', dir: 'h', pc: ['#2a1a4a', '#5b3fa8', '#140a24'], dx: [-4, 18], dy: [-30, -10], size: [3, 5], glow: 3, fx: 'brightness(.3) saturate(.4)', smoke: '#05030a', appear: 'light' },
    lumiere: { name: 'Lumière sacrée', c: '#ffe9a0', kit: 'dis', shot: 'column', dir: 'v', pc: GOLD, dx: [-6, 6], dy: [-44, -22], fx: 'brightness(2.6) saturate(.5)', appear: 'light' },
    pixels: { name: 'Pixels', c: '#5a6fdb', kit: 'pixelate', shot: 'pixels', dir: 'h', pc: ['#283044', '#3c4660', '#56617f', '#5a6fdb', '#8fa0ff'], dx: [-14, 30], dy: [-26, 20], size: [4, 6], shape: '0', glow: 0, steps: true, fx: 'contrast(1.4) brightness(1.2)', appear: 'light' },
    aimant: { name: 'Aimant', c: '#ff5a5a', kit: 'pull', shot: 'magnet', appear: 'light', pc: ['#ff9a9a', '#ff5a5a'] },
    gungnir: { name: 'Gungnir, la lance', c: '#ffd36a', kit: 'pop', shot: 'spear', shard: ['#283044', '#ffd36a'], appear: 'light', pc: GOLD },
    corbeaux: { name: 'Huginn et Muninn', c: '#c9d2e6', kit: 'carry', shot: 'ravens', appear: 'light', pc: ['#c9d2e6', '#ffffff'] },
    bifrost: { name: 'Bifröst', c: '#ff6ad5', kit: 'bif', shot: 'rainbow', appear: 'light', pc: ['#ff4a4a', '#ffe14a', '#4adf6a', '#4aa8ff', '#9a6bff'] },
    eclair: { name: 'Éclair', c: '#9fb4ff', kit: 'strike', shot: 'none', appear: 'strike', pc: ['#ffffff', '#e8f0ff', '#9fb4ff'] },
    teleport: { name: 'Téléportation', c: '#5fe6ff', kit: 'teleport', shot: 'none', appear: 'teleport', pc: ['#ffffff', '#bff8ff', '#5fe6ff'] },
    artifice: { name: 'Feu d\'artifice', c: '#ff6ad5', kit: 'confetti', shot: 'rocket', appear: 'light', pc: ['#ff4a4a', '#ffe14a', '#4adf6a', '#4aa8ff', '#ff6ad5'] },
  };
  const IDS = Object.keys(P);

  // ---------------------------------------------------------------- outils
  let layer = null; const live = new Set();
  function getLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div'); layer.id = 'odinPowers'; layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden;contain:strict';
    const st = document.createElement('style'); st.textContent = '@keyframes opFlick{from{transform:scaleY(1) skewX(-6deg)}to{transform:scaleY(1.3) skewX(6deg)}}#odinPowers *{box-sizing:border-box;pointer-events:none}';
    layer.append(st); document.body.append(layer); return layer;
  }
  function el(parent, css, html) { const d = document.createElement('div'); d.style.cssText = `position:absolute;${css}`; if (html) d.innerHTML = html; parent.append(d); return d; }
  function anim(node, frames, o) { const a = node.animate(frames, { fill: 'both', easing: 'ease-out', ...o }); live.add(a); a.finished.catch(() => {}).finally(() => live.delete(a)); return a; }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const F = () => ({ discrete: 0.6, normale: 1, spectaculaire: 1.5 }[cfg.force] ?? 1);
  const DUR = () => ({ discrete: 750, normale: 950, spectaculaire: 1300 }[cfg.force] ?? 950);
  function videoPlaying() { if (document.fullscreenElement) return true; for (const v of document.querySelectorAll('video')) if (!v.paused && !v.ended && v.readyState > 2) return true; return false; }
  const can = (when) => cfg.actif && (!when || cfg.quand?.[when] !== false) && !reduce.matches && !document.hidden && !videoPlaying();
  function choose() {
    if (cfg.pouvoir && P[cfg.pouvoir] && (cfg.choix === 'theme' || cfg.choix === 'meteo')) return cfg.pouvoir;
    if (cfg.choix === 'hasard') return pick(IDS);
    const f = (cfg.favoris || []).filter((x) => P[x]); return f.length ? pick(f) : pick(IDS);
  }
  // Le fantôme : une copie figée de l'élément, posée exactement à sa place, sur laquelle joue le pouvoir.
  function snapshot(src) {
    const r = src.getBoundingClientRect(); if (!r.width || !r.height) return null;
    let g;
    try {
      g = src.cloneNode(true); g.removeAttribute('id'); for (const x of g.querySelectorAll('[id]')) x.removeAttribute('id');
      const cs = getComputedStyle(src);
      for (const k of ['backgroundColor', 'backgroundImage', 'color', 'borderRadius', 'border', 'boxShadow', 'font', 'padding', 'display', 'flexDirection', 'alignItems', 'justifyContent', 'gap', 'textAlign', 'lineHeight', 'overflow']) g.style[k] = cs[k];
      if (cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.backgroundImage === 'none') g.style.backgroundColor = getComputedStyle(document.body).getPropertyValue('--panel') || 'rgba(40,48,68,.9)';
    } catch { g = document.createElement('div'); g.style.cssText = 'background:rgba(40,48,68,.9);border-radius:10px'; }
    return { rect: { x: r.left, y: r.top, w: r.width, h: r.height }, node: g, src };
  }
  function stage(snap) {
    const { x, y, w, h } = snap.rect, L = getLayer();
    const box = el(L, `left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:visible`);
    const g = snap.node; g.style.position = 'absolute'; g.style.left = '0'; g.style.top = '0'; g.style.width = `${w}px`; g.style.height = `${h}px`; g.style.margin = '0'; g.style.transformOrigin = '50% 50%'; g.style.zIndex = '1';
    box.append(g); return { box, g, w, h };
  }
  function mascotPoint() {
    const m = [...document.querySelectorAll('#buddyRoam, .odin.roam, .pet, .vn-odin-face, .odin')].find((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none' && !e.hidden);
    if (!m) return null; const r = m.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, el: m };
  }
  function castFrom(from) { if (!from?.el) return; window.OdinFace?.flash?.(from.el, 'excite', 1200); window.OdinCompanion?.act?.('act-joy', 900); }

  // ---------------------------------------------------------------- particules (canevas) : des milliers d'éclats, braises, poussières
  const PX = (() => {
    let cv = null, ctx = null, list = [], raf = 0, last = 0;
    function ensure() {
      const L = getLayer(); if (cv && cv.parentNode === L) return;
      cv = document.createElement('canvas'); cv.style.cssText = 'position:absolute;left:0;top:0;width:100vw;height:100vh;z-index:20'; L.append(cv); ctx = cv.getContext('2d'); size();
    }
    function size() { if (!cv) return; const d = Math.min(2, devicePixelRatio || 1); cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d); ctx.setTransform(d, 0, 0, d, 0, 0); }
    addEventListener('resize', size);
    function draw(p, k) {
      const a = Math.max(0, 1 - Math.max(0, (k - (p.hold ?? 0.35)) / (1 - (p.hold ?? 0.35)))) * (p.alpha ?? 1);
      if (a <= 0.01) return;
      ctx.globalAlpha = p.steps ? Math.round(a * 4) / 4 : a; ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over'; ctx.fillStyle = p.c; ctx.strokeStyle = p.c;
      switch (p.shape) {
        case 'shard': ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.beginPath(); ctx.moveTo(-p.s, -p.s * 0.35); ctx.lineTo(p.s * 0.55, -p.s * 0.7); ctx.lineTo(p.s * 0.85, p.s * 0.45); ctx.lineTo(-p.s * 0.35, p.s * 0.75); ctx.closePath(); ctx.fill(); if (p.edge) { ctx.strokeStyle = p.edge; ctx.lineWidth = 0.9; ctx.stroke(); } ctx.restore(); break;
        case 'spark': { const v = Math.hypot(p.vx, p.vy) || 1, l = Math.min(26, v * 0.035) + p.s; ctx.lineWidth = p.s; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - (p.vx / v) * l, p.y - (p.vy / v) * l); ctx.stroke(); break; }
        case 'square': ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); break;
        case 'smoke': { const r = p.s * (1 + k * 2.4), g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); g.addColorStop(0, p.c); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill(); break; }
        case 'petal': ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, 7); ctx.fill(); ctx.restore(); break;
        case 'flake': ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillRect(-p.s / 2, -p.s * 0.3, p.s, p.s * 0.6); ctx.restore(); break;
        default: ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 7); ctx.fill();
      }
    }
    function tick(t) {
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); const d = Math.min(2, devicePixelRatio || 1); ctx.setTransform(d, 0, 0, d, 0, 0);
      const keep = [];
      for (const p of list) {
        p.age += dt; if (p.age < 0) { keep.push(p); continue; }
        const k = p.age / p.life; if (k >= 1) continue; keep.push(p);
        const dr = Math.pow(p.drag ?? 0.985, dt * 60); p.vx = p.vx * dr + (p.ax ?? 0) * dt; p.vy = p.vy * dr + (p.g ?? 0) * dt;
        if (p.wob) p.vx += Math.sin((p.age + p.seed) * p.wob) * 30 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.r += (p.vr ?? 0) * dt;
        if (p.floor !== undefined && p.y > p.floor && p.vy > 0) { p.y = p.floor; p.vy *= -0.32; p.vx *= 0.7; p.vr = (p.vr ?? 0) * 0.5; }
        draw(p, k);
      }
      list = keep; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      if (list.length) raf = requestAnimationFrame(tick); else { raf = 0; last = 0; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); }
    }
    /** Ajoute des particules : chacune { x, y, vx, vy, g, life, s, c, shape, delay… } */
    function add(ps) { ensure(); for (const p of ps) list.push({ r: 0, vr: 0, seed: Math.random() * 9, ...p, age: -(p.delay ?? 0) }); if (!raf) { last = 0; raf = requestAnimationFrame(tick); } }
    function clear() { list = []; if (raf) cancelAnimationFrame(raf); raf = 0; cv = null; ctx = null; }
    return { add, clear };
  })();
  const Q = () => ({ discrete: 0.45, normale: 1, spectaculaire: 1.8 }[cfg.force] ?? 1);
  /** Les couleurs de l'élément (fond, bord, texte, enfants) : ses éclats lui ressemblent. */
  function colorsOf(src) {
    const out = new Set(), ok = (c) => c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c);
    try {
      for (const e of [src, ...[...src.querySelectorAll('*')].slice(0, 30)]) { const cs = getComputedStyle(e); if (ok(cs.backgroundColor)) out.add(cs.backgroundColor); if (e === src && ok(cs.borderTopColor)) out.add(cs.borderTopColor); if (e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) out.add(cs.color); }
    } catch { /* */ }
    const l = [...out]; return l.length ? l : ['#283044', '#3c4660', '#aab3c8'];
  }
  /** Fait voler l'élément en éclats (n morceaux, à partir du point d'impact). */
  function shatter(rect, n, colors, o = {}) {
    const ps = [], at = o.at ?? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, k = Math.max(0.8, Math.min(2.2, Math.sqrt(rect.w * rect.h) / 120));
    for (let i = 0; i < n; i++) {
      const x = rect.x + Math.random() * rect.w, y = rect.y + Math.random() * rect.h, dx = x - at.x, dy = y - at.y, d = Math.hypot(dx, dy) || 1, sp = R(...(o.speed ?? [120, 620])) * k * (o.fromCenter === false ? 0.5 : 1);
      ps.push({ x, y, vx: (dx / d) * sp + R(-60, 60), vy: (dy / d) * sp + R(-(o.up ?? 200), 60) - (o.lift ?? 120), g: o.g ?? 900, drag: o.drag ?? 0.985, life: R(...(o.life ?? [0.7, 1.5])), s: R(...(o.size ?? [1.5, 5.5])) * Math.min(1.6, k), c: pick(colors), edge: o.edge, shape: o.shape ?? 'shard', vr: R(-14, 14), r: R(0, 6), add: o.add, delay: (o.delay ?? 0) + (o.stagger ? Math.random() * o.stagger : 0), floor: o.floor, hold: o.hold, steps: o.steps });
    }
    PX.add(ps);
  }
  function smokeAt(rect, n, color, o = {}) {
    const ps = []; for (let i = 0; i < n; i++) ps.push({ x: rect.x + Math.random() * rect.w, y: rect.y + Math.random() * rect.h, vx: R(...(o.vx ?? [-20, 20])), vy: R(...(o.vy ?? [-70, -25])), g: 0, drag: 0.99, life: R(...(o.life ?? [0.9, 1.8])), s: R(8, 18) * Math.max(1, Math.min(2.5, rect.h / 50)), c: color, shape: 'smoke', delay: (o.delay ?? 0) + Math.random() * (o.spread ?? 0.4), hold: 0.1 });
    PX.add(ps);
  }
  function shake(px = 6, ms = 380) { const L = getLayer(), b = document.body; for (const n of [L, document.querySelector('.view.on') || b]) anim(n, [{ transform: 'none' }, { transform: `translate(${px}px,${-px / 2}px)` }, { transform: `translate(${-px}px,${px / 2}px)` }, { transform: `translate(${px / 2}px,${px / 3}px)` }, { transform: 'none' }], { duration: ms, fill: 'none' }); }
  /** L'explosion en mille morceaux (couleurs de l'élément), au bon moment de l'animation. */
  function boomAt(snap, ms, o = {}) {
    if (!snap) return; const r = snap.rect, q = Q();
    setTimeout(() => {
      const cols = o.cols ?? colorsOf(snap.src ?? snap.node).concat(o.extra ?? []), n = Math.round((o.n ?? Math.min(1200, 160 + (r.w * r.h) / 45)) * q);
      shatter(r, n, cols, { edge: o.edge, speed: o.speed ?? [140, 680], g: o.g ?? 1000, lift: o.lift ?? 140, size: o.size ?? [1.2, 4.6], shape: o.shape, floor: Math.min(innerHeight - 4, r.y + r.h + 120) });
      if (o.spark) shatter(r, Math.round(160 * q), o.spark, { speed: [200, 950], g: 380, life: [0.25, 0.7], size: [1, 2.2], shape: 'spark', add: true });
    }, ms);
  }
  /** La désintégration : une poussière de particules qui part au passage du balayage. */
  function dust(snap, p, D) {
    if (!snap) return; const r = snap.rect, q = Q(), n = Math.round(Math.min(1600, 120 + (r.w * r.h) / 14) * q), ps = [], v = p.dir === 'v';
    const shape = p.shape === '0' ? 'square' : p.shape === '50% 0' ? 'petal' : 'dot', add = (p.glow ?? 5) > 0;
    for (let i = 0; i < n; i++) { const x = r.x + Math.random() * r.w, y = r.y + Math.random() * r.h, f = v ? (y - r.y) / r.h : (x - r.x) / r.w; ps.push({ x, y, vx: R(...(p.dx || [-6, 14])) * 3.2, vy: R(...(p.dy || [-30, -12])) * 3.2, g: shape === 'petal' ? 40 : 0, drag: 0.985, wob: shape === 'petal' ? 6 : 0, life: R(0.5, 1.1), s: R(...(p.size || [2, 4])) / (shape === 'dot' ? 2.2 : 1.2), c: pick(p.pc || GOLD), shape, add, vr: R(-6, 6), steps: p.steps, delay: (0.15 * D + f * 0.7 * D) / 1000 + Math.random() * 0.05 }); }
    PX.add(ps);
  }


  // ---------------------------------------------------------------- effets réutilisables
  function particles(S, p, o = {}) {
    const { box, w, h } = S, n = Math.min(90, Math.max(18, Math.round((w * h) / 260 * F())));
    const cols = Math.max(4, Math.round(Math.sqrt(n * (w / h)))), rows = Math.max(3, Math.round(n / cols));
    const D = o.dur ?? DUR();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * (w / cols) + R(-3, 3), y = (r + 0.5) * (h / rows) + R(-3, 3), s = R(...(p.size || [2, 4]));
      const col = pick(p.pc || GOLD), f = (p.dir === 'v' ? y / h : x / w);
      const d = el(box, `left:${x}px;top:${y}px;width:${s}px;height:${s}px;border-radius:${p.shape ?? '50%'};background:${col};box-shadow:0 0 ${p.glow ?? 5}px ${col};opacity:0;z-index:3`);
      const k = (h / 40), dx = R(...(p.dx || [-6, 14])) * Math.max(1, k * 0.6), dy = R(...(p.dy || [-30, -12])) * Math.max(1, k * 0.6);
      anim(d, [{ opacity: 0, transform: 'none' }, { opacity: 1, transform: 'scale(1.2)', offset: 0.1 }, { opacity: 0, transform: `translate(${dx}px,${dy}px) scale(.4) rotate(${p.rot ? Ri(90, 360) : 0}deg)` }],
        { duration: D * 0.55, delay: (o.start ?? 0.15) * D + f * D * 0.4 + R(0, 40), easing: p.steps ? 'steps(5)' : 'ease-out' });
    }
  }
  function smokes(S, color, n, o = {}) {
    const { box, w, h } = S, D = DUR();
    for (let i = 0; i < n; i++) {
      const s = R(14, 22) * Math.max(1, Math.min(2.4, h / 40)), d = el(box, `left:${R(0, w - s)}px;top:${R(0, h - s)}px;width:${s}px;height:${s}px;border-radius:50%;background:radial-gradient(circle,${color} 0,transparent 68%);filter:blur(1.5px);opacity:0;z-index:4`);
      anim(d, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: o.op ?? 0.75, offset: 0.2 }, { opacity: 0, transform: `translate(${R(...(o.dx || [-8, 10]))}px,${R(...(o.dy || [-46, -26])) * Math.min(2, h / 40)}px) scale(2.6)` }], { duration: D * 0.7, delay: D * (o.start ?? 0.35) + R(0, D * (o.spread ?? 0.3)) });
    }
  }
  function shards(S, n, col, edge, o = {}) {
    const { box, w, h } = S, D = DUR(), cx = w / 2, cy = h / 2, k = Math.max(1, Math.min(3, Math.sqrt(w * h) / 48));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R(-0.25, 0.25), dist = R(24, 46) * k, sw = R(6, 12) * Math.min(2, k), sh = R(4, 9) * Math.min(2, k);
      const x = Math.cos(a) * dist, y = Math.sin(a) * dist * 0.8, d = el(box, `left:${(o.at?.x ?? cx) - sw / 2}px;top:${(o.at?.y ?? cy) - sh / 2}px;width:${sw}px;height:${sh}px;background:linear-gradient(135deg,${edge} 0 22%,${col} 48%);clip-path:polygon(12% 0,100% 18%,82% 100%,0 74%);opacity:0;z-index:5`);
      anim(d, [{ opacity: 1, transform: 'none' }, { opacity: 1, transform: `translate(${x}px,${y}px) rotate(${Ri(60, 200)}deg)`, offset: 0.45 }, { opacity: 0, transform: `translate(${x * 1.3}px,${y + 30 * k}px) rotate(${Ri(240, 520)}deg)` }], { duration: D * 0.6, delay: D * (o.start ?? 0.6), easing: 'cubic-bezier(.2,.7,.4,1)' });
    }
  }
  function flash(S, c, at = 0.6, size = 1) {
    const { box, w, h } = S, D = DUR(), s = Math.max(34, Math.min(w, h) * 0.9) * size;
    const f = el(box, `left:${w / 2 - s / 2}px;top:${h / 2 - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;background:radial-gradient(circle,#fff 0,#fff6b0 28%,${c} 52%,transparent 70%);opacity:0;z-index:6`);
    anim(f, [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1.7)', offset: 0.15 }, { opacity: 0, transform: 'scale(3.2)' }], { duration: D * 0.4, delay: D * at });
    const r = el(box, `left:${w / 2 - 5}px;top:${h / 2 - 5}px;width:10px;height:10px;border-radius:50%;border:2px solid ${c};opacity:0;z-index:6`);
    anim(r, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: `scale(${Math.max(12, Math.max(w, h) / 6)})` }], { duration: D * 0.4, delay: D * at });
  }
  function rays(S, c, n = 10, at = 0.6, cols) {
    const { box, w, h } = S, D = DUR(), len = Math.max(14, Math.min(w, h) * 0.35);
    for (let i = 0; i < n; i++) {
      const a = (360 / n) * i, col = cols ? cols[i % cols.length] : c, d = el(box, `left:${w / 2 - 1}px;top:${h / 2}px;width:2px;height:${len}px;border-radius:2px;background:linear-gradient(#fff,${col},transparent);transform-origin:50% 0;opacity:0;z-index:6`);
      anim(d, [{ opacity: 0, transform: `rotate(${a}deg) translateY(2px) scaleY(.2)` }, { opacity: 1, transform: `rotate(${a}deg) translateY(${len * 0.5}px) scaleY(1)`, offset: 0.25 }, { opacity: 0, transform: `rotate(${a}deg) translateY(${len * 1.8}px) scaleY(.3)` }], { duration: D * 0.45, delay: D * at });
    }
  }
  const svgNS = (w, h, inner, css = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="overflow:visible;${css}">${inner}</svg>`;
  // Une flamme : pointe ondulée, cœur jaune-blanc en bas, bords orange et rouge (trois tailles de teinte).
  const FLAME = (k = 0) => { const tip = R(-3, 3), id = `fl${Math.random().toString(36).slice(2, 8)}`, c = [['#fff7c2', '#ffd23a', '#ff7a1a', '#e0360f'], ['#ffe9a0', '#ffb020', '#ff5a10', '#c62a0c'], ['#ffd36a', '#ff8a1a', '#e8430f', '#9e1f08']][k];
    return `<svg viewBox="0 0 20 32" width="100%" height="100%" preserveAspectRatio="none" style="overflow:visible"><defs><linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c[0]}"/><stop offset=".35" stop-color="${c[1]}"/><stop offset=".7" stop-color="${c[2]}"/><stop offset="1" stop-color="${c[3]}" stop-opacity=".85"/></linearGradient></defs><path d="M${10 + tip} 0 C${12 + tip} 7 19 11 18 20 C17.5 27 13.5 31 10 31 C6.5 31 2.5 27 2 20 C1.6 14 6 11 7 6 C8 9 8.5 11 9 12 C9.5 8 ${10 + tip} 4 ${10 + tip} 0Z" fill="url(#${id})"/><path d="M10 14 C12 18 14 21 13 25 C12.5 28 11 29.5 10 29.5 C9 29.5 7.5 28 7 25 C6.6 21 9 18 10 14Z" fill="#fffbe6" opacity=".85"/></svg>`; };
  function zigzag(x0, y0, x1, y1, n = 7, amp = 12) { const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push(`${(x0 + (x1 - x0) * t + (i && i < n ? R(-amp / 3, amp / 3) : 0)).toFixed(1)},${(y0 + (y1 - y0) * t + (i && i < n ? R(-amp, amp) : 0)).toFixed(1)}`); } return pts.join(' '); }

  // ---------------------------------------------------------------- les façons de détruire
  /** Un trou qui brûle depuis le point d'impact jusqu'à ce que l'élément ait disparu, avec un bord incandescent et des braises. */
  function burnHole(S, ax, ay, t0, dur, o = {}) {
    const { box, g, w, h } = S, r0 = Math.max(Math.hypot(ax, ay), Math.hypot(w - ax, ay), Math.hypot(ax, h - ay), Math.hypot(w - ax, h - ay)) + 16;
    const rad = getComputedStyle(g).borderRadius, ring = el(box, `left:0;top:0;width:${w}px;height:${h}px;overflow:hidden;border-radius:${rad};z-index:4`), q = Q(), rect = box.getBoundingClientRect();
    const hot = o.hot ?? ['#fff7c2', '#ffd23a', '#ff7a1a'];
    const born = performance.now();
    const tick = (now) => {
      if (!box.isConnected) return;
      const t = (now - born - t0) / dur;
      if (t >= 0) {
        const k = Math.min(1, t), e = 1 - (1 - k) ** 1.6, r = r0 * e, m = `radial-gradient(circle at ${ax}px ${ay}px,transparent ${r}px,#000 ${r + 2}px)`;
        g.style.webkitMaskImage = m; g.style.maskImage = m;
        ring.style.background = `radial-gradient(circle at ${ax}px ${ay}px,transparent ${Math.max(0, r - 7)}px,${hot[0]} ${r - 2}px,${hot[2]} ${r + 2}px,rgba(110,30,0,.85) ${r + 7}px,rgba(30,10,4,.55) ${r + 16}px,transparent ${r + 30}px)`;
        if (k < 1 && r > 2) { const ps = []; for (let i = 0; i < 6 * q; i++) { const a = Math.random() * 6.283, x = ax + Math.cos(a) * r, y = ay + Math.sin(a) * r; if (x < 0 || y < 0 || x > w || y > h) continue; ps.push({ x: rect.left + x, y: rect.top + y, vx: Math.cos(a) * R(20, 90), vy: R(-160, -50), g: -30, drag: 0.97, wob: R(3, 8), life: R(0.4, 1), s: R(1, 2.6), c: pick(hot), add: true }); } if (ps.length) PX.add(ps); }
        if (k >= 1) { ring.remove(); g.style.opacity = '0'; return; }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  const KITS = {
    engulf(S, p, from, snap) { // une grosse boule de feu arrive, s'écrase sur la fiche, qui prend feu et disparaît dans les flammes
      const { box, g, w, h } = S, r = snap.rect, L = getLayer(), q = Q(), k = F(), D = DUR() * 1.6;
      const tx = r.x + (snap.hit?.x !== undefined ? snap.hit.x - r.x : r.w / 2), ty = r.y + Math.min(r.h * 0.45, 60);
      const src = from ?? { x: tx - Math.min(260, innerWidth * 0.3), y: -90 }, dx = tx - src.x, dy = ty - src.y, dist = Math.hypot(dx, dy), T = Math.min(620, Math.max(360, dist * 0.7));
      const arc = from ? -Math.min(140, dist * 0.25) : 0, ang = Math.atan2(dy, dx) * 180 / Math.PI, s0 = Math.round(Math.max(54, Math.min(96, Math.sqrt(r.w * r.h) * 0.35)) * Math.min(1.25, k));
      // La boule : un cœur blanc-jaune, des flammes qui traînent derrière, une lueur autour.
      const ball = el(L, `left:${src.x - s0 / 2}px;top:${src.y - s0 / 2}px;width:${s0}px;height:${s0}px;z-index:21`);
      const tail = el(ball, `left:${s0 / 2}px;top:${s0 / 2}px;width:0;height:0;transform:rotate(${ang + 90}deg)`);
      for (let i = 0; i < 5; i++) { const fw = s0 * R(0.7, 1.05), fh = s0 * R(1.5, 2.3), f = el(tail, `left:${-fw / 2 + R(-s0 * 0.15, s0 * 0.15)}px;top:${-s0 * 0.2}px;width:${fw}px;height:${fh}px;transform-origin:50% 0;transform:rotate(180deg);opacity:.92;filter:drop-shadow(0 0 8px #ff6a1a)`, FLAME(Math.min(2, i % 3))); f.firstElementChild && (f.firstElementChild.style.animation = `opFlick ${R(0.12, 0.2).toFixed(2)}s ease-in-out infinite alternate`); }
      el(ball, `left:${-s0 * 0.35}px;top:${-s0 * 0.35}px;width:${s0 * 1.7}px;height:${s0 * 1.7}px;border-radius:50%;background:radial-gradient(circle,rgba(255,170,40,.55),rgba(255,90,20,.18) 50%,transparent 70%)`);
      const core = el(ball, `left:0;top:0;width:${s0}px;height:${s0}px;border-radius:50%;background:radial-gradient(circle at 42% 40%,#fffbe8 0,#fff1a0 18%,#ffc43a 38%,#ff6a1a 64%,#c9260a 86%);box-shadow:0 0 22px #ff7a1a,0 0 46px #ff4a00aa`);
      anim(core, [{ transform: 'rotate(0) scale(1)' }, { transform: 'rotate(180deg) scale(1.08)' }, { transform: 'rotate(360deg) scale(1)' }], { duration: 260, iterations: Math.ceil(T / 260) + 1, easing: 'linear' });
      const mid = (t) => ({ x: dx * t, y: dy * t + arc * 4 * t * (1 - t) });
      const kf = []; for (let i = 0; i <= 10; i++) { const t = i / 10, pt = mid(t); kf.push({ transform: `translate(${pt.x}px,${pt.y}px) scale(${0.5 + 0.5 * Math.min(1, t * 3)})`, offset: t }); }
      anim(ball, kf, { duration: T, easing: 'cubic-bezier(.35,0,.9,.6)' }); setTimeout(() => ball.remove(), T + 20);
      const trail = []; for (let i = 0; i < 90 * q; i++) { const t = i / (90 * q), pt = mid(t); trail.push({ x: src.x + pt.x + R(-s0 * 0.2, s0 * 0.2), y: src.y + pt.y + R(-s0 * 0.2, s0 * 0.2), vx: R(-30, 30), vy: R(-60, -10), g: -40, life: R(0.3, 0.7), s: R(3, 7) * Math.min(1.4, s0 / 60), c: pick(['#ffd36a', '#ff9a2a', '#ff6a1a', '#fff3c0']), add: true, delay: (T * t) / 1000 }, { x: src.x + pt.x, y: src.y + pt.y, vx: R(-15, 15), vy: R(-40, -15), g: 0, life: R(0.7, 1.2), s: R(6, 12), c: 'rgba(90,80,75,.35)', shape: 'smoke', delay: (T * t + 60) / 1000 }); }
      PX.add(trail);
      // L'impact : éclair de chaleur, onde, la fiche s'embrase de partout en un instant, puis brûle jusqu'à disparaître.
      const ax = tx - r.x, ay = ty - r.y;
      setTimeout(() => {
        shake(6 * k, 360);
        const fl = el(box, `left:${ax - s0 * 1.6}px;top:${ay - s0 * 1.6}px;width:${s0 * 3.2}px;height:${s0 * 3.2}px;border-radius:50%;background:radial-gradient(circle,#fffbe8 0,#ffd23a 25%,#ff6a1a 50%,transparent 70%);z-index:7`);
        anim(fl, [{ opacity: 1, transform: 'scale(.3)' }, { opacity: 0.9, transform: 'scale(1)', offset: 0.35 }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 420 });
        shatter({ x: tx - 4, y: ty - 4, w: 8, h: 8 }, Math.round(120 * q), ['#fff3c0', '#ffd36a', '#ff7a1a'], { at: { x: tx, y: ty + 6 }, speed: [200, 700], g: 500, life: [0.25, 0.7], size: [1, 2.6], shape: 'spark', add: true });
        const glow = el(box, `left:${-w * 0.3}px;top:${-h * 0.7}px;width:${w * 1.6}px;height:${h * 2.1}px;border-radius:50%;background:radial-gradient(ellipse at 50% 65%,rgba(255,140,30,.6),rgba(255,80,20,.2) 45%,transparent 70%);z-index:0`);
        anim(glow, [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: D });
        anim(g, [{ filter: 'brightness(1.8) sepia(.6) saturate(3) hue-rotate(-20deg)' }, { filter: 'sepia(1) saturate(2.4) hue-rotate(-25deg) brightness(.7)', offset: 0.4 }, { filter: 'brightness(.25) saturate(0)' }], { duration: D * 0.8 });
        const flames = el(box, 'left:0;top:0;width:100%;height:100%;z-index:5;overflow:visible;mix-blend-mode:screen'), sp = Math.max(18, Math.min(34, w / 6)), rows = Math.max(1, Math.min(4, Math.round(h / 40))), dmax = Math.hypot(Math.max(ax, w - ax), Math.max(ay, h - ay)) || 1;
        let n = 0;
        for (let rI = 0; rI <= rows; rI++) for (let x = -sp / 3 + R(0, sp / 2); x < w + sp / 2 && n < 70; x += sp * R(0.75, 1.3)) {
          n++; const y = h - (rI * h) / rows + R(-8, 8), fh = Math.max(30, Math.min(110, h * 0.95)) * R(0.5, 1.3) * (1 - rI * 0.12) * k, d = Math.hypot(x - ax, y - ay) / dmax;
          const f = el(flames, `left:${x - fh * 0.32}px;top:${y - fh}px;width:${fh * 0.64}px;height:${fh}px;transform-origin:50% 100%;filter:drop-shadow(0 0 8px #ff5a10);opacity:0`, FLAME(Ri(0, 2)));
          f.style.animation = `opFlick ${R(0.14, 0.26).toFixed(2)}s ease-in-out ${-R(0, 0.3).toFixed(2)}s infinite alternate`;
          const on = d * 0.16, off = Math.min(0.92, 0.3 + d * 0.55 + R(0, 0.08));
          anim(f, [{ opacity: 0, scale: '0.1' }, { opacity: 0, scale: '0.1', offset: on }, { opacity: 1, scale: '1.15', offset: on + 0.07 }, { opacity: 1, scale: '1', offset: off }, { opacity: 0, scale: '0.3' }], { duration: D, easing: 'linear' });
        }
        burnHole(S, ax, ay, D * 0.12, D * 0.62);
        const em = [], ash = [];
        for (let i = 0; i < Math.round(120 * q); i++) em.push({ x: r.x + Math.random() * r.w, y: r.y + r.h * R(0, 1), vx: R(-35, 35), vy: R(-220, -70), g: -20, drag: 0.98, wob: R(4, 9), life: R(0.6, 1.4), s: R(1, 2.6), c: pick(['#ffd36a', '#ffb020', '#ff7a1a', '#fff3c0']), add: true, delay: (R(0.05, 0.8) * D) / 1000 });
        for (let i = 0; i < Math.round(200 * q); i++) ash.push({ x: r.x + Math.random() * r.w, y: r.y + Math.random() * r.h, vx: R(-40, 40), vy: R(-120, -30), g: 50, drag: 0.97, wob: R(3, 7), life: R(0.9, 1.8), s: R(1.5, 4), c: pick(['#2a2a2e', '#3b3b40', '#55555c', '#ff7a1a']), shape: 'flake', vr: R(-8, 8), delay: (R(0.3, 0.85) * D) / 1000 });
        PX.add(em); PX.add(ash); smokeAt(r, Math.round(22 * q), 'rgba(100,100,108,.5)', { delay: (0.3 * D) / 1000, spread: (0.6 * D) / 1000 });
      }, T);
      return T + D * 1.1;
    },
    beam(S, p, from, snap) { // un gros rayon jaillit d'Odin ; dès qu'il touche la fenêtre, elle fond et se perce jusqu'à disparaître
      const { box, g, w, h } = S, r = snap.rect, L = getLayer(), q = Q(), k = F(), D = DUR() * 1.25;
      const src = from ?? { x: -30, y: Math.max(40, r.y - 120) };
      const inside = src.x > r.x && src.x < r.x + r.w && src.y > r.y && src.y < r.y + r.h;
      const cx = inside ? r.x + r.w / 2 : Math.min(r.x + r.w - 2, Math.max(r.x + 2, src.x)), cy = inside ? r.y + r.h / 2 : Math.min(r.y + r.h - 2, Math.max(r.y + 2, src.y));
      // On vise un peu dans la fenêtre pour que le rayon y entre franchement.
      const tx = cx + (r.x + r.w / 2 - cx) * 0.12, ty = cy + (r.y + r.h / 2 - cy) * 0.12, dx = tx - src.x, dy = ty - src.y, dist = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
      const th = Math.round(Math.max(26, Math.min(54, Math.min(r.w, r.h) * 0.4)) * Math.min(1.3, k)), EXT = 130, HOLD = D;
      const beam = el(L, `left:${src.x}px;top:${src.y - th / 2}px;width:${dist}px;height:${th}px;transform-origin:0 50%;transform:rotate(${ang}deg);z-index:20`);
      const glow = el(beam, `left:0;top:${-th * 0.6}px;width:100%;height:${th * 2.2}px;border-radius:${th}px;background:linear-gradient(180deg,transparent,rgba(255,110,20,.45) 30%,rgba(255,150,40,.6) 50%,rgba(255,110,20,.45) 70%,transparent);filter:blur(6px)`);
      const body = el(beam, `left:0;top:0;width:100%;height:100%;border-radius:${th}px;background:linear-gradient(180deg,rgba(255,80,10,.0),#ff5a10 18%,#ffb020 38%,#fff3b0 50%,#ffb020 62%,#ff5a10 82%,rgba(255,80,10,0))`);
      el(beam, `left:0;top:${th / 2 - Math.max(3, th * 0.12)}px;width:100%;height:${Math.max(6, th * 0.24)}px;border-radius:9px;background:#fffef5;box-shadow:0 0 10px #fff,0 0 22px #ffe08a`);
      const ripple = el(body, `left:0;top:0;width:100%;height:100%;background:repeating-linear-gradient(90deg,rgba(255,255,255,0) 0 18px,rgba(255,255,255,.35) 22px,rgba(255,255,255,0) 30px);mix-blend-mode:screen`);
      anim(ripple, [{ backgroundPosition: '0 0' }, { backgroundPosition: '300px 0' }], { duration: 260, iterations: Math.ceil((EXT + HOLD) / 260) + 2, easing: 'linear' });
      anim(beam, [{ transform: `rotate(${ang}deg) scale(0,.4)` }, { transform: `rotate(${ang}deg) scale(1,1)`, offset: EXT / (EXT + HOLD + 220) }, { transform: `rotate(${ang}deg) scale(1,1.12)`, offset: (EXT + HOLD * 0.5) / (EXT + HOLD + 220) }, { transform: `rotate(${ang}deg) scale(1,1)`, offset: (EXT + HOLD) / (EXT + HOLD + 220) }, { transform: `rotate(${ang}deg) scale(1,0)` }], { duration: EXT + HOLD + 220, easing: 'linear' });
      anim(glow, [{ opacity: 0.7 }, { opacity: 1 }], { duration: 90, iterations: Math.ceil((EXT + HOLD) / 90), direction: 'alternate' });
      setTimeout(() => beam.remove(), EXT + HOLD + 260);
      // Bouche du rayon chez Odin
      const mz = el(L, `left:${src.x - th}px;top:${src.y - th}px;width:${th * 2}px;height:${th * 2}px;border-radius:50%;background:radial-gradient(circle,#fffef5 0,#ffe08a 30%,#ff7a1a 55%,transparent 72%);z-index:21`);
      anim(mz, [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: 0.1 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.85 }, { transform: 'scale(.2)', opacity: 0 }], { duration: EXT + HOLD + 200 }); setTimeout(() => mz.remove(), EXT + HOLD + 240);
      // Au contact : point d'impact aveuglant, gerbes d'étincelles, fumée, la fenêtre chauffe, se perce et part en fusion.
      const ax = tx - r.x, ay = ty - r.y;
      setTimeout(() => {
        const imp = el(box, `left:${ax - th * 1.6}px;top:${ay - th * 1.6}px;width:${th * 3.2}px;height:${th * 3.2}px;border-radius:50%;background:radial-gradient(circle,#ffffff 0,#fff3b0 20%,#ffb020 42%,rgba(255,90,20,.5) 58%,transparent 72%);z-index:8`);
        anim(imp, [{ transform: 'scale(.6)' }, { transform: 'scale(1.1)' }], { duration: 70, iterations: Math.ceil(HOLD / 70), direction: 'alternate' }); setTimeout(() => imp.remove(), HOLD);
        anim(g, [{ filter: 'brightness(1.6) sepia(.5) saturate(3) hue-rotate(-20deg)' }, { filter: 'sepia(1) saturate(2.5) hue-rotate(-25deg) brightness(.9)', offset: 0.5 }, { filter: 'brightness(.5) sepia(1) saturate(3) hue-rotate(-35deg)' }], { duration: HOLD });
        burnHole(S, ax, ay, 0, HOLD * 0.9, { hot: ['#ffffff', '#fff3b0', '#ff8a1a'] });
        const back = ang * Math.PI / 180 + Math.PI, iv = setInterval(() => {
          if (!box.isConnected) { clearInterval(iv); return; }
          const ps = []; for (let i = 0; i < 14 * q; i++) { const a = back + R(-1.1, 1.1), v = R(220, 620); ps.push({ x: tx, y: ty, vx: Math.cos(a) * v, vy: Math.sin(a) * v - R(0, 120), g: 900, drag: 0.985, life: R(0.25, 0.7), s: R(1, 2.4), c: pick(['#ffffff', '#fff3b0', '#ffd36a', '#ff8a1a']), shape: 'spark', add: true }); }
          ps.push({ x: tx, y: ty, vx: R(-20, 20), vy: R(-70, -30), g: 0, life: R(0.8, 1.4), s: R(8, 14), c: 'rgba(110,110,118,.45)', shape: 'smoke' });
          PX.add(ps);
        }, 40);
        setTimeout(() => clearInterval(iv), HOLD);
        shake(3 * k, HOLD * 0.9);
        setTimeout(() => { const cols = colorsOf(snap.src ?? g); shatter(r, Math.round(Math.min(500, 80 + (r.w * r.h) / 90) * q), [...cols, '#ff8a1a', '#ffd36a'], { at: { x: tx, y: ty }, speed: [80, 360], g: 700, size: [1.2, 3.6], life: [0.6, 1.2], edge: '#ffb020', lift: 80 }); }, HOLD * 0.25);
      }, EXT);
      return EXT + HOLD + 300;
    },
    burn(S, p, from, snap) { // le feu démarre en bas, s'étend sur tout l'élément, le carbonise, il part en cendres
      const { box, g, w, h } = S, D = DUR() * 1.7, r = snap.rect, x0 = snap.hit?.x !== undefined ? snap.hit.x - r.x : w / 2;
      const glow = el(box, `left:${-w * 0.25}px;top:${-h * 0.6}px;width:${w * 1.5}px;height:${h * 1.9}px;border-radius:50%;background:radial-gradient(ellipse at 50% 70%,rgba(255,140,30,.55),rgba(255,80,20,.18) 45%,transparent 70%);z-index:0`);
      anim(glow, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: D });
      anim(g, [{ filter: 'none', opacity: 1 }, { filter: 'brightness(1.5) sepia(.5) saturate(3) hue-rotate(-20deg)', offset: 0.18 }, { filter: 'sepia(1) saturate(2.2) hue-rotate(-25deg) brightness(.5)', offset: 0.5 }, { filter: 'brightness(.12) saturate(0)', opacity: 1, offset: 0.72 }, { filter: 'brightness(.08) saturate(0)', opacity: 0 }], { duration: D, easing: 'linear' });
      // Les flammes : d'abord en bas, au point d'impact, puis sur toute la largeur, puis elles montent et couvrent tout.
      const sp = Math.max(10, Math.min(18, w / 10)), rows = Math.max(2, Math.min(6, Math.round(h / 22))), fl = el(box, 'left:0;top:0;width:100%;height:100%;z-index:5;overflow:visible');
      let n = 0;
      for (let rI = 0; rI < rows; rI++) for (let x = -sp / 2; x < w + sp / 2 && n < 140; x += sp * (1 + rI * 0.15)) {
        n++; const y = h - (rI * h) / rows, big = 1 - rI / (rows + 1), fh = Math.max(16, Math.min(40, h * 0.55)) * R(0.75, 1.2) * (0.7 + big * 0.5);
        const f = el(fl, `left:${x + R(-4, 4) - fh * 0.32}px;top:${y - fh}px;width:${fh * 0.64}px;height:${fh}px;transform-origin:50% 100%;filter:drop-shadow(0 0 6px #ff6a1a);opacity:0`, FLAME(rI === 0 ? 0 : Math.min(2, rI)));
        f.style.animation = `opFlick ${R(0.18, 0.3).toFixed(2)}s ease-in-out ${-R(0, 0.3).toFixed(2)}s infinite alternate`;
        const start = (Math.abs(x - x0) / w) * 0.32 + (rI / rows) * 0.25;
        anim(f, [{ opacity: 0, scale: '0.1' }, { opacity: 0, scale: '0.1', offset: start }, { opacity: 1, scale: '1', offset: Math.min(0.9, start + 0.12) }, { opacity: 1, scale: '1.1', offset: 0.78 }, { opacity: 0, scale: '0.4' }], { duration: D, easing: 'linear' });
      }
      // Braises, cendres et fumée
      const q = Q(), em = [], ash = [];
      for (let i = 0; i < Math.round(90 * q); i++) em.push({ x: r.x + Math.random() * r.w, y: r.y + r.h * R(0.2, 1), vx: R(-30, 30), vy: R(-180, -60), g: -20, drag: 0.98, wob: R(4, 9), life: R(0.6, 1.3), s: R(1, 2.4), c: pick(['#ffd36a', '#ffb020', '#ff7a1a', '#fff3c0']), add: true, delay: (R(0.08, 0.75) * D) / 1000 });
      for (let i = 0; i < Math.round(260 * q); i++) ash.push({ x: r.x + Math.random() * r.w, y: r.y + Math.random() * r.h, vx: R(-40, 40), vy: R(-110, -20), g: 60, drag: 0.97, wob: R(3, 7), life: R(0.9, 1.8), s: R(1.5, 4), c: pick(['#2a2a2e', '#3b3b40', '#55555c', '#1a1a1c', '#ff7a1a']), shape: 'flake', vr: R(-8, 8), delay: (R(0.7, 0.95) * D) / 1000 });
      PX.add(em); PX.add(ash); smokeAt(r, Math.round(18 * q), 'rgba(110,112,120,.5)', { delay: (0.35 * D) / 1000, spread: (0.55 * D) / 1000 });
      return D * 1.15;
    },
    meteor(S, p, from, snap) { // une météorite tombe du ciel sur la fenêtre et la fait exploser en mille morceaux
      const { g, w, h } = S, r = snap.rect, L = getLayer(), T = 520, tx = r.x + r.w / 2, ty = r.y + r.h * 0.35, sx = tx - Math.min(380, innerWidth * 0.4), sy = -120, q = Q(), many = p.many;
      const fall = (delay, ox, oy, s0) => {
        const head = el(L, `left:${sx + ox - s0 / 2}px;top:${sy + oy - s0 / 2}px;width:${s0}px;height:${s0}px;border-radius:50%;background:radial-gradient(circle at 40% 40%,#fff3c0,#ff9a2a 40%,#8a3a10 75%);box-shadow:0 0 18px #ff7a1a,0 0 40px #ff4a0088;z-index:21`);
        anim(head, [{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${tx - sx - ox * 0.3}px,${ty - sy - oy * 0.3}px)`, opacity: 1, offset: 0.97 }, { opacity: 0 }], { duration: T, delay, easing: 'cubic-bezier(.5,0,1,1)' }); setTimeout(() => head.remove(), T + delay + 40);
        const tr = []; for (let i = 0; i < 70 * q; i++) { const t = i / (70 * q), x = sx + ox + (tx - sx) * t ** 2.2, y = sy + oy + (ty - sy) * t ** 2.2; tr.push({ x, y, vx: R(-25, 25), vy: R(-25, 10), g: 0, life: R(0.35, 0.8), s: R(2, 4.5), c: pick(['#ffd36a', '#ff7a1a', '#fff3c0']), add: true, delay: (delay + T * t ** 0.7) / 1000 }, { x, y, vx: R(-10, 10), vy: R(-30, -10), g: 0, life: R(0.8, 1.4), s: R(5, 9), c: 'rgba(120,110,105,.35)', shape: 'smoke', delay: (delay + T * t ** 0.7) / 1000, hold: 0.1 }); }
        PX.add(tr);
      };
      fall(0, 0, 0, many ? 18 : 38); if (many) { fall(110, -60, 30, 14); fall(220, 50, -40, 16); }
      const hit = T + (many ? 220 : 0);
      setTimeout(() => {
        anim(g, [{ opacity: 1, filter: 'brightness(3)' }, { opacity: 0, filter: 'brightness(3)' }], { duration: 90 });
        flash({ ...S, box: S.box }, '#ff9a2a', 0, 1.6); shake(7, 420);
        const cols = colorsOf(snap.src ?? g), n = Math.round(Math.min(1400, 180 + (r.w * r.h) / 40) * q);
        shatter(r, n, cols, { at: { x: tx, y: ty - 10 }, speed: [160, 900], g: 1100, life: [0.8, 1.7], size: [1.2, 4.5], lift: 220, floor: Math.min(innerHeight - 4, r.y + r.h + 140) });
        shatter(r, Math.round(160 * q), ['#fff3c0', '#ffd36a', '#ff7a1a'], { at: { x: tx, y: ty }, speed: [200, 1000], g: 600, life: [0.3, 0.8], size: [1, 2.4], shape: 'spark', add: true });
        smokeAt({ x: r.x - r.w * 0.1, y: r.y + r.h * 0.3, w: r.w * 1.2, h: r.h * 0.7 }, Math.round(24 * q), 'rgba(140,120,105,.5)', { vy: [-60, -15], spread: 0.25 });
      }, hit);
      return hit + DUR() * 1.2;
    },
    strike(S, p, from, snap) { // un éclair tombe du ciel sur l'élément, qui s'électrise et explose
      const { g, w, h } = S, r = snap.rect, L = getLayer(), q = Q(), tx = r.x + r.w / 2, ty = r.y + 4;
      const dark = el(L, 'left:0;top:0;width:100vw;height:100vh;background:#060814;z-index:2');
      anim(dark, [{ opacity: 0 }, { opacity: 0.45, offset: 0.2 }, { opacity: 0.45, offset: 0.6 }, { opacity: 0 }], { duration: 700 }); setTimeout(() => dark.remove(), 720);
      const path = () => { const pts = [[tx + R(-60, 60), -10]]; const n = 12; for (let i = 1; i <= n; i++) { const t = i / n; pts.push([tx + (pts[0][0] - tx) * (1 - t) + (i < n ? R(-26, 26) : 0), -10 + (ty + 10) * t]); } return pts; };
      const bolt = () => { const pts = path(), main = pts.map((x) => x.join(',')).join(' '); let br = ''; for (let i = 3; i < 10; i += 3) { const [bx, by] = pts[i]; br += `<polyline points="${bx},${by} ${bx + R(-50, 50)},${by + R(30, 70)} ${bx + R(-80, 80)},${by + R(60, 120)}" fill="none" stroke="#e8f0ff" stroke-width="1.4"/>`; } return svgNS(innerWidth, innerHeight, `<polyline points="${main}" fill="none" stroke="#9fb4ff" stroke-width="9" opacity=".5" style="filter:blur(3px)"/><polyline points="${main}" fill="none" stroke="#ffffff" stroke-width="3"/>${br}`); };
      for (const [d, k] of [[120, 0], [260, 1], [420, 2]]) { const b = el(L, 'left:0;top:0;z-index:22', bolt()); anim(b, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 0.3, offset: 0.4 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 180, delay: d, easing: 'steps(1)' }); setTimeout(() => b.remove(), d + 220); if (k === 2) setTimeout(() => shake(5, 300), d); }
      const fl = el(L, 'left:0;top:0;width:100vw;height:100vh;background:#f2f6ff;z-index:3'); anim(fl, [{ opacity: 0 }, { opacity: 0.5, offset: 0.1 }, { opacity: 0, offset: 0.3 }, { opacity: 0.35, offset: 0.55 }, { opacity: 0 }], { duration: 560, delay: 110 }); setTimeout(() => fl.remove(), 700);
      anim(g, [{ filter: 'none', opacity: 1 }, { filter: 'none', offset: 0.2 }, { filter: 'invert(1) brightness(1.6)', offset: 0.28 }, { filter: 'brightness(3) saturate(0)', offset: 0.4 }, { filter: 'invert(1) hue-rotate(180deg)', offset: 0.5 }, { filter: 'brightness(4) saturate(0)', opacity: 1, offset: 0.62 }, { opacity: 0, offset: 0.63 }, { opacity: 0 }], { duration: 760, easing: 'linear' });
      setTimeout(() => { const cols = colorsOf(snap.src ?? g); shatter(r, Math.round(Math.min(1000, 140 + (r.w * r.h) / 50) * q), cols, { at: { x: tx, y: r.y }, speed: [140, 760], g: 1000, size: [1.2, 4.5], edge: '#ffe9a0', lift: 160 }); shatter(r, Math.round(220 * q), ['#ffffff', '#e8f0ff', '#9fb4ff', '#f5d020'], { at: { x: tx, y: r.y }, speed: [250, 1100], g: 300, life: [0.25, 0.7], size: [1, 2.2], shape: 'spark', add: true }); smokeAt(r, Math.round(14 * q), 'rgba(80,84,100,.5)'); flash(S, '#9fb4ff', 0, 1.3); }, 480);
      return 480 + DUR() * 1.2;
    },
    teleport(S, p, from, snap) { // téléportation : balayé de lignes, aplati en un trait de lumière, puis il disparaît en étincelles
      const { box, g, w, h } = S, D = DUR() * 1.15, r = snap.rect, q = Q();
      const col = el(box, `left:${-w * 0.08}px;top:${-Math.max(140, innerHeight)}px;width:${w * 1.16}px;height:${Math.max(140, innerHeight) * 2}px;background:linear-gradient(90deg,transparent,rgba(120,240,255,.25) 25%,rgba(230,255,255,.75) 50%,rgba(120,240,255,.25) 75%,transparent);z-index:0`);
      anim(col, [{ opacity: 0, transform: 'scaleX(.1)' }, { opacity: 1, transform: 'scaleX(1)', offset: 0.25 }, { opacity: 1, transform: 'scaleX(.6)', offset: 0.75 }, { opacity: 0, transform: 'scaleX(0)' }], { duration: D });
      const scan = el(box, 'left:0;top:0;width:100%;height:100%;z-index:4;background:repeating-linear-gradient(180deg,rgba(150,245,255,.0) 0 3px,rgba(150,245,255,.55) 3px 4px);mix-blend-mode:screen');
      anim(scan, [{ opacity: 0, backgroundPosition: '0 0' }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.55 }, { opacity: 0, backgroundPosition: '0 60px' }], { duration: D * 0.7 });
      anim(g, [{ transform: 'none', filter: 'none', opacity: 1 }, { filter: 'sepia(1) hue-rotate(150deg) saturate(3) brightness(1.5)', offset: 0.2 }, { transform: 'scaleX(1.02) scaleY(1)', filter: 'sepia(1) hue-rotate(150deg) saturate(3) brightness(2.4)', offset: 0.42 }, { transform: 'scaleX(1.12) scaleY(.03)', filter: 'brightness(4)', offset: 0.62 }, { transform: 'scaleX(0) scaleY(.03)', filter: 'brightness(5)', opacity: 1, offset: 0.78 }, { opacity: 0, transform: 'scale(0)' }], { duration: D, easing: 'cubic-bezier(.6,0,.4,1)' });
      setTimeout(() => { const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 }; shatter({ x: c.x - r.w * 0.3, y: c.y - 2, w: r.w * 0.6, h: 4 }, Math.round(180 * q), ['#ffffff', '#bff8ff', '#5fe6ff'], { at: c, speed: [60, 420], g: -60, life: [0.4, 1], size: [1, 2.4], shape: 'dot', add: true, lift: 80 }); flash(S, '#5fe6ff', 0, 0.8); }, D * 0.76);
      return D * 1.1;
    },
    pixelate(S, p, from, snap) { // il se désagrège en pixels (bug, puis grille de carrés qui s'éparpillent)
      const { g } = S, r = snap.rect, D = DUR(), q = Q(), cs = Math.max(5, Math.min(12, Math.min(r.w, r.h) / 8)), cols = colorsOf(snap.src ?? g).concat(['#5a6fdb', '#8fa0ff']);
      anim(g, [{ transform: 'none', filter: 'none', opacity: 1 }, { transform: 'translateX(3px)', filter: 'hue-rotate(90deg) contrast(1.6)', offset: 0.1 }, { transform: 'translateX(-4px) skewX(8deg)', filter: 'hue-rotate(200deg)', offset: 0.2 }, { transform: 'translateX(2px)', filter: 'contrast(2) brightness(1.4)', opacity: 1, offset: 0.3 }, { opacity: 0, offset: 0.31 }, { opacity: 0 }], { duration: D, easing: 'steps(6)' });
      const ps = []; let n = 0;
      for (let y = r.y; y < r.y + r.h; y += cs) for (let x = r.x; x < r.x + r.w; x += cs) { if (n++ > 2200 * q) break; ps.push({ x: x + cs / 2, y: y + cs / 2, vx: R(-120, 160), vy: R(-180, 40), g: 380, drag: 0.97, life: R(0.6, 1.3), s: cs - 1, c: pick(cols), shape: 'square', steps: true, hold: 0.2, delay: (0.3 * D) / 1000 + ((x - r.x) / r.w) * 0.25 }); }
      PX.add(ps); return D * 1.4;
    },
    zap(S, p, from, snap) { // électrocuté, puis il explose
      const { box, g, w, h } = S, D = DUR();
      anim(g, [{ filter: 'none', transform: 'none', opacity: 1 }, { filter: 'brightness(2.8) saturate(0)', offset: 0.06 }, { filter: 'brightness(.7) hue-rotate(200deg)', transform: 'translate(1.5px,-1px)', offset: 0.14 }, { filter: 'brightness(2.6) saturate(0)', transform: 'translate(-1.5px,1px)', offset: 0.24 }, { filter: 'brightness(.8) hue-rotate(200deg)', transform: 'translate(1px,1px)', offset: 0.34 }, { filter: 'brightness(3) saturate(0)', transform: 'scale(1.05)', offset: 0.46 }, { filter: 'brightness(4) saturate(0)', transform: 'scale(1.16)', opacity: 1, offset: 0.55 }, { opacity: 0, transform: 'scale(1.2)', offset: 0.56 }, { opacity: 0 }], { duration: D * 1.1, easing: 'linear' });
      for (let k = 0; k < 2; k++) {
        const s = el(box, `left:-8px;top:-8px;width:${w + 16}px;height:${h + 16}px;z-index:5;opacity:0;filter:drop-shadow(0 0 3px ${p.c}) drop-shadow(0 0 6px ${p.c})`, svgNS(w + 16, h + 16, `<polyline points="${zigzag(2, (h + 16) * R(0.3, 0.7), w + 14, (h + 16) * R(0.3, 0.7), 8, h * 0.25)}" fill="none" stroke="#fffbe0" stroke-width="2"/><polyline points="${zigzag((w + 16) * R(0.2, 0.8), 2, (w + 16) * R(0.2, 0.8), h + 14, 5, w * 0.08)}" fill="none" stroke="#fffbe0" stroke-width="1.5"/>`));
        const fr = []; for (let i = 0; i < 12; i++) fr.push({ opacity: (i + k) % 2 ? 1 : 0, offset: 0.04 * i });
        fr.push({ opacity: 0, offset: 0.56 }, { opacity: 0 });
        anim(s, fr, { duration: D * 1.1, easing: 'steps(1)' });
      }
      flash(S, p.c, 0.6); rays(S, p.c, 10, 0.6);
      boomAt(snap, D * 1.1 * 0.56, { spark: ['#fffbe0', p.c, '#ffffff'], edge: '#fff6b0' });
      return D * 1.25;
    },
    ice(S, p, from, snap) { // il se congèle, la glace craque, puis elle explose
      const { box, g, w, h } = S, D = DUR() * 1.15;
      anim(g, [{ filter: 'none', opacity: 1 }, { filter: 'saturate(.2) brightness(1.5)', offset: 0.18 }, { transform: 'none', offset: 0.6 }, { transform: 'translateX(-1px)', offset: 0.63 }, { transform: 'translateX(1px)', offset: 0.66 }, { opacity: 1, filter: 'saturate(.2) brightness(1.5)', transform: 'none', offset: 0.69 }, { opacity: 0, offset: 0.7 }, { opacity: 0 }], { duration: D, easing: 'linear' });
      const ib = el(box, `left:-5px;top:-5px;width:${w + 10}px;height:${h + 10}px;border-radius:9px;overflow:hidden;border:1px solid #f2fbffcc;background:linear-gradient(135deg,rgba(232,249,255,.88),rgba(150,210,245,.55) 38%,rgba(214,243,255,.82) 58%,rgba(120,190,235,.6));box-shadow:0 0 14px #9fe0ffaa,inset 0 0 8px #ffffffaa;z-index:4`,
        `<div style="position:absolute;inset:0;background:linear-gradient(115deg,transparent 0 26%,#ffffff88 26% 30%,transparent 30% 57%,#ffffff66 57% 59%,transparent 59%)"></div><div class="sh" style="position:absolute;top:-20%;bottom:-20%;left:0;width:16px;background:linear-gradient(90deg,transparent,#ffffffee,transparent);transform:translateX(-30px) rotate(20deg)"></div>`);
      anim(ib, [{ opacity: 1, clipPath: 'circle(3% at 0% 50%)' }, { clipPath: 'circle(150% at 0% 50%)', offset: 0.3 }, { opacity: 1, clipPath: 'circle(150% at 0% 50%)', offset: 0.69 }, { opacity: 0, offset: 0.7 }, { opacity: 0 }], { duration: D, easing: 'linear' });
      anim(ib.querySelector('.sh'), [{ transform: 'translateX(-30px) rotate(20deg)' }, { transform: 'translateX(-30px) rotate(20deg)', offset: 0.3 }, { transform: `translateX(${w + 40}px) rotate(20deg)`, offset: 0.5 }, { transform: `translateX(${w + 40}px) rotate(20deg)` }], { duration: D });
      const cx = w * 0.45, cy = h * 0.5, lines = [[cx * 0.4, cy * 0.2], [w * 0.85, h * 0.15], [w * 0.8, h * 0.95], [w * 0.12, h * 0.9], [w * 0.55, 0]];
      const ck = el(box, `left:0;top:0;width:${w}px;height:${h}px;z-index:5;opacity:0`, svgNS(w, h, lines.map(([x, y]) => `<polyline points="${cx},${cy} ${((cx + x) / 2 + R(-6, 6)).toFixed(1)},${((cy + y) / 2 + R(-6, 6)).toFixed(1)} ${x},${y}" fill="none" stroke="#fff" stroke-width="1.4" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>`).join('')));
      anim(ck, [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.52 }, { opacity: 1, offset: 0.69 }, { opacity: 0, offset: 0.7 }, { opacity: 0 }], { duration: D, easing: 'linear' });
      for (const pl of ck.querySelectorAll('polyline')) anim(pl, [{ strokeDashoffset: 1 }, { strokeDashoffset: 1, offset: 0.5 }, { strokeDashoffset: 0, offset: 0.66 }, { strokeDashoffset: 0 }], { duration: D });
      const k = Math.max(1, Math.min(3, Math.sqrt(w * h) / 48));
      for (let i = 0; i < Math.round(16 * F()); i++) {
        const lx = R(0, w), ly = R(0, h), a = Math.atan2(ly - h / 2, lx - w / 2) + R(-0.3, 0.3), dd = R(22, 42) * k, x = Math.cos(a) * dd, y = Math.sin(a) * dd, s = R(6, 14) * Math.min(2, k);
        const d = el(box, `left:${lx}px;top:${ly}px;width:${s}px;height:${s}px;background:linear-gradient(135deg,#fff,#b8ecff 45%,#5ab8ee);clip-path:polygon(50% 0,100% 100%,0 72%);opacity:0;z-index:6`);
        anim(d, [{ opacity: 1, transform: 'none' }, { opacity: 1, transform: `translate(${x}px,${y}px) rotate(${Ri(80, 220)}deg)`, offset: 0.4 }, { opacity: 0, transform: `translate(${x * 1.3}px,${y + 28 * k}px) rotate(${Ri(260, 560)}deg)` }], { duration: D * 0.5, delay: D * 0.7, easing: 'cubic-bezier(.2,.7,.4,1)' });
      }
      boomAt(snap, D * 0.7, { cols: ['#ffffff', '#dff6ff', '#a8e4ff', '#5ab8ee', '#cfeeff'], edge: '#ffffff', spark: ['#ffffff', '#bfeaff'] });
      const mist = el(box, `left:${-w * 0.2}px;top:${-h * 0.2}px;width:${w * 1.4}px;height:${h * 1.4}px;border-radius:50%;background:radial-gradient(circle,#e8f8ffcc,transparent 65%);filter:blur(3px);opacity:0;z-index:5`);
      anim(mist, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: 'scale(1.7)' }], { duration: D * 0.4, delay: D * 0.7 });
      return D * 1.25;
    },
    dis(S, p, from, snap) { // il se désintègre (lumière, sable, pétales, pixels, ombre, aurore, runes, étoiles)
      const { g, w, h } = S, D = DUR(), v = p.dir === 'v';
      const grad = `linear-gradient(${v ? '180deg' : '90deg'},transparent 40%,#000 60%)`, size = v ? '100% 250%' : '250% 100%', a = v ? '0 100%' : '100% 0', b = '0 0';
      for (const k of ['maskImage', 'webkitMaskImage']) g.style[k] = grad;
      for (const k of ['maskSize', 'webkitMaskSize']) g.style[k] = size;
      for (const k of ['maskRepeat', 'webkitMaskRepeat']) g.style[k] = 'no-repeat';
      anim(g, [{ maskPosition: a, webkitMaskPosition: a, filter: 'none' }, { filter: p.fx || 'brightness(1.8)', maskPosition: a, webkitMaskPosition: a, offset: 0.15 }, { filter: p.fx || 'brightness(1.8)', maskPosition: b, webkitMaskPosition: b }], { duration: D * 0.85, easing: p.steps ? 'steps(8)' : 'linear' });
      const halo = el(S.box, `left:-10px;top:-10px;width:${w + 20}px;height:${h + 20}px;border-radius:14px;background:radial-gradient(ellipse,${(p.pc || GOLD)[0]}66 0,transparent 70%);opacity:0;z-index:0`);
      anim(halo, [{ opacity: 0 }, { opacity: 0.9, offset: 0.2 }, { opacity: 0.9, offset: 0.7 }, { opacity: 0 }], { duration: D });
      dust(snap, p, D);
      if (p.smoke) smokes(S, p.smoke, Math.round(6 * F()), { start: 0.15, spread: 0.5, dx: [10, 30], dy: [-30, -12], op: 0.85 });
      return D * 1.15;
    },
    zig(S, p) { // il tourne et zigzague jusqu'à disparaître
      const { g, w } = S, D = DUR(), k = Math.max(1, Math.min(4, w / 60)), fr = [{ transform: 'none', opacity: 1 }];
      for (let i = 1; i <= 8; i++) fr.push({ transform: `translate(${(i * 5.6 * k).toFixed(1)}px,${(i % 2 ? -11 : 9) * Math.min(2, k)}px) rotate(${i * 72}deg) scale(${(1 - i * 0.105).toFixed(2)})`, opacity: i > 6 ? 0.8 - (i - 6) * 0.4 : 1 });
      anim(g, fr, { duration: D, easing: 'linear' });
      for (let i = 0; i < 6; i++) { const d = el(S.box, `left:${-30}px;top:${R(0, S.h)}px;width:${R(30, 60) * k}px;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,#f2f8ff,transparent);opacity:0;z-index:5`); anim(d, [{ opacity: 0, transform: 'none' }, { opacity: 1, offset: 0.15 }, { opacity: 0, transform: `translateX(${w + 80}px)` }], { duration: D * 0.7, delay: R(0, 0.3) * D }); }
      if (p.kit === 'zig' && p.pc && p.shot === 'leaves') for (let i = 0; i < 8; i++) { const l = el(S.box, `left:${R(0, w)}px;top:${R(0, S.h)}px;width:11px;height:8px;border-radius:0 80% 0 80%;background:${pick(p.pc)};z-index:6`); anim(l, [{ transform: 'none', opacity: 1 }, { transform: `translate(${R(20, 80)}px,${R(-40, 30)}px) rotate(${Ri(180, 720)}deg)`, opacity: 0 }], { duration: D, delay: R(0, 0.3) * D }); }
      return D;
    },
    twist(S) { // aspiré en spirale vers le haut (tornade)
      const { box, g, w, h } = S, D = DUR(), fr = [{ transform: 'none', opacity: 1 }];
      for (let i = 1; i <= 8; i++) fr.push({ transform: `translate(${(i % 2 ? -1 : 1) * Math.min(10, w * 0.08)}px,${-i * h * 0.24}px) rotate(${i * 100}deg) scale(${(1 - i * 0.105).toFixed(2)})`, opacity: i > 6 ? 0.7 - (i - 6) * 0.35 : 1 });
      anim(g, fr, { duration: D, easing: 'linear' });
      const tw = Math.min(90, w * 0.9), t = el(box, `left:${w / 2 - tw / 2}px;top:${-h * 0.4}px;width:${tw}px;height:${h * 1.8}px;z-index:0`);
      for (let i = 0; i < 7; i++) { const rw = tw * (0.2 + i * 0.13), r = el(t, `left:${tw / 2 - rw / 2}px;bottom:${i * (h * 1.8 / 7)}px;width:${rw}px;height:12px;border-radius:50%;border:2px solid #dbeaf5bb;border-left-color:transparent`); anim(r, [{ transform: 'translateX(-12%) rotate(-4deg)' }, { transform: 'translateX(12%) rotate(4deg)' }], { duration: 400, iterations: Math.ceil(D / 400), direction: 'alternate', delay: -i * 70 }); }
      anim(t, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'none', offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: D * 1.1 });
      return D * 1.1;
    },
    melt(S, p) { // il fond en gouttes (lave, poison)
      const { box, g, w, h } = S, D = DUR(); g.style.transformOrigin = '50% 100%';
      anim(g, [{ transform: 'none', filter: 'none', opacity: 1 }, { filter: p.fx, offset: 0.12 }, { transform: 'scaleY(.86) scaleX(1.04) skewX(-5deg)', offset: 0.3 }, { transform: `translateY(${h * 0.15}px) scaleY(.5) scaleX(1.16) skewX(4deg)`, offset: 0.6 }, { transform: `translateY(${h * 0.35}px) scaleY(.12) scaleX(1.32)`, opacity: 0.85, offset: 0.88 }, { transform: `translateY(${h * 0.4}px) scaleY(0)`, opacity: 0 }], { duration: D });
      for (let i = 0; i < Math.round(8 * F() * Math.min(3, w / 60)); i++) { const d = el(box, `left:${R(2, w - 6)}px;top:${h - 4}px;width:5px;height:9px;border-radius:50% 50% 50% 50%/35% 35% 65% 65%;background:${p.drip};box-shadow:0 0 5px ${p.drip};opacity:0;z-index:5`); anim(d, [{ opacity: 0, transform: 'scaleY(.5)' }, { opacity: 1, transform: 'translateY(8px) scaleY(1.7)', offset: 0.4 }, { opacity: 0, transform: 'translateY(40px) scaleY(1)' }], { duration: D * 0.5, delay: R(0.1, 0.5) * D }); }
      const pool = el(box, `left:${-w * 0.1}px;top:${h * 0.85}px;width:${w * 1.2}px;height:${Math.max(10, h * 0.3)}px;border-radius:50%;background:radial-gradient(ellipse at 50% 40%,${p.drip},${p.c} 45%,transparent 75%);filter:blur(1px);opacity:0;z-index:0`);
      anim(pool, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 0.9, transform: 'scale(1)', offset: 0.5 }, { opacity: 0 }], { duration: D * 1.2 });
      smokes(S, '#7a6a5a', 3, { start: 0.3 });
      return D * 1.2;
    },
    suck(S, p) { // étiré et aspiré par le trou noir
      const { box, g, w, h } = S, D = DUR(), s = Math.min(w, h) * 1.2;
      const hole = el(box, `left:${w / 2 - s / 2}px;top:${h / 2 - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;background:radial-gradient(circle,#000 0 34%,#1a0838 46%,${p.c} 58%,transparent 70%);box-shadow:0 0 22px ${p.c}88;z-index:0`);
      anim(hole, [{ transform: 'scale(0) rotate(0)' }, { transform: 'scale(1) rotate(180deg)', offset: 0.2 }, { transform: 'scale(1.1) rotate(720deg)', offset: 0.8 }, { transform: 'scale(0) rotate(900deg)' }], { duration: D * 1.15 });
      anim(g, [{ transform: 'none', filter: 'none', opacity: 1 }, { transform: 'rotate(60deg) scale(.94) skewX(12deg)', filter: 'hue-rotate(220deg) brightness(.8)', offset: 0.25 }, { transform: 'rotate(230deg) scale(.68) skewX(24deg)', offset: 0.5 }, { transform: 'rotate(460deg) scale(.34) skewX(34deg)', offset: 0.75 }, { transform: 'rotate(650deg) scale(.04) skewX(40deg)', opacity: 0.6, offset: 0.95 }, { opacity: 0, transform: 'scale(0)' }], { duration: D, easing: 'ease-in' });
      const orb = el(box, `left:${w / 2}px;top:${h / 2}px;width:0;height:0;z-index:5`);
      for (let i = 0; i < 12; i++) el(orb, `width:3px;height:3px;border-radius:50%;background:#c9a8ff;box-shadow:0 0 5px ${p.c};transform:rotate(${i * 30}deg) translateX(${R(0.5, 0.9) * Math.max(w, h) / 2}px)`);
      anim(orb, [{ opacity: 0, transform: 'rotate(0) scale(1.3)' }, { opacity: 1, offset: 0.1 }, { opacity: 1, transform: 'rotate(900deg) scale(.1)', offset: 0.9 }, { opacity: 0, transform: 'scale(0)' }], { duration: D, easing: 'linear' });
      return D * 1.15;
    },
    wash(S) { // mouillé, roulé, emporté par la vague
      const { box, g, w, h } = S, D = DUR(), k = Math.max(1, Math.min(4, w / 60));
      anim(g, [{ transform: 'none', filter: 'none', opacity: 1 }, { filter: 'sepia(.4) hue-rotate(170deg) saturate(2.4) brightness(1.15)', offset: 0.08 }, { transform: `translate(${12 * k}px,${6}px) rotate(40deg)`, offset: 0.25 }, { transform: `translate(${28 * k}px,${h * 0.45}px) rotate(150deg) scale(.86)`, offset: 0.55 }, { transform: `translate(${46 * k}px,${h * 0.8}px) rotate(270deg) scale(.66)`, opacity: 0.6, offset: 0.85 }, { transform: `translate(${52 * k}px,${h}px) rotate(300deg) scale(.5)`, opacity: 0 }], { duration: D });
      const wv = el(box, `left:${-w * 0.3}px;top:${h * 0.2}px;width:${w * 0.7}px;height:${h * 1.1}px;z-index:4`, svgNS(80, 64, '<defs><linearGradient id="opsg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe6ff"/><stop offset=".35" stop-color="#4fa8f2"/><stop offset="1" stop-color="#1a5fb8"/></linearGradient></defs><path d="M0 64 C6 44 16 22 36 12 C52 4 70 8 74 22 C76 30 70 36 62 32 C60 24 52 22 46 26 C38 32 40 48 56 64 Z" fill="url(#opsg)"/><path d="M36 12 C52 4 70 8 74 22 C76 30 70 36 62 32" fill="none" stroke="#f2fbff" stroke-width="3.5" stroke-linecap="round"/>', 'width:100%;height:100%'));
      anim(wv, [{ transform: 'translateX(0) scaleY(0)', transformOrigin: '30% 100%', opacity: 1 }, { transform: 'translateX(10%) scaleY(1)', offset: 0.2 }, { transform: `translateX(${w * 1.2}px) scaleY(1)`, offset: 0.8, opacity: 0.8 }, { transform: `translateX(${w * 1.6}px) scaleY(0)`, opacity: 0 }], { duration: D });
      for (let i = 0; i < 10; i++) { const d = el(box, `left:${R(0, w * 0.4)}px;top:${R(0, h)}px;width:4px;height:4px;border-radius:50%;background:#bfe6ff;box-shadow:0 0 4px #7cc4ff;opacity:0;z-index:5`); anim(d, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translate(${R(-10, 40)}px,${R(-40, -10)}px)` }], { duration: D * 0.4, delay: D * 0.05 }); }
      return D;
    },
    lift(S, p) { // enfermé dans une bulle qui s'envole et éclate
      const { box, g, w, h } = S, D = DUR(), lift = -Math.max(80, h * 1.8);
      anim(g, [{ transform: 'none', opacity: 1 }, { transform: `translateY(${lift}px) rotate(-8deg) scale(.82)`, opacity: 1, offset: 0.82 }, { opacity: 0, transform: `translateY(${lift - 6}px)` }], { duration: D, easing: 'ease-in' });
      const b = el(box, `left:-12px;top:-12px;width:${w + 24}px;height:${h + 24}px;border-radius:50%;border:2px solid ${p.c}cc;background:radial-gradient(circle at 28% 26%,#ffffff66,transparent 22%),${p.c}1f;z-index:3`);
      anim(b, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)', offset: 0.15 }, { opacity: 1, transform: `translateY(${lift}px) scale(1.05)`, offset: 0.82 }, { opacity: 0, transform: `translateY(${lift - 4}px) scale(1.4)` }], { duration: D, easing: 'ease-in' });
      for (let i = 0; i < 10; i++) { const a = i * 36, d = el(box, `left:${w / 2}px;top:${h / 2 + lift}px;width:2px;height:8px;border-radius:2px;background:${p.c};transform-origin:50% 0;opacity:0;z-index:5`); anim(d, [{ opacity: 1, transform: `rotate(${a}deg) translateY(${Math.max(w, h) * 0.3}px)` }, { opacity: 0, transform: `rotate(${a}deg) translateY(${Math.max(w, h) * 0.6}px)` }], { duration: D * 0.25, delay: D * 0.84 }); }
      return D * 1.1;
    },
    crush(S, p, from, snap) { // écrasé, il part en morceaux
      const { g, h } = S, D = DUR();
      anim(g, [{ transform: 'none', filter: 'none', opacity: 1 }, { transform: `translateY(${h * 0.2}px) scaleY(.6) scaleX(1.14)`, filter: 'brightness(.8)', offset: 0.08 }, { transform: `translateY(${h * 0.22}px) scaleY(.56) scaleX(1.16)`, opacity: 1, offset: 0.24 }, { opacity: 0, offset: 0.25 }, { opacity: 0 }], { duration: D, easing: 'linear' });
      boomAt(snap, D * 0.24, { lift: 30, speed: [80, 420], size: [2, 7] });
      smokes(S, '#8a7058', Math.round(6 * F()), { start: 0.2, dx: [-24, 24], dy: [-26, -10], op: 0.9 });
      flash(S, p.c, 0.05, 0.6);
      return D;
    },
    pop(S, p, from, snap) { // il vibre, gonfle, puis éclate
      const { g } = S, D = DUR();
      anim(g, [{ transform: 'none', filter: 'none', opacity: 1 }, { transform: 'translateX(1.5px)', filter: `brightness(1.4) drop-shadow(0 0 6px ${p.c})`, offset: 0.1 }, { transform: 'translateX(-1.5px)', offset: 0.2 }, { transform: 'translateX(1.5px)', offset: 0.3 }, { transform: 'translateX(-1px) scale(1.04)', filter: `brightness(1.9) drop-shadow(0 0 8px ${p.c})`, offset: 0.4 }, { transform: 'scale(1.15)', filter: `brightness(2.6) drop-shadow(0 0 10px ${p.c})`, opacity: 1, offset: 0.5 }, { opacity: 0, transform: 'scale(1.2)', offset: 0.51 }, { opacity: 0 }], { duration: D, easing: 'linear' });
      flash(S, p.c, 0.5); rays(S, p.c, 10, 0.5);
      boomAt(snap, D * 0.5, { edge: (p.shard || [])[1], spark: [p.c, '#ffffff'], extra: p.shard });
      return D * 1.1;
    },
    confetti(S, p, from, snap) { // feu d'artifice : il explose en confettis
      const r = KITS.pop(S, p); const { box, w, h } = S, D = DUR();
      for (let i = 0; i < Math.round(26 * F()); i++) { const c = pick(p.pc), d = el(box, `left:${w / 2}px;top:${h / 2}px;width:${R(4, 7)}px;height:${R(3, 6)}px;background:${c};box-shadow:0 0 4px ${c};opacity:0;z-index:6`), a = R(0, Math.PI * 2), dd = R(20, 60) * Math.max(1, Math.min(3, w / 80)); anim(d, [{ opacity: 1, transform: 'none' }, { opacity: 1, transform: `translate(${Math.cos(a) * dd}px,${Math.sin(a) * dd * 0.7}px) rotate(${Ri(60, 300)}deg)`, offset: 0.4 }, { opacity: 0, transform: `translate(${Math.cos(a) * dd * 1.2}px,${Math.sin(a) * dd * 0.7 + 40}px) rotate(${Ri(300, 700)}deg)` }], { duration: D * 0.7, delay: D * 0.5 }); }
      rays(S, p.c, 15, 0.5, p.pc); boomAt(snap, DUR() * 0.5, { cols: p.pc, shape: 'flake', n: 500, speed: [150, 700], g: 500 }); return r;
    },
    fall(S, p) { // il tombe dans la faille
      const { box, g, w, h } = S, D = DUR();
      const cr = el(box, `left:${-w * 0.1}px;top:${h + 2}px;width:${w * 1.2}px;height:12px;z-index:0;filter:drop-shadow(0 0 4px #ff8a1a)`, svgNS(w * 1.2, 12, `<polyline points="${zigzag(0, 6, w * 1.2, 6, 10, 5)}" fill="none" stroke="${p.c}" stroke-width="3" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>`));
      anim(cr.querySelector('polyline'), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0, offset: 0.3 }, { strokeDashoffset: 0 }], { duration: D });
      anim(cr, [{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: D });
      anim(g, [{ transform: 'none', opacity: 1 }, { transform: 'translateX(-2px)', offset: 0.1 }, { transform: 'translateX(2px)', offset: 0.2 }, { transform: 'rotate(-8deg) translateY(2px)', offset: 0.32 }, { transform: 'rotate(6deg) translateY(4px)', offset: 0.42 }, { opacity: 0, transform: `translateY(${Math.max(80, h * 2)}px) rotate(26deg)` }], { duration: D, easing: 'ease-in' });
      smokes(S, '#8a7058', 5, { start: 0.3, dy: [-30, -14], dx: [-20, 20], op: 0.8 });
      return D;
    },
    drag(S, p) { // ligoté par les lianes, puis tiré sous terre
      const { box, g, w, h } = S, D = DUR();
      const v = el(box, `left:-4px;top:-4px;width:${w + 8}px;height:${h + 8}px;z-index:4`, svgNS(w + 8, h + 8, `<path d="M0 ${h + 8} C${w * 0.2} ${h * 0.7} 0 ${h * 0.4} ${w * 0.3} ${h * 0.35} S${w * 0.7} ${h * 0.8} ${w * 0.85} ${h * 0.25} S${w + 10} 0 ${w} -2" stroke="${p.c}" stroke-width="3" fill="none" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/><path d="M0 ${h * 0.25} C${w * 0.25} ${h * 0.55} ${w * 0.5} 0 ${w * 0.75} ${h * 0.5} S${w} ${h + 8} ${w + 8} ${h * 0.75}" stroke="#3fae4a" stroke-width="2.4" fill="none" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>`));
      for (const pa of v.querySelectorAll('path')) anim(pa, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0, offset: 0.3 }, { strokeDashoffset: 0 }], { duration: D });
      const drop = `translateY(${Math.max(60, h * 1.6)}px) scale(.8) rotate(-12deg)`;
      anim(v, [{ transform: 'none', opacity: 1 }, { transform: 'none', offset: 0.35 }, { transform: drop, opacity: 0 }], { duration: D, easing: 'ease-in' });
      anim(g, [{ transform: 'none', filter: 'none', opacity: 1 }, { filter: 'hue-rotate(70deg) saturate(1.4)', offset: 0.2 }, { transform: 'translateY(-3px) rotate(-3deg)', offset: 0.35 }, { transform: drop, opacity: 0 }], { duration: D, easing: 'ease-in' });
      return D;
    },
    carry(S, p) { // emporté par les corbeaux
      const { box, g, w, h } = S, D = DUR(), to = `translate(${Math.max(60, w * 0.6)}px,${-Math.max(84, h * 2)}px) rotate(14deg) scale(.6)`;
      anim(g, [{ transform: 'none', opacity: 1 }, { transform: 'none', offset: 0.2 }, { transform: to, opacity: 0 }], { duration: D, easing: 'ease-in' });
      for (const [x, d] of [[w * 0.25, 0], [w * 0.65, 0.05]]) {
        const r = el(box, `left:${x}px;top:-10px;width:26px;height:14px;z-index:5;filter:drop-shadow(0 0 2px #ffffff88)`, svgNS(26, 14, '<path d="M0 6Q6 0 11 6Q12 4 13 4.5Q14 4 15 6Q20 0 26 6Q20 4 15 9L13 13L11 9Q6 4 0 6Z" fill="#0b0d12"/><circle cx="14.2" cy="5.6" r=".8" fill="#fff"/>'));
        anim(r.firstChild, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(-.5)' }], { duration: 220, iterations: Math.ceil(D / 220), direction: 'alternate' });
        anim(r, [{ transform: `translate(${-w}px,${h * 0.3}px)`, opacity: 0 }, { transform: 'none', opacity: 1, offset: 0.2 }, { transform: to, opacity: 0.9 }], { duration: D, delay: d * D, easing: 'ease-in' });
      }
      return D * 1.05;
    },
    bif(S, p) { // il glisse sur l'arc-en-ciel et disparaît
      const { g, w, h } = S, D = DUR();
      anim(g, [{ transform: 'none', filter: 'none', opacity: 1 }, { filter: 'hue-rotate(260deg) saturate(2) brightness(1.4)', offset: 0.2 }, { transform: `translate(${Math.max(70, w * 0.8)}px,${-Math.max(40, h)}px) rotate(30deg) scale(.3)`, opacity: 0 }], { duration: D, easing: 'ease-in' });
      particles(S, p, { start: 0.2 }); return D;
    },
    pull(S, p, from) { // attiré et avalé par Odin
      const { g, w, h } = S, D = DUR(), r = S.box.getBoundingClientRect(), dx = from ? from.x - (r.left + w / 2) : -120, dy = from ? from.y - (r.top + h / 2) : 0;
      anim(g, [{ transform: 'none', opacity: 1 }, { transform: 'translateX(-3px)', offset: 0.08 }, { transform: 'translateX(3px)', offset: 0.16 }, { transform: 'translateX(-3px)', offset: 0.24 }, { transform: `translate(${dx * 0.7}px,${dy * 0.7}px) scaleX(1.6) scaleY(.6)`, offset: 0.75 }, { transform: `translate(${dx}px,${dy}px) scale(.05)`, opacity: 0 }], { duration: D, easing: 'ease-in' });
      return D;
    },
    halves(S, p) { // coupé en deux par le laser
      const { box, g, w, h } = S, D = DUR(), g2 = g.cloneNode(true); box.append(g2);
      g.style.clipPath = 'polygon(0 0,100% 0,100% 30%,0 70%)'; g2.style.clipPath = 'polygon(0 70%,100% 30%,100% 100%,0 100%)';
      const cut = el(box, `left:-4px;top:${h / 2 - 1}px;width:${w + 8}px;height:2px;background:#fff;box-shadow:0 0 6px ${p.c},0 0 12px ${p.c};transform:rotate(${-Math.atan2(h * 0.4, w) * 180 / Math.PI}deg);z-index:5`);
      anim(cut, [{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)', offset: 0.25 }, { opacity: 0, offset: 0.45 }, { opacity: 0 }], { duration: D });
      anim(g, [{ transform: 'none', opacity: 1 }, { transform: 'none', offset: 0.3 }, { transform: 'translate(-3px,-3px) rotate(-4deg)', offset: 0.45 }, { transform: `translate(-14px,${-Math.max(30, h * 0.8)}px) rotate(-26deg)`, opacity: 0 }], { duration: D });
      anim(g2, [{ transform: 'none', opacity: 1 }, { transform: 'none', offset: 0.3 }, { transform: 'translate(3px,3px) rotate(4deg)', offset: 0.45 }, { transform: `translate(16px,${Math.max(52, h * 1.3)}px) rotate(30deg)`, opacity: 0 }], { duration: D, easing: 'ease-in' });
      return D;
    },
  };

  // ---------------------------------------------------------------- ce qu'Odin lance (de lui jusqu'à l'élément)
  async function shoot(p, from, to) {
    if (!from) return;
    const L = getLayer(), dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy), T = Math.min(420, Math.max(220, dist * 0.55)), ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const ball = (bg, s, glow) => { const b = el(L, `left:${from.x - s / 2}px;top:${from.y - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;background:${bg};box-shadow:0 0 12px ${glow},0 0 22px ${glow}88;z-index:7`); anim(b, [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: 0.12 }, { transform: `translate(${dx}px,${dy}px)`, opacity: 1, offset: 0.92 }, { transform: `translate(${dx}px,${dy}px) scale(1.6)`, opacity: 0 }], { duration: T, easing: 'ease-in' }); setTimeout(() => b.remove(), T + 50); };
    const line = (bg, hgt, glow) => { const b = el(L, `left:${from.x}px;top:${from.y - hgt / 2}px;width:${dist}px;height:${hgt}px;border-radius:${hgt}px;background:${bg};box-shadow:0 0 6px ${glow},0 0 12px ${glow};transform-origin:0 50%;z-index:7`); anim(b, [{ transform: `rotate(${ang}deg) scaleX(0)`, opacity: 1 }, { transform: `rotate(${ang}deg) scaleX(1)`, opacity: 1, offset: 0.4 }, { transform: `rotate(${ang}deg) scaleX(1)`, opacity: 0 }], { duration: T * 1.4 }); setTimeout(() => b.remove(), T * 1.4 + 50); };
    const s = p.shot;
    if (s === 'fire' || s === 'meteors' || s === 'lava' || s === 'poison' || s === 'orb' || s === 'comet') ball({ fire: 'radial-gradient(circle at 60% 45%,#fffbe0 0,#ffd23a 25%,#ff6a1a 55%,#d4260a 78%)', meteors: 'radial-gradient(circle at 40% 40%,#fff3c0,#ff9a2a 45%,#8a3a10)', lava: 'radial-gradient(circle at 40% 40%,#ffe066,#ff7a00 50%,#b02000)', poison: 'radial-gradient(circle at 40% 40%,#e6ffb0,#8aff5a 45%,#3a8a20)', orb: 'radial-gradient(circle,#e6d9ff,#7c4dff 60%)', comet: 'radial-gradient(circle at 45% 45%,#fff,#b8f0ff 35%,#38b6ff 70%)' }[s], s === 'comet' ? 20 : 16, p.c);
    else if (s === 'jet') line('linear-gradient(90deg,#fff3b0,#ffb020 30%,#ff5a10 70%,rgba(255,60,0,0))', 18, '#ff7a1a');
    else if (s === 'laser') { line('linear-gradient(90deg,#ffd0d0,#ff2a2a)', 3, '#ff2a2a'); }
    else if (s === 'bolt' || s === 'storm') { const b = el(L, 'left:0;top:0;width:100%;height:100%;z-index:7', svgNS(innerWidth, innerHeight, `<polyline points="${zigzag(from.x, from.y, to.x, to.y, 8, 18)}" fill="none" stroke="${p.c}" stroke-width="7" opacity=".5" style="filter:blur(2px)"/><polyline points="${zigzag(from.x, from.y, to.x, to.y, 8, 18)}" fill="none" stroke="#fffbe0" stroke-width="2.6"/>`)); anim(b, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 0.2, offset: 0.3 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: T * 1.2, easing: 'steps(1)' }); setTimeout(() => b.remove(), T * 1.2 + 50); }
    else if (s === 'rainbow') line('linear-gradient(180deg,#ff4a4a,#ff9a2a,#ffe14a,#4adf6a,#4aa8ff,#9a6bff)', 10, '#ffffff55');
    else if (s === 'spear') line('linear-gradient(90deg,#6a4a2a,#c9a46a 90%,#fff6d0)', 4, '#ffd36a');
    else { // plusieurs petits projectiles : éclats de glace, bulles, étoiles, pétales, feuilles, pixels, rochers…
      const look = { shards: 'linear-gradient(90deg,#e8fbff,#7fd4ff);clip-path:polygon(0 50%,35% 0,100% 50%,35% 100%);width:24px;height:8px', bubbles: 'border-radius:50%;border:1.5px solid #bfe9ff;background:#6cc6ff22;width:12px;height:12px', stars: 'background:#ffe9a0;clip-path:polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);width:14px;height:14px', petals: 'border-radius:50% 0;background:linear-gradient(135deg,#ffe0ee,#ff8ac0);width:10px;height:7px', leaves: 'border-radius:0 80% 0 80%;background:#ff9a3d;width:11px;height:8px', pixels: 'background:#8fa0ff;width:6px;height:6px', rocks: 'background:linear-gradient(140deg,#c3a27a,#7a5e44 55%,#4a3828);clip-path:polygon(12% 30%,40% 4%,78% 10%,100% 48%,86% 92%,30% 100%,0 68%);width:18px;height:15px', snow: 'border-radius:50%;background:#f2fbff;width:5px;height:5px', crystals: 'background:linear-gradient(90deg,#e6d9ff,#a07cff);clip-path:polygon(50% 0,100% 30%,50% 100%,0 30%);width:12px;height:18px', rocket: 'background:#fff;width:4px;height:12px;border-radius:2px' }[s];
      if (look) for (let i = 0; i < (s === 'snow' ? 12 : 3); i++) { const b = el(L, `left:${from.x}px;top:${from.y}px;${look};z-index:7;filter:drop-shadow(0 0 4px ${p.c})`), oy = R(-14, 14); anim(b, [{ transform: `rotate(${ang}deg) scale(.4)`, opacity: 0 }, { opacity: 1, offset: 0.15 }, { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 24 + oy}px) rotate(${ang}deg)`, offset: 0.5 }, { transform: `translate(${dx}px,${dy + oy * 0.4}px) rotate(${ang}deg)`, opacity: 1, offset: 0.95 }, { opacity: 0 }], { duration: T, delay: i * 70 }); setTimeout(() => b.remove(), T + i * 70 + 60); }
      else if (s === 'ring' || s === 'wave' || s === 'quake') { const r = el(L, `left:${from.x - 5}px;top:${from.y - 5}px;width:10px;height:10px;border-radius:50%;border:2px solid ${p.c};box-shadow:0 0 8px ${p.c};z-index:7`); anim(r, [{ transform: 'scale(1)', opacity: 1 }, { transform: `scale(${dist / 5})`, opacity: 0 }], { duration: T * 1.2 }); setTimeout(() => r.remove(), T * 1.2 + 50); }
    }
    await wait(T * 0.9);
  }
  // Décor qui vient d'en haut ou d'autour de la cible (soleil, colonne de lumière, nuage, aurore, runes, sable, tornade…)
  function sky(p, S) {
    const { box, w, h } = S, D = DUR();
    if (p.shot === 'sun' || p.shot === 'column') { const c = el(box, `left:${-w * 0.1}px;top:${-Math.max(120, h * 3)}px;width:${w * 1.2}px;height:${Math.max(120, h * 3) + h}px;background:linear-gradient(${p.shot === 'sun' ? '180deg,#fff8d0,#ffd34a88 55%,transparent' : '90deg,transparent,#fff3c088 30%,#fffbe8cc 50%,#fff3c088 70%,transparent'});transform-origin:50% 0;z-index:0`); anim(c, [{ transform: 'scaleY(0)', opacity: 1 }, { transform: 'scaleY(1)', offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: D * 1.1 }); }
    if (p.shot === 'aurora') for (let i = 0; i < 2; i++) { const a = el(box, `left:${-w * 0.3}px;top:${-h * 0.6 + i * h * 0.4}px;width:${w * 1.6}px;height:${h}px;border-radius:50%;background:linear-gradient(90deg,transparent,#3dffb0aa,#7c4dffaa,#3dd6ff99,transparent);filter:blur(7px);z-index:0`); anim(a, [{ opacity: 0, transform: 'translateX(-20px) skewX(0)' }, { opacity: 0.95, transform: 'skewX(-12deg)', offset: 0.3 }, { transform: 'translateX(14px) skewX(10deg)', offset: 0.6 }, { opacity: 0 }], { duration: D * 1.1, delay: i * 120 }); }
    if (p.shot === 'runes') { const s = Math.max(w, h) * 1.3, r = el(box, `left:${w / 2 - s / 2}px;top:${h / 2 - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;border:1.5px solid #ffd36a;box-shadow:0 0 12px #ffd36a88,inset 0 0 12px #ffd36a55;z-index:2`); [...'ᚠᚢᚦᚨᚱᚲ'].forEach((g, i) => el(r, `left:50%;top:50%;width:16px;height:16px;margin:-8px;font:700 14px/16px serif;text-align:center;color:#ffe6a0;text-shadow:0 0 6px #ffb020;transform:rotate(${i * 60}deg) translateY(${-s / 2}px) rotate(${-i * 60}deg)`).textContent = g); anim(r, [{ opacity: 0, transform: 'scale(.4) rotate(0)' }, { opacity: 1, transform: 'scale(1) rotate(90deg)', offset: 0.3 }, { opacity: 1, transform: 'scale(1) rotate(260deg)', offset: 0.8 }, { opacity: 0, transform: 'scale(1.4) rotate(300deg)' }], { duration: D * 1.1 }); }
    if (p.shot === 'sand') { const s = el(box, `left:${-w * 0.3}px;top:${-h * 0.3}px;width:${w * 1.6}px;height:${h * 1.6}px;background:repeating-linear-gradient(100deg,transparent 0 9px,#e0b87066 9px 11px,transparent 11px 20px);z-index:5`); anim(s, [{ opacity: 0, backgroundPosition: '0 0' }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0, backgroundPosition: '180px 0' }], { duration: D * 1.1, easing: 'linear' }); }
    if (p.shot === 'storm') { const c = el(box, `left:${w / 2 - 26}px;top:${-36}px;width:52px;height:16px;border-radius:10px;background:#4a5366;box-shadow:-12px 3px 0 -1px #3c4454,14px 2px 0 -1px #3c4454,2px -7px 0 0 #566078;z-index:5`); anim(c, [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: D * 1.1 }); }
    if (p.shot === 'veil') { const v = el(box, `left:${-w * 1.2}px;top:${-h * 0.3}px;width:${w * 1.4}px;height:${h * 1.6}px;background:linear-gradient(90deg,#05030a 70%,rgba(5,3,10,0));z-index:4`); anim(v, [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${w * 1.2}px)`, offset: 0.35 }, { transform: `translateX(${w * 1.2}px)`, opacity: 1, offset: 0.7 }, { transform: `translateX(${w * 2.4}px)`, opacity: 0 }], { duration: D * 1.15 }); }
    if (p.shot === 'crystals') for (let i = 0; i < 3; i++) { const ch = h * R(0.6, 1.2), c = el(box, `left:${w * (0.25 + i * 0.25) - 8}px;top:${h - ch + 6}px;width:16px;height:${ch}px;background:linear-gradient(90deg,#e6d9ff,#a07cff 50%,#6b46c8);clip-path:polygon(50% 0,100% 25%,82% 100%,18% 100%,0 25%);transform-origin:50% 100%;filter:drop-shadow(0 0 5px #b48cff);z-index:4`); anim(c, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1.1)', offset: 0.25 }, { transform: 'scaleY(1)', opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: D, delay: i * 60 }); }
    if (p.shot === 'magnet') { /* l'aimant reste chez Odin */ }
  }

  // ---------------------------------------------------------------- détruire, faire apparaître, éclat
  let sound = null;
  function noise(kind) {
    if (!cfg.son) return;
    try {
      sound ??= new (window.AudioContext || window.webkitAudioContext)();
      const ctx = sound, t = ctx.currentTime, len = 0.35, buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** (kind === 'zap' ? 4 : 2);
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); src.buffer = buf;
      f.type = kind === 'ice' || kind === 'zap' ? 'highpass' : 'lowpass'; f.frequency.value = kind === 'burn' ? 900 : 1800; g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      src.connect(f).connect(g).connect(ctx.destination); src.start(t);
    } catch { /* pas de son ici */ }
  }
  /** Détruit (en animation) un élément qu'on vient de fermer ou de supprimer. `snap` : snapshot pris avant. */
  async function destroy(target, o = {}) {
    if (!can(o.when ?? 'ferme')) return false;
    const snap = target?.rect ? target : target instanceof Element ? snapshot(target) : null; if (!snap) return false;
    const id = o.power && P[o.power] ? o.power : choose(), p = P[id], from = mascotPoint();
    const to = { x: snap.rect.x + snap.rect.w / 2, y: snap.rect.y + snap.rect.h / 2 };
    const S = stage(snap); castFrom(from);
    if (from && p.shot !== 'none' && Math.hypot(to.x - from.x, to.y - from.y) > 30 && cfg.force !== 'discrete') await shoot(p, from, to);
    if (!cfg.actif) { S.box.remove(); return false; }
    sky(p, S); noise(p.kit);
    const ms = KITS[p.kit](S, p, from, snap);
    setTimeout(() => S.box.remove(), ms + 120);
    return id;
  }
  /** Fait apparaître un élément avec un pouvoir (lumière qui s'assemble, feu qui le révèle, glace qui éclate). */
  function appear(target, o = {}) {
    if (!can(o.when ?? 'ouvre') || !(target instanceof Element)) return false;
    const r = target.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return false;
    const id = o.power && P[o.power] ? o.power : choose(), p = P[id], D = DUR() * 0.85, L = getLayer();
    const S = { box: el(L, `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;overflow:visible`), w: r.width, h: Math.min(r.height, 160) };
    const kind = p.appear || 'light'; noise(kind === 'fire' ? 'burn' : kind);
    if (kind === 'fire') {
      anim(target, [{ clipPath: 'inset(0 0 100% 0)', filter: 'sepia(1) saturate(3) hue-rotate(-25deg) brightness(1.4)' }, { clipPath: 'inset(0 0 0 0)', filter: 'sepia(.6) saturate(2) hue-rotate(-20deg) brightness(1.3)', offset: 0.7 }, { clipPath: 'inset(0 0 0 0)', filter: 'none' }], { duration: D, fill: 'none', easing: 'linear' });
      const ff = el(S.box, `left:-6px;width:${S.w + 12}px;top:0;height:2px;z-index:5`), fh = Math.max(14, Math.min(28, r.height * 0.4));
      for (let x = -4; x < S.w + 8; x += Math.max(10, Math.min(14, S.w / 12))) { const f = el(ff, `left:${x}px;bottom:-2px;width:${fh * 0.62}px;height:${fh * R(0.75, 1.15)}px;border-radius:50% 50% 50% 50%/65% 65% 35% 35%;background:radial-gradient(circle at 50% 80%,#fff7c2 0,#ffc43a 26%,#ff6a1a 58%,rgba(255,80,20,0) 74%);transform-origin:50% 100%`); f.style.animation = `opFlick ${R(0.2, 0.3).toFixed(2)}s ease-in-out ${-R(0, 0.3).toFixed(2)}s infinite alternate`; }
      anim(ff, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 1, transform: `translateY(${r.height}px)`, offset: 0.7 }, { opacity: 0, transform: `translateY(${r.height}px)` }], { duration: D, easing: 'linear' });
    } else if (kind === 'teleport') {
      const col = el(S.box, `left:${-S.w * 0.08}px;top:${-innerHeight}px;width:${S.w * 1.16}px;height:${innerHeight * 2}px;background:linear-gradient(90deg,transparent,rgba(120,240,255,.25) 25%,rgba(230,255,255,.75) 50%,rgba(120,240,255,.25) 75%,transparent);z-index:0`);
      anim(col, [{ opacity: 0, transform: 'scaleX(0)' }, { opacity: 1, transform: 'scaleX(.6)', offset: 0.3 }, { opacity: 1, transform: 'scaleX(1)', offset: 0.6 }, { opacity: 0, transform: 'scaleX(.1)' }], { duration: D * 1.2 });
      anim(target, [{ transform: 'scaleX(0) scaleY(.03)', filter: 'brightness(5)', opacity: 1 }, { transform: 'scaleX(1.1) scaleY(.03)', filter: 'brightness(4)', offset: 0.3 }, { transform: 'scaleX(1) scaleY(1)', filter: 'sepia(1) hue-rotate(150deg) saturate(3) brightness(1.8)', offset: 0.6 }, { transform: 'none', filter: 'none' }], { duration: D * 1.2, fill: 'none', easing: 'cubic-bezier(.4,0,.2,1)' });
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 }, ps = []; for (let i = 0; i < 140 * Q(); i++) { const a2 = Math.random() * 7, d = R(60, 180); ps.push({ x: c.x + Math.cos(a2) * d, y: c.y + Math.sin(a2) * d * 0.5, vx: -Math.cos(a2) * d * 2.6, vy: -Math.sin(a2) * d * 1.3, g: 0, drag: 1, life: 0.38, s: R(1, 2.2), c: pick(['#ffffff', '#bff8ff', '#5fe6ff']), add: true, hold: 0.7 }); } PX.add(ps);
    } else if (kind === 'strike') {
      const L2 = getLayer(), tx = r.left + r.width / 2, pts = [[tx + R(-50, 50), -10]]; for (let i = 1; i <= 10; i++) pts.push([i < 10 ? tx + R(-24, 24) : tx, -10 + (r.top + 10) * (i / 10)]);
      const b = el(L2, 'left:0;top:0;z-index:22', svgNS(innerWidth, innerHeight, `<polyline points="${pts.map((x) => x.join(',')).join(' ')}" fill="none" stroke="#9fb4ff" stroke-width="8" opacity=".5" style="filter:blur(3px)"/><polyline points="${pts.map((x) => x.join(',')).join(' ')}" fill="none" stroke="#fff" stroke-width="2.6"/>`));
      anim(b, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 0.3, offset: 0.4 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 260, easing: 'steps(1)' }); setTimeout(() => b.remove(), 300);
      anim(target, [{ opacity: 0, filter: 'brightness(4) saturate(0)' }, { opacity: 0, offset: 0.3 }, { opacity: 1, filter: 'brightness(3) saturate(0)', offset: 0.35 }, { filter: 'invert(1)', offset: 0.45 }, { opacity: 1, filter: 'none' }], { duration: D, fill: 'none' });
      shatter({ x: r.left, y: r.top, w: r.width, h: 4 }, Math.round(90 * Q()), ['#ffffff', '#e8f0ff', '#9fb4ff'], { speed: [150, 600], g: 400, life: [0.2, 0.6], size: [1, 2], shape: 'spark', add: true, delay: 0.09 });
    } else if (kind === 'ice') {
      const ib = el(S.box, `left:-4px;top:-4px;width:${S.w + 8}px;height:${r.height + 8}px;border-radius:9px;border:1px solid #f2fbffcc;background:linear-gradient(135deg,rgba(232,249,255,.9),rgba(150,210,245,.6) 38%,rgba(214,243,255,.85) 58%,rgba(120,190,235,.6));box-shadow:0 0 12px #9fe0ffaa;z-index:4`);
      anim(ib, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)', offset: 0.3 }, { transform: 'translateX(1px)', offset: 0.5 }, { transform: 'translateX(-1px)', offset: 0.55 }, { opacity: 1, offset: 0.6 }, { opacity: 0, offset: 0.61 }, { opacity: 0 }], { duration: D * 1.2 });
      anim(target, [{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1, filter: 'saturate(.2) brightness(1.6)', offset: 0.61 }, { opacity: 1, filter: 'none' }], { duration: D * 1.2, fill: 'none' });
      shards({ ...S, h: r.height }, 12, '#5ab8ee', '#ffffff', { start: 0.6 });
    } else {
      const v = (p.dir === 'v'), grad = `linear-gradient(${v ? '180deg' : '90deg'},#000 40%,transparent 60%)`, size = v ? '100% 250%' : '250% 100%';
      const old = {}; for (const k of ['maskImage', 'webkitMaskImage', 'maskSize', 'webkitMaskSize', 'maskRepeat', 'webkitMaskRepeat']) old[k] = target.style[k];
      for (const k of ['maskImage', 'webkitMaskImage']) target.style[k] = grad;
      for (const k of ['maskSize', 'webkitMaskSize']) target.style[k] = size;
      for (const k of ['maskRepeat', 'webkitMaskRepeat']) target.style[k] = 'no-repeat';
      const a = v ? '0 100%' : '100% 0';
      const an = anim(target, [{ maskPosition: a, webkitMaskPosition: a, filter: 'brightness(2.2)' }, { maskPosition: a, webkitMaskPosition: a, offset: 0.35 }, { maskPosition: '0 0', webkitMaskPosition: '0 0', filter: 'brightness(1.3)', offset: 0.85 }, { maskPosition: '0 0', webkitMaskPosition: '0 0', filter: 'none' }], { duration: D * 1.15, fill: 'none', easing: 'linear' });
      an.finished.catch(() => {}).finally(() => { for (const [k, x] of Object.entries(old)) target.style[k] = x; });
      const n = Math.min(70, Math.max(16, Math.round((S.w * S.h) / 300 * F())));
      for (let i = 0; i < n; i++) { const x = R(0, S.w), y = R(0, S.h), s = R(2, 4), col = pick(p.pc || GOLD), d = el(S.box, `left:${x}px;top:${y}px;width:${s}px;height:${s}px;border-radius:50%;background:${col};box-shadow:0 0 5px ${col};opacity:0;z-index:5`); anim(d, [{ opacity: 0, transform: `translate(${R(-50, 50)}px,${R(-60, -20)}px) scale(.4)` }, { opacity: 1, offset: 0.15 }, { opacity: 1, transform: 'scale(1.2)', offset: 0.55 }, { opacity: 0, transform: 'none' }], { duration: D * 0.9, delay: (v ? y / S.h : x / S.w) * D * 0.25 }); }
    }
    setTimeout(() => S.box.remove(), D * 1.4);
    return id;
  }
  /** Petit éclat là où tu cliques (option). */
  function burst(x, y) {
    if (!can('clic')) return;
    const p = P[choose()], L = getLayer(), b = el(L, `left:${x}px;top:${y}px;width:0;height:0`);
    const ring = el(b, `left:-6px;top:-6px;width:12px;height:12px;border-radius:50%;border:2px solid ${p.c}`); anim(ring, [{ opacity: 1, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(3.4)' }], { duration: 320 });
    for (let a = 0; a < 360; a += 45) { const s = el(b, `left:-1px;top:-5px;width:2px;height:10px;border-radius:2px;background:linear-gradient(${p.c},transparent);transform-origin:50% 0`); anim(s, [{ opacity: 1, transform: `rotate(${a}deg) translateY(2px) scaleY(.4)` }, { opacity: 1, transform: `rotate(${a}deg) translateY(8px) scaleY(1)`, offset: 0.4 }, { opacity: 0, transform: `rotate(${a}deg) translateY(18px) scaleY(.3)` }], { duration: 320 }); }
    setTimeout(() => b.remove(), 380);
  }
  /** Coupe tout, tout de suite (pouvoirs désactivés). */
  function stopAll() { for (const a of [...live]) { try { a.cancel(); } catch { /* */ } } live.clear(); PX.clear(); if (layer) { layer.remove(); layer = null; } }
  function configure(c) {
    if (!c || typeof c !== 'object') return;
    cfg = { ...cfg, ...c, quand: { ...DEF.quand, ...(cfg.quand || {}), ...(c.quand || {}) } };
    try { localStorage.setItem('odin.pouvoirs', JSON.stringify(cfg)); } catch { /* */ }
    if (!cfg.actif) stopAll();
  }

  // ---------------------------------------------------------------- les déclencheurs, partout
  const CLOSE = /(^|\s)(×|✕|✖|x)(\s|$)|fermer|supprimer|retirer|effacer|enlever|oublier|close|delete|remove|dismiss|corbeille|🗑/i;
  const BOX = '[data-power-target],.notice,.hcard,.card,li,tr,.row,.item,.tile,.chip,.conv,.ut,.tab,article,section,[role=listitem],[role=tab],[role=dialog],dialog,.m-card,.panel';
  const label = (b) => `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''} ${b.textContent || ''} ${b.dataset.power || ''}`.trim();
  const gone = (e) => !e.isConnected || !e.getClientRects().length || getComputedStyle(e).visibility === 'hidden' || Number(getComputedStyle(e).opacity) === 0;
  function onClick(ev) {
    const t = ev.target instanceof Element ? ev.target : null; if (!t || t.closest('#odinPowers')) return;
    if (cfg.actif && cfg.quand.clic && !t.closest('input,textarea,select,[contenteditable=true]')) burst(ev.clientX, ev.clientY);
    const b = t.closest('button,a,[role=button]'); if (!b || !cfg.actif || b.dataset.power === 'non') return;
    const txt = label(b); if (!CLOSE.test(txt) || txt.length > 60) return;
    let box = b.closest(BOX); if (box && (box === document.body || box.classList.contains('view') || box.tagName === 'MAIN')) box = null;
    if (!box) return;
    const r = box.getBoundingClientRect(); if (r.width > innerWidth * 0.95 && r.height > innerHeight * 0.8) return;
    const snap = snapshot(box); if (!snap) return;
    const when = /supprim|retir|effac|corbeille|🗑|delete|remove|oubli/i.test(txt) ? 'supprime' : box.matches('dialog,[role=dialog]') ? 'fenetre' : 'ferme';
    let n = 0; const check = () => { n++; if (gone(box)) void destroy(snap, { when }); else if (n < 14) setTimeout(check, n < 3 ? 80 : 300); };
    setTimeout(check, 30);
  }
  // Une vue ou un onglet qui apparaît : le pouvoir fait naître son en-tête.
  const lastOn = new WeakSet();
  const views = new MutationObserver((ms) => {
    if (!cfg.actif) return;
    for (const m of ms) {
      const e = m.target; if (!(e instanceof Element)) continue;
      if (e.matches('dialog') && m.attributeName === 'open') { if (e.open && can('fenetre')) appear(e, { when: 'fenetre' }); continue; }
      const on = e.classList.contains('on') || (e.matches('[role=tabpanel],[data-power-tab]') && !e.hidden);
      if (!on) { lastOn.delete(e); continue; }
      if (lastOn.has(e)) continue; lastOn.add(e);
      if (!e.matches('.view,[role=tabpanel],[data-power-tab]')) continue;
      const head = e.querySelector(':scope > header, .vhead, h1, h2, [data-power-head]') || e;
      setTimeout(() => appear(head, { when: 'ouvre' }), 60);
    }
  });
  function start() {
    addEventListener('click', onClick, true);
    views.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'open'] });
    for (const v of document.querySelectorAll('.view.on,[role=tabpanel]:not([hidden]),[data-power-tab]:not([hidden])')) lastOn.add(v);
    reduce.addEventListener?.('change', () => { if (reduce.matches) stopAll(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopAll(); });
  }
  /** Odin se téléporte (quand il va loin et que les pouvoirs sont activés) : étincelles au départ et à l'arrivée. */
  function sparkle(x, y, n = 70) {
    if (!cfg.actif || reduce.matches) return;
    const ps = []; for (let i = 0; i < n * Q(); i++) { const a = Math.random() * 7, v = R(40, 220); ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, g: -40, life: R(0.3, 0.7), s: R(1, 2.4), c: pick(['#ffffff', '#bff8ff', '#5fe6ff', '#ffe9a0']), add: true }); }
    PX.add(ps);
  }
  window.OdinPowers = { POWERS: P, IDS, configure, destroy, appear, burst, sparkle, stop: stopAll, get cfg() { return { ...cfg }; },
    /** Essai depuis les réglages : un pouvoir sur un élément (même si les pouvoirs sont coupés). */
    async demo(target, id) { const keep = cfg.actif; cfg.actif = true; const q = cfg.quand; cfg.quand = { ...DEF.quand, ferme: true, ouvre: true }; try { const snap = snapshot(target); if (snap) { target.style.visibility = 'hidden'; await destroy(snap, { power: id }); await wait(DUR() * 1.3); target.style.visibility = ''; appear(target, { power: id }); } } finally { cfg.actif = keep; cfg.quand = q; } } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
