// Ulysse dans l'interface : les trajets de la famille, dessinés par Odin lui-même (aucune carte demandée à Internet,
// sauf si le fond en ligne est allumé). Trois onglets : Trajets · Lieux · Réglages.
// La même page sert au propriétaire (dans Odin, appli Ulysse) et à chaque membre (/trajets, avec ses identifiants
// OwnTracks) : seul le chemin des demandes change. Tout texte venu d'Odin est posé comme du texte, jamais comme du HTML.
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const NS = 'http://www.w3.org/2000/svg';
  const garnir = (n, a, kids) => {
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const el = (t, a = {}, ...kids) => garnir(document.createElement(t), a, kids);
  const sv = (t, a = {}, ...kids) => garnir(document.createElementNS(NS, t), a, kids);
  const CSS = `
.ul{display:flex;flex-direction:column;gap:14px;min-width:0;container-type:inline-size;container-name:ul;color:var(--ink)}
.ul *{min-width:0;box-sizing:border-box}
.ul-tete{display:flex;gap:10px 14px;align-items:center;flex-wrap:wrap}
.ul-tete h2{margin:0;font-size:20px;line-height:1.25;flex:1 1 160px;overflow-wrap:anywhere}
.ul-onglets{display:flex;gap:6px;flex:1 1 270px;max-width:440px}
.ul-onglets button{flex:1 1 0;min-height:40px;padding:0 4px;border-radius:10px;border:1px solid var(--line);background:none;color:var(--ink);font-weight:600;font-size:14.5px;cursor:pointer;white-space:nowrap}
.ul-onglets button[aria-selected=true]{background:var(--accent);color:var(--on-accent);border-color:transparent}
.ul-c{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.ul-c h3{margin:0 0 10px;font-size:15.5px;line-height:1.3;overflow-wrap:anywhere}
.ul-c h4{margin:14px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim,var(--muted))}
.ul-b{min-height:38px;padding:0 14px;border-radius:10px;border:1px solid var(--field);background:none;color:var(--ink);font-size:14px;line-height:1.2;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;max-width:100%}
.ul-b:hover{border-color:var(--field-h,var(--accent))}
.ul-b.p{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}
.ul-b.d{color:var(--bad);border-color:var(--bad-l2,var(--bad))}
.ul-b.s{min-height:34px;padding:0 10px;font-size:13px}
.ul-b[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.ul-b:disabled{opacity:.5;cursor:default}
.ul-i{min-height:38px;border-radius:10px;border:1px solid var(--field);background:var(--panel2);color:var(--ink);padding:0 10px;max-width:100%;font-size:14px}
.ul-sub{color:var(--muted);font-size:13.5px;line-height:1.5;margin:0;overflow-wrap:anywhere}
.ul-ligne{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ul-msg{border:1px solid var(--line);border-left:4px solid var(--good);border-radius:12px;padding:10px 12px;background:var(--panel2);font-size:14px;line-height:1.5;display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;overflow-wrap:anywhere}
.ul-msg.non{border-left-color:var(--bad)}.ul-msg p{margin:0;flex:1 1 220px;white-space:pre-wrap}
.ul-jour{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ul-jour b{flex:1 1 200px;font-size:16.5px;line-height:1.3}
.ul-jour b::first-letter{text-transform:uppercase}
.ul-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.ul-kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.ul-kpi small{display:block;color:var(--muted);font-size:12.5px;line-height:1.3}
.ul-kpi b{font-size:19px;font-variant-numeric:tabular-nums;line-height:1.3;overflow-wrap:anywhere}
.ul-g{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:14px;align-items:start}
.ul-carte{position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:var(--panel2);min-height:260px}
.ul-svg{display:block;max-width:100%;touch-action:pan-y;cursor:grab;outline-offset:-2px}
.ul-svg:active{cursor:grabbing}
.ul-fond{fill:var(--panel2)}
.ul-grille line{stroke:var(--line);stroke-width:1}
.ul-gaine{fill:none;stroke:var(--panel);stroke-width:8;stroke-linecap:round;stroke-linejoin:round;opacity:.9}
.ul-trace{fill:none;stroke:var(--accent);stroke-width:4;stroke-linecap:round;stroke-linejoin:round;cursor:pointer}
.ul-trace.estime{stroke-dasharray:2 9}
.ul-pale .ul-trace{stroke-width:3;opacity:.45}.ul-pale .ul-gaine{opacity:.4}.ul-pale .ul-fleche{opacity:.45}
.ul-fleche{fill:var(--accent);stroke:var(--panel);stroke-width:1.5;paint-order:stroke}
.ul-arret{cursor:pointer}
.ul-arret circle{fill:var(--ink);stroke:var(--panel);stroke-width:2}
.ul-arret text{fill:var(--bg);font-size:11.5px;font-weight:700;text-anchor:middle;dominant-baseline:central}
.ul-bout{fill:none;stroke-width:4}
.ul-bout.depart{stroke:var(--good)}.ul-bout.arrivee{stroke:var(--bad)}
.ul-pt{stroke:var(--panel);stroke-width:2}.ul-pt.depart{fill:var(--good)}.ul-pt.arrivee{fill:var(--bad)}
.ul-nom{font-size:12px;font-weight:600;fill:var(--ink);paint-order:stroke;stroke:var(--panel);stroke-width:3.5px;stroke-linejoin:round;text-anchor:middle}
.ul-lieu circle{fill:var(--accent);stroke:var(--panel);stroke-width:2}
.ul-lieu.sans circle{fill:var(--panel);stroke:var(--ink);stroke-dasharray:3 3}
.ul-zoom{position:absolute;top:8px;right:8px;display:flex;flex-direction:column;gap:6px}
.ul-zoom .ul-b{width:36px;min-height:36px;padding:0;font-size:18px;background:var(--panel);font-weight:600}
.ul-echelle{position:absolute;left:10px;bottom:8px;font-size:11.5px;color:var(--ink);display:flex;flex-direction:column;gap:2px;pointer-events:none;text-shadow:0 0 3px var(--panel),0 0 3px var(--panel)}
.ul-echelle i{display:block;height:6px;border:2px solid var(--ink);border-top:0}
.ul-credit{position:absolute;right:6px;bottom:4px;font-size:10.5px;color:var(--ink);background:color-mix(in srgb,var(--panel) 80%,transparent);border-radius:6px;padding:1px 6px;pointer-events:none}
.ul-credit:empty{display:none}
.ul-legende{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin:8px 0 0}
.ul-legende span{display:inline-flex;align-items:center;gap:6px}
.ul-legende i{display:inline-block;width:12px;height:12px;border-radius:50%}
.ul-etapes{list-style:none;margin:0;padding:0}
.ul-e{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;padding:10px 6px;border-top:1px solid var(--line);border-radius:10px}
.ul-e:first-child{border-top:0}
.ul-e.choisi{background:color-mix(in srgb,var(--accent) 12%,transparent)}
.ul-e .n{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:12.5px;font-weight:700;background:var(--ink);color:var(--bg)}
.ul-e.trajet .n{background:var(--accent);color:var(--on-accent);border-radius:8px}
.ul-e.coupure .n{background:none;color:var(--muted);border:1px dashed var(--line)}
.ul-e .t{font-weight:600;font-variant-numeric:tabular-nums;line-height:1.4;overflow-wrap:anywhere}
.ul-e .t button{all:unset;cursor:pointer;font-weight:600}
.ul-e .t button:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.ul-e .d{color:var(--muted);font-size:13.5px;line-height:1.45;overflow-wrap:anywhere}
.ul-e .a{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
.ul-paire{display:inline-flex;gap:8px;align-items:center}
.ul-jours{display:flex;gap:6px;flex-wrap:wrap}
.ul-vide{text-align:center;padding:26px 14px;color:var(--muted);line-height:1.55}
.ul-vide b{display:block;color:var(--ink);font-size:16px;margin:0 0 4px}
.ul-vide .ul-b{margin-top:12px}
.ul-fiches{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:14px;align-items:start}
.ul-etat{display:inline-block;font-size:12.5px;font-weight:600;padding:2px 10px;border-radius:999px;background:var(--field);vertical-align:middle;white-space:nowrap}
.ul-etat.on{background:color-mix(in srgb,var(--good) 24%,transparent)}.ul-etat.pause{background:color-mix(in srgb,var(--warn) 26%,transparent)}
.ul-coche{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.4;margin:8px 0}
.ul-coche input{width:20px;height:20px;flex:none;margin:0;accent-color:var(--accent)}
.ul-journal{list-style:none;margin:0;padding:0;font-size:13px;line-height:1.45}
.ul-journal li{padding:6px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}.ul-journal li:first-child{border-top:0}
.ul-journal small{display:block;color:var(--muted)}
.ul-form{display:flex;flex-direction:column;gap:8px;max-width:360px;margin:0 auto}
.ul-form label{font-size:14px;font-weight:600}
.ul-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@container ul (max-width:820px){.ul-g{grid-template-columns:minmax(0,1fr)}}
@container ul (max-width:560px){.ul-jour b{flex-basis:100%}.ul-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.ul-c{padding:12px}.ul-onglets{max-width:none}}
@supports not (container-type:inline-size){@media (max-width:900px){.ul-g{grid-template-columns:minmax(0,1fr)}.ul-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}}
`;
  const poserCss = () => { if (!document.getElementById('ulCss')) document.head.append(el('style', { id: 'ulCss' }, CSS)); };

  // ---------------- La carte (projection de Mercator, comme les cartes en ligne : formes et angles justes à cette échelle) ----------------
  const T = 256, RAD = Math.PI / 180;
  const mx = (lon, z) => ((lon + 180) / 360) * T * 2 ** z;
  const my = (lat, z) => { const s = Math.sin(Math.max(-85, Math.min(85, lat)) * RAD); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * T * 2 ** z; };
  const latDe = (y, z) => Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / (T * 2 ** z))) / RAD;
  const PAS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
  const longueurTxt = (m) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);
  /**
   * Dessine des trajets (lignes), des arrêts (pastilles numérotées) et des lieux (points nommés), à l'échelle.
   * o : { titre, trajets:[{n,points:[[lat,lon]],estime}], arrets:[{n,lat,lon,lieu}], lieux:[{lat,lon,nom,sans}], choisi, fond, attribution, tuile(z,x,y), surTrajet(n), surArret(n) }
   */
  function carte(o) {
    const boite = el('div', { class: 'ul-carte' });
    const dessin = sv('svg', { class: 'ul-svg', role: 'img', 'aria-label': o.titre, tabindex: '0' });
    const barre = el('i'), texte = el('span'), echelle = el('div', { class: 'ul-echelle', 'aria-hidden': 'true' }, texte, barre), credit = el('div', { class: 'ul-credit' }, o.fond ? o.attribution : '');
    let W = 0, H = 0, z = 13, cx = 0, cy = 0, ox = 0, oy = 0, monde = null, fondG = null, grille = null, vues = new Set(), file = [], enVol = 0, tour = 0, vivant = true, deplace = false, glisse = 0;
    const cadre = () => {
      const t = o.choisi ? o.trajets.filter((x) => x.n === o.choisi) : o.trajets, pts = t.flatMap((x) => x.points);
      if (!o.choisi || !pts.length) { for (const a of o.arrets) pts.push([a.lat, a.lon]); for (const l of o.lieux ?? []) pts.push([l.lat, l.lon]); }
      return pts;
    };
    function cadrer() {
      const pts = cadre(); if (!pts.length || !W) return;
      const marge = Math.min(46, W / 7), bornes = (zz) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const p of pts) { const x = mx(p[1], zz), y = my(p[0], zz); if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > d) d = y; } return [a, b, c, d]; };
      for (z = 16; z > 2; z--) { const [a, b, c, d] = bornes(z); if (b - a <= W - 2 * marge && d - c <= H - 2 * marge) break; }
      const [a, b, c, d] = bornes(z); cx = (a + b) / 2; cy = (c + d) / 2; deplace = false;
    }
    const placer = () => { if (monde) monde.setAttribute('transform', `translate(${(W / 2 - (cx - ox)).toFixed(1)} ${(H / 2 - (cy - oy)).toFixed(1)})`); };
    /** Ce qui dépend de la partie visible : l'échelle, le quadrillage (sans fond en ligne) ou les images du fond. */
    function completer() {
      if (!monde) return;
      const mpp = (40075016.686 * Math.cos(latDe(cy, z) * RAD)) / (T * 2 ** z), pas = PAS.find((p) => p / mpp >= 64) ?? PAS[PAS.length - 1], px = pas / mpp;
      barre.style.width = `${Math.round(px)}px`; texte.textContent = o.fond ? longueurTxt(pas) : `un carreau = ${longueurTxt(pas)}`;
      const x0 = cx - ox - W / 2, x1 = x0 + W, y0 = cy - oy - H / 2, y1 = y0 + H;
      if (!o.fond) {
        const l = [];
        for (let k = Math.floor(x0 / px); k <= Math.ceil(x1 / px); k++) l.push(sv('line', { x1: (k * px).toFixed(1), x2: (k * px).toFixed(1), y1: y0 - px, y2: y1 + px }));
        for (let k = Math.floor(y0 / px); k <= Math.ceil(y1 / px); k++) l.push(sv('line', { y1: (k * px).toFixed(1), y2: (k * px).toFixed(1), x1: x0 - px, x2: x1 + px }));
        grille.replaceChildren(...l);
        return;
      }
      const n = 2 ** z;
      for (let ty = Math.floor((cy - H / 2) / T); ty <= Math.floor((cy + H / 2) / T); ty++) for (let tx = Math.floor((cx - W / 2) / T); tx <= Math.floor((cx + W / 2) / T); tx++) {
        const k = `${tx}/${ty}`; if (ty < 0 || ty >= n || vues.has(k)) continue;
        vues.add(k); file.push([tx, ty, tour]);
      }
      pomper();
    }
    /** Les images du fond arrivent quatre par quatre, et seulement celles de la partie regardée. */
    function pomper() {
      while (enVol < 4 && file.length) {
        const [tx, ty, t] = file.shift(); if (t !== tour) continue;
        const n = 2 ** z, zz = z, g = fondG, dx = ox, dy = oy; enVol++;
        Promise.resolve(o.tuile(zz, ((tx % n) + n) % n, ty)).catch(() => null).then((src) => {
          enVol--;
          if (vivant && t === tour && src) g.append(sv('image', { href: src, x: tx * T - dx, y: ty * T - dy, width: T, height: T, preserveAspectRatio: 'none' }));
          if (vivant) pomper();
        });
      }
    }
    function tracer() {
      if (!W) return;
      tour++; vues = new Set(); file = [];
      dessin.setAttribute('viewBox', `0 0 ${W} ${H}`); dessin.setAttribute('width', W); dessin.setAttribute('height', H);
      ox = Math.round(cx); oy = Math.round(cy);
      const X = (lon) => mx(lon, z) - ox, Y = (lat) => my(lat, z) - oy;
      fondG = sv('g', {}); grille = sv('g', { class: 'ul-grille' });
      monde = sv('g', {}, fondG, grille);
      const ordre = [...o.trajets].sort((a, b) => (a.n === o.choisi ? 1 : 0) - (b.n === o.choisi ? 1 : 0));
      for (const t of ordre) {
        const pts = t.points.map((p) => [X(p[1]), Y(p[0])]), chaine = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
        const g = sv('g', { class: o.choisi && o.choisi !== t.n ? 'ul-pale' : '' }, sv('polyline', { points: chaine, class: 'ul-gaine' }),
          sv('polyline', { points: chaine, class: `ul-trace${t.estime ? ' estime' : ''}`, onclick: () => { if (Date.now() - glisse > 250) o.surTrajet?.(t.n); } }, sv('title', {}, `Trajet ${t.n}`)));
        // Une flèche au milieu du tracé donne le sens.
        let total = 0; const cumul = [0]; for (let k = 1; k < pts.length; k++) { total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); cumul.push(total); }
        const k = cumul.findIndex((c) => c >= total / 2);
        if (total > 40 && k > 0) { const [ax, ay] = pts[k - 1], [bx, by] = pts[k], f = (total / 2 - cumul[k - 1]) / Math.max(1e-9, cumul[k] - cumul[k - 1]); g.append(sv('path', { d: 'M-6,-5 L6,0 L-6,5 Z', class: 'ul-fleche', transform: `translate(${(ax + (bx - ax) * f).toFixed(1)} ${(ay + (by - ay) * f).toFixed(1)}) rotate(${((Math.atan2(by - ay, bx - ax) * 180) / Math.PI).toFixed(1)})` })); }
        monde.append(g);
      }
      // Départ et arrivée : du trajet choisi, sinon du premier et du dernier trajet du jour.
      const vus = o.choisi ? o.trajets.filter((t) => t.n === o.choisi) : o.trajets, dep = vus[0]?.points[0], arr = vus[vus.length - 1]?.points.at(-1);
      const bout = (p, sorte, nom, dy) => { const x = X(p[1]), y = Y(p[0]), surArret = o.arrets.some((a) => Math.hypot(X(a.lon) - x, Y(a.lat) - y) < 6); monde.append(surArret ? sv('circle', { cx: x, cy: y, r: 15, class: `ul-bout ${sorte}` }) : sv('circle', { cx: x, cy: y, r: 7, class: `ul-pt ${sorte}` }), sv('text', { x, y: y + dy, class: 'ul-nom' }, nom)); };
      for (const a of o.arrets) {
        const x = X(a.lon), y = Y(a.lat), nom = `Arrêt ${a.n}${a.lieu ? ` : ${a.lieu}` : ''}`, choisir = () => { if (Date.now() - glisse > 250) o.surArret?.(a.n); };
        monde.append(sv('g', { class: 'ul-arret', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, role: 'button', tabindex: '0', 'aria-label': nom, onclick: choisir, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.surArret?.(a.n); } } }, sv('title', {}, nom), sv('circle', { r: 11 }), sv('text', {}, String(a.n))));
      }
      if (dep) bout(dep, 'depart', 'Départ', -21);
      if (arr) bout(arr, 'arrivee', 'Arrivée', 31);
      for (const l of o.lieux ?? []) { const x = X(l.lon), y = Y(l.lat); monde.append(sv('g', { class: `ul-lieu${l.sans ? ' sans' : ''}` }, sv('circle', { cx: x, cy: y, r: 8 }), sv('text', { x, y: y - 14, class: 'ul-nom' }, l.nom))); }
      dessin.replaceChildren(sv('rect', { x: 0, y: 0, width: W, height: H, class: 'ul-fond' }), monde);
      placer(); completer();
    }
    function zoomer(d) { const nz = Math.max(3, Math.min(18, z + d)); if (nz === z) return; const k = 2 ** (nz - z); cx *= k; cy *= k; z = nz; deplace = true; tracer(); }
    // Glisser pour déplacer la carte (un doigt qui glisse de haut en bas fait défiler la page, comme partout).
    let prise = null;
    dessin.addEventListener('pointerdown', (e) => { if (e.button) return; prise = { x: e.clientX, y: e.clientY, cx, cy, id: e.pointerId, bouge: false }; });
    dessin.addEventListener('pointermove', (e) => {
      if (!prise || e.pointerId !== prise.id) return;
      const dx = e.clientX - prise.x, dy = e.clientY - prise.y;
      if (!prise.bouge) { if (Math.hypot(dx, dy) < 5) return; prise.bouge = true; try { dessin.setPointerCapture(e.pointerId); } catch { /* pointeur déjà parti */ } }
      cx = prise.cx - dx; cy = prise.cy - dy; deplace = true; placer();
    });
    const lacher = () => { if (!prise) return; const b = prise.bouge; prise = null; if (b) { glisse = Date.now(); completer(); } };
    dessin.addEventListener('pointerup', lacher); dessin.addEventListener('pointercancel', lacher);
    dessin.addEventListener('keydown', (e) => {
      if (e.target !== dessin) return;
      const pas = { ArrowLeft: [-60, 0], ArrowRight: [60, 0], ArrowUp: [0, -60], ArrowDown: [0, 60] }[e.key];
      if (pas) { e.preventDefault(); cx += pas[0]; cy += pas[1]; deplace = true; placer(); completer(); } else if (e.key === '+' || e.key === '=') zoomer(1); else if (e.key === '-') zoomer(-1);
    });
    boite.append(dessin, el('div', { class: 'ul-zoom' },
      el('button', { type: 'button', class: 'ul-b', 'aria-label': 'Agrandir la carte', title: 'Agrandir', onclick: () => zoomer(1) }, '+'),
      el('button', { type: 'button', class: 'ul-b', 'aria-label': 'Réduire la carte', title: 'Réduire', onclick: () => zoomer(-1) }, '−'),
      el('button', { type: 'button', class: 'ul-b', 'aria-label': 'Recadrer la carte', title: 'Recadrer', onclick: () => { cadrer(); tracer(); } }, '⤢')), echelle, credit);
    const mesurer = () => {
      const w = Math.floor(boite.clientWidth); if (!vivant || !w || w === W) return;
      W = w; H = Math.round(Math.max(260, Math.min(520, w * 0.64)));
      if (!deplace) cadrer();
      tracer();
    };
    const ro = new ResizeObserver(() => requestAnimationFrame(mesurer)); ro.observe(boite);
    return { boite, choisir: (n) => { o.choisi = n; cadrer(); tracer(); }, fin: () => { vivant = false; ro.disconnect(); } };
  }

  // ---------------- La page (propriétaire ou membre) ----------------
  /**
   * `api(action, input, confirm)` rend { ok, text, data, fichiers, confirm } ; `fichier(ref)` rend l'adresse d'un fichier
   * à télécharger ; `S` garde l'onglet, le membre et le jour d'un dessin à l'autre.
   */
  function monter(racine, api, fichier, S, entete) {
    let vue = null, etat = null, tuiles = new Map();
    const demander = async (action, input = {}) => {
      let r = await api(action, input, false);
      if (r && r.confirm) { if (!window.confirm(r.confirm)) return { ok: false, annule: true, text: 'Annulé.' }; r = await api(action, input, true); }
      return r ?? { ok: false, text: 'Odin n\'a pas répondu : réessaie.' };
    };
    const dire = (r) => { if (r.annule) return; S.msg = { texte: r.text ?? r.error ?? (r.ok ? 'Fait.' : 'Impossible.'), ok: r.ok !== false, fichiers: (r.fichiers ?? []).map((f) => ({ nom: String(f.nom), href: fichier(String(f.ref)) })) }; };
    /** Lance une demande qui change quelque chose, dit le résultat, puis redessine. */
    const agir = async (bouton, action, input) => { if (bouton) bouton.disabled = true; let r; try { r = await demander(action, input); } catch (e) { r = { ok: false, text: String(e?.message ?? e) }; } if (bouton) bouton.disabled = false; dire(r); if (!r.annule) await dessiner(); return r; };
    const tuile = async (z, x, y) => { const k = `${z}/${x}/${y}`; if (!tuiles.has(k)) { tuiles.set(k, api('tuile', { z, x, y }, false).then((r) => (r && r.ok && r.data ? r.data.image : null)).catch(() => null)); if (tuiles.size > 400) tuiles.delete(tuiles.keys().next().value); } return tuiles.get(k); };
    const jourCourt = (cle) => { const [y, m, d] = cle.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }); };
    const voisin = (cle, n) => { const [y, m, d] = cle.split('-').map(Number), x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const vide = (titre, texte, ...boutons) => el('div', { class: 'ul-c ul-vide' }, el('b', {}, titre), texte, boutons.length ? el('div', {}, ...boutons) : null);
    const versReglages = (texte = 'Ouvrir les réglages') => el('button', { type: 'button', class: 'ul-b p', onclick: () => { S.onglet = 'reglages'; dessiner(); } }, texte);
    const proprio = () => etat?.qui === 'proprio';
    const lui = (f) => (proprio() ? f.nom : 'toi');

    /** Pourquoi il n'y a rien à montrer pour ce membre (ou rien : tout va bien). */
    function empechement(f) {
      if (!f) return vide('Aucun membre pour l\'instant', 'Ajoute un membre dans Hestia (« Ajouter un membre (OwnTracks) »), puis installe l\'appli OwnTracks sur son téléphone : ses positions arriveront ici.');
      if (!f.lisible) return vide(`Les trajets de ${f.nom} ne sont visibles que par ${f.nom}`, `${f.nom} les regarde sur sa page (${location.origin}${etat.adresse}), avec ses identifiants OwnTracks, et peut choisir de te les montrer. Avec son accord, tu peux aussi le régler ici.`, versReglages());
      if (f.etat === 'éteint') return vide(proprio() ? `L'historique de ${f.nom} est éteint` : 'Ton historique est éteint', proprio() ? `Rien n'est gardé. Il s'allume avec l'accord de ${f.nom}, dans les réglages.` : 'Rien n\'est gardé : Odin ne connaît que ta dernière position (pour la carte de la famille). Allume ton historique pour revoir tes trajets ; tu pourras le mettre en pause ou l\'effacer quand tu veux.', versReglages(proprio() ? 'Ouvrir les réglages' : 'Allumer mon historique'));
      return null;
    }

    async function ongletTrajets(corps, f) {
      const non = empechement(f); if (non) { corps.append(non); return; }
      const jour = S.jour || f.dernier || etat.aujourdhui, r = await demander('trajets', { membre: f.id, jour });
      if (!r.ok || !r.data) { corps.append(vide('Trajets indisponibles', r.text ?? 'Réessaie dans un instant.')); return; }
      const d = r.data, trajets = d.etapes.filter((e) => e.genre === 'trajet'), arrets = d.etapes.filter((e) => e.genre === 'arret');
      if (!trajets.some((t) => t.n === S.choisi)) S.choisi = 0;
      const aller = (j) => { S.jour = j; S.choisi = 0; dessiner(); };
      const date = el('input', { type: 'date', class: 'ul-i', value: d.jour, max: d.aujourdhui, 'aria-label': 'Choisir un jour', onchange: (e) => { if (e.target.value) aller(e.target.value); } });
      corps.append(el('div', { class: 'ul-jour' },
        el('b', {}, d.libelle),
        el('button', { type: 'button', class: 'ul-b s', 'aria-label': 'Jour précédent', title: 'Jour précédent', onclick: () => aller(d.precedent ?? voisin(d.jour, -1)) }, '←'), date,
        el('button', { type: 'button', class: 'ul-b s', 'aria-label': 'Jour suivant', title: 'Jour suivant', disabled: d.jour >= d.aujourdhui, onclick: () => aller(d.suivant ?? voisin(d.jour, 1)) }, '→'),
        d.jour !== d.aujourdhui ? el('button', { type: 'button', class: 'ul-b s', onclick: () => aller(d.aujourdhui) }, 'Aujourd\'hui') : null));
      const kpi = (nom, valeur) => el('div', { class: 'ul-kpi' }, el('small', {}, nom), el('b', {}, valeur));
      corps.append(el('div', { class: 'ul-kpis' }, kpi('Distance', d.total.km), kpi('En déplacement', d.total.duree), kpi('Vitesse moyenne', d.total.vitesse || '—'), kpi('Trajets · arrêts', `${d.total.trajets} · ${d.total.arrets}`)));
      if (!trajets.length && !arrets.length) {
        corps.append(vide('Rien de gardé ce jour-là', f.etat === 'pause' ? 'L\'historique est en pause : aucune position n\'est gardée pour l\'instant.' : 'Aucune position n\'est arrivée ce jour-là. Si c\'est aujourd\'hui : l\'appli OwnTracks du téléphone envoie-t-elle bien ses positions à Odin ?'));
      } else {
        const liste = el('ol', { class: 'ul-etapes' });
        const choisir = (n) => { S.choisi = S.choisi === n ? 0 : n; vue?.choisir(S.choisi); for (const li of liste.children) li.classList.toggle('choisi', li.dataset.trajet === String(S.choisi) && S.choisi > 0); bascule.textContent = S.choisi ? 'Voir toute la journée' : ''; bascule.hidden = !S.choisi; };
        const montrerArret = (n) => { const li = [...liste.children].find((x) => x.dataset.arret === String(n)); if (li) { li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); li.classList.add('choisi'); setTimeout(() => li.classList.remove('choisi'), 1600); } };
        vue = carte({ titre: `Carte des trajets de ${f.nom}, ${d.libelle} : ${d.total.trajets} trajet(s), ${d.total.km}`, trajets: trajets.map((t) => ({ n: t.n, points: t.points, estime: t.estime })), arrets: arrets.map((a) => ({ n: a.n, lat: a.lat, lon: a.lon, lieu: a.lieu })), choisi: S.choisi, fond: etat.fond.allume, attribution: etat.fond.attribution, tuile, surTrajet: choisir, surArret: montrerArret });
        const bascule = el('button', { type: 'button', class: 'ul-b s', hidden: !S.choisi, onclick: () => choisir(S.choisi) }, S.choisi ? 'Voir toute la journée' : '');
        for (const e of d.etapes) {
          if (e.genre === 'coupure') { liste.append(el('li', { class: 'ul-e coupure' }, el('span', { class: 'n', 'aria-hidden': 'true' }, '⏸'), el('div', {}, el('div', { class: 't' }, `${e.debutTxt} → ${e.finTxt}`), el('div', { class: 'd' }, 'Rien de gardé : historique en pause, ou effacé.')))); continue; }
          if (e.genre === 'arret') {
            const quand = `${e.avant ? 'depuis la veille' : e.debutTxt} → ${e.apres ? 'le lendemain' : `${e.finEstimee ? 'vers ' : ''}${e.finTxt}`}`, nom = el('input', { class: 'ul-i', maxlength: '40', placeholder: 'Maison, Bureau…', 'aria-label': `Nom du lieu de l'arrêt ${e.n}`, value: e.lieu ?? '' });
            const form = el('form', { class: 'ul-ligne', hidden: true, style: 'margin-top:7px', onsubmit: (ev) => { ev.preventDefault(); if (!nom.value.trim()) return; agir(ev.submitter, 'nommer_lieu', e.lieu ? { membre: f.id, nom: nom.value, ancien: e.lieu } : { membre: f.id, nom: nom.value, jour: e.repere.jour, heure: e.repere.heure }); } }, nom, el('button', { type: 'submit', class: 'ul-b s p' }, 'Enregistrer'));
            liste.append(el('li', { class: 'ul-e arret', 'data-arret': String(e.n) }, el('span', { class: 'n', title: `Arrêt ${e.n}` }, String(e.n)), el('div', {},
              el('div', { class: 't' }, e.lieu ?? 'Lieu sans nom'), el('div', { class: 'd' }, `Arrêt · ${quand} · ${e.duree}${e.finEstimee ? ' (heure de départ estimée)' : ''}`),
              el('div', { class: 'a' }, el('button', { type: 'button', class: 'ul-b s', 'aria-expanded': 'false', onclick: (ev) => { form.hidden = !form.hidden; ev.currentTarget.setAttribute('aria-expanded', String(!form.hidden)); if (!form.hidden) nom.focus(); } }, e.lieu ? 'Renommer' : 'Nommer ce lieu'),
                el('a', { class: 'ul-b s', href: e.osm, target: '_blank', rel: 'noopener noreferrer', title: 'Ouvre ce point sur openstreetmap.org (ce site verra ce point)' }, 'OpenStreetMap ↗')), form)));
            continue;
          }
          liste.append(el('li', { class: `ul-e trajet${S.choisi === e.n ? ' choisi' : ''}`, 'data-trajet': String(e.n) }, el('span', { class: 'n', title: `Trajet ${e.n}` }, String(e.n)), el('div', {},
            el('div', { class: 't' }, el('button', { type: 'button', 'aria-label': `Trajet ${e.n}, ${e.debutTxt} à ${e.finTxt} : le montrer sur la carte`, onclick: () => choisir(e.n) }, `${e.estime ? 'vers ' : ''}${e.debutTxt} → ${e.finTxt}`)),
            el('div', { class: 'd' }, [e.km, e.duree, e.vitesse].filter(Boolean).join(' · '), e.de || e.vers ? ` · ${e.de ?? 'lieu sans nom'} → ${e.vers ?? 'lieu sans nom'}` : ''),
            e.estime ? el('div', { class: 'd' }, 'Tracé estimé : le téléphone n\'a rien envoyé pendant un moment.') : null,
            el('div', { class: 'a' }, el('button', { type: 'button', class: 'ul-b s', onclick: (ev) => agir(ev.currentTarget, 'exporter', { membre: f.id, jour: d.jour, trajet: e.n }) }, 'GPX'),
              el('button', { type: 'button', class: 'ul-b s d', onclick: (ev) => agir(ev.currentTarget, 'effacer', { membre: f.id, du: d.jour, trajet: e.n }) }, 'Effacer')))));
        }
        corps.append(el('div', { class: 'ul-g' },
          el('section', { class: 'ul-c', 'aria-label': 'Carte' }, vue.boite,
            el('div', { class: 'ul-legende' }, el('span', {}, el('i', { style: 'background:var(--good)' }), 'Départ'), el('span', {}, el('i', { style: 'background:var(--bad)' }), 'Arrivée'), el('span', {}, el('i', { style: 'background:var(--ink)' }), 'Arrêt'), d.etapes.some((e) => e.estime) ? el('span', {}, '┄ tracé estimé') : null, d.total.ecartes ? el('span', {}, `${d.total.ecartes} point${d.total.ecartes > 1 ? 's' : ''} aberrant${d.total.ecartes > 1 ? 's' : ''} écarté${d.total.ecartes > 1 ? 's' : ''}`) : null),
            etat.fond.allume ? null : el('p', { class: 'ul-sub', style: 'margin-top:6px' }, 'Carte dessinée par Odin, à l\'échelle, sans rien demander à Internet.')),
          el('section', { class: 'ul-c', 'aria-label': 'Étapes de la journée' }, el('div', { class: 'ul-ligne', style: 'justify-content:space-between;margin:0 0 4px' }, el('h3', { style: 'margin:0' }, 'La journée'), bascule), liste)));
      }
      if (f.jours.length > 1 || (f.jours.length === 1 && f.jours[0].jour !== d.jour)) corps.append(el('section', { class: 'ul-c' }, el('h3', {}, 'Derniers jours'), el('div', { class: 'ul-jours' }, ...[...f.jours].reverse().map((j) => el('button', { type: 'button', class: 'ul-b s', 'aria-pressed': String(j.jour === d.jour), onclick: () => aller(j.jour) }, `${jourCourt(j.jour)} · ${j.km.toLocaleString('fr-FR')} km`)))));
      if (trajets.length) corps.append(el('div', { class: 'ul-ligne' },
        el('button', { type: 'button', class: 'ul-b', onclick: (ev) => agir(ev.currentTarget, 'exporter', { membre: f.id, jour: d.jour }) }, 'Exporter la journée (GPX)'),
        el('button', { type: 'button', class: 'ul-b d', onclick: (ev) => agir(ev.currentTarget, 'effacer', { membre: f.id, du: d.jour, au: d.jour }) }, 'Effacer la journée')));
    }

    async function ongletLieux(corps, f) {
      const non = empechement(f); if (non) { corps.append(non); return; }
      const r = await demander('lieux', { membre: f.id });
      if (!r.ok || !r.data) { corps.append(vide('Lieux indisponibles', r.text ?? 'Réessaie dans un instant.')); return; }
      const d = r.data, osm = (x) => el('a', { class: 'ul-b s', href: x.osm, target: '_blank', rel: 'noopener noreferrer', title: 'Ouvre ce point sur openstreetmap.org (ce site verra ce point)' }, 'OpenStreetMap ↗');
      if (d.lieux.length || d.suggestions.length) {
        vue = carte({ titre: `Carte des lieux de ${f.nom}`, trajets: [], arrets: [], lieux: [...d.lieux.map((l) => ({ lat: l.lat, lon: l.lon, nom: l.nom })), ...d.suggestions.map((x, k) => ({ lat: x.lat, lon: x.lon, nom: `Sans nom ${k + 1}`, sans: true }))], choisi: 0, fond: etat.fond.allume, attribution: etat.fond.attribution, tuile });
        corps.append(el('section', { class: 'ul-c', 'aria-label': 'Carte des lieux' }, vue.boite));
      }
      corps.append(el('section', { class: 'ul-c' }, el('h3', {}, proprio() ? `Lieux nommés de ${f.nom}` : 'Tes lieux nommés'),
        d.lieux.length ? el('ol', { class: 'ul-etapes' }, ...d.lieux.map((l) => {
          const nom = el('input', { class: 'ul-i', maxlength: '40', value: l.nom, 'aria-label': `Nouveau nom de ${l.nom}` });
          const form = el('form', { class: 'ul-ligne', hidden: true, style: 'margin-top:7px', onsubmit: (ev) => { ev.preventDefault(); if (nom.value.trim() && nom.value.trim() !== l.nom) agir(ev.submitter, 'nommer_lieu', { membre: f.id, nom: nom.value, ancien: l.nom }); } }, nom, el('button', { type: 'submit', class: 'ul-b s p' }, 'Enregistrer'));
          return el('li', { class: 'ul-e trajet' }, el('span', { class: 'n', 'aria-hidden': 'true' }, '★'), el('div', {}, el('div', { class: 't' }, l.nom), el('div', { class: 'd' }, `${l.visites} passage${l.visites > 1 ? 's' : ''} en 60 jours · ${l.duree} sur place · rayon ${l.rayon} m`),
            el('div', { class: 'a' }, el('button', { type: 'button', class: 'ul-b s', onclick: () => { form.hidden = !form.hidden; if (!form.hidden) nom.focus(); } }, 'Renommer'), el('button', { type: 'button', class: 'ul-b s d', onclick: (ev) => agir(ev.currentTarget, 'retirer_lieu', { membre: f.id, nom: l.nom }) }, 'Retirer'), osm(l)), form));
        })) : el('p', { class: 'ul-sub' }, 'Aucun lieu nommé pour l\'instant. Donne un nom à un arrêt (onglet Trajets) ou à un endroit fréquent ci-dessous : « Maison », « Bureau »… Aucun service extérieur ne cherche les adresses.')));
      if (d.suggestions.length) corps.append(el('section', { class: 'ul-c' }, el('h3', {}, proprio() ? `Endroits où ${f.nom} s'arrête souvent` : 'Endroits où tu t\'arrêtes souvent'), el('ol', { class: 'ul-etapes' }, ...d.suggestions.map((x, k) => {
        const nom = el('input', { class: 'ul-i', maxlength: '40', placeholder: 'Maison, Bureau…', 'aria-label': `Nom de l'endroit sans nom ${k + 1}` });
        return el('li', { class: 'ul-e arret' }, el('span', { class: 'n', 'aria-hidden': 'true' }, String(k + 1)), el('div', {}, el('div', { class: 't' }, `Sans nom ${k + 1}`), el('div', { class: 'd' }, `${x.visites} passage${x.visites > 1 ? 's' : ''} · ${x.duree} sur place · dernière fois le ${x.dernier}`),
          el('form', { class: 'ul-ligne a', onsubmit: (ev) => { ev.preventDefault(); if (nom.value.trim()) agir(ev.submitter, 'nommer_lieu', { membre: f.id, nom: nom.value, jour: x.repere.jour, heure: x.repere.heure }); } }, nom, el('button', { type: 'submit', class: 'ul-b s p' }, 'Nommer'), osm(x))));
      }))));
    }

    function ongletReglages(corps) {
      const l = etat.membres;
      if (!l.length) corps.append(empechement(undefined));
      const fiches = el('div', { class: 'ul-fiches' });
      for (const f of l) {
        const pp = proprio(), accord = pp ? el('input', { type: 'checkbox', id: `ulOk-${f.id}` }) : null, avec = (i) => ({ membre: f.id, ...i, ...(accord ? { accord: accord.checked } : {}) });
        const du = el('input', { type: 'date', class: 'ul-i', max: etat.aujourdhui, 'aria-label': 'Effacer à partir du', value: f.premier ?? '' }), au = el('input', { type: 'date', class: 'ul-i', max: etat.aujourdhui, 'aria-label': 'Effacer jusqu\'au', value: f.dernier ?? '' });
        const phrase = f.etat === 'allumé' ? `${pp ? 'Ses' : 'Tes'} positions sont gardées ${f.conservationTxt}${f.depuis ? ` (allumé le ${f.depuis})` : ''}, puis effacées toutes seules.` : f.etat === 'pause' ? `En pause : plus rien n'est gardé. Ce qui l'était reste ${f.conservationTxt} au plus.` : `Rien n'est gardé. Odin ne connaît que ${pp ? 'sa' : 'ta'} dernière position (pour la carte de la famille).`;
        fiches.append(el('section', { class: 'ul-c', 'aria-label': `Réglages de ${f.nom}` },
          el('h3', {}, pp ? f.nom : 'Mon historique', ' ', el('span', { class: `ul-etat ${f.etat === 'allumé' ? 'on' : f.etat === 'pause' ? 'pause' : ''}` }, f.etat === 'allumé' ? 'Allumé' : f.etat === 'pause' ? 'En pause' : 'Éteint')),
          el('p', { class: 'ul-sub' }, phrase),
          pp ? el('label', { class: 'ul-coche', for: `ulOk-${f.id}` }, accord, el('span', {}, `${f.nom} est d'accord (ou c'est mon téléphone). `, el('span', { class: 'ul-sub' }, 'À cocher pour allumer, garder plus longtemps ou voir ses trajets : c\'est noté dans son journal.'))) : null,
          el('div', { class: 'ul-ligne' },
            f.etat !== 'allumé' ? el('button', { type: 'button', class: 'ul-b p', onclick: (ev) => agir(ev.currentTarget, 'allumer', avec({})) }, f.etat === 'pause' ? 'Reprendre' : 'Allumer l\'historique') : null,
            f.etat === 'allumé' ? el('button', { type: 'button', class: 'ul-b', onclick: (ev) => agir(ev.currentTarget, 'pause', { membre: f.id }) }, 'Mettre en pause') : null,
            f.etat !== 'éteint' ? el('button', { type: 'button', class: 'ul-b d', onclick: (ev) => agir(ev.currentTarget, 'eteindre', { membre: f.id }) }, 'Éteindre et tout effacer') : null),
          el('h4', {}, 'Gardé pendant'),
          el('div', { class: 'ul-ligne', role: 'group', 'aria-label': 'Durée de conservation' }, ...etat.durees.map((t) => el('button', { type: 'button', class: 'ul-b s', 'aria-pressed': String(t === f.conservationTxt), onclick: (ev) => { if (t !== f.conservationTxt) agir(ev.currentTarget, 'conservation', avec({ duree: t })); } }, t))),
          el('h4', {}, 'Qui voit les trajets'),
          el('p', { class: 'ul-sub' }, f.visible ? (pp ? `Toi et ${f.nom}.` : 'Toi et le propriétaire d\'Odin.') : (pp ? `${f.nom} seulement, sur sa page.` : 'Toi seulement.')),
          el('div', { class: 'ul-ligne', style: 'margin-top:6px' }, el('button', { type: 'button', class: 'ul-b s', onclick: (ev) => agir(ev.currentTarget, 'partage', avec({ visible: !f.visible })) }, f.visible ? (pp ? 'Ne plus voir ses trajets' : 'Ne plus montrer mes trajets') : (pp ? 'Voir ses trajets' : 'Montrer mes trajets au propriétaire'))),
          f.etat !== 'éteint' ? [el('h4', {}, 'Effacer'),
            f.lisible ? el('div', { class: 'ul-ligne' }, el('span', { class: 'ul-paire' }, el('span', { class: 'ul-sub' }, 'du'), du), el('span', { class: 'ul-paire' }, el('span', { class: 'ul-sub' }, 'au'), au), el('button', { type: 'button', class: 'ul-b s d', onclick: (ev) => { if (du.value && au.value) agir(ev.currentTarget, 'effacer', { membre: f.id, du: du.value, au: au.value }); else { S.msg = { texte: 'Choisis le premier et le dernier jour à effacer.', ok: false, fichiers: [] }; dessiner(); } } }, 'Effacer ces jours')) : null,
            el('div', { class: 'ul-ligne', style: 'margin-top:8px' }, el('button', { type: 'button', class: 'ul-b s d', onclick: (ev) => agir(ev.currentTarget, 'effacer', { membre: f.id }) }, 'Effacer tout l\'historique'))] : null,
          el('h4', {}, 'Journal des accords'),
          f.journal.length ? el('ul', { class: 'ul-journal' }, ...f.journal.slice(0, 8).map((n) => el('li', {}, n.quoi, el('small', {}, `${n.quand} · par ${n.par}`)))) : el('p', { class: 'ul-sub' }, 'Rien pour l\'instant.')));
      }
      corps.append(fiches);
      const autres = el('div', { class: 'ul-fiches' });
      if (proprio()) {
        autres.append(el('section', { class: 'ul-c', 'aria-label': 'Fond de carte' }, el('h3', {}, 'Fond de carte en ligne ', el('span', { class: `ul-etat ${etat.fond.allume ? 'pause' : ''}` }, etat.fond.allume ? 'Allumé' : 'Éteint')),
          el('p', { class: 'ul-sub' }, etat.fond.allume ? `Odin demande à ${etat.fond.hote} les images de la zone que tu regardes, et les garde 7 jours. Ce serveur voit l'adresse d'Odin et cette zone ; jamais les points ni les trajets.` : `Éteint : la carte est dessinée par Odin seul, sans rien demander à Internet. Si tu l'allumes, Odin demandera à ${etat.fond.hote} les images de la zone regardée : ce serveur verra l'adresse d'Odin et cette zone (jamais les points ni les trajets).`),
          el('div', { class: 'ul-ligne', style: 'margin-top:10px' }, el('button', { type: 'button', class: 'ul-b', onclick: (ev) => agir(ev.currentTarget, 'fond_de_carte', { allume: !etat.fond.allume }) }, etat.fond.allume ? 'Éteindre le fond en ligne' : 'Allumer le fond en ligne'))),
        el('section', { class: 'ul-c', 'aria-label': 'Page des membres' }, el('h3', {}, 'La page de chaque membre'),
          el('p', { class: 'ul-sub' }, `Chaque membre ouvre ${location.origin}${etat.adresse} avec les identifiants OwnTracks que Hestia lui a donnés. Il y voit ses trajets, et lui seul décide : allumer, mettre en pause, effacer, te montrer ses trajets ou non.`)));
      }
      autres.append(el('section', { class: 'ul-c', 'aria-label': 'Vie privée' }, el('h3', {}, 'Vie privée'),
        el('p', { class: 'ul-sub' }, 'Les positions restent sur la machine d\'Odin, dans un dossier fermé. Elles ne partent ni dans une alerte, ni dans ce qui est donné à l\'IA. Un point ne quitte Odin que si tu cliques « OpenStreetMap ↗ » ou si tu télécharges un fichier GPX.')));
      corps.append(autres);
    }

    async function dessiner() {
      poserCss();
      try { const r = await api('etat', {}, false); if (!r || !r.ok || !r.data) { racine.replaceChildren(el('div', { class: 'ul' }, vide('Ulysse ne répond pas', r?.text ?? r?.error ?? 'Réessaie dans un instant.'))); return; } etat = r.data; }
      catch (e) { if (e?.sortie) return; racine.replaceChildren(el('div', { class: 'ul' }, vide('Ulysse ne répond pas', String(e?.message ?? e)))); return; }
      vue?.fin(); vue = null;
      const l = etat.membres, f = l.find((m) => m.id === S.membre) ?? l.find((m) => m.lisible && m.etat !== 'éteint') ?? l[0];
      S.membre = f?.id ?? '';
      const onglets = [['trajets', 'Trajets'], ['lieux', 'Lieux'], ['reglages', 'Réglages']];
      const boite = el('div', { class: 'ul' }), corps = el('div', { class: 'ul', role: 'tabpanel', 'aria-label': onglets.find((x) => x[0] === S.onglet)?.[1] });
      boite.append(el('div', { class: 'ul-tete' },
        entete?.(etat) ?? null,
        proprio() && l.length > 1 && S.onglet !== 'reglages' ? el('select', { class: 'ul-i', 'aria-label': 'Membre', onchange: (e) => { S.membre = e.target.value; S.jour = ''; S.choisi = 0; dessiner(); } }, ...l.map((m) => el('option', { value: m.id, selected: m.id === S.membre }, m.nom))) : null,
        el('div', { class: 'ul-onglets', role: 'tablist', 'aria-label': 'Ulysse' }, ...onglets.map(([id, nom]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(S.onglet === id), onclick: () => { S.onglet = id; dessiner(); } }, nom)))));
      if (S.msg) {
        const m = S.msg; S.msg = null;
        boite.append(el('div', { class: `ul-msg${m.ok ? '' : ' non'}`, role: m.ok ? 'status' : 'alert' }, el('p', {}, m.texte), ...m.fichiers.map((x) => el('a', { class: 'ul-b s p', href: x.href, download: x.nom }, `Télécharger ${x.nom}`))));
      }
      boite.append(corps);
      try { if (S.onglet === 'reglages') ongletReglages(corps); else if (S.onglet === 'lieux') await ongletLieux(corps, f); else await ongletTrajets(corps, f); }
      catch (e) { if (e?.sortie) return; corps.append(vide('Un souci d\'affichage', String(e?.message ?? e))); }
      racine.replaceChildren(boite);
    }
    return { dessiner, fin: () => vue?.fin() };
  }

  // ---------------- Dans Odin (le propriétaire) ----------------
  const etatProprio = { onglet: 'trajets', membre: '', jour: '', choisi: 0, msg: null };
  let page = null;
  window.OdinPages.gna = async ({ host }) => {
    const api = async (action, input, confirm) => {
      const r = await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'gna', action, input, confirm: confirm === true }) });
      if (r.status === 401) return { ok: false, text: 'Ta session a expiré : recharge la page et reconnecte-toi.' };
      return r.json();
    };
    page?.fin();
    const racine = el('div', {}); host.append(racine);
    page = monter(racine, api, (ref) => `/api/valhalla/fichier?${new URLSearchParams({ module: 'gna', ref })}`, etatProprio);
    await page.dessiner();
  };

  // ---------------- Sur la page d'un membre (/trajets) ----------------
  function pageMembre(racine) {
    poserCss();
    const S = { onglet: 'trajets', membre: '', jour: '', choisi: 0, msg: null };
    const envoyer = async (chemin, corps) => fetch(`/api/trajets/${chemin}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(corps ?? {}) });
    const api = async (action, input, confirm) => {
      const r = await envoyer('act', { action, input, confirm: confirm === true });
      if (r.status === 401) { entrer(); const e = new Error('connexion requise'); e.sortie = true; throw e; }
      return r.json();
    };
    function entrer(erreur) {
      const id = el('input', { id: 'ulId', class: 'ul-i', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true }), mdp = el('input', { id: 'ulMdp', class: 'ul-i', type: 'password', autocomplete: 'current-password', required: true });
      const non = el('p', { class: 'ul-sub', role: 'alert', style: 'color:var(--bad)' }, erreur ?? '');
      racine.replaceChildren(el('div', { class: 'ul' }, el('div', { class: 'ul-c' }, el('form', { class: 'ul-form', onsubmit: async (e) => {
        e.preventDefault(); non.textContent = ''; const b = e.submitter; if (b) b.disabled = true;
        try { const r = await envoyer('entrer', { identifiant: id.value, mot_de_passe: mdp.value }), j = await r.json().catch(() => ({})); mdp.value = ''; if (r.ok && j.ok) { await p.dessiner(); return; } non.textContent = j.error ?? (r.status === 429 ? 'Trop d\'essais : réessaie dans 15 minutes.' : 'Connexion impossible : réessaie.'); }
        catch { non.textContent = 'Odin ne répond pas : vérifie ta connexion.'; }
        if (b) b.disabled = false;
      } },
      el('h2', { style: 'margin:0;font-size:22px;text-align:center' }, 'Mes trajets'),
      el('p', { class: 'ul-sub', style: 'text-align:center' }, 'Entre avec les identifiants de l\'appli OwnTracks de ton téléphone (ceux que le propriétaire d\'Odin t\'a donnés). Tu ne verras que tes trajets, et toi seul décides de ce qui est gardé.'),
      el('label', { for: 'ulId' }, 'Identifiant'), id, el('label', { for: 'ulMdp' }, 'Mot de passe'), mdp, non,
      el('button', { type: 'submit', class: 'ul-b p' }, 'Entrer')))));
      id.focus();
    }
    const entete = (etat) => [el('h2', {}, `Mes trajets · ${etat.membres[0]?.nom ?? ''}`), el('button', { type: 'button', class: 'ul-b s', onclick: async () => { await envoyer('sortir').catch(() => null); entrer(); } }, 'Se déconnecter')];
    const p = monter(racine, api, (ref) => `/api/trajets/fichier?${new URLSearchParams({ ref })}`, S, entete);
    p.dessiner();
  }
  if (document.documentElement.dataset.ulysse === 'membre') {
    const lancer = () => { const m = document.getElementById('ulysse'); if (m) pageMembre(m); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lancer); else lancer();
  }
})();
