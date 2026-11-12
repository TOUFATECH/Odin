// Völva — la page de recherche d'Odin, façon Perplexity : une question, la réponse sourcée avec des numéros
// cliquables, les sources (et les moteurs qui les ont trouvées), les questions de suite, les applis d'Odin qui
// peuvent agir, l'historique, et l'export (Markdown, JSON, PDF, lien). Aucun HTML fabriqué à partir du texte.
(() => {
  'use strict';
  const el = (t, a = {}, ...kids) => {
    const n = t === 'svg' || a.svg ? document.createElementNS('http://www.w3.org/2000/svg', t) : document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v === undefined || v === null || v === false || k === 'svg') continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.setAttribute('class', v); else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v); else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const P = { search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', send: 'M5 12h14M13 6l6 6-6 6', dl: 'M12 4v11M7 10l5 5 5-5M5 20h14', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', copy: 'M9 9h10v10H9zM5 15V5h10', plus: 'M12 5v14M5 12h14', menu: 'M4 7h16M4 12h16M4 17h16', open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', print: 'M7 9V4h10v5M7 17H5v-6h14v6h-2M8 14h8v6H8z' };
  const icon = (k, z = 18) => el('svg', { viewBox: '0 0 24 24', width: z, height: z, 'aria-hidden': 'true', svg: true }, el('path', { d: P[k], fill: 'none', stroke: 'currentColor', 'stroke-width': '1.9', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', svg: true }));
  const api = async (p, body) => { const r = await fetch(p, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin' }); const j = await r.json().catch(() => ({ ok: false, error: `erreur ${r.status}` })); if (r.status === 401) throw Object.assign(new Error('connexion requise'), { auth: true }); return j; };

  document.head.append(el('style', {}, `
@font-face{font-family:Plex;src:url(/fonts/ibm-plex-sans-latin-400-normal.woff2) format('woff2');font-weight:400}@font-face{font-family:Plex;src:url(/fonts/ibm-plex-sans-latin-600-normal.woff2) format('woff2');font-weight:600}
:root{--bg:#0f1116;--panel:#171a21;--panel2:#1e222b;--line:#2a2f3a;--text:#eceef3;--muted:#9aa1b0;--accent:#ff8a3d;--accent2:#7cc4ff;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f6f7f9;--panel:#fff;--panel2:#f0f2f5;--line:#dfe3e9;--text:#151a22;--muted:#5b6574;--accent:#d9480f;--accent2:#1c6fc4;color-scheme:light}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 Plex,system-ui,-apple-system,'Segoe UI',sans-serif}
button,input,textarea{font:inherit;color:inherit}button{cursor:pointer}:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.app{display:grid;grid-template-columns:260px 1fr;min-height:100vh}
aside{border-right:1px solid var(--line);padding:18px 14px;display:flex;flex-direction:column;gap:10px;position:sticky;top:0;height:100vh;overflow:auto;background:var(--panel)}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:18px;padding:4px 6px 10px}.brand .ico{width:30px;height:30px;border-radius:10px;background:linear-gradient(135deg,var(--accent),#c2410c);display:grid;place-items:center;color:#fff;font-size:15px}
.new{display:flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--panel2);border-radius:12px;padding:9px 12px;text-align:left}
aside h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:14px 6px 4px}
.hist{display:flex;flex-direction:column;gap:2px}.hist button{border:0;background:none;text-align:left;padding:8px 10px;border-radius:10px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hist button:hover,.hist button[aria-current=true]{background:var(--panel2)}
main{min-width:0;padding:28px 32px 140px;max-width:900px;width:100%;margin:0 auto}
.top{display:flex;justify-content:flex-end;gap:8px;min-height:40px}.tbtn{border:1px solid var(--line);background:var(--panel);border-radius:12px;height:40px;min-width:40px;padding:0 12px;display:inline-flex;align-items:center;gap:6px;position:relative}
.tbtn .dot{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:var(--accent);color:#1a0d02;font-size:11px;font-weight:600;display:grid;place-items:center;padding:0 5px}
.hero{display:flex;flex-direction:column;align-items:center;gap:18px;margin-top:14vh;text-align:center}.hero h1{margin:0;font-size:clamp(30px,5vw,44px);letter-spacing:-.02em}.hero p{margin:0;color:var(--muted)}
.box{width:100%;background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:12px 12px 10px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 10px 30px rgba(0,0,0,.18)}
.box textarea{border:0;background:none;resize:none;outline:none;min-height:52px;max-height:200px;width:100%}
.box .row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.chip{border:1px solid var(--line);background:none;border-radius:999px;padding:5px 12px;font-size:13.5px;color:var(--muted)}.chip[aria-pressed=true]{border-color:var(--accent);color:var(--text);background:color-mix(in srgb,var(--accent) 14%,transparent)}
.go{margin-left:auto;width:42px;height:42px;border-radius:14px;border:0;background:var(--accent);color:#1a0d02;display:grid;place-items:center}.go:disabled{opacity:.5}
.engines{font-size:13px;color:var(--muted)}
.qa{margin-top:26px;display:flex;flex-direction:column;gap:16px;padding-bottom:28px;border-bottom:1px solid var(--line)}.qa h2{margin:0;font-size:clamp(22px,3vw,28px);letter-spacing:-.01em}
.srcs{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}.src{flex:0 0 200px;border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:10px 12px;text-decoration:none;color:var(--text);display:flex;flex-direction:column;gap:6px;transition:border-color .2s}
.src.hl{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}.src .t{font-size:13.5px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.src .d{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}.src .m{width:18px;height:18px;border-radius:5px;background:var(--panel2);display:grid;place-items:center;font-size:10.5px;font-weight:600;color:var(--text);flex:none}
.ans{font-size:16.5px;line-height:1.7;white-space:pre-wrap}.cite{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;margin:0 1px;border-radius:6px;border:0;background:var(--panel2);color:var(--accent2);font-size:12px;font-weight:600;vertical-align:2px}
.label{display:flex;align-items:center;gap:8px;font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:600}
.acts{display:flex;gap:8px;flex-wrap:wrap}.act{border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:8px 12px;display:inline-flex;align-items:center;gap:6px;font-size:14px;text-decoration:none;color:var(--text)}
.fu{display:flex;flex-direction:column}.fu button{border:0;border-top:1px solid var(--line);background:none;text-align:left;padding:12px 4px;display:flex;justify-content:space-between;gap:10px;color:var(--text)}.fu button:hover{color:var(--accent)}
.apps{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}.app1{border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px}.app1 b{font-size:15px}.app1 span{font-size:13px;color:var(--muted)}
.note{font-size:13px;color:var(--muted)}
.follow{position:fixed;left:260px;right:0;bottom:0;padding:14px 32px 22px;background:linear-gradient(transparent,var(--bg) 40%)}.follow .box{max-width:836px;margin:0 auto}
.wait{display:flex;flex-direction:column;gap:10px}.bar{height:12px;border-radius:6px;background:linear-gradient(90deg,var(--panel2),var(--line),var(--panel2));background-size:200% 100%;animation:sh 1.2s infinite}@keyframes sh{to{background-position:-200% 0}}
.toast{position:fixed;left:50%;top:18px;transform:translateX(-50%);background:var(--panel2);border:1px solid var(--line);padding:10px 16px;border-radius:12px;z-index:30}
.menu{position:absolute;right:0;top:46px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:6px;display:flex;flex-direction:column;min-width:230px;z-index:20;box-shadow:0 14px 30px rgba(0,0,0,.3)}.menu button{border:0;background:none;text-align:left;padding:10px 12px;border-radius:10px;display:flex;gap:10px;align-items:center}.menu button:hover{background:var(--panel2)}.menu small{display:block;color:var(--muted);font-size:12px}
@media (max-width:820px){.app{grid-template-columns:1fr}aside{display:none;position:fixed;inset:0 25% 0 0;z-index:25;height:auto}aside.open{display:flex}main{padding:16px 14px 150px}.follow{left:0;padding:10px 12px 16px}.hero{margin-top:8vh}.src{flex-basis:170px}}
@media print{aside,.top,.follow,.acts,.fu,.apps-sec{display:none!important}.app{display:block}main{max-width:none;padding:0}.src{break-inside:avoid}}
`));

  let thread = [], current = null, focus = 'tout', deep = false, state = { engines: [], focus: {}, history: [], ai: false }, exports = [];
  const root = el('div', { class: 'app' }); document.body.append(root);
  const toast = (t) => { document.querySelector('.toast')?.remove(); const n = el('div', { class: 'toast', role: 'status' }, t); document.body.append(n); setTimeout(() => n.remove(), 3500); };
  const domainMono = (d) => (d || '?').replace(/^www\./, '').slice(0, 1).toUpperCase();

  function box(big) {
    const ta = el('textarea', { rows: big ? '2' : '1', placeholder: big ? 'Pose ta question…' : 'Pose une question de suite…', 'aria-label': 'Ta question', enterkeyhint: 'search' });
    const go = el('button', { class: 'go', type: 'submit', 'aria-label': 'Chercher' }, icon('send', 20));
    const f = el('form', { class: 'box', onsubmit: (e) => { e.preventDefault(); const q = ta.value.trim(); if (q) { ta.value = ''; run(q, !big); } } }, ta,
      el('div', { class: 'row' }, ...Object.entries(state.focus).map(([k, label]) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(focus === k), onclick: () => { focus = k; draw(); } }, label)),
        el('button', { type: 'button', class: 'chip', 'aria-pressed': String(deep), onclick: () => { deep = !deep; draw(); } }, 'Approfondie'), go));
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(200, ta.scrollHeight)}px`; });
    setTimeout(() => big && ta.focus(), 30);
    return f;
  }
  // La réponse avec ses numéros [n] devenus des boutons qui montrent la source.
  function answerNode(e, idx) {
    const out = el('div', { class: 'ans' }), re = /\[(\d{1,2})\]/g; let last = 0, m;
    while ((m = re.exec(e.answer))) {
      out.append(e.answer.slice(last, m.index)); const n = Number(m[1]), src = e.sources.find((x) => x.n === n);
      out.append(el('button', { class: 'cite', type: 'button', 'aria-label': `Source ${n}${src ? ` : ${src.title}` : ''}`, title: src?.title, onclick: () => { const c = document.getElementById(`s${idx}-${n}`); if (c) { c.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); c.classList.add('hl'); setTimeout(() => c.classList.remove('hl'), 1800); } } }, String(n)));
      last = m.index + m[0].length;
    }
    out.append(e.answer.slice(last)); return out;
  }
  function qa(e, idx) {
    return el('section', { class: 'qa', 'aria-label': e.q },
      el('h2', {}, e.q),
      e.sources.length ? el('div', {}, el('div', { class: 'label' }, `Sources · ${e.sources.length}`), el('div', { class: 'srcs' }, ...e.sources.map((x) => el('a', { class: 'src', id: `s${idx}-${x.n}`, href: x.url, target: '_blank', rel: 'noopener noreferrer' }, el('span', { class: 't' }, x.title), el('span', { class: 'd' }, el('span', { class: 'm', 'aria-hidden': 'true' }, domainMono(x.domain)), `${x.n} · ${x.domain}`), x.engines?.length ? el('span', { class: 'd' }, x.engines.slice(0, 3).join(' · ')) : null)))) : null,
      el('div', { class: 'label' }, e.ai ? 'Réponse' : 'Ce que disent les sources'), answerNode(e, idx),
      el('div', { class: 'acts' },
        el('button', { class: 'act', type: 'button', onclick: async () => { await navigator.clipboard?.writeText(e.answer).catch(() => 0); toast('Réponse copiée'); } }, icon('copy', 16), 'Copier'),
        el('button', { class: 'act', type: 'button', onclick: () => exportAs(e, 'md') }, icon('dl', 16), 'Markdown'),
        el('button', { class: 'act', type: 'button', onclick: () => exportAs(e, 'json') }, icon('dl', 16), 'JSON'),
        el('button', { class: 'act', type: 'button', onclick: () => { exportAs(e, 'pdf'); } }, icon('print', 16), 'PDF'),
        el('button', { class: 'act', type: 'button', onclick: async () => { const u = `${location.origin}/recherche#r=${e.id}`; await navigator.clipboard?.writeText(u).catch(() => 0); toast('Lien copié (il s\'ouvre avec ta session Odin)'); } }, icon('link', 16), 'Lien')),
      e.apps?.length ? el('div', { class: 'apps-sec' }, el('div', { class: 'label' }, 'Dans Odin'), el('div', { class: 'apps' }, ...e.apps.map((a) => el('div', { class: 'app1' }, el('b', {}, a.name), a.label ? el('span', {}, a.label) : null, el('a', { class: 'act', href: `/#app=${encodeURIComponent(a.id)}` }, icon('open', 16), 'Ouvrir'))))) : null,
      e.followups?.length ? el('div', { class: 'fu' }, el('div', { class: 'label' }, 'Pour aller plus loin'), ...e.followups.map((f) => el('button', { type: 'button', onclick: () => run(f, true) }, f, icon('plus', 16)))) : null,
      e.errors?.length ? el('p', { class: 'note' }, `Moteurs : ${e.engines.join(', ') || '—'} · ${e.errors.slice(0, 2).join(' ; ')}`) : el('p', { class: 'note' }, `Moteurs : ${e.engines.join(', ') || '—'}`));
  }
  // Export : le fichier est fabriqué ici, l'icône en haut montre qu'il est prêt.
  function exportAs(e, kind) {
    if (kind === 'pdf') { exports.unshift({ name: `Impression PDF · ${e.q.slice(0, 40)}`, at: Date.now() }); draw(); setTimeout(() => print(), 50); return; }
    const md = () => { const fx = e.answer.replace(/\[(\d{1,2})\]/g, '[$1](#source-$1)'); return `# ${e.q}\n\n_${new Date(e.at).toLocaleString('fr-FR')} · moteurs : ${e.engines.join(', ')}_\n\n${fx}\n\n## Sources\n\n${e.sources.map((s) => `<a id="source-${s.n}"></a>${s.n}. [${s.title.replace(/[[\]]/g, '')}](${s.url}) — ${s.domain}`).join('\n')}\n`; };
    const blob = new Blob([kind === 'md' ? md() : JSON.stringify(e, null, 2)], { type: kind === 'md' ? 'text/markdown' : 'application/json' });
    const url = URL.createObjectURL(blob), name = `volva-${e.q.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.${kind}`;
    const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
    exports.unshift({ name, at: Date.now(), url: undefined }); draw(); toast(`Exporté : ${name}`);
  }
  function exportsMenu(btn) {
    document.querySelector('.menu')?.remove();
    const m = el('div', { class: 'menu', role: 'menu' }, ...(exports.length ? exports.slice(0, 8).map((x) => el('button', { type: 'button', role: 'menuitem', onclick: () => m.remove() }, icon('dl', 16), el('span', {}, x.name, el('small', {}, new Date(x.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))))) : [el('button', { type: 'button', disabled: true }, 'Aucun export pour l\'instant')]));
    btn.parentElement.append(m); setTimeout(() => document.addEventListener('click', function off(ev) { if (!m.contains(ev.target) && ev.target !== btn) { m.remove(); document.removeEventListener('click', off); } }), 0);
  }
  let busy = false;
  function draw() {
    const side = el('aside', { 'aria-label': 'Historique' },
      el('div', { class: 'brand' }, el('span', { class: 'ico', 'aria-hidden': 'true' }, 'ᚡ'), 'Völva'),
      el('button', { class: 'new', type: 'button', onclick: () => { thread = []; current = null; history.replaceState(null, '', '/recherche'); draw(); } }, icon('plus', 16), 'Nouvelle recherche'),
      el('h2', {}, 'Historique'), el('div', { class: 'hist' }, ...state.history.filter((h, i, l) => !h.thread || l.findIndex((x) => x.thread === h.thread) === i).slice(0, 40).map((h) => el('button', { type: 'button', 'aria-current': String(current === h.id), title: h.q, onclick: () => open(h.id) }, h.q))),
      el('p', { class: 'note', style: { marginTop: 'auto' } }, `${state.engines.length} moteur(s) : ${state.engines.join(', ') || 'aucun — règle Völva dans Odin'}${state.ai ? '' : ' · sans IA'}`));
    const exBtn = el('button', { class: 'tbtn', type: 'button', 'aria-label': `Exports (${exports.length})`, onclick: (ev) => exportsMenu(ev.currentTarget) }, icon('dl', 18), exports.length ? el('span', { class: 'dot' }, String(exports.length)) : null);
    const main = el('main', { id: 'main' },
      el('div', { class: 'top' }, el('button', { class: 'tbtn mob', type: 'button', 'aria-label': 'Historique', onclick: () => side.classList.toggle('open') }, icon('menu', 18)), el('div', { style: { position: 'relative' } }, exBtn), el('a', { class: 'tbtn', href: '/', 'aria-label': 'Retour à Odin', style: { textDecoration: 'none' } }, 'Odin')),
      ...(thread.length || busy ? [...thread.map((e, i) => qa(e, i)), busy ? el('div', { class: 'qa wait', 'aria-busy': 'true' }, el('h2', {}, busy), el('div', { class: 'bar', style: { width: '90%' } }), el('div', { class: 'bar', style: { width: '75%' } }), el('div', { class: 'bar', style: { width: '82%' } }), el('p', { class: 'note' }, `Je cherche sur ${state.engines.join(', ') || 'les moteurs'}, je lis les pages, puis je rédige…`)) : null]
        : [el('div', { class: 'hero' }, el('h1', {}, 'Que veux-tu savoir ?'), el('p', {}, 'Völva cherche sur tous tes moteurs, lit les pages et te répond avec ses sources.'), box(true), el('p', { class: 'engines' }, state.engines.length ? `Moteurs : ${state.engines.join(' · ')}` : 'Aucun moteur réglé : ouvre Völva dans Odin (SearXNG ou une clé Brave).'))]));
    root.replaceChildren(side, main, ...(thread.length && !busy ? [el('div', { class: 'follow' }, box(false))] : []));
    document.querySelectorAll('.mob').forEach((b) => { b.style.display = matchMedia('(max-width:820px)').matches ? '' : 'none'; });
  }
  async function run(q, follow) {
    if (busy) return; busy = q; if (!follow) thread = []; draw(); scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    try {
      const r = await api('/api/recherche/chercher', { question: q, focus, approfondie: deep, ...(follow && thread.length ? { suite: thread[0].thread || thread[0].id } : {}) });
      busy = false; if (!r.ok) { toast(r.error || 'Recherche impossible'); draw(); return; }
      thread.push(r.entry); current = thread[0].id; history.replaceState(null, '', `/recherche#r=${thread[0].id}`); await refresh(); draw();
      setTimeout(() => document.querySelectorAll('.qa')[thread.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } catch (e) { busy = false; draw(); toast(e.auth ? 'Connecte-toi à Odin d\'abord' : e.message); if (e.auth) setTimeout(() => { location.href = '/'; }, 1500); }
  }
  async function open(id) { const r = await api(`/api/recherche/entree?id=${encodeURIComponent(id)}`).catch(() => ({ ok: false })); if (r.ok) { thread = r.thread; current = id; history.replaceState(null, '', `/recherche#r=${id}`); draw(); } }
  async function refresh() { try { const r = await api('/api/recherche/etat'); if (r.ok) state = r; } catch (e) { if (e.auth) { root.replaceChildren(el('main', {}, el('div', { class: 'hero' }, el('h1', {}, 'Völva'), el('p', {}, 'Connecte-toi à Odin pour chercher.'), el('a', { class: 'act', href: '/' }, 'Se connecter')))); throw e; } } }
  refresh().then(() => { draw(); const m = /r=([a-f0-9]{6,20})/.exec(location.hash); if (m) open(m[1]); const q = new URLSearchParams(location.search).get('q'); if (q) run(q, false); }).catch(() => 0);
})();
