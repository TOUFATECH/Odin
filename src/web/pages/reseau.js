// L'état d'Internet, partagé par toute l'interface. Odin sait s'il a Internet (champ state.internet, poussé par le serveur
// dans ce que la page reçoit déjà) ; cette page le relit et le donne aux autres : OdinReseau.etat() / .enLigne() / .ecouter(cb).
// Elle monte aussi LE bandeau global discret quand Internet est coupé (« Pas d'Internet depuis 14 h 02 : Odin continue en
// local… »), une seule alerte, refermée toute seule au retour, sans cacher le contenu ni gêner la mascotte.
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
  let styleFaite = false;
  const STYLE = `
#odin-bandeau-reseau{position:fixed;left:50%;top:max(10px,env(safe-area-inset-top));transform:translateX(-50%);z-index:60;max-width:calc(100vw - 24px);display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:999px;border:1px solid var(--warn-l,#5A4520);background:var(--warn-bg,#1F1D16);color:var(--ink,#E6ECEF);font:13px/1.35 var(--body,system-ui),sans-serif;box-shadow:var(--shadow,0 8px 24px rgba(0,0,0,.25));pointer-events:auto;animation:odin-bandeau-ar .25s ease}
#odin-bandeau-reseau .pt{width:8px;height:8px;border-radius:50%;background:var(--warn,#F0B860);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--warn,#F0B860) 30%,transparent)}
#odin-bandeau-reseau span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@keyframes odin-bandeau-ar{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translateX(-50%)}}
@media (max-width:520px){#odin-bandeau-reseau span{white-space:normal}}`;
  function poserStyle() {
    if (styleFaite) return; styleFaite = true;
    try { const s = document.createElement('style'); s.textContent = STYLE; document.head.append(s); } catch { /* pas de document */ }
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
    if (enLigne()) { if (existant) existant.remove(); return; }
    poserStyle();
    const txt = texteBandeau(courant);
    if (existant) { const s = existant.querySelector('span'); if (s) s.textContent = txt; return; }
    const b = document.createElement('div');
    b.id = 'odin-bandeau-reseau'; b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'polite');
    const pt = document.createElement('span'); pt.className = 'pt'; pt.setAttribute('aria-hidden', 'true');
    const sp = document.createElement('span'); sp.textContent = txt;
    b.append(pt, sp); document.body.append(b);
  }

  window.OdinReseau = { etat, enLigne, ecouter, appliquer, texteBandeau };

  // On lit l'état à chaque /api/state (refresh() envoie 'odin:etat' avec tout le state).
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('odin:etat', (e) => { const st = e && e.detail; if (st && st.internet) appliquer(st.internet); });
  }
})();
