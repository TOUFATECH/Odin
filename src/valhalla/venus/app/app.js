// Venus dans Odin, l'interface (lot V1). Les écrans reprennent la structure, les classes et les textes des composants du
// dépôt TOUFATECH/Venus (licence MIT) : web/components/Shell.js (coque), public/js/menu.js (menu, « Plus », « Tout »),
// pages/Home.js (accueil), Browse.js (Films, Séries, Animés, Clips, Ma liste), pages/Details.js (fiche), Palette.js
// (Ctrl+K), Search.js (recherche), Gates.js (« Qui regarde ? »), Settings.js (thème et menu). Seul ajout : « ‹ Odin ».
//
// Les données sont les VRAIES de Vénus dans Odin (bibliothèque déjà scannée, reprise, ma liste) : /venus/api/* et les
// routes /venus/* d'avant. Ce qui n'existe pas encore (affiches, genres, notes, distribution, demandes, téléchargements)
// reste vide, et l'écran le dit : rien n'est inventé. Les textes passent par t() (dictionnaire, toutes les langues) ;
// les dates et les nombres par Intl. Les icônes et les planètes viennent de planetes.js (chargé avant ce fichier).
'use strict';
(() => {
  const W = typeof window !== 'undefined' ? window : globalThis;
  const D = typeof document !== 'undefined' ? document : null;

  // ---------------------------------------------------------------- textes (dictionnaire) et formats (Intl)
  // La clé est le texte français ; une langue ajoute ses traductions ici. Ce qui manque reste en français.
  const TXT = {
    en: {
      'Accueil': 'Home', 'Films': 'Movies', 'Séries': 'TV shows', 'Animés': 'Anime', 'Clips': 'Music videos', 'Ma liste': 'My list',
      'Recherche': 'Search', 'Réglages': 'Settings', 'Plus': 'More', 'Tout': 'All', 'Revenir à Odin': 'Back to Odin',
      'Qui regarde ?': 'Who’s watching?', 'Lecture': 'Play', 'Reprendre': 'Resume', 'Plus d’infos': 'More info',
      'Tout Venus': 'All of Venus', 'Au hasard': 'Shuffle', 'Filtres': 'Filters', 'Bibliothèque': 'Library', 'À venir': 'Upcoming',
      'Nouveau': 'Request', 'Nouveautés': 'New releases', 'Mes envies': 'My wishes', 'Dans Venus': 'In Venus', 'En téléchargement': 'Downloading',
      'Télécharger': 'Download', 'Favori': 'Favourite', 'En favori': 'Favourited', 'Disponible': 'Available', 'Pas disponible': 'Not available',
      'Disponibles': 'Available', 'Pas disponibles': 'Not available', 'Mes favoris': 'My favourites', 'Aujourd’hui': 'Today', 'Hier': 'Yesterday', 'Demain': 'Tomorrow',
      'Ajouter': 'Add', 'Ajouté': 'Added', 'Demander': 'Request', 'Accepter': 'Accept', 'Jeter': 'Discard', 'Annuler': 'Cancel', 'Mettre en pause': 'Pause',
      'Demandes': 'Requests', 'Demandes au nom de chacun': 'Requests on behalf of each person', 'À valider': 'To approve', 'Valider': 'Approve', 'Refuser': 'Decline',
      'Enregistrer': 'Save', 'Tester': 'Test', 'Retirer': 'Remove',
    },
  };
  const LANG = String((D && D.documentElement.lang) || (W.navigator && W.navigator.language) || 'fr');
  const t = (k, v = {}) => { const d = (TXT[LANG.slice(0, 2)] || {})[k] ?? k; return String(d).replace(/\{(\w+)\}/g, (_, x) => (v[x] ?? '')); };
  const plur = (() => { try { return new Intl.PluralRules(LANG); } catch { return { select: (n) => (n === 1 ? 'one' : 'other') }; } })();
  /** « 1 film », « 3 films » : la forme suit les règles de la langue (Intl.PluralRules). */
  const tn = (n, un, plusieurs) => t(plur.select(n) === 'one' ? un : plusieurs, { n: nombre(n) });
  const nombre = (n) => { try { return new Intl.NumberFormat(LANG).format(n); } catch { return String(n); } };
  const date = (ms, o) => { try { return new Intl.DateTimeFormat(LANG, o).format(new Date(ms)); } catch { return new Date(ms).toDateString(); } };
  const duree = (min) => { if (!min) return ''; const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? t('{h} h {m}', { h: nombre(h), m: String(m).padStart(2, '0') }) : t('{m} min', { m: nombre(m) }); };
  const reste = (p) => (p && p.duration ? t('{n} min restantes', { n: nombre(Math.max(1, Math.round((p.duration - p.position) / 60))) }) : '');

  // ---------------------------------------------------------------- menu (public/js/menu.js, recopié ; libellés par t())
  const dayPart = (d = new Date()) => { const hr = d.getHours(); return hr >= 17 || hr < 4 ? 'soir' : 'jour'; };
  const todayLabel = () => (dayPart() === 'soir' ? t('Ce soir') : t('Aujourd’hui'));
  const todayIcon = () => (dayPart() === 'soir' ? 'moon' : 'sun');
  const NAV_ITEMS = [
    { id: 'home', href: '/', label: () => t('Accueil'), icon: 'home' },
    { id: 'movies', href: '/films', label: () => t('Films'), icon: 'film', cat: 'movie' },
    { id: 'shows', href: '/series', label: () => t('Séries'), icon: 'tv', cat: 'show' },
    { id: 'anime', href: '/animes', label: () => t('Animés'), icon: 'spark', cat: 'anime' },
    { id: 'clips', href: '/clips', label: () => t('Clips'), icon: 'clip', cat: 'clip' },
    { id: 'request', href: '/nouveau', label: () => t('Nouveau'), icon: 'download', hint: () => t('Ajouter un film, une série ou un animé (téléchargé par Sirius / Pléiades)'), short: () => t('Demander un titre'), noKids: true },
    { id: 'today', href: '/cesoir', label: todayLabel, icon: todayIcon, hint: () => t('Trois questions, trois idées à regarder'), short: () => t('3 idées pour vous') },
    { id: 'new', href: '/nouveautes', label: () => t('Nouveautés'), icon: 'cal', hint: () => t('Films, séries et animés qui sortent'), short: () => t('Sorties à venir') },
    { id: 'tv', href: '/tv', label: () => t('TV'), icon: 'live', cat: 'channel' },
    { id: 'music', href: '/musique', label: () => t('Musique'), icon: 'note', cat: 'music' },
    { id: 'photos', href: '/photos', label: () => t('Photos'), icon: 'image', cat: 'photo' },
    { id: 'books', href: '/livres', label: () => t('Livres'), icon: 'book', cat: 'book' },
    { id: 'mylist', href: '/liste', label: () => t('Ma liste'), icon: 'list', hint: () => t('Gardé pour plus tard'), short: () => t('Titres gardés') },
    { id: 'collections', href: '/collections', label: () => t('Collections'), icon: 'grid4', hint: () => t('Sagas, collections et listes de lecture'), short: () => t('Sagas et listes') },
    { id: 'search', href: '/recherche', label: () => t('Recherche'), icon: 'search' },
    { id: 'seance', href: '/seance', label: () => t('Séance'), icon: 'people', hint: () => t('Regarder ensemble, chacun sur son écran') },
    { id: 'remote', href: '/telecommande', label: () => t('Télécommande'), icon: 'remote', hint: () => t('Piloter Venus avec votre téléphone') },
    { id: 'stats', href: '/stats', label: () => t('Statistiques'), icon: 'gauge', hint: () => t('Vos heures, genres et séries préférées') },
    { id: 'downloads', href: '/telechargements', label: () => t('Téléchargements'), icon: 'down', hint: () => t('Vos vidéos pour regarder sans réseau') },
    { id: 'dashboard', href: '/dashboard', label: () => t('Tableau de bord'), icon: 'gauge', admin: true, hint: () => t('Lectures en cours, appareils, code de connexion') },
  ];
  const DEFAULT_HIDDEN = ['seance', 'remote', 'dashboard', 'stats', 'downloads'];
  const RAIL_MAX = 6;
  const KIDS_HIDE = new Set(['new', 'request', 'seance', 'remote', 'dashboard', 'stats', 'downloads', 'collections', 'tv']);
  const val = (x) => (typeof x === 'function' ? x() : x);
  const COUNT_WORD = { movie: ['{n} film', '{n} films'], show: ['{n} série', '{n} séries'], anime: ['{n} animé', '{n} animés'], clip: ['{n} clip', '{n} clips'] };
  const SECTION_IDS = ['today', 'movies', 'shows', 'anime', 'tv', 'clips', 'music', 'photos', 'books', 'collections', 'mylist', 'new'];

  // ---------------------------------------------------------------- logique pure (essayée sans navigateur)
  const L = {
    /** Les comptes de chaque catégorie de la bibliothèque (une catégorie vide disparaît du menu, comme dans Venus). */
    comptes(items) { const c = { movie: 0, show: 0, anime: 0, clip: 0, channel: 0, music: 0, photo: 0, book: 0 }; for (const i of items) c[i.category] = (c[i.category] || 0) + 1; return c; },
    /** Le menu : sections montrées (dans l'ordre choisi) et rangées dans « Plus ». */
    menuItems(profile, M, cats) {
      const usable = (it) => (!it.admin || profile.isAdmin) && (!it.cat || (cats[it.cat] || 0) > 0) && !(profile.isKids && KIDS_HIDE.has(it.id));
      const byId = new Map(NAV_ITEMS.map((i) => [i.id, i]));
      const order = [...M.order.filter((id) => byId.has(id)), ...NAV_ITEMS.map((i) => i.id).filter((id) => !M.order.includes(id))];
      const list = order.map((id) => byId.get(id)).filter(usable);
      return { shown: list.filter((i) => !M.hidden.includes(i.id)), more: list.filter((i) => M.hidden.includes(i.id)) };
    },
    /** La coque : 6 sections dans le rail, le reste dans « Plus » ; 4 onglets sur le téléphone, puis « Tout ». */
    coque(profile, M, cats) {
      const { shown, more } = L.menuItems(profile, M, cats), all = [...shown, ...more];
      const pick = (id) => all.find((it) => it.id === id);
      const firstTwo = shown.filter((it) => !['home', 'today', 'search'].includes(it.id)).slice(0, 2);
      return { rail: shown.slice(0, RAIL_MAX), plus: shown.length > RAIL_MAX || more.length > 0, railMore: [...shown.slice(RAIL_MAX), ...more], tabs: [pick('home'), ...firstTwo, pick('search')].filter(Boolean) };
    },
    sections(profile, cats) {
      const byId = new Map(NAV_ITEMS.map((i) => [i.id, i]));
      return SECTION_IDS.map((id) => byId.get(id)).filter((it) => it && (!it.cat || (cats[it.cat] || 0) > 0) && (!it.admin || profile.isAdmin) && !(profile.isKids && KIDS_HIDE.has(it.id)))
        .map((it) => ({ ...it, label: val(it.label), icon: val(it.icon), sub: it.cat ? (COUNT_WORD[it.cat] ? tn(cats[it.cat], ...COUNT_WORD[it.cat]) : '') : val(it.short) || val(it.hint) || '' }));
    },
    /** Monte ou descend une section du menu (Réglages → Thème et menu). Rend un nouvel ordre. */
    deplacer(order, id, d) { const o = [...order], i = o.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= o.length) return o; [o[i], o[j]] = [o[j], o[i]]; return o; },
    /** Les titres d'une bibliothèque. */
    itemsOf(items, kind) { return kind === 'mylist' ? items.filter((x) => x.inList) : items.filter((x) => x.category === kind); },
    /** Filtre et trie (Browse.js) : statut, années, qualité ; tris par ajout, titre, sortie, lecture, durée, hasard. */
    shown(items, f, graine = 0) {
      const QUAL = { '4K': (i) => i.res === '4K', '1080p': (i) => i.res === '1080p', SD: (i) => i.res === 'SD' || i.res === '720p' };
      const list = items.filter((i) => (f.status === 'all' || i.status === f.status) && (!f.decades.length || (i.year && f.decades.includes(Math.floor(i.year / 10) * 10))) && (!f.quality.length || f.quality.some((q) => QUAL[q] && QUAL[q](i))));
      const h = (s) => { let x = 2166136261; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
      const cmp = { added: (a, b) => b.added - a.added, az: (a, b) => a.title.localeCompare(b.title, LANG), released: (a, b) => (b.year || 0) - (a.year || 0), played: (a, b) => (b.played || 0) - (a.played || 0), runtime: (a, b) => (a.runtime || 0) - (b.runtime || 0), random: (a, b) => h(`${a.id}${graine}`) - h(`${b.id}${graine}`), mine: null }[f.sort];
      if (cmp) list.sort(cmp);
      if (f.desc && f.sort !== 'random') list.reverse();
      return list;
    },
    /** Les résultats de Ctrl+K : pages du menu, titres, épisodes à reprendre, réglages, changer de profil. */
    palette(q, items, profile, M, cats) {
      const n = norm(q), out = [];
      const { shown, more } = L.menuItems(profile, M, cats);
      const statics = [...shown, ...more].filter((it) => it.href).map((it) => ({ kind: 'page', label: val(it.label), sub: val(it.hint) || '', icon: val(it.icon), to: it.href }));
      // Les mêmes réglages que la page : aucun pour un enfant (le rail n'en montre pas), Médiathèques pour le propriétaire seul.
      if (!profile.isKids) statics.push({ kind: 'setting', label: t('Réglages : Thème et menu'), icon: 'gear', to: '/reglages', tab: 'affichage' });
      if (!profile.isKids && profile.isAdmin) statics.push({ kind: 'setting', label: t('Réglages : Médiathèques'), icon: 'gear', to: '/reglages', tab: 'medias' });
      statics.push({ kind: 'action', label: t('Changer de profil'), icon: 'people', act: 'profiles' });
      if (!n) return statics.slice(0, 8);
      for (const i of items) if (n.split(' ').every((w) => norm(i.title).includes(w))) out.push({ kind: i.category, label: i.title, sub: [i.year, i.category === 'show' ? t('Série') : i.category === 'anime' ? t('Animé') : i.category === 'clip' ? t('Clip') : t('Film')].filter(Boolean).join(' · '), poster: i.poster, icon: i.category === 'movie' ? 'film' : i.category === 'clip' ? 'clip' : 'tv', to: `/titre/${encodeURIComponent(i.id)}` });
      for (const x of statics) if (norm(x.label).includes(n) || norm(x.sub || '').includes(n)) out.push(x);
      const top = out.slice(0, 12);
      top.push({ kind: 'action', label: t('Rechercher « {q} » partout', { q: q.trim() }), icon: 'search', to: '/recherche', q: q.trim() });
      return top;
    },
    /** L'adresse dans la page (« #/titre/… ») : le chemin et ses paramètres. */
    route(hash) { const h = String(hash || '').replace(/^#/, ''); const [p, q = ''] = h.split('?'); return { path: p || '/', q: new URLSearchParams(q) }; },
    /** Les numéros manquants d'une saison et ses épisodes, mêlés dans l'ordre (Details.js). */
    episodesSaison(s) { const l = [...s.episodes.map((e) => ({ ...e })), ...s.manquants.map((n) => ({ episode: n, missing: true }))]; return l.sort((a, b) => a.episode - b.episode); },
    /** Ce que le lecteur reçoit pour une cible, d'après le détail de son œuvre (/venus/oeuvre/…). Pur. */
    elementLecteur(detail, cibleId) {
      const o = detail && detail.oeuvre; if (!o) return null;
      if (o.id === cibleId) return { id: o.id, titre: o.titre || '', type: 'film', duree_s: o.duree, reprise_s: (detail.reprise && detail.reprise.position_s) || 0, sousTitres: o.sous_titres };
      const e = (detail.episodes || []).find((x) => x.id === cibleId); if (!e) return null;
      const sxe = `S${String(e.saison).padStart(2, '0')}E${String(e.episode ?? 0).padStart(2, '0')}`;
      return { id: e.id, titre: `${o.titre || ''} · ${sxe}`, type: 'episode', duree_s: e.duree, reprise_s: e.reprise_s || 0, sousTitres: e.sous_titres, saison: e.saison, episode: e.episode };
    },
  };
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  // ---------------------------------------------------------------- demandes et téléchargements (logique pure, lots V4-V6)
  // Chaque clic passe par une action de Vénus (/api/valhalla/act, module freyja). Un clic qui télécharge envoie
  // `confirm: true` : le clic EST la confirmation (l'IA et la parole, elles, demandent toujours).
  const GENRE = { movie: 'film', show: 'série', anime: 'animé' };
  const ETAT_FILE = { attente: 'En attente', en_cours: 'En cours', pause: 'En pause', annule: 'Annulé', termine: 'Importé', echec: 'Échec', a_part: 'Mis à part (antivirus)' };
  const pad2 = (n) => String(n).padStart(2, '0');
  Object.assign(L, {
    /** Ce que ⬇ (« Télécharger », « Demander », « Ajouter ») envoie pour un titre : toute la chaîne, confirmée par le clic. */
    obtenir(e) {
      const film = e.kind === 'movie' || e.type === 'movie';
      const input = { titre: String(e.title || '').slice(0, 200), genre: film ? 'film' : GENRE[e.kind] || 'série' };
      const an = e.year || (e.date ? Number(String(e.date).slice(0, 4)) : 0);
      if (film) { if (an) input.annee = String(an); } else { input.saisons = String(e.season != null ? e.season : 1); if (e.episode != null) input.episode = String(e.episode); }
      return { module: 'freyja', action: 'hnoss_obtenir', input, confirm: true };
    },
    /** Ce que ♡ envoie : ajouter à « Mes envies » (la chaîne part, confirmée par le clic) ou retirer. */
    envie(e, on) {
      if (on) return { module: 'freyja', action: 'hnoss_envie', input: { titre: String(e.title || '').slice(0, 200), cle: e.key, retirer: true } };
      return { module: 'freyja', action: 'hnoss_envie', input: { ...L.obtenir(e).input, cle: e.key }, confirm: true };
    },
    /** « À venir » : le filtre (tout, disponibles, pas disponibles, mes favoris), puis les sorties groupées par jour. */
    jours(entries, filtre, favs) {
      const keep = (e) => (filtre === 'nas' ? !!e.nas : filtre === 'out' ? !e.nas : filtre === 'fav' ? favs.has(e.key) : true);
      const g = new Map(); for (const e of (entries || []).filter(keep)) { if (!g.has(e.date)) g.set(e.date, []); g.get(e.date).push(e); }
      return [...g.keys()].sort().map((day) => ({ day, items: g.get(day) }));
    },
    /** La file de Comète est relue toutes les 2 s tant qu'un téléchargement est en cours ou attend. */
    fileVivante(l) { return (l || []).some((x) => x.etat === 'en_cours' || x.etat === 'attente'); },
    /** Les membres « libres » après un choix dans « Demandes au nom de chacun ». */
    libres(l, login, libre) { const s = new Set(l || []); if (libre) s.add(login); else s.delete(login); return [...s].sort(); },
    /** Une ligne de la file : le titre, l'épisode, le pourcentage, l'état et le temps restant (mm:ss). */
    ligneFile(x) {
      const c = x.cible || {}, pct = x.total ? Math.min(100, Math.round((x.fait / x.total) * 100)) : x.etat === 'termine' ? 100 : 0;
      const sec = x.etat === 'en_cours' && x.vitesse > 0 && x.total ? Math.max(0, Math.round((x.total - x.fait) / x.vitesse)) : 0;
      const reste = sec ? (sec >= 3600 ? `${Math.floor(sec / 3600)}:${pad2(Math.floor((sec % 3600) / 60))}:${pad2(sec % 60)}` : `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`) : '';
      return { titre: c.titre || x.titre || '', ep: c.genre === 'episode' && c.saison != null ? `S${c.saison}:É${c.episode}` : '', pct, etat: ETAT_FILE[x.etat] || String(x.etat || ''), reste };
    },
  });
  W.VenusApp = { L, t, TXT, NAV_ITEMS, DEFAULT_HIDDEN, RAIL_MAX };
  if (!D || !D.getElementById || !D.getElementById('app')) return; // chargé pour les essais : rien à dessiner

  // ---------------------------------------------------------------- état
  const LAYOUT_TXT = { rail: 'Menu d’icônes à gauche', side: 'Grand menu à gauche', dock: 'Barre flottante en bas', stream: 'Menu en haut, style streaming', tv: 'Grands onglets, pour la télé', glass: 'Surfaces givrées', lagon: 'Barre en haut et bloc « Ce soir »' };
  for (const k of Object.keys(LAYOUTS)) LAYOUTS[k] = t(LAYOUT_TXT[k] || LAYOUTS[k]);
  T.auto = 'off'; // comme Venus d'origine : « Toujours Venus » tant que rien n'est choisi
  const M = { order: NAV_ITEMS.map((i) => i.id), hidden: [...DEFAULT_HIDDEN] };
  const S = { profile: { id: 'moi', name: '', isAdmin: true, avatar: 0 }, profils: [], items: [], cats: L.comptes([]), loaded: false, error: '', heroIdx: 0, lib: {}, libView: {}, season: null, epFilter: 'all', setTab: 'affichage', searchQ: '', searchKind: 'all', fiche: {}, dossiers: null,
    // demandes et téléchargements : « À venir » par genre, favoris (♡), titres lancés, en cours d'envoi, file de Comète…
    up: {}, upFilter: {}, upEarlier: {}, favs: new Set(), pris: new Set(), busy: new Set(), reg: [], envies: null, file: null, fileT: 0, demandes: null,
    req: { q: '', kind: 'movie' }, newKind: 'movie', nouv: {}, newCur: {}, dem: null };
  const AVATAR_HUES = [12, 38, 145, 190, 215, 265, 300, 340];
  const api = async (chemin, corps) => {
    const r = await fetch(chemin, corps === undefined ? { headers: { 'x-odin': '1' } } : { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(corps) });
    if (r.status === 401) { location.href = '/'; throw new Error('401'); }
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  };
  // Le profil choisi est gardé par Odin dans un témoin (chemin /venus, un an) : le lecteur et le flux le reçoivent aussi.
  const choisirProfil = (id) => { D.cookie = `venus_profil=${encodeURIComponent(id)}; path=/venus; max-age=31536000; SameSite=Strict`; };

  // ---------------------------------------------------------------- briques (Icon.js, Card.js, Row.js)
  const Avatar = (p, cls = '') => `<div class="avatar ${cls}" style="--hue:${AVATAR_HUES[(p.avatar || 0) % AVATAR_HUES.length]}">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</div>`;
  const Brand = (cls = '') => `<span class="brand ${cls}">${planetMarkup()}<span class="brand-name">${esc(brandName())}</span></span>`;
  // Pas d'affiche encore (lot des affiches à venir) : le carré de couleur de Venus, avec le titre écrit dedans.
  const Pic = (i, wide = false) => (i.poster ? `<img src="${esc(i.poster)}" alt="" class="fade ok" loading="lazy" decoding="async">` : `<div class="ph" style="--h:${hueOf(i.title)}">${esc(i.title)}</div>`);
  const href = (path) => `#${path}`;
  const go = (path) => { location.hash = `#${path}`; };
  const titrePath = (i) => `/titre/${encodeURIComponent(i.id)}`;
  const lirePath = (id) => `/lecture/${encodeURIComponent(id)}`;
  const kindLabel = (i) => (i.category === 'anime' ? t('Animé') : i.category === 'show' ? t('Série') : i.category === 'clip' ? t('Clip') : t('Film'));
  function Card(item, { poster = false } = {}) {
    const p = item.progress, isClip = item.type === 'clip', isShow = item.type === 'show';
    const resume = !!(p && !p.watched && p.position > 0) || (isShow && item.status === 'progress' && item.play);
    let sub;
    if (isShow && item.status === 'progress' && item.play) sub = t('À suivre : saison {s}, épisode {e}', { s: nombre(item.play.season), e: nombre(item.play.episode) });
    else if (resume) sub = reste(p);
    else if (isClip) sub = t('Clip');
    else sub = [item.year, isShow ? kindLabel(item) : ''].filter(Boolean).join(', ');
    const pct = p && p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
    const seen = item.status === 'seen';
    const target = isClip || resume ? lirePath(item.play ? item.play.id : item.id) : titrePath(item);
    return `<a class="card f${poster ? ' poster' : ''}" href="${href(target)}" aria-label="${esc([item.title, sub, seen ? t('déjà vu') : null].filter(Boolean).join(', '))}">
    <div class="shot">${Pic(item, !poster)}${pct > 0 && !(p && p.watched) ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}${seen ? `<span class="check" title="${esc(t('Déjà vu'))}">${I('check')}</span>` : ''}${isShow && item.episodes ? `<span class="ep-pill" title="${esc(tn(item.episodes, '{n} épisode', '{n} épisodes'))}">${item.status === 'progress' ? `${nombre(item.episodes - item.unseen)}/${nombre(item.episodes)}` : t('{n} ép.', { n: nombre(item.episodes) })}</span>` : ''}</div>
    <div class="cap"><b>${esc(item.title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div></a>`;
  }
  const ScrollRow = (inner, cls = 'row-scroll') => `<div class="row-body"><button type="button" class="row-arrow prev off" tabindex="-1" aria-label="${esc(t('Précédent'))}" data-act="rowby" data-v="-1">${I('back')}</button><div class="${cls}">${inner}</div><button type="button" class="row-arrow next" tabindex="-1" aria-label="${esc(t('Suivant'))}" data-act="rowby" data-v="1">${I('fwd')}</button></div>`;
  function Row(r) {
    if (!r.items.length) return '';
    const posters = r.poster !== undefined ? r.poster : r.items.filter((it) => it.type !== 'clip').length >= Math.ceil(r.items.length * 0.6);
    return `<section class="row" aria-label="${esc(r.title)}"><div class="row-head"><h2>${esc(r.title)}</h2>${r.more ? `<div class="row-tools"><a class="row-link f" href="${href(r.more)}">${esc(t('Tout voir'))}</a></div>` : ''}</div>
    ${ScrollRow(r.items.map((it) => Card(it, { poster: posters })).join(''), `row-scroll${posters ? ' posters' : ''}`)}</section>`;
  }
  const Empty = (txt, extra = '') => `<div class="grid-empty"><p>${esc(txt)}</p>${extra}</div>`;

  // ---------------------------------------------------------------- coque (Shell.js) + « ‹ Odin »
  const ODIN_MARK = '<svg class="odin-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 6 8l6 6 6-6zM12 14l-5 5 5 3 5-3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  const isActive = (h, path) => (h === '/' ? path === '/' : path.startsWith(h));
  const NavLink = (h, label, icon, path, cls = '') => { const on = isActive(h, path); return `<a href="${href(h)}" class="${`${cls} f${on ? ' active' : ''}`.trim()}"${on ? ' aria-current="page"' : ''} aria-label="${esc(label)}">${icon ? I(icon) : ''}<span>${esc(label)}</span></a>`; };
  const ItemLink = (it, path, cls = '') => NavLink(it.href, val(it.label), val(it.icon), path, cls);
  function Shell(path, body) {
    const p = S.profile, layout = layoutOf(currentPlanet()), c = L.coque(p, M, S.cats);
    return `<nav class="rail" aria-label="${esc(t('Navigation principale'))}">
    <button class="rail-item f odin-back" data-act="odin" aria-label="${esc(t('Revenir à Odin'))}" title="${esc(t('Revenir à Odin'))}">${ODIN_MARK}<span>${esc(t('‹ Odin'))}</span></button>
    <a href="${href('/')}" class="home-link f${path === '/' ? ' active' : ''}" aria-label="${esc(t('Venus, accueil'))}">${planetMarkup()}${layout === 'lagon' ? '<span class="rail-brand">venus</span>' : ''}</a>
    ${layout === 'lagon' ? `<button class="rail-search f" aria-label="${esc(t('Rechercher partout (Ctrl+K)'))}" data-act="palette">${I('search')}<span>${esc(t('Titre, année…'))}</span><kbd>Ctrl K</kbd></button>` : ''}
    <div class="rail-scroll">${c.rail.map((it) => ItemLink(it, path)).join('')}${c.plus ? `<button class="rail-item f" aria-label="${esc(t('Plus'))}" data-more="1" data-act="all">${I('more')}<span>${esc(t('Plus'))}</span></button>` : ''}</div>
    ${p.isKids ? '' : NavLink('/reglages', t('Réglages'), 'gear', path)}
    <button class="rail-item f" aria-label="${esc(t('Changer de profil ({n})', { n: p.name }))}" data-act="profiles">${Avatar(p, 'sm')}<span>${esc(p.name)}</span></button>
  </nav>
  <header class="mobile-top">
    <button class="odin-back f" data-act="odin" aria-label="${esc(t('Revenir à Odin'))}">${I('back')}<span>Odin</span></button>
    <a href="${href('/')}" class="f" aria-label="${esc(t('Accueil'))}">${Brand()}</a>
    <div class="top-actions">
      <button class="icon-btn f" aria-label="${esc(t('Rechercher partout (Ctrl+K)'))}" title="${esc(t('Rechercher partout (Ctrl+K)'))}" data-act="palette">${I('search')}</button>
      ${p.isKids ? '' : `<a href="${href('/reglages')}" class="icon-btn f" aria-label="${esc(t('Réglages'))}">${I('gear')}</a>`}
      <button class="icon-btn f" aria-label="${esc(t('Changer de profil ({n})', { n: p.name }))}" data-act="profiles">${Avatar(p, 'sm')}</button>
    </div>
  </header>
  ${body}
  ${PLANETS[currentPlanet()].waves ? `<div class="waves" aria-hidden="true">${[1, 2, 3].map((n) => `<svg class="wave w${n}" viewBox="0 0 1440 100" preserveAspectRatio="none"><path d="M0 40c120-30 240-30 360 0s240 30 360 0 240-30 360 0 240 30 360 0v60H0z"/></svg>`).join('')}</div>` : ''}
  <nav class="tabbar" aria-label="${esc(t('Onglets'))}">${c.tabs.map((it) => ItemLink(it, path)).join('')}<button class="f tab-more" aria-label="${esc(t('Toutes les sections'))}" data-more="1" data-act="all">${I('apps')}<span>${esc(t('Tout'))}</span></button></nav>`;
  }

  // ---------------------------------------------------------------- pages
  const V = {};
  const PageLoading = () => '<main class="with-nav"><div class="page" aria-busy="true"><i class="sk" style="width:220px;height:48px"></i></div></main>';
  const libVide = () => Empty(t('Rien ici pour l’instant. Déclarez un dossier de films ou de séries et lancez un scan : vos titres apparaissent ici.'), `<button class="btn btn-ghost btn-small f" data-act="classique">${I('folder')}${esc(t('Médiathèques et écrans'))}</button>`);

  // Accueil (pages/Home.js)
  V.home = () => {
    const all = S.items;
    if (!all.length) return `<main class="with-nav home page-in"><div class="page"><h1 class="sr-only">${esc(t('Accueil'))}</h1>${libVide()}</div></main>`;
    const cont = all.filter((x) => x.status === 'progress').sort((a, b) => b.played - a.played);
    const recent = [...all].sort((a, b) => b.added - a.added);
    const heroes = (cont.length ? cont : recent).slice(0, 6), item = heroes[S.heroIdx % heroes.length];
    const resume = item.status === 'progress';
    const pct = item.progress && item.progress.duration && !item.progress.watched ? (item.progress.position / item.progress.duration) * 100 : 0;
    const meta = `<div class="meta">${item.year ? `<span>${esc(String(item.year))}</span>` : ''}${item.type === 'movie' ? (item.runtime ? `<span>${esc(duree(item.runtime))}</span>` : '') : `<span>${esc(kindLabel(item))}</span>`}${item.res ? `<span>${esc(item.res)}</span>` : ''}</div>`;
    const play = item.play ? item.play.id : item.id;
    const body = resume
      ? `<div class="hero-body resume swap"><div class="hero-kicker">${I('restart')}${esc(t('Reprendre là où vous en étiez'))}</div><h1 class="hero-title">${esc(item.title)}</h1>${pct ? `<div class="hero-progress"><div class="bar"><i style="width:${pct}%"></i></div><span>${esc(reste(item.progress))}</span></div>` : ''}<div class="actions"><a class="btn btn-play f" href="${href(lirePath(play))}">${I('play')}${esc(t('Reprendre'))}</a><a class="btn btn-ghost f" aria-label="${esc(t('Plus d’infos'))}" href="${href(titrePath(item))}">${I('info')}<span class="lbl">${esc(t('Plus d’infos'))}</span></a></div></div>`
      : `<div class="hero-body swap"><div class="hero-kicker">${I('spark')}${esc(t('Ajouté récemment'))}</div><h1 class="hero-title">${esc(item.title)}</h1>${meta}<div class="actions"><a class="btn btn-play f" href="${href(lirePath(play))}">${I('play')}${esc(t('Lecture'))}</a><a class="btn btn-ghost f" aria-label="${esc(t('Plus d’infos'))}" href="${href(titrePath(item))}">${I('info')}<span class="lbl">${esc(t('Plus d’infos'))}</span></a></div></div>`;
    const hero = `<section class="hero posters"><div class="hero-bg">${item.poster ? `<img src="${esc(item.poster)}" alt="" class="on" decoding="async">` : `<div class="ph on" style="--h:${hueOf(item.title)}"></div>`}</div>${body}
    ${heroes.length > 1 ? `<button type="button" class="hero-arrow prev" tabindex="-1" aria-label="${esc(t('Titre précédent'))}" data-act="hero" data-v="-1">${I('back')}</button><button type="button" class="hero-arrow next" tabindex="-1" aria-label="${esc(t('Titre suivant'))}" data-act="hero" data-v="1">${I('fwd')}</button>
    <div class="hero-dots" role="tablist" aria-label="${esc(t('À la une'))}">${heroes.map((it, i) => `<button type="button" role="tab" tabindex="-1" aria-label="${esc(it.title)}" aria-selected="${i === S.heroIdx % heroes.length}" class="${i === S.heroIdx % heroes.length ? 'on' : ''}" data-act="heroto" data-v="${i}"><i></i></button>`).join('')}</div>` : ''}</section>`;
    const secs = L.sections(S.profile, S.cats);
    const list = ['today', 'new', 'mylist', 'collections', 'tv', 'clips'].map((id) => secs.find((x) => x.id === id)).filter(Boolean).slice(0, 3);
    const strip = `<nav class="home-sections" aria-label="${esc(t('Sections'))}"><div class="hs-track">${list.map((it) => `<a class="hs-tile f hs-${it.id}" href="${href(it.href)}"><span class="hs-ic">${I(it.icon)}</span><span class="hs-txt"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></a>`).join('')}<button class="hs-tile hs-all f" data-act="all"><span class="hs-ic">${I('apps')}</span><span class="hs-txt"><b>${esc(t('Tout'))}</b><small>${esc(t('Toutes les sections'))}</small></span></button></div></nav>`;
    const rows = [
      { title: t('Reprendre'), items: cont, poster: false },
      { title: t('Ajoutés récemment'), items: recent.slice(0, 12) },
      { title: t('Ma liste'), items: all.filter((x) => x.inList), more: '/liste' },
      { title: t('Films'), items: L.itemsOf(all, 'movie'), more: '/films' }, { title: t('Séries'), items: L.itemsOf(all, 'show'), more: '/series' },
      { title: t('Animés'), items: L.itemsOf(all, 'anime'), more: '/animes' }, { title: t('Clips'), items: L.itemsOf(all, 'clip'), more: '/clips' },
    ];
    return `<main class="with-nav home page-in">${hero}${strip}<div class="rows">${rows.map(Row).join('')}</div></main>`;
  };

  // Films, Séries, Animés, Clips, Ma liste (Browse.js)
  const TITLES = { movie: 'Films', show: 'Séries', anime: 'Animés', clip: 'Clips', mylist: 'Ma liste' };
  const PATHS = { movie: '/films', show: '/series', anime: '/animes', clip: '/clips', mylist: '/liste' };
  // Les tris et filtres dont la bibliothèque a la donnée (genres, notes, popularité et âge arrivent avec les fiches).
  const SORTS = [['added', 'Date d’ajout', ['Plus récents', 'Plus anciens']], ['az', 'Titre', ['A → Z', 'Z → A']], ['released', 'Date de sortie', ['Plus récents', 'Plus anciens']], ['played', 'Date de lecture', ['Vus récemment', 'Vus il y a longtemps']], ['runtime', 'Durée', ['Plus courts', 'Plus longs']], ['random', 'Aléatoire', ['Nouveau tirage', 'Nouveau tirage']]];
  const STATUS = [['all', 'Tous'], ['unseen', 'Non vus'], ['progress', 'En cours'], ['seen', 'Vus']];
  const QUALITY = [['4K', '4K', (i) => i.res === '4K'], ['1080p', 'Full HD', (i) => i.res === '1080p'], ['SD', 'Basse définition', (i) => i.res === 'SD' || i.res === '720p']];
  const VIEWS = [['poster', 'Affiches', 'grid4'], ['wide', 'Vignettes', 'film'], ['list', 'Liste', 'rows']];
  const fOf = (kind) => (S.lib[kind] = S.lib[kind] || { sort: kind === 'mylist' ? 'mine' : 'added', desc: false, status: 'all', decades: [], quality: [], graine: 0 });
  const shownOf = (kind) => { const f = fOf(kind); return L.shown(L.itemsOf(S.items, kind), f, f.graine); };
  function ListRow(i) {
    const p = i.progress, pct = p && p.duration && !p.watched ? Math.min(100, (p.position / p.duration) * 100) : 0;
    return `<div class="lib-row"><a class="lr-main f" href="${href(i.type === 'clip' ? lirePath(i.id) : titrePath(i))}"><div class="lr-pic">${Pic(i)}</div><div class="lr-text"><b>${esc(i.title)}</b><span class="lr-meta">${esc([i.year, i.type === 'show' ? tn(i.episodes || 0, '{n} épisode', '{n} épisodes') : duree(i.runtime)].filter(Boolean).join(' · '))}${i.res === '4K' ? '<span class="badge">4K</span>' : ''}</span>${pct ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div><span></span>${i.status === 'seen' ? `<span class="lr-seen" title="${esc(t('Vu'))}">${I('check')}</span>` : '<span></span>'}</a><a class="btn btn-ghost btn-icon f lr-play" aria-label="${esc(t('Lire {t}', { t: i.title }))}" href="${href(lirePath(i.play ? i.play.id : i.id))}">${I('play')}</a></div>`;
  }
  V.browse = (kind, vue) => {
    const tab = (on, label, path) => `<a class="vt f${on ? ' on' : ''}" role="tab" aria-selected="${on}" href="${href(path)}">${esc(label)}</a>`;
    const upcomingTab = ['show', 'anime', 'movie'].includes(kind) && vue === 'avenir';
    const wishTab = kind === 'mylist' && vue === 'envies';
    const tabs = ['show', 'anime', 'movie'].includes(kind) ? `<div class="view-tabs" role="tablist">${tab(!upcomingTab, t('Bibliothèque'), PATHS[kind])}${tab(upcomingTab, t('À venir'), `${PATHS[kind]}?vue=avenir`)}</div>`
      : kind === 'mylist' ? `<div class="view-tabs" role="tablist">${tab(!wishTab, t('Dans Venus'), PATHS.mylist)}${tab(wishTab, t('Mes envies'), `${PATHS.mylist}?vue=envies`)}</div>` : '';
    if (upcomingTab || wishTab) return `<main class="with-nav page-in">${V.attente(kind, tabs, wishTab)}</main>`;
    const isClip = kind === 'clip', f = fOf(kind), items = L.itemsOf(S.items, kind), shown = shownOf(kind);
    const view = S.libView[kind] || (isClip ? 'wide' : 'poster');
    const s = f.sort === 'mine' ? null : SORTS.find((x) => x[0] === f.sort);
    const filtersOn = f.decades.length + f.quality.length;
    const tags = [...f.decades.map((d) => ['decades', d, t('Années {d}', { d: String(d).slice(2) })]), ...f.quality.map((q) => ['quality', q, t(QUALITY.find((x) => x[0] === q)[1])])]
      .map(([k, v, l]) => `<button class="af f" aria-label="${esc(t('Retirer le filtre {f}', { f: l }))}" data-act="unfilter" data-k="${k}" data-v="${esc(v)}" data-kind="${kind}">${esc(l)}${I('close')}</button>`);
    if (tags.length > 1) tags.push(`<button class="linkish f" data-act="resetf" data-kind="${kind}">${esc(t('Tout effacer'))}</button>`);
    const word = isClip ? ['{n} clip', '{n} clips'] : ['{n} titre', '{n} titres'];
    const grid = shown.length ? shown.map((i) => (view === 'list' ? ListRow(i) : Card(i, { poster: view === 'poster' && !isClip }))).join('')
      : !items.length ? (kind === 'mylist' ? Empty(t('Votre liste est vide. Ajoutez des titres avec le bouton + sur leur fiche.')) : kind === 'anime' || kind === 'clip' ? Empty(t('Aucun titre rangé ici pour l’instant : le rangement des animés et des clips arrive avec Pléiades et Sirius.')) : libVide())
        : Empty(f.status === 'unseen' && !filtersOn ? t('Vous avez tout vu ici. Bravo.') : t('Aucun titre ne correspond à ces filtres.'), `<button class="btn btn-ghost btn-small f" data-act="resetall" data-kind="${kind}">${esc(t('Tout afficher'))}</button>`);
    const count = shown.length !== items.length ? t('{a} sur {b}', { a: nombre(shown.length), b: tn(items.length, ...word) }) : tn(items.length, ...word);
    return `<main class="with-nav page-in"><div class="page"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(t(TITLES[kind]))}</h1><p class="count" aria-live="polite">${esc(count)}</p></div>
    ${tabs || (isClip && items.length ? `<div class="actions play-all"><a class="btn btn-play btn-small f" href="${href(lirePath(shown[0] ? shown[0].id : items[0].id))}">${I('play')}${esc(t('Tout lire'))}</a></div>` : '')}</div>
    <div class="toolbar"><div class="seg" role="group" aria-label="${esc(t('Filtrer par visionnage'))}">${STATUS.map(([id, l]) => `<button class="seg-b f${f.status === id ? ' on' : ''}" aria-pressed="${f.status === id}" data-act="status" data-kind="${kind}" data-v="${id}">${esc(t(l))}</button>`).join('')}</div>
    <div class="tools"><button class="tool f" aria-haspopup="true" aria-expanded="false" aria-label="${esc(s ? t('Trier : {a}, {b}', { a: t(s[1]), b: t(s[2][f.desc ? 1 : 0]) }) : t('Trier : ordre de la liste'))}" data-act="sortmenu" data-kind="${kind}">${I('sort')}<span class="lbl">${esc(s ? t(s[1]) : t('Ordre de la liste'))}</span>${f.desc && f.sort !== 'random' ? '<small>↑</small>' : ''}</button>
    <button class="tool f${filtersOn ? ' on' : ''}" aria-haspopup="true" aria-expanded="false" aria-label="${esc(filtersOn ? t('Filtres : {n} actifs', { n: nombre(filtersOn) }) : t('Filtres'))}" data-act="filtermenu" data-kind="${kind}">${I('filter')}<span class="lbl">${esc(t('Filtres'))}</span>${filtersOn ? `<b class="tool-n">${nombre(filtersOn)}</b>` : ''}</button>
    <div class="seg icons" role="group" aria-label="${esc(t('Affichage'))}">${VIEWS.filter(([id]) => !isClip || id !== 'poster').map(([id, l, ic]) => `<button class="seg-b f${view === id ? ' on' : ''}" title="${esc(t(l))}" aria-label="${esc(t('Affichage : {v}', { v: t(l) }))}" aria-pressed="${view === id}" data-act="view" data-kind="${kind}" data-v="${id}">${I(ic)}</button>`).join('')}</div>
    <button class="tool f" title="${esc(t('Ouvrir un titre au hasard parmi ceux affichés'))}" aria-label="${esc(t('Au hasard : ouvrir un titre parmi ceux affichés'))}" data-act="random" data-kind="${kind}">${I('shuffle')}<span class="lbl">${esc(t('Au hasard'))}</span></button></div></div>
    <div class="active-filters"${tags.length ? '' : ' hidden'}>${tags.join('')}</div>
    <div class="grid view-${view}${view === 'wide' || (isClip && view !== 'list') ? ' grid-wide' : ''}">${grid}</div></div></main>`;
  };
  // « À venir » et « Mes envies » (Upcoming.js) : voir plus bas, V.upcoming et V.wishes.
  V.attente = (kind, tabs, envies) => (envies ? V.wishes(tabs) : V.upcoming(kind, tabs));

  // Fiche (pages/Details.js)
  V.details = (id) => {
    const f = S.fiche[id];
    if (!f) { chargerFiche(id); return PageLoading(); }
    if (f.erreur) return `<main class="with-nav page-in"><div class="page">${Empty(t('Ce titre n’est pas (ou plus) dans la bibliothèque.'), `<a class="btn btn-ghost btn-small f" href="${href('/')}">${esc(t('Accueil'))}</a>`)}</div></main>`;
    const d = S.items.find((x) => x.id === id) || f.titre, isShow = d.type === 'show', isClip = d.type === 'clip';
    const lib = PATHS[d.category] || '/films';
    const seen = d.status === 'seen';
    const p = d.progress, endPos = p && !p.watched ? p.position : 0;
    const total = (d.runtime || 0) * 60;
    const ends = total ? date(Date.now() + (total - endPos) * 1000, { hour: '2-digit', minute: '2-digit' }) : '';
    const next = d.play || { id: d.id, position: 0 };
    const label = isShow ? (d.status === 'progress' ? t('Reprendre S{s}:É{e}', { s: nombre(next.season), e: nombre(next.episode) }) : t('Lecture')) : endPos ? t('Reprendre') : t('Lecture');
    const nSeasons = d.seasons || 0, nEps = d.episodes || 0;
    let seasonsHtml = '';
    if (isShow && f.saisons && f.saisons.length) {
      const cur = f.saisons.find((s) => s.number === S.season) || f.saisons.find((s) => s.number === next.season) || f.saisons[0];
      const vus = cur.episodes.filter((e) => e.watched).length;
      const eps = L.episodesSaison(cur).filter((e) => S.epFilter === 'all' || (S.epFilter === 'seen' ? e.watched && !e.missing : !e.watched && !e.missing));
      const nu = d.status === 'progress' ? cur.episodes.find((e) => e.id === next.id) || f.saisons.flatMap((s) => s.episodes).find((e) => e.id === next.id) : null;
      seasonsHtml = `${nu ? `<section class="d-section next-up"><h2 class="section-title">${esc(t('Reprendre'))}</h2><div class="nu-card"><a class="nu-shot f" aria-label="${esc(t('Lire S{s}:É{e}', { s: nombre(next.season), e: nombre(next.episode) }))}" href="${href(lirePath(next.id))}"><div class="ph" style="--h:${hueOf(d.title + next.id)}"></div><span class="ep-play">${I('play')}</span>${nu.duration ? `<div class="bar"><i style="width:${Math.min(100, (nu.position / nu.duration) * 100)}%"></i></div>` : ''}</a><div class="nu-text"><b class="nu-link">${esc(t('S{s}:É{e}', { s: nombre(next.season), e: nombre(next.episode) }))}</b><small>${esc([t('Saison {n}', { n: nombre(next.season) }), nu.runtime ? duree(nu.runtime) : '', nu.duration ? reste(nu) : ''].filter(Boolean).join(' · '))}</small></div></div></section>` : ''}
      <section class="d-section" id="episodes"><div class="ep-head"><h2 class="section-title">${esc(f.saisons.length > 1 ? tn(f.saisons.length, '{n} saison', '{n} saisons') : t('Épisodes'))}</h2>${f.saisons.length > 1 ? `<div class="season-arrows"><button class="season-arrow f" aria-label="${esc(t('Saison précédente'))}" data-act="season" data-v="${f.saisons[Math.max(0, f.saisons.indexOf(cur) - 1)].number}">${I('back')}</button><button class="season-arrow f" aria-label="${esc(t('Saison suivante'))}" data-act="season" data-v="${f.saisons[(f.saisons.indexOf(cur) + 1) % f.saisons.length].number}">${I('fwd')}</button></div>` : ''}<div class="chips" role="group" aria-label="${esc(t('Filtrer les épisodes'))}">${[['all', 'Tous'], ['unseen', 'Non vus'], ['seen', 'Déjà vus']].map(([k, l]) => `<button class="chip small f${k === S.epFilter ? ' on' : ''}" aria-pressed="${k === S.epFilter}" data-act="epf" data-v="${k}">${esc(t(l))}</button>`).join('')}</div></div>
      ${f.saisons.length > 1 ? `<div class="season-bar" role="tablist" aria-label="${esc(t('Saisons'))}">${f.saisons.map((s) => { const v = s.episodes.filter((e) => e.watched).length, n = s.episodes.length; return `<button class="season-card f${s === cur ? ' on' : ''}${v === n ? ' done' : ''}" role="tab" aria-selected="${s === cur}" data-act="season" data-v="${s.number}"><span class="season-pic"><div class="ph" style="--h:${hueOf(`${d.title}${s.number}`)}"></div><i class="season-prog"><i style="width:${n ? Math.round((v / n) * 100) : 0}%"></i></i></span><b>${esc(t('Saison {n}', { n: nombre(s.number) }))}</b><span>${esc(v === n ? t('Vue en entier') : t('{v} / {n} vus', { v: nombre(v), n: nombre(n) }))}</span></button>`; }).join('')}</div>` : ''}
      <div class="season-head"><div class="sh-info"><b>${esc(t('Saison {n}', { n: nombre(cur.number) }))}</b><span>${esc([tn(cur.episodes.length, '{n} épisode', '{n} épisodes'), cur.manquants.length ? tn(cur.manquants.length, '{n} manquant', '{n} manquants') : '', tn(cur.episodes.length - vus, '{n} à voir', '{n} à voir')].filter(Boolean).join(' · '))}</span></div></div>
      <div class="episodes">${eps.map((e) => (e.missing
        ? `<div class="episode missing" title="${esc(t('Épisode {n} : pas dans vos dossiers', { n: nombre(e.episode) }))}"><div class="thumb"><span class="miss-num">${nombre(e.episode)}</span><span class="miss-tag">${esc(t('Manquant'))}</span></div><div class="ep-line"><b>${esc(t('Épisode {n}', { n: nombre(e.episode) }))}</b>${S.profile.isAdmin ? `<button class="btn btn-ghost btn-small f ep-get" data-act="epgrab" data-v="${esc(d.id)}" data-t="${esc(d.title)}" data-s="${cur.number}" data-e="${e.episode}" aria-label="${esc(t('Faire venir l’épisode {n}', { n: nombre(e.episode) }))}"${S.pris.has(`ep|${d.id}|${cur.number}|${e.episode}`) ? ' disabled' : ''}>${I(S.pris.has(`ep|${d.id}|${cur.number}|${e.episode}`) ? 'check' : 'download')}${esc(t('Faire venir'))}</button>` : ''}</div></div>`
        : `<div class="ep-item"><a class="episode f${e.id === next.id && d.status === 'progress' ? ' is-current' : ''}${e.watched ? ' seen' : ''}" title="${esc(t('Épisode {n}', { n: nombre(e.episode) }))}" aria-label="${esc([t('Épisode {n}', { n: nombre(e.episode) }), e.runtime ? duree(e.runtime) : '', e.watched ? t('vu') : ''].filter(Boolean).join(', '))}" href="${href(lirePath(e.id))}"><div class="thumb"><div class="ph" style="--h:${hueOf(`${d.title}${cur.number}${e.episode}`)}"></div><span class="ep-play">${I('play')}</span>${e.position > 0 && !e.watched && e.duration ? `<div class="bar"><i style="width:${Math.min(100, (e.position / e.duration) * 100)}%"></i></div><span class="ep-badge now">${esc(t('En cours'))}</span>` : ''}</div><div class="ep-line"><b>${esc(t('Épisode {n}', { n: nombre(e.episode) }))}</b>${e.runtime ? `<span>${esc(duree(e.runtime))}</span>` : ''}</div></a><button class="ep-toggle f${e.watched ? ' on' : ''}" aria-pressed="${e.watched}" aria-label="${esc(e.watched ? t('Marquer l’épisode {n} comme non vu', { n: nombre(e.episode) }) : t('Marquer l’épisode {n} comme vu', { n: nombre(e.episode) }))}" data-act="epseen" data-v="${esc(e.id)}" data-d="${e.duration || (e.runtime || 0) * 60}" data-on="${e.watched ? 1 : 0}">${I('check')}</button></div>`)).join('')}</div></section>`;
    }
    const te = f.tech || {};
    return `<main class="with-nav page-in"><div class="details amb" style="--amb:hsl(${hueOf(d.title)} 60% 55%)">
    <div class="details-bg">${d.poster ? `<img src="${esc(d.poster)}" alt="" class="fade ok">` : ''}</div>
    <div class="details-body"><div class="details-top"><div class="details-poster${isClip ? ' wide' : ''}">${Pic(d)}</div>
      <div class="details-main"><h1 class="hero-title" tabindex="-1">${esc(d.title)}</h1>
        <div class="meta">${d.year ? `<span>${esc(String(d.year))}</span>` : ''}${!isShow && d.runtime ? `<span>${esc(duree(d.runtime))}</span>` : ''}${isShow ? `<span>${esc(`${tn(nSeasons, '{n} saison', '{n} saisons')}, ${tn(nEps, '{n} épisode', '{n} épisodes')}`)}</span>` : ''}${d.res ? `<span class="badge">${esc(d.res)}</span>` : ''}${ends && !isShow ? `<span class="ends-at">${esc(t('Se termine à {h}', { h: ends }))}</span>` : ''}</div>
        <p class="hero-overview clamp muted">${esc(t('Le résumé, les genres et les notes arrivent avec les fiches des titres.'))}</p>
        <div class="actions">
          <a class="btn btn-play f" href="${href(lirePath(next.id))}">${I('play')}${esc(label)}</a>
          ${endPos ? `<a class="btn btn-ghost btn-icon f" aria-label="${esc(t('Recommencer depuis le début'))}" title="${esc(t('Recommencer'))}" href="${href(`${lirePath(next.id)}?debut=1`)}">${I('restart')}</a>` : ''}
          <button class="btn btn-ghost btn-icon f" aria-label="${esc(t('Envoyer vers un autre écran'))}" title="${esc(t('Envoyer vers la télé'))}" data-act="sendto" data-v="${esc(next.id)}">${I('cast')}</button>
          <button class="btn btn-ghost btn-icon f" aria-label="${esc(d.inList ? t('Retirer de ma liste') : t('Ajouter à ma liste'))}" title="${esc(t('Ma liste'))}" aria-pressed="${d.inList}" data-act="mylist" data-v="${esc(d.id)}">${I(d.inList ? 'check' : 'plus')}</button>
          ${!isShow ? `<button class="btn btn-ghost btn-icon f${seen ? ' is-on' : ''}" aria-label="${esc(seen ? t('Marquer comme non vu') : t('Marquer comme vu'))}" title="${esc(seen ? t('Vu : marquer comme non vu') : t('Marquer comme vu'))}" aria-pressed="${seen}" data-act="seen" data-v="${esc(d.id)}" data-d="${total}" data-on="${seen ? 1 : 0}">${I('eye')}</button>` : ''}
        </div>
        ${endPos ? `<p class="resume-note">${I('clock')} ${esc(t('Vu jusqu’à {m}', { m: duree(Math.round(endPos / 60)) }))}</p>` : ''}
      </div></div>
      ${seasonsHtml}
      <section class="d-section cast"><h2 class="section-title">${esc(t('Distribution et équipe'))}</h2>${Empty(t('Pas encore d’informations sur la distribution de ce titre.'))}</section>
      <section class="d-section about"><div class="about-btns"><button class="btn btn-ghost f" data-act="about" data-v="${esc(d.id)}">${I('info')}${esc(t('À propos'))}</button>${te.fichier ? `<button class="btn btn-ghost f" data-act="tech" data-v="${esc(d.id)}">${I('film')}${esc(t('Fiche technique'))}</button>` : ''}</div></section>
      <div class="d-similar">${Row({ title: isClip ? t('Autres clips') : t('Dans la même bibliothèque'), items: L.itemsOf(S.items, d.category).filter((x) => x.id !== d.id).slice(0, 12), more: lib })}</div>
    </div></div></main>`;
  };

  // Recherche (Search.js)
  V.search = () => {
    const raw = S.searchQ, n = norm(raw);
    const KINDS = [['all', 'Tout'], ['movie', 'Films'], ['show', 'Séries'], ['anime', 'Animés'], ['clip', 'Clips']];
    const keep = (l) => (S.searchKind === 'all' ? l : l.filter((i) => i.category === S.searchKind));
    const Section = (title, inner) => `<section class="search-sec"><h2 class="section-title">${esc(title)}</h2>${inner}</section>`;
    const body = !n ? Section(t('Ajouts récents'), S.items.length ? `<div class="grid">${keep([...S.items].sort((a, b) => b.added - a.added)).slice(0, 18).map((i) => Card(i, { poster: true })).join('')}</div>` : libVide())
      : (() => { const hits = keep(S.items.filter((i) => n.split(' ').every((w) => norm(i.title).includes(w)) || String(i.year || '') === n)); return Section(hits.length ? t('Dans Venus · {n}', { n: nombre(hits.length) }) : t('Dans Venus'), hits.length ? `<div class="grid">${hits.map((i) => Card(i, { poster: true })).join('')}</div>` : `<p class="grid-empty">${esc(t('Rien dans votre médiathèque pour cette recherche.'))}</p>`); })();
    return `<main class="with-nav page-in"><div class="page"><h1 class="sr-only">${esc(t('Recherche'))}</h1><div class="search-box">${I('search')}<input id="srch" type="search" placeholder="${esc(t('Titre, année…'))}" aria-label="${esc(t('Rechercher'))}" autocomplete="off" enterkeyhint="search" value="${esc(raw)}"><button class="search-clear f" type="button" aria-label="${esc(t('Effacer'))}"${raw ? '' : ' hidden'} data-act="sq" data-v="">${I('close')}</button></div>
    <div class="seg search-kinds" role="group" aria-label="${esc(t('Type'))}">${KINDS.map(([k, l]) => `<button class="seg-b f${S.searchKind === k ? ' on' : ''}" aria-pressed="${S.searchKind === k}" data-act="skind" data-v="${k}">${esc(t(l))}</button>`).join('')}</div><div class="search-body">${body}</div></div></main>`;
  };

  // « Qui regarde ? » (Gates.js) : les comptes d'Odin
  V.profiles = () => `<main><div class="center-screen"><div><h1 tabindex="-1">${esc(t('Qui regarde ?'))}</h1><p class="lead">${esc(t('Chaque profil a sa liste, sa progression et ses réglages.'))}</p><div class="profiles">${S.profils.map((p) => `<button class="profile-tile f" data-act="pickprofile" data-v="${esc(p.id)}"${p.id === S.profile.id ? ' aria-current="true"' : ''}>${Avatar(p)}<span class="name">${esc(p.name)}</span></button>`).join('')}</div><p class="muted small" style="text-align:center;margin-top:32px">${esc(t('Les profils sont les comptes d’Odin.'))}</p><div style="text-align:center;margin-top:16px"><button class="btn btn-ghost btn-small f" data-act="odin">${I('exit')}${esc(t('Revenir à Odin'))}</button></div></div></div></main>`;

  // Réglages (Settings.js) : Thème et menu ; Médiathèques
  const Actions = (inner) => `<div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap">${inner}</div>`;
  const BOX = {
    affichage: () => {
      const cur = T.chosen, tp = PLANETS[cur];
      const theme = `<section class="box"><h2>${esc(t('Thème'))}</h2><p>${esc(t('Choisissez votre planète : tout le site change — couleurs, logo, mais aussi la place du menu, la forme des affiches et des boutons. « Verre » est clair le jour et sombre la nuit, comme un téléphone.'))}</p><div class="theme-grid" role="radiogroup" aria-label="${esc(t('Planète'))}">${Object.entries(PLANETS).map(([id, p]) => `<button class="theme-opt f${id === cur ? ' on' : ''}" role="radio" aria-checked="${id === cur}" data-id="${id}" data-act="planet" data-v="${id}"><span class="theme-pic">${planetMarkup(id)}${id === cur ? '<span class="moon" aria-hidden="true"></span>' : ''}</span><span class="theme-name">${esc(p.name)}</span><small class="theme-layout">${esc(LAYOUTS[layoutOf(id)])}</small></button>`).join('')}</div>
      ${!tp.glass && !tp.light ? `<div class="glass-mode"><div class="seg" role="radiogroup" aria-label="${esc(t('Thème automatique'))}">${[['off', t('Toujours {p}', { p: tp.name })], ['sun', t('Clair le jour, sombre le soir')], ['system', t('Selon l’appareil')]].map(([v, l]) => `<button class="seg-b f${T.auto === v ? ' on' : ''}" role="radio" aria-checked="${T.auto === v}" data-act="autotheme" data-v="${v}">${esc(l)}</button>`).join('')}</div><small>${esc(t('Votre thème suit votre profil sur tous vos appareils.'))}</small></div>` : ''}
      ${tp.glass ? `<div class="glass-mode"><div class="seg" role="radiogroup" aria-label="${esc(t('Clair ou sombre'))}">${[['auto', t('Au rythme du soleil')], ['day', t('Toujours clair')], ['night', t('Toujours sombre')]].map(([v, l]) => `<button class="seg-b f${T.glass === v ? ' on' : ''}" role="radio" aria-checked="${T.glass === v}" data-act="glassmode" data-v="${v}">${esc(l)}</button>`).join('')}</div></div>` : ''}</section>`;
      const fluid = `<section class="box"><h2>${esc(t('Fluidité'))}</h2><p class="muted">${esc(t('Le mode léger coupe les flous et les effets lourds : utile sur une télé, une box ou un vieux téléphone.'))}</p><div class="seg" role="radiogroup" aria-label="${esc(t('Fluidité'))}">${[['auto', 'Automatique'], ['off', 'Effets complets'], ['on', 'Mode léger']].map(([k, l]) => `<button class="seg-b f${k === T.lite ? ' on' : ''}" role="radio" aria-checked="${k === T.lite}" data-act="lite" data-v="${k}">${esc(t(l))}</button>`).join('')}</div></section>`;
      const byId = new Map(NAV_ITEMS.map((i) => [i.id, i]));
      const items = M.order.map((id) => byId.get(id)).filter((it) => it && (!it.admin || S.profile.isAdmin));
      const menu = `<section class="box menu-box" id="menu"><h2>${esc(t('Menu'))}</h2><p>${esc(t('Choisissez ce qui apparaît dans le menu et dans quel ordre. Sur ordinateur, seules les 6 premières sections sont affichées ; le reste est rangé dans « Plus ». Réglages et profil restent toujours en bas.'))}</p><ol class="menu-edit">${items.map((it, i) => `<li class="${M.hidden.includes(it.id) ? 'off' : ''}"><span class="me-ic">${I(val(it.icon))}</span><b>${esc(it.id === 'today' ? t('Aujourd’hui / Ce soir') : val(it.label))}</b><button class="p-icon small f" data-act="mmove" data-v="${it.id}" data-d="-1" aria-label="${esc(t('Monter {s}', { s: val(it.label) }))}"${i === 0 ? ' disabled' : ''}>${I('up')}</button><button class="p-icon small f" data-act="mmove" data-v="${it.id}" data-d="1" aria-label="${esc(t('Descendre {s}', { s: val(it.label) }))}"${i === items.length - 1 ? ' disabled' : ''}>${I('down')}</button><label class="switch mini" title="${esc(t('Afficher dans le menu'))}"><input type="checkbox" class="f" data-act="mtoggle" data-v="${it.id}" aria-label="${esc(t('Afficher {s} dans le menu', { s: val(it.label) }))}"${M.hidden.includes(it.id) ? '' : ' checked'}></label></li>`).join('')}</ol>${Actions(`<button class="btn btn-small btn-ghost f" data-act="mreset">${esc(t('Rétablir le menu d’origine'))}</button>`)}</section>`;
      return theme + fluid + menu;
    },
    medias: () => {
      if (S.dossiers === null) { api('/venus/dossiers').then((d) => { S.dossiers = d.dossiers || []; rerender(); }).catch(() => { S.dossiers = []; rerender(); }); }
      const l = S.dossiers || [];
      return `<section class="box"><h2>${esc(t('Médiathèques'))}</h2><p>${esc(t('Les dossiers de la machine d’Odin que Venus lit. On les déclare, on lance un scan, on envoie des fichiers et on pilote les écrans depuis la page de gestion d’Odin.'))}</p>${l.length ? `<ul class="track-list">${l.map((x) => `<li><code>${esc(x.chemin)}</code> · ${esc(x.categorie)}</li>`).join('')}</ul>` : `<p class="muted">${esc(S.dossiers === null ? t('Chargement…') : t('Aucun dossier déclaré.'))}</p>`}${Actions(`<button class="btn btn-small f" data-act="classique">${I('folder')}${esc(t('Médiathèques et écrans'))}</button>`)}</section>`;
    },
  };
  V.settings = () => {
    const NAVS = [['Vous', [['affichage', 'Thème et menu', 'image']]], ...(S.profile.isAdmin ? [['Médias', [['medias', 'Médiathèques', 'folder'], ['demandes', 'Demandes', 'download']]]] : [])];
    const TABS = NAVS.flatMap(([, i]) => i), cur = TABS.find(([k]) => k === S.setTab) || TABS[0];
    return `<main class="with-nav page-in"><div class="page admin"><div class="page-head"><h1 tabindex="-1">${esc(t('Réglages'))}</h1></div>
    <div class="set-layout"><nav class="set-nav" aria-label="${esc(t('Rubriques des réglages'))}">${NAVS.map(([g, items]) => `<div class="set-group">${NAVS.length > 1 ? `<span class="set-group-t">${esc(t(g))}</span>` : ''}${items.map(([k, l, ic]) => `<button class="set-tab f${k === cur[0] ? ' on' : ''}"${k === cur[0] ? ' aria-current="page"' : ''} data-act="settab" data-v="${k}">${I(ic)}<span>${esc(t(l))}</span></button>`).join('')}</div>`).join('')}</nav>
    <div class="set-main"><div class="set-head"><h2>${esc(t(cur[1]))}</h2></div><div class="admin-grid">${BOX[cur[0]]()}</div></div></div></div></main>`;
  };
  // ---------------------------------------------------------------- demandes et téléchargements (écrans, lots V4-V6)
  // Upcoming.js (« À venir », « Mes envies »), Nouveautes.js, Request.js (« Nouveau » et sa file), SettingsAdmin.js
  // (Réglages → Demandes), branchés sur les applicatifs natifs de Vénus : Hnoss (demandes, envies), Sirius (films),
  // Pléiades (séries, animés), Delta (sources), Comète (file). Les titres venus d'un catalogue sont écrits comme du
  // texte (esc), jamais comme du code ; aucune image extérieure n'est chargée (le carré de couleur de Venus à la place).
  const agir = (action, input = {}, confirm = false) => api('/api/valhalla/act', { module: 'freyja', action, input, ...(confirm ? { confirm: true } : {}) });
  const envoyer = (corps) => api('/api/valhalla/act', corps);
  const premiere = (r, repli) => String((r && (r.text || r.error || r.confirm)) || repli || t('Impossible pour le moment.')).split('\n')[0];
  // Le registre des titres cliquables : un même titre (clé, saison, épisode, type) garde TOUJOURS le même indice, même
  // après un nouveau rendu (avant : remis à zéro à chaque rendu, une fenêtre restée ouverte pouvait viser un autre titre).
  const regIdx = new Map();
  const reg = (x) => { const id = `${x.key}|${x.season ?? ''}|${x.episode ?? ''}|${x.type || ''}`; let i = regIdx.get(id); if (i === undefined) { i = S.reg.length; regIdx.set(id, i); S.reg.push(x); } else S.reg[i] = x; return i; };
  const cleSortie = (e) => `${e.key}|${e.season ?? ''}|${e.episode ?? ''}`;
  const appDe = (kind) => (kind === 'movie' ? 'Sirius' : 'Pléiades');
  const nomDe = (e) => e.title || '';
  const epLabel = (e) => (e.kind === 'movie' ? [t(e.release || 'Sortie'), e.year].filter(Boolean).join(' · ') : `${e.season != null ? t('S{s}:É{e}', { s: nombre(e.season), e: nombre(e.episode ?? 0) }) : t('Épisode {n}', { n: nombre(e.episode ?? 0) })}${e.epTitle ? ` - ${e.epTitle}` : ''}`);
  const jourLocal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const fmtJour = (iso, an = true) => date(Date.parse(`${iso}T12:00:00`), { day: 'numeric', month: 'long', ...(an ? { year: 'numeric' } : {}) });
  const libelleJour = (iso) => {
    const dt = new Date(`${iso}T00:00:00`), t0 = new Date(`${jourLocal(Date.now())}T00:00:00`), diff = Math.round((dt - t0) / 864e5);
    if (diff === 0) return t('Aujourd’hui'); if (diff === -1) return t('Hier'); if (diff === 1) return t('Demain');
    const s = date(dt.getTime(), { weekday: 'long', day: 'numeric', month: 'short', ...(dt.getFullYear() !== t0.getFullYear() ? { year: 'numeric' } : {}) });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const UpPh = (e) => `<div class="up-ph" style="--h:${hueOf(nomDe(e))}"><span>${esc(nomDe(e))}</span></div>`;

  async function chargerAVenir(kind) {
    S.up[kind] = { chargement: true };
    try { const r = await agir('a_venir', { genre: GENRE[kind] }); if (r.ok === false) throw new Error(premiere(r)); S.up[kind] = { data: r.data }; for (const e of [...(r.data.entries || []), ...(r.data.suggestions || [])]) if (e.wanted) S.favs.add(e.key); }
    catch (err) { S.up[kind] = { erreur: String(err.message || err) }; }
    rerender();
  }
  const FavBtn = (e, wide = false) => { const on = S.favs.has(e.key), i = reg(e); return `<button type="button" class="up-act fav f${wide ? ' wide btn' : ''}${on ? ' on' : ''}" title="${esc(on ? t('Retirer des favoris') : t('Favori : téléchargé automatiquement'))}" aria-label="${esc(on ? t('Retirer « {t} » des favoris', { t: nomDe(e) }) : t('Mettre « {t} » en favori (téléchargement automatique)', { t: nomDe(e) }))}" aria-pressed="${on}" data-act="fav" data-i="${i}">${I('heart')}${wide ? esc(on ? t('En favori') : t('Favori')) : ''}</button>`; };
  const DlBtn = (e, kind, wide = false) => {
    const k = cleSortie(e), done = S.pris.has(k), busy = S.busy.has(k), app = appDe(kind), i = reg(e);
    const title = done ? t('Déjà suivi par {a} : téléchargé dès sa sortie', { a: app }) : t('Télécharger avec {a}', { a: app });
    return `<button type="button" class="up-act dl f${wide ? ' wide btn' : ''}${done ? ' done' : ''}${busy ? ' busy' : ''}"${done || busy ? ' disabled' : ''} title="${esc(title)}" aria-label="${esc(title)}" data-act="grab" data-i="${i}">${I(done ? 'check' : 'download')}${wide ? esc(done ? t('Suivi par {a}', { a: app }) : t('Télécharger')) : ''}</button>`;
  };
  V.upcoming = (kind, tabs) => {
    const st = S.up[kind];
    if (!st || st.chargement) { if (!st) void chargerAVenir(kind); return '<div class="page" aria-busy="true"><i class="sk" style="width:220px;height:48px"></i></div>'; }
    if (st.erreur) return `<div class="page"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(t(TITLES[kind]))}</h1></div>${tabs}</div><div class="empty"><h2>${esc(t('Impossible d’afficher les sorties'))}</h2><p>${esc(st.erreur)}</p></div></div>`;
    const d = st.data, kids = !!S.profile.isKids, filtre = S.upFilter[kind] || 'all', app = appDe(kind);
    const hier = jourLocal(Date.now() - 864e5), today = jourLocal(Date.now());
    const groups = L.jours(d.entries, filtre, S.favs), before = groups.filter((g) => g.day < hier), shown = S.upEarlier[kind] ? groups : groups.filter((g) => g.day >= hier);
    const sugs = (filtre === 'all' || filtre === 'out') && !kids ? d.suggestions || [] : [];
    const count = (d.entries || []).length;
    const FILTERS = [['all', 'Tout'], ['nas', 'Disponibles'], ['out', 'Pas disponibles'], ['fav', 'Mes favoris']].filter(([k]) => !(kids && (k === 'out' || k === 'fav')));
    const card = (e) => {
      // Comme Upcoming.js : la carte d'un titre déjà dans Vénus ouvre sa fiche et n'a pas de ♡ ⬇ ; « Disponible » veut dire
      // que CE film ou CET épisode est là (une série dans Vénus dont l'épisode n'est pas encore sorti : « Pas disponible »).
      const ok = !!e.nas, dispo = e.kind === 'movie' ? ok : !!e.epId;
      return `<div class="up-card${ok ? '' : ' out'}"><button type="button" class="up-pic f" aria-label="${esc(`${nomDe(e)}, ${epLabel(e)}`)}" ${ok ? `data-act="upopen" data-v="${esc(e.nas)}"` : `data-act="upsheet" data-i="${reg(e)}" data-k="${kind}"`}>${UpPh(e)}<span class="up-badge ${dispo ? 'in' : 'out'}">${esc(dispo ? t('Disponible') : t('Pas disponible'))}</span>${e.at && e.kind !== 'movie' ? `<span class="up-time">${esc(date(e.at, { hour: '2-digit', minute: '2-digit' }))}</span>` : ''}</button>
      ${!ok && !kids ? `<div class="up-acts">${FavBtn(e)}${DlBtn(e, kind)}</div>` : ''}<b>${esc(nomDe(e))}</b><span>${esc(epLabel(e))}</span></div>`;
    };
    const vide = !d.source
      ? `<div class="grid-empty"><p>${esc(t(d.texte || 'Aucun catalogue des sorties n’est réglé.'))}</p>${S.profile.isAdmin ? `<button class="btn btn-small f" data-act="godemandes">${I('gear')}${esc(t('Régler le catalogue des sorties'))}</button>` : ''}</div>`
      : `<div class="grid-empty"><p>${esc(filtre === 'fav' ? t('Aucun favori à venir.') : filtre === 'nas' ? t('Rien de disponible pour ces jours-ci.') : t('Rien d’annoncé pour l’instant.'))}</p>${(d.erreurs || []).length ? `<p class="muted">${esc(t('Le catalogue ne répond pas pour l’instant : {e}', { e: d.erreurs[0] }))}</p>` : ''}</div>`;
    return `<div class="page"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(t(TITLES[kind]))}</h1><p class="count">${esc(kind === 'movie' ? tn(count, '{n} sortie', '{n} sorties') : tn(count, '{n} épisode', '{n} épisodes'))}</p></div>${tabs}</div>
    <div class="up-bar"><div class="seg up-filter" role="radiogroup" aria-label="${esc(t('Afficher'))}">${FILTERS.map(([k, l]) => `<button class="seg-b f${k === filtre ? ' on' : ''}" role="radio" aria-checked="${k === filtre}" data-act="upfilter" data-kind="${kind}" data-v="${k}">${esc(t(l))}</button>`).join('')}</div>
    <div class="up-bar-right">${!kids ? `<span class="muted small">${I('heart')} ${esc(t('Favori = téléchargé automatiquement par {a}', { a: app }))}</span>` : ''}</div></div>
    ${sugs.length ? `<section class="up-sugs"><h2 class="section-title">${esc(kind === 'movie' ? t('Films à découvrir') : kind === 'anime' ? t('Animés à découvrir') : t('Séries à découvrir'))}<small>${esc(t('pas encore disponibles'))}</small></h2><div class="up-sug-row">${sugs.map((e) => `<div class="up-sug"><button type="button" class="up-sug-pic f" aria-label="${esc(nomDe(e))}" data-act="upsheet" data-i="${reg(e)}" data-k="${kind}">${UpPh(e)}<span class="up-sug-date">${esc(libelleJour(e.date))}</span></button>${kids ? '' : `<div class="up-acts">${FavBtn(e)}${DlBtn(e, kind)}</div>`}<b>${esc(nomDe(e))}</b><small>${esc(e.kind === 'movie' ? [t(e.release || 'Sortie'), e.year].filter(Boolean).join(' · ') : [e.network, e.genres && e.genres[0]].filter(Boolean).join(' · ') || epLabel(e))}</small></div>`).join('')}</div></section>` : ''}
    <div class="upcoming">${before.length && !S.upEarlier[kind] ? `<button class="btn btn-small btn-ghost up-earlier f" data-act="upearlier" data-kind="${kind}">${I('up')}${esc(t('Voir les {n} jours précédents', { n: nombre(before.length) }))}</button>` : ''}
    ${shown.map((g) => `<section class="up-day${g.day < today ? ' past' : ''}${g.day === today ? ' today' : ''}"><h2 class="section-title">${esc(libelleJour(g.day))}<small>${esc(fmtJour(g.day))}</small></h2><div class="up-grid">${g.items.map(card).join('')}</div></section>`).join('')}
    ${shown.length ? '' : vide}</div></div>`;
  };
  function upSheet(e, kind) {
    const kids = !!S.profile.isKids, app = appDe(kind);
    openSheet(null, `<div class="up-sheet"><div class="up-sheet-pic">${UpPh(e)}</div><div class="up-sheet-body"><h2>${esc(nomDe(e))}</h2><p class="muted">${esc([e.kind === 'movie' ? t(e.release || 'Sortie') : epLabel(e), e.date ? fmtJour(e.date) : '', e.network].filter(Boolean).join(' · '))}</p>
      ${e.genres && e.genres.length ? `<p class="up-genres">${esc(e.genres.slice(0, 4).join(' · '))}</p>` : ''}${e.overview ? `<p class="up-over">${esc(e.overview)}</p>` : ''}
      ${kids ? '' : `<div class="up-sheet-acts">${FavBtn(e, true)}${DlBtn(e, kind, true)}</div><p class="muted small">${esc(t('Favori : le titre rejoint « Mes envies » et {a} le télécharge dès qu’il est disponible.', { a: app }))}</p>`}</div></div>`, { wide: true });
  }

  // Mes envies (Upcoming.js → Wishes)
  const ETAT_ENVIE = { 'à valider': ['pending', 'Demandé, en attente de validation'], 'en attente': ['processing', 'Demandé : téléchargé dès sa sortie'], cherchée: ['processing', 'Demandé, recherche en cours'], 'en téléchargement': ['processing', 'Téléchargement en cours'], disponible: ['available', 'Disponible, arrive dans Venus'], échec: ['error', 'Pas trouvé'] };
  V.wishes = (tabs) => {
    if (S.envies === null) { S.envies = undefined; agir('hnoss_envies').then((r) => { S.envies = (r.data && r.data.envies) || []; rerender(); }).catch(() => { S.envies = []; rerender(); }); }
    if (!S.envies) return '<div class="page" aria-busy="true"><i class="sk" style="width:220px;height:48px"></i></div>';
    const l = S.envies, n = l.length;
    return `<div class="page"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(t('Ma liste'))}</h1><p class="count">${esc(tn(n, '{n} envie', '{n} envies'))}</p></div>${tabs}</div>
    <p class="list-hint">${esc(S.profile.isKids ? t('Vos envies sont visibles par les adultes de la maison, qui décident du téléchargement.') : t('Chaque envie est demandée à Hnoss tout de suite : le téléchargement démarre dès que le titre sort. Une fois arrivé, il passe dans « Dans Venus ».'))}</p>
    <div class="wish-grid">${!n ? `<div class="grid-empty"><p>${esc(t('Aucune envie pour l’instant.'))}</p><p class="muted">${esc(t('Dans Films, Séries ou Animés, onglet « À venir », le ♡ ajoute un titre ici et le fait télécharger.'))}</p><a class="btn btn-small f" href="${href('/series?vue=avenir')}">${I('cal')}${esc(t('Voir ce qui arrive'))}</a></div>`
      : l.map((w) => { const [st, lbl] = ETAT_ENVIE[w.etat] || ['none', 'Suivi']; return `<article class="wish"><div class="wish-pic"><span>${esc(w.titre)}</span></div><div class="wish-body"><b>${esc(w.titre)}</b><span class="wish-meta">${esc([w.genre === 'film' ? t('Film') : w.anime ? t('Animé') : t('Série'), w.annee].filter(Boolean).join(' · '))}</span><span class="wish-state st-${st}">${esc(t(lbl))}</span>${w.etat === 'échec' && w.note ? `<small class="error-text">${esc(w.note)}</small>` : ''}</div><button class="btn btn-ghost btn-icon btn-mini f" aria-label="${esc(t('Retirer {t} de mes envies', { t: w.titre }))}" title="${esc(t('Retirer'))}" data-act="wishrm" data-v="${esc(w.cle || w.id)}" data-t="${esc(w.titre)}">${I('close')}</button></article>`; }).join('')}</div></div>`;
  };

  // Nouveau (Request.js) : chercher un titre et l'ajouter ; en dessous, la file de Comète.
  const RKINDS = [['movie', 'Films', 'film'], ['show', 'Séries', 'tv'], ['anime', 'Animés', 'spark']];
  async function chargerFile() {
    clearTimeout(S.fileT);
    try { const r = await agir('comete_file'); S.file = (r.data && r.data.telechargements) || []; } catch { S.file = S.file || []; }
    if (L.route(location.hash).path !== '/nouveau') return;
    const q = $('#req-queue'); if (q) q.outerHTML = FileHtml(); else rerender();
    if (L.fileVivante(S.file)) S.fileT = setTimeout(() => { void chargerFile(); }, 2000);
  }
  const QBtn = (act, ic, label, id) => `<button class="btn btn-ghost btn-icon btn-mini f" aria-label="${esc(label)}" title="${esc(label)}" data-act="${act}" data-v="${esc(id)}">${I(ic)}</button>`;
  function FileHtml() {
    const l = S.file || [];
    if (!l.length) return '<section class="req-queue" id="req-queue" hidden></section>';
    return `<section class="req-queue" id="req-queue"><h2>${esc(t('En téléchargement'))}</h2><div class="req-q-list">${l.map((x) => {
      const f = L.ligneFile(x), ouvert = x.etat === 'en_cours' || x.etat === 'attente';
      const btns = ouvert ? QBtn('qpause', 'pause', t('Mettre en pause'), x.id) + QBtn('qcancel', 'stop', t('Annuler'), x.id)
        : x.etat === 'pause' ? QBtn('qresume', 'play', t('Reprendre'), x.id) + QBtn('qcancel', 'stop', t('Annuler'), x.id)
          : x.etat === 'a_part' ? `<button class="btn btn-small f" data-act="qaccept" data-v="${esc(x.id)}">${I('check')}${esc(t('Accepter'))}</button><button class="btn btn-small btn-danger f" data-act="qdrop" data-v="${esc(x.id)}">${I('trash')}${esc(t('Jeter'))}</button>`
            : QBtn('qremove', 'close', t('Retirer de la file'), x.id);
      return `<div class="req-q${x.etat === 'a_part' ? ' a-part' : ''}"><span class="req-ph small">${esc((f.titre || '?').slice(0, 1))}</span><div class="grow"><b>${esc(f.titre)}${f.ep ? `<small>${esc(` · ${f.ep}`)}</small>` : ''}</b><div class="progress-line"><i style="width:${f.pct}%"></i></div><small>${esc([t(f.etat), `${nombre(f.pct)} %`, f.reste ? t('reste {r}', { r: f.reste }) : '', x.etat === 'a_part' || x.etat === 'echec' ? x.texte : ''].filter(Boolean).join(' · '))}</small></div><div class="req-q-acts">${btns}</div></div>`;
    }).join('')}</div></section>`;
  }
  // La recherche du titre tapé (Request.js : 350 ms après la dernière lettre ; seule la dernière réponse compte).
  let reqT = 0, reqSeq = 0;
  function chercherReq(cle, q, kind) {
    clearTimeout(reqT);
    reqT = setTimeout(async () => {
      const my = ++reqSeq;
      let data = { source: false, items: [] };
      try { const r = await agir('sorties_chercher', { q, genre: GENRE[kind] }); if (r && r.data) data = r.data; } catch { /* le titre tel quel */ }
      if (my !== reqSeq || L.route(location.hash).path !== '/nouveau') return;
      S.req.res = { cle, data };
      const i = $('#reqq'), vise = !!i && D.activeElement === i, p = vise ? i.selectionStart : null; render(true);
      const j = $('#reqq'); if (j && vise) { j.focus({ preventScroll: true }); if (p != null) j.setSelectionRange(p, p); }
    }, 350);
  }
  V.request = () => {
    if (S.file === null) { S.file = undefined; void chargerFile(); }
    if (S.demandes === null) { S.demandes = undefined; agir('hnoss_demandes').then((r) => { S.demandes = (r.data && r.data.demandes) || []; rerender('#reqq'); }).catch(() => { S.demandes = []; }); }
    const q = S.req.q.trim(), kind = S.req.kind;
    const m = /^(.*?)\s*\((\d{4})\)$/.exec(q), titre = m ? m[1] : q, annee = m ? Number(m[2]) : 0;
    const cat = kind === 'movie' ? 'movie' : kind === 'anime' ? 'anime' : 'show', n = norm(titre);
    const dans = q.length >= 2 ? S.items.filter((i) => (cat === 'movie' ? i.category === 'movie' : i.category === 'show' || i.category === 'anime') && norm(i.title) === n) : [];
    const deja = q.length >= 2 ? (S.demandes || []).filter((d) => norm(d.titre) === n && (cat === 'movie') === (d.genre === 'film')) : [];
    const cleR = `${cat}|${q}`, rech = S.req.res && S.req.res.cle === cleR ? S.req.res.data : null;
    if (q.length >= 2 && !rech) chercherReq(cleR, q, cat);
    const etatDe = (title, year, inLibrary) => {
      const nn = norm(title), k = `req|${cat}|${nn}|${year || ''}`;
      const ici = inLibrary || (S.items.some((i) => (cat === 'movie' ? i.category === 'movie' : i.category === 'show' || i.category === 'anime') && norm(i.title) === nn) ? 'oui' : '');
      const dem = (S.demandes || []).find((d) => norm(d.titre) === nn && (cat === 'movie') === (d.genre === 'film') && (!year || !d.annee || d.annee === year));
      return { etat: ici ? 'venus' : dem ? 'requested' : S.pris.has(k) ? 'added' : S.busy.has(k) ? 'busy' : 'idle', note: dem ? dem.etat : '' };
    };
    // Avec la clé du grand catalogue : ses résultats (titre, année, résumé ; l'affiche est dessinée, aucune image
    // extérieure). Sans clé : le titre tapé, tel quel.
    const res = q.length < 2 ? [] : rech && rech.source ? (rech.items || []).map((x, i) => ({ id: String(i), title: x.title, year: x.year, overview: x.overview, kind: cat, ...etatDe(x.title, x.year, x.inLibrary) }))
      : rech ? [{ id: 'q', title: titre, year: annee || undefined, kind: cat, ...etatDe(titre, annee) }] : [];
    const note = !q ? t('Cherchez un titre pour l’ajouter.') : q.length < 2 ? t('Tapez au moins deux lettres.') : !rech ? t('Recherche…')
      : rech.source ? (res.length ? tn(res.length, '{n} résultat', '{n} résultats') : t('Aucun résultat.'))
        : dans.length ? t('Déjà dans Venus') : deja.length ? t('Déjà demandé') : t('Un clic sur « Ajouter » : il est cherché dans tes sources, téléchargé par Comète et rangé dans Venus.');
    return `<main class="with-nav page-in"><div class="page req-page"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(t('Nouveau'))}</h1><p class="muted">${esc(t('Ajoutez un titre : il se télécharge tout seul et arrive dans Venus.'))}</p></div></div>
    <div class="req-bar"><div class="search-box">${I('search')}<input id="reqq" class="input" type="search" placeholder="${esc(t('Titre d’un film, d’une série ou d’un animé…'))}" autocomplete="off" aria-label="${esc(t('Rechercher un titre à ajouter'))}" enterkeyhint="search" value="${esc(S.req.q)}"></div>
    <div class="seg" role="radiogroup" aria-label="${esc(t('Type'))}">${RKINDS.map(([k, l, ic]) => `<button class="seg-b f${k === kind ? ' on' : ''}" role="radio" aria-checked="${k === kind}" data-act="reqkind" data-v="${k}">${I(ic)}${esc(t(l))}</button>`).join('')}</div></div>
    ${FileHtml()}
    <p class="muted req-note" aria-live="polite">${esc(note)}</p>
    <div class="req-grid">${res.map((r) => `<article class="req-card"><div class="req-pic"><span class="req-ph up-ph" style="--h:${hueOf(r.title)}">${esc(r.title.slice(0, 1))}</span></div><div class="req-body"><b class="req-title">${esc(r.title)}</b><small>${esc([r.year, kindLabel({ category: r.kind })].filter(Boolean).join(' · '))}</small>${r.overview ? `<p>${esc(r.overview)}</p>` : ''}
      ${r.etat === 'venus' ? `<span class="req-state ok">${I('check')}${esc(t('Déjà dans Venus'))}</span>` : r.etat === 'requested' ? `<span class="req-state">${I('check')}${esc(t('Déjà demandé'))}${r.note ? ` · ${esc(r.note)}` : ''}</span>`
        : `<button class="btn btn-small btn-play f${r.etat === 'added' ? ' done' : ''}"${r.etat !== 'idle' ? ' disabled' : ''} data-act="reqadd" data-v="${r.id}">${I(r.etat === 'busy' ? 'refresh' : r.etat === 'idle' ? 'download' : 'check')}${esc(r.etat === 'busy' ? t('Ajout…') : r.etat === 'added' ? t('Ajouté') : t('Ajouter'))}</button>`}</div></article>`).join('')}</div></div></main>`;
  };

  // Nouveautés (Nouveautes.js)
  const NKINDS = [['movie', 'Films'], ['show', 'Séries'], ['anime', 'Animés']];
  async function chargerNouveautes(kind) {
    S.nouv[kind] = { chargement: true };
    try { const r = await agir('sorties_nouveautes', { genre: GENRE[kind] }); if (r.ok === false) throw new Error(premiere(r)); S.nouv[kind] = { data: r.data }; for (const s of r.data.sections || []) for (const x of s.items) if (x.wanted) S.favs.add(x.key); }
    catch (err) { S.nouv[kind] = { erreur: String(err.message || err) }; }
    rerender();
  }
  V.nouveautes = () => {
    const kind = S.newKind, st = S.nouv[kind];
    const head = `<div class="new-head"><h1 tabindex="-1">${esc(t('Nouveautés'))}</h1><div class="chips new-tabs" role="tablist">${NKINDS.map(([k, l]) => `<button class="chip f${k === kind ? ' on' : ''}" role="tab" aria-selected="${k === kind}" data-act="newkind" data-v="${k}">${esc(t(l))}</button>`).join('')}</div>${st && st.data && st.data.source ? `<span class="auto-pill"><span class="dot"></span>${esc(t('Hnoss actif : demandez un titre, il se télécharge tout seul'))}</span>` : ''}</div>`;
    if (!st || st.chargement) { if (!st) void chargerNouveautes(kind); return `<main class="with-nav new-page page-in">${head}<div class="page" aria-busy="true"><i class="sk" style="width:220px;height:48px"></i></div></main>`; }
    if (st.erreur) return `<main class="with-nav new-page page-in">${head}<div class="empty"><h2>${esc(t('Rien pour le moment'))}</h2><p>${esc(st.erreur)}</p></div></main>`;
    const d = st.data, sections = (d.sections || []).filter((s) => s.items.length);
    if (!sections.length) return `<main class="with-nav new-page page-in">${head}<div class="rows new-rows"><div class="empty"><h2>${esc(d.source ? t('Rien pour le moment') : t('Nouveautés indisponibles'))}</h2><p>${esc(d.source ? t('Les sites de référence ne répondent pas pour l’instant. Réessayez dans un moment.') : t(d.texte))}</p>${!d.source && S.profile.isAdmin ? `<button class="btn btn-play f" data-act="godemandes">${esc(t('Ouvrir les réglages'))}</button>` : ''}</div></div></main>`;
    const all = sections.flatMap((s) => s.items), x = all.find((y) => y.key === S.newCur[kind]) || all[0];
    const when = x.date ? (Date.parse(x.date) > Date.now() ? t('Sortie le {d}', { d: fmtJour(x.date) }) : fmtJour(x.date)) : '';
    const k = `nv|${x.key}`, pris = S.pris.has(k), busy = S.busy.has(k), on = S.favs.has(x.key), ix = reg(x);
    const wish = `<button class="btn btn-ghost btn-icon f wish-btn${on ? ' is-on' : ''}" aria-pressed="${on}" aria-label="${esc(on ? t('Retirer de mes envies') : t('Ajouter à mes envies'))}" title="${esc(on ? t('Dans mes envies') : t('Ajouter à mes envies : demandé à Hnoss dès maintenant, téléchargé dès sa sortie'))}" data-act="fav" data-i="${ix}">${I('heart')}</button>`;
    const actions = x.inLibrary ? `<div class="actions"><a class="btn btn-play f" href="${href(`/titre/${encodeURIComponent(x.inLibrary)}`)}">${I('play')}${esc(t('Dans Venus : voir la fiche'))}</a></div>`
      : pris ? `<div class="actions"><span class="sp-state st-processing">${I('check')}${esc(t('Demandé, recherche en cours'))}</span>${wish}</div>`
        : `<div class="actions"><button class="btn btn-play f"${busy ? ' disabled' : ''} data-act="newreq" data-i="${ix}">${I('add')}${esc(busy ? t('Demande envoyée…') : t('Demander'))}</button>${wish}</div>`;
    const spot = `<section class="spotlight"><div class="sp-bg"><div class="sp-layer on"><div class="ph" style="--h:${hueOf(x.title)}"></div></div></div><div class="sp-body swap"><div class="sp-kicker">${x.inLibrary ? `<span class="sp-in">${I('check')}${esc(t('Dans Venus'))}</span>` : ''}${x.anime ? `<span>${esc(t('Animé'))}</span>` : ''}${when ? `<span>${esc(when)}</span>` : ''}${x.next ? `<span>${esc(t('Épisode {n} le {d}', { n: nombre(x.next.episode), d: date(x.next.at, { day: 'numeric', month: 'long' }) }))}</span>` : ''}</div>
      <h1 class="hero-title sp-title">${esc(x.title)}</h1>${x.original && x.original !== x.title ? `<p class="sp-orig">${esc(x.original)}</p>` : ''}
      ${x.score ? `<div class="ratings"><span class="rating r-tmdb"><span class="r-src">${esc(t('Note'))}</span><b>${esc(x.anime ? `${x.score} %` : new Intl.NumberFormat(LANG, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(x.score / 10))}</b>${x.anime ? '' : '<small>/10</small>'}</span></div>` : ''}
      ${x.overview ? `<p class="hero-overview">${esc(x.overview)}</p>` : ''}${actions}</div></section>`;
    const rows = sections.map((s) => `<section class="row"><div class="row-head"><h2>${esc(t(s.title))}</h2></div>${ScrollRow(s.items.map((y) => `<button class="card poster dcard f" aria-label="${esc(`${y.title}${y.inLibrary ? `, ${t('dans Venus')}` : ''}`)}" data-act="newpick" data-v="${esc(y.key)}" data-k="${kind}"><div class="shot"><div class="ph" style="--h:${hueOf(y.title)}">${esc(y.title)}</div>${y.inLibrary ? `<span class="dc-in" title="${esc(t('Déjà dans Venus'))}">${I('check')}</span>` : ''}${y.score ? `<span class="dc-score">${esc(y.anime ? `${y.score} %` : `★ ${new Intl.NumberFormat(LANG, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(y.score / 10)}`)}</span>` : ''}</div><div class="cap"><b>${esc(y.title)}</b><small>${esc(y.date ? (Date.parse(y.date) > Date.now() ? t('Le {d}', { d: fmtJour(y.date, false) }) : y.date.slice(0, 4)) : '')}</small></div></button>`).join(''))}</section>`).join('');
    return `<main class="with-nav new-page page-in">${head}${spot}<div class="rows new-rows">${rows}</div></main>`;
  };

  // Réglages → Demandes (SettingsAdmin.js : boîtes « Sirius, Pléiades », « Comète », Hnoss ; sources et catalogue ajoutés)
  const Field = (label, inner, hint = '') => { const id = (/id="([^"]+)"/.exec(inner) || [])[1]; return `<div class="field"><label${id ? ` for="${id}"` : ''}>${esc(label)}</label>${inner}${hint ? `<small>${esc(hint)}</small>` : ''}</div>`; };
  const Select = (id, opts, v) => `<select class="input f" id="${id}">${opts.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const Switch = (id, label, on, hint = '') => `<label class="switch"><span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span><input type="checkbox" class="f" id="${id}"${on ? ' checked' : ''}></label>`;
  /** La valeur d'un champ des réglages (case cochée ou texte), lue au moment du clic. */
  const champ = (id) => { const e = $(`#${id}`); return e ? (e.type === 'checkbox' ? !!e.checked : String(e.value ?? '')) : undefined; };
  async function chargerDemandes() {
    const sur = (p) => p.then((r) => r.data || {}).catch(() => ({}));
    const [acq, src, cat, hn, dem, dos] = await Promise.all([sur(agir('acquisition')), sur(agir('delta_sources')), sur(agir('catalogue_etat')), sur(agir('hnoss_reglages')), sur(agir('hnoss_demandes')), api('/venus/dossiers').catch(() => ({ dossiers: [] }))]);
    S.dem = { sirius: acq.sirius || {}, pleiades: acq.pleiades || {}, comete: acq.comete || {}, sources: src.sources || [], catalogue: cat.reglages || {}, libres: hn.libres || [], membres: hn.membres || [], demandes: dem.demandes || [], dossiers: dos.dossiers || [] };
    rerender();
  }
  BOX.demandes = () => {
    if (S.dem === null) { S.dem = undefined; void chargerDemandes(); }
    if (!S.dem) return `<section class="box"><p class="muted">${esc(t('Chargement…'))}</p></section>`;
    const D_ = S.dem, QUAL = [['toutes', t('Toutes les qualités')], ['720p', '720p'], ['1080p', t('1080p, VF de préférence')], ['2160p', t('4K si possible')]];
    const dos = (cat) => [['', t('Premier dossier déclaré')], ...D_.dossiers.filter((x) => x.categorie === cat).map((x) => [x.chemin, x.chemin])];
    const one = (id, name, role, dirLabel, cat, anime) => { const r = D_[id] || {}; return `<div class="arr-one"><h3 class="box-sub">${esc(name)}<small class="muted"> — ${esc(t(role))}</small></h3><div class="arr-picks"><small class="ok-text">${esc(t('{a} intégré à Venus (dans Odin)', { a: name }))}</small><div class="two-cols wide">${Field(t('Profil de qualité'), Select(`q-${id}`, QUAL, r.qualite || '1080p'))}${Field(t(dirLabel), Select(`d-${id}`, dos(cat), r.dossier || ''))}</div>${anime ? Field(t('Dossier des animés'), Select(`da-${id}`, [['', t('Même dossier que les séries')], ...dos('series').slice(1)], r.dossierAnimes || '')) : ''}${Field(t('Langue'), Select(`l-${id}`, [['vf', t('VF de préférence')], ['toutes', t('Toutes les langues')]], r.langue || 'vf'))}${Actions(`<button class="btn btn-small btn-play f" data-act="suivisave" data-v="${id}">${esc(t('Enregistrer'))}</button>`)}</div></div>`; };
    const arr = `<section class="box" id="arr"><h2>${esc(t('Sirius et Pléiades'))}</h2><p>${esc(t('Sirius (films) et Pléiades (séries et animés) sont dans Venus : dans « Nouveau » et « À venir », un clic envoie le titre au bon applicatif, qui le fait télécharger par Comète. Venus l’ajoute dès que le fichier arrive dans vos dossiers.'))}</p>${one('sirius', 'Sirius', 'films', 'Dossier des films', 'films')}${one('pleiades', 'Pléiades', 'séries et animés', 'Dossier des séries', 'series', true)}</section>`;
    const c = D_.comete || {};
    const comete = `<section class="box" id="comete"><h2>${esc(t('Comète : téléchargements'))}</h2><p>${esc(t('Le moteur de téléchargement de Venus : file d’attente, reprise après une coupure, vérification de chaque fichier (antivirus) avant de le ranger.'))}</p>${Field(t('Téléchargements en même temps'), Select('c-sim', [1, 2, 3, 4].map((n) => [n, String(n)]), c.simultanes || 2))}${Field(t('Taille maximale d’un fichier (Go)'), `<input class="input f" id="c-taille" type="number" min="1" max="500" value="${esc(c.tailleMaxGo || 60)}">`)}${Field(t('Débit maximum (Mo/s, 0 = libre)'), `<input class="input f" id="c-debit" type="number" min="0" max="10000" value="${esc(c.debitMo || 0)}">`)}${Actions(`<button class="btn btn-small btn-play f" data-act="cometesave">${esc(t('Enregistrer'))}</button><a class="btn btn-small f" href="${href('/nouveau')}">${I('download')}${esc(t('Voir la file'))}</a>`)}</section>`;
    const sources = `<section class="box" id="sources"><h2>${esc(t('Sources de téléchargement (Delta)'))}</h2><p>${esc(t('Odin n’en fournit aucune : ajoutez seulement des sources que vous avez le droit d’utiliser (format de recherche standard des indexeurs). La clé est gardée chiffrée et n’est plus jamais montrée.'))}</p>
      ${D_.sources.length ? D_.sources.map((x) => `<div class="list-row"><span class="dot${x.actif ? '' : ' off'}" title="${esc(x.actif ? t('Active') : t('Inactive'))}"></span><div class="grow"><b>${esc(x.nom)}</b><small class="muted">${esc([x.type, t('priorité {n}', { n: nombre(x.priorite) }), tn(x.recherches || 0, '{n} recherche', '{n} recherches'), x.aCle ? t('clé gardée') : '', x.derniereErreur || ''].filter(Boolean).join(' · '))}</small></div><button class="btn btn-small f" data-act="srctest" data-v="${esc(x.id)}">${esc(t('Tester'))}</button><button class="btn btn-small btn-danger f" data-act="srcdel" data-v="${esc(x.id)}" aria-label="${esc(t('Retirer {s}', { s: x.nom }))}">${esc(t('Retirer'))}</button></div>`).join('') : `<p class="muted">${esc(t('Aucune source pour l’instant.'))}</p>`}
      <h3 class="box-sub">${esc(t('Ajouter une source'))}</h3><div class="two-cols wide">${Field(t('Nom'), '<input class="input f" id="s-nom" autocomplete="off" maxlength="60">')}${Field(t('Format'), Select('s-type', [['torznab', t('Recherche de torrents (format standard)')], ['newznab', t('Recherche Usenet (format standard)')]], 'torznab'))}</div>${Field(t('Adresse de l’API'), '<input class="input f" id="s-adr" type="url" placeholder="https://…/api" autocomplete="off">')}${Field(t('Clé (facultative)'), '<input class="input f" id="s-cle" type="password" autocomplete="new-password" value="">', t('Gardée chiffrée sur la machine d’Odin, jamais dans la base ni à l’écran.'))}${Actions(`<button class="btn btn-small btn-play f" data-act="srcadd">${I('plus')}${esc(t('Ajouter la source'))}</button>`)}</section>`;
    const k = D_.catalogue || {};
    const catalogue = `<section class="box" id="catalogue"><h2>${esc(t('Sorties à venir et nouveautés'))}</h2><p>${esc(t('D’où viennent les sorties de « À venir » et les Nouveautés, comme dans Venus. Par défaut, seul le catalogue public des films (sans clé) est lu ; « Aucun » pour ne rien lire. Avec la clé, « Nouveau » cherche aussi le titre tapé dans le grand catalogue.'))}</p>${Switch('cat-series', t('Programme télé des séries (public, sans clé)'), k.series)}${Switch('cat-animes', t('Programme de diffusion des animés (public, sans clé)'), k.animes)}${Field(t('Films'), Select('cat-films', [['aucun', t('Aucun')], ['public', t('Catalogue public des films (sans clé)')], ['cle', t('Grand catalogue des films et séries (avec votre clé gratuite)')]], k.films || 'public'))}${Field(t('Clé du grand catalogue'), '<input class="input f" id="cat-cle" type="password" autocomplete="new-password" value="">', k.aCle ? t('Une clé est gardée (chiffrée). Laissez vide pour la garder.') : t('Sert aussi aux Nouveautés des films et des séries. Gardée chiffrée, jamais montrée.'))}${Actions(`<button class="btn btn-small btn-play f" data-act="catsave">${esc(t('Enregistrer'))}</button>${k.aCle ? `<button class="btn btn-small btn-ghost f" data-act="catforget">${esc(t('Oublier la clé'))}</button>` : ''}`)}</section>`;
    const avalider = D_.demandes.filter((x) => x.etat === 'à valider');
    const hnoss = `<section class="box" id="hnoss"><h2>${esc(t('Hnoss : téléchargements automatiques'))}</h2><p>${esc(t('Hnoss est dans Venus. Les titres ajoutés à « Mes envies » (♡ dans À venir et Nouveautés) sont demandés tout de suite, même s’ils ne sortent que dans plusieurs mois.'))}</p><div class="auto-pill" style="margin-bottom:12px"><span class="dot"></span>${esc(t('Actif dans Venus'))}</div>
      <h3 class="box-sub">${esc(t('Demandes au nom de chacun'))}</h3><p class="muted" style="font-size:.88rem;margin:0 0 10px">${esc(t('Chaque profil fait ses demandes à son nom. Choisissez les membres dont les demandes partent tout de suite ; les autres attendent votre validation. Aucun membre ne règle les sources ni n’accepte un fichier mis à part.'))}</p>
      ${D_.membres.length ? D_.membres.map((p) => Field(p.nom, `<select class="input f" data-act="hlibre" data-v="${esc(p.login)}" aria-label="${esc(t('Demandes de {n}', { n: p.nom }))}"><option value="valider"${D_.libres.includes(p.login) ? '' : ' selected'}>${esc(t('Demandes validées par moi'))}</option><option value="libre"${D_.libres.includes(p.login) ? ' selected' : ''}>${esc(t('Demandes libres (sans validation)'))}</option></select>`)).join('') : `<p class="muted">${esc(t('Aucun membre de la famille pour l’instant.'))}</p>`}
      <h3 class="box-sub">${esc(t('À valider'))}</h3>${avalider.length ? avalider.map((x) => `<div class="list-row"><div class="grow"><b>${esc(x.titre)}${x.annee ? ` (${esc(x.annee)})` : ''}</b><small class="muted">${esc([x.genre === 'film' ? t('Film') : t('Série'), x.saisons && x.saisons.length ? t('saison(s) {s}', { s: x.saisons.join(', ') }) : '', t('demandé par {n}', { n: (x.qui && (x.qui.nom || x.qui.login)) || '' })].filter(Boolean).join(' · '))}</small></div><button class="btn btn-small btn-play f" data-act="hvalider" data-v="${esc(x.id)}">${I('check')}${esc(t('Valider'))}</button><button class="btn btn-small btn-ghost f" data-act="hrefuser" data-v="${esc(x.id)}">${esc(t('Refuser'))}</button></div>`).join('') : `<p class="muted">${esc(t('Aucune demande à valider.'))}</p>`}</section>`;
    return arr + comete + sources + catalogue + hnoss;
  };

  // Une section de Venus pas encore construite dans Odin : la place est gardée, et l'écran le dit.
  V.bientot = (path) => { const it = NAV_ITEMS.find((x) => x.href === path); return `<main class="with-nav page-in"><div class="page"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(it ? val(it.label) : 'Venus')}</h1></div></div>${Empty(t('Cette partie de Venus arrive dans Odin avec un prochain lot.'), `<a class="btn btn-ghost btn-small f" href="${href('/')}">${esc(t('Accueil'))}</a>`)}</div></main>`; };

  // ---------------------------------------------------------------- fenêtres (ui.js), « Tout Venus » (core.js), Ctrl+K (Palette.js)
  let lastFocus = null;
  function openSheet(title, content, { wide = false } = {}) {
    closeSheet(false); lastFocus = D.activeElement;
    const wrap = D.createElement('div'); wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title || '')}" tabindex="-1"><span class="sheet-grab" aria-hidden="true"></span>${title ? `<h2>${esc(title)}</h2>` : ''}${content}</div>`;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSheet(); });
    D.body.append(wrap);
    requestAnimationFrame(() => (wrap.querySelector('.opt.on, .f, input, button') || wrap.querySelector('.sheet')).focus());
  }
  function closeSheet(refocus = true) { D.querySelectorAll('.sheet-wrap, .palette-wrap').forEach((w) => w.remove()); if (refocus && lastFocus && D.contains(lastFocus)) lastFocus.focus(); }
  let toastT;
  function toast(msg, type = 'info') {
    let el = $('.toast'); if (!el) { el = D.createElement('div'); D.body.append(el); }
    el.className = `toast t-${type} enter`; el.setAttribute('role', 'status');
    el.innerHTML = `<span class="toast-ic">${I(type === 'success' ? 'check' : 'info')}</span><span class="toast-msg">${esc(msg)}</span><i class="toast-time" style="animation-duration:3400ms"></i>`;
    clearTimeout(toastT); toastT = setTimeout(() => { el.classList.add('leave'); setTimeout(() => el.remove(), 260); }, 3400);
  }
  function openAll() {
    const p = S.profile, secs = L.sections(p, S.cats), ids = new Set(secs.map((x) => x.id)), { shown, more } = L.menuItems(p, M, S.cats);
    const tools = [...shown, ...more].filter((it) => !ids.has(it.id) && it.id !== 'home' && it.id !== 'search');
    const path = L.route(location.hash).path;
    const tile = (it) => `<a class="all-tile f${isActive(it.href, path) ? ' on' : ''}" href="${href(it.href)}"><span class="all-ic">${I(it.icon)}</span><span class="all-txt"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></a>`;
    openSheet(t('Tout Venus'), `<div class="all-sheet"><div class="all-grid">${secs.map(tile).join('')}</div>${tools.length ? `<h3 class="all-h">${esc(t('Outils'))}</h3><div class="all-tools">${tools.map((it) => tile({ ...it, label: val(it.label), icon: val(it.icon), sub: val(it.hint) || '' })).join('')}</div>` : ''}<button class="opt f more-edit" data-act="classique">${I('folder')}<span><b>${esc(t('Médiathèques et écrans'))}</b><small>${esc(t('Déclarer un dossier, scanner, envoyer des fichiers, écrans, YouTube'))}</small></span></button><a class="opt f more-edit" href="${href('/reglages')}" data-act="setmenu">${I('gear')}${esc(t('Personnaliser le menu'))}</a></div>`);
  }
  const PAL_KIND = { movie: 'Film', show: 'Série', anime: 'Animé', clip: 'Clip', page: 'Page', setting: 'Réglage', action: 'Action' };
  let palSel = 0;
  function openPalette() {
    closeSheet(false); lastFocus = D.activeElement; palSel = 0;
    const wrap = D.createElement('div'); wrap.className = 'palette-wrap'; wrap.setAttribute('role', 'presentation');
    wrap.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="${esc(t('Recherche universelle'))}"><div class="pal-top">${I('search')}<input class="pal-input" id="palq" placeholder="${esc(t('Un film, une série, une page, un réglage…'))}" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-label="${esc(t('Rechercher partout'))}" autocomplete="off" spellcheck="false"><kbd class="pal-esc" aria-hidden="true">${esc(t('Échap'))}</kbd></div><ul class="pal-list" id="pal-list" role="listbox"></ul><div class="pal-help" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> ${esc(t('choisir'))}</span><span><kbd>${esc(t('Entrée'))}</kbd> ${esc(t('ouvrir'))}</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> ${esc(t('ouvrir / fermer'))}</span></div></div>`;
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) closeSheet(); });
    D.body.append(wrap); paintPalette(''); $('#palq').focus();
  }
  function paintPalette(q) {
    const res = L.palette(q, S.items, S.profile, M, S.cats); palSel = Math.max(0, Math.min(palSel, res.length - 1));
    $('#pal-list').innerHTML = res.map((r, i) => `<li id="pal-${i}" role="option" aria-selected="${i === palSel}" class="pal-item${i === palSel ? ' on' : ''}" data-act="palgo" data-v="${i}"><span class="pal-ic">${r.poster ? `<img src="${esc(r.poster)}" alt="" loading="lazy">` : I(r.icon || 'spark')}</span><span class="pal-txt"><b>${esc(r.label)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><span class="pal-kind">${esc(t(PAL_KIND[r.kind] || ''))}</span></li>`).join('');
    $('#palq').setAttribute('aria-activedescendant', `pal-${palSel}`);
    $('#pal-list')._res = res;
  }
  function palGo(r) { closeSheet(false); if (r.act === 'profiles') { go('/qui-regarde'); return; } if (r.tab) S.setTab = r.tab; if (r.q != null) S.searchQ = r.q; go(r.to); }

  // ---------------------------------------------------------------- lecture (le lecteur d'Odin, en attendant celui de Venus)
  async function lire(cibleId, depuisDebut) {
    const LV = W.OdinVenusLecteur; if (!LV) { toast(t('Lecteur indisponible.')); return; }
    const oeuvre = cibleId.split(':').slice(0, 2).join(':');
    let d = null; try { d = await api(`/venus/oeuvre/${encodeURIComponent(oeuvre)}`); } catch { d = null; }
    const c = d ? L.elementLecteur(d, cibleId) : null;
    if (!c) { toast(t('Ce titre n’est pas (ou plus) dans la bibliothèque : relancez un scan.')); return; }
    if (depuisDebut) c.reprise_s = 0;
    LV.ouvrir(c, { surEcran: () => envoyerEcran(c) });
    // À la fermeture du lecteur : la progression a changé, la bibliothèque est relue.
    const obs = new MutationObserver(() => { if (!D.querySelector('.vl')) { obs.disconnect(); charger().then(() => rerender()); } });
    obs.observe(D.body, { childList: true });
  }
  async function envoyerEcran(c) {
    const titre = String(c.titre || '').split(' · ')[0];
    try { const r = await api('/api/valhalla/act', { module: 'freyja', action: 'regarder', input: { quoi: titre, ...(c.saison != null ? { saison: c.saison, episode: c.episode } : {}) } }); toast(String((r && (r.text || r.error)) || t('Envoyé.'))); }
    catch { toast(t('Aucun écran joignable pour le moment.')); }
  }

  // ---------------------------------------------------------------- données
  async function charger() {
    try { const c = await api('/venus/api/catalogue'); S.items = c.titres || []; S.cats = L.comptes(S.items); S.error = ''; }
    catch { S.error = t('Bibliothèque indisponible pour le moment.'); }
    S.loaded = true;
  }
  async function chargerFiche(id) {
    if (S.fiche[id] && !S.fiche[id].vieux) return;
    S.fiche[id] = S.fiche[id] || null;
    try { S.fiche[id] = await api(`/venus/api/titre/${encodeURIComponent(id)}`); } catch { S.fiche[id] = { erreur: true }; }
    if (L.route(location.hash).path === `/titre/${encodeURIComponent(id)}` || L.route(location.hash).path === `/titre/${id}`) rerender();
  }
  const sauverPrefs = () => api('/venus/api/preferences', { planete: T.chosen, auto: T.auto, verre: T.glass, leger: T.lite, ordre: M.order, caches: M.hidden }).catch(() => undefined);
  function appliquerPrefs(p) {
    T.chosen = p.planete && PLANETS[p.planete] ? p.planete : 'venus'; T.auto = p.auto || 'off'; T.glass = p.verre || 'auto'; T.lite = p.leger || 'auto';
    M.order = p.ordre && p.ordre.length ? p.ordre : NAV_ITEMS.map((i) => i.id); M.hidden = p.caches || [...DEFAULT_HIDDEN];
  }
  async function entrerProfil(id) {
    choisirProfil(id);
    S.profile = S.profils.find((p) => p.id === id) || S.profils[0] || S.profile;
    try { appliquerPrefs((await api('/venus/api/preferences')).preferences || {}); } catch { appliquerPrefs({}); }
    S.fiche = {}; await charger();
  }

  // ---------------------------------------------------------------- navigation (adresses du dépôt, avec « # » devant)
  function route() {
    const { path, q } = L.route(location.hash); let m;
    if (!S.loaded) return [PageLoading(), true];
    if (path === '/') return [V.home(), true];
    if (path === '/films') return [V.browse('movie', q.get('vue')), true];
    if (path === '/series') return [V.browse('show', q.get('vue')), true];
    if (path === '/animes') return [V.browse('anime', q.get('vue')), true];
    if (path === '/clips') return [V.browse('clip', q.get('vue')), true];
    if (path === '/liste') return [V.browse('mylist', q.get('vue')), true];
    if ((m = path.match(/^\/titre\/(.+)$/))) { let id = m[1]; try { id = decodeURIComponent(id); } catch { /* tel quel */ } return [V.details(id), true]; }
    if (path === '/recherche') { if (q.get('q') != null) S.searchQ = q.get('q'); return [V.search(), true]; }
    if (path === '/reglages') { if (q.get('tab')) S.setTab = q.get('tab'); return [V.settings(), true]; }
    if (path === '/qui-regarde') return [V.profiles(), false];
    if (path === '/nouveau') { if (q.get('type') && RKINDS.some(([k]) => k === q.get('type'))) S.req.kind = q.get('type'); if (q.get('q') != null) S.req.q = q.get('q'); return [V.request(), true]; }
    if (path === '/nouveautes') { if (q.get('type') && NKINDS.some(([k]) => k === q.get('type'))) S.newKind = q.get('type'); return [V.nouveautes(), true]; }
    if (NAV_ITEMS.some((x) => x.href === path)) return [V.bientot(path), true];
    return [V.home(), true];
  }
  const TITLE_OF = { '/': '', '/films': 'Films', '/series': 'Séries', '/animes': 'Animés', '/clips': 'Clips', '/liste': 'Ma liste', '/recherche': 'Recherche', '/reglages': 'Réglages', '/qui-regarde': 'Qui regarde ?', '/nouveau': 'Nouveau', '/nouveautes': 'Nouveautés' };
  let precedent = '#/', dernierChemin = '';
  function render(keepScroll = false) {
    applyTheme();
    const { path, q } = L.route(location.hash);
    // « /lecture/<cible> » (adresse du dépôt) : le lecteur s'ouvre par-dessus la page d'où l'on vient.
    const ml = path.match(/^\/lecture\/(.+)$/);
    if (ml) { let id = ml[1]; try { id = decodeURIComponent(id); } catch { /* tel quel */ } history.replaceState(null, '', precedent); void lire(id, q.get('debut') === '1'); return render(true); }
    precedent = location.hash || '#/';
    const y = scrollY;
    if (path !== '/nouveau') clearTimeout(S.fileT);
    // Revenir sur « Nouveau » relit la file (et relance sa relecture toutes les 2 s si un téléchargement avance).
    if (path === '/nouveau' && dernierChemin !== '/nouveau') S.file = null;
    dernierChemin = path;
    const [page, withNav] = route();
    $('#app').innerHTML = withNav ? Shell(path, page) : page;
    $('#app').removeAttribute('aria-busy');
    const d = path.startsWith('/titre/') ? S.items.find((x) => `/titre/${encodeURIComponent(x.id)}` === path || `/titre/${x.id}` === path) : null;
    const tt = TITLE_OF[path] != null ? t(TITLE_OF[path]) : (d ? d.title : '');
    D.title = tt ? `${tt} — ${planet().name}` : planet().name;
    if (keepScroll) scrollTo(0, y); else scrollTo(0, 0);
  }
  const rerender = (sel) => { render(true); if (sel) { const el = D.querySelector(sel); if (el) el.focus({ preventScroll: true }); } };
  W.addEventListener('hashchange', () => { closeSheet(false); closeDrop(); render(); const h = $('main h1'); if (h) h.focus({ preventScroll: true }); });
  W.addEventListener('scroll', () => { $('.mobile-top')?.classList.toggle('solid', scrollY > 40); D.documentElement.classList.toggle('scrolled', scrollY > 12); }, { passive: true });
  try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => render(true)); } catch { /* */ }

  // Menus déroulants de Browse.js (tri, filtres)
  function dropdown(anchor, kind, which) {
    closeDrop();
    const f = fOf(kind), items = L.itemsOf(S.items, kind);
    const r = anchor.getBoundingClientRect(), w = Math.min(which === 'filter' ? 560 : 300, innerWidth - 24);
    let html;
    if (which === 'sort') {
      const opts = (kind === 'mylist' ? [['mine', 'Ordre de la liste', ['Ajoutés récemment', 'Ajoutés il y a longtemps']]] : []).concat(SORTS);
      const cur = opts.find((x) => x[0] === f.sort) || opts[0];
      html = `<p class="dd-title">${esc(t('Trier par'))}</p><div class="dd-list">${opts.map(([id, l]) => `<button class="dd-opt f${id === f.sort ? ' on' : ''}" role="menuitemradio" aria-checked="${id === f.sort}" data-act="sortpick" data-kind="${kind}" data-v="${id}">${I(id === f.sort ? 'check' : 'dot')}${esc(t(l))}</button>`).join('')}</div>${cur[0] !== 'random' ? `<div class="dd-seg">${cur[2].map((l, k) => `<button class="seg-b f${(k === 1) === !!f.desc ? ' on' : ''}" data-act="sortdir" data-kind="${kind}" data-v="${k}">${esc(t(l))}</button>`).join('')}</div>` : ''}`;
    } else {
      const decades = [...new Set(items.filter((i) => i.year).map((i) => Math.floor(i.year / 10) * 10))].sort((a, b) => b - a);
      const group = (title, values, field, lab) => (values.length < 1 && !f[field].length ? '' : `<div class="dd-group"><p class="dd-title">${esc(title)}</p><div class="dd-chips">${values.map((v) => { const id = Array.isArray(v) ? v[0] : v; const on = f[field].includes(id); return `<button class="mini f${on ? ' on' : ''}" aria-pressed="${on}" data-act="fchip" data-kind="${kind}" data-k="${field}" data-v="${id}">${esc(Array.isArray(v) ? t(v[1]) : lab(v))}</button>`; }).join('')}</div></div>`);
      const body = `${group(t('Années'), decades, 'decades', (d) => t('Années {d}', { d: String(d).slice(2) }))}${group(t('Qualité'), QUALITY.filter(([, , q]) => items.some(q)), 'quality')}`;
      html = `${body || `<p class="muted">${esc(t('Pas encore de filtre possible : genres, notes et âges arrivent avec les fiches des titres.'))}</p>`}<div class="dd-foot"><button class="btn btn-ghost btn-small f" data-act="freset" data-kind="${kind}">${esc(t('Réinitialiser'))}</button><button class="btn btn-small f" data-act="closedrop">${esc(t('Voir les résultats'))}</button></div>`;
    }
    const d = D.createElement('div');
    d.id = 'drop'; d.className = `dropdown${which === 'filter' ? ' wide' : ''}`; d.setAttribute('role', 'menu'); d.innerHTML = html; d._anchor = anchor;
    Object.assign(d.style, { width: `${w}px`, left: `${Math.max(12, Math.min(innerWidth - w - 12, r.right - w))}px`, top: `${r.bottom + 8}px`, maxHeight: `${Math.max(220, innerHeight - r.bottom - 24)}px` });
    anchor.setAttribute('aria-expanded', 'true');
    D.body.append(d);
    (d.querySelector('.on') || d.querySelector('button'))?.focus({ preventScroll: true });
  }
  function closeDrop() { const d = $('#drop'); if (d) { const a = d._anchor; d.remove(); if (a && D.contains(a)) { a.setAttribute('aria-expanded', 'false'); a.focus({ preventScroll: true }); } } }

  // ---------------------------------------------------------------- actions (clics)
  const sel = (a, v) => `[data-act="${a}"][data-v="${String(v).replace(/"/g, '\\"')}"]`;
  const majTitre = (id, ch) => { const i = S.items.find((x) => x.id === id); if (i) Object.assign(i, ch); };
  D.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) { if ($('#drop') && !e.target.closest('#drop')) closeDrop(); return; }
    const act = el.dataset.act, v = el.dataset.v, kind = el.dataset.kind;
    switch (act) {
      case 'odin': e.preventDefault(); location.href = '/'; break;
      case 'classique': e.preventDefault(); location.href = '/?venus=gestion#app=freyja'; break;
      case 'all': e.preventDefault(); openAll(); break;
      case 'profiles': e.preventDefault(); go('/qui-regarde'); break;
      case 'pickprofile': await entrerProfil(v); toast(t('Bonjour {n}', { n: S.profile.name }), 'success'); go('/'); render(); break;
      case 'palette': e.preventDefault(); openPalette(); break;
      case 'palgo': palGo($('#pal-list')._res[Number(v)]); break;
      case 'rowby': { const sc = el.parentElement.querySelector('.row-scroll'); sc.scrollBy({ left: Number(v) * Math.max(240, sc.clientWidth * 0.82), behavior: 'smooth' }); break; }
      case 'hero': S.heroIdx = (S.heroIdx + Number(v) + 60) % 60; rerender(); break;
      case 'heroto': S.heroIdx = Number(v); rerender(); break;
      case 'status': fOf(kind).status = v; rerender(sel('status', v)); break;
      case 'view': S.libView[kind] = v; rerender(sel('view', v)); break;
      case 'random': { const l = shownOf(kind); if (l.length) { const x = l[Math.floor(Math.random() * l.length)]; go(kind === 'clip' ? lirePath(x.id) : titrePath(x)); } else toast(t('Aucun titre affiché.')); break; }
      case 'sortmenu': if ($('#drop')) closeDrop(); else dropdown(el, kind, 'sort'); break;
      case 'filtermenu': if ($('#drop')) closeDrop(); else dropdown(el, kind, 'filter'); break;
      case 'sortpick': { const f = fOf(kind); f.desc = v !== f.sort ? false : f.desc; f.sort = v; if (v === 'random') f.graine = Date.now(); closeDrop(); rerender('[data-act="sortmenu"]'); break; }
      case 'sortdir': fOf(kind).desc = v === '1'; closeDrop(); rerender('[data-act="sortmenu"]'); break;
      case 'fchip': { const f = fOf(kind), k = el.dataset.k, x = k === 'decades' ? Number(v) : v; f[k] = f[k].includes(x) ? f[k].filter((y) => y !== x) : [...f[k], x]; el.classList.toggle('on'); el.setAttribute('aria-pressed', String(f[k].includes(x))); const dd = $('#drop'); render(true); if (dd) { D.body.append(dd); dd._anchor = $('[data-act="filtermenu"]'); } break; }
      case 'freset': Object.assign(fOf(kind), { decades: [], quality: [] }); closeDrop(); rerender('[data-act="filtermenu"]'); break;
      case 'closedrop': closeDrop(); break;
      case 'unfilter': { const f = fOf(kind), k = el.dataset.k; f[k] = f[k].filter((x) => String(x) !== v); rerender('[data-act="filtermenu"]'); break; }
      case 'resetf': Object.assign(fOf(kind), { decades: [], quality: [] }); rerender(); break;
      case 'resetall': Object.assign(fOf(kind), { decades: [], quality: [], status: 'all' }); rerender(); break;
      case 'mylist': { const i = S.items.find((x) => x.id === v), on = !!(i && i.inList); try { await api('/venus/ma-liste', { oeuvre_id: v, ...(on ? { faire: 'retirer' } : {}) }); majTitre(v, { inList: !on }); if (S.fiche[v] && S.fiche[v].titre) S.fiche[v].titre.inList = !on; toast(on ? t('Retiré de ma liste') : t('Ajouté à ma liste'), on ? 'info' : 'success'); } catch { toast(t('Impossible pour le moment.')); } rerender(sel('mylist', v)); break; }
      case 'seen': case 'epseen': {
        e.preventDefault(); const on = el.dataset.on === '1', dur = Number(el.dataset.d) || 0;
        if (!dur && !on) { toast(t('Durée inconnue : lisez le titre une fois pour le marquer.')); break; }
        try { await api('/venus/reprise', { cible: v, position_s: on ? 0 : dur, duree_s: dur, type: 'video' }); } catch { toast(t('Impossible pour le moment.')); break; }
        await charger(); const id = L.route(location.hash).path.replace(/^\/titre\//, ''); let oid = id; try { oid = decodeURIComponent(id); } catch { /* */ } if (S.fiche[oid]) S.fiche[oid].vieux = true; await chargerFiche(oid);
        toast(on ? t('Marqué non vu') : t('Marqué vu'), 'success'); rerender(sel(act, v)); break;
      }
      case 'season': S.season = Number(v); rerender(sel('season', v)); break;
      case 'epf': S.epFilter = v; rerender(sel('epf', v)); break;
      case 'sendto': void envoyerEcran({ titre: (S.items.find((x) => v.startsWith(x.id)) || {}).title || '', ...(() => { const m = /:s(\d+)e(\d+)$/.exec(v); return m ? { saison: Number(m[1]), episode: Number(m[2]) } : {}; })() }); break;
      case 'about': case 'tech': {
        const f = S.fiche[v]; if (!f) break; const d = f.titre, te = f.tech || {};
        const taille = te.taille ? (te.taille >= 1024 ** 3 ? t('{n} Go', { n: new Intl.NumberFormat(LANG, { maximumFractionDigits: 1 }).format(te.taille / 1024 ** 3) }) : t('{n} Mo', { n: nombre(Math.round(te.taille / 1024 ** 2)) })) : '';
        if (act === 'about') openSheet(t('À propos'), `<div class="about-sheet"><dl class="info-list">${d.year ? `<dt>${esc(t('Sortie'))}</dt><dd>${esc(String(d.year))}</dd>` : ''}<dt>${esc(t('Bibliothèque'))}</dt><dd>${esc(t(TITLES[d.category]))}</dd><dt>${esc(t('Ajouté'))}</dt><dd>${esc(date(d.added, { day: 'numeric', month: 'long', year: 'numeric' }))}</dd>${te.fichier ? `<dt>${esc(t('Fichier'))}</dt><dd><span class="prov-file loc"><code>${esc(te.fichier)}</code><button class="btn btn-small btn-ghost f" data-act="copy" data-v="${esc(te.fichier)}">${I('copy')}${esc(t('Copier'))}</button></span></dd>` : ''}</dl></div>`);
        else openSheet(d.type === 'show' ? t('Fiche technique (premier épisode)') : t('Fiche technique'), `<div class="about-sheet"><dl class="info-list"><dt>${esc(t('Vidéo'))}</dt><dd>${esc([te.largeur && te.hauteur ? `${te.largeur}×${te.hauteur}` : '', ...(te.video || [])].filter(Boolean).join(' · ') || '—')}</dd><dt>${esc(t('Audio'))}</dt><dd>${esc((te.audio || []).join(' · ') || '—')}</dd><dt>${esc(t('Sous-titres'))}</dt><dd>${(f.sousTitres || []).length ? `<ul class="track-list">${f.sousTitres.map((x) => `<li>${esc([x.langue || t('langue inconnue'), x.titre, x.aPart ? t('fichier à part') : ''].filter(Boolean).join(' · '))}</li>`).join('')}</ul>` : '—'}</dd><dt>${esc(t('Fichier'))}</dt><dd>${esc([String(te.fichier || '').split(/[\\/]/).pop(), taille].filter(Boolean).join(' · '))}</dd></dl></div>`);
        break;
      }
      case 'copy': try { await navigator.clipboard.writeText(v); toast(t('Chemin copié'), 'success'); } catch { toast(t('Copie impossible ici.')); } break;
      case 'closesheet': closeSheet(); break;
      case 'sq': S.searchQ = v; rerender('#srch'); break;
      case 'skind': S.searchKind = v; rerender(sel('skind', v)); break;
      case 'settab': S.setTab = v; rerender(sel('settab', v)); break;
      case 'setmenu': S.setTab = 'affichage'; break;
      case 'planet': {
        T.chosen = v; const tp = PLANETS[v];
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2, R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)); const w = D.createElement('div'); w.className = 'planet-warp'; Object.assign(w.style, { left: `${x}px`, top: `${y}px`, width: `${R * 2}px`, height: `${R * 2}px`, marginLeft: `${-R}px`, marginTop: `${-R}px`, background: tp.glass ? 'radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(200,215,240,.7) 30%, transparent 70%)' : `radial-gradient(circle, ${tp.accent} 0%, ${tp.accent2} 22%, ${tp.night} 58%, transparent 70%)` }); D.body.append(w); setTimeout(() => w.remove(), 1300); }
        toast(tp.glass ? t('Thème Verre : clair le jour, sombre la nuit') : t('Bienvenue sur {p}', { p: tp.name }), 'success'); void sauverPrefs(); rerender(`[data-id="${v}"]`); break;
      }
      case 'autotheme': T.auto = v; void sauverPrefs(); rerender(sel('autotheme', v)); break;
      case 'glassmode': T.glass = v; void sauverPrefs(); rerender(sel('glassmode', v)); break;
      case 'lite': T.lite = v; void sauverPrefs(); rerender(sel('lite', v)); break;
      case 'mmove': M.order = L.deplacer(M.order, v, Number(el.dataset.d)); void sauverPrefs(); rerender(`[data-act="mmove"][data-v="${v}"][data-d="${el.dataset.d}"]`); break;
      // ---- demandes et téléchargements
      case 'godemandes': e.preventDefault(); S.setTab = 'demandes'; go('/reglages?tab=demandes'); break;
      case 'upfilter': S.upFilter[kind] = v; rerender(sel('upfilter', v)); break;
      case 'upearlier': S.upEarlier[kind] = true; rerender(); break;
      case 'upopen': go(`/titre/${encodeURIComponent(v)}`); break;
      case 'upsheet': { const x = S.reg[Number(el.dataset.i)]; if (x) upSheet(x, el.dataset.k || 'movie'); break; }
      case 'newkind': S.newKind = v; history.replaceState(null, '', `#/nouveautes?type=${v}`); rerender(sel('newkind', v)); break;
      case 'newpick': { const st = S.nouv[el.dataset.k], y = st && st.data ? (st.data.sections || []).flatMap((s) => s.items).find((z) => z.key === v) : null; if (!y) break; if (S.newCur[el.dataset.k] === v && y.inLibrary) { go(`/titre/${encodeURIComponent(y.inLibrary)}`); break; } S.newCur[el.dataset.k] = v; rerender(sel('newpick', v)); scrollTo(0, 0); break; }
      case 'fav': {
        const x = S.reg[Number(el.dataset.i)]; if (!x) break; const on = S.favs.has(x.key), kb = `fav|${x.key}`; if (S.busy.has(kb)) break; S.busy.add(kb);
        try {
          const r = await envoyer(L.envie(x, on));
          if (r.ok === false) toast(premiere(r));
          else if (on) { S.favs.delete(x.key); toast(t('« {t} » retiré de vos favoris', { t: nomDe(x) })); }
          else { S.favs.add(x.key); const et = r.data && r.data.demande && r.data.demande.etat; if (et === 'en téléchargement') S.pris.add(cleSortie(x)); toast(et === 'à valider' ? premiere(r) : et === 'en téléchargement' ? t('« {t} » en favori : le téléchargement est lancé', { t: nomDe(x) }) : t('« {t} » ajouté à vos favoris · {d}', { t: nomDe(x), d: premiere(r) }), 'success'); }
          S.envies = null;
        } catch { toast(t('Impossible pour le moment.')); }
        S.busy.delete(kb); closeSheet(false); rerender(); break;
      }
      case 'grab': case 'newreq': {
        const x = S.reg[Number(el.dataset.i)]; if (!x) break; const k = act === 'newreq' ? `nv|${x.key}` : cleSortie(x); if (S.busy.has(k)) break;
        S.busy.add(k); closeSheet(false); rerender();
        try {
          const r = await envoyer(L.obtenir(x)), et = r.data && r.data.demande && r.data.demande.etat;
          if (r.ok === false) toast(premiere(r));
          else { S.pris.add(k); S.file = null; S.envies = null; toast(et === 'en téléchargement' ? t('« {t} » ajouté à {a} : le téléchargement est lancé', { t: nomDe(x), a: appDe(x.kind === 'movie' || x.type === 'movie' ? 'movie' : 'show') }) : premiere(r), et === 'en téléchargement' ? 'success' : 'info'); }
        } catch { toast(t('Impossible pour le moment.')); }
        S.busy.delete(k); rerender(); break;
      }
      case 'wishrm': try { const r = await agir('hnoss_envie', { titre: el.dataset.t || '', cle: v, retirer: true }); toast(r.ok === false ? premiere(r) : t('Retiré de mes envies')); const w = (S.envies || []).find((y) => y.cle === v || y.id === v); if (w && w.cle) S.favs.delete(w.cle); S.envies = null; } catch { toast(t('Impossible pour le moment.')); } rerender(); break;
      case 'reqkind': S.req.kind = v; rerender(sel('reqkind', v)); break;
      case 'reqadd': {
        const q = S.req.q.trim(), m = /^(.*?)\s*\((\d{4})\)$/.exec(q), kd = S.req.kind, cat = kd === 'movie' ? 'movie' : kd === 'anime' ? 'anime' : 'show';
        const rr = S.req.res && S.req.res.cle === `${cat}|${q}` && S.req.res.data.source ? (S.req.res.data.items || [])[Number(v)] : null;
        const titre = rr ? rr.title : m ? m[1] : q, an = rr ? rr.year : m ? Number(m[2]) : 0; if (String(titre).length < 2) break;
        const k = `req|${cat}|${norm(titre)}|${an || ''}`; if (S.busy.has(k) || S.pris.has(k)) break;
        S.busy.add(k); rerender();
        try { const r = await envoyer(L.obtenir({ title: titre, kind: cat, ...(an ? { year: an } : {}) })); if (r.ok === false) toast(premiere(r)); else { S.pris.add(k); const et = r.data && r.data.demande && r.data.demande.etat; toast(et === 'en téléchargement' ? t('« {t} » ajouté : le téléchargement commence', { t: titre }) : premiere(r), et === 'en téléchargement' ? 'success' : 'info'); } } catch { toast(t('Impossible pour le moment.')); }
        S.busy.delete(k); S.demandes = null; rerender(); void chargerFile(); break;
      }
      case 'qpause': case 'qresume': case 'qcancel': case 'qremove': case 'qaccept': case 'qdrop': {
        const a = { qpause: 'comete_pause', qresume: 'comete_reprendre', qcancel: 'comete_annuler', qremove: 'comete_retirer', qaccept: 'comete_accepter', qdrop: 'comete_jeter' }[act];
        // « Accepter » un fichier dont l'antivirus doute : action grave, le clic est la confirmation.
        try { const r = await agir(a, { id: v }, act === 'qaccept'); toast(premiere(r), r.ok === false ? 'info' : 'success'); } catch { toast(t('Impossible pour le moment.')); }
        await chargerFile(); break;
      }
      case 'suivisave': {
        const r = await agir('suivi_regler', { applicatif: v, qualite: champ(`q-${v}`), dossier: champ(`d-${v}`), langue: champ(`l-${v}`), ...(v === 'pleiades' ? { dossier_animes: champ(`da-${v}`) } : {}) }).catch(() => null);
        toast(premiere(r), r && r.ok !== false ? 'success' : 'info'); S.dem = null; rerender(); break;
      }
      case 'cometesave': { const r = await agir('comete_regler', { simultanes: champ('c-sim'), taille_max_go: champ('c-taille'), debit_mo: champ('c-debit') }).catch(() => null); toast(premiere(r), r && r.ok !== false ? 'success' : 'info'); S.dem = null; rerender(); break; }
      case 'srcadd': {
        const r = await agir('delta_ajouter', { nom: champ('s-nom') || '', type: champ('s-type') || 'torznab', adresse: champ('s-adr') || '', cle: champ('s-cle') || '' }).catch(() => null);
        const ce = $('#s-cle'); if (ce) ce.value = ''; // la clé ne reste pas dans la page
        toast(premiere(r), r && r.ok !== false ? 'success' : 'info'); if (r && r.ok !== false) S.dem = null; rerender(); break;
      }
      case 'srctest': { const r = await agir('delta_tester', { id: v }).catch(() => null); toast(premiere(r), r && r.ok !== false ? 'success' : 'info'); S.dem = null; rerender(); break; }
      case 'srcdel': { const r = await agir('delta_retirer', { id: v }).catch(() => null); toast(premiere(r)); S.dem = null; rerender(); break; }
      case 'catsave': case 'catforget': {
        const r = await agir('catalogue_regler', act === 'catforget' ? { oublier_cle: true } : { series: champ('cat-series'), animes: champ('cat-animes'), films: champ('cat-films'), cle: champ('cat-cle') || '' }).catch(() => null);
        const ce = $('#cat-cle'); if (ce) ce.value = '';
        toast(premiere(r), r && r.ok !== false ? 'success' : 'info'); S.dem = null; S.up = {}; S.nouv = {}; rerender(); break;
      }
      case 'hvalider': case 'hrefuser': { const kb = `h|${v}`; if (S.busy.has(kb)) break; S.busy.add(kb); const r = await agir(act === 'hvalider' ? 'hnoss_valider' : 'hnoss_refuser', { demande: v }, act === 'hvalider').catch(() => null); S.busy.delete(kb); toast(premiere(r), r && r.ok !== false ? 'success' : 'info'); S.dem = null; S.file = null; rerender(); break; }
      case 'epgrab': { const k = `ep|${v}|${el.dataset.s}|${el.dataset.e}`; if (S.busy.has(k) || S.pris.has(k)) break; S.busy.add(k); try { const r = await envoyer(L.obtenir({ title: el.dataset.t, kind: 'show', season: Number(el.dataset.s), episode: Number(el.dataset.e) })); toast(premiere(r)); if (r.ok !== false) S.pris.add(k); } catch { toast(t('Impossible pour le moment.')); } S.busy.delete(k); rerender(); break; }
      case 'mreset': M.order = NAV_ITEMS.map((i) => i.id); M.hidden = [...DEFAULT_HIDDEN]; void sauverPrefs(); toast(t('Menu d’origine rétabli')); rerender(); break;
      default: break;
    }
  });
  D.addEventListener('change', async (e) => {
    const hl = e.target.closest('[data-act="hlibre"]');
    if (hl && S.dem) {
      const l = L.libres(S.dem.libres, hl.dataset.v, hl.value === 'libre');
      try { const r = await agir('hnoss_regler_libres', { libres: l.join(',') }); S.dem.libres = (r.data && r.data.libres) || l; toast(premiere(r), r.ok === false ? 'info' : 'success'); } catch { toast(t('Impossible pour le moment.')); }
      return;
    }
    const el = e.target.closest('[data-act="mtoggle"]'); if (!el) return;
    const id = el.dataset.v; M.hidden = el.checked ? M.hidden.filter((x) => x !== id) : [...M.hidden, id];
    void sauverPrefs(); rerender(`[data-act="mtoggle"][data-v="${id}"]`);
  });
  D.addEventListener('input', (e) => {
    const tg = e.target;
    if (tg.id === 'srch') { S.searchQ = tg.value; const p = tg.selectionStart; render(true); const i = $('#srch'); i.focus(); i.setSelectionRange(p, p); }
    if (tg.id === 'palq') { palSel = 0; paintPalette(tg.value); }
    if (tg.id === 'reqq') { S.req.q = tg.value; const p = tg.selectionStart; render(true); const i = $('#reqq'); if (i) { i.focus(); i.setSelectionRange(p, p); } }
  });
  D.addEventListener('keydown', (e) => {
    if (D.querySelector('.vl')) return; // le lecteur a son propre clavier
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if ($('.palette-wrap')) closeSheet(); else openPalette(); return; }
    if ($('.palette-wrap') && e.target.id === 'palq') {
      const res = $('#pal-list')._res || [];
      if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(res.length - 1, palSel + 1); paintPalette(e.target.value); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); paintPalette(e.target.value); return; }
      if (e.key === 'Enter') { e.preventDefault(); if (res[palSel]) palGo(res[palSel]); return; }
    }
    if (e.key === 'Escape') {
      if ($('#drop')) { closeDrop(); return; }
      if (D.querySelector('.sheet-wrap, .palette-wrap')) { e.preventDefault(); closeSheet(); return; }
    }
    if (e.key === 'Tab' && D.querySelector('.sheet-wrap, .palette-wrap')) {
      const box = D.querySelector('.sheet-wrap .sheet, .palette');
      const f = [...box.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex="0"]')];
      if (f.length) { if (e.shiftKey && D.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && D.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); } }
    }
  });
  D.addEventListener('pointerdown', (e) => { const d = $('#drop'); if (d && !d.contains(e.target) && !(d._anchor && d._anchor.contains(e.target))) closeDrop(); }, true);

  // ---------------------------------------------------------------- démarrage
  (async () => {
    if (matchMedia('(pointer: coarse)').matches) D.documentElement.classList.add('touch');
    if (!location.hash) history.replaceState(null, '', '#/');
    applyTheme(); render();
    let choisi = '';
    try { const r = await api('/venus/api/profils'); S.profils = r.profils || []; choisi = r.choisi ? r.actuel : ''; } catch { S.profils = []; }
    const connu = S.profils.find((p) => p.id === choisi);
    await entrerProfil(connu ? connu.id : (S.profils[0] ? S.profils[0].id : 'moi'));
    // Plusieurs comptes et aucun choisi sur cet appareil : « Qui regarde ? » d'abord (Gates.js).
    if (!connu && S.profils.length > 1) { go('/qui-regarde'); }
    render();
  })();
})();
