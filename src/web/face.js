// Visage d'Odin : dessine l'expression d'une humeur sur la mascotte (SVG 120×120).
// Partagé par le site, l'interface web et le rendu des autocollants Telegram.
// API : OdinFace.set(el, humeur) · OdinFace.all(humeur) · OdinFace.MOODS · OdinFace.flash(el, humeur, ms)
(() => {
  const W = '#fff';
  // Les yeux gardent toujours leur forme ; c'est sa couleur qui dit son humeur
  // (4 teintes du centre vers le bord, la dernière colore aussi les halos).
  const C = (a, b, c, d) => [a, b, c, d];
  const MOODS = {
    neutre: { tint: C('#E19B1F', '#EDB03D', '#F8CC70', '#FFE3A0'), eyes: {} },
    joie: { tint: C('#F0A818', '#F7BD32', '#FDD66B', '#FFEDAE'), eyes: { l: [1, .8], r: [1, .8], d: [0, -2], a: 'bob' } },
    rire: { tint: C('#F28A12', '#F8A630', '#FCC468', '#FFE1A8'), eyes: { l: [1.05, .55], r: [1.05, .55], a: 'giggle' }, anim: 'laugh' },
    amour: { tint: C('#E0457B', '#EE6A97', '#F7A3C0', '#FFD3E2'), eyes: { l: [1.12, 1.08], r: [1.12, 1.08], a: 'pulse' } },
    fierte: { tint: C('#7A4BD8', '#9166E6', '#B596F2', '#DCCBFF'), eyes: { l: [1, .62], r: [1, .62], d: [0, -3] } },
    excite: { tint: C('#F06A12', '#F7872E', '#FBAE66', '#FFD6AE'), eyes: { l: [1.1, 1.2], r: [1.1, 1.2], a: 'sparkle' }, anim: 'hop' },
    clin: { tint: C('#14A3A0', '#25BAB4', '#6AD6CF', '#B8F1EC'), eyes: { l: [1, 1], r: [.95, .6], a: 'ponder' } },
    malice: { tint: C('#8E3FB8', '#A659CC', '#C68DE0', '#EACBF7'), eyes: { l: [1, .55], r: [1, .55], a: 'sly' } },
    surprise: { tint: C('#16A6D8', '#30BCE8', '#76D6F3', '#BFEEFC'), eyes: { l: [1.3, 1.25], r: [1.3, 1.25], d: [-1.5, -2], a: 'pop' } },
    reflexion: { tint: C('#4256C9', '#5A6FDB', '#8E9DEB', '#C9D1FA'), eyes: { l: [.95, .9], r: [.95, .9], d: [0, -5], a: 'ponder' } },
    concentration: { tint: C('#2558B8', '#3570D0', '#6E9CE6', '#B5CDF7'), eyes: { l: [1.05, .45], r: [1.05, .45], d: [2.5, 0] } },
    confus: { tint: C('#7C7FA0', '#9396B4', '#B6B8CF', '#DEDFEB'), eyes: { l: [1, 1], r: [.95, .6], a: 'ponder' } },
    inquiet: { tint: C('#C77A1E', '#D6913A', '#E6B575', '#F5DDB8'), eyes: { l: [.9, .85], r: [.9, .85], a: 'dart' } },
    triste: { tint: C('#2F6FE0', '#3F82F0', '#7EAEF8', '#C3DBFF'), eyes: { l: [.75, .7], r: [.75, .7], d: [-1.5, 4], a: 'sink' } },
    colere: { tint: C('#C8231C', '#E0352B', '#F06A55', '#FFA593'), eyes: { l: [1.1, .4], r: [1.1, .4], d: [3, 1] }, anim: 'shake' },
    peur: { tint: C('#6E5BB8', '#8574CC', '#AB9FE2', '#D9D2F7'), eyes: { l: [.6, .7], r: [.6, .7], d: [1.5, 0], a: 'shiver' }, anim: 'tremble' },
    gene: { tint: C('#E2557A', '#EE7896', '#F6A9BD', '#FFD8E2'), eyes: { l: [.55, .5], r: [.55, .5], d: [0, 3], a: 'shy' } },
    fatigue: { tint: C('#5F7287', '#768A9F', '#A1B1C2', '#D2DBE4'), eyes: { l: [1, .25], r: [1, .25], d: [0, 3], a: 'droop' } },
    ecoute: { tint: C('#2E9E5B', '#43B672', '#7CD29E', '#C2EDD3'), eyes: { l: [1, 1.08], r: [1, 1.08], a: 'attent' } },
    regarde: { tint: C('#0E8FB8', '#22A7CF', '#64C6E2', '#B2E6F4'), eyes: { l: [1.05, 1.05], r: [1.05, 1.05] }, anim: 'look' },
    parle: { tint: C('#D8A112', '#E8B62C', '#F3CF68', '#FCEAB0'), eyes: { a: 'talk' }, anim: 'talk' },
    cache: { tint: C('#8A6E4B', '#A08562', '#C1AA8C', '#E5D8C6'), eyes: { l: [1, .08], r: [1, .08] } },
  };
  const TINTS = {
    gold: ['#E19B1F', '#EDB03D', '#F8CC70', '#FFE3A0'],
    red: ['#C8231C', '#E0352B', '#F06A55', '#FFA593'],
    blue: ['#2F6FE0', '#3F82F0', '#7EAEF8', '#C3DBFF'],
    pink: ['#E0457B', '#EE6A97', '#F7A3C0', '#FFD3E2'],
  };
  const L = 47.5, R = 72.5, Y = 56;
  const pill = (x, y = Y, h = 22) => `<rect class="eye" x="${x - 4.5}" y="${y - h / 2}" width="9" height="${h}" rx="4.5" fill="${W}"/>`;
  const line = (d, w = 4) => `<path d="${d}" fill="none" stroke="${W}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const heart = (cx, cy, s = 6.5) => `<path class="eye" d="M${cx} ${cy + s * .95}C${cx - s * 1.7} ${cy - s * .1} ${cx - s * .75} ${cy - s * 1.45} ${cx} ${cy - s * .45}C${cx + s * .75} ${cy - s * 1.45} ${cx + s * 1.7} ${cy - s * .1} ${cx} ${cy + s * .95}Z" fill="${W}"/>`;
  const star = (cx, cy, r = 7.5) => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; d += `${i ? 'L' : 'M'}${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`; } return `<path class="eye" d="${d}Z" fill="${W}" stroke="${W}" stroke-width="1" stroke-linejoin="round"/>`; };
  // Chaque forme d'yeux : [œil gauche, œil droit].
  const EYES = {
    pill: () => [pill(L), pill(R)],
    happy: () => [line(`M${L - 5.5} ${Y + 3}Q${L} ${Y - 6} ${L + 5.5} ${Y + 3}`, 4.5), line(`M${R - 5.5} ${Y + 3}Q${R} ${Y - 6} ${R + 5.5} ${Y + 3}`, 4.5)],
    closed: () => [line(`M${L - 5.5} ${Y}Q${L} ${Y + 4.5} ${L + 5.5} ${Y}`, 4), line(`M${R - 5.5} ${Y}Q${R} ${Y + 4.5} ${R + 5.5} ${Y}`, 4)],
    wide: () => [`<ellipse class="eye" cx="${L}" cy="${Y}" rx="6.5" ry="9" fill="${W}"/>`, `<ellipse class="eye" cx="${R}" cy="${Y}" rx="6.5" ry="9" fill="${W}"/>`],
    small: () => [`<circle class="eye" cx="${L}" cy="${Y + 1}" r="3.8" fill="${W}"/>`, `<circle class="eye" cx="${R}" cy="${Y + 1}" r="3.8" fill="${W}"/>`],
    heart: () => [heart(L, Y), heart(R, Y)],
    star: () => [star(L, Y), star(R, Y)],
    squint: () => [`<rect class="eye" x="${L - 5}" y="${Y - 3}" width="10" height="7" rx="3.5" fill="${W}"/>`, `<rect class="eye" x="${R - 5}" y="${Y - 3}" width="10" height="7" rx="3.5" fill="${W}"/>`],
    half: () => [`<rect class="eye" x="${L - 4.5}" y="${Y - 3}" width="9" height="12" rx="4.5" fill="${W}"/>`, `<rect class="eye" x="${R - 4.5}" y="${Y - 3}" width="9" height="12" rx="4.5" fill="${W}"/>`],
    wink: () => [pill(L), line(`M${R - 5.5} ${Y + 2}Q${R} ${Y - 5} ${R + 5.5} ${Y + 2}`, 4.5)],
    up: () => [pill(L, Y - 4, 20), pill(R, Y - 4, 20)],
    uneven: () => [pill(L, Y, 22), pill(R, Y + 2, 14)],
    shades: () => [`<path d="M36 48h48v6c0 6-4 10-10 10h-6c-4 0-6-3-7-6h-2c-1 3-3 6-7 6h-6c-6 0-10-4-10-10z" fill="#1E1A14"/><path d="M41 51h9M66 51h9" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>`, ''],
  };
  const BROWS = {
    angry: () => line('M39 40L53 46', 3.6) + line('M81 40L67 46', 3.6),
    sad: () => line('M40 45L53 39', 3.4) + line('M80 45L67 39', 3.4),
    raised: () => line('M40 38Q47.5 33 55 38', 3.4) + line('M65 38Q72.5 33 80 38', 3.4),
    one: () => line('M65 37Q72.5 32 80 37', 3.4),
    focus: () => line('M40 44L54 45', 3.4) + line('M80 44L66 45', 3.4),
  };
  const MOUTH = {
    smile: () => line('M50 76Q60 85 70 76', 3.6),
    grin: () => `<path d="M47 74Q60 92 73 74Z" fill="${W}" stroke="${W}" stroke-width="2" stroke-linejoin="round"/>`,
    o: () => `<ellipse cx="60" cy="79" rx="4.5" ry="5.5" fill="${W}"/>`,
    frown: () => line('M51 83Q60 75 69 83', 3.6),
    flat: () => line('M54 79H66', 3.6),
    wavy: () => line('M49 80Q54.5 76 60 80T71 80', 3.4),
    wobble: () => `<path d="M50 79Q55 74 60 79T70 79Q65 86 60 84T50 79Z" fill="${W}"/>`,
    smirk: () => line('M51 79Q62 83 70 74', 3.6),
    side: () => line('M58 80H68', 3.4),
    talk: () => `<ellipse class="talk" cx="60" cy="79" rx="5.5" ry="4" fill="${W}"/>`,
  };
  const EXTRA = {
    tear: () => `<path class="tear" d="M44 67Q40 74 44 77Q48 74 44 67Z" fill="#A9D4FF"/>`,
    sweat: () => `<path class="sweat" d="M86 36Q82 43 86 46Q90 43 86 36Z" fill="#CFE8FF"/>`,
    zzz: () => `<text class="zzz" x="84" y="36" font-size="13" font-weight="700" font-family="system-ui,sans-serif" fill="${W}">z</text><text class="zzz z2" x="93" y="26" font-size="9" font-weight="700" font-family="system-ui,sans-serif" fill="${W}">z</text>`,
    hands: () => `<ellipse cx="45" cy="57" rx="11" ry="8" fill="#F8CC70" stroke="#E19B1F" stroke-width="1.2"/><ellipse cx="75" cy="57" rx="11" ry="8" fill="#F8CC70" stroke="#E19B1F" stroke-width="1.2"/>`,
  };

  let uid = 0;
  /** Identifiants uniques par mascotte : plusieurs visages sur une page ne partagent pas leurs dégradés. */
  function own(svg) {
    if (svg.dataset.own) return; svg.dataset.own = '1';
    const n = ++uid, map = {};
    svg.querySelectorAll('[id]').forEach((d) => { const id = d.id; map[id] = `${id}-${n}`; d.id = map[id]; });
    svg.querySelectorAll('*').forEach((x) => { for (const a of ['fill', 'filter', 'stroke']) { const v = x.getAttribute(a); const m = v && v.match(/^url\(#(.+)\)$/); if (m && map[m[1]]) x.setAttribute(a, `url(#${map[m[1]]})`); } });
  }
  function face(svg) {
    own(svg);
    // Groupes dessinés une fois : expression (sous les yeux suivis), bouche, extras.
    const body = svg.querySelector('.body'); if (!body) return null;
    let g = body.querySelector('.expr');
    if (!g) {
      const ns = 'http://www.w3.org/2000/svg';
      for (const cls of ['brows', 'mouth', 'cheeks', 'extra']) { const n = document.createElementNS(ns, 'g'); n.setAttribute('class', cls); body.append(n); }
      g = document.createElementNS(ns, 'g'); g.setAttribute('class', 'expr'); body.append(g);
    }
    return { body, eyes: body.querySelector('.eyes'), brows: body.querySelector('.brows'), mouth: body.querySelector('.mouth'), cheeks: body.querySelector('.cheeks'), extra: body.querySelector('.extra') };
  }

  function set(el, mood) {
    const m = MOODS[mood] || MOODS.neutre, key = MOODS[mood] ? mood : 'neutre';
    if (!el || el.dataset.mood === key) return;
    const svg = el.querySelector('svg'), f = svg && face(svg); if (!f) return;
    el.dataset.mood = key;
    // Les yeux restent dans .eyes (ils suivent le doigt et clignent) ; seul leur dessin change.
    // Yeux : toujours la forme habituelle.
    if (!f.eyes.querySelector('.eye')) { const [le, re] = EYES.pill(); f.eyes.innerHTML = `<g class="brow l">${le}</g><g class="brow r">${re}</g>`; }
    for (const k of ['brows', 'mouth', 'cheeks', 'extra']) f[k].innerHTML = '';
    // Mouvement des yeux propre à l'humeur : taille, écart, hauteur, et petite animation ; jamais inclinés.
    const e = (m.eyes && typeof m.eyes === 'object') ? m.eyes : {};
    const [lx, ly] = e.l || [1, 1], [rx, ry] = e.r || [1, 1], [dx, dy] = e.d || [0, 0];
    el.style.setProperty('--lsx', lx); el.style.setProperty('--lsy', ly);
    el.style.setProperty('--rsx', rx); el.style.setProperty('--rsy', ry);
    el.style.setProperty('--edx', `${dx}px`); el.style.setProperty('--edy', `${dy}px`);
    [...el.classList].filter((c) => c.startsWith('e-')).forEach((c) => el.classList.remove(c));
    if (e.a) el.classList.add(`e-${e.a}`);
    // Couleur de l'humeur (transition douce), halos compris.
    const tint = m.tint || MOODS.neutre.tint;
    svg.querySelectorAll('[id^="odinBody"] stop').forEach((st, i) => { st.style.stopColor = tint[i] || tint[3]; });
    svg.querySelectorAll('[id^="odinHalo"] stop').forEach((st) => { st.style.stopColor = tint[3]; });
    // La barre de saisie de la discussion prend la couleur d'Odin.
    if (el.id === 'buddyChat') document.documentElement.style.setProperty('--odin-tint', tint[1]);
    el.classList.remove('m-laugh', 'm-hop', 'm-shake', 'm-tremble', 'm-tilt', 'm-look', 'm-talk');
    if (m.anim) el.classList.add(`m-${m.anim}`);
    el.querySelector('.mood-emoji')?.remove();
    el.setAttribute('title', `Odin : ${key}`);
  }

  // ---------- Sons (synthétisés, aucun fichier) ----------
  // Le navigateur n'autorise le son qu'après un premier toucher ou clic. Coupé/rétabli avec OdinFace.mute().
  let ac = null, unlocked = false, soundOn = true;
  try { soundOn = localStorage.getItem('odin-sound') !== '0'; } catch { /* stockage indisponible */ }
  const audio = () => {
    if (!unlocked || !soundOn) return null;
    if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ac = new A(); }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  };
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { unlocked = true; audio(); }, { capture: true, passive: true });
  /** Une note : fréquence de départ → d'arrivée, durée (s), forme d'onde, volume, décalage (s). */
  function note(f0, f1, dur, type = 'sine', vol = 0.16, delay = 0) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const UP = ['joie', 'rire', 'amour', 'excite', 'fierte', 'clin', 'malice', 'surprise'];
  const DOWN = ['triste', 'inquiet', 'peur', 'confus', 'fatigue', 'gene', 'cache'];
  const SOUNDS = {
    bounce: () => { note(260, 640, 0.12, 'sine', 0.2); note(640, 380, 0.18, 'sine', 0.14, 0.12); },
    angry: () => { for (let i = 0; i < 3; i++) note(150 - i * 18, 95 - i * 10, 0.16, 'sawtooth', 0.07, i * 0.17); },
    laugh: () => { for (let i = 0; i < 4; i++) note(700 + i * 60, 900 + i * 60, 0.07, 'triangle', 0.1, i * 0.09); },
    hop: () => { note(420, 820, 0.1, 'sine', 0.13); },
    shake: () => { for (let i = 0; i < 5; i++) note(220, 180, 0.05, 'square', 0.04, i * 0.06); },
    tremble: () => { note(520, 480, 0.35, 'triangle', 0.06); },
  };
  /** Son d'un mouvement (bounce, angry, laugh, hop, shake, tremble) ou d'un changement d'humeur. */
  function sound(name) {
    if (SOUNDS[name]) return SOUNDS[name]();
    if (name === 'colere') return SOUNDS.angry();
    if (UP.includes(name)) { note(660, 660, 0.12, 'sine', 0.11); note(990, 990, 0.18, 'sine', 0.1, 0.1); }
    else if (DOWN.includes(name)) { note(520, 520, 0.14, 'sine', 0.1); note(390, 370, 0.22, 'sine', 0.09, 0.12); }
    else note(740, 760, 0.14, 'sine', 0.08);
    const m = MOODS[name]; if (m && m.anim && SOUNDS[m.anim]) SOUNDS[m.anim]();
  }

  /**
   * Son du clignement : « tic » qui descend quand les yeux se ferment, qui remonte quand ils s'ouvrent.
   * Calé sur l'animation CSS o-blink (5,2 s ; fermeture à 93,5 %, réouverture à 96 %).
   * Seulement pour la mascotte principale, visible à l'écran, page au premier plan.
   */
  function blinkSounds(el) {
    if (!el || el._blink) return; el._blink = true;
    let visible = true;
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(el);
    const schedule = (eye) => {
      clearTimeout(el._bt1); clearTimeout(el._bt2);
      const ms = (parseFloat(getComputedStyle(eye).animationDuration) || 5.2) * 1000;
      const ok = () => visible && !document.hidden && getComputedStyle(eye).animationName === 'o-blink';
      el._bt1 = setTimeout(() => { if (ok()) note(900, 520, 0.05, 'sine', 0.045); }, ms * 0.935);
      el._bt2 = setTimeout(() => { if (ok()) note(520, 940, 0.06, 'sine', 0.04); }, ms * 0.96);
    };
    const hook = () => {
      const eye = el.querySelector('.eye'); if (!eye || eye._hooked) return; eye._hooked = true;
      eye.addEventListener('animationstart', (e) => { if (e.animationName === 'o-blink') schedule(eye); });
      eye.addEventListener('animationiteration', (e) => { if (e.animationName === 'o-blink') schedule(eye); });
      schedule(eye);
    };
    hook(); new MutationObserver(hook).observe(el, { subtree: true, childList: true });
  }
  function mute(off) { soundOn = off === undefined ? !soundOn : !off; try { localStorage.setItem('odin-sound', soundOn ? '1' : '0'); } catch { /* rien */ } return soundOn; }
  const all = (mood) => document.querySelectorAll('.odin').forEach((el) => set(el, mood));
  /** Expression passagère, puis retour à l'humeur de fond. */
  function flash(el, mood, ms = 2200) {
    if (!el) return;
    clearTimeout(el._flash);
    if (!el._base) el._base = el.dataset.mood || 'neutre';
    set(el, mood);
    el._flash = setTimeout(() => { set(el, el._base); el._base = null; }, ms);
  }
  /** Change l'humeur « de fond » (celle à laquelle on revient après une expression passagère). */
  function base(el, mood) { if (!el) return; if (el._flash) el._base = mood; else set(el, mood); }
  document.querySelectorAll('.odin svg').forEach(own);
  window.OdinFace = { MOODS, set, all, flash, base, own, sound, mute, blinkSounds, get soundOn() { return soundOn; } };
})();
