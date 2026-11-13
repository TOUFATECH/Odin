// Les pouvoirs d'Odin (maquettes validées) : 36 pouvoirs, chacun détruit ou fait apparaître un élément avec sa
// propre matière. Feu : il prend feu et brûle de bas en haut (flammes, braises, fumée). Foudre : arcs électriques
// puis explosion. Glace : il se congèle, la glace craque puis explose. Lumière : il se désintègre en particules.
// Sable : il s'efface en grains et part en fumée. Vent : il tourne et zigzague jusqu'à disparaître. Etc.
// Quand : un onglet ou une fenêtre s'ouvre ou se ferme, tu supprimes quelque chose (et, en option, un petit éclat
// là où tu cliques). Partout : l'interface d'Odin, l'écran de la maison (Hestia), ordinateur, téléphone.
// Règles : désactivés au départ ; coupés = plus rien et l'animation en cours s'arrête ; jamais pendant une vidéo,
// ni si l'appareil demande moins d'animations. Un pouvoir ne supprime rien : l'élément est déjà fermé, le pouvoir
// joue sur une copie (un « fantôme ») et ne retarde rien.
(() => {
  'use strict';
  if (window.OdinPowers) return;
  const reduce = matchMedia('(prefers-reduced-motion:reduce)');
  const DEF = { actif: false, quand: { ouvre: true, ferme: true, supprime: true, fenetre: true, clic: false }, choix: 'favoris', favoris: ['feu', 'glace', 'vague', 'aurore'], force: 'normale', son: false, pouvoir: undefined };
  let cfg = { ...DEF, quand: { ...DEF.quand } };
  try { const c = JSON.parse(localStorage.getItem('odin.pouvoirs') || 'null'); if (c && typeof c === 'object') cfg = { ...cfg, ...c, quand: { ...DEF.quand, ...(c.quand || {}) } }; } catch { /* */ }
  const R = (a, b) => a + Math.random() * (b - a), Ri = (a, b) => Math.round(R(a, b)), pick = (l) => l[Math.floor(Math.random() * l.length)];
  const GOLD = ['#fff3c0', '#ffd36a', '#ffffff', '#ffe9a0'];
  // ---------------------------------------------------------------- les 36 pouvoirs
  // kit : façon de détruire ; shot : ce qu'Odin lance ; c : couleur ; extra : décor du pouvoir autour de l'élément
  const P = {
    feu: { name: 'Boule de feu', c: '#ff7a1a', kit: 'engulf', shot: 'none', appear: 'fire' },
    jet: { name: 'Rayon de feu', c: '#ff8a1a', kit: 'beam', shot: 'none', appear: 'fire' },
    lave: { name: 'Lave', c: '#ff5a00', kit: 'lava', shot: 'none', drip: '#ff8a1a', fx: 'sepia(1) saturate(6) hue-rotate(-30deg) brightness(1.2)', appear: 'fire' },
    meteores: { name: 'Météores', c: '#ff6a1a', kit: 'craters', shot: 'none', appear: 'fire' },
    comete: { name: 'Comète', c: '#ff9a2a', kit: 'meteor', shot: 'none', appear: 'light', pc: ['#fff3c0', '#ffd36a', '#ff7a1a'] },
    vague: { name: 'Vague', c: '#3d9cf0', kit: 'waves', shot: 'none', appear: 'light', pc: ['#bfe6ff', '#3d9cf0', '#ffffff'] },
    bulles: { name: 'Bulles', c: '#7fd4ff', kit: 'bubbles', shot: 'none', appear: 'light', pc: ['#bfe9ff', '#7fd4ff'] },
    glace: { name: 'Glace', c: '#7fd4ff', kit: 'ice', shot: 'shards', appear: 'ice' },
    blizzard: { name: 'Blizzard', c: '#cfeeff', kit: 'blizzard', shot: 'snow', appear: 'ice' },
    rochers: { name: 'Rochers', c: '#b08a5a', kit: 'crush', shot: 'rocks', appear: 'light', pc: ['#c3a27a', '#8a7058'] },
    seisme: { name: 'Séisme', c: '#ffb35a', kit: 'quake', shot: 'none', appear: 'light', pc: ['#ffb35a', '#8a7058'] },
    sable: { name: 'Tempête de sable', c: '#e0b870', kit: 'dis', shot: 'none', dir: 'h', pc: ['#e0b870', '#c79a52', '#f2d49a', '#a8814a'], dx: [24, 60], dy: [-10, 14], glow: 0, fx: 'sepia(1) saturate(1.6) brightness(1.1)', grains: 2.2, appear: 'light' },
    cristaux: { name: 'Cristaux', c: '#b48cff', kit: 'pop', shot: 'crystals', shard: ['#6b46c8', '#e6d9ff'], appear: 'light', pc: ['#e6d9ff', '#b48cff'] },
    tornade: { name: 'Tornade', c: '#cfe3f0', kit: 'vortex', shot: 'none', appear: 'light', pc: ['#ffffff', '#cfe3f0'] },
    rafale: { name: 'Rafale', c: '#e8f2ff', kit: 'roll', shot: 'none', appear: 'light', pc: ['#ffffff', '#e8f2ff'] },
    foudre: { name: 'Foudre', c: '#f5d020', kit: 'thunder', shot: 'none', appear: 'light', pc: ['#fffbe0', '#f5d020'] },
    orage: { name: 'Orage', c: '#9fb4ff', kit: 'storm', shot: 'none', appear: 'light', pc: ['#dfe6ff', '#9fb4ff'] },
    etoiles: { name: 'Étoiles filantes', c: '#ffd36a', kit: 'dis', shot: 'stars', dir: 'h', pc: GOLD, dx: [-4, 18], dy: [-34, -12], fx: 'brightness(1.9) saturate(1.5)', appear: 'light' },
    soleil: { name: 'Rayon de soleil', c: '#ffe066', kit: 'dis', shot: 'none', dir: 'v', grains: 1.6, pc: GOLD, dx: [-6, 6], dy: [-36, -16], fx: 'brightness(2.4) saturate(.6)', appear: 'light' },
    aurore: { name: 'Aurore boréale', c: '#3dffb0', kit: 'dis', shot: 'none', dir: 'h', grains: 1.6, pc: ['#3dffb0', '#7c4dff', '#3dd6ff', '#b8ffe6'], dx: [-6, 16], dy: [-34, -14], fx: 'sepia(.5) hue-rotate(95deg) saturate(2.2) brightness(1.5)', appear: 'light' },
    trounoir: { name: 'Trou noir', c: '#9a6bff', kit: 'fold', shot: 'none', appear: 'light', pc: ['#c9a8ff', '#9a6bff'] },
    lianes: { name: 'Lianes', c: '#4fc35a', kit: 'vines', shot: 'none', appear: 'light', pc: ['#8fe08a', '#4fc35a'] },
    petales: { name: 'Pétales', c: '#ff9ac8', kit: 'dis', shot: 'petals', dir: 'h', pc: ['#ffc4dd', '#ff9ac8', '#ffe0ee', '#ffffff'], dx: [6, 28], dy: [6, 28], size: [5, 7], shape: '50% 0', glow: 0, rot: true, fx: 'hue-rotate(-40deg) brightness(1.5) saturate(1.5)', appear: 'light' },
    feuilles: { name: 'Feuilles d\'automne', c: '#ff9a3d', kit: 'leafcut', shot: 'none', appear: 'light', pc: ['#ff9a3d', '#e85d2a', '#f2c14a'] },
    poison: { name: 'Poison', c: '#8aff5a', kit: 'melt', shot: 'poison', drip: '#8aff5a', fx: 'hue-rotate(70deg) saturate(2.2) brightness(1.2)', appear: 'light', pc: ['#b8ff8a', '#8aff5a'] },
    laser: { name: 'Laser des yeux', c: '#ff2a2a', kit: 'halves', shot: 'laser', appear: 'light', pc: ['#ffd0d0', '#ff2a2a'] },
    runes: { name: 'Papyrus', c: '#ffd36a', kit: 'dis', shot: 'runes', dir: 'h', pc: GOLD, dx: [-6, 14], dy: [-30, -12], fx: 'sepia(1) saturate(4) brightness(1.7)', appear: 'light' },
    onde: { name: 'Onde de choc', c: '#9fd0ff', kit: 'pop', shot: 'ring', shard: ['#283044', '#b8dcff'], appear: 'light', pc: ['#dff0ff', '#9fd0ff'] },
    ombre: { name: 'Ombre', c: '#9a6bff', kit: 'dis', shot: 'veil', dir: 'h', pc: ['#2a1a4a', '#5b3fa8', '#140a24'], dx: [-4, 18], dy: [-30, -10], size: [3, 5], glow: 3, fx: 'brightness(.3) saturate(.4)', smoke: '#05030a', appear: 'light' },
    lumiere: { name: 'Lumière sacrée', c: '#ffe9a0', kit: 'holy', shot: 'none', dir: 'v', pc: GOLD, dx: [-6, 6], dy: [-44, -22], fx: 'brightness(2.6) saturate(.5)', appear: 'light' },
    pixels: { name: 'Pixels', c: '#5a6fdb', kit: 'pixelate', shot: 'pixels', dir: 'h', pc: ['#283044', '#3c4660', '#56617f', '#5a6fdb', '#8fa0ff'], dx: [-14, 30], dy: [-26, 20], size: [4, 6], shape: '0', glow: 0, steps: true, fx: 'contrast(1.4) brightness(1.2)', appear: 'light' },
    aimant: { name: 'Aimant', c: '#ff5a5a', kit: 'pull', shot: 'magnet', appear: 'light', pc: ['#ff9a9a', '#ff5a5a'] },
    gungnir: { name: 'Gungnir, la lance', c: '#ffd36a', kit: 'pop', shot: 'spear', shard: ['#283044', '#ffd36a'], appear: 'light', pc: GOLD },
    corbeaux: { name: 'Logos et Mnémosyne', c: '#c9d2e6', kit: 'carry', shot: 'ravens', appear: 'light', pc: ['#c9d2e6', '#ffffff'] },
    bifrost: { name: 'Bifröst', c: '#ff6ad5', kit: 'fly', shot: 'none', appear: 'light', pc: ['#ff4a4a', '#ffe14a', '#4adf6a', '#4aa8ff', '#9a6bff'] },
    eclair: { name: 'Éclair', c: '#9fb4ff', kit: 'strike', shot: 'none', appear: 'strike', pc: ['#ffffff', '#e8f0ff', '#9fb4ff'] },
    teleport: { name: 'Téléportation', c: '#5fe6ff', kit: 'vanish', shot: 'none', appear: 'teleport', pc: ['#ffffff', '#bff8ff', '#5fe6ff'] },
    artifice: { name: 'Feu d\'artifice', c: '#ff6ad5', kit: 'confetti', shot: 'rocket', appear: 'light', pc: ['#ff4a4a', '#ffe14a', '#4adf6a', '#4aa8ff', '#ff6ad5'] },
    // Nouveaux pouvoirs validés (maquette du 13/11) : joués par le nouveau moteur (powers3.js).
    givre: { name: 'Givre', c: '#bfe9ff', kit: 'ice', shot: 'none', appear: 'ice' },
    bulle_geante: { name: 'Bulle géante', c: '#a8dcff', kit: 'bubbles', shot: 'none', appear: 'light', pc: ['#ffffff', '#a8dcff', '#ffb3e6'] },
    mercure: { name: 'Métal liquide', c: '#c4cad4', kit: 'melt', shot: 'none', appear: 'light', pc: ['#ffffff', '#c4cad4'] },
    encre: { name: 'Tache d\'encre', c: '#2d1b4e', kit: 'dis', shot: 'none', dir: 'h', pc: ['#2a1a4a', '#140a24'], appear: 'light' },
    hologramme: { name: 'Hologramme', c: '#3af0ff', kit: 'vanish', shot: 'none', appear: 'teleport', pc: ['#ffffff', '#3af0ff'] },
    origami: { name: 'Origami', c: '#f2efe6', kit: 'fly', shot: 'none', appear: 'light', pc: ['#ffffff', '#f2efe6'] },
    plasma: { name: 'Plasma', c: '#ff5ac8', kit: 'pop', shot: 'none', shard: ['#3a1a99', '#ff5ac8'], appear: 'light', pc: ['#ffffff', '#ff5ac8', '#7d5cff'] },
    papillons: { name: 'Papillons', c: '#ff9ac8', kit: 'dis', shot: 'none', dir: 'h', pc: ['#ffc4dd', '#ff9ac8', '#ffffff'], appear: 'light' },
  };
  // Les pouvoirs proposés : ceux que tu as gardés (13/11). Les autres ne sont plus tirés au sort ni proposés.
  const KEPT = ['feu', 'vague', 'glace', 'blizzard', 'rochers', 'seisme', 'cristaux', 'aurore', 'gungnir', 'lianes', 'petales', 'feuilles', 'poison', 'teleport', 'pixels', 'givre', 'bulle_geante', 'mercure', 'encre', 'hologramme', 'origami', 'plasma', 'papillons', 'bulles', 'comete', 'corbeaux', 'eclair', 'etoiles', 'foudre', 'ombre', 'sable', 'trounoir'];
  const IDS = KEPT.filter((k) => P[k]);

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
    if (cfg.pouvoir && IDS.includes(cfg.pouvoir) && (cfg.choix === 'theme' || cfg.choix === 'meteo')) return cfg.pouvoir;
    if (cfg.choix === 'hasard') return pick(IDS);
    const f = (cfg.favoris || []).filter((x) => IDS.includes(x)); return f.length ? pick(f) : pick(IDS);
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
    return { rect: { x: r.left, y: r.top, w: r.width, h: r.height }, node: g, src, cap: window.OdinPowers3?.capture?.(src) || null };
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
  function shake(px = 6, ms = 380) { const L = getLayer(); for (const n of [L, document.querySelector('.view.on')].filter(Boolean)) /* jamais <body> : la couche fixe des pouvoirs disparaîtrait */ anim(n, [{ transform: 'none' }, { transform: `translate(${px}px,${-px / 2}px)` }, { transform: `translate(${-px}px,${px / 2}px)` }, { transform: `translate(${px / 2}px,${px / 3}px)` }, { transform: 'none' }], { duration: ms, fill: 'none' }); }
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
    if (!snap) return; const r = snap.rect, q = Q(), n = Math.round(Math.min(2400, (120 + (r.w * r.h) / 14) * (p.grains ?? 1)) * q), ps = [], v = p.dir === 'v';
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
        ring.style.background = o.clean ? `radial-gradient(circle at ${ax}px ${ay}px,transparent ${Math.max(0, r - 3)}px,${hot[0]} ${r - 1}px,${hot[2]} ${r + 1}px,transparent ${r + 4}px)` : `radial-gradient(circle at ${ax}px ${ay}px,transparent ${Math.max(0, r - 7)}px,${hot[0]} ${r - 2}px,${hot[2]} ${r + 2}px,rgba(110,30,0,.85) ${r + 7}px,rgba(30,10,4,.55) ${r + 16}px,transparent ${r + 30}px)`;
        if (!o.clean && k < 1 && r > 2) { const ps = []; for (let i = 0; i < 6 * q; i++) { const a = Math.random() * 6.283, x = ax + Math.cos(a) * r, y = ay + Math.sin(a) * r; if (x < 0 || y < 0 || x > w || y > h) continue; ps.push({ x: rect.left + x, y: rect.top + y, vx: Math.cos(a) * R(20, 90), vy: R(-160, -50), g: -30, drag: 0.97, wob: R(3, 8), life: R(0.4, 1), s: R(1, 2.6), c: pick(hot), add: true }); } if (ps.length) PX.add(ps); }
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
    beam(S, p, from, snap) { // un gros rayon jaillit d'Odin et balaie la fenêtre : elle se désagrège là où il passe, il la suit jusqu'à la fin
      const { g, w, h } = S, r = snap.rect, L = getLayer(), q = Q(), k = F(), EXT = 140, SW = DUR() * 1.5;
      const src = from ?? { x: -30, y: Math.max(40, r.y - 120) }, ltr = src.x <= r.x + r.w / 2, cols = colorsOf(snap.src ?? g);
      const th = Math.round(Math.max(22, Math.min(46, Math.min(r.w, r.h) * 0.34)) * Math.min(1.3, k));
      const beam = el(L, `left:${src.x}px;top:${src.y - th / 2}px;width:10px;height:${th}px;transform-origin:0 50%;z-index:20`);
      el(beam, `left:0;top:${-th * 0.6}px;width:100%;height:${th * 2.2}px;border-radius:${th}px;background:linear-gradient(180deg,transparent,rgba(255,110,20,.45) 30%,rgba(255,150,40,.6) 50%,rgba(255,110,20,.45) 70%,transparent);filter:blur(6px)`);
      const body = el(beam, `left:0;top:0;width:100%;height:100%;border-radius:${th}px;background:linear-gradient(180deg,rgba(255,80,10,0),#ff5a10 18%,#ffb020 38%,#fff3b0 50%,#ffb020 62%,#ff5a10 82%,rgba(255,80,10,0))`);
      el(beam, `left:0;top:${th / 2 - Math.max(3, th * 0.12)}px;width:100%;height:${Math.max(6, th * 0.24)}px;border-radius:9px;background:#fffef5;box-shadow:0 0 10px #fff,0 0 22px #ffe08a`);
      const rip = el(body, 'left:0;top:0;width:100%;height:100%;background:repeating-linear-gradient(90deg,rgba(255,255,255,0) 0 18px,rgba(255,255,255,.35) 22px,rgba(255,255,255,0) 30px);mix-blend-mode:screen');
      anim(rip, [{ backgroundPosition: '0 0' }, { backgroundPosition: '300px 0' }], { duration: 260, iterations: Math.ceil((EXT + SW) / 260) + 3, easing: 'linear' });
      const imp = el(L, `left:0;top:0;width:${th * 3}px;height:${th * 3}px;margin:${-th * 1.5}px 0 0 ${-th * 1.5}px;border-radius:50%;background:radial-gradient(circle,#ffffff 0,#fff3b0 20%,#ffb020 42%,rgba(255,90,20,.5) 58%,transparent 72%);z-index:21;opacity:0`);
      const mz = el(L, `left:${src.x - th}px;top:${src.y - th}px;width:${th * 2}px;height:${th * 2}px;border-radius:50%;background:radial-gradient(circle,#fffef5 0,#ffe08a 30%,#ff7a1a 55%,transparent 72%);z-index:21`);
      const born = performance.now();
      const tick = (now) => {
        if (!S.box.isConnected) { beam.remove(); imp.remove(); mz.remove(); return; }
        const t = now - born, f = Math.max(0, Math.min(1, (t - EXT) / SW)), ext = Math.min(1, t / EXT), end = t > EXT + SW;
        // le front de désagrégation avance d'un bord à l'autre ; le rayon vise ce front et monte et descend dessus
        const fx = ltr ? f * w : (1 - f) * w, fy = h * (0.5 + 0.38 * Math.sin(t / 95)), tx = r.x + fx, ty = r.y + fy;
        const m = ltr ? `linear-gradient(90deg,transparent ${(f * 100).toFixed(2)}%,#000 ${(f * 100 + 1.5).toFixed(2)}%)` : `linear-gradient(90deg,#000 ${((1 - f) * 100 - 1.5).toFixed(2)}%,transparent ${((1 - f) * 100).toFixed(2)}%)`;
        g.style.maskImage = m; g.style.webkitMaskImage = m;
        const dx = tx - src.x, dy = ty - src.y, len = Math.hypot(dx, dy) * ext, ang = Math.atan2(dy, dx) * 180 / Math.PI, thin = end ? Math.max(0, 1 - (t - EXT - SW) / 220) : 1;
        beam.style.width = `${len}px`; beam.style.transform = `rotate(${ang}deg) scaleY(${(thin * (0.92 + Math.random() * 0.16)).toFixed(3)})`;
        imp.style.left = `${src.x + dx * ext}px`; imp.style.top = `${src.y + dy * ext}px`; imp.style.opacity = t > EXT * 0.8 && !end ? String(0.85 + Math.random() * 0.15) : '0';
        mz.style.opacity = String(thin);
        if (t > EXT && !end) {
          const ps = [];
          for (let i = 0; i < 16 * q; i++) ps.push({ x: r.x + fx + R(-3, 3), y: r.y + R(0, h), vx: (ltr ? 1 : -1) * R(-20, 50) + R(-40, 40), vy: R(-90, -20), g: -10, drag: 0.98, wob: R(2, 6), life: R(0.5, 1.1), s: R(1.2, 3), c: pick(cols), shape: pick(['dot', 'square']) });
          for (let i = 0; i < 7 * q; i++) { const a = Math.atan2(-dy, -dx) + R(-1, 1), v = R(200, 560); ps.push({ x: tx, y: ty, vx: Math.cos(a) * v, vy: Math.sin(a) * v - R(0, 100), g: 800, life: R(0.2, 0.55), s: R(1, 2.2), c: pick(['#ffffff', '#fff3b0', '#ffd36a', '#ff8a1a']), shape: 'spark', add: true }); }
          PX.add(ps);
        }
        if (t < EXT + SW + 240) requestAnimationFrame(tick); else { beam.remove(); imp.remove(); mz.remove(); g.style.opacity = '0'; }
      };
      requestAnimationFrame(tick);
      return EXT + SW + 320;
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

  // ---------------------------------------------------------------- refaits d'après tes avis (12 novembre)
  /** Un morceau réel de l'élément : un clone découpé (clip-path en px dans la boîte). */
  function piece(S, clip, z = 2) {
    const { box, g, w, h } = S, wrap = el(box, `left:0;top:0;width:${w}px;height:${h}px;clip-path:${clip};-webkit-clip-path:${clip};z-index:${z}`), c = g.cloneNode(true);
    c.style.maskImage = ''; c.style.webkitMaskImage = ''; c.style.opacity = '1'; c.style.filter = 'none';
    wrap.append(c); return wrap;
  }
  /** Des morceaux irréguliers qui se touchent (grille aux sommets décalés). */
  function cells(w, h, cols, rows, jit = 0.28) {
    const V = [];
    for (let j = 0; j <= rows; j++) { V.push([]); for (let i = 0; i <= cols; i++) { const ex = i === 0 || i === cols, ey = j === 0 || j === rows; V[j].push([(i / cols) * w + (ex ? 0 : R(-jit, jit) * w / cols), (j / rows) * h + (ey ? 0 : R(-jit, jit) * h / rows)]); } }
    const out = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const pts = [V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i]]; out.push({ i, j, cx: pts.reduce((a, q) => a + q[0], 0) / 4, cy: pts.reduce((a, q) => a + q[1], 0) / 4, clip: `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})` }); }
    return out;
  }
  /** Des trous qui s'ouvrent dans l'élément (bulles, météores). */
  function holes(S) {
    const { g } = S, list = []; let raf = 0;
    const paint = () => {
      const now = performance.now(); let busy = false;
      const m = list.map((o) => { const k = Math.min(1, Math.max(0, (now - o.t0) / o.d)); if (k < 1) busy = true; const r = o.r * (1 - (1 - k) ** 2); return `radial-gradient(circle at ${o.x}px ${o.y}px,transparent ${r}px,#000 ${r + 1.5}px)`; }).join(',');
      g.style.webkitMaskImage = m; g.style.maskImage = m; g.style.maskComposite = 'intersect'; g.style.webkitMaskComposite = 'source-in';
      raf = busy && S.box.isConnected ? requestAnimationFrame(paint) : 0;
    };
    return (x, y, r, d = 260) => { list.push({ x, y, r, d, t0: performance.now() }); if (!raf) raf = requestAnimationFrame(paint); };
  }
  /** L'élément explose d'un coup en mille morceaux, à partir d'un point. */
  function explodeNow(S, snap, at, o = {}) {
    const { g } = S, r = snap.rect, q = Q();
    anim(g, [{ opacity: 1, filter: o.hot ?? 'brightness(3)' }, { opacity: 0, filter: o.hot ?? 'brightness(3)' }], { duration: 80 });
    const cols = (o.cols ?? colorsOf(snap.src ?? g)).concat(o.extra ?? []);
    shatter(r, Math.round(Math.min(o.max ?? 1300, (o.base ?? 320) + (r.w * r.h) / 28) * q), cols, { at, speed: o.speed ?? [180, 950], g: o.g ?? 1100, size: o.size ?? [1, 4], life: [0.7, 1.6], edge: o.edge, lift: 180, shape: o.shape });
    if (o.spark) shatter(r, Math.round(220 * q), o.spark, { at, speed: [300, 1200], g: 300, life: [0.2, 0.6], size: [1, 2.2], shape: 'spark', add: true });
  }
  /** Un éclair dessiné d'un point à un autre, avec ses branches. */
  function bolt(x0, y0, x1, y1, o = {}) {
    const L = getLayer(), n = 14, pts = [[x0, y0]];
    for (let i = 1; i <= n; i++) { const t = i / n; pts.push([x0 + (x1 - x0) * t + (i < n ? R(-28, 28) : 0), y0 + (y1 - y0) * t]); }
    let br = ''; for (let i = 3; i < n - 1; i += 3) { const [bx, by] = pts[i]; br += `<polyline points="${bx.toFixed(1)},${by.toFixed(1)} ${(bx + R(-60, 60)).toFixed(1)},${(by + R(30, 70)).toFixed(1)} ${(bx + R(-90, 90)).toFixed(1)},${(by + R(70, 130)).toFixed(1)}" fill="none" stroke="#e8f0ff" stroke-width="1.6"/>`; }
    const main = pts.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' '), wd = o.width ?? 4, ms = o.ms ?? 320, delay = o.delay ?? 0;
    const b = el(L, 'left:0;top:0;z-index:22;opacity:0', svgNS(innerWidth, innerHeight, `<polyline points="${main}" fill="none" stroke="${o.glow ?? '#9fb4ff'}" stroke-width="${wd * 4}" opacity=".5" style="filter:blur(5px)"/><polyline points="${main}" fill="none" stroke="#ffffff" stroke-width="${wd}" stroke-linejoin="round"/>${br}`));
    anim(b, [{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0.3, offset: 0.4 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration: ms, delay, easing: 'steps(1)', fill: 'forwards' });
    setTimeout(() => b.remove(), ms + delay + 40);
  }
  /** Une boule (météorite, lave) qui tombe du ciel jusqu'à un point. Rend la durée avant l'impact. */
  function fallFromSky(tx, ty, s0, delay, cols = ['#fff3c0', '#ff9a2a', '#8a3a10'], src) {
    const L = getLayer(), q = Q(), sx = src?.x ?? tx - Math.min(300, innerWidth * 0.3) + R(-60, 60), sy = src?.y ?? -80, T = src ? Math.min(560, Math.max(320, Math.hypot(tx - sx, ty - sy) * 0.6)) : 480;
    const head = el(L, `left:${sx - s0 / 2}px;top:${sy - s0 / 2}px;width:${s0}px;height:${s0}px;border-radius:50%;background:radial-gradient(circle at 40% 40%,${cols[0]},${cols[1]} 40%,${cols[2]} 78%);box-shadow:0 0 18px ${cols[1]},0 0 40px ${cols[1]}88;z-index:21;opacity:0`);
    anim(head, [{ transform: 'translate(0,0) scale(.6)', opacity: 1 }, { transform: `translate(${tx - sx}px,${ty - sy}px) scale(1)`, opacity: 1, offset: 0.97 }, { transform: `translate(${tx - sx}px,${ty - sy}px)`, opacity: 0 }], { duration: T, delay, easing: src ? 'ease-in' : 'cubic-bezier(.5,0,1,1)', fill: 'forwards' });
    setTimeout(() => head.remove(), T + delay + 40);
    const tr = []; for (let i = 0; i < 55 * q; i++) { const t = i / (55 * q), x = sx + (tx - sx) * t ** (src ? 1.4 : 2.2), y = sy + (ty - sy) * t ** (src ? 1.4 : 2.2); tr.push({ x, y, vx: R(-20, 20), vy: R(-25, 10), g: 0, life: R(0.3, 0.7), s: R(2, 4.5) * Math.min(1.5, s0 / 30), c: pick([cols[0], cols[1]]), add: true, delay: (delay + T * t ** 0.8) / 1000 }); }
    PX.add(tr); return delay + T;
  }
  const bgOf = (g) => { const c = getComputedStyle(g).backgroundColor; return !c || c === 'rgba(0, 0, 0, 0)' ? '#283044' : c; };

  Object.assign(KITS, {
    vanish(S) { // téléportation : quelques sauts d'image, il s'écrase en un trait, plus rien. Pas de lumière.
      const { box, g, h } = S, D = 560, n = 5;
      g.style.opacity = '0';
      for (let i = 0; i < n; i++) {
        const a = (i / n) * h, b = ((i + 1) / n) * h, pc = piece(S, `inset(${a.toFixed(1)}px 0 ${(h - b).toFixed(1)}px 0)`);
        anim(pc, [{ transform: 'none' }, { transform: `translateX(${R(-16, 16)}px)`, offset: 0.12 }, { transform: 'none', offset: 0.2 }, { transform: `translateX(${R(-26, 26)}px)`, offset: 0.32 }, { transform: 'none', offset: 0.42 }, { transform: 'none' }], { duration: D, easing: 'steps(1)' });
      }
      box.style.transformOrigin = '50% 50%';
      anim(box, [{ transform: 'none', opacity: 1 }, { opacity: 0.35, offset: 0.16 }, { opacity: 1, offset: 0.24 }, { transform: 'none', opacity: 1, offset: 0.5 }, { transform: 'scaleX(1.05) scaleY(.03)', opacity: 1, offset: 0.78 }, { transform: 'scaleX(0) scaleY(.03)', opacity: 0 }], { duration: D, easing: 'linear' });
      return D + 60;
    },
    fly(S, p, from, snap) { // Bifröst : des bulles arc-en-ciel tombent du ciel, éclatent sur la fenêtre, et elle explose avec elles
      return KITS.bubbles(S, { ...p, rainbow: true }, from, snap);
    },
    blizzard(S, p, from, snap) { // il gèle, la glace explose, puis un vent glacé emporte les éclats et la neige
      const ms = KITS.ice(S, p, from, snap), D = DUR() * 1.15, r = snap.rect, q = Q(), L = getLayer(), dir = from && from.x > r.x + r.w / 2 ? -1 : 1;
      setTimeout(() => {
        const ps = [];
        for (let i = 0; i < Math.round(Math.min(900, 220 + (r.w * r.h) / 40) * q); i++) ps.push({ x: r.x + Math.random() * r.w, y: r.y + Math.random() * r.h, vx: dir * R(450, 1300), vy: R(-140, 90), g: 80, drag: 0.99, life: R(0.6, 1.3), s: R(1.2, 4.2), c: pick(['#ffffff', '#dff6ff', '#a8e4ff', '#cfeeff', '#5ab8ee']), shape: pick(['shard', 'flake', 'dot']), vr: R(-10, 10) });
        for (let i = 0; i < 200 * q; i++) ps.push({ x: dir > 0 ? R(-260, r.x + r.w) : R(r.x, innerWidth + 260), y: r.y + R(-r.h, r.h * 2), vx: dir * R(900, 1600), vy: R(-50, 70), g: 0, life: R(0.5, 1.1), s: R(1, 2.4), c: pick(['#f2fbff', '#ffffff', '#cfeeff']), shape: pick(['spark', 'dot']), add: true, delay: R(0, 0.3) });
        PX.add(ps);
        for (let i = 0; i < 9; i++) { const ln = el(L, `left:${dir > 0 ? -300 : innerWidth}px;top:${r.y + R(-r.h * 0.6, r.h * 1.6)}px;width:${R(160, 320)}px;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,#eaf8ffcc,transparent);z-index:20`); anim(ln, [{ transform: 'translateX(0)', opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: `translateX(${dir * (innerWidth + 600)}px)`, opacity: 0 }], { duration: R(650, 950), delay: R(0, 300), easing: 'linear', fill: 'forwards' }); setTimeout(() => ln.remove(), 1300); }
      }, D * 0.7);
      return Math.max(ms, D * 0.7 + 1300);
    },
    bubbles(S, p, from, snap) { // des bulles arrivent ; chacune éclate et fait éclater un bout de la fenêtre ; la dernière la fait exploser
      const { g, w, h } = S, r = snap.rect, L = getLayer(), q = Q(), hole = holes(S), rb = !!p.rainbow, n = Math.max(rb ? 6 : 4, Math.min(rb ? 9 : 7, Math.round((w * h) / 9000) + (rb ? 5 : 3))), src0 = from ?? { x: r.x + r.w / 2, y: innerHeight + 30 }, RB = ['#ff4a4a', '#ff9a2a', '#ffe14a', '#4adf6a', '#4aa8ff', '#9a6bff', '#ff6ad5'];
      let last = 0;
      for (let i = 0; i < n; i++) {
        const fin = i === n - 1, bx = fin ? w / 2 : R(w * 0.12, w * 0.88), by = fin ? h / 2 : R(h * 0.15, h * 0.85), s = fin ? Math.max(44, Math.min(96, Math.min(w, h) * 0.75)) : R(24, 42), T = R(420, 600), delay = i * (rb ? 130 : 190), src = rb ? { x: r.x + bx + R(-90, 90), y: -s - R(10, 80) } : src0;
        const b = el(L, `left:${src.x - s / 2}px;top:${src.y - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;border:1.5px solid #e6f6ffdd;background:${rb ? 'radial-gradient(circle at 32% 30%,#ffffffee 0,#ffffff66 12%,transparent 30%),conic-gradient(from ' + Ri(0, 360) + 'deg,#ff4a4a66,#ffe14a66,#4adf6a66,#4aa8ff66,#9a6bff66,#ff6ad566,#ff4a4a66)' : 'radial-gradient(circle at 32% 30%,#ffffffdd 0,#ffffff55 12%,#7fd4ff22 42%,#3d9cf011 70%),radial-gradient(circle at 70% 75%,#c9a8ff44,transparent 50%)'};box-shadow:inset 0 0 9px ${rb ? '#ffffffaa' : '#bfe9ff99'},0 0 10px ${rb ? '#ff9ad899' : '#7fd4ff66'};z-index:21;opacity:0`);
        const ex = r.x + bx - src.x, ey = r.y + by - src.y, wob = R(-50, 50);
        anim(b, [{ transform: 'translate(0,0) scale(.3)', opacity: 1 }, { transform: `translate(${(ex * 0.5 + wob).toFixed(1)}px,${(ey * 0.5 - 30).toFixed(1)}px) scale(.9)`, opacity: 1, offset: 0.5 }, { transform: `translate(${ex.toFixed(1)}px,${ey.toFixed(1)}px) scale(1)`, opacity: 1, offset: 0.88 }, { transform: `translate(${ex.toFixed(1)}px,${ey.toFixed(1)}px) scale(1.14,.88)`, opacity: 1 }], { duration: T, delay, easing: 'ease-in-out', fill: 'forwards' });
        const at = delay + T + (fin ? 140 : 30); last = Math.max(last, at);
        setTimeout(() => {
          b.remove(); const X = r.x + bx, Y = r.y + by, drops = [];
          for (let k = 0; k < 30 * q; k++) { const a = Math.random() * 6.283, v = R(140, 420); drops.push({ x: X + Math.cos(a) * s / 2, y: Y + Math.sin(a) * s / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, g: 700, life: R(0.3, 0.7), s: R(1.2, 2.8), c: pick(rb ? RB : ['#ffffff', '#bfe9ff', '#7fd4ff']), add: true }); }
          PX.add(drops);
          const ring = el(L, `left:${X - s / 2}px;top:${Y - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;border:2px solid ${rb ? pick(RB) : '#e6f6ff'};z-index:21`); anim(ring, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.9)', opacity: 0 }], { duration: 280, fill: 'forwards' }); setTimeout(() => ring.remove(), 300);
          if (!fin) { hole(bx, by, s * 0.8, 180); shatter({ x: X - s * 0.6, y: Y - s * 0.6, w: s * 1.2, h: s * 1.2 }, Math.round(80 * q), colorsOf(snap.src ?? g).concat(rb ? RB : []), { at: { x: X, y: Y }, speed: [120, 460], g: 900, size: [1.2, 3.6], life: [0.5, 1.1] }); }
          else { shake(4, 260); explodeNow(S, snap, { x: X, y: Y }, rb ? { extra: RB, spark: ['#ffffff', ...RB], speed: [180, 900], hot: 'brightness(1.8) saturate(2)' } : { spark: ['#ffffff', '#bfe9ff', '#7fd4ff'], speed: [160, 820], hot: 'brightness(1.6) hue-rotate(160deg)' }); }
        }, at);
      }
      return last + DUR();
    },
    leafcut(S, p, from, snap) { // des feuilles d'automne arrivent ; à leur contact, l'onglet se découpe en feuilles qui tombent en virevoltant
      const { box, g, w, h } = S, r = snap.rect, L = getLayer(), src = from ?? { x: -30, y: r.y - 60 }, T = 540, D = DUR() * 1.7;
      const LEAF = (c) => svgNS(22, 22, `<path d="M11 1 C17 6 20 12 11 21 C2 12 5 6 11 1Z" fill="${c}"/><path d="M11 3 V20" stroke="#7a3a10" stroke-width=".9"/>`);
      for (let i = 0; i < 7; i++) { const lf = el(L, `left:${src.x - 11}px;top:${src.y - 11}px;width:22px;height:22px;z-index:21;opacity:0`, LEAF(pick(['#ff9a3d', '#e85d2a', '#f2c14a', '#c9471c']))), tx = r.x + R(0.08, 0.92) * r.w - src.x, ty = r.y + R(0.1, 0.9) * r.h - src.y; anim(lf, [{ transform: 'translate(0,0) rotate(0) scale(.6)', opacity: 1 }, { transform: `translate(${(tx * 0.5 + R(-50, 50)).toFixed(1)}px,${(ty * 0.5 - 40).toFixed(1)}px) rotate(${R(180, 400).toFixed(0)}deg) scale(1.15)`, opacity: 1, offset: 0.5 }, { transform: `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) rotate(${R(500, 800).toFixed(0)}deg) scale(1)`, opacity: 1 }], { duration: T, delay: i * 35, easing: 'ease-in', fill: 'forwards' }); setTimeout(() => lf.remove(), T + i * 35 + 30); }
      const cols = Math.max(3, Math.min(8, Math.round(w / 52))), rows = Math.max(2, Math.min(5, Math.round(h / 42))), cw = w / cols, ch = h / rows, leaves = [];
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const cx = (i + 0.5) * cw + R(-cw * 0.08, cw * 0.08), cy = (j + 0.5) * ch + R(-ch * 0.08, ch * 0.08), hw = cw * 0.78, hh = ch * 0.82, a = (R(-40, 40) * Math.PI) / 180;
        const P2 = (x, y) => `${(cx + x * Math.cos(a) - y * Math.sin(a)).toFixed(1)} ${(cy + x * Math.sin(a) + y * Math.cos(a)).toFixed(1)}`;
        leaves.push({ cx, cy, d: `M${P2(0, -hh)} C${P2(hw * 1.15, -hh * 0.45)} ${P2(hw * 0.95, hh * 0.55)} ${P2(0, hh)} C${P2(-hw * 0.95, hh * 0.55)} ${P2(-hw * 1.15, -hh * 0.45)} ${P2(0, -hh)}Z` });
      }
      const cut = el(box, `left:0;top:0;width:${w}px;height:${h}px;z-index:6;opacity:0`, svgNS(w, h, leaves.map((l) => `<path d="${l.d}" fill="none" stroke="#ffcf70" stroke-width="1.6" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" style="filter:drop-shadow(0 0 3px #ff9a3d)"/>`).join('')));
      setTimeout(() => {
        anim(cut, [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 420, fill: 'forwards' });
        for (const pa of cut.querySelectorAll('path')) anim(pa, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 240, delay: R(0, 80), fill: 'forwards' });
        anim(g, [{ filter: 'none' }, { filter: 'sepia(.5) saturate(1.8) hue-rotate(-15deg)' }], { duration: 300, fill: 'forwards' });
      }, T - 60);
      setTimeout(() => {
        g.style.opacity = '0';
        for (const l of leaves.sort(() => Math.random() - 0.5)) {
          const pc = piece(S, `path('${l.d}')`, 3); pc.style.transformOrigin = `${l.cx.toFixed(1)}px ${l.cy.toFixed(1)}px`;
          const fall = innerHeight - (r.y + l.cy) + 80, sway = R(30, 70) * (Math.random() < 0.5 ? -1 : 1), rot = R(160, 420) * (Math.random() < 0.5 ? -1 : 1), kf = [];
          for (let k = 0; k <= 8; k++) { const t = k / 8; kf.push({ transform: `translate(${(Math.sin(t * Math.PI * 2.2) * sway + t * sway * 0.6).toFixed(1)}px,${(t ** 1.6 * fall - Math.sin(t * Math.PI) * 18).toFixed(1)}px) rotate(${(t * rot).toFixed(0)}deg) rotateX(${(Math.sin(t * Math.PI * 3) * 55).toFixed(0)}deg) scale(${k === 0 ? 1 : 1.04 - t * 0.25})`, filter: `sepia(${(0.5 + t * 0.5).toFixed(2)}) saturate(${(1.8 + t * 1.5).toFixed(2)}) hue-rotate(-15deg) brightness(${(1 + t * 0.2).toFixed(2)})`, opacity: t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1, offset: t }); }
          anim(pc, kf, { duration: D * R(0.85, 1.15), delay: R(0, D * 0.35), easing: 'linear', fill: 'both' });
        }
      }, T + 280);
      return T + 280 + D * 1.55;
    },
    thunder(S, p, from, snap) { // la foudre tombe du ciel ; dès qu'elle touche l'onglet, il explose en mille morceaux
      const r = snap.rect, L = getLayer(), tx = r.x + r.w * R(0.35, 0.65), ty = r.y + 4, HIT = 150;
      const dark = el(L, 'left:0;top:0;width:100vw;height:100vh;background:#05060f;z-index:2'); anim(dark, [{ opacity: 0 }, { opacity: 0.5, offset: 0.3 }, { opacity: 0 }], { duration: 560, fill: 'forwards' }); setTimeout(() => dark.remove(), 580);
      bolt(tx + R(-90, 90), -10, tx, ty, { width: 6, glow: '#f5d020', ms: 380, delay: HIT - 20 });
      setTimeout(() => {
        const fl = el(L, 'left:0;top:0;width:100vw;height:100vh;background:#fffbe8;z-index:3'); anim(fl, [{ opacity: 0.7 }, { opacity: 0 }], { duration: 280, fill: 'forwards' }); setTimeout(() => fl.remove(), 300);
        shake(8, 400);
        explodeNow(S, snap, { x: tx, y: ty }, { base: 420, max: 1500, edge: '#fff3a0', hot: 'brightness(4) saturate(0)', spark: ['#ffffff', '#fffbe0', '#f5d020'], speed: [220, 1050] });
      }, HIT);
      return HIT + DUR() * 1.5;
    },
    storm(S, p, from, snap) { // une énorme foudre tombe sur l'onglet, crépite trois fois, et il explose
      const r = snap.rect, L = getLayer(), tx = r.x + r.w / 2, HIT = 120;
      const dark = el(L, 'left:0;top:0;width:100vw;height:100vh;background:#04050c;z-index:2'); anim(dark, [{ opacity: 0 }, { opacity: 0.6, offset: 0.15 }, { opacity: 0.6, offset: 0.6 }, { opacity: 0 }], { duration: 760, fill: 'forwards' }); setTimeout(() => dark.remove(), 780);
      for (const [d, wd] of [[HIT - 30, 12], [HIT + 120, 9], [HIT + 260, 14]]) bolt(tx + R(-40, 40), -10, tx + R(-6, 6), r.y + r.h * 0.4, { width: wd, glow: '#9fb4ff', ms: 200, delay: d });
      const col = el(L, `left:${tx - 40}px;top:0;width:80px;height:${r.y + r.h * 0.5}px;background:linear-gradient(90deg,transparent,rgba(190,205,255,.35),transparent);filter:blur(6px);z-index:21;opacity:0`);
      anim(col, [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0.3, offset: 0.4 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 520, delay: HIT - 30, fill: 'forwards' }); setTimeout(() => col.remove(), HIT + 560);
      anim(S.g, [{ filter: 'none' }, { filter: 'none', offset: 0.2 }, { filter: 'invert(1) brightness(1.6)', offset: 0.3 }, { filter: 'brightness(3) saturate(0)', offset: 0.5 }, { filter: 'invert(1) hue-rotate(180deg) brightness(2)', offset: 0.7 }, { filter: 'brightness(4) saturate(0)' }], { duration: 420, easing: 'steps(1)', fill: 'forwards' });
      setTimeout(() => {
        const fl = el(L, 'left:0;top:0;width:100vw;height:100vh;background:#eef2ff;z-index:3'); anim(fl, [{ opacity: 0.7 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }); setTimeout(() => fl.remove(), 320);
        shake(9, 420); flash(S, '#9fb4ff', 0, 2.2);
        explodeNow(S, snap, { x: tx, y: r.y + r.h * 0.4 }, { base: 420, max: 1500, edge: '#dfe6ff', hot: 'brightness(4) saturate(0)', spark: ['#ffffff', '#dfe6ff', '#9fb4ff'], speed: [220, 1050] });
      }, HIT + 400);
      return HIT + 400 + DUR() * 1.5;
    },
    holy(S, p, from, snap) { // une grande lumière se pose sur l'onglet, il devient blanc, puis il explose dans un grand éclat de lumière
      const { box, g, w, h } = S, D = DUR() * 1.35, r = snap.rect, s = Math.max(w, h) * 2.3, L = getLayer(), q = Q();
      const glow = el(box, `left:${w / 2 - s / 2}px;top:${h / 2 - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;background:radial-gradient(circle,#fffef2 0,#fff3c0bb 22%,#ffd36a55 45%,transparent 70%);z-index:0`);
      anim(glow, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1)', offset: 0.6 }, { opacity: 1, transform: 'scale(1.15)', offset: 0.68 }, { opacity: 0, transform: 'scale(1.7)' }], { duration: D });
      const m = 'radial-gradient(circle,#000 18%,transparent 68%)', rr = el(box, `left:${w / 2 - s * 0.4}px;top:${h / 2 - s * 0.4}px;width:${s * 0.8}px;height:${s * 0.8}px;border-radius:50%;background:repeating-conic-gradient(from 0deg,#fff3c066 0 6deg,transparent 6deg 22deg);mask-image:${m};-webkit-mask-image:${m};z-index:0`);
      anim(rr, [{ opacity: 0, transform: 'rotate(0)' }, { opacity: 1, offset: 0.5 }, { opacity: 1, transform: 'rotate(40deg)', offset: 0.68 }, { opacity: 0, transform: 'rotate(60deg) scale(1.6)' }], { duration: D });
      anim(g, [{ filter: 'none', opacity: 1 }, { filter: 'brightness(1.8) saturate(.6)', offset: 0.35 }, { filter: 'brightness(4) saturate(0)', opacity: 1, offset: 0.66 }, { opacity: 0, offset: 0.68 }, { opacity: 0 }], { duration: D, easing: 'linear' });
      const motes = []; for (let i = 0; i < 70 * q; i++) { const a = Math.random() * 6.283, d = R(60, 160); motes.push({ x: r.x + r.w / 2 + Math.cos(a) * d, y: r.y + r.h / 2 + Math.sin(a) * d * 0.7, vx: -Math.cos(a) * d * 1.4, vy: -Math.sin(a) * d, g: 0, drag: 1, life: R(0.5, 0.7), s: R(1, 2.2), c: pick(GOLD), add: true, delay: R(0, 0.3) }); }
      PX.add(motes);
      setTimeout(() => {
        const X = r.x + r.w / 2, Y = r.y + r.h / 2, fl = el(L, `left:0;top:0;width:100vw;height:100vh;background:radial-gradient(circle at ${X}px ${Y}px,#fffef5 0,#fff3c0cc 18%,#ffd36a44 40%,transparent 70%);z-index:3`);
        anim(fl, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, fill: 'forwards' }); setTimeout(() => fl.remove(), 720);
        flash(S, '#ffd36a', 0, 2.4); rays(S, '#fff3c0', 16, 0, GOLD); shake(4, 300);
        const cols = colorsOf(snap.src ?? g); shatter(r, Math.round(Math.min(1100, 260 + (r.w * r.h) / 32) * q), [...cols, ...GOLD], { at: { x: X, y: Y }, speed: [200, 950], g: 500, size: [1, 3.6], life: [0.7, 1.5], edge: '#fff3c0', lift: 120 });
        shatter(r, Math.round(260 * q), ['#ffffff', '#fffef2', '#fff3c0'], { at: { x: X, y: Y }, speed: [300, 1200], g: 120, life: [0.3, 0.8], size: [1, 2.4], shape: 'spark', add: true });
      }, D * 0.67);
      return D * 1.25;
    },
    lava(S, p, from, snap) { // une seule boule de lave arrive ; la fenêtre prend feu petit à petit à partir de l'impact et disparaît
      const { box, g, w, h } = S, r = snap.rect, q = Q(), k = F(), D = DUR() * 2.2;
      const tx = r.x + r.w * R(0.3, 0.7), ty = r.y + r.h * 0.5, s0 = Math.round(Math.max(30, Math.min(54, Math.sqrt(r.w * r.h) * 0.22)));
      const T = fallFromSky(tx, ty, s0, 0, ['#ffe066', '#ff7a00', '#b02000'], from && Math.hypot(from.x - tx, from.y - ty) > 40 ? from : undefined);
      const ax = tx - r.x, ay = ty - r.y;
      setTimeout(() => {
        shake(4, 260);
        const spl = []; for (let i = 0; i < 60 * q; i++) { const a = R(-3.1, 0), v = R(120, 420); spl.push({ x: tx, y: ty, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 900, life: R(0.4, 0.9), s: R(1.5, 3.4), c: pick(['#ffe066', '#ff9a00', '#ff5a00']), add: true }); }
        PX.add(spl);
        anim(g, [{ filter: 'none' }, { filter: 'sepia(.7) saturate(2.5) hue-rotate(-25deg) brightness(1.1)', offset: 0.3 }, { filter: 'sepia(1) saturate(3) hue-rotate(-30deg) brightness(.6)' }], { duration: D * 0.9, fill: 'forwards' });
        burnHole(S, ax, ay, 60, D * 0.85, { hot: ['#ffe066', '#ff9a00', '#c42a00'] });
        const fl = el(box, 'left:0;top:0;width:100%;height:100%;z-index:5;overflow:visible;mix-blend-mode:screen'), dmax = Math.hypot(Math.max(ax, w - ax), Math.max(ay, h - ay)) || 1;
        for (let i = 0; i < Math.round(Math.min(26, 8 + (w * h) / 2500)); i++) {
          const x = R(0, w), y = R(h * 0.2, h), d = Math.hypot(x - ax, y - ay) / dmax, fh = Math.max(22, Math.min(64, h * 0.5)) * R(0.6, 1.2) * k;
          const f = el(fl, `left:${x - fh * 0.32}px;top:${y - fh}px;width:${fh * 0.64}px;height:${fh}px;transform-origin:50% 100%;filter:drop-shadow(0 0 6px #ff5a00);opacity:0`, FLAME(Ri(1, 2)));
          f.style.animation = `opFlick ${R(0.16, 0.28).toFixed(2)}s ease-in-out ${-R(0, 0.3).toFixed(2)}s infinite alternate`;
          const on = 0.04 + d * 0.72, off = Math.min(0.97, on + 0.2);
          anim(f, [{ opacity: 0, scale: '0.2' }, { opacity: 0, scale: '0.2', offset: on }, { opacity: 1, scale: '1', offset: Math.min(0.95, on + 0.06) }, { opacity: 0.9, scale: '0.8', offset: off }, { opacity: 0, scale: '0.2' }], { duration: D, easing: 'linear' });
        }
        smokeAt(r, Math.round(16 * q), 'rgba(90,80,78,.45)', { delay: (0.2 * D) / 1000, spread: (0.7 * D) / 1000 });
      }, T);
      return T + D * 1.05;
    },
    craters(S, p, from, snap) { // des météores percent la fenêtre de trous noirs brûlants, puis elle explose
      const { box, g, w, h } = S, r = snap.rect, q = Q(), hole = holes(S), n = Math.max(3, Math.min(4, Math.round((w * h) / 14000) + 2));
      let last = 0;
      for (let i = 0; i < n; i++) {
        const bx = R(w * 0.15, w * 0.85), by = R(h * 0.2, h * 0.8), rad = Math.max(12, Math.min(46, Math.min(w, h) * R(0.16, 0.24))), t = fallFromSky(r.x + bx, r.y + by, Math.max(16, rad * 0.8), i * 230);
        last = t;
        setTimeout(() => {
          shake(4, 220); hole(bx, by, rad, 140);
          const ring = el(box, `left:${bx - rad * 1.9}px;top:${by - rad * 1.9}px;width:${rad * 3.8}px;height:${rad * 3.8}px;border-radius:50%;background:radial-gradient(circle,transparent ${(rad * 0.98).toFixed(1)}px,#ffb020 ${(rad * 1.04).toFixed(1)}px,#5a1a06 ${(rad * 1.25).toFixed(1)}px,rgba(20,8,4,.75) ${(rad * 1.5).toFixed(1)}px,transparent ${(rad * 1.9).toFixed(1)}px);z-index:4`);
          anim(ring, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)', offset: 0.15 }, { opacity: 1 }], { duration: 400, fill: 'forwards' });
          const X = r.x + bx, Y = r.y + by;
          shatter({ x: X - rad, y: Y - rad, w: rad * 2, h: rad * 2 }, Math.round(90 * q), colorsOf(snap.src ?? g).concat(['#ff7a1a', '#2a1a10']), { at: { x: X, y: Y }, speed: [160, 600], g: 1000, size: [1.2, 3.6], life: [0.5, 1.1] });
          shatter({ x: X - 4, y: Y - 4, w: 8, h: 8 }, Math.round(60 * q), ['#fff3c0', '#ffd36a', '#ff7a1a'], { at: { x: X, y: Y }, speed: [200, 700], g: 500, life: [0.2, 0.6], size: [1, 2.2], shape: 'spark', add: true });
          smokeAt({ x: X - rad, y: Y - rad, w: rad * 2, h: rad * 2 }, Math.round(5 * q), 'rgba(70,60,56,.55)', {});
        }, t);
      }
      setTimeout(() => {
        for (const x of box.children) if (x !== g) anim(x, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
        shake(8, 420); flash(S, '#ff9a2a', 0, 1.8);
        explodeNow(S, snap, { x: r.x + w / 2, y: r.y + h / 2 }, { extra: ['#2a1a10', '#ff7a1a'], edge: '#ffb020', spark: ['#fff3c0', '#ffd36a', '#ff7a1a'] });
      }, last + 320);
      return last + 320 + DUR() * 1.4;
    },
    vines(S, p, from, snap) { // une branche pousse, ses lianes et racines prennent toute la fenêtre, la serrent, et elle explose
      const { box, g, w, h } = S, r = snap.rect, D = DUR() * 1.9, q = Q(), n = Math.max(5, Math.min(11, Math.round(w / 40)));
      const paths = [];
      for (let i = 0; i < n; i++) {
        let x = ((i + 0.5) / n) * w + R(-12, 12), y = h + 8; const seg = Math.max(3, Math.round(h / 30) + 2); let d = `M${x.toFixed(1)},${y}`;
        for (let s2 = 0; s2 < seg; s2++) { const nx = Math.min(w + 6, Math.max(-6, x + R(-w * 0.28, w * 0.28))), ny = y - (h + 16) / seg; d += ` C${(x + R(-30, 30)).toFixed(1)},${(y - (h / seg) * 0.4).toFixed(1)} ${(nx + R(-30, 30)).toFixed(1)},${(ny + (h / seg) * 0.4).toFixed(1)} ${nx.toFixed(1)},${ny.toFixed(1)}`; x = nx; y = ny; }
        paths.push(d);
      }
      for (let i = 0; i < Math.round(n * 0.7); i++) { const y0 = R(h * 0.1, h * 0.9), l2r = Math.random() < 0.5; paths.push(`M${l2r ? -6 : w + 6},${y0.toFixed(1)} C${(w * 0.3).toFixed(1)},${(y0 + R(-30, 30)).toFixed(1)} ${(w * 0.7).toFixed(1)},${(y0 + R(-30, 30)).toFixed(1)} ${l2r ? w + 6 : -6},${(y0 + R(-20, 20)).toFixed(1)}`); }
      const vin = el(box, `left:0;top:0;width:${w}px;height:${h}px;z-index:5;overflow:visible`, svgNS(w, h, paths.map((d, i) => `<path d="${d}" fill="none" stroke="#1f4a1c" stroke-width="${i < n ? 6 : 4.5}" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/><path d="${d}" fill="none" stroke="${pick(['#4fc35a', '#3fa84a', '#5ccf5a'])}" stroke-width="${i < n ? 3.4 : 2.4}" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>`).join('')));
      const ps = [...vin.querySelectorAll('path')];
      ps.forEach((pa, i) => { const st = Math.floor(i / 2) < n ? 0 : 0.18; anim(pa, [{ strokeDashoffset: 1 }, { strokeDashoffset: 1, offset: st }, { strokeDashoffset: 0, offset: Math.min(0.55, st + 0.4) }, { strokeDashoffset: 0 }], { duration: D, easing: 'ease-out' }); });
      for (let i = 0; i < ps.length; i += 2) { const pa = ps[i], len = pa.getTotalLength?.() || 0; if (!len) continue; const st = Math.floor(i / 2) < n ? 0 : 0.18; for (let k = 1; k < 6; k++) { const t = k / 6, pt = pa.getPointAtLength(len * t), s = R(5, 9), lf = el(vin, `left:${(pt.x - s / 2).toFixed(1)}px;top:${(pt.y - s / 2).toFixed(1)}px;width:${s}px;height:${(s * 0.6).toFixed(1)}px;border-radius:50% 0;background:${pick(['#6fdc6a', '#4fc35a', '#8fe08a'])};transform:rotate(${Ri(0, 360)}deg) scale(0)`); anim(lf, [{ transform: `rotate(${Ri(0, 360)}deg) scale(0)` }, { transform: `rotate(${Ri(0, 360)}deg) scale(0)`, offset: Math.min(0.6, st + t * 0.4) }, { transform: `rotate(${Ri(0, 360)}deg) scale(1)`, offset: Math.min(0.66, st + t * 0.4 + 0.06) }, { transform: `rotate(${Ri(0, 360)}deg) scale(1)` }], { duration: D }); } }
      const sq = [{ transform: 'none', filter: 'none', offset: 0 }, { transform: 'none', offset: 0.5 }];
      for (let k = 0; k < 6; k++) { const t = 0.5 + k * 0.05, z = 1 - k * 0.012; sq.push({ transform: `translate(${R(-2, 2).toFixed(1)}px,${R(-2, 2).toFixed(1)}px) scale(${(z - (k % 2) * 0.02).toFixed(3)},${(z + (k % 2) * 0.015).toFixed(3)})`, filter: `brightness(${(1 - k * 0.06).toFixed(2)})`, offset: t }); }
      sq.push({ transform: 'scale(.9,.94)', filter: 'brightness(.7)', offset: 0.8 }, { transform: 'scale(.9,.94)', filter: 'brightness(.7)' });
      anim(g, sq, { duration: D, easing: 'linear' }); anim(vin, sq.map((x) => ({ transform: x.transform, offset: x.offset })), { duration: D, easing: 'linear' });
      setTimeout(() => {
        anim(vin, [{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' });
        shake(6, 360);
        explodeNow(S, snap, { x: r.x + w / 2, y: r.y + h / 2 }, { extra: ['#1f4a1c', '#4fc35a', '#3fa84a'], edge: '#8fe08a' });
        const bits = []; for (let i = 0; i < 120 * q; i++) bits.push({ x: r.x + R(0, r.w), y: r.y + R(0, r.h), vx: R(-420, 420), vy: R(-520, 80), g: 700, drag: 0.98, wob: R(3, 6), life: R(0.8, 1.6), s: R(3, 6), c: pick(['#6fdc6a', '#4fc35a', '#8fe08a', '#1f4a1c']), shape: 'petal', vr: R(-8, 8) });
        PX.add(bits);
      }, D * 0.8);
      return D * 0.8 + DUR() * 1.4;
    },
    waves(S, p, from, snap) { // une première vague emporte une partie de la fenêtre, une deuxième emporte tout
      const { box, g, w, h } = S, r = snap.rect, q = Q(), D = DUR() * 1.9, dir = from && from.x > r.x + r.w / 2 ? -1 : 1;
      const cut = h * 0.55, pts = []; for (let i = 0; i <= 8; i++) { const x = (i / 8) * w; pts.push([x, cut + Math.sin(i * 1.3 + R(0, 1)) * h * 0.08]); }
      const bot = `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')},${w}px ${h}px,0px ${h}px)`, top = `polygon(0px 0px,${w}px 0px,${pts.slice().reverse().map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})`;
      g.style.opacity = '0';
      const A = piece(S, bot, 2), B = piece(S, top, 2);
      const wave = (H, t0, dur) => {
        const W = Math.max(140, Math.min(320, w * 0.6)), body = Math.max(w, 260), wv = el(box, `left:${dir > 0 ? -W - body : w + W + body}px;top:${h - H}px;width:${W + body}px;height:${H}px;z-index:6;${dir < 0 ? 'transform:scaleX(-1)' : ''}`);
        el(wv, `left:0;top:${H * 0.35}px;width:${body + 4}px;height:${H * 0.65}px;background:linear-gradient(90deg,rgba(40,120,220,0),rgba(40,130,230,.75) 60%,rgba(61,156,240,.92));border-radius:0 0 0 0`);
        el(wv, `left:${body}px;top:0;width:${W}px;height:${H}px`, svgNS(W, H, `<defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe6ff"/><stop offset=".35" stop-color="#3d9cf0"/><stop offset="1" stop-color="#1c64b8"/></linearGradient></defs><path d="M0,${H} L0,${H * 0.35} C${W * 0.25},${H * 0.2} ${W * 0.5},0 ${W * 0.78},${H * 0.12} C${W * 0.96},${H * 0.22} ${W},${H * 0.42} ${W * 0.86},${H * 0.52} C${W * 0.78},${H * 0.4} ${W * 0.66},${H * 0.4} ${W * 0.7},${H * 0.62} C${W * 0.74},${H * 0.8} ${W * 0.9},${H * 0.9} ${W},${H} Z" fill="url(#wg)" opacity=".95"/><path d="M${W * 0.05},${H * 0.33} C${W * 0.3},${H * 0.16} ${W * 0.55},${H * 0.02} ${W * 0.78},${H * 0.13} C${W * 0.95},${H * 0.22} ${W},${H * 0.42} ${W * 0.86},${H * 0.52}" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".9"/>`));
        const travel = dir * (w + 2 * (W + body));
        anim(wv, [{ transform: `${dir < 0 ? 'scaleX(-1) ' : ''}translateX(0)` }, { transform: `${dir < 0 ? 'scaleX(-1) ' : ''}translateX(${Math.abs(travel)}px)` }], { duration: dur, delay: t0, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'both' });
        setTimeout(() => wv.remove(), t0 + dur + 30);
        const spr = []; for (let i = 0; i < 120 * q; i++) { const t = R(0.25, 0.85); spr.push({ x: r.x + (dir > 0 ? t * w : (1 - t) * w), y: r.y + h - H + R(0, H * 0.3), vx: dir * R(150, 500), vy: R(-380, -120), g: 900, life: R(0.4, 0.9), s: R(1.2, 3), c: pick(['#ffffff', '#bfe6ff', '#7fd4ff']), add: true, delay: (t0 + dur * t) / 1000 }); }
        PX.add(spr);
      };
      const carry = (pc, t0, lift) => { pc.style.transformOrigin = '50% 50%'; anim(pc, [{ transform: 'none', filter: 'none', opacity: 1 }, { transform: `translate(${dir * w * 0.15}px,${-lift}px) rotate(${dir * 8}deg)`, filter: 'hue-rotate(160deg) saturate(.6) brightness(1.2)', opacity: 1, offset: 0.3 }, { transform: `translate(${dir * (w * 0.9 + 120)}px,${-lift * 0.4}px) rotate(${dir * 24}deg) scale(.8)`, filter: 'hue-rotate(180deg) saturate(.3) brightness(1.4) blur(1px)', opacity: 0 }], { duration: D * 0.42, delay: t0, easing: 'cubic-bezier(.3,.2,.5,1)', fill: 'both' }); };
      wave(h * 0.75, 0, D * 0.5); carry(A, D * 0.18, 14);
      wave(h * 1.35, D * 0.42, D * 0.55); carry(B, D * 0.6, 26);
      return D * 1.12;
    },
    roll(S, p, from, snap) { // la rafale pousse la fenêtre, elle s'enroule sur elle-même et s'envole avec le vent
      const { box, g, w, h } = S, r = snap.rect, L = getLayer(), q = Q(), D = DUR() * 1.7, bg = bgOf(g);
      for (let i = 0; i < 10; i++) { const ln = el(L, `left:${r.x - 260}px;top:${r.y + R(-h * 0.3, h * 1.3)}px;width:${R(120, 260)}px;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,#f2f8ffcc,transparent);z-index:20`); anim(ln, [{ transform: 'translateX(0)', opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: `translateX(${w + 560}px)`, opacity: 0 }], { duration: R(500, 800), delay: R(0, D * 0.7), easing: 'linear', fill: 'both' }); setTimeout(() => ln.remove(), D + 900); }
      anim(g, [{ transform: 'none', clipPath: 'inset(0 0 0 0)' }, { transform: 'skewX(-7deg) translateX(8px)', clipPath: 'inset(0 0 0 0)', offset: 0.2 }, { transform: 'skewX(-4deg) translateX(6px)', clipPath: 'inset(0 0 0 0)', offset: 0.28 }, { transform: 'skewX(-4deg) translateX(6px)', clipPath: 'inset(0 0 0 100%)', offset: 0.7 }, { transform: 'skewX(-4deg) translateX(6px)', clipPath: 'inset(0 0 0 100%)' }], { duration: D, easing: 'ease-in-out' });
      const rw0 = Math.max(8, h * 0.12), rw1 = Math.max(16, Math.min(h * 0.55, 46)), tube = el(box, `left:${-rw0 / 2}px;top:-2px;width:${rw0}px;height:${h + 4}px;border-radius:${rw1}px;background:linear-gradient(90deg,rgba(0,0,0,.55),${bg} 35%,rgba(255,255,255,.35) 50%,${bg} 65%,rgba(0,0,0,.55));box-shadow:0 2px 8px rgba(0,0,0,.4);z-index:3;opacity:0`);
      anim(tube, [{ opacity: 0, transform: 'translateX(0) skewX(-4deg)', width: `${rw0}px` }, { opacity: 0, offset: 0.27 }, { opacity: 1, transform: 'translateX(6px) skewX(-4deg)', width: `${rw0}px`, offset: 0.28 }, { opacity: 1, transform: `translateX(${w - rw1 / 2 + 6}px) skewX(-4deg)`, width: `${rw1}px`, offset: 0.7 }, { opacity: 1, transform: `translateX(${w + R(160, 260)}px) translateY(${-h * 1.6 - 60}px) rotate(${R(500, 800)}deg) scale(.45)`, width: `${rw1}px`, offset: 0.97 }, { opacity: 0, transform: `translateX(${w + 300}px) translateY(${-h * 1.8 - 80}px) rotate(820deg) scale(.4)`, width: `${rw1}px` }], { duration: D, easing: 'linear' });
      const dust2 = []; for (let i = 0; i < 70 * q; i++) dust2.push({ x: r.x + R(0, r.w), y: r.y + R(0, r.h), vx: R(400, 900), vy: R(-180, 20), g: 0, life: R(0.4, 0.8), s: R(1, 2.2), c: pick(['#ffffff', '#e8f2ff']), add: true, delay: R(0.3, 0.7) * D / 1000 });
      PX.add(dust2);
      return D + 80;
    },
    quake(S, p, from, snap) { // la fenêtre tremble de plus en plus, se fissure, puis se désagrège toute seule en partant du bas
      const { box, g, w, h } = S, r = snap.rect, q = Q(), D = DUR() * 1.9, T1 = D * 0.42, kf = [];
      for (let k = 0; k <= 16; k++) { const a = (k / 16) ** 1.4 * 7; kf.push({ transform: k === 0 ? 'none' : `translate(${R(-a, a).toFixed(1)}px,${R(-a * 0.6, a * 0.6).toFixed(1)}px) rotate(${R(-a * 0.25, a * 0.25).toFixed(2)}deg)`, offset: k / 16 }); }
      anim(box, kf, { duration: T1, easing: 'linear' });
      const lines = [[w * 0.2, h], [w * 0.5, h], [w * 0.8, h], [0, h * 0.6], [w, h * 0.5]];
      const ck = el(box, `left:0;top:0;width:${w}px;height:${h}px;z-index:5`, svgNS(w, h, lines.map(([x, y]) => { let d = `M${x.toFixed(1)},${y.toFixed(1)}`, cx = x, cy = y; for (let i = 0; i < 4; i++) { cx += (w / 2 - cx) * 0.3 + R(-12, 12); cy += (h * 0.3 - cy) * 0.35 + R(-6, 6); d += ` L${cx.toFixed(1)},${cy.toFixed(1)}`; } return `<path d="${d}" fill="none" stroke="#1a1410" stroke-width="2" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/><path d="${d}" fill="none" stroke="#ffd9a0" stroke-width=".7" opacity=".6" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>`; }).join('')));
      for (const pa of ck.querySelectorAll('path')) anim(pa, [{ strokeDashoffset: 1 }, { strokeDashoffset: 1, offset: 0.35 }, { strokeDashoffset: 0 }], { duration: T1, fill: 'forwards' });
      shake(3, T1);
      setTimeout(() => {
        ck.remove(); g.style.opacity = '0';
        const cols = Math.max(4, Math.min(9, Math.round(w / 34))), rows = Math.max(3, Math.min(6, Math.round(h / 22))), cs = cells(w, h, cols, rows, 0.3);
        for (const c of cs) {
          const pc = piece(S, c.clip, 2); pc.style.transformOrigin = `${c.cx.toFixed(1)}px ${c.cy.toFixed(1)}px`;
          const delay = (rows - 1 - c.j) * D * 0.09 + R(0, D * 0.07), fall = innerHeight - (r.y + c.cy) + 80, rot = R(-200, 200), dx = R(-30, 30);
          anim(pc, [{ transform: 'none', opacity: 1 }, { transform: `translate(${R(-2, 2).toFixed(1)}px,${R(1, 3).toFixed(1)}px) rotate(${R(-3, 3).toFixed(1)}deg)`, offset: 0.12 }, { transform: `translate(${(dx * 0.3).toFixed(1)}px,${(fall * 0.15).toFixed(1)}px) rotate(${(rot * 0.2).toFixed(0)}deg)`, offset: 0.35 }, { transform: `translate(${dx.toFixed(1)}px,${fall.toFixed(1)}px) rotate(${rot.toFixed(0)}deg) scale(.85)`, opacity: 0.9 }], { duration: D * 0.55, delay, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'both' });
          setTimeout(() => { const X = r.x + c.cx, Y = r.y + c.cy, ps = []; for (let i = 0; i < 10 * q; i++) ps.push({ x: X + R(-8, 8), y: Y + R(-6, 6), vx: R(-60, 60), vy: R(-80, 20), g: 900, life: R(0.5, 1), s: R(1, 2.6), c: pick(colorsOf(snap.src ?? g).concat(['#8a7058', '#c3a27a'])) }); PX.add(ps); }, delay);
        }
        smokeAt({ x: r.x, y: r.y + r.h * 0.6, w: r.w, h: r.h * 0.5 }, Math.round(16 * q), 'rgba(150,130,110,.45)', { vy: [-40, -10], spread: 0.6, delay: 0.05 });
      }, T1);
      return T1 + D * 0.98;
    },
    vortex(S, p, from, snap) { // la fenêtre devient une tornade : elle se désagrège morceau par morceau en tourbillonnant vers le ciel
      const { box, g, w, h } = S, r = snap.rect, L = getLayer(), q = Q(), D = DUR() * 2;
      const ax = r.x + r.w / 2, base = r.y + r.h, cols = Math.max(4, Math.min(9, Math.round(w / 36))), rows = Math.max(3, Math.min(6, Math.round(h / 24))), cs = cells(w, h, cols, rows, 0.25);
      for (let i = 0; i < 6; i++) { const yy = base - i * 34 - 20, rw = 30 + i * 26 * Math.max(1, w / 260), ring = el(L, `left:${ax - rw}px;top:${yy - rw * 0.18}px;width:${rw * 2}px;height:${rw * 0.36}px;border-radius:50%;border:2px solid rgba(220,232,245,.45);border-left-color:transparent;border-bottom-color:rgba(220,232,245,.15);z-index:20;opacity:0`); anim(ring, [{ opacity: 0, transform: 'rotate(0) scaleX(.6)' }, { opacity: 0.9, transform: 'scaleX(1)', offset: 0.25 }, { opacity: 0.9, offset: 0.8 }, { opacity: 0, transform: 'scaleX(1.2) translateY(-30px)' }], { duration: D, fill: 'forwards' }); setTimeout(() => ring.remove(), D + 40); }
      anim(g, [{ transform: 'none' }, { transform: 'skewX(4deg) scaleY(.98)', offset: 0.1 }, { transform: 'skewX(-4deg)', offset: 0.2 }], { duration: D * 0.25 });
      setTimeout(() => {
        g.style.opacity = '0';
        cs.sort((a, b) => (b.j - a.j) || (Math.random() - 0.5));
        cs.forEach((c, idx) => {
          const pc = piece(S, c.clip, 2); pc.style.transformOrigin = `${c.cx.toFixed(1)}px ${c.cy.toFixed(1)}px`;
          const kf = [{ transform: 'none', opacity: 1, offset: 0 }], th0 = Math.atan2(0, (r.x + c.cx) - ax), sp = R(3.6, 5.2);
          for (let k = 1; k <= 14; k++) { const t = k / 14, rise = t * (r.y + c.cy + 80), rad = (20 + t * (rise * 0.5)) * Math.max(0.8, w / 300), th = th0 + t * sp * Math.PI, x = ax + Math.cos(th) * rad - (r.x + c.cx), y = -rise, front = Math.sin(th) > 0; kf.push({ transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${(t * 540).toFixed(0)}deg) scale(${Math.max(0.25, 1 - t * 0.75).toFixed(2)})`, filter: `brightness(${front ? 1.1 : 0.6})`, opacity: t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1, offset: t }); }
          anim(pc, kf, { duration: D * 0.75, delay: idx * (D * 0.32 / cs.length), easing: 'linear', fill: 'both' });
        });
        const ps = []; for (let i = 0; i < 160 * q; i++) { const y = base - R(0, r.h * 1.5 + 60), side = Math.random() < 0.5 ? -1 : 1; ps.push({ x: ax + side * R(10, 40 + (base - y) * 0.45), y, vx: -side * R(60, 160), vy: R(-160, -60), g: 0, drag: 0.99, wob: R(3, 6), life: R(0.5, 1.1), s: R(1, 2.4), c: pick(['#e8f2ff', '#cfe3f0', '#a9b8c8']), delay: R(0, D * 0.6) / 1000 }); }
        PX.add(ps);
      }, D * 0.2);
      return D * 1.1;
    },
    fold(S, p, from, snap) { // trou noir au milieu de l'onglet : il se plie sur les lignes du trou, vers lui, puis il est avalé
      const { box, g, w, h } = S, r = snap.rect, L = getLayer(), q = Q(), STEP = 340, GAP = 80, cx = w / 2, cy = h / 2;
      const full = () => el(box, `left:0;top:0;width:${w}px;height:${h}px;z-index:2`);
      let cur = full(); const first = g.cloneNode(true); first.style.opacity = '1'; first.style.maskImage = first.style.webkitMaskImage = ''; cur.append(first); g.style.opacity = '0';
      // [axe, ligne, côté qui se replie] : chaque pli passe par le trou noir ou se rabat vers lui
      const reg = { x0: 0, y0: 0, x1: w, y1: h };
      const steps = [['v', cx, 'right'], ['h', cy, 'bottom'], ['v', w / 4, 'left'], ['h', h / 4, 'top']];
      const ins = (a, b, c, d) => `inset(${b.toFixed(1)}px ${(w - c).toFixed(1)}px ${(h - d).toFixed(1)}px ${a.toFixed(1)}px)`;
      let t = 380;
      for (const [ax, at, side] of steps) {
        setTimeout(() => {
          if (!box.isConnected) return;
          const { x0, y0, x1, y1 } = reg, A = cur, B = cur.cloneNode(true), nc = full(); nc.style.perspective = '800px';
          let keep, move, end, mid;
          if (ax === 'v') { keep = side === 'right' ? ins(x0, y0, at, y1) : ins(at, y0, x1, y1); move = side === 'right' ? ins(at, y0, x1, y1) : ins(x0, y0, at, y1); end = side === 'right' ? 'rotateY(-180deg)' : 'rotateY(180deg)'; mid = side === 'right' ? 'rotateY(-90deg)' : 'rotateY(90deg)'; }
          else { keep = side === 'bottom' ? ins(x0, y0, x1, at) : ins(x0, at, x1, y1); move = side === 'bottom' ? ins(x0, at, x1, y1) : ins(x0, y0, x1, at); end = side === 'bottom' ? 'rotateX(180deg)' : 'rotateX(-180deg)'; mid = side === 'bottom' ? 'rotateX(90deg)' : 'rotateX(-90deg)'; }
          const stay = el(nc, `left:0;top:0;width:${w}px;height:${h}px;clip-path:${keep}`), mov = el(nc, `left:0;top:0;width:${w}px;height:${h}px;z-index:2;clip-path:${move};transform-origin:${ax === 'v' ? `${at}px 50%` : `50% ${at}px`}`);
          A.remove(); stay.append(A); mov.append(B);
          anim(mov, [{ transform: 'none', filter: 'brightness(1)' }, { transform: mid, filter: 'brightness(.45)', offset: 0.5 }, { transform: end, filter: 'brightness(.72)' }], { duration: STEP, easing: 'ease-in-out', fill: 'forwards' });
          setTimeout(() => { mov.style.transform = end; mov.style.filter = 'brightness(.72)'; }, STEP + 5);
          const crease = []; for (let i = 0; i < 14 * q; i++) crease.push({ x: r.x + (ax === 'v' ? at : R(x0, x1)), y: r.y + (ax === 'v' ? R(y0, y1) : at), vx: R(-40, 40), vy: R(-40, 40), g: 0, life: R(0.3, 0.6), s: R(1, 2), c: pick(['#c9a8ff', '#ffffff']), add: true, delay: STEP / 2000 });
          PX.add(crease);
          if (ax === 'v') { if (side === 'right') reg.x1 = at; else reg.x0 = at; } else { if (side === 'bottom') reg.y1 = at; else reg.y0 = at; }
          cur = nc;
        }, t);
        t += STEP + GAP;
      }
      // le trou noir, au milieu de l'onglet dès le début : disque noir et anneau de lumière qui tourne
      const hs = Math.max(20, Math.min(50, Math.min(w, h) * 0.32)), X = r.x + cx, Y = r.y + cy;
      const bh = el(L, `left:${X - hs}px;top:${Y - hs}px;width:${hs * 2}px;height:${hs * 2}px;z-index:21;opacity:0`);
      const tilt = el(bh, `left:${-hs * 0.4}px;top:0;width:${hs * 2.8}px;height:${hs * 2}px;transform:scaleY(.38) rotate(-12deg)`);
      const ringC = el(tilt, `left:${hs * 0.4}px;top:0;width:${hs * 2}px;height:${hs * 2}px;border-radius:50%;background:conic-gradient(#c9a8ff,#7c4dff,#ff9ad8,#ffffff,#7c4dff,#c9a8ff);mask-image:radial-gradient(circle,transparent 46%,#000 50%,#000 64%,transparent 70%);-webkit-mask-image:radial-gradient(circle,transparent 46%,#000 50%,#000 64%,transparent 70%);filter:blur(.5px) drop-shadow(0 0 6px #9a6bff)`);
      anim(ringC, [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 700, iterations: Math.ceil((t + 1100) / 700), easing: 'linear' });
      el(bh, `left:${hs * 0.55}px;top:${hs * 0.55}px;width:${hs * 0.9}px;height:${hs * 0.9}px;border-radius:50%;background:#000;box-shadow:0 0 14px 4px #1a0b2e,0 0 26px #7c4dff66`);
      anim(bh, [{ opacity: 0, transform: 'scale(.1)' }, { opacity: 1, transform: 'scale(1)', offset: 0.12 }, { opacity: 1, transform: 'scale(1.1)', offset: 0.85 }, { opacity: 0, transform: 'scale(.05)' }], { duration: t + 1000, fill: 'forwards' });
      setTimeout(() => bh.remove(), t + 1050);
      const pull = []; for (let i = 0; i < 80 * q; i++) { const a = Math.random() * 6.283, d = R(40, 120); pull.push({ x: X + Math.cos(a) * d, y: Y + Math.sin(a) * d * 0.6, vx: -Math.cos(a) * d * 1.6, vy: -Math.sin(a) * d, g: 0, drag: 1, life: 0.6, s: R(1, 2), c: pick(['#c9a8ff', '#9a6bff', '#ffffff']), add: true, delay: R(0, t / 1000) }); }
      PX.add(pull);
      setTimeout(() => {
        if (cur) { cur.style.transformOrigin = `${cx}px ${cy}px`; anim(cur, [{ transform: 'none', opacity: 1 }, { transform: 'rotate(320deg) scale(.03)', opacity: 0.7 }], { duration: 560, easing: 'cubic-bezier(.6,0,.9,.5)', fill: 'forwards' }); }
        const ps = []; for (let i = 0; i < 130 * q; i++) { const a = Math.random() * 6.283, d = R(50, 190); ps.push({ x: X + Math.cos(a) * d, y: Y + Math.sin(a) * d * 0.6, vx: -Math.cos(a) * d * 2.2, vy: -Math.sin(a) * d * 1.3, g: 0, drag: 1, life: 0.45, s: R(1, 2.2), c: pick(['#c9a8ff', '#9a6bff', '#ffffff']), add: true }); }
        PX.add(ps);
        setTimeout(() => { const f = el(L, `left:${X - 44}px;top:${Y - 44}px;width:88px;height:88px;border-radius:50%;background:radial-gradient(circle,#ffffff,#c9a8ff 30%,#7c4dff 55%,transparent 70%);z-index:22`); anim(f, [{ transform: 'scale(.1)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 380, fill: 'forwards' }); setTimeout(() => f.remove(), 400); }, 900);
      }, t + 40);
      return t + 1100;
    },
  });

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
    if (window.OdinPowers3?.has(id) && snap.cap && !window.OdinPowers3.busy) { castFrom(from); window.OdinPowers3.play(snap.cap, id, from); return id; }
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
    if (kind === 'fire') { // le feu prend en haut et descend jusqu'en bas en révélant l'onglet
      const DF = D * 1.3, H = r.height;
      anim(target, [{ clipPath: 'inset(0 0 100% 0)', filter: 'sepia(1) saturate(3) hue-rotate(-25deg) brightness(1.5)' }, { clipPath: 'inset(0 0 100% 0)', filter: 'sepia(1) saturate(3) hue-rotate(-25deg) brightness(1.5)', offset: 0.12 }, { clipPath: 'inset(0 0 0 0)', filter: 'sepia(.6) saturate(2) hue-rotate(-20deg) brightness(1.25)', offset: 0.8 }, { clipPath: 'inset(0 0 0 0)', filter: 'none' }], { duration: DF, fill: 'none', easing: 'linear' });
      const ign = el(S.box, `left:${-S.w * 0.1}px;top:${-26}px;width:${S.w * 1.2}px;height:52px;border-radius:50%;background:radial-gradient(ellipse,#fff7c2 0,#ffc43a 30%,#ff6a1a 55%,transparent 72%)`);
      anim(ign, [{ opacity: 0, transform: 'scaleX(.1)' }, { opacity: 1, transform: 'scaleX(1)', offset: 0.5 }, { opacity: 0, transform: 'scaleX(1.1)' }], { duration: DF * 0.25 });
      const ff = el(S.box, `left:-6px;width:${S.w + 12}px;top:0;height:2px;z-index:5`), fh = Math.max(16, Math.min(32, H * 0.45));
      for (let x = -4; x < S.w + 8; x += Math.max(12, Math.min(18, S.w / 10))) { const f = el(ff, `left:${x}px;bottom:-2px;width:${fh * 0.64}px;height:${fh * R(0.75, 1.2)}px;transform-origin:50% 100%;filter:drop-shadow(0 0 6px #ff6a1a)`, FLAME(Ri(0, 2))); f.style.animation = `opFlick ${R(0.18, 0.28).toFixed(2)}s ease-in-out ${-R(0, 0.3).toFixed(2)}s infinite alternate`; }
      anim(ff, [{ opacity: 0, transform: 'translateY(0)' }, { opacity: 1, transform: 'translateY(0)', offset: 0.12 }, { opacity: 1, transform: `translateY(${H}px)`, offset: 0.8 }, { opacity: 0, transform: `translateY(${H}px)` }], { duration: DF, easing: 'linear' });
      const q = Q(), em = []; for (let i = 0; i < 90 * q; i++) { const t = R(0.12, 0.8); em.push({ x: r.left + R(0, r.width), y: r.top + H * ((t - 0.12) / 0.68), vx: R(-30, 30), vy: R(40, 160), g: 400, life: R(0.4, 0.9), s: R(1, 2.4), c: pick(['#ffd36a', '#ff9a2a', '#fff3c0']), add: true, delay: (DF * t) / 1000 }); }
      PX.add(em);
    } else if (kind === 'teleport') { // téléportation sans lumière : il s'ouvre d'un trait, saute deux fois, et il est là
      anim(target, [{ transform: 'scaleX(0) scaleY(.03)', opacity: 1 }, { transform: 'scaleX(1.04) scaleY(.03)', offset: 0.3 }, { transform: 'scaleX(1) scaleY(1)', offset: 0.55 }, { transform: 'translateX(-10px)', opacity: 0.4, offset: 0.62 }, { transform: 'translateX(8px)', opacity: 1, offset: 0.72 }, { transform: 'translateX(-3px)', opacity: 0.6, offset: 0.82 }, { transform: 'none', opacity: 1 }], { duration: 560, fill: 'none', easing: 'linear' });
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
  window.OdinPowers = { POWERS: Object.fromEntries(IDS.map((k) => [k, P[k]])), IDS, configure, destroy, appear, burst, sparkle, stop: stopAll, get cfg() { return { ...cfg }; },
    /** Essai depuis les réglages : un pouvoir sur un élément (même si les pouvoirs sont coupés). */
    async demo(target, id) { const keep = cfg.actif; cfg.actif = true; const q = cfg.quand; cfg.quand = { ...DEF.quand, ferme: true, ouvre: true }; try { const snap = snapshot(target); if (snap) { target.style.visibility = 'hidden'; await destroy(snap, { power: id }); await wait(DUR() * 1.3); target.style.visibility = ''; appear(target, { power: id }); } } finally { cfg.actif = keep; cfg.quand = q; } } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
