// Genèse · clé USB — la PRÉSENTATION PARTAGÉE de la maquette validée « Démarrage réseau » (PXE), reprise telle quelle
// pour CHOISIR les systèmes / ISO / images à mettre sur la clé. C'est exactement l'écran de démarrage réseau validé
// (src/valhalla/thjalfi/ecran.ts + ecran-page.ts) : les trois DISPOSITIONS (éventail / affiches / liste), les 9
// THÈMES graphiques, les thèmes TEXTE, le classement par famille (Tout / Linux / Windows / Serveurs / Outils), les
// vignettes/affiches de systèmes, et le détail (Essayer · Installer · Installer pour moi). La mascotte d'Odin
// (window.OdinFace, yeux seuls) ouvre l'écran avec ses 3 points AVANT le menu, comme au vrai démarrage.
//
// Ce fichier NE réinvente rien : il reprend les mêmes fonctions pures (pretty / brand / category) et les mêmes
// libellés que la maquette, pour que choisir sur la clé RESSEMBLE au démarrage réseau. Le composeur de la clé
// (thjalfi-cle-composer.js) et l'aperçu s'en servent ; l'écran PXE (ecran-page.ts) n'est pas touché.
//
// Expose window.OdinEcranCartes = { logique, rendre, accueil, css } :
//   - logique : les fonctions PURES (pretty, brand, category, systemes, les constantes) essayées sans navigateur ;
//   - rendre  : le menu des systèmes dans le thème et la disposition choisis (nœud DOM), avec le détail ;
//   - accueil : l'écran d'amorçage (mascotte animée + 3 points) rendu AVANT le menu ;
//   - css     : le style de la maquette (thèmes, cartes), posé une fois.
(() => {
  'use strict';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };

  // ---------------------------------------------------------------------------
  // Logique PURE — reprise à l'identique d'ecran.ts (mêmes règles, mêmes libellés).
  // ---------------------------------------------------------------------------
  /** Les 9 thèmes graphiques de la maquette (clé → nom lisible). Identiques à ecran.ts THEMES. */
  const THEMES = { bleu: 'Bleu verre', matrix: 'Matrix', ocean: 'Voyage océan', lune: 'Lune', ciel: 'Ciel', galaxie: 'Galaxie', mayotte: 'Mayotte', couchant: 'Coucher de soleil', clair: 'Clair minimal' };
  /** Les 4 thèmes texte (menu GRUB / iPXE) + « classique ». Identiques à ecran.ts TEXT_THEMES. */
  const TEXT_THEMES = { matrix: 'Matrix', lune: 'Lune', aurore: 'Aurore boréale', neon: 'Néon', classique: 'Classique' };
  const DISPOSITIONS = ['eventail', 'affiches', 'liste'];
  const DISP = { eventail: 'Éventail', affiches: 'Affiches', liste: 'Liste' };
  const CATS = ['Tout', 'Linux', 'Windows', 'Serveurs', 'Outils'];
  const TINT = { bleu: 'rgba(11,20,64,.55)', matrix: 'rgba(0,0,0,.6)', ocean: 'rgba(3,40,80,.45)', lune: 'rgba(11,12,20,.5)', ciel: 'rgba(255,255,255,.35)', galaxie: 'rgba(7,5,26,.5)', mayotte: 'rgba(255,255,255,.3)', couchant: 'rgba(43,16,85,.45)', clair: 'rgba(246,247,251,.6)' };
  const themeOf = (x) => (x && Object.prototype.hasOwnProperty.call(THEMES, x)) ? x : ({ nuit: 'bleu', espace: 'galaxie', odin: 'bleu' }[x] || 'bleu');

  /** La famille d'un système, pour les onglets (identique à ecran.ts category). Pur. */
  function category(r, name) {
    const n = String(name || '').toLowerCase();
    if ((r && r.os === 'windows') || /windows|win1[01]|win2\d/.test(n)) return /server/.test(n) ? 'Serveurs' : 'Windows';
    if ((r && r.os === 'outil') || /clonezilla|gparted|memtest|rescue|hiren|systemrescue|shredos/.test(n)) return 'Outils';
    if (/server|proxmox|truenas|rocky|alma|rhel|centos|opnsense|pfsense/.test(n) || (r && r.kind === 'rhel')) return 'Serveurs';
    return 'Linux';
  }
  // Les marques (couleur + courte phrase), identiques à ecran.ts BRANDS.
  const BRANDS = [
    [/ubuntu.*server/, '#E95420', 'Ubuntu pour les serveurs : léger, sans bureau.'], [/ubuntu/, '#E95420', 'Le Linux le plus simple pour un ordinateur de bureau.'], [/windows/, '#0A6CD6', 'Pour les logiciels et les jeux Windows.'], [/debian/, '#C70036', 'Solide et stable, idéal pour un serveur.'],
    [/fedora/, '#3C6EB4', 'Les logiciels les plus récents, très propre.'], [/mint/, '#69B53F', 'Proche de Windows, très facile à prendre en main.'], [/proxmox/, '#E57000', 'Virtualisation : des machines et des conteneurs sur un serveur.'],
    [/rocky/, '#10B981', 'Serveur d\'entreprise, compatible Red Hat.'], [/alma/, '#0F4266', 'Serveur d\'entreprise, compatible Red Hat.'], [/truenas/, '#0095D5', 'Un stockage réseau (NAS) solide.'],
    [/arch/, '#1793D1', 'Pour qui aime tout régler soi-même.'], [/alpine/, '#0D597F', 'Minuscule et sûr, pour les petits serveurs.'], [/memtest/, '#7C3AED', 'Teste la mémoire du PC.'],
    [/clonezilla/, '#D4A017', 'Copie ou sauvegarde un disque entier.'], [/gparted/, '#4CAF50', 'Partitionne et répare les disques.'], [/kali/, '#367BF0', 'Outils de test de sécurité.'],
  ];
  function brand(name) {
    const n = String(name || '').toLowerCase(), b = BRANDS.find(([re]) => re.test(n));
    return b ? { color: b[1], blurb: b[2] } : { color: '#5B6CD6', blurb: 'Système prêt à démarrer.' };
  }
  /** Un nom lisible tiré du nom de l'ISO (identique à ecran.ts pretty). Pur. */
  function pretty(name) {
    const w = /win(?:dows)?[-_ ]?(1[01]|7|8)(?![\d.])/i.exec(name), ws = /windows[-_ ]?server[-_ ]?(20\d\d)/i.exec(name);
    if (ws) return { title: `Windows Server ${ws[1]}`, version: (/(\d\d[hH]\d)/.exec(name) || [])[1]?.toUpperCase() || '' };
    if (w) return { title: `Windows ${w[1]}`, version: (/(\d\d[hH]\d)/.exec(name) || [])[1]?.toUpperCase() || '' };
    const n = String(name || '').replace(/[_]+/g, '-'), v = (/(\d+(?:\.\d+){0,2})/.exec(n) || [])[1] || '';
    const words = n.replace(/\.iso$/i, '').replace(/\b(amd64|x86[-_]64|x64|arm64|aarch64|i386|i686|live|dvd|netinst|english|french|fr|en-us|fr-fr|multi)\b/gi, ' ').replace(/(\d+(?:\.\d+){0,2})/g, ' ').split(/[-\s]+/).filter(Boolean);
    const title = words.slice(0, 3).map((x) => (/^(lts|le|de|la)$/i.test(x) ? x.toUpperCase() : x.charAt(0).toUpperCase() + x.slice(1))).join(' ').replace(/\bLTS\b/i, '').trim();
    return { title: title || name, version: v };
  }
  /** La famille d'un système pour le choix côté clé (windows / linux), tirée de la catégorie. Pur. */
  const familleDe = (cat) => (cat === 'Windows' || cat === 'Serveurs' ? (cat === 'Windows' ? 'windows' : 'linux') : cat === 'Outils' ? 'linux' : 'linux');

  /**
   * Met une liste brute d'ISO / images en cartes prêtes pour le menu (mêmes champs que l'état de /ecran/etat).
   * Chaque entrée : { id, name, size?, recipe? } → { id, name, title, version, category, size, color, blurb, modes }.
   * Si on reçoit déjà des systèmes de /ecran/etat (déjà formés), on les garde tels quels. Pur.
   */
  function systemes(list) {
    return (Array.isArray(list) ? list : []).map((i) => {
      if (i && i.title && i.category && i.color) return i; // déjà formé par ecran.ts systems()
      const p = pretty(i.name || i.title || ''), b = brand(i.name || i.title || '');
      return { id: i.id || i.name, name: i.name || '', title: p.title, version: p.version, category: category(i.recipe, i.name || ''), size: Number(i.size) || 0, color: b.color, blurb: b.blurb, modes: Array.isArray(i.modes) ? i.modes : ['essai', 'installer'], deployed: i.deployed || 0 };
    });
  }
  const parCategorie = (sys, cat) => (sys || []).filter((x) => cat === 'Tout' || x.category === cat);

  // ---------------------------------------------------------------------------
  // Rendu — repris de la maquette (ecran-page.ts), au même aspect, sous le scope « .ec ».
  // ---------------------------------------------------------------------------
  const grad = (c) => `linear-gradient(160deg,${c},${c}99 55%,#0b1440)`;
  const gb = (b) => b >= 1e9 ? (b / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Go' : Math.max(1, Math.round((b || 0) / 1e6)) + ' Mo';
  const MODE = { essai: ['Essayer', 'Démarre sans rien toucher au disque.'], installer: ['Installer', 'Tu choisis le disque, le nom et les options.'], auto: ['Installer pour moi', 'Odin fait tout ; le disque est effacé : il te demande ton accord.'] };
  function badges(x) {
    return el('div', { class: 'ec-badges' },
      x.modes && x.modes.includes('essai') ? el('span', { class: 'live' }, 'LIVE') : null,
      x.modes && x.modes.includes('installer') ? el('span', {}, 'INSTALLER') : null,
      x.modes && x.modes.includes('auto') ? el('span', { class: 'auto' }, 'AUTO') : null);
  }

  // Le style de la maquette, repris d'ecran-page.ts, préfixé « .ec » pour ne pas déborder sur la page de Genèse.
  const CSS = `
.ec{--ink:#eef2ff;--mut:#9fb0d8;--card:rgba(20,28,64,.72);--line:rgba(255,255,255,.12);--acc:#ffd166;--accfg:#3a2a00;position:relative;border-radius:18px;overflow:hidden;color:var(--ink);padding:16px;background:#0b1440}
.ec.bleu{background:radial-gradient(1200px 700px at 50% 30%,#2a4bd1,#0b1440 70%);--acc:#ffffff;--accfg:#14204f}
.ec.matrix{background:#001a07;--ink:#b8ffca;--mut:#5fbf7a;--card:rgba(0,25,8,.78);--line:rgba(61,255,122,.35);--acc:#3dff7a;--accfg:#001a07;font-family:'DejaVu Sans Mono',Consolas,monospace}
.ec.ocean{background:linear-gradient(180deg,#2b8fd6,#0a4f8a 70%,#062b52)}
.ec.lune{background:radial-gradient(120% 120% at 70% 20%,#2a2d3e,#0b0c14);--acc:#f4f1e8;--accfg:#1a1c26}
.ec.ciel{background:linear-gradient(180deg,#4aa8ff,#9fd6ff 70%,#e6f5ff);--ink:#0b2a4a;--mut:#2f5a80;--card:rgba(255,255,255,.82);--line:rgba(11,42,74,.16);--acc:#0b2a4a;--accfg:#ffffff}
.ec.galaxie{background:radial-gradient(60vw 40vw at 30% 40%,rgba(160,60,255,.45),transparent 70%),radial-gradient(50vw 35vw at 75% 60%,rgba(255,60,170,.35),transparent 70%),#07051a;--acc:#c9a2ff;--accfg:#1a0a3d}
.ec.mayotte{background:linear-gradient(180deg,#26c6c6 45%,#0f8a83 70%,#d9c48a);--ink:#06323a;--mut:#24585f;--card:rgba(255,255,255,.72);--line:rgba(6,50,58,.18)}
.ec.couchant{background:linear-gradient(180deg,#2b1055,#7a1f6b 35%,#ff6a3d 62%,#ffb36b 63%,#3a1a4a);--acc:#ffd36b;--accfg:#3a1a00;--card:rgba(43,16,85,.62)}
.ec.clair{background:#f6f7fb;--ink:#141b2e;--mut:#56607a;--card:#fff;--line:#d8deea;--acc:#2457c5;--accfg:#ffffff}
.ec.img{background:#000 var(--ec-fond) center/cover no-repeat}
.ec .ec-tint{position:absolute;inset:0;pointer-events:none;display:none}.ec.img .ec-tint{display:block;background:var(--ec-tintc,rgba(5,10,30,.45))}
.ec-top{position:relative;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.ec-tabs,.ec-disp{display:flex;gap:2px;background:rgba(255,255,255,.1);border-radius:999px;padding:4px}
.ec-tabs button,.ec-disp button{border:0;background:none;color:var(--mut);border-radius:999px;padding:6px 13px;font:inherit;font-size:13px;cursor:pointer}
.ec-tabs button.on,.ec-disp button.on{background:#fff;color:#14204f;font-weight:600}
.ec-disp{margin-left:auto}
.ec-hint{position:relative;color:var(--mut);font-size:12.5px;margin:2px 0 10px}
.ec-fan{position:relative;height:300px;display:flex;align-items:center;justify-content:center;perspective:1200px}
.ec-fc{position:absolute;width:190px;height:250px;border-radius:20px;padding:16px;display:flex;flex-direction:column;justify-content:flex-end;gap:5px;transition:transform .35s,opacity .35s,box-shadow .35s;color:#fff;border:1px solid var(--line);overflow:hidden;cursor:pointer}
.ec-fc .ic{position:absolute;top:14px;left:14px;width:46px;height:46px;border-radius:13px;display:grid;place-items:center;font-size:22px;font-weight:800;background:rgba(255,255,255,.18)}
.ec-fc b{font-size:19px}.ec-fc small{opacity:.85}.ec-fc.on{box-shadow:0 0 0 3px var(--acc),0 24px 50px rgba(0,0,0,.5)}
.ec-badges{display:flex;gap:5px;flex-wrap:wrap}.ec-badges span{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.2)}.ec-badges .live{background:#34c77b}.ec-badges .auto{background:#ffd166;color:#3a2a00}
.ec-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;max-height:360px;overflow:auto;padding:2px}
.ec-po{aspect-ratio:3/4;border-radius:16px;padding:11px;display:flex;flex-direction:column;justify-content:space-between;color:#fff;cursor:pointer;position:relative;overflow:hidden;border:1px solid var(--line)}
.ec-po .big{position:absolute;right:-8px;top:8px;font-size:90px;font-weight:900;opacity:.15}.ec-po b{font-size:15px;text-transform:uppercase;line-height:1.1}.ec-po.on{box-shadow:0 0 0 3px var(--acc)}
.ec-list{display:flex;flex-direction:column;gap:9px;max-height:360px;overflow:auto;padding:2px}
.ec-row{display:flex;gap:14px;align-items:center;padding:11px 14px;border-radius:16px;background:var(--card);border:1px solid var(--line);cursor:pointer}.ec-row.on{box-shadow:0 0 0 2px var(--acc)}
.ec-row .lg{width:58px;height:58px;border-radius:13px;display:grid;place-items:center;font-size:26px;font-weight:800;color:#fff;flex:none}.ec-row b{font-size:16px}.ec-row small{color:var(--mut)}.ec-row .sp{flex:1;min-width:0}
.ec-detail{position:relative;display:grid;grid-template-columns:200px 1fr;gap:22px;align-items:end;margin-top:6px}.ec-detail .ec-po{cursor:default}.ec-detail h1{font-size:34px;margin:4px 0}.ec-detail .q{font-size:11px;letter-spacing:.14em;color:var(--mut)}
.ec-chips{display:flex;gap:7px;flex-wrap:wrap}.ec-chips span{font-size:11.5px;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.1)}
.ec-opts{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}
.ec-opt{border-radius:18px;padding:16px;background:var(--card);border:1px solid var(--line);cursor:pointer;color:var(--ink);font:inherit;text-align:left;display:flex;flex-direction:column;gap:7px;min-height:150px}.ec-opt.on{background:#fff;color:#14204f;box-shadow:0 0 0 3px var(--acc)}.ec-opt b{font-size:17px}.ec-opt small{opacity:.8}.ec-opt .k{margin-top:auto;align-self:flex-start;font-size:11px;padding:3px 8px;border-radius:7px;background:#14204f;color:#fff}.ec-opt[disabled]{opacity:.35;cursor:default}
.ec-back{position:relative;border:0;background:rgba(255,255,255,.14);color:var(--ink);border-radius:999px;padding:7px 14px;font:inherit;font-size:13px;cursor:pointer;margin-bottom:10px}
.ec-empty{position:relative;color:var(--mut);font-size:13px;padding:14px 2px}
/* L'amorçage : la mascotte (yeux seuls) + 3 points, AVANT le menu. */
.ec-accueil{position:relative;text-align:center;padding:26px 0}
.ec-accueil .face{width:120px;height:120px;margin:0 auto}
.ec-accueil .srv{color:var(--mut);font-size:13px;letter-spacing:.04em;margin-top:16px}
.ec-pts{display:inline-flex;gap:9px;margin-top:14px}.ec-pts i{width:11px;height:11px;border-radius:50%;background:var(--acc);opacity:.35;animation:ec-pt 1.2s ease-in-out infinite}.ec-pts i:nth-child(2){animation-delay:.2s}.ec-pts i:nth-child(3){animation-delay:.4s}
@keyframes ec-pt{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-5px)}}
.ec-odfige .o-orbit{transform-origin:60px 60px}.ec-odfige.anime .o1{animation:ec-orb 7s linear infinite}.ec-odfige.anime .o2{animation:ec-orb 9s linear infinite reverse}.ec-odfige.anime .o-body{transform-origin:60px 60px;animation:ec-souffle 3.4s ease-in-out infinite}
@keyframes ec-orb{to{transform:rotate(360deg)}}@keyframes ec-souffle{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
@media (prefers-reduced-motion:reduce){.ec-fc,.ec-pts i,.ec-odfige.anime .o1,.ec-odfige.anime .o2,.ec-odfige.anime .o-body{animation:none;transition:none}}
`;
  const styleUneFois = (() => { let fait = false; return () => { if (fait || typeof document === 'undefined') return; fait = true; if (document.getElementById && !document.getElementById('ecCartesCss')) (document.head || document.documentElement).append(el('style', { id: 'ecCartesCss' }, CSS)); }; })();

  // La mascotte d'Odin EN YEUX SEULS (deux pastilles blanches + deux halos), le dessin officiel figé d'ecrans-communs.
  // Jamais de bouche / sourcil / joue. Si window.OdinFace peut adopter un vrai visage de la page, on le fait (émotions).
  function faceSvg(anime) {
    const c = ['#2F6FE0', '#3F82F0', '#7EAEF8', '#C3DBFF'];
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'ec-odfige' + (anime ? ' anime' : ''));
    s.setAttribute('viewBox', '0 0 120 120'); s.setAttribute('focusable', 'false'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<defs>'
      + `<radialGradient id="ecBody" cx="50%" cy="46%" r="54%"><stop offset="0" stop-color="${c[0]}"/><stop offset=".5" stop-color="${c[1]}"/><stop offset=".82" stop-color="${c[2]}"/><stop offset="1" stop-color="${c[3]}"/></radialGradient>`
      + `<radialGradient id="ecHalo" cx="50%" cy="50%" r="50%"><stop offset=".8" stop-color="${c[3]}" stop-opacity=".65"/><stop offset=".93" stop-color="${c[3]}" stop-opacity=".38"/><stop offset="1" stop-color="${c[3]}" stop-opacity="0"/></radialGradient>`
      + '<radialGradient id="ecHalo2" cx="50%" cy="50%" r="50%"><stop offset=".8" stop-color="#FFFFFF" stop-opacity=".72"/><stop offset=".93" stop-color="#FFFFFF" stop-opacity=".4"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>'
      + '</defs>'
      + '<g class="o-orbit o1"><circle cx="63" cy="64" r="49" fill="url(#ecHalo)"/></g>'
      + '<g class="o-orbit o2"><circle cx="57.5" cy="57" r="48" fill="url(#ecHalo2)"/></g>'
      + '<g class="o-body"><circle cx="60" cy="60" r="44" fill="url(#ecBody)"/>'
      + '<g class="o-eyes"><rect x="43" y="45" width="9" height="22" rx="4.5" fill="#fff"/><rect x="68" y="45" width="9" height="22" rx="4.5" fill="#fff"/></g>'
      + '</g>';
    return s;
  }

  /**
   * L'écran d'AMORÇAGE : la mascotte animée (yeux seuls) + 3 points, AVANT les thèmes et le choix. opts :
   * { ligne: texte (« Installation clé USB »), onFini: appelé après le délai pour passer au menu, delai: ms }.
   */
  function accueil(opts) {
    const o = opts || {};
    styleUneFois();
    const face = el('span', { class: 'face odin', 'aria-hidden': 'true' });
    face.append(faceSvg(true));
    // Si la page a window.OdinFace (mascotte vivante), on l'adopte : elle gère émotions et clignements, sans la modifier.
    try { if (typeof window !== 'undefined' && window.OdinFace && window.OdinFace.own) window.OdinFace.own(face.firstChild); } catch { /* le dessin figé reste */ }
    const wrap = el('div', { class: 'ec-accueil' }, face, el('div', { class: 'ec-pts' }, el('i'), el('i'), el('i')), el('div', { class: 'srv' }, o.ligne || 'Odin prépare l\'écran…'));
    if (o.onFini && typeof setTimeout !== 'undefined') setTimeout(() => { try { o.onFini(); } catch { /* rien */ } }, o.delai || 1600);
    return wrap;
  }

  /**
   * Le MENU des systèmes dans la disposition et le thème choisis, avec le détail (Essayer · Installer · Installer pour
   * moi). opts : { systemes, theme, texte, disposition, cat, fond, onChoisir(sys,mode), onAccueil(bool) }.
   * onChoisir reçoit le système et le mode : c'est ce que la clé ajoute à sa composition.
   */
  function rendre(opts) {
    const o = opts || {};
    styleUneFois();
    const liste = systemes(o.systemes);
    const st = { cat: CATS.includes(o.cat) ? o.cat : 'Tout', disp: DISPOSITIONS.includes(o.disposition) ? o.disposition : 'eventail', theme: themeOf(o.theme), sel: 0, detail: null };
    const racine = el('div', { class: 'ec ' + st.theme + (o.fond ? ' img' : '') });
    if (o.fond) racine.style.setProperty('--ec-fond', `url(${o.fond})`);
    racine.style.setProperty('--ec-tintc', TINT[st.theme] || TINT.bleu);
    racine.append(el('div', { class: 'ec-tint' }));
    const corps = el('div', {});
    racine.append(corps);

    const vus = () => parCategorie(liste, st.cat);
    const choisir = (sys, mode) => { if (o.onChoisir) o.onChoisir(sys, mode); };

    function enTete() {
      return el('div', { class: 'ec-top' },
        el('div', { class: 'ec-tabs' }, ...CATS.map((c) => el('button', { class: c === st.cat ? 'on' : '', onclick: () => { st.cat = c; st.sel = 0; st.detail = null; dessiner(); } }, c))),
        el('div', { class: 'ec-disp' }, ...DISPOSITIONS.map((d) => el('button', { class: d === st.disp ? 'on' : '', onclick: () => { st.disp = d; dessiner(); } }, DISP[d]))));
    }
    function fan() {
      const l = vus(), f = el('div', { class: 'ec-fan' });
      l.forEach((x, i) => { const d = i - st.sel; if (Math.abs(d) > 3) return;
        f.append(el('div', { class: 'ec-fc' + (d === 0 ? ' on' : ''), style: `background:${grad(x.color)};transform:translateX(${d * 180}px) translateZ(${-Math.abs(d) * 120}px) rotateY(${-d * 14}deg) scale(${d === 0 ? 1.06 : .9});opacity:${1 - Math.abs(d) * .22};z-index:${10 - Math.abs(d)}`, onclick: () => { if (i === st.sel) { st.detail = x; } st.sel = i; dessiner(); } },
          el('span', { class: 'ic' }, (x.title || '?').charAt(0)), el('b', {}, x.title), el('small', {}, (x.version ? x.version + ' · ' : '') + gb(x.size)), badges(x)));
      });
      return f;
    }
    function posters() {
      return el('div', { class: 'ec-grid' }, ...vus().map((x, i) => el('div', { class: 'ec-po' + (i === st.sel ? ' on' : ''), style: `background:${grad(x.color)}`, onclick: () => { st.detail = x; st.sel = i; dessiner(); } },
        badges(x), el('span', { class: 'big' }, (x.title || '?').charAt(0)), el('div', {}, el('b', {}, x.title), el('small', {}, x.version)))));
    }
    function rows() {
      return el('div', { class: 'ec-list' }, ...vus().map((x, i) => el('div', { class: 'ec-row' + (i === st.sel ? ' on' : ''), onclick: () => { st.detail = x; st.sel = i; dessiner(); } },
        el('span', { class: 'lg', style: `background:${grad(x.color)}` }, (x.title || '?').charAt(0)),
        el('div', { class: 'sp' }, el('b', {}, x.title + ' '), el('small', {}, (x.version ? x.version + ' · ' : '') + x.category), el('div', {}, el('small', {}, x.blurb)), badges(x)),
        el('small', {}, gb(x.size) + (x.deployed ? ' · installé ' + x.deployed + ' fois ici' : '')), el('span', {}, '›'))));
    }
    function detail(x) {
      const modes = x.modes || ['essai', 'installer'];
      return el('div', {},
        el('button', { class: 'ec-back', onclick: () => { st.detail = null; dessiner(); } }, '← Retour aux systèmes'),
        el('div', { class: 'ec-detail' },
          el('div', { class: 'ec-po', style: `background:${grad(x.color)}` }, badges(x), el('span', { class: 'big' }, (x.title || '?').charAt(0)), el('div', {}, el('b', {}, x.title), el('small', {}, x.version))),
          el('div', {}, el('div', { class: 'q' }, 'QUE METTRE SUR LA CLÉ ?'), el('h1', {}, x.title + ' ' + (x.version || '')), el('p', {}, x.blurb),
            el('div', { class: 'ec-chips' }, el('span', {}, gb(x.size)), el('span', {}, 'vérifiée (empreinte et antivirus)'), x.deployed ? el('span', {}, 'installée ' + x.deployed + ' fois ici') : null))),
        el('div', { class: 'ec-opts' }, ...['essai', 'installer', 'auto'].map((k) => el('button', { class: 'ec-opt', disabled: !modes.includes(k) || undefined, onclick: () => choisir(x, k) },
          el('b', {}, MODE[k][0]), el('small', {}, MODE[k][1]), el('span', { class: 'k' }, k === 'essai' ? 'Essayer' : k === 'auto' ? 'Pour moi' : 'Installer')))));
    }
    function dessiner() {
      const l = vus();
      if (st.sel >= l.length) st.sel = Math.max(0, l.length - 1);
      const kids = [enTete()];
      if (!l.length) { kids.push(el('p', { class: 'ec-empty' }, 'Aucun système dans cette famille. Dépose des ISO dans la bibliothèque d\'Odin, ou ajoute un système à la main.')); corps.replaceChildren(...kids); return; }
      if (st.detail) { kids.push(detail(st.detail)); corps.replaceChildren(...kids); return; }
      kids.push(el('div', { class: 'ec-hint' }, `${st.cat} · ${l.length} système${l.length > 1 ? 's' : ''} · tout est vérifié par Odin`));
      kids.push(st.disp === 'affiches' ? posters() : st.disp === 'liste' ? rows() : fan());
      corps.replaceChildren(...kids);
    }
    dessiner();
    return racine;
  }

  if (typeof window !== 'undefined') {
    window.OdinEcranCartes = {
      css: CSS,
      logique: { THEMES, TEXT_THEMES, DISPOSITIONS, DISP, CATS, TINT, themeOf, category, brand, pretty, systemes, parCategorie, familleDe, BRANDS },
      rendre,
      accueil,
    };
  }
})();
