// Lecteur de Vénus (dans le navigateur) : lit un film, une série, un clip ou une vidéo YouTube directement depuis Odin.
// Le flux vient d'Odin (route /venus/flux/<id> pour la bibliothèque, /venus/yt/flux/<id> pour YouTube), avec reprise
// de l'en-tête Range et transcodage à la volée côté serveur quand le format n'est pas lisible dans le navigateur.
// Sous-titres par <track> (/venus/sous-titres/<id>), reprise là où on s'était arrêté (POST /venus/reprise), barre de
// progression et plein écran. Les segments sponsor (SponsorBlock, côté serveur) sont sautés tout seuls pendant la lecture.
// Aucun appel à un serveur extérieur : tout passe par Odin. La logique pure est exposée pour les essais (sans navigateur).
(() => {
  'use strict';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const CSS = `
.vl{position:fixed;inset:0;z-index:2147482000;display:flex;flex-direction:column;background:var(--bg,#05070c);color:var(--ink,#eef0f6);font:15px/1.5 var(--body,system-ui,sans-serif)}
.vl *{box-sizing:border-box}
.vl-haut{display:flex;align-items:center;gap:12px;padding:10px 14px;background:linear-gradient(180deg,var(--panel,#0b0f17),transparent)}
.vl-haut b{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vl-haut small{color:var(--muted,#9aa1b2)}
.vl-x{margin-left:auto;min-height:40px;min-width:40px;border-radius:12px;border:1px solid var(--line,#ffffff1a);background:var(--panel2,#ffffff0a);color:inherit;font:600 14px inherit;cursor:pointer;padding:0 14px}
.vl-cadre{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#000}
.vl-video{width:100%;height:100%;max-height:100%;background:#000}
.vl-bas{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;background:linear-gradient(0deg,var(--panel,#0b0f17),transparent)}
.vl-b{min-height:40px;border-radius:12px;border:1px solid var(--line,#ffffff1a);background:var(--panel2,#ffffff0a);color:inherit;font:600 13px inherit;cursor:pointer;padding:0 14px}
.vl-b:hover{border-color:var(--field-h,#ffffff33)}
.vl-chip{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:0 10px;border-radius:999px;background:color-mix(in srgb,var(--accent,#e2a93b) 16%,transparent);color:var(--accent,#e2a93b);font:600 12px inherit}
.vl-err{padding:16px;max-width:680px;text-align:center;color:var(--bad,#ffb4a8)}
@media (pointer:coarse){.vl-b,.vl-x{min-height:44px}}
@media (max-width:480px){.vl-haut b{font-size:15px}}
.vl-cadre{position:relative}
.vl-attente{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:10px 16px;border-radius:12px;background:#000000b3;color:#fff;font:600 14px inherit;pointer-events:none;text-align:center;max-width:calc(100% - 32px)}
.vl-attente[hidden]{display:none}
.vl-barre{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 14px 0;background:var(--panel,#0b0f17)}
.vl-barre .vl-b{min-height:44px;min-width:44px}
.vl-curseur{flex:1 1 200px;min-width:0;height:44px;margin:0;accent-color:var(--accent,#e2a93b);cursor:pointer}
.vl-temps{font:600 13px inherit;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--muted,#9aa1b2)}
@media (max-width:480px){.vl-curseur{flex-basis:100%;order:-1}}`;

  // --- Logique pure (essayable sans navigateur) --------------------------------------------------
  const logique = {
    /** Adresse du flux dans Odin (jamais d'adresse extérieure). */
    fluxUrl(cible) {
      if (cible && cible.flux) return cible.flux;
      if (cible && cible.source === 'yt') return `/venus/yt/flux/${encodeURIComponent(String(cible.id))}`;
      return `/venus/flux/${encodeURIComponent(String(cible && cible.id))}`;
    },
    /** Adresse où Odin dit comment une cible se lit, et ce qui l'en empêche (après un échec de lecture). */
    planUrl(id) { return `/venus/plan/${encodeURIComponent(String(id))}`; },
    /** Ajoute la position de départ (reprise/seek) à l'adresse d'un flux : le serveur relance le transcodage à `depuis`
     *  (le navigateur ne peut pas chercher dans un tuyau transcodé). Pur. */
    avecDepuis(url, depuis) {
      const d = Math.floor(Number(depuis) || 0);
      if (!(d > 0)) return url;
      return `${url}${url.includes('?') ? '&' : '?'}depuis=${d}`;
    },
    sousTitresUrl(id, lang) { return `/venus/sous-titres/${encodeURIComponent(String(id))}${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`; },
    vignetteUrl(id) { return `/venus/vignette/${encodeURIComponent(String(id))}`; },
    /** Format court : 4:05, 1:02:33. */
    mmss(s) {
      s = Math.max(0, Math.floor(Number(s) || 0));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
      const d2 = (n) => String(n).padStart(2, '0');
      return h ? `${h}:${d2(m)}:${d2(x)}` : `${m}:${d2(x)}`;
    },
    /** On propose de reprendre si on était bien engagé (plus de 30 s) et pas quasi à la fin (moins de 95 %). */
    doitReprendre(reprise_s, duree_s) {
      const p = Number(reprise_s) || 0, d = Number(duree_s) || 0;
      if (p < 30) return false;
      if (d > 0 && p > d * 0.95) return false;
      return true;
    },
    /** Corps de la note de reprise envoyée à Odin (jamais de secret). Le serveur attend « cible ». */
    corpsReprise(cible, position, duree) {
      return { cible: String(cible && cible.id), type: (cible && cible.type) || 'video', position_s: Math.max(0, Math.floor(Number(position) || 0)), duree_s: Math.max(0, Math.floor(Number(duree) || 0)) };
    },
    /** Pendant la lecture : si la position tombe dans un segment à sauter (sponsor…), rend la fin où aller ; sinon null. */
    prochainSaut(position, segments) {
      if (!Array.isArray(segments)) return null;
      for (const g of segments) {
        const d = Number(g && g.debut), f = Number(g && g.fin);
        if (!(f > d)) continue;
        if (position >= d - 0.3 && position < f - 0.6) return f;
      }
      return null;
    },
    // --- Film converti à la volée par Odin (le navigateur ne le lit pas tel quel) ---
    // Le navigateur ne voit alors qu'un tuyau qui commence à `depuis` et dont la durée grandit : la barre de temps est à
    // nous, avec la durée entière connue d'Odin, et un saut redemande le flux à partir de la position voulue.
    /** Le plan d'Odin (/venus/plan) dit-il que le titre est converti ? Plan inconnu : non (lecteur du navigateur). */
    estConverti(plan) { return !!(plan && typeof plan.mode === 'string' && plan.mode !== 'direct'); },
    /** Durée à afficher : celle d'Odin pour un converti (0 si inconnue, jamais inventée) ; celle du navigateur sinon. */
    dureeAffichee(dureeServeur, dureeVideo, converti) {
      const s = Number(dureeServeur) || 0, v = Number(dureeVideo);
      if (converti) return s > 0 ? Math.floor(s) : 0;
      return Number.isFinite(v) && v > 0 ? v : s;
    },
    /** Position dans le film = position demandée au flux + temps écoulé dans ce flux. */
    positionReelle(depuis, courant) { return (Number(depuis) || 0) + (Number(courant) || 0); },
    /** Position où sauter : secondes entières (comme ?depuis=), entre le début et la dernière seconde connue. */
    cibleSaut(t, duree) {
      let x = Math.max(0, Math.floor(Number(t) || 0));
      const d = Math.floor(Number(duree) || 0);
      if (d > 0) x = Math.min(x, Math.max(0, d - 1));
      return x;
    },
    /** Flèches du clavier : 10 s en arrière ou en avant ; 0 pour les autres touches. */
    pasClavier(key) { return key === 'ArrowRight' ? 10 : key === 'ArrowLeft' ? -10 : 0; },
    /** Position à garder pour la reprise : celle demandée tant qu'un saut attend son image, la vraie sinon. */
    positionReprise(depuis, courant, attente) { return attente != null ? Number(attente) || 0 : logique.positionReelle(depuis, courant); },
    /** Un sous-titre du film, recalé sur le flux qui commence à `depuis` ; null s'il est déjà passé. */
    decalerSousTitre(debut, fin, depuis) {
      const d = Number(depuis) || 0, f = (Number(fin) || 0) - d;
      if (!(f > 0)) return null;
      return { debut: Math.max(0, (Number(debut) || 0) - d), fin: f };
    },
    /** « 1:10:05 / 2:00:00 », ou le temps seul si la durée est inconnue. */
    texteTemps(pos, duree) { return Number(duree) > 0 ? `${logique.mmss(pos)} / ${logique.mmss(duree)}` : logique.mmss(pos); },
  };

  let ouvert = null; // une seule lecture plein écran à la fois

  function fermer() {
    if (!ouvert) return;
    try { ouvert.noter(); } catch { /* rien */ }
    try { ouvert.arreter?.(); } catch { /* rien */ }
    try { ouvert.racine.remove(); } catch { /* rien */ }
    try { document.removeEventListener('keydown', ouvert.clavier, true); } catch { /* rien */ }
    ouvert = null;
  }

  /** Ouvre le lecteur plein écran pour une cible {id, titre, type, duree_s, reprise_s, sousTitres, segments, source, flux}. */
  async function ouvrir(cible, opts = {}) {
    fermer();
    if (!document.getElementById('vlCss')) document.head.append(el('style', { id: 'vlCss' }, CSS));
    // Reprise : pour un flux transcodé (non cherchable côté navigateur), on repart de la position directement au serveur.
    const depuis = (cible.source !== 'yt' && logique.doitReprendre(cible.reprise_s, cible.duree_s)) ? Math.floor(Number(cible.reprise_s) || 0) : 0;
    // L'adresse (et les contrôles) ne sont posés qu'une fois su si le titre est converti (plus bas).
    const video = el('video', { class: 'vl-video', playsinline: true, preload: 'metadata' });
    const pistes = (cible.sousTitres || []).map((st) => el('track', { kind: 'subtitles', label: st.label || st.lang || 'Sous-titres', srclang: st.lang || 'fr', src: logique.sousTitresUrl(cible.id, st.lang) }));
    for (const p of pistes) video.append(p);
    const attente = el('div', { class: 'vl-attente', role: 'status', 'aria-live': 'polite', hidden: true });
    const cadre = el('div', { class: 'vl-cadre' }, video, attente);
    const chipReprise = logique.doitReprendre(cible.reprise_s, cible.duree_s) ? el('span', { class: 'vl-chip' }, `Reprise à ${logique.mmss(cible.reprise_s)}`) : null;
    const bas = el('div', { class: 'vl-bas' },
      chipReprise,
      el('button', { class: 'vl-b', type: 'button', onclick: () => {
        if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
        // Converti : tout le lecteur passe en plein écran, sinon la barre à soi (hors du cadre) y manquerait.
        (etat.converti && racine.requestFullscreen ? racine : cadre.requestFullscreen ? cadre : video).requestFullscreen?.();
      } }, 'Plein écran'),
      opts.ecrans !== false ? el('button', { class: 'vl-b', type: 'button', onclick: () => { fermer(); opts.surEcran?.(cible); } }, 'Envoyer sur un écran') : null);
    const haut = el('div', { class: 'vl-haut' },
      el('b', { title: cible.titre || '' }, cible.titre || 'Lecture'),
      cible.sousTitre ? el('small', {}, cible.sousTitre) : null,
      el('button', { class: 'vl-x', type: 'button', onclick: fermer }, 'Fermer'));
    const racine = el('div', { class: 'vl', role: 'dialog', 'aria-label': `Lecture : ${cible.titre || ''}` }, haut, cadre, bas);
    (document.body || document.documentElement).append(racine);

    // État d'un film converti : le flux commence à `depuis` ; `cibleAttente` = position demandée tant que son image
    // n'est pas revenue ; `minuteur` = saut pas encore lancé (deux appuis rapides ne relancent FFmpeg qu'une fois).
    const etat = { converti: false, duree: 0, depuis: 0, cibleAttente: null, minuteur: null, glisse: false };
    const position = () => logique.positionReprise(etat.depuis, video.currentTime || 0, etat.cibleAttente);
    const noter = () => {
      if (cible.source === 'yt') return; // l'historique YouTube est noté au moment de l'ouverture, pas la position
      const pos = etat.converti ? position() : (video.currentTime || 0);
      const dur = etat.converti ? etat.duree : (video.duration || cible.duree_s || 0);
      if (pos < 2) return;
      try { fetch('/venus/reprise', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(logique.corpsReprise(cible, pos, dur)), keepalive: true }).catch(() => {}); } catch { /* hors ligne : on réessaiera plus tard */ }
    };
    let demanderSaut = null; // posé seulement pour un film converti
    const clavier = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); fermer(); return; }
      const pas = etat.converti && demanderSaut ? logique.pasClavier(e.key) : 0;
      const t = e.target || {};
      const saisie = t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'range');
      if (!pas || saisie || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault(); demanderSaut(position() + pas);
    };
    document.addEventListener('keydown', clavier, true);
    const moi = { racine, noter, clavier, arreter: null };
    ouvert = moi;

    // Comment Odin sert ce titre : tel quel (le navigateur cherche lui-même) ou converti (on cherche par ?depuis=).
    if (cible.source !== 'yt' && !cible.flux && cible.id != null) {
      attente.textContent = 'Chargement…'; attente.hidden = false; // pas d'écran noir muet pendant la question
      etat.converti = logique.estConverti(await lirePlan(cible.id));
      if (ouvert !== moi) return ouvert; // fermé pendant la question
      attente.hidden = true;
    }

    let dernier = 0;
    if (etat.converti) {
      etat.duree = logique.dureeAffichee(cible.duree_s, video.duration, true);
      etat.depuis = depuis;
      const barre = construireBarre();
      racine.insertBefore(barre.noeud, bas);
      // Les sous-titres sont datés dans le FILM ; le flux, lui, commence à `depuis` : on les recale à chaque saut.
      const origines = new Map();
      const recaler = (tt) => {
        if (!tt || !tt.cues || !tt.cues.length && !origines.has(tt)) return;
        let o = origines.get(tt);
        if (!o) { o = Array.from(tt.cues).map((cue) => ({ cue, debut: cue.startTime, fin: cue.endTime, dedans: true })); origines.set(tt, o); }
        for (const x of o) {
          const d = logique.decalerSousTitre(x.debut, x.fin, etat.depuis);
          try {
            if (d) { if (!x.dedans) { tt.addCue(x.cue); x.dedans = true; } x.cue.startTime = d.debut; x.cue.endTime = d.fin; }
            else if (x.dedans) { tt.removeCue(x.cue); x.dedans = false; }
          } catch { /* une piste fermée entre-temps */ }
        }
      };
      const recalerTout = () => { for (const tt of Array.from(video.textTracks || [])) recaler(tt); };
      for (const p of pistes) p.addEventListener('load', () => { origines.delete(p.track); recaler(p.track); });
      const finAttente = () => { etat.cibleAttente = null; attente.hidden = true; };
      const montrerAttente = (t) => { attente.textContent = `Chargement à ${logique.mmss(t)}…`; attente.hidden = false; };
      const sauter = (t) => {
        etat.minuteur = null; etat.depuis = t; dernier = t;
        recalerTout();
        video.src = logique.avecDepuis(logique.fluxUrl(cible), t);
        // Lecture refusée (un geste manque) : l'attente est retirée, le bouton Lecture est là.
        const refus = (e) => { if (e && e.name === 'NotAllowedError' && !etat.minuteur) { attente.hidden = true; barre.etats(); } };
        try { const p = video.play?.(); p?.catch?.(refus); } catch (e) { refus(e); }
      };
      demanderSaut = (t) => {
        const x = logique.cibleSaut(t, etat.duree);
        etat.cibleAttente = x; barre.maj(x); montrerAttente(x);
        clearTimeout(etat.minuteur);
        etat.minuteur = setTimeout(() => sauter(x), Number(opts.delaiSaut) >= 0 ? Number(opts.delaiSaut) : 350);
      };
      barre.surSaut = demanderSaut;
      moi.arreter = () => { clearTimeout(etat.minuteur); try { video.removeAttribute('src'); video.load?.(); } catch { /* rien */ } };
      video.addEventListener('playing', () => { if (!etat.minuteur) finAttente(); });
      video.addEventListener('timeupdate', () => {
        if (etat.cibleAttente != null && !etat.minuteur && (video.currentTime || 0) > 0) finAttente();
        barre.maj(position());
      });
      for (const ev of ['play', 'pause', 'volumechange']) video.addEventListener(ev, () => barre.etats());
      video.addEventListener('error', () => { barre.noeud.hidden = true; finAttente(); });
      etat.cibleAttente = depuis; montrerAttente(depuis); barre.maj(depuis); barre.etats();
      recalerTout();
    } else {
      video.controls = true;
      video.addEventListener('loadedmetadata', () => { if (logique.doitReprendre(cible.reprise_s, cible.duree_s)) { try { video.currentTime = Number(cible.reprise_s) || 0; } catch { /* rien */ } } });
    }
    video.addEventListener('timeupdate', () => {
      const t = etat.converti ? position() : (video.currentTime || 0);
      const saut = etat.converti ? null : logique.prochainSaut(t, cible.segments);
      if (saut != null) { try { video.currentTime = saut; } catch { /* rien */ } return; }
      if (t - dernier > 10) { dernier = t; noter(); }
    });
    video.addEventListener('pause', noter);
    video.addEventListener('ended', () => { noter(); opts.surFin?.(cible); });
    // Lecture ratée : on demande à Odin POURQUOI (fichier absent, FFmpeg absent…) et on le dit, au lieu d'un message vague.
    video.addEventListener('error', async () => {
      const msg = el('p', { class: 'vl-err', role: 'alert' }, 'Lecture impossible pour le moment (flux indisponible).');
      cadre.replaceChildren(msg);
      if (cible.source === 'yt' || !cible.id) return;
      try { const r = await fetch(logique.planUrl(cible.id), { headers: { 'x-odin': '1' } }); const d = await r.json(); if (d && d.error) msg.textContent = `Lecture impossible : ${d.error}`; } catch { /* Odin injoignable : le message général reste */ }
    });
    video.src = logique.avecDepuis(logique.fluxUrl(cible), depuis);
    try { await video.play?.(); } catch (e) { /* le navigateur attend parfois un geste : les contrôles sont là */ if (etat.converti && e && e.name === 'NotAllowedError' && !etat.minuteur) attente.hidden = true; }
    return ouvert;

    /** La barre de temps d'un film converti : Lecture/Pause, position, durée entière, Son, Sous-titres. */
    function construireBarre() {
      const b = { surSaut: null, noeud: null, maj: null, etats: null };
      const btnLecture = el('button', { class: 'vl-b', type: 'button', onclick: () => { if (video.paused) { const p = video.play?.(); p?.catch?.(() => {}); } else video.pause?.(); } }, 'Pause');
      const curseur = el('input', { class: 'vl-curseur', type: 'range', min: '0', max: String(etat.duree), step: '1', 'aria-label': 'Position dans le film' });
      curseur.value = '0';
      if (!(etat.duree > 0)) { curseur.disabled = true; curseur.hidden = true; }
      const temps = el('span', { class: 'vl-temps' });
      const btnSon = el('button', { class: 'vl-b', type: 'button', 'aria-pressed': 'false', onclick: () => { video.muted = !video.muted; b.etats(); } }, 'Son');
      let piste = -1;
      const btnSt = pistes.length ? el('button', { class: 'vl-b', type: 'button', onclick: () => {
        const tts = Array.from(video.textTracks || []);
        piste = piste + 1 >= tts.length ? -1 : piste + 1;
        tts.forEach((tt, i) => { tt.mode = i === piste ? 'showing' : 'disabled'; });
        b.etats();
      } }, 'Sous-titres : non') : null;
      curseur.addEventListener('input', () => { etat.glisse = true; temps.textContent = logique.texteTemps(Number(curseur.value), etat.duree); });
      curseur.addEventListener('change', () => { etat.glisse = false; b.surSaut?.(Number(curseur.value)); });
      b.maj = (pos) => {
        const txt = logique.texteTemps(pos, etat.duree);
        if (!etat.glisse) { temps.textContent = txt; curseur.value = String(Math.floor(pos)); }
        curseur.setAttribute('aria-valuetext', txt);
      };
      b.etats = () => {
        btnLecture.textContent = video.paused ? 'Lecture' : 'Pause';
        btnSon.textContent = video.muted ? 'Son coupé' : 'Son'; btnSon.setAttribute('aria-pressed', video.muted ? 'true' : 'false');
        if (btnSt) { const tt = Array.from(video.textTracks || [])[piste]; btnSt.textContent = `Sous-titres : ${tt ? (tt.label || tt.language || 'oui') : 'non'}`; }
      };
      b.noeud = el('div', { class: 'vl-barre' }, btnLecture, curseur, temps, btnSon, btnSt);
      return b;
    }
  }

  /** Demande à Odin comment il sert ce titre (/venus/plan) ; null s'il ne répond pas vite (on garde alors le navigateur). */
  async function lirePlan(id) {
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const minuteur = ac ? setTimeout(() => ac.abort(), 3000) : null;
    try { const r = await fetch(logique.planUrl(id), { headers: { 'x-odin': '1' }, ...(ac ? { signal: ac.signal } : {}) }); return await r.json(); }
    catch { return null; }
    finally { if (minuteur) clearTimeout(minuteur); }
  }

  window.OdinVenusLecteur = { ouvrir, fermer, logique };
})();
