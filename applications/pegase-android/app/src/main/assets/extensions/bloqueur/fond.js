/*
 * Le fond de l'extension : bloque les requêtes, compte ce qui est bloqué par onglet,
 * et parle à Pégase par la messagerie native (nom « pegase »).
 */
'use strict';

var regles = null;
var compteurs = new Map(); // onglet → nombre de requêtes bloquées sur la page en cours
var pauses = new Set(); // sites où l'utilisateur a coupé le Bouclier
var actif = true;

fetch(browser.runtime.getURL('filtres.json'))
  .then(function (r) { return r.json(); })
  .then(function (j) { regles = Filtres.preparer(j); })
  .catch(function () { regles = Filtres.preparer({}); });

var pegase = browser.runtime.connectNative('pegase');
pegase.onMessage.addListener(function (m) {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'bouclier' && typeof m.hote === 'string') {
    if (m.actif) pauses.delete(m.hote); else pauses.add(m.hote);
  } else if (m.type === 'pauses' && Array.isArray(m.hotes)) {
    pauses = new Set(m.hotes.filter(function (h) { return typeof h === 'string'; }));
  } else if (m.type === 'actif') {
    actif = !!m.actif;
  } else if (m.type === 'regles' && m.regles && typeof m.regles === 'object') {
    // Règles mises à jour par Pégase : ce sont des données (listes de domaines), jamais du code.
    regles = Filtres.preparer(m.regles);
  }
});

function prevenir(tabId, n) {
  if (tabId < 0) return;
  browser.tabs.sendMessage(tabId, { type: 'bloques', n: n }).catch(function () {});
}

browser.webRequest.onBeforeRequest.addListener(function (d) {
  if (d.type === 'main_frame') {
    compteurs.set(d.tabId, 0);
    return {};
  }
  if (!actif || !regles) return {};
  var page = d.documentUrl || d.originUrl || '';
  if (pauses.has(Filtres.hote(page))) return {};
  if (Filtres.bloquer(regles, d.url, page, d.type)) {
    var n = (compteurs.get(d.tabId) || 0) + 1;
    compteurs.set(d.tabId, n);
    prevenir(d.tabId, n);
    return { cancel: true };
  }
  return {};
}, { urls: ['<all_urls>'] }, ['blocking']);

browser.tabs.onRemoved.addListener(function (id) { compteurs.delete(id); });

// Une page qui vient de se charger demande son compte (le message a pu partir avant elle).
browser.runtime.onMessage.addListener(function (m, envoyeur) {
  if (m && m.type === 'combien' && envoyeur.tab) {
    return Promise.resolve({ n: compteurs.get(envoyeur.tab.id) || 0 });
  }
  return undefined;
});
