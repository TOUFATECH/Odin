// Genèse · Clés USB, onglet « Mes clés » (maquette validée « Clés USB », lot C5) : les clés ODIN connues, et pour la clé
// choisie : son contenu, l'ordre du menu au démarrage, l'entrée par défaut, ajouter ou retirer un système SANS effacer la
// clé, les changements en attente (appliqués tout de suite si elle est branchée, sinon au prochain branchement de CETTE
// clé), les mises à jour proposées (jamais faites seules) et « Relire la clé ».
//   - tout ce qui change est gardé par Odin (cle_changer) : la page ne fait que montrer et demander ;
//   - au clavier : tout est un vrai bouton ; les sous-onglets aux flèches ; une ligne du menu se range aussi avec
//     Alt + ↑ / ↓ (le focus suit la ligne) ; cibles de 44 px ; clair et sombre (variables du thème d'Odin) ;
//   - aucune fenêtre native du navigateur : OdinDialog seulement.
// Expose window.OdinGeneseCleGerer = { MOTS, logique, monter(wrap, outils) } ; l'onglet « Mes clés » du parcours
// (thjalfi-cle-etapes.js, via thjalfi-cle.js) le monte.
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;
  const MOTS = {
    titre: 'Mes clés ODIN',
    nouvelle: 'Préparer une nouvelle clé',
    aucune: 'Aucune clé ODIN connue pour l\'instant.',
    aucuneSuite: 'Branche une clé ODIN déjà faite : Odin la montre ici. Pour en faire une, passe par « Déployer ».',
    charge: 'Odin regarde les clés branchées…',
    erreur: 'Odin n\'a pas pu lire les clés : {raison}',
    branchee: 'Branchée', pasBranchee: 'Pas branchée',
    resumeBranchee: 'Branchée · {n} entrée(s) · {pris} sur {total}',
    resumeVue: 'Vue {quand} · {n} entrée(s)',
    leadBranchee: 'Les changements s\'appliquent sans effacer la clé : Odin ajoute, retire et range seulement ses propres fichiers.',
    leadPas: 'Tu peux préparer les changements : Odin les garde et les appliquera dès que CETTE clé sera branchée.',
    sousContenu: 'Contenu et ordre', sousMaj: 'Mises à jour', sousNom: 'Réglages de la clé',
    noteOrdre: 'L\'ordre ici est l\'ordre du menu au démarrage. Utilise les flèches, ou Alt + ↑ / ↓ sur une ligne.',
    monter: 'Monter {nom}', descendre: 'Descendre {nom}', parDefaut: '{nom} démarre seul', retirer: 'Retirer {nom}', garder: 'Garder {nom}',
    seraAjoute: 'Sera ajouté (ISO qui démarre)', seraRetire: 'Sera retiré', remplace: 'Remplacé par {nom}', nouvelleVersion: 'Nouvelle version de {nom}',
    defautApres: ' · démarre seul après {s} s', defautAttend: ' · par défaut (le menu attend qu\'on choisisse)',
    jamaisDefaut: ' · jamais par défaut : elle installe, ou Odin ne la connaît pas',
    mode: { installer: 'ISO qui s\'installe toute seule', essai: 'ISO à essayer', demarrer: 'ISO qui démarre' },
    choix: { installe: 'Installé sur la clé', persistance: 'ISO + mémoire', vm: 'Copie de machine virtuelle' },
    ajouter: 'Ajouter un système ou une ISO', fermerAjout: 'Fermer la liste',
    ajoutTitre: 'Les images prêtes de la bibliothèque', ajoutVide: 'Aucune autre image prête dans la bibliothèque d\'Odin.',
    ajoutNote: 'Une image ajoutée ici démarre telle quelle : rien ne s\'installe tout seul. Pour une installation automatique, passe par « Déployer ».',
    logiciels: 'Logiciels sur la clé', aucunLogiciel: 'Aucun logiciel copié sur cette clé.',
    attente: '{n} changement(s) en attente · la clé n\'est pas effacée',
    attenteRetrait: '{n} changement(s) en attente · seuls les fichiers des systèmes retirés seront effacés',
    arme: 'Ils seront appliqués dès que cette clé sera branchée, cette page ouverte, dans les 7 jours. Si tu changes quoi que ce soit, Odin te redemandera.',
    armePerime: 'Tu avais demandé de les appliquer au branchement il y a plus de 7 jours : Odin ne le fait plus tout seul. Relis-les, puis redemande-le.',
    annuler: 'Annuler', appliquer: 'Appliquer à la clé', appliquerPlusTard: 'Appliquer dès qu\'elle est branchée',
    confirmeRetrait: 'Odin va retirer de la clé « {cle} » : {liste}. Seuls leurs fichiers sont effacés ; le reste de la clé ne change pas. Continuer ?',
    avecMemoire: '{nom} (avec sa mémoire : ce que tu y as enregistré est effacé aussi)',
    enCours: 'Odin applique les changements : {etape} ({fait} sur {total}). Ne débranche pas la clé.',
    enRelecture: 'Odin relit la clé… Ne la débranche pas.',
    majTitre: 'Systèmes', majVersion: '{ancien} → {nouveau}', majVersionSous: 'Une version plus récente est dans la bibliothèque. L\'ancienne n\'est retirée qu\'une fois la nouvelle copiée.',
    proposer: 'Préparer', propose: 'Préparé',
    majAucune: 'Aucune version plus récente dans la bibliothèque.',
    menuTitre: 'Réglage du menu', menuAJour: 'À jour : il correspond à ce qu\'Odin écrirait aujourd\'hui.', menuAReecrire: 'Odin écrirait aujourd\'hui un menu un peu différent (ordre, noms, délai).', menuInconnu: 'Branche la clé pour comparer.', reecrire: 'Réécrire le menu',
    chargeurTitre: 'Chargeur de démarrage', chargeurSous: 'Gardé tel quel. Sa mise à jour se fera avec une clé de test, dans un lot à part.',
    santeTitre: 'Santé de la clé', relire: 'Relire', relireTitre: 'Relire toute la clé', relireJamais: 'Jamais relue par Odin.', relireBranche: 'Branche la clé pour la relire.',
    releve: 'Relue {quand} : {message}',
    aReconnaitre: 'Clé ODIN pas encore connue',
    aReconnaitreSous: 'Odin la retiendra par son numéro de série et par un identifiant qu\'il pose dans SON dossier sur la clé (un petit fichier, rien d\'autre ne change).',
    reconnaitre: 'La reconnaître',
    copie: 'Copie d\'une clé connue : Odin n\'y touche pas',
    copieSous: 'Elle porte l\'identifiant ODIN d\'une autre clé, mais pas son numéro de série. Pour la gérer, refais-la depuis « Déployer ».',
    illisible: 'Numéro de série illisible : seulement montrée',
    illisibleSous: 'Sans numéro de série lisible, Odin ne pourrait pas la reconnaître à coup sûr : il ne la change jamais.',
    partitionIllisible: 'La partition ODIN de cette clé n\'est pas lisible (pas ouverte ?).',
    incomplete: 'Écriture interrompue sur cette clé : elle ne démarre peut-être pas. Refais-la depuis « Déployer ».',
    serie: 'numéro de série {fin}',
    occ: { iso: 'ISO', installes: 'Systèmes installés', logiciels: 'Logiciels', memoire: 'Mémoire', libre: 'Libre' },
    il: { s: 'à l\'instant', m: 'il y a {n} min', h: 'il y a {n} h', j: 'il y a {n} jour(s)' },
    fait: 'Fait.',
  };
  const mot = (t, v) => String(t).replace(/\{(\w+)\}/g, (_m, x) => (v && v[x] != null ? String(v[x]) : ''));
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.setAttribute('style', v); else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  };
  const P = {
    key: 'M8 2h8v6h-8zM6 8h12v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM10 4v2M14 4v2', disk: 'M4 7h16v10H4zM7 13h3', plus: 'M12 5v14M5 12h14',
    up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', back: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5', grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', warn: 'M12 4l9 16H3zM12 10v4M12 17h.01', power: 'M12 3v9M6.3 7.3a8 8 0 1 0 11.4 0', code: 'M8 8l-4 4 4 4M16 8l4 4-4 4',
  };
  const ic = (n, s = 18) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };
  const langue = () => (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || undefined;
  const taille = (o) => { const t = W.OdinGeneseCleEtapes?.logique?.taille; if (t) return t(o, langue()); const g = (Number(o) || 0) / 1024 ** 3; return `${g >= 10 ? Math.round(g) : g.toFixed(1).replace('.', ',')} Go`; };
  /** « il y a 3 jours ». Pur. */
  const ilYa = (t, maintenant) => { const s = Math.max(0, Math.round((maintenant - t) / 1000)); if (s < 60) return MOTS.il.s; if (s < 3600) return mot(MOTS.il.m, { n: Math.round(s / 60) }); if (s < 86400) return mot(MOTS.il.h, { n: Math.round(s / 3600) }); return mot(MOTS.il.j, { n: Math.round(s / 86400) }); };
  /** Les couleurs par famille (lettre du système). */
  const COUL = { Windows: '#2f6fe0', Linux: '#e95420', Outil: '#7a7f88' };
  const COUL_OCC = { iso: '#d97706', installes: '#2f6fe0', logiciels: '#0b7f7c', memoire: '#a80030' };

  // ------------------------------------------------ logique pure (essayée sans page)
  const vide = () => ({ retirer: [], ajouter: [], remplacer: [], arme: false });
  /** L'attente d'une clé en objet modifiable (copie). Pur. */
  const copie = (a) => { const x = a ? JSON.parse(JSON.stringify(a)) : vide(); for (const k of ['retirer', 'ajouter', 'remplacer']) if (!Array.isArray(x[k])) x[k] = []; return x; };
  /**
   * Les lignes montrées, dans l'ordre du menu à venir : chaque système de la clé (barré s'il sera retiré, à la place qu'il
   * avait), ceux qui seront ajoutés (en pointillé), les nouvelles versions à la place des anciennes. Pur.
   */
  function lignes(cle) {
    const sys = (cle.contenu && cle.contenu.systemes) || [];
    const a = copie(cle.attente);
    const nouveau = (r) => ({ fichier: r.fichier, nom: r.nom, famille: r.famille || familleDeNom(r.nom), mode: 'demarrer', choix: 'iso', defautPermis: Boolean(r.defautPermis), etat: 'ajoute' });
    const finals = [];
    for (const s of sys) {
      if (a.retirer.includes(s.fichier)) continue;
      const r = a.remplacer.find((x) => x.ancien === s.fichier);
      finals.push(r ? { ...nouveau(r), etat: 'version', ancien: s } : { ...s, etat: 'garde' });
    }
    for (const x of a.ajouter) finals.push(nouveau(x));
    const ordre = Array.isArray(a.ordre) ? a.ordre : null;
    const rang = (f) => { const i = ordre ? ordre.indexOf(f) : -1; return i < 0 ? 1e6 : i; };
    const ranges = ordre ? finals.map((e, i) => ({ e, i })).sort((x, y) => rang(x.e.fichier) - rang(y.e.fichier) || x.i - y.i).map((x) => x.e) : finals;
    // Les retirés reviennent à leur place d'avant (barrés).
    const l = ranges.slice();
    sys.forEach((s, i) => { if (a.retirer.includes(s.fichier)) l.splice(Math.min(i, l.length), 0, { ...s, etat: 'retire' }); });
    let n = 0;
    const def = a.defaut !== undefined ? a.defaut : (cle.contenu && cle.contenu.defaut) || '';
    return l.map((e) => ({ ...e, numero: e.etat === 'retire' ? 0 : ++n, defaut: e.etat !== 'retire' && e.fichier === def }));
  }
  const familleDeNom = (n) => (/windows|win1[01]/i.test(n) ? 'Windows' : /gparted|clonezilla|memtest|rescue/i.test(n) ? 'Outil' : 'Linux');
  /** L'ordre des fichiers qui resteront au menu (sans les retirés). Pur. */
  const ordreFinal = (cle) => lignes(cle).filter((e) => e.etat !== 'retire').map((e) => e.fichier);
  /** Déplace une entrée d'un cran dans l'ordre du menu ; rend la nouvelle attente (ou rien si impossible). Pur. */
  function deplacer(cle, fichier, sens) {
    const o = ordreFinal(cle), i = o.indexOf(fichier), j = i + sens;
    if (i < 0 || j < 0 || j >= o.length) return null;
    [o[i], o[j]] = [o[j], o[i]];
    return { ...copie(cle.attente), ordre: o };
  }
  /** Étoile : cette entrée démarre seule (ou plus aucune si on rappuie). Rend la nouvelle attente, ou rien si elle installe. Pur. */
  function etoile(cle, fichier) {
    const e = lignes(cle).find((x) => x.fichier === fichier && x.etat !== 'retire');
    if (!e || !e.defautPermis) return null;
    return { ...copie(cle.attente), defaut: e.defaut ? '' : fichier };
  }
  /** Retirer / garder : un système de la clé est barré (ou gardé de nouveau) ; un ajout ou une nouvelle version est annulé. Pur. */
  function basculer(cle, fichier) {
    const a = copie(cle.attente);
    const e = lignes(cle).find((x) => x.fichier === fichier || (x.ancien && x.ancien.fichier === fichier));
    if (!e) return null;
    if (e.etat === 'ajoute') a.ajouter = a.ajouter.filter((x) => x.fichier !== fichier);
    else if (e.etat === 'version') a.remplacer = a.remplacer.filter((x) => x.fichier !== fichier);
    else if (e.etat === 'retire') a.retirer = a.retirer.filter((x) => x !== fichier);
    else { a.retirer.push(fichier); if (a.defaut === fichier) a.defaut = ''; }
    if (Array.isArray(a.ordre)) a.ordre = a.ordre.filter((x) => x !== fichier);
    return a;
  }
  /** Ajoute une image de la bibliothèque (rend la nouvelle attente, ou rien si elle y est déjà). Pur. */
  function ajouter(cle, img) {
    const a = copie(cle.attente);
    if (a.ajouter.some((x) => x.iso === img.iso) || lignes(cle).some((x) => x.fichier === img.fichier && x.etat !== 'retire')) return null;
    a.ajouter.push({ iso: img.iso, fichier: img.fichier, nom: img.nom, taille: img.taille || 0, famille: img.famille, defautPermis: Boolean(img.defautPermis) });
    if (Array.isArray(a.ordre)) a.ordre.push(img.fichier);
    return a;
  }
  /** Prépare le remplacement par une version plus récente (jamais fait seul). Pur. */
  function remplacer(cle, p) {
    const a = copie(cle.attente);
    if (a.remplacer.some((x) => x.ancien === p.ancien)) return null;
    a.remplacer.push({ ancien: p.ancien, iso: p.iso, fichier: p.fichier, nom: p.nom, taille: 0 });
    a.retirer = a.retirer.filter((x) => x !== p.ancien);
    if (Array.isArray(a.ordre)) a.ordre = a.ordre.map((x) => (x === p.ancien ? p.fichier : x));
    return a;
  }
  /** Ce que la page envoie à cle_changer : seulement ce qui compte (les identifiants des images, l'ordre, le défaut). Pur. */
  const pourServeur = (a) => ({ retirer: a.retirer, ajouter: a.ajouter.map((x) => ({ iso: x.iso })), remplacer: a.remplacer.map((x) => ({ ancien: x.ancien, iso: x.iso })), ...(Array.isArray(a.ordre) ? { ordre: a.ordre } : {}), ...(a.defaut !== undefined ? { defaut: a.defaut } : {}), ...(a.menu ? { menu: true } : {}) });
  /** Les noms des systèmes qui seront retirés (pour la confirmation). Pur. */
  const avecMemoire = (e) => (e.choix === 'persistance' ? mot(MOTS.avecMemoire, { nom: e.nom }) : e.nom);
  const retraits = (cle) => lignes(cle).filter((e) => e.etat === 'retire').map(avecMemoire).concat(lignes(cle).filter((e) => e.etat === 'version').map((e) => avecMemoire(e.ancien)));
  /** L'identifiant d'une carte de la liste (une clé connue : son identifiant ODIN ; sinon : son disque). Pur. */
  const cleDe = (c) => c.id || `disque:${c.disque}`;
  /** Une clé connue, branchée, aux changements armés (accord du propriétaire pour CES changements, encore valable d'après
   *  Odin), sans travail en cours : à appliquer maintenant. Pur. */
  const aAppliquer = (c) => Boolean(c.etat === 'connue' && c.branchee && !c.incomplete && c.attente && c.attente.arme && c.armeValide === true && c.changements > 0 && !(c.travail && !c.travail.fini));
  const logique = { lignes, ordreFinal, deplacer, etoile, basculer, ajouter, remplacer, pourServeur, retraits, aAppliquer, ilYa };

  const CSS = `
.cg{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;align-items:start;min-width:0}
.cg-liste{display:flex;flex-direction:column;gap:8px;min-width:0}
.cg-liste>.ck-h5{margin:0 0 2px}
.cg-k{width:100%;text-align:left;border:1.5px solid var(--line);background:var(--panel);color:var(--ink);border-radius:16px;padding:12px;display:flex;gap:12px;align-items:center;font:inherit;cursor:pointer;min-height:44px}
.cg-k[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.cg-k .lg{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--accent);flex:none}
.cg-k .tx{flex:1;min-width:0}.cg-k b{display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cg-k small{display:block;color:var(--muted);font-size:12px;line-height:1.4}.cg-k small .cg-dot{display:inline-block;margin-right:6px;vertical-align:1px}
.cg-dot{width:8px;height:8px;border-radius:50%;background:var(--good);flex:none}.cg-dot.off{background:color-mix(in srgb,var(--ink) 35%,transparent)}.cg-dot.warn{background:var(--bad)}
.cg-carte{margin:0;min-width:0}
.cg-carte>h4{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cg-sous{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:14px 0 12px;overflow-x:auto;scrollbar-width:none}
.cg-sous button{border:0;background:none;min-height:44px;padding:0 12px;font:600 14px inherit;color:var(--muted);border-bottom:2px solid transparent;white-space:nowrap;cursor:pointer}
.cg-sous button[aria-selected=true]{color:var(--ink);border-bottom-color:var(--accent)}
.cg-note{font-size:12.5px;color:var(--muted);margin:0 0 10px}
.cg-e{display:flex;align-items:center;gap:8px;padding:8px;border-radius:12px;border:1px solid var(--line);margin-bottom:6px;background:var(--panel)}
.cg-e.def{border-color:var(--accent)}
.cg-e.retire{opacity:.55}.cg-e.retire .nm b,.cg-e.retire .nm small{text-decoration:line-through}
.cg-e.ajoute,.cg-e.version{border-style:dashed;border-color:var(--good)}
.cg-e .grip{color:var(--muted);display:grid;place-items:center;width:18px;flex:none}
.cg-mono{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:14px;flex:none}
.cg-e .nm{flex:1;min-width:0}.cg-e .nm b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cg-e .nm small{color:var(--muted);font-size:12px}
.cg-ib{width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);display:grid;place-items:center;cursor:pointer;flex:none;padding:0}
.cg-ib[aria-pressed=true]{color:var(--accent);border-color:var(--accent)}
.cg-ib[aria-pressed=true] svg path{fill:currentColor}
.cg-ib:disabled{opacity:.35;cursor:not-allowed}
.cg-pend{display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:16px;background:color-mix(in srgb,var(--accent) 10%,var(--panel));border:1px solid var(--accent);margin-top:12px;flex-wrap:wrap}
.cg-pend b{flex:1;min-width:180px;font-size:13.5px}.cg-pend small{flex-basis:100%;color:var(--muted);font-size:12px}
.cg-ajout{border:1px dashed var(--line);border-radius:16px;padding:12px;margin-top:10px}
.cg-ajout ul{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}
.cg-ajout li button{width:100%;justify-content:flex-start}
.cg-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 0}
.cg-chip{font-size:12px;padding:4px 10px;border-radius:999px;background:color-mix(in srgb,var(--ink) 7%,transparent);overflow-wrap:anywhere}
.cg-m{display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;border:1px solid var(--line);margin-bottom:6px;flex-wrap:wrap}
.cg-m .nm{flex:1;min-width:180px}.cg-m .nm b{display:block;font-size:14px}.cg-m .nm small{color:var(--muted);font-size:12px}
.cg-prog{height:8px;border-radius:4px;background:color-mix(in srgb,var(--ink) 9%,transparent);overflow:hidden;margin-top:8px}.cg-prog i{display:block;height:100%;background:var(--accent)}
.cg-info{margin-top:12px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);font-size:13px}
.cg-info.ok{border-color:var(--good)}.cg-info.ko{border-color:var(--bad);color:var(--bad);font-weight:600}
.cg-vide{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.cg-vide>div{flex:1;min-width:200px}
@media (max-width:900px){.cg{grid-template-columns:minmax(0,1fr)}}
@media (max-width:640px){.cg-e{flex-wrap:wrap}.cg-e .grip{display:none}.cg-e .nm{flex:1 1 calc(100% - 50px)}.cg-e .cg-ib{flex:1;width:auto}}
@media (prefers-reduced-motion:reduce){.cg *{transition:none!important;animation:none!important}}
`;

  // ------------------------------------------------ état et dessin
  const S = { cles: [], choisie: '', sous: 'contenu', charge: true, erreur: '', msg: '', msgKo: false, majs: {}, ajout: false, applique: new Set(), maintenant: Date.now() };
  let C = null; // { wrap, outils, minuteur }

  function carteListe(c) {
    const k = cleDe(c);
    let sous;
    if (c.etat === 'connue') {
      const n = ((c.contenu && c.contenu.systemes) || []).length;
      const occ = c.contenu && c.contenu.occupation;
      const pris = occ ? occ.iso + occ.installes + occ.logiciels + occ.memoire : 0;
      sous = c.branchee ? mot(MOTS.resumeBranchee, { n, pris: taille(pris), total: taille(c.tailleOctets) }) : mot(MOTS.resumeVue, { quand: ilYa(c.derniere, S.maintenant), n });
    } else sous = c.etat === 'copie' ? MOTS.copie : c.etat === 'serie-illisible' ? MOTS.illisible : c.etat === 'illisible' ? MOTS.partitionIllisible : MOTS.aReconnaitre;
    const point = c.etat === 'connue' ? (c.branchee ? 'cg-dot' : 'cg-dot off') : 'cg-dot warn';
    return el('button', { type: 'button', class: 'cg-k', 'aria-pressed': String(S.choisie === k), 'data-f': `k-${k}`, onclick: () => { S.choisie = k; S.ajout = false; S.msg = ''; dessiner(`k-${k}`); if (S.sous === 'maj') void chargerMaj(c); } },
      el('span', { class: 'lg' }, ic(c.tailleOctets > 200 * 1024 ** 3 ? 'disk' : 'key', 24)),
      el('span', { class: 'tx' }, el('b', {}, c.nom), el('small', {}, el('span', { class: point }), sous)));
  }

  function barre(c) {
    const occ = (c.contenu && c.contenu.occupation) || { iso: 0, installes: 0, logiciels: 0, memoire: 0 };
    const total = Math.max(1, (c.contenu && c.contenu.partition) || c.tailleOctets);
    const libre = c.contenu && c.contenu.libre !== undefined ? c.contenu.libre : Math.max(0, total - occ.iso - occ.installes - occ.logiciels - occ.memoire);
    const parts = Object.keys(COUL_OCC).filter((k) => occ[k] > 0);
    return [
      el('div', { class: 'ck-bar', 'aria-hidden': 'true', style: 'height:14px' }, ...parts.map((k) => el('i', { style: `width:${Math.max(1, (occ[k] / total) * 100)}%;background:${COUL_OCC[k]}` }))),
      el('div', { class: 'ck-leg' }, ...parts.map((k) => el('span', {}, el('em', { style: `background:${COUL_OCC[k]}` }), `${MOTS.occ[k]} ${taille(occ[k])}`)), el('span', {}, el('em', { class: 'ck-s-libre' }), `${MOTS.occ.libre} ${taille(libre)}`)),
    ];
  }

  /** Envoie une nouvelle attente à Odin (il la vérifie et la garde) ; la page se redessine avec ce qu'il a gardé. */
  async function changer(c, attente, focus, armer) {
    if (!attente) return;
    // Tout changement retire l'accord « au branchement » : il ne vaut que pour ce que le propriétaire avait sous les yeux.
    const r = await C.outils.post('cle_changer', { cle: c.id, attente: pourServeur(attente), armer: armer === true });
    if (!r || r.ok === false) { S.msg = (r && r.text) || '?'; S.msgKo = true; dessiner(focus); return; }
    c.attente = r.data && r.data.attente ? { ...attente, ...r.data.attente, ajouter: (r.data.attente.ajouter || []).map((x) => ({ ...(attente.ajouter.find((y) => y.iso === x.iso) || {}), ...x })) } : null;
    c.changements = (r.data && r.data.changements) || 0;
    c.armeValide = Boolean(c.attente && c.attente.arme);
    S.msg = ''; S.msgKo = false;
    dessiner(focus);
  }

  function ligne(c, e, i, l) {
    const finals = l.filter((x) => x.etat !== 'retire');
    const j = finals.indexOf(e);
    const lettre = (e.nom || '?').trim().charAt(0).toUpperCase() || '?';
    let sous = e.etat === 'ajoute' ? MOTS.seraAjoute : e.etat === 'retire' ? MOTS.seraRetire : e.etat === 'version' ? mot(MOTS.nouvelleVersion, { nom: e.ancien.nom }) : (MOTS.choix[e.choix] || MOTS.mode[e.mode] || MOTS.mode.demarrer);
    const delai = c.contenu ? c.contenu.delai : 10;
    if (e.defaut) sous += delai > 0 ? mot(MOTS.defautApres, { s: delai }) : MOTS.defautAttend;
    else if (!e.defautPermis && e.etat !== 'retire') sous += MOTS.jamaisDefaut;
    const f = encodeURIComponent(e.fichier);
    const bouge = (sens, focus) => async () => { const a = deplacer(c, e.fichier, sens); if (a) await changer(c, a, focus); };
    const clavier = (quoi) => (ev) => {
      if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
      ev.preventDefault();
      void bouge(ev.key === 'ArrowUp' ? -1 : 1, `${quoi}-${f}`)();
    };
    const retire = e.etat === 'retire';
    return el('div', { class: `cg-e ${e.etat}${e.defaut ? ' def' : ''}`, role: 'listitem', 'data-f': 'entree', 'data-id': e.fichier },
      el('span', { class: 'grip', 'aria-hidden': 'true' }, ic('grip', 16)),
      el('span', { class: 'cg-mono', style: `background:${COUL[e.famille] || COUL.Linux}`, 'aria-hidden': 'true' }, lettre),
      el('span', { class: 'nm' }, el('b', {}, retire ? e.nom : `${e.numero}. ${e.nom}`), el('small', {}, sous)),
      el('button', { type: 'button', class: 'cg-ib', 'data-f': `up-${f}`, 'aria-label': mot(MOTS.monter, { nom: e.nom }), title: mot(MOTS.monter, { nom: e.nom }), disabled: retire || j <= 0, onclick: bouge(-1, `up-${f}`), onkeydown: clavier('up') }, ic('up', 16)),
      el('button', { type: 'button', class: 'cg-ib', 'data-f': `down-${f}`, 'aria-label': mot(MOTS.descendre, { nom: e.nom }), title: mot(MOTS.descendre, { nom: e.nom }), disabled: retire || j < 0 || j >= finals.length - 1, onclick: bouge(1, `down-${f}`), onkeydown: clavier('down') }, ic('down', 16)),
      el('button', { type: 'button', class: 'cg-ib', 'data-f': `star-${f}`, 'aria-label': mot(MOTS.parDefaut, { nom: e.nom }), title: e.defautPermis ? mot(MOTS.parDefaut, { nom: e.nom }) : MOTS.jamaisDefaut.replace(/^ · /, ''), 'aria-pressed': String(Boolean(e.defaut)), disabled: retire || !e.defautPermis, onclick: () => changer(c, etoile(c, e.fichier), `star-${f}`), onkeydown: clavier('star') }, ic('star', 16)),
      el('button', { type: 'button', class: 'cg-ib', 'data-f': `rm-${f}`, 'aria-label': mot(retire ? MOTS.garder : MOTS.retirer, { nom: e.nom }), title: mot(retire ? MOTS.garder : MOTS.retirer, { nom: e.nom }), onclick: () => changer(c, basculer(c, e.etat === 'version' ? e.fichier : e.fichier), `rm-${f}`), onkeydown: clavier('rm') }, ic(retire ? 'back' : 'trash', 16)),
    );
  }

  function ongletContenu(c) {
    const l = lignes(c);
    const kids = [el('p', { class: 'cg-note' }, MOTS.noteOrdre), el('div', { role: 'list', 'data-f': 'menu' }, ...l.map((e, i) => ligne(c, e, i, l)))];
    const ajoutables = ((S.majs[c.id] && S.majs[c.id].ajoutables) || []).filter((x) => !l.some((y) => y.fichier === x.fichier && y.etat !== 'retire'));
    kids.push(el('div', { class: 'ck-row' }, el('button', { type: 'button', class: 'ck-btn', 'data-f': 'ajouter', 'aria-expanded': String(S.ajout), onclick: async () => { S.ajout = !S.ajout; if (S.ajout && !S.majs[c.id]) await chargerMaj(c); dessiner('ajouter'); } }, ic('plus'), S.ajout ? MOTS.fermerAjout : MOTS.ajouter)));
    if (S.ajout) {
      kids.push(el('div', { class: 'cg-ajout', 'data-f': 'ajout' }, el('b', {}, MOTS.ajoutTitre), el('p', { class: 'cg-note', style: 'margin:4px 0 0' }, MOTS.ajoutNote),
        ajoutables.length ? el('ul', {}, ...ajoutables.map((x) => el('li', {}, el('button', { type: 'button', class: 'ck-btn', 'data-f': `add-${encodeURIComponent(x.iso)}`, onclick: () => changer(c, ajouter(c, x), 'ajouter') }, ic('plus'), `${x.nom} · ${taille(x.taille)}`))))
          : el('p', { class: 'cg-note', style: 'margin:8px 0 0' }, MOTS.ajoutVide)));
    }
    const lg = (c.contenu && c.contenu.logiciels) || { windows: [], linux: [] };
    const tous = [...lg.windows, ...lg.linux];
    kids.push(el('div', { class: 'ck-h5' }, MOTS.logiciels, el('span', { class: 'ck-cnt' }, String(tous.length))),
      tous.length ? el('div', { class: 'cg-chips' }, ...tous.map((n) => el('span', { class: 'cg-chip' }, n))) : el('p', { class: 'cg-note' }, MOTS.aucunLogiciel));
    return kids;
  }

  function ongletMaj(c) {
    const m = S.majs[c.id];
    const a = copie(c.attente);
    const kids = [el('div', { class: 'ck-h5', style: 'margin-top:0' }, MOTS.majTitre)];
    const props = (m && m.propositions) || [];
    if (!props.length) kids.push(el('p', { class: 'cg-note' }, m ? MOTS.majAucune : MOTS.charge));
    for (const p of props) {
      const deja = a.remplacer.some((x) => x.ancien === p.ancien);
      kids.push(el('div', { class: 'cg-m' }, el('span', { class: 'cg-mono', style: `background:${COUL[familleDeNom(p.nom)]}`, 'aria-hidden': 'true' }, (p.nom || '?').charAt(0).toUpperCase()),
        el('span', { class: 'nm' }, el('b', {}, mot(MOTS.majVersion, { ancien: p.nomAncien, nouveau: p.nom })), el('small', {}, MOTS.majVersionSous)),
        el('button', { type: 'button', class: `ck-btn${deja ? '' : ' pri'}`, 'data-f': `maj-${encodeURIComponent(p.ancien)}`, disabled: deja, 'aria-pressed': String(deja), onclick: () => changer(c, remplacer(c, p), `maj-${encodeURIComponent(p.ancien)}`) }, deja ? MOTS.propose : MOTS.proposer)));
    }
    const menu = m ? m.menu : 'inconnu';
    kids.push(el('div', { class: 'ck-h5' }, MOTS.menuTitre),
      el('div', { class: 'cg-m' }, el('span', { class: 'cg-mono', style: 'background:#0b7f7c', 'aria-hidden': 'true' }, ic('code', 18)),
        el('span', { class: 'nm' }, el('b', {}, MOTS.menuTitre), el('small', {}, menu === 'a-jour' ? MOTS.menuAJour : menu === 'a-reecrire' ? MOTS.menuAReecrire : MOTS.menuInconnu)),
        menu === 'a-reecrire' ? el('button', { type: 'button', class: 'ck-btn', 'data-f': 'reecrire', disabled: Boolean(a.menu), onclick: () => changer(c, { ...a, menu: true }, 'reecrire') }, a.menu ? MOTS.propose : MOTS.reecrire) : el('span', { class: `ck-tag${menu === 'a-jour' ? ' ok' : ''}` }, menu === 'a-jour' ? '✓' : '—')),
      el('div', { class: 'cg-m' }, el('span', { class: 'cg-mono', style: 'background:#5b6b7a', 'aria-hidden': 'true' }, ic('power', 18)),
        el('span', { class: 'nm' }, el('b', {}, MOTS.chargeurTitre), el('small', {}, MOTS.chargeurSous)), el('span', { class: 'ck-tag' }, '—')));
    const rel = c.releve;
    const relu = rel ? mot(MOTS.releve, { quand: ilYa(rel.at, S.maintenant), message: rel.differents.length || rel.manquants.length ? `${rel.differents.length + rel.manquants.length} problème(s)` : `${rel.fichiers} fichier(s), aucune erreur · ${String(rel.debitMo).replace('.', ',')} Mo/s` }) : MOTS.relireJamais;
    const occupe = c.travail && !c.travail.fini;
    kids.push(el('div', { class: 'ck-h5' }, MOTS.santeTitre),
      el('div', { class: 'cg-m' }, el('span', { class: 'cg-mono', style: 'background:#1f9d55', 'aria-hidden': 'true' }, ic('shield', 18)),
        el('span', { class: 'nm' }, el('b', {}, MOTS.relireTitre), el('small', {}, c.branchee ? relu : `${relu} ${MOTS.relireBranche}`)),
        el('button', { type: 'button', class: 'ck-btn', 'data-f': 'relire', disabled: !c.branchee || occupe, onclick: () => relire(c) }, MOTS.relire)));
    return kids;
  }

  function panneauConnue(c) {
    const titre = el('h4', {}, c.nom, el('span', { class: `ck-tag${c.branchee ? ' ok' : ''}` }, c.branchee ? MOTS.branchee : MOTS.pasBranchee), c.serieFin ? el('span', { class: 'ck-tag' }, mot(MOTS.serie, { fin: c.serieFin })) : null);
    const kids = [titre, el('p', { class: 'ck-lead' }, c.branchee ? MOTS.leadBranchee : MOTS.leadPas)];
    if (c.incomplete) kids.push(el('div', { class: 'ck-guard', role: 'alert' }, el('span', { class: 'gi' }, ic('warn', 22)), el('div', {}, el('b', {}, MOTS.incomplete))));
    kids.push(...barre(c));
    const SOUS = [['contenu', MOTS.sousContenu], ['maj', MOTS.sousMaj]];
    kids.push(el('div', { class: 'cg-sous', role: 'tablist', 'aria-label': MOTS.sousNom }, ...SOUS.map(([k, t], i) => el('button', {
      type: 'button', role: 'tab', id: `cg-sous-${k}`, 'data-f': `sous-${k}`, 'aria-selected': String(S.sous === k), 'aria-controls': 'cg-sous-panneau', tabindex: S.sous === k ? '0' : '-1',
      onclick: () => { S.sous = k; if (k === 'maj') void chargerMaj(c); dessiner(`sous-${k}`); },
      onkeydown: (ev) => { const n = SOUS.length; const j = ev.key === 'ArrowRight' ? (i + 1) % n : ev.key === 'ArrowLeft' ? (i + n - 1) % n : ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : -1; if (j < 0) return; ev.preventDefault(); S.sous = SOUS[j][0]; if (S.sous === 'maj') void chargerMaj(c); dessiner(`sous-${SOUS[j][0]}`); },
    }, t))));
    kids.push(el('div', { id: 'cg-sous-panneau', role: 'tabpanel', 'aria-labelledby': `cg-sous-${S.sous}` }, ...(S.sous === 'maj' ? ongletMaj(c) : ongletContenu(c))));
    // Le travail en cours (application, relecture) puis son résultat.
    const t = c.travail;
    if (t && !t.fini) {
      const pct = Math.round((t.fait / Math.max(1, t.total)) * 100);
      kids.push(el('div', { class: 'cg-info', role: 'status', 'data-f': 'travail' }, t.sorte === 'relire' ? MOTS.enRelecture : mot(MOTS.enCours, { etape: t.etape, fait: t.fait, total: t.total }), el('div', { class: 'cg-prog', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, el('i', { style: `width:${pct}%` }))));
    } else if (t && t.fini && t.message) kids.push(el('div', { class: `cg-info ${t.ok ? 'ok' : 'ko'}`, role: 'status', 'data-f': 'resultat' }, t.message));
    if (S.msg) kids.push(el('p', { class: `ck-msg${S.msgKo ? ' ko' : ''}`, role: 'status', style: 'margin:12px 0 0' }, S.msg));
    // Le bandeau des changements en attente.
    const n = c.changements || 0;
    if (n > 0) {
      const partis = retraits(c);
      const occ = t && !t.fini;
      kids.push(el('div', { class: 'cg-pend', role: 'status', 'data-f': 'attente' },
        el('b', {}, mot(partis.length ? MOTS.attenteRetrait : MOTS.attente, { n })),
        el('button', { type: 'button', class: 'ck-btn', 'data-f': 'annuler', disabled: occ, onclick: () => annuler(c) }, MOTS.annuler),
        el('button', { type: 'button', class: 'ck-btn pri', 'data-f': 'appliquer', disabled: occ || (c.branchee && c.incomplete) || (!c.branchee && c.attente && c.attente.arme && c.armeValide === true), onclick: () => appliquer(c) }, c.branchee ? MOTS.appliquer : MOTS.appliquerPlusTard),
        c.attente && c.attente.arme && (!c.branchee || c.armeValide !== true) ? el('small', { 'data-f': 'arme' }, c.armeValide === true ? MOTS.arme : MOTS.armePerime) : null));
    }
    return kids;
  }

  function panneauAutre(c) {
    const titres = { 'a-reconnaitre': [MOTS.aReconnaitre, MOTS.aReconnaitreSous, true], copie: [MOTS.copie, MOTS.copieSous, false], 'serie-illisible': [MOTS.illisible, MOTS.illisibleSous, false], illisible: [MOTS.partitionIllisible, '', false] };
    const [t, s, calme] = titres[c.etat] || titres.illisible;
    const kids = [el('h4', {}, c.nom, el('span', { class: 'ck-tag ok' }, MOTS.branchee), c.serieFin ? el('span', { class: 'ck-tag' }, mot(MOTS.serie, { fin: c.serieFin })) : null),
      el('div', { class: `ck-guard${calme ? ' calm' : ''}`, style: 'margin-top:10px' }, el('span', { class: 'gi' }, ic(calme ? 'shield' : 'warn', 22)), el('div', {}, el('b', {}, t), s ? el('p', {}, s) : null))];
    if (c.incomplete) kids.push(el('p', { class: 'ck-msg ko', style: 'margin:10px 0 0' }, MOTS.incomplete));
    if (Array.isArray(c.systemes) && c.systemes.length) kids.push(el('div', { role: 'list', style: 'margin-top:12px' }, ...c.systemes.map((e, i) => el('div', { class: 'cg-e', role: 'listitem' }, el('span', { class: 'cg-mono', style: `background:${COUL[e.famille] || COUL.Linux}`, 'aria-hidden': 'true' }, (e.nom || '?').charAt(0).toUpperCase()), el('span', { class: 'nm' }, el('b', {}, `${i + 1}. ${e.nom}`), el('small', {}, `${MOTS.choix[e.choix] || MOTS.mode[e.mode] || ''} · ${taille(e.taille)}`))))));
    if (c.etat === 'a-reconnaitre' && !c.incomplete) kids.push(el('div', { class: 'ck-row' }, el('button', { type: 'button', class: 'ck-btn pri', 'data-f': 'reconnaitre', onclick: () => reconnaitre(c) }, ic('key'), MOTS.reconnaitre)));
    if (S.msg) kids.push(el('p', { class: `ck-msg${S.msgKo ? ' ko' : ''}`, role: 'status', style: 'margin:12px 0 0' }, S.msg));
    return kids;
  }

  function dessiner(focus) {
    if (!C) return;
    const actif = focus || (typeof document !== 'undefined' && document.activeElement && C.wrap.contains?.(document.activeElement) ? document.activeElement.getAttribute?.('data-f') : null);
    const liste = el('div', { class: 'cg-liste' }, el('div', { class: 'ck-h5' }, MOTS.titre, el('span', { class: 'ck-cnt' }, String(S.cles.filter((c) => c.etat === 'connue').length))),
      ...S.cles.map(carteListe),
      el('button', { type: 'button', class: 'ck-btn', 'data-f': 'nouvelle', style: 'width:100%', onclick: () => { if (C.outils.deployer) C.outils.deployer(); } }, ic('plus'), MOTS.nouvelle));
    let droite;
    const c = S.cles.find((x) => cleDe(x) === S.choisie);
    if (S.charge && !S.cles.length) droite = el('section', { class: 'ck-card cg-carte', role: 'status' }, el('p', { class: 'ck-msg', style: 'margin:0' }, MOTS.charge));
    else if (S.erreur && !S.cles.length) droite = el('section', { class: 'ck-card cg-carte' }, el('p', { class: 'ck-msg ko', role: 'alert', style: 'margin:0' }, S.erreur));
    else if (!c) droite = el('section', { class: 'ck-card cg-carte cg-vide' }, C.outils.mascotte ? C.outils.mascotte() : null, el('div', {}, el('h4', {}, MOTS.aucune), el('p', { class: 'ck-lead', style: 'margin:4px 0 0' }, MOTS.aucuneSuite)));
    else droite = el('section', { class: 'ck-card cg-carte', 'data-f': 'carte', 'aria-label': c.nom }, ...(c.etat === 'connue' ? panneauConnue(c) : panneauAutre(c)));
    C.wrap.replaceChildren(el('div', { class: 'cg' }, liste, droite));
    if (actif) focaliser(actif);
  }
  function focaliser(f) {
    const sel = String(f).replace(/["\\]/g, '\\$&');
    let n = null;
    try { n = C.wrap.querySelector(`[data-f="${sel}"]`); } catch { n = null; }
    if (n && n.disabled) { const e = n.getAttribute?.('data-f') || ''; const autre = e.startsWith('up-') ? e.replace('up-', 'down-') : e.startsWith('down-') ? e.replace('down-', 'up-') : ''; if (autre) { try { n = C.wrap.querySelector(`[data-f="${autre.replace(/["\\]/g, '\\$&')}"]`); } catch { /* rien */ } } }
    if (n && typeof n.focus === 'function') n.focus();
  }

  // ------------------------------------------------ actions
  async function charger() {
    let r;
    try { r = await C.outils.post('cle_mes_cles'); } catch (e) { r = { ok: false, text: String((e && e.message) || e) }; }
    S.charge = false;
    if (!r || r.ok === false || !r.data) { S.erreur = mot(MOTS.erreur, { raison: (r && r.text) || '?' }); return false; }
    S.erreur = '';
    S.maintenant = Number(r.data.maintenant) || Date.now();
    const avant = new Map(S.cles.map((x) => [cleDe(x), x]));
    S.cles = (r.data.cles || []).map((x) => {
      // Les noms et familles des images ajoutées ne viennent que de la page : on les garde d'un passage à l'autre.
      const v = avant.get(cleDe(x));
      if (x.attente && v && v.attente) x.attente.ajouter = (x.attente.ajouter || []).map((a) => ({ ...(v.attente.ajouter || []).find((b) => b.iso === a.iso), ...a }));
      return x;
    });
    if (!S.cles.some((x) => cleDe(x) === S.choisie)) S.choisie = S.cles.length ? cleDe(S.cles.find((x) => x.branchee) || S.cles[0]) : '';
    return true;
  }
  async function chargerMaj(c) {
    if (!c || !c.id) return;
    const r = await C.outils.post('cle_mises_a_jour', { cle: c.id });
    if (r && r.ok !== false && r.data) { S.majs[c.id] = r.data; dessiner(); }
  }
  async function reconnaitre(c) {
    const r = await C.outils.post('cle_reconnaitre', { cible: c.cible });
    S.msg = (r && r.text) || ''; S.msgKo = !(r && r.ok);
    if (r && r.ok && r.data && r.data.id) S.choisie = r.data.id;
    await charger(); dessiner('reconnaitre');
  }
  async function annuler(c) {
    const r = await C.outils.post('cle_changer', { cle: c.id, vider: true });
    S.msg = (r && r.text) || ''; S.msgKo = !(r && r.ok);
    if (r && r.ok) { c.attente = null; c.changements = 0; }
    dessiner(`k-${cleDe(c)}`);
  }
  async function appliquer(c) {
    const partis = retraits(c);
    if (partis.length && !(await W.OdinDialog.confirm(mot(MOTS.confirmeRetrait, { cle: c.nom, liste: partis.join(', ') }), { danger: true }))) return;
    if (!c.branchee) { await changer(c, copie(c.attente), 'annuler', true); return; }
    const r = await C.outils.post('cle_appliquer', { cle: c.id });
    S.msg = r && r.ok ? '' : (r && r.text) || '?'; S.msgKo = !(r && r.ok);
    await charger(); dessiner('annuler');
    accelerer();
  }
  async function relire(c) {
    const r = await C.outils.post('cle_relire', { cle: c.id });
    S.msg = r && r.ok ? '' : (r && r.text) || '?'; S.msgKo = !(r && r.ok);
    await charger(); dessiner('relire');
    accelerer();
  }
  /** Les changements armés d'une clé connue qui vient d'être branchée : appliqués une fois (à elle seule). */
  async function auBranchement() {
    for (const c of S.cles) {
      if (!aAppliquer(c)) continue;
      const k = `${c.id}:${c.attente.armeLe || c.attente.depuis || 0}`;
      if (S.applique.has(k)) continue;
      S.applique.add(k);
      await C.outils.post('cle_appliquer', { cle: c.id, auto: true });
      await charger(); dessiner();
      accelerer();
    }
  }
  /** Pendant un travail : relire chaque seconde ; sinon toutes les 5 s. */
  function accelerer() {
    if (!C || C.rapide) return;
    const moi = C;
    C.rapide = setInterval(async () => {
      if (C !== moi || !moi.wrap.isConnected) { clearInterval(moi.rapide); moi.rapide = 0; return; }
      await charger(); dessiner();
      if (!S.cles.some((x) => x.travail && !x.travail.fini)) { clearInterval(moi.rapide); moi.rapide = 0; }
    }, 1000);
  }

  /** Monte « Mes clés » dans `wrap`. outils : { post, act, mascotte?, deployer? }. */
  async function monter(wrap, outils) {
    if (typeof document !== 'undefined' && document.head && !document.getElementById?.('cgCss')) document.head.append(el('style', { id: 'cgCss' }, CSS));
    if (C && C.minuteur) clearInterval(C.minuteur);
    if (C && C.rapide) clearInterval(C.rapide);
    const moi = { wrap, outils, minuteur: 0, rapide: 0 };
    C = moi;
    S.msg = ''; S.ajout = false;
    if (!S.cles.length) S.charge = true;
    dessiner();
    await charger();
    if (C !== moi) return;
    dessiner();
    await auBranchement();
    // Odin voit une clé arriver ou partir : la liste est relue (lecture seule) toutes les 5 s, tant que la page est là.
    moi.minuteur = setInterval(async () => {
      if (C !== moi || !wrap.isConnected) { clearInterval(moi.minuteur); return; }
      if ((typeof document !== 'undefined' && document.hidden) || moi.rapide) return;
      const avant = JSON.stringify(S.cles.map((x) => [cleDe(x), x.branchee, x.changements, x.travail && x.travail.fini, x.etat]));
      if (!(await charger())) return;
      if (JSON.stringify(S.cles.map((x) => [cleDe(x), x.branchee, x.changements, x.travail && x.travail.fini, x.etat])) !== avant) dessiner();
      await auBranchement();
    }, 5000);
  }

  W.OdinGeneseCleGerer = { MOTS, logique, monter, etat: S };
})();
