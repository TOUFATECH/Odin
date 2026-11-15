// Les notifications d'Odin (maquette validée « Notifications : pastille sur Odin et pop-up au clic ») : plus de texte
// par-dessus l'écran. Une pastille posée sur Odin, partout (toutes les pages, Discussion et téléphone compris) : un point
// par notification non lue (la plus récente d'abord, 6 points au maximum), de la couleur de son urgence (grave rouge, souci jaune, information verte), et le nombre.
// Grave : la pastille clignote en rouge et la mascotte passe au rouge (et le dit si la voix est activée).
// Toucher Odin (ou la pastille) : la petite fenêtre s'ouvre avec la liste ; toucher une notification l'ouvre
// (détail, boutons) et la marque lue. « Tout lu » vide la pastille. Les conseils complets restent dans le panneau.
// 15/11 : la pastille est petite et discrète (points + nombre, sans fond ni bulle) ; au survol, l'infobulle d'Odin
// donne le nombre et un résumé court. « Que veux-tu ? » dit aussi ce qu'on peut faire sur la page affichée, et
// « Explique-moi pas à pas » (ou taper « aide ») ouvre le mode d'emploi de la page (guide.js).
(() => {
  'use strict';
  if (window.OdinNotices) return;
  const COLORS = { ok: '#1E7A4C', souci: '#A85A06', grave: '#B8321F' };
  // La petite bulle prend la couleur du message : humeur, moment, information, souci ou urgence.
  const TONE = { ok: ['#13301f', '#bff0d1', '#34c77b'], info: ['#16234a', '#c9d6ff', '#5a6fdb'], moment: ['#3b2a0b', '#ffe3a6', '#ffc53d'], fierte: ['#2a1747', '#e0d2ff', '#9166e6'], souci: ['#3a2306', '#ffd9a3', '#f0a020'], grave: ['#4a1210', '#ffd0ca', '#ef4f43'] };
  const toneOf = (n) => (n.level === 'grave' ? 'grave' : n.level === 'souci' ? 'souci' : /moment|bonjour|bonsoir|bonne nuit/i.test(`${n.kind}`) ? 'moment' : /décision/i.test(`${n.kind}`) ? 'fierte' : /info|réponse|odin/i.test(`${n.kind}`) && !/souci/i.test(`${n.kind}`) ? 'info' : 'ok');
  const LUES = 'odin-notifs-lues'; // les notifications déjà lues (identifiants), gardées sur cet appareil
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
  /* La pastille (15/11) : petite et discrète, seulement des points de couleur et le nombre (pas de fond, pas de bulle). */
  #odinBubble{position:fixed;z-index:60;left:0;top:0;box-sizing:border-box;display:inline-flex;align-items:center;gap:2px;height:16px;padding:0 3px;border-radius:8px;background:transparent;color:var(--ink,#eef0f6);font:700 12px/1 var(--body,system-ui,sans-serif);white-space:nowrap;max-width:max-content;overflow:visible;cursor:pointer}
  #odinBubble .ob-pts{display:inline-flex;align-items:center;gap:2px}#odinBubble .ob-pts i{display:block;width:7px;height:7px;border-radius:50%;box-shadow:0 0 0 1.5px var(--bg,#101A24)}
  #odinBubble .ob-n{margin-left:2px;text-shadow:0 0 2px var(--bg,#101A24),0 0 2px var(--bg,#101A24),0 0 3px var(--bg,#101A24)}
  #odinBubble:focus-visible{outline:2px solid var(--accent,#7AA2FF);outline-offset:2px}
  /* Au doigt : une zone de toucher plus grande, vers le haut et les côtés seulement (jamais sur Odin). */
  @media (pointer:coarse){#odinBubble::after{content:'';position:absolute;inset:-12px -9px 0}}
  #odinTalk .ot-tl{height:28px;padding:0 9px;border:0;border-radius:9px;background:rgba(255,255,255,.06);color:#c9ceda;font:500 12.5px inherit;cursor:pointer;flex:none}
  #odinTalk .ot-list{display:flex;flex-direction:column;gap:1px}
  #odinTalk .ot-it small{display:block;color:#9aa1b2;font-size:11px;font-weight:400}
  #odinTalk .ot-it[data-lu] b{font-weight:400;color:#b9c0cf}
  #odinTalk .ot-it[aria-expanded=true]{background:rgba(255,255,255,.06)}
  #odinTalk .ot-it i{width:10px;height:10px;border-radius:50%;flex:none}
  #odinTalk .ot-det{margin:-2px 4px 6px 22px;font-size:12.5px;color:#b9c0cf;white-space:pre-line}
  #odinTalk .ot-det .ot-acts{margin-top:6px;padding:0}
  #odinBubble[hidden]{display:none}
  .ob-prot{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 9px 0 7px;border-radius:12px;color:#fff;font:700 12px/1 inherit;flex:none;white-space:nowrap}
  .odin-prot{position:absolute;right:-2px;bottom:-2px;width:20px;height:20px;border-radius:50%;background:#fff;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none}
  #odinTalk .ot-prot{display:flex;flex-direction:column;gap:6px}#odinTalk .ot-prot small{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9aa1b2;padding:0 4px}
  #odinTalk .ot-pr{display:flex;align-items:center;gap:10px;border-radius:12px;padding:8px 10px;border:1px solid}#odinTalk .ot-pr i{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#fff;flex:none}
  #odinTalk .ot-pr b{font-size:13.5px}#odinTalk .ot-pr span{display:block;font-size:12px;color:#b9c0cf}
  #odinTalk .ot-seg{display:flex;gap:2px;background:rgba(0,0,0,.25);border-radius:10px;padding:3px}#odinTalk .ot-seg button{flex:1;height:28px;border:0;border-radius:8px;background:none;color:#b9c0cf;font:600 12px inherit;cursor:pointer}#odinTalk .ot-seg button[aria-pressed=true]{background:rgba(255,255,255,.12);color:#fff}
  #odinTalk .ot-it{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:6px 4px;border-radius:9px;cursor:pointer}#odinTalk .ot-it:hover{background:rgba(255,255,255,.05)}#odinTalk .ot-it b{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}#odinTalk .ot-it time{color:#9aa1b2;font-size:11.5px}
  @keyframes obPop{0%{opacity:0;transform:scale(.3)}100%{opacity:1;transform:none}}
  #odinBubble.pop{animation:obPop .45s cubic-bezier(.3,1.6,.5,1)}
  @keyframes obBlink{0%,100%{box-shadow:0 0 0 1.5px var(--bg,#101A24),0 0 0 0 rgba(239,79,67,.7)}50%{box-shadow:0 0 0 1.5px var(--bg,#101A24),0 0 0 5px rgba(239,79,67,0)}}
  #odinBubble.grave .ob-pts i{animation:obBlink 1.6s .45s infinite}
  #odinTalk{position:fixed;z-index:61;left:0;top:0;width:min(300px,calc(100vw - 24px));box-sizing:border-box;border-radius:18px;background:rgba(30,34,48,.97);color:#eef0f6;border:1px solid rgba(255,255,255,.1);box-shadow:0 10px 24px rgba(0,0,0,.4);padding:8px;display:flex;flex-direction:column;gap:8px;font:14px/1.45 inherit}
  #odinTalk[hidden]{display:none}
  #odinTalk .ot-help{margin:0 2px;padding:8px 10px;border-radius:12px;background:rgba(90,111,219,.16);font-size:13px;color:#d6dbea}#odinTalk .ot-help p{margin:0 0 6px;white-space:pre-line}#odinTalk .ot-help .ot-acts{padding:0}#odinTalk .ot-help .ot-acts button.p{background:#5a6fdb;color:#fff}
  #odinTalk .ot-h{display:flex;align-items:flex-start;gap:8px;padding:2px 4px 0}
  #odinTalk .ot-h b{font-weight:600;flex:1;min-width:0}
  #odinTalk .ot-dot{width:14px;height:14px;border-radius:50%;flex:none;margin-top:3px}
  #odinTalk .ot-x{width:28px;height:28px;border:0;border-radius:9px;background:transparent;color:#c9ceda;cursor:pointer;flex:none}
  #odinTalk .ot-d{margin:0 4px;font-size:13px;color:#b9c0cf;white-space:pre-line;max-height:30vh;overflow:auto}
  /* La réponse d'Odin dans sa bulle (15/11) : mise en forme comme dans la Discussion (pages/rendu.js), taille bornée,
     elle défile à l'intérieur ; la bulle s'élargit un peu pour une réponse, sans jamais dépasser l'écran. */
  #odinTalk.ot-rep{width:min(400px,calc(100vw - 24px))}
  #odinTalk .ot-d.ot-md{white-space:normal;max-height:min(52vh,440px);overscroll-behavior:contain;padding-right:4px;color:#d6dbea;font-size:13.5px;line-height:1.5}
  #odinTalk .md,#odinAdvice .md{--text:#eef0f6;--muted:#b9c0cf;--dim:#9aa1b2;--line:rgba(255,255,255,.14);--panel:rgba(255,255,255,.06);gap:6px}
  #odinTalk .ot-det .md{margin-bottom:4px}
  #odinTalk .ot-open{align-self:flex-start;margin:0 4px;border:0;background:none;color:#9fb4ff;font-family:inherit;font-weight:500;font-size:12px;cursor:pointer;padding:2px 0;text-decoration:underline;text-underline-offset:2px}
  /* Arrivée et départ en douceur (rien de tout ça si l'appareil demande moins d'animations). */
  @keyframes otIn{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
  @keyframes otOut{to{opacity:0;transform:translateY(6px) scale(.97)}}
  #odinTalk.ot-in{animation:otIn .18s cubic-bezier(.2,.8,.3,1)}
  #odinTalk.ot-ghost{animation:otOut .16s ease-in forwards;pointer-events:none}
  @media (prefers-reduced-motion:reduce){#odinTalk.ot-in,#odinTalk.ot-ghost{animation:none}}
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
  @media (prefers-reduced-motion:reduce){#odinBubble.pop,#odinBubble.grave .ob-pts i,.odin.alarm svg{animation:none}}`;
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'on') for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : String(v)); } for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k); return e; };
  const api = async (url, body) => { const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } }); return r.json(); };
  // La même mise en forme que la Discussion (pages/rendu.js) : titres, listes, gras, tableaux, images, logos des applis.
  // Le texte n'est jamais mis en HTML ; sans le moteur (pas encore chargé), le texte brut.
  const rich = (t) => (window.OdinRendu ? window.OdinRendu.md(String(t ?? ''), { compact: true }) : String(t ?? ''));
  const line = (t) => (window.OdinRendu ? window.OdinRendu.inline(String(t ?? '')) : String(t ?? ''));
  const moinsAnimer = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'à l\'instant' : s < 3600 ? `il y a ${Math.round(s / 60)} min` : new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };

  let bubble, panel, talk, ttail, current = null, hideT = 0, raf = 0, waiting = false, later = null;
  const history = [];
  /** Les notifications déjà lues (sur cet appareil). */
  let lues = new Set();
  try { lues = new Set(JSON.parse(localStorage.getItem(LUES) || '[]')); } catch { /* navigation privée */ }
  const saveLues = () => { try { localStorage.setItem(LUES, JSON.stringify([...lues].slice(-200))); } catch { /* */ } };
  const unread = () => history.filter((x) => !lues.has(x.id));
  /** Marque une notification lue (ou toutes) et met la pastille à jour. */
  function lire(n) {
    for (const x of n ? [n] : history) lues.add(x.id);
    saveLues(); badge();
    if (!unread().some((x) => x.level === 'grave') && panel?.hidden !== false) setAlarm(false);
  }

  // ---------- Où est Odin ? La mascotte en liberté, sinon celle de la Discussion ----------
  function anchor() {
    const cands = [document.getElementById('buddyRoam'), ...document.querySelectorAll('.view.on .odin, .odin')];
    for (const c of cands) { if (!c || c.hidden) continue; const r = c.getBoundingClientRect(); if (r.width >= 24 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(c).visibility !== 'hidden') return { el: c, r }; }
    return null;
  }
  function mascots() { return [...document.querySelectorAll('.odin')]; }
  function placeBubble() {
    raf = 0; if (!bubble) return;
    const box = !talk.hidden ? talk : !bubble.hidden ? bubble : null, tl = ttail; if (!box) return;
    const m = 12, room = innerHeight - 2 * m;
    // La petite fenêtre « Que veux-tu ? » ne dépasse jamais de l'écran : plus haute que lui, elle défile à l'intérieur.
    if (box === talk) { const big = talk.scrollHeight > room + 1, mh = big ? `${room}px` : ''; if (talk.style.maxHeight !== mh) { talk.style.maxHeight = mh; talk.style.overflowY = big ? 'auto' : ''; } }
    const a = anchor(), w = box.offsetWidth, h = box.offsetHeight;
    if (box === bubble) {
      // La pastille se pose juste au-dessus d'Odin, côté droit, et le suit (sans jamais couvrir Odin : on le touche toujours).
      let bx = a ? a.r.right + 10 - w : innerWidth - w - m, by = a ? a.r.top - h - 2 : innerHeight - h - 90;
      if (a && by < m) by = a.r.bottom + 2;
      bx = Math.min(Math.max(m, bx), innerWidth - w - m); by = Math.min(Math.max(m, by), innerHeight - h - m);
      box.style.left = `${Math.round(bx)}px`; box.style.top = `${Math.round(by)}px`;
      raf = requestAnimationFrame(placeBubble); return;
    }
    let x, y, below = false, cx;
    if (a) {
      cx = a.r.left + a.r.width / 2;
      x = Math.min(Math.max(m, cx - w / 2), innerWidth - w - m);
      y = a.r.top - h - 12; if (y < m) { y = a.r.bottom + 12; below = true; }
      // Dans la Discussion, Odin parle déjà dans son nuage (conseils, visite) : la bulle se pose au-dessus du nuage, pas sur ses boutons.
      const tip = document.getElementById('buddyTip');
      if (tip && !tip.hidden && !below) { const t = tip.getBoundingClientRect(); if (t.width && x < t.right && x + w > t.left && y < t.bottom && y + h > t.top && t.top - h - 10 >= m) y = t.top - h - 10; }
    } else { x = innerWidth - w - m; y = innerHeight - h - 90; cx = x + w - 40; }
    // Ni au-dessus ni au-dessous d'Odin il n'y a la place : elle reste dans l'écran (sa pointe se cache, elle ne touche plus Odin).
    const cale = y + h > innerHeight - m || y < m;
    if (cale) y = Math.max(m, innerHeight - h - m);
    tl.style.display = cale ? 'none' : '';
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
    bubble = el('div', { id: 'odinBubble', hidden: true, role: 'status', 'aria-live': 'polite' });
    // Au survol : le nombre et un résumé court (les titres des plus récentes), dans l'infobulle d'Odin.
    bubble.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') window.OdinCompanion?.tip?.(summary(), bubble, 150); });
    bubble.addEventListener('pointerleave', () => window.OdinCompanion?.untip?.());
    document.body.append(bubble);
    ttail = el('span', { class: 'ot-tail', 'aria-hidden': 'true' });
    talk = el('section', { id: 'odinTalk', hidden: true, 'aria-label': 'Parler à Odin', on: { keydown: (e) => { if (e.key === 'Escape') closeTalk(); } } });
    document.body.append(talk);
    panel = el('section', { id: 'odinAdvice', hidden: true, 'aria-label': 'Conseils d\'Odin', on: { keydown: (e) => { if (e.key === 'Escape') closePanel(); } } });
    document.body.append(panel);
  }
  function setAlarm(on) { for (const o of mascots()) o.classList.toggle('alarm', on); }

  // ---------- La pastille sur Odin : un point par notification non lue (6 au maximum) et le nombre ----------
  // Couleur d'un point de la pastille (15/11, demandé par le propriétaire) : selon l'urgence seulement.
  // Grave = rouge, souci (moyen) = jaune, simple information = vert. Au plus 6 points ; au-delà, seulement le nombre total.
  const DOT = { grave: '#ef4f43', souci: '#f2c230', ok: '#34c77b' };
  /** Le résumé court de la pastille : le nombre, puis les titres des trois plus récentes. */
  function summary() {
    const L = unread(), n = L.length, grave = L.some((x) => x.level === 'grave');
    const lines = L.slice(0, 3).map((x) => `• ${String(x.title).slice(0, 60)}`);
    return `${n} notification${n > 1 ? 's' : ''} non lue${n > 1 ? 's' : ''}${grave ? ', dont une urgence' : ''}\n${lines.join('\n')}${n > 3 ? `\n… et ${n - 3} autre${n > 4 ? 's' : ''}` : ''}\nTouche pour les voir.`;
  }
  function badge(pop) {
    build();
    const L = unread(), n = L.length, grave = L.some((x) => x.level === 'grave');
    if (!n || !talk.hidden) { bubble.hidden = true; if (!n) protTint(undefined); return; }
    const first = TONE[toneOf(grave ? L.find((x) => x.level === 'grave') : L[0])][2];
    bubble.style.setProperty('--pc', first);
    bubble.classList.toggle('grave', grave);
    bubble.setAttribute('role', 'button'); bubble.tabIndex = 0;
    bubble.setAttribute('aria-label', summary());
    bubble.replaceChildren(el('span', { class: 'ob-pts', 'aria-hidden': 'true' }, ...L.slice(0, 6).map((x) => el('i', { style: `background:${DOT[x.level] || DOT.ok}` }))), el('span', { class: 'ob-n' }, String(n)));
    bubble.onclick = () => talkTo(null);
    bubble.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); talkTo(null); } };
    const was = !bubble.hidden; bubble.hidden = false;
    if (pop || !was) { bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop'); }
    follow();
  }
  function show(n, o = {}) {
    build();
    current = n; clearTimeout(hideT); later = null;
    if (!history.some((x) => x.id === n.id)) { history.unshift(n); history.splice(30); }
    lues.delete(n.id);
    // La petite fenêtre est ouverte : la notification arrive dans la liste, sous tes yeux.
    if (!talk.hidden && !waiting) { if (talk._list) talkTo(null); }
    badge(true);
    protTint(n.level !== 'ok' || protOf(n) ? protOf(n) : undefined);
    setAlarm(unread().some((x) => x.level === 'grave'));
    const bud = document.getElementById('buddyRoam');
    if (bud && window.OdinFace) {
      window.OdinFace.flash(bud, n.level === 'grave' ? 'peur' : n.level === 'souci' ? 'inquiet' : n.kind === 'Décision d\'Odin' ? 'fierte' : 'joie', 2600);
      // Son de la notification : un petit saut ; l'urgence tremble.
      if (!o.quiet) window.OdinFace.sound?.(n.level === 'grave' ? 'tremble' : 'hop');
    }
    window.OdinCompanion?.act?.(n.level === 'ok' ? 'act-joy' : 'act-tilt', 1400);
    // Odin parle : l'urgence est dite à voix haute (si les sons sont activés), le reste seulement si la voix est activée.
    if (n.level === 'grave' && !o.quiet && window.OdinFace?.soundOn !== false) window.OdinSay?.(`Urgence. ${n.title}`);
    else if (!o.quiet && window.OdinVoice?.on?.()) window.OdinSay?.(n.title);
    window.OdinCompanion?.sync?.('hopto');
  }
  function hide() { if (!bubble) return; if (current) lire(current); }

  // ---------- La petite fenêtre : lire, agir, et parler à Odin depuis n'importe quel onglet ----------
  function svg(d, z = 16) { const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', z); s.setAttribute('height', z); s.setAttribute('aria-hidden', 'true'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); s.append(p); return s; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  /** La liste des notifications (les non lues en gras) ; toucher une ligne l'ouvre et la marque lue. */
  function notifList() {
    const items = history.slice(0, 12); if (!items.length) return null;
    const box = el('div', { class: 'ot-list' });
    for (const x of items) {
      const [, , dot] = TONE[toneOf(x)], det = el('div', { class: 'ot-det', hidden: true }, x.detail ? rich(x.detail) : null,
        el('div', { class: 'ot-acts' }, ...x.actions.slice(0, 2).map((a, i) => el('button', { type: 'button', class: i === 0 ? 'p' : '', style: i === 0 ? `background:${dot}` : undefined, on: { click: () => runAction(a, det.querySelector('.ot-out') || det.appendChild(el('div', { class: 'ot-out' }))) } }, a.label)),
          el('button', { type: 'button', on: { click: () => { closeTalk(); open(x); } } }, 'Conseils')));
      const row = el('div', { class: 'ot-it', role: 'button', tabindex: '0', 'aria-expanded': 'false', 'data-lu': lues.has(x.id) ? '' : undefined,
        on: { click: () => { const o = row.getAttribute('aria-expanded') !== 'true'; for (const r of box.querySelectorAll('.ot-it')) { r.setAttribute('aria-expanded', 'false'); r.nextSibling.hidden = true; } row.setAttribute('aria-expanded', String(o)); det.hidden = !o; if (o) { row.setAttribute('data-lu', ''); lire(x); head(); } follow(); },
          keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } } } },
        protOf(x) ? protPill(protOf(x), 11) : el('i', { style: `background:${dot}`, 'aria-hidden': 'true' }), el('b', {}, line(x.title), el('small', {}, x.app)), el('time', {}, ago(x.at)));
      box.append(row, det);
    }
    return box;
  }
  let head = () => {};
  // « aide », « que veux-tu ? », « je suis perdu »… : Odin explique la page affichée (guide.js) au lieu d'envoyer la question.
  const AIDE = /^(aide|help|\?+|que veux[- ]tu|explique[- ]moi( (cette|la) page)?|comment (ça|ca) (marche|fonctionne)|que (puis|peux)[- ]je faire( ici)?|qu'?est[- ]ce que je peux faire( ici)?|je suis perdue?)\s*[?!.]*$/i;
  /** Ce qu'on peut faire sur la page affichée, en deux phrases (guide.js), et le bouton pour tout voir pas à pas. */
  function helpBox() {
    const G = window.OdinGuide; if (!G?.parole) return null;
    // Ce qu'Odin dit vient de son moteur (parole.ts) : l'étape suivante de la page ou une nouvelle utile, jamais deux fois ; rien de neuf : il se tait.
    const txt = el('p', {}, 'Je regarde la page…'), acts = el('div', { class: 'ot-acts' }), box = el('div', { class: 'ot-help' }, txt, acts);
    G.parole('toucher').then((r) => {
      if (!r || (!r.texte && !r.propositions?.length)) { box.remove(); follow(); return; }
      txt.textContent = r.texte || ''; txt.hidden = !r.texte;
      acts.replaceChildren(...(r.propositions || []).map((p, i) => el('button', { type: 'button', class: i === 0 ? 'p' : '', on: { click: () => { closeTalk(true); G.lancer(p); } } }, p.label)));
      follow();
    }).catch(() => { box.remove(); follow(); });
    return box;
  }
  function talkTo(n) {
    build(); clearTimeout(hideT); bubble.hidden = true; window.OdinCompanion?.untip?.();
    const [, , dot] = n ? TONE[toneOf(n)] : TONE.info, out = el('div', { class: `ot-d${n?.detail ? ' ot-md' : ''}`, role: 'status', 'aria-live': 'polite', hidden: !n?.detail }, n?.detail ? rich(n.detail) : '');
    talk.classList.remove('ot-rep');
    const input = el('input', { type: 'text', placeholder: n ? 'Réponds à Odin…' : 'Dis-moi… (« allume le salon »)', 'aria-label': 'Parle à Odin', enterkeyhint: 'send' });
    const mic = el('button', { type: 'button', class: 'ot-mic', 'aria-label': 'Parler au micro', 'aria-pressed': 'false' }, svg('M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3', 15));
    mic.onclick = () => { if (!SR) { out.hidden = false; out.textContent = 'Ce navigateur ne sait pas écrire ce que tu dis (Chrome, Edge ou Safari).'; return; } if (mic._r) { mic._r.stop(); return; } const r = new SR(), base = input.value.trim() ? `${input.value.trim()} ` : ''; let done = ''; r.lang = 'fr-FR'; r.continuous = true; r.interimResults = true; mic._r = r; mic.setAttribute('aria-pressed', 'true'); r.onresult = (ev) => { let live = ''; for (let k = ev.resultIndex; k < ev.results.length; k++) { if (ev.results[k].isFinal) done += ev.results[k][0].transcript; else live += ev.results[k][0].transcript; } input.value = `${base}${done}${live}`.replace(/\s+/g, ' ').trimStart(); }; r.onend = () => { mic._r = null; mic.setAttribute('aria-pressed', 'false'); input.focus(); }; try { r.start(); } catch { mic._r = null; } };
    const form = el('form', { on: { submit: async (e) => { e.preventDefault(); const q = input.value.trim(); if (!q) return; if (!n && AIDE.test(q) && window.OdinGuide?.open) { closeTalk(true); window.OdinGuide.open(); return; } input.value = ''; out.hidden = false; out.textContent = 'Odin réfléchit…'; waiting = true; const where = [document.title, location.hash.slice(1)].filter(Boolean).join(' · '); const ok = await window.OdinChat?.send?.(n ? `${q}\n\n[à propos de : ${n.app} · ${n.title}]` : q, where); if (!ok) { waiting = false; out.textContent = 'Je n\'ai pas pu envoyer : réessaie.'; } } } }, input, mic, el('button', { type: 'submit', class: 'ot-go', 'aria-label': 'Envoyer' }, svg('M5 12h14M13 6l6 6-6 6', 15)));
    const list = n ? null : notifList(), nb = unread().length, titre = el('b', {}, n ? n.title : nb ? `${nb} nouvelle${nb > 1 ? 's' : ''} notification${nb > 1 ? 's' : ''}` : 'Que veux-tu ?');
    const toutLu = !n && nb ? el('button', { type: 'button', class: 'ot-tl', on: { click: () => { lire(null); talkTo(null); } } }, 'Tout lu') : null;
    head = () => { const k = unread().length; titre.textContent = k ? `${k} nouvelle${k > 1 ? 's' : ''} notification${k > 1 ? 's' : ''}` : 'Que veux-tu ?'; if (!k) toutLu?.remove(); };
    talk._list = !n;
    talk.replaceChildren(...[
      el('div', { class: 'ot-h' }, el('span', { class: 'ot-dot', style: `background:${dot}`, 'aria-hidden': 'true' }), titre, toutLu, el('button', { type: 'button', class: 'ot-x', 'aria-label': 'Fermer', on: { click: () => closeTalk() } }, '×')),
      out,
      n ? null : helpBox(),
      list,
      n || nb ? null : protBox(),
      n ? el('div', { class: 'ot-acts' }, ...n.actions.slice(0, 2).map((a, i) => el('button', { type: 'button', class: i === 0 ? 'p' : '', style: i === 0 ? `background:${dot}` : undefined, on: { click: () => runAction(a, out) } }, a.label)), el('button', { type: 'button', on: { click: () => { closeTalk(); open(n); } } }, 'Que faire ?')) : null,
      form, ttail].filter(Boolean));
    const was = talk.hidden; talk.hidden = false;
    if (was) { talk.classList.remove('ot-in'); void talk.offsetWidth; talk.classList.add('ot-in'); }
    follow(); setTimeout(() => input.focus({ preventScroll: true }), 30);
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
  /** La bulle s'en va en douceur : une copie inerte s'efface à sa place (la vraie est déjà fermée). */
  function ghostOut() {
    if (moinsAnimer() || !talk.offsetWidth) return;
    const g = talk.cloneNode(true); g.classList.remove('ot-in'); g.classList.add('ot-ghost'); g.setAttribute('aria-hidden', 'true'); g.inert = true; g.removeAttribute('aria-label');
    document.body.append(g); setTimeout(() => g.remove(), 200);
  }
  function closeTalk(quiet) { if (!talk || talk.hidden) return; ghostOut(); talk.hidden = true; talk.classList.remove('ot-in', 'ot-rep'); talk._list = false; waiting = false; if (!quiet) window.OdinCompanion?.pin?.(0); later = null; badge(); }
  // Échap ou un toucher en dehors : la bulle se ferme (pas pendant une image en grand ni une fenêtre de confirmation).
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && talk && !talk.hidden && !document.getElementById('mdZoom') && !document.querySelector('dialog[open]')) closeTalk(); });
  document.addEventListener('pointerdown', (e) => {
    if (!talk || talk.hidden || waiting) return;
    if (e.target.closest?.('#odinTalk, #odinBubble, #odinAdvice, #buddyRoam, .odin, #mdZoom, dialog, [role=dialog], [role=alertdialog]')) return;
    closeTalk();
  }, true);
  /** La réponse d'Odin arrive : elle s'affiche dans la petite fenêtre, mise en forme (et Odin la dit si la voix est activée). */
  function reply(text) {
    if (!talk || talk.hidden || !waiting) return false; waiting = false;
    const out = talk.querySelector('.ot-d'), t = String(text).replace(/\[humeur:[^\]]*\]/g, '').trim();
    out.hidden = false; out.classList.add('ot-md'); talk.classList.add('ot-rep'); talk.querySelector('.ot-open')?.remove();
    // La réponse prend la place : l'aide de la page, la liste et « Qui te protège » s'effacent (la bulle reste petite).
    talk.querySelectorAll('.ot-help, .ot-list, .ot-prot, .ot-tl').forEach((x) => x.remove());
    if (talk._list) { const b = talk.querySelector('.ot-h b'); if (b) b.textContent = 'Odin te répond'; }
    out.replaceChildren(rich(t.length > 8000 ? `${t.slice(0, 8000)}…` : t));
    // Une longue réponse se lit mieux en entier dans la Discussion.
    if (t.length > 600 && !location.hash.startsWith('#chat')) out.after(el('button', { type: 'button', class: 'ot-open', on: { click: () => { closeTalk(true); location.hash = '#chat'; } } }, 'Lire dans la Discussion'));
    out.scrollTop = 0; follow(); return true;
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
        if (a.action === 'annuler' && !(await window.OdinDialog.confirm(`${a.label} ?`))) { out.textContent = 'Rien n\'a été changé.'; return; }
        r = await api('/api/valhalla/manip', { id: a.input.id, keep: a.action === 'garder', confirm: true });
      }
      else {
        r = await api('/api/valhalla/act', { module: a.module, action: a.action, input: a.input });
        if (r.confirm) { if (!(await window.OdinDialog.confirm(r.confirm, { danger: true }))) { out.textContent = 'Annulé : rien n\'a été fait.'; return; } r = await api('/api/valhalla/act', { module: a.module, action: a.action, input: a.input, confirm: true }); }
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
      el('h3', {}, line(n.title)),
      n.detail ? el('div', { class: 'oa-d' }, rich(n.detail)) : null,
      n.steps.length ? el('div', { class: 'oa-s' }, 'Ce que je te conseille') : null,
      n.steps.length ? el('ol', {}, n.steps.map((s) => el('li', {}, line(s)))) : null,
      ai,
      el('div', { class: 'oa-acts' },
        n.actions.map((a) => el('button', { type: 'button', class: a.primary ? 'p' : '', style: a.primary ? `background:${color}` : undefined, on: { click: () => runAction(a, out) } }, a.label)),
        n.page ? el('button', { type: 'button', on: { click: () => goTo(n) } }, 'Aller sur la page') : null,
        el('button', { type: 'button', on: { click: listen } }, 'Écouter'),
        el('button', { type: 'button', on: { click: async (e) => { e.target.disabled = true; ai.hidden = false; ai.textContent = 'Odin réfléchit…'; try { const r = await api('/api/valhalla/notice_advice', { id: n.id }); if (r.ok) ai.replaceChildren(rich(r.text)); else ai.textContent = `✗ ${r.error}`; if (r.ok) window.OdinSay?.(r.text, false); } catch (x) { ai.textContent = `✗ ${x.message}`; } e.target.disabled = false; } } }, 'Demander conseil à Odin')),
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
      const r = await api('/api/valhalla/notices?n=20'); if (!r.ok) return; booted = true;
      history.push(...r.notices);
      // Ce qui a plus d'un jour compte comme lu ; le reste allume la pastille, sans son.
      for (const x of history) if (Date.now() - Date.parse(x.at) > 24 * 3600_000) lues.add(x.id);
      saveLues(); badge(true); setAlarm(unread().some((x) => x.level === 'grave'));
    } catch { /* pas connecté : rien */ }
  }
  window.OdinNotices = { boot, push: (n) => show(n), open, hide, talk: () => talkTo(null), closeTalk: () => closeTalk(true), reply, local: (n) => show({ id: `l${Date.now()}`, at: new Date().toISOString(), steps: [], actions: [], app: 'Odin', kind: n.kind ?? 'Un souci', level: 'souci', ...n }), list: () => history.slice(), unread: () => unread().length };
  addEventListener('resize', follow);
  const start = () => setTimeout(boot, 1200);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
