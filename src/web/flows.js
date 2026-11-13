// Espace « Automatisations » : Talos, le moteur d'automatisations d'Odin. Liste, création en une
// phrase, modèles (dont ceux qui relient les applis), éditeur à nœuds (glisser, relier, régler),
// test pas à pas, historique des exécutions et versions.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const sv = (t, a = {}) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };
  // Session expirée pendant l'usage : on revient à la page de connexion. Sur la page de connexion elle-même,
  // on ne recharge rien (sinon elle se rechargerait en boucle et effacerait ce que tu tapes).
  const appShown = () => { const a = document.querySelector('#app'); return Boolean(a && !a.hidden); };
  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
    if (r.status === 401) { if (appShown()) location.reload(); throw new Error('session expirée'); }
    return r.json();
  }
  const css = `
.dr-top{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}.dr-top input{flex:1 1 280px;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--field);background:var(--panel)}
.dr-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin:0 0 20px}
.dr-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.dr-card .dr-h{display:flex;gap:10px;align-items:center;justify-content:space-between}.dr-card b{font-size:16px}
.dr-steps{font-size:13px;color:var(--muted);overflow-wrap:anywhere}.dr-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dr-tpl{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.dr-tpl article{border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--panel2);display:flex;flex-direction:column;gap:6px}.dr-tpl p{margin:0;font-size:14px;color:var(--muted)}
.dr-ed{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:12px;align-items:start}@media (max-width:980px){.dr-ed{grid-template-columns:1fr}}
.dr-canvas{position:relative;height:min(64vh,620px);border:1px solid var(--line);border-radius:14px;background:var(--panel2) radial-gradient(circle,var(--line) 1px,transparent 1px) 0 0/22px 22px;overflow:hidden;touch-action:none}
.dr-canvas svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.dr-world{position:absolute;left:0;top:0;transform-origin:0 0}
.dr-node{position:absolute;width:190px;background:var(--panel);border:1.5px solid var(--line);border-radius:12px;padding:8px 10px 10px;cursor:grab;user-select:none;box-shadow:var(--shadow)}
.dr-node.sel{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent)}
.dr-node.trig{border-left:5px solid var(--accent)}.dr-node.off{opacity:.5}
.dr-node.ok{border-color:var(--good)}.dr-node.err{border-color:var(--bad)}
.dr-node small{display:block;font-size:11.5px;color:var(--dim)}.dr-node b{display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dr-node .dr-cnt{font-size:11.5px;color:var(--good)}.dr-node.err .dr-cnt{color:var(--bad)}
.dr-port{position:absolute;width:18px;height:18px;border-radius:50%;border:2px solid var(--accent);background:var(--panel);padding:0;cursor:crosshair}
.dr-port.in{left:-10px;top:24px}.dr-port.out{right:-10px}.dr-port.armed{background:var(--accent)}
.dr-port .dr-pl{position:absolute;left:20px;top:-2px;font-size:10.5px;color:var(--dim);white-space:nowrap;pointer-events:none}
.dr-link{fill:none;stroke:var(--accent);stroke-width:2.2;opacity:.8;pointer-events:stroke;cursor:pointer}
.dr-side{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;max-height:min(64vh,620px);overflow:auto}
.dr-side h2{font-size:16px;margin:0}.dr-side label{font-size:13.5px;font-weight:600;display:block;margin:6px 0 4px}
.dr-side input:not([type=checkbox]),.dr-side textarea,.dr-side select{width:100%;min-height:38px;padding:7px 10px;border-radius:10px;border:1px solid var(--field);background:var(--panel2)}.dr-side textarea{min-height:80px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}
.dr-cat{display:flex;flex-direction:column;gap:4px}.dr-cat h3{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim);margin:8px 0 2px}
.dr-cat button{text-align:left;border:1px solid var(--line);background:var(--panel2);border-radius:10px;padding:7px 10px;font-size:13.5px;min-height:36px}.dr-cat button:hover{border-color:var(--accent)}
.dr-out{white-space:pre-wrap;font-size:12.5px;background:var(--panel2);border-radius:10px;padding:8px;max-height:240px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace}
.dr-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 10px}.dr-bar input.dr-name{flex:1 1 220px;min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--field);background:var(--panel);font-weight:600}
.dr-runs{font-size:13.5px}.dr-runs li{padding:4px 0}
`;
  let st = null, wf = null, outs = {}, sel = null, armed = null, last = null, view = { x: 40, y: 40, k: 1 }, dirty = false;
  const cat = (t) => st?.catalog.find((c) => c.type === t);
  const NODE_W = 190;

  async function openList() {
    wf = null;
    const box = $('#v-flows .body'); if (!box) return;
    $('#v-flows .head h1').textContent = 'Automatisations';
    $('#v-flows .head .sub').textContent = 'Talos, le moteur d\'Odin : décris ce que tu veux automatiser, ou pars d\'un modèle. Tout est relié à Thot, Papyrus et tes applis.';
    st = await api('/api/draupnir/state');
    box.replaceChildren();
    if (!st.ok) { box.append(el('p', { class: 'sub' }, st.error)); return; }
    const msg = el('p', { class: 'sub', role: 'status' });
    box.append(el('form', { class: 'dr-top', onsubmit: async (e) => { e.preventDefault(); const d = $('#drAsk').value.trim(); if (!d) return; msg.textContent = 'Odin écrit l\'automatisation…'; const r = await api('/api/draupnir/create', { description: d }); if (r.ok) openFlow(r.flow.id); else msg.textContent = `✗ ${r.error}`; } },
      el('label', { for: 'drAsk', class: 'sr' }, 'Décris ton automatisation'), el('input', { id: 'drAsk', placeholder: 'Ex. chaque matin à 7 h, envoie-moi les tâches en retard', autocomplete: 'off' }), el('button', { class: 'btn primary', type: 'submit' }, 'Créer avec Odin'), el('button', { class: 'btn', type: 'button', onclick: newFlow }, 'Partir de zéro')), msg);
    if (st.flows.length) box.append(el('div', { class: 'dr-list' }, ...st.flows.map((w) => el('article', { class: 'dr-card' },
      el('div', { class: 'dr-h' }, el('b', {}, w.name), el('input', { type: 'checkbox', class: 'g-sw', 'aria-label': `Activer ${w.name}`, checked: w.active ? true : undefined, onchange: async (e) => { if (e.target.checked && !confirm(`Activer « ${w.name} » ? Elle agira seule ensuite.`)) { e.target.checked = false; return; } const r = await api('/api/draupnir/toggle', { id: w.id, on: e.target.checked }); if (!r.ok) { e.target.checked = !e.target.checked; alert(r.error); } } })),
      el('div', { class: 'dr-steps' }, w.nodes.map((n) => n.label).join(' → ')),
      el('div', { class: 'dr-row' }, w.last ? el('span', { class: `pill ${w.last.status === 'succès' ? 'good' : w.last.status === 'erreur' ? 'bad' : ''}` }, `${w.last.status} · ${new Date(w.last.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`) : el('span', { class: 'pill' }, 'jamais lancée'), w.failed ? el('span', { class: 'pill bad' }, `${w.failed} échec(s)`) : null),
      el('div', { class: 'dr-row' }, el('button', { class: 'btn small primary', type: 'button', onclick: () => openFlow(w.id) }, 'Ouvrir'), el('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; const r = await api('/api/draupnir/run', { id: w.id }); e.target.disabled = false; alert(r.ok ? `${r.run.status}${r.run.error ? ` : ${r.run.error}` : ''}` : r.error); openList(); } }, 'Tester')))))); else box.append(el('p', { class: 'sub' }, 'Aucune automatisation pour l\'instant.'));
    box.append(el('section', { class: 'card', style: 'margin-bottom:16px' }, el('h2', { style: 'font-size:17px;margin:0 0 8px' }, 'Modèles prêts'), el('div', { class: 'dr-tpl' }, ...st.templates.map((t) => el('article', {}, el('b', {}, t.name), el('p', {}, t.what), el('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; const r = await api('/api/draupnir/template', { id: t.id }); if (r.ok) openFlow(r.flow.id); else { e.target.textContent = `✗ ${r.error}`; } } }, 'Utiliser'))))));
    box.append(el('details', { class: 'card' }, el('summary', { style: 'cursor:pointer;min-height:40px;display:flex;align-items:center;font-weight:600' }, 'Importer une automatisation n8n (JSON)'),
      el('form', { onsubmit: async (e) => { e.preventDefault(); const r = await api('/api/draupnir/import', { json: $('#drImp').value }); if (r.ok) { if (r.todo?.length) alert(`À revoir :\n${r.todo.join('\n')}`); openFlow(r.flow.id); } else alert(r.error); } }, el('label', { for: 'drImp', class: 'sub' }, 'Colle le JSON exporté'), el('textarea', { id: 'drImp', style: 'width:100%;min-height:120px' }), el('button', { class: 'btn', type: 'submit' }, 'Importer'))));
  }
  function newFlow() { wf = { id: '', name: 'Nouvelle automatisation', active: false, nodes: [{ name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] }], connections: {} }; outs = {}; dirty = true; editor(); }
  async function openFlow(id) {
    const r = await api(`/api/draupnir/flow?id=${encodeURIComponent(id)}`); if (!r.ok) { alert(r.error); return; }
    if (!st) st = await api('/api/draupnir/state');
    wf = r.flow; outs = r.outputs; last = r.runs[0] ?? null; sel = null; dirty = false; editor(r);
  }
  const outputsOf = (n) => outs[n.name] ?? cat(n.type)?.outputs ?? ['sortie'];
  function editor(r) {
    const box = $('#v-flows .body');
    $('#v-flows .head h1').textContent = wf.name; $('#v-flows .head .sub').textContent = 'Glisse les étapes, relie une sortie (rond à droite) à une entrée (rond à gauche), clique une étape pour la régler.';
    const canvas = el('div', { class: 'dr-canvas', id: 'drCanvas', role: 'application', 'aria-label': 'Schéma de l\'automatisation' });
    const svg = sv('svg'); const world = el('div', { class: 'dr-world' }); canvas.append(svg, world);
    const side = el('aside', { class: 'dr-side', id: 'drSide', 'aria-label': 'Réglages' });
    const status = el('span', { class: 'sub', role: 'status', id: 'drSt' });
    box.replaceChildren(
      el('div', { class: 'dr-bar' }, el('button', { class: 'btn small', type: 'button', onclick: () => { if (!dirty || confirm('Quitter sans enregistrer ?')) openList(); } }, '← Automatisations'), el('label', { for: 'drName', class: 'sr' }, 'Nom'), el('input', { id: 'drName', class: 'dr-name', value: wf.name, oninput: (e) => { wf.name = e.target.value; dirty = true; } }),
        el('button', { class: 'btn small primary', type: 'button', onclick: save }, 'Enregistrer'), el('button', { class: 'btn small', type: 'button', onclick: () => test() }, 'Tester'), el('button', { class: 'btn small', type: 'button', onclick: () => { sel = null; drawSide(); } }, '+ Étape'),
        wf.id ? el('button', { class: 'btn small', type: 'button', onclick: async () => { if (!confirm('Mettre cette automatisation à la corbeille ?')) return; await api('/api/draupnir/trash', { id: wf.id }); openList(); } }, 'Corbeille') : null, status),
      el('div', { class: 'dr-ed' }, canvas, side),
      r ? el('section', { class: 'card', style: 'margin-top:12px' }, el('h2', { style: 'font-size:16px;margin:0' }, 'Dernières exécutions'), r.runs.length ? el('ul', { class: 'dr-runs' }, ...r.runs.slice(0, 10).map((x) => el('li', {}, el('span', { class: `pill ${x.status === 'succès' ? 'good' : x.status === 'erreur' ? 'bad' : ''}` }, x.status), ` ${new Date(x.startedAt).toLocaleString('fr-FR')} · ${x.mode} · ${x.ms} ms${x.error ? ` · ${x.error}` : ''}`))) : el('p', { class: 'sub' }, 'Jamais lancée.'),
        r.versions?.length ? el('details', {}, el('summary', { style: 'cursor:pointer;min-height:36px;display:flex;align-items:center' }, `Versions (${r.versions.length})`), el('ul', { class: 'dr-runs' }, ...r.versions.slice(0, 15).map((v) => el('li', {}, `${new Date(v.at).toLocaleString('fr-FR')} · ${v.nodes} étapes `, el('button', { class: 'btn small', type: 'button', onclick: async () => { if (!confirm('Revenir à cette version ?')) return; const x = await api('/api/draupnir/restore', { id: wf.id, at: v.at }); if (x.ok) openFlow(wf.id); } }, 'Restaurer'))))) : null) : null);
    pan(canvas, world); draw(); drawSide();
  }
  function nodeEl(n) {
    const c = cat(n.type), run = last?.nodes?.[n.name];
    const d = el('div', { class: `dr-node${c?.trigger ? ' trig' : ''}${n.disabled ? ' off' : ''}${sel === n.name ? ' sel' : ''}${run ? (run.error ? ' err' : ' ok') : ''}`, tabindex: '0', role: 'button', 'aria-label': `${n.name} (${c?.label ?? n.type})`, style: `left:${n.position?.[0] ?? 0}px;top:${n.position?.[1] ?? 0}px` },
      el('small', {}, c?.group ?? '?', ' · ', c?.label ?? n.type), el('b', {}, n.name), run ? el('span', { class: 'dr-cnt' }, run.error ? `✗ ${run.error.slice(0, 40)}` : `${run.count} élément(s)`) : null);
    if (!c?.trigger) d.append(el('button', { class: 'dr-port in', type: 'button', 'aria-label': `Entrée de ${n.name}`, onclick: (e) => { e.stopPropagation(); if (armed) { link(armed.node, armed.out, n.name); armed = null; draw(); } } }));
    outputsOf(n).forEach((o, i, all) => d.append(el('button', { class: `dr-port out${armed && armed.node === n.name && armed.out === i ? ' armed' : ''}`, type: 'button', style: `top:${18 + i * 22}px`, 'aria-label': `Sortie ${o} de ${n.name}`, onclick: (e) => { e.stopPropagation(); armed = armed && armed.node === n.name && armed.out === i ? null : { node: n.name, out: i }; draw(); } }, all.length > 1 ? el('span', { class: 'dr-pl' }, o) : null)));
    let start = null;
    d.addEventListener('pointerdown', (e) => { if (e.target.closest('.dr-port')) return; e.stopPropagation(); d.setPointerCapture(e.pointerId); start = { x: e.clientX, y: e.clientY, p: [...(n.position ?? [0, 0])], moved: false }; });
    d.addEventListener('pointermove', (e) => { if (!start) return; const dx = (e.clientX - start.x) / view.k, dy = (e.clientY - start.y) / view.k; if (Math.abs(dx) + Math.abs(dy) > 3) start.moved = true; n.position = [Math.round(start.p[0] + dx), Math.round(start.p[1] + dy)]; d.style.left = `${n.position[0]}px`; d.style.top = `${n.position[1]}px`; lines(); });
    d.addEventListener('pointerup', () => { if (start?.moved) dirty = true; else { sel = n.name; draw(); drawSide(); } start = null; });
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sel = n.name; draw(); drawSide(); } if (e.key === 'Delete') removeNode(n.name); });
    return d;
  }
  function link(from, out, to) {
    if (from === to) return;
    const c = wf.connections[from] ?? (wf.connections[from] = []);
    while (c.length <= out) c.push([]);
    if (!c[out].some((l) => l.node === to)) c[out].push({ node: to }); dirty = true;
  }
  function draw() {
    const world = $('#drCanvas .dr-world'); if (!world) return;
    world.replaceChildren(...wf.nodes.map(nodeEl)); lines();
  }
  function lines() {
    const svg = $('#drCanvas svg'); if (!svg) return; svg.replaceChildren();
    const g = sv('g', { transform: `translate(${view.x} ${view.y}) scale(${view.k})` }); svg.append(g);
    for (const [from, list] of Object.entries(wf.connections)) {
      const a = wf.nodes.find((n) => n.name === from); if (!a) continue;
      list.forEach((targets, i) => (targets ?? []).forEach((l) => {
        const b = wf.nodes.find((n) => n.name === l.node); if (!b) return;
        const x1 = a.position[0] + NODE_W + 10, y1 = a.position[1] + 27 + i * 22, x2 = b.position[0] - 10, y2 = b.position[1] + 33, dx = Math.max(40, Math.abs(x2 - x1) / 2);
        const p = sv('path', { class: 'dr-link', d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` });
        p.addEventListener('click', () => { if (confirm(`Retirer le lien ${from} → ${l.node} ?`)) { targets.splice(targets.indexOf(l), 1); dirty = true; draw(); } });
        g.append(p);
      }));
    }
  }
  function pan(canvas, world) {
    const apply = () => { world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`; lines(); };
    let s = null;
    // Cadrage : tout le schéma visible à l'ouverture.
    requestAnimationFrame(() => {
      const r = canvas.getBoundingClientRect(); if (!wf.nodes.length || !r.width) return;
      const xs = wf.nodes.map((n) => n.position[0]), ys = wf.nodes.map((n) => n.position[1]);
      const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + NODE_W + 30, y0 = Math.min(...ys) - 30, y1 = Math.max(...ys) + 90;
      view.k = Math.min(1.1, Math.max(0.4, Math.min(r.width / (x1 - x0), r.height / (y1 - y0))));
      view.x = (r.width - (x1 - x0) * view.k) / 2 - x0 * view.k; view.y = (r.height - (y1 - y0) * view.k) / 2 - y0 * view.k; apply();
    });
    canvas.addEventListener('pointerdown', (e) => { if (e.target !== canvas && !e.target.closest('svg')) return; s = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; canvas.setPointerCapture(e.pointerId); if (armed) { armed = null; draw(); } });
    canvas.addEventListener('pointermove', (e) => { if (!s) return; view.x = s.vx + e.clientX - s.x; view.y = s.vy + e.clientY - s.y; apply(); });
    canvas.addEventListener('pointerup', () => { s = null; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); const k = Math.min(1.6, Math.max(0.4, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; view.x = mx - (mx - view.x) * (k / view.k); view.y = my - (my - view.y) * (k / view.k); view.k = k; apply(); }, { passive: false });
    apply();
  }
  function removeNode(name) {
    if (!confirm(`Retirer l'étape « ${name} » ?`)) return;
    wf.nodes = wf.nodes.filter((n) => n.name !== name); delete wf.connections[name];
    for (const list of Object.values(wf.connections)) for (const t of list) for (let i = t.length - 1; i >= 0; i--) if (t[i].node === name) t.splice(i, 1);
    sel = null; dirty = true; draw(); drawSide();
  }
  function drawSide() {
    const side = $('#drSide'); if (!side) return;
    const n = wf.nodes.find((x) => x.name === sel);
    if (!n) {
      const groups = [...new Set(st.catalog.map((c) => c.group))];
      side.replaceChildren(el('h2', {}, 'Ajouter une étape'), el('p', { class: 'sub', style: 'margin:0' }, 'Clique une étape pour l\'ajouter, puis relie-la.'), el('div', { class: 'dr-cat' }, ...groups.flatMap((g) => [el('h3', {}, g), ...st.catalog.filter((c) => c.group === g).map((c) => el('button', { type: 'button', title: c.what, onclick: () => addNode(c) }, c.label))])));
      return;
    }
    const c = cat(n.type), run = last?.nodes?.[n.name];
    const fields = (c?.params ?? []).map((p) => {
      const id = `drp-${p.key}`, v = n.params[p.key] ?? p.default ?? '';
      const set = (val) => { n.params[p.key] = val; dirty = true; };
      const input = p.kind === 'select' ? el('select', { id, onchange: (e) => set(e.target.value) }, ...(p.options ?? []).map((o) => el('option', { selected: o === v ? true : undefined }, o)))
        : p.kind === 'boolean' ? el('input', { id, type: 'checkbox', checked: v === true ? true : undefined, onchange: (e) => set(e.target.checked) })
        : p.kind === 'textarea' || p.kind === 'json' ? el('textarea', { id, oninput: (e) => set(e.target.value), spellcheck: 'false' }, typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v))
        : el('input', { id, type: p.kind === 'number' ? 'number' : 'text', value: String(v), oninput: (e) => set(p.kind === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value), spellcheck: 'false', autocomplete: 'off' });
      return [el('label', { for: id }, p.label, p.required ? ' *' : ''), input, p.help ? el('small', { class: 'sub' }, p.help) : null];
    });
    side.replaceChildren(el('h2', {}, c?.label ?? n.type), el('p', { class: 'sub', style: 'margin:0' }, c?.what ?? ''),
      el('label', { for: 'drNn' }, 'Nom de l\'étape'), el('input', { id: 'drNn', value: n.name, onchange: (e) => rename(n, e.target.value.trim()) }),
      ...fields.flat(),
      el('label', { class: 'va-chk', style: 'display:flex;gap:8px;align-items:center;font-weight:500' }, el('input', { type: 'checkbox', checked: n.disabled ? true : undefined, onchange: (e) => { n.disabled = e.target.checked || undefined; dirty = true; draw(); } }), 'Désactiver cette étape'),
      el('p', { class: 'sub', style: 'margin:0;font-size:13px' }, 'Expressions : {{ $json.champ }}, {{ $node["Étape"].json.champ }}, {{ $now }}.'),
      el('div', { class: 'dr-row' }, el('button', { class: 'btn small', type: 'button', onclick: () => test(n.name) }, 'Tester jusqu\'ici'), el('button', { class: 'btn small', type: 'button', onclick: () => removeNode(n.name) }, 'Retirer'), el('button', { class: 'btn small', type: 'button', onclick: () => { sel = null; draw(); drawSide(); } }, 'Fermer')),
      run ? [el('h2', { style: 'margin-top:6px' }, 'Dernier passage'), el('pre', { class: 'dr-out' }, run.error ? `✗ ${run.error}` : JSON.stringify(run.items.slice(0, 5), null, 2))] : null);
  }
  function rename(n, to) {
    if (!to || to === n.name) return; if (wf.nodes.some((x) => x.name === to)) { alert('Ce nom est déjà pris.'); return; }
    const from = n.name; n.name = to;
    if (wf.connections[from]) { wf.connections[to] = wf.connections[from]; delete wf.connections[from]; }
    for (const list of Object.values(wf.connections)) for (const t of list) for (const l of t) if (l.node === from) l.node = to;
    if (outs[from]) { outs[to] = outs[from]; delete outs[from]; }
    sel = to; dirty = true; draw();
  }
  function addNode(c) {
    let name = c.label, k = 2; while (wf.nodes.some((n) => n.name === name)) name = `${c.label} ${k++}`;
    const lastN = wf.nodes[wf.nodes.length - 1], params = Object.fromEntries(c.params.filter((p) => p.default !== undefined).map((p) => [p.key, p.default]));
    const n = { name, type: c.type, params, position: lastN ? [lastN.position[0] + 240, lastN.position[1]] : [60, 160] };
    wf.nodes.push(n); if (lastN && !c.trigger && !(wf.connections[lastN.name] ?? []).some((t) => t.length)) link(lastN.name, 0, name);
    sel = name; dirty = true; draw(); drawSide();
  }
  async function save() {
    for (const n of wf.nodes) for (const p of cat(n.type)?.params ?? []) if (p.kind === 'json' && typeof n.params[p.key] === 'string' && n.params[p.key].trim()) { try { JSON.parse(n.params[p.key]); } catch { if (!/\{\{/.test(n.params[p.key])) { alert(`« ${n.name} » : ${p.label} n'est pas un JSON valide.`); return false; } } }
    const r = await api('/api/draupnir/save', { flow: wf });
    if (!r.ok) { alert(r.error); return false; }
    wf = r.flow; dirty = false; const s = $('#drSt'); if (s) s.textContent = '✓ Enregistré.'; return true;
  }
  async function test(stopAfter) {
    if (!(await save())) return;
    const s = $('#drSt'); if (s) s.textContent = 'Test en cours…';
    const r = await api('/api/draupnir/run', { id: wf.id, stopAfter });
    if (!r.ok) { if (s) s.textContent = `✗ ${r.error}`; return; }
    last = r.run; if (s) s.textContent = `${r.run.status === 'succès' ? '✓' : '✗'} ${r.run.status} en ${r.run.ms} ms${r.run.error ? ` : ${r.run.error}` : ''}`;
    draw(); drawSide();
  }
  function init() { document.head.append(el('style', {}, css)); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.OdinFlows = { open: () => { if (!wf) openList(); }, edit: openFlow };
})();
