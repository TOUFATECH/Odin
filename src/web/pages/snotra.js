// Plume dans l'interface : quatre onglets.
// - Documents : ce que Plume faisait déjà (la vue générique : documents, créer un document ou un tableur…).
// - Correcteur : on colle un texte, les fautes sont listées avec leurs propositions ; un clic corrige.
// - Tableaux : un tableau blanc (rectangle, ellipse, flèche, trait libre, texte), sélection, déplacement, annuler,
//   plusieurs tableaux enregistrés tout seuls, export SVG et PNG.
// - Schémas : des blocs isométriques (serveur, PC, box, NAS, caméra, nuage…) posés sur une grille, reliés et nommés ;
//   « Schéma de mon réseau » part des appareils d'Atlas ; export SVG et PNG.
// Tout passe par les actions de Plume (/api/valhalla/act) : le serveur vérifie et range chaque tableau.
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const sv = (t, a = {}) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) if (v != null) n.setAttribute(k, String(v)); return n; };
  const act = async (action, input = {}, confirm = false) => {
    const r = await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'snotra', action, input, confirm }) });
    const j = await r.json().catch(() => ({ ok: false, text: `Odin répond ${r.status}` }));
    if (j.confirm && !confirm) return window.confirm(j.confirm) ? act(action, input, true) : { ok: false, text: 'Annulé.' };
    return j;
  };
  const telecharger = (f) => { const a = el('a', { href: `/api/valhalla/fichier?module=snotra&ref=${encodeURIComponent(f.ref)}`, download: f.nom }); document.body.append(a); a.click(); a.remove(); };
  const CSS = `
.pl{display:flex;flex-direction:column;gap:14px;min-width:0}
.pl-tabs{display:flex;gap:6px;flex-wrap:wrap}.pl-tabs button{min-height:40px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--muted);padding:0 14px;font:600 13.5px inherit;cursor:pointer}
.pl-tabs button[aria-selected=true]{background:var(--panel2);color:var(--ink);border-color:var(--ink)}
.pl-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.pl-bar button,.pl-bar select,.pl-bar input{min-height:40px;min-width:40px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:0 10px;font:inherit;font-size:13px;cursor:pointer}
.pl-bar input[type=text]{cursor:text;min-width:0;flex:1 1 140px;max-width:260px}
.pl-bar input[type=color]{padding:2px;width:44px}
.pl-bar button[aria-pressed=true]{background:var(--panel2);border-color:var(--ink);font-weight:600}
.pl-bar .sep{flex:0 0 1px;height:28px;background:var(--line)}
.pl-bar .etat{font-size:12.5px;color:var(--muted);margin-left:auto}
.pl-zone{border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
.pl-zone svg{display:block;width:100%;height:min(64vh,620px)}
.pl-corr textarea{width:100%;min-height:180px;box-sizing:border-box;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:10px;font:inherit;font-size:14px;line-height:1.5}
.pl-fautes{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.pl-fautes li{border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--panel)}
.pl-fautes .ex{font-size:13px;color:var(--muted);overflow-wrap:anywhere}.pl-fautes .ex mark{background:#fde68a;color:#111;border-radius:3px}
.pl-fautes .sug{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.pl-fautes .sug button{min-height:36px;border-radius:9px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);padding:0 10px;cursor:pointer}
.pl-sub{font-size:13px;color:var(--muted);margin:0}
`;
  const style = () => { if (!document.getElementById('pl-css')) document.head.append(el('style', { id: 'pl-css' }, CSS)); };
  const S = { tab: 'Documents', tableau: null, schema: null };

  // ------------------------------------------------------------------ correcteur
  function correcteur(root) {
    const zone = el('textarea', { 'aria-label': 'Texte à corriger', placeholder: 'Colle ou écris ton texte ici…' }), liste = el('ul', { class: 'pl-fautes' }), info = el('p', { class: 'pl-sub' }, 'Orthographe, accords simples, majuscules, espaces et ponctuation française.');
    let fautes = [];
    const remplacer = (f, v) => { zone.value = zone.value.slice(0, f.debut) + v + zone.value.slice(f.debut + f.longueur); lancer(); };
    const lancer = async () => {
      const texte = zone.value; if (!texte.trim()) { liste.replaceChildren(); info.textContent = 'Rien à corriger : le texte est vide.'; return; }
      info.textContent = 'Correction…';
      const r = await act('corriger', { texte });
      if (r.ok === false) { info.textContent = r.text; return; }
      fautes = r.data?.fautes ?? [];
      info.textContent = fautes.length ? `${fautes.length} chose(s) à corriger · correcteur ${r.data?.moteur === 'LanguageTool' ? 'LanguageTool' : 'de base'}${r.data?.remarque ? ` · ${r.data.remarque}` : ''}` : `Rien à corriger trouvé (correcteur ${r.data?.moteur === 'LanguageTool' ? 'LanguageTool' : 'de base, qui ne voit pas tout'}).`;
      liste.replaceChildren(...fautes.map((f) => el('li', {},
        el('div', {}, f.message),
        el('div', { class: 'ex' }, texte.slice(Math.max(0, f.debut - 30), f.debut), el('mark', {}, texte.slice(f.debut, f.debut + f.longueur) || '␣'), texte.slice(f.debut + f.longueur, f.debut + f.longueur + 30)),
        el('div', { class: 'sug' }, ...f.suggestions.slice(0, 4).map((v) => el('button', { type: 'button', onclick: () => remplacer(f, v) }, v.replace(/ | /g, '·') || '(effacer)'))))));
    };
    const toutCorriger = () => { if (r0()) return; let t = zone.value; for (const f of [...fautes].sort((a, b) => b.debut - a.debut)) if (f.suggestions[0] !== undefined) t = t.slice(0, f.debut) + f.suggestions[0] + t.slice(f.debut + f.longueur); zone.value = t; lancer(); };
    const r0 = () => !fautes.length;
    root.append(el('section', { class: 'pl-corr va-sec' }, el('h2', {}, 'Corriger un texte'), zone,
      el('div', { class: 'pl-bar', style: 'margin:8px 0' }, el('button', { type: 'button', onclick: lancer }, 'Corriger'), el('button', { type: 'button', onclick: toutCorriger }, 'Tout corriger'), el('button', { type: 'button', onclick: () => navigator.clipboard?.writeText(zone.value) }, 'Copier le texte')),
      info, liste));
  }

  // ------------------------------------------------------------------ éditeurs communs
  /** Liste des tableaux d'un genre + barre (nouveau, nom, supprimer, exporter). `ouvrir(id)` recharge l'éditeur. */
  async function choix(root, genre, cle, ouvrir) {
    const r = await act('tableaux'); const l = (r.data ?? []).filter((d) => d.genre === genre);
    if (!S[cle] || !l.some((d) => d.id === S[cle])) S[cle] = l[0]?.id ?? null;
    const sel = el('select', { 'aria-label': genre === 'schema' ? 'Schéma' : 'Tableau', onchange: (e) => { S[cle] = e.target.value; ouvrir(); } }, ...l.map((d) => el('option', { value: d.id, selected: d.id === S[cle] }, d.nom)));
    const nouveau = async () => { const nom = window.prompt('Nom du nouveau ' + (genre === 'schema' ? 'schéma' : 'tableau'), genre === 'schema' ? 'Schéma' : 'Tableau'); if (nom == null) return; const x = await act('enregistrer_tableau', { nom, genre, contenu: '{}' }); if (x.ok !== false) { S[cle] = x.data.id; ouvrir(); } };
    return { l, barre: [l.length ? sel : null, el('button', { type: 'button', onclick: nouveau }, 'Nouveau')] };
  }
  const exporter = async (id, format) => {
    const r = await act('exporter_tableau', { id, format });
    if (r.fichiers?.[0]) return telecharger(r.fichiers[0]);
    if (format === 'png') {
      // Pas de programme pour le PNG sur la machine d'Odin : le navigateur le fait à partir du SVG.
      const s = await act('exporter_tableau', { id, format: 'svg' }); const svg = s.data?.svg; if (!svg) return window.alert(r.text);
      const img = new Image(); img.onload = () => { const c = el('canvas', { width: img.naturalWidth || 800, height: img.naturalHeight || 600 }); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0); c.toBlob((b) => { const a = el('a', { href: URL.createObjectURL(b), download: 'tableau.png' }); document.body.append(a); a.click(); a.remove(); }, 'image/png'); };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; return;
    }
    window.alert(r.text);
  };
  /** Un point du pointeur dans les coordonnées du dessin. */
  const point = (svg, e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const m = svg.getScreenCTM(); const q = m ? p.matrixTransform(m.inverse()) : p; return { x: Math.round(q.x), y: Math.round(q.y) }; };

  // ------------------------------------------------------------------ tableau blanc
  async function tableau(root) {
    const hote = el('div', { class: 'pl' }); root.append(hote);
    const ouvrir = async () => {
      const c = await choix(hote, 'tableau', 'tableau', ouvrir);
      let d = S.tableau ? (await act('ouvrir_tableau', { id: S.tableau })).data : null;
      if (!d) { hote.replaceChildren(el('div', { class: 'pl-bar' }, ...c.barre), el('p', { class: 'pl-sub' }, 'Aucun tableau blanc : « Nouveau » en crée un.')); return; }
      const E = { outil: 'select', couleur: '#1f2937', ep: 3, sel: null, histo: [], sale: false, minuteur: 0 };
      const etat = el('span', { class: 'etat', role: 'status' }, 'Enregistré');
      const svg = sv('svg', { viewBox: '0 0 1200 800', preserveAspectRatio: 'xMidYMin meet', role: 'img', 'aria-label': `Tableau blanc ${d.nom}` });
      const nom = el('input', { type: 'text', value: d.nom, 'aria-label': 'Nom du tableau', onchange: () => { d.nom = nom.value.trim() || d.nom; changer(false); } });
      const enregistrer = async () => { clearTimeout(E.minuteur); etat.textContent = 'Enregistrement…'; const r = await act('enregistrer_tableau', { id: d.id, nom: d.nom, contenu: JSON.stringify({ formes: d.formes }) }); etat.textContent = r.ok === false ? r.text : 'Enregistré'; E.sale = r.ok === false; };
      const garder = () => { E.histo.push(JSON.stringify(d.formes)); if (E.histo.length > 100) E.histo.shift(); };
      const changer = (h = true) => { if (h) dessiner(); E.sale = true; etat.textContent = 'Modifié…'; clearTimeout(E.minuteur); E.minuteur = setTimeout(enregistrer, 1200); };
      const outils = [['select', 'Choisir'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['fleche', 'Flèche'], ['trait', 'Trait libre'], ['texte', 'Texte']];
      const boutons = outils.map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(E.outil === k), 'data-outil': k, onclick: () => { E.outil = k; boutons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.outil === k))); } }, t));
      const annuler = () => { const x = E.histo.pop(); if (x) { d.formes = JSON.parse(x); E.sel = null; changer(); } };
      const supprimer = () => { if (!E.sel) return; garder(); d.formes = d.formes.filter((f) => f.id !== E.sel); E.sel = null; changer(); };
      const effacerTableau = async () => { const r = await act('supprimer_tableau', { id: d.id }); if (r.ok !== false) { S.tableau = null; ouvrir(); } };
      const dessiner = () => {
        svg.replaceChildren(sv('defs'), sv('rect', { x: -5000, y: -5000, width: 10000, height: 10000, fill: '#ffffff', 'data-fond': '1' }));
        svg.firstChild.innerHTML = '<marker id="pl-pointe" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker>';
        for (const f of d.formes) {
          const a = { stroke: f.couleur, 'stroke-width': f.ep, fill: f.fond ?? 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-id': f.id, 'pointer-events': 'all' };
          const x = Math.min(f.x, f.x + f.w), y = Math.min(f.y, f.y + f.h), w = Math.abs(f.w), h = Math.abs(f.h); let n;
          if (f.t === 'rect') n = sv('rect', { ...a, x, y, width: w, height: h, rx: 6 });
          else if (f.t === 'ellipse') n = sv('ellipse', { ...a, cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 });
          else if (f.t === 'fleche') n = sv('line', { ...a, x1: f.x, y1: f.y, x2: f.x + f.w, y2: f.y + f.h, 'marker-end': 'url(#pl-pointe)' });
          else if (f.t === 'trait') { const p = []; for (let i = 0; i + 1 < f.pts.length; i += 2) p.push(`${f.x + f.pts[i]},${f.y + f.pts[i + 1]}`); n = sv('polyline', { ...a, points: p.join(' ') }); }
          else { n = sv('text', { x: f.x, y: f.y, fill: f.couleur, 'font-family': 'sans-serif', 'font-size': 18, 'data-id': f.id }); (f.texte ?? '').split('\n').forEach((l, i) => { const t = sv('tspan', { x: f.x, dy: i ? 22 : 18 }); t.textContent = l; n.append(t); }); }
          svg.append(n);
          if (f.id === E.sel) { const b = n.getBBox(); svg.append(sv('rect', { x: b.x - 6, y: b.y - 6, width: b.width + 12, height: b.height + 12, fill: 'none', stroke: '#2563eb', 'stroke-dasharray': '5 4', 'pointer-events': 'none' })); }
        }
      };
      let geste = null;
      svg.addEventListener('pointerdown', (e) => {
        const p = point(svg, e); svg.setPointerCapture(e.pointerId);
        if (E.outil === 'select') {
          const id = e.target.closest?.('[data-id]')?.getAttribute('data-id') ?? null; E.sel = id; dessiner();
          if (id) { garder(); geste = { t: 'deplacer', id, p, bouge: false }; }
          return;
        }
        if (E.outil === 'texte') { const t = window.prompt('Texte'); if (t && t.trim()) { garder(); d.formes.push({ id: `f${Date.now().toString(36)}`, t: 'texte', x: p.x, y: p.y, w: 0, h: 0, texte: t, couleur: E.couleur, ep: 1 }); changer(); } return; }
        garder();
        const f = { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, t: E.outil, x: p.x, y: p.y, w: 0, h: 0, couleur: E.couleur, ep: E.ep, ...(E.outil === 'trait' ? { pts: [0, 0] } : {}) };
        d.formes.push(f); geste = { t: 'creer', f }; dessiner();
      });
      svg.addEventListener('pointermove', (e) => {
        if (!geste) return; const p = point(svg, e);
        if (geste.t === 'deplacer') { const f = d.formes.find((x) => x.id === geste.id); if (!f) return; f.x += p.x - geste.p.x; f.y += p.y - geste.p.y; geste.p = p; geste.bouge = true; dessiner(); return; }
        const f = geste.f; if (f.t === 'trait') f.pts.push(p.x - f.x, p.y - f.y); else { f.w = p.x - f.x; f.h = p.y - f.y; }
        dessiner();
      });
      const fin = () => {
        if (!geste) return;
        if (geste.t === 'creer') { const f = geste.f; if ((f.t === 'trait' && f.pts.length < 6) || (f.t !== 'trait' && Math.abs(f.w) + Math.abs(f.h) < 6)) { d.formes = d.formes.filter((x) => x !== f); E.histo.pop(); dessiner(); } else changer(); }
        else if (geste.bouge) changer(); else E.histo.pop();
        geste = null;
      };
      svg.addEventListener('pointerup', fin); svg.addEventListener('pointercancel', fin);
      svg.tabIndex = 0; svg.addEventListener('keydown', (e) => { if (e.key === 'Delete' || e.key === 'Backspace') supprimer(); if ((e.ctrlKey || e.metaKey) && e.key === 'z') annuler(); });
      hote.replaceChildren(
        el('div', { class: 'pl-bar' }, ...c.barre, nom, el('button', { type: 'button', onclick: effacerTableau }, 'Effacer ce tableau'), etat),
        el('div', { class: 'pl-bar', role: 'toolbar', 'aria-label': 'Outils' }, ...boutons, el('span', { class: 'sep' }),
          el('input', { type: 'color', value: E.couleur, 'aria-label': 'Couleur', oninput: (e) => { E.couleur = e.target.value; } }),
          el('select', { 'aria-label': 'Épaisseur', onchange: (e) => { E.ep = Number(e.target.value); } }, ...[[2, 'Fin'], [3, 'Moyen'], [6, 'Épais']].map(([v, t]) => el('option', { value: v, selected: v === E.ep }, t))),
          el('span', { class: 'sep' }), el('button', { type: 'button', onclick: annuler }, 'Annuler'), el('button', { type: 'button', onclick: supprimer }, 'Supprimer'),
          el('span', { class: 'sep' }), el('button', { type: 'button', onclick: async () => { if (E.sale) await enregistrer(); exporter(d.id, 'svg'); } }, 'SVG'), el('button', { type: 'button', onclick: async () => { if (E.sale) await enregistrer(); exporter(d.id, 'png'); } }, 'PNG')),
        el('div', { class: 'pl-zone' }, svg));
      dessiner();
    };
    await ouvrir();
  }

  // ------------------------------------------------------------------ schéma isométrique
  const CASE = { w: 64, h: 32 };
  const STYLE = {
    serveur: ['#60a5fa', '#2563eb', '#1d4ed8', 46, 'Serveur'], pc: ['#a78bfa', '#7c3aed', '#6d28d9', 26, 'PC'], box: ['#fbbf24', '#d97706', '#b45309', 12, 'Box'],
    nas: ['#34d399', '#059669', '#047857', 34, 'NAS'], camera: ['#f87171', '#dc2626', '#b91c1c', 16, 'Caméra'], nuage: ['#e5e7eb', '#cbd5e1', '#94a3b8', 0, 'Nuage'],
    telephone: ['#f472b6', '#db2777', '#be185d', 10, 'Téléphone'], imprimante: ['#9ca3af', '#6b7280', '#4b5563', 20, 'Imprimante'], switch: ['#22d3ee', '#0891b2', '#0e7490', 8, 'Switch'],
  };
  const ecran = (gx, gy) => [(gx - gy) * (CASE.w / 2), (gx + gy) * (CASE.h / 2)];
  const grille = (x, y) => { const a = x / (CASE.w / 2), b = y / (CASE.h / 2); return [Math.round((a + b) / 2), Math.round((b - a) / 2)]; };
  function bloc(b) {
    const [cx, cy] = ecran(b.gx, b.gy), [dessus, gauche, droite, H] = STYLE[b.genre], w = CASE.w / 2 - 6, h = CASE.h / 2 - 3, g = sv('g', { 'data-id': b.id, style: 'cursor:grab' });
    if (b.genre === 'nuage') { g.append(sv('ellipse', { cx: cx - 14, cy: cy - 8, rx: 18, ry: 11, fill: gauche }), sv('ellipse', { cx: cx + 12, cy: cy - 10, rx: 20, ry: 13, fill: droite }), sv('ellipse', { cx, cy: cy - 18, rx: 18, ry: 12, fill: dessus })); }
    else {
      const p = (pts) => pts.map(([x, y]) => `${x},${y}`).join(' ');
      g.append(sv('polygon', { points: p([[cx - w, cy - H], [cx, cy + h - H], [cx, cy + h], [cx - w, cy]]), fill: gauche }), sv('polygon', { points: p([[cx + w, cy - H], [cx, cy + h - H], [cx, cy + h], [cx + w, cy]]), fill: droite }), sv('polygon', { points: p([[cx, cy - h - H], [cx + w, cy - H], [cx, cy + h - H], [cx - w, cy - H]]), fill: dessus, stroke: '#fff', 'stroke-opacity': 0.5 }));
    }
    const t = sv('text', { x: cx, y: cy + 30, 'font-family': 'sans-serif', 'font-size': 12, 'font-weight': 600, fill: '#0f172a', 'text-anchor': 'middle' }); t.textContent = b.nom; g.append(t);
    if (b.ip) { const i = sv('text', { x: cx, y: cy + 44, 'font-family': 'monospace', 'font-size': 10, fill: '#475569', 'text-anchor': 'middle' }); i.textContent = b.ip; g.append(i); }
    return g;
  }
  async function schema(root) {
    const hote = el('div', { class: 'pl' }); root.append(hote);
    const ouvrir = async () => {
      const c = await choix(hote, 'schema', 'schema', ouvrir);
      const reseau = el('button', { type: 'button', onclick: async () => { const r = await act('schema_reseau'); if (r.ok === false) return window.alert(r.text); S.schema = r.data.id; ouvrir(); } }, 'Schéma de mon réseau');
      let d = S.schema ? (await act('ouvrir_tableau', { id: S.schema })).data : null;
      if (!d) { hote.replaceChildren(el('div', { class: 'pl-bar' }, ...c.barre, reseau), el('p', { class: 'pl-sub' }, 'Aucun schéma : « Nouveau » en crée un vide, « Schéma de mon réseau » part des appareils d\'Atlas.')); return; }
      const E = { mode: 'deplacer', sel: null, lienDe: null, histo: [], minuteur: 0, sale: false };
      const etat = el('span', { class: 'etat', role: 'status' }, 'Enregistré');
      const svg = sv('svg', { viewBox: '-480 -260 960 620', role: 'img', 'aria-label': `Schéma ${d.nom}` });
      const nom = el('input', { type: 'text', value: d.nom, 'aria-label': 'Nom du schéma', onchange: () => { d.nom = nom.value.trim() || d.nom; changer(false); } });
      const enregistrer = async () => { clearTimeout(E.minuteur); etat.textContent = 'Enregistrement…'; const r = await act('enregistrer_tableau', { id: d.id, nom: d.nom, contenu: JSON.stringify({ blocs: d.blocs, liens: d.liens }) }); etat.textContent = r.ok === false ? r.text : 'Enregistré'; E.sale = r.ok === false; };
      const garder = () => { E.histo.push(JSON.stringify({ blocs: d.blocs, liens: d.liens })); if (E.histo.length > 100) E.histo.shift(); };
      const changer = (h = true) => { if (h) dessiner(); E.sale = true; etat.textContent = 'Modifié…'; clearTimeout(E.minuteur); E.minuteur = setTimeout(enregistrer, 1200); };
      const modes = [['deplacer', 'Déplacer'], ['lier', 'Relier'], ...Object.entries(STYLE).map(([k, v]) => [k, `+ ${v[4]}`])];
      const boutons = modes.map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(E.mode === k), 'data-mode': k, onclick: () => { E.mode = k; E.lienDe = null; boutons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === k))); } }, t));
      const annuler = () => { const x = E.histo.pop(); if (x) { Object.assign(d, JSON.parse(x)); E.sel = null; changer(); } };
      const supprimer = () => { if (!E.sel) return; garder(); d.blocs = d.blocs.filter((b) => b.id !== E.sel); d.liens = d.liens.filter((l) => l.de !== E.sel && l.vers !== E.sel); E.sel = null; changer(); };
      const renommer = () => { const b = d.blocs.find((x) => x.id === E.sel); if (!b) return; const n = window.prompt('Nom', b.nom); if (n == null) return; garder(); b.nom = n.trim() || b.nom; const ip = window.prompt('Adresse IP (facultatif)', b.ip ?? ''); if (ip != null) { if (ip.trim()) b.ip = ip.trim(); else delete b.ip; } changer(); };
      const dessiner = () => {
        svg.replaceChildren();
        const occ = d.blocs.map((b) => [b.gx, b.gy]), mx = Math.max(6, ...occ.map(([a, b]) => Math.max(Math.abs(a), Math.abs(b)) + 2));
        const g = sv('g', { 'data-grille': '1' });
        for (let gx = -mx; gx <= mx; gx++) for (let gy = -mx; gy <= mx; gy++) { const [x, y] = ecran(gx, gy); g.append(sv('polygon', { points: `${x},${y - CASE.h / 2} ${x + CASE.w / 2},${y} ${x},${y + CASE.h / 2} ${x - CASE.w / 2},${y}`, fill: (gx + gy) % 2 ? '#f8fafc' : '#f1f5f9', stroke: '#e2e8f0' })); }
        svg.append(g);
        const pos = new Map(d.blocs.map((b) => [b.id, ecran(b.gx, b.gy)]));
        for (const l of d.liens) { const p = pos.get(l.de), q = pos.get(l.vers); if (p && q) svg.append(sv('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], stroke: '#475569', 'stroke-width': 2.5, 'stroke-dasharray': '6 4', 'pointer-events': 'none' })); }
        for (const b of [...d.blocs].sort((a, c2) => a.gx + a.gy - (c2.gx + c2.gy))) {
          const n = bloc(b); svg.append(n);
          if (b.id === E.sel || b.id === E.lienDe) { const [cx, cy] = ecran(b.gx, b.gy); svg.append(sv('ellipse', { cx, cy, rx: CASE.w / 2, ry: CASE.h / 2, fill: 'none', stroke: '#2563eb', 'stroke-width': 2, 'stroke-dasharray': '5 4', 'pointer-events': 'none' })); }
        }
      };
      let geste = null;
      svg.addEventListener('pointerdown', (e) => {
        const p = point(svg, e), id = e.target.closest?.('[data-id]')?.getAttribute('data-id') ?? null;
        if (E.mode === 'lier') {
          if (!id) { E.lienDe = null; dessiner(); return; }
          if (!E.lienDe) { E.lienDe = id; dessiner(); return; }
          if (E.lienDe !== id && !d.liens.some((l) => (l.de === E.lienDe && l.vers === id) || (l.de === id && l.vers === E.lienDe))) { garder(); d.liens.push({ de: E.lienDe, vers: id }); }
          E.lienDe = null; changer(); return;
        }
        if (STYLE[E.mode]) {
          const [gx, gy] = grille(p.x, p.y); if (d.blocs.some((b) => b.gx === gx && b.gy === gy)) return;
          garder(); const b = { id: `b${Date.now().toString(36)}`, genre: E.mode, gx, gy, nom: STYLE[E.mode][4] }; d.blocs.push(b); E.sel = b.id; changer(); return;
        }
        E.sel = id; dessiner();
        if (id) { svg.setPointerCapture(e.pointerId); garder(); const b = d.blocs.find((x) => x.id === id); geste = { id, bouge: false, depart: grille(p.x, p.y), orig: [b.gx, b.gy] }; }
      });
      svg.addEventListener('pointermove', (e) => {
        if (!geste) return; const p = point(svg, e), [ax, ay] = grille(p.x, p.y), gx = geste.orig[0] + ax - geste.depart[0], gy = geste.orig[1] + ay - geste.depart[1], b = d.blocs.find((x) => x.id === geste.id);
        if (b && (b.gx !== gx || b.gy !== gy) && !d.blocs.some((x) => x !== b && x.gx === gx && x.gy === gy)) { b.gx = gx; b.gy = gy; geste.bouge = true; dessiner(); }
      });
      const fin = () => { if (!geste) return; if (geste.bouge) changer(); else E.histo.pop(); geste = null; };
      svg.addEventListener('pointerup', fin); svg.addEventListener('pointercancel', fin);
      svg.addEventListener('dblclick', () => renommer());
      svg.tabIndex = 0; svg.addEventListener('keydown', (e) => { if (e.key === 'Delete' || e.key === 'Backspace') supprimer(); if ((e.ctrlKey || e.metaKey) && e.key === 'z') annuler(); });
      hote.replaceChildren(
        el('div', { class: 'pl-bar' }, ...c.barre, nom, reseau, el('button', { type: 'button', onclick: async () => { const r = await act('supprimer_tableau', { id: d.id }); if (r.ok !== false) { S.schema = null; ouvrir(); } } }, 'Effacer ce schéma'), etat),
        el('div', { class: 'pl-bar', role: 'toolbar', 'aria-label': 'Blocs et outils' }, ...boutons),
        el('div', { class: 'pl-bar' }, el('button', { type: 'button', onclick: renommer }, 'Nommer'), el('button', { type: 'button', onclick: supprimer }, 'Supprimer'), el('button', { type: 'button', onclick: annuler }, 'Annuler'),
          el('span', { class: 'sep' }), el('button', { type: 'button', onclick: async () => { if (E.sale) await enregistrer(); exporter(d.id, 'svg'); } }, 'SVG'), el('button', { type: 'button', onclick: async () => { if (E.sale) await enregistrer(); exporter(d.id, 'png'); } }, 'PNG')),
        el('div', { class: 'pl-zone' }, svg),
        el('p', { class: 'pl-sub' }, 'Choisis un bloc (« + Serveur »…) puis touche une case pour le poser ; « Déplacer » pour le faire glisser ; « Relier » puis deux blocs ; double-clic ou « Nommer » pour son nom et son adresse.'));
      dessiner();
    };
    await ouvrir();
  }

  window.OdinPages.snotra = async ({ host, generic, view }) => {
    style();
    // Les sections génériques, rangées par onglet (dans l'ordre de la vue ; les graphes n'en font pas partie).
    const parOnglet = new Map(); let k = 0;
    for (const s of view.sections) { if (s.kind === 'graph') continue; const n = generic[k++]; if (!n) break; const o = s.onglet || 'Documents'; parOnglet.set(o, [...(parOnglet.get(o) ?? []), n]); }
    const onglets = view.onglets ?? ['Documents', 'Correcteur', 'Tableaux', 'Schémas'];
    const root = el('div', { class: 'pl' }), corps = el('div', { class: 'pl' });
    const montrer = async () => {
      tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.o === S.tab)));
      corps.replaceChildren();
      if (S.tab === 'Correcteur') { correcteur(corps); corps.append(...(parOnglet.get('Correcteur') ?? []).filter((n) => !(n.textContent ?? '').startsWith('Corriger un texte'))); return; }
      if (S.tab === 'Tableaux') { await tableau(corps); corps.append(...(parOnglet.get('Tableaux') ?? [])); return; }
      if (S.tab === 'Schémas') { await schema(corps); corps.append(...(parOnglet.get('Schémas') ?? [])); return; }
      corps.append(...(parOnglet.get('Documents') ?? []));
    };
    const tabs = onglets.map((o) => el('button', { type: 'button', role: 'tab', 'data-o': o, onclick: () => { S.tab = o; montrer(); } }, o));
    if (!onglets.includes(S.tab)) S.tab = onglets[0];
    root.append(el('div', { class: 'pl-tabs', role: 'tablist' }, ...tabs), corps);
    host.replaceChildren(root);
    await montrer();
    return true;
  };
})();
