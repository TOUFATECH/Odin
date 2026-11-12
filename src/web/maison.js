// Glaðsheimr — l'écran de la maison (tablette murale, téléphone, ordinateur, Home Assistant).
// Pièces et appareils, scènes, météo, état des applis, tes boutons, onze thèmes, et la mascotte qui se promène,
// joue à la balle, répond (météo, heure, alertes) et fait ce que tu lui demandes (mêmes droits que dans Odin).
// Aucune page HTML construite à partir de texte : tout est créé élément par élément.
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // ---------- Clé de tablette : lue dans #cle=…, gardée sur l'appareil, retirée de l'adresse ----------
  let key = '';
  try { const m = /(?:^|[#&])cle=(gk_[A-Za-z0-9_-]{30,60})/.exec(location.hash); if (m) { key = m[1]; localStorage.setItem('odin.maison.cle', key); history.replaceState(null, '', location.pathname); } else key = localStorage.getItem('odin.maison.cle') || ''; } catch { /* navigation privée */ }
  const H = () => ({ 'x-odin': '1', 'content-type': 'application/json', ...(key ? { 'x-odin-maison': key } : {}) });
  const api = async (path, body) => {
    const r = await fetch(path, body ? { method: 'POST', headers: H(), body: JSON.stringify(body), credentials: 'same-origin' } : { headers: key ? { 'x-odin-maison': key } : {}, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({ ok: false, error: `erreur ${r.status}` }));
    if (r.status === 401) throw Object.assign(new Error(j.error || 'connexion requise'), { auth: true });
    return j;
  };
  const el = (t, a = {}, ...kids) => {
    const n = t === 'svg' || a.svg ? document.createElementNS('http://www.w3.org/2000/svg', t) : document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false || k === 'svg') continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.setAttribute('class', v); else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v); else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const S = (t, a = {}, ...k) => el(t, { ...a, svg: true }, ...k);
  // Petites icônes dessinées ici (traits simples).
  const ICON = {
    home: 'M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
    palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.2-1.6-.4-1 .3-2.4 1.6-2.4H17a4 4 0 0 0 4-4c0-5-4-10-9-10zM7.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
    bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
    send: 'M4 12 20 4l-6 16-3-7z', sound: 'M4 9h4l5-4v14l-5-4H4zM17 8a5 5 0 0 1 0 8', up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', stop: 'M8 8h8v8H8z', minus: 'M6 12h12', plus: 'M12 6v12M6 12h12',
    net: 'M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M2 8.5a15 15 0 0 1 20 0', cam: 'M3 7h11v10H3zM14 10l7-3v10l-7-3', people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-5M21 20a5 5 0 0 0-4-4.9',
    prev: 'M7 6v12M18 6 9 12l9 6z', next: 'M17 6v12M6 6l9 6-9 6z', play: 'M8 5v14l11-7z', pause: 'M8 5h3v14H8zM13 5h3v14h-3z', lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z', open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  };
  const icon = (k, size = 20) => S('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', class: 'ic' }, S('path', { d: ICON[k], fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

  // ---------- Thèmes (d'après tes images) ----------
  const T = {
    verre: { bg: '#15171d', bg2: 'radial-gradient(1200px 600px at 0% 0%,#232634,transparent),#15171d', card: '#1f222b', card2: '#272b36', line: '#2f3340', text: '#eef0f6', muted: '#9aa1b2', accent: '#ff8a3d', accent2: '#3fa9ff', on: 'linear-gradient(135deg,#ff9a3d,#ff6a3d)' },
    nuit: { bg: '#070d1a', bg2: 'radial-gradient(900px 500px at 70% -10%,#16264a,transparent),#070d1a', card: '#0e1830', card2: '#13203d', line: '#1d2b4d', text: '#e8eefc', muted: '#8d9bbd', accent: '#4c8dff', accent2: '#22d3ee', on: 'linear-gradient(135deg,#3b82f6,#2563eb)' },
    braise: { bg: '#0d0a08', bg2: 'radial-gradient(1000px 500px at 100% 0%,#3a1606,transparent),#0d0a08', card: '#1b120d', card2: 'linear-gradient(160deg,#5a210a,#2a120a)', line: '#3a2215', text: '#fff3ea', muted: '#c9a48d', accent: '#ff7a1a', accent2: '#ffb347', on: 'linear-gradient(135deg,#ff8a1f,#c2410c)' },
    acier: { bg: '#1b222b', bg2: 'linear-gradient(180deg,#3a4652 0%,#1b222b 60%)', card: 'rgba(255,255,255,.07)', card2: 'rgba(255,255,255,.11)', line: 'rgba(255,255,255,.12)', text: '#eef3f8', muted: '#a9b6c4', accent: '#9fd3ff', accent2: '#ffd36b', on: 'linear-gradient(135deg,#7fb8e6,#4f86b8)' },
    mural: { bg: '#040506', bg2: '#040506', card: '#101214', card2: '#16191c', line: '#22272c', text: '#e9f6f8', muted: '#8a979c', accent: '#22d3ee', accent2: '#34d399', on: 'linear-gradient(135deg,#0ea5b7,#0e7490)' },
    crepuscule: { bg: '#141820', bg2: 'linear-gradient(180deg,#26324a 0%,#7a4a3a 55%,#e08a3c 70%,#1b2230 71%,#0f131a 100%)', card: 'rgba(24,26,34,.78)', card2: 'rgba(36,38,48,.82)', line: 'rgba(255,255,255,.08)', text: '#f6f2ee', muted: '#b8b0a8', accent: '#ff9f43', accent2: '#5ab0ff', on: 'linear-gradient(135deg,#ffb347,#ff7a1a)' },
    classique: { bg: '#111111', bg2: '#111111', card: '#1c1c1c', card2: '#242424', line: '#2c2c2c', text: '#e1e1e1', muted: '#9b9b9b', accent: '#03a9f4', accent2: '#ffc107', on: 'linear-gradient(135deg,#ffc107,#ff9800)' },
    violet: { bg: '#0d0a1c', bg2: 'radial-gradient(900px 500px at 20% 110%,#2a1a5e,transparent),radial-gradient(700px 400px at 90% 0%,#1d1450,transparent),#0d0a1c', card: 'rgba(60,45,120,.28)', card2: 'rgba(80,60,150,.34)', line: 'rgba(160,140,255,.16)', text: '#efeaff', muted: '#a99fcf', accent: '#7c5cff', accent2: '#ff5c8a', on: 'linear-gradient(135deg,#7c5cff,#5b3fe0)' },
    aurore: { bg: '#0f0d1a', bg2: 'radial-gradient(800px 500px at 100% 0%,#3b2a12,transparent),radial-gradient(900px 500px at 0% 100%,#24184a,transparent),#0f0d1a', card: 'rgba(55,45,95,.32)', card2: 'rgba(75,60,120,.36)', line: 'rgba(255,255,255,.08)', text: '#f3f0ff', muted: '#aaa3c8', accent: '#f59e0b', accent2: '#8b5cf6', on: 'linear-gradient(135deg,#fbbf24,#f97316)' },
    lagon: { bg: '#0b4f5c', bg2: 'linear-gradient(160deg,#0f6b78,#0a3d4a)', card: 'rgba(255,255,255,.10)', card2: 'rgba(255,255,255,.16)', line: 'rgba(255,255,255,.14)', text: '#f2fbfc', muted: '#b6dfe4', accent: '#ffd23f', accent2: '#5eead4', on: 'linear-gradient(135deg,#ffd23f,#f5a524)' },
    clair: { bg: '#eef1f5', bg2: '#eef1f5', card: '#ffffff', card2: '#f5f7fa', line: '#dfe4ea', text: '#18202a', muted: '#5d6875', accent: '#e8590c', accent2: '#1971c2', on: 'linear-gradient(135deg,#ff922b,#e8590c)' },
  };
  const css = el('style');
  document.head.append(css);
  function applyTheme(name) {
    const t = T[name] || T.verre;
    css.textContent = `:root{--bg:${t.bg};--bg2:${t.bg2};--card:${t.card};--card2:${t.card2};--line:${t.line};--text:${t.text};--muted:${t.muted};--accent:${t.accent};--accent2:${t.accent2};--on:${t.on};--good:#34c77b;--warn:#f0a020;--bad:#ef4f43;color-scheme:${name === 'clair' ? 'light' : 'dark'}}${BASE}`;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.bg);
  }
  const BASE = `
@font-face{font-family:Plex;src:url(/fonts/ibm-plex-sans-latin-400-normal.woff2) format('woff2');font-weight:400}@font-face{font-family:Plex;src:url(/fonts/ibm-plex-sans-latin-600-normal.woff2) format('woff2');font-weight:600}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}body{background:var(--bg2);background-attachment:fixed;color:var(--text);font:15px/1.4 Plex,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
button{font:inherit;color:inherit;cursor:pointer}button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.app{display:grid;grid-template-columns:76px 1fr;min-height:100vh}
.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;align-items:center;gap:10px;padding:18px 0;border-right:1px solid var(--line);background:color-mix(in srgb,var(--card) 60%,transparent)}
.logo{width:44px;height:44px;border-radius:14px;background:var(--on);display:grid;place-items:center;font-weight:700;font-size:24px;color:#fff;margin-bottom:18px}
.nav{width:48px;height:48px;border-radius:14px;border:0;background:transparent;color:var(--muted);display:grid;place-items:center}.nav[aria-current=page]{background:var(--card2);color:var(--accent);box-shadow:inset 0 0 0 1px var(--line)}
main{padding:22px 26px 120px;min-width:0}
.top{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.hello h1{margin:0;font-size:clamp(24px,3.2vw,34px);font-weight:600;letter-spacing:-.01em}.hello p{margin:4px 0 0;color:var(--muted);font-size:14px}
.tools{margin-left:auto;display:flex;gap:10px;align-items:center}.search{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:8px 14px;color:var(--muted);min-width:220px}.search input{all:unset;color:var(--text);width:100%}
.round{width:42px;height:42px;border-radius:50%;border:1px solid var(--line);background:var(--card);display:grid;place-items:center;position:relative;color:var(--text)}.round .dot{position:absolute;top:6px;right:6px;min-width:16px;height:16px;border-radius:8px;background:var(--bad);color:#fff;font-size:10px;display:grid;place-items:center;padding:0 4px}
.chips{display:flex;gap:8px;overflow-x:auto;padding:16px 0 4px;scrollbar-width:none}.chip{border:1px solid var(--line);background:transparent;border-radius:999px;padding:7px 15px;white-space:nowrap;color:var(--muted)}.chip[aria-pressed=true]{border-color:var(--accent);color:var(--text);background:color-mix(in srgb,var(--accent) 16%,transparent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;margin-top:14px;grid-auto-flow:dense}
.card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:16px;position:relative;overflow:hidden;min-width:0;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}.card.w2{grid-column:span 2}.card.h2{grid-row:span 2}
.card h3{margin:0;font-size:12.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.card .big{font-size:40px;font-weight:600;line-height:1.05;margin:8px 0 2px}
.sec{margin:26px 0 0;font-size:15px;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:8px}
.dev{display:flex;flex-direction:column;gap:10px;min-height:132px;transition:transform .15s}.dev.on{background:var(--on);border-color:transparent;color:#fff}.dev.on .muted{color:rgba(255,255,255,.82)}
.dev .row{display:flex;align-items:center;gap:10px}.dev .em{width:40px;height:40px;border-radius:12px;background:var(--card2);display:grid;place-items:center;font-size:20px;flex:none}.dev.on .em{background:rgba(255,255,255,.22)}
.dev b{display:block;overflow-wrap:anywhere}.muted{color:var(--muted);font-size:13px}.dev .ctl{margin-top:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.btn{border:1px solid var(--line);background:var(--card2);border-radius:12px;min-width:40px;height:40px;padding:0 12px;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none}.dev.on .btn{background:rgba(255,255,255,.18);border-color:transparent}
.sw{width:52px;height:30px;border-radius:15px;border:0;background:var(--card2);position:relative;margin-left:auto;flex:none;box-shadow:inset 0 0 0 1px var(--line)}.sw::after{content:'';position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:left .2s}.sw[aria-checked=true]{background:rgba(255,255,255,.35)}.sw[aria-checked=true]::after{left:25px}
input[type=range]{width:100%;accent-color:#fff}.slide{position:relative;flex:1;min-width:180px;height:46px;border-radius:23px;background:rgba(255,255,255,.12);border:1px solid var(--line);overflow:hidden}.slide input{position:absolute;inset:0;opacity:0;width:100%;height:100%}.slide span{position:absolute;inset:0;display:grid;place-items:center;font-size:13px;color:var(--muted);pointer-events:none}.slide i{position:absolute;top:4px;left:4px;width:38px;height:38px;border-radius:50%;background:var(--accent);pointer-events:none}
.wx{background:linear-gradient(160deg,color-mix(in srgb,var(--accent2) 40%,var(--card)),var(--card))}.wx .now{display:flex;align-items:center;gap:14px}.wx .ico{font-size:58px;line-height:1}.wx .days{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center;font-size:12.5px;margin-top:12px}.wx .days b{display:block;font-size:20px;margin:2px 0}
.kv{display:grid;grid-template-columns:auto auto;gap:2px 12px;font-size:13px;color:var(--muted);margin-left:auto;text-align:right}.kv b{color:var(--text);font-weight:600}
.clock .big{font-size:56px;letter-spacing:-.02em}
.tile{display:flex;flex-direction:column;align-items:flex-start;gap:10px;text-align:left;border:1px solid var(--line);background:var(--card);border-radius:20px;padding:14px;min-height:104px;color:var(--text)}.tile .em{font-size:24px;width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:var(--card2)}.tile:hover{border-color:var(--accent)}
.scene{border:0;background:var(--card2);border-radius:14px;padding:10px 14px;margin:6px 6px 0 0;color:var(--text)}
.appc{display:flex;flex-direction:column;gap:6px;text-align:left;text-decoration:none;color:var(--text)}.appc .k{display:flex;justify-content:space-between;font-size:13px;color:var(--muted);gap:8px}.appc .k b{color:var(--text);text-align:right}.badge{position:absolute;top:12px;right:12px;border-radius:999px;padding:2px 9px;font-size:12px;background:var(--bad);color:#fff}
.k.attention b{color:var(--warn)}.k.mauvais b{color:var(--bad)}.k.bon b{color:var(--good)}
.notes li{list-style:none;padding:8px 0 8px 12px;border-left:3px solid var(--good);margin:6px 0;font-size:14px}.notes li.souci{border-color:var(--warn)}.notes li.grave{border-color:var(--bad)}.notes ul{margin:0;padding:0}
.themes{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-top:14px}.th{border:2px solid transparent;border-radius:18px;padding:0;overflow:hidden;text-align:left;background:none}.th[aria-pressed=true]{border-color:var(--accent)}.th .pv{height:92px;display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px}.th .pv i{border-radius:10px;display:block}.th span{display:block;padding:8px 10px;font-size:13px;background:var(--card)}
.person .av{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-weight:600;font-size:18px;background:var(--card2);flex:none}.person.home .av{background:var(--good);color:#fff}.person .row{display:flex;gap:12px;align-items:center}.person{display:flex;flex-direction:column;gap:10px}
.cam{padding:0;margin:0}.cam img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#000}.cam figcaption{display:flex;justify-content:space-between;align-items:center;padding:10px 14px}.cam .live{color:var(--bad)}.cam.off .live{color:var(--muted)}.cam.off .live::after{content:' (hors ligne)'}.dev.cut{border-color:var(--bad)}
.bnav{display:none}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--card2);border:1px solid var(--line);color:var(--text);padding:10px 16px;border-radius:14px;max-width:min(560px,92vw);z-index:60;box-shadow:0 10px 30px rgba(0,0,0,.35);white-space:pre-wrap}
dialog{border:1px solid var(--line);background:var(--card2);color:var(--text);border-radius:20px;padding:20px;max-width:min(440px,92vw)}dialog::backdrop{background:rgba(0,0,0,.55)}dialog .acts{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}.primary{background:var(--accent);color:#111;border-color:transparent}
.empty{color:var(--muted);padding:12px 0}
/* ---------- La mascotte ---------- */
.pet{position:fixed;left:0;top:0;width:var(--ps,76px);height:var(--ps,76px);z-index:50;touch-action:none;cursor:grab;filter:drop-shadow(0 8px 14px rgba(0,0,0,.35));transition:transform 1.1s cubic-bezier(.45,.05,.3,1)}
.pet.drag{transition:none;cursor:grabbing}.pet.fast{transition:transform .45s cubic-bezier(.3,.7,.4,1)}.pet svg{width:100%;height:100%;display:block;pointer-events:none}
.pet .bodyw{width:100%;height:100%}.pet.walk .bodyw{animation:walk .45s ease-in-out infinite}.pet.hop .bodyw{animation:hop .6s ease}.pet.spin .bodyw{animation:spin .8s ease}
@keyframes walk{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-6px) rotate(3deg)}}@keyframes hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-34px) scale(1.05,.95)}70%{transform:translateY(0) scale(1.08,.92)}}@keyframes spin{to{transform:rotate(360deg)}}
.bubble{position:fixed;z-index:55;width:min(340px,calc(100vw - 24px));background:var(--card2);color:var(--text);border:1px solid var(--line);border-radius:20px;padding:14px;box-shadow:0 16px 40px rgba(0,0,0,.4)}.bubble.ok{border-color:var(--good)}.bubble.souci{border-color:var(--warn)}.bubble.grave{border-color:var(--bad);box-shadow:0 0 0 3px color-mix(in srgb,var(--bad) 40%,transparent),0 16px 40px rgba(0,0,0,.4)}
.bubble p{margin:0 0 10px;padding-right:18px;white-space:pre-wrap;max-height:40vh;overflow:auto}.bubble .qs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.bubble .qs button{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:5px 11px;font-size:13px}
.bubble form{display:flex;gap:6px}.bubble input{flex:1;min-width:0;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:12px;padding:9px 11px;font:inherit}.bubble .x{position:absolute;top:6px;right:8px;border:0;background:none;color:var(--muted);font-size:18px}
.ball{position:fixed;left:0;top:0;width:34px;height:34px;border-radius:50%;z-index:49;touch-action:none;cursor:grab;background:radial-gradient(circle at 35% 30%,#fff 0 12%,#ffd23f 13% 45%,#f08c00 46%);box-shadow:0 6px 12px rgba(0,0,0,.35)}
@media (max-width:820px){.app{grid-template-columns:1fr}.side{display:none}main{padding:16px 14px 110px}.search{display:none}.card.w2{grid-column:span 1}.grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.wx,.clock{grid-column:1/-1!important}.wx .now{flex-wrap:wrap}.wx .kv{margin-left:0;text-align:left;grid-template-columns:repeat(4,auto);width:100%}.card .big{font-size:34px}.clock .big{font-size:44px}
.bnav{display:flex;position:fixed;left:10px;right:10px;bottom:10px;z-index:40;justify-content:space-around;background:color-mix(in srgb,var(--card2) 92%,transparent);border:1px solid var(--line);border-radius:22px;padding:6px;backdrop-filter:blur(14px)}.bnav .nav{width:52px}}
@media (prefers-reduced-motion:reduce){.pet,.pet .bodyw{transition:none!important;animation:none!important}}`;

  // ---------- État ----------
  let D = null, view = 'accueil', room = 'Tout', q = '', seen = new Set(), first = true, voice = false;
  try { voice = localStorage.getItem('odin.maison.voix') === '1'; } catch { /* */ }
  const root = el('div', { class: 'app' }); document.body.append(root);
  const toast = (t) => { document.querySelector('.toast')?.remove(); const n = el('div', { class: 'toast', role: 'status' }, t); document.body.append(n); setTimeout(() => n.remove(), 4200); };
  const confirmBox = (text) => new Promise((ok) => { const d = el('dialog', { 'aria-label': 'Confirmation' }, el('p', {}, text), el('div', { class: 'acts' }, el('button', { class: 'btn', onclick: () => { d.close(); ok(false); } }, 'Annuler'), el('button', { class: 'btn primary', onclick: () => { d.close(); ok(true); } }, 'Confirmer'))); d.addEventListener('close', () => { d.remove(); ok(false); }); document.body.append(d); d.showModal(); });
  /** Une action : si elle est grave, Odin demande confirmation, puis la relance avec « confirm ». */
  async function act(path, body) {
    try {
      let r = await api(path, body);
      if (r.confirm && await confirmBox(r.confirm)) r = await api(path, { ...body, confirm: true });
      if (r.text) { toast(r.text.split('\n').slice(0, 6).join('\n')); pet.say(r.text.split('\n')[0], r.ok === false ? 'souci' : 'ok', r.ok === false ? 'confus' : 'joie', true); }
      setTimeout(load, 600);
      return r;
    } catch (e) { toast(e.message); }
  }

  // ---------- Dessin ----------
  const KIND = { 'lumière': '💡', prise: '🔌', capteur: '🌡', 'détecteur': '📡', volet: '🪟', clim: '❄️', lecteur: '🎵', serrure: '🔒', ventilateur: '🌀', aspirateur: '🤖' };
  const FR = { on: 'allumé', off: 'éteint', open: 'ouvert', closed: 'fermé', opening: 's\'ouvre', closing: 'se ferme', playing: 'en lecture', paused: 'en pause', idle: 'en veille', standby: 'en veille', locked: 'verrouillée', unlocked: 'ouverte', locking: 'se verrouille', unlocking: 's\'ouvre', heat: 'chauffe', cool: 'refroidit', auto: 'auto', dry: 'déshumidifie', fan_only: 'ventile', cleaning: 'nettoie', docked: 'sur sa base', returning: 'rentre', unavailable: 'indisponible', unknown: 'inconnu', home: 'à la maison', not_home: 'absent' };
  const stateFr = (x) => FR[String(x).toLowerCase()] ?? x;
  const isOn = (d) => /^(on|ouvert|open|heat|cool|playing|unlocked|cleaning|auto|heat_cool|dry|fan_only)$/i.test(d.state || '');
  function devCard(d) {
    const on = isOn(d), toggle = (v) => act('/api/maison/appareil', { appareil: d.id, valeur: v });
    const head = el('div', { class: 'row' }, el('span', { class: 'em', 'aria-hidden': 'true' }, KIND[d.kind] || '◻️'), el('div', { style: { minWidth: 0 } }, el('b', {}, d.name), el('span', { class: 'muted' }, `${d.kind}${d.state ? ` · ${stateFr(d.state)}${d.unit ? ` ${d.unit}` : ''}` : ''}`)));
    const ctl = el('div', { class: 'ctl' });
    if (['lumière', 'prise', 'ventilateur'].includes(d.kind)) {
      head.append(el('button', { class: 'sw', role: 'switch', 'aria-checked': String(on), 'aria-label': `${d.name} : ${on ? 'éteindre' : 'allumer'}`, onclick: () => toggle(on ? 'off' : 'on') }));
      if (d.kind === 'lumière') { const r = el('input', { type: 'range', min: '1', max: '100', value: '70', 'aria-label': `Intensité de ${d.name}` }); r.addEventListener('change', () => toggle(`${r.value} %`)); ctl.append(r); }
    } else if (d.kind === 'volet') ctl.append(el('button', { class: 'btn', 'aria-label': 'Monter', onclick: () => toggle('ouvre') }, icon('up')), el('button', { class: 'btn', 'aria-label': 'Arrêter', onclick: () => toggle('stop') }, icon('stop')), el('button', { class: 'btn', 'aria-label': 'Descendre', onclick: () => toggle('ferme') }, icon('down')));
    else if (d.kind === 'clim') { const t = Number.parseFloat(d.state) || 22; ctl.append(el('button', { class: 'btn', 'aria-label': 'Moins chaud', onclick: () => toggle(String(t - 1)) }, icon('minus')), el('b', { style: { fontSize: '22px' } }, `${t}°`), el('button', { class: 'btn', 'aria-label': 'Plus chaud', onclick: () => toggle(String(t + 1)) }, icon('plus')), el('button', { class: 'btn', onclick: () => toggle(on ? 'off' : 'on') }, on ? 'Arrêt' : 'Marche')); }
    else if (d.kind === 'lecteur') ctl.append(el('button', { class: 'btn', 'aria-label': 'Précédent', onclick: () => toggle('precedent') }, icon('prev')), el('button', { class: 'btn', 'aria-label': on ? 'Pause' : 'Lecture', onclick: () => toggle(on ? 'pause' : 'lecture') }, icon(on ? 'pause' : 'play')), el('button', { class: 'btn', 'aria-label': 'Suivant', onclick: () => toggle('suivant') }, icon('next')));
    else if (d.kind === 'aspirateur') ctl.append(el('button', { class: 'btn', onclick: () => toggle('on') }, 'Nettoyer'), el('button', { class: 'btn', onclick: () => toggle('off') }, 'Base'));
    else if (d.kind === 'serrure') {
      // Glisser pour déverrouiller (puis confirmation d'Odin) ; un appui pour verrouiller.
      const r = el('input', { type: 'range', min: '0', max: '100', value: '0', 'aria-label': `Glisser pour ouvrir ${d.name}` }), knob = el('i'), w = el('div', { class: 'slide' }, el('span', {}, on ? 'Ouverte' : 'Glisser pour ouvrir ›'), knob, r);
      r.addEventListener('input', () => { knob.style.left = `calc(${r.value}% - ${r.value * 0.42}px + 4px)`; });
      r.addEventListener('change', () => { if (Number(r.value) > 90) toggle('deverrouille'); r.value = '0'; knob.style.left = '4px'; });
      ctl.append(on ? el('button', { class: 'btn', onclick: () => toggle('verrouille') }, icon('lock'), ' Verrouiller') : w);
    }
    return el('div', { class: `card dev${on ? ' on' : ''}${d.kind === 'serrure' || d.kind === 'lecteur' ? ' w2' : ''}` }, head, ctl);
  }
  function weatherCard(w) {
    if (!w) return el('div', { class: 'card wx w2' }, el('h3', {}, 'Météo'), el('p', { class: 'muted' }, 'Météo indisponible : choisis la ville dans Odin (Glaðsheimr).'));
    const ICO = { 0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️', 45: '🌫', 48: '🌫', 51: '🌦', 53: '🌦', 55: '🌧', 61: '🌦', 63: '🌧', 65: '🌧', 71: '🌨', 73: '🌨', 75: '❄️', 80: '🌦', 81: '🌧', 82: '⛈', 95: '⛈', 96: '⛈', 99: '⛈' };
    const days = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
    // Courbe des 24 prochaines heures.
    const hs = w.hours || [], min = Math.min(...hs.map((h) => h.temp)), max = Math.max(...hs.map((h) => h.temp)), span = Math.max(1, max - min);
    const pts = hs.map((h, i) => `${(i / Math.max(1, hs.length - 1)) * 300},${48 - ((h.temp - min) / span) * 40}`).join(' ');
    return el('div', { class: 'card wx w2' },
      el('h3', {}, `Météo · ${w.place}`),
      el('div', { class: 'now' }, el('span', { class: 'ico', 'aria-hidden': 'true' }, ICO[w.code] || '🌡'), el('div', {}, el('div', { class: 'big' }, `${w.temp}°`), el('div', {}, w.word), el('div', { class: 'muted' }, `Min ${w.lo}° · Max ${w.hi}°${w.feels !== undefined ? ` · ressenti ${w.feels}°` : ''}`)),
        el('div', { class: 'kv' }, 'Humidité', el('b', {}, `${w.humidity ?? '—'} %`), 'Vent', el('b', {}, `${w.wind ?? '—'} km/h`), 'Lever', el('b', {}, w.sunrise || '—'), 'Coucher', el('b', {}, w.sunset || '—'))),
      hs.length ? S('svg', { viewBox: '0 0 300 52', width: '100%', height: '52', role: 'img', 'aria-label': `Température des 24 prochaines heures, de ${min}° à ${max}°`, style: 'margin-top:8px' }, S('polyline', { points: pts, fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linejoin': 'round', opacity: '.85' })) : null,
      el('div', { class: 'days' }, ...(w.days || []).map((d) => el('div', {}, days[new Date(`${d.day}T12:00`).getDay()], el('b', { 'aria-hidden': 'true' }, ICO[d.code] || '·'), `${d.hi}° `, el('span', { class: 'muted' }, `${d.lo}°`)))));
  }
  const clock = el('div', { class: 'big' }), clockSub = el('div', { class: 'muted' });
  function tick() { const n = new Date(); clock.textContent = n.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); clockSub.textContent = n.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); }
  setInterval(tick, 10_000); tick();
  const week = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };
  const hello = () => { const h = new Date().getHours(); return h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : h < 22 ? 'Bonsoir' : 'Bonne nuit'; };
  const match = (t) => !q || t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q);

  function nav(id, label, ic) { return el('button', { class: 'nav', 'aria-label': label, title: label, 'aria-current': view === id ? 'page' : null, onclick: () => { view = id; draw(); } }, icon(ic, 22)); }
  function draw() {
    if (!D) return;
    const full = D.rights === 'complet';
    const navs = [['accueil', 'Accueil', 'home'], ...(full ? [['famille', 'Famille', 'people'], ['cameras', 'Caméras', 'cam'], ['reseau', 'Réseau', 'net'], ['applis', 'Mes applis', 'apps']] : []), ['boutons', 'Boutons', 'bolt'], ['themes', 'Thèmes', 'palette']];
    const notes = D.notices || [], unread = notes.filter((n) => n.level !== 'ok').length;
    const main = el('main', { id: 'main' },
      el('div', { class: 'top' },
        el('div', { class: 'hello' }, el('h1', {}, `${hello()}${D.name ? `, ${D.name}` : ''} !`), el('p', {}, `${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · semaine ${week(new Date())}`)),
        el('div', { class: 'tools' },
          el('label', { class: 'search' }, icon('search', 18), el('input', { type: 'search', placeholder: 'Chercher un appareil, une appli…', 'aria-label': 'Chercher', value: q, oninput: (e) => { q = e.target.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); drawSoon(); } })),
          el('button', { class: 'round', 'aria-label': `Alertes (${unread})`, onclick: () => pet.news() }, icon('bell', 20), unread ? el('span', { class: 'dot' }, String(unread)) : null),
          el('button', { class: 'round', 'aria-label': voice ? 'Couper la voix de la mascotte' : 'Activer la voix de la mascotte', 'aria-pressed': String(voice), onclick: () => { voice = !voice; try { localStorage.setItem('odin.maison.voix', voice ? '1' : '0'); } catch { /* */ } draw(); if (voice) pet.say('Je parlerai à voix haute.', 'ok', 'joie'); } }, icon('sound', 20)))),
      ...(view === 'accueil' ? home() : view === 'applis' ? appsView() : view === 'famille' ? [el('h2', { class: 'sec' }, 'Famille'), peopleGrid(), el('p', { class: 'muted', style: { marginTop: '12px' } }, 'La position vient de l\'appli de chaque personne (Home Assistant ou OwnTracks), qui la voit sur son téléphone et peut la mettre en pause.')] : view === 'cameras' ? [el('h2', { class: 'sec' }, 'Caméras'), camGrid(true)] : view === 'reseau' ? netView() : view === 'boutons' ? tilesView(true) : themesView()));
    startCams();
    root.replaceChildren(el('nav', { class: 'side', 'aria-label': 'Sections' }, el('div', { class: 'logo', 'aria-hidden': 'true' }, 'ᛟ'), ...navs.map((n) => nav(...n))), main, el('nav', { class: 'bnav', 'aria-label': 'Sections' }, ...navs.map((n) => nav(...n))));
  }
  let soon = 0; const drawSoon = () => { clearTimeout(soon); soon = setTimeout(() => { const f = document.activeElement?.type === 'search'; draw(); if (f) { const i = document.querySelector('.search input'); i?.focus(); i?.setSelectionRange(999, 999); } }, 150); };
  function home() {
    const rooms = D.rooms || [], names = ['Tout', ...rooms.map((r) => r.name)];
    const devs = rooms.filter((r) => room === 'Tout' || r.name === room).flatMap((r) => r.devices).filter((d) => match(`${d.name} ${d.kind}`));
    const notes = (D.notices || []).slice(0, 5);
    return [
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Pièces' }, ...names.map((n) => el('button', { class: 'chip', 'aria-pressed': String(room === n), onclick: () => { room = n; draw(); } }, n))),
      el('div', { class: 'grid' },
        weatherCard(D.weather),
        el('div', { class: 'card clock' }, el('h3', {}, 'Heure'), clock, clockSub),
        ...(D.scenes?.length ? [el('div', { class: 'card w2' }, el('h3', {}, 'Scènes'), el('div', {}, ...D.scenes.map((s) => el('button', { class: 'scene', onclick: () => act('/api/maison/scene', { scene: s }) }, `🎬 ${s}`))))] : []),
        ...devs.map(devCard),
        ...(!rooms.length ? [el('div', { class: 'card w2' }, el('h3', {}, 'Appareils'), el('p', { class: 'muted' }, 'Aucun appareil : relie ta box (Home Assistant…) ou tes prises dans Midgard, ils apparaîtront ici.'))] : []),
        ...(notes.length ? [el('div', { class: 'card w2 notes' }, el('h3', {}, 'Dernières nouvelles'), el('ul', {}, ...notes.map((n) => el('li', { class: n.level }, el('b', {}, n.title), n.detail ? el('div', { class: 'muted' }, n.detail.slice(0, 140)) : null))))] : [])),
      ...(D.people?.length ? [el('h2', { class: 'sec' }, 'Famille'), peopleGrid()] : []),
      ...(D.cameras?.length ? [el('h2', { class: 'sec' }, 'Caméras'), camGrid(false)] : []),
      el('h2', { class: 'sec' }, 'Mes boutons'), ...tilesView(false),
      ...(D.rights === 'complet' ? [el('h2', { class: 'sec' }, 'Mes applis'), appsGrid((D.apps || []).filter((a) => a.alerts || a.kpis.length).sort((a, b) => b.alerts - a.alerts).slice(0, 8))] : []),
    ];
  }
  // ---------- Famille (présence partagée par l'appli Home Assistant de chacun) ----------
  const placeFr = (st) => ({ home: 'À la maison', not_home: 'Absent', unknown: 'Inconnu', unavailable: 'Indisponible' }[st] ?? st);
  function peopleGrid() {
    const ps = (D.people || []).filter((x) => match(x.name));
    if (!ps.length) return el('p', { class: 'empty' }, 'Personne : chaque membre de la famille installe l\'appli Home Assistant et partage sa position ; il apparaîtra ici.');
    return el('div', { class: 'grid' }, ...ps.map((x) => el('div', { class: `card person${x.state === 'home' ? ' home' : ''}` },
      el('div', { class: 'row' }, el('span', { class: 'av', 'aria-hidden': 'true' }, x.name.slice(0, 1).toUpperCase()), el('div', {}, el('b', {}, x.name), el('div', { class: 'muted' }, placeFr(x.state)))),
      el('div', { class: 'muted' }, [x.since ? `depuis ${new Date(x.since).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : '', x.batt !== undefined ? `batterie ${x.batt} %` : '', x.acc ? `± ${x.acc} m` : '', x.source || ''].filter(Boolean).join(' · ')),
      x.lat !== undefined ? el('a', { class: 'btn', href: `https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=16/${x.lat}/${x.lon}`, target: '_blank', rel: 'noopener noreferrer' }, icon('open', 16), ' Voir sur la carte') : null)));
  }
  // ---------- Caméras (aperçu rafraîchi toutes les 6 s quand elles sont à l'écran) ----------
  const camUrls = new Map(); let camTimer = 0;
  function camGrid(big) {
    return el('div', { class: 'grid cams' }, ...(D.cameras || []).filter((n) => match(n)).map((n) => el('figure', { class: `card cam${big ? ' w2' : ''}` }, el('img', { alt: `Caméra ${n}`, 'data-cam': n, src: camUrls.get(n) || null }), el('figcaption', {}, el('b', {}, n), el('span', { class: 'muted live' }, '● en direct')))));
  }
  async function refreshCam(img) {
    const n = img.dataset.cam;
    try { const r = await fetch(`/api/maison/camera?nom=${encodeURIComponent(n)}`, { headers: key ? { 'x-odin-maison': key } : {}, credentials: 'same-origin' }); if (!r.ok) throw new Error(); const u = URL.createObjectURL(await r.blob()); const old = camUrls.get(n); camUrls.set(n, u); document.querySelectorAll(`img[data-cam="${CSS.escape(n)}"]`).forEach((i) => { i.src = u; i.closest('.cam')?.classList.remove('off'); }); if (old) setTimeout(() => URL.revokeObjectURL(old), 2000); }
    catch { img.closest('.cam')?.classList.add('off'); }
  }
  function startCams() { clearInterval(camTimer); const imgs = () => [...document.querySelectorAll('img[data-cam]')]; if (!imgs().length) return; imgs().forEach(refreshCam); camTimer = setInterval(() => { if (!document.hidden) imgs().forEach(refreshCam); }, 6000); }
  // ---------- Réseau : couper Internet ou la vidéo d'un appareil (Víðarr) ----------
  const NETICO = { ordinateur: '💻', 'téléphone': '📱', tablette: '📱', 'télévision': '📺', imprimante: '🖨', console: '🎮', camera: '📷', 'caméra': '📷', routeur: '📶', serveur: '🗄' };
  function netView() {
    const ds = (D.network || []).filter((d) => match(`${d.name} ${d.ip} ${d.kind}`));
    return [el('h2', { class: 'sec' }, `Réseau de la maison (${ds.length})`),
      ds.length ? el('div', { class: 'grid' }, ...ds.map((d) => el('div', { class: `card dev${d.cut ? ' cut' : ''}` },
        el('div', { class: 'row' }, el('span', { class: 'em', 'aria-hidden': 'true' }, NETICO[d.kind] || '🔌'), el('div', { style: { minWidth: 0 } }, el('b', {}, d.name), el('span', { class: 'muted' }, `${d.ip}${d.cut ? ' · Internet coupé' : ''}${d.video ? ' · vidéo coupée' : ''}`))),
        el('div', { class: 'ctl' },
          el('button', { class: `btn${d.cut ? ' primary' : ''}`, 'aria-pressed': String(d.cut), onclick: () => act('/api/maison/reseau', { ip: d.ip, nom: d.name, couper: !d.cut }) }, d.cut ? 'Rétablir Internet' : 'Couper Internet'),
          el('button', { class: `btn${d.video ? ' primary' : ''}`, 'aria-pressed': String(d.video), onclick: () => act('/api/maison/video', { ip: d.ip, nom: d.name, couper: !d.video }) }, d.video ? 'Rétablir la vidéo' : 'Couper la vidéo'))))) : el('p', { class: 'empty' }, 'Aucun appareil connu : lance le DNS de la maison (Víðarr) ou l\'inventaire (Askr).'),
      el('p', { class: 'muted', style: { marginTop: '12px' } }, 'Coupure par le DNS de la maison : un appareil réglé à la main sur un autre DNS y échappe.')];
  }
  function appsGrid(list) {
    return list.length ? el('div', { class: 'grid' }, ...list.filter((a) => match(`${a.name} ${a.family}`)).map((a) => el('a', { class: 'card appc', href: `/#app=${encodeURIComponent(a.id)}`, target: window.top !== window ? '_blank' : null, rel: 'noopener' },
      a.alerts ? el('span', { class: 'badge', 'aria-label': `${a.alerts} alerte(s)` }, String(a.alerts)) : null,
      el('b', {}, a.name), el('span', { class: 'muted' }, a.family), ...a.kpis.map((k) => el('div', { class: `k ${k.tone || ''}` }, el('span', {}, k.label), el('b', {}, k.value)))))) : el('p', { class: 'empty' }, 'Aucune appli à montrer.');
  }
  function appsView() { return [el('h2', { class: 'sec' }, `Toutes mes applis (${(D.apps || []).length})`), appsGrid(D.apps || [])]; }
  function tilesView(full) {
    const ts = (D.tiles || []).filter((t) => match(t.label));
    return [el('div', { class: 'grid' }, ...ts.map((t) => el('button', { class: 'tile', style: t.color ? { borderColor: t.color } : null, onclick: () => act('/api/maison/bouton', { id: t.id }) }, el('span', { class: 'em', 'aria-hidden': 'true', style: t.color ? { background: t.color } : null }, t.icon), el('b', {}, t.label), t.grave ? el('span', { class: 'muted' }, 'avec confirmation') : null)),
      ...(ts.length ? [] : [el('p', { class: 'empty' }, 'Aucun bouton.')])),
      ...(full ? [el('p', { class: 'muted', style: { marginTop: '14px' } }, 'Ajoute un bouton vers n\'importe quelle action d\'une appli dans Odin → Glaðsheimr → « Ajouter un bouton » (ou dis-le à la mascotte).')] : [])];
  }
  function themesView() {
    return [el('h2', { class: 'sec' }, 'Thèmes'), el('div', { class: 'themes' }, ...Object.entries(D.themes || {}).map(([k, label]) => { const t = T[k] || T.verre; return el('button', { class: 'th', 'aria-pressed': String(D.theme === k), onclick: async () => { applyTheme(k); D.theme = k; draw(); if (D.rights === 'complet') await act('/api/maison/theme', { theme: k }); else try { localStorage.setItem('odin.maison.theme', k); } catch { /* */ } } },
      el('div', { class: 'pv', style: { background: t.bg2 } }, el('i', { style: { background: t.card } }), el('i', { style: { background: t.on } }), el('i', { style: { background: t.card2 } }), el('i', { style: { background: t.accent } })), el('span', {}, label)); }))];
  }

  // ---------- Chargement ----------
  async function load() {
    try {
      const d = await api('/api/maison/etat'); if (!d.ok) throw new Error(d.error || 'erreur');
      let th = d.theme; if (d.rights !== 'complet') try { th = localStorage.getItem('odin.maison.theme') || th; } catch { /* */ }
      if (!D || D.theme !== th) applyTheme(th);
      D = { ...d, theme: th }; draw();
      // Nouvelles bulles : la mascotte les annonce (rouge et à voix haute si c'est grave).
      for (const n of (d.notices || []).slice().reverse()) { if (seen.has(n.id)) continue; seen.add(n.id); if (!first) pet.say(`${n.title}${n.detail ? `\n${n.detail.slice(0, 200)}` : ''}`, n.level, n.level === 'grave' ? 'inquiet' : n.level === 'souci' ? 'reflexion' : 'joie', n.level === 'grave'); }
      if (first) { first = false; setTimeout(() => pet.say(`${hello()} ! ${d.weather ? `Il fait ${d.weather.temp}° à ${d.weather.place}, ${d.weather.word.toLowerCase()}.` : ''} Touche-moi pour me parler.`, 'ok', 'joie'), 900); }
    } catch (e) {
      applyTheme('verre');
      root.replaceChildren(el('main', {}, el('div', { class: 'card', style: { maxWidth: '520px', margin: '12vh auto' } }, el('h1', {}, 'Écran de la maison'), el('p', {}, e.auth ? 'Connecte-toi à Odin, ou ouvre le lien de tablette donné par Glaðsheimr.' : `Odin ne répond pas : ${e.message}`), e.auth ? el('a', { class: 'btn primary', href: '/', style: { textDecoration: 'none' } }, 'Se connecter à Odin') : null)));
    }
  }

  // ---------- La mascotte ----------
  const pet = (() => {
    const tpl = document.getElementById('mascotte'), w = el('div', { class: 'pet', role: 'button', tabindex: '0', 'aria-label': 'Odin, la mascotte : touche pour lui parler' }), body = el('div', { class: 'bodyw odin' });
    if (tpl?.content.firstElementChild) body.append(tpl.content.firstElementChild.cloneNode(true)); else body.append('ᛟ');
    w.append(body); document.body.append(w);
    let x = innerWidth - 120, y = innerHeight - 160, bubble = null, bubbleTimer = 0, dragging = null, taps = [], ball = null, play = 0, lastMove = Date.now();
    const size = () => (innerWidth < 600 ? 60 : 78);
    const mood = (m) => { try { window.OdinFace?.set(body, m); } catch { /* */ } };
    const place = (nx, ny, fast) => {
      const s = size(); w.style.setProperty('--ps', `${s}px`);
      x = Math.max(6, Math.min(innerWidth - s - 6, nx)); y = Math.max(6, Math.min(innerHeight - s - 6, ny));
      w.classList.toggle('fast', Boolean(fast)); w.style.transform = `translate(${x}px,${y}px)`;
      if (!reduce && !dragging) { w.classList.add('walk'); clearTimeout(w._t); w._t = setTimeout(() => w.classList.remove('walk'), fast ? 450 : 1100); }
      lastMove = Date.now(); placeBubble();
    };
    place(x, y);
    mood('neutre');
    // Promenade : de temps en temps vers un coin libre de l'écran (jamais pendant une conversation).
    setInterval(() => { if (bubble || dragging || play || reduce) return; if (Date.now() - lastMove < 9000) return; const s = size(); place(20 + Math.random() * (innerWidth - s - 40), innerHeight * (0.35 + Math.random() * 0.55) - s); }, 4000);
    addEventListener('resize', () => place(x, y));
    // Elle ne gêne jamais : si ta souris arrive sur elle alors qu'un bouton ou un réglage est caché dessous, elle s'écarte.
    let lastFlee = 0;
    document.addEventListener('pointermove', (e) => {
      if (dragging || e.pointerType === 'touch' || Date.now() - lastFlee < 700) return;
      const s = size(); if (e.clientX < x - 4 || e.clientX > x + s + 4 || e.clientY < y - 4 || e.clientY > y + s + 4) return;
      const under = document.elementsFromPoint(e.clientX, e.clientY).find((n) => !w.contains(n) && n !== w);
      if (!under?.closest('button,a,input,select,textarea,[role=switch],.ball')) return;
      lastFlee = Date.now(); const dx = e.clientX < x + s / 2 ? 1 : -1;
      place(x + dx * (s + 40), y + (y > innerHeight / 2 ? -s : s), true);
    }, { passive: true });
    // Glisser la mascotte ; toucher = parler ; trois touches rapides = elle rit et saute.
    w.addEventListener('pointerdown', (e) => { dragging = { dx: e.clientX - x, dy: e.clientY - y, sx: e.clientX, sy: e.clientY, moved: false }; w.setPointerCapture(e.pointerId); w.classList.add('drag'); });
    w.addEventListener('pointermove', (e) => { if (!dragging) return; if (Math.hypot(e.clientX - dragging.sx, e.clientY - dragging.sy) > 6) dragging.moved = true; if (dragging.moved) place(e.clientX - dragging.dx, e.clientY - dragging.dy); });
    w.addEventListener('pointerup', () => {
      const d = dragging; dragging = null; w.classList.remove('drag'); if (!d || d.moved) return;
      taps = taps.filter((t) => Date.now() - t < 900); taps.push(Date.now());
      if (taps.length >= 3) { taps = []; mood('rire'); anim('spin'); say('Hihi, ça chatouille !', 'ok', 'rire'); return; }
      if (bubble?.dataset.chat) closeBubble(); else chat();
    });
    w.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chat(); } });
    function anim(c) { if (reduce) return; w.classList.remove('hop', 'spin'); void w.offsetWidth; w.classList.add(c); setTimeout(() => w.classList.remove(c), 900); }
    function placeBubble() {
      if (!bubble) return; const bw = bubble.offsetWidth, bh = bubble.offsetHeight, s = size();
      let left = x + s / 2 - bw / 2, top = y - bh - 12; if (top < 8) top = y + s + 12;
      bubble.style.left = `${Math.max(12, Math.min(innerWidth - bw - 12, left))}px`; bubble.style.top = `${Math.max(8, Math.min(innerHeight - bh - 8, top))}px`;
    }
    function closeBubble() { bubble?.remove(); bubble = null; clearTimeout(bubbleTimer); mood('neutre'); }
    function speak(t) { if (!voice || !('speechSynthesis' in window)) return; try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, '').slice(0, 400)); u.lang = 'fr-FR'; mood('parle'); u.onend = () => mood('neutre'); speechSynthesis.speak(u); } catch { /* */ } }
    function show(kids, level, ms, isChat) {
      closeBubble();
      bubble = el('div', { class: `bubble ${level || ''}`, role: level === 'grave' ? 'alert' : 'status', 'aria-live': 'polite' }, el('button', { class: 'x', 'aria-label': 'Fermer', onclick: closeBubble }, '×'), ...kids);
      if (isChat) bubble.dataset.chat = '1';
      document.body.append(bubble); placeBubble();
      if (ms) bubbleTimer = setTimeout(closeBubble, ms);
    }
    /** Parle dans une bulle (verte, orange ou rouge) ; à voix haute si la voix est activée (ou si c'est grave). */
    function say(text, level = 'ok', m = 'joie', loud = false) {
      if (bubble?.dataset.chat && level !== 'grave') { const p = bubble.querySelector('p'); if (p) { p.textContent = text; mood(m); if (voice) speak(text); placeBubble(); return; } }
      show([el('p', {}, text)], level, level === 'grave' ? 0 : Math.min(14000, 4000 + text.length * 45)); mood(m);
      if (level === 'grave') { anim('hop'); place(innerWidth / 2 - size() / 2, innerHeight / 2, true); }
      if (voice || (loud && level === 'grave')) speak(text);
    }
    async function ask(text) {
      const p = bubble?.querySelector('p'); if (p) p.textContent = '…'; mood('reflexion');
      try {
        let r = await api('/api/maison/dire', { texte: text });
        if (r.confirm && await confirmBox(r.confirm)) r = await api('/api/maison/dire', { texte: text, confirm: true });
        say(r.text || r.error || '…', r.ok === false ? 'souci' : 'ok', r.mood || (r.ok === false ? 'confus' : 'joie'));
        setTimeout(load, 800);
      } catch (e) { say(e.message, 'souci', 'triste'); }
    }
    function chat() {
      const input = el('input', { type: 'text', placeholder: 'Dis-moi… (« allume le salon »)', 'aria-label': 'Ta demande à Odin', enterkeyhint: 'send' });
      const quick = [['☀️ Météo', () => ask('météo')], ['🕒 Heure', () => ask('quelle heure')], ['🔔 Alertes', () => news()], ['⚽ Joue avec moi', () => game()], ['🎨 Thème suivant', () => nextTheme()]];
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      show([el('p', {}, `${hello()} ! Que veux-tu ?`), el('div', { class: 'qs' }, ...quick.map(([l, f]) => el('button', { type: 'button', onclick: f }, l))),
        el('form', { onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (t) { input.value = ''; ask(t); } } }, input,
          SR ? el('button', { type: 'button', class: 'btn', 'aria-label': 'Parler au micro', onclick: () => { try { const r = new SR(); r.lang = 'fr-FR'; mood('ecoute'); r.onresult = (ev) => { const t = ev.results[0][0].transcript; input.value = t; ask(t); }; r.onend = () => mood('neutre'); r.start(); } catch { toast('Micro indisponible.'); } } }, icon('mic', 18)) : null,
          el('button', { class: 'btn primary', 'aria-label': 'Envoyer' }, icon('send', 18)))], 'ok', 0, true);
      mood('ecoute'); setTimeout(() => input.focus({ preventScroll: true }), 50);
    }
    function news() {
      const n = (D?.notices || []).slice(0, 4);
      say(n.length ? n.map((x) => `• ${x.title}`).join('\n') : 'Rien à signaler, tout va bien.', n.some((x) => x.level === 'grave') ? 'grave' : n.some((x) => x.level === 'souci') ? 'souci' : 'ok', n.length ? 'reflexion' : 'joie');
    }
    function nextTheme() { const ks = Object.keys(D?.themes || T), i = ks.indexOf(D?.theme), k = ks[(i + 1) % ks.length]; document.querySelectorAll('.th')[0]; applyTheme(k); if (D) D.theme = k; draw(); if (D?.rights === 'complet') api('/api/maison/theme', { theme: k }).catch(() => 0); else try { localStorage.setItem('odin.maison.theme', k); } catch { /* */ } say(`Thème « ${D?.themes?.[k] || k} ».`, 'ok', 'excite'); }
    // ---------- Jeu de balle : lance la balle, la mascotte court la chercher et te la rapporte ----------
    function game() {
      closeBubble(); if (ball) return;
      ball = el('div', { class: 'ball', role: 'img', 'aria-label': 'Balle : lance-la' }); document.body.append(ball);
      let bx = innerWidth / 2, by = innerHeight / 3, vx = 0, vy = 0, held = null, raf = 0, last = [];
      const put = () => { ball.style.transform = `translate(${bx - 17}px,${by - 17}px)`; };
      put(); play = Date.now(); mood('excite'); say('Lance la balle !', 'ok', 'excite');
      ball.addEventListener('pointerdown', (e) => { held = true; ball.setPointerCapture(e.pointerId); vx = vy = 0; last = [[e.clientX, e.clientY, performance.now()]]; });
      ball.addEventListener('pointermove', (e) => { if (!held) return; bx = e.clientX; by = e.clientY; put(); last.push([e.clientX, e.clientY, performance.now()]); last = last.slice(-5); });
      ball.addEventListener('pointerup', () => { held = false; const a = last[0], b = last[last.length - 1]; if (a && b && b[2] > a[2]) { vx = ((b[0] - a[0]) / (b[2] - a[2])) * 16; vy = ((b[1] - a[1]) / (b[2] - a[2])) * 16; } play = Date.now(); loop(); });
      function loop() {
        cancelAnimationFrame(raf); const t0 = performance.now();
        const step = () => {
          vy += 0.6; bx += vx; by += vy; vx *= 0.99;
          if (bx < 17 || bx > innerWidth - 17) { vx = -vx * 0.7; bx = Math.max(17, Math.min(innerWidth - 17, bx)); }
          if (by > innerHeight - 17) { by = innerHeight - 17; vy = Math.abs(vy) < 2 ? 0 : -vy * 0.6; vx *= 0.88; }
          if (by < 17) { by = 17; vy = -vy * 0.6; }
          put();
          if ((Math.abs(vx) + Math.abs(vy) > 0.8 || by < innerHeight - 18) && performance.now() - t0 < 3500) raf = requestAnimationFrame(step); else fetchBall();
        };
        raf = requestAnimationFrame(step);
      }
      // La mascotte court jusqu'à la balle puis la rapporte au milieu.
      function fetchBall() {
        const s = size(); mood('excite'); place(bx - s / 2, by - s, true);
        setTimeout(() => { anim('hop'); bx = innerWidth / 2; by = innerHeight / 2; place(bx - s / 2, by - s / 2 - 30, true); setTimeout(() => { put(); mood('joie'); say(['Encore !', 'Attrapée !', 'Je l\'ai !', 'Trop facile !'][Math.floor(Math.random() * 4)], 'ok', 'joie'); }, 450); }, 500);
      }
      // Fin du jeu après une minute sans lancer.
      const end = setInterval(() => { if (Date.now() - play > 60_000) { clearInterval(end); cancelAnimationFrame(raf); ball?.remove(); ball = null; play = 0; say('On rejoue quand tu veux !', 'ok', 'joie'); } }, 5000);
    }
    return { say, news, chat };
  })();

  load();
  setInterval(load, 15_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
