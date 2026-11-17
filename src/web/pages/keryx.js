// La page de Kéryx : l'assistant d'Odin JOIGNABLE DE DEHORS qui AGIT à ta place (mails, agenda, autres applis),
// pas seulement répond. On le joint par les messageries déjà actives (Telegram…), par la voix, et — quand une
// ligne est branchée — par SMS ou par appel. HONNÊTE : SMS et appel sont « codés, pas essayés sur du vrai
// matériel » tant qu'aucune ligne n'est là ; Kéryx marche quand même tout de suite par messagerie et par la voix.
//
// Point fort affiché en haut : Kéryx ne prend AUCUNE capture d'écran et ne piste PAS ta position — c'est la
// correction, par construction, du point noir de l'assistant américain « Instinct ».
//
// La page montre l'état (ligne, canaux actifs, mail et agenda branchés ou non), puis deux volets : « Réglages »
// (src/web/pages/keryx-reglages.js) et « Historique » (src/web/pages/keryx-historique.js). Elle ne connaît ni base
// ni serveur : elle n'appelle que les routes /api/keryx/* (voir le CONTRAT du lot). Chargée toute seule ; toute
// confirmation passe par OdinDialog. Lisible à 1280 px comme à 390 px, thème clair et sombre.
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  if (window.OdinKeryx) return;

  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };

  const api = async (path, opts = {}) => {
    try {
      const init = { method: opts.method || 'GET', headers: { 'x-odin': '1' } };
      if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
      const r = await fetch(`/api/keryx${path}`, init);
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, ...j };
    } catch { return { ok: false, text: 'Kéryx ne répond pas.' }; }
  };

  // ---------------- Logique pure (sans document).
  const LIGNE_ETAT = { aucune: 'aucune ligne', modem: 'modem GSM', sip: 'ligne SIP' };
  const ligneEtat = (l) => LIGNE_ETAT[l] || 'aucune ligne';
  /** Résumé honnête des canaux : ce qui marche pour de vrai vs ce qui attend une ligne. */
  function resumeCanaux(etat) {
    const actifs = Array.isArray(etat?.canauxActifs) ? etat.canauxActifs : [];
    return actifs.length ? actifs.join(', ') : 'aucun canal actif pour l\'instant';
  }

  const CSS = `
.kx{display:flex;flex-direction:column;gap:16px;min-width:0;max-width:980px}
.kx-prive{display:flex;gap:10px;align-items:flex-start;border:1px solid color-mix(in srgb,var(--good,#2F8F4E) 50%,var(--line));background:color-mix(in srgb,var(--good,#2F8F4E) 10%,transparent);border-radius:12px;padding:12px 14px}
.kx-prive .kx-bouclier{font-size:20px;line-height:1.2;flex:none}
.kx-prive b{color:var(--ink)}
.kx-prive p{margin:4px 0 0;font-size:12.5px;color:var(--ink);line-height:1.5}
.kx-intro{font-size:13.5px;color:var(--muted);line-height:1.55;margin:0}
.kx-etat{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kx-cell{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:10px 12px;min-width:0}
.kx-cell .kx-k{font-size:12px;color:var(--muted)}
.kx-cell .kx-v{font:600 15px inherit;color:var(--ink);margin-top:2px;word-break:break-word}
.kx-cell .kx-v.oui{color:var(--good,#2F8F4E)}
.kx-cell .kx-v.non{color:var(--warn,#C9972B)}
.kx-avert{font-size:12.5px;line-height:1.5;color:var(--ink);background:var(--warn-bg,color-mix(in srgb,var(--warn,#C9972B) 14%,transparent));border:1px solid var(--warn,#C9972B);border-radius:10px;padding:8px 10px;margin:0}
.kx-onglets{display:flex;gap:6px;border-bottom:1px solid var(--line)}
.kx-onglets button{min-height:40px;border:0;background:none;color:var(--muted);padding:0 4px 8px;margin-right:12px;font:600 14px inherit;cursor:pointer;border-bottom:2px solid transparent}
.kx-onglets button[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--accent,#3F82F0)}
.kx-volet{min-width:0}
`;
  function style() { if (!document.getElementById('kx-css')) document.head.append(el('style', { id: 'kx-css' }, CSS)); }

  function banniereViePrivee() {
    return el('div', { class: 'kx-prive', role: 'note' },
      el('span', { class: 'kx-bouclier', 'aria-hidden': 'true' }, '🛡'),
      el('div', {},
        el('b', {}, 'Kéryx ne prend AUCUNE capture d\'écran et ne piste PAS ta position.'),
        el('p', {}, 'Tous les échanges et toutes les actions sont privés, chiffrés au repos, jamais envoyés dehors. C\'est un point fort du natif, pas une option à activer.')));
  }

  function cellule(k, v, classe) { return el('div', { class: 'kx-cell' }, el('div', { class: 'kx-k' }, k), el('div', { class: 'kx-v' + (classe ? ' ' + classe : '') }, v)); }

  function sommaireEtat(etat) {
    const grille = el('div', { class: 'kx-etat' },
      cellule('Ligne', ligneEtat(etat.ligne)),
      cellule('Canaux actifs', resumeCanaux(etat)),
      cellule('Mail', etat.mailBranche ? 'branché' : 'non branché', etat.mailBranche ? 'oui' : 'non'),
      cellule('Agenda', etat.agendaBranche ? 'branché' : 'non branché', etat.agendaBranche ? 'oui' : 'non'));
    const bloc = el('div', { style: 'display:flex;flex-direction:column;gap:10px' }, grille);
    const manque = [];
    if (!etat.mailBranche) manque.push('le courrier');
    if (!etat.agendaBranche) manque.push('l\'agenda');
    if (manque.length) bloc.append(el('p', { class: 'kx-avert' }, `${manque.join(' et ')} ${manque.length > 1 ? 'ne sont pas branchés' : 'n\'est pas branché'} : Kéryx ne pourra pas encore agir dessus.`));
    if (etat.ligne && etat.ligne !== 'aucune' && etat.telephonieEssayee === false) {
      bloc.append(el('p', { class: 'kx-avert' }, 'La téléphonie (SMS, appel) est codée mais pas encore essayée sur du vrai matériel. En attendant, Kéryx répond par messagerie et par la voix.'));
    }
    return bloc;
  }

  async function rendre(host, ctx = {}) {
    style();
    const racine = el('div', { class: 'kx' });
    host.replaceChildren(racine);
    racine.append(banniereViePrivee(), el('p', { class: 'kx-intro' }, 'Chargement de Kéryx…'));

    const etat = await api('/etat');
    racine.replaceChildren(banniereViePrivee());
    if (!etat || etat.ok === false || !etat.ligne) {
      racine.append(el('p', { class: 'kx-avert' }, 'Kéryx n\'est pas encore prêt. Règle une ligne (ou garde « aucune ») et la liste blanche pour commencer.'));
    } else {
      racine.append(
        el('p', { class: 'kx-intro' }, 'Kéryx est l\'assistant d\'Odin qu\'on joint de dehors et qui AGIT à ta place — il trie et répond à tes mails, tient ton agenda, et pilote tes applis — par message ou par la voix, jamais sans que tu l\'y aies autorisé.'),
        sommaireEtat(etat));
    }

    // Deux volets : Réglages et Historique.
    const noms = [['reglages', 'Réglages'], ['historique', 'Historique']];
    let sel = ctx.volet && noms.some((n) => n[0] === ctx.volet) ? ctx.volet : 'reglages';
    const volet = el('div', { class: 'kx-volet' });
    const liste = el('div', { class: 'kx-onglets', role: 'tablist', 'aria-label': 'Parties de Kéryx' });
    const boutons = noms.map(([id, titre], i) => el('button', { type: 'button', role: 'tab', id: `kx-tab-${id}`, 'aria-selected': String(id === sel), 'aria-controls': 'kx-volet', tabindex: id === sel ? '0' : '-1',
      onclick: () => choisir(id), onkeydown: (e) => { const k = e.key, j = k === 'ArrowRight' ? (i + 1) % noms.length : k === 'ArrowLeft' ? (i + noms.length - 1) % noms.length : k === 'Home' ? 0 : k === 'End' ? noms.length - 1 : -1; if (j >= 0) { e.preventDefault(); choisir(noms[j][0]); } } }, titre));
    liste.append(...boutons);
    racine.append(liste, volet);

    function choisir(id) {
      sel = id;
      boutons.forEach((b, i) => { const on = noms[i][0] === id; b.setAttribute('aria-selected', String(on)); b.setAttribute('tabindex', on ? '0' : '-1'); });
      peindreVolet();
      boutons[noms.findIndex((n) => n[0] === id)]?.focus?.();
    }
    const sousCtx = { api, toast: ctx.toast, recharger: () => rendre(host, { ...ctx, volet: sel }) };
    function peindreVolet() {
      volet.replaceChildren();
      if (sel === 'historique' && window.OdinKeryxHistorique) window.OdinKeryxHistorique.rendre(volet, sousCtx);
      else if (window.OdinKeryxReglages) window.OdinKeryxReglages.rendre(volet, sousCtx);
      else volet.append(el('p', { class: 'kx-avert' }, 'Le volet demandé n\'a pas pu se charger.'));
    }
    peindreVolet();
    return true;
  }

  window.OdinKeryx = { rendre, logique: { ligneEtat, resumeCanaux, LIGNE_ETAT } };
  window.OdinPages.keryx = async (args) => rendre(args.host, { toast: args.toast });
})();
