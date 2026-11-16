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
@media (max-width:480px){.vl-haut b{font-size:15px}}`;

  // --- Logique pure (essayable sans navigateur) --------------------------------------------------
  const logique = {
    /** Adresse du flux dans Odin (jamais d'adresse extérieure). */
    fluxUrl(cible) {
      if (cible && cible.flux) return cible.flux;
      if (cible && cible.source === 'yt') return `/venus/yt/flux/${encodeURIComponent(String(cible.id))}`;
      return `/venus/flux/${encodeURIComponent(String(cible && cible.id))}`;
    },
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
  };

  let ouvert = null; // une seule lecture plein écran à la fois

  function fermer() {
    if (!ouvert) return;
    try { ouvert.noter(); } catch { /* rien */ }
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
    const video = el('video', { class: 'vl-video', controls: true, playsinline: true, preload: 'metadata', src: logique.avecDepuis(logique.fluxUrl(cible), depuis) });
    for (const st of (cible.sousTitres || [])) video.append(el('track', { kind: 'subtitles', label: st.label || st.lang || 'Sous-titres', srclang: st.lang || 'fr', src: logique.sousTitresUrl(cible.id, st.lang) }));
    const cadre = el('div', { class: 'vl-cadre' }, video);
    const chipReprise = logique.doitReprendre(cible.reprise_s, cible.duree_s) ? el('span', { class: 'vl-chip' }, `Reprise à ${logique.mmss(cible.reprise_s)}`) : null;
    const bas = el('div', { class: 'vl-bas' },
      chipReprise,
      el('button', { class: 'vl-b', type: 'button', onclick: () => { if (document.fullscreenElement) document.exitFullscreen?.(); else (cadre.requestFullscreen ? cadre : video).requestFullscreen?.(); } }, 'Plein écran'),
      opts.ecrans !== false ? el('button', { class: 'vl-b', type: 'button', onclick: () => { fermer(); opts.surEcran?.(cible); } }, 'Envoyer sur un écran') : null);
    const haut = el('div', { class: 'vl-haut' },
      el('b', { title: cible.titre || '' }, cible.titre || 'Lecture'),
      cible.sousTitre ? el('small', {}, cible.sousTitre) : null,
      el('button', { class: 'vl-x', type: 'button', onclick: fermer }, 'Fermer'));
    const racine = el('div', { class: 'vl', role: 'dialog', 'aria-label': `Lecture : ${cible.titre || ''}` }, haut, cadre, bas);
    (document.body || document.documentElement).append(racine);

    const noter = () => {
      if (cible.source === 'yt') return; // l'historique YouTube est noté au moment de l'ouverture, pas la position
      const pos = video.currentTime || 0, dur = video.duration || cible.duree_s || 0;
      if (pos < 2) return;
      try { fetch('/venus/reprise', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(logique.corpsReprise(cible, pos, dur)), keepalive: true }).catch(() => {}); } catch { /* hors ligne : on réessaiera plus tard */ }
    };
    const clavier = (e) => { if (e.key === 'Escape') { e.preventDefault(); fermer(); } };
    document.addEventListener('keydown', clavier, true);
    ouvert = { racine, noter, clavier };

    video.addEventListener('loadedmetadata', () => { if (logique.doitReprendre(cible.reprise_s, cible.duree_s)) { try { video.currentTime = Number(cible.reprise_s) || 0; } catch { /* rien */ } } });
    let dernier = 0;
    video.addEventListener('timeupdate', () => {
      const t = video.currentTime || 0;
      const saut = logique.prochainSaut(t, cible.segments);
      if (saut != null) { try { video.currentTime = saut; } catch { /* rien */ } return; }
      if (t - dernier > 10) { dernier = t; noter(); }
    });
    video.addEventListener('pause', noter);
    video.addEventListener('ended', () => { noter(); opts.surFin?.(cible); });
    video.addEventListener('error', () => { cadre.replaceChildren(el('p', { class: 'vl-err' }, 'Lecture impossible pour le moment (flux indisponible). Essaie « Envoyer sur un écran ».')); });
    try { await video.play?.(); } catch { /* le navigateur attend parfois un geste : les contrôles sont là */ }
    return ouvert;
  }

  window.OdinVenusLecteur = { ouvrir, fermer, logique };
})();
