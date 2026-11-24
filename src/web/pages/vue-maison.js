// La vue « Home Assistant » d'Odin (#v-maison, ui.html) : l'écran de la maison affiché DANS Odin, comme les autres vues.
// Le menu d'Odin reste à côté (ordinateur) et la barre du bas aussi (téléphone). L'adresse devient /#maison sans recharger
// la page (comme /#net ou /#chat) ; retour et avance du navigateur passent d'une vue à l'autre.
// L'écran est celui de /maison (mêmes sections, thèmes, modules, droits), posé dans un cadre de la même adresse : il garde
// sa fenêtre à lui (ses couleurs, sa mascotte, ses minuteurs) sans rien mélanger avec la page d'Odin. En quittant la vue,
// le cadre est retiré : tout ce qu'il faisait tourner s'arrête avec lui. /maison reste la page des tablettes murales.
// Droits : le cadre n'est posé que si l'entrée du menu est visible (le propriétaire, Hestia installée : pages/menu-ecrans.js).
// Un membre ne la voit pas, et le serveur lui refuse de toute façon l'écran de la maison.
// Ce fichier ne touche à rien à son chargement, sauf écouter la page. API : OdinVueMaison.logique (pure).
(() => {
  'use strict';
  if (window.OdinVueMaison) return;

  const MOTS = { titre: 'Home Assistant', attente: 'L\'écran de la maison s\'ouvre ici pour le propriétaire, quand Hestia est installée.' };
  const ADRESSE = '/maison', ANCRE = '#maison', VUE = 'maison';

  // ---------------- Logique pure (sans document)
  const logique = {
    /** Poser le cadre ? Seulement quand la vue est ouverte et que l'entrée du menu est visible. */
    poser(vue, entreeVisible) { return vue === VUE && entreeVisible === true; },
    /**
     * Le navigateur a quitté #maison (retour, avance, adresse tapée) alors que la vue est encore affichée : la vue à rouvrir
     * (celle d'avant, sinon l'accueil). null s'il n'y a rien à faire.
     */
    apresAncre(ancre, vueAffichee, precedente) {
      if (!vueAffichee || ancre === ANCRE) return null;
      return precedente && precedente !== VUE ? precedente : 'home';
    },
    /** En quittant la vue par le menu, l'adresse perd « #maison » (un rechargement ne rouvre pas l'écran de la maison). */
    retirerAncre(vue, ancre) { return vue !== VUE && ancre === ANCRE; },
  };

  // ---------------- Branchement
  let cadre = null, ouverte = false, precedente = 'home';
  const section = () => document.getElementById('v-maison');
  const entreeVisible = () => { const e = document.getElementById('navMaison'); return Boolean(e) && !e.hidden; };
  function style() {
    if (document.getElementById('vmCss')) return;
    const s = document.createElement('style'); s.id = 'vmCss';
    s.textContent = '#v-maison .vm-cadre{flex:1;display:block;width:100%;min-height:0;border:0;background:var(--bg)}#v-maison .vm-attente{margin:0;padding:22px 28px;color:var(--muted)}'
      // L'écran de la maison a sa propre mascotte : celle de la page d'Odin s'efface pendant la vue (comme dans la Discussion).
      + 'body:has(#v-maison.on) #buddyRoam{visibility:hidden!important;pointer-events:none!important}';
    document.head.append(s);
  }
  function retirer() { if (cadre) { cadre.remove(); cadre = null; } }
  function peindre() {
    const s = section(); if (!s) return;
    if (!logique.poser(ouverte ? VUE : '', entreeVisible())) {
      retirer();
      if (ouverte && !s.querySelector('.vm-attente')) { const p = document.createElement('p'); p.className = 'vm-attente'; p.textContent = MOTS.attente; s.replaceChildren(p); }
      if (!ouverte) s.replaceChildren();
      return;
    }
    if (cadre) return; // déjà posé : jamais deux chargements
    style();
    cadre = document.createElement('iframe');
    cadre.className = 'vm-cadre'; cadre.title = MOTS.titre; cadre.src = ADRESSE;
    cadre.setAttribute('allow', 'microphone; geolocation'); cadre.setAttribute('referrerpolicy', 'no-referrer');
    s.replaceChildren(cadre);
  }
  document.addEventListener('odin:vue', (e) => {
    const vue = e && e.detail && e.detail.vue;
    ouverte = vue === VUE;
    if (!ouverte && vue) precedente = vue;
    if (logique.retirerAncre(vue, location.hash)) { try { history.replaceState(history.state, '', location.pathname + location.search); } catch { /* sans gravité */ } }
    peindre();
  });
  window.addEventListener('hashchange', () => {
    const s = section(), v = logique.apresAncre(location.hash, Boolean(s && s.classList.contains('on')), precedente);
    if (v && window.OdinShow) window.OdinShow(v);
  });
  // L'entrée du menu se montre ou se cache après coup (état reçu, liste des applis lue) : la vue suit.
  window.addEventListener('load', () => {
    const e = document.getElementById('navMaison');
    if (e && typeof MutationObserver === 'function') new MutationObserver(peindre).observe(e, { attributes: true, attributeFilter: ['hidden'] });
    // Page rechargée sur /#maison : Odin a pu ouvrir la vue AVANT que ce fichier soit chargé (dès que l'état arrive) ;
    // l'évènement « odin:vue » est alors déjà passé. La page dit elle-même si la vue est ouverte.
    const s = section();
    if (!ouverte && s && s.classList.contains('on')) ouverte = true;
    peindre(); // l'entrée a pu se montrer avant ce moment (page rechargée sur /#maison)
  });

  window.OdinVueMaison = { logique, ouverte: () => ouverte, cadre: () => cadre };
})();
