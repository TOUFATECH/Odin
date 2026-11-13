// Genèse dans l'interface (maquettes validées « Démarrage réseau · Odin te prévient » et « Écran de démarrage »),
// dans le thème de la fenêtre d'Odin :
// - Odin te prévient : les demandes « Installer pour moi » à décider (Autoriser efface le disque : ton accord d'abord),
//   les machines en direct avec leurs étapes, le fil des événements, les chiffres du jour.
// - Écran : la disposition et le thème de l'écran où l'on choisit le système (téléphone ou PC du réseau).
// - Tout : la vue générique (ISO, machines autorisées, historique, réglages).
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const post = async (action, input = {}, confirm = false) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'thjalfi', action, input, confirm }) })).json();
  /** Une action grave (effacer un disque) : ton accord d'abord, avec la phrase exacte. */
  const act = async (action, input = {}) => { let r = await post(action, input); if (r.confirm) { if (!confirm(r.confirm)) return { ok: false, text: 'Annulé.' }; r = await post(action, input, true); } return r; };
  const P = {
    pc: 'M3 4h18v12H3zM8 20h8M12 16v4', check: 'M5 12l5 5L20 7', x: 'M6 6l12 12M18 6 6 18', disk: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3zM4 6c0 1.7 3.6 3 8 3s8-1.3 8-3',
    phone: 'M7 2h10v20H7zM11 18h2', clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
    play: 'M7 5v14l12-7z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', chev: 'M9 6l6 6-6 6', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', list: 'M4 6h16M4 12h16M4 18h16',
  };
  const ic = (n, s = 16) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };
  const CSS = `
.tj{--ta:#0b7f7c;--tok:#1f9d55;--tbad:#e5484d;--twarn:#d97706;--tblue:#4f6bed;display:flex;flex-direction:column;gap:14px}
.tj-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.tj-top h2{margin:0;font-size:24px;font-weight:800;letter-spacing:-.3px}.tj-top p{margin:2px 0 0;color:var(--muted);font-size:13.5px}
.tj-face{width:44px;height:44px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#ffe3a0,#e19b1f);display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 0 18px #ffd16677;flex:none}.tj-face i{display:block;width:5px;height:10px;background:#fff;border-radius:3px}
.tj-tabs{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap}.tj-tabs button{min-height:36px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 85%,transparent);color:var(--ink);font:600 13.5px inherit;cursor:pointer}
.tj-tabs button[aria-selected=true]{background:var(--ta);color:#fff;border-color:transparent}
.tj-k{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}@media (max-width:900px){.tj-k{grid-template-columns:repeat(2,minmax(0,1fr))}}
.tj-k div{border-radius:18px;padding:14px 16px;display:flex;align-items:center;gap:12px;border:1px solid var(--line)}.tj-k b{font-size:28px;letter-spacing:-.5px}.tj-k span{font-size:13px;line-height:1.25}
.tj-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:14px;align-items:start}@media (max-width:1000px){.tj-grid{grid-template-columns:minmax(0,1fr)}}
.tj-col{display:flex;flex-direction:column;gap:14px;min-width:0}
.tj-w{background:color-mix(in srgb,var(--panel) 88%,transparent);backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:22px;padding:16px 18px;min-width:0;box-shadow:0 10px 26px rgba(16,54,58,.08)}
.tj-w h3{margin:0 0 10px;font-size:16px;display:flex;align-items:center;gap:8px}.tj-w h3 small{font-weight:400;color:var(--muted);font-size:12.5px}.tj-w h3 .r{margin-left:auto}
.tj-dec{border:2px solid color-mix(in srgb,var(--twarn) 55%,transparent);background:color-mix(in srgb,var(--twarn) 9%,var(--panel))}
.tj-badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;letter-spacing:.04em;padding:3px 9px;border-radius:999px;background:var(--twarn);color:#fff}
.tj-dec .who{display:flex;gap:14px;align-items:center;margin:12px 0}.tj-dec .who .ib{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;background:color-mix(in srgb,var(--twarn) 18%,transparent);color:var(--twarn);flex:none}
.tj-dec .who b{font-size:18px;display:block}.tj-dec .who span{font-size:12.5px;color:var(--muted)}
.tj-warn{display:flex;gap:8px;align-items:center;padding:9px 12px;border-radius:12px;background:color-mix(in srgb,var(--tbad) 10%,transparent);font-size:13px;margin-bottom:12px}
.tj-btns{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.tj-btns .x{margin-left:auto;font-size:12px;color:var(--muted);display:inline-flex;gap:5px;align-items:center}
.tj-pill{text-decoration:none;min-height:38px;padding:0 15px;border-radius:12px;border:0;font:600 13.5px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.tj-pill.warn{background:var(--twarn);color:#fff}.tj-pill.pri{background:var(--ta);color:#fff}.tj-pill.n{background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink)}.tj-pill:disabled{opacity:.5;cursor:default}
.tj-m{border:1px solid var(--line);border-radius:16px;padding:12px 14px;margin-top:10px}.tj-m .h{display:flex;gap:12px;align-items:center}.tj-m .lg{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;color:#fff;font-weight:800;flex:none}
.tj-m .t{flex:1;min-width:0}.tj-m .t b{display:block;font-size:14.5px}.tj-m .t span{font-size:12.5px;color:var(--muted)}.tj-m .p{text-align:right}.tj-m .p b{font-size:20px;display:block}.tj-m .p span{font-size:12px;color:var(--muted)}
.tj-st{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:10px}.tj-st div{font-size:11.5px;color:var(--muted)}.tj-st i{display:block;height:5px;border-radius:3px;background:color-mix(in srgb,var(--ink) 12%,transparent);margin-bottom:4px}
.tj-st .ok i{background:var(--tok)}.tj-st .cur i{background:var(--tblue)}.tj-st .cur{color:var(--ink);font-weight:700}
.tj-live{font-size:12.5px;color:var(--tbad);font-weight:600;display:inline-flex;align-items:center;gap:5px}.tj-live::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--tbad)}
.tj-ev{display:flex;gap:10px;align-items:center;padding:6px 0}.tj-ev time{font-size:12px;color:var(--muted);width:42px;flex:none}.tj-ev .c{flex:1;min-width:0;display:flex;align-items:center;gap:8px;border-radius:999px;padding:6px 12px;border:1px solid var(--line);font-size:13px}
.tj-ev .c b{white-space:nowrap}.tj-ev .c span{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tj-ev .d{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;color:#fff;flex:none}
.tj-seg{display:flex;gap:2px;background:color-mix(in srgb,var(--ink) 7%,transparent);border-radius:10px;padding:3px}.tj-seg button{border:0;background:none;color:var(--muted);border-radius:8px;padding:5px 10px;font:600 12.5px inherit;cursor:pointer}.tj-seg button[aria-pressed=true]{background:var(--panel);color:var(--ink)}
.tj-disp{display:flex;gap:14px;flex-wrap:wrap}.tj-disp label{display:flex;flex-direction:column;gap:8px;cursor:pointer;font-size:14px;font-weight:600}.tj-disp .pv{width:160px;height:104px;border-radius:14px;background:#141c4a;padding:10px;border:3px solid transparent;display:grid;gap:4px}
.tj-disp input:checked+.pv{border-color:var(--ta)}.tj-disp input{position:absolute;opacity:0}.tj-disp label:focus-within .pv{outline:2px solid var(--ta);outline-offset:2px}
.tj-chips{display:flex;gap:8px;flex-wrap:wrap}.tj-chips button{min-height:36px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:color-mix(in srgb,var(--ink) 5%,transparent);color:var(--ink);font:600 13px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:7px}
.tj-chips button[aria-pressed=true]{background:var(--ta);color:#fff;border-color:transparent}.tj-chips i{width:10px;height:10px;border-radius:50%}
.tj-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:14px;background:color-mix(in srgb,var(--ink) 4%,transparent);margin-top:10px;font-size:13.5px}.tj-row span{flex:1}.tj-row small{color:var(--muted)}
.tj-sw{position:relative;width:44px;height:26px;border-radius:13px;border:0;background:color-mix(in srgb,var(--ink) 18%,transparent);cursor:pointer;flex:none;padding:0}.tj-sw::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,.25)}.tj-sw[aria-checked=true]{background:var(--ta)}.tj-sw[aria-checked=true]::after{left:21px}
.tj-row input[type=number]{width:70px;min-height:34px;border-radius:9px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 8px;font:inherit}
.tj-note{font-size:12.5px;color:var(--muted);margin:10px 0 0;line-height:1.45}
.tj-empty{font-size:13.5px;color:var(--muted);margin:4px 0}
`;
  const S = { tab: 'odin', fil: 'tout', timer: 0 };
  const STEPS = [['démarrage réseau', 'Réseau'], ['chargeur', 'Chargeur'], ['chargement', 'Système'], ['installation', 'Installation'], ['logiciels', 'Logiciels']];
  const ORDER = ['démarrage réseau', 'chargeur', 'menu', 'chargement', 'installation', 'logiciels', 'fini'];
  const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const mins = (ms) => Math.max(0, Math.round(ms / 60000));
  const THEME_DOT = { nuit: '#ffd166', mayotte: '#0f8a83', espace: '#8b5cf6', ocean: '#22b3e6', odin: '#ffffff' };
  const sw = (on, label, onchange) => el('button', { class: 'tj-sw', type: 'button', role: 'switch', 'aria-checked': String(Boolean(on)), 'aria-label': label, onclick: (e) => { const b = e.currentTarget, v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); onchange(v); } });
  const note = (x) => { if (x?.text && x.text !== 'Annulé.') window.OdinNotices?.local?.({ title: x.text.split('\n')[0].slice(0, 160), level: x.ok === false ? 'souci' : 'ok', kind: 'Genèse', app: 'Genèse' }); };

  function decision(d, D, redraw) {
    const sys = (D.systemes ?? []).find((x) => x.id === d.iso), left = 30 * 60_000 - (Date.now() - d.at);
    const run = async (btn, accord) => { btn.disabled = true; const x = await act('decider', { id: d.id, accord }); btn.disabled = false; note(x); if (x.ok !== false) await redraw(); };
    return el('div', { class: 'tj-w tj-dec', role: 'region', 'aria-label': `Demande de ${d.host ?? d.mac}` },
      el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, el('span', { class: 'tj-badge' }, 'À DÉCIDER'), el('span', { style: 'font-size:12.5px;color:var(--muted);display:inline-flex;gap:5px;align-items:center' }, ic('clock', 13), left > 0 ? `la machine attend encore ${mins(left)} min` : 'la machine a repris son disque')),
      el('div', { class: 'who' }, el('span', { class: 'ib' }, ic('pc', 24)), el('div', {}, el('b', {}, `${d.host ?? 'Un PC'} veut installer ${sys ? `${sys.title} ${sys.version}` : d.isoName}`.trim()), el('span', {}, `${d.mac} · demandé sur son écran (« Installer pour moi ») à ${hhmm(d.at)}`))),
      el('div', { class: 'tj-warn' }, ic('disk', 15), el('span', {}, 'Son disque sera ', el('b', {}, 'effacé'), ', puis le système s\'installe tout seul (compte, langue, logiciels).')),
      el('div', { class: 'tj-btns' },
        el('button', { class: 'tj-pill warn', type: 'button', onclick: (e) => run(e.currentTarget, 'oui') }, ic('check', 15), 'Autoriser'),
        sys?.modes?.includes('installer') ? el('button', { class: 'tj-pill n', type: 'button', onclick: (e) => run(e.currentTarget, 'sans_effacer') }, 'Installer sans effacer') : null,
        el('button', { class: 'tj-pill n', type: 'button', onclick: (e) => run(e.currentTarget, 'non') }, ic('x', 14), 'Refuser'),
        el('span', { class: 'x' }, ic('phone', 13), 'aussi sur ton téléphone')));
  }
  function machine(m, D) {
    const sys = (D.systemes ?? []).find((x) => x.id === m.iso), k = ORDER.indexOf(m.step), color = sys?.color ?? '#5B6CD6';
    const pct = Math.round(Math.min(98, (Math.max(0, k) / 6) * 100));
    return el('div', { class: 'tj-m' }, el('div', { class: 'h' }, el('span', { class: 'lg', style: `background:${color}` }, (sys?.title ?? m.isoName ?? '?').charAt(0).toUpperCase()),
      el('div', { class: 't' }, el('b', {}, m.host ?? m.mac), el('span', {}, `${sys ? `${sys.title} ${sys.version}` : m.isoName ?? 'choix en cours'} · ${m.steps?.at(-1)?.detail ?? m.step}`)),
      el('div', { class: 'p' }, el('b', {}, `${pct} %`), el('span', {}, `${mins(Date.now() - m.started)} min`))),
      el('div', { class: 'tj-st', role: 'list', 'aria-label': 'Étapes' }, ...STEPS.map(([s, t]) => { const j = ORDER.indexOf(s), cls = j < k ? 'ok' : j === k || (s === 'chargement' && m.step === 'menu' && false) ? 'cur' : ''; return el('div', { class: cls, role: 'listitem' }, el('i'), t); })));
  }
  const EV = (e) => /fini|installée/.test(e.etape + e.detail) ? ['#1f9d55', 'check'] : /échec|raté/.test(e.etape + e.detail) ? ['#e5484d', 'alert'] : /sans nouvelles/.test(e.etape) ? ['#d97706', 'clock'] : /accord|demande/.test(e.detail) ? ['#d97706', 'shield'] : ['#4f6bed', 'pc'];

  async function odin(root, D, redraw) {
    const c = D.chiffres ?? {}, dec = (D.demandes ?? []).filter((d) => d.statut === 'attente');
    root.append(el('div', { class: 'tj-k' },
      el('div', { style: 'background:color-mix(in srgb,var(--twarn) 14%,transparent)' }, el('b', {}, String(dec.length)), el('span', {}, `demande${dec.length > 1 ? 's' : ''}`, el('br'), 'à décider')),
      el('div', { style: 'background:color-mix(in srgb,var(--tblue) 14%,transparent)' }, el('b', {}, String(c.enCours ?? 0)), el('span', {}, 'installations', el('br'), 'en cours')),
      el('div', { style: 'background:color-mix(in srgb,var(--tok) 14%,transparent)' }, el('b', {}, String(c.aujourdhui ?? 0)), el('span', {}, 'machines prêtes', el('br'), 'ce jour')),
      el('div', { style: 'background:color-mix(in srgb,var(--tbad) 14%,transparent)' }, el('b', {}, String(c.echecs ?? 0)), el('span', {}, `échec${(c.echecs ?? 0) > 1 ? 's' : ''}`, el('br'), 'à regarder'))));
    const left = el('div', { class: 'tj-col' }), right = el('div', { class: 'tj-col' });
    root.append(el('div', { class: 'tj-grid' }, left, right));
    for (const d of dec) left.append(decision(d, D, redraw));
    if (!dec.length) left.append(el('div', { class: 'tj-w' }, el('h3', {}, ic('shield', 16), 'Rien à décider'), el('p', { class: 'tj-empty' }, 'Quand un PC demande « Installer pour moi » sur l\'écran, la demande arrive ici et sur ton téléphone. Rien ne s\'efface sans ton accord.')));
    const run = D.enCours ?? [];
    left.append(el('div', { class: 'tj-w' }, el('h3', {}, 'En direct', el('small', {}, `${run.length} machine${run.length > 1 ? 's' : ''}`), run.length ? el('span', { class: 'r tj-live' }, 'en direct') : null),
      ...run.map((m) => machine(m, D)), run.length ? null : el('p', { class: 'tj-empty' }, D.allume ? 'Aucune machine ne démarre par le réseau en ce moment.' : 'Genèse est éteint : allume-le dans l\'onglet « Tout ».')));
    const fil = (D.fil ?? []).filter((e) => S.fil === 'tout' || (S.fil === 'erreurs' ? /échec|sans nouvelles|raté/.test(e.etape + e.detail) : /accord|demande|échec|sans nouvelles/.test(e.etape + e.detail)));
    right.append(el('div', { class: 'tj-w' }, el('h3', {}, 'Fil des événements', el('span', { class: 'r tj-seg' }, ...[['tout', 'Tout'], ['afaire', 'À faire'], ['erreurs', 'Erreurs']].map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(S.fil === k), onclick: () => { S.fil = k; redraw(); } }, t)))),
      ...fil.slice(0, 14).map((e) => { const [col, i] = EV(e); return el('div', { class: 'tj-ev' }, el('time', {}, hhmm(e.at)), el('div', { class: 'c', style: `background:${col}14;border-color:${col}55` }, el('span', { class: 'd', style: `background:${col}` }, ic(i, 12)), el('b', {}, `${e.nom} · ${e.etape}`), e.detail ? el('span', {}, e.detail) : null)); }),
      fil.length ? null : el('p', { class: 'tj-empty' }, 'Rien pour l\'instant.'),
      el('p', { class: 'tj-note' }, 'Les demandes et les fins d\'installation arrivent aussi sur ton téléphone ; les demandes restent jusqu\'à ta réponse.')));
    if (D.url) right.append(el('div', { class: 'tj-w' }, el('h3', {}, ic('eye', 16), 'L\'écran de démarrage'), el('p', { class: 'tj-note', style: 'margin-top:0' }, 'Une machine qui démarre par le réseau affiche son lien ; ouvre-le sur un téléphone ou un PC du réseau pour choisir le système.'),
      el('div', { class: 'tj-btns', style: 'margin-top:10px' }, el('a', { class: 'tj-pill n', href: `${D.url}?apercu`, target: '_blank', rel: 'noopener' }, ic('eye', 14), 'Voir l\'aperçu'))));
  }
  function ecran(root, D, redraw) {
    const e = { ...(D.ecran ?? {}) };
    const pv = (k) => k === 'eventail' ? [el('div', { style: 'display:flex;gap:4px;align-items:center;justify-content:center' }, el('i', { style: 'width:30px;height:46px;border-radius:6px;background:#7a1f3d' }), el('i', { style: 'width:40px;height:60px;border-radius:7px;background:#E95420' }), el('i', { style: 'width:30px;height:46px;border-radius:6px;background:#2e4f9a' })), el('div', { style: 'display:flex;gap:4px' }, el('i', { style: 'flex:1;height:8px;border-radius:4px;background:#fff' }), el('i', { style: 'flex:1;height:8px;border-radius:4px;background:#ffffff44' }), el('i', { style: 'flex:1;height:8px;border-radius:4px;background:#ffffff44' }))]
      : k === 'affiches' ? [el('div', { style: 'display:grid;grid-template-columns:repeat(5,1fr);gap:4px' }, ...['#E95420', '#0A6CD6', '#C70036', '#3C6EB4', '#69B53F', '#E57000', '#c2410c', '#10B981', '#0095D5', '#7C3AED'].map((c) => el('i', { style: `height:34px;border-radius:4px;background:${c}` })))]
        : [el('div', { style: 'display:flex;flex-direction:column;gap:4px' }, ...['#E95420', '#0A6CD6', '#C70036', '#3C6EB4'].map((c) => el('div', { style: 'display:flex;gap:5px;align-items:center;background:#ffffff14;border-radius:4px;padding:3px' }, el('i', { style: `width:10px;height:10px;border-radius:2px;background:${c}` }), el('i', { style: 'width:60px;height:4px;border-radius:2px;background:#ffffff66' }))))];
    const NAMES = { eventail: 'Éventail', affiches: 'Affiches', liste: 'Liste' };
    const disp = el('div', { class: 'tj-disp', role: 'radiogroup', 'aria-label': 'Disposition par défaut' }, ...(D.dispositions ?? ['eventail', 'affiches', 'liste']).map((k) => el('label', {}, el('input', { type: 'radio', name: 'tjDisp', value: k, checked: e.disposition === k, onchange: () => { e.disposition = k; } }), el('span', { class: 'pv' }, ...pv(k)), NAMES[k] ?? k)));
    const chips = el('div', { class: 'tj-chips' }, ...Object.entries(D.themes ?? {}).map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(e.theme === k), onclick: (ev) => { e.theme = k; for (const b of chips.children) b.setAttribute('aria-pressed', 'false'); ev.currentTarget.setAttribute('aria-pressed', 'true'); } }, el('i', { style: `background:${THEME_DOT[k] ?? '#999'}` }), t)));
    const wait = el('input', { type: 'number', min: '1', max: '60', value: String(e.attente ?? 5), 'aria-label': 'Minutes d\'attente' });
    const out = el('p', { class: 'tj-note', role: 'status' });
    root.append(el('div', { class: 'tj-grid' },
      el('div', { class: 'tj-w' }, el('h3', {}, 'Disposition par défaut'), disp, el('p', { class: 'tj-note' }, 'Sur l\'écran, la touche D change de disposition sans toucher à ce réglage.')),
      el('div', { class: 'tj-w' }, el('h3', {}, 'Thème par défaut'), chips,
        el('div', { class: 'tj-row' }, el('span', {}, 'Proposer l\'écran dans le menu de démarrage'), sw(e.actif, 'Proposer l\'écran', (v) => { e.actif = v; })),
        el('div', { class: 'tj-row' }, el('span', {}, 'L\'écran par défaut ', el('small', {}, '(sinon le disque de la machine)')), sw(e.parDefaut, 'Écran par défaut', (v) => { e.parDefaut = v; })),
        el('div', { class: 'tj-row' }, el('span', {}, 'Sans choix, la machine reprend son disque après'), wait, el('small', {}, 'min')),
        el('p', { class: 'tj-note' }, 'Sur l\'écran, la touche T change de thème le temps de la session.'))));
    root.append(el('div', { class: 'tj-btns' }, el('button', { class: 'tj-pill pri', type: 'button', onclick: async (ev) => { ev.currentTarget.disabled = true; const x = await post('ecran', { ...e, attente: Number(wait.value) }); ev.currentTarget.disabled = false; out.textContent = x.text; note(x); } }, 'Enregistrer'),
      D.url ? el('a', { class: 'tj-pill n', href: `${D.url}?apercu`, target: '_blank', rel: 'noopener' }, 'Voir l\'aperçu') : el('span', { class: 'tj-note', style: 'margin:0' }, 'Allume Genèse pour voir l\'aperçu.'), out));
  }

  window.OdinPages.thjalfi = async ({ host, generic }) => {
    if (!document.getElementById('tjCss')) document.head.append(el('style', { id: 'tjCss' }, CSS));
    const root = el('div', { class: 'tj' }), body = el('div', { class: 'tj' }), gen = el('div', {}, ...(generic ?? []));
    const tabs = el('div', { class: 'tj-tabs', role: 'tablist' });
    root.append(el('div', { class: 'tj-top' }, el('span', { class: 'tj-face', 'aria-hidden': 'true' }, el('i'), el('i')), el('div', {}, el('h2', {}, 'Odin te prévient'), el('p', {}, 'Déploiement réseau : chaque machine, de la demande à « c\'est prêt ».')), tabs), body, gen);
    host.append(root);
    const redraw = async () => {
      tabs.replaceChildren(...[['odin', 'Odin te prévient'], ['ecran', 'Écran de démarrage'], ['tout', 'Tout']].map(([id, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(S.tab === id), onclick: () => { S.tab = id; redraw(); } }, t)));
      gen.hidden = S.tab !== 'tout'; body.hidden = S.tab === 'tout';
      if (S.tab === 'tout') return;
      const r = await post('tableau'), D = r.data ?? {}, n = el('div', { class: 'tj' });
      if (S.tab === 'ecran') ecran(n, D, redraw); else await odin(n, D, redraw);
      body.replaceChildren(...n.childNodes);
    };
    await redraw();
    // En direct : on relit toutes les 5 s tant que la page est ouverte (pas sur l'onglet des réglages, pour ne pas perdre la saisie).
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (!root.isConnected) { clearInterval(S.timer); return; } if (S.tab === 'odin' && !document.hidden) void redraw(); }, 5000);
  };
})();
