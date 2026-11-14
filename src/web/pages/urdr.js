// Alexandrie dans l'interface (maquettes validées « Alexandrie · Studio » et « Alexandrie · SQL ») :
// - Studio, comme Prisma Studio : la liste des tables, la grille (filtres, tri, pages), une case modifiée reste
//   « en attente » (ancienne valeur affichée) jusqu'à « Enregistrer » ; les liens entre tables dans le panneau de droite.
// - SQL : l'éditeur, le résultat en tableau, le journal ; ce qui modifie la base passe par ton accord.
// - Bases : la liste de tes bases (la vue générique d'Alexandrie).
// Rien n'est écrit sans ton accord : « Enregistrer », « Ajouter », « Supprimer » et le SQL qui écrit demandent confirmation,
// et Arche sauvegarde la base juste avant une suppression ou une requête qui modifie.
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const act = async (action, input = {}, confirm = false) => {
    const r = await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'urdr', action, input, confirm }) });
    return r.json();
  };
  const ICON = {
    table: 'M3 4h18v16H3zM3 10h18M9 4v16', code: 'm8 8-5 4 5 4M16 8l5 4-5 4', db: 'M4 5c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
    filter: 'M3 5h18l-7 8v6l-4 2v-8z', link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1', plus: 'M12 5v14M5 12h14',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3', check: 'M5 12l5 5L20 7', play: 'M7 5v14l12-7z', x: 'M6 6l12 12M18 6 6 18',
  };
  const ic = (n, s = 15) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${ICON[n]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };
  const CSS = `
.ur{--ur:#3ecf8e;--ur-soft:color-mix(in srgb,#3ecf8e 16%,var(--panel));display:flex;flex-direction:column;gap:14px;min-width:0}
.ur-tabs{display:flex;gap:6px;flex-wrap:wrap}.ur-tabs button{min-height:38px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--muted);padding:0 14px;font:600 13.5px inherit;display:inline-flex;align-items:center;gap:8px;cursor:pointer}
.ur-tabs button[aria-selected=true]{background:var(--ur-soft);color:var(--ur);border-color:color-mix(in srgb,var(--ur) 40%,transparent)}
.ur-studio{display:grid;grid-template-columns:200px minmax(0,1fr) 290px;gap:14px;align-items:start}
@media (max-width:1180px){.ur-studio{grid-template-columns:180px minmax(0,1fr)}.ur-rel{grid-column:1/-1}}
@media (max-width:760px){.ur-studio{grid-template-columns:1fr}}
.ur-left{display:flex;flex-direction:column;gap:4px}.ur-left select,.ur-left input{min-height:38px;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 10px;font:inherit;font-size:13px;width:100%}
.ur-t{min-height:34px;border-radius:9px;padding:0 10px;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);background:none;border:0;cursor:pointer;text-align:left;width:100%}
.ur-t span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ur-t small{font:11.5px ui-monospace,Menlo,monospace}
.ur-t[aria-current=true]{background:var(--panel2);color:var(--ink);font-weight:600}
.ur-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ur-bar .n{margin-left:auto;font-size:12.5px;color:var(--muted)}
.ur-chip{min-height:32px;padding:0 10px 0 12px;border-radius:10px;background:var(--ur-soft);color:var(--ur);font-size:12.5px;font-weight:600;display:inline-flex;align-items:center;gap:6px;border:0;cursor:pointer}
.ur-chip.neutre{background:var(--panel2);color:var(--ink)}
.ur-grid{background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:auto;max-height:62vh}
.ur-grid table{border-collapse:collapse;width:100%}.ur-grid th{position:sticky;top:0;background:var(--panel);text-align:left;padding:9px 12px;font-size:12px;color:var(--muted);font-weight:600;border-bottom:1px solid var(--line);white-space:nowrap;cursor:pointer;user-select:none}
.ur-grid th small{font:10.5px ui-monospace,Menlo,monospace;opacity:.75;margin-left:6px}.ur-grid th .key{color:var(--ur)}
.ur-grid td{padding:7px 10px;font-size:13px;border-bottom:1px solid var(--line);white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis;cursor:text}
.ur-grid td.null{color:var(--muted);font-style:italic}.ur-grid td.mono{font-family:ui-monospace,Menlo,monospace}
.ur-grid td.fk{color:var(--ur);cursor:pointer}.ur-grid td.fk:hover{text-decoration:underline}
.ur-grid tr.sel{background:color-mix(in srgb,var(--ur) 8%,transparent)}
.ur-grid td.edit{outline:1.5px solid var(--ur);outline-offset:-2px;background:var(--ur-soft)}
.ur-grid td.edit em{color:var(--muted);font-size:11px;font-style:normal;margin-left:6px}
.ur-grid td input{width:100%;min-width:120px;border:0;background:transparent;color:var(--ink);font:inherit;outline:none}
.ur-grid .row-n{width:36px;color:var(--muted);font:11px ui-monospace,Menlo,monospace;text-align:right;cursor:pointer}
.ur-save{display:flex;align-items:center;gap:12px;background:var(--ur-soft);border:1px solid color-mix(in srgb,var(--ur) 35%,transparent);border-radius:14px;padding:10px 14px;flex-wrap:wrap}
.ur-save b{color:var(--ur)}.ur-save span{font-size:13px;color:var(--muted)}.ur-save .acts{margin-left:auto;display:flex;gap:8px}
.ur-rel{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px;display:flex;flex-direction:column;gap:10px}
.ur-rel h3{margin:0;font-size:14.5px;display:flex;align-items:center;gap:8px}.ur-rel .sub{font-size:12.5px}
.ur-card{background:var(--panel2);border-radius:12px;padding:9px 11px;display:flex;flex-direction:column;gap:3px;font-size:12.5px}.ur-card b{font-size:13px}
.ur-more{font-size:12.5px;color:var(--ur);font-weight:600;background:none;border:0;padding:0;text-align:left;cursor:pointer}
.ur-sql{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px;align-items:start}@media (max-width:1100px){.ur-sql{grid-template-columns:1fr}}
.ur-ed{width:100%;min-height:190px;resize:vertical;background:#0b0d12;color:#e6e9f0;border:1px solid var(--line);border-radius:16px;padding:14px 16px;font:13.5px/1.7 ui-monospace,Menlo,monospace;tab-size:2}
.ur-log{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px 16px;display:flex;flex-direction:column}
.ur-log div{display:flex;gap:10px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--line);font-size:12.5px}
.ur-log code{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}.ur-log .ok{color:var(--ur);font-weight:600;white-space:nowrap}.ur-log .ko{color:#e0457b;font-weight:600;white-space:nowrap}
.ur-out{font-size:13px;white-space:pre-wrap}.ur-out.ko{color:#e0457b}
.ur-dlg{border:1px solid var(--line);border-radius:18px;background:var(--panel);color:var(--ink);padding:20px;max-width:min(520px,calc(100% - 32px));width:100%}
.ur-dlg form{display:flex;flex-direction:column;gap:8px}.ur-dlg label{font-size:12.5px;color:var(--muted)}.ur-dlg input{min-height:38px;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 10px;font:inherit}
.ur-filt{display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:var(--panel2);border-radius:12px;padding:8px}.ur-filt select,.ur-filt input{min-height:34px;border-radius:9px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 8px;font:inherit;font-size:13px}
`;
  // L'état reste d'un affichage à l'autre (la page se redessine quand Odin met la vue à jour).
  const S = { tab: 'studio', base: '', table: '', tables: [], liens: [], cols: [], data: null, filters: [], sort: '', dir: 'asc', page: 1, per: 50, pending: {}, sel: null, q: '', sql: '', res: null, find: '' };
  const keyOf = (row) => JSON.stringify(Object.fromEntries(S.data.key.map((k) => [k, row[S.data.columns.indexOf(k)]])));
  const editable = () => S.data && S.data.key.length && S.data.key.every((k) => S.data.columns.includes(k));
  const nPending = () => Object.values(S.pending).reduce((n, p) => n + Object.keys(p.ch).length, 0);
  const fmtN = (n) => Number(n).toLocaleString('fr-FR');

  async function loadTables() {
    if (!S.base) { S.tables = []; S.liens = []; return; }
    const r = await act('tables', { base: S.base });
    if (!r.ok) throw new Error(r.text || r.error);
    S.tables = r.data.tables; S.liens = r.data.liens;
    if (!S.tables.some((t) => t.name === S.table)) S.table = S.tables[0]?.name ?? '';
  }
  async function loadRows() {
    if (!S.table) { S.data = null; S.cols = []; return; }
    const [c, r] = await Promise.all([act('colonnes', { base: S.base, table: S.table }), act('lignes', { base: S.base, table: S.table, filtres: JSON.stringify(S.filters), tri: S.sort, sens: S.dir, page: S.page, par_page: S.per })]);
    if (!r.ok) throw new Error(r.text || r.error);
    S.cols = c.ok ? c.data : []; S.data = r.data;
  }

  function studio(root, redraw) {
    const left = el('div', { class: 'ur-left' },
      el('input', { type: 'search', placeholder: 'Chercher une table…', 'aria-label': 'Chercher une table', value: S.find, oninput: (e) => { S.find = e.target.value; list.replaceChildren(...items()); } }));
    const items = () => S.tables.filter((t) => !S.find || t.name.toLowerCase().includes(S.find.toLowerCase())).map((t) => el('button', { class: 'ur-t', type: 'button', 'aria-current': String(t.name === S.table), onclick: async () => { if (nPending() && !confirm('Des modifications ne sont pas enregistrées : les abandonner ?')) return; Object.assign(S, { table: t.name, filters: [], sort: '', page: 1, pending: {}, sel: null }); await redraw(true); } }, ic('table', 14), el('span', {}, t.name), el('small', {}, fmtN(t.rows))));
    const list = el('div', { style: 'display:flex;flex-direction:column;gap:2px' }, ...items());
    left.append(list);
    if (!S.tables.length) left.append(el('p', { class: 'sub' }, S.base ? 'Aucune table dans cette base.' : 'Choisis une base.'));

    const mid = el('div', { style: 'display:flex;flex-direction:column;gap:12px;min-width:0' });
    if (S.data) {
      const d = S.data, pages = Math.max(1, Math.ceil(d.total / S.per));
      const colInfo = (name) => S.cols.find((c) => c.name === name);
      const filt = el('div', { class: 'ur-filt', hidden: true });
      const fCol = el('select', { 'aria-label': 'Colonne' }, ...d.columns.map((c) => el('option', { value: c }, c)));
      const fOp = el('select', { 'aria-label': 'Condition' }, ...['=', '!=', 'contient', 'commence par', '<', '>', '<=', '>=', 'vide', 'pas vide'].map((o) => el('option', { value: o }, o)));
      const fVal = el('input', { 'aria-label': 'Valeur', placeholder: 'valeur' });
      filt.append(fCol, fOp, fVal, el('button', { class: 'btn small primary', type: 'button', onclick: async () => { S.filters.push({ col: fCol.value, op: fOp.value, value: fVal.value }); S.page = 1; await redraw(true); } }, 'Appliquer'));
      mid.append(el('div', { class: 'ur-bar' },
        el('button', { class: 'btn small', type: 'button', onclick: () => { filt.hidden = !filt.hidden; if (!filt.hidden) fVal.focus(); } }, ic('filter', 14), ' Filtrer'),
        ...S.filters.map((f, i) => el('button', { class: 'ur-chip', type: 'button', title: 'Retirer ce filtre', onclick: async () => { S.filters.splice(i, 1); S.page = 1; await redraw(true); } }, `${f.col} ${f.op}${['vide', 'pas vide'].includes(f.op) ? '' : ` ${f.value}`}`, ic('x', 12))),
        S.sort ? el('button', { class: 'ur-chip neutre', type: 'button', title: 'Retirer le tri', onclick: async () => { S.sort = ''; await redraw(true); } }, `${S.sort} ${S.dir === 'desc' ? '↓' : '↑'}`, ic('x', 12)) : null,
        el('span', { class: 'n' }, `${fmtN(d.total)} ligne${d.total > 1 ? 's' : ''} · page ${S.page} / ${pages}`),
        el('button', { class: 'btn small', type: 'button', disabled: S.page <= 1, 'aria-label': 'Page précédente', onclick: async () => { S.page--; await redraw(true); } }, '‹'),
        el('button', { class: 'btn small', type: 'button', disabled: S.page >= pages, 'aria-label': 'Page suivante', onclick: async () => { S.page++; await redraw(true); } }, '›'),
        el('button', { class: 'btn small primary', type: 'button', onclick: () => addRow(redraw) }, ic('plus', 14), ' Ajouter une ligne')), filt);
      const head = el('tr', {}, el('th', { class: 'row-n' }, ''), ...d.columns.map((c) => { const ci = colInfo(c); return el('th', { title: 'Trier', onclick: async () => { if (S.sort === c) S.dir = S.dir === 'asc' ? 'desc' : 'asc'; else { S.sort = c; S.dir = 'asc'; } await redraw(true); } }, c, ci?.pk ? el('small', { class: 'key' }, 'clé') : null, el('small', {}, ci?.ref ? '→' : (ci?.type ?? '')), S.sort === c ? (S.dir === 'desc' ? ' ↓' : ' ↑') : ''); }));
      const canEdit = editable();
      const body = d.rows.map((row, ri) => {
        const k = canEdit ? keyOf(row) : null, p = k ? S.pending[k] : null;
        return el('tr', { class: S.sel === k && k ? 'sel' : '' }, el('td', { class: 'row-n', title: 'Choisir la ligne (liens, suppression)', onclick: () => { S.sel = k; redraw(false); } }, String((S.page - 1) * S.per + ri + 1)),
          ...row.map((v, ci) => {
            const c = d.columns[ci], info = colInfo(c), changed = p && Object.hasOwn(p.ch, c), shown = changed ? p.ch[c] : v;
            const td = el('td', { class: [shown === null ? 'null' : '', info?.pk ? 'mono' : '', info?.ref && !changed ? 'fk' : '', changed ? 'edit' : ''].filter(Boolean).join(' '), title: shown ?? 'vide (NULL)' },
              shown === null ? 'NULL' : shown, changed ? el('em', {}, `(était : ${v ?? 'NULL'})`) : null);
            if (info?.ref && !changed) td.addEventListener('click', async () => { if (v === null) return; if (nPending() && !confirm('Des modifications ne sont pas enregistrées : les abandonner ?')) return; Object.assign(S, { table: info.ref.table, filters: [{ col: info.ref.column, op: '=', value: v }], sort: '', page: 1, pending: {}, sel: null }); await redraw(true); });
            if (canEdit && !info?.pk) td.addEventListener('dblclick', () => editCell(td, k, c, v, shown, redraw));
            td.tabIndex = canEdit && !info?.pk ? 0 : -1;
            td.addEventListener('keydown', (e) => { if (e.key === 'Enter' && canEdit && !info?.pk) { e.preventDefault(); editCell(td, k, c, v, shown, redraw); } });
            return td;
          }));
      });
      mid.append(el('div', { class: 'ur-grid' }, el('table', {}, el('thead', {}, head), el('tbody', {}, ...body))));
      if (!d.rows.length) mid.append(el('p', { class: 'sub' }, S.filters.length ? 'Aucune ligne ne correspond aux filtres.' : 'Table vide.'));
      if (!canEdit) mid.append(el('p', { class: 'sub' }, 'Cette table n\'a pas de clé : elle se lit, mais Alexandrie ne la modifie pas case par case (passe par le SQL).'));
      else mid.append(el('p', { class: 'sub', style: 'margin:0' }, 'Double-clic (ou Entrée) sur une case pour la modifier ; rien n\'est écrit avant « Enregistrer ».'));
      const n = nPending();
      if (n) {
        const first = Object.values(S.pending)[0], c0 = Object.keys(first.ch)[0];
        mid.append(el('div', { class: 'ur-save', role: 'status' }, el('b', {}, `${n} modification${n > 1 ? 's' : ''} en attente`),
          el('span', {}, `${S.table} ${Object.values(JSON.parse(first.key)).join(', ')} · ${c0} : ${first.old[c0] ?? 'NULL'} → ${first.ch[c0] ?? 'NULL'}${n > 1 ? ` (+ ${n - 1})` : ''}`),
          el('span', { class: 'acts' }, el('button', { class: 'btn small', type: 'button', onclick: () => { S.pending = {}; redraw(false); } }, ic('undo', 14), ' Annuler'),
            el('button', { class: 'btn small primary', type: 'button', onclick: (e) => save(e.target, redraw) }, ic('check', 14), ' Enregistrer'))));
      }
    } else if (S.table) mid.append(el('p', { class: 'sub' }, 'Chargement…'));
    root.append(el('div', { class: 'ur-studio' }, left, mid, relations(redraw)));
  }

  function editCell(td, k, c, orig, shown, redraw) {
    if (td.querySelector('input')) return;
    const inp = el('input', { value: shown ?? '', 'aria-label': `Nouvelle valeur pour ${c}` });
    const done = (keep) => {
      if (keep) {
        const nv = inp.value === '' && orig === null ? null : inp.value, p = S.pending[k] ?? { key: k, ch: {}, old: {} };
        if (nv === orig) { delete p.ch[c]; delete p.old[c]; } else { p.ch[c] = nv; p.old[c] = orig; }
        if (Object.keys(p.ch).length) S.pending[k] = p; else delete S.pending[k];
      }
      redraw(false);
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
    td.replaceChildren(inp); td.classList.add('edit'); inp.focus(); inp.select();
  }

  async function save(btn, redraw) {
    const list = Object.values(S.pending), n = nPending();
    const what = list.map((p) => `${Object.values(JSON.parse(p.key)).join(', ')} : ${Object.entries(p.ch).map(([c, v]) => `${c} ${p.old[c] ?? 'NULL'} → ${v ?? 'NULL'}`).join(' ; ')}`).join('\n');
    if (!confirm(`Écrire ${n} modification${n > 1 ? 's' : ''} dans ${S.table} (${S.base}) ?\n\n${what}`)) return;
    btn.disabled = true; const errs = [];
    for (const p of list) {
      const r = await act('modifier', { base: S.base, table: S.table, cle: p.key, changements: JSON.stringify(p.ch) }, true);
      if (r.ok) delete S.pending[p.key]; else errs.push(r.text || r.error);
    }
    window.OdinApps?.toastMsg?.(errs.length ? errs.join('\n') : 'Enregistré.');
    await redraw(true); if (errs.length) alert(errs.join('\n'));
  }

  function addRow(redraw) {
    const cols = S.cols.length ? S.cols : (S.data?.columns ?? []).map((name) => ({ name, type: '' }));
    const dlg = el('dialog', { class: 'ur-dlg', 'aria-label': `Ajouter une ligne dans ${S.table}` });
    const f = el('form', { method: 'dialog' }, el('b', { style: 'font-size:16px' }, `Ajouter une ligne dans ${S.table}`), el('span', { class: 'sub' }, 'Les cases laissées vides prennent leur valeur par défaut.'),
      ...cols.flatMap((c) => [el('label', { for: `ur-n-${c.name}` }, `${c.name} `, el('small', {}, `${c.type}${c.pk ? ' · clé' : ''}${c.nullable === false ? ' · obligatoire' : ''}`)), el('input', { id: `ur-n-${c.name}`, name: c.name })]),
      el('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:8px' }, el('button', { class: 'btn', value: 'non' }, 'Annuler'), el('button', { class: 'btn primary', value: 'oui' }, 'Ajouter')));
    dlg.append(f); document.body.append(dlg); dlg.showModal();
    dlg.addEventListener('close', async () => {
      const ok = dlg.returnValue === 'oui', v = {}; for (const c of cols) { const x = f.elements[c.name]?.value; if (x) v[c.name] = x; } dlg.remove();
      if (!ok) return;
      const r = await act('ajouter_ligne', { base: S.base, table: S.table, valeurs: JSON.stringify(v) }, true);
      if (!r.ok) alert(r.text || r.error); await redraw(true);
    });
  }

  function relations(redraw) {
    const box = el('aside', { class: 'ur-rel', 'aria-label': 'Liens de la ligne choisie' });
    if (!S.data || !S.sel) { box.append(el('h3', {}, ic('link', 15), 'Liens'), el('p', { class: 'sub' }, S.liens.length ? 'Touche le numéro d\'une ligne pour voir ce qui lui est lié dans les autres tables ; une case verte mène à la ligne liée.' : 'Aucun lien déclaré entre les tables de cette base.')); return box; }
    const row = S.data.rows.find((r) => keyOf(r) === S.sel); if (!row) return box;
    const val = (c) => row[S.data.columns.indexOf(c)];
    const title = S.data.columns.find((c) => /nom|name|titre|title|libell/i.test(c)) ?? S.data.key[0];
    box.append(el('h3', {}, ic('link', 15), `${val(title) ?? ''}`));
    const incoming = S.liens.filter((l) => l.to === S.table && S.data.columns.includes(l.toColumn));
    const outgoing = S.cols.filter((c) => c.ref && val(c.name) !== null);
    if (!incoming.length && !outgoing.length) box.append(el('p', { class: 'sub' }, 'Rien n\'est lié à cette ligne.'));
    for (const c of outgoing) box.append(el('button', { class: 'ur-more', type: 'button', onclick: async () => { Object.assign(S, { table: c.ref.table, filters: [{ col: c.ref.column, op: '=', value: val(c.name) }], sort: '', page: 1, pending: {}, sel: null }); await redraw(true); } }, `${c.name} → ${c.ref.table} ${val(c.name)} →`));
    for (const l of incoming) {
      const sec = el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, el('span', { class: 'sub' }, `${l.from} · chargement…`)); box.append(sec);
      const v = val(l.toColumn);
      act('lignes', { base: S.base, table: l.from, filtres: JSON.stringify([{ col: l.column, op: '=', value: v }]), par_page: 3 }).then((r) => {
        if (!r.ok) { sec.replaceChildren(el('span', { class: 'sub' }, `${l.from} : ${r.text}`)); return; }
        const d = r.data;
        sec.replaceChildren(el('b', { style: 'font-size:13px' }, `${l.from}`), el('span', { class: 'sub' }, `${fmtN(d.total)} ligne${d.total > 1 ? 's' : ''} liée${d.total > 1 ? 's' : ''} (${S.table}.${l.toColumn} = ${l.from}.${l.column})`),
          ...d.rows.map((x) => { const cs = [...d.columns.filter((c) => c !== l.column && !d.key.includes(c) && !/_id$/i.test(c)), ...d.columns.filter((c) => /_id$/i.test(c) && c !== l.column)].slice(0, 3); return el('div', { class: 'ur-card' }, el('b', {}, x[d.columns.indexOf(cs[0])] ?? '—'), el('span', { class: 'sub' }, cs.slice(1).map((c) => x[d.columns.indexOf(c)] ?? '—').join(' · '))); }),
          d.total ? el('button', { class: 'ur-more', type: 'button', onclick: async () => { Object.assign(S, { table: l.from, filters: [{ col: l.column, op: '=', value: v }], sort: '', page: 1, pending: {}, sel: null }); await redraw(true); } }, `Voir ${d.total > 1 ? `les ${fmtN(d.total)}` : 'la ligne'} dans la table ${l.from} →`) : null);
      });
    }
    if (editable()) box.append(el('button', { class: 'btn small', type: 'button', style: 'margin-top:6px;color:#e0457b', onclick: async () => {
      if (!confirm(`Supprimer cette ligne de ${S.table} (${Object.values(JSON.parse(S.sel)).join(', ')}) ?\nSkuld sauvegarde la base juste avant.`)) return;
      const r = await act('supprimer_ligne', { base: S.base, table: S.table, cle: S.sel }, true); if (!r.ok) alert(r.text || r.error); S.sel = null; delete S.pending[S.sel]; await redraw(true);
    } }, 'Supprimer la ligne'));
    return box;
  }

  function sqlTab(root, redraw) {
    const ed = el('textarea', { class: 'ur-ed', spellcheck: 'false', 'aria-label': 'Requête SQL', placeholder: 'select * from …' });
    ed.value = S.sql || (S.table ? `select * from ${S.table} limit 20;` : 'select now();');
    ed.addEventListener('input', () => { S.sql = ed.value; });
    const out = el('div', {});
    const go = async () => {
      S.sql = ed.value.trim(); if (!S.sql) return;
      let r = await act('sql', { base: S.base, requete: S.sql });
      if (r.confirm) { if (!confirm(`${r.confirm}\n\nSkuld sauvegarde la base juste avant.`)) return; r = await act('sql', { base: S.base, requete: S.sql }, true); }
      S.res = r; draw(); await logBox();
    };
    ed.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } });
    const draw = () => {
      const r = S.res; out.replaceChildren();
      if (!r) return;
      if (!r.ok) { out.append(el('p', { class: 'ur-out ko' }, r.text || r.error)); return; }
      const d = r.data;
      if (d?.columns?.length) out.append(el('p', { class: 'sub', style: 'margin:0 0 6px' }, `${fmtN(d.rows.length)} ligne${d.rows.length > 1 ? 's' : ''} · ${d.ms} ms`), el('div', { class: 'ur-grid' }, el('table', {}, el('thead', {}, el('tr', {}, ...d.columns.map((c) => el('th', {}, c)))), el('tbody', {}, ...d.rows.slice(0, 500).map((row) => el('tr', {}, ...row.map((v) => el('td', { class: v === null ? 'null' : '', title: v ?? 'NULL' }, v ?? 'NULL'))))))));
      else out.append(el('p', { class: 'ur-out' }, r.text));
    };
    const ask = (q) => { window.OdinShow?.('chat'); window.OdinChat?.send?.(q, 'Alexandrie · SQL'); };
    const log = el('aside', { class: 'ur-log', 'aria-label': 'Journal des requêtes' }, el('b', { style: 'font-size:14.5px;margin-bottom:4px' }, 'Journal des requêtes'));
    const logBox = async () => {
      const r = await act('journal', {}); const l = (r.data ?? []).slice(0, 14);
      log.replaceChildren(el('b', { style: 'font-size:14.5px;margin-bottom:4px' }, 'Journal des requêtes'),
        ...l.map((e) => el('div', {}, el('span', { class: 'sub', style: 'font-family:ui-monospace,Menlo,monospace' }, e.at.slice(11, 16)), el('code', { title: `${e.base} · ${e.sql}`, onclick: () => { ed.value = e.sql; S.sql = e.sql; ed.focus(); } }, e.sql), el('span', { class: e.ok ? 'ok' : 'ko' }, e.result))),
        l.length ? null : el('p', { class: 'sub' }, 'Rien encore.'),
        el('p', { class: 'sub', style: 'margin:10px 0 0' }, 'Une requête qui modifie ou supprime passe toujours par ton accord, et Arche fait une sauvegarde juste avant.'));
    };
    root.append(el('div', { class: 'ur-sql' }, el('div', { style: 'display:flex;flex-direction:column;gap:12px;min-width:0' }, ed,
      el('div', { class: 'ur-bar' }, el('button', { class: 'btn small primary', type: 'button', onclick: go }, ic('play', 13), ' Lancer'),
        el('button', { class: 'btn small', type: 'button', onclick: () => ask(`Explique-moi simplement cette requête SQL (base ${S.base}) :\n${ed.value}`) }, 'Expliquer la requête'),
        el('button', { class: 'btn small', type: 'button', onclick: () => { const w = prompt('Que veux-tu obtenir ? (Odin écrit la requête)'); if (w) ask(`Écris-moi une requête SQL en lecture pour la base ${S.base}${S.tables.length ? ` (tables : ${S.tables.map((t) => t.name).join(', ')})` : ''} : ${w}`); } }, 'Odin, écris-la pour moi'),
        el('span', { class: 'n' }, 'Ctrl + Entrée pour lancer · lecture seule par défaut')), out), log));
    draw(); logBox();
  }

  window.OdinPages.urdr = async ({ host, generic, view }) => {
    if (!document.getElementById('urCss')) document.head.append(el('style', { id: 'urCss' }, CSS));
    const br = await act('bases', {}); const bases = (br.data ?? []).filter((b) => b.type === 'postgres');
    const want = window.OdinOpenWant?.module === 'urdr' ? window.OdinOpenWant : undefined; window.OdinOpenWant = undefined;
    if (want && bases.some((b) => b.id === want.base)) Object.assign(S, { base: want.base, table: want.table ?? '', tab: 'studio', tables: [], data: null, filters: [], sort: '', page: 1, pending: {}, sel: null });
    if (!S.base || !bases.some((b) => b.id === S.base)) { S.base = bases[0]?.id ?? ''; S.table = ''; }
    const root = el('div', { class: 'ur' });
    host.append(root);
    const redraw = async (reload) => {
      try { if (reload === 'tables') await loadTables(); if (reload) await loadRows(); } catch (e) { root.replaceChildren(el('p', { class: 'sub' }, `Connexion impossible : ${e.message}`)); return; }
      const tabs = el('div', { class: 'ur-tabs', role: 'tablist' }, ...[['studio', 'table', 'Studio'], ['sql', 'code', 'SQL'], ['schema', 'link', 'Schéma'], ['bases', 'db', 'Bases']].map(([id, i, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(S.tab === id), onclick: () => { S.tab = id; redraw(false); } }, ic(i, 15), t)));
      const pick = bases.length > 1 && S.tab !== 'bases' ? el('select', { 'aria-label': 'Base', style: 'margin-left:auto;min-height:38px;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 10px', onchange: async (e) => { if (nPending() && !confirm('Des modifications ne sont pas enregistrées : les abandonner ?')) { e.target.value = S.base; return; } Object.assign(S, { base: e.target.value, table: '', filters: [], sort: '', page: 1, pending: {}, sel: null, res: null }); await redraw('tables'); } }, ...bases.map((b) => el('option', { value: b.id, selected: b.id === S.base }, b.nom))) : null;
      const cur = bases.find((b) => b.id === S.base);
      root.replaceChildren(el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, tabs, pick, cur && S.tab !== 'bases' && !pick ? el('span', { class: 'sub', style: 'margin-left:auto' }, `${cur.nom}${cur.version ? ` · ${cur.version}` : ''}`) : null));
      if (S.tab === 'bases' || !bases.length) { root.append(...generic); if (!bases.length && S.tab !== 'bases') root.prepend(el('p', { class: 'sub' }, 'Aucune base PostgreSQL pour le Studio : « Créer une base » ou « Relier une base ».')); return; }
      // Schéma : le dessin des tables et de leurs liens (src/web/pages/urdr-schema.js).
      if (S.tab === 'schema') { if (window.OdinUrdrSchema) await window.OdinUrdrSchema(root, S.base); return; }
      if (S.tab === 'studio') studio(root, redraw); else sqlTab(root, redraw);
    };
    await redraw(S.base ? (S.tables.length ? true : 'tables') : false);
    if (S.base && S.tables.length && !S.data) await redraw(true);
    void view;
  };
})();
