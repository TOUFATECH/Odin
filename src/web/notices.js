// Les bulles de la mascotte : partout (toutes les pages, Discussion comprise, téléphone compris), juste
// au-dessus d'Odin, et elles le suivent quand il se déplace. Une seule bulle à la fois : la suivante
// remplace la précédente (l'historique reste dans le panneau). Couleur selon la gravité :
// vert = tout va bien, orange = un souci, rouge = grave (la mascotte passe alors au rouge et le dit).
// Toucher la bulle : Odin ouvre la page du problème et explique quoi faire (procédure, manips, voix).
(() => {
  'use strict';
  if (window.OdinNotices) return;
  const COLORS = { ok: '#1E7A4C', souci: '#A85A06', grave: '#B8321F' };
  const SEEN = 'odin-bulle-vue';
  const css = `
  #odinBubble{position:fixed;z-index:60;left:0;top:0;width:min(320px,calc(100vw - 24px));box-sizing:border-box;text-align:left;border:0;border-radius:18px;padding:12px 16px 12px 16px;color:#fff;font:inherit;cursor:pointer;display:flex;flex-direction:column;gap:3px;box-shadow:0 12px 40px rgba(0,0,0,.35);transition:opacity .2s, transform .2s}
  #odinBubble[hidden]{display:none}
  #odinBubble .ob-top{display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:700}
  #odinBubble .ob-top span:last-child{font-weight:500;opacity:.9}
  #odinBubble .ob-t{font-size:15px;font-weight:600;line-height:1.35}
  #odinBubble .ob-h{font-size:12px;opacity:.92}
  #odinBubble .ob-tail{position:absolute;width:16px;height:16px;transform:rotate(45deg);background:inherit}
  #odinBubble .ob-x{position:absolute;top:2px;right:2px;width:36px;height:36px;border:0;border-radius:10px;background:transparent;color:#fff;font-size:18px;cursor:pointer;opacity:.85}
  #odinBubble .ob-x:hover{background:rgba(0,0,0,.15)}
  #odinBubble .ob-top{padding-right:26px}
  @keyframes obPop{0%{opacity:0;transform:translateY(8px) scale(.94)}100%{opacity:1;transform:none}}
  #odinBubble.pop{animation:obPop .22s ease-out}
  #odinAdvice{position:fixed;z-index:61;right:16px;bottom:16px;width:min(420px,calc(100vw - 24px));max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;background:var(--panel,#1f2228);color:var(--ink,#f3f4f6);border:2px solid var(--ob,#3a3f47);border-radius:20px;padding:18px;display:flex;flex-direction:column;gap:10px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
  #odinAdvice[hidden]{display:none}
  #odinAdvice .oa-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
  #odinAdvice .oa-chip{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;color:#fff}
  #odinAdvice .oa-close{width:44px;height:44px;border-radius:12px;border:0;background:transparent;color:inherit;font-size:22px;cursor:pointer}
  #odinAdvice h3{margin:0;font-size:17px;line-height:1.35}
  #odinAdvice .oa-d{margin:0;font-size:14px;opacity:.85;line-height:1.5}
  #odinAdvice .oa-s{font-size:13px;font-weight:600;margin-top:2px}
  #odinAdvice ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:5px;font-size:14px;line-height:1.45}
  #odinAdvice .oa-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
  #odinAdvice .oa-acts button{min-height:44px;padding:10px 14px;border-radius:12px;border:1px solid var(--line,#3f444c);background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer}
  #odinAdvice .oa-acts button.p{border:0;color:#fff;font-weight:600}
  #odinAdvice .oa-ai{white-space:pre-line;font-size:14px;line-height:1.5;background:rgba(127,127,127,.1);border-radius:12px;padding:10px 12px}
  #odinAdvice .oa-st{font-size:13px;opacity:.9;white-space:pre-line}
  #odinAdvice .oa-prev{border-top:1px solid var(--line,#3f444c);padding-top:8px;display:flex;flex-direction:column;gap:2px}
  #odinAdvice .oa-prev button{display:flex;gap:8px;align-items:center;text-align:left;border:0;background:transparent;color:inherit;font:inherit;font-size:13px;padding:6px 4px;border-radius:8px;cursor:pointer}
  #odinAdvice .oa-prev button:hover{background:rgba(127,127,127,.12)}
  #odinAdvice .oa-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
  .odin.alarm .body > circle{fill:#D9452E}
  @keyframes obPulse{0%,100%{filter:drop-shadow(0 0 0 rgba(238,106,85,.7))}50%{filter:drop-shadow(0 0 12px rgba(238,106,85,.9))}}
  .odin.alarm svg{animation:obPulse 1.4s infinite}
  @media (prefers-reduced-motion:reduce){#odinBubble.pop,.odin.alarm svg{animation:none}}`;
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'on') for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : String(v)); } for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k); return e; };
  const api = async (url, body) => { const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } }); return r.json(); };
  const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'à l\'instant' : s < 3600 ? `il y a ${Math.round(s / 60)} min` : new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };

  let bubble, tail, panel, current = null, hideT = 0, raf = 0;
  const history = [];

  // ---------- Où est Odin ? La mascotte en liberté, sinon celle de la Discussion ----------
  function anchor() {
    const cands = [document.getElementById('buddyRoam'), ...document.querySelectorAll('.view.on .odin, .odin')];
    for (const c of cands) { if (!c || c.hidden) continue; const r = c.getBoundingClientRect(); if (r.width >= 24 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(c).visibility !== 'hidden') return { el: c, r }; }
    return null;
  }
  function mascots() { return [...document.querySelectorAll('.odin')]; }
  function placeBubble() {
    raf = 0; if (!bubble || bubble.hidden) return;
    const a = anchor(), w = bubble.offsetWidth, h = bubble.offsetHeight, m = 12;
    let x, y, below = false, cx;
    if (a) {
      cx = a.r.left + a.r.width / 2;
      x = Math.min(Math.max(m, a.r.right - w), innerWidth - w - m);
      y = a.r.top - h - 14; if (y < m) { y = a.r.bottom + 14; below = true; }
    } else { x = innerWidth - w - m; y = innerHeight - h - 90; cx = x + w - 40; }
    bubble.style.transform = '';
    bubble.style.left = `${Math.round(x)}px`; bubble.style.top = `${Math.round(y)}px`;
    const tx = Math.min(Math.max(cx - x - 8, 18), w - 34);
    tail.style.left = `${Math.round(tx)}px`; tail.style.top = below ? '-8px' : ''; tail.style.bottom = below ? '' : '-8px';
    raf = requestAnimationFrame(placeBubble);
  }
  function follow() { if (!raf) raf = requestAnimationFrame(placeBubble); }

  function build() {
    if (bubble) return;
    document.head.append(el('style', {}, css));
    tail = el('span', { class: 'ob-tail', 'aria-hidden': 'true' });
    bubble = el('div', { id: 'odinBubble', hidden: true, role: 'status', 'aria-live': 'polite' });
    document.body.append(bubble);
    panel = el('section', { id: 'odinAdvice', hidden: true, 'aria-label': 'Conseils d\'Odin', on: { keydown: (e) => { if (e.key === 'Escape') closePanel(); } } });
    document.body.append(panel);
  }
  function setAlarm(on) { for (const o of mascots()) o.classList.toggle('alarm', on); }

  // ---------- Une nouvelle bulle : elle remplace la précédente ----------
  function show(n, o = {}) {
    build(); current = n; clearTimeout(hideT);
    if (!history.some((x) => x.id === n.id)) { history.unshift(n); history.splice(12); }
    const color = COLORS[n.level] || COLORS.ok;
    bubble.style.background = color; bubble.setAttribute('role', n.level === 'grave' ? 'alert' : 'status');
    bubble.replaceChildren(
      el('span', { class: 'ob-top' }, el('span', {}, n.kind), el('span', {}, `${n.app} · ${ago(n.at)}`)),
      el('span', { class: 'ob-t' }, n.title),
      el('span', { class: 'ob-h' }, n.level === 'grave' ? 'Urgence à regarder : touche pour voir quoi faire ›' : 'Touche pour voir quoi faire ›'),
      el('button', { type: 'button', class: 'ob-x', 'aria-label': 'Fermer la bulle', on: { click: (e) => { e.stopPropagation(); hide(); } } }, '×'),
      tail);
    bubble.onclick = () => open(n);
    bubble.tabIndex = 0; bubble.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(n); } };
    bubble.hidden = false; bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
    setAlarm(n.level === 'grave');
    const bud = document.getElementById('buddyRoam');
    if (bud && window.OdinFace) window.OdinFace.flash(bud, n.level === 'grave' ? 'peur' : n.level === 'souci' ? 'inquiet' : n.kind === 'Décision d\'Odin' ? 'fierte' : 'joie', 2600);
    window.OdinCompanion?.act?.(n.level === 'ok' ? 'act-joy' : 'act-tilt', 1400);
    // Odin parle : l'urgence est dite à voix haute (si les sons sont activés).
    if (n.level === 'grave' && !o.quiet && window.OdinFace?.soundOn !== false) window.OdinSay?.(`Urgence. ${n.title}`);
    if (n.level === 'ok') hideT = setTimeout(hide, 25_000);
    follow();
  }
  function hide() { if (!bubble) return; bubble.hidden = true; if (current) try { localStorage.setItem(SEEN, current.id); } catch { /* navigation privée */ } if (current?.level === 'grave' && panel.hidden) setAlarm(false); }

  // ---------- Toucher la bulle : la page du problème + les conseils ----------
  function goTo(n) {
    if (n.page?.app && n.page.app !== 'odin') { if (location.hash !== '#apps') location.hash = '#apps'; setTimeout(() => window.OdinApps?.app(n.page.app), 150); }
    else if (n.page?.view) location.hash = `#${n.page.view}`;
  }
  async function runAction(a, out) {
    out.textContent = 'En cours…';
    try {
      let r;
      if (a.module === '_manip') {
        if (a.action === 'annuler' && !window.confirm(`${a.label} ?`)) { out.textContent = 'Rien n\'a été changé.'; return; }
        r = await api('/api/valhalla/manip', { id: a.input.id, keep: a.action === 'garder', confirm: true });
      }
      else {
        r = await api('/api/valhalla/act', { module: a.module, action: a.action, input: a.input });
        if (r.confirm) { if (!window.confirm(r.confirm)) { out.textContent = 'Annulé : rien n\'a été fait.'; return; } r = await api('/api/valhalla/act', { module: a.module, action: a.action, input: a.input, confirm: true }); }
      }
      out.textContent = r.ok ? `✓ ${r.text ?? 'Fait.'}` : `✗ ${r.text ?? r.error ?? 'échec'}`;
      if (r.ok && current?.level === 'grave') setAlarm(false);
    } catch (e) { out.textContent = `✗ ${e.message}`; }
  }
  function open(n) {
    build(); goTo(n); hide();
    const color = COLORS[n.level] || COLORS.ok, out = el('div', { class: 'oa-st', role: 'status' }), ai = el('div', { class: 'oa-ai', hidden: true });
    panel.style.setProperty('--ob', color);
    const listen = () => window.OdinSay?.(`${n.title}. ${n.detail ?? ''} Ce que je te conseille : ${n.steps.map((s, i) => `${i + 1}, ${s}`).join(' ')}`, true);
    panel.replaceChildren(...[
      el('div', { class: 'oa-head' }, el('span', { class: 'oa-chip', style: `background:${color}` }, `${n.kind} · ${n.app}`), el('button', { type: 'button', class: 'oa-close', 'aria-label': 'Fermer', on: { click: closePanel } }, '×')),
      el('h3', {}, n.title),
      n.detail ? el('p', { class: 'oa-d' }, n.detail) : null,
      el('div', { class: 'oa-s' }, 'Ce que je te conseille'),
      el('ol', {}, n.steps.map((s) => el('li', {}, s))),
      ai,
      el('div', { class: 'oa-acts' },
        n.actions.map((a) => el('button', { type: 'button', class: a.primary ? 'p' : '', style: a.primary ? `background:${color}` : undefined, on: { click: () => runAction(a, out) } }, a.label)),
        n.page ? el('button', { type: 'button', on: { click: () => goTo(n) } }, 'Aller sur la page') : null,
        el('button', { type: 'button', on: { click: listen } }, 'Écouter'),
        el('button', { type: 'button', on: { click: async (e) => { e.target.disabled = true; ai.hidden = false; ai.textContent = 'Odin réfléchit…'; try { const r = await api('/api/valhalla/notice_advice', { id: n.id }); ai.textContent = r.ok ? r.text : `✗ ${r.error}`; if (r.ok) window.OdinSay?.(r.text, false); } catch (x) { ai.textContent = `✗ ${x.message}`; } e.target.disabled = false; } } }, 'Demander conseil à Odin')),
      out,
      history.length > 1 ? el('div', { class: 'oa-prev' }, el('div', { class: 'oa-s' }, 'Avant'), history.filter((x) => x.id !== n.id).slice(0, 5).map((x) => el('button', { type: 'button', on: { click: () => open(x) } }, el('span', { class: 'oa-dot', style: `background:${COLORS[x.level]}` }), el('span', {}, `${ago(x.at)} · ${x.app} — ${x.title}`)))) : null].filter(Boolean));
    panel.hidden = false; panel.querySelector('.oa-close').focus();
    window.OdinCompanion?.pin?.(60_000);
  }
  function closePanel() { panel.hidden = true; if (current?.level === 'grave') setAlarm(false); window.OdinCompanion?.pin?.(0); }

  // ---------- Au chargement : la dernière bulle non vue (récente), puis le direct ----------
  let booted = false;
  async function boot() {
    if (booted) return;
    try {
      const r = await api('/api/valhalla/notices?n=12'); if (!r.ok) return; booted = true;
      history.push(...r.notices);
      let seen = ''; try { seen = localStorage.getItem(SEEN) || ''; } catch { /* */ }
      const last = r.notices[0];
      if (last && last.id !== seen) { const age = Date.now() - Date.parse(last.at); if ((last.level !== 'ok' && age < 6 * 3600_000) || age < 15 * 60_000) show(last, { quiet: true }); }
    } catch { /* pas connecté : rien */ }
  }
  window.OdinNotices = { boot, push: (n) => show(n), open, hide, local: (n) => show({ id: `l${Date.now()}`, at: new Date().toISOString(), steps: [], actions: [], app: 'Odin', kind: n.kind ?? 'Un souci', level: 'souci', ...n }), list: () => history.slice() };
  addEventListener('resize', follow);
  const start = () => setTimeout(boot, 1200);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
