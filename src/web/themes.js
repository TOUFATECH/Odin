// Les thèmes d'Odin (maquettes validées ; 7 thèmes et 6 de température ajoutés le 15/11/2026) : décor, couleurs de toute l'interface, couleur d'Odin au repos.
// Choix : Réglages → Apparence, « Odin, change ton thème », ou Automatique (heure + météo, calculé par Odin
// pour que tous tes écrans et Telegram soient d'accord). « Valhalla » = le thème d'origine (clair / sombre / épuré).
// Les humeurs d'Odin gardent leurs couleurs : le thème ne change que sa couleur de repos et son halo.
(() => {
  // Les textes de Réglages → Apparence (en tête du fichier, pour les traduire d'un seul endroit).
  const TEXTES = {
    familles: { enavant: 'Mis en avant', odin: 'Les thèmes d\'Odin', hestia: 'Thèmes de Hestia', evenements: 'Événements de l\'année' },
    // Un thème de Hestia nommé avec sa famille (six noms existent dans deux familles).
    nomEtFamille: '{nom} · {famille}',
    // Les cartes des thèmes.
    clair: 'clair', sombre: 'sombre', lesDeux: 'clair ou sombre',
    automatique: 'Automatique',
    autoAide: 'selon l\'heure (veille 3 h – 6 h, jour, après-midi, soir, nuit) et la météo',
    // La place qui attend le choix de l'animation quand on déplace ou agrandit un widget (vide pour l'instant).
    animations: 'Animations quand je déplace ou agrandis un widget',
    sousTitre: 'Le thème change tout Odin (couleurs, décor, couleur d\'Odin au repos). Il est le même sur tous tes écrans. « Valhalla » garde les réglages d\'origine ci-dessous.',
    // La raison du thème affiché ({...} : remplis par Odin).
    evenement: 'Aujourd\'hui : thème {nom} (événement). ',
    raisonAuto: 'Automatique : {nom}{why}{odin}.',
    // Ce qu'ajoute Odin à la raison (la couleur selon la météo), et la raison de la règle, entre parenthèses.
    raisonOdin: ' · Odin {why}', raisonPourquoi: ' ({why})',
    choisi: 'Choisi : {nom}.',
    // L'interrupteur de la maquette, branché sur la règle d'Odin (le thème automatique).
    humeur: 'Odin change de thème selon son humeur',
    humeurAide: 'En automatique seulement, au plus une fois par heure.',
  };
  const remplir = (modele, v) => modele.replace(/\{(\w+)\}/g, (x, k) => (k in v ? String(v[k]) : x));
  const THEMES = {"glace": {"name": "Glace", "dark": false, "sky": ["#dff1fb", "#f3faff"], "panel": "#ffffff", "ink": "#0f2a3d", "accent": "#1a6fae", "mascot": "#2b8fd6", "decor": "<path d=\"M0 120 L40 92 L70 110 L110 80 L150 104 L190 76 L256 100 V170 H0Z\" fill=\"#dff3ff\" opacity=\".9\"/><path d=\"M0 140 L60 118 L120 136 L180 112 L256 130 V170 H0Z\" fill=\"#bfe6fb\"/><g stroke=\"#ffffff\" stroke-width=\"2\" opacity=\".85\" stroke-linecap=\"round\"><path d=\"M200 26 v28 M186 40 h28 M190 30 l20 20 M210 30 l-20 20\"/><path d=\"M40 20 v18 M31 29 h18 M34 23 l12 12 M46 23 l-12 12\"/></g>"}, "vacances": {"name": "Vacances", "dark": false, "sky": ["#c8eef7", "#fdf3dc"], "panel": "#ffffff", "ink": "#14323a", "accent": "#c2410c", "mascot": "#ff6b4a", "decor": "<circle cx=\"214\" cy=\"34\" r=\"20\" fill=\"#ffd34d\"/><path d=\"M0 128 Q64 118 128 128 T256 126 V170 H0Z\" fill=\"#f6dfaa\"/><path d=\"M0 112 Q50 104 100 112 T200 110 T256 112 V128 Q190 120 128 128 T0 128Z\" fill=\"#28b7c9\"/><path d=\"M70 128 L70 84\" stroke=\"#7a5532\" stroke-width=\"3\"/><path d=\"M40 86 Q70 58 100 86Z\" fill=\"#ff6b4a\"/><path d=\"M55 86 Q70 64 85 86\" fill=\"#fff\" opacity=\".6\"/><rect x=\"150\" y=\"122\" width=\"38\" height=\"8\" rx=\"3\" fill=\"#ff8f3a\"/>"}, "paysage": {"name": "Paysage", "dark": false, "sky": ["#dcefff", "#e9f7e4"], "panel": "#ffffff", "ink": "#17331b", "accent": "#2f7d3e", "mascot": "#3e9b4f", "decor": "<path d=\"M0 112 Q60 70 120 104 T256 92 V170 H0Z\" fill=\"#7cc46b\"/><path d=\"M0 132 Q80 104 160 126 T256 120 V170 H0Z\" fill=\"#4e9e4a\"/><circle cx=\"60\" cy=\"40\" r=\"14\" fill=\"#fff4b0\"/><g fill=\"#2f6e32\"><circle cx=\"190\" cy=\"104\" r=\"10\"/><rect x=\"188\" y=\"110\" width=\"4\" height=\"12\" fill=\"#5a3b20\"/><circle cx=\"214\" cy=\"110\" r=\"8\"/><rect x=\"212\" y=\"116\" width=\"4\" height=\"10\" fill=\"#5a3b20\"/></g>"}, "ciel": {"name": "Ciel", "dark": false, "sky": ["#a9d4fb", "#e4f2ff"], "panel": "#ffffff", "ink": "#10304d", "accent": "#1d5fbf", "mascot": "#1f6fd1", "decor": "<g fill=\"#ffffff\" opacity=\".95\"><ellipse cx=\"60\" cy=\"50\" rx=\"34\" ry=\"13\"/><ellipse cx=\"84\" cy=\"42\" rx=\"22\" ry=\"14\"/><ellipse cx=\"190\" cy=\"80\" rx=\"40\" ry=\"14\"/><ellipse cx=\"214\" cy=\"70\" rx=\"24\" ry=\"15\"/><ellipse cx=\"130\" cy=\"120\" rx=\"30\" ry=\"10\" opacity=\".7\"/></g><circle cx=\"226\" cy=\"28\" r=\"14\" fill=\"#fff2a8\"/>"}, "nuit": {"name": "Nuit étoilée", "dark": true, "sky": ["#0b1030", "#1d2a5c"], "panel": "#151d45", "ink": "#e6ebff", "accent": "#f4d35e", "mascot": "#f4d35e", "decor": "<circle cx=\"163\" cy=\"36\" r=\"1.3\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"245\" cy=\"98\" r=\"0.8\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"202\" cy=\"35\" r=\"0.8\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"32\" cy=\"51\" r=\"1.6\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"101\" cy=\"73\" r=\"0.8\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"67\" cy=\"5\" r=\"1\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"75\" cy=\"27\" r=\"1.6\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"199\" cy=\"106\" r=\"0.8\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"162\" cy=\"83\" r=\"1.6\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"37\" cy=\"4\" r=\"0.8\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"202\" cy=\"31\" r=\"1\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"78\" cy=\"44\" r=\"1\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"228\" cy=\"90\" r=\"1\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"244\" cy=\"92\" r=\"1\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"80\" cy=\"6\" r=\"1.3\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"46\" cy=\"22\" r=\"1.3\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"88\" cy=\"42\" r=\"0.8\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"177\" cy=\"94\" r=\"1.3\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"83\" cy=\"49\" r=\"1.3\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"182\" cy=\"44\" r=\"1\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"124\" cy=\"94\" r=\"1\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"69\" cy=\"6\" r=\"1.3\" fill=\"#fff\" opacity=\"0.8\"/><path d=\"M206 24 a16 16 0 1 0 16 20 a12 12 0 1 1 -16 -20Z\" fill=\"#f4f1d0\"/><path d=\"M0 140 Q80 126 150 140 T256 136 V170 H0Z\" fill=\"#0b1230\"/>"}, "aurore": {"name": "Aurore boréale", "dark": true, "sky": ["#071226", "#123a4a"], "panel": "#0f2333", "ink": "#e4fff6", "accent": "#3ef2b0", "mascot": "#3ef2b0", "decor": "<circle cx=\"86\" cy=\"23\" r=\"1.6\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"16\" cy=\"13\" r=\"0.8\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"153\" cy=\"11\" r=\"1\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"26\" cy=\"59\" r=\"1.6\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"65\" cy=\"15\" r=\"1.6\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"215\" cy=\"76\" r=\"0.8\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"165\" cy=\"84\" r=\"0.8\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"153\" cy=\"54\" r=\"0.8\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"15\" cy=\"75\" r=\"1\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"111\" cy=\"22\" r=\"0.8\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"82\" cy=\"75\" r=\"1\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"152\" cy=\"77\" r=\"1\" fill=\"#fff\" opacity=\"0.8\"/><path d=\"M0 70 C50 30 90 90 140 50 S220 40 256 60 V96 C210 76 170 110 130 86 S40 110 0 100Z\" fill=\"#3ef2b0\" opacity=\".45\"/><path d=\"M0 50 C60 20 110 70 160 36 S230 30 256 44 V64 C210 50 160 84 120 64 S40 80 0 70Z\" fill=\"#9b7bff\" opacity=\".35\"/><path d=\"M0 146 L60 120 L110 140 L170 116 L256 140 V170 H0Z\" fill=\"#0d1a2c\"/>"}, "ocean": {"name": "Océan", "dark": true, "sky": ["#0d3b5c", "#0a2a44"], "panel": "#0f3350", "ink": "#e9f7ff", "accent": "#5fd0f0", "mascot": "#36c2e8", "decor": "<path d=\"M0 90 Q32 80 64 90 T128 90 T192 90 T256 90 V170 H0Z\" fill=\"#1f7fb6\"/><path d=\"M0 112 Q32 102 64 112 T128 112 T192 112 T256 112 V170 H0Z\" fill=\"#15628f\"/><path d=\"M0 136 Q32 126 64 136 T128 136 T192 136 T256 136 V170 H0Z\" fill=\"#0e4a6e\"/><path d=\"M180 62 l22 -6 l-6 14Z\" fill=\"#fff\"/>"}, "plage": {"name": "Plage et palmiers", "dark": false, "sky": ["#bfe9f7", "#fbf0d6"], "panel": "#ffffff", "ink": "#123540", "accent": "#b4530f", "mascot": "#ff9a3d", "decor": "<circle cx=\"40\" cy=\"34\" r=\"16\" fill=\"#ffd56b\"/><path d=\"M0 130 Q64 120 128 130 T256 128 V170 H0Z\" fill=\"#f2d49b\"/><path d=\"M0 112 Q40 106 80 112 T160 112 T256 110 V130 Q192 122 128 130 T0 130Z\" fill=\"#2fb3c6\" opacity=\".9\"/><path d=\"M214 130 Q210 92 222 60\" stroke=\"#6b4a2b\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M222 60 Q200 50 186 60 M222 60 Q236 44 252 50 M222 60 Q206 38 196 36 M222 60 Q240 60 250 74\" stroke=\"#2f8f4e\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\"/>"}, "foret": {"name": "Forêt", "dark": true, "sky": ["#14301f", "#0d2216"], "panel": "#173a26", "ink": "#eaf7ec", "accent": "#8fe0a3", "mascot": "#7ed492", "decor": "<g fill=\"#1f5a34\"><path d=\"M20 140 L40 70 L60 140Z\"/><path d=\"M60 146 L86 56 L112 146Z\" fill=\"#256b3e\"/><path d=\"M110 146 L132 80 L154 146Z\"/><path d=\"M150 150 L178 60 L206 150Z\" fill=\"#2c7a46\"/><path d=\"M200 146 L224 76 L248 146Z\"/></g><path d=\"M0 146 H256 V170 H0Z\" fill=\"#183d24\"/>"}, "montagne": {"name": "Montagne", "dark": false, "sky": ["#cfdff0", "#eef3f9"], "panel": "#ffffff", "ink": "#1d2a3a", "accent": "#3b6aa3", "mascot": "#4f7fb8", "decor": "<path d=\"M0 140 L70 52 L120 110 L170 40 L256 132 V170 H0Z\" fill=\"#5f6f86\"/><path d=\"M70 52 L84 70 L74 66 L62 74Z M170 40 L188 62 L176 58 L160 66Z\" fill=\"#fff\"/><path d=\"M0 150 L80 120 L150 146 L210 118 L256 140 V170 H0Z\" fill=\"#3b4a5e\"/>"}, "coucher": {"name": "Coucher de soleil", "dark": true, "sky": ["#3a1d4a", "#7a2f4f"], "panel": "#3a1c3a", "ink": "#fff0e6", "accent": "#ffb05c", "mascot": "#ff8a5c", "decor": "<circle cx=\"128\" cy=\"112\" r=\"34\" fill=\"#ffcc5c\"/><path d=\"M0 112 H256 V170 H0Z\" fill=\"#7a2f4f\" opacity=\".85\"/><path d=\"M0 124 Q64 118 128 124 T256 122\" stroke=\"#ffb46b\" stroke-width=\"2\" fill=\"none\" opacity=\".7\"/><path d=\"M0 136 Q64 130 128 136 T256 134\" stroke=\"#ffb46b\" stroke-width=\"2\" fill=\"none\" opacity=\".5\"/>"}, "desert": {"name": "Désert", "dark": false, "sky": ["#fde3b8", "#fff3df"], "panel": "#fffaf1", "ink": "#3a2410", "accent": "#a8521a", "mascot": "#e08a3c", "decor": "<circle cx=\"200\" cy=\"40\" r=\"18\" fill=\"#fff1b8\"/><path d=\"M0 124 Q70 96 140 122 T256 112 V170 H0Z\" fill=\"#e3a659\"/><path d=\"M0 144 Q90 120 180 142 T256 136 V170 H0Z\" fill=\"#cc8a3f\"/><path d=\"M60 124 v-26 M60 106 h-8 v-8 M60 112 h8 v-10\" stroke=\"#3f7a3a\" stroke-width=\"5\" stroke-linecap=\"round\" fill=\"none\"/>"}, "pluie": {"name": "Pluie", "dark": true, "sky": ["#4a5768", "#2f3a48"], "panel": "#2a3442", "ink": "#eaf1f8", "accent": "#9cc6ef", "mascot": "#7fb3e6", "decor": "<g fill=\"#9aa8b8\"><ellipse cx=\"80\" cy=\"40\" rx=\"44\" ry=\"16\"/><ellipse cx=\"110\" cy=\"32\" rx=\"28\" ry=\"16\"/><ellipse cx=\"190\" cy=\"52\" rx=\"40\" ry=\"14\"/></g><g stroke=\"#cfe0f2\" stroke-width=\"2\" stroke-linecap=\"round\" opacity=\".8\"><path d=\"M50 66 l-6 14 M76 70 l-6 14 M102 64 l-6 14 M128 72 l-6 14 M170 76 l-6 14 M196 70 l-6 14 M222 78 l-6 14 M60 100 l-6 14 M120 104 l-6 14 M184 106 l-6 14\"/></g>"}, "orage": {"name": "Orage", "dark": true, "sky": ["#1b1630", "#2b2448"], "panel": "#221c3a", "ink": "#ece8ff", "accent": "#ffe26b", "mascot": "#ffe26b", "decor": "<g fill=\"#3a3352\"><ellipse cx=\"90\" cy=\"38\" rx=\"56\" ry=\"20\"/><ellipse cx=\"170\" cy=\"46\" rx=\"60\" ry=\"20\"/></g><path d=\"M150 60 l-16 34 h14 l-12 30 l30 -42 h-14 l12 -22Z\" fill=\"#ffe26b\"/><g stroke=\"#8d86b3\" stroke-width=\"2\" opacity=\".6\"><path d=\"M60 70 l-6 14 M90 74 l-6 14 M200 72 l-6 14 M226 80 l-6 14\"/></g>"}, "neige": {"name": "Neige", "dark": false, "sky": ["#dfe8f2", "#f7fafc"], "panel": "#ffffff", "ink": "#1c2a38", "accent": "#3d6fb8", "mascot": "#5b8fd9", "decor": "<path d=\"M0 132 Q70 116 140 130 T256 124 V170 H0Z\" fill=\"#ffffff\"/><circle cx=\"119\" cy=\"75\" r=\"1.6\" fill=\"#ffffff\" opacity=\"0.8\"/><circle cx=\"134\" cy=\"79\" r=\"1\" fill=\"#ffffff\" opacity=\"0.6\"/><circle cx=\"209\" cy=\"69\" r=\"1.6\" fill=\"#ffffff\" opacity=\"1\"/><circle cx=\"161\" cy=\"105\" r=\"1\" fill=\"#ffffff\" opacity=\"0.6\"/><circle cx=\"118\" cy=\"42\" r=\"1\" fill=\"#ffffff\" opacity=\"0.6\"/><circle cx=\"141\" cy=\"107\" r=\"0.8\" fill=\"#ffffff\" opacity=\"1\"/><circle cx=\"105\" cy=\"61\" r=\"1\" fill=\"#ffffff\" opacity=\"1\"/><circle cx=\"7\" cy=\"110\" r=\"0.8\" fill=\"#ffffff\" opacity=\"0.6\"/><circle cx=\"13\" cy=\"28\" r=\"1\" fill=\"#ffffff\" opacity=\"1\"/><circle cx=\"11\" cy=\"103\" r=\"1.6\" fill=\"#ffffff\" opacity=\"0.8\"/><circle cx=\"116\" cy=\"79\" r=\"1\" fill=\"#ffffff\" opacity=\"1\"/><circle cx=\"63\" cy=\"85\" r=\"1.3\" fill=\"#ffffff\" opacity=\"0.8\"/><circle cx=\"5\" cy=\"88\" r=\"0.8\" fill=\"#ffffff\" opacity=\"0.8\"/><circle cx=\"171\" cy=\"39\" r=\"1.6\" fill=\"#ffffff\" opacity=\"1\"/><circle cx=\"242\" cy=\"14\" r=\"1.3\" fill=\"#ffffff\" opacity=\"0.8\"/><circle cx=\"198\" cy=\"33\" r=\"1.3\" fill=\"#ffffff\" opacity=\"0.6\"/><circle cx=\"21\" cy=\"76\" r=\"0.8\" fill=\"#ffffff\" opacity=\"0.8\"/><circle cx=\"31\" cy=\"41\" r=\"1.6\" fill=\"#ffffff\" opacity=\"0.6\"/><circle cx=\"249\" cy=\"6\" r=\"0.8\" fill=\"#ffffff\" opacity=\"0.6\"/><circle cx=\"57\" cy=\"10\" r=\"1.6\" fill=\"#ffffff\" opacity=\"0.8\"/><circle cx=\"185\" cy=\"54\" r=\"1.6\" fill=\"#ffffff\" opacity=\"0.6\"/><circle cx=\"148\" cy=\"84\" r=\"1\" fill=\"#ffffff\" opacity=\"1\"/><circle cx=\"73\" cy=\"47\" r=\"0.8\" fill=\"#ffffff\" opacity=\"0.8\"/><circle cx=\"89\" cy=\"5\" r=\"1.6\" fill=\"#ffffff\" opacity=\"0.6\"/><circle cx=\"38\" cy=\"35\" r=\"0.8\" fill=\"#ffffff\" opacity=\"0.6\"/><circle cx=\"19\" cy=\"63\" r=\"1.6\" fill=\"#ffffff\" opacity=\"0.6\"/><g fill=\"#2f5d48\"><path d=\"M180 132 L196 92 L212 132Z\"/><path d=\"M190 100 L196 86 L202 100Z\" fill=\"#fff\"/></g>"}, "mayotte": {"name": "Mayotte", "dark": false, "sky": ["#bfeaf3", "#e6f8f4"], "panel": "#ffffff", "ink": "#10363a", "accent": "#0b7f7c", "mascot": "#0fa3a0", "decor": "<circle cx=\"46\" cy=\"36\" r=\"15\" fill=\"#ffd56b\"/><path d=\"M0 104 Q64 96 128 104 T256 102 V170 H0Z\" fill=\"#1fb4b0\"/><path d=\"M0 128 Q64 120 128 128 T256 126 V170 H0Z\" fill=\"#0f8f9c\"/><path d=\"M150 104 Q170 70 196 66 Q222 70 236 104Z\" fill=\"#2f8f4e\"/><circle cx=\"96\" cy=\"70\" r=\"5\" fill=\"#f6e27a\"/><path d=\"M96 70 l-10 -6 M96 70 l10 -6 M96 70 l-8 8 M96 70 l8 8 M96 70 v-11\" stroke=\"#f6e27a\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M60 114 l10 -6 l10 6\" stroke=\"#fff\" stroke-width=\"2\" fill=\"none\"/>"}, "printemps": {"name": "Printemps fleuri", "dark": false, "sky": ["#ffe3ee", "#fff8fb"], "panel": "#ffffff", "ink": "#3a1f2a", "accent": "#b83a6a", "mascot": "#e05a8c", "decor": "<path d=\"M0 140 Q80 124 160 138 T256 134 V170 H0Z\" fill=\"#9ed49a\"/><path d=\"M40 140 Q46 100 70 80\" stroke=\"#6b4a3b\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\"/><g fill=\"#ffb3cf\"><circle cx=\"70\" cy=\"74\" r=\"14\"/><circle cx=\"54\" cy=\"84\" r=\"11\"/><circle cx=\"86\" cy=\"86\" r=\"10\"/><circle cx=\"160\" cy=\"40\" r=\"4\"/><circle cx=\"196\" cy=\"70\" r=\"3\"/><circle cx=\"226\" cy=\"50\" r=\"4\"/><circle cx=\"130\" cy=\"96\" r=\"3\"/></g>"}, "automne": {"name": "Automne", "dark": false, "sky": ["#f5d3a8", "#fbe8cf"], "panel": "#fff8ee", "ink": "#3a200f", "accent": "#a8401f", "mascot": "#c9502a", "decor": "<g fill=\"#e07a2e\"><path d=\"M40 40 q10 -14 20 0 q-10 14 -20 0Z\"/><path d=\"M200 60 q10 -14 20 0 q-10 14 -20 0Z\" fill=\"#c9502a\"/><path d=\"M120 90 q10 -14 20 0 q-10 14 -20 0Z\" fill=\"#f2a93b\"/><path d=\"M80 120 q10 -14 20 0 q-10 14 -20 0Z\" fill=\"#b8432a\"/><path d=\"M220 120 q10 -14 20 0 q-10 14 -20 0Z\"/></g><path d=\"M0 146 Q90 134 180 144 T256 140 V170 H0Z\" fill=\"#8a4a24\"/>"}, "espace": {"name": "Espace", "dark": true, "sky": ["#05060f", "#1b1240"], "panel": "#14112e", "ink": "#efeaff", "accent": "#c4a6ff", "mascot": "#b28cff", "decor": "<circle cx=\"137\" cy=\"57\" r=\"1.3\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"78\" cy=\"26\" r=\"1.3\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"238\" cy=\"7\" r=\"1\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"212\" cy=\"99\" r=\"1.6\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"224\" cy=\"68\" r=\"1.3\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"220\" cy=\"91\" r=\"1.6\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"145\" cy=\"11\" r=\"1\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"42\" cy=\"94\" r=\"1\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"142\" cy=\"19\" r=\"0.8\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"108\" cy=\"14\" r=\"1.6\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"157\" cy=\"22\" r=\"1.6\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"239\" cy=\"47\" r=\"0.8\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"99\" cy=\"77\" r=\"0.8\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"94\" cy=\"10\" r=\"1.6\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"152\" cy=\"103\" r=\"0.8\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"65\" cy=\"18\" r=\"1\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"138\" cy=\"50\" r=\"0.8\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"20\" cy=\"104\" r=\"1.3\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"195\" cy=\"81\" r=\"1\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"172\" cy=\"43\" r=\"1.3\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"47\" cy=\"46\" r=\"0.8\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"152\" cy=\"104\" r=\"1.3\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"6\" cy=\"10\" r=\"1.3\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"123\" cy=\"99\" r=\"1.3\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"166\" cy=\"10\" r=\"1\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"70\" cy=\"13\" r=\"1.6\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"162\" cy=\"76\" r=\"1\" fill=\"#fff\" opacity=\"0.8\"/><circle cx=\"128\" cy=\"97\" r=\"1.6\" fill=\"#fff\" opacity=\"0.6\"/><circle cx=\"54\" cy=\"36\" r=\"1\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"32\" cy=\"31\" r=\"0.8\" fill=\"#fff\" opacity=\"1\"/><circle cx=\"190\" cy=\"70\" r=\"26\" fill=\"#d98a5b\"/><ellipse cx=\"190\" cy=\"70\" rx=\"42\" ry=\"9\" fill=\"none\" stroke=\"#f3c79c\" stroke-width=\"3\"/><circle cx=\"60\" cy=\"120\" r=\"12\" fill=\"#5b8fd9\"/><circle cx=\"64\" cy=\"116\" r=\"3\" fill=\"#9fc2f0\"/>"}, "veille": {"name": "Veille de l'aube", "dark": true, "sky": ["#141a3a", "#4a3a6a"], "panel": "#1d2246", "ink": "#eef0ff", "accent": "#ffb38a", "mascot": "#c9a2ff", "decor": "<path d=\"M0 150 Q128 96 256 150 V170 H0Z\" fill=\"#ff9f7a\" opacity=\".35\"/><path d=\"M0 132 L50 112 L96 126 L150 100 L206 122 L256 108 V170 H0Z\" fill=\"#2a2650\"/><circle cx=\"60\" cy=\"30\" r=\"1.4\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"120\" cy=\"18\" r=\"1\" fill=\"#fff\" opacity=\".6\"/><circle cx=\"190\" cy=\"40\" r=\"1.2\" fill=\"#fff\" opacity=\".5\"/><circle cx=\"230\" cy=\"20\" r=\"1\" fill=\"#fff\" opacity=\".7\"/>"}, "lagon": {"name": "Lagon", "dark": false, "sky": ["#c9f3f0", "#effcfa"], "panel": "#ffffff", "ink": "#0d3330", "accent": "#0b7f78", "mascot": "#14b8a6", "decor": "<path d=\"M0 118 Q64 108 128 118 T256 116 V170 H0Z\" fill=\"#5fd6cc\"/><path d=\"M0 136 Q64 128 128 136 T256 134 V170 H0Z\" fill=\"#2bb3a8\"/><ellipse cx=\"190\" cy=\"118\" rx=\"38\" ry=\"7\" fill=\"#f4e3b5\"/><path d=\"M190 116 L190 84\" stroke=\"#7a5532\" stroke-width=\"3\"/><path d=\"M170 90 Q190 70 210 90 Q190 80 170 90Z\" fill=\"#2f8f4e\"/>"}, "volcan": {"name": "Volcan", "dark": true, "sky": ["#2a1214", "#5a1f18"], "panel": "#2e1617", "ink": "#ffeee6", "accent": "#ff7a3d", "mascot": "#ff5a2a", "decor": "<path d=\"M40 170 L110 70 L130 74 L146 70 L216 170Z\" fill=\"#3a1f1a\"/><path d=\"M110 70 Q128 50 146 70 Q128 64 110 70Z\" fill=\"#ff7a3d\"/><path d=\"M126 72 Q118 110 104 140\" stroke=\"#ff5a2a\" stroke-width=\"3\" fill=\"none\" opacity=\".8\"/><g fill=\"#ffb38a\" opacity=\".6\"><circle cx=\"122\" cy=\"40\" r=\"2\"/><circle cx=\"138\" cy=\"30\" r=\"1.5\"/><circle cx=\"130\" cy=\"20\" r=\"1.2\"/></g>"}, "savane": {"name": "Savane", "dark": false, "sky": ["#fde9c4", "#fff6e4"], "panel": "#fffdf7", "ink": "#33230d", "accent": "#9a5a12", "mascot": "#e0912f", "decor": "<circle cx=\"200\" cy=\"52\" r=\"22\" fill=\"#ffb54d\" opacity=\".9\"/><path d=\"M0 132 Q80 118 160 130 T256 126 V170 H0Z\" fill=\"#d9b26a\"/><path d=\"M70 132 L70 96\" stroke=\"#5a3a1a\" stroke-width=\"3\"/><path d=\"M40 98 Q70 84 100 98Z\" fill=\"#6b7a2a\"/>"}, "lavande": {"name": "Lavande", "dark": false, "sky": ["#ece4fb", "#f8f4ff"], "panel": "#ffffff", "ink": "#2a1d44", "accent": "#6a43b8", "mascot": "#9a74e0", "decor": "<path d=\"M0 124 Q128 112 256 124 V170 H0Z\" fill=\"#cdb8f2\"/><g stroke=\"#8a63d2\" stroke-width=\"3\" stroke-linecap=\"round\"><path d=\"M20 168 L36 128\"/><path d=\"M60 168 L74 126\"/><path d=\"M100 168 L112 128\"/><path d=\"M140 168 L150 126\"/><path d=\"M180 168 L190 128\"/><path d=\"M220 168 L228 126\"/></g>"}, "cerisier": {"name": "Cerisiers", "dark": false, "sky": ["#ffe8ef", "#fff7f9"], "panel": "#ffffff", "ink": "#3a1424", "accent": "#b3305e", "mascot": "#f06a95", "decor": "<path d=\"M0 140 Q128 128 256 140 V170 H0Z\" fill=\"#f6c9d6\"/><path d=\"M200 170 L204 108 Q208 96 220 90\" stroke=\"#6a3a2a\" stroke-width=\"4\" fill=\"none\"/><g fill=\"#ff9ab8\"><circle cx=\"214\" cy=\"86\" r=\"14\"/><circle cx=\"232\" cy=\"96\" r=\"11\"/><circle cx=\"196\" cy=\"98\" r=\"10\"/></g><g fill=\"#ffc2d4\"><circle cx=\"60\" cy=\"40\" r=\"2\"/><circle cx=\"100\" cy=\"60\" r=\"2\"/><circle cx=\"150\" cy=\"34\" r=\"2\"/></g>"}, "minuit": {"name": "Minuit", "dark": true, "sky": ["#05060f", "#10142a"], "panel": "#11152b", "ink": "#e6eaff", "accent": "#7aa2ff", "mascot": "#5b7bff", "decor": "<circle cx=\"206\" cy=\"34\" r=\"14\" fill=\"#e6eaff\" opacity=\".9\"/><circle cx=\"212\" cy=\"30\" r=\"12\" fill=\"#05060f\"/><path d=\"M0 148 L60 136 L120 146 L180 132 L256 144 V170 H0Z\" fill=\"#0b0e20\"/>"}, "gel": {"name": "Gel (0° et moins)", "dark": false, "sky": ["#e8f1fb", "#f7fbff"], "panel": "#ffffff", "ink": "#122a40", "accent": "#2b5f9e", "mascot": "#7fb2e8", "decor": "<path d=\"M0 138 Q64 128 128 138 T256 134 V170 H0Z\" fill=\"#dcebfa\"/><g stroke=\"#9cc3ea\" stroke-width=\"1.6\" stroke-linecap=\"round\" opacity=\".9\"><path d=\"M40 30 v20 M30 40 h20 M33 33 l14 14 M47 33 l-14 14\"/><path d=\"M200 50 v16 M192 58 h16 M194 52 l12 12 M206 52 l-12 12\"/><path d=\"M120 20 v12 M114 26 h12\"/></g><path d=\"M20 170 L28 140 L36 170Z M210 170 L220 132 L230 170Z\" fill=\"#cfe3f7\"/>"}, "froid": {"name": "Froid (1° à 9°)", "dark": true, "sky": ["#1a2a40", "#2c4466"], "panel": "#1d2d45", "ink": "#e9f2ff", "accent": "#8cc4ff", "mascot": "#6aa8ee", "decor": "<path d=\"M0 130 L60 98 L110 124 L170 92 L256 120 V170 H0Z\" fill=\"#34507a\"/><path d=\"M60 98 L72 106 L84 100 L110 124Z M170 92 L184 102 L196 96 L230 112Z\" fill=\"#e9f2ff\" opacity=\".85\"/><g fill=\"#fff\" opacity=\".7\"><circle cx=\"40\" cy=\"30\" r=\"1.6\"/><circle cx=\"90\" cy=\"50\" r=\"1.2\"/><circle cx=\"150\" cy=\"26\" r=\"1.6\"/><circle cx=\"220\" cy=\"44\" r=\"1.2\"/></g>"}, "frais": {"name": "Frais (10° à 17°)", "dark": false, "sky": ["#e2eef0", "#f3f8f6"], "panel": "#ffffff", "ink": "#16302c", "accent": "#2c6e66", "mascot": "#4f9a8f", "decor": "<path d=\"M0 128 Q70 112 140 126 T256 120 V170 H0Z\" fill=\"#a9cfc4\"/><g fill=\"#c98a3a\" opacity=\".8\"><path d=\"M60 60 q6 -6 12 0 q-6 6 -12 0Z\"/><path d=\"M140 44 q6 -6 12 0 q-6 6 -12 0Z\"/><path d=\"M200 74 q6 -6 12 0 q-6 6 -12 0Z\"/></g><path d=\"M20 30 Q60 20 100 30 T180 28\" stroke=\"#ffffff\" stroke-width=\"3\" fill=\"none\" opacity=\".7\"/>"}, "chaud": {"name": "Chaud (28° à 31°)", "dark": false, "sky": ["#fff1cf", "#fff9ea"], "panel": "#fffdf6", "ink": "#3a2a08", "accent": "#a05a00", "mascot": "#f2a516", "decor": "<circle cx=\"204\" cy=\"40\" r=\"24\" fill=\"#ffc94d\"/><g stroke=\"#ffc94d\" stroke-width=\"3\" stroke-linecap=\"round\"><path d=\"M204 6 v8 M204 66 v8 M170 40 h8 M230 40 h8\"/></g><path d=\"M0 134 Q80 122 160 132 T256 128 V170 H0Z\" fill=\"#f3d28a\"/>"}, "torride": {"name": "Torride (32° à 35°)", "dark": false, "sky": ["#ffd9b0", "#fff0dc"], "panel": "#fffaf3", "ink": "#3a1a06", "accent": "#b43a0a", "mascot": "#ff7a22", "decor": "<circle cx=\"128\" cy=\"46\" r=\"28\" fill=\"#ff9a3a\"/><path d=\"M0 140 Q64 128 128 140 T256 136 V170 H0Z\" fill=\"#e8b070\"/><g stroke=\"#ffb36b\" stroke-width=\"2\" fill=\"none\" opacity=\".7\"><path d=\"M30 110 q8 -6 16 0 t16 0 t16 0\"/><path d=\"M170 104 q8 -6 16 0 t16 0 t16 0\"/></g>"}, "canicule": {"name": "Canicule (36° et plus)", "dark": true, "sky": ["#4a1206", "#8a2a0a"], "panel": "#3a140a", "ink": "#fff0e4", "accent": "#ffb03a", "mascot": "#ff4d1a", "decor": "<circle cx=\"128\" cy=\"52\" r=\"34\" fill=\"#ff6a1a\" opacity=\".95\"/><circle cx=\"128\" cy=\"52\" r=\"46\" fill=\"#ff6a1a\" opacity=\".2\"/><path d=\"M0 142 Q64 132 128 142 T256 138 V170 H0Z\" fill=\"#5a1a08\"/><g stroke=\"#ffb03a\" stroke-width=\"2\" fill=\"none\" opacity=\".6\"><path d=\"M20 118 q8 -6 16 0 t16 0 t16 0\"/><path d=\"M180 112 q8 -6 16 0 t16 0 t16 0\"/></g>"}, "valhalla": {"name": "Valhalla (classique)", "dark": true, "sky": null, "panel": null, "ink": null, "accent": null, "mascot": null, "decor": ""}};
  const ORDER = Object.keys(THEMES);
  // Les thèmes des événements de l'année : ils s'activent tout seuls le jour de l'événement (sauf si tu les coupes).
  const EVENT_THEMES = {
    'ev-noel': { name: 'Noël', dark: true, sky: ['#0f2a1c', '#1c3f2a'], panel: '#173a26', ink: '#eaf7ec', accent: '#e04848', mascot: '#2f8f4e', decor: '<g fill="#fff" opacity=".9"><circle cx="30" cy="20" r="1.6"/><circle cx="70" cy="44" r="1.2"/><circle cx="120" cy="16" r="1.8"/><circle cx="160" cy="50" r="1.3"/><circle cx="210" cy="24" r="1.6"/><circle cx="240" cy="60" r="1.2"/><circle cx="96" cy="70" r="1.2"/></g><path d="M196 140 L214 92 L232 140Z M200 112 L214 76 L228 112Z M204 90 L214 62 L224 90Z" fill="#2f8f4e"/><path d="M214 52 l3 7 7 1 -5 5 1 7 -6 -4 -6 4 1 -7 -5 -5 7 -1Z" fill="#ffd36a"/><g fill="#e04848"><circle cx="208" cy="104" r="2.5"/><circle cx="222" cy="124" r="2.5"/></g><g fill="#ffd36a"><circle cx="218" cy="98" r="2"/><circle cx="206" cy="128" r="2"/></g><path d="M0 146 Q70 132 140 144 T256 140 V170 H0Z" fill="#f2f7f2"/>' },
    'ev-nouvelan': { name: 'Nouvel An', dark: true, sky: ['#0b1030', '#241a4a'], panel: '#171a3d', ink: '#f2eeff', accent: '#ffd36a', mascot: '#ffd36a', decor: '<g stroke-width="2" stroke-linecap="round"><g stroke="#ffd36a"><path d="M60 40 v-12 M60 40 l10 -8 M60 40 l12 0 M60 40 l10 8 M60 40 v12 M60 40 l-10 8 M60 40 h-12 M60 40 l-10 -8"/></g><g stroke="#ff6ad5"><path d="M190 60 v-10 M190 60 l8 -6 M190 60 h10 M190 60 l8 6 M190 60 v10 M190 60 l-8 6 M190 60 h-10 M190 60 l-8 -6"/></g><g stroke="#4aa8ff"><path d="M130 26 v-8 M130 26 l6 -5 M130 26 h8 M130 26 l6 5 M130 26 v8 M130 26 l-6 5 M130 26 h-8 M130 26 l-6 -5"/></g></g><path d="M0 146 L40 130 L80 140 L130 120 L180 138 L256 126 V170 H0Z" fill="#0b0f26"/>' },
    'ev-carnaval': { name: 'Carnaval', dark: false, sky: ['#ffe6f2', '#fff4d6'], panel: '#ffffff', ink: '#3a1030', accent: '#c2187a', mascot: '#ff9a2a', decor: '<g><rect x="20" y="20" width="6" height="10" fill="#ff4a4a" transform="rotate(20 23 25)"/><rect x="70" y="50" width="6" height="10" fill="#4aa8ff" transform="rotate(-30 73 55)"/><rect x="120" y="24" width="6" height="10" fill="#ffe14a" transform="rotate(40 123 29)"/><rect x="170" y="60" width="6" height="10" fill="#4adf6a" transform="rotate(-10 173 65)"/><rect x="220" y="30" width="6" height="10" fill="#9a6bff" transform="rotate(25 223 35)"/><rect x="45" y="90" width="6" height="10" fill="#ff6ad5" transform="rotate(-35 48 95)"/><rect x="200" y="96" width="6" height="10" fill="#ff9a2a" transform="rotate(15 203 101)"/></g><path d="M0 10 Q30 30 60 10 T120 10 T180 10 T256 10" stroke="#c2187a" stroke-width="3" fill="none"/><path d="M100 120 q28 -20 56 0 q-6 18 -28 14 q-22 4 -28 -14Z" fill="#9a6bff"/><circle cx="116" cy="122" r="5" fill="#fff4d6"/><circle cx="140" cy="122" r="5" fill="#fff4d6"/>' },
    'ev-paques': { name: 'Pâques', dark: false, sky: ['#cfe9ff', '#f2fbe9'], panel: '#ffffff', ink: '#2f2a1f', accent: '#8a4b2a', mascot: '#7a4527', decor: '<g fill="#fff"><ellipse cx="54" cy="30" rx="22" ry="7" opacity=".95"/><ellipse cx="66" cy="25" rx="13" ry="6"/><ellipse cx="200" cy="40" rx="26" ry="8" opacity=".95"/><ellipse cx="214" cy="35" rx="14" ry="6"/></g><path d="M0 118 Q50 106 110 116 T210 112 T256 110 V170 H0Z" fill="#a7dc8e"/><path d="M0 134 Q66 124 136 133 T256 130 V170 H0Z" fill="#7cc46b"/><path d="M0 152 Q80 144 156 152 T256 150 V170 H0Z" fill="#5aa951"/><g transform="translate(64 124) scale(.17)"><path d="M0 -40 C22 -40 34 -10 34 10 C34 30 19 42 0 42 C-19 42 -34 30 -34 10 C-34 -10 -22 -40 0 -40Z" fill="#6c381c"/><rect x="-34" y="6" width="68" height="9" fill="#7cc8f5"/><ellipse cx="-14" cy="-18" rx="7" ry="14" fill="#fff" opacity=".22" transform="rotate(22 -14 -18)"/><path d="M0 10 C-10 0 -20 6 -16 14 C-12 20 -4 14 0 10Z M0 10 C10 0 20 6 16 14 C12 20 4 14 0 10Z" fill="#9fdcff" stroke="#3f97cf"/><circle cy="10" r="3.4" fill="#3f97cf"/></g><g transform="translate(196 130) scale(.13)"><path d="M0 -40 C22 -40 34 -10 34 10 C34 30 19 42 0 42 C-19 42 -34 30 -34 10 C-34 -10 -22 -40 0 -40Z" fill="#6c381c"/><rect x="-34" y="6" width="68" height="9" fill="#7cc8f5"/><ellipse cx="-14" cy="-18" rx="7" ry="14" fill="#fff" opacity=".22" transform="rotate(22 -14 -18)"/><path d="M0 10 C-10 0 -20 6 -16 14 C-12 20 -4 14 0 10Z M0 10 C10 0 20 6 16 14 C12 20 4 14 0 10Z" fill="#9fdcff" stroke="#3f97cf"/><circle cy="10" r="3.4" fill="#3f97cf"/></g><g transform="translate(90 144)"><circle cx="0" cy="-1.1" r="1.1" fill="#9fdcff"/><circle cx="1.1" cy="0" r="1.1" fill="#9fdcff"/><circle cx="0" cy="1.1" r="1.1" fill="#9fdcff"/><circle cx="-1.1" cy="0" r="1.1" fill="#9fdcff"/><circle r=".7" fill="#ffcf5a"/></g><g transform="translate(174 141)"><circle cx="0" cy="-1.1" r="1.1" fill="#ffffff"/><circle cx="1.1" cy="0" r="1.1" fill="#ffffff"/><circle cx="0" cy="1.1" r="1.1" fill="#ffffff"/><circle cx="-1.1" cy="0" r="1.1" fill="#ffffff"/><circle r=".7" fill="#ffcf5a"/></g><g transform="translate(218 157)"><circle cx="0" cy="-1.1" r="1.1" fill="#ffffff"/><circle cx="1.1" cy="0" r="1.1" fill="#ffffff"/><circle cx="0" cy="1.1" r="1.1" fill="#ffffff"/><circle cx="-1.1" cy="0" r="1.1" fill="#ffffff"/><circle r=".7" fill="#ffcf5a"/></g><g transform="translate(101 158)"><circle cx="0" cy="-1.1" r="1.1" fill="#ffffff"/><circle cx="1.1" cy="0" r="1.1" fill="#ffffff"/><circle cx="0" cy="1.1" r="1.1" fill="#ffffff"/><circle cx="-1.1" cy="0" r="1.1" fill="#ffffff"/><circle r=".7" fill="#ffcf5a"/></g><g transform="translate(240 156)"><circle cx="0" cy="-1.1" r="1.1" fill="#ffd3df"/><circle cx="1.1" cy="0" r="1.1" fill="#ffd3df"/><circle cx="0" cy="1.1" r="1.1" fill="#ffd3df"/><circle cx="-1.1" cy="0" r="1.1" fill="#ffd3df"/><circle r=".7" fill="#ffcf5a"/></g><g transform="translate(17 142)"><circle cx="0" cy="-1.1" r="1.1" fill="#9fdcff"/><circle cx="1.1" cy="0" r="1.1" fill="#9fdcff"/><circle cx="0" cy="1.1" r="1.1" fill="#9fdcff"/><circle cx="-1.1" cy="0" r="1.1" fill="#9fdcff"/><circle r=".7" fill="#ffcf5a"/></g><g transform="translate(115 142)"><circle cx="0" cy="-1.1" r="1.1" fill="#ffd3df"/><circle cx="1.1" cy="0" r="1.1" fill="#ffd3df"/><circle cx="0" cy="1.1" r="1.1" fill="#ffd3df"/><circle cx="-1.1" cy="0" r="1.1" fill="#ffd3df"/><circle r=".7" fill="#ffcf5a"/></g><g transform="translate(31 157)"><circle cx="0" cy="-1.1" r="1.1" fill="#9fdcff"/><circle cx="1.1" cy="0" r="1.1" fill="#9fdcff"/><circle cx="0" cy="1.1" r="1.1" fill="#9fdcff"/><circle cx="-1.1" cy="0" r="1.1" fill="#9fdcff"/><circle r=".7" fill="#ffcf5a"/></g><g transform="translate(23 158)"><circle cx="0" cy="-1.1" r="1.1" fill="#ffffff"/><circle cx="1.1" cy="0" r="1.1" fill="#ffffff"/><circle cx="0" cy="1.1" r="1.1" fill="#ffffff"/><circle cx="-1.1" cy="0" r="1.1" fill="#ffffff"/><circle r=".7" fill="#ffcf5a"/></g>' },
    'ev-abolition': { name: '27 avril', dark: false, sky: ['#e6f7ee', '#fdf8e8'], panel: '#ffffff', ink: '#16351f', accent: '#1d7f4a', mascot: '#34c77b', decor: '<circle cx="128" cy="120" r="34" fill="#ffd56b" opacity=".9"/><path d="M0 128 Q64 120 128 128 T256 126 V170 H0Z" fill="#1fb4b0"/><g fill="none" stroke="#5a6070" stroke-width="5"><ellipse cx="60" cy="60" rx="10" ry="6"/><ellipse cx="80" cy="56" rx="10" ry="6" transform="rotate(-20 80 56)"/></g><g fill="none" stroke="#5a6070" stroke-width="5"><ellipse cx="190" cy="60" rx="10" ry="6" transform="rotate(20 190 60)"/></g>' },
    'ev-travail': { name: '1er mai', dark: false, sky: ['#eef0f3', '#f8f9fb'], panel: '#ffffff', ink: '#1f232a', accent: '#3a3f4b', mascot: '#2a2f3a', decor: '<path d="M0 146 Q90 134 180 144 T256 140 V170 H0Z" fill="#9ed49a"/><path d="M200 146 Q196 110 206 80" stroke="#3f8f4a" stroke-width="3" fill="none"/><path d="M204 96 q-26 -10 -26 -40 q20 10 26 40Z" fill="#4fae5a"/><g fill="#fff" stroke="#c9ced8"><circle cx="212" cy="88" r="5"/><circle cx="216" cy="100" r="5"/><circle cx="212" cy="112" r="5"/></g>' },
    'ev-musique': { name: 'Fête de la musique', dark: true, sky: ['#1a1440', '#2b1f5c'], panel: '#211a4a', ink: '#efeaff', accent: '#9aa8ff', mascot: '#5a6fdb', decor: '<g fill="#9aa8ff"><path d="M60 40 v30 a8 6 0 1 1 -4 -5 V40 h20 v24 a8 6 0 1 1 -4 -5 V46 H60Z"/><path d="M190 60 v26 a7 5 0 1 1 -4 -4 V60 l14 -4 v6Z"/></g><path d="M0 130 Q32 110 64 130 T128 130 T192 130 T256 130" stroke="#ff6ad5" stroke-width="3" fill="none"/><path d="M0 142 Q32 126 64 142 T128 142 T192 142 T256 142" stroke="#4aa8ff" stroke-width="3" fill="none"/>' },
    'ev-nationale': { name: '14 juillet', dark: true, sky: ['#0e1a3a', '#1d2c5c'], panel: '#16234a', ink: '#eef2ff', accent: '#ef4f43', mascot: '#3d6fe0', decor: '<g stroke-width="2.4" stroke-linecap="round"><g stroke="#3d6fe0"><path d="M60 50 v-14 M60 50 l12 -9 M60 50 h14 M60 50 l12 9 M60 50 v14 M60 50 l-12 9 M60 50 h-14 M60 50 l-12 -9"/></g><g stroke="#fff"><path d="M128 34 v-10 M128 34 l8 -6 M128 34 h10 M128 34 l8 6 M128 34 v10 M128 34 l-8 6 M128 34 h-10 M128 34 l-8 -6"/></g><g stroke="#ef4f43"><path d="M196 56 v-14 M196 56 l12 -9 M196 56 h14 M196 56 l12 9 M196 56 v14 M196 56 l-12 9 M196 56 h-14 M196 56 l-12 -9"/></g></g><path d="M0 148 L256 148 V170 H0Z" fill="#0b1430"/>' },
    'ev-ramadan': { name: 'Ramadan', dark: true, sky: ['#0d1630', '#1c2a52'], panel: '#152145', ink: '#eef2ff', accent: '#ffd36a', mascot: '#f2f2f2', decor: '<path d="M206 22 a18 18 0 1 0 18 22 a14 14 0 1 1 -18 -22Z" fill="#ffe9a0"/><g fill="#fff" opacity=".8"><circle cx="40" cy="30" r="1.4"/><circle cx="90" cy="16" r="1.2"/><circle cx="150" cy="40" r="1.6"/><circle cx="60" cy="70" r="1.1"/></g><g><path d="M70 40 v18" stroke="#ffd36a"/><path d="M62 58 h16 l-3 22 h-10Z" fill="#ffb84a" opacity=".9"/><path d="M130 30 v24" stroke="#ffd36a"/><path d="M122 54 h16 l-3 22 h-10Z" fill="#ffd36a" opacity=".9"/></g><path d="M0 140 L40 140 L40 116 Q56 96 72 116 L72 140 L180 140 L180 110 Q200 84 220 110 L220 140 L256 140 V170 H0Z" fill="#0a1128"/>' },
    'ev-aidfitr': { name: 'Aïd el-Fitr', dark: true, sky: ['#0f2a24', '#1a4038'], panel: '#173a32', ink: '#eafff7', accent: '#ffd36a', mascot: '#34c77b', decor: '<path d="M206 22 a18 18 0 1 0 18 22 a14 14 0 1 1 -18 -22Z" fill="#ffe9a0"/><g><path d="M60 30 v20" stroke="#ffd36a"/><path d="M52 50 h16 l-3 22 h-10Z" fill="#ffd36a"/><path d="M110 20 v26" stroke="#ffd36a"/><path d="M102 46 h16 l-3 22 h-10Z" fill="#ffb84a"/><path d="M160 34 v18" stroke="#ffd36a"/><path d="M152 52 h16 l-3 22 h-10Z" fill="#ffd36a"/></g><path d="M0 144 Q80 130 160 142 T256 138 V170 H0Z" fill="#0d2420"/>' },
    'ev-aidkebir': { name: 'Aïd el-Kébir', dark: true, sky: ['#0f2a2a', '#18403f'], panel: '#163838', ink: '#eafffe', accent: '#ffd36a', mascot: '#0fa3a0', decor: '<path d="M206 22 a18 18 0 1 0 18 22 a14 14 0 1 1 -18 -22Z" fill="#ffe9a0"/><g fill="#fff" opacity=".8"><circle cx="40" cy="30" r="1.4"/><circle cx="120" cy="20" r="1.2"/><circle cx="160" cy="54" r="1.6"/></g><path d="M0 140 L60 140 L60 112 Q80 88 100 112 L100 140 L256 140 V170 H0Z" fill="#0b2222"/>' },
    'ev-valentin': { name: 'Saint-Valentin', dark: false, sky: ['#ffe3ea', '#fff5f8'], panel: '#ffffff', ink: '#3a0f1c', accent: '#c8233f', mascot: '#ef4f43', decor: '<g fill="#ff8aa8"><path d="M40 40 c-6 -8 -18 -4 -16 6 c2 7 16 15 16 15 s14 -8 16 -15 c2 -10 -10 -14 -16 -6z"/><path d="M200 70 c-5 -7 -15 -3 -13 5 c1 6 13 12 13 12 s12 -6 13 -12 c2 -8 -8 -12 -13 -5z" fill="#ef4f43"/><path d="M130 24 c-4 -5 -11 -2 -10 4 c1 4 10 9 10 9 s9 -5 10 -9 c1 -6 -6 -9 -10 -4z"/><path d="M90 110 c-4 -6 -13 -3 -12 5 c1 5 12 11 12 11 s11 -6 12 -11 c1 -8 -8 -11 -12 -5z" fill="#ffb3c6"/></g>' },
    'ev-patrick': { name: 'Saint-Patrick', dark: false, sky: ['#e3f7e6', '#f4fff2'], panel: '#ffffff', ink: '#123a1c', accent: '#1d7f3a', mascot: '#34c77b', decor: '<g fill="#34c77b"><circle cx="50" cy="40" r="7"/><circle cx="60" cy="40" r="7"/><circle cx="55" cy="31" r="7"/><path d="M55 44 l3 14" stroke="#1d7f3a" stroke-width="2"/><circle cx="196" cy="70" r="6"/><circle cx="205" cy="70" r="6"/><circle cx="200" cy="62" r="6"/></g><path d="M0 140 Q80 124 160 138 T256 132 V170 H0Z" fill="#5fbf6a"/>' },
    'ev-halloween': { name: 'Halloween', dark: true, sky: ['#1a0f24', '#2e1838'], panel: '#24142e', ink: '#fff0e0', accent: '#ff8a1a', mascot: '#ff7a1a', decor: '<circle cx="200" cy="40" r="22" fill="#ffe9b0"/><g fill="#0b0610"><path d="M60 40 q8 -8 16 0 q8 -8 16 0 q-8 2 -16 10 q-8 -8 -16 -10Z"/><path d="M140 26 q6 -6 12 0 q6 -6 12 0 q-6 2 -12 8 q-6 -6 -12 -8Z"/></g><g><ellipse cx="60" cy="134" rx="18" ry="14" fill="#ff7a1a"/><path d="M60 120 v-6" stroke="#2f8f4e" stroke-width="3"/><path d="M52 132 l4 -4 4 4 M64 132 l4 -4 4 4 M52 140 q8 6 16 0" stroke="#1a0f24" stroke-width="2" fill="none"/><ellipse cx="190" cy="138" rx="14" ry="11" fill="#ff8a1a"/></g><path d="M0 150 L256 150 V170 H0Z" fill="#120a18"/>' },
    'ev-thanksgiving': { name: 'Thanksgiving', dark: false, sky: ['#f5e1c4', '#fbefdc'], panel: '#fff8ee', ink: '#3a2410', accent: '#a8521a', mascot: '#b08a5a', decor: '<g fill="#e07a2e"><path d="M40 40 q10 -14 20 0 q-10 14 -20 0Z"/><path d="M200 60 q10 -14 20 0 q-10 14 -20 0Z" fill="#c9502a"/><path d="M120 90 q10 -14 20 0 q-10 14 -20 0Z" fill="#f2a93b"/></g><path d="M0 146 Q90 134 180 144 T256 140 V170 H0Z" fill="#8a4a24"/>' },
    'ev-anniversaire': { name: 'Anniversaire', dark: false, sky: ['#fff0f8', '#f3f0ff'], panel: '#ffffff', ink: '#2a1438', accent: '#c2187a', mascot: '#ff6ad5', decor: '<g><ellipse cx="50" cy="50" rx="14" ry="18" fill="#ff6ad5"/><path d="M50 68 q-4 20 4 40" stroke="#9aa1b2" fill="none"/><ellipse cx="80" cy="40" rx="12" ry="16" fill="#4aa8ff"/><path d="M80 56 q4 20 -4 40" stroke="#9aa1b2" fill="none"/><ellipse cx="206" cy="46" rx="13" ry="17" fill="#ffd36a"/><path d="M206 63 q-4 20 4 40" stroke="#9aa1b2" fill="none"/></g><g><rect x="120" y="20" width="5" height="8" fill="#4adf6a" transform="rotate(20 122 24)"/><rect x="160" y="40" width="5" height="8" fill="#ff4a4a" transform="rotate(-30 162 44)"/><rect x="140" y="70" width="5" height="8" fill="#9a6bff" transform="rotate(40 142 74)"/></g>' },
  };
  Object.assign(THEMES, EVENT_THEMES);

  // Les thèmes « Mis en avant » de la maquette validée (src/web/pages/themes-catalogue.js, chargé juste avant ce
  // fichier ; sans lui, rien ne change). Pour l'instant à plat : la règle de couleurs d'Odin (palette) est nourrie par
  // le fond (la première et la dernière couleur de la dernière couche du fond de la maquette, deux fois la même pour
  // une couleur unie), la carte pleine, le texte, l'accent, la couleur d'Odin et le ton. Un thème qui existait déjà
  // (glace) garde son identifiant et son décor. Les thèmes de Hestia (h-…) suivent la même règle et gardent le décor
  // dessiné de l'écran de la maison (dans son cadre à lui, `vue`).
  const EN_AVANT = [], HESTIA = [];
  const derniereCouche = (bg) => { let prof = 0, debut = 0; for (let i = 0; i < bg.length; i++) { const c = bg[i]; if (c === '(') prof++; else if (c === ')') prof--; else if (c === ',' && prof === 0) debut = i + 1; } return bg.slice(debut); };
  const catalogue = window.OdinCatalogueThemes;
  if (catalogue && catalogue.THEMES) {
    for (const [id, v] of Object.entries(catalogue.THEMES)) {
      const fond = typeof v.bg === 'string' ? derniereCouche(v.bg).match(/#[0-9a-fA-F]{6}\b/g) : null;
      if (!fond || !v.solid || !v.ink || !v.accent || !v.mascot) continue;
      const hestia = id.startsWith('h-'), dessin = hestia ? catalogue.DECORS?.[catalogue.HESTIA?.[id.slice(2)]?.decor] : THEMES[id]?.decor;
      const texte = catalogue.ACCENT_TEXTE?.[id];
      THEMES[id] = { name: catalogue.NOMS?.[id] || id, dark: v.dark === true, sky: [fond[0], fond[fond.length - 1]], panel: v.solid, ink: v.ink, accent: v.accent, ...(typeof texte === 'string' ? { accentTexte: texte } : {}), mascot: v.mascot, ...(dessin ? { decor: dessin } : {}), ...(dessin && hestia ? { vue: '0 -30 960 150' } : {}) };
      (hestia ? HESTIA : EN_AVANT).push(id);
    }
  }

  // Les familles de thèmes, dans l'ordre de Réglages → Apparence : les « Mis en avant » (s'il y en a), les thèmes
  // d'Odin (ORDER, sans ceux déjà mis en avant), les thèmes de Hestia (s'il y en a), puis les 16 des événements de
  // l'année. Pur : rend une copie neuve à chaque appel (ORDER ne bouge pas).
  const familles = () => [
    ...(EN_AVANT.length ? [{ id: 'enavant', titre: TEXTES.familles.enavant, ids: [...EN_AVANT] }] : []),
    { id: 'odin', titre: TEXTES.familles.odin, ids: ORDER.filter((id) => !EN_AVANT.includes(id)) },
    ...(HESTIA.length ? [{ id: 'hestia', titre: TEXTES.familles.hestia, ids: [...HESTIA] }] : []),
    { id: 'evenements', titre: TEXTES.familles.evenements, ids: Object.keys(EVENT_THEMES) },
  ];
  window.OdinThemes = { THEMES, ORDER, EVENT_THEMES, familles };
  // Le nom d'un thème dans la ligne d'état : un thème de Hestia dit aussi sa famille.
  const nomAffiche = (id) => (!THEMES[id] ? id : HESTIA.includes(id) ? TEXTES.nomEtFamille.replace('{nom}', THEMES[id].name).replace('{famille}', TEXTES.familles.hestia) : THEMES[id].name);
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (c) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, k) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v * (1 - k) + y[i] * k)); };
  const lum = (h) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /** Toutes les couleurs de l'interface d'un thème, tirées de 4 couleurs (fond, panneau, texte, accent). */
  function palette(t) {
    const bg = mix(t.sky[0], t.sky[1], 0.5), p = t.panel, ink = t.ink, a = t.accent;
    const onAccent = contrast('#ffffff', a) >= contrast('#111111', a) ? '#ffffff' : '#111111';
    return {
      '--bg': bg, '--panel': p, '--panel2': mix(p, bg, t.dark ? 0.35 : 0.45), '--line': mix(p, ink, 0.14), '--ink': ink,
      '--muted': mix(ink, p, 0.28), '--dim': mix(ink, p, 0.36), '--accent': a,
      // Le texte en accent (liens, anneau du thème choisi) : une teinte plus foncée si le thème en a une, sinon l'accent.
      '--accent-texte': t.accentTexte || a, '--accent-2': t.dark ? mix(a, '#ffffff', 0.18) : mix(a, '#000000', 0.15),
      '--on-accent': onAccent, '--field': mix(p, ink, 0.24), '--field-h': mix(p, ink, 0.34), '--hover': mix(p, ink, 0.06), '--sel': mix(p, a, 0.16),
      '--user': mix(p, a, 0.12), '--user-l': mix(p, a, 0.35), '--off': mix(ink, p, 0.55),
      // Couleurs d'état (vert, ambre, rouge) : celles d'Odin en sombre ou en clair, posées sur le panneau du thème.
      ...(t.dark
        ? { '--good': '#6CCFB8', '--warn': '#F0B860', '--bad': '#EE8A70', '--good-l': mix(p, '#6CCFB8', 0.35), '--warn-l': mix(p, '#F0B860', 0.35), '--warn-bg': mix(p, '#F0B860', 0.08), '--bad-l': mix(p, '#EE8A70', 0.35), '--bad-bg': mix(p, '#EE8A70', 0.08), '--bad-l2': mix(p, '#EE8A70', 0.25) }
        : { '--good': '#1D7F68', '--warn': '#8F6200', '--bad': '#B23F2A', '--good-l': mix(p, '#1D7F68', 0.35), '--warn-l': mix(p, '#C98A14', 0.45), '--warn-bg': mix(p, '#F0B860', 0.12), '--bad-l': mix(p, '#B23F2A', 0.35), '--bad-bg': mix(p, '#EE8A70', 0.1), '--bad-l2': mix(p, '#B23F2A', 0.35) }),
    };
  }
  window.OdinThemes.palette = palette; window.OdinThemes.contrast = contrast;
  const decorUri = (t) => (t.decor ? `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${t.vue || '0 0 256 170'}' preserveAspectRatio='xMidYMax slice'>${t.decor}</svg>`)}")` : 'none');
  // Le verre des cartes de l'accueil (maquette validée ; choix du propriétaire du 23/11 : le verre sur l'accueil et
  // l'écran de la maison seulement, fond uni ailleurs ; sa décision du 25/11 : « Décor derrière, verre plus opaque », le
  // décor du thème derrière l'accueil et des cartes assez opaques pour que chaque texte reste lisible). Un thème du
  // catalogue garde ses champs de verre ; un thème d'Odin suit la règle de la maquette : sombre, verre 22 sur son
  // panneau ; clair, 40 sur du blanc. La carte elle-même vient de la règle de la maquette (surfaceOf, dans le
  // catalogue) ; sans elle, rien. Des variables à nom neuf (--v-…), pour ne heurter aucune couleur de l'interface.
  const rgbaDe = (h, a) => `rgba(${hex(h).join(',')},${a})`;
  function varsVerre(id, t, pal) {
    if (typeof catalogue?.surfaceOf !== 'function') return null;
    const c = catalogue.THEMES?.[id];
    const v = c && c.sc ? c : {
      dark: t.dark === true, sc: t.dark ? t.panel : '#ffffff', gt: t.dark ? 22 : 40, blur0: 20, sheen: t.dark ? 0.1 : 0.45, sat: 1.4,
      solid: t.dark ? t.panel : mix('#ffffff', t.sky[0], 0.12), border: t.dark ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.85)',
      shadow: t.dark ? '0 14px 34px rgba(0,0,0,.3)' : `0 10px 28px ${rgbaDe(t.ink, 0.1)},inset 0 1px 0 rgba(255,255,255,.9)`,
    };
    // Un fond ou un décor trop clair (ou trop sombre) sous un verre trop transparent : la carte devient plus opaque, juste
    // assez pour que chaque texte du thème s'y lise (4,5:1) au pire point du décor (deux formes translucides l'une sur
    // l'autre comprises) : une couche de sa couleur pleine passe sous le verre, de 5 % en 5 %, jusqu'à la carte pleine
    // s'il le faut (un verre blanc sous un texte clair va ainsi vers sa couleur pleine, sombre, et non vers le blanc). Le
    // flou et le reflet restent ceux de son départ ; les thèmes déjà lisibles gardent leur départ. Le texte du thème est
    // tel quel ; les autres tons comptent tels que tonsVerre les éloigne déjà sans le décor (verre de départ sur le
    // dégradé, carte pleine, couleur pleine) : c'est le décor que l'opacité compense, pas un ton de plus.
    // Le reflet compte tel que la page le pose (arrondi), pour que l'opacité et les tons (tonsVerre) lisent le même.
    const sat = v.sat ?? 1.4, dessous = derriere(t, sat), plein = hex6(v.solid) || t.panel;
    const depart = catalogue.surfaceOf(v, Math.max(0, Math.min(100, Number(v.gt) || 0))), reflet = +(depart.sheen ?? 0.3).toFixed(3);
    const sansDecor = trier(fondsVerre(derriere({ ...t, decor: '' }, sat), depart.surface, reflet), fondsVerre(dessous, surCouche(depart.surface, plein, 1), reflet), [lumVue(plein)]);
    const textes = [t.ink, ...TEXTES_VERRE.map((n) => pal[n]).filter((c) => /^#[0-9a-f]{6}$/i.test(c || '')).map((c) => eloigner(c, sansDecor, versTon(t)))];
    const lisible = (surface) => { const f = trier(fondsVerre(dessous, surface, reflet)); return textes.every((c) => pireContraste(c, f) >= 4.6); };
    let surface = depart.surface;
    for (let p = 5; p <= 100 && !lisible(surface); p += 5) surface = surCouche(depart.surface, plein, p / 100);
    const s = { ...depart, surface };
    return {
      '--v-carte': s.surface, '--v-plein': s.solid, '--v-bord': s.border, '--v-flou': `${s.blur}px`, '--v-sat': sat,
      '--v-reflet': reflet, '--v-ombre': v.shadow && v.shadow !== 'none' ? v.shadow : '0 0 0 transparent',
    };
  }
  // Le verre posé sur une couche de la couleur pleine d'opacité p (0 à 1) : chaque bout du dégradé devient ce que l'on
  // voit à travers les deux, en une seule couleur plus opaque. À 1, c'est le verre sur la couleur pleine.
  const surCouche = (surface, plein, p) => String(surface).replace(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/g, (m, r, v, b, a) => {
    const x = +a, tot = x + (1 - x) * p, f = hex(plein);
    return `rgba(${[+r, +v, +b].map((c, i) => Math.round((x * c + (1 - x) * p * f[i]) / (tot || 1))).join(',')},${+tot.toFixed(3)})`;
  });
  // Le fond de l'accueil est celui de la page : le dégradé du thème, le dessin du décor, et le même voile que derrière la
  // barre de côté. Ces calculs se font en nombres (de 0 à 255, arrondis comme la page les peint) : le pire point se
  // cherche parmi des centaines de couleurs, à chaque pas d'opacité.
  const NOIR = [0, 0, 0], BLANC = [255, 255, 255];
  const canal = (v) => Math.round(v < 0 ? 0 : v > 255 ? 255 : v);
  const melange = (x, y, k) => [canal(x[0] * (1 - k) + y[0] * k), canal(x[1] * (1 - k) + y[1] * k), canal(x[2] * (1 - k) + y[2] * k)];
  const voiler = (t, c) => (t.dark ? melange(c, NOIR, 0.18) : melange(c, BLANC, 0.22));
  // Les couleurs que le dessin du décor peut peindre, avec leur opacité (celle de la forme et de ses groupes) : le
  // remplissage et le trait de chaque forme. Un tracé sans remplissage dit, dans ces décors, est un trait sans surface.
  const hex6 = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : /^#[0-9a-f]{3}$/i.test(c || '') ? `#${[...c.slice(1)].map((x) => x + x).join('')}`.toLowerCase() : null);
  function couleursDecor(decor) {
    const out = [], pile = [{ op: 1 }];
    for (const [, fin, balise, attrs, seule] of String(decor || '').matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
      if (fin) { if (pile.length > 1) pile.pop(); continue; }
      const a = {}; for (const [, k, x] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) a[k] = x;
      const p = pile[pile.length - 1], e = { fill: a.fill ?? p.fill, stroke: a.stroke ?? p.stroke, op: p.op * (a.opacity === undefined ? 1 : Number(a.opacity)) };
      if (balise !== 'g') for (const [c, o] of [[e.fill, a['fill-opacity']], [e.stroke, a['stroke-opacity']]]) { const h = hex6(c); if (h) out.push([h, e.op * (o === undefined ? 1 : Number(o))]); }
      if (!seule) pile.push(e);
    }
    return out;
  }
  // saturate() des filtres CSS (la matrice de la norme), comme le verre le fait sur ce qu'il laisse voir.
  const saturer = ([r, g, b], s) => [(0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b, (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b, (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b].map((x) => Math.round(Math.max(0, Math.min(255, x))));
  // Tout ce qui peut se trouver derrière une carte de l'accueil, point par point : le dégradé à ses deux bouts, chaque
  // couleur du décor posée sur le dégradé ou sur une couleur pleine du décor, et deux formes translucides l'une sur
  // l'autre (deux bandes d'aurore qui se croisent : dans un ordre comme dans l'autre) ; le tout sous le voile, saturé par
  // le verre. Gardé par thème : le calcul de l'opacité et celui des tons lisent le même.
  const DERRIERE = new WeakMap();
  function derriere(t, sat) {
    const s = Number(sat) || 1, deja = DERRIERE.get(t)?.get(s); if (deja) return deja;
    const dessin = [...new Map(couleursDecor(t.decor).map(([c, a]) => [`${c}/${a}`, [hex(c), Math.max(0, Math.min(1, a))]])).values()];
    const translucides = dessin.filter(([, a]) => a < 0.99), vus = new Map();
    const voir = (c) => { const x = saturer(voiler(t, c), s); vus.set((x[0] << 16) | (x[1] << 8) | x[2], x); };
    const bases = new Map([...t.sky.map(hex), ...dessin.filter(([, a]) => a >= 0.99).map(([c]) => c)].map((c) => [c.join(), c]));
    t.sky.forEach((c) => voir(hex(c)));
    for (const u of bases.values()) for (const forme of dessin) {
      const x = melange(u, forme[0], forme[1]); voir(x);
      if (forme[1] < 0.99) for (const autre of translucides) if (autre !== forme) voir(melange(x, autre[0], autre[1]));
    }
    const out = [...vus.values()];
    if (!DERRIERE.has(t)) DERRIERE.set(t, new Map());
    DERRIERE.get(t).set(s, out);
    return out;
  }
  // Ce qui se voit à travers une carte en verre : chaque point possible du fond, vu par la carte à ses deux bouts, et le
  // reflet en haut ; gardé en luminances (le contraste ne dépend que d'elles).
  const LIN = Array.from({ length: 256 }, (_, v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const lumRGB = (c) => 0.2126 * LIN[c[0]] + 0.7152 * LIN[c[1]] + 0.0722 * LIN[c[2]];
  function fondsVerre(dessous, surface, reflet) {
    const bouts = [...String(surface).matchAll(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/g)].map((m) => [[+m[1], +m[2], +m[3]], +m[4]]), k = Math.min(1, Number(reflet) || 0), fonds = [];
    for (const f0 of dessous) bouts.forEach(([c, a], i) => { const f = melange(f0, c, a); fonds.push(lumRGB(f)); if (i === 0) fonds.push(lumRGB(melange(f, BLANC, k))); });
    return fonds;
  }
  // Le pire contraste d'une couleur sur des fonds : leurs luminances, triées une fois ; le pire est l'une des deux
  // voisines de la sienne (la plus proche au-dessous, la plus proche au-dessus). Celle de la couleur n'est calculée
  // qu'une fois.
  const trier = (...listes) => Float64Array.from(listes.flat()).sort();
  const LUM = new Map(), lumVue = (h) => { let x = LUM.get(h); if (x === undefined) { x = lum(h); LUM.set(h, x); } return x; };
  const pireContraste = (c, fonds) => {
    const a = lumVue(c); let bas = 0, haut = fonds.length, pire = 21;
    while (bas < haut) { const m = (bas + haut) >> 1; if (fonds[m] < a) bas = m + 1; else haut = m; }
    for (const b of [fonds[bas - 1], fonds[bas]]) if (b !== undefined) { const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); if (r < pire) pire = r; }
    return pire;
  };
  // Les autres textes posés dans le verre restent lisibles (4,5:1) : une couleur trop proche de ce qui se voit à
  // travers (ou de la couleur pleine, quand le navigateur ne sait pas flouter) s'en éloigne par petits pas (vers le
  // blanc si le texte du thème est clair, vers le noir sinon).
  const TEXTES_VERRE = ['--muted', '--dim', '--accent-texte', '--good', '--warn', '--bad'];
  const versTon = (t) => (lum(t.ink) > 0.4 ? '#ffffff' : '#000000');
  const eloigner = (c, fonds, vers) => { for (let i = 0; i < 30 && pireContraste(c, fonds) < 4.6; i++) c = mix(c, vers, 0.12); return c; };
  function tonsVerre(t, pal, verre) {
    const fonds = trier(fondsVerre(derriere(t, verre['--v-sat']), verre['--v-carte'], verre['--v-reflet']), [lumVue(hex6(verre['--v-plein']) || t.panel)]), vers = versTon(t), tons = {};
    for (const nom of TEXTES_VERRE) {
      const c = pal[nom]; if (!/^#[0-9a-f]{6}$/i.test(c || '')) continue;
      const loin = eloigner(c, fonds, vers);
      if (loin !== c) tons[nom] = loin;
    }
    return tons;
  }
  // Les cartes de l'accueil, sans une carte posée dans une autre ni la place laissée par une carte qu'on déplace.
  const CARTES_ACCUEIL = ':root[data-odin-theme] #v-home :is(.fe-w,.hpanel,.hcard,.card):not(:is(.fe-w,.hpanel,.hcard,.card) *):not(.dragging)';
  // Les textes posés sans carte sur le fond de l'accueil reçoivent une plaque du même verre (plan de la maquette : « un
  // titre qui se retrouve sur le fond reçoit une plaque ») : le résumé « État détaillé » ; les titres « Tu veux sans
  // doute » et « Comment Odin se comporte » de l'ancienne colonne (l'accueil d'un membre de la famille, ou celui du
  // propriétaire tant que sa fenêtre n'est pas lue, ou quand elle est en panne) ; le message de la fenêtre elle-même
  // (chargement, panne).
  const PLAQUE_ACCUEIL = ['details.hmore>summary', '#todayBox .sect-t', '#fenetre>.fe-err'].map((s) => `:root[data-odin-theme] #v-home ${s}`).join(',');
  // Les cadres en pointillé posés sur le fond (« Page vide » dans la fenêtre ; « Ajouter un widget » en mode Modifier) :
  // le même verre, dans leur cadre à eux, qui garde son pointillé et sa couleur.
  const CADRES_ACCUEIL = ['#feGrid>.fe-drop', '#fenetre .fe-ajout'].map((s) => `:root[data-odin-theme] #v-home ${s}`).join(',');
  // Le verre : le reflet en haut, puis la carte ; ce qui passe derrière est flouté et saturé.
  const VERRE = 'background:linear-gradient(135deg,rgba(255,255,255,var(--v-reflet)) 0%,rgba(255,255,255,calc(var(--v-reflet) * .25)) 28%,transparent 55%),var(--v-carte)';
  const FLOU = '-webkit-backdrop-filter:blur(var(--v-flou)) saturate(var(--v-sat));backdrop-filter:blur(var(--v-flou)) saturate(var(--v-sat))';
  let style;
  let current = 'valhalla', classic;
  function apply(id) {
    const t = THEMES[id] ? THEMES[id] : THEMES.valhalla; current = THEMES[id] ? id : 'valhalla';
    const root = document.documentElement;
    if (!style) { style = document.createElement('style'); style.id = 'odinThemeStyle'; document.head.append(style); }
    if (!t.sky) {
      if (root.dataset.odinTheme) { if (classic === undefined) delete root.dataset.theme; else root.dataset.theme = classic; }
      delete root.dataset.odinTheme; style.textContent = '';
      window.OdinFace?.tintBase?.(null);
      root.dispatchEvent(new CustomEvent('odin-theme', { detail: { id: current } }));
      return;
    }
    if (!root.dataset.odinTheme) classic = root.dataset.theme;
    root.dataset.odinTheme = current; root.dataset.theme = t.dark ? 'dark' : 'light';
    const pal = palette(t), verre = varsVerre(current, t, pal), voile = t.dark ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.22)';
    const tons = verre ? Object.entries(tonsVerre(t, pal, verre)).map(([k, v]) => `;${k}:${v}`).join('') : '';
    const vars = Object.entries({ ...pal, ...verre }).map(([k, v]) => `${k}:${v}`).join(';');
    style.textContent = `:root[data-odin-theme]{color-scheme:${t.dark ? 'dark' : 'light'};${vars}}
:root[data-odin-theme] body{background:${decorUri(t)} center bottom/100% 40vh no-repeat fixed,linear-gradient(180deg,${t.sky[0]},${t.sky[1]}) fixed}
:root[data-odin-theme] body::before{content:'';position:fixed;inset:0;pointer-events:none;background:${voile};z-index:0}
:root[data-odin-theme] nav.side{background:color-mix(in srgb,var(--panel2) 86%,transparent);backdrop-filter:blur(10px)}
:root[data-odin-theme] .card,:root[data-odin-theme] .hpanel,:root[data-odin-theme] .hcard{background:color-mix(in srgb,var(--panel) 94%,transparent)}
:root[data-odin-theme] main{position:relative;z-index:1;background:var(--bg)}${verre ? `
:root[data-odin-theme] main:has(>#v-home.on){background:transparent}
${PLAQUE_ACCUEIL},${CARTES_ACCUEIL}{${VERRE};border-color:var(--v-bord);box-shadow:inset 0 1px 0 rgba(255,255,255,calc(var(--v-reflet) * 1.6)),inset 1px 0 0 rgba(255,255,255,calc(var(--v-reflet) * .8)),var(--v-ombre);${FLOU}${tons}}
${PLAQUE_ACCUEIL}{width:fit-content;max-width:100%;box-sizing:border-box;padding:6px 14px;border:1px solid var(--v-bord);border-radius:12px}
:root[data-odin-theme] #v-home details.hmore>summary{margin:12px 0}
${CADRES_ACCUEIL}{${VERRE};${FLOU}${tons}}
:root[data-odin-theme] #v-home .hcard.sugg{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){${PLAQUE_ACCUEIL},${CADRES_ACCUEIL},${CARTES_ACCUEIL}{background:var(--v-plein)}}` : ''}`;
    // (Zone de travail sur fond uni, choix du propriétaire du 17/11 : le décor ne passe jamais derrière un texte ; il ne se
    //  voit plus que derrière la barre de côté. Seule exception, ses choix du 23/11 et du 25/11 : sur l'accueil, la zone
    //  de travail laisse voir le fond de la page, comme la maquette (le dessin du décor, le dégradé et le même voile que
    //  derrière la barre de côté) ; ses cartes sont du verre assez opaque pour que chaque texte s'y lise au pire point du
    //  décor, et tout texte posé sans carte a une plaque du même verre (dans un cadre en pointillé, le même verre). Le
    //  bandeau du haut garde son fond uni.)
    // La mascotte en liberté et sa copie dans la discussion prennent la couleur du thème au repos.
    window.OdinFace?.tintBase?.(t.mascot);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.sky[0]);
    root.dispatchEvent(new CustomEvent('odin-theme', { detail: { id: current } }));
  }
  window.OdinThemes.apply = apply;
  window.OdinThemes.current = () => current;

  // ---------------- Ce que dit Odin (le même pour tous tes écrans) ----------------
  const api = async (action, input = {}) => { const r = await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'apparence', action, input }) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
  let state = { mode: 'auto', theme: 'valhalla' };
  try { const c = JSON.parse(localStorage.getItem('odin.apparence') || 'null'); if (c && THEMES[c.theme]) state = c; } catch { /* rien */ }
  // Le thème affiché : celui de l'événement du jour (s'il n'est pas coupé), sinon le choisi ou l'automatique.
  const shown = () => (state.eventTheme && THEMES[state.eventTheme] ? state.eventTheme : state.theme);
  // La couleur d'Odin au repos : l'événement, sinon la météo (thème automatique), sinon celle du thème.
  function tint() {
    const c = state.event?.color || state.odin?.color;
    if (c) window.OdinFace?.tintBase?.(c);
  }
  apply(shown()); tint();
  // `sur` : le dernier état connu d'Odin (relu, ou gardé dans le navigateur) ; `tour` : le numéro du dernier choix ;
  // `file` : les choix partent vers Odin l'un après l'autre, dans l'ordre des clics.
  let sur = state, tour = 0, file = Promise.resolve();
  /** Relit Odin ; rend vrai s'il a répondu. Une relecture partie avant un choix plus récent ne touche à rien. */
  async function sync() {
    const n = tour;
    try {
      const r = await api('mascotte'); const d = r && r.data; if (!d || !THEMES[d.theme]) return false;
      if (n !== tour) return true;
      const ev = d.event, evOn = ev && d.evenements?.themes !== false && THEMES[`ev-${ev.id === 'famille' ? 'anniversaire' : ev.id}`];
      state = { mode: d.mode, theme: d.theme, why: d.why, odin: d.odin, event: ev, eventTheme: evOn ? `ev-${ev.id === 'famille' ? 'anniversaire' : ev.id}` : undefined, humeurTheme: d.humeurTheme !== false };
      sur = state;
      try { localStorage.setItem('odin.apparence', JSON.stringify(state)); } catch { /* */ }
      if (shown() !== current) apply(shown());
      tint();
      document.documentElement.dispatchEvent(new CustomEvent('odin-mascotte', { detail: d }));
      paint();
      return true;
    } catch { return false; /* pas connecté ou hors ligne : on garde le dernier thème */ }
  }
  function choose(id) {
    const n = ++tour;
    // Le choix se voit tout de suite (thème et cartes) ; Odin le confirme ou le corrige juste après. « Au hasard » :
    // rien ne change avant la réponse d'Odin.
    if (id === 'automatique') { apply(state.theme); state = { ...state, mode: 'auto' }; } else if (THEMES[id]) { apply(id); state = { ...state, mode: 'fixe', theme: id }; }
    paint();
    const fait = file.then(async () => {
      let parti = true;
      try { await api('theme', { theme: id }); } catch { parti = false; }
      if (n !== tour) return; // un choix plus récent suit : c'est lui qui relira Odin
      const lu = await sync();
      // Odin injoignable (le choix n'est pas parti, et rien n'a pu être relu) : on remet ce qu'Odin a vraiment.
      if (!parti && !lu && n === tour) { state = sur; apply(shown()); paint(); }
    });
    file = fait.catch(() => undefined);
    return fait;
  }
  // « Odin change de thème selon son humeur » : mis, l'humeur joue sur le thème automatique (au plus une fois par
  // heure) ; coupé, elle ne joue plus. Gardé par Odin ; même file que les choix de thème, même retour en cas de panne.
  function humeur(oui) {
    const n = ++tour;
    state = { ...state, humeurTheme: oui === true }; paint();
    const fait = file.then(async () => {
      let parti = true;
      try { await api('regler_mascotte', { reglages: JSON.stringify({ humeurTheme: oui === true }) }); } catch { parti = false; }
      if (n !== tour) return;
      const lu = await sync();
      // (un choix de thème parti juste avant, en panne lui aussi, ne s'est pas remis : on remet aussi le thème affiché)
      if (!parti && !lu && n === tour) { state = sur; apply(shown()); paint(); }
    });
    file = fait.catch(() => undefined);
    return fait;
  }
  window.OdinThemes.sync = sync; window.OdinThemes.choose = choose; window.OdinThemes.humeur = humeur;

  // ---------------- Réglages → Apparence : une carte par thème (maquette validée), « Automatique » et sa raison ----------------
  // Valhalla n'a pas de couleurs à lui : son aperçu prend celles de la maquette (fond, panneau, bord, côté, Odin).
  const VALHALLA = { sky: ['#101A24', '#172533'], panel: '#16212c', line: '#2a3846', side: '#13161B', mascot: '#3F82F0' };
  const COULEUR = /^#[0-9a-f]{6}$/i;
  // Les yeux du petit Odin des cartes : ceux que dessine face.js (repos, petite taille, figés), une seule fois.
  let yeuxOdin;
  function yeux() {
    if (yeuxOdin !== undefined) return yeuxOdin;
    yeuxOdin = '';
    try {
      const d = window.OdinFace?.dessin?.('neutre', { taille: 'mini', fige: true });
      if (d && Array.isArray(d.yeux) && d.yeux.length === 2) {
        // À petite taille, face.js agrandit les yeux (d.mesure) : la même mesure, autour du centre du regard.
        const h = Number(/height="([\d.]+)"/.exec(d.yeux[0])?.[1]), m = Number(d.mesure?.[0]?.[1]);
        const k = h > 0 && m > 0 ? +(m / h).toFixed(3) : 1;
        yeuxOdin = `<g transform="translate(60 56) scale(${k}) translate(-60 -56)">${d.yeux.join('')}</g>`;
      }
    } catch { /* pas de visage sur cette page : pas de petit Odin */ }
    return yeuxOdin;
  }
  // Le petit Odin d'une carte, à la couleur du thème au repos (les quatre teintes que face.js tire d'une couleur,
  // comme tintBase). Pas de classe « odin » : face.js ne le repeint pas avec le thème affiché.
  function mascotte(id, couleur) {
    const e = yeux(); if (!e) return '';
    const h = COULEUR.test(couleur || '') ? couleur : VALHALLA.mascot, c = [mix(h, '#000000', 0.14), h, mix(h, '#ffffff', 0.32), mix(h, '#ffffff', 0.62)], n = `tm-${id}`;
    return `<svg viewBox="0 0 120 120" focusable="false" aria-hidden="true"><defs><radialGradient id="${n}-c" cx="50%" cy="46%" r="54%"><stop offset="0" stop-color="${c[0]}"/><stop offset=".5" stop-color="${c[1]}"/><stop offset=".82" stop-color="${c[2]}"/><stop offset="1" stop-color="${c[3]}"/></radialGradient><radialGradient id="${n}-h" cx="50%" cy="50%" r="50%"><stop offset=".8" stop-color="${c[3]}" stop-opacity=".65"/><stop offset="1" stop-color="${c[3]}" stop-opacity="0"/></radialGradient></defs><circle cx="63" cy="64" r="49" fill="url(#${n}-h)"/><circle cx="60" cy="60" r="44" fill="url(#${n}-c)"/>${e}</svg>`;
  }
  // L'aperçu de 120 px : le fond du thème (décor compris), une barre de côté, trois cartes et un bloc « allumé ».
  function apercu(t) {
    const p = t.sky ? palette(t) : null;
    const fond = t.sky ? `${decorUri(t)} center bottom/100% auto no-repeat,linear-gradient(180deg,${t.sky[0]},${t.sky[1]})` : `linear-gradient(180deg,${VALHALLA.sky[0]},${VALHALLA.sky[1]})`;
    // Écrites dans la page : seulement des couleurs « #rrggbb » (sinon celles de Valhalla).
    const sure = (x, d) => (COULEUR.test(x || '') ? x : d);
    t = { ...t, accent: sure(t.accent, '') };
    const c = `<i style="background:${sure(p?.['--panel'], VALHALLA.panel)};border:1px solid ${sure(p?.['--line'], VALHALLA.line)}"></i>`;
    return { fond, html: `<i style="background:${sure(p?.['--panel2'], VALHALLA.side)}"></i>${c}<i style="background:${t.accent || '#E3AC3F'}"></i>${c}${c}` };
  }
  const CSS_CARTES = '#themeGrid .tfam{margin:4px 0 14px}#themeGrid .tfh{display:flex;align-items:center;gap:8px;min-height:44px}#themeGrid h3{margin:0;font-size:14px;font-weight:600;display:flex;gap:8px;align-items:baseline;flex:1;min-width:0}#themeGrid h3 small{color:var(--muted);font-weight:600}'
    + '#themeGrid .tfold{display:none;flex:none;width:44px;height:44px;align-items:center;justify-content:center;padding:0;border:1px solid var(--line);border-radius:12px;background:none;color:var(--ink);font-size:16px;cursor:pointer}#themeGrid .tfold span{display:inline-block;transition:transform .2s}#themeGrid .ferme .tfold span{transform:rotate(-90deg)}'
    + '#themeGrid .tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;margin-top:6px}'
    + '#themeGrid button.thc{display:flex;flex-direction:column;align-items:stretch;min-width:0;padding:0;border:0;border-radius:18px;overflow:hidden;text-align:left;background:var(--panel);color:var(--ink);box-shadow:0 0 0 1px var(--line);cursor:pointer;font:inherit;transition:transform .2s}#themeGrid button.thc:hover{transform:translateY(-3px)}'
    + '#themeGrid .thc .pv{height:120px;position:relative;display:grid;grid-template-columns:18% 1fr 1fr;grid-template-rows:1fr 1fr;gap:7px;padding:10px;box-sizing:border-box}#themeGrid .thc .pv i{display:block;min-width:0;border-radius:8px}#themeGrid .thc .pv i:first-child{grid-row:span 2}'
    + '#themeGrid .thc .nm{display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;column-gap:8px;min-height:44px;padding:10px 12px;box-sizing:border-box;font-weight:600;font-size:13px;line-height:1.25}#themeGrid .tmasc{display:block;width:22px;height:22px}#themeGrid .tmasc svg{display:block;width:100%;height:100%}#themeGrid .tnom{overflow-wrap:anywhere}#themeGrid .nm small{color:var(--muted);font-weight:500;font-size:12px}'
    + '#themeGrid button[aria-pressed=true]{outline:3px solid var(--accent-texte,var(--accent));outline-offset:2px}'
    + '#themeGrid .thc[aria-pressed=true] .pv::after{content:"✓";position:absolute;right:8px;top:8px;width:24px;height:24px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;font-size:14px;font-weight:700}'
    + '#themeGrid button.thc:focus-visible,#themeGrid .tfold:focus-visible{outline:3px solid var(--ink);outline-offset:2px}'
    + '.tauto{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}#themeAuto{min-height:44px}'
    // L'interrupteur « selon son humeur » : toute la ligne (44 px) se touche ; Espace le bascule au clavier.
    + '.thum{display:flex;align-items:center;gap:12px;min-height:44px;margin:6px 0 0;cursor:pointer;font-weight:600}'
    + '#themeHumeur{appearance:none;-webkit-appearance:none;flex:none;position:relative;box-sizing:border-box;width:44px;min-width:44px;height:26px;min-height:0;padding:0;margin:0;border-radius:13px;border:0;background:var(--muted);cursor:pointer;transition:background .2s}'
    + '#themeHumeur::before{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .2s}'
    + '#themeHumeur:checked{background:var(--accent)}#themeHumeur:checked::before{transform:translateX(18px)}#themeHumeur:focus-visible{outline:3px solid var(--ink);outline-offset:3px}'
    + '@media (max-width:600px){#themeGrid .tgrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}#themeGrid .tfold{display:inline-flex}#themeGrid .tfam.ferme .tgrid{display:none}#themeGrid .tfam.ferme{margin-bottom:4px}#themeGrid .thc .nm{grid-template-columns:22px minmax(0,1fr);padding:8px 10px}#themeGrid .thc .nm small{grid-column:2}}'
    + '@media (prefers-reduced-motion:reduce){#themeGrid button.thc,#themeGrid .tfold span,#themeHumeur,#themeHumeur::before{transition:none}#themeGrid button.thc:hover{transform:none}}';
  // Une carte : un bouton (Tab, puis Entrée ou Espace, le choisit), l'aperçu, puis la bande (petit Odin, nom, clair ou sombre).
  function carteTheme(id) {
    const t = THEMES[id], b = document.createElement('button'); b.type = 'button'; b.className = 'thc'; b.dataset.theme = id; b.title = t.name;
    const a = apercu(t), pv = document.createElement('span'); pv.className = 'pv'; pv.setAttribute('aria-hidden', 'true'); pv.style.background = a.fond; pv.innerHTML = a.html;
    const nm = document.createElement('span'); nm.className = 'nm';
    const m = document.createElement('span'); m.className = 'tmasc'; m.setAttribute('aria-hidden', 'true'); m.innerHTML = mascotte(id, t.mascot);
    const nom = document.createElement('span'); nom.className = 'tnom'; nom.textContent = t.name;
    const ton = document.createElement('small'); ton.textContent = !t.sky ? TEXTES.lesDeux : t.dark ? TEXTES.sombre : TEXTES.clair;
    nm.append(m, nom, ton); b.append(pv, nm);
    b.addEventListener('click', () => choose(id));
    return b;
  }
  const plis = []; let plieALaMain = false;
  function paint() {
    const card = document.querySelector('article.card[data-sec="apparence"]'); if (!card) return;
    let box = card.querySelector('#themeGrid');
    if (!box) {
      const wrap = document.createElement('div'); wrap.className = 'field';
      // En tête, la place (vide, cachée) du choix de l'animation de déplacement ; puis « Automatique » et sa raison ;
      // puis l'interrupteur « selon son humeur » (une vraie case, rôle d'interrupteur) ; puis les familles.
      wrap.innerHTML = '<section id="themeAnims" class="tanims" data-place="animations" hidden></section><div class="tauto"><button type="button" class="btn" id="themeAuto" aria-pressed="false"></button><span class="hint" id="themeAutoAide"></span></div><span class="hint" id="themeWhy"></span>'
        + '<label class="thum" for="themeHumeur"><input type="checkbox" role="switch" id="themeHumeur" aria-describedby="themeHumeurAide"><span id="themeHumeurNom"></span></label><span class="hint" id="themeHumeurAide"></span><div id="themeGrid"></div>';
      card.querySelector('h2').after(wrap);
      card.querySelector('#themeAnims')?.setAttribute('aria-label', TEXTES.animations);
      const hum = card.querySelector('#themeHumeur');
      if (hum) {
        card.querySelector('#themeHumeurNom').textContent = TEXTES.humeur;
        card.querySelector('#themeHumeurAide').textContent = TEXTES.humeurAide;
        hum.addEventListener('change', () => humeur(hum.checked === true));
      }
      const css = document.createElement('style'); css.textContent = CSS_CARTES;
      document.head.append(css);
      box = card.querySelector('#themeGrid');
      const fs = familles();
      // Pas de nom pour la grille entière : chaque famille est un groupe nommé par son titre.
      for (const f of fs) {
        const sec = document.createElement('section'); sec.className = 'tfam';
        const tete = document.createElement('div'); tete.className = 'tfh';
        const h = document.createElement('h3'); h.id = `themeFam-${f.id}`; h.textContent = f.titre;
        const n = document.createElement('small'); n.textContent = String(f.ids.length); h.append(' ', n);
        const grid = document.createElement('div'); grid.className = 'tgrid'; grid.id = `themeFamG-${f.id}`; grid.setAttribute('role', 'group'); grid.setAttribute('aria-labelledby', h.id);
        const plier = document.createElement('button'); plier.type = 'button'; plier.className = 'tfold'; plier.innerHTML = '<span aria-hidden="true">▾</span>';
        plier.setAttribute('aria-labelledby', h.id); plier.setAttribute('aria-controls', grid.id);
        const ouvrir = (oui) => { sec.classList.toggle('ferme', !oui); plier.setAttribute('aria-expanded', String(oui)); };
        plis.push({ id: f.id, ids: f.ids, ouvrir });
        plier.addEventListener('click', () => { plieALaMain = true; ouvrir(sec.classList.contains('ferme')); });
        tete.append(h, plier); sec.append(tete, grid); box.append(sec);
        for (const id of f.ids) grid.append(carteTheme(id));
      }
      const auto = card.querySelector('#themeAuto');
      auto.textContent = TEXTES.automatique;
      auto.addEventListener('click', () => choose(state.mode === 'auto' ? state.theme : 'automatique'));
      const aide = card.querySelector('#themeAutoAide'); if (aide) aide.textContent = TEXTES.autoAide;
      const sub = card.querySelector('p.sub'); if (sub) sub.textContent = TEXTES.sousTitre;
    }
    // À l'écran étroit, les familles se replient : tant qu'on n'en a replié ou déplié aucune, seule celle du thème
    // choisi est ouverte (la première en automatique) ; ensuite, c'est la main qui décide.
    if (!plieALaMain) { const o = plis.find((f) => state.mode !== 'auto' && f.ids.includes(state.theme)) || plis[0]; for (const f of plis) f.ouvrir(f === o); }
    // Un seul thème marqué choisi (aucun en automatique : c'est alors « Automatique » qui l'est).
    const choisi = state.mode === 'auto' ? null : state.theme;
    for (const b of box.querySelectorAll('button.thc')) b.setAttribute('aria-pressed', String(b.dataset.theme === choisi));
    const auto = card.querySelector('#themeAuto'); if (auto) { auto.setAttribute('aria-pressed', String(state.mode === 'auto')); auto.classList.toggle('primary', state.mode === 'auto'); }
    const hum = card.querySelector('#themeHumeur'); if (hum) hum.checked = state.humeurTheme !== false;
    const why = card.querySelector('#themeWhy');
    if (why) why.textContent = (state.eventTheme ? remplir(TEXTES.evenement, { nom: THEMES[state.eventTheme].name }) : '') + (state.mode === 'auto' ? remplir(TEXTES.raisonAuto, { nom: THEMES[state.theme]?.name ?? state.theme, why: state.why ? remplir(TEXTES.raisonPourquoi, { why: state.why }) : '', odin: state.odin ? remplir(TEXTES.raisonOdin, { why: state.odin.why }) : '' }) : remplir(TEXTES.choisi, { nom: nomAffiche(state.theme) }));
    // Les réglages d'origine (Odin / Clair épuré, clair / sombre) ne valent que pour Valhalla.
    for (const el of card.querySelectorAll('.skins, #modeSeg')) el.style.opacity = current === 'valhalla' ? '' : '.45';
  }
  const start = () => { paint(); void sync(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  setInterval(() => { if (!document.hidden) void sync(); }, 5 * 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void sync(); });
})();
