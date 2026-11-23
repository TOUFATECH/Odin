// Venus dans Odin : les icônes et les planètes du dépôt TOUFATECH/Venus (licence MIT, voir LICENSE), recopiées.
//   - P (icônes) : public/js/ui.js, tel quel ;
//   - LAYOUTS, PLANETS et le calcul des couleurs (themeVars, applyTheme, passage au clair, Verre, vagues) : public/js/themes.js.
// Seul changement : rien n'est envoyé à un serveur d'ici ; le choix est gardé par app.js (profil d'Odin, base VENUS_ODIN).
// Fichier chargé tel quel par la page /venus/app/ (avant app.js), jamais par l'interface d'Odin.
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const J = (a) => (Array.isArray(a) ? a.flat(9).filter((x) => x != null && x !== false).join('') : a || '');
const hueOf = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
/* ---------------------------------------------------------------- icônes : public/js/ui.js (objet P, recopié tel quel) */
const P = {
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.6 2H4.4z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/><path d="M10 20.5a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  multi: '<rect x="3" y="4" width="8" height="7" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/><rect x="13" y="4" width="8" height="7" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/><rect x="3" y="13" width="8" height="7" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/><rect x="13" y="13" width="8" height="7" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.3a9.5 9.5 0 0 1 13 0M8.6 15.5a5 5 0 0 1 6.8 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>',
  server: '<rect x="3.5" y="4" width="17" height="7" rx="1.8" stroke="currentColor" stroke-width="2" fill="none"/><rect x="3.5" y="13" width="17" height="7" rx="1.8" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="7.5" cy="7.5" r="1.1" fill="currentColor"/><circle cx="7.5" cy="16.5" r="1.1" fill="currentColor"/>',
  people: '<circle cx="9" cy="8.5" r="3.2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="16.5" cy="9.5" r="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M15.5 14.2c2.6-.3 4.5 1.3 5 4.3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  glow: '<rect x="6" y="7.5" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M3 5l2 1.5M21 5l-2 1.5M3 19l2-1.5M21 19l-2-1.5M12 3v2M12 19v2M2 12h2M20 12h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  chat: '<path d="M4 5.5h16v10H9l-5 4z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  send: '<path d="M4 12l16-7-6 16-2.5-6.5z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  remote: '<rect x="7" y="2.5" width="10" height="19" rx="3" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="9" r="2.2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M10 15h4M10 18h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  disk: '<ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/><path d="M17 3.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" fill="currentColor"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" stroke="currentColor" stroke-width="2" fill="none"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  add: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  more: '<circle cx="5.5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor"/>',
  spark: '<path d="M12 3.5l2.1 5.7 5.9.4-4.6 3.8 1.5 5.8L12 16l-4.9 3.2 1.5-5.8L4 9.6l5.9-.4z" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linejoin="round"/>',
  note: '<path d="M9 18V6l10-2v12" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.6" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="16.5" cy="16" r="2.6" stroke="currentColor" stroke-width="2" fill="none"/>',
  live: '<rect x="3" y="7" width="18" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 3l4 4 4-4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="13" r="2" fill="currentColor"/>',
  shuffle: '<path d="M4 7h3.5c2 0 3.2 1 4.3 2.7l.4.6M4 17h3.5c2 0 3.2-1 4.3-2.7l2.4-3.6C15.3 9 16.5 8 18.5 8H20M17 5l3 3-3 3M17 13l3 3-3 3M20 16h-1.5c-1.6 0-2.7-.6-3.6-1.7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  up: '<path d="M6 15l6-6 6 6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  download: '<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  'eye-off': '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>',
  sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  dot: '<circle cx="12" cy="12" r="2.2" fill="currentColor" opacity=".35"/>',
  clip: '<rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/>',
  apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>',
  grid4: '<rect x="4" y="4" width="6.5" height="9" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/><rect x="13.5" y="4" width="6.5" height="9" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 17h6.5M13.5 17H20M4 20h6.5M13.5 20H20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  rows: '<rect x="3.5" y="5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.9" fill="none"/><rect x="3.5" y="14" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.9" fill="none"/><path d="M11.5 6.5H20M11.5 9H17M11.5 15.5H20M11.5 18H17" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  gauge: '<path d="M4.5 17a8 8 0 1 1 15 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 13.5l4-4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="14" r="1.6" fill="currentColor"/>',
  key: '<circle cx="8" cy="15" r="4" stroke="currentColor" stroke-width="2" fill="none"/><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  power: '<path d="M12 3.5v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M7.2 6.8a7 7 0 1 0 9.6 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  info: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 11v6M12 7.5v.1" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 12.6l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z" fill="currentColor"/>',
  prev: '<path d="M18 5.5v13a1 1 0 0 1-1.5.86L7 13.5V18.5H5v-13h2v5l9.5-5.86A1 1 0 0 1 18 5.5z" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  skip: '<path d="M5 6.2v11.6a.8.8 0 0 0 1.2.7l8.6-5.8a.8.8 0 0 0 0-1.4L6.2 5.5A.8.8 0 0 0 5 6.2z" fill="currentColor"/><rect x="16.5" y="5.5" width="2.5" height="13" rx="1" fill="currentColor"/>',
  fwd: '<path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  vol: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  eps: '<rect x="3.5" y="5" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M18 7v8.5a1.5 1.5 0 0 1-1.5 1.5H7M21 10v8.5a1.5 1.5 0 0 1-1.5 1.5H10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  back: '<path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2.2" fill="none"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  home: '<path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" fill="currentColor"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 5v14M16 5v14M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5" stroke="currentColor" stroke-width="1.8"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 20h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  list: '<path d="M6 4.5h12a1 1 0 0 1 1 1V20l-7-4-7 4V5.5a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  gear: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.4 7.4 0 0 1-2 1.2L14.8 21h-4l-.3-2.4a7.4 7.4 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7.6 7.6 0 0 1 0-2.4L4.6 9.9l2-3.4 1.9.7a7.4 7.4 0 0 1 2-1.2L10.8 3h4l.3 2.4a7.4 7.4 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7.6 7.6 0 0 1 0 2.4z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  subs: '<rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M7 12h4M13 12h4M7 15.5h7M16 15.5h1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  fit: '<rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M7 10l-2 2 2 2M17 10l2 2-2 2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  fs: '<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  next: '<path d="M6 5.5v13a1 1 0 0 0 1.5.86L17 13.5V18.5h2v-13h-2v5L7.5 4.64A1 1 0 0 0 6 5.5z" fill="currentColor"/>',
  r10: '<path d="M12 5a7 7 0 1 1-6.6 4.7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 2L8.5 5 12 8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.6" text-anchor="middle" font-size="7" font-weight="800" fill="currentColor" font-family="system-ui">10</text>',
  f10: '<path d="M12 5a7 7 0 1 0 6.6 4.7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 2l3.5 3L12 8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.6" text-anchor="middle" font-size="7" font-weight="800" fill="currentColor" font-family="system-ui">10</text>',
  cast: '<path d="M3 8V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M3 12a7 7 0 0 1 7 7M3 15.5A3.5 3.5 0 0 1 6.5 19" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="3.5" cy="18.5" r="1.2" fill="currentColor"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.2A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.8L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  pip: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5" stroke="currentColor" stroke-width="2" fill="none"/><rect x="11.5" y="11.5" width="7.5" height="5.5" rx="1.2" fill="currentColor"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" stroke="currentColor" stroke-width="2"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="9" cy="10" r="1.8" fill="currentColor"/><path d="M5 17.5l4.5-4.5 3 3 2.5-2.5 4 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  book: '<path d="M5 4.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/><path d="M5 17a3 3 0 0 1 3-3h9.5M9 8.5h5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  chapters: '<path d="M4 6h3M4 12h3M4 18h3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M10 6h10M10 12h10M10 18h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  speed: '<path d="M4.5 16.5a8 8 0 1 1 15 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 14.5l4-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="14.5" r="1.6" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="2" fill="none"/>',
  exit: '<path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  folder: '<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17z" fill="currentColor" opacity=".8"/>',
  restart: '<path d="M5 12a7 7 0 1 0 2.1-5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M5 4v4h4" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
};
const I = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;

/* ---------------------------------------------------------------- thèmes : public/js/themes.js (recopié, sans l'envoi au serveur) */
const LAYOUTS = { rail: 'Menu d’icônes à gauche', side: 'Grand menu à gauche', dock: 'Barre flottante en bas', stream: 'Menu en haut, style streaming', tv: 'Grands onglets, pour la télé', glass: 'Surfaces givrées', lagon: 'Barre en haut et bloc « Ce soir »' };
const LAYOUT_OF = { venus: 'rail', pluton: 'rail', uranus: 'rail', mercure: 'side', saturne: 'side', jupiter: 'side', terre: 'dock', neptune: 'dock', mars: 'stream', cinema: 'stream', noir: 'tv', blanc: 'dock', tv: 'tv', verre: 'glass', lagon: 'lagon', ocean: 'lagon', sable: 'lagon' };
const layoutOf = (id) => LAYOUT_OF[id] || 'rail';
const PLANETS = {
  mercure: { night: '#101113', deep: '#18191d', raise: '#24262b', glow: '#b9b0a4', name: 'Mercure', accent: '#dccdb9', accent2: '#9c8c7e', dir: 'diag', bands: ['#ddd6cc', '#bdb3a7', '#d3cabe', '#a69a8c', '#c7bcae', '#91857a', '#c0b4a6', '#7c7065'], surface: 'craters', fx: '#f3eee6' },
  venus: { night: '#120e0d', deep: '#1c1615', raise: '#29201e', glow: '#e3907a', name: 'Venus', accent: '#f4cf9c', accent2: '#e3907a', dir: 'diag', bands: ['#fce9cb', '#f0c08b', '#fde5c3', '#e79f7b', '#f7d2a3', '#d88469', '#efbb88', '#b9634f'], surface: 'clouds', fx: '#fff4e2' },
  terre: { night: '#06101c', deep: '#0c1929', raise: '#14253a', glow: '#3d8fd1', name: 'Terre', accent: '#86cdf6', accent2: '#68d29c', dir: 'diag', bands: ['#7fc4ef', '#3d8fd1', '#5aaee6', '#2f76bd', '#4b9ddd', '#2a69ad', '#3f8bcf', '#1f4f8a'], surface: 'continents', fx: '#ffffff' },
  mars: { night: '#140b09', deep: '#201311', raise: '#2d1b17', glow: '#d5583b', name: 'Mars', accent: '#ff9a6e', accent2: '#d5583b', dir: 'diag', bands: ['#f6b48c', '#de7a52', '#eea079', '#c9603f', '#e48c64', '#b44f33', '#d97a55', '#8f3a24'], surface: 'craters', fx: '#ffd9c2' },
  jupiter: { night: '#120e0a', deep: '#1d1711', raise: '#2a2119', glow: '#c97c50', name: 'Jupiter', accent: '#f3c48f', accent2: '#c97c50', dir: 'flat', bands: ['#f6e3c6', '#d9a774', '#f2dcbc', '#b97a52', '#efd2ad', '#c58a5c', '#ead0ae', '#9c5f3f'], surface: 'spot', fx: '#c4553c' },
  saturne: { night: '#11100a', deep: '#1c1a11', raise: '#28251a', glow: '#c9a766', name: 'Saturne', accent: '#f1d99f', accent2: '#c9a766', dir: 'flat', ring: true, bands: ['#f7ebc9', '#e2c98f', '#f3e3b7', '#d3b479', '#efdcaa', '#c9a86b', '#e8d29d', '#a98a52'], surface: 'stripes', fx: '#fff6dc' },
  uranus: { night: '#061314', deep: '#0c1d20', raise: '#14292d', glow: '#58bcc7', name: 'Uranus', accent: '#97e6ec', accent2: '#58bcc7', dir: 'flat', bands: ['#d2f6f7', '#a6e6ea', '#c1f0f2', '#8fd8de', '#b3eaee', '#7ccbd3', '#a4e1e6', '#5fb1bb'], surface: 'stripes', fx: '#f2ffff' },
  neptune: { night: '#080b1c', deep: '#0f1430', raise: '#192046', glow: '#5c6cff', name: 'Neptune', accent: '#9db8ff', accent2: '#6f7dff', dir: 'flat', bands: ['#8fb2ff', '#4f74e6', '#7798f7', '#3c5bd1', '#6a8cf0', '#3350c2', '#5c7de6', '#25399a'], surface: 'spot', fx: '#1d2c7a' },
  pluton: { night: '#130e10', deep: '#1d1619', raise: '#2a2024', glow: '#c99a8a', name: 'Pluton', accent: '#f2c9b8', accent2: '#c98f86', dir: 'diag', bands: ['#f3e2d6', '#d8b8a5', '#efd8c9', '#c6a08c', '#e8cdbb', '#b48b78', '#dfc1ae', '#8f6a5a'], surface: 'heart', fx: '#fbf1ea' },
  noir: { night: '#000000', deep: '#0b0b0b', raise: '#171717', glow: '#bdbdbd', name: 'Noir', accent: '#ffffff', accent2: '#9a9a9a', dir: 'diag', mono: true, bands: ['#5a5a5a', '#2b2b2b', '#4a4a4a', '#1c1c1c', '#3c3c3c', '#141414', '#303030', '#050505'], surface: 'craters', fx: '#d9d9d9' },
  blanc: { night: '#f3f3f3', deep: '#ffffff', raise: '#e6e6e6', glow: '#9a9a9a', name: 'Blanc', accent: '#111111', accent2: '#5c5c5c', dir: 'diag', mono: true, light: true, bands: ['#ffffff', '#e9e9e9', '#fafafa', '#d6d6d6', '#f2f2f2', '#c8c8c8', '#ececec', '#b4b4b4'], surface: 'clouds', fx: '#ffffff' },
  tv: { night: '#050505', deep: '#121212', raise: '#1f1f1f', glow: '#ffffff', name: 'TV', accent: '#ffffff', accent2: '#b5b5b5', dir: 'flat', mono: true, bands: ['#ffffff', '#111111', '#f2f2f2', '#1a1a1a', '#e6e6e6', '#0d0d0d', '#d9d9d9', '#000000'], surface: 'stripes', fx: '#ffffff' },
  cinema: { night: '#141414', deep: '#181818', raise: '#2f2f2f', glow: '#e50914', name: 'Cinéma', accent: '#e50914', accent2: '#b20710', dir: 'diag', mono: true, topnav: true, bands: ['#ff4b55', '#e50914', '#b20710', '#7a0a0f', '#e50914', '#5a0509', '#c40812', '#2a0204'], surface: 'spot', fx: '#ff8088' },
  verre: { night: '#0b0b0d', deep: '#1c1c1e', raise: '#2c2c2e', glow: '#8fb8ff', name: 'Verre', brand: 'Venus', accent: '#2997ff', accent2: '#5e5ce6', dir: 'diag', glass: true, bands: ['#ffffff', '#e4ecf7', '#f6f8fc', '#cddcf0', '#eef3fa', '#b9cbe6', '#e2eaf6', '#9fb4d6'], surface: 'clouds', fx: '#ffffff' },
  lagon: { night: '#06161b', deep: '#0c2229', raise: '#123039', glow: '#2fd4c3', name: 'Lagon', accent: '#2fd4c3', accent2: '#ff8a6a', dir: 'flat', day: 'sable', paper: '#eef3ee', haze: '#9fb3b4', dim: '#5f7577', bands: ['#a6f3ea', '#2fd4c3', '#7fe8dc', '#17a89a', '#5fdfd0', '#0f8a7f', '#3fcdbd', '#0a5b55'], surface: 'atoll', fx: '#ff8a6a' },
  ocean: { night: '#03101f', deep: '#082038', raise: '#0e2f4f', glow: '#4fa3ff', name: 'Océan', accent: '#4fa3ff', accent2: '#ffb36b', dir: 'flat', day: 'sable', waves: true, paper: '#eaf2fb', haze: '#9db4cc', dim: '#5d7590', bands: ['#a8d4ff', '#4fa3ff', '#7ebfff', '#2d7fe0', '#5facff', '#1f63bd', '#3b8df0', '#143f85'], surface: 'waves', fx: '#eaf6ff' },
  sable: { night: '#f4efe6', deep: '#ffffff', raise: '#e6ddcf', glow: '#0f9f93', name: 'Sable', accent: '#0f9f93', accent2: '#e0634a', dir: 'flat', light: true, paper: '#10272c', haze: '#51666a', dim: '#7d8f92', bands: ['#fff7ea', '#f4efe6', '#fff3e0', '#e6ddcf', '#fbf1e2', '#d8cbb8', '#efe4d3', '#c9b89f'], surface: 'atoll', fx: '#0f9f93' },
};
const T = { chosen: 'venus', auto: 'system', glass: 'auto', lite: 'auto' };
const systemLight = () => { try { return matchMedia('(prefers-color-scheme: light)').matches; } catch { return false; } };
const sunDay = () => { const hr = new Date().getHours(); return hr >= 7 && hr < 18; };
function currentPlanet() {
  const base = T.chosen;
  if (PLANETS[base].glass || PLANETS[base].light) return base;
  const day = PLANETS[base].day || 'blanc';
  if (T.auto === 'system') return systemLight() ? day : base;
  if (T.auto === 'sun') return sunDay() ? day : base;
  return base;
}
const planet = () => PLANETS[currentPlanet()];
const brandName = () => (planet().brand || planet().name).toUpperCase();
function surface(t) {
  const twice = (f) => f(0) + f(48); const fx = t.fx;
  switch (t.surface) {
    case 'clouds': return twice((o) => `<path d="M${o - 2} 25c9-4 17 3 26-1s18-3 22 1" stroke="${fx}" stroke-opacity=".5" stroke-width="2" fill="none"/><path d="M${o - 2} 41c8 3 16-4 25 0s16 3 23-1" stroke="${fx}" stroke-opacity=".35" stroke-width="1.5" fill="none"/><path d="M${o + 8} 50c6-2 12 1 18-1" stroke="${fx}" stroke-opacity=".3" stroke-width="1.2" fill="none"/>`);
    case 'continents': return twice((o) => `<path d="M${o + 6} 22c4-3 10-2 12 2s-1 8 2 11-2 7-6 6-5-5-8-6-4-9 0-13z" fill="#5cc48a"/><path d="M${o + 28} 38c3-2 8-1 9 3s-3 6-6 5-5-6-3-8z" fill="#7fd29b"/><path d="M${o + 33} 18c3 0 6 2 5 4s-5 2-6 0 0-4 1-4z" fill="#4fb07c"/><path d="M${o} 30c7-2 14 1 20-1" stroke="${fx}" stroke-opacity=".7" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M${o + 22} 47c6-2 12 0 18-2" stroke="${fx}" stroke-opacity=".6" stroke-width="1.6" stroke-linecap="round" fill="none"/>`);
    case 'craters': return twice((o) => `<circle cx="${o + 10}" cy="26" r="3.2" fill="#000" fill-opacity=".14"/><circle cx="${o + 24}" cy="40" r="4.5" fill="#000" fill-opacity=".12"/><circle cx="${o + 36}" cy="22" r="2.2" fill="#000" fill-opacity=".16"/><circle cx="${o + 16}" cy="49" r="2.6" fill="#000" fill-opacity=".12"/><circle cx="${o + 41}" cy="44" r="1.8" fill="${fx}" fill-opacity=".35"/>`);
    case 'spot': return twice((o) => `<ellipse cx="${o + 22}" cy="40" rx="6" ry="3.4" fill="${fx}" fill-opacity=".85"/><ellipse cx="${o + 22}" cy="40" rx="3" ry="1.5" fill="#fff" fill-opacity=".18"/><path d="M${o} 28c10-1 20 1 30 0s14 1 18 0" stroke="#fff" stroke-opacity=".25" stroke-width="1.3" fill="none"/>`);
    case 'stripes': return twice((o) => `<path d="M${o} 27c12-1 24 1 36 0s8 1 12 0" stroke="${fx}" stroke-opacity=".45" stroke-width="1.6" fill="none"/><path d="M${o} 43c10 1 22-1 32 0s12 0 16 0" stroke="#000" stroke-opacity=".1" stroke-width="2" fill="none"/><ellipse cx="${o + 30}" cy="35" rx="5" ry="1.4" fill="${fx}" fill-opacity=".35"/>`);
    case 'heart': return twice((o) => `<path d="M${o + 22} 46c-6-4-10-8-10-12a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 4-4 8-10 12z" fill="${fx}" fill-opacity=".8"/><circle cx="${o + 40}" cy="25" r="2.4" fill="#000" fill-opacity=".12"/>`);
    case 'atoll': return twice((o) => `<ellipse cx="${o + 14}" cy="26" rx="7" ry="4.2" fill="#fff" fill-opacity=".55"/><ellipse cx="${o + 14}" cy="26" rx="4.2" ry="2.3" fill="${t.bands[0]}" fill-opacity=".9"/><ellipse cx="${o + 36}" cy="41" rx="8.5" ry="5" fill="#fff" fill-opacity=".5"/><ellipse cx="${o + 36}" cy="41" rx="5.2" ry="2.8" fill="${t.bands[0]}" fill-opacity=".9"/><path d="M${o + 30} 22c2-1.5 4.5-1 5.5 1s-1 3.5-3 3-3.5-2.5-2.5-4z" fill="${fx}" fill-opacity=".9"/>`);
    case 'waves': return twice((o) => `<path d="M${o} 22c4-3 8-3 12 0s8 3 12 0 8-3 12 0 8 3 12 0" stroke="${fx}" stroke-opacity=".75" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M${o} 34c4-3 8-3 12 0s8 3 12 0 8-3 12 0 8 3 12 0" stroke="${fx}" stroke-opacity=".5" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M${o} 46c4-3 8-3 12 0s8 3 12 0 8-3 12 0 8 3 12 0" stroke="${fx}" stroke-opacity=".65" stroke-width="2" fill="none" stroke-linecap="round"/>`);
    default: return '';
  }
}
function weather(t) {
  const twice = (f) => f(0) + f(48);
  const c = t.surface === 'spot' && t.fx === '#1d2c7a' ? '#ffffff' : t.surface === 'spot' ? '#fff6e8' : t.fx;
  switch (t.surface) {
    case 'continents': return twice((o) => `<path d="M${o + 2} 19c6-2 11 1 16-1" stroke="#fff" stroke-opacity=".85" stroke-width="2.4" stroke-linecap="round" fill="none"/><path d="M${o + 20} 33c5-1 9 1 13 0" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round" fill="none"/>`);
    case 'clouds': return twice((o) => `<path d="M${o} 33c10-3 20 2 30-1s14-1 18 1" stroke="${c}" stroke-opacity=".45" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M${o + 10} 18c8-2 14 1 20 0" stroke="${c}" stroke-opacity=".35" stroke-width="2" stroke-linecap="round" fill="none"/>`);
    case 'spot': case 'stripes': return twice((o) => `<path d="M${o} 22c12 1 24-1 36 0s8 0 12 0" stroke="${c}" stroke-opacity=".28" stroke-width="1.4" fill="none"/><path d="M${o + 4} 48c10-1 20 1 30 0" stroke="${c}" stroke-opacity=".22" stroke-width="1.2" fill="none"/>`);
    case 'atoll': return twice((o) => `<path d="M${o + 2} 16c8-2 16 1 24-1s12-1 18 1" stroke="#fff" stroke-opacity=".5" stroke-width="2.2" stroke-linecap="round" fill="none"/>`);
    case 'waves': return twice((o) => `<path d="M${o} 28c3 2 6 2 9 0s6-2 9 0 6 2 9 0 6-2 9 0 6 2 9 0" stroke="#fff" stroke-opacity=".35" stroke-width="1.4" fill="none" stroke-linecap="round"/>`);
    default: return '';
  }
}
let markN = 0;
function planetMarkup(id = currentPlanet()) {
  const t = PLANETS[id] || PLANETS.venus; const n = ++markN;
  const [x1, y1, x2, y2] = t.dir === 'flat' ? [30, 8, 30, 60] : [22, 4, 36, 60];
  const stops = t.bands.map((c, i) => `<stop offset="${(i / (t.bands.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('');
  const ringBack = t.ring ? `<ellipse cx="30" cy="34" rx="31" ry="8" transform="rotate(-16 30 34)" fill="none" stroke="${t.bands[3]}" stroke-opacity=".55" stroke-width="3.2"/>` : '';
  const ringFront = t.ring ? `<path d="M-0.4 41.6A31 8 -16 0 0 59.8 24.4" fill="none" stroke="${t.bands[1]}" stroke-width="3.2" stroke-linecap="round"/>` : '';
  return `<svg class="mark planet-${id}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="pb${n}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient><radialGradient id="pn${n}" gradientUnits="userSpaceOnUse" cx="66" cy="28" r="46"><stop offset="0" stop-color="${t.night}" stop-opacity=".97"/><stop offset=".52" stop-color="${t.night}" stop-opacity=".9"/><stop offset=".74" stop-color="${t.night}" stop-opacity=".35"/><stop offset="1" stop-color="${t.night}" stop-opacity="0"/></radialGradient><radialGradient id="pa${n}" gradientUnits="userSpaceOnUse" cx="30" cy="34" r="31"><stop offset=".72" stop-color="${t.bands[0]}" stop-opacity=".55"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient><radialGradient id="pl${n}" gradientUnits="userSpaceOnUse" cx="19" cy="22" r="22"><stop offset="0" stop-color="#fffaf0" stop-opacity=".55"/><stop offset="1" stop-color="#fffaf0" stop-opacity="0"/></radialGradient><clipPath id="pd${n}"><circle cx="30" cy="34" r="24"/></clipPath></defs><circle class="atmo" cx="30" cy="34" r="31" fill="url(#pa${n})"/><g class="body">${ringBack}<g clip-path="url(#pd${n})"><rect width="64" height="64" fill="url(#pb${n})"/><g class="spin">${surface(t)}</g><g class="spin2">${weather(t)}</g><rect width="64" height="64" fill="url(#pl${n})"/><rect width="64" height="64" fill="url(#pn${n})"/></g>${ringFront}</g><path class="twinkle" d="M53 4.5l1.3 4.2 4.2 1.3-4.2 1.3-1.3 4.2-1.3-4.2-4.2-1.3 4.2-1.3z" fill="${t.fx === '#1d2c7a' || t.fx === '#c4553c' ? '#fff1d6' : t.fx}"/></svg>`;
}
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, k) => { const x = rgb(a), y = rgb(b); return `#${x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('')}`; };
const trip = (hex) => rgb(hex).join(' ');
const lum = (hex) => { const [r, g, b] = rgb(hex).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function legible(fg, bgs, min = 4.5) { const list = Array.isArray(bgs) ? bgs : [bgs]; const to = lum(list[0]) < 0.4 ? '#ffffff' : '#000000'; const worst = (c) => Math.min(...list.map((b) => contrast(c, b))); let c = fg; for (let k = 0.02; worst(c) < min && k <= 1; k += 0.02) c = mix(fg, to, k); return c; }
const GLASS = {
  day: { '--night': '#f2f2f5', '--deep': '#ffffff', '--raise': '#e8e8ed', '--paper': '#1d1d1f', '--haze': '#5f5f66', '--dim': '#8a8a90', '--sulfur': '#0071e3', '--dawn': '#5e5ce6', '--glow': '#0071e3', '--tint': '#7aa7e6', '--edge': 'rgb(0 0 0 / .1)' },
  night: { '--night': '#0b0b0d', '--deep': '#1c1c1e', '--raise': '#2c2c2e', '--paper': '#f5f5f7', '--haze': '#a1a1a8', '--dim': '#6e6e75', '--sulfur': '#2997ff', '--dawn': '#5e5ce6', '--glow': '#2997ff', '--tint': '#5a7fb8', '--edge': 'rgb(255 255 255 / .1)' },
};
function themeVars(id, glassState) {
  const t = PLANETS[id] || PLANETS.venus;
  const bands = `linear-gradient(${t.dir === 'flat' ? 180 : 172}deg, ${t.bands.map((c, i) => `${c} ${Math.round((i / (t.bands.length - 1)) * 100)}%`).join(', ')})`;
  if (t.glass) { const g = GLASS[glassState] || GLASS.night; return { ...g, '--dim': legible(g['--dim'], [g['--deep'], g['--night']]), '--night-rgb': trip(g['--night']), '--deep-rgb': trip(g['--deep']), '--raise-rgb': trip(g['--raise']), '--sulfur-rgb': trip(g['--sulfur']), '--planet-bands': bands }; }
  if (t.light) return { '--night': t.night, '--deep': t.deep, '--raise': t.raise, '--night-rgb': trip(t.night), '--deep-rgb': trip(t.deep), '--raise-rgb': trip(t.raise), '--sulfur': t.accent, '--sulfur-rgb': trip(t.accent), '--dawn': t.accent2, '--glow': t.glow, '--tint': t.paper ? t.accent : '#7a7a7a', '--paper': t.paper || '#111111', '--haze': t.haze || '#4f4f4f', '--dim': legible(t.dim || '#7d7d7d', [t.deep, t.night]), '--edge': 'rgb(0 0 0 / .12)', '--planet-bands': bands };
  const paper = t.paper || (t.mono ? '#f2f2f2' : mix('#eceae4', t.accent, 0.08));
  return { '--night': t.night, '--deep': t.deep, '--raise': t.raise, '--night-rgb': trip(t.night), '--deep-rgb': trip(t.deep), '--raise-rgb': trip(t.raise), '--sulfur': t.accent, '--sulfur-rgb': trip(t.accent), '--dawn': t.accent2, '--glow': t.glow, '--tint': t.accent, '--paper': paper, '--haze': t.haze || (t.mono ? '#a8a8a8' : mix('#a6a9b0', t.accent, 0.16)), '--dim': legible(t.dim || (t.mono ? '#727272' : mix('#6e727c', t.accent, 0.14)), [t.deep, t.night]), '--edge': `rgb(${trip(mix('#eceae4', t.accent, 0.4))} / .12)`, '--planet-bands': bands };
}
let lightSheet = null;
function lightOverrides() {
  if (lightSheet) return;
  const out = []; const re = /rgba\(\s*(236\s*,\s*234\s*,\s*228|255\s*,\s*255\s*,\s*255)\s*,\s*([.\d]+)\s*\)/g;
  const walk = (rules) => {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) { if (r.type === CSSRule.MEDIA_RULE || r.type === CSSRule.SUPPORTS_RULE) walk(r.cssRules); continue; }
      if (!r.selectorText || /\.player|\.p-|\.boot|\.mini|\.party|\.react|\.shot|\.bar\b|\.hero-bg|\.face/.test(r.selectorText)) continue;
      const decl = [];
      for (let i = 0; i < r.style.length; i++) { const prop = r.style[i]; const val = r.style.getPropertyValue(prop); if (/^(background|background-color|border|border-color|border-top|border-bottom|border-left|border-right|box-shadow|outline|outline-color|color)$/.test(prop) && /rgba\(\s*236/.test(val)) decl.push(`${prop}: ${val.replace(re, (m, c, a) => `rgba(29, 29, 31, ${Math.min(1, Number(a) * 0.9)})`)}`); }
      if (decl.length) out.push(`${r.selectorText.split(',').map((x) => `html[data-tone="light"] ${x.trim()}`).join(', ')} { ${decl.join('; ')} }`);
    }
  };
  for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch { /* */ } }
  lightSheet = document.createElement('style'); lightSheet.textContent = out.join('\n'); document.head.append(lightSheet);
}
function applyTheme() {
  const id = currentPlanet(), t = PLANETS[id], root = document.documentElement;
  const g = t.glass ? (T.glass === 'auto' ? (sunDay() ? 'day' : 'night') : T.glass) : null;
  if (g) root.dataset.glass = g; else delete root.dataset.glass;
  const light = g === 'day' || !!t.light;
  root.dataset.tone = light ? 'light' : 'dark';
  if (light) lightOverrides();
  for (const [k, v] of Object.entries(themeVars(id, g || undefined))) root.style.setProperty(k, v);
  root.dataset.planet = id;
  if (t.waves) root.dataset.waves = '1'; else delete root.dataset.waves;
  root.dataset.layout = layoutOf(id);
  root.classList.toggle('lite', T.lite === 'on');
}
