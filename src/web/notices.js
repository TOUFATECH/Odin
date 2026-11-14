// Les bulles de la mascotte : partout (toutes les pages, Discussion comprise, téléphone compris), juste
// au-dessus d'Odin, et elles le suivent quand il se déplace. Une seule bulle à la fois : la suivante
// remplace la précédente (l'historique reste dans le panneau). Couleur selon la gravité :
// vert = tout va bien, orange = un souci, rouge = grave (la mascotte passe alors au rouge et le dit).
// Toucher la bulle : Odin ouvre la page du problème et explique quoi faire (procédure, manips, voix).
(() => {
  'use strict';
  if (window.OdinNotices) return;
  const COLORS = { ok: '#1E7A4C', souci: '#A85A06', grave: '#B8321F' };
  // La petite bulle prend la couleur du message : humeur, moment, information, souci ou urgence.
  const TONE = { ok: ['#13301f', '#bff0d1', '#34c77b'], info: ['#16234a', '#c9d6ff', '#5a6fdb'], moment: ['#3b2a0b', '#ffe3a6', '#ffc53d'], fierte: ['#2a1747', '#e0d2ff', '#9166e6'], souci: ['#3a2306', '#ffd9a3', '#f0a020'], grave: ['#4a1210', '#ffd0ca', '#ef4f43'] };
  const toneOf = (n) => (n.level === 'grave' ? 'grave' : n.level === 'souci' ? 'souci' : /moment|bonjour|bonsoir|bonne nuit/i.test(`${n.kind}`) ? 'moment' : /décision/i.test(`${n.kind}`) ? 'fierte' : /info|réponse|odin/i.test(`${n.kind}`) && !/souci/i.test(`${n.kind}`) ? 'info' : 'ok');
  const SEEN = 'odin-bulle-vue';
  // Qui te protège (maquette validée « Alertes : Antivirus ou Malware ? ») : chacun sa couleur ; Odin la prend quand
  // il alerte, et la bulle porte la pastille de celui qui a trouvé. La gravité garde ses couleurs (vert, orange, rouge).
  const PROT = { ullr: { label: 'Antivirus', color: '#7c4dff', icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', what: 'analyse les fichiers : téléchargements, pièces jointes, clés USB, partages' },
    skogul: { label: 'Malware', color: '#e0457b', icon: 'M8 9h8v7a4 4 0 0 1-8 0zM9 9V7a3 3 0 0 1 6 0v2M4 12h4M16 12h4M5 7l3 2M19 7l-3 2M5 18l3-2M19 18l-3-2', what: 'surveille ce que font les programmes : chiffrement de fichiers, connexions bizarres, démarrage caché' } };
  const protOf = (n) => (n && PROT[n.module]) || (n && /ullr|antivirus/i.test(`${n.app}`) ? PROT.ullr : n && /sk[öo]gul|malware/i.test(`${n.app}`) ? PROT.skogul : undefined);
  const protPill = (p, z = 12) => el('span', { class: 'ob-prot', style: `background:${p.color}` }, svg(p.icon, z), p.label);
  let tinted = false;
  /** Odin prend la couleur de celui qui a trouvé, avec sa pastille ; il reprend la sienne quand la bulle part. */
  function protTint(p) {
    const b = document.getElementById('buddyRoam');
    b?.querySelector('.odin-prot')?.remove();
    if (p) { window.OdinFace?.tintBase?.(p.color); tinted = true; if (b) b.append(el('span', { class: 'odin-prot', style: `color:${p.color}`, 'aria-hidden': 'true' }, svg(p.icon, 11))); }
    else if (tinted) { tinted = false; const t = window.OdinThemes?.current?.(); if (t) window.OdinThemes.apply(t); else window.OdinFace?.tintBase?.(null); void window.OdinThemes?.sync?.(); }
  }
  const css = `
  #odinBubble{position:fixed;z-index:60;left:0;top:0;max-width:min(320px,calc(100vw - 24px));box-sizing:border-box;display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 6px 0 6px;border:0;border-radius:17px;font:500 13.5px/1 inherit;cursor:pointer;box-shadow:0 6px 16px rgba(0,0,0,.3)}
  #odinBubble[hidden]{display:none}
  .ob-prot{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 9px 0 7px;border-radius:12px;color:#fff;font:700 12px/1 inherit;flex:none;white-space:nowrap}
  .odin-prot{position:absolute;right:-2px;bottom:-2px;width:20px;height:20px;border-radius:50%;background:#fff;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none}
  #odinTalk .ot-prot{display:flex;flex-direction:column;gap:6px}#odinTalk .ot-prot small{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9aa1b2;padding:0 4px}
  #odinTalk .ot-pr{display:flex;align-items:center;gap:10px;border-radius:12px;padding:8px 10px;border:1px solid}#odinTalk .ot-pr i{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#fff;flex:none}
  #odinTalk .ot-pr b{font-size:13.5px}#odinTalk .ot-pr span{display:block;font-size:12px;color:#b9c0cf}
  #odinTalk .ot-seg{display:flex;gap:2px;background:rgba(0,0,0,.25);border-radius:10px;padding:3px}#odinTalk .ot-seg button{flex:1;height:28px;border:0;border-radius:8px;background:none;color:#b9c0cf;font:600 12px inherit;cursor:pointer}#odinTalk .ot-seg button[aria-pressed=true]{background:rgba(255,255,255,.12);color:#fff}
  #odinTalk .ot-it{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:6px 4px;border-radius:9px;cursor:pointer}#odinTalk .ot-it:hover{background:rgba(255,255,255,.05)}#odinTalk .ot-it b{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}#odinTalk .ot-it time{color:#9aa1b2;font-size:11.5px}
  #odinBubble .ob-dot{width:22px;height:22px;border-radius:50%;flex:none}
  #odinBubble .ob-t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  #odinBubble .ob-say{width:26px;height:26px;border:0;border-radius:13px;background:transparent;color:inherit;display:grid;place-items:center;cursor:pointer;opacity:.8;flex:none}
  #odinBubble .ob-say:hover{background:rgba(255,255,255,.12)}
  #odinBubble .ob-tail{position:absolute;width:12px;height:12px;transform:rotate(45deg);background:inherit;border-radius:2px}
  @keyframes obPop{0%{opacity:0;transform:translateY(6px) scale(.92)}100%{opacity:1;transform:none}}
  #odinBubble.pop{animation:obPop .2s ease-out}
  @keyframes obBlink{0%,100%{box-shadow:0 6px 16px rgba(0,0,0,.3),0 0 0 0 rgba(239,79,67,.55)}50%{box-shadow:0 6px 16px rgba(0,0,0,.3),0 0 0 6px rgba(239,79,67,0)}}
  #odinBubble.grave{animation:obBlink 1.6s infinite}
  #odinTalk{position:fixed;z-index:61;left:0;top:0;width:min(300px,calc(100vw - 24px));box-sizing:border-box;border-radius:18px;background:rgba(30,34,48,.97);color:#eef0f6;border:1px solid rgba(255,255,255,.1);box-shadow:0 10px 24px rgba(0,0,0,.4);padding:8px;display:flex;flex-direction:column;gap:8px;font:14px/1.45 inherit}
  #odinTalk[hidden]{display:none}
  #odinTalk .ot-h{display:flex;align-items:flex-start;gap:8px;padding:2px 4px 0}
  #odinTalk .ot-h b{font-weight:600;flex:1;min-width:0}
  #odinTalk .ot-dot{width:14px;height:14px;border-radius:50%;flex:none;margin-top:3px}
  #odinTalk .ot-x{width:28px;height:28px;border:0;border-radius:9px;background:transparent;color:#c9ceda;cursor:pointer;flex:none}
  #odinTalk .ot-d{margin:0 4px;font-size:13px;color:#b9c0cf;white-space:pre-line;max-height:30vh;overflow:auto}
  #odinTalk .ot-acts{display:flex;flex-wrap:wrap;gap:6px;padding:0 2px}
  #odinTalk .ot-acts button{height:32px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:transparent;color:inherit;font:500 13px inherit;padding:0 10px;cursor:pointer}
  #odinTalk .ot-acts button.p{border:0;color:#1a0d02;font-weight:600}
  #odinTalk form{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.06);border-radius:12px;padding:4px 4px 4px 10px}
  #odinTalk input{flex:1;min-width:0;border:0;background:transparent;color:inherit;font:14px inherit;outline:none}
  #odinTalk form button{width:32px;height:32px;border-radius:10px;border:0;display:grid;place-items:center;cursor:pointer;flex:none}
  #odinTalk .ot-mic{background:rgba(255,255,255,.1);color:#eef0f6}#odinTalk .ot-mic[aria-pressed=true]{background:#ef4f43;color:#fff}
  #odinTalk .ot-go{background:#ff8a3d;color:#1a0d02}
  #odinTalk .ot-tail{position:absolute;width:12px;height:12px;transform:rotate(45deg);background:rgba(30,34,48,.97);border-right:1px solid rgba(255,255,255,.1);border-bottom:1px solid rgba(255,255,255,.1)}
  #odinAdvice{position:fixed;z-index:62;right:16px;bottom:16px;width:min(400px,calc(100vw - 24px));max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;background:rgba(24,27,36,.97);border:1px solid rgba(255,255,255,.09);border-radius:24px!important;box-shadow:0 24px 60px rgba(0,0,0,.5);color:var(--ink,#f3f4f6);border:2px solid var(--ob,#3a3f47);border-radius:20px;padding:18px;display:flex;flex-direction:column;gap:10px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
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
  #odinAdvice{color:#eef0f6}#odinAdvice .oa-acts button{border-color:rgba(255,255,255,.14)}
  .odin.alarm .body > circle{fill:#D9452E}
  @keyframes obPulse{0%,100%{filter:drop-shadow(0 0 0 rgba(238,106,85,.7))}50%{filter:drop-shadow(0 0 12px rgba(238,106,85,.9))}}
  .odin.alarm svg{animation:obPulse 1.4s infinite}
  @media (prefers-reduced-motion:reduce){#odinBubble.pop,#odinBubble.grave,.odin.alarm svg{animation:none}}`;
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'on') for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : String(v)); } for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k); return e; };
  const api = async (url, body) => { const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } }); return r.json(); };
  const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'à l\'instant' : s < 3600 ? `il y a ${Math.round(s / 60)} min` : new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };

  let bubble, tail, panel, talk, ttail, current = null, hideT = 0, raf = 0, waiting = false, later = null;
  const history = [];

  // ---------- Où est Odin ? La mascotte en liberté, sinon celle de la Discussion ----------
  function anchor() {
    const cands = [document.getElementById('buddyRoam'), ...document.querySelectorAll('.view.on .odin, .odin')];
    for (const c of cands) { if (!c || c.hidden) continue; const r = c.getBoundingClientRect(); if (r.width >= 24 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(c).visibility !== 'hidden') return { el: c, r }; }
    return null;
  }
  function mascots() { return [...document.querySelectorAll('.odin')]; }
  function placeBubble() {
    raf = 0; if (!bubble) return;
    const box = !talk.hidden ? talk : !bubble.hidden ? bubble : null, tl = box === talk ? ttail : tail; if (!box) return;
    const a = anchor(), w = box.offsetWidth, h = box.offsetHeight, m = 12;
    let x, y, below = false, cx;
    if (a) {
      cx = a.r.left + a.r.width / 2;
      x = Math.min(Math.max(m, cx - w / 2), innerWidth - w - m);
      y = a.r.top - h - 12; if (y < m) { y = a.r.bottom + 12; below = true; }
      // Dans la Discussion, Odin parle déjà dans son nuage (conseils, visite) : la bulle se pose au-dessus du nuage, pas sur ses boutons.
      const tip = document.getElementById('buddyTip');
      if (tip && !tip.hidden && !below) { const t = tip.getBoundingClientRect(); if (t.width && x < t.right && x + w > t.left && y < t.bottom && y + h > t.top && t.top - h - 10 >= m) y = t.top - h - 10; }
    } else { x = innerWidth - w - m; y = innerHeight - h - 90; cx = x + w - 40; }
    box.style.transform = '';
    box.style.left = `${Math.round(x)}px`; box.style.top = `${Math.round(y)}px`;
    const tx = Math.min(Math.max(cx - x - 6, 12), w - 24);
    tl.style.left = `${Math.round(tx)}px`; tl.style.top = below ? '-6px' : ''; tl.style.bottom = below ? '' : '-6px';
    raf = requestAnimationFrame(placeBubble);
  }
  function follow() { if (!raf) raf = requestAnimationFrame(placeBubble); }

  function build() {
    if (bubble) return;
    document.head.append(el('style', {}, css));
    tail = el('span', { class: 'ob-tail', 'aria-hidden': 'true' });
    bubble = el('div', { id: 'odinBubble', hidden: true, role: 'status', 'aria-live': 'polite' });
    document.body.append(bubble);
    ttail = el('span', { class: 'ot-tail', 'aria-hidden': 'true' });
    talk = el('section', { id: 'odinTalk', hidden: true, 'aria-label': 'Parler à Odin', on: { keydown: (e) => { if (e.key === 'Escape') closeTalk(); } } });
    document.body.append(talk);
    panel = el('section', { id: 'odinAdvice', hidden: true, 'aria-label': 'Conseils d\'Odin', on: { keydown: (e) => { if (e.key === 'Escape') closePanel(); } } });
    document.body.append(panel);
  }
  function setAlarm(on) { for (const o of mascots()) o.classList.toggle('alarm', on); }

  // ---------- Une nouvelle bulle : elle remplace la précédente ----------
  function show(n, o = {}) {
    build();
    // Pendant que tu parles à Odin dans la petite fenêtre, une nouvelle bulle attend qu'elle se ferme (sauf urgence).
    if (talk && !talk.hidden && n.level !== 'grave') { if (!history.some((x) => x.id === n.id)) { history.unshift(n); history.splice(12); } later = [n, o]; return; }
    current = n; clearTimeout(hideT);
    if (!history.some((x) => x.id === n.id)) { history.unshift(n); history.splice(12); }
    const [bg, fg, dot] = TONE[toneOf(n)];
    later = null; closeTalk(true);
    bubble.style.background = bg; bubble.style.color = fg; bubble.setAttribute('role', n.level === 'grave' ? 'alert' : 'status');
    bubble.classList.toggle('grave', n.level === 'grave');
    bubble.setAttribute('aria-label', `${protOf(n) ? `${protOf(n).label} · ` : ''}${n.kind} · ${n.app} : ${n.title}. Touche pour répondre.`);
    protTint(n.level !== 'ok' || protOf(n) ? protOf(n) : undefined);
    bubble.replaceChildren(
      protOf(n) ? protPill(protOf(n)) : el('span', { class: 'ob-dot', style: `background:${dot}`, 'aria-hidden': 'true' }),
      el('span', { class: 'ob-t' }, n.title),
      el('button', { type: 'button', class: 'ob-say', 'aria-label': 'Écouter', title: 'Écouter', on: { click: (e) => { e.stopPropagation(); window.OdinSay?.(`${n.title}. ${n.detail ?? ''}`, true); } } }, svg('M4 9h4l5-4v14l-5-4H4zM17 8a5 5 0 0 1 0 8', 15)),
      tail);
    bubble.onclick = () => talkTo(n);
    bubble.tabIndex = 0; bubble.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); talkTo(n); } };
    bubble.hidden = false; bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
    setAlarm(n.level === 'grave');
    const bud = document.getElementById('buddyRoam');
    if (bud && window.OdinFace) window.OdinFace.flash(bud, n.level === 'grave' ? 'peur' : n.level === 'souci' ? 'inquiet' : n.kind === 'Décision d\'Odin' ? 'fierte' : 'joie', 2600);
    window.OdinCompanion?.act?.(n.level === 'ok' ? 'act-joy' : 'act-tilt', 1400);
    // Odin parle : l'urgence est dite à voix haute (si les sons sont activés).
    if (n.level === 'grave' && !o.quiet && window.OdinFace?.soundOn !== false) window.OdinSay?.(`Urgence. ${n.title}`);
    // Vert, bleu, jaune, violet : 4 secondes. Orange : jusqu'au toucher. Rouge : reste et clignote.
    if (n.level === 'ok') hideT = setTimeout(hide, 4000);
    // Odin dit ses messages à voix haute quand la voix est activée (l'urgence, toujours).
    if (n.level !== 'grave' && !o.quiet && window.OdinVoice?.on?.()) window.OdinSay?.(n.title);
    follow();
    // La bulle est là : Odin se déplace tout de suite si elle couvrait du texte ou une commande (il lui cherche une place libre).
    window.OdinCompanion?.sync?.('hopto');
  }
  function hide() { if (!bubble) return; bubble.hidden = true; protTint(undefined); if (current) try { localStorage.setItem(SEEN, current.id); } catch { /* navigation privée */ } if (current?.level === 'grave' && panel.hidden) setAlarm(false); }

  // ---------- La petite fenêtre : lire, agir, et parler à Odin depuis n'importe quel onglet ----------
  function svg(d, z = 16) { const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', z); s.setAttribute('height', z); s.setAttribute('aria-hidden', 'true'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); s.append(p); return s; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function talkTo(n) {
    build(); clearTimeout(hideT); bubble.hidden = true;
    const [, , dot] = n ? TONE[toneOf(n)] : TONE.info, out = el('p', { class: 'ot-d', role: 'status', 'aria-live': 'polite', hidden: !n?.detail }, n?.detail ?? '');
    const input = el('input', { type: 'text', placeholder: n ? 'Réponds à Odin…' : 'Dis-moi… (« allume le salon »)', 'aria-label': 'Parle à Odin', enterkeyhint: 'send' });
    const mic = el('button', { type: 'button', class: 'ot-mic', 'aria-label': 'Parler au micro', 'aria-pressed': 'false' }, svg('M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3', 15));
    mic.onclick = () => { if (!SR) { out.hidden = false; out.textContent = 'Ce navigateur ne sait pas écrire ce que tu dis (Chrome, Edge ou Safari).'; return; } if (mic._r) { mic._r.stop(); return; } const r = new SR(), base = input.value.trim() ? `${input.value.trim()} ` : ''; let done = ''; r.lang = 'fr-FR'; r.continuous = true; r.interimResults = true; mic._r = r; mic.setAttribute('aria-pressed', 'true'); r.onresult = (ev) => { let live = ''; for (let k = ev.resultIndex; k < ev.results.length; k++) { if (ev.results[k].isFinal) done += ev.results[k][0].transcript; else live += ev.results[k][0].transcript; } input.value = `${base}${done}${live}`.replace(/\s+/g, ' ').trimStart(); }; r.onend = () => { mic._r = null; mic.setAttribute('aria-pressed', 'false'); input.focus(); }; try { r.start(); } catch { mic._r = null; } };
    const form = el('form', { on: { submit: async (e) => { e.preventDefault(); const q = input.value.trim(); if (!q) return; input.value = ''; out.hidden = false; out.textContent = 'Odin réfléchit…'; waiting = true; const where = [document.title, location.hash.slice(1)].filter(Boolean).join(' · '); const ok = await window.OdinChat?.send?.(n ? `${q}\n\n[à propos de : ${n.app} · ${n.title}]` : q, where); if (!ok) { waiting = false; out.textContent = 'Je n\'ai pas pu envoyer : réessaie.'; } } } }, input, mic, el('button', { type: 'submit', class: 'ot-go', 'aria-label': 'Envoyer' }, svg('M5 12h14M13 6l6 6-6 6', 15)));
    talk.replaceChildren(...[
      el('div', { class: 'ot-h' }, el('span', { class: 'ot-dot', style: `background:${dot}`, 'aria-hidden': 'true' }), el('b', {}, n ? n.title : 'Que veux-tu ?'), el('button', { type: 'button', class: 'ot-x', 'aria-label': 'Fermer', on: { click: () => closeTalk() } }, '×')),
      out,
      n ? null : protBox(),
      n ? el('div', { class: 'ot-acts' }, ...n.actions.slice(0, 2).map((a, i) => el('button', { type: 'button', class: i === 0 ? 'p' : '', style: i === 0 ? `background:${dot}` : undefined, on: { click: () => runAction(a, out) } }, a.label)), el('button', { type: 'button', on: { click: () => { closeTalk(); open(n); } } }, 'Que faire ?')) : null,
      form, ttail].filter(Boolean));
    talk.hidden = false; follow(); setTimeout(() => input.focus({ preventScroll: true }), 30);
    window.OdinCompanion?.pin?.(60_000);
  }
  /** Un toucher sur Odin : qui te protège (Antivirus = Asclépios, Malware = Némésis) et leurs dernières alertes. */
  function protBox() {
    const list = el('div', {}), items = history.filter((x) => protOf(x));
    const st = { ullr: el('span', {}, PROT.ullr.what), skogul: el('span', {}, PROT.skogul.what) };
    const row = (id, app) => { const p = PROT[id]; return el('div', { class: 'ot-pr', style: `background:${p.color}1f;border-color:${p.color}55` }, el('i', { style: `background:${p.color}` }, svg(p.icon, 16)), el('div', { style: 'min-width:0' }, el('b', {}, `${p.label} `, el('span', { style: 'display:inline;font-size:13.5px;color:#9aa1b2' }, `= ${app}`)), st[id])); };
    const draw = (f) => list.replaceChildren(...items.filter((x) => f === 'tout' || protOf(x) === PROT[f]).slice(0, 4).map((x) => el('div', { class: 'ot-it', role: 'button', tabindex: '0', on: { click: () => { closeTalk(); open(x); } } }, protPill(protOf(x), 11), el('b', {}, x.title), el('time', {}, new Date(x.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })))), items.length ? null : el('p', { class: 'ot-d', style: 'margin:2px 4px' }, 'Aucune alerte de protection récente.'));
    const seg = el('div', { class: 'ot-seg', role: 'group', 'aria-label': 'Filtrer les alertes' }, ...[['tout', 'Tout'], ['ullr', 'Antivirus'], ['skogul', 'Malware']].map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(k === 'tout'), on: { click: (e) => { seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); draw(k); } } }, t)));
    draw('tout');
    // L'état du moment (sans attendre : la petite fenêtre s'ouvre tout de suite).
    api('/api/valhalla/act', { module: 'ullr', action: 'etat', input: {} }).then((r) => { if (r?.ok) st.ullr.textContent = String(r.text).split('\n')[0].replace(/^[^\p{L}\d]+/u, '').slice(0, 90); }).catch(() => {});
    return el('div', { class: 'ot-prot' }, el('small', {}, 'Qui te protège'), row('ullr', 'Asclépios'), row('skogul', 'Némésis'), seg, list);
  }
  function closeTalk(quiet) { if (!talk || talk.hidden) return; talk.hidden = true; waiting = false; if (!quiet) window.OdinCompanion?.pin?.(0); if (later) { const [n, o] = later; later = null; setTimeout(() => show(n, o), 300); } }
  /** La réponse d'Odin arrive : elle s'affiche dans la petite fenêtre (et Odin la dit si la voix est activée). */
  function reply(text) {
    if (!talk || talk.hidden || !waiting) return false; waiting = false;
    const out = talk.querySelector('.ot-d'); out.hidden = false; out.textContent = String(text).replace(/\[humeur:[^\]]*\]/g, '').trim().slice(0, 1200); follow(); return true;
  }
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
  window.OdinNotices = { boot, push: (n) => show(n), open, hide, talk: () => talkTo(null), closeTalk: () => closeTalk(true), reply, local: (n) => show({ id: `l${Date.now()}`, at: new Date().toISOString(), steps: [], actions: [], app: 'Odin', kind: n.kind ?? 'Un souci', level: 'souci', ...n }), list: () => history.slice() };
  addEventListener('resize', follow);
  const start = () => setTimeout(boot, 1200);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
