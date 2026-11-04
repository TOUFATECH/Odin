// Visage d'Odin : dessine l'expression d'une humeur sur la mascotte (SVG 120×120).
// Partagé par le site, l'interface web et le rendu des autocollants Telegram.
// API : OdinFace.set(el, humeur) · OdinFace.all(humeur) · OdinFace.MOODS · OdinFace.flash(el, humeur, ms)
(() => {
  const W = '#fff';
  const MOODS = {
    neutre: { emoji: '🙂', eyes: 'pill' },
    joie: { emoji: '😊', eyes: 'happy', mouth: 'smile', cheeks: true },
    rire: { emoji: '😄', eyes: 'happy', mouth: 'grin', cheeks: true, anim: 'laugh' },
    amour: { emoji: '🥰', eyes: 'heart', mouth: 'smile', cheeks: true, tint: 'pink' },
    fierte: { emoji: '😎', eyes: 'shades', mouth: 'smirk' },
    excite: { emoji: '🤩', eyes: 'star', mouth: 'grin', anim: 'hop' },
    clin: { emoji: '😉', eyes: 'wink', mouth: 'smile' },
    malice: { emoji: '😏', eyes: 'half', mouth: 'smirk', brows: 'one' },
    surprise: { emoji: '😮', eyes: 'wide', mouth: 'o', brows: 'raised' },
    reflexion: { emoji: '🤔', eyes: 'up', mouth: 'side', brows: 'one' },
    concentration: { emoji: '🧐', eyes: 'squint', mouth: 'flat', brows: 'focus' },
    confus: { emoji: '😕', eyes: 'uneven', mouth: 'wavy', brows: 'one' },
    inquiet: { emoji: '😟', eyes: 'pill', mouth: 'wavy', brows: 'sad', extra: 'sweat' },
    triste: { emoji: '😢', eyes: 'small', mouth: 'frown', brows: 'sad', extra: 'tear', tint: 'blue' },
    colere: { emoji: '😠', eyes: 'squint', mouth: 'frown', brows: 'angry', tint: 'red', anim: 'shake' },
    peur: { emoji: '😨', eyes: 'wide', mouth: 'wobble', brows: 'sad', extra: 'sweat', anim: 'tremble' },
    gene: { emoji: '😳', eyes: 'wide', mouth: 'flat', cheeks: 'strong' },
    fatigue: { emoji: '😴', eyes: 'closed', mouth: 'flat', extra: 'zzz' },
    ecoute: { emoji: '👂', eyes: 'pill', mouth: 'smile', anim: 'tilt' },
    regarde: { emoji: '👀', eyes: 'pill', anim: 'look' },
    parle: { emoji: '🗣️', eyes: 'pill', mouth: 'talk' },
    cache: { emoji: '🙈', eyes: 'closed', mouth: 'smile', cheeks: true, extra: 'hands' },
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
    const [le, re] = EYES[m.eyes || 'pill']();
    f.eyes.innerHTML = `<g class="brow l">${le}</g><g class="brow r">${re}</g>`;
    f.brows.innerHTML = m.brows ? BROWS[m.brows]() : '';
    f.mouth.innerHTML = m.mouth ? MOUTH[m.mouth]() : '';
    f.cheeks.innerHTML = m.cheeks ? `<ellipse cx="37" cy="69" rx="6.5" ry="3.6" fill="#FF6F6F" opacity="${m.cheeks === 'strong' ? .75 : .42}"/><ellipse cx="83" cy="69" rx="6.5" ry="3.6" fill="#FF6F6F" opacity="${m.cheeks === 'strong' ? .75 : .42}"/>` : '';
    f.extra.innerHTML = m.extra ? EXTRA[m.extra]() : '';
    const tint = TINTS[m.tint || 'gold'];
    svg.querySelectorAll('[id^="odinBody"] stop').forEach((s, i) => s.setAttribute('stop-color', tint[i] || tint[3]));
    el.classList.remove('m-laugh', 'm-hop', 'm-shake', 'm-tremble', 'm-tilt', 'm-look');
    if (m.anim) el.classList.add(`m-${m.anim}`);
    // Petit émoji qui apparaît à côté du visage
    let b = el.querySelector('.mood-emoji');
    if (!b) { b = document.createElement('span'); b.className = 'mood-emoji'; b.setAttribute('aria-hidden', 'true'); el.append(b); }
    b.textContent = m.emoji; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    el.setAttribute('title', `Odin : ${key}`);
  }
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
  window.OdinFace = { MOODS, set, all, flash, base, own };
})();
