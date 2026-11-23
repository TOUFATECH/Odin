// Genèse · onglet « Déployer » (maquette validée « Genèse · Systèmes », lot S5) : déployer un système téléchargé.
//   - la barre des 6 étapes (Vers quoi, Postes ou Machine, Système, Logiciels, Windows, Vérifier), au clavier (flèches,
//     Début, Fin ; une étape fermée est sautée), la même que celle des clés USB (son déplacement au clavier est repris
//     de thjalfi-cle-etapes.js quand il est là) ;
//   - étape 1 « Vers quoi » : une clé USB ou un disque (les trois façons, puis le PONT vers « Clés USB · Déployer » avec
//     le système, la façon et le profil de logiciels déjà choisis), par le réseau (un ou plusieurs PC), une machine
//     virtuelle ;
//   - étape 2 « Postes » : les PC vus au menu de démarrage réseau EN DIRECT (action en lecture « postes_vus », relue
//     toutes les 3 s tant que l'étape est à l'écran), plusieurs à la fois, un PC bloqué grisé, « le prochain PC qui
//     démarre (30 min) », l'ajout par adresse MAC (vérifiée : ni diffusion, ni groupe, ni nulle), la façon (effacer et
//     installer tout seul, ou le proposer au menu sans effacer) et le garde-fou rouge qui nomme chaque PC dont le
//     disque sera effacé ;
//   - étape 2 « Machine » (machine virtuelle) : nom, où, processeurs, mémoire, disque — créée par Hydre (« creer_machine »)
//     à l'étape Vérifier ; sans Hydre : « bientôt » ;
//   - étape 3 « Système » : la bibliothèque de l'onglet Systèmes (action « systemes ») ; ceux qui ne sont pas prêts sont
//     grisés avec leur raison.
// Les étapes 4 à 6 (logiciels, options Windows, vérifier puis lancer) arrivent avec le lot S6 : elles disent « bientôt ».
// RIEN ici n'efface, n'installe ni n'écrit : seules des lectures partent (postes_vus, systemes, profils_logiciels, isos).
// Une adresse MAC ou un nom de PC est toujours écrit comme du texte. Tous les textes sont dans MOTS.
// Expose window.OdinGeneseDeployer = { onglets, dessiner(root, onglet, hote), MOTS, logique, etat, choisirSysteme }.
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    onglet: 'Déployer',
    'etapes.nom': 'Étapes du déploiement', 'etape.position': 'Étape {n} sur {total}',
    'etape.1': 'Vers quoi', 'etape.1.sous': 'Clé, réseau ou VM',
    'etape.2': 'Postes', 'etape.2.sous': 'Quels PC', 'etape.2.vm': 'Machine', 'etape.2.vm.sous': 'Taille et place',
    'etape.3': 'Système', 'etape.3.sous': 'Dans ta bibliothèque',
    'etape.4': 'Logiciels', 'etape.4.sous': 'et scripts',
    'etape.5': 'Windows', 'etape.5.sous': 'Options', 'etape.5.sans': 'Pas de Windows',
    'etape.6': 'Vérifier', 'etape.6.sous': 'Avant d\'effacer', 'etape.6.vm': 'Avant de créer',
    'etape.fermee': 'Termine d\'abord l\'étape d\'avant.', 'etape.fermee.cle': 'La suite se passe dans « Clés USB · Déployer ».',
    'cible.titre': 'Où déployer {sys} ?', 'cible.titre.seul': 'Où déployer le système ?',
    'cible.lead': 'Le même système, les mêmes logiciels et les mêmes options Windows, trois façons de l\'emmener.',
    'cible.groupe': 'Vers quoi',
    'cible.cle': 'Une clé USB ou un disque',
    'cible.cle.texte': 'Clé USB, disque externe, carte SD ou SSD branché : il démarre le système (et d\'autres) sur n\'importe quel PC, même sans réseau.',
    'cible.cle.p1': 'Double démarrage : 2 à 20 systèmes et plus', 'cible.cle.p2': 'ISO qui démarrent, ou machines virtuelles copiées', 'cible.cle.p3': 'Disques internes jamais proposés',
    'cible.reseau': 'Par le réseau, un ou plusieurs PC',
    'cible.reseau.texte': 'Les PC démarrent par le réseau et s\'installent tout seuls, sans clé. Tu suis chaque PC jusqu\'à la fin.',
    'cible.reseau.p1': 'Autant de PC que tu veux, en même temps', 'cible.reseau.p2': 'Rien à brancher, rien à copier',
    'cible.conseil': 'Conseillé pour plusieurs PC',
    'cible.vm': 'Une machine virtuelle',
    'cible.vm.texte': 'Une machine créée par Hydre, ici ou sur un serveur du réseau, qui s\'installe toute seule.',
    'cible.vm.p1': 'Rien n\'est effacé', 'cible.vm.p2': 'Prête en quelques minutes, à essayer ou à garder',
    'facon.titre': 'Sur la clé ou le disque, comment ?', 'facon.groupe': 'Façon sur la clé',
    'facon.iso': 'ISO qui démarre', 'facon.iso.texte': 'Copiée telle quelle : essayer ou installer sur un PC.',
    'facon.double': 'Double démarrage', 'facon.double.texte': '{sys} installé sur la clé, à côté d\'autres : 2, 3… jusqu\'à 20 et plus, choisis au démarrage. Il garde tes fichiers.', 'facon.double.sys': 'Le système',
    'facon.vm': 'Machines virtuelles', 'facon.vm.texte': 'Des machines virtuelles prêtes, copiées sur la clé, qui démarrent depuis elle.',
    'profil.titre': 'Logiciels', 'profil.groupe': 'Profil de logiciels', 'profil.aucun': 'Aucun',
    'profil.charge': 'Odin lit tes profils de logiciels…', 'profil.vide': 'Aucun profil pour l\'instant : crée-en un dans l\'onglet « Logiciels ».',
    'profil.erreur': 'Les profils ne peuvent pas être lus : {raison}',
    'pont.titre': 'La suite se passe dans « Clés USB · Déployer »',
    'pont.texte': 'Même parcours, mêmes étapes. {quoi}La clé ou le disque se choisit à l\'étape 1, avec son garde-fou ; les disques internes restent verrouillés.',
    'pont.sys': '{sys} y sera déjà coché à l\'étape Systèmes, en « {facon} », ',
    'pont.sans.sys': 'Tu choisiras les systèmes à l\'étape Systèmes, en « {facon} », ',
    'pont.profil': 'avec les logiciels du profil « {profil} ». ', 'pont.profil.aucun': 'sans profil de logiciels. ',
    'pont.vm': 'Les machines virtuelles à copier se choisissent à l\'étape Systèmes. ',
    'pont.facon.iso': 'ISO qui démarre', 'pont.facon.double': 'Installé', 'pont.facon.vm': 'Copie de VM',
    'pont.continuer': 'Continuer', 'pont.ouvrir': 'Ouvrir Clés USB', 'pont.nom': 'Continuer dans Clés USB',
    'postes.titre': 'Quels PC ?', 'postes.direct': 'en direct',
    'postes.lead': 'Les PC qui ont démarré par le réseau. Allume un PC et choisis « démarrer par le réseau » dans son menu de démarrage : il apparaît ici tout seul.',
    'serveur.texte': 'Genèse répond aux PC du réseau · ', 'serveur.allume': 'allumé', 'serveur.eteint': 'éteint',
    'serveur.mode.proxy': 'à côté de la box', 'serveur.mode.odin': 'adresses données par Odin', 'serveur.mode.aucun': 'réglé dans ta box',
    'serveur.regler': 'Régler', 'serveur.eteint.aide': 'Genèse est éteint : les PC ne reçoivent pas le menu. Allume-le dans l\'onglet « Tout ».',
    'postes.groupe': 'PC du réseau', 'postes.charge': 'Odin regarde les PC du réseau…',
    'postes.vide': 'Aucun PC vu pour l\'instant. Allume un PC et choisis « démarrer par le réseau » : il apparaît ici tout seul.',
    'postes.erreur': 'Odin ne peut pas lire les PC du réseau : {raison}',
    'pc.auMenu': 'au menu', 'pc.autorise': 'autorisé', 'pc.bloque': 'bloqué', 'pc.ajoute': 'ajouté',
    'pc.ligne': '{mac} · {fw}', 'pc.fw.inconnu': 'démarrage inconnu', 'fw.uefi': 'UEFI', 'fw.bios': 'BIOS', 'fw.uefi32': 'UEFI 32 bits', 'fw.arm64': 'ARM 64 bits',
    'pc.installe': 'Installé par Odin : {image} ({quand})', 'pc.disque.inconnu': 'Sur son disque : Odin ne sait pas encore',
    'pc.vu': 'Vu {quand}', 'pc.jamais': 'Pas encore vu au démarrage réseau',
    'pc.bloque.texte': 'Bloqué dans Genèse : il ne reçoit ni menu ni fichiers. Débloque-le dans Protection.',
    'pc.choisir': 'Choisir {nom}', 'pc.retirer': 'Retirer {nom}', 'pc.sansnom': 'PC {fin}',
    'quand.maintenant': 'en ce moment', 'quand.min': 'il y a {n} min', 'quand.h': 'il y a {n} h', 'quand.j': 'il y a {n} j',
    prochain: 'Aussi le prochain PC qui démarre (30 min)',
    'mac.label': 'Ajouter un PC par son adresse MAC', 'mac.exemple': '52:54:00:12:34:56', 'mac.ajouter': 'Ajouter',
    'mac.vide': 'Écris l\'adresse MAC du PC (six paires, par exemple 52:54:00:12:34:56).',
    'mac.forme': 'Cette adresse MAC n\'est pas valable : six paires de chiffres ou de lettres de a à f, séparées par « : » ou « - ».',
    'mac.diffusion': 'Cette adresse s\'adresse à tous les PC à la fois (diffusion) : elle ne désigne pas un PC.',
    'mac.groupe': 'Cette adresse désigne un groupe de PC, pas un PC.',
    'mac.nulle': 'Cette adresse est vide (que des zéros) : elle ne désigne pas un PC.',
    'mac.bloque': 'Ce PC est bloqué dans Genèse : débloque-le d\'abord dans Protection.',
    'mac.deja': 'Ce PC est déjà dans la liste : il est choisi.', 'mac.ajoute': 'PC ajouté et choisi.',
    'mac.locale': 'PC ajouté et choisi. Attention : cette adresse a été choisie par l\'appareil lui-même (souvent au hasard) ; elle peut changer au prochain démarrage, vérifie-la sur le PC.',
    'mac.trop': 'Assez de PC ajoutés à la main pour une fois (50).',
    'comment.titre': 'Comment', 'comment.auto': 'Effacer et installer tout seul', 'comment.menu': 'Le proposer au menu du PC, sans effacer',
    'garde.titre.one': 'Le disque de {n} PC sera entièrement effacé', 'garde.titre.other': 'Le disque de {n} PC sera entièrement effacé',
    'garde.pc': '{nom} ({mac})', 'garde.prochain': 'le prochain PC qui démarre par le réseau dans les 30 minutes',
    'garde.p1': 'Avant d\'effacer, tu taperas une phrase et tu appuieras longuement (étape Vérifier).',
    'garde.p2': 'Au moment d\'installer, Odin revérifiera chaque PC (adresse, numéro de série, taille du disque) : si ce n\'est pas le même, il ne fera rien.',
    'garde.p3': 'Chaque PC ne s\'installe qu\'une fois, puis redémarre sur son disque. Un PC qui n\'est pas choisi démarre sur son propre disque, comme d\'habitude.',
    'garde.menu.titre': 'Rien n\'est effacé sans quelqu\'un devant le PC',
    'garde.menu.texte': 'Le système est proposé au menu du PC. « Installer pour moi » sur place : Odin te demande l\'accord avant d\'effacer.',
    'pied.choisis.one': '{n} PC choisi', 'pied.choisis.other': '{n} PC choisis', 'pied.prochain': ' + le prochain', 'pied.prochain.seul': 'Le prochain PC qui démarre',
    'pied.aucun': 'Choisis au moins un PC.', 'pied.retour': 'Retour', 'pied.continuer': 'Continuer', 'pied.sys': 'Choisis un système.',
    'vm.titre': 'La machine virtuelle', 'vm.lead': 'Créée par Hydre, elle démarre sur le système choisi puis s\'installe toute seule.',
    'vm.nom': 'Nom', 'vm.nom.aide': 'Des lettres sans accents, des chiffres et des tirets (40 au plus).', 'vm.ou': 'Où', 'vm.ce': 'Ce PC', 'vm.srv': 'Serveur du réseau', 'vm.bientot': 'bientôt',
    'vm.cpu': 'Processeurs', 'vm.mem': 'Mémoire', 'vm.disk': 'Disque', 'u.go': '{n} Go',
    'vm.garde.titre': 'Rien n\'est effacé', 'vm.garde.texte': 'Un disque virtuel neuf est créé ; la place se prend au fur et à mesure ({n} au plus).',
    'vm.sans': 'Hydre n\'est pas là : la machine virtuelle arrive bientôt. En attendant, déploie sur une clé ou par le réseau.',
    'vm.charge': 'Odin regarde si Hydre peut créer la machine…',
    'sys.titre': 'Quel système ?', 'sys.lead': 'Dans ta bibliothèque, ceux dont l\'empreinte est vérifiée.', 'sys.lead.reseau': ' Un outil (partitions, copie de disque) démarre seulement, sans rien installer.',
    'sys.groupe': 'Système', 'sys.filtres': 'Filtrer les systèmes', 'f.tout': 'Tout', 'f.windows': 'Windows', 'f.linux': 'Linux', 'f.outil': 'Outils', 'f.serveur': 'Serveurs',
    'sys.ajouter': 'Ajouter un système', 'sys.charge': 'Lecture de la bibliothèque…', 'sys.vide': 'Aucun système prêt pour l\'instant : ajoute-en un dans l\'onglet « Systèmes ».', 'sys.vide.filtre': 'Aucun système ne correspond.',
    'sys.erreur': 'Les systèmes ne peuvent pas être lus : {raison}',
    'fam.windows': 'Windows', 'fam.linux': 'Linux', 'fam.outil': 'Outil', 'fam.serveur': 'Serveur', 'fam.autre': 'Autre',
    'sys.installe': 's\'installe tout seul', 'sys.demarre': 'démarre seulement', 'sys.maj': '{version} disponible',
    'sys.dl': '{pct} · en téléchargement', 'sys.dl.sans': 'en téléchargement', 'sys.verif': 'vérification en cours', 'sys.faux': 'empreinte fausse', 'sys.bloque': 'bloqué par l\'antivirus',
    'sys.inconnu': 'Odin ne sait pas encore la démarrer', 'sys.pasvm': 'pas pour une machine virtuelle',
    'bientot.titre': 'Bientôt',
    'bientot.4': 'Les logiciels et scripts du déploiement arrivent avec la suite : le profil, la liste pour ce système et le script créé tout seul.',
    'bientot.5': 'Les options Windows du déploiement arrivent avec la suite : sans exigences, compte local, mot de passe créé par Odin pour chaque PC.',
    'bientot.6': 'Vérifier puis lancer arrive avec la suite. Rien n\'est lancé d\'ici : aucun PC n\'est effacé, aucune machine n\'est créée.',
    'recap.titre': 'Ce qui est déjà choisi',
    'recap.cible.reseau': 'Par le réseau : {pcs}', 'recap.cible.vm': 'Machine virtuelle « {nom} » : {cpu} processeur(s), {mem}, {disk}',
    'recap.facon.auto': 'Effacer et installer tout seul', 'recap.facon.menu': 'Proposé au menu du PC, sans effacer',
    'recap.sys': 'Système : {sys}',
    annule: 'Annulé.',
  };
  const mot = (k, v) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_m, x) => (v && v[x] != null ? String(v[x]) : ''));
  const langue = () => (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'fr';
  const nombre = (n) => { try { return new Intl.NumberFormat(langue()).format(n); } catch { return String(n); } };
  const pluriel = (n, base, v) => { let r = 'other'; try { r = new Intl.PluralRules(langue()).select(n); } catch { r = n > 1 ? 'other' : 'one'; } return mot(`${base}.${r === 'one' ? 'one' : 'other'}`, v); };

  // ---------------------------------------------------------------- la logique (pure)
  const NB_ETAPES = 6;
  const CIBLES = ['cle', 'reseau', 'vm'];
  const FACONS_CLE = ['iso', 'double', 'vm'];
  /** La façon de la clé (thjalfi-cle-systemes.js) qui correspond à chacune : double démarrage = systèmes installés. */
  const VERS_CLE = { iso: 'iso', double: 'installes', vm: 'iso' };
  const FILTRES = ['tout', 'windows', 'linux', 'outil', 'serveur'];
  const CPUS = [1, 2, 4], MEMS = [2, 4, 8], DISKS = [32, 64, 128];
  const AJOUTS_MAX = 50;
  const MAC_ECRITE = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}$/i;
  /** Une adresse MAC tapée : { ok, mac } (minuscules, « : » ; locale: true quand l'appareil l'a choisie lui-même, souvent au
   *  hasard : elle peut changer) ou { ok: false, raison } (vide, forme, diffusion, groupe, nulle). Pur. */
  function verifMac(x) {
    const t = typeof x === 'string' ? x.replace(/^[ \t]+|[ \t]+$/g, '') : '';
    if (!t) return { ok: false, raison: 'vide' };
    if (t.length > 17 || !MAC_ECRITE.test(t)) return { ok: false, raison: 'forme' };
    const h = t.toLowerCase().replace(/[^0-9a-f]/g, ''), mac = h.match(/../g).join(':');
    if (h === 'ffffffffffff') return { ok: false, raison: 'diffusion' };
    if (h === '000000000000') return { ok: false, raison: 'nulle' };
    if ((parseInt(h.slice(0, 2), 16) & 1) === 1) return { ok: false, raison: 'groupe' };
    return (parseInt(h.slice(0, 2), 16) & 2) === 2 ? { ok: true, mac, locale: true } : { ok: true, mac };
  }
  /** Le nom d'une machine virtuelle : lettres sans accents, chiffres, tirets ; 1 à 40 ; ni début ni fin par un tiret. Pur. */
  const nomVmValide = (n) => typeof n === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/i.test(n);
  /** Un nom proposé d'après le système : « vm-ubuntu-1 ». Pur. */
  const nomVmPour = (carte) => { const b = String((carte && carte.nom) || 'systeme').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-')[0] || 'systeme'; return `vm-${b.slice(0, 30)}-1`; };
  /** Ce système peut-il être choisi pour cette cible ? Un outil ne s'installe pas dans une machine virtuelle. Pur. */
  const choisissable = (c, cible) => Boolean(c && c.deployable && !(cible === 'vm' && c.famille === 'outil'));
  /** Les PC choisis, sauf ceux qui sont bloqués. Un PC choisi qui n'est plus dans la liste (relecture en panne, PC oublié
   *  par le serveur) reste choisi, donc reste nommé par le garde-fou : rien n'est jamais retiré en silence. Pur. */
  function pcsChoisis(Z) {
    const vus = (Z.postes.data && Array.isArray(Z.postes.data.postes)) ? Z.postes.data.postes : [];
    const out = [];
    for (const mac of Z.pcs) {
      const p = vus.find((x) => x.mac === mac);
      if (p) { if (!p.bloque) out.push(p); continue; }
      out.push({ mac, ajoute: Z.ajoutes.includes(mac), auMenu: false, bloque: false, autorise: false });
    }
    return out;
  }
  /** Les PC dont le disque sera effacé (façon « effacer et installer »), le prochain PC compris. Pur. */
  function aEffacer(Z) { return Z.facon === 'auto' ? { pcs: pcsChoisis(Z), prochain: Z.prochain } : { pcs: [], prochain: false }; }
  /** La carte du système choisi, si elle est encore dans la bibliothèque et choisissable pour la cible. Pur. */
  function carteChoisie(Z) {
    const l = Z.systemes.data && Array.isArray(Z.systemes.data.cartes) ? Z.systemes.data.cartes : null;
    if (!l) return Z.sysCarte && Z.sysCarte.id === Z.sys ? Z.sysCarte : null;
    const c = l.find((x) => x.id === Z.sys);
    return c && choisissable(c, Z.cible) ? c : null;
  }
  /** Une étape s'ouvre : la 1 toujours ; pour une clé, la suite se fait dans « Clés USB » ; la 2 une fois la cible choisie ;
   *  la 3 avec au moins un PC (ou le prochain), ou une machine virtuelle possible et bien nommée ; la 4 et la 6 avec un
   *  système ; la 5 seulement pour un Windows. Pur. */
  function etapeOuverte(n, Z) {
    if (n === 1) return true;
    if (Z.cible === 'cle' || !CIBLES.includes(Z.cible) || n < 1 || n > NB_ETAPES) return false;
    if (n === 2) return true;
    const trois = Z.cible === 'reseau' ? pcsChoisis(Z).length > 0 || Z.prochain : Z.vmDispo === true && nomVmValide(Z.vm.nom);
    if (n === 3) return trois;
    const c = carteChoisie(Z);
    if (!trois || !c) return false;
    return n !== 5 || c.famille === 'windows';
  }
  /** Le prochain élément (flèches, Début, Fin), en sautant ceux qui sont fermés ; celui des clés USB quand il est là. */
  function suivantLocal(i, n, touche, ouvert = () => true) {
    const pas = touche === 'ArrowRight' || touche === 'ArrowDown' ? 1 : touche === 'ArrowLeft' || touche === 'ArrowUp' ? -1 : 0;
    const essais = touche === 'Home' ? [...Array(n).keys()] : touche === 'End' ? [...Array(n).keys()].reverse() : pas ? Array.from({ length: n - 1 }, (_, k) => (i + pas * (k + 1) + n * n) % n) : [];
    return essais.find((j) => ouvert(j)) ?? -1;
  }
  const suivant = (i, n, touche, ouvert) => { const f = W.OdinGeneseCleEtapes && W.OdinGeneseCleEtapes.logique && W.OdinGeneseCleEtapes.logique.suivant; return (typeof f === 'function' ? f : suivantLocal)(i, n, touche, ouvert); };
  /** « en ce moment », « il y a 4 min », « il y a 2 h », « il y a 3 j ». Pur. */
  function quand(vu, maintenant) {
    const d = Math.max(0, (Number(maintenant) || 0) - (Number(vu) || 0));
    if (d < 60_000) return mot('quand.maintenant');
    if (d < 3600_000) return mot('quand.min', { n: nombre(Math.round(d / 60_000)) });
    if (d < 86400_000) return mot('quand.h', { n: nombre(Math.round(d / 3600_000)) });
    return mot('quand.j', { n: nombre(Math.round(d / 86400_000)) });
  }
  const nomPc = (p) => (p && p.nom) || mot('pc.sansnom', { fin: String((p && p.mac) || '').slice(-5) });
  const logique = { MOTS, mot, NB_ETAPES, CIBLES, FACONS_CLE, VERS_CLE, verifMac, nomVmValide, nomVmPour, choisissable, pcsChoisis, aEffacer, carteChoisie, etapeOuverte, suivant: suivantLocal, quand };

  // ---------------------------------------------------------------- l'état (gardé quand on change d'onglet)
  const Z = {
    etape: 1, cible: 'reseau', cleFacon: 'iso', profil: null, pontId: '',
    sys: '', sysCarte: null, filtre: 'tout',
    pcs: [], ajoutes: [], prochain: false, facon: 'auto', mac: '', macMsg: '', macKo: false,
    vm: { nom: '', hote: 'ce', cpu: 2, mem: 4, disk: 64 }, vmDispo: undefined,
    postes: { etat: 'rien', data: null, raison: '', sig: '' },
    systemes: { etat: 'rien', data: null, raison: '' },
    profils: { etat: 'rien', liste: [], raison: '' },
  };

  // ---------------------------------------------------------------- le dessin
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  };
  const P = {
    check: 'M5 12l5 5L20 7', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6 6 18',
    pc: 'M3 5h18v11H3zM9 20h6M12 16v4', lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3', warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
    net: 'M3 6h18v5H3zM3 13h18v5H3zM7 8.5h.01M7 15.5h.01', usb: 'M9 2h6v6H9zM7 8h10v9a5 5 0 0 1-10 0z', open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  };
  const svg = (inner, vb, w, h) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', vb); if (w) v.setAttribute('width', w); if (h) v.setAttribute('height', h); v.setAttribute('aria-hidden', 'true'); v.innerHTML = inner; return v; };
  const ic = (n, s = 18, w = 2) => svg(`<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`, '0 0 24 24', s, s);
  // Les trois dessins de la maquette (une clé, un réseau de PC, une machine dans un écran).
  const ILL = {
    cle: '<rect x="78" y="22" width="44" height="62" rx="8" fill="none" stroke="currentColor" stroke-width="3"/><rect x="88" y="6" width="24" height="18" rx="3" fill="currentColor" opacity=".45"/><rect x="88" y="36" width="24" height="7" rx="3" fill="var(--accent)"/><rect x="88" y="48" width="24" height="7" rx="3" fill="var(--accent)" opacity=".6"/><rect x="88" y="60" width="24" height="7" rx="3" fill="var(--accent)" opacity=".35"/>',
    reseau: '<rect x="80" y="6" width="40" height="26" rx="6" fill="var(--accent)" opacity=".9"/><path d="M100 32v10M37 42h126M37 42v12M100 42v12M163 42v12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' + [20, 83, 146].map((x) => `<rect x="${x}" y="54" width="34" height="22" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M${x + 11} 82h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`).join(''),
    vm: '<rect x="50" y="8" width="100" height="62" rx="8" fill="none" stroke="currentColor" stroke-width="3"/><rect x="66" y="20" width="68" height="38" rx="5" fill="var(--accent)" opacity=".25" stroke="var(--accent)" stroke-width="2.5" stroke-dasharray="5 4"/><rect x="82" y="30" width="36" height="18" rx="3" fill="var(--accent)"/><path d="M85 82h30M100 70v12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  };

  const CSS = `
.dp{display:flex;flex-direction:column;gap:14px;min-width:0}
.dp-steps{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px;margin:0;list-style:none}.dp-steps::-webkit-scrollbar{display:none}
.dp-steps li{flex:1;min-width:0;display:flex}
.dp-steps button{flex:1;min-width:120px;border:1px solid var(--line);background:var(--panel);border-radius:12px;min-height:52px;padding:6px 12px;text-align:left;display:flex;align-items:center;gap:10px;color:var(--muted);cursor:pointer;font:inherit}
.dp-steps i{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-weight:700;font-size:12px;background:color-mix(in srgb,var(--ink) 7%,transparent);flex:none}
.dp-steps b{display:block;font-size:13px;color:var(--ink);font-weight:600;white-space:nowrap}
.dp-steps span{min-width:0}.dp-steps small{display:block;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dp-steps button[aria-current=step]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.dp-steps button[aria-current=step] i{background:var(--accent);color:var(--on-accent,#fff)}
.dp-steps button.fait i{background:var(--good);color:#fff}
.dp-steps button:disabled{opacity:.5;cursor:default}
.dp-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow,none);padding:18px;min-width:0}
.dp-card>h4{margin:0 0 4px;font-size:17px;letter-spacing:-.01em;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dp-lead{margin:0 0 14px;color:var(--muted);font-size:13px}
.dp-h5{font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:18px 0 8px}
.dp-choix{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.dp-choix.f{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.dp-c{position:relative;text-align:left;border:1.5px solid var(--line);background:var(--panel);color:var(--ink);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:6px;font:inherit;cursor:pointer;min-height:44px;min-width:0}
.dp-c[aria-checked=true]{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
.dp-c .ill{display:grid;place-items:center;background:color-mix(in srgb,var(--ink) 5%,transparent);border-radius:12px;padding:10px;color:var(--ink);margin-bottom:6px}
.dp-c .ill svg{width:100%;max-width:200px;height:auto}
.dp-c b{font-size:16px}.dp-c p{margin:0;font-size:13px;color:var(--muted)}.dp-c ul{margin:4px 0 0;padding-left:18px;font-size:12.5px;color:var(--muted)}
.dp-c .tick{position:absolute;top:12px;right:12px;width:24px;height:24px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;background:var(--panel)}
.dp-c[aria-checked=true] .tick{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}
.dp-conseil{position:absolute;top:-11px;left:16px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:var(--accent);color:var(--on-accent,#fff)}
.dp-chips{display:flex;gap:8px;flex-wrap:wrap}
.dp-chip{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;font-weight:600;font-size:13.5px;display:inline-flex;align-items:center;gap:8px;cursor:pointer}
.dp-chip[aria-pressed=true]{background:color-mix(in srgb,var(--accent) 14%,var(--panel));border-color:var(--accent);color:var(--ink)}
.dp-chip:disabled{opacity:.5;cursor:not-allowed}.dp-chip small{font-weight:600;color:var(--muted)}
.dp-pont{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:14px;padding:16px;border-radius:16px;border:1.5px dashed var(--accent);background:color-mix(in srgb,var(--accent) 8%,var(--panel))}
.dp-pont .lg{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:var(--panel);color:var(--accent);flex:none}
.dp-pont>span{flex:1;min-width:220px}.dp-pont b{display:block;font-size:15px}.dp-pont small{display:block;font-size:12.5px;color:var(--muted);margin-top:3px}
.dp-srv{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--ink) 5%,transparent);font-size:13px;margin-bottom:12px}
.dp-srv .grow{flex:1;min-width:160px}
.dp-tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink);white-space:nowrap}
.dp-tag.ok{background:color-mix(in srgb,var(--good) 16%,transparent);color:var(--good)}
.dp-tag.bad{background:color-mix(in srgb,var(--bad) 14%,transparent);color:var(--bad)}
.dp-tag.warn{background:color-mix(in srgb,var(--warn,#b45309) 16%,transparent);color:var(--warn,#b45309)}
.dp-live{font-size:12px;font-weight:700;color:var(--bad);display:inline-flex;align-items:center;gap:5px}.dp-live::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--bad);opacity:.8}
.dp-pcs{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.dp-pc{position:relative;text-align:left;border:1.5px solid var(--line);background:var(--panel);color:var(--ink);border-radius:16px;padding:14px;display:flex;gap:12px;align-items:flex-start;width:100%;font:inherit;cursor:pointer;min-height:44px;min-width:0}
.dp-pc[aria-checked=true]{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.dp-pc .box{width:24px;height:24px;border-radius:7px;border:2px solid var(--line);display:grid;place-items:center;flex:none;margin-top:10px}
.dp-pc[aria-checked=true] .box{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}
.dp-pc .lg{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--accent);flex:none}
.dp-pc .nm{flex:1;min-width:0}.dp-pc b{font-size:15px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;overflow-wrap:anywhere}
.dp-pc small{display:block;font-size:12.5px;color:var(--muted);overflow-wrap:anywhere;margin-top:1px}
.dp-pc.lock{opacity:.65;border-style:dashed;cursor:not-allowed;box-shadow:none}.dp-pc.lock .lg{color:var(--muted)}
.dp-pc-wrap{position:relative;display:flex;min-width:0}.dp-pc-wrap .dp-pc{padding-right:52px}
.dp-pc-wrap .rm{position:absolute;top:4px;right:4px;width:44px;height:44px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--muted);display:grid;place-items:center;cursor:pointer}
.dp-row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-top:12px}
.dp-field{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
.dp-field label,.dp-field .lb{font-size:13px;font-weight:600}
.dp-in{min-height:44px;border:1px solid var(--line);border-radius:12px;padding:0 12px;background:var(--panel);color:var(--ink);font:inherit;font-size:14px;min-width:0;width:100%;box-sizing:border-box}
.dp-in[aria-invalid=true]{border-color:var(--bad)}
.dp-msg{margin:6px 0 0;font-size:13px;color:var(--muted)}.dp-msg.ko{color:var(--bad);font-weight:600}.dp-msg.ok{color:var(--good);font-weight:600}
.dp-seg{display:flex;gap:6px;flex-wrap:wrap}
.dp-seg button{min-height:44px;min-width:44px;justify-content:center;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;font-weight:600;font-size:13.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.dp-seg button[aria-pressed=true]{background:color-mix(in srgb,var(--accent) 14%,var(--panel));border-color:var(--accent)}
.dp-seg button:disabled{opacity:.5;cursor:not-allowed}.dp-seg small{font-weight:600;color:var(--muted)}
.dp-vm{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:12px}.dp-vm.deux{grid-template-columns:2fr 1fr}
.dp-guard{display:flex;gap:14px;align-items:flex-start;padding:16px;border-radius:16px;border:2px solid var(--bad);background:var(--bad-bg,color-mix(in srgb,var(--bad) 10%,var(--panel)));color:var(--ink);margin-top:14px}
.dp-guard.calm{border-color:var(--good);background:color-mix(in srgb,var(--good) 10%,var(--panel))}
.dp-guard .gi{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:var(--bad);color:#fff;flex:none}
.dp-guard.calm .gi{background:var(--good)}
.dp-guard>div{min-width:0;flex:1}.dp-guard b{font-size:15px;display:block}.dp-guard p{margin:4px 0 0;font-size:13px;overflow-wrap:anywhere}
.dp-guard ul{margin:6px 0 0;padding-left:18px;font-size:13px;overflow-wrap:anywhere}
.dp-libs{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.dp-sys{position:relative;text-align:left;border:1.5px solid var(--line);background:var(--panel);color:var(--ink);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px;font:inherit;cursor:pointer;min-width:0}
.dp-sys[aria-checked=true]{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.dp-sys:disabled{opacity:.55;cursor:not-allowed}
.dp-sys .top{display:flex;gap:12px;align-items:center}.dp-sys .lt{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:800;flex:none}
.dp-sys .top>span:nth-child(2){flex:1;min-width:0}.dp-sys b{display:block;font-size:15px;overflow-wrap:anywhere}.dp-sys small{display:block;font-size:12.5px;color:var(--muted)}
.dp-sys .tk{width:24px;height:24px;border-radius:50%;background:var(--accent);color:var(--on-accent,#fff);display:grid;place-items:center;flex:none}
.dp-sys .st{display:flex;gap:6px;flex-wrap:wrap}
.dp-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.dp-tools .grow{flex:1}
.dp-btn{min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;font-weight:600;font-size:14px;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;text-align:left}
.dp-btn.pri{background:var(--accent);color:var(--on-accent,#fff);border-color:transparent}
.dp-btn:disabled{opacity:.45;cursor:not-allowed}
.dp-foot{position:sticky;bottom:0;display:flex;gap:10px;align-items:center;justify-content:flex-end;padding:12px 0 4px;background:linear-gradient(transparent,var(--bg) 30%);z-index:3;flex-wrap:wrap}
.dp-foot .grow{flex:1;min-width:140px;font-size:12.5px;color:var(--muted)}
.dp-soon{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.dp-soon>div{flex:1;min-width:220px}.dp-soon p{margin:4px 0 0;font-size:13.5px}
.dp-soon ul{margin:8px 0 0;padding-left:18px;font-size:13px;color:var(--muted)}
.dp-odin{width:64px;height:64px;flex:none;display:inline-block;border-radius:50%;background:var(--accent)}.dp-odin svg{width:100%;height:100%;display:block}.dp-odin:has(svg){background:none}
@media (max-width:900px){.dp-choix{grid-template-columns:1fr}.dp-vm{grid-template-columns:1fr}.dp-vm.deux{grid-template-columns:1fr}}
@media (max-width:640px){
  .dp-card{padding:14px}
  .dp-pcs,.dp-libs{grid-template-columns:1fr}
  .dp-steps li{flex:none}
  .dp-steps button{min-width:auto;flex:none;padding:6px 10px}
  .dp-steps button span{display:none}.dp-steps button[aria-current=step] span{display:block}
  .dp-steps small{max-width:110px}
  .dp-c .ill{display:none}
  .dp-guard{flex-direction:column}
  .dp-foot{flex-wrap:nowrap}.dp-foot .grow{display:none}.dp-foot .dp-btn{flex:1}
}
@media (prefers-reduced-motion:reduce){.dp *{transition:none!important;animation:none!important}}
`;

  // ---------------------------------------------------------------- les lectures (aucune écriture)
  const postModule = async (module, action, input = {}) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module, action, input }) })).json();
  const raisonDe = (r, e) => String((r && r.text) || (e && e.message) || e || '?');
  let H = null; // { post, aller, wrap, redessiner }

  async function lirePostes() {
    if (!H) return;
    let r, e;
    try { r = await H.post('postes_vus', {}); } catch (x) { e = x; }
    if (r && r.ok !== false && r.data && Array.isArray(r.data.postes)) {
      const sig = JSON.stringify(r.data);
      const change = sig !== Z.postes.sig;
      Z.postes = { etat: 'pret', data: r.data, raison: '', sig };
      Z.vmDispo = r.data.vm === true;
      // Un PC choisi qui vient d'être bloqué n'est plus choisi.
      Z.pcs = Z.pcs.filter((m) => !r.data.postes.some((p) => p.mac === m && p.bloque));
      return change;
    }
    // En panne : la dernière liste reste à l'écran (les PC choisis aussi), avec la raison.
    const change = Z.postes.etat !== 'erreur';
    Z.postes = { etat: 'erreur', data: Z.postes.data, raison: raisonDe(r, e), sig: '' };
    if (Z.vmDispo === undefined) Z.vmDispo = false;
    return change;
  }
  async function lireSystemes() {
    if (!H) return;
    Z.systemes = { ...Z.systemes, etat: 'charge' };
    let r, e;
    try { r = await H.post('systemes', {}); } catch (x) { e = x; }
    Z.systemes = r && r.ok !== false && r.data && Array.isArray(r.data.cartes) ? { etat: 'pret', data: r.data, raison: '' } : { etat: 'erreur', data: null, raison: raisonDe(r, e) };
    const c = carteChoisie(Z);
    if (c) Z.sysCarte = c;
  }
  async function lireProfils() {
    if (!H || Z.profils.etat === 'charge') return;
    Z.profils = { ...Z.profils, etat: 'charge' };
    let r, e;
    try { r = await H.post('profils_logiciels', {}); } catch (x) { e = x; }
    Z.profils = r && r.ok !== false && r.data && Array.isArray(r.data.profils) ? { etat: 'pret', liste: r.data.profils.filter((p) => p && typeof p === 'object' && p.id), raison: '' } : { etat: 'erreur', liste: [], raison: raisonDe(r, e) };
    // Le premier profil est proposé d'office (comme « Standard » dans la maquette), une seule fois.
    if (Z.profil === null) Z.profil = Z.profils.liste[0] ? Z.profils.liste[0].id : '';
  }

  // ---------------------------------------------------------------- les choix (rien n'est écrit)
  function aller(n, focus) { if (!etapeOuverte(n, Z)) return; Z.etape = n; dessinerTout(focus || `etape-${n}`); }
  function choisirCible(c) {
    if (!CIBLES.includes(c)) return;
    Z.cible = c;
    if (c === 'vm' && !Z.vm.nom) Z.vm = { ...Z.vm, nom: nomVmPour(carteChoisie(Z)) };
    if (c === 'cle' && Z.profils.etat === 'rien') void lireProfils().then(() => dessinerTout());
    dessinerTout(`cible-${c}`);
  }
  function basculerPc(mac) {
    const p = (Z.postes.data && Z.postes.data.postes || []).find((x) => x.mac === mac);
    if (p && p.bloque) return;
    Z.pcs = Z.pcs.includes(mac) ? Z.pcs.filter((x) => x !== mac) : [...Z.pcs, mac];
    dessinerTout(`pc-${mac}`);
  }
  function ajouterMac() {
    const v = verifMac(Z.mac);
    if (!v.ok) { Z.macMsg = mot(`mac.${v.raison}`); Z.macKo = true; dessinerTout('mac'); return v; }
    const p = (Z.postes.data && Z.postes.data.postes || []).find((x) => x.mac === v.mac);
    if (p && p.bloque) { Z.macMsg = mot('mac.bloque'); Z.macKo = true; dessinerTout('mac'); return { ok: false, raison: 'bloque' }; }
    if (p || Z.ajoutes.includes(v.mac)) {
      if (!Z.pcs.includes(v.mac)) Z.pcs = [...Z.pcs, v.mac];
      Z.mac = ''; Z.macMsg = mot('mac.deja'); Z.macKo = false; dessinerTout('mac'); return { ok: true, mac: v.mac, deja: true };
    }
    if (Z.ajoutes.length >= AJOUTS_MAX) { Z.macMsg = mot('mac.trop'); Z.macKo = true; dessinerTout('mac'); return { ok: false, raison: 'trop' }; }
    Z.ajoutes = [...Z.ajoutes, v.mac]; Z.pcs = [...Z.pcs, v.mac];
    Z.mac = ''; Z.macMsg = mot(v.locale ? 'mac.locale' : 'mac.ajoute'); Z.macKo = false; dessinerTout('mac');
    return v;
  }
  function retirerAjoute(mac) { Z.ajoutes = Z.ajoutes.filter((x) => x !== mac); Z.pcs = Z.pcs.filter((x) => x !== mac); dessinerTout('mac'); }
  /** Choisir un système (étape 3, ou depuis une carte de l'onglet Systèmes) : son identifiant de carte. */
  function choisirSysteme(id, carte) {
    const l = Z.systemes.data && Array.isArray(Z.systemes.data.cartes) ? Z.systemes.data.cartes : [];
    const c = l.find((x) => x.id === id) || (carte && carte.id === id ? carte : null);
    if (!c || !c.deployable) return false;
    Z.sys = id; Z.sysCarte = c;
    if (Z.cible === 'vm' && /^vm-[a-z0-9]+-1$/.test(Z.vm.nom)) Z.vm = { ...Z.vm, nom: nomVmPour(c) };
    return true;
  }

  /** Le PONT vers « Clés USB · Déployer » : le système (étape 3 de la clé), la façon et le profil de logiciels déjà choisis.
   *  Rien n'est écrit : on règle seulement l'état de la page des clés, puis on ouvre son onglet. */
  async function pont() {
    const SYS = W.OdinGeneseCleSystemes, ET = W.OdinGeneseCleEtapes, LOG = W.OdinGeneseCleLogiciels;
    const c = carteChoisie(Z);
    if (SYS && SYS.etat) {
      const E = SYS.etat, L = SYS.logique || {}, facon = VERS_CLE[Z.cleFacon] || 'iso';
      // Le système amené par le pont d'avant (pas retouché à la main dans la clé) n'est plus coché : un seul système vient
      // d'ici, jamais un mélange.
      const avant = Z.pontId, ici = c && c.iso ? `iso:${c.iso}` : '';
      if (avant && avant !== ici && E.choisis && E.choisis[avant] && !E.choisis[avant].main) { const k = { ...E.choisis }; delete k[avant]; E.choisis = k; }
      Z.pontId = ici;
      if ((!Array.isArray(L.FACONS) || L.FACONS.includes(facon)) && E.facon !== facon) {
        E.facon = facon;
        // Comme un changement de façon dans la clé : les autres systèmes non réglés à la main prennent son défaut.
        try { if (typeof L.appliquerFacon === 'function' && typeof L.entrees === 'function' && E.biblio) E.choisis = L.appliquerFacon(E.choisis, L.entrees(E.biblio.liste, [], false), facon); } catch { /* gardé tel quel */ }
      }
      if (Z.cleFacon === 'vm') E.vms = true;
      if (c && c.iso) {
        const id = `iso:${c.iso}`;
        // Le choix de départ de ce système pour cette façon (« installé » quand la clé sait l'installer), d'après la même
        // bibliothèque que la clé (lecture).
        let e;
        try { const r = H ? await H.post('isos', {}) : null; const l = r && r.ok !== false && Array.isArray(r.data) ? r.data : []; e = typeof L.entrees === 'function' ? L.entrees(l, [], false).find((x) => x.id === id) : undefined; } catch { e = undefined; }
        const choix = e && typeof L.defautPour === 'function' ? L.defautPour(E.facon, e) : 'iso';
        E.choisis = { ...(E.choisis || {}), [id]: { choix, main: false } };
        if (!e && E.biblio && E.biblio.etat !== 'charge') E.biblio = { ...E.biblio, etat: 'rien' };
      }
    }
    // Le profil : repris à l'étape 4 de la clé (« Partir d'un profil »), la première fois qu'elle s'affiche.
    const p = Z.profil ? Z.profils.liste.find((x) => x.id === Z.profil) : null;
    if (LOG && typeof LOG.profilAuProchainAffichage === 'function') LOG.profilAuProchainAffichage(p || null);
    if (ET && ET.etat) {
      ET.etat.onglet = 'deployer';
      // Une clé déjà choisie : droit à l'étape 3 (Systèmes). Sinon l'étape 1 (choisir la clé).
      if (ET.etat.cle) ET.etat.etape = 3;
    }
    if (H && typeof H.aller === 'function') H.aller('cle');
  }

  // ---------------------------------------------------------------- les morceaux
  function barre() {
    const ol = el('ol', { class: 'dp-steps', 'aria-label': mot('etapes.nom'), 'data-f': 'dp-etapes' });
    const c = carteChoisie(Z);
    for (let n = 1; n <= NB_ETAPES; n++) {
      const ouv = etapeOuverte(n, Z), courante = n === Z.etape, faite = n < Z.etape && ouv;
      const t = n === 2 && Z.cible === 'vm' ? mot('etape.2.vm') : mot(`etape.${n}`);
      const sous = n === 2 && Z.cible === 'vm' ? mot('etape.2.vm.sous') : n === 5 && c && c.famille !== 'windows' ? mot('etape.5.sans') : n === 6 && Z.cible === 'vm' ? mot('etape.6.vm') : mot(`etape.${n}.sous`);
      ol.append(el('li', {}, el('button', {
        type: 'button', 'data-f': `etape-${n}`, 'data-dp-etape': String(n), 'aria-current': courante ? 'step' : null, class: faite ? 'fait' : null, disabled: !ouv,
        title: ouv ? null : mot(Z.cible === 'cle' ? 'etape.fermee.cle' : 'etape.fermee'), 'aria-label': `${t} · ${mot('etape.position', { n: nombre(n), total: nombre(NB_ETAPES) })}`,
        onclick: () => aller(n),
        onkeydown: (e) => { const j = suivant(n - 1, NB_ETAPES, e.key, (k) => etapeOuverte(k + 1, Z)); if (j < 0) return; if (e.preventDefault) e.preventDefault(); focaliser(`etape-${j + 1}`); },
      }, el('i', {}, faite ? ic('check', 14, 3) : nombre(n)), el('span', {}, el('b', {}, t), el('small', {}, sous)))));
    }
    return ol;
  }
  function pied(avant, apres, ferme, aide) {
    return el('div', { class: 'dp-foot' }, el('span', { class: 'grow', 'data-f': 'pied-aide' }, aide || ''),
      avant ? el('button', { type: 'button', class: 'dp-btn', 'data-f': 'retour', onclick: () => aller(avant) }, ic('left'), mot('pied.retour')) : null,
      apres ? el('button', { type: 'button', class: 'dp-btn pri', 'data-f': 'continuer', disabled: ferme, onclick: (e) => { const b = e && (e.currentTarget || e.target); if (b && b.getAttribute && b.getAttribute('disabled') != null) return; aller(apres); } }, mot('pied.continuer'), ic('right')) : null);
  }
  /** Un groupe de boutons « radio » au clavier : flèches, Début, Fin (le focus suit le choix). */
  function radios(ids, actuel, choisir, prefixe) {
    return (id, i) => ({
      role: 'radio', 'aria-checked': String(actuel === id), tabindex: actuel === id || (!ids.includes(actuel) && i === 0) ? '0' : '-1', 'data-f': `${prefixe}-${id}`,
      onclick: () => choisir(id),
      onkeydown: (e) => { const j = suivant(i, ids.length, e.key); if (j < 0) return; if (e.preventDefault) e.preventDefault(); choisir(ids[j]); },
    });
  }
  function nomSys(c) { return c ? (c.version ? `${c.nom} ${c.version}` : c.nom) : ''; }

  function etapeVersQuoi() {
    const c = carteChoisie(Z), sys = nomSys(c);
    const R = radios(CIBLES, Z.cible, choisirCible, 'cible');
    const carte = (id, i, pts) => el('button', { type: 'button', class: 'dp-c', 'data-cible': id, ...R(id, i) },
      id === 'reseau' ? el('span', { class: 'dp-conseil' }, mot('cible.conseil')) : null,
      el('span', { class: 'ill' }, svg(ILL[id], '0 0 200 90', 200, 90)),
      el('b', {}, mot(`cible.${id}`)), el('p', {}, mot(`cible.${id}.texte`)),
      el('ul', {}, ...pts.map((k) => el('li', {}, mot(`cible.${id}.${k}`)))),
      el('span', { class: 'tick', 'aria-hidden': 'true' }, Z.cible === id ? ic('check', 14, 3) : null));
    const sec = el('section', { class: 'dp-card', 'aria-labelledby': 'dp-t1' },
      el('h4', { id: 'dp-t1' }, sys ? mot('cible.titre', { sys }) : mot('cible.titre.seul')), el('p', { class: 'dp-lead' }, mot('cible.lead')),
      el('div', { class: 'dp-choix', role: 'radiogroup', 'aria-label': mot('cible.groupe') }, carte('cle', 0, ['p1', 'p2', 'p3']), carte('reseau', 1, ['p1', 'p2']), carte('vm', 2, ['p1', 'p2'])));
    if (Z.cible !== 'cle') return [sec, pied(0, 2, false, '')];
    // Une clé USB ou un disque : la façon, le profil, puis le pont.
    const RF = radios(FACONS_CLE, Z.cleFacon, (f) => { Z.cleFacon = f; dessinerTout(`facon-${f}`); }, 'facon');
    const f = (id, i) => el('button', { type: 'button', class: 'dp-c', 'data-cle-facon': id, ...RF(id, i), style: 'padding:12px' },
      el('b', { style: 'font-size:14.5px' }, mot(`facon.${id}`)), el('p', {}, mot(`facon.${id}.texte`, { sys: sys || mot('facon.double.sys') })),
      el('span', { class: 'tick', 'aria-hidden': 'true' }, Z.cleFacon === id ? ic('check', 14, 3) : null));
    sec.append(el('div', { class: 'dp-h5', id: 'dp-facon' }, mot('facon.titre')),
      el('div', { class: 'dp-choix f', role: 'radiogroup', 'aria-labelledby': 'dp-facon' }, ...FACONS_CLE.map(f)));
    // Le profil de logiciels (commun à la clé, au réseau et aux machines virtuelles).
    const profils = el('div', {}, el('div', { class: 'dp-h5', id: 'dp-profil' }, mot('profil.titre')));
    if (Z.profils.etat === 'pret' && Z.profils.liste.length) {
      profils.append(el('div', { class: 'dp-chips', role: 'group', 'aria-labelledby': 'dp-profil', 'data-f': 'profils' },
        ...Z.profils.liste.map((p) => el('button', { type: 'button', class: 'dp-chip', 'data-profil': p.id, 'data-f': `profil-${p.id}`, 'aria-pressed': String(Z.profil === p.id), onclick: () => { Z.profil = p.id; dessinerTout(`profil-${p.id}`); } }, String(p.nom || '').slice(0, 60))),
        el('button', { type: 'button', class: 'dp-chip', 'data-profil': '', 'data-f': 'profil-aucun', 'aria-pressed': String(!Z.profil), onclick: () => { Z.profil = ''; dessinerTout('profil-aucun'); } }, mot('profil.aucun'))));
    } else profils.append(el('p', { class: 'dp-msg' }, Z.profils.etat === 'erreur' ? mot('profil.erreur', { raison: Z.profils.raison }) : Z.profils.etat === 'pret' ? mot('profil.vide') : mot('profil.charge')));
    sec.append(profils);
    const p = Z.profil ? Z.profils.liste.find((x) => x.id === Z.profil) : null;
    const facon = mot(`pont.facon.${Z.cleFacon}`);
    const quoi = (sys ? mot('pont.sys', { sys, facon }) : mot('pont.sans.sys', { facon })) + (p ? mot('pont.profil', { profil: String(p.nom || '').slice(0, 60) }) : mot('pont.profil.aucun')) + (Z.cleFacon === 'vm' ? mot('pont.vm') : '');
    sec.append(el('div', { class: 'dp-pont', 'data-f': 'pont-boite' }, el('span', { class: 'lg' }, ic('usb', 24)),
      el('span', {}, el('b', {}, mot('pont.titre')), el('small', { 'data-f': 'pont-texte' }, mot('pont.texte', { quoi }))),
      el('button', { type: 'button', class: 'dp-btn pri', 'data-f': 'pont', 'aria-label': mot('pont.nom'), onclick: () => void pont() }, ic('usb'), mot('pont.continuer'), ic('open', 14))));
    return [sec, el('div', { class: 'dp-foot' }, el('span', { class: 'grow' }), el('button', { type: 'button', class: 'dp-btn pri', 'data-f': 'pont-pied', onclick: () => void pont() }, mot('pont.ouvrir'), ic('right')))];
  }

  function cartePc(p) {
    const nom = nomPc(p), maintenant = Date.now();
    const fw = p.fw ? mot(`fw.${p.fw}`) : mot('pc.fw.inconnu');
    const lignes = [el('small', {}, mot('pc.ligne', { mac: p.mac, fw }))];
    const modele = [p.marque, p.modele].filter(Boolean).join(' ');
    if (modele) lignes.push(el('small', {}, modele));
    if (p.bloque) {
      return el('div', { class: 'dp-pc lock', 'aria-disabled': 'true', 'data-poste': p.mac, 'data-bloque': '' },
        el('span', { class: 'lg' }, ic('lock', 22)),
        el('span', { class: 'nm' }, el('b', {}, nom, el('span', { class: 'dp-tag bad' }, mot('pc.bloque'))), ...lignes, el('small', {}, mot('pc.bloque.texte'))));
    }
    lignes.push(el('small', {}, p.installe ? mot('pc.installe', { image: p.installe.image, quand: quand(p.installe.le, maintenant) }) : mot('pc.disque.inconnu')));
    lignes.push(el('small', {}, p.vu ? mot('pc.vu', { quand: p.auMenu ? mot('quand.maintenant') : quand(p.vu, maintenant) }) : mot('pc.jamais')));
    const coche = Z.pcs.includes(p.mac);
    const b = el('button', { type: 'button', class: 'dp-pc', role: 'checkbox', 'aria-checked': String(coche), 'data-poste': p.mac, 'data-f': `pc-${p.mac}`, 'aria-label': mot('pc.choisir', { nom }), onclick: () => basculerPc(p.mac) },
      el('span', { class: 'box', 'aria-hidden': 'true' }, coche ? ic('check', 14, 3) : null),
      el('span', { class: 'lg' }, ic('pc', 22)),
      el('span', { class: 'nm' }, el('b', {}, nom, p.auMenu ? el('span', { class: 'dp-live' }, mot('pc.auMenu')) : null, p.autorise ? el('span', { class: 'dp-tag ok' }, mot('pc.autorise')) : null, p.ajoute ? el('span', { class: 'dp-tag' }, mot('pc.ajoute')) : null), ...lignes));
    if (!p.ajoute) return b;
    return el('div', { class: 'dp-pc-wrap' }, b, el('button', { type: 'button', class: 'rm', 'data-f': `retirer-${p.mac}`, 'aria-label': mot('pc.retirer', { nom }), onclick: () => retirerAjoute(p.mac) }, ic('x', 16)));
  }
  function etapePostes() {
    const d = Z.postes.data || {}, vus = Array.isArray(d.postes) ? d.postes : [];
    const sec = el('section', { class: 'dp-card', 'aria-labelledby': 'dp-t2' },
      el('h4', { id: 'dp-t2' }, mot('postes.titre'), el('span', { class: 'dp-live' }, mot('postes.direct'))), el('p', { class: 'dp-lead' }, mot('postes.lead')));
    if (Z.postes.etat === 'pret') {
      sec.append(el('div', { class: 'dp-srv', 'data-f': 'serveur' }, ic('net', 18),
        el('span', { class: 'grow' }, mot('serveur.texte'), el('b', {}, mot(d.allume ? 'serveur.allume' : 'serveur.eteint'))),
        el('span', { class: `dp-tag${d.allume ? ' ok' : ''}` }, mot(`serveur.mode.${d.mode || 'proxy'}`)),
        el('button', { type: 'button', class: 'dp-btn', 'data-f': 'regler', onclick: () => { if (H && H.aller) H.aller('tout'); } }, mot('serveur.regler'))));
      if (!d.allume) sec.append(el('p', { class: 'dp-msg' }, mot('serveur.eteint.aide')));
    }
    const grille = el('div', { class: 'dp-pcs', role: 'group', 'aria-label': mot('postes.groupe'), 'data-f': 'pcs' });
    const ajoutes = pcsChoisis(Z).filter((p) => !vus.some((x) => x.mac === p.mac));
    for (const m of Z.ajoutes) if (!vus.some((p) => p.mac === m) && !ajoutes.some((p) => p.mac === m)) ajoutes.push({ mac: m, ajoute: true, auMenu: false, bloque: false, autorise: false });
    grille.append(...vus.map(cartePc), ...ajoutes.map(cartePc));
    if (Z.postes.etat === 'erreur') sec.append(el('p', { class: 'dp-msg ko', role: 'status' }, mot('postes.erreur', { raison: Z.postes.raison })));
    else if (Z.postes.etat !== 'pret') sec.append(el('p', { class: 'dp-msg', role: 'status' }, mot('postes.charge')));
    else if (!vus.length && !ajoutes.length) sec.append(el('p', { class: 'dp-msg', role: 'status' }, mot('postes.vide')));
    sec.append(grille);
    sec.append(el('div', { class: 'dp-row' }, el('button', { type: 'button', class: 'dp-chip', 'data-f': 'prochain', 'aria-pressed': String(Z.prochain), onclick: () => { Z.prochain = !Z.prochain; dessinerTout('prochain'); } }, ic('clock', 16), mot('prochain'))));
    const champ = el('input', { class: 'dp-in', id: 'dp-mac', type: 'text', placeholder: mot('mac.exemple'), autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', maxlength: '40', 'data-f': 'mac', 'aria-invalid': Z.macKo ? 'true' : null, 'aria-describedby': 'dp-mac-msg',
      oninput: (e) => { Z.mac = String(e.target.value || ''); },
      onkeydown: (e) => { if (e.key === 'Enter') { if (e.preventDefault) e.preventDefault(); ajouterMac(); } } });
    champ.value = Z.mac;
    sec.append(el('div', { class: 'dp-row' }, el('div', { class: 'dp-field', style: 'min-width:220px' }, el('label', { for: 'dp-mac' }, mot('mac.label')), champ),
      el('button', { type: 'button', class: 'dp-btn', 'data-f': 'mac-ajouter', onclick: () => ajouterMac() }, ic('plus'), mot('mac.ajouter'))),
    el('p', { class: `dp-msg${Z.macMsg ? (Z.macKo ? ' ko' : ' ok') : ''}`, id: 'dp-mac-msg', role: 'status', 'data-f': 'mac-msg' }, Z.macMsg));
    sec.append(el('div', { class: 'dp-h5', id: 'dp-comment' }, mot('comment.titre')),
      el('div', { class: 'dp-seg', role: 'group', 'aria-labelledby': 'dp-comment' }, ...['auto', 'menu'].map((k) => el('button', { type: 'button', 'data-facon': k, 'data-f': `comment-${k}`, 'aria-pressed': String(Z.facon === k), onclick: () => { Z.facon = k; dessinerTout(`comment-${k}`); } }, mot(`comment.${k}`)))));
    const choisis = pcsChoisis(Z), eff = aEffacer(Z), n = eff.pcs.length + (eff.prochain ? 1 : 0);
    if (n) {
      sec.append(el('div', { class: 'dp-guard', role: 'alert', 'data-f': 'garde' }, el('span', { class: 'gi' }, ic('warn', 24)),
        el('div', {}, el('b', {}, pluriel(n, 'garde.titre', { n: nombre(n) })),
          el('ul', { 'data-f': 'garde-liste' }, ...eff.pcs.map((p) => el('li', { 'data-efface': p.mac }, el('strong', {}, nomPc(p)), ` (${p.mac})`)), eff.prochain ? el('li', { 'data-efface': 'prochain' }, mot('garde.prochain')) : null),
          el('ul', {}, el('li', {}, mot('garde.p1')), el('li', {}, mot('garde.p2')), el('li', {}, mot('garde.p3'))))));
    } else if (Z.facon === 'menu' && (choisis.length || Z.prochain)) {
      sec.append(el('div', { class: 'dp-guard calm', 'data-f': 'garde-calme' }, el('span', { class: 'gi' }, ic('shield', 24)), el('div', {}, el('b', {}, mot('garde.menu.titre')), el('p', {}, mot('garde.menu.texte')))));
    }
    const aide = choisis.length ? pluriel(choisis.length, 'pied.choisis', { n: nombre(choisis.length) }) + (Z.prochain ? mot('pied.prochain') : '') : Z.prochain ? mot('pied.prochain.seul') : mot('pied.aucun');
    return [sec, pied(1, 3, !etapeOuverte(3, Z), aide)];
  }

  function etapeMachine() {
    const sec = el('section', { class: 'dp-card', 'aria-labelledby': 'dp-t2' }, el('h4', { id: 'dp-t2' }, mot('vm.titre')), el('p', { class: 'dp-lead' }, mot('vm.lead')));
    if (Z.vmDispo !== true) {
      sec.append(el('p', { class: 'dp-msg', role: 'status', 'data-f': 'vm-sans' }, Z.vmDispo === false ? mot('vm.sans') : mot('vm.charge')));
      return [sec, pied(1, 3, true, '')];
    }
    const ok = nomVmValide(Z.vm.nom);
    const nom = el('input', { class: 'dp-in', id: 'dp-vm-nom', type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '40', 'data-f': 'vm-nom', 'aria-invalid': ok ? null : 'true', 'aria-describedby': 'dp-vm-aide',
      oninput: (e) => { Z.vm = { ...Z.vm, nom: String(e.target.value || '') }; const b = Z.wrap && Z.wrap.querySelector('[data-f="continuer"]'); const v = nomVmValide(Z.vm.nom); if (b) b.disabled = !v; if (e.target.setAttribute) { if (v) e.target.removeAttribute('aria-invalid'); else e.target.setAttribute('aria-invalid', 'true'); } } });
    nom.value = Z.vm.nom;
    const seg = (k, vals, unite) => el('div', { class: 'dp-field' }, el('span', { class: 'lb', id: `dp-l-${k}` }, mot(`vm.${k}`)),
      el('div', { class: 'dp-seg', role: 'group', 'aria-labelledby': `dp-l-${k}` }, ...vals.map((v) => el('button', { type: 'button', 'data-f': `vm-${k}-${v}`, 'aria-pressed': String(Z.vm[k] === v), onclick: () => { Z.vm = { ...Z.vm, [k]: v }; dessinerTout(`vm-${k}-${v}`); } }, unite ? mot('u.go', { n: nombre(v) }) : nombre(v)))));
    sec.append(el('div', { class: 'dp-vm deux' },
      el('div', { class: 'dp-field' }, el('label', { for: 'dp-vm-nom' }, mot('vm.nom')), nom, el('small', { class: 'dp-msg', id: 'dp-vm-aide' }, mot('vm.nom.aide'))),
      el('div', { class: 'dp-field' }, el('span', { class: 'lb', id: 'dp-l-ou' }, mot('vm.ou')), el('div', { class: 'dp-seg', role: 'group', 'aria-labelledby': 'dp-l-ou' },
        el('button', { type: 'button', 'data-f': 'vm-ce', 'aria-pressed': 'true' }, mot('vm.ce')),
        el('button', { type: 'button', 'data-f': 'vm-srv', 'aria-pressed': 'false', disabled: true }, mot('vm.srv'), el('small', {}, mot('vm.bientot')))))),
    el('div', { class: 'dp-vm' }, seg('cpu', CPUS, false), seg('mem', MEMS, true), seg('disk', DISKS, true)),
    el('div', { class: 'dp-guard calm', 'data-f': 'garde-calme' }, el('span', { class: 'gi' }, ic('shield', 24)), el('div', {}, el('b', {}, mot('vm.garde.titre')), el('p', {}, mot('vm.garde.texte', { n: mot('u.go', { n: nombre(Z.vm.disk) }) })))));
    return [sec, pied(1, 3, !ok, '')];
  }

  function etapeSysteme() {
    const L = W.OdinGeneseSystemes && W.OdinGeneseSystemes.logique;
    const sec = el('section', { class: 'dp-card', 'aria-labelledby': 'dp-t3' }, el('h4', { id: 'dp-t3' }, mot('sys.titre')), el('p', { class: 'dp-lead' }, mot('sys.lead') + (Z.cible === 'reseau' ? mot('sys.lead.reseau') : '')));
    const filtres = FILTRES.map((f) => el('button', { type: 'button', class: 'dp-chip', 'data-filtre': f, 'aria-pressed': String(Z.filtre === f), onclick: () => { Z.filtre = f; dessinerTout(`filtre-${f}`); }, 'data-f': `filtre-${f}` }, mot(`f.${f}`)));
    sec.append(el('div', { class: 'dp-tools' }, el('div', { class: 'dp-chips', role: 'group', 'aria-label': mot('sys.filtres') }, ...filtres), el('span', { class: 'grow' }),
      el('button', { type: 'button', class: 'dp-btn', 'data-f': 'sys-ajouter', onclick: () => { if (H && H.aller) H.aller('systemes'); } }, ic('plus'), mot('sys.ajouter'))));
    if (Z.systemes.etat !== 'pret') { sec.append(el('p', { class: 'dp-msg', role: 'status' }, Z.systemes.etat === 'erreur' ? mot('sys.erreur', { raison: Z.systemes.raison }) : mot('sys.charge'))); return [sec, pied(2, 4, true, mot('pied.sys'))]; }
    const toutes = Z.systemes.data.cartes;
    const l = toutes.filter((c) => Z.filtre === 'tout' || c.famille === Z.filtre);
    const ids = l.filter((c) => choisissable(c, Z.cible)).map((c) => c.id);
    const grille = el('div', { class: 'dp-libs', role: 'radiogroup', 'aria-label': mot('sys.groupe'), 'data-f': 'systemes' });
    const choisir = (id) => { if (choisirSysteme(id)) dessinerTout(`sys-${id}`); };
    l.forEach((c) => {
      const ok = choisissable(c, Z.cible), on = ok && Z.sys === c.id, i = ids.indexOf(c.id);
      const tags = [];
      if (c.etat === 'telechargement') tags.push(el('span', { class: 'dp-tag' }, c.telechargement && c.telechargement.pct != null ? mot('sys.dl', { pct: `${nombre(c.telechargement.pct)} %` }) : mot('sys.dl.sans')));
      else if (c.etat === 'verification') tags.push(el('span', { class: 'dp-tag' }, mot('sys.verif')));
      else if (c.etat === 'empreinte_fausse') tags.push(el('span', { class: 'dp-tag bad' }, mot('sys.faux')));
      else if (c.etat === 'bloque') tags.push(el('span', { class: 'dp-tag bad' }, mot('sys.bloque')));
      else if (!c.deployable) tags.push(el('span', { class: 'dp-tag' }, mot('sys.inconnu')));
      else if (Z.cible === 'vm' && c.famille === 'outil') tags.push(el('span', { class: 'dp-tag' }, mot('sys.pasvm')));
      else tags.push(el('span', { class: `dp-tag${c.installe ? ' ok' : ''}` }, mot(c.installe ? 'sys.installe' : 'sys.demarre')));
      if (c.maj && c.maj.version) tags.push(el('span', { class: 'dp-tag warn' }, mot('sys.maj', { version: c.maj.version })));
      const couleur = L && typeof L.couleur === 'function' ? L.couleur(c) : '#4b5bc6';
      const taille = c.taille && L && typeof L.taille === 'function' ? ` · ${L.taille(c.taille)}` : '';
      const nm = nomSys(c);
      grille.append(el('button', {
        type: 'button', class: 'dp-sys', role: 'radio', 'aria-checked': String(on), disabled: !ok, 'data-sys': c.id, 'data-f': `sys-${c.id}`,
        tabindex: ok && (on || (!ids.includes(Z.sys) && i === 0)) ? '0' : '-1',
        onclick: () => choisir(c.id),
        onkeydown: (e) => { const j = suivant(i, ids.length, e.key); if (j < 0 || i < 0) return; if (e.preventDefault) e.preventDefault(); choisir(ids[j]); },
      }, el('span', { class: 'top' }, el('span', { class: 'lt', style: `background:${couleur}`, 'aria-hidden': 'true' }, String(c.nom || '?').charAt(0).toUpperCase()),
        el('span', {}, el('b', {}, nm), el('small', {}, mot(`fam.${c.famille}`) + taille)),
        on ? el('span', { class: 'tk', 'aria-hidden': 'true' }, ic('check', 14, 3)) : null),
      el('span', { class: 'st' }, ...tags)));
    });
    if (!toutes.some((c) => c.deployable)) sec.append(el('p', { class: 'dp-msg' }, mot('sys.vide')));
    else if (!l.length) sec.append(el('p', { class: 'dp-msg' }, mot('sys.vide.filtre')));
    sec.append(grille);
    const c = carteChoisie(Z);
    return [sec, pied(2, 4, !etapeOuverte(4, Z), c ? nomSys(c) : mot('pied.sys'))];
  }

  function mascotte() { const f = W.OdinGeneseCleEtapes && W.OdinGeneseCleEtapes.mascotte; try { if (typeof f === 'function') { const m = f(); if (m && m.classList) m.classList.add('dp-odin'); return m; } } catch { /* le rond */ } return el('span', { class: 'dp-odin', 'aria-hidden': 'true' }); }
  function etapeBientot(n) {
    const c = carteChoisie(Z), recap = [];
    if (Z.cible === 'reseau') {
      const l = pcsChoisis(Z).map(nomPc);
      if (Z.prochain) l.push(mot('garde.prochain'));
      recap.push(mot('recap.cible.reseau', { pcs: l.join(', ') }), mot(`recap.facon.${Z.facon}`));
    } else recap.push(mot('recap.cible.vm', { nom: Z.vm.nom, cpu: nombre(Z.vm.cpu), mem: mot('u.go', { n: nombre(Z.vm.mem) }), disk: mot('u.go', { n: nombre(Z.vm.disk) }) }));
    if (c) recap.push(mot('recap.sys', { sys: nomSys(c) }));
    const sec = el('section', { class: 'dp-card dp-soon', 'data-f': `bientot-${n}` }, mascotte(),
      el('div', {}, el('b', {}, mot('bientot.titre')), el('p', {}, mot(`bientot.${n}`)), el('p', { class: 'dp-msg' }, mot('recap.titre')), el('ul', { 'data-f': 'recap' }, ...recap.map((t) => el('li', {}, t)))));
    const avant = n === 6 && !etapeOuverte(5, Z) ? 4 : n - 1;
    const apres = n === 4 ? (etapeOuverte(5, Z) ? 5 : 6) : n === 5 ? 6 : 0;
    return [sec, pied(avant, apres, apres ? !etapeOuverte(apres, Z) : true, '')];
  }

  function panneau() {
    if (Z.etape > 1 && !etapeOuverte(Z.etape, Z)) Z.etape = [3, 2, 1].find((k) => k < Z.etape && etapeOuverte(k, Z)) || 1;
    if (Z.etape === 1) return etapeVersQuoi();
    if (Z.etape === 2) return Z.cible === 'vm' ? etapeMachine() : etapePostes();
    if (Z.etape === 3) return etapeSysteme();
    return etapeBientot(Z.etape);
  }
  function focaliser(f) {
    if (!f || !Z.wrap) return;
    const n = Array.from(Z.wrap.querySelectorAll('[data-f]')).find((x) => x.getAttribute('data-f') === f);
    if (n && typeof n.focus === 'function') n.focus();
  }
  function dessinerTout(focus) {
    const w = Z.wrap; if (!w) return;
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    const actif = focus || (a && w.contains && w.contains(a) && a.getAttribute ? a.getAttribute('data-f') : null);
    const sel = a && a.tagName === 'INPUT' && actif && !focus && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
    w.replaceChildren(barre(), ...panneau());
    if (actif) focaliser(actif);
    const b = sel && document.activeElement;
    if (b && b.tagName === 'INPUT' && typeof b.setSelectionRange === 'function') { try { b.setSelectionRange(sel[0], sel[1]); } catch { /* rien */ } }
    armer();
  }

  // En direct : à l'étape « Postes », les PC sont relus toutes les 3 s, seulement quand la page est visible ; un seul
  // minuteur ; il s'arrête dès que l'étape ou l'onglet est quitté. La page n'est redessinée que si la liste a changé.
  let minuteur = 0, tour = 0;
  const visible = () => { const w = Z.wrap; if (!w || !w.isConnected) return false; for (let x = w; x; x = x.parentNode) if (x.hidden) return false; return true; };
  function armer() {
    if (minuteur) clearTimeout(minuteur);
    minuteur = 0;
    // Chaque armement a son numéro : une relecture en vol, finie après un nouvel armement (un clic a redessiné), ne
    // relance rien ; sinon les minuteurs se multiplieraient.
    const moi = Z.wrap, ce = ++tour;
    if (!(Z.etape === 2 && Z.cible === 'reseau')) return;
    const tic = async () => {
      if (ce !== tour) return;
      minuteur = 0;
      if (Z.wrap !== moi || !visible() || !(Z.etape === 2 && Z.cible === 'reseau')) return;
      if (typeof document !== 'undefined' && document.hidden) { minuteur = setTimeout(tic, 3000); return; }
      const change = await lirePostes();
      if (ce !== tour || Z.wrap !== moi) return;
      if (change) dessinerTout(); else minuteur = setTimeout(tic, 3000);
    };
    minuteur = setTimeout(tic, 3000);
  }

  /** Monte l'onglet dans root. hote : { post, aller(onglet) } (la page de Genèse). */
  async function dessiner(root, _onglet, hote) {
    if (typeof document !== 'undefined' && document.head && !(document.getElementById && document.getElementById('dpCss'))) document.head.append(el('style', { id: 'dpCss' }, CSS));
    const post = (hote && hote.post) || ((a, i) => postModule('thjalfi', a, i));
    const wrap = el('div', { class: 'dp', 'data-f': 'deployer' });
    root.append(wrap);
    Z.wrap = wrap;
    H = { post, aller: hote && hote.aller };
    dessinerTout();
    // Les lectures : les PC (et si Hydre peut créer une machine), la bibliothèque, les profils pour la clé.
    await Promise.all([lirePostes(), lireSystemes(), Z.cible === 'cle' && Z.profils.etat === 'rien' ? lireProfils() : null]);
    if (Z.wrap === wrap) dessinerTout();
  }

  W.OdinGeneseDeployer = {
    onglets: [['deployer', MOTS.onglet]], dessiner, MOTS, logique, etat: Z,
    /** Depuis une carte de l'onglet Systèmes : ce système déjà choisi, on recommence à « Vers quoi ». */
    choisirSysteme: (carte) => { if (!carte || !carte.id || !carte.deployable || !choisirSysteme(carte.id, carte)) return false; Z.etape = 1; return true; },
  };
})();
