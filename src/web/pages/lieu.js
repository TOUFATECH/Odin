// Réglages → Maison : « Lieu et région ». Odin se règle d'après l'endroit où il est installé (météo, heure locale,
// unités, devise, fêtes). Ici on lui donne son lieu (nom du village ou de la ville, ou position de cet appareil), on lui
// demande de se configurer tout seul, ou on règle à la main ce qui découle du lieu. Tout passe par les actions de
// Hestia (lieu, lieu_position, se_configurer, region, region_actuelle) : les mêmes qu'à la voix ou dans la discussion.
(() => {
  'use strict';
  if (window.OdinLieu) return;
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const act = async (action, input = {}) => {
    try {
      const r = await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'gladsheim', action, input }) });
      return await r.json().catch(() => ({ ok: false, text: `erreur ${r.status}` }));
    } catch { return { ok: false, text: 'Odin ne répond pas.' }; }
  };
  const sansPrefixe = (t) => String(t ?? '').replace(/^[^:]+ · [^:]+ : /, '');

  let card = null, etat = null, statut = null;
  const dire = (texte, ok) => { if (statut) { statut.textContent = texte; statut.className = 'status' + (ok === true ? ' ok' : ok === false ? ' err' : ''); } };
  async function faire(action, input, attente = 'Un instant…') {
    dire(attente);
    const r = await act(action, input);
    dire(r.ok === false ? `✗ ${sansPrefixe(r.text || r.error || 'refusé')}` : String(r.text || 'Fait.').split('\n')[0], r.ok !== false);
    if (r.ok !== false) { await lire(); window.OdinThemes?.sync?.(); }
    return r;
  }
  async function lire() {
    const r = await act('region_actuelle');
    if (!etat) return;
    etat.textContent = r.ok === false ? 'Le lieu d\'Odin n\'est pas disponible pour l\'instant.' : String(r.text || '').replace(/^📍\s*/, '');
    const d = r.data || {}, g = d.region || {};
    const set = (id, v) => { const n = card?.querySelector(`#${id}`); if (n && document.activeElement !== n) n.value = v; };
    set('li-ville', d.suppose ? '' : (d.ville || ''));
    set('li-pays', g.pays || ''); set('li-tz', d.fuseau || '');
    const manuel = g.manuel || [];
    set('li-unites', manuel.includes('unités') ? (g.unites === 'imperial' ? 'impériales (°F, miles)' : 'métriques (°C, km)') : 'automatique');
    set('li-heure', manuel.includes('heure') ? (g.heure === '12h' ? '12 heures' : '24 heures') : 'automatique');
    set('li-devise', manuel.includes('devise') ? g.devise : '');
    const dev = card?.querySelector('#li-devise'); if (dev) dev.placeholder = `automatique (${g.devise || 'EUR'})`;
  }
  function ici() {
    if (!navigator.geolocation) return dire('✗ Cet appareil ne donne pas sa position : écris le nom du village.', false);
    dire('Je cherche la position de cet appareil…');
    navigator.geolocation.getCurrentPosition(
      (p) => faire('lieu_position', { lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy }),
      (e) => dire(e.code === 1 ? '✗ Tu as refusé de donner la position : écris le nom du village.' : '✗ Position introuvable pour l\'instant : écris le nom du village.', false),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }
  async function toutSeul() {
    const seul = window.OdinNaturel ? window.OdinNaturel.accord('tout seul', 'toute seule') : 'tout seul';
    const question = 'Pour me localiser ' + seul + ', je demande à un service en ligne où sort ma connexion Internet : il voit l\'adresse publique de cette machine. C\'est utile pour un serveur loué ; à la maison, c\'est approximatif. Continuer ?';
    const oui = window.OdinDialog ? await window.OdinDialog.confirm(question, { titre: 'Me configurer ' + seul, ok: 'Continuer' }) : true;
    if (oui) await faire('se_configurer', {}, 'Je cherche où je suis…');
  }
  function dessiner() {
    const champ = (id, label, attrs = {}) => el('div', { class: 'field' }, el('label', { for: id }, label), el('input', { id, autocomplete: 'off', spellcheck: 'false', ...attrs }));
    const choix = (id, label, options) => el('div', { class: 'field' }, el('label', { for: id }, label), el('select', { id }, ...options.map((o) => el('option', { value: o }, o))));
    etat = el('p', { class: 'sub', style: 'margin:0', id: 'li-etat', role: 'status' }, 'Lecture…');
    statut = el('div', { class: 'status', id: 'li-status', role: 'status' });
    const lieu = el('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); const v = card.querySelector('#li-ville').value.trim(); if (v) faire('se_configurer', { ou: v }); else dire('✗ Écris le nom du village ou de la ville.', false); } },
      el('h2', {}, 'Lieu et région'),
      el('p', { class: 'sub', style: 'margin:0' }, 'Odin se règle d\'après l\'endroit où il est installé : météo, heure locale, unités, devise et fêtes de l\'année. Donne-lui son village ou sa ville, la position de cet appareil, ou laisse-le chercher.'),
      etat,
      champ('li-ville', 'Village ou ville', { type: 'text', maxlength: '80', placeholder: 'ex. Dembéni — ou « Paris, France », ou une position « -12.84, 45.18 »' }),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        el('button', { class: 'btn primary', type: 'submit' }, 'Régler Odin pour ce lieu'),
        el('button', { class: 'btn', type: 'button', onclick: ici, title: 'La position est envoyée une fois à OpenStreetMap pour trouver le nom du village' }, '📍 Me localiser (cet appareil)'),
        el('button', { class: 'btn', type: 'button', onclick: toutSeul }, 'Se configurer tout seul')),
      el('span', { class: 'hint' }, 'Le GPS d\'un téléphone est précis. Un ordinateur donne souvent une position approximative : Odin le dit, et tu peux alors écrire le nom du village.'),
      statut);
    const main = el('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); const v = (id) => card.querySelector(`#${id}`).value.trim(); faire('region', { pays: v('li-pays'), fuseau: v('li-tz'), unites: v('li-unites'), heure: v('li-heure'), devise: v('li-devise') || 'auto' }); } },
      champ('li-pays', 'Pays (2 lettres)', { type: 'text', maxlength: '2', placeholder: 'FR, YT, US…', style: 'max-width:140px' }),
      champ('li-tz', 'Fuseau horaire', { type: 'text', maxlength: '40', placeholder: 'ex. Europe/Paris, Indian/Mayotte, America/New_York' }),
      choix('li-unites', 'Unités', ['automatique', 'métriques (°C, km)', 'impériales (°F, miles)']),
      choix('li-heure', 'Heure', ['automatique', '24 heures', '12 heures']),
      champ('li-devise', 'Devise (3 lettres)', { type: 'text', maxlength: '3', style: 'max-width:140px' }),
      el('div', {}, el('button', { class: 'btn', type: 'submit' }, 'Enregistrer ces réglages')));
    card.replaceChildren(lieu, el('details', {}, el('summary', { style: 'cursor:pointer;min-height:44px;display:flex;align-items:center;padding:0 16px' }, 'Régler à la main (pays, fuseau, unités, heure, devise)'), main));
  }
  function monter() {
    if (card || !document.querySelector('article.card[data-sec="maison"]')) return;
    card = el('article', { class: 'card', 'data-sec': 'maison', id: 'lieuCard' });
    const ancre = document.querySelector('article.card[data-sec="maison"]');
    card.hidden = ancre.hidden; // même rubrique des Réglages que la carte « Maison » : montrée et cachée avec elle
    ancre.before(card);
    dessiner(); void lire();
  }
  window.OdinLieu = { lire };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', monter); else monter();
})();
