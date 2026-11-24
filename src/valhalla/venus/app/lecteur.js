// Venus dans Odin, le lecteur (lot V2) : public/js/views/player.js du dépôt TOUFATECH/Venus (licence MIT), réécrit pour
// Odin. Mêmes éléments, mêmes classes (feuille de style du dépôt), mêmes textes, mêmes touches : plein écran, ±10 s,
// barre de lecture, volume, audio et sous-titres (décalage G/H), vitesse (< et >), chapitres ([ et ]) quand ils sont
// connus, format de l'image (Z), minuterie de sommeil, mode nuit (son égalisé), image dans l'image, verrouillage de
// l'écran tactile, fiche à la pause, épisode suivant (N) et volet des épisodes, reprise par profil, « vu » à la fin,
// diffusion sur un écran (la fonction d'Odin), et sur un téléphone tenu droit la zone sous la vidéo.
//
// Le flux vient d'Odin seul : /venus/flux/<cible> (lu tel quel, ou converti à la volée à partir de ?depuis=), les
// sous-titres de /venus/sous-titres/<cible> (texte WebVTT, affiché comme du TEXTE, jamais comme du code de page), la
// reprise part vers /venus/reprise (le profil choisi est dans le témoin venus_profil). Rien n'est chargé d'Internet.
// Suite du lot V2 : les PISTES AUDIO du fichier (on en change pendant la lecture, elle reprend au même instant, le choix
// est gardé par profil), les QUALITÉS (« Originale », et une qualité réduite seulement si la machine d'Odin la produit
// vraiment : sinon la ligne est grisée et dit pourquoi), TOUS les sous-titres (dans la vidéo et posés à côté) et
// « Chercher des sous-titres » (dans la vidéo et à côté ; en ligne : aucun service réglé, c'est dit).
// Ce qu'Odin ne sait pas encore servir (extrait, séance à plusieurs, ambiance) garde sa place et dit « bientôt ».
//
// Chargé par la page /venus/app/ après planetes.js (icônes P, esc, hueOf) ; app.js l'ouvre (VenusLecteur.ouvrir).
// La logique pure (VenusLecteur.logique) est essayée sans navigateur.
'use strict';
(() => {
  const W = typeof window !== 'undefined' ? window : globalThis;
  const D = typeof document !== 'undefined' ? document : null;
  const tr = (k, v = {}) => (W.VenusApp && W.VenusApp.t ? W.VenusApp.t(k, v) : String(k).replace(/\{(\w+)\}/g, (_, x) => (v[x] ?? '')));
  const LANG = String((D && D.documentElement && D.documentElement.lang) || (W.navigator && W.navigator.language) || 'fr');

  // ---------------------------------------------------------------- logique pure
  const B_CODES = { fre: 'fr', fra: 'fr', eng: 'en', ger: 'de', deu: 'de', spa: 'es', ita: 'it', por: 'pt', jpn: 'ja', chi: 'zh', zho: 'zh', ara: 'ar', dut: 'nl', nld: 'nl', rus: 'ru', kor: 'ko', swa: 'sw', mlg: 'mg', cze: 'cs', ces: 'cs', gre: 'el', ell: 'el', tur: 'tr', pol: 'pl', hin: 'hi' };
  const L = {
    /** 4:05, 1:02:33 (ui.js fmtTime). */
    fmtTime(s) {
      s = Math.max(0, Math.floor(Number(s) || 0));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60, d2 = (n) => String(n).padStart(2, '0');
      return h ? `${h}:${d2(m)}:${d2(x)}` : `${m}:${d2(x)}`;
    },
    /** Le nom d'une langue dans la langue de l'interface (« fre », « fr », « eng »…) ; vide si inconnue. */
    langName(code) {
      const c = String(code || '').toLowerCase().split(/[-_]/)[0]; if (!c) return '';
      const k = B_CODES[c] || c;
      try { const n = new Intl.DisplayNames([LANG], { type: 'language' }).of(k); if (n && n.toLowerCase() !== k) return n.charAt(0).toUpperCase() + n.slice(1); } catch { /* ancien navigateur */ }
      return c.toUpperCase();
    },
    /** WebVTT → répliques en TEXTE (balises retirées, entités rendues) : player.js parseVtt, tel quel. */
    parseVtt(text) {
      const cues = [];
      const ts = (s) => { const p = s.trim().split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
      for (const block of String(text || '').replace(/\r/g, '').split(/\n\n+/)) {
        const lines = block.split('\n');
        const i = lines.findIndex((l) => l.includes('-->'));
        if (i < 0) continue;
        const [a, b] = lines[i].split('-->');
        const txt = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
        const st = ts(a), en = ts(String(b || '').trim().split(/\s/)[0]);
        if (txt && Number.isFinite(st) && Number.isFinite(en)) cues.push({ start: st, end: en, text: txt });
      }
      return cues.sort((x, y) => x.start - y.start);
    },
    infoUrl: (id) => `/venus/api/lecture/${encodeURIComponent(String(id))}`,
    /**
     * Le flux d'Odin ; un flux converti repart de `depuis` (le navigateur ne cherche pas dans un tuyau). `o.audio` : le
     * rang d'une autre piste audio ; `o.q` : la hauteur d'une qualité réduite. Sans choix, l'adresse est celle d'avant.
     */
    fluxUrl(id, depuis = 0, o = {}) {
      const d = Math.floor(Number(depuis) || 0), a = Math.floor(Number(o && o.audio) || 0), q = Math.floor(Number(o && o.q) || 0), p = [];
      if (d > 0) p.push(`depuis=${d}`); if (a > 0) p.push(`audio=${a}`); if (q > 0) p.push(`q=${q}`);
      return `/venus/flux/${encodeURIComponent(String(id))}${p.length ? `?${p.join('&')}` : ''}`;
    },
    /** Les sous-titres en texte : par l'identifiant court d'une piste (`piste`), sinon par langue comme avant. */
    sousTitresUrl: (id, lang, piste) => `/venus/sous-titres/${encodeURIComponent(String(id))}${piste != null && piste !== '' ? `?piste=${encodeURIComponent(String(piste))}` : lang ? `?lang=${encodeURIComponent(lang)}` : ''}`,
    pistesUrl: (id) => `/venus/api/pistes/${encodeURIComponent(String(id))}`,
    qualitesUrl: (id) => `/venus/api/qualites/${encodeURIComponent(String(id))}`,
    conversionUrl(id, audio, q) { const a = Math.floor(Number(audio) || 0), h = Math.floor(Number(q) || 0); return `/venus/api/conversion/${encodeURIComponent(String(id))}?audio=${a}${h > 0 ? `&q=${h}` : ''}`; },
    /** « 5.1 », « 7.1 », « Stéréo », « Mono » ; vide si le nombre de canaux n'est pas connu. */
    canaux(n) { n = Number(n) || 0; return n >= 8 ? '7.1' : n >= 6 ? '5.1' : n === 2 ? tr('Stéréo') : n === 1 ? tr('Mono') : ''; },
    /** Le nom d'une piste audio : sa langue (dans la langue de l'interface) et ses canaux, « Français · 5.1 » ; sinon « Piste 2 ». */
    nomAudio(a) { return [L.langName(a && a.lang) || tr('Piste {n}', { n: (Number(a && a.order) || 0) + 1 }), L.canaux(a && a.channels)].filter(Boolean).join(' · '); },
    /** Lu tel quel : le fichier se lit dans le navigateur ET rien n'est demandé (ni autre piste audio, ni qualité réduite). */
    direct: (info, audio, q) => !!info && info.mode === 'direct' && !audio && !q,
    planUrl: (id) => `/venus/plan/${encodeURIComponent(String(id))}`,
    vignetteUrl: (id) => `/venus/vignette/${encodeURIComponent(String(id))}`,
    /** Où démarrer : la reprise DU profil (déjà vu, presque rien ou depuis le début demandé : 0). */
    depart(info, depuisDebut) {
      const p = Number(info && info.position) || 0, d = Number(info && info.duration) || 0;
      if (depuisDebut || !info || info.watched || p < 5) return 0;
      if (d > 0 && p >= d * 0.95) return 0;
      return Math.floor(p);
    },
    /** Vu : 95 % de la durée (comme la bibliothèque). */
    estVu: (pos, dur) => Number(dur) > 0 && Number(pos) >= Number(dur) * 0.95,
    /** La note de reprise pour Odin (aucun secret, aucun chemin). */
    corpsReprise: (id, pos, dur) => ({ cible: String(id), type: 'video', position_s: Math.max(0, Math.floor(Number(pos) || 0)), duree_s: Math.max(0, Math.floor(Number(dur) || 0)) }),
    /** Fin proche : l'épisode suivant est proposé (player.js maybeShowNext). */
    finProche(t, d) { return Number(d) > 0 && Number(d) - Number(t) <= Math.max(25, Number(d) * 0.025); },
    /** Les répliques à l'écran à l'instant t (décalage compris). */
    repliques(cues, t, delai = 0) { const x = Number(t) - Number(delai); return (cues || []).filter((c) => c.start <= x && c.end >= x); },
    chapitreA(chapters, t) { let c = null; for (const x of chapters || []) if (x.start <= Number(t) + 0.01) c = x; return c; },
    SPEEDS: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
    vitesse(cur, dir) { const S = L.SPEEDS, i = S.indexOf(cur); return S[Math.max(0, Math.min(S.length - 1, (i < 0 ? 2 : i) + (dir > 0 ? 1 : -1)))]; },
    FITS: ['contain', 'cover', 'zoom', 'fill'],
    formatSuivant(f) { const i = L.FITS.indexOf(f); return L.FITS[(i + 1) % L.FITS.length]; },
    /** « Saison 1, épisode 2 » / « S1 É2 ». */
    sxe(season, episode) { return tr('S{s} É{e}', { s: season, e: episode }); },
    /** Une touche → ce que fait le lecteur (player.js onKey). `s` : l'état utile. Pur. */
    touche(e, s) {
      const k = e.key, code = e.keyCode, has = (x) => !!(s && s[x]);
      if (k === ' ' || k === 'MediaPlayPause' || code === 179 || code === 415 || code === 19 || k === 'k') return { a: 'toggle' };
      if (k === 'MediaFastForward' || code === 417) return { a: 'seek', dt: 30 };
      if (k === 'MediaRewind' || code === 412) return { a: 'seek', dt: -30 };
      if ((k === 'MediaTrackNext' || k === 'n' || (k === 'N' && e.shiftKey)) && has('next')) return { a: 'next' };
      if ((k === 'MediaTrackPrevious' || (k === 'P' && e.shiftKey)) && has('prev')) return { a: 'prev' };
      if (k === 's' && has('skip')) return { a: 'skip' };
      if (k === 'f') return { a: 'fs' };
      if (k === 'z') return { a: 'fit' };
      if (k === '>' || k === '<') return { a: 'speed', dir: k === '>' ? 1 : -1 };
      if ((k === ']' || k === '[') && has('chapters')) return { a: 'chapter', dir: k === ']' ? 1 : -1 };
      if ((k === 'g' || k === 'h') && has('cues')) return { a: 'subdelay', d: k === 'h' ? 0.1 : -0.1 };
      if (k === 'm') return { a: 'mute' };
      if (k === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) return { a: 'tracks' }; // « Audio et sous-titres », comme dans l'appli d'origine
      if (!has('uiOn') && !has('tv') && (k === 'ArrowUp' || k === 'ArrowDown')) return { a: 'volume', d: k === 'ArrowUp' ? 0.1 : -0.1 };
      if (k === 'a' && !e.ctrlKey && !e.metaKey) return { a: 'ambiance' };
      if (k === 'Escape' || k === 'Backspace' || k === 'BrowserBack' || k === 'GoBack' || code === 461 || code === 10009) return { a: 'back' };
      if (!has('uiOn')) {
        if (k === 'ArrowLeft' || k === 'ArrowRight' || code === 37 || code === 39) return { a: 'seek', dt: k === 'ArrowLeft' || code === 37 ? -10 : 10, track: true };
        if (k === 'Enter' || String(k || '').startsWith('Arrow') || code === 13) return { a: 'wake' };
        return null;
      }
      if (has('onTrack') && (k === 'ArrowLeft' || k === 'ArrowRight')) return { a: 'seek', dt: k === 'ArrowLeft' ? -10 : 10 };
      if (has('outside') && (String(k || '').startsWith('Arrow') || k === 'Enter')) return { a: 'focusplay' };
      return null;
    },
  };

  // ---------------------------------------------------------------- briques (ui.js h, icon, sheet)
  const SVG = 'http://www.w3.org/2000/svg';
  function h(tag, a = {}, ...kids) {
    const n = D.createElement(tag);
    for (const [k, v] of Object.entries(a || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) { if (p.startsWith('--')) n.style.setProperty(p, x); else n.style[p] = x; }
      else if (k === 'hidden') n.hidden = true;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : D.createTextNode(String(c)));
    return n;
  }
  /** Une icône du dépôt (objet P de planetes.js) : un dessin fixe, jamais un texte venu d'ailleurs. */
  function icon(name) {
    const s = D.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = (typeof P !== 'undefined' && P[name]) || '';
    return s;
  }
  let sheetOpen = null;
  /** Une fenêtre du bas (ui.js sheet), mêmes classes que celles de la page. */
  function sheet(title, content, { wide = false, onClose } = {}) {
    closeSheet();
    const last = D.activeElement;
    const box = h('div', { class: `sheet${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' }, h('span', { class: 'sheet-grab', 'aria-hidden': 'true' }), title ? h('h2', {}, title) : null, content);
    const wrap = h('div', { class: 'sheet-wrap' }, box);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) s.close(); });
    const s = { el: wrap, close() { if (sheetOpen !== s) return; sheetOpen = null; wrap.remove(); if (onClose) onClose(); if (last && last.focus && D.contains && D.contains(last)) last.focus(); } };
    sheetOpen = s;
    D.body.append(wrap);
    const f = box.querySelector('.opt.on') || box.querySelector('.f');
    try { (f || box).focus(); } catch { /* rien */ }
    return s;
  }
  function closeSheet() { if (sheetOpen) sheetOpen.close(); }
  const toastDe = (o) => (m, type) => { try { (o.toast || (() => {}))(m, type); } catch { /* rien */ } };
  const prefKey = (o, k) => `vn_${k}_${o.profil || 'moi'}`;
  const lire = (k, def) => { try { const v = W.localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } };
  const ecrire = (k, v) => { try { if (v == null) W.localStorage.removeItem(k); else W.localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } };

  // ---------------------------------------------------------------- le lecteur
  let courant = null; // un seul lecteur à la fois

  /**
   * Ouvre le lecteur pour une cible (film, clip, épisode). opts : { depuisDebut, profil, toast, envoyerEcran(info),
   * allerFiche(path), surFermeture(), parent }.
   */
  async function ouvrir(cibleId, opts = {}) {
    // Le défilement de la page d'avant le premier lecteur d'un enchaînement (un épisode qui en remplace un autre trouve
    // la page déjà figée : sans ça, la fermeture la laisserait figée).
    const bodyOverflow = courant ? courant.overflowAvant : D.body.style.overflow;
    if (courant) courant.destroy({ chain: true });
    const toast = toastDe(opts);
    let info = null, offset = 0, destroyed = false, uiTimer = null, saveTimer = null, subsTimer = null, sleepTimer = null;
    let cues = [], subId = null, subDelay = 0, speed = 1, fit = 'contain', sleep = null, fadeFrom = null;
    // La piste audio choisie (son rang dans le fichier ; 0 : celle d'origine) et la qualité (hauteur ; null : « Originale »).
    // « Auto » (comme dans l'appli d'origine) : Odin sert la meilleure qualité possible, ici l'originale.
    let audioSel = 0, quality = null, qAuto = true;
    const direct = () => L.direct(info, audioSel, quality);
    const entetes = () => ({ 'x-odin': '1', ...(opts.profil ? { 'x-venus-profil': String(opts.profil) } : {}) });
    let pendingSeek = null, seekTimer = null, nextShown = false, nextDismissed = false, nextTimer = null, dragging = false, startAt = 0, endedDone = false;
    const id = String(cibleId);

    // ---------------------------------------------------------------- éléments (mêmes que player.js)
    const video = h('video', { playsinline: true, 'webkit-playsinline': true, preload: 'auto' });
    const on = (ev, fn) => video.addEventListener(ev, (e) => { if (!destroyed) fn(e); });
    const subsLayer = h('div', { class: 'p-subs', 'aria-live': 'off' });
    const spinner = h('div', { class: 'p-loading' });
    const openFiche = () => { const t = detailsPath(); if (t) { exit(); if (opts.allerFiche) opts.allerFiche(t); } };
    const titleEl = h('button', { class: 'p-title p-link f', title: tr('Voir la fiche'), onclick: openFiche });
    const subEl = h('button', { class: 'p-sub p-link f', title: tr('Voir tous les épisodes'), hidden: true, onclick: openFiche });
    const modeDot = h('button', { class: 'p-mode f', type: 'button', onclick: () => openQuality() }, h('i'), h('span', { class: 'p-mode-q' }));
    const backBtn = h('button', { class: 'p-icon f', 'aria-label': tr('Retour'), onclick: () => exit() }, icon('back'));
    const playBtn = h('button', { class: 'p-icon big f', 'aria-label': tr('Lecture / pause'), 'data-autofocus': true, onclick: () => togglePlay() }, icon('play'));
    const rwBtn = h('button', { class: 'p-icon f', 'aria-label': tr('Reculer de 10 secondes'), onclick: () => seekBy(-10) }, icon('r10'));
    const ffBtn = h('button', { class: 'p-icon f', 'aria-label': tr('Avancer de 10 secondes'), onclick: () => seekBy(10) }, icon('f10'));
    const fill = h('div', { class: 'p-fill' }), buf = h('div', { class: 'p-buf' }), knob = h('div', { class: 'p-knob' });
    const chapMarks = h('div', { class: 'p-chapmarks', 'aria-hidden': 'true' });
    const track = h('div', { class: 'p-track f', tabindex: '0', role: 'slider', 'aria-label': tr('Position de lecture') }, buf, fill, chapMarks, knob);
    const curEl = h('span', {}, '0:00'), remEl = h('span', {}, '');
    const tracksBtn = h('button', { class: 'p-icon f', 'aria-label': tr('Audio et sous-titres'), onclick: () => openTracks() }, icon('subs'));
    const speedBtn = h('button', { class: 'p-icon f p-speed', 'aria-label': tr('Vitesse de lecture'), title: tr('Vitesse de lecture (touches < et >)'), onclick: () => openSpeed() }, icon('speed'), h('small', { class: 'p-speed-val', hidden: true }));
    const chapBtn = h('button', { class: 'p-icon f', hidden: true, 'aria-label': tr('Chapitres'), title: tr('Chapitres'), onclick: () => openChapters() }, icon('chapters'));
    const nextBtn = h('button', { class: 'btn btn-ghost btn-small f', hidden: true, onclick: () => playNext(true), 'aria-label': tr('Épisode suivant') }, icon('next'), h('span', { class: 'lbl' }, tr('Épisode suivant')));
    const prevBtn = h('button', { class: 'btn btn-ghost btn-small f', hidden: true, 'aria-label': tr('Épisode précédent'), title: tr('Précédent (Maj+P)'), onclick: () => playPrev() }, icon('prev'), h('span', { class: 'lbl' }, tr('Épisode précédent')));
    const epsBtn = h('button', { class: 'btn btn-ghost btn-small f', hidden: true, onclick: () => openEpisodes(), 'aria-label': tr('Épisodes') }, icon('eps'), h('span', { class: 'lbl' }, tr('Épisodes')));
    const castBtn = h('button', { class: 'p-icon f', 'aria-label': tr('Diffuser sur un écran'), onclick: () => openCast() }, icon('cast'));
    const fsBtn = h('button', { class: 'p-icon f', 'aria-label': tr('Plein écran'), onclick: () => toggleFullscreen() }, icon('fs'));
    const pipBtn = h('button', { class: 'p-icon f', hidden: !(D && D.pictureInPictureEnabled), 'aria-label': tr('Image dans l’image'), title: tr('Image dans l’image'), onclick: () => togglePip() }, icon('pip'));
    const night0 = !!lire(prefKey(opts, 'night'), false);
    const nightBtn = h('button', { class: `p-icon f${night0 ? ' on' : ''}`, 'aria-label': tr('Mode nuit (son égalisé)'), 'aria-pressed': String(night0), title: tr('Mode nuit : explosions moins fortes, dialogues plus clairs'), onclick: () => setNight(!lire(prefKey(opts, 'night'), false)) }, icon('moon'));
    const bientot = (quoi) => () => toast(tr('{quoi} : bientôt dans Odin.', { quoi }));
    const shareBtn = h('button', { class: 'p-icon f p-share', 'aria-label': tr('Partager un extrait'), title: tr('Partager un extrait (GIF ou vidéo de quelques secondes)'), onclick: bientot(tr('Partager un extrait')) }, icon('send'));
    const sleepBtn = h('button', { class: 'p-icon f p-sleep', 'aria-label': tr('Minuterie de sommeil'), title: tr('Minuterie de sommeil'), onclick: () => openSleep() }, icon('moon'), h('small', { class: 'p-sleep-left', hidden: true }));
    const lockBtn = h('button', { class: 'p-icon f p-lockbtn', 'aria-label': tr('Verrouiller l’écran tactile'), title: tr('Verrouiller l’écran'), onclick: () => setLocked(true) }, icon('lock'));
    const lockLayer = h('div', { class: 'p-lock', hidden: true });
    const muteBtn = h('button', { class: 'p-icon f', 'aria-label': tr('Couper le son'), onclick: () => setMuted(!video.muted) }, icon('vol'));
    const volRange = h('input', { class: 'p-volrange', type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': tr('Volume') });
    volRange.addEventListener('input', () => { setVolume(Number(volRange.value)); showUi(); });
    volRange.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setVolume(video.volume + (e.key === 'ArrowUp' ? 0.1 : -0.1)); } });
    const volBox = h('div', { class: 'p-vol' }, muteBtn, volRange);
    const volOsd = h('div', { class: 'p-osd', hidden: true });
    const skipBtn = h('button', { class: 'p-skip f', hidden: true, onclick: () => doSkip() }, icon('skip'), h('span', {}, tr('Passer l’intro')));
    const below = h('section', { class: 'p-below', 'aria-label': tr('À propos') });
    const nextPanel = h('div', { class: 'p-next', hidden: true });
    const overlay = h('div', { class: 'p-error', hidden: true });
    const fitBtn = h('button', { class: 'p-icon f p-fit', 'aria-label': tr('Format de l’image'), title: tr('Format de l’image (touche Z) : ajuster, remplir, zoom, étirer'), onclick: () => openFit() }, icon('fit'));
    const ambBtn = h('button', { class: 'p-icon f', 'aria-label': tr('Mode Ambiance'), 'aria-pressed': 'false', title: tr('Ambiance : la lumière du film déborde autour de l’image'), onclick: bientot(tr('Mode Ambiance')) }, icon('glow'));
    const partyBtn = h('button', { class: 'btn btn-ghost btn-small f', title: tr('Regarder ensemble, chacun sur son écran'), onclick: bientot(tr('Regarder ensemble')), 'aria-label': tr('Regarder ensemble') }, icon('people'), h('span', { class: 'lbl' }, tr('Ensemble')));
    const root = h('div', { class: opts.calme ? 'player' : 'player ui-on', role: 'region', 'aria-label': tr('Lecteur vidéo') },
      video, h('div', { class: 'scrim' }), subsLayer, spinner,
      h('div', { class: 'p-top' }, backBtn, h('div', { style: { minWidth: '0', flex: '1' } }, titleEl, subEl), modeDot, lockBtn),
      h('div', { class: 'p-center' }, rwBtn, playBtn, ffBtn),
      h('div', { class: 'p-bottom' },
        h('div', { class: 'p-timeline' }, curEl, track, remEl),
        h('div', { class: 'p-controls' }, volBox, tracksBtn, speedBtn, chapBtn, h('div', { class: 'spacer' }), partyBtn, epsBtn, prevBtn, nextBtn, sleepBtn, shareBtn, fitBtn, ambBtn, nightBtn, pipBtn, castBtn, fsBtn)),
      nextPanel, overlay, volOsd, skipBtn, below, lockLayer);
    // Barre trop large (ordinateur, série avec tous ses boutons) : elle défile, et la molette de la souris la fait défiler.
    const controls = root.querySelector('.p-controls');
    if (controls) controls.addEventListener('wheel', (e) => { if (controls.scrollWidth > controls.clientWidth + 1 && Math.abs(e.deltaY) > Math.abs(e.deltaX || 0)) { e.preventDefault(); controls.scrollLeft += e.deltaY; } }, { passive: false });
    (opts.parent || D.body).append(root);
    D.body.style.overflow = 'hidden';
    applySubLook();
    applyVolume();

    // ---------------------------------------------------------------- temps
    const position = () => offset + (video.currentTime || 0);
    const duration = () => (info && info.duration) || (Number.isFinite(video.duration) ? video.duration : 0) || 0;
    function bufferedEnd() {
      const t = video.currentTime || 0, b = video.buffered;
      if (b) for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i);
      return t;
    }
    function seekableEnd() {
      if (direct()) return video.duration || 0;
      const s = video.seekable; return s && s.length ? s.end(s.length - 1) : 0;
    }
    function paintTimeline(t = position()) {
      const d = duration(); if (!d) { curEl.textContent = L.fmtTime(t); return; }
      const pct = Math.min(100, (t / d) * 100);
      fill.style.width = `${pct}%`; knob.style.left = `${pct}%`;
      buf.style.width = `${Math.min(100, ((offset + bufferedEnd()) / d) * 100)}%`;
      curEl.textContent = L.fmtTime(t); remEl.textContent = `-${L.fmtTime(d - t)}`;
      track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', String(Math.floor(d))); track.setAttribute('aria-valuenow', String(Math.floor(t)));
      track.setAttribute('aria-valuetext', tr('{a} sur {b}', { a: L.fmtTime(t), b: L.fmtTime(d) }));
    }

    // ---------------------------------------------------------------- chargement
    async function load(at, { reason } = {}) {
      overlay.hidden = true; spinner.hidden = false;
      const t = Math.max(0, Math.floor(Number(at) || 0));
      startAt = t; endedDone = false;
      if (direct()) { offset = 0; video.src = L.fluxUrl(id); }
      else { offset = t; video.src = L.fluxUrl(id, t, { audio: audioSel, q: quality }); }
      try { video.load(); } catch { /* rien */ }
      video.playbackRate = speed;
      if (reason) toast(reason);
      paintTimeline(t);
      try { const p = video.play(); if (p && p.catch) p.catch(() => { spinner.hidden = true; showUi(true); }); } catch { spinner.hidden = true; }
    }
    on('loadedmetadata', () => { if (direct() && startAt > 0) { try { video.currentTime = startAt; } catch { /* rien */ } } paintTimeline(); });
    async function erreur(msg) {
      spinner.hidden = true; overlay.hidden = false;
      const p = h('p', {}, msg || tr('Lecture impossible pour le moment (flux indisponible).'));
      overlay.replaceChildren(h('div', {}, h('h2', {}, tr('La lecture n’a pas pu démarrer')), p,
        h('div', { class: 'actions', style: { justifyContent: 'center' } },
          h('button', { class: 'btn btn-play f', onclick: () => load(position()) }, tr('Réessayer')),
          h('button', { class: 'btn btn-ghost f', onclick: () => exit() }, tr('Retour')))));
      showUi(true);
      if (!msg) { try { const r = await W.fetch(L.planUrl(id), { headers: { 'x-odin': '1' } }); const d = await r.json(); if (d && d.error && !destroyed) p.textContent = String(d.error); } catch { /* Odin injoignable */ } }
    }
    on('error', () => {
      // Une conversion demandée (autre piste, qualité réduite) qui s'arrête : retour à l'original, au même instant, et c'est dit.
      if (audioSel || quality) { const ici = pendingSeek != null ? pendingSeek : position(); audioSel = 0; quality = null; paintMode(); toast(tr('La conversion s’est arrêtée : retour à la piste et à la qualité d’origine.'), 'error'); load(ici); return; }
      erreur();
    });

    // ---------------------------------------------------------------- sous-titres (texte seulement)
    async function loadSubtitles() {
      cues = []; subsLayer.replaceChildren(); lastCue = null;
      const s = info && info.subs.find((x) => x.id === subId); if (!s) return;
      try {
        const r = await W.fetch(L.sousTitresUrl(id, s.lang, s.id), { headers: { 'x-odin': '1' } });
        if (!r.ok) throw new Error(String(r.status));
        const recus = L.parseVtt(await r.text());
        if (destroyed || subId !== s.id) return;
        cues = recus;
        if (!cues.length) toast(tr('Ces sous-titres sont vides ou illisibles.'));
        else if (r.headers && r.headers.get && r.headers.get('x-venus-partiel')) toast(tr('Sous-titres incomplets : cette vidéo est longue à lire, seul le début est là.'));
      } catch { toast(tr('Sous-titres indisponibles'), 'error'); }
    }
    let lastCue = null;
    function paintSubs() {
      const active = L.repliques(cues, position(), subDelay);
      const key = active.map((c) => c.start).join(',');
      if (key === lastCue) return;
      lastCue = key;
      // Chaque ligne est un nœud de TEXTE : une balise dans un fichier de sous-titres reste écrite, jamais exécutée.
      subsLayer.replaceChildren(...active.map((c) => h('div', {}, c.text.split('\n').map((line, i) => [i ? h('br') : null, h('span', {}, line)]))));
    }
    function setSubDelay(v) {
      subDelay = Math.round(v * 10) / 10; ecrire(`vn_subdelay_${id}`, subDelay || null);
      lastCue = null; paintSubs();
      osd('subs', tr('Sous-titres {d} s', { d: `${subDelay > 0 ? '+' : ''}${String(subDelay).replace('.', ',')}` }));
    }
    function applySubLook() {
      const look = lire('vn_sublook', {}) || {};
      for (const c of ['sub-box', 'sub-soft', 'sub-small', 'sub-medium', 'sub-large', 'sub-xlarge', 'sub-yellow', 'sub-cyan', 'sub-green', 'sub-high', 'sub-top']) root.classList.remove(c);
      if (look.style === 'box') root.classList.add('sub-box'); if (look.style === 'soft') root.classList.add('sub-soft');
      root.classList.add(`sub-${['small', 'medium', 'large', 'xlarge'].includes(look.size) ? look.size : 'medium'}`);
      if (['yellow', 'cyan', 'green'].includes(look.color)) root.classList.add(`sub-${look.color}`);
      if (look.pos === 'high') root.classList.add('sub-high'); if (look.pos === 'top') root.classList.add('sub-top');
    }
    let osdTimer = null;
    function osd(ic, text) { volOsd.replaceChildren(icon(ic), h('b', {}, text)); volOsd.hidden = false; clearTimeout(osdTimer); osdTimer = setTimeout(() => { volOsd.hidden = true; }, 1200); }

    // ---------------------------------------------------------------- contrôles
    let userActAt = 0;
    const markUser = () => { userActAt = Date.now(); };
    function togglePlay() { markUser(); if (video.paused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); } else video.pause(); }
    function seekTo(t, { immediate = false } = {}) {
      if (!info) return;
      markUser();
      const d = duration(); t = Math.max(0, Math.min(d ? d - 1 : t, t));
      if (direct()) { try { video.currentTime = t; } catch { /* rien */ } paintTimeline(t); return; }
      const rel = t - offset;
      if (rel >= 0 && rel <= seekableEnd() - 0.5) { video.currentTime = rel; paintTimeline(t); return; }
      // Hors de la partie déjà convertie : Odin reconvertit à partir du nouveau point.
      pendingSeek = t; paintTimeline(t);
      clearTimeout(seekTimer);
      seekTimer = setTimeout(() => { const x = pendingSeek; pendingSeek = null; load(x); }, immediate ? 0 : 500);
    }
    function seekBy(dt) {
      const base = pendingSeek != null ? pendingSeek : position();
      seekTo(base + dt);
      const hint = h('div', { class: 'p-seekhint', style: dt < 0 ? { left: '12%' } : { right: '12%' } }, `${dt > 0 ? '+' : '−'}${Math.abs(dt)} s`);
      root.append(hint); setTimeout(() => hint.remove(), 800);
    }
    function showUi(stay = false) { root.classList.add('ui-on'); clearTimeout(uiTimer); if (!stay && !video.paused) uiTimer = setTimeout(hideUi, 3500); }
    function hideUi() {
      if (sheetOpen || video.paused || !overlay.hidden) return;
      root.classList.remove('ui-on');
      if (root.contains(D.activeElement) && D.activeElement.blur) D.activeElement.blur();
    }
    async function toggleFullscreen() {
      if (D.fullscreenElement || D.webkitFullscreenElement) { (D.exitFullscreen || D.webkitExitFullscreen).call(D); return; }
      // Toute la page passe en plein écran : on y reste en changeant d'épisode.
      const el = D.documentElement;
      if (el.requestFullscreen) { try { await el.requestFullscreen(); } catch { /* refusé */ } } else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    }
    async function togglePip() {
      try { if (D.pictureInPictureElement) await D.exitPictureInPicture(); else await video.requestPictureInPicture(); }
      catch (e) { toast(tr('Image dans l’image indisponible : {m}', { m: e.message }), 'error'); }
    }
    on('enterpictureinpicture', () => pipBtn.classList.add('on'));
    on('leavepictureinpicture', () => pipBtn.classList.remove('on'));
    function applyVolume() {
      const v = lire('vn_volume', 1), m = !!lire('vn_muted', false);
      video.volume = Math.max(0, Math.min(1, Number(v) || 0)); video.muted = m; volRange.value = String(video.volume); paintMute();
    }
    function paintMute() { muteBtn.replaceChildren(icon(video.muted || video.volume === 0 ? 'mute' : 'vol')); muteBtn.setAttribute('aria-label', video.muted ? tr('Remettre le son') : tr('Couper le son')); }
    function setVolume(v, show = false) {
      v = Math.max(0, Math.min(1, Math.round(v * 100) / 100)); video.volume = v; if (v > 0 && video.muted) video.muted = false;
      volRange.value = String(v); ecrire('vn_volume', v); ecrire('vn_muted', video.muted); paintMute();
      if (show) osd(v === 0 ? 'mute' : 'vol', `${Math.round(v * 100)} %`);
    }
    function setMuted(m) { video.muted = m; ecrire('vn_muted', m); paintMute(); osd(m ? 'mute' : 'vol', m ? tr('Son coupé') : `${Math.round(video.volume * 100)} %`); }

    // Mode nuit : un compresseur dans le navigateur (seulement après un geste, sinon le son serait coupé).
    function nightGraph() {
      if (video.__vnAudio) return video.__vnAudio;
      const AC = W.AudioContext || W.webkitAudioContext; if (!AC) return null;
      const ctx = new AC(), src = ctx.createMediaElementSource(video), comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -32; comp.knee.value = 24; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.28;
      const gain = ctx.createGain(); gain.gain.value = 1.7; comp.connect(gain); gain.connect(ctx.destination);
      video.__vnAudio = { ctx, src, comp, gain, on: false }; return video.__vnAudio;
    }
    function wireNight(onn) {
      let g = null; try { g = (onn || video.__vnAudio) ? nightGraph() : null; } catch { g = null; }
      if (!g) return;
      g.src.disconnect(); g.src.connect(onn ? g.comp : g.ctx.destination); g.on = onn;
      if (g.ctx.state === 'suspended') g.ctx.resume().catch(() => {});
    }
    function setNight(onn) {
      ecrire(prefKey(opts, 'night'), onn ? true : null);
      nightBtn.classList.toggle('on', onn); nightBtn.setAttribute('aria-pressed', String(onn));
      wireNight(onn);
      toast(onn ? tr('Mode nuit : sons forts adoucis, dialogues plus clairs') : tr('Mode nuit désactivé'));
    }
    const desarmer = () => { root.removeEventListener('pointerdown', arm, true); D.removeEventListener('keydown', arm, true); };
    function arm() { desarmer(); if (!destroyed && lire(prefKey(opts, 'night'), false)) wireNight(true); }
    if (night0) { root.addEventListener('pointerdown', arm, true); D.addEventListener('keydown', arm, true); }

    // Format de l'image (mémorisé pour la série ou le film, sur cet appareil).
    const FIT_TXT = { contain: ['Ajuster', 'Image entière, bandes noires si besoin'], cover: ['Remplir', 'Plein écran, bords rognés'], zoom: ['Zoom', 'Agrandi de 33 % : les vieux formats 4:3 remplissent l’écran'], fill: ['Étirer', 'Déformé pour couvrir l’écran'] };
    const fitKey = () => `vn_fit_${info && (info.showId || info.itemId || id)}`;
    function applyFit(f, { silent = false } = {}) {
      fit = L.FITS.includes(f) ? f : 'contain';
      video.style.objectFit = fit === 'zoom' ? 'contain' : fit; video.style.transform = fit === 'zoom' ? 'scale(1.333)' : '';
      fitBtn.classList.toggle('on', fit !== 'contain'); ecrire(fitKey(), fit === 'contain' ? null : fit);
      if (!silent) toast(`${tr('Format : {f}', { f: tr(FIT_TXT[fit][0]) })}${info && info.showId ? tr(' (gardé pour la série)') : tr(' (gardé pour ce film)')}`);
    }
    function openFit() {
      const s = sheet(tr('Format de l’image'), h('div', {}, L.FITS.map((f) => h('button', { class: `opt f${f === fit ? ' on' : ''}`, onclick: () => { s.close(); applyFit(f); } }, icon('check'), tr(FIT_TXT[f][0]), h('small', {}, tr(FIT_TXT[f][1])))),
        h('p', { class: 'muted' }, tr(info && info.showId ? 'Mémorisé pour toute la série sur cet appareil. Touche Z pour changer pendant la lecture.' : 'Mémorisé pour ce film sur cet appareil. Touche Z pour changer pendant la lecture.'))));
    }
    // Vitesse
    const fmtSpeed = (v) => `${String(v).replace('.', ',')}×`;
    function setSpeed(v, { silent = false } = {}) {
      speed = Math.max(0.5, Math.min(2, v)); video.defaultPlaybackRate = speed; video.playbackRate = speed;
      if ('preservesPitch' in video) video.preservesPitch = true;
      const val = speedBtn.querySelector('.p-speed-val'); if (val) { val.hidden = speed === 1; val.textContent = fmtSpeed(speed); }
      speedBtn.classList.toggle('on', speed !== 1);
      if (!silent) toast(tr('Vitesse {v}', { v: fmtSpeed(speed) }));
    }
    function openSpeed() {
      const s = sheet(tr('Vitesse de lecture'), h('div', {}, h('div', { class: 'speed-grid' }, L.SPEEDS.map((v) => h('button', { class: `chip f${v === speed ? ' on' : ''}`, onclick: () => { s.close(); setSpeed(v); } }, v === 1 ? tr('Normale') : fmtSpeed(v)))),
        h('p', { class: 'muted' }, tr('Le ton des voix est conservé. Touches < et > pendant la lecture.'))));
    }
    // Chapitres (seulement s'ils sont connus)
    const chapters = () => (info && Array.isArray(info.chapters) ? info.chapters : []);
    function paintChapters() {
      const ch = chapters(), d = duration(); chapBtn.hidden = ch.length < 2;
      chapMarks.replaceChildren(...(d ? ch.slice(1).map((c) => h('i', { style: { left: `${(c.start / d) * 100}%` } })) : []));
    }
    function jumpChapter(dir) {
      const ch = chapters(); if (ch.length < 2) return false;
      const t = position(), i = ch.indexOf(L.chapitreA(ch, t));
      const target = dir > 0 ? ch[i + 1] : (t - (ch[i] ? ch[i].start : 0) > 3 ? ch[i] : ch[Math.max(0, i - 1)]);
      if (!target) return false;
      seekTo(target.start + 0.05, { immediate: true }); toast(String(target.title || '')); return true;
    }
    function openChapters() {
      const now = L.chapitreA(chapters(), position());
      const s = sheet(tr('Chapitres'), h('div', { class: 'chap-list' }, chapters().map((c, i) => h('button', { class: `chap f${c === now ? ' on' : ''}`, onclick: () => { s.close(); seekTo(c.start + 0.05, { immediate: true }); } },
        h('span', { class: 'chap-img' }, h('b', {}, String(i + 1))), h('span', { class: 'chap-txt' }, h('b', {}, String(c.title || '')), h('small', {}, L.fmtTime(c.start)))))), { wide: true });
    }
    // Qualité : « Originale » (lue telle quelle, ou convertie si le navigateur ne lit pas ce format), et les qualités
    // réduites que la machine d'Odin produit vraiment. Les autres sont grisées et disent pourquoi.
    function paintMode() {
      const d = direct();
      modeDot.className = `p-mode f ${d ? 'ok' : 'conv'}`;
      modeDot.title = d ? tr('Lecture directe : le fichier est lu tel quel')
        : quality ? tr('Conversion par Odin : qualité réduite à {q}', { q: `${quality}p` })
          : audioSel ? tr('Conversion par Odin : une autre piste audio est lue')
            : tr('Conversion par Odin : ce format est converti pendant la lecture');
      modeDot.setAttribute('aria-label', modeDot.title);
      modeDot.querySelector('.p-mode-q').textContent = quality ? `${quality}p` : (info.res || '');
    }
    /** La demande est-elle possible (piste, qualité, machine libre) ? Rend la raison du refus, ou rien. Rien n'est lancé. */
    async function refusDe(audio, q) {
      try {
        const r = await W.fetch(L.conversionUrl(id, audio, q), { headers: entetes() }), j = await r.json().catch(() => ({}));
        return r.ok && j && j.ok ? null : tr(String((j && j.error) || 'Conversion impossible pour le moment.'));
      } catch { return tr('Odin est injoignable : la lecture reste comme elle est.'); }
    }
    const ici = () => (pendingSeek != null ? pendingSeek : position());
    async function setQuality(hq, auto = false) {
      const q = hq || null; if (q === quality) { qAuto = !q && auto; return; }
      if (q) { const refus = await refusDe(audioSel, q); if (destroyed) return; if (refus) { toast(refus, 'error'); return; } }
      const at = ici(); quality = q; qAuto = !q && auto; paintMode();
      load(at, { reason: q ? tr('Qualité {q}', { q: `${q}p` }) : tr('Qualité originale') });
    }
    function openQuality() {
      const liste = h('div', {}, h('p', { class: 'muted', role: 'status' }, tr('Odin regarde ce que cette machine peut produire…')));
      const ligne = (q) => (q.possible
        ? h('button', { class: `opt f${quality === q.hauteur ? ' on' : ''}`, onclick: () => { s.close(); setQuality(q.hauteur); } }, icon(quality === q.hauteur ? 'check' : 'dot'), String(q.q))
        : h('button', { class: 'opt f', 'aria-disabled': 'true', onclick: () => toast(tr('Qualité {q} : {r}', { q: String(q.q), r: tr(String(q.detail || q.raison || '')) })) }, icon('dot'), String(q.q), h('small', {}, tr(String(q.raison || '')))));
      const s = sheet(tr('Qualité'), h('div', {},
        h('p', { style: { color: 'var(--mist)', margin: '0 0 12px' } }, tr('Auto choisit la meilleure qualité possible. Baissez-la si la vidéo saccade ou pour économiser vos données. La pastille en haut à droite ouvre cette fenêtre.')),
        h('p', { class: 'p-mode-line' }, h('span', { class: `p-mode ${direct() ? 'ok' : 'conv'}` }, h('i')), h('span', {}, modeDot.title)),
        h('button', { class: `opt f${!quality && qAuto ? ' on' : ''}`, onclick: () => { s.close(); setQuality(null, true); } }, icon(!quality && qAuto ? 'check' : 'dot'), tr('Auto'), h('small', {}, tr('la meilleure possible ici : l’originale'))),
        h('button', { class: `opt f${!quality && !qAuto ? ' on' : ''}`, onclick: () => { s.close(); setQuality(null, false); } }, icon(!quality && !qAuto ? 'check' : 'dot'), tr('Originale'), info.res ? h('small', {}, info.res) : null),
        liste));
      (async () => {
        let d = null; try { const r = await W.fetch(L.qualitesUrl(id), { headers: entetes() }); d = await r.json(); if (!r.ok) d = null; } catch { d = null; }
        if (destroyed || sheetOpen !== s) return;
        const qs = d && Array.isArray(d.qualites) ? d.qualites : null;
        liste.replaceChildren(...(qs ? qs.map(ligne) : [h('p', { class: 'muted' }, tr('Odin est injoignable : la lecture reste en « Originale ».'))]));
      })();
    }
    // Audio et sous-titres
    function garderAudio(lang) {
      if (!lang) return;
      try { W.fetch('/venus/api/preferences', { method: 'POST', headers: { 'content-type': 'application/json', ...entetes() }, body: JSON.stringify({ audio: String(lang) }) }).catch(() => {}); } catch { /* hors ligne */ }
    }
    /** Change de piste audio pendant la lecture : elle reprend au même instant ; le choix (sa langue) est gardé pour ce profil. */
    async function setAudio(n) {
      const a = info.audio.find((x) => x.order === n); if (!a || n === audioSel) return;
      if (n !== 0 || quality) { const refus = await refusDe(n, quality); if (destroyed) return; if (refus) { toast(refus, 'error'); return; } }
      const at = ici(); audioSel = n; garderAudio(a.lang); paintMode();
      load(at, { reason: tr('Audio : {l}', { l: L.nomAudio(a) }) });
    }
    function choisirSub(x) { subId = x.id; ecrire(prefKey(opts, 'sublang'), x.id == null ? '' : x.lang); loadSubtitles(); }
    const nomSub = (x) => L.langName(x.lang) || tr('Sous-titres');
    function openTracks() {
      const audio = info.audio.length ? info.audio : [{ order: 0, codec: '' }];
      const audioCol = h('div', {}, h('h3', {}, tr('Audio')), audio.map((a) => h('button', {
        class: `opt f${a.order === audioSel ? ' on' : ''}`,
        onclick: () => { s.close(); setAudio(a.order); },
      }, icon(a.order === audioSel ? 'check' : 'dot'), L.nomAudio(a), h('small', {}, [a.title, a.codec ? String(a.codec).toUpperCase() : ''].filter(Boolean).join(' · ')))));
      const subOpts = [{ id: null, label: tr('Désactivés') }, ...info.subs.map((x) => ({ ...x, label: nomSub(x) }))];
      const subCol = h('div', {}, h('h3', {}, tr('Sous-titres')), subOpts.map((x) => (x.lisible === false
        ? h('button', { class: 'opt f', 'aria-disabled': 'true', onclick: () => toast(tr('Ces sous-titres sont des images, pas du texte : Odin ne sait pas les afficher.')) }, icon('dot'), x.label, h('small', {}, tr('en images')))
        : h('button', {
          class: `opt f${(x.id ?? null) === (subId ?? null) ? ' on' : ''}`,
          onclick: () => { s.close(); choisirSub(x); },
        }, icon((x.id ?? null) === (subId ?? null) ? 'check' : 'dot'), x.label, h('small', {}, [x.forced ? tr('Forcés') : '', x.title || ''].filter(Boolean).join(', '))))));
      const delayVal = h('b', {}, `${subDelay > 0 ? '+' : ''}${String(subDelay).replace('.', ',')} s`);
      const step = (d) => { setSubDelay(subDelay + d); delayVal.textContent = `${subDelay > 0 ? '+' : ''}${String(subDelay).replace('.', ',')} s`; };
      if (cues.length || subId != null) subCol.append(h('div', { class: 'sub-delay' }, h('span', {}, tr('Décalage')),
        h('button', { class: 'p-icon small f', 'aria-label': tr('Sous-titres plus tôt'), onclick: () => step(-0.5) }, '−'), delayVal,
        h('button', { class: 'p-icon small f', 'aria-label': tr('Sous-titres plus tard'), onclick: () => step(0.5) }, '+'),
        h('small', {}, tr('Touches G et H : 0,1 s'))));
      subCol.append(h('button', { class: 'opt ic f', onclick: () => { s.close(); openSubLook(); } }, icon('subs'), tr('Apparence des sous-titres')));
      subCol.append(h('button', { class: 'opt ic f', onclick: () => { s.close(); openSubSearch(); } }, icon('search'), tr('Chercher des sous-titres')));
      const s = sheet(tr('Audio et sous-titres'), h('div', { class: 'sheet-cols' }, audioCol, subCol));
    }
    // Chercher des sous-titres : Odin relit la vidéo et son dossier (un fichier posé depuis le dernier scan est trouvé).
    // En ligne : seulement avec un service réglé par le propriétaire ; sans lui, la fenêtre le dit.
    async function openSubSearch() {
      const corps = h('div', {}, h('p', { class: 'muted', role: 'status' }, tr('Odin regarde dans la vidéo et à côté…')));
      const s = sheet(tr('Chercher des sous-titres'), corps);
      let d = null; try { const r = await W.fetch(L.pistesUrl(id), { headers: entetes() }); d = await r.json(); if (!r.ok) d = null; } catch { d = null; }
      if (destroyed || sheetOpen !== s) return;
      if (!d || !Array.isArray(d.subs)) { corps.replaceChildren(h('p', { class: 'muted' }, tr('Recherche impossible pour le moment.'))); return; }
      const avant = new Set(info.subs.map((x) => x.id)); info.subs = d.subs;
      const lisibles = info.subs.filter((x) => x.lisible !== false);
      corps.replaceChildren(
        h('h3', {}, tr('Dans la vidéo et à côté')),
        lisibles.length
          ? h('div', {}, lisibles.map((x) => h('button', { class: `opt f${x.id === subId ? ' on' : ''}`, onclick: () => { s.close(); choisirSub(x); } },
            icon(x.id === subId ? 'check' : 'dot'), nomSub(x), h('small', {}, [avant.has(x.id) ? '' : tr('Trouvé à l’instant'), x.forced ? tr('Forcés') : '', x.title || ''].filter(Boolean).join(', ')))))
          : h('p', { class: 'muted' }, tr('Aucun sous-titre dans cette vidéo ni à côté.')),
        h('h3', {}, tr('En ligne')),
        h('p', { class: 'muted p-online' }, tr(String((d.enLigne && d.enLigne.texte) || 'Aucun service de sous-titres n’est réglé dans Odin : rien n’est cherché sur Internet.'))));
      try { (corps.querySelector('.opt.on') || corps.querySelector('.opt')).focus(); } catch { /* rien à viser */ }
    }
    function openSubLook() {
      const look = lire('vn_sublook', {}) || {};
      const row = (label, key, o, def) => h('div', { class: 'look-row' }, h('span', {}, label), h('div', { class: 'seg' }, o.map(([v, l]) => h('button', {
        class: `seg-b f${(look[key] || def) === v ? ' on' : ''}`,
        onclick: (e) => { look[key] = v; ecrire('vn_sublook', look); for (const b of e.currentTarget.parentNode.querySelectorAll('.seg-b')) b.classList.toggle('on', b === e.currentTarget); applySubLook(); },
      }, l))));
      sheet(tr('Apparence des sous-titres'), h('div', { class: 'look' },
        row(tr('Taille'), 'size', [['small', tr('Petite')], ['medium', tr('Moyenne')], ['large', tr('Grande')], ['xlarge', tr('Très grande')]], 'medium'),
        row(tr('Couleur'), 'color', [['white', tr('Blanc')], ['yellow', tr('Jaune')], ['cyan', tr('Cyan')], ['green', tr('Vert')]], 'white'),
        row(tr('Style'), 'style', [['text', tr('Contour')], ['soft', tr('Fond léger')], ['box', tr('Fond noir')]], 'text'),
        row(tr('Position'), 'pos', [['normal', tr('En bas')], ['high', tr('Plus haut')], ['top', tr('En haut')]], 'normal'),
        h('p', { class: 'muted' }, tr('Réglage gardé sur cet appareil.'))));
    }
    // Diffuser sur un écran de la maison (la fonction d'Odin : Odin choisit l'écran et y lance ce titre).
    function openCast() {
      const s = sheet(tr('Diffuser'), h('div', {}, h('button', { class: 'opt ic f', onclick: async () => {
        s.close(); video.pause(); saveProgress();
        if (opts.envoyerEcran) await opts.envoyerEcran({ titre: info.title, ...(info.type === 'episode' ? { saison: info.season, episode: info.episode } : {}) });
      } }, icon('cast'), tr('Diffuser sur un écran'), h('small', {}, tr('Trouvé par Odin dans la maison')))));
    }
    // Minuterie de sommeil
    function paintSleep() {
      const lbl = sleepBtn.querySelector('.p-sleep-left'); sleepBtn.classList.toggle('on', !!sleep);
      if (!sleep) { lbl.hidden = true; sleepBtn.title = tr('Minuterie de sommeil'); return; }
      lbl.hidden = false; lbl.textContent = sleep.mode === 'end' ? tr('fin') : `${Math.max(1, Math.ceil((sleep.until - Date.now()) / 60000))}`;
      sleepBtn.title = sleep.mode === 'end' ? tr('Arrêt à la fin de cet épisode') : tr('Arrêt dans {n} min', { n: lbl.textContent });
    }
    function openSleep() {
      const o = [[null, tr('Désactivée')], ['end', info && info.type === 'movie' ? tr('À la fin du film') : tr('À la fin de cet épisode')], [15, tr('15 minutes')], [30, tr('30 minutes')], [45, tr('45 minutes')], [60, tr('1 heure')], [90, tr('1 h 30')]];
      const cur = !sleep ? null : sleep.mode === 'end' ? 'end' : 'time';
      const s = sheet(tr('Minuterie de sommeil'), h('div', {}, h('p', { class: 'muted', style: { margin: '0 0 12px' } }, tr('La vidéo se met en pause toute seule, le son baisse doucement juste avant.')),
        o.map(([v, label]) => h('button', { class: `opt f${(v === null && !cur) || (v === 'end' && cur === 'end') ? ' on' : ''}`, onclick: () => {
          s.close(); sleep = v == null ? null : v === 'end' ? { mode: 'end' } : { until: Date.now() + v * 60000 }; paintSleep();
          toast(v == null ? tr('Minuterie désactivée') : v === 'end' ? tr('Pause à la fin de cette vidéo') : tr('Pause dans {l}', { l: label }), 'success');
        } }, icon('check'), label))));
    }
    function goodnight() {
      video.pause(); if (fadeFrom != null) { video.volume = fadeFrom; fadeFrom = null; }
      sleep = null; paintSleep(); saveProgress();
      const n = h('div', { class: 'p-night' }, h('div', {}, h('span', { class: 'p-night-moon' }, icon('moon')), h('h2', {}, tr('Bonne nuit')), h('p', {}, tr('La lecture est en pause, votre progression est enregistrée.')),
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-play f', onclick: () => { n.remove(); togglePlay(); } }, icon('play'), tr('Reprendre')), h('button', { class: 'btn btn-ghost f', onclick: () => exit() }, tr('Quitter')))));
      root.append(n); try { n.querySelector('.btn-play').focus(); } catch { /* rien */ }
    }
    sleepTimer = setInterval(() => {
      if (!sleep || !sleep.until) return;
      const left = sleep.until - Date.now(); paintSleep();
      if (left <= 20000 && left > 0 && !video.paused) { if (fadeFrom == null) fadeFrom = video.volume; video.volume = Math.max(0, fadeFrom * (left / 20000)); }
      if (left <= 0) goodnight();
    }, 1000);
    // Verrouillage de l'écran tactile : un appui long sur le cadenas déverrouille.
    function setLocked(onn) {
      root.classList.toggle('locked', onn); lockLayer.hidden = !onn;
      if (!onn) { lockLayer.replaceChildren(); showUi(); toast(tr('Écran déverrouillé')); return; }
      hideUi();
      const btn = h('button', { class: 'lock-open', 'aria-label': tr('Maintenir pour déverrouiller') }, h('i', { class: 'lock-ring' }), icon('lock'), h('span', {}, tr('Maintenir pour déverrouiller')));
      lockLayer.replaceChildren(btn);
      let tm = null;
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.classList.add('hold'); tm = setTimeout(() => setLocked(false), 900); });
      const stop = () => { btn.classList.remove('hold'); clearTimeout(tm); };
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
      lockLayer.classList.add('show'); setTimeout(() => lockLayer.classList.remove('show'), 2500);
    }

    // ---------------------------------------------------------------- fiche à la pause (ce qu'Odin sait, rien d'inventé)
    let pauseCard = null, pauseT = null;
    function showPauseCard() {
      if (!info || pauseCard || !video.paused || video.seeking || root.querySelector('.p-night') || lire('vn_pausecard', true) === false || endedDone) return;
      const left = Math.max(0, duration() - position());
      let endAt = ''; try { endAt = new Date(Date.now() + left * 1000).toLocaleTimeString(LANG, { hour: '2-digit', minute: '2-digit' }); } catch { endAt = ''; }
      const chap = L.chapitreA(chapters(), position());
      const line = [...cues].reverse().find((c) => c.start <= position() + 0.2);
      pauseCard = h('div', { class: 'p-pause', role: 'complementary', 'aria-label': tr('Pendant la pause') },
        h('div', { class: 'p-pause-top' }, h('div', { class: 'p-pause-meta' }, h('b', {}, tr('Il reste {t}', { t: L.fmtTime(left) })), endAt ? h('span', {}, tr('Se termine à {h}', { h: endAt })) : null, chap ? h('span', {}, String(chap.title || '')) : null)),
        line ? h('p', { class: 'p-pause-line' }, `« ${line.text.replace(/\n/g, ' ')} »`) : null);
      root.append(pauseCard);
    }
    function hidePauseCard() { clearTimeout(pauseT); if (pauseCard) { pauseCard.remove(); pauseCard = null; } }
    on('pause', () => { clearTimeout(pauseT); pauseT = setTimeout(showPauseCard, 1500); });
    on('play', hidePauseCard);
    on('seeking', hidePauseCard);

    // ---------------------------------------------------------------- progression (par profil : le témoin venus_profil)
    let finSauvee = false; // « vu » déjà envoyé : la sortie qui suit ne le remplace pas par une position plus tôt
    function saveProgress(final = false) {
      if (!info || (finSauvee && !final)) return;
      if (final) finSauvee = true;
      const pos = final ? duration() : (pendingSeek != null ? pendingSeek : position());
      if (!pos || pos < 5) return;
      try {
        W.fetch('/venus/reprise', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-odin': '1', ...(opts.profil ? { 'x-venus-profil': String(opts.profil) } : {}) }, body: JSON.stringify(L.corpsReprise(id, pos, duration())) }).catch(() => {});
      } catch { /* hors ligne */ }
    }
    saveTimer = setInterval(() => { if (!video.paused) saveProgress(); }, 10000);
    const onHide = () => { if (D.visibilityState === 'hidden') saveProgress(); };
    D.addEventListener('visibilitychange', onHide);
    const onPageHide = () => saveProgress();
    W.addEventListener('pagehide', onPageHide);

    // ---------------------------------------------------------------- génériques, épisode suivant
    let skipKind = null;
    function checkSegments(t) {
      const seg = info && info.segments; if (!seg) { skipBtn.hidden = true; return; }
      let kind = null;
      if (seg.intro && t >= seg.intro.start && t < seg.intro.end - 1.5) kind = 'intro';
      else if (seg.credits && t >= seg.credits.start && t < seg.credits.end - 1.5) kind = 'credits';
      if (kind === 'credits' && info.next) { kind = null; maybeShowNext(true); }
      if (kind !== skipKind) { skipKind = kind; skipBtn.hidden = !kind; if (kind) skipBtn.querySelector('span').textContent = kind === 'intro' ? tr('Passer l’intro') : tr('Passer le générique'); }
    }
    function doSkip(kind = skipKind) { const seg = info && info.segments && info.segments[kind]; if (!seg) return; seekTo(seg.end, { immediate: true }); skipBtn.hidden = true; skipKind = null; }
    function maybeShowNext(early = false) {
      if (!info || !info.next || nextShown || nextDismissed || info.type !== 'episode') return;
      if (!early && !L.finProche(position(), duration())) return;
      nextShown = true;
      if (sleep && sleep.mode === 'end') return;
      const n = info.next; let left = 10;
      const count = h('b', { class: 'nx-count' }, String(left));
      const pic = h('img', { src: L.vignetteUrl(n.id), alt: '' }); pic.addEventListener('error', () => pic.remove());
      nextPanel.replaceChildren(
        h('button', { class: 'nx-pic f', 'aria-label': tr('Lire maintenant : {t}', { t: L.sxe(n.season, n.episode) }), onclick: () => playNext(true) }, pic, h('span', { class: 'nx-play' }, icon('play'), count)),
        h('div', { class: 'nx-body' },
          h('div', { class: 'nx-head' }, tr('Épisode suivant · {e}', { e: L.sxe(n.season, n.episode) })),
          h('div', { class: 'nx-title' }, info.title),
          h('div', { class: 'actions' },
            h('button', { class: 'btn btn-play btn-small f', onclick: () => playNext(true) }, icon('play'), tr('Lire maintenant')),
            h('button', { class: 'btn btn-ghost btn-small f', onclick: () => { nextDismissed = true; clearInterval(nextTimer); nextPanel.hidden = true; } }, tr('Annuler')))));
      nextPanel.hidden = false;
      try { nextPanel.querySelector('.btn-play').focus(); } catch { /* rien */ }
      nextTimer = setInterval(() => { left--; count.textContent = String(Math.max(0, left)); if (left <= 0) { clearInterval(nextTimer); playNext(); } }, 1000);
    }
    function playNext() {
      if (!info || !info.next) return;
      // « Vu » seulement à la fin (ou tout près) : passer au suivant au milieu garde la vraie position.
      saveProgress(endedDone || L.finProche(position(), duration()));
      const n = info.next.id; destroy({ chain: true });
      ouvrir(n, { ...opts, depuisDebut: true, calme: true });
    }
    function playPrev() {
      if (!info || !info.prev) return;
      saveProgress();
      const p = info.prev.id; destroy({ chain: true });
      ouvrir(p, { ...opts, depuisDebut: true });
    }
    function lireAutre(eid) { if (eid === id) return; saveProgress(); destroy({ chain: true }); ouvrir(eid, { ...opts, depuisDebut: false }); }

    // ---------------------------------------------------------------- volet des épisodes, zone sous la vidéo
    async function openEpisodes() {
      if (!info || !info.showId) return;
      let d; try { const r = await W.fetch(`/venus/api/titre/${encodeURIComponent(info.showId)}`, { headers: { 'x-odin': '1' } }); d = await r.json(); } catch (e) { toast(String(e.message || e), 'error'); return; }
      if (destroyed || !d || !Array.isArray(d.saisons)) return;
      const list = h('div', { class: 'ep-list', role: 'list' }), tabs = h('div', { class: 'chips ep-seasons' }), count = h('span', { class: 'ep-count' });
      const paint = (season) => {
        for (const c of tabs.querySelectorAll('.chip')) c.classList.toggle('on', c.getAttribute('data-n') === String(season.number));
        const seen = season.episodes.filter((e) => e.watched).length;
        count.textContent = tr('{n} épisodes', { n: season.episodes.length }) + (seen ? tr(' · {n} vus', { n: seen }) : '');
        list.replaceChildren(...season.episodes.map((e) => {
          const cur = e.id === id, pct = e.duration ? Math.min(100, (e.position / e.duration) * 100) : 0;
          const im = h('img', { src: L.vignetteUrl(e.id), alt: '', loading: 'lazy' }); im.addEventListener('error', () => im.remove());
          return h('button', { class: `ep-row f${cur ? ' current' : ''}${e.watched ? ' seen' : ''}`, role: 'listitem', onclick: () => { s.close(); lireAutre(e.id); } },
            h('div', { class: 'ep-shot' }, im, cur ? h('span', { class: 'ep-now' }, icon('play')) : e.watched ? h('span', { class: 'check' }, icon('check')) : null, pct > 0 && !e.watched ? h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })) : null),
            h('div', { class: 'ep-text' }, h('b', {}, tr('Épisode {n}', { n: e.episode })), h('small', {}, [cur ? tr('En cours') : pct > 0 && !e.watched ? tr('Reste {n} min', { n: Math.max(1, Math.round((e.duration - e.position) / 60)) }) : e.watched ? tr('Vu') : null, e.runtime ? tr('{n} min', { n: e.runtime }) : null].filter(Boolean).join(' · '))));
        }));
      };
      for (const se of d.saisons) tabs.append(h('button', { class: 'chip f', 'data-n': String(se.number), onclick: () => paint(se) }, se.number === 0 ? tr('Bonus') : tr('Saison {n}', { n: se.number })));
      const s = sheet(tr('Épisodes'), h('div', { class: 'ep-panel' }, h('div', { class: 'ep-head' }, d.saisons.length > 1 ? tabs : null, count), list), { wide: true });
      paint(d.saisons.find((x) => x.number === info.season) || d.saisons[0]);
    }
    function paintBelow() {
      const parts = [];
      const meta = info.type === 'episode' ? tr('Saison {s}, épisode {e}', { s: info.season, e: info.episode }) : [info.year, info.duration ? (Math.floor(info.duration / 3600) ? `${Math.floor(info.duration / 3600)} h ${String(Math.round((info.duration % 3600) / 60)).padStart(2, '0')}` : tr('{n} min', { n: Math.max(1, Math.round(info.duration / 60)) })) : null].filter(Boolean).join(' · ');
      parts.push(h('div', { class: 'pb-head' }, h('div', { class: 'pb-meta' }, meta),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: openFiche }, icon('info'), info.showId ? tr('La série') : tr('La fiche'))));
      const eps = info.seasonEpisodes || [];
      if (eps.length > 1) {
        parts.push(h('h3', { class: 'pb-title' }, tr('Saison {n}', { n: info.season }), h('small', {}, tr(' · {n} épisodes', { n: eps.length }))));
        parts.push(h('div', { class: 'pb-eps' }, eps.map((e) => {
          const cur = e.id === id, p = e.progress, pct = p && p.duration && !p.watched ? Math.min(100, (p.position / p.duration) * 100) : 0;
          const im = h('img', { src: L.vignetteUrl(e.id), alt: '', loading: 'lazy' }); im.addEventListener('error', () => im.remove());
          return h('button', { class: `pb-ep f${cur ? ' current' : ''}`, onclick: () => lireAutre(e.id) },
            h('span', { class: 'pb-shot' }, im, cur ? h('span', { class: 'pb-now' }, tr('En cours')) : null, pct ? h('i', { class: 'pb-bar' }, h('i', { style: { width: `${pct}%` } })) : null, p && p.watched ? h('span', { class: 'pb-seen' }, icon('check')) : null),
            h('span', { class: 'pb-txt' }, h('b', {}, tr('Épisode {n}', { n: e.episode })), h('small', {}, e.runtime ? tr('{n} min', { n: e.runtime }) : '')));
        })));
      }
      below.replaceChildren(...parts);
    }
    function detailsPath() { if (!info) return null; return `/titre/${encodeURIComponent(info.showId || info.itemId || id)}`; }

    // ---------------------------------------------------------------- souris, toucher, clavier
    root.addEventListener('mousemove', (e) => { if (!e.movementX && !e.movementY) return; showUi(); });
    let lastTap = 0, tapTimer = null;
    on('click', (e) => {
      const now = Date.now(), touch = D.documentElement.classList.contains('touch');
      if (touch && now - lastTap < 300) { clearTimeout(tapTimer); seekBy(e.clientX < (W.innerWidth || 0) / 2 ? -10 : 10); lastTap = 0; return; }
      lastTap = now;
      if (touch) tapTimer = setTimeout(() => (root.classList.contains('ui-on') ? hideUi() : showUi()), 280); else togglePlay();
    });
    on('dblclick', () => { if (!D.documentElement.classList.contains('touch')) toggleFullscreen(); });
    const fracDe = (e) => { const r = track.getBoundingClientRect(); return r.width ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0; };
    track.addEventListener('pointerdown', (e) => { dragging = true; paintTimeline(fracDe(e) * duration()); });
    track.addEventListener('pointermove', (e) => { if (dragging) paintTimeline(fracDe(e) * duration()); });
    track.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; seekTo(fracDe(e) * duration(), { immediate: true }); });
    track.addEventListener('pointercancel', () => { dragging = false; });
    const onKey = (e) => {
      if (destroyed) return;
      if (sheetOpen) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(); } return; }
      if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') && e.target !== volRange) return;
      const active = D.activeElement, uiOn = root.classList.contains('ui-on');
      const act = L.touche(e, { uiOn, next: !!(info && info.next), prev: !!(info && info.prev), skip: !!skipKind, chapters: chapters().length > 1, cues: cues.length > 0, tv: D.documentElement.classList.contains('tv'), onTrack: active === track, outside: !root.contains(active) || active === D.body });
      if (uiOn && !act) { showUi(); return; }
      if (!act) return;
      e.preventDefault(); e.stopPropagation();
      switch (act.a) {
        case 'toggle': togglePlay(); showUi(); break;
        case 'seek': seekBy(act.dt); showUi(); if (act.track) try { track.focus(); } catch { /* rien */ } break;
        case 'next': playNext(true); break;
        case 'prev': playPrev(); break;
        case 'skip': doSkip(); break;
        case 'fs': toggleFullscreen(); break;
        case 'fit': applyFit(L.formatSuivant(fit)); break;
        case 'speed': setSpeed(L.vitesse(speed, act.dir)); break;
        case 'chapter': jumpChapter(act.dir); showUi(); break;
        case 'subdelay': setSubDelay(subDelay + act.d); break;
        case 'mute': setMuted(!video.muted); break;
        case 'tracks': if (info) openTracks(); break;
        case 'volume': setVolume(video.volume + act.d, true); break;
        case 'ambiance': bientot(tr('Mode Ambiance'))(); break;
        case 'back': if (uiOn && root.contains(active) && active !== playBtn && active !== track && active !== D.body) { try { playBtn.focus(); } catch { /* rien */ } showUi(); } else exit(); break;
        case 'wake': showUi(); try { playBtn.focus(); } catch { /* rien */ } break;
        case 'focusplay': showUi(); try { playBtn.focus(); } catch { /* rien */ } break;
        default: break;
      }
    };
    D.addEventListener('keydown', onKey, true);

    // ---------------------------------------------------------------- évènements vidéo
    on('waiting', () => { spinner.hidden = false; });
    on('playing', () => { spinner.hidden = true; if (pendingSeek == null) showUi(); });
    on('canplay', () => { spinner.hidden = true; });
    on('play', () => { finSauvee = false; playBtn.replaceChildren(icon('pause')); showUi(); });
    on('pause', () => { playBtn.replaceChildren(icon('play')); showUi(true); saveProgress(); });
    on('timeupdate', () => { if (!dragging && pendingSeek == null) paintTimeline(); maybeShowNext(); checkSegments(position()); });
    on('ended', () => {
      // Un flux converti qui s'arrête avant la fin n'est pas la fin du film.
      // Coupé par Odin faute de lecteur (longue pause) : repris au même instant, si la lecture avait avancé depuis.
      if (info && !direct() && position() < duration() - 5) { if (position() > startAt + 2) load(position()); return; }
      if (endedDone) return; endedDone = true;
      saveProgress(true);
      if (sleep && sleep.mode === 'end') { goodnight(); return; }
      if (info && info.next && info.type === 'episode' && !nextDismissed) playNext();
      else setTimeout(() => { if (!destroyed) exit(); }, 1200);
    });
    subsTimer = setInterval(() => { if (cues.length) paintSubs(); }, 120);

    // ---------------------------------------------------------------- sortie
    function exit() { destroy(); if (opts.surFermeture) opts.surFermeture(); }
    function destroy({ chain = false } = {}) {
      if (destroyed) return;
      saveProgress();
      destroyed = true; if (courant === moi) courant = null;
      closeSheet();
      for (const x of [saveTimer, subsTimer, sleepTimer, nextTimer]) clearInterval(x);
      for (const x of [uiTimer, seekTimer, pauseT, osdTimer, tapTimer]) clearTimeout(x);
      D.removeEventListener('keydown', onKey, true);
      D.removeEventListener('visibilitychange', onHide); W.removeEventListener('pagehide', onPageHide);
      desarmer();
      const g = video.__vnAudio; if (g) { video.__vnAudio = null; try { g.src.disconnect(); const p = g.ctx.close(); if (p && p.catch) p.catch(() => {}); } catch { /* déjà fermé */ } }
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* rien */ }
      root.remove();
      D.body.style.overflow = chain ? 'hidden' : bodyOverflow;
      if (!chain && (D.fullscreenElement) && D.exitFullscreen) { try { const p = D.exitFullscreen(); if (p && p.catch) p.catch(() => {}); } catch { /* rien */ } }
    }
    const moi = { destroy, root, video, get info() { return info; }, position, exit, overflowAvant: bodyOverflow };
    courant = moi;

    // ---------------------------------------------------------------- démarrage
    titleEl.textContent = tr('Chargement…');
    try {
      const r = await W.fetch(L.infoUrl(id), { headers: { 'x-odin': '1', ...(opts.profil ? { 'x-venus-profil': String(opts.profil) } : {}) } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String((j && j.error) || r.status));
      info = j;
    } catch (e) {
      if (destroyed) return moi;
      info = { id, title: '', duration: 0, mode: 'direct', subs: [], audio: [], chapters: [] };
      titleEl.textContent = ''; erreur(String(e.message || e)); return moi;
    }
    if (destroyed) return moi;
    info.subs = Array.isArray(info.subs) ? info.subs : []; info.audio = Array.isArray(info.audio) ? info.audio : [];
    titleEl.textContent = info.title;
    titleEl.title = info.showId ? tr('Voir la série et tous ses épisodes') : tr('Voir la fiche');
    if (info.type === 'episode') { subEl.textContent = L.sxe(info.season, info.episode); subEl.hidden = false; }
    root.setAttribute('aria-label', tr('Lecteur vidéo : {t}', { t: info.title }));
    nextBtn.hidden = !info.next; prevBtn.hidden = !info.prev; epsBtn.hidden = !info.showId;
    // La piste audio que ce profil a choisie la dernière fois (par sa langue), si la machine peut la servir maintenant.
    if (Number.isInteger(info.audioSel) && info.audioSel > 0 && info.audio.some((a) => a.order === info.audioSel) && info.present !== false) {
      const refus = await refusDe(info.audioSel, null); if (destroyed) return moi;
      if (refus) toast(refus); else audioSel = info.audioSel;
    }
    paintMode(); paintChapters(); paintBelow(); paintSleep();
    subDelay = Number(lire(`vn_subdelay_${id}`, 0)) || 0;
    applyFit(lire(fitKey(), 'contain'), { silent: true });
    // Sous-titres : la langue choisie la dernière fois par ce profil, sinon des sous-titres forcés s'il y en a.
    const voulu = lire(prefKey(opts, 'sublang'), null);
    const pick = voulu ? info.subs.find((x) => x.lang === voulu && x.lisible !== false) : info.subs.find((x) => x.forced && x.lisible !== false);
    subId = pick ? pick.id : null;
    if (subId != null) loadSubtitles();
    if (info.present === false) { erreur(tr('Le fichier de ce titre n’est plus à sa place (disque débranché, fichier déplacé) : rebranchez-le ou relancez un scan.')); return moi; }
    await load(L.depart(info, opts.depuisDebut));
    try { playBtn.focus(); } catch { /* rien */ }
    return moi;
  }

  function fermer() { if (courant) courant.exit(); }
  W.VenusLecteur = { ouvrir, fermer, logique: L, ouvert: () => courant };
})();
