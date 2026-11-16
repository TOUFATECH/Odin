// Épingles du menu : les applis (et les vues d'Odin) qu'on veut avoir sous la main vont dans « Plus », avec leur
// icône et leur nom ; un clic ouvre leur page. On épingle depuis la page de l'appli, sa carte dans « Applis », ou la
// ligne « Épingler une appli… » au bout de « Plus » ; on retire et on range depuis le menu (bouton au survol et au
// clavier, appui long au doigt, Alt+↑ / Alt+↓). Les épingles sont gardées par Odin, par compte (GET/POST /api/epingles) :
// le même menu sur l'ordinateur et le téléphone. Sans réponse d'Odin, le menu reste exactement comme avant.
// Point d'ancrage : #navEpingles, dans #navMore (le contenu déplié de « Plus »).
// Ce fichier est chargé avant les autres scripts de l'interface : rien ne touche au document à son chargement.
// API : OdinEpingles.bouton(id, nom, { petit }) → bouton ou null ; OdinEpingles.estEpingle(id) ; OdinEpingles.logique.
(() => {
  'use strict';
  if (window.OdinEpingles) return;

  // ---------------- Logique pure (sans document)
  const MAX = 12;
  /** Les vues d'Odin rangées sous « Plus », dans leur ordre de départ. */
  const VUES = ['vue:flows', 'vue:runes', 'vue:missions', 'vue:skills', 'vue:jobs', 'vue:audit'];
  const FORME = /^appli:[a-z0-9_-]+$/;
  const estVue = (id) => VUES.includes(id);
  const nbApplis = (liste) => liste.filter((x) => !estVue(x)).length;
  /** Épingle (à la fin) ou retire. { liste, code? } : code 'max' quand il y a déjà 12 applis (les vues ne comptent pas). */
  function basculer(liste, id, max = MAX) {
    if (liste.includes(id)) return { liste: liste.filter((x) => x !== id) };
    if (!estVue(id) && nbApplis(liste) >= max) return { liste: [...liste], code: 'max' };
    return { liste: [...liste, id] };
  }
  /** Monte (sens -1) ou descend (sens +1) une épingle ; aux bords, rien ne bouge. */
  function deplacer(liste, id, sens) {
    const i = liste.indexOf(id), j = i + (sens < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= liste.length) return [...liste];
    const l = [...liste]; [l[i], l[j]] = [l[j], l[i]]; return l;
  }
  /** Retire ce qui n'est pas une épingle connue et les doublons. `connus` : les applis qui existent (identifiants internes). */
  function nettoyer(liste, connus) {
    const ok = connus ? new Set(connus) : null, vu = new Set(), out = [];
    for (const x of Array.isArray(liste) ? liste : []) {
      if (typeof x !== 'string' || vu.has(x)) continue;
      if (!estVue(x) && !(FORME.test(x) && (!ok || ok.has(x.slice(6))))) continue;
      vu.add(x); out.push(x);
    }
    return out;
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
  const svg = (d, w = 18) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: String(w), height: String(w), fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v); s.innerHTML = d; return s; };
  const I = { epingle: '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 15v5"/>', retirer: '<path d="M6 6l12 12M18 6L6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>' };
  const css = `
.nav-epingles{display:flex;flex-direction:column}.nav-ep{position:relative;display:flex;align-items:stretch;min-width:0}.nav-ep>.tab{flex:1 1 auto;min-width:0;padding-right:40px}
.nav-ep-app .odin-app-ic{flex:none}.nav-ep-add{color:var(--muted)}.nav-ep-add svg{flex:none}
.nav-ep-x{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:32px;height:32px;padding:0;border:0;border-radius:8px;background:var(--panel2,var(--panel));color:var(--muted);cursor:pointer;display:grid;place-items:center;opacity:0;pointer-events:none}
.nav-ep:hover>.nav-ep-x,.nav-ep:focus-within>.nav-ep-x{opacity:1;pointer-events:auto}.nav-ep-x:hover{color:var(--bad)}.nav-ep-x:focus-visible{outline:2px solid var(--accent);opacity:1}
.nav-ep-menu{position:absolute;right:4px;top:100%;z-index:40;display:flex;flex-direction:column;min-width:160px;padding:4px;border-radius:12px;border:1px solid var(--line);background:var(--panel);box-shadow:var(--shadow)}
.nav-ep-menu button{min-height:44px;padding:0 12px;border:0;border-radius:8px;background:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer}.nav-ep-menu button:hover,.nav-ep-menu button:focus-visible{background:var(--hover)}
.ep-dlg{border:1px solid var(--line);border-radius:16px;background:var(--panel);color:var(--ink);padding:16px;width:min(560px,calc(100vw - 32px));max-height:min(80dvh,720px);box-sizing:border-box}.ep-dlg::backdrop{background:rgba(0,0,0,.45)}
.ep-dlg[open]{display:flex;flex-direction:column;gap:10px}.ep-h{display:flex;align-items:center;gap:10px}.ep-h h2{flex:1;margin:0;font-size:18px}.ep-dlg p{margin:0}
.ep-dlg input[type=search]{box-sizing:border-box;width:100%;min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--field,var(--line));background:var(--panel2);color:var(--ink);font:inherit}
.ep-l{overflow:auto;min-height:0;flex:1 1 auto}.ep-l h3{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim,var(--muted));margin:10px 0 4px}.ep-l ul{list-style:none;margin:0;padding:0}
.ep-r{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)}.ep-r>span.ep-n{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}.ep-r .btn{min-height:44px}.ep-r .btn[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}
.ep-st{font-size:14px;color:var(--muted)}.ep-st.ko{color:var(--bad)}
.va-appcell{position:relative;display:grid;min-width:0}.va-appcell>.va-appbtn{width:100%}
.va-pin{position:absolute;top:2px;right:2px;width:34px;height:34px;padding:0;border-radius:50%;border:1px solid var(--line);background:var(--panel);color:var(--muted);display:grid;place-items:center;cursor:pointer;opacity:0;pointer-events:none}
.va-appcell:hover>.va-pin,.va-appcell:focus-within>.va-pin,.va-pin[aria-pressed=true]{opacity:1;pointer-events:auto}.va-pin[aria-pressed=true]{color:var(--accent);border-color:var(--accent)}.va-pin:focus-visible{outline:2px solid var(--accent)}
@media (pointer:coarse){.va-pin{opacity:1;pointer-events:auto;width:44px;height:44px;top:-4px;right:-4px}.nav-ep-x{display:none}}
`;
  let styled = false;
  function style() { if (styled) return; styled = true; document.head.append(el('style', {}, css)); }

  /** 'attente' (pas encore chargé, ou pas connecté), 'absent' (Odin ne sait pas garder d'épingles), 'pret'. */
  let statut = 'attente', charge = null;
  let etat = { epingles: [], max: MAX, proprietaire: false, vues: [] };
  const NOMS = new Map(); let modules = [];
  let courant = null;
  const boutons = new Set();

  async function lire(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
    return { status: r.status, j: r.ok ? await r.json().catch(() => null) : null };
  }
  async function charger() {
    if (charge) return charge;
    charge = (async () => {
      let r; try { r = await lire('/api/epingles'); } catch { r = { status: 0, j: null }; }
      if (r.status === 401) { statut = 'attente'; return; }
      if (!r.j || r.j.ok !== true || !Array.isArray(r.j.epingles)) { statut = 'absent'; for (const b of boutons) b.remove(); boutons.clear(); return; }
      etat = { epingles: nettoyer(r.j.epingles), max: Number(r.j.max) || MAX, proprietaire: Boolean(r.j.proprietaire), vues: Array.isArray(r.j.vues) ? r.j.vues : [] };
      try { const c = await lire('/api/valhalla/catalog'); modules = Array.isArray(c.j?.modules) ? c.j.modules : []; for (const m of modules) NOMS.set(m.id, m.name); } catch { /* sans noms : les applis épinglées attendent */ }
      statut = 'pret'; maj();
    })().finally(() => { charge = null; });
    return charge;
  }

  let toastT = null;
  function dire(texte) {
    const d = document.querySelector('.ep-dlg[open] .ep-st');
    if (d) { d.textContent = texte; d.classList.add('ko'); return; }
    let t = document.getElementById('epToast');
    if (!t) { t = el('div', { id: 'epToast', role: 'status', style: 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:70;max-width:min(520px,calc(100% - 32px));padding:10px 14px;border-radius:12px;background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow)' }); document.body.append(t); }
    t.textContent = texte; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4500);
  }
  async function envoyer(corps) {
    let r; try { r = await lire('/api/epingles', corps); } catch { r = { j: null }; }
    if (!r.j) { dire('Odin ne répond pas : le menu n\'a pas changé.'); return false; }
    if (!r.j.ok) { dire(r.j.code === 'max' ? (r.j.error || `Tu as déjà ${etat.max} applis épinglées : retires-en une d'abord.`) : r.j.error || 'Refusé.'); return false; }
    etat.epingles = nettoyer(r.j.epingles); maj(); return true;
  }
  const estEpingle = (id) => statut === 'pret' && etat.epingles.includes(id);
  async function basculerId(id) {
    const b = basculer(etat.epingles, id, etat.max);
    if (b.code === 'max') { dire(`Tu as déjà ${etat.max} applis épinglées : retires-en une d'abord.`); return false; }
    return envoyer(etat.epingles.includes(id) ? { faire: 'retirer', id } : { faire: 'epingler', id });
  }
  async function deplacerId(id, sens) {
    const l = deplacer(etat.epingles, id, sens);
    if (l.join() === etat.epingles.join()) return false;
    return envoyer({ faire: 'ordonner', ordre: l });
  }

  const nomVue = (id) => etat.vues.find((v) => v.id === id)?.nom ?? (boutonVue(id)?.querySelector('.lbl')?.textContent ?? id.slice(4)).trim();
  const nomDe = (id) => (estVue(id) ? nomVue(id) : NOMS.get(id.slice(6)) ?? '');
  const boutonVue = (id) => document.querySelector(`#sideNav .tab[data-view="${id.slice(4)}"]`);
  const icone = (appId, nom, taille) => { const s = el('span', { 'aria-hidden': 'true', style: 'line-height:0;flex:none' }); if (window.OdinAppIcons) s.innerHTML = window.OdinAppIcons.tile(appId, nom, taille); return s; };

  function fermerMenus() { for (const m of document.querySelectorAll('.nav-ep-menu')) m.remove(); }
  /**
   * Retire une épingle depuis le menu sans perdre le focus : il passe à la ligne suivante (sinon la précédente, sinon
   * « Épingler une appli… ») une fois le menu redessiné.
   */
  async function retirerDuMenu(id) {
    const row = document.querySelector(`#navEpingles [data-ep="${CSS.escape(id)}"]`);
    const voisin = (row?.nextElementSibling?.matches?.('.nav-ep') ? row.nextElementSibling : row?.previousElementSibling?.matches?.('.nav-ep') ? row.previousElementSibling : null)?.getAttribute('data-ep');
    const ok = await basculerId(id);
    const cible = !ok ? row?.querySelector('.tab') : (voisin && document.querySelector(`#navEpingles [data-ep="${CSS.escape(voisin)}"] > .tab`)) || document.querySelector('#navEpingles .nav-ep-add');
    cible?.focus();
    return ok;
  }
  function menu(rangee, id, nom) {
    fermerMenus();
    const fait = (fn) => async () => { fermerMenus(); await fn(); rangee.isConnected && rangee.querySelector('.tab')?.focus(); };
    const m = el('div', { class: 'nav-ep-menu', role: 'menu', 'aria-label': nom, onkeydown: (e) => { if (e.key === 'Escape') { fermerMenus(); rangee.querySelector('.tab')?.focus(); } } },
      el('button', { type: 'button', role: 'menuitem', onclick: async () => { fermerMenus(); await retirerDuMenu(id); } }, 'Retirer du menu'),
      el('button', { type: 'button', role: 'menuitem', onclick: fait(() => deplacerId(id, -1)) }, 'Monter'),
      el('button', { type: 'button', role: 'menuitem', onclick: fait(() => deplacerId(id, 1)) }, 'Descendre'));
    rangee.append(m); m.querySelector('button')?.focus();
    setTimeout(() => document.addEventListener('pointerdown', (e) => { if (!m.contains(e.target)) fermerMenus(); }, { once: true }), 0);
  }
  /** Une ligne du menu : le bouton (vue ou appli), et « Retirer du menu » au survol et au clavier. */
  function rangee(id, bouton, nom) {
    const r = el('div', { class: 'nav-ep', 'data-ep': id });
    r.append(bouton, el('button', { class: 'nav-ep-x', type: 'button', 'aria-label': `Retirer ${nom} du menu`, title: `Retirer ${nom} du menu`, onclick: () => retirerDuMenu(id) }, svg(I.retirer, 16)));
    if (bouton.dataset.epBranche !== id) {
      bouton.dataset.epBranche = id;
      bouton.addEventListener('keydown', async (e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        if (await deplacerId(id, e.key === 'ArrowUp' ? -1 : 1)) document.querySelector(`#navEpingles [data-ep="${id}"] > .tab`)?.focus();
      });
      // Appui long au doigt (600 ms) : petit menu Retirer / Monter / Descendre, sans ouvrir la page.
      let minuterie = null, long = false;
      const stop = () => { clearTimeout(minuterie); minuterie = null; };
      bouton.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; long = false; stop(); minuterie = setTimeout(() => { long = true; const row = bouton.closest('.nav-ep'); if (row) menu(row, id, nomDe(id) || nom); }, 600); });
      for (const t of ['pointerup', 'pointercancel', 'pointerleave']) bouton.addEventListener(t, stop);
      bouton.addEventListener('contextmenu', (e) => { if (long || minuterie) e.preventDefault(); });
      bouton.addEventListener('click', (e) => { if (long) { long = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    }
    return r;
  }
  function boutonAppli(appId, nom) {
    const b = el('button', { class: 'tab nav-ep-app', type: 'button', 'data-ep-app': appId, onclick: () => window.OdinApps?.app(appId) }, icone(appId, nom, 20), el('span', { class: 'lbl' }, nom));
    if (courant === appId) b.setAttribute('aria-current', 'page');
    return b;
  }
  // La dernière tuile, permanente : la fenêtre Script (appli Archytas). Toujours visible, jamais comptée dans les 12, jamais retirable.
  function tuileScript() {
    const b = el('button', { class: 'tab nav-ep-app nav-ep-script', type: 'button', 'data-ep-app': 'archytas', title: 'Script — les automatisations qu\'Odin fabrique', onclick: () => window.OdinApps?.app('archytas') }, icone('archytas', 'Script', 20), el('span', { class: 'lbl' }, 'Script'));
    if (courant === 'archytas') b.setAttribute('aria-current', 'page');
    return b;
  }
  /** Le menu « Plus » : les vues et les applis épinglées dans leur ordre, puis « Épingler une appli… ». */
  function dessiner() {
    const ancre = document.getElementById('navEpingles');
    if (!ancre) return;
    fermerMenus();
    // La tuile « Script » reste là même avant qu'Odin réponde, ou s'il ne sait pas garder d'épingles.
    if (statut !== 'pret') { ancre.replaceChildren(tuileScript()); return; }
    const lignes = [];
    for (const id of etat.epingles) {
      if (estVue(id)) { const b = boutonVue(id); if (!b) continue; b.hidden = false; lignes.push(rangee(id, b, nomVue(id))); continue; }
      const appId = id.slice(6), nom = NOMS.get(appId); if (!nom) continue;
      lignes.push(rangee(id, boutonAppli(appId, nom), nom));
    }
    // Les vues retirées restent dans la page (cachées) : leurs pastilles et leurs raccourcis continuent de marcher.
    const cachees = VUES.filter((v) => !etat.epingles.includes(v)).map(boutonVue).filter(Boolean);
    for (const b of cachees) b.hidden = true;
    const ajout = el('button', { class: 'tab nav-ep-add', type: 'button', 'aria-haspopup': 'dialog', onclick: ouvrirListe }, svg(I.epingle, 20), el('span', { class: 'lbl' }, 'Épingler une appli…'));
    ancre.replaceChildren(...lignes, ...cachees, tuileScript(), ajout);
  }
  function majBouton(b) {
    const id = b.dataset.epId, nom = b.dataset.epNom, oui = estEpingle(id);
    b.hidden = statut !== 'pret';
    b.setAttribute('aria-pressed', String(oui));
    const texte = oui ? 'Retirer du menu' : 'Épingler au menu';
    if (b.classList.contains('va-pin')) { const t = oui ? `Retirer ${nom} du menu` : `Épingler ${nom} au menu`; b.setAttribute('aria-label', t); b.title = t; }
    else { b.title = oui ? `Retirer ${nom} du menu « Plus »` : `Épingler ${nom} dans le menu « Plus »`; const s = b.querySelector('span'); if (s) s.textContent = texte; }
  }
  function maj() {
    dessiner();
    for (const b of [...boutons]) { if (!b.isConnected && b.dataset.epVu === '1') { boutons.delete(b); continue; } if (b.isConnected) b.dataset.epVu = '1'; majBouton(b); }
    if (dlg?.open) peindreListe();
    marquer();
  }
  /**
   * Le bouton « Épingler au menu » / « Retirer du menu » (page d'une appli), ou sa petite version (carte dans « Applis »).
   * null quand Odin ne sait pas garder d'épingles.
   */
  function bouton(id, nom, opts = {}) {
    if (statut === 'absent' || (!estVue(id) && !FORME.test(id))) return null;
    style();
    const b = opts.petit
      ? el('button', { class: 'va-pin', type: 'button', onclick: (e) => { e.stopPropagation(); basculerId(id); } }, svg(I.epingle, 18))
      : el('button', { class: 'btn va-share va-epingle', type: 'button', onclick: () => basculerId(id) }, svg(I.epingle), el('span', {}, 'Épingler au menu'));
    b.dataset.epId = id; b.dataset.epNom = nom ?? '';
    boutons.add(b); majBouton(b);
    if (statut === 'attente') charger();
    return b;
  }
  /** L'appli ouverte, marquée dans le menu ; « Plus » s'ouvre quand elle y est épinglée. */
  function marquer() {
    const ancre = document.getElementById('navEpingles'); if (!ancre) return;
    for (const b of ancre.querySelectorAll('.nav-ep-app')) { if (b.dataset.epApp === courant) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  }

  // ---------------- La liste complète (« Épingler une appli… »)
  let dlg = null, cherche = '';
  function peindreListe(focus) {
    if (!dlg) return;
    const l = dlg.querySelector('.ep-l'), q = cherche.trim().toLowerCase();
    const nb = nbApplis(etat.epingles);
    dlg.querySelector('.ep-c').textContent = `${nb} appli${nb > 1 ? 's' : ''} épinglée${nb > 1 ? 's' : ''} sur ${etat.max}.`;
    const ligne = (id, nom, ic) => {
      const oui = etat.epingles.includes(id);
      return el('li', { class: 'ep-r' }, ic, el('span', { class: 'ep-n' }, nom),
        oui ? el('button', { class: 'btn small', type: 'button', 'data-k': `${id}:h`, 'aria-label': `Monter ${nom}`, onclick: async () => { if (await deplacerId(id, -1)) peindreListe(`${id}:h`); } }, '↑') : null,
        oui ? el('button', { class: 'btn small', type: 'button', 'data-k': `${id}:b`, 'aria-label': `Descendre ${nom}`, onclick: async () => { if (await deplacerId(id, 1)) peindreListe(`${id}:b`); } }, '↓') : null,
        el('button', { class: 'btn small', type: 'button', 'data-k': `${id}:e`, 'aria-pressed': String(oui), onclick: async () => { dlg.querySelector('.ep-st').textContent = ''; if (await basculerId(id)) peindreListe(`${id}:e`); } }, oui ? 'Retirer' : 'Épingler'));
    };
    const vues = etat.proprietaire ? (etat.vues.length ? etat.vues.map((v) => v.id) : VUES).filter((v) => estVue(v) && (!q || nomVue(v).toLowerCase().includes(q))) : [];
    // Les épinglées d'abord, dans leur ordre ; puis les autres par nom.
    const rang = (id) => { const i = etat.epingles.indexOf(id); return i < 0 ? 1e9 : i; };
    const apps = modules.filter((m) => !q || m.name.toLowerCase().includes(q)).sort((a, b) => rang(`appli:${a.id}`) - rang(`appli:${b.id}`) || a.name.localeCompare(b.name, 'fr'));
    l.replaceChildren(...[
      vues.length ? el('h3', {}, 'Vues d\'Odin') : null, vues.length ? el('ul', {}, ...vues.sort((a, b) => rang(a) - rang(b)).map((v) => ligne(v, nomVue(v), el('span', { 'aria-hidden': 'true', style: 'width:28px' })))) : null,
      el('h3', {}, 'Applis'), apps.length ? el('ul', {}, ...apps.map((m) => ligne(`appli:${m.id}`, m.name, icone(m.id, m.name, 28)))) : el('p', { class: 'sub' }, 'Aucune appli.')].filter(Boolean));
    if (focus) l.querySelector(`[data-k="${CSS.escape(focus)}"]`)?.focus();
  }
  function ouvrirListe() {
    style(); fermerMenus();
    if (!dlg) {
      dlg = el('dialog', { class: 'ep-dlg', 'aria-labelledby': 'epT' });
      dlg.append(el('div', { class: 'ep-h' }, el('h2', { id: 'epT' }, 'Épingler dans le menu'), el('button', { class: 'btn small', type: 'button', onclick: () => dlg.close() }, 'Fermer')),
        el('p', { class: 'sub' }, 'Ce que tu épingles va dans « Plus », avec son icône. ', el('span', { class: 'ep-c' })),
        el('input', { type: 'search', 'aria-label': 'Chercher une appli', placeholder: 'Chercher une appli', oninput: (e) => { cherche = e.target.value; peindreListe(); } }),
        el('p', { class: 'ep-st', role: 'status' }), el('div', { class: 'ep-l' }));
      dlg.addEventListener('close', () => document.querySelector('#navEpingles .nav-ep-add')?.focus());
      document.body.append(dlg);
    }
    cherche = ''; dlg.querySelector('input[type=search]').value = ''; dlg.querySelector('.ep-st').textContent = '';
    peindreListe(); dlg.showModal();
  }

  function init() {
    style();
    dessiner(); // la tuile « Script » apparaît tout de suite, sans attendre la réponse d'Odin
    document.addEventListener('odin:appli', (e) => {
      courant = e.detail?.id ?? null; marquer();
      if (courant && estEpingle(`appli:${courant}`)) { const m = document.getElementById('navMore'); if (m?.hidden) document.getElementById('navMoreBtn')?.click(); }
    });
    document.addEventListener('odin:vue', (e) => {
      if (e.detail?.vue !== 'app') { courant = null; marquer(); }
      if (statut === 'attente') charger();
    });
    charger();
  }
  if (typeof document !== 'undefined' && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init(); }

  window.OdinEpingles = { bouton, estEpingle, ouvrir: ouvrirListe, recharger: charger, logique: { MAX, VUES, estVue, basculer, deplacer, nettoyer } };
})();
