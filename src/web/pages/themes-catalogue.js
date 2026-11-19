// Le catalogue des thèmes de la maquette validée (Accueil et écran de la maison, 15/11/2026) : ici, les thèmes
// « Mis en avant », faits à la main dans la maquette (sauf « Minuit », qui attend la réponse du propriétaire et reste
// pour l'instant celui d'Odin). Seulement des couleurs, des nombres et des codes, repris tels quels de la maquette ;
// les noms sont dans le dictionnaire ci-dessous. « glace » garde son identifiant : le décor de Glace, que la maquette
// dessine aussi, est déjà dans themes.js (il n'est pas recopié ici).
// Puis les 31 « Thèmes de Hestia » (h-…), tirés des thèmes de l'écran de la maison par la règle de la maquette.
// Ce fichier ne fait rien d'autre que se publier sur la page (window.OdinCatalogueThemes) : themes.js, chargé juste
// après, le lit s'il est là. Pour l'instant les thèmes y sont « à plat » (fond uni, cartes pleines) : themes.js n'en
// prend que le fond, la carte pleine (solid), le texte, l'accent, la couleur d'Odin et le ton clair ou sombre.
(() => {
  // Les noms affichés (en tête du fichier, pour les traduire d'un seul endroit).
  const NOMS = {
    glace: 'Glace', vitre: 'Vitre', glacenuit: 'Glace nuit', neon: 'Néon', ha: 'Home Assistant', clair: 'Maison claire',
    // Les thèmes de Hestia : les noms que l'écran de la maison leur donne déjà (src/valhalla/modules/gladsheim.ts).
    'h-verre': 'Verre sombre (tuiles colorées)', 'h-nuit': 'Bleu nuit', 'h-braise': 'Braise (orange)', 'h-acier': 'Acier (gris bleuté)',
    'h-mural': 'Tablette murale (noir et cyan)', 'h-crepuscule': 'Crépuscule (paysage)', 'h-classique': 'Classique (comme Home Assistant)',
    'h-violet': 'Violet', 'h-aurore': 'Aurore (violet et soleil)', 'h-lagon': 'Lagon (bleu-vert)', 'h-clair': 'Clair',
    'h-ocean': 'Bleu océan', 'h-blanc': 'Blanc pur', 'h-rubis': 'Rouge rubis', 'h-foret': 'Vert forêt', 'h-soleil': 'Jaune soleil',
    'h-plage': 'Plage (palmier)', 'h-etoiles': 'Ciel étoilé', 'h-boreale': 'Aurore boréale', 'h-mayotte': 'Lagon de Mayotte', 'h-coucher': 'Coucher de soleil',
    'h-montagne': 'Montagne et brume', 'h-tropical': 'Forêt tropicale', 'h-desert': 'Désert', 'h-neige': 'Neige', 'h-abysses': 'Océan profond',
    'h-neon': 'Néon', 'h-bois': 'Bois et lin', 'h-graphite': 'Graphite', 'h-pastel': 'Pastel', 'h-espace': 'Espace',
  };
  // Les valeurs de la maquette, champ par champ. Vitre, Home Assistant et Maison claire n'ont pas de taches floues
  // (blob1, blob2), comme dans la maquette.
  const THEMES = {
    glace: {
      dark: false, sc: '#ffffff', gt: 88, blur0: 20, sheen: 0.55, scene: 'ice', mascot: '#2b8fd6',
      bg: 'radial-gradient(1100px 700px at 8% -10%,#ffffff,transparent 60%),radial-gradient(900px 600px at 100% 110%,#b4dbff,transparent 60%),linear-gradient(160deg,#d6edff 0%,#eef8ff 45%,#cde5fb 100%)',
      blob1: '#8fd6ff', blob2: '#c7b9ff', blobO: 0.55, surface: 'linear-gradient(140deg,rgba(255,255,255,.66),rgba(255,255,255,.28))', solid: '#f3f9ff', border: 'rgba(255,255,255,.78)', blur: 26, sat: 1.7,
      shadow: '0 10px 30px rgba(36,92,156,.13),inset 0 1px 0 rgba(255,255,255,.95)', radius: 24,
      ink: '#0d2a42', muted: '#52728f', accent: '#1f8fff', onA: 'linear-gradient(135deg,#55c8ff,#1f7bff)', onB: 'linear-gradient(135deg,#9a86ff,#5b5bff)',
      pal: ['#1f8fff', '#ff6fa8', '#8f7bff', '#16c1e6', '#2fcf92'], side: 'rgba(255,255,255,.4)', chip: 'rgba(255,255,255,.55)', sel: 'rgba(255,255,255,.88)', track: 'rgba(13,42,66,.1)', line: 'rgba(13,42,66,.08)',
      good: '#0f9a72', warn: '#b7791f', bad: '#e5484d',
    },
    vitre: {
      dark: true, sc: '#ffffff', gt: 92, blur0: 26, sheen: 0.22, scene: 'swoosh', mascot: '#4fc3ff',
      bg: 'radial-gradient(1100px 800px at 90% 95%,#18a77c 0%,transparent 45%),radial-gradient(900px 700px at 105% 55%,#2dbfa0 0%,transparent 40%),linear-gradient(135deg,#0a2584 0%,#1a4fd6 45%,#2c6ff2 68%,#0e36a3 100%)',
      blobO: 0, surface: 'rgba(255,255,255,.08)', solid: '#1d3f9e', border: 'rgba(255,255,255,.24)', blur: 18, sat: 1.5,
      shadow: '0 16px 40px rgba(4,16,60,.28)', radius: 26,
      ink: '#ffffff', muted: '#cdd9f7', accent: '#4fc3ff', onA: 'linear-gradient(135deg,#ffb347,#ff8a00)', onB: 'linear-gradient(135deg,#ffffff,#dfe8ff)',
      pal: ['#4fc3ff', '#ffb020', '#5eead4', '#ff6b9a', '#a78bfa'], side: 'rgba(255,255,255,.06)', chip: 'rgba(255,255,255,.12)', sel: 'rgba(255,255,255,.2)', track: 'rgba(255,255,255,.2)', line: 'rgba(255,255,255,.12)',
      good: '#5ee6a0', warn: '#ffc35a', bad: '#ff7a8a',
    },
    glacenuit: {
      dark: true, sc: '#0c2342', gt: 80, blur0: 20, sheen: 0.16, scene: 'icenight', mascot: '#5cd0ff',
      bg: 'radial-gradient(900px 600px at 0% 0%,rgba(56,140,255,.35),transparent 60%),radial-gradient(800px 600px at 100% 100%,rgba(123,92,255,.28),transparent 60%),linear-gradient(160deg,#071427,#0a1a33 50%,#06101f)',
      blob1: '#1e6fff', blob2: '#7b5cff', blobO: 0.35, surface: 'linear-gradient(140deg,rgba(150,205,255,.14),rgba(150,205,255,.05))', solid: '#102238', border: 'rgba(170,215,255,.2)', blur: 26, sat: 1.5,
      shadow: '0 12px 34px rgba(0,0,0,.35),inset 0 1px 0 rgba(200,230,255,.12)', radius: 24,
      ink: '#eaf6ff', muted: '#8fb2cf', accent: '#5cd0ff', onA: 'linear-gradient(135deg,#3cc2ff,#2563eb)', onB: 'linear-gradient(135deg,#a78bfa,#6d5dfc)',
      pal: ['#5cd0ff', '#ff7ab6', '#a78bfa', '#2ee6d6', '#4ade80'], side: 'rgba(8,22,42,.5)', chip: 'rgba(170,215,255,.1)', sel: 'rgba(170,215,255,.17)', track: 'rgba(170,215,255,.14)', line: 'rgba(170,215,255,.1)',
      good: '#4ade80', warn: '#fbbf24', bad: '#ff6b6b',
    },
    neon: {
      dark: true, sc: '#1e2129', gt: 0, blur0: 16, sheen: 0.04, scene: 'neon', mascot: '#ff8a3d',
      bg: 'radial-gradient(900px 600px at 0% 0%,#2a2d3b,transparent 60%),radial-gradient(700px 500px at 100% 100%,#241d33,transparent 60%),linear-gradient(160deg,#17191f,#0e1015)',
      blob1: '#ff6a1a', blob2: '#4f7dff', blobO: 0.12, surface: 'linear-gradient(160deg,#22252f,#1a1c24)', solid: '#22252f', border: 'rgba(255,255,255,.05)', blur: 0, sat: 1,
      shadow: '0 14px 30px rgba(0,0,0,.35)', radius: 22,
      ink: '#f2f4f8', muted: '#8a90a2', accent: '#ff8a3d', onA: 'linear-gradient(140deg,#ffab4c,#ff6a1a)', onB: 'linear-gradient(140deg,#5ab8ff,#2f6bff)',
      pal: ['#4f7dff', '#ff4fa3', '#a35bff', '#29e0ff', '#7cff6b'], side: '#15171d', chip: 'rgba(255,255,255,.06)', sel: 'rgba(255,255,255,.09)', track: 'rgba(255,255,255,.08)', line: 'rgba(255,255,255,.06)',
      good: '#5ee6a0', warn: '#ffc35a', bad: '#ff6b7a',
    },
    ha: {
      dark: true, sc: '#1c1c1c', gt: 0, blur0: 12, sheen: 0, scene: 'none', mascot: '#03a9f4',
      bg: '#111111',
      blobO: 0, surface: '#1c1c1c', solid: '#1c1c1c', border: 'rgba(255,255,255,.05)', blur: 0, sat: 1,
      shadow: 'none', radius: 12,
      ink: '#e1e1e1', muted: '#9e9e9e', accent: '#ff9800', onA: 'linear-gradient(135deg,#ffa726,#f57c00)', onB: 'linear-gradient(135deg,#42a5f5,#1e88e5)',
      pal: ['#03a9f4', '#ff9800', '#4caf50', '#e91e63', '#9c27b0'], side: '#1c1c1c', chip: 'rgba(255,255,255,.06)', sel: 'rgba(255,255,255,.1)', track: 'rgba(255,255,255,.1)', line: 'rgba(255,255,255,.06)',
      good: '#4caf50', warn: '#ffb300', bad: '#ef5350',
    },
    clair: {
      dark: false, sc: '#ffffff', gt: 0, blur0: 14, sheen: 0, scene: 'none', mascot: '#ff9800',
      bg: 'linear-gradient(180deg,#f7f7f7,#efefef)',
      blobO: 0, surface: '#ffffff', solid: '#ffffff', border: 'rgba(0,0,0,.06)', blur: 0, sat: 1,
      shadow: '0 1px 2px rgba(0,0,0,.06),0 4px 14px rgba(0,0,0,.04)', radius: 12,
      ink: '#212121', muted: '#737373', accent: '#f59e0b', onA: 'linear-gradient(135deg,#ffd54f,#ffa000)', onB: 'linear-gradient(135deg,#4dd0e1,#00a5bd)',
      pal: ['#00acc1', '#ff9800', '#43a047', '#e53935', '#8e24aa'], side: '#ffffff', chip: 'rgba(0,0,0,.045)', sel: 'rgba(255,152,0,.12)', track: 'rgba(0,0,0,.08)', line: 'rgba(0,0,0,.06)',
      good: '#2e7d32', warn: '#b26a00', bad: '#d32f2f',
    },
  };
  // Le texte en accent (liens, texte, anneau du thème choisi) de Glace et Maison claire : la même teinte, plus foncée,
  // pour se lire sur leur fond clair (4,5:1) ; leur accent de la maquette reste pour les fonds et les boutons.
  const ACCENT_TEXTE = { glace: '#0061c2', clair: '#945f06' };
  // Les 31 thèmes de Hestia (l'écran de la maison) : leurs valeurs de départ (12 champs au plus), recopiées telles
  // quelles de la table T de src/web/maison.js, qui n'est pas touchée. Un essai (test/themes-catalogue.test.ts)
  // compare la copie et l'original champ par champ. « clair » n'a pas de champ `light` : l'écran de la maison le dit
  // clair par son nom, et la règle ci-dessous aussi (la maquette, elle, le traitait en sombre).
  const HESTIA = {
    verre: { bg: '#15171d', bg2: 'radial-gradient(1200px 600px at 0% 0%,#232634,transparent),#15171d', card: '#1f222b', card2: '#272b36', line: '#2f3340', text: '#eef0f6', muted: '#9aa1b2', accent: '#ff8a3d', accent2: '#3fa9ff', on: 'linear-gradient(135deg,#ff9a3d,#ff6a3d)' },
    nuit: { bg: '#070d1a', bg2: 'radial-gradient(900px 500px at 70% -10%,#16264a,transparent),#070d1a', card: '#0e1830', card2: '#13203d', line: '#1d2b4d', text: '#e8eefc', muted: '#8d9bbd', accent: '#4c8dff', accent2: '#22d3ee', on: 'linear-gradient(135deg,#3b82f6,#2563eb)' },
    braise: { bg: '#0d0a08', bg2: 'radial-gradient(1000px 500px at 100% 0%,#3a1606,transparent),#0d0a08', card: '#1b120d', card2: 'linear-gradient(160deg,#5a210a,#2a120a)', line: '#3a2215', text: '#fff3ea', muted: '#c9a48d', accent: '#ff7a1a', accent2: '#ffb347', on: 'linear-gradient(135deg,#ff8a1f,#c2410c)' },
    acier: { bg: '#1b222b', bg2: 'linear-gradient(180deg,#3a4652 0%,#1b222b 60%)', card: 'rgba(255,255,255,.07)', card2: 'rgba(255,255,255,.11)', line: 'rgba(255,255,255,.12)', text: '#eef3f8', muted: '#a9b6c4', accent: '#9fd3ff', accent2: '#ffd36b', on: 'linear-gradient(135deg,#7fb8e6,#4f86b8)' },
    mural: { bg: '#040506', bg2: '#040506', card: '#101214', card2: '#16191c', line: '#22272c', text: '#e9f6f8', muted: '#8a979c', accent: '#22d3ee', accent2: '#34d399', on: 'linear-gradient(135deg,#0ea5b7,#0e7490)' },
    crepuscule: { bg: '#141820', bg2: 'linear-gradient(180deg,#26324a 0%,#7a4a3a 55%,#e08a3c 70%,#1b2230 71%,#0f131a 100%)', card: 'rgba(24,26,34,.78)', card2: 'rgba(36,38,48,.82)', line: 'rgba(255,255,255,.08)', text: '#f6f2ee', muted: '#b8b0a8', accent: '#ff9f43', accent2: '#5ab0ff', on: 'linear-gradient(135deg,#ffb347,#ff7a1a)' },
    classique: { bg: '#111111', bg2: '#111111', card: '#1c1c1c', card2: '#242424', line: '#2c2c2c', text: '#e1e1e1', muted: '#9b9b9b', accent: '#03a9f4', accent2: '#ffc107', on: 'linear-gradient(135deg,#ffc107,#ff9800)' },
    violet: { bg: '#0d0a1c', bg2: 'radial-gradient(900px 500px at 20% 110%,#2a1a5e,transparent),radial-gradient(700px 400px at 90% 0%,#1d1450,transparent),#0d0a1c', card: 'rgba(60,45,120,.28)', card2: 'rgba(80,60,150,.34)', line: 'rgba(160,140,255,.16)', text: '#efeaff', muted: '#a99fcf', accent: '#7c5cff', accent2: '#ff5c8a', on: 'linear-gradient(135deg,#7c5cff,#5b3fe0)' },
    aurore: { bg: '#0f0d1a', bg2: 'radial-gradient(800px 500px at 100% 0%,#3b2a12,transparent),radial-gradient(900px 500px at 0% 100%,#24184a,transparent),#0f0d1a', card: 'rgba(55,45,95,.32)', card2: 'rgba(75,60,120,.36)', line: 'rgba(255,255,255,.08)', text: '#f3f0ff', muted: '#aaa3c8', accent: '#f59e0b', accent2: '#8b5cf6', on: 'linear-gradient(135deg,#fbbf24,#f97316)' },
    lagon: { bg: '#0b4f5c', bg2: 'linear-gradient(160deg,#0f6b78,#0a3d4a)', card: 'rgba(255,255,255,.10)', card2: 'rgba(255,255,255,.16)', line: 'rgba(255,255,255,.14)', text: '#f2fbfc', muted: '#b6dfe4', accent: '#ffd23f', accent2: '#5eead4', on: 'linear-gradient(135deg,#ffd23f,#f5a524)' },
    clair: { bg: '#eef1f5', bg2: '#eef1f5', card: '#ffffff', card2: '#f5f7fa', line: '#dfe4ea', text: '#18202a', muted: '#5d6875', accent: '#e8590c', accent2: '#1971c2', on: 'linear-gradient(135deg,#ff922b,#e8590c)' },
    ocean: { bg: '#0a1f3d', bg2: 'linear-gradient(160deg,#0b3a6e,#0a1f3d)', card: 'rgba(255,255,255,.10)', card2: 'rgba(255,255,255,.15)', line: 'rgba(255,255,255,.16)', text: '#eaf3ff', muted: '#a9c3e4', accent: '#5ab0ff', accent2: '#7fe0ff', on: 'linear-gradient(135deg,#3d8bff,#1f5fd1)', decor: 'vagues' },
    blanc: { bg: '#f4f6f9', bg2: '#f4f6f9', card: '#ffffff', card2: '#f2f5f8', line: '#e2e7ee', text: '#16202b', muted: '#56606e', accent: '#1971c2', accent2: '#e8590c', on: 'linear-gradient(135deg,#4dabf7,#1971c2)', light: true },
    rubis: { bg: '#14070a', bg2: 'linear-gradient(160deg,#3a0b12,#14070a)', card: 'rgba(255,255,255,.07)', card2: 'rgba(255,255,255,.11)', line: 'rgba(255,120,130,.18)', text: '#ffecee', muted: '#d7a7ad', accent: '#ff5a6a', accent2: '#ffb3bb', on: 'linear-gradient(135deg,#ff5a6a,#c2182e)' },
    foret: { bg: '#0a1d13', bg2: 'linear-gradient(160deg,#123b26,#0a1d13)', card: 'rgba(255,255,255,.08)', card2: 'rgba(255,255,255,.12)', line: 'rgba(140,220,170,.18)', text: '#eafaf0', muted: '#a6d3b8', accent: '#5fd38d', accent2: '#c6f6d5', on: 'linear-gradient(135deg,#43c47a,#1f8a4c)' },
    soleil: { bg: '#ffe9a8', bg2: 'linear-gradient(160deg,#fff4c9,#ffe28a)', card: 'rgba(255,255,255,.78)', card2: 'rgba(255,255,255,.9)', line: 'rgba(170,120,0,.2)', text: '#3b2a00', muted: '#6e5a1f', accent: '#b07800', accent2: '#c2410c', on: 'linear-gradient(135deg,#ffc53d,#e09a00)', light: true },
    plage: { bg: '#bfe9ff', bg2: 'linear-gradient(180deg,#8fd8ff 0%,#c9f0ff 55%,#f2d49b 100%)', card: 'rgba(255,255,255,.66)', card2: 'rgba(255,255,255,.82)', line: 'rgba(255,255,255,.85)', text: '#0d3a4a', muted: '#2f6170', accent: '#087f8f', accent2: '#e8590c', on: 'linear-gradient(135deg,#ff9f43,#ff7a1a)', light: true, decor: 'palmiers' },
    etoiles: { bg: '#0b1030', bg2: 'linear-gradient(180deg,#0b1030 0%,#1b2457 100%)', card: 'rgba(255,255,255,.08)', card2: 'rgba(255,255,255,.12)', line: 'rgba(255,255,255,.14)', text: '#eef0ff', muted: '#aab0d8', accent: '#ffd76b', accent2: '#9aa6ff', on: 'linear-gradient(135deg,#7c8bff,#4b56d6)', decor: 'etoiles' },
    boreale: { bg: '#071226', bg2: 'linear-gradient(180deg,#071226,#101a3a)', card: 'rgba(255,255,255,.08)', card2: 'rgba(255,255,255,.12)', line: 'rgba(93,255,176,.2)', text: '#e9fff5', muted: '#a3cbbb', accent: '#5dffb0', accent2: '#a99bff', on: 'linear-gradient(135deg,#34d399,#7c5cff)', decor: 'aurore' },
    mayotte: { bg: '#bff3f0', bg2: 'linear-gradient(180deg,#7fd9f2 0%,#bff3f0 70%)', card: 'rgba(255,255,255,.62)', card2: 'rgba(255,255,255,.8)', line: 'rgba(255,255,255,.85)', text: '#063b44', muted: '#2a6570', accent: '#0b7d8f', accent2: '#c2410c', on: 'linear-gradient(135deg,#14b8a6,#0e7490)', light: true, decor: 'lagon' },
    coucher: { bg: '#2b1747', bg2: 'linear-gradient(180deg,#2b1747 0%,#a8436a 60%,#ff9a62 85%)', card: 'rgba(30,16,40,.58)', card2: 'rgba(40,20,50,.7)', line: 'rgba(255,190,150,.25)', text: '#fff1e8', muted: '#e6c2b4', accent: '#ffb380', accent2: '#ffd0a8', on: 'linear-gradient(135deg,#ff9a62,#e8486f)', decor: 'soleil' },
    montagne: { bg: '#d9e2ec', bg2: 'linear-gradient(180deg,#9fb3c8 0%,#d9e2ec 60%)', card: 'rgba(255,255,255,.62)', card2: 'rgba(255,255,255,.8)', line: 'rgba(255,255,255,.85)', text: '#1d2a38', muted: '#4a5b6d', accent: '#2f5f91', accent2: '#c2410c', on: 'linear-gradient(135deg,#5b8cc0,#2f5f91)', light: true, decor: 'montagnes' },
    tropical: { bg: '#071a10', bg2: 'linear-gradient(160deg,#0f2e1d,#071a10)', card: 'rgba(255,255,255,.08)', card2: 'rgba(255,255,255,.12)', line: 'rgba(120,220,150,.18)', text: '#eafbef', muted: '#a8d4b5', accent: '#7ee08f', accent2: '#ffd36b', on: 'linear-gradient(135deg,#3fbf6b,#178a45)', decor: 'feuilles' },
    desert: { bg: '#f9e6c4', bg2: 'linear-gradient(180deg,#f6d6a8 0%,#f9e6c4 60%)', card: 'rgba(255,255,255,.62)', card2: 'rgba(255,255,255,.8)', line: 'rgba(150,90,30,.22)', text: '#4a2a10', muted: '#77502c', accent: '#a5550f', accent2: '#1c6fc4', on: 'linear-gradient(135deg,#e8913a,#b8611a)', light: true, decor: 'dunes' },
    neige: { bg: '#eef5fc', bg2: 'linear-gradient(180deg,#cfe3f6 0%,#eef5fc 70%)', card: 'rgba(255,255,255,.78)', card2: 'rgba(255,255,255,.92)', line: 'rgba(120,160,200,.3)', text: '#13304d', muted: '#476583', accent: '#1f6ab0', accent2: '#c2410c', on: 'linear-gradient(135deg,#6aa9e6,#2f7cc4)', light: true, decor: 'neige' },
    abysses: { bg: '#020c16', bg2: 'linear-gradient(180deg,#05263b 0%,#020c16 100%)', card: 'rgba(255,255,255,.07)', card2: 'rgba(255,255,255,.11)', line: 'rgba(126,224,255,.16)', text: '#e4f8ff', muted: '#9cc5d6', accent: '#3fd2ff', accent2: '#ffd36b', on: 'linear-gradient(135deg,#1aa3d6,#0a5f8a)', decor: 'abysses' },
    neon: { bg: '#0b0418', bg2: 'linear-gradient(180deg,#0b0418 0%,#1a0630 100%)', card: 'rgba(20,10,40,.72)', card2: 'rgba(40,16,70,.75)', line: 'rgba(255,60,172,.35)', text: '#fbe9ff', muted: '#c9a6d8', accent: '#2de2e6', accent2: '#ff3cac', on: 'linear-gradient(135deg,#ff3cac,#784ba0)', decor: 'neon' },
    bois: { bg: '#efe7db', bg2: '#efe7db', card: '#fbf7f1', card2: '#f4ece0', line: '#ddcfbd', text: '#3a2a1c', muted: '#6b5440', accent: '#8a4e22', accent2: '#2f6f5e', on: 'linear-gradient(135deg,#a8683a,#7a4824)', light: true },
    graphite: { bg: '#121314', bg2: '#121314', card: '#1b1c1e', card2: '#232427', line: '#2a2c2f', text: '#e8e8e8', muted: '#a0a3a8', accent: '#ff8a3d', accent2: '#7cc4ff', on: 'linear-gradient(135deg,#ff8a3d,#e0661c)' },
    pastel: { bg: '#f3e8ff', bg2: 'linear-gradient(160deg,#f3e8ff,#e6fff4)', card: 'rgba(255,255,255,.78)', card2: 'rgba(255,255,255,.9)', line: 'rgba(160,130,200,.25)', text: '#352a4a', muted: '#62577a', accent: '#7c3aed', accent2: '#db2777', on: 'linear-gradient(135deg,#f9a8d4,#a78bfa)', light: true },
    espace: { bg: '#05030f', bg2: 'radial-gradient(circle at 30% 20%,#2b1b5e,#05030f 70%)', card: 'rgba(255,255,255,.07)', card2: 'rgba(255,255,255,.11)', line: 'rgba(180,160,255,.18)', text: '#efeaff', muted: '#b3a8d8', accent: '#b39dff', accent2: '#ffb37a', on: 'linear-gradient(135deg,#8b5cf6,#4338ca)', decor: 'planetes' },
  };
  // Les 13 décors dessinés de Hestia (table DECOR de src/web/maison.js, recopiée telle quelle ; dessinés dans un cadre
  // de 960 × 150, viewBox « 0 -30 960 150 »). La maquette ne les montrait pas : ils sont gardés.
  const DECORS = {
    vagues: '<path d="M0 60 Q120 40 240 60 T480 60 T720 60 T960 60 V120 H0Z" fill="#fff" opacity=".08"/><path d="M0 80 Q120 60 240 80 T480 80 T720 80 T960 80 V120 H0Z" fill="#fff" opacity=".1"/>',
    palmiers: '<path d="M0 70 Q240 50 480 70 T960 66 V120 H0Z" fill="#f2d49b"/><path d="M0 56 Q160 46 320 56 T640 56 T960 54 V72 Q720 60 480 70 T0 72Z" fill="#2fb3c6" opacity=".8"/><path d="M860 70 Q852 30 870 0" stroke="#6b4a2b" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M870 0 Q840 -12 818 0 M870 0 Q892 -20 916 -12 M870 0 Q896 2 910 20 M870 0 Q858 20 840 28" stroke="#2f8f4e" stroke-width="7" fill="none" stroke-linecap="round" transform="translate(0 6)"/>',
    etoiles: '<g fill="#fff"><circle cx="40" cy="20" r="1.5"/><circle cx="160" cy="50" r="1"/><circle cx="280" cy="14" r="1.8"/><circle cx="420" cy="40" r="1"/><circle cx="560" cy="10" r="1.4"/><circle cx="700" cy="44" r="1.2"/><circle cx="820" cy="18" r="1.7"/><circle cx="930" cy="60" r="1"/><circle cx="90" cy="90" r="1"/><circle cx="360" cy="96" r="1.3"/><circle cx="620" cy="88" r="1"/></g><path d="M880 30 a20 20 0 1 0 20 26 a16 16 0 1 1 -20 -26Z" fill="#f4f1d0"/>',
    aurore: '<path d="M-20 40 Q240 -10 480 40 T980 20" stroke="#5dffb0" stroke-width="30" fill="none" opacity=".25" stroke-linecap="round"/><path d="M-20 70 Q300 20 560 64 T980 50" stroke="#7c8bff" stroke-width="24" fill="none" opacity=".22" stroke-linecap="round"/><path d="M0 120 L160 70 L300 100 L460 60 L640 104 L800 74 L960 96 V120Z" fill="#050b18"/>',
    lagon: '<path d="M600 70 Q760 30 960 40 V70Z" fill="#2c7a3f" opacity=".85"/><path d="M0 76 Q240 62 480 76 T960 72 V120 H0Z" fill="#7fe3d8" opacity=".55"/><path d="M0 92 Q240 80 480 92 T960 88 V120 H0Z" fill="#1fa7b2" opacity=".55"/>',
    soleil: '<circle cx="480" cy="84" r="70" fill="#ffcf6b" opacity=".85"/><path d="M0 84 H960 V120 H0Z" fill="#3a1d3a"/><path d="M200 96 H420 M540 104 H760 M320 112 H640" stroke="#ff9a62" stroke-width="3" opacity=".6" stroke-linecap="round"/>',
    montagnes: '<path d="M0 90 L160 30 L270 70 L440 10 L600 72 L720 44 L860 80 L960 60 V120 H0Z" fill="#5b6f86" opacity=".55"/><path d="M0 108 L240 70 L440 100 L640 76 L960 104 V120 H0Z" fill="#3b4b5f" opacity=".7"/>',
    feuilles: '<path d="M0 120 Q40 40 170 60 Q90 90 0 120Z" fill="#2f9e57" opacity=".7"/><path d="M960 120 Q920 30 790 52 Q880 80 960 120Z" fill="#1f7a43" opacity=".75"/>',
    dunes: '<path d="M0 80 Q260 30 520 74 T960 60 V120 H0Z" fill="#e2a65a" opacity=".85"/><path d="M0 100 Q300 64 600 98 T960 92 V120 H0Z" fill="#c9843d" opacity=".85"/>',
    neige: '<g fill="#fff"><circle cx="60" cy="20" r="2.2"/><circle cx="220" cy="44" r="1.8"/><circle cx="400" cy="16" r="2.2"/><circle cx="580" cy="40" r="1.8"/><circle cx="760" cy="22" r="2.2"/><circle cx="900" cy="50" r="1.8"/></g><path d="M0 96 Q240 78 480 94 T960 88 V120 H0Z" fill="#fff"/>',
    abysses: '<path d="M200 -10 L120 130 M520 -10 L480 130 M840 -10 L900 130" stroke="#7fe0ff" stroke-width="40" opacity=".05"/>',
    neon: '<path d="M0 70 H960 M0 90 H960 M0 110 H960 M160 70 L60 120 M400 70 L360 120 M560 70 L600 120 M800 70 L900 120" stroke="#ff3cac" stroke-width="1.2" opacity=".5"/>',
    planetes: '<circle cx="860" cy="60" r="44" fill="#c26b3b"/><ellipse cx="860" cy="60" rx="72" ry="13" fill="none" stroke="#f0c89a" stroke-width="4" opacity=".8"/><circle cx="90" cy="80" r="18" fill="#6b8cff"/><g fill="#fff"><circle cx="300" cy="20" r="1.4"/><circle cx="520" cy="40" r="1"/><circle cx="660" cy="12" r="1.3"/></g>',
  };
  // La règle de la maquette qui tire d'un thème de Hestia les champs d'un thème du catalogue.
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (c) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, k) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v * (1 - k) + y[i] * k)); };
  const rgba = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
  /** Une couleur CSS en [couleur #rrggbb, opacité]. */
  const couleur = (c) => { const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/); if (m) return [toHex([+m[1], +m[2], +m[3]]), m[4] === undefined ? 1 : +m[4]]; return /^#/.test(c) ? [c.slice(0, 7), 1] : ['#202020', 1]; };
  // L'ambiance animée de chaque décor (pour plus tard : le fond qui vit ; à plat, elle ne sert pas).
  const SCENES = { vagues: 'waves', etoiles: 'stars', aurore: 'aurora', lagon: 'waves', soleil: 'sunset', montagnes: 'snow', feuilles: 'leaves', dunes: 'orbs', neige: 'snow', abysses: 'bubbles', neon: 'neon', planetes: 'stars' };
  function depuisHestia(id, h) {
    const dark = !(id === 'clair' || h.light === true), [sc, al] = couleur(h.card);
    return {
      dark, sc, gt: Math.round(Math.max(0, Math.min(1, (0.94 - al) / 0.86)) * 100), blur0: 18, sheen: dark ? 0.08 : 0.4, scene: SCENES[h.decor] || (dark ? 'orbs' : 'none'), mascot: h.accent2 || h.accent,
      bg: h.bg2, blob1: h.accent, blob2: h.accent2, blobO: dark ? 0.14 : 0.2, surface: h.card, solid: /^#/.test(h.card2) ? h.card2 : (dark ? mix(h.bg, '#ffffff', 0.08) : '#ffffff'), border: h.line, blur: 18, sat: 1.3,
      shadow: dark ? '0 14px 34px rgba(0,0,0,.35)' : '0 8px 24px rgba(0,0,0,.07)',
      ink: h.text, muted: h.muted, accent: h.accent, onA: h.on, onB: `linear-gradient(135deg,${h.accent2},${mix(h.accent2, '#000000', 0.25)})`, pal: [h.accent, h.accent2, '#a35bff', '#16c1e6', '#2fcf92'],
      side: dark ? rgba(mix(h.bg, '#ffffff', 0.03), 0.8) : 'rgba(255,255,255,.7)', chip: dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.045)', sel: dark ? 'rgba(255,255,255,.12)' : rgba(h.accent, 0.12),
      track: dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)', line: dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)', radius: 20,
      good: dark ? '#6CCFB8' : '#1D7F68', warn: dark ? '#F0B860' : '#8F6200', bad: dark ? '#EE8A70' : '#B23F2A',
    };
  }
  for (const [id, h] of Object.entries(HESTIA)) THEMES[`h-${id}`] = depuisHestia(id, h);
  window.OdinCatalogueThemes = { NOMS, THEMES, HESTIA, DECORS, ACCENT_TEXTE };
})();
