// Odin OS — démarrage du bureau : cherche Odin, ouvre la session, charge l'état et les applis,
// puis monte le bureau (ordinateur) ou l'écran téléphone.
(() => {
  'use strict';
  const OS = window.OS, api = OS.api;
  const etat = (t) => { const e = document.getElementById('etat-demarrage'); if (e) e.textContent = t; };
  const rideau = (ferme) => document.getElementById('demarrage').classList.toggle('fini', !ferme);

  async function demarrer() {
    const params = new URLSearchParams(location.search);
    const visage = document.getElementById('mascotte-demarrage');
    OS.ajouter(visage, document.getElementById('gabarit-mascotte').content.cloneNode(true));
    try { window.OdinFace && window.OdinFace.own(visage.querySelector('svg')); } catch { /* visage simple */ }

    etat('Je cherche Odin…');
    let mode = await api.demarrer();
    const premier = mode === 'creation';
    if (mode === 'creation') { rideau(false); await OS.accueil({ compte: true, seulement: ['bienvenue', 'compte'] }); rideau(true); etat('Compte créé, j\'ouvre le bureau…'); mode = await api.demarrer(); }
    else if (mode === 'connexion') { rideau(false); await OS.connexion(); rideau(true); etat('J\'ouvre ta session…'); mode = await api.demarrer(); }
    if (mode !== 'reel' && mode !== 'essai') { mode = api.mode = 'essai'; }
    if (mode === 'essai') { const s = await OS.essai.systeme(); api.systeme = s; }

    etat('Je charge tes réglages…');
    try { const r = await api.etat(); if (r && r.etat) Object.assign(OS.etat, r.etat); } catch { /* réglages par défaut */ }
    for (const [k, v] of Object.entries(OS.DEFAUT)) if (OS.etat[k] === undefined || (Array.isArray(v) && !Array.isArray(OS.etat[k]))) OS.etat[k] = v;
    etat('Je range les applis…');
    await OS.chargerCatalogue();
    OS.etat.applis = OS.etat.applis.filter((id) => OS.catalogue.some((m) => m.id === id));
    await OS.chargerApplisLinux().catch(() => []);

    const cible = api.systeme && api.systeme.cible;
    const mobile = params.get('ecran') === 'mobile' || (params.get('ecran') !== 'bureau' && (Boolean(window.OdinAndroid) || cible === 'mobile' || matchMedia('(max-width: 760px)').matches));
    document.body.dataset.ecran = mobile ? 'mobile' : 'bureau';
    (mobile ? OS.mobile : OS.bureau).monter();
    document.title = mode === 'essai' ? 'Odin OS (essai)' : 'Odin OS';
    rideau(false);
    if (!OS.etat.accueilFait || params.has('accueil')) await OS.accueil({ sans: premier ? ['bienvenue'] : [] });
    const ouvrir = params.get('ouvrir'); if (ouvrir && OS.applis[ouvrir]) OS.ouvrir(ouvrir);
    OS.emettre('pret');
  }
  window.addEventListener('error', (e) => console.error('[Odin OS]', e.message));
  demarrer().catch((e) => { console.error(e); etat(`Le bureau n'a pas pu démarrer : ${e.message}`); });
})();
