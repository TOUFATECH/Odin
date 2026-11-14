// Espace « Papyrus » : les bases de données d'Odin (comme Notion). Liste des bases, vues table,
// tableau (kanban), calendrier, galerie, liste, chronologie ; modification directe des cellules,
// ajout de fiches et de propriétés, recherche, export et import CSV. Les fiches sont des notes de Thot.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  // Session expirée pendant l'usage : on revient à la page de connexion. Sur la page de connexion elle-même,
  // on ne recharge rien (sinon elle se rechargerait en boucle et effacerait ce que tu tapes).
  const appShown = () => { const a = document.querySelector('#app'); return Boolean(a && !a.hidden); };
  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
    if (r.status === 401) { if (appShown()) location.reload(); throw new Error('session expirée'); }
    return r.json();
  }
  const css = `
.ru-l{display:grid;grid-template-columns:240px minmax(0,1fr);gap:14px;align-items:start}.ru-l>*{min-width:0}
.ru-side{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:4px}
.ru-side button.ru-b{display:flex;justify-content:space-between;gap:8px;text-align:left;border:0;background:none;border-radius:10px;padding:9px 10px;min-height:40px}.ru-side button.ru-b:hover,.ru-side button.ru-b[aria-current]{background:var(--hover)}.ru-side small{color:var(--dim)}
.ru-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px}.ru-bar input[type=search]{flex:1 1 200px;min-height:38px;padding:0 12px;border-radius:10px;border:1px solid var(--field);background:var(--panel)}
.ru-views{display:flex;gap:6px;flex-wrap:wrap}.ru-views button{border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:4px 12px;font-size:13.5px;min-height:34px}.ru-views button[aria-pressed=true]{background:var(--accent);color:var(--on-accent);border-color:transparent;font-weight:600}
.ru-tw{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
.ru-t{border-collapse:collapse;width:100%;font-size:14px}.ru-t th{text-align:left;font-weight:600;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap;background:var(--panel2)}
.ru-t td{border-bottom:1px solid var(--line);padding:0;min-width:120px}.ru-t tr:last-child td{border-bottom:0}
.ru-t td input,.ru-t td select{width:100%;min-height:38px;border:0;background:transparent;padding:6px 10px;border-radius:0}.ru-t td input:focus,.ru-t td select:focus{outline:2px solid var(--accent);outline-offset:-2px;background:var(--panel2)}
.ru-t td.ru-title{font-weight:600;padding:6px 10px;min-width:180px}.ru-t td.ru-ro{padding:6px 10px;color:var(--muted)}
.ru-board{display:flex;gap:12px;overflow-x:auto;padding-bottom:6px}.ru-col{flex:0 0 260px;background:var(--panel2);border:1px solid var(--line);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:120px}
.ru-col h3{font-size:14px;margin:0;display:flex;justify-content:space-between}.ru-col.over{border-color:var(--accent)}
.ru-card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px;font-size:14px;cursor:grab}.ru-card small{display:block;color:var(--muted);font-size:12.5px}
.ru-gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.ru-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.ru-cal .ru-d{min-height:86px;border:1px solid var(--line);border-radius:8px;padding:4px;background:var(--panel);font-size:12.5px;overflow:hidden}.ru-cal .ru-d.out{opacity:.45}.ru-cal .ru-d b{display:block;color:var(--dim);font-weight:600}.ru-cal .ru-d span{display:block;background:var(--sel);border-radius:5px;padding:1px 5px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ru-cal .ru-h{font-size:12px;color:var(--dim);text-align:center}
.ru-tl{display:flex;flex-direction:column;gap:6px}.ru-tl div{display:grid;grid-template-columns:110px 1fr;gap:10px;font-size:14px;padding:6px 0;border-bottom:1px solid var(--line)}
.ru-pill{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--sel);font-size:12.5px;margin:1px 2px 1px 0}
.ru-add{display:flex;gap:8px;margin-top:10px}a.btn{text-decoration:none;color:inherit}.ru-newv{min-height:38px;padding:0 10px;border-radius:10px;border:1px solid var(--field);background:var(--panel);color:var(--ink)}
@media (max-width:860px){.ru-l{grid-template-columns:minmax(0,1fr)}.ru-side{flex-direction:row;overflow-x:auto;padding:6px}.ru-side button.ru-b{flex:none;white-space:nowrap}.ru-side .btn{margin-top:0!important;flex:none}}
.ru-add input{flex:1;min-width:0;min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--field);background:var(--panel)}
`;
  let bases = [], base = null, viewId = null, q = '', cal = new Date();
  const fmt = (v) => Array.isArray(v) ? v.join(', ') : v === true ? '✓' : v === false ? '' : v ?? '';
  const RO = ['formule', 'agrégation', 'créé', 'modifié', 'id', 'relation', 'fichier'];

  async function open(id) {
    const box = $('#v-runes .body'); if (!box) return;
    const r = await api('/api/runes/bases'); if (!r.ok) { box.replaceChildren(el('p', { class: 'sub' }, r.error)); return; }
    bases = r.bases;
    const side = el('nav', { class: 'ru-side', 'aria-label': 'Bases' }, ...bases.map((b) => el('button', { class: 'ru-b', type: 'button', 'aria-current': b.id === (id ?? base?.id) ? 'page' : undefined, onclick: () => { viewId = null; open(b.id); } }, el('span', {}, `${b.icon || '🗂'} ${b.name}`), el('small', {}, String(b.count)))),
      el('button', { class: 'btn small', type: 'button', style: 'margin-top:8px', onclick: async () => { const n = prompt('Nom de la nouvelle base ?'); if (!n) return; const x = await api('/api/runes/base/create', { name: n, props: [{ label: 'Statut', type: 'statut' }, { label: 'Date', type: 'date' }] }); if (x.ok) open(x.base.id); else alert(x.error); } }, '+ Nouvelle base'));
    const main = el('div', { id: 'ruMain' }, el('p', { class: 'sub' }, bases.length ? 'Choisis une base.' : 'Aucune base : crée-en une, ou demande à Odin (« crée une base Clients »).'));
    box.replaceChildren(el('div', { class: 'ru-l' }, side, main));
    const pick = id ?? base?.id ?? bases[0]?.id; if (pick) await load(pick);
  }
  async function load(id) {
    const r = await api(`/api/runes/query?base=${encodeURIComponent(id)}${viewId ? `&view=${encodeURIComponent(viewId)}` : ''}&q=${encodeURIComponent(q)}`);
    const main = $('#ruMain'); if (!main) return;
    if (!r.ok) { main.replaceChildren(el('p', { class: 'sub' }, r.error)); return; }
    base = r.base; viewId = r.view.id;
    $('#v-runes .head h1').textContent = `${base.icon || ''} ${base.name}`.trim();
    const bar = el('div', { class: 'ru-bar' },
      el('div', { class: 'ru-views', role: 'group', 'aria-label': 'Vues' }, ...base.views.map((v) => el('button', { type: 'button', 'aria-pressed': String(v.id === viewId), onclick: () => { viewId = v.id; load(base.id); } }, v.name))),
      el('label', { for: 'ruQ', class: 'sr' }, 'Rechercher'), el('input', { id: 'ruQ', type: 'search', placeholder: 'Rechercher…', value: q, onchange: (e) => { q = e.target.value; load(base.id); } }),
      el('select', { 'aria-label': 'Nouvelle vue', class: 'ru-newv', onchange: async (e) => { const t = e.target.value; e.target.value = ''; if (!t) return; const date = base.props.find((p) => p.type === 'date')?.key, grp = base.props.find((p) => p.type === 'statut' || p.type === 'sélection')?.key; const x = await api('/api/runes/view/save', { base: base.id, view: { name: t[0].toUpperCase() + t.slice(1), type: t, ...(t === 'tableau' ? { groupBy: grp } : {}), ...(t === 'calendrier' || t === 'chronologie' ? { date } : {}) } }); if (x.ok) { viewId = x.base.views.at(-1).id; load(base.id); } else alert(x.error); } }, el('option', { value: '' }, '+ Vue…'), ...['table', 'tableau', 'calendrier', 'galerie', 'liste', 'chronologie'].map((t) => el('option', { value: t }, t))),
      el('button', { class: 'btn small', type: 'button', onclick: addProp }, '+ Propriété'),
      el('a', { class: 'btn small', href: `/api/runes/export?base=${encodeURIComponent(base.id)}`, download: '' }, 'Exporter CSV'),
      el('label', { class: 'btn small', for: 'ruImp' }, 'Importer CSV'), el('input', { id: 'ruImp', type: 'file', accept: '.csv,text/csv', hidden: true, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; const x = await api('/api/runes/import', { base: base.id, csv: await f.text() }); alert(x.ok ? `${x.count} fiche(s) importée(s).` : x.error); load(base.id); } }));
    const t = r.view.type;
    const body = t === 'tableau' ? board(r) : t === 'calendrier' ? calendar(r) : t === 'galerie' ? gallery(r) : t === 'liste' ? list(r) : t === 'chronologie' ? timeline(r) : table(r);
    main.replaceChildren(bar, body, el('form', { class: 'ru-add', onsubmit: async (e) => { e.preventDefault(); const v = $('#ruNew').value.trim(); if (!v) return; const x = await api('/api/runes/row/add', { base: base.id, title: v }); if (x.ok) load(base.id); else alert(x.error); } }, el('label', { for: 'ruNew', class: 'sr' }, 'Nouvelle fiche'), el('input', { id: 'ruNew', placeholder: '+ Nouvelle fiche', autocomplete: 'off' }), el('button', { class: 'btn primary', type: 'submit' }, 'Ajouter')));
  }
  const visible = (r) => (r.view.visible?.length ? base.props.filter((p) => r.view.visible.includes(p.key)) : base.props);
  async function update(row, key, value) { const x = await api('/api/runes/row/update', { path: row.path, base: base.id, props: { [key]: value } }); if (!x.ok) { alert(x.error); load(base.id); } else if (x.fired) load(base.id); }
  function cell(row, p) {
    const v = row.values[p.key] ?? row.meta[p.key];
    if (RO.includes(p.type)) return el('td', { class: 'ru-ro' }, String(fmt(v)));
    const lab = `${p.label} de ${row.title}`;
    if (p.type === 'case') return el('td', {}, el('input', { type: 'checkbox', 'aria-label': lab, checked: v === true ? true : undefined, style: 'width:auto;min-height:0;margin:10px', onchange: (e) => update(row, p.key, e.target.checked) }));
    if ((p.type === 'statut' || p.type === 'sélection') && p.options) return el('td', {}, el('select', { 'aria-label': lab, onchange: (e) => update(row, p.key, e.target.value) }, el('option', { value: '' }, '—'), ...p.options.map((o) => el('option', { selected: o.name === v ? true : undefined }, o.name))));
    return el('td', {}, el('input', { 'aria-label': lab, type: p.type === 'date' ? 'date' : p.type === 'nombre' ? 'number' : p.type === 'email' ? 'email' : 'text', value: String(fmt(v)), onchange: (e) => update(row, p.key, e.target.value) }));
  }
  function table(r) {
    const props = visible(r);
    if (!r.rows.length) return el('p', { class: 'sub' }, 'Aucune fiche dans cette vue.');
    return el('div', { class: 'ru-tw' }, el('table', { class: 'ru-t' }, el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Titre'), ...props.map((p) => el('th', { scope: 'col' }, p.label)))), el('tbody', {}, ...r.rows.map((row) => el('tr', {}, el('td', { class: 'ru-title' }, row.title), ...props.map((p) => cell(row, p)))))));
  }
  function board(r) {
    const key = r.view.groupBy, p = base.props.find((x) => x.key === key);
    const groups = r.groups ?? [{ name: 'Tout', rows: r.rows }];
    return el('div', { class: 'ru-board' }, ...groups.map((g) => {
      const col = el('section', { class: 'ru-col', 'aria-label': g.name }, el('h3', {}, g.name || 'Sans valeur', el('small', {}, String(g.rows.length))), ...g.rows.map((row) => { const c = el('div', { class: 'ru-card', draggable: 'true', tabindex: '0' }, row.title, ...visible(r).filter((x) => x.key !== key).slice(0, 3).map((x) => (row.values[x.key] ?? row.meta[x.key]) ? el('small', {}, `${x.label} : ${fmt(row.values[x.key] ?? row.meta[x.key])}`) : null)); c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', row.path)); return c; }));
      if (p) {
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
        col.addEventListener('dragleave', () => col.classList.remove('over'));
        col.addEventListener('drop', async (e) => { e.preventDefault(); col.classList.remove('over'); const path = e.dataTransfer.getData('text/plain'); const row = r.rows.find((x) => x.path === path); if (row) { await update(row, key, g.name === 'Sans valeur' ? '' : g.name); load(base.id); } });
      }
      return col;
    }));
  }
  function calendar(r) {
    const key = r.view.date, y = cal.getFullYear(), m = cal.getMonth(), first = new Date(y, m, 1), start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
    const by = {}; for (const row of r.rows) { const d = String(row.values[key] ?? row.meta[key] ?? '').slice(0, 10); if (d) (by[d] ??= []).push(row); }
    const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return el('div', {}, el('div', { class: 'ru-bar' }, el('button', { class: 'btn small', type: 'button', onclick: () => { cal = new Date(y, m - 1, 1); load(base.id); } }, '‹'), el('b', {}, first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })), el('button', { class: 'btn small', type: 'button', onclick: () => { cal = new Date(y, m + 1, 1); load(base.id); } }, '›')),
      key ? el('div', { class: 'ru-cal' }, ...['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((d) => el('div', { class: 'ru-h' }, d)), ...days.map((d) => el('div', { class: `ru-d${d.getMonth() !== m ? ' out' : ''}` }, el('b', {}, String(d.getDate())), ...(by[iso(d)] ?? []).map((row) => el('span', { title: row.title }, row.title))))) : el('p', { class: 'sub' }, 'Cette base n\'a pas de propriété date.'));
  }
  function gallery(r) { return el('div', { class: 'ru-gal' }, ...r.rows.map((row) => el('article', { class: 'ru-card' }, el('b', {}, row.title), ...visible(r).slice(0, 4).map((p) => (row.values[p.key] ?? row.meta[p.key]) ? el('small', {}, `${p.label} : ${fmt(row.values[p.key] ?? row.meta[p.key])}`) : null)))); }
  function list(r) { return el('ul', { class: 'va-list', style: 'list-style:none;padding:0' }, ...r.rows.map((row) => el('li', { style: 'padding:8px 0;border-bottom:1px solid var(--line)' }, el('b', {}, row.title), ' ', ...visible(r).slice(0, 3).map((p) => (row.values[p.key] ?? row.meta[p.key]) ? el('span', { class: 'ru-pill' }, fmt(row.values[p.key] ?? row.meta[p.key])) : null)))); }
  function timeline(r) { const key = r.view.date; return el('div', { class: 'ru-tl' }, ...[...r.rows].sort((a, b) => String(a.values[key] ?? a.meta[key] ?? '').localeCompare(String(b.values[key] ?? b.meta[key] ?? ''))).map((row) => el('div', {}, el('span', { class: 'sub' }, String(row.values[key] ?? row.meta[key] ?? '—')), el('b', {}, row.title)))); }
  async function addProp() {
    const label = prompt('Nom de la propriété ?'); if (!label) return;
    const type = prompt('Type : texte, nombre, sélection, multi, statut, date, case, lien, email, téléphone, formule', 'texte'); if (!type) return;
    const prop = { label, type: type.trim() };
    if (prop.type === 'formule') prop.formula = prompt('Formule (ex. prop("Prix") * prop("Quantité"))') ?? '';
    const x = await api('/api/runes/prop/add', { base: base.id, prop }); if (!x.ok) alert(x.error); load(base.id);
  }
  function init() { document.head.append(el('style', {}, css)); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.OdinRunes = { open: () => open() };
})();
