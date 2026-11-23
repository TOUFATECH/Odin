// Genèse · clé USB — le COMPOSEUR : règle une préparation complète pour une clé OU un disque dur, puis l'écrit.
//   - la CIBLE (clé USB, disque externe, disque interne) et sa taille, avec l'avertissement « gros disque » ;
//   - pour CHAQUE système, les TROIS choix clairs : « ISO qui démarre » (Ventoy, ne garde rien), « Système installé »
//     (Windows To Go, ou Linux persistant / installé — garde les fichiers), « Copie d'une VM » (disque d'une VM
//     d'Hydre/Proxmox ou image déposée, préparé pour démarrer sur un vrai PC) ;
//   - les limites dites HONNÊTEMENT (licence Windows To Go, clé lente, Secure Boot, pilotes d'une VM sur un vrai PC) ;
//   - la liste des VM d'Hydre (cle_vms), avec arrêt / instantané avant copie, et la voie « déposer un disque exporté »
//     quand Proxmox n'expose pas le disque ;
//   - les fichiers déposés à la racine, reconnus tout seuls au démarrage (cle_racine) ;
//   - le PLAN de place (cle_place) affiché AVANT toute écriture (tailles, effacé, gardé, reste), la confirmation forte
//     (phrase exacte à taper, OdinDialog danger), puis la progression de l'écriture et de la copie des VM.
// TOUT passe par OdinDialog ou par ce panneau : jamais une fenêtre native du navigateur. Clair / sombre, 390 et
// 1280 px, « prefers-reduced-motion » respecté.
//
// Depuis le lot C2 de la maquette « Clés USB », la façon et le choix des systèmes se font dans les étapes 2 et 3
// (thjalfi-cle-systemes.js), qui reprennent la logique pure d'ici (cibleDepuis, serialiser) ; ouvert depuis les
// étapes suivantes, ce panneau reçoit ces systèmes (tools.systemes) en attendant les lots des étapes 4 à 6.
//
// Expose window.OdinGeneseCleComposer = { ouvrir(disque, tools), logique, rendu } :
//   - ouvrir : le panneau complet (DOM), ouvert depuis « Préparer » de thjalfi-cle.js ;
//   - logique : les fonctions PURES (cible, choix, limites, résumé du plan, entrées du menu…) essayées sans navigateur ;
//   - rendu : les petits dessinateurs (un système, le plan) rendus en nœuds, essayés sur un faux document.
(() => {
  'use strict';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const GO = 1024 ** 3;
  const taille = (o) => { const g = (Number(o) || 0) / GO; return g >= 1000 ? `${(g / 1024).toFixed(1)} To` : `${Math.round(g)} Go`; };
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  const dialog = () => (typeof window !== 'undefined' && window.OdinDialog) || { confirm: async () => false, alert: async () => {}, prompt: async () => null };

  const post = async (action, input = {}, confirm = false) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'thjalfi', action, input, confirm }) })).json();
  const act = async (action, input = {}) => { let r = await post(action, input); if (r && r.confirm) { if (!(await dialog().confirm(r.confirm, { danger: true }))) return { ok: false, text: 'Annulé.' }; r = await post(action, input, true); } return r; };

  // ---------------------------------------------------------------------------
  // Logique PURE (aucun DOM) : essayée directement dans les tests.
  // ---------------------------------------------------------------------------

  /** La cible (clé OU disque dur) tirée d'un disque de disques.ts. Pur. */
  function cibleDepuis(d) {
    const genre = d.genre === 'cle' ? 'cle' : (d.externe ? 'disque-externe' : 'disque-interne');
    return { id: d.id, genre, tailleOctets: Number(d.tailleOctets) || 0, estOdin: Boolean(d.estOdin) };
  }

  /** Les TROIS choix clairs, dans l'ordre, pour chaque système. Pur. */
  const CHOIX = [
    { id: 'iso', titre: 'ISO qui démarre', desc: 'Installateur ou système « live » (Ventoy). Ne garde pas les fichiers.' },
    { id: 'installe', titre: 'Système installé', desc: 'Windows To Go, ou Linux persistant / installé. Garde les fichiers.' },
    { id: 'vm', titre: "Copie d'une VM", desc: "Un disque de VM (Hydre / Proxmox ou image déposée) préparé pour démarrer sur un vrai PC." },
  ];
  function choix() { return CHOIX.map((c) => ({ ...c })); }

  /** La place qu'un système prend à peu près, pour prévenir avant même le plan serveur. Pur (Go). */
  function placeApproxGo(sys) {
    if (sys.choix === 'installe' && sys.famille === 'windows') return (sys.winToGo && sys.winToGo.tailleGo) || 32;
    if (sys.choix === 'installe' && sys.famille === 'linux') return (sys.installPartition && sys.installPartition.tailleGo) || 20;
    if (sys.choix === 'persistance') return Math.max(1, Math.round(((sys.persistance && sys.persistance.tailleMo) || 8192) / 1024)) + 4;
    if (sys.choix === 'vm') return (sys.vmSource && sys.vmSource.tailleGo) || 20;
    return 5; // une ISO : la place du fichier, estimée
  }

  /** Les limites DITES HONNÊTEMENT pour un choix et une famille. Pur. */
  function limites(choixId, famille) {
    const L = [];
    if (choixId === 'installe' && famille === 'windows') {
      L.push("Licence : le Windows To Go officiel visait l'édition Entreprise. Sur une clé normale ça marche techniquement, mais la licence est à vérifier — aucune activation n'est contournée.");
      L.push('Une clé USB lente rend Windows lent : préfère une clé ou un SSD USB rapide.');
      L.push('Secure Boot : au premier démarrage, inscris la clé de Ventoy via MokManager (expliqué à l\'écran).');
      L.push("Fabrication du VHDX : bcdboot n'existe que sous Windows. Si Odin tourne sous Linux, il faut un hôte ou une VM Windows ; sinon Odin ne propose qu'un VHDX déjà prêt.");
    } else if (choixId === 'installe' && famille === 'linux') {
      L.push('Au choix : persistance (live qui garde fichiers et réglages, selon la distribution) ou installation complète sur une partition.');
      L.push("L'installation complète ciblée est la plus délicate ; automatisée d'abord pour Ubuntu, Debian et RHEL.");
    } else if (choixId === 'persistance') {
      L.push("Persistance : seulement pour les distributions supportées par Ventoy, et c'est un live persistant, pas une installation complète.");
    } else if (choixId === 'vm') {
      L.push("Une VM taillée pour une machine virtuelle peut manquer de pilotes sur un vrai PC. Odin prévient ; pour Windows il peut injecter les pilotes réseau / stockage de base.");
      L.push('La copie peut être grosse et longue (par le réseau depuis Proxmox) : une barre de progression la suit.');
      L.push("Jamais la VM en marche : arrête-la ou fais un instantané avant la copie (cohérence du disque).");
    }
    return L;
  }

  /** Vrai si la cible est un gros disque externe qui peut tout contenir. Pur. */
  const grosDisque = (cible) => cible.genre === 'disque-externe' && cible.tailleOctets > 130 * GO;

  /** Le libellé d'origine d'une VM. Pur. */
  const ORIGINE = { 'hydre-locale': 'VM locale (Hydre)', proxmox: 'VM Proxmox', depot: 'Disque déposé' };

  /** Résumé lisible d'un PlanPlace (ce qui est effacé, gardé, le reste). Pur. */
  function planResume(plan) {
    const p = plan || {};
    const lignes = (p.partitions || []).map((x) => ({ role: x.role, tailleGo: x.tailleGo, efface: Boolean(x.efface), texte: `${x.role} · ${x.tailleGo} Go · ${x.efface ? 'effacé' : 'gardé'}` }));
    return { peutEcrire: Boolean(p.possible), blocage: p.blocage || '', lignes, resteGo: Number(p.resteGo) || 0, avertissements: p.avertissements || [] };
  }

  /** La phrase EXACTE à taper pour confirmer une écriture (confirmation forte). Pur. */
  const PHRASE = 'EFFACER';
  function phraseOk(saisie) { return String(saisie == null ? '' : saisie).trim().toUpperCase() === PHRASE; }

  /** Le type d'entrée de menu pour un choix (pour l'aperçu du menu). Pur. */
  const TYPE_MENU = { iso: 'ISO (démarrer / installer)', installe: 'Système installé', persistance: 'Live persistant', vm: 'VM qui démarre' };

  /** Les entrées du menu de démarrage à partir d'un état (systèmes + fichiers de la racine). Pur. */
  function entreesMenu(etat) {
    const out = [];
    for (const s of etat.systemes || []) out.push({ nom: s.nom, genre: s.choix, famille: s.famille, type: TYPE_MENU[s.choix] || 'Entrée', defaut: Boolean(s.defaut), demarrable: true });
    for (const f of etat.racine || []) out.push({ nom: f.nom, genre: f.genre || 'non-demarrable', famille: f.famille || 'inconnu', type: f.type || (f.demarrable === false ? 'Fichier non démarrable' : 'Fichier déposé'), demarrable: f.demarrable !== false });
    return out;
  }

  /**
   * Les réglages de PRÉSENTATION de la clé, repris tels quels de la maquette validée « Démarrage réseau » (PXE) :
   * le THÈME graphique (9 thèmes), le thème TEXTE (menu GRUB / iPXE), la DISPOSITION (éventail / affiches / liste),
   * et la mascotte d'Odin au démarrage (ses yeux en pastille + les 3 points AVANT le menu). Pur : valeurs par défaut.
   */
  function reglagesDefaut() {
    return { theme: 'bleu', texte: 'matrix', disposition: 'eventail', mascotteAccueil: true, fond: '' };
  }
  /** La famille côté clé (windows / linux) d'un système du catalogue, tirée de sa catégorie de la maquette. Pur. */
  function familleDuSysteme(sys) {
    const c = (sys && sys.category) || '';
    return c === 'Windows' ? 'windows' : 'linux';
  }
  /** Le choix de départ (iso / installe) selon le mode choisi dans le détail de la maquette. Pur. */
  function choixDepuisMode(mode) { return mode === 'installer' || mode === 'auto' ? 'installe' : 'iso'; }

  // --- Logiciels à installer à la fin : filtrés par OS (miroir de logiciels-cle.ts côté serveur). Pur. ---
  /** La famille d'un fichier d'installateur d'après son extension. Pur. */
  function familleLogicielCle(fichier) {
    const e = (/\.([a-z0-9]+)$/i.exec(String(fichier || '')) || [])[1];
    const x = (e || '').toLowerCase();
    if (['exe', 'msi', 'msix', 'msixbundle', 'appx'].includes(x)) return 'windows';
    if (x === 'deb') return 'linux-deb';
    if (x === 'rpm') return 'linux-rpm';
    if (x === 'flatpakref' || x === 'flatpak') return 'linux-flatpak';
    if (x === 'appimage') return 'linux-appimage';
    if (['dmg', 'pkg'].includes(x)) return 'macos';
    if (x === 'apk') return 'android';
    if (x === 'zip') return 'archive';
    return 'autre';
  }
  /** L'OS (windows / linux) d'un système côté clé. Pur. */
  function osDuSystemeCle(sys) {
    const t = `${(sys && sys.famille) || ''} ${(sys && sys.nom) || ''} ${(sys && sys.fichier) || ''}`.toLowerCase();
    return (sys && sys.famille === 'windows') || /windows|win\b/.test(t) ? 'windows' : 'linux';
  }

  /** Vrai pour un simple nom de fichier (pas de dossier, pas de « .. », pas de lecteur, pas de caractère de contrôle). Pur. */
  const nomFichierSur = (f) => typeof f === 'string' && f.length > 0 && f.length <= 255 && !/[\\/:\u0000-\u001f\u007f]/.test(f) && !/^\.+$/.test(f);

  /** Le descripteur SystemeCle (contrat) envoyé au serveur pour le plan et l'écriture. Pur. */
  function serialiser(s) {
    const o = { nom: s.nom, famille: s.famille, choix: s.choix, mode: s.mode || (s.choix === 'iso' ? 'demarrer' : 'installer') };
    // Le fichier de l'ISO dans la bibliothèque (choisi à l'étape « Systèmes ») : le serveur en a besoin pour l'écrire.
    // Un simple nom de fichier, jamais un chemin (ni « .. », ni « / » ou « \ », ni lecteur « C: ») : un nom piégé
    // n'est pas envoyé. (Le serveur devra lui aussi retrouver l'ISO dans SA bibliothèque avant toute copie.)
    if (nomFichierSur(s.fichier)) o.fichier = s.fichier;
    // L'identifiant de l'ISO dans la bibliothèque (lot C4) : le serveur retrouve l'image par lui, jamais par un chemin.
    if (typeof s.iso === 'string' && /^iso:[\w.-]{1,80}$/.test(s.iso)) o.iso = s.iso;
    if (s.winToGo) o.winToGo = s.winToGo;
    if (s.persistance) o.persistance = s.persistance;
    if (s.installPartition) o.installPartition = s.installPartition;
    if (s.vmSource) o.vmSource = s.vmSource;
    // Les logiciels COCHÉS pour CE système (déjà téléchargés, filtrés par OS) : copiés et installés à la fin.
    if (Array.isArray(s.logiciels) && s.logiciels.length) o.logiciels = s.logiciels.map((l) => ({ id: l.id, fichier: l.fichier, nom: l.nom, silencieux: Boolean(l.silencieux) }));
    return o;
  }

  // ---------------------------------------------------------------------------
  // Rendu : petits dessinateurs rendus en nœuds (essayés sur un faux document).
  // ---------------------------------------------------------------------------

  /** La carte d'UN système : son nom, sa famille, les trois choix, le sous-choix Linux, les limites honnêtes. */
  function carteSysteme(sys, outils) {
    const o = outils || {};
    const famille = sys.famille || 'linux';
    const choixBtns = el('div', { class: 'clc-choix' }, ...CHOIX.map((c) => el('button', {
      type: 'button', class: 'clc-ch' + (sys.choix === c.id || (c.id === 'installe' && sys.choix === 'persistance') ? ' sel' : ''),
      onclick: () => { sys.choix = c.id === 'installe' && famille === 'windows' ? 'installe' : c.id; o.maj && o.maj(); },
    }, el('b', {}, c.titre), el('span', {}, c.desc))));
    const kids = [
      el('div', { class: 'clc-sys-h' },
        el('b', {}, sys.nom || 'Système'),
        el('span', { class: 'clc-fam' }, { windows: 'Windows', linux: 'Linux', macos: 'macOS' }[famille] || famille)),
      choixBtns,
    ];
    // Sous-choix pour un Linux « installé » : persistance ou installation complète.
    if ((sys.choix === 'installe' || sys.choix === 'persistance') && famille === 'linux') {
      kids.push(el('div', { class: 'clc-sous' },
        el('button', { type: 'button', class: 'clc-pill' + (sys.choix === 'persistance' ? ' sel' : ''), onclick: () => { sys.choix = 'persistance'; o.maj && o.maj(); } }, 'Persistance (live)'),
        el('button', { type: 'button', class: 'clc-pill' + (sys.choix === 'installe' ? ' sel' : ''), onclick: () => { sys.choix = 'installe'; o.maj && o.maj(); } }, 'Installation complète')));
    }
    const lim = limites(sys.choix, famille);
    if (lim.length) kids.push(el('ul', { class: 'clc-lim' }, ...lim.map((t) => el('li', {}, t))));
    if (sys.choix === 'vm' && sys.vmSource) kids.push(el('p', { class: 'clc-note' }, `VM : ${sys.vmSource.nom} · ${ORIGINE[sys.vmSource.origine] || sys.vmSource.origine}${sys.vmSource.instantaneFait ? ' · instantané fait' : ' · à arrêter / instantané avant copie'}`));
    kids.push(el('div', { class: 'clc-sys-f' },
      el('span', { class: 'clc-note' }, `Place estimée : ${placeApproxGo(sys)} Go`),
      o.retirer ? el('button', { type: 'button', class: 'clc-pill warn', onclick: () => o.retirer(sys) }, 'Retirer') : null));
    return el('div', { class: 'clc-sys' }, ...kids);
  }

  /** Le plan de place rendu : les partitions (rôle, taille, effacé / gardé), le reste, les avertissements. */
  function cartePlan(plan) {
    const r = planResume(plan);
    const kids = [el('h4', {}, 'Plan de place (rien n\'est écrit pour l\'instant)')];
    if (r.blocage) kids.push(el('p', { class: 'clc-bloc' }, r.blocage));
    kids.push(el('div', { class: 'clc-parts' }, ...r.lignes.map((l) => el('div', { class: 'clc-part' + (l.efface ? ' eff' : '') },
      el('span', { class: 'clc-role' }, l.role), el('span', {}, `${l.tailleGo} Go`), el('span', { class: 'clc-etat' }, l.efface ? 'effacé' : 'gardé')))));
    kids.push(el('p', { class: 'clc-note' }, `Reste libre : ${r.resteGo} Go.`));
    for (const a of r.avertissements) kids.push(el('p', { class: 'clc-avert' }, a));
    return el('div', { class: 'clc-plan' }, ...kids);
  }

  // ---------------------------------------------------------------------------
  // Le panneau complet (DOM).
  // ---------------------------------------------------------------------------
  const CSS = `
.clc-bg{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow:auto;background:rgba(4,9,15,.58)}
.clc{box-sizing:border-box;width:min(760px,100%);margin:auto;display:flex;flex-direction:column;gap:14px;padding:20px;background:var(--panel,#fff);color:var(--ink,#111);border:1px solid var(--line,#ccc);border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.4);--ca:#0b7f7c;--cwarn:#d97706;--cbad:#e5484d}
.clc-top{display:flex;align-items:flex-start;gap:12px}.clc-top h2{margin:0;font-size:19px}.clc-top .sub{margin:2px 0 0;font-size:13px;color:var(--muted)}
.clc-x{margin-left:auto;min-width:40px;min-height:40px;border-radius:10px;border:1px solid var(--line);background:none;color:inherit;font:600 20px inherit;cursor:pointer;flex:none}
.clc-warn{padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--cwarn) 12%,transparent);font-size:13px}
.clc-grp{border:1px solid var(--line);border-radius:14px;padding:12px 14px}
.clc-grp>h4{margin:0 0 8px;font-size:12.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:8px}
.clc-sys{border:1px solid var(--line);border-radius:12px;padding:12px;margin-top:10px;background:color-mix(in srgb,var(--ink) 3%,transparent)}
.clc-sys-h{display:flex;align-items:center;gap:8px}.clc-sys-h b{font-size:15px}.clc-fam{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ink) 9%,transparent)}
.clc-choix{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0}@media (max-width:560px){.clc-choix{grid-template-columns:1fr}}
.clc-ch{text-align:left;border:1px solid var(--line);border-radius:11px;padding:9px 11px;background:color-mix(in srgb,var(--panel) 85%,transparent);color:inherit;cursor:pointer;display:flex;flex-direction:column;gap:3px}
.clc-ch b{font-size:13.5px}.clc-ch span{font-size:11.5px;color:var(--muted);line-height:1.35}
.clc-ch.sel{border-color:var(--ca);box-shadow:0 0 0 2px color-mix(in srgb,var(--ca) 35%,transparent)}
.clc-sous{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 8px}
.clc-pill{min-height:34px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 85%,transparent);color:inherit;font:600 12.5px inherit;cursor:pointer}
.clc-pill.sel{background:var(--ca);color:#fff;border-color:transparent}.clc-pill.pri{background:var(--ca);color:#fff;border-color:transparent}.clc-pill.warn{background:var(--cwarn);color:#fff;border-color:transparent}
.clc-lim{margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--muted);line-height:1.5}
.clc-sys-f{display:flex;align-items:center;gap:10px;margin-top:8px}.clc-sys-f .clc-note{margin:0;flex:1}
.clc-note{font-size:12px;color:var(--muted);line-height:1.45;margin:6px 0 0}
.clc-vm{display:flex;gap:10px;align-items:center;padding:9px 11px;border:1px solid var(--line);border-radius:11px;margin-top:8px}
.clc-vm .in{flex:1;min-width:0}.clc-vm .in b{font-size:14px}.clc-vm .in span{font-size:12px;color:var(--muted);display:block}
.clc-plan{border:1px solid var(--ca);border-radius:14px;padding:12px 14px;background:color-mix(in srgb,var(--ca) 6%,transparent)}
.clc-plan h4{margin:0 0 8px;font-size:14px}
.clc-parts{display:flex;flex-direction:column;gap:6px}
.clc-part{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:10px;background:color-mix(in srgb,var(--ink) 5%,transparent);font-size:13px}
.clc-part.eff{background:color-mix(in srgb,var(--cbad) 12%,transparent)}
.clc-part .clc-role{flex:1;font-weight:600}.clc-part .clc-etat{font-size:11.5px;font-weight:700}
.clc-bloc{color:var(--cbad);font-size:13px;font-weight:600;margin:0 0 8px}
.clc-avert{color:var(--cwarn);font-size:12.5px;margin:6px 0 0}
.clc-prog{height:10px;border-radius:5px;background:color-mix(in srgb,var(--ink) 10%,transparent);overflow:hidden;margin-top:8px}
.clc-prog i{display:block;height:100%;background:var(--ca);width:0;transition:width .3s}
.clc-prog.ind i{width:35%;animation:clc-ind 1.1s linear infinite}
@keyframes clc-ind{0%{margin-left:-35%}100%{margin-left:100%}}
.clc-foot{display:flex;gap:8px;flex-wrap:wrap;align-items:center;position:sticky;bottom:-20px;background:var(--panel);padding:10px 0 0;margin:0 -2px;border-top:1px solid var(--line)}
@media (prefers-reduced-motion:reduce){.clc-ch,.clc-prog i{transition:none}.clc-prog.ind i{animation:none;width:100%}}
`;

  async function ouvrir(disque, tools) {
    if (typeof document === 'undefined') return;
    const D = dialog();
    // Les systèmes déjà choisis dans le parcours par étapes (étapes « Façon » et « Systèmes ») : repris tels quels.
    const deja = Array.isArray(tools && tools.systemes) ? tools.systemes.filter((x) => x && typeof x === 'object').map((x, i) => ({ ...x, defaut: i === 0 })) : [];
    const etat = { cible: cibleDepuis(disque), nomCible: disque.modele || disque.chemin || 'ce support', systemes: deja, vms: [], racine: [], plan: null, reglages: reglagesDefaut(), catalogue: [], catOuvert: false };
    let compteur = 0;

    const bg = el('div', { class: 'clc-bg', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Préparer ${etat.nomCible}` });
    bg.append(el('style', {}, CSS));
    const box = el('div', { class: 'clc' });
    bg.append(box);
    const fermer = () => bg.remove();
    bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermer(); });

    const corps = el('div', {});
    const majBarre = (pct, etape) => { const b = box.querySelector('.clc-prog'); if (!b) return; b.classList.remove('ind'); b.querySelector('i').style.width = `${Math.max(0, Math.min(100, pct))}%`; const t = box.querySelector('.clc-prog-t'); if (t && etape) t.textContent = etape; };

    function ajouterSysteme(famille) {
      compteur += 1;
      const sys = { nom: `Système ${compteur}`, famille, choix: 'iso', mode: 'installer', defaut: etat.systemes.length === 0 };
      etat.systemes.push(sys);
      dessiner();
    }
    function retirerSysteme(sys) { etat.systemes = etat.systemes.filter((s) => s !== sys); dessiner(); }

    // La bibliothèque d'Odin (mêmes ISO / images que le démarrage réseau) : l'état de /ecran/etat donne la liste des
    // systèmes, exactement formée comme la maquette (ecran.ts systems()). On la montre avec la MÊME présentation.
    async function chargerCatalogue() {
      try { const r = await fetch('/ecran/etat'); const d = await r.json(); etat.catalogue = Array.isArray(d && d.systemes) ? d.systemes : []; }
      catch { etat.catalogue = []; }
      etat.catOuvert = true;
      dessiner();
    }
    // Un système choisi dans la maquette (Essayer / Installer / Installer pour moi) s'ajoute à la composition de la clé.
    function ajouterDuCatalogue(sys, mode) {
      const fichier = sys.name || sys.fichier || sys.id || '';
      etat.systemes.push({ nom: sys.title || fichier || 'Système', fichier, famille: familleDuSysteme(sys), choix: choixDepuisMode(mode), mode: mode === 'essai' ? 'essai' : 'installer', defaut: etat.systemes.length === 0 });
      dessiner();
    }

    async function chargerVms() {
      const grille = box.querySelector('.clc-vms');
      if (grille) grille.replaceChildren(el('p', { class: 'clc-note' }, 'Lecture des VM d\'Hydre…'));
      let arr = [];
      try { const r = await post('cle_vms'); const d = r && r.data; arr = Array.isArray(d) ? d : (d && (d.vms || [].concat(d.locales || [], d.proxmox || [], d.depot || []))) || []; } catch { arr = []; }
      etat.vms = arr;
      dessiner();
    }

    async function ajouterVm(vm) {
      // Jamais la VM en marche : on exige un arrêt ou un instantané avant la copie.
      if (vm.enMarche && !vm.instantaneFait) {
        const ok = await D.confirm('Cette VM est en marche. Pour une copie cohérente, Odin doit l\'arrêter ou en faire un instantané avant de copier. Continuer ?', { ok: 'Arrêter / instantané', danger: true });
        if (!ok) return;
        const r = await act('cle_vms', { vmid: vm.vmid, serveur: vm.serveur, instantane: true });
        if (r && r.data && typeof r.data === 'object') Object.assign(vm, r.data);
        else if (!(r && r.ok !== false)) { await D.alert('Odin n\'a pas pu arrêter la VM ni l\'instantané d\'ici. Fais-le sur Proxmox (qm stop / snapshot), puis réessaie.'); return; }
        vm.instantaneFait = true;
      }
      if (vm.origine === 'proxmox' && !vm.disque) {
        await D.alert('Proxmox n\'expose pas le disque de cette VM du cluster. Exporte-le (vzdump / qm / qemu-img), puis dépose le fichier à la racine de la clé : il sera reconnu tout seul au démarrage.');
        return;
      }
      compteur += 1;
      etat.systemes.push({ nom: vm.nom, famille: vm.famille || 'inconnu', choix: 'vm', mode: 'demarrer', vmSource: { origine: vm.origine, vmid: vm.vmid, serveur: vm.serveur, nom: vm.nom, famille: vm.famille || 'inconnu', disque: vm.disque, instantaneFait: Boolean(vm.instantaneFait), tailleGo: vm.tailleGo }, defaut: etat.systemes.length === 0 });
      dessiner();
    }

    async function chargerRacine() {
      try { const r = await post('cle_racine', { cible: etat.cible }); const d = r && r.data; etat.racine = Array.isArray(d) ? d : (d && d.fichiers) || []; } catch { etat.racine = []; }
      dessiner();
    }

    async function voirPlan() {
      let plan = null;
      try { const r = await post('cle_place', { cible: etat.cible, systemes: etat.systemes.map(serialiser) }); plan = (r && r.data) || { possible: false, blocage: (r && r.text) || 'Plan indisponible.', partitions: [], resteGo: 0, avertissements: [] }; }
      catch { plan = { possible: false, blocage: 'Plan indisponible (serveur injoignable).', partitions: [], resteGo: 0, avertissements: [] }; }
      etat.plan = plan;
      dessiner();
    }

    async function apercuMenu() {
      const entrees = entreesMenu(etat);
      // L'aperçu du menu de la clé montre la même chose que ce que la clé affichera au boot : le thème, la disposition,
      // et (si la mascotte est activée) l'amorçage mascotte + 3 points AVANT le menu — comme l'écran réel.
      if (window.OdinGeneseCleMenu && window.OdinGeneseCleMenu.ouvrir) window.OdinGeneseCleMenu.ouvrir(entrees, { defaut: (etat.systemes.find((s) => s.defaut) || {}).nom, delai: etat.reglages.delai || 10, theme: etat.reglages.theme, disposition: etat.reglages.disposition, mascotteAccueil: etat.reglages.mascotteAccueil });
      else await D.alert('L\'aperçu du menu n\'est pas chargé.');
    }

    async function ecrire(btn) {
      if (!etat.plan) { await voirPlan(); }
      const r = planResume(etat.plan);
      if (!r.peutEcrire) { await D.alert(r.blocage || 'Plan impossible : rien n\'est écrit.'); return; }
      // Lot C4 : la clé s'écrit à l'étape « Vérifier » du parcours « Déployer » (la phrase donnée par le serveur ET un
      // appui long de 3 s, le numéro de série revérifié). Ce composeur ne lance plus l'écriture lui-même.
      if (window.OdinGeneseCleSuivi) { await D.alert('L\'écriture se fait maintenant à l\'étape « Vérifier » du parcours « Déployer » : Odin y montre tout, puis demande la phrase et un appui long de 3 secondes.'); return; }
      const efface = r.lignes.filter((l) => l.efface).map((l) => l.role).join(', ') || 'rien';
      const saisie = await D.prompt(`Écriture sur « ${etat.nomCible} ». Sera effacé : ${efface}. Pour confirmer, tape exactement : ${PHRASE}`, '', { ok: 'Écrire', danger: true, title: 'Confirmation forte' });
      if (saisie === null) return;
      if (!phraseOk(saisie)) { await D.alert('Phrase incorrecte : rien n\'a été écrit.'); return; }
      if (btn) btn.disabled = true;
      const barre = box.querySelector('.clc-prog');
      if (barre) barre.classList.add('ind');
      let vivant = true;
      const poll = async () => {
        while (vivant) {
          let d = null;
          try { const pr = await post('cle_progres', { cible: etat.cible }); if (!pr || pr.ok === false || !pr.data) return; d = pr.data; } catch { return; }
          majBarre(Number(d.pct) || 0, d.etape || '');
          if (d.fini) return;
          await attendre(800);
        }
      };
      void poll();
      const res = await act('cle_preparer', { cible: etat.cible, systemes: etat.systemes.map(serialiser), racine: etat.racine });
      vivant = false;
      majBarre(100, (res && res.ok !== false) ? 'Terminé.' : 'Arrêté.');
      if (btn) btn.disabled = false;
      await D.alert((res && res.text) || ((res && res.ok !== false) ? 'Préparation écrite.' : 'Écriture arrêtée.'));
      if (res && res.ok !== false) fermer();
    }

    // Le groupe PRÉSENTATION : on choisit le thème, la disposition et le thème texte de la maquette validée, et si la
    // mascotte d'Odin ouvre l'écran. Réutilise les constantes de la maquette (OdinEcranCartes) quand elles sont là.
    function groupePresentation() {
      const EC = (typeof window !== 'undefined' && window.OdinEcranCartes && window.OdinEcranCartes.logique) || null;
      const themes = EC ? EC.THEMES : { bleu: 'Bleu verre', matrix: 'Matrix', ocean: 'Voyage océan', lune: 'Lune', ciel: 'Ciel', galaxie: 'Galaxie', mayotte: 'Mayotte', couchant: 'Coucher de soleil', clair: 'Clair minimal' };
      const textes = EC ? EC.TEXT_THEMES : { matrix: 'Matrix', lune: 'Lune', aurore: 'Aurore boréale', neon: 'Néon', classique: 'Classique' };
      const disps = EC ? EC.DISP : { eventail: 'Éventail', affiches: 'Affiches', liste: 'Liste' };
      const r = etat.reglages;
      const pills = (obj, val, set) => el('div', { class: 'clc-sous' }, ...Object.entries(obj).map(([k, nom]) => el('button', { type: 'button', class: 'clc-pill' + (k === val ? ' sel' : ''), onclick: () => { set(k); dessiner(); } }, nom)));
      return el('div', { class: 'clc-grp' }, el('h4', {}, 'Présentation (même maquette que le démarrage réseau)'),
        el('p', { class: 'clc-note', style: 'margin:0 0 6px' }, 'Disposition des systèmes :'),
        pills(disps, r.disposition, (k) => { r.disposition = k; }),
        el('p', { class: 'clc-note', style: 'margin:8px 0 6px' }, 'Thème graphique (écran animé) :'),
        pills(themes, r.theme, (k) => { r.theme = k; }),
        el('p', { class: 'clc-note', style: 'margin:8px 0 6px' }, 'Thème texte (menu en ligne de commande) :'),
        pills(textes, r.texte, (k) => { r.texte = k; }),
        el('div', { class: 'clc-sys-f', style: 'margin-top:10px' },
          el('span', { class: 'clc-note' }, 'Mascotte d\'Odin au démarrage (ses yeux + 3 points, AVANT le menu) :'),
          el('button', { type: 'button', class: 'clc-pill' + (r.mascotteAccueil ? ' pri' : ''), onclick: () => { r.mascotteAccueil = !r.mascotteAccueil; dessiner(); } }, r.mascotteAccueil ? 'Activée' : 'Désactivée')),
        el('p', { class: 'clc-note' }, 'Le fond d\'écran perso par thème déjà réglé dans Genèse est repris tel quel ; rien à refaire ici.'));
    }

    // Le groupe BIBLIOTHÈQUE : choisir les systèmes / ISO / images à mettre sur la clé AVEC la présentation de la
    // maquette validée (éventail / affiches / liste, thèmes, cartes, détail Essayer / Installer). Même aspect que le
    // démarrage réseau. Si OdinEcranCartes n'est pas là, on garde l'ajout « + Windows / + Linux » à la main.
    function groupeCatalogue() {
      const EC = (typeof window !== 'undefined' && window.OdinEcranCartes) || null;
      const tete = el('h4', {}, 'Choisir un système (bibliothèque d\'Odin)',
        el('button', { type: 'button', class: 'clc-pill', style: 'margin-left:auto', onclick: chargerCatalogue }, etat.catOuvert ? 'Relire' : 'Ouvrir la bibliothèque'));
      const grp = el('div', { class: 'clc-grp' }, tete);
      if (!etat.catOuvert) { grp.append(el('p', { class: 'clc-note' }, 'La même présentation que le démarrage réseau validé : choisis les ISO, images et systèmes dans l\'éventail / les affiches / la liste, avec le détail « Essayer / Installer ».')); return grp; }
      if (EC && EC.rendre) {
        if (etat.reglages.mascotteAccueil && EC.accueil) grp.append(EC.accueil({ ligne: 'Installation clé USB' }));
        grp.append(EC.rendre({ systemes: etat.catalogue, theme: etat.reglages.theme, disposition: etat.reglages.disposition, onChoisir: ajouterDuCatalogue }));
      } else {
        grp.append(el('p', { class: 'clc-note' }, 'La présentation de la maquette n\'est pas chargée : ajoute les systèmes à la main ci-dessous.'));
      }
      return grp;
    }

    // Les logiciels DÉJÀ TÉLÉCHARGÉS qui conviennent à l'OS d'un système : Odin les propose, on coche ceux à « coller ».
    async function chargerLogiciels(sys) {
      sys._logChargement = true; dessiner();
      let arr = [];
      try { const r = await post('cle_logiciels', { os: osDuSystemeCle(sys), famille: sys.famille, nom: sys.nom, serveur: /server|serveur/i.test(sys.nom || '') }); const d = r && r.data; arr = (d && Array.isArray(d.logiciels)) ? d.logiciels : []; }
      catch { arr = []; }
      sys._logDispo = arr; sys._logChargement = false; sys._logOuvert = true;
      dessiner();
    }
    function basculerLogiciel(sys, l) {
      if (!Array.isArray(sys.logiciels)) sys.logiciels = [];
      const i = sys.logiciels.findIndex((x) => x.fichier === l.fichier);
      if (i >= 0) sys.logiciels.splice(i, 1); else sys.logiciels.push({ id: l.id, fichier: l.fichier, nom: l.nom, silencieux: Boolean(l.silencieux) });
      dessiner();
    }

    // Le groupe LOGICIELS : pour chaque système, les logiciels de son OS (Windows → Windows, Linux → Linux), pris dans
    // ce qui est déjà téléchargé (Hermès). On coche ceux à coller ; ceux sans mode silencieux connu sont signalés.
    function groupeLogiciels() {
      const grp = el('div', { class: 'clc-grp' }, el('h4', {}, 'Logiciels à installer à la fin (par système, filtrés par OS)'));
      if (!etat.systemes.length) { grp.append(el('p', { class: 'clc-note' }, 'Ajoute d\'abord un système : Odin proposera les logiciels de son OS, pris dans ce qui est déjà téléchargé dans Hermès.')); return grp; }
      for (const sys of etat.systemes) {
        const os = osDuSystemeCle(sys), choisis = Array.isArray(sys.logiciels) ? sys.logiciels : [];
        const tete = el('div', { class: 'clc-sys-h' }, el('b', {}, sys.nom || 'Système'), el('span', { class: 'clc-fam' }, os === 'windows' ? 'Windows' : 'Linux'),
          el('button', { type: 'button', class: 'clc-pill', style: 'margin-left:auto', onclick: () => chargerLogiciels(sys) }, sys._logOuvert ? 'Relire' : 'Proposer les logiciels'));
        const bloc = el('div', { class: 'clc-sys' }, tete);
        if (sys._logChargement) bloc.append(el('p', { class: 'clc-note' }, 'Lecture des logiciels téléchargés…'));
        else if (sys._logOuvert) {
          const dispo = Array.isArray(sys._logDispo) ? sys._logDispo : [];
          if (!dispo.length) bloc.append(el('p', { class: 'clc-note' }, `Aucun logiciel ${os === 'windows' ? 'Windows' : 'Linux'} déjà téléchargé. Télécharge-les dans Hermès (filtre « Système »), puis reviens.`));
          for (const l of dispo) {
            const coche = choisis.some((x) => x.fichier === l.fichier);
            bloc.append(el('label', { class: 'clc-vm' },
              el('input', { type: 'checkbox', checked: coche, onchange: () => basculerLogiciel(sys, l) }),
              el('div', { class: 'in' }, el('b', {}, l.nom || l.fichier),
                el('span', {}, l.silencieux ? 'installé en silencieux à la fin' : `copié, à installer à la main${l.note ? ` — ${l.note}` : ''}`))));
          }
        } else bloc.append(el('p', { class: 'clc-note' }, 'Clique « Proposer les logiciels » : Odin montre ceux de cet OS déjà téléchargés.'));
        grp.append(bloc);
      }
      return grp;
    }

    function dessiner() {
      const familles = ['windows', 'linux'];
      const noeuds = [
        el('div', { class: 'clc-top' },
          el('div', {}, el('h2', {}, `Préparer « ${etat.nomCible} »`),
            el('p', { class: 'sub' }, `${{ cle: 'Clé USB', 'disque-externe': 'Disque externe', 'disque-interne': 'Disque interne' }[etat.cible.genre]} · ${taille(etat.cible.tailleOctets)}${etat.cible.estOdin ? ' · déjà ODIN' : ''}`)),
          el('button', { class: 'clc-x', type: 'button', 'aria-label': 'Fermer', onclick: fermer }, '×')),
        grosDisque(etat.cible) ? el('div', { class: 'clc-warn' }, 'Gros disque externe : il peut tout contenir — plusieurs systèmes installés et beaucoup d\'ISO.') : null,
        // La présentation (thème, disposition) et la bibliothèque, à la MÊME maquette que le démarrage réseau.
        groupePresentation(),
        groupeCatalogue(),
        // Les systèmes et leurs trois choix.
        el('div', { class: 'clc-grp' }, el('h4', {}, 'Systèmes', el('span', { class: 'clc-fam' }, String(etat.systemes.length))),
          ...etat.systemes.map((s) => carteSysteme(s, { maj: dessiner, retirer: retirerSysteme })),
          el('div', { class: 'clc-sous', style: 'margin-top:10px' },
            ...familles.map((f) => el('button', { type: 'button', class: 'clc-pill', onclick: () => ajouterSysteme(f) }, `+ ${{ windows: 'Windows', linux: 'Linux' }[f]}`)))),
        // Les logiciels à installer à la fin, par système, filtrés par OS.
        groupeLogiciels(),
        // Les VM d'Hydre.
        el('div', { class: 'clc-grp' }, el('h4', {}, 'Machines virtuelles (Hydre)', el('button', { type: 'button', class: 'clc-pill', style: 'margin-left:auto', onclick: chargerVms }, 'Lister')),
          el('div', { class: 'clc-vms' }, etat.vms.length
            ? el('div', {}, ...etat.vms.map((vm) => el('div', { class: 'clc-vm' },
              el('div', { class: 'in' }, el('b', {}, vm.nom), el('span', {}, `${ORIGINE[vm.origine] || vm.origine}${vm.vmid != null ? ` · #${vm.vmid}` : ''}${vm.enMarche ? ' · en marche' : ''}${vm.origine === 'proxmox' && !vm.disque ? ' · disque non exposé' : ''}`)),
              el('button', { type: 'button', class: 'clc-pill pri', onclick: () => ajouterVm(vm) }, 'Ajouter'))))
            : el('p', { class: 'clc-note' }, 'Clique « Lister » pour voir les VM d\'Hydre (locales, Proxmox, ou un disque de VM exporté déposé à la racine).'))),
        // Les fichiers déposés à la racine (reconnus tout seuls).
        el('div', { class: 'clc-grp' }, el('h4', {}, 'Déposés à la racine', el('button', { type: 'button', class: 'clc-pill', style: 'margin-left:auto', onclick: chargerRacine }, 'Relire')),
          etat.racine.length
            ? el('div', {}, ...etat.racine.map((f) => el('div', { class: 'clc-vm' }, el('div', { class: 'in' }, el('b', {}, f.nom), el('span', {}, `${f.type || (f.demarrable === false ? 'Fichier non démarrable' : 'Fichier déposé')}${f.famille ? ` · ${f.famille}` : ''}`)))))
            : el('p', { class: 'clc-note' }, 'Dépose un fichier (ISO, .img, .raw, .vhd, .vhdx, .vmdk, .qcow2, .vdi) sur la partition ODIN : il est reconnu tout seul au démarrage et rangé au menu. Un fichier non reconnu est listé à part, jamais exécuté.')),
        // Le plan et la progression.
        etat.plan ? cartePlan(etat.plan) : null,
        el('div', {}, el('div', { class: 'clc-prog' }, el('i')), el('p', { class: 'clc-note clc-prog-t' }, 'La progression de l\'écriture et de la copie des VM s\'affiche ici.')),
        el('div', { class: 'clc-foot' },
          el('button', { type: 'button', class: 'clc-pill', onclick: apercuMenu }, 'Aperçu du menu'),
          el('button', { type: 'button', class: 'clc-pill', onclick: voirPlan }, 'Voir le plan de place'),
          el('button', { type: 'button', class: 'clc-pill pri', onclick: (e) => ecrire(e.currentTarget) }, 'Écrire…')),
      ];
      corps.replaceChildren(...noeuds.filter(Boolean));
    }

    box.append(corps);
    (document.body || document.documentElement).append(bg);
    dessiner();
  }

  window.OdinGeneseCleComposer = {
    ouvrir,
    logique: { cibleDepuis, choix, limites, placeApproxGo, grosDisque, planResume, phraseOk, PHRASE, entreesMenu, serialiser, ORIGINE, TYPE_MENU, reglagesDefaut, familleDuSysteme, choixDepuisMode, familleLogicielCle, osDuSystemeCle },
    rendu: { carteSysteme, cartePlan },
  };
})();
