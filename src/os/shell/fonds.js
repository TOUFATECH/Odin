// Odin OS — fonds d'écran. Dessinés en SVG pour Odin OS (aucune image externe, aucun fond d'un autre système).
// Chaque fonction renvoie le SVG complet ; le thème choisit le sien (voir OS.themes dans noyau.js).
(() => {
  'use strict';
  const OS = window.OS;
  const svg = (interieur, fond) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><rect width="1600" height="1000" fill="${fond}"/>${interieur}</svg>`;

  OS.fonds = {
    // Thème Odin : nuit bleue, anneaux dorés (les halos de la mascotte, en grand).
    anneaux: () => svg(`<defs><radialGradient id="fa1" cx="50%" cy="46%" r="60%"><stop offset="0" stop-color="#22364A"/><stop offset=".55" stop-color="#132130"/><stop offset="1" stop-color="#0B121A"/></radialGradient><radialGradient id="fa2" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#F8CC70" stop-opacity=".32"/><stop offset="1" stop-color="#F8CC70" stop-opacity="0"/></radialGradient></defs>
<rect width="1600" height="1000" fill="url(#fa1)"/><circle cx="800" cy="470" r="330" fill="url(#fa2)"/>
<g fill="none" stroke="#E3AC3F"><circle cx="800" cy="470" r="150" stroke-width="2.2" opacity=".75"/><circle cx="800" cy="470" r="232" stroke-width="1.6" opacity=".5"/><circle cx="800" cy="470" r="330" stroke-width="1.2" opacity=".32"/><circle cx="800" cy="470" r="450" stroke-width="1" opacity=".2"/><circle cx="800" cy="470" r="600" stroke-width="1" opacity=".12"/><circle cx="800" cy="470" r="780" stroke-width="1" opacity=".07"/></g>
<g fill="#F8CC70"><circle cx="950" cy="470" r="5"/><circle cx="636" cy="306" r="4" opacity=".8"/><circle cx="1086" cy="635" r="4" opacity=".65"/><circle cx="482" cy="788" r="3.5" opacity=".5"/><circle cx="1330" cy="250" r="3" opacity=".4"/></g>`, '#101A24'),

    // Aurore : bleu, vert, rouge, violet (aussi le fond de l'installation).
    aurore: () => svg(`<defs><filter id="fo1" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="90"/></filter></defs>
<g filter="url(#fo1)"><ellipse cx="260" cy="250" rx="460" ry="300" fill="#2563EB" opacity=".85"/><ellipse cx="1280" cy="190" rx="430" ry="260" fill="#7C3AED" opacity=".75"/><ellipse cx="1100" cy="820" rx="520" ry="270" fill="#10B981" opacity=".6"/><ellipse cx="330" cy="880" rx="400" ry="240" fill="#E11D48" opacity=".55"/><ellipse cx="800" cy="500" rx="300" ry="190" fill="#0EA5E9" opacity=".35"/></g>
<g fill="#fff"><circle cx="210" cy="140" r="1.6" opacity=".7"/><circle cx="520" cy="80" r="1.2" opacity=".5"/><circle cx="930" cy="130" r="1.5" opacity=".6"/><circle cx="1370" cy="90" r="1.3" opacity=".6"/><circle cx="1500" cy="420" r="1.4" opacity=".5"/><circle cx="90" cy="560" r="1.2" opacity=".5"/><circle cx="720" cy="930" r="1.4" opacity=".45"/></g>`, '#060A18'),

    // Thème Verre : grande vague bleue sur ciel clair.
    vague: () => svg(`<defs><linearGradient id="fv1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DCE6F5"/><stop offset=".5" stop-color="#B9CDEC"/><stop offset="1" stop-color="#8FB2E6"/></linearGradient><linearGradient id="fv2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6FC3FF"/><stop offset=".5" stop-color="#2E8BF0"/><stop offset="1" stop-color="#0B4CC4"/></linearGradient><linearGradient id="fv3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3BA2F5"/><stop offset="1" stop-color="#0A3FA8"/></linearGradient><linearGradient id="fv4" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<rect width="1600" height="1000" fill="url(#fv1)"/>
<path d="M-50 640C220 380 520 330 800 470s560 250 900-40V1050H-50Z" fill="url(#fv2)"/>
<path d="M-50 760C260 560 560 560 840 660s520 140 810-60V1050H-50Z" fill="url(#fv3)" opacity=".92"/>
<path d="M-50 640C220 380 520 330 800 470" fill="none" stroke="url(#fv4)" stroke-width="5"/>
<path d="M-50 880C320 760 660 800 940 860s480 40 710-60V1050H-50Z" fill="#0A318C" opacity=".7"/>`, '#B9CDEC'),

    // Lagon : rubans turquoise, bleu et violet.
    lagon: () => svg(`<defs><linearGradient id="fl1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0E7490"/><stop offset=".5" stop-color="#1D4ED8"/><stop offset="1" stop-color="#6D28D9"/></linearGradient><linearGradient id="fl2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5EEAD4"/><stop offset="1" stop-color="#38BDF8"/></linearGradient><linearGradient id="fl3" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#60A5FA"/><stop offset="1" stop-color="#A78BFA"/></linearGradient><linearGradient id="fl4" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#818CF8"/></linearGradient></defs>
<rect width="1600" height="1000" fill="url(#fl1)"/>
<path d="M-100 300C300 120 620 520 1000 380s520-260 760-120v220C1480 360 1280 560 960 640S340 420-100 620Z" fill="url(#fl2)" opacity=".8"/>
<path d="M-100 560C260 420 640 760 1020 640s480-200 740-80v200C1500 660 1300 820 980 880S320 720-100 860Z" fill="url(#fl3)" opacity=".75"/>
<path d="M-100 820C320 720 700 940 1080 860s440-120 680-40v260H-100Z" fill="url(#fl4)" opacity=".55"/>`, '#1D4ED8'),

    // Thème Fenêtres : fleur bleue abstraite sur fond nuit.
    fleur: () => svg(`<defs><radialGradient id="ff1" cx="62%" cy="48%" r="70%"><stop offset="0" stop-color="#16308F"/><stop offset=".6" stop-color="#0A1650"/><stop offset="1" stop-color="#050A26"/></radialGradient><linearGradient id="ff2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7DD3FC"/><stop offset=".45" stop-color="#3B82F6"/><stop offset="1" stop-color="#1E3FD8"/></linearGradient><linearGradient id="ff3" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#60A5FA"/><stop offset="1" stop-color="#1D2FBF"/></linearGradient></defs>
<rect width="1600" height="1000" fill="url(#ff1)"/>
<g transform="translate(990 500)"><g opacity=".95">
<path d="M0 0C-60-190 40-380 200-420 250-250 160-80 0 0Z" fill="url(#ff2)"/><path d="M0 0C120-150 320-200 450-110 360 40 170 80 0 0Z" fill="url(#ff3)"/><path d="M0 0C170 30 300 180 290 340 120 330 10 180 0 0Z" fill="url(#ff2)"/><path d="M0 0C40 170-60 340-220 380-260 210-160 60 0 0Z" fill="url(#ff3)"/><path d="M0 0C-140 120-340 130-450 30-350-110-160-110 0 0Z" fill="url(#ff2)"/><path d="M0 0C-170-40-290-200-270-360-100-340 0-180 0 0Z" fill="url(#ff3)" opacity=".85"/></g>
<circle r="46" fill="#0A1650"/><circle r="30" fill="#7DD3FC" opacity=".5"/></g>`, '#07102E'),

    // Thème Libre : crépuscule sur des montagnes.
    crepuscule: () => svg(`<defs><linearGradient id="fc1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0B1640"/><stop offset=".42" stop-color="#3B2F7E"/><stop offset=".66" stop-color="#B0629F"/><stop offset=".8" stop-color="#F2A0B5"/><stop offset="1" stop-color="#F9C9A8"/></linearGradient></defs>
<rect width="1600" height="1000" fill="url(#fc1)"/>
<g fill="#fff"><circle cx="180" cy="110" r="1.6"/><circle cx="420" cy="210" r="1.2" opacity=".7"/><circle cx="700" cy="90" r="1.5" opacity=".8"/><circle cx="1010" cy="170" r="1.3" opacity=".7"/><circle cx="1290" cy="80" r="1.6"/><circle cx="1480" cy="230" r="1.2" opacity=".6"/><circle cx="880" cy="290" r="1.1" opacity=".5"/></g>
<circle cx="1180" cy="640" r="74" fill="#FFE1C4" opacity=".9"/>
<path d="M0 700 190 560 330 660 520 500 700 650 860 570 1040 690 1230 540 1400 660 1600 560V1000H0Z" fill="#5B3F8C" opacity=".8"/>
<path d="M0 800 220 660 420 780 620 640 830 790 1030 700 1220 800 1420 690 1600 770V1000H0Z" fill="#33295F"/>
<path d="M0 900 260 790 520 880 800 800 1080 890 1340 810 1600 880V1000H0Z" fill="#161735"/>`, '#161735'),

    // Thème Néon : traits cyan, violet et rose sur nuit profonde.
    neon: () => svg(`<defs><linearGradient id="fn1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22D3EE"/><stop offset=".5" stop-color="#8B5CF6"/><stop offset="1" stop-color="#EC4899"/></linearGradient><filter id="fn2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="70"/></filter><filter id="fn3" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="5"/></filter></defs>
<g filter="url(#fn2)" opacity=".5"><circle cx="330" cy="260" r="260" fill="#22D3EE"/><circle cx="1250" cy="720" r="320" fill="#EC4899"/><circle cx="900" cy="350" r="240" fill="#8B5CF6"/></g>
<g fill="none" stroke="url(#fn1)" stroke-linecap="round"><path d="M-40 760C300 520 560 880 880 620S1360 300 1660 460" stroke-width="10" filter="url(#fn3)" opacity=".8"/><path d="M-40 760C300 520 560 880 880 620S1360 300 1660 460" stroke-width="3"/><path d="M-40 560C260 380 600 660 900 440S1340 160 1660 280" stroke-width="2" opacity=".6"/><path d="M-40 900C340 700 640 980 960 780S1380 480 1660 620" stroke-width="2" opacity=".45"/></g>
<g fill="none" stroke="#fff" stroke-opacity=".05"><path d="M0 200H1600M0 400H1600M0 600H1600M0 800H1600M200 0V1000M400 0V1000M600 0V1000M800 0V1000M1000 0V1000M1200 0V1000M1400 0V1000"/></g>`, '#070915'),

    // Téléphone, style lavande : dégradé doux.
    lavande: () => svg(`<defs><linearGradient id="fd1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E6DBFF"/><stop offset=".5" stop-color="#C9B8F5"/><stop offset="1" stop-color="#A9C4F7"/></linearGradient><filter id="fd2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="80"/></filter></defs>
<rect width="1600" height="1000" fill="url(#fd1)"/><g filter="url(#fd2)"><circle cx="400" cy="300" r="280" fill="#F5C6EC" opacity=".8"/><circle cx="1200" cy="700" r="320" fill="#B4A4F5" opacity=".7"/></g>`, '#C9B8F5'),
  };
  OS.NOMS_FONDS = { anneaux: 'Anneaux d\'Odin', aurore: 'Aurore', vague: 'Vague', lagon: 'Lagon', fleur: 'Fleur bleue', crepuscule: 'Crépuscule', neon: 'Néon', lavande: 'Lavande' };
})();
