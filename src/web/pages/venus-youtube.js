// Onglet YouTube de Vénus, sans publicité : accueil / nouveautés, recherche, vidéo + suggestions, chaînes + abonnements,
// historique privé et effaçable. La lecture passe par le flux direct réglé côté serveur (instance Invidious/Piped ou
// yt-dlp), sans compte Google : comme la pub de YouTube n'est pas dans ce flux, il n'y a aucune pub — rien à
// télécharger ni à effacer image par image. Les sponsors DANS la vidéo sont sautés par les segments (SponsorBlock +
// secours IA sur la transcription, côté serveur), jamais image par image. La page ne connaît ni clé ni instance :
// elle n'appelle que les routes /venus/yt/* d'Odin (le flux et les miniatures viennent de l'instance choisie par toi).
// Droit d'auteur : on lit des flux publics, on ne contourne aucune protection. Alternative à FreeTube, NewPipe,
// Invidious, Piped.
(() => {
  'use strict';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const CSS = `
.yt{display:flex;flex-direction:column;gap:14px;color:var(--ink,#eef0f6)}
.yt *{box-sizing:border-box}
.yt-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.yt-seg{display:inline-flex;gap:4px;padding:4px;border-radius:999px;background:var(--panel2,#ffffff0a);border:1px solid var(--line,#ffffff10);flex-wrap:wrap}
.yt-seg button{font:600 13px inherit;padding:8px 14px;min-height:36px;border-radius:999px;color:var(--muted,#9aa1b2);background:none;border:0;cursor:pointer}
.yt-seg button[aria-selected=true]{background:color-mix(in srgb,var(--accent,#e2a93b) 14%,transparent);color:var(--accent,#e2a93b);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent,#e2a93b) 33%,transparent)}
.yt-ch{display:flex;gap:8px;flex:1;min-width:220px}
.yt-ch input{flex:1;min-width:0;min-height:40px;border-radius:12px;border:1px solid var(--line,#ffffff1a);background:var(--field,#0b0d12);color:inherit;padding:0 12px;font:inherit}
.yt-ch button,.yt-b{min-height:40px;border-radius:12px;border:1px solid var(--line,#ffffff1a);background:var(--panel2,#ffffff0a);color:inherit;font:600 13px inherit;cursor:pointer;padding:0 14px}
.yt-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.yt-card{display:flex;flex-direction:column;gap:6px;text-align:left;background:none;border:0;color:inherit;cursor:pointer;padding:0}
.yt-vign{position:relative;width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:var(--panel2,#11141b);display:grid;place-items:center}
.yt-vign img{width:100%;height:100%;object-fit:cover}
.yt-vign .ph{font-size:26px;opacity:.4}
.yt-vign .d{position:absolute;right:6px;bottom:6px;background:#000a;color:#fff;font:600 11px inherit;padding:1px 6px;border-radius:6px}
.yt-card b{font-size:14px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.yt-card .m{font-size:12.5px;color:var(--muted,#9aa1b2)}
.yt-video{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;align-items:start}
@media (max-width:900px){.yt-video{grid-template-columns:1fr}}
.yt-sug{display:flex;flex-direction:column;gap:10px}
.yt-sug .yt-card{flex-direction:row;gap:10px}.yt-sug .yt-vign{width:150px;flex:none}
.yt-chaine{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.yt-ab{min-height:40px;border-radius:999px;border:1px solid color-mix(in srgb,var(--accent,#e2a93b) 33%,transparent);background:color-mix(in srgb,var(--accent,#e2a93b) 14%,transparent);color:var(--accent,#e2a93b);font:600 13px inherit;cursor:pointer;padding:0 16px}
.yt-ab.on{background:var(--panel2,#ffffff0a);border-color:var(--line,#ffffff1a);color:var(--muted,#cfd3dd)}
.yt-note{font-size:12px;color:var(--dim,#8b93a6);line-height:1.5;border-top:1px solid var(--line,#ffffff12);padding-top:10px}
.yt-vide{color:var(--muted,#9aa1b2);padding:10px 2px}
@media (pointer:coarse){.yt-seg button,.yt-ch button,.yt-b,.yt-ab{min-height:44px}}`;

  const jget = async (url) => { const r = await fetch(url, { headers: { 'x-odin': '1' } }); if (!r.ok) throw new Error('indisponible'); return r.json(); };
  const jenvoi = async (url, methode, corps) => { const r = await fetch(url, { method: methode, headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: corps ? JSON.stringify(corps) : undefined }); return r.json().catch(() => ({})); };

  // --- Logique pure (essayable sans navigateur) --------------------------------------------------
  const logique = {
    accueilUrl() { return '/venus/yt/accueil'; },
    rechercheUrl(q) { return `/venus/yt/recherche?q=${encodeURIComponent(String(q || ''))}`; },
    videoUrl(id) { return `/venus/yt/video/${encodeURIComponent(String(id))}`; },
    chaineUrl(id) { return `/venus/yt/chaine/${encodeURIComponent(String(id))}`; },
    abonnementsUrl() { return '/venus/yt/abonnements'; },
    historiqueUrl() { return '/venus/yt/historique'; },
    segmentsUrl(id) { return `/venus/yt/segments/${encodeURIComponent(String(id))}`; },
    /** Durée mm:ss / h:mm:ss. */
    duree(s) { s = Math.max(0, Math.floor(Number(s) || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; const d2 = (n) => String(n).padStart(2, '0'); return h ? `${h}:${d2(m)}:${d2(x)}` : `${m}:${d2(x)}`; },
    /** Nombre de vues en court : 1,2 M · 834 k · 57. */
    vues(n) { n = Number(n) || 0; if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} M vues`; if (n >= 1e3) return `${Math.round(n / 1e3)} k vues`; return `${n} vue${n > 1 ? 's' : ''}`; },
    /** La miniature fournie par l'instance (le flux YouTube passe déjà par cette instance choisie par toi). */
    miniature(v) { const u = v && (v.miniature || v.vignette || v.thumbnail); return typeof u === 'string' && u ? u : null; },
    /** Choisit un flux lisible dans le navigateur : on préfère un flux combiné (son + image). */
    choisirFlux(flux) {
      if (!Array.isArray(flux) || !flux.length) return null;
      return (flux.find((f) => f && f.type === 'mixte') || flux.find((f) => f && f.type === 'video') || flux[0]).url || null;
    },
  };

  function dessiner(host, deps = {}) {
    if (!document.getElementById('ytCss')) document.head.append(el('style', { id: 'ytCss' }, CSS));
    const lecteur = deps.lecteur || window.OdinVenusLecteur;
    const toast = deps.toast || (() => {});
    const racine = el('div', { class: 'yt' });
    host.append(racine);
    const S = { vue: 'accueil', q: '' };

    const lire = async (v) => {
      let flux = null, segments = [], duree = v.duree;
      try { const d = await jget(logique.videoUrl(v.id)); flux = logique.choisirFlux(d.flux); duree = (d.video && d.video.duree) || duree; } catch { /* rien */ }
      try { const g = await jget(logique.segmentsUrl(v.id)); segments = g.segments || []; } catch { /* pas de SponsorBlock : on lit quand même */ }
      if (!flux) { toast('Flux indisponible (règle une instance Invidious/Piped dans les réglages).'); return; }
      lecteur?.ouvrir({ id: v.id, titre: v.titre, sousTitre: v.chaine, source: 'yt', type: 'youtube', duree_s: duree, segments, flux }, { ecrans: false });
    };

    const carteVideo = (v, sug) => { const mn = logique.miniature(v); return el('button', { class: `yt-card${sug ? ' sug' : ''}`, type: 'button', onclick: () => lire(v) },
      el('span', { class: 'yt-vign' }, mn ? el('img', { src: mn, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'ph' }, '▶'), v.duree ? el('span', { class: 'd' }, logique.duree(v.duree)) : null),
      el('b', {}, v.titre || 'Vidéo'),
      el('span', { class: 'm' }, [v.chaine, v.vues != null ? logique.vues(v.vues) : null, v.publie].filter(Boolean).join(' · '))); };

    const grille = (videos) => videos && videos.length ? el('div', { class: 'yt-grille' }, ...videos.map((v) => carteVideo(v))) : el('p', { class: 'yt-vide' }, 'Rien à montrer pour l\'instant.');

    const estAbonne = (abos, id) => Array.isArray(abos) && abos.some((a) => a.chaineId === id);
    const boutonAbonne = (ch, onToggle) => { let on = !!ch.abonne; const b = el('button', { class: `yt-ab${on ? ' on' : ''}`, type: 'button', onclick: async () => { const d = await jenvoi(logique.abonnementsUrl(), 'POST', on ? { chaine_id: ch.id, faire: 'retirer' } : { chaine_id: ch.id, nom: ch.nom || '' }); on = estAbonne(d.abonnements, ch.id); b.classList.toggle('on', on); b.textContent = on ? 'Abonné' : 'S\'abonner'; onToggle?.(on); } }, on ? 'Abonné' : 'S\'abonner'); return b; };

    const corps = el('div');
    const note = el('p', { class: 'yt-note' }, 'Lecture par le flux direct d\'Odin : pas de pub, pas de compte Google, historique privé gardé chez toi. Les sponsors dans la vidéo sont sautés automatiquement. On lit des flux publics sans contourner aucune protection (droit d\'auteur respecté). Alternative à FreeTube, NewPipe, Invidious, Piped.');

    const onglets = () => el('div', { class: 'yt-bar' },
      el('div', { class: 'yt-seg', role: 'tablist', 'aria-label': 'YouTube' }, ...[['accueil', 'Accueil'], ['recherche', 'Recherche'], ['abonnements', 'Abonnements'], ['historique', 'Historique']].map(([id, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(S.vue === id || (id === 'recherche' && (S.vue === 'video' || S.vue === 'chaine'))), onclick: () => { S.vue = id; rendre(); } }, t))),
      el('form', { class: 'yt-ch', onsubmit: (e) => { e.preventDefault(); const q = e.target.q.value.trim(); if (q) { S.q = q; S.vue = 'recherche'; rendre(); } } },
        el('input', { name: 'q', type: 'search', placeholder: 'Chercher sur YouTube…', value: S.q, 'aria-label': 'Chercher sur YouTube' }), el('button', { type: 'submit' }, 'Chercher')));

    const rendre = async () => {
      racine.replaceChildren(onglets(), corps, note);
      corps.replaceChildren(el('p', { class: 'yt-vide' }, 'Chargement…'));
      try {
        if (S.vue === 'accueil') corps.replaceChildren(grille((await jget(logique.accueilUrl())).videos));
        else if (S.vue === 'recherche') {
          if (!S.q) { corps.replaceChildren(el('p', { class: 'yt-vide' }, 'Tape un titre, une chaîne, un sujet.')); return; }
          corps.replaceChildren(grille((await jget(logique.rechercheUrl(S.q))).videos));
        } else if (S.vue === 'chaine') {
          const d = await jget(logique.chaineUrl(S.chaineId)), abos = await jget(logique.abonnementsUrl()).then((x) => x.abonnements).catch(() => []);
          corps.replaceChildren(el('div', { style: 'display:flex;flex-direction:column;gap:14px' },
            el('div', { class: 'yt-chaine' }, el('b', { style: 'font-size:17px' }, d.nom || 'Chaîne'), boutonAbonne({ id: S.chaineId, nom: d.nom, abonne: estAbonne(abos, S.chaineId) })),
            grille(d.videos)));
        } else if (S.vue === 'abonnements') {
          const d = await jget(logique.abonnementsUrl());
          corps.replaceChildren((d.abonnements && d.abonnements.length)
            ? el('div', { style: 'display:flex;flex-direction:column;gap:10px' }, ...d.abonnements.map((ch) => el('div', { class: 'yt-chaine' }, el('button', { class: 'yt-b', type: 'button', onclick: () => { S.chaineId = ch.chaineId; S.vue = 'chaine'; rendre(); } }, ch.nom || 'Chaîne'), boutonAbonne({ id: ch.chaineId, nom: ch.nom, abonne: true }))))
            : el('p', { class: 'yt-vide' }, 'Aucun abonnement. Cherche une chaîne et abonne-toi : rien ne passe par un compte Google.'));
        } else if (S.vue === 'historique') {
          const d = await jget(logique.historiqueUrl());
          const videos = (d.historique || []).map((h) => ({ id: h.videoId, titre: h.titre, chaine: '' }));
          corps.replaceChildren(el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
            el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, el('b', {}, 'Historique privé'), el('button', { class: 'yt-b', type: 'button', onclick: async () => { if (window.OdinDialog && !(await window.OdinDialog.confirm('Effacer tout l\'historique YouTube ?', { titre: 'Effacer l\'historique', ok: 'Effacer', danger: true }))) return; await jenvoi(logique.historiqueUrl(), 'DELETE'); toast('Historique YouTube effacé.'); rendre(); } }, 'Tout effacer')),
            grille(videos)));
        }
      } catch { corps.replaceChildren(el('p', { class: 'yt-vide' }, 'YouTube indisponible pour le moment (hors ligne ou instance non réglée). Réessaie plus tard.')); }
    };
    rendre();
    return { rendre };
  }

  window.OdinVenusYoutube = { dessiner, logique };
})();
