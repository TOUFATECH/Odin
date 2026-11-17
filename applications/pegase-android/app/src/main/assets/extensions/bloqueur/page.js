/*
 * Dans chaque page : relaie à Pégase le nombre de pubs bloquées, montre seulement la vidéo quand l'onglet
 * « te suit » en petite fenêtre, et donne le texte visible de la page quand tu demandes à Odin.
 * Le texte de la page part comme une donnée : Odin ne suit jamais une consigne écrite dans une page.
 */
'use strict';

(function () {
  if (window.top !== window) return;
  var pegase;
  try { pegase = browser.runtime.connectNative('pegase'); } catch (e) { return; }

  function envoyer(m) { try { pegase.postMessage(m); } catch (e) { /* Pégase fermé */ } }

  browser.runtime.onMessage.addListener(function (m) {
    if (m && m.type === 'bloques') envoyer({ type: 'bloques', n: m.n });
  });
  browser.runtime.sendMessage({ type: 'combien' }).then(function (r) {
    if (r && r.n) envoyer({ type: 'bloques', n: r.n });
  }).catch(function () {});

  var STYLE = 'pegase-video-seule';

  function laVideo() {
    var vs = Array.prototype.slice.call(document.querySelectorAll('video'));
    if (!vs.length) return null;
    var enLecture = vs.filter(function (v) { return !v.paused && !v.ended; });
    var l = enLecture.length ? enLecture : vs;
    l.sort(function (a, b) { return b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight; });
    return l[0];
  }

  function videoSeule(oui) {
    var ancien = document.getElementById(STYLE);
    if (ancien) ancien.remove();
    document.querySelectorAll('[data-pegase-video]').forEach(function (v) { v.removeAttribute('data-pegase-video'); });
    if (!oui) return;
    var v = laVideo();
    if (!v) return;
    v.setAttribute('data-pegase-video', '1');
    var s = document.createElement('style');
    s.id = STYLE;
    s.textContent = 'html,body{overflow:hidden!important;background:#000!important}' +
      '[data-pegase-video]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;' +
      'max-width:none!important;max-height:none!important;z-index:2147483647!important;object-fit:contain!important;background:#000!important;margin:0!important}';
    (document.head || document.documentElement).appendChild(s);
  }

  pegase.onMessage.addListener(function (m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'video-seule') videoSeule(!!m.actif);
    if (m.type === 'extrait') {
      var t = (document.body && document.body.innerText) || '';
      envoyer({ type: 'extrait', id: m.id, url: location.href, titre: document.title, texte: t.slice(0, 20000) });
    }
  });
})();
