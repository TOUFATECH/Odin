/*
 * Bloqueur de Pégase : la règle de décision, sans dépendance (écrite pour Pégase, aucune liste ni code repris).
 * Les règles sont des données (filtres.json) :
 *   domaines   : un domaine bloqué l'est avec tous ses sous-domaines (« doubleclick.net » bloque « ad.doubleclick.net ») ;
 *   chemins    : morceaux d'adresse bloqués ;
 *   (les deux listes ne visent que les requêtes « tierces » : venues d'un autre site que la page)
 *   exceptions : domaines jamais bloqués (ils gagnent sur les deux listes).
 * La page elle-même (le document principal) n'est jamais bloquée ici : Sphinx (le DNS d'Odin) s'en charge.
 * Ce fichier tourne dans l'extension (GeckoView) et dans Node pour les essais (module.exports).
 */
(function (racine) {
  'use strict';

  function hote(url) {
    if (!url) return '';
    var m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@\/?#]*@)?(\[[^\]]*\]|[^:\/?#]*)/i.exec(url);
    return m ? m[1].toLowerCase().replace(/\.$/, '') : '';
  }

  /** Le domaine « enregistrable » approché : les deux derniers morceaux (trois pour co.uk, com.yt…). */
  var DOUBLES = { 'co.uk': 1, 'com.au': 1, 'co.jp': 1, 'com.br': 1, 'co.za': 1, 'com.yt': 1, 'gouv.fr': 1, 'co.nz': 1 };
  function racineDe(h) {
    if (!h || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.charAt(0) === '[') return h;
    var p = h.split('.');
    if (p.length <= 2) return h;
    var deux = p.slice(-2).join('.');
    return DOUBLES[deux] ? p.slice(-3).join('.') : deux;
  }

  function dansListe(h, ensemble) {
    while (h) {
      if (ensemble[h]) return true;
      var i = h.indexOf('.');
      if (i < 0) return false;
      h = h.slice(i + 1);
    }
    return false;
  }

  function preparer(regles) {
    var r = { domaines: Object.create(null), chemins: [], exceptions: Object.create(null), version: regles.version || 0 };
    (regles.domaines || []).forEach(function (d) { if (d) r.domaines[String(d).toLowerCase()] = 1; });
    (regles.exceptions || []).forEach(function (d) { if (d) r.exceptions[String(d).toLowerCase()] = 1; });
    r.chemins = (regles.chemins || []).map(function (c) { return String(c).toLowerCase(); }).filter(Boolean);
    r.n = Object.keys(r.domaines).length + r.chemins.length;
    return r;
  }

  /** Faut-il bloquer cette requête ? (type : main_frame, sub_frame, script, image, xmlhttprequest…) */
  function bloquer(r, url, pageUrl, type) {
    if (!r || type === 'main_frame') return false;
    var h = hote(url);
    if (!h || !/^https?:/i.test(url)) return false;
    if (dansListe(h, r.exceptions)) return false;
    var hp = hote(pageUrl);
    // Sur le site lui-même (tu visites criteo.com), ses propres morceaux passent : on ne bloque que les tiers.
    var tiers = !hp || racineDe(hp) !== racineDe(h);
    if (!tiers) return false;
    if (dansListe(h, r.domaines)) return true;
    var u = url.toLowerCase();
    for (var i = 0; i < r.chemins.length; i++) if (u.indexOf(r.chemins[i]) >= 0) return true;
    return false;
  }

  var api = { hote: hote, racineDe: racineDe, preparer: preparer, bloquer: bloquer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else racine.Filtres = api;
})(typeof self !== 'undefined' ? self : this);
