// La fenêtre d'Odin (maquettes validées « Fenetre », « FenetreEdition », « FenetreTel ») : des pages de modules
// d'applis (chiffres clés ou une partie de la page d'une appli), la météo, des boutons sur mesure. Mode « Modifier » :
// glisser-déposer (souris et doigt), taille, retirer, pages (ajouter, renommer, supprimer), catalogue des modules,
// bouton sur mesure, thème. Rangée par Glaðsheimr (côté Odin) : la même sur l'ordinateur et le téléphone.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v === undefined || v === null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const api = async (path, body) => { const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } }); return r.json(); };
  const act = (module, action, input = {}, confirm) => api('/api/valhalla/act', { module, action, input, ...(confirm ? { confirm: true } : {}) });
  const css = `
#fenetre{margin:0 0 18px}.fe-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px}.fe-bar .sp{flex:1}
.fe-tab{min-height:36px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13.5px inherit;cursor:pointer}.fe-tab[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.fe-edit .fe-tab[aria-pressed=true]{background:#fff;color:#10363a}.fe-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;border-radius:16px;background:#10363a;color:#fff;margin:0 0 12px}
.fe-tools .fe-tab{background:rgba(255,255,255,.12);color:#fff;border-color:transparent}.fe-tools b{display:flex;gap:6px;align-items:center;margin:0 6px}.fe-tools .btn{min-height:36px}
.fe-wrap{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}.fe-edit .fe-wrap{grid-template-columns:minmax(0,1fr) 330px}@media (max-width:980px){.fe-edit .fe-wrap{grid-template-columns:minmax(0,1fr)}}
.fe-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start;min-height:120px}@media (max-width:760px){.fe-grid{grid-template-columns:minmax(0,1fr)}.fe-w{grid-column:auto!important}}
.fe-w{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px 16px;min-width:0;box-shadow:0 10px 26px rgba(16,54,58,.08)}
.fe-w .va-kpi{padding:8px 10px}.fe-w .va-kpi b{font-size:20px}
.fe-w .va-sec{background:none;border:0;padding:0;margin:0}.fe-w .va-sec h2{display:none}.fe-w .va-kpis{margin:0;grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}
.fe-h{display:flex;gap:10px;align-items:center;margin:0 0 10px}.fe-h small{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700}.fe-h b{font-size:15.5px}
.fe-ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--field);font-weight:700;flex:none}
.fe-open{margin-left:auto;font-size:12.5px;color:var(--muted);background:none;border:0;cursor:pointer;min-height:32px}
.fe-edit .fe-w{outline:2px dashed color-mix(in srgb,var(--accent,#0b7f7c) 55%,transparent);outline-offset:3px;touch-action:none}
.fe-chrome{display:none;position:absolute;top:-12px;right:-6px;gap:4px}.fe-edit .fe-chrome{display:flex}.fe-chrome button{width:30px;height:30px;border-radius:9px;border:1px solid var(--line);background:var(--panel);cursor:pointer;display:grid;place-items:center;font-size:14px}
.fe-grip{display:none;position:absolute;top:-12px;left:-6px;width:30px;height:30px;border-radius:9px;background:#10363a;color:#fff;border:0;cursor:grab;font-size:15px}.fe-edit .fe-grip{display:grid;place-items:center}
.fe-w.dragging{opacity:.35}.fe-ghost{position:fixed;z-index:80;pointer-events:none;transform:rotate(-3deg);box-shadow:0 24px 60px rgba(16,54,58,.35);opacity:.95}
.fe-drop{border:2px dashed var(--line);border-radius:18px;min-height:90px;display:grid;place-items:center;color:var(--muted)}
.fe-cat{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px;max-height:calc(100vh - 140px);overflow:auto;position:sticky;top:12px}
.fe-cat h2{font-size:17px;margin:0 0 8px}.fe-cat input{width:100%;min-height:40px;border-radius:12px;border:1px solid var(--field);background:var(--panel2);padding:0 12px;margin:0 0 10px}
.fe-cat h3{font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:12px 0 6px}
.fe-item{display:flex;gap:10px;align-items:center;width:100%;text-align:left;padding:10px;border-radius:12px;border:1px solid var(--line);background:var(--panel2);margin:0 0 6px;cursor:grab;color:var(--ink)}.fe-item small{display:block;color:var(--muted)}
.fe-own{background:#10363a;color:#fff;border-radius:14px;padding:12px;margin:12px 0 0}.fe-own .btn{margin-top:8px}
.fe-form label{display:block;font-size:13px;font-weight:600;margin:8px 0 4px}.fe-form select,.fe-form input{width:100%;min-height:38px;border-radius:10px;border:1px solid var(--field);padding:0 10px;background:var(--panel)}
.fe-btnw{display:flex;flex-direction:column;gap:8px}.fe-btnw .btn{min-height:46px;font-size:15px}
.fe-wx{display:flex;gap:14px;align-items:center}.fe-wx b{font-size:34px}.fe-hours{display:flex;justify-content:space-between;margin-top:10px;font-size:12.5px;color:var(--muted)}
.fe-err{color:var(--muted);font-size:13.5px}`;
  document.head.append(el('style', {}, css));

  let L = null, cur = 0, edit = false, saved = '', cat = null, views = new Map(), timer = 0;
  const host = () => $('#fenetre');
  const page = () => L.pages[Math.min(cur, L.pages.length - 1)];
  const modName = (id) => cat?.modules?.find((m) => m.id === id)?.name ?? id;
  const modFam = (id) => cat?.modules?.find((m) => m.id === id)?.family ?? '';

  async function load() {
    const [f, c] = await Promise.all([act('gladsheim', 'fenetre'), cat ? Promise.resolve(cat) : api('/api/valhalla/catalog')]);
    cat = c; if (!f.ok) throw new Error(f.text || f.error || 'fenêtre indisponible');
    L = f.data; saved = JSON.stringify(L); try { cur = Math.min(Number(localStorage.getItem('odin.fenetre.page') || 0), L.pages.length - 1); } catch { cur = 0; }
  }
  /** Les vues des applis de la page (une fois chacune). */
  async function fetchViews() {
    const ids = [...new Set(page().widgets.filter((w) => w.module && w.kind !== 'bouton').map((w) => w.module))];
    await Promise.all(ids.map(async (id) => { try { const r = await api(`/api/valhalla/view?id=${encodeURIComponent(id)}`); if (r.ok) views.set(id, r.view); } catch { /* hors ligne */ } }));
  }
  async function weather() { try { const r = await act('gladsheim', 'meteo', {}); return r.ok ? r.data : null; } catch { return null; } }

  // ------------------------------------------------------------------ dessin d'un module
  async function widget(w) {
    const box = el('article', { class: 'fe-w', 'data-id': w.id, style: `grid-column:span ${w.w}` });
    const grip = el('button', { class: 'fe-grip', type: 'button', title: 'Déplacer (ou flèches ← →)', 'aria-label': 'Déplacer ce module', onkeydown: (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { move(w.id, -1); e.preventDefault(); } if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { move(w.id, 1); e.preventDefault(); } } }, '⠿');
    grip.addEventListener('pointerdown', (e) => startDrag(e, box, w.id));
    const chrome = el('div', { class: 'fe-chrome' },
      el('button', { type: 'button', title: 'Taille (1, 2 ou 3 colonnes)', 'aria-label': 'Changer la taille', onclick: () => { w.w = w.w === 3 ? 1 : w.w + 1; draw(); } }, '↔'),
      w.kind === 'section' || w.kind === 'chiffres' ? el('button', { type: 'button', title: 'Choisir ce qu\'il montre', 'aria-label': 'Réglages du module', onclick: () => configure(w) }, '⚙') : null,
      el('button', { type: 'button', title: 'Retirer', 'aria-label': 'Retirer ce module', onclick: () => { page().widgets = page().widgets.filter((x) => x.id !== w.id); draw(); } }, '✕'));
    box.append(grip, chrome);
    const head = (title, small, icon) => el('div', { class: 'fe-h' }, el('span', { class: 'fe-ic', 'aria-hidden': 'true' }, icon ?? (title || '?').slice(0, 1)), el('div', {}, el('small', {}, small), el('b', {}, title)),
      w.module ? el('button', { class: 'fe-open', type: 'button', onclick: () => { location.hash = `#app=${w.module}`; } }, 'Ouvrir ›') : null);
    if (w.kind === 'meteo') {
      const d = await weather();
      box.append(head(w.label || 'Météo', 'Glaðsheimr', '☀'), d ? el('div', {}, el('div', { class: 'fe-wx' }, el('b', {}, `${Math.round(d.temp ?? d.now?.temp ?? 0)}°`), el('div', {}, el('div', {}, d.text ?? d.now?.text ?? ''), el('small', { class: 'sub' }, d.place ?? d.ville ?? ''))),
        Array.isArray(d.hours) && d.hours.length ? el('div', { class: 'fe-hours' }, ...d.hours.slice(0, 5).map((h) => el('span', {}, `${h.h ?? h.hour} h · ${Math.round(h.t ?? h.temp)}°`))) : null) : el('p', { class: 'fe-err' }, 'Météo indisponible (choisis ta ville dans Glaðsheimr).'));
      return box;
    }
    if (w.kind === 'bouton') {
      box.append(head(w.label || w.action, modName(w.module), '⚡'), el('div', { class: 'fe-btnw' }, el('button', { class: 'btn primary', type: 'button', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { let r = await act(w.module, w.action, w.input || {}); if (r.confirm) r = window.confirm(r.confirm) ? await act(w.module, w.action, w.input || {}, true) : { ok: true, text: 'Annulé.' }; say(r.ok ? r.text : `✗ ${r.text ?? r.error}`); }
        finally { b.disabled = false; }
      } }, w.label || w.action)));
      return box;
    }
    const v = views.get(w.module);
    box.append(head(w.label || (w.kind === 'section' ? w.section : modName(w.module)), `${modName(w.module)}${modFam(w.module) ? ` · ${modFam(w.module)}` : ''}`));
    if (!v) { box.append(el('p', { class: 'fe-err' }, 'Appli indisponible pour l\'instant.')); return box; }
    if (w.kind === 'chiffres') {
      box.append(v.kpis?.length ? el('div', { class: 'va-kpis' }, ...v.kpis.slice(0, w.w * 2 + 1).map((k) => el('div', { class: `va-kpi ${k.tone ?? ''}`, title: k.hint ?? '' }, el('small', {}, k.label), el('b', {}, k.value), typeof k.pct === 'number' ? el('div', { class: 'va-bar' }, el('i', { style: `width:${Math.max(0, Math.min(100, k.pct))}%` })) : null)))
        : el('p', { class: 'fe-err' }, v.subtitle || 'Pas de chiffres pour cette appli : choisis une partie de sa page (⚙).'));
      return box;
    }
    const s = [...(v.sections ?? []), ...(v.side ?? [])].find((x) => x.title === w.section);
    box.append(s && window.OdinApps?.section ? window.OdinApps.section(w.module, s) : el('p', { class: 'fe-err' }, `« ${w.section} » n'est plus sur la page de ${modName(w.module)}.`));
    return box;
  }
  function say(t) { const n = el('div', { class: 'va-out', role: 'status', style: 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:90;max-width:min(560px,calc(100% - 32px))' }, t); document.body.append(n); setTimeout(() => n.remove(), 5000); }

  // ------------------------------------------------------------------ la page
  async function draw() {
    const h = host(); if (!h || !L) return;
    h.classList.toggle('fe-edit', edit);
    const tabs = L.pages.map((p, i) => el('button', { class: 'fe-tab', type: 'button', 'aria-pressed': String(i === cur), onclick: async () => { cur = i; try { localStorage.setItem('odin.fenetre.page', String(i)); } catch { /* */ } await fetchViews(); draw(); }, ondblclick: () => edit && rename(i) }, p.name, p.maison ? ' 🏠' : ''));
    const bar = edit
      ? el('div', { class: 'fe-tools', role: 'toolbar', 'aria-label': 'Modifier la fenêtre' }, el('b', {}, '✎ Modifier'), ...tabs,
        el('button', { class: 'fe-tab', type: 'button', title: 'Ajouter une page', 'aria-label': 'Ajouter une page', onclick: () => { const n = prompt('Nom de la nouvelle page', 'Ma page'); if (n) { L.pages.push({ id: '', name: n.slice(0, 24), widgets: [] }); cur = L.pages.length - 1; draw(); } } }, '+'),
        el('button', { class: 'fe-tab', type: 'button', onclick: () => rename(cur) }, 'Renommer'),
        L.pages.length > 1 ? el('button', { class: 'fe-tab', type: 'button', onclick: () => { if (confirm(`Supprimer la page « ${page().name} » ?`)) { L.pages.splice(cur, 1); cur = 0; draw(); } } }, 'Supprimer la page') : null,
        el('button', { class: 'fe-tab', type: 'button', 'aria-pressed': String(Boolean(page().maison)), title: 'Montrer cette page sur l\'écran de la maison', onclick: () => { page().maison = !page().maison; draw(); } }, '🏠 Écran de la maison'),
        el('span', { class: 'sp' }), themeBtn(),
        el('button', { class: 'btn small', type: 'button', onclick: async () => { L = JSON.parse(saved); edit = false; await fetchViews(); draw(); } }, 'Annuler'),
        el('button', { class: 'btn small primary', type: 'button', onclick: save }, 'Terminé'))
      : el('div', { class: 'fe-bar' }, ...tabs, el('span', { class: 'sp' }), el('button', { class: 'btn small primary', type: 'button', onclick: () => { edit = true; draw(); } }, '✎ Modifier'));
    const grid = el('div', { class: 'fe-grid', id: 'feGrid' });
    for (const w of page().widgets) grid.append(await widget(w));
    if (!page().widgets.length) grid.append(el('div', { class: 'fe-drop', style: 'grid-column:1/-1' }, edit ? 'Glisse ici un module du catalogue (ou clique dessus).' : 'Page vide : « Modifier » pour ajouter des modules.'));
    if (edit) { grid.addEventListener('dragover', (e) => e.preventDefault()); grid.addEventListener('drop', (e) => { e.preventDefault(); const d = e.dataTransfer.getData('text/odin-module'); if (d) add(JSON.parse(d)); }); }
    h.replaceChildren(bar, el('div', { class: 'fe-wrap' }, grid, edit ? catalogue() : null));
  }
  function rename(i) { const n = prompt('Nom de la page', L.pages[i].name); if (n) { L.pages[i].name = n.slice(0, 24); draw(); } }
  function themeBtn() {
    const themes = window.OdinThemes?.ORDER ?? [];
    const sel = el('select', { 'aria-label': 'Thème', style: 'min-height:36px;border-radius:999px;padding:0 10px;background:#fff;color:#10363a;border:0', onchange: async (e) => { const r = await act('apparence', 'theme', { theme: e.target.value }); say(r.ok ? r.text : `✗ ${r.text ?? r.error}`); } },
      el('option', { value: '' }, '🎨 Thème…'), el('option', { value: 'automatique' }, 'Automatique'), ...themes.map((t) => el('option', { value: t }, window.OdinThemes.THEMES[t]?.name ?? t)));
    return sel;
  }
  async function save() {
    const r = await act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(L) });
    if (!r.ok) { say(`✗ ${r.text ?? r.error}`); return; }
    L = r.data; saved = JSON.stringify(L); edit = false; say('✓ Fenêtre rangée.'); await fetchViews(); draw();
  }
  function move(id, d) { const l = page().widgets, i = l.findIndex((x) => x.id === id), j = i + d; if (i < 0 || j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; draw().then(() => $(`.fe-w[data-id="${id}"] .fe-grip`)?.focus()); }
  /** Glisser-déposer à la souris et au doigt : on suit le pointeur, on range au-dessus du module visé. */
  function startDrag(e, box, id) {
    e.preventDefault(); const r = box.getBoundingClientRect(), ghost = box.cloneNode(true); ghost.classList.add('fe-ghost'); ghost.style.width = `${r.width}px`; ghost.style.left = `${r.left}px`; ghost.style.top = `${r.top}px`;
    document.body.append(ghost); box.classList.add('dragging');
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const mv = (ev) => {
      ghost.style.left = `${ev.clientX - dx}px`; ghost.style.top = `${ev.clientY - dy}px`;
      ghost.hidden = true; const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.fe-w'); ghost.hidden = false;
      if (t && t !== box) { const tr = t.getBoundingClientRect(), after = ev.clientX > tr.left + tr.width / 2 || ev.clientY > tr.bottom - 10; t.parentNode.insertBefore(box, after ? t.nextSibling : t); }
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); ghost.remove(); box.classList.remove('dragging'); const order = [...document.querySelectorAll('#feGrid .fe-w')].map((n) => n.dataset.id); page().widgets.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  function add(w) { page().widgets.push({ id: '', w: 1, ...w }); views.delete(w.module); fetchViews().then(draw); }

  // ------------------------------------------------------------------ catalogue, réglages d'un module, bouton sur mesure
  function catalogue() {
    const list = el('div', {}), q = el('input', { type: 'search', placeholder: 'Chercher un module ou une appli…', 'aria-label': 'Chercher un module', oninput: () => fill(q.value) });
    const item = (w, title, sub, icon) => { const b = el('button', { class: 'fe-item', type: 'button', draggable: 'true', onclick: () => add(w), ondragstart: (e) => e.dataTransfer.setData('text/odin-module', JSON.stringify(w)) }, el('span', { class: 'fe-ic', 'aria-hidden': 'true' }, icon), el('span', {}, el('b', {}, title), el('small', {}, sub))); return b; };
    const fill = (term) => {
      const t = term.trim().toLowerCase(), fams = new Map();
      for (const m of cat?.modules ?? []) { if (t && !`${m.name} ${m.what} ${m.family}`.toLowerCase().includes(t)) continue; if (!fams.has(m.family)) fams.set(m.family, []); fams.get(m.family).push(m); }
      list.replaceChildren(item({ kind: 'meteo' }, 'Météo', 'le temps, heure par heure', '☀'),
        ...[...fams].flatMap(([f, ms]) => [el('h3', {}, f), ...ms.map((m) => item({ kind: 'chiffres', module: m.id }, m.name, m.what.slice(0, 70), m.name.slice(0, 1)))]));
    };
    fill('');
    return el('aside', { class: 'fe-cat', 'aria-label': 'Ajouter un module' }, el('h2', {}, 'Ajouter un module'), el('p', { class: 'sub', style: 'margin:-4px 0 10px' }, 'Glisse-le sur la page, ou clique dessus. ⚙ sur un module : choisir la partie de l\'appli à montrer.'), q, list,
      el('div', { class: 'fe-own' }, el('b', {}, '＋ Bouton sur mesure'), el('div', { style: 'font-size:13.5px;opacity:.9;margin-top:4px' }, 'N\'importe quelle action d\'une appli. Les actions graves te demandent ton accord à chaque clic.'), el('button', { class: 'btn small', type: 'button', onclick: ownButton }, 'Créer un bouton')));
  }
  function dialog(title, body, onOk) {
    const d = el('dialog', { class: 'fe-form', style: 'max-width:min(460px,calc(100% - 32px));border-radius:16px;border:1px solid var(--line);background:var(--panel);color:var(--ink)' }, el('h2', { style: 'margin:0 0 8px;font-size:17px' }, title), body,
      el('div', { class: 'va-acts-bar', style: 'margin:14px 0 0' }, el('button', { class: 'btn small', type: 'button', onclick: () => d.close() }, 'Annuler'), el('button', { class: 'btn small primary', type: 'button', onclick: () => { if (onOk() !== false) d.close(); } }, 'Valider')));
    d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal();
  }
  async function configure(w) {
    const v = views.get(w.module) ?? (await api(`/api/valhalla/view?id=${encodeURIComponent(w.module)}`)).view;
    const secs = [...(v?.sections ?? []), ...(v?.side ?? [])].filter((s) => s.kind !== 'form').map((s) => s.title);
    const sel = el('select', { id: 'feSec' }, el('option', { value: '' }, 'Les chiffres clés'), ...secs.map((t) => el('option', { value: t, selected: t === w.section ? true : undefined }, t)));
    const lab = el('input', { id: 'feLab', value: w.label ?? '', placeholder: 'Titre (facultatif)' });
    dialog(`Module ${modName(w.module)}`, el('div', {}, el('label', { for: 'feSec' }, 'Ce qu\'il montre'), sel, el('label', { for: 'feLab' }, 'Titre'), lab), () => {
      if (sel.value) { w.kind = 'section'; w.section = sel.value; } else { w.kind = 'chiffres'; delete w.section; }
      w.label = lab.value.trim() || undefined; draw();
    });
  }
  function ownButton() {
    const mods = cat?.modules ?? [], ms = el('select', { id: 'feM' }, ...mods.map((m) => el('option', { value: m.id }, m.name))), as = el('select', { id: 'feA' }), params = el('div', {}), lab = el('input', { id: 'feL', placeholder: 'ex. Bloquer YouTube jusqu\'à 20 h' });
    const fillA = () => { const m = mods.find((x) => x.id === ms.value); as.replaceChildren(...(m?.actions ?? []).map((a) => el('option', { value: a.id }, `${a.label}${a.grave ? ' ⚠' : ''}`))); fillP(); };
    const fillP = () => { const a = mods.find((x) => x.id === ms.value)?.actions.find((x) => x.id === as.value); params.replaceChildren(...(a?.params ?? []).filter((p) => p.kind !== 'password').map((p) => el('div', {}, el('label', { for: `feP-${p.key}` }, `${p.label}${p.required ? ' *' : ''}`), p.kind === 'select' ? el('select', { id: `feP-${p.key}`, 'data-k': p.key }, ...(p.options ?? []).map((o) => el('option', { value: o }, o))) : el('input', { id: `feP-${p.key}`, 'data-k': p.key, value: p.default ?? '' })))); };
    ms.onchange = fillA; as.onchange = fillP; fillA();
    dialog('Bouton sur mesure', el('div', {}, el('label', { for: 'feM' }, 'Appli'), ms, el('label', { for: 'feA' }, 'Action'), as, params, el('label', { for: 'feL' }, 'Texte du bouton'), lab), () => {
      const input = Object.fromEntries([...params.querySelectorAll('[data-k]')].map((n) => [n.dataset.k, n.value]).filter(([, v]) => v !== ''));
      const a = mods.find((x) => x.id === ms.value)?.actions.find((x) => x.id === as.value); if (!a) return false;
      add({ kind: 'bouton', module: ms.value, action: as.value, input, label: lab.value.trim() || a.label });
    });
  }

  // ------------------------------------------------------------------ montage
  async function mount() {
    const body = $('#v-home .body'); if (!body || $('#fenetre')) return;
    body.prepend(el('div', { id: 'fenetre', 'aria-label': 'Ma fenêtre' }, el('p', { class: 'fe-err' }, 'Chargement de ta fenêtre…')));
    try { await load(); await fetchViews(); await draw(); } catch (e) { host().replaceChildren(el('p', { class: 'fe-err' }, `Fenêtre indisponible : ${e.message}`)); return; }
    clearInterval(timer); timer = setInterval(async () => { if (edit || document.hidden || !$('#v-home.on')) return; await fetchViews(); draw(); }, 60_000);
  }
  window.OdinFenetre = { mount, state: () => ({ L, cur, edit }), edit: (on = true) => { edit = on; draw(); } };
  // Après la connexion seulement (la page de connexion n'a pas de fenêtre).
  const tryMount = () => { const app = $('#app'); if (app && !app.hidden && $('#v-home .body')) mount(); else setTimeout(tryMount, 1500); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryMount); else tryMount();
})();
