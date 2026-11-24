// Hydre dans l'interface (maquettes validées « Toutes les machines », « Créer une machine », « Quarantaine »),
// dans le thème de la fenêtre d'Odin :
// - Machines : les LXC et VM de ce PC rangés par système, avec l'aperçu en direct (écran de la VM, console du LXC),
//   processeur et mémoire, tes catégories, ce PC (l'hôte), et pour la machine choisie : ressources, exporter, cloner.
// - Créer : système (modèle LXC ou ISO d'Andromède), nom automatique, ressources, adresse vérifiée, applis d'Odin.
// - Quarantaine : les machines isolées, d'où vient le souci, ce qu'Odin a fait, l'analyse, la sortie.
// - Serveurs : la vue générique (Proxmox, conteneurs du moteur d'Odin).
// Tout ce qui est grave (arrêter, supprimer, sortir de quarantaine) passe par ton accord.
// Lot M3 (maquette « Conteneurs et machines » validée) : les états (allumée, en pause, éteinte, en erreur) et leur filtre,
// « En dépendent : … » sur chaque carte et le bloc « Ce qui dépend de … » (registre), la suppression dans la page (nom
// écrit, disque gardé à part ou effacé, refusée tant que ce qui en dépend tourne), et sous Windows ce qui viendra.
// Lot M4 (même maquette, écrans 12 à 12e) : « Créer une VM » en quatre étapes (système prêt de la bibliothèque, machine
// et budget de ce PC, réseau et options, vérifier et créer), puis le compte rendu commun (où, comment entrer, fait et
// essayé, reste) ; le compte rendu aussi dans la fiche de chaque machine. Odin revérifie tout (la page ne décide rien).
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
    save: 'M5 3h11l3 3v15H5zM8 3v6h8M8 21v-7h8v7', screen: 'M3 4h18v12H3zM8 20h8M12 16v4', term: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5', play: 'M7 5v14l12-7z', pause: 'M7 5h4v14H7zM13 5h4v14h-4z', stop: 'M6 6h12v12H6z', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', check: 'M5 12l5 5L20 7', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', list: 'M4 6h16M4 12h16M4 18h16',
    alert: 'M12 3 2 20h20zM12 10v4M12 17h.01', mail: 'M3 5h18v14H3zM3 6l9 7 9-7', unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2',
    left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6', note: 'M6 3h9l4 4v14H6zM9 11h7M9 15h7M9 7h4',
    link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1', refresh: 'M20 11a8 8 0 1 0-2 6M20 4v7h-7', win: 'M3 5l8-1v7H3zM13 4l8-1v8h-8zM3 13h8v7l-8-1zM13 13h8v8l-8-1z',
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
.ym-c .ym-act .ym-btn{min-height:44px;min-width:44px}
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
.ym-filt{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.ym-filt button{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 85%,transparent);color:var(--ink);font:600 13.5px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}.ym-filt button[aria-pressed=true]{background:color-mix(in srgb,var(--ya) 16%,var(--panel));border-color:var(--ya)}.ym-filt button span{font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums}
.ym-dep{display:flex;gap:6px;align-items:flex-start;font-size:12.5px;font-weight:600;color:color-mix(in srgb,var(--ywarn) 72%,var(--ink));overflow-wrap:anywhere}.ym-dep svg{flex:none;margin-top:1px}.ym-dep.vif{color:color-mix(in srgb,var(--ybad) 80%,var(--ink))}
.ym-errl{font-size:12.5px;font-weight:600;color:color-mix(in srgb,var(--ybad) 82%,var(--ink));overflow-wrap:anywhere}
.ym-guard{border:2px solid var(--ybad);background:color-mix(in srgb,var(--ybad) 7%,var(--panel));border-radius:18px;padding:14px 16px;display:flex;gap:12px;min-width:0}.ym-guard>div{min-width:0;flex:1}
.ym-guard .gi{width:40px;height:40px;border-radius:12px;background:var(--ybad);color:#fff;display:grid;place-items:center;flex:none}.ym-guard .t{display:block;font-size:15.5px;overflow-wrap:anywhere}
.ym-guard ul{margin:6px 0 10px;padding-left:18px;font-size:13.5px;display:flex;flex-direction:column;gap:3px}.ym-guard li{overflow-wrap:anywhere}
.ym-guard fieldset{border:0;padding:0;margin:0 0 10px;display:flex;flex-direction:column;gap:6px;min-width:0}.ym-guard legend{font-size:13.5px;font-weight:700;margin-bottom:6px;padding:0}
.ym-guard .ch{display:flex;gap:10px;align-items:center;min-height:44px;border:1px solid var(--line);border-radius:12px;padding:6px 12px;cursor:pointer;font-size:13.5px;background:var(--panel);max-width:560px}.ym-guard .ch:has(input:checked){border-color:var(--ya);box-shadow:0 0 0 1px var(--ya)}.ym-guard .ch small{display:block;color:var(--muted);font-size:12px}.ym-guard .ch input{width:18px;height:18px;flex:none;accent-color:var(--ya)}
.ym-guard .nm{display:flex;flex-direction:column;gap:6px;max-width:460px;margin-bottom:10px}.ym-guard .nm label{font-size:13.5px}.ym-guard .nm input{min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 12px;font:14px ui-monospace,monospace;min-width:0}
.ym-guard .ym-btn{min-height:44px;padding:0 14px}.ym-guard kbd{font:12.5px ui-monospace,monospace;padding:1px 6px;border-radius:6px;border:1px solid var(--line);background:var(--panel);overflow-wrap:anywhere}.ym-guard .err{color:color-mix(in srgb,var(--ybad) 82%,var(--ink));font-weight:600;font-size:13.5px;margin:6px 0}
@media (max-width:600px){.ym-guard{flex-direction:column;padding:12px}}
.ym-win{display:flex;gap:12px}.ym-win .gi{width:40px;height:40px;border-radius:12px;background:color-mix(in srgb,var(--yblue) 16%,transparent);color:var(--yblue);display:grid;place-items:center;flex:none}.ym-win p{margin:2px 0 6px;font-size:13.5px}.ym-win ul{margin:0;padding-left:18px;font-size:13.5px;display:flex;flex-direction:column;gap:4px;color:var(--ink)}
.ym-deps{display:flex;flex-direction:column;gap:0}.ym-deps .l{display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line);font-size:13.5px}.ym-deps .l:first-child{border-top:0}.ym-deps .l span{flex:1;min-width:0;overflow-wrap:anywhere}.ym-deps .ym-btn{min-height:44px}
.ym-addep{display:grid;grid-template-columns:minmax(0,180px) minmax(0,1fr) minmax(0,90px) auto;gap:8px;align-items:end;margin-top:10px}.ym-addep label{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--muted);min-width:0}.ym-addep select,.ym-addep input{min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 10px;font:inherit;min-width:0;width:100%}.ym-addep .ym-btn{min-height:44px}@media (max-width:700px){.ym-addep{grid-template-columns:minmax(0,1fr)}}
.ym-nouv{margin-left:auto;background:var(--ya)!important;color:#fff!important;border-color:transparent!important}
.ym-cseg{display:grid;grid-template-columns:repeat(2,minmax(0,220px));gap:8px}.ym-cseg button{min-height:52px;border-radius:14px;border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 88%,transparent);color:var(--ink);font:inherit;cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:6px 14px;text-align:left;min-width:0}.ym-cseg button b{font-size:14.5px}.ym-cseg button small{font-size:12px;color:var(--muted)}.ym-cseg button[aria-pressed=true]{border-color:var(--ya);box-shadow:0 0 0 1px var(--ya);background:color-mix(in srgb,var(--ya) 10%,var(--panel))}
.ym-cv{display:flex;flex-direction:column;gap:12px;min-width:0}
.ym-steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.ym-steps button{width:100%;min-height:52px;display:flex;gap:10px;align-items:center;border-radius:14px;border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 88%,transparent);color:var(--ink);font:inherit;cursor:pointer;padding:6px 10px;text-align:left;min-width:0}
.ym-steps i{font-style:normal;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;flex:none;font-weight:800;font-size:13px;background:color-mix(in srgb,var(--ink) 9%,transparent)}.ym-steps span{min-width:0;display:flex;flex-direction:column}.ym-steps b{font-size:13.5px}.ym-steps small{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ym-steps button[aria-current=step]{border-color:var(--ya);box-shadow:0 0 0 1px var(--ya)}.ym-steps button[aria-current=step] i{background:var(--ya);color:#fff}.ym-steps button.fait i{background:color-mix(in srgb,var(--yok) 22%,transparent);color:color-mix(in srgb,var(--yok) 75%,var(--ink))}
@media (max-width:600px){.ym-steps{gap:6px}.ym-steps button{flex-direction:column;justify-content:center;gap:3px;padding:6px 4px;text-align:center}.ym-steps small{display:none}.ym-steps b{font-size:11.5px}}
.ym-et{display:flex;flex-direction:column;gap:8px}.ym-et h3:focus{outline:none}.ym-et h3:focus-visible{outline:2px solid var(--ya);outline-offset:3px;border-radius:6px}.ym-lead{margin:-4px 0 6px;color:var(--muted);font-size:13.5px}
.ym-lib{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(270px,100%),1fr));gap:10px}.ym-sys{display:flex;gap:10px;align-items:center;min-height:64px;border:1px solid var(--line);border-radius:16px;padding:10px 12px;background:color-mix(in srgb,var(--panel) 92%,transparent);color:var(--ink);font:inherit;text-align:left;cursor:pointer;min-width:0}
.ym-sys .lg{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;color:#fff;font-weight:800;flex:none}.ym-sys .t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.ym-sys b{font-size:14px;overflow-wrap:anywhere}.ym-sys small{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.ym-sys .tick{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;flex:none;border:2px solid var(--line)}.ym-sys.on{border-color:var(--ya);box-shadow:0 0 0 1px var(--ya);background:color-mix(in srgb,var(--ya) 8%,var(--panel))}.ym-sys.on .tick{background:var(--ya);border-color:var(--ya);color:#fff}
.ym-sys:disabled{cursor:default;opacity:1;background:color-mix(in srgb,var(--ink) 4%,var(--panel))}.ym-sys:disabled .lg{filter:grayscale(1);opacity:.55}.ym-sys:disabled small{color:color-mix(in srgb,var(--ywarn) 70%,var(--ink))}
.ym-opt{display:flex;gap:12px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-top:8px}.ym-opt .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.ym-opt small{color:var(--muted);font-size:12.5px}
.ym-sw{width:52px;height:44px;border:0;background:none;cursor:pointer;position:relative;flex:none;padding:0}.ym-sw::before{content:'';position:absolute;left:2px;right:2px;top:9px;height:26px;border-radius:999px;background:color-mix(in srgb,var(--ink) 18%,transparent);transition:background .15s}.ym-sw::after{content:'';position:absolute;left:6px;top:13px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .15s}
.ym-sw[aria-checked=true]::before{background:var(--ya)}.ym-sw[aria-checked=true]::after{left:28px}.ym-sw:disabled{opacity:.45;cursor:default}@media (prefers-reduced-motion:reduce){.ym-sw::before,.ym-sw::after{transition:none}}
.ym-auto{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),1fr));gap:8px;margin-top:4px}.ym-auto .ym-note{grid-column:1/-1}
.ym-ch{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:12.5px;color:var(--muted)}.ym-ch span{color:var(--ink);font-size:13px;font-weight:600}.ym-ch small{font-size:12px}
.ym-ch input,.ym-ch select,.ym-cv #ymCvNom{min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 10px;font:inherit;min-width:0;width:100%;box-sizing:border-box}.ym-cv #ymCvNom{font-family:ui-monospace,monospace;max-width:420px}
.ym-note{display:flex;gap:6px;align-items:flex-start;font-size:12.5px;color:var(--muted);margin:4px 0 0}.ym-note svg{flex:none;margin-top:2px}.ym-h{font-weight:700;font-size:13.5px;margin-top:8px}
.ym-segc{display:flex;flex-wrap:wrap;gap:8px}.ym-segc button{min-height:44px;min-width:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:none;color:var(--ink);font:600 13.5px inherit;cursor:pointer}.ym-segc button[aria-checked=true]{background:var(--ya);color:#fff;border-color:transparent}.ym-segc button:disabled{opacity:.45;cursor:default;text-decoration:line-through}
.ym-rng{display:grid;grid-template-columns:90px minmax(0,1fr) 64px;gap:10px;align-items:center;font-size:13.5px;font-weight:600;min-height:44px}.ym-rng input{width:100%;min-height:44px;accent-color:var(--ya);margin:0}.ym-rng output{text-align:right;color:var(--ya);font-weight:800}
.ym-budget{border:1px solid var(--line);border-radius:14px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;font-size:13px;margin-top:4px}.ym-budget .bar{display:flex;height:12px;border-radius:999px;overflow:hidden;background:color-mix(in srgb,var(--ink) 10%,transparent)}.ym-budget .bar i{display:block;height:100%}
.ym-budget i.od{background:#64748b}.ym-budget i.mx{background:var(--yblue)}.ym-budget i.nv{background:var(--ya)}.ym-budget i.ko{background:var(--ybad)}.ym-budget .lg{display:flex;flex-wrap:wrap;gap:4px 14px;color:var(--muted)}.ym-budget .lg span{display:inline-flex;gap:6px;align-items:center}.ym-budget .lg i{width:10px;height:10px;border-radius:3px;display:inline-block}.ym-budget small{color:var(--muted);font-size:12.5px}.ym-budget p{margin:0}
.ym-pend{margin:6px 0 0;padding:10px 12px;border-radius:12px;border:1px solid color-mix(in srgb,var(--ywarn) 60%,transparent);background:color-mix(in srgb,var(--ywarn) 10%,var(--panel));font-size:13px;font-weight:600;color:var(--ink)}
.ym-choices{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),1fr));gap:10px}.ym-choice{position:relative;display:flex;flex-direction:column;gap:4px;min-height:44px;border:1px solid var(--line);border-radius:14px;padding:12px;background:color-mix(in srgb,var(--panel) 92%,transparent);color:var(--ink);font:inherit;text-align:left;cursor:pointer;min-width:0}.ym-choice b{font-size:14px;padding-right:70px}.ym-choice span{font-size:12.5px;color:var(--muted)}
.ym-choice[aria-checked=true]{border-color:var(--ya);box-shadow:0 0 0 1px var(--ya);background:color-mix(in srgb,var(--ya) 8%,var(--panel))}.ym-choice:disabled{opacity:.55;cursor:default}.ym-choice .cs{position:absolute;right:10px;top:10px;font-size:11px;font-weight:800;color:var(--ya);background:color-mix(in srgb,var(--ya) 12%,transparent);padding:2px 8px;border-radius:999px}
.ym-recap{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:10px}.ym-rc{padding:12px 14px}.ym-rc h4{margin:0 0 6px;font-size:14px;display:flex;align-items:center;gap:8px}.ym-rc h4 .ym-btn{margin-left:auto;min-height:44px}
.ym-rc ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:13px}.ym-rc li{display:flex;gap:10px;justify-content:space-between;min-width:0}.ym-rc li>span:first-child{color:var(--muted);flex:none;max-width:45%}.ym-rc li>span:last-child{text-align:right;min-width:0;overflow-wrap:anywhere}.ym-rc .mono{font-family:ui-monospace,monospace;font-size:12.5px}
.ym-rc li.es{justify-content:flex-start}.ym-rc li.es>span:first-child{width:16px;font-weight:800;font-size:13px}.ym-rc li.es>span.ym-ok{color:var(--yok)}.ym-rc li.es>span.ym-ko{color:var(--ybad)}.ym-rc li.es>span:last-child{text-align:left;display:flex;flex-direction:column}.ym-rc li.es small{color:var(--muted);font-size:12px}
.ym-calm{display:flex;gap:12px;border:2px solid var(--yok);background:color-mix(in srgb,var(--yok) 7%,var(--panel));border-radius:16px;padding:12px 14px;margin-top:6px}.ym-calm .gi{width:36px;height:36px;border-radius:11px;background:var(--yok);color:#fff;display:grid;place-items:center;flex:none}.ym-calm p{margin:2px 0 0;font-size:13px}
.ym-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;border:1px solid var(--line);border-radius:16px;padding:8px 10px;background:color-mix(in srgb,var(--panel) 92%,transparent)}.ym-foot .grow{flex:1;min-width:160px;font-size:13px;color:var(--muted);overflow-wrap:anywhere}.ym-foot .ym-btn,.ym-cv .ym-btn,.ym-cv .ym-apps label{min-height:44px}.ym-btn.big{min-height:48px;padding:0 20px;font-size:14px}
.ym-hero{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;margin-bottom:12px}.ym-hero .gi{width:52px;height:52px;border-radius:50%;background:var(--yok);color:#fff;display:grid;place-items:center}.ym-hero h3{margin:0;font-size:19px;justify-content:center;overflow-wrap:anywhere}.ym-hero h3:focus{outline:none}.ym-hero p{margin:0;color:var(--muted);font-size:13.5px;max-width:560px}
.ym-w h3 .ym-btn.r{margin-left:auto;min-height:44px}
.ym-nav{display:flex;flex-direction:column;gap:2px;max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:6px}.ym-nav button{display:flex;gap:8px;align-items:center;min-height:36px;padding:0 10px;border:0;border-radius:9px;background:none;color:var(--ink);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}.ym-nav button:hover{background:color-mix(in srgb,var(--ink) 7%,transparent)}.ym-nav button span{margin-left:auto;color:var(--muted);font-size:12px}
`;
  // etat : le filtre par état (lot M3) ; garde : la suppression ouverte (machine, nom écrit, choix du disque, refus).
  // cg : quoi créer (une VM en 4 étapes, ou un LXC) ; cv : l'assistant « Créer une VM » (lot M4) ; cr : le compte rendu ouvert.
  const S = { tab: 'machines', filtre: 'Toutes', etat: 'tout', garde: null, sel: null, timer: 0, previews: {}, create: { genre: 'lxc', apps: null }, cg: 'vm', cv: null, cr: null };
  /** L'état montré d'une machine : allumée, en pause, éteinte ou en erreur (son état ne se lit pas, son disque a disparu). */
  const etatDe = (m) => (m.erreur ? 'erreur' : m.etat?.state === 'en marche' ? 'on' : m.etat?.state === 'en pause' ? 'pause' : 'off');
  const ETATS = [['tout', 'Toutes'], ['on', 'Allumées'], ['pause', 'En pause'], ['off', 'Éteintes'], ['erreur', 'En erreur']];
  /** Ce qui dépend d'une machine (lecture au propriétaire seul : rien si elle est refusée). */
  const depsDe = (D, m) => D.deps?.machines?.[m.id];
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
    const run = m.etat?.state === 'en marche', fige = m.etat?.state === 'en pause', q = Boolean(m.quarantaine), cat = (D.categories ?? []).find((c) => c.nom === m.categorie), err = etatDe(m) === 'erreur';
    const pv = el('div', { class: 'ym-pv' }); pv.innerHTML = S.previews[m.id] ?? ''; if (!S.previews[m.id]) pv.append(el('span', { class: 'off' }, run ? 'aperçu…' : fige ? 'en pause' : err ? 'en erreur' : 'éteinte'));
    const dep = depsDe(D, m)?.dependants ?? [], vif = dep.some((x) => x.vivant);
    // Supprimer ouvre le garde-fou (nom écrit, choix du disque) : seulement machine éteinte ou en erreur, comme la maquette.
    const supprimer = !run && !fige ? el('button', { class: 'ym-btn bad', type: 'button', title: 'Supprimer', 'aria-label': `Supprimer ${m.nom}`, 'data-sup': m.id, onclick: (e) => { e.stopPropagation(); S.garde = { id: m.id, tape: '', disque: '', refus: '' }; S.sel = m.id; redraw(); } }, ic('trash', 15)) : null;
    const btn = (i, label, fn, cls = '') => el('button', { class: `ym-btn ${cls}`, type: 'button', title: label, 'aria-label': label, onclick: async (e) => { e.stopPropagation(); const b = e.currentTarget; b.disabled = true; const x = await fn(); b.disabled = false; note(x); if (x?.ok !== false) await redraw(); } }, ic(i, 15));
    const c = el('div', { class: `ym-c${q ? ' q' : ''}`, role: 'button', tabindex: '0', 'data-carte': m.id, 'aria-current': String(S.sel === m.id), onclick: () => { S.sel = m.id; redraw(); }, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { S.sel = m.id; redraw(); } } },
      el('div', { class: 'hd' }, el('span', { class: 'lg', style: `background:${LOGO(m)}` }, m.systeme.charAt(0)), el('div', { style: 'min-width:0' }, el('b', {}, m.nom), el('span', {}, `${m.systeme} ${m.version} · ${date(m.cree)}`)), el('em', {}, m.genre === 'lxc' ? 'LXC' : 'VM')),
      pv,
      el('div', { class: 'ym-st' }, el('i', { style: `background:${q || err ? 'var(--ybad)' : run ? 'var(--yok)' : fige ? '#f59e0b' : '#94a3b8'}` }), q ? 'quarantaine' : err ? 'en erreur' : run ? 'allumée' : fige ? 'en pause' : 'éteinte', el('code', {}, m.ip)),
      err ? el('div', { class: 'ym-errl' }, m.erreur) : null,
      dep.length ? el('div', { class: `ym-dep${vif ? ' vif' : ''}` }, ic('link', 15), el('span', {}, `En dépendent : ${dep.map((x) => (x.genre === 'genese' ? `Genèse (${x.nom})` : x.genre === 'phenix' ? `Phénix (${x.nom})` : x.genre === 'arche' ? `conteneur ${x.nom}` : `${x.nombre ? `${x.nombre} ` : ''}${x.nom}`)).join(', ')}`)) : null,
      el('div', { class: 'ym-g' }, el('div', {}, ring(run ? m.etat.cpuPct ?? 0 : 0, 'Processeur'), el('span', {}, 'CPU', el('br'), `${m.cpu} cœur${m.cpu > 1 ? 's' : ''}`)), el('div', {}, ring(run && m.etat.ramMo ? Math.round((m.etat.ramMo / m.ram) * 100) : 0, 'Mémoire'), el('span', {}, 'RAM', el('br'), m.ram >= 1024 ? `${m.ram / 1024} Go` : `${m.ram} Mo`))),
      el('div', { class: 'ym-row' }, ...(m.apps ?? []).slice(0, 3).map((a) => el('span', { class: 'ym-chip' }, (D.apps ?? []).find((x) => x.id === a)?.nom ?? a)), q ? el('span', { class: 'ym-chip bad' }, 'en quarantaine') : null, cat ? el('span', { class: 'ym-chip', style: `margin-left:auto;background:${cat.couleur}22;color:${cat.couleur}` }, cat.nom) : null),
      q ? el('button', { class: 'ym-btn bad', type: 'button', onclick: (e) => { e.stopPropagation(); S.tab = 'quarantaine'; S.sel = m.id; redraw(); } }, ic('lock', 14), 'Voir la quarantaine')
        : el('div', { class: 'ym-row ym-act' }, fige ? btn('play', 'Reprendre', () => act('reprendre_machine', { machine: m.id }), 'pri') : null, run && m.genre === 'vm' ? btn('pause', 'Mettre en pause', () => act('pause_machine', { machine: m.id })) : null, run || fige ? btn('stop', 'Arrêter', () => act('arreter_machine', { machine: m.id })) : btn('play', 'Démarrer', () => act('demarrer_machine', { machine: m.id }), 'pri'), btn('lock', 'Mettre en quarantaine', () => act('isoler_machine', { machine: m.id, raison: 'à ta demande' })), supprimer));
    if (run) void preview(m, pv);
    return c;
  }
  function machines(root, D, redraw) {
    const all = D.machines ?? [], fams = ['Linux', 'Windows', 'Mac', 'Autre'], cats = D.categories ?? [];
    const rangees = all.filter((m) => S.filtre === 'Toutes' || m.famille === S.filtre || m.categorie === S.filtre), shown = rangees.filter((m) => S.etat === 'tout' || etatDe(m) === S.etat);
    const side = el('div', { class: 'ym-w ym-side', role: 'navigation', 'aria-label': 'Ranger les machines' }, el('div', { class: 'h' }, 'Systèmes'),
      ...['Toutes', ...fams].map((f) => el('button', { type: 'button', 'aria-pressed': String(S.filtre === f), onclick: () => { S.filtre = f; redraw(); } }, el('i', { style: `background:${f === 'Toutes' ? 'var(--ya)' : FAM[f]}` }), f, el('span', {}, String(f === 'Toutes' ? all.length : all.filter((m) => m.famille === f).length)))),
      el('div', { class: 'h' }, 'Mes catégories'), ...cats.map((c) => el('button', { type: 'button', 'aria-pressed': String(S.filtre === c.nom), onclick: () => { S.filtre = c.nom; redraw(); } }, el('i', { style: `background:${c.couleur}` }), c.nom, el('span', {}, String(all.filter((m) => m.categorie === c.nom).length)))),
      el('button', { type: 'button', style: 'color:var(--muted)', onclick: async () => { const n = await window.OdinDialog.prompt('Nom de la nouvelle catégorie ?'); if (n) { note(await post('categorie_machines', { nom: n })); redraw(); } } }, ic('plus', 14), 'Nouvelle catégorie'),
      host(D.hote, D));
    const main = el('div', { style: 'display:flex;flex-direction:column;gap:12px;min-width:0' });
    root.append(el('div', { class: 'ym-lay' }, side, main));
    const nb = (k) => all.filter((m) => etatDe(m) === k).length, on = all.filter((m) => m.etat?.state === 'en marche').length, fig = all.filter((m) => m.etat?.state === 'en pause').length, q = all.filter((m) => m.quarantaine);
    const cpu = on ? Math.round(all.filter((m) => m.etat?.state === 'en marche').reduce((a, m) => a + (m.etat.cpuPct ?? 0), 0) / on) : 0;
    main.append(el('div', { class: 'ym-k' }, el('div', {}, el('small', {}, 'Allumées'), el('b', {}, `${on} / ${all.length}`), el('span', {}, [`${nb('off')} éteinte${nb('off') > 1 ? 's' : ''}`, fig ? `${fig} en pause` : '', nb('erreur') ? `${nb('erreur')} en erreur` : ''].filter(Boolean).join(' · '))), el('div', {}, el('small', {}, 'Processeur'), el('b', {}, `${cpu} %`), el('span', {}, 'moyenne des machines')),
      el('div', {}, el('small', {}, 'Mémoire'), el('b', {}, `${go(all.filter((m) => m.etat?.state === 'en marche').reduce((a, m) => a + (m.etat.ramMo ?? 0), 0) * 1048576)} Go`), el('span', {}, `sur ${go(D.hote?.ramTotal ?? 0)} Go`)),
      el('div', {}, el('small', {}, 'Protégées'), el('b', {}, `${all.filter((m) => (m.apps ?? []).includes('ullr')).length} / ${all.length}`), el('span', {}, 'antivirus chaque nuit')), el('div', {}, el('small', {}, 'Quarantaine'), el('b', { style: q.length ? 'color:var(--ybad)' : '' }, String(q.length)), el('span', {}, q.map((m) => m.nom).join(', ') || '—'))));
    // Sous Windows : ce qui ne marche pas encore, et ce qui viendra (maquette, écran « Ce PC ») ; en tête, visible tout de suite au téléphone.
    if (D.windows) root.prepend(el('section', { class: 'ym-w ym-win', 'aria-labelledby': 'ymWinT' }, el('span', { class: 'gi', 'aria-hidden': 'true' }, ic('win', 20)),
      el('div', {}, el('h3', { id: 'ymWinT', style: 'margin:0 0 4px' }, 'Ce PC : Windows'), el('p', {}, D.windows.maintenant), el('ul', {}, ...(D.windows.avenir ?? []).map((t) => el('li', {}, t))))));
    if (!all.length) { main.append(el('div', { class: 'ym-w' }, el('h3', {}, ic('box', 16), 'Aucune machine sur ce PC'), el('p', { class: 'ym-empty' }, D.windows ? 'Les machines de ce PC viendront avec le moteur Windows d\'Hydre (ci-dessus).' : (D.manque?.lxc ?? []).length ? `Pour les LXC, installe d'abord sur ce PC : ${D.manque.lxc.join(', ')} (paquet « lxc »).` : 'Crée un LXC (léger, quelques secondes) ou une VM (depuis une ISO d\'Andromède).'), D.windows ? null : el('button', { class: 'ym-btn pri', type: 'button', onclick: () => { S.tab = 'creer'; redraw(); } }, ic('plus', 14), 'Créer une machine'))); return; }
    // Le filtre par état (allumées, en pause, éteintes, en erreur), avec le nombre de chacune.
    main.append(el('div', { class: 'ym-filt', role: 'group', 'aria-label': 'Filtrer par état' }, ...ETATS.filter(([k]) => k !== 'erreur' || rangees.some((m) => etatDe(m) === 'erreur') || S.etat === 'erreur').map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(S.etat === k), 'data-etat': k, onclick: () => { S.etat = k; S.focus = `[data-etat="${k}"]`; redraw(); } }, t, el('span', {}, String(k === 'tout' ? rangees.length : rangees.filter((m) => etatDe(m) === k).length)))),
      el('button', { type: 'button', class: 'ym-nouv', 'data-f': 'nouvelle-vm', onclick: () => { S.tab = 'creer'; S.cg = 'vm'; redraw(); } }, ic('plus', 15), 'Créer une VM')));
    if (S.message) { main.append(el('p', { class: 'ym-w', role: 'status', style: 'margin:0;font-size:13.5px;white-space:pre-wrap' }, S.message)); S.message = ''; }
    const g0 = S.garde && all.find((m) => m.id === S.garde.id); if (S.garde && !g0) S.garde = null;
    if (g0) main.append(garde(g0, D, redraw));
    if (!shown.length) main.append(el('p', { class: 'ym-empty', role: 'status' }, 'Aucune machine dans cet état.'));
    for (const g of [['Linux', 'Linux'], ['Windows · Mac · Autre', null]]) {
      const l = shown.filter((m) => (g[1] ? m.famille === 'Linux' : m.famille !== 'Linux')); if (!l.length) continue;
      main.append(el('div', { class: 'ym-sec' }, el('i', { style: `background:${g[1] ? FAM.Linux : FAM.Windows}` }), g[0], el('small', {}, String(l.length))), el('div', { class: 'ym-cards' }, ...l.map((m) => card(m, D, redraw))));
    }
    const sel = all.find((m) => m.id === S.sel) ?? all[0]; if (sel) main.append(detail(sel, D, redraw));
  }
  /**
   * Le garde-fou de la suppression (maquette, écran 11c ; lot M3) : ce qui en dépend relu à l'ouverture ; refusé tant
   * qu'elle tourne ou qu'un dépendant vivant existe ; sinon ce qui part et ce qui reste, le choix dit du disque (VM),
   * son nom écrit en entier. Échap ou « Garder » ferme sans rien faire.
   */
  function garde(m, D, redraw) {
    const G = S.garde, box = el('div', {});
    // Le clavier revient au bouton « Supprimer » de sa carte ; une machine en quarantaine n'en a pas : à sa carte.
    const fermer = () => { S.garde = null; S.focus = document.querySelector(`[data-sup="${m.id}"]`) ? `[data-sup="${m.id}"]` : `[data-carte="${m.id}"]`; redraw(); };
    const touche = (e) => { if (e.key === 'Escape') { e.preventDefault(); fermer(); } };
    const garder = () => el('button', { class: 'ym-btn', type: 'button', 'data-g': 'garder', onclick: fermer }, 'Garder la machine');
    const lire = async () => { G.bilan = undefined; G.err = ''; G.rendre(); const r = await post('dependants_machines', { machine: m.id }); if (S.garde !== G) return; if (r.ok === false) G.err = r.text || 'lecture impossible'; else G.bilan = r.data?.machines?.[m.id] ?? { dependants: [], bloquants: [] }; G.rendre(G.err ? 'relire' : G.bilan.bloquants.length ? 'garder' : 'nom'); };
    const relire = () => el('button', { class: 'ym-btn', type: 'button', 'data-g': 'relire', onclick: () => void lire() }, ic('refresh', 15), 'Relire');
    const cadre = (titre, ...kids) => el('div', { class: 'ym-guard', role: 'group', 'aria-labelledby': 'ymGT', onkeydown: touche }, el('span', { class: 'gi', 'aria-hidden': 'true' }, ic('trash', 22)), el('div', {}, el('b', { class: 't', id: 'ymGT' }, titre), ...kids));
    const vm = m.genre === 'vm', tourne = m.etat?.state === 'en marche' || m.etat?.state === 'en pause';
    function rendre(focus) {
      let n;
      if (tourne) n = cadre(`Supprimer « ${m.nom} » ?`, el('p', { class: 'err', role: 'alert' }, `${m.nom} est ${m.etat.state === 'en pause' ? 'en pause' : 'allumée'} : arrête-la d'abord.`), el('div', { class: 'ym-row' }, garder()));
      else if (G.err) n = cadre(`Supprimer « ${m.nom} » ?`, el('p', { class: 'err', role: 'alert' }, `Odin ne peut pas dire ce qui en dépend : ${G.err}`), el('div', { class: 'ym-row' }, relire(), garder()));
      else if (!G.bilan) n = cadre(`Supprimer « ${m.nom} » ?`, el('p', { role: 'status', style: 'margin:6px 0 10px;font-size:13.5px' }, 'Je regarde ce qui en dépend…'), el('div', { class: 'ym-row' }, garder()));
      else if (G.bilan.bloquants.length) n = cadre(`« ${m.nom} » ne peut pas être supprimée maintenant`, el('ul', { role: 'alert' }, ...G.bilan.bloquants.map((b) => el('li', {}, b))), el('div', { class: 'ym-row' }, relire(), garder()));
      else {
        const restes = G.bilan.dependants.filter((x) => !x.vivant).map((x) => x.texte);
        const pret = () => G.tape.trim().toLowerCase() === m.nom.toLowerCase() && (!vm || G.disque === 'garder' || G.disque === 'effacer');
        const ok = el('button', { class: 'ym-btn bad', type: 'button', 'data-g': 'ok', disabled: G.occupe || !pret(), onclick: async () => {
          if (G.occupe || !pret()) return;
          G.occupe = true; G.refus = ''; ok.disabled = true; etat.textContent = 'Suppression…';
          const r = await post('supprimer_machine', { machine: m.id, nom: G.tape, disque: vm ? G.disque : 'effacer' }, true);
          G.occupe = false;
          if (r.ok !== false && !r.confirm) { S.garde = null; note(r); S.message = r.text; redraw(); return; }
          G.refus = r.text || r.confirm || 'refusé'; etat.textContent = ''; await lire();
        } }, ic('trash', 15), 'Supprimer la machine');
        const etat = el('span', { role: 'status', class: 'ym-empty', style: 'font-size:12.5px' });
        const champ = el('input', { id: 'ymGNom', type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'aria-describedby': 'ymGAide', value: G.tape,
          oninput: (e) => { G.tape = e.target.value; ok.disabled = G.occupe || !pret(); }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } } });
        const choix = (v, t, sous) => el('label', { class: 'ch' }, el('input', { type: 'radio', name: 'ymGDisque', value: v, checked: G.disque === v, onchange: () => { G.disque = v; ok.disabled = G.occupe || !pret(); } }), el('span', {}, el('b', {}, t), el('small', {}, sous)));
        n = cadre(`Supprimer la machine « ${m.nom} » ?`,
          el('ul', {}, el('li', {}, vm ? `Ce qui part : la machine de la liste d'Hydre, son adresse ${m.ip}${m.quarantaine ? ' (elle était en quarantaine)' : ''}.` : `Ce qui part : le conteneur, son disque (${m.disque} Go) et son adresse ${m.ip}. Pour garder son disque, exporte-le d'abord en .ody.`),
            el('li', {}, `Ce qui reste : ${['les copies exportées en .ody', ...restes.map((x) => x.replace(/\.$/, ''))].join(' ; ')}.`)),
          vm ? el('fieldset', {}, el('legend', {}, `Son disque (${m.disque} Go) :`), choix('garder', 'Le garder à part', 'rangé dans le dossier « gardes » d\'Hydre, sur ce PC'), choix('effacer', 'L\'effacer', `${m.disque} Go libérés ; ça ne se rattrape pas sans sauvegarde`)) : null,
          G.refus ? el('p', { class: 'err', role: 'alert' }, G.refus) : null,
          el('div', { class: 'nm' }, el('label', { for: 'ymGNom' }, 'Écris ', el('kbd', {}, m.nom), ' pour confirmer :'), champ, el('small', { id: 'ymGAide', class: 'ym-empty', style: 'font-size:12px' }, vm ? 'Le bouton s\'allume quand le nom est juste et le disque choisi.' : 'Le bouton s\'allume quand le nom est juste.')),
          el('div', { class: 'ym-row' }, ok, garder(), etat));
      }
      box.replaceChildren(n);
      const f = focus === 'nom' ? box.querySelector('#ymGNom') : focus ? box.querySelector(`[data-g="${focus}"]`) : null;
      if (f) setTimeout(() => { f.focus(); }, 0);
    }
    // La lecture de ce qui en dépend peut finir après un nouveau dessin de la page : elle dessine dans la boîte du moment.
    G.rendre = rendre;
    rendre(G.ouvert ? undefined : 'garder'); if (!G.ouvert) { G.ouvert = true; setTimeout(() => box.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), 0); }
    if (!tourne && G.bilan === undefined && !G.lu) { G.lu = true; void lire(); }
    return box;
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
        el('button', { class: 'ym-tile', type: 'button', 'data-f': 'cr', onclick: async () => { out.textContent = '…'; const x = await post('compte_rendu_machine', { machine: m.id }); out.textContent = x.ok === false ? x.text : ''; if (x.ok !== false && x.data?.compteRendu) { S.cr = { id: m.id, data: x.data.compteRendu }; S.focus = '#ymCrT'; redraw(); } } }, el('span', { class: 'ib' }, ic('note', 16)), el('span', {}, el('b', {}, 'Compte rendu'), el('span', {}, 'Où, comment entrer, ce qui a été fait et essayé (essais refaits).'))),
        tile('grid', m.estModele ? 'Ce n\'est plus un modèle' : 'Faire un modèle', m.estModele ? 'Elle redevient une machine qui démarre.' : 'Machine éteinte : on crée ensuite des machines depuis elle.', () => post('modele_machine', { machine: m.id, modele: !m.estModele }))),
      el('div', { class: 'ym-w', style: 'grid-column:1/-1' }, el('h3', {}, ic('term', 16), m.genre === 'lxc' ? `Console de ${m.nom}` : `Clavier de ${m.nom}`, el('small', { class: 'r' }, run ? (m.genre === 'lxc' ? 'chaque commande demande ton accord' : 'tape sur son écran (aperçu au-dessus)') : m.etat?.state === 'en pause' ? 'en pause : reprends-la d\'abord' : 'machine éteinte')),
        el('div', { class: 'ym-row' }, cIn, touche, el('button', { class: 'ym-btn pri ym-send', type: 'button', disabled: !run, onclick: envoyer }, m.genre === 'lxc' ? 'Lancer' : 'Envoyer')), cOut),
      S.cr?.id === m.id ? el('section', { class: 'ym-w', style: 'grid-column:1/-1', 'aria-labelledby': 'ymCrT' }, el('h3', { id: 'ymCrT', tabindex: '-1' }, ic('note', 16), `Compte rendu de ${m.nom}`, el('button', { class: 'ym-btn r', type: 'button', onclick: () => { S.cr = null; S.focus = '[data-f="cr"]'; redraw(); } }, 'Fermer')), compteRenduBloc(S.cr.data)) : null,
      depsBloc(m, D, redraw));
  }
  /**
   * Ce qui dépend de la machine (registre du cahier § 3.7) : ce qu'Odin voit (Genèse, Phénix) et ce que tu as noté
   * (une autre machine, un conteneur d'Arche, des PC, autre chose), que tu peux retirer ; et noter une dépendance.
   * Au propriétaire seul : sans la lecture, le bloc n'est pas montré.
   */
  function depsBloc(m, D, redraw) {
    const b = depsDe(D, m); if (!b) return null;
    const out = el('p', { class: 'ym-out', role: 'status' }), autres = (D.machines ?? []).filter((x) => x.id !== m.id);
    const genre = el('select', { id: 'ymDg' }, ...[['machine', 'Une autre machine'], ['arche', 'Un conteneur d\'Arche'], ['pc', 'Des PC'], ['autre', 'Autre chose']].map(([v, t]) => el('option', { value: v }, t)));
    const quiM = el('select', { id: 'ymDq' }, ...autres.map((x) => el('option', { value: x.id }, x.nom))), quiT = el('input', { id: 'ymDq', type: 'text', autocomplete: 'off', placeholder: 'ex. PC du domaine' }), nombre = el('input', { id: 'ymDn', type: 'number', min: '1', inputmode: 'numeric', placeholder: '12' });
    const quiL = el('label', { for: 'ymDq' }, 'Qui', autres.length ? quiM : quiT), nbL = el('label', { for: 'ymDn' }, 'Combien', nombre);
    const maj = () => { const g = genre.value, t = g === 'machine' && autres.length ? quiM : quiT; if (quiL.lastChild !== t) quiL.replaceChild(t, quiL.lastChild); quiT.placeholder = g === 'arche' ? 'nom du conteneur' : g === 'pc' ? 'ex. PC du domaine' : 'ex. le site de la maison'; nbL.hidden = g !== 'pc'; };
    genre.onchange = maj; maj();
    const ajouter = el('button', { class: 'ym-btn pri', type: 'button', onclick: async (e) => {
      const bt = e.currentTarget, g = genre.value, qui = g === 'machine' && autres.length ? quiM.value : quiT.value.trim(); if (!qui) { out.textContent = 'Dis ce qui en dépend.'; quiT.focus(); return; }
      bt.disabled = true; const x = await post('dependance_ajouter', { machine: m.id, genre: g, qui, nombre: g === 'pc' ? Number(nombre.value) || '' : '' }); bt.disabled = false; out.textContent = x.text; note(x); if (x.ok !== false) { S.focus = '#ymDg'; redraw(); }
    } }, ic('plus', 15), 'Noter');
    return el('section', { class: 'ym-w', style: 'grid-column:1/-1', 'aria-labelledby': 'ymDT' }, el('h3', { id: 'ymDT' }, ic('link', 16), `Ce qui dépend de ${m.nom}`, el('small', { class: 'r' }, 'elle ne se supprime pas tant que ça tourne')),
      b.dependants.length ? el('div', { class: 'ym-deps' }, ...b.dependants.map((d) => el('div', { class: 'l' }, el('span', {}, d.texte), d.lien ? el('button', { class: 'ym-btn', type: 'button', 'aria-label': `Retirer ce lien : ${d.nom}`, onclick: async (e) => { const bt = e.currentTarget; bt.disabled = true; const x = await post('dependance_retirer', { lien: d.lien }); bt.disabled = false; note(x); out.textContent = x.text; if (x.ok !== false) { S.focus = '#ymDg'; redraw(); } } }, 'Retirer') : null)))
        : el('p', { class: 'ym-empty', style: 'margin:0' }, 'Rien n\'en dépend pour l\'instant (ni noté, ni vu par Odin).'),
      el('div', { class: 'ym-addep' }, el('label', { for: 'ymDg' }, 'Ce qui en dépend', genre), quiL, nbL, ajouter), out);
  }
  function creer(root, D, redraw) {
    // Le formulaire d'un LXC (une VM se crée en quatre étapes : vmCreer).
    const C = S.create; C.genre = 'lxc'; if (C.apps === null) C.apps = new Set((D.apps ?? []).filter((a) => a.reco).map((a) => a.id));
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
        el('div', { class: 'ym-w ym-f' }, el('h3', {}, 'Système'),           el('label', { for: 'ymSys' }, C.genre === 'lxc' ? 'Modèle (image officielle signée)' : 'ISO de la bibliothèque (Andromède et importées)'), sys, C.genre === 'vm' && !isos.length ? el('span', { class: 'ym-ko' }, 'Aucune ISO dans la bibliothèque : onglet « ISO » pour en importer.') : null, C.genre === 'vm' ? prof : null,
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
  // ---------------- Onglet « Créer » : une VM en quatre étapes (lot M4), ou un LXC (le formulaire d'avant)
  function creerTab(root, D, redraw) {
    const seg = el('div', { class: 'ym-cseg', role: 'group', 'aria-label': 'Quoi créer' }, ...[['vm', 'Une VM', 'en 4 étapes'], ['lxc', 'Un LXC', 'léger, une image signée']].map(([k, t, sous]) => el('button', { type: 'button', 'aria-pressed': String(S.cg === k), 'data-cg': k, onclick: () => { S.cg = k; S.focus = `[data-cg="${k}"]`; redraw(); } }, el('b', {}, t), el('small', {}, sous))));
    root.append(seg);
    if (S.cg === 'lxc') { S.create.genre = 'lxc'; creer(root, D, redraw); return; }
    vmCreer(root, D, redraw);
  }
  const GOF = (n) => `${Math.round(n * 10) / 10}`.replace('.', ',');
  /** Le verdict du budget, comme côté Odin (qui revérifie tout) : les refus avec les chiffres, et l'accord. */
  function verdict(b, d) {
    const refus = [];
    if (d.cpu > b.coeursMax) refus.push(`Processeurs : ${d.cpu} demandés, ${b.coeursMax} au plus (ce PC en a ${b.coeurs} ; un reste à Odin).`);
    if (d.mem > b.memoireMaxGo) refus.push(`Mémoire : ${d.mem} Go demandés, ${b.memoireMaxGo} Go au plus (ce PC a ${b.memoireGo} Go ; ${b.reserveGo} Go gardés pour Odin ; ${b.machinesGo} Go déjà donnés à tes machines).`);
    if (b.disqueMaxGo == null) refus.push('Disque : Odin ne sait pas lire la place libre du disque des machines.');
    else if (d.disk > b.disqueMaxGo) refus.push(`Disque : ${d.disk} Go demandés, ${b.disqueMaxGo} Go au plus (${b.disqueLibreGo} Go libres ; ${b.reserveDisqueGo} Go gardés pour Odin et tes fichiers).`);
    if (d.mem < 1 || d.disk < 8 || d.cpu < 1) refus.push('Au moins 1 cœur, 1 Go de mémoire et 8 Go de disque.');
    const mem = b.accord.odinMemoireGo + d.mem, dk = b.accord.odinDisqueGo + d.disk, au = [mem > b.accord.memoireGo ? `${mem} Go de mémoire` : '', dk > b.accord.disqueGo ? `${dk} Go de disque` : ''].filter(Boolean);
    return { refus, accord: au.length ? `Avec elle, les machines créées par Odin prendraient ${au.join(' et ')} : au-delà de ton budget sans accord (${b.accord.memoireGo} Go de mémoire et ${b.accord.disqueGo} Go de disque). Le bouton « Créer la machine » vaut accord.` : '' };
  }
  const NOM_OK = /^[a-z0-9][a-z0-9-]{0,62}$/;
  /** Les quatre étapes de « Créer une VM » (maquette, écrans 12 à 12e), puis le compte rendu commun. */
  function vmCreer(root, D, redraw) {
    const V = D.cv ?? {}, b = V.budget, sys = V.systemes ?? [], prets = sys.filter((x) => x.etat === 'pret');
    if (!b) { root.append(el('div', { class: 'ym-w' }, el('p', { class: 'ym-ko', role: 'alert' }, D.cvTexte || 'Odin ne peut pas lire ce qu\'il faut pour créer une VM pour l\'instant.'))); return; }
    // L'état de l'assistant : gardé entre deux dessins (le choix du système propose les ressources et le nom).
    if (!S.cv) S.cv = { et: 1, iso: '', auto: false, profil: '', nom: '', nomTouche: false, cpu: 2, mem: 2, disk: 20, reseau: 'machines', apps: new Set(['vordr', 'vidarr']), categorie: '', ...(V.reglages ?? {}) };
    const C = S.cv;
    const choisir = (s) => { C.iso = s.id; C.auto = s.auto ? C.auto : false; const p = s.proposition ?? { cpu: 2, memoire: 2, disque: 20 }; C.cpu = Math.min(p.cpu, b.coeursMax); C.mem = Math.max(1, Math.min(p.memoire, b.memoireMaxGo || 1)); C.disk = Math.max(8, Math.min(p.disque, b.disqueMaxGo ?? p.disque)); if (!C.nomTouche) C.nom = s.nomPropose || ''; };
    if (!sys.some((x) => x.id === C.iso && x.etat === 'pret') && prets[0]) choisir(prets[0]);
    const box = el('div', { class: 'ym-cv' }); root.append(box);
    if (V.windows) root.prepend(el('section', { class: 'ym-w ym-win', 'aria-labelledby': 'ymCWinT' }, el('span', { class: 'gi', 'aria-hidden': 'true' }, ic('win', 20)), el('div', {}, el('h3', { id: 'ymCWinT', style: 'margin:0 0 4px' }, 'Ce PC : Windows'), el('p', {}, V.windows.maintenant), el('ul', {}, ...(V.windows.avenir ?? []).map((t) => el('li', {}, t))))));
    const choisi = () => sys.find((x) => x.id === C.iso);
    const ETAPES = [['Système', () => { const s = choisi(); return s ? s.detail : 'à choisir'; }], ['Machine', () => `${C.cpu} cœur${C.cpu > 1 ? 's' : ''} · ${C.mem} Go · ${C.disk} Go`], ['Réseau', () => (C.reseau === 'aucun' ? 'aucun' : V.reseau?.maison ? 'la maison' : 'derrière Odin')], ['Vérifier', () => 'et créer']];
    const aller = (k) => { C.et = k; C.refus = ''; rendre(`#ymCvT${k}`); };
    function barre() {
      return el('ol', { class: 'ym-steps', 'aria-label': 'Étapes' }, ...ETAPES.map(([t, sous], i) => el('li', {}, el('button', { type: 'button', class: C.et > i + 1 ? 'fait' : '', 'aria-current': C.et === i + 1 ? 'step' : null, 'data-et': String(i + 1), onclick: () => aller(i + 1) }, el('i', { 'aria-hidden': 'true' }, C.et > i + 1 ? ic('check', 14) : String(i + 1)), el('span', {}, el('b', {}, t), el('small', { 'data-sous': String(i + 1) }, sous()))))));
    }
    const titre = (k, t, lead) => [el('h3', { id: `ymCvT${k}`, tabindex: '-1' }, t), lead ? el('p', { class: 'ym-lead' }, lead) : null];
    function etape1() {
      const s = choisi(), cartes = el('div', { class: 'ym-lib', role: 'radiogroup', 'aria-label': 'Système' }, ...sys.map((x) => {
        const ok = x.etat === 'pret', on = C.iso === x.id;
        return el('button', { type: 'button', class: `ym-sys${on ? ' on' : ''}`, role: 'radio', 'aria-checked': String(on), disabled: !ok, 'data-sys': x.id, 'aria-describedby': `ymSysD-${x.id}`, onclick: () => { choisir(x); rendre(`[data-sys="${x.id}"]`); } },
          el('span', { class: 'lg', style: `background:${LOGO({ systeme: `${x.systeme} ${x.detail}`, famille: x.famille })}`, 'aria-hidden': 'true' }, String(x.detail || x.nom).charAt(0)),
          el('span', { class: 't' }, el('b', {}, x.detail), el('small', { id: `ymSysD-${x.id}` }, ok ? `${x.editeur ? 'empreinte de l\'éditeur ✓' : 'empreinte revérifiée ✓'} · antivirus ✓ · ${x.auto ? 's\'installe tout seul' : 'à installer par son écran'}` : x.raison)),
          el('span', { class: 'tick', 'aria-hidden': 'true' }, on ? ic('check', 14) : null));
      }));
      const sw = el('button', { type: 'button', class: 'ym-sw', role: 'switch', 'aria-checked': String(Boolean(C.auto)), 'aria-label': 'L\'installer tout seul', disabled: !s?.auto, 'data-f': 'auto', onclick: () => { C.auto = !C.auto; rendre('[data-f="auto"]'); } });
      const champ = (k, label, aide) => el('label', { class: 'ym-ch' }, el('span', {}, label), el('input', { type: 'text', value: C[k] ?? '', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'data-f': k, oninput: (e) => { C[k] = e.target.value; } }), aide ? el('small', {}, aide) : null);
      return [...titre(1, 'Quel système ?', 'La bibliothèque des systèmes de Genèse : seulement ceux qui sont prêts (empreinte vérifiée, antivirus passé). Les autres disent pourquoi.'),
        sys.length ? cartes : el('p', { class: 'ym-empty' }, 'Aucun système dans la bibliothèque pour l\'instant.'),
        !prets.length && sys.length ? el('p', { class: 'ym-ko', role: 'status' }, 'Aucun système prêt : attends la fin de la vérification, ou importe une ISO.') : null,
        el('div', { class: 'ym-row', style: 'margin-top:10px' }, el('button', { class: 'ym-btn', type: 'button', onclick: () => { S.tab = 'iso'; redraw(); } }, ic('down', 15), 'Toute la bibliothèque, ou une ISO à moi')),
        el('div', { class: 'ym-opt' }, el('span', { class: 'tx' }, el('b', {}, 'L\'installer tout seul'), el('small', {}, s ? s.autoTexte : 'Choisis d\'abord un système.')), sw),
        C.auto && s?.auto ? el('div', { class: 'ym-auto' }, champ('compte', 'Ton compte dans la machine', 'minuscules, chiffres, « - »'), champ('langue', 'Langue', 'ex. fr_FR.UTF-8'), champ('clavier', 'Clavier', 'ex. fr, us'), champ('fuseau', 'Fuseau', 'ex. Indian/Mayotte'),
          el('p', { class: 'ym-note' }, ic('lock', 14), 'Le mot de passe est créé par Odin et rangé au coffre ; il n\'est jamais montré ici.')) : null,
        el('label', { class: 'ym-ch', style: 'margin-top:10px' }, el('span', {}, 'Profil de logiciels (Genèse)'), el('select', { 'data-f': 'profil', onchange: (e) => { C.profil = e.target.value; } }, el('option', { value: '' }, 'Aucun'), ...(V.profils ?? []).map((p) => el('option', { value: p.id, selected: C.profil === p.id }, p.nom))),
          el('small', {}, V.profilsLus === false ? 'Genèse ne répond pas : aucun profil pour l\'instant.' : 'Noté sur la machine ; ses logiciels ne sont pas encore posés tout seuls dans une VM (dit dans le compte rendu).'))];
    }
    function etape2() {
      const s = choisi(), budget = el('div', { class: 'ym-budget', role: 'status' });
      const majBudget = () => {
        // Le résumé de l'étape et le pied suivent le curseur.
        const r2 = box.querySelector('[data-sous="2"]'); if (r2) r2.textContent = ETAPES[1][1]();
        const pg = box.querySelector('.ym-foot .grow'); if (pg) pg.textContent = `${s ? s.detail : 'Aucun système'} · ${ETAPES[1][1]()}`;
        const v = verdict(b, { cpu: C.cpu, mem: C.mem, disk: C.disk }), t = b.memoireGo || 1, pc = (n) => `${Math.max(0, Math.min(100, (n / t) * 100))}%`;
        budget.replaceChildren(el('b', {}, `Ce PC : ${b.coeurs} cœurs, ${b.memoireGo} Go de mémoire${b.disqueLibreGo != null ? `, ${b.disqueLibreGo} Go de disque libres` : ''}`),
          el('div', { class: 'bar', role: 'img', 'aria-label': `Mémoire : ${b.reserveGo} Go pour Odin, ${b.machinesGo} Go pour tes machines, ${C.mem} Go pour celle-ci, sur ${b.memoireGo} Go` }, el('i', { class: 'od', style: `width:${pc(b.reserveGo)}` }), el('i', { class: 'mx', style: `width:${pc(b.machinesGo)}` }), el('i', { class: v.refus.some((x) => /^Mémoire/.test(x)) ? 'ko' : 'nv', style: `width:${pc(C.mem)}` })),
          el('small', { class: 'lg' }, el('span', {}, el('i', { class: 'od' }), `Odin : ${b.reserveGo} Go`), el('span', {}, el('i', { class: 'mx' }), `tes machines : ${b.machinesGo} Go`), el('span', {}, el('i', { class: 'nv' }), `celle-ci : ${C.mem} Go`)),
          el('small', {}, `Au plus pour une nouvelle VM : ${b.coeursMax} cœur${b.coeursMax > 1 ? 's' : ''}, ${b.memoireMaxGo} Go de mémoire${b.disqueMaxGo != null ? `, ${b.disqueMaxGo} Go de disque` : ''}.`),
          ...v.refus.map((x) => el('p', { class: 'ym-ko' }, x)), v.accord ? el('p', { class: 'ym-pend' }, v.accord) : !v.refus.length ? el('p', { class: 'ym-ok' }, 'Dans ton budget sans accord : créée sans autre question.') : null);
      };
      const nomIn = el('input', { id: 'ymCvNom', type: 'text', value: C.nom, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'aria-describedby': 'ymCvNomA', 'data-f': 'nom', oninput: (e) => { C.nom = e.target.value.trim().toLowerCase(); C.nomTouche = true; nomA.textContent = NOM_OK.test(C.nom) ? `Sur le réseau : ${C.nom}${V.reseau?.maison ? '.maison' : ''}` : 'Des lettres minuscules sans accent, des chiffres et des tirets.'; nomA.className = NOM_OK.test(C.nom) ? 'ym-empty' : 'ym-ko'; } });
      const nomA = el('small', { id: 'ymCvNomA', class: NOM_OK.test(C.nom) ? 'ym-empty' : 'ym-ko' }, NOM_OK.test(C.nom) ? `Sur le réseau : ${C.nom}${V.reseau?.maison ? '.maison' : ''}` : 'Des lettres minuscules sans accent, des chiffres et des tirets.');
      const coeurs = [...new Set([1, 2, 3, 4, 6, 8, b.coeursMax, C.cpu])].filter((k) => k <= Math.max(b.coeurs, C.cpu)).sort((x, y) => x - y);
      const segc = el('div', { class: 'ym-segc', role: 'radiogroup', 'aria-label': 'Processeurs' }, ...coeurs.map((k) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(C.cpu === k), disabled: k > b.coeursMax, title: k > b.coeursMax ? 'un cœur reste à Odin' : null, 'data-cpu': String(k), onclick: () => { C.cpu = k; rendre(`[data-cpu="${k}"]`); } }, `${k} cœur${k > 1 ? 's' : ''}`)));
      const rng = (k, min, max, unite, label) => { const o = el('output', {}, `${C[k]} ${unite}`); const i = el('input', { type: 'range', min: String(min), max: String(Math.max(min, max)), value: String(C[k]), 'aria-label': label, 'data-f': k, oninput: (e) => { C[k] = Number(e.target.value); o.textContent = `${C[k]} ${unite}`; majBudget(); } }); return el('div', { class: 'ym-rng' }, el('span', {}, label), i, o); };
      majBudget();
      return [...titre(2, 'La machine', s ? `Odin propose ce que ${s.detail} demande au minimum, un peu plus. Tout se change plus tard.` : ''),
        el('label', { class: 'ym-ch', for: 'ymCvNom' }, el('span', {}, 'Nom')), nomIn, nomA,
        el('div', { class: 'ym-h' }, 'Processeurs'), segc,
        rng('mem', 1, Math.max(1, b.memoireMaxGo), 'Go', 'Mémoire'), rng('disk', 8, b.disqueMaxGo ?? 64, 'Go', 'Disque'),
        el('p', { class: 'ym-note' }, 'Le disque ne prend sur ce PC que ce qui est écrit dedans ; Odin compte quand même sa taille entière dans le budget.'), budget];
    }
    function etape3() {
      const choix = (k, t, p, ok = true, conseil = false) => el('button', { type: 'button', class: 'ym-choice', role: 'radio', 'aria-checked': String(C.reseau === k), disabled: !ok, 'data-net': k, onclick: () => { C.reseau = k; rendre(`[data-net="${k}"]`); } }, conseil ? el('span', { class: 'cs' }, 'Conseillé') : null, el('b', {}, t), el('span', {}, p));
      const r = V.reseau ?? {};
      return [...titre(3, 'Réseau et options', 'Où la machine se branche, et ce qu\'Odin fait pour elle.'),
        el('div', { class: 'ym-choices', role: 'radiogroup', 'aria-label': 'Réseau' },
          choix('machines', r.maison ? 'Le réseau de la maison' : 'Le réseau des machines, derrière Odin', r.maison ? `Une adresse de la maison (pont ${r.pont}) ; les autres PC la voient.` : `Une adresse à part (${r.prefixe}.0/24) ; elle sort sur Internet par ce PC, la maison ne la voit pas.`, true, true),
          choix('aucun', 'Aucun réseau', 'Ni Internet ni la maison. Son adresse reste réservée.'),
          choix('cage', 'Une cage d\'essai', 'Internet en sortie seulement, pour essayer un code venu d\'un lien : à venir.', false)),
        el('div', { class: 'ym-h' }, 'Applis d\'Odin branchées dessus'),
        el('div', { class: 'ym-apps' }, ...(V.apps ?? []).map((a) => el('label', { style: C.reseau === 'aucun' ? 'opacity:.55' : '' }, el('input', { type: 'checkbox', checked: C.apps.has(a.id) && C.reseau !== 'aucun', disabled: C.reseau === 'aucun', 'data-app': a.id, onchange: (e) => { if (e.target.checked) C.apps.add(a.id); else C.apps.delete(a.id); } }), el('span', {}, el('b', {}, a.nom), el('small', {}, C.reseau === 'aucun' ? 'sans réseau : rien à brancher' : a.quoi))))),
        (D.categories ?? []).length ? el('label', { class: 'ym-ch', style: 'margin-top:10px' }, el('span', {}, 'Catégorie'), el('select', { onchange: (e) => { C.categorie = e.target.value; } }, el('option', { value: '' }, 'Aucune'), ...(D.categories ?? []).map((c) => el('option', { value: c.nom, selected: C.categorie === c.nom }, c.nom)))) : null];
    }
    function etape4() {
      const s = choisi(), v = verdict(b, { cpu: C.cpu, mem: C.mem, disk: C.disk }), p = (V.profils ?? []).find((x) => x.id === C.profil);
      const carte = (k, t, l) => el('div', { class: 'ym-w ym-rc' }, el('h4', {}, t, el('button', { type: 'button', class: 'ym-btn', 'aria-label': `Changer : ${t}`, onclick: () => aller(k) }, 'Changer')), el('ul', {}, ...l.map(([a, x]) => el('li', {}, el('span', {}, a), el('span', {}, x)))));
      const manque = [!s ? 'Choisis un système prêt (étape 1).' : '', !NOM_OK.test(C.nom) ? 'Donne un nom valable (étape 2).' : '', ...(V.manque ?? []).length ? [`Il manque sur ce PC : ${V.manque.join(', ')}.`] : []].filter(Boolean);
      const bloque = Boolean(V.refus) || v.refus.length > 0 || manque.length > 0 || C.occupe;
      const creerB = el('button', { type: 'button', class: 'ym-btn pri big', 'data-f': 'creer', disabled: bloque, onclick: () => void lancer(v) }, ic('play', 15), 'Créer la machine');
      return [...titre(4, 'Vérifier et créer'),
        el('div', { class: 'ym-recap' },
          carte(1, 'Système', [[s?.detail ?? '—', s ? 'vérifié ✓' : ''], ['Installation', C.auto && s?.auto ? `toute seule · compte ${C.compte}` : 'à la main, par son écran'], ['Profil de logiciels', p ? p.nom : 'aucun']]),
          carte(2, 'Machine', [['Nom', C.nom || '—'], ['Processeurs', `${C.cpu} cœur${C.cpu > 1 ? 's' : ''}`], ['Mémoire', `${C.mem} Go`], ['Disque', `${C.disk} Go`]]),
          carte(3, 'Réseau', [['Branchée', C.reseau === 'aucun' ? 'aucun réseau' : V.reseau?.maison ? 'la maison' : 'derrière Odin'], ['Applis d\'Odin', C.reseau === 'aucun' ? 'aucune' : [...C.apps].map((a) => (V.apps ?? []).find((x) => x.id === a)?.nom ?? a).join(', ') || 'aucune'], ['Où', 'ce PC']])),
        el('div', { class: 'ym-calm' }, el('span', { class: 'gi', 'aria-hidden': 'true' }, ic('check', 20)), el('div', {}, el('b', {}, 'Rien n\'est effacé'), el('p', {}, 'Un nouveau dossier, un nouveau disque, seulement dans le dossier des machines virtuelles. Odin te rend compte à la fin : où, comment entrer, ce qui a été fait et essayé.'))),
        V.refus ? el('p', { class: 'ym-ko', role: 'alert' }, V.refus) : null,
        ...manque.map((x) => el('p', { class: 'ym-ko' }, x)), ...v.refus.map((x) => el('p', { class: 'ym-ko' }, x)),
        v.accord && !v.refus.length ? el('p', { class: 'ym-pend' }, v.accord) : null,
        C.refus ? el('p', { class: 'ym-ko', role: 'alert', style: 'white-space:pre-wrap' }, C.refus) : null,
        el('div', { class: 'ym-row', style: 'margin-top:12px' }, creerB)];
    }
    async function lancer(v) {
      if (C.occupe) return;
      C.occupe = true; C.refus = '';
      const input = { iso: C.iso, nom: C.nom, coeurs: C.cpu, memoire: C.mem, disque: C.disk, reseau: C.reseau === 'aucun' ? 'aucun' : 'machines', auto: Boolean(C.auto && choisi()?.auto), compte: C.compte, langue: C.langue, clavier: C.clavier, fuseau: C.fuseau, profil: C.profil, apps: C.reseau === 'aucun' ? '' : [...C.apps].join(','), categorie: C.categorie };
      box.replaceChildren(el('div', { class: 'ym-w' }, charge(input.auto ? 'Je prépare l\'installation et je crée la machine…' : 'Je crée le disque et je démarre la machine…')));
      // Le bouton vaut accord quand la page l'a dit (au-delà du budget sans accord) ; sinon, Odin demande.
      let r = await post('creer_vm', input, Boolean(v.accord));
      if (r.confirm) { if (await window.OdinDialog.confirm(r.confirm, { danger: false })) r = await post('creer_vm', input, true); else r = { ok: false, text: 'Annulé : rien n\'est créé.' }; }
      C.occupe = false; note(r);
      if (r.ok !== false && r.data?.compteRendu) { C.fini = { cr: r.data.compteRendu, id: r.data.machine?.id, auto: input.auto }; rendre('#ymCvFin'); return; }
      C.refus = r.text || 'Refusé.'; rendre('#ymCvT4');
    }
    function fin() {
      const F = C.fini;
      return [el('div', { class: 'ym-hero' }, el('span', { class: 'gi', 'aria-hidden': 'true' }, ic('check', 26)), el('h3', { id: 'ymCvFin', tabindex: '-1' }, F.auto ? `${F.cr.nom} est créée : elle s'installe toute seule` : `${F.cr.nom} est créée`), el('p', {}, F.auto ? 'Odin te prévient quand l\'installation est finie (elle redémarre seule sur son disque). Voici le compte rendu.' : 'Installe son système par son écran (Machines → sa carte). Voici le compte rendu.')),
        compteRenduBloc(F.cr),
        el('div', { class: 'ym-row', style: 'margin-top:12px' }, el('button', { class: 'ym-btn pri', type: 'button', onclick: () => { S.tab = 'machines'; S.etat = 'tout'; S.sel = F.id ?? null; S.cv = null; redraw(); } }, ic('screen', 15), 'Voir sa carte'), el('button', { class: 'ym-btn', type: 'button', onclick: () => { S.cv = null; redraw(); } }, ic('plus', 15), 'Une autre'))];
    }
    function rendre(focus) {
      if (C.fini) box.replaceChildren(el('section', { class: 'ym-w' }, ...fin()));
      else {
        const corps = C.et === 1 ? etape1() : C.et === 2 ? etape2() : C.et === 3 ? etape3() : etape4();
        const s = choisi(), pied = el('div', { class: 'ym-foot' }, el('span', { class: 'grow' }, `${s ? s.detail : 'Aucun système'} · ${C.cpu} cœur${C.cpu > 1 ? 's' : ''} · ${C.mem} Go · ${C.disk} Go`),
          C.et > 1 ? el('button', { class: 'ym-btn', type: 'button', 'data-f': 'retour', onclick: () => aller(C.et - 1) }, ic('left', 15), 'Retour') : null,
          C.et < 4 ? el('button', { class: 'ym-btn pri', type: 'button', 'data-f': 'suivant', disabled: C.et === 1 && !s, onclick: () => aller(C.et + 1) }, 'Suivant', ic('right', 15)) : null);
        box.replaceChildren(barre(), el('section', { class: 'ym-w ym-et' }, ...corps), pied);
      }
      const f = focus ? box.querySelector(focus) : null; if (f) setTimeout(() => f.focus(), 0);
    }
    rendre();
  }
  /** Le compte rendu commun (cahier § 3.6) : où, comment entrer, fait, essayé (avec la preuve), reste. */
  function compteRenduBloc(cr) {
    const liste = (l) => el('ul', {}, ...l.map(([k, v]) => el('li', {}, el('span', {}, k), el('span', { class: /ssh |\d+\.\d+\.\d+\.\d+/.test(v) ? 'mono' : '' }, v))));
    return el('div', { class: 'ym-recap ym-cr' },
      el('div', { class: 'ym-w ym-rc' }, el('h4', {}, 'Où'), liste(cr.ou)),
      el('div', { class: 'ym-w ym-rc' }, el('h4', {}, 'Comment entrer'), liste(cr.entrer)),
      el('div', { class: 'ym-w ym-rc' }, el('h4', {}, 'Ce qui a été fait'), liste(cr.fait)),
      el('div', { class: 'ym-w ym-rc' }, el('h4', {}, 'Ce qui a été essayé'), el('ul', {}, ...(cr.essaye ?? []).map((x) => el('li', { class: 'es' }, el('span', { class: x.ok === true ? 'ym-ok' : x.ok === false ? 'ym-ko' : 'ym-empty', 'aria-label': x.ok === true ? 'réussi' : x.ok === false ? 'raté' : 'pas encore' }, x.ok === true ? '✓' : x.ok === false ? '✗' : '…'), el('span', {}, el('b', {}, x.quoi), el('small', {}, x.preuve)))))),
      el('div', { class: 'ym-w ym-rc' }, el('h4', {}, 'Ce qui reste'), el('ul', {}, ...(cr.reste ?? []).map((x) => el('li', { class: 'es' }, el('span', { 'aria-hidden': 'true' }, '·'), el('span', {}, x))))));
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
          el('button', { class: 'ym-btn bad', type: 'button', style: 'margin-left:auto', onclick: () => { S.tab = 'machines'; S.etat = 'tout'; S.sel = m.id; S.garde = { id: m.id, tape: '', disque: '', refus: '' }; redraw(); } }, ic('trash', 14), 'Supprimer')), out),
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
      // Ce qui dépend de chaque machine (lecture au propriétaire seul : refusée, la page s'en passe).
      const tour = (S.tour = (S.tour ?? 0) + 1);
      const [r, dp, cv] = await Promise.all([post('tableau_machines'), S.tab === 'machines' ? post('dependants_machines') : Promise.resolve(undefined), S.tab === 'creer' && S.cg === 'vm' ? post('creation_vm') : Promise.resolve(undefined)]);
      const D = r.data ?? {}, n = el('div', { class: 'ym' }), all = D.machines ?? [];
      // Deux dessins se croisent (le rafraîchissement de 10 s, un clic) : seul le dernier commencé s'affiche, sinon un
      // dessin plus ancien remettrait ce qui vient d'être fermé (le garde-fou de la suppression).
      if (tour !== S.tour) return;
      if (dp && dp.ok !== false && dp.data) D.deps = dp.data;
      if (cv) { if (cv.ok !== false && cv.data) D.cv = cv.data; else D.cvTexte = cv.text; }
      sub.textContent = `${all.filter((m) => m.genre === 'lxc').length} LXC et ${all.filter((m) => m.genre === 'vm').length} VM sur ce PC · rangées par système`;
      if (S.tab === 'creer') creerTab(n, D, redraw); else if (S.tab === 'iso') await isoTab(n, D, redraw); else if (S.tab === 'quarantaine') await quarantaine(n, D, redraw); else machines(n, D, redraw);
      body.replaceChildren(...n.childNodes);
      // Le clavier garde sa place après un nouveau dessin (filtre choisi, garde-fou fermé).
      if (S.focus) { const f = body.querySelector(S.focus); S.focus = null; if (f) f.focus(); }
    };
    await redraw();
    // L'aperçu et les chiffres se relisent toutes les 10 s sur l'onglet Machines (pas pendant une suppression : le nom écrit resterait).
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (!root.isConnected) { clearInterval(S.timer); return; } if (S.tab === 'machines' && !S.garde && !document.hidden) void redraw(); }, 10000);
  };
})();
