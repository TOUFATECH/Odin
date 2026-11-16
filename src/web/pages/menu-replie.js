// Menus qui se replient tout seuls : le menu d'Odin (#sideNav) et le panneau de gauche du Cerveau (#brSide).
// Replié, le menu n'est plus qu'une colonne d'icônes ; il se déplie par-dessus le contenu quand la souris passe
// dessus, quand il prend le focus au clavier, ou au premier appui du doigt (cet appui n'ouvre pas l'onglet touché).
// Il se replie 500 ms après le départ de la souris, au départ du focus, à un clic dehors ou par Échap.
// La punaise en tête (« Garder le menu ouvert ») l'épingle : il reste alors affiché comme avant. Le choix est gardé.
// Mêmes noms que la maquette de l'accueil (.pinb, .pinned, .sideopen) pour reprendre le même mécanisme plus tard.
// Sur téléphone (860 px et moins), rien ne change : aucune classe n'est posée (barre du bas, tiroir).
// Ce fichier est chargé avant les autres scripts de l'interface : rien ne touche au document à son chargement ;
// le style est injecté une seule fois, au premier branchement (balise #mrCss).
// API : OdinMenu.brancher(conteneur, { panneau, cle, libelle, largeur, actif }) → { ouvrir, fermer, epingler, epingle, detacher } ;
// OdinMenu.logique (pure).
(() => {
  'use strict';
  if (window.OdinMenu) return;

  // ---------------- Logique pure (sans document)
  const FERMER_MS = 500;
  /** État de départ selon le réglage lu : '1' = épinglé, tout le reste = replié. */
  function depart(lu) { return lu === '1' ? 'pinned' : 'replie'; }
  /** État suivant : 'replie' (colonne d'icônes), 'sideopen' (déplié par-dessus) ou 'pinned' (épinglé). */
  function suivant(etat, evt) {
    if (evt === 'epingler') return etat === 'pinned' ? 'replie' : 'pinned';
    if (etat === 'pinned') return 'pinned';
    if (evt === 'entree' || evt === 'focus' || evt === 'appui') return 'sideopen';
    if (evt === 'sortie' || evt === 'flou' || evt === 'dehors' || evt === 'echap') return 'replie';
    return etat === 'sideopen' ? 'sideopen' : 'replie';
  }

  // ---------------- Style (seulement au-dessus de 860 px)
  const LOUPE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='6.5'/%3E%3Cpath d='M16 16l4 4'/%3E%3C/svg%3E\")";
  const PAGES = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z'/%3E%3Cpath d='M14 3.5V8h4M9 12h6M9 16h6'/%3E%3C/svg%3E\")";
  const icone = (url) => `content:"";display:block;width:18px;height:18px;background:currentColor;-webkit-mask:${url} center/contain no-repeat;mask:${url} center/contain no-repeat`;
  const R = '.app.replie:not(.sideopen)', B = '.br.replie:not(.sideopen)';
  // Replié, les libellés des onglets sont cachés à l'œil seulement : ils restent le nom lu par les lecteurs d'écran.
  const CACHE = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0';
  const css = `
.pinb{display:none;width:32px;height:32px;border:0;border-radius:10px;background:none;color:var(--muted);place-items:center;cursor:pointer;flex:none}
.pinb svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.pinb:hover{color:var(--ink);background:var(--hover)}
.pinb[aria-pressed=true]{background:var(--sel);color:var(--accent)}
.mr-dit{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (min-width:861px){
.pinned>.side .pinb,.sideopen>.side .pinb,.br.pinned .pinb,.br.sideopen .pinb{display:grid}
.app.pinned nav.side{position:relative}
.app>.side>.pinb{position:absolute;top:14px;right:10px;z-index:2}
.app.replie{padding-left:var(--mr-l,64px)}
.app.replie nav.side{position:fixed;left:0;top:0;bottom:0;width:var(--mr-l,64px);z-index:35;overflow-x:hidden;transition:width .2s,box-shadow .2s}
.app.replie.sideopen nav.side{width:232px;box-shadow:20px 0 50px rgba(0,0,0,.25)}
${R} nav.side .buddy-txt,${R} nav.side .buddy-snd,${R} nav.side .nav-h,${R} nav.side .nav-ep-x,${R} #palBtn kbd{display:none}
${R} nav.side .lbl,${R} #navMoreBtn>span:first-child,${B} .br-item span{${CACHE}}
${R} nav.side .brand{font-size:0;justify-content:center;padding-left:0;padding-right:0}
${R} nav.side .brand .rune{font-size:26px}
${R} #palBtn{font-size:0;justify-content:center;padding:0}
${R} #palBtn::before{${icone(LOUPE)}}
${R} nav.side .tab,${R} nav.side .nav-ep>.tab{padding:0 10px;position:relative}
${R} #navMoreBtn{padding:9px 10px;justify-content:center;position:relative}
${R} #navMoreBtn svg{margin-left:0}
${R} nav.side .tab .badge,${R} #navMoreBtn .badge{position:absolute;top:8px;left:26px;min-width:8px;width:8px;height:8px;padding:0;font-size:0;border:2px solid var(--panel2)}
${R} nav.side .buddy .odin{width:32px;height:32px}
${R} #piedMenu{padding-left:0;padding-right:0;align-items:center}
${R} #piedMenu>:not(#piedIA){display:none}
.br{position:relative}
.br-main{grid-column:2}
.br.replie{grid-template-columns:var(--mr-l,56px) minmax(0,1fr) 300px}
.br.replie.br-wide{grid-template-columns:var(--mr-l,56px) minmax(0,1fr)}
.br .pinb{align-self:flex-end;margin:-4px 0 -8px}
${B} .br-search{padding:0;justify-content:center;width:36px;height:36px}
${B} .br-search input,${B} .br-h,${B} .br-results,${B} .br-sec:has(#brTree)>*,${B} .br-sec:has(.br-trash)>*{display:none}
${B} .br-item{justify-content:center;padding:4px 0}
${B} .br-item .bi,${B} .br-item svg{margin:0}
${B} .br-sec:has(#brTree)::before{${icone(PAGES)};margin:4px auto;color:var(--dim)}
.br.replie.sideopen #brSide{position:absolute;inset:0 auto 0 0;width:250px;z-index:6;box-shadow:20px 0 50px rgba(0,0,0,.25)}
#v-brain.br-graphe>.head{display:none}
}
@media (min-width:1181px){.br-aside{grid-column:3}}
@media (min-width:1400px){.br.replie.br-wide{grid-template-columns:var(--mr-l,56px) minmax(0,1fr) 300px}}
@media (min-width:861px) and (max-width:1180px){.br.replie,.br.replie.br-wide{grid-template-columns:var(--mr-l,56px) minmax(0,1fr)}}
.br-graphe .br-gw{padding:0}
.br-graphe .br-cvw{border-radius:0;border:0;min-height:0}
@media (prefers-reduced-motion:reduce){.app.replie nav.side,.br.replie #brSide{transition:none}}
`;
  function injecterStyle() {
    if (document.getElementById('mrCss')) return;
    const s = document.createElement('style'); s.id = 'mrCss'; s.textContent = css; document.head.append(s);
  }

  // ---------------- Branchement
  const lire = (cle) => { try { return localStorage.getItem(cle); } catch { return null; } };
  const ecrire = (cle, v) => { try { localStorage.setItem(cle, v); } catch { /* réglage non gardé, le menu marche quand même */ } };
  const ICONE_PUNAISE = '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 15v5"/>';
  const vise = (el, sel) => { try { return Boolean(el?.matches?.(sel)); } catch { return false; } };

  function brancher(conteneur, o = {}) {
    const panneau = o.panneau, cle = o.cle || 'odin.menu.epingle', libelle = o.libelle || 'Garder le menu ouvert';
    const largeur = Number(o.largeur) || 64;
    const actif = typeof o.actif === 'function' ? o.actif : () => (typeof matchMedia === 'function' ? matchMedia('(min-width: 861px)').matches : true);
    if (!conteneur || !panneau) return null;
    injecterStyle();
    const sujet = /panneau/i.test(libelle) ? 'Le panneau' : 'Le menu';
    let etat = depart(lire(cle)), minuteur = 0, avaler = false, avalerT = 0, dernierPointeur = 'mouse';
    conteneur.style.setProperty('--mr-l', `${largeur}px`);

    const dit = document.createElement('span'); dit.className = 'mr-dit'; dit.setAttribute('aria-live', 'polite');
    const pinb = document.createElement('button'); pinb.type = 'button'; pinb.className = 'pinb';
    pinb.setAttribute('aria-label', libelle); pinb.title = libelle;
    pinb.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONE_PUNAISE}</svg>`;
    panneau.prepend(pinb); panneau.append(dit);

    const ouvert = () => etat === 'sideopen';
    function appliquer() {
      const on = actif();
      conteneur.classList.toggle('pinned', on && etat === 'pinned');
      conteneur.classList.toggle('replie', on && etat !== 'pinned');
      conteneur.classList.toggle('sideopen', on && etat === 'sideopen');
      pinb.setAttribute('aria-pressed', String(etat === 'pinned'));
      // Déplié (épinglé ou ouvert par-dessus) ou replié en colonne d'icônes ; sur téléphone, rien n'est dit.
      if (on) panneau.setAttribute('aria-expanded', String(etat !== 'replie')); else panneau.removeAttribute('aria-expanded');
    }
    function changer(evt) {
      const avant = etat; etat = suivant(etat, evt);
      if (etat === avant) return;
      appliquer();
      document.dispatchEvent(new CustomEvent('odin:menu', { detail: { cle, epingle: etat === 'pinned', ouvert: etat !== 'replie' } }));
    }
    const ouvrir = () => { clearTimeout(minuteur); if (actif()) changer('entree'); };
    function fermer(ms = FERMER_MS, evt = 'sortie') {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => {
        // La souris est encore dessus, ou le focus clavier y est resté : on attend la prochaine sortie.
        if (evt === 'sortie' && panneau.querySelector(':focus-visible')) return;
        if ((evt === 'sortie' || evt === 'flou') && vise(panneau, ':hover')) return;
        changer(evt);
      }, ms);
    }
    function epingler(v) {
      const voulu = Boolean(v);
      if ((etat === 'pinned') === voulu) return;
      changer('epingler');
      if (!voulu) changer(vise(panneau, ':hover') || panneau.contains(document.activeElement) ? 'entree' : 'sortie');
      ecrire(cle, voulu ? '1' : '0');
      dit.textContent = voulu ? `${sujet} reste ouvert.` : `${sujet} se replie seul ; passe la souris à gauche pour le voir.`;
    }

    const surEntree = () => ouvrir();
    const surSortie = (e) => { if (e.pointerType && e.pointerType !== 'mouse') return; fermer(FERMER_MS); };
    const surFocus = (e) => {
      // Le clic de souris donne aussi le focus : seul le focus clavier (ou un appui déjà traité) déplie le menu.
      if (vise(e.target, ':focus-visible')) ouvrir();
    };
    const surFlou = (e) => { if (!panneau.contains(e.relatedTarget)) fermer(0, 'flou'); };
    const surAppui = (e) => {
      dernierPointeur = e.pointerType || 'mouse';
      if (!actif() || etat !== 'replie' || dernierPointeur === 'mouse') return;
      // Premier appui du doigt sur le menu replié : on le déplie, sans ouvrir l'onglet touché.
      avaler = true; clearTimeout(avalerT); avalerT = setTimeout(() => { avaler = false; }, 900);
      ouvrir();
    };
    const surClic = (e) => {
      if (avaler) { avaler = false; e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.target.closest?.('.pinb')) { epingler(etat !== 'pinned'); return; }
      // Au doigt, un onglet choisi replie le menu (il n'y a pas de survol pour le faire).
      if (ouvert() && dernierPointeur !== 'mouse' && e.target.closest?.('.tab')) fermer(250, 'dehors');
    };
    const surDehors = (e) => { if (ouvert() && !panneau.contains(e.target)) { clearTimeout(minuteur); changer('dehors'); } };
    const surTouche = (e) => {
      if (e.key !== 'Escape' || !ouvert() || e.target.closest?.('.nav-ep-menu')) return;
      clearTimeout(minuteur); changer('echap');
    };
    let mq = null;
    const surTaille = () => { if (!actif() && etat === 'sideopen') etat = 'replie'; appliquer(); };
    panneau.addEventListener('pointerenter', surEntree);
    panneau.addEventListener('pointerleave', surSortie);
    panneau.addEventListener('focusin', surFocus);
    panneau.addEventListener('focusout', surFlou);
    panneau.addEventListener('pointerdown', surAppui, true);
    panneau.addEventListener('click', surClic, true);
    panneau.addEventListener('keydown', surTouche);
    document.addEventListener('pointerdown', surDehors);
    if (typeof matchMedia === 'function') { mq = matchMedia('(min-width: 861px)'); mq.addEventListener?.('change', surTaille); }
    window.addEventListener('resize', surTaille);
    appliquer();

    function detacher() {
      clearTimeout(minuteur); clearTimeout(avalerT);
      panneau.removeEventListener('pointerenter', surEntree);
      panneau.removeEventListener('pointerleave', surSortie);
      panneau.removeEventListener('focusin', surFocus);
      panneau.removeEventListener('focusout', surFlou);
      panneau.removeEventListener('pointerdown', surAppui, true);
      panneau.removeEventListener('click', surClic, true);
      panneau.removeEventListener('keydown', surTouche);
      document.removeEventListener('pointerdown', surDehors);
      mq?.removeEventListener?.('change', surTaille);
      window.removeEventListener('resize', surTaille);
      conteneur.classList.remove('replie', 'pinned', 'sideopen');
      panneau.removeAttribute('aria-expanded');
      pinb.remove(); dit.remove();
    }
    return { ouvrir, fermer: (ms = FERMER_MS) => fermer(ms), epingler, epingle: () => etat === 'pinned', detacher };
  }

  window.OdinMenu = { brancher, logique: { depart, suivant, FERMER_MS } };

  // Le menu d'Odin se branche tout seul, une fois la page prête.
  if (typeof document !== 'undefined' && document.addEventListener) {
    const auto = () => {
      const app = document.getElementById('app'), nav = document.getElementById('sideNav');
      if (app && nav && !nav.querySelector(':scope>.pinb')) window.OdinMenu.menu = brancher(app, { panneau: nav, cle: 'odin.menu.epingle', libelle: 'Garder le menu ouvert', largeur: 64 });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto, { once: true }); else auto();
  }
})();
