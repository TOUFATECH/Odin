// Hestia — l'écran de la maison (tablette murale, téléphone, ordinateur, Home Assistant).
// Pièces et appareils, scènes, météo, état des applis, tes boutons, les thèmes, et la mascotte qui se promène,
// joue à la balle, répond (météo, heure, alertes) et fait ce que tu lui demandes (mêmes droits que dans Odin).
// Aucune page HTML construite à partir de texte : tout est créé élément par élément.
(() => {
  'use strict';
  // Textes du retour vers Odin (en haut de l'écran) et de la barre de côté (son titre, ses entrées, la punaise et ses deux
  // messages, la poignée, le pied) :
  // à un seul endroit. Le titre est le nom de l'entrée du menu d'Odin qui ouvre cet écran. Puis ceux du bandeau (le salut à
  // la maison, la semaine, les personnes à la maison) et des onglets de pièces. Puis ceux du téléphone (« Plus », le rond
  // d'Odin au centre de la barre du bas) et du plein écran (le bouton, et ce qu'il dit une fois ouvert).
  const MOTS = { maison: 'la maison', semaine: 'semaine', personne: 'personne à la maison', personnes: 'personnes à la maison', a: 'à', tout: 'Tout', pieces: 'Pièces', retour: '← Odin', retourTitre: 'Revenir à Odin', titre: 'Home Assistant', sections: 'Sections', epingler: 'Garder la barre ouverte', ouvrir: 'Ouvrir le menu', epinglee: 'La barre reste ouverte.', libre: 'La barre se cache seule ; passe la souris à gauche pour la voir.', veille: 'Odin veille', accueil: 'Accueil', famille: 'Famille', cameras: 'Caméras', reseau: 'Réseau', applis: 'Mes applis', boutons: 'Boutons', themes: 'Thèmes', plus: 'Plus', odin: 'Parler à Odin', plein: 'Plein écran', pleinSortir: 'Quitter le plein écran (Échap)' };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // ---------- Clé de tablette : lue dans #cle=…, gardée sur l'appareil, retirée de l'adresse ----------
  let key = '';
  try { const m = /(?:^|[#&])cle=(gk_[A-Za-z0-9_-]{30,60})/.exec(location.hash); if (m) { key = m[1]; localStorage.setItem('odin.maison.cle', key); history.replaceState(null, '', location.pathname); } else key = localStorage.getItem('odin.maison.cle') || ''; } catch { /* navigation privée */ }
  const H = () => ({ 'x-odin': '1', 'content-type': 'application/json', ...(key ? { 'x-odin-maison': key } : {}) });
  const api = async (path, body) => {
    const r = await fetch(path, body ? { method: 'POST', headers: H(), body: JSON.stringify(body), credentials: 'same-origin' } : { headers: key ? { 'x-odin-maison': key } : {}, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({ ok: false, error: `erreur ${r.status}` }));
    if (r.status === 401) throw Object.assign(new Error(j.error || 'connexion requise'), { auth: true });
    return j;
  };
  const el = (t, a = {}, ...kids) => {
    const n = t === 'svg' || a.svg ? document.createElementNS('http://www.w3.org/2000/svg', t) : document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false || k === 'svg') continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.setAttribute('class', v); else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v); else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const S = (t, a = {}, ...k) => el(t, { ...a, svg: true }, ...k);
  // Petites icônes dessinées ici (traits simples).
  const ICON = {
    home: 'M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
    palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.2-1.6-.4-1 .3-2.4 1.6-2.4H17a4 4 0 0 0 4-4c0-5-4-10-9-10zM7.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
    bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
    send: 'M4 12 20 4l-6 16-3-7z', sound: 'M4 9h4l5-4v14l-5-4H4zM17 8a5 5 0 0 1 0 8', up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', stop: 'M8 8h8v8H8z', minus: 'M6 12h12', plus: 'M12 6v12M6 12h12',
    net: 'M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M2 8.5a15 15 0 0 1 20 0', cam: 'M3 7h11v10H3zM14 10l7-3v10l-7-3', people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-5M21 20a5 5 0 0 0-4-4.9',
    prev: 'M7 6v12M18 6 9 12l9 6z', next: 'M17 6v12M6 6l9 6-9 6z', play: 'M8 5v14l11-7z', pause: 'M8 5h3v14H8zM13 5h3v14h-3z', lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z', open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7', back: 'M15 6l-6 6 6 6', chev: 'M9 6l6 6-6 6',
    more: 'M4 7h16M4 12h16M4 17h16', plein: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5', sortir: 'M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4',
  };
  const icon = (k, size = 20) => S('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', class: 'ic' }, S('path', { d: ICON[k], fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

  // ---------- Thèmes (d'après tes images) ----------
  // Les 31 thèmes de l'écran de la maison et leurs 13 décors dessinés sont lus dans le catalogue des thèmes
  // (src/web/pages/themes-catalogue.js, chargé juste avant ce fichier) : une seule source, plus de copie ici.
  // La règle des identifiants : sur cet écran, un identifiant sans préfixe est d'abord un thème de Hestia (c'est ce que
  // rangent les réglages de Hestia et le navigateur d'une tablette). Un thème d'Odin ou un thème fait main du même
  // identifiant (« ocean », « clair », « neon »…) n'est jamais pris à sa place.
  const CATALOGUE = window.OdinCatalogueThemes || {};
  // Si le catalogue ne s'est pas chargé : un style de secours sombre et lisible (ce n'est pas un thème), pour que
  // l'écran et la section Thèmes restent utilisables au lieu de couleurs vides.
  const SECOURS = { bg: '#16181d', bg2: '#16181d', card: '#20232a', card2: '#292d36', line: '#353a46', text: '#eef0f6', muted: '#a3a9b8', accent: '#ff8a3d', accent2: '#3fa9ff', on: '#b5541a' };
  const T = CATALOGUE.HESTIA || { verre: SECOURS };
  const themeHestia = (id) => (Object.hasOwn(T, String(id)) ? T[id] : T.verre || {});
  // Un thème de la liste d'Odin (ses familles hors Hestia : « Mis en avant », dont « Home Assistant » et « Maison
  // claire » ; « Les thèmes d'Odin » ; « Événements de l'année ») est rangé ici avec le préfixe « o- » (« o-ha »,
  // « o-nuit », « o-ev-noel »). Un thème fait main a ses champs dans le catalogue ; un thème d'Odin ou d'événement les
  // reçoit de la règle de la maquette (fromOdin, dans le catalogue). Ses dix couleurs d'écran en sont tirées : le fond
  // uni (la première couleur de la dernière couche de son fond, pour la barre du navigateur), tout son fond (avec son
  // décor), la carte (sa couleur pleine si la carte est un dégradé), une carte un peu plus marquée, le bord, le texte, le
  // texte discret, l'accent, la couleur d'Odin et le bouton allumé. Un « o-… » inconnu, ou Valhalla (le thème d'origine
  // d'Odin, sans couleurs à lui), donne le thème de départ de cet écran.
  const derniereCouche = (bg) => { let p = 0, d = 0; for (let i = 0; i < bg.length; i++) { const c = bg[i]; if (c === '(') p++; else if (c === ')') p--; else if (c === ',' && p === 0) d = i + 1; } return bg.slice(d); };
  const unie = (c) => /^(#[0-9a-f]{3,8}|rgba?\([^()]*\))$/i.test(String(c ?? '').trim());
  // Les mélanges et les contrastes sont ceux du catalogue (une seule règle de couleurs) ; un thème d'Odin n'est dessiné
  // ici que si le catalogue est là.
  const hexa = (c) => /^#[0-9a-f]{6}$/i.test(String(c));
  const melange = (a, b, k) => (hexa(a) && hexa(b) ? CATALOGUE.mix(a, b, k) : a);
  // La couleur du texte posé sur « allumé » (tuile allumée, logo), règle de la maquette : sombre quand le blanc se lit
  // mal (moins de 2,9 pour 1) sur la moyenne des couleurs du dégradé. Les thèmes de Hestia gardent leur texte blanc.
  const encreSur = (g) => { const cs = String(g ?? '').match(/#[0-9a-f]{6}\b/gi); if (!cs) return '#ffffff'; const m = `#${[1, 3, 5].map((i) => Math.round(cs.reduce((s, c) => s + parseInt(c.slice(i, i + 2), 16), 0) / cs.length).toString(16).padStart(2, '0')).join('')}`; return CATALOGUE.contrast('#ffffff', m) < 2.9 ? '#2a1a00' : '#ffffff'; };
  function depuisOdin(t) {
    const fond = (derniereCouche(String(t.bg ?? '')).match(/#[0-9a-f]{6}\b/i) || [t.solid])[0];
    return { bg: fond, bg2: t.bg, card: unie(t.surface) ? t.surface : t.solid, card2: melange(t.solid, t.ink, t.dark ? 0.08 : 0.04), line: t.border, text: t.ink, muted: t.muted, accent: t.accent, accent2: t.mascot, on: t.onA, onInk: encreSur(t.onA), light: t.dark === false };
  }
  const FAIT_MAIN = CATALOGUE.THEMES || {}, ODIN = CATALOGUE.ODIN || {}, EVENEMENTS = CATALOGUE.EVENEMENTS || {};
  // Les familles de la page « Thèmes », dans l'ordre et sous les titres de Réglages → Apparence.
  const FAMILLES_THEMES = { enavant: 'Mis en avant', odin: 'Les thèmes d\'Odin', hestia: 'Thèmes de Hestia', evenements: 'Événements de l\'année' };
  /** Les champs d'un thème de la liste d'Odin (son identifiant d'Odin, sans « o- ») ; rien si on ne sait pas le dessiner. */
  const champsOdin = (k) => {
    if (k.startsWith('h-')) return null;
    if (Object.hasOwn(FAIT_MAIN, k)) return FAIT_MAIN[k];
    const t = Object.hasOwn(ODIN, k) ? ODIN[k] : Object.hasOwn(EVENEMENTS, k) ? EVENEMENTS[k] : null;
    return t && t.sky && typeof CATALOGUE.fromOdin === 'function' ? CATALOGUE.fromOdin(t, FAMILLES_THEMES[Object.hasOwn(EVENEMENTS, k) ? 'evenements' : 'odin']) : null;
  };
  const themeMaison = (id) => { const t = String(id).startsWith('o-') ? champsOdin(String(id).slice(2)) : null; return t ? depuisOdin(t) : themeHestia(id); };
  // La famille d'un identifiant de cet écran, comme Réglages la range : sans préfixe, Hestia ; « o-ev-… », les
  // événements ; un thème fait main du catalogue, « Mis en avant » ; les autres « o-… », les thèmes d'Odin.
  const familleTheme = (id) => { const s = String(id), k = s.slice(2); return !s.startsWith('o-') ? 'hestia' : k.startsWith('ev-') ? 'evenements' : Object.hasOwn(FAIT_MAIN, k) && !k.startsWith('h-') ? 'enavant' : 'odin'; };
  const css = el('style');
  document.head.append(css);
  // Décors (SVG du catalogue, posés en bas de l'écran, derrière les cartes).
  const DECOR = CATALOGUE.DECORS || {};
  const decorUrl = (k) => (DECOR[k] ? `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 -30 960 150' preserveAspectRatio='xMidYMax slice'>${DECOR[k].replace(/"/g, "'")}</svg>`)}")` : 'none');
  function applyTheme(name) {
    const t = themeMaison(name);
    document.body.style.setProperty('--decor', decorUrl(t.decor));
    css.textContent = `:root{--bg:${t.bg};--bg2:${t.bg2};--card:${t.card};--card2:${t.card2};--line:${t.line};--text:${t.text};--muted:${t.muted};--accent:${t.accent};--accent2:${t.accent2};--on:${t.on};--on-ink:${t.onInk || '#ffffff'};--good:#34c77b;--warn:#f0a020;--bad:#ef4f43;color-scheme:${name === 'clair' || t.light ? 'light' : 'dark'}}${BASE}`;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.bg);
  }
  const BASE = `
@font-face{font-family:Plex;src:url(/fonts/ibm-plex-sans-latin-400-normal.woff2) format('woff2');font-weight:400}@font-face{font-family:Plex;src:url(/fonts/ibm-plex-sans-latin-600-normal.woff2) format('woff2');font-weight:600}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}body{background:var(--decor,none) center bottom/100% auto no-repeat fixed,var(--bg2);background-attachment:fixed;color:var(--text);font:15px/1.4 Plex,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
button{font:inherit;color:inherit;cursor:pointer}button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.app{display:grid;grid-template-columns:auto 1fr;min-height:100vh}
.side{position:sticky;top:0;height:100vh;width:232px;display:flex;flex-direction:column;gap:4px;padding:12px 10px;overflow-y:auto;border-right:1px solid var(--line);background:color-mix(in srgb,var(--card) 60%,transparent)}
/* Le titre de la barre sur une ligne : le logo (un décor, pas une cible) à la taille de la maquette (32 px), la punaise (44 px) avancée dans la marge. */
.side .hd{display:flex;align-items:center;gap:6px;padding:2px 0 14px}.side .hd span{flex:1;min-width:0;font-weight:600;font-size:17px;overflow-wrap:anywhere}
.logo{width:44px;height:44px;border-radius:14px;background:var(--on);display:grid;place-items:center;font-weight:700;font-size:24px;color:var(--on-ink);flex:none}
.pinb{width:44px;height:44px;border-radius:12px;border:0;background:transparent;color:var(--muted);display:grid;place-items:center;flex:none}.pinb[aria-pressed=true]{color:var(--text);background:var(--card2)}
.side .hd .logo{width:32px;height:32px;border-radius:9px;font-size:18px}.side .hd .pinb{margin-right:-6px}
.nav{width:48px;height:48px;border-radius:14px;border:0;background:transparent;color:var(--muted);display:grid;place-items:center;text-decoration:none}
.side .nav{width:100%;height:auto;min-height:44px;display:flex;align-items:center;justify-content:flex-start;gap:12px;padding:0 12px;text-align:left;font-size:14.5px}.side .nav span{min-width:0;overflow-wrap:anywhere}.side .nav .ic{flex:none}
.side .sp{flex:1}.side .veille{padding:10px 12px;margin-top:4px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
.nav[aria-current=page]{background:var(--card2);color:var(--accent);box-shadow:inset 0 0 0 1px var(--line)}.side .nav[aria-current=page]{color:var(--text)}
/* La barre non épinglée (la maquette) : cachée sur le côté, hors du clavier et des lecteurs d'écran ; ouverte (la souris au bord,
   la poignée), elle passe au-dessus du contenu avec une ombre, sans le décaler. Épinglée : elle a sa colonne. */
.app.libre{grid-template-columns:1fr}
.side.libre{position:fixed;left:0;top:0;bottom:0;height:100vh;z-index:30;transform:translateX(-105%);visibility:hidden;background:color-mix(in srgb,var(--card) 94%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s,visibility 0s linear .35s}
.side.libre.ouverte{transform:none;visibility:visible;box-shadow:20px 0 50px rgba(0,0,0,.25);transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s,visibility 0s}
/* La poignée : dessinée étroite (22 px) sur le bord gauche, touchable sur 44 px ; cachée sous la barre ouverte. Le bord : la souris s'en approche, la barre vient. */
.poignee{position:fixed;left:0;top:50%;transform:translateY(-50%);z-index:29;width:44px;height:64px;padding:0 0 0 3px;border:0;background:none;color:var(--muted);display:grid;place-items:center start}
.poignee::before{content:'';position:absolute;left:0;top:0;bottom:0;width:22px;box-sizing:border-box;border:1px solid var(--line);border-left:0;border-radius:0 14px 14px 0;background:var(--card);z-index:-1}
.poignee .ic{position:relative}.poignee[aria-expanded=true]{display:none}
.bord{position:fixed;left:0;top:0;bottom:0;width:14px;z-index:28}
/* Barre non épinglée, hors téléphone : le contenu commence après la zone touchable de la poignée (44 px), rien n'est dessous. */
@media (min-width:821px){.app.libre main{padding-left:44px}}
/* Tablette (de 821 à 1099 px ; la maquette : « w < 1100 ») épinglée : une colonne d'icônes seules ; chaque entrée garde son nom pour les lecteurs d'écran et en info-bulle. */
@media (min-width:821px) and (max-width:1099px){.side:not(.libre){width:76px;align-items:center;padding:12px 0}.side:not(.libre) .hd{flex-direction:column;padding:2px 0 10px}.side:not(.libre) .hd .pinb{margin-right:0}.side:not(.libre) .hd span,.side:not(.libre) .nav span,.side:not(.libre) .veille{display:none}.side:not(.libre) .nav{width:48px;min-height:48px;justify-content:center;padding:0}}
@media (max-width:820px){.poignee,.bord{display:none}}
@media (prefers-reduced-motion:reduce){.side.libre,.side.libre.ouverte{transition:none}}
@media (prefers-reduced-motion:reduce){.tabs button{transition:none}}
main{padding:22px 26px 120px;min-width:0}
.top{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.hello{min-width:0}.hello h1{margin:0;font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-.02em;overflow-wrap:anywhere}.hello p{margin:3px 0 0;color:var(--muted);font-size:13px}.hello .jour{display:inline-block}.hello .jour::first-letter{text-transform:uppercase}
/* La pastille ronde de la maquette : l'initiale du prénom (le prénom entier pour les lecteurs d'écran et en info-bulle). */
.me{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;font-weight:700;background:var(--on);color:var(--on-ink);flex:none;box-shadow:0 0 0 2px var(--card),0 0 0 4px color-mix(in srgb,var(--accent) 55%,transparent)}
/* Un seul retour vers Odin : la barre épinglée (grand écran, tablette) a le sien ; celui du bandeau reste quand elle est détachée et au téléphone. */
@media (min-width:821px){.app:not(.libre) .top .retour{display:none}.app.libre:has(.side.ouverte) .top .retour{visibility:hidden}}
.tools{margin-left:auto;display:flex;gap:10px;align-items:center}.search{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:8px 14px;color:var(--muted);min-width:220px}.search input{all:unset;color:var(--text);width:100%}
.round{width:42px;height:42px;border-radius:50%;border:1px solid var(--line);background:var(--card);display:grid;place-items:center;position:relative;color:var(--text)}.round .dot{position:absolute;top:6px;right:6px;min-width:16px;height:16px;border-radius:8px;background:var(--bad);color:#fff;font-size:10px;display:grid;place-items:center;padding:0 4px}
/* Les onglets de pièces (la maquette) : ils défilent de côté s'ils ne tiennent pas, sans faire déborder la page ; 44 px au doigt. */
.tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;overscroll-behavior-x:contain;margin:14px 0 2px;padding:2px;max-width:100%}.tabs::-webkit-scrollbar{display:none}
.tabs button{flex:none;max-width:min(70vw,260px);overflow:hidden;text-overflow:ellipsis;border:1px solid transparent;background:none;color:var(--muted);border-radius:999px;padding:7px 15px;white-space:nowrap;min-height:44px;font-weight:500;transition:background .2s,color .2s,border-color .2s}.tabs button[aria-selected=true]{background:var(--card2);border-color:var(--line);color:var(--text);font-weight:600}.tabs button:focus-visible{outline-offset:-2px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;margin-top:14px;grid-auto-flow:dense}
.card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:16px;position:relative;overflow:hidden;min-width:0;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}.card.w2{grid-column:span 2}.card.h2{grid-row:span 2}
.card h3{margin:0;font-size:12.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.card .big{font-size:40px;font-weight:600;line-height:1.05;margin:8px 0 2px}
.fk{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-top:10px}.fki{border:1px solid var(--line);border-radius:14px;padding:8px 10px}.fki small{display:block;color:var(--muted);font-size:12px}.fki b{font-size:22px}.fki.mauvais b{color:#e0453a}.fki.attention b{color:#d98a12}
.fl{list-style:none;margin:10px 0 0;padding:0}.fl li{display:flex;flex-direction:column;padding:7px 0;border-bottom:1px solid var(--line)}.fl li:last-child{border-bottom:0}.fl li.mauvais b{color:#e0453a}
.sec{margin:26px 0 0;font-size:15px;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:8px}.fam{margin:20px 0 0;font-size:12.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.dev{display:flex;flex-direction:column;gap:10px;min-height:132px;transition:transform .15s}.dev.on{background:var(--on);border-color:transparent;color:var(--on-ink)}.dev.on .muted{color:color-mix(in srgb,var(--on-ink) 82%,transparent)}
.dev .row{display:flex;align-items:center;gap:10px}.dev .em{width:40px;height:40px;border-radius:12px;background:var(--card2);display:grid;place-items:center;font-size:20px;flex:none}.dev.on .em{background:rgba(255,255,255,.22)}
.dev b{display:block;overflow-wrap:anywhere}.muted{color:var(--muted);font-size:13px}.dev .ctl{margin-top:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.btn{border:1px solid var(--line);background:var(--card2);border-radius:12px;min-width:40px;height:40px;padding:0 12px;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none}.dev.on .btn{background:rgba(255,255,255,.18);border-color:transparent}
.sw{width:52px;height:30px;border-radius:15px;border:0;background:var(--card2);position:relative;margin-left:auto;flex:none;box-shadow:inset 0 0 0 1px var(--line)}.sw::after{content:'';position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:left .2s}.sw[aria-checked=true]{background:rgba(255,255,255,.35)}.sw[aria-checked=true]::after{left:25px}
input[type=range]{width:100%;accent-color:#fff}.slide{position:relative;flex:1;min-width:180px;height:46px;border-radius:23px;background:rgba(255,255,255,.12);border:1px solid var(--line);overflow:hidden}.slide input{position:absolute;inset:0;opacity:0;width:100%;height:100%}.slide span{position:absolute;inset:0;display:grid;place-items:center;font-size:13px;color:var(--muted);pointer-events:none}.slide i{position:absolute;top:4px;left:4px;width:38px;height:38px;border-radius:50%;background:var(--accent);pointer-events:none}
.wx{background:linear-gradient(160deg,color-mix(in srgb,var(--accent2) 40%,var(--card)),var(--card))}.fe-barre{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}.fe-barre .btn{text-decoration:none}.fw-outils{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.fw-outils button{min-width:42px;min-height:42px;border-radius:10px;border:1px solid var(--line);background:var(--card2);color:var(--text);font:inherit;font-size:16px;cursor:pointer}.fw-outils .fw-poignee{cursor:grab;touch-action:none}.card.glisse{opacity:.55;outline:2px dashed var(--accent)}.card.cible{outline:3px solid var(--accent)}.fh .fh-j::first-letter{text-transform:uppercase}
.wx .now{display:flex;align-items:center;gap:14px}.wx .lieu-btn{background:none;border:0;padding:0;margin:-4px 0 8px;color:var(--muted);font:inherit;font-size:13px;text-decoration:underline;cursor:pointer;min-height:32px}.wx .lieu{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}.wx .lieu[hidden]{display:none}.wx .lieu input{flex:1 1 160px;min-width:0;min-height:40px;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:var(--card2);color:var(--text);font:inherit}.wx .ico{font-size:58px;line-height:1}.wx .days{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center;font-size:12.5px;margin-top:12px}.wx .days b{display:block;font-size:20px;margin:2px 0}
.kv{display:grid;grid-template-columns:auto auto;gap:2px 12px;font-size:13px;color:var(--muted);margin-left:auto;text-align:right}.kv b{color:var(--text);font-weight:600}
.clock .big{font-size:56px;letter-spacing:-.02em}
.tile{display:flex;flex-direction:column;align-items:flex-start;gap:10px;text-align:left;border:1px solid var(--line);background:var(--card);border-radius:20px;padding:14px;min-height:104px;color:var(--text)}.tile .em{font-size:24px;width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:var(--card2)}.tile:hover{border-color:var(--accent)}
.scene{border:0;background:var(--card2);border-radius:14px;padding:10px 14px;margin:6px 6px 0 0;color:var(--text)}
.appc{display:flex;flex-direction:column;gap:6px;text-align:left;text-decoration:none;color:var(--text)}.appc .k{display:flex;justify-content:space-between;font-size:13px;color:var(--muted);gap:8px}.appc .k b{color:var(--text);text-align:right}.badge{position:absolute;top:12px;right:12px;border-radius:999px;padding:2px 9px;font-size:12px;background:var(--bad);color:#fff}
.k.attention b{color:var(--warn)}.k.mauvais b{color:var(--bad)}.k.bon b{color:var(--good)}
.notes li{list-style:none;padding:8px 0 8px 12px;border-left:3px solid var(--good);margin:6px 0;font-size:14px;overflow-wrap:anywhere}.notes li.souci{border-color:var(--warn)}.notes li.grave{border-color:var(--bad)}.notes ul{margin:0;padding:0}
.themes{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-top:14px}.th{border:2px solid transparent;border-radius:18px;padding:0;overflow:hidden;text-align:left;background:none}.th[aria-pressed=true]{border-color:var(--accent)}.th .pv{height:92px;display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px}.th .pv i{border-radius:10px;display:block}.th span{display:block;padding:8px 10px;font-size:13px;background:var(--card)}
.person .av{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-weight:600;font-size:18px;background:var(--card2);flex:none}.person.home .av{background:var(--good);color:#fff}.person .row{display:flex;gap:12px;align-items:center}.person{display:flex;flex-direction:column;gap:10px}
.cam{padding:0;margin:0}.cam img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#000}.cam figcaption{display:flex;justify-content:space-between;align-items:center;padding:10px 14px}.cam .live{color:var(--bad)}.cam.off .live{color:var(--muted)}.cam.off .live::after{content:' (hors ligne)'}.dev.cut{border-color:var(--bad)}
.bnav,.feuille,.voile{display:none}
/* Dans Odin (vue « Home Assistant ») au téléphone : la barre du bas d'Odin suffit ; les sections passent dans ce menu, en haut. */
.secs{display:none}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--card2);border:1px solid var(--line);color:var(--text);padding:10px 16px;border-radius:14px;max-width:min(560px,92vw);z-index:60;box-shadow:0 10px 30px rgba(0,0,0,.35);white-space:pre-wrap}
dialog{border:1px solid var(--line);background:var(--card2);color:var(--text);border-radius:20px;padding:20px;max-width:min(440px,92vw)}dialog::backdrop{background:rgba(0,0,0,.55)}dialog .acts{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}.primary{background:var(--accent);color:#111;border-color:transparent}
.empty{color:var(--muted);padding:12px 0}
/* ---------- La mascotte ---------- */
.pet{position:fixed;left:0;top:0;width:var(--ps,76px);height:var(--ps,76px);z-index:50;touch-action:none;cursor:grab;filter:drop-shadow(0 8px 14px rgba(0,0,0,.35));transition:transform 1.1s cubic-bezier(.45,.05,.3,1)}
/* Dans le rond de la barre du bas (son nid au téléphone), elle se cache derrière lui, comme sur l'accueil : c'est le rond qui prend l'appui. */
.pet.au-nid{visibility:hidden;pointer-events:none}
.pet.drag{transition:none;cursor:grabbing}.pet.fast{transition:transform .45s cubic-bezier(.3,.7,.4,1)}.pet svg{width:100%;height:100%;display:block;pointer-events:none}
.pet .bodyw{width:100%;height:100%}.pet.walk .bodyw{animation:walk .45s ease-in-out infinite}.pet.hop .bodyw{animation:hop .6s ease}.pet.spin .bodyw{animation:spin .8s ease}
@keyframes walk{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-6px) rotate(3deg)}}@keyframes hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-34px) scale(1.05,.95)}70%{transform:translateY(0) scale(1.08,.92)}}@keyframes spin{to{transform:rotate(360deg)}}
.bubble{position:fixed;z-index:55;width:min(340px,calc(100vw - 24px));background:var(--card2);color:var(--text);border:1px solid var(--line);border-radius:20px;padding:14px;box-shadow:0 16px 40px rgba(0,0,0,.4)}.bubble.ok{border-color:var(--good)}.bubble.souci{border-color:var(--warn)}.bubble.grave{border-color:var(--bad);box-shadow:0 0 0 3px color-mix(in srgb,var(--bad) 40%,transparent),0 16px 40px rgba(0,0,0,.4)}
.bubble p{margin:0 0 10px;padding-right:18px;white-space:pre-wrap;max-height:40vh;overflow:auto}.bubble .qs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.bubble .qs button{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:5px 11px;font-size:13px}
.bubble form{display:flex;gap:6px}.bubble input{flex:1;min-width:0;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:12px;padding:9px 11px;font:inherit}.bubble .x{position:absolute;top:6px;right:8px;border:0;background:none;color:var(--muted);font-size:18px}
.ball{position:fixed;left:0;top:0;width:34px;height:34px;border-radius:50%;z-index:49;touch-action:none;cursor:grab;background:radial-gradient(circle at 35% 30%,#fff 0 12%,#ffd23f 13% 45%,#f08c00 46%);box-shadow:0 6px 12px rgba(0,0,0,.35)}
@media (max-width:820px){.app{grid-template-columns:1fr}.side{display:none}.hello h1{font-size:22px}main{padding:16px 14px calc(110px + env(safe-area-inset-bottom))}.search{display:none}.card.w2{grid-column:span 1}.grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.wx,.clock{grid-column:1/-1!important}.wx .now{flex-wrap:wrap}.wx .kv{margin-left:0;text-align:left;grid-template-columns:repeat(4,auto);width:100%}.card .big{font-size:34px}.clock .big{font-size:44px}
.bnav{display:flex;position:fixed;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:40;justify-content:space-around;align-items:stretch;gap:2px;background:color-mix(in srgb,var(--card2) 92%,transparent);border:1px solid var(--line);border-radius:22px;padding:6px;backdrop-filter:blur(14px)}
/* La barre du bas (sa réponse : quatre places et Odin au centre, dont « Plus ») : chaque place a son icône et son nom, 44 px au moins ; le rond d'Odin au centre (son nid, la rune ; la mascotte en liberté y rentre quand elle n'a plus de place, cachée derrière lui) ; « Plus » est marqué quand la section ouverte est dans sa feuille, et quand sa feuille est ouverte. Les mots sont dans la couleur du texte du thème (lisibles sur un thème clair comme sombre) ; la place choisie se voit par le fond, le gras et un trait. Toutes les places ont la même hauteur, icônes alignées (à 320 px, « Mes applis » passe sur deux lignes). */
.bnav .nav{flex:1 1 0;min-width:44px;width:auto;height:auto;min-height:52px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:2px;padding:6px 2px 4px;font-size:11px;line-height:1.15;color:var(--text)}.bnav .nav span{max-width:100%;overflow-wrap:anywhere;text-align:center}.bnav .nav[aria-current=page],.bnav .plus.cur,.bnav .plus[aria-expanded=true]{background:var(--card);color:var(--text);font-weight:700;box-shadow:inset 0 0 0 1px var(--line),inset 0 -3px 0 var(--text)}
.bnav .nid{flex:none;align-self:center;width:52px;height:52px;margin:0 2px;padding:0;border-radius:50%;border:1px solid var(--line);background:var(--card);color:var(--text);display:grid;place-items:center}.bnav .nid .rune{font-size:24px;line-height:1;font-weight:700;pointer-events:none}.bnav .nid[aria-expanded=true]{border-color:var(--accent)}
/* La feuille « Plus » : au-dessus de la barre, toutes les autres sections et le retour vers Odin ; un voile derrière (un appui dessus la referme), sous la barre qui reste utilisable ; la feuille passe devant la mascotte et sa bulle. Feuille ouverte : le retour du bandeau se cache (un seul retour vers Odin à la fois). */
.feuille{display:flex;flex-direction:column;gap:2px;position:fixed;left:10px;right:10px;bottom:calc(86px + env(safe-area-inset-bottom));z-index:56;max-height:calc(100vh - 120px);overflow-y:auto;padding:8px;border:1px solid var(--line);border-radius:22px;background:var(--card2);box-shadow:0 16px 40px rgba(0,0,0,.4)}.feuille .nav{width:100%;height:auto;min-height:48px;display:flex;align-items:center;justify-content:flex-start;gap:12px;padding:0 14px;text-align:left;color:var(--text)}.feuille .nav span{min-width:0;overflow-wrap:anywhere}.feuille .nav .ic{flex:none}.feuille .nav[aria-current=page]{color:var(--text)}
/* Le message en bas (« Thème … ») passe au-dessus de la barre du bas ; dans Odin (pas de barre) et en plein écran, il reste en bas. */
.toast{bottom:calc(86px + env(safe-area-inset-bottom))}html.dans-odin .toast,.app.plein-ecran~.toast{bottom:24px}
.voile{display:block;position:fixed;inset:0;z-index:39;background:rgba(0,0,0,.35)}.feuille[hidden],.voile[hidden]{display:none}.app.plus-ouvert .top .retour{visibility:hidden}
html.dans-odin .feuille,html.dans-odin .voile{display:none}html.dans-odin .bnav{display:none}html.dans-odin main{padding-bottom:24px}html.dans-odin .secs{display:flex;gap:6px;overflow-x:auto;position:sticky;top:0;z-index:30;margin:-16px -14px 12px;padding:8px 14px;background:color-mix(in srgb,var(--bg2) 94%,transparent);border-bottom:1px solid var(--line);scrollbar-width:none;overscroll-behavior-x:contain}html.dans-odin .secs::-webkit-scrollbar{display:none}.secs button{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--muted);white-space:nowrap}.secs button[aria-current=page]{background:var(--card2);color:var(--accent);border-color:var(--accent)}}
/* Le plein écran (la maquette) : le menu (barre de côté, poignée, barre du bas et sa feuille, menu des sections), le bandeau et les onglets disparaissent ; reste le bouton qui l'a ouvert, un rond de 44 px en haut à droite, discret, net au survol et au focus ; le contenu commence sous lui (il ne couvre aucune carte). En bas à droite, le nid flottant d'Odin (la maquette : 54 px) : la mascotte s'y pose quand elle n'a plus de place libre ; un simple rond sous elle, que ni le doigt ni la souris ne prennent (c'est elle, posée dessus, qui les reçoit). Le contenu garde 90 px en bas (la maquette), pour que la dernière carte passe au-dessus du nid. */
.round.plein{width:44px;height:44px}
.app.plein-ecran{grid-template-columns:1fr}.app.plein-ecran .side,.app.plein-ecran .poignee,.app.plein-ecran .bord,.app.plein-ecran .bnav,.app.plein-ecran .feuille,.app.plein-ecran .voile,.app.plein-ecran .secs,.app.plein-ecran .top,.app.plein-ecran .tabs{display:none!important}.app.plein-ecran main{padding:64px 14px 90px}
.app.plein-ecran>.plein{position:fixed;top:calc(10px + env(safe-area-inset-top));right:10px;z-index:41;opacity:.45;transition:opacity .2s}.app.plein-ecran>.plein:hover,.app.plein-ecran>.plein:focus-visible{opacity:1}
.nid-flottant{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:49;width:54px;height:54px;box-sizing:border-box;border-radius:50%;background:var(--card2);border:1px solid var(--line);box-shadow:0 6px 18px rgba(0,0,0,.22);pointer-events:none}
@media (prefers-reduced-motion:reduce){.app.plein-ecran>.plein{transition:none}}
@media (prefers-reduced-motion:reduce){.pet,.pet .bodyw{transition:none!important;animation:none!important}}`;

  // ---------- État ----------
  // « room » : la pièce choisie dans les onglets (null : « Tout » ; une pièce peut s'appeler « Tout »).
  let D = null, view = 'accueil', room = null, q = '', seen = new Set(), first = true, voice = false;
  // La barre de côté, comme la maquette : non épinglée au départ (elle se cache seule) ; épinglée, elle reste ouverte. Le
  // choix est gardé sur l'appareil (« 1 » épinglée, « 0 » non). « ouverte » : la barre non épinglée est sortie (la souris
  // au bord, la poignée) ; « tBarre » : le délai avant qu'elle se cache quand la souris la quitte ; « tOuvert » : l'heure
  // de son ouverture (elle glisse encore 0,35 s) ; « parSouris » : c'est la souris (le bord) qui l'a ouverte.
  let barre = (() => { try { return localStorage.getItem('odin.maison.barre') === '1'; } catch { return false; } })(), ouverte = false, tBarre = 0, tOuvert = 0, parSouris = false;
  try { voice = localStorage.getItem('odin.maison.voix') === '1'; } catch { /* */ }
  // Le téléphone et le plein écran : « plusOuvert », la feuille « Plus » de la barre du bas est ouverte ; « plein », le plein
  // écran ; « pleinDemande », le navigateur a accepté de passer en plein écran (sa sortie par le navigateur fait sortir la
  // page aussi). Gardés ici : la page se redessine toutes les 15 secondes.
  let plusOuvert = false, plein = false, pleinDemande = false;
  const root = el('div', { class: 'app' }); document.body.append(root);
  // ---------- Accueil : le ciel noir étoilé (ciel.js) tant qu'Odin n'a pas répondu, ou s'il faut se connecter ----------
  // Ensuite, c'est le thème choisi pour l'écran de la maison qui s'affiche (rien ne change à l'intérieur).
  document.head.append(el('style', {}, `.nuit{position:fixed;inset:0;z-index:45;background:#000;display:grid;place-items:center;padding:16px;color:#eef0ff;font-family:Plex,system-ui,sans-serif}.nuit .ciel{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.nuit>:not(.ciel){position:relative}.nuit .attente{display:flex;flex-direction:column;align-items:center;gap:14px;color:rgba(255,255,255,.8)}.nuit .boite{width:min(520px,100%);background:#14161f;border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.55)}.nuit .boite h1{margin:0 0 8px;font-size:22px}.nuit .boite p{margin:0 0 14px;color:#c4c8e4;line-height:1.5}.nuit .boite a{display:inline-flex;align-items:center;min-height:46px;padding:0 18px;border-radius:12px;background:#4b5ae0;color:#fff;font-weight:600;text-decoration:none}`));
  const nuit = (() => {
    const ciel = el('canvas', { class: 'ciel', 'aria-hidden': 'true' }), dedans = el('div', { class: 'attente', role: 'status' }, el('p', {}, 'L\'écran de la maison démarre…'));
    const n = el('div', { class: 'nuit' }, ciel, dedans); document.body.append(n); window.OdinCiel?.monter(ciel);
    const couleur = (c) => document.querySelector('meta[name=theme-color]')?.setAttribute('content', c);
    couleur('#000000');
    return {
      montrer(...enfants) { dedans.className = 'boite'; dedans.setAttribute('role', 'alert'); dedans.replaceChildren(...enfants); if (!n.isConnected) document.body.append(n); couleur('#000000'); },
      cacher() { n.remove(); },
    };
  })();
  const toast = (t) => { document.querySelector('.toast')?.remove(); const n = el('div', { class: 'toast', role: 'status' }, t); document.body.append(n); setTimeout(() => n.remove(), 4200); };
  const confirmBox = (text) => new Promise((ok) => { const d = el('dialog', { 'aria-label': 'Confirmation' }, el('p', {}, text), el('div', { class: 'acts' }, el('button', { class: 'btn', onclick: () => { d.close(); ok(false); } }, 'Annuler'), el('button', { class: 'btn primary', onclick: () => { d.close(); ok(true); } }, 'Confirmer'))); d.addEventListener('close', () => { d.remove(); ok(false); }); document.body.append(d); d.showModal(); });
  /** Une action : si elle est grave, Odin demande confirmation, puis la relance avec « confirm ». */
  async function act(path, body) {
    try {
      let r = await api(path, body);
      if (r.confirm && await confirmBox(r.confirm)) r = await api(path, { ...body, confirm: true });
      if (r.text) { toast(r.text.split('\n').slice(0, 6).join('\n')); pet.say(r.text.split('\n')[0], r.ok === false ? 'souci' : 'ok', r.ok === false ? 'confus' : 'joie', true); }
      setTimeout(load, 600);
      return r;
    } catch (e) { toast(e.message); }
  }

  // ---------- Dessin ----------
  const KIND = { 'lumière': '💡', prise: '🔌', capteur: '🌡', 'détecteur': '📡', volet: '🪟', clim: '❄️', lecteur: '🎵', serrure: '🔒', ventilateur: '🌀', aspirateur: '🤖' };
  const FR = { on: 'allumé', off: 'éteint', open: 'ouvert', closed: 'fermé', opening: 's\'ouvre', closing: 'se ferme', playing: 'en lecture', paused: 'en pause', idle: 'en veille', standby: 'en veille', locked: 'verrouillée', unlocked: 'ouverte', locking: 'se verrouille', unlocking: 's\'ouvre', heat: 'chauffe', cool: 'refroidit', auto: 'auto', dry: 'déshumidifie', fan_only: 'ventile', cleaning: 'nettoie', docked: 'sur sa base', returning: 'rentre', unavailable: 'indisponible', unknown: 'inconnu', home: 'à la maison', not_home: 'absent' };
  const stateFr = (x) => FR[String(x).toLowerCase()] ?? x;
  const isOn = (d) => /^(on|ouvert|open|heat|cool|playing|unlocked|cleaning|auto|heat_cool|dry|fan_only)$/i.test(d.state || '');
  function devCard(d) {
    const on = isOn(d), toggle = (v, e) => { pet.visit(document.querySelector(`[data-dev="${CSS.escape(d.id)}"]`)); return act('/api/maison/appareil', { appareil: d.id, valeur: v }); };
    const head = el('div', { class: 'row' }, el('span', { class: 'em', 'aria-hidden': 'true' }, KIND[d.kind] || '◻️'), el('div', { style: { minWidth: 0 } }, el('b', {}, d.name), el('span', { class: 'muted' }, `${d.kind}${d.state ? ` · ${stateFr(d.state)}${d.unit ? ` ${d.unit}` : ''}` : ''}`)));
    const ctl = el('div', { class: 'ctl' });
    if (['lumière', 'prise', 'ventilateur'].includes(d.kind)) {
      head.append(el('button', { class: 'sw', role: 'switch', 'aria-checked': String(on), 'aria-label': `${d.name} : ${on ? 'éteindre' : 'allumer'}`, onclick: () => toggle(on ? 'off' : 'on') }));
      if (d.kind === 'lumière') { const r = el('input', { type: 'range', min: '1', max: '100', value: '70', 'aria-label': `Intensité de ${d.name}` }); r.addEventListener('change', () => toggle(`${r.value} %`)); ctl.append(r); }
    } else if (d.kind === 'volet') ctl.append(el('button', { class: 'btn', 'aria-label': 'Monter', onclick: () => toggle('ouvre') }, icon('up')), el('button', { class: 'btn', 'aria-label': 'Arrêter', onclick: () => toggle('stop') }, icon('stop')), el('button', { class: 'btn', 'aria-label': 'Descendre', onclick: () => toggle('ferme') }, icon('down')));
    else if (d.kind === 'clim') { const t = Number.parseFloat(d.state) || 22; ctl.append(el('button', { class: 'btn', 'aria-label': 'Moins chaud', onclick: () => toggle(String(t - 1)) }, icon('minus')), el('b', { style: { fontSize: '22px' } }, `${t}°`), el('button', { class: 'btn', 'aria-label': 'Plus chaud', onclick: () => toggle(String(t + 1)) }, icon('plus')), el('button', { class: 'btn', onclick: () => toggle(on ? 'off' : 'on') }, on ? 'Arrêt' : 'Marche')); }
    else if (d.kind === 'lecteur') ctl.append(el('button', { class: 'btn', 'aria-label': 'Précédent', onclick: () => toggle('precedent') }, icon('prev')), el('button', { class: 'btn', 'aria-label': on ? 'Pause' : 'Lecture', onclick: () => toggle(on ? 'pause' : 'lecture') }, icon(on ? 'pause' : 'play')), el('button', { class: 'btn', 'aria-label': 'Suivant', onclick: () => toggle('suivant') }, icon('next')));
    else if (d.kind === 'aspirateur') ctl.append(el('button', { class: 'btn', onclick: () => toggle('on') }, 'Nettoyer'), el('button', { class: 'btn', onclick: () => toggle('off') }, 'Base'));
    else if (d.kind === 'serrure') {
      // Glisser pour déverrouiller (puis confirmation d'Odin) ; un appui pour verrouiller.
      const r = el('input', { type: 'range', min: '0', max: '100', value: '0', 'aria-label': `Glisser pour ouvrir ${d.name}` }), knob = el('i'), w = el('div', { class: 'slide' }, el('span', {}, on ? 'Ouverte' : 'Glisser pour ouvrir ›'), knob, r);
      r.addEventListener('input', () => { knob.style.left = `calc(${r.value}% - ${r.value * 0.42}px + 4px)`; });
      r.addEventListener('change', () => { if (Number(r.value) > 90) toggle('deverrouille'); r.value = '0'; knob.style.left = '4px'; });
      ctl.append(on ? el('button', { class: 'btn', onclick: () => toggle('verrouille') }, icon('lock'), ' Verrouiller') : w);
    }
    return el('div', { class: `card dev${on ? ' on' : ''}${d.kind === 'serrure' || d.kind === 'lecteur' ? ' w2' : ''}`, 'data-dev': d.id }, head, ctl);
  }
  // Le lieu d'Odin (là où il est installé) : par son nom, ou par la position de cet appareil (GPS d'un téléphone : précis ;
  // un ordinateur : souvent approximatif, Odin le dit). Seulement pour qui a tous les droits. L'état du petit formulaire
  // est gardé ici, car la page se redessine toutes les 15 secondes.
  const lieuUi = { ouvert: false, valeur: '', focus: false };
  function lieuBar() {
    if (!D || D.rights !== 'complet') return [];
    const dire = (action, input) => { lieuUi.ouvert = false; lieuUi.valeur = ''; return act('/api/valhalla/act', { module: 'gladsheim', action, input }); };
    const inp = el('input', { type: 'text', value: lieuUi.valeur, placeholder: 'Village ou ville (ex. Dembéni)', 'aria-label': 'Village ou ville', autocomplete: 'off', maxlength: '80', oninput: (e) => { lieuUi.valeur = e.target.value; }, onfocus: () => { lieuUi.focus = true; }, onblur: () => { lieuUi.focus = false; } });
    const ici = () => {
      if (!navigator.geolocation) return toast('Cet appareil ne donne pas sa position : écris le nom du village.');
      toast('Je cherche ta position…');
      navigator.geolocation.getCurrentPosition(
        (p) => dire('lieu_position', { lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy }),
        (e) => toast(e.code === 1 ? 'Tu as refusé de donner la position : écris le nom du village.' : 'Position introuvable pour l\'instant : écris le nom du village.'),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    };
    const form = el('form', { class: 'lieu', hidden: !lieuUi.ouvert, onsubmit: (e) => { e.preventDefault(); const v = inp.value.trim(); if (v) dire('lieu', { ville: v }); } },
      inp, el('button', { class: 'btn', type: 'submit' }, 'OK'), el('button', { class: 'btn', type: 'button', title: 'Ta position est envoyée une fois à OpenStreetMap pour trouver le nom du village', onclick: ici }, '📍 Me localiser'));
    if (lieuUi.ouvert && lieuUi.focus) setTimeout(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 0);
    return [el('button', { class: 'lieu-btn', type: 'button', 'aria-expanded': String(lieuUi.ouvert), onclick: () => { lieuUi.ouvert = !lieuUi.ouvert; lieuUi.focus = lieuUi.ouvert; draw(); } }, lieuUi.ouvert ? 'Fermer' : 'Changer de lieu'), form];
  }
  let meteoVue = null; // la dernière météo reçue, remontrée (marquée ancienne) quand elle ne peut plus être mise à jour
  function weatherCard(w) {
    if (w) meteoVue = w;
    if (!w) {
      const v = meteoVue;
      return el('div', { class: 'card wx w2' }, el('h3', {}, 'Météo'),
        el('p', { class: 'muted' }, v ? 'La météo n\'a pas pu être mise à jour (connexion indisponible pour l\'instant).' : 'Météo indisponible : choisis la ville dans Odin (Hestia).'),
        v ? el('p', { class: 'muted', style: 'opacity:.8;margin-top:6px' }, `Dernières prévisions (anciennes) : ${v.temp}° ${(v.word || '').toLowerCase()}${v.place ? ` à ${v.place}` : ''}.`) : null,
        el('button', { class: 'btn', type: 'button', style: 'margin-top:8px', onclick: () => load() }, 'Réessayer'));
    }
    const ICO = { 0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️', 45: '🌫', 48: '🌫', 51: '🌦', 53: '🌦', 55: '🌧', 61: '🌦', 63: '🌧', 65: '🌧', 71: '🌨', 73: '🌨', 75: '❄️', 80: '🌦', 81: '🌧', 82: '⛈', 95: '⛈', 96: '⛈', 99: '⛈' };
    const days = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
    // Courbe des 24 prochaines heures.
    const hs = w.hours || [], min = Math.min(...hs.map((h) => h.temp)), max = Math.max(...hs.map((h) => h.temp)), span = Math.max(1, max - min);
    const pts = hs.map((h, i) => `${(i / Math.max(1, hs.length - 1)) * 300},${48 - ((h.temp - min) / span) * 40}`).join(' ');
    const quand = (t) => { try { const o = D?.lieu?.fuseau ? { timeZone: D.lieu.fuseau } : {}; return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', ...o }).replace(':', 'h'); } catch { return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h'); } };
    return el('div', { class: 'card wx w2' },
      el('h3', {}, `Météo · ${w.place}`), ...lieuBar(),
      w.ancien ? el('p', { class: 'muted', style: 'margin:4px 0 0;opacity:.8', title: w.motif || '' }, `Prévisions anciennes${w.at ? ` · dernière mise à jour ${quand(w.at)}` : ''} — connexion indisponible pour l'instant.`) : null,
      el('div', { class: 'now' }, el('span', { class: 'ico', 'aria-hidden': 'true' }, ICO[w.code] || '🌡'), el('div', {}, el('div', { class: 'big' }, `${w.temp}°`), el('div', {}, w.word), el('div', { class: 'muted' }, `Min ${w.lo}° · Max ${w.hi}°${w.feels !== undefined ? ` · ressenti ${w.feels}°` : ''}`)),
        el('div', { class: 'kv' }, 'Humidité', el('b', {}, `${w.humidity ?? '—'} %`), 'Vent', el('b', {}, `${w.wind ?? '—'} km/h`), 'Lever', el('b', {}, w.sunrise || '—'), 'Coucher', el('b', {}, w.sunset || '—'))),
      hs.length ? S('svg', { viewBox: '0 0 300 52', width: '100%', height: '52', role: 'img', 'aria-label': `Température des 24 prochaines heures, de ${min}° à ${max}°`, style: 'margin-top:8px' }, S('polyline', { points: pts, fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linejoin': 'round', opacity: '.85' })) : null,
      el('div', { class: 'days' }, ...(w.days || []).map((d) => el('div', {}, days[new Date(`${d.day}T12:00`).getDay()], el('b', { 'aria-hidden': 'true' }, ICO[d.code] || '·'), `${d.hi}° `, el('span', { class: 'muted' }, `${d.lo}°`)))));
  }
  const clock = el('div', { class: 'big' }), clockSub = el('div', { class: 'muted' });
  // L'heure et la date sont celles du lieu d'Odin (son fuseau), pas celles de l'appareil qui affiche l'écran.
  function tick() {
    const n = new Date(), l = D?.lieu, o = l?.fuseau ? { timeZone: l.fuseau } : {};
    let h, j;
    try { h = n.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: Boolean(l?.heure12), ...o }); j = n.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', ...o }); }
    catch { h = n.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); j = n.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
    clock.textContent = h; clockSub.textContent = l?.nom ? `${j} · ${l.nom}` : j;
    for (const x of document.querySelectorAll('.fh-h')) x.textContent = h;
    for (const x of document.querySelectorAll('.fh-j')) x.textContent = j;
  }
  setInterval(tick, 10_000); tick();
  const week = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };
  const hello = (h = new Date().getHours()) => (h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : h < 22 ? 'Bonsoir' : 'Bonne nuit');
  const match = (t) => !q || t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q);
  // Le bandeau, au dessin de la maquette : le salut à la maison ; dessous, la date et la semaine (au fuseau d'Odin, comme
  // l'horloge), puis SEULEMENT les vraies valeurs qu'Odin donne à cette page : la température mesurée à son lieu, avec le
  // nom du lieu (pas une météo ancienne ; sans mesure, le lieu ne s'affiche pas seul : la page ne sait pas le distinguer du
  // lieu de départ d'Odin), puis le nombre de personnes à la maison (au moins une). Une valeur absente n'a ni case, ni
  // tiret, ni zéro. Le prénom (le bandeau d'avant le disait) passe sur la pastille ronde de la maquette. Rend [le salut, la pastille].
  function bandeau() {
    const l = D?.lieu, w = D?.weather, n = new Date(), o = l?.fuseau ? { timeZone: l.fuseau } : {};
    const quand = (x) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23', ...x }).formatToParts(n).map((k) => [k.type, Number(k.value)])); return { jour: n.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...x }), date: new Date(p.year, p.month - 1, p.day), heure: p.hour % 24 }; };
    let t; try { t = quand(o); } catch { t = quand({}); }
    const lieu = String(w?.place || l?.nom || '').trim(), temp = w && !w.ancien && Number.isFinite(w.temp) ? `${w.temp}°` : '';
    const chez = (D?.people || []).filter((x) => x.state === 'home').length;
    const valeurs = [temp && lieu ? `${temp} ${MOTS.a} ${lieu}` : temp, chez > 0 ? `${chez} ${chez > 1 ? MOTS.personnes : MOTS.personne}` : ''].filter(Boolean);
    const nom = String(D?.name || '').trim();
    return [
      el('div', { class: 'hello' }, el('h1', {}, `${hello(t.heure)}, ${MOTS.maison}`), el('p', {}, el('span', { class: 'jour' }, t.jour), ` · ${MOTS.semaine} ${week(t.date)}`, ...valeurs.map((v) => ` · ${v}`))),
      nom ? el('span', { class: 'me', role: 'img', 'aria-label': nom, title: nom }, Array.from(nom)[0].toUpperCase()) : null,
    ];
  }
  // Les onglets de pièces (la maquette ; sa réponse : ils filtrent) : « Tout », puis les pièces des appareils, dans l'ordre
  // où Odin les donne ; aucune pièce : pas d'onglets. L'onglet choisi est dit aux lecteurs d'écran. Au clavier, une rangée
  // d'onglets : Tab entre sur celui qui est choisi, les flèches, Début et Fin passent de l'un à l'autre, Entrée le choisit.
  // Choisir redessine la page ; le focus revient sur l'onglet (draw le garde aussi au redessin automatique).
  const ongletDe = (v) => [...(document.querySelector('.tabs')?.children || [])].find((b) => b.getAttribute('data-piece') === v);
  function onglets(noms) {
    if (!noms.length) return null;
    const boutons = [[null, MOTS.tout], ...noms.map((x) => [x, x])].map(([v, mot]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(room === v), tabindex: room === v ? '0' : '-1', 'aria-controls': 'maison-grille', 'data-piece': v === null ? '' : `p:${v}`, title: v === null ? null : v,
      onclick: () => { room = v; draw(); ongletDe(v === null ? '' : `p:${v}`)?.focus({ preventScroll: true }); } }, mot));
    // Écrite de droite à gauche, la rangée commence à droite : la flèche gauche avance, la flèche droite recule.
    const rtl = (e) => !!e.currentTarget?.matches?.(':dir(rtl)');
    return el('div', { class: 'tabs', role: 'tablist', 'aria-label': MOTS.pieces, onkeydown: (e) => {
      const i = boutons.indexOf(document.activeElement); if (i < 0) return;
      const [avant, arriere] = rtl(e) ? ['ArrowLeft', 'ArrowRight'] : ['ArrowRight', 'ArrowLeft'];
      const j = e.key === avant ? Math.min(boutons.length - 1, i + 1) : e.key === arriere ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? boutons.length - 1 : -1;
      if (j < 0) return; e.preventDefault(); boutons[j].focus(); boutons[j].scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    },
    // À la souris sans molette de côté : la molette fait défiler la rangée quand elle déborde ; au bout, ou si elle
    // tient, la page défile comme avant.
    onwheel: (e) => {
      const r = e.currentTarget, max = r.scrollWidth - r.clientWidth, d = (e.deltaMode === 1 ? 16 : 1) * e.deltaY;
      if (max <= 0 || !d || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const x = rtl(e) ? Math.max(-max, Math.min(0, r.scrollLeft - d)) : Math.max(0, Math.min(max, r.scrollLeft + d));
      if (x === r.scrollLeft) return; e.preventDefault(); r.scrollLeft = x;
    } }, ...boutons);
  }

  // Le retour vers Odin : seulement pour une session (pas avec une clé de tablette) et quand la page n'est pas dans un cadre.
  const retourVisible = (cle, encadre) => !cle && !encadre;
  // Dans Odin (la vue « Home Assistant », un cadre de la même adresse) : les liens vers Odin s'ouvrent dans Odin, sans
  // nouvel onglet ni rechargement. Dans un autre cadre (Home Assistant) : un nouvel onglet. Seule : la page elle-même.
  const dansOdin = (() => { try { return window.top !== window && window.top.location.origin === location.origin; } catch { return false; } })();
  const cibleOdin = (dedans, encadre) => (dedans ? '_top' : encadre ? '_blank' : null);
  // Au téléphone, dans Odin, la barre du bas de cet écran se cache (celle d'Odin reste) : ses sections passent dans un
  // menu en haut (.secs, 44 px, flèches gauche/droite, Début, Fin). La page seule (tablettes) ne change pas.
  if (dansOdin) document.documentElement.classList.add('dans-odin');
  function secs(navs) {
    const avant = document.querySelector('.secs'), x = avant ? avant.scrollLeft : 0;
    const boutons = navs.map(([id, label, ic]) => el('button', { type: 'button', 'data-sec': id, 'aria-current': view === id ? 'page' : null, tabindex: view === id ? '0' : '-1',
      onclick: () => { view = id; draw(); document.querySelector(`.secs [data-sec="${id}"]`)?.focus({ preventScroll: true }); } }, icon(ic, 18), label));
    const menu = el('nav', { class: 'secs', 'aria-label': "Sections de l'écran de la maison", onkeydown: (e) => {
      const i = boutons.indexOf(document.activeElement); if (i < 0) return;
      const j = e.key === 'ArrowRight' ? Math.min(boutons.length - 1, i + 1) : e.key === 'ArrowLeft' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? boutons.length - 1 : -1;
      if (j < 0) return; e.preventDefault(); boutons[j].focus(); boutons[j].scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    } }, ...boutons);
    requestAnimationFrame(() => { menu.scrollLeft = x; });
    return menu;
  }
  // Une entrée (« mots » : celle de la barre de côté, avec son nom écrit). Choisie dans la barre non épinglée ouverte : la
  // barre se referme et le focus revient à la poignée.
  function nav(id, label, ic, mots) { return el('button', { class: 'nav', 'aria-label': label, title: label, 'aria-current': view === id ? 'page' : null, onclick: () => { const ferme = mots && ouverte && !barre; view = id; if (ferme) ouverte = false; draw(); if (ferme) document.querySelector('.poignee')?.focus(); } }, icon(ic, 22), mots ? el('span', {}, label) : null); }
  // Ouvre ou cache la barre non épinglée, sans redessiner la page. « focus » : 'barre' (sur l'entrée de la page ouverte),
  // 'poignee', ou rien. « souris » : c'est la souris qui l'ouvre (seule la souris qui part la refermera). Cachée, la barre
  // est « inert » : ni clavier, ni lecteur d'écran.
  function ouvrirBarre(v, focus, souris) {
    clearTimeout(tBarre);
    const avant = ouverte;
    ouverte = Boolean(v) && !barre;
    if (ouverte && !avant) { tOuvert = Date.now(); parSouris = Boolean(souris); }
    const s = document.querySelector('.side'), p = document.querySelector('.poignee');
    if (s) { s.setAttribute('class', barre ? 'side' : ouverte ? 'side libre ouverte' : 'side libre'); if (barre || ouverte) s.removeAttribute('inert'); else s.setAttribute('inert', ''); }
    p?.setAttribute('aria-expanded', String(ouverte));
    if (focus === 'barre') (s?.querySelector('.nav[aria-current=page]') || s?.querySelector('.nav'))?.focus();
    else if (focus === 'poignee') p?.focus();
  }
  // La barre non épinglée ouverte se referme : par Échap (le focus revient à la poignée s'il était dans la barre ou nulle
  // part) ; par un appui hors de la barre, ou le focus qui en sort (Tab), sans toucher au focus. Tant qu'elle glisse
  // (400 ms après son ouverture), un clic de la souris ou du doigt sur elle ne fait rien : il visait ce qui était là avant.
  function ecouterBarre() {
    const rendre = () => { const a = document.activeElement, s = document.querySelector('.side'); return !a || a === document.body || s?.contains(a) ? 'poignee' : null; };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ouverte && !barre) ouvrirBarre(false, rendre()); });
    document.addEventListener('click', (e) => { if (ouverte && !barre && e.detail !== 0 && Date.now() - tOuvert < 400 && e.target?.closest?.('.side')) { e.preventDefault?.(); e.stopPropagation?.(); } }, true);
    document.addEventListener('click', (e) => { if (ouverte && !barre && !e.target?.closest?.('.side,.poignee,.bord')) ouvrirBarre(false); });
    document.addEventListener('focusin', (e) => { if (ouverte && !barre && !e.target?.closest?.('.side,.poignee')) ouvrirBarre(false); });
  }
  ecouterBarre();
  // ---------- Le téléphone : la barre du bas, Odin au centre, « Plus » ----------
  // Sa réponse : quatre places et Odin au centre, dont « Plus », qui ouvre tout le reste (rien n'est caché). Les places
  // reprennent celles de la maquette qui ont une page ici : Accueil (son « Aperçu »), Mes applis (son « Odin »), Odin au
  // centre, Thèmes ; « Énergie » n'a pas de page. Les autres sections permises passent dans la feuille « Plus », avec le
  // retour vers Odin. Une tablette « maison » (trois sections) : ses trois sections autour d'Odin, sans « Plus » (il serait vide).
  const BAS = ['accueil', 'applis', 'themes'];
  /** Les places de la barre du bas : [avant Odin, après Odin, dans « Plus »]. */
  function placesBas(navs) {
    if (navs.length <= 3) return [navs.slice(0, 2), navs.slice(2), []];
    const garde = navs.filter((n) => BAS.includes(n[0]));
    return [garde.slice(0, 2), garde.slice(2), navs.filter((n) => !BAS.includes(n[0]))];
  }
  /** Le focus sur la place (barre du bas, feuille « Plus ») de ce nom, s'il y en a une. */
  function focusPlace(id) { [...document.querySelectorAll('[data-place]')].find((x) => x.getAttribute('data-place') === id)?.focus({ preventScroll: true }); }
  const classeRacine = () => `${barre ? 'app' : 'app libre'}${plusOuvert ? ' plus-ouvert' : ''}${plein ? ' plein-ecran' : ''}`;
  /** La barre du bas, puis la feuille « Plus » et son voile (seulement s'il y a un reste). */
  function barreBas(navs) {
    const [avant, apres, autres] = placesBas(navs), dedans = autres.find((n) => n[0] === view);
    // Choisir une section ferme la feuille et redessine ; le focus revient à la place choisie, ou à « Plus » depuis la feuille.
    const choisir = (id, retour) => { view = id; plusOuvert = false; draw(); focusPlace(retour); };
    const place = ([id, label, ic], feuille) => el('button', { type: 'button', class: 'nav', 'data-place': id, 'aria-label': label, title: label, 'aria-current': view === id ? 'page' : null, onclick: () => choisir(id, feuille ? 'plus' : id) }, icon(ic, 22), el('span', {}, label));
    // Au centre, le nid d'Odin : sa rune (la mascotte se promène déjà ailleurs : jamais deux Odin) ; un appui ouvre la petite
    // fenêtre pour lui parler, juste au-dessus du rond ; un second appui, ou Échap, la ferme.
    const nid = el('button', { type: 'button', class: 'nid', 'data-place': 'odin', 'aria-label': MOTS.odin, title: MOTS.odin, 'aria-expanded': String(Boolean(pet.enChat?.())),
      onclick: () => { if (pet.enChat?.()) pet.fermer?.(); else pet.chat?.('.bnav .nid'); } }, el('span', { class: 'rune', 'aria-hidden': 'true' }, 'ᛟ'));
    const plus = autres.length ? el('button', { type: 'button', class: `nav plus${dedans ? ' cur' : ''}`, 'data-place': 'plus', 'aria-label': dedans ? `${MOTS.plus} · ${dedans[1]}` : MOTS.plus, title: MOTS.plus, 'aria-controls': 'maison-plus', 'aria-expanded': String(plusOuvert),
      onclick: () => ouvrirPlus(!plusOuvert, plusOuvert ? 'plus' : 'feuille') }, icon('more', 22), el('span', {}, MOTS.plus)) : null;
    const bas = el('nav', { class: 'bnav', 'aria-label': MOTS.sections }, ...avant.map((n) => place(n)), nid, ...apres.map((n) => place(n)), plus);
    if (!plus) return [bas];
    const feuille = el('div', { id: 'maison-plus', class: 'feuille', role: 'dialog', 'aria-label': MOTS.plus, hidden: !plusOuvert },
      ...autres.map((n) => place(n, true)),
      retourVisible(key, window.top !== window) ? el('a', { class: 'nav', href: '/', 'data-place': 'retour', 'aria-label': MOTS.retourTitre, title: MOTS.retourTitre }, icon('back', 22), el('span', {}, MOTS.retourTitre)) : null);
    return [bas, feuille, el('div', { class: 'voile', 'aria-hidden': 'true', hidden: !plusOuvert, onclick: () => ouvrirPlus(false, 'plus') })];
  }
  /** Ouvre ou ferme la feuille « Plus », sans redessiner. « focus » : 'feuille' (la section ouverte, sinon la première), 'plus', ou rien. */
  function ouvrirPlus(v, focus) {
    plusOuvert = Boolean(v);
    const f = document.querySelector('.feuille'), w = document.querySelector('.voile'), p = document.querySelector('.bnav .plus');
    for (const n of [f, w]) if (n) { if (plusOuvert) n.removeAttribute('hidden'); else n.setAttribute('hidden', ''); }
    p?.setAttribute('aria-expanded', String(plusOuvert));
    root.setAttribute('class', classeRacine());
    // La mascotte posée là où la feuille s'ouvre rentre tout de suite dans son nid (elle ne la couvre pas).
    if (plusOuvert) pet.ranger?.();
    if (focus === 'feuille') (f?.querySelector('.nav[aria-current=page]') || f?.querySelector('.nav'))?.focus();
    else if (focus === 'plus') p?.focus();
  }
  // ---------- Le plein écran (la maquette) : le menu, le bandeau et les onglets disparaissent ----------
  // Le même bouton l'ouvre (dans le bandeau) et le ferme (seul resté, en haut à droite) ; Échap aussi. La page demande
  // au navigateur le vrai plein écran ; s'il refuse (un cadre, un vieux navigateur), la page cache quand même ce qu'il
  // faut, sans erreur. Le focus suit toujours le bouton.
  function boutonPlein() {
    return el('button', { type: 'button', class: 'round plein', 'aria-label': MOTS.plein, title: plein ? MOTS.pleinSortir : MOTS.plein, 'aria-pressed': String(plein), onclick: () => basculerPlein(!plein) }, icon(plein ? 'sortir' : 'plein', 20));
  }
  function basculerPlein(v) {
    plein = Boolean(v); plusOuvert = false;
    if (plein) { ouverte = false; pleinDemande = false; try { const p = document.documentElement?.requestFullscreen?.(); if (p) { pleinDemande = true; p.catch?.(() => { pleinDemande = false; }); } } catch { pleinDemande = false; } }
    else { pleinDemande = false; try { if (document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {}); } catch { /* le navigateur refuse : la page sort quand même */ } }
    draw(); document.querySelector('.plein')?.focus({ preventScroll: true });
  }
  // Échap, une fois ce qui est ouvert par-dessus fermé (une boîte de dialogue la prend elle-même) : d'abord la feuille
  // « Plus » (le focus revient à « Plus »), puis la petite fenêtre pour parler à Odin, ouverte par le rond ou en touchant la
  // mascotte, comme sur l'accueil (ouverte par le rond, le focus revient au rond),
  // puis le plein écran. Le focus qui sort de la feuille la referme. La sortie du plein écran par le navigateur fait sortir la page.
  function ecouterTelephone() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (plusOuvert) ouvrirPlus(false, 'plus');
      else if (pet.enChat?.()) pet.fermer?.();
      else if (plein) basculerPlein(false);
    });
    document.addEventListener('focusin', (e) => { if (plusOuvert && !e.target?.closest?.('.feuille,.plus')) ouvrirPlus(false); });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && plein && pleinDemande) basculerPlein(false); });
  }
  ecouterTelephone();
  function draw() {
    if (!D) return;
    const full = D.rights === 'complet';
    // Les entrées de la barre, dans l'ordre : [section, icône, aussi pour une tablette « maison »]. Une entrée de la maquette
    // s'ajoute ici, d'une ligne, le jour où sa page existe sur cet écran (pas encore : Journal, Automatisations, Médias,
    // Maison 3D, Humeurs d'Odin ; Énergie n'aura pas de page, ses widgets suffisent) ; aucune entrée qui ne mène nulle
    // part. Son nom est dans MOTS.
    const navs = [
      ['accueil', 'home', true],
      ['famille', 'people', false],
      ['cameras', 'cam', false],
      ['reseau', 'net', false],
      ['applis', 'apps', false],
      ['boutons', 'bolt', true],
      ['themes', 'palette', true],
    ].filter((x) => full || x[2]).map(([id, ic]) => [id, MOTS[id], ic]);
    const notes = D.notices || [], unread = notes.filter((n) => n.level !== 'ok').length, [salut, pastille] = bandeau();
    const main = el('main', { id: 'main' },
      dansOdin ? secs(navs) : null,
      el('div', { class: 'top' },
        salut,
        el('div', { class: 'tools' },
          retourVisible(key, window.top !== window) ? el('a', { class: 'btn retour', href: '/', title: MOTS.retourTitre, 'aria-label': MOTS.retourTitre, style: { minHeight: '44px', minWidth: '44px', color: 'var(--text)' } }, MOTS.retour) : null,
          el('label', { class: 'search' }, icon('search', 18), el('input', { type: 'search', placeholder: 'Chercher un appareil, une appli…', 'aria-label': 'Chercher', value: q, oninput: (e) => { q = e.target.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); drawSoon(); } })),
          el('button', { class: 'round', 'aria-label': `Alertes (${unread})`, onclick: () => pet.news() }, icon('bell', 20), unread ? el('span', { class: 'dot' }, String(unread)) : null),
          el('button', { class: 'round', 'aria-label': voice ? 'Couper la voix de la mascotte' : 'Activer la voix de la mascotte', 'aria-pressed': String(voice), onclick: () => { voice = !voice; try { localStorage.setItem('odin.maison.voix', voice ? '1' : '0'); } catch { /* */ } draw(); if (voice) pet.say('Je parlerai à voix haute.', 'ok', 'joie'); } }, icon('sound', 20)), plein ? null : boutonPlein(), pastille)),
      ...(view === 'accueil' ? home() : view === 'applis' ? appsView() : view === 'famille' ? [el('h2', { class: 'sec' }, 'Famille'), peopleGrid(), el('p', { class: 'muted', style: { marginTop: '12px' } }, 'La position vient de l\'appli de chaque personne (Home Assistant ou OwnTracks), qui la voit sur son téléphone et peut la mettre en pause.')] : view === 'cameras' ? [el('h2', { class: 'sec' }, 'Caméras'), camGrid(true)] : view === 'reseau' ? netView() : view === 'boutons' ? tilesView(true) : themesView()));
    startCams();
    // La barre de côté : le titre et la punaise, les entrées avec leur nom, le retour vers Odin (même règle qu'en haut), et
    // « Odin veille » en pied (la page n'est dessinée qu'une fois l'état d'Odin reçu). La punaise dit son choix avec les
    // mots de la maquette ; désépinglée, la barre reste ouverte tant qu'on y est (la souris, le focus sur la punaise).
    const pin = el('button', { class: 'pinb', type: 'button', 'aria-label': MOTS.epingler, title: MOTS.epingler, 'aria-pressed': String(barre), onclick: (e) => { barre = !barre; ouverte = !barre; tOuvert = 0; parSouris = !barre && e?.detail > 0; try { localStorage.setItem('odin.maison.barre', barre ? '1' : '0'); } catch { /* navigation privée */ } toast(barre ? MOTS.epinglee : MOTS.libre); draw(); document.querySelector('.side .pinb')?.focus(); } }, icon('pin', 20));
    // Non épinglée : la poignée (un vrai bouton, qui dit si la barre est ouverte) et le bord gauche (la souris s'en approche).
    // La souris au bord ouvre sans prendre le focus ; la poignée s'ouvre au clic, au doigt ou au clavier seulement (jamais
    // au survol : elle disparaîtrait sous la souris et le clic tomberait sur une entrée), et met le focus dans la barre.
    const souris = (e) => { if (e.pointerType === 'mouse' && !ouverte) ouvrirBarre(true, null, true); };
    const bords = barre ? [] : [
      el('button', { class: 'poignee', type: 'button', 'aria-label': MOTS.ouvrir, title: MOTS.ouvrir, 'aria-controls': 'barre-cote', 'aria-expanded': String(ouverte), onclick: () => ouvrirBarre(!ouverte, ouverte ? 'poignee' : 'barre') }, icon('chev', 16)),
      el('div', { class: 'bord', 'aria-hidden': 'true', onpointerenter: souris })];
    const cote = el('nav', { id: 'barre-cote', class: barre ? 'side' : ouverte ? 'side libre ouverte' : 'side libre', 'aria-label': MOTS.titre, inert: !barre && !ouverte,
      onpointerenter: () => clearTimeout(tBarre),
      onpointerleave: (e) => { if (e.pointerType !== 'mouse' || barre || !ouverte || !parSouris) return; clearTimeout(tBarre); tBarre = setTimeout(() => { const s = document.querySelector('.side'); if (!s?.matches?.(':hover')) ouvrirBarre(false, s?.contains(document.activeElement) ? 'poignee' : null); }, 500); } },
      el('div', { class: 'hd' }, el('div', { class: 'logo', 'aria-hidden': 'true' }, 'ᛟ'), el('span', {}, MOTS.titre), pin),
      ...navs.map(([id, label, ic]) => nav(id, label, ic, true)),
      el('span', { class: 'sp' }),
      retourVisible(key, window.top !== window) ? el('a', { class: 'nav', href: '/', 'aria-label': MOTS.retourTitre, title: MOTS.retourTitre }, icon('back', 22), el('span', {}, MOTS.retourTitre)) : null,
      el('div', { class: 'veille' }, MOTS.veille));
    // Le focus qui était dans la barre revient, après le redessin, sur l'élément de même nom (l'entrée, la punaise).
    const garde = document.activeElement?.closest?.('.side') ? document.activeElement.getAttribute('aria-label') : null;
    // Les onglets de pièces : l'onglet qui avait le focus le retrouve, et la rangée garde sa place (redessin toutes les 15 s).
    const ongletAvant = document.activeElement?.closest?.('.tabs') ? document.activeElement.getAttribute('data-piece') : null, xOnglets = document.querySelector('.tabs')?.scrollLeft || 0;
    // La barre du bas et sa feuille, le bouton du plein écran : le focus revient, après le redessin, sur la place de même nom.
    const placeAvant = document.activeElement?.closest?.('.bnav,.feuille') ? document.activeElement.getAttribute('data-place') : null, pleinAvant = Boolean(document.activeElement?.closest?.('.plein'));
    root.setAttribute('class', classeRacine());
    // En plein écran, le bouton qui en fait sortir est le seul resté de la page hors du contenu, avec le nid flottant d'Odin.
    root.replaceChildren(...bords, cote, main, ...barreBas(navs), ...(plein ? [boutonPlein(), el('span', { class: 'nid-flottant', 'aria-hidden': 'true' })] : []));
    if (placeAvant) focusPlace(placeAvant);
    if (pleinAvant) document.querySelector('.plein')?.focus({ preventScroll: true });
    if (garde) [...cote.querySelectorAll('[aria-label]')].find((x) => x.getAttribute('aria-label') === garde)?.focus({ preventScroll: true });
    const rangee = document.querySelector('.tabs');
    if (rangee) { rangee.scrollLeft = xOnglets; if (ongletAvant !== null) ongletDe(ongletAvant)?.focus({ preventScroll: true }); }
  }
  let soon = 0; const drawSoon = () => { clearTimeout(soon); soon = setTimeout(() => { const f = document.activeElement?.type === 'search'; draw(); if (f) { const i = document.querySelector('.search input'); i?.focus(); i?.setSelectionRange(999, 999); } }, 150); };
  /** La fenêtre d'Odin : ses pages « écran de la maison » (modules d'applis, météo, boutons). */
  // ---------- Mode « Modifier » de l'écran (tous les droits seulement) : déplacer les modules et les boutons en les
  // glissant (souris ou doigt) ou avec ◀ ▶, changer leur taille, les retirer, en ajouter. Tout est rangé par Hestia
  // (la même fenêtre que sur l'accueil d'Odin) ; les autres modules s'ajoutent depuis l'accueil d'Odin, bouton Modifier.
  let edition = false, glisse = false, L = null;
  const valhalla = (module, action, input = {}) => api('/api/valhalla/act', { module, action, input });
  const pageL = (id) => L?.pages.find((x) => x.id === id);
  async function ranger() {
    try { const r = await valhalla('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(L) }); if (r.ok === false) toast(r.text || 'Impossible de ranger la fenêtre.'); else if (r.data) L = r.data; } catch (e) { toast(e.message); }
    await load();
  }
  async function modifier(on) {
    if (on) { try { const r = await valhalla('gladsheim', 'fenetre'); L = r.data; } catch (e) { return toast(e.message); } if (!L?.pages) return toast('La fenêtre n\'est pas disponible pour l\'instant.'); }
    edition = on;
    // Une fenêtre jamais rangée est refaite à chaque lecture (ses modules changent de numéro) : on la range une
    // première fois en entrant, pour que les modules gardent leur numéro pendant qu'on les déplace.
    if (on) await ranger(); else draw();
  }
  /** La page de l'écran de la maison où ajouter (créée s'il n'y en a pas encore). */
  function pageMaison() { let p = L.pages.find((x) => x.maison); if (!p) { p = { id: '', name: 'Maison', maison: true, widgets: [] }; L.pages.unshift(p); } return p; }
  const ajouter = (w) => { pageMaison().widgets.push({ id: '', w: 1, ...w }); return ranger(); };
  function bouger(pid, wid, d) { const l = pageL(pid)?.widgets, i = l?.findIndex((x) => x.id === wid) ?? -1, j = i + d; if (i < 0 || j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; ranger(); }
  function poser(pid, wid, versPage, avant) {
    const de = pageL(pid)?.widgets, i = de?.findIndex((x) => x.id === wid) ?? -1, vers = pageL(versPage)?.widgets; if (i < 0 || !vers) return draw();
    const [w] = de.splice(i, 1), j = vers.findIndex((x) => x.id === avant); vers.splice(j < 0 ? vers.length : j, 0, w); ranger();
  }
  function taille(pid, wid) { const w = pageL(pid)?.widgets.find((x) => x.id === wid); if (!w) return; w.w = w.w >= 2 ? 1 : 2; ranger(); }
  async function retirer(pid, wid, titre) { if (!(await confirmBox(`Retirer « ${titre} » de l'écran ?`))) return; const p = pageL(pid); if (!p) return; p.widgets = p.widgets.filter((x) => x.id !== wid); ranger(); }
  function glisser(e, card, pid, wid) {
    e.preventDefault(); const h = e.currentTarget; let cible = null; glisse = true;
    try { h.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    card.classList.add('glisse');
    const mv = (ev) => { const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-fw]'); cible?.classList.remove('cible'); cible = t && t !== card ? t : null; cible?.classList.add('cible'); };
    const fin = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', fin); h.removeEventListener('pointercancel', fin); glisse = false; card.classList.remove('glisse'); if (cible) poser(pid, wid, cible.dataset.fp, cible.dataset.fw); else draw(); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', fin); h.addEventListener('pointercancel', fin);
  }
  /** En mode Modifier : la poignée et les commandes d'un module. */
  function outils(card, w, p) {
    card.dataset.fw = w.id; card.dataset.fp = p.id;
    if (!edition) return card;
    const b = (texte, nom, f) => el('button', { type: 'button', 'aria-label': `${nom} : ${w.title}`, title: nom, onclick: f }, texte);
    const poignee = el('button', { type: 'button', class: 'fw-poignee', 'aria-label': `Déplacer ${w.title} (glisser, ou les flèches ◀ ▶)`, title: 'Glisser pour déplacer' }, '⠿');
    poignee.addEventListener('pointerdown', (e) => glisser(e, card, p.id, w.id));
    card.append(el('div', { class: 'fw-outils' }, poignee, b('◀', 'Avant', () => bouger(p.id, w.id, -1)), b('▶', 'Après', () => bouger(p.id, w.id, 1)), b('↔', 'Taille', () => taille(p.id, w.id)), b('✕', 'Retirer', () => retirer(p.id, w.id, w.title))));
    return card;
  }
  /** Un site à surveiller, visible sur l'écran : Pulsar le vérifie ensuite tout seul. */
  function siteSurveille() {
    const nom = el('input', { type: 'text', placeholder: 'Nom (ex. Mon site)', 'aria-label': 'Nom du site', maxlength: '60' }), url = el('input', { type: 'url', placeholder: 'https://exemple.fr', 'aria-label': 'Adresse du site' });
    const d = el('dialog', { 'aria-label': 'Site surveillé' }, el('p', {}, 'Quel site surveiller ? Son état s\'affichera sur l\'écran.'), el('div', { class: 'lieu', style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, nom, url),
      el('div', { class: 'acts' }, el('button', { class: 'btn', onclick: () => d.close() }, 'Annuler'), el('button', { class: 'btn', onclick: async () => {
        const n = nom.value.trim(), u = url.value.trim(); if (!n || !/^https?:\/\/\S+$/i.test(u)) return toast('Donne un nom et une adresse qui commence par http:// ou https://.');
        d.close(); const r = await valhalla('vordr', 'ajouter', { nom: n, genre: 'http', cible: u }).catch((e) => ({ ok: false, text: e.message }));
        if (r.ok === false && !/existe déjà/i.test(r.text || '')) return toast(r.text || 'Pulsar a refusé.');
        await ajouter({ kind: 'site', module: 'vordr', label: n });
      } }, 'Surveiller')));
    d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); nom.focus();
  }
  function barreEdition() {
    if (!D || D.rights !== 'complet') return [];
    if (!edition) return [el('div', { class: 'fe-barre' }, el('button', { class: 'btn', type: 'button', onclick: () => modifier(true) }, '✎ Modifier l\'écran'))];
    return [el('div', { class: 'fe-barre' }, el('button', { class: 'btn', type: 'button', onclick: () => ajouter({ kind: 'heure' }) }, '＋ Heure et lieu'), el('button', { class: 'btn', type: 'button', onclick: () => ajouter({ kind: 'meteo' }) }, '＋ Météo'),
      el('button', { class: 'btn', type: 'button', onclick: siteSurveille }, '＋ Site surveillé'), el('a', { class: 'btn', href: dansOdin ? '/#home' : '/', target: cibleOdin(dansOdin, window.top !== window), rel: 'noopener', title: 'Tous les modules des applis et les boutons sur mesure : accueil d\'Odin, bouton Modifier' }, 'Tous les modules…'),
      el('button', { class: 'btn', type: 'button', onclick: () => modifier(false) }, '✓ Terminé')),
    el('p', { class: 'muted', style: { margin: '0 0 10px' } }, 'Glisse un module par sa poignée ⠿ pour le poser ailleurs, ou utilise ◀ ▶. ↔ change sa taille, ✕ le retire.')];
  }
  function fenetrePages() {
    const pages = (D.fenetre || []).filter((p) => p.widgets.length || edition);
    return [...barreEdition(), ...pages.flatMap((p) => [el('h2', { class: 'sec' }, p.name), el('div', { class: 'grid' }, ...p.widgets.map((w) => outils(fWidget(w), w, p)))])];
  }
  // ---------- Le dessin commun d'un widget (lot 25a, pages/widgets-rendu.js, chargé avant) ----------
  // L'en-tête de la maquette (tuile, titre, sous-titre) et la ligne d'un état sans donnée. Sur cet écran, le serveur ne
  // sert que les widgets permis à qui regarde (un widget fermé n'arrive pas) ; ses outils de rangement restent les siens.
  const WR = () => window.OdinWidgetsRendu;
  function fTete(titre, sous, lettre) {
    const R = WR(); if (!R) return el('h3', {}, sous ? `${sous} · ${titre}` : titre);
    return R.entete({ titre, sous, lettre: lettre || String(sous || titre || '?').slice(0, 1) });
  }
  /** La ligne d'un état vu ici (son code, comme le serveur le dirait). Pas de bouton sur cet écran. */
  function fEtat(etat, raison, o = {}) {
    const R = WR(); if (!R) return null;
    return R.corps(R.decrire({ etat, raison }, { proprio: D?.rights === 'complet', peutAgir: () => false, ...o }));
  }
  /**
   * Une sorte dessinée par le rendu de sa famille (pages/widgets-<famille>.js, registre commun de pages/widgets-rendu.js) :
   * l'en-tête commun, puis son corps, fait de l'état que le serveur a rendu pour ce widget (`w.etat`) et de rien d'autre.
   * Sans état, ou si son dessin échoue : une ligne, jamais une donnée. Pas de bouton ici. Un petit chiffre n'a d'en-tête
   * dans aucun état : sans donnée, son état court (l'icône de l'état, deux ou trois mots), comme sur l'accueil.
   */
  function fFamille(w, rf) {
    const R = WR(), e = w.etat && typeof w.etat === 'object' ? w.etat : { etat: 'source_absente', raison: 'pas_encore_lu' };
    const titre = w.title || rf.titre, commun = { proprio: D?.rights === 'complet', peutAgir: () => false, appli: w.app, titre };
    let d = R.decrire(e, commun);
    const o = { w, titre, nomAppli: w.app || '', pastille: d.pastille, ecran: 'maison' };
    const corps = R.dessineElleMeme(rf, d) ? R.dessiner(rf, e, o) : null;
    if (!corps && d.donnee) d = R.decrire({ etat: 'source_absente', raison: 'lecture_echouee' }, commun);
    const card = el('div', { class: `card${w.w >= 2 ? ' w2' : ''} fw` });
    if (rf.petit) { card.append(corps ?? R.etatPetit(d, { titre })); return card; }
    card.append(R.entete({ titre, sous: d.gris ? '' : [w.app, corps ? R.sous(rf, e, o) : ''].filter(Boolean).join(' · '), lettre: rf.symbole, pastille: d.pastille, gris: d.gris }), corps ?? R.corps(d));
    return card;
  }
  function fWidget(w) {
    // Le registre des familles d'abord : une sorte neuve se dessine sans retoucher cet écran.
    const rf = WR()?.rendu?.(w.kind, w.style); if (rf) return fFamille(w, rf);
    if (w.kind === 'meteo') return weatherCard(D.weather);
    if (w.kind === 'heure') {
      const l = D.lieu || {}, soleil = D.weather?.sunrise ? ` · ☀ ${D.weather.sunrise} – ${D.weather.sunset}` : '';
      setTimeout(tick, 0);
      return el('div', { class: `card${w.w >= 2 ? ' w2' : ''} fw fh` }, fTete(w.title, 'Hestia', '🕒'), el('div', { class: 'big fh-h' }), el('div', { class: 'fh-j' }), el('div', { class: 'muted' }, `${l.nom || 'Lieu non réglé'}${l.fuseau ? ` · ${l.fuseau}` : ''}${l.suppose ? ' · supposé' : ''}${soleil}`));
    }
    if (w.kind === 'site') {
      const so = w.sonde, c = el('div', { class: `card${w.w >= 2 ? ' w2' : ''} fw` }, fTete(w.title, 'Pulsar · site surveillé', '🌐'));
      c.append(so ? el('ul', { class: 'fl' }, el('li', { class: so.tone || '' }, el('b', {}, so.etat || '—'), el('span', { class: 'muted' }, [so.cible, so.temps].filter(Boolean).join(' · '))), el('li', {}, el('b', {}, 'Disponibilité'), el('span', { class: 'muted' }, `24 h : ${so.jour || '—'} · 30 jours : ${so.mois || '—'}`)))
        : fEtat('vide', 'site_introuvable'));
      return c;
    }
    const card = el('div', { class: `card${w.w >= 2 ? ' w2' : ''} fw` }, fTete(w.title, w.app && w.app !== w.title ? w.app : '', w.kind === 'bouton' ? '⚡' : ''));
    // Une sorte que cet écran ne sait pas dessiner (ni lui, ni un fichier de famille) : sa carte le dit, la page continue.
    if (!['bouton', 'chiffres', 'section'].includes(w.kind)) { const n = fEtat('source_absente', 'pas_encore_lu'); if (n) card.append(n); return card; }
    if (w.kind === 'bouton') { card.append(el('button', { class: 'scene', style: { marginTop: '10px' }, onclick: () => act('/api/maison/fenetre', { id: w.id }) }, `${w.grave ? '⚠ ' : '⚡ '}${w.title}`)); return card; }
    // Des chiffres sans vraie mesure (que des zéros, des tirets) : « rien de mesuré », jamais un chiffre inventé.
    if (w.kind === 'chiffres') { const R = WR(); if (R && !(w.kpis || []).some((k) => R.porteUneMesure(k.value))) { card.append(fEtat('vide', 'rien_mesure')); return card; } card.append(el('div', { class: 'fk' }, ...(w.kpis || []).map((k) => el('div', { class: `fki ${k.tone || ''}` }, el('small', {}, k.label), el('b', {}, k.value))))); return card; }
    const sc = w.section || {};
    // Une liste vide (sa réponse 3 a) : le texte propre à ce qu'elle montre (celui de l'appli), sans bouton.
    if (['table', 'list', 'cards', 'bars'].includes(sc.kind) && !(sc.rows || sc.items || []).length && WR()) { card.append(fEtat('vide', 'partie_vide', { vide: sc.empty, titre: w.title })); return card; }
    if (sc.kind === 'table') card.append(el('ul', { class: 'fl' }, ...(sc.rows || []).slice(0, 6).map((r) => el('li', { class: r.tone || '' }, el('b', {}, r.cells[0]), el('span', { class: 'muted' }, r.cells.slice(1, 3).join(' · '))))));
    else if (sc.kind === 'list') card.append(el('ul', { class: 'fl' }, ...(sc.items || []).slice(0, 6).map((i) => el('li', { class: i.tone || '' }, el('b', {}, i.title), i.detail ? el('span', { class: 'muted' }, i.detail) : null))));
    else if (sc.kind === 'cards') card.append(el('ul', { class: 'fl' }, ...(sc.items || []).slice(0, 6).map((i) => el('li', { class: i.tone || '' }, el('b', {}, i.title), el('span', { class: 'muted' }, [i.sub, i.badge].filter(Boolean).join(' · '))))));
    else if (sc.kind === 'bars') card.append(el('ul', { class: 'fl' }, ...(sc.items || []).slice(0, 6).map((i) => el('li', {}, el('b', {}, i.label), el('span', { class: 'muted' }, String(i.value))))));
    else if (sc.kind === 'text') card.append(el('p', {}, sc.text));
    else if (sc.kind === 'log') card.append(el('pre', { class: 'muted', style: { whiteSpace: 'pre-wrap', fontSize: '12px', margin: '8px 0 0' } }, (sc.lines || []).slice(-8).join('\n')));
    if (((sc.rows || sc.items || []).length === 0) && ['table', 'list', 'cards', 'bars'].includes(sc.kind)) card.append(el('p', { class: 'muted' }, sc.empty || 'Rien pour l\'instant.'));
    return card;
  }
  function home() {
    const rooms = D.rooms || [], names = rooms.map((r) => r.name);
    if (room !== null && !names.includes(room)) room = null; // la pièce choisie n'a plus d'appareil : tout
    const devs = rooms.filter((r) => room === null || r.name === room).flatMap((r) => r.devices).filter((d) => match(`${d.name} ${d.kind}`));
    const notes = (D.notices || []).slice(0, 5);
    return [
      onglets(names),
      el('div', { class: 'grid', id: 'maison-grille' },
        weatherCard(D.weather),
        el('div', { class: 'card clock' }, el('h3', {}, 'Heure'), clock, clockSub),
        ...(D.scenes?.length ? [el('div', { class: 'card w2' }, el('h3', {}, 'Scènes'), el('div', {}, ...D.scenes.map((s) => el('button', { class: 'scene', onclick: () => act('/api/maison/scene', { scene: s }) }, `🎬 ${s}`))))] : []),
        ...devs.map(devCard),
        ...(!rooms.length ? [el('div', { class: 'card w2' }, el('h3', {}, 'Appareils'), el('p', { class: 'muted' }, 'Aucun appareil : relie ta box (Home Assistant…) ou tes prises dans Midgard, ils apparaîtront ici.'))] : []),
        ...(notes.length ? [el('div', { class: 'card w2 notes' }, el('h3', {}, 'Dernières nouvelles'), el('ul', {}, ...notes.map((n) => el('li', { class: n.level }, el('b', {}, n.title), n.detail ? el('div', { class: 'muted' }, n.detail.slice(0, 140)) : null))))] : [])),
      ...fenetrePages(),
      ...(D.people?.length ? [el('h2', { class: 'sec' }, 'Famille'), peopleGrid()] : []),
      ...(D.cameras?.length ? [el('h2', { class: 'sec' }, 'Caméras'), camGrid(false)] : []),
      el('h2', { class: 'sec' }, 'Mes boutons'), ...tilesView(false),
      ...(D.rights === 'complet' ? [el('h2', { class: 'sec' }, 'Mes applis'), appsGrid((D.apps || []).filter((a) => a.alerts || a.kpis.length).sort((a, b) => b.alerts - a.alerts).slice(0, 8))] : []),
    ];
  }
  // ---------- Famille (présence partagée par l'appli Home Assistant de chacun) ----------
  const placeFr = (st) => ({ home: 'À la maison', not_home: 'Absent', unknown: 'Inconnu', unavailable: 'Indisponible' }[st] ?? st);
  function peopleGrid() {
    const ps = (D.people || []).filter((x) => match(x.name));
    if (!ps.length) return el('p', { class: 'empty' }, 'Personne : chaque membre de la famille installe l\'appli Home Assistant et partage sa position ; il apparaîtra ici.');
    return el('div', { class: 'grid' }, ...ps.map((x) => el('div', { class: `card person${x.state === 'home' ? ' home' : ''}` },
      el('div', { class: 'row' }, el('span', { class: 'av', 'aria-hidden': 'true' }, x.name.slice(0, 1).toUpperCase()), el('div', {}, el('b', {}, x.name), el('div', { class: 'muted' }, placeFr(x.state)))),
      el('div', { class: 'muted' }, [x.since ? `depuis ${new Date(x.since).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : '', x.batt !== undefined ? `batterie ${x.batt} %` : '', x.acc ? `± ${x.acc} m` : '', x.source || ''].filter(Boolean).join(' · ')),
      x.lat !== undefined ? el('a', { class: 'btn', href: `https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=16/${x.lat}/${x.lon}`, target: '_blank', rel: 'noopener noreferrer' }, icon('open', 16), ' Voir sur la carte') : null)));
  }
  // ---------- Caméras (aperçu rafraîchi toutes les 6 s quand elles sont à l'écran) ----------
  const camUrls = new Map(); let camTimer = 0;
  function camGrid(big) {
    return el('div', { class: 'grid cams' }, ...(D.cameras || []).filter((n) => match(n)).map((n) => el('figure', { class: `card cam${big ? ' w2' : ''}` }, el('img', { alt: `Caméra ${n}`, 'data-cam': n, src: camUrls.get(n) || null }), el('figcaption', {}, el('b', {}, n), el('span', { class: 'muted live' }, '● en direct')))));
  }
  async function refreshCam(img) {
    const n = img.dataset.cam;
    try { const r = await fetch(`/api/maison/camera?nom=${encodeURIComponent(n)}`, { headers: key ? { 'x-odin-maison': key } : {}, credentials: 'same-origin' }); if (!r.ok) throw new Error(); const u = URL.createObjectURL(await r.blob()); const old = camUrls.get(n); camUrls.set(n, u); document.querySelectorAll(`img[data-cam="${CSS.escape(n)}"]`).forEach((i) => { i.src = u; i.closest('.cam')?.classList.remove('off'); }); if (old) setTimeout(() => URL.revokeObjectURL(old), 2000); }
    catch { img.closest('.cam')?.classList.add('off'); }
  }
  function startCams() { clearInterval(camTimer); const imgs = () => [...document.querySelectorAll('img[data-cam]')]; if (!imgs().length) return; imgs().forEach(refreshCam); camTimer = setInterval(() => { if (!document.hidden) imgs().forEach(refreshCam); }, 6000); }
  // ---------- Réseau : couper Internet ou la vidéo d'un appareil (Sphinx) ----------
  const NETICO = { ordinateur: '💻', 'téléphone': '📱', tablette: '📱', 'télévision': '📺', imprimante: '🖨', console: '🎮', camera: '📷', 'caméra': '📷', routeur: '📶', serveur: '🗄' };
  function netView() {
    const ds = (D.network || []).filter((d) => match(`${d.name} ${d.ip} ${d.kind}`));
    return [el('h2', { class: 'sec' }, `Réseau de la maison (${ds.length})`),
      ds.length ? el('div', { class: 'grid' }, ...ds.map((d) => el('div', { class: `card dev${d.cut ? ' cut' : ''}` },
        el('div', { class: 'row' }, el('span', { class: 'em', 'aria-hidden': 'true' }, NETICO[d.kind] || '🔌'), el('div', { style: { minWidth: 0 } }, el('b', {}, d.name), el('span', { class: 'muted' }, `${d.ip}${d.cut ? ' · Internet coupé' : ''}${d.video ? ' · vidéo coupée' : ''}`))),
        el('div', { class: 'ctl' },
          el('button', { class: `btn${d.cut ? ' primary' : ''}`, 'aria-pressed': String(d.cut), onclick: () => act('/api/maison/reseau', { ip: d.ip, nom: d.name, couper: !d.cut }) }, d.cut ? 'Rétablir Internet' : 'Couper Internet'),
          el('button', { class: `btn${d.video ? ' primary' : ''}`, 'aria-pressed': String(d.video), onclick: () => act('/api/maison/video', { ip: d.ip, nom: d.name, couper: !d.video }) }, d.video ? 'Rétablir la vidéo' : 'Couper la vidéo'))))) : el('p', { class: 'empty' }, 'Aucun appareil connu : lance le DNS de la maison (Sphinx) ou l\'inventaire (Atlas).'),
      el('p', { class: 'muted', style: { marginTop: '12px' } }, 'Coupure par le DNS de la maison : un appareil réglé à la main sur un autre DNS y échappe.')];
  }
  function appsGrid(list) {
    return list.length ? el('div', { class: 'grid' }, ...list.filter((a) => match(`${a.name} ${a.family}`)).map((a) => el('a', { class: 'card appc', href: `/#app=${encodeURIComponent(a.id)}`, target: cibleOdin(dansOdin, window.top !== window), rel: 'noopener' },
      a.alerts ? el('span', { class: 'badge', 'aria-label': `${a.alerts} alerte(s)` }, String(a.alerts)) : null,
      el('b', {}, a.name), el('span', { class: 'muted' }, a.family), ...a.kpis.map((k) => el('div', { class: `k ${k.tone || ''}` }, el('span', {}, k.label), el('b', {}, k.value)))))) : el('p', { class: 'empty' }, 'Aucune appli à montrer.');
  }
  function appsView() { return [el('h2', { class: 'sec' }, `Toutes mes applis (${(D.apps || []).length})`), appsGrid(D.apps || [])]; }
  function tilesView(full) {
    const ts = (D.tiles || []).filter((t) => match(t.label));
    return [el('div', { class: 'grid' }, ...ts.map((t) => el('button', { class: 'tile', style: t.color ? { borderColor: t.color } : null, onclick: () => act('/api/maison/bouton', { id: t.id }) }, el('span', { class: 'em', 'aria-hidden': 'true', style: t.color ? { background: t.color } : null }, t.icon), el('b', {}, t.label), t.grave ? el('span', { class: 'muted' }, 'avec confirmation') : null)),
      ...(ts.length ? [] : [el('p', { class: 'empty' }, 'Aucun bouton.')])),
      ...(full ? [el('p', { class: 'muted', style: { marginTop: '14px' } }, 'Ajoute un bouton vers n\'importe quelle action d\'une appli dans Odin → Hestia → « Ajouter un bouton » (ou dis-le à la mascotte).')] : [])];
  }
  function themesView() {
    const liste = Object.entries(D.themes || {});
    const carte = ([k, label]) => { const t = themeMaison(k); return el('button', { class: 'th', 'aria-pressed': String(D.theme === k), onclick: async () => { applyTheme(k); D.theme = k; draw(); if (D.rights === 'complet') await act('/api/maison/theme', { theme: k }); else try { localStorage.setItem('odin.maison.theme', k); } catch { /* */ } } },
      el('div', { class: 'pv', style: { background: t.bg2 } }, el('i', { style: { background: t.card } }), el('i', { style: { background: t.on } }), el('i', { style: { background: t.card2 } }), el('i', { style: { background: t.accent } })), el('span', {}, label)); };
    return [el('h2', { class: 'sec' }, 'Thèmes'), ...Object.keys(FAMILLES_THEMES).flatMap((f) => { const ts = liste.filter(([k]) => familleTheme(k) === f); return ts.length ? [el('h3', { class: 'fam' }, FAMILLES_THEMES[f]), el('div', { class: 'themes' }, ...ts.map(carte))] : []; })];
  }

  // ---------- Chargement ----------
  async function load() {
    try {
      const d = await api('/api/maison/etat'); if (!d.ok) throw new Error(d.error || 'erreur');
      let th = d.theme; if (d.rights !== 'complet') try { th = localStorage.getItem('odin.maison.theme') || th; } catch { /* */ }
      if (!D || D.theme !== th) applyTheme(th);
      D = { ...d, theme: th }; nuit.cacher(); if (!glisse) draw(); // pas de redessin pendant qu'on glisse un module
      // Odin d'aujourd'hui (le même que partout) : caché ou non, fête du jour.
      if (d.mascotte) { window.OdinMascotte?.onState?.(d.mascotte); const c = d.mascotte.event?.color || d.mascotte.odin?.color; if (c) window.OdinFace?.tintBase?.(c); }
      // Nouvelles bulles : la mascotte les annonce (rouge et à voix haute si c'est grave).
      for (const n of (d.notices || []).slice().reverse()) { if (seen.has(n.id)) continue; seen.add(n.id); if (!first) pet.say(`${n.title}${n.detail ? `\n${n.detail.slice(0, 200)}` : ''}`, n.level, n.level === 'grave' ? 'inquiet' : n.level === 'souci' ? 'reflexion' : 'joie', n.level === 'grave'); }
      if (first) { first = false; setTimeout(() => pet.say(`${hello()} ! ${d.weather ? `Il fait ${d.weather.temp}° à ${d.weather.place}, ${d.weather.word.toLowerCase()}.` : ''} Touche-moi pour me parler.`, 'ok', 'joie'), 900); }
    } catch (e) {
      if (!D) applyTheme('verre');
      nuit.montrer(el('h1', {}, 'Écran de la maison'), el('p', {}, e.auth ? 'Connecte-toi à Odin, ou ouvre le lien de tablette donné par Hestia.' : `Odin ne répond pas : ${e.message}. Nouvel essai dans quelques secondes.`), e.auth ? el('a', { href: '/', target: cibleOdin(dansOdin, window.top !== window), rel: 'noopener' }, 'Se connecter à Odin') : null);
    }
  }

  // ---------- La mascotte ----------
  const pet = (() => {
    const tpl = document.getElementById('mascotte'), w = el('div', { class: 'pet', role: 'button', tabindex: '0', 'aria-label': 'Odin, la mascotte : touche pour lui parler' }), body = el('div', { class: 'bodyw odin' });
    if (tpl?.content.firstElementChild) body.append(tpl.content.firstElementChild.cloneNode(true)); else body.append('ᛟ');
    w.append(body); document.body.append(w);
    let x = innerWidth - 120, y = innerHeight - 160, bubble = null, bubbleTimer = 0, dragging = null, taps = [], ball = null, play = 0, lastMove = Date.now();
    const size = () => (innerWidth < 600 ? 60 : 78);
    const mood = (m) => { try { window.OdinFace?.set(body, m); } catch { /* */ } };
    // « auNid » : elle rentre dans le rond de la barre du bas (elle s'y cache) ; elle se montre dès qu'elle en sort.
    const place = (nx, ny, fast, auNid = false) => {
      // Pendant des touchers rapides (4 = Alchimie…), il reste sous le doigt.
      if (!dragging && taps.length && Date.now() - taps[taps.length - 1] < 1300) return;
      const s = size(), ax = x, ay = y; w.style.setProperty('--ps', `${s}px`);
      x = Math.max(6, Math.min(innerWidth - s - 6, nx)); y = Math.max(6, Math.min(innerHeight - s - 6, ny));
      if (auNid) w.classList.add('au-nid'); else if (Math.abs(x - ax) > 1 || Math.abs(y - ay) > 1) w.classList.remove('au-nid');
      w.classList.toggle('fast', Boolean(fast)); w.style.transform = `translate(${x}px,${y}px)`;
      if (!reduce && !dragging) { w.classList.add('walk'); clearTimeout(w._t); w._t = setTimeout(() => w.classList.remove('walk'), fast ? 450 : 1100); }
      lastMove = Date.now(); placeBubble();
    };
    place(x, y);
    mood('neutre');
    // Promenade : de temps en temps vers un coin libre de l'écran (jamais pendant une conversation).
    // Odin ne se pose jamais sur un widget : il vit dans les zones vides (en bas d'abord), s'y promène,
    // et ne monte au-dessus d'un widget que quand tu lui demandes quelque chose qui le concerne.
    // La barre du bas et sa feuille ne sont pas des places libres : elle n'y entre que par son nid (feuille ouverte, elle y rentre).
    // Les onglets de pièces et le menu des sections non plus (un appui sur un onglet ne tombe jamais sur elle), ni le nid flottant.
    const WIDGET = '.card,.tile,.chip,.nav,.logo,.top,.sec,.th,.toast,dialog,a,button,input,.hello,.tools,.bnav,.feuille,.voile,.tabs,.secs,.nid-flottant';
    const isFree = (px, py, s) => [[px + 4, py + 4], [px + s - 4, py + 4], [px + 4, py + s - 4], [px + s - 4, py + s - 4], [px + s / 2, py + s / 2]].every(([cx, cy]) => {
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return false;
      const hit = document.elementsFromPoint(cx, cy).find((n) => !w.contains(n) && n !== w && !bubble?.contains(n) && !n.classList?.contains('ball'));
      return !hit?.closest(WIDGET);
    });
    /** Les places libres, des plus basses aux plus hautes. */
    function freeSpots() {
      const s = size(), out = [];
      for (let py = innerHeight - s - 14; py >= 60; py -= 28) for (let px = 16; px <= innerWidth - s - 16; px += 36) if (isFree(px, py, s)) out.push([px, py]);
      return out;
    }
    let home = null, visiting = 0;
    // Son nid (comme sur l'accueil) : le rond du centre de la barre du bas du téléphone, quand il se voit ; en plein écran,
    // le nid flottant en bas à droite (la maquette).
    const vu = (n) => Boolean(n && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
    const nid = () => { const n = document.querySelector('.bnav .nid'), f = document.querySelector('.nid-flottant'); return vu(n) ? n : vu(f) ? f : null; };
    /** Retour à sa place de repos : la place libre la plus basse (au plus près d'où il est). */
    function rest(fast) {
      // Aucune place libre : au téléphone, il rentre dans son nid (il en ressort dès qu'une place se libère) ; sinon il
      // reste où il est, mais toujours dans l'écran (l'écran a pu rapetisser depuis).
      const spots = freeSpots(), n = spots.length ? null : nid();
      // Dans le rond de la barre, elle se cache derrière lui (c'est lui qui prend l'appui) ; sur le nid flottant, elle reste visible.
      if (n) { home = null; const r = n.getBoundingClientRect(), s = size(), nx = r.left + r.width / 2 - s / 2, ny = r.top + r.height / 2 - s / 2, barre = n.matches('.bnav .nid'); if (Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1) place(nx, ny, fast, barre); else w.classList.toggle('au-nid', barre); return; }
      if (!spots.length) { home = null; place(x, y, fast); return; }
      const low = spots[0][1], row = spots.filter((p) => p[1] >= low - 28);
      const best = row.sort((a, b) => Math.abs(a[0] - x) - Math.abs(b[0] - x))[0]; home = best; place(best[0], best[1], fast);
    }
    /** Va au-dessus d'un widget (une demande qui le concerne), puis revient dans sa zone. */
    function visit(elem) {
      if (!elem || reduce) return; const r = elem.getBoundingClientRect(), s = size();
      visiting = Date.now(); place(r.left + r.width / 2 - s / 2, Math.max(8, r.top - s * 0.6), true);
      setTimeout(() => { if (Date.now() - visiting >= 5500 && !bubble?.dataset.chat) { visiting = 0; rest(); } }, 6000);
    }
    setTimeout(() => rest(), 600);
    // Jamais hors de l'écran : au chargement d'un téléphone, la page peut d'abord se croire plus large (980 px), puis
    // rapetisser sans « resize » ; une fenêtre tournée fait de même. Il revient alors dans l'écran, à la bonne taille.
    setInterval(() => { const s = size(); if (!dragging && (x > innerWidth - s - 6 || y > innerHeight - s - 6 || parseFloat(w.style.getPropertyValue('--ps')) !== s)) { place(x, y, true); if (!bubble && !visiting) setTimeout(() => rest(true), 500); } }, 1000);
    setInterval(() => {
      if (bubble || dragging || play || reduce || visiting) return;
      const s = size();
      // Le contenu a bougé sous lui (défilement, nouvelle carte) : il se pousse vers une place libre.
      if (!isFree(x, y, s)) { rest(true); return; }
      if (Date.now() - lastMove < 12000) return;
      const spots = freeSpots(); if (!spots.length) return;
      const low = spots.filter((p) => p[1] >= spots[0][1] - 120), pick = (Math.random() < 0.7 ? low : spots)[Math.floor(Math.random() * (Math.random() < 0.7 ? low : spots).length)] ?? spots[0];
      place(pick[0], pick[1]);
    }, 4000);
    addEventListener('scroll', () => { clearTimeout(w._sc); w._sc = setTimeout(() => { if (!dragging && !play && !visiting && !isFree(x, y, size())) rest(true); }, 250); }, { passive: true });
    addEventListener('resize', () => place(x, y));
    // Elle ne gêne jamais : si ta souris arrive sur elle alors qu'un bouton ou un réglage est caché dessous, elle s'écarte.
    let lastFlee = 0;
    document.addEventListener('pointermove', (e) => {
      if (dragging || e.pointerType === 'touch' || Date.now() - lastFlee < 700) return;
      const s = size(); if (e.clientX < x - 4 || e.clientX > x + s + 4 || e.clientY < y - 4 || e.clientY > y + s + 4) return;
      const under = document.elementsFromPoint(e.clientX, e.clientY).find((n) => !w.contains(n) && n !== w);
      if (!under?.closest('button,a,input,select,textarea,[role=switch],.ball')) return;
      lastFlee = Date.now(); const dx = e.clientX < x + s / 2 ? 1 : -1;
      place(x + dx * (s + 40), y + (y > innerHeight / 2 ? -s : s), true);
    }, { passive: true });
    // Glisser la mascotte ; toucher = parler ; trois touches rapides = elle rit et saute.
    w.addEventListener('pointerdown', (e) => { dragging = { dx: e.clientX - x, dy: e.clientY - y, sx: e.clientX, sy: e.clientY, moved: false }; w.setPointerCapture(e.pointerId); w.classList.add('drag'); });
    w.addEventListener('pointermove', (e) => { if (!dragging) return; if (Math.hypot(e.clientX - dragging.sx, e.clientY - dragging.sy) > 6) dragging.moved = true; if (dragging.moved) place(e.clientX - dragging.dx, e.clientY - dragging.dy); });
    w.addEventListener('pointerup', () => {
      const d = dragging; dragging = null; w.classList.remove('drag'); if (!d || d.moved) return;
      taps = taps.filter((t) => Date.now() - t < 900); taps.push(Date.now());
      // Le même petit son que partout ailleurs quand on la touche (coupé si le son d'Odin est coupé).
      window.OdinFace?.sound?.('bounce');
      // Les clics rapides réglés dans Odin (1 = parler, 10 = se cacher…) ; sans eux, trois touches = elle rit.
      // La petite fenêtre s'ouvre un court instant après un toucher seul : des touchers rapides (4 = Alchimie) ne la font pas apparaître sous le doigt.
      if (window.OdinMascotte) { window.OdinMascotte.tap(body, () => { clearTimeout(w._chat); w._chat = setTimeout(() => { if (Date.now() - taps[taps.length - 1] < 380) return; if (bubble?.dataset.chat) closeBubble(); else chat(); }, 400); }); return; }
      if (taps.length >= 3) { taps = []; mood('rire'); anim('spin'); say('Hihi, ça chatouille !', 'ok', 'rire'); return; }
      if (bubble?.dataset.chat) closeBubble(); else chat();
    });
    w.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chat(); } });
    function anim(c) { if (reduce) return; w.classList.remove('hop', 'spin'); void w.offsetWidth; w.classList.add(c); setTimeout(() => w.classList.remove(c), 900); }
    // « ancre » : le rond d'Odin de la barre du bas, quand c'est lui qui a ouvert la conversation (la bulle se pose au-dessus
    // de lui ; fermée, le focus lui revient s'il était dans la bulle ou nulle part).
    let ancre = null;
    const marquerNid = () => document.querySelector('.bnav .nid')?.setAttribute('aria-expanded', String(Boolean(bubble?.dataset.chat)));
    function placeBubble() {
      if (!bubble) return; const bw = bubble.offsetWidth, bh = bubble.offsetHeight, s = size();
      const a = ancre ? document.querySelector(ancre) : null, r = a && a.getClientRects().length ? a.getBoundingClientRect() : null;
      let left = r ? r.left + r.width / 2 - bw / 2 : x + s / 2 - bw / 2, top = r ? r.top - bh - 12 : y - bh - 12; if (top < 8) top = r ? 8 : y + s + 12;
      bubble.style.left = `${Math.max(12, Math.min(innerWidth - bw - 12, left))}px`; bubble.style.top = `${Math.max(8, Math.min(innerHeight - bh - 8, top))}px`;
    }
    function closeBubble() {
      const was = Boolean(bubble), a = ancre, f = document.activeElement, rendre = a && (!f || f === document.body || bubble?.contains(f));
      ancre = null; bubble?.remove(); bubble = null; clearTimeout(bubbleTimer); mood('neutre'); marquerNid();
      if (rendre) document.querySelector(a)?.focus({ preventScroll: true });
      if (was && !play && !dragging) setTimeout(() => { if (!bubble) { visiting = 0; if (!isFree(x, y, size())) rest(); } }, 400);
    }
    function speak(t) { if (!voice || !('speechSynthesis' in window)) return; try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, '').slice(0, 400)); u.lang = 'fr-FR'; mood('parle'); u.onend = () => mood('neutre'); speechSynthesis.speak(u); } catch { /* */ } }
    function show(kids, level, ms, isChat) {
      closeBubble();
      bubble = el('div', { class: `bubble ${level || ''}`, role: level === 'grave' ? 'alert' : 'status', 'aria-live': 'polite' }, el('button', { class: 'x', 'aria-label': 'Fermer', onclick: closeBubble }, '×'), ...kids);
      if (isChat) bubble.dataset.chat = '1';
      document.body.append(bubble); placeBubble();
      if (ms) bubbleTimer = setTimeout(closeBubble, ms);
    }
    /** Parle dans une bulle (verte, orange ou rouge) ; à voix haute si la voix est activée (ou si c'est grave). */
    function say(text, level = 'ok', m = 'joie', loud = false) {
      if (bubble?.dataset.chat && level !== 'grave') { const p = bubble.querySelector('p'); if (p) { p.textContent = text; mood(m); if (voice) speak(text); placeBubble(); return; } }
      show([el('p', {}, text)], level, level === 'grave' ? 0 : Math.min(14000, 4000 + text.length * 45)); mood(m);
      if (level === 'grave') { anim('hop'); place(innerWidth / 2 - size() / 2, innerHeight / 2, true); }
      if (voice || (loud && level === 'grave')) speak(text);
    }
    async function ask(text) {
      const p = bubble?.querySelector('p'); if (p) p.textContent = '…'; mood('reflexion');
      try {
        let r = await api('/api/maison/dire', { texte: text });
        if (r.confirm && await confirmBox(r.confirm)) r = await api('/api/maison/dire', { texte: text, confirm: true });
        say(r.text || r.error || '…', r.ok === false ? 'souci' : 'ok', r.mood || (r.ok === false ? 'confus' : 'joie'));
        setTimeout(load, 800);
      } catch (e) { say(e.message, 'souci', 'triste'); }
    }
    function chat(depuis) {
      const input = el('input', { type: 'text', placeholder: 'Dis-moi… (« allume le salon »)', 'aria-label': 'Ta demande à Odin', enterkeyhint: 'send' });
      const quick = [['☀️ Météo', () => ask('météo')], ['🕒 Heure', () => ask('quelle heure')], ['🔔 Alertes', () => news()], ['⚽ Joue avec moi', () => game()], ['🎨 Thème suivant', () => nextTheme()]];
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      show([el('p', {}, `${hello()} ! Que veux-tu ?`), el('div', { class: 'qs' }, ...quick.map(([l, f]) => el('button', { type: 'button', onclick: f }, l))),
        el('form', { onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (t) { input.value = ''; ask(t); } } }, input,
          SR ? el('button', { type: 'button', class: 'btn', 'aria-label': 'Parler au micro', onclick: (e) => { const b = e.currentTarget; if (b._r) { b._r.stop(); return; } try { const r = new SR(), base = input.value.trim() ? `${input.value.trim()} ` : ''; let done = ''; r.lang = 'fr-FR'; r.continuous = true; r.interimResults = true; b._r = r; b.setAttribute('aria-pressed', 'true'); mood('ecoute'); r.onresult = (ev) => { let live = ''; for (let k = ev.resultIndex; k < ev.results.length; k++) { if (ev.results[k].isFinal) done += ev.results[k][0].transcript; else live += ev.results[k][0].transcript; } input.value = `${base}${done}${live}`.replace(/\s+/g, ' ').trimStart(); }; r.onend = () => { b._r = null; b.setAttribute('aria-pressed', 'false'); mood('neutre'); input.focus(); }; r.start(); } catch { toast('Micro indisponible.'); } } }, icon('mic', 18)) : null,
          el('button', { class: 'btn primary', 'aria-label': 'Envoyer' }, icon('send', 18)))], 'ok', 0, true);
      ancre = typeof depuis === 'string' ? depuis : null; marquerNid(); placeBubble();
      mood('ecoute'); setTimeout(() => input.focus({ preventScroll: true }), 50);
    }
    function news() {
      const n = (D?.notices || []).slice(0, 4);
      say(n.length ? n.map((x) => `• ${x.title}`).join('\n') : 'Rien à signaler, tout va bien.', n.some((x) => x.level === 'grave') ? 'grave' : n.some((x) => x.level === 'souci') ? 'souci' : 'ok', n.length ? 'reflexion' : 'joie');
    }
    function nextTheme() { const ks = Object.keys(D?.themes || T), i = ks.indexOf(D?.theme), k = ks[(i + 1) % ks.length]; document.querySelectorAll('.th')[0]; applyTheme(k); if (D) D.theme = k; draw(); if (D?.rights === 'complet') api('/api/maison/theme', { theme: k }).catch(() => 0); else try { localStorage.setItem('odin.maison.theme', k); } catch { /* */ } say(`Thème « ${D?.themes?.[k] || k} ».`, 'ok', 'excite'); }
    // ---------- Jeu de balle : lance la balle, la mascotte court la chercher et te la rapporte ----------
    function game() {
      closeBubble(); if (ball) return;
      ball = el('div', { class: 'ball', role: 'img', 'aria-label': 'Balle : lance-la' }); document.body.append(ball);
      let bx = innerWidth / 2, by = innerHeight / 3, vx = 0, vy = 0, held = null, raf = 0, last = [];
      const put = () => { ball.style.transform = `translate(${bx - 17}px,${by - 17}px)`; };
      put(); play = Date.now(); mood('excite'); say('Lance la balle !', 'ok', 'excite');
      ball.addEventListener('pointerdown', (e) => { held = true; ball.setPointerCapture(e.pointerId); vx = vy = 0; last = [[e.clientX, e.clientY, performance.now()]]; });
      ball.addEventListener('pointermove', (e) => { if (!held) return; bx = e.clientX; by = e.clientY; put(); last.push([e.clientX, e.clientY, performance.now()]); last = last.slice(-5); });
      ball.addEventListener('pointerup', () => { held = false; const a = last[0], b = last[last.length - 1]; if (a && b && b[2] > a[2]) { vx = ((b[0] - a[0]) / (b[2] - a[2])) * 16; vy = ((b[1] - a[1]) / (b[2] - a[2])) * 16; } play = Date.now(); loop(); });
      function loop() {
        cancelAnimationFrame(raf); const t0 = performance.now();
        const step = () => {
          vy += 0.6; bx += vx; by += vy; vx *= 0.99;
          if (bx < 17 || bx > innerWidth - 17) { vx = -vx * 0.7; bx = Math.max(17, Math.min(innerWidth - 17, bx)); }
          if (by > innerHeight - 17) { by = innerHeight - 17; vy = Math.abs(vy) < 2 ? 0 : -vy * 0.6; vx *= 0.88; }
          if (by < 17) { by = 17; vy = -vy * 0.6; }
          put();
          if ((Math.abs(vx) + Math.abs(vy) > 0.8 || by < innerHeight - 18) && performance.now() - t0 < 3500) raf = requestAnimationFrame(step); else fetchBall();
        };
        raf = requestAnimationFrame(step);
      }
      // La mascotte court jusqu'à la balle puis la rapporte au milieu.
      function fetchBall() {
        const s = size(); mood('excite'); place(bx - s / 2, by - s, true);
        setTimeout(() => { anim('hop'); bx = innerWidth / 2; by = innerHeight / 2; place(bx - s / 2, by - s / 2 - 30, true); setTimeout(() => { put(); mood('joie'); say(['Encore !', 'Attrapée !', 'Je l\'ai !', 'Trop facile !'][Math.floor(Math.random() * 4)], 'ok', 'joie'); }, 450); }, 500);
      }
      // Fin du jeu après une minute sans lancer.
      const end = setInterval(() => { if (Date.now() - play > 60_000) { clearInterval(end); cancelAnimationFrame(raf); ball?.remove(); ball = null; play = 0; say('On rejoue quand tu veux !', 'ok', 'joie'); } }, 5000);
    }
    return { say, news, chat, visit, enChat: () => Boolean(bubble?.dataset.chat), depuisNid: () => Boolean(bubble && ancre), fermer: closeBubble, ranger: () => { if (!dragging && !isFree(x, y, size())) rest(true); } };
  })();
  if (window.OdinMascotte) window.OdinMascotte.sayHook = (t, lvl) => pet.say(t, lvl === 'souci' ? 'souci' : 'ok', lvl === 'souci' ? 'inquiet' : 'joie');

  load();
  setInterval(load, 15_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
