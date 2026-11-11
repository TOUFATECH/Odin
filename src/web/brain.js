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
  // Session expirée pendant l'usage : on revient à la page de connexion. Sur la page de connexion elle-même,
  // on ne recharge rien (sinon elle se rechargerait en boucle et effacerait ce que tu tapes).
  const appShown = () => { const a = document.querySelector('#app'); return Boolean(a && !a.hidden); };
  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
    if (r.status === 401) { if (appShown()) location.reload(); throw new Error('session expirée'); }
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
    document.querySelector('.br')?.classList.toggle('br-wide', m === 'graphe');
    if (m !== 'page') S.path = null;
    stopGraph();
    if (m === 'accueil') renderHome();
    if (m === 'graphe') renderGraph(true);
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
        el('div', { class: 'br-conn' }, ...t.connectors.map((c) => el('div', { class: `br-cn${c.state === 'actif' || (!c.state && c.on) ? ' on' : c.state === 'pret' ? ' ready' : ''}` }, el('span', { class: 'br-dot', 'aria-hidden': 'true' }), el('b', {}, c.label), el('span', {}, c.what), el('span', { class: 'br-cc' }, c.state === 'pret' ? `Prêt · ${c.how}` : c.state === 'actif' || (!c.state && c.on) ? `Actif · ${c.notes} note${c.notes > 1 ? 's' : ''}` : `Non relié · ${c.how || 'à régler'}`)))),
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
    document.querySelector('.br')?.classList.remove('br-wide');
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
  // Vue « constellation » : fond sombre, points discrets, les notes les plus reliées grossissent et
  // prennent la couleur de leur groupe, les noms apparaissent en zoomant ou au survol. Simulation de
  // forces (Barnes-Hut) : des milliers de notes restent fluides. Réglages à droite, retenus.
  let raf = 0;
  function stopGraph() { cancelAnimationFrame(raf); raf = 0; }
  const GDEF = { color: 'centres', folders: true, cards: true, intro: true, tags: false, connectors: true, orphans: true, guessed: true, nodeSize: 1, linkWidth: 1, labelAt: 1.1, arrows: false, center: 0.5, repel: 1, link: 1, distance: 1, light: false, q: '' };
  const GS = (() => { try { return { ...GDEF, ...JSON.parse(localStorage.getItem('odin.graphe') || '{}') }; } catch { return { ...GDEF }; } })();
  const saveGS = () => { try { localStorage.setItem('odin.graphe', JSON.stringify(GS)); } catch {} };
  let G = null; // { data, reheat, draw }

  async function renderGraph(intro = false) {
    stopGraph();
    const r = await api('/api/brain/graph');
    const main = $('#brMain');
    const cv = el('canvas', { id: 'brCv', class: 'br-cv', role: 'img', 'aria-label': `Graphe : ${r.nodes.length} éléments, ${r.edges.length} liens. La liste sous le graphe donne le même contenu.` });
    const wrap = el('div', { class: `br-cvw g-dark${GS.light ? ' g-light' : ''}` }, cv, el('div', { id: 'brTip', class: 'br-tip', hidden: true }), graphSettings(), el('div', { class: 'g-count' }, `${r.nodes.length} notes · ${r.edges.length} liens`));
    const listAlt = el('details', { class: 'br-alt' }, el('summary', {}, 'Voir le graphe en liste'), el('ul', {}, ...r.nodes.filter((n) => n.type !== 'connecteur').sort((a, b) => b.degree - a.degree).slice(0, 300).map((n) => el('li', {}, el('button', { type: 'button', class: 'br-ln', onclick: () => openNote(n.id) }, n.title), el('span', { class: 'br-muted' }, ` · ${TYPE_LABEL[n.type] || n.type} · ${n.degree} lien${n.degree > 1 ? 's' : ''}`)))));
    main.replaceChildren(el('div', { class: 'br-gw' }, wrap, listAlt));
    G = drawGraph(cv, r, intro && GS.intro);
  }

  function graphSettings() {
    const row = (label, input) => el('label', { class: 'g-row' }, el('span', {}, label), input);
    const tog = (k, label) => row(label, el('input', { type: 'checkbox', class: 'g-sw', checked: GS[k] ? true : undefined, onchange: (e) => { GS[k] = e.target.checked; saveGS(); renderGraph(); } }));
    const rng = (k, label, min, max, step, live) => row(label, el('input', { type: 'range', min, max, step, value: String(GS[k]), oninput: (e) => { GS[k] = Number(e.target.value); saveGS(); if (live) G?.reheat(); else G?.draw(); } }));
    const sec = (title, open, ...kids) => el('details', { class: 'g-sec', open: open ? true : undefined }, el('summary', {}, title), ...kids);
    const panel = el('div', { class: 'g-panel', id: 'gPanel', hidden: true },
      sec('Filtres', true,
        el('input', { type: 'search', class: 'g-q', placeholder: 'Chercher une note…', value: GS.q, 'aria-label': 'Mettre en évidence', oninput: (e) => { GS.q = e.target.value; G?.draw(); } }),
        tog('folders', 'Dossiers (liens vers leurs notes)'), tog('tags', 'Étiquettes'), tog('connectors', 'Connecteurs'), tog('orphans', 'Notes isolées'), tog('guessed', 'Liens devinés')),
      sec('Groupes', true, row('Couleurs', el('select', { onchange: (e) => { GS.color = e.target.value; saveGS(); G?.draw(); } }, ...[['centres', 'Centres en couleur'], ['type', 'Par type de note'], ['aucune', 'Sans couleur']].map(([v, l]) => el('option', { value: v, selected: GS.color === v ? true : undefined }, l)))),
        el('div', { class: 'g-legend' }, ...Object.entries(TYPE_LABEL).filter(([k]) => k !== 'connecteur').map(([k, l]) => el('span', {}, el('i', { style: `background:${TYPE_COLOR[k]}` }), l)))),
      sec('Affichage', false, rng('nodeSize', 'Taille des points', 0.4, 2.5, 0.1), rng('linkWidth', 'Épaisseur des liens', 0.3, 3, 0.1), rng('labelAt', 'Noms visibles dès le zoom', 0.3, 3, 0.1), tog('cards', 'Cartes en zoomant'), tog('intro', 'Animation d\'ouverture'), tog('arrows', 'Flèches'), tog('light', 'Fond clair')),
      sec('Forces', false, rng('center', 'Attraction du centre', 0, 1.5, 0.05, true), rng('repel', 'Répulsion', 0.2, 3, 0.1, true), rng('link', 'Force des liens', 0.1, 2.5, 0.1, true), rng('distance', 'Longueur des liens', 0.3, 3, 0.1, true)),
      el('div', { class: 'g-acts' }, el('button', { type: 'button', class: 'br-mini', onclick: () => renderGraph(true) }, 'Rejouer'), el('button', { type: 'button', class: 'br-mini', onclick: () => G?.reheat(1) }, 'Animer'), el('button', { type: 'button', class: 'br-mini', onclick: () => G?.fit() }, 'Recadrer'), el('button', { type: 'button', class: 'br-mini', onclick: () => { Object.assign(GS, GDEF); saveGS(); renderGraph(); } }, 'Par défaut')),
    );
    const btn = el('button', { type: 'button', class: 'g-gear', 'aria-label': 'Réglages du graphe', 'aria-expanded': 'false', 'aria-controls': 'gPanel', onclick: (e) => { panel.hidden = !panel.hidden; e.currentTarget.setAttribute('aria-expanded', String(!panel.hidden)); } }, ico('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', 18));
    return el('div', { class: 'g-tools' }, btn, panel);
  }

  /** Quadtree de Barnes-Hut : répulsion en O(n log n). */
  function quad(nodes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { if (n.x < x0) x0 = n.x; if (n.y < y0) y0 = n.y; if (n.x > x1) x1 = n.x; if (n.y > y1) y1 = n.y; }
    const size = Math.max(x1 - x0, y1 - y0) + 1;
    const rootQ = { x: x0, y: y0, s: size, m: 0, cx: 0, cy: 0, n: null, k: null };
    const insert = (q, n, depth) => {
      q.cx = (q.cx * q.m + n.x) / (q.m + 1); q.cy = (q.cy * q.m + n.y) / (q.m + 1); q.m++;
      if (!q.k && !q.n) { q.n = n; return; }
      if (depth > 30) return;
      if (!q.k) { q.k = [null, null, null, null]; const old = q.n; q.n = null; place(q, old, depth); }
      place(q, n, depth);
    };
    const place = (q, n, depth) => { const h = q.s / 2, i = (n.x >= q.x + h ? 1 : 0) + (n.y >= q.y + h ? 2 : 0); if (!q.k[i]) q.k[i] = { x: q.x + (i & 1 ? h : 0), y: q.y + (i & 2 ? h : 0), s: h, m: 0, cx: 0, cy: 0, n: null, k: null }; insert(q.k[i], n, depth + 1); };
    for (const n of nodes) insert(rootQ, n, 0);
    return rootQ;
  }
  function repulse(q, n, strength) {
    if (!q || !q.m || q.n === n) return;
    const dx = n.x - q.cx, dy = n.y - q.cy, d2 = dx * dx + dy * dy + 0.01;
    if (q.n || (q.s * q.s) / d2 < 0.81) { const f = (strength * q.m) / d2; n.vx += dx * f; n.vy += dy * f; return; }
    for (const c of q.k) repulse(c, n, strength);
  }

  function drawGraph(cv, data, intro = false) {
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 800, H = cv.clientHeight || 560;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const accent = '#4CC38A', hubColor = '#4CC38A';
    const PAL = GS.light ? { bg: '#F7F7F8', node: '#8B9099', link: 'rgba(60,64,72,.22)', linkHi: accent, text: '#2A2D33', dim: 0.12 } : { bg: '#1E1F22', node: '#A6A9AF', link: 'rgba(170,174,182,.22)', linkHi: accent, text: '#DADCE0', dim: 0.1 };
    // Données : notes (+ étiquettes en nœuds si demandé), filtres.
    let nodes = data.nodes.filter((n) => GS.connectors || n.type !== 'connecteur').map((n) => ({ ...n }));
    let edges = data.edges.filter((e) => GS.guessed || e.kind === 'lien' || e.kind === 'source');
    if (GS.tags) {
      const tags = new Map();
      for (const n of nodes) for (const t of n.tags || []) { if (!tags.has(t)) tags.set(t, { id: `#${t}`, title: `#${t}`, type: 'étiquette', tags: [], degree: 0 }); edges.push({ from: n.id, to: `#${t}`, kind: 'tag' }); }
      nodes = nodes.concat([...tags.values()]);
    }
    // Dossiers (comme Olmind) : chaque dossier devient un nœud relié à ses notes, et à son dossier parent.
    if (GS.folders) {
      const dirs = new Map(), count = new Map();
      for (const n of nodes) if (n.folder && n.type !== 'connecteur' && n.type !== 'étiquette') count.set(n.folder, (count.get(n.folder) || 0) + 1);
      const ensure = (f) => { if (dirs.has(f)) return; dirs.set(f, { id: `dossier:${f}`, title: f.split('/').pop(), type: 'dossier', tags: [], degree: 0, folder: f }); const up = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : ''; if (up) { ensure(up); edges.push({ from: `dossier:${f}`, to: `dossier:${up}`, kind: 'dossier' }); } };
      for (const [f, c] of count) if (c >= 2) ensure(f);
      for (const n of nodes) if (dirs.has(n.folder) && n.type !== 'connecteur' && n.type !== 'étiquette') edges.push({ from: n.id, to: `dossier:${n.folder}`, kind: 'dossier' });
      nodes = nodes.concat([...dirs.values()]);
    }
    const ids = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    const deg = new Map(); for (const e of edges) { deg.set(e.from, (deg.get(e.from) || 0) + 1); deg.set(e.to, (deg.get(e.to) || 0) + 1); }
    for (const n of nodes) n.degree = deg.get(n.id) || 0;
    if (!GS.orphans) nodes = nodes.filter((n) => n.degree > 0);
    if (nodes.length > 4000) nodes = nodes.sort((a, b) => b.degree - a.degree).slice(0, 4000);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    edges = edges.filter((e) => byId.has(e.from) && byId.has(e.to));
    const sorted = [...nodes].map((n) => n.degree).sort((a, b) => b - a);
    const hubMin = Math.max(4, sorted[Math.floor(sorted.length * 0.04)] || 4);
    // Positions de départ : en spirale (les plus reliés au centre).
    [...nodes].sort((a, b) => b.degree - a.degree).forEach((n, k) => { const a = k * 2.4, r = 12 * Math.sqrt(k + 1); n.x = Math.cos(a) * r; n.y = Math.sin(a) * r; n.vx = 0; n.vy = 0; });
    const nb = new Map(); for (const e of edges) { (nb.get(e.from) || nb.set(e.from, new Set()).get(e.from)).add(e.to); (nb.get(e.to) || nb.set(e.to, new Set()).get(e.to)).add(e.from); }
    for (const e of edges) { e.a = byId.get(e.from); e.b = byId.get(e.to); }
    const view = { x: W / 2, y: H / 2, k: 1 };
    let hover = null, drag = null, pan = null, alpha = 1, moved = false;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const radius = (n) => (n.type === 'connecteur' ? 6 : n.type === 'dossier' ? 5 + Math.sqrt(n.degree) * 0.9 : n.type === 'étiquette' ? 3 : 2.4 + Math.sqrt(n.degree) * 1.8) * GS.nodeSize;
    const FOLDER = '#3B8EEA';
    const colorOf = (n) => {
      if (n.type === 'connecteur') return '#E3AC3F';
      if (n.type === 'étiquette') return '#7F8AA3';
      if (n.type === 'dossier') return FOLDER;
      if (GS.color === 'type') return TYPE_COLOR[n.type] || PAL.node;
      if (GS.color === 'centres') return n.degree >= hubMin ? hubColor : PAL.node;
      return PAL.node;
    };
    const CW = 44, CH = 30;
    const wrapLines = (txt, maxW, max) => { const out = []; let line = ''; for (const w of String(txt).split(/\s+/)) { const t = line ? `${line} ${w}` : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; if (out.length === max) break; } else line = t; } if (out.length < max && line) out.push(line); if (out.length === max && ctx.measureText(out[max - 1]).width > maxW * 0.92) out[max - 1] = `${out[max - 1].slice(0, -2)}…`; return out; };
    const rrect = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
    function card(n, hot) {
      const x = n.x - CW / 2, y = n.y - CH / 2, col = TYPE_COLOR[n.type] || '#7AA2C8';
      rrect(x, y, CW, CH, 2.4);
      ctx.fillStyle = GS.light ? '#FFFFFF' : '#2A2C31'; ctx.fill();
      ctx.lineWidth = hot ? 0.7 : 0.35; ctx.strokeStyle = hot ? accent : GS.light ? 'rgba(60,64,72,.25)' : 'rgba(200,204,212,.18)'; ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + 3.2, y + 3.6, 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.font = '600 2.3px IBM Plex Sans, system-ui, sans-serif'; ctx.fillText((TYPE_LABEL[n.type] || n.type).toUpperCase(), x + 5, y + 4.4);
      ctx.fillStyle = PAL.text; ctx.font = '600 3.3px IBM Plex Sans, system-ui, sans-serif';
      n._t ||= wrapLines(n.title, CW - 5, 2);
      n._t.forEach((l, i) => ctx.fillText(l, x + 2.5, y + 9 + i * 3.9));
      if (n.excerpt) { ctx.font = '2.5px IBM Plex Sans, system-ui, sans-serif'; ctx.globalAlpha *= 0.7; n._e ||= wrapLines(n.excerpt, CW - 5, 4); n._e.forEach((l, i) => ctx.fillText(l, x + 2.5, y + 9 + n._t.length * 3.9 + 1 + i * 3.1)); ctx.globalAlpha /= 0.7; }
      ctx.textAlign = 'center';
    }
    function folderIcon(cx, cy, s) {
      const w = s * 2, h = s * 1.5, x = cx - w / 2, y = cy - h / 2;
      ctx.fillStyle = '#2F78D0'; rrect(x, y - h * 0.12, w * 0.45, h * 0.3, s * 0.12); ctx.fill();
      ctx.fillStyle = FOLDER; rrect(x, y, w, h, s * 0.18); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x + s * 0.15, y + h * 0.28, w - s * 0.3, s * 0.08);
    }
    function tick() {
      const arr = nodes;
      const q = quad(arr), rep = 180 * GS.repel * alpha;
      for (const n of arr) repulse(q, n, rep);
      const dist = 34 * GS.distance, ks = 0.06 * GS.link * alpha;
      // Ressorts « à la d3 » : force 1/min(degrés), le petit nœud bouge plus que le centre (pas d'explosion).
      for (const e of edges) {
        const a = e.a, b = e.b, da = a.degree || 1, db = b.degree || 1;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const want = dist * (e.kind === 'lien' || e.kind === 'tag' ? 1 : e.kind === 'dossier' ? 2.2 : 1.6);
        const f = ((d - want) / d) * ks * (e.kind === 'dossier' ? 1.2 : 4) / Math.min(da, db), bias = da / (da + db);
        b.vx -= dx * f * bias; b.vy -= dy * f * bias; a.vx += dx * f * (1 - bias); a.vy += dy * f * (1 - bias);
      }
      const c = 0.012 * GS.center * alpha;
      for (const n of arr) {
        if (n === drag) continue;
        n.vx -= n.x * c; n.vy -= n.y * c; n.vx *= 0.6; n.vy *= 0.6;
        const v = Math.hypot(n.vx, n.vy); if (v > 40) { n.vx *= 40 / v; n.vy *= 40 / v; } // vitesse bornée
        n.x += n.vx; n.y += n.vy;
      }
      alpha *= 0.992;
    }
    function fitTarget() {
      const xs = nodes.map((n) => n.x).sort((a, b) => a - b), ys = nodes.map((n) => n.y).sort((a, b) => a - b), cut = Math.floor(nodes.length * 0.01);
      const x0 = xs[cut], x1 = xs[xs.length - 1 - cut], y0 = ys[cut], y1 = ys[ys.length - 1 - cut];
      const k = Math.min(3, Math.max(0.05, Math.min((W - 60) / Math.max(1, x1 - x0), (H - 60) / Math.max(1, y1 - y0))));
      return { k, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }
    function fit() {
      if (!nodes.length) return;
      // Cadre sur 98 % des points (un point isolé très loin ne rapetisse pas tout).
      const xs = nodes.map((n) => n.x).sort((a, b) => a - b), ys = nodes.map((n) => n.y).sort((a, b) => a - b), cut = Math.floor(nodes.length * 0.01);
      const x0 = xs[cut], x1 = xs[xs.length - 1 - cut], y0 = ys[cut], y1 = ys[ys.length - 1 - cut];
      const k = Math.min(3, Math.max(0.05, Math.min((W - 60) / Math.max(1, x1 - x0), (H - 60) / Math.max(1, y1 - y0))));
      view.k = k; view.x = W / 2 - ((x0 + x1) / 2) * k; view.y = H / 2 - ((y0 + y1) / 2) * k; draw();
    }
    const q = () => GS.q.trim().toLowerCase();
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = PAL.bg; ctx.fillRect(0, 0, W, H);
      ctx.translate(view.x, view.y); ctx.scale(view.k, view.k);
      const hi = hover ? nb.get(hover.id) || new Set() : null, search = q();
      const match = (n) => search && n.title.toLowerCase().includes(search);
      const lw = (0.7 * GS.linkWidth) / view.k;
      // Liens
      ctx.lineWidth = lw; ctx.strokeStyle = PAL.link; ctx.globalAlpha = hover || search ? 0.35 : 1;
      ctx.beginPath();
      for (const e of edges) { if (hover && (e.a === hover || e.b === hover)) continue; ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); }
      ctx.stroke();
      if (hover) { ctx.globalAlpha = 1; ctx.strokeStyle = PAL.linkHi; ctx.lineWidth = lw * 2; ctx.beginPath(); for (const e of edges) if (e.a === hover || e.b === hover) { ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); } ctx.stroke(); }
      if (GS.arrows) { ctx.fillStyle = PAL.link; for (const e of edges) { const r = radius(e.b) + 2, dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, x = e.b.x - ux * r, y = e.b.y - uy * r, s = 4 / view.k; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ux * s - uy * s * 0.6, y - uy * s + ux * s * 0.6); ctx.lineTo(x - ux * s + uy * s * 0.6, y - uy * s - ux * s * 0.6); ctx.fill(); } }
      // Points
      for (const n of nodes) {
        const lit = !hover || n === hover || hi.has(n.id), src = S.sources.has(n.id) || match(n);
        ctx.globalAlpha = (hover && !lit) || (search && !match(n)) ? PAL.dim + 0.1 : 1;
        const r = Math.max(radius(n), 1.5 / view.k); // toujours visible, même de loin
        if (src) { ctx.beginPath(); ctx.arc(n.x, n.y, r + 5 / view.k + 2, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1; }
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n === hover ? accent : colorOf(n); ctx.fill();
      }
      // Cartes (comme Olmind) : en zoomant, chaque note devient une petite carte avec son type, son titre et son début.
      const cardA = GS.cards ? Math.max(0, Math.min(1, (view.k - 1.25) / 0.5)) : 0;
      if (cardA > 0.02) {
        const vx0 = -view.x / view.k - CW, vy0 = -view.y / view.k - CH, vx1 = (W - view.x) / view.k + CW, vy1 = (H - view.y) / view.k + CH;
        for (const n of nodes) {
          if (n.type === 'connecteur' || n.type === 'étiquette' || n.type === 'dossier' || n.x < vx0 || n.x > vx1 || n.y < vy0 || n.y > vy1) continue;
          const lit = !hover || n === hover || hi.has(n.id);
          ctx.globalAlpha = cardA * ((hover && !lit) || (search && !match(n)) ? 0.25 : 1);
          card(n, n === hover || S.sources.has(n.id) || match(n));
        }
        ctx.globalAlpha = 1;
      }
      // Dossiers : une icône de dossier bleue au centre de leur grappe.
      for (const n of nodes) if (n.type === 'dossier') { const r = Math.max(radius(n), 4 / view.k); folderIcon(n.x, n.y, r * 1.5); }
      // Noms : apparaissent en zoomant (seuil réglable), toujours pour le survol, ses voisins et les centres.
      const fade = Math.max(0, Math.min(1, (view.k - GS.labelAt * 0.6) / (GS.labelAt * 0.6)));
      ctx.textAlign = 'center'; ctx.font = `${11 / view.k}px IBM Plex Sans, system-ui, sans-serif`; ctx.fillStyle = PAL.text;
      for (const n of nodes) {
        const near = hover && (n === hover || hi.has(n.id)), show = near || S.sources.has(n.id) || match(n) || (n.degree >= hubMin && view.k > 0.35);
        if (cardA > 0.6 && n.type !== 'dossier' && n.type !== 'connecteur' && n.type !== 'étiquette' && !near) continue; // la carte porte déjà le nom
        const a = show ? 1 : hover ? 0 : fade;
        if (a < 0.05) continue;
        ctx.globalAlpha = a;
        ctx.fillText(n.title.length > 32 ? `${n.title.slice(0, 31)}…` : n.title, n.x, n.y + radius(n) + 11 / view.k);
      }
      ctx.globalAlpha = 1;
    }
    // Animation d'ouverture (comme Olmind) : on part tout près d'une note récente, en cartes, pendant que
    // le graphe se met en place, puis la caméra recule doucement jusqu'à la vue d'ensemble.
    let cam = null;
    function camStep(now) {
      const t = Math.min(1, (now - cam.t0) / cam.ms), e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const to = fitTarget(), from = cam.from;
      const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e);
      const cx = from.n.x + (to.cx - from.n.x) * e, cy = from.n.y + (to.cy - from.n.y) * e;
      view.k = k; view.x = W / 2 - cx * k; view.y = H / 2 - cy * k;
      if (t >= 1) { cam = null; follow = true; }
    }
    // Après l'animation, la caméra suit encore le graphe qui se pose, jusqu'à ce que tu le touches.
    let follow = false;
    function followStep() { const to = fitTarget(), cx = (W / 2 - view.x) / view.k, cy = (H / 2 - view.y) / view.k, k = Math.exp(Math.log(view.k) + (Math.log(to.k) - Math.log(view.k)) * 0.08), nx = cx + (to.cx - cx) * 0.08, ny = cy + (to.cy - cy) * 0.08; view.k = k; view.x = W / 2 - nx * k; view.y = H / 2 - ny * k; }
    function loop(now = performance.now()) {
      if (cam) { tick(); camStep(now); draw(); raf = requestAnimationFrame(loop); return; }
      if (!reduce && alpha > 0.005) { tick(); if (follow) followStep(); draw(); raf = requestAnimationFrame(loop); } else { if (follow) { follow = false; fit(); } draw(); raf = 0; }
    }
    const notes = nodes.filter((n) => n.type !== 'connecteur' && n.type !== 'étiquette' && n.type !== 'dossier');
    if (intro && !reduce && notes.length > 2) {
      for (let k = 0; k < 25; k++) tick();
      const focus = [...notes].sort((a, b) => Number(b.degree > 0) - Number(a.degree > 0) || (b.mtime || 0) - (a.mtime || 0) || b.degree - a.degree)[0];
      cam = { t0: performance.now(), ms: 4200, from: { k: Math.min(4, Math.max(2.4, W / 160)), n: focus } };
      alpha = 1; hover = null;
      camStep(cam.t0);
      loop();
    } else {
      for (let k = 0; k < (nodes.length > 1500 ? 80 : 300); k++) tick();
      fit();
      loop();
    }
    const reheat = (a = 0.5) => { alpha = Math.max(alpha, a); if (!raf) raf = requestAnimationFrame(loop); };
    const at = (e) => {
      const b = cv.getBoundingClientRect(); const x = (e.clientX - b.left - view.x) / view.k, y = (e.clientY - b.top - view.y) / view.k;
      const cards = GS.cards && view.k > 1.5; let best = null, bd = Infinity;
      for (const n of nodes) {
        const d = (n.x - x) ** 2 + (n.y - y) ** 2;
        const inCard = cards && n.type !== 'connecteur' && n.type !== 'étiquette' && n.type !== 'dossier' && Math.abs(n.x - x) < CW / 2 && Math.abs(n.y - y) < CH / 2;
        const r = radius(n) * (n.type === 'dossier' ? 1.6 : 1) + 4 / view.k;
        if ((inCard || d < r * r) && d < bd) { best = n; bd = d; }
      }
      return { node: best, x, y };
    };
    cv.onpointermove = (e) => {
      if (drag) { const p = at(e); drag.x = p.x; drag.y = p.y; drag.vx = 0; drag.vy = 0; moved = true; reheat(0.3); return; }
      if (pan) { view.x = pan.vx + e.clientX - pan.x; view.y = pan.vy + e.clientY - pan.y; moved = true; draw(); return; }
      const h = at(e).node;
      if (h !== hover) { hover = h; cv.style.cursor = h ? 'pointer' : 'grab'; const tip = $('#brTip'); if (h) { tip.hidden = false; tip.textContent = `${h.title} · ${TYPE_LABEL[h.type] || h.type} · ${h.degree} lien${h.degree > 1 ? 's' : ''}`; } else tip.hidden = true; if (!raf) draw(); }
    };
    cv.onpointerleave = () => { if (hover) { hover = null; $('#brTip').hidden = true; if (!raf) draw(); } };
    cv.onpointerdown = (e) => { cam = null; follow = false; cv.setPointerCapture(e.pointerId); moved = false; const h = at(e).node; if (h) drag = h; else pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; };
    cv.onpointerup = () => { const n = drag; drag = null; pan = null; if (n && !moved && n.type !== 'connecteur' && n.type !== 'étiquette') openNote(n.id); else if (n && !moved && n.type === 'dossier') { $('#brQ').value = n.folder; onSearch(); openSide(); } else if (n && !moved && n.type === 'étiquette') { $('#brQ').value = n.title.slice(1); onSearch(); openSide(); } };
    cv.onwheel = (e) => { e.preventDefault(); cam = null; follow = false; const b = cv.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top, f = Math.exp(-e.deltaY * 0.0015); const k = Math.max(0.05, Math.min(6, view.k * f)); view.x = mx - (mx - view.x) * (k / view.k); view.y = my - (my - view.y) * (k / view.k); view.k = k; if (!raf) draw(); };
    return { reheat, draw: () => { if (!raf) draw(); }, fit, data };
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
      if (S.mode === 'page' && S.path) openNote(S.path); else if (S.mode === 'graphe') renderGraph(true); else if (S.mode === 'base') renderBase(); else renderHome();
    },
    md,
  };
  // Changement d'écran ou d'onglet : ce qui est en cours d'écriture est enregistré.
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.dirty) saveNow(); });
  window.OdinBrain.leave = () => { if (S.dirty) saveNow(); stopGraph(); };
})();
