// Genèse · clé USB — l'APERÇU du MENU DE DÉMARRAGE dans la page. Au démarrage de la clé/du disque, un menu liste
// TOUS les systèmes : les ISO et disques virtuels (par Ventoy), les systèmes installés (Windows To Go, Linux
// persistant / installé), les VM copiées, et les fichiers déposés à la racine (reconnus tout seuls). Cet aperçu
// sert à VÉRIFIER, avant d'écrire, que jusqu'à 20 entrées ou plus restent lisibles : familles, défilement,
// recherche quand il y en a beaucoup, système par défaut qui démarre seul après le délai.
//
// Expose window.OdinGeneseCleMenu = { construire(entrees, opts) -> nœud, ouvrir(entrees, opts), logique } :
//   - construire : le menu rendu en nœud (essayé sur un faux document) ;
//   - ouvrir : le même menu dans un calque par-dessus la page (jamais une fenêtre native) ;
//   - logique : grouper, filtrer, la démo à 20+ entrées, l'info par genre — PURES, essayées sans navigateur.
(() => {
  'use strict';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };

  // ---------------------------------------------------------------------------
  // Logique PURE.
  // ---------------------------------------------------------------------------
  /** L'info d'affichage par genre d'entrée. Pur. */
  const INFO = {
    iso: { libelle: 'ISO', demarrable: true },
    installe: { libelle: 'Installé', demarrable: true },
    persistance: { libelle: 'Persistant', demarrable: true },
    vm: { libelle: 'VM', demarrable: true },
    racine: { libelle: 'Déposé', demarrable: true },
    'non-demarrable': { libelle: 'Non démarrable', demarrable: false },
  };
  const info = (genre) => INFO[genre] || INFO['non-demarrable'];

  const ORDRE_FAM = ['windows', 'linux', 'macos', 'autre', 'inconnu'];
  const NOM_FAM = { windows: 'Windows', linux: 'Linux', macos: 'macOS', autre: 'Autres', inconnu: 'Divers' };

  /** Range les entrées par famille, dans un ordre stable ; les non-démarrables à part. Pur. */
  function grouper(entrees) {
    const demarrables = (entrees || []).filter((e) => e.demarrable !== false);
    const apart = (entrees || []).filter((e) => e.demarrable === false);
    const fams = new Map();
    for (const e of demarrables) { const f = NOM_FAM[e.famille] ? e.famille : 'inconnu'; if (!fams.has(f)) fams.set(f, []); fams.get(f).push(e); }
    const groupes = [...fams.keys()].sort((a, b) => ORDRE_FAM.indexOf(a) - ORDRE_FAM.indexOf(b)).map((f) => ({ famille: f, nom: NOM_FAM[f], entrees: fams.get(f) }));
    return { groupes, apart };
  }

  /** Filtre les entrées par un texte (nom, type, famille). Pur. */
  function filtrer(entrees, q) {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return entrees || [];
    return (entrees || []).filter((e) => `${e.nom} ${e.type || ''} ${e.famille || ''}`.toLowerCase().includes(s));
  }

  /** Une démo d'entrées (par défaut 24) pour vérifier la lisibilité à 20+. Pur. */
  function demo(n) {
    const total = n || 24;
    const modeles = [
      ['Windows 11 (installé)', 'installe', 'windows', 'Système installé'],
      ['Windows 10 (ISO)', 'iso', 'windows', 'ISO (démarrer / installer)'],
      ['Ubuntu 24.04 (persistant)', 'persistance', 'linux', 'Live persistant'],
      ['Debian 12 (installé)', 'installe', 'linux', 'Système installé'],
      ['Fedora 40 (ISO)', 'iso', 'linux', 'ISO (démarrer / installer)'],
      ['VM Serveur (Proxmox)', 'vm', 'linux', 'VM qui démarre'],
      ['GParted (ISO)', 'iso', 'autre', 'ISO (démarrer / installer)'],
      ['image-disque.img', 'racine', 'inconnu', 'Fichier déposé'],
    ];
    const out = [];
    for (let i = 0; i < total; i += 1) { const m = modeles[i % modeles.length]; out.push({ nom: `${m[0]} #${i + 1}`, genre: m[1], famille: m[2], type: m[3], demarrable: true, defaut: i === 0 }); }
    out.push({ nom: 'notes.txt', genre: 'non-demarrable', famille: 'inconnu', type: 'Fichier non démarrable', demarrable: false });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Rendu.
  // ---------------------------------------------------------------------------
  const CSS = `
.clm{box-sizing:border-box;width:100%;max-width:760px;margin:auto;display:flex;flex-direction:column;gap:10px;color:var(--ink,#eef);--ca:#0b7f7c}
.clm-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.clm-h b{font-size:16px}.clm-h .pts{display:inline-flex;gap:4px}.clm-h .pts i{width:7px;height:7px;border-radius:50%;background:var(--ca)}
.clm-h .cnt{font-size:12px;color:var(--muted);margin-left:auto}
.clm-s{min-height:38px;width:100%;padding:0 12px;border-radius:10px;border:1px solid var(--line,#345);background:color-mix(in srgb,var(--ink) 6%,transparent);color:inherit;font:inherit}
.clm-scroll{max-height:360px;overflow:auto;border:1px solid var(--line,#345);border-radius:12px;padding:8px}
.clm-fam{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:10px 4px 4px}.clm-fam:first-child{margin-top:2px}
.clm-e{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;border:1px solid transparent}
.clm-e:hover,.clm-e.def{border-color:var(--ca);background:color-mix(in srgb,var(--ca) 10%,transparent)}
.clm-e .tag{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;background:color-mix(in srgb,var(--ink) 12%,transparent);flex:none}
.clm-e .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px}
.clm-e .ty{font-size:11.5px;color:var(--muted);flex:none}
.clm-e .df{font-size:10.5px;font-weight:700;color:var(--ca);flex:none}
.clm-apart{opacity:.7}.clm-apart .clm-e{border-style:dashed;border-color:var(--line,#345)}
.clm-note{font-size:12px;color:var(--muted);margin:4px 2px 0}
.clm-bg{position:fixed;inset:0;z-index:2147482500;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow:auto;background:rgba(4,9,15,.7)}
.clm-box{background:var(--panel,#0b1020);border:1px solid var(--line,#345);border-radius:16px;padding:16px;margin:auto;width:min(760px,100%);box-shadow:0 12px 40px rgba(0,0,0,.5)}
.clm-x{min-width:38px;min-height:38px;border-radius:10px;border:1px solid var(--line,#345);background:none;color:inherit;font:600 18px inherit;cursor:pointer}
`;

  /** Le menu rendu en nœud. opts : { defaut, delai, demo }. */
  function construire(entrees, opts) {
    const o = opts || {};
    const liste = (entrees && entrees.length ? entrees : demo(o.demo || 24)).slice();
    const wrap = el('div', { class: 'clm' });
    const scroll = el('div', { class: 'clm-scroll', role: 'listbox', 'aria-label': 'Entrées de démarrage' });
    const majNombre = el('span', { class: 'cnt' });
    const tag = (e) => info(e.genre).libelle;
    const ligne = (e) => el('div', { class: 'clm-e' + (e.defaut ? ' def' : ''), role: 'option' },
      el('span', { class: 'tag' }, tag(e)), el('span', { class: 'nm' }, e.nom), el('span', { class: 'ty' }, e.type || ''), e.defaut ? el('span', { class: 'df' }, 'par défaut') : null);
    const rendre = (q) => {
      const vus = filtrer(liste, q);
      const { groupes, apart } = grouper(vus);
      const kids = [];
      for (const g of groupes) { kids.push(el('div', { class: 'clm-fam' }, `${g.nom} · ${g.entrees.length}`)); for (const e of g.entrees) kids.push(ligne(e)); }
      if (apart.length) { kids.push(el('div', { class: 'clm-fam' }, `Fichiers non démarrables · ${apart.length}`)); const box = el('div', { class: 'clm-apart' }, ...apart.map(ligne)); kids.push(box); }
      if (!kids.length) kids.push(el('p', { class: 'clm-note' }, 'Rien ne correspond.'));
      scroll.replaceChildren(...kids);
      majNombre.textContent = `${vus.length} entrée${vus.length > 1 ? 's' : ''}`;
    };
    const champ = el('input', { class: 'clm-s', type: 'search', placeholder: 'Rechercher un système…', 'aria-label': 'Rechercher', oninput: (e) => rendre(e.target.value) });
    wrap.append(
      el('div', { class: 'clm-h' }, el('span', { class: 'pts', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), el('b', {}, 'Menu de démarrage ODIN'), majNombre),
      liste.length > 8 ? champ : null,
      scroll,
      el('p', { class: 'clm-note' }, o.defaut ? `« ${o.defaut} » démarre seul après ${o.delai || 10} s sans choix.` : `Le système par défaut démarre seul après ${o.delai || 10} s sans choix. Les ISO et disques virtuels sont listés par Ventoy ; les systèmes installés et les VM copiées s'y ajoutent.`),
    );
    rendre('');
    return wrap;
  }

  /** Le menu dans un calque par-dessus la page (jamais une fenêtre native). */
  function ouvrir(entrees, opts) {
    if (typeof document === 'undefined') return;
    const o = opts || {};
    const bg = el('div', { class: 'clm-bg', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Aperçu du menu de démarrage' });
    bg.append(el('style', {}, CSS));
    const fermer = () => bg.remove();
    const box = el('div', { class: 'clm-box' });
    box.append(el('div', { style: 'display:flex;justify-content:flex-end;margin-bottom:6px' }, el('button', { class: 'clm-x', type: 'button', 'aria-label': 'Fermer', onclick: fermer }, '×')));
    // L'aperçu montre ce que la clé affiche vraiment au boot : si la mascotte est activée, l'amorçage (mascotte + 3
    // points) s'affiche AVANT le menu, et le menu reprend le thème choisi — comme l'écran réel (même maquette).
    const EC = (typeof window !== 'undefined' && window.OdinEcranCartes) || null;
    if (o.mascotteAccueil && EC && EC.accueil) box.append(EC.accueil({ ligne: 'Installation clé USB', delai: 1400 }));
    box.append(construire(entrees, o));
    bg.append(box);
    bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermer(); });
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) fermer(); });
    (document.body || document.documentElement).append(bg);
  }

  // Le style de l'aperçu intégré est ajouté une fois, à la première construction dans une vraie page.
  const styleUneFois = (() => { let fait = false; return () => { if (fait || typeof document === 'undefined') return; fait = true; if (!document.getElementById('clmCss')) document.head.append(el('style', { id: 'clmCss' }, CSS)); }; })();
  const construireAvecStyle = (entrees, opts) => { styleUneFois(); return construire(entrees, opts); };

  window.OdinGeneseCleMenu = { construire: construireAvecStyle, ouvrir, logique: { grouper, filtrer, demo, info, INFO, NOM_FAM, ORDRE_FAM } };
})();
