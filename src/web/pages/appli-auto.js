// L'onglet commun « Auto » de la page d'une appli : ce que l'appli fait toute seule (ses automatismes), les
// automatisations de Talos où elle déclenche ou agit, ses rappels et rendez-vous, et « Créer une automatisation
// avec <appli> ». Il est ajouté par le cadre de la page (valhalla.js), après les onglets de l'appli, quand Talos dit
// qu'il y a quelque chose à montrer (GET /api/draupnir/appli). Une page sans onglets reçoit « Page » et « Auto ».
// Ce fichier est chargé avant les autres scripts de l'interface : rien ne touche au document à son chargement.
// API : OdinOngletAuto.ONGLET, .charger(id), .panneau(id, data, { recharger }), .decorer(bouton, nom), .logique.
(() => {
  'use strict';
  if (window.OdinOngletAuto) return;

  /** Le nom de l'onglet : un mot court, réservé (aucune appli ne peut l'utiliser pour ses propres onglets). */
  const ONGLET = 'Auto';
  const PAGE = 'Page';

  // ---------------- Logique pure (sans document)
  /** Les onglets de la page, avec « Auto » à la fin quand il y a quelque chose à montrer. */
  function ongletsAvecAuto(onglets, montrer) {
    if (!montrer) return onglets;
    const propres = (onglets ?? []).filter((o) => o !== ONGLET && o !== PAGE);
    return propres.length ? [...new Set(propres), ONGLET] : [PAGE, ONGLET];
  }

  // ---------------- Dessin
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };

  /** Ce que Talos sait de cette appli ; null sur toute erreur (membre de la maison : 403, donc pas d'onglet). */
  async function charger(id) {
    try {
      const r = await fetch(`/api/draupnir/appli?${new URLSearchParams({ id })}`, { headers: { 'x-odin': '1' } });
      if (!r.ok) return null;
      const j = await r.json();
      if (!j?.ok || !j.montrer) return null;
      await window.OdinAutomatismes?.noms?.();   // les noms affichés des applis, pour les lignes
      return j;
    } catch { return null; }
  }

  /** Une petite icône (deux nœuds reliés) et le nom complet pour les lecteurs d'écran : « Automatisations de <Nom> ». */
  function decorer(bouton, nom) {
    if (!bouton) return bouton;
    bouton.setAttribute('aria-label', `Automatisations de ${nom}`);
    bouton.title = `Automatisations de ${nom}`;
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'aria-hidden': 'true', style: 'vertical-align:-3px;margin-right:6px' })) s.setAttribute(k, v);
    s.innerHTML = '<rect x="3" y="4" width="6" height="5" rx="1.5"/><rect x="15" y="15" width="6" height="5" rx="1.5"/><path d="M9 6.5c3 0 3 11 6 11"/>';
    bouton.prepend(s);
    return bouton;
  }

  /** Le contenu de l'onglet « Auto ». */
  function panneau(id, data, opts = {}) {
    const nom = data?.appli?.nom ?? '', lignes = data?.lignes ?? [];
    const A = window.OdinAutomatismes;
    const bloc = (titre, ls, aide) => (ls.length ? el('section', { class: 'va-sec va-large' }, el('h2', {}, titre), aide ? el('p', { class: 'va-aide', style: 'margin:0 0 8px' }, aide) : null, A ? A.liste(ls, { recharger: opts.recharger }) : el('ul', { class: 'va-list' }, ...ls.map((l) => el('li', {}, el('b', {}, l.nom), el('small', {}, l.phrase))))) : null);
    const seul = lignes.filter((l) => l.sorte === 'veille' || l.sorte === 'tache');
    const flows = lignes.filter((l) => l.sorte === 'automatisation');
    const rappels = lignes.filter((l) => l.sorte === 'rappel' || l.sorte === 'rendez_vous' || l.sorte === 'tache_odin');
    const liables = (data?.actions ?? []).filter((a) => !a.grave);
    const creer = el('section', { class: 'va-sec va-large' }, el('h2', {}, `Relier ${nom} à d'autres applis`),
      el('p', { class: 'va-aide', style: 'margin:0 0 10px' }, liables.length ? `${liables.length} fonction${liables.length > 1 ? 's' : ''} de ${nom} peu${liables.length > 1 ? 'vent' : 't'} servir dans une automatisation : ${liables.slice(0, 6).map((a) => a.label).join(', ')}${liables.length > 6 ? '…' : '.'}` : `${nom} peut lancer une automatisation quand elle signale quelque chose.`),
      el('div', { class: 'va-acts-bar', style: 'margin:0' },
        window.OdinLien ? el('button', { class: 'btn primary', type: 'button', onclick: () => window.OdinLien.ouvrir({ appli: id }) }, `Créer une automatisation avec ${nom}`) : null,
        el('button', { class: 'btn', type: 'button', onclick: () => window.OdinShow?.('flows') }, 'Voir toutes les automatisations')));
    const parts = [
      bloc(`Ce que ${nom} fait tout seul`, seul),
      bloc(`Automatisations avec ${nom}`, flows),
      bloc('Rappels et rendez-vous', rappels),
      creer,
    ].filter(Boolean);
    if (!seul.length && !flows.length && !rappels.length) parts.unshift(el('p', { class: 'va-aide va-large' }, `Rien ne tourne tout seul avec ${nom} pour l'instant.`));
    return el('div', { class: 'va-cells va-large' }, ...parts);
  }

  window.OdinOngletAuto = { ONGLET, PAGE, charger, panneau, decorer, logique: { ongletsAvecAuto, ONGLET, PAGE } };
})();
