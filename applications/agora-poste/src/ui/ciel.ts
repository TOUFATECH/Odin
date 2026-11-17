// Fond des écrans d'accueil (démarrage, connexion) : nuit noire, étoiles qui scintillent — quelques-unes brillent fort
// (halo et petite croix lumineuse), les autres doucement ; immobile si l'ordinateur demande moins d'animations.
// Même dessin que Pégase (pegase/src/ui/ecrans.ts, fonction `ciel`). Les étoiles restent les mêmes d'un écran à l'autre.

type Etoile = { x: number; y: number; r: number; b: number; v: number; p: number; forte: boolean };
const etoiles: Etoile[] = [];
let anim = 0;

/** Anime le ciel dans ce canvas (il s'arrête tout seul quand le canvas quitte la page). */
export function ciel(c: HTMLCanvasElement): void {
  const g = c.getContext('2d'); if (!g) return;
  if (!etoiles.length) for (let i = 0; i < 260; i++) { const forte = Math.random() < 0.07; etoiles.push({ x: Math.random(), y: Math.random(), r: forte ? 1.3 + Math.random() * 1.1 : 0.4 + Math.random() * 0.9, b: forte ? 0.85 : 0.25 + Math.random() * 0.45, v: 0.4 + Math.random() * 1.6, p: Math.random() * 6.3, forte }); }
  const calme = matchMedia('(prefers-reduced-motion: reduce)').matches;
  cancelAnimationFrame(anim);
  const dessiner = (t: number) => {
    if (!c.isConnected) return;
    const d = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
    for (const s of etoiles) {
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
    // Immobile : on redessine seulement si la fenêtre change de taille.
    if (!calme) anim = requestAnimationFrame(dessiner);
  };
  anim = requestAnimationFrame(dessiner);
  if (calme) { const ro = new ResizeObserver(() => { if (!c.isConnected) { ro.disconnect(); return; } anim = requestAnimationFrame(dessiner); }); ro.observe(c); }
}
