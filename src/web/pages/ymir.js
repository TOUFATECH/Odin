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
  const post = async (action, input = {}, confirm = false) => {
    try { return await (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'ymir', action, input, confirm }) })).json(); }
    catch { return { ok: false, text: 'Odin est injoignable pour l\'instant (connexion indisponible).' }; }
  };
  const act = async (action, input = {}) => { let r = await post(action, input); if (r.confirm) { if (!(await window.OdinDialog.confirm(r.confirm, { danger: true }))) return { ok: false, text: 'Annulé.' }; r = await post(action, input, true); } return r; };
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
.ym-tabs{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap}@media (max-width:600px){.ym-tabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;max-width:100%;min-width:0;padding:2px;margin:-2px}.ym-tabs::-webkit-scrollbar{display:none}.ym-tabs button{flex:none;white-space:nowrap}}.ym-tabs button{min-height:36px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 85%,transparent);color:var(--ink);font:600 13.5px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
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
.ym-bot{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:12px}.ym-bot.ym-bot-cr{grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)}@media (max-width:1000px){.ym-bot,.ym-bot.ym-bot-cr{grid-template-columns:minmax(0,1fr)}}
.ym-tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ym-tile{border:1px solid var(--line);border-radius:16px;padding:12px;display:flex;gap:10px;background:color-mix(in srgb,var(--panel) 88%,transparent);cursor:pointer;text-align:left;color:var(--ink);font:inherit}.ym-tile b{display:block;font-size:14px}.ym-tile span{font-size:12.5px;color:var(--muted)}.ym-tile .ib{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:color-mix(in srgb,var(--ya) 14%,transparent);color:var(--ya);flex:none}
.ym-sl{display:grid;grid-template-columns:90px 1fr 70px;gap:10px;align-items:center;font-size:13.5px;margin:6px 0}.ym-sl input{width:100%;accent-color:var(--yblue)}.ym-sl b{text-align:right;color:var(--ya)}
.ym-f{display:flex;flex-direction:column;gap:6px}.ym-f label{font-size:12.5px;color:var(--muted)}.ym-f input,.ym-f select{min-height:38px;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 10px;font:inherit}
.ym-seg{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ym-seg button{min-height:40px;border-radius:12px;border:1px solid var(--line);background:none;color:var(--ink);font:600 14px inherit;cursor:pointer}.ym-seg button[aria-pressed=true]{background:var(--ya);color:#fff;border-color:transparent}
.ym-apps{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),1fr));gap:8px}.ym-apps label{display:flex;gap:10px;align-items:center;min-width:0;overflow-wrap:anywhere;border:1px solid var(--line);border-radius:12px;padding:10px;cursor:pointer;font-size:13.5px}.ym-apps label:has(input:checked){border-color:var(--ya);background:color-mix(in srgb,var(--ya) 8%,transparent)}.ym-apps small{display:block;color:var(--muted);font-size:12px}.ym-apps input{width:18px;height:18px;accent-color:var(--ya)}
.ym-ok{font-size:12px;color:var(--yok);font-weight:600}.ym-ko{font-size:12px;color:var(--ybad);font-weight:600}
.ym-tl{display:flex;gap:6px;overflow-x:auto;padding:4px 0}.ym-tl div{min-width:130px;text-align:center;font-size:12px}.ym-tl i{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;margin:6px auto;border:2px solid currentColor}.ym-tl b{display:block;font-size:12.5px;color:var(--ink)}.ym-tl span{color:var(--muted)}
.ym-j{display:flex;gap:10px;align-items:center;padding:7px 0;border-top:1px solid var(--line);font-size:13.5px}.ym-j:first-of-type{border-top:0}.ym-j .tx{flex:1}.ym-j .ok{color:var(--yok);flex:none}.ym-j small{color:var(--muted)}
.ym-out{font-size:13px;white-space:pre-wrap;color:var(--muted);margin:8px 0 0}.ym-empty{font-size:13.5px;color:var(--muted)}
.ym-drop{border:2px dashed var(--line);border-radius:18px;padding:22px 16px;text-align:center;color:var(--muted);font-size:14px;transition:border-color .15s,background .15s}.ym-drop.sur{border-color:var(--ya);background:color-mix(in srgb,var(--ya) 9%,transparent);color:var(--ink)}
.ym-env{display:flex;flex-direction:column;gap:5px;padding:9px 0;border-top:1px solid var(--line);font-size:13px}.ym-env:first-child{border-top:0}.ym-env .l{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.ym-env .l b{flex:1;min-width:0;overflow-wrap:anywhere}.ym-env .l span{color:var(--muted);font-variant-numeric:tabular-nums}
.ym-bar{height:10px;border-radius:999px;background:color-mix(in srgb,var(--ink) 10%,transparent);overflow:hidden}.ym-bar i{display:block;height:100%;width:0;border-radius:999px;background:var(--ya) linear-gradient(110deg,transparent 0 40%,rgba(255,255,255,.38) 50%,transparent 60% 100%);background-size:220% 100%;transition:width .35s ease;animation:ymBar 1.3s linear infinite}.ym-bar.fin i{animation:none;background:var(--yok)}.ym-bar.ko i{animation:none;background:var(--ybad)}
@keyframes ymBar{from{background-position:120% 0}to{background-position:-120% 0}}@media (prefers-reduced-motion:reduce){.ym-bar i{animation:none;transition:none}}
.ym-load{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:240px;padding:28px 16px;text-align:center}.ym-load.petit{min-height:120px;padding:14px 10px}
.ym-load .b{position:relative;width:min(440px,88%);height:16px;border-radius:999px;background:color-mix(in srgb,var(--ink) 9%,var(--panel));border:1px solid var(--line);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.08)}
.ym-load .b i{position:absolute;top:0;bottom:0;left:-42%;width:42%;border-radius:999px;background:linear-gradient(90deg,transparent,var(--accent,var(--ya)) 28%,var(--accent,var(--ya)) 72%,transparent);animation:ymFile 1.05s cubic-bezier(.4,0,.6,1) infinite}
.ym-load .b.p i{left:0;width:var(--p,0%);background:var(--accent,var(--ya));animation:none;transition:width .35s ease}
.ym-load .b::after{content:'';position:absolute;inset:0;background:linear-gradient(110deg,transparent 0 40%,rgba(255,255,255,.5) 50%,transparent 60% 100%);background-size:240% 100%;animation:ymReflet 1.5s linear infinite;pointer-events:none}
.ym-load .pc{font-size:24px;font-weight:800;letter-spacing:-.4px;color:var(--ink);font-variant-numeric:tabular-nums;min-height:1.2em}.ym-load p{margin:0;color:var(--ink);font-size:14px;max-width:560px;overflow-wrap:anywhere}.ym-load small{color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}
@keyframes ymFile{from{left:-42%}to{left:100%}}@keyframes ymReflet{from{background-position:130% 0}to{background-position:-130% 0}}
@media (prefers-reduced-motion:reduce){.ym-load .b i,.ym-load .b::after{animation:none}.ym-load .b::after{display:none}.ym-load .b:not(.p) i{left:0;width:100%;opacity:.4}.ym-load .b.p i{transition:none}}
.ym-iso{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:12px}.ym-iso .c{border:1px solid var(--line);border-radius:16px;padding:12px;display:flex;gap:12px;min-width:0;background:color-mix(in srgb,var(--panel) 92%,transparent)}.ym-iso img{width:44px;height:44px;border-radius:11px;flex:none}.ym-iso .t{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}.ym-iso b{font-size:14px;overflow-wrap:anywhere}.ym-iso small{color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.ym-nav{display:flex;flex-direction:column;gap:2px;max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:6px}.ym-nav button{display:flex;gap:8px;align-items:center;min-height:36px;padding:0 10px;border:0;border-radius:9px;background:none;color:var(--ink);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}.ym-nav button:hover{background:color-mix(in srgb,var(--ink) 7%,transparent)}.ym-nav button span{margin-left:auto;color:var(--muted);font-size:12px}
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
      el('button', { type: 'button', style: 'color:var(--muted)', onclick: async () => { const n = await window.OdinDialog.prompt('Nom de la nouvelle catégorie ?'); if (n) { note(await post('categorie_machines', { nom: n })); redraw(); } } }, ic('plus', 14), 'Nouvelle catégorie'),
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
    // Le disque ne fait que grandir (le curseur part de la taille actuelle).
    const dk = el('input', { type: 'range', min: String(m.disque), max: String(Math.max(m.disque * 4, 512)), value: String(m.disque), 'aria-label': 'Disque' }), dv = el('b', {}, `${m.disque} Go`);
    dk.oninput = () => { dv.textContent = dk.value === String(m.disque) ? `${m.disque} Go` : `${m.disque} → ${dk.value} Go`; };
    const ipIn = el('input', { value: m.ip, 'aria-label': 'Adresse IP fixe', style: 'min-height:34px;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 10px;font:inherit;width:140px' });
    const out = el('p', { class: 'ym-out', role: 'status' });
    // Console : une commande dans un LXC, ou le clavier de l'écran d'une VM. La réponse vient de la machine (une donnée).
    const run = m.etat?.state === 'en marche', cOut = el('pre', { class: 'ym-out', style: 'max-height:220px;overflow:auto;font:12px/1.4 ui-monospace,monospace;background:#0f1530;color:#9fe3b0;border-radius:10px;padding:8px 10px;margin:8px 0 0', role: 'status' });
    const cIn = el('input', { 'aria-label': m.genre === 'lxc' ? 'Commande' : 'Texte à taper', placeholder: m.genre === 'lxc' ? 'ex. df -h' : 'texte (clavier américain)', disabled: !run, style: 'flex:1;min-width:0;min-height:34px;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 10px;font:13px ui-monospace,monospace' });
    const touche = m.genre === 'vm' ? el('select', { class: 'ym-btn', 'aria-label': 'Touche spéciale', disabled: !run }, el('option', { value: '' }, 'touche…'), ...(D.touches ?? []).map((t) => el('option', { value: t }, t))) : null;
    const envoyer = async (e) => {
      const b = e.currentTarget; b.disabled = true;
      const x = m.genre === 'lxc' ? await act('console_machine', { machine: m.id, commande: cIn.value }) : await act('clavier_machine', { machine: m.id, texte: cIn.value, touche: touche?.value ?? '' });
      b.disabled = false; cOut.textContent = `${cOut.textContent ? `${cOut.textContent}\n` : ''}${m.genre === 'lxc' ? `$ ${cIn.value}\n` : ''}${x.text}`; cOut.scrollTop = cOut.scrollHeight;
      if (x.ok !== false) { cIn.value = ''; if (touche) touche.value = ''; } note(x);
    };
    cIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.parentElement.querySelector('.ym-send')?.click(); } };
    const tile = (i, t, sub, fn) => el('button', { class: 'ym-tile', type: 'button', onclick: async () => { out.textContent = '…'; const x = await fn(); if (x) { out.textContent = x.text ?? ''; note(x); if (x.ok !== false) redraw(); } else out.textContent = ''; } }, el('span', { class: 'ib' }, ic(i, 16)), el('span', {}, el('b', {}, t), el('span', {}, sub)));
    return el('div', { class: 'ym-bot' },
      el('div', { class: 'ym-w' }, el('h3', {}, `Ressources de ${m.nom}`, el('span', { class: 'r ym-chip' }, m.genre === 'lxc' ? (m.etat?.state === 'en marche' ? 'en marche : sans l\'arrêter' : 'éteinte') : 'VM : au prochain démarrage')),
        el('div', { class: 'ym-sl' }, el('span', {}, 'Processeur'), cpu, cv), el('div', { class: 'ym-sl' }, el('span', {}, 'Mémoire'), ram, rv), el('div', { class: 'ym-sl' }, el('span', {}, 'Disque'), dk, dv),
        el('div', { class: 'ym-row', style: 'margin-top:6px' }, el('span', { style: 'font-size:13.5px;width:90px' }, 'Adresse fixe'), ipIn, el('button', { class: 'ym-btn', type: 'button', onclick: async () => { if (ipIn.value.trim() === m.ip) return; const x = await act('ip_machine', { machine: m.id, ip: ipIn.value.trim() }); out.textContent = x.text; note(x); if (x.ok !== false) redraw(); } }, 'Changer')),
        el('div', { class: 'ym-row', style: 'margin-top:8px' }, el('button', { class: 'ym-btn pri', type: 'button', onclick: async () => {
          const x = await post('ressources_machine', { machine: m.id, coeurs: Number(cpu.value), memoire: Number(ram.value) }); let t = x.text; note(x);
          if (Number(dk.value) > m.disque) { const y = await act('disque_machine', { machine: m.id, disque: Number(dk.value) }); t += `\n${y.text}`; note(y); }
          out.textContent = t; redraw();
        } }, 'Appliquer'),
          el('label', { style: 'font-size:12.5px;color:var(--muted);display:flex;gap:6px;align-items:center;margin-left:auto' }, 'Catégorie', el('select', { class: 'ym-btn', onchange: async (e) => { note(await post('ranger_machine', { machine: m.id, categorie: e.target.value })); redraw(); } }, el('option', { value: '' }, '—'), ...(D.categories ?? []).map((c) => el('option', { value: c.nom, selected: m.categorie === c.nom }, c.nom))))), out),
      el('div', { class: 'ym-tiles' },
        tile('up', 'Exporter en .ody', 'Toute la machine dans un fichier vérifié (machine éteinte).', async () => { const d = await window.OdinDialog.prompt('Dossier de destination (vide : Machines dans ton dossier) ?', ''); return d === null ? null : post('exporter_machine', { machine: m.id, dossier: d }); }),
        tile('down', 'Importer un .ody', 'Odin vérifie le fichier et l\'antivirus avant de la créer.', async () => { const f = await window.OdinDialog.prompt('Chemin du fichier .ody ?'); return f ? post('importer_machine', { fichier: f }) : null; }),
        tile('copy', 'Cloner', 'La même, avec un autre nom et une autre adresse.', async () => { const n = await window.OdinDialog.prompt('Nom de la copie ?', `${m.nom}-copie`); return n ? post('cloner_machine', { machine: m.id, nom: n }) : null; }),
        tile('save', 'Sauvegarder', (m.apps ?? []).includes('sindri') ? 'Chaque nuit avec Phénix.' : 'Exporte-la en .ody, ou ajoute Phénix à la création.', async () => ({ text: (m.apps ?? []).includes('sindri') ? 'Phénix la sauvegarde chaque nuit (plan « Machine ' + m.nom + ' »).' : 'Pas de sauvegarde automatique pour cette machine : exporte-la en .ody.' })),
        tile('grid', m.estModele ? 'Ce n\'est plus un modèle' : 'Faire un modèle', m.estModele ? 'Elle redevient une machine qui démarre.' : 'Machine éteinte : on crée ensuite des machines depuis elle.', () => post('modele_machine', { machine: m.id, modele: !m.estModele }))),
      el('div', { class: 'ym-w', style: 'grid-column:1/-1' }, el('h3', {}, ic('term', 16), m.genre === 'lxc' ? `Console de ${m.nom}` : `Clavier de ${m.nom}`, el('small', { class: 'r' }, run ? (m.genre === 'lxc' ? 'chaque commande demande ton accord' : 'tape sur son écran (aperçu au-dessus)') : 'machine éteinte')),
        el('div', { class: 'ym-row' }, cIn, touche, el('button', { class: 'ym-btn pri ym-send', type: 'button', disabled: !run, onclick: envoyer }, m.genre === 'lxc' ? 'Lancer' : 'Envoyer')), cOut));
  }
  function creer(root, D, redraw) {
    const C = S.create; if (C.apps === null) C.apps = new Set((D.apps ?? []).filter((a) => a.reco).map((a) => a.id));
    const out = el('p', { class: 'ym-out', role: 'status' }), today = new Date(), d8 = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    // VM : les ISO de la bibliothèque (Andromède et importées), rangées par système ; les pilotes et les anciennes versions à part.
    const isos = (D.isos ?? []).filter((x) => !x.pilotes), parSys = ['Windows', 'macOS', 'Linux', 'Autre'].map((g) => [g, isos.filter((x) => (['Windows', 'macOS', 'Linux'].includes(x.systeme) ? x.systeme : 'Autre') === g)]).filter(([, l]) => l.length);
    const sys = el('select', { id: 'ymSys' }, ...(C.genre === 'lxc' ? (D.modeles ?? []).map((x) => el('option', { value: `${x.dist} ${x.release}` }, `${x.titre} ${x.version} (${x.release})`)) : parSys.map(([g, l]) => el('optgroup', { label: g }, ...l.map((x) => el('option', { value: x.id }, `${x.detail || x.nom} · ${x.nom}${x.antivirus?.verdict === 'sain' ? ' · ✓ antivirus' : x.antivirus?.verdict === 'non analysé' ? ' · pas encore analysée' : ''}`))))));
    const fin = el('input', { id: 'ymFin', placeholder: 'ex. Nextcloud famille' }), full = el('div', { class: 'ym-empty', style: 'font-size:12px' });
    // Ce qu'Hydre règle tout seul selon le système de l'ISO choisie (UEFI, TPM, pilotes, disque, réseau), et les limites de macOS.
    const prof = el('div', { class: 'ym-empty', style: 'font-size:12.5px', role: 'status' }), macOk = el('input', { type: 'checkbox', id: 'ymMac' });
    const isoChoisie = () => isos.find((x) => x.id === sys.value);
    const upd = () => { const v = sys.value || ''; const md = (D.modeles ?? []).find((x) => `${x.dist} ${x.release}` === v); const iso = isoChoisie(); const base = C.genre === 'lxc' ? `${md?.titre ?? ''}-${md?.version ?? ''}` : (iso?.distribution || iso?.detail || iso?.nom || '').split(/[-_ ]/)[0];
      if (C.genre === 'vm') prof.replaceChildren(...(iso?.profil ? [el('b', {}, `Réglé pour ${iso.detail || iso.systeme} : `), ...(iso.profil.notes ?? []).map((n) => el('div', {}, `· ${n}`)), iso.profil.avertissement ? el('div', { class: 'ym-ko', style: 'margin-top:6px;font-weight:500' }, iso.profil.avertissement) : null, iso.profil.avertissement ? el('label', { for: 'ymMac', style: 'display:flex;gap:8px;align-items:center;margin-top:6px;color:var(--ink)' }, macOk, 'J\'ai compris ces limites') : null] : []));
      full.textContent = `Sur le réseau : ${`${base}-${d8}-${fin.value}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.maison`; };
    sys.onchange = upd; fin.oninput = upd; upd();
    const sl = (label, min, max, val, unit) => { const i = el('input', { type: 'range', min: String(min), max: String(max), value: String(val), 'aria-label': label }), b = el('b', {}, `${val} ${unit}`); i.oninput = () => { b.textContent = `${i.value} ${unit}`; }; return [el('div', { class: 'ym-sl' }, el('span', {}, label), i, b), i]; };
    const h = D.hote ?? { coeurs: 8, ramTotal: 8 * 1024 ** 3 };
    const [cpuR, cpu] = sl('Processeur', 1, h.coeurs, 2, 'cœurs'), [ramR, ram] = sl('Mémoire', 1, Math.max(1, Math.floor(h.ramTotal / 1024 ** 3)), C.genre === 'lxc' ? 2 : 4, 'Go'), [dkR, dk] = sl('Disque', 4, 512, C.genre === 'lxc' ? 16 : 64, 'Go');
    const ip = el('input', { id: 'ymIp', placeholder: 'vide : la première libre' }), ipOk = el('span', { role: 'status' });
    const check = async () => { ipOk.textContent = '…'; const x = await post('verifier_ip', { ip: ip.value.trim() }); if (!ip.value.trim() && x.data?.ip) ip.value = x.data.ip; ipOk.className = x.data?.libre ? 'ym-ok' : 'ym-ko'; ipOk.textContent = x.data?.libre ? '● libre (vérifiée)' : '● déjà prise'; };
    ip.onchange = check; void check();
    const paq = el('input', { id: 'ymPaq', placeholder: 'ex. nextcloud, postgresql, redis', disabled: C.genre === 'vm' });
    const miss = C.genre === 'lxc' ? D.manque?.lxc ?? [] : D.manque?.vm ?? [];
    // Depuis un modèle : la copie d'une machine rangée comme modèle, avec les ressources et l'adresse choisies ici.
    const G = D.gabarits ?? [];
    if (G.length) {
      const gs = el('select', { id: 'ymGab' }, ...G.map((g) => el('option', { value: g.id }, `${g.nom} (${g.genre === 'lxc' ? 'LXC' : 'VM'} ${g.systeme} ${g.version})`))), gn = el('input', { id: 'ymGabNom', placeholder: 'nom de la nouvelle machine' }), go2 = el('p', { class: 'ym-out', role: 'status' });
      root.append(el('div', { class: 'ym-w ym-f' }, el('h3', {}, ic('copy', 16), 'Depuis un modèle', el('small', { class: 'r' }, 'copie prête, ressources et adresse ci-dessous')),
        el('label', { for: 'ymGab' }, 'Modèle'), gs, el('label', { for: 'ymGabNom' }, 'Nom'), gn,
        el('div', { class: 'ym-row', style: 'margin-top:6px' }, el('button', { class: 'ym-btn pri', type: 'button', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; go2.textContent = 'Copie du modèle…';
          const x = await act('creer_depuis_modele', { modele: gs.value, nom: gn.value, coeurs: Number(document.querySelector('.ym-sl input[aria-label="Processeur"]')?.value) || '', memoire: Number(document.querySelector('.ym-sl input[aria-label="Mémoire"]')?.value) || '', ip: document.getElementById('ymIp')?.value.trim() ?? '', apps: [...C.apps].join(',') });
          b.disabled = false; go2.textContent = x.text; note(x); if (x.ok !== false) { S.tab = 'machines'; S.sel = x.data?.id ?? null; setTimeout(redraw, 1500); }
        } }, ic('plus', 15), 'Créer depuis ce modèle')), go2));
    }
    root.append(el('div', { class: 'ym-bot ym-bot-cr' },
      el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
        el('div', { class: 'ym-w ym-f' }, el('h3', {}, 'Système'), el('div', { class: 'ym-seg', role: 'group', 'aria-label': 'Genre' }, ...[['lxc', 'LXC (léger)'], ['vm', 'VM']].map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(C.genre === k), onclick: () => { C.genre = k; redraw(); } }, t))),
          el('label', { for: 'ymSys' }, C.genre === 'lxc' ? 'Modèle (image officielle signée)' : 'ISO de la bibliothèque (Andromède et importées)'), sys, C.genre === 'vm' && !isos.length ? el('span', { class: 'ym-ko' }, 'Aucune ISO dans la bibliothèque : onglet « ISO » pour en importer.') : null, C.genre === 'vm' ? prof : null,
          el('label', { for: 'ymFin' }, 'Nom (fait par Odin, tu ajoutes la fin)'), fin, full),
        el('div', { class: 'ym-w' }, el('h3', {}, 'Ressources'), cpuR, ramR, dkR, el('p', { class: 'ym-empty', style: 'font-size:12px;margin:4px 0 0' }, `Ce PC : ${h.coeurs} cœurs, ${go(h.ramTotal - h.ramUtilisee)} Go de mémoire libre${h.disqueTotal ? `, ${go(h.disqueTotal - h.disqueUtilise)} Go de disque libre` : ''}.`)),
        el('div', { class: 'ym-w ym-f' }, el('h3', {}, 'Réseau'), el('label', { for: 'ymIp' }, 'Adresse IP'), el('div', { style: 'display:flex;gap:8px;align-items:center' }, ip, ipOk), el('p', { class: 'ym-empty', style: 'font-size:12px;margin:0' }, `Passerelle ${D.reseau?.passerelle} · DNS ${D.reseau?.dns} · pont ${D.reseau?.pont}. Odin vérifie que personne ne répond sur l'adresse.`))),
      el('div', { class: 'ym-w ym-f' }, el('h3', {}, 'Applis d\'Odin branchées sur cette machine', el('small', { class: 'r' }, `${C.apps.size} choisie${C.apps.size > 1 ? 's' : ''}`)),
        el('div', { class: 'ym-apps' }, ...(D.apps ?? []).map((a) => { const ok = C.genre === 'lxc' ? a.lxc : a.vm; return el('label', { style: ok ? '' : 'opacity:.5' }, el('input', { type: 'checkbox', checked: C.apps.has(a.id) && ok, disabled: !ok, onchange: (e) => { if (e.target.checked) C.apps.add(a.id); else C.apps.delete(a.id); } }), el('span', {}, el('b', {}, a.nom), el('small', {}, ok ? a.quoi : 'pas pour une VM'))); })),
        el('label', { for: 'ymPaq', style: 'margin-top:8px' }, 'Et en plus (logiciels de la distribution)'), paq,
        miss.length ? el('p', { class: 'ym-ko' }, `Il manque sur ce PC : ${miss.join(', ')}.`) : null,
        el('div', { class: 'ym-row', style: 'margin-top:10px' }, el('button', { class: 'ym-btn pri', type: 'button', style: 'min-height:42px;padding:0 18px', disabled: Boolean(miss.length) || (C.genre === 'vm' && !isos.length), onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; out.textContent = C.genre === 'lxc' ? 'Téléchargement de l\'image et création… (quelques minutes la première fois)' : 'Création du disque et démarrage…';
          const x = await act('creer_machine', { genre: C.genre, ...(C.genre === 'lxc' ? { modele: sys.value } : { iso: sys.value, macos_compris: macOk.checked }), fin: fin.value, coeurs: Number(cpu.value), memoire: Number(ram.value), disque: Number(dk.value), ip: ip.value.trim(), apps: [...C.apps].join(','), paquets: paq.value });
          b.disabled = false; out.textContent = x.text; note(x); if (x.ok !== false) { S.tab = 'machines'; S.sel = x.data?.id ?? null; C.apps = null; setTimeout(redraw, 1500); }
        } }, ic('plus', 15), 'Créer et installer')), out)));
  }
  // ---------------- Onglet « ISO » : l'espace ISO (commun avec Andromède), l'import, la bibliothèque, la vérification
  const octets = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} Go` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
  const duree = (s) => (!Number.isFinite(s) ? '…' : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.max(1, Math.round(s))} s`);
  /** Envoie un fichier en morceaux de 8 Mo ; après une coupure, reprend là où Odin en est. `suivi` reçoit l'avancement. */
  async function envoyerIso(file, suivi) {
    const T = 8 * 1024 * 1024; let essais = 0, id = '', recu = 0, t0 = performance.now(), d0 = 0;
    const preparer = async () => { const p = await post('preparer_envoi_iso', { nom: file.name, taille: file.size }); if (!p.data?.envoi) throw new Error(p.text || 'envoi refusé'); id = p.data.envoi; recu = p.data.recu; t0 = performance.now(); d0 = recu; };
    await preparer(); if (recu > file.size) recu = 0;
    suivi({ recu, total: file.size, vitesse: 0, reste: Infinity, repris: recu > 0 });
    while (recu < file.size) {
      let r;
      try { r = await (await fetch(`/api/valhalla/morceau?module=ymir&envoi=${id}&debut=${recu}`, { method: 'POST', headers: { 'x-odin': '1', 'content-type': 'application/octet-stream' }, body: file.slice(recu, recu + T) })).json(); }
      catch (e) { if (++essais > 8) throw new Error('connexion coupée : relance l\'envoi, il reprendra où il s\'est arrêté'); suivi({ recu, total: file.size, attente: true }); await new Promise((ok) => setTimeout(ok, 2500)); await preparer().catch(() => undefined); continue; }
      if (!r.ok) { if (typeof r.recu === 'number' && /reprise/.test(r.error || '')) { recu = r.recu; continue; } throw new Error(r.error || 'envoi interrompu'); }
      essais = 0; recu = r.recu;
      const sec = (performance.now() - t0) / 1000, v = (recu - d0) / Math.max(sec, 0.001);
      suivi({ recu, total: file.size, vitesse: v, reste: v > 0 ? (file.size - recu) / v : Infinity });
    }
    suivi({ recu: file.size, total: file.size, etape: 'antivirus' });
    return post('importer_iso', { envoi: id, nom: file.name });
  }
  /**
   * La barre de chargement, au centre de la zone : une bande qui file tant qu'on ne sait pas combien il reste, puis le
   * pourcentage qui monte ; dessous, ce qui se passe (et un détail : vitesse, temps restant). Aux couleurs du thème ;
   * fixe, avec le pourcentage, si l'appareil réduit les animations. `maj({ pct, texte, detail })` la met à jour
   * (`pct: null` : retour au mouvement continu).
   */
  function charge(texte, o = {}) {
    const bar = el('div', { class: 'b', role: 'progressbar', 'aria-label': texte, 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('i', {})), pc = el('div', { class: 'pc', 'aria-hidden': 'true' }), t = el('p', { role: 'status' }, texte), d = el('small', {});
    const n = el('div', { class: `ym-load${o.petit ? ' petit' : ''}` }, bar, pc, t, d);
    n.maj = (x = {}) => {
      if (x.texte != null) { t.textContent = x.texte; bar.setAttribute('aria-label', x.texte); }
      if (x.detail != null) d.textContent = x.detail;
      if (x.pct === null) { bar.classList.remove('p'); bar.removeAttribute('aria-valuenow'); pc.textContent = ''; }
      else if (x.pct != null) { const k = Math.max(0, Math.min(100, Math.round(x.pct))); bar.classList.add('p'); bar.style.setProperty('--p', `${k}%`); bar.setAttribute('aria-valuenow', String(k)); pc.textContent = `${k} %`; }
    };
    return n;
  }
  async function isoTab(root, D, redraw) {
    const B = (await post('bibliotheque_iso')).data ?? { dossier: '', isos: [] }, plan = (await post('plan_verif_iso')).data ?? {};
    // Ce qui se passe en ce moment (import, téléchargement) : la barre au centre, en haut de l'onglet.
    const centre = charge(''), boite = el('div', { class: 'ym-w' }, centre); boite.hidden = true;
    const occupe = (texte, detail = '') => { boite.hidden = false; centre.maj({ pct: null, texte, detail }); boite.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, libre = () => { boite.hidden = true; };
    const file = el('div', { class: 'ym-w' }, el('h3', {}, ic('up', 16), 'Envois', el('small', { class: 'r' }, 'antivirus d\'abord, puis la bibliothèque'))); file.hidden = true;
    S.envois = S.envois ?? [];
    const ligne = (nom) => { const pct = el('span', {}, '0 %'), info = el('span', {}, 'en attente…'), bar = el('div', { class: 'ym-bar', role: 'progressbar', 'aria-label': `Envoi de ${nom}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, el('i', {})), msg = el('small', { style: 'color:var(--muted)', role: 'status' }); file.hidden = false; file.append(el('div', { class: 'ym-env' }, el('div', { class: 'l' }, el('b', {}, nom), pct, info), bar, msg)); return { pct, info, bar, msg }; };
    const lancer = async (files) => {
      const l = [...files].filter((f) => /\.iso$/i.test(f.name)); const refus = [...files].length - l.length;
      if (refus) note({ ok: false, text: `${refus} fichier(s) ignoré(s) : seules les images .iso vont dans l'espace ISO.` });
      for (const f of l) {   // l'un après l'autre : la barre de chacun reste lisible, et le disque suit
        const u = ligne(f.name), rang = l.length > 1 ? ` (${l.indexOf(f) + 1} sur ${l.length})` : '';
        occupe(`J'envoie ${f.name}${rang}…`);
        try {
          const x = await envoyerIso(f, (p) => {
            const k = p.total ? Math.floor((p.recu / p.total) * 100) : 0; u.bar.firstChild.style.width = `${k}%`; u.bar.setAttribute('aria-valuenow', String(k)); u.pct.textContent = `${k} %`;
            u.info.textContent = p.etape === 'antivirus' ? 'analyse antivirus…' : p.attente ? 'connexion coupée, nouvel essai…' : `${octets(p.recu)} / ${octets(p.total)}${p.vitesse ? ` · ${octets(p.vitesse)}/s · reste ${duree(p.reste)}` : ''}${p.repris ? ' · reprise' : ''}`;
            // La même chose en grand, au centre : le pourcentage qui monte, puis l'antivirus (durée inconnue : mouvement continu).
            if (p.etape === 'antivirus') centre.maj({ pct: null, texte: `L'antivirus regarde ${f.name}…`, detail: 'elle entre dans la bibliothèque juste après' });
            else centre.maj({ pct: k, texte: `J'envoie ${f.name}${rang}…`, detail: p.attente ? 'connexion coupée, nouvel essai…' : u.info.textContent });
          });
          u.bar.classList.add(x.ok === false ? 'ko' : 'fin'); u.info.textContent = x.ok === false ? 'bloquée' : 'dans la bibliothèque'; u.msg.textContent = x.text ?? ''; note(x);
        } catch (e) { u.bar.classList.add('ko'); u.info.textContent = 'arrêté'; u.msg.textContent = (window.OdinReseau && !window.OdinReseau.enLigne()) ? 'Envoi interrompu : connexion indisponible. Il reprendra au retour d\'Internet.' : (e && /fetch|network|load failed|NetworkError|Failed/i.test(String(e.message)) ? 'Envoi interrompu : connexion indisponible pour l\'instant.' : (e?.message || 'Envoi interrompu.')); }
      }
      libre();
      if (l.length) setTimeout(redraw, 1200);
    };
    const choix = el('input', { type: 'file', accept: '.iso', multiple: true, hidden: true, onchange: (e) => { void lancer(e.target.files); e.target.value = ''; } });
    const drop = el('div', { class: 'ym-drop', role: 'button', tabindex: '0', 'aria-label': 'Déposer des ISO ici, ou choisir des fichiers', onclick: () => choix.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choix.click(); } },
      ondragover: (e) => { e.preventDefault(); drop.classList.add('sur'); }, ondragleave: () => drop.classList.remove('sur'), ondrop: (e) => { e.preventDefault(); drop.classList.remove('sur'); void lancer(e.dataTransfer.files); } },
      ic('up', 22), el('div', { style: 'margin-top:6px' }, el('b', {}, 'Glisse tes ISO ici'), ' ou clique pour les choisir (plusieurs à la fois).'), el('div', { style: 'font-size:12.5px;margin-top:4px' }, 'Envoi en morceaux : une coupure ne fait rien perdre, l\'envoi reprend. Chaque ISO passe par l\'antivirus avant d\'entrer dans la bibliothèque.'));
    // Espace ISO, lien, réseau.
    const esp = el('input', { id: 'ymEsp', value: B.dossier ?? '' }), lien = el('input', { id: 'ymLien', placeholder: 'https://…/image.iso' }), out = el('p', { class: 'ym-out', role: 'status' });
    const nav = el('div', { class: 'ym-nav' }), ou = { poste: '', partage: '', dossier: '' }, fil = el('small', { style: 'color:var(--muted)' });
    const parcourir = async () => {
      fil.textContent = ou.poste ? `${ou.posteNom} › ${ou.partage || 'partages'}${ou.dossier ? ` › ${ou.dossier}` : ''}` : ou.dossier || 'Ce PC et le réseau';
      nav.replaceChildren(charge(ou.poste ? `Je lis les partages de ${ou.posteNom}…` : 'Je cherche tes images…', { petit: true }));
      const x = await post('parcourir', { poste: ou.poste, partage: ou.partage, dossier: ou.dossier }), d = x.data ?? {};
      const haut = (ou.poste || ou.dossier) ? [el('button', { type: 'button', onclick: () => { if (ou.dossier && ou.poste) ou.dossier = ou.dossier.split('/').slice(0, -1).join('/'); else if (ou.partage) ou.partage = ''; else { ou.poste = ''; ou.dossier = ''; } void parcourir(); } }, '‹ Retour')] : [];
      if (x.ok === false) { nav.replaceChildren(...haut, el('small', { class: 'ym-ko', style: 'padding:8px' }, x.text)); return; }
      nav.replaceChildren(...haut,
        ...(d.entrees ?? []).map((e) => el('button', { type: 'button', onclick: async (ev) => {
          if (e.genre === 'iso') { const b = ev.currentTarget; b.disabled = true; out.textContent = ''; occupe(`J'importe ${e.nom}…`, `${octets(e.taille ?? 0)} · copie, puis antivirus`); const r = await act('importer_iso', ou.poste ? { poste: ou.poste, partage: ou.partage, chemin: e.chemin } : { chemin: e.chemin }); libre(); out.textContent = r.text; note(r); b.disabled = false; if (r.ok !== false) setTimeout(redraw, 1200); return; }
          if (e.genre === 'partage') ou.partage = e.partage; else ou.dossier = e.chemin; void parcourir();
        } }, ic(e.genre === 'iso' ? 'save' : 'box', 15), e.nom, e.genre === 'iso' ? el('span', {}, `${octets(e.taille ?? 0)} · importer`) : null)),
        ...(!ou.poste && !ou.dossier ? (d.postes ?? []).map((p) => el('button', { type: 'button', onclick: () => { ou.poste = p.id; ou.posteNom = p.nom; ou.partage = ''; ou.dossier = ''; void parcourir(); } }, ic('screen', 15), p.nom, el('span', {}, `partages de ${p.hote}`))) : []),
        !(d.entrees ?? []).length && !(d.postes ?? []).length ? el('small', { style: 'padding:8px;color:var(--muted)' }, 'Rien ici (ni dossier ni image .iso).') : null);
    };
    const freq = el('select', { id: 'ymVf' }, ...[['mois', 'chaque mois'], ['semaine', 'chaque semaine'], ['jour', 'chaque jour']].map(([v, t]) => el('option', { value: v, selected: plan.frequence === v }, t))), jour = el('input', { id: 'ymVj', type: 'number', min: '0', max: '28', value: String(plan.jour ?? 1) }), heure = el('input', { id: 'ymVh', type: 'time', value: plan.heure ?? '04:00' }), vOut = el('p', { class: 'ym-out', role: 'status' }, plan.prochaine ? `Prochaine vérification : ${new Date(plan.prochaine).toLocaleString('fr-FR')}${plan.derniere ? ` · dernière : ${new Date(plan.derniere).toLocaleString('fr-FR')}` : ''}` : '');
    const isos = B.isos ?? [];
    root.append(choix, boite,
      el('div', { class: 'ym-bot' },
        el('div', { style: 'display:flex;flex-direction:column;gap:12px;min-width:0' },
          el('div', { class: 'ym-w' }, el('h3', {}, ic('up', 16), 'Importer des ISO'), drop),
          file,
          el('div', { class: 'ym-w ym-f' }, el('h3', {}, 'Depuis un lien'), el('label', { for: 'ymLien' }, 'Adresse http(s) de l\'image'), lien,
            el('div', { class: 'ym-row' }, el('button', { class: 'ym-btn pri', type: 'button', onclick: async (e) => { const b = e.currentTarget; if (!lien.value.trim()) return; b.disabled = true; out.textContent = ''; occupe('Je télécharge l\'image…', `${lien.value.trim().slice(0, 90)} · reprenable, puis antivirus`); const r = await act('importer_iso', { lien: lien.value.trim() }); libre(); b.disabled = false; out.textContent = r.text; note(r); if (r.ok !== false) { lien.value = ''; setTimeout(redraw, 1200); } } }, ic('down', 15), 'Télécharger et importer')), out)),
        el('div', { style: 'display:flex;flex-direction:column;gap:12px;min-width:0' },
          el('div', { class: 'ym-w ym-f' }, el('h3', {}, 'Espace ISO', el('small', { class: 'r' }, 'commun à Hydre, Andromède et Genèse')), el('label', { for: 'ymEsp' }, 'Dossier où sont rangées les images (disque ou partage monté)'), esp,
            el('div', { class: 'ym-row' }, el('button', { class: 'ym-btn', type: 'button', onclick: async () => { const r = await act('espace_iso', { dossier: esp.value.trim() }); note(r); redraw(); } }, 'Enregistrer')),
            el('p', { class: 'ym-empty', style: 'font-size:12px;margin:0' }, 'Toute image .iso qui s\'y trouve, même déposée à la main, entre dans la bibliothèque après l\'antivirus.')),
          el('div', { class: 'ym-w ym-f' }, el('h3', {}, 'Parcourir ce PC et le réseau', el('small', { class: 'r' }, 'partages montés (NFS, SMB) et postes connus')), fil, nav))),
      el('div', { class: 'ym-w' }, el('h3', {}, ic('box', 16), `Bibliothèque (${isos.length})`, el('small', { class: 'r' }, B.dossier ?? '')),
        isos.length ? el('div', { class: 'ym-iso' }, ...isos.map((f) => el('div', { class: 'c' }, el('img', { src: f.icone ?? '', alt: '', width: '44', height: '44' }),
          el('div', { class: 't' }, el('b', {}, f.nom), el('small', {}, `${f.systeme}${f.detail ? ` · ${f.detail}` : ''}${f.arch ? ` · ${f.arch}` : ''}${f.edition ? ` · ${f.edition}` : ''}`),
            el('small', {}, `${octets(f.taille)} · ${date(f.ajoute)}${f.sha256 ? ` · ${f.sha256.slice(0, 12)}…${f.editeur ? ' ✓ éditeur' : ''}` : ''}`),
            el('div', { class: 'ym-row' }, el('span', { class: `ym-chip${f.antivirus?.verdict === 'bloqué' ? ' bad' : ''}` }, f.ancienne ? 'ancienne (old)' : `antivirus : ${f.antivirus?.verdict ?? 'non analysé'}`), ...(f.vms ?? []).map((m) => el('span', { class: 'ym-chip' }, m))),
            el('div', { class: 'ym-row' }, el('button', { class: 'ym-btn', type: 'button', onclick: async () => { const r = await post('fiche_iso', { iso: f.id }); await window.OdinDialog?.alert(r.text); } }, 'Fiche'),
              el('button', { class: 'ym-btn', type: 'button', 'aria-label': `Retirer ${f.nom}`, onclick: async () => { note(await act('retirer_iso', { iso: f.id })); redraw(); } }, ic('trash', 15)))))))
          : el('p', { class: 'ym-empty' }, 'Aucune ISO pour l\'instant : importe-en une, ou laisse Andromède télécharger celles que tu suis.')),
      el('div', { class: 'ym-w ym-f' }, el('h3', {}, ic('shield', 16), 'Vérification de toutes les ISO', el('small', { class: 'r' }, 'empreinte, antivirus, nouvelles versions')),
        el('div', { class: 'ym-row' }, el('label', { for: 'ymVf' }, 'Fréquence'), freq, el('label', { for: 'ymVj' }, 'Jour'), jour, el('label', { for: 'ymVh' }, 'Heure'), heure,
          el('button', { class: 'ym-btn', type: 'button', onclick: async () => { const r = await post('verification_iso', { frequence: freq.value, jour: Number(jour.value), heure: heure.value }); vOut.textContent = r.text; note(r); } }, 'Planifier'),
          el('button', { class: 'ym-btn pri', type: 'button', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; vOut.textContent = 'Vérification en cours (empreinte de chaque image)…'; const r = await post('verifier_isos'); b.disabled = false; vOut.textContent = r.text; note(r); } }, 'Vérifier maintenant')), vOut));
    void parcourir();
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
      el('div', { class: 'ym-row', style: 'margin-left:auto' }, el('button', { class: 'ym-btn', type: 'button', title: 'La machine démarre sans aucun réseau, seulement pour l\'analyser', onclick: (e) => run(e.currentTarget, 'demarrer_machine', { machine: m.id, analyse: true }) }, ic('play', 14), 'Démarrer en mode analyse'), el('button', { class: 'ym-btn blue', type: 'button', disabled: m.genre === 'vm', title: m.genre === 'vm' ? 'Pas encore pour une VM' : '', onclick: (e) => run(e.currentTarget, 'analyser_machine', { machine: m.id }) }, ic('search', 14), 'Analyse complète'))));
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
      tabs.replaceChildren(...[['machines', 'grid', 'Machines'], ['creer', 'plus', 'Créer'], ['iso', 'down', 'ISO'], ['quarantaine', 'lock', 'Quarantaine'], ['serveurs', 'list', 'Serveurs']].map(([id, i, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(S.tab === id), onclick: () => { S.tab = id; redraw(); } }, ic(i, 15), t)));
      gen.hidden = S.tab !== 'serveurs'; body.hidden = S.tab === 'serveurs'; if (S.tab === 'serveurs') return;
      // Premier affichage d'un onglet : la barre de chargement au centre (pas pendant le rafraîchissement discret des machines).
      if (S.montre !== S.tab || !body.childNodes.length) body.replaceChildren(el('div', { class: 'ym-w' }, charge(S.tab === 'iso' ? 'Je lis tes images…' : S.tab === 'creer' ? 'Je prépare la liste des systèmes et des images…' : S.tab === 'quarantaine' ? 'Je regarde les machines en quarantaine…' : 'Je lis tes machines…')));
      S.montre = S.tab;
      const r = await post('tableau_machines'), D = r.data ?? {}, n = el('div', { class: 'ym' }), all = D.machines ?? [];
      sub.textContent = `${all.filter((m) => m.genre === 'lxc').length} LXC et ${all.filter((m) => m.genre === 'vm').length} VM sur ce PC · rangées par système`;
      if (S.tab === 'creer') creer(n, D, redraw); else if (S.tab === 'iso') await isoTab(n, D, redraw); else if (S.tab === 'quarantaine') await quarantaine(n, D, redraw); else machines(n, D, redraw);
      body.replaceChildren(...n.childNodes);
    };
    await redraw();
    // L'aperçu et les chiffres se relisent toutes les 10 s sur l'onglet Machines.
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (!root.isConnected) { clearInterval(S.timer); return; } if (S.tab === 'machines' && !document.hidden) void redraw(); }, 10000);
  };
})();
