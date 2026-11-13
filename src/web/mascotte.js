// Odin, la mascotte (maquettes validées) : les clics rapides (1 à 20, chaque nombre réglable ; 10 = il se cache
// sur tous tes écrans, 20 = il propose de redémarrer), ses habits de fête (bonnet de Noël, œuf de Pâques et son
// lapin, lune du Ramadan…), sa phrase du jour, ses pouvoirs, et les réglages (Réglages → Apparence) : Odin,
// Pouvoirs, Événements de l'année. Tout est gardé par Odin : les mêmes réglages sur tous tes écrans.
(() => {
  'use strict';
  if (window.OdinMascotte) return;
  const api = async (action, input = {}) => { const r = await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'apparence', action, input }) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
  const save = async (patch) => { await api('regler_mascotte', { reglages: JSON.stringify(patch) }); await window.OdinThemes?.sync?.(); };
  const NS = 'http://www.w3.org/2000/svg';
  { const st = document.createElement('style'); st.textContent = 'html.odin-hidden .odin.roam,html.odin-hidden .pet,html.odin-hidden #odinEgg,html.odin-hidden #odinTaps{display:none!important}.odin.ev-dark-eyes .eye{fill:#2a2f3a}.odin .odin-acc{pointer-events:none}'; document.head.append(st); }
  let D = null; // le dernier état d'Odin (thème, événement, clics, pouvoirs, événements)
  try { D = JSON.parse(localStorage.getItem('odin.mascotte') || 'null'); } catch { /* */ }
  const bud = () => document.getElementById('buddyRoam') || document.querySelector('.pet');
  const say = (title, level = 'ok') => (window.OdinMascotte?.sayHook ? window.OdinMascotte.sayHook(title, level) : window.OdinNotices?.local?.({ title, level, kind: 'Odin', app: 'Odin' }));

  // ---------------------------------------------------------------- habits de fête
  const ACC = {
    bonnet: '<path d="M28 30 Q38 2 68 2 Q92 4 102 22 L94 27 Q86 13 72 13 Q52 13 42 32Z" fill="#d62828"/><rect x="24" y="24" width="68" height="11" rx="5.5" fill="#fff" transform="rotate(-6 58 30)"/><circle cx="102" cy="23" r="7" fill="#fff"/>',
    cotillons: '<path d="M50 20 L62 -8 L74 20Z" fill="#ffd36a"/><path d="M54 12 L70 12 M57 4 L67 4" stroke="#ff4a4a" stroke-width="3"/><circle cx="62" cy="-9" r="4" fill="#ff6ad5"/>',
    gateau: '<path d="M50 20 L62 -8 L74 20Z" fill="#ff6ad5"/><path d="M54 12 L70 12 M57 4 L67 4" stroke="#fff" stroke-width="3"/><circle cx="62" cy="-9" r="4" fill="#ffd36a"/>',
    lune: '<path d="M92 4 a14 14 0 1 0 14 17 a11 11 0 1 1 -14 -17Z" fill="#ffd36a"/><path d="M108 8 l1.6 3.4 3.6 .5 -2.6 2.5 .6 3.6 -3.2 -1.7 -3.2 1.7 .6 -3.6 -2.6 -2.5 3.6 -.5Z" fill="#ffe9a0"/>',
    coeur: '<path d="M96 16 c-4 -6 -14 -4 -12 4 c1 5 12 11 12 11 s11 -6 12 -11 c2 -8 -8 -10 -12 -4z" fill="#ef4f43"/>',
    trefle: '<g fill="#34c77b"><circle cx="92" cy="14" r="6"/><circle cx="101" cy="14" r="6"/><circle cx="96.5" cy="6" r="6"/></g><path d="M96 18 l3 10" stroke="#1d7f3a" stroke-width="2"/>',
    citrouille: '<ellipse cx="60" cy="14" rx="18" ry="11" fill="#ff7a1a"/><path d="M60 3 v-6" stroke="#2f8f4e" stroke-width="3"/><path d="M50 13 l3 -3 3 3 M64 13 l3 -3 3 3" stroke="#1a0f24" stroke-width="1.6" fill="none"/>',
    masque: '<path d="M30 52 q30 -16 60 0 q-4 16 -20 14 q-10 -2 -10 -8 q0 6 -10 8 q-16 2 -20 -14Z" fill="#9a6bff" opacity=".85"/>',
    note: '<path d="M96 2 v18 a5 4 0 1 1 -3 -3.5 V6 l12 -3 v4Z" fill="#9aa8ff"/>',
    oeuf: '', // Pâques : Odin devient en chocolat (voir CHOC plus bas), pas d'objet sur la tête
  };
  function dress() {
    const ev = D?.event, acc = ev?.accessory && ACC[ev.accessory] !== undefined ? ACC[ev.accessory] : '';
    for (const o of document.querySelectorAll('.odin')) {
      const svg = o.querySelector('svg'); if (!svg) continue;
      let g = svg.querySelector(':scope > g.odin-acc');
      if (!acc) { g?.remove(); } else { if (!g) { g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'odin-acc'); svg.append(g); } if (g.dataset.k !== ev.accessory) { g.innerHTML = acc; g.dataset.k = ev.accessory; } }
      o.classList.toggle('ev-dark-eyes', Boolean(ev?.eyes));
      choc(svg, ev?.accessory === 'oeuf');
    }
    egg(ev?.accessory === 'oeuf');
  }
  // Pâques (maquette validée « Odin · Pâques v2 ») : Odin en chocolat brillant (nappage qui coule, éclat, vermicelles),
  // un vrai œuf en chocolat avec ruban et nœud qui le suit en sautillant, gigote, se fêle, et un lapin tout doux en sort.
  const PQ_DEFS = '<radialGradient id="pqEgg" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="#a9653e"/><stop offset=".5" stop-color="#6c381c"/><stop offset="1" stop-color="#341709"/></radialGradient>'
    + '<linearGradient id="pqNap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2c14"/><stop offset="1" stop-color="#3a1a0a"/></linearGradient>'
    + '<linearGradient id="pqRub" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5ab8f0"/><stop offset=".5" stop-color="#9fdcff"/><stop offset="1" stop-color="#4aa6e0"/></linearGradient>'
    + '<radialGradient id="pqFur" cx="42%" cy="32%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#f6f1f6"/><stop offset="1" stop-color="#e6dbe8"/></radialGradient>'
    + '<radialGradient id="pqEar" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#ffd3df"/><stop offset="1" stop-color="#ffb0c6"/></radialGradient>'
    + '<radialGradient id="pqShadow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#1d3a14" stop-opacity=".3"/><stop offset="1" stop-color="#1d3a14" stop-opacity="0"/></radialGradient>'
    + '<clipPath id="pqBody" clipPathUnits="userSpaceOnUse"><circle cx="60" cy="60" r="44"/></clipPath>'
    + '<clipPath id="pqLow" clipPathUnits="userSpaceOnUse"><path d="M-34 6 L-26 -2 L-18 6 L-10 -3 L-2 6 L6 -3 L14 6 L22 -2 L30 6 L34 4 L34 60 L-34 60Z"/></clipPath>'
    + '<clipPath id="pqHigh" clipPathUnits="userSpaceOnUse"><path d="M-34 6 L-26 -2 L-18 6 L-10 -3 L-2 6 L6 -3 L14 6 L22 -2 L30 6 L34 4 L34 -60 L-34 -60Z"/></clipPath>';
  function pqDefs() {
    if (document.getElementById('pqDefs')) return;
    const d = document.createElementNS(NS, 'svg'); d.id = 'pqDefs'; d.setAttribute('aria-hidden', 'true'); d.setAttribute('width', '0'); d.setAttribute('height', '0');
    d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'; d.innerHTML = `<defs>${PQ_DEFS}</defs>`; document.body.append(d);
  }
  const SPR = [[-24, -40, '#ff8fb0', 30], [-8, -46, '#ffe08a', -20], [10, -44, '#9fdcff', 50], [26, -36, '#b9f3c4', -40], [-32, -30, '#c8b6ff', 10], [18, -32, '#ff8fb0', 70], [0, -38, '#b9f3c4', 0]];
  // Le chocolat se pose dans le corps d'Odin, sous ses yeux (repère du corps : centre 60,60, rayon 44).
  const CHOC = '<g clip-path="url(#pqBody)"><path transform="translate(60 60) scale(.94) translate(0 -30)" d="M-48 -10 C-46 -40 -22 -46 0 -46 C22 -46 44 -38 45 -10 C40 -6 38 6 34 6 C30 6 30 -4 26 -4 C21 -4 22 12 16 12 C10 12 12 -2 6 -2 C1 -2 2 6 -3 6 C-8 6 -7 -6 -12 -6 C-17 -6 -16 16 -22 16 C-28 16 -26 -2 -31 -2 C-36 -2 -38 4 -42 2 C-46 0 -48 -4 -48 -10Z" fill="url(#pqNap)"/></g>'
    + '<g transform="translate(60 60) scale(.94)"><path d="M-36 -26 C-30 -40 -14 -44 -4 -43" stroke="#fff" stroke-opacity=".28" stroke-width="5" fill="none" stroke-linecap="round"/>'
    + SPR.map(([x, y, c, r]) => `<rect x="${x - 3.5}" y="${y - 1.3}" width="7" height="2.6" rx="1.3" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`).join('')
    + '<ellipse cx="-26" cy="18" rx="8" ry="14" fill="#fff" opacity=".10" transform="rotate(25 -26 18)"/><path d="M30 28 A40 40 0 0 1 4 44" stroke="#d99a6c" stroke-opacity=".35" stroke-width="3" fill="none" stroke-linecap="round"/></g>';
  function choc(svg, on) {
    const body = svg.querySelector('g.body'); if (!body) return;
    let g = body.querySelector(':scope > g.odin-choc');
    if (!on) { g?.remove(); svg.classList.remove('pq'); return; }
    pqDefs(); svg.classList.add('pq');
    if (!g) { g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'odin-choc'); g.innerHTML = CHOC; body.insertBefore(g, body.querySelector(':scope > g.eyes')); }
  }
  const EGG = 'M0 -40 C22 -40 34 -10 34 10 C34 30 19 42 0 42 C-19 42 -34 30 -34 10 C-34 -10 -22 -40 0 -40Z';
  const CUT = 'M-34 6 L-26 -2 L-18 6 L-10 -3 L-2 6 L6 -3 L14 6 L22 -2 L30 6 L34 4';
  const RIB = '<rect x="-34" y="6" width="68" height="9" fill="url(#pqRub)"/><path d="M-34 6 h68" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/>';
  const SHINE = '<ellipse cx="-14" cy="-18" rx="7" ry="14" fill="#fff" opacity=".22" transform="rotate(22 -14 -18)"/><circle cx="-6" cy="-30" r="2.5" fill="#fff" opacity=".35"/>';
  const BOW = '<g transform="translate(0 10)"><path d="M0 0 C-10 -10 -20 -4 -16 4 C-12 10 -4 4 0 0Z M0 0 C10 -10 20 -4 16 4 C12 10 4 4 0 0Z" fill="#7cc8f5" stroke="#3f97cf" stroke-width="1"/><path d="M-2 2 L-8 16 L-3 14 M2 2 L8 16 L3 14" stroke="#4aa6e0" stroke-width="3" fill="none" stroke-linecap="round"/><circle r="3.4" fill="#3f97cf"/></g>';
  const CRACK = '<path d="M-24 -6 L-17 -14 L-11 -7 L-4 -17 L3 -8 L10 -15 L17 -6" stroke="#f3d9c2" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M-4 -17 L-2 -24" stroke="#f3d9c2" stroke-width="1.2"/>';
  const BUNNY = '<path d="M-12 -46 C-26 -82 -20 -100 -10 -100 C0 -100 0 -76 -4 -46Z" fill="url(#pqFur)" stroke="#e2d6e4"/><path d="M-11 -52 C-20 -78 -16 -92 -10 -92 C-4 -92 -4 -72 -6 -52Z" fill="url(#pqEar)"/>'
    + '<path d="M4 -46 C4 -78 14 -96 23 -92 C32 -88 26 -70 12 -46Z" fill="url(#pqFur)" stroke="#e2d6e4"/><path d="M7 -50 C8 -74 15 -86 21 -84 C26 -82 21 -68 12 -50Z" fill="url(#pqEar)"/>'
    + '<ellipse cx="0" cy="-2" rx="22" ry="20" fill="url(#pqFur)"/><ellipse cx="0" cy="-28" rx="22" ry="20" fill="url(#pqFur)" stroke="#e2d6e4"/>'
    + '<ellipse cx="-8" cy="-31" rx="3.6" ry="4.4" fill="#2b2033"/><circle cx="-6.8" cy="-32.8" r="1.4" fill="#fff"/><ellipse cx="8" cy="-31" rx="3.6" ry="4.4" fill="#2b2033"/><circle cx="9.2" cy="-32.8" r="1.4" fill="#fff"/>'
    + '<ellipse cx="-13" cy="-22" rx="4.5" ry="2.8" fill="#ffb3c8" opacity=".7"/><ellipse cx="13" cy="-22" rx="4.5" ry="2.8" fill="#ffb3c8" opacity=".7"/>'
    + '<path d="M-3 -24 Q0 -21.5 3 -24 Q0 -20 -3 -24Z" fill="#ff7aa2"/><path d="M0 -21 q-2.6 3 -5 1.2 M0 -21 q2.6 3 5 1.2" stroke="#b9708c" stroke-width="1.1" fill="none" stroke-linecap="round"/>'
    + '<path d="M-9 -23 l-11 -2 M-9 -21 l-11 2 M9 -23 l11 -2 M9 -21 l11 2" stroke="#cdbfd1" stroke-width=".8" stroke-linecap="round"/>';
  const PAWS = '<ellipse cx="-14" cy="2" rx="6.5" ry="5" fill="url(#pqFur)" stroke="#e2d6e4"/><ellipse cx="14" cy="2" rx="6.5" ry="5" fill="url(#pqFur)" stroke="#e2d6e4"/>';
  let eggEl = null, eggT = 0, eggH = 0;
  function egg(on) {
    if (!on) { eggEl?.remove(); eggEl = null; clearInterval(eggT); clearInterval(eggH); return; }
    if (eggEl) return;
    pqDefs();
    eggEl = document.createElement('div'); eggEl.id = 'odinEgg'; eggEl.setAttribute('aria-hidden', 'true');
    eggEl.innerHTML = `<svg viewBox="-46 -100 92 146" width="40" height="64" style="overflow:visible"><ellipse cx="0" cy="44" rx="30" ry="5" fill="url(#pqShadow)"/>`
      + `<g class="whole" style="transform-box:fill-box;transform-origin:50% 100%"><path d="${EGG}" fill="url(#pqEgg)"/>${RIB}${SHINE}${BOW}<g class="crack" opacity="0">${CRACK}</g></g>`
      + `<g class="open" opacity="0"><g class="bunny" style="transform-box:fill-box;transform-origin:50% 100%"><g transform="translate(0 -6)">${BUNNY}</g></g>`
      + `<g clip-path="url(#pqLow)"><path d="${EGG}" fill="url(#pqEgg)"/>${RIB}</g><path d="${CUT}" stroke="#2a1206" stroke-width="1.5" fill="none"/>${PAWS}`
      + `<g class="lid"><g clip-path="url(#pqHigh)"><path d="${EGG}" fill="url(#pqEgg)"/>${SHINE}</g><path d="${CUT}" stroke="#2a1206" stroke-width="1.5" fill="none"/></g></g></svg>`;
    eggEl.style.cssText = 'position:fixed;left:0;top:0;z-index:49;pointer-events:none;transition:translate 1.2s cubic-bezier(.45,.05,.3,1);filter:drop-shadow(0 3px 5px rgba(0,0,0,.22))';
    document.body.append(eggEl);
    const svg = eggEl.querySelector('svg');
    const follow = () => { const b = bud(); if (!b || b.hidden || !eggEl) { if (eggEl) eggEl.style.opacity = '0'; return; } const r = b.getBoundingClientRect(); eggEl.style.opacity = '1'; eggEl.style.translate = `${Math.round(r.left - 30)}px ${Math.round(r.bottom - 58)}px`; };
    follow(); eggT = setInterval(follow, 600);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Il sautille derrière Odin.
    if (!still) svg.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-5px)' }, { transform: 'translateY(0)' }], { duration: 1100, iterations: Infinity, easing: 'ease-in-out' });
    const hatch = async () => {
      if (!eggEl || document.hidden) return;
      const $ = (c) => eggEl?.querySelector(c); const whole = $('.whole'), crack = $('.crack'), open = $('.open'), bunny = $('.bunny'), lid = $('.lid');
      if (!whole) return;
      if (!still) await whole.animate([0, -12, 12, -8, 6, 0].map((d) => ({ transform: `rotate(${d}deg)` })), { duration: 900, easing: 'ease-in-out' }).finished.catch(() => {});
      crack.setAttribute('opacity', '1');
      await new Promise((ok) => setTimeout(ok, 700));
      if (!eggEl) return;
      whole.setAttribute('opacity', '0'); open.setAttribute('opacity', '1');
      if (!still) {
        lid.animate([{ transform: 'translate(0,0) rotate(0)' }, { transform: 'translate(30px,-64px) rotate(38deg)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
        bunny.animate([{ transform: 'translateY(24px) scale(.7)' }, { transform: 'translateY(-8px) scale(1.06)', offset: .6 }, { transform: 'translateY(0) scale(1)' }], { duration: 650, easing: 'ease-out' });
      } else lid.setAttribute('transform', 'translate(30 -64) rotate(38)');
      await new Promise((ok) => setTimeout(ok, 4200));
      if (!eggEl) return;
      lid.getAnimations().forEach((a) => a.cancel()); lid.removeAttribute('transform');
      open.setAttribute('opacity', '0'); crack.setAttribute('opacity', '0'); whole.setAttribute('opacity', '1');
    };
    setTimeout(hatch, 4000); eggH = setInterval(hatch, 45_000);
  }

  // ---------------------------------------------------------------- caché ou visible (sur tous tes écrans)
  function hidden() { return Boolean(D?.cache); }
  function applyHidden() { document.documentElement.classList.toggle('odin-hidden', hidden()); window.OdinCompanion?.sync?.('hopto'); }
  function setHidden(v) { D = { ...(D || {}), cache: Boolean(v) }; applyHidden(); }

  // ---------------------------------------------------------------- les clics rapides (1 à 20)
  let taps = [], tapT = 0, badge = null;
  const NEXT_HIDE = () => { const c = D?.clics || {}; return Object.keys(c).map(Number).filter((n) => c[n] === 'cacher').sort((a, b) => a - b)[0]; };
  function showBadge(n) {
    const b = bud(); if (!b) return;
    if (!badge) { badge = document.createElement('span'); badge.id = 'odinTaps'; badge.setAttribute('aria-live', 'polite'); document.body.append(badge); }
    const r = b.getBoundingClientRect(); badge.textContent = String(n); badge.hidden = n < 2;
    badge.style.cssText = `position:fixed;z-index:62;left:${Math.round(r.right - 14)}px;top:${Math.round(r.top - 10)}px;min-width:26px;height:26px;padding:0 7px;border-radius:13px;background:#9166e6;color:#fff;font:800 14px/26px system-ui,sans-serif;text-align:center;box-shadow:0 6px 14px rgba(0,0,0,.35);pointer-events:none`;
  }
  const ACTIONS = {
    rien: () => {},
    rire: (b) => { window.OdinFace?.flash(b, 'rire', 2600); window.OdinCompanion?.act?.('act-joy', 1100); say('Hé, ça chatouille !'); },
    phrase: (b) => { window.OdinFace?.flash(b, 'malice', 2600); say('Depuis tout à l\'heure tu me cliques dessus… dis-moi ce que tu veux !'); },
    avertir: (b, n) => { window.OdinFace?.flash(b, 'inquiet', 2600); const h = NEXT_HIDE(); say(h && h > n ? `Encore ${h - n} et je me cache sur tous tes écrans.` : 'Attention, encore un peu et je me cache !', 'souci'); },
    cacher: async () => { D = { ...(D || {}), cache: true }; applyHidden(); try { await api('cacher'); } catch { /* */ } },
    muet: (b) => { window.OdinFace?.mute?.(true); window.OdinFace?.flash(b, 'gene', 2000); say('Je me tais. (Réglages → Voix pour me rendre la parole.)'); },
    theme: () => window.OdinThemes?.choose?.('au hasard'),
    pouvoir: (b) => { const r = b.getBoundingClientRect(), t = document.querySelector('.view.on .card, .view.on article, .view.on section'); if (t && window.OdinPowers) { const c = window.OdinPowers.cfg; window.OdinPowers.configure({ ...c }); void window.OdinPowers.demo(t); } else window.OdinPowers?.burst?.(r.left + r.width / 2, r.top); },
    redemarrer: () => restartAsk(),
  };
  function restartAsk() {
    const d = document.createElement('dialog'); d.className = 'odin-restart';
    d.innerHTML = '<form method="dialog" style="display:flex;flex-direction:column;gap:12px;max-width:380px"><b style="font-size:17px">Redémarrer Odin ?</b><span style="font-size:14px;line-height:1.5">Tu as beaucoup cliqué. Je peux redémarrer : je m\'arrête une vingtaine de secondes, puis je reviens. Rien n\'est perdu, la surveillance reprend toute seule.</span><div style="display:flex;gap:10px;justify-content:flex-end"><button value="non" class="btn">Annuler</button><button value="oui" class="btn primary">Redémarrer</button></div></form>';
    document.body.append(d); d.showModal();
    d.addEventListener('close', async () => {
      const yes = d.returnValue === 'oui'; d.remove(); if (!yes) return;
      try { const r = await fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ kind: 'app_restart' }) }).then((x) => x.json()); if (!r.ok) { say(r.error || 'Redémarrage impossible', 'souci'); return; } say('Je redémarre… à tout de suite.'); setTimeout(() => location.reload(), 8000); } catch (e) { say(e.message, 'souci'); }
    });
  }
  /** Un toucher sur Odin : 1 = lui parler ; plusieurs toucher rapides = l'action réglée pour ce nombre, quand tu t'arrêtes. */
  function tap(b, talk) {
    const now = Date.now(); taps = taps.length && now - taps[taps.length - 1] < 1200 ? [...taps, now] : [now];
    const n = taps.length; clearTimeout(tapT);
    if (n === 1) (talk || window.OdinNotices?.talk)?.();
    else { window.OdinFace?.flash(b, n >= 8 ? 'surprise' : 'joie', 900); window.OdinCompanion?.act?.('act-tilt', 500); }
    showBadge(n);
    tapT = setTimeout(() => {
      if (badge) badge.hidden = true; taps = [];
      const a = n >= 2 ? (D?.clics || {})[Math.min(n, 20)] : undefined;
      if (a && ACTIONS[a]) void ACTIONS[a](b, n);
    }, 1200);
  }

  // ---------------------------------------------------------------- l'état venu d'Odin
  let greeted = '';
  function onState(d) {
    D = d; try { localStorage.setItem('odin.mascotte', JSON.stringify(d)); } catch { /* */ }
    window.OdinPowers?.configure?.(d.pouvoirs || {});
    dress(); applyHidden();
    const key = `${d.day}:${d.event?.id || ''}`;
    try { greeted = localStorage.getItem('odin.fete') || ''; } catch { /* */ }
    if (d.event && greeted !== key && !hidden()) { setTimeout(() => say(d.event.says), 2500); try { localStorage.setItem('odin.fete', key); } catch { /* */ } }
    paint();
  }
  document.documentElement.addEventListener('odin-mascotte', (e) => onState(e.detail));

  // ---------------------------------------------------------------- Réglages → Apparence : Odin, Pouvoirs, Événements
  const LABELS = { rien: 'Rien', rire: 'Il rit', phrase: 'Une phrase', avertir: 'Il prévient', cacher: 'Se cacher partout', muet: 'Couper sa voix', theme: 'Thème au hasard', pouvoir: 'Un pouvoir', redemarrer: 'Proposer de redémarrer' };
  const GROUPS = { famille: 'Toi et ta famille', fetes: 'Fêtes', religieuses: 'Religieuses', ailleurs: 'Côté anglais et ailleurs' };
  const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'on') for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f); else if (k === 'style') e.style.cssText = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v !== undefined) e.setAttribute(k, v); } for (const c of kids.flat()) if (c !== undefined && c !== null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c))); return e; };
  const check = (label, on, change, hint) => h('label', { class: 'check' }, h('input', { type: 'checkbox', ...(on ? { checked: true } : {}), on: { change: (e) => change(e.target.checked) } }), ` ${label}`, hint ? h('span', { class: 'hint', style: 'display:block;margin-left:24px' }, hint) : '');
  const seg = (opts, sel, change, label) => h('div', { class: 'seg', role: 'group', 'aria-label': label }, opts.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(v === sel), on: { click: () => change(v) } }, t)));
  let events = null;
  async function loadEvents() { try { events = (await api('evenements')).data; } catch { events = null; } }
  function paint() {
    const card = document.querySelector('article.card[data-sec="apparence"]'); if (!card || !D) return;
    let box = card.querySelector('#odinMascotteBox');
    if (!box) { box = h('div', { id: 'odinMascotteBox', style: 'display:flex;flex-direction:column;gap:18px;margin-top:14px' }); card.append(box); const st = document.createElement('style'); st.textContent = '#odinMascotteBox h3{margin:0;font-size:15px}#odinMascotteBox .mrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#odinMascotteBox .pw{display:flex;flex-wrap:wrap;gap:6px}#odinMascotteBox .pw button{min-height:32px;border-radius:16px;border:1px solid var(--line);background:none;color:var(--ink);padding:0 10px;font-size:13px;cursor:pointer}#odinMascotteBox .pw button[aria-pressed=true]{background:var(--accent);color:var(--on-accent);border-color:transparent}#odinMascotteBox .evg{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px 16px}#odinMascotteBox .demo{height:56px;border-radius:12px;background:var(--panel2);border:1px solid var(--line);display:flex;align-items:center;padding:0 14px;font-size:13px;max-width:280px}'; document.head.append(st); }
    const p = D.pouvoirs || {}, q = p.quand || {}, ev = D.evenements || {}, clics = D.clics || {};
    const P = window.OdinPowers?.POWERS || {};
    const sp = (patch) => void save({ pouvoirs: patch });
    const se = (patch) => void save({ evenements: patch }).then(loadEvents).then(paint);
    const rows = Object.keys(clics).map(Number).sort((a, b) => a - b).map((n) => h('div', { class: 'mrow' }, h('span', { style: 'min-width:70px;font-weight:600' }, `${n} clics`),
      h('select', { 'aria-label': `Action pour ${n} clics`, on: { change: (e) => void save({ mascotte: { clics: { ...clics, [n]: e.target.value } } }) } }, Object.entries(LABELS).map(([k, t]) => h('option', { value: k, ...(clics[n] === k ? { selected: true } : {}) }, t)))));
    const addSel = h('select', { 'aria-label': 'Nombre de clics à ajouter' }, Array.from({ length: 19 }, (_, i) => i + 2).filter((n) => !clics[n]).map((n) => h('option', { value: n }, `${n} clics`)));
    const demoEl = h('div', { class: 'demo', 'data-power': 'non' }, 'Un onglet d\'essai');
    const groups = {};
    for (const e of events?.events || []) (groups[e.group] ??= []).push(e);
    box.replaceChildren(
      h('section', { 'aria-label': 'Odin' }, h('h3', {}, 'Odin'),
        check('Odin visible sur tous tes écrans', !D.cache, (on) => void save({ mascotte: { cache: !on } }), 'Dix clics rapides le cachent partout ; il revient ici.'),
        h('p', { class: 'hint', style: 'margin:8px 0 4px' }, 'Clics rapides sur Odin (1 = lui parler ; 2 à 4 : rien ; l\'action se fait quand tu t\'arrêtes) :'),
        ...rows, h('div', { class: 'mrow' }, addSel, h('button', { type: 'button', class: 'btn', on: { click: () => void save({ mascotte: { clics: { ...clics, [addSel.value]: 'rire' } } }) } }, 'Ajouter'))),
      h('section', { 'aria-label': 'Pouvoirs' }, h('h3', {}, 'Pouvoirs d\'Odin'),
        check('Pouvoirs activés', p.actif || p.coupeRamadan, (on) => sp({ actif: on }), p.coupeRamadan ? 'Coupés pendant le Ramadan (réglage des événements).' : 'Désactivés au départ. Coupés : plus aucun pouvoir, nulle part, et celui en cours s\'arrête aussitôt.'),
        h('div', { class: 'mrow', style: 'margin-top:6px' }, [['ouvre', 'Un onglet s\'ouvre'], ['ferme', 'Un onglet se ferme'], ['supprime', 'Supprimer'], ['fenetre', 'Une fenêtre s\'ouvre ou se ferme'], ['clic', 'Clic n\'importe où']].map(([k, t]) => check(t, q[k], (on) => sp({ quand: { [k]: on } })))),
        h('p', { class: 'hint', style: 'margin:8px 0 4px' }, 'Quel pouvoir :'),
        seg([['hasard', 'Au hasard'], ['favoris', 'Mes favoris'], ['theme', 'Selon le thème'], ['meteo', 'Selon la météo']], p.choix, (v) => sp({ choix: v }), 'Quel pouvoir'),
        h('div', { class: 'pw', role: 'group', 'aria-label': 'Pouvoirs favoris', style: 'margin-top:8px' }, Object.entries(P).map(([id, x]) => h('button', { type: 'button', 'aria-pressed': String((p.favoris || []).includes(id)), title: x.name, on: { click: () => { const f = new Set(p.favoris || []); if (f.has(id)) f.delete(id); else f.add(id); sp({ favoris: [...f] }); } } }, x.name))),
        h('p', { class: 'hint', style: 'margin:8px 0 4px' }, 'Force :'),
        seg([['discrete', 'Discrète'], ['normale', 'Normale'], ['spectaculaire', 'Spectaculaire']], p.force, (v) => sp({ force: v }), 'Force'),
        check('Son des pouvoirs', p.son, (on) => sp({ son: on })),
        h('div', { class: 'mrow', style: 'margin-top:8px' }, demoEl, h('select', { id: 'powerTry', 'aria-label': 'Pouvoir à essayer' }, Object.entries(P).map(([id, x]) => h('option', { value: id }, x.name))), h('button', { type: 'button', class: 'btn', 'data-power': 'non', on: { click: () => void window.OdinPowers?.demo(demoEl, box.querySelector('#powerTry').value) } }, 'Essayer')),
        h('p', { class: 'hint' }, 'Partout : l\'interface d\'Odin, l\'écran de la maison (Glaðsheimr) et Venus. Jamais sur le texte ni pendant une vidéo ; coupé si ton appareil demande moins d\'animations. Un pouvoir ne supprime rien.')),
      h('section', { 'aria-label': 'Événements de l\'année' }, h('h3', {}, 'Événements de l\'année'),
        check('Événements activés', ev.actif !== false, (on) => se({ actif: on }), 'Odin change de couleur ou d\'habit ces jours-là. Coupé : plus aucun événement.'),
        check('Le jour d\'un événement, tout Odin prend son thème', ev.themes !== false, (on) => se({ themes: on })),
        h('div', { class: 'evg', style: 'margin-top:6px' }, Object.entries(GROUPS).map(([g, t]) => h('div', {}, h('p', { class: 'hint', style: 'margin:6px 0 2px;font-weight:600' }, t), (groups[g] || []).map((e) => check(e.name, e.on, (on) => se({ choix: { ...(ev.choix || {}), [e.id]: on } })))))),
        check('Pendant le Ramadan, couper les autres événements', ev.ramadanSeul !== false, (on) => se({ ramadanSeul: on })),
        check('Pas de pouvoirs pendant le Ramadan', ev.ramadanSansPouvoirs, (on) => se({ ramadanSansPouvoirs: on })),
        h('div', { class: 'mrow' }, h('span', {}, 'Dates musulmanes :'), seg([[-1, '−1 jour'], [0, 'calendrier'], [1, '+1 jour']], ev.decalageHijri || 0, (v) => se({ decalageHijri: v }), 'Décalage des dates musulmanes')),
        h('div', { class: 'mrow' }, h('span', {}, 'Ton anniversaire :'), h('input', { type: 'date', 'aria-label': 'Ton anniversaire', value: ev.anniversaire ? `2000-${ev.anniversaire}` : '', on: { change: (e) => se({ anniversaire: e.target.value ? e.target.value.slice(5) : '' }) } })),
        h('div', { class: 'mrow' }, h('span', {}, 'Famille :'), (ev.famille || []).map((f, i) => h('span', { class: 'chip' }, `${f.nom} (${f.date.split('-').reverse().join('/')})`, h('button', { type: 'button', 'aria-label': `Retirer ${f.nom}`, 'data-power': 'oui', on: { click: () => se({ famille: (ev.famille || []).filter((_, j) => j !== i) }) } }, '×'))),
          h('input', { id: 'famNom', placeholder: 'Prénom', 'aria-label': 'Prénom', style: 'width:110px' }), h('input', { id: 'famDate', type: 'date', 'aria-label': 'Date d\'anniversaire' }),
          h('button', { type: 'button', class: 'btn', on: { click: () => { const n = box.querySelector('#famNom').value.trim(), d = box.querySelector('#famDate').value; if (n && d) se({ famille: [...(ev.famille || []), { nom: n, date: d.slice(5) }] }); } } }, 'Ajouter')),
        h('div', { class: 'mrow' }, h('span', {}, 'Mettre un jour en pause :'), h('input', { id: 'pauseDay', type: 'date', 'aria-label': 'Jour à mettre en pause' }), h('button', { type: 'button', class: 'btn', on: { click: () => { const d = box.querySelector('#pauseDay').value; if (d) se({ pauses: [...new Set([...(ev.pauses || []), d])] }); } } }, 'Pause'),
          (ev.pauses || []).filter((d) => d >= (D.day || '')).map((d) => h('span', { class: 'chip' }, d.split('-').reverse().join('/'), h('button', { type: 'button', 'aria-label': `Reprendre le ${d}`, on: { click: () => se({ pauses: (ev.pauses || []).filter((x) => x !== d) }) } }, '×')))),
        h('div', { class: 'mrow', style: 'margin-top:6px' }, h('button', { type: 'button', class: 'btn', on: { click: () => se({ actif: false }) } }, 'Tout désactiver')),
        h('p', { class: 'hint' }, `${D.event ? `Aujourd'hui : ${D.event.name}. ` : ''}Prochains : ${(events?.upcoming || []).filter((e) => e.on && !e.paused).slice(0, 5).map((e) => `${e.name} (${new Date(`${e.date}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })})`).join(', ') || 'aucun'}.`)),
    );
  }
  const start = async () => { if (D) onState(D); await loadEvents(); paint(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void start()); else void start();
  window.OdinMascotte = { tap, hidden, setHidden, get state() { return D; }, dress, onState, sayHook: null };
})();
