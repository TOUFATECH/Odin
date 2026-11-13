// Odin OS — Odin Setup : premier démarrage (compte, style, applis d'Odin) et, depuis l'image PC,
// installation sur le disque. Aussi l'écran de connexion. Chaque étape affichée fait vraiment quelque chose :
// une étape qui ne s'applique pas ici (disque dans un conteneur, par exemple) n'est pas montrée.
(() => {
  'use strict';
  const OS = window.OS, h = OS.h, api = OS.api;
  const RECOMMANDEES = ['ullr', 'skogul', 'forseti', 'saga', 'runes', 'sindri', 'eir', 'idunn', 'naglfar', 'draupnir', 'brisingamen', 'kvasir'];
  const appel = async (chemin, corps) => { const r = await fetch(chemin, { method: 'POST', credentials: 'same-origin', headers: { 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify(corps || {}) }); let j = {}; try { j = await r.json(); } catch { /* vide */ } return { statut: r.status, ...j }; };

  /** Écran de connexion : résout quand la personne est connectée. */
  OS.connexion = (message) => new Promise((fin) => {
    const erreur = h('p', { role: 'alert', style: { color: '#FCA5A5', minHeight: '20px' } }, message || '');
    const email = h('input', { class: 'champ', type: 'email', placeholder: 'Adresse e-mail', 'aria-label': 'Adresse e-mail', autocomplete: 'username', required: true });
    const passe = h('input', { class: 'champ', type: 'password', placeholder: 'Mot de passe', 'aria-label': 'Mot de passe', autocomplete: 'current-password', required: true });
    const bouton = h('button', { class: 'bouton primaire', style: { width: '100%', height: '44px', borderRadius: '22px' } }, 'Ouvrir la session');
    const visage = OS.mascotte(120);
    const el = h('div', { id: 'verrou' }, h('form', { onsubmit: async (e) => {
      e.preventDefault(); bouton.disabled = true; erreur.textContent = '';
      const r = await appel('/api/account/login', { email: email.value.trim(), password: passe.value }).catch((x) => ({ error: x.message }));
      bouton.disabled = false;
      if (r.ok) { if (window.OdinFace) window.OdinFace.flash(visage, 'joie', 1500); el.remove(); return fin(true); }
      erreur.textContent = r.error || 'Connexion refusée.'; passe.value = ''; passe.focus(); if (window.OdinFace) window.OdinFace.flash(visage, 'inquiet', 2000);
    } }, visage, h('h1', { style: { fontFamily: 'var(--titre)', fontSize: '30px' } }, 'Odin OS'), h('p', { style: { opacity: '.8' } }, 'Connecte-toi avec le compte d\'Odin.'), email, passe, bouton, erreur));
    OS.ajouter(document.body, el); email.focus();
  });
  /** Verrouille : ferme la session (compte) et revient à l'écran de connexion. */
  OS.verrouiller = async () => {
    const compte = api.mode === 'reel' && api.systeme && api.systeme.compte;
    if (!compte) return OS.notifier({ titre: 'Pas de verrouillage ici', texte: api.mode === 'essai' ? 'En mode essai, il n\'y a pas de compte : rien à verrouiller.' : 'Odin n\'a pas encore de compte avec mot de passe. Crée-le dans l\'interface d\'Odin pour verrouiller Odin OS.' });
    await appel('/api/account/logout').catch(() => {});
    location.reload();
  };

  /** Odin Setup. `o.compte` : il faut créer le compte (première connexion). Résout à la fin. */
  OS.accueil = (o = {}) => new Promise((fin) => {
    const cap = (api.systeme && api.systeme.capacites) || {}, disque = cap.disque && cap.disque.possible ? cap.disque : null;
    const choix = { theme: OS.etat.theme, apparence: OS.etat.apparence, accent: OS.etat.accent, applis: new Set(OS.etat.accueilFait ? OS.etat.applis : RECOMMANDEES), clavier: (cap.clavier) || 'fr', disque: disque && disque.disques[0] ? disque.disques[0].nom : '', installerDisque: false };
    let rang = 0; const visage = OS.mascotte(104, { decor: true }), bulle = h('p', { role: 'status' }), liste = h('ol'), panneau = h('div', { class: 'panneau' });
    const aurore = h('div', { class: 'aurore' }); aurore.innerHTML = OS.fonds.aurore();
    const el = h('div', { id: 'installation', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Odin Setup' }, aurore, h('div', { class: 'etapes' }, h('div', { class: 'marque' }, OS.logo(26), 'Odin Setup'), h('div', { class: 'parle' }, visage, bulle), liste), panneau);
    const humeur = (m) => { if (window.OdinFace) window.OdinFace.set(visage, m); };

    // ——— Les étapes ———
    const E = {};
    E.bienvenue = { nom: 'Bienvenue', bulle: 'Salut, moi c\'est Odin. Je t\'accompagne, ça prend deux minutes.', dessiner(c) {
      OS.ajouter(c, h('h1', null, 'Bienvenue dans Odin OS'), h('p', { class: 'attenue', style: { fontSize: '16px' } }, 'Un bureau léger, tes applis d\'Odin, et moi pour t\'aider. On règle l\'essentiel ensemble.'),
        h('div', { class: 'choix' }, h('div', { class: 'carte' }, h('b', null, 'Langue'), h('div', { class: 'attenue' }, 'Français')), h('div', { class: 'carte' }, h('b', null, 'Version'), h('div', { class: 'attenue' }, `Odin OS ${OS.version}`)), h('div', { class: 'carte' }, h('b', null, 'Installation'), h('div', { class: 'attenue' }, api.mode === 'essai' ? 'Mode essai (rien n\'est modifié)' : ({ docker: 'Conteneur Docker', lxc: 'Conteneur LXC', pc: disque ? 'Image PC (session d\'essai)' : 'Image PC', wsl: 'Windows (WSL)', mobile: 'Téléphone', hote: 'Odin sur sa machine' }[api.systeme && api.systeme.cible] || 'Odin')))),
        api.mode === 'essai' ? h('div', null, OS.etiquetteEssai('Essai : tes choix restent dans cette page')) : null);
    } };
    E.compte = { nom: 'Compte', bulle: 'Ton compte protège Odin OS. Le mot de passe reste sur ta machine.', dessiner(c) {
      const champ = (label, type, auto) => { const i = h('input', { class: 'champ', type, autocomplete: auto, required: true, style: { height: '46px', borderRadius: '14px' } }); return [i, h('label', { style: { display: 'grid', gap: '6px', fontWeight: '600', fontSize: '14px' } }, label, i)]; };
      const [prenom, l1] = champ('Prénom', 'text', 'given-name'), [nom, l2] = champ('Nom', 'text', 'family-name'), [email, l3] = champ('Adresse e-mail', 'email', 'username'), [passe, l4] = champ('Mot de passe', 'password', 'new-password'), [passe2, l5] = champ('Encore une fois', 'password', 'new-password');
      const erreur = h('p', { role: 'alert', style: { color: '#DC2626', minHeight: '22px' } });
      OS.ajouter(c, h('h1', null, 'Crée ton compte'), h('p', { class: 'attenue' }, 'C\'est le compte du propriétaire d\'Odin. Il sert aussi à ouvrir l\'interface d\'Odin.'), h('div', { class: 'deux' }, l1, l2), l3, h('div', { class: 'deux' }, l4, l5), erreur);
      return async () => {
        if (passe.value !== passe2.value) { erreur.textContent = 'Les deux mots de passe ne sont pas identiques.'; return false; }
        const r = await appel('/api/account/create', { prenom: prenom.value.trim(), nom: nom.value.trim(), email: email.value.trim(), password: passe.value }).catch((x) => ({ error: x.message }));
        if (!r.ok) { erreur.textContent = r.error || 'Création impossible.'; humeur('inquiet'); return false; }
        return true;
      };
    } };
    E.clavier = { nom: 'Clavier', bulle: 'Choisis ton clavier : je l\'applique tout de suite.', dessiner(c) {
      const CLAVIERS = [['fr', 'Français (AZERTY)'], ['us', 'Anglais (QWERTY)'], ['be', 'Belge'], ['ch', 'Suisse'], ['ca', 'Canadien'], ['de', 'Allemand'], ['es', 'Espagnol']];
      const essai = h('input', { class: 'champ', placeholder: 'Tape ici pour essayer ton clavier', 'aria-label': 'Zone d\'essai du clavier', style: { height: '46px' } });
      OS.ajouter(c, h('h1', null, 'Quel clavier utilises-tu ?'), h('div', { class: 'choix' }, CLAVIERS.map(([id, nom]) => h('label', null, h('input', { type: 'radio', name: 'clavier', value: id, checked: choix.clavier === id, onchange: async () => { choix.clavier = id; await api.envoyer('/api/os/clavier', { disposition: id }).catch(() => {}); } }), h('b', null, nom)))), essai);
    } };
    E.disque = { nom: 'Disque', bulle: 'Je peux installer Odin OS sur le disque de cette machine. Tout le disque sera effacé : je te demande confirmation.', dessiner(c) {
      const dessiner = () => { OS.poser(c, h('h1', null, 'Où installer Odin OS ?'), h('p', { class: 'attenue' }, 'Tu utilises Odin OS depuis l\'image de démarrage. Pour le garder, installe-le sur un disque.'),
        h('div', { class: 'choix' },
          h('label', null, h('input', { type: 'radio', name: 'mode', checked: !choix.installerDisque, onchange: () => { choix.installerDisque = false; dessiner(); } }), h('b', null, 'Continuer sans installer'), h('span', { class: 'attenue' }, 'Session d\'essai : rien n\'est écrit sur le disque, tout s\'efface à l\'arrêt.')),
          h('label', null, h('input', { type: 'radio', name: 'mode', checked: choix.installerDisque, onchange: () => { choix.installerDisque = true; dessiner(); } }), h('b', null, 'Tout le disque'), h('span', { class: 'attenue' }, 'Odin OS prend toute la place. Le contenu du disque est effacé.')),
          h('label', { style: { opacity: '.55' } }, h('b', null, 'À côté d\'un autre système'), h('span', { class: 'attenue' }, 'Pas encore disponible dans Odin OS 0.1.'))),
        choix.installerDisque ? h('div', { class: 'carte' }, h('b', null, 'Disque à effacer'), h('div', { class: 'choix', style: { marginTop: '10px' } }, disque.disques.map((d) => h('label', null, h('input', { type: 'radio', name: 'disque', checked: choix.disque === d.nom, onchange: () => { choix.disque = d.nom; } }), h('b', null, d.nom), h('span', { class: 'attenue' }, `${OS.taille(d.taille)}${d.modele ? ` · ${d.modele}` : ''}`))))) : null); };
      dessiner();
      return async () => { if (!choix.installerDisque) return true; if (!choix.disque) return false; return OS.confirmer(`Effacer ${choix.disque} ?`, 'Tout ce que contient ce disque sera perdu. Ce geste ne peut pas être annulé.', { danger: true, oui: 'Effacer et installer' }); };
    } };
    E.style = { nom: 'Style', bulle: 'Tu viens de Mac, de Windows ou de Linux ? Garde tes habitudes. Le style Odin reste mon préféré.', dessiner(c) {
      const appliquer = () => OS.regler({ theme: choix.theme, apparence: choix.apparence, accent: choix.accent, fond: '' });
      const cartes = h('div', { class: 'choix' }, Object.entries(OS.themes).map(([id, t]) => h('label', null, h('input', { type: 'radio', name: 'theme', value: id, checked: choix.theme === id, onchange: () => { choix.theme = id; appliquer(); } }), h('div', { class: 'apercu', style: { background: t.apercu } }, h('span', { style: { position: 'absolute', left: id === 'fenetres' || id === 'neon' ? '6%' : '30%', right: id === 'fenetres' ? '0' : id === 'neon' ? '6%' : '30%', bottom: id === 'fenetres' ? '0' : '6px', height: '9px', borderRadius: id === 'fenetres' ? '0' : '5px', background: 'rgba(255,255,255,.55)' } }), id === 'fenetres' || id === 'neon' ? null : h('span', { style: { position: 'absolute', left: id === 'libre' ? '8%' : '0', right: id === 'libre' ? '8%' : '0', top: id === 'libre' ? '5px' : '0', height: '6px', borderRadius: id === 'libre' ? '3px' : '0', background: 'rgba(255,255,255,.35)' } })), h('b', null, t.nom), h('span', { class: 'attenue', style: { fontSize: '13px' } }, t.resume))));
      const accents = h('div', { class: 'rangee', style: { flexWrap: 'wrap' } }, h('b', { style: { marginRight: '6px' } }, 'Couleur d\'accent'), OS.ACCENTS.map(([nom, couleur]) => h('button', { type: 'button', 'aria-label': nom, title: nom, onclick: (e) => { choix.accent = choix.accent === couleur ? '' : couleur; appliquer(); e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => { b.style.outline = b.title === nom && choix.accent ? '3px solid #0F172A' : 'none'; }); }, style: { width: '34px', height: '34px', borderRadius: '50%', background: couleur, outline: choix.accent === couleur ? '3px solid #0F172A' : 'none', outlineOffset: '2px' } })));
      OS.ajouter(c, h('div', { class: 'sur' }, 'TON STYLE'), h('h1', null, 'Choisis l\'apparence d\'Odin OS'), h('div', { class: 'rangee', style: { flexWrap: 'wrap' } }, OS.ui.segments([['clair', 'Clair'], ['sombre', 'Sombre'], ['auto', 'Auto']], choix.apparence, (v) => { choix.apparence = v; appliquer(); }, 'Clair ou sombre')), cartes, accents);
    } };
    E.applis = { nom: 'Applis Odin', bulle: 'Je te conseille Ullr et Skögul : ils protègent ta machine dès le premier jour.', dessiner(c) {
      const compte = h('b', { role: 'status' }), grille = h('div', { class: 'applis-c' });
      const maj = () => { compte.textContent = `${choix.applis.size} appli${choix.applis.size > 1 ? 's' : ''} sélectionnée${choix.applis.size > 1 ? 's' : ''}`; grille.querySelectorAll('input').forEach((i) => { i.checked = choix.applis.has(i.value); }); };
      for (const m of OS.catalogue) OS.ajouter(grille, h('label', { class: 'appli-c' }, OS.tuile(OS.applis[`odin:${m.id}`], 34), h('span', { class: 'txt' }, h('b', null, m.nom), h('span', null, m.resume)), h('input', { type: 'checkbox', value: m.id, 'aria-label': m.nom, onchange: (e) => { if (e.target.checked) choix.applis.add(m.id); else choix.applis.delete(m.id); maj(); } })));
      OS.ajouter(c, h('h1', null, 'Choisis tes applis Odin'), h('p', { class: 'attenue' }, `${OS.catalogue.length} applis disponibles. Coche celles que tu veux : tu pourras en ajouter ou en retirer à tout moment dans Odin Store.`),
        h('div', { class: 'rangee', style: { flexWrap: 'wrap' } }, h('button', { type: 'button', class: 'bouton petit', onclick: () => { choix.applis = new Set(RECOMMANDEES.filter((id) => OS.catalogue.some((m) => m.id === id))); maj(); } }, 'Recommandées'), h('button', { type: 'button', class: 'bouton petit', onclick: () => { choix.applis = new Set(OS.catalogue.map((m) => m.id)); maj(); } }, 'Toutes'), h('button', { type: 'button', class: 'bouton petit', onclick: () => { choix.applis = new Set(); maj(); } }, 'Aucune'), h('span', { class: 'pousse' }), compte),
        grille);
      maj();
    } };
    E.confidentialite = { nom: 'Confidentialité', bulle: 'Je ne fais rien dans ton dos. Voilà ce qui sort de ta machine, et ce qui n\'en sort jamais.', dessiner(c) {
      const ligne = (titre, texte) => h('div', { class: 'carte' }, h('b', null, titre), h('div', { class: 'attenue', style: { marginTop: '4px' } }, texte));
      OS.ajouter(c, h('h1', null, 'Tes données restent chez toi'), ligne('Fichiers, réglages, compte', 'Tout est rangé sur cette machine. Odin OS n\'envoie aucune statistique et ne contient aucun traceur.'), ligne('Quand tu me parles', 'Ton message va au modèle d\'IA que tu as choisi dans Odin (un service en ligne, ou un modèle sur ta machine). Sans modèle, je réponds avec mes règles, sans rien envoyer.'), ligne('Ullr, l\'antivirus', 'Il télécharge des listes de menaces publiques. Tes fichiers ne sont jamais envoyés : seules leurs empreintes peuvent être comparées, et seulement si tu le demandes.'));
    } };
    E.installation = { get nom() { return choix.installerDisque ? 'Installation' : 'Finalisation'; }, bulle: 'Je m\'occupe de tout. Tu peux me regarder faire.', sansBoutons: true, async dessiner(c) {
      const anneau = h('div', { class: 'progression' }), pct = h('b', null, '0 %'), quoi = h('span', { style: { opacity: '.85' } }, 'Je prépare…');
      OS.ajouter(anneau, h('div', null, OS.mascotte(0, { decor: true }), pct, quoi));
      const faits = h('div', { class: 'grille', style: { gap: '6px' } }), journal = h('div', { class: 'journal', hidden: true });
      OS.ajouter(c, h('h1', { style: { textAlign: 'center' } }, choix.installerDisque ? 'J\'installe Odin OS…' : 'Je prépare ton bureau…'), anneau, faits, journal);
      const avancer = (p, texte) => { anneau.style.background = `conic-gradient(#34D399 ${p}%, #2563EB ${p}%, rgba(148,163,184,.25) ${p}%)`; pct.textContent = `${Math.round(p)} %`; if (texte) quoi.textContent = texte; };
      const fait = (texte, ok = true) => OS.ajouter(faits, h('div', { class: 'rangee', style: { justifyContent: 'center', color: ok ? '#059669' : '#DC2626', fontWeight: '600' } }, ok ? '✓' : '✗', h('span', { style: { color: '#0F172A', fontWeight: '500' } }, texte)));
      const pause = (ms) => new Promise((s) => setTimeout(s, ms));
      humeur('concentration'); avancer(4, 'Je commence');
      // Les réglages d'abord, et bien enregistrés : l'installation sur le disque emporte le compte, le style et les applis.
      avancer(6, 'J\'applique ton style'); await OS.regler({ theme: choix.theme, apparence: choix.apparence, accent: choix.accent, fond: '' }); await pause(350); fait(`Style ${OS.themes[choix.theme].nom}`);
      avancer(10, 'J\'ajoute tes applis'); await OS.regler({ applis: [...choix.applis], epingles: [...new Set([...OS.etat.epingles.filter((x) => !x.startsWith('odin:')), ...['ullr'].filter((id) => choix.applis.has(id)).map((id) => `odin:${id}`)])] }); await pause(350); fait(`${choix.applis.size} appli${choix.applis.size > 1 ? 's' : ''} d'Odin`);
      await OS.regler({ accueilFait: true });
      let ok = true;
      if (choix.installerDisque) {
        avancer(12, 'Je prépare le disque');
        const r = await api.envoyer('/api/os/installer-disque', { disque: choix.disque, confirm: true }).catch((x) => ({ ok: false, error: x.message }));
        if (!r.ok || !r.tache) { ok = false; fait(r.error || 'Installation refusée.', false); }
        else for (;;) {
          await pause(2000); const t = await api.lire(`/api/os/tache?id=${encodeURIComponent(r.tache)}`).catch(() => null); if (!t || !t.ok) continue;
          const m = /\[(\d+)\/(\d+)\]\s*([^\n]*)\n?[^[]*$/.exec(t.journal || ''); if (m) avancer(12 + (Number(m[1]) - 1) / Number(m[2]) * 84, m[3]);
          if (t.etat !== 'en cours') { ok = t.etat === 'fini'; fait(ok ? `Odin OS est installé sur ${choix.disque}` : 'L\'installation sur le disque a échoué', ok); if (!ok) { journal.hidden = false; journal.textContent = (t.journal || '').slice(-1500); } break; }
        }
        // Installation ratée : Odin Setup se représentera au prochain démarrage de la session d'essai.
        if (!ok) await OS.regler({ accueilFait: false });
      }
      avancer(100, ok ? 'C\'est prêt' : 'Presque');
      humeur(ok ? 'joie' : 'inquiet');
      const redemarrer = choix.installerDisque && ok;
      OS.ajouter(c, h('div', { class: 'bas', style: { justifyContent: 'center' } }, redemarrer ? h('button', { class: 'bouton primaire', onclick: async () => { quoi.textContent = 'Je redémarre…'; await api.envoyer('/api/os/redemarrer', { confirm: true }).catch(() => {}); } }, 'Redémarrer sur le disque') : null, h('button', { class: `bouton ${redemarrer ? 'contour' : 'primaire'}`, onclick: () => { el.remove(); fin(true); } }, redemarrer ? 'Rester dans la session d\'essai' : 'Découvrir Odin OS')));
      c.querySelector('.bas button').focus();
    } };
    // `o.seulement` / `o.sans` : le compte se crée d'abord (avant que le bureau puisse lire quoi que ce soit), le reste ensuite.
    const ordre = ['bienvenue', ...(o.compte ? ['compte'] : []), ...(cap.clavier ? ['clavier'] : []), ...(disque ? ['disque'] : []), 'style', 'applis', 'confidentialite', 'installation'].filter((id) => (!o.seulement || o.seulement.includes(id)) && !(o.sans || []).includes(id)).map((id) => ({ id, ...E[id] }));

    async function montrer(n) {
      rang = n; const e = ordre[n];
      OS.poser(liste, ...ordre.map((x, i) => h('li', { class: i < n ? 'fait' : i === n ? 'ici' : null, 'aria-current': i === n ? 'step' : null }, h('i', null, i < n ? '✓' : String(i + 1)), h('span', null, E[x.id].nom))));
      bulle.textContent = e.bulle; humeur(n === 0 ? 'joie' : 'neutre');
      const fini = ordre[ordre.length - 1].id === 'installation', dernier = n === ordre.length - 1;
      const c = h('div', { style: { display: 'contents' } }), valider = h('button', { class: 'bouton primaire' }, fini && n === ordre.length - 2 ? (choix.installerDisque ? 'Installer' : 'Terminer') : 'Continuer');
      OS.poser(panneau, e.id === 'style' ? null : h('div', { class: 'sur' }, `ÉTAPE ${n + 1} SUR ${ordre.length} · ${E[e.id].nom.toUpperCase()}`), c);
      const controle = await e.dessiner(c);
      if (e.sansBoutons) return;
      valider.onclick = async () => { valider.disabled = true; const ok = controle ? await controle() : true; valider.disabled = false; if (!ok) return; if (dernier) { el.remove(); fin(true); } else montrer(n + 1); };
      OS.ajouter(panneau, h('div', { class: 'bas' }, n > 0 && ordre[n - 1].id !== 'compte' ? h('button', { class: 'bouton contour', onclick: () => montrer(n - 1) }, 'Retour') : h('span'), h('span', { class: 'rangee' }, e.id === 'bienvenue' && !o.compte && !disque ? h('button', { class: 'bouton contour', onclick: () => { OS.regler({ accueilFait: true }); el.remove(); fin(false); } }, 'Passer') : null, valider)));
      panneau.scrollTop = 0; valider.focus({ preventScroll: true });
    }
    OS.ajouter(document.body, el); montrer(0);
  });
})();
