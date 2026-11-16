// Télécommande de Vénus par QR. Deux usages, sans jamais toucher au reste d'Odin :
//  - côté page de Vénus (propriétaire) : afficherQr() montre le QR d'un écran (SVG rendu par qr.ts), le nombre de
//    téléphones reliés, et les boutons Révoquer / Régénérer ; telecommande() pilote l'écran par /venus/ecran/<id>/commande ;
//  - côté invité : en scannant le QR, un téléphone ouvre /t/<jeton> (page servie par Odin) et pilote CET écran, et rien
//    d'autre, via la route courte /venus/commande/<jeton>. Ce fichier sait aussi se monter tout seul sur une page /t/
//    (repli), mais la page /t/ d'Odin est déjà complète.
//
// « Qui a le QR pilote cet écran » : c'est assumé et dit, pour laisser la main aux invités. Le jeton est limité dans le
// temps, révocable d'un bouton et régénérable (l'ancien QR ne vaut plus). Grand au doigt (iPhone + Android, 390 px).
(() => {
  'use strict';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const SVG = {
    play: 'M8 5v14l11-7z', pause: 'M7 5h4v14H7zM13 5h4v14h-4z', replay: 'M12 5V2L7 7l5 5V8a6 6 0 1 1-6 6H4a8 8 0 1 0 8-9z',
    back: 'M11 7l-6 5 6 5zM19 7l-6 5 6 5', fwd: 'M13 7l6 5-6 5zM5 7l6 5-6 5', prev: 'M7 6v12M18 6l-8 6 8 6', next: 'M17 6v12M6 6l8 6-8 6',
    list: 'M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01', chup: 'M12 5l7 7H5zM5 17h14', chdown: 'M12 19l-7-7h14zM5 7h14',
    volup: 'M4 9v6h4l5 5V4L8 9zM16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14', voldown: 'M4 9v6h4l5 5V4L8 9zM22 9l-6 6M16 9l6 6', power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
  };
  const ic = (n, s = 26) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${SVG[n] || ''}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };

  const CSS = `
.tc{--ac:var(--accent,#e2a93b);color:var(--ink,#eef0f6);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-user-select:none;user-select:none}
.tc *{box-sizing:border-box}
.tc-plein{position:fixed;inset:0;z-index:2147482500;display:flex;flex-direction:column;gap:14px;padding:18px;overflow:auto;background:radial-gradient(900px 600px at 50% -10%,var(--panel,#1b2030),transparent 60%),var(--bg,#06080d)}
.tc-wrap{width:100%;max-width:390px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.tc-tete{display:flex;align-items:center;gap:12px}
.tc-tete b{font-size:19px}.tc-tete small{color:var(--muted,#9aa1b2);display:block;font-size:12.5px}
.tc-now{border:1px solid var(--line,#ffffff14);border-radius:16px;padding:12px 14px;background:var(--panel2,#ffffff08);min-height:52px;display:flex;flex-direction:column;gap:4px}
.tc-now .t{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-now .s{color:var(--muted,#9aa1b2);font-size:13px}
.tc-grille{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.tc-b{min-height:66px;border-radius:16px;border:1px solid var(--line,#ffffff1a);background:linear-gradient(180deg,var(--panel,#1c2130),var(--panel2,#141821));color:inherit;font:600 14px inherit;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:8px;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.tc-b:active{border-color:var(--ac);background:color-mix(in srgb,var(--ac) 14%,transparent)}
.tc-b.lrg{grid-column:span 3;flex-direction:row;gap:10px}
.tc-b.ac{background:color-mix(in srgb,var(--ac) 14%,transparent);border-color:color-mix(in srgb,var(--ac) 40%,transparent);color:var(--ac)}
.tc-b.danger{border-color:color-mix(in srgb,var(--bad,#c0392b) 40%,transparent);color:var(--bad,#ff9b8d)}
.tc-b.danger:active{background:color-mix(in srgb,var(--bad,#c0392b) 22%,transparent)}
.tc-b span{font-size:12.5px}
.tc-flash{outline:2px solid var(--ac)}
.tc-note{color:var(--accent,#c9a24a);font-size:12.5px;text-align:center;line-height:1.4;padding:2px 4px}
.tc-hs{color:var(--bad,#ff9b8d);font-size:13px;text-align:center}
.tc-confirm{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(4,8,14,.6)}
.tc-confirm .box{width:min(360px,100%);background:var(--panel,#12151d);border:1px solid var(--line,#ffffff1a);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:14px;color:var(--ink,#eef0f6)}
.tc-confirm .box .l{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
.tc-confirm .box button{min-height:44px;min-width:110px;border-radius:12px;border:1px solid var(--line,#ffffff1a);background:var(--panel2,#ffffff0a);color:inherit;font:600 14px inherit;cursor:pointer;padding:0 16px}
.tc-confirm .box button.oui{background:var(--bad,#c0392b);border-color:var(--bad,#c0392b);color:#fff}
/* Côté propriétaire : le bloc QR dans la page de Vénus */
.tc-qr{border:1px solid var(--line,#ffffff14);border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--panel,#1b1e27)}
.tc-qr .code{width:200px;height:200px;align-self:center;background:#fff;border-radius:12px;padding:8px}
.tc-qr .code svg{width:100%;height:100%;display:block}
.tc-qr .lien{font:12.5px ui-monospace,monospace;color:var(--muted,#9aa1b2);word-break:break-all;text-align:center}
.tc-qr .l{display:flex;gap:8px;flex-wrap:wrap}
.tc-qr .l button{min-height:40px;border-radius:12px;border:1px solid var(--line,#ffffff1a);background:var(--panel2,#ffffff0a);color:inherit;font:600 13px inherit;cursor:pointer;padding:0 14px}
.tc-qr .phones{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:0 10px;border-radius:999px;background:var(--panel2,#ffffff0a);font:600 12.5px inherit;color:var(--muted,#cfd3dd)}
@media (pointer:coarse){.tc-qr .l button{min-height:44px}}`;

  // --- Logique pure (essayable sans navigateur) --------------------------------------------------
  const logique = {
    /** Le jeton dans l'adresse /t/<jeton> (pur) : seuls des caractères sûrs, rien d'autre. */
    jetonDeChemin(chemin) { const m = /^\/t\/([A-Za-z0-9_-]{8,128})\/?$/.exec(String(chemin || '')); return m ? m[1] : null; },
    /** La liste ordonnée des commandes de la télécommande. Chaque action reste dans la liste du contrat du serveur. */
    boutons() {
      return [
        { cle: 'reculer', label: '−10 s', icone: 'back', action: 'reculer', valeur: 10, groupe: 'transport' },
        { cle: 'lecture_pause', label: 'Lecture / Pause', icone: 'play', action: 'lecture', bascule: 'pause', groupe: 'transport' },
        { cle: 'avancer', label: '+10 s', icone: 'fwd', action: 'avancer', valeur: 10, groupe: 'transport' },
        { cle: 'precedent', label: 'Précédent', icone: 'prev', action: 'precedent', groupe: 'piste' },
        { cle: 'revoir', label: 'Revoir', icone: 'replay', action: 'reculer', valeur: 999999, groupe: 'piste' },
        { cle: 'suivant', label: 'Suivant', icone: 'next', action: 'suivant', groupe: 'piste' },
        { cle: 'chaine_moins', label: 'Chaîne −', icone: 'chdown', action: 'chaine', valeur: '-', groupe: 'chaine' },
        { cle: 'episode', label: 'Épisode…', icone: 'list', action: 'episode', demande: 'episode', groupe: 'chaine' },
        { cle: 'chaine_plus', label: 'Chaîne +', icone: 'chup', action: 'chaine', valeur: '+', groupe: 'chaine' },
        { cle: 'volume_moins', label: 'Volume −', icone: 'voldown', action: 'volume', valeur: '-', groupe: 'volume' },
        { cle: 'volume_plus', label: 'Volume +', icone: 'volup', action: 'volume', valeur: '+', groupe: 'volume' },
        { cle: 'couper', label: 'Couper', icone: 'power', action: 'couper', confirme: true, groupe: 'alim' },
      ];
    },
    /** Construit l'appel d'une commande (pur). Invité → route courte du jeton ; propriétaire → route de l'écran. */
    commande(cible, action, valeur) {
      const body = valeur === undefined ? { action } : { action, valeur };
      if (cible && cible.jeton) return { url: `/venus/commande/${encodeURIComponent(cible.jeton)}`, body };
      return { url: `/venus/ecran/${encodeURIComponent(String(cible && cible.ecranId))}/commande`, body };
    },
    qrUrl(ecranId, quoi) { return `/venus/ecran/${encodeURIComponent(String(ecranId))}/qr${quoi ? `/${quoi}` : ''}`; },
    /** Temps restant lisible à partir d'une échéance (ms epoch). */
    resteTexte(expire, maintenant) {
      const ms = Number(expire) - (maintenant == null ? Date.now() : Number(maintenant));
      if (!(ms > 0)) return 'expiré';
      const min = Math.round(ms / 60000);
      return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
    },
    mmss(s) { s = Math.max(0, Math.floor(Number(s) || 0)); const m = Math.floor(s / 60), x = s % 60; return `${m}:${String(x).padStart(2, '0')}`; },
  };

  /** Petite confirmation sans fenêtre native (la page /t/ n'a pas OdinDialog). */
  function confirmer(texte) {
    return new Promise((resolve) => {
      const fin = (v) => { fond.remove(); resolve(v); };
      const box = el('div', { class: 'box' }, el('p', { style: 'margin:0' }, texte),
        el('div', { class: 'l' }, el('button', { type: 'button', onclick: () => fin(false) }, 'Annuler'), el('button', { class: 'oui', type: 'button', onclick: () => fin(true) }, 'Couper')));
      const fond = el('div', { class: 'tc-confirm', role: 'alertdialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === fond) fin(false); } }, box);
      (document.body || document.documentElement).append(fond);
    });
  }
  const demanderConfirme = (texte) => (window.OdinDialog ? window.OdinDialog.confirm(texte, { titre: 'Couper l\'écran ?', ok: 'Couper', danger: true }) : confirmer(texte));

  /** Petite saisie d'un nombre, sans fenêtre native (page /t/ : pas d'OdinDialog). Rend le texte ou null. */
  function demanderNombre(texte) {
    return new Promise((resolve) => {
      const champ = el('input', { type: 'tel', inputmode: 'numeric', style: 'min-height:44px;border-radius:12px;border:1px solid #ffffff1a;background:#0b0d12;color:#eef0f6;padding:0 12px;font:inherit', 'aria-label': texte });
      const fin = (v) => { fond.remove(); resolve(v); };
      const box = el('div', { class: 'box' }, el('p', { style: 'margin:0' }, texte), champ,
        el('div', { class: 'l' }, el('button', { type: 'button', onclick: () => fin(null) }, 'Annuler'), el('button', { class: 'oui', style: 'background:#e2a93b;border-color:#e2a93b;color:#111', type: 'button', onclick: () => fin(champ.value) }, 'Aller')));
      const fond = el('div', { class: 'tc-confirm', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === fond) fin(null); } }, box);
      (document.body || document.documentElement).append(fond);
      try { champ.focus(); } catch { /* rien */ }
    });
  }
  const saisirNombre = (texte) => (window.OdinDialog ? window.OdinDialog.prompt(texte, '') : demanderNombre(texte));

  function styler() { if (!document.getElementById('tcCss')) document.head.append(el('style', { id: 'tcCss' }, CSS)); }

  /**
   * Monte la télécommande d'UN écran dans `host`.
   * cible = { jeton } (invité) ou { ecranId, nom } (propriétaire). Renvoie { arreter() }.
   * Le pilotage est continu : les boutons ne se bloquent jamais, on enchaîne les commandes.
   */
  function monter(host, cible, opts = {}) {
    styler();
    const wrap = el('div', { class: 'tc-wrap' });
    const racine = el('div', { class: `tc${opts.plein === false ? '' : ' tc-plein'}` }, opts.plein === false ? wrap : el('div', { style: 'margin:auto;width:100%' }, wrap));
    host.append(racine);
    let enLecture = true;
    const maj = el('div', { class: 'tc-now' }, el('div', { class: 't' }, cible.nom || 'Écran'), el('div', { class: 's' }, cible.enLecture ? 'En lecture' : 'Prêt'));
    const banniere = el('div', { class: 'tc-hs', hidden: true });

    const envoyer = async (action, valeur, bouton) => {
      const { url, body } = logique.commande(cible, action, valeur);
      if (bouton) { bouton.classList.add('tc-flash'); setTimeout(() => bouton.classList.remove('tc-flash'), 180); }
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (r.status === 403 || r.status === 410) { banniere.hidden = false; banniere.textContent = 'Cette télécommande n\'est plus valable (QR expiré ou révoqué). Demande un nouveau QR.'; return; }
        if (!r.ok) { banniere.hidden = false; banniere.textContent = 'Écran injoignable pour le moment. On réessaie à la prochaine touche.'; return; }
        banniere.hidden = true;
      } catch { banniere.hidden = false; banniere.textContent = 'Hors ligne pour le moment. On réessaie à la prochaine touche.'; }
    };

    const presser = async (b, bouton) => {
      if (b.confirme) { if (!(await demanderConfirme('Couper la lecture sur cet écran ?'))) return; }
      let valeur = b.valeur;
      if (b.bascule) { const a = enLecture ? b.bascule : b.action; enLecture = !enLecture; bouton.classList.toggle('ac', !enLecture); maj.querySelector('.s').textContent = enLecture ? 'En lecture' : 'En pause'; return envoyer(a, undefined, bouton); }
      if (b.demande === 'episode') { const rep = await saisirNombre('Aller à quel épisode ?'); const num = rep == null ? null : String(rep).replace(/\D+/g, ''); if (!num) return; valeur = num; }
      return envoyer(b.action, valeur, bouton);
    };

    const grille = el('div', { class: 'tc-grille' });
    for (const b of logique.boutons()) {
      const bouton = el('button', { class: `tc-b${b.groupe === 'alim' ? ' lrg danger' : ''}`, type: 'button', 'aria-label': b.label, onclick: () => presser(b, bouton) }, ic(b.icone), el('span', {}, b.label));
      grille.append(bouton);
    }
    wrap.append(
      el('div', { class: 'tc-tete' }, el('b', {}, 'Télécommande'), el('small', {}, cible.nom ? `Écran : ${cible.nom}` : 'Cet écran')),
      maj, banniere, grille,
      el('p', { class: 'tc-note' }, 'Qui a ce QR peut piloter cet écran. Le code expire tout seul et peut être révoqué à tout moment.'));
    return { arreter() { racine.remove(); } };
  }

  /**
   * Côté propriétaire (page de Vénus / télé via Odéon) : affiche le QR de l'écran (SVG de qr.ts), le nombre de
   * téléphones reliés, et les boutons Révoquer / Régénérer. Révoquer / régénérer renvoient l'identifiant du jeton.
   */
  function afficherQr(host, ecran, opts = {}) {
    styler();
    const boite = el('div', { class: 'tc-qr' });
    host.append(boite);
    const ecranId = typeof ecran === 'object' ? ecran.id : ecran;
    let idJeton = null; // l'identifiant de la télécommande, pour révoquer / régénérer

    const poser = (q) => {
      if (!q || q.error) { boite.replaceChildren(el('p', { style: 'color:#ff9b8d;margin:0' }, (q && q.error) || 'QR indisponible.')); return; }
      idJeton = q.id || idJeton;
      let code = null;
      const qr = String(q.qr || '');
      if (/^<svg[\s>]/i.test(qr)) { code = el('div', { class: 'code' }); code.innerHTML = qr; }
      else if (/^data:image\//.test(qr)) code = el('img', { class: 'code', src: qr, alt: 'QR de la télécommande', width: 200, height: 200 });
      const phones = Number(q.telephones || 0);
      boite.replaceChildren(
        el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, el('b', {}, 'Piloter depuis un téléphone'), el('span', { class: 'phones', title: 'Téléphones reliés à cet écran' }, `${phones} téléphone${phones > 1 ? 's' : ''}`)),
        code || el('p', { style: 'text-align:center;color:#9aa1b2' }, 'Scanne le lien ci-dessous.'),
        q.lien ? el('div', { class: 'lien' }, q.lien) : null,
        el('p', { style: 'margin:0;color:#c9a24a;font-size:12.5px;text-align:center' }, `Qui scanne ce QR pilote cet écran${q.expire ? ` · valable encore ${logique.resteTexte(q.expire)}` : ''}. Rien d'autre d'Odin n'est accessible.`),
        el('div', { class: 'l' },
          el('button', { type: 'button', onclick: () => action('revoquer') }, 'Révoquer'),
          el('button', { type: 'button', onclick: () => action('regenerer') }, 'Régénérer le QR')));
    };
    const action = async (quoi) => {
      boite.replaceChildren(el('p', { style: 'margin:0;color:#9aa1b2' }, quoi === 'revoquer' ? 'Révocation…' : quoi === 'regenerer' ? 'Nouveau QR…' : 'Préparation du QR…'));
      try {
        const r = await fetch(logique.qrUrl(ecranId, quoi), { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(quoi && idJeton ? { id: idJeton } : {}) });
        const d = await r.json().catch(() => ({}));
        if (quoi === 'revoquer') { boite.replaceChildren(el('p', { style: 'margin:0;color:#9aa1b2' }, 'Télécommande révoquée. Les téléphones déjà connectés perdent la main.'), el('div', { class: 'l' }, el('button', { type: 'button', onclick: () => action('') }, 'Nouveau QR'))); idJeton = null; opts.onChange?.(d); return; }
        poser(d); opts.onChange?.(d);
      } catch { boite.replaceChildren(el('p', { style: 'margin:0;color:#ff9b8d' }, 'Odin ne répond pas. Réessaie dans un instant.')); }
    };
    action('');
    return boite;
  }

  window.OdinVenusTelecommande = { monter, afficherQr, logique, boutons: logique.boutons, commande: logique.commande };

  // Repli : si ce fichier est chargé sur une page /t/<jeton> avec un point de montage, il monte la télécommande seule.
  function auto() {
    const racine = document.getElementById('odin-tc');
    const jeton = (racine && racine.getAttribute('data-jeton')) || logique.jetonDeChemin(location.pathname);
    if (!jeton) return;
    const nom = (racine && racine.getAttribute('data-ecran')) || '';
    monter(racine || document.body, { jeton, nom }, { plein: true });
  }
  if (typeof document !== 'undefined' && typeof location !== 'undefined' && document.getElementById && location.pathname && logique.jetonDeChemin(location.pathname) && document.getElementById('odin-tc')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto, { once: true }); else auto();
  }
})();
