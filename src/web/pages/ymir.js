// Hydre dans l'interface (maquettes validées « Toutes les machines », « Créer une machine », « Quarantaine »),
// dans le thème de la fenêtre d'Odin :
// - Machines : les LXC et VM de ce PC rangés par système, avec l'aperçu en direct (écran de la VM, console du LXC),
//   processeur et mémoire, tes catégories, ce PC (l'hôte), et pour la machine choisie : ressources, exporter, cloner.
// - Créer : système (modèle LXC ou ISO d'Andromède), nom automatique, ressources, adresse vérifiée, applis d'Odin.
// - Quarantaine : les machines isolées, d'où vient le souci, ce qu'Odin a fait, l'analyse, la sortie.
// - Serveurs : la vue générique (Proxmox, conteneurs du moteur d'Odin).
// Tout ce qui est grave (arrêter, supprimer, sortir de quarantaine) passe par ton accord.
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const post = async (action, input = {}, confirm = false) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'ymir', action, input, confirm }) })).json();
  const act = async (action, input = {}) => { let r = await post(action, input); if (r.confirm) { if (!confirm(r.confirm)) return { ok: false, text: 'Annulé.' }; r = await post(action, input, true); } return r; };
  const note = (x) => { if (x?.text && x.text !== 'Annulé.') window.OdinNotices?.local?.({ title: x.text.split('\n')[0].slice(0, 160), level: x.ok === false ? 'souci' : 'ok', kind: 'Hydre', app: 'Hydre' }); };
  const P = {
    box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8', plus: 'M12 5v14M5 12h14', down: 'M12 4v12M6 12l6 6 6-6M4 20h16', up: 'M12 20V8M6 12l6-6 6 6M4 4h16', copy: 'M8 8h12v12H8zM4 16V4h12',
    save: 'M5 3h11l3 3v15H5zM8 3v6h8M8 21v-7h8v7', screen: 'M3 4h18v12H3zM8 20h8M12 16v4', term: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5', play: 'M7 5v14l12-7z', stop: 'M6 6h12v12H6z', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', check: 'M5 12l5 5L20 7', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', list: 'M4 6h16M4 12h16M4 18h16',
    alert: 'M12 3 2 20h20zM12 10v4M12 17h.01', mail: 'M3 5h18v14H3zM3 6l9 7 9-7', unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2',
  };
  const ic = (n, s = 16) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };
  const CSS = `
.ym{--ya:#0b7f7c;--yok:#1f9d55;--ybad:#e5484d;--ywarn:#d97706;--yblue:#4f6bed;display:flex;flex-direction:column;gap:14px}
.ym-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ym-top h2{margin:0;font-size:24px;font-weight:800;letter-spacing:-.3px}.ym-top p{margin:2px 0 0;color:var(--muted);font-size:13.5px}
.ym-tabs{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap}.ym-tabs button{min-height:36px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 85%,transparent);color:var(--ink);font:600 13.5px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.ym-tabs button[aria-selected=true]{background:var(--ya);color:#fff;border-color:transparent}
.ym-w{background:color-mix(in srgb,var(--panel) 88%,transparent);backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:20px;padding:14px 16px;min-width:0;box-shadow:0 10px 26px rgba(16,54,58,.08)}
.ym-w h3{margin:0 0 10px;font-size:15.5px;display:flex;align-items:center;gap:8px}.ym-w h3 small{font-weight:400;color:var(--muted);font-size:12.5px}.ym-w h3 .r{margin-left:auto}
.ym-lay{display:grid;grid-template-columns:230px minmax(0,1fr);gap:14px;align-items:start}@media (max-width:1000px){.ym-lay{grid-template-columns:minmax(0,1fr)}}
.ym-side{display:flex;flex-direction:column;gap:2px}.ym-side .h{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:10px 8px 4px;font-weight:700}
.ym-side button{display:flex;align-items:center;gap:9px;min-height:38px;padding:0 10px;border-radius:11px;border:0;background:none;color:var(--ink);font:500 14px inherit;cursor:pointer;text-align:left}.ym-side button i{width:9px;height:9px;border-radius:3px;flex:none}.ym-side button span{margin-left:auto;color:var(--muted);font-size:12.5px;flex:none}.ym-side button .t{margin:0;color:inherit;font-size:inherit;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ym-side button[aria-pressed=true]{background:var(--ya);color:#fff}.ym-side button[aria-pressed=true] span{color:#fff}
.ym-k{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}@media (max-width:1100px){.ym-k{grid-template-columns:repeat(3,minmax(0,1fr))}}
.ym-k div{border:1px solid var(--line);border-radius:16px;padding:10px 14px;background:color-mix(in srgb,var(--panel) 80%,transparent)}.ym-k small{display:block;font-size:12px;color:var(--muted)}.ym-k b{font-size:24px;letter-spacing:-.4px}.ym-k span{display:block;font-size:12px;color:var(--muted)}
.ym-sec{display:flex;align-items:center;gap:8px;margin:6px 2px 0;font-weight:700}.ym-sec i{width:10px;height:10px;border-radius:3px}.ym-sec small{font-weight:400;color:var(--muted)}
.ym-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.ym-c{border:1px solid var(--line);border-radius:18px;padding:12px;background:color-mix(in srgb,var(--panel) 92%,transparent);display:flex;flex-direction:column;gap:9px;cursor:pointer;min-width:0}
.ym-c[aria-current=true]{outline:2px solid var(--ya);outline-offset:1px}.ym-c.q{border-color:color-mix(in srgb,var(--ybad) 60%,transparent);background:color-mix(in srgb,var(--ybad) 6%,var(--panel))}
.ym-c .hd{display:flex;gap:10px;align-items:center}.ym-c .hd .lg{font-size:16px;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:800;flex:none}.ym-c .hd b{display:block;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ym-c .hd span{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}.ym-c .hd em{margin-left:auto;font-style:normal;font-size:11px;font-weight:800;padding:2px 7px;border-radius:7px;background:color-mix(in srgb,var(--ink) 8%,transparent)}
.ym-pv{height:120px;border-radius:12px;background:#0f1530;overflow:hidden;position:relative;display:grid;place-items:center}.ym-pv img{width:100%;height:100%;object-fit:cover}.ym-pv pre{margin:0;align-self:start;justify-self:start;padding:8px 10px;color:#9fe3b0;font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all}
.ym-pv .tag{position:absolute;left:8px;top:8px;font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff}.ym-pv .off{color:#cbd5e1;font-size:12.5px}
.ym-st{display:flex;align-items:center;gap:8px;font-size:13px}.ym-st i{width:8px;height:8px;border-radius:50%}.ym-st code{margin-left:auto;font-size:12.5px}
.ym-g{display:flex;gap:14px}.ym-g div{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted)}.ym-ring{--p:0;width:40px;height:40px;border-radius:50%;background:conic-gradient(var(--yblue) calc(var(--p)*1%),color-mix(in srgb,var(--ink) 10%,transparent) 0);display:grid;place-items:center}.ym-ring b{width:30px;height:30px;border-radius:50%;background:var(--panel);display:grid;place-items:center;font-size:10.5px;color:var(--ink)}
.ym-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.ym-chip{font-size:11.5px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ink) 7%,transparent)}.ym-chip.bad{background:var(--ybad);color:#fff}
.ym-btn{min-height:34px;min-width:34px;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:color-mix(in srgb,var(--ink) 4%,transparent);color:var(--ink);font:600 13px inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}.ym-btn:disabled{opacity:.5;cursor:default}
.ym-btn.pri{background:var(--ya);color:#fff;border-color:transparent}.ym-btn.bad{background:var(--ybad);color:#fff;border-color:transparent}.ym-btn.blue{background:var(--yblue);color:#fff;border-color:transparent}
.ym-bot{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:12px}@media (max-width:1000px){.ym-bot{grid-template-columns:minmax(0,1fr)}}
.ym-tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ym-tile{border:1px solid var(--line);border-radius:16px;padding:12px;display:flex;gap:10px;background:color-mix(in srgb,var(--panel) 88%,transparent);cursor:pointer;text-align:left;color:var(--ink);font:inherit}.ym-tile b{display:block;font-size:14px}.ym-tile span{font-size:12.5px;color:var(--muted)}.ym-tile .ib{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:color-mix(in srgb,var(--ya) 14%,transparent);color:var(--ya);flex:none}
.ym-sl{display:grid;grid-template-columns:90px 1fr 70px;gap:10px;align-items:center;font-size:13.5px;margin:6px 0}.ym-sl input{width:100%;accent-color:var(--yblue)}.ym-sl b{text-align:right;color:var(--ya)}
.ym-f{display:flex;flex-direction:column;gap:6px}.ym-f label{font-size:12.5px;color:var(--muted)}.ym-f input,.ym-f select{min-height:38px;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 10px;font:inherit}
.ym-seg{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ym-seg button{min-height:40px;border-radius:12px;border:1px solid var(--line);background:none;color:var(--ink);font:600 14px inherit;cursor:pointer}.ym-seg button[aria-pressed=true]{background:var(--ya);color:#fff;border-color:transparent}
.ym-apps{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}.ym-apps label{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:10px;cursor:pointer;font-size:13.5px}.ym-apps label:has(input:checked){border-color:var(--ya);background:color-mix(in srgb,var(--ya) 8%,transparent)}.ym-apps small{display:block;color:var(--muted);font-size:12px}.ym-apps input{width:18px;height:18px;accent-color:var(--ya)}
.ym-ok{font-size:12px;color:var(--yok);font-weight:600}.ym-ko{font-size:12px;color:var(--ybad);font-weight:600}
.ym-tl{display:flex;gap:6px;overflow-x:auto;padding:4px 0}.ym-tl div{min-width:130px;text-align:center;font-size:12px}.ym-tl i{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;margin:6px auto;border:2px solid currentColor}.ym-tl b{display:block;font-size:12.5px;color:var(--ink)}.ym-tl span{color:var(--muted)}
.ym-j{display:flex;gap:10px;align-items:center;padding:7px 0;border-top:1px solid var(--line);font-size:13.5px}.ym-j:first-of-type{border-top:0}.ym-j .tx{flex:1}.ym-j .ok{color:var(--yok);flex:none}.ym-j small{color:var(--muted)}
.ym-out{font-size:13px;white-space:pre-wrap;color:var(--muted);margin:8px 0 0}.ym-empty{font-size:13.5px;color:var(--muted)}
`;
  const S = { tab: 'machines', filtre: 'Toutes', sel: null, timer: 0, previews: {}, create: { genre: 'lxc', apps: null } };
  const FAM = { Linux: '#E95420', Windows: '#0A6CD6', Mac: '#94a3b8', Autre: '#64748b' };
  const LOGO = (m) => (/windows/i.test(m.systeme) ? '#0A6CD6' : /debian/i.test(m.systeme) ? '#C70036' : /ubuntu/i.test(m.systeme) ? '#E95420' : /alpine/i.test(m.systeme) ? '#0D597F' : /rocky/i.test(m.systeme) ? '#10B981' : /fedora/i.test(m.systeme) ? '#3C6EB4' : FAM[m.famille] ?? '#64748b');
  const go = (b) => (b / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  const ring = (p, label) => el('span', { class: 'ym-ring', style: `--p:${Math.max(0, Math.min(100, p ?? 0))}`, role: 'img', 'aria-label': `${label} ${p ?? 0} %` }, el('b', {}, `${p ?? 0}%`));
  const date = (t) => new Date(t).toLocaleDateString('fr-FR');

  async function preview(m, box) {
    if (m.etat?.state !== 'en marche') return;
    const r = await post('apercu_machine', { machine: m.id }); const a = r.data ?? {};
    if (a.png) box.replaceChildren(el('img', { src: `data:image/png;base64,${a.png}`, alt: `Écran de ${m.nom}` }), el('span', { class: 'tag' }, m.quarantaine ? 'isolée · bloc fermé' : '● en direct'));
    else if (a.lignes) box.replaceChildren(el('pre', {}, a.lignes.join('\n') || '(console vide)'), el('span', { class: 'tag', style: 'top:auto;bottom:8px' }, m.quarantaine ? 'isolée' : '● en direct'));
    S.previews[m.id] = box.innerHTML;
  }
  function card(m, D, redraw) {
    const run = m.etat?.state === 'en marche', q = Boolean(m.quarantaine), cat = (D.categories ?? []).find((c) => c.nom === m.categorie);
    const pv = el('div', { class: 'ym-pv' }); pv.innerHTML = S.previews[m.id] ?? ''; if (!S.previews[m.id]) pv.append(el('span', { class: 'off' }, run ? 'aperçu…' : 'éteinte'));
    const btn = (i, label, fn, cls = '') => el('button', { class: `ym-btn ${cls}`, type: 'button', title: label, 'aria-label': label, onclick: async (e) => { e.stopPropagation(); const b = e.currentTarget; b.disabled = true; const x = await fn(); b.disabled = false; note(x); if (x?.ok !== false) await redraw(); } }, ic(i, 15));
    const c = el('div', { class: `ym-c${q ? ' q' : ''}`, role: 'button', tabindex: '0', 'aria-current': String(S.sel === m.id), onclick: () => { S.sel = m.id; redraw(); }, onkeydown: (e) => { if (e.key === 'Enter') { S.sel = m.id; redraw(); } } },
      el('div', { class: 'hd' }, el('span', { class: 'lg', style: `background:${LOGO(m)}` }, m.systeme.charAt(0)), el('div', { style: 'min-width:0' }, el('b', {}, m.nom), el('span', {}, `${m.systeme} ${m.version} · ${date(m.cree)}`)), el('em', {}, m.genre === 'lxc' ? 'LXC' : 'VM')),
      pv,
      el('div', { class: 'ym-st' }, el('i', { style: `background:${q ? 'var(--ybad)' : run ? 'var(--yok)' : '#94a3b8'}` }), q ? 'quarantaine' : run ? 'en marche' : 'éteinte', el('code', {}, m.ip)),
      el('div', { class: 'ym-g' }, el('div', {}, ring(run ? m.etat.cpuPct ?? 0 : 0, 'Processeur'), el('span', {}, 'CPU', el('br'), `${m.cpu} cœur${m.cpu > 1 ? 's' : ''}`)), el('div', {}, ring(run && m.etat.ramMo ? Math.round((m.etat.ramMo / m.ram) * 100) : 0, 'Mémoire'), el('span', {}, 'RAM', el('br'), m.ram >= 1024 ? `${m.ram / 1024} Go` : `${m.ram} Mo`))),
      el('div', { class: 'ym-row' }, ...(m.apps ?? []).slice(0, 3).map((a) => el('span', { class: 'ym-chip' }, (D.apps ?? []).find((x) => x.id === a)?.nom ?? a)), q ? el('span', { class: 'ym-chip bad' }, 'en quarantaine') : null, cat ? el('span', { class: 'ym-chip', style: `margin-left:auto;background:${cat.couleur}22;color:${cat.couleur}` }, cat.nom) : null),
      q ? el('button', { class: 'ym-btn bad', type: 'button', onclick: (e) => { e.stopPropagation(); S.tab = 'quarantaine'; S.sel = m.id; redraw(); } }, ic('lock', 14), 'Voir la quarantaine')
        : el('div', { class: 'ym-row' }, run ? btn('stop', 'Arrêter', () => act('arreter_machine', { machine: m.id })) : btn('play', 'Démarrer', () => act('demarrer_machine', { machine: m.id }), 'pri'), btn('lock', 'Mettre en quarantaine', () => act('isoler_machine', { machine: m.id, raison: 'à ta demande' })), btn('trash', 'Supprimer', () => act('supprimer_machine', { machine: m.id }))));
    if (run) void preview(m, pv);
    return c;
  }
  function machines(root, D, redraw) {
    const all = D.machines ?? [], fams = ['Linux', 'Windows', 'Mac', 'Autre'], cats = D.categories ?? [];
    const shown = all.filter((m) => S.filtre === 'Toutes' || m.famille === S.filtre || m.categorie === S.filtre);
    const side = el('div', { class: 'ym-w ym-side', role: 'navigation', 'aria-label': 'Ranger les machines' }, el('div', { class: 'h' }, 'Systèmes'),
      ...['Toutes', ...fams].map((f) => el('button', { type: 'button', 'aria-pressed': String(S.filtre === f), onclick: () => { S.filtre = f; redraw(); } }, el('i', { style: `background:${f === 'Toutes' ? 'var(--ya)' : FAM[f]}` }), f, el('span', {}, String(f === 'Toutes' ? all.length : all.filter((m) => m.famille === f).length)))),
      el('div', { class: 'h' }, 'Mes catégories'), ...cats.map((c) => el('button', { type: 'button', 'aria-pressed': String(S.filtre === c.nom), onclick: () => { S.filtre = c.nom; redraw(); } }, el('i', { style: `background:${c.couleur}` }), c.nom, el('span', {}, String(all.filter((m) => m.categorie === c.nom).length)))),
      el('button', { type: 'button', style: 'color:var(--muted)', onclick: async () => { const n = prompt('Nom de la nouvelle catégorie ?'); if (n) { note(await post('categorie_machines', { nom: n })); redraw(); } } }, ic('plus', 14), 'Nouvelle catégorie'),
      host(D.hote, D));
    const main = el('div', { style: 'display:flex;flex-direction:column;gap:12px;min-width:0' });
    root.append(el('div', { class: 'ym-lay' }, side, main));
    const on = all.filter((m) => m.etat?.state === 'en marche').length, q = all.filter((m) => m.quarantaine);
    const cpu = on ? Math.round(all.filter((m) => m.etat?.state === 'en marche').reduce((a, m) => a + (m.etat.cpuPct ?? 0), 0) / on) : 0;
    main.append(el('div', { class: 'ym-k' }, el('div', {}, el('small', {}, 'En marche'), el('b', {}, `${on} / ${all.length}`), el('span', {}, `${all.length - on} éteinte${all.length - on > 1 ? 's' : ''}`)), el('div', {}, el('small', {}, 'Processeur'), el('b', {}, `${cpu} %`), el('span', {}, 'moyenne des machines')),
      el('div', {}, el('small', {}, 'Mémoire'), el('b', {}, `${go(all.filter((m) => m.etat?.state === 'en marche').reduce((a, m) => a + (m.etat.ramMo ?? 0), 0) * 1048576)} Go`), el('span', {}, `sur ${go(D.hote?.ramTotal ?? 0)} Go`)),
      el('div', {}, el('small', {}, 'Protégées'), el('b', {}, `${all.filter((m) => (m.apps ?? []).includes('ullr')).length} / ${all.length}`), el('span', {}, 'antivirus chaque nuit')), el('div', {}, el('small', {}, 'Quarantaine'), el('b', { style: q.length ? 'color:var(--ybad)' : '' }, String(q.length)), el('span', {}, q.map((m) => m.nom).join(', ') || '—'))));
    if (!all.length) { main.append(el('div', { class: 'ym-w' }, el('h3', {}, ic('box', 16), 'Aucune machine sur ce PC'), el('p', { class: 'ym-empty' }, (D.manque?.lxc ?? []).length ? `Pour les LXC, installe d'abord sur ce PC : ${D.manque.lxc.join(', ')} (paquet « lxc »).` : 'Crée un LXC (léger, quelques secondes) ou une VM (depuis une ISO d\'Andromède).'), el('button', { class: 'ym-btn pri', type: 'button', onclick: () => { S.tab = 'creer'; redraw(); } }, ic('plus', 14), 'Créer une machine'))); return; }
    for (const g of [['Linux', 'Linux'], ['Windows · Mac · Autre', null]]) {
      const l = shown.filter((m) => (g[1] ? m.famille === 'Linux' : m.famille !== 'Linux')); if (!l.length) continue;
      main.append(el('div', { class: 'ym-sec' }, el('i', { style: `background:${g[1] ? FAM.Linux : FAM.Windows}` }), g[0], el('small', {}, String(l.length))), el('div', { class: 'ym-cards' }, ...l.map((m) => card(m, D, redraw))));
    }
    const sel = all.find((m) => m.id === S.sel) ?? all[0]; if (sel) main.append(detail(sel, D, redraw));
  }
  function host(h, D) {
    if (!h) return null;
    return el('div', { style: 'margin-top:14px;border-top:1px solid var(--line);padding-top:10px' }, el('div', { class: 'h', style: 'margin-top:0' }, 'Ce PC (l\'hôte d\'Odin)'),
      el('div', { class: 'ym-g', style: 'flex-direction:column;gap:8px' }, el('div', {}, ring(h.cpuPct, 'Processeur'), el('span', {}, 'Processeur', el('br'), `${h.coeurs} cœurs`)), el('div', {}, ring(Math.round((h.ramUtilisee / h.ramTotal) * 100), 'Mémoire'), el('span', {}, 'Mémoire', el('br'), `${go(h.ramUtilisee)} / ${go(h.ramTotal)} Go`)),
        h.disqueTotal ? el('div', {}, ring(Math.round((h.disqueUtilise / h.disqueTotal) * 100), 'Disque'), el('span', {}, 'Disque', el('br'), `${go(h.disqueUtilise)} / ${go(h.disqueTotal)} Go`)) : null),
      el('p', { class: 'ym-empty', style: 'font-size:12px;margin:8px 0 0' }, `Réseau des machines : ${D.reseau?.prefixe}.0/24 (pont ${D.reseau?.pont})${h.kvm ? '' : ' · sans KVM : VM lentes'}`));
  }
  function detail(m, D, redraw) {
    const h = D.hote ?? { coeurs: 8, ramTotal: 8 * 1024 ** 3 }, cpu = el('input', { type: 'range', min: '1', max: String(h.coeurs), value: String(m.cpu), 'aria-label': 'Processeur' }), ram = el('input', { type: 'range', min: '1', max: String(Math.max(1, Math.floor(h.ramTotal / 1024 ** 3))), value: String(Math.max(1, Math.round(m.ram / 1024))), 'aria-label': 'Mémoire' });
    const cv = el('b', {}, `${m.cpu} → ${m.cpu}`), rv = el('b', {}, `${Math.round(m.ram / 1024)} → ${Math.round(m.ram / 1024)} Go`);
    cpu.oninput = () => { cv.textContent = `${m.cpu} → ${cpu.value}`; }; ram.oninput = () => { rv.textContent = `${Math.round(m.ram / 1024)} → ${ram.value} Go`; };
    const out = el('p', { class: 'ym-out', role: 'status' });
    const tile = (i, t, sub, fn) => el('button', { class: 'ym-tile', type: 'button', onclick: async () => { out.textContent = '…'; const x = await fn(); if (x) { out.textContent = x.text ?? ''; note(x); if (x.ok !== false) redraw(); } else out.textContent = ''; } }, el('span', { class: 'ib' }, ic(i, 16)), el('span', {}, el('b', {}, t), el('span', {}, sub)));
    return el('div', { class: 'ym-bot' },
      el('div', { class: 'ym-w' }, el('h3', {}, `Ressources de ${m.nom}`, el('span', { class: 'r ym-chip' }, m.genre === 'lxc' ? (m.etat?.state === 'en marche' ? 'en marche : sans l\'arrêter' : 'éteinte') : 'VM : au prochain démarrage')),
        el('div', { class: 'ym-sl' }, el('span', {}, 'Processeur'), cpu, cv), el('div', { class: 'ym-sl' }, el('span', {}, 'Mémoire'), ram, rv),
        el('div', { class: 'ym-row', style: 'margin-top:8px' }, el('button', { class: 'ym-btn pri', type: 'button', onclick: async () => { const x = await post('ressources_machine', { machine: m.id, coeurs: Number(cpu.value), memoire: Number(ram.value) }); out.textContent = x.text; note(x); redraw(); } }, 'Appliquer'),
          el('label', { style: 'font-size:12.5px;color:var(--muted);display:flex;gap:6px;align-items:center;margin-left:auto' }, 'Catégorie', el('select', { class: 'ym-btn', onchange: async (e) => { note(await post('ranger_machine', { machine: m.id, categorie: e.target.value })); redraw(); } }, el('option', { value: '' }, '—'), ...(D.categories ?? []).map((c) => el('option', { value: c.nom, selected: m.categorie === c.nom }, c.nom))))), out),
      el('div', { class: 'ym-tiles' },
        tile('up', 'Exporter en .ody', 'Toute la machine dans un fichier vérifié (machine éteinte).', () => { const d = prompt('Dossier de destination (vide : Machines dans ton dossier) ?', ''); return d === null ? null : post('exporter_machine', { machine: m.id, dossier: d }); }),
        tile('down', 'Importer un .ody', 'Odin vérifie le fichier et l\'antivirus avant de la créer.', () => { const f = prompt('Chemin du fichier .ody ?'); return f ? post('importer_machine', { fichier: f }) : null; }),
        tile('copy', 'Cloner', 'La même, avec un autre nom et une autre adresse.', () => { const n = prompt('Nom de la copie ?', `${m.nom}-copie`); return n ? post('cloner_machine', { machine: m.id, nom: n }) : null; }),
        tile('save', 'Sauvegarder', (m.apps ?? []).includes('sindri') ? 'Chaque nuit avec Phénix.' : 'Exporte-la en .ody, ou ajoute Phénix à la création.', async () => ({ text: (m.apps ?? []).includes('sindri') ? 'Phénix la sauvegarde chaque nuit (plan « Machine ' + m.nom + ' »).' : 'Pas de sauvegarde automatique pour cette machine : exporte-la en .ody.' }))));
  }
  function creer(root, D, redraw) {
    const C = S.create; if (C.apps === null) C.apps = new Set((D.apps ?? []).filter((a) => a.reco).map((a) => a.id));
    const out = el('p', { class: 'ym-out', role: 'status' }), today = new Date(), d8 = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const sys = el('select', { id: 'ymSys' }, ...(C.genre === 'lxc' ? (D.modeles ?? []).map((x) => el('option', { value: `${x.dist} ${x.release}` }, `${x.titre} ${x.version} (${x.release})`)) : (D.isos ?? []).map((x) => el('option', { value: x.nom }, x.nom))));
    const fin = el('input', { id: 'ymFin', placeholder: 'ex. Nextcloud famille' }), full = el('div', { class: 'ym-empty', style: 'font-size:12px' });
    const upd = () => { const v = sys.value || ''; const md = (D.modeles ?? []).find((x) => `${x.dist} ${x.release}` === v); const base = C.genre === 'lxc' ? `${md?.titre ?? ''}-${md?.version ?? ''}` : v.split(/[-_ ]/)[0]; full.textContent = `Sur le réseau : ${`${base}-${d8}-${fin.value}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.maison`; };
    sys.onchange = upd; fin.oninput = upd; upd();
    const sl = (label, min, max, val, unit) => { const i = el('input', { type: 'range', min: String(min), max: String(max), value: String(val), 'aria-label': label }), b = el('b', {}, `${val} ${unit}`); i.oninput = () => { b.textContent = `${i.value} ${unit}`; }; return [el('div', { class: 'ym-sl' }, el('span', {}, label), i, b), i]; };
    const h = D.hote ?? { coeurs: 8, ramTotal: 8 * 1024 ** 3 };
    const [cpuR, cpu] = sl('Processeur', 1, h.coeurs, 2, 'cœurs'), [ramR, ram] = sl('Mémoire', 1, Math.max(1, Math.floor(h.ramTotal / 1024 ** 3)), C.genre === 'lxc' ? 2 : 4, 'Go'), [dkR, dk] = sl('Disque', 4, 512, C.genre === 'lxc' ? 16 : 64, 'Go');
    const ip = el('input', { id: 'ymIp', placeholder: 'vide : la première libre' }), ipOk = el('span', { role: 'status' });
    const check = async () => { ipOk.textContent = '…'; const x = await post('verifier_ip', { ip: ip.value.trim() }); if (!ip.value.trim() && x.data?.ip) ip.value = x.data.ip; ipOk.className = x.data?.libre ? 'ym-ok' : 'ym-ko'; ipOk.textContent = x.data?.libre ? '● libre (vérifiée)' : '● déjà prise'; };
    ip.onchange = check; void check();
    const paq = el('input', { id: 'ymPaq', placeholder: 'ex. nextcloud, postgresql, redis', disabled: C.genre === 'vm' });
    const miss = C.genre === 'lxc' ? D.manque?.lxc ?? [] : D.manque?.vm ?? [];
    root.append(el('div', { class: 'ym-bot', style: 'grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)' },
      el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
        el('div', { class: 'ym-w ym-f' }, el('h3', {}, 'Système'), el('div', { class: 'ym-seg', role: 'group', 'aria-label': 'Genre' }, ...[['lxc', 'LXC (léger)'], ['vm', 'VM']].map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(C.genre === k), onclick: () => { C.genre = k; redraw(); } }, t))),
          el('label', { for: 'ymSys' }, C.genre === 'lxc' ? 'Modèle (image officielle signée)' : 'ISO d\'Andromède'), sys, C.genre === 'vm' && !(D.isos ?? []).length ? el('span', { class: 'ym-ko' }, 'Aucune ISO dans Andromède.') : null,
          el('label', { for: 'ymFin' }, 'Nom (fait par Odin, tu ajoutes la fin)'), fin, full),
        el('div', { class: 'ym-w' }, el('h3', {}, 'Ressources'), cpuR, ramR, dkR, el('p', { class: 'ym-empty', style: 'font-size:12px;margin:4px 0 0' }, `Ce PC : ${h.coeurs} cœurs, ${go(h.ramTotal - h.ramUtilisee)} Go de mémoire libre${h.disqueTotal ? `, ${go(h.disqueTotal - h.disqueUtilise)} Go de disque libre` : ''}.`)),
        el('div', { class: 'ym-w ym-f' }, el('h3', {}, 'Réseau'), el('label', { for: 'ymIp' }, 'Adresse IP'), el('div', { style: 'display:flex;gap:8px;align-items:center' }, ip, ipOk), el('p', { class: 'ym-empty', style: 'font-size:12px;margin:0' }, `Passerelle ${D.reseau?.passerelle} · DNS ${D.reseau?.dns} · pont ${D.reseau?.pont}. Odin vérifie que personne ne répond sur l'adresse.`))),
      el('div', { class: 'ym-w ym-f' }, el('h3', {}, 'Applis d\'Odin branchées sur cette machine', el('small', { class: 'r' }, `${C.apps.size} choisie${C.apps.size > 1 ? 's' : ''}`)),
        el('div', { class: 'ym-apps' }, ...(D.apps ?? []).map((a) => { const ok = C.genre === 'lxc' ? a.lxc : a.vm; return el('label', { style: ok ? '' : 'opacity:.5' }, el('input', { type: 'checkbox', checked: C.apps.has(a.id) && ok, disabled: !ok, onchange: (e) => { if (e.target.checked) C.apps.add(a.id); else C.apps.delete(a.id); } }), el('span', {}, el('b', {}, a.nom), el('small', {}, ok ? a.quoi : 'pas pour une VM'))); })),
        el('label', { for: 'ymPaq', style: 'margin-top:8px' }, 'Et en plus (logiciels de la distribution)'), paq,
        miss.length ? el('p', { class: 'ym-ko' }, `Il manque sur ce PC : ${miss.join(', ')}.`) : null,
        el('div', { class: 'ym-row', style: 'margin-top:10px' }, el('button', { class: 'ym-btn pri', type: 'button', style: 'min-height:42px;padding:0 18px', disabled: Boolean(miss.length) || (C.genre === 'vm' && !(D.isos ?? []).length), onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; out.textContent = C.genre === 'lxc' ? 'Téléchargement de l\'image et création… (quelques minutes la première fois)' : 'Création du disque et démarrage…';
          const x = await act('creer_machine', { genre: C.genre, ...(C.genre === 'lxc' ? { modele: sys.value } : { iso: sys.value }), fin: fin.value, coeurs: Number(cpu.value), memoire: Number(ram.value), disque: Number(dk.value), ip: ip.value.trim(), apps: [...C.apps].join(','), paquets: paq.value });
          b.disabled = false; out.textContent = x.text; note(x); if (x.ok !== false) { S.tab = 'machines'; S.sel = x.data?.id ?? null; C.apps = null; setTimeout(redraw, 1500); }
        } }, ic('plus', 15), 'Créer et installer')), out)));
  }
  async function quarantaine(root, D, redraw) {
    const q = (D.machines ?? []).filter((m) => m.quarantaine);
    if (!q.length) { root.append(el('div', { class: 'ym-w' }, el('h3', {}, ic('shield', 16), 'Aucune machine en quarantaine'), el('p', { class: 'ym-empty' }, D.autoIsoler ? 'Règle « rouge = isoler » active : une alerte critique sur une machine l\'isole tout de suite (tu peux annuler).' : 'Règle « rouge = isoler » coupée : Odin te prévient seulement.'),
      el('button', { class: 'ym-btn', type: 'button', onclick: async () => { note(await post('auto_isoler', { actif: !D.autoIsoler })); redraw(); } }, D.autoIsoler ? 'Couper la règle' : 'Activer la règle'))); return; }
    const m = q.find((x) => x.id === S.sel) ?? q[0];
    const det = (await post('quarantaine_machine', { machine: m.id })).data ?? {}, Q = m.quarantaine, out = el('p', { class: 'ym-out', role: 'status' });
    const list = el('div', { class: 'ym-w ym-side' }, el('div', { class: 'h', style: 'margin-top:0' }, 'Machines'), ...(D.machines ?? []).map((x) => el('button', { type: 'button', 'aria-pressed': String(x.id === m.id), disabled: !x.quarantaine, onclick: () => { S.sel = x.id; redraw(); } }, el('i', { style: `background:${x.quarantaine ? 'var(--ybad)' : 'var(--yok)'}` }), el('span', { class: 't', title: x.nom }, x.nom), el('span', {}, x.quarantaine ? 'isolée' : 'protégée'))),
      el('p', { class: 'ym-empty', style: 'font-size:12.5px;margin:12px 6px 0;padding:10px;border-radius:12px;background:color-mix(in srgb,var(--ybad) 10%,transparent)' }, `${q.length} machine${q.length > 1 ? 's' : ''} isolée${q.length > 1 ? 's' : ''} : ni Internet, ni DNS, ni réseau maison. Seul Odin entre, pour analyser.`));
    const main = el('div', { style: 'display:flex;flex-direction:column;gap:12px;min-width:0' });
    root.append(el('div', { class: 'ym-lay' }, list, main));
    const run = async (b, action, input) => { b.disabled = true; out.textContent = '…'; const x = await act(action, input); b.disabled = false; out.textContent = x.text; note(x); if (x.ok !== false) redraw(); };
    main.append(el('div', { class: 'ym-top' }, el('div', {}, el('h2', {}, m.nom, ' ', el('span', { class: 'ym-chip bad', style: 'font-size:12px;vertical-align:middle' }, `en quarantaine depuis ${new Date(Q.depuis).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`)), el('p', {}, `${m.systeme} ${m.version} · ${m.genre === 'lxc' ? 'LXC' : 'VM'} · ${m.ip} (bloc fermé) · ${Q.raison}`)),
      el('div', { class: 'ym-row', style: 'margin-left:auto' }, el('button', { class: 'ym-btn blue', type: 'button', disabled: m.genre === 'vm', title: m.genre === 'vm' ? 'Pas encore pour une VM' : '', onclick: (e) => run(e.currentTarget, 'analyser_machine', { machine: m.id }) }, ic('search', 14), 'Analyse complète'))));
    const ch = det.chemin ?? [], colr = (n) => (n === 'critique' ? 'var(--ybad)' : n === 'haute' ? 'var(--ywarn)' : 'var(--yblue)');
    main.append(el('div', { class: 'ym-w' }, el('h3', {}, 'D\'où vient le souci', el('small', {}, 'retracé par Odin à partir des alertes')),
      ch.length ? el('div', { class: 'ym-tl' }, ...ch.map((a) => el('div', { style: `color:${colr(a.niveau)}` }, el('span', {}, new Date(a.at).toLocaleTimeString('fr-FR')), el('i', {}, ic('alert', 18)), el('b', {}, a.titre.slice(0, 60)), el('span', {}, a.module)))) : el('p', { class: 'ym-empty' }, 'Aucune alerte liée à cette machine : isolée à ta demande.')));
    const A = Q.analyse;
    main.append(el('div', { class: 'ym-bot' },
      el('div', { class: 'ym-w' }, el('h3', {}, 'Analyse complète'), el('p', { style: 'margin:0 0 10px;font-size:13.5px' }, A ? `${A.propre ? '✅ Propre' : '⚠ À regarder'} · ${new Date(A.at).toLocaleString('fr-FR')} · ${A.texte}` : m.genre === 'vm' ? 'Pour une VM, Odin ne lit pas encore son disque : analyse-la de l\'intérieur.' : 'Pas encore lancée.'),
        el('div', { class: 'ym-row' }, el('button', { class: 'ym-btn', type: 'button', disabled: !(A?.propre && A.at > Q.depuis), onclick: (e) => run(e.currentTarget, 'liberer_machine', { machine: m.id }) }, ic('unlock', 14), 'Sortir de la quarantaine'), el('span', { class: 'ym-empty', style: 'font-size:12px' }, 'possible quand l\'analyse est propre'),
          el('button', { class: 'ym-btn bad', type: 'button', style: 'margin-left:auto', onclick: (e) => run(e.currentTarget, 'supprimer_machine', { machine: m.id }) }, ic('trash', 14), 'Supprimer')), out),
      el('div', { class: 'ym-w' }, el('h3', {}, 'Ce qu\'Odin a fait tout seul', el('small', {}, 'journal')),
        ...(Q.journal ?? []).map((j) => el('div', { class: 'ym-j' }, el('span', { class: 'ok' }, ic('check', 15)), el('span', { class: 'tx' }, j.quoi, j.detail ? el('small', {}, ` · ${j.detail}`) : null), j.annuler ? el('button', { class: 'ym-btn', type: 'button', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; const x = j.annuler.module ? await (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: j.annuler.module, action: j.annuler.action, input: j.annuler.input }) })).json() : await act(j.annuler.action, j.annuler.input); b.disabled = false; note(x); redraw(); } }, j.annuler.label) : null)))));
  }

  window.OdinPages.ymir = async ({ host, generic }) => {
    if (!document.getElementById('ymCss')) document.head.append(el('style', { id: 'ymCss' }, CSS));
    const root = el('div', { class: 'ym' }), body = el('div', { class: 'ym' }), gen = el('div', {}, ...(generic ?? [])), tabs = el('div', { class: 'ym-tabs', role: 'tablist' }), sub = el('p', {});
    root.append(el('div', { class: 'ym-top' }, el('div', {}, el('h2', {}, 'Toutes les machines'), sub), tabs), body, gen); host.append(root);
    const redraw = async () => {
      tabs.replaceChildren(...[['machines', 'grid', 'Machines'], ['creer', 'plus', 'Créer'], ['quarantaine', 'lock', 'Quarantaine'], ['serveurs', 'list', 'Serveurs']].map(([id, i, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(S.tab === id), onclick: () => { S.tab = id; redraw(); } }, ic(i, 15), t)));
      gen.hidden = S.tab !== 'serveurs'; body.hidden = S.tab === 'serveurs'; if (S.tab === 'serveurs') return;
      const r = await post('tableau_machines'), D = r.data ?? {}, n = el('div', { class: 'ym' }), all = D.machines ?? [];
      sub.textContent = `${all.filter((m) => m.genre === 'lxc').length} LXC et ${all.filter((m) => m.genre === 'vm').length} VM sur ce PC · rangées par système`;
      if (S.tab === 'creer') creer(n, D, redraw); else if (S.tab === 'quarantaine') await quarantaine(n, D, redraw); else machines(n, D, redraw);
      body.replaceChildren(...n.childNodes);
    };
    await redraw();
    // L'aperçu et les chiffres se relisent toutes les 10 s sur l'onglet Machines.
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (!root.isConnected) { clearInterval(S.timer); return; } if (S.tab === 'machines' && !document.hidden) void redraw(); }, 10000);
  };
})();
