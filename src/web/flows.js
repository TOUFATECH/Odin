// Espace « Automatisations » : n8n installé et piloté par Odin, relié au Cerveau.
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
  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
    if (r.status === 401) { location.reload(); throw new Error('session expirée'); }
    return r.json();
  }
  const NODE_TXT = { scheduleTrigger: 'Planning', webhook: 'Webhook', rssFeedReadTrigger: 'RSS', httpRequest: 'Requête HTTP', if: 'Condition', switch: 'Aiguillage', set: 'Données', code: 'Code', gmailTrigger: 'Gmail', emailReadImap: 'Mail', telegramTrigger: 'Telegram', notion: 'Notion', googleSheets: 'Sheets', noOp: 'Étape' };
  let busy = false;

  async function render() {
    const box = $('#v-flows .body'); if (!box) return;
    const st = await api('/api/flows');
    const parts = [];
    // Schéma du pont : déclencheurs → n8n → Odin → Cerveau / messageries
    parts.push(el('figure', { class: 'fl-map', 'aria-label': 'Comment les automatisations sont reliées' },
      el('div', { class: 'fl-col' }, el('b', {}, 'Déclencheurs'), el('span', {}, 'Planning · Webhook · RSS · Mail · Formulaire · Applis')),
      el('div', { class: 'fl-arr', 'aria-hidden': 'true' }, '→'),
      el('div', { class: `fl-col fl-n8n${st.up ? ' on' : ''}` }, el('b', {}, 'n8n'), el('span', {}, st.up ? (st.keyOk ? `${Array.isArray(st.workflows) ? st.workflows.length : st.workflows} automatisation(s)` : 'clé à donner') : 'à installer')),
      el('div', { class: 'fl-arr', 'aria-hidden': 'true' }, '⇄'),
      el('div', { class: 'fl-col on' }, el('b', {}, 'Odin'), el('span', {}, 'capture, écrit, prévient, agit')),
      el('div', { class: 'fl-arr', 'aria-hidden': 'true' }, '⇄'),
      el('div', { class: 'fl-col on' }, el('b', {}, 'Cerveau'), el('span', {}, 'notes, projets, journal')),
      el('figcaption', {}, 'n8n déclenche et enchaîne ; Odin comprend, range dans le Cerveau et te prévient ; chaque changement du Cerveau peut relancer n8n.')));
    if (!st.up) {
      parts.push(el('section', { class: 'card' }, el('h2', {}, 'Installer n8n'),
        el('p', { class: 'sub' }, 'n8n tourne sur la machine d\'Odin (Docker), pour ton usage personnel : plus de 400 applis à enchaîner. Odin l\'installe, le relie au Cerveau, puis crée les automatisations que tu lui décris.'),
        el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', id: 'flInstall', onclick: install, disabled: st.installing ? true : undefined }, st.installing ? 'Installation en cours…' : 'Installer n8n'), el('span', { class: 'sub', id: 'flInstallSt', 'aria-live': 'polite' })),
        el('details', {}, el('summary', {}, 'J\'ai déjà n8n ailleurs'), el('form', { class: 'row', onsubmit: async (e) => { e.preventDefault(); const r = await api('/api/flows/url', { url: $('#flUrl').value }); if (r.ok) render(); } }, el('label', { for: 'flUrl', class: 'sub' }, 'Adresse'), el('input', { id: 'flUrl', value: st.url, style: 'flex:1;min-width:220px' }), el('button', { class: 'btn', type: 'submit' }, 'Utiliser')))));
    } else if (!st.keyOk) {
      parts.push(el('section', { class: 'card' }, el('h2', {}, 'Relier n8n à Odin'),
        el('ol', { class: 'steps' }, el('li', {}, 'Ouvre ', el('a', { href: st.open, target: '_blank', rel: 'noopener' }, st.open), ' et crée ton compte (la première fois).'), el('li', {}, 'Dans n8n : Paramètres → n8n API → « Create an API key ».'), el('li', {}, 'Colle la clé ici : Odin la garde dans son coffre.')),
        el('form', { class: 'row', onsubmit: async (e) => { e.preventDefault(); const r = await api('/api/flows/key', { key: $('#flKey').value }); $('#flKeySt').textContent = r.ok ? '✓ Relié.' : `✗ ${r.error}`; if (r.ok) setTimeout(render, 600); } },
          el('label', { for: 'flKey', class: 'sub' }, 'Clé API n8n'), el('input', { id: 'flKey', type: 'password', autocomplete: 'off', style: 'flex:1;min-width:240px' }), el('button', { class: 'btn', type: 'submit' }, 'Enregistrer'), el('span', { id: 'flKeySt', class: 'sub', 'aria-live': 'polite' })),
        st.error ? el('p', { class: 'sub bad' }, st.error) : null));
    } else {
      parts.push(el('section', { class: 'card' }, el('h2', {}, 'Décris ton automatisation'),
        el('p', { class: 'sub' }, 'Ex. : « chaque lundi à 8 h, résume les nouveautés de mes projets et envoie-les moi » · « quand un mail contient une facture, garde-la dans le Cerveau » · « chaque nouvelle vidéo de cette chaîne YouTube → Captures ».'),
        el('form', { class: 'fl-ask', onsubmit: create }, el('label', { for: 'flDesc', class: 'sr' }, 'Ce que l\'automatisation doit faire'), el('textarea', { id: 'flDesc', rows: '3' }), el('div', { class: 'row' }, el('button', { class: 'btn', type: 'submit', id: 'flGo' }, 'Créer l\'automatisation'), el('span', { id: 'flSt', class: 'sub', 'aria-live': 'polite' })))));
      parts.push(el('section', { class: 'card' }, el('div', { class: 'row', style: 'justify-content:space-between' }, el('h2', { style: 'margin:0' }, `Automatisations · ${st.workflows.length}`), el('a', { class: 'btn ghost', href: st.open, target: '_blank', rel: 'noopener' }, 'Ouvrir l\'éditeur n8n')),
        st.failed ? el('p', { class: 'sub bad', role: 'status' }, `⚠ ${st.failed} exécution(s) en échec ces dernières 24 h.`) : null,
        st.workflows.length ? el('div', { class: 'wrap' }, el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, el('th', {}, 'Active'), el('th', {}, 'Nom'), el('th', {}, 'Étapes'), el('th', {}, 'Dernière exécution'), el('th', {}, ''))),
          el('tbody', {}, ...st.workflows.map((w) => el('tr', {},
            el('td', {}, el('input', { type: 'checkbox', class: 'g-sw', 'aria-label': `Activer ${w.name}`, checked: w.active ? true : undefined, onchange: async (e) => { const r = await api('/api/flows/toggle', { id: w.id, on: e.target.checked }); if (!r.ok) { e.target.checked = !e.target.checked; alert(r.error); } } })),
            el('td', {}, w.name), el('td', { class: 'sub' }, w.nodes.map((n) => NODE_TXT[n] || n).join(' → ')),
            el('td', { class: w.last?.status === 'error' ? 'bad' : 'sub' }, w.last ? `${w.last.status === 'error' ? '✗' : '✓'} ${new Date(w.last.startedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '—'),
            el('td', {}, el('a', { href: w.link, target: '_blank', rel: 'noopener' }, 'Modifier'))))))) : el('p', { class: 'sub' }, 'Aucune pour l\'instant : décris-en une, ou pars d\'un modèle.')));
      parts.push(el('section', { class: 'card' }, el('h2', {}, 'Modèles prêts'), el('div', { class: 'fl-tpl' }, ...st.templates.map((t) => el('article', { class: 'fl-t' }, el('b', {}, t.name), el('p', { class: 'sub' }, t.what), el('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; const r = await api('/api/flows/template', { id: t.id }); e.target.textContent = r.ok ? '✓ Ajouté' : `✗ ${r.error}`; if (r.ok) setTimeout(render, 800); } }, 'Ajouter'))))));
    }
    // Pont avec le Cerveau
    parts.push(el('section', { class: 'card' }, el('h2', {}, 'Pont avec le Cerveau'),
      el('p', { class: 'sub' }, 'Dans n8n, un nœud « Requête HTTP » appelle Odin à cette adresse, avec l\'en-tête x-odin-hook. Actions : capture, note, ajouter, notify, ask. Les modèles et les automatisations créées par Odin sont déjà réglés.'),
      el('div', { class: 'row' }, el('code', { class: 'fl-code' }, `POST ${st.bridge.hookUrl}`), el('code', { class: 'fl-code', id: 'flTok' }, `x-odin-hook: ${st.bridge.tokenHint}`), el('button', { class: 'btn small ghost', type: 'button', onclick: async () => { const r = await api('/api/flows/token', {}); $('#flTok').textContent = `x-odin-hook: ${r.token}`; } }, 'Afficher la clé')),
      el('form', { class: 'fl-ask', onsubmit: async (e) => { e.preventDefault(); const r = await api('/api/flows/webhooks', { urls: $('#flHooks').value }); $('#flHookSt').textContent = r.ok ? `✓ ${r.urls.length} adresse(s) prévenue(s) à chaque changement du Cerveau.` : `✗ ${r.error}`; } },
        el('label', { for: 'flHooks' }, 'Prévenir ces adresses n8n quand une note du Cerveau est créée, modifiée ou mise à la corbeille (une par ligne ; modèle « Quand le Cerveau change »)'),
        el('textarea', { id: 'flHooks', rows: '2', placeholder: 'http://192.168.1.10:5678/webhook/odin-cerveau' }, st.bridge.brainWebhooks.join('\n')),
        el('div', { class: 'row' }, el('button', { class: 'btn', type: 'submit' }, 'Enregistrer'), el('span', { id: 'flHookSt', class: 'sub', 'aria-live': 'polite' })))));
    box.replaceChildren(...parts);
  }
  async function install() {
    if (busy) return; busy = true;
    $('#flInstall').disabled = true; $('#flInstall').textContent = 'Installation en cours…'; $('#flInstallSt').textContent = 'Docker, puis n8n : quelques minutes.';
    const r = await api('/api/flows/install', {}); busy = false;
    $('#flInstallSt').textContent = r.text || r.error || ''; setTimeout(render, 1500);
  }
  async function create(e) {
    e.preventDefault();
    const d = $('#flDesc').value.trim(); if (!d) return;
    $('#flGo').disabled = true; $('#flSt').textContent = 'Odin écrit l\'automatisation…';
    const r = await api('/api/flows/create', { description: d });
    $('#flGo').disabled = false; $('#flSt').textContent = r.text || r.error || '';
    if (r.ok) setTimeout(render, 800);
  }
  window.OdinFlows = { open: render };
})();
