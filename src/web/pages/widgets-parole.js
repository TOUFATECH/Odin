// Le widget « Odin » de l'accueil (maquette validée « Accueil », le widget d'Odin) : le visage d'Odin, ce qu'il dit
// maintenant entre guillemets, le bouton de sa proposition et « Autre chose ». Il dessine ce que le serveur a rendu pour CE
// widget (src/valhalla/widgets/parole.ts) et rien d'autre :
// - la phrase est celle du moteur de parole d'Odin, telle quelle (le widget n'en écrit aucune, et n'en demande aucune :
//   le serveur garde la phrase du moment, pour tous les écrans) ; posée par textContent, les guillemets sont ceux de la
//   langue de la page (<q>) ; une phrase longue est coupée à l'écran, son entier reste en info-bulle et pour les lecteurs
//   d'écran ;
// - les boutons sont les propositions du moteur, jouées par le chemin de la mascotte (OdinGuide.lancer, guide.js) : une
//   action qui change quelque chose demande l'accord, une action grave le redemande à chaque fois, « le demander à Odin »
//   ouvre la même conversation, « ouvrir » mène à la page ; le résultat est dit dans la bulle de la mascotte ;
// - « Autre chose » ouvre « Que veux-tu ? » (OdinNotices.talk) ;
// - le moteur s'est tu (« vide », rien_de_neuf) : le visage et « Autre chose », sans phrase (rien n'est dit à sa place) ;
// - le visage est la mascotte de la page elle-même (son dessin, recopié du bandeau, et qui la suit : sa forme, ses classes
//   et sa couleur du moment, donc son humeur), jamais un dessin à part : deux yeux en pastille, blancs, et la couleur ; ses mouvements sont
//   ceux de face.js (aucun si « moins d'animations » est demandé). Sans mascotte dans la page : pas de visage ;
// - en mode « Modifier », rien ne part ; jamais sur l'écran de la maison.
// La carte ne montre que ce qui y tient en entier (ajuster) : d'abord les autres propositions, puis le visage plus petit,
// la phrase sur deux lignes, « Autre chose », la phrase sur une ligne, la proposition ; la phrase reste. Un libellé tient sur deux lignes. Elle ne s'étire pas.
// Rien n'est touché au chargement : seulement window.OdinWidgetsParole (ses textes et calculs, pour les essais) et sa déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsParole) return;

  // ---------------- Dictionnaire (les libellés du widget ; la phrase, elle, vient du moteur)
  const TEXTES = {
    titre: 'Odin', quoi: 'La phrase d\'Odin, son humeur et ses suggestions', autre: 'Autre chose',
    propositions: 'Ce qu\'Odin propose', grave: 'Action grave : ton accord est demandé à chaque fois.',
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  const ID = /^[a-z0-9_-]{1,40}$/i, ID_ACTION = /^[a-z_][a-z0-9_]{0,39}$/i, OUVRIR = /^(app|vue):[a-z0-9_-]{1,40}$/i;
  /** Une proposition relue (les mêmes règles que le serveur) : une copie avec seulement ce que la mascotte sait jouer, ou rien. */
  function propositionDe(p) {
    if (!p || typeof p !== 'object' || typeof p.label !== 'string' || !p.label.trim()) return null;
    const label = p.label.trim().slice(0, 60), a = p.act;
    if (a && typeof a === 'object') {
      if (typeof a.module !== 'string' || !ID.test(a.module) || typeof a.action !== 'string' || !ID_ACTION.test(a.action)) return null;
      // Comme le serveur : dix réglages au plus, des clés simples, un texte de 200 caractères au plus, un nombre fini.
      const input = a.input && typeof a.input === 'object' && !Array.isArray(a.input) ? Object.fromEntries(Object.entries(a.input).slice(0, 10)
        .filter(([k, v]) => ID_ACTION.test(k) && (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))))
        .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 200) : v])) : {};
      return { label, act: { module: a.module, action: a.action, read: a.read === true, grave: a.grave === true, input } };
    }
    if (typeof p.demander === 'string' && p.demander.trim()) return { label, demander: p.demander.slice(0, 400).trim() };
    if (typeof p.ouvrir === 'string' && OUVRIR.test(p.ouvrir)) return { label, ouvrir: p.ouvrir };
    return null;
  }
  /** Ce que la carte montre d'un état : { texte, propositions } ; rien si l'état est illisible. Le silence : texte vide. */
  function lu(e) {
    if (e && e.etat === 'vide' && e.raison === 'rien_de_neuf') return { texte: '', propositions: [] };
    const d = e && (e.etat === 'ok' || e.etat === 'ancien') && e.donnee && typeof e.donnee === 'object' ? e.donnee : null;
    if (!d || typeof d.texte !== 'string' || !d.texte.trim()) return null;
    return { texte: d.texte.trim(), propositions: (Array.isArray(d.propositions) ? d.propositions : []).map(propositionDe).filter(Boolean).slice(0, 3) };
  }

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  // Les couleurs : celles du thème d'Odin (--ink, --muted, --line, --accent) et ses boutons (.btn). Aucune couleur écrite ici,
  // et rien qui vise les yeux (leur couleur est celle de face.js : le blanc).
  const CSS = `
:has(>.wp-corps){display:flex;flex-direction:column}
.wp-corps{flex:1 1 auto;min-height:0;min-width:0;display:flex;align-items:center;gap:10px;overflow:hidden;padding:3px;margin:-3px;color:var(--ink,var(--text,inherit))}
.wp-corps [hidden]{display:none!important}
.wp-visage{flex:none;width:48px;height:48px}
.wp-corps.wp-petit .wp-visage{width:36px;height:36px}
.wp-col{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:6px}
.wp-col>*{flex:none;min-width:0}
.wp-phrase{margin:0;font-size:15px;font-weight:650;line-height:1.35;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.wp-phrase q{quotes:auto}
:lang(fr) .wp-phrase q{quotes:'\\AB\\202F' '\\202F\\BB' '\\201C' '\\201D'}
.wp-actions{display:flex;flex-wrap:wrap;gap:6px}
.wp-corps .wp-btn{display:inline-flex;align-items:center;gap:4px;min-height:44px;min-width:44px;max-width:100%;margin:0;padding:4px 10px;overflow:hidden;white-space:normal;text-align:start;line-height:1.2}
.wp-btn .wp-l{min-width:0;overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.wp-btn:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
.wp-btn .wp-g{flex:none;color:currentColor}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle();
    if (document.getElementById('odinWidgetsParole')) return;
    // Hors téléphone, la carte a la hauteur de ses lignes : son corps n'y compte pas (une phrase longue n'étire ni la carte,
    // ni sa voisine). Au téléphone, la hauteur suit le contenu.
    const G = window.OdinGrille, tel = G && G.GRILLE && Number.isInteger(G.GRILLE.telephone) ? G.GRILLE.telephone : 700;
    const s = document.createElement('style'); s.id = 'odinWidgetsParole'; s.textContent = `${CSS}\n@media (min-width:${tel + 1}px){.fe-w>.wp-corps{contain:size}}`; document.head.append(s);
  }
  function el(t, cls, texte) { const n = document.createElement(t); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; }
  /** Les mascottes de la page, dans l'ordre où le visage est repris (le bandeau d'abord). */
  const MASCOTTES = ['#buddy', '#buddyM', '#buddyRoam', '#buddyChat'];
  /** Ce que face.js pose sur une mascotte pour sa forme du moment (poser, face.js) ; sa taille reste celle du widget. */
  const FORME = (c) => /^(e-|c-|m-|sans-)/.test(c) || c === 'o-vive';
  /**
   * Recopie la mascotte `m` dans le visage `v` : son dessin (tout, si `dessin`), la couleur de ses dégradés, ses réglages
   * (--lsx, --o-c0…) et les classes de sa forme. face.js lui donne ses propres identifiants (own) ; la couleur des yeux
   * reste la sienne (le blanc).
   */
  function recopier(v, m, dessin) {
    const src = m.querySelector(':scope > svg'); if (!src) return;
    let svg = v.querySelector(':scope > svg');
    if (dessin || !svg) {
      svg = src.cloneNode(true); svg.removeAttribute('data-own'); svg.removeAttribute('id'); v.replaceChildren(svg);
      try { if (window.OdinFace && typeof window.OdinFace.own === 'function') window.OdinFace.own(svg); } catch { /* les identifiants restent ceux de la mascotte */ }
    } else {
      const a = [...src.querySelectorAll('stop')], b = [...svg.querySelectorAll('stop')];
      if (a.length === b.length) a.forEach((st, i) => { if (b[i].style.stopColor !== st.style.stopColor) b[i].style.stopColor = st.style.stopColor; });
    }
    const st = m.style;
    for (const k of [...v.style]) if (k.startsWith('--') && !st.getPropertyValue(k)) v.style.removeProperty(k);
    for (let i = 0; i < st.length; i++) { const k = st[i]; if (k.startsWith('--') && v.style.getPropertyValue(k) !== st.getPropertyValue(k)) v.style.setProperty(k, st.getPropertyValue(k)); }
    for (const c of [...v.classList]) if (FORME(c) && !m.classList.contains(c)) v.classList.remove(c);
    for (const c of m.classList) if (FORME(c)) v.classList.add(c);
  }
  /**
   * Le visage d'Odin : le dessin de la mascotte de la page, recopié, et qui la SUIT : quand elle change d'humeur (sa forme,
   * sa couleur), le visage change avec elle ; si face.js repeint ce visage à part (le thème, une humeur donnée à toutes les
   * mascottes), il reprend celui de la mascotte. Son humeur quand Odin en a une, le repos sinon. Aucune mascotte dans la
   * page : la place reste vide (jamais un dessin à part). L'observateur s'arrête quand le visage quitte la page.
   */
  function visage() {
    const v = el('span', 'odin wp-visage'); v.setAttribute('aria-hidden', 'true');
    let m = null;
    for (const q of MASCOTTES) { const n = document.querySelector(`${q} > svg`); if (n) { m = n.parentElement; break; } }
    if (!m) return v;
    recopier(v, m, true);
    if (typeof MutationObserver !== 'function') return v;
    const ne = Date.now(); let vu = false, attente = 0;
    const o = new MutationObserver((rs) => {
      // Hors de la page : arrêté s'il y a été, ou s'il n'y est pas venu en 10 s (une carte jamais posée).
      if (!v.isConnected) { if (vu || Date.now() - ne > 10_000) o.disconnect(); return; }
      vu = true;
      const dessin = rs.some((r) => r.type === 'childList');
      const faire = () => { attente = 0; if (!v.isConnected) return; recopier(v, m, dessin); o.takeRecords(); };
      // Une fois par image au plus (la mascotte bouge souvent : le regard suit la souris).
      if (dessin) { if (attente && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(attente); faire(); }
      else if (!attente) attente = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(faire) : (faire(), 0);
    });
    const quoi = { attributes: true, attributeFilter: ['class', 'style'], childList: true, subtree: true };
    o.observe(m, quoi); o.observe(v, quoi);
    return v;
  }
  /** Joue une proposition par le chemin de la mascotte (guide.js) : son accord, sa confirmation, sa bulle pour le résultat. */
  function jouer(p) {
    const G = window.OdinGuide;
    if (G && typeof G.lancer === 'function') G.lancer(p);
  }
  /** Le corps du widget : le visage, la phrase, les propositions, « Autre chose ». */
  function dessiner(e, o) {
    if (o && o.ecran === 'maison') return null; // jamais sur l'écran de la maison
    const x = lu(e); if (!x) return null; // illisible : rien d'affirmé
    poserStyle();
    const c = el('div', 'wp-corps'), face = visage(), col = el('div', 'wp-col');
    c.append(face, col);
    if (x.texte) {
      const p = el('p', 'wp-phrase'), q = el('q', '', x.texte);
      q.dir = 'auto'; p.title = x.texte; p.append(q); col.append(p);
    }
    const barre = el('div', 'wp-actions'); barre.setAttribute('role', 'group'); barre.setAttribute('aria-label', T.propositions);
    const peutJouer = Boolean(window.OdinGuide && typeof window.OdinGuide.lancer === 'function');
    x.propositions.forEach((p, i) => {
      if (!peutJouer) return; // sans le chemin de la mascotte, aucun bouton qui ne mènerait nulle part
      // Le libellé, coupé à l'écran s'il ne tient pas (son entier : info-bulle et lecteurs d'écran) ; la marque d'une action grave reste devant, toujours vue.
      const b = el('button', `btn small wp-btn wp-prop${i === 0 ? ' primary' : ''}`), l = el('span', 'wp-l', p.label); b.type = 'button'; l.dir = 'auto'; b.title = p.label;
      if (p.act && p.act.grave) { const g = el('span', 'wp-g', '⚠'); g.setAttribute('aria-hidden', 'true'); b.append(g); b.title = `${p.label} · ${T.grave}`; b.setAttribute('aria-description', T.grave); }
      b.append(l);
      b.addEventListener('click', (ev) => { ev.stopPropagation(); if (b.closest('.fe-edit')) return; jouer(p); });
      barre.append(b);
    });
    const autre = el('button', 'btn small wp-btn wp-autre', T.autre); autre.type = 'button';
    autre.addEventListener('click', (ev) => {
      ev.stopPropagation(); if (autre.closest('.fe-edit')) return;
      const N = window.OdinNotices; if (N && typeof N.talk === 'function') N.talk(face.isConnected ? face : undefined);
    });
    barre.append(autre); col.append(barre);
    suivre(c);
    return c;
  }
  /**
   * Ne garder que ce qui tient en entier : les autres propositions (la dernière d'abord), le visage plus petit, la phrase
   * sur deux lignes, « Autre chose », la phrase sur une ligne, puis la proposition. La phrase reste. Tout est remis avant chaque mesure.
   */
  function ajuster(c) {
    if (!c.isConnected) return;
    const props = [...c.querySelectorAll('.wp-prop')], autre = c.querySelector('.wp-autre'), barre = c.querySelector('.wp-actions'), p = c.querySelector('.wp-phrase');
    c.classList.remove('wp-petit');
    for (const n of [...props, autre, barre]) if (n) n.hidden = false;
    if (p) p.style.removeProperty('-webkit-line-clamp');
    if (!c.clientHeight) return;
    const deborde = () => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1;
    for (let i = props.length - 1; i >= 1 && deborde(); i--) props[i].hidden = true;
    // Le visage plus petit d'abord : il rend de la largeur à la phrase et aux libellés.
    if (deborde()) c.classList.add('wp-petit');
    // La phrase sur deux lignes, puis sans « Autre chose », puis sur une ligne : le sens d'abord.
    if (p && deborde()) p.style.setProperty('-webkit-line-clamp', '2');
    if (deborde() && autre && (p || props.length)) autre.hidden = true;
    if (p && deborde()) p.style.setProperty('-webkit-line-clamp', '1');
    if (deborde() && props[0] && p) props[0].hidden = true;
    if (barre && [...barre.children].every((n) => n.hidden)) barre.hidden = true;
  }
  /** Rejoue ajuster à chaque changement de taille du corps (posé, agrandi, réduit, page redessinée). */
  function suivre(c) {
    if (typeof ResizeObserver !== 'function') return;
    try { new ResizeObserver(() => ajuster(c)).observe(c); } catch { /* sans observateur : le corps coupe au bord */ }
  }

  window.OdinWidgetsParole = { TEXTES, CSS, propositionDe, lu };
  // La déclaration (lue par pages/widgets-rendu.js) : rangée dans « Odin » du tiroir comme la maquette, proposée au
  // propriétaire seul, jamais sur l'écran de la maison (la même marque que sa sorte, parole.ts), à la taille de départ de
  // la maquette (4 × 2). Le silence du moteur (« vide », rien_de_neuf) est un état calme qu'elle dessine elle-même.
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'odin', sortes: [
    { sorte: 'parole', groupe: 'odin', proprio: true, jamaisALaMaison: true, titre: T.titre, quoi: T.quoi, symbole: '◉', poser: { c: 4, r: 2, pc: 4 }, vides: ['rien_de_neuf'], dessiner },
  ] });
})();
