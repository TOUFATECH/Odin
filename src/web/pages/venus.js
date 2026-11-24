// Page complète de Vénus (le serveur multimédia de la maison), native et SANS serveur extérieur : tout passe par Odin.
// Onglets :
//   - Odéon : la bibliothèque (films, séries, musique, livres audio) + le lecteur dans le navigateur, ma liste,
//     demandes, et le lecteur de livres & BD (Odyssée, gardé tel quel) ;
//   - YouTube : l'onglet sans pub (flux direct d'Odin), délégué à OdinVenusYoutube ;
//   - Écrans : les écrans de la maison, leur télécommande, et le QR pour piloter depuis un téléphone ;
//   - Acquisition : Delta / Hnoss / Sirius / Pléiades / Odyssée / Comète — en lecture pour la phase 1 ;
//   - État : serveur joignable, santé, nouveautés.
// La page ne connaît ni la base ni aucun serveur extérieur : elle n'appelle que les actions du module (via
// /api/valhalla/act, module « freyja ») et les routes /venus/* d'Odin. Toute confirmation passe par OdinDialog
// (aucune fenêtre native). Lisible à 1280 px (ordinateur) comme à 390 px (téléphone).
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const act = async (action, input = {}) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'freyja', action, input }) })).json();
  const vget = async (chemin) => { const r = await fetch(chemin, { headers: { 'x-odin': '1' } }); if (!r.ok) throw new Error('indisponible'); return r.json(); };
  const vpost = async (chemin, corps) => { const r = await fetch(chemin, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: corps ? JSON.stringify(corps) : '{}' }); return r.json().catch(() => ({})); };

  const CSS = `
.vn{--ac:var(--accent,#e2a93b);color:var(--ink,#eef0f6);display:flex;flex-direction:column;gap:16px}
.vn *{box-sizing:border-box}
.vn-tete{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.vn-tete .ico{width:42px;height:42px;border-radius:13px;background:color-mix(in srgb,var(--ac) 14%,transparent);color:var(--ac);display:grid;place-items:center;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ac) 30%,transparent);font-size:22px}
.vn-tete b{font-size:20px;letter-spacing:-.2px}.vn-tete .sub{font-size:12.5px;color:var(--muted,#9aa1b2)}
.vn-seg{display:inline-flex;gap:4px;padding:4px;border-radius:999px;background:var(--panel2,#ffffff0a);border:1px solid var(--line,#ffffff10);flex-wrap:wrap}
.vn-seg button{font:600 13px inherit;padding:8px 15px;min-height:38px;border-radius:999px;color:var(--muted,#9aa1b2);background:none;border:0;cursor:pointer;white-space:nowrap}
.vn-seg button[aria-selected=true]{background:color-mix(in srgb,var(--ac) 14%,transparent);color:var(--ac);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ac) 33%,transparent)}
.vn-sous{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.vn-sous .f{display:inline-flex;gap:4px;padding:3px;border-radius:999px;background:var(--panel2,#ffffff08);border:1px solid var(--line,#ffffff10);flex-wrap:wrap}
.vn-sous .f button{font:600 12.5px inherit;padding:6px 12px;min-height:34px;border-radius:999px;color:var(--muted,#9aa1b2);background:none;border:0;cursor:pointer}
.vn-sous .f button[aria-pressed=true]{background:var(--sel,#ffffff14);color:var(--ink,#eef0f6)}
.vn-ch{display:flex;gap:8px;flex:1;min-width:200px}
.vn-ch input{flex:1;min-width:0;min-height:38px;border-radius:12px;border:1px solid var(--line,#ffffff1a);background:var(--field,#0b0d12);color:inherit;padding:0 12px;font:inherit}
.vn-b{min-height:38px;border-radius:12px;border:1px solid var(--line,#ffffff1a);background:var(--panel2,#ffffff0a);color:inherit;font:600 13px inherit;cursor:pointer;padding:0 14px}
.vn-b:hover{border-color:var(--field-h,#ffffff33)}
.vn-b.ac{border-color:color-mix(in srgb,var(--ac) 40%,transparent);background:color-mix(in srgb,var(--ac) 14%,transparent);color:var(--ac)}
.vn-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.vn-card{display:flex;flex-direction:column;gap:6px;text-align:left;background:none;border:0;color:inherit;cursor:pointer;padding:0}
.vn-aff{position:relative;width:100%;aspect-ratio:2/3;border-radius:12px;overflow:hidden;background:linear-gradient(160deg,var(--panel2,#232838),var(--panel,#13151c));display:grid;place-items:center}
.vn-aff img{width:100%;height:100%;object-fit:cover}
.vn-aff .ph{font-size:30px;opacity:.5}
.vn-aff .pc{position:absolute;left:0;bottom:0;height:4px;background:var(--ac)}
.vn-card b{font-size:13.5px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.vn-card .m{font-size:12px;color:var(--muted,#9aa1b2)}
.vn-sec{border:1px solid var(--line,#ffffff14);border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:12px;background:var(--panel,#1b1e27)}
.vn-sec h3{margin:0;font-size:15px}
.vn-liste{display:flex;flex-direction:column;gap:8px}
.vn-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--line,#ffffff10)}.vn-row:last-child{border-bottom:0}
.vn-row .t{flex:1;min-width:140px}
.vn-pre{white-space:pre-wrap;font:13px/1.55 ui-monospace,monospace;color:var(--ink,#c7ccd8);margin:0;max-height:360px;overflow:auto}
.vn-vide{color:var(--muted,#9aa1b2);padding:8px 2px}
.vn-note{font-size:12px;color:var(--dim,#8b93a6);line-height:1.5}
.vn-ecran{border:1px solid var(--line,#ffffff14);border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:12px;background:var(--panel2,#ffffff06)}
.vn-ecran .nom{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.vn-ecran .nom b{font-size:16px}
.vn-ecran .pt{display:inline-flex;align-items:center;gap:6px;min-height:26px;padding:0 10px;border-radius:999px;font:600 12px inherit}
.vn-ecran .on{background:var(--good-l,#3ecf8e1f);color:var(--good,#3ecf8e)}.vn-ecran .off{background:var(--panel2,#ffffff0a);color:var(--muted,#9aa1b2)}
.vn-cols{display:grid;grid-template-columns:1fr;gap:16px}
@media (min-width:980px){.vn-cols{grid-template-columns:1fr 240px}}
/* Zone d'envoi : cibles de 44 px partout (téléphone et souris), une barre par fichier. */
.vn-env .vn-b,.vn-env select,.vn-env .choisir{min-height:44px}
.vn-env select{border-radius:12px;border:1px solid var(--line);background:var(--field);color:inherit;padding:0 10px;font:inherit;flex:1 1 220px;min-width:0;max-width:100%}
.vn-env .choisir{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 16px;border-radius:12px;cursor:pointer;font:600 13.5px inherit;border:1px solid color-mix(in srgb,var(--ac) 40%,transparent);background:color-mix(in srgb,var(--ac) 14%,transparent);color:var(--ac)}
.vn-env .choisir:focus-within{outline:2px solid var(--ac);outline-offset:2px}
.vn-env .choisir[aria-disabled=true]{opacity:.5;cursor:not-allowed}
.vn-env .choisir input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.vn-env .depose{border:1.5px dashed var(--line,#ffffff26);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;align-items:stretch}
.vn-env .depose.sur{border-color:var(--ac);background:color-mix(in srgb,var(--ac) 8%,transparent)}
.vn-fi{display:flex;flex-direction:column;gap:6px;padding:10px 0;border-bottom:1px solid var(--line,#ffffff10)}.vn-fi:last-child{border-bottom:0}
.vn-fi .vn-fi-l1{display:flex;gap:10px;align-items:baseline;justify-content:space-between;flex-wrap:wrap}
.vn-fi .vn-fi-nom{font-weight:600;font-size:13.5px;overflow-wrap:anywhere;min-width:0;flex:1 1 180px}
.vn-fi .vn-fi-pc{font:600 12.5px ui-monospace,monospace;color:var(--muted,#9aa1b2)}
.vn-fi .vn-fi-barre{height:8px;border-radius:999px;background:var(--panel2,#ffffff12);overflow:hidden}
.vn-fi .vn-fi-barre i{display:block;height:100%;width:0;background:var(--ac);transition:width .3s}
.vn-fi.ok .vn-fi-barre i{background:var(--good,#3ecf8e)}.vn-fi.ko .vn-fi-barre i{background:var(--bad,#ff6b6b)}
.vn-fi .vn-fi-etat{font-size:12.5px;color:var(--muted,#9aa1b2);overflow-wrap:anywhere}
.vn-fi.ok .vn-fi-etat{color:var(--good,#3ecf8e)}.vn-fi.ko .vn-fi-etat{color:var(--bad,#ff6b6b);font-weight:600}
@media (prefers-reduced-motion:reduce){.vn-fi .vn-fi-barre i{transition:none}}
@media (pointer:coarse){.vn-seg button,.vn-b,.vn-sous .f button{min-height:44px}}
@media (max-width:420px){.vn-grille{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}.vn-tete b{font-size:18px}}`;

  const TYPES = [['film', 'Films', '🎬'], ['serie', 'Séries', '📺'], ['album', 'Musique', '🎵'], ['livre_audio', 'Livres audio', '🎧']];

  // --- Logique pure (essayable sans navigateur) --------------------------------------------------
  const logique = {
    bibliothequeUrl(type, q) { const p = []; if (type) p.push(`type=${encodeURIComponent(type)}`); if (q) p.push(`q=${encodeURIComponent(q)}`); return `/venus/bibliotheque${p.length ? `?${p.join('&')}` : ''}`; },
    detailUrl(id) { return `/venus/oeuvre/${encodeURIComponent(String(id))}`; },
    ecransUrl() { return '/venus/ecrans'; },
    /** L'interface plein écran de Venus (servie par Odin). */
    appliUrl() { return '/venus/app/#/'; },
    /** Y aller en REMPLAÇANT l'entrée de l'historique : « retour » ramène avant Vénus, pas sur cette page qui renverrait dans Venus. */
    allerAppli(loc) { loc.replace(this.appliUrl()); },
    /**
     * La vue « Vénus » d'Odin (#v-venus) : l'interface de Venus DANS la page d'Odin, le menu d'Odin à côté. Pur.
     *  - poser : le cadre seulement dans la vue, et pour le propriétaire (un membre n'a rien : le serveur le refuse aussi) ;
     *  - ancre : l'adresse /#venus remplace « #app=freyja » ou « #venus » (retour ne renvoie pas dans Vénus), sinon s'ajoute ;
     *  - apresAncre : retour ou avance a quitté #venus, vue encore affichée : la vue à rouvrir (« Applis » plutôt que la
     *    page vide de l'appli) ; null s'il n'y a rien à faire ;
     *  - retirerAncre : en quittant la vue par le menu, « #venus » est retiré (un rechargement ne rouvre pas Vénus).
     */
    vue: {
      poser(vue, proprietaire) { return vue === 'venus' && proprietaire === true; },
      remplacer(ancre) { return /^#(app=freyja|venus)$/.test(String(ancre || '')); },
      apresAncre(ancre, affichee, precedente) {
        if (!affichee || ancre === '#venus') return null;
        return !precedente || precedente === 'venus' ? 'home' : precedente === 'app' ? 'apps' : precedente;
      },
      retirerAncre(vue, ancre) { return vue !== 'venus' && ancre === '#venus'; },
    },
    /**
     * Ouvrir l'interface de Venus plutôt que cette page ? Non pour lire un titre demandé (le lecteur part d'ici), ni quand
     * Venus a demandé la page de gestion (adresse « /?venus=gestion#app=freyja »). Pur.
     */
    versAppli(want, recherche) {
      if (want && (want.lire || want.onglet || want.tab)) return false;
      return !/[?&]venus=gestion(&|$)/.test(String(recherche || ''));
    },
    /** L'adresse de cette page, demandée depuis Venus (« Médiathèques et écrans »). */
    gestionUrl() { return '/?venus=gestion#app=freyja'; },
    /** Affiche locale seulement (chemin Odin ou data:) : jamais une image chargée d'un serveur tiers. */
    afficheLocale(o) { const u = o && (o.affiche || o.poster); return typeof u === 'string' && /^(\/|data:)/.test(u) ? u : null; },
    mmss(s) { s = Math.max(0, Math.floor(Number(s) || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; const d2 = (n) => String(n).padStart(2, '0'); return h ? `${h}:${d2(m)}:${d2(x)}` : `${m}:${d2(x)}`; },
    /** Disposition selon la largeur : « etroit » sur téléphone (390 px), « large » sur ordinateur (1280 px). */
    dispo(largeur) { return Number(largeur) < 700 ? 'etroit' : 'large'; },
    typeLabel(type) { const t = TYPES.find((x) => x[0] === type); return t ? t[1] : type; },
    /** Part d'avancement (0 à 1) d'une œuvre d'après sa reprise. */
    avance(o) { const p = Number(o && o.reprise_s) || 0, d = Number(o && o.duree_s) || 0; return d > 0 ? Math.max(0, Math.min(1, p / d)) : 0; },
    /**
     * L'intention de lire un titre à l'ouverture de la page (`OdinOpenWant.lire`) : un identifiant de cible, l'adresse
     * de flux rendue par l'action « regarder » (/venus/flux/…), ou { cible, oeuvre }. Rend { cible, oeuvre } ou null. Pur.
     */
    cibleVoulue(want) {
      const brut = want && want.lire; let id = brut && typeof brut === 'object' ? (brut.cible || brut.id) : brut;
      id = String(id || '').trim(); if (!id) return null;
      const m = /^\/venus\/flux\/([^?#]+)/.exec(id); if (m) { try { id = decodeURIComponent(m[1]); } catch { return null; } }
      // L'œuvre : donnée, sinon les deux premiers morceaux de l'identifiant (« serie:titre:s2e5 » → « serie:titre »).
      const oeuvre = String((brut && typeof brut === 'object' && brut.oeuvre) || (want && want.oeuvre) || id.split(':').slice(0, 2).join(':'));
      return { cible: id, oeuvre };
    },
    /** Ce que le lecteur reçoit pour une cible, d'après le détail de son œuvre (/venus/oeuvre/…) ; null si absente. Pur. */
    elementLecteur(detail, cibleId) {
      const o = detail && detail.oeuvre; if (!o) return null;
      if (o.id === cibleId) return { id: o.id, titre: o.titre || '', type: 'film', duree_s: o.duree, reprise_s: (detail.reprise && detail.reprise.position_s) || 0, sousTitres: o.sous_titres };
      const l = detail.episodes || detail.pistes || [], e = l.find((x) => x.id === cibleId); if (!e) return null;
      const sxe = e.saison != null ? `S${String(e.saison).padStart(2, '0')}E${String(e.episode ?? 0).padStart(2, '0')}` : '';
      return { id: e.id, titre: `${o.titre || ''} · ${sxe || e.titre || ''}`, type: detail.episodes ? 'episode' : 'piste', duree_s: e.duree || e.duree_s, reprise_s: e.reprise_s || 0, sousTitres: e.sous_titres || e.sousTitres };
    },
  };

  const lecteurDispo = () => window.OdinVenusLecteur;
  // Envoyer un titre sur un écran de la maison : on réutilise l'action native « regarder » (elle choisit l'écran).
  const surEcran = async (cible, toast) => {
    // Un épisode garde sa saison et son numéro : l'écran reçoit CET épisode, pas le suivant de la série.
    const precis = cible.saison != null && cible.episode != null ? { saison: cible.saison, episode: cible.episode } : {};
    try { const r = await act('regarder', { quoi: cible.titre || '', ou: cible.ecran || '', ...precis }); toast?.(r && (r.text || r.error) || 'Envoyé.'); }
    catch { toast?.('Aucun écran joignable pour le moment.'); }
  };

  const carte = (o, onOuvrir) => {
    const aff = logique.afficheLocale(o), a = logique.avance(o);
    return el('button', { class: 'vn-card', type: 'button', title: o.titre || '', onclick: () => onOuvrir(o) },
      el('span', { class: 'vn-aff' }, aff ? el('img', { src: aff, alt: '', loading: 'lazy' }) : el('span', { class: 'ph' }, o.type === 'album' ? '🎵' : o.type === 'livre_audio' ? '🎧' : o.type === 'serie' ? '📺' : '🎬'), a > 0.02 ? el('span', { class: 'pc', style: `width:${Math.round(a * 100)}%` }) : null),
      el('b', {}, o.titre || 'Sans titre'),
      el('span', { class: 'm' }, [o.annee, o.duree ? logique.mmss(o.duree) : null].filter(Boolean).join(' · ')));
  };

  // Ouvre une œuvre : un film se lit tout de suite ; une série / un album / un livre audio ouvre sa liste d'éléments.
  async function ouvrirOeuvre(o, host, toast) {
    const L = lecteurDispo();
    if (o.type === 'film' || o.type === 'clip' || (!o.type && !o.enfants)) {
      L?.ouvrir({ id: o.cibleId || o.id, titre: o.titre, type: 'film', duree_s: o.duree, reprise_s: o.reprise_s, sousTitres: o.sousTitres || o.sous_titres }, { surEcran: () => surEcran({ titre: o.titre }, toast) });
      return;
    }
    let enfants = o.enfants, prete = true;
    if (!enfants) { try { const d = await vget(logique.detailUrl(o.id)); enfants = d.episodes || d.pistes || d.enfants || []; } catch { enfants = []; prete = false; } }
    const lignes = enfants.length ? enfants.map((e) => el('div', { class: 'vn-row' }, el('span', { class: 't' }, [e.saison != null ? `S${String(e.saison).padStart(2, '0')}E${String(e.episode ?? 0).padStart(2, '0')}` : e.num != null ? `${e.num}.` : null, e.titre || 'Élément'].filter(Boolean).join(' ')), (e.duree || e.duree_s) ? el('span', { class: 'm', style: 'color:#9aa1b2' }, logique.mmss(e.duree || e.duree_s)) : null,
      el('button', { class: 'vn-b', type: 'button', onclick: () => lecteurDispo()?.ouvrir({ id: e.cibleId || e.id, titre: `${o.titre} · ${e.titre || ''}`, type: o.type === 'serie' ? 'episode' : 'piste', duree_s: e.duree || e.duree_s, reprise_s: e.reprise_s, sousTitres: e.sousTitres || e.sous_titres }, { surEcran: () => surEcran({ titre: o.titre, saison: e.saison, episode: e.episode }, toast) }) }, '► Lire')))
      : [el('p', { class: 'vn-vide' }, prete ? 'Rien à lire dans ce titre pour l\'instant.' : 'La navigation par épisodes et pistes arrive avec le bloc d\'acquisition. Pour l\'instant, les films se lisent directement.')];
    const boite = el('div', { class: 'vn-sec' }, el('h3', {}, o.titre || ''), el('div', { class: 'vn-liste' }, ...lignes));
    // Le bouton « Retour » vide le panneau de détail : la grille reste visible juste au-dessus.
    host.replaceChildren(el('button', { class: 'vn-b', type: 'button', onclick: () => host.replaceChildren() }, '← Retour'), boite);
  }

  // Lit la cible voulue à l'ouverture (OdinOpenWant.lire) : le détail de son œuvre donne la durée, la reprise et les sous-titres.
  async function lancerVoulu(want, toast) {
    const v = logique.cibleVoulue(want), L = lecteurDispo(); if (!v) return;
    if (!L) { toast('Lecteur indisponible.'); return; }
    let d = null; try { d = await vget(logique.detailUrl(v.oeuvre)); } catch { d = null; }
    const c = d ? logique.elementLecteur(d, v.cible) : null;
    if (!c) { toast("Ce titre n'est pas (ou plus) dans la bibliothèque : relance un scan, ou ajoute-le (Envoyer, ou un dossier)."); return; }
    const e = (d.episodes || []).find((x) => x.id === v.cible);
    L.ouvrir(c, { surEcran: () => surEcran({ titre: d.oeuvre.titre, ...(e ? { saison: e.saison, episode: e.episode } : {}) }, toast) });
  }

  // Catégories d'un dossier média à déclarer (pour peupler Odéon).
  const CATS_DOSSIER = [['films', 'Films'], ['series', 'Séries'], ['musique', 'Musique'], ['livres_audio', 'Livres audio']];
  // Le chemin prend toute la ligne sur un téléphone (390 px) : un chemin se lit en entier, la catégorie et les boutons passent dessous.
  const champ = (attrs) => el('input', { ...attrs, style: 'flex:1 1 260px;min-width:0;min-height:38px;border-radius:12px;border:1px solid var(--line);background:var(--field);color:inherit;padding:0 12px;font:inherit' });

  // Ce que le bilan d'un scan dit des fichiers laissés de côté : la raison en clair, et quelques noms (jamais tu).
  const RAISONS = {
    dossier_introuvable: 'dossier introuvable sur la machine d\'Odin',
    pas_un_media: 'pas une vidéo ni un son',
    illisible: 'illisible par ffprobe (fichier abîmé, ou FFmpeg absent)',
    hors_categorie: 'pas du bon genre pour la catégorie du dossier',
    episode_sans_numero: 'épisode sans numéro dans son nom (il faut S01E02 ou 1x02)',
  };
  Object.assign(logique, {
    /** Le bilan d'un scan en lignes lisibles : comptes, alerte (FFmpeg absent), dossiers introuvables, raisons. Pur. */
    bilanLignes(r) {
      const b = (r && r.bilan) || {}, out = [];
      if (r && r.error) return [String(r.error)];
      if (r && r.alerte) out.push(String(r.alerte));
      out.push(`Scan terminé : ${b.oeuvres || 0} œuvre(s), ${b.episodes || 0} épisode(s), ${b.pistes || 0} piste(s).`);
      for (const d of (b.dossiersIntrouvables || [])) out.push(`Dossier introuvable : ${d} (disque débranché ou chemin mal tapé ?).`);
      const raisons = Object.entries(b.raisons || {}).filter(([k]) => k !== 'dossier_introuvable');
      if (raisons.length) out.push(`Laissés de côté : ${raisons.map(([k, n]) => `${n} ${RAISONS[k] || k}`).join(' ; ')}.`);
      const ex = (b.exemples || []).slice(0, 5);
      if (ex.length) out.push(`Par exemple : ${ex.map((x) => `${x.fichier} (${RAISONS[x.raison] || x.raison})`).join(', ')}.`);
      return out;
    },
    /** Ce qu'il manque d'outils pour lire les médias (rien = tout va bien). Pur. */
    outilsManquants(o) { if (!o) return ''; const m = ['ffprobe', 'ffmpeg'].filter((k) => o[k] === false); return m.length ? `FFmpeg est introuvable pour Odin (${m.join(' et ')} manquant). Installe FFmpeg sur la machine d'Odin (sous Windows : winget install Gyan.FFmpeg), puis redémarre Odin : un Odin démarré avant l'installation ne le voit pas.` : ''; },
  });

  // Déclarer un dossier média et lancer le scan (sans ça, ODÉON reste vide). `onScan` recharge la bibliothèque.
  function panneauDossiers(onScan, onDossiers) {
    const etat = el('p', { class: 'vn-note', role: 'status' }, 'Chargement des dossiers…');
    // Les erreurs et alertes restent affichées (avant : un ajout raté ne disait rien).
    const alerte = el('p', { class: 'vn-note', role: 'alert', style: 'color:var(--bad,#ff6b6b);font-weight:600', hidden: true });
    const dire = (t) => { alerte.textContent = t || ''; alerte.hidden = !t; };
    const chemin = champ({ type: 'text', placeholder: 'Chemin d\'un dossier de la machine d\'Odin', 'aria-label': 'Dossier média' });
    const cat = el('select', { 'aria-label': 'Catégorie', style: 'min-height:38px;border-radius:12px;border:1px solid var(--line);background:var(--field);color:inherit;padding:0 10px;font:inherit' }, ...CATS_DOSSIER.map(([v, l]) => el('option', { value: v }, l)));
    const majListe = async () => {
      try {
        const d = await vget('/venus/dossiers'); const l = d.dossiers || [];
        if (d.exemple) chemin.placeholder = `Chemin d'un dossier de la machine d'Odin (ex. ${d.exemple})`;
        const manque = logique.outilsManquants(d.outils); if (manque) dire(manque);
        if (onDossiers) onDossiers(l);
        etat.textContent = l.length ? `Dossiers : ${l.map((x) => `${x.chemin} (${x.categorie})`).join(' · ')}. Lance « Scanner maintenant » pour les relire.` : '1. Colle le chemin d\'un dossier de films, séries ou musique et choisis sa catégorie. 2. « Ajouter le dossier ». 3. « Scanner maintenant » : tes médias apparaissent, un clic les lit dans le navigateur.';
      } catch { etat.textContent = 'Dossiers indisponibles.'; if (onDossiers) onDossiers(null); }
    };
    const ajouter = async () => {
      const c = chemin.value.trim(); if (!c) { dire('Colle d\'abord le chemin d\'un dossier.'); return; }
      const r = await vpost('/venus/dossiers', { chemin: c, categorie: cat.value });
      if (r && r.error) { dire(r.error); return; }
      dire(''); chemin.value = ''; await majListe();
    };
    const scanner = async () => {
      etat.textContent = 'Scan en cours… (chaque fichier est lu par ffprobe : une grosse bibliothèque prend du temps)';
      try { const r = await vpost('/venus/scan'); const lignes = logique.bilanLignes(r); dire(r && (r.alerte || r.error) ? String(r.alerte || r.error) : ''); etat.textContent = lignes.filter((x) => x !== (r && (r.alerte || r.error))).join(' '); onScan && onScan(); }
      catch { etat.textContent = 'Scan impossible pour le moment.'; }
    };
    majListe();
    return el('div', { class: 'vn-sec' }, el('h3', {}, 'Dossiers média'),
      el('div', { class: 'vn-sous' }, chemin, cat, el('button', { class: 'vn-b', type: 'button', onclick: ajouter }, 'Ajouter le dossier'), el('button', { class: 'vn-b ac', type: 'button', onclick: scanner }, 'Scanner maintenant')),
      alerte, etat);
  }

  // --- Envoyer des médias depuis cet appareil (téléphone ou PC) -----------------------------------
  // Le fichier part en morceaux de 8 Mo vers /api/valhalla/morceau (route commune aux applis qui reçoivent des
  // fichiers) ; après une coupure, l'envoi reprend à l'octet où Odin en est. À la fin, Odin vérifie la taille, passe
  // l'antivirus, lit la vraie nature du fichier, puis le range. (Même principe que l'envoi d'ISO d'Hydre, ymir.js :
  // le doublon est à fondre plus tard dans un client commun.)
  const EXT_VIDEO = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.ts', '.wmv', '.flv'];
  const EXT_AUDIO = ['.mp3', '.flac', '.m4a', '.ogg', '.opus', '.wav', '.aac', '.wma'];
  const NOMS_CAT = { films: 'Films', series: 'Séries', musique: 'Musique', livres_audio: 'Livres audio' };
  Object.assign(logique, {
    /** Le type de la grille où apparaît un fichier de cette catégorie. Pur. */
    typeDeCategorie(cat) { return ({ films: 'film', series: 'serie', musique: 'album', livres_audio: 'livre_audio' })[cat] || 'film'; },
    /** Ce que le sélecteur de fichiers propose pour une catégorie (les extensions aussi : un MKV n'a souvent pas de type). Pur. */
    accepter(cat) { return cat === 'musique' || cat === 'livres_audio' ? ['audio/*', ...EXT_AUDIO].join(',') : ['video/*', ...EXT_VIDEO].join(','); },
    /** Pourcentage entier (0 à 100). Pur. */
    pourcent(recu, total) { const t = Number(total) || 0; return t > 0 ? Math.max(0, Math.min(100, Math.floor((Number(recu) || 0) * 100 / t))) : 0; },
    /** Une taille lisible. Pur. */
    octets(n) { n = Number(n) || 0; return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} Go` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`; },
    /** Un dossier d'arrivée dans la liste : sa catégorie et son nom d'abord (lisible sur un téléphone), le chemin entier ensuite. Pur. */
    libelleDossier(d, cat) { const c = String((d && d.chemin) || ''), nom = c.split(/[\\/]/).filter(Boolean).pop() || c; return `${cat} · ${nom} (${c})`; },
    /** Un refus d'action sans l'en-tête « Vénus · Préparer un envoi de média : » (la ligne dit déjà de quel fichier il s'agit). Pur. */
    sansEntete(t) { const x = String(t || ''); return /^Vénus · [^:]+ : /.test(x) ? x.replace(/^Vénus · [^:]+ : /, '') : x; },
    /** L'adresse d'un morceau : toujours la route locale d'Odin. Pur. */
    morceauUrl(envoi, debut) { return `/api/valhalla/morceau?module=freyja&envoi=${encodeURIComponent(envoi)}&debut=${Number(debut) || 0}`; },
  });

  /** Envoie UN fichier en morceaux ; reprend après une coupure ; puis demande à Odin de l'analyser et de le ranger. */
  async function envoyerMedia(file, dossier, categorie, suivi) {
    const T = 8 * 1024 * 1024; let essais = 0, id = '', recu = 0, t0 = performance.now(), d0 = 0;
    const preparer = async () => {
      const p = await act('preparer_envoi_media', { nom: file.name, taille: file.size, categorie, dossier, modifie: file.lastModified || 0 });
      if (!p || !p.data || !p.data.envoi) throw new Error((p && (p.text || p.error)) || 'envoi refusé');
      id = p.data.envoi; recu = p.data.recu; t0 = performance.now(); d0 = recu;
    };
    await preparer(); if (recu > file.size) recu = 0;
    suivi({ recu, total: file.size, repris: recu > 0 });
    while (recu < file.size) {
      let r;
      try { r = await (await fetch(logique.morceauUrl(id, recu), { method: 'POST', headers: { 'x-odin': '1', 'content-type': 'application/octet-stream' }, body: file.slice(recu, recu + T) })).json(); }
      catch {
        if (++essais > 8) throw new Error('connexion coupée : choisis à nouveau le même fichier, l\'envoi reprendra où il s\'est arrêté');
        suivi({ recu, total: file.size, attente: true });
        await new Promise((ok) => setTimeout(ok, 2500)); await preparer().catch(() => undefined); continue;
      }
      if (!r || !r.ok) { if (r && typeof r.recu === 'number' && /reprise/.test(r.error || '')) { recu = r.recu; continue; } throw new Error((r && r.error) || 'envoi interrompu'); }
      essais = 0; recu = r.recu;
      const sec = (performance.now() - t0) / 1000;
      suivi({ recu, total: file.size, vitesse: (recu - d0) / Math.max(sec, 0.001) });
    }
    suivi({ recu: file.size, total: file.size, analyse: true });
    return act('importer_media', { envoi: id });
  }

  // La zone d'envoi, sous le panneau des dossiers. `maj(dossiers)` la remet à jour quand la liste des dossiers change ;
  // `onRange(categorie)` recharge la grille sur la bonne catégorie.
  function zoneEnvoi(onRange) {
    let liste = [], suite = Promise.resolve();
    const sel = el('select', { 'aria-label': 'Dossier d\'arrivée' });
    const entree = el('input', { type: 'file', multiple: true, 'aria-label': 'Fichiers à envoyer' });
    const choisir = el('label', { class: 'choisir' }, entree, '⇪ Choisir des fichiers');
    const note = el('p', { class: 'vn-note', style: 'margin:0' });
    const lignes = el('div');
    const depose = el('div', { class: 'depose' }, el('div', { class: 'vn-sous', style: 'width:100%' }, sel, choisir), note);
    const actif = () => liste.length > 0;
    const majAccept = () => { const d = liste.find((x) => x.chemin === sel.value); entree.accept = logique.accepter(d ? d.categorie : 'films'); };
    const ligne = (f) => {
      const barre = el('i'), pc = el('span', { class: 'vn-fi-pc' }, '0 %'), et = el('div', { class: 'vn-fi-etat', role: 'status' }, 'en attente');
      const br = el('div', { class: 'vn-fi-barre', role: 'progressbar', 'aria-label': f.name, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, barre);
      const bloc = el('div', { class: 'vn-fi' }, el('div', { class: 'vn-fi-l1' }, el('span', { class: 'vn-fi-nom' }, f.name), pc), br, et);
      lignes.prepend(bloc);
      const pose = (pct, texte, sorte) => { barre.style.width = `${pct}%`; br.setAttribute('aria-valuenow', String(pct)); pc.textContent = sorte === 'ko' && !pct ? '' : `${pct} %`; et.textContent = texte; bloc.classList.toggle('ok', sorte === 'ok'); bloc.classList.toggle('ko', sorte === 'ko'); };
      return { pose };
    };
    const envoyerTout = (fichiers) => {
      if (!actif()) return;
      const d = liste.find((x) => x.chemin === sel.value) || liste[0];
      for (const f of fichiers) {
        const L = ligne(f);
        L.pose(0, `en attente · ${logique.octets(f.size)}`);
        // Plusieurs fichiers : l'un après l'autre (chaque barre avance à son tour).
        suite = suite.then(async () => {
          try {
            L.pose(0, 'préparation…');
            const r = await envoyerMedia(f, d.chemin, d.categorie, (x) => {
              const pct = logique.pourcent(x.recu, x.total);
              if (x.analyse) L.pose(100, 'analyse en cours : antivirus, vraie nature du fichier, lecture… (un gros film prend quelques minutes)');
              else if (x.attente) L.pose(pct, 'connexion coupée, reprise…');
              else L.pose(pct, `${logique.octets(x.recu)} sur ${logique.octets(x.total)}${x.vitesse ? ` · ${logique.octets(x.vitesse)}/s` : ''}${x.repris ? ' · reprise là où l\'envoi s\'était arrêté' : ''}`);
            });
            if (r && r.ok !== false) { L.pose(100, String(r.text || 'Rangé.').replace(/^✅\s*/, '✓ '), 'ok'); if (onRange) onRange(d.categorie); }
            else L.pose(100, `✗ ${logique.sansEntete((r && (r.text || r.error)) || 'refusé')}`, 'ko');
          } catch (e) { L.pose(0, `✗ ${logique.sansEntete(e && e.message ? e.message : 'envoi impossible')}`, 'ko'); }
        });
      }
    };
    entree.addEventListener('change', () => { envoyerTout([...entree.files]); entree.value = ''; });
    sel.addEventListener('change', majAccept);
    // Glisser-déposer (ordinateur) : les fichiers lâchés sur la zone partent dans le dossier choisi.
    depose.addEventListener('dragover', (e) => { if (!actif()) return; e.preventDefault(); depose.classList.add('sur'); });
    depose.addEventListener('dragleave', () => depose.classList.remove('sur'));
    depose.addEventListener('drop', (e) => { depose.classList.remove('sur'); if (!actif()) return; e.preventDefault(); envoyerTout([...((e.dataTransfer && e.dataTransfer.files) || [])]); });
    const maj = (l) => {
      liste = (l || []).filter((x) => x.actif !== false);
      const avant = sel.value;
      sel.replaceChildren(...liste.map((x) => el('option', { value: x.chemin, title: x.chemin }, logique.libelleDossier(x, NOMS_CAT[x.categorie] || x.categorie))));
      if (liste.some((x) => x.chemin === avant)) sel.value = avant;
      sel.disabled = !actif(); entree.disabled = !actif(); choisir.setAttribute('aria-disabled', String(!actif()));
      majAccept();
      note.textContent = l === null ? 'Dossiers indisponibles pour le moment.' : actif()
        ? 'Choisis le dossier d\'arrivée, puis un ou plusieurs fichiers (ou glisse-les ici). Une coupure ne fait pas tout recommencer : l\'envoi reprend où il s\'est arrêté. Chaque fichier est analysé (antivirus, vraie nature) avant d\'être rangé ; rien n\'est écrasé.'
        : 'Déclare d\'abord un dossier média ci-dessus : les fichiers envoyés y seront rangés.';
    };
    maj([]); note.textContent = 'Chargement des dossiers…';
    const boite = el('div', { class: 'vn-sec vn-env' }, el('h3', {}, 'Envoyer des films, séries ou musique depuis cet appareil'), depose, lignes);
    return { boite, maj };
  }

  // --- Onglet Odéon : la bibliothèque + Odyssée (lecteur de livres gardé tel quel) ----------------
  async function odeon(host, ctx, suite) {
    const S = ctx._odeon || (ctx._odeon = { type: 'film', q: '' });
    const sous = el('div', { class: 'vn-sous' },
      el('div', { class: 'f', role: 'group', 'aria-label': 'Catégorie' }, ...TYPES.map(([id, lab]) => el('button', { type: 'button', 'aria-pressed': String(S.type === id), onclick: () => { S.type = id; rendre(); } }, lab))),
      el('form', { class: 'vn-ch', onsubmit: (e) => { e.preventDefault(); S.q = e.target.q.value.trim(); rendre(); } }, el('input', { name: 'q', type: 'search', placeholder: 'Chercher dans la bibliothèque…', value: S.q, 'aria-label': 'Chercher' }), el('button', { class: 'vn-b', type: 'submit' }, 'Chercher')));
    const zone = el('div');
    const gestion = el('div');
    const extras = el('div', { style: 'display:flex;flex-direction:column;gap:16px' });
    // Une colonne espacée : la grille, le panneau des dossiers et « Ma liste » ne se collent plus l'un à l'autre.
    const pile = el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, sous, zone, gestion, extras);
    host.replaceChildren(pile);

    const rendre = async () => {
      // mettre à jour l'état pressé des filtres
      [...sous.querySelectorAll('.f button')].forEach((b, i) => b.setAttribute('aria-pressed', String(TYPES[i][0] === S.type)));
      zone.replaceChildren(el('p', { class: 'vn-vide' }, 'Chargement…'));
      try {
        const d = await vget(logique.bibliothequeUrl(S.type, S.q));
        const oeuvres = d.oeuvres || d.items || [];
        const grille = el('div', { class: 'vn-grille' });
        const detail = el('div');
        // Bibliothèque vide : le panneau des dossiers passe AU-DESSUS (c'est la seule chose à faire), sinon il reste dessous.
        if (!oeuvres.length) { zone.replaceChildren(el('p', { class: 'vn-vide' }, S.q ? `Rien pour « ${S.q} » dans ${logique.typeLabel(S.type).toLowerCase()}.` : `Aucun titre dans ${logique.typeLabel(S.type).toLowerCase()} : déclare un dossier de médias ci-dessus, puis lance un scan ou envoie tes fichiers depuis cet appareil.`)); if (!S.q) pile.insertBefore(gestion, zone); }
        else { grille.append(...oeuvres.map((o) => carte(o, (x) => ouvrirOeuvre(x, detail, ctx.toast)))); zone.replaceChildren(grille, detail); if (gestion.previousSibling === sous) pile.insertBefore(zone, gestion); }
      } catch { zone.replaceChildren(el('p', { class: 'vn-vide' }, 'Bibliothèque indisponible (serveur en cours de démarrage ou scan en cours).')); }
    };
    rendre();
    // Sous le panneau des dossiers : la zone d'envoi (un fichier rangé fait recharger la grille sur sa catégorie).
    const envoi = zoneEnvoi((cat) => { S.type = logique.typeDeCategorie(cat); S.q = ''; rendre(); });
    gestion.style.cssText = 'display:flex;flex-direction:column;gap:16px';
    gestion.replaceChildren(panneauDossiers(() => rendre(), envoi.maj), envoi.boite);

    // Ma liste + Demandes (privées, dans Alexandrie côté serveur)
    const maListe = el('div', { class: 'vn-sec' }, el('h3', {}, 'Ma liste'), el('div', { class: 'vn-liste' }, el('p', { class: 'vn-vide' }, 'Chargement…')));
    const demListe = el('div', { class: 'vn-liste' }, el('p', { class: 'vn-vide' }, 'Chargement…'));
    const rechargerDemandes = () => vget('/venus/demandes').then((d) => { const l = d.demandes || d.items || []; demListe.replaceChildren(...(l.length ? l.map((x) => el('div', { class: 'vn-row' }, el('span', { class: 't' }, x.titre || ''), el('span', { class: 'm', style: 'color:var(--muted)' }, x.etat || x.status || ''))) : [el('p', { class: 'vn-vide' }, 'Aucune demande en cours.')])); }).catch(() => demListe.replaceChildren(el('p', { class: 'vn-vide' }, 'Indisponible.')));
    const demForm = el('form', { class: 'vn-ch', onsubmit: async (e) => { e.preventDefault(); const t = e.target.t.value.trim(); if (!t) return; try { await vpost('/venus/demandes', { titre: t, type: 'film' }); } catch { /* réessai plus tard */ } e.target.t.value = ''; rechargerDemandes(); } }, el('input', { name: 't', type: 'text', placeholder: 'Demander un titre absent…', 'aria-label': 'Demander un titre' }), el('button', { class: 'vn-b', type: 'submit' }, 'Demander'));
    const demandes = el('div', { class: 'vn-sec' }, el('h3', {}, 'Demandes'), demForm, demListe);
    vget('/venus/ma-liste').then((d) => { const l = d.liste || d.oeuvres || []; maListe.lastChild.replaceChildren(...(l.length ? l.map((o) => el('div', { class: 'vn-row' }, el('span', { class: 't' }, o.titre || ''), o.annee ? el('span', { class: 'm', style: 'color:var(--muted)' }, String(o.annee)) : null)) : [el('p', { class: 'vn-vide' }, 'Vide. Ajoute des titres à garder pour plus tard.')])); }).catch(() => maListe.lastChild.replaceChildren(el('p', { class: 'vn-vide' }, 'Indisponible.')));
    rechargerDemandes();

    // Odyssée : le lecteur de livres & BD, gardé tel quel (chaîné depuis l'ancien gestionnaire de la page de Vénus).
    const livres = el('div');
    if (typeof suite === 'function') { try { await suite({ ...ctx, host: livres }); } catch { /* pas de livres : rien */ } }
    extras.replaceChildren(el('div', { class: 'vn-cols' }, el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, maListe), demandes), livres);
  }

  // --- Onglet Écrans : télécommande + QR par écran ------------------------------------------------
  async function ecrans(host, ctx) {
    const TC = window.OdinVenusTelecommande;
    host.replaceChildren(el('p', { class: 'vn-vide' }, 'Chargement des écrans…'));
    let liste = [];
    try { const d = await vget(logique.ecransUrl()); liste = d.ecrans || d.items || []; } catch { host.replaceChildren(el('p', { class: 'vn-vide' }, 'Écrans indisponibles (Home Assistant non relié, ou aucun lecteur découvert).')); return; }
    if (!liste.length) { host.replaceChildren(el('p', { class: 'vn-vide' }, 'Aucun écran découvert. Relie Home Assistant (media_player) ou ouvre un lecteur sur la télé.')); return; }
    const cartes = liste.map((e) => {
      const corps = el('div', { style: 'display:grid;grid-template-columns:1fr;gap:14px' });
      const enLigne = e.actif !== false;
      const carteEcran = el('div', { class: 'vn-ecran' },
        el('div', { class: 'nom' }, el('b', {}, e.nom || 'Écran'), el('span', { class: `pt ${enLigne ? 'on' : 'off'}` }, enLigne ? 'en ligne' : 'éteint'), e.enLecture ? el('span', { class: 'm', style: 'color:#9aa1b2' }, '▶ en lecture') : null),
        el('div', { class: 'vn-sous' },
          el('button', { class: 'vn-b', type: 'button', onclick: () => { corps.replaceChildren(); TC?.monter(corps, { ecranId: e.id, nom: e.nom }, { plein: false }); } }, 'Télécommande'),
          el('button', { class: 'vn-b', type: 'button', onclick: () => { corps.replaceChildren(); TC?.afficherQr(corps, { id: e.id, nom: e.nom }); } }, 'QR pour un téléphone')),
        corps);
      return carteEcran;
    });
    host.replaceChildren(el('p', { class: 'vn-note' }, 'La télécommande pilote l\'écran en continu. Le QR ouvre la même télécommande sur un téléphone : qui a le QR pilote cet écran (pratique pour les invités). Le jeton expire tout seul, se révoque et se régénère.'), ...cartes);
  }

  // --- Onglet Acquisition (phase 1 : lecture seule) ----------------------------------------------
  async function acquisition(host) {
    host.replaceChildren(el('p', { class: 'vn-vide' }, 'Chargement…'));
    const blocs = [el('p', { class: 'vn-note' }, 'Delta (sources), Hnoss (demandes), Sirius (films), Pléiades (séries), Odyssée (livres), Comète (téléchargements). Phase 1 : lecture seule — l\'acquisition native complète arrive ensuite.')];
    try { const m = await act('medias'); blocs.push(el('div', { class: 'vn-sec' }, el('h3', {}, 'Médias automatiques'), el('pre', { class: 'vn-pre' }, (m && (m.text || m.error)) || 'Rien à montrer.'))); } catch { /* ignore */ }
    try { const b = await act('bygul'); blocs.push(el('div', { class: 'vn-sec' }, el('h3', {}, 'Delta · sources'), el('pre', { class: 'vn-pre' }, (b && (b.text || b.error)) || 'Aucune source.'))); } catch { /* ignore */ }
    host.replaceChildren(...blocs);
  }

  // --- Onglet État : joignable, santé, nouveautés ------------------------------------------------
  async function etat(host) {
    host.replaceChildren(el('p', { class: 'vn-vide' }, 'Chargement…'));
    const blocs = [];
    for (const [action, titre] of [['etat', 'État'], ['sante', 'Santé'], ['nouveautes', 'Nouveautés']]) {
      try { const r = await act(action); blocs.push(el('div', { class: 'vn-sec' }, el('h3', {}, titre), el('pre', { class: 'vn-pre' }, (r && (r.text || r.error)) || '—'))); } catch { blocs.push(el('div', { class: 'vn-sec' }, el('h3', {}, titre), el('p', { class: 'vn-vide' }, 'Indisponible.'))); }
    }
    host.replaceChildren(...blocs);
  }

  const ONGLETS = [['odeon', 'Odéon'], ['youtube', 'YouTube'], ['ecrans', 'Écrans'], ['acquisition', 'Acquisition'], ['etat', 'État']];

  // On garde l'ancien gestionnaire de la page de Vénus (le lecteur de livres Odyssée) pour le greffer dans Odéon.
  const suite = typeof window.OdinPages.freyja === 'function' ? window.OdinPages.freyja : null;

  window.OdinPages.freyja = async (ctx) => {
    const { host } = ctx;
    if (!document.getElementById('vnCss')) document.head.append(el('style', { id: 'vnCss' }, CSS));
    const want = window.OdinOpenWant && window.OdinOpenWant.module === 'freyja' ? window.OdinOpenWant : null;
    if (want) window.OdinOpenWant = undefined;
    // Vénus s'ouvre en plein écran, avec l'interface de Venus (/venus/app/, « ‹ Odin » pour revenir). Cette page-ci
    // (dossiers, scan, envoi, écrans, YouTube, acquisition, état) reste là : ouverte depuis Venus (« Médiathèques et
    // écrans »), ou pour lire un titre demandé dans la discussion.
    // Depuis le 23/11 : DANS la page d'Odin (vue « Vénus », adresse /#venus), le menu d'Odin à côté ; Venus garde son
    // interface (rail, barre, lecteur) dans le cadre. Un rafraîchissement discret de l'appli n'y ramène pas.
    if (logique.versAppli(want, window.location.search)) {
      if (!document.getElementById('v-venus')) { logique.allerAppli(window.location); return true; }
      if (ctx.quiet && !document.querySelector('#v-app.on')) return true;
      ouvrirVue();
      return true;
    }
    // Venus a demandé cette page (« ?venus=gestion ») : l'adresse redevient celle d'Odin (rien n'est gardé dans le navigateur).
    if (/[?&]venus=gestion/.test(window.location.search)) { try { window.history.replaceState(null, '', `/${window.location.hash}`); } catch { /* sans gravité */ } }
    const S = { onglet: (want && (want.onglet || want.tab)) || 'odeon' };
    if (!ONGLETS.some(([id]) => id === S.onglet)) S.onglet = 'odeon';
    const toast = ctx.toast || (() => {});

    const racine = el('div', { class: 'vn' });
    host.append(racine);
    const corps = el('div');

    const barre = () => el('div', { class: 'vn-tete' },
      el('span', { class: 'ico' }, '♀'),
      el('div', {}, el('b', {}, 'Vénus'), el('div', { class: 'sub' }, 'Tes films, séries, musique et YouTube — sur tous tes écrans, sans rien d\'extérieur')),
      el('a', { class: 'vn-b ac', href: logique.appliUrl(), style: 'display:inline-flex;align-items:center;min-height:44px;text-decoration:none' }, 'Ouvrir Venus'),
      el('div', { class: 'vn-seg', role: 'tablist', 'aria-label': 'Parties de Vénus', style: 'margin-left:auto' }, ...ONGLETS.map(([id, lab]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(S.onglet === id), onclick: () => { if (S.onglet !== id) { S.onglet = id; rendre(); } } }, lab))));

    const rendre = async () => {
      racine.replaceChildren(barre(), corps);
      corps.replaceChildren(el('p', { class: 'vn-vide' }, 'Chargement…'));
      if (S.onglet === 'odeon') await odeon(corps, { ...ctx, toast }, suite);
      else if (S.onglet === 'youtube') { if (window.OdinVenusYoutube) { corps.replaceChildren(); window.OdinVenusYoutube.dessiner(corps, { toast }); } else corps.replaceChildren(el('p', { class: 'vn-vide' }, 'Onglet YouTube indisponible.')); }
      else if (S.onglet === 'ecrans') { corps.replaceChildren(); await ecrans(corps, { ...ctx, toast }); }
      else if (S.onglet === 'acquisition') { corps.replaceChildren(); await acquisition(corps); }
      else if (S.onglet === 'etat') { corps.replaceChildren(); await etat(corps); }
    };
    await rendre();
    // Ouverte avec l'intention de lire un titre : le lecteur démarre dessus, à la reprise.
    if (want && want.lire) await lancerVoulu(want, toast);
    // Vénus prend la largeur de la page : les sections génériques du module sont cachées ; ses actions qui ne parlent
    // qu'au serveur à part restent dans « Autres actions », sous la page (et hors de la barre du haut tant qu'il n'est pas relié).
    return true;
  };

  // --- La vue « Vénus » d'Odin -----------------------------------------------------------------
  // Un cadre de la même adresse sur /venus/app/ (sa page, ses scripts, son clavier, Échap compris, restent dedans ; le
  // lecteur peut passer en plein écran). Retiré en quittant la vue : tout ce qu'il faisait tourner s'arrête avec lui.
  // Rien à son chargement, sauf écouter la page.
  const VV = { cadre: null, ouverte: false, precedente: 'home', proprio: false };
  const MOTS_VUE = { titre: 'Vénus', attente: "Vénus s'ouvre ici pour le propriétaire d'Odin." };
  function ouvrirVue() {
    try {
      const u = `${window.location.pathname}${window.location.search}#venus`;
      if (logique.vue.remplacer(window.location.hash)) window.history.replaceState(window.history.state, '', u); else window.history.pushState(null, '', u);
    } catch { /* sans gravité */ }
    if (window.OdinShow) window.OdinShow('venus');
  }
  function peindreVue() {
    const s = document.getElementById('v-venus'); if (!s) return;
    if (!logique.vue.poser(VV.ouverte ? 'venus' : '', VV.proprio)) {
      if (VV.cadre) { VV.cadre.remove(); VV.cadre = null; }
      if (VV.ouverte && !s.querySelector('.vv-attente')) s.replaceChildren(el('p', { class: 'vv-attente' }, MOTS_VUE.attente));
      if (!VV.ouverte) s.replaceChildren();
      return;
    }
    if (VV.cadre) return; // déjà posé : jamais deux chargements
    if (!document.getElementById('vvCss')) document.head.append(el('style', { id: 'vvCss' }, '#v-venus .vv-cadre{flex:1;display:block;width:100%;min-height:0;border:0;background:#120e0d}#v-venus .vv-attente{margin:0;padding:22px 28px;color:var(--muted)}'
      // Venus n'a pas de mascotte : celle d'Odin ne se promène pas par-dessus son interface.
      + 'body:has(#v-venus.on) #buddyRoam{visibility:hidden!important;pointer-events:none!important}'));
    VV.cadre = el('iframe', { class: 'vv-cadre', title: MOTS_VUE.titre, src: logique.appliUrl(), allow: 'fullscreen; picture-in-picture; autoplay', allowfullscreen: true, referrerpolicy: 'no-referrer' });
    s.replaceChildren(VV.cadre);
  }
  if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
    document.addEventListener('odin:vue', (e) => {
      const vue = e && e.detail && e.detail.vue;
      VV.ouverte = vue === 'venus';
      if (!VV.ouverte && vue) VV.precedente = vue;
      if (VV.ouverte) { const m = document.getElementById('mcur'); if (m) m.textContent = MOTS_VUE.titre; }
      if (logique.vue.retirerAncre(vue, window.location.hash)) { try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search); } catch { /* sans gravité */ } }
      peindreVue();
    });
    window.addEventListener('hashchange', () => {
      const s = document.getElementById('v-venus'), v = logique.vue.apresAncre(window.location.hash, Boolean(s && s.classList.contains('on')), VV.precedente);
      if (v && window.OdinShow) window.OdinShow(v);
    });
    // Le propriétaire seul : l'état d'Odin (« membre » pour un membre de la famille) ; sans état reçu, /api/account/me.
    let vu = false;
    const surEtat = (etat) => { vu = true; VV.proprio = Boolean(etat && typeof etat === 'object' && !etat.membre); peindreVue(); };
    window.addEventListener('odin:etat', (e) => surEtat(e && e.detail));
    window.addEventListener('load', () => {
      // Page rechargée sur /#venus : Odin a pu ouvrir la vue AVANT que ce fichier soit chargé (dès que l'état arrive) ;
      // l'évènement « odin:vue » est alors déjà passé. La page dit elle-même si la vue est ouverte.
      const s = document.getElementById('v-venus');
      if (!VV.ouverte && s && s.classList.contains('on')) { VV.ouverte = true; const m = document.getElementById('mcur'); if (m) m.textContent = MOTS_VUE.titre; peindreVue(); }
      if (vu) return;
      fetch('/api/account/me', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (!vu && j && j.ok) surEtat({ membre: j.membre }); }).catch(() => { /* hors ligne : rien */ });
    });
  }

  window.OdinVenus = { logique, suitePrecedente: suite, vue: { ouvrir: () => ouvrirVue(), ouverte: () => VV.ouverte, cadre: () => VV.cadre } };
})();
