// Odin OS — le bureau (ordinateur) : fond, barre, widgets, fenêtres, dock, lanceur, centre de contrôle,
// notifications et la bulle d'Odin. La disposition suit le thème (voir shell.css).
(() => {
  'use strict';
  const OS = window.OS, h = OS.h, api = OS.api, ui = OS.ui;
  const B = OS.bureau = { fenetres: [], notifications: [] };
  let z = 30, numero = 0, racine, bureau, dock, lanceur, controle, notifs, assistant, barre, widgets;
  const active = () => B.fenetres.filter((f) => !f.reduite).sort((a, b) => b.z - a.z)[0];

  // ——— Fenêtres ———
  function activer(f) {
    if (!f) { barre.querySelector('.nom-appli').textContent = 'Bureau'; return dessinerDock(); }
    f.reduite = false; f.z = ++z; f.el.style.zIndex = f.z; f.el.classList.remove('reduite');
    for (const g of B.fenetres) g.el.classList.toggle('active', g === f);
    barre.querySelector('.nom-appli').textContent = f.appli.nom;
    dessinerDock();
  }
  function fermer(f) { for (const g of f.nettoyage) { try { g(); } catch { /* rien */ } } f.el.remove(); B.fenetres = B.fenetres.filter((g) => g !== f); activer(active()); }
  function reduire(f) { f.reduite = true; f.el.classList.add('reduite'); f.el.classList.remove('active'); activer(active()); }
  const agrandir = (f) => { f.el.classList.toggle('agrandie'); };
  /** Déplacement ou redimensionnement à la souris ou au doigt. */
  function tirer(poignee, f, mode) {
    poignee.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button') || f.el.classList.contains('agrandie')) return;
      e.preventDefault(); activer(f); poignee.setPointerCapture(e.pointerId);
      const r = f.el.getBoundingClientRect(), zone = bureau.getBoundingClientRect(), dx = e.clientX, dy = e.clientY;
      const bouger = (ev) => {
        if (mode === 'deplacer') { f.el.style.left = `${Math.max(-r.width + 120, Math.min(zone.width - 80, r.left - zone.left + ev.clientX - dx))}px`; f.el.style.top = `${Math.max(0, Math.min(zone.height - 60, r.top - zone.top + ev.clientY - dy))}px`; }
        if (mode !== 'deplacer' && mode !== 'bas') f.el.style.width = `${Math.max(320, r.width + ev.clientX - dx)}px`;
        if (mode !== 'deplacer' && mode !== 'droite') f.el.style.height = `${Math.max(200, r.height + ev.clientY - dy)}px`;
      };
      const fin = () => { poignee.removeEventListener('pointermove', bouger); poignee.removeEventListener('pointerup', fin); poignee.removeEventListener('pointercancel', fin); };
      poignee.addEventListener('pointermove', bouger); poignee.addEventListener('pointerup', fin); poignee.addEventListener('pointercancel', fin);
    });
  }
  /** Ouvre une appli (ou ramène sa fenêtre devant). `options` est passé à l'appli (dossier à ouvrir, section…). */
  B.ouvrir = (id, options = {}) => {
    const appli = OS.applis[id]; if (!appli) return null;
    fermerPanneaux();
    if (appli.lancer) { appli.lancer(); return null; }
    const deja = B.fenetres.find((f) => f.appli.id === id);
    if (deja && !appli.multiple) { if (Object.keys(options).length) fermer(deja); else { activer(deja); return deja; } }
    const zone = bureau.getBoundingClientRect(), l = Math.min(appli.largeur, zone.width - 24), ht = Math.min(appli.hauteur, zone.height - 110), n = numero++ % 8;
    const titre = h('span', { class: 'titre-f' }, appli.nom), corps = h('div', { class: 'corps' });
    const f = { id: `f${numero}`, appli, nettoyage: [], reduite: false, z: 0 };
    const entete = h('div', { class: 'entete', ondblclick: (e) => { if (!e.target.closest('button')) agrandir(f); } }, titre,
      h('div', { class: 'ctrl' }, h('button', { type: 'button', class: 'reduire', 'aria-label': 'Réduire', title: 'Réduire', onclick: () => reduire(f) }, '─'), h('button', { type: 'button', class: 'agrandir', 'aria-label': 'Agrandir', title: 'Agrandir', onclick: () => agrandir(f) }, '☐'), h('button', { type: 'button', class: 'fermer', 'aria-label': 'Fermer', title: 'Fermer', onclick: () => fermer(f) }, '✕')));
    const bd = h('div', { class: 'bord-d' }), bb = h('div', { class: 'bord-b' }), coin = h('div', { class: 'poignee' });
    f.el = h('section', { class: 'fenetre', role: 'dialog', 'aria-label': appli.nom, tabindex: '-1', style: { left: `${Math.max(12, Math.round((zone.width - l) / 2) - 84 + n * 26)}px`, top: `${Math.max(8, Math.round((zone.height - ht) / 2) - 70 + n * 24)}px`, width: `${l}px`, height: `${ht}px` }, onpointerdown: () => { if (active() !== f) activer(f); } }, entete, corps, bd, bb, coin);
    tirer(entete, f, 'deplacer'); tirer(bd, f, 'droite'); tirer(bb, f, 'bas'); tirer(coin, f, 'coin');
    OS.ajouter(bureau, f.el); B.fenetres.push(f); activer(f);
    const ctx = { corps, mobile: false, options, titre: (t) => { titre.textContent = t; f.el.setAttribute('aria-label', t); }, fermer: () => fermer(f), surFermeture: (g) => f.nettoyage.push(g) };
    try { Promise.resolve(appli.ouvrir(ctx)).catch((e) => { OS.poser(corps, h('div', { class: 'contenu' }, ui.message(`Cette appli a rencontré un souci : ${e.message}`, 'mauvais'))); }); }
    catch (e) { OS.poser(corps, h('div', { class: 'contenu' }, ui.message(`Cette appli a rencontré un souci : ${e.message}`, 'mauvais'))); }
    f.el.focus({ preventScroll: true });
    return f;
  };

  // ——— Dock (ou barre des tâches) ———
  function boutonAppli(appli) {
    const ouvertes = B.fenetres.filter((f) => f.appli.id === appli.id), devant = active();
    const b = h('button', { type: 'button', class: `app ${ouvertes.length ? 'ouverte' : ''}`, 'aria-label': appli.nom, title: appli.nom, onclick: () => { const f = ouvertes.sort((x, y) => y.z - x.z)[0]; if (!f) OS.ouvrir(appli.id); else if (f === devant && !f.reduite) reduire(f); else activer(f); },
      oncontextmenu: (e) => { e.preventDefault(); const epingle = OS.etat.epingles.includes(appli.id); ui.menu(e.clientX, e.clientY - 8, [{ nom: appli.multiple && ouvertes.length ? 'Nouvelle fenêtre' : 'Ouvrir', icone: 'fenetre', action: () => OS.ouvrir(appli.id) }, { nom: epingle ? 'Retirer du dock' : 'Garder dans le dock', icone: 'etoile', action: () => OS.regler({ epingles: epingle ? OS.etat.epingles.filter((x) => x !== appli.id) : [...OS.etat.epingles, appli.id] }) }, ...(ouvertes.length ? [null, { nom: 'Fermer', icone: 'croix', action: () => ouvertes.forEach(fermer) }] : [])]); } }, OS.tuile(appli, 58, true));
    return b;
  }
  function dessinerDock() {
    if (!dock) return;
    const epingles = OS.etat.epingles.map((id) => OS.applis[id]).filter((a) => a && (!a.odin || OS.installee(a.odin)));
    const autres = [...new Set(B.fenetres.map((f) => f.appli))].filter((a) => !epingles.includes(a));
    const plateau = h('div', { class: 'plateau' }, api.mode === 'essai' ? OS.etiquetteEssai('Essai') : null, h('button', { type: 'button', 'aria-label': 'Centre de contrôle', onclick: () => basculer(controle) }, OS.icone('controle', 16)), h('span', { class: 'horloge-p', style: { textAlign: 'right', lineHeight: '1.25' } }, OS.heure(), h('br'), OS.jour()));
    OS.poser(dock, h('div', { class: 'zone' }, h('button', { type: 'button', class: 'app lanceur-b', 'aria-label': 'Toutes les applis', title: 'Toutes les applis', 'aria-expanded': String(lanceur.classList.contains('ouvert')), onclick: () => basculer(lanceur) }, h('span', { class: 'tuile' }, OS.icone('grille', 26))), epingles.map(boutonAppli), autres.length ? h('span', { class: 'sep' }) : null, autres.map(boutonAppli)),
      h('span', { class: 'sep' }), h('button', { type: 'button', class: 'app', 'aria-label': 'Parler à Odin', title: 'Parler à Odin', onclick: () => basculer(assistant) }, OS.mascotte(0, { decor: true })), plateau);
  }

  // ——— Panneaux : lanceur, centre de contrôle, assistant (un seul ouvert à la fois) ———
  function fermerPanneaux(sauf) { for (const p of [lanceur, controle, assistant]) if (p && p !== sauf) p.classList.remove('ouvert'); }
  function basculer(p, forcer) {
    const ouvrir = forcer === undefined ? !p.classList.contains('ouvert') : forcer;
    fermerPanneaux(p); p.classList.toggle('ouvert', ouvrir);
    if (!ouvrir) return;
    if (p === lanceur) { dessinerLanceur(''); const c = lanceur.querySelector('input'); c.value = ''; c.focus(); }
    if (p === controle) dessinerControle();
    if (p === assistant) assistant.querySelector('input').focus();
  }
  function dessinerLanceur(filtre) {
    const q = OS.sansAccent(filtre), liste = OS.applisVisibles().filter((a) => !q || OS.sansAccent(`${a.nom} ${a.resume || ''}`).includes(q)).sort((a, b) => (Boolean(a.odin) - Boolean(b.odin)) || (Boolean(a.linux) - Boolean(b.linux)) || a.nom.localeCompare(b.nom, 'fr'));
    const grille = lanceur.querySelector('.applis');
    OS.poser(grille, ...liste.map((a) => h('button', { type: 'button', title: a.resume || a.nom, onclick: () => OS.ouvrir(a.id) }, OS.tuile(a, 62, true), h('span', null, a.nom))));
    if (!liste.length) OS.ajouter(grille, h('p', { class: 'attenue', style: { gridColumn: '1/-1', textAlign: 'center' } }, 'Aucune appli avec ce nom. Cherche dans Odin Store.'));
    lanceur.querySelector('.titre-l span').textContent = q ? 'Résultats' : 'Toutes les applis';
  }
  function dessinerControle() {
    const sombre = document.body.dataset.apparence === 'sombre', s = api.systeme, m = s && s.machine;
    const tuile = (icone, titre, detail, presse, action) => h('button', { type: 'button', class: 'tuile-c', 'aria-pressed': presse === null ? null : String(presse), onclick: action }, h('i', null, OS.icone(icone, 18)), h('span', null, h('b', null, titre), h('br'), h('span', { class: 'attenue' }, detail)));
    OS.poser(controle, h('div', { class: 'deux' },
      tuile(sombre ? 'lune' : 'soleil', 'Apparence', sombre ? 'Sombre' : 'Claire', sombre, () => { OS.regler({ apparence: sombre ? 'clair' : 'sombre' }); dessinerControle(); }),
      tuile('cloche', 'Concentration', OS.etat.concentration ? 'Notifications en silence' : 'Notifications affichées', OS.etat.concentration, () => { OS.regler({ concentration: !OS.etat.concentration }); dessinerControle(); }),
      tuile('ecran', 'Plein écran', document.fullscreenElement ? 'Activé' : 'Désactivé', Boolean(document.fullscreenElement), async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { /* refusé par le navigateur */ } setTimeout(dessinerControle, 200); }),
      tuile('protege', 'Ullr', 'Antivirus d\'Odin', null, () => { OS.installerAppli('ullr', { silence: true }); OS.ouvrir('odin:ullr'); })),
      h('div', { class: 'carte', style: { padding: '10px 12px' } }, h('div', { class: 'rangee entre' }, h('b', null, 'Thème'), h('span', { class: 'attenue' }, OS.themes[OS.etat.theme].nom)), h('div', { class: 'rangee', style: { gap: '6px', marginTop: '8px' } }, Object.entries(OS.themes).map(([id, t]) => h('button', { type: 'button', 'aria-label': `Thème ${t.nom}`, title: t.nom, 'aria-pressed': String(OS.etat.theme === id), onclick: () => { OS.regler({ theme: id, fond: '' }); basculer(controle, true); }, style: { flex: '1', height: '34px', borderRadius: '9px', background: t.apercu, outline: OS.etat.theme === id ? '2px solid var(--accent)' : 'none', outlineOffset: '2px' } })))),
      m ? h('div', { class: 'carte petit-texte', style: { padding: '10px 12px' } }, h('div', { class: 'rangee entre' }, h('b', null, m.nom), s.essai ? OS.etiquetteEssai('Exemple') : h('span', { class: 'attenue' }, s.cible)), h('div', { class: 'attenue', style: { marginTop: '4px' } }, `Mémoire ${OS.taille(m.memoire.total - m.memoire.libre)} / ${OS.taille(m.memoire.total)} · disque libre ${OS.taille(m.disque.libre)}`)) : null,
      B.notifications.length ? h('div', { class: 'carte petit-texte', style: { padding: '10px 12px', maxHeight: '150px', overflow: 'auto' } }, h('b', null, 'Dernières notifications'), B.notifications.slice(0, 6).map((n) => h('div', { style: { marginTop: '6px' } }, h('span', null, n.titre), n.texte ? h('div', { class: 'attenue' }, n.texte) : null))) : null,
      h('div', { class: 'rangee' }, h('button', { class: 'bouton petit', style: { flex: '1' }, onclick: () => OS.ouvrir('reglages') }, OS.icone('reglages', 15), 'Réglages'), h('button', { class: 'bouton petit', style: { flex: '1' }, onclick: () => OS.verrouiller() }, OS.icone('cadenas', 15), 'Verrouiller')));
  }

  // ——— Notifications ———
  B.notifier = (n) => {
    B.notifications.unshift({ ...n, a: Date.now() }); B.notifications.length = Math.min(B.notifications.length, 30);
    if (OS.etat.concentration || !notifs) return;
    const fermerN = () => el.remove();
    const el = h('div', { class: 'notif', role: 'status' }, n.appli ? OS.tuile(n.appli, 40, true) : OS.mascotte(40, { decor: true }), h('div', { style: { flex: '1', minWidth: 0 } }, h('b', null, n.titre), n.texte ? h('span', { class: 'attenue', style: { display: '-webkit-box', WebkitLineClamp: '4', WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap' } }, n.texte) : null), n.ouvrir ? h('button', { class: 'bouton petit', onclick: () => { OS.ouvrir(n.ouvrir); fermerN(); } }, 'Ouvrir') : null, h('button', { class: 'icone-b', 'aria-label': 'Fermer la notification', onclick: fermerN }, OS.icone('croix', 14)));
    OS.ajouter(notifs, el); setTimeout(fermerN, n.duree || 7000);
  };

  // ——— La bulle d'Odin (assistant) ———
  function monterAssistant() {
    const d = ui.discussion({ surReponse: (texte) => { if (!assistant.classList.contains('ouvert')) B.notifier({ titre: 'Odin', texte }); } });
    B.arretFlux = d.arret;
    assistant = h('aside', { id: 'assistant', 'aria-label': 'Odin, ton assistant' },
      h('header', null, d.visage, h('div', { style: { flex: '1' } }, h('b', null, 'Odin'), h('br'), d.etat), h('button', { class: 'icone-b', 'aria-label': 'Fermer', onclick: () => basculer(assistant, false) }, OS.icone('croix', 16))),
      d.fil, d.idees, d.form);
    return assistant;
  }

  // ——— Widgets (seulement des données vraies : heure, date, machine, sécurité) ———
  function dessinerWidgets() {
    if (!widgets) return;
    const theme = OS.etat.theme, d = new Date(), heure = d.getHours(), salut = heure < 5 || heure >= 18 ? 'Bonsoir !' : 'Bonjour !', s = api.systeme, m = s && s.machine;
    const horloge = h('div', { class: 'widget' }, h('div', { class: 'grand' }, OS.heure()), h('div', { class: 'petit', style: { textTransform: 'capitalize' } }, OS.jour(true)));
    const pct = (v) => Math.max(0, Math.min(100, Math.round(v)));
    const anneau = (nom, valeur, couleur) => h('div', { class: 'anneau' }, h('i', { style: { background: `conic-gradient(${couleur} ${valeur}%, rgba(127,127,127,.25) 0)` } }, h('span', null, `${valeur}%`)), nom);
    const machine = m ? h('div', { class: 'widget', title: s.essai ? 'Valeurs d\'exemple (mode essai)' : m.nom }, h('div', { class: 'anneaux' }, anneau('Mémoire', pct((1 - m.memoire.libre / m.memoire.total) * 100), '#34D399'), anneau('Disque', pct((1 - m.disque.libre / m.disque.total) * 100), '#60A5FA'), anneau('Charge', pct((m.charge || 0) / (m.coeurs || 1) * 100), '#F472B6')), s.essai ? h('div', { style: { marginTop: '8px' } }, OS.etiquetteEssai('Exemple')) : null) : null;
    const odin = h('div', { class: 'widget' }, h('div', { class: 'ligne-odin' }, OS.mascotte(50, { decor: true }), h('div', null, h('b', { style: { fontSize: '16px' } }, salut), h('div', { class: 'petit', style: { marginTop: '2px' }, id: 'w-etat' }, B.securite ? B.securite.phrase : 'Je veille sur ta machine.'))),
      h('div', { class: 'trois' }, h('div', null, h('b', { style: { color: B.securite && B.securite.souci ? 'var(--attention)' : 'var(--bon)' } }, B.securite ? (B.securite.souci ? '⚠' : 'OK') : '…'), 'Sécurité'), h('div', null, h('b', null, String(OS.etat.applis.length)), 'Applis Odin'), h('div', null, h('b', null, m ? OS.taille(m.disque.libre) : '…'), 'Disque libre')));
    const premier = new Date(d.getFullYear(), d.getMonth(), 1), decalage = (premier.getDay() + 6) % 7, jours = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const cal = h('div', { class: 'widget blanc' }, h('div', { class: 'cal' }, h('b', null, d.toLocaleDateString('fr-FR', { month: 'long' }).toUpperCase()), ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((j) => h('span', { class: 'entete' }, j)), Array.from({ length: decalage }, () => h('span')), Array.from({ length: jours }, (_, i) => h('span', { class: i + 1 === d.getDate() ? 'jour' : null }, String(i + 1)))));
    OS.poser(widgets, ...(theme === 'verre' ? [horloge, cal, machine] : theme === 'neon' ? [horloge, machine] : [horloge, odin, machine]).filter(Boolean));
  }
  async function rafraichir() {
    try { const s = await api.infos(); if (s && s.ok) api.systeme = s; } catch { /* Odin ne répond pas : on garde les dernières valeurs */ }
    try { const r = await api.agir('ullr', 'etat'); if (r && r.text && !r.essai) B.securite = { souci: /⚠/.test(r.text), phrase: /⚠/.test(r.text) ? 'Ullr a quelque chose à te montrer.' : 'Tout va bien sur ta machine.' }; else if (r && r.essai) B.securite = { souci: false, phrase: 'Essai : la sécurité s\'affiche sur un Odin installé.' }; } catch { /* Ullr indisponible */ }
    dessinerWidgets();
  }

  // ——— Montage ———
  B.monter = () => {
    racine = document.getElementById('racine'); OS.ouvrir = B.ouvrir; OS.notifier = B.notifier;
    const horloge = h('button', { type: 'button', class: 'horloge', 'aria-label': 'Date et heure', onclick: () => basculer(controle) }, '');
    barre = h('header', { id: 'barre' }, h('div', { class: 'cote' }, h('button', { type: 'button', 'aria-label': 'Menu Odin OS', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); ui.menu(r.left, r.bottom + 6, [{ nom: 'À propos d\'Odin OS', icone: 'info', action: () => OS.ouvrir('reglages', { section: 'apropos' }) }, { nom: 'Réglages', icone: 'reglages', action: () => OS.ouvrir('reglages') }, { nom: 'Odin Store', icone: 'store', action: () => OS.ouvrir('store') }, null, { nom: 'Verrouiller', icone: 'cadenas', action: () => OS.verrouiller() }, { nom: 'Recharger le bureau', icone: 'maj', action: () => location.reload() }]); } }, OS.logo(18), h('span', { class: 'masque' }, 'Odin OS')), h('button', { type: 'button', class: 'activites', onclick: () => basculer(lanceur) }, 'Applis'), h('span', { class: 'nom-appli' }, 'Bureau')),
      h('div', { class: 'cote' }, api.mode === 'essai' ? OS.etiquetteEssai('Essai') : null, h('button', { type: 'button', 'aria-label': 'Parler à Odin', onclick: () => basculer(assistant) }, OS.mascotte(20, { decor: true })), h('button', { type: 'button', 'aria-label': 'Centre de contrôle', onclick: () => basculer(controle) }, OS.icone('controle', 16)), horloge));
    widgets = h('div', { class: 'widgets' });
    bureau = h('main', { id: 'bureau', 'aria-label': 'Bureau', oncontextmenu: (e) => { if (e.target !== bureau && !e.target.closest('.widgets')) return; e.preventDefault(); ui.menu(e.clientX, e.clientY, [{ nom: 'Changer le fond d\'écran', icone: 'image', action: () => OS.ouvrir('reglages', { section: 'apparence' }) }, { nom: 'Ouvrir le Terminal', icone: 'terminal', action: () => OS.ouvrir('terminal') }, { nom: 'Ouvrir Fichiers', icone: 'dossier', action: () => OS.ouvrir('fichiers') }, null, { nom: 'Odin Store', icone: 'store', action: () => OS.ouvrir('store') }]); }, onpointerdown: (e) => { if (e.target === bureau) fermerPanneaux(); } }, widgets);
    dock = h('nav', { id: 'dock', 'aria-label': 'Dock' });
    lanceur = h('div', { id: 'lanceur', role: 'dialog', 'aria-label': 'Toutes les applis', onpointerdown: (e) => { if (e.target === lanceur) basculer(lanceur, false); } },
      h('div', { class: 'recherche' }, OS.icone('loupe', 18), h('input', { placeholder: 'Chercher une appli…', 'aria-label': 'Chercher une appli', oninput: (e) => dessinerLanceur(e.target.value), onkeydown: (e) => { if (e.key === 'Enter') { const b = lanceur.querySelector('.applis button'); if (b) b.click(); } } })),
      h('div', { class: 'titre-l' }, h('span', null, 'Toutes les applis'), h('button', { class: 'bouton petit', onclick: () => OS.ouvrir('store') }, 'Odin Store ›')),
      h('div', { class: 'applis' }),
      h('div', { class: 'pied' }, h('span', { class: 'rangee' }, OS.mascotte(28, { decor: true }), (api.systeme && api.systeme.compte && api.systeme.compte.prenom) || 'Odin OS'), h('span', { class: 'rangee' }, h('button', { class: 'icone-b', 'aria-label': 'Réglages', onclick: () => OS.ouvrir('reglages') }, OS.icone('reglages', 16)), h('button', { class: 'icone-b', 'aria-label': 'Verrouiller', onclick: () => OS.verrouiller() }, OS.icone('arret', 16)))));
    controle = h('aside', { id: 'controle', 'aria-label': 'Centre de contrôle' });
    notifs = h('div', { id: 'notifs', 'aria-label': 'Notifications' });
    OS.poser(racine, h('div', { id: 'fond' }), barre, bureau, dock, lanceur, controle, notifs, monterAssistant());
    OS.appliquerTheme(); dessinerDock(); dessinerWidgets();
    const tic = () => { horloge.textContent = `${OS.jour()}  ${OS.heure()}`; const p = dock.querySelector('.horloge-p'); if (p) OS.poser(p, OS.heure(), h('br'), OS.jour()); const g = widgets.querySelector('.grand'); if (g) g.textContent = OS.heure(); };
    tic(); B.minuterie = [setInterval(tic, 15000), setInterval(rafraichir, 60000)];
    OS.sur('theme', () => { dessinerDock(); dessinerWidgets(); }); OS.sur('etat', dessinerDock); OS.sur('catalogue', dessinerDock);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerPanneaux(); if ((e.key === 'Meta' || (e.key === ' ' && e.ctrlKey)) && !e.repeat) { e.preventDefault(); basculer(lanceur); } });
    document.addEventListener('pointerdown', (e) => { if (controle.classList.contains('ouvert') && !controle.contains(e.target) && !e.target.closest('#barre,#dock')) basculer(controle, false); }, true);
    rafraichir();
  };
})();
