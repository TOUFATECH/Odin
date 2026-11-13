// Odin OS — l'écran téléphone : barre d'état, accueil, dock, navigation, écrans d'applis, volet
// (réglages rapides et notifications). Trois styles d'accueil : Odin, Lavande, Verre.
// Dans l'appli Android « Odin Launcher », un pont (window.OdinAndroid) ajoute les applis du téléphone.
(() => {
  'use strict';
  const OS = window.OS, h = OS.h, api = OS.api, ui = OS.ui;
  const M = OS.mobile = { ecrans: [], notifications: [] };
  let racine, mobile, accueil, volet, recents, statut;
  const pont = () => window.OdinAndroid || null;
  const pontSur = (f, defaut) => { try { return f(pont()); } catch { return defaut; } };

  // La discussion avec Odin est une appli à part entière sur téléphone.
  OS.declarer({ id: 'odin', nom: 'Odin', cachee: true, couleur: ['#22364A', '#101A24'], ouvrir(ctx) {
    const d = ui.discussion(); ctx.surFermeture(d.arret);
    OS.ajouter(ctx.corps, h('div', { class: 'discussion' }, h('div', { class: 'rangee', style: { padding: '4px 16px 8px' } }, d.visage, d.etat), d.fil, d.idees, d.form));
  } });

  // ——— Écrans d'applis ———
  function fermer(e) { for (const g of e.nettoyage) { try { g(); } catch { /* rien */ } } e.el.remove(); M.ecrans = M.ecrans.filter((x) => x !== e); }
  function montrer(e) { e.el.hidden = false; OS.ajouter(mobile, e.el); M.ecrans = [...M.ecrans.filter((x) => x !== e), e]; }
  const devant = () => M.ecrans.filter((e) => !e.el.hidden).pop();
  M.ouvrir = (id, options = {}) => {
    const appli = OS.applis[id]; if (!appli) return null;
    volet.classList.remove('ouvert'); recents.classList.remove('ouvert');
    if (appli.lancer) { appli.lancer(); return null; }
    let e = M.ecrans.find((x) => x.appli.id === id);
    if (e && (Object.keys(options).length || appli.multiple)) { fermer(e); e = null; }
    if (e) { montrer(e); return e; }
    const titre = h('h1', null, appli.nom), corps = h('div', { class: 'corps-m' });
    e = { appli, nettoyage: [] };
    e.el = h('section', { class: 'ecran-app', role: 'dialog', 'aria-label': appli.nom }, h('div', { class: 'tete' }, h('button', { class: 'icone-b', 'aria-label': 'Fermer l\'appli', onclick: () => fermer(e) }, OS.icone('gauche', 22)), titre, OS.etiquetteEssai('Essai')), corps);
    const ctx = { corps, mobile: true, options, titre: (t) => { titre.textContent = t; }, fermer: () => fermer(e), surFermeture: (g) => e.nettoyage.push(g) };
    OS.ajouter(mobile, e.el); M.ecrans.push(e);
    const souci = (err) => OS.poser(corps, h('div', { class: 'contenu' }, ui.message(`Cette appli a rencontré un souci : ${err.message}`, 'mauvais')));
    try { Promise.resolve(appli.ouvrir(ctx)).catch(souci); } catch (err) { souci(err); }
    return e;
  };

  // ——— Notifications ———
  M.notifier = (n) => {
    M.notifications.unshift({ ...n, a: Date.now() }); M.notifications.length = Math.min(M.notifications.length, 30);
    if (volet && volet.classList.contains('ouvert')) dessinerVolet();
    if (OS.etat.concentration || !mobile) return;
    const el = h('div', { class: 'notif', role: 'status', style: { position: 'absolute', left: '12px', right: '12px', top: '44px', zIndex: '40' }, onclick: () => { el.remove(); if (n.ouvrir) OS.ouvrir(n.ouvrir); } }, n.appli ? OS.tuile(n.appli, 40, true) : OS.mascotte(40, { decor: true }), h('div', { style: { flex: '1', minWidth: 0 } }, h('b', null, n.titre), n.texte ? h('span', { class: 'attenue', style: { display: '-webkit-box', WebkitLineClamp: '3', WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, n.texte) : null));
    OS.ajouter(mobile, el); setTimeout(() => el.remove(), n.duree || 5000);
  };

  // ——— Applis du téléphone Android (seulement dans Odin Launcher) ———
  function chargerAndroid() {
    for (const k of Object.keys(OS.applis)) if (k.startsWith('android:')) delete OS.applis[k];
    const liste = pontSur((p) => JSON.parse(p.applis()), []);
    for (const a of liste) OS.applis[`android:${a.paquet}`] = { id: `android:${a.paquet}`, nom: a.nom, couleur: ['#34D399', '#047857'], android: true, get image() { if (this._image === undefined) { const b = pontSur((p) => p.icone(a.paquet), ''); this._image = b ? `data:image/png;base64,${b}` : ''; } return this._image; }, lancer: () => pontSur((p) => p.lancer(a.paquet)) };
    return liste.length;
  }

  // ——— Accueil ———
  const DOCK = ['fichiers', 'store', 'odin', 'reglages'];
  function boutonAppli(a) { return h('button', { type: 'button', 'aria-label': a.nom, onclick: () => OS.ouvrir(a.id) }, a.id === 'odin' ? OS.mascotte(0, { decor: true }) : OS.tuile(a, 60, true), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' } }, a.nom)); }
  function dessinerAccueil() {
    if (!accueil) return;
    const d = new Date(), heure = d.getHours(), salut = heure < 5 || heure >= 18 ? 'Bonsoir !' : 'Bonjour !';
    const systeme = OS.applisVisibles().filter((a) => !a.odin && !a.linux && !a.android && !DOCK.includes(a.id)), odin = OS.applisVisibles().filter((a) => a.odin), tel = Object.values(OS.applis).filter((a) => a.android).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    OS.poser(accueil, 
      h('div', { class: 'carte-m rangee' }, OS.mascotte(58, { decor: true }), h('div', { style: { flex: '1', minWidth: 0 } }, h('b', { style: { fontSize: '17px' } }, salut), h('div', { style: { opacity: '.85', fontSize: '13px' } }, M.securite || 'Je veille sur ton téléphone.')), h('button', { class: 'bouton petit primaire', onclick: () => OS.ouvrir('odin') }, 'Parler')),
      h('div', { class: 'carte-m' }, h('div', { style: { fontFamily: 'var(--titre)', fontWeight: '800', fontSize: '44px', lineHeight: '1', letterSpacing: '-1px' }, id: 'm-heure' }, OS.heure()), h('div', { style: { opacity: '.85', marginTop: '4px', textTransform: 'capitalize' } }, OS.jour(true))),
      h('div', { class: 'grille-m' }, systeme.map(boutonAppli), odin.map(boutonAppli)),
      tel.length ? h('div', { style: { fontSize: '12px', fontWeight: '700', opacity: '.8', marginTop: '6px' } }, 'APPLIS DU TÉLÉPHONE') : null,
      tel.length ? h('div', { class: 'grille-m' }, tel.map(boutonAppli)) : null,
      !pont() && api.mode === 'essai' ? h('div', { class: 'carte-m', style: { fontSize: '12.5px' } }, OS.etiquetteEssai(), h('div', { style: { marginTop: '6px', opacity: '.85' } }, 'Aucun Odin ne répond derrière cette page : les données sont des exemples.')) : null);
  }
  function dessinerStatut() {
    if (!statut) return;
    OS.poser(statut, h('span', null, OS.heure()), h('span', { class: 'rangee', style: { gap: '8px' } }, api.mode === 'essai' ? h('span', { style: { fontSize: '11px', opacity: '.8' } }, 'Essai') : null, navigator.onLine ? OS.icone('wifi', 16) : null, M.batterie != null ? h('span', null, `${M.batterie} %`) : null));
  }
  function dessinerVolet() {
    const sombre = document.body.dataset.apparence === 'sombre';
    const bascule = (icone, nom, presse, action) => h('button', { type: 'button', 'aria-pressed': presse === null ? null : String(presse), onclick: action }, h('i', null, OS.icone(icone, 20)), nom);
    OS.poser(volet, 
      h('div', { class: 'rangee entre' }, h('b', { style: { fontSize: '18px' } }, `${OS.heure()} · ${OS.jour()}`), h('button', { class: 'icone-b', 'aria-label': 'Fermer le volet', onclick: () => volet.classList.remove('ouvert') }, OS.icone('croix', 18))),
      h('div', { class: 'bascules' },
        bascule(sombre ? 'lune' : 'soleil', 'Mode sombre', sombre, () => { OS.regler({ apparence: sombre ? 'clair' : 'sombre' }); dessinerVolet(); }),
        bascule('cloche', 'Concentration', OS.etat.concentration, () => { OS.regler({ concentration: !OS.etat.concentration }); dessinerVolet(); }),
        bascule('ecran', 'Plein écran', Boolean(document.fullscreenElement), async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { /* refusé */ } setTimeout(dessinerVolet, 200); }),
        bascule('protege', 'Ullr', null, () => { OS.installerAppli('ullr', { silence: true }); OS.ouvrir('odin:ullr'); }),
        ...(pont() ? [bascule('wifi', 'Wi-Fi', null, () => pontSur((p) => p.reglage('wifi'))), bascule('lien', 'Bluetooth', null, () => pontSur((p) => p.reglage('bluetooth'))), bascule('telephone', 'Android', null, () => pontSur((p) => p.reglage('reglages')))] : []),
        bascule('reglages', 'Réglages', null, () => OS.ouvrir('reglages'))),
      h('div', { class: 'rangee', style: { gap: '8px' } }, [['odin', 'Odin'], ['lavande', 'Lavande'], ['verre', 'Verre']].map(([id, nom]) => h('button', { type: 'button', class: 'bouton petit', 'aria-pressed': String(OS.etat.mobile === id), style: { flex: '1', outline: OS.etat.mobile === id ? '2px solid #fff' : 'none' }, onclick: () => { OS.regler({ mobile: id }); dessinerVolet(); } }, nom))),
      h('div', { class: 'rangee entre' }, h('b', null, 'Notifications'), M.notifications.length ? h('button', { class: 'bouton petit', onclick: () => { M.notifications = []; dessinerVolet(); } }, 'Effacer') : null),
      M.notifications.length ? M.notifications.slice(0, 12).map((n) => h('div', { class: 'notif', onclick: () => { if (n.ouvrir) OS.ouvrir(n.ouvrir); } }, n.appli ? OS.tuile(n.appli, 40, true) : OS.mascotte(40, { decor: true }), h('div', { style: { flex: '1', minWidth: 0 } }, h('b', null, n.titre), n.texte ? h('span', { style: { display: 'block', opacity: '.8' } }, n.texte) : null))) : h('p', { style: { opacity: '.8' } }, 'Aucune notification.'));
  }
  function dessinerRecents() {
    OS.poser(recents, h('div', { class: 'rangee entre' }, h('b', { style: { fontSize: '18px' } }, 'Applis ouvertes'), h('button', { class: 'icone-b', 'aria-label': 'Fermer', onclick: () => recents.classList.remove('ouvert') }, OS.icone('croix', 18))),
      M.ecrans.length ? M.ecrans.slice().reverse().map((e) => h('div', { class: 'notif' }, OS.tuile(e.appli, 40, true), h('button', { type: 'button', style: { flex: '1', textAlign: 'left', fontWeight: '600' }, onclick: () => { recents.classList.remove('ouvert'); montrer(e); } }, e.appli.nom), h('button', { class: 'icone-b', 'aria-label': `Fermer ${e.appli.nom}`, onclick: () => { fermer(e); dessinerRecents(); } }, OS.icone('croix', 16)))) : h('p', { style: { opacity: '.8' } }, 'Aucune appli ouverte.'));
  }
  async function rafraichir() {
    try { const s = await api.infos(); if (s && s.ok) api.systeme = s; } catch { /* on garde les dernières valeurs */ }
    try { const r = await api.agir('ullr', 'etat'); if (r && r.text && !r.essai) M.securite = /⚠/.test(r.text) ? 'Ullr a quelque chose à te montrer.' : 'Tout va bien.'; } catch { /* Ullr indisponible */ }
    try { if (navigator.getBattery) { const b = await navigator.getBattery(); M.batterie = Math.round(b.level * 100); } } catch { /* pas d'accès à la batterie */ }
    dessinerAccueil(); dessinerStatut();
  }

  // ——— Montage ———
  M.monter = () => {
    racine = document.getElementById('racine'); OS.ouvrir = M.ouvrir; OS.notifier = M.notifier;
    document.body.dataset.ecran = 'mobile';
    chargerAndroid();
    statut = h('button', { type: 'button', class: 'statut', 'aria-label': 'Ouvrir le volet : réglages rapides et notifications', onclick: () => { dessinerVolet(); recents.classList.remove('ouvert'); volet.classList.toggle('ouvert'); } });
    accueil = h('main', { class: 'accueil', 'aria-label': 'Accueil' });
    volet = h('aside', { class: 'volet', 'aria-label': 'Réglages rapides et notifications' });
    recents = h('aside', { class: 'volet', 'aria-label': 'Applis ouvertes' });
    const dockM = h('nav', { class: 'dock-m', 'aria-label': 'Applis favorites' }, DOCK.map((id) => OS.applis[id]).filter(Boolean).map((a) => h('button', { type: 'button', 'aria-label': a.nom, onclick: () => OS.ouvrir(a.id) }, a.id === 'odin' ? OS.mascotte(0, { decor: true }) : OS.tuile(a, 56, true))));
    const nav = h('nav', { class: 'nav-m', 'aria-label': 'Navigation' },
      h('button', { type: 'button', 'aria-label': 'Retour', onclick: () => { if (volet.classList.contains('ouvert') || recents.classList.contains('ouvert')) { volet.classList.remove('ouvert'); recents.classList.remove('ouvert'); return; } const e = devant(); if (e) fermer(e); } }, OS.icone('gauche', 20)),
      h('button', { type: 'button', 'aria-label': 'Accueil', onclick: () => { volet.classList.remove('ouvert'); recents.classList.remove('ouvert'); for (const e of M.ecrans) e.el.hidden = true; } }, h('span', { style: { width: '18px', height: '18px', borderRadius: '50%', border: '2px solid currentColor', display: 'block' } })),
      h('button', { type: 'button', 'aria-label': 'Applis ouvertes', onclick: () => { volet.classList.remove('ouvert'); dessinerRecents(); recents.classList.toggle('ouvert'); } }, h('span', { style: { width: '16px', height: '16px', borderRadius: '4px', border: '2px solid currentColor', display: 'block' } })));
    mobile = h('div', { id: 'mobile' }, statut, accueil, dockM, volet, recents, nav);
    OS.poser(racine, h('div', { id: 'fond' }), mobile);
    OS.appliquerTheme(); dessinerAccueil(); dessinerStatut();
    M.minuterie = [setInterval(() => { dessinerStatut(); const e = document.getElementById('m-heure'); if (e) e.textContent = OS.heure(); }, 15000), setInterval(rafraichir, 60000)];
    OS.sur('etat', dessinerAccueil); OS.sur('catalogue', dessinerAccueil);
    // Le bouton « retour » d'Android ferme l'appli ouverte au lieu de quitter le lanceur.
    window.odinRetour = () => { nav.firstChild.click(); return true; };
    rafraichir();
  };
})();
