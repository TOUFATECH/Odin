// Les écrans d'Odin dans le menu : l'entrée « Home Assistant » (#navMaison, ui.html), un lien vers l'écran de la maison
// (/maison), pas une vue. Elle est cachée au départ et ne se montre qu'au propriétaire, quand la liste des applis compte
// Hestia (gladsheim). Un membre de la famille ne la voit jamais, même s'il a le droit sur Hestia : la page le sait par
// l'état (/api/state porte alors « membre »), et la liste des applis n'est alors pas demandée.
// L'état arrive par l'événement « odin:etat » que refresh() envoie après chaque /api/state (comme pages/reseau.js).
// Ce fichier ne touche à rien à son chargement, sauf écouter cet événement. Aucun texte ici : le libellé est dans ui.html.
// API : OdinMenuEcrans.logique.montrer(etat, applis) (pure).
(() => {
  'use strict';
  if (window.OdinMenuEcrans) return;

  // ---------------- Logique pure (sans document)
  /** L'identifiant d'une appli de la liste : une chaîne, ou { id } (le catalogue). */
  const idDe = (m) => (typeof m === 'string' ? m : m && typeof m === 'object' ? m.id : undefined);
  /** Montrer l'entrée ? Le propriétaire seul (aucun « membre » dans l'état), et seulement si la liste des applis contient gladsheim. */
  function montrer(etat, applis) {
    if (!etat || typeof etat !== 'object' || etat.membre) return false;
    return Array.isArray(applis) && applis.some((m) => idDe(m) === 'gladsheim');
  }

  // ---------------- Branchement
  let applis = null, demande = null, dernier = null, vu = false, reessai = 0;
  const ATTENTE = 30_000; // une lecture ratée n'est retentée qu'après 30 s (comme pages/rendu.js), pas à chaque état
  function peindre() {
    const lien = document.getElementById('navMaison');
    if (lien) lien.hidden = !montrer(dernier, applis);
  }
  /** La liste des applis, lue une fois (une lecture ratée sera retentée au premier état reçu 30 s plus tard). */
  function lireApplis() {
    if (applis || demande || Date.now() < reessai) return demande;
    demande = fetch('/api/valhalla/catalog', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.ok && Array.isArray(j.modules)) applis = j.modules.map(idDe).filter(Boolean); })
      .catch(() => { /* liste illisible : l'entrée reste cachée */ })
      .finally(() => { demande = null; if (!applis) reessai = Date.now() + ATTENTE; });
    return demande;
  }
  async function surEtat(etat) {
    vu = true;
    dernier = etat && typeof etat === 'object' ? etat : null;
    if (!montrer(dernier, ['gladsheim'])) return peindre(); // un membre, ou pas d'état : rien à demander
    if (!applis) await lireApplis();
    peindre();
  }
  window.addEventListener('odin:etat', (e) => surEtat(e && e.detail));
  // Le premier état a pu partir avant le chargement de ce fichier : une fois la page chargée, sans état reçu, on demande
  // qui regarde à /api/account/me (« membre » pour un membre ; sans session : refus, l'entrée reste cachée).
  window.addEventListener('load', () => {
    if (vu) return;
    fetch('/api/account/me', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!vu && j && j.ok) surEtat({ membre: j.membre }); }).catch(() => { /* hors ligne : rien */ });
  });

  window.OdinMenuEcrans = { logique: { montrer } };
})();
