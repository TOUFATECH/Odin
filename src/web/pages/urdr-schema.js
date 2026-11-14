// Alexandrie · onglet « Schéma » (comme drawDB, code maison) : les tables de la base en boîtes, les liens entre clés,
// rangées toutes seules puis déplacées à la souris (ou au doigt), places gardées. On dessine des changements (table,
// colonne, lien) : ils restent « en attente » (en vert pointillé) jusqu'à « Appliquer », qui montre le SQL et demande
// ton accord (Arche sauvegarde la base juste avant). Exports : SQL PostgreSQL ou MySQL, SVG, PNG, Markdown.
// Appelé par la page d'Alexandrie (src/web/pages/urdr.js) : window.OdinUrdrSchema(racine, base).
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg', LARGEUR = 230, LIGNE = 22, TETE = 34;
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const sv = (t, a = {}, txt) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) if (v != null) n.setAttribute(k, String(v)); if (txt != null) n.textContent = txt; return n; };
  const act = async (action, input = {}, confirm = false) => {
    const r = await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'urdr', action, input, confirm }) });
    const j = await r.json().catch(() => ({ ok: false, text: `Odin répond ${r.status}` }));
    if (j.confirm && !confirm) return window.confirm(j.confirm) ? act(action, input, true) : { ok: false, text: 'Annulé.' };
    return j;
  };
  const CSS = `
.us{display:flex;flex-direction:column;gap:10px;min-width:0}
.us-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.us-bar button,.us-bar select,.us-bar input{min-height:40px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:0 10px;font:inherit;font-size:13px;cursor:pointer}
.us-bar input{cursor:text;min-width:0;flex:1 1 120px;max-width:220px}
.us-bar .etat{font-size:12.5px;color:var(--muted);margin-left:auto}
.us-zone{border:1px solid var(--line);border-radius:12px;background:#f8fafc;overflow:auto;max-height:68vh;touch-action:pan-x pan-y}
.us-zone svg{display:block}
.us-zone .tete{cursor:grab;touch-action:none}
.us-form{display:flex;flex-direction:column;gap:8px;border:1px solid var(--line);border-radius:12px;padding:10px;background:var(--panel)}
.us-form textarea{min-height:90px;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:8px;font:12.5px ui-monospace,Menlo,monospace}
.us-sql{white-space:pre-wrap;font:12.5px ui-monospace,Menlo,monospace;border:1px solid var(--line);border-radius:12px;padding:10px;background:var(--panel);overflow-wrap:anywhere;margin:0}
.us-sub{font-size:13px;color:var(--muted);margin:0}
`;
  const ETAT = {};
  window.OdinUrdrSchema = async (root, base) => {
    if (!document.getElementById('usCss')) document.head.append(el('style', { id: 'usCss' }, CSS));
    const E = (ETAT[base] ??= { attente: [] });
    const r = await act('schema_base', { base });
    if (r.ok === false) { root.append(el('p', { class: 'sub' }, r.text)); return; }
    const sc = r.data.schema, pos = r.data.positions;
    const etat = el('span', { class: 'etat', role: 'status' }, E.attente.length ? `${E.attente.length} changement(s) en attente` : '');
    const zone = el('div', { class: 'us-zone' }), panneau = el('div'), sortie = el('div');
    // Le schéma tel qu'il serait après les changements en attente (pour le dessin).
    const avecAttente = () => {
      const t = sc.tables.map((x) => ({ ...x, colonnes: x.colonnes.map((c) => ({ ...c })) })), liens = sc.liens.map((l) => ({ ...l }));
      for (const c of E.attente) {
        if (c.op === 'table') t.push({ nom: c.nom, lignes: 0, index: [], nouvelle: true, colonnes: c.colonnes.map((k) => ({ nom: k.nom, type: k.type, nul: k.nul !== false, pk: Boolean(k.pk), nouvelle: true })) });
        else if (c.op === 'colonne') t.find((x) => x.nom === c.table)?.colonnes.push({ ...c.colonne, nul: c.colonne.nul !== false, pk: false, nouvelle: true });
        else liens.push({ de: c.table, colonne: c.colonne, vers: c.vers, versColonne: c.versColonne, nouveau: true });
      }
      return { tables: t, liens };
    };
    const ranger = (s) => { // place les tables nouvelles (sans position) à droite du dessin
      let x = Math.max(20, ...Object.values(pos).map((p) => p.x + LARGEUR + 90)), y = 20;
      for (const t of s.tables) if (!pos[t.nom]) { pos[t.nom] = { x, y }; y += TETE + t.colonnes.length * LIGNE + 48; }
    };
    let garde = 0;
    const garder = () => { clearTimeout(garde); garde = setTimeout(async () => { const x = await act('placer_tables', { base, positions: JSON.stringify(pos) }); etat.textContent = x.ok === false ? x.text : 'Place des tables gardée'; }, 600); };
    const dessiner = () => {
      const s = avecAttente(); ranger(s);
      const W = Math.max(600, ...s.tables.map((t) => pos[t.nom].x + LARGEUR + 40)), H = Math.max(300, ...s.tables.map((t) => pos[t.nom].y + TETE + t.colonnes.length * LIGNE + 40));
      const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Schéma de la base (${s.tables.length} tables)` });
      svg.append(sv('defs')); svg.firstChild.innerHTML = '<marker id="us-fl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#64748b"/></marker>';
      const par = new Map(s.tables.map((t) => [t.nom, t])), y = (t, c) => pos[t.nom].y + TETE + Math.max(0, t.colonnes.findIndex((k) => k.nom === c)) * LIGNE + LIGNE / 2;
      for (const l of s.liens) {
        const a = par.get(l.de), b = par.get(l.vers); if (!a || !b) continue;
        const droite = pos[b.nom].x >= pos[a.nom].x, x1 = pos[a.nom].x + (droite ? LARGEUR : 0), x2 = pos[b.nom].x + (droite ? 0 : LARGEUR), y1 = y(a, l.colonne), y2 = y(b, l.versColonne), m = (x1 + x2) / 2;
        svg.append(sv('path', { d: `M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}`, fill: 'none', stroke: l.nouveau ? '#16a34a' : '#64748b', 'stroke-width': 1.6, 'stroke-dasharray': l.nouveau ? '6 4' : null, 'marker-end': 'url(#us-fl)' }));
      }
      for (const t of s.tables) {
        const { x, y: y0 } = pos[t.nom], h = TETE + Math.max(1, t.colonnes.length) * LIGNE + 8, g = sv('g', { 'data-table': t.nom });
        g.append(sv('rect', { x, y: y0, width: LARGEUR, height: h, rx: 8, fill: '#fff', stroke: t.nouvelle ? '#16a34a' : '#cbd5e1', 'stroke-dasharray': t.nouvelle ? '6 4' : null }));
        const tete = sv('g', { class: 'tete' }); tete.append(sv('rect', { x, y: y0, width: LARGEUR, height: TETE - 4, rx: 8, fill: t.nouvelle ? '#16a34a' : '#0f766e' }), sv('text', { x: x + 10, y: y0 + 20, 'font-family': 'sans-serif', 'font-size': 13, 'font-weight': 700, fill: '#fff' }, t.nom));
        g.append(tete);
        t.colonnes.forEach((c, i) => {
          g.append(sv('text', { x: x + 10, y: y0 + TETE + i * LIGNE + 15, 'font-family': 'ui-monospace,monospace', 'font-size': 11.5, fill: c.nouvelle ? '#16a34a' : '#0f172a' }, `${c.pk ? '🔑 ' : c.ref ? '↗ ' : ''}${c.nom}`));
          g.append(sv('text', { x: x + LARGEUR - 10, y: y0 + TETE + i * LIGNE + 15, 'font-family': 'ui-monospace,monospace', 'font-size': 10.5, fill: '#64748b', 'text-anchor': 'end' }, `${String(c.type).slice(0, 22)}${c.nul ? '' : ' *'}`));
        });
        // Déplacer une table : on la prend par son titre.
        tete.addEventListener('pointerdown', (e) => {
          e.preventDefault(); tete.setPointerCapture(e.pointerId); const d0 = { x: e.clientX, y: e.clientY, px: pos[t.nom].x, py: pos[t.nom].y };
          const bouge = (ev) => { pos[t.nom] = { x: Math.max(0, Math.round(d0.px + ev.clientX - d0.x)), y: Math.max(0, Math.round(d0.py + ev.clientY - d0.y)) }; g.setAttribute('transform', `translate(${pos[t.nom].x - x} ${pos[t.nom].y - y0})`); };
          const fin = () => { tete.removeEventListener('pointermove', bouge); tete.removeEventListener('pointerup', fin); tete.removeEventListener('pointercancel', fin); dessiner(); garder(); };
          tete.addEventListener('pointermove', bouge); tete.addEventListener('pointerup', fin); tete.addEventListener('pointercancel', fin);
        });
        svg.append(g);
      }
      const sx = zone.scrollLeft, sy = zone.scrollTop; zone.replaceChildren(svg); zone.scrollLeft = sx; zone.scrollTop = sy;
      etat.textContent = E.attente.length ? `${E.attente.length} changement(s) en attente` : etat.textContent;
    };
    const tablesConnues = () => avecAttente().tables;
    const formulaire = (titre, champs, ok) => {
      panneau.replaceChildren(el('div', { class: 'us-form' }, el('b', {}, titre), ...champs, el('div', { class: 'us-bar' }, el('button', { type: 'button', onclick: async () => { const m = await ok(); if (m) { sortie.replaceChildren(el('p', { class: 'us-sub', role: 'alert' }, m)); return; } panneau.replaceChildren(); sortie.replaceChildren(); dessiner(); } }, 'Ajouter au dessin'), el('button', { type: 'button', onclick: () => panneau.replaceChildren() }, 'Fermer'))));
    };
    const lireColonnes = (txt) => txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = /^(\w+)\s+(.+?)(\s+cl[ée])?(\s+non vide)?$/i.exec(l); if (!m) throw new Error(`ligne illisible : « ${l} » (attendu : nom type [clé] [non vide])`); return { nom: m[1], type: m[2].trim(), ...(m[3] ? { pk: true } : {}), ...(m[4] ? { nul: false } : {}) }; });
    const verifier = async () => { const x = await act('sql_schema', { base, changements: JSON.stringify(E.attente) }); return x; };
    const ajouterTable = () => {
      const nom = el('input', { type: 'text', placeholder: 'nom_de_la_table', 'aria-label': 'Nom de la table' }), cols = el('textarea', { 'aria-label': 'Colonnes' }); cols.value = 'id serial clé\nnom text non vide';
      formulaire('Nouvelle table (une colonne par ligne : nom type [clé] [non vide])', [el('div', { class: 'us-bar' }, nom), cols], async () => {
        try { E.attente.push({ op: 'table', nom: nom.value.trim(), colonnes: lireColonnes(cols.value) }); } catch (e) { return e.message; }
        const x = await verifier(); if (x.ok === false) { E.attente.pop(); return x.text; } return '';
      });
    };
    const ajouterColonne = () => {
      const t = el('select', { 'aria-label': 'Table' }, ...tablesConnues().map((x) => el('option', { value: x.nom }, x.nom))), nom = el('input', { type: 'text', placeholder: 'nom', 'aria-label': 'Nom de la colonne' }), type = el('input', { type: 'text', value: 'text', 'aria-label': 'Type' });
      formulaire('Nouvelle colonne', [el('div', { class: 'us-bar' }, t, nom, type)], async () => { E.attente.push({ op: 'colonne', table: t.value, colonne: { nom: nom.value.trim(), type: type.value.trim() } }); const x = await verifier(); if (x.ok === false) { E.attente.pop(); return x.text; } return ''; });
    };
    const ajouterLien = () => {
      const ts = tablesConnues(), opts = ts.flatMap((x) => x.colonnes.map((c) => el('option', { value: `${x.nom}§${c.nom}` }, `${x.nom}.${c.nom}`)));
      const de = el('select', { 'aria-label': 'Depuis la colonne' }, ...opts), vers = el('select', { 'aria-label': 'Vers la colonne' }, ...opts.map((o) => o.cloneNode(true)));
      formulaire('Nouveau lien (clé étrangère)', [el('div', { class: 'us-bar' }, de, el('span', {}, '→'), vers)], async () => { const [t, c] = de.value.split('§'), [v, vc] = vers.value.split('§'); E.attente.push({ op: 'lien', table: t, colonne: c, vers: v, versColonne: vc }); const x = await verifier(); if (x.ok === false) { E.attente.pop(); return x.text; } return ''; });
    };
    const voirSql = async () => { if (!E.attente.length) return sortie.replaceChildren(el('p', { class: 'us-sub' }, 'Aucun changement en attente.')); const x = await verifier(); sortie.replaceChildren(el('pre', { class: 'us-sql' }, x.text)); };
    const appliquer = async () => {
      if (!E.attente.length) return;
      const x = await act('appliquer_schema', { base, changements: JSON.stringify(E.attente) });
      sortie.replaceChildren(el('pre', { class: 'us-sql' }, x.text));
      if (x.ok !== false) { E.attente = []; const n = await act('schema_base', { base }); if (n.ok !== false) { sc.tables = n.data.schema.tables; sc.liens = n.data.schema.liens; } dessiner(); }
    };
    const exporter = async (format) => { const x = await act('exporter_schema', { base, format }); if (!x.fichiers?.[0]) return sortie.replaceChildren(el('p', { class: 'us-sub' }, x.text)); const a = el('a', { href: `/api/valhalla/fichier?module=urdr&ref=${encodeURIComponent(x.fichiers[0].ref)}`, download: x.fichiers[0].nom }); document.body.append(a); a.click(); a.remove(); };
    const exp = el('select', { 'aria-label': 'Exporter', onchange: (e) => { if (e.target.value) exporter(e.target.value); e.target.value = ''; } }, el('option', { value: '' }, 'Exporter…'), el('option', { value: 'sql-postgres' }, 'SQL PostgreSQL'), el('option', { value: 'sql-mysql' }, 'SQL MySQL'), el('option', { value: 'svg' }, 'Image SVG'), el('option', { value: 'png' }, 'Image PNG'), el('option', { value: 'markdown' }, 'Dictionnaire (Markdown)'));
    root.append(el('div', { class: 'us' },
      el('div', { class: 'us-bar' }, el('button', { type: 'button', onclick: ajouterTable }, '+ Table'), el('button', { type: 'button', onclick: ajouterColonne }, '+ Colonne'), el('button', { type: 'button', onclick: ajouterLien }, '+ Lien'),
        el('button', { type: 'button', onclick: voirSql }, 'Voir le SQL'), el('button', { type: 'button', onclick: appliquer }, 'Appliquer'), el('button', { type: 'button', onclick: () => { E.attente = []; sortie.replaceChildren(); dessiner(); } }, 'Annuler les changements'),
        el('button', { type: 'button', onclick: async () => { await act('placer_tables', { base, positions: '{}' }); for (const k of Object.keys(pos)) delete pos[k]; const n = await act('schema_base', { base }); Object.assign(pos, n.data?.positions ?? {}); dessiner(); } }, 'Ranger tout seul'), exp, etat),
      panneau, zone, sortie,
      el('p', { class: 'us-sub' }, 'Fais glisser une table par son titre. Les changements restent en attente (en vert) : rien n\'est écrit dans la base avant « Appliquer » et ton accord.')));
    dessiner();
  };
})();
