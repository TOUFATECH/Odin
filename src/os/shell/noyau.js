// Odin OS — noyau du bureau : outils d'affichage, icônes, mascotte, thèmes, état et appels à Odin.
// JavaScript simple, sans dépendance : chargé tel quel par le navigateur ou par la vue du système.
(() => {
  'use strict';
  const OS = window.OS = { version: '0.1.0', applis: {}, ecouteurs: {} };

  // ——— Affichage ———
  const SVG = new Set(['svg', 'path', 'circle', 'rect', 'g', 'defs', 'linearGradient', 'radialGradient', 'stop']);
  /** Crée un élément : h('button', { class: 'bouton', onclick: f, 'aria-label': 'Fermer' }, 'texte', enfant…).
   *  Un texte passé en enfant n'est jamais interprété comme du HTML. */
  OS.h = (tag, attrs, ...enfants) => {
    const e = SVG.has(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    const ajouter = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(ajouter); else e.append(c.nodeType ? c : document.createTextNode(String(c))); };
    enfants.forEach(ajouter);
    return e;
  };
  const h = OS.h;
  OS.vider = (e) => { while (e.firstChild) e.firstChild.remove(); return e; };
  /** Ajoute des enfants à un élément. Comme h() : les tableaux sont aplatis, null et false sont ignorés, un texte reste un texte. */
  OS.ajouter = (e, ...enfants) => { const f = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(f); else e.appendChild(c.nodeType ? c : document.createTextNode(String(c))); }; enfants.forEach(f); return e; };
  /** Remplace le contenu d'un élément (mêmes règles que OS.ajouter). */
  OS.poser = (e, ...enfants) => OS.ajouter(OS.vider(e), ...enfants);

  // Icônes au trait (grille 24 × 24), dessinées pour Odin OS.
  const ICONES = OS.ICONES = {
    dossier: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    reglages: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
    terminal: 'M3 5h18v14H3zM7 10l3 2-3 2M12 15h5',
    store: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
    bouclier: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    protege: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
    loupe: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4',
    wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19h.01',
    son: 'M4 9h4l5-4v14l-5-4H4zM17 9a4 4 0 0 1 0 6',
    arret: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
    maison: 'M3 11l9-7 9 7v9h-6v-5H9v5H3z',
    document: 'M7 3h7l4 4v14H7z',
    image: 'M3 5h18v14H3zM7 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0M21 16l-5-5-9 8',
    musique: 'M9 18V5l11-2v13M6 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM17 13a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
    video: 'M3 6h18v12H3zM10 9l5 3-5 3z',
    telecharger: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    corbeille: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    grille: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    plus: 'M12 5v14M5 12h14', coche: 'M5 12l4 4 10-10', croix: 'M6 6l12 12M18 6L6 18',
    alerte: 'M12 8v5M12 16h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    maj: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
    lune: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    soleil: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    cadenas: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
    ecran: 'M4 5h16v10H4zM8 19h8', telephone: 'M7 2h10v20H7zM11 18h2',
    gauche: 'M15 5l-7 7 7 7', droite: 'M9 5l7 7-7 7', haut: 'M6 15l6-6 6 6', bas: 'M6 9l6 6 6-6',
    liste: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    envoyer: 'M4 12l16-8-6 16-3-7z',
    cube: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
    info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7h.01',
    utilisateur: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM4 21c0-4.5 3.5-7 8-7s8 2.5 8 7',
    palette: 'M4 20l4-1 11-11-3-3L5 16z',
    puce: 'M6 6h12v12H6zM9 9h6v6H9zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3',
    cloche: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
    controle: 'M4 7h16M4 17h16M9 4v6M15 14v6',
    fenetre: 'M4 4h16v16H4zM4 8h16',
    paquet: 'M12 3l8 5v8l-8 5-8-5V8zM12 12l8-4M12 12v9M12 12L4 8',
    lien: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    horloge: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2',
    etoile: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
    odin: 'M12 2l8.66 5v10L12 22l-8.66-5V7z',
  };
  /** Une icône au trait. `plein: true` la remplit. */
  OS.icone = (nom, taille = 20, o = {}) => h('svg', { class: 'ic', width: taille, height: taille, viewBox: '0 0 24 24', fill: o.plein ? 'currentColor' : 'none', stroke: o.plein ? 'none' : 'currentColor', 'stroke-width': o.trait || 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, h('path', { d: ICONES[nom] || ICONES.fenetre }));
  /** Le logo d'Odin OS (hexagone). */
  OS.logo = (taille = 18) => h('svg', { class: 'ic logo-odin', width: taille, height: taille, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: ICONES.odin }), h('circle', { cx: 12, cy: 12, r: 4, fill: 'none', stroke: 'rgba(0,0,0,.55)', 'stroke-width': 2.3 }));

  /** La mascotte : le même visage qu'Odin. `decor: true` la cache aux lecteurs d'écran. */
  OS.mascotte = (taille, o = {}) => {
    const s = h('span', { class: 'odin', style: taille ? { width: `${taille}px`, height: `${taille}px` } : null, role: o.decor ? null : 'img', 'aria-label': o.decor ? null : 'Odin', 'aria-hidden': o.decor ? 'true' : null });
    s.append(document.getElementById('gabarit-mascotte').content.cloneNode(true));
    // Chaque visage garde ses propres dégradés (identifiants uniques), sinon tous changeraient d'humeur ensemble.
    try { window.OdinFace && window.OdinFace.own(s.querySelector('svg')); } catch { /* visage simple */ }
    return s;
  };
  /** Change l'humeur de la mascotte partout (joie, reflexion, surprise…), pour `ms` millisecondes ou jusqu'à nouvel ordre. */
  OS.humeur = (nom, ms) => { const F = window.OdinFace; if (!F) return; try { document.querySelectorAll('.odin').forEach((e) => (ms ? F.flash(e, nom, ms) : F.set(e, nom))); } catch { /* humeur inconnue : visage neutre */ } };

  /** Une tuile d'appli : dégradé + icône au trait, image ou initiale. `libre` : la taille vient du style (dock, lanceur). */
  OS.tuile = (appli, taille = 46, libre = false) => {
    const [a, b] = appli.couleur || ['#8FA0AE', '#526578'];
    const t = h('span', { class: 'tuile', style: { background: appli.image ? 'none' : `linear-gradient(150deg, ${a}, ${b})`, color: appli.encre || '#fff', ...(libre ? {} : { width: `${taille}px`, height: `${taille}px`, fontSize: `${Math.round(taille * 0.46)}px` }) }, 'aria-hidden': 'true' });
    if (appli.image) t.append(h('img', { src: appli.image, alt: '', style: { width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' } }));
    else t.append(appli.icone ? OS.icone(appli.icone, Math.round(taille * 0.5)) : (appli.nom || '?').charAt(0).toUpperCase());
    return t;
  };

  // ——— Événements internes ———
  OS.sur = (evt, f) => { (OS.ecouteurs[evt] ||= []).push(f); return () => { OS.ecouteurs[evt] = OS.ecouteurs[evt].filter((x) => x !== f); }; };
  OS.emettre = (evt, d) => { for (const f of OS.ecouteurs[evt] || []) { try { f(d); } catch (e) { console.error(e); } } };

  // ——— Formats ———
  OS.taille = (o) => { if (o == null || isNaN(o)) return '—'; const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0; while (o >= 1024 && i < u.length - 1) { o /= 1024; i++; } return `${o < 10 && i ? o.toFixed(1).replace('.', ',') : Math.round(o)} ${u[i]}`; };
  OS.quand = (ms) => { if (!ms) return '—'; const d = new Date(ms), auj = new Date(); const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); if (d.toDateString() === auj.toDateString()) return `Aujourd'hui à ${hm}`; const hier = new Date(auj); hier.setDate(auj.getDate() - 1); if (d.toDateString() === hier.toDateString()) return `Hier à ${hm}`; return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); };
  OS.heure = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  OS.jour = (long) => new Date().toLocaleDateString('fr-FR', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
  OS.sansAccent = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // ——— Thèmes ———
  // Chaque thème change la disposition (barre, dock, lanceur), le style des fenêtres et le fond d'écran.
  OS.themes = {
    odin: { nom: 'Odin', resume: 'Le style maison', apparence: 'sombre', accent: '#E3AC3F', encre: '#14100A', fonds: ['anneaux', 'aurore'], apercu: 'radial-gradient(circle at 50% 45%, #2A3E55, #101A24)' },
    verre: { nom: 'Verre', resume: 'Disposition façon Mac', apparence: 'clair', accent: '#1E7BF2', encre: '#fff', fonds: ['vague', 'lagon'], apercu: 'linear-gradient(170deg, #C9D6EA 30%, #3C9DEB 60%, #0F55CC)' },
    fenetres: { nom: 'Fenêtres', resume: 'Disposition façon Windows', apparence: 'sombre', accent: '#4CC2FF', encre: '#06131F', fonds: ['fleur'], apercu: 'radial-gradient(circle at 65% 45%, #1F4DFF, #07102E 70%)' },
    libre: { nom: 'Libre', resume: 'Disposition façon Linux', apparence: 'sombre', accent: '#5EEAFF', encre: '#06202A', fonds: ['crepuscule'], apercu: 'linear-gradient(180deg, #0B1640, #7A4C9E 60%, #E58BB5 70%, #161735)' },
    neon: { nom: 'Néon', resume: 'Linux, variante néon', apparence: 'sombre', accent: '#22D3EE', encre: '#04141A', fonds: ['neon'], apercu: 'linear-gradient(135deg, #0B0E24, #3B1D6E 60%, #DB2777)' },
  };
  OS.ACCENTS = [['Bleu', '#2563EB', '#fff'], ['Vert', '#10B981', '#04130D'], ['Rouge', '#E11D48', '#fff'], ['Violet', '#7C3AED', '#fff'], ['Cyan', '#06B6D4', '#03181D'], ['Rose', '#EC4899', '#fff'], ['Or', '#E3AC3F', '#14100A']];

  // ——— État du bureau (thème, applis installées, épingles…) ———
  const DEFAUT = { theme: 'odin', fond: '', apparence: 'auto', accent: '', mobile: 'odin', applis: ['ullr', 'skogul', 'forseti', 'saga', 'sindri'], epingles: ['fichiers', 'store', 'terminal', 'reglages', 'odin:ullr'], accueilFait: false, concentration: false, assistantEnLigne: true };
  OS.etat = JSON.parse(JSON.stringify(DEFAUT));
  OS.DEFAUT = DEFAUT;
  /** Applique le thème courant : disposition, couleurs, fond d'écran. */
  // Sur téléphone, le style d'accueil (Odin, Lavande, Verre) remplace le thème du bureau.
  const STYLES_MOBILE = { odin: { apparence: 'sombre', accent: '#E3AC3F', encre: '#14100A', fond: 'anneaux' }, lavande: { apparence: 'clair', accent: '#6D28D9', encre: '#fff', fond: 'lavande' }, verre: { apparence: 'clair', accent: '#1E7BF2', encre: '#fff', fond: 'lagon' } };
  OS.appliquerTheme = () => {
    const e = OS.etat, b = document.body, mobile = b.dataset.ecran === 'mobile';
    const t = mobile ? (STYLES_MOBILE[e.mobile] || STYLES_MOBILE.odin) : (OS.themes[e.theme] || OS.themes.odin);
    b.dataset.theme = mobile || !OS.themes[e.theme] ? 'odin' : e.theme;
    b.dataset.apparence = e.apparence === 'clair' || e.apparence === 'sombre' ? e.apparence : t.apparence;
    b.dataset.mobile = STYLES_MOBILE[e.mobile] ? e.mobile : 'odin';
    const acc = OS.ACCENTS.find((a) => a[1] === e.accent);
    b.style.setProperty('--accent', acc ? acc[1] : t.accent); b.style.setProperty('--accent-texte', acc ? acc[2] : t.encre);
    const fond = document.getElementById('fond');
    // Fond d'écran : celui choisi dans Réglages, sinon celui du thème ; sur téléphone, celui du style d'accueil.
    if (fond && OS.fonds) { const nom = mobile ? t.fond : OS.fonds[e.fond] ? e.fond : t.fonds[0]; if (fond.dataset.nom !== nom) { fond.dataset.nom = nom; fond.innerHTML = OS.fonds[nom](); } }
    OS.emettre('theme', e.theme);
  };
  /** Modifie l'état, l'applique et l'enregistre. */
  /** Change des réglages, les applique et les enregistre. Renvoie la promesse de l'enregistrement (pour qui doit l'attendre). */
  OS.regler = (patch) => { Object.assign(OS.etat, patch); OS.appliquerTheme(); const enregistre = OS.api.sauver(patch); OS.emettre('etat', patch); return enregistre; };

  // ——— Appels à Odin ———
  // Deux modes : « reel » (Odin répond : fichiers, applis, antivirus, assistant sont les vrais) ou « essai »
  // (aucun Odin joignable : données d'exemple, clairement signalées, rien n'est modifié sur la machine).
  const api = OS.api = { mode: 'essai', systeme: null };
  async function appel(methode, chemin, corps) {
    const r = await fetch(chemin, { method: methode, credentials: 'same-origin', headers: { 'x-odin': '1', 'x-odin-os': '1', ...(corps ? { 'content-type': 'application/json' } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
    let j = null; try { j = await r.json(); } catch { /* réponse vide */ }
    if (r.status === 401) { const e = new Error('connexion requise'); e.code = 401; e.info = j || {}; throw e; }
    if (!r.ok && !(j && typeof j === 'object' && 'ok' in j)) throw new Error((j && j.error) || `Erreur ${r.status}`);
    return j;
  }
  api.lire = (c) => appel('GET', c);
  api.envoyer = (c, b) => appel('POST', c, b || {});
  /** Cherche Odin. Renvoie 'reel', 'essai', 'connexion' (compte existant) ou 'creation' (premier démarrage). */
  api.demarrer = async () => {
    if (location.protocol === 'file:' || new URLSearchParams(location.search).has('essai')) return (api.mode = 'essai');
    try { const s = await appel('GET', '/api/os/systeme'); if (s && s.ok) { api.mode = 'reel'; api.systeme = s; return 'reel'; } }
    catch (e) {
      if (e.code === 401) {
        api.mode = 'reel';
        // Pas encore connecté : on sait au moins où tourne Odin OS (pour l'écran d'accueil).
        try { const r = await fetch('/os/ici.json', { cache: 'no-store' }); if (r.ok) api.systeme = await r.json(); } catch (_) { /* tant pis : l'accueil s'en passe */ }
        return e.info.account === false ? 'creation' : 'connexion';
      }
    }
    return (api.mode = 'essai');
  };
  const reel = () => api.mode === 'reel';
  const q = encodeURIComponent;
  api.etat = () => (reel() ? api.lire('/api/os/etat') : OS.essai.etat());
  api.sauver = (patch) => (reel() ? api.envoyer('/api/os/etat', { patch }).catch(() => {}) : OS.essai.sauver(patch));
  api.infos = () => (reel() ? api.lire('/api/os/systeme') : OS.essai.systeme());
  api.fichiers = (chemin) => (reel() ? api.lire(`/api/os/fichiers?chemin=${q(chemin)}`) : OS.essai.fichiers(chemin));
  api.fichier = (chemin) => (reel() ? api.lire(`/api/os/fichier?chemin=${q(chemin)}`) : OS.essai.fichier(chemin));
  api.operation = (action, d) => (reel() ? api.envoyer('/api/os/fichiers', { action, ...d }) : OS.essai.operation(action, d));
  api.terminal = (commande, dossier, confirme) => (reel() ? api.envoyer('/api/os/terminal', { commande, dossier, confirm: confirme === true }) : OS.essai.terminal(commande, dossier));
  api.paquets = (action, nom) => (reel() ? api.envoyer('/api/os/paquets', { action, nom }) : OS.essai.paquets(action, nom));
  api.catalogue = () => (reel() ? api.lire('/api/valhalla/catalog') : OS.essai.catalogue());
  api.vue = (id) => (reel() ? api.lire(`/api/valhalla/view?id=${q(id)}`) : OS.essai.vue(id));
  api.agir = (module, action, input, confirm) => (reel() ? api.envoyer('/api/valhalla/act', { module, action, input: input || {}, confirm: confirm === true }) : OS.essai.agir(module, action, input));
  api.ordre = (texte, confirme) => (reel() ? api.envoyer('/api/valhalla/order', { text: texte, session: 'odin-os', confirm: confirme === true }) : OS.essai.ordre(texte));
  api.message = (texte) => api.envoyer('/api/message', { text: texte, peer: 'odin-os', where: 'Odin OS' });
  /** Écoute les réponses d'Odin (flux). `f({ texte })` à chaque réponse, `f({ morceau })` pendant qu'il écrit. */
  api.flux = (f) => {
    if (!reel() || !window.EventSource) return () => {};
    let es, arret = false;
    const ouvrir = () => {
      es = new EventSource('/api/stream');
      es.onmessage = (ev) => { let d; try { d = JSON.parse(ev.data); } catch { return; } if (d.peer !== 'odin-os') return; if (d.type === 'message') f({ texte: String(d.text || '').replace(/\[humeur:[^\]]*\]/g, '').trim() }); else if (d.type === 'event' && d.event && d.event.type === 'delta') f({ morceau: d.event.text }); else if (d.type === 'event' && d.event && d.event.type === 'mood') OS.humeur(d.event.mood); };
      es.onerror = () => { es.close(); if (!arret) setTimeout(ouvrir, 4000); };
    };
    ouvrir();
    return () => { arret = true; es && es.close(); };
  };

  // ——— Applis d'Odin (Valhalla) : couleurs par famille ———
  OS.FAMILLES = { 'Sécurité': ['#FB7185', '#BE123C'], 'Données': ['#60A5FA', '#1D4ED8'], 'Machines': ['#34D399', '#047857'], 'Maison': ['#C4B5FD', '#6D28D9'], 'Accès': ['#67E8F9', '#0E7490'] };
  OS.catalogue = [];
  /** Charge la liste des applis d'Odin (les vraies quand Odin répond) et les déclare comme applis du bureau. */
  OS.chargerCatalogue = async () => {
    let mods = [];
    try { const r = await api.catalogue(); mods = (r && r.modules) || []; } catch { mods = []; }
    // Valaskjálf (Odin OS lui-même) ne s'installe pas dans Odin OS.
    OS.catalogue = mods.filter((m) => m.id !== 'valaskjalf').map((m) => ({ id: m.id, nom: m.name, famille: m.family, resume: m.what, fait: m.does || [], actions: m.actions || [], alertes: m.alerts || 0 }));
    for (const m of OS.catalogue) OS.applis[`odin:${m.id}`] = { id: `odin:${m.id}`, nom: m.nom, couleur: OS.FAMILLES[m.famille] || ['#8FA0AE', '#526578'], famille: m.famille, resume: m.resume, odin: m.id, largeur: 880, hauteur: 600, ouvrir: (ctx) => OS.vueOdin(ctx, m.id) };
    OS.emettre('catalogue');
    return OS.catalogue;
  };
  /** Affiche une notification (remplacée par le bureau ou le téléphone une fois monté). */
  OS.notifier = (n) => { console.log('[Odin OS]', n.titre, n.texte || ''); };
  OS.installee = (id) => OS.etat.applis.includes(id);
  /** Installe une appli d'Odin dans le bureau (icône dans le lanceur) et prévient. */
  OS.installerAppli = (id, o = {}) => {
    const m = OS.catalogue.find((x) => x.id === id); if (!m || OS.installee(id)) return false;
    OS.regler({ applis: [...OS.etat.applis, id] });
    if (!o.silence) OS.notifier({ appli: OS.applis[`odin:${id}`], titre: `${m.nom} est installé`, texte: 'Tu le trouves dans le lanceur. Je peux l\'ouvrir quand tu veux.', ouvrir: `odin:${id}` });
    return true;
  };
  OS.retirerAppli = (id) => { if (!OS.installee(id)) return false; OS.regler({ applis: OS.etat.applis.filter((x) => x !== id), epingles: OS.etat.epingles.filter((x) => x !== `odin:${id}`) }); return true; };
  /** Les applis visibles dans le lanceur : celles du système + les applis d'Odin installées. */
  OS.applisVisibles = () => Object.values(OS.applis).filter((a) => !a.cachee && (!a.odin || OS.installee(a.odin)));

  // ——— Dialogues ———
  /** Demande une confirmation. Renvoie une promesse : true si la personne confirme. */
  OS.confirmer = (titre, texte, o = {}) => new Promise((ok) => {
    const fermer = (v) => { fond.remove(); ok(v); };
    const oui = h('button', { class: `bouton ${o.danger ? 'danger' : 'primaire'}`, onclick: () => fermer(true) }, o.oui || 'Confirmer');
    const non = h('button', { class: 'bouton contour', onclick: () => fermer(false) }, o.non || 'Annuler');
    const fond = h('div', { class: 'dialogue-fond', onclick: (e) => { if (e.target === fond) fermer(false); }, onkeydown: (e) => { if (e.key === 'Escape') fermer(false); } },
      h('div', { class: 'dialogue', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': titre }, h('h2', { class: 'titre-section', style: { fontSize: '18px' } }, titre), texte ? h('p', { class: 'attenue' }, texte) : null,
        h('div', { class: 'rangee', style: { justifyContent: 'flex-end' } }, non, oui)));
    // Geste dangereux : le clavier est sur « Annuler », pour qu'un appui sur Entrée ne confirme pas par mégarde.
    document.body.append(fond); (o.danger ? non : oui).focus();
  });
  /** Demande un texte (nom de dossier, nouveau nom…). Renvoie le texte, ou null si annulé. */
  OS.demander = (titre, valeur = '', o = {}) => new Promise((ok) => {
    const fermer = (v) => { fond.remove(); ok(v); };
    const champ = h('input', { class: 'champ', value: valeur, 'aria-label': titre, type: o.type || 'text', autocomplete: 'off' });
    const fond = h('div', { class: 'dialogue-fond', onclick: (e) => { if (e.target === fond) fermer(null); } },
      h('form', { class: 'dialogue', role: 'dialog', 'aria-modal': 'true', 'aria-label': titre, onsubmit: (e) => { e.preventDefault(); fermer(champ.value.trim() || null); }, onkeydown: (e) => { if (e.key === 'Escape') fermer(null); } }, h('h2', { class: 'titre-section', style: { fontSize: '18px' } }, titre), o.aide ? h('p', { class: 'attenue petit-texte' }, o.aide) : null, champ,
        h('div', { class: 'rangee', style: { justifyContent: 'flex-end' } }, h('button', { type: 'button', class: 'bouton contour', onclick: () => fermer(null) }, 'Annuler'), h('button', { class: 'bouton primaire' }, o.oui || 'Valider'))));
    document.body.append(fond); champ.focus(); champ.select();
  });
  /** Petite étiquette « Essai » : ce qui est affiché est un exemple, pas la machine réelle. */
  OS.etiquetteEssai = (texte) => (api.mode === 'essai' ? h('span', { class: 'essai', title: 'Aucun Odin joignable : données d\'exemple, rien n\'est modifié.' }, texte || 'Essai : données d\'exemple') : null);
})();
