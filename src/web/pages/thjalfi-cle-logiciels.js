// Genèse · Clés USB — les étapes 4 et 5 du parcours de la maquette validée « Clés USB » (lot C3) :
//   - étape 4 « Logiciels et scripts » : un onglet par Windows ou Linux choisi à l'étape 3 ; les logiciels DÉJÀ
//     TÉLÉCHARGÉS par Odin, filtrés pour l'OS de l'onglet (action cle_logiciels), chacun marqué « tout seul » (installé
//     en silencieux à la fin) ou « te posera des questions » (copié sur la clé, mode silencieux inconnu) ; le script
//     créé tout seul, montré à côté et refait en direct à chaque choix (action cle_apercu_script, en lecture) ; tes
//     scripts (.ps1, .cmd, .bat, .sh) : ajouter, monter, descendre, voir, retirer. Chaque script passe d'abord par
//     l'antivirus d'Odin (dans cle_apercu_script) : refusé, il est montré avec la raison et n'entre pas dans le script ;
//   - étape 5 « Options Windows » (seulement si un Windows est choisi) : sans les exigences matérielles, compte local
//     (son nom ; le mot de passe n'est jamais écrit sur la clé), sans les questions de confidentialité, langue / clavier
//     / fuseau d'Odin, la clé d'activation prise dans le coffre (4 derniers caractères montrés, jamais plus) ou aucune,
//     et le disque du PC choisi au moment d'installer (Odin n'efface jamais seul un disque).
// Rien ici n'écrit sur un disque, et aucun script n'est exécuté : un script ajouté est lu comme du TEXTE, gardé dans la
// page, envoyé seulement pour être vérifié et montré, et toujours affiché comme texte (jamais comme du code de page).
// Tous les textes sont dans MOTS ; nombres selon la langue de la page (Intl).
// Expose window.OdinGeneseCleLogiciels = { MOTS, logique, rendre(n, outils), aWindows(), pret5(), pourComposeur(systemes), etat }.
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    'log.titre': 'Logiciels et scripts',
    'log.lead': 'Copiés sur la clé et installés tout seuls à la fin de chaque installation. Un script est créé pour Windows, un autre pour Linux.',
    'log.aucun': 'Aucun Windows ni Linux choisi : rien à installer à la fin.',
    'log.onglets': 'Système',
    'log.pour': 'Logiciels pour {nom}',
    'log.charge': 'Odin cherche les logiciels déjà téléchargés…',
    'log.erreur': 'Odin n\'a pas pu lire les logiciels : {raison}',
    'log.vide.windows': 'Aucun logiciel pour Windows déjà téléchargé. Télécharge-les d\'abord : ils apparaîtront ici.',
    'log.vide.linux': 'Aucun logiciel pour Linux déjà téléchargé. Télécharge-les d\'abord : ils apparaîtront ici.',
    'log.filtre.windows': 'Seuls les logiciels déjà téléchargés par Odin sont proposés, filtrés pour Windows.',
    'log.filtre.linux': 'Seuls les logiciels déjà téléchargés par Odin sont proposés, filtrés pour Linux.',
    'log.seul': 'tout seul',
    'log.questions': 'te posera des questions',
    'log.version': 'version {v}',
    'apercu.titre': 'Script créé tout seul',
    'apercu.fichiers': 'Fichier montré',
    'apercu.calcul': 'Odin refait le script…',
    'apercu.erreur': 'Odin n\'a pas pu montrer le script : {raison}',
    'apercu.rien': 'Le script apparaît ici dès qu\'un choix est fait.',
    'apercu.note': 'Rien n\'est encore écrit : c\'est ce qu\'Odin posera sur la clé.',
    'scr.titre': 'Tes scripts',
    'scr.ajouter.windows': 'Ajouter un script (.ps1, .cmd, .bat)',
    'scr.ajouter.linux': 'Ajouter un script (.sh)',
    'scr.choisir': 'Choisir un script à ajouter',
    'scr.note': 'Chaque script est montré avant d\'être écrit et passe par l\'antivirus d\'Odin, qui refuse les commandes dangereuses connues (effacer un disque, télécharger puis lancer, couper l\'antivirus ou le pare-feu, ajouter un administrateur) et leurs déguisements habituels. C\'est un filet, pas une garantie : relis toujours ton script. Odin ne le lance jamais lui-même.',
    'scr.sous.windows': 'Windows · lancé à la fin, après les logiciels',
    'scr.sous.linux': 'Linux · lancé à la fin, après les logiciels',
    'scr.verif': 'L\'antivirus d\'Odin le vérifie…',
    'scr.refuse': 'Refusé',
    'scr.monter': 'Monter {nom}',
    'scr.descendre': 'Descendre {nom}',
    'scr.voir': 'Voir {nom}',
    'scr.cacher': 'Cacher {nom}',
    'scr.retirer': 'Retirer {nom}',
    'scr.mauvais': '« {nom} » n\'est pas un script pour {os} : choisis un fichier {ext}.',
    'scr.gros': '« {nom} » est trop gros (64 Ko au plus).',
    'scr.illisible': 'Odin n\'a pas pu lire « {nom} ».',
    'scr.trop': 'Vingt scripts au plus.',
    'scr.aucun': 'Aucun script pour l\'instant.',
    'aide.verif': 'Odin vérifie encore tes scripts.',
    'win.titre': 'Options Windows',
    'win.lead': 'Pour chaque Windows de la clé. Tout est écrit dans le fichier de réponses, montré avant d\'écrire.',
    'win.exigences': 'Sans les exigences matérielles',
    'win.exigences.texte': 'Installe même sans puce TPM 2.0, sans démarrage sécurisé et avec moins de 4 Go de mémoire.',
    'win.local': 'Compte local, sans compte en ligne',
    'win.local.texte': 'Aucun compte en ligne n\'est demandé ; le compte est créé sur le PC.',
    'win.compte': 'Nom du compte',
    'win.compte.defaut': 'Utilisateur',
    'win.compte.aide': 'Le mot de passe est demandé à la première ouverture de session, jamais écrit sur la clé.',
    'win.compte.faux': 'De 1 à 20 caractères, sans " / \\ [ ] : ; | = , + * ? < > @ %, et sans point à la fin.',
    'win.vie': 'Sans les questions de confidentialité',
    'win.vie.texte': 'Les écrans « données de diagnostic, publicité, localisation » sont passés, tout réglé au plus discret.',
    'win.langue': 'Langue, clavier et fuseau d\'Odin',
    'win.langue.texte': 'Repris des réglages d\'installation d\'Odin.',
    'win.act': 'Clé d\'activation',
    'win.act.coffre': 'Celle du coffre ({cle})',
    'win.act.edition': '{edition} ({cle})',
    'win.act.aucune': 'Aucune : sans activation',
    'win.act.charge': 'Odin regarde le coffre…',
    'win.act.vide': 'Aucune clé dans le coffre : Windows s\'installe sans activation. Tu peux en déposer une dans les réglages de Genèse.',
    'win.act.note': 'Seuls les 4 derniers caractères sont montrés ; la clé reste chiffrée dans le coffre.',
    'win.disque': 'Sur quel disque du PC ?',
    'win.disque.choisir': 'Je choisis au moment d\'installer',
    'win.disque.note': 'Odin n\'efface jamais seul un disque qui contient déjà un système.',
    'aide.compte': 'Donne un nom de compte valable.',
  };
  const mot = (k, v) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_m, x) => (v && v[x] != null ? String(v[x]) : ''));

  // ---------------------------------------------------------------- la logique (pure)
  /** Au plus : 20 scripts de 64 Ko (même limite que le serveur). */
  const MAX_SCRIPTS = 20, MAX_OCTETS = 64 * 1024;
  const langue = () => { try { return (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || undefined; } catch { return undefined; } };
  const nombre = (n, lang) => { try { return new Intl.NumberFormat(lang).format(n); } catch { return String(n); } };
  /** Un texte venu d'un fichier, sans caractères de contrôle ni invisibles. */
  const propre = (x) => String(x == null ? '' : x).replace(/[\p{Cc}\p{Cf}]+/gu, '').trim();
  /** L'OS d'un script d'après son extension (même règle que scripts.ts). */
  function osDuScript(nom) {
    const e = (/\.([a-z0-9]+)$/i.exec(String(nom || '')) || [])[1];
    const x = String(e || '').toLowerCase();
    return ['ps1', 'cmd', 'bat'].includes(x) ? 'windows' : x === 'sh' ? 'linux' : undefined;
  }
  /** Même règle que le serveur (scripts.ts nomCompteValide). */
  const nomCompteValide = (nom) => { const n = String(nom == null ? '' : nom).trim(); return n.length >= 1 && n.length <= 20 && !/["/\\[\]:;|=,+*?<>@%\p{Cc}\p{Cf}\p{Cs}\p{Co}￾￿]/u.test(n) && !/\.$/.test(n); };
  /** Les systèmes de l'étape 3 qui reçoivent des logiciels : les Windows et les Linux (pas les outils, ni les VM). */
  function systemesLog(entrees) {
    return (Array.isArray(entrees) ? entrees : []).filter((e) => e && (e.famille === 'windows' || e.famille === 'linux'))
      .map((e) => ({ id: String(e.id), nom: propre(e.nom), famille: e.famille, fichier: propre(e.fichier), couleur: e.couleur, lettre: e.lettre }));
  }
  /** Ajouter ou retirer un logiciel coché pour un système (par son fichier). Pur. */
  function basculerLogiciel(coches, l) {
    const liste = Array.isArray(coches) ? coches : [];
    return liste.some((x) => x.fichier === l.fichier) ? liste.filter((x) => x.fichier !== l.fichier) : [...liste, { id: l.id, fichier: l.fichier, nom: l.nom, silencieux: Boolean(l.silencieux) }];
  }
  /** Déplacer un script d'un cran parmi ceux du même OS (l'ordre des autres ne bouge pas). Pur. */
  function deplacer(scripts, uid, pas) {
    const l = [...scripts], i = l.findIndex((x) => x.uid === uid);
    if (i < 0) return l;
    const os = l[i].os;
    let j = i + pas;
    while (j >= 0 && j < l.length && l[j].os !== os) j += pas;
    if (j < 0 || j >= l.length) return l;
    [l[i], l[j]] = [l[j], l[i]];
    return l;
  }
  /** Vérifier un fichier choisi AVANT de l'envoyer : extension de l'OS de l'onglet, taille. Rend le message d'erreur, ou rien. */
  function refusLocal(nom, octets, os, nb) {
    if (nb >= MAX_SCRIPTS) return mot('scr.trop');
    if (osDuScript(nom) !== os) return mot('scr.mauvais', { nom: propre(nom), os: os === 'windows' ? 'Windows' : 'Linux', ext: os === 'windows' ? '.ps1, .cmd, .bat' : '.sh' });
    if (Number(octets) > MAX_OCTETS) return mot('scr.gros', { nom: propre(nom) });
    return '';
  }
  /** La demande d'aperçu d'un système (ce qui part au serveur) : seulement ses logiciels, ses scripts, les options Windows. */
  function demande(sys, coches, scripts, win) {
    return {
      systeme: { famille: sys.famille, nom: sys.nom, fichier: sys.fichier },
      logiciels: (coches || []).map((l) => ({ id: l.id, fichier: l.fichier })),
      scripts: (scripts || []).filter((x) => x.os === (sys.famille === 'windows' ? 'windows' : 'linux')).map((x) => ({ nom: x.nom, contenu: x.contenu })),
      windows: { exigences: win.exigences, local: win.local, compte: win.compte, viePrivee: win.viePrivee, langue: win.langue, activation: win.activation, disque: win.disque },
    };
  }
  /** Les fichiers à montrer dans l'aperçu : le script de fin (Windows) ou les réponses d'installation (Linux). Les scripts
   *  ajoutés se voient à part, meta-data n'apprend rien, et le fichier de réponses Windows est montré à l'étape « Vérifier ». */
  const fichiersMontres = (fichiers) => Object.keys(fichiers || {}).filter((k) => !k.startsWith('scripts/') && k !== 'meta-data' && k !== 'autounattend.xml');
  /** Le fichier montré d'abord : le script de fin pour Windows, les réponses d'installation pour Linux. */
  const fichierDefaut = (noms) => (noms.includes('apres.ps1') ? 'apres.ps1' : noms[0] || '');
  /** La clé masquée telle qu'elle est montrée : 4 derniers caractères seulement. */
  const cleMontree = (fin) => `••••${String(fin || '').slice(-4)}`;

  const logique = { MOTS, mot, MAX_SCRIPTS, MAX_OCTETS, osDuScript, nomCompteValide, systemesLog, basculerLogiciel, deplacer, refusLocal, demande, fichiersMontres, fichierDefaut, cleMontree };

  // ---------------------------------------------------------------- l'état (gardé quand on change d'étape)
  const Z = {
    onglet: '', coches: {}, dispo: { windows: { etat: 'rien', liste: [], raison: '' }, linux: { etat: 'rien', liste: [], raison: '' } },
    scripts: [], voir: '', msg: '', annonce: '', apercu: {}, vu: {}, enVol: false, refaire: false, uid: 0,
    win: { exigences: true, local: true, compte: mot('win.compte.defaut'), viePrivee: true, langue: true, activation: '', disque: 'choisir' },
    coffre: { etat: 'rien', cles: [], auto: null, sig: '' },
  };
  let O = null; // { cle, sorte, post, redessiner, pied, wrap }
  /** Les systèmes choisis à l'étape 3 (lot C2), Windows et Linux seulement. */
  function systemes() {
    const s = W.OdinGeneseCleSystemes;
    if (!s || !s.logique || !s.etat) return [];
    const l = s.logique.entrees(s.etat.biblio && s.etat.biblio.liste, s.etat.vmsL && s.etat.vmsL.liste, s.etat.vms);
    return systemesLog(s.logique.choisisValides(s.etat.choisis, l));
  }
  const aWindows = () => systemes().some((x) => x.famille === 'windows');
  /** Les OS (windows, linux) des systèmes choisis : un script d'un OS retiré à l'étape 3 n'attend plus rien. */
  const osChoisis = () => new Set(systemes().map((x) => (x.famille === 'windows' ? 'windows' : 'linux')));
  const enVerif = () => { const os = osChoisis(); return Z.scripts.some((x) => x.etat === 'verif' && os.has(x.os)); };
  /** L'étape 5 peut être quittée : le nom du compte local est valable. */
  const pret5 = () => !Z.win.local || nomCompteValide(Z.win.compte);

  // ------------------------------------------------ lectures (aucune écriture)
  const raisonDe = (r, e) => String((r && r.text) || (e && e.message) || e || '?');
  async function chargerLogiciels(os) {
    if (!O || Z.dispo[os].etat === 'charge') return;
    Z.dispo[os] = { ...Z.dispo[os], etat: 'charge' };
    let r, e;
    try { r = await O.post('cle_logiciels', { os }); } catch (x) { e = x; }
    const l = r && r.data && Array.isArray(r.data.logiciels) ? r.data.logiciels : null;
    Z.dispo[os] = r && r.ok !== false && l ? { etat: 'pret', liste: l.filter((x) => x && typeof x === 'object' && x.fichier), raison: '' } : { etat: 'erreur', liste: [], raison: raisonDe(r, e) };
    if (O) O.redessiner();
  }
  /** L'aperçu du système montré : une seule demande à la fois, refaite si les choix ont changé entre-temps. */
  async function rafraichir() {
    if (!O) return;
    if (Z.enVol) { Z.refaire = true; return; }
    Z.enVol = true;
    try {
      do {
        Z.refaire = false;
        const sys = systemes().find((x) => x.id === Z.onglet);
        if (!sys) break;
        const q = demande(sys, Z.coches[sys.id], Z.scripts, Z.win), sig = JSON.stringify(q);
        if (Z.apercu[sys.id] && Z.apercu[sys.id].sig === sig && Z.apercu[sys.id].etat === 'pret') break;
        Z.apercu[sys.id] = { ...(Z.apercu[sys.id] || {}), etat: 'calcul', sig };
        let r, e;
        try { r = await O.post('cle_apercu_script', q); } catch (x) { e = x; }
        const d = r && r.data;
        if (r && r.ok !== false && d && d.fichiers && typeof d.fichiers === 'object') {
          Z.apercu[sys.id] = { etat: 'pret', sig, fichiers: d.fichiers };
          noterVerdicts(q.scripts, d.scripts);
          noterCoffre(d, sys);
        } else Z.apercu[sys.id] = { etat: 'erreur', sig, raison: raisonDe(r, e) };
        if (O) O.redessiner();
      } while (Z.refaire);
    } finally { Z.enVol = false; }
  }
  /** Les verdicts de l'antivirus, rangés sur les scripts envoyés (même ordre, même nom, même contenu). */
  function noterVerdicts(envoyes, verdicts) {
    if (!Array.isArray(verdicts)) return;
    envoyes.forEach((x, k) => {
      const v = verdicts[k], s = Z.scripts.find((y) => y.etat === 'verif' && y.nom === x.nom && y.contenu === x.contenu);
      if (!s || !v || v.nom !== x.nom) return;
      s.etat = v.ok ? 'ok' : 'refuse'; s.raison = v.ok ? '' : propre(v.raison);
      Z.annonce = v.ok ? '' : `${s.nom} : ${s.raison}`;
    });
  }
  /** Les clés du coffre (indices seulement) et celle reconnue pour l'image, vues par l'aperçu d'un Windows. */
  function noterCoffre(d, sys) {
    if (sys.famille !== 'windows') return;
    const cles = Array.isArray(d.cles) ? d.cles.filter((c) => c && c.id).map((c) => ({ id: String(c.id), edition: propre(c.edition), fin: String(c.fin || '').slice(-4) })) : [];
    const ed = d.edition && d.edition.id ? String(d.edition.id) : '';
    Z.coffre = { etat: 'pret', cles, auto: ed && cles.find((c) => c.id === ed) ? ed : null, sig: sys.id };
  }

  // ------------------------------------------------ actions
  function changer(focus) { void rafraichir(); if (O) O.redessiner(focus); }
  function prendreOnglet(id) { if (Z.onglet === id) return; Z.onglet = id; Z.msg = ''; changer(`ong-${id}`); }
  function cocher(sys, l) { Z.coches = { ...Z.coches, [sys.id]: basculerLogiciel(Z.coches[sys.id], l) }; changer(`sw-${l.fichier}`); }
  /** Ajouter un script lu dans un fichier : vérifié ici (extension, taille), puis par l'antivirus d'Odin (cle_apercu_script). */
  function ajouterScript(nom, contenu, os) {
    const octets = typeof TextEncoder === 'function' ? new TextEncoder().encode(String(contenu)).length : String(contenu).length;
    const refus = refusLocal(nom, octets, os, Z.scripts.length);
    if (refus) { Z.msg = refus; if (O) O.redessiner('scr-ajouter'); return false; }
    Z.msg = '';
    Z.scripts = [...Z.scripts, { uid: `s${++Z.uid}`, nom: propre(String(nom).split(/[\\/]/).pop()), contenu: String(contenu), os, etat: 'verif', raison: '' }];
    changer('scr-ajouter');
    return true;
  }
  async function lireFichier(input, os) {
    const f = input && input.files && input.files[0];
    if (!f) return;
    try { input.value = ''; } catch { /* rien */ }
    const nom = propre(f.name);
    if (Number(f.size) > MAX_OCTETS) { Z.msg = mot('scr.gros', { nom }); if (O) O.redessiner('scr-ajouter'); return; }
    let t;
    try { t = typeof f.text === 'function' ? await f.text() : ''; } catch { Z.msg = mot('scr.illisible', { nom }); if (O) O.redessiner('scr-ajouter'); return; }
    ajouterScript(nom, t, os);
  }
  function retirerScript(uid) { Z.scripts = Z.scripts.filter((x) => x.uid !== uid); if (Z.voir === uid) Z.voir = ''; changer('scr-ajouter'); }
  function bouger(uid, pas) { Z.scripts = deplacer(Z.scripts, uid, pas); changer(`scr-${pas < 0 ? 'up' : 'down'}-${uid}`); }
  function regler(k, v, focus) { Z.win = { ...Z.win, [k]: v }; Z.apercu = {}; changer(focus); }

  // ---------------------------------------------------------------- la page
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  };
  const P = { plus: 'M12 5v14M5 12h14', check: 'M5 12l5 5L20 7', up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', warn: 'M12 4l9 16H3zM12 10v4M12 17h.01' };
  const ic = (n, s = 18, w = 2) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };
  /** Une couleur stable par nom de logiciel (une forme, aucun logo). */
  const teinte = (nom) => { let h = 0; for (const c of String(nom)) h = (h * 31 + c.codePointAt(0)) % 360; return `hsl(${h} 52% 40%)`; };

  const CSS = `
.ckl-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}
.ckl-tab{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel);font-family:inherit;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;gap:8px}
.ckl-tab[aria-selected=true]{background:color-mix(in srgb,var(--accent) 14%,var(--panel));color:var(--ink);border-color:var(--accent)}
.ckl-split{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px}
.ckl-split>div{min-width:0}
.ckl-sw{display:flex;align-items:center;gap:12px;min-height:52px;padding:6px 10px;border-radius:12px;border:1px solid transparent;width:100%;text-align:left;background:none;color:var(--ink);font:inherit;cursor:pointer}
.ckl-sw:hover{background:color-mix(in srgb,var(--ink) 5%,transparent)}
.ckl-sw .box{width:24px;height:24px;border-radius:7px;border:2px solid var(--line);display:grid;place-items:center;flex:none}
.ckl-sw[aria-checked=true] .box{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}
.ckl-sw .swi{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-weight:800;font-size:13px;color:#fff;flex:none}
.ckl-sw .nm{flex:1;min-width:0}.ckl-sw .nm b{display:block;font-size:14px;font-weight:600;overflow-wrap:anywhere}.ckl-sw .nm small{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.ckl-tag{font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap;flex:none}
.ckl-tag.ok{background:color-mix(in srgb,var(--good) 16%,transparent);color:var(--good)}
.ckl-tag.warn{background:color-mix(in srgb,var(--warn) 18%,transparent);color:color-mix(in srgb,var(--warn) 70%,var(--ink))}
.ckl-tag.bad{background:color-mix(in srgb,var(--bad) 14%,transparent);color:var(--bad)}
.ckl-note{margin:8px 0 0;font-size:12.5px;color:var(--muted)}
.ckl-files{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 6px}
.ckl-files button{min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:none;font:600 12px ui-monospace,Consolas,monospace;color:var(--muted);cursor:pointer}
.ckl-files button[aria-pressed=true]{background:color-mix(in srgb,var(--accent) 14%,var(--panel));color:var(--ink);border-color:var(--accent)}
.ckl-code{font:12px/1.55 ui-monospace,Consolas,monospace;background:color-mix(in srgb,var(--ink) 6%,var(--panel));color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:12px;overflow:auto;max-height:260px;white-space:pre;margin:0}
.ckl-code:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ckl-scr{display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;border:1px solid var(--line);margin-top:8px;flex-wrap:wrap}
.ckl-scr.refuse{border-color:var(--bad)}
.ckl-scr .ord{display:flex;gap:4px}
.ckl-ib{width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);display:grid;place-items:center;flex:none;cursor:pointer;padding:0}
.ckl-ib:disabled{opacity:.4;cursor:not-allowed}
.ckl-scr .nm{flex:1;min-width:120px}.ckl-scr .nm b{display:block;font-size:13.5px;overflow-wrap:anywhere}.ckl-scr .nm small{display:block;color:var(--muted);font-size:12px}
.ckl-scr .nm small.ko{color:var(--bad);font-weight:600}
.ckl-scr pre{flex-basis:100%}
.ckl-add{margin-top:10px;width:100%}
.ckl-opt{display:flex;gap:14px;align-items:center;padding:12px 4px;border-top:1px solid var(--line);width:100%;text-align:left;background:none;color:var(--ink);font:inherit;cursor:pointer;min-height:44px;border-left:0;border-right:0;border-bottom:0}
.ckl-opt:first-of-type{border-top:0}
.ckl-opt .tx{flex:1;min-width:0}.ckl-opt .tx b{display:block;font-size:14px;font-weight:600}.ckl-opt .tx small{display:block;font-size:12.5px;color:var(--muted)}
.ckl-tg{width:52px;height:32px;border-radius:999px;background:color-mix(in srgb,var(--ink) 18%,transparent);position:relative;flex:none;transition:background .2s}
.ckl-tg::after{content:"";position:absolute;top:4px;left:4px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .2s}
.ckl-opt[aria-checked=true] .ckl-tg{background:var(--good)}.ckl-opt[aria-checked=true] .ckl-tg::after{left:24px}
.ckl-field{margin:0 0 10px 4px;max-width:360px;display:flex;flex-direction:column;gap:6px}
.ckl-field label{font-size:13px;font-weight:600}
.ckl-field input{min-height:44px;box-sizing:border-box;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:0 12px;font-family:inherit;font-size:14px}
.ckl-field input[aria-invalid=true]{border-color:var(--bad)}
.ckl-field small{font-size:12px;color:var(--muted)}.ckl-field small.ko{color:var(--bad);font-weight:600}
.ckl-seg{display:flex;gap:6px;flex-wrap:wrap}
.ckl-seg button{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);font-family:inherit;font-size:13px;font-weight:600;color:var(--ink);cursor:pointer}
.ckl-seg button[aria-pressed=true]{background:color-mix(in srgb,var(--accent) 14%,var(--panel));border-color:var(--accent)}
@media (max-width:640px){
  .ckl-split{grid-template-columns:minmax(0,1fr)}
  .ckl-sw .ckl-tag{white-space:normal;text-align:center;max-width:96px}
  .ckl-scr .nm{flex-basis:100%;order:-1}
  .ckl-scr .ord{margin-right:auto}
  .ckl-seg button{flex:1 1 100%}
}
@media (prefers-reduced-motion:reduce){.ckl-tg,.ckl-tg::after{transition:none}}
`;

  function suivant(i, n, touche) {
    const f = W.OdinGeneseCleEtapes && W.OdinGeneseCleEtapes.logique && W.OdinGeneseCleEtapes.logique.suivant;
    if (typeof f === 'function') return f(i, n, touche);
    const pas = touche === 'ArrowRight' || touche === 'ArrowDown' ? 1 : touche === 'ArrowLeft' || touche === 'ArrowUp' ? -1 : 0;
    if (touche === 'Home') return 0; if (touche === 'End') return n - 1;
    return pas ? (i + pas + n) % n : -1;
  }
  const h5 = (texte, n) => el('div', { class: 'ck-h5' }, texte, n == null ? null : el('span', { class: 'ck-cnt' }, nombre(n, langue())));

  function blocLogiciels(sys) {
    const os = sys.famille === 'windows' ? 'windows' : 'linux', d = Z.dispo[os], coches = Z.coches[sys.id] || [];
    if (d.etat === 'rien') void chargerLogiciels(os);
    const kids = [h5(mot('log.pour', { nom: sys.nom }), coches.length)];
    if (d.etat === 'charge' || d.etat === 'rien') kids.push(el('p', { class: 'ck-msg', role: 'status' }, mot('log.charge')));
    else if (d.etat === 'erreur') kids.push(el('p', { class: 'ck-msg ko', role: 'alert' }, mot('log.erreur', { raison: d.raison })));
    else if (!d.liste.length) kids.push(el('p', { class: 'ck-msg', role: 'status' }, mot(`log.vide.${os}`)));
    else {
      kids.push(el('div', { role: 'group', 'aria-label': mot('log.pour', { nom: sys.nom }) }, ...d.liste.map((l) => {
        const pris = coches.some((x) => x.fichier === l.fichier), nom = propre(l.nom) || propre(l.fichier);
        return el('button', { type: 'button', class: 'ckl-sw', role: 'checkbox', 'aria-checked': String(pris), 'data-f': `sw-${l.fichier}`, 'data-sw': propre(l.fichier), onclick: () => cocher(sys, l) },
          el('span', { class: 'box' }, pris ? ic('check', 14, 3) : null),
          el('span', { class: 'swi', style: `background:${teinte(nom)}`, 'aria-hidden': 'true' }, nom.slice(0, 2)),
          el('span', { class: 'nm' }, el('b', {}, nom), el('small', {}, l.version ? `${propre(l.fichier)} · ${mot('log.version', { v: propre(l.version) })}` : propre(l.fichier))),
          el('span', { class: `ckl-tag ${l.silencieux ? 'ok' : 'warn'}` }, mot(l.silencieux ? 'log.seul' : 'log.questions')));
      })));
    }
    kids.push(el('p', { class: 'ckl-note' }, mot(`log.filtre.${os}`)));
    return el('div', {}, ...kids);
  }
  function blocApercu(sys) {
    const a = Z.apercu[sys.id];
    const kids = [h5(mot('apercu.titre'))];
    if (a && a.etat === 'pret') {
      const noms = fichiersMontres(a.fichiers);
      if (!noms.includes(Z.vu[sys.id])) Z.vu[sys.id] = fichierDefaut(noms);
      const vu = Z.vu[sys.id];
      if (noms.length > 1) kids.push(el('div', { class: 'ckl-files', role: 'group', 'aria-label': mot('apercu.fichiers') }, ...noms.map((n) => el('button', { type: 'button', 'aria-pressed': String(n === vu), 'data-f': `fic-${n}`, 'data-fic': n, onclick: () => { Z.vu[sys.id] = n; O.redessiner(`fic-${n}`); } }, n))));
      // Le script est montré comme du TEXTE (textContent) : jamais interprété par la page.
      const pre = el('pre', { class: 'ckl-code', tabindex: '0', 'aria-label': vu, 'data-apercu': vu });
      pre.textContent = String(a.fichiers[vu] ?? '');
      kids.push(pre, el('p', { class: 'ckl-note' }, mot('apercu.note')));
    } else if (a && a.etat === 'erreur') kids.push(el('p', { class: 'ck-msg ko', role: 'alert' }, mot('apercu.erreur', { raison: a.raison })));
    else kids.push(el('p', { class: 'ck-msg', role: 'status' }, mot(a ? 'apercu.calcul' : 'apercu.rien')));
    return kids;
  }
  function blocScripts(sys) {
    const os = sys.famille === 'windows' ? 'windows' : 'linux', miens = Z.scripts.filter((x) => x.os === os);
    const kids = [h5(mot('scr.titre'), miens.length)];
    if (!miens.length) kids.push(el('p', { class: 'ckl-note', style: 'margin:0' }, mot('scr.aucun')));
    miens.forEach((x, k) => {
      const ligne = el('div', { class: `ckl-scr${x.etat === 'refuse' ? ' refuse' : ''}`, 'data-scr': x.nom },
        el('span', { class: 'ord' },
          el('button', { type: 'button', class: 'ckl-ib', 'data-f': `scr-up-${x.uid}`, 'aria-label': mot('scr.monter', { nom: x.nom }), disabled: k === 0, onclick: () => bouger(x.uid, -1) }, ic('up', 16)),
          el('button', { type: 'button', class: 'ckl-ib', 'data-f': `scr-down-${x.uid}`, 'aria-label': mot('scr.descendre', { nom: x.nom }), disabled: k === miens.length - 1, onclick: () => bouger(x.uid, 1) }, ic('down', 16))),
        el('span', { class: 'nm' }, el('b', {}, x.nom),
          x.etat === 'refuse' ? el('small', { class: 'ko' }, x.raison) : el('small', {}, x.etat === 'verif' ? mot('scr.verif') : mot(`scr.sous.${os}`))),
        x.etat === 'refuse' ? el('span', { class: 'ckl-tag bad' }, mot('scr.refuse')) : null,
        el('button', { type: 'button', class: 'ckl-ib', 'data-f': `scr-voir-${x.uid}`, 'aria-expanded': String(Z.voir === x.uid), 'aria-label': mot(Z.voir === x.uid ? 'scr.cacher' : 'scr.voir', { nom: x.nom }), onclick: () => { Z.voir = Z.voir === x.uid ? '' : x.uid; O.redessiner(`scr-voir-${x.uid}`); } }, ic('eye')),
        el('button', { type: 'button', class: 'ckl-ib', 'data-f': `scr-rm-${x.uid}`, 'aria-label': mot('scr.retirer', { nom: x.nom }), onclick: () => retirerScript(x.uid) }, ic('trash')));
      if (Z.voir === x.uid) { const pre = el('pre', { class: 'ckl-code', tabindex: '0', 'aria-label': x.nom }); pre.textContent = x.contenu; ligne.append(pre); }
      kids.push(ligne);
    });
    const choix = el('input', { type: 'file', accept: os === 'windows' ? '.ps1,.cmd,.bat' : '.sh', 'aria-label': mot('scr.choisir'), tabindex: '-1', 'data-f': 'scr-fichier', style: 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none', onchange: (e) => lireFichier(e.currentTarget || e.target, os) });
    kids.push(choix, el('button', { type: 'button', class: 'ck-btn ckl-add', 'data-f': 'scr-ajouter', disabled: Z.scripts.length >= MAX_SCRIPTS, onclick: () => { if (typeof choix.click === 'function') choix.click(); } }, ic('plus'), mot(`scr.ajouter.${os}`)));
    if (Z.msg) kids.push(el('p', { class: 'ck-msg ko', role: 'alert', style: 'margin:8px 0 0' }, Z.msg));
    // Le verdict de l'antivirus est dit une fois (région polie), pas répété à chaque redessin.
    kids.push(el('p', { class: 'ckl-note', role: 'status', 'aria-live': 'polite', 'data-f': 'scr-annonce', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);margin:0' }, Z.annonce || ''));
    kids.push(el('p', { class: 'ckl-note' }, mot('scr.note')));
    return kids;
  }
  function etapeLogiciels() {
    const sys = systemes();
    const suite = aWindows() ? 5 : 6;
    if (!sys.length) return [el('section', { class: 'ck-card' }, el('h4', {}, mot('log.titre')), el('p', { class: 'ck-lead', style: 'margin:0' }, mot('log.aucun'))), O.pied(3, suite, false, '')];
    if (!sys.some((x) => x.id === Z.onglet)) Z.onglet = sys[0].id;
    const cur = sys.find((x) => x.id === Z.onglet);
    if (!Z.apercu[cur.id] || Z.apercu[cur.id].sig !== JSON.stringify(demande(cur, Z.coches[cur.id], Z.scripts, Z.win))) void rafraichir();
    const tabs = el('div', { class: 'ckl-tabs', role: 'tablist', 'aria-label': mot('log.onglets') }, ...sys.map((x, i) => el('button', {
      type: 'button', class: 'ckl-tab', role: 'tab', id: `ckl-tab-${x.id}`, 'aria-selected': String(x.id === cur.id), 'aria-controls': 'ckl-panneau', tabindex: x.id === cur.id ? '0' : '-1', 'data-f': `ong-${x.id}`, 'data-ong': x.id,
      onclick: () => prendreOnglet(x.id),
      onkeydown: (e) => { const j = suivant(i, sys.length, e.key); if (j < 0) return; e.preventDefault(); prendreOnglet(sys[j].id); },
    }, x.nom, el('span', { class: 'ck-cnt' }, nombre((Z.coches[x.id] || []).length, langue())))));
    const sec = el('section', { class: 'ck-card' }, el('h4', {}, mot('log.titre')), el('p', { class: 'ck-lead' }, mot('log.lead')), tabs,
      el('div', { class: 'ckl-split', id: 'ckl-panneau', role: 'tabpanel', 'aria-labelledby': `ckl-tab-${cur.id}` }, blocLogiciels(cur), el('div', {}, ...blocApercu(cur), ...blocScripts(cur))));
    return [sec, O.pied(3, suite, enVerif(), enVerif() ? mot('aide.verif') : '')];
  }

  function interrupteur(k, titre, texte) {
    return el('button', { type: 'button', class: 'ckl-opt', role: 'switch', 'aria-checked': String(Boolean(Z.win[k])), 'data-f': `win-${k}`, 'data-win': k, onclick: () => regler(k, !Z.win[k], `win-${k}`) },
      el('span', { class: 'tx' }, el('b', {}, titre), el('small', {}, texte)), el('span', { class: 'ckl-tg', 'aria-hidden': 'true' }));
  }
  function etapeWindows() {
    const win = systemes().filter((x) => x.famille === 'windows');
    // Le coffre est lu par l'aperçu d'un Windows (indices seulement) : demandé si ce n'est pas déjà fait.
    if (win.length && Z.coffre.etat === 'rien') { Z.coffre = { ...Z.coffre, etat: 'charge' }; if (!win.some((x) => x.id === Z.onglet)) Z.onglet = win[0].id; void rafraichir(); }
    const ok = nomCompteValide(Z.win.compte);
    const kids = [el('h4', {}, mot('win.titre')), el('p', { class: 'ck-lead' }, mot('win.lead')),
      interrupteur('exigences', mot('win.exigences'), mot('win.exigences.texte')),
      interrupteur('local', mot('win.local'), mot('win.local.texte'))];
    if (Z.win.local) {
      const champ = el('input', { id: 'ckl-compte', 'data-f': 'win-compte', autocomplete: 'off', spellcheck: 'false', maxlength: '20', 'aria-invalid': String(!ok), 'aria-describedby': 'ckl-compte-aide',
        oninput: (e) => { const n = e.currentTarget || e.target; Z.win = { ...Z.win, compte: String(n && n.value != null ? n.value : '') }; Z.apercu = {}; const aide = O.wrap && O.wrap.querySelector ? O.wrap.querySelector('#ckl-compte-aide') : null; const bon = nomCompteValide(Z.win.compte); if (n && n.setAttribute) n.setAttribute('aria-invalid', String(!bon)); if (aide) { aide.textContent = bon ? mot('win.compte.aide') : mot('win.compte.faux'); aide.className = bon ? '' : 'ko'; } const c = O.wrap && O.wrap.querySelector ? O.wrap.querySelector('[data-f="continuer"]') : null; if (c) { if (bon) c.removeAttribute?.('disabled'); else c.setAttribute('disabled', ''); } } });
      champ.value = Z.win.compte;
      kids.push(el('div', { class: 'ckl-field' }, el('label', { for: 'ckl-compte' }, mot('win.compte')), champ, el('small', { id: 'ckl-compte-aide', class: ok ? null : 'ko' }, ok ? mot('win.compte.aide') : mot('win.compte.faux'))));
    }
    kids.push(interrupteur('viePrivee', mot('win.vie'), mot('win.vie.texte')), interrupteur('langue', mot('win.langue'), mot('win.langue.texte')));
    // La clé d'activation : celle du coffre reconnue pour l'image, ou une clé du coffre choisie, ou aucune.
    kids.push(h5(mot('win.act')));
    if (Z.coffre.etat !== 'pret') kids.push(el('p', { class: 'ck-msg', role: 'status' }, mot('win.act.charge')));
    else {
      const cles = Z.coffre.cles, auto = Z.coffre.auto;
      const pris = Z.win.activation === 'aucune' ? 'aucune' : Z.win.activation || auto || 'aucune';
      const boutons = auto
        ? [[auto, mot('win.act.coffre', { cle: cleMontree((cles.find((c) => c.id === auto) || {}).fin) })]]
        : cles.map((c) => [c.id, mot('win.act.edition', { edition: c.edition, cle: cleMontree(c.fin) })]);
      kids.push(el('div', { class: 'ckl-seg', role: 'group', 'aria-label': mot('win.act') }, ...[...boutons, ['aucune', mot('win.act.aucune')]].map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(pris === k), 'data-f': `act-${k}`, 'data-act': k, onclick: () => regler('activation', k, `act-${k}`) }, t))));
      kids.push(el('p', { class: 'ckl-note' }, cles.length ? mot('win.act.note') : mot('win.act.vide')));
    }
    // Une seule façon : le disque est choisi au moment d'installer (Odin n'efface jamais seul un disque).
    kids.push(h5(mot('win.disque')), el('div', { class: 'ckl-seg', role: 'group', 'aria-label': mot('win.disque') },
      el('button', { type: 'button', 'aria-pressed': 'true', 'data-f': 'dsq-choisir', 'data-dsq': 'choisir', onclick: () => regler('disque', 'choisir', 'dsq-choisir') }, mot('win.disque.choisir'))),
    el('p', { class: 'ckl-note' }, mot('win.disque.note')));
    return [el('section', { class: 'ck-card' }, ...kids), O.pied(4, 6, !pret5(), pret5() ? '' : mot('aide.compte'))];
  }

  /** Rend l'étape n (4 ou 5). outils : { cle, sorte, post, redessiner(focus), pied(avant, apres, ferme, aide), wrap }. */
  function rendre(n, outils) {
    if (typeof document !== 'undefined' && document.head && !document.getElementById?.('cklCss')) document.head.append(el('style', { id: 'cklCss' }, CSS));
    O = outils;
    return n === 5 ? etapeWindows() : etapeLogiciels();
  }
  /** Les systèmes composés (contrat SystemeCle), avec les logiciels cochés pour chacun, et les autres choix des étapes
   *  4 et 5 : tes scripts acceptés (dans l'ordre) et les options Windows (sans aucune clé : seulement l'édition voulue). */
  function pourComposeur(composes) {
    const sys = systemes();
    const systemesAvec = (Array.isArray(composes) ? composes : []).map((c) => {
      const e = sys.find((x) => x.fichier && x.fichier === c.fichier && x.nom === c.nom);
      const l = e ? Z.coches[e.id] || [] : [];
      return l.length ? { ...c, logiciels: l.map((x) => ({ ...x })) } : c;
    });
    return { systemes: systemesAvec, scripts: Z.scripts.filter((x) => x.etat === 'ok' && osChoisis().has(x.os)).map((x) => ({ nom: x.nom, os: x.os, contenu: x.contenu })), windows: aWindows() ? { ...Z.win } : null };
  }

  W.OdinGeneseCleLogiciels = { MOTS, logique, rendre, aWindows, pret5, pourComposeur, ajouterScript, etat: Z };
})();
