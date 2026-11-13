// Odin OS — applis du système : Fichiers, Éditeur, Visionneuse, Réglages, Terminal.
// Chaque appli se dessine dans le « corps » qu'on lui donne : une fenêtre sur ordinateur, un écran sur téléphone.
(() => {
  'use strict';
  const OS = window.OS, h = OS.h, api = OS.api;
  const declarer = OS.declarer = (a) => { OS.applis[a.id] = { largeur: 860, hauteur: 560, ...a }; return OS.applis[a.id]; };

  // ——— Petits composants communs ———
  const ui = OS.ui = {};
  /** Colonne de navigation : [{ id, nom, icone, rubrique, pastille }]. */
  ui.lateral = (elements, courant, surChoix, label) => {
    const nav = h('nav', { class: 'lateral', 'aria-label': label || 'Sections' });
    for (const e of elements) {
      if (e.rubrique) { OS.ajouter(nav, h('p', { class: 'rubrique' }, e.rubrique)); continue; }
      OS.ajouter(nav, h('button', { type: 'button', 'aria-current': e.id === courant ? 'true' : null, onclick: () => surChoix(e.id) }, e.tuile || (e.icone ? OS.icone(e.icone, 18) : null), h('span', null, e.nom), e.pastille ? h('span', { class: 'pastille' }, e.pastille) : null));
    }
    return nav;
  };
  ui.interrupteur = (valeur, surChange, label) => { const b = h('button', { type: 'button', class: 'interrupteur', role: 'switch', 'aria-checked': String(Boolean(valeur)), 'aria-label': label, onclick: () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); surChange(v); } }); return b; };
  ui.segments = (options, valeur, surChange, label) => { const g = h('div', { class: 'segments', role: 'radiogroup', 'aria-label': label }); for (const [v, nom] of options) OS.ajouter(g, h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === valeur), onclick: () => { g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', 'false')); g.children[options.findIndex((o) => o[0] === v)].setAttribute('aria-checked', 'true'); surChange(v); } }, nom)); return g; };
  ui.reglage = (titre, detail, controle) => h('div', { class: 'carte rangee entre' }, h('div', { style: { minWidth: 0 } }, h('div', { class: 'titre-section' }, titre), detail ? h('div', { class: 'attenue petit-texte' }, detail) : null), controle);
  ui.attente = (texte) => h('div', { class: 'rangee attenue', role: 'status', style: { padding: '24px' } }, OS.mascotte(44, { decor: true }), texte || 'Je regarde…');
  ui.message = (texte, ton) => h('div', { class: `bandeau ${ton || ''}`, role: ton === 'mauvais' ? 'alert' : 'status' }, OS.icone(ton === 'mauvais' || ton === 'attention' ? 'alerte' : 'info', 22), h('div', null, texte));
  /** Menu contextuel à l'endroit du clic : [{ nom, icone, action }] (null = séparateur). */
  ui.menu = (x, y, elements) => {
    document.querySelectorAll('.menu').forEach((m) => m.remove());
    const m = h('div', { class: 'menu', role: 'menu' });
    const fermer = () => { m.remove(); document.removeEventListener('pointerdown', dehors, true); document.removeEventListener('keydown', touche, true); };
    const dehors = (e) => { if (!m.contains(e.target)) fermer(); };
    const touche = (e) => { if (e.key === 'Escape') fermer(); };
    for (const e of elements) OS.ajouter(m, e ? h('button', { type: 'button', role: 'menuitem', onclick: () => { fermer(); e.action(); } }, e.icone ? OS.icone(e.icone, 16) : null, e.nom) : h('hr'));
    OS.ajouter(document.body, m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.max(6, Math.min(x, innerWidth - r.width - 6))}px`; m.style.top = `${Math.max(6, Math.min(y, innerHeight - r.height - 6))}px`;
    setTimeout(() => { document.addEventListener('pointerdown', dehors, true); document.addEventListener('keydown', touche, true); }, 0);
    const premier = m.querySelector('button'); if (premier) premier.focus();
    return m;
  };
  /** Suit une tâche longue du système (installation d'un paquet, d'un pont…) dans un dialogue, avec son journal. */
  ui.tache = (titre, lancer) => new Promise((fin) => {
    const journal = h('div', { class: 'journal', style: { minHeight: '120px' } }, 'Démarrage…');
    const etat = h('p', { class: 'attenue', role: 'status' }, 'En cours… tu peux continuer à utiliser le bureau.');
    const fermer = h('button', { class: 'bouton primaire', disabled: true, onclick: () => fond.remove() }, 'Fermer');
    const fond = h('div', { class: 'dialogue-fond' }, h('div', { class: 'dialogue', role: 'dialog', 'aria-modal': 'true', 'aria-label': titre, style: { width: 'min(620px,100%)' } }, h('div', { class: 'rangee' }, OS.mascotte(48, { decor: true }), h('h2', { class: 'titre-section', style: { fontSize: '18px' } }, titre)), etat, journal, h('div', { class: 'rangee', style: { justifyContent: 'flex-end' } }, fermer)));
    OS.ajouter(document.body, fond); OS.humeur('concentration');
    const finir = (ok, texte) => { etat.textContent = texte; fermer.disabled = false; fermer.focus(); OS.humeur(ok ? 'joie' : 'inquiet', 4000); OS.humeur('neutre'); fin(ok); };
    (async () => {
      let r; try { r = await lancer(); } catch (e) { return finir(false, e.message); }
      if (!r || r.ok === false) { journal.textContent = (r && (r.error || r.text)) || 'Refusé.'; return finir(false, 'Ça n\'a pas marché.'); }
      if (!r.tache) { journal.textContent = r.text || r.sortie || 'Fait.'; return finir(true, 'C\'est fait.'); }
      for (;;) {
        await new Promise((s) => setTimeout(s, 1500));
        let t; try { t = await api.lire(`/api/os/tache?id=${encodeURIComponent(r.tache)}`); } catch (e) { return finir(false, e.message); }
        if (!t.ok) return finir(false, t.error || 'Tâche perdue.');
        journal.textContent = t.journal || '…'; journal.scrollTop = journal.scrollHeight;
        if (t.etat !== 'en cours') return finir(t.etat === 'fini', t.etat === 'fini' ? 'C\'est fait.' : `Ça n'a pas marché (code ${t.code}).`);
      }
    })();
  });

  /** La discussion avec Odin (fil, idées, saisie) : la même sur le bureau et sur le téléphone. */
  ui.discussion = (o = {}) => {
    const essai = () => api.mode === 'essai';
    const fil = h('div', { class: 'fil', role: 'log', 'aria-live': 'polite' }), champ = h('input', { class: 'champ', placeholder: 'Écris à Odin…', 'aria-label': 'Message pour Odin', autocomplete: 'off' });
    const visage = OS.mascotte(44, { decor: true }), etat = h('span', { class: 'attenue petit-texte' }, essai() ? 'Mode essai · sans IA' : 'En ligne');
    let attente = null, enCours = null;
    const dire = (texte, moi) => { const b = h('div', { class: `bulle ${moi ? 'moi' : ''}` }, texte); OS.ajouter(fil, b); fil.scrollTop = fil.scrollHeight; return b; };
    const repondu = (texte) => { clearTimeout(attente); if (enCours) { enCours.textContent = texte; enCours = null; } else dire(texte); etat.textContent = essai() ? 'Mode essai · sans IA' : 'En ligne'; if (window.OdinFace) { window.OdinFace.set(visage, 'neutre'); window.OdinFace.flash(visage, 'joie', 2500); } fil.scrollTop = fil.scrollHeight; if (o.surReponse) o.surReponse(texte); };
    const envoyer = async (texte) => {
      dire(texte, true); if (window.OdinFace) window.OdinFace.set(visage, 'reflexion'); etat.textContent = 'Réfléchit…';
      if (essai()) return void setTimeout(() => repondu(OS.essai.repondre(texte)), 350);
      enCours = dire('…');
      attente = setTimeout(() => repondu('Je n\'ai pas de réponse pour l\'instant. Vérifie que j\'ai bien un modèle d\'IA (interface d\'Odin → Réglages).'), 120000);
      try { await api.message(texte); } catch (e) { repondu(`Je n'ai pas pu envoyer ton message : ${e.message}`); }
    };
    const arret = api.flux((m) => { if (m.morceau && enCours) { enCours.textContent = (enCours.textContent === '…' ? '' : enCours.textContent) + m.morceau; fil.scrollTop = fil.scrollHeight; } else if (m.texte) repondu(m.texte); });
    const idees = h('div', { class: 'idees' }, ['Mets le thème Verre', 'Ouvre le Terminal', 'Suis-je protégé ?'].map((t) => h('button', { type: 'button', class: 'bouton petit contour', onclick: () => envoyer(t) }, t)));
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); const t = champ.value.trim(); if (t) { champ.value = ''; envoyer(t); } } }, champ, h('button', { class: 'bouton primaire', 'aria-label': 'Envoyer' }, OS.icone('envoyer', 16)));
    dire(essai() ? 'Salut ! Ici tu essaies Odin OS : je réponds sans IA. Dis-moi « mets le thème Néon » ou « installe Ullr ».' : 'Salut ! Je suis là. Demande-moi ce que tu veux : une appli à installer, un réglage, une question.');
    return { visage, etat, fil, idees, form, champ, arret, envoyer };
  };

  // ——— Compatibilité : que peut faire Odin OS d'un fichier d'appli ? (sans rien inventer) ———
  const PLATEFORMES = OS.PLATEFORMES = {
    linux: { nom: 'Linux', couleur: '#F59E0B', lettre: 'L' }, windows: { nom: 'Windows', couleur: '#2563EB', lettre: 'W' }, android: { nom: 'Android', couleur: '#10B981', lettre: 'A' },
    mac: { nom: 'Mac', couleur: '#64748B', lettre: 'M' }, iphone: { nom: 'iPhone', couleur: '#0F172A', lettre: 'i' }, web: { nom: 'Web', couleur: '#7C3AED', lettre: '◍' }, odin: { nom: 'Odin', couleur: '#E3AC3F', lettre: 'O' },
  };
  OS.PONTS = {
    windows: { nom: 'Odin Bridge Windows', moteur: 'Wine', resume: 'Fait tourner les applis Windows (.exe, .msi).' },
    android: { nom: 'Odin Bridge Android', moteur: 'Waydroid', resume: 'Fait tourner les applis Android (.apk) dans un Android complet, à côté du bureau.' },
    mac: { nom: 'Odin Bridge Mac', moteur: 'Darling', resume: 'Expérimental : surtout les outils Mac en ligne de commande.' },
  };
  OS.plateformeDe = (nom) => { const n = String(nom).toLowerCase(); if (/^https?:\/\//.test(n)) return 'web'; if (/\.(exe|msi|bat|msix|appx)$/.test(n)) return 'windows'; if (/\.(apk|xapk|aab|apks)$/.test(n)) return 'android'; if (/\.(dmg|pkg|app)$/.test(n)) return 'mac'; if (/\.ipa$/.test(n)) return 'iphone'; if (/\.(deb|appimage|flatpak|flatpakref|rpm|snap|run)$/.test(n)) return 'linux'; return ''; };
  /** Verdict honnête pour un fichier ou une adresse : installable ici, pont à installer, pas possible. */
  OS.compat = (nom) => {
    const p = OS.plateformeDe(nom), cap = (api.systeme && api.systeme.capacites) || {}, ponts = cap.ponts || {}, f = String(nom).split('/').pop();
    if (!p) return { plateforme: '', verdict: 'inconnu', titre: 'Je ne reconnais pas ce type de fichier', texte: `« ${f} » n'est pas un installeur que je connais (.deb, .exe, .apk, .dmg…).` };
    if (p === 'web') return { plateforme: p, verdict: 'ok', titre: 'Appli web', texte: 'Une appli web s\'ouvre dans le navigateur : rien à installer.' };
    if (p === 'iphone') return { plateforme: p, verdict: 'impossible', titre: 'Appli iPhone : pas installable', texte: 'Apple ne permet pas d\'installer une appli iPhone ailleurs que sur un iPhone. Cherche la version Android ou la version web de cette appli.' };
    if (p === 'linux') {
      if (!/\.deb$/i.test(f)) return { plateforme: p, verdict: 'bientot', titre: 'Format Linux pas encore pris en charge', texte: 'Odin OS 0.1 installe les paquets .deb et les applis du dépôt Ubuntu. Les formats AppImage, Flatpak, Snap et RPM ne sont pas encore pris en charge.' };
      return cap.apt ? { plateforme: p, verdict: 'ok', titre: 'Appli Linux : installable', texte: 'C\'est un paquet Linux (.deb) : Odin OS l\'installe directement, avec ce dont il a besoin.', action: 'fichier' } : { plateforme: p, verdict: 'ailleurs', titre: 'Appli Linux', texte: 'Ce paquet s\'installe sur un Odin OS installé (Docker, LXC, PC). Ici, il n\'y a pas de système Ubuntu derrière le bureau.' };
    }
    const pont = OS.PONTS[p], e = ponts[p] || {};
    if (e.installe) return { plateforme: p, verdict: 'ok', titre: `Appli ${PLATEFORMES[p].nom} : je peux la lancer`, texte: `${pont.nom} (${pont.moteur}) est installé.${p === 'mac' ? ' Attention : ce pont est expérimental, beaucoup d\'applis Mac ne démarrent pas.' : ''}`, action: 'ouvrir' };
    if (e.possible) return { plateforme: p, verdict: 'pont', titre: `Appli ${PLATEFORMES[p].nom} : il faut ${pont.nom}`, texte: `${pont.resume} Il se télécharge une seule fois (${pont.moteur}).`, pont: p };
    return { plateforme: p, verdict: 'ailleurs', titre: `Appli ${PLATEFORMES[p].nom}`, texte: e.pourquoi || `${pont.nom} (${pont.moteur}) s'installe sur un Odin OS installé. Ici, ce n'est pas possible.` };
  };

  // ═══ Fichiers ═══
  const LIEUX = [['Maison', 'maison', ''], ['Bureau', 'ecran', 'Bureau'], ['Documents', 'document', 'Documents'], ['Images', 'image', 'Images'], ['Musique', 'musique', 'Musique'], ['Téléchargements', 'telecharger', 'Téléchargements'], ['Vidéos', 'video', 'Vidéos']];
  const CORBEILLE = '.local/share/Trash/files';
  const COULEUR_TYPE = { txt: '#64748B', md: '#64748B', pdf: '#DC2626', png: '#0EA5E9', jpg: '#0EA5E9', jpeg: '#0EA5E9', svg: '#0EA5E9', mp3: '#DB2777', mp4: '#7C3AED', zip: '#CA8A04', deb: '#EA580C', exe: '#2563EB', apk: '#10B981', json: '#475569', js: '#CA8A04', html: '#EA580C', sh: '#16A34A' };
  declarer({ id: 'fichiers', nom: 'Fichiers', icone: 'dossier', couleur: ['#7CC6F2', '#2F7FE0'], largeur: 920, hauteur: 580, ouvrir(ctx) {
    let chemin = ctx.options.chemin || '', maison = '', entrees = [], choisi = null; const passe = [];
    let lateral = h('div'); const outils = h('div', { class: 'outils' }), zone = h('div', { style: { flex: '1', overflow: 'auto' } }), pied = h('div', { class: 'attenue petit-texte', style: { padding: '6px 14px', borderTop: '1px solid var(--trait)' }, role: 'status' });
    OS.ajouter(ctx.corps, h('div', { class: 'colonnes' }, lateral, h('div', { class: 'principal', style: { overflow: 'hidden' } }, outils, zone, pied)));
    const dansCorbeille = () => maison && chemin === `${maison}/${CORBEILLE}`;
    const aller = async (c, sansHistorique) => {
      const r = await api.fichiers(c);
      if (!r.ok) { OS.poser(zone, h('div', { class: 'contenu' }, ui.message(r.error || 'Dossier inaccessible.', 'attention'))); return; }
      if (!sansHistorique && chemin && chemin !== r.chemin) passe.push(chemin);
      chemin = r.chemin; maison = r.maison; choisi = null;
      entrees = r.entrees.sort((a, b) => (b.dossier - a.dossier) || a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
      ctx.titre(chemin === maison ? 'Maison' : dansCorbeille() ? 'Corbeille' : chemin.split('/').pop());
      dessiner(r);
    };
    const selectionner = (e, ligne) => { choisi = e; zone.querySelectorAll('tr[aria-selected]').forEach((t) => t.setAttribute('aria-selected', 'false')); if (ligne) ligne.setAttribute('aria-selected', 'true'); pied.textContent = e ? `« ${e.nom} » sélectionné${e.dossier ? '' : ` · ${OS.taille(e.taille)}`}` : `${entrees.length} élément${entrees.length > 1 ? 's' : ''}`; };
    const ouvrirEntree = async (e) => {
      const c = `${chemin}/${e.nom}`;
      if (e.dossier) return aller(c);
      if (OS.plateformeDe(e.nom)) return OS.ouvrir('installer', { chemin: c });
      const r = await api.fichier(c);
      if (!r.ok) return OS.notifier({ titre: 'Impossible d\'ouvrir', texte: r.error });
      if (r.genre === 'texte') OS.ouvrir('editeur', { chemin: c, texte: r.texte, nom: r.nom });
      else if (r.genre === 'image') OS.ouvrir('visionneuse', { nom: r.nom, image: r.image });
      else OS.notifier({ titre: r.nom, texte: `${OS.taille(r.taille)} · Odin OS 0.1 ouvre les textes et les images. Pour ce fichier, installe une appli adaptée depuis Odin Store.` });
    };
    const nouveau = async (action, titre) => { const nom = await OS.demander(titre, action === 'dossier' ? 'Nouveau dossier' : 'Sans titre.txt'); if (!nom) return; const r = await api.operation(action, { chemin, nom }); if (!r.ok) OS.notifier({ titre: 'Création impossible', texte: r.error }); aller(chemin, true); };
    const renommer = async (e) => { const nom = await OS.demander(`Renommer « ${e.nom} »`, e.nom); if (!nom || nom === e.nom) return; const r = await api.operation('renommer', { chemin: `${chemin}/${e.nom}`, nom }); if (!r.ok) OS.notifier({ titre: 'Renommage impossible', texte: r.error }); aller(chemin, true); };
    const jeter = async (e) => { const r = await api.operation('corbeille', { chemin: `${chemin}/${e.nom}` }); if (!r.ok) OS.notifier({ titre: 'Impossible', texte: r.error }); else OS.notifier({ titre: 'Mis à la corbeille', texte: e.nom }); aller(chemin, true); };
    const vider = async () => { if (!await OS.confirmer('Vider la corbeille ?', 'Les fichiers seront effacés pour de bon. Ce geste ne peut pas être annulé.', { danger: true, oui: 'Vider' })) return; const r = await api.operation('vider', { chemin: maison, confirm: true }); if (!r.ok) OS.notifier({ titre: 'Impossible', texte: r.error }); aller(chemin, true); };
    const analyser = async (e) => { OS.notifier({ titre: 'Ullr analyse…', texte: e.nom, appli: OS.applis['odin:ullr'] }); const r = await api.agir('ullr', 'fichier', { chemin: `${chemin}/${e.nom}` }); OS.notifier({ titre: 'Ullr', texte: (r && (r.text || r.error)) || 'Pas de réponse.', appli: OS.applis['odin:ullr'] }); };
    const menuDe = (ev, e) => { ev.preventDefault(); ui.menu(ev.clientX, ev.clientY, [{ nom: 'Ouvrir', icone: 'fenetre', action: () => ouvrirEntree(e) }, ...(dansCorbeille() ? [] : [{ nom: 'Renommer', icone: 'palette', action: () => renommer(e) }, ...(e.dossier ? [] : [{ nom: 'Analyser avec Ullr', icone: 'bouclier', action: () => analyser(e) }]), null, { nom: 'Mettre à la corbeille', icone: 'corbeille', action: () => jeter(e) }])]); };
    function dessiner(r) {
      const lieux = [{ rubrique: 'Favoris' }, ...LIEUX.map(([nom, icone, sous]) => ({ id: sous ? `${maison}/${sous}` : maison, nom, icone })), { rubrique: 'Système' }, { id: `${maison}/${CORBEILLE}`, nom: 'Corbeille', icone: 'corbeille' }];
      lateral.replaceWith(lateral = ui.lateral(lieux, chemin, (id) => aller(id), 'Emplacements'));
      const miettes = chemin === maison ? ['Maison'] : dansCorbeille() ? ['Corbeille'] : chemin.startsWith(`${maison}/`) ? ['Maison', ...chemin.slice(maison.length + 1).split('/')] : chemin.split('/').filter(Boolean);
      OS.poser(outils, 
        h('button', { class: 'icone-b', 'aria-label': 'Retour', disabled: !passe.length, onclick: () => { const c = passe.pop(); if (c) aller(c, true); } }, OS.icone('gauche', 18)),
        h('button', { class: 'icone-b', 'aria-label': 'Dossier parent', disabled: !r.parent, onclick: () => r.parent && aller(r.parent) }, OS.icone('haut', 18)),
        h('div', { class: 'chemin' }, OS.icone(dansCorbeille() ? 'corbeille' : 'dossier', 16), miettes.join('  ›  ')),
        ...(dansCorbeille() ? [h('button', { class: 'bouton petit danger', disabled: !entrees.length, onclick: vider }, 'Vider la corbeille')] : [h('button', { class: 'bouton petit', onclick: () => nouveau('dossier', 'Nom du dossier') }, OS.icone('plus', 14), 'Dossier'), h('button', { class: 'bouton petit', onclick: () => nouveau('nouveau', 'Nom du fichier') }, OS.icone('plus', 14), 'Fichier')]),
        ...[OS.etiquetteEssai('Essai')].filter(Boolean));
      if (!entrees.length) { OS.poser(zone, h('div', { class: 'contenu attenue', style: { alignItems: 'center', paddingTop: '60px' } }, OS.mascotte(72, { decor: true }), dansCorbeille() ? 'La corbeille est vide.' : 'Ce dossier est vide.')); selectionner(null); return; }
      const corps = h('tbody');
      for (const e of entrees) {
        const ext = e.dossier ? '' : (e.nom.includes('.') ? e.nom.split('.').pop().toLowerCase() : '');
        const ligne = h('tr', { tabindex: '0', 'aria-selected': 'false', onclick: () => selectionner(e, ligne), ondblclick: () => ouvrirEntree(e), onkeydown: (ev) => { if (ev.key === 'Enter') ouvrirEntree(e); if (ev.key === 'Delete' && !dansCorbeille()) jeter(e); if (ev.key === 'F2' && !dansCorbeille()) renommer(e); }, oncontextmenu: (ev) => { selectionner(e, ligne); menuDe(ev, e); } },
          h('td', null, h('span', { class: 'rangee', style: { gap: '10px' } }, h('span', { class: `type-f ${e.dossier ? 'dossier' : ''}`, style: e.dossier ? null : { background: COULEUR_TYPE[ext] || '#94A3B8' } }, e.dossier ? '' : ext.slice(0, 4).toUpperCase()), e.nom)),
          h('td', { class: 'attenue' }, OS.quand(e.modifie)), h('td', { class: 'attenue' }, e.dossier ? '—' : OS.taille(e.taille)));
        OS.ajouter(corps, ligne);
      }
      OS.poser(zone, h('table', { class: 'liste' }, h('thead', null, h('tr', null, h('th', null, 'Nom'), h('th', null, 'Modifié'), h('th', null, 'Taille'))), corps));
      selectionner(null);
    }
    OS.ajouter(zone, ui.attente('J\'ouvre le dossier…'));
    aller(chemin);
  } });

  // ═══ Éditeur de texte ═══
  declarer({ id: 'editeur', nom: 'Éditeur', icone: 'document', couleur: ['#FDE68A', '#D97706'], encre: '#3B2A05', largeur: 700, hauteur: 500, multiple: true, ouvrir(ctx) {
    let chemin = ctx.options.chemin || '', propre = true;
    const zone = h('textarea', { class: 'champ', 'aria-label': 'Texte', spellcheck: 'false', style: { flex: '1', border: '0', borderRadius: '0', resize: 'none', fontFamily: 'var(--mono)', fontSize: '13.5px', lineHeight: '1.6', padding: '16px 20px' } });
    zone.value = ctx.options.texte || '';
    const etat = h('span', { class: 'attenue petit-texte', role: 'status' }, chemin ? '' : 'Nouveau fichier');
    const nommer = () => ctx.titre(`${chemin ? chemin.split('/').pop() : 'Sans titre'}${propre ? '' : ' •'}`);
    const enregistrer = async () => {
      if (!chemin) { const base = (await api.fichiers('')).maison; const nom = await OS.demander('Nom du fichier', 'Note.txt', { aide: 'Il sera rangé dans Documents.' }); if (!nom) return; const r = await api.operation('nouveau', { chemin: `${base}/Documents`, nom }); if (!r.ok) { etat.textContent = r.error; return; } chemin = r.chemin; }
      const r = await api.operation('ecrire', { chemin, texte: zone.value });
      if (r.ok) { propre = true; etat.textContent = `Enregistré à ${OS.heure()}`; } else etat.textContent = r.error || 'Enregistrement impossible.';
      nommer();
    };
    zone.addEventListener('input', () => { if (propre) { propre = false; nommer(); } });
    zone.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); enregistrer(); } });
    OS.ajouter(ctx.corps, h('div', { class: 'outils' }, h('button', { class: 'bouton petit primaire', onclick: enregistrer }, 'Enregistrer'), etat, h('span', { class: 'pousse' }), OS.etiquetteEssai('Essai')), zone);
    nommer();
  } });

  // ═══ Visionneuse d'images ═══
  declarer({ id: 'visionneuse', nom: 'Images', icone: 'image', couleur: ['#67E8F9', '#0E7490'], largeur: 720, hauteur: 520, multiple: true, cachee: true, ouvrir(ctx) {
    ctx.titre(ctx.options.nom || 'Image');
    OS.ajouter(ctx.corps, h('div', { style: { flex: '1', display: 'grid', placeItems: 'center', background: 'var(--champ)', overflow: 'auto', padding: '12px' } }, ctx.options.image ? h('img', { src: ctx.options.image, alt: ctx.options.nom || '', style: { maxWidth: '100%', maxHeight: '100%', borderRadius: '8px' } }) : 'Image illisible.'));
  } });

  // ═══ Réglages ═══
  const mini = (fond, selectionne, nom, surClic) => { const b = h('button', { type: 'button', 'aria-pressed': String(selectionne), 'aria-label': nom, title: nom, onclick: surClic, style: { width: '116px', height: '72px', borderRadius: '12px', overflow: 'hidden', position: 'relative', outline: selectionne ? '3px solid var(--accent)' : '1px solid var(--trait)', outlineOffset: selectionne ? '2px' : '0' } }); b.innerHTML = OS.fonds[fond](); b.firstChild.setAttribute('style', 'width:100%;height:100%;display:block'); return b; };
  declarer({ id: 'reglages', nom: 'Réglages', icone: 'reglages', couleur: ['#94A3B8', '#475569'], largeur: 920, hauteur: 600, ouvrir(ctx) {
    let section = ctx.options.section || 'apparence'; const page = h('div', { class: 'principal' }); let lateral = h('div');
    OS.ajouter(ctx.corps, h('div', { class: 'colonnes' }, lateral, page));
    const SECTIONS = [{ id: 'apparence', nom: 'Apparence', icone: 'palette' }, { id: 'applis', nom: 'Applis d\'Odin', icone: 'grille' }, { id: 'ponts', nom: 'Compatibilité', icone: 'lien' }, { id: 'telephone', nom: 'Téléphone', icone: 'telephone' }, { id: 'securite', nom: 'Sécurité', icone: 'bouclier' }, { id: 'systeme', nom: 'Système', icone: 'puce' }, { id: 'compte', nom: 'Compte', icone: 'utilisateur' }, { id: 'apropos', nom: 'À propos', icone: 'info' }];
    const montrer = (id) => { section = id; lateral.replaceWith(lateral = ui.lateral(SECTIONS, section, montrer, 'Réglages')); const c = h('div', { class: 'contenu' }); OS.poser(page, c); ctx.titre(`Réglages · ${SECTIONS.find((s) => s.id === id).nom}`); PAGES[id](c); };
    const entete = (c, titre, sous) => OS.ajouter(c, h('div', null, h('h2', { class: 'titre-app' }, titre), sous ? h('p', { class: 'attenue' }, sous) : null));
    const PAGES = {
      apparence(c) {
        entete(c, 'Apparence', 'Tu viens de Mac, de Windows ou de Linux ? Garde tes habitudes. Tout se change à tout moment.');
        const themes = h('div', { class: 'grille', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' } });
        for (const [id, t] of Object.entries(OS.themes)) OS.ajouter(themes, h('button', { type: 'button', class: 'carte', 'aria-pressed': String(OS.etat.theme === id), style: { textAlign: 'left', padding: '10px', outline: OS.etat.theme === id ? '3px solid var(--accent)' : 'none' }, onclick: () => { OS.regler({ theme: id, fond: '' }); montrer('apparence'); } }, h('div', { style: { height: '78px', borderRadius: '10px', background: t.apercu, marginBottom: '8px' } }), h('b', null, t.nom), h('div', { class: 'attenue petit-texte' }, t.resume)));
        OS.ajouter(c, h('h3', { class: 'titre-section' }, 'Thème'), themes,
          ui.reglage('Clair ou sombre', 'Auto suit le thème choisi.', ui.segments([['clair', 'Clair'], ['sombre', 'Sombre'], ['auto', 'Auto']], OS.etat.apparence, (v) => OS.regler({ apparence: v }), 'Clair ou sombre')));
        const accents = h('div', { class: 'rangee', style: { flexWrap: 'wrap' } }, h('button', { type: 'button', class: 'bouton petit', 'aria-pressed': String(!OS.etat.accent), onclick: () => { OS.regler({ accent: '' }); montrer('apparence'); } }, 'Celle du thème'));
        for (const [nom, couleur] of OS.ACCENTS) OS.ajouter(accents, h('button', { type: 'button', 'aria-label': nom, title: nom, 'aria-pressed': String(OS.etat.accent === couleur), onclick: () => { OS.regler({ accent: couleur }); montrer('apparence'); }, style: { width: '30px', height: '30px', borderRadius: '50%', background: couleur, outline: OS.etat.accent === couleur ? '3px solid var(--texte)' : 'none', outlineOffset: '2px' } }));
        OS.ajouter(c, h('h3', { class: 'titre-section' }, 'Couleur d\'accent'), accents);
        const fonds = h('div', { class: 'rangee', style: { flexWrap: 'wrap' } }), actuel = OS.fonds[OS.etat.fond] ? OS.etat.fond : OS.themes[OS.etat.theme].fonds[0];
        for (const nom of Object.keys(OS.fonds)) OS.ajouter(fonds, mini(nom, nom === actuel, OS.NOMS_FONDS[nom], () => { OS.regler({ fond: nom }); montrer('apparence'); }));
        OS.ajouter(c, h('h3', { class: 'titre-section' }, 'Fond d\'écran'), fonds);
      },
      applis(c) {
        entete(c, 'Applis d\'Odin', `${OS.etat.applis.length} installée${OS.etat.applis.length > 1 ? 's' : ''} sur ${OS.catalogue.length}. Une appli retirée reste disponible dans Odin Store.`);
        OS.ajouter(c, h('div', { class: 'rangee' }, h('button', { class: 'bouton primaire', onclick: () => OS.ouvrir('store', { section: 'odin' }) }, 'Ouvrir Odin Store')));
        for (const m of OS.catalogue.filter((x) => OS.installee(x.id))) {
          const cle = `odin:${m.id}`, epingle = OS.etat.epingles.includes(cle);
          OS.ajouter(c, h('div', { class: 'fiche' }, OS.tuile(OS.applis[cle], 42), h('div', { class: 'txt' }, h('b', null, m.nom), h('span', null, m.resume)),
            h('button', { class: 'bouton petit', onclick: () => { OS.regler({ epingles: epingle ? OS.etat.epingles.filter((x) => x !== cle) : [...OS.etat.epingles, cle] }); montrer('applis'); } }, epingle ? 'Retirer du dock' : 'Épingler au dock'),
            h('button', { class: 'bouton petit contour', onclick: () => { OS.retirerAppli(m.id); montrer('applis'); } }, 'Retirer')));
        }
      },
      async ponts(c) {
        entete(c, 'Compatibilité', 'Les applis Linux tournent directement. Pour Windows, Android et Mac, Odin OS installe un « pont » : il se télécharge une seule fois.');
        const s = await api.infos().catch(() => null), cap = (s && s.capacites) || {}; if (s && s.ok) api.systeme = s;
        OS.ajouter(c, h('div', { class: 'fiche' }, h('span', { class: 'tuile', style: { width: '42px', height: '42px', background: PLATEFORMES.linux.couleur } }, 'L'), h('div', { class: 'txt' }, h('b', null, 'Applis Linux'), h('span', null, cap.apt ? `Installées depuis le dépôt Ubuntu ou un fichier .deb.${cap.affichage ? '' : ' Ici, sans écran : les applis en ligne de commande. Les applis à fenêtre s\'affichent sur l\'image PC.'}` : 'Disponibles sur un Odin OS installé (Docker, LXC, PC).')), h('span', { class: `puce ${cap.apt ? 'bon' : ''}` }, cap.apt ? 'Prêt' : 'Pas ici')));
        for (const [id, p] of Object.entries(OS.PONTS)) {
          const e = (cap.ponts || {})[id] || {};
          OS.ajouter(c, h('div', { class: 'fiche' }, h('span', { class: 'tuile', style: { width: '42px', height: '42px', background: PLATEFORMES[id].couleur } }, PLATEFORMES[id].lettre), h('div', { class: 'txt' }, h('b', null, `${p.nom} · ${p.moteur}`), h('span', null, e.installe ? p.resume : (e.pourquoi || p.resume))),
            e.installe ? h('span', { class: 'puce bon' }, 'Installé') : e.possible ? h('button', { class: 'bouton petit primaire', onclick: async () => { await OS.installerPont(id); montrer('ponts'); } }, 'Installer') : h('span', { class: 'puce' }, 'Pas ici')));
        }
        OS.ajouter(c, h('div', { class: 'fiche' }, h('span', { class: 'tuile', style: { width: '42px', height: '42px', background: PLATEFORMES.iphone.couleur } }, 'i'), h('div', { class: 'txt' }, h('b', null, 'Applis iPhone'), h('span', null, 'Pas installables : Apple ne le permet pas hors d\'un iPhone. Odin te propose la version Android ou web.')), h('span', { class: 'puce' }, 'Impossible')));
      },
      telephone(c) {
        entete(c, 'Téléphone', 'Le style de l\'écran d\'accueil quand Odin OS s\'affiche sur un téléphone.');
        const styles = [['odin', 'Odin', 'Nuit et or, comme le bureau Odin.', 'anneaux'], ['lavande', 'Lavande', 'Disposition façon Android, tons clairs.', 'lavande'], ['verre', 'Verre', 'Icônes de verre, façon iPhone.', 'lagon']];
        const g = h('div', { class: 'grille', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))' } });
        for (const [id, nom, texte, fond] of styles) { const b = h('button', { type: 'button', class: 'carte', 'aria-pressed': String(OS.etat.mobile === id), style: { textAlign: 'left', padding: '10px', outline: OS.etat.mobile === id ? '3px solid var(--accent)' : 'none' }, onclick: () => { OS.regler({ mobile: id }); montrer('telephone'); } }); const v = h('div', { style: { height: '120px', borderRadius: '10px', overflow: 'hidden', marginBottom: '8px' } }); v.innerHTML = OS.fonds[fond](); v.firstChild.setAttribute('style', 'width:100%;height:100%'); OS.ajouter(b, v, h('b', null, nom), h('div', { class: 'attenue petit-texte' }, texte)); OS.ajouter(g, b); }
        if (window.OdinAndroid) {
          // Dans l'appli Android « Odin Launcher » : à quel Odin se relier, et le choix de l'écran d'accueil.
          const pont = window.OdinAndroid, adresse = h('input', { class: 'champ', placeholder: 'http://192.168.1.10:7777', 'aria-label': 'Adresse d\'Odin', style: { flex: '1' } });
          try { adresse.value = pont.adresse() || ''; } catch { /* pont incomplet */ }
          OS.ajouter(c, h('div', { class: 'carte' }, h('div', { class: 'titre-section' }, 'Odin Launcher'), h('p', { class: 'attenue petit-texte', style: { margin: '4px 0 10px' } }, 'L\'adresse de ton Odin (sur ce téléphone : http://127.0.0.1:7777, ou celle de ton serveur). Vide : mode essai.'),
            h('form', { class: 'rangee', onsubmit: (e) => { e.preventDefault(); try { pont.definirAdresse(adresse.value.trim()); } catch { /* rien */ } } }, adresse, h('button', { class: 'bouton primaire' }, 'Relier')),
            h('div', { class: 'rangee', style: { marginTop: '10px' } }, h('button', { class: 'bouton', onclick: () => { try { pont.reglage('lanceur'); } catch { /* rien */ } } }, 'Choisir Odin OS comme écran d\'accueil'))));
        }
        OS.ajouter(c, g, document.body.dataset.ecran === 'mobile' ? null : h('div', { class: 'rangee' }, h('button', { class: 'bouton', onclick: () => { location.href = `${location.pathname}?ecran=mobile${api.mode === 'essai' && location.protocol !== 'file:' ? '&essai' : ''}`; } }, OS.icone('telephone', 16), 'Voir l\'écran téléphone')));
      },
      async securite(c) {
        entete(c, 'Sécurité', 'Ullr (antivirus) et Skögul (anti-malware) protègent Odin OS. Forseti rassemble toutes les alertes.');
        const zone = ui.attente('Je demande à Ullr…'); OS.ajouter(c, zone);
        const r = await api.agir('ullr', 'etat').catch((e) => ({ ok: false, error: e.message }));
        const texte = (r && (r.text || r.error)) || 'Ullr ne répond pas.', souci = /⚠/.test(texte) || !r || r.ok === false;
        zone.replaceWith(h('div', { class: `bandeau ${souci ? 'attention' : ''}` }, OS.icone(souci ? 'alerte' : 'protege', 30), h('div', { style: { whiteSpace: 'pre-wrap', minWidth: 0 } }, texte)));
        OS.ajouter(c, h('div', { class: 'rangee', style: { flexWrap: 'wrap' } }, ...['ullr', 'skogul', 'forseti'].filter((id) => OS.applis[`odin:${id}`]).map((id) => h('button', { class: 'bouton', onclick: () => { OS.installerAppli(id, { silence: true }); OS.ouvrir(`odin:${id}`); } }, `Ouvrir ${OS.applis[`odin:${id}`].nom}`))),
          h('p', { class: 'attenue petit-texte' }, 'Aucun antivirus ne détecte toutes les menaces, Ullr non plus : reste prudent avec ce que tu ouvres.'));
      },
      async systeme(c) {
        entete(c, 'Système'); const zone = ui.attente('Je lis la machine…'); OS.ajouter(c, zone);
        const s = await api.infos().catch((e) => ({ ok: false, error: e.message }));
        if (!s.ok) return zone.replaceWith(ui.message(s.error || 'Infos indisponibles.', 'attention'));
        const m = s.machine, CIBLES = { essai: 'Mode essai (page seule)', docker: 'Conteneur Docker', lxc: 'Conteneur LXC', pc: 'Image PC', wsl: 'Windows (WSL)', mobile: 'Téléphone (base Ubuntu)', hote: 'Odin sur sa machine' };
        const lignes = [['Odin OS', `${s.os.version} · base ${s.os.base}`], ['Odin', s.odin.version || '—'], ['Installation', CIBLES[s.cible] || s.cible], ['Nom de la machine', m.nom], ['Processeur', `${m.processeur} · ${m.coeurs} cœur${m.coeurs > 1 ? 's' : ''}`], ['Mémoire', `${OS.taille(m.memoire.total - m.memoire.libre)} utilisés sur ${OS.taille(m.memoire.total)}`], ['Disque', `${OS.taille(m.disque.libre)} libres sur ${OS.taille(m.disque.total)}`], ['Noyau', m.noyau || '—']];
        zone.replaceWith(h('div', { class: 'carte' }, h('table', { class: 'liste' }, h('tbody', null, lignes.map(([a, b]) => h('tr', null, h('td', { class: 'attenue' }, a), h('td', { style: { userSelect: 'text' } }, b)))))));
        if (s.essai) OS.ajouter(c, h('div', null, OS.etiquetteEssai()));
        if (s.capacites.apt) OS.ajouter(c, ui.reglage('Mises à jour du système', 'Cherche les mises à jour d\'Ubuntu et des applis installées.', h('button', { class: 'bouton', onclick: () => ui.tache('Mises à jour', () => api.paquets('maj')) }, 'Chercher et installer')));
      },
      async compte(c) {
        entete(c, 'Compte');
        if (api.mode === 'essai') return OS.ajouter(c, ui.message('En mode essai, il n\'y a pas de compte : tout reste dans cette page. Le compte se crée au premier démarrage d\'un Odin OS installé.'));
        const r = await api.lire('/api/account/me').catch(() => null), p = r && r.profile;
        OS.ajouter(c, h('div', { class: 'carte rangee' }, OS.mascotte(56, { decor: true }), h('div', null, h('div', { class: 'titre-section' }, p ? `${p.prenom || ''} ${p.nom || ''}`.trim() || 'Propriétaire' : 'Connecté par jeton'), h('div', { class: 'attenue petit-texte' }, p ? p.email : 'Aucun compte créé : l\'accès passe par le lien de première connexion.'))),
          h('div', { class: 'rangee' }, h('button', { class: 'bouton', onclick: () => OS.verrouiller() }, OS.icone('cadenas', 16), 'Verrouiller'), h('a', { class: 'bouton contour', href: '/', target: '_blank', rel: 'noopener' }, 'Ouvrir l\'interface d\'Odin')));
      },
      apropos(c) {
        OS.ajouter(c, h('div', { class: 'rangee', style: { gap: '18px' } }, OS.mascotte(96), h('div', null, h('h2', { class: 'titre-app' }, 'Odin OS'), h('p', { class: 'attenue' }, `Version ${OS.version} · le bureau d'Odin, par TOUFATECH`))),
          h('div', { class: 'carte' }, h('p', null, 'Odin OS est un système léger construit sur Ubuntu LTS. Le bureau que tu vois est servi par Odin : il s\'affiche sur un PC, dans un navigateur ou sur un téléphone.'), h('p', { class: 'attenue petit-texte', style: { marginTop: '8px' } }, 'Les thèmes Verre, Fenêtres, Libre et Néon reprennent des dispositions familières ; les icônes, fonds et polices sont ceux d\'Odin OS. Aucune marque, icône ou image d\'un autre système n\'est utilisée.')),
          h('div', { class: 'carte' }, h('div', { class: 'titre-section' }, 'Dans cette version 0.1'), h('p', { class: 'attenue petit-texte', style: { marginTop: '6px', whiteSpace: 'pre-wrap' } }, '• Bureau (5 thèmes) et écran téléphone (3 styles)\n• Fichiers, Terminal, Réglages, Odin Store, les applis d\'Odin, Ullr\n• Applis Linux ; ponts Windows, Android et Mac à installer à la demande sur un Odin OS installé\n• Pas encore : formats AppImage / Flatpak / Snap, sauvegarde et mises à jour avec retour arrière depuis le bureau')));
      },
    };
    montrer(section);
  } });

  // ═══ Terminal ═══
  const AIDE = [['odin install <appli>', 'Installe une appli d\'Odin ou un paquet Linux'], ['odin remove <appli>', 'Retire une appli'], ['odin search <mot>', 'Cherche dans Odin Store'], ['odin compat <fichier>', 'Dit si une appli peut tourner ici'], ['odin update', 'Met à jour le système'], ['odin theme <nom>', 'odin, verre, fenetres, libre, neon (+ --sombre ou --clair)'], ['odin ouvre <appli>', 'Ouvre une appli du bureau'], ['odin applis', 'Liste les applis d\'Odin'], ['odin etat', 'État de la machine'], ['odin aide "question"', 'Pose une question à Odin'], ['odin <demande>', 'Une demande en français : « odin les alertes »'], ['efface', 'Vide l\'écran']];
  declarer({ id: 'terminal', nom: 'Terminal', icone: 'terminal', couleur: ['#3B4A5E', '#0F1826'], largeur: 820, hauteur: 520, multiple: true, ouvrir(ctx) {
    let dossier = '', maison = '', attente = null, rang = -1; const passe = [];
    const sortie = h('div', { class: 'sortie', role: 'log', 'aria-live': 'polite', 'aria-label': 'Sortie du terminal' });
    const invite = h('span'), champ = h('input', { 'aria-label': 'Commande', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    OS.ajouter(ctx.corps, h('div', { class: 'terminal', onclick: () => { if (!String(getSelection())) champ.focus(); } }, sortie, h('div', { class: 'saisie' }, invite, champ)));
    const court = () => (!dossier ? '~' : dossier === maison ? '~' : dossier.startsWith(`${maison}/`) ? `~/${dossier.slice(maison.length + 1)}` : dossier);
    const dessinerInvite = () => OS.poser(invite, h('span', { class: 't-invite' }, 'odin@odin-os'), ' ', h('span', { class: 't-chemin' }, court()), ' ', h('span', { class: 't-fleche' }, attente ? '[o/n]' : '❯'));
    const ecrire = (texte, classe) => { OS.ajouter(sortie, classe ? h('span', { class: classe }, texte) : document.createTextNode(texte), '\n'); sortie.scrollTop = sortie.scrollHeight; };
    const odinDit = (texte, classe) => { OS.ajouter(sortie, h('span', { class: 't-odin' }, '◉ Odin  '), classe ? h('span', { class: classe }, texte) : texte, '\n'); sortie.scrollTop = sortie.scrollHeight; };
    const demanderOuiNon = (question, suite) => { odinDit(`${question} [o/n]`); attente = suite; dessinerInvite(); };
    const trouverOdin = (mot) => OS.catalogue.find((m) => OS.sansAccent(m.nom) === OS.sansAccent(mot) || m.id === OS.sansAccent(mot));
    const tache = async (lancer) => { const r = await lancer(); if (!r || r.ok === false) return ecrire((r && (r.error || r.text)) || 'Refusé.', 't-err'); if (!r.tache) return ecrire(r.text || r.sortie || 'Fait.'); let vu = 0; for (;;) { await new Promise((s) => setTimeout(s, 1200)); const t = await api.lire(`/api/os/tache?id=${encodeURIComponent(r.tache)}`); if (!t.ok) return ecrire(t.error || 'Tâche perdue.', 't-err'); const j = t.journal || ''; if (j.length > vu) { ecrire(j.slice(vu).replace(/\n$/, ''), 't-gris'); vu = j.length; } if (t.etat !== 'en cours') return ecrire(t.etat === 'fini' ? '✓ Terminé' : `✗ Échec (code ${t.code})`, t.etat === 'fini' ? 't-ok' : 't-err'); } };
    async function odin(args) {
      const [sous, ...reste] = args, mot = reste.filter((a) => !a.startsWith('--')).join(' '), cap = (api.systeme && api.systeme.capacites) || {};
      switch (sous) {
        case undefined: case 'aide': case 'help':
          if (mot) { if (api.mode === 'essai') return odinDit(OS.essai.repondre(mot)); odinDit('Je réfléchis…', 't-gris'); return new Promise((fin) => { const arret = api.flux((m) => { if (m.texte) { arret(); clearTimeout(garde); odinDit(m.texte); fin(); } }); const garde = setTimeout(() => { arret(); odinDit('Pas de réponse pour l\'instant. Ouvre ma bulle pour continuer la discussion.', 't-gris'); fin(); }, 90000); api.message(mot).catch((e) => { arret(); clearTimeout(garde); odinDit(e.message, 't-err'); fin(); }); }); }
          ecrire('Commandes d\'Odin OS :'); for (const [c, d] of AIDE) { OS.ajouter(sortie, h('span', { class: 't-odin' }, `  ${c.padEnd(24)}`), h('span', { class: 't-gris' }, d), '\n'); } return ecrire(cap.terminal ? 'Les commandes Linux habituelles marchent aussi (ls, cat, apt…). Pas de programme interactif (nano, top) dans cette version.' : 'Les commandes Linux (ls, apt…) marchent sur un Odin OS installé.', 't-gris');
        case 'theme': { const nom = OS.sansAccent(reste.find((a) => !a.startsWith('--')) || ''); if (!OS.themes[nom]) return ecrire(`Thèmes : ${Object.keys(OS.themes).join(', ')}`, 't-err'); OS.regler({ theme: nom, fond: '', ...(reste.includes('--sombre') ? { apparence: 'sombre' } : reste.includes('--clair') ? { apparence: 'clair' } : reste.includes('--auto') ? { apparence: 'auto' } : {}) }); return ecrire(`✓ Thème ${OS.themes[nom].nom} appliqué`, 't-ok'); }
        case 'applis': for (const m of OS.catalogue) { OS.ajouter(sortie, h('span', { class: OS.installee(m.id) ? 't-ok' : 't-gris' }, OS.installee(m.id) ? '  ✓ ' : '  · '), m.nom.padEnd(14), h('span', { class: 't-gris' }, m.resume.slice(0, 70)), '\n'); } return;
        case 'ouvre': case 'open': { const a = Object.values(OS.applis).find((x) => OS.sansAccent(x.nom) === OS.sansAccent(mot) || x.id === mot); if (!a) return ecrire(`Appli introuvable : ${mot}`, 't-err'); OS.ouvrir(a.id); return ecrire(`✓ ${a.nom}`, 't-ok'); }
        case 'install': case 'installe': case 'installer': {
          if (!mot) return ecrire('Dis-moi quoi : odin install ullr', 't-err');
          const m = trouverOdin(mot); if (m) return odinDit(OS.installerAppli(m.id) ? `${m.nom} installé · ajouté au lanceur` : `${m.nom} est déjà installé`, 't-ok');
          if (OS.plateformeDe(mot)) { const v = OS.compat(mot); odinDit(v.titre); return ecrire(v.texte, 't-gris'); }
          if (!cap.apt) return odinDit(`« ${mot} » n'est pas une appli d'Odin. Les paquets Linux s'installent sur un Odin OS installé (Docker, LXC, PC).`);
          return new Promise((fin) => demanderOuiNon(`Installer le paquet Linux « ${mot} » depuis le dépôt Ubuntu ?`, async () => { await tache(() => api.paquets('installer', mot)); fin(); })).catch(() => {});
        }
        case 'remove': case 'retire': case 'retirer': { const m = trouverOdin(mot); if (m) return odinDit(OS.retirerAppli(m.id) ? `${m.nom} retiré du bureau` : `${m.nom} n'était pas installé`); if (!cap.apt) return ecrire(`Appli inconnue : ${mot}`, 't-err'); return new Promise((fin) => demanderOuiNon(`Retirer le paquet Linux « ${mot} » ?`, async () => { await tache(() => api.paquets('retirer', mot)); fin(); })); }
        case 'search': case 'cherche': { const q = OS.sansAccent(mot), trouve = OS.catalogue.filter((m) => OS.sansAccent(`${m.nom} ${m.resume}`).includes(q)); for (const m of trouve) { OS.ajouter(sortie, h('span', { class: 't-odin' }, `  ${m.nom.padEnd(14)}`), h('span', { class: 't-gris' }, `appli d'Odin · ${m.resume.slice(0, 60)}`), '\n'); } if (cap.apt && mot) { const r = await api.paquets('chercher', mot); for (const p of (r.paquets || []).slice(0, 15)) { OS.ajouter(sortie, `  ${p.nom.padEnd(24)}`, h('span', { class: 't-gris' }, `Linux${p.installe ? ' · installé' : ''} · ${p.resume.slice(0, 60)}`), '\n'); } } else if (!trouve.length) ecrire('Rien trouvé.', 't-gris'); return; }
        case 'compat': { if (!mot) return ecrire('odin compat <fichier>', 't-err'); const v = OS.compat(mot); odinDit(v.titre, v.verdict === 'ok' ? 't-ok' : v.verdict === 'impossible' ? 't-err' : ''); return ecrire(v.texte, 't-gris'); }
        case 'update': case 'maj': if (!cap.apt) return odinDit('Les mises à jour se font sur un Odin OS installé. Ici, recharge la page pour avoir la dernière version du bureau.'); return tache(() => api.paquets('maj'));
        case 'etat': { const s = await api.infos(); if (!s.ok) return ecrire(s.error, 't-err'); const m = s.machine; ecrire(`Odin OS ${s.os.version} (${s.os.base}) · ${s.cible}${s.essai ? ' · données d\'exemple' : ''}`); return ecrire(`${m.nom} · ${m.coeurs} cœurs · mémoire ${OS.taille(m.memoire.total - m.memoire.libre)}/${OS.taille(m.memoire.total)} · disque libre ${OS.taille(m.disque.libre)}`, 't-gris'); }
        case 'vm': case 'backup': return odinDit(`« odin ${sous} » n'est pas encore dans Odin OS 0.1.${sous === 'backup' ? ' Pour sauvegarder, installe l\'appli Sindri (odin install sindri).' : ' Pour les machines virtuelles et les conteneurs, installe Naglfar (odin install naglfar).'}`);
        default: { const phrase = args.join(' '); const r = await api.ordre(phrase); if (r && r.confirm) return new Promise((fin) => demanderOuiNon(r.confirm, async () => { const r2 = await api.ordre(phrase, true); odinDit((r2 && (r2.text || r2.error)) || 'Fait.'); fin(); })); return odinDit((r && (r.text || r.error)) || 'Pas de réponse.'); }
      }
    }
    async function executer(ligne) {
      OS.ajouter(sortie, h('span', { class: 't-invite' }, 'odin@odin-os'), ' ', h('span', { class: 't-chemin' }, court()), ' ', h('span', { class: 't-fleche' }, '❯'), ` ${ligne}\n`);
      if (attente) { const suite = attente; attente = null; if (/^(o|oui|y|yes)$/i.test(ligne.trim())) await suite(); else ecrire('Annulé.', 't-gris'); return; }
      const l = ligne.trim(); if (!l) return;
      passe.unshift(l); rang = -1;
      const mots = l.match(/"[^"]*"|'[^']*'|\S+/g).map((m) => m.replace(/^["']|["']$/g, ''));
      if (['efface', 'clear', 'cls'].includes(mots[0])) return OS.vider(sortie);
      if (['aide', 'help', '?'].includes(mots[0])) return odin(['aide']);
      if (mots[0] === 'odin') return odin(mots.slice(1));
      const envoyer = async (confirme) => { const r = await api.terminal(l, dossier, confirme); if (r && r.confirm) return demanderOuiNon(r.confirm, () => envoyer(true)); if (!r || r.ok === false) return ecrire((r && r.error) || 'Commande refusée.', 't-err'); if (r.sortie) ecrire(r.sortie.replace(/\n$/, ''), r.code ? 't-err' : ''); if (r.dossier) dossier = r.dossier; };
      return envoyer(false);
    }
    champ.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') { const v = champ.value; champ.value = ''; champ.disabled = true; try { await executer(v); } catch (err) { ecrire(err.message, 't-err'); } champ.disabled = false; dessinerInvite(); champ.focus(); sortie.scrollTop = sortie.scrollHeight; }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (rang < passe.length - 1) champ.value = passe[++rang]; }
      else if (e.key === 'ArrowDown') { e.preventDefault(); champ.value = rang > 0 ? passe[--rang] : (rang = -1, ''); }
      else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); OS.vider(sortie); }
    });
    (async () => { const r = await api.fichiers('').catch(() => null); if (r && r.ok) { maison = r.maison; dossier = r.maison; } dessinerInvite(); odinDit('Bienvenue dans le Terminal. Tape « aide » pour voir les commandes.', 't-gris'); if (api.mode === 'essai') ecrire('Mode essai : pas de vrai système derrière, seules les commandes d\'Odin et quelques commandes d\'exemple répondent.', 't-gris'); if (ctx.options.commande) { champ.value = ''; await executer(ctx.options.commande); dessinerInvite(); } if (!ctx.mobile) champ.focus(); })();
  } });
})();
