// Völva — la page de recherche d'Odin (maquette validée « Recherche dans l'interface web ») : l'historique rangé par
// jour, la question en grand, les sources en cartes, la réponse d'Odin avec ses numéros cliquables et ce qui a été
// vérifié, « L'essentiel » à cocher, « Odin peut le faire » (l'appli d'Odin qui agit sur le sujet), les questions de
// suite, et à droite : la fiche du sujet, « Écouter la réponse » (voix d'Odin) et les applis d'Odin liées.
// Onglets Réponse · Sources · Images · Vidéos. Aucun HTML fabriqué à partir du texte des sources.
(() => {
  'use strict';
  const el = (t, a = {}, ...kids) => {
    const n = t === 'svg' || a.svg ? document.createElementNS('http://www.w3.org/2000/svg', t) : document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v === undefined || v === null || v === false || k === 'svg') continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.setAttribute('class', v); else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v); else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const P = {
    send: 'M5 12h14M13 6l6 6-6 6', plus: 'M12 5v14M5 12h14', copy: 'M9 9h11v11H9zM5 15V5a2 2 0 0 1 2-2h8', share: 'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6', save: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    check: 'M5 12l5 5L20 7', clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', play: 'M8 5v14l11-7z', pause: 'M7 5h4v14H7zM13 5h4v14h-4z', arrow: 'M5 12h14M13 6l6 6-6 6', mic: 'M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3',
    spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', menu: 'M4 6h16M4 12h16M4 18h16', home: 'M4 11.2 12 4.5l8 6.7M6 9.8V19h12V9.8', dl: 'M12 4v11M7 10l5 5 5-5M5 20h14', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    wifi: 'M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01', app: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z', book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5',
  };
  const icon = (k, z = 18) => el('svg', { viewBox: '0 0 24 24', width: z, height: z, 'aria-hidden': 'true', svg: true }, el('path', { d: P[k], fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', svg: true }));
  const api = async (p, body) => { const r = await fetch(p, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin' }); const j = await r.json().catch(() => ({})); if (r.status === 401) { const e = new Error('connexion requise'); e.auth = true; throw e; } return j; };

  document.head.append(el('style', {}, `
@font-face{font-family:Plex;src:url(/fonts/ibm-plex-sans-latin-400-normal.woff2) format('woff2');font-weight:400}@font-face{font-family:Plex;src:url(/fonts/ibm-plex-sans-latin-600-normal.woff2) format('woff2');font-weight:600}
:root{--bg1:#cfe9f2;--bg2:#e7f5f2;--glass:rgba(255,255,255,.82);--glass2:rgba(255,255,255,.6);--line:rgba(16,54,58,.1);--text:#10363a;--muted:#5c7477;--acc:#0b7f7c;--acc2:#0f9a8f;--soft:#e3f2f0;--ok:#1f9d55;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg1:#0c1d22;--bg2:#10292a;--glass:rgba(22,38,42,.88);--glass2:rgba(22,38,42,.6);--line:rgba(255,255,255,.09);--text:#e8f3f2;--muted:#9bb3b4;--acc:#2ec4b6;--acc2:#18a999;--soft:rgba(46,196,182,.12);--ok:#34c77b;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(1200px 800px at 80% -10%,var(--bg2),transparent 60%),linear-gradient(170deg,var(--bg1),var(--bg2));background-attachment:fixed;color:var(--text);font:15.5px/1.55 Plex,system-ui,-apple-system,'Segoe UI',sans-serif}
button,input,textarea{font:inherit;color:inherit}button{cursor:pointer}:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.card{background:var(--glass);backdrop-filter:blur(14px);border:1px solid var(--line);border-radius:22px;box-shadow:0 10px 30px rgba(16,54,58,.08)}
.app{display:grid;grid-template-columns:250px minmax(0,1fr) 300px;gap:22px;padding:16px;min-height:100vh;max-width:1480px;margin:0 auto}
aside.side{position:sticky;top:16px;height:calc(100vh - 32px);padding:16px 12px;display:flex;flex-direction:column;gap:6px;overflow:auto}
.brand{display:flex;align-items:center;gap:10px;padding:2px 6px 10px}.brand .ico{width:34px;height:34px;border-radius:11px;background:var(--acc);color:#fff;display:grid;place-items:center}.brand b{font-size:18px}.brand small{color:var(--muted);font-size:12.5px}
.new{display:flex;align-items:center;gap:8px;border:0;background:var(--acc);color:#fff;border-radius:14px;padding:11px 14px;font-weight:600;margin-bottom:8px}
.side h2{font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:14px 8px 4px;font-weight:600}
.hist button{display:block;width:100%;border:0;background:none;text-align:left;padding:8px 10px;border-radius:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}.hist button:hover{background:var(--glass2)}.hist button[aria-current=true]{background:var(--soft);font-weight:600}
.side .eng{margin-top:auto;font-size:12.5px;color:var(--muted);background:var(--glass2);border-radius:14px;padding:10px 12px;line-height:1.45}
main{min-width:0;display:flex;flex-direction:column;gap:16px;padding-bottom:16px}
.top{display:flex;align-items:center;gap:10px;min-height:40px;flex-wrap:wrap}.when{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:13.5px}
.tabs{margin-left:auto;display:flex;gap:2px;background:var(--glass2);border:1px solid var(--line);border-radius:14px;padding:3px}.tabs button{border:0;background:none;border-radius:11px;padding:7px 14px;font-size:13.5px;color:var(--muted)}.tabs button[aria-selected=true]{background:var(--glass);color:var(--text);font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.tbtn{border:1px solid var(--line);background:var(--glass2);border-radius:12px;height:38px;min-width:38px;display:inline-grid;place-items:center;color:var(--text);text-decoration:none;position:relative}.tbtn .dot{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;border-radius:9px;background:var(--acc);color:#fff;font-size:11px;display:grid;place-items:center;padding:0 4px}
h1.q{margin:0;font-size:clamp(26px,3.4vw,36px);line-height:1.15;letter-spacing:-.02em}
.srcs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) 110px;gap:10px}@media (max-width:1000px){.srcs{grid-template-columns:repeat(2,minmax(0,1fr))}}
.src{padding:11px 13px;border-radius:16px;text-decoration:none;color:var(--text);display:flex;flex-direction:column;gap:6px;min-width:0;transition:box-shadow .2s}.src .d{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);min-width:0}.src .d span:nth-child(2){flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.src .m{width:18px;height:18px;border-radius:5px;display:grid;place-items:center;color:#fff;font-size:10.5px;font-weight:700;flex:none}.src .n{font-size:11.5px;color:var(--acc);font-weight:600}
.src .t{font-size:13.5px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.src.hl{box-shadow:0 0 0 3px var(--acc)}
.more{display:grid;place-items:center;gap:4px;font-size:13px;font-weight:600;border:0;color:var(--text)}
.ansc{padding:20px 22px;display:flex;flex-direction:column;gap:14px}.ah{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ah b{font-size:15.5px}.ah .odin{width:28px;height:28px;display:inline-block}.ah .odin svg{width:100%;height:100%;display:block}
.okc{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;color:var(--acc)}
.ans{font-size:16px;line-height:1.75;white-space:pre-wrap}.cite{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;margin:0 2px;border-radius:6px;border:0;background:var(--soft);color:var(--acc);font-size:11.5px;font-weight:700;vertical-align:2px}
.lbl{font-size:13px;font-weight:600;color:var(--muted)}
.ess{display:flex;flex-direction:column;gap:8px}.ess label{display:flex;gap:12px;align-items:flex-start;background:var(--glass2);border:1px solid var(--line);border-radius:14px;padding:11px 14px;cursor:pointer}
.ess input{appearance:none;width:22px;height:22px;border-radius:7px;border:2px solid color-mix(in srgb,var(--muted) 60%,transparent);display:grid;place-items:center;flex:none;margin:1px 0 0;cursor:pointer}.ess input:checked{background:var(--ok);border-color:var(--ok)}.ess input:checked::after{content:'';width:10px;height:6px;border:2px solid #fff;border-top:0;border-right:0;transform:rotate(-45deg) translate(1px,-1px)}
.ess label.done{background:color-mix(in srgb,var(--ok) 10%,transparent)}.ess label.done b{text-decoration:line-through;opacity:.6}.ess b{font-size:14.5px;display:block}.ess small{color:var(--muted);font-size:12.5px}
.acts{display:flex;gap:8px;flex-wrap:wrap}.act{border:1px solid var(--line);background:var(--glass2);border-radius:12px;padding:7px 12px;display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:600;text-decoration:none;color:var(--text)}
.can{display:flex;align-items:center;gap:16px;padding:18px 20px;border-radius:22px;background:linear-gradient(135deg,#0b7f7c,#0f9a8f);color:#fff;flex-wrap:wrap}.can .ib{width:48px;height:48px;border-radius:14px;background:rgba(255,255,255,.18);display:grid;place-items:center;flex:none}
.can small{font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;opacity:.85;font-weight:600;display:block}.can b{font-size:16.5px;display:block}.can span{font-size:13px;opacity:.9}.can a{margin-left:auto;background:#fff;color:#0b7f7c;border-radius:14px;padding:11px 18px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.fu{padding:14px 20px}.fu button{display:flex;align-items:center;gap:12px;width:100%;border:0;border-top:1px solid var(--line);background:none;text-align:left;padding:12px 2px;color:var(--text)}.fu button:first-of-type{border-top:0}.fu button:hover{color:var(--acc)}.fu button span:not(.p){flex:1}.fu .p{color:var(--acc)}
aside.right{display:flex;flex-direction:column;gap:14px;position:sticky;top:16px;align-self:start}
.kn{overflow:hidden}.kn .hd{height:110px;background:linear-gradient(135deg,#0d3b56,#0b7f7c);display:grid;place-items:center;color:#fff}.kn .bd{padding:14px 16px;display:flex;flex-direction:column;gap:6px}.kn .bd b{font-size:16px}.kn .bd p{margin:0;font-size:13.5px;color:var(--muted);line-height:1.5}.kn a{color:var(--acc);font-weight:600;font-size:13px;text-decoration:none}
.lis{padding:14px 16px;display:flex;flex-direction:column;gap:10px}.lis b{font-size:14.5px}.pl{display:flex;align-items:center;gap:10px}.pl button{width:42px;height:42px;border-radius:50%;border:0;background:var(--acc);color:#fff;display:grid;place-items:center;flex:none}
.wv{display:flex;align-items:center;gap:3px;height:28px;flex:1}.wv i{flex:1;border-radius:2px;background:var(--acc);opacity:.35}.wv i.on{opacity:1}.lis small{color:var(--muted);font-size:12px}
.rel{padding:14px 16px;display:flex;flex-direction:column;gap:4px}.rel b{font-size:14.5px;margin-bottom:4px}.rel a{display:flex;align-items:center;gap:10px;padding:7px 4px;border-radius:10px;color:var(--text);text-decoration:none;font-size:14px}.rel a:hover{background:var(--glass2)}.rel a span:first-child{width:28px;height:28px;border-radius:9px;background:var(--soft);color:var(--acc);display:grid;place-items:center}
.box{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 18px;border-radius:20px}.box textarea{flex:1;border:0;background:none;resize:none;outline:none;min-height:24px;max-height:160px;padding:8px 0}
.chip{border:1px solid var(--line);background:var(--glass2);border-radius:12px;height:40px;padding:0 12px;display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:600;color:var(--text)}.chip[aria-pressed=true]{background:var(--soft);border-color:var(--acc);color:var(--acc)}
.mic{width:40px;height:40px;border-radius:12px;border:1px solid var(--line);background:var(--glass2);display:grid;place-items:center}.mic[aria-pressed=true]{background:#e5484d;color:#fff;border-color:transparent}
.go{width:44px;height:44px;border-radius:14px;border:0;background:var(--acc);color:#fff;display:grid;place-items:center}
.follow{position:sticky;bottom:16px;z-index:10;margin-top:auto}
.hero{display:flex;flex-direction:column;align-items:center;gap:16px;margin:14vh auto 0;text-align:center;max-width:760px;width:100%}.hero h1{margin:0;font-size:clamp(30px,5vw,44px);letter-spacing:-.02em}.hero p{margin:0;color:var(--muted)}.hero .box{width:100%}
.foc{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
.wait .bar{height:12px;border-radius:6px;background:linear-gradient(90deg,var(--glass2),var(--line),var(--glass2));background-size:200% 100%;animation:sh 1.2s infinite;margin:8px 0}@keyframes sh{to{background-position:-200% 0}}
.media{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.media a{display:flex;flex-direction:column;gap:6px;text-decoration:none;color:var(--text);padding:8px;border-radius:16px}.media img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:11px;background:var(--glass2)}.media .ph{aspect-ratio:16/10;border-radius:11px;background:var(--soft);display:grid;place-items:center;color:var(--acc)}.media b{font-size:13px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.media small{font-size:12px;color:var(--muted)}
.slist{display:flex;flex-direction:column;gap:10px}.slist a{display:flex;gap:12px;padding:12px 14px;text-decoration:none;color:var(--text);border-radius:16px}.slist a b{display:block;font-size:14.5px}.slist a small{color:var(--muted);font-size:12.5px}.slist a p{margin:4px 0 0;font-size:13.5px;color:var(--muted)}
.toast{position:fixed;left:50%;top:18px;transform:translateX(-50%);background:var(--glass);border:1px solid var(--line);padding:10px 16px;border-radius:12px;z-index:30;backdrop-filter:blur(12px)}
.menu{position:absolute;right:0;top:44px;padding:6px;display:flex;flex-direction:column;min-width:230px;z-index:20}.menu button{border:0;background:none;text-align:left;padding:10px 12px;border-radius:10px;display:flex;gap:8px;align-items:center}.menu small{display:block;color:var(--muted);font-size:12px}
.note{font-size:12.5px;color:var(--muted)}
@media (max-width:1180px){.app{grid-template-columns:230px minmax(0,1fr)}aside.right{grid-column:2;position:static}}
@media (max-width:820px){.app{grid-template-columns:1fr;padding:12px}aside.side{display:none;position:fixed;inset:12px 20% 12px 12px;z-index:25;height:auto}aside.side.open{display:flex}aside.right{grid-column:auto}.hero{margin-top:6vh}.box .lb{display:none}.can a{margin-left:0}}
@media print{aside,.top,.follow,.acts,.fu,.can,aside.right{display:none!important}.app{display:block}body{background:#fff}}
`));

  let thread = [], current = null, focus = 'tout', deep = false, tab = 'reponse', state = { engines: [], focus: {}, history: [], ai: false }, exports = [], busy = false, medias = {};
  const root = el('div', { class: 'app' }); document.body.append(root);
  const toast = (t) => { document.querySelector('.toast')?.remove(); const n = el('div', { class: 'toast', role: 'status' }, t); document.body.append(n); setTimeout(() => n.remove(), 3500); };
  const COLORS = ['#e5484d', '#3b6fd6', '#5c6670', '#f0a020', '#0b7f7c', '#9166e6', '#d6409f', '#1f9d55'];
  const mono = (d, i) => el('span', { class: 'm', style: { background: COLORS[(d.charCodeAt(0) + i) % COLORS.length] } }, (d || '?').replace(/^www\./, '').slice(0, 1).toUpperCase());
  const odinFace = () => { const t = document.getElementById('mascotte'); const s = el('span', { class: 'odin', 'aria-hidden': 'true' }); if (t?.content) s.append(t.content.cloneNode(true)); return s; };
  const when = (at) => { const d = new Date(at), t = new Date(); const same = d.toDateString() === t.toDateString(); return `${same ? 'aujourd\'hui' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}, ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`; };
  const doneKey = (id) => `volva.fait.${id}`;
  const getDone = (id) => { try { return JSON.parse(localStorage.getItem(doneKey(id)) || '[]'); } catch { return []; } };
  const setDone = (id, l) => { try { localStorage.setItem(doneKey(id), JSON.stringify(l)); } catch { /* */ } };
  const APPICON = { svalinn: 'wifi', vidarr: 'app', saga: 'book' };

  function box(big) {
    const ta = el('textarea', { rows: '1', placeholder: big ? 'Pose ta question…' : 'Pose une question de suite…', 'aria-label': 'Ta question', enterkeyhint: 'search' });
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mic = SR ? el('button', { class: 'mic', type: 'button', 'aria-label': 'Dicter la question', 'aria-pressed': 'false', onclick: () => {
      if (mic._r) { mic._r.stop(); return; } const r = new SR(), base = ta.value ? `${ta.value} ` : ''; r.lang = 'fr-FR'; r.interimResults = true; mic._r = r; mic.setAttribute('aria-pressed', 'true');
      r.onresult = (e) => { ta.value = base + [...e.results].map((x) => x[0].transcript).join(''); }; r.onend = () => { mic._r = null; mic.setAttribute('aria-pressed', 'false'); ta.focus(); }; r.start();
    } }, icon('mic', 18)) : null;
    const f = el('form', { class: 'box card', onsubmit: (e) => { e.preventDefault(); const q = ta.value.trim(); if (q) { ta.value = ''; run(q, !big); } } }, ta,
      el('button', { type: 'button', class: 'chip', 'aria-pressed': String(deep), title: 'Plus de sources, réponse détaillée', onclick: (e) => { deep = !deep; e.currentTarget.setAttribute('aria-pressed', String(deep)); } }, icon('spark', 16), el('span', { class: 'lb' }, 'Approfondie')), mic,
      el('button', { class: 'go', type: 'submit', 'aria-label': 'Chercher' }, icon('arrow', 20)));
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(160, ta.scrollHeight)}px`; });
    setTimeout(() => big && ta.focus(), 30);
    return f;
  }
  function answerNode(e, idx) {
    const out = el('div', { class: 'ans' }), re = /\[(\d{1,2})\]/g; let last = 0, m;
    // **gras** de la réponse (le seul format accepté), sans HTML.
    const txt = (t) => t.split(/\*\*(.+?)\*\*/g).map((x, i) => (i % 2 ? el('b', {}, x) : x));
    while ((m = re.exec(e.answer))) {
      out.append(...txt(e.answer.slice(last, m.index))); const n = Number(m[1]), src = e.sources.find((x) => x.n === n);
      out.append(el('button', { class: 'cite', type: 'button', 'aria-label': `Source ${n}${src ? ` : ${src.title}` : ''}`, title: src?.title, onclick: () => { const c = document.getElementById(`s${idx}-${n}`); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); c.classList.add('hl'); setTimeout(() => c.classList.remove('hl'), 1800); } } }, String(n)));
      last = m.index + m[0].length;
    }
    out.append(...txt(e.answer.slice(last))); return out;
  }
  function sourceCards(e, idx, max = 4) {
    const list = e.sources.slice(0, max);
    return el('div', { class: 'srcs' }, ...list.map((x, i) => el('a', { class: 'src card', id: `s${idx}-${x.n}`, href: x.url, target: '_blank', rel: 'noopener noreferrer' }, el('span', { class: 'd' }, mono(x.domain, i), el('span', {}, x.domain), el('span', { class: 'n' }, String(x.n))), el('span', { class: 't' }, x.title))),
      e.sources.length > max ? el('button', { class: 'src card more', type: 'button', onclick: () => { tab = 'sources'; draw(); } }, el('span', { style: { display: 'flex', gap: '3px' } }, ...e.sources.slice(max, max + 3).map((x, i) => mono(x.domain, i + max))), `+${e.sources.length - max} sources`) : null);
  }
  function qa(e, idx, last) {
    const done = getDone(e.id);
    const ess = (e.essentials ?? []).length ? el('div', { class: 'ess' }, el('div', { class: 'lbl' }, 'L\'essentiel'), ...e.essentials.map((x, i) => {
      const cb = el('input', { type: 'checkbox', checked: done.includes(i) || undefined, 'aria-label': x.title });
      const lab = el('label', { class: done.includes(i) ? 'done' : '' }, cb, el('span', {}, el('b', {}, x.title), x.detail ? el('small', {}, x.detail) : null));
      cb.addEventListener('change', () => { const l = getDone(e.id).filter((k) => k !== i); if (cb.checked) l.push(i); setDone(e.id, l); lab.classList.toggle('done', cb.checked); });
      return lab;
    })) : null;
    const checks = [`Recherche sur ${e.engines.length} moteur${e.engines.length > 1 ? 's' : ''}`, e.read ? `${e.read} page${e.read > 1 ? 's' : ''} lue${e.read > 1 ? 's' : ''}` : null, e.ai ? 'Réponse vérifiée avec ses sources' : 'Sans IA : les extraits des sources'].filter(Boolean);
    const sec = el('section', { class: 'qa', 'aria-label': e.q, style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
      idx ? el('h2', { class: 'q', style: { margin: '18px 0 0', fontSize: '24px' } }, e.q) : null,
      e.sources.length ? sourceCards(e, idx) : null,
      el('div', { class: 'card ansc' },
        el('div', { class: 'ah' }, odinFace(), el('b', {}, 'Réponse d\'Odin'), ...checks.map((c) => el('span', { class: 'okc' }, icon('check', 14), c))),
        answerNode(e, idx), ess,
        el('div', { class: 'acts' },
          el('button', { class: 'act', type: 'button', onclick: async () => { await navigator.clipboard?.writeText(e.answer).catch(() => 0); toast('Réponse copiée'); } }, icon('copy', 16), 'Copier'),
          el('button', { class: 'act', type: 'button', onclick: async () => { const u = `${location.origin}/recherche#r=${e.id}`; if (navigator.share) navigator.share({ title: e.q, url: u }).catch(() => 0); else { await navigator.clipboard?.writeText(u).catch(() => 0); toast('Lien copié (il s\'ouvre avec ta session Odin)'); } } }, icon('share', 16), 'Partager'),
          el('button', { class: 'act', type: 'button', onclick: async (ev) => { ev.currentTarget.disabled = true; const r = await api('/api/valhalla/act', { module: 'saga', action: 'noter', input: { titre: `Recherche · ${e.q.slice(0, 80)}`, texte: `${e.answer}\n\n${e.sources.map((x) => `${x.n}. ${x.title} — ${x.url}`).join('\n')}` } }).catch((x) => ({ ok: false, text: x.message })); toast(r.ok ? 'Enregistré dans tes notes (Cerveau)' : r.text || 'Échec'); } }, icon('save', 16), 'Enregistrer dans tes notes'),
          el('button', { class: 'act', type: 'button', onclick: () => exportAs(e, 'md') }, icon('dl', 16), 'Markdown'),
          el('button', { class: 'act', type: 'button', onclick: () => exportAs(e, 'pdf') }, icon('dl', 16), 'PDF'))),
      last && e.apps?.length ? (() => { const a = e.apps[0]; return el('div', { class: 'can' }, el('span', { class: 'ib' }, icon(APPICON[a.id] ?? 'app', 24)), el('div', {}, el('small', {}, `Odin peut le faire · ${a.name}`), el('b', {}, a.label ?? `Ouvrir ${a.name}`), el('span', {}, 'Rien ne change sans ton accord')), el('a', { href: `/#app=${encodeURIComponent(a.id)}` }, 'Vérifier', icon('arrow', 16))); })() : null,
      last && e.followups?.length ? el('div', { class: 'card fu' }, el('div', { class: 'lbl', style: { marginBottom: '4px' } }, 'Pour aller plus loin'), ...e.followups.map((f) => el('button', { type: 'button', onclick: () => run(f, true) }, el('span', { class: 'p' }, icon('plus', 16)), el('span', {}, f), icon('arrow', 16)))) : null,
      e.errors?.length ? el('p', { class: 'note' }, `Moteurs : ${e.engines.join(', ') || '—'} · ${e.errors.slice(0, 2).join(' ; ')}`) : null);
    return sec;
  }
  function sourcesTab() {
    const all = thread.flatMap((e, i) => e.sources.map((x) => ({ ...x, i })));
    return el('div', { class: 'slist' }, ...all.map((x, k) => el('a', { class: 'card', href: x.url, target: '_blank', rel: 'noopener noreferrer' }, el('span', { class: 'src', style: { padding: 0 } }, mono(x.domain, k)), el('span', { style: { minWidth: 0 } }, el('b', {}, `${x.n}. ${x.title}`), el('small', {}, `${x.domain}${x.engines?.length ? ` · ${x.engines.join(', ')}` : ''}`), x.snippet ? el('p', {}, x.snippet.slice(0, 220)) : null))));
  }
  function mediaTab(kind) {
    const q = thread[0]?.q, wrap = el('div', {});
    if (!q) return wrap;
    const key = `${kind}:${q}`;
    const show = (r) => { wrap.replaceChildren(r.ok ? (r.items.length ? el('div', { class: 'media' }, ...r.items.map((x) => el('a', { class: 'card', href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.thumb ? el('img', { src: `/api/recherche/vignette?u=${encodeURIComponent(x.thumb)}`, alt: '', loading: 'lazy', onerror: (ev) => ev.currentTarget.replaceWith(el('div', { class: 'ph' }, icon(kind === 'videos' ? 'play' : 'app', 22))) }) : el('div', { class: 'ph' }, icon(kind === 'videos' ? 'play' : 'app', 22)), el('b', {}, x.title), el('small', {}, x.domain)))) : el('p', { class: 'note' }, `Aucun${kind === 'videos' ? 'e vidéo' : 'e image'} trouvée.${r.errors?.length ? ` (${r.errors[0]})` : ''}`)) : el('p', { class: 'note' }, r.error)); };
    if (medias[key]) show(medias[key]);
    else { wrap.append(el('div', { class: 'wait' }, el('div', { class: 'bar' }), el('div', { class: 'bar', style: { width: '70%' } }))); api('/api/recherche/medias', { question: q, kind }).then((r) => { medias[key] = r; show(r); }).catch((e) => show({ ok: false, error: e.message })); }
    return wrap;
  }
  // La colonne de droite : la fiche du sujet, l'écoute, les applis d'Odin liées.
  let audio = null;
  function right(e) {
    const wiki = e.sources.find((x) => /wikipedia\.org$/.test(x.domain));
    const bars = Array.from({ length: 26 }, (_, i) => el('i', { style: { height: `${30 + ((i * 37) % 70)}%` } }));
    const t = el('small', {}, 'voix d\'Odin');
    const play = el('button', { type: 'button', 'aria-label': 'Écouter la réponse', onclick: async () => {
      if (audio && !audio.paused) { audio.pause(); return; }
      if (audio) { audio.play(); return; }
      play.disabled = true; t.textContent = 'Préparation de la voix…';
      try {
        const r = await fetch('/api/voice/speak', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ text: e.answer.replace(/\[\d{1,2}\]/g, '').replace(/\*\*/g, '').slice(0, 4000) }) });
        if (!/^audio\//.test(r.headers.get('content-type') ?? '')) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'voix indisponible'); }
        audio = new Audio(URL.createObjectURL(await r.blob()));
        audio.ontimeupdate = () => { const k = Math.round((audio.currentTime / (audio.duration || 1)) * bars.length); bars.forEach((b, i) => b.classList.toggle('on', i < k)); t.textContent = `${Math.floor(audio.currentTime / 60)}:${String(Math.floor(audio.currentTime % 60)).padStart(2, '0')} · voix d'Odin`; };
        audio.onplay = () => play.replaceChildren(icon('pause', 18)); audio.onpause = audio.onended = () => play.replaceChildren(icon('play', 18));
        await audio.play();
      } catch (x) { t.textContent = x.message; } finally { play.disabled = false; }
    } }, icon('play', 18));
    return el('aside', { class: 'right', 'aria-label': 'Autour de la réponse' },
      wiki ? el('div', { class: 'card kn' }, el('div', { class: 'hd' }, icon('book', 40)), el('div', { class: 'bd' }, el('b', {}, wiki.title.replace(/ — Wikipédia$/, '')), el('p', {}, (wiki.snippet || '').slice(0, 220)), el('a', { href: wiki.url, target: '_blank', rel: 'noopener noreferrer' }, 'Wikipédia'))) : null,
      el('div', { class: 'card lis' }, el('b', {}, 'Écouter la réponse'), el('div', { class: 'pl' }, play, el('span', { class: 'wv', 'aria-hidden': 'true' }, ...bars)), t),
      e.apps?.length ? el('div', { class: 'card rel' }, el('b', {}, 'Sur ce sujet dans Odin'), ...e.apps.map((a) => el('a', { href: `/#app=${encodeURIComponent(a.id)}` }, el('span', {}, icon(APPICON[a.id] ?? 'app', 15)), el('span', {}, `${a.name}${a.label ? ` · ${a.label}` : ''}`)))) : null);
  }
  function exportAs(e, kind) {
    if (kind === 'pdf') { exports.unshift({ name: `Impression PDF · ${e.q.slice(0, 40)}`, at: Date.now() }); setTimeout(() => print(), 50); return; }
    location.href = `/api/recherche/markdown?id=${encodeURIComponent(e.id)}`; exports.unshift({ name: `${e.q.slice(0, 40)}.md`, at: Date.now() }); toast('Export Markdown');
  }
  function groups() {
    const seen = new Set(), list = state.history.filter((h) => { const k = h.thread || h.id; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 60);
    const today = new Date(); today.setHours(0, 0, 0, 0); const week = today.getTime() - 6 * 864e5;
    const g = [['Aujourd\'hui', list.filter((h) => h.at >= today.getTime())], ['Cette semaine', list.filter((h) => h.at < today.getTime() && h.at >= week)], ['Plus ancien', list.filter((h) => h.at < week)]];
    return g.filter(([, l]) => l.length).flatMap(([t, l]) => [el('h2', {}, t), el('div', { class: 'hist' }, ...l.map((h) => el('button', { type: 'button', 'aria-current': String(current === h.id || thread[0]?.id === h.id), title: h.q, onclick: () => open(h.id) }, h.q)))]);
  }
  function draw() {
    const side = el('aside', { class: 'side card', 'aria-label': 'Historique' },
      el('div', { class: 'brand' }, el('span', { class: 'ico', 'aria-hidden': 'true' }, icon('spark', 18)), el('b', {}, 'Völva'), el('small', {}, 'recherche')),
      el('button', { class: 'new', type: 'button', onclick: () => { thread = []; current = null; tab = 'reponse'; history.replaceState(null, '', '/recherche'); draw(); } }, icon('plus', 16), 'Nouvelle recherche'),
      ...groups(),
      el('p', { class: 'eng' }, `Moteurs : ${state.engines.join(', ') || 'aucun — règle Völva dans Odin'}${state.ai ? ' · IA d\'Odin' : ' · sans IA'}. Les pages lues ne donnent jamais d'ordre à Odin.`));
    const nav = el('div', { class: 'top' },
      el('button', { class: 'tbtn mob', type: 'button', 'aria-label': 'Historique', onclick: () => side.classList.toggle('open') }, icon('menu', 18)),
      thread[0] ? el('span', { class: 'when' }, icon('clock', 15), when(thread[0].at)) : null,
      thread.length ? el('div', { class: 'tabs', role: 'tablist' }, ...[['reponse', 'Réponse'], ['sources', `Sources · ${thread.reduce((n, e) => n + e.sources.length, 0)}`], ['images', 'Images'], ['videos', 'Vidéos']].map(([k, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; draw(); } }, t))) : el('span', { style: { marginLeft: 'auto' } }),
      el('a', { class: 'tbtn', href: '/', 'aria-label': 'Retour à Odin', title: 'Retour à Odin' }, icon('home', 18)));
    const main = el('main', { id: 'main' }, nav);
    if (thread.length || busy) {
      const q0 = thread[0]?.q ?? busy;
      main.append(el('h1', { class: 'q' }, q0));
      if (tab === 'sources') main.append(sourcesTab());
      else if (tab === 'images' || tab === 'videos') main.append(mediaTab(tab));
      else { thread.forEach((e, i) => main.append(qa(e, i, i === thread.length - 1))); if (busy) main.append(el('div', { class: 'card ansc wait', 'aria-busy': 'true' }, el('div', { class: 'ah' }, odinFace(), el('b', {}, thread.length ? busy : 'Odin cherche, lit les pages et vérifie…')), el('div', { class: 'bar', style: { width: '90%' } }), el('div', { class: 'bar', style: { width: '75%' } }), el('div', { class: 'bar', style: { width: '82%' } }))); }
    } else main.append(el('div', { class: 'hero' }, el('h1', {}, 'Que veux-tu savoir ?'), el('p', {}, 'Völva cherche sur tous tes moteurs, lit les pages et te répond avec ses sources.'), box(true),
      el('div', { class: 'foc', role: 'group', 'aria-label': 'Où chercher' }, ...Object.entries(state.focus).map(([k, label]) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(focus === k), onclick: () => { focus = k; draw(); } }, label)))));
    if (thread.length && !busy) main.append(el('div', { class: 'follow' }, box(false)));
    root.replaceChildren(side, main, ...(thread.length && tab === 'reponse' ? [right(thread.at(-1))] : []));
    document.querySelectorAll('.mob').forEach((b) => { b.style.display = matchMedia('(max-width:820px)').matches ? '' : 'none'; });
  }
  async function run(q, follow) {
    if (busy) return; busy = q; tab = 'reponse'; audio = null; if (!follow) thread = []; draw(); scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    try {
      const r = await api('/api/recherche/chercher', { question: q, focus, approfondie: deep, ...(follow && thread.length ? { suite: thread[0].thread || thread[0].id } : {}) });
      busy = false; if (!r.ok) { toast(r.error || 'Recherche impossible'); draw(); return; }
      thread.push(r.entry); current = thread[0].id; history.replaceState(null, '', `/recherche#r=${thread[0].id}`); await refresh(); draw();
      setTimeout(() => document.querySelectorAll('.qa')[thread.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } catch (e) { busy = false; draw(); toast(e.auth ? 'Connecte-toi à Odin d\'abord' : e.message); if (e.auth) setTimeout(() => { location.href = '/'; }, 1500); }
  }
  async function open(id) { const r = await api(`/api/recherche/entree?id=${encodeURIComponent(id)}`).catch(() => ({ ok: false })); if (r.ok) { thread = r.thread; current = id; tab = 'reponse'; audio = null; history.replaceState(null, '', `/recherche#r=${id}`); draw(); } }
  async function refresh() { try { const r = await api('/api/recherche/etat'); if (r.ok) state = r; } catch (e) { if (e.auth) { root.replaceChildren(el('main', {}, el('div', { class: 'hero' }, el('h1', {}, 'Völva'), el('p', {}, 'Connecte-toi à Odin pour chercher.'), el('a', { class: 'act', href: '/' }, 'Se connecter')))); throw e; } } }
  refresh().then(() => { draw(); const m = /r=([a-f0-9]{6,20})/.exec(location.hash); if (m) open(m[1]); const q = new URLSearchParams(location.search).get('q'); if (q) run(q, false); }).catch(() => 0);
})();
