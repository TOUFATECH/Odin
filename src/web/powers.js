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
    feu: { name: 'Boule de feu', c: '#ff7a1a', kit: 'burn', shot: 'fire', appear: 'fire' },
    jet: { name: 'Lance-flammes', c: '#ff8a1a', kit: 'burn', shot: 'jet', appear: 'fire' },
    lave: { name: 'Lave', c: '#ff5a00', kit: 'melt', shot: 'lava', drip: '#ff8a1a', fx: 'sepia(1) saturate(6) hue-rotate(-30deg) brightness(1.2)', appear: 'fire' },
    meteores: { name: 'Météores', c: '#ff6a1a', kit: 'burn', shot: 'meteors', appear: 'fire' },
    comete: { name: 'Comète', c: '#58d7ff', kit: 'pop', shot: 'comet', shard: ['#1e5a7a', '#bff0ff'], appear: 'light', pc: ['#bff0ff', '#58d7ff', '#ffffff'] },
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
    pixels: { name: 'Pixels', c: '#5a6fdb', kit: 'dis', shot: 'pixels', dir: 'h', pc: ['#283044', '#3c4660', '#56617f', '#5a6fdb', '#8fa0ff'], dx: [-14, 30], dy: [-26, 20], size: [4, 6], shape: '0', glow: 0, steps: true, fx: 'contrast(1.4) brightness(1.2)', appear: 'light' },
    aimant: { name: 'Aimant', c: '#ff5a5a', kit: 'pull', shot: 'magnet', appear: 'light', pc: ['#ff9a9a', '#ff5a5a'] },
    gungnir: { name: 'Gungnir, la lance', c: '#ffd36a', kit: 'pop', shot: 'spear', shard: ['#283044', '#ffd36a'], appear: 'light', pc: GOLD },
    corbeaux: { name: 'Huginn et Muninn', c: '#c9d2e6', kit: 'carry', shot: 'ravens', appear: 'light', pc: ['#c9d2e6', '#ffffff'] },
    bifrost: { name: 'Bifröst', c: '#ff6ad5', kit: 'bif', shot: 'rainbow', appear: 'light', pc: ['#ff4a4a', '#ffe14a', '#4adf6a', '#4aa8ff', '#9a6bff'] },
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
    return { rect: { x: r.left, y: r.top, w: r.width, h: r.height }, node: g };
  }
  function stage(snap) {
    const { x, y, w, h } = snap.rect, L = getLayer();
    const box = el(L, `left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:visible`);
    const g = snap.node; g.style.position = 'absolute'; g.style.left = '0'; g.style.top = '0'; g.style.width = `${w}px`; g.style.height = `${h}px`; g.style.margin = '0'; g.style.transformOrigin = '50% 50%'; g.style.zIndex = '1';
    box.append(g); return { box, g, w, h };
  }
  function mascotPoint() {
    const m = [...document.querySelectorAll('#buddyRoam, .odin.roam, #maisonOdin, .m-odin, .odin')].find((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none' && !e.hidden);
    if (!m) return null; const r = m.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, el: m };
  }
  function castFrom(from) { if (!from?.el) return; window.OdinFace?.flash?.(from.el, 'excite', 1200); window.OdinCompanion?.act?.('act-joy', 900); }

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
  function zigzag(x0, y0, x1, y1, n = 7, amp = 12) { const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push(`${(x0 + (x1 - x0) * t + (i && i < n ? R(-amp / 3, amp / 3) : 0)).toFixed(1)},${(y0 + (y1 - y0) * t + (i && i < n ? R(-amp, amp) : 0)).toFixed(1)}`); } return pts.join(' '); }

  // ---------------------------------------------------------------- les façons de détruire
  const KITS = {
    burn(S) { // il prend feu et brûle de bas en haut
      const { box, g, w, h } = S, D = DUR();
      anim(g, [{ clipPath: 'inset(0 0 0 0)', filter: 'none' }, { filter: 'brightness(1.7) sepia(.6) saturate(3) hue-rotate(-20deg)', offset: 0.08 }, { clipPath: 'inset(0 0 5% 0)', filter: 'sepia(1) saturate(3) hue-rotate(-25deg) brightness(.85)', offset: 0.18 }, { clipPath: 'inset(0 0 100% 0)', filter: 'sepia(1) saturate(2) hue-rotate(-25deg) brightness(.4)' }], { duration: D, easing: 'linear' });
      const ff = el(box, `left:-6px;width:${w + 12}px;top:${h}px;height:2px;z-index:5`);
      ff.innerHTML = `<div style="position:absolute;left:4px;right:4px;top:0;height:3px;border-radius:2px;background:linear-gradient(90deg,#ff5a10,#ffe066,#ff7a1a,#ffe066,#ff5a10);box-shadow:0 0 8px #ff7a1a,0 0 3px #fff3b0"></div>`;
      const fh = Math.max(16, Math.min(34, h * 0.5));
      for (let x = -4; x < w + 8; x += Math.max(9, Math.min(14, w / 12))) {
        const f = el(ff, `left:${x}px;bottom:-2px;width:${fh * 0.62}px;height:${fh * R(0.75, 1.15)}px;border-radius:50% 50% 50% 50%/65% 65% 35% 35%;background:radial-gradient(circle at 50% 80%,#fff7c2 0,#ffc43a 26%,#ff6a1a 58%,rgba(255,80,20,0) 74%);transform-origin:50% 100%;filter:drop-shadow(0 0 4px #ff7a1a)`);
        f.style.animation = `opFlick ${R(0.2, 0.3).toFixed(2)}s ease-in-out ${-R(0, 0.3).toFixed(2)}s infinite alternate`;
      }
      anim(ff, [{ opacity: 0, transform: 'translateY(0)' }, { opacity: 1, transform: 'translateY(-2px)', offset: 0.1 }, { opacity: 1, transform: `translateY(${-h}px)`, offset: 0.92 }, { opacity: 0, transform: `translateY(${-h - 6}px)` }], { duration: D, easing: 'linear' });
      for (let i = 0; i < Math.round(14 * F() * Math.min(3, w / 60)); i++) { const e = el(box, `left:${R(2, w - 2)}px;top:${R(4, h)}px;width:3px;height:3px;border-radius:50%;background:#ffc04a;box-shadow:0 0 5px #ff7a1a;opacity:0;z-index:6`); anim(e, [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0, transform: `translate(${R(-14, 14)}px,${R(-70, -30)}px)` }], { duration: D * 0.5, delay: R(0.1, 0.7) * D }); }
      smokes(S, '#8a8f9a', Math.round(4 * F()), { start: 0.45 });
      return D * 1.25;
    },
    zap(S, p) { // électrocuté, puis il explose
      const { box, g, w, h } = S, D = DUR();
      anim(g, [{ filter: 'none', transform: 'none', opacity: 1 }, { filter: 'brightness(2.8) saturate(0)', offset: 0.06 }, { filter: 'brightness(.7) hue-rotate(200deg)', transform: 'translate(1.5px,-1px)', offset: 0.14 }, { filter: 'brightness(2.6) saturate(0)', transform: 'translate(-1.5px,1px)', offset: 0.24 }, { filter: 'brightness(.8) hue-rotate(200deg)', transform: 'translate(1px,1px)', offset: 0.34 }, { filter: 'brightness(3) saturate(0)', transform: 'scale(1.05)', offset: 0.46 }, { filter: 'brightness(4) saturate(0)', transform: 'scale(1.16)', opacity: 1, offset: 0.55 }, { opacity: 0, transform: 'scale(1.2)', offset: 0.56 }, { opacity: 0 }], { duration: D * 1.1, easing: 'linear' });
      for (let k = 0; k < 2; k++) {
        const s = el(box, `left:-8px;top:-8px;width:${w + 16}px;height:${h + 16}px;z-index:5;opacity:0;filter:drop-shadow(0 0 3px ${p.c}) drop-shadow(0 0 6px ${p.c})`, svgNS(w + 16, h + 16, `<polyline points="${zigzag(2, (h + 16) * R(0.3, 0.7), w + 14, (h + 16) * R(0.3, 0.7), 8, h * 0.25)}" fill="none" stroke="#fffbe0" stroke-width="2"/><polyline points="${zigzag((w + 16) * R(0.2, 0.8), 2, (w + 16) * R(0.2, 0.8), h + 14, 5, w * 0.08)}" fill="none" stroke="#fffbe0" stroke-width="1.5"/>`));
        const fr = []; for (let i = 0; i < 12; i++) fr.push({ opacity: (i + k) % 2 ? 1 : 0, offset: 0.04 * i });
        fr.push({ opacity: 0, offset: 0.56 }, { opacity: 0 });
        anim(s, fr, { duration: D * 1.1, easing: 'steps(1)' });
      }
      flash(S, p.c, 0.6); shards(S, Math.round(12 * F()), '#3c4660', '#fff6b0', { start: 0.6 }); rays(S, p.c, 10, 0.6);
      return D * 1.25;
    },
    ice(S) { // il se congèle, la glace craque, puis elle explose
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
      const mist = el(box, `left:${-w * 0.2}px;top:${-h * 0.2}px;width:${w * 1.4}px;height:${h * 1.4}px;border-radius:50%;background:radial-gradient(circle,#e8f8ffcc,transparent 65%);filter:blur(3px);opacity:0;z-index:5`);
      anim(mist, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: 'scale(1.7)' }], { duration: D * 0.4, delay: D * 0.7 });
      return D * 1.25;
    },
    dis(S, p) { // il se désintègre (lumière, sable, pétales, pixels, ombre, aurore, runes, étoiles)
      const { g, w, h } = S, D = DUR(), v = p.dir === 'v';
      const grad = `linear-gradient(${v ? '180deg' : '90deg'},transparent 40%,#000 60%)`, size = v ? '100% 250%' : '250% 100%', a = v ? '0 100%' : '100% 0', b = '0 0';
      for (const k of ['maskImage', 'webkitMaskImage']) g.style[k] = grad;
      for (const k of ['maskSize', 'webkitMaskSize']) g.style[k] = size;
      for (const k of ['maskRepeat', 'webkitMaskRepeat']) g.style[k] = 'no-repeat';
      anim(g, [{ maskPosition: a, webkitMaskPosition: a, filter: 'none' }, { filter: p.fx || 'brightness(1.8)', maskPosition: a, webkitMaskPosition: a, offset: 0.15 }, { filter: p.fx || 'brightness(1.8)', maskPosition: b, webkitMaskPosition: b }], { duration: D * 0.85, easing: p.steps ? 'steps(8)' : 'linear' });
      const halo = el(S.box, `left:-10px;top:-10px;width:${w + 20}px;height:${h + 20}px;border-radius:14px;background:radial-gradient(ellipse,${(p.pc || GOLD)[0]}66 0,transparent 70%);opacity:0;z-index:0`);
      anim(halo, [{ opacity: 0 }, { opacity: 0.9, offset: 0.2 }, { opacity: 0.9, offset: 0.7 }, { opacity: 0 }], { duration: D });
      particles(S, p, { start: 0.12 });
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
    crush(S, p) { // écrasé, il part en morceaux
      const { g, h } = S, D = DUR();
      anim(g, [{ transform: 'none', filter: 'none', opacity: 1 }, { transform: `translateY(${h * 0.2}px) scaleY(.6) scaleX(1.14)`, filter: 'brightness(.8)', offset: 0.08 }, { transform: `translateY(${h * 0.22}px) scaleY(.56) scaleX(1.16)`, opacity: 1, offset: 0.24 }, { opacity: 0, offset: 0.25 }, { opacity: 0 }], { duration: D, easing: 'linear' });
      shards(S, Math.round(10 * F()), '#283044', '#56617f', { start: 0.24 });
      smokes(S, '#8a7058', Math.round(6 * F()), { start: 0.2, dx: [-24, 24], dy: [-26, -10], op: 0.9 });
      flash(S, p.c, 0.05, 0.6);
      return D;
    },
    pop(S, p) { // il vibre, gonfle, puis éclate
      const { g } = S, D = DUR();
      anim(g, [{ transform: 'none', filter: 'none', opacity: 1 }, { transform: 'translateX(1.5px)', filter: `brightness(1.4) drop-shadow(0 0 6px ${p.c})`, offset: 0.1 }, { transform: 'translateX(-1.5px)', offset: 0.2 }, { transform: 'translateX(1.5px)', offset: 0.3 }, { transform: 'translateX(-1px) scale(1.04)', filter: `brightness(1.9) drop-shadow(0 0 8px ${p.c})`, offset: 0.4 }, { transform: 'scale(1.15)', filter: `brightness(2.6) drop-shadow(0 0 10px ${p.c})`, opacity: 1, offset: 0.5 }, { opacity: 0, transform: 'scale(1.2)', offset: 0.51 }, { opacity: 0 }], { duration: D, easing: 'linear' });
      flash(S, p.c, 0.5); shards(S, Math.round(12 * F()), (p.shard || [])[0] || '#3c4660', (p.shard || [])[1] || p.c, { start: 0.5 }); rays(S, p.c, 10, 0.5);
      return D * 1.1;
    },
    confetti(S, p) { // feu d'artifice : il explose en confettis
      const r = KITS.pop(S, p); const { box, w, h } = S, D = DUR();
      for (let i = 0; i < Math.round(26 * F()); i++) { const c = pick(p.pc), d = el(box, `left:${w / 2}px;top:${h / 2}px;width:${R(4, 7)}px;height:${R(3, 6)}px;background:${c};box-shadow:0 0 4px ${c};opacity:0;z-index:6`), a = R(0, Math.PI * 2), dd = R(20, 60) * Math.max(1, Math.min(3, w / 80)); anim(d, [{ opacity: 1, transform: 'none' }, { opacity: 1, transform: `translate(${Math.cos(a) * dd}px,${Math.sin(a) * dd * 0.7}px) rotate(${Ri(60, 300)}deg)`, offset: 0.4 }, { opacity: 0, transform: `translate(${Math.cos(a) * dd * 1.2}px,${Math.sin(a) * dd * 0.7 + 40}px) rotate(${Ri(300, 700)}deg)` }], { duration: D * 0.7, delay: D * 0.5 }); }
      rays(S, p.c, 15, 0.5, p.pc); return r;
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
    if (from && Math.hypot(to.x - from.x, to.y - from.y) > 30 && cfg.force !== 'discrete') await shoot(p, from, to);
    if (!cfg.actif) { S.box.remove(); return false; }
    sky(p, S); noise(p.kit);
    const ms = KITS[p.kit](S, p, from);
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
  function stopAll() { for (const a of [...live]) { try { a.cancel(); } catch { /* */ } } live.clear(); if (layer) { layer.remove(); layer = null; } }
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
  window.OdinPowers = { POWERS: P, IDS, configure, destroy, appear, burst, stop: stopAll, get cfg() { return { ...cfg }; },
    /** Essai depuis les réglages : un pouvoir sur un élément (même si les pouvoirs sont coupés). */
    async demo(target, id) { const keep = cfg.actif; cfg.actif = true; const q = cfg.quand; cfg.quand = { ...DEF.quand, ferme: true, ouvre: true }; try { const snap = snapshot(target); if (snap) { target.style.visibility = 'hidden'; await destroy(snap, { power: id }); await wait(DUR() * 1.3); target.style.visibility = ''; appear(target, { power: id }); } } finally { cfg.actif = keep; cfg.quand = q; } } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
