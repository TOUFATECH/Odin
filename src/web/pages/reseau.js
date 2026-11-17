// L'état d'Internet, partagé par toute l'interface. Odin sait s'il a Internet (champ state.internet, poussé par le serveur
// dans ce que la page reçoit déjà) ; cette page le relit et le donne aux autres : OdinReseau.etat() / .enLigne() / .ecouter(cb).
// Elle monte aussi LE bandeau global discret quand Internet est coupé (« Pas d'Internet depuis 14 h 02 : Odin continue en
// local… »), une seule alerte, refermée toute seule au retour, en haut du contenu : elle pousse la page, ne la recouvre pas.
// Aucun deuxième flux : on écoute l'événement 'odin:etat' que refresh() envoie après chaque /api/state.
(() => {
  'use strict';
  if (window.OdinReseau) return;

  let courant = null;            // le dernier objet internet connu (null tant que rien n'est reçu)
  const abonnes = new Set();     // les rappels à prévenir quand ça change

  // Par prudence, tant qu'on ne sait rien, on se dit en ligne : pas de fausse alerte au démarrage.
  const enLigne = () => !courant || courant.reseau === 'en-ligne';
  const etat = () => courant;

  function ecouter(cb) {
    if (typeof cb !== 'function') return () => {};
    abonnes.add(cb);
    if (courant) { try { cb(courant); } catch { /* un abonné qui casse ne doit pas bloquer les autres */ } }
    return () => abonnes.delete(cb);
  }

  // Deux états se valent-ils ? (pour ne prévenir qu'au vrai changement, pas à chaque sonde).
  function pareil(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.reseau !== b.reseau || a.depuis !== b.depuis) return false;
    const sa = a.services || {}, sb = b.services || {}, ka = Object.keys(sa), kb = Object.keys(sb);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => sb[k] && sa[k].etat === sb[k].etat && sa[k].depuis === sb[k].depuis);
  }

  function appliquer(internet) {
    if (!internet || typeof internet !== 'object') return;
    if (pareil(courant, internet)) { courant = internet; return; }
    courant = internet;
    majBandeau();
    for (const cb of abonnes) { try { cb(courant); } catch { /* idem */ } }
  }

  // --------- le bandeau global ---------
  // Il ne flotte plus par-dessus la page : il prend sa place tout en haut de la zone de contenu (<main> de l'interface,
  // donc à droite de la barre de côté sur ordinateur et sous l'en-tête sur téléphone) et pousse la page vers le bas.
  // Pas de z-index : une confirmation, un menu ou le lecteur en plein écran restent toujours au-dessus de lui.
  let styleFaite = false;
  const STYLE = `
.odin-bandeau-reseau{flex:none;display:flex;align-items:center;gap:10px;padding:8px 16px;overflow:hidden;border-bottom:1px solid var(--warn-l,#5A4520);background:var(--warn-bg,#1F1D16);color:var(--ink,#E6ECEF);font:13px/1.4 var(--body,system-ui),sans-serif;animation:odin-bandeau-ar .25s ease;transition:max-height .25s ease,padding .25s ease,opacity .2s ease}
.odin-bandeau-reseau .pt{width:8px;height:8px;border-radius:50%;background:var(--warn,#F0B860);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--warn,#F0B860) 30%,transparent)}
.odin-bandeau-reseau span{min-width:0;overflow-wrap:anywhere}
.odin-bandeau-reseau.sort{padding-top:0;padding-bottom:0;opacity:0;border-bottom-width:0}
@keyframes odin-bandeau-ar{from{max-height:0;padding-top:0;padding-bottom:0;opacity:0}to{max-height:160px;opacity:1}}
@media (prefers-reduced-motion:reduce){.odin-bandeau-reseau{animation:none;transition:none}}`;
  function poserStyle() {
    if (styleFaite) return; styleFaite = true;
    try { const s = document.createElement('style'); s.textContent = STYLE; document.head.append(s); } catch { /* pas de document */ }
  }

  // Sa place : le haut du contenu de l'interface ; à défaut (une page sans <main>), le haut de la page.
  function place() {
    try { if (typeof document.querySelector === 'function') return document.querySelector('#app > main') || document.querySelector('main') || document.body; } catch { /* sélecteur indisponible */ }
    return document.body;
  }

  // Au retour d'Internet : le bandeau n'est plus annoncé tout de suite, se replie en douceur (la page remonte sans saut)
  // puis s'en va. Sans animation possible (mouvement réduit, pas de hauteur connue), il s'en va aussitôt.
  function retirer(b) {
    b.id = 'odin-bandeau-reseau-sortant';
    try { b.removeAttribute('role'); b.removeAttribute('aria-live'); } catch { /* idem */ }
    b.setAttribute('aria-hidden', 'true');
    let reduit = false;
    try { reduit = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { /* idem */ }
    const h = b.offsetHeight;
    if (reduit || !h || typeof requestAnimationFrame !== 'function' || typeof setTimeout !== 'function') { b.remove(); return; }
    b.style.maxHeight = `${h}px`;
    requestAnimationFrame(() => { b.classList.add('sort'); b.style.maxHeight = '0px'; });
    setTimeout(() => b.remove(), 320);
  }

  function heure(ms) {
    if (typeof ms !== 'number') return '';
    const d = new Date(ms); if (Number.isNaN(d.getTime())) return '';
    return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // Le texte du bandeau selon l'état (jamais affiché quand on est en ligne).
  function texteBandeau(net) {
    const q = heure(net.depuis), d = q ? ` depuis ${q}` : '';
    if (net.reseau === 'sans-reseau') return `Pas de réseau${d} : Odin continue en local ; météo, recherche et téléchargements reprendront au retour.`;
    if (net.reseau === 'dns-muet') return `Les noms de sites ne se résolvent plus (DNS)${d} : Odin continue en local ; ça reprendra au retour.`;
    return `Pas d'Internet${d} : Odin continue en local ; météo, recherche et téléchargements reprendront au retour.`;
  }

  function majBandeau() {
    if (typeof document === 'undefined' || !document.body) return;
    const existant = document.getElementById('odin-bandeau-reseau');
    if (enLigne()) { if (existant) retirer(existant); return; }
    poserStyle();
    const txt = texteBandeau(courant);
    if (existant) { const s = existant.querySelector('span:not(.pt)'); if (s) s.textContent = txt; return; }
    const sortant = document.getElementById('odin-bandeau-reseau-sortant'); if (sortant) sortant.remove();
    const b = document.createElement('div');
    b.id = 'odin-bandeau-reseau'; b.className = 'odin-bandeau-reseau'; b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'polite');
    const pt = document.createElement('span'); pt.className = 'pt'; pt.setAttribute('aria-hidden', 'true');
    const sp = document.createElement('span'); sp.textContent = txt;
    b.append(pt, sp); place().prepend(b);
  }

  window.OdinReseau = { etat, enLigne, ecouter, appliquer, texteBandeau };

  // On lit l'état à chaque /api/state (refresh() envoie 'odin:etat' avec tout le state).
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('odin:etat', (e) => { const st = e && e.detail; if (st && st.internet) appliquer(st.internet); });
  }
})();
