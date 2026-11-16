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
@media (pointer:coarse){.vn-seg button,.vn-b,.vn-sous .f button{min-height:44px}}
@media (max-width:420px){.vn-grille{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}.vn-tete b{font-size:18px}}`;

  const TYPES = [['film', 'Films', '🎬'], ['serie', 'Séries', '📺'], ['album', 'Musique', '🎵'], ['livre_audio', 'Livres audio', '🎧']];

  // --- Logique pure (essayable sans navigateur) --------------------------------------------------
  const logique = {
    bibliothequeUrl(type, q) { const p = []; if (type) p.push(`type=${encodeURIComponent(type)}`); if (q) p.push(`q=${encodeURIComponent(q)}`); return `/venus/bibliotheque${p.length ? `?${p.join('&')}` : ''}`; },
    detailUrl(id) { return `/venus/oeuvre/${encodeURIComponent(String(id))}`; },
    ecransUrl() { return '/venus/ecrans'; },
    /** Affiche locale seulement (chemin Odin ou data:) : jamais une image chargée d'un serveur tiers. */
    afficheLocale(o) { const u = o && (o.affiche || o.poster); return typeof u === 'string' && /^(\/|data:)/.test(u) ? u : null; },
    mmss(s) { s = Math.max(0, Math.floor(Number(s) || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; const d2 = (n) => String(n).padStart(2, '0'); return h ? `${h}:${d2(m)}:${d2(x)}` : `${m}:${d2(x)}`; },
    /** Disposition selon la largeur : « etroit » sur téléphone (390 px), « large » sur ordinateur (1280 px). */
    dispo(largeur) { return Number(largeur) < 700 ? 'etroit' : 'large'; },
    typeLabel(type) { const t = TYPES.find((x) => x[0] === type); return t ? t[1] : type; },
    /** Part d'avancement (0 à 1) d'une œuvre d'après sa reprise. */
    avance(o) { const p = Number(o && o.reprise_s) || 0, d = Number(o && o.duree_s) || 0; return d > 0 ? Math.max(0, Math.min(1, p / d)) : 0; },
  };

  const lecteurDispo = () => window.OdinVenusLecteur;
  // Envoyer un titre sur un écran de la maison : on réutilise l'action native « regarder » (elle choisit l'écran).
  const surEcran = async (cible, toast) => {
    try { const r = await act('regarder', { quoi: cible.titre || '', ou: cible.ecran || '' }); toast?.(r && (r.text || r.error) || 'Envoyé.'); }
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
      el('button', { class: 'vn-b', type: 'button', onclick: () => lecteurDispo()?.ouvrir({ id: e.cibleId || e.id, titre: `${o.titre} · ${e.titre || ''}`, type: o.type === 'serie' ? 'episode' : 'piste', duree_s: e.duree || e.duree_s, reprise_s: e.reprise_s, sousTitres: e.sousTitres || e.sous_titres }, { surEcran: () => surEcran({ titre: o.titre }, toast) }) }, '► Lire')))
      : [el('p', { class: 'vn-vide' }, prete ? 'Rien à lire dans ce titre pour l\'instant.' : 'La navigation par épisodes et pistes arrive avec le bloc d\'acquisition. Pour l\'instant, les films se lisent directement.')];
    const boite = el('div', { class: 'vn-sec' }, el('h3', {}, o.titre || ''), el('div', { class: 'vn-liste' }, ...lignes));
    // Le bouton « Retour » vide le panneau de détail : la grille reste visible juste au-dessus.
    host.replaceChildren(el('button', { class: 'vn-b', type: 'button', onclick: () => host.replaceChildren() }, '← Retour'), boite);
  }

  // Catégories d'un dossier média à déclarer (pour peupler Odéon).
  const CATS_DOSSIER = [['films', 'Films'], ['series', 'Séries'], ['musique', 'Musique'], ['livres_audio', 'Livres audio']];
  const champ = (attrs) => el('input', { ...attrs, style: 'flex:1;min-width:140px;min-height:38px;border-radius:12px;border:1px solid var(--line);background:var(--field);color:inherit;padding:0 12px;font:inherit' });

  // Déclarer un dossier média et lancer le scan (sans ça, ODÉON reste vide). `onScan` recharge la bibliothèque.
  function panneauDossiers(onScan) {
    const etat = el('p', { class: 'vn-note' }, 'Chargement des dossiers…');
    const chemin = champ({ type: 'text', placeholder: 'Chemin d\'un dossier (ex. /mnt/films)', 'aria-label': 'Dossier média' });
    const cat = el('select', { 'aria-label': 'Catégorie', style: 'min-height:38px;border-radius:12px;border:1px solid var(--line);background:var(--field);color:inherit;padding:0 10px;font:inherit' }, ...CATS_DOSSIER.map(([v, l]) => el('option', { value: v }, l)));
    const majListe = async () => { try { const d = await vget('/venus/dossiers'); const l = d.dossiers || []; etat.textContent = l.length ? `Dossiers : ${l.map((x) => `${x.chemin} (${x.categorie})`).join(' · ')}` : 'Aucun dossier déclaré. Ajoute-en un puis lance un scan.'; } catch { etat.textContent = 'Dossiers indisponibles.'; } };
    const ajouter = async () => { const c = chemin.value.trim(); if (!c) return; await vpost('/venus/dossiers', { chemin: c, categorie: cat.value }); chemin.value = ''; await majListe(); };
    const scanner = async () => { etat.textContent = 'Scan en cours…'; try { const r = await vpost('/venus/scan'); const b = (r && r.bilan) || {}; etat.textContent = `Scan terminé : ${b.oeuvres || 0} œuvre(s), ${b.episodes || 0} épisode(s), ${b.pistes || 0} piste(s).`; onScan && onScan(); } catch { etat.textContent = 'Scan impossible pour le moment.'; } };
    majListe();
    return el('div', { class: 'vn-sec' }, el('h3', {}, 'Dossiers média'),
      el('div', { class: 'vn-sous' }, chemin, cat, el('button', { class: 'vn-b', type: 'button', onclick: ajouter }, 'Ajouter le dossier'), el('button', { class: 'vn-b ac', type: 'button', onclick: scanner }, 'Scanner maintenant')),
      etat);
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
    host.replaceChildren(sous, zone, gestion, extras);

    const rendre = async () => {
      // mettre à jour l'état pressé des filtres
      [...sous.querySelectorAll('.f button')].forEach((b, i) => b.setAttribute('aria-pressed', String(TYPES[i][0] === S.type)));
      zone.replaceChildren(el('p', { class: 'vn-vide' }, 'Chargement…'));
      try {
        const d = await vget(logique.bibliothequeUrl(S.type, S.q));
        const oeuvres = d.oeuvres || d.items || [];
        const grille = el('div', { class: 'vn-grille' });
        const detail = el('div');
        if (!oeuvres.length) zone.replaceChildren(el('p', { class: 'vn-vide' }, S.q ? `Rien pour « ${S.q} » dans ${logique.typeLabel(S.type).toLowerCase()}.` : `Aucun titre dans ${logique.typeLabel(S.type).toLowerCase()} (déclare un dossier ci-dessous puis lance un scan).`));
        else { grille.append(...oeuvres.map((o) => carte(o, (x) => ouvrirOeuvre(x, detail, ctx.toast)))); zone.replaceChildren(grille, detail); }
      } catch { zone.replaceChildren(el('p', { class: 'vn-vide' }, 'Bibliothèque indisponible (serveur en cours de démarrage ou scan en cours).')); }
    };
    rendre();
    gestion.replaceChildren(panneauDossiers(() => rendre()));

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
    const S = { onglet: (want && (want.onglet || want.tab)) || 'odeon' };
    if (!ONGLETS.some(([id]) => id === S.onglet)) S.onglet = 'odeon';
    const toast = ctx.toast || (() => {});

    const racine = el('div', { class: 'vn' });
    host.append(racine);
    const corps = el('div');

    const barre = () => el('div', { class: 'vn-tete' },
      el('span', { class: 'ico' }, '♀'),
      el('div', {}, el('b', {}, 'Vénus'), el('div', { class: 'sub' }, 'Tes films, séries, musique et YouTube — sur tous tes écrans, sans rien d\'extérieur')),
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
    return true; // Vénus prend toute la page (la page générique du module ne s'affiche pas).
  };

  window.OdinVenus = { logique, suitePrecedente: suite };
})();
