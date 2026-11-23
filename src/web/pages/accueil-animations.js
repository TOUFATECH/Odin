// Les 12 animations de déplacement des modules de l'accueil (maquette validée « Accueil », lot 17) : Classique,
// Glace qui glisse, Miroirs, Ressort, Aimant, Flottant, Fondu, Domino, Vague, Zoom, Élastique, Cascade. Elle joue
// quand un module est déplacé ou agrandi : la copie tenue se lève et se pose à sa façon, les autres modules glissent
// à leur nouvelle place avec elle. On la choisit dans Réglages → Apparence, à la place réservée en tête des thèmes,
// avec une démonstration ; le choix est gardé par Hestia (action « regler_animation », propriétaire seul), le même sur
// tous ses appareils. Un choix inconnu vaut « Classique ».
// « Moins d'animations » (le réglage de l'appareil) : rien ne bouge, même ce que lance le script (la maquette, elle,
// laissait partir ses animations lancées par le script : ce défaut n'est pas repris).
// Rien ne s'exécute à son chargement : fenetre.js pose le style (`CSS`), joue les mouvements (`jouer`, `prise`) et
// pose le bloc des Réglages (`poser`) quand la place réservée existe.
// API : window.OdinAnimations = { ORDRE, TEXTES, CSS, choix, nom, image, prise, reduit, actuelle, regler, ecouter,
//   garder, jouer, demo, poser }.
(() => {
  'use strict';
  if (window.OdinAnimations) return;

  /** Les textes de l'interface, en un seul endroit. */
  const TEXTES = Object.freeze({
    titre: 'Animations quand je déplace ou agrandis un widget',
    aide: 'Touche une carte pour la voir en mouvement et la choisir. Elle sert au glisser, au dépôt, au déplacement des autres widgets et à l\'agrandissement.',
    moins: 'Ton appareil demande moins d\'animations : ici, rien ne bouge. Ton choix est quand même gardé pour tes autres appareils.',
    gardee: (n) => `Animation : ${n}. Gardée sur tous tes appareils.`,
    refusee: (t) => `Animation non gardée : ${t}`,
    horsLigne: 'Animation non gardée : Odin ne répond pas.',
    noms: Object.freeze({
      classique: 'Classique', glace: 'Glace qui glisse', miroir: 'Miroirs', ressort: 'Ressort', aimant: 'Aimant', flottant: 'Flottant',
      fondu: 'Fondu', domino: 'Domino', vague: 'Vague', zoom: 'Zoom', elastique: 'Élastique', cascade: 'Cascade',
    }),
    details: Object.freeze({
      classique: 'L\'animation d\'origine : le widget penche un peu, les autres glissent.',
      glace: 'Le widget devient une plaque de glace transparente ; tout glisse sans à-coup, avec un reflet qui passe.',
      miroir: 'Les widgets pivotent comme des miroirs qui se croisent.',
      ressort: 'Ça rebondit un peu en arrivant, comme sur un ressort.',
      aimant: 'Le widget colle à la place libre d\'un coup sec, comme aimanté.',
      flottant: 'Le widget s\'envole avec une grande ombre et flotte doucement.',
      fondu: 'Les widgets disparaissent et réapparaissent en douceur à leur nouvelle place.',
      domino: 'Les widgets bougent l\'un après l\'autre, comme des dominos.',
      vague: 'Les widgets font un petit saut en arc, comme une vague.',
      zoom: 'Les widgets rétrécissent, voyagent, puis reprennent leur taille.',
      elastique: 'Les widgets s\'étirent dans le sens du mouvement puis se resserrent.',
      cascade: 'Les widgets tombent doucement à leur place, de haut en bas.',
    }),
  });

  /** Les 12, dans l'ordre de la maquette (les mêmes identifiants que chez Hestia, gladsheim.ts ANIMATIONS). */
  const ORDRE = Object.freeze(['classique', 'glace', 'miroir', 'ressort', 'aimant', 'flottant', 'fondu', 'domino', 'vague', 'zoom', 'elastique', 'cascade']);
  const EZ = Object.freeze({
    out: 'cubic-bezier(.2,.9,.25,1)', glide: 'cubic-bezier(.16,1,.3,1)', back: 'cubic-bezier(.34,1.56,.64,1)',
    spring: 'linear(0,0.009,0.035 2.1%,0.141,0.281 6.7%,0.723 12.9%,0.938 16.7%,1.017,1.077,1.121,1.149 24.3%,1.159,1.163,1.161,1.154 29.9%,1.129 32.8%,1.051 39.6%,1.017 43.1%,0.991,0.977 51%,0.974 53.8%,0.975 57.1%,0.997 69.8%,1.003 76.9%,1.004 83.8%,1)',
  });
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const px = (v) => `${Math.round(n(v) * 100) / 100}px`;
  const de = (dx, dy, sx, sy) => `translate(${px(dx)},${px(dy)}) scale(${n(sx) || 1},${n(sy) || 1})`;
  const rang = (i) => Math.min(Math.max(0, Math.trunc(n(i))), 12);
  /**
   * Par animation : la copie tenue (`incline` : degrés par px de mouvement, `leve` : agrandie de, `classe` : son
   * habit), sa pose (`pose` ms, `poseEase`), le reflet sur les modules qui bougent (`reflet`), et le mouvement des
   * autres (`flip`). Chaque mouvement part de l'ancienne place (dx, dy, sx, sy) et FINIT sur `transform: none`, opacité
   * pleine : le module est à sa place exacte, rien n'est figé après (jamais `fill: forwards`).
   */
  const ANIMS = Object.freeze({
    classique: { incline: 0.25, leve: 1.04, pose: 300, flip: (dx, dy, sx, sy) => [[{ transform: de(dx, dy, sx, sy) }, { transform: 'none' }], { duration: 420, easing: EZ.out }] },
    glace: { incline: 0, leve: 1.02, classe: 'glace', pose: 520, reflet: true, flip: (dx, dy, sx, sy) => [[{ transform: de(dx, dy, sx, sy), filter: 'blur(1.5px) brightness(1.08)' }, { transform: 'none', filter: 'none' }], { duration: 680, easing: EZ.glide }] },
    miroir: { incline: 0, leve: 1.03, classe: 'miroir', pose: 420, reflet: true, flip: (dx, dy, sx, sy) => [[{ transform: `perspective(900px) ${de(dx, dy, sx, sy)} rotateY(${dx > 0 ? -35 : dx < 0 ? 35 : 0}deg)` }, { transform: 'none' }], { duration: 600, easing: EZ.glide }] },
    ressort: { incline: 0.4, leve: 1.06, pose: 560, poseEase: EZ.spring, flip: (dx, dy, sx, sy) => [[{ transform: de(dx, dy, sx, sy) }, { transform: 'none' }], { duration: 760, easing: EZ.spring }] },
    aimant: { incline: 0, leve: 1.05, classe: 'aimant', pose: 180, poseEase: EZ.back, flip: (dx, dy, sx, sy) => [[{ transform: de(dx, dy, sx, sy) }, { transform: 'none' }], { duration: 220, easing: EZ.back }] },
    flottant: { incline: 0.1, leve: 1.09, classe: 'flottant', pose: 480, flip: (dx, dy, sx, sy) => [[{ transform: de(dx, dy, sx, sy), opacity: 0.7 }, { transform: 'none', opacity: 1 }], { duration: 560, easing: 'ease-in-out' }] },
    fondu: { incline: 0, leve: 1.02, pose: 260, flip: () => [[{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'ease-out' }] },
    domino: { incline: 0.2, leve: 1.04, pose: 300, flip: (dx, dy, sx, sy, i) => [[{ transform: de(dx, dy, sx, sy) }, { transform: 'none' }], { duration: 380, delay: rang(i) * 40, easing: EZ.out, fill: 'backwards' }] },
    vague: { incline: 0.15, leve: 1.04, pose: 360, flip: (dx, dy, sx, sy, i) => [[{ transform: de(dx, dy, sx, sy) }, { transform: de(dx / 2, dy / 2 - 26, (n(sx) + 1) / 2, (n(sy) + 1) / 2), offset: 0.5 }, { transform: 'none' }], { duration: 520, delay: rang(i) * 22, easing: 'ease-in-out', fill: 'backwards' }] },
    zoom: { incline: 0, leve: 1.06, pose: 340, flip: (dx, dy, sx, sy) => [[{ transform: de(dx, dy, sx, sy) }, { transform: `translate(${px(dx / 2)},${px(dy / 2)}) scale(.82)`, offset: 0.45 }, { transform: 'none' }], { duration: 520, easing: 'ease-in-out' }] },
    elastique: { incline: 0.3, leve: 1.05, pose: 420, poseEase: EZ.spring, flip: (dx, dy, sx, sy) => {
      const st = Math.min(0.18, (Math.abs(n(dx)) + Math.abs(n(dy))) / 3000), hx = Math.abs(n(dx)) > Math.abs(n(dy));
      return [[{ transform: de(dx, dy, sx, sy) }, { transform: `translate(${px(dx * 0.4)},${px(dy * 0.4)}) scale(${hx ? 1 + st : 1 - st / 2},${hx ? 1 - st / 2 : 1 + st})`, offset: 0.5 }, { transform: 'scale(1.02,.98)', offset: 0.85 }, { transform: 'none' }], { duration: 600, easing: 'ease-out' }];
    } },
    cascade: { incline: 0.1, leve: 1.04, pose: 380, flip: (dx, dy, sx, sy, i) => [[{ transform: de(dx, n(dy) - 30, sx, sy), opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 480, delay: rang(i) * 30, easing: EZ.back, fill: 'backwards' }] },
  });

  /** Un choix lu (chez Hestia, dans un vieux réglage) : un des 12, sinon « Classique ». */
  const choix = (id) => (typeof id === 'string' && Object.hasOwn(ANIMS, id) ? id : 'classique');
  const nom = (id) => TEXTES.noms[choix(id)];
  /**
   * Le mouvement d'un module qui change de place : il était à (dx, dy) de sa nouvelle place, à l'échelle (sx, sy) ;
   * `i` : son rang parmi ceux qui bougent (pour les animations en cascade). Rend [images clés, réglages] pour
   * `element.animate`.
   */
  function image(id, dx, dy, sx = 1, sy = 1, i = 0) {
    const [kf, opt] = ANIMS[choix(id)].flip(n(dx), n(dy), n(sx) || 1, n(sy) || 1, i);
    return [kf.map((k) => ({ ...k })), { ...opt }];
  }
  /**
   * La copie tenue pendant un glisser : `base` est le mouvement de fenetre.js (OdinGestes.mouvement). Avec « moins
   * d'animations », base rendue telle quelle (rien ne bouge) et pas d'habit.
   */
  function prise(id, base) {
    const b = base ?? { incline: 3, leve: 1.03, prise: 140, pose: 180 };
    if (!b.pose && !b.prise && !b.incline) return Object.freeze({ ...b, facteur: 0, poseEase: 'ease-out', classe: '' });
    const A = ANIMS[choix(id)];
    return Object.freeze({ ...b, incline: 5, facteur: A.incline, leve: A.leve, pose: A.pose, poseEase: A.poseEase ?? EZ.out, classe: A.classe ? `fe-g-${A.classe}` : '' });
  }
  /** L'appareil demande-t-il moins d'animations ? */
  function reduit() { try { return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches); } catch { return false; } }

  // Le choix du moment (celui gardé par Hestia, lu par fenetre.js ou par le bloc des Réglages), et qui veut le savoir.
  let courant = 'classique';
  const ecoutes = new Set();
  const actuelle = () => courant;
  // Le dernier choix qu'Hestia a dit garder (lu avec la fenêtre, ou accepté), les demandes en file, la dernière demande.
  let garde = null, fileChoix = Promise.resolve(), derniere = 0;
  /** `sur` : la valeur vient d'Hestia (lue avec la fenêtre) : c'est aussi celle qui est gardée. */
  function regler(id, sur = false) { if (sur) garde = choix(id); return reglerIci(id); }
  function reglerIci(id) { const c = choix(id); if (c === courant) return c; courant = c; for (const f of ecoutes) { try { f(c); } catch { /* un écouteur cassé n'arrête pas les autres */ } } return c; }
  function ecouter(f) { ecoutes.add(f); return () => ecoutes.delete(f); }
  /**
   * Garde le choix chez Hestia : montré tout de suite, les demandes passent une par une dans l'ordre ; refusé ou sans
   * réponse, c'est le dernier choix gardé qui revient (seulement si aucune carte n'a été touchée depuis). Rend
   * { ok, texte } (ce qui est annoncé).
   */
  function garder(act, id) {
    const c = choix(id), n = ++derniere;
    if (garde === null) garde = courant;
    reglerIci(c);
    const p = fileChoix.then(async () => {
      try {
        const r = await act('gladsheim', 'regler_animation', { animation: c });
        if (r?.ok) { garde = c; return { ok: true, texte: TEXTES.gardee(nom(c)) }; }
        if (n === derniere) reglerIci(garde);
        return { ok: false, texte: TEXTES.refusee(String(r?.text ?? r?.error ?? '')) };
      } catch { if (n === derniere) reglerIci(garde); return { ok: false, texte: TEXTES.horsLigne }; }
    });
    fileChoix = p.catch(() => undefined);
    return p;
  }

  /**
   * Joue l'animation sur les modules qui changent de place : `cartes()` rend les modules (avec `dataset.id`), `changer()`
   * déplace ou redessine (peut rendre une promesse). `o.sauf` : l'identifiant d'un module à laisser (celui qu'on tient),
   * `o.id` : l'animation (sinon celle choisie), `o.reduit` : moins d'animations (sinon l'appareil). Rend le nombre de
   * modules animés (ou une promesse de ce nombre). Avec « moins d'animations », rien n'est mesuré ni animé.
   */
  function jouer(cartes, changer, o = {}) {
    const red = o.reduit ?? reduit();
    if (red) { const r = changer(); return r && typeof r.then === 'function' ? r.then(() => 0) : 0; }
    const avant = new Map();
    for (const c of cartes()) if (c?.dataset?.id) avant.set(c.dataset.id, c.getBoundingClientRect());
    const suite = () => animerDepuis(avant, cartes(), choix(o.id ?? courant), o.sauf);
    const r = changer();
    return r && typeof r.then === 'function' ? r.then(suite) : suite();
  }
  // Le mouvement qui joue sur chaque module (un nouveau remplace l'ancien : rien ne s'empile, et la fin d'un ancien
  // ne retire pas l'origine du nouveau), et la minuterie de son reflet.
  const enCours = new WeakMap(), reflets = new WeakMap();
  function animerDepuis(avant, apres, id, sauf) {
    let i = 0;
    for (const e of apres) {
      const k = e?.dataset?.id; if (!k || k === sauf || typeof e.animate !== 'function') continue;
      const a = avant.get(k); if (!a) continue;
      const b = e.getBoundingClientRect(); if (!(b.width > 0) || !(b.height > 0)) continue;
      const dx = a.left - b.left, dy = a.top - b.top, sx = a.width / b.width, sy = a.height / b.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
      const [kf, opt] = image(id, dx, dy, sx, sy, i++);
      // Mesuré avant le changement avec l'ancien mouvement : le nouveau part de là où le module se voyait, puis l'ancien s'arrête.
      const ancien = enCours.get(e);
      e.style.transformOrigin = 'top left';
      const an = e.animate(kf, opt);
      if (an) { enCours.set(e, an); const fin = () => { if (enCours.get(e) === an) { enCours.delete(e); e.style.transformOrigin = ''; } }; an.onfinish = fin; an.oncancel = fin; }
      else enCours.delete(e);
      if (ancien && ancien !== an) { try { ancien.cancel(); } catch { /* déjà fini */ } }
      if (ANIMS[id].reflet && e.classList) { clearTimeout(reflets.get(e)); e.classList.remove('fe-reflet'); void e.offsetWidth; e.classList.add('fe-reflet'); reflets.set(e, setTimeout(() => e.classList.remove('fe-reflet'), 900)); }
    }
    return i;
  }

  /** La démonstration d'une carte : ses quatre carrés tournent d'un cran, avec l'animation. Rien avec « moins d'animations ». */
  function demo(boite, id, o = {}) {
    if (!boite) return 0;
    const items = () => [...boite.children];
    if (o.reduit ?? reduit()) return 0;
    return jouer(items, () => { boite.append(boite.firstElementChild); }, { id, reduit: false });
  }

  /** Le style des copies habillées, du reflet et du bloc des Réglages ; rien ne bouge avec « moins d'animations ». */
  const CSS = `
.fe-ghost.fe-g-glace{background:linear-gradient(140deg,rgba(255,255,255,.35),rgba(255,255,255,.08));backdrop-filter:blur(6px) saturate(1.6);border-color:rgba(255,255,255,.8);opacity:.92}
.fe-ghost.fe-g-glace::after,.fe-ghost.fe-g-miroir::after,.fe-w.fe-reflet::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:9;background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.55) 45%,rgba(255,255,255,.15) 55%,transparent 70%);background-size:250% 100%;animation:oan-balai 1.4s ease-in-out infinite}
.fe-w.fe-reflet::after{animation:oan-balai .9s ease-out 1}
.fe-ghost.fe-g-miroir{-webkit-box-reflect:below 6px linear-gradient(transparent 60%,rgba(255,255,255,.25));border-color:rgba(255,255,255,.7)}
.fe-ghost.fe-g-flottant{box-shadow:0 50px 90px rgba(0,0,0,.45)}.fe-ghost.fe-g-flottant>*{animation:oan-flotte 1.6s ease-in-out infinite}
.fe-ghost.fe-g-aimant{transition:transform .12s cubic-bezier(.34,1.56,.64,1)}
@keyframes oan-balai{from{background-position:120% 0}to{background-position:-120% 0}}@keyframes oan-flotte{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
.oan{margin:0 0 14px}.oan h3{margin:0 0 4px;font-size:14px;display:flex;gap:8px;align-items:baseline}.oan h3 small{color:var(--muted);font-weight:600}
.oan p{margin:0 0 10px;color:var(--muted);font-size:13px}.oan p.oan-moins{color:var(--ink);font-weight:600}
.oan-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(190px,100%),1fr));gap:10px}
.oan-c{display:flex;flex-direction:column;gap:6px;min-height:44px;padding:12px;text-align:left;border-radius:14px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;cursor:pointer;transition:transform .2s,box-shadow .2s}
.oan-c:hover{transform:translateY(-3px)}.oan-c[aria-pressed=true]{box-shadow:0 0 0 2px var(--accent,#0b7f7c)}.oan-c:focus-visible{outline:2px solid var(--accent,#0b7f7c);outline-offset:2px}
.oan-c b{font-size:14px}.oan-c small{font-size:12px;line-height:1.35;color:var(--muted)}
.oan-d{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;height:44px;margin-bottom:4px}.oan-d i{display:block;border-radius:9px;opacity:.85;background:var(--accent,#0b7f7c)}
.oan-d i:nth-child(4n+2){background:color-mix(in srgb,var(--accent,#0b7f7c) 55%,var(--panel,#fff))}.oan-d i:nth-child(4n+3){background:color-mix(in srgb,var(--ink,#10363a) 45%,var(--panel,#fff))}.oan-d i:nth-child(4n+4){background:color-mix(in srgb,var(--accent,#0b7f7c) 25%,var(--panel,#fff))}
.oan-dit{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion:reduce){.fe-ghost.fe-g-glace::after,.fe-ghost.fe-g-miroir::after,.fe-w.fe-reflet::after,.fe-ghost.fe-g-flottant>*{animation:none}.fe-ghost.fe-g-aimant,.oan-c{transition:none}.oan-c:hover{transform:none}}`;

  /**
   * Le bloc des Réglages, posé dans la place réservée par themes.js (`#themeAnims[data-place="animations"]`) : les 12
   * cartes, chacune avec sa démonstration. `o.act(module, action, input)` parle à Odin. Rend vrai s'il est posé.
   * Sans la place réservée (une autre page), il ne fait rien.
   */
  function poser(o = {}) {
    const place = document.querySelector('#themeAnims[data-place="animations"]');
    if (!place || place.dataset.pose === '1' || typeof o.act !== 'function') return false;
    place.dataset.pose = '1';
    const fait = (t, a = {}, ...kids) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); e.append(...kids); return e; };
    const titre = fait('h3', { id: 'oanTitre' }, TEXTES.titre, ' ', fait('small', {}, String(ORDRE.length)));
    const aide = fait('p', {}, TEXTES.aide), moins = fait('p', { class: 'oan-moins' }, TEXTES.moins); moins.hidden = !reduit();
    const grille = fait('div', { class: 'oan-g', role: 'group', 'aria-labelledby': 'oanTitre' });
    const dit = fait('div', { class: 'oan-dit', role: 'status', 'aria-live': 'polite' });
    const cartes = new Map();
    for (const id of ORDRE) {
      const d = fait('span', { class: 'oan-d', 'aria-hidden': 'true' }, ...['1', '2', '3', '4'].map((k) => fait('i', { 'data-id': k })));
      const b = fait('button', { type: 'button', class: 'oan-c', 'data-anim': id, 'aria-pressed': 'false' }, d, fait('b', {}, nom(id)), fait('small', {}, TEXTES.details[id]));
      b.addEventListener('click', () => { void choisir(id); demo(d, id); });
      cartes.set(id, b); grille.append(b);
    }
    const montrer = (c) => { for (const [id, b] of cartes) b.setAttribute('aria-pressed', String(id === c)); };
    async function choisir(id) { const r = await garder(o.act, id); dit.textContent = r.texte; return r.ok; }
    ecouter(montrer); montrer(courant);
    if (!document.getElementById('oanStyle')) { const s = document.createElement('style'); s.id = 'oanStyle'; s.textContent = CSS; document.head.append(s); }
    const bloc = fait('div', { class: 'oan' }, titre, aide, moins, grille, dit);
    place.replaceChildren(bloc); place.hidden = false;
    // Le choix gardé chez Hestia (lu avec la fenêtre : la même lecture que l'accueil).
    Promise.resolve().then(() => o.act('gladsheim', 'fenetre')).then((r) => { if (r?.ok && r.data && 'animation' in r.data) regler(r.data.animation, true); }).catch(() => { /* hors ligne : le dernier choix connu */ });
    return true;
  }

  window.OdinAnimations = Object.freeze({ ORDRE, TEXTES, CSS, choix, nom, image, prise, reduit, actuelle, regler, ecouter, garder, jouer, demo, poser });
})();
