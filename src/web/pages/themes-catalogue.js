// Le catalogue des thèmes de la maquette validée (Accueil et écran de la maison, 15/11/2026) : ici, les thèmes
// « Mis en avant », faits à la main dans la maquette (sauf « Minuit », qui attend la réponse du propriétaire et reste
// pour l'instant celui d'Odin). Seulement des couleurs, des nombres et des codes, repris tels quels de la maquette ;
// les noms sont dans le dictionnaire ci-dessous. « glace » garde son identifiant : le décor de Glace, que la maquette
// dessine aussi, est déjà dans themes.js (il n'est pas recopié ici).
// Ce fichier ne fait rien d'autre que se publier sur la page (window.OdinCatalogueThemes) : themes.js, chargé juste
// après, le lit s'il est là. Pour l'instant les thèmes y sont « à plat » (fond uni, cartes pleines) : themes.js n'en
// prend que le fond, la carte pleine (solid), le texte, l'accent, la couleur d'Odin et le ton clair ou sombre.
(() => {
  // Les noms affichés (en tête du fichier, pour les traduire d'un seul endroit).
  const NOMS = {
    glace: 'Glace', vitre: 'Vitre', glacenuit: 'Glace nuit', neon: 'Néon', ha: 'Home Assistant', clair: 'Maison claire',
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
  window.OdinCatalogueThemes = { NOMS, THEMES };
})();
