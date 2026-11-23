// Genèse · Réseau → sous-onglet « Menu PXE » (maquette validée « Genèse · Systèmes », lot S9) : ce que voit un PC qui
// démarre par le réseau.
//   - les systèmes dans l'ordre du menu : flèches « Monter » / « Descendre » sur chaque ligne, et au clavier Alt + ↑ / ↓
//     sur la ligne (le focus suit le système déplacé) ;
//   - cacher ou montrer chaque système (un interrupteur) : il reste dans ta bibliothèque ;
//   - ★ l'entrée par défaut, qui démarre seule au bout du délai : le disque du PC (conseillé), l'écran d'Odin, ou un système
//     qui ne fait qu'essayer. Une entrée qui installe ou peut effacer ne peut pas l'être (★ éteinte, la raison écrite) ;
//   - le délai, la disposition du menu graphique ;
//   - l'APERÇU : le menu tel que le PC le verra, relu par Odin dans le vrai script écrit pour un PC inconnu (lecture
//     « menu_pxe » avec le brouillon), jamais recomposé ici.
// Les changements restent un brouillon jusqu'à « Enregistrer » (action « menu_pxe_regler », propriétaire seul, revérifiée
// par Odin) ; « Annuler » reprend ce qui est enregistré. Un nom de système est toujours écrit comme du texte.
// Expose window.OdinGeneseMenuPxe = { dessiner(root, hote), MOTS, etat }.
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    titre: 'Le menu PXE',
    lead: 'Ce que propose l\'écran d\'un PC qui démarre par le réseau, dans cet ordre. Seuls les systèmes vérifiés de ta bibliothèque.',
    groupe: 'Systèmes du menu', monter: 'Monter {nom}', descendre: 'Descendre {nom}', proposer: 'Proposer {nom}', defaut: 'Par défaut : {nom}',
    'sous.essai': 'Essayer ou installer', 'sous.essaiSeul': 'Essayer · rien n\'est installé', 'sous.outil': 'Outil · démarre seulement', 'sous.installe': 'Installer',
    'sous.cache': 'Caché du menu', 'sous.jamais': 'jamais par défaut',
    'disque.nom': 'Démarrer sur le disque du PC', 'disque.sous': 'Toujours proposé, en dernier',
    'ecran.nom': 'Choisir sur l\'écran d\'Odin', 'ecran.sous': 'Sur le PC en graphique, ou sur un téléphone du réseau',
    vide: 'Aucun système prêt à démarrer par le réseau dans ta bibliothèque pour l\'instant : le menu propose le disque du PC.',
    delai: 'Sans choix, démarrer le défaut après', 'delai.s': '{n} secondes', 'delai.0': 'jamais (attendre)',
    disposition: 'Disposition du menu graphique', 'disp.eventail': 'Éventail', 'disp.affiches': 'Affiches', 'disp.liste': 'Liste',
    note: '★ = démarre tout seul après le délai. Conseillé : le disque du PC, pour qu\'un PC branché par erreur ne parte jamais sur une installation.',
    'note.installe': 'Un système qui s\'installe, ou une image inconnue (on ne sait pas ce qu\'elle fait), ne démarre jamais tout seul. Pour installer sur un PC précis : « Déployer ».',
    'note.clavier': 'Au clavier : Alt + ↑ ou ↓ sur une ligne la déplace.',
    deplace: '{nom} : {rang} sur {total}.',
    enregistrer: 'Enregistrer', annuler: 'Annuler', modifie: 'Pas encore enregistré.',
    voirEcran: 'Voir l\'écran de démarrage', apparence: 'Apparence des clés',
    'apercu.titre': 'Aperçu : ce que voit un PC', 'apercu.lead': 'Le menu texte écrit par Odin pour un PC qui n\'est pas autorisé.',
    'apercu.dans': '{nom} démarre dans {n} s', 'apercu.attend': 'Le PC attend un choix', 'apercu.touches': '↑ ↓ choisir · Entrée démarrer',
    'apercu.brouillon': 'Aperçu du brouillon.',
    'disque.court': 'Disque du PC', 'ecran.court': 'Écran d\'Odin',
    'defaut.refuse': 'Le défaut enregistré avant n\'est pas suivi : {raison}. La ★ montre ce qui démarre à sa place.',
    charge: 'Odin lit le menu…', erreur: 'Le menu ne peut pas être lu : {raison}', annule: 'Annulé.',
  };
  const mot = (k, v = {}) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => (v[x] == null ? '' : String(v[x])));

  // ---------------------------------------------------------------- le dessin
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  };
  const P = {
    up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
    power: 'M12 3v8M7.5 6.5a7 7 0 1 0 9 0', monitor: 'M3 4h18v12H3zM8 20h8M12 16v4', key: 'M14 10a4 4 0 1 0-4 4M10 14l-6 6M7 17l2 2',
    phone: 'M7 2h10v20H7zM11 18h2',
  };
  const svg = (inner, s) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = inner; return v; };
  const ic = (n, s = 18, plein = false) => svg(`<path d="${P[n]}" fill="${plein ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`, s);
  const couleur = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '#5b6cd6');

  const CSS = `
.mp{display:flex;flex-direction:column;gap:14px;min-width:0}
.mp-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow,none);padding:18px;min-width:0}
.mp-card>h4{margin:0 0 4px;font-size:17px;letter-spacing:-.01em}
.mp-lead{margin:0 0 12px;color:var(--muted);font-size:13px}.mp-note{margin:8px 0 0;color:var(--muted);font-size:12.5px}
.mp-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.mp-e{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--line);border-radius:14px;min-width:0;background:var(--panel)}
.mp-e.def{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 22%,transparent)}
.mp-e.off .mp-nm,.mp-e.off .mp-lg{opacity:.55}
.mp-e:focus-within{outline:2px solid color-mix(in srgb,var(--accent) 55%,transparent);outline-offset:1px}
.mp-ord{display:flex;gap:4px;flex:none}
.mp-ib{width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);display:grid;place-items:center;cursor:pointer;flex:none;padding:0}
.mp-ib:disabled{opacity:.35;cursor:not-allowed}
.mp-ib[aria-pressed=true]{color:var(--accent);border-color:var(--accent)}
.mp-lg{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:14px;flex:none}
.mp-nm{flex:1;min-width:0}.mp-nm b{display:block;font-size:14.5px;overflow-wrap:anywhere}.mp-nm small{display:block;font-size:12.5px;color:var(--muted);overflow-wrap:anywhere}
.mp-sw{flex:none;position:relative;width:60px;min-height:44px;border:0;background:none;padding:0;cursor:pointer;color:inherit}
.mp-sw::before{content:"";position:absolute;left:2px;right:2px;top:6px;bottom:6px;border-radius:999px;border:1px solid var(--line);background:color-mix(in srgb,var(--ink) 14%,var(--panel))}
.mp-sw span{position:absolute;top:10px;left:7px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .15s}
.mp-sw[aria-checked=true]::before{background:var(--good);border-color:var(--good)}.mp-sw[aria-checked=true] span{left:29px}
.mp-fix{width:44px;flex:none}
.mp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px}
.mp-field{display:flex;flex-direction:column;gap:6px;min-width:0}.mp-field>label,.mp-field>span{font-size:13px;font-weight:600}
.mp-in{min-height:44px;border:1px solid var(--line);border-radius:12px;padding:0 12px;background:var(--panel);color:var(--ink);font:inherit;font-size:14px;min-width:0;width:100%;box-sizing:border-box}
.mp-seg{display:flex;gap:6px;flex-wrap:wrap}
.mp-seg button{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;font-weight:600;font-size:13.5px;cursor:pointer}
.mp-seg button[aria-pressed=true]{background:color-mix(in srgb,var(--accent) 14%,var(--panel));border-color:var(--accent)}
.mp-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px}
.mp-btn{min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;font-weight:600;font-size:14px;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer}
.mp-btn.pri{background:var(--accent);color:var(--on-accent,#fff);border-color:transparent}.mp-btn:disabled{opacity:.45;cursor:not-allowed}
.mp-msg{margin:0;font-size:13px;color:var(--muted)}.mp-msg:empty{display:none}.mp-msg.ko{color:var(--bad);font-weight:600}.mp-msg.ok{color:var(--good);font-weight:600}
.mp-ecr{border-radius:14px;padding:14px 16px;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-x:auto;min-width:0;border:1px solid #1f2933}
.mp-ecr ol{list-style:none;margin:8px 0;padding:0}.mp-ecr li{padding:0 8px;white-space:pre;min-height:1.6em}
.mp-ecr .t{font-weight:700;white-space:pre-wrap;overflow-wrap:anywhere}.mp-ecr .pied{white-space:pre-wrap;margin-top:6px}
@media (max-width:640px){.mp-card{padding:14px}.mp-ord{flex-direction:column}.mp-lg{display:none}.mp-grid{grid-template-columns:minmax(0,1fr)}.mp-e{gap:8px}.mp-ecr{font-size:11.5px;padding:12px}}
@media (prefers-reduced-motion:reduce){.mp-sw span{transition:none}}
`;

  // ---------------------------------------------------------------- l'état
  const Z = { wrap: null, d: null, b: null, etat: 'rien', raison: '', occupe: false, modifie: false, msg: '', msgGenre: '', annonce: '', apercuDe: 0 };
  let H = null;
  const montrer = (texte, genre = '') => { Z.msg = texte || ''; Z.msgGenre = genre; const m = Z.wrap && Z.wrap.querySelector('[data-f="mp-msg"]'); if (m) { m.textContent = Z.msg; m.className = `mp-msg${genre ? ` ${genre}` : ''}`; } };
  /** Le brouillon repris de ce qui est enregistré. */
  const depuis = (d) => ({ ordre: (d.entrees || []).map((e) => e.id), caches: (d.entrees || []).filter((e) => e.cache).map((e) => e.id), defaut: d.defaut || 'disque', delai: Number(d.delai) || 0, disposition: d.disposition || 'eventail' });
  const entree = (id) => ((Z.d && Z.d.entrees) || []).find((e) => e.id === id);
  const envoi = () => ({ ordre: JSON.stringify(Z.b.ordre), caches: JSON.stringify(Z.b.caches), defaut: Z.b.defaut, delai: Z.b.delai });
  /**
   * Seulement ce que tu as changé ici depuis la lecture : un réglage fait ailleurs entre-temps (l'écran d'Odin par défaut,
   * le délai, la disposition…) n'est pas écrasé, et cacher un système ne fige pas l'ordre « par famille ».
   */
  function changements() {
    const o = depuis(Z.d), b = Z.b, out = {}, meme = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    if (!meme(b.ordre, o.ordre)) out.ordre = JSON.stringify(b.ordre);
    if (!meme([...b.caches].sort(), [...o.caches].sort())) out.caches = JSON.stringify(b.caches);
    if (b.defaut !== o.defaut) out.defaut = b.defaut;
    if (b.delai !== o.delai) out.delai = b.delai;
    if (b.disposition !== o.disposition) out.disposition = b.disposition;
    return out;
  }
  /** Le focus va au message (après « Enregistrer » ou « Annuler », le bouton touché est redessiné éteint). */
  const focusMessage = () => { const m = Z.wrap && Z.wrap.querySelector('[data-f="mp-msg"]'); if (m && m.focus) m.focus(); };

  async function lire() {
    try {
      const r = await H.post('menu_pxe', {});
      if (r && r.ok !== false && r.data) { Z.d = r.data; Z.b = depuis(r.data); Z.modifie = false; Z.etat = 'ok'; } else { Z.etat = 'erreur'; Z.raison = (r && r.text) || '?'; }
    } catch (e) { Z.etat = 'erreur'; Z.raison = (e && e.message) || '?'; }
  }
  /** L'aperçu du brouillon, écrit par Odin (le dernier demandé gagne). */
  async function rafraichirApercu() {
    const n = ++Z.apercuDe;
    let r; try { r = await H.post('menu_pxe', envoi()); } catch { return; }
    if (n !== Z.apercuDe || !r || r.ok === false || !r.data || !Z.d) return;
    Z.d.apercu = r.data.apercu; Z.d.couleurs = r.data.couleurs || Z.d.couleurs;
    const a = Z.wrap && Z.wrap.querySelector('[data-f="mp-apercu"]');
    if (a && a.replaceWith) a.replaceWith(apercu());
  }
  /** Le brouillon a changé : la liste est redessinée ici, l'aperçu redemandé à Odin. */
  function change(focus) {
    Z.modifie = true;
    dessinerTout(focus);
    void rafraichirApercu();
  }

  // ---------------------------------------------------------------- les lignes
  function deplacer(id, sens, quoi) {
    const a = Z.b.ordre, i = a.indexOf(id), j = i + sens;
    if (i < 0 || j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    const e = entree(id);
    Z.annonce = mot('deplace', { nom: e ? `${e.titre || e.nom}${e.version ? ` ${e.version}` : ''}` : id, rang: j + 1, total: a.length });
    change({ id, quoi: quoi === 'up' && j === 0 ? 'down' : quoi === 'down' && j === a.length - 1 ? 'up' : quoi });
  }
  function sousTitre(e, off) {
    if (off) return mot('sous.cache');
    const m = e.modes || [];
    const base = e.famille === 'Outils' ? mot('sous.outil') : m.indexOf('essai') >= 0 && (m.indexOf('installer') >= 0 || m.indexOf('auto') >= 0) ? mot('sous.essai') : m.indexOf('essai') >= 0 ? mot('sous.essaiSeul') : mot('sous.installe');
    return e.installe ? `${base} · ${mot('sous.jamais')}` : base;
  }
  function ligne(e, i, total) {
    const off = Z.b.caches.indexOf(e.id) >= 0, def = Z.b.defaut === e.id, nom = `${e.titre || e.nom}${e.version ? ` ${e.version}` : ''}`;
    const li = el('li', { class: `mp-e${def ? ' def' : ''}${off ? ' off' : ''}`, 'data-id': e.id, 'data-f': 'entree',
      onkeydown: (ev) => {
        if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
        if (ev.preventDefault) ev.preventDefault();
        const f = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-quoi') : '';
        deplacer(e.id, ev.key === 'ArrowUp' ? -1 : 1, f || 'up');
      } },
      el('span', { class: 'mp-ord' },
        el('button', { type: 'button', class: 'mp-ib', 'aria-label': mot('monter', { nom }), 'data-quoi': 'up', 'data-f': 'monter', disabled: i === 0, onclick: () => deplacer(e.id, -1, 'up') }, ic('up', 16)),
        el('button', { type: 'button', class: 'mp-ib', 'aria-label': mot('descendre', { nom }), 'data-quoi': 'down', 'data-f': 'descendre', disabled: i === total - 1, onclick: () => deplacer(e.id, 1, 'down') }, ic('down', 16))),
      el('span', { class: 'mp-lg', style: `background:${couleur(e.couleur)}`, 'aria-hidden': 'true' }, String(e.titre || e.nom || '?').charAt(0).toUpperCase()),
      el('span', { class: 'mp-nm' }, el('b', {}, nom), el('small', {}, sousTitre(e, off))),
      el('button', { type: 'button', class: 'mp-ib', 'aria-pressed': String(def), 'aria-label': mot('defaut', { nom }), 'data-quoi': 'star', 'data-f': 'etoile', disabled: e.installe || off,
        onclick: () => { if (Z.b.defaut !== e.id) { Z.b.defaut = e.id; change({ id: e.id, quoi: 'star' }); } } }, ic('star', 18, def)),
      el('button', { type: 'button', class: 'mp-sw', role: 'switch', 'aria-checked': String(!off), 'aria-label': mot('proposer', { nom }), 'data-quoi': 'sw', 'data-f': 'proposer',
        onclick: () => {
          const k = Z.b.caches.indexOf(e.id);
          if (k >= 0) Z.b.caches.splice(k, 1); else { Z.b.caches.push(e.id); if (Z.b.defaut === e.id) Z.b.defaut = 'disque'; }
          change({ id: e.id, quoi: 'sw' });
        } }, el('span')));
    return li;
  }
  function ligneFixe(id, nom, sous, icone) {
    const def = Z.b.defaut === id;
    return el('li', { class: `mp-e${def ? ' def' : ''}`, 'data-id': id, 'data-f': `fixe-${id}` },
      el('span', { class: 'mp-lg', style: 'background:#4b5563', 'aria-hidden': 'true' }, ic(icone, 18)),
      el('span', { class: 'mp-nm' }, el('b', {}, nom), el('small', {}, sous)),
      el('button', { type: 'button', class: 'mp-ib', 'aria-pressed': String(def), 'aria-label': mot('defaut', { nom }), 'data-quoi': 'star', 'data-f': 'etoile',
        onclick: () => { if (Z.b.defaut !== id) { Z.b.defaut = id; change({ id, quoi: 'star' }); } } }, ic('star', 18, def)),
      el('span', { class: 'mp-fix', 'aria-hidden': 'true' }));
  }

  // ---------------------------------------------------------------- les sections
  function menuCarte(d) {
    const l = Z.b.ordre.map(entree).filter(Boolean);
    const liste = el('ul', { class: 'mp-list', 'aria-label': mot('groupe'), 'data-f': 'mp-liste' },
      d.ecran ? ligneFixe('ecran', mot('ecran.nom'), mot('ecran.sous'), 'phone') : null,
      ...l.map((e, i) => ligne(e, i, l.length)),
      ligneFixe('disque', mot('disque.nom'), mot('disque.sous'), 'power'));
    const valeurs = [0, 5, 10, 30, 60].concat([5, 10, 30, 60, 0].indexOf(Z.b.delai) < 0 ? [Z.b.delai] : []).sort((a, b) => (a || 1e9) - (b || 1e9));
    const delai = el('select', { id: 'mp-delai', class: 'mp-in', 'data-f': 'delai', onchange: (ev) => { Z.b.delai = Number(ev.target.value) || 0; change({ id: '', quoi: 'delai' }); } },
      ...valeurs.map((v) => el('option', { value: String(v), selected: Z.b.delai === v }, v ? mot('delai.s', { n: v }) : mot('delai.0'))));
    const disp = el('div', { class: 'mp-seg', role: 'group', 'aria-labelledby': 'mp-l-disp' }, ...(d.dispositions || ['eventail', 'affiches', 'liste']).map((k) =>
      el('button', { type: 'button', 'aria-pressed': String(Z.b.disposition === k), 'data-disp': k, onclick: () => { if (Z.b.disposition !== k) { Z.b.disposition = k; Z.modifie = true; dessinerTout({ id: '', quoi: `disp-${k}` }); } } }, mot(`disp.${k}`))));
    const aller = (id) => (H && H.aller ? () => H.aller(id) : null);
    return el('section', { class: 'mp-card', 'data-f': 'mp-menu' }, el('h4', {}, mot('titre')), el('p', { class: 'mp-lead' }, mot('lead')),
      l.length ? null : el('p', { class: 'mp-note', 'data-f': 'mp-vide' }, mot('vide')),
      liste,
      el('p', { class: 'mp-note', role: 'status', 'aria-live': 'polite', 'data-f': 'mp-annonce' }, Z.annonce),
      el('div', { class: 'mp-grid' },
        el('div', { class: 'mp-field' }, el('label', { for: 'mp-delai' }, mot('delai')), delai),
        el('div', { class: 'mp-field' }, el('span', { id: 'mp-l-disp' }, mot('disposition')), disp)),
      el('p', { class: 'mp-note' }, mot('note')),
      l.some((e) => e.installe) ? el('p', { class: 'mp-note', 'data-f': 'mp-note-installe' }, mot('note.installe')) : null,
      d.defautRefuse ? el('p', { class: 'mp-note', 'data-f': 'mp-defaut-refuse' }, mot('defaut.refuse', { raison: String(d.defautRefuse).replace(/[.\s]+$/, '') })) : null,
      el('p', { class: 'mp-note' }, mot('note.clavier')),
      el('div', { class: 'mp-row' },
        el('button', { type: 'button', class: 'mp-btn pri', 'data-f': 'enregistrer', disabled: Z.occupe || !Z.modifie, onclick: enregistrer }, mot('enregistrer')),
        el('button', { type: 'button', class: 'mp-btn', 'data-f': 'annuler', disabled: Z.occupe || !Z.modifie, onclick: () => { Z.b = depuis(Z.d); Z.modifie = false; Z.annonce = ''; montrer(mot('annule')); dessinerTout(); focusMessage(); void rafraichirApercu(); } }, mot('annuler')),
        Z.modifie ? el('span', { class: 'mp-note', style: 'margin:0', 'data-f': 'mp-modifie' }, mot('modifie')) : null),
      el('div', { class: 'mp-row' },
        aller('ecran') ? el('button', { type: 'button', class: 'mp-btn', 'data-f': 'voir-ecran', onclick: aller('ecran') }, ic('monitor'), mot('voirEcran')) : null,
        aller('cle') && W.OdinGeneseCle ? el('button', { type: 'button', class: 'mp-btn', 'data-f': 'apparence-cles', onclick: aller('cle') }, ic('key'), mot('apparence')) : null));
  }
  function apercu() {
    const d = Z.d || {}, a = d.apercu || { titre: '', lignes: [], defaut: 'local', delai: 0 }, c = d.couleurs || { fond: '#05080c', texte: '#d0d0d0', titre: '#ffffff', trait: '#00aaaa', choix: '#0000aa', choixTexte: '#ffffff' };
    const ok = (x, y) => (/^#[0-9a-f]{3,8}$/i.test(String(x || '')) ? x : y);
    const nomDef = a.defaut === 'local' ? mot('disque.court') : a.defaut === 'ecran' ? mot('ecran.court') : ((entree(a.defaut) || {}).nom || a.defaut);
    return el('section', { class: 'mp-card', 'data-f': 'mp-apercu' }, el('h4', {}, mot('apercu.titre')), el('p', { class: 'mp-lead' }, mot('apercu.lead'), Z.modifie ? ` ${mot('apercu.brouillon')}` : ''),
      el('div', { class: 'mp-ecr', tabindex: '0', role: 'group', 'aria-label': mot('apercu.titre'), style: `background:${ok(c.fond, '#05080c')};color:${ok(c.texte, '#d0d0d0')}` },
        el('div', { class: 't', style: `color:${ok(c.titre, '#fff')}` }, a.titre || ''),
        el('ol', { 'data-f': 'mp-lignes' }, ...(a.lignes || []).map((l) => (l.gap
          ? el('li', { style: `color:${ok(c.trait, '#0aa')}`, 'aria-hidden': l.texte ? null : 'true' }, l.texte || ' ')
          : el('li', { 'data-id': l.id, 'data-defaut': l.id === a.defaut ? '1' : null, style: l.id === a.defaut ? `background:${ok(c.choix, '#00a')};color:${ok(c.choixTexte, '#fff')}` : '' }, l.texte)))),
        el('div', { class: 'pied', style: `color:${ok(c.trait, '#0aa')}`, 'data-f': 'mp-pied' }, `${a.delai ? mot('apercu.dans', { nom: nomDef, n: a.delai }) : mot('apercu.attend')}   ${mot('apercu.touches')}`)));
  }

  async function enregistrer() {
    if (Z.occupe || !Z.b) return;
    Z.occupe = true; dessinerTout();
    let r;
    try { r = await (H.act || H.post)('menu_pxe_regler', changements()); } catch (e) { r = { ok: false, text: (e && e.message) || '?' }; }
    Z.occupe = false;
    if (r && r.ok !== false) { await lire(); Z.annonce = ''; }
    if (r && r.ok === false && r.text === 'Annulé.') montrer(mot('annule'));
    else montrer((r && r.text) || '', r && r.ok === false ? 'ko' : 'ok');
    if (H.note) H.note(r);
    dessinerTout();
    focusMessage();
  }

  function dessinerTout(focus) {
    const w = Z.wrap; if (!w) return;
    if (Z.etat === 'rien') { w.replaceChildren(el('p', { class: 'mp-note' }, mot('charge'))); return; }
    if (Z.etat === 'erreur') { w.replaceChildren(el('p', { class: 'mp-msg ko', role: 'alert', 'data-f': 'mp-erreur' }, mot('erreur', { raison: Z.raison }))); return; }
    const msg = el('p', { class: `mp-msg${Z.msgGenre ? ` ${Z.msgGenre}` : ''}`, 'data-f': 'mp-msg', role: 'status', 'aria-live': 'polite', tabindex: '-1' }, Z.msg);
    w.replaceChildren(msg, menuCarte(Z.d), apercu());
    // Le focus suit ce qu'on vient de toucher (le système déplacé garde sa flèche, même au clavier).
    if (focus && focus.quoi) {
      const ligneVue = focus.id ? w.querySelector(`[data-id="${focus.id}"]`) : w;
      const sel = focus.quoi === 'up' ? '[data-quoi="up"]' : focus.quoi === 'down' ? '[data-quoi="down"]' : focus.quoi === 'star' ? '[data-quoi="star"]' : focus.quoi === 'sw' ? '[data-quoi="sw"]' : focus.quoi === 'delai' ? '#mp-delai' : focus.quoi.startsWith('disp-') ? `[data-disp="${focus.quoi.slice(5)}"]` : '';
      let n = ligneVue && sel ? ligneVue.querySelector(sel) : null;
      if (n && n.disabled && ligneVue) n = ligneVue.querySelector(focus.quoi === 'up' ? '[data-quoi="down"]' : '[data-quoi="up"]');
      if (n && n.focus) n.focus();
    }
  }

  /** Monte le sous-onglet dans root. hote : { post, act, note, aller(onglet) } (la page de Genèse). */
  async function dessiner(root, hote) {
    if (typeof document !== 'undefined' && document.head && !(document.getElementById && document.getElementById('mpCss'))) document.head.append(el('style', { id: 'mpCss' }, CSS));
    H = { post: hote && hote.post, act: hote && hote.act, note: hote && hote.note, aller: hote && hote.aller };
    const wrap = el('div', { class: 'mp', 'data-f': 'menu-pxe' });
    root.append(wrap);
    Z.wrap = wrap; Z.etat = 'rien'; Z.msg = ''; Z.msgGenre = ''; Z.annonce = ''; Z.modifie = false;
    dessinerTout();
    await lire();
    if (Z.wrap === wrap) dessinerTout();
  }

  W.OdinGeneseMenuPxe = { dessiner, MOTS, etat: Z };
})();
