// Le ciel noir étoilé des écrans d'accueil d'Odin (connexion, première connexion au téléphone, écran de la maison au
// démarrage, portail de connexion) : quelques étoiles brillent fort (halo et petite croix lumineuse qui scintille), les
// autres doucement ; immobile si l'appareil demande moins d'animations. Même dessin que Pégase (pegase/src/ui/ecrans.ts,
// fonction `ciel`). Chaque <canvas class="ciel"> de la page est animé ; un canvas ajouté plus tard : OdinCiel.monter(c).
// Rien ne tourne quand aucun ciel n'est visible (après la connexion, Odin garde le thème choisi par la personne).
(() => {
  'use strict';
  if (window.OdinCiel) return;
  const etoiles = [];
  for (let i = 0; i < 260; i++) { const forte = Math.random() < 0.07; etoiles.push({ x: Math.random(), y: Math.random(), r: forte ? 1.3 + Math.random() * 1.1 : 0.4 + Math.random() * 0.9, b: forte ? 0.85 : 0.25 + Math.random() * 0.45, v: 0.4 + Math.random() * 1.6, p: Math.random() * 6.3, forte }); }
  const calme = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ciels = new Set();
  let anim = 0;
  function peindre(c, t) {
    const g = c.getContext('2d'); if (!g) return;
    const d = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    // Autant d'étoiles au cm² que sur un écran d'ordinateur (260 pour 1280 × 800) : moins sur un téléphone.
    const n = Math.max(110, Math.min(260, Math.round(260 * w * h / 1024000)));
    for (let i = 0; i < n; i++) {
      const s = etoiles[i];
      const sc = calme ? 1 : 0.55 + 0.45 * Math.sin(t / 1000 * s.v + s.p);
      const a = Math.min(1, s.b * (s.forte ? 0.6 + 0.4 * sc : sc)), x = s.x * w, y = s.y * h;
      if (s.forte) {
        const halo = g.createRadialGradient(x, y, 0, x, y, s.r * 7);
        halo.addColorStop(0, `rgba(210,225,255,${(a * 0.55).toFixed(3)})`); halo.addColorStop(1, 'rgba(210,225,255,0)');
        g.fillStyle = halo; g.beginPath(); g.arc(x, y, s.r * 7, 0, 6.2832); g.fill();
        g.strokeStyle = `rgba(255,255,255,${(a * 0.7).toFixed(3)})`; g.lineWidth = 0.8; const l = s.r * (4 + 3 * sc);
        g.beginPath(); g.moveTo(x - l, y); g.lineTo(x + l, y); g.moveTo(x, y - l); g.lineTo(x, y + l); g.stroke();
      }
      g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; g.beginPath(); g.arc(x, y, s.r, 0, 6.2832); g.fill();
    }
  }
  function image(t) {
    anim = 0; let visible = false;
    for (const c of ciels) {
      if (!c.isConnected) { ciels.delete(c); ro.unobserve(c); continue; }
      if (!c.clientWidth || !c.clientHeight) continue;
      visible = true; peindre(c, t);
    }
    // Immobile : on repeint seulement quand la taille change (l'observateur relance).
    if (visible && !calme) anim = requestAnimationFrame(image);
  }
  const relancer = () => { if (!anim) anim = requestAnimationFrame(image); };
  const ro = new ResizeObserver(relancer);
  function monter(c) { if (!c || ciels.has(c)) return; ciels.add(c); ro.observe(c); relancer(); }
  window.OdinCiel = { monter };
  const tous = () => document.querySelectorAll('canvas.ciel').forEach(monter);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tous); else tous();
})();
