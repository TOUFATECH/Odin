// Odin OS — Odin Store, Odin Install, les applis d'Odin (vue générique) et Ullr, l'antivirus.
// Tout ce qui est affiché vient d'Odin (catalogue, pages, actions). En mode essai, c'est signalé.
(() => {
  'use strict';
  const OS = window.OS, h = OS.h, api = OS.api, ui = OS.ui, declarer = OS.declarer, P = OS.PLATEFORMES;
  const capacites = () => (api.systeme && api.systeme.capacites) || {};
  const rafraichirSysteme = async () => { const s = await api.infos().catch(() => null); if (s && s.ok) api.systeme = s; return s; };
  const pastille = (p, taille = 42) => h('span', { class: 'tuile', style: { width: `${taille}px`, height: `${taille}px`, background: P[p].couleur, fontSize: `${Math.round(taille * 0.46)}px` }, 'aria-hidden': 'true' }, P[p].lettre);

  /** Installe un pont de compatibilité (Wine, Waydroid, Darling) après accord. */
  OS.installerPont = async (id) => {
    const p = OS.PONTS[id];
    if (!await OS.confirmer(`Installer ${p.nom} ?`, `${p.resume} Odin OS télécharge ${p.moteur} une seule fois (plusieurs centaines de Mo). L'installation peut prendre quelques minutes.`, { oui: 'Installer' })) return false;
    const ok = await ui.tache(`Installation de ${p.nom}`, () => api.paquets('pont', id));
    await rafraichirSysteme();
    if (ok) OS.notifier({ titre: `${p.nom} est installé`, texte: `Les applis ${P[id].nom} peuvent maintenant s'ouvrir.` });
    return ok;
  };

  // Applis Linux installées (fichiers .desktop du système) : elles apparaissent dans le lanceur.
  OS.chargerApplisLinux = async () => {
    for (const k of Object.keys(OS.applis)) if (k.startsWith('linux:')) delete OS.applis[k];
    if (!capacites().apt) return [];
    const r = await api.paquets('applis').catch(() => null), liste = (r && r.applis) || [];
    for (const a of liste) OS.applis[`linux:${a.id}`] = { id: `linux:${a.id}`, nom: a.nom, couleur: ['#FBBF24', '#D97706'], encre: '#3B2A05', resume: a.resume, linux: true, lancer: async () => { if (!capacites().affichage) return OS.notifier({ titre: a.nom, texte: 'Cette appli a une fenêtre : elle s\'ouvre sur l\'image PC d\'Odin OS. Ici (sans écran), utilise sa commande dans le Terminal.' }); const x = await api.paquets('lancer', a.id); OS.notifier({ titre: a.nom, texte: x.ok ? 'Je l\'ouvre…' : (x.error || 'Lancement impossible.') }); } };
    OS.emettre('catalogue');
    return liste;
  };

  // ═══ Vue générique d'une appli d'Odin ═══
  /** Formulaire d'une action (ses paramètres), dans un dialogue. Renvoie les valeurs, ou null. */
  const formulaire = (titre, params, envoyer, aide) => new Promise((fin) => {
    const champs = {}, fermer = (v) => { fond.remove(); fin(v); };
    const lignes = params.map((p) => {
      let c;
      if (p.kind === 'select') { c = h('select', { class: 'champ' }, (p.options || []).map((o) => h('option', { value: o, selected: o === p.default }, o))); }
      else if (p.kind === 'boolean') { c = h('input', { type: 'checkbox', checked: Boolean(p.default) }); }
      else if (p.kind === 'textarea') { c = h('textarea', { class: 'champ', rows: '4' }); c.value = p.default == null ? '' : String(p.default); }
      else { c = h('input', { class: 'champ', type: p.kind === 'number' ? 'number' : p.kind === 'password' ? 'password' : 'text', autocomplete: 'off' }); c.value = p.default == null ? '' : String(p.default); }
      if (p.required) c.required = true;
      champs[p.key] = { c, p };
      return h('label', { style: { display: 'flex', flexDirection: p.kind === 'boolean' ? 'row' : 'column', gap: '6px', fontSize: '13px', fontWeight: '600' } }, p.label, c, p.help ? h('span', { class: 'attenue petit-texte', style: { fontWeight: '400' } }, p.help) : null);
    });
    const fond = h('div', { class: 'dialogue-fond', onclick: (e) => { if (e.target === fond) fermer(null); } }, h('form', { class: 'dialogue', role: 'dialog', 'aria-modal': 'true', 'aria-label': titre, onkeydown: (e) => { if (e.key === 'Escape') fermer(null); }, onsubmit: (e) => { e.preventDefault(); const v = {}; for (const [k, { c, p }] of Object.entries(champs)) v[k] = p.kind === 'boolean' ? c.checked : p.kind === 'number' ? Number(c.value) : c.value; fermer(v); } },
      h('h2', { class: 'titre-section', style: { fontSize: '18px' } }, titre), aide ? h('p', { class: 'attenue petit-texte' }, aide) : null, lignes,
      h('div', { class: 'rangee', style: { justifyContent: 'flex-end' } }, h('button', { type: 'button', class: 'bouton contour', onclick: () => fermer(null) }, 'Annuler'), h('button', { class: 'bouton primaire' }, envoyer || 'Lancer'))));
    OS.ajouter(document.body, fond); const premier = fond.querySelector('input,select,textarea'); if (premier) premier.focus();
  });
  /** Lance une action d'une appli d'Odin : formulaire si besoin, confirmation si l'action est grave. */
  async function lancerAction(module, a, entree) {
    let valeurs = entree;
    if (!valeurs && a.params && a.params.length) { valeurs = await formulaire(a.label, a.params, a.label, a.what); if (!valeurs) return null; }
    let r = await api.agir(module, a.id, valeurs || {});
    if (r && r.confirm) { if (!await OS.confirmer('Tu confirmes ?', r.confirm, { danger: true })) return null; r = await api.agir(module, a.id, valeurs || {}, true); }
    return r || { ok: false, error: 'Pas de réponse.' };
  }
  const classeTon = (t) => (t === 'bon' || t === 'attention' || t === 'mauvais' ? t : '');
  /** Dessine une section de page (tableau, liste, journal, texte, barres, formulaire). */
  function dessinerSection(s, agir) {
    const bloc = h('section', { class: 'carte', style: { overflow: 'auto' } }, h('h3', { class: 'titre-section', style: { marginBottom: '8px' } }, s.title));
    if (s.kind === 'table') {
      if (!s.rows.length) OS.ajouter(bloc, h('p', { class: 'attenue' }, s.empty || 'Rien pour l\'instant.'));
      else OS.ajouter(bloc, h('table', { class: 'liste' }, h('thead', null, h('tr', null, s.columns.map((c) => h('th', null, c)), s.rows.some((r) => r.actions && r.actions.length) ? h('th') : null)), h('tbody', null, s.rows.map((r) => h('tr', null, r.cells.map((c, i) => h('td', { title: c, style: i === 0 && classeTon(r.tone) ? { color: `var(--${classeTon(r.tone)})`, fontWeight: '600' } : null }, c)), r.actions && r.actions.length ? h('td', null, h('span', { class: 'rangee', style: { gap: '6px' } }, r.actions.map((x) => h('button', { class: 'bouton petit', onclick: () => agir({ id: x.action, label: x.label }, x.input) }, x.label)))) : null)))));
    } else if (s.kind === 'list') {
      if (!s.items.length) OS.ajouter(bloc, h('p', { class: 'attenue' }, s.empty || 'Rien pour l\'instant.'));
      for (const it of s.items) OS.ajouter(bloc, h('div', { class: 'ligne' }, classeTon(it.tone) ? h('span', { class: `puce ${classeTon(it.tone)}` }, '●') : null, h('div', { style: { minWidth: 0, flex: '1' } }, h('div', null, it.title), it.detail ? h('div', { class: 'attenue petit-texte' }, it.detail) : null), it.meta ? h('span', { class: 'attenue petit-texte' }, it.meta) : null));
    } else if (s.kind === 'log') OS.ajouter(bloc, h('div', { class: 'journal' }, s.lines.join('\n') || '—'));
    else if (s.kind === 'text') OS.ajouter(bloc, h('p', { style: { whiteSpace: 'pre-wrap', color: classeTon(s.tone) ? `var(--${classeTon(s.tone)})` : null } }, s.text));
    else if (s.kind === 'bars') { const max = Math.max(1, ...s.items.map((i) => i.value)); for (const it of s.items) OS.ajouter(bloc, h('div', { class: 'rangee', style: { margin: '6px 0' } }, h('span', { style: { width: '34%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.label), h('span', { style: { flex: '1', height: '10px', borderRadius: '5px', background: 'var(--surface3)', overflow: 'hidden' } }, h('span', { style: { display: 'block', height: '100%', width: `${Math.round(it.value / max * 100)}%`, background: 'var(--accent)' } })), h('span', { class: 'attenue petit-texte' }, it.display || String(it.value)))); }
    else if (s.kind === 'form') OS.ajouter(bloc, h('p', { class: 'attenue petit-texte', style: { marginBottom: '8px' } }, s.params.map((p) => p.label).join(' · ')), h('button', { class: 'bouton petit primaire', onclick: () => agir({ id: s.action, label: s.title, params: s.params }) }, s.submit || 'Lancer'));
    return bloc;
  }
  /** Page d'une appli d'Odin : résumé, chiffres, actions, sections. `tete(vue, outils)` permet une entête sur mesure (Ullr). */
  OS.vueOdin = async (ctx, id, tete) => {
    const c = h('div', { class: 'contenu' }); OS.ajouter(ctx.corps, h('div', { class: 'principal' }, c));
    const resultat = h('div', { class: 'journal', hidden: true, role: 'status' });
    let enCours = false;
    const charger = async () => {
      let r; try { r = await api.vue(id); } catch (e) { r = { ok: false, error: e.message }; }
      if (!r || !r.ok) { OS.poser(c, ui.message((r && r.error) || 'Cette appli ne répond pas.', 'attention')); return; }
      const appli = OS.applis[`odin:${id}`] || { nom: r.name, couleur: OS.FAMILLES[r.family] }, v = r.view || { sections: [] };
      const agir = async (a, entree) => {
        if (enCours) return; enCours = true; OS.humeur('concentration');
        resultat.hidden = false; resultat.textContent = `${a.label}…`;
        const x = await lancerAction(id, a, entree).catch((e) => ({ ok: false, error: e.message }));
        enCours = false; OS.humeur('neutre');
        if (x === null) { resultat.hidden = true; return; }
        await charger(); resultat.hidden = false; resultat.textContent = x.text || x.error || 'Fait.'; resultat.scrollIntoView({ block: 'nearest' });
        OS.humeur(x.ok === false ? 'inquiet' : 'joie', 2500);
      };
      const rapides = r.actions.filter((a) => a.quick !== false);
      OS.poser(c, 
        h('div', { class: 'rangee' }, OS.tuile(appli, 52), h('div', { style: { minWidth: 0, flex: '1' } }, h('h2', { class: 'titre-app' }, r.name), h('p', { class: 'attenue' }, r.what)), r.essai ? OS.etiquetteEssai() : null, h('button', { class: 'icone-b', 'aria-label': 'Actualiser', title: 'Actualiser', onclick: charger }, OS.icone('maj', 18))),
        tete ? tete(r, { agir, charger }) : null,
        v.subtitle && !tete ? h('p', { class: 'attenue' }, v.subtitle) : null,
        v.kpis && v.kpis.length ? h('div', { class: 'kpis' }, v.kpis.map((k) => h('div', { class: `kpi ${classeTon(k.tone)}`, title: k.hint || '' }, h('b', null, k.value), h('span', { class: 'attenue petit-texte' }, k.hint ? `${k.label} · ${k.hint}` : k.label)))) : null,
        resultat,
        rapides.length ? h('div', { class: 'rangee', style: { flexWrap: 'wrap', gap: '8px' } }, rapides.slice(0, 8).map((a) => h('button', { class: 'bouton petit', title: a.what, onclick: () => agir(a) }, a.label)), r.actions.length > 8 ? h('button', { class: 'bouton petit contour', onclick: (e) => ui.menu(e.clientX, e.clientY, r.actions.slice(8).map((a) => ({ nom: a.label, action: () => agir(a) }))) }, 'Autres actions…') : null) : null,
        ...v.sections.map((s) => dessinerSection(s, agir)), ...(v.side || []).map((s) => dessinerSection(s, agir)));
      ctx.titre(r.name);
    };
    OS.ajouter(c, ui.attente('J\'ouvre l\'appli…'));
    await charger();
  };

  // ═══ Ullr : entête sur mesure (protégé ou non, analyses, Skögul), puis les sections d'Odin ═══
  function declarerUllr() {
    const base = OS.applis['odin:ullr']; if (!base) return;
    base.icone = 'bouclier'; base.largeur = 940; base.hauteur = 640;
    base.ouvrir = (ctx) => OS.vueOdin(ctx, 'ullr', (r, o) => {
      const kpi = (nom) => ((r.view.kpis || []).find((k) => k.label === nom) || {}).value, incidents = Number(kpi('Incidents ouverts') || 0), aVerifier = Number(kpi('Détections') || 0), souci = incidents + aVerifier > 0;
      const skogul = h('div', { class: 'carte rangee' }, OS.applis['odin:skogul'] ? OS.tuile(OS.applis['odin:skogul'], 40) : null, h('div', { style: { flex: '1', minWidth: 0 } }, h('div', { class: 'titre-section' }, 'Skögul · anti-malware'), h('div', { class: 'attenue petit-texte', id: 'ullr-skogul' }, 'Surveille le comportement des programmes.')), h('button', { class: 'bouton petit', onclick: () => { OS.installerAppli('skogul', { silence: true }); OS.ouvrir('odin:skogul'); } }, 'Ouvrir'));
      api.vue('skogul').then((s) => { const k = s && s.ok && s.view.kpis && s.view.kpis[0]; const e = skogul.querySelector('#ullr-skogul'); if (k && e) e.textContent = `${k.value} comportement${Number(k.value) > 1 ? 's' : ''} suspect${Number(k.value) > 1 ? 's' : ''} en ce moment.${s.essai ? ' (exemple)' : ''}`; }).catch(() => {});
      return h('div', { class: 'grille' },
        h('div', { class: `bandeau ${souci ? 'attention' : ''}` }, OS.icone(souci ? 'alerte' : 'protege', 44), h('div', { style: { flex: '1', minWidth: 0 } }, h('div', { class: 'titre-app', style: { fontSize: '24px' } }, souci ? 'Il y a quelque chose à regarder' : 'Tu es protégé'), h('div', { class: 'attenue' }, souci ? `${incidents} incident${incidents > 1 ? 's' : ''} ouvert${incidents > 1 ? 's' : ''} · ${aVerifier} fichier${aVerifier > 1 ? 's' : ''} à vérifier` : (r.view.subtitle || 'Aucun incident ouvert, aucun fichier à vérifier.'))),
          h('div', { class: 'rangee', style: { flexWrap: 'wrap', gap: '8px' } }, h('button', { class: 'bouton primaire', onclick: () => o.agir({ id: 'analyser', label: 'Analyse rapide' }, { dossier: 'téléchargements' }) }, 'Analyse rapide'), h('button', { class: 'bouton', onclick: () => o.agir({ id: 'analyser', label: 'Analyse complète' }, { dossier: 'maison' }) }, 'Analyse complète'))),
        skogul,
        h('p', { class: 'attenue petit-texte' }, 'Aucun antivirus ne détecte toutes les menaces, Ullr non plus. Il s\'ajoute à tes autres protections. Une quarantaine est toujours réversible.'));
    });
  }
  OS.sur('catalogue', declarerUllr);

  // ═══ Odin Install : que faire de ce fichier d'appli ? ═══
  declarer({ id: 'installer', nom: 'Odin Install', icone: 'paquet', couleur: ['#34D399', '#047857'], largeur: 560, hauteur: 470, multiple: true, ouvrir(ctx) {
    const c = h('div', { class: 'contenu', style: { flex: '1' } }); OS.ajouter(ctx.corps, c);
    const montrer = async (chemin) => {
      await rafraichirSysteme();
      const nom = chemin.split('/').pop(), v = OS.compat(chemin), p = v.plateforme, pont = OS.PONTS[p];
      ctx.titre(`Odin Install · ${nom}`);
      const fermer = h('button', { class: 'bouton contour', onclick: () => ctx.fermer() }, 'Fermer');
      let action = null;
      if (v.verdict === 'ok' && v.action === 'fichier') action = h('button', { class: 'bouton primaire', onclick: async () => { if (await ui.tache(`Installation de ${nom}`, () => api.paquets('fichier', chemin))) { await OS.chargerApplisLinux(); OS.notifier({ titre: `${nom} est installé`, texte: 'Tu le trouves dans le lanceur.' }); ctx.fermer(); } } }, 'Installer');
      else if (v.verdict === 'ok' && v.action === 'ouvrir') action = h('button', { class: 'bouton primaire', onclick: async () => { const r = await api.paquets('ouvrir', chemin); OS.notifier({ titre: nom, texte: r.ok ? (r.text || 'Je l\'ouvre…') : (r.error || 'Lancement impossible.') }); if (r.ok) ctx.fermer(); } }, 'Ouvrir');
      else if (v.verdict === 'pont') action = h('button', { class: 'bouton primaire', onclick: async () => { if (await OS.installerPont(v.pont)) montrer(chemin); } }, `Installer ${pont.nom}`);
      const ton = v.verdict === 'ok' ? 'bon' : v.verdict === 'impossible' ? 'mauvais' : v.verdict === 'pont' ? 'info' : 'attention';
      OS.poser(c, 
        h('div', { class: 'rangee' }, p ? pastille(p, 60) : OS.tuile({ nom: '?', couleur: ['#94A3B8', '#475569'] }, 60), h('div', { style: { minWidth: 0 } }, h('h2', { class: 'titre-app', style: { fontSize: '22px', overflowWrap: 'anywhere' } }, nom), h('p', { class: 'attenue' }, p ? `Appli ${P[p].nom}` : 'Type inconnu'))),
        h('div', null, h('span', { class: `puce ${ton}` }, v.titre)),
        h('div', { class: 'carte' }, h('p', null, v.texte), pont && v.verdict !== 'impossible' ? h('p', { class: 'attenue petit-texte', style: { marginTop: '8px' } }, `Fonctionne avec ${pont.nom} (${pont.moteur}), téléchargé une seule fois.`) : null),
        h('div', { class: 'rangee', style: { alignItems: 'flex-end', marginTop: 'auto' } }, OS.mascotte(56, { decor: true }), h('p', { class: 'bulle', style: { flex: '1' } }, v.verdict === 'ok' ? 'C\'est bon pour moi. Clique, je fais le reste.' : v.verdict === 'pont' ? 'Il me manque un pont pour cette appli. Je peux l\'installer maintenant.' : v.verdict === 'impossible' ? 'Celle-là, personne ne peut l\'installer ici. Cherche sa version Android ou web.' : 'Je préfère te le dire plutôt que de faire semblant : pas possible ici pour l\'instant.')),
        h('div', { class: 'rangee', style: { justifyContent: 'flex-end' } }, fermer, action));
    };
    if (ctx.options.chemin) return void montrer(ctx.options.chemin);
    const champ = h('input', { class: 'champ', placeholder: 'Documents/appli.deb, jeu.exe, appli.apk…', 'aria-label': 'Fichier d\'appli', style: { flex: '1' } });
    ctx.titre('Odin Install');
    OS.ajouter(c, h('div', { class: 'rangee' }, OS.mascotte(64, { decor: true }), h('div', null, h('h2', { class: 'titre-app', style: { fontSize: '22px' } }, 'Installer une appli'), h('p', { class: 'attenue' }, 'Donne-moi un fichier d\'appli : je te dis si elle peut tourner ici, et je l\'installe.'))),
      h('form', { class: 'rangee', onsubmit: (e) => { e.preventDefault(); if (champ.value.trim()) montrer(champ.value.trim()); } }, champ, h('button', { class: 'bouton primaire' }, 'Analyser')),
      h('div', { class: 'rangee' }, h('button', { class: 'bouton', onclick: () => OS.ouvrir('fichiers') }, OS.icone('dossier', 16), 'Choisir dans Fichiers'), h('button', { class: 'bouton', onclick: () => OS.ouvrir('store') }, OS.icone('store', 16), 'Ouvrir Odin Store')),
      h('p', { class: 'attenue petit-texte' }, 'Dans Fichiers, un double-clic sur un fichier .deb, .exe, .apk ou .dmg ouvre directement Odin Install.'));
  } });

  // ═══ Odin Store ═══
  const SUGGESTIONS_LINUX = ['vlc', 'gimp', 'inkscape', 'libreoffice', 'audacity', 'htop', 'git', 'foot'];
  declarer({ id: 'store', nom: 'Odin Store', icone: 'store', couleur: ['#A78BFA', '#DB2777'], largeur: 1000, hauteur: 650, ouvrir(ctx) {
    let section = ctx.options.section || 'accueil', famille = '', lateral = h('div'); const page = h('div', { class: 'principal' });
    OS.ajouter(ctx.corps, h('div', { class: 'colonnes' }, lateral, page));
    const nb = () => OS.catalogue.filter((m) => OS.installee(m.id)).length;
    const SECTIONS = () => [{ id: 'accueil', nom: 'Accueil', icone: 'maison' }, { id: 'odin', nom: 'Applis d\'Odin', icone: 'etoile', pastille: OS.catalogue.length - nb() || null }, { id: 'installees', nom: 'Installées', icone: 'coche' }, { rubrique: 'PLATEFORMES' }, ...['linux', 'windows', 'android', 'mac', 'iphone'].map((p) => ({ id: p, nom: P[p].nom, tuile: pastille(p, 20) }))];
    const boutonOdin = (m, redessiner) => (OS.installee(m.id) ? h('button', { class: 'bouton petit', onclick: () => OS.ouvrir(`odin:${m.id}`) }, 'Ouvrir') : h('button', { class: 'bouton petit primaire', onclick: () => { OS.installerAppli(m.id); redessiner(); } }, 'Installer'));
    const ficheOdin = (m, redessiner, colonne) => h('div', { class: `fiche ${colonne ? 'colonne' : ''}` }, h('button', { type: 'button', 'aria-label': `Détails de ${m.nom}`, onclick: () => detail(m) }, OS.tuile(OS.applis[`odin:${m.id}`], colonne ? 52 : 44)), h('div', { class: 'txt' }, h('b', null, m.nom), h('span', null, m.resume), colonne ? null : h('div', { class: 'plateformes' }, h('i', { style: { background: (OS.FAMILLES[m.famille] || ['#64748B'])[0], color: '#0B1220' } }, m.famille))), boutonOdin(m, redessiner));
    const montrer = (id) => { section = id; lateral.replaceWith(lateral = ui.lateral(SECTIONS(), section, montrer, 'Odin Store')); const c = h('div', { class: 'contenu' }); OS.poser(page, c); ctx.titre(`Odin Store · ${id === 'accueil' ? 'Accueil' : id === 'odin' ? 'Applis d\'Odin' : id === 'installees' ? 'Installées' : P[id].nom}`); PAGES[id](c); };
    function detail(m) {
      const c = h('div', { class: 'contenu' }); OS.poser(page, c); ctx.titre(`Odin Store · ${m.nom}`);
      OS.ajouter(c, h('div', null, h('button', { class: 'bouton petit contour', onclick: () => montrer(section) }, OS.icone('gauche', 14), 'Retour')),
        h('div', { class: 'rangee', style: { gap: '18px' } }, OS.tuile(OS.applis[`odin:${m.id}`], 84), h('div', { style: { flex: '1', minWidth: 0 } }, h('h2', { class: 'titre-app' }, m.nom), h('p', { class: 'attenue' }, `${m.famille} · appli d'Odin · gratuite`), h('p', { style: { marginTop: '6px' } }, m.resume)), boutonOdin(m, () => detail(m)), OS.installee(m.id) ? h('button', { class: 'bouton petit contour', onclick: () => { OS.retirerAppli(m.id); detail(m); } }, 'Retirer') : null),
        h('div', { class: 'carte' }, h('h3', { class: 'titre-section', style: { marginBottom: '8px' } }, 'Ce qu\'elle fait'), h('ul', { style: { margin: 0, paddingLeft: '20px', display: 'grid', gap: '4px' } }, m.fait.map((d) => h('li', null, d)))),
        h('div', { class: 'carte' }, h('h3', { class: 'titre-section', style: { marginBottom: '8px' } }, 'Où elle marche'), h('div', { class: 'rangee', style: { flexWrap: 'wrap' } }, h('span', { class: 'puce bon' }, 'Ordinateur'), h('span', { class: 'puce bon' }, 'Téléphone'), h('span', { class: 'attenue petit-texte' }, 'Les applis d\'Odin tournent dans Odin : elles marchent partout où Odin OS s\'affiche.'))));
    }
    const pagePont = (p) => async (c) => {
      const pont = OS.PONTS[p]; OS.ajouter(c, ui.attente());
      await rafraichirSysteme(); const e = (capacites().ponts || {})[p] || {};
      OS.poser(c, h('div', { class: 'rangee', style: { gap: '16px' } }, pastille(p, 64), h('div', { style: { flex: '1', minWidth: 0 } }, h('h2', { class: 'titre-app' }, `Applis ${P[p].nom}`), h('p', { class: 'attenue' }, `${pont.nom} · ${pont.moteur}`))),
        h('div', { class: 'carte rangee' }, h('div', { style: { flex: '1', minWidth: 0 } }, h('div', { class: 'titre-section' }, e.installe ? `${pont.nom} est installé` : e.possible ? `${pont.nom} n'est pas encore installé` : `${pont.nom} ne s'installe pas ici`), h('p', { class: 'attenue petit-texte' }, e.installe || e.possible ? pont.resume : (e.pourquoi || `Ce pont s'installe sur un Odin OS installé (Docker, LXC, PC).`))), e.installe ? h('span', { class: 'puce bon' }, 'Prêt') : e.possible ? h('button', { class: 'bouton primaire', onclick: async () => { await OS.installerPont(p); montrer(p); } }, 'Installer') : h('span', { class: 'puce' }, 'Pas ici')),
        h('div', { class: 'carte' }, h('h3', { class: 'titre-section', style: { marginBottom: '6px' } }, 'Comment installer une appli'), h('p', { class: 'attenue', style: { whiteSpace: 'pre-wrap' } }, `1. Télécharge l'installeur de l'appli (${p === 'windows' ? '.exe ou .msi' : p === 'android' ? '.apk' : '.dmg ou .pkg'}) depuis le site de son éditeur.\n2. Dans Fichiers, double-clique dessus : Odin Install s'ouvre.\n3. Odin vérifie le fichier et le lance avec ${pont.nom}.`), h('div', { class: 'rangee', style: { marginTop: '10px' } }, h('button', { class: 'bouton', onclick: () => OS.ouvrir('fichiers') }, OS.icone('dossier', 16), 'Ouvrir Fichiers'))),
        h('p', { class: 'attenue petit-texte' }, p === 'mac' ? 'Darling est expérimental : la plupart des applis Mac à fenêtre ne démarrent pas encore. Je préfère te le dire.' : p === 'android' ? 'Waydroid a besoin de l\'image PC d\'Odin OS (un vrai noyau Linux et un écran). Il ne tourne pas dans Docker ni LXC.' : 'Odin Store ne distribue pas d\'applis Windows : tu apportes l\'installeur, Odin le fait tourner. Toutes les applis Windows ne marchent pas avec Wine.'));
    };
    const PAGES = {
      accueil(c) {
        OS.ajouter(c, h('div', { class: 'store-banniere' }, h('p', { style: { fontSize: '12px', fontWeight: '700', letterSpacing: '1px', opacity: '.85' } }, 'À LA UNE · DANS ODIN OS'), h('h2', null, `Les ${OS.catalogue.length} applis d'Odin, en un clic`), h('p', { style: { marginTop: '8px', maxWidth: '520px', opacity: '.92' } }, 'Antivirus, sauvegardes, notes, automatisations, maison connectée… Elles marchent sur l\'ordinateur et sur le téléphone.'), h('div', { class: 'rangee', style: { marginTop: '14px' } }, h('button', { class: 'bouton', style: { background: '#fff', color: '#1E1B4B' }, onclick: () => montrer('odin') }, 'Voir les applis d\'Odin'), OS.etiquetteEssai())),
          h('div', { class: 'rangee entre' }, h('h3', { class: 'titre-section' }, 'Applis d\'Odin'), h('button', { class: 'bouton petit contour', onclick: () => montrer('odin') }, `Les ${OS.catalogue.length} applis ›`)),
          h('div', { class: 'grille', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' } }, OS.catalogue.slice().sort((a, b) => (a.famille === 'Sécurité' ? -1 : 0) - (b.famille === 'Sécurité' ? -1 : 0)).slice(0, 6).map((m) => ficheOdin(m, () => montrer('accueil'), true))),
          h('h3', { class: 'titre-section' }, 'Toutes les plateformes'),
          h('div', { class: 'grille', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' } }, ['linux', 'windows', 'android', 'mac', 'iphone'].map((p) => h('button', { type: 'button', class: 'fiche', style: { textAlign: 'left' }, onclick: () => montrer(p) }, pastille(p), h('div', { class: 'txt' }, h('b', null, `Applis ${P[p].nom}`), h('span', null, p === 'linux' ? 'Depuis le dépôt Ubuntu ou un fichier .deb.' : p === 'iphone' ? 'Pas installables hors d\'un iPhone.' : `Avec ${OS.PONTS[p].nom} (${OS.PONTS[p].moteur}).`))))),
          h('p', { class: 'attenue petit-texte' }, 'Une appli introuvable ? Demande-la à Odin : ouvre sa bulle en bas de l\'écran.'));
      },
      odin(c) {
        const familles = ['', ...Object.keys(OS.FAMILLES)], liste = OS.catalogue.filter((m) => !famille || m.famille === famille), reste = OS.catalogue.filter((m) => !OS.installee(m.id));
        OS.ajouter(c, h('div', { class: 'rangee entre', style: { flexWrap: 'wrap' } }, h('div', null, h('h2', { class: 'titre-app' }, 'Applis d\'Odin'), h('p', { class: 'attenue' }, `${OS.catalogue.length} applis, toutes installables ici. ${nb()} déjà installée${nb() > 1 ? 's' : ''}.`)), reste.length ? h('button', { class: 'bouton primaire', onclick: () => { for (const m of reste) OS.installerAppli(m.id, { silence: true }); OS.notifier({ titre: 'Tout est installé', texte: `${reste.length} applis ajoutées au lanceur.` }); montrer('odin'); } }, 'Tout installer') : h('span', { class: 'puce bon' }, 'Tout est installé')),
          h('div', { class: 'segments', role: 'tablist', style: { alignSelf: 'flex-start', flexWrap: 'wrap' } }, familles.map((f) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(f === famille), onclick: () => { famille = f; montrer('odin'); } }, f || 'Toutes'))),
          h('div', { class: 'grille', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' } }, liste.map((m) => ficheOdin(m, () => montrer('odin')))), OS.etiquetteEssai() ? h('div', null, OS.etiquetteEssai('Essai : la liste est la vraie, les pages des applis sont des exemples')) : null);
      },
      async installees(c) {
        OS.ajouter(c, h('h2', { class: 'titre-app' }, 'Installées'), h('h3', { class: 'titre-section' }, `Applis d'Odin (${nb()})`), h('div', { class: 'grille', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' } }, OS.catalogue.filter((m) => OS.installee(m.id)).map((m) => ficheOdin(m, () => montrer('installees')))));
        const linux = await OS.chargerApplisLinux();
        OS.ajouter(c, h('h3', { class: 'titre-section' }, `Applis Linux (${linux.length})`), linux.length ? h('div', { class: 'grille', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' } }, linux.map((a) => h('div', { class: 'fiche' }, OS.tuile(OS.applis[`linux:${a.id}`], 44), h('div', { class: 'txt' }, h('b', null, a.nom), h('span', null, a.resume || a.id)), h('button', { class: 'bouton petit', onclick: () => OS.applis[`linux:${a.id}`].lancer() }, 'Ouvrir')))) : h('p', { class: 'attenue' }, capacites().apt ? 'Aucune appli Linux à fenêtre installée. Cherche-en une dans la page Linux.' : 'Les applis Linux s\'installent sur un Odin OS installé (Docker, LXC, PC).'));
      },
      linux(c) {
        const resultats = h('div', { class: 'grille' }), champ = h('input', { placeholder: 'Nom d\'une appli ou d\'un outil Linux…', 'aria-label': 'Chercher une appli Linux' });
        const ligne = (p) => h('div', { class: 'fiche' }, pastille('linux'), h('div', { class: 'txt' }, h('b', null, p.nom), h('span', null, p.resume || 'Paquet du dépôt Ubuntu')), p.installe ? h('button', { class: 'bouton petit contour', onclick: async () => { if (await OS.confirmer(`Retirer ${p.nom} ?`, 'Le paquet sera désinstallé du système.', { danger: true, oui: 'Retirer' })) { await ui.tache(`Retrait de ${p.nom}`, () => api.paquets('retirer', p.nom)); await OS.chargerApplisLinux(); chercher(champ.value || p.nom); } } }, 'Retirer') : h('button', { class: 'bouton petit primaire', onclick: async () => { if (await ui.tache(`Installation de ${p.nom}`, () => api.paquets('installer', p.nom))) { await OS.chargerApplisLinux(); OS.notifier({ titre: `${p.nom} est installé`, texte: 'Paquet Linux installé depuis le dépôt Ubuntu.' }); } chercher(champ.value || p.nom); } }, 'Installer'));
        const chercher = async (mot) => { if (!mot.trim()) return; OS.poser(resultats, ui.attente('Je cherche dans le dépôt Ubuntu…')); const r = await api.paquets('chercher', mot.trim()).catch((e) => ({ ok: false, error: e.message })); if (!r.ok) return OS.poser(resultats, ui.message(r.error || 'Recherche impossible.', 'attention')); OS.poser(resultats, ...(r.paquets.length ? r.paquets.map(ligne) : [h('p', { class: 'attenue' }, 'Aucun paquet trouvé avec ce nom.')])); };
        OS.ajouter(c, h('div', { class: 'rangee', style: { gap: '16px' } }, pastille('linux', 64), h('div', null, h('h2', { class: 'titre-app' }, 'Applis Linux'), h('p', { class: 'attenue' }, 'Le dépôt Ubuntu : des dizaines de milliers d\'applis et d\'outils, vérifiés et signés.'))));
        if (!capacites().apt) return void OS.ajouter(c, ui.message('Les applis Linux s\'installent sur un Odin OS installé (Docker, LXC, PC). Ici, il n\'y a pas de système Ubuntu derrière le bureau.'), OS.etiquetteEssai());
        if (!capacites().affichage) OS.ajouter(c, ui.message('Ici, Odin OS tourne sans écran : les outils en ligne de commande marchent (dans le Terminal). Les applis à fenêtre s\'affichent sur l\'image PC.'));
        OS.ajouter(c, h('form', { class: 'recherche', role: 'search', onsubmit: (e) => { e.preventDefault(); chercher(champ.value); } }, OS.icone('loupe', 16), champ), h('div', { class: 'rangee', style: { flexWrap: 'wrap', gap: '6px' } }, h('span', { class: 'attenue petit-texte' }, 'Idées :'), SUGGESTIONS_LINUX.map((s) => h('button', { class: 'bouton petit', onclick: () => { champ.value = s; chercher(s); } }, s))), resultats);
      },
      windows: pagePont('windows'), android: pagePont('android'), mac: pagePont('mac'),
      iphone(c) { OS.ajouter(c, h('div', { class: 'rangee', style: { gap: '16px' } }, pastille('iphone', 64), h('div', null, h('h2', { class: 'titre-app' }, 'Applis iPhone'), h('p', { class: 'attenue' }, 'Pas installables sur Odin OS.'))), h('div', { class: 'carte' }, h('p', null, 'Apple ne permet pas d\'installer une appli iPhone ailleurs que sur un iPhone, et aucune couche de compatibilité fiable n\'existe. Odin OS ne fait pas semblant.'), h('p', { class: 'attenue', style: { marginTop: '8px' } }, 'La plupart des applis iPhone ont une version Android ou une version web : c\'est celle-là qu\'Odin peut faire tourner.')), h('div', { class: 'rangee' }, h('button', { class: 'bouton', onclick: () => montrer('android') }, 'Voir les applis Android'))); },
    };
    montrer(section);
  } });
})();
