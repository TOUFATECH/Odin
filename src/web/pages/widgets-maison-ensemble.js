// La famille « Maison » des widgets de l'accueil, la maison d'un coup d'œil (maquette validée « Accueil ») : ses scènes,
// le bandeau d'état et « Ma maison ». Rangées dans ce fichier pour ne pas écrire dans celui des petits chiffres
// (widgets-maison.js) ; la famille déclarée est la même : « maison ».
// Ce fichier DÉCLARE ses sortes au registre commun (pages/widgets-rendu.js) ; il ne lit rien : chaque dessin est fait de
// l'état que le serveur a rendu pour le widget. La seule chose qu'il envoie : lancer une scène, par la route qui existe
// (POST /api/maison/scene), quand le serveur dit que qui regarde peut la lancer (`lancer`), jamais sur l'écran de la
// maison, jamais en mode « Modifier ». Une scène qui ouvre la maison : le serveur demande l'accord, la page le demande
// à chaque fois ; sans accord, rien ne part (pas de second envoi).
// - Ce que fait une scène est dit ici, à partir de ses comptes (la donnée ne porte aucune phrase).
// - Le bandeau : une puce par fait que le serveur a compté ; un fait que ce fichier ne connaît pas n'a pas de puce.
// - Ce qui ne tient pas dans la carte est caché, et « et N de plus » le dit ; un nom coupé garde son entier en info-bulle.
// - Les nombres dans la langue de la page ; °C ou °F comme Odin est réglé. Tout texte d'une donnée : textContent.
// Rien n'est touché au chargement : seulement window.OdinWidgetsMaisonEnsemble (textes et calculs, pour les essais) et sa déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsMaisonEnsemble) return;

  // ---------------- Dictionnaire (tous les textes de ces trois sortes)
  const pluriel = (n, un, plusieurs) => (n === 1 ? un : plusieurs);
  /** Un compte écrit dans la langue de la page (les textes reçoivent des nombres : le pluriel se décide sur le nombre). */
  const N = (n) => nombre(n);
  const TEXTES = {
    scenes: {
      titre: 'Scènes', quoi: 'tes scènes : un appui règle plusieurs appareils d\'un coup',
      etapes: (n) => `${N(n)} ${pluriel(n, 'étape', 'étapes')}`,
      ouvre: 'Ouvre la maison : ton accord est demandé à chaque fois.', ouvreCourt: 'ouvre la maison',
      vide: 'Aucune scène.', ouOdin: (appli) => (appli ? `Crée-les dans Odin, dans ${appli}.` : 'Crée-les dans Odin.'), creer: 'Créer une scène',
      sous: (n) => `${N(n)} ${pluriel(n, 'scène', 'scènes')}`,
      enCours: (nom) => `« ${nom} » : lancement…`,
      lancee: (nom) => `« ${nom} » lancée.`,
      partielle: (nom, n) => `« ${nom} » lancée ; ${N(n)} ${pluriel(n, 'étape n\'a pas abouti', 'étapes n\'ont pas abouti')}.`,
      pasPartie: (nom) => `« ${nom} » n'est pas partie.`,
      annule: 'Annulé : rien n\'est parti.',
      injoignable: 'Odin ne répond pas : rien n\'est parti.',
    },
    bandeau: {
      titre: 'Bandeau d\'état', quoi: 'l\'essentiel de la maison en puces : seulement ce qu\'Odin sait vraiment',
      rien: 'Rien à signaler.', rienDit: 'Rien à signaler : aucun appareil allumé, ouvert ou sans nouvelles qu\'Odin sache dire.',
      aucun: 'Aucun appareil.', aucunDit: 'Aucun appareil relié à Odin.',
      faits: {
        serrures_ouvertes: { dit: (n) => `${N(n)} ${pluriel(n, 'serrure ouverte', 'serrures ouvertes')}`, sur: (s) => `sur ${N(s)}` },
        sans_nouvelles: { dit: (n) => `${N(n)} sans nouvelles`, sur: (s) => `hors ligne ou muets, sur ${N(s)}` },
        tout_eteint: { dit: () => 'Tout est éteint', sur: (s) => `${N(s)} ${pluriel(s, 'appareil', 'appareils')}` },
        lumieres_allumees: { dit: (n) => `${N(n)} ${pluriel(n, 'lumière allumée', 'lumières allumées')}`, sur: (s) => `sur ${N(s)}` },
        clims_allumees: { dit: (n) => `${N(n)} ${pluriel(n, 'clim en marche', 'clims en marche')}`, sur: (s) => `sur ${N(s)}` },
        serrures_verrouillees: { dit: () => 'Serrures verrouillées', sur: (s) => `${N(s)} sur ${N(s)}` },
      },
      source: 'compté par Odin sur les appareils de la maison',
    },
    maison: {
      titre: 'Ma maison', quoi: 'ta maison en un coup d\'œil : ses pièces, ses appareils, ce qui est allumé',
      pieces: (n) => `${N(n)} ${pluriel(n, 'pièce', 'pièces')}`, appareils: (n) => `${N(n)} ${pluriel(n, 'appareil', 'appareils')}`,
      chiffres: { pieces: 'Pièces', appareils: 'Appareils', allumes: 'Allumés', sansNouvelles: 'Sans nouvelles' },
      lumieres: (n, sur) => `${N(n)} / ${N(sur)} ${pluriel(sur, 'lumière allumée', 'lumières allumées')}`,
      verrouillees: 'Serrures verrouillées', ouvertes: (n) => `${N(n)} ${pluriel(n, 'serrure ouverte', 'serrures ouvertes')}`,
      serrures: (n, sur) => `${N(n)} / ${N(sur)} ${pluriel(sur, 'serrure verrouillée', 'serrures verrouillées')}`,
      moyenne: (n) => `moyenne de ${N(n)} capteurs`, lue: (age) => `lue ${age}`,
      vide: 'Aucun appareil.', videDit: 'Aucun appareil relié à Odin.', ajouter: 'Ajouter un appareil',
    },
    plus: (n) => `et ${N(n)} de plus`,
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  const langue = () => { try { return (typeof document !== 'undefined' && document && document.documentElement.lang) || undefined; } catch { return undefined; } };
  /** Un nombre dans la langue de la page (une décimale au plus) ; illisible : ''. */
  function nombre(v, lg = langue()) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '';
    try { return new Intl.NumberFormat(lg, { maximumFractionDigits: 1 }).format(v); } catch { return String(v); }
  }
  const entier = (v) => (Number.isInteger(v) && v >= 0 ? v : undefined);
  const texte = (v) => (typeof v === 'string' ? v : '');
  /** Une scène lue sans confiance : un nom, un nombre d'étapes, « ouvre ». Sinon rien. */
  const sceneLue = (x) => (x && typeof x === 'object' && typeof x.nom === 'string' && x.nom.trim() ? { nom: x.nom, etapes: entier(x.etapes) ?? 0, ouvre: x.ouvre === true } : null);
  /** Ce que fait une scène, dit à partir de ses comptes. */
  const ditScene = (sc) => `${sc.nom} : ${T.scenes.etapes(sc.etapes)}.${sc.ouvre ? ` ${T.scenes.ouvre}` : ''}`;
  /** Le résultat d'un lancement, d'après la réponse de la route (`r` : rien quand Odin n'a pas répondu). */
  function resultat(nom, r) {
    if (!r || typeof r !== 'object') return T.scenes.injoignable;
    if (r.ok === false) return T.scenes.pasPartie(nom);
    // Le texte de Midgard : une ligne par étape, « ✗ » pour celle qui n'a pas abouti.
    const ratees = String(r.text ?? '').split('\n').filter((l) => l.startsWith('✗')).length;
    return ratees ? T.scenes.partielle(nom, ratees) : T.scenes.lancee(nom);
  }
  /** Un appel à la route qui existe (la session de la page) ; rend la réponse lue, ou rien. */
  async function poster(corps) {
    try {
      const r = await fetch('/api/maison/scene', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(corps) });
      return await r.json().catch(() => ({ ok: false }));
    } catch { return undefined; }
  }
  /**
   * Lance une scène par son nom. Une scène qui ouvre la maison : le serveur rend `confirm` sans rien lancer ; la page
   * demande l'accord (à chaque fois), et seulement avec lui renvoie avec `confirm: true`. Rend le texte à dire.
   */
  async function lancerScene(nom) {
    let r = await poster({ scene: nom });
    if (r && r.confirm) {
      const D = window.OdinDialog;
      let oui = false;
      try { oui = D && typeof D.confirm === 'function' ? (await D.confirm(String(r.confirm), { danger: true })) === true : false; } catch { oui = false; }
      if (!oui) return T.scenes.annule;
      r = await poster({ scene: nom, confirm: true });
    }
    return resultat(nom, r);
  }

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const SVG = {
    cadenas: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    ouvert: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    debranche: '<path d="M3 3l18 18M8.5 8.5A5 5 0 0 0 7 12v2h4M12 5v3M17 12v2h-2M9 18v3M15 18v3"/>',
    marche: '<path d="M12 3v7M7 6.5a7 7 0 1 0 10 0"/>',
    ampoule: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    flocon: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
    thermo: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
    maison: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
    alerte: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[k] ?? ''}</svg>`;
  // Les couleurs : celles du thème d'Odin (--accent, --good, --warn, --ink, --muted, --line, --field) ou, sur l'écran de la
  // maison, celles de son thème (--text, --card2). Aucune couleur n'est écrite ici.
  const CSS = `
:has(>.wme){display:flex;flex-direction:column}
.wme{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:6px;margin-top:8px;color:var(--ink,var(--text,inherit))}
.wme [hidden]{display:none!important}
.wme-tient{flex:1 1 auto;min-height:0;min-width:0;overflow:hidden}
.wme-plus{flex:none;font-size:11.5px;color:var(--muted,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;align-self:center}
.wme-nom{display:block;min-width:0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;unicode-bidi:isolate}
.wme-ic{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:var(--wme-c,var(--accent,currentColor));background:color-mix(in srgb,var(--wme-c,var(--accent,currentColor)) 18%,transparent)}
.wme-ic svg{width:17px;height:17px}
/* Les scènes : une grille de boutons de 44 px au moins, autant de colonnes que la carte en tient. */
.wme-scenes{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(118px,100%),1fr));grid-auto-rows:min-content;gap:4px 6px;align-content:start}
.wme.wme-s{gap:4px}
.wme-sc{display:flex;flex-direction:column;justify-content:center;gap:1px;min-width:0;min-height:44px;padding:5px 10px;border-radius:12px;border:1px solid var(--line,transparent);background:color-mix(in srgb,var(--field,var(--card2,currentColor)) 70%,transparent);color:inherit;font:inherit;text-align:start;line-height:1.25}
button.wme-sc{cursor:pointer}button.wme-sc:hover{border-color:var(--accent,currentColor)}button.wme-sc:disabled{opacity:.6;cursor:progress}
.wme-sc:focus-visible,.wme-btn:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
.wme-sc .wme-nom{font-size:13px;font-weight:650}
.wme-sc small{display:block;min-width:0;font-size:11px;color:var(--muted,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wme-sc[data-ouvre] small{color:var(--warn,inherit);font-weight:650}
.wme-pied{flex:none;display:flex;align-items:baseline;gap:4px 10px;min-width:0;min-height:1.3em}.wme-pied>.wme-plus{flex:none;align-self:auto}.wme>.wme-plus{align-self:flex-start;min-height:1.3em;line-height:1.3}
.wme-dit{flex:1 1 0;min-width:0;margin:0;min-height:1.3em;font-size:12px;line-height:1.3;color:var(--muted,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wme-calme{margin:0;font-size:13.5px;line-height:1.35;overflow-wrap:anywhere}
.wme-btn{flex:none;align-self:flex-start;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line,currentColor);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:650;cursor:pointer}
/* Le bandeau : une ligne de puces ; celles qui ne tiennent pas sont comptées par « et N de plus ». */
.wme.wme-b{margin-top:0;justify-content:center}
.wme-puces{display:flex;flex-wrap:nowrap;align-items:center;gap:8px;min-width:0}
.wme-pu{flex:none;display:flex;align-items:center;gap:8px;min-height:44px;padding:4px 12px 4px 6px;border-radius:999px;border:1px solid var(--line,transparent);background:color-mix(in srgb,var(--field,var(--card2,currentColor)) 70%,transparent);white-space:nowrap}
.wme-pu b{display:block;font-size:12.5px;line-height:1.2}.wme-pu small{display:block;font-size:11px;line-height:1.2;color:var(--muted,inherit)}
.wme-pu.wme-seul{flex:0 1 auto;min-width:0;overflow:hidden}.wme-pu.wme-seul>span:last-child{min-width:0;overflow:hidden}.wme-pu.wme-seul b,.wme-pu.wme-seul small{overflow:hidden;text-overflow:ellipsis}
.wme-pu[data-ton="alarme"]{--wme-c:var(--warn,currentColor)}.wme-pu[data-ton="calme"]{--wme-c:var(--good,currentColor)}
.wme-b .wme-calme{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted,inherit)}
/* « Ma maison » : les chiffres, puis les étiquettes. */
.wme-chiffres{flex:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(92px,100%),1fr));gap:6px}
.wme-ch{min-width:0;padding:6px 10px;border-radius:12px;background:color-mix(in srgb,var(--field,var(--card2,currentColor)) 70%,transparent)}
.wme-ch b{display:block;font-size:20px;font-weight:750;line-height:1.15;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wme-ch b small{font-size:.6em;font-weight:600;color:var(--muted,inherit)}
.wme-ch span{display:block;font-size:11.5px;color:var(--muted,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wme-ch[data-ton="alarme"] b{color:var(--warn,inherit)}
.wme-tags{display:flex;flex-wrap:wrap;align-content:flex-start;gap:6px}
.wme-tag{flex:none;max-width:100%;display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;min-height:28px;padding:2px 10px;border-radius:10px;border:1px solid var(--line,transparent);font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wme-tag .wme-ic{width:20px;height:20px}.wme-tag svg{flex:none;width:15px;height:15px}.wme-tag[data-ton="alarme"]{color:var(--warn,inherit)}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle(); // la classe des textes dits aux lecteurs d'écran
    if (document.getElementById('odinWidgetsMaisonEnsemble')) return;
    // Hors téléphone, la carte a la hauteur de ses lignes de grille : son corps n'y compte pas (contain:size), si bien
    // qu'une longue liste n'étire ni la carte, ni sa voisine. Au téléphone, la hauteur suit le contenu.
    const G = window.OdinGrille, tel = G && G.GRILLE && Number.isInteger(G.GRILLE.telephone) ? G.GRILLE.telephone : 700;
    const s = document.createElement('style'); s.id = 'odinWidgetsMaisonEnsemble'; s.textContent = `${CSS}\n@media (min-width:${tel + 1}px){.fe-w>.wme{contain:size}}`; document.head.append(s);
  }
  function el(t, cls, txt) { const n = document.createElement(t); if (cls) n.className = cls; if (txt !== undefined) n.textContent = txt; return n; }
  const icone = (k) => { const s = el('span', 'wme-ic'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = svg(k); return s; };

  /**
   * Ce qui tient : chaque élément `[data-item]` de la boîte qui sort de son cadre est caché, avec ceux d'après, et
   * « et N de plus » le dit : `.wme-plus` dans le même flux (une ligne de puces), ou posé sous la boîte (`boite.wmePlus`, une
   * grille : il ne prend pas la place d'une rangée) ; `data-max` : jamais plus que cela (au téléphone, la hauteur
   * suit le contenu) ; `data-extra` : ceux que le serveur n'a pas envoyés ; `data-garder` : jamais moins que cela (le
   * dernier gardé porte `wme-seul` et peut se resserrer, son texte coupé, son entier en info-bulle).
   */
  function caser(boite) {
    const items = [...boite.querySelectorAll('[data-item]')], plus = boite.wmePlus || boite.querySelector('.wme-plus'), dedans = Boolean(plus) && boite.contains(plus), extra = Number(boite.dataset.extra) || 0, max = Number(boite.dataset.max) || items.length, garder = Math.min(Number(boite.dataset.garder) || 0, items.length);
    // Posé sous la boîte, il garde toujours sa ligne (vide s'il n'y a rien de plus) : la boîte ne change pas de taille en le montrant.
    const montrer = (n) => { items.forEach((x, i) => { x.hidden = i >= n; x.classList.toggle('wme-seul', garder > 0 && n === garder && i === n - 1); }); const reste = items.length - n + extra; if (plus) { plus.hidden = dedans && reste <= 0; plus.textContent = reste > 0 ? T.plus(reste) : ''; } };
    montrer(items.length);
    const b = boite.getBoundingClientRect();
    if (!b.width) return;
    const dehors = (x) => { const r = x.getBoundingClientRect(); return r.bottom > b.bottom + 0.5 || r.right > b.right + 0.5 || r.left < b.left - 0.5; };
    let k = items.findIndex(dehors); if (k < 0) k = items.length;
    k = Math.max(Math.min(k, max), garder); montrer(k);
    while (k > garder && dedans && !plus.hidden && dehors(plus)) montrer(--k);
  }
  let veilleur = null;
  function tenir(boite) {
    boite.classList.add('wme-tient');
    if (typeof ResizeObserver !== 'function') { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => caser(boite)); return boite; }
    if (!veilleur) {
      veilleur = new ResizeObserver((l) => { for (const x of l) { if (x.target.isConnected) caser(x.target); else veilleur.unobserve(x.target); } });
      // Une police qui arrive change la largeur des textes, pas celle de la boîte : on recompte ce qui tient.
      try { if (document.fonts && typeof document.fonts.addEventListener === 'function') document.fonts.addEventListener('loadingdone', () => { for (const b of document.querySelectorAll('.wme-tient')) caser(b); }); } catch { /* rien */ }
    }
    veilleur.observe(boite);
    return boite;
  }
  const plusDe = () => { const p = el('span', 'wme-plus'); p.hidden = true; return p; };

  /** Les scènes : ses scènes par leur nom ; un appui la lance (seulement si le serveur le permet, sur l'accueil). */
  function scenes(e, o) {
    poserStyle();
    const c = el('div', 'wme wme-s');
    if (e.etat === 'vide') {
      const appli = texte(o && o.nomAppli);
      c.append(el('p', 'wme-calme', `${T.scenes.vide} ${T.scenes.ouOdin(appli)}`));
      if (!o || o.ecran !== 'maison') {
        const b = el('button', 'wme-btn', `${T.scenes.creer} ›`); b.type = 'button';
        b.addEventListener('click', (ev) => { ev.stopPropagation(); if (b.closest('.fe-edit')) return; location.hash = '#app=midgard'; });
        b.dataset.item = ''; c.append(b); tenir(c); // caché s'il ne tient pas dans la carte
      }
      return c;
    }
    const d = e.donnee || {}, liste = (Array.isArray(d.scenes) ? d.scenes : []).map(sceneLue).filter(Boolean);
    if (!liste.length) return null; // illisible : rien d'affirmé
    const lancer = d.lancer === true && (!o || o.ecran !== 'maison');
    const grille = el('div', 'wme-scenes'), dit = el('p', 'wme-dit');
    dit.setAttribute('role', 'status');
    grille.dataset.extra = String(Math.max(0, (entier(d.total) ?? liste.length) - liste.length)); grille.dataset.max = '6';
    const boutons = liste.map((sc) => {
      const b = el(lancer ? 'button' : 'div', 'wme-sc'), n = el('span', 'wme-nom', sc.nom), s = el('small', '', sc.ouvre ? `⚠ ${T.scenes.ouvreCourt}` : T.scenes.etapes(sc.etapes));
      n.dir = 'auto'; b.title = ditScene(sc); b.dataset.item = '';
      if (sc.ouvre) b.dataset.ouvre = '';
      b.append(n, s);
      if (lancer) {
        b.type = 'button';
        b.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (b.closest('.fe-edit')) return; // en mode « Modifier » : rien ne part
          for (const x of boutons) x.disabled = true;
          dit.textContent = T.scenes.enCours(sc.nom);
          try { dit.textContent = await lancerScene(sc.nom); } finally { for (const x of boutons) x.disabled = false; }
          dit.title = dit.textContent;
        });
      }
      return b;
    });
    // « et N de plus » sous la grille, à côté du résultat d'un lancement : il ne prend pas la place d'une scène.
    const pied = el('div', 'wme-pied'), plus = plusDe();
    grille.append(...boutons); grille.wmePlus = plus; pied.append(plus);
    if (lancer) pied.append(dit);
    c.append(tenir(grille), pied);
    return c;
  }
  const sousScenes = (e) => (e && e.etat === 'ok' && e.donnee && entier(e.donnee.total) ? T.scenes.sous(e.donnee.total) : '');

  /** Le bandeau : une puce par fait compté ; un fait inconnu de ce fichier n'a pas de puce. */
  const PUCE = { serrures_ouvertes: ['ouvert', 'alarme'], sans_nouvelles: ['debranche', 'alarme'], tout_eteint: ['marche', 'calme'], lumieres_allumees: ['ampoule', ''], clims_allumees: ['flocon', ''], serrures_verrouillees: ['cadenas', 'calme'] };
  function bandeau(e) {
    poserStyle();
    const c = el('div', 'wme wme-b');
    if (e.etat === 'vide') {
      const aucun = e.raison === 'aucun_appareil', p = el('p', 'wme-calme');
      p.append(icone('maison'), el('span', '', aucun ? T.bandeau.aucun : T.bandeau.rien)); p.title = aucun ? T.bandeau.aucunDit : T.bandeau.rienDit;
      c.append(p); return c;
    }
    const d = e.donnee || {}, puces = [];
    for (const x of Array.isArray(d.puces) ? d.puces : []) {
      if (!x || typeof x !== 'object' || !Object.prototype.hasOwnProperty.call(PUCE, x.fait)) continue;
      const f = T.bandeau.faits[x.fait], n = entier(x.n), sur = entier(x.sur);
      if (sur === undefined || (x.fait !== 'tout_eteint' && (n === undefined || n > sur))) continue; // illisible : pas de puce
      const [ic, ton] = PUCE[x.fait], p = el('span', 'wme-pu'), t = el('span', '');
      const dit = f.dit(n ?? 0), sous = f.sur(sur);
      if (ton) p.dataset.ton = ton;
      p.dataset.item = ''; p.title = `${dit} (${sous}) : ${T.bandeau.source}.`;
      t.append(el('b', '', dit), el('small', '', sous), el('span', 'wr-sr', ` : ${T.bandeau.source}`)); p.append(icone(ic), t); puces.push(p);
    }
    if (!puces.length) return null;
    const l = el('div', 'wme-puces'); l.setAttribute('role', 'list');
    for (const p of puces) p.setAttribute('role', 'listitem');
    l.dataset.garder = '1'; // toujours au moins la plus pressante
    l.append(...puces, plusDe()); c.append(tenir(l));
    return c;
  }

  /** « Ma maison » : les chiffres vrais, puis ce que disent les petits chiffres (une étiquette chacun, s'il y a ces appareils). */
  function maison(e, o) {
    poserStyle();
    const c = el('div', 'wme wme-m'), lg = langue(), R = window.OdinWidgetsRendu;
    if (e.etat === 'vide') {
      c.append(el('p', 'wme-calme', T.maison.vide));
      if (!o || o.ecran !== 'maison') {
        const b = el('button', 'wme-btn', `${T.maison.ajouter} ›`); b.type = 'button'; b.title = T.maison.videDit;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); if (b.closest('.fe-edit')) return; location.hash = '#app=midgard'; });
        b.dataset.item = ''; c.append(b); tenir(c); // caché s'il ne tient pas dans la carte
      }
      return c;
    }
    const d = e.donnee || {}, pieces = entier(d.pieces), appareils = entier(d.appareils), muets = entier(d.sansNouvelles);
    if (pieces === undefined || appareils === undefined || muets === undefined || !appareils) return null;
    const ch = el('div', 'wme-chiffres'), chiffre = (valeur, libelle, ton) => { const b = el('div', 'wme-ch'), v = el('b'); v.append(...valeur); if (ton) b.dataset.ton = ton; b.title = `${libelle} : ${b.textContent || valeur.map((x) => (typeof x === 'string' ? x : x.textContent)).join('')}`; b.append(v, el('span', '', libelle)); return b; };
    ch.append(chiffre([nombre(pieces, lg)], T.maison.chiffres.pieces), chiffre([nombre(appareils, lg)], T.maison.chiffres.appareils));
    const a = d.allumes && typeof d.allumes === 'object' ? d.allumes : null;
    if (a && entier(a.n) !== undefined && entier(a.sur) !== undefined && a.n <= a.sur) ch.append(chiffre([nombre(a.n, lg), el('small', '', ` / ${nombre(a.sur, lg)}`)], T.maison.chiffres.allumes));
    ch.append(chiffre([nombre(muets, lg)], T.maison.chiffres.sansNouvelles, muets ? 'alarme' : ''));
    const tags = el('div', 'wme-tags'), tag = (ic, txt, dit, ton) => { const t = el('span', 'wme-tag'); t.dataset.item = ''; if (ton) t.dataset.ton = ton; t.title = dit || txt; t.append(icone(ic), el('span', 'wme-nom', txt)); return t; };
    const tp = d.temperature && typeof d.temperature === 'object' ? d.temperature : null;
    if (tp && typeof tp.valeur === 'number' && Number.isFinite(tp.valeur) && entier(tp.n)) {
      const u = tp.unite === 'F' ? '°F' : tp.unite === 'C' ? '°C' : '';
      if (u) {
        const quoi = tp.n > 1 ? T.maison.moyenne(tp.n) : texte(tp.piece), age = tp.ageInconnu !== true && R && typeof R.depuis === 'function' && Number.isFinite(tp.at) ? R.depuis(tp.at) : '';
        const txt = `${nombre(tp.valeur, lg)}\u00a0${u}${quoi ? ` · ${quoi}` : ''}`;
        tags.append(tag('thermo', txt, [txt, age ? T.maison.lue(age) : ''].filter(Boolean).join(' · ')));
      }
    }
    const sr = d.serrures && typeof d.serrures === 'object' ? d.serrures : null;
    if (sr && entier(sr.n) !== undefined && entier(sr.sur) && sr.n <= sr.sur) {
      const ouv = entier(sr.ouvertes) || 0;
      tags.append(ouv ? tag('ouvert', T.maison.ouvertes(ouv), '', 'alarme') : sr.n === sr.sur ? tag('cadenas', T.maison.verrouillees) : tag('cadenas', T.maison.serrures(sr.n, sr.sur)));
    }
    const lu = d.lumieres && typeof d.lumieres === 'object' ? d.lumieres : null;
    if (lu && entier(lu.n) !== undefined && entier(lu.sur) && lu.n <= lu.sur) tags.append(tag('ampoule', T.maison.lumieres(lu.n, lu.sur)));
    c.append(ch);
    if (tags.childElementCount) { const plus = plusDe(); tags.wmePlus = plus; c.append(tenir(tags), plus); }
    return c;
  }
  const sousMaison = (e) => {
    const d = e && e.etat === 'ok' && e.donnee ? e.donnee : null; if (!d || !entier(d.appareils)) return '';
    return [entier(d.pieces) ? T.maison.pieces(d.pieces) : '', T.maison.appareils(d.appareils)].filter(Boolean).join(' · ');
  };

  window.OdinWidgetsMaisonEnsemble = { TEXTES, CSS, nombre, ditScene, resultat, lancerScene };
  // La déclaration (lue par pages/widgets-rendu.js, quel que soit l'ordre de chargement), famille « maison », appli lue :
  // Midgard. Les tailles de la maquette : Scènes 4 × 3, Bandeau 12 × 1, Ma maison 6 × 4 (4 colonnes au téléphone).
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'maison', sortes: [
    { sorte: 'maison_scenes', titre: T.scenes.titre, quoi: T.scenes.quoi, symbole: '▶', appli: 'midgard', poser: { c: 4, r: 3, pc: 4 }, vides: ['aucune_scene'], sous: sousScenes, dessiner: scenes },
    { sorte: 'maison_bandeau', titre: T.bandeau.titre, quoi: T.bandeau.quoi, symbole: '≡', appli: 'midgard', petit: true, poser: { c: 12, r: 1, pc: 4, pr: 1 }, vides: ['aucun_appareil', 'rien_a_dire'], dessiner: bandeau },
    { sorte: 'ma_maison', titre: T.maison.titre, quoi: T.maison.quoi, symbole: '⌂', appli: 'midgard', poser: { c: 6, r: 4, pc: 4 }, vides: ['aucun_appareil'], sous: sousMaison, dessiner: maison },
  ] });
})();
