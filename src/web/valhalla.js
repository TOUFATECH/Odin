// Espace « Applis » : toutes les applis d'Odin (Valhalla). Une seule interface générique dessine la
// page de chaque appli à partir de sa vue (chiffres clés, tableaux, listes, journaux, formulaires,
// actions par ligne). Plus : « J'ai besoin de… » (Odin choisit l'appli et explique), le fil
// d'alertes commun, et les liens entre applis.
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
.va-need{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px}.va-need input{flex:1 1 260px;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--field);background:var(--panel)}
.va-ans{white-space:pre-wrap;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0 0 18px;line-height:1.6}
.va-graph{margin:0 0 22px}.va-fam{margin:0 0 22px}.va-fam h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:0 0 10px}
.va-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:0 0 16px}
.va-kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.va-kpi small{display:block;color:var(--muted);font-size:13px}.va-kpi b{font-size:22px;font-variant-numeric:tabular-nums}
.va-kpi .va-bar{height:6px;border-radius:4px;background:var(--field);margin-top:8px;overflow:hidden}.va-kpi .va-bar i{display:block;height:100%;background:var(--good)}
.va-kpi.attention b,.va-tone-attention{color:var(--warn)}.va-kpi.mauvais b,.va-tone-mauvais{color:var(--bad)}.va-kpi.bon .va-bar i{background:var(--good)}.va-kpi.attention .va-bar i{background:var(--warn)}.va-kpi.mauvais .va-bar i{background:var(--bad)}
.va-page{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;align-items:start}@media (max-width:980px){.va-page{grid-template-columns:minmax(0,1fr)}}.va-page>div{min-width:0}
.va-sec{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0 0 14px;min-width:0}.va-sec h2{font-size:16px;margin:0 0 10px}
.va-tw{position:relative;overflow-x:auto;-webkit-overflow-scrolling:touch}.va-t{width:100%;border-collapse:collapse;font-size:14px}.va-t th{text-align:left;color:var(--muted);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.va-t td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:break-word}.va-t td.va-short{white-space:nowrap}.va-t td.va-long{overflow-wrap:anywhere;min-width:150px}.va-t tr:last-child td{border-bottom:0}
.va-t td.va-acts{white-space:nowrap}.va-t td.va-acts .btn{margin:2px 4px 2px 0}
.va-t tr.va-tone-bon td:first-child{box-shadow:inset 3px 0 var(--good)}.va-t tr.va-tone-attention td:first-child{box-shadow:inset 3px 0 var(--warn)}.va-t tr.va-tone-mauvais td:first-child{box-shadow:inset 3px 0 var(--bad)}
.va-tuiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}.va-tuile{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel2);min-width:0}.va-tuile.va-tone-bon{border-left:3px solid var(--good)}.va-tuile.va-tone-attention{border-left:3px solid var(--warn);color:inherit}.va-tuile.va-tone-mauvais{border-left:3px solid var(--bad);color:inherit}.va-tuile-h{display:flex;gap:10px;align-items:center;min-width:0}.va-tuile-h img,.va-tuile-i{width:40px;height:40px;border-radius:9px;flex:none;object-fit:contain;background:var(--field)}.va-tuile-i{display:grid;place-items:center;font-weight:700}.va-tuile-h b{display:block;overflow-wrap:anywhere}.va-tuile-h small{display:block;color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}.va-tuile-b{align-self:flex-start;font-size:12.5px;padding:2px 8px;border-radius:999px;background:var(--field)}.va-tuile.va-tone-attention .va-tuile-b{color:var(--warn)}.va-tuile.va-tone-bon .va-tuile-b{color:var(--good)}.va-tuile.va-tone-mauvais .va-tuile-b{color:var(--bad)}.va-tuile .va-bar{height:6px;border-radius:4px;background:var(--field);overflow:hidden}.va-tuile .va-bar i{display:block;height:100%;background:var(--warn)}.va-tuile-a{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto}
.va-list{list-style:none;margin:0;padding:0}.va-list li{padding:8px 0;border-bottom:1px solid var(--line)}.va-list li:last-child{border-bottom:0}.va-list small{display:block;color:var(--muted)}
.va-log{margin:0;max-height:320px;overflow:auto;font-size:12.5px;line-height:1.6;white-space:pre-wrap;background:var(--panel2);border-radius:10px;padding:10px}
.va-bars{display:flex;flex-direction:column;gap:6px}.va-brow{display:grid;grid-template-columns:minmax(80px,40%) 1fr auto;gap:8px;align-items:center;font-size:14px}.va-brow i{display:block;height:10px;border-radius:5px;background:var(--accent)}
.va-form label{display:block;font-size:14px;font-weight:600;margin:10px 0 4px}.va-form input:not([type=checkbox]),.va-form textarea,.va-form select{width:100%;min-height:40px;padding:8px 10px;border-radius:10px;border:1px solid var(--field);background:var(--panel2)}.va-form textarea{min-height:90px}.va-form .btn{margin-top:12px}
.va-form .va-chk{display:flex;gap:10px;align-items:center;font-weight:500;min-height:40px}.va-form .va-chk input{width:20px;height:20px;flex:none}
.va-form small.sub{display:block;margin-top:4px}.va-form .btn{display:flex}
.va-out{white-space:pre-wrap;font-size:14px;margin-top:10px;padding:10px;border-radius:10px;background:var(--panel2);overflow-wrap:anywhere}.va-out:empty{display:none}
.va-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}.va-tabs span{padding:4px 12px;border-radius:999px;border:1px solid var(--line);font-size:13px;color:var(--muted)}
.va-acts-bar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
.va-al{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}.va-al:last-child{border-bottom:0}.va-al .pill{flex:none}.va-al.ack{opacity:.55}
.va-mhead{display:none;align-items:center;gap:10px;margin:0 0 12px}.va-mhead h2{margin:0;font-size:20px}@media (max-width:700px){.va-mhead{display:flex}}
.va-links li{font-size:14px}.va-what{color:var(--muted);margin:-4px 0 14px}
.va-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:14px;margin:0 0 8px;align-items:start}.va-top:empty{display:none}.va-top .va-sec{margin:0 0 14px}
.va-manip{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}.va-manip>div:first-child{flex:1 1 220px;min-width:0;overflow-wrap:anywhere}.va-mbtn{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.va-prot.attention{border-color:var(--warn)}.va-t td.va-acts{white-space:normal}
.va-steps{list-style:none;margin:0;padding:0;counter-reset:st}.va-steps li{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:start;padding:10px 0;border-bottom:1px solid var(--line)}.va-steps li:last-child{border-bottom:0}
.va-steps li::before{counter-increment:st;content:counter(st);display:grid;place-items:center;width:26px;height:26px;border-radius:50%;border:1px solid var(--line);font-size:13px;font-weight:600}
.va-steps li.ok::before{content:'✓';background:var(--good);border-color:var(--good);color:#fff}.va-steps small{display:block;color:var(--muted);white-space:pre-wrap}
.va-gr{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px;align-items:start}@media (max-width:1180px){.va-gr{grid-template-columns:minmax(0,1fr)}}.va-gr>div{min-width:0}
.va-per{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 10px}.va-per .btn[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.va-fiche{border:1px solid var(--line);border-radius:14px;padding:14px;background:var(--panel2)}.va-fiche h3{margin:2px 0 4px;font-size:18px}.va-fiche .k{color:var(--muted);font-size:12.5px}
.va-chips{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.va-chips span{font-size:12.5px;padding:3px 10px;border-radius:999px;background:var(--field)}.va-chips .bon{background:color-mix(in srgb,var(--good) 22%,transparent)}.va-chips .attention{background:color-mix(in srgb,var(--warn) 25%,transparent)}.va-chips .mauvais{background:color-mix(in srgb,var(--bad) 25%,transparent)}
.va-kv{display:grid;grid-template-columns:118px minmax(0,1fr);gap:4px 10px;font-size:13.5px;margin:6px 0}.va-kv dt{color:var(--muted)}.va-kv dd{margin:0;overflow-wrap:anywhere}.va-kv dd small{display:block;color:var(--muted);font-size:12px}
.va-fl{list-style:none;margin:6px 0 0;padding:0;font-size:13px}.va-fl li{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--line)}.va-fl li small{color:var(--muted);white-space:nowrap}
.va-dlg{border:1px solid var(--line);border-radius:16px;background:var(--panel);color:inherit;padding:18px;max-width:min(560px,calc(100vw - 32px));width:100%}.va-dlg::backdrop{background:rgba(0,0,0,.45)}
.va-dlg img{display:block;width:min(320px,100%);margin:0 auto 12px;background:#fff;border-radius:10px;padding:10px}.va-dlg pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;background:var(--panel2);border-radius:10px;padding:10px;max-height:240px;overflow:auto}
`;
  let st = null, cur = null, busy = false;
  /** Paramètres de la vue de chaque appli (période du graphe…), gardés quand la page se redessine. */
  const viewQ = {};
  const LV = { critique: 'bad', haute: 'warn', moyenne: 'warn', info: '' };
  const icon = { Sécurité: '🛡', Machines: '🖥', Données: '🗂', Accès: '🔑', Maison: '🏠' };

  function field(p, id) {
    const v = p.default ?? '';
    if (p.kind === 'textarea') return el('textarea', { id, name: p.key, required: p.required }, String(v));
    if (p.kind === 'select') return el('select', { id, name: p.key, required: p.required }, ...(p.options ?? []).map((o) => el('option', { selected: o === v ? true : undefined }, o)));
    if (p.kind === 'boolean') return el('input', { id, name: p.key, type: 'checkbox', checked: v === true ? true : undefined });
    return el('input', { id, name: p.key, type: p.kind === 'number' ? 'number' : p.kind === 'password' ? 'password' : 'text', value: String(v), required: p.required, autocomplete: 'off', spellcheck: 'false' });
  }
  function form(mod, action, params, submit) {
    params = params ?? [];   // une action sans réglage : un simple bouton
    const out = el('div', { class: 'va-out', role: 'status' });
    const f = el('form', { class: 'va-form', onsubmit: async (e) => {
      e.preventDefault(); const input = {};
      for (const p of params) { const n = f.elements[p.key]; if (!n) continue; input[p.key] = p.kind === 'boolean' ? n.checked : p.kind === 'number' && n.value !== '' ? Number(n.value) : n.value; }
      out.textContent = '…'; const r = await run(mod, action, input); out.textContent = r;
    } }, ...params.map((p) => { const id = `va-${mod}-${action}-${p.key}`; return p.kind === 'boolean' ? el('label', { class: 'va-chk', for: id }, field(p, id), p.label) : [el('label', { for: id }, p.label, p.required ? ' *' : ''), field(p, id), p.help ? el('small', { class: 'sub' }, p.help) : null]; }), el('button', { class: 'btn primary', type: 'submit' }, submit), out);
    return f;
  }
  async function run(mod, action, input, confirmed) {
    const r = await api('/api/valhalla/act', { module: mod, action, input, confirm: confirmed === true });
    if (r.confirm) { if (!window.confirm(r.confirm)) return 'Annulé.'; return run(mod, action, input, true); }
    if (r.ok && r.data && (r.data.svg || r.data.conf)) show(r.text, r.data);
    setTimeout(() => cur === mod && openApp(mod, true), 600);
    return r.ok ? r.text : `✗ ${r.text ?? r.error}`;
  }
  /** Ce qu'une action rend à voir ou à garder : un QR code (image), un fichier texte à copier ou télécharger. */
  function show(text, d) {
    const dlg = el('dialog', { class: 'va-dlg', 'aria-label': text });
    const close = () => { dlg.close(); dlg.remove(); };
    const name = String(d.filename || 'configuration.conf').replace(/[^\w.-]/g, '_');
    dlg.append(el('h2', { style: 'margin:0 0 12px;font-size:17px' }, text),
      d.svg ? el('img', { src: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(d.svg)))}`, alt: d.alt || 'QR code à scanner avec l\'appli WireGuard' }) : null,
      // La configuration contient la clé privée de l'appareil : cachée tant que tu ne demandes pas à la voir.
      d.conf ? el('details', { open: d.show ? true : undefined }, el('summary', { style: 'cursor:pointer;min-height:36px' }, d.label || 'Voir la configuration (contient la clé secrète de l\'appareil)'), el('pre', {}, d.conf)) : null,
      el('div', { class: 'va-acts-bar', style: 'margin:12px 0 0' },
        d.conf ? el('button', { class: 'btn small', type: 'button', onclick: async (e) => { try { await navigator.clipboard.writeText(d.conf); e.target.textContent = 'Copié'; } catch { e.target.textContent = 'Copie impossible'; } } }, 'Copier') : null,
        d.conf ? el('button', { class: 'btn small', type: 'button', onclick: () => { const a = el('a', { href: URL.createObjectURL(new Blob([d.conf], { type: 'text/plain' })), download: name }); document.body.append(a); a.click(); a.remove(); } }, `Télécharger ${name}`) : null,
        el('button', { class: 'btn small primary', type: 'button', onclick: close }, 'Fermer')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }
  /** Une valeur courte ne se coupe jamais ; un long mot (chemin, empreinte, adresse) se coupe où il faut. */
  const cellClass = (c) => { const x = String(c ?? ''); return x.length <= 16 && !/\s.*\s.*\s/.test(x) ? 'va-short' : /\S{26,}/.test(x) ? 'va-long' : ''; };
  function section(mod, s) {
    const box = el('section', { class: 'va-sec' }, el('h2', {}, s.title));
    if (s.kind === 'table') {
      if (!s.rows.length) box.append(el('p', { class: 'sub' }, s.empty ?? 'Rien pour l\'instant.'));
      else {
        const hasA = s.rows.some((r) => r.actions?.length);
        box.append(el('div', { class: 'va-tw' }, el('table', { class: 'va-t' }, el('thead', {}, el('tr', {}, ...s.columns.map((c) => el('th', { scope: 'col' }, c)), hasA ? el('th', {}, el('span', { class: 'sr' }, 'Actions')) : null)),
          el('tbody', {}, ...s.rows.map((r) => el('tr', { class: r.tone ? `va-tone-${r.tone}` : '' }, ...r.cells.map((c) => el('td', { class: cellClass(c) }, c)), hasA ? el('td', { class: 'va-acts' }, ...(r.actions ?? []).map((a) => el('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; const t = a.module && a.module !== mod ? await runOther(a.module, a.action, a.input) : await run(mod, a.action, a.input); e.target.disabled = false; toast(t); } }, a.label))) : null))))));
      }
    } else if (s.kind === 'cards') {
      // Cartes avec icône (éditeur, système…) : seules les images data: ou de l'interface d'Odin sont affichées.
      const okIcon = (u) => typeof u === 'string' && (/^data:image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(u) || /^\/[^/]/.test(u));
      box.append(s.items.length ? el('div', { class: 'va-tuiles' }, ...s.items.map((c) => el('article', { class: `va-tuile${c.tone ? ` va-tone-${c.tone}` : ''}` },
        el('div', { class: 'va-tuile-h' }, okIcon(c.icon) ? el('img', { src: c.icon, alt: '', width: '40', height: '40', loading: 'lazy' }) : el('span', { class: 'va-tuile-i', 'aria-hidden': 'true' }, (c.title || '?').slice(0, 1)),
          el('div', {}, el('b', {}, c.title), c.sub ? el('small', {}, c.sub) : null, c.meta ? el('small', { class: 'va-tuile-m' }, c.meta) : null)),
        c.badge ? el('span', { class: 'va-tuile-b' }, c.badge) : null,
        typeof c.progress === 'number' ? el('div', { class: 'va-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(c.progress * 100)) }, el('i', { style: `width:${Math.max(0, Math.min(100, Math.round(c.progress * 100)))}%` })) : null,
        c.actions?.length ? el('div', { class: 'va-tuile-a' }, ...c.actions.map((a) => el('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; const t = a.module && a.module !== mod ? await runOther(a.module, a.action, a.input) : await run(mod, a.action, a.input); e.target.disabled = false; toast(t); } }, a.label))) : null))) : el('p', { class: 'sub' }, s.empty ?? 'Rien.'));
    } else if (s.kind === 'list') box.append(s.items.length ? el('ul', { class: 'va-list' }, ...s.items.map((i) => el('li', { class: i.tone ? `va-tone-${i.tone}` : '' }, el('b', {}, i.title), i.detail ? el('small', {}, i.detail) : null, i.meta ? el('small', {}, i.meta) : null))) : el('p', { class: 'sub' }, s.empty ?? 'Rien.'));
    else if (s.kind === 'log') box.append(el('pre', { class: 'va-log' }, s.lines.join('\n') || '—'));
    else if (s.kind === 'text') box.append(el('p', { class: s.tone ? `va-tone-${s.tone}` : '' }, s.text));
    else if (s.kind === 'bars') { const max = Math.max(1, ...s.items.map((i) => i.value)); box.append(s.items.length ? el('div', { class: 'va-bars' }, ...s.items.map((i) => el('div', { class: 'va-brow' }, el('span', {}, i.label), el('i', { style: `width:${Math.round((i.value / max) * 100)}%` }), el('b', {}, i.display ?? String(i.value))))) : el('p', { class: 'sub' }, 'Rien.')); }
    else if (s.kind === 'form') box.append(form(mod, s.action, s.params, s.submit));
    // Assistant de configuration : étapes numérotées, faites ou à faire, chacune avec son bouton.
    else if (s.kind === 'steps') box.append(el('ol', { class: 'va-steps' }, ...s.items.map((i) => el('li', { class: i.done ? 'ok' : '' }, el('div', {}, el('b', {}, i.title), i.detail ? el('small', {}, i.detail) : null), i.action && !i.done ? el('button', { class: 'btn small primary', type: 'button', onclick: async (e) => { e.target.disabled = true; const t = await run(mod, i.action, i.input ?? {}); e.target.disabled = false; toast(t); } }, i.button ?? 'Faire') : el('span', { class: 'sub' }, i.done ? 'Fait' : '')))));
    else if (s.kind === 'graph') graphSection(mod, s, box);
    return box;
  }
  /** Graphe d'une appli (même dessin que le Cerveau) : un clic sur un point ouvre sa fiche à droite. */
  function graphSection(mod, s, box) {
    const fiche = el('div', { class: 'va-fiche', 'aria-live': 'polite' });
    const host = el('div', {});
    const showDetail = (id) => {
      const d = s.details[id]; if (!d) return;
      fiche.replaceChildren(...[el('div', { class: 'k' }, d.kind), el('h3', {}, d.title), d.subtitle ? el('div', { class: 'sub' }, d.subtitle) : null,
        d.chips?.length ? el('div', { class: 'va-chips' }, ...d.chips.map((c) => el('span', { class: c.tone ?? '' }, c.label))) : null,
        d.rows?.length ? el('dl', { class: 'va-kv' }, ...d.rows.flatMap((r) => [el('dt', {}, r.k), el('dd', {}, r.v, r.src ? el('small', {}, r.src) : null)])) : null,
        d.list ? [el('b', { style: 'display:block;margin-top:10px;font-size:14px' }, d.list.title), d.list.items.length ? el('ul', { class: 'va-fl' }, ...d.list.items.map((i) => el('li', { class: i.tone ? `va-tone-${i.tone}` : '' }, el('span', { style: 'overflow-wrap:anywhere' }, i.text), i.meta ? el('small', {}, i.meta) : null))) : el('p', { class: 'sub' }, 'Rien.')] : null,
        d.actions?.length ? el('div', { class: 'va-acts-bar', style: 'margin:12px 0 0' }, ...d.actions.map((a) => el('button', { class: `btn small${a.primary ? ' primary' : ''}`, type: 'button', onclick: async (e) => { e.target.disabled = true; const t = a.module && a.module !== mod ? await runOther(a.module, a.action, a.input) : await run(mod, a.action, a.input); e.target.disabled = false; toast(t); } }, a.label))) : null].flat().filter(Boolean));
      fiche.querySelector('h3')?.focus?.({ preventScroll: true });
    };
    if (s.periods) box.append(el('div', { class: 'va-per', role: 'group', 'aria-label': 'Période' }, ...s.periods.options.map((o) => el('button', { class: 'btn small', type: 'button', 'aria-pressed': String(o.id === s.periods.current), onclick: () => { viewQ[mod] = { ...(viewQ[mod] ?? {}), periode: o.id }; openApp(mod, true); } }, o.label)), s.periods.when ? el('span', { class: 'sub' }, s.periods.when) : null));
    if (!s.nodes.length) { box.append(el('p', { class: 'sub' }, s.empty ?? 'Rien à montrer pour l\'instant.')); return; }
    box.append(el('div', { class: 'va-gr' }, host, el('div', {}, fiche)));
    const first = Object.keys(s.details)[0];
    if (first) showDetail(first); else fiche.append(el('p', { class: 'sub' }, 'Clique sur un point pour voir sa fiche.'));
    if (window.OdinGraph) window.OdinGraph.mount(host, { dark: true, nodes: s.nodes, edges: s.edges, legend: s.legend, label: s.title, search: 'Chercher (nom, adresse, domaine)…', counter: (n, e) => `${n.length} points · ${e.length} liens`, onOpen: (id) => showDetail(id) });
  }
  async function runOther(m, action, input) {
    const r = await api('/api/valhalla/act', { module: m, action, input });
    if (r.confirm) { if (!window.confirm(r.confirm)) return 'Annulé.'; const x = await api('/api/valhalla/act', { module: m, action, input, confirm: true }); return x.ok ? x.text : `✗ ${x.text ?? x.error}`; }
    setTimeout(() => cur && openApp(cur, true), 600);
    return r.ok ? r.text : `✗ ${r.text ?? r.error}`;
  }
  function toast(t) { const n = el('div', { class: 'va-out', role: 'status', style: 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:60;max-width:min(560px,calc(100% - 32px));box-shadow:var(--shadow);background:var(--panel)' }, t); document.body.append(n); setTimeout(() => n.remove(), 4500); }

  async function openCatalog() {
    const box = $('#v-apps .body'); if (!box) return;
    st = await api('/api/valhalla/catalog');
    box.replaceChildren();
    if (!st.ok) { box.append(el('p', { class: 'sub' }, st.error)); return; }
    const ans = el('div', { class: 'va-ans', role: 'status', hidden: true });
    box.append(el('form', { class: 'va-need', role: 'search', onsubmit: async (e) => { e.preventDefault(); const q = $('#vaNeed').value.trim(); if (!q) return; ans.hidden = false; ans.textContent = '…'; const r = await api(`/api/valhalla/advise?need=${encodeURIComponent(q)}`); ans.replaceChildren(r.text, r.found?.[0] ? el('div', { style: 'margin-top:10px' }, el('button', { class: 'btn small primary', type: 'button', onclick: () => openApp(r.found[0].id) }, `Ouvrir ${r.found[0].name}`)) : ''); } },
      el('label', { for: 'vaNeed', class: 'sr' }, 'De quoi as-tu besoin ?'), el('input', { id: 'vaNeed', placeholder: 'J\'ai besoin de… (sauvegarder mes photos, bloquer un pirate, voir la caméra…)', autocomplete: 'off' }), el('button', { class: 'btn primary', type: 'submit' }, 'Trouver l\'appli')), ans);
    // Ce qu'Odin a fait de lui-même : à garder ou à annuler. Et l'état de la protection, en une ligne.
    const top = el('div', { class: 'va-top' }); box.append(top);
    manips(top); protection(top);
    // Les applis en graphe (comme le Cerveau), avec les alertes et les nouveautés en pastilles
    const graph = el('div', { class: 'va-graph' });
    box.append(graph);
    drawGraph(graph);
    const al = await api('/api/valhalla/alerts?n=30');
    box.append(el('section', { class: 'va-sec' }, el('h2', {}, 'Alertes récentes'),
      el('div', { class: 'va-acts-bar' }, el('label', { for: 'vaLvl', class: 'sub' }, 'Sur ta messagerie à partir de :'), el('select', { id: 'vaLvl', onchange: async (e) => { await api('/api/valhalla/level', { level: e.target.value }); toast('Enregistré.'); } }, ...['info', 'moyenne', 'haute', 'critique'].map((l) => el('option', { selected: l === st.level ? true : undefined }, l))), el('button', { class: 'btn small', type: 'button', onclick: async () => { await api('/api/valhalla/ack', { ids: (al.alerts ?? []).map((a) => a.id) }); openCatalog(); } }, 'Tout marquer vu')),
      alerts(al.alerts ?? [])));
    box.append(el('section', { class: 'va-sec' }, el('h2', {}, 'Qui fait quoi : les liens entre applis'), el('ul', { class: 'va-list va-links' }, ...st.links.map((l) => el('li', {}, el('b', {}, l.from === l.to ? `${name(l.from)} · Odin répare seul` : `${name(l.from)} → ${name(l.to)}`), el('small', {}, `Quand ${l.when} : ${l.does}`)))),
      el('h2', { style: 'margin-top:16px' }, 'Usages de prédilection'), el('ul', { class: 'va-list' }, ...st.usages.map((u) => el('li', {}, el('b', {}, u.need), el('small', {}, `${u.chain.map(name).join(' → ')} — ${u.why}`))))));
    badge();
  }
  const name = (id) => st?.modules.find((m) => m.id === id)?.name ?? id;
  // Graphe des applis : Odin au centre, une famille par point vert, chaque appli reliée à sa famille et aux applis
  // avec lesquelles elle travaille. Pastille rouge ou orange : alertes ; bleue : nouveautés de son projet d'origine.
  let graphUi = null;
  function drawGraph(into) {
    if (!st?.ok || !window.OdinGraph) return;
    const fams = [...new Set(st.modules.map((m) => m.family))];
    const nodes = [{ id: 'odin', label: 'Odin', hub: true, size: 20, color: '#E3AC3F', title: 'Odin : toutes ses applis' },
      ...fams.map((f) => ({ id: `fam:${f}`, label: `${icon[f] ?? ''} ${f}`.trim(), hub: true, title: `Famille ${f}` })),
      ...st.modules.map((m) => ({ id: m.id, label: m.name, sub: m.family, search: `${m.what} ${(m.does || []).join(' ')}`,
        alert: m.alerts ? { n: m.alerts, level: m.grave ? 'grave' : 'attention' } : undefined, update: m.updates || 0,
        title: `${m.name} — ${m.what}${m.alerts ? ` · ${m.alerts} alerte(s)` : ''}${m.updates ? ` · ${m.updates} nouveauté(s) de son projet d'origine` : ''}` }))];
    const edges = [...fams.map((f) => ['odin', `fam:${f}`]), ...st.modules.map((m) => [`fam:${m.family}`, m.id]), ...st.links.filter((l) => l.from !== l.to).map((l) => [l.from, l.to])];
    const data = { nodes, edges, label: 'Graphe des applis d\'Odin', search: 'Chercher une appli…', counter: (n, e) => `${st.modules.length} applis · ${e.length} liens`, onOpen: (id) => { if (id === 'odin' || id.startsWith('fam:')) return; openApp(id); } };
    if (graphUi && into.contains(graphUi.el)) graphUi.update(data); else graphUi = window.OdinGraph.mount(into, data);
  }
  /** Les manips d'Odin (réflexes, soins, automatisations) qui attendent ta décision. */
  async function manips(into) {
    const box = el('section', { class: 'va-sec va-manips', hidden: true }); into.append(box);
    const draw = async () => {
      const r = await api('/api/valhalla/manips?n=40').catch(() => null); if (!r?.ok) return;
      // La simple tenue de registre (une note écrite, une fiche créée) reste dans le journal : rien à décider, rien à montrer ici.
      const todo = r.manips.filter((m) => m.state === 'à décider'), done = r.manips.filter((m) => m.state !== 'à décider' && !String(m.decidedBy ?? '').startsWith('réflexe')).slice(0, 5);
      box.hidden = !todo.length && !done.length; if (box.hidden) return;
      const decide = async (id, keep, confirmed, btn) => {
        if (btn) btn.disabled = true;
        const x = await api('/api/valhalla/manip', { id, keep, confirm: confirmed === true });
        if (x.confirm) { if (window.confirm(x.confirm)) return decide(id, keep, true, btn); if (btn) btn.disabled = false; return; }
        toast(x.text ?? (x.ok ? 'Fait.' : 'Impossible.')); draw();
      };
      const row = (m) => el('li', { class: 'va-manip' }, el('div', {}, el('b', {}, m.label), el('small', {}, m.text), el('small', {}, `${new Date(m.at).toLocaleString('fr-FR')} · ${m.by === 'odin' ? 'Odin, de lui-même' : m.by === 'réflexe' ? 'par réflexe' : m.by === 'automatisation' ? 'par une automatisation' : 'à la demande d\'un assistant'}${m.why ? ` · ${m.why}` : ''}`)),
        m.state === 'à décider' ? el('div', { class: 'va-mbtn' }, el('button', { class: 'btn small primary', type: 'button', onclick: (e) => decide(m.id, true, false, e.target) }, 'Garder'), m.canUndo ? el('button', { class: 'btn small', type: 'button', onclick: (e) => decide(m.id, false, false, e.target) }, 'Annuler') : el('span', { class: 'sub' }, 'pas d\'annulation possible'))
          : el('div', { class: 'va-mbtn' }, el('span', { class: `pill ${m.state === 'annulée' ? 'warn' : ''}` }, m.state), m.state === 'gardée' && m.canUndo ? el('button', { class: 'btn small', type: 'button', onclick: (e) => decide(m.id, false, false, e.target) }, 'Annuler') : null));
      box.replaceChildren(...[el('h2', {}, todo.length ? `Odin a fait ${todo.length} manip${todo.length > 1 ? 's' : ''} : à toi de décider` : 'Ce qu\'Odin a fait de lui-même'),
        el('p', { class: 'sub' }, r.autonomy === 'breaker' ? 'Mode Odin Breaker : Odin garde seul ses manips ; tu peux encore les annuler.' : 'Chaque manip peut être gardée ou annulée (annuler lance l\'action inverse).'),
        el('ul', { class: 'va-list' }, ...todo.map(row), ...done.map(row)),
        todo.length > 1 ? el('div', { class: 'va-acts-bar', style: 'margin:10px 0 0' }, el('button', { class: 'btn small', type: 'button', onclick: (e) => decide('tout', true, false, e.target) }, 'Tout garder')) : null].filter(Boolean));
    };
    await draw();
  }
  /** L'état de la protection (antivirus) en une ligne, avec l'accès à sa page. */
  async function protection(into) {
    if (!st.modules.some((m) => m.id === 'ullr')) return;
    const r = await api('/api/valhalla/act', { module: 'ullr', action: 'etat', input: {} }).catch(() => null); if (!r?.ok) return;
    const lines = String(r.text).split('\n'), bad = lines[0].startsWith('⚠');
    into.append(el('section', { class: `va-sec va-prot${bad ? ' attention' : ''}` }, el('h2', {}, 'Protection'), el('p', { class: bad ? 'va-tone-attention' : '' }, lines[0]), ...lines.slice(1, 4).filter((l) => l.startsWith('- ')).map((l) => el('p', { class: 'sub' }, l.slice(2))),
      el('p', { class: 'sub' }, lines.find((l) => l.startsWith('Signatures')) ?? ''), el('div', { class: 'va-acts-bar', style: 'margin:10px 0 0' }, el('button', { class: 'btn small primary', type: 'button', onclick: () => openApp('ullr') }, 'Ouvrir l\'antivirus'), el('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; toast('Analyse des téléchargements en cours…'); const x = await api('/api/valhalla/act', { module: 'ullr', action: 'analyser', input: { dossier: 'téléchargements' } }); e.target.disabled = false; toast(x.text ?? 'Terminé.'); } }, 'Analyser mes téléchargements'))));
  }
  function alerts(list) {
    if (!list.length) return el('p', { class: 'sub' }, 'Aucune alerte.');
    return el('div', {}, ...list.map((a) => el('div', { class: `va-al${a.ack ? ' ack' : ''}` }, el('span', { class: `pill ${LV[a.level] ?? ''}` }, a.level), el('div', {}, el('b', {}, `${name(a.module)} — ${a.title}`), a.count > 1 ? ` (×${a.count})` : '', a.detail ? el('div', { class: 'sub' }, a.detail) : null, el('small', { class: 'sub' }, new Date(a.at).toLocaleString('fr-FR'))))));
  }
  async function openApp(id, quiet) {
    cur = id;
    if (!quiet) window.OdinShow?.('app');
    const box = $('#v-app .body'), head = $('#v-app .head'); if (!box) return;
    if (!quiet) box.replaceChildren(el('p', { class: 'sub' }, 'Chargement…'));
    const r = await api(`/api/valhalla/view?${new URLSearchParams({ ...(viewQ[id] ?? {}), id })}`);
    if (cur !== id) return;
    if (!r.ok) { box.replaceChildren(el('p', { class: 'sub' }, r.error)); return; }
    $('#vaTitle').textContent = r.name; $('#vaSub').textContent = r.view.subtitle ?? r.what;
    const v = r.view, main = el('div', {}), side = el('div', {});
    const top = el('div', {});
    top.append(el('p', { class: 'va-what' }, r.what));
    if (v.tabs?.length) top.append(el('div', { class: 'va-tabs', 'aria-label': 'Modes de l\'appli' }, ...v.tabs.map((t) => el('span', {}, t))));
    if (v.kpis?.length) top.append(el('div', { class: 'va-kpis' }, ...v.kpis.map((k) => el('div', { class: `va-kpi ${k.tone ?? ''}`, title: k.hint ?? '' }, el('small', {}, k.label), el('b', {}, k.value), k.pct !== undefined ? el('div', { class: 'va-bar', role: 'progressbar', 'aria-valuenow': String(k.pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': k.label }, el('i', { style: `width:${Math.min(100, Math.max(0, k.pct))}%` })) : null))));
    const quick = r.actions.filter((a) => a.quick !== false && !a.params.some((p) => p.required));
    if (quick.length) top.append(el('div', { class: 'va-acts-bar' }, ...quick.map((a) => el('button', { class: `btn small${a.read ? '' : ''}`, type: 'button', title: a.what, onclick: async (e) => { e.target.disabled = true; const t = await run(id, a.id, {}); e.target.disabled = false; toast(t); } }, a.label, a.grave ? ' ⚠' : ''))));
    // Les graphes prennent toute la largeur (le graphe à gauche, la fiche du point choisi à droite).
    const wide = el('div', {});
    for (const s of v.sections) (s.kind === 'graph' ? wide : main).append(section(id, s));
    for (const s of v.side ?? []) side.append(section(id, s));
    const used = new Set((v.side ?? []).filter((s) => s.kind === 'form').map((s) => s.action));
    const others = r.actions.filter((a) => (a.quick === false || a.params.some((p) => p.required)) && !used.has(a.id));
    if (others.length) side.append(el('section', { class: 'va-sec' }, el('h2', {}, 'Autres actions'), ...others.map((a) => el('details', {}, el('summary', { style: 'cursor:pointer;min-height:36px;display:flex;align-items:center' }, a.label, a.grave ? ' ⚠' : ''), el('p', { class: 'sub' }, a.what), form(id, a.id, a.params, a.label)))));
    side.append(el('section', { class: 'va-sec' }, el('h2', {}, 'Alertes'), alerts(r.alerts)));
    if (r.links.length) side.append(el('section', { class: 'va-sec' }, el('h2', {}, 'Liens avec les autres applis'), el('ul', { class: 'va-list' }, ...r.links.map((l) => el('li', {}, el('b', {}, `${name(l.from)} → ${name(l.to)}`), el('small', {}, `Quand ${l.when} : ${l.does}`))))));
    const mc = $('#mcur'); if (mc) mc.textContent = r.name;
    // Rán : le champ d'adresse IP et les paquets (direct et historique), comme Wireshark
    if (id === 'ran' && window.OdinPackets) main.insertBefore(window.OdinPackets.finder(''), main.children[0] || null);
    box.replaceChildren(el('div', { class: 'va-mhead' }, el('button', { class: 'btn small', type: 'button', onclick: () => window.OdinShow?.('apps') }, '← Applis'), el('h2', {}, r.name)), top, wide, el('div', { class: 'va-page' }, main, side));
    head?.querySelector('#vaBack')?.focus?.({ preventScroll: true });
  }
  async function badge() { if (!appShown()) return; try { const a = (st ?? await api('/api/valhalla/catalog')).modules?.reduce((n, m) => n + (m.alerts ?? 0), 0) ?? 0; const b = $('#b-apps'); if (b) { b.hidden = !a; b.textContent = String(a); } } catch { /* rien */ } }
  function init() {
    const s = el('style', {}, css); document.head.append(s);
    $('#vaBack')?.addEventListener('click', () => { window.OdinShow?.('apps'); });
    setTimeout(badge, 4000); setInterval(() => { st = null; badge(); }, 120_000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.OdinApps = { open: () => { if (!busy) { busy = true; openCatalog().finally(() => { busy = false; }); } }, app: openApp };
})();
