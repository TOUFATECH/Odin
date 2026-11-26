// Le fond qui vit derrière l'accueil (maquette validée « Accueil et écran de la maison », 15/11/2026) : l'ambiance
// animée de chaque thème. Les seize de la maquette sont dessinées ici : celles des thèmes faits main (ice, swoosh,
// icenight, neon, stars, et none, qui ne dessine rien), puis aurora, waves, rain, storm, snow, leaves, petals, bubbles,
// sunset et orbs (cette dernière prend les couleurs du thème : son accent, sa mascotte et la troisième couleur de sa
// palette, comme la maquette).
// Tout est dessiné dans la page : des formes, des dégradés et des couleurs, aucune image, aucune adresse extérieure.
// Pour qu'une machine modeste reste fluide : peu d'éléments animés (les points d'un ciel bougent par groupes ; la
// pluie, la neige, les feuilles, les pétales et les bulles, par quelques nappes qui glissent d'un bloc), et seulement
// leurs transformations et leur opacité.
// Ce fichier ne fait rien d'autre que se publier sur la page (window.OdinScenes) : themes.js, chargé après lui, pose la
// couche de fond derrière l'accueil, s'il y a une ambiance, si le réglage « fond animé » est mis ; il en règle aussi
// l'intensité pour que chaque texte des cartes reste lisible au pire point de l'ambiance (couleurs()).
// Une ambiance s'ajoute d'un bloc dans DESSINS : son dessin (html), les couleurs qu'il peut peindre avec leur opacité
// la plus forte (couleurs), et son style (css) ; le reste ne change pas. html et couleurs reçoivent le thème (t, celui
// de themes.js : son accent, sa mascotte), dont seule « orbs » se sert.
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
  // Une nappe : un calque de deux écrans de haut (l'écran visible, et celui d'où viennent les gouttes) qui glisse d'un
  // écran d'un bloc, et de dx px de côté. Chaque goutte y est deux fois : à sa place, et un écran plus loin, décalée de
  // -dx px : à la fin d'un tour, la copie est exactement où la goutte était au début, la boucle ne se voit pas.
  // `monte` : du bas vers le haut (bulles) ; sinon du haut vers le bas. Les n gouttes, tirées comme dans la maquette
  // (R), sont réparties entre les nappes ; `couleur` : la couleur de la nappe (currentColor de ses gouttes) ; `plus(i)` :
  // le style propre d'une goutte (taille, couleur, inclinaison) ; `large` : les gouttes partent de 0 à large − 1 % de la
  // largeur (100 sauf la pluie, qui penche vers la gauche : 104, comme la maquette).
  const nappes = (n, durees, classe, dx, o = {}) => suite(durees.length, (g) => {
    let dedans = '';
    for (let i = g; i < n; i += durees.length) {
      const x = R(i, o.large ?? 100), y = R(i, 50, 3), plus = o.plus ? o.plus(i) : '';
      const decal = dx > 0 ? `calc(${x}% - ${dx}px)` : `calc(${x}% + ${-dx}px)`;
      dedans += `<i style="left:${x}%;top:${o.monte ? y : 50 + y}%${plus}"></i><i style="left:${decal};top:${o.monte ? 50 + y : y}%${plus}"></i>`;
    }
    return `<div class="fv-nappe ${classe}" style="${o.couleur ? `color:${o.couleur};` : ''}animation-duration:${durees[g]}s;animation-delay:-${(durees[g] * g / durees.length).toFixed(2)}s">${dedans}</div>`;
  });
  const hex6 = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '');
  // Les couleurs des taches de « orbs » : l'accent et la mascotte du thème (blob1 et blob2 dans la maquette), puis la
  // troisième couleur de sa palette (var(--c3) : pal[2], #a35bff pour chaque thème « orbs » de la maquette, ceux d'Odin,
  // des événements et de Hestia). Sans thème (ou sans ses couleurs), rien.
  const PAL3 = '#a35bff';
  const couleursDuTheme = (t) => { const c = [hex6(t?.accent), hex6(t?.mascot)].filter(Boolean); return c.length ? [...c, PAL3] : []; };
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
    // Aurore : trois voiles d'aurore qui ondulent (les deux de Glace nuit, et un troisième, violet), un ciel étoilé en haut.
    // (Les voiles fv-aur, fv-a1 et fv-a2 ont leur style dans le bloc de Glace nuit.)
    aurora: {
      html: () => `<i class="fv-aur fv-a1"></i><i class="fv-aur fv-a2"></i><i class="fv-aur fv-a3" style="background:linear-gradient(90deg,transparent,#a99bff,transparent)"></i>${points(50, 3, 'fv-etoiles', 60, 5)}`,
      couleurs: [['#34d399', 0.55], ['#22d3ee', 0.55], ['#7c5cff', 0.55], ['#5dffb0', 0.55], ['#a99bff', 0.55], ['#ffffff', 1, 2]],
      css: '#odinFond .fv-a3{top:24%;animation-duration:27s}',
    },
    // Vagues : deux taches, et la mer en bas, deux vagues qui roulent l'une contre l'autre.
    waves: {
      html: () => `${taches(['#38bdf8', '#5eead4'])}<div class="fv-mer">${[['fv-vague fv-vb', '#38bdf8', '.25'], ['fv-vague', '#0ea5e9', '.3']].map(([k, c, o]) => `<svg class="${k}" viewBox="0 0 800 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M0 34 Q50 14 100 34 T200 34 T300 34 T400 34 T500 34 T600 34 T700 34 T800 34 V100 H0Z" fill="${c}" opacity="${o}"/></svg>`).join('')}</div>`,
      couleurs: [['#38bdf8', TACHE], ['#5eead4', TACHE], ['#0ea5e9', 0.3]],
      css: '#odinFond .fv-mer{position:absolute;left:0;right:0;bottom:0;height:18%}'
        + '#odinFond .fv-vague{position:absolute;bottom:0;left:0;width:200%;height:100%;animation:fv-vague 8s linear infinite}#odinFond .fv-vb{animation-duration:13s;animation-direction:reverse}@keyframes fv-vague{to{transform:translateX(-50%)}}',
    },
    // Pluie : des gouttes fines et penchées, en quatre nappes qui tombent chacune à sa vitesse.
    // (la maquette fait tomber chaque goutte seule, 70 éléments animés ; ici quatre)
    rain: {
      html: () => nappes(70, [0.7, 0.8, 0.9, 1], 'fv-pluie', -160, { couleur: '#aad2ff', large: 104 }),
      couleurs: [['#aad2ff', 0.8, 2]],
      css: '#odinFond .fv-pluie{animation:fv-pluie 1s linear infinite}#odinFond .fv-pluie i{width:1.5px;height:26px;background:linear-gradient(transparent,currentColor);opacity:.8;transform:rotate(12deg)}'
        + '@keyframes fv-pluie{to{transform:translate(-160px,50%)}}',
    },
    // Orage : la même pluie, plus rapide, et de temps en temps un éclair doux : deux lueurs qui montent et retombent
    // lentement (jamais plus de deux par seconde, au plus 0,2 de blanc), pour ne gêner personne de sensible aux flashs.
    // (la maquette fait deux éclairs vifs, de 70 ms chacun, toutes les 7 s ; ici aussi toutes les 7 s, mais chaque montée
  // et chaque descente prend 280 ms au moins)
    storm: {
      html: () => `${nappes(70, [0.6, 0.7, 0.8, 0.9], 'fv-pluie', -160, { couleur: '#aad2ff', large: 104 })}<i class="fv-eclair"></i>`,
      couleurs: [['#aad2ff', 0.8, 2], ['#ffffff', 0.2]],
      css: '#odinFond .fv-eclair{position:absolute;inset:0;background:#ffffff;opacity:0;animation:fv-eclair 7s ease-in-out infinite}'
        + '@keyframes fv-eclair{0%,80%{opacity:0}84%{opacity:.2}88%{opacity:.05}92%{opacity:.12}100%{opacity:0}}',
    },
    // Neige : des flocons de tailles diverses, en quatre nappes qui descendent en se balançant.
    snow: {
      html: () => nappes(70, [9, 11, 13, 15], 'fv-neige', -10, { plus: (i) => `;width:${3 + R(i, 5)}px;height:${3 + R(i, 5)}px` }),
      couleurs: [['#ffffff', 0.85, 10]],
      css: '#odinFond .fv-neige{animation:fv-neige 12s linear infinite}#odinFond .fv-neige i{border-radius:50%;background:#ffffff;opacity:.85;box-shadow:0 0 6px rgba(255,255,255,.7)}'
        + '@keyframes fv-neige{50%{transform:translate(30px,25%)}to{transform:translate(-10px,50%)}}',
    },
    // Feuilles : des feuilles vertes et rousses, en trois nappes qui tombent en se balançant.
    // (dans la maquette chaque feuille tourne sur elle-même ; ici chacune garde son angle : la nappe ne peut pas tourner)
    leaves: {
      html: () => nappes(18, [12, 15, 18], 'fv-feuilles', -20, { plus: (i) => `;background:${['#5fd38d', '#e8913a', '#c2410c', '#9acd32'][i % 4]};transform:rotate(${R(i, 360, 4)}deg)` }),
      couleurs: [['#5fd38d', 0.8, 12], ['#e8913a', 0.8, 12], ['#c2410c', 0.8, 12], ['#9acd32', 0.8, 12]],
      css: '#odinFond .fv-feuilles{animation:fv-feuilles 15s linear infinite}#odinFond .fv-feuilles i{width:12px;height:8px;border-radius:0 80% 0 80%;opacity:.8}'
        + '@keyframes fv-feuilles{50%{transform:translate(60px,25%)}to{transform:translate(-20px,50%)}}',
    },
    // Pétales : les mêmes, en rose (comme dans la maquette), en trois nappes.
    petals: {
      html: () => nappes(22, [11, 14, 17], 'fv-petales', -20, { plus: (i) => `;background:${['#ffb3d1', '#ff8ab5', '#ffd6e7', '#f9a8d4'][i % 4]};transform:rotate(${R(i, 360, 4)}deg)` }),
      couleurs: [['#ffb3d1', 0.8, 12], ['#ff8ab5', 0.8, 12], ['#ffd6e7', 0.8, 12], ['#f9a8d4', 0.8, 12]],
      css: '#odinFond .fv-petales{animation:fv-petales 14s linear infinite}#odinFond .fv-petales i{width:12px;height:8px;border-radius:0 80% 0 80%;opacity:.8}'
        + '@keyframes fv-petales{50%{transform:translate(60px,25%)}to{transform:translate(-20px,50%)}}',
    },
    // Bulles : des bulles rondes de tailles diverses, en trois nappes qui montent.
    // (une bulle de 20 px au plus est comptée comme un trait de 20 px : plus fort que son anneau, du côté prudent)
    bubbles: {
      html: () => nappes(30, [10, 14, 18], 'fv-bulles', 20, { monte: true, couleur: '#a0e6ff', plus: (i) => `;width:${6 + R(i, 14)}px;height:${6 + R(i, 14)}px` }),
      couleurs: [['#a0e6ff', 0.6, 20]],
      css: '#odinFond .fv-bulles{top:0;animation:fv-bulles 14s linear infinite}#odinFond .fv-bulles i{border-radius:50%;border:1.5px solid currentColor;opacity:.6}'
        + '@keyframes fv-bulles{to{transform:translate(20px,-50%)}}',
    },
    // Coucher de soleil : un grand soleil bas qui pulse doucement, et deux taches chaudes.
    sunset: {
      html: () => `<i class="fv-soleil" style="background:radial-gradient(#ffd38a,#ff9a62 55%,transparent 70%)"></i>${taches(['#ff9a62', '#e8486f'])}`,
      couleurs: [['#ffd38a', 1], ['#ff9a62', 1], ['#e8486f', TACHE]],
      css: '#odinFond .fv-soleil{position:absolute;left:50%;bottom:16%;width:260px;height:260px;margin-left:-130px;border-radius:50%;filter:blur(4px);animation:fv-soleil 7s ease-in-out infinite}'
        + '@keyframes fv-soleil{50%{transform:scale(1.08);opacity:.85}}',
    },
    // Taches : trois taches floues aux couleurs du thème (son accent, sa mascotte, la troisième couleur de sa palette),
    // qui dérivent lentement. Sans thème (ou sans ces couleurs), rien.
    orbs: {
      html: (t) => taches(couleursDuTheme(t)),
      couleurs: (t) => couleursDuTheme(t).map((c) => [c, TACHE]),
      css: '',
    },
    // Aucune ambiance : rien n'est dessiné.
    none: { html: () => '', couleurs: [], css: '' },
  };

  // Le style commun des ambiances dessinées : les taches, les groupes de points, le dessin qui couvre la couche.
  const CSS_COMMUN = '#odinFond .fv-svg{position:absolute;inset:0;width:100%;height:100%}'
    + '#odinFond .fv-orb{position:absolute;border-radius:50%;filter:blur(60px);opacity:.55;transform:translate(-50%,-50%);animation:fv-orb 24s ease-in-out infinite alternate}'
    + '@keyframes fv-orb{0%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-36%,-62%) scale(1.15)}100%{transform:translate(-62%,-40%) scale(.92)}}'
    + '#odinFond .fv-pts{position:absolute;inset:0}#odinFond .fv-pts i{position:absolute;width:2px;height:2px;border-radius:50%;background:#ffffff}'
    + '#odinFond .fv-etoiles{animation:fv-scint 4s ease-in-out infinite}@keyframes fv-scint{50%{opacity:.25}}'
    // Les nappes (pluie, neige, feuilles, pétales, bulles) : deux écrans de haut, à partir de l'écran du dessus.
    + '#odinFond .fv-nappe{position:absolute;left:0;top:-100%;width:100%;height:200%}#odinFond .fv-nappe i{position:absolute}';

  const dessinee = (nom) => Object.prototype.hasOwnProperty.call(DESSINS, nom);
  window.OdinScenes = {
    NOMS: [...NOMS],
    ambianceDe,
    /** L'ambiance est-elle dessinée ? (« none » l'est : elle ne dessine rien) */
    dessinee,
    /** Le dessin d'une ambiance pour le thème t (vide si elle n'en a pas). */
    html: (nom, t) => (dessinee(nom) ? DESSINS[nom].html(t) : ''),
    /** Les couleurs qu'une ambiance peut peindre pour le thème t : [« #rrggbb », opacité la plus forte de 0 à 1, largeur en px d'un point ou d'un trait fin]. */
    couleurs: (nom, t) => { if (!dessinee(nom)) return []; const c = DESSINS[nom].couleurs; return (typeof c === 'function' ? c(t) : c).map((x) => [...x]); },
    CSS: CSS_COMMUN + Object.values(DESSINS).map((d) => d.css).join(''),
  };
})();
