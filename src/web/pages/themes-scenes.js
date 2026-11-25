// Le fond qui vit derrière l'accueil (maquette validée « Accueil et écran de la maison », 15/11/2026) : l'ambiance
// animée de chaque thème. La maquette en a seize ; celles des thèmes faits main sont dessinées ici (ice, swoosh,
// icenight, neon, stars, et none, qui ne dessine rien) ; les dix autres attendent leur tour : un thème dont
// l'ambiance n'est pas encore dessinée n'a pas de fond animé (rien, pas une ambiance de remplacement).
// Tout est dessiné dans la page : des formes, des dégradés et des couleurs, aucune image, aucune adresse extérieure.
// Pour qu'une machine modeste reste fluide : peu d'éléments animés (les points d'un ciel bougent par groupes), et
// seulement leurs transformations et leur opacité.
// Ce fichier ne fait rien d'autre que se publier sur la page (window.OdinScenes) : themes.js, chargé après lui, pose la
// couche de fond derrière l'accueil, s'il y a une ambiance, si le réglage « fond animé » est mis ; il en règle aussi
// l'intensité pour que chaque texte des cartes reste lisible au pire point de l'ambiance (couleurs()).
// Une ambiance s'ajoute d'un bloc dans DESSINS : son dessin (html), les couleurs qu'il peut peindre avec leur opacité
// la plus forte (couleurs), et son style (css) ; le reste ne change pas.
(() => {
  // Les seize ambiances de la maquette (sceneBG).
  const NOMS = ['ice', 'swoosh', 'icenight', 'neon', 'stars', 'aurora', 'waves', 'rain', 'storm', 'snow', 'leaves', 'petals', 'bubbles', 'sunset', 'orbs', 'none'];
  // L'ambiance des thèmes d'Odin et des événements, comme la maquette les choisit (les autres : « orbs ») ; les thèmes du
  // catalogue (mis en avant, Hestia) ont la leur dans le catalogue. Le thème d'Odin qui porte un nom de lieu (vagues dans
  // la maquette) n'est pas nommé ici : il suit la règle des autres.
  const PAR_THEME = {
    nuit: 'stars', aurore: 'aurora', ocean: 'waves', plage: 'waves', vacances: 'waves', pluie: 'rain', orage: 'storm', neige: 'snow',
    espace: 'stars', foret: 'leaves', automne: 'leaves', printemps: 'petals', montagne: 'snow', coucher: 'sunset', desert: 'orbs', ciel: 'orbs', paysage: 'orbs',
    'ev-noel': 'snow', 'ev-nouvelan': 'stars', 'ev-ramadan': 'stars', 'ev-aidfitr': 'stars', 'ev-aidkebir': 'stars', 'ev-valentin': 'petals',
    'ev-carnaval': 'petals', 'ev-halloween': 'orbs', 'ev-musique': 'neon',
  };
  /** L'ambiance d'un thème : celle du catalogue, sinon celle de la maquette pour un thème d'Odin, sinon « orbs ». */
  function ambianceDe(id) {
    const c = window.OdinCatalogueThemes?.THEMES?.[id]?.scene;
    if (typeof c === 'string' && NOMS.includes(c)) return c;
    return Object.prototype.hasOwnProperty.call(PAR_THEME, id) ? PAR_THEME[id] : 'orbs';
  }

  // Des positions fixes, tirées comme dans la maquette (rien de hasardeux : le même dessin à chaque fois).
  const R = (i, m, o = 0) => ((i * 61 + o * 17) % m);
  const suite = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
  // Les taches floues de la maquette (jusqu'à quatre), qui dérivent lentement.
  const taches = (cols) => cols.map((c, i) => `<i class="fv-orb" style="left:${[8, 62, 30, 78][i]}%;top:${[12, 8, 58, 62][i]}%;width:${[38, 30, 34, 26][i]}vmax;height:${[38, 30, 34, 26][i]}vmax;background:${c};animation-delay:-${i * 5}s;animation-duration:${22 + i * 6}s"></i>`).join('');
  // Des points (étoiles, éclats) immobiles, rangés en quelques groupes : chaque groupe scintille d'un bloc.
  const points = (n, groupes, classe, haut, decal) => suite(groupes, (g) => `<div class="fv-pts ${classe}" style="animation-delay:-${g * 1.5}s">${suite(Math.ceil(n / groupes), (k) => { const i = g + k * groupes; return i < n ? `<i style="left:${R(i, 100)}%;top:${R(i, haut, decal)}%"></i>` : ''; })}</div>`);
  const TACHE = 0.55; // l'opacité des taches (la plus forte, au centre)
  // Les couleurs d'une ambiance : [couleur, opacité la plus forte] pour une grande forme ; [couleur, opacité, largeur en
  // px] pour un point ou un trait fin (étoile, éclat avec son halo, trait de lumière) : derrière une carte en verre, le
  // flou l'étale, et themes.js en tient compte pour juger la lisibilité.

  const DESSINS = {
    // Glace : un lac gelé sous les montagnes, un soleil qui pulse, des reflets, des éclats.
    ice: {
      html: () => `<svg class="fv-svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs><linearGradient id="fv-isky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9dbff"/><stop offset=".55" stop-color="#e8f6ff"/><stop offset="1" stop-color="#cfe9fb"/></linearGradient><radialGradient id="fv-isun"><stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="#ffffff" stop-opacity=".8"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient><linearGradient id="fv-ilake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe4fb"/><stop offset="1" stop-color="#e9f7ff"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#fv-isky)"/><circle class="fv-pulse" cx="1220" cy="230" r="320" fill="url(#fv-isun)"/><path d="M0 640 L180 470 300 560 470 380 620 520 780 360 960 540 1120 410 1290 560 1440 430 1600 520 V1000 H0Z" fill="#cde6f8"/><path d="M470 380 520 430 500 440 545 470 560 450 620 520 470 520Z M780 360 830 420 810 430 860 470 880 455 960 540 780 540Z M1120 410 1170 455 1150 465 1200 500 1215 485 1290 560 1120 560Z" fill="#ffffff" opacity=".9"/><path d="M0 720 L220 560 360 650 560 500 760 660 980 520 1200 680 1400 560 1600 650 V1000 H0Z" fill="#9fcdee"/><path d="M560 500 610 545 590 556 640 590 760 660 560 660Z M980 520 1030 565 1010 576 1060 610 1200 680 980 680Z" fill="#f4fbff" opacity=".85"/><rect y="760" width="1600" height="240" fill="url(#fv-ilake)"/><g class="fv-shim" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".7"><line x1="200" y1="800" x2="420" y2="800"/><line x1="700" y1="840" x2="1000" y2="840"/><line x1="1150" y1="805" x2="1380" y2="805"/><line x1="380" y1="890" x2="620" y2="890"/></g><path d="M0 1000 L40 760 90 1000Z M60 1000 110 820 150 1000Z M1500 1000 1540 740 1590 1000Z M1450 1000 1490 830 1530 1000Z" fill="#ffffff" opacity=".75"/></svg>${taches(['#7fd4ff', '#c7b6ff', '#9ff0e6', '#ffc7e3'])}${points(26, 3, 'fv-eclats', 100, 3)}`,
      couleurs: [['#a9dbff', 1], ['#e8f6ff', 1], ['#cfe9fb', 1], ['#ffffff', 1], ['#cde6f8', 1], ['#9fcdee', 1], ['#f4fbff', 0.85], ['#bfe4fb', 1], ['#e9f7ff', 1], ['#7fd4ff', TACHE], ['#c7b6ff', TACHE], ['#9ff0e6', TACHE], ['#ffc7e3', TACHE]],
      css: '#odinFond .fv-pulse{animation:fv-pulse 6s ease-in-out infinite;transform-origin:1220px 230px}@keyframes fv-pulse{50%{transform:scale(1.08);opacity:.85}}'
        + '#odinFond .fv-shim{animation:fv-shim 5s ease-in-out infinite alternate}@keyframes fv-shim{to{transform:translateX(40px);opacity:.25}}'
        + '#odinFond .fv-eclats{animation:fv-eclat 6s ease-in-out infinite}#odinFond .fv-eclats i{width:4px;height:4px;box-shadow:0 0 10px 2px rgba(255,255,255,.9)}@keyframes fv-eclat{0%,100%{opacity:0}50%{opacity:1}}',
    },
    // Vitre : deux grandes vagues de couleur qui ondulent, et des taches.
    swoosh: {
      html: () => `<svg class="fv-svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs><linearGradient id="fv-sw1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#16a34a"/></linearGradient><linearGradient id="fv-sw2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#60a5fa" stop-opacity="0"/><stop offset="1" stop-color="#93c5fd" stop-opacity=".55"/></linearGradient></defs><g class="fv-swa"><path d="M1600 260 C1250 380 1060 640 1180 1000 H1600Z" fill="url(#fv-sw1)" opacity=".9"/></g><g class="fv-swb"><path d="M0 720 C420 600 900 760 1600 520 V600 C900 840 420 700 0 800Z" fill="url(#fv-sw2)"/><path d="M0 140 C500 60 1000 220 1600 80" stroke="#bfdbfe" stroke-opacity=".25" stroke-width="40" fill="none"/></g></svg>${taches(['#38bdf8', '#22c55e', '#818cf8'])}`,
      couleurs: [['#5eead4', 0.9], ['#16a34a', 0.9], ['#60a5fa', 0.55], ['#93c5fd', 0.55], ['#bfdbfe', 0.25], ['#38bdf8', TACHE], ['#22c55e', TACHE], ['#818cf8', TACHE]],
      css: '#odinFond .fv-swa{animation:fv-swa 18s ease-in-out infinite alternate;transform-origin:1400px 700px}@keyframes fv-swa{to{transform:translate(-30px,20px) rotate(-3deg) scale(1.04)}}'
        + '#odinFond .fv-swb{animation:fv-swb 14s ease-in-out infinite alternate}@keyframes fv-swb{to{transform:translateY(-24px)}}',
    },
    // Glace nuit : des taches, deux voiles d'aurore, un ciel étoilé, des montagnes sombres.
    icenight: {
      html: () => `${taches(['#1e6fff', '#7b5cff', '#16c1e6', '#3b82f6'])}<i class="fv-aur fv-a1"></i><i class="fv-aur fv-a2"></i>${points(60, 3, 'fv-etoiles', 70, 2)}<svg class="fv-svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false"><path d="M0 760 L200 600 340 690 520 540 700 700 900 560 1080 700 1280 580 1600 700 V1000 H0Z" fill="#0d2546"/><path d="M520 540 565 585 548 595 590 625 700 700 520 700Z M900 560 945 605 928 615 970 645 1080 700 900 700Z" fill="#a9d7ff" opacity=".35"/><rect y="800" width="1600" height="200" fill="#081a33"/></svg>`,
      couleurs: [['#1e6fff', TACHE], ['#7b5cff', TACHE], ['#16c1e6', TACHE], ['#3b82f6', TACHE], ['#34d399', 0.55], ['#22d3ee', 0.55], ['#7c5cff', 0.55], ['#5dffb0', 0.55], ['#ffffff', 1, 2], ['#0d2546', 1], ['#a9d7ff', 0.35], ['#081a33', 1]],
      css: '#odinFond .fv-aur{position:absolute;left:-20%;width:140%;height:42%;top:2%;filter:blur(40px);opacity:.55;border-radius:50%;animation:fv-aur 16s ease-in-out infinite alternate}'
        + '#odinFond .fv-a1{background:linear-gradient(90deg,transparent,#34d399,#22d3ee,transparent)}#odinFond .fv-a2{top:14%;background:linear-gradient(90deg,transparent,#7c5cff,#5dffb0,transparent);animation-duration:21s;animation-direction:alternate-reverse}'
        + '@keyframes fv-aur{0%{transform:translateX(-8%) skewY(-4deg) scaleY(.8)}100%{transform:translateX(8%) skewY(5deg) scaleY(1.2)}}',
    },
    // Néon : des taches et des traits de lumière qui traversent l'écran.
    neon: {
      html: () => `${taches(['#ff6a1a', '#4f7dff', '#a35bff', '#29e0ff'])}${suite(5, (i) => `<i class="fv-trait" style="top:${15 + i * 18}%;animation-delay:-${(i * 1.7).toFixed(1)}s;background:linear-gradient(90deg,transparent,${['#4f7dff', '#ff4fa3', '#a35bff', '#29e0ff', '#7cff6b'][i]},transparent)"></i>`)}`,
      couleurs: [['#ff6a1a', TACHE], ['#4f7dff', TACHE], ['#a35bff', TACHE], ['#29e0ff', TACHE], ['#4f7dff', 0.6, 4], ['#ff4fa3', 0.6, 4], ['#a35bff', 0.6, 4], ['#29e0ff', 0.6, 4], ['#7cff6b', 0.6, 4]],
      // (la maquette déplace le trait par sa position ; ici par une translation : le même trajet, de -50 % à 110 % de l'écran)
      css: '#odinFond .fv-trait{position:absolute;left:-50%;width:60%;height:2px;filter:blur(1px);opacity:.6;animation:fv-trait 7s linear infinite}@keyframes fv-trait{to{transform:translateX(266.667%)}}',
    },
    // Ciel étoilé : des étoiles qui scintillent par groupes, une étoile filante, deux taches.
    stars: {
      html: () => `${points(80, 4, 'fv-etoiles', 100, 5)}<i class="fv-filante"></i>${taches(['#3b82f6', '#22d3ee'])}`,
      couleurs: [['#ffffff', 1, 2], ['#3b82f6', TACHE], ['#22d3ee', TACHE]],
      // (la maquette déplace l'étoile filante par sa position ; ici par une translation : le même trajet)
      css: '#odinFond .fv-filante{position:absolute;top:8%;left:-10%;width:140px;height:2px;background:linear-gradient(90deg,transparent,#ffffff);opacity:0;transform:rotate(18deg);animation:fv-filante 9s ease-in infinite}'
        + '@keyframes fv-filante{0%,80%{opacity:0;transform:translate(0,0) rotate(18deg)}84%{opacity:1}92%{opacity:0;transform:translate(80vw,26vh) rotate(18deg)}100%{opacity:0;transform:translate(80vw,26vh) rotate(18deg)}}',
    },
    // Aucune ambiance : rien n'est dessiné.
    none: { html: () => '', couleurs: [], css: '' },
  };

  // Le style commun des ambiances dessinées : les taches, les groupes de points, le dessin qui couvre la couche.
  const CSS_COMMUN = '#odinFond .fv-svg{position:absolute;inset:0;width:100%;height:100%}'
    + '#odinFond .fv-orb{position:absolute;border-radius:50%;filter:blur(60px);opacity:.55;transform:translate(-50%,-50%);animation:fv-orb 24s ease-in-out infinite alternate}'
    + '@keyframes fv-orb{0%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-36%,-62%) scale(1.15)}100%{transform:translate(-62%,-40%) scale(.92)}}'
    + '#odinFond .fv-pts{position:absolute;inset:0}#odinFond .fv-pts i{position:absolute;width:2px;height:2px;border-radius:50%;background:#ffffff}'
    + '#odinFond .fv-etoiles{animation:fv-scint 4s ease-in-out infinite}@keyframes fv-scint{50%{opacity:.25}}';

  const dessinee = (nom) => Object.prototype.hasOwnProperty.call(DESSINS, nom);
  window.OdinScenes = {
    NOMS: [...NOMS],
    ambianceDe,
    /** L'ambiance est-elle dessinée ? (« none » l'est : elle ne dessine rien) */
    dessinee,
    /** Le dessin d'une ambiance (vide si elle n'en a pas, ou pas encore). */
    html: (nom) => (dessinee(nom) ? DESSINS[nom].html() : ''),
    /** Les couleurs qu'une ambiance peut peindre : [« #rrggbb », opacité la plus forte de 0 à 1, largeur en px d'un point ou d'un trait fin]. */
    couleurs: (nom) => (dessinee(nom) ? DESSINS[nom].couleurs.map((x) => [...x]) : []),
    CSS: CSS_COMMUN + Object.values(DESSINS).map((d) => d.css).join(''),
  };
})();
