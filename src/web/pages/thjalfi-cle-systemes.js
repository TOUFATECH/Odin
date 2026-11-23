// Genèse · Clés USB — les étapes 2 et 3 du parcours de la maquette validée « Clés USB » (lot C2) :
//   - étape 2 « Façon » : trois cartes à choisir (clé de démarrage avec plusieurs ISO — conseillée, par défaut —,
//     systèmes installés sur la clé ou le disque, les deux), et l'interrupteur « machines virtuelles copiées sur la
//     clé ». La façon règle le choix de départ de chaque système ; chaque système garde ensuite son propre choix ;
//   - étape 3 « Systèmes » : la barre de place COLLANTE (calculée par l'action cle_place, en lecture seule), les
//     filtres (Tout, Linux, Windows, Outils, Machines virtuelles), la recherche, et pour chaque système ses choix :
//     « ISO qui démarre », « ISO + mémoire », « Installé », « Copie de VM ». « Continuer » reste éteint tant que rien
//     n'est choisi, que la place n'est pas calculée, ou que ça ne tient pas.
// Ce que l'appli ne sait pas encore faire est montré grisé « bientôt » (jamais inventé) :
//   - « Installé » pour un Linux sans recette automatique (cle-install.ts : Ubuntu, Debian, RHEL, Fedora d'abord) ;
//   - « ISO + mémoire » pour une distribution dont la mémoire n'est pas connue (cle-install.ts, FAMILLES_PERSIST) ;
//   - la copie d'une VM qui tourne (aucune action n'arrête ni ne photographie une VM d'ici : cle_vms ne fait que lister),
//     et celle d'une VM d'un serveur dont le disque n'est pas lisible d'ici ;
//   - déposer un fichier depuis la page (aucune action ne reçoit un fichier pour la clé).
// Rien ici n'écrit sur un disque : on LIT la bibliothèque (isos), les VM (cle_vms) et la place (cle_place).
// Tous les textes sont dans MOTS ; tailles et nombres selon la langue de la page (Intl).
// Expose window.OdinGeneseCleSystemes = { MOTS, logique, rendre(n, outils), pret(), composes(), etat }.
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    'facon.titre': 'Comment la clé démarre ?',
    'facon.titre.disque': 'Comment le disque démarre ?',
    'facon.lead': 'Les deux façons peuvent cohabiter : chaque système garde son propre choix à l\'étape suivante.',
    'facon.groupe': 'Façon',
    'facon.conseil': 'Conseillé',
    'facon.iso': 'Clé de démarrage, plusieurs ISO',
    'facon.iso.texte': 'Les ISO sont copiées telles quelles. Au démarrage, un menu les liste : tu essaies ou tu installes sur le PC.',
    'facon.iso.p1': 'Ajouter ou retirer une ISO sans refaire la clé',
    'facon.iso.p2': 'Windows, Linux, outils : de 2 à 20 et plus',
    'facon.iso.p3': 'Rien n\'est gardé d\'un démarrage à l\'autre',
    'facon.installes': 'Systèmes installés sur la clé',
    'facon.installes.texte': 'Chaque système est installé sur la clé et garde tes fichiers, tes réglages et tes logiciels. Tu l\'emportes partout.',
    'facon.installes.p1': 'Windows et Linux installés côte à côte',
    'facon.installes.p2': 'Au démarrage, le menu propose chacun',
    'facon.installes.p3': 'Plus lent qu\'un disque interne : il faut une clé rapide (USB 3)',
    'facon.deux': 'Les deux',
    'facon.deux.texte': 'Des ISO pour dépanner et un ou deux systèmes installés pour travailler.',
    'facon.deux.p1': 'Tu choisis système par système',
    'facon.deux.p2': 'Odin calcule la place avant d\'écrire',
    'vm.titre': 'Machines virtuelles copiées sur la clé',
    'vm.texte': 'Le disque d\'une machine virtuelle d\'Hydre est copié sur la clé et préparé pour démarrer sur un vrai PC.',
    'sys.titre': 'Systèmes et ISO',
    'sys.lead': 'Ceux qu\'Odin a déjà téléchargés (la même bibliothèque que le démarrage par le réseau). Par défaut : {defaut}.',
    'filtre.nom': 'Filtrer',
    'filtre.tout': 'Tout', 'filtre.linux': 'Linux', 'filtre.windows': 'Windows', 'filtre.outil': 'Outils', 'filtre.vm': 'Machines virtuelles',
    'recherche': 'Chercher un système…',
    'recherche.nom': 'Chercher un système',
    'choix.iso': 'ISO qui démarre', 'choix.persistance': 'ISO + mémoire', 'choix.installe': 'Installé', 'choix.installe.windows': 'Installé (garde tout)', 'choix.vm': 'Copie de VM',
    'choix.bientot': '{choix} · bientôt',
    'choix.groupe': 'Façon pour {nom}',
    'fam.linux': 'Linux', 'fam.windows': 'Windows', 'fam.outil': 'Outil', 'fam.vm': 'Machine virtuelle d\'Hydre',
    'sys.sous': '{fam} · {taille}',
    'sys.tailleInconnue': 'taille inconnue',
    'sys.ajouter': 'Ajouter {nom}',
    'sys.retirer': 'Retirer {nom}',
    'sys.pasPrete': 'Pas encore prête : l\'antivirus la vérifie encore.',
    'note.installe.windows': 'Installé sur la clé : il garde tes fichiers. Clé rapide conseillée ; la licence reste la tienne.',
    'note.installe.linux': 'Installé sur sa partition de {taille} : il garde tes fichiers.',
    'note.persistance': 'L\'ISO démarre et garde tes fichiers dans {taille} réservés.',
    'note.vm': 'Copiée depuis Hydre. Une machine virtuelle peut manquer de pilotes sur un vrai PC.',
    'note.bientot.installe': '« Installé » arrive bientôt pour ce système : il n\'a pas encore d\'installation automatique.',
    'note.bientot.persistance': '« ISO + mémoire » arrive bientôt pour ce système.',
    'vm.enMarche': 'Elle tourne : arrête-la dans Hydre pour la copier. L\'arrêt depuis ici arrive bientôt.',
    'vm.nonLisible': 'Son disque n\'est pas lisible d\'ici : la copie depuis ce serveur arrive bientôt.',
    'vm.tailleInconnue': 'Odin ne connaît pas encore la taille de son disque : il ne peut pas dire si elle tient. La copie d\'ici arrive bientôt.',
    'biblio.charge': 'Odin lit sa bibliothèque…',
    'biblio.erreur': 'Odin n\'a pas pu lire sa bibliothèque : {raison}',
    'biblio.vide': 'Aucune ISO dans la bibliothèque pour l\'instant. Télécharge-les d\'abord : elles apparaîtront ici.',
    'vms.charge': 'Odin regarde les machines virtuelles d\'Hydre…',
    'vms.erreur': 'Odin n\'a pas pu lire les machines virtuelles : {raison}',
    'vms.aucune': 'Aucune machine virtuelle vue par Hydre.',
    'vms.retirees.one': '{n} machine virtuelle retirée de la liste.',
    'vms.retirees.other': '{n} machines virtuelles retirées de la liste.',
    'rien': 'Rien ne correspond.',
    'depot': 'Déposer ici une ISO, une image disque ou un disque de VM exporté',
    'depot.bientot': 'Bientôt : en attendant, mets le fichier dans la bibliothèque d\'Odin.',
    'place.nom': 'Place sur la clé',
    'place.nom.disque': 'Place sur le disque',
    'place.pris': '{pris} sur {total}',
    'place.reste.one': '{n} choisi · reste {reste}',
    'place.reste.other': '{n} choisis · reste {reste}',
    'place.trop': 'Trop pour cette clé',
    'place.trop.disque': 'Trop pour ce disque',
    'place.calcul': 'Odin calcule la place…',
    'place.erreur': 'Place inconnue',
    'place.vide': 'Rien de choisi',
    'aide.trop': 'Retire un système ou choisis une clé plus grande.',
    'aide.trop.disque': 'Retire un système ou choisis un disque plus grand.',
    'aide.vide': 'Choisis au moins un système.',
    'aide.calcul': 'Odin calcule la place avant de continuer.',
    'aide.erreur': 'Odin n\'a pas pu calculer la place : change un choix pour réessayer.',
    'etape.fermee': 'Choisis d\'abord des systèmes qui tiennent sur la clé.',
    'etape.fermee.disque': 'Choisis d\'abord des systèmes qui tiennent sur le disque.',
  };
  const mot = (k, v) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_m, x) => (v && v[x] != null ? String(v[x]) : ''));

  // ---------------------------------------------------------------- la logique (pure)
  const GIO = 1024 ** 3;
  const FACONS = ['iso', 'installes', 'deux'];
  /** La façon conseillée et choisie au départ (choix du propriétaire) : la clé de démarrage avec plusieurs ISO. */
  const FACON_DEFAUT = 'iso';
  const FILTRES = ['tout', 'linux', 'windows', 'outil', 'vm'];
  /** La mémoire d'une « ISO + mémoire » : la taille par défaut du serveur (cle-cible.ts, 4096 Mo). */
  const MEMOIRE_GO = 4;
  /** Un Linux installé : la taille par défaut du serveur (cle-cible.ts, PLACE.linuxInstalleGo). */
  const LINUX_INSTALLE_GO = 20;
  /** La place gardée pour Odin sur la clé : la petite partition de démarrage du chargeur, l'écran hors ligne, les
   *  scripts et le menu (cle-ecrire.ts), et l'arrondi des partitions. Sans elle, des ISO « à l'octet près » passeraient. */
  const MARGE_OCTETS = 256 * 1024 ** 2;
  /** Les distributions dont la mémoire est connue (miroir de FAMILLES_PERSIST, cle-install.ts). */
  const PERSIST = /ubuntu|mint|elementary|zorin|pop[-_]?os|lubuntu|xubuntu|kubuntu|\bmx\b|mx-?linux|antix|kali|debian|arch|fedora|rocky|alma|centos|nobara/;
  /** Les recettes qui savent installer un Linux sur sa partition (planInstallLinux, cle-install.ts). */
  const INSTALL_AUTO = ['ubuntu', 'casper', 'debian', 'rhel', 'fedora-live'];

  const langue = () => { try { return (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || undefined; } catch { return undefined; } };
  function taille(octets, lang) {
    const partagee = W.OdinGeneseCleEtapes && W.OdinGeneseCleEtapes.logique && W.OdinGeneseCleEtapes.logique.taille;
    if (typeof partagee === 'function') return partagee(octets, lang);
    const g = (Number(octets) || 0) / GIO;
    const [v, u] = g >= 1000 ? [g / 1024, 'terabyte'] : g > 0 && g < 1 ? [g * 1024, 'megabyte'] : [g, 'gigabyte'];
    try { return new Intl.NumberFormat(lang, { style: 'unit', unit: u, unitDisplay: 'short', maximumFractionDigits: v >= 100 ? 0 : 1 }).format(v); } catch { return `${Math.round(v)}`; }
  }
  const nombre = (n, lang) => { try { return new Intl.NumberFormat(lang).format(n); } catch { return String(n); } };
  const pluriel = (n, lang) => { try { return new Intl.PluralRules(lang).select(n) === 'one' ? 'one' : 'other'; } catch { return n === 1 ? 'one' : 'other'; } };
  /** Un texte venu d'un fichier, sans caractères de contrôle ni invisibles. */
  const propre = (x) => String(x == null ? '' : x).replace(/[\p{Cc}\p{Cf}]+/gu, '').trim();
  /** Pour chercher : sans accents ni majuscules. */
  const plat = (x) => propre(x).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

  /** Un nom lisible tiré du nom de l'ISO (la règle de l'écran de démarrage, ecran.ts pretty, sans les architectures). */
  function joli(name) {
    const n0 = propre(name);
    const w = /win(?:dows)?[-_ ]?(1[01]|7|8)(?![\d.])/i.exec(n0), ws = /windows[-_ ]?server[-_ ]?(20\d\d)/i.exec(n0);
    if (ws) return { titre: `Windows Server ${ws[1]}`, version: /(\d\d[hH]\d)/.exec(n0)?.[1].toUpperCase() ?? '' };
    if (w) return { titre: `Windows ${w[1]}`, version: /(\d\d[hH]\d)/.exec(n0)?.[1].toUpperCase() ?? '' };
    // Les architectures (x86_64, 64bit…) sont retirées AVANT de chercher la version ; une version à point d'abord.
    const n = n0.replace(/[_]+/g, '-').replace(/\.iso$/i, '').replace(/\b(amd64|x86-64|x64|arm64|aarch64|i386|i686|\d\dbit|live|dvd|netinst|english|french|fr|en-us|fr-fr|multi)\b/gi, ' ');
    const v = /(\d+\.\d+(?:\.\d+)?)/.exec(n)?.[1] ?? /(?:^|[-\s])(\d+)(?=$|[-\s])/.exec(n)?.[1] ?? '';
    const mots = n.replace(/(\d+(?:\.\d+){0,2})/g, ' ').split(/[-\s]+/).filter(Boolean);
    const titre = mots.slice(0, 3).map((x) => (/^(lts|le|de|la)$/i.test(x) ? x.toUpperCase() : x.charAt(0).toUpperCase() + x.slice(1))).join(' ').replace(/\bLTS\b/i, '').trim();
    return { titre: titre || n0, version: v };
  }
  const COULEURS = [[/windows/, '#2f6fe0'], [/ubuntu/, '#e95420'], [/debian/, '#a80030'], [/fedora/, '#3c6eb4'], [/mint/, '#4f8f2f'], [/proxmox/, '#c25f00'], [/rocky/, '#0f7a55'], [/alma/, '#0f4266'], [/truenas/, '#0072a6'], [/arch/, '#1572a6'], [/alpine/, '#0d597f'], [/memtest/, '#6d3fd6'], [/clonezilla/, '#8a6d3b'], [/gparted/, '#5b6470'], [/kali/, '#2f62c9']];
  const couleur = (nom, famille) => (famille === 'vm' ? '#6d5dfc' : (COULEURS.find(([re]) => re.test(nom.toLowerCase())) || [0, famille === 'outil' ? '#5b6470' : '#4b5bc6'])[1]);
  /** La famille d'une ISO de la bibliothèque : windows, linux ou outil (même règle que ecran.ts category). */
  function familleIso(i) {
    const n = String(i && i.name || '').toLowerCase(), r = (i && i.recipe) || {};
    if (r.os === 'windows' || /windows|win1[01]|win2\d/.test(n)) return 'windows';
    if (r.os === 'outil' || /clonezilla|gparted|memtest|rescue|hiren|systemrescue|shredos/.test(n)) return 'outil';
    return 'linux';
  }
  /** Les choix offerts pour une entrée : ce que l'appli sait faire (dispo) ; le reste grisé « bientôt ». */
  function choixDe(e) {
    if (e.famille === 'vm') return [{ id: 'vm', dispo: Boolean(e.vmDispo) }];
    if (e.famille === 'outil') return [{ id: 'iso', dispo: true }];
    if (e.famille === 'windows') return [{ id: 'iso', dispo: true }, { id: 'installe', dispo: true }];
    return [{ id: 'iso', dispo: true }, { id: 'persistance', dispo: PERSIST.test(String(e.fichier).toLowerCase()) }, { id: 'installe', dispo: INSTALL_AUTO.includes(e.kind) }];
  }
  /** La liste à montrer : les ISO démarrables de la bibliothèque, puis les VM d'Hydre (si la façon les garde). */
  function entrees(isos, vms, avecVms) {
    const out = [];
    for (const i of Array.isArray(isos) ? isos : []) {
      if (!i || typeof i !== 'object' || !i.recipe || i.err) continue;
      const famille = familleIso(i), j = joli(i.name), nom = j.version ? `${j.titre} ${j.version}` : j.titre;
      const e = { id: `iso:${propre(i.id)}`, nom, famille, kind: String(i.recipe.kind || ''), fichier: `${propre(i.name)}.iso`, octets: Math.max(0, Number(i.size) || 0), prete: (i.etat ?? 'prête') === 'prête' };
      out.push({ ...e, couleur: couleur(nom, famille), lettre: (j.titre || '?').charAt(0).toUpperCase(), choix: choixDe(e) });
    }
    if (avecVms) {
      for (const v of Array.isArray(vms) ? vms : []) {
        if (!v || typeof v !== 'object') continue;
        const nom = propre(v.nom) || '?', lisible = Boolean(v.disque), tourne = Boolean(v.enMarche) && !v.instantaneFait;
        // Sans la taille de son disque (cle_vms ne la donne pas toujours), une VM ne compte jamais pour 0 : grisée.
        const go = Number(v.tailleGo), connue = Number.isFinite(go) && go > 0;
        const e = { id: `vm:${propre(v.origine)}:${propre(v.serveur ?? '')}:${propre(v.vmid ?? nom)}`, nom, famille: 'vm', kind: '', fichier: '', octets: connue ? go * GIO : 0, prete: true, vmDispo: lisible && !tourne && connue, vmRaison: !lisible ? 'vm.nonLisible' : tourne ? 'vm.enMarche' : !connue ? 'vm.tailleInconnue' : '', vm: v };
        out.push({ ...e, couleur: couleur(nom, 'vm'), lettre: nom.charAt(0).toUpperCase(), choix: choixDe(e) });
      }
    }
    return out;
  }
  const dispo = (e, id) => e.choix.some((c) => c.id === id && c.dispo);
  /** Le choix de départ d'un système selon la façon : « installé » pour la façon « installés » quand c'est possible. */
  function defautPour(facon, e) {
    if (e.famille === 'vm') return 'vm';
    if (facon === 'installes' && dispo(e, 'installe')) return 'installe';
    return 'iso';
  }
  /** Changer de façon : les systèmes dont le choix n'a pas été changé à la main prennent le défaut de la nouvelle façon. */
  function appliquerFacon(choisis, liste, facon) {
    const out = {};
    for (const [id, c] of Object.entries(choisis || {})) {
      const e = liste.find((x) => x.id === id);
      out[id] = !e || c.main ? { ...c } : { choix: defautPour(facon, e), main: false };
    }
    return out;
  }
  /** Filtre et recherche (sans accents ni majuscules, sur le nom). */
  function filtrer(liste, filtre, q) {
    const f = FILTRES.includes(filtre) ? filtre : 'tout', mots = plat(q).split(/\s+/).filter(Boolean);
    return liste.filter((e) => (f === 'tout' || e.famille === f) && mots.every((m) => plat(e.nom).includes(m)));
  }
  /** Les systèmes choisis qui existent encore dans la liste, dans l'ordre de la liste. */
  const choisisValides = (choisis, liste) => liste.filter((e) => choisis && choisis[e.id] && e.prete && dispo(e, choisis[e.id].choix));
  /** Le descripteur envoyé au serveur (contrat SystemeCle, sérialisé comme le composeur). */
  function systemesPourPlan(choisis, liste) {
    const ser = W.OdinGeneseCleComposer && W.OdinGeneseCleComposer.logique && W.OdinGeneseCleComposer.logique.serialiser;
    return choisisValides(choisis, liste).map((e) => {
      const choix = choisis[e.id].choix;
      const s = e.famille === 'vm'
        ? { nom: e.nom, famille: e.vm.famille || 'inconnu', choix: 'vm', mode: 'demarrer', vmSource: { origine: e.vm.origine, vmid: e.vm.vmid, serveur: e.vm.serveur, nom: e.nom, famille: e.vm.famille || 'inconnu', disque: e.vm.disque, instantaneFait: Boolean(e.vm.instantaneFait), tailleGo: Number(e.vm.tailleGo) || 0 } }
        : { nom: e.nom, fichier: e.fichier, famille: e.famille === 'windows' ? 'windows' : 'linux', choix, mode: choix === 'iso' ? 'demarrer' : 'installer' };
      return typeof ser === 'function' ? ser(s) : s;
    });
  }
  /** La place que prend un système selon son choix (ce que montre sa carte). Un système installé garde aussi son ISO
   *  sur la clé : cle-ecrire.ts copie l'ISO de chaque système dans /ISO, installé ou non. */
  function octetsDe(e, choix) {
    if (choix === 'installe') return (e.famille === 'windows' ? 32 : LINUX_INSTALLE_GO) * GIO + e.octets;
    if (choix === 'persistance') return e.octets + MEMOIRE_GO * GIO;
    return e.octets;
  }
  /**
   * La place, d'après le PLAN du serveur (cle_place) : les partitions des systèmes installés (et la mémoire des ISO)
   * viennent du plan ; les fichiers posés sur la partition ISO (ISO, disques de VM) doivent tenir dans sa taille.
   * etat : vide (rien de choisi), calcul (le plan n'est pas encore là), erreur, ok, trop.
   */
  function place(plan, choisis, liste, totalOctets) {
    const valides = choisisValides(choisis, liste), n = valides.length, total = Math.max(0, Number(totalOctets) || 0);
    // Les fichiers posés sur la partition des ISO : chaque ISO (même celle d'un système installé) et chaque disque de VM.
    const fichiers = valides.reduce((s, e) => s + e.octets, 0);
    if (!n) return { etat: 'vide', n, prisOctets: 0, totalOctets: total, resteOctets: total, pct: 0 };
    if (!plan || plan.etat === 'calcul' || plan.etat === 'rien') return { etat: 'calcul', n, prisOctets: 0, totalOctets: total, resteOctets: 0, pct: 0 };
    const d = plan.data;
    if (plan.etat !== 'pret' || !d || typeof d.possible !== 'boolean') return { etat: 'erreur', n, prisOctets: 0, totalOctets: total, resteOctets: 0, pct: 0 };
    const parts = Array.isArray(d.partitions) ? d.partitions : [];
    const isoGo = parts.filter((p) => p && p.role === 'ISO ODIN').reduce((s, p) => s + (Number(p.tailleGo) || 0), 0);
    const autresGo = parts.filter((p) => p && p.role !== 'ISO ODIN').reduce((s, p) => s + (Number(p.tailleGo) || 0), 0);
    // Plan refusé : le serveur ne rend pas de partitions ; la place demandée est alors estimée système par système
    // (mêmes tailles par défaut que le serveur), pour que la barre dise combien ça dépasse.
    const pris = d.possible === true ? autresGo * GIO + fichiers : valides.reduce((s, e) => s + octetsDe(e, choisis[e.id].choix), 0);
    const tient = d.possible === true && fichiers + MARGE_OCTETS <= isoGo * GIO && pris + MARGE_OCTETS <= total;
    return { etat: tient ? 'ok' : 'trop', n, prisOctets: pris, totalOctets: total, resteOctets: Math.max(0, total - pris - MARGE_OCTETS), pct: total ? Math.min(100, (pris / total) * 100) : 100 };
  }
  /** Le texte de la barre de place. */
  function textePlace(p, sorte, lang) {
    const sfx = sorte === 'disque' ? '.disque' : '';
    const gauche = p.etat === 'calcul' || p.etat === 'erreur' ? mot(sorte === 'disque' ? 'place.nom.disque' : 'place.nom') : mot('place.pris', { pris: taille(p.prisOctets, lang), total: taille(p.totalOctets, lang) });
    const droite = p.etat === 'vide' ? mot('place.vide') : p.etat === 'calcul' ? mot('place.calcul') : p.etat === 'erreur' ? mot('place.erreur') : p.etat === 'trop' ? mot(`place.trop${sfx}`) : mot(`place.reste.${pluriel(p.n, lang)}`, { n: nombre(p.n, lang), reste: taille(p.resteOctets, lang) });
    const aide = p.etat === 'vide' ? mot('aide.vide') : p.etat === 'calcul' ? mot('aide.calcul') : p.etat === 'erreur' ? mot('aide.erreur') : p.etat === 'trop' ? mot(`aide.trop${sfx}`) : '';
    return { gauche, droite, aide };
  }
  const peutContinuer = (p) => Boolean(p && p.etat === 'ok');

  /** L'empreinte d'une demande de place : la cible et les systèmes envoyés (avec leurs tailles). Une réponse n'est
   *  acceptée que pour la demande qui l'a produite : jamais celle d'une autre clé, ni d'un ancien choix. */
  function empreintePlan(cle, choisis, l) {
    if (!cle) return '';
    const v = choisisValides(choisis, l);
    return JSON.stringify([String(cle.id), Number(cle.tailleOctets) || 0, systemesPourPlan(choisis, l), v.map((e) => e.octets)]);
  }

  const logique = { MOTS, mot, FACONS, FACON_DEFAUT, FILTRES, MEMOIRE_GO, MARGE_OCTETS, empreintePlan, joli, familleIso, choixDe, entrees, defautPour, appliquerFacon, filtrer, choisisValides, systemesPourPlan, octetsDe, place, textePlace, peutContinuer };

  // ---------------------------------------------------------------- l'état (gardé quand on change d'étape)
  const Z = {
    facon: FACON_DEFAUT, vms: true, choisis: {}, filtre: 'tout', q: '', msg: '',
    biblio: { etat: 'rien', liste: [], raison: '' }, vmsL: { etat: 'rien', liste: [], raison: '' },
    plan: { etat: 'rien', data: null }, enVol: false, refaire: false, cible: '', dernier: null,
  };
  let O = null; // les outils du dernier rendu : { cle, post, redessiner, pied, nom, sorte }
  const liste = () => entrees(Z.biblio.liste, Z.vmsL.liste, Z.vms);
  const cibleDe = (brut) => {
    const cd = W.OdinGeneseCleComposer && W.OdinGeneseCleComposer.logique && W.OdinGeneseCleComposer.logique.cibleDepuis;
    if (typeof cd === 'function') return cd(brut);
    return { id: brut.id, genre: brut.genre === 'cle' ? 'cle' : (brut.externe ? 'disque-externe' : 'disque-interne'), tailleOctets: Number(brut.tailleOctets) || 0, estOdin: Boolean(brut.estOdin) };
  };
  /** La place pour une clé donnée : le plan gardé n'est pris que s'il a été calculé pour CETTE clé et CE choix. */
  function placePour(cle) {
    const l = liste(), sig = empreintePlan(cle, Z.choisis, l);
    return place(sig && Z.plan.sig === sig ? Z.plan : null, Z.choisis, l, cle ? Number(cle.tailleOctets) || 0 : 0);
  }
  const placeActuelle = () => placePour(O && O.cle);
  /** Les étapes 4 et suivantes s'ouvrent quand l'étape 3 est juste pour la clé choisie (au moins un système, et tout
   *  tient). cle : le disque choisi maintenant (sans elle : celui du dernier rendu). */
  const pret = (cle) => peutContinuer(placePour(cle === undefined ? O && O.cle : cle));

  // ------------------------------------------------ lectures (aucune écriture)
  const raisonDe = (r, e) => String((r && r.text) || (e && e.message) || e || '?');
  async function chargerBiblio() {
    if (!O || Z.biblio.etat === 'charge') return;
    Z.biblio = { ...Z.biblio, etat: 'charge' };
    let r, e;
    try { r = await O.post('isos'); } catch (x) { e = x; }
    Z.biblio = r && r.ok !== false && Array.isArray(r.data) ? { etat: 'pret', liste: r.data, raison: '' } : { etat: 'erreur', liste: [], raison: raisonDe(r, e) };
    apresChangement();
  }
  async function chargerVms() {
    if (!O || Z.vmsL.etat === 'charge') return;
    Z.vmsL = { ...Z.vmsL, etat: 'charge' };
    let r, e;
    try { r = await O.post('cle_vms'); } catch (x) { e = x; }
    const d = r && r.data;
    const arr = Array.isArray(d) ? d : d && typeof d === 'object' ? [].concat(d.vms || [], d.locales || [], d.proxmox || [], d.depot || []) : null;
    Z.vmsL = r && r.ok !== false && arr ? { etat: 'pret', liste: arr, raison: '' } : { etat: 'erreur', liste: [], raison: raisonDe(r, e) };
    apresChangement();
  }
  /** Le plan de place pour le choix ACTUEL : une seule demande à la fois, refaite si le choix a changé entre-temps. */
  async function calculer() {
    if (!O || !O.cle) return;
    const sys = systemesPourPlan(Z.choisis, liste());
    if (!sys.length) { Z.plan = { etat: 'rien', data: null }; return; }
    Z.plan = { etat: 'calcul', data: null };
    if (Z.enVol) { Z.refaire = true; return; }
    Z.enVol = true;
    let r, e, sig = '';
    try {
      do {
        Z.refaire = false; r = undefined; e = undefined;
        const cle = O && O.cle;
        if (!cle) break;
        const charge = { cible: cibleDe(cle), systemes: systemesPourPlan(Z.choisis, liste()) };
        if (!charge.systemes.length) break;
        sig = empreintePlan(cle, Z.choisis, liste());
        try { r = await O.post('cle_place', charge); } catch (x) { e = x; }
      } while (Z.refaire);
    } finally { Z.enVol = false; }
    // La réponse porte l'empreinte de SA demande : si la clé ou le choix ont changé depuis, elle n'est pas prise.
    if (!systemesPourPlan(Z.choisis, liste()).length) Z.plan = { etat: 'rien', data: null };
    else Z.plan = r && r.data && typeof r.data === 'object' && typeof r.data.possible === 'boolean' ? { etat: 'pret', data: r.data, sig } : { etat: 'erreur', data: null, raison: raisonDe(r, e), sig };
    if (O) O.redessiner();
  }
  function apresChangement(focus) {
    void calculer();
    if (O) O.redessiner(focus);
  }

  // ------------------------------------------------ actions
  function choisirFacon(f) {
    if (!FACONS.includes(f) || f === Z.facon) return;
    Z.facon = f; Z.msg = ''; Z.choisis = appliquerFacon(Z.choisis, liste(), f);
    apresChangement(`facon-${f}`);
  }
  function basculerVms() {
    Z.vms = !Z.vms; Z.msg = '';
    if (!Z.vms) {
      const avant = Object.keys(Z.choisis).length;
      Z.choisis = Object.fromEntries(Object.entries(Z.choisis).filter(([id]) => !id.startsWith('vm:')));
      const n = avant - Object.keys(Z.choisis).length;
      if (n) Z.msg = mot(`vms.retirees.${pluriel(n, langue())}`, { n: nombre(n, langue()) });
      if (Z.filtre === 'vm') Z.filtre = 'tout';
    }
    apresChangement('vms');
  }
  function basculer(e) {
    Z.msg = '';
    if (Z.choisis[e.id]) { const c = { ...Z.choisis }; delete c[e.id]; Z.choisis = c; }
    else if (e.prete && e.choix.some((x) => x.dispo)) Z.choisis = { ...Z.choisis, [e.id]: { choix: dispo(e, defautPour(Z.facon, e)) ? defautPour(Z.facon, e) : e.choix.find((x) => x.dispo).id, main: false } };
    apresChangement(`add-${e.id}`);
  }
  function prendreChoix(e, id) {
    if (!Z.choisis[e.id] || !dispo(e, id)) return;
    Z.choisis = { ...Z.choisis, [e.id]: { choix: id, main: true } };
    apresChangement(`how-${e.id}-${id}`);
  }
  function filtrerPar(f) { if (!FILTRES.includes(f)) return; Z.filtre = f; O && O.redessiner(`fil-${f}`); }

  // ---------------------------------------------------------------- la page
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  };
  const P = { plus: 'M12 5v14M5 12h14', check: 'M5 12l5 5L20 7', file: 'M14 3H6v18h12V7zM14 3v4h4', vm: 'M3 5h18v11H3zM9 20h6M12 16v4M8 9h3M8 12h5' };
  const ic = (n, s = 18, w = 2) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };
  const dessin = (corps, w) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 200 90'); v.setAttribute('width', w); v.setAttribute('height', Math.round(w * 0.45)); v.setAttribute('aria-hidden', 'true'); v.innerHTML = corps; return v; };
  // Les dessins de la maquette : des formes (une clé, des disques, des écrans), aucun logo.
  const CLE_SVG = '<rect x="70" y="14" width="60" height="70" rx="10" fill="none" stroke="currentColor" stroke-width="3"/><rect x="88" y="4" width="24" height="12" rx="3" fill="currentColor" opacity=".5"/>';
  const ISO_SVG = `${CLE_SVG}<g><circle cx="40" cy="30" r="16" fill="none" stroke="var(--accent)" stroke-width="3"/><circle cx="40" cy="30" r="4" fill="var(--accent)"/><circle cx="160" cy="30" r="16" fill="none" stroke="var(--accent)" stroke-width="3"/><circle cx="160" cy="30" r="4" fill="var(--accent)"/><circle cx="40" cy="68" r="12" fill="none" stroke="var(--accent)" stroke-width="3" opacity=".6"/><circle cx="160" cy="68" r="12" fill="none" stroke="var(--accent)" stroke-width="3" opacity=".6"/></g><path d="M58 30h12M130 30h12M54 66h16M130 66h16" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/>`;
  const INST_SVG = `${CLE_SVG}<rect x="80" y="26" width="40" height="14" rx="3" fill="var(--accent)"/><rect x="80" y="44" width="40" height="14" rx="3" fill="var(--accent)" opacity=".7"/><rect x="80" y="62" width="40" height="12" rx="3" fill="var(--accent)" opacity=".45"/><rect x="18" y="26" width="40" height="30" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M28 64h20" stroke="currentColor" stroke-width="2"/><rect x="142" y="26" width="40" height="30" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M152 64h20" stroke="currentColor" stroke-width="2"/>`;

  const CSS = `
.cks-choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:14px}
.cks-choice{position:relative;text-align:left;border:1.5px solid var(--line);background:var(--panel);color:var(--ink);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:8px;font:inherit;cursor:pointer;min-height:44px}
.cks-choice[aria-checked=true]{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
.cks-choice .ill{height:96px;border-radius:12px;background:color-mix(in srgb,var(--ink) 6%,transparent);display:flex;gap:6px;align-items:center;justify-content:center;color:var(--ink)}
.cks-choice b{font-size:16px}.cks-choice p{margin:0;font-size:13px;color:var(--muted)}
.cks-choice ul{margin:0;padding-left:18px;font-size:12.5px;color:var(--muted)}
.cks-choice .tick{position:absolute;top:14px;right:14px;width:24px;height:24px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;background:var(--panel)}
.cks-choice[aria-checked=true] .tick{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}
.cks-conseil{position:absolute;top:-10px;left:14px;font-size:11px;font-weight:700;background:var(--accent);color:var(--on-accent,#fff);padding:2px 9px;border-radius:999px}
.cks-switch{margin-top:12px;width:100%;display:flex;gap:14px;align-items:center;text-align:left;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:16px;padding:12px 14px;font:inherit;cursor:pointer;min-height:44px}
.cks-switch .lg{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--accent);flex:none}
.cks-switch span.t{flex:1;min-width:0}.cks-switch b{display:block;font-size:14.5px}.cks-switch small{display:block;font-size:12.5px;color:var(--muted);margin-top:2px}
.cks-tg{width:46px;height:28px;border-radius:999px;background:color-mix(in srgb,var(--ink) 18%,transparent);position:relative;flex:none;transition:background .2s}
.cks-tg::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .2s}
.cks-switch[aria-checked=true] .cks-tg{background:var(--accent)}.cks-switch[aria-checked=true] .cks-tg::after{left:21px}
.cks-place{position:sticky;top:0;z-index:4;display:flex;gap:12px;align-items:center;padding:12px 14px;background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow,none)}
.cks-place b{white-space:nowrap;font-size:13px}.cks-place .d{color:var(--muted)}.cks-place.trop .d{color:var(--bad)}
.cks-place .bar{flex:1;min-width:0;height:14px;border-radius:7px;overflow:hidden;background:color-mix(in srgb,var(--ink) 9%,transparent)}
.cks-place .bar i{display:block;height:100%;background:var(--accent);transition:width .3s}.cks-place.trop .bar i{background:var(--bad)}
.cks-filters{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px;align-items:center}
.cks-chip{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel);font:600 13px inherit;color:var(--muted);cursor:pointer}
.cks-chip[aria-pressed=true]{background:color-mix(in srgb,var(--accent) 14%,var(--panel));color:var(--ink);border-color:var(--accent)}
.cks-search{flex:1;min-width:180px;min-height:44px;box-sizing:border-box;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:0 12px;font:14px inherit}
.cks-lib{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.cks-sys{border:1.5px solid var(--line);background:var(--panel);border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:10px;min-width:0}
.cks-sys.on{border-color:var(--accent)}.cks-sys.off{opacity:.62}
.cks-sys .top{display:flex;gap:10px;align-items:center;min-width:0}
.cks-mono{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:17px;flex:none;position:relative;overflow:hidden}
.cks-mono::after{content:"";position:absolute;inset:auto -30% -50% auto;width:70%;height:70%;border-radius:50%;background:rgba(255,255,255,.22)}
.cks-sys .nm{min-width:0;flex:1}.cks-sys .nm b{display:block;font-size:14.5px;overflow-wrap:anywhere}.cks-sys .nm small{color:var(--muted);font-size:12px}
.cks-add{flex:none;margin-left:auto;width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--ink);display:grid;place-items:center;cursor:pointer}
.cks-add[aria-pressed=true]{background:var(--accent);color:var(--on-accent,#fff);border-color:transparent}
.cks-add:disabled{opacity:.45;cursor:not-allowed}
.cks-how{display:flex;gap:4px;flex-wrap:wrap}
.cks-how button{flex:1 1 0;min-width:60px;min-height:44px;border-radius:10px;border:1px solid var(--line);background:none;font:600 12px inherit;padding:0 8px;color:var(--muted);line-height:1.15;cursor:pointer}
.cks-how button[aria-pressed=true]{background:color-mix(in srgb,var(--accent) 14%,var(--panel));color:var(--ink);border-color:var(--accent)}
.cks-how button:disabled{opacity:.5;cursor:not-allowed;border-style:dashed}
.cks-note{font-size:12px;color:var(--muted);margin:0}
.cks-drop{margin-top:12px;border:2px dashed var(--line);border-radius:16px;padding:16px;text-align:center;color:var(--muted);font-size:13px;display:flex;flex-direction:column;align-items:center;gap:4px}
.cks-drop b{color:var(--ink);font-size:13.5px}
@media (max-width:640px){
  .cks-place{flex-wrap:wrap}.cks-place .bar{flex-basis:100%;order:3}
  .cks-lib{grid-template-columns:1fr}
  .cks-choice .ill svg{max-width:100%}
}
@media (prefers-reduced-motion:reduce){.cks-tg,.cks-tg::after,.cks-place .bar i{transition:none}}
`;

  function suivant(i, n, touche) {
    const f = W.OdinGeneseCleEtapes && W.OdinGeneseCleEtapes.logique && W.OdinGeneseCleEtapes.logique.suivant;
    if (typeof f === 'function') return f(i, n, touche);
    const pas = touche === 'ArrowRight' || touche === 'ArrowDown' ? 1 : touche === 'ArrowLeft' || touche === 'ArrowUp' ? -1 : 0;
    if (touche === 'Home') return 0; if (touche === 'End') return n - 1;
    return pas ? (i + pas + n) % n : -1;
  }

  function etapeFacon() {
    const sorte = O.sorte;
    const ILL = { iso: () => [dessin(ISO_SVG, 200)], installes: () => [dessin(INST_SVG, 200)], deux: () => [dessin(ISO_SVG, 108), dessin(INST_SVG, 108)] };
    const POINTS = { iso: 3, installes: 3, deux: 2 };
    const groupe = el('div', { class: 'cks-choices', role: 'radiogroup', 'aria-label': mot('facon.groupe') }, ...FACONS.map((f, i) => {
      const pris = Z.facon === f;
      return el('button', {
        type: 'button', class: 'cks-choice', role: 'radio', 'aria-checked': String(pris), 'data-f': `facon-${f}`, 'data-facon': f, tabindex: pris ? '0' : '-1',
        onclick: () => choisirFacon(f),
        onkeydown: (e) => { const j = suivant(i, FACONS.length, e.key); if (j < 0) return; e.preventDefault(); if (FACONS[j] === Z.facon) { O.redessiner(`facon-${FACONS[j]}`); return; } choisirFacon(FACONS[j]); },
      }, f === FACON_DEFAUT ? el('span', { class: 'cks-conseil' }, mot('facon.conseil')) : null,
      el('span', { class: 'ill' }, ...ILL[f]()), el('b', {}, mot(`facon.${f}`)), el('p', {}, mot(`facon.${f}.texte`)),
      el('ul', {}, ...Array.from({ length: POINTS[f] }, (_, k) => el('li', {}, mot(`facon.${f}.p${k + 1}`)))),
      el('span', { class: 'tick' }, pris ? ic('check', 14, 3) : null));
    }));
    const vm = el('button', { type: 'button', class: 'cks-switch', role: 'switch', 'aria-checked': String(Z.vms), 'data-f': 'vms', onclick: () => basculerVms() },
      el('span', { class: 'lg' }, ic('vm', 22)), el('span', { class: 't' }, el('b', {}, mot('vm.titre')), el('small', {}, mot('vm.texte'))), el('span', { class: 'cks-tg', 'aria-hidden': 'true' }));
    const sec = el('section', { class: 'ck-card' }, el('h4', {}, mot(sorte === 'disque' ? 'facon.titre.disque' : 'facon.titre')), el('p', { class: 'ck-lead', style: 'margin:0' }, mot('facon.lead')), groupe, vm);
    if (Z.msg) sec.append(el('p', { class: 'ck-msg', role: 'status', style: 'margin:10px 0 0' }, Z.msg));
    return [sec, O.pied(1, 3, false, '')];
  }

  function nomChoix(e, id) { return id === 'installe' && e.famille === 'windows' ? mot('choix.installe.windows') : mot(`choix.${id}`); }
  function carteSysteme(e) {
    const c = Z.choisis[e.id], on = Boolean(c), lang = langue();
    const peut = e.prete && e.choix.some((x) => x.dispo);
    const sz = on ? octetsDe(e, c.choix) : e.octets;
    const kids = [el('div', { class: 'top' },
      el('span', { class: 'cks-mono', style: `background:${e.couleur}`, 'aria-hidden': 'true' }, e.lettre),
      el('span', { class: 'nm' }, el('b', {}, e.nom), el('small', {}, mot('sys.sous', { fam: mot(`fam.${e.famille}`), taille: e.famille === 'vm' && !e.octets ? mot('sys.tailleInconnue') : taille(sz, lang) }))),
      el('button', { type: 'button', class: 'cks-add', 'aria-pressed': String(on), 'data-f': `add-${e.id}`, 'data-sys': e.id, disabled: !on && !peut, 'aria-label': mot(on ? 'sys.retirer' : 'sys.ajouter', { nom: e.nom }), onclick: () => basculer(e) }, ic(on ? 'check' : 'plus', 20, 2.6)))];
    if (!e.prete) kids.push(el('p', { class: 'cks-note' }, mot('sys.pasPrete')));
    else if (e.famille === 'vm' && !e.vmDispo) kids.push(el('p', { class: 'cks-note' }, mot(e.vmRaison)));
    if (on) {
      kids.push(el('div', { class: 'cks-how', role: 'group', 'aria-label': mot('choix.groupe', { nom: e.nom }) }, ...e.choix.map((x) => el('button', {
        type: 'button', 'aria-pressed': String(c.choix === x.id), 'data-f': `how-${e.id}-${x.id}`, 'data-how': `${e.id}:${x.id}`, disabled: !x.dispo,
        onclick: () => prendreChoix(e, x.id),
      }, x.dispo ? nomChoix(e, x.id) : mot('choix.bientot', { choix: nomChoix(e, x.id) })))));
      const note = c.choix === 'installe' ? (e.famille === 'windows' ? mot('note.installe.windows') : mot('note.installe.linux', { taille: taille(LINUX_INSTALLE_GO * GIO, lang) }))
        : c.choix === 'persistance' ? mot('note.persistance', { taille: taille(MEMOIRE_GO * GIO, lang) })
          : c.choix === 'vm' ? mot('note.vm')
            : e.choix.some((x) => x.id === 'installe' && !x.dispo) ? mot('note.bientot.installe') : '';
      if (note) kids.push(el('p', { class: 'cks-note' }, note));
    }
    return el('div', { class: `cks-sys${on ? ' on' : ''}${!on && !peut ? ' off' : ''}`, 'data-carte': e.id }, ...kids);
  }
  function grille() {
    const tous = liste(), vus = filtrer(tous, Z.filtre, Z.q);
    const lib = el('div', { class: 'cks-lib', 'data-f': 'lib' });
    if (vus.length) lib.append(...vus.map(carteSysteme));
    else if (Z.biblio.etat === 'pret' && (Z.q || Z.filtre !== 'tout' || tous.length)) lib.append(el('p', { class: 'ck-msg', role: 'status' }, mot('rien')));
    return lib;
  }
  function barrePlace() {
    const p = placeActuelle(), t = textePlace(p, O.sorte, langue());
    if (p.etat === 'ok' || p.etat === 'trop' || p.etat === 'vide') Z.dernier = p;
    const montre = p.etat === 'calcul' && Z.dernier ? Z.dernier : p;
    return el('div', { class: `cks-place${p.etat === 'trop' ? ' trop' : ''}`, role: 'status', 'aria-live': 'polite', 'data-place': p.etat },
      el('b', {}, t.gauche),
      el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: `width:${montre.pct.toFixed(1)}%` })),
      el('b', { class: 'd' }, t.droite));
  }
  function etapeSystemes() {
    if (Z.biblio.etat === 'rien') void chargerBiblio();
    if (Z.vms && Z.vmsL.etat === 'rien') void chargerVms();
    const p = placeActuelle();
    // Pas de plan pour cette clé et ce choix (autre clé choisie entre-temps, réponse d'une ancienne demande) : on le demande.
    if (p.n && !Z.enVol && Z.plan.sig !== empreintePlan(O.cle, Z.choisis, liste())) void calculer();
    const filtres = FILTRES.filter((f) => f !== 'vm' || Z.vms);
    const recherche = el('input', { class: 'cks-search', type: 'search', placeholder: mot('recherche'), 'aria-label': mot('recherche.nom'), 'data-f': 'q', autocomplete: 'off',
      oninput: (ev) => { const n = ev.currentTarget || ev.target; Z.q = String(n && n.value != null ? n.value : ''); const vieux = O.wrap && O.wrap.querySelector ? O.wrap.querySelector('.cks-lib') : null; if (vieux && vieux.parentNode && typeof vieux.replaceWith === 'function') vieux.replaceWith(grille()); else O.redessiner('q'); } });
    recherche.value = Z.q;
    const sec = el('section', { class: 'ck-card' }, el('h4', {}, mot('sys.titre')),
      el('p', { class: 'ck-lead' }, mot('sys.lead', { defaut: mot(`choix.${Z.facon === 'installes' ? 'installe' : 'iso'}`) })),
      el('div', { class: 'cks-filters' }, el('div', { role: 'group', 'aria-label': mot('filtre.nom'), style: 'display:contents' }, ...filtres.map((f) => el('button', { type: 'button', class: 'cks-chip', 'aria-pressed': String(Z.filtre === f), 'data-f': `fil-${f}`, 'data-fil': f, onclick: () => filtrerPar(f) }, mot(`filtre.${f}`)))), recherche));
    if (Z.msg) sec.append(el('p', { class: 'ck-msg', role: 'status' }, Z.msg));
    if (Z.biblio.etat === 'charge' || Z.biblio.etat === 'rien') sec.append(el('p', { class: 'ck-msg', role: 'status' }, mot('biblio.charge')));
    else if (Z.biblio.etat === 'erreur') sec.append(el('p', { class: 'ck-msg ko', role: 'alert' }, mot('biblio.erreur', { raison: Z.biblio.raison })));
    else if (!Z.biblio.liste.some((i) => i && i.recipe)) sec.append(el('p', { class: 'ck-msg', role: 'status' }, mot('biblio.vide')));
    if (Z.vms && (Z.filtre === 'vm' || Z.filtre === 'tout')) {
      if (Z.vmsL.etat === 'charge') sec.append(el('p', { class: 'ck-msg', role: 'status' }, mot('vms.charge')));
      else if (Z.vmsL.etat === 'erreur') sec.append(el('p', { class: 'ck-msg ko', role: 'status' }, mot('vms.erreur', { raison: Z.vmsL.raison })));
      else if (Z.vmsL.etat === 'pret' && !Z.vmsL.liste.length && Z.filtre === 'vm') sec.append(el('p', { class: 'ck-msg', role: 'status' }, mot('vms.aucune')));
    }
    sec.append(grille(), el('div', { class: 'cks-drop', 'aria-disabled': 'true' }, ic('file', 22), el('b', {}, mot('depot')), el('span', {}, mot('depot.bientot'))));
    const t = textePlace(p, O.sorte, langue());
    return [barrePlace(), sec, O.pied(2, 4, !peutContinuer(p), t.aide)];
  }

  /**
   * Rend l'étape n (2 ou 3). outils : { cle (le disque choisi, tel que lu par cle_disques), sorte ('cle'|'disque'),
   * post, redessiner(focus), pied(avant, apres, ferme, aide), wrap }.
   */
  function rendre(n, outils) {
    if (typeof document !== 'undefined' && document.head && !document.getElementById?.('cksCss')) document.head.append(el('style', { id: 'cksCss' }, CSS));
    O = outils;
    const sig = outils && outils.cle ? `${outils.cle.id}|${outils.cle.tailleOctets}` : '';
    if (sig !== Z.cible) { Z.cible = sig; Z.plan = { etat: 'rien', data: null }; Z.dernier = null; }
    return n === 2 ? etapeFacon() : etapeSystemes();
  }
  /** Les systèmes composés (pour le composeur des étapes suivantes, en attendant leurs lots). */
  const composes = () => systemesPourPlan(Z.choisis, liste());

  W.OdinGeneseCleSystemes = { MOTS, logique, rendre, pret, composes, etat: Z };
})();
