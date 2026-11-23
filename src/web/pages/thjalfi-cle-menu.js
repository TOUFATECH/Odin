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
      el('p', { class: 'clm-note' }, o.defaut ? `« ${o.defaut} » démarre seul après ${o.delai || 10} s sans choix.` : `Le système par défaut démarre seul après ${o.delai || 10} s sans choix. Les ISO et disques virtuels posés sur la clé sont listés ; les systèmes installés et les VM copiées s'y ajoutent.`),
    );
    rendre('');
    return wrap;
  }

  // ===========================================================================
  // L'ÉCRAN DE DÉMARRAGE GRAPHIQUE (maquettes validées « Clés USB · Démarrage » et « Systèmes · Démarrage ») :
  // LE MÊME écran pour la clé ODIN et pour le démarrage par le réseau. Une seule ligne change (« depuis la clé » /
  // « par le réseau »), « Installer pour moi » n'existe que par le réseau, les thèmes sont communs.
  //
  // Ce code est la SEULE source de l'écran : le serveur de Genèse le lit (src/valhalla/thjalfi/ecran-page.ts) pour
  // fabriquer la page servie aux PC (réseau) et posée sur la clé (hors ligne) ; l'aperçu de la page Clés USB appelle
  // les mêmes fonctions. `demarrer` et la logique sont écrites pour être recopiées TELLES QUELLES dans la page servie
  // (Function.toString) : elles ne lisent rien d'autre que leurs paramètres.
  //
  // Sûreté : la page servie ne contient aucune donnée (ni nom de machine, ni adresse, ni chemin, ni secret) ; les
  // noms de systèmes reçus sont posés en TEXTE (textContent), jamais en HTML ; l'écran ne fait que DEMANDER
  // (/ecran/choisir) et c'est le serveur (ou, sur la clé, le petit script local) qui permet ou refuse.
  //
  // Odin : son dessin vient de src/web/face.js. La page de démarrage ne peut pas charger face.js (aucun script
  // externe, elle tourne hors ligne sur la clé) : ses formes sont donc REPRISES À L'IDENTIQUE ci-dessous (yeux en
  // pastille, yeux fermés du sommeil, yeux qui sourient, et ses marques zzz, ! et cœurs) ; un essai vérifie qu'elles
  // sont exactement celles que face.js dessine. Yeux seuls, blancs ; ni bouche, ni sourcils, ni joues.
  // ===========================================================================

  /** Les mots de l'écran, dans toutes les langues d'Odin (repli : le français). */
  const MOTS_ECRAN = {
    fr: {
      'titre.page': 'Odin · démarrage',
      'arrivee.reseau': 'Démarrage par le réseau · préparation du menu', 'arrivee.cle': 'Clé USB ODIN · préparation du menu',
      'barre.reseau': 'démarrage par le réseau', 'barre.cle': 'démarrage depuis la clé', 'barre.mode': 'mode graphique',
      'ligne.serveur': 'Serveur Odin', 'ligne.reseau': 'Démarrage par le réseau', 'ligne.cle': 'Installation clé USB',
      'cat.Tout': 'Tout', 'cat.Windows': 'Windows', 'cat.Linux': 'Linux', 'cat.Serveurs': 'Serveurs', 'cat.Outils': 'Outils',
      'disp.eventail': 'Éventail', 'disp.affiches': 'Affiches', 'disp.liste': 'Liste',
      'aria.systemes': 'Systèmes', 'aria.familles': 'Familles', 'aria.disposition': 'Disposition',
      'pied.choisir': 'choisir', 'pied.demarrer': 'démarrer', 'pied.texte': 'mode texte', 'touche.entree': 'Entrée',
      'rebours': '{nom} dans {n} s', 'rebours.arrete': 'Attente arrêtée : choisis quand tu veux', 'rebours.disque': 'Disque du PC',
      'sous.essai-installer': 'Essayer ou installer', 'sous.essai': 'Démarre seulement', 'sous.outil': 'Outil · démarre seulement', 'sous.installer': 'Installer', 'sous.installe': 'Installé · garde tes fichiers',
      'disque.titre': 'Démarrer sur le disque du PC', 'disque.sous': 'Rien n’est touché',
      'desc.reseau': 'Essaie-le sans rien toucher, installe-le toi-même, ou demande « Installer pour moi » : tout seul, après l’accord du propriétaire.',
      'desc.reseau.sansauto': 'Essaie-le sans rien toucher, ou installe-le toi-même.',
      'desc.cle': 'Essaie-le sans rien toucher au PC, ou installe-le.', 'desc.outil': 'Démarre sans rien installer ni toucher au disque.',
      'desc.installe': 'Démarre le système installé, avec tes fichiers.', 'desc.disque': 'Le PC démarre sur son propre disque, comme d’habitude.',
      'desc.installer': 'Tu choisis le disque, le nom et les options.', 'verifie': 'vérifié par Odin (empreinte et antivirus)',
      'act.essai': 'Essayer', 'act.demarrer': 'Démarrer', 'act.installer.reseau': 'Installer moi-même', 'act.installer.cle': 'Installer', 'act.auto': 'Installer pour moi', 'act.disque': 'Démarrer sur le disque',
      'apercu': 'Aperçu : rien n’est lancé.', 'texte.ok': 'Passage en mode texte…', 'texte.bientot': 'Le mode texte n’est pas encore relié ici : choisis dans ce menu.',
      'vide': 'Aucun système prêt pour l’instant.', 'injoignable': 'Odin ne répond pas : je réessaie…',
      'mac.titre': 'Ouvre cet écran depuis la machine', 'mac.texte': 'La machine qui démarre par le réseau affiche son lien (avec son adresse). Tu peux aussi regarder en aperçu.', 'mac.apercu': 'Voir en aperçu',
      'go.titre': 'C’est parti', 'go.texte': 'La machine démarre {nom} dans quelques secondes.', 'go.suivi': 'Tu peux suivre l’avancement ici.', 'go.changer': 'Changer d’avis', 'go.disque': 'le disque',
      'load.q': 'EN COURS', 'load.debut': 'Commencée à {h} · écoulé {m} min', 'load.dit': 'Odin s’occupe de tout : tu peux laisser ce PC, il te prévient quand il est prêt.',
      'etape.reseau': 'Réseau', 'etape.chargeur': 'Chargeur', 'etape.menu': 'Menu', 'etape.systeme': 'Système', 'etape.installation': 'Installation', 'etape.logiciels': 'Logiciels', 'etape.fini': 'Fini',
      'done.titre': '{nom} est prêt', 'done.pc': 'Ce PC', 'done.texte': 'Tu peux redémarrer sur le disque.', 'done.garde': 'Odin a gardé le compte rendu dans Genèse.', 'done.autre': 'Choisir un autre système',
      'wait.titre': 'J’attends ton accord…', 'wait.refus': 'Demande refusée', 'wait.texte': 'Odin a prévenu ton téléphone et l’appli Odin. Dès que tu dis oui, l’installation démarre (le disque sera effacé).', 'wait.refus.texte': 'Rien n’a été effacé. Choisis autre chose.', 'wait.autre': 'Choisir autre chose',
      'deja': 'Déjà installé ici : {nom}',
      'unite.go': 'Go', 'unite.mo': 'Mo',
    },
    en: {
      'titre.page': 'Odin · startup',
      'arrivee.reseau': 'Network startup · preparing the menu', 'arrivee.cle': 'ODIN USB key · preparing the menu',
      'barre.reseau': 'network startup', 'barre.cle': 'startup from the key', 'barre.mode': 'graphical mode',
      'ligne.serveur': 'Odin server', 'ligne.reseau': 'Network startup', 'ligne.cle': 'USB key installation',
      'cat.Tout': 'All', 'cat.Windows': 'Windows', 'cat.Linux': 'Linux', 'cat.Serveurs': 'Servers', 'cat.Outils': 'Tools',
      'disp.eventail': 'Fan', 'disp.affiches': 'Posters', 'disp.liste': 'List',
      'aria.systemes': 'Systems', 'aria.familles': 'Families', 'aria.disposition': 'Layout',
      'pied.choisir': 'choose', 'pied.demarrer': 'start', 'pied.texte': 'text mode', 'touche.entree': 'Enter',
      'rebours': '{nom} in {n} s', 'rebours.arrete': 'Countdown stopped: choose whenever you like', 'rebours.disque': 'PC disk',
      'sous.essai-installer': 'Try or install', 'sous.essai': 'Starts only', 'sous.outil': 'Tool · starts only', 'sous.installer': 'Install', 'sous.installe': 'Installed · keeps your files',
      'disque.titre': 'Start from the PC disk', 'disque.sous': 'Nothing is touched',
      'desc.reseau': 'Try it without touching anything, install it yourself, or ask “Install for me”: done on its own, after the owner agrees.',
      'desc.reseau.sansauto': 'Try it without touching anything, or install it yourself.',
      'desc.cle': 'Try it without touching the PC, or install it.', 'desc.outil': 'Starts without installing anything or touching the disk.',
      'desc.installe': 'Starts the installed system, with your files.', 'desc.disque': 'The PC starts from its own disk, as usual.',
      'desc.installer': 'You choose the disk, the name and the options.', 'verifie': 'checked by Odin (fingerprint and antivirus)',
      'act.essai': 'Try', 'act.demarrer': 'Start', 'act.installer.reseau': 'Install it myself', 'act.installer.cle': 'Install', 'act.auto': 'Install for me', 'act.disque': 'Start from the disk',
      'apercu': 'Preview: nothing is started.', 'texte.ok': 'Switching to text mode…', 'texte.bientot': 'Text mode is not connected here yet: choose in this menu.',
      'vide': 'No system ready yet.', 'injoignable': 'Odin is not answering: trying again…',
      'mac.titre': 'Open this screen from the machine', 'mac.texte': 'The machine starting from the network shows its link (with its address). You can also look at a preview.', 'mac.apercu': 'See a preview',
      'go.titre': 'Here we go', 'go.texte': 'The machine starts {nom} in a few seconds.', 'go.suivi': 'You can follow the progress here.', 'go.changer': 'Change my mind', 'go.disque': 'the disk',
      'load.q': 'IN PROGRESS', 'load.debut': 'Started at {h} · {m} min elapsed', 'load.dit': 'Odin takes care of everything: you can leave this PC, it tells you when it is ready.',
      'etape.reseau': 'Network', 'etape.chargeur': 'Loader', 'etape.menu': 'Menu', 'etape.systeme': 'System', 'etape.installation': 'Installation', 'etape.logiciels': 'Software', 'etape.fini': 'Done',
      'done.titre': '{nom} is ready', 'done.pc': 'This PC', 'done.texte': 'You can restart from the disk.', 'done.garde': 'Odin kept the report in Genesis.', 'done.autre': 'Choose another system',
      'wait.titre': 'Waiting for your approval…', 'wait.refus': 'Request refused', 'wait.texte': 'Odin warned your phone and the Odin app. As soon as you say yes, the installation starts (the disk will be erased).', 'wait.refus.texte': 'Nothing was erased. Choose something else.', 'wait.autre': 'Choose something else',
      'deja': 'Already installed here: {nom}',
      'unite.go': 'GB', 'unite.mo': 'MB',
    },
    es: {
      'titre.page': 'Odin · arranque',
      'arrivee.reseau': 'Arranque por la red · preparando el menú', 'arrivee.cle': 'Llave USB ODIN · preparando el menú',
      'barre.reseau': 'arranque por la red', 'barre.cle': 'arranque desde la llave', 'barre.mode': 'modo gráfico',
      'ligne.serveur': 'Servidor Odin', 'ligne.reseau': 'Arranque por la red', 'ligne.cle': 'Instalación con llave USB',
      'cat.Tout': 'Todo', 'cat.Windows': 'Windows', 'cat.Linux': 'Linux', 'cat.Serveurs': 'Servidores', 'cat.Outils': 'Herramientas',
      'disp.eventail': 'Abanico', 'disp.affiches': 'Carteles', 'disp.liste': 'Lista',
      'aria.systemes': 'Sistemas', 'aria.familles': 'Familias', 'aria.disposition': 'Disposición',
      'pied.choisir': 'elegir', 'pied.demarrer': 'arrancar', 'pied.texte': 'modo texto', 'touche.entree': 'Intro',
      'rebours': '{nom} en {n} s', 'rebours.arrete': 'Cuenta atrás detenida: elige cuando quieras', 'rebours.disque': 'Disco del PC',
      'sous.essai-installer': 'Probar o instalar', 'sous.essai': 'Solo arranca', 'sous.outil': 'Herramienta · solo arranca', 'sous.installer': 'Instalar', 'sous.installe': 'Instalado · guarda tus archivos',
      'disque.titre': 'Arrancar desde el disco del PC', 'disque.sous': 'No se toca nada',
      'desc.reseau': 'Pruébalo sin tocar nada, instálalo tú mismo o pide «Instalar por mí»: solo, tras el acuerdo del propietario.',
      'desc.reseau.sansauto': 'Pruébalo sin tocar nada, o instálalo tú mismo.',
      'desc.cle': 'Pruébalo sin tocar el PC, o instálalo.', 'desc.outil': 'Arranca sin instalar nada ni tocar el disco.',
      'desc.installe': 'Arranca el sistema instalado, con tus archivos.', 'desc.disque': 'El PC arranca desde su propio disco, como siempre.',
      'desc.installer': 'Eliges el disco, el nombre y las opciones.', 'verifie': 'verificado por Odin (huella y antivirus)',
      'act.essai': 'Probar', 'act.demarrer': 'Arrancar', 'act.installer.reseau': 'Instalar yo mismo', 'act.installer.cle': 'Instalar', 'act.auto': 'Instalar por mí', 'act.disque': 'Arrancar desde el disco',
      'apercu': 'Vista previa: no se lanza nada.', 'texte.ok': 'Pasando al modo texto…', 'texte.bientot': 'El modo texto aún no está conectado aquí: elige en este menú.',
      'vide': 'Ningún sistema listo por ahora.', 'injoignable': 'Odin no responde: lo intento de nuevo…',
      'mac.titre': 'Abre esta pantalla desde la máquina', 'mac.texte': 'La máquina que arranca por la red muestra su enlace (con su dirección). También puedes ver una vista previa.', 'mac.apercu': 'Ver vista previa',
      'go.titre': '¡Allá vamos!', 'go.texte': 'La máquina arranca {nom} en unos segundos.', 'go.suivi': 'Puedes seguir el avance aquí.', 'go.changer': 'Cambiar de idea', 'go.disque': 'el disco',
      'load.q': 'EN CURSO', 'load.debut': 'Empezada a las {h} · {m} min transcurridos', 'load.dit': 'Odin se ocupa de todo: puedes dejar este PC, te avisa cuando esté listo.',
      'etape.reseau': 'Red', 'etape.chargeur': 'Cargador', 'etape.menu': 'Menú', 'etape.systeme': 'Sistema', 'etape.installation': 'Instalación', 'etape.logiciels': 'Programas', 'etape.fini': 'Terminado',
      'done.titre': '{nom} está listo', 'done.pc': 'Este PC', 'done.texte': 'Puedes reiniciar desde el disco.', 'done.garde': 'Odin guardó el informe en Génesis.', 'done.autre': 'Elegir otro sistema',
      'wait.titre': 'Espero tu acuerdo…', 'wait.refus': 'Solicitud rechazada', 'wait.texte': 'Odin avisó a tu teléfono y a la app Odin. En cuanto digas que sí, empieza la instalación (el disco se borrará).', 'wait.refus.texte': 'No se borró nada. Elige otra cosa.', 'wait.autre': 'Elegir otra cosa',
      'deja': 'Ya instalado aquí: {nom}',
      'unite.go': 'GB', 'unite.mo': 'MB',
    },
    de: {
      'titre.page': 'Odin · Start',
      'arrivee.reseau': 'Start über das Netzwerk · Menü wird vorbereitet', 'arrivee.cle': 'USB-Stick ODIN · Menü wird vorbereitet',
      'barre.reseau': 'Start über das Netzwerk', 'barre.cle': 'Start vom Stick', 'barre.mode': 'Grafikmodus',
      'ligne.serveur': 'Odin-Server', 'ligne.reseau': 'Start über das Netzwerk', 'ligne.cle': 'Installation per USB-Stick',
      'cat.Tout': 'Alle', 'cat.Windows': 'Windows', 'cat.Linux': 'Linux', 'cat.Serveurs': 'Server', 'cat.Outils': 'Werkzeuge',
      'disp.eventail': 'Fächer', 'disp.affiches': 'Plakate', 'disp.liste': 'Liste',
      'aria.systemes': 'Systeme', 'aria.familles': 'Familien', 'aria.disposition': 'Anordnung',
      'pied.choisir': 'wählen', 'pied.demarrer': 'starten', 'pied.texte': 'Textmodus', 'touche.entree': 'Eingabe',
      'rebours': '{nom} in {n} s', 'rebours.arrete': 'Countdown gestoppt: wähle, wann du willst', 'rebours.disque': 'PC-Festplatte',
      'sous.essai-installer': 'Testen oder installieren', 'sous.essai': 'Startet nur', 'sous.outil': 'Werkzeug · startet nur', 'sous.installer': 'Installieren', 'sous.installe': 'Installiert · behält deine Dateien',
      'disque.titre': 'Von der PC-Festplatte starten', 'disque.sous': 'Nichts wird verändert',
      'desc.reseau': 'Teste es, ohne etwas zu verändern, installiere es selbst oder wähle „Für mich installieren“: ganz allein, nach Zustimmung des Besitzers.',
      'desc.reseau.sansauto': 'Teste es, ohne etwas zu verändern, oder installiere es selbst.',
      'desc.cle': 'Teste es, ohne den PC zu verändern, oder installiere es.', 'desc.outil': 'Startet, ohne etwas zu installieren oder die Festplatte zu berühren.',
      'desc.installe': 'Startet das installierte System, mit deinen Dateien.', 'desc.disque': 'Der PC startet wie gewohnt von seiner eigenen Festplatte.',
      'desc.installer': 'Du wählst die Festplatte, den Namen und die Optionen.', 'verifie': 'von Odin geprüft (Prüfsumme und Virenschutz)',
      'act.essai': 'Testen', 'act.demarrer': 'Starten', 'act.installer.reseau': 'Selbst installieren', 'act.installer.cle': 'Installieren', 'act.auto': 'Für mich installieren', 'act.disque': 'Von der Festplatte starten',
      'apercu': 'Vorschau: es wird nichts gestartet.', 'texte.ok': 'Wechsel in den Textmodus…', 'texte.bientot': 'Der Textmodus ist hier noch nicht angebunden: wähle in diesem Menü.',
      'vide': 'Noch kein System bereit.', 'injoignable': 'Odin antwortet nicht: neuer Versuch…',
      'mac.titre': 'Öffne diesen Bildschirm am Gerät', 'mac.texte': 'Das Gerät, das über das Netzwerk startet, zeigt seinen Link (mit seiner Adresse). Du kannst auch eine Vorschau ansehen.', 'mac.apercu': 'Vorschau ansehen',
      'go.titre': 'Los geht’s', 'go.texte': 'Das Gerät startet {nom} in wenigen Sekunden.', 'go.suivi': 'Du kannst den Fortschritt hier verfolgen.', 'go.changer': 'Doch nicht', 'go.disque': 'die Festplatte',
      'load.q': 'LÄUFT', 'load.debut': 'Begonnen um {h} · {m} min vergangen', 'load.dit': 'Odin kümmert sich um alles: du kannst diesen PC verlassen, er meldet sich, wenn er fertig ist.',
      'etape.reseau': 'Netzwerk', 'etape.chargeur': 'Lader', 'etape.menu': 'Menü', 'etape.systeme': 'System', 'etape.installation': 'Installation', 'etape.logiciels': 'Programme', 'etape.fini': 'Fertig',
      'done.titre': '{nom} ist bereit', 'done.pc': 'Dieser PC', 'done.texte': 'Du kannst von der Festplatte neu starten.', 'done.garde': 'Odin hat den Bericht in Genesis behalten.', 'done.autre': 'Anderes System wählen',
      'wait.titre': 'Ich warte auf deine Zustimmung…', 'wait.refus': 'Anfrage abgelehnt', 'wait.texte': 'Odin hat dein Telefon und die Odin-App benachrichtigt. Sobald du ja sagst, beginnt die Installation (die Festplatte wird gelöscht).', 'wait.refus.texte': 'Nichts wurde gelöscht. Wähle etwas anderes.', 'wait.autre': 'Etwas anderes wählen',
      'deja': 'Hier schon installiert: {nom}',
      'unite.go': 'GB', 'unite.mo': 'MB',
    },
    ja: {
      'titre.page': 'Odin · 起動',
      'arrivee.reseau': 'ネットワーク起動 · メニューを準備中', 'arrivee.cle': 'USBキー ODIN · メニューを準備中',
      'barre.reseau': 'ネットワークから起動', 'barre.cle': 'キーから起動', 'barre.mode': 'グラフィックモード',
      'ligne.serveur': 'Odin サーバー', 'ligne.reseau': 'ネットワーク起動', 'ligne.cle': 'USBキーでインストール',
      'cat.Tout': 'すべて', 'cat.Windows': 'Windows', 'cat.Linux': 'Linux', 'cat.Serveurs': 'サーバー', 'cat.Outils': 'ツール',
      'disp.eventail': '扇形', 'disp.affiches': 'ポスター', 'disp.liste': 'リスト',
      'aria.systemes': 'システム', 'aria.familles': '種類', 'aria.disposition': '表示',
      'pied.choisir': '選ぶ', 'pied.demarrer': '起動', 'pied.texte': 'テキストモード', 'touche.entree': 'Enter',
      'rebours': '{nom} まで {n} 秒', 'rebours.arrete': 'カウントダウン停止：いつでも選べます', 'rebours.disque': 'PCのディスク',
      'sous.essai-installer': '試す・インストール', 'sous.essai': '起動のみ', 'sous.outil': 'ツール · 起動のみ', 'sous.installer': 'インストール', 'sous.installe': 'インストール済み · ファイルを保持',
      'disque.titre': 'PCのディスクから起動', 'disque.sous': '何も変更しません',
      'desc.reseau': '何も変えずに試す、自分でインストールする、または「おまかせインストール」：所有者の同意のあと自動で行います。',
      'desc.reseau.sansauto': '何も変えずに試す、または自分でインストールします。',
      'desc.cle': 'PCを変えずに試すか、インストールします。', 'desc.outil': '何もインストールせず、ディスクにも触れずに起動します。',
      'desc.installe': 'インストール済みのシステムをファイルごと起動します。', 'desc.disque': 'いつものようにPC自身のディスクから起動します。',
      'desc.installer': 'ディスク、名前、オプションを選びます。', 'verifie': 'Odin が確認済み（指紋とウイルス対策）',
      'act.essai': '試す', 'act.demarrer': '起動', 'act.installer.reseau': '自分でインストール', 'act.installer.cle': 'インストール', 'act.auto': 'おまかせインストール', 'act.disque': 'ディスクから起動',
      'apercu': 'プレビュー：何も起動しません。', 'texte.ok': 'テキストモードに切り替え中…', 'texte.bientot': 'テキストモードはまだここにつながっていません：このメニューで選んでください。',
      'vide': '準備できたシステムはまだありません。', 'injoignable': 'Odin が応答しません：再試行中…',
      'mac.titre': 'この画面は端末から開いてください', 'mac.texte': 'ネットワークから起動する端末は、そのリンク（アドレス付き）を表示します。プレビューも見られます。', 'mac.apercu': 'プレビューを見る',
      'go.titre': 'スタート', 'go.texte': '数秒後に {nom} を起動します。', 'go.suivi': '進み具合はここで見られます。', 'go.changer': 'やめる', 'go.disque': 'ディスク',
      'load.q': '進行中', 'load.debut': '{h} に開始 · {m} 分経過', 'load.dit': 'Odin がすべて行います：このPCから離れても大丈夫、終わったら知らせます。',
      'etape.reseau': 'ネットワーク', 'etape.chargeur': 'ローダー', 'etape.menu': 'メニュー', 'etape.systeme': 'システム', 'etape.installation': 'インストール', 'etape.logiciels': 'ソフト', 'etape.fini': '完了',
      'done.titre': '{nom} の準備ができました', 'done.pc': 'このPC', 'done.texte': 'ディスクから再起動できます。', 'done.garde': 'Odin は報告を Genèse に保存しました。', 'done.autre': '別のシステムを選ぶ',
      'wait.titre': '同意を待っています…', 'wait.refus': '依頼は拒否されました', 'wait.texte': 'Odin が電話と Odin アプリに知らせました。「はい」と言うとインストールが始まります（ディスクは消去されます）。', 'wait.refus.texte': '何も消去されていません。別のものを選んでください。', 'wait.autre': '別のものを選ぶ',
      'deja': 'ここにインストール済み：{nom}',
      'unite.go': 'GB', 'unite.mo': 'MB',
    },
  };

  /** Les 9 thèmes graphiques (les mêmes noms que src/valhalla/thjalfi/ecran.ts, THEMES). */
  const THEMES_ECRAN = ['bleu', 'matrix', 'ocean', 'lune', 'ciel', 'galaxie', 'mayotte', 'couchant', 'clair'];
  /** La couleur d'Odin dans chaque thème (son corps prend la couleur du thème ; ses yeux restent blancs). Les teintes
   *  très claires de la maquette (lune, océan, lagon, ciel, matrix, coucher de soleil) sont prises un ton plus soutenu
   *  pour que les deux yeux blancs restent lisibles : au moins 3 pour 1 contre le corps (un essai le vérifie). */
  const COULEUR_ODIN = { bleu: '#5b8def', matrix: '#229a47', ocean: '#2b8fd6', lune: '#9a937c', ciel: '#2f8ae0', galaxie: '#a46bff', mayotte: '#14a3a0', couchant: '#e0612c', clair: '#2457c5' };
  const ETOILES = ['bleu', 'lune', 'galaxie'];

  /** Mélange deux couleurs #rrggbb (part de b). Pur. */
  function melange(a, b, part) {
    const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const x = n(a), y = n(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * part).toString(16).padStart(2, '0')).join('');
  }
  /** Les quatre teintes du corps (centre → bord), comme la maquette (tint) et face.js (dégradé radial). Pur. */
  const teintes = (c) => [melange(c, '#000000', 0.1), c, melange(c, '#ffffff', 0.4), melange(c, '#ffffff', 0.72)];

  /** Les formes d'Odin, reprises À L'IDENTIQUE de src/web/face.js (F.dessin) : yeux et marques d'émotion. */
  const FORMES = {
    // F.dessin('neutre').yeux : les deux pastilles debout (9 × 22).
    neutre: ['<rect class="eye plein" x="43" y="45" width="9" height="22" rx="4.5" fill="#fff"/>', '<rect class="eye plein" x="68" y="45" width="9" height="22" rx="4.5" fill="#fff"/>'],
    // F.dessin('sommeil').yeux : l'œil fermé, la pastille couchée (12 × 4).
    ferme: ['<rect class="plein ferme" x="41.5" y="58" width="12" height="4" rx="2" fill="#fff"/>', '<rect class="plein ferme" x="66.5" y="58" width="12" height="4" rx="2" fill="#fff"/>'],
    // F.dessin('joie').yeux (et 'amour') : la pastille dont le bas est poussé, l'œil qui sourit.
    sourit: ['<path class="eye plein" d="M43 62V50.5a4.5 4.5 0 0 1 9 0V62Q47.5 57.5 43 62Z" fill="#fff"/>', '<path class="eye plein" d="M68 62V50.5a4.5 4.5 0 0 1 9 0V62Q72.5 57.5 68 62Z" fill="#fff"/>'],
    // F.dessin('sommeil').extras : les trois « z ».
    zzz: ['<path class="zz plein dehors" d="M81 27h8.2v2.6L84.51 34.4H89.2v2.6H81v-2.6L85.69 29.6H81Z" fill="#fff" stroke-linejoin="round"/>', '<path class="zz z2 plein dehors" d="M92 18h6.15v1.95L94.63 23.55H98.15v1.95H92v-1.95L95.52 19.95H92Z" fill="#fff" stroke-linejoin="round"/>', '<path class="zz z3 plein dehors" d="M100 11h4.51v1.43L101.93 15.07H104.51v1.43H100v-1.43L102.58 12.43H100Z" fill="#fff" stroke-linejoin="round"/>'],
    // F.dessin('surprise').extras : le point d'exclamation.
    ex: ['<g class="signe"><path class="plein dehors" d="M85.6 16.5h5l-1.1 13.5h-2.8Z" fill="#fff" stroke-linejoin="round"/><circle class="plein dehors" cx="88.1" cy="35.4" r="2.6" fill="#fff"/></g>'],
    // F.dessin('amour').extras : les trois cœurs.
    coeurs: ['<path class="monte coeur" d="M86 34.37C78.18 29.54 82.55 23.33 86 27.93C89.45 23.33 93.82 29.54 86 34.37Z" fill="#F0245F"/>', '<path class="monte m2 coeur" d="M97 22.04C91.56 18.68 94.6 14.36 97 17.56C99.4 14.36 102.44 18.68 97 22.04Z" fill="#F0245F"/>', '<path class="monte m3 coeur" d="M76 21.47C71.58 18.74 74.05 15.23 76 17.83C77.95 15.23 80.42 18.74 76 21.47Z" fill="#F0245F"/>'],
  };
  /** Chaque émotion de l'arrivée : quels yeux, et l'échelle des yeux (face.js : --lsx/--lsy). */
  const POSES = {
    sommeil: { yeux: 'ferme', echelle: [1, 1] },
    surprise: { yeux: 'neutre', echelle: [1.3, 1.25] },
    neutre: { yeux: 'neutre', echelle: [1, 1] },
    joie: { yeux: 'sourit', echelle: [1.05, 1.05] },
    amour: { yeux: 'sourit', echelle: [1.12, 1.12] },
  };
  /**
   * L'ARRIVÉE d'Odin, pas à pas (en millisecondes depuis le début) : il dort (zzz), sursaute (!), se déplace par
   * petits sauts jusqu'au milieu, puis il est content d'être là (♥) ; les trois points tournent pendant ce temps.
   * Ensuite vient le menu. Avec « moins d'animations », il est posé au milieu, content, sans se déplacer.
   */
  const SEQUENCE_ARRIVEE = [
    { a: 0, pose: 'sommeil', marque: 'zzz' },
    { a: 1100, pose: 'surprise', marque: '!' },
    { a: 1800, pose: 'neutre', marque: '', marche: true },
    { a: 3600, pose: 'amour', marque: '♥' },
    { a: 4500, pose: 'joie', marque: '' },
  ];
  const DUREE_ARRIVEE = 5000;

  /** Le dessin d'Odin (le squelette officiel : corps en dégradé, deux halos, yeux) ; `yeux` et `marques` en SVG. */
  function odinDessin(p, classe, yeux, marques) {
    const stop = (o, i) => `<stop offset="${o}" style="stop-color:var(--o${i})"/>`;
    return `<svg class="${classe}" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true">`
      + `<defs><radialGradient id="${p}B" cx="50%" cy="46%" r="54%">${stop(0, 0)}${stop(0.5, 1)}${stop(0.82, 2)}${stop(1, 3)}</radialGradient>`
      + `<radialGradient id="${p}H" cx="50%" cy="50%" r="50%"><stop offset=".8" style="stop-color:var(--o3);stop-opacity:.65"/><stop offset=".93" style="stop-color:var(--o3);stop-opacity:.38"/><stop offset="1" style="stop-color:var(--o3);stop-opacity:0"/></radialGradient>`
      + `<radialGradient id="${p}W" cx="50%" cy="50%" r="50%"><stop offset=".8" stop-color="#FFFFFF" stop-opacity=".72"/><stop offset=".93" stop-color="#FFFFFF" stop-opacity=".4"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>`
      + `<filter id="${p}S" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation=".8"/></filter><filter id="${p}L" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1"/></filter></defs>`
      + `<g class="o-orbit o1"><circle cx="63" cy="64" r="49" fill="url(#${p}H)" filter="url(#${p}L)"/></g>`
      + `<g class="o-orbit o2"><circle cx="57.5" cy="57" r="48" fill="url(#${p}W)" filter="url(#${p}L)"/></g>`
      + `<g class="o-body"><circle cx="60" cy="60" r="44" fill="url(#${p}B)" filter="url(#${p}S)"/>${yeux}</g>${marques || ''}</svg>`;
  }
  /** Odin de l'arrivée : toutes ses émotions sont dessinées, l'écran n'en montre qu'une à la fois (data-pose). */
  const odinArrivee = () => odinDessin('oa', 'odin-fige anime',
    `<g class="oa-y oa-y-neutre">${FORMES.neutre.join('')}</g><g class="oa-y oa-y-ferme">${FORMES.ferme.join('')}</g><g class="oa-y oa-y-sourit">${FORMES.sourit.join('')}</g>`,
    `<g class="oa-m oa-m-zzz">${FORMES.zzz.join('')}</g><g class="oa-m oa-m-ex">${FORMES.ex.join('')}</g><g class="oa-m oa-m-coeur">${FORMES.coeurs.join('')}</g>`);
  /** Le petit Odin du menu (en bas à droite), yeux en pastille qui clignent. */
  const odinPetit = () => odinDessin('og', 'odin-fige anime og', `<g class="og-y">${FORMES.neutre.join('')}</g>`, '');

  // ---------------------------------------------------------------------------
  // La logique de l'écran : PURE, sans rien lire d'autre que ses paramètres (elle est recopiée dans la page).
  // ---------------------------------------------------------------------------
  /** Un mot du dictionnaire dans la langue voulue (repli : le français), avec ses {valeurs}. Pur. */
  function mot(MOTS, langue, k, v) {
    const l = String(langue || 'fr').slice(0, 2).toLowerCase();
    const t = (MOTS[l] && MOTS[l][k]) || (MOTS.fr && MOTS.fr[k]) || k;
    return v ? t.replace(/\{(\w+)\}/g, function (_, n) { return v[n] == null ? '' : String(v[n]); }) : t;
  }
  /** La famille d'un système, toujours l'une des quatre de l'écran (la clé écrit « windows », « linux »…). Pur. */
  function categorie(c) {
    const v = String(c || '').toLowerCase();
    if (v === 'windows') return 'Windows';
    if (v === 'serveurs' || v === 'serveur') return 'Serveurs';
    if (v === 'outils' || v === 'outil' || v === 'autre') return 'Outils';
    return 'Linux';
  }
  /**
   * Ce que l'écran PROPOSE pour un système, selon d'où il démarre : « demarrer » (clé) devient « essai » ; « Installer
   * pour moi » (auto) n'existe QUE par le réseau (sur la clé, personne ne peut donner son accord). Pur.
   */
  function modesPour(source, modes) {
    const out = [];
    for (const m of Array.isArray(modes) ? modes : []) {
      const k = m === 'demarrer' ? 'essai' : m;
      if ((k === 'essai' || k === 'installer' || (k === 'auto' && source !== 'cle')) && out.indexOf(k) < 0) out.push(k);
    }
    return ['essai', 'installer', 'auto'].filter(function (k) { return out.indexOf(k) >= 0; });
  }
  /** Les systèmes dans l'ORDRE CHOISI (liste d'identifiants), sans ceux qui sont cachés ; les autres suivent. Pur. */
  function ordonner(systemes, ordre, caches) {
    const l = (Array.isArray(systemes) ? systemes : []).filter(function (x) { return x && typeof x === 'object' && x.id != null; });
    const cache = Array.isArray(caches) ? caches.map(String) : [];
    const rang = Array.isArray(ordre) ? ordre.map(String) : [];
    const pos = function (x) { const i = rang.indexOf(String(x.id)); return i < 0 ? rang.length : i; };
    return l.filter(function (x) { return cache.indexOf(String(x.id)) < 0; })
      .map(function (x, i) { return { x: x, i: i }; })
      .sort(function (a, b) { return pos(a.x) - pos(b.x) || a.i - b.i; })
      .map(function (e) { return e.x; });
  }
  /**
   * L'APPARENCE de l'écran (thème graphique, thème texte, mode au démarrage, Odin à l'ouverture, délai), pour la clé
   * ou pour le réseau. Un seul réglage commun ; l'interrupteur « Mêmes thèmes que mes clés ODIN » (memes, allumé par
   * défaut) donne au réseau EXACTEMENT celui des clés ; coupé, le réseau garde le sien. Le graphique est le mode par
   * défaut, T passe en texte. Pur.
   */
  function apparencePour(source, r) {
    const base = { theme: 'bleu', texte: 'matrix', mode: 'graphique', mascotte: true, delai: 10 };
    const ok = function (a) {
      const o = {};
      for (const k in base) o[k] = base[k];
      if (a && typeof a === 'object') for (const k in base) if (a[k] !== undefined && a[k] !== null) o[k] = a[k];
      if (['bleu', 'matrix', 'ocean', 'lune', 'ciel', 'galaxie', 'mayotte', 'couchant', 'clair'].indexOf(o.theme) < 0) o.theme = 'bleu';
      if (o.mode !== 'texte') o.mode = 'graphique';
      o.mascotte = o.mascotte !== false;
      o.delai = Math.max(0, Math.min(600, Math.round(Number(o.delai) || 0)));
      return o;
    };
    const reg = r && typeof r === 'object' ? r : {};
    if (source === 'reseau' && reg.memes === false) return ok(reg.reseau);
    return ok(reg.commun);
  }
  /**
   * Ce qui démarre tout seul à la fin du compte à rebours : par le réseau, le disque du PC (sauf un autre défaut
   * choisi) ; sur la clé, le système par défaut (ou le premier). JAMAIS une installation : seulement « essayer »
   * (ou le disque). Rien si le défaut ne sait pas démarrer ainsi. Pur.
   */
  function cibleDefaut(systemes, source, defaut) {
    const l = Array.isArray(systemes) ? systemes : [];
    if (source !== 'cle' && (!defaut || defaut === 'disque')) return { id: 'disque', mode: 'disque' };
    const x = defaut ? l.find(function (y) { return String(y.id) === String(defaut); }) : (source === 'cle' ? l[0] : undefined);
    if (x && Array.isArray(x.modes) && x.modes.indexOf('essai') >= 0) return { id: String(x.id), mode: 'essai' };
    return null;
  }
  /** La petite ligne sous le nom d'un système (clé du dictionnaire « sous.* »). Pur. */
  function sousTitre(x) {
    const m = (x && x.modes) || [];
    if (x && ['installe', 'persistance', 'vm'].indexOf(x.genre) >= 0) return 'installe';
    const essai = m.indexOf('essai') >= 0, inst = m.indexOf('installer') >= 0 || m.indexOf('auto') >= 0;
    if (essai && inst) return 'essai-installer';
    if (essai) return x && x.category === 'Outils' ? 'outil' : 'essai';
    return inst ? 'installer' : 'essai';
  }
  /** La description du panneau de détail (clé du dictionnaire « desc.* »). Pur. */
  function descCle(x, source) {
    if (!x) return 'outil';
    if (x.disque) return 'disque';
    const m = x.modes || [];
    if (['installe', 'persistance', 'vm'].indexOf(x.genre) >= 0) return 'installe';
    if (m.indexOf('installer') < 0 && m.indexOf('auto') < 0) return 'outil';
    if (m.indexOf('essai') < 0) return 'installer';
    if (source === 'cle') return 'cle';
    return m.indexOf('auto') >= 0 ? 'reseau' : 'reseau.sansauto';
  }
  /**
   * Le CLAVIER de l'écran, en pur : ce que fait une touche selon la vue. ← → ↑ ↓ choisir (↑ ↓ sautent d'une rangée
   * en affiches), Début/Fin, Entrée démarrer, I installer, A « pour moi » (réseau seulement), T mode texte,
   * D disposition, Tab famille suivante, Échap arrête l'attente. Pendant l'arrivée, toute touche passe au menu.
   * Rend null si la touche ne fait rien. Pur.
   */
  function clavier(k, s) {
    const n = Math.max(0, s.n | 0), sel = Math.max(0, Math.min(n - 1, s.sel | 0)), pas = Math.max(1, s.pas | 0);
    if (s.vue === 'arrivee') return { passer: true };
    if (s.vue !== 'choix') return k === 'Escape' && s.vue === 'go' ? { vue: 'choix' } : null;
    if (k === 'ArrowRight') return { sel: Math.min(n - 1, sel + 1) };
    if (k === 'ArrowLeft') return { sel: Math.max(0, sel - 1) };
    if (k === 'ArrowDown') return { sel: Math.min(n - 1, sel + pas) };
    if (k === 'ArrowUp') return { sel: Math.max(0, sel - pas) };
    if (k === 'Home') return { sel: 0 };
    if (k === 'End') return { sel: Math.max(0, n - 1) };
    if (k === 'Enter') return { lancer: 'principal' };
    if (k === 'i' || k === 'I') return { lancer: 'installer' };
    if (k === 'a' || k === 'A') return s.cle ? null : { lancer: 'auto' };
    if (k === 't' || k === 'T') return { texte: true };
    if (k === 'd' || k === 'D') return { disp: true };
    if (k === 'Tab') return { cat: s.shift ? -1 : 1 };
    if (k === 'Escape') return { stop: true };
    return null;
  }
  const LOGIQUE = { mot, categorie, modesPour, ordonner, apparencePour, cibleDefaut, sousTitre, descCle, clavier };

  /** Les données de l'écran (posées telles quelles dans la page). */
  const donneesEcran = () => ({
    MOTS: MOTS_ECRAN, THEMES: THEMES_ECRAN, STARS: ETOILES, SEQ: SEQUENCE_ARRIVEE, DUREE: DUREE_ARRIVEE,
    TEINTES: Object.fromEntries(THEMES_ECRAN.map((t) => [t, teintes(COULEUR_ODIN[t])])),
  });

  // ---------------------------------------------------------------------------
  // Le style de l'écran (sous .oe : il vit aussi bien seul dans la page servie que dans l'aperçu de la page).
  // Tout texte est posé sur un PANNEAU (var(--p)), jamais à même le décor. Taille du texte : suit la largeur de
  // l'écran (1280 px comme la maquette, plus grand sur une télé).
  // ---------------------------------------------------------------------------
  function cssEcran() {
    return `.oe{position:relative;width:100%;height:100%;overflow:hidden;container:oe/inline-size;color:#eef2ff;background:#0b1440;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;--ink:#eef2ff;--mut:#9fb0d8;--card:rgba(20,28,64,.72);--line:rgba(255,255,255,.12);--acc:#ffd166;--accfg:#3a2a00;--p:rgba(10,18,60,.82);--pi:#fff;--pm:rgba(255,255,255,.74);--pa:#9fd6ff;--pf:#0a1240;--pb:rgba(255,255,255,.16);--sel:rgba(255,255,255,.16);--o0:#2F6FE0;--o1:#3F82F0;--o2:#7EAEF8;--o3:#C3DBFF}
.oe.plein{position:fixed;inset:0;width:auto;height:auto}
.oe *{box-sizing:border-box}
.oe-in{position:absolute;inset:0;font-size:clamp(12px,1.06cqw,24px);line-height:1.4}
.oe.bleu,body.bleu{background:radial-gradient(1200px 700px at 50% 30%,#2a4bd1,#0b1440 70%);--acc:#ffffff;--accfg:#14204f}
.oe.matrix,body.matrix{background:#000;--ink:#b8ffca;--mut:#5fbf7a;--card:rgba(0,25,8,.78);--line:rgba(61,255,122,.35);--acc:#3dff7a;--accfg:#001a07;--p:rgba(0,12,4,.9);--pi:#c8ffd4;--pm:#7dff9b;--pa:#3dff7a;--pf:#001a07;--pb:rgba(61,255,122,.3);--sel:rgba(61,255,122,.16)}
.oe.matrix .oe-in{font-family:'DejaVu Sans Mono',Consolas,monospace}
.oe.ocean,body.ocean{background:linear-gradient(180deg,#7fd3ff 0,#2b8fd6 38%,#0a4f8a 60%,#062b52);--p:rgba(3,30,60,.84);--pa:#7fd3ff;--pf:#03213f}
.oe.lune,body.lune{background:radial-gradient(120% 120% at 70% 20%,#2a2d3e,#0b0c14);--acc:#f4f1e8;--accfg:#1a1c26;--p:rgba(26,28,38,.9);--pi:#fff7d6;--pm:#e9e6dc;--pa:#f4f1e8;--pf:#1a1c26;--pb:rgba(244,241,232,.22)}
.oe.ciel,body.ciel{--chip:rgba(11,42,74,.08);background:linear-gradient(180deg,#4aa8ff,#9fd6ff 70%,#e6f5ff);--ink:#0b2a4a;--mut:#2f5a80;--card:rgba(255,255,255,.82);--line:rgba(11,42,74,.16);--acc:#0b2a4a;--accfg:#ffffff;--p:rgba(255,255,255,.92);--pi:#0b2a4a;--pm:#2f5a80;--pa:#2f7fe0;--pf:#ffffff;--pb:rgba(11,42,74,.14);--sel:rgba(74,168,255,.16)}
.oe.galaxie,body.galaxie{background:radial-gradient(60vw 40vw at 30% 40%,rgba(160,60,255,.45),transparent 70%),radial-gradient(50vw 35vw at 75% 60%,rgba(255,60,170,.35),transparent 70%),#07051a;--acc:#c9a2ff;--accfg:#1a0a3d;--p:rgba(20,8,48,.86);--pa:#c9a2ff;--pf:#1a0a3d;--sel:rgba(201,162,255,.18)}
.oe.mayotte,body.mayotte{--chip:rgba(11,42,74,.08);background:linear-gradient(180deg,#7fe3ff,#26c6c6 45%,#0f8a83 70%,#e9d8a6 71%,#d9c48a);--ink:#06323a;--mut:#24585f;--card:rgba(255,255,255,.72);--line:rgba(6,50,58,.18);--p:rgba(255,255,255,.92);--pi:#06323a;--pm:#0f5e62;--pa:#0f8a83;--pf:#ffffff;--pb:rgba(6,50,58,.16);--sel:rgba(38,198,198,.18)}
.oe.couchant,body.couchant{background:linear-gradient(180deg,#2b1055,#7a1f6b 35%,#ff6a3d 62%,#ffb36b 63%,#3a1a4a);--acc:#ffd36b;--card:rgba(43,16,85,.62);--accfg:#3a1a00;--p:rgba(43,16,85,.86);--pa:#ffd36b;--pf:#2b1055;--sel:rgba(255,211,107,.18)}
.oe.clair,body.clair{--chip:rgba(11,42,74,.08);background:#f6f7fb;--ink:#141b2e;--mut:#56607a;--card:#fff;--line:#d8deea;--acc:#2457c5;--accfg:#ffffff;--p:#ffffff;--pi:#14202e;--pm:#4c5b6b;--pa:#2457c5;--pf:#ffffff;--pb:rgba(11,42,74,.12);--sel:rgba(36,87,197,.12)}
.oe.img{background:#000 var(--fond) center/cover no-repeat}.oe.img .deco,.oe.img .stars{display:none}
.oe .tint{position:absolute;inset:0;pointer-events:none;display:none}.oe.img .tint{display:block;background:var(--tint,rgba(5,10,30,.45))}
.oe .deco{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.oe .rain{position:absolute;top:0;font:18px/1.1 monospace;color:#3dff7a;writing-mode:vertical-rl;text-shadow:0 0 8px #3dff7a;opacity:.5;transform:translateY(-100%);animation:oe-pluie linear infinite}@keyframes oe-pluie{from{transform:translateY(-100%)}to{transform:translateY(70cqw)}}
.oe .wave{position:absolute;left:-10%;right:-10%;height:40%;border-radius:45%;animation:oe-vague 9s ease-in-out infinite alternate}@keyframes oe-vague{to{transform:translateX(6%) translateY(-3%)}}
.oe .cloud{position:absolute;background:#fff;border-radius:99px;box-shadow:60px -22px 0 4px #fff,120px 4px 0 -6px #fff;animation:oe-nuage 60s linear infinite}@keyframes oe-nuage{from{transform:translateX(-30cqw)}to{transform:translateX(120cqw)}}
.oe .moon{position:absolute;right:6%;top:7%;width:22%;aspect-ratio:1;max-width:22vh;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fbf8ef,#d9d4c4 60%,#a9a391);box-shadow:0 0 80px rgba(255,250,230,.35)}.oe .moon i{position:absolute;border-radius:50%;background:rgba(150,140,120,.35)}
.oe .sun{position:absolute;left:50%;top:30%;width:34%;aspect-ratio:1;max-width:46vh;transform:translateX(-50%);border-radius:50%;background:repeating-linear-gradient(180deg,#ffd36b 0 9%,#ff7a3d 9% 11.5%);-webkit-mask:linear-gradient(#000 60%,transparent 60%);mask:linear-gradient(#000 60%,transparent 60%)}
.oe .stars{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(1.5px 1.5px at 20% 30%,#fff8,transparent),radial-gradient(1px 1px at 70% 20%,#fff9,transparent),radial-gradient(1.5px 1.5px at 40% 80%,#fff6,transparent),radial-gradient(1px 1px at 85% 60%,#fff8,transparent),radial-gradient(1px 1px at 10% 70%,#fff7,transparent),radial-gradient(2px 2px at 60% 50%,#fff5,transparent)}
.oe .odin-fige{display:block}.oe .odin-fige .o-orbit{transform-origin:60px 60px}
.oe .odin-fige.anime .o1{animation:od-orbite 7s linear infinite}.oe .odin-fige.anime .o2{animation:od-orbite 9s linear infinite reverse}
.oe .odin-fige.anime .o-body{transform-origin:60px 60px;animation:od-souffle 3.4s ease-in-out infinite}
@keyframes od-orbite{to{transform:rotate(360deg)}}@keyframes od-souffle{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
.premier{position:absolute;inset:0;--w:clamp(84px,9.4cqw,200px)}
.premier[hidden],.gmenu[hidden],.godin[hidden],.gfoot[hidden]{display:none}
.premier .mark{position:absolute;left:1.4em;top:1.3em;padding:.45em .9em;border-radius:.85em;background:var(--p);color:var(--pi);font-weight:800;letter-spacing:.18em;border:1px solid var(--pb)}
.oa-walker{position:absolute;left:50%;top:44%;width:var(--w);height:var(--w);margin:calc(var(--w) / -2) 0 0 calc(var(--w) / -2);--ax:100%}
.oa-walker svg{width:100%;height:100%;overflow:visible}
.oa-walker.depart{transform:translate(calc(var(--ax) * -3),18%) scale(.8)}
.oa-walker.marche{animation:oa-marche 1.8s linear forwards}
@keyframes oa-marche{0%{transform:translate(calc(var(--ax) * -3),18%) scale(.8)}10%{transform:translate(calc(var(--ax) * -2.62),-6%) scale(.82)}20%{transform:translate(calc(var(--ax) * -2.25),18%) scale(.84)}30%{transform:translate(calc(var(--ax) * -1.88),-6%) scale(.86)}40%{transform:translate(calc(var(--ax) * -1.5),16%) scale(.88)}50%{transform:translate(calc(var(--ax) * -1.15),-6%) scale(.9)}60%{transform:translate(calc(var(--ax) * -.82),14%) scale(.92)}70%{transform:translate(calc(var(--ax) * -.52),-5%) scale(.95)}80%{transform:translate(calc(var(--ax) * -.26),10%) scale(.97)}90%{transform:translate(calc(var(--ax) * -.08),-3%) scale(.99)}100%{transform:translate(0,0) scale(1)}}
.oa-y,.oa-m{display:none}
.oa-walker[data-pose=neutre] .oa-y-neutre,.oa-walker[data-pose=surprise] .oa-y-neutre,.oa-walker[data-pose=sommeil] .oa-y-ferme,.oa-walker[data-pose=joie] .oa-y-sourit,.oa-walker[data-pose=amour] .oa-y-sourit{display:inline}
.oa-walker .oa-y>*{transform-box:fill-box;transform-origin:center;transition:transform .18s}
.oa-walker[data-pose=surprise] .oa-y-neutre>*{transform:scale(1.3,1.25)}
.oa-walker[data-pose=joie] .oa-y-sourit>*{transform:scale(1.05)}
.oa-walker[data-pose=amour] .oa-y-sourit>*{transform:scale(1.12)}
.oa-walker[data-marque=zzz] .oa-m-zzz,.oa-walker[data-marque="!"] .oa-m-ex,.oa-walker[data-marque="♥"] .oa-m-coeur{display:inline;animation:oa-monte .45s ease-out}
@keyframes oa-monte{from{transform:translateY(6px)}to{transform:none}}
.oa-m .dehors{stroke:var(--o0);stroke-width:1.4px;paint-order:stroke}.oa-m .coeur{stroke:#fff;stroke-width:1.2px;paint-order:stroke}
.premier .od-points{position:absolute;left:50%;top:calc(44% + var(--w) * .62);transform:translateX(-50%);display:flex;gap:.75em}
.oe .od-points i{width:.85em;height:.85em;border-radius:50%;background:var(--pa);opacity:.35;animation:od-point 1.2s ease-in-out infinite}
.oe .od-points i:nth-child(2){animation-delay:.18s}.oe .od-points i:nth-child(3){animation-delay:.36s}
@keyframes od-point{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-6px)}}
.premier .line{position:absolute;left:50%;top:calc(44% + var(--w) * .62 + 2.4em);transform:translateX(-50%);padding:.45em 1.1em;border-radius:999px;background:var(--p);color:var(--pi);font-weight:600;white-space:nowrap;border:1px solid var(--pb);max-width:92%;overflow:hidden;text-overflow:ellipsis}
.gmenu{position:absolute;inset:0;display:flex;flex-direction:column;padding:1.15em;gap:.85em}
.gbar{display:flex;align-items:center;gap:.7em;padding:.55em .85em;border-radius:1.15em;background:var(--p);color:var(--pi);border:1px solid var(--pb);min-height:3.4em}
.gbar .nmk{font-weight:800;letter-spacing:.16em;font-size:.95em;display:flex;align-items:center;gap:.5em;white-space:nowrap}
.gbar .nmk small{letter-spacing:0;font-weight:500;color:var(--pm);font-size:.9em}
.gbar .cats{display:flex;gap:.25em;flex-wrap:wrap}
.gbar button{min-height:2.6em;padding:0 .9em;border-radius:999px;border:0;background:none;color:var(--pm);font:inherit;font-size:.9em;font-weight:600;cursor:pointer}
.gbar button[aria-pressed=true]{background:var(--pi);color:var(--p)}
.oe.ciel .gbar button[aria-pressed=true],.oe.mayotte .gbar button[aria-pressed=true],.oe.clair .gbar button[aria-pressed=true]{background:var(--pi);color:#fff}
.gbar .clock{margin-left:auto;text-align:right;font-weight:800;font-size:1.3em;line-height:1}
.gbar .clock small{display:block;font-weight:500;font-size:.62em;color:var(--pm);margin-top:.2em}
.gbody{flex:1;min-height:0;display:flex;gap:.85em}
.glist{flex:1;min-width:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(11em,1fr));gap:.7em;align-content:start;overflow:auto;padding:.2em;scrollbar-width:thin}
.glist.liste{grid-template-columns:1fr}
.glist.eventail{display:block;position:relative;overflow:hidden;perspective:1200px}
.gcard{border-radius:1.15em;border:1.5px solid var(--pb);background:var(--p);color:var(--pi);padding:.85em;display:flex;flex-direction:column;gap:.55em;text-align:left;min-height:44px;cursor:pointer;transition:box-shadow .2s,background .2s}
.gcard[aria-selected=true]{border-color:var(--pa);box-shadow:0 0 0 3px color-mix(in srgb,var(--pa) 40%,transparent);background:linear-gradient(var(--sel),var(--sel)),var(--p)}
.glist.liste .gcard{flex-direction:row;align-items:center;padding:.55em .8em}
.glist.eventail .gcard{position:absolute;left:50%;top:50%;width:13em;height:15.5em;margin:-7.75em 0 0 -6.5em;justify-content:flex-end;transition:transform .35s,opacity .35s,box-shadow .2s}
.glist.eventail .gcard .mono-ic{position:absolute;top:.9em;left:.9em}
.gcard .gt{display:flex;flex-direction:column;gap:.15em;min-width:0}
.gcard b{font-size:1em;line-height:1.25;overflow-wrap:anywhere}
.gcard small{color:var(--pm);font-size:.82em}
.mono-ic{width:2.85em;height:2.85em;border-radius:.8em;display:grid;place-items:center;font-weight:800;font-size:1.1em;color:#fff;flex:none;box-shadow:inset 0 -.6em 1em rgba(0,0,0,.12)}
.glist .mono-ic{font-size:1.1em}
.mono-ic svg{width:55%;height:55%}
.gside{width:18.5em;flex:none;border-radius:1.15em;background:var(--p);color:var(--pi);border:1px solid var(--pb);padding:1em;display:flex;flex-direction:column;gap:.55em;overflow:auto}
.gside h4{margin:0;font-size:1.2em;line-height:1.25}
.gside p{margin:0;font-size:.9em;color:var(--pm)}
.gside .ss{color:var(--pi);opacity:.85}
.gside .meta{font-size:.8em}
.gside .msg{color:var(--pi);background:var(--sel);border-radius:.7em;padding:.5em .7em}
.gside .acts{display:flex;flex-direction:column;gap:.45em;margin-top:auto}
.gside .acts button,.oe .pan button{min-height:max(44px,3.1em);border-radius:.85em;border:1px solid var(--pb);background:none;color:var(--pi);font:inherit;font-weight:600;cursor:pointer;padding:0 1em}
.gside .acts button.go{background:var(--pa);color:var(--pf);border-color:transparent}
.oe:not([data-vue=choix]) .gside,.oe:not([data-vue=choix]) .gbar .cats{display:none}
.glist.pleine{display:block;overflow:auto}
.gfoot{display:flex;gap:.7em 1.1em;align-items:center;padding:.45em .85em;border-radius:.85em;background:var(--p);color:var(--pm);font-size:.86em;border:1px solid var(--pb);flex-wrap:wrap;min-height:2.6em}
.gfoot kbd{font:700 .9em ui-monospace,Consolas,monospace;padding:.1em .45em;border-radius:.35em;border:1px solid var(--pb);color:var(--pi);margin-right:.2em}
.gfoot .cd{margin-left:auto;color:var(--pi);font-weight:600;display:inline-flex;align-items:center}
.gfoot .cd.off{font-weight:500;color:var(--pm)}
.gfoot .cd i{display:inline-block;width:5.8em;height:.45em;border-radius:.25em;background:var(--pb);margin-left:.6em;overflow:hidden;position:relative}
.gfoot .cd i::after{content:"";position:absolute;inset:0;width:var(--cd,70%);background:var(--pa);transition:width 1s linear}
.godin{position:absolute;right:1.9em;top:5.7em;width:3.4em;height:3.4em;pointer-events:none}
.oe:not([data-vue=choix]) .godin{display:none}
.gside h4{padding-right:3em}
.godin svg{width:100%;height:100%}
.og .og-y>*{transform-box:fill-box;transform-origin:center;animation:og-cligne 5.2s infinite}
@keyframes og-cligne{0%,91%,100%{transform:scaleY(1)}93.5%{transform:scaleY(.08)}96%{transform:scaleY(1)}}
.oe .pan{max-width:44em;margin:4% auto 0;padding:1.6em 1.8em;border-radius:1.2em;background:var(--p);color:var(--pi);border:1px solid var(--pb);text-align:center;display:flex;flex-direction:column;gap:.6em;align-items:center}
.oe .pan h1{font-size:2em;margin:.1em 0;line-height:1.2}.oe .pan p{margin:0;color:var(--pm)}.oe .pan .q{letter-spacing:.14em;color:var(--pm);font-size:.85em}
.oe .bar{display:flex;gap:.6em;flex-wrap:wrap;justify-content:center;margin-top:.6em}
.bar .y{background:var(--acc);color:var(--accfg,#3a2a00)}
.oe .pg{width:100%;height:1.15em;border-radius:.6em;background:var(--pb);overflow:hidden;margin:1em 0 .3em}.oe .pg i{display:block;height:100%;transition:width .6s}
.pg i{background:linear-gradient(90deg,var(--acc),#fff)!important}
.oe .pgl{display:flex;justify-content:space-between;width:100%;color:var(--pm);font-size:.9em}
.oe .steps{display:flex;gap:.6em;justify-content:center;margin-top:.8em;flex-wrap:wrap}.oe .steps span{padding:.5em .9em;border-radius:.8em;background:var(--sel);font-size:.9em}.oe .steps .ok{background:rgba(52,199,123,.25)}.oe .steps .cur{background:rgba(255,209,102,.3)}
.oe .od3{display:inline-flex;gap:.65em;margin-top:.6em}.oe .od3 i{width:.7em;height:.7em;border-radius:50%;background:var(--pa);opacity:.35;animation:od-point 1.2s ease-in-out infinite}.oe .od3 i:nth-child(2){animation-delay:.2s}.oe .od3 i:nth-child(3){animation-delay:.4s}
.oe .srv{color:var(--pm);font-size:.9em;letter-spacing:.04em}
@container oe (max-width:700px){
.premier{--w:96px}.oa-walker{--ax:45%}.premier .line{white-space:normal;text-align:center;width:max-content;max-width:86%}
.gmenu{padding:.7em;gap:.55em}.gbar .cats{display:none}.gbar{min-height:0}
.gbody{flex-direction:column}.glist,.glist.affiches,.glist.eventail{display:grid;grid-template-columns:1fr;gap:.45em;overflow:auto;flex:1;min-height:6em;perspective:none}
.gside .meta{display:none}.gside .acts{margin-top:.3em}.gside h4{padding-right:0}
.glist .gcard,.glist.eventail .gcard{position:static;width:auto;height:auto;margin:0;flex-direction:row;align-items:center;padding:.5em .7em;transform:none!important;opacity:1!important}
.glist.eventail .gcard .mono-ic{position:static}.mono-ic{width:2.4em;height:2.4em}
.gside{width:auto;flex:none;padding:.8em}.gside .acts{flex-direction:row;flex-wrap:wrap}.gside .acts button{flex:1 1 8em}
.gfoot .hide-p{display:none}.godin{display:none}.oe .pan{margin-top:2%;padding:1.1em}.oe .pan h1{font-size:1.5em}}
@media (prefers-reduced-motion:reduce){.oe *,.oe *::before,.oe *::after{animation:none!important;transition:none!important}.oe .od-points i,.oe .od3 i{opacity:.8}}`;
  }

  /** Le squelette de l'écran (sans aucune donnée) : l'arrivée d'Odin, puis le menu, cachés tant que rien n'est lu. */
  function corpsEcran() {
    return '<div class="oe-in"><div class="deco"></div><div class="stars"></div><div class="tint"></div>'
      + '<div class="premier" id="arrivee"><span class="mark">ODIN</span>'
      + `<div class="oa-walker" id="walker" data-pose="sommeil" data-marque="zzz">${odinArrivee()}</div>`
      + '<div aria-hidden="true" class="od-points"><i></i><i></i><i></i></div>'
      + '<span class="line" id="premierSrv" role="status"></span></div>'
      + '<div class="gmenu" id="menu" hidden><div class="gbar"><span class="nmk">ODIN <small id="logoSub"></small></span>'
      + '<span class="cats" id="tabs" role="group"></span><span class="cats disp" id="disp" role="group"></span>'
      + '<span class="clock"><b id="hh"></b><small id="dd"></small></span></div>'
      + '<div class="gbody"><div class="glist" id="main" role="listbox"></div><aside class="gside" id="side" aria-live="polite"></aside></div>'
      + '<div class="gfoot" id="foot"></div></div>'
      + `<span class="godin" id="godin" hidden aria-hidden="true">${odinPetit()}</span></div>`;
  }

  /**
   * L'écran qui VIT : arrivée d'Odin, menu, compte à rebours, clavier, souris. R = la racine .oe ; o = { L (logique),
   * D (données), etat (aperçu : l'état donné, rien n'est demandé au serveur), apercu, source, vue, cible (où écouter
   * le clavier ; sinon toute la fenêtre) }. Recopiée telle quelle dans la page servie : n'utilise que R et o.
   * Rend { arreter } (l'aperçu s'en sert pour rejouer sans laisser de minuterie).
   */
  function demarrer(R, o) {
    const L = o.L, D = o.D, doc = R.ownerDocument, W = doc.defaultView;
    const SEUL = !o.etat;
    const qs = new W.URLSearchParams(SEUL ? W.location.search : '');
    const MAC = qs.get('mac') || '', APERCU = Boolean(o.apercu) || qs.has('apercu');
    const CLE=qs.has('cle')||o.source==='cle';
    const SOURCE = CLE ? 'cle' : 'reseau';
    const $ = (s) => R.querySelector(s);
    const reduit = () => { try { return W.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
    let S = o.etat || null, cat = 'Tout', sel = 0, disp = null, theme = null, view = 'arrivee', msg = '', goName = '', fini = false;
    let rebours = null, reboursFin = false, reboursVu = false, tic = null, decoDe = '', vivant = true;
    const minuteries = [];
    const plusTard = (f, ms) => { minuteries.push(W.setTimeout(() => { if (vivant) f(); }, ms)); };
    const langue = () => { const l = String((S && S.langue) || o.langue || (W.navigator && W.navigator.language) || 'fr'); return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l) ? l : 'fr'; };
    const M = (k, v) => L.mot(D.MOTS, langue(), k, v);
    const el = (t, a, ...k) => {
      const n = doc.createElement(t);
      for (const [x, v] of Object.entries(a || {})) { if (v == null || v === false) continue; if (x.startsWith('on')) n.addEventListener(x.slice(2), v); else if (x === 'class') n.className = v; else n.setAttribute(x, v === true ? '' : v); }
      for (const c of k.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : doc.createTextNode(String(c)));
      return n;
    };
    const couleur = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '#5b6cd6');
    const taille = (b) => { const n = Number(b) || 0; if (!n) return ''; return n >= 1e9 ? (n / 1e9).toLocaleString(langue(), { maximumFractionDigits: 1 }) + ' ' + M('unite.go') : Math.max(1, Math.round(n / 1e6)) + ' ' + M('unite.mo'); };
    function ligneSrc(){if(CLE)return M('ligne.cle');return S&&S.serveur?M('ligne.serveur')+' '+S.serveur:M('ligne.reseau');}
    const tous = () => (!S ? [] : L.ordonner(S.systemes, S.ordre, S.caches).map((x) => Object.assign({}, x, { category: L.categorie(x.category), modes: L.modesPour(SOURCE, x.modes) })));
    function list() {
      const t = tous().filter((x) => cat === 'Tout' || x.category === cat);
      if (!CLE && cat === 'Tout' && S && S.disque !== false) t.push({ id: 'disque', disque: true, title: M('disque.titre'), version: '', modes: [], color: '#5b6b7a' });
      return t;
    }
    const cur = () => { const l = list(); return l[Math.max(0, Math.min(sel, l.length - 1))]; };
    const cats = () => { const vus = tous().map((x) => x.category); return ['Tout'].concat(['Windows', 'Linux', 'Serveurs', 'Outils'].filter((c) => vus.indexOf(c) >= 0)); };
    const titre = (x) => (x.disque ? M('disque.titre') : String(x.title || x.name || '?') + (x.version ? ' ' + x.version : ''));
    const principal = (x) => (!x ? null : x.disque ? 'disque' : x.modes.indexOf('essai') >= 0 ? 'essai' : x.modes.indexOf('installer') >= 0 ? 'installer' : null);
    const libAct = (x, k) => (k === 'essai' ? (['installe', 'persistance', 'vm'].indexOf(x.genre) >= 0 ? 'act.demarrer' : 'act.essai') : k === 'installer' ? (CLE ? 'act.installer.cle' : 'act.installer.reseau') : 'act.auto');

    // ---- l'arrivée d'Odin
    function arrivee() {
      const w = $('#walker');
      $('#premierSrv').textContent = M(CLE ? 'arrivee.cle' : 'arrivee.reseau');
      if (reduit()) { w.className = 'oa-walker'; w.dataset.pose = 'joie'; w.dataset.marque = ''; plusTard(finArrivee, 1200); return; }
      w.className = 'oa-walker depart';
      for (const s of D.SEQ) plusTard(() => { w.dataset.pose = s.pose; w.dataset.marque = s.marque || ''; if (s.marche) w.className = 'oa-walker marche'; }, s.a);
      plusTard(finArrivee, D.DUREE);
    }
    function finArrivee() { fini = true; if (S && view === 'arrivee') entrerMenu(); }
    function entrerMenu() {
      if (view !== 'arrivee') return;
      view = 'choix'; $('#arrivee').hidden = true; $('#menu').hidden = false; $('#godin').hidden = false;
      const l = list(), c = L.cibleDefaut(tous(), SOURCE, S && S.defaut);
      // Le défaut est choisi d'avance (Entrée le démarre) ; si c'est le disque du PC, on commence par la 1re carte.
      if (c && c.id !== 'disque') { const i = l.findIndex((x) => x.id === c.id); if (i >= 0) sel = i; }
      draw(); demarrerRebours();
      if (typeof o.surMenu === 'function') o.surMenu();
    }

    // ---- le compte à rebours (le défaut démarre seul ; toute touche ou tout clic l'arrête). Il ne tourne QUE quand
    // le menu est à l'écran : jamais pendant une installation, une demande d'accord, « C'est parti » ou sans machine
    // (sinon il enverrait « disque » à la place du choix déjà fait).
    const auMenu = () => R.dataset.vue === 'choix';
    function demarrerRebours() {
      if (rebours || reboursFin || !S) return;
      const c = L.cibleDefaut(tous(), SOURCE, S.defaut), d = Math.round(Number(S.delai == null ? 10 : S.delai));
      if (!c || !(d > 0) || !auMenu()) { reboursFin = true; return; }
      rebours = { cible: c, reste: d, total: d }; reboursVu = true;
      tic = W.setInterval(() => {
        if (!vivant || !rebours) return;
        if (!auMenu()) { arreterRebours(); return; }
        rebours.reste -= 1;
        if (rebours.reste > 0) { pied(); return; }
        const c2 = rebours.cible; arreterRebours();
        if (c2.mode === 'disque') choose('disque'); else choose(c2.mode, c2.id);
      }, 1000);
      pied();
    }
    function arreterRebours() { if (tic) W.clearInterval(tic); tic = null; rebours = null; reboursFin = true; pied(); }

    // ---- l'état (la vraie page le demande à Odin ; l'aperçu le reçoit)
    async function load() {
      if (!SEUL) return;
      try { const r = await W.fetch('/ecran/etat?mac=' + encodeURIComponent(MAC), { cache: 'no-store' }); S = await r.json(); }
      catch (e) { if (view === 'arrivee') $('#premierSrv').textContent = M('injoignable'); return; }
      pret();
    }
    function pret() {
      if (!S) return;
      if (disp === null) disp = R.clientWidth < 700 && S.disposition === 'eventail' ? 'liste' : (['eventail', 'affiches', 'liste'].indexOf(S.disposition) >= 0 ? S.disposition : 'affiches');
      if (theme === null) theme = S.theme;
      if (SEUL) { doc.title = M('titre.page'); doc.documentElement.lang = String(langue()).slice(0, 2).toLowerCase(); }
      if (view === 'arrivee') { $('#premierSrv').textContent = M(CLE ? 'arrivee.cle' : 'arrivee.reseau'); appliquerTheme(); if (S.mascotte === false || fini) entrerMenu(); }
      else draw();
    }
    async function choose(mode, id) {
      if (!mode || (mode === 'auto' && CLE)) return;
      const x = id ? list().find((y) => y.id === id) : cur();
      if (mode !== 'disque' && mode !== 'texte' && (!x || x.modes.indexOf(mode) < 0)) return;
      if (rebours) arreterRebours();
      if (APERCU || !SEUL) { msg = M('apercu'); draw(); return; }
      try {
        // Réseau : Odin décide (/ecran/choisir). Clé : le petit script local, qui n'accepte que les systèmes de la clé.
        const r = await (await W.fetch((CLE ? '/cgi-bin/choisir' : '/ecran/choisir') + '?mac=' + encodeURIComponent(MAC) + '&iso=' + encodeURIComponent(x && !x.disque && mode !== 'texte' ? x.id : '') + '&mode=' + encodeURIComponent(mode))).json();
        if (mode === 'texte') msg = r && r.ok ? (r.texte || M('texte.ok')) : M('texte.bientot');
        else { msg = (r && r.texte) || ''; if (r && r.ok && mode !== 'auto') { view = 'go'; goName = mode === 'disque' ? M('go.disque') : titre(x); } }
      } catch (e) { msg = M('injoignable'); }
      await load(); draw();
    }

    // ---- le thème (le même pour la clé et le réseau) et son décor
    function appliquerTheme() {
      const t = D.THEMES.indexOf(theme) >= 0 ? theme : 'bleu', img = Boolean(S && S.fond && SEUL);
      for (const n of SEUL ? [R, doc.body] : [R]) { D.THEMES.forEach((x) => n.classList.remove(x)); n.classList.remove('img'); n.classList.add(t); if (img) n.classList.add('img'); }
      R.style.setProperty('--tint', ({bleu:'rgba(11,20,64,.55)',matrix:'rgba(0,0,0,.6)',ocean:'rgba(3,40,80,.45)',lune:'rgba(11,12,20,.5)',ciel:'rgba(255,255,255,.35)',galaxie:'rgba(7,5,26,.5)',mayotte:'rgba(255,255,255,.3)',couchant:'rgba(43,16,85,.45)',clair:'rgba(246,247,251,.6)'})[t]);
      (D.TEINTES[t] || []).forEach((c, i) => R.style.setProperty('--o' + i, c));
      if (img) R.style.setProperty('--fond', 'url(/ecran/fond-graphique?v=' + (Number(S.fondV) || 0) + ')');
      $('.stars').style.display = D.STARS.indexOf(t) >= 0 ? '' : 'none';
      if (decoDe === t) return; decoDe = t;
      const d = $('.deco'); d.replaceChildren();
      if (t === 'matrix') { const K = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789ODIN'; for (let i = 0; i < 40; i++) { let s = ''; for (let j = 0; j < 26; j++) s += K[(i * 7 + j * 3) % K.length]; d.append(el('span', { class: 'rain', style: 'left:' + (i * 2.5 + 0.5) + '%;animation-duration:' + (6 + (i * 7) % 7) + 's;animation-delay:-' + ((i * 13) % 7) + 's' }, s)); } }
      else if (t === 'ocean') d.append(el('div', { class: 'wave', style: 'top:58%;background:rgba(255,255,255,.12)' }), el('div', { class: 'wave', style: 'top:66%;background:rgba(0,40,90,.35);animation-duration:12s' }), el('div', { class: 'wave', style: 'top:76%;background:rgba(0,20,60,.45);animation-duration:7s' }));
      else if (t === 'lune') d.append(el('div', { class: 'moon' }, el('i', { style: 'left:22%;top:30%;width:18%;height:18%' }), el('i', { style: 'left:58%;top:55%;width:26%;height:26%' }), el('i', { style: 'left:55%;top:20%;width:11%;height:11%' })));
      else if (t === 'ciel') [[8, 0], [30, 1], [55, 2], [70, 3]].forEach(([y, i]) => d.append(el('span', { class: 'cloud', style: 'top:' + y + '%;width:' + (90 + i * 30) + 'px;height:34px;animation-duration:' + (50 + i * 12) + 's;animation-delay:-' + (i * 14) + 's;opacity:.9' })));
      else if (t === 'couchant') d.append(el('div', { class: 'sun' }));
      else if (t === 'mayotte') { const sv = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); sv.setAttribute('viewBox', '0 0 100 62.5'); sv.setAttribute('preserveAspectRatio', 'none'); sv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; sv.innerHTML = '<g fill="#0b4a3a" opacity=".7"><path d="M8 62 Q9 40 6 30 L7.5 30 Q10 42 9.5 62Z"/><path d="M6.8 30 Q0 27 -2 31 Q3 28 6.8 30 Q2 22 -1 22 Q5 23 6.8 30 Q8 21 14 21 Q9 24 6.8 30 Q13 26 17 30 Q11 28 6.8 30Z"/><path d="M92 62 Q91 44 94 34 L95.5 34.5 Q93 45 93.5 62Z"/><path d="M94.6 34.5 Q101 31 104 35 Q99 32 94.6 34.5 Q98 26 102 26 Q97 28 94.6 34.5 Q92 25 86 26 Q92 28 94.6 34.5 Q88 31 85 35 Q90 32 94.6 34.5Z"/></g>'; d.append(sv); }
    }

    // ---- le menu
    function horloge() { const d = new Date(); $('#hh').textContent = d.toLocaleTimeString(langue(), { hour: '2-digit', minute: '2-digit' }); $('#dd').textContent = M('barre.mode'); }
    function arreterPar() { if (rebours) arreterRebours(); }
    function entete() {
      $('#logoSub').textContent = M(CLE ? 'barre.cle' : 'barre.reseau');
      const cs = cats(); if (cs.indexOf(cat) < 0) cat = 'Tout';
      $('#tabs').setAttribute('aria-label', M('aria.familles')); $('#disp').setAttribute('aria-label', M('aria.disposition'));
      $('#tabs').replaceChildren(...cs.map((c) => el('button', { type: 'button', tabindex: '-1', 'aria-pressed': c === cat ? 'true' : 'false', onclick: () => { arreterPar(); cat = c; sel = 0; draw(); } }, M('cat.' + c))));
      $('#disp').replaceChildren(...['eventail', 'affiches', 'liste'].map((k) => el('button', { type: 'button', tabindex: '-1', 'aria-pressed': k === disp ? 'true' : 'false', onclick: () => { arreterPar(); disp = k; draw(); } }, M('disp.' + k))));
      horloge();
    }
    function icone(x) {
      const s = el('span', { class: 'mono-ic', style: 'background:' + couleur(x.color), 'aria-hidden': 'true' });
      if (x.disque) s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M12 3v8"/><path d="M6.3 7.3a8 8 0 1 0 11.4 0"/></svg>';
      else s.textContent = String(x.title || x.name || '?').charAt(0).toUpperCase();
      return s;
    }
    function cartes(m) {
      const l = list(), v = R.clientWidth < 700 ? 'liste' : disp;
      m.className = 'glist ' + v; m.setAttribute('aria-label', M('aria.systemes'));
      l.forEach((x, i) => {
        const d = i - sel;
        if (v === 'eventail' && Math.abs(d) > 3) return;
        const c = el('div', { class: 'gcard', role: 'option', id: 'c' + i, 'aria-selected': i === sel ? 'true' : 'false', onclick: () => { arreterPar(); if (sel !== i) msg = ''; sel = i; draw(); }, ondblclick: () => choose(principal(x), x.id) },
          icone(x), el('span', { class: 'gt' }, el('b', {}, titre(x)), el('small', {}, x.disque ? M('disque.sous') : M('sous.' + L.sousTitre(x)))));
        if (v === 'eventail') c.style.cssText = 'transform:translateX(calc(' + d + ' * 12.5em)) translateZ(' + (-Math.abs(d) * 120) + 'px) rotateY(' + (-d * 14) + 'deg) scale(' + (d === 0 ? 1.06 : 0.9) + ');opacity:' + (1 - Math.abs(d) * 0.22) + ';z-index:' + (10 - Math.abs(d));
        m.append(c);
      });
      if (!l.length) m.append(el('div', { class: 'pan' }, el('p', {}, M('vide'))));
      const vu = $('#c' + sel); if (vu && vu.scrollIntoView && v !== 'eventail') try { vu.scrollIntoView({ block: 'nearest' }); } catch (e) { /* rien */ }
    }
    function cote(s) {
      const x = cur();
      if (!x) return;
      s.append(el('h4', {}, titre(x)), el('p', { class: 'ss' }, x.disque ? M('disque.sous') : M('sous.' + L.sousTitre(x))), el('p', {}, M('desc.' + L.descCle(x, SOURCE))));
      if (!x.disque) s.append(el('p', { class: 'meta' }, [taille(x.size), M('verifie')].filter(Boolean).join(' · ')));
      if (msg) s.append(el('p', { class: 'msg', role: 'status' }, msg));
      const a = el('div', { class: 'acts' });
      if (x.disque) a.append(el('button', { type: 'button', class: 'go', onclick: () => choose('disque') }, M('act.disque')));
      else ['essai', 'installer', 'auto'].filter((k) => x.modes.indexOf(k) >= 0).forEach((k, i) => a.append(el('button', { type: 'button', class: i === 0 ? 'go' : '', onclick: () => choose(k, x.id) }, M(libAct(x, k)))));
      s.append(a);
    }
    function pied() {
      const f = $('#foot'); if (!f) return;
      // Hors du menu (installation, accord, « C'est parti », sans machine) : aucune touche à rappeler.
      f.hidden = !auMenu(); if (f.hidden) { f.replaceChildren(); return; }
      const kb = (t) => el('kbd', {}, t);
      const p = [el('span', { class: 'hide-p' }, kb('↑'), kb('↓'), M('pied.choisir')), el('span', {}, kb(M('touche.entree')), M('pied.demarrer')), el('span', { class: 'hide-p' }, kb('T'), M('pied.texte'))];
      if (rebours) {
        const c = rebours.cible, x = c.mode === 'disque' ? null : tous().find((y) => String(y.id) === c.id);
        p.push(el('span', { class: 'cd', role: 'timer', 'aria-live': 'off' }, M('rebours', { nom: x ? titre(x) : M('rebours.disque'), n: rebours.reste }), el('i', { style: '--cd:' + Math.round((100 * rebours.reste) / rebours.total) + '%' })));
      } else if (reboursVu) p.push(el('span', { class: 'cd off' }, M('rebours.arrete')));
      f.replaceChildren(...p);
    }
    const ORDRE = ['démarrage réseau', 'chargeur', 'menu', 'chargement', 'installation', 'logiciels', 'fini'];
    const ETAPE = { 'démarrage réseau': 'etape.reseau', chargeur: 'etape.chargeur', menu: 'etape.menu', chargement: 'etape.systeme', installation: 'etape.installation', logiciels: 'etape.logiciels', fini: 'etape.fini' };
    function loading(m) {
      const mc = S.machine, x = (S.systemes || []).find((y) => y.id === mc.iso) || { title: mc.isoName || '', version: '' };
      const k = Math.max(0, ORDRE.indexOf(mc.step)), pct = Math.round(Math.min(98, (k / 6) * 100 + (mc.step === 'installation' ? Math.min(30, (Date.now() - mc.updated) / 20000) : 0)));
      const h = new Date(mc.started).toLocaleTimeString(langue(), { hour: '2-digit', minute: '2-digit' });
      m.append(el('div', { class: 'pan' }, el('div', { class: 'q' }, M('load.q')), el('h1', {}, String(x.title || '') + ' ' + String(x.version || '')), el('p', {}, M('load.dit')),
        el('div', { class: 'pg' }, el('i', { style: 'width:' + pct + '%' })), el('div', { class: 'pgl' }, el('span', {}, ETAPE[mc.step] ? M(ETAPE[mc.step]) : String(mc.step || '')), el('b', {}, pct + ' %')),
        el('div', { class: 'steps' }, ...[['etape.reseau', 'démarrage réseau'], ['etape.chargeur', 'chargeur'], ['etape.systeme', 'chargement'], ['etape.installation', 'installation'], ['etape.logiciels', 'logiciels']].map(([t, s]) => { const j = ORDRE.indexOf(s); return el('span', { class: j < k ? 'ok' : j === k ? 'cur' : '' }, (j < k ? '✓ ' : '') + M(t)); })),
        el('p', {}, M('load.debut', { h: h, m: Math.round((Date.now() - mc.started) / 60000) })),
        el('div',{class:'od3'},el('i'),el('i'),el('i')), el('div', { class: 'srv' }, ligneSrc())));
    }
    function done(m) { const mc = S.machine; m.append(el('div', { class: 'pan' }, el('h1', {}, '✓ ' + M('done.titre', { nom: mc.host || M('done.pc') })), el('p', {}, M('done.texte')), el('p', {}, M('done.garde')), el('div', { class: 'bar' }, el('button', { type: 'button', class: 'y', onclick: () => { view = 'choix_force'; draw(); } }, M('done.autre'))))); }
    function going(m) { m.append(el('div', { class: 'pan' }, el('h1', {}, M('go.titre')), el('p', {}, M('go.texte', { nom: goName })), el('p', {}, M('go.suivi')), el('div', { class: 'bar' }, el('button', { type: 'button', class: 'y', onclick: () => { view = 'choix'; draw(); } }, M('go.changer'))))); }
    function waiting(m) { const d = S.demande, refus = d && d.statut === 'refusee'; m.append(el('div', { class: 'pan' }, el('h1', {}, M(refus ? 'wait.refus' : 'wait.titre')), el('p', {}, M(refus ? 'wait.refus.texte' : 'wait.texte')), msg ? el('p', {}, msg) : null, refus ? el('div', { class: 'bar' }, el('button', { type: 'button', class: 'y', onclick: () => { view = 'choix_force'; draw(); } }, M('wait.autre'))) : null)); }
    function draw() {
      if (!S || view === 'arrivee' || !vivant) return;
      appliquerTheme(); entete();
      const mc = S.machine, actif = SEUL && !APERCU && mc && ['chargement', 'installation', 'logiciels'].indexOf(mc.step) >= 0;
      if (actif) view = 'load';
      else if (SEUL && !APERCU && mc && mc.step === 'fini' && Date.now() - mc.updated < 36e5 && view !== 'choix_force') view = 'done';
      else if (SEUL && !APERCU && S.demande && S.demande.statut !== 'attente' && S.demande.statut !== 'refusee' && view !== 'choix_force') { view = 'go'; const y = (S.systemes || []).find((z) => z.id === S.demande.iso); goName = y ? titre(y) : ''; }
      else if (SEUL && !APERCU && S.demande && view !== 'choix_force') view = 'wait';
      else if (view === 'load' || view === 'done' || view === 'wait') view = 'choix';
      const vue = view === 'choix_force' ? 'choix' : view;
      R.dataset.vue = vue;
      const m = $('#main'), s = $('#side'); m.replaceChildren(); s.replaceChildren(); m.className = 'glist pleine';
      if (rebours && vue !== 'choix') arreterRebours();
      if (SEUL && !MAC && !APERCU) { R.dataset.vue = 'mac'; if (rebours) arreterRebours(); m.append(el('div', { class: 'pan' }, el('h1', {}, M('mac.titre')), el('p', {}, M('mac.texte')), el('div', { class: 'bar' }, el('button', { type: 'button', class: 'y', onclick: () => { W.location.search = '?apercu' + (CLE ? '&cle=1' : ''); } }, M('mac.apercu'))))); pied(); return; }
      if (vue === 'go') going(m); else if (vue === 'load') loading(m); else if (vue === 'done') done(m); else if (vue === 'wait') waiting(m);
      else { cartes(m); cote(s); }
      pied();
    }
    const pas = () => {
      if (R.clientWidth < 700 || disp !== 'affiches') return 1;
      const c = R.querySelectorAll('.gcard'); if (!c.length) return 1;
      const top = c[0].offsetTop; let n = 0; for (const x of c) { if (x.offsetTop !== top) break; n += 1; } return Math.max(1, n);
    };
    function touche(e) {
      if (!vivant || e.ctrlKey || e.metaKey || e.altKey) return;
      // Dans l'aperçu (une page d'Odin), Tab garde son rôle : sortir de l'écran (pas de piège au clavier).
      if (e.key === 'Tab' && !SEUL) return;
      const vue = view === 'arrivee' ? 'arrivee' : (R.dataset.vue || view);
      const r = L.clavier(e.key, { vue: vue, sel: sel, n: list().length, pas: pas(), cle: CLE, shift: e.shiftKey });
      if (!r) return;
      e.preventDefault();
      if (r.passer) { if (S) entrerMenu(); else fini = true; return; }
      arreterPar();
      if (r.vue) view = r.vue;
      if (r.sel != null) { if (r.sel !== sel) msg = ''; sel = r.sel; }
      if (r.disp) { const ks = ['eventail', 'affiches', 'liste']; disp = ks[(ks.indexOf(disp) + 1) % ks.length]; }
      if (r.cat) { const cs = cats(); cat = cs[(cs.indexOf(cat) + cs.length + r.cat) % cs.length]; sel = 0; }
      if (r.texte) { choose('texte'); return; }
      if (r.lancer) { const x = cur(); if (x) choose(r.lancer === 'principal' ? principal(x) : r.lancer, x.id); return; }
      draw();
    }
    const cible = o.cible || W;
    const surClic = () => { if (view === 'arrivee') { if (S) entrerMenu(); else fini = true; } };
    const surRoue = (e) => { if (view !== 'choix' || disp !== 'eventail' || R.clientWidth < 700) return; const n = list().length; if (!n) return; arreterPar(); sel = Math.max(0, Math.min(n - 1, sel + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1))); draw(); };
    cible.addEventListener('keydown', touche);
    R.addEventListener('click', surClic);
    R.addEventListener('wheel', surRoue, { passive: true });
    const horl = W.setInterval(() => { if (vivant && view !== 'arrivee') horloge(); }, 10000);
    const sondage = SEUL ? W.setInterval(load, 3000) : null;
    appliquerTheme(); arrivee();
    if (SEUL) load(); else pret();
    if (o.vue === 'menu') { fini = true; entrerMenu(); }
    return { arreter() { vivant = false; minuteries.forEach((t) => W.clearTimeout(t)); if (tic) W.clearInterval(tic); W.clearInterval(horl); if (sondage) W.clearInterval(sondage); cible.removeEventListener('keydown', touche); R.removeEventListener('click', surClic); R.removeEventListener('wheel', surRoue); } };
  }

  /** La source de la logique, telle qu'elle est posée dans la page servie. */
  const logiqueSource = () => '{' + Object.entries(LOGIQUE).map(([k, f]) => `${k}:${f.toString()}`).join(',') + '}';
  /**
   * La PAGE servie (réseau : /ecran ; clé : /ecran-odin/index.html). Elle ne contient AUCUNE donnée : elle demande
   * l'état à Odin (/ecran/etat) ou le lit sur la clé. La source (clé ou réseau) vient de l'adresse (« cle=1 »). Pur.
   */
  function pageEcran() {
    const data = JSON.stringify(donneesEcran()).replace(/</g, '\\u003c');
    return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>Odin · démarrage</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#0b1440}\n' + cssEcran() + '</style></head>'
      + '<body class="bleu"><div class="oe plein bleu" id="oe">' + corpsEcran() + '</div>'
      + '<script>\'use strict\';\n(' + demarrer.toString() + ')(document.getElementById(\'oe\'),{L:' + logiqueSource() + ',D:' + data + '});\n</script></body></html>';
  }

  // ===========================================================================
  // L'APERÇU dans la page (onglet Démarrage des clés ; et Systèmes · Démarrage pour le réseau) : il monte LE MÊME
  // écran (mêmes fonctions, même style), isolé dans une ombre (shadow DOM), avec des systèmes d'exemple ou ceux de
  // la clé. Rien n'est jamais lancé depuis l'aperçu.
  // ===========================================================================
  const MOTS_APERCU = {
    'titre.cle': 'L’écran de démarrage de la clé', 'titre.reseau': 'L’écran de démarrage par le réseau',
    'lead.cle': 'Ce que tu vois sur le PC quand la clé démarre : le même écran et les mêmes thèmes que le démarrage par le réseau. Clique dans l’écran puis utilise les flèches et Entrée.',
    'lead.reseau': 'Ce que voit un PC qui démarre par le réseau : le même écran, la même arrivée d’Odin et les mêmes thèmes que la clé ODIN. Clique dans l’écran puis utilise les flèches et Entrée.',
    'source': 'D’où démarre le PC', 'source.reseau': 'Par le réseau', 'source.cle': 'Depuis la clé',
    'vue': 'Vue', 'vue.arrivee': 'Arrivée d’Odin', 'vue.menu': 'Menu graphique', 'vue.texte': 'Menu texte',
    'vue.texte.bientot': 'Le menu texte (T au démarrage) arrive bientôt dans cet aperçu, aux couleurs du thème texte.',
    'rejouer': 'Rejouer', 'theme': 'Thème', 'themes': 'Thème graphique',
    'memes.titre': 'Mêmes thèmes que mes clés ODIN', 'memes.sous': 'Un seul réglage d’apparence pour la clé et le réseau. Coupé : le réseau garde son propre thème.',
    'memes.pas.garde': 'Ce réglage commun n’est pas encore enregistré dans Genèse : l’aperçu le montre seulement.',
    'ecran.aria': 'Aperçu de l’écran de démarrage, {theme}', 'ecran.role': 'écran de démarrage',
    'note': 'Aperçu fidèle : c’est la page servie au PC, avec {quoi}. Rien n’est lancé d’ici.', 'note.exemple': 'des systèmes d’exemple', 'note.vrais': 'les systèmes choisis, dans leur ordre',
    'fermer': 'Fermer', 'calque': 'Aperçu de l’écran de démarrage',
    'theme.bleu': 'Bleu verre', 'theme.matrix': 'Matrix', 'theme.ocean': 'Voyage océan', 'theme.lune': 'Lune', 'theme.ciel': 'Ciel', 'theme.galaxie': 'Galaxie', 'theme.mayotte': 'Mayotte', 'theme.couchant': 'Coucher de soleil', 'theme.clair': 'Clair minimal',
  };
  const motA = (k, v) => mot({ fr: MOTS_APERCU }, (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'fr', k, v);
  const NUANCIER = { bleu: 'radial-gradient(circle at 50% 30%,#2a4bd1,#0b1440)', matrix: '#000', ocean: 'linear-gradient(180deg,#7fd3ff,#0a4f8a 60%,#062b52)', lune: 'radial-gradient(circle at 70% 20%,#f4f1e8 0 18%,#2a2d3e 20%,#0b0c14)', ciel: 'linear-gradient(180deg,#4aa8ff,#e6f5ff)', galaxie: 'radial-gradient(circle at 30% 40%,#a03cff,#07051a 70%)', mayotte: 'linear-gradient(180deg,#7fe3ff,#26c6c6 45%,#0f8a83 70%,#e9d8a6 71%)', couchant: 'linear-gradient(180deg,#2b1055,#7a1f6b 35%,#ff6a3d 62%,#ffb36b)', clair: '#f6f7fb' };

  /** Des systèmes d'exemple (aucune donnée personnelle), comme sur les maquettes. */
  const EXEMPLES = {
    cle: [
      { id: 'w11', title: 'Windows 11', version: '', category: 'Windows', modes: ['essai'], genre: 'installe', color: '#2f6fe0' },
      { id: 'ubu', title: 'Ubuntu', version: '24.04', category: 'Linux', modes: ['essai', 'installer'], color: '#e95420', size: 6.1e9 },
      { id: 'deb', title: 'Debian', version: '12', category: 'Linux', modes: ['essai'], genre: 'installe', color: '#a80030' },
      { id: 'w10', title: 'Windows 10', version: '', category: 'Windows', modes: ['installer'], color: '#3d7fc4', size: 5.8e9 },
      { id: 'fed', title: 'Fedora', version: '40', category: 'Linux', modes: ['essai', 'installer'], color: '#3c6eb4', size: 2.3e9 },
      { id: 'gp', title: 'GParted', version: '1.6', category: 'Outils', modes: ['essai'], color: '#7a7f88', size: 6e8 },
      { id: 'cz', title: 'Clonezilla', version: '3.2', category: 'Outils', modes: ['essai'], color: '#8a6d3b', size: 4e8 },
    ],
    reseau: [
      { id: 'ubu', title: 'Ubuntu', version: '24.04.1 LTS', category: 'Linux', modes: ['essai', 'installer', 'auto'], color: '#e95420', size: 6.1e9 },
      { id: 'w11', title: 'Windows 11', version: '24H2', category: 'Windows', modes: ['essai', 'installer', 'auto'], color: '#2f6fe0', size: 5.4e9 },
      { id: 'ubs', title: 'Ubuntu Server', version: '24.04.1 LTS', category: 'Serveurs', modes: ['essai', 'installer', 'auto'], color: '#c34113', size: 2.7e9 },
      { id: 'w10', title: 'Windows 10', version: '22H2', category: 'Windows', modes: ['essai', 'installer', 'auto'], color: '#3d7fc4', size: 5.8e9 },
      { id: 'gp', title: 'GParted Live', version: '1.6.0', category: 'Outils', modes: ['essai'], color: '#7a7f88', size: 6e8 },
      { id: 'cz', title: 'Clonezilla', version: '3.2.0', category: 'Outils', modes: ['essai'], color: '#8a6d3b', size: 4e8 },
      { id: 'mt', title: 'Test de mémoire', version: '7.20', category: 'Outils', modes: ['essai'], color: '#5b6b7a', size: 2e7 },
    ],
  };
  /** Une entrée de menu de la clé (format de construire / ouvrir) → un système de l'écran. Pur. */
  function versSysteme(e, i) {
    const fam = e.famille === 'windows' ? 'Windows' : e.famille === 'autre' ? 'Outils' : 'Linux';
    const inst = ['installe', 'persistance', 'vm'].indexOf(e.genre) >= 0;
    const modes = Array.isArray(e.modes) ? e.modes : inst || fam === 'Outils' ? ['essai'] : fam === 'Windows' ? ['installer'] : ['essai', 'installer'];
    const couleurs = { Windows: '#2f6fe0', Linux: '#e95420', Outils: '#7a7f88' };
    return { id: String(e.id || 'e' + i), title: String(e.nom || e.title || '?').replace(/\s*\((ISO|installé|persistant)\)\s*$/i, ''), version: String(e.version || ''), category: fam, modes, genre: e.genre, color: couleurs[fam] };
  }
  /** L'état montré par l'aperçu (la même forme que /ecran/etat). Pur. */
  function etatApercu(entrees, o) {
    const source = o.source === 'reseau' ? 'reseau' : 'cle';
    const vrais = (entrees || []).filter((e) => e && e.demarrable !== false);
    const systemes = vrais.length ? vrais.map(versSysteme) : EXEMPLES[source].map((x) => Object.assign({}, x));
    const ap = apparencePour(source, o.apparence || { commun: { theme: o.theme, delai: o.delai, mascotte: o.mascotteAccueil } });
    const parDefaut = vrais.findIndex((e) => e.defaut);
    return { systemes, theme: ap.theme, disposition: o.disposition || 'affiches', delai: ap.delai, mascotte: ap.mascotte, defaut: source === 'cle' ? (parDefaut >= 0 ? systemes[parDefaut].id : systemes[0] && systemes[0].id) : (o.defaut || 'disque'), dit: {}, exemple: !vrais.length };
  }

  const CSS_APERCU = `
.ecp{display:flex;flex-direction:column;gap:12px;color:var(--ink,#eef)}
.ecp-card{background:var(--panel,#0f1730);border:1px solid var(--line,#2a3550);border-radius:18px;padding:18px}
.ecp-card h2{margin:0 0 4px;font-size:17px}.ecp-lead{margin:0;color:var(--muted,#9aa6c0);font-size:13.5px;line-height:1.45}
.ecp-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px}
.ecp-seg{display:inline-flex;gap:4px;flex-wrap:wrap}
.ecp-seg button,.ecp-btn{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line,#2a3550);background:none;color:var(--ink,#eef);font:600 13.5px/1 inherit;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:8px}
.ecp-seg button[aria-pressed=true]{border-color:var(--accent,#3f82f0);background:color-mix(in srgb,var(--accent,#3f82f0) 16%,transparent)}
.ecp-seg button:focus-visible,.ecp-btn:focus-visible,.ecp-sw:focus-visible,.ecp-tg:focus-visible{outline:3px solid var(--accent,#3f82f0);outline-offset:2px}
.ecp-lbl{font-size:12px;color:var(--muted,#9aa6c0);font-weight:600;margin-right:2px}
.ecp-sws{display:flex;gap:6px;flex-wrap:wrap}
.ecp-sw{width:44px;height:44px;border-radius:12px;border:2px solid var(--line,#2a3550);padding:0;cursor:pointer}
.ecp-sw[aria-pressed=true]{border-color:var(--accent,#3f82f0);box-shadow:0 0 0 2px var(--accent,#3f82f0)}
.ecp-opt{display:flex;gap:14px;align-items:center;justify-content:space-between;margin-top:12px}
.ecp-opt b{display:block;font-size:14px}.ecp-opt small{color:var(--muted,#9aa6c0);font-size:12.5px}
.ecp-tg{flex:none;width:56px;height:32px;border-radius:999px;border:0;background:var(--line,#2a3550);position:relative;cursor:pointer;padding:0}
.ecp-tg::after{content:"";position:absolute;top:4px;left:4px;width:24px;height:24px;border-radius:50%;background:#fff;transition:left .2s}
.ecp-tg[aria-checked=true]{background:var(--good,#2ec27e)}.ecp-tg[aria-checked=true]::after{left:28px}
.ecp-mon{border-radius:18px;padding:12px;background:#0b0d11;box-shadow:0 20px 50px rgba(0,0,0,.35)}
.ecp-scr{position:relative;aspect-ratio:16/10;border-radius:10px;overflow:hidden;outline:none;background:#0b1440}
.ecp-scr:focus-visible{box-shadow:0 0 0 3px var(--accent,#3f82f0)}
.ecp-txt{display:grid;place-items:center;height:100%;padding:24px;text-align:center;color:#c8ffd4;background:#000;font:14px/1.5 ui-monospace,Consolas,monospace}
.ecp-note{margin:0;font-size:12.5px;color:var(--muted,#9aa6c0)}
@media (max-width:600px){.ecp-card{padding:14px}.ecp-mon{padding:6px;border-radius:12px}.ecp-scr{aspect-ratio:10/16}}
@media (prefers-reduced-motion:reduce){.ecp-tg::after{transition:none}}
.clm-bg .ecp{width:min(1100px,100%)}
`;
  const styleApercu = () => { if (typeof document === 'undefined' || document.getElementById('ecpCss')) return; const s = document.createElement('style'); s.id = 'ecpCss'; s.textContent = CSS_APERCU; document.head.append(s); };

  /**
   * Monte l'aperçu dans `conteneur`. opts : { source ('cle' | 'reseau'), choixSource (montre « Par le réseau /
   * Depuis la clé »), entrees (les entrées de la clé ; vide : exemples), theme, disposition, delai, defaut,
   * mascotteAccueil, apparence ({ commun, reseau, memes }), interrupteur (montre « Mêmes thèmes que mes clés ODIN »),
   * surApparence (appelé avec le réglage changé : la page qui l'enregistre), vue ('arrivee' | 'menu') }.
   * Rend { arreter }.
   */
  function monterApercu(conteneur, opts) {
    const o = Object.assign({ source: 'cle', vue: 'arrivee' }, opts || {});
    styleApercu();
    const etatUI = { source: o.source === 'reseau' ? 'reseau' : 'cle', vue: o.vue === 'menu' ? 'menu' : o.vue === 'texte' ? 'texte' : 'arrivee', apparence: JSON.parse(JSON.stringify(o.apparence || { commun: { theme: o.theme || 'bleu', delai: o.delai == null ? 10 : o.delai, mascotte: o.mascotteAccueil !== false }, memes: true })) };
    let ecran = null, surMenu = () => {};
    const racine = el('div', { class: 'ecp' });
    conteneur.replaceChildren(racine);
    const themeVu = () => apparencePour(etatUI.source, etatUI.apparence).theme;
    function changerTheme(t) {
      const a = etatUI.apparence;
      if (etatUI.source === 'reseau' && a.memes === false) a.reseau = Object.assign({}, a.reseau, { theme: t }); else a.commun = Object.assign({}, a.commun, { theme: t });
      if (typeof o.surApparence === 'function') o.surApparence(JSON.parse(JSON.stringify(a)));
      rendre();
    }
    function rendre() {
      if (ecran) { ecran.arreter(); ecran = null; }
      const seg = (nom, liste, actuel, quand) => el('div', { class: 'ecp-seg', role: 'group', 'aria-label': nom }, ...liste.map(([k, t]) => el('button', { type: 'button', 'aria-pressed': k === actuel ? 'true' : 'false', onclick: () => quand(k) }, t)));
      const carte = el('section', { class: 'ecp-card' }, el('h2', {}, motA(`titre.${etatUI.source}`)), el('p', { class: 'ecp-lead' }, motA(`lead.${etatUI.source}`)));
      if (o.interrupteur) {
        const on = etatUI.apparence.memes !== false;
        carte.append(el('div', { class: 'ecp-opt' }, el('span', {}, el('b', { id: 'ecpMemes' }, motA('memes.titre')), el('small', {}, motA('memes.sous'), typeof o.surApparence === 'function' ? '' : ` ${motA('memes.pas.garde')}`)),
          el('button', { type: 'button', class: 'ecp-tg', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-labelledby': 'ecpMemes', onclick: () => { etatUI.apparence.memes = !on; if (typeof o.surApparence === 'function') o.surApparence(JSON.parse(JSON.stringify(etatUI.apparence))); rendre(); } })));
      }
      const ligne = el('div', { class: 'ecp-row' });
      if (o.choixSource) ligne.append(seg(motA('source'), [['reseau', motA('source.reseau')], ['cle', motA('source.cle')]], etatUI.source, (k) => { etatUI.source = k; rendre(); }));
      const vues = seg(motA('vue'), [['arrivee', motA('vue.arrivee')], ['menu', motA('vue.menu')], ['texte', motA('vue.texte')]], etatUI.vue, (k) => { etatUI.vue = k; rendre(); });
      // Après l'arrivée, l'écran passe tout seul au menu : le bouton « Menu graphique » s'allume, comme sur la maquette.
      surMenu = () => { etatUI.vue = 'menu'; [...vues.children].forEach((b, i) => b.setAttribute('aria-pressed', i === 1 ? 'true' : 'false')); };
      ligne.append(vues,
        el('button', { type: 'button', class: 'ecp-btn', onclick: () => { etatUI.vue = 'arrivee'; rendre(); } }, '↻ ', motA('rejouer')));
      carte.append(ligne);
      const t = themeVu();
      carte.append(el('div', { class: 'ecp-row' }, el('span', { class: 'ecp-lbl', id: 'ecpTh' }, motA('theme')), el('div', { class: 'ecp-sws', role: 'group', 'aria-labelledby': 'ecpTh' },
        ...THEMES_ECRAN.map((k) => el('button', { type: 'button', class: 'ecp-sw', style: `background:${NUANCIER[k]}`, 'aria-pressed': k === t ? 'true' : 'false', 'aria-label': motA(`theme.${k}`), title: motA(`theme.${k}`), onclick: () => changerTheme(k) })))));
      const scr = el('div', { class: 'ecp-scr', tabindex: '0', role: 'application', 'aria-roledescription': motA('ecran.role'), 'aria-label': motA('ecran.aria', { theme: motA(`theme.${t}`) }) });
      const etat = etatApercu(o.entrees, { ...o, source: etatUI.source, apparence: etatUI.apparence });
      racine.replaceChildren(carte, el('div', { class: 'ecp-mon' }, scr), el('p', { class: 'ecp-note' }, motA('note', { quoi: motA(etat.exemple ? 'note.exemple' : 'note.vrais') })));
      if (etatUI.vue === 'texte') { scr.append(el('div', { class: 'ecp-txt' }, motA('vue.texte.bientot'))); return; }
      const ombre = scr.attachShadow ? scr.attachShadow({ mode: 'open' }) : scr;
      const st = document.createElement('style'); st.textContent = cssEcran();
      const oe = document.createElement('div'); oe.className = 'oe ' + t; oe.innerHTML = corpsEcran();
      ombre.append(st, oe);
      ecran = demarrer(oe, { L: LOGIQUE, D: donneesEcran(), etat, apercu: true, source: etatUI.source, vue: etatUI.vue, cible: scr, surMenu: () => surMenu(), langue: (document.documentElement && document.documentElement.lang) || 'fr' });
    }
    rendre();
    return { arreter() { if (ecran) ecran.arreter(); ecran = null; } };
  }

  /** L'aperçu dans un calque par-dessus la page (jamais une fenêtre native) : le même écran que celui servi. */
  function ouvrir(entrees, opts) {
    if (typeof document === 'undefined') return;
    const o = opts || {};
    styleUneFois();
    const bg = el('div', { class: 'clm-bg', role: 'dialog', 'aria-modal': 'true', 'aria-label': motA('calque') });
    let ap = null;
    const fermer = () => { if (ap) ap.arreter(); bg.remove(); };
    const box = el('div', { class: 'clm-box', style: 'width:min(1100px,100%)' });
    box.append(el('div', { style: 'display:flex;justify-content:flex-end;margin-bottom:6px' }, el('button', { class: 'clm-x', type: 'button', 'aria-label': motA('fermer'), onclick: fermer }, '×')));
    const zone = el('div', {});
    box.append(zone);
    bg.append(box);
    bg.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !(e.target && e.target.classList && e.target.classList.contains('ecp-scr'))) fermer(); });
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) fermer(); });
    (document.body || document.documentElement).append(bg);
    ap = monterApercu(zone, { source: o.source || 'cle', entrees, theme: o.theme, disposition: o.disposition, delai: o.delai, mascotteAccueil: o.mascotteAccueil, vue: o.mascotteAccueil === false ? 'menu' : 'arrivee' });
  }

  // Le style de l'aperçu intégré est ajouté une fois, à la première construction dans une vraie page.
  const styleUneFois = (() => { let fait = false; return () => { if (fait || typeof document === 'undefined') return; fait = true; if (!document.getElementById('clmCss')) document.head.append(el('style', { id: 'clmCss' }, CSS)); }; })();
  const construireAvecStyle = (entrees, opts) => { styleUneFois(); return construire(entrees, opts); };

  window.OdinGeneseCleMenu = {
    construire: construireAvecStyle, ouvrir, monterApercu,
    logique: { grouper, filtrer, demo, info, INFO, NOM_FAM, ORDRE_FAM },
    // L'écran de démarrage, le même pour la clé et le réseau (lu aussi par le serveur : ecran-page.ts).
    ecran: { page: pageEcran, css: cssEcran, corps: corpsEcran, demarrer, logique: LOGIQUE, donnees: donneesEcran, etatApercu, versSysteme, FORMES, POSES, SEQUENCE: SEQUENCE_ARRIVEE, DUREE: DUREE_ARRIVEE, MOTS: MOTS_ECRAN, THEMES: THEMES_ECRAN, COULEUR_ODIN, teintes },
  };
})();
