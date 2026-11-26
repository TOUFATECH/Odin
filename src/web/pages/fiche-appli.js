// La fiche d'une appli, au survol (souris), au focus (clavier) ou par appui long (doigt), sur la carte des applis comme
// dans la grille et en plein écran : un bandeau aux couleurs de l'appli avec son icône, son nom et sa famille, son état
// en pastille, une phrase qui dit à quoi elle sert, trois ou quatre choses qu'on peut y faire, l'origine de son nom,
// « Alternative à : » et les logiciels connus qu'elle remplace, puis un vrai bouton « Ouvrir <appli> » et, quand la
// fenêtre d'Odin le permet à qui regarde (le propriétaire), « Mettre en widget sur : l'accueil » (fenetre.js, poserAppli)
// et les « Actions rapides » de l'appli (la règle et le lancement de sa page : valhalla.js, OdinApps).
// La fiche ne sort jamais de l'écran et ne cache pas l'appli survolée. Elle reste ouverte tant que la souris ou le
// focus est dessus.
// Ce fichier est chargé avant les autres scripts de l'interface : rien ne touche au document à son chargement.
// API : OdinFicheAppli.construire(m, { ouvrir }) → article ; montrer(m, ancre, { ouvrir }) ; cacher(ms) ;
//       brancher(élément, () => m, { ouvrir }) (survol, focus, appui long) ; logique (etat, textes, placer).
(() => {
  'use strict';
  if (window.OdinFicheAppli) return;

  // ---------------- Logique pure (sans document)
  /** L'état de l'appli en une pastille : hors ligne, alerte grave, à surveiller, mise à jour, ou prête. */
  function etat(m = {}) {
    const n = Number(m.alerts) || 0;
    if (m.horsLigne) return { code: 'hors-ligne', libelle: 'Hors ligne', ton: 'off' };
    if (m.grave) { const k = Math.max(1, n); return { code: 'alerte', libelle: `${k} alerte${k > 1 ? 's' : ''}`, ton: 'bad' }; }
    if (n > 0) return { code: 'surveiller', libelle: 'À surveiller', ton: 'warn' };
    if ((Number(m.updates) || 0) > 0) return { code: 'maj', libelle: 'Mise à jour dispo', ton: 'info' };
    return { code: 'pret', libelle: 'Prête', ton: 'good' };
  }
  const MAX_PHRASE = 90, MAX_ALT = 5;
  /** Coupe un texte à `max` caractères, sur un mot, avec « … ». */
  function couper(t, max) {
    const s = String(t || '').replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    const c = s.slice(0, max - 1), i = c.lastIndexOf(' ');
    return `${(i > max * 0.5 ? c.slice(0, i) : c).replace(/[\s,;:.–—-]+$/, '')}…`;
  }
  /** La phrase de repli, tirée de `what` : avant la première parenthèse ou comparaison, sans fin de ponctuation. */
  function phraseDe(what) {
    let s = String(what || '').replace(/\s+/g, ' ').trim();
    const i = s.search(/\(|\s+comme\s|\s+façon\s/i); if (i > 0) s = s.slice(0, i);
    const j = s.search(/[.;](\s|$)/); if (j > 0) s = s.slice(0, j);
    s = s.replace(/[\s,;:–—-]+$/, '').trim();
    if (s && !/[.!?…]$/.test(s)) s += '.';
    return couper(s, MAX_PHRASE);
  }
  const majuscule = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  /** Les textes de la fiche : la phrase, ce qu'on peut y faire (3 ou 4), et les alternatives (5 au plus, puis le reste). */
  function textes(m = {}) {
    const sv = m.survol && typeof m.survol === 'object' ? m.survol : null;
    const phrase = sv?.phrase ? String(sv.phrase) : phraseDe(m.what);
    const faire = sv?.faire?.length ? sv.faire.slice(0, 4).map(String)
      : (m.does || []).slice(0, 3).map((x) => majuscule(couper(String(x).split(/\s;\s|\s\(/)[0], 60)));
    const noms = (m.similaires || []).map((x) => (typeof x === 'string' ? x : x?.nom)).filter((x) => typeof x === 'string' && x.trim());
    return { phrase, faire, alternatives: { noms: noms.slice(0, MAX_ALT), reste: Math.max(0, noms.length - MAX_ALT) } };
  }
  /**
   * Où poser la fiche : à droite de l'ancre, sinon à gauche, dessous ou dessus (dessous et dessus d'abord sur un écran
   * étroit). Jamais hors de l'écran, jamais sur l'ancre quand une place existe.
   */
  function placer(a, f, e, marge = 8) {
    const borne = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const xMil = borne(a.x + a.w / 2 - f.w / 2, marge, Math.max(marge, e.w - f.w - marge));
    const yMil = borne(a.y + a.h / 2 - f.h / 2, marge, Math.max(marge, e.h - f.h - marge));
    const cotes = {
      droite: { x: a.x + a.w + marge, y: yMil, ok: a.x + a.w + marge + f.w <= e.w - marge, place: e.w - (a.x + a.w) },
      gauche: { x: a.x - marge - f.w, y: yMil, ok: a.x - marge - f.w >= marge, place: a.x },
      dessous: { x: xMil, y: a.y + a.h + marge, ok: a.y + a.h + marge + f.h <= e.h - marge, place: e.h - (a.y + a.h) },
      dessus: { x: xMil, y: a.y - marge - f.h, ok: a.y - marge - f.h >= marge, place: a.y },
    };
    const etroit = f.w + 2 * marge > e.w * 0.6;
    const ordre = etroit ? ['dessous', 'dessus', 'droite', 'gauche'] : ['droite', 'gauche', 'dessous', 'dessus'];
    for (const c of ordre) if (cotes[c].ok) return { x: Math.round(cotes[c].x), y: Math.round(cotes[c].y), cote: c };
    // Aucune place nette : le côté qui en a le plus, ramené dans l'écran.
    const c = ordre.slice().sort((p, q) => cotes[q].place - cotes[p].place)[0];
    return { x: Math.round(borne(cotes[c].x, marge, Math.max(marge, e.w - f.w - marge))), y: Math.round(borne(cotes[c].y, marge, Math.max(marge, e.h - f.h - marge))), cote: c };
  }
  /**
   * Les textes de « Mettre en widget sur » (maquette validée : la fiche d'une appli). Seul l'accueil est proposé : l'écran
   * de la maison ne dessine pas encore le widget d'une appli. Le reste de la fiche écrit ses textes dans son dessin.
   */
  const TEXTES = {
    widget: 'Mettre en widget sur', accueil: 'L\'accueil', accueilNom: (n) => `Mettre ${n} en widget sur l'accueil`, enCours: 'Un instant…',
    dits: {
      // Des espaces insécables (\u00a0) dans les guillemets et devant « : » : la ligne ne se coupe jamais là.
      pose: (p) => (p ? `Posé à la fin de la page «\u00a0${p}\u00a0» de ton accueil.` : 'Posé à la fin de ton accueil.'),
      deja: (p) => (p ? `Ce widget est déjà sur ton accueil, page «\u00a0${p}\u00a0»\u00a0: rien n'est posé en double.` : 'Ce widget est déjà sur ton accueil\u00a0: rien n\'est posé en double.'),
      occupe: 'Termine d\'abord «\u00a0Modifier\u00a0» sur l\'accueil\u00a0: rien n\'est posé.',
      refuse: 'Ce widget ne peut pas être posé\u00a0: rien n\'a changé.',
      echec: 'Odin n\'a pas pu ranger ton accueil\u00a0: rien n\'est posé.',
    },
    // Les « Actions rapides » de l'appli (maquette : la fiche d'une appli).
    rapides: 'Actions rapides', grave: 'Action grave, ton accord est demandé à chaque fois.',
    fait: 'Fait.', muet: 'Odin ne répond pas.',
  };
  /** Ce que dit la fiche après « Mettre en widget » : la réponse de la fenêtre d'Odin ({ etat, page }). */
  const ditDe = (r) => {
    const t = TEXTES.dits[r && typeof r.etat === 'string' && Object.hasOwn(TEXTES.dits, r.etat) ? r.etat : 'echec'];
    return typeof t === 'function' ? t(r && typeof r.page === 'string' ? r.page : '') : t;
  };
  const logique = { etat, textes, placer, phraseDe, couper, ditDe, TEXTES };

  // ---------------- Dessin
  const css = `
.fa{--fa1:var(--accent);--fa2:var(--accent);width:min(340px,calc(100vw - 16px));max-width:100%;box-sizing:border-box;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 48px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.12);overflow:hidden;font-size:14px;line-height:1.45;text-align:left}
#odinFiche .fa{max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);overflow-y:auto;overscroll-behavior:contain}
.fa-band{position:relative;height:56px;background:linear-gradient(135deg,var(--fa1),var(--fa2))}
.fa-band::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.18),rgba(255,255,255,0) 60%)}
.fa-ic{position:absolute;left:16px;bottom:-22px;z-index:1;display:block;border-radius:12px;box-shadow:0 6px 16px rgba(0,0,0,.3),0 0 0 3px var(--panel)}
.fa-ic .odin-app-ic{display:grid!important}
.fa-corps{display:grid;gap:10px;padding:30px 16px 14px}
.fa-tete{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap}
.fa-tete h3{margin:0;font-size:17px;font-weight:700;line-height:1.2;color:var(--ink)}
.fa-fam{display:inline-block;margin-top:4px;font-size:12px;font-weight:600;padding:1px 9px;border-radius:99px;background:color-mix(in srgb,var(--fa1) 16%,transparent);color:var(--ink)}
.fa-etat{display:inline-flex;align-items:center;gap:6px;flex:none;font-size:12px;font-weight:600;padding:3px 10px;border-radius:99px;border:1px solid currentColor;background:color-mix(in srgb,currentColor 10%,transparent)}
.fa-etat::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.fa-etat.good{color:var(--good)}.fa-etat.warn{color:var(--warn)}.fa-etat.bad{color:var(--bad)}.fa-etat.info{color:var(--accent)}.fa-etat.off{color:var(--muted)}
.fa-phrase{margin:0;font-size:14px;color:var(--ink)}
.fa h4{margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.fa-faire ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.fa-faire li{display:flex;gap:8px;align-items:flex-start;color:var(--ink)}
.fa-faire svg{flex:none;width:16px;height:16px;margin-top:2px;fill:none;stroke:var(--fa1);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.fa-orig p{margin:0;font-size:12.5px;color:var(--muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.fa-alt{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12.5px}
.fa-alt>b{font-weight:600;color:var(--muted);margin-right:2px}
.fa-alt ul{display:contents;list-style:none}
.fa-alt li{padding:2px 9px;border-radius:99px;border:1px solid var(--line);background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--ink)}
.fa-alt li.fa-reste{color:var(--muted)}
.fa-ouvrir{width:100%;justify-content:center;min-height:44px}
.fa-mettre{display:grid;gap:6px}.fa-poser{width:100%;justify-content:center;min-height:44px}.fa-poser[aria-busy=true]{cursor:progress}
.fa-dit{margin:0;font-size:12.5px;color:var(--muted);overflow-wrap:anywhere}.fa-dit:empty{display:none}
.fa-rapides{display:grid;gap:6px}.fa-rapides-l{display:flex;flex-wrap:wrap;gap:6px}
.fa-rapide{flex:1 1 auto;min-height:44px;min-width:44px;max-width:100%;padding-block:6px;justify-content:center;white-space:normal;overflow-wrap:anywhere;text-align:center}.fa-rapide[aria-busy=true]{cursor:progress}.fa-rapide .fa-g{color:var(--warn)}
@media (max-width:480px){.fa{width:calc(100vw - 16px)}.og .og-card:has(>.fa){width:calc(100% - 16px)}.fa-band{height:44px}.fa-corps{gap:8px;padding-top:26px}.fa-orig{display:none}}
#odinFiche{position:fixed;z-index:45;left:0;top:0;opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s}
#odinFiche.on{opacity:1;transform:none}#odinFiche[hidden]{display:none}
@media (prefers-reduced-motion:reduce){#odinFiche,.og-card{transition:none!important;transform:none!important}}`;
  const COCHE = '<path d="M5 12.5l4.2 4.2L19 7"/>';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  function styler() { if (!document.getElementById('faCss')) { const s = document.createElement('style'); s.id = 'faCss'; s.textContent = css; document.head.append(s); } }
  /** La fiche d'une appli, prête à poser (dans la carte ou dans la page). */
  function construire(m, o = {}) {
    styler();
    const t = textes(m), e = etat(m), c = window.OdinAppIcons?.couleurs?.(m.id);
    const a = el('article', { class: 'fa', 'data-appli': m.id, 'aria-label': `${m.name} : ${t.phrase}` });
    if (c && c[0]) { a.style.setProperty('--fa1', c[0]); a.style.setProperty('--fa2', c[1] || c[0]); }
    const ic = el('span', { class: 'fa-ic', 'aria-hidden': 'true' }); if (window.OdinAppIcons) ic.innerHTML = window.OdinAppIcons.tile(m.id, m.name, 44);
    const coche = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = COCHE; return s; };
    a.append(el('div', { class: 'fa-band' }, ic),
      el('div', { class: 'fa-corps' },
        el('div', { class: 'fa-tete' }, el('div', {}, el('h3', {}, m.name), m.family ? el('span', { class: 'fa-fam' }, m.family) : null), el('span', { class: `fa-etat ${e.ton}` }, e.libelle)),
        t.phrase ? el('p', { class: 'fa-phrase' }, t.phrase) : null,
        t.faire.length ? el('div', { class: 'fa-faire' }, el('h4', {}, 'Ce que tu peux y faire'), el('ul', {}, ...t.faire.map((x) => el('li', {}, coche(), el('span', {}, x))))) : null,
        m.story ? el('div', { class: 'fa-orig' }, el('h4', {}, 'D\'où vient le nom'), el('p', {}, m.story)) : null,
        t.alternatives.noms.length ? el('div', { class: 'fa-alt' }, el('b', {}, 'Alternative à :'), el('ul', {}, ...t.alternatives.noms.map((x) => el('li', {}, x)), t.alternatives.reste ? el('li', { class: 'fa-reste' }, `+ ${t.alternatives.reste}`) : null)) : null,
        el('button', { class: 'btn primary fa-ouvrir', type: 'button', onclick: (ev) => { ev.stopPropagation(); cacher(0); o.ouvrir?.(m); } }, `Ouvrir ${m.name}`),
        // Comme la maquette (la fiche d'une appli) : « Actions rapides », puis « Mettre en widget sur ».
        actionsRapides(m),
        mettreEnWidget(m)));
    return a;
  }
  /** Trois actions au plus, comme le widget d'une appli (src/valhalla/widgets/applis.ts, ACTIONS_MAX). */
  const RAPIDES_MAX = 3;
  /** Ce que dit la fiche après une action : la première ligne de sa réponse (bornée), « Fait. », ou Odin muet. */
  const ditAction = (t) => (t === null ? TEXTES.muet : (typeof t === 'string' && t.trim() ? t.trim().split('\n')[0].slice(0, 240) : TEXTES.fait));
  /**
   * « Actions rapides » : au propriétaire seul (la même condition que « Mettre en widget » : la fenêtre d'Odin le dit
   * pour qui regarde, une appli active du catalogue), les actions rapides de l'appli choisies par la règle de sa page
   * (OdinApps.actionsRapides : jamais réécrite ici), trois au plus. Un appui la lance par l'action de l'appli
   * (OdinApps.lancer : POST /api/valhalla/act ; une action grave redemande l'accord à chaque fois, sans accord rien ne
   * part). Le résultat est dit dans la fiche, en texte. Rien à offrir : pas de bloc (ni titre seul, ni bouton mort).
   * Pendant l'action, les boutons gardent le focus (aria-busy, pas `disabled`) et la fiche reste ouverte.
   */
  function actionsRapides(m) {
    const F = window.OdinFenetre, A = window.OdinApps;
    if (!F || typeof F.peutPoser !== 'function' || !F.peutPoser(m.id)) return null;
    if (!A || typeof A.actionsRapides !== 'function' || typeof A.lancer !== 'function') return null;
    let l; try { l = A.actionsRapides(Array.isArray(m.actions) ? m.actions : []); } catch { l = []; }
    l = (Array.isArray(l) ? l : []).filter((x) => x && typeof x.id === 'string' && x.id && typeof x.label === 'string' && x.label).slice(0, RAPIDES_MAX);
    if (!l.length) return null;
    const dit = el('p', { class: 'fa-dit', role: 'status' });
    let enCours = false;
    const boutons = l.map((x) => {
      const b = el('button', { class: 'btn fa-rapide', type: 'button', dir: 'auto', 'data-action': x.id, title: x.grave ? TEXTES.grave : (typeof x.what === 'string' && x.what ? x.what : null), 'aria-description': x.grave ? TEXTES.grave : null, onclick: async (ev) => {
        ev.stopPropagation(); if (enCours) return;
        // Le message fait grandir la fiche : elle est replacée pour ne pas couvrir l'appli.
        const ecrire = (t) => { dit.textContent = t; if (pop && pop.contains(b)) replacer(); };
        enCours = true; for (const y of boutons) y.setAttribute('aria-busy', 'true'); ecrire(TEXTES.enCours);
        let t; try { t = await A.lancer(m.id, x.id); } catch { t = null; }
        enCours = false; for (const y of boutons) y.removeAttribute('aria-busy'); ecrire(ditAction(t));
      } }, x.label, x.grave ? el('span', { class: 'fa-g', 'aria-hidden': 'true' }, ' ⚠') : null);
      return b;
    });
    return el('div', { class: 'fa-rapides' }, el('h4', { class: 'fa-rapides-t' }, TEXTES.rapides), el('div', { class: 'fa-rapides-l', role: 'group', 'aria-label': TEXTES.rapides }, ...boutons), dit);
  }
  /**
   * « Mettre en widget sur : l'accueil » : seulement quand la fenêtre d'Odin dit que c'est possible pour qui regarde (le
   * propriétaire, une appli de son catalogue, activée) ; sinon rien, ni bouton mort ni bouton grisé. Le bouton pose le
   * widget de l'appli à la fin de la page ouverte de l'accueil ; la fiche dit ce qui s'est passé. Pendant la pose, le
   * bouton garde le focus (aria-busy, pas `disabled`).
   */
  function mettreEnWidget(m) {
    const F = window.OdinFenetre;
    if (!F || typeof F.peutPoser !== 'function' || typeof F.poserAppli !== 'function' || !F.peutPoser(m.id)) return null;
    const dit = el('p', { class: 'fa-dit', role: 'status' });
    let enCours = false;
    const b = el('button', { class: 'btn fa-poser', type: 'button', 'aria-label': TEXTES.accueilNom(m.name), onclick: async (ev) => {
      ev.stopPropagation(); if (enCours) return;
      // Le message fait grandir la fiche : elle est replacée pour ne pas couvrir l'appli.
      const ecrire = (t) => { dit.textContent = t; if (pop && pop.contains(b)) replacer(); };
      enCours = true; b.setAttribute('aria-busy', 'true'); ecrire(TEXTES.enCours);
      let r; try { r = await F.poserAppli(m.id); } catch { r = undefined; }
      enCours = false; b.removeAttribute('aria-busy'); ecrire(ditDe(r));
    } }, TEXTES.accueil);
    return el('div', { class: 'fa-mettre' }, el('h4', {}, TEXTES.widget), b, dit);
  }

  // ---------------- La fiche posée dans la page (grille des applis)
  // `rendu` : l'appli à qui Échap rend le focus, le temps de le lui rendre.
  // `ancreRect` : l'ancre quand on n'a reçu qu'un rectangle (pas un élément).
  let pop = null, minuteur = 0, ancreVue = null, ancreRect = null, rendu = null;
  const TABULABLES = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  /** Les boutons qu'on atteint au clavier dans `r` (ceux qui se voient). */
  const boutons = (r) => [...r.querySelectorAll(TABULABLES)].filter((n) => n.getClientRects().length > 0);
  /** Ce qui suit `a` au clavier dans la page, hors de la fiche. */
  const suivant = (a) => { const l = boutons(document).filter((n) => !pop || !pop.contains(n)), i = l.indexOf(a); return i >= 0 ? l[i + 1] ?? null : null; };
  function boite() {
    if (pop && pop.isConnected) return pop;
    styler();
    pop = el('div', { id: 'odinFiche', role: 'tooltip', hidden: true });
    pop.addEventListener('pointerenter', () => clearTimeout(minuteur));
    pop.addEventListener('pointerleave', () => cacher());
    pop.addEventListener('focusin', () => clearTimeout(minuteur));
    pop.addEventListener('focusout', (e) => { if (!pop.contains(e.relatedTarget)) cacher(); });
    // Au clavier, la fiche se parcourt comme si elle suivait l'appli : Maj + Tab sur son premier bouton revient à
    // l'appli ; Tab sur son dernier va à ce qui suit l'appli dans la page (la fiche se ferme).
    pop.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !ancreVue) return;
      const l = boutons(pop), i = l.indexOf(document.activeElement), a = ancreVue;
      if (e.shiftKey && i === 0) { e.preventDefault(); a.focus(); }
      else if (!e.shiftKey && i === l.length - 1) { const s = suivant(a); if (s) { e.preventDefault(); cacher(0); s.focus(); } }
    });
    document.body.append(pop);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop && !pop.hidden) { const r = ancreVue; cacher(0); if (r && r.focus && pop.contains(document.activeElement)) { rendu = r; r.focus(); rendu = null; } } });
    return pop;
  }
  /** Montre la fiche de `m` à côté de `ancre` (élément ou rectangle). */
  function montrer(m, ancre, o = {}) {
    const p = boite(); clearTimeout(minuteur);
    if (ancreVue && ancreVue.removeAttribute) ancreVue.removeAttribute('aria-describedby');
    p.replaceChildren(construire(m, o)); p.hidden = false; p.classList.remove('on');
    ancreVue = ancre && ancre.setAttribute ? ancre : null; if (ancreVue) ancreVue.setAttribute('aria-describedby', 'odinFiche');
    ancreRect = ancreVue ? null : ancre;
    replacer();
    requestAnimationFrame(() => p.classList.add('on'));
  }
  /** Pose la fiche ouverte à côté de son ancre, à sa taille du moment (à l'ouverture, puis quand elle grandit). */
  function replacer() {
    if (!pop || pop.hidden || !pop.firstChild) return;
    const r = ancreVue ? ancreVue.getBoundingClientRect() : ancreRect; if (!r) return;
    const art = pop.firstChild, a = { x: r.left ?? r.x, y: r.top ?? r.y, w: r.width ?? r.w, h: r.height ?? r.h }, e = { w: innerWidth, h: innerHeight };
    art.style.maxHeight = '';   // sa taille entière (bornée à l'écran par sa feuille de style)
    const f = art.getBoundingClientRect();
    let pos = placer(a, { w: f.width, h: f.height }, e);
    // Elle couvrirait l'appli (aucune place nette autour, sur un écran étroit) : elle prend la hauteur du côté, dessus ou
    // dessous, qui a le plus de place, et défile en elle-même. Moins de 220 px : elle garde sa taille.
    const couvre = (p) => p.x < a.x + a.w && a.x < p.x + f.width && p.y < a.y + a.h && a.y < p.y + f.height;
    if (couvre(pos)) {
      const h = Math.floor(Math.max(a.y, e.h - (a.y + a.h)) - 16);
      if (h >= 220 && h < f.height) { art.style.maxHeight = `${h}px`; pos = placer(a, { w: f.width, h }, e); }
    }
    pop.style.left = `${pos.x}px`; pop.style.top = `${pos.y}px`; pop.dataset.cote = pos.cote;
  }
  /** Cache la fiche après `ms` (annulé si la souris ou le focus revient dessus). */
  function cacher(ms = 250) {
    clearTimeout(minuteur);
    // Une action rapide attend sa réponse ou l'accord demandé (la fenêtre d'accord prend le focus et passe devant) : la
    // fiche reste ouverte, sinon son résultat serait perdu. Échap et « Ouvrir » la ferment toujours (ms = 0). Seule
    // compte la fiche montrée : une action qui ne répond jamais ne garde pas ouverte la fiche d'une autre appli.
    if (ms > 0 && pop && pop.querySelector('.fa-rapide[aria-busy="true"]')) return;
    const fin = () => { if (!pop) return; pop.hidden = true; pop.classList.remove('on'); if (ancreVue && ancreVue.removeAttribute) ancreVue.removeAttribute('aria-describedby'); ancreVue = null; };
    if (ms <= 0) fin(); else minuteur = setTimeout(fin, ms);
  }
  /**
   * Branche la fiche sur un élément (une tuile de la grille) : souris 350 ms après l'arrivée, focus tout de suite,
   * appui long de 500 ms au doigt (le clic qui suit est alors annulé, l'appli ne s'ouvre pas).
   */
  function brancher(cible, appli, o = {}) {
    let t = 0, long = false, depart = null;
    const voir = () => { const m = appli(); if (m) montrer(m, cible, o); };
    cible.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'mouse') return; clearTimeout(t); t = setTimeout(voir, 350); });
    cible.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'mouse') return; clearTimeout(t); cacher(); });
    // Le focus rendu par Échap ne rouvre pas la fiche qu'on vient de fermer.
    cible.addEventListener('focus', () => { if (rendu !== cible && cible.matches(':focus-visible')) voir(); });
    cible.addEventListener('blur', () => cacher());
    // Tab sur l'appli dont la fiche est ouverte : le focus entre dans la fiche (son premier bouton), seulement quand elle
    // offre plus qu'« Ouvrir » (ce que fait déjà l'appli elle-même) ; sinon Tab va à l'appli suivante, comme avant.
    cible.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || e.shiftKey || !pop || pop.hidden || ancreVue !== cible || !pop.querySelector('.fa-mettre, .fa-rapides')) return;
      const b = boutons(pop)[0]; if (b) { e.preventDefault(); clearTimeout(minuteur); b.focus(); }
    });
    cible.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; long = false; depart = { x: e.clientX, y: e.clientY }; clearTimeout(t); t = setTimeout(() => { long = true; voir(); }, 500); });
    cible.addEventListener('pointermove', (e) => { if (depart && Math.hypot(e.clientX - depart.x, e.clientY - depart.y) > 10) { clearTimeout(t); depart = null; } });
    const fin = () => { clearTimeout(t); depart = null; };
    cible.addEventListener('pointerup', fin); cible.addEventListener('pointercancel', fin);
    cible.addEventListener('contextmenu', (e) => { if (long) e.preventDefault(); });
    cible.addEventListener('click', (e) => { if (long) { long = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  }

  window.OdinFicheAppli = { construire, montrer, cacher, brancher, logique };
})();
