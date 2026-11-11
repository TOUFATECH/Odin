// Espace « Cerveau » de l'interface d'Odin : pages et bases (comme un espace de travail), graphe des
// connaissances (comme un coffre de notes reliées), capture en un geste, questions au cerveau avec
// sources illuminées. Fichier autonome chargé par ui.html (même origine, même nonce).
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
    if (r.status === 401) { location.reload(); throw new Error('session expirée'); }
    return r.json();
  }
  const ico = (d, size = 16) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true'); s.innerHTML = d; s.classList.add('bi'); return s; };
  const IC = {
    projet: '<path d="M4 7h16v12H4z"/><path d="M9 7V5h6v2"/>',
    tâche: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
    personne: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    idée: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    réunion: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    ressource: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4"/>',
    capture: '<path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3"/><circle cx="12" cy="12" r="3"/>',
    journal: '<path d="M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6z"/><path d="M9 7h6M9 11h6"/>',
    fiche: '<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    note: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>',
    connecteur: '<circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>', trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><path d="M8 7.5l8 0.8M7 8.3l1.6 7.4M16.5 10l-6 6.3"/>',
    table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9 9.5v10"/>',
    home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>', send: '<path d="M4 12h14M13 6l6 6-6 6"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
  };
  const TYPE_LABEL = { projet: 'Projet', tâche: 'Tâche', personne: 'Personne', idée: 'Idée', réunion: 'Réunion', ressource: 'Ressource', capture: 'Capture', journal: 'Journal', fiche: 'Fiche', note: 'Note', connecteur: 'Connecteur' };
  // Couleurs des types (lisibles en clair et en sombre).
  const TYPE_COLOR = { projet: '#E3833F', tâche: '#4CB782', personne: '#C46BD6', idée: '#E6C04A', réunion: '#4F9DDE', ressource: '#8E9BAA', capture: '#E0607E', journal: '#5BB8B0', fiche: '#9C8CE0', note: '#7AA2C8', connecteur: '#F2F2F2' };

  const S = { tree: null, path: null, note: null, mode: 'accueil', edit: false, dirty: false, saveT: 0, dbType: 'projet', dbView: 'table', sources: new Set(), guessed: true, typesOff: new Set(), graph: null, open: false, sideOpen: false };

  // ---------------- Markdown → HTML (sûr : tout est échappé d'abord) ----------------
  function inline(t) {
    let h = esc(t);
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/~~([^~]+)~~/g, '<del>$1</del>').replace(/==([^=]+)==/g, '<mark>$1</mark>');
    h = h.replace(/!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target, label) => `<a href="#" class="wl" data-target="${target.trim()}">${(label || target).trim()}</a>`);
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    h = h.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    h = h.replace(/(^|\s)#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu, '$1<a href="#" class="tag" data-tag="$2">#$2</a>');
    return h;
  }
  function md(src) {
    const lines = String(src ?? '').replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0, task = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
      const h = /^(#{1,6})\s+(.*)$/.exec(l);
      if (h) { out.push(`<h${Math.min(6, h[1].length + 1)}>${inline(h[2])}</h${Math.min(6, h[1].length + 1)}>`); i++; continue; }
      if (/^\s*(---|\*\*\*)\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
      const co = /^>\s*\[!(\w+)\]\s*(.*)$/.exec(l);
      if (co) { const buf = []; i++; while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(`<div class="callout c-${esc(co[1].toLowerCase())}"><b>${inline(co[2] || co[1])}</b>${buf.length ? `<div>${md(buf.join('\n'))}</div>` : ''}</div>`); continue; }
      if (/^>/.test(l)) { const buf = []; while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${md(buf.join('\n'))}</blockquote>`); continue; }
      if (/^\|.*\|\s*$/.test(l) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
        const row = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = row(l); i += 2; const body = [];
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
        out.push(`<div class="tw"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (/^\s*([-*+]|\d+\.)\s+/.test(l)) {
        const ordered = /^\s*\d+\./.test(l), items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          const t = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
          const tk = /^\[( |x|X)\]\s*(.*)$/.exec(t);
          items.push(tk ? `<li class="task"><label><input type="checkbox" data-task="${task++}"${tk[1] !== ' ' ? ' checked' : ''}> <span>${inline(tk[2])}</span></label></li>` : `<li>${inline(t)}</li>`);
          i++;
        }
        out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
        continue;
      }
      if (!l.trim()) { i++; continue; }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s|\|)/.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
    return out.join('');
  }

  // ---------------- Structure de l'écran ----------------
  let root;
  function build() {
    root = $('#v-brain .body');
    root.replaceChildren();
    root.classList.add('br-body');
    const side = el('aside', { class: 'br-side', id: 'brSide', 'aria-label': 'Pages du Cerveau' },
      el('div', { class: 'br-sb' }, el('label', { class: 'br-search' }, ico(IC.search, 15), el('input', { id: 'brQ', type: 'search', placeholder: 'Chercher partout…', 'aria-label': 'Chercher dans le Cerveau', autocomplete: 'off', oninput: debounce(onSearch, 200) }))),
      el('div', { class: 'br-nav' },
        navBtn('accueil', IC.home, 'Accueil'),
        navBtn('journal', IC.journal, 'Journal du jour'),
        navBtn('graphe', IC.graph, 'Graphe'),
      ),
      el('div', { id: 'brResults', class: 'br-results', hidden: true }),
      el('div', { class: 'br-sec' }, el('div', { class: 'br-h' }, 'Bases'), el('div', { id: 'brBases' })),
      el('div', { class: 'br-sec' }, el('div', { class: 'br-h' }, el('span', {}, 'Pages'), el('button', { class: 'br-mini', type: 'button', title: 'Nouvelle page', 'aria-label': 'Nouvelle page', onclick: () => newPage('note') }, ico(IC.plus, 14))), el('div', { id: 'brTree', class: 'br-tree' })),
      el('div', { class: 'br-sec' }, el('details', { class: 'br-trash' }, el('summary', {}, ico(IC.trash, 14), ' Corbeille'), el('div', { id: 'brTrash' }))),
    );
    const main = el('div', { class: 'br-main', id: 'brMain' });
    const aside = el('aside', { class: 'br-aside', id: 'brAside', 'aria-label': 'Liens et questions' },
      el('section', { class: 'br-ask' },
        el('h2', {}, 'Demander au cerveau'),
        el('form', { onsubmit: onAsk }, el('textarea', { id: 'brAskQ', rows: '3', placeholder: 'Ex. : où en est mon projet de boutique ? qu\'ai-je décidé pour les prix ?', 'aria-label': 'Question au cerveau' }), el('button', { class: 'btn', type: 'submit' }, ico(IC.send, 15), ' Demander')),
        el('div', { id: 'brAnswer', 'aria-live': 'polite' })),
      el('div', { id: 'brLinks' }),
    );
    root.append(el('div', { class: 'br' }, side, main, aside));
  }
  function navBtn(mode, icon, label) { return el('button', { type: 'button', class: 'br-item', 'data-mode': mode, onclick: () => (mode === 'journal' ? openDaily() : setMode(mode)) }, ico(icon), el('span', {}, label)); }
  function debounce(f, ms) { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; }

  async function refresh() {
    const r = await api('/api/brain/tree');
    if (!r.ok) return;
    S.tree = r;
    renderSide();
    if (S.mode === 'accueil') renderHome();
  }

  function renderSide() {
    const t = S.tree;
    const count = {}; for (const n of t.notes) count[n.type] = (count[n.type] || 0) + 1;
    $('#brBases').replaceChildren(...['projet', 'tâche', 'personne', 'idée', 'réunion', 'capture', 'ressource', 'fiche'].map((ty) => el('button', { type: 'button', class: `br-item${S.mode === 'base' && S.dbType === ty ? ' on' : ''}`, onclick: () => { S.dbType = ty; setMode('base'); } }, ico(IC[ty]), el('span', {}, t.types[ty]?.label || ty), el('span', { class: 'br-n' }, String(count[ty] || 0)))));
    // Arbre des dossiers (repliables), comme un coffre de notes.
    const folders = {};
    for (const n of t.notes) { const f = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : ''; (folders[f] = folders[f] || []).push(n); }
    const names = Object.keys(folders).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'fr')));
    $('#brTree').replaceChildren(...names.map((f) => {
      const items = folders[f].sort((a, b) => (f === 'Journal' ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title, 'fr'))).map((n) => el('button', { type: 'button', class: `br-item br-page${S.path === n.path ? ' on' : ''}`, 'data-path': n.path, title: n.path, onclick: () => openNote(n.path) }, ico(IC[n.type] || IC.note, 14), el('span', {}, n.title)));
      if (!f) return el('div', {}, ...items);
      const d = el('details', { class: 'br-folder', open: f !== 'Journal' && f !== 'Captures' ? true : undefined }, el('summary', {}, el('span', {}, f), el('span', { class: 'br-n' }, String(items.length))), ...items);
      return d;
    }));
    $('#brTrash').replaceChildren(...(t.trash.length ? t.trash.map((f) => el('div', { class: 'br-tr' }, el('span', {}, f.replace(/^\d+-/, '').replace(/\.md$/, '')), el('button', { class: 'br-mini', type: 'button', onclick: async () => { const r = await api('/api/brain/restore', { file: f }); if (r.ok) { await refresh(); openNote(r.path); } } }, 'Restaurer'))) : [el('div', { class: 'br-muted' }, 'Vide')]));
    for (const b of document.querySelectorAll('.br-nav .br-item')) b.classList.toggle('on', b.dataset.mode === S.mode);
  }

  async function onSearch() {
    const q = $('#brQ').value.trim(), box = $('#brResults');
    if (!q) { box.hidden = true; return; }
    const r = await api(`/api/brain/search?q=${encodeURIComponent(q)}`);
    box.hidden = false;
    box.replaceChildren(el('div', { class: 'br-h' }, `${r.results.length} résultat${r.results.length > 1 ? 's' : ''}`), ...r.results.map((x) => el('button', { type: 'button', class: 'br-res', onclick: () => openNote(x.path) }, el('b', {}, x.title), el('span', {}, x.snippet))));
  }

  function setMode(m) {
    if (S.dirty) saveNow();
    S.mode = m;
    if (m !== 'page') S.path = null;
    stopGraph();
    if (m === 'accueil') renderHome();
    if (m === 'graphe') renderGraph();
    if (m === 'base') renderBase();
    if (S.tree) renderSide();
    closeSide();
    if (m !== 'page') renderLinks(null);
  }

  // ---------------- Accueil : comment fonctionne ton cerveau (schéma vivant) ----------------
  function renderHome() {
    const t = S.tree; if (!t) return;
    const s = t.stats;
    const steps = [
      { n: '1', t: 'Capturer', d: 'Liens, vidéos, documents, vocaux, idées', v: `${s.captures} capture${s.captures > 1 ? 's' : ''}` },
      { n: '2', t: 'Relier', d: 'Liens écrits et liens trouvés tout seuls', v: `${s.links + s.guessed} lien${s.links + s.guessed > 1 ? 's' : ''}` },
      { n: '3', t: 'Retrouver', d: 'Recherche en langage naturel', v: `${s.notes} note${s.notes > 1 ? 's' : ''}` },
      { n: '4', t: 'Raisonner', d: 'Réponses tirées de tes notes, sources montrées', v: `${s.tags} sujet${s.tags > 1 ? 's' : ''}` },
      { n: '5', t: 'Agir', d: 'Organiser, rédiger, planifier, rappeler', v: `${s.projects} projet${s.projects > 1 ? 's' : ''}` },
    ];
    const recent = [...t.notes].sort((a, b) => b.mtime - a.mtime).slice(0, 8);
    const main = $('#brMain');
    main.replaceChildren(
      el('div', { class: 'br-page-in' },
        el('h1', { class: 'br-title' }, 'Ton deuxième cerveau'),
        el('p', { class: 'br-lead' }, 'Tout ce que tu confies à Odin arrive ici, se relie tout seul, et sert à te répondre et à agir. Tes notes sont des fichiers Markdown : le dossier s\'ouvre aussi dans Obsidian.'),
        el('form', { class: 'br-capture', onsubmit: onCapture },
          el('label', { for: 'brCap', class: 'sr' }, 'Capturer'),
          el('input', { id: 'brCap', placeholder: 'Colle un lien (YouTube, TikTok, article…), un chemin de fichier, ou écris une idée', autocomplete: 'off' }),
          el('button', { class: 'btn', type: 'submit' }, ico(IC.capture, 15), ' Capturer')),
        el('div', { id: 'brCapState', class: 'br-muted', 'aria-live': 'polite' }),
        el('figure', { class: 'br-flow', 'aria-label': 'Comment fonctionne ton cerveau' },
          el('ol', { class: 'br-steps' }, ...steps.map((x, k) => el('li', { class: 'br-step', style: `--d:${k * 90}ms` }, el('span', { class: 'br-sn' }, x.n), el('b', {}, x.t), el('span', { class: 'br-sd' }, x.d), el('span', { class: 'br-sv' }, x.v)))),
          el('figcaption', {}, 'Comment fonctionne ton cerveau : chaque étape tourne en continu, avec les chiffres de ton coffre.')),
        el('h2', { class: 'br-h2' }, 'Connecteurs'),
        el('p', { class: 'br-muted' }, 'Ce qui alimente ton cerveau. Chaque capture reste reliée à sa source dans le graphe.'),
        el('div', { class: 'br-conn' }, ...t.connectors.map((c) => el('div', { class: `br-cn${c.on ? ' on' : ''}` }, el('span', { class: 'br-dot', 'aria-hidden': 'true' }), el('b', {}, c.label), el('span', {}, c.what), el('span', { class: 'br-cc' }, c.on ? `${c.notes} note${c.notes > 1 ? 's' : ''}` : 'non relié')))),
        el('h2', { class: 'br-h2' }, 'Récemment'),
        el('div', { class: 'br-cards' }, ...recent.map((n) => el('button', { type: 'button', class: 'br-card', onclick: () => openNote(n.path) }, el('span', { class: 'br-ct' }, ico(IC[n.type] || IC.note, 14), TYPE_LABEL[n.type] || 'Note'), el('b', {}, n.title), el('span', { class: 'br-muted' }, new Date(n.mtime).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))))),
      ),
    );
  }

  async function onCapture(e) {
    e.preventDefault();
    const v = $('#brCap').value.trim(); if (!v) return;
    const st = $('#brCapState'); st.textContent = 'Odin lit, résume et range…'; $('#brCap').value = '';
    const r = await api('/api/brain/capture', { source: v });
    st.textContent = r.ok ? r.text.split('\n')[0] : `✗ ${r.error}`;
    await refresh();
  }

  // ---------------- Page : titre, propriétés, contenu (lire / écrire) ----------------
  async function openNote(path) {
    if (S.dirty) await saveNow();
    const r = await api(`/api/brain/note?path=${encodeURIComponent(path)}`);
    if (!r.ok) return;
    S.mode = 'page'; S.path = r.note.path; S.note = r.note; S.edit = false;
    stopGraph();
    renderPage(r); renderLinks(r); renderSide(); closeSide();
  }
  async function openDaily() { const r = await api('/api/brain/daily', {}); await refresh(); openNote(r.path); }
  async function newPage(type) {
    const r = await api('/api/brain/create', { title: type === 'note' ? 'Sans titre' : `${TYPE_LABEL[type] || 'Note'} sans titre`, type });
    if (!r.ok) return;
    await refresh(); await openNote(r.path); S.edit = true; renderPage(await api(`/api/brain/note?path=${encodeURIComponent(r.path)}`)); setTimeout(() => { const t = $('#brTitle'); t.focus(); t.select(); }, 30);
  }

  function renderPage(r) {
    const n = r.note, meta = { ...n.meta };
    const type = String(meta.type || (n.path.startsWith('Journal/') ? 'journal' : 'note'));
    const props = Object.entries(meta).filter(([k]) => !['type', 'titre', 'title'].includes(k));
    const def = S.tree?.types?.[type];
    const main = $('#brMain');
    const title = el('input', { id: 'brTitle', class: 'br-ti', value: n.title, 'aria-label': 'Titre de la page', onchange: onRename });
    const propRows = el('div', { class: 'br-props', role: 'group', 'aria-label': 'Propriétés' },
      el('div', { class: 'br-prop' }, el('span', { class: 'br-pk' }, 'Type'), el('span', {}, el('select', { 'aria-label': 'Type', onchange: (e) => { setProp('type', e.target.value === 'note' ? undefined : e.target.value); } }, ...Object.keys(S.tree?.types || {}).map((k) => el('option', { value: k, selected: k === type ? true : undefined }, TYPE_LABEL[k] || k))))),
      ...props.map(([k, v]) => el('div', { class: 'br-prop' }, el('span', { class: 'br-pk' }, k),
        el('span', {}, k === 'statut' && def?.statuses ? el('select', { 'aria-label': k, onchange: (e) => setProp(k, e.target.value) }, ...def.statuses.map((x) => el('option', { selected: x === v ? true : undefined }, x)))
          : el('input', { value: Array.isArray(v) ? v.join(', ') : String(v), 'aria-label': k, onchange: (e) => setProp(k, Array.isArray(v) ? e.target.value.split(',').map((x) => x.trim()).filter(Boolean) : e.target.value) })))),
      el('div', { class: 'br-prop add' }, el('button', { type: 'button', class: 'br-mini', onclick: () => { const k = (window.prompt('Nom de la propriété (ex. échéance, statut, lien) :') || '').trim(); if (k) setProp(k, ''); } }, ico(IC.plus, 13), ' Propriété')),
    );
    const bar = el('div', { class: 'br-bar' },
      el('div', { class: 'seg', role: 'group', 'aria-label': 'Mode' }, el('button', { type: 'button', 'aria-pressed': String(!S.edit), onclick: () => { S.edit = false; renderPage({ ...r, note: S.note }); } }, 'Lire'), el('button', { type: 'button', 'aria-pressed': String(S.edit), onclick: () => { S.edit = true; renderPage({ ...r, note: S.note }); } }, 'Écrire')),
      el('span', { id: 'brSaved', class: 'br-muted', 'aria-live': 'polite' }, ''),
      el('span', { style: 'flex:1' }),
      el('button', { type: 'button', class: 'br-mini', title: 'Voir dans le graphe', onclick: () => { S.focus = n.path; setMode('graphe'); } }, ico(IC.graph, 14), ' Graphe'),
      el('button', { type: 'button', class: 'br-mini', title: meta.favori ? 'Retirer des favoris' : 'Mettre en favori', 'aria-pressed': String(meta.favori === true), onclick: () => setProp('favori', meta.favori === true ? undefined : true) }, ico(IC.star, 14)),
      el('button', { type: 'button', class: 'br-mini danger', title: 'Mettre à la corbeille', onclick: async () => { if (!(await confirmBox('Mettre cette page à la corbeille ? (restaurable)'))) return; await api('/api/brain/trash', { path: n.path }); await refresh(); setMode('accueil'); } }, ico(IC.trash, 14)),
    );
    let content;
    if (S.edit) {
      const ta = el('textarea', { id: 'brEd', class: 'br-ed', 'aria-label': 'Contenu (Markdown)', spellcheck: 'true', oninput: onType, onkeydown: onKey }, '');
      ta.value = n.body;
      content = el('div', { class: 'br-edw' }, ta, el('div', { id: 'brMenu', class: 'br-menu', role: 'listbox', hidden: true }), el('div', { class: 'br-hint br-muted' }, 'Tape / pour insérer un bloc, [[ pour relier une page, # pour une étiquette. Enregistré tout seul.'));
      setTimeout(() => autoGrow(ta), 0);
    } else {
      content = el('article', { class: 'br-doc', html: md(n.body) || '<p class="br-muted">Page vide. Passe en « Écrire » pour commencer.</p>' });
      content.addEventListener('click', onDocClick);
      content.addEventListener('change', onTaskToggle);
    }
    main.replaceChildren(el('div', { class: 'br-page-in' }, el('div', { class: 'br-crumb br-muted' }, n.path.replace(/\.md$/, '').split('/').join(' / ')), title, propRows, bar, content));
  }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = `${Math.max(320, ta.scrollHeight + 8)}px`; }
  function onType(e) { S.note.body = e.target.value; autoGrow(e.target); scheduleSave(); slashMenu(e.target); }
  function scheduleSave() { S.dirty = true; $('#brSaved') && ($('#brSaved').textContent = 'Modifié…'); clearTimeout(S.saveT); S.saveT = setTimeout(saveNow, 900); }
  async function saveNow() {
    if (!S.note || !S.dirty) return;
    S.dirty = false; clearTimeout(S.saveT);
    const r = await api('/api/brain/save', { path: S.note.path, meta: S.note.meta, body: S.note.body });
    if ($('#brSaved')) $('#brSaved').textContent = r.ok ? `Enregistré à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : `✗ ${r.error}`;
  }
  async function setProp(k, v) {
    if (!S.note) return;
    if (v === undefined) delete S.note.meta[k]; else S.note.meta[k] = v;
    S.dirty = true; await saveNow(); await refresh(); openNote(S.note.path);
  }
  async function onRename(e) {
    const t = e.target.value.trim(); if (!t || t === S.note.title) return;
    const dir = S.note.path.includes('/') ? S.note.path.slice(0, S.note.path.lastIndexOf('/') + 1) : '';
    const r = await api('/api/brain/rename', { path: S.note.path, to: `${dir}${t.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim()}` });
    if (!r.ok) { e.target.value = S.note.title; return alertBox(r.error); }
    await refresh(); openNote(r.path.replace(/ \(liens mis à jour.*$/, ''));
  }
  function onDocClick(e) {
    const a = e.target.closest('a.wl, a.tag');
    if (!a) return;
    e.preventDefault();
    if (a.classList.contains('tag')) { $('#brQ').value = `#${a.dataset.tag}`.replace('#', ''); onSearch(); openSide(); return; }
    const hit = S.tree.notes.find((n) => n.title.toLowerCase() === a.dataset.target.toLowerCase() || n.path.replace(/\.md$/, '').toLowerCase().endsWith(a.dataset.target.toLowerCase()));
    if (hit) openNote(hit.path);
    else confirmBox(`« ${a.dataset.target} » n'existe pas encore. La créer ?`).then(async (ok) => { if (!ok) return; const r = await api('/api/brain/create', { title: a.dataset.target, type: 'note' }); await refresh(); openNote(r.path); });
  }
  function onTaskToggle(e) {
    const cb = e.target.closest('input[data-task]'); if (!cb) return;
    let k = -1;
    S.note.body = S.note.body.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[( |x|X)\]/gm, (m, p, c) => (++k === Number(cb.dataset.task) ? `${p}[${cb.checked ? 'x' : ' '}]` : m));
    S.dirty = true; saveNow();
  }

  // Menu « / » (blocs) et « [[ » (pages)
  const BLOCKS = [
    ['Titre', '## '], ['Sous-titre', '### '], ['Liste', '- '], ['Liste numérotée', '1. '], ['Case à cocher', '- [ ] '], ['Citation', '> '], ['Encadré info', '> [!info] '], ['Encadré attention', '> [!warning] '],
    ['Code', '```\n\n```'], ['Tableau', '| Colonne | Colonne |\n| --- | --- |\n|  |  |'], ['Séparateur', '---\n'], ['Lien vers une page', '[['], ['Date du jour', () => new Date().toLocaleDateString('fr-FR')], ['Décision (projet)', () => `- ${new Date().toISOString().slice(0, 10)} · Décision : `],
  ];
  let menu = { items: [], at: 0, start: 0, kind: '' };
  function slashMenu(ta) {
    const pos = ta.selectionStart, before = ta.value.slice(0, pos);
    const sl = /(^|\n)\/([\p{L} ]{0,20})$/u.exec(before), wl = /\[\[([^\]\n]{0,40})$/.exec(before);
    const box = $('#brMenu');
    if (sl) {
      const q = sl[2].toLowerCase();
      menu = { kind: '/', start: pos - sl[2].length - 1, items: BLOCKS.filter(([n]) => n.toLowerCase().includes(q)), at: 0 };
    } else if (wl) {
      const q = wl[1].toLowerCase();
      menu = { kind: '[[', start: pos - wl[1].length, items: S.tree.notes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8).map((n) => [n.title, `${n.title}]]`]), at: 0 };
      if (wl[1] && !menu.items.some(([n]) => n.toLowerCase() === q)) menu.items.push([`Créer « ${wl[1]} »`, `${wl[1]}]]`]);
    } else { box.hidden = true; return; }
    if (!menu.items.length) { box.hidden = true; return; }
    box.hidden = false;
    box.replaceChildren(...menu.items.map(([n], k) => el('div', { role: 'option', class: `br-mi${k === menu.at ? ' on' : ''}`, 'aria-selected': String(k === menu.at), onmousedown: (e) => { e.preventDefault(); pick(ta, k); } }, n)));
  }
  function pick(ta, k) {
    const [, ins] = menu.items[k]; const text = typeof ins === 'function' ? ins() : ins;
    const pos = ta.selectionStart;
    ta.value = ta.value.slice(0, menu.start) + text + ta.value.slice(pos);
    const caret = menu.start + (text.includes('\n\n```') ? 4 : text.length);
    ta.setSelectionRange(caret, caret); ta.focus();
    $('#brMenu').hidden = true;
    onType({ target: ta });
  }
  function onKey(e) {
    const box = $('#brMenu');
    if (box && !box.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); menu.at = (menu.at + (e.key === 'ArrowDown' ? 1 : -1) + menu.items.length) % menu.items.length; slashMenuRender(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(e.target, menu.at); return; }
      if (e.key === 'Escape') { e.preventDefault(); box.hidden = true; return; }
    }
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNow(); }
  }
  function slashMenuRender() { [...$('#brMenu').children].forEach((c, k) => { c.classList.toggle('on', k === menu.at); c.setAttribute('aria-selected', String(k === menu.at)); }); }

  // ---------------- Panneau de droite : liens, rétroliens, mentions ----------------
  function renderLinks(r) {
    const box = $('#brLinks'); if (!box) return;
    if (!r) { box.replaceChildren(); return; }
    const list = (items, empty, act) => (items.length ? el('ul', { class: 'br-ll' }, ...items.map((x) => el('li', {}, el('button', { type: 'button', class: 'br-ln', onclick: () => x.path && openNote(x.path) }, ico(IC.link, 13), x.title || x.target, x.path ? null : el('span', { class: 'br-muted' }, ' (à créer)')), act ? act(x) : null))) : el('p', { class: 'br-muted' }, empty));
    box.replaceChildren(
      el('section', {}, el('h2', {}, `Rétroliens · ${r.backlinks.length}`), list(r.backlinks, 'Aucune page ne renvoie ici.')),
      el('section', {}, el('h2', {}, `Liens · ${r.links.length}`), list(r.links, 'Aucun lien. Écris [[ pour en ajouter.')),
      r.mentions.length ? el('section', {}, el('h2', {}, `En parlent sans lien · ${r.mentions.length}`), list(r.mentions, '', (x) => el('button', { type: 'button', class: 'br-mini', onclick: () => linkMention(x.path) }, 'Relier'))) : null,
    );
  }
  async function linkMention(path) {
    const r = await api(`/api/brain/note?path=${encodeURIComponent(path)}`);
    if (!r.ok) return;
    const t = S.note.title, re = new RegExp(`(^|[^\\p{L}\\[])(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^\\p{L}\\]])`, 'iu');
    const body = r.note.body.replace(re, (m, a, b) => `${a}[[${t}${b !== t ? `|${b}` : ''}]]`);
    await api('/api/brain/save', { path, meta: r.note.meta, body });
    openNote(S.note.path);
  }

  // ---------------- Demander au cerveau (sources illuminées dans le graphe) ----------------
  async function onAsk(e) {
    e.preventDefault();
    const q = $('#brAskQ').value.trim(); if (!q) return;
    const box = $('#brAnswer');
    box.replaceChildren(el('p', { class: 'br-muted' }, 'Odin cherche dans tes notes…'));
    const r = await api('/api/brain/ask', { question: q, note: S.note?.title });
    if (!r.ok) { box.replaceChildren(el('p', { class: 'br-bad' }, `✗ ${r.error}`)); return; }
    S.sources = new Set(r.sources.map((x) => x.path));
    const ans = el('div', { class: 'br-doc br-ans', html: md(r.text) });
    ans.addEventListener('click', onDocClick);
    box.replaceChildren(ans,
      r.sources.length ? el('div', { class: 'br-src' }, el('span', { class: 'br-muted' }, 'Sources : '), ...r.sources.map((x) => el('button', { type: 'button', class: 'br-chip', onclick: () => openNote(x.path) }, x.title)), el('button', { type: 'button', class: 'br-mini', onclick: () => setMode('graphe') }, ico(IC.graph, 13), ' Voir dans le graphe')) : null,
      r.answeredBy ? el('div', { class: 'br-muted br-by' }, r.answeredBy) : null);
    if (S.mode === 'graphe') renderGraph();
  }

  // ---------------- Base : table ou tableau par statut ----------------
  async function renderBase() {
    const r = await api(`/api/brain/db?type=${encodeURIComponent(S.dbType)}`);
    const def = r.def || { props: [], label: S.dbType };
    const cols = [...new Set([...(def.props || []), ...r.rows.flatMap((x) => Object.keys(x.meta))])].filter((k) => !['type', 'titre', 'title', 'créé', 'tags'].includes(k)).slice(0, 6);
    const head = el('div', { class: 'br-bar' },
      el('h1', { class: 'br-title', style: 'margin:0;flex:1' }, def.label),
      def.statuses ? el('div', { class: 'seg', role: 'group', 'aria-label': 'Vue' }, ...[['table', 'Table'], ['tableau', 'Tableau']].map(([v, l]) => el('button', { type: 'button', 'aria-pressed': String(S.dbView === v), onclick: () => { S.dbView = v; renderBase(); } }, l))) : null,
      el('button', { type: 'button', class: 'btn', onclick: () => newPage(S.dbType) }, ico(IC.plus, 15), ' Nouveau'));
    let view;
    if (S.dbView === 'tableau' && def.statuses) {
      view = el('div', { class: 'br-board' }, ...def.statuses.map((st) => {
        const items = r.rows.filter((x) => (x.meta.statut || def.statuses[0]) === st);
        const col = el('section', { class: 'br-col', 'data-st': st }, el('h2', {}, st, el('span', { class: 'br-n' }, String(items.length))), ...items.map((x) => el('button', { type: 'button', class: 'br-card', draggable: 'true', 'data-path': x.path, onclick: () => openNote(x.path), ondragstart: (e) => e.dataTransfer.setData('text/plain', x.path) }, el('b', {}, x.title), x.meta.échéance ? el('span', { class: 'br-muted' }, `Échéance : ${x.meta.échéance}`) : null)));
        col.addEventListener('dragover', (e) => e.preventDefault());
        col.addEventListener('drop', async (e) => { e.preventDefault(); const p = e.dataTransfer.getData('text/plain'); const n = await api(`/api/brain/note?path=${encodeURIComponent(p)}`); if (!n.ok) return; await api('/api/brain/save', { path: p, meta: { ...n.note.meta, statut: st }, body: n.note.body }); renderBase(); });
        return col;
      }));
    } else {
      view = r.rows.length ? el('div', { class: 'wrap' }, el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, el('th', {}, 'Nom'), ...cols.map((c) => el('th', {}, c)), el('th', {}, 'Modifié'))),
        el('tbody', {}, ...r.rows.map((x) => el('tr', {}, el('td', {}, el('button', { type: 'button', class: 'br-ln', onclick: () => openNote(x.path) }, x.title)), ...cols.map((c) => el('td', {}, Array.isArray(x.meta[c]) ? x.meta[c].join(', ') : String(x.meta[c] ?? ''))), el('td', { class: 'br-muted' }, new Date(x.mtime).toLocaleDateString('fr-FR'))))))) : el('p', { class: 'br-muted' }, `Aucune entrée. « Nouveau » en crée une, ou dis à Odin : « ajoute ${TYPE_LABEL[S.dbType]?.toLowerCase() || ''} … ».`);
    }
    $('#brMain').replaceChildren(el('div', { class: 'br-page-in wide' }, head, view));
    renderSide();
  }

  // ---------------- Graphe des connaissances ----------------
  let raf = 0;
  function stopGraph() { cancelAnimationFrame(raf); raf = 0; }
  async function renderGraph() {
    stopGraph();
    const r = await api('/api/brain/graph');
    const types = [...new Set(r.nodes.map((n) => n.type))];
    const main = $('#brMain');
    const cv = el('canvas', { id: 'brCv', class: 'br-cv', role: 'img', 'aria-label': `Graphe : ${r.nodes.length} éléments, ${r.edges.length} liens. La liste ci-dessous donne le même contenu.` });
    const legend = el('div', { class: 'br-legend', role: 'group', 'aria-label': 'Filtrer par type' }, ...types.map((t) => el('button', { type: 'button', class: 'br-chip', 'aria-pressed': String(!S.typesOff.has(t)), onclick: () => { S.typesOff.has(t) ? S.typesOff.delete(t) : S.typesOff.add(t); renderGraph(); } }, el('span', { class: 'br-sw', style: `background:${TYPE_COLOR[t] || '#888'}` }), TYPE_LABEL[t] || t)),
      el('label', { class: 'br-chk' }, el('input', { type: 'checkbox', checked: S.guessed ? true : undefined, onchange: (e) => { S.guessed = e.target.checked; renderGraph(); } }), ' Liens devinés'));
    const listAlt = el('details', { class: 'br-alt' }, el('summary', {}, 'Voir le graphe en liste'), el('ul', {}, ...r.nodes.filter((n) => n.type !== 'connecteur').sort((a, b) => b.degree - a.degree).slice(0, 200).map((n) => el('li', {}, el('button', { type: 'button', class: 'br-ln', onclick: () => openNote(n.id) }, n.title), el('span', { class: 'br-muted' }, ` · ${TYPE_LABEL[n.type] || n.type} · ${n.degree} lien${n.degree > 1 ? 's' : ''}`)))));
    main.replaceChildren(el('div', { class: 'br-gw' }, el('div', { class: 'br-bar' }, el('h1', { class: 'br-title', style: 'margin:0;flex:1' }, 'Graphe'), el('span', { class: 'br-muted' }, `${r.nodes.length} éléments · ${r.edges.length} liens`)), legend, el('div', { class: 'br-cvw' }, cv, el('div', { id: 'brTip', class: 'br-tip', hidden: true })), listAlt));
    drawGraph(cv, r);
  }

  function drawGraph(cv, data) {
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim() || '#ddd', line = css.getPropertyValue('--line').trim() || '#444', accent = css.getPropertyValue('--accent').trim() || '#fa0';
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 800, H = cv.clientHeight || 520;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    let nodes = data.nodes.filter((n) => !S.typesOff.has(n.type));
    // Très grands coffres : on garde les 600 plus reliés (le reste est dans la liste).
    if (nodes.length > 600) nodes = nodes.sort((a, b) => b.degree - a.degree).slice(0, 600);
    const keep = new Set(nodes.map((n) => n.id));
    const edges = data.edges.filter((e) => keep.has(e.from) && keep.has(e.to) && (S.guessed || e.kind === 'lien' || e.kind === 'source'));
    const byId = new Map();
    nodes.forEach((n, k) => { const a = (k / nodes.length) * Math.PI * 2, rr = 80 + Math.random() * Math.min(W, H) * 0.35; byId.set(n.id, Object.assign(n, { x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: 0, vy: 0, r: n.type === 'connecteur' ? 9 : 4 + Math.min(10, Math.sqrt(n.degree) * 2.2) })); });
    const nb = new Map(); for (const e of edges) { (nb.get(e.from) || nb.set(e.from, new Set()).get(e.from)).add(e.to); (nb.get(e.to) || nb.set(e.to, new Set()).get(e.to)).add(e.from); }
    const view = { x: W / 2, y: H / 2, k: 1 };
    const few = byId.size <= 80; // petit coffre : tous les noms affichés
    let fitted = false;
    // Cadrage : tout le graphe tient dans la fenêtre une fois posé.
    function fit() {
      const arr = [...byId.values()]; if (!arr.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of arr) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r + 16); }
      const k = Math.min(2.2, Math.max(0.25, Math.min((W - 80) / Math.max(1, x1 - x0), (H - 80) / Math.max(1, y1 - y0))));
      view.k = k; view.x = W / 2 - ((x0 + x1) / 2) * k; view.y = H / 2 - ((y0 + y1) / 2) * k;
    }
    let hover = null, drag = null, pan = null, alpha = 1;
    const focus = S.focus; S.focus = null;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function tick() {
      const arr = [...byId.values()];
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j]; let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 90000) continue;
        const f = (900 / d2) * alpha; dx *= f; dy *= f; a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
      }
      for (const e of edges) { const a = byId.get(e.from), b = byId.get(e.to); const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1; const want = e.kind === 'lien' ? 70 : 110, f = ((d - want) / d) * 0.04 * alpha; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f; }
      for (const n of arr) { if (n === drag) continue; n.vx -= n.x * 0.012 * alpha; n.vy -= n.y * 0.012 * alpha; n.x += n.vx; n.y += n.vy; n.vx *= 0.82; n.vy *= 0.82; }
      alpha *= 0.985;
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.k, view.k);
      const hi = hover ? nb.get(hover.id) || new Set() : null;
      for (const e of edges) {
        const a = byId.get(e.from), b = byId.get(e.to);
        const lit = (hover && (e.from === hover.id || e.to === hover.id)) || (S.sources.has(e.from) && S.sources.has(e.to));
        ctx.strokeStyle = lit ? accent : e.kind === 'lien' ? ink : line; ctx.globalAlpha = hover && !lit ? 0.12 : lit ? 0.95 : e.kind === 'lien' ? 0.45 : 0.75;
        ctx.lineWidth = (lit ? 2.2 : e.kind === 'lien' ? 1.4 : 1.1) / view.k;
        ctx.setLineDash(e.kind === 'lien' ? [] : e.kind === 'source' ? [2 / view.k, 3 / view.k] : [5 / view.k, 4 / view.k]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const n of byId.values()) {
        const dim = hover && n !== hover && !hi.has(n.id);
        const src = S.sources.has(n.id) || n.id === focus;
        ctx.globalAlpha = dim ? 0.2 : 1;
        if (src) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 7, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.globalAlpha = dim ? 0.1 : 0.28; ctx.fill(); ctx.globalAlpha = dim ? 0.2 : 1; }
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fillStyle = TYPE_COLOR[n.type] || '#888'; ctx.fill();
        if (n.type === 'connecteur') { ctx.lineWidth = 2 / view.k; ctx.strokeStyle = accent; ctx.stroke(); }
        if (n === hover || src || few || n.degree >= 3 || view.k > 1.6 || n.type === 'connecteur') {
          ctx.fillStyle = ink; ctx.font = `${(n.type === 'connecteur' ? 12 : 11) / view.k}px IBM Plex Sans, system-ui, sans-serif`; ctx.textAlign = 'center';
          ctx.fillText(n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title, n.x, n.y + n.r + 12 / view.k);
        }
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    function loop() {
      if (alpha > 0.02 && !reduce) tick();
      if (!fitted && (alpha < 0.3 || reduce)) { fit(); fitted = true; }
      draw(); if (alpha > 0.02 || drag) raf = requestAnimationFrame(loop); else raf = 0;
    }
    // Pose rapide hors écran, puis animation douce du reste.
    for (let k = 0; k < (reduce ? 300 : 120); k++) tick();
    fit();
    loop();
    const at = (e) => { const b = cv.getBoundingClientRect(); const x = (e.clientX - b.left - view.x) / view.k, y = (e.clientY - b.top - view.y) / view.k; let best = null, bd = 1e9; for (const n of byId.values()) { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < (n.r + 6) ** 2 && d < bd) { best = n; bd = d; } } return { node: best, x, y }; };
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    cv.onpointermove = (e) => {
      if (drag) { const p = at(e); drag.x = p.x; drag.y = p.y; alpha = Math.max(alpha, 0.3); kick(); return; }
      if (pan) { view.x = pan.vx + e.clientX - pan.x; view.y = pan.vy + e.clientY - pan.y; draw(); return; }
      const h = at(e).node; if (h !== hover) { hover = h; cv.style.cursor = h ? 'pointer' : 'grab'; const tip = $('#brTip'); if (h) { tip.hidden = false; tip.textContent = `${h.title} · ${TYPE_LABEL[h.type] || h.type} · ${h.degree} lien${h.degree > 1 ? 's' : ''}`; } else tip.hidden = true; draw(); }
    };
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); const h = at(e).node; if (h) { drag = h; drag.moved = false; } else pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; };
    cv.onpointerup = (e) => { if (drag) { const n = drag; drag = null; if (!n.moved && n.type !== 'connecteur') openNote(n.id); } pan = null; };
    cv.addEventListener('pointermove', () => { if (drag) drag.moved = true; });
    cv.onwheel = (e) => { e.preventDefault(); const b = cv.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top, f = e.deltaY < 0 ? 1.12 : 1 / 1.12; view.x = mx - (mx - view.x) * f; view.y = my - (my - view.y) * f; view.k = Math.max(0.2, Math.min(4, view.k * f)); draw(); };
  }

  // ---------------- Petits éléments ----------------
  function confirmBox(msg) { return window.oqgAsk ? window.oqgAsk(msg) : Promise.resolve(window.confirm(msg)); }
  function alertBox(msg) { const st = $('#brSaved') || $('#brCapState'); if (st) st.textContent = `✗ ${msg}`; }
  function openSide() { S.sideOpen = true; $('#brSide')?.classList.add('open'); }
  function closeSide() { S.sideOpen = false; $('#brSide')?.classList.remove('open'); }

  window.OdinBrain = {
    async open() {
      if (!$('#v-brain .body')) return;
      if (!S.open) { build(); S.open = true; $('#brPages')?.addEventListener('click', () => (S.sideOpen ? closeSide() : openSide())); $('#brNew')?.addEventListener('click', () => newPage('note')); $('#brGraphBtn')?.addEventListener('click', () => setMode('graphe')); }
      await refresh();
      if (S.mode === 'page' && S.path) openNote(S.path); else if (S.mode === 'graphe') renderGraph(); else if (S.mode === 'base') renderBase(); else renderHome();
    },
    md,
  };
  // Changement d'écran ou d'onglet : ce qui est en cours d'écriture est enregistré.
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.dirty) saveNow(); });
  window.OdinBrain.leave = () => { if (S.dirty) saveNow(); stopGraph(); };
})();
