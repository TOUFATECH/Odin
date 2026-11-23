// Activer ou désactiver une appli. Sur sa carte (page Applis) : l'épingle en haut à gauche, le bouton d'activation en
// face, en haut à droite. Sur sa page : « Désactiver » / « Activer » à côté de « Épingler au menu ». Une appli
// désactivée est grisée partout (carte, page, menu « Plus ») mais reste visible et se réactive d'un clic ; sa page dit
// ce que cela veut dire et son contenu est mis en sommeil (inerte) jusqu'à ce qu'on l'active.
// Le réglage est gardé par Odin (POST /api/valhalla/activer, propriétaire seul) ; rien n'est gardé dans le navigateur.
// Ce fichier ne touche pas au document à son chargement. API : window.OdinActivation (voir en bas).
(() => {
  'use strict';
  if (window.OdinActivation) return;

  // ---------------- Les textes (une langue par entrée ; celle de la page, sinon le français)
  const TEXTES = {
    fr: {
      desactiver: 'Désactiver', activer: 'Activer',
      desactiverNom: 'Désactiver {nom}', activerNom: 'Activer {nom}',
      desactivee: 'Désactivée',
      bandeau: '{nom} est désactivée : plus de notification, d\'alerte, de tâche ni d\'automatisation, et Odin ne la choisit plus (seule une alerte de sécurité critique te parvient encore, par Forseti). Ses données sont gardées.',
      bandeauMembre: '{nom} est désactivée par le propriétaire d\'Odin.',
      confirmer: 'Désactiver {nom} ? Elle ne t\'enverra plus rien et ne fera plus rien toute seule. Ses données sont gardées ; tu pourras la réactiver ici.',
      enCours: 'Un instant…', injoignable: 'Odin ne répond pas : rien n\'a changé.', refuse: 'Refusé.',
    },
    en: {
      desactiver: 'Turn off', activer: 'Turn on',
      desactiverNom: 'Turn off {nom}', activerNom: 'Turn on {nom}',
      desactivee: 'Off',
      bandeau: '{nom} is turned off: no more notifications, alerts, tasks or automations, and Odin no longer picks it (only a critical security alert still reaches you, through Forseti). Its data is kept.',
      bandeauMembre: '{nom} was turned off by Odin\'s owner.',
      confirmer: 'Turn off {nom}? It will no longer send you anything or do anything on its own. Its data is kept; you can turn it back on here.',
      enCours: 'One moment…', injoignable: 'Odin is not answering: nothing changed.', refuse: 'Refused.',
    },
  };
  const langue = () => { const l = (document.documentElement.lang || 'fr').slice(0, 2).toLowerCase(); return TEXTES[l] ? l : 'fr'; };
  const T = (k, v = {}) => String((TEXTES[langue()] ?? TEXTES.fr)[k] ?? TEXTES.fr[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => String(v[x] ?? ''));

  // ---------------- L'état connu (rempli par le catalogue des applis)
  const etat = { eteintes: new Set(), essentielles: new Set(), peut: false, connu: false };
  /** Le catalogue (/api/valhalla/catalog) : quelles applis sont désactivées, lesquelles sont indispensables, qui peut changer. */
  function retenir(cat) {
    if (!cat || !Array.isArray(cat.modules)) return;
    etat.eteintes = new Set(cat.modules.filter((m) => m.active === false).map((m) => m.id));
    etat.essentielles = new Set(cat.modules.filter((m) => m.essentielle === true).map((m) => m.id));
    etat.peut = cat.peutActiver === true; etat.connu = true;
    if (etat.eteintes.size) style(); // le menu « Plus » grise aussi les applis désactivées
  }
  /** La page d'une appli (/api/valhalla/view) : son état à elle, quand le catalogue n'a pas encore été lu. */
  function retenirUne(r) {
    if (!r || typeof r.id !== 'string' || typeof r.active !== 'boolean') return;
    if (r.active) etat.eteintes.delete(r.id); else etat.eteintes.add(r.id);
    if (r.essentielle === true) etat.essentielles.add(r.id); else etat.essentielles.delete(r.id);
    if (typeof r.peutActiver === 'boolean') { etat.peut = r.peutActiver; etat.connu = true; }
  }
  const estEteinte = (id) => etat.eteintes.has(id);
  /** Le bouton existe-t-il pour cette appli ? (le propriétaire, et pas une appli indispensable) */
  const basculable = (id) => etat.connu && etat.peut && !etat.essentielles.has(id);

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
  const svg = (w = 18) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: String(w), height: String(w), fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v); s.innerHTML = '<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>'; return s; };
  const css = `
.va-appcell .va-pin{right:auto;left:2px}
.va-act{position:absolute;top:2px;right:2px;width:34px;height:34px;padding:0;border-radius:50%;border:1px solid var(--line);background:var(--panel);color:var(--muted);display:grid;place-items:center;cursor:pointer;opacity:0;pointer-events:none}
.va-appcell:hover>.va-act,.va-appcell:focus-within>.va-act,.va-appcell.va-off>.va-act{opacity:1;pointer-events:auto}.va-act:hover{color:var(--ink)}.va-act:focus-visible{outline:2px solid var(--accent);opacity:1}
.va-appcell.va-off>.va-act{color:var(--accent);border-color:var(--accent)}
.va-off>.va-appbtn>svg,.va-off>.va-appbtn>img,.va-off>.va-appbtn>span:first-child{filter:grayscale(1);opacity:.5}.va-off>.va-appbtn{color:var(--muted)}
.va-off-mot{display:block;font-size:12px;line-height:1.2;color:var(--muted);font-weight:500}
@media (pointer:coarse){.va-act{opacity:1;pointer-events:auto;width:44px;height:44px;top:-4px;right:-4px}.va-appcell .va-pin{right:auto;left:-4px}}
.va-actb[aria-busy=true]{opacity:.6}
.va-off-band{flex:1 1 100%;display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:var(--panel2,var(--panel));color:var(--ink);font-size:15px}
.va-off-band>span{flex:1 1 240px;min-width:0}.va-off-band .btn{min-height:44px}
.va-dort{filter:grayscale(1);opacity:.55}
.va-head.va-off .va-ic{filter:grayscale(1);opacity:.5}
.nav-ep-off .odin-app-ic,.nav-ep-off>span[aria-hidden]{filter:grayscale(1);opacity:.5}.nav-ep-off .lbl{color:var(--muted)}
.ep-r.va-off .ep-n{color:var(--muted)}.ep-r.va-off>span[aria-hidden]{filter:grayscale(1);opacity:.5}
`;
  let styled = false;
  function style() { if (styled) return; styled = true; document.head.append(el('style', {}, css)); }

  async function poster(id, actif) {
    let r; try { r = await fetch('/api/valhalla/activer', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: id, actif }) }); } catch { return { ok: false, text: T('injoignable') }; }
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, text: T('injoignable') };
    return { ok: j.ok === true, text: j.text || j.error || T('refuse'), active: j.active };
  }
  const dire = (texte) => {
    let t = document.getElementById('vaActToast');
    if (!t) { t = el('div', { id: 'vaActToast', role: 'status', style: 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:70;max-width:min(520px,calc(100% - 32px));padding:10px 14px;border-radius:12px;background:var(--panel);color:var(--ink);border:1px solid var(--line);box-shadow:var(--shadow)' }); document.body.append(t); }
    t.textContent = texte; t.hidden = false; clearTimeout(dire.t); dire.t = setTimeout(() => { t.hidden = true; }, 5000);
  };
  /**
   * Active ou désactive (désactiver demande une confirmation). Rend true si l'état a changé. Prévient la page
   * (événement « odin:activation ») : la grille, la page de l'appli et le menu se redessinent.
   */
  async function basculer(id, nom, btn) {
    const actif = estEteinte(id);
    if (!actif) {
      const ok = window.OdinDialog?.confirm ? await window.OdinDialog.confirm(T('confirmer', { nom }), { danger: true }) : window.confirm(T('confirmer', { nom }));
      if (!ok) return false;
    }
    if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }
    const r = await poster(id, actif);
    if (btn?.isConnected) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
    if (!r.ok) { dire(r.text); return false; }
    if (r.active === false) etat.eteintes.add(id); else etat.eteintes.delete(id);
    dire(r.text);
    // `page` : le geste vient de la page de l'appli (le focus y revient sur son bouton une fois la page redessinée).
    document.dispatchEvent(new CustomEvent('odin:activation', { detail: { id, active: r.active !== false, page: Boolean(btn?.closest?.('#v-app')) } }));
    return true;
  }

  /** Le petit bouton rond de la carte (en haut à droite, en face de l'épingle). null quand il n'a pas lieu d'être. */
  function boutonCarte(id, nom) {
    if (!basculable(id)) return null;
    style();
    const off = estEteinte(id), t = off ? T('activerNom', { nom }) : T('desactiverNom', { nom });
    const b = el('button', { class: 'va-act', type: 'button', 'aria-label': t, title: t, 'data-act': id, onclick: async (e) => { e.stopPropagation(); if (await basculer(id, nom, b)) document.querySelector(`.va-act[data-act="${CSS.escape(id)}"]`)?.focus(); } }, svg(18));
    return b;
  }
  /** Le bouton de la page de l'appli, avec son mot (« Désactiver » / « Activer »). */
  function boutonPage(id, nom, o = {}) {
    if (!basculable(id)) return null;
    style();
    const off = estEteinte(id), t = off ? T('activerNom', { nom }) : T('desactiverNom', { nom });
    // Dans l'en-tête, il suit les autres boutons (son mot caché sur téléphone) ; dans le bandeau, son mot reste visible.
    const b = el('button', { class: `btn va-actb${o.texte ? '' : ' va-share'}${off ? ' primary' : ''}`, type: 'button', title: t, 'aria-label': t, 'data-actb': id, onclick: async () => { if (await basculer(id, nom, b)) document.querySelector(`.va-actb[data-actb="${CSS.escape(id)}"]`)?.focus(); } }, svg(), el('span', {}, off ? T('activer') : T('desactiver')));
    return b;
  }
  /** Grise une carte de la grille (et ajoute le mot « Désactivée » sous son nom). */
  function marquerCarte(cell, id) {
    style();
    const off = estEteinte(id);
    cell.classList.toggle('va-off', off);
    const btn = cell.querySelector('.va-appbtn'); if (!btn) return;
    btn.querySelector('.va-off-mot')?.remove();
    if (off) btn.append(el('span', { class: 'va-off-mot' }, T('desactivee')));
  }
  /** Le bandeau sous l'en-tête d'une appli désactivée (rien si elle est active). */
  function bandeau(id, nom) {
    if (!estEteinte(id)) return null;
    style();
    return el('p', { class: 'va-off-band', role: 'status' }, el('span', {}, basculable(id) ? T('bandeau', { nom }) : T('bandeauMembre', { nom })), boutonPage(id, nom, { texte: true }));
  }
  /** Le contenu d'une appli désactivée : grisé et inerte (on ne peut rien y lancer), lisible quand même. */
  function endormir(noeuds, id) {
    if (!estEteinte(id)) return;
    style();
    for (const n of noeuds) if (n && n.nodeType === 1) { n.classList.add('va-dort'); n.setAttribute('inert', ''); }
  }

  window.OdinActivation = { retenir, retenirUne, estEteinte, basculable, basculer, boutonCarte, boutonPage, marquerCarte, bandeau, endormir, textes: TEXTES, T };
})();
