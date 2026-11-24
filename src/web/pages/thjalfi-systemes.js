// Genèse · onglet « Systèmes » (maquette validée « Genèse · Systèmes », lot S1) : la bibliothèque des systèmes
// téléchargés, la même que pour la clé USB, le démarrage par le réseau et les machines virtuelles.
//   - quatre chiffres : prêts à déployer, en cours (téléchargement, vérification), place du dossier des ISO, mises à jour ;
//   - filtres (Tout, Windows, Linux, Outils, Serveurs) et recherche ;
//   - une carte par système, avec son état VRAI (action en lecture « systemes » de Genèse, qui réunit la bibliothèque
//     d'Hydre et les téléchargements d'Andromède) : empreinte et antivirus, téléchargement avec sa progression,
//     vérification en cours, empreinte fausse (fichier jeté), mise à jour disponible ;
//   - « Déployer » : sur une clé USB (ouvre l'onglet « Clé USB », ce système déjà choisi pour l'étape 3) ; par le réseau
//     et en machine virtuelle arrivent plus tard (montrés « bientôt », jamais inventés).
// Ce que l'appli sait déjà faire reste joignable : « Détail » (la fiche d'Hydre), « Arrêter » un téléchargement,
// « Mettre à jour » et « Retélécharger » (Andromède), « Ajouter un système » (Andromède).
// Pas de fin de support : la bibliothèque ne la connaît pas encore (rien n'est inventé).
// Lot S3 : « Détail » ouvre la fiche du système dans l'onglet (la bibliothèque reste derrière, cachée, et revient telle
// quelle) : fichier, architecture, démarrage UEFI, installation toute seule, empreinte, antivirus, arrivée, vérification,
// surveillance ; « Où il sert » (iso_usages d'Hydre : clés ODIN, menu PXE, PC autorisés, déploiements, machines
// virtuelles) ; « Versions gardées » ; « Retirer » : un garde-fou dans la page qui nomme chaque usage, refuse tant qu'un
// déploiement ou une VM allumée s'en sert, et demande son nom tapé (revérifié par le serveur, réservé au propriétaire).
// Tous les textes sont dans MOTS ; tailles et nombres selon la langue de la page (Intl). TOUT passe par OdinDialog.
// Expose window.OdinGeneseSystemes = { onglets, dessiner(root, onglet, hote), MOTS, logique, etat }.
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    onglet: 'Systèmes',
    titre: 'Ma bibliothèque',
    lead: 'Les systèmes qu\'Odin a téléchargés : la même bibliothèque pour la clé USB, le démarrage par le réseau et les machines virtuelles.',
    'k.prets.one': 'système prêt à déployer', 'k.prets.other': 'systèmes prêts à déployer',
    'k.cours': 'en cours', 'k.cours.de': 'en cours · {nom} {pct}', 'k.cours.verif': 'en cours · {nom} en vérification',
    'k.place': 'sur {total} · dossier des ISO', 'k.place.seul': 'dossier des ISO',
    'k.majs.one': 'mise à jour disponible', 'k.majs.other': 'mises à jour disponibles',
    'f.groupe': 'Filtrer les systèmes', 'f.tout': 'Tout', 'f.windows': 'Windows', 'f.linux': 'Linux', 'f.outil': 'Outils', 'f.serveur': 'Serveurs',
    q: 'Chercher dans la bibliothèque…', 'q.nom': 'Chercher un système',
    ajouter: 'Ajouter un système',
    'fam.windows': 'Windows', 'fam.linux': 'Linux', 'fam.outil': 'Outil', 'fam.serveur': 'Serveur', 'fam.autre': 'Autre',
    'e.editeur': 'Empreinte vérifiée', 'e.calculee': 'Empreinte notée', 'e.changee': 'Empreinte changée',
    'e.editeur.aide': 'Identique à l\'empreinte publiée par l\'éditeur.', 'e.calculee.aide': 'L\'éditeur ne publie pas d\'empreinte : Odin a noté celle du fichier.', 'e.changee.aide': 'Le fichier ne correspond plus à son empreinte : retélécharge-le.',
    'a.propre': 'Antivirus : propre', 'a.a_verifier': 'Antivirus : à vérifier', 'a.bloque': 'Antivirus : bloqué',
    maj: '{version} disponible',
    'dl.ligne': '{pct} · {recu} sur {total}', 'dl.ligne.sans': '{recu} reçus', 'dl.vitesse': '{v}/s', 'dl.reste': 'reste {t}',
    'dl.nom': 'Téléchargement de {nom}',
    verif: 'Téléchargé · empreinte et antivirus en cours…',
    faux: 'Empreinte fausse : fichier jeté',
    'faux.texte': 'Le fichier reçu n\'est pas celui que l\'éditeur publie. Rien n\'a été gardé.',
    bloque: 'L\'antivirus l\'a bloqué : il n\'est jamais proposé.',
    deployer: 'Déployer', 'deployer.nom': 'Déployer {nom}',
    'deployer.vers': 'Vers quoi ?', 'deployer.cle': 'Sur une clé USB', 'deployer.cle.texte': 'Ouvre la clé USB avec ce système déjà choisi.',
    'deployer.reseau': 'Par le réseau', 'deployer.vm': 'En machine virtuelle', bientot: 'bientôt',
    'deployer.fermer': 'Fermer',
    'raison.verification': 'Déployable une fois l\'empreinte et l\'antivirus passés.',
    'raison.inconnu': 'Odin ne sait pas encore démarrer cette image.',
    'raison.bloque': 'Bloqué par l\'antivirus.',
    'raison.absent': 'Pas encore dans la bibliothèque.',
    detail: 'Détail', 'detail.nom': 'Détail de {nom}',
    'maj.bouton': 'Mettre à jour', 'maj.nom': 'Mettre à jour {nom}',
    'maj.confirme': 'Télécharger {nom} {version} depuis le site officiel ? L\'ancienne version ira dans « old ».',
    retel: 'Retélécharger', 'retel.confirme': 'Retélécharger {nom} depuis le site officiel ?',
    arreter: 'Arrêter', 'arreter.nom': 'Arrêter le téléchargement de {nom}',
    'arreter.confirme': 'Arrêter le téléchargement de {nom} ? Le fichier entamé reprendra au prochain téléchargement.',
    lance: 'C\'est parti : Andromède télécharge {nom}.',
    reponse: 'Andromède, pour {nom} : {texte}',
    'faux.detail': '{nom} : le fichier reçu ne correspondait pas à l\'empreinte publiée par l\'éditeur. Il a été jeté le {le}.{pourquoi}',
    charge: 'Lecture de la bibliothèque…',
    vide: 'Aucun système pour l\'instant. Ajoute-en un depuis Andromède : il apparaît ici une fois téléchargé et vérifié.',
    'vide.filtre': 'Aucun système ne correspond.',
    'pas.biblio': 'La bibliothèque d\'Hydre ne répond pas : les systèmes ne peuvent pas être lus pour l\'instant.',
    erreur: 'Les systèmes ne peuvent pas être lus : {raison}',
    annule: 'Annulé.',
    // ——— le catalogue (lot S2)
    store: 'Andromède', 'store.aide': 'Le Store complet d\'Andromède : tes propres sources, les index en ligne.',
    retour: 'Ma bibliothèque',
    'c.titre': 'Ajouter un système',
    'c.lead': 'Seulement depuis les sites officiels des éditeurs. Odin vérifie l\'empreinte publiée, passe le fichier à l\'antivirus, puis le range dans ta bibliothèque et le garde à jour.',
    'c.groupe': 'Famille', 'c.q': 'Chercher : ubuntu, windows, serveur…', 'c.q.nom': 'Chercher dans le catalogue',
    'c.arch': 'Architecture', 'c.arch.pc': 'PC (x86_64)', 'c.arch.arm': 'ARM 64', toutes: 'Toutes les versions',
    'g.windows': 'Windows', 'g.linux': 'Linux', 'g.serveur': 'Serveurs', 'g.outil': 'Outils de dépannage', 'g.autre': 'Autres', 'f.autre': 'Autres',
    'c.versions': 'Version de {nom}', 'c.canal.ancienne': 'ancienne', 'c.canal.LTS': 'LTS', 'c.canal.dernière': '',
    'c.pas.lue': 'Version : pas encore lue sur le site officiel.', 'c.voir.versions': 'Voir les versions', 'c.voir.toutes': 'Voir toutes les versions', 'c.voir.versions.nom': 'Lire les versions de {nom} sur le site officiel',
    'c.lecture': 'Lecture du site officiel…', 'c.lecture.ko': 'Le site officiel ne répond pas : {raison}',
    'c.dans': 'Dans ta bibliothèque', 'c.voir': 'Voir', 'c.voir.nom': 'Voir {nom} dans ta bibliothèque',
    'c.tel': 'Télécharger', 'c.tel.taille': 'Télécharger · {taille}', 'c.tel.nom': 'Télécharger {nom}', 'c.tel.derniere': 'Télécharger la dernière',
    'c.tel.confirme': 'Télécharger {nom} depuis le site officiel ?{taille} L\'empreinte publiée par l\'éditeur est vérifiée, puis l\'antivirus passe. Un seul téléchargement à la fois : il attend son tour si un autre est en cours.',
    'c.tel.confirme.taille': ' ({taille})',
    'c.cours': 'Téléchargement · {pct}', 'c.cours.sans': 'Téléchargement en cours', 'c.prepare': 'Préparation…',
    'c.file': 'En file · après {nom}', 'c.file.retirer': 'Retirer de la file', 'c.file.retirer.nom': 'Retirer {nom} de la file',
    'c.file.retirer.confirme': 'Retirer {nom} de la file de téléchargement ? Rien n\'est effacé.',
    'c.deposer': 'à déposer', 'c.page': 'Page officielle', 'c.page.nom': 'Page officielle de {nom} (nouvel onglet)', 'c.ou': 'Où le déposer ?', 'c.ou.nom': 'Où déposer le fichier de {nom}',
    'c.ou.texte': '{raison}\n\nTélécharge le fichier sur la page officielle, puis dépose-le dans ce dossier :\n{dossier}\n\nOdin le reconnaît, vérifie son empreinte et le passe à l\'antivirus avant de le ranger dans ta bibliothèque.',
    'c.ou.sans': 'le dossier des ISO d\'Andromède',
    'c.note': '« À déposer » : l\'éditeur demande un formulaire, un compte ou une licence. Odin ouvre sa page officielle et reconnaît le fichier quand tu le déposes. Il ne contourne rien.',
    'c.barre.one': '{n} dans la file de téléchargement · un à la fois', 'c.barre.other': '{n} dans la file de téléchargement · un à la fois',
    'c.barre.cours': '{nom} {version} se télécharge · {n} en attente', 'c.barre.cours.seul': '{nom} {version} se télécharge',
    'c.relire': 'Relire les versions', 'c.relire.cours': 'Odin relit les dernières versions sur les sites officiels…', 'c.relire.fait': 'Dernières versions relues sur les sites officiels.',
    'c.vide': 'Rien ne correspond.', 'c.charge': 'Lecture du catalogue…', 'c.erreur': 'Le catalogue ne peut pas être lu : {raison}',
    'c.reponse': '{texte}',
    'u.to': '{n} To', 'u.go': '{n} Go', 'u.mo': '{n} Mo', 'u.min': '{n} min', 'u.h': '{h} h {m}',
    // ——— la fiche, « où il sert », les versions gardées, retirer (lot S3)
    'd.charge': 'Lecture de la fiche…', 'd.erreur': 'La fiche ne peut pas être lue : {raison}',
    'd.f.fichier': 'Fichier', 'd.f.arch': 'Architecture', 'd.f.uefi': 'Démarrage UEFI', 'd.f.auto': 'S\'installe tout seul', 'd.f.empreinte': 'Empreinte', 'd.f.antivirus': 'Antivirus',
    'd.f.arrive': 'Arrivé', 'd.f.verifie': 'Dernière vérification', 'd.f.surveille': 'Gardé à jour', 'd.f.taille': 'Taille',
    'arch.x86_64': 'PC 64 bits (x86_64)', 'arch.arm64': 'ARM 64', 'arch.x86 (32 bits)': 'PC 32 bits',
    'uefi.oui': 'Oui', 'uefi.non': 'Pas trouvé (BIOS seulement)',
    'auto.oui': 'Oui : compte, langue, clavier, logiciels', 'auto.non': 'Non : il démarre seulement',
    'emp.editeur': '{court} · identique à l\'éditeur', 'emp.calculee': '{court} · notée par Odin (l\'éditeur n\'en publie pas)', 'emp.changee': '{court} · ne correspond plus : retélécharge-le', 'emp.aucune': 'Pas encore calculée',
    'av.sain': 'Propre · le {le}', 'av.a_verifier': 'À vérifier · le {le}', 'av.bloque': 'Bloqué', 'av.non': 'Pas encore analysé',
    'arr.andromede': 'Le {le} · site officiel de l\'éditeur{hote}', 'arr.autre': 'Le {le} · {origine}',
    'o.envoi': 'envoyé depuis le navigateur', 'o.lien': 'depuis un lien', 'o.dossier': 'copié depuis un dossier', 'o.partage': 'depuis un partage du réseau', 'o.déposée': 'déposé dans le dossier', 'o.hermes': 'Hermès', 'o.andromede': 'Andromède',
    'verif.ok': 'Le {le} · intact', 'verif.ko': 'Le {le} · abîmé', 'verif.jamais': 'Pas encore',
    'surv.oui': 'Oui : Andromède le surveille', 'surv.non': 'Non',
    'u.titre': 'Où il sert', 'u.lead': 'Retirer ce système, c\'est aussi pour eux.',
    'u.cle': 'Clé ODIN {nom}', 'u.cle.d': 'Copié dessus le {le}', 'u.cle.d.sans': 'Copié dessus',
    'u.menu': 'Menu du démarrage par le réseau', 'u.menu.d': 'Entrée {n}', 'u.menu.cache': 'Entrée cachée', 'u.menu.defaut': '{d}, système par défaut',
    'u.pc': 'PC {nom}', 'u.pc.d': 'Autorisé à démarrer ce système · {mac}', 'u.pc.auto': 'Installation automatique prévue · {mac}',
    'u.dep': 'Déploiement en cours', 'u.dep.d': 'Sur {n} PC : {pcs}',
    'u.vm': 'Machine virtuelle {nom}', 'u.vm.d': 'Installée depuis cette ISO (Hydre)', 'u.vm.allumee': 'Allumée avec cette ISO', 'u.vm.modele': 'Modèle fait depuis cette ISO (Hydre)',
    'u.bloque': 'empêche de retirer', 'u.voir': 'Voir', 'u.voir.nom': 'Voir : {nom}',
    'u.rien': 'Rien ne s\'en sert : ni clé ODIN, ni menu du démarrage par le réseau, ni PC autorisé, ni machine virtuelle.',
    'u.cles.pas.lu': 'Une clé ODIN où il a été copié garde sa copie (le journal des clés n\'est pas lisible d\'ici).',
    'u.pas.lu': 'Où il sert ne peut pas être lu : {raison}',
    'v.titre': 'Versions gardées', 'v.lead': 'L\'ancienne reste dans « old » : une seule.',
    'v.service': 'En service · {taille}', 'v.old': 'Dans « old » · {taille}', 'v.tag': 'en service', 'v.nouvelle': 'Disponible chez l\'éditeur',
    'v.tel': 'Télécharger', 'v.tel.nom': 'Télécharger {nom} {version}',
    'r.bouton': 'Retirer', 'r.bouton.nom': 'Retirer {nom} de la bibliothèque',
    'r.titre': 'Retirer {nom} de la bibliothèque ?', 'r.bloque.titre': 'Impossible de retirer {nom} pour l\'instant',
    'r.fichier': 'Le fichier ({taille}) est effacé du dossier des ISO, et rien d\'autre.',
    'r.apres.cle': 'La clé ODIN {nom} garde sa copie.', 'r.apres.cles': 'Une clé ODIN où il a été copié garde sa copie.',
    'r.apres.menu': 'Le menu du démarrage par le réseau perd cette entrée.', 'r.apres.menu.defaut': 'Le menu du démarrage par le réseau perd cette entrée ; par défaut, ce sera le disque du PC.',
    'r.apres.pc': '{nom} retombe sur le menu normal : rien ne s\'installe tout seul.', 'r.apres.vm': 'La machine virtuelle {nom} garde son disque.',
    'r.retel': 'Tu pourras le retélécharger depuis le catalogue.',
    'r.taper': 'Pour confirmer, tape son nom :', 'r.taper.nom': 'Tape « {nom} » pour confirmer',
    'r.ok': 'Retirer le fichier', 'r.garder': 'Garder', 'r.cours': 'Odin retire le fichier…', 'r.relire': 'Revérifier',
  };
  const mot = (k, v) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_m, x) => (v && v[x] != null ? String(v[x]) : ''));
  const langue = () => (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'fr';
  const pluriel = (n, base) => { let r = 'other'; try { r = new Intl.PluralRules(langue()).select(n); } catch { r = n > 1 ? 'other' : 'one'; } return mot(`${base}.${r === 'one' ? 'one' : 'other'}`); };
  const nombre = (n, d = 0, min = d) => { try { return new Intl.NumberFormat(langue(), { maximumFractionDigits: d, minimumFractionDigits: min }).format(n); } catch { return String(n); } };
  const GIO = 1024 ** 3;
  /** « 5,8 Go », « 1 To », « 640 Mo ». Pur. */
  const taille = (o) => { const n = Math.max(0, Number(o) || 0); if (n >= 1024 * GIO) return mot('u.to', { n: nombre(n / (1024 * GIO), n >= 10 * 1024 * GIO ? 0 : 1, 0) }); if (n >= GIO) return mot('u.go', { n: nombre(n / GIO, 1) }); return mot('u.mo', { n: nombre(Math.round(n / 1024 ** 2)) }); };
  const pct = (p) => { try { return new Intl.NumberFormat(langue(), { style: 'percent', maximumFractionDigits: 0 }).format(p / 100); } catch { return `${p} %`; } };
  const duree = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? mot('u.min', { n: nombre(m) }) : mot('u.h', { h: nombre(Math.floor(m / 60)), m: String(m % 60).padStart(2, '0') }); };

  // ---------------------------------------------------------------- la logique (pure)
  const FILTRES = ['tout', 'windows', 'linux', 'outil', 'serveur'];
  const COULEURS = [[/windows/, '#2f6fe0'], [/ubuntu/, '#e95420'], [/debian/, '#a80030'], [/fedora/, '#3c6eb4'], [/mint/, '#4f8f2f'], [/proxmox/, '#c25f00'], [/rocky/, '#0f7a55'], [/alma/, '#0f4266'], [/truenas/, '#0072a6'], [/arch/, '#1572a6'], [/alpine/, '#0d597f'], [/memtest/, '#6d3fd6'], [/clonezilla/, '#8a6d3b'], [/gparted/, '#5b6470'], [/kali/, '#2f62c9']];
  const couleur = (c) => (COULEURS.find(([re]) => re.test(String(c.nom).toLowerCase())) || [0, c.famille === 'outil' ? '#5b6470' : '#4b5bc6'])[1];
  const sansAccents = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  /** Le filtre et la recherche (sans accents ni majuscules, sur le nom, la version et le fichier). Pur. */
  function filtrer(cartes, filtre, q) {
    const t = sansAccents(q).trim();
    return (Array.isArray(cartes) ? cartes : []).filter((c) => (filtre === 'tout' || !FILTRES.includes(filtre) || c.famille === filtre) && (!t || sansAccents(`${c.nom} ${c.version ?? ''} ${c.fichier ?? ''}`).includes(t)));
  }
  /** La vitesse d'un téléchargement entre deux lectures (octets/s) et le temps restant. Pur. */
  function vitesse(avant, maintenant) {
    if (!avant || !maintenant || maintenant.t <= avant.t || maintenant.recu < avant.recu) return undefined;
    const v = (maintenant.recu - avant.recu) / ((maintenant.t - avant.t) / 1000);
    if (!(v > 0)) return undefined;
    return { v, ...(maintenant.total ? { resteMs: ((maintenant.total - maintenant.recu) / v) * 1000 } : {}) };
  }
  const nomComplet = (c) => (c.version ? `${c.nom} ${c.version}` : c.nom);

  // ——— le catalogue (lot S2) : les entrées du Store d'Andromède, rangées par famille, avec leurs versions
  const GROUPES = ['windows', 'linux', 'serveur', 'outil', 'autre'];
  const FILTRES_CAT = ['tout', 'windows', 'linux', 'outil', 'serveur', 'autre'];
  /** Les familles du catalogue, chacune avec ses cartes (filtre, recherche sans accents, architecture). Pur. */
  function groupesCatalogue(entrees, o) {
    const t = sansAccents(o && o.q).trim(), arm = o && o.arch === 'arm';
    const l = (Array.isArray(entrees) ? entrees : []).filter((e) => e && e.genre !== 'logiciel' && !e.enLigne)
      .filter((e) => (o.fil === 'tout' || !FILTRES_CAT.includes(o.fil) || (e.groupe || 'autre') === o.fil) && ((e.arch === 'arm64') === arm)
        && (!t || t.split(/\s+/).every((m) => sansAccents(`${e.nom} ${e.id} ${e.about} ${e.type} ${e.systeme}`).includes(m))));
    return GROUPES.map((g) => ({ groupe: g, cartes: l.filter((e) => (GROUPES.includes(e.groupe) ? e.groupe : 'autre') === g).sort((a, b) => String(a.nom).localeCompare(String(b.nom), langue())) })).filter((x) => x.cartes.length);
  }
  /** Les versions montrées sur une carte : celles lues sur le site officiel (sans « Toutes les versions » : celles par défaut),
   *  sinon la dernière vue. Toujours celle qui se télécharge ou attend son tour. Pur. */
  function versionsMontrees(e, toutes) {
    const l = Array.isArray(e.versions) && e.versions.length ? e.versions : e.version ? [{ version: e.version, canal: 'dernière', defaut: true, ...(e.taille ? { taille: e.taille } : {}) }] : [];
    const garde = new Set([...(e.enFile || []), ...(e.telecharge ? [e.telecharge] : [])]);
    return l.filter((v) => toutes || v.defaut || garde.has(v.version));
  }
  /** La version choisie sur une carte (ton choix s'il est encore montré, sinon la première). Pur. */
  function versionChoisie(e, choix, toutes) { const l = versionsMontrees(e, toutes); return (l.find((v) => v.version === choix) || l[0] || null); }
  /** Une version est-elle dans la bibliothèque ? (« 42 » au catalogue, « 42-1.1 » dans le dossier). Pur. */
  const presente = (e, v) => (e.presents || []).some((p) => p === v || String(p).startsWith(`${v}-`) || String(p).startsWith(`${v}.`));
  /** Ce que montre le bas d'une carte pour la version choisie. Pur. */
  function etatCarte(e, v, file) {
    if (e.manuel) return 'deposer';
    if (!v) return e.telecharge ? 'cours' : 'inconnue';
    if (e.telecharge === v.version) return 'cours';
    if ((e.enFile || []).includes(v.version)) return 'file';
    if (presente(e, v.version)) return 'biblio';
    return 'telecharger';
  }
  /** Qui passe avant cette version dans la file : celui juste avant elle, ou celui qui se télécharge. Pur. */
  function avantDansFile(f, source, version) {
    const l = (f && f.file) || [], k = l.findIndex((x) => x.source === source && x.version === version);
    if (k > 0) return `${l[k - 1].nom} ${l[k - 1].version}`;
    return f && f.enCours ? `${f.enCours.nom} ${f.enCours.version}` : '';
  }
  // ——— la fiche (lot S3)
  /** « 3f9a 51c0 … 8d2e c21e » : le début et la fin d'une empreinte SHA-256. Pur. */
  const empreinteCourte = (h) => { const t = String(h || '').toLowerCase(); return /^[0-9a-f]{16,}$/.test(t) ? `${t.slice(0, 4)} ${t.slice(4, 8)} … ${t.slice(-8, -4)} ${t.slice(-4)}` : ''; };
  /** Le nom tapé est-il le bon ? Même règle que le serveur (sans accents, majuscules ni espaces en trop). Pur. */
  const nomJuste = (tape, attendu) => { const n = (x) => sansAccents(x).replace(/\s+/g, ' ').trim(); return n(attendu) !== '' && n(tape) === n(attendu); };
  /** Ce que devient chaque usage si on retire le système : les lignes du garde-fou. Pur. */
  function phrasesRetrait(u) {
    const l = [];
    for (const x of (u && Array.isArray(u.usages) ? u.usages : [])) {
      if (x.genre === 'cle') l.push(mot('r.apres.cle', { nom: x.nom }));
      else if (x.genre === 'menu') l.push(mot(x.defaut ? 'r.apres.menu.defaut' : 'r.apres.menu'));
      else if (x.genre === 'pc') l.push(mot('r.apres.pc', { nom: x.nom }));
      else if (x.genre === 'vm' && !x.bloque) l.push(mot('r.apres.vm', { nom: x.nom }));
    }
    if (u && u.lu && u.lu.cles === false) l.push(mot('r.apres.cles'));
    return l;
  }
  const logique = { MOTS, mot, FILTRES, filtrer, vitesse, taille, nomComplet, couleur, groupesCatalogue, versionsMontrees, versionChoisie, etatCarte, avantDansFile, presente, empreinteCourte, nomJuste, phrasesRetrait };

  // ---------------------------------------------------------------- l'état (gardé quand on change d'onglet)
  const Z = { filtre: 'tout', q: '', data: null, erreur: '', vers: '', debits: {}, msg: '', vue: 'biblio',
    cat: { fil: 'tout', q: '', arch: 'x86_64', toutes: false, choix: {}, data: null, file: null, erreur: '', lecture: {}, msg: '', msgNeuf: false } };

  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  };
  const P = {
    check: 'M5 12l5 5L20 7', warn: 'M12 3 2 20h20zM12 10v4M12 17h.01', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z', x: 'M6 6l12 12M18 6 6 18',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7', plus: 'M12 5v14M5 12h14', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    usb: 'M9 2h6v6H9zM7 8h10v9a5 5 0 0 1-10 0z', left: 'M15 18l-6-6 6-6', download: 'M12 4v11M7 10l5 5 5-5M5 20h14', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
    ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5', file: 'M6 2h8l5 5v15H6zM14 2v5h5', net: 'M12 3v6M5 21v-4h14v4M12 9v8M4 9h16', vm: 'M3 4h18v12H3zM8 20h8M12 16v4',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', pc: 'M4 5h16v11H4zM2 20h20', menu: 'M4 6h16M4 12h16M4 18h10',
  };
  const ic = (n, s = 16, w = 2) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };

  const CSS = `
.sy{display:flex;flex-direction:column;gap:14px;min-width:0}
.sy-k{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}@media (max-width:900px){.sy-k{grid-template-columns:repeat(2,minmax(0,1fr))}}
.sy-k>div{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px 16px;min-width:0;box-shadow:var(--shadow,none)}
.sy-k b{display:block;font-size:22px;letter-spacing:-.3px;line-height:1.2}.sy-k span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}
.sy-k .ok b{color:var(--good,#1f9d55)}.sy-k .maj b{color:var(--warn,#b45309)}
.sy-bar{height:6px;border-radius:4px;background:color-mix(in srgb,var(--ink) 10%,transparent);overflow:hidden;margin-top:10px}.sy-bar i{display:block;height:100%;border-radius:4px;background:var(--accent,#0b7f7c)}
.sy-bar.raye i{background:repeating-linear-gradient(-45deg,var(--accent,#0b7f7c) 0 8px,color-mix(in srgb,var(--accent,#0b7f7c) 55%,transparent) 8px 16px)}
.sy-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow,none);padding:18px;min-width:0}
.sy-card>h4{margin:0 0 4px;font-size:17px;letter-spacing:-.01em}.sy-lead{margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.45}
.sy-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.sy-chips{display:flex;gap:6px;flex-wrap:wrap}@media (max-width:600px){.sy-chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;max-width:100%;padding:2px;margin:-2px}.sy-chips::-webkit-scrollbar{display:none}.sy-chips button{flex:none}}
.sy-chip{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel);font:600 13px inherit;color:var(--muted);cursor:pointer}
.sy-chip[aria-pressed=true]{background:color-mix(in srgb,var(--accent,#0b7f7c) 14%,var(--panel));color:var(--ink);border-color:var(--accent,#0b7f7c)}
.sy-q{flex:1;min-width:200px;min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--field,var(--panel));color:var(--ink);padding:0 14px;font:inherit;font-size:14px}
@media (max-width:600px){.sy-q{flex-basis:100%;min-width:0}}
.sy-btn{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13.5px inherit;display:inline-flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;white-space:nowrap}
.sy-btn svg{flex:none}.sy-btn.pri{background:var(--accent,#0b7f7c);color:var(--on-accent,#fff);border-color:transparent}.sy-btn:disabled{opacity:.5;cursor:not-allowed}
.sy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr));gap:12px}
.sy-sys{border:1.5px solid var(--line);background:var(--panel);border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:10px;min-width:0}
.sy-sys .top{display:flex;gap:10px;align-items:center;min-width:0}
.sy-mono{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:17px;flex:none;position:relative;overflow:hidden}
.sy-mono::after{content:"";position:absolute;inset:auto -30% -50% auto;width:70%;height:70%;border-radius:50%;background:rgba(255,255,255,.22)}
.sy-sys .nm{min-width:0;flex:1}.sy-sys .nm b{display:block;font-size:14.5px;overflow-wrap:anywhere}.sy-sys .nm small{color:var(--muted);font-size:12px}
.sy-st{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--muted)}.sy-st b{color:var(--ink)}
.sy-tag{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:999px;background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink)}
.sy-tag.ok{background:color-mix(in srgb,var(--good,#1f9d55) 16%,transparent);color:color-mix(in srgb,var(--good,#1f9d55) 80%,var(--ink))}
.sy-tag.warn{background:color-mix(in srgb,var(--warn,#d97706) 18%,transparent);color:color-mix(in srgb,var(--warn,#d97706) 70%,var(--ink))}
.sy-tag.bad{background:color-mix(in srgb,var(--bad,#e5484d) 14%,transparent);color:color-mix(in srgb,var(--bad,#e5484d) 80%,var(--ink))}
.sy-about{margin:0;font-size:12.5px;color:var(--muted);line-height:1.4}
.sy-acts{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px;margin-top:auto}
.sy-vers{display:flex;flex-direction:column;gap:6px;border:1px dashed var(--line);border-radius:12px;padding:8px}
.sy-vers>b{font-size:12.5px;color:var(--muted)}.sy-vers .sy-btn{justify-content:flex-start}
.sy-vers .sy-btn small{margin-left:auto;font-weight:600;color:var(--muted)}
.sy-msg{margin:0;font-size:13px;color:var(--muted)}
.sy-back{align-self:flex-start}
a.sy-btn{text-decoration:none}
.sy-sel{min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--field,var(--panel));color:var(--ink);padding:0 12px;font:inherit;font-size:14px}
.sy-sw{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 4px;border:0;background:transparent;color:var(--ink);font:600 13px inherit;cursor:pointer}
.sy-sw i{width:44px;height:26px;border-radius:999px;background:color-mix(in srgb,var(--ink) 18%,transparent);position:relative;flex:none;transition:background .15s}
.sy-sw i::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--panel);box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .15s}
.sy-sw[aria-checked=true] i{background:var(--good,#1f9d55)}.sy-sw[aria-checked=true] i::after{left:21px}
.sy-grp{display:flex;align-items:center;gap:8px;margin:16px 0 8px;font-size:12.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.sy-grp .n{font-size:11.5px;letter-spacing:0;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink)}
.sy-pills{display:flex;gap:6px;flex-wrap:wrap}
.sy-pill{min-height:44px;padding:0 12px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13px inherit;cursor:pointer}
.sy-pill span{font-weight:500;color:var(--muted)}
.sy-pill[aria-pressed=true]{border-color:var(--accent,#0b7f7c);background:color-mix(in srgb,var(--accent,#0b7f7c) 14%,var(--panel))}
.sy-tag.acc{background:color-mix(in srgb,var(--accent,#0b7f7c) 16%,transparent);color:color-mix(in srgb,var(--accent,#0b7f7c) 75%,var(--ink))}
.sy-catacts{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:auto}.sy-catacts .sy-btn{flex:1 1 140px}
.sy-pend{display:flex;margin-bottom:6px;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 12px 10px 16px;border-radius:16px;border:1px solid var(--accent,#0b7f7c);background:color-mix(in srgb,var(--accent,#0b7f7c) 10%,var(--panel));box-shadow:var(--shadow,0 6px 20px rgba(0,0,0,.12))}
.sy-pend b{font-size:13.5px;overflow-wrap:anywhere}
.sy-hero{display:flex;gap:14px;align-items:center;min-width:0}.sy-hero>div{min-width:0}
.sy-hero h4{margin:0;font-size:22px;letter-spacing:-.3px;overflow-wrap:anywhere}.sy-hero small{display:block;color:var(--muted);font-size:13px;margin-top:2px}
.sy-hero .sy-mono{width:56px;height:56px;font-size:22px;border-radius:16px}
.sy-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.sy-btn.rouge{color:color-mix(in srgb,var(--bad,#e5484d) 80%,var(--ink))}
.sy-btn.dng{background:color-mix(in srgb,var(--bad,#d93636) 60%,#000);color:#fff;border-color:transparent}
.sy-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:0 18px;margin:16px 0 0}
.sy-facts>div{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:10px 0;border-top:1px solid var(--line);min-width:0}
.sy-facts dt{color:var(--muted);font-size:13px;flex:none;max-width:42%}.sy-facts dd{margin:0;font-weight:600;font-size:13px;text-align:right;overflow-wrap:anywhere;min-width:0}
.sy-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.sy-rgrid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:14px;align-items:start}@media (max-width:900px){.sy-rgrid{grid-template-columns:minmax(0,1fr)}}
.sy-used{display:flex;flex-direction:column;gap:8px}
.sy-entry{display:flex;gap:12px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:10px 12px;min-width:0;background:var(--panel)}
.sy-entry .ic{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;flex:none;background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--accent,#0b7f7c)}
.sy-entry .sy-mono{width:40px;height:40px;font-size:15px}
.sy-entry .nm{flex:1;min-width:0}.sy-entry .nm b{display:block;font-size:14px;overflow-wrap:anywhere}.sy-entry .nm small{display:block;color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}
.sy-entry.bloque{border-color:color-mix(in srgb,var(--bad,#e5484d) 60%,var(--line))}
.sy-entry.def{border-color:var(--accent,#0b7f7c)}.sy-entry.neu{border-style:dashed;border-color:color-mix(in srgb,var(--good,#1f9d55) 60%,var(--line))}
.sy-entry .sy-btn{flex:none}
.sy-guard{margin-top:14px;border:1.5px solid var(--bad,#e5484d);background:color-mix(in srgb,var(--bad,#e5484d) 9%,var(--panel));border-radius:16px;padding:14px 16px;display:flex;gap:14px;min-width:0}
.sy-guard .gi{width:40px;height:40px;border-radius:12px;background:color-mix(in srgb,var(--bad,#d93636) 60%,#000);color:#fff;display:grid;place-items:center;flex:none}
.sy-guard>div{min-width:0;flex:1}.sy-guard .t{display:block;font-size:15px;margin:0 0 6px;overflow-wrap:anywhere}
.sy-guard ul{margin:0 0 12px;padding-left:18px;font-size:13.5px;line-height:1.55}.sy-guard li{overflow-wrap:anywhere}
.sy-guard label{display:block;font-size:13px;margin-bottom:6px}.sy-guard label b{overflow-wrap:anywhere}
.sy-guard .sy-q{width:100%;box-sizing:border-box;margin-bottom:10px}
.sy-guard .err{margin:0 0 10px;font-size:13px;font-weight:600;color:color-mix(in srgb,var(--bad,#e5484d) 80%,var(--ink))}
@media (max-width:600px){.sy-guard{flex-direction:column}.sy-hero h4{font-size:19px}.sy-hero .sy-mono{width:48px;height:48px}.sy-entry{flex-wrap:wrap}.sy-entry .sy-btn{margin-left:52px}}
@media (prefers-reduced-motion:reduce){.sy-sw i,.sy-sw i::after{transition:none}}
@media (prefers-reduced-motion:no-preference){.sy-bar.raye i{animation:syRaye 1s linear infinite;background-size:22.6px 22.6px}}
@keyframes syRaye{to{background-position:22.6px 0}}
`;

  // ---------------------------------------------------------------- les demandes
  const postModule = async (module, action, input = {}, confirm = false) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module, action, input, confirm }) })).json();
  const dire = async (t) => { if (t && W.OdinDialog) await W.OdinDialog.alert(t); };

  /** Déployer sur une clé USB : ce système choisi pour l'étape 3 (par la même porte que le clic sur sa carte), puis l'onglet « Clé USB ». */
  function deployerSurCle(c, hote) {
    const SYS = W.OdinGeneseCleSystemes, ET = W.OdinGeneseCleEtapes;
    if (SYS && SYS.etat && c.iso) {
      const E = SYS.etat, L = SYS.logique || {}, id = `iso:${c.iso}`, deja = (E.choisis || {})[id];
      // La bibliothèque de la clé (lue une fois) ne connaît pas encore ce système (téléchargé depuis) : elle sera relue.
      const liste = E.biblio && Array.isArray(E.biblio.liste) && typeof L.entrees === 'function' ? L.entrees(E.biblio.liste, [], false) : [];
      const e = liste.find((x) => x.id === id);
      if (!e && E.biblio && E.biblio.etat !== 'charge') E.biblio = { ...E.biblio, etat: 'rien' };
      // Déjà choisi (peut-être réglé à la main) : gardé tel quel. Sinon le choix de départ de la façon, comme un clic sur sa carte.
      if (!deja) E.choisis = { ...(E.choisis || {}), [id]: { choix: e && typeof L.defautPour === 'function' ? L.defautPour(E.facon, e) : 'iso', main: false } };
    }
    if (ET && ET.etat) {
      ET.etat.onglet = 'deployer';
      // Une clé déjà choisie : droit à l'étape 3. Sinon l'étape 1 (choisir la clé) ; le système attend à l'étape 3.
      if (ET.etat.cle) ET.etat.etape = 3;
    }
    Z.vers = '';
    if (hote && typeof hote.aller === 'function') hote.aller('cle');
  }

  // ---------------------------------------------------------------- dessins
  function chiffres(d) {
    const c = d.chiffres || {}, p = d.place || {};
    const prem = c.premier;
    const cours = prem ? (prem.pct != null ? mot('k.cours.de', { nom: prem.nom, pct: pct(prem.pct) }) : mot('k.cours.verif', { nom: prem.nom })) : mot('k.cours');
    const occ = p.total ? Math.min(100, (p.utilise / p.total) * 100) : 0;
    return el('div', { class: 'sy-k', 'data-f': 'chiffres' },
      el('div', { class: 'ok' }, el('b', { 'data-k': 'prets' }, nombre(c.prets || 0)), el('span', {}, pluriel(c.prets || 0, 'k.prets'))),
      el('div', {}, el('b', { 'data-k': 'cours' }, nombre(c.enCours || 0)), el('span', {}, cours), prem && prem.pct != null ? el('div', { class: 'sy-bar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(2, prem.pct)}%` })) : null),
      el('div', {}, el('b', { 'data-k': 'place' }, taille(p.utilise || 0)), el('span', {}, p.total ? mot('k.place', { total: taille(p.total) }) : mot('k.place.seul')), p.total ? el('div', { class: 'sy-bar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(1, occ)}%` })) : null),
      el('div', { class: c.majs ? 'maj' : '' }, el('b', { 'data-k': 'majs' }, nombre(c.majs || 0)), el('span', {}, pluriel(c.majs || 0, 'k.majs'))));
  }

  function etatLigne(c) {
    if (c.etat === 'telechargement') {
      const t = c.telechargement || {}, d = Z.debits[c.id];
      const parts = [t.total ? mot('dl.ligne', { pct: pct(t.pct ?? Math.floor((t.recu / t.total) * 100)), recu: taille(t.recu), total: taille(t.total) }) : mot('dl.ligne.sans', { recu: taille(t.recu) })];
      if (d) { parts.push(mot('dl.vitesse', { v: taille(d.v) })); if (d.resteMs != null) parts.push(mot('dl.reste', { t: duree(d.resteMs) })); }
      const p = t.pct ?? (t.total ? Math.floor((t.recu / t.total) * 100) : 0);
      return [el('div', { class: 'sy-bar', role: 'progressbar', 'aria-valuenow': String(p), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': mot('dl.nom', { nom: c.nom }) }, el('i', { style: `width:${Math.max(2, p)}%` })),
        el('div', { class: 'sy-st', 'data-f': 'progres' }, parts.join(' · '))];
    }
    if (c.etat === 'verification') return [el('div', { class: 'sy-bar raye', 'aria-hidden': 'true' }, el('i', { style: 'width:100%' })), el('div', { class: 'sy-st' }, mot('verif'))];
    if (c.etat === 'empreinte_fausse') return [el('div', { class: 'sy-st' }, el('span', { class: 'sy-tag bad' }, ic('warn', 12), mot('faux'))), el('p', { class: 'sy-about' }, mot('faux.texte'))];
    if (c.etat === 'bloque') return [el('div', { class: 'sy-st' }, el('span', { class: 'sy-tag bad' }, ic('warn', 12), mot('a.bloque'))), el('p', { class: 'sy-about' }, mot('bloque'))];
    const tags = [];
    if (c.empreinte) tags.push(el('span', { class: `sy-tag ${c.empreinte === 'editeur' ? 'ok' : c.empreinte === 'changee' ? 'bad' : ''}`, title: mot(`e.${c.empreinte}.aide`) }, c.empreinte === 'editeur' ? ic('check', 12, 3) : null, mot(`e.${c.empreinte}`)));
    if (c.antivirus && c.antivirus !== 'en_cours') tags.push(el('span', { class: `sy-tag ${c.antivirus === 'propre' ? 'ok' : c.antivirus === 'bloque' ? 'bad' : 'warn'}` }, mot(`a.${c.antivirus}`)));
    if (c.maj) tags.push(el('span', { class: 'sy-tag warn', 'data-f': 'maj' }, mot('maj', { version: c.maj.version })));
    return [el('div', { class: 'sy-st' }, ...tags)];
  }

  function actions(c, hote, redessiner) {
    const nom = nomComplet(c);
    const detail = el('button', { type: 'button', class: 'sy-btn', 'data-f': 'detail', 'aria-label': mot('detail.nom', { nom }), onclick: () => ouvrirDetail(c) }, mot('detail'));
    if (c.etat === 'telechargement') {
      return [el('button', { type: 'button', class: 'sy-btn', 'data-f': 'arreter', 'aria-label': mot('arreter.nom', { nom }), disabled: !c.source, onclick: async () => {
        if (!(await W.OdinDialog.confirm(mot('arreter.confirme', { nom }), { danger: true }))) return;
        const r = await postModule('eitri', 'annuler', { nom: c.source }); await dire(r.text); await redessiner();
      } }, ic('x', 15), mot('arreter'))];
    }
    if (c.etat === 'verification' || c.etat === 'bloque') return [detail];
    if (c.etat === 'empreinte_fausse') {
      return [c.source ? el('button', { type: 'button', class: 'sy-btn pri', 'data-f': 'retel', onclick: () => telecharger(c, mot('retel.confirme', { nom: c.nom }), redessiner) }, ic('refresh', 15), mot('retel')) : null, detail];
    }
    const dep = el('button', { type: 'button', class: 'sy-btn pri', 'data-f': 'deployer', 'aria-label': mot('deployer.nom', { nom }), 'aria-expanded': String(Z.vers === c.id), disabled: !c.deployable, title: c.deployable ? null : mot(`raison.${c.raison || 'absent'}`),
      onclick: () => {
        if (!c.deployable) return;
        // L'onglet « Déployer » (thjalfi-deployer.js) est là : il s'ouvre à « Vers quoi », ce système déjà choisi, pour les
        // trois cibles (clé, réseau, machine virtuelle). Sinon, « Vers quoi ? » ici, comme avant.
        const D = W.OdinGeneseDeployer;
        if (D && typeof D.choisirSysteme === 'function' && hote && typeof hote.aller === 'function' && D.choisirSysteme(c)) { Z.vers = ''; hote.aller('deployer'); return; }
        Z.vers = Z.vers === c.id ? '' : c.id; redessiner(false, { carte: c.id, f: Z.vers ? 'vers-cle' : 'deployer' });
      } }, ic('bolt', 15), mot('deployer'));
    const majB = c.maj ? el('button', { type: 'button', class: 'sy-btn', 'data-f': 'mettre-a-jour', 'aria-label': mot('maj.nom', { nom }), onclick: () => telecharger(c, mot('maj.confirme', { nom: c.nom, version: c.maj.version }), redessiner) }, ic('refresh', 15), mot('maj.bouton')) : null;
    return [dep, detail, majB];
  }

  /** « Vers quoi ? » : la clé USB maintenant ; le réseau et les machines virtuelles plus tard. */
  function vers(c, hote, redessiner) {
    // Échap ferme « Vers quoi ? » et rend la main au bouton « Déployer » de la carte.
    const fermer = (e) => { if (!e || e.key !== 'Escape') return; if (e.preventDefault) e.preventDefault(); Z.vers = ''; void redessiner(false, { carte: c.id, f: 'deployer' }); };
    return el('div', { class: 'sy-vers', 'data-vers': c.id, role: 'group', 'aria-label': mot('deployer.vers'), onkeydown: fermer },
      el('b', {}, mot('deployer.vers')),
      el('button', { type: 'button', class: 'sy-btn pri', 'data-f': 'vers-cle', title: mot('deployer.cle.texte'), onclick: () => deployerSurCle(c, hote) }, ic('usb', 15), mot('deployer.cle')),
      el('button', { type: 'button', class: 'sy-btn', 'data-f': 'vers-reseau', disabled: true }, ic('net', 15), mot('deployer.reseau'), el('small', {}, mot('bientot'))),
      el('button', { type: 'button', class: 'sy-btn', 'data-f': 'vers-vm', disabled: true }, ic('vm', 15), mot('deployer.vm'), el('small', {}, mot('bientot'))));
  }

  async function telecharger(c, question, redessiner) {
    if (!c.source || !(await W.OdinDialog.confirm(question))) return;
    // Le téléchargement dure : on ne l'attend pas, la carte le suit (relue toutes les 3 s). Mais une réponse rapide
    // (un passage déjà en cours, une source à télécharger à la main, déjà à jour, un refus) est dite telle quelle :
    // jamais « C'est parti » quand rien ne part.
    const envoi = postModule('eitri', 'telecharger', { nom: c.source }).catch((e) => ({ ok: false, text: String((e && e.message) || e) }));
    const vite = await Promise.race([envoi, new Promise((ok) => { setTimeout(() => ok(null), 1500); })]);
    Z.msg = vite ? mot('reponse', { nom: c.nom, texte: (vite && vite.text) || '?' }) : mot('lance', { nom: c.nom });
    await redessiner(true);
  }

  async function ouvrirDetail(c) {
    // Lot S3 : la fiche s'ouvre dans l'onglet (la bibliothèque est derrière). Un fichier jeté n'a pas de fiche.
    if (c.etat !== 'empreinte_fausse' && typeof Z.montrerDetail === 'function') { Z.montrerDetail(c); return; }
    if (c.etat === 'empreinte_fausse') {
      const le = c.le ? new Date(c.le).toLocaleString(langue(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
      await dire(mot('faux.detail', { nom: nomComplet(c), le, pourquoi: c.pourquoi ? `\n${c.pourquoi}` : '' })); return;
    }
    const r = await postModule('ymir', 'fiche_iso', { iso: c.fichier || c.nom }).catch((e) => ({ ok: false, text: String(e && e.message || e) }));
    if (W.OdinDialog) await W.OdinDialog.alert(r.text || '', { title: nomComplet(c) });
  }

  // ---------------------------------------------------------------- la fiche d'un système (lot S3)
  const lePlein = (t) => { try { return new Date(t).toLocaleDateString(langue(), { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };
  /** « Déployer » depuis la fiche : l'onglet Déployer s'il est là (ce système choisi), sinon la clé USB. */
  function deployerDepuisFiche(c, hote) {
    const D = W.OdinGeneseDeployer;
    if (D && typeof D.choisirSysteme === 'function' && hote && typeof hote.aller === 'function' && D.choisirSysteme(c)) { hote.aller('deployer'); return; }
    deployerSurCle(c, hote);
  }
  /**
   * La fiche d'un système, dans `zone`. Deux lectures (Hydre) : « où il sert » (iso_usages, propriétaire seul) et la fiche
   * (fiche_iso, avec les versions gardées). `o.retour(idCarte, relire)` rend la bibliothèque. Seul « Retirer le fichier »
   * écrit : le nom tapé, revérifié par le serveur, qui refuse encore si un déploiement ou une VM allumée s'en sert.
   */
  async function dessinerDetail(zone, c, o) {
    const hote = o.hote, nom = nomComplet(c), chemin = String(c.id || '').startsWith('iso:') ? String(c.id).slice(4) : '';
    const D = { f: null, u: null, errF: '', errU: '', ouvert: false, tape: '', occupe: false, refus: '', msg: '' };
    const retour = el('button', { type: 'button', class: 'sy-btn sy-back', 'data-f': 'd-retour', onclick: () => o.retour(c.id, false) }, ic('left', 15), mot('retour'));
    const fiche = el('section', { class: 'sy-card', 'data-f': 'fiche', 'aria-labelledby': 'sy-d-titre' });
    const note = el('p', { class: 'sy-msg', role: 'status', 'data-f': 'd-note' });
    const bas = el('div', { class: 'sy-rgrid' });
    zone.replaceChildren(retour, fiche, note, bas);
    let boutonRetirer = null;
    const lireUsages = async () => {
      if (!chemin) { D.u = null; D.errU = '?'; return; }
      const r = await postModule('ymir', 'iso_usages', { iso: chemin }).catch((e) => ({ ok: false, text: String((e && e.message) || e) }));
      if (r && r.ok !== false && r.data) { D.u = r.data; D.errU = ''; } else { D.u = null; D.errU = (r && r.text) || '?'; }
    };
    const vers = (id, sous) => { if (sous && W.OdinGeneseReseau && W.OdinGeneseReseau.etat) W.OdinGeneseReseau.etat.sous = sous; if (hote && typeof hote.aller === 'function') hote.aller(id); };

    function faits(f) {
      const u = D.u, l = [];
      const p = (k, v, o2 = {}) => { if (v != null && v !== '') l.push(el('div', {}, el('dt', {}, mot(k)), el('dd', { class: o2.code ? 'sy-code' : null, title: o2.titre || null }, v))); };
      p('d.f.fichier', f.nom, { code: true });
      p('d.f.taille', f.taille ? taille(f.taille) : '');
      p('d.f.arch', f.arch ? (MOTS[`arch.${f.arch}`] ? mot(`arch.${f.arch}`) : f.arch) : '');
      p('d.f.uefi', f.efi === true ? mot('uefi.oui') : f.efi === false ? mot('uefi.non') : '');
      p('d.f.auto', u && u.genese ? mot(u.genese.auto ? 'auto.oui' : 'auto.non') : '');
      const court = empreinteCourte(f.sha256);
      p('d.f.empreinte', !court ? mot('emp.aucune') : mot(f.verifiee && f.verifiee.ok === false ? 'emp.changee' : f.editeur === true ? 'emp.editeur' : 'emp.calculee', { court }), { code: Boolean(court), titre: f.sha256 || '' });
      const av = f.antivirus || {}, le = av.at ? lePlein(av.at) : '';
      p('d.f.antivirus', av.verdict === 'sain' ? mot('av.sain', { le }) : av.verdict === 'à vérifier' ? mot('av.a_verifier', { le }) : av.verdict === 'bloqué' ? mot('av.bloque') : mot('av.non'));
      const hoteSrc = (/^https?:\/\/(?:[^/@?#]*@)?([a-z0-9.-]+)/i.exec(String(f.source || '')) || [])[1] || '';
      p('d.f.arrive', f.ajoute ? (f.origine === 'andromede' ? mot('arr.andromede', { le: lePlein(f.ajoute), hote: hoteSrc ? ` (${hoteSrc})` : '' }) : mot('arr.autre', { le: lePlein(f.ajoute), origine: MOTS[`o.${f.origine}`] ? mot(`o.${f.origine}`) : String(f.origine || '') })) : '');
      p('d.f.verifie', f.verifiee ? mot(f.verifiee.ok === false ? 'verif.ko' : 'verif.ok', { le: lePlein(f.verifiee.at) }) : mot('verif.jamais'));
      if (f.surveille !== undefined) p('d.f.surveille', mot(f.surveille ? 'surv.oui' : 'surv.non'));
      return el('dl', { class: 'sy-facts', 'data-f': 'd-faits' }, ...l);
    }

    function garde() {
      const u = D.u, fermer = (e) => { if (e && e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); D.ouvert = false; D.refus = ''; rendre('d-retirer'); } };
      const boutons = [];
      const garder = el('button', { type: 'button', class: 'sy-btn', 'data-f': 'd-garder', onclick: () => { D.ouvert = false; D.refus = ''; rendre('d-retirer'); } }, mot('r.garder'));
      if (!u) {
        const relire = el('button', { type: 'button', class: 'sy-btn', 'data-f': 'd-relire', onclick: async () => { await lireUsages(); rendre('d-garder'); } }, ic('refresh', 15), mot('r.relire'));
        return el('div', { class: 'sy-guard', role: 'alert', 'data-f': 'd-garde', onkeydown: fermer }, el('span', { class: 'gi', 'aria-hidden': 'true' }, ic('warn', 22)),
          el('div', {}, el('b', { class: 't' }, mot('r.bloque.titre', { nom })), el('p', { class: 'err' }, mot('u.pas.lu', { raison: D.errU || '?' })), el('div', { class: 'sy-row' }, relire, garder)));
      }
      if (Array.isArray(u.bloquants) && u.bloquants.length) {
        const relire = el('button', { type: 'button', class: 'sy-btn', 'data-f': 'd-relire', onclick: async () => { await lireUsages(); rendre('d-garder'); } }, ic('refresh', 15), mot('r.relire'));
        return el('div', { class: 'sy-guard', role: 'alert', 'data-f': 'd-garde', 'data-bloque': '1', onkeydown: fermer }, el('span', { class: 'gi', 'aria-hidden': 'true' }, ic('warn', 22)),
          el('div', {}, el('b', { class: 't', id: 'sy-g-titre' }, mot('r.bloque.titre', { nom })), el('ul', {}, ...u.bloquants.map((b) => el('li', {}, b))), el('div', { class: 'sy-row' }, relire, garder)));
      }
      const attendu = String(u.aTaper || '');
      const confirmer = async () => {
        if (D.occupe || !nomJuste(D.tape, attendu)) return;
        D.occupe = true; D.refus = ''; ok.disabled = true; note.textContent = mot('r.cours');
        const r = await postModule('ymir', 'retirer_systeme', { iso: chemin, nom: D.tape }, true).catch((e) => ({ ok: false, text: String((e && e.message) || e) }));
        D.occupe = false;
        if (r && r.ok !== false && !r.confirm) { Z.msg = r.text || ''; o.retour(null, true); return; }
        // Refusé (un déploiement vient de commencer, le nom, un lien…) : dit tel quel, et « où il sert » est relu.
        D.refus = (r && (r.text || r.confirm)) || '?'; note.textContent = '';
        await lireUsages(); rendre('d-nom');
      };
      const ok = el('button', { type: 'button', class: 'sy-btn dng', 'data-f': 'd-confirmer', disabled: D.occupe || !nomJuste(D.tape, attendu), onclick: confirmer }, ic('trash', 15), mot('r.ok'));
      const champ = el('input', { class: 'sy-q', type: 'text', id: 'sy-d-nom', 'data-f': 'd-nom', autocomplete: 'off', spellcheck: 'false', 'aria-label': mot('r.taper.nom', { nom: attendu }), placeholder: attendu,
        oninput: (e) => { D.tape = e.target.value; ok.disabled = D.occupe || !nomJuste(D.tape, attendu); },
        onkeydown: (e) => { if (e.key === 'Enter') { if (e.preventDefault) e.preventDefault(); void confirmer(); } } });
      champ.value = D.tape;
      boutons.push(ok, garder);
      const lignes = [mot('r.fichier', { taille: taille(c.taille || (D.f && D.f.taille) || 0) }), ...phrasesRetrait(u), ...(c.source || (D.f && D.f.source) ? [mot('r.retel')] : [])];
      return el('div', { class: 'sy-guard', role: 'group', 'aria-labelledby': 'sy-g-titre', 'data-f': 'd-garde', onkeydown: fermer }, el('span', { class: 'gi', 'aria-hidden': 'true' }, ic('trash', 22)),
        el('div', {}, el('b', { class: 't', id: 'sy-g-titre' }, mot('r.titre', { nom })), el('ul', {}, ...lignes.map((t) => el('li', {}, t))),
          D.refus ? el('p', { class: 'err', role: 'alert', 'data-f': 'd-refus' }, D.refus) : null,
          el('label', { for: 'sy-d-nom' }, mot('r.taper'), ' ', el('b', {}, attendu)), champ, el('div', { class: 'sy-row' }, ...boutons)));
    }

    function usages() {
      const u = D.u, l = [];
      if (!u) return el('section', { class: 'sy-card', 'data-f': 'd-usages', 'aria-labelledby': 'sy-u-titre' }, el('h4', { id: 'sy-u-titre' }, mot('u.titre')), el('p', { class: 'sy-msg' }, D.errU ? mot('u.pas.lu', { raison: D.errU }) : mot('d.charge')));
      for (const x of Array.isArray(u.usages) ? u.usages : []) {
        let icone = 'usb', titre = '', sous = '', voir = null;
        if (x.genre === 'cle') { titre = mot('u.cle', { nom: x.nom }); sous = x.at ? mot('u.cle.d', { le: lePlein(x.at) }) : mot('u.cle.d.sans'); voir = () => vers('cle'); }
        else if (x.genre === 'menu') { icone = 'menu'; titre = mot('u.menu'); const d = x.cache ? mot('u.menu.cache') : mot('u.menu.d', { n: nombre(x.position || 1) }); sous = x.defaut ? mot('u.menu.defaut', { d }) : d; voir = () => vers('reseau', 'menu'); }
        else if (x.genre === 'pc') { icone = 'pc'; titre = mot('u.pc', { nom: x.nom }); sous = mot(x.auto ? 'u.pc.auto' : 'u.pc.d', { mac: x.mac || '' }); voir = () => vers('reseau', 'serveur'); }
        else if (x.genre === 'deploiement') { icone = 'net'; titre = mot('u.dep'); sous = mot('u.dep.d', { n: nombre((x.pcs || []).length), pcs: (x.pcs || []).join(', ') }); voir = () => vers('installations'); }
        else if (x.genre === 'vm') { icone = 'vm'; titre = mot('u.vm', { nom: x.nom }); sous = mot(x.allumee ? 'u.vm.allumee' : x.modele ? 'u.vm.modele' : 'u.vm.d'); voir = () => { location.hash = '#app=ymir'; }; }
        l.push(el('div', { class: `sy-entry${x.bloque ? ' bloque' : ''}`, 'data-usage': x.genre },
          el('span', { class: 'ic', 'aria-hidden': 'true' }, ic(icone, 20)),
          el('span', { class: 'nm' }, el('b', {}, titre), el('small', {}, sous), x.bloque ? el('span', { class: 'sy-tag bad', style: 'margin-top:4px' }, ic('warn', 12), mot('u.bloque')) : null),
          voir ? el('button', { type: 'button', class: 'sy-btn', 'data-f': 'd-voir', 'aria-label': mot('u.voir.nom', { nom: titre }), onclick: voir }, mot('u.voir')) : null));
      }
      return el('section', { class: 'sy-card', 'data-f': 'd-usages', 'aria-labelledby': 'sy-u-titre' }, el('h4', { id: 'sy-u-titre' }, mot('u.titre')), el('p', { class: 'sy-lead' }, mot('u.lead')),
        l.length ? el('div', { class: 'sy-used' }, ...l) : el('p', { class: 'sy-msg' }, mot('u.rien')),
        u.lu && u.lu.cles === false ? el('p', { class: 'sy-msg', style: 'margin-top:10px' }, mot('u.cles.pas.lu')) : null);
    }

    function versions() {
      const f = D.f, l = [];
      const lettre = (String(c.nom).trim().charAt(0) || '?').toUpperCase(), coul = couleur(c);
      const vs = f && Array.isArray(f.versions) && f.versions.length ? f.versions : [{ nom: c.fichier || c.nom, version: c.version, taille: c.taille, enService: true, ancienne: false }];
      for (const v of vs) l.push(el('div', { class: `sy-entry${v.enService ? ' def' : ''}`, 'data-version': v.version || v.nom },
        el('span', { class: 'sy-mono', style: `background:${coul};${v.enService ? '' : 'opacity:.55'}`, 'aria-hidden': 'true' }, lettre),
        el('span', { class: 'nm' }, el('b', {}, v.version || v.nom), el('small', {}, mot(v.ancienne ? 'v.old' : 'v.service', { taille: taille(v.taille) }))),
        v.enService && !v.ancienne ? el('span', { class: 'sy-tag ok' }, mot('v.tag')) : null));
      const n = f && f.nouvelle;
      if (n) l.push(el('div', { class: 'sy-entry neu', 'data-version': n.version },
        el('span', { class: 'sy-mono', style: `background:${coul}`, 'aria-hidden': 'true' }, lettre),
        el('span', { class: 'nm' }, el('b', {}, n.version), el('small', {}, mot('v.nouvelle'))),
        el('button', { type: 'button', class: 'sy-btn pri', 'data-f': 'd-telecharger', 'aria-label': mot('v.tel.nom', { nom: c.nom, version: n.version }), onclick: () => telecharger({ ...c, source: n.source }, mot('maj.confirme', { nom: c.nom, version: n.version }), async () => { note.textContent = Z.msg; Z.msg = ''; }) }, ic('download', 15), mot('v.tel'))));
      return el('section', { class: 'sy-card', 'data-f': 'd-versions', 'aria-labelledby': 'sy-v-titre' }, el('h4', { id: 'sy-v-titre' }, mot('v.titre')), el('p', { class: 'sy-lead' }, mot('v.lead')), el('div', { class: 'sy-used' }, ...l));
    }

    function rendre(focus) {
      const lettre = (String(c.nom).trim().charAt(0) || '?').toUpperCase();
      const sous = [mot(`fam.${c.famille}`), c.genre ? c.genre.charAt(0).toUpperCase() + c.genre.slice(1) : null, c.taille ? taille(c.taille) : null].filter(Boolean).join(' · ');
      const dep = el('button', { type: 'button', class: 'sy-btn pri', 'data-f': 'd-deployer', disabled: !c.deployable, title: c.deployable ? null : mot(`raison.${c.raison || 'absent'}`), onclick: () => { if (c.deployable) deployerDepuisFiche(c, hote); } }, ic('bolt', 15), mot('deployer'));
      const maj = c.maj && c.source ? el('button', { type: 'button', class: 'sy-btn', 'data-f': 'd-maj', onclick: () => telecharger(c, mot('maj.confirme', { nom: c.nom, version: c.maj.version }), async () => { note.textContent = Z.msg; Z.msg = ''; }) }, ic('refresh', 15), mot('maj.bouton')) : null;
      boutonRetirer = el('button', { type: 'button', class: 'sy-btn rouge', 'data-f': 'd-retirer', 'aria-expanded': String(D.ouvert), 'aria-label': mot('r.bouton.nom', { nom }), disabled: !chemin, onclick: async () => {
        D.ouvert = !D.ouvert; D.refus = ''; D.tape = '';
        if (D.ouvert) { await lireUsages(); rendre(D.u && !(D.u.bloquants || []).length ? 'd-nom' : 'd-garder'); } else rendre('d-retirer');
      } }, ic('trash', 15), mot('r.bouton'));
      fiche.replaceChildren(...[
        el('div', { class: 'sy-hero' }, el('span', { class: 'sy-mono', style: `background:${couleur(c)}`, 'aria-hidden': 'true' }, lettre), el('div', {}, el('h4', { id: 'sy-d-titre' }, nom), el('small', {}, sous))),
        el('div', { style: 'margin-top:12px' }, ...etatLigne(c)),
        el('div', { class: 'sy-row' }, dep, maj, boutonRetirer),
        D.ouvert ? garde() : null,
        D.f ? faits(D.f) : el('p', { class: 'sy-msg', style: 'margin-top:12px' }, D.errF ? mot('d.erreur', { raison: D.errF }) : mot('d.charge'))].filter(Boolean));
      bas.replaceChildren(usages(), versions());
      if (focus) { const n = zone.querySelector(`[data-f="${focus}"]`); if (n && n.focus) n.focus(); }
    }
    rendre();
    if (retour.focus) retour.focus();
    // Les deux lectures partent ensemble : « où il sert » puis la fiche.
    const [, rf] = await Promise.all([lireUsages(), postModule('ymir', 'fiche_iso', { iso: c.fichier || c.nom }).catch((e) => ({ ok: false, text: String((e && e.message) || e) }))]);
    if (rf && rf.ok !== false && rf.data) D.f = rf.data; else D.errF = (rf && rf.text) || '?';
    if (!zone.isConnected) return;
    const a = typeof document !== 'undefined' ? document.activeElement : null, garde0 = a && zone.contains(a) ? a.getAttribute && a.getAttribute('data-f') : null;
    rendre(garde0 && garde0 !== 'd-retour' ? garde0 : undefined);
  }

  function carte(c, hote, redessiner) {
    const lettre = (String(c.nom).trim().charAt(0) || '?').toUpperCase();
    const sous = [mot(`fam.${c.famille}`), c.genre ? c.genre.charAt(0).toUpperCase() + c.genre.slice(1) : null, c.taille ? taille(c.taille) : null].filter(Boolean).join(' · ');
    return el('div', { class: 'sy-sys', role: 'listitem', 'data-carte': c.id, 'data-etat': c.etat },
      el('div', { class: 'top' }, el('span', { class: 'sy-mono', style: `background:${couleur(c)}`, 'aria-hidden': 'true' }, lettre), el('span', { class: 'nm' }, el('b', {}, nomComplet(c)), el('small', {}, sous))),
      ...etatLigne(c),
      Z.vers === c.id ? vers(c, hote, redessiner) : null,
      el('div', { class: 'sy-acts' }, ...actions(c, hote, redessiner)));
  }

  /** Monte l'onglet dans root. hote : { post, aller(onglet) } (la page de Genèse). Deux vues : la bibliothèque, et le
   *  catalogue (« Ajouter un système ») ; on passe de l'une à l'autre sans quitter l'onglet. */
  async function dessiner(root, _onglet, hote) {
    if (typeof document !== 'undefined' && document.head && !document.getElementById?.('sysCss')) document.head.append(el('style', { id: 'sysCss' }, CSS));
    const wrap = el('div', { class: 'sy', 'data-f': 'systemes' });
    root.append(wrap);
    const montrer = async (vue, focus) => {
      Z.vue = vue === 'catalogue' ? 'catalogue' : 'biblio';
      // Une zone neuve à chaque vue : celle d'avant, détachée, arrête d'elle-même de se relire.
      const zone = el('div', { class: 'sy' }); wrap.replaceChildren(zone);
      if (Z.vue === 'catalogue') await dessinerCatalogue(zone, hote, montrer, focus); else await dessinerBiblio(zone, hote, montrer, focus);
    };
    await montrer(Z.vue);
  }

  /** La bibliothèque (lot S1). */
  async function dessinerBiblio(wrap, hote, montrer, focusDepart) {
    const post = (hote && hote.post) || ((a, i) => postModule('thjalfi', a, i));
    const haut = el('div', {}), grille = el('div', { class: 'sy-grid', role: 'list', 'data-f': 'grille' }), note = el('p', { class: 'sy-msg', role: 'status' });
    const chips = el('div', { class: 'sy-chips', role: 'group', 'aria-label': mot('f.groupe') });
    const q = el('input', { class: 'sy-q', type: 'search', placeholder: mot('q'), 'aria-label': mot('q.nom'), value: Z.q, 'data-f': 'recherche', oninput: (e) => { Z.q = e.target.value; rendreGrille(); } });
    q.value = Z.q;
    // « Ajouter un système » ouvre le catalogue ici ; le Store complet d'Andromède (tes sources, les index en ligne) reste à un clic.
    const ajouter = [el('button', { type: 'button', class: 'sy-btn pri', 'data-f': 'catalogue', onclick: () => { void montrer('catalogue', 'retour'); } }, ic('plus', 15), mot('ajouter')),
      el('button', { type: 'button', class: 'sy-btn', 'data-f': 'ajouter', title: mot('store.aide'), onclick: () => { location.hash = '#app=eitri'; } }, mot('store'), ic('ext', 14))];
    // Les filtres restent les mêmes boutons (seul « aria-pressed » change) : le focus du clavier ne se perd pas.
    const boutonsFiltre = FILTRES.map((f) => el('button', { type: 'button', class: 'sy-chip', 'data-filtre': f, 'aria-pressed': String(Z.filtre === f), onclick: () => { Z.filtre = f; for (const b of boutonsFiltre) b.setAttribute('aria-pressed', String(b.getAttribute('data-filtre') === Z.filtre)); rendreGrille(); } }, mot(`f.${f}`)));
    chips.append(...boutonsFiltre);
    // Deux vues dans la même zone : la bibliothèque, et la fiche d'un système (lot S3) ; la bibliothèque reste derrière,
    // cachée, et revient telle quelle (filtre, recherche) avec le focus sur le « Détail » de sa carte.
    const vueB = el('div', { class: 'sy', 'data-f': 'vue-biblio' }), vueD = el('div', { class: 'sy', 'data-f': 'vue-detail', hidden: true });
    vueB.append(haut, el('section', { class: 'sy-card', 'aria-labelledby': 'sy-titre' }, el('h4', { id: 'sy-titre' }, mot('titre')), el('p', { class: 'sy-lead' }, mot('lead')),
      el('div', { class: 'sy-tools' }, chips, q, ...ajouter), note, grille));
    wrap.append(vueB, vueD);
    Z.montrerDetail = (c) => {
      clearTimeout(minuteur); minuteur = 0; Z.vers = '';
      vueB.hidden = true; vueD.hidden = false;
      void dessinerDetail(vueD, c, { hote, retour: (id, relire) => {
        vueD.replaceChildren(); vueD.hidden = true; vueB.hidden = false;
        void redessiner(Boolean(relire), id ? { carte: id, f: 'detail' } : undefined);
      } });
    };

    /** Où est le focus dans la grille : { carte, f } (la carte et le bouton), pour le rendre après un nouveau dessin. */
    function focusDansGrille() {
      const a = typeof document !== 'undefined' ? document.activeElement : null;
      if (!a || !grille.contains(a)) return undefined;
      let x = a; while (x && x !== grille && !(x.getAttribute && x.getAttribute('data-carte') != null)) x = x.parentNode;
      return x && x !== grille ? { carte: x.getAttribute('data-carte'), f: a.getAttribute && a.getAttribute('data-f') } : undefined;
    }
    function rendreGrille(focus) {
      const d = Z.data, garde = focus || focusDansGrille();
      note.textContent = Z.erreur ? mot('erreur', { raison: Z.erreur }) : !d ? mot('charge') : d.lu && d.lu.bibliotheque === false && !d.cartes.length ? mot('pas.biblio') : Z.msg;
      if (!d) { grille.replaceChildren(); return; }
      const l = filtrer(d.cartes, Z.filtre, Z.q);
      grille.replaceChildren(...l.map((c) => carte(c, hote, redessiner)));
      if (!l.length) grille.append(el('p', { class: 'sy-msg' }, d.cartes.length ? mot('vide.filtre') : mot('vide')));
      // Le même bouton de la même carte (comparé par valeur : aucun nom de fichier n'entre dans un sélecteur) ; sinon « Déployer ».
      if (garde && garde.carte) {
        const k = Array.from(grille.querySelectorAll('[data-carte]')).find((n) => n.getAttribute('data-carte') === garde.carte);
        const n = k && ((garde.f && k.querySelector(`[data-f="${String(garde.f).replace(/[^\w-]/g, '')}"]`)) || k.querySelector('[data-f="deployer"]'));
        if (n && n.focus) n.focus();
      }
    }
    let minuteur = 0;
    /** Visible : dans la page ET pas dans un onglet caché (l'onglet « Tout » de Genèse cache le corps sans le retirer). */
    const visible = () => { if (!wrap.isConnected) return false; for (let x = wrap; x; x = x.parentNode) if (x.hidden) return false; return true; };
    // En direct : tant qu'un téléchargement ou une vérification est en cours, on relit toutes les 3 s — seulement quand
    // la page est visible ; un seul minuteur ; il s'arrête dès que l'onglet est quitté (y revenir redessine tout).
    function armer() {
      clearTimeout(minuteur); minuteur = 0;
      const vivant = Z.data && (Z.data.cartes || []).some((c) => c.etat === 'telechargement' || c.etat === 'verification');
      if (!vivant) return;
      const tic = () => {
        minuteur = 0;
        if (!visible()) return;
        if (typeof document !== 'undefined' && document.hidden) { minuteur = setTimeout(tic, 3000); return; }
        void redessiner(true);
      };
      minuteur = setTimeout(tic, 3000);
    }
    async function redessiner(relire = true, focus) {
      if (relire) {
        let r; try { r = await post('systemes', {}); } catch (e) { r = { ok: false, text: String(e && e.message || e) }; }
        if (r && r.ok !== false && r.data) {
          const t = Date.now(), avant = Z.data;
          Z.debits = {};
          for (const c of r.data.cartes || []) {
            if (c.etat !== 'telechargement' || !c.telechargement) continue;
            const a = avant && (avant.cartes || []).find((x) => x.id === c.id);
            const v = a && a.telechargement ? vitesse({ recu: a.telechargement.recu, t: avant.lu_le || 0 }, { recu: c.telechargement.recu, total: c.telechargement.total, t }) : undefined;
            if (v) Z.debits[c.id] = v;
          }
          Z.data = { ...r.data, lu_le: t }; Z.erreur = '';
        } else { Z.erreur = (r && r.text) || '?'; }
      }
      haut.replaceChildren(Z.data ? chiffres(Z.data) : el('span'));
      rendreGrille(focus);
      armer();
    }
    await redessiner(true);
    if (focusDepart === 'catalogue') { const n = wrap.querySelector('[data-f="catalogue"]'); if (n && n.focus) n.focus(); }
  }

  // ---------------------------------------------------------------- le catalogue (lot S2)
  /** « Ajouter un système » : le catalogue d'Andromède rangé par familles, la version à choisir sur chaque carte,
   *  « Toutes les versions », PC ou ARM 64, la file de téléchargement (un à la fois) et « à déposer ». Les gestes
   *  (télécharger, retirer de la file, arrêter) demandent ton accord et passent par Andromède, réservés au propriétaire. */
  async function dessinerCatalogue(wrap, hote, montrer, focusDepart) {
    const C = Z.cat;
    const eitri = (a, i = {}) => postModule('eitri', a, i).catch((e) => ({ ok: false, text: String((e && e.message) || e) }));
    const retour = el('button', { type: 'button', class: 'sy-btn sy-back', 'data-f': 'retour', onclick: () => { void montrer('biblio', 'catalogue'); } }, ic('left', 15), mot('retour'));
    const note = el('p', { class: 'sy-msg', role: 'status' }), corps = el('div', { 'data-f': 'catalogue-corps' }), barre = el('div', {});
    const chips = el('div', { class: 'sy-chips', role: 'group', 'aria-label': mot('c.groupe') });
    const boutonsFil = FILTRES_CAT.map((f) => el('button', { type: 'button', class: 'sy-chip', 'data-cfiltre': f, 'aria-pressed': String(C.fil === f), onclick: () => { C.fil = f; for (const b of boutonsFil) b.setAttribute('aria-pressed', String(b.getAttribute('data-cfiltre') === C.fil)); rendre(); } }, mot(f === 'autre' ? 'f.autre' : `f.${f}`)));
    chips.append(...boutonsFil);
    const q = el('input', { class: 'sy-q', type: 'search', placeholder: mot('c.q'), 'aria-label': mot('c.q.nom'), 'data-f': 'c-recherche', oninput: (e) => { C.q = e.target.value; rendre(); } });
    q.value = C.q;
    const arch = el('select', { class: 'sy-sel', 'aria-label': mot('c.arch'), 'data-f': 'c-arch', onchange: (e) => { C.arch = e.target.value === 'arm' ? 'arm' : 'x86_64'; rendre(); } },
      el('option', { value: 'x86_64' }, mot('c.arch.pc')), el('option', { value: 'arm' }, mot('c.arch.arm')));
    arch.value = C.arch;
    const toutes = el('button', { type: 'button', class: 'sy-sw', role: 'switch', 'aria-checked': String(C.toutes), 'data-f': 'c-toutes', onclick: () => { C.toutes = !C.toutes; toutes.setAttribute('aria-checked', String(C.toutes)); rendre(); } }, el('i', { 'aria-hidden': 'true' }), mot('toutes'));
    // Relire les dernières versions sur les sites officiels (une lecture, rien n'est téléchargé), comme dans le Store.
    const relireB = el('button', { type: 'button', class: 'sy-btn', 'data-f': 'c-relire', onclick: async () => {
      relireB.disabled = true; C.msg = mot('c.relire.cours'); C.msgNeuf = true; rendre();
      const r = await eitri('store', { actualiser: true }); C.msg = r && r.ok !== false ? mot('c.relire.fait') : mot('c.lecture.ko', { raison: (r && r.text) || '?' }); C.msgNeuf = true;
      relireB.disabled = false; await relire();
    } }, ic('refresh', 15), mot('c.relire'));
    wrap.append(retour, el('section', { class: 'sy-card', 'aria-labelledby': 'sy-c-titre', 'data-f': 'catalogue' },
      el('h4', { id: 'sy-c-titre' }, mot('c.titre')), el('p', { class: 'sy-lead' }, mot('c.lead')),
      el('div', { class: 'sy-tools' }, chips), el('div', { class: 'sy-tools' }, q, arch, toutes, relireB), note, barre, corps,
      el('p', { class: 'sy-msg', style: 'margin-top:12px' }, mot('c.note'))));

    const parId = (id) => ((C.data && C.data.entrees) || []).find((e) => e.id === id);
    function focusIci() {
      const a = typeof document !== 'undefined' ? document.activeElement : null;
      if (!a || !corps.contains(a)) return undefined;
      let x = a; while (x && x !== corps && !(x.getAttribute && x.getAttribute('data-ccarte') != null)) x = x.parentNode;
      return x && x !== corps ? { carte: x.getAttribute('data-ccarte'), f: a.getAttribute && a.getAttribute('data-f'), v: a.getAttribute && a.getAttribute('data-v') } : undefined;
    }
    function rendreFocus(g) {
      if (!g || !g.carte) return;
      const k = Array.from(corps.querySelectorAll('[data-ccarte]')).find((n) => n.getAttribute('data-ccarte') === g.carte); if (!k) return;
      const l = Array.from(k.querySelectorAll('button,a'));
      const n = l.find((b) => g.f && b.getAttribute('data-f') === g.f && (g.v == null || b.getAttribute('data-v') === g.v)) || l.find((b) => g.f && b.getAttribute('data-f') === g.f) || l.find((b) => b.getAttribute('data-f') === 'c-tel') || l[0];
      if (n && n.focus) n.focus();
    }
    async function geste(e, v, quoi) {
      const nom = v ? `${e.nom} ${v.version}` : e.nom;
      if (quoi === 'tel') {
        const t = v && v.taille ? mot('c.tel.confirme.taille', { taille: taille(v.taille) }) : '';
        if (!(await W.OdinDialog.confirm(mot('c.tel.confirme', { nom, taille: t })))) return;
        const r = await eitri('mettre_en_file', { nom: e.id, version: v ? v.version : '' }); C.msg = mot('c.reponse', { texte: (r && r.text) || '?' });
      } else if (quoi === 'retirer') {
        if (!(await W.OdinDialog.confirm(mot('c.file.retirer.confirme', { nom })))) return;
        const r = await eitri('retirer_de_la_file', { nom: e.id, version: v ? v.version : '' }); C.msg = (r && r.text) || '';
      } else if (quoi === 'arreter') {
        if (!(await W.OdinDialog.confirm(mot('arreter.confirme', { nom }), { danger: true }))) return;
        const r = await eitri('annuler', { nom: e.id }); C.msg = (r && r.text) || '';
      }
      C.msgNeuf = true;
      await relire();
    }
    async function lireVersions(e) {
      C.lecture[e.id] = 'charge'; rendre({ carte: e.id, f: 'c-versions' });
      const r = await eitri('versions', { nom: e.id, actualiser: true });
      if (r && r.ok !== false && r.data && Array.isArray(r.data.versions)) {
        delete C.lecture[e.id];
        const x = parId(e.id); if (x) { x.versions = r.data.versions; if (Array.isArray(r.data.presents)) x.presents = r.data.presents; }
      } else C.lecture[e.id] = mot('c.lecture.ko', { raison: (r && r.text) || '?' });
      rendre({ carte: e.id, f: 'c-pill' });
    }
    function carteCat(e) {
      const lettre = (String(e.nom).trim().charAt(0) || '?').toUpperCase();
      const choisie = versionChoisie(e, C.choix[e.id], C.toutes), montrees = versionsMontrees(e, C.toutes), etat = etatCarte(e, choisie, C.file);
      const nomV = choisie ? `${e.nom} ${choisie.version}` : e.nom, lect = C.lecture[e.id];
      const pills = montrees.length ? el('div', { class: 'sy-pills', role: 'group', 'aria-label': mot('c.versions', { nom: e.nom }) }, ...montrees.map((v) => {
        const canal = v.canal === 'dernière' ? '' : mot(`c.canal.${v.canal}`);
        return el('button', { type: 'button', class: 'sy-pill', 'data-f': 'c-pill', 'data-v': v.version, 'aria-pressed': String(Boolean(choisie && choisie.version === v.version)), onclick: () => { C.choix[e.id] = v.version; rendre({ carte: e.id, f: 'c-pill', v: v.version }); } }, v.version, canal ? el('span', {}, ` · ${canal}`) : null);
      })) : (e.manuel ? null : el('p', { class: 'sy-about' }, mot('c.pas.lue')));
      // Lire les versions sur le site officiel : quand rien n'est lu, ou que « Toutes les versions » est demandé.
      const aLire = !e.manuel && (!Array.isArray(e.versions) || !e.versions.length) && C.toutes;
      const lire = aLire ? el('button', { type: 'button', class: 'sy-btn', 'data-f': 'c-versions', 'aria-label': mot('c.voir.versions.nom', { nom: e.nom }), disabled: lect === 'charge', onclick: () => { void lireVersions(e); } }, ic('refresh', 15), lect === 'charge' ? mot('c.lecture') : C.toutes ? mot('c.voir.toutes') : mot('c.voir.versions')) : null;
      const acts = [];
      if (etat === 'deposer') {
        if (e.page) acts.push(el('a', { class: 'sy-btn', 'data-f': 'c-page', href: e.page, target: '_blank', rel: 'noopener noreferrer', 'aria-label': mot('c.page.nom', { nom: e.nom }) }, ic('ext', 15), mot('c.page')));
        acts.push(el('button', { type: 'button', class: 'sy-btn', 'data-f': 'c-ou', 'aria-label': mot('c.ou.nom', { nom: e.nom }), onclick: () => { void W.OdinDialog.alert(mot('c.ou.texte', { raison: e.manuel, dossier: (C.data && C.data.dossier) || mot('c.ou.sans') }), { title: e.nom }); } }, ic('file', 15), mot('c.ou')));
      } else if (etat === 'biblio') {
        acts.push(el('span', { class: 'sy-tag ok' }, ic('check', 12, 3), mot('c.dans')), el('button', { type: 'button', class: 'sy-btn', 'data-f': 'c-voir', 'aria-label': mot('c.voir.nom', { nom: nomV }), onclick: () => { Z.q = String(e.nom).replace(/\s*\(.*\)\s*$/, ''); Z.filtre = 'tout'; void montrer('biblio'); } }, mot('c.voir')));
      } else if (etat === 'cours') {
        const f = C.file && C.file.enCours, p = f && f.source === e.id ? f.pct : undefined;
        acts.push(el('span', { class: 'sy-tag acc', 'data-f': 'c-cours' }, ic('download', 12), f && f.prepare ? mot('c.prepare') : p != null ? mot('c.cours', { pct: pct(p) }) : mot('c.cours.sans')),
          el('button', { type: 'button', class: 'sy-btn', 'data-f': 'c-arreter', 'aria-label': mot('arreter.nom', { nom: nomV }), onclick: () => { void geste(e, choisie, 'arreter'); } }, ic('x', 15), mot('arreter')));
      } else if (etat === 'file') {
        const av = avantDansFile(C.file, e.id, choisie.version);
        acts.push(el('span', { class: 'sy-tag acc', 'data-f': 'c-enfile' }, ic('clock', 12), av ? mot('c.file', { nom: av }) : mot('c.file', { nom: '…' })),
          el('button', { type: 'button', class: 'sy-btn', 'data-f': 'c-retirer', 'aria-label': mot('c.file.retirer.nom', { nom: nomV }), onclick: () => { void geste(e, choisie, 'retirer'); } }, mot('c.file.retirer')));
      } else {
        acts.push(el('button', { type: 'button', class: 'sy-btn pri', 'data-f': 'c-tel', 'aria-label': mot('c.tel.nom', { nom: nomV }), onclick: () => { void geste(e, choisie, 'tel'); } }, ic('download', 15),
          !choisie ? mot('c.tel.derniere') : choisie.taille ? mot('c.tel.taille', { taille: taille(choisie.taille) }) : mot('c.tel')));
      }
      const sous = [mot(`g.${GROUPES.includes(e.groupe) ? e.groupe : 'autre'}`), e.arch === 'arm64' ? mot('c.arch.arm') : 'x86_64'].join(' · ');
      return el('div', { class: 'sy-sys', role: 'listitem', 'data-ccarte': e.id, 'data-etat': etat },
        el('div', { class: 'top' }, el('span', { class: 'sy-mono', style: `background:${couleur({ nom: e.nom, famille: e.groupe })}`, 'aria-hidden': 'true' }, lettre),
          el('span', { class: 'nm' }, el('b', {}, e.nom), el('small', {}, sous)), e.manuel ? el('span', { class: 'sy-tag warn', 'data-f': 'c-deposer' }, mot('c.deposer')) : null),
        e.about ? el('p', { class: 'sy-about' }, e.about) : null,
        e.manuel ? el('p', { class: 'sy-about' }, e.manuel) : null,
        pills, lect && lect !== 'charge' ? el('p', { class: 'sy-about', role: 'alert' }, lect) : null,
        el('div', { class: 'sy-catacts' }, ...acts, lire));
    }
    function rendre(focus) {
      const garde = focus || focusIci();
      note.textContent = C.erreur ? mot('c.erreur', { raison: C.erreur }) : !C.data ? mot('c.charge') : C.msg;
      if (!C.data) { corps.replaceChildren(); return; }
      const gs = groupesCatalogue(C.data.entrees, C);
      corps.replaceChildren(...gs.flatMap((g) => [el('div', { class: 'sy-grp', 'data-groupe': g.groupe }, mot(`g.${g.groupe}`), el('span', { class: 'n' }, nombre(g.cartes.length))),
        el('div', { class: 'sy-grid', role: 'list' }, ...g.cartes.map(carteCat))]));
      if (!gs.length) corps.append(el('p', { class: 'sy-msg' }, mot('c.vide')));
      // La barre du bas : ce qui se télécharge et combien attendent, un à la fois.
      const f = C.file, n = f && Array.isArray(f.file) ? f.file.length : 0;
      barre.replaceChildren(...(f && (f.enCours || n) ? [el('div', { class: 'sy-pend', role: 'status', 'data-f': 'c-barre' },
        el('b', {}, f.enCours ? (n ? mot('c.barre.cours', { nom: f.enCours.nom, version: f.enCours.version, n: nombre(n) }) : mot('c.barre.cours.seul', { nom: f.enCours.nom, version: f.enCours.version })) : mot(n > 1 ? 'c.barre.other' : 'c.barre.one', { n: nombre(n) })),
        el('button', { type: 'button', class: 'sy-btn', 'data-f': 'c-biblio', onclick: () => { void montrer('biblio'); } }, mot('retour')))] : []));
      rendreFocus(garde);
    }
    let minuteur = 0;
    const visible = () => { if (!wrap.isConnected) return false; for (let x = wrap; x; x = x.parentNode) if (x.hidden) return false; return true; };
    function armer() {
      clearTimeout(minuteur); minuteur = 0;
      const f = C.file; if (!f || !(f.enCours || (Array.isArray(f.file) && f.file.length))) return;
      const tic = () => { minuteur = 0; if (!visible()) return; if (typeof document !== 'undefined' && document.hidden) { minuteur = setTimeout(tic, 3000); return; } void relire(); };
      minuteur = setTimeout(tic, 3000);
    }
    /** Ce qui change le dessin (pas l'avancement d'un téléchargement : lui se met à jour sur place). */
    const signature = () => JSON.stringify([C.erreur, (C.data && C.data.entrees || []).map((e) => [e.id, e.etat, e.presents, e.enFile, e.telecharge, e.versions, e.version, e.taille]),
      C.file && C.file.file, C.file && C.file.enCours && [C.file.enCours.source, C.file.enCours.version, Boolean(C.file.enCours.prepare)]]);
    let dessine = '';
    async function relire() {
      const [s, f] = await Promise.all([eitri('store', {}), eitri('file', {})]);
      if (s && s.ok !== false && s.data) {
        // Les versions lues pendant ce passage sont gardées (le serveur les garde aussi).
        const avant = C.data; C.data = s.data; C.erreur = '';
        if (avant) for (const e of C.data.entrees || []) { const a = (avant.entrees || []).find((x) => x.id === e.id); if (a && Array.isArray(a.versions) && !e.versions) e.versions = a.versions; }
      } else C.erreur = (s && s.text) || '?';
      C.file = f && f.ok !== false && f.data ? f.data : C.file;
      // Rien n'a changé sauf l'avancement : seul le pourcentage est réécrit, les cartes restent (ni clic perdu, ni focus bougé).
      const sig = signature(), e = C.file && C.file.enCours;
      if (sig === dessine && !C.msgNeuf) {
        const k = e && Array.from(corps.querySelectorAll('[data-ccarte]')).find((n) => n.getAttribute('data-ccarte') === e.source), t = k && k.querySelector('[data-f="c-cours"]');
        if (t && e.pct != null) t.lastChild && (t.lastChild.textContent = mot('c.cours', { pct: pct(e.pct) }));
      } else { dessine = sig; C.msgNeuf = false; rendre(); }
      armer();
    }
    rendre();
    await relire();
    if (focusDepart === 'retour') retour.focus && retour.focus();
  }

  W.OdinGeneseSystemes = { onglets: [['systemes', MOTS.onglet]], dessiner, MOTS, logique, etat: Z };
})();
