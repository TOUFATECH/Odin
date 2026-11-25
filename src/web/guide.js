// Odin, ton guide, sur toutes les pages. Sa bulle s’ouvre par « Explique-moi pas à pas » (dans « Que veux-tu ? », quand on touche Odin, ou en tapant « aide »), « Quoi de neuf » ou une question :
// - tu lui parles directement, où que tu sois : c'est la même conversation que la page Discussion (il voit
//   la page ou l'appli ouverte), il te répond dans la bulle, et à voix haute tant que tu ne l'as pas coupé
//   (Réglages → Voix, ou le bouton 🔊 de la bulle) ;
// - il explique la page ou l'appli ouverte, et comment s'en servir et la régler de A à Z ;
// - « Quoi de neuf » détaille les dernières mises à jour, et il te les présente tout seul après une mise à jour ;
// - « Arbre d'évolution » montre toute l'histoire d'Odin, appli par appli, avec les dates.
// Son infobulle et son champ de saisie changent selon la page ou l'appli. La bulle ne s'ouvre jamais d'elle-même
// (sauf une fois après une mise à jour, pour les nouveautés) : Échap, un clic ailleurs ou son bouton la ferment.
(() => {
  'use strict';
  if (window.OdinGuide) return;
  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, a = {}, ...kids) => { const n = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (v === undefined || v === null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); } for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k))); return n; };
  const post = async (path, body) => { const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) }); return r.json(); };
  const get = async (path) => (await fetch(path, { headers: { 'x-odin': '1' } })).json();

  // Ce que fait chaque page, puis comment s'en servir et la régler (de A à Z).
  const VIEWS = {
    home: ['Accueil', 'Ta journée d\'un coup d\'œil : ce qui demande ton attention, ce que j\'ai fait, l\'état de tes machines. Touche une carte pour aller au détail.',
      ['Lis « À faire » de haut en bas : chaque carte a son bouton d\'action.', '« Ce qu\'Odin a fait » : touche une ligne pour le détail, ou « Annuler » si tu n\'es pas d\'accord.', 'Les quatre tuiles du bas : la surveillance (disques et appareils marqués), la sauvegarde, le résumé du matin et l\'application, chacune avec ses boutons.'],
      ['Ce qui s\'affiche ici vient des autres pages : étoile un appareil dans Maison pour qu\'il apparaisse, crée une tâche planifiée pour tes rappels.', 'Le thème (clair, sombre, automatique) : bouton en haut.']],
    chat: ['Discussion', 'Ici tu me parles, par écrit ou à la voix. Dis ce que tu veux obtenir : un résumé, un fichier, une action.',
      ['Écris ta demande et appuie sur Entrée ; joins des fichiers avec le trombone ; le micro dicte.', 'Une action importante t\'est présentée avant : Oui ou Non.', 'Les conversations passées sont à gauche (renommer, épingler, supprimer).', 'Tu peux aussi me parler depuis n\'importe quelle page : touche-moi, c\'est la même conversation.'],
      ['Mon modèle d\'IA : Réglages → Modèle.', 'Ma voix et la lecture à voix haute : Réglages → Voix.', 'Mon autonomie (Prudent, Équilibré, Autonome) : Réglages → Autonomie.']],
    brain: ['Cerveau', 'Ton deuxième cerveau : tes notes, reliées entre elles, avec leur graphe, les fiches de mes applis et mes souvenirs. J\'y range ce que tu me confies, et je le consulte avant de te répondre.',
      ['« Nouvelle note » ou capture rapide ; [[un nom]] relie deux notes.', '« Souvenirs » : ce que je retiens de toi (préférences, habitudes, corrections) ; relis, corrige, épingle ou fais-moi oublier. La recherche du Cerveau les trouve aussi.', 'Le graphe montre les liens ; touche un point pour ouvrir la note.', '« Demander au cerveau » : je réponds à partir de tes notes, avec les sources.', '« Quotidien » : ce que je sais refaire sans IA, parce que je l\'ai appris en te parlant. Ouvre une mission pour voir ce que je fais et à quoi elle est reliée ; mets-la à la corbeille pour que je l\'oublie.'],
      ['Les connecteurs (Telegram, mail, agenda, Notion…) remplissent le Cerveau quand ils sont configurés : chacun dit s\'il est actif ou ce qu\'il manque.', 'Les réglages du graphe (couleurs, étiquettes, forces) sont dans le panneau du graphe.']],
    maison: ['Home Assistant', 'L\'écran de la maison, ici dans Odin : pièces et appareils, scènes, météo, caméras, famille, tes boutons et ses thèmes. Le même que sur les tablettes murales.',
      ['Les sections sont dans sa colonne d\'icônes (au téléphone : en haut de l\'écran, la barre du bas reste celle d\'Odin) ; touche un appareil pour l\'allumer ou le régler.', '« Modifier l\'écran » range ses modules ; « Thèmes » change ses couleurs.', 'Sa mascotte te répond (météo, heure, alertes) et fait ce que tu lui demandes, avec les mêmes validations que dans Odin.'],
      ['Une tablette murale : crée-lui une clé dans l\'appli Hestia, elle ouvrira cet écran seul, sans Odin autour.', 'Les appareils viennent de Home Assistant, de Midgard ou de tes prises : Réglages → Maison.']],
    venus: ['Vénus', 'Tes films, séries, animés et clips, ici dans Odin : la même interface que Venus, avec son menu, sa recherche et son lecteur. Le menu d\'Odin reste à côté.',
      ['Touche une affiche pour sa fiche, puis « Lecture » ; le lecteur passe en plein écran.', '« Qui regarde ? » : chaque profil a sa liste et sa reprise.', '« Médiathèques et écrans » ouvre la page de gestion (dossiers, scan, écrans, YouTube).'],
      ['Les dossiers de films et de séries : « Médiathèques et écrans », onglet Odéon.', 'L\'adresse d\'un Venus à part : Réglages → Venus.']],
    net: ['Maison', 'Ta maison et ton réseau : les appareils, les pièces, les scènes.',
      ['La liste montre chaque appareil ; touche-le pour sa fiche (nom, pièce, bloquer sur la box).', 'Touche une machine : sous sa fiche, ses paquets réseau (Ariane, comme Wireshark) — « En direct » pour les voir passer, l\'historique en dessous, « Enregistrer en continu » pour tout garder.', 'Carte : un graphe où chaque appareil est relié à sa famille et à la box, comme le Cerveau. Pastille rouge : un risque repéré ou un appareil surveillé tombé ; point gris : hors ligne. Touche un point pour sa fiche.', 'L\'étoile : je te préviens quand l\'appareil tombe, puis quand il revient.', 'La carte place les appareils ; la sécurité liste ce qui est exposé.'],
      ['Le réseau à surveiller et la box : Réglages → Réseau.', 'Home Assistant, Hue, WLED : Réglages → Maison connectée.', 'Proxmox : Réglages → Machines.']],
    apps: ['Applis', 'Toutes mes applis, rangées par famille. En haut : ce que j\'ai fait de moi-même (à garder ou à annuler) et l\'état de la protection.',
      ['Le graphe relie chaque appli à sa famille et aux applis avec lesquelles elle travaille ; pastille rouge ou orange = alertes, bleue = nouveautés de son projet d\'origine.', 'Touche un point pour ouvrir l\'appli : ses chiffres, ses boutons rapides, ses autres actions.', '« J\'ai besoin de… » : décris ton besoin, je choisis l\'appli.', 'Touche-moi sur une appli : je t\'explique comment l\'utiliser et la régler.'],
      ['Le niveau des alertes se règle en haut de cette page.', 'Les clés et mots de passe des applis se rangent dans le coffre (Réglages → Coffre), jamais dans une note.']],
    flows: ['Automatisations', 'Talos : « quand ceci arrive, fais cela », entre plusieurs applis.',
      ['« Nouvelle automatisation » : un déclencheur (heure, alerte, formulaire, webhook), puis des étapes.', 'Le journal montre chaque exécution et son résultat.'],
      ['Une action grave ne part jamais d\'une automatisation : elle attend ton accord.', 'Désactive une automatisation avec son interrupteur, sans la supprimer.']],
    runes: ['Papyrus', 'Tes pages et tes bases : tableaux, calendriers, fiches clients.',
      ['« Nouvelle base » : choisis les colonnes ; ajoute des lignes à la main ou par import CSV.', 'Changer de vue : tableau, calendrier, fiches.'],
      ['Les réservations et les nouveautés des applis s\'y rangent toutes seules quand l\'appli est reliée.', 'Exporter en CSV : bouton de la base.']],
    missions: ['Activité', 'Ce que je suis en train de faire et ce que j\'ai fait : missions longues, étapes, résultats.',
      ['Touche une mission pour voir ses étapes ; « Arrêter » l\'interrompt.'], ['Une mission se lance depuis la Discussion (« occupe-toi de… »).']],
    skills: ['Compétences', 'Mes savoir-faire : des recettes que je suis pas à pas.',
      ['Touche une compétence pour la lire ; les brouillons attendent ta validation.'], ['Tu peux modifier une recette ; l\'ancienne version reste récupérable.']],
    jobs: ['Tâches planifiées', 'Ce que je fais à heure fixe : rappels, rapports, vérifications.',
      ['Dis « chaque jour à 18 h… » dans la Discussion (ou dans ma bulle) pour en créer une.', 'Mets en pause ou supprime une tâche ici.'], ['L\'heure suit le fuseau de la machine d\'Odin.']],
    audit: ['Décisions', 'Le journal de mes décisions : ce que j\'ai fait, refusé ou demandé, et pourquoi.',
      ['Filtre par jour ou par outil ; touche une ligne pour le détail.'], ['Rien n\'y est effacé : c\'est ta trace de contrôle.']],
    profil: ['Profil', 'Les personnes qui me parlent : la carte de chacune et son historique — qui a demandé quoi, quand, et ce que ça a donné.',
      ['Touche une personne pour voir sa carte et sa ligne de temps ; ta note sur elle s\'écrit là.', 'Un membre de la famille ne voit que sa propre fiche, et peut te signaler une erreur.'],
      ['« Effacer l\'historique » retire les lignes d\'une personne ou d\'une période : la confirmation dit ce qui part et ce qui reste ailleurs.', 'Les droits se règlent encore dans Réglages → Personnes.']],
    settings: ['Réglages', 'Mon modèle d\'IA, ma voix, mon autonomie, tes accès et ton compte.',
      ['Les rubriques sont à gauche, dans l\'ordre conseillé : Modèle, Telegram, Voix, Autonomie, Droits, Réseau…', '« Thèmes », dans le menu, ouvre directement la rubrique Apparence.', 'Chaque rubrique a un bouton « Tester » : il vérifie que tout marche.', 'Personnes → « Inviter quelqu\'un de la famille » : un lien à usage unique (et son QR code), créé après ta validation ; la personne choisit son identifiant et son mot de passe, et son compte arrive dans Persona.'],
      ['Commence par le Modèle (sans lui je réponds quand même, sans IA).', 'Puis Telegram pour me parler de partout, et la Voix.', 'Réglages → Plus : visite guidée et arbre d\'évolution.']],
    device: ['Appareil', 'La fiche d\'un appareil de ta maison : son nom, sa pièce, ce qu\'il fait sur le réseau.',
      ['« Identifier à fond » : je cherche ce qu\'est cet appareil (marque, système, services).', '« Renommer » : donne-lui un nom clair ; l\'étoile : je te préviens quand il tombe et quand il revient.', 'En bas, ses paquets réseau : « En direct » pour les voir passer.', '« ← Réseau » : retour à la liste.'],
      ['Bloquer un appareil se fait sur la box : enregistre d\'abord son accès (Réglages → Réseau).']],
  };

  let box = null, anchor = null, seq = 0, downAt = null, cat = null, tree = null, thread = [], waiting = null;
  /** Texte d'Odin → paragraphes, listes et gras (jamais de HTML brut : tout passe par des nœuds de texte). */
  function rich(text) {
    const out = []; let ul = null;
    const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) => (/^\*\*[^*]+\*\*$/.test(p) ? el('b', {}, p.slice(2, -2)) : p));
    for (const line of String(text ?? '').split('\n')) {
      const li = /^\s*(?:[-•]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) { if (!ul) { ul = el('ul', {}); out.push(ul); } ul.append(el('li', {}, ...inline(li[1]))); continue; }
      ul = null;
      if (line.trim()) out.push(el('p', {}, ...inline(line)));
    }
    return out;
  }
  const view = () => document.querySelector('.view.on')?.id?.replace(/^v-/, '') || 'home';
  const appName = () => $('#vaTitle')?.textContent?.trim() || '';
  /** Où tu es, en clair : « Applis › Cerbère », « Réglages › Voix »… (pour l'infobulle et pour Odin). */
  function where() {
    const v = view();
    if (v === 'app') return `Applis › ${appName() || 'appli'}`;
    if (v === 'settings') { const s = document.querySelector('#v-settings .snav .on, #v-settings [aria-current="page"]')?.textContent?.trim(); return s ? `Réglages › ${s}` : 'Réglages'; }
    if (v === 'device') return `Maison › ${$('#devTitle')?.textContent?.trim() || 'appareil'}`;
    return (VIEWS[v] || ['Odin'])[0];
  }
  /** La mascotte visible : celle qui se promène, ou celle de la discussion. */
  const mascot = () => { const r = $('#buddyRoam'); return r && !r.hidden ? r : $('#buddyChat') || r; };

  // ---------- Catalogue des applis et mode d'emploi généré (le même pour la bulle et la visite guidée) ----------
  async function catalog() {
    if (cat) return cat;
    try { const r = await get('/api/valhalla/catalog'); if (r.ok) cat = r; } catch { /* applis pas encore prêtes */ }
    return cat;
  }
  const CONF = /régl|config|ajout|branch|reli|activ|clé|jeton|connect|seuil|niveau|planifi|surveill|param|compte|autoris|liste blanche|règle/i;
  /** Mode d'emploi d'une appli : où la trouver, comment s'en servir, comment la régler. */
  function manual(m) {
    if (!m) return null;
    const acts = m.actions || [];
    const quick = acts.filter((a) => a.quick !== false && !(a.params || []).some((p) => p.required));
    const forms = acts.filter((a) => !quick.includes(a));
    const conf = acts.filter((a) => !a.read && (CONF.test(`${a.id} ${a.label} ${a.what}`) || (a.params || []).some((p) => CONF.test(`${p.key} ${p.label}`))));
    const use = [`Ouvre-la : menu Applis → famille « ${m.family} » → ${m.name}.`];
    if (quick.length) use.push(`Boutons rapides en haut de sa page : ${quick.slice(0, 6).map((a) => `**${a.label}**`).join(', ')}.`);
    for (const a of forms.filter((x) => !conf.includes(x)).slice(0, 6)) use.push(`**${a.label}** (formulaire sur le côté de sa page) : ${a.what}${(a.params || []).length ? ` — à remplir : ${a.params.map((p) => p.label.split(' (')[0]).join(', ')}` : ''}${a.grave ? ' ⚠ te demande confirmation' : ''}.`);
    use.push(`Ou demande-le-moi simplement, par exemple : « ${(acts.find((a) => a.read) || acts[0] || { label: m.name }).label.toLowerCase()} dans ${m.name} ».`);
    const config = conf.slice(0, 8).map((a) => `**${a.label}** : ${a.what}${(a.params || []).length ? ` (${a.params.map((p) => p.label.split(' (')[0]).join(', ')})` : ''}.`);
    if (!config.length) config.push('Rien à régler : elle marche dès l\'installation.');
    if (acts.some((a) => (a.params || []).some((p) => /clé|jeton|mot de passe|token|secret/i.test(p.label)))) config.push('Les clés, jetons et mots de passe se rangent dans le coffre (Réglages → Coffre) : jamais dans une note ni dans la discussion.');
    config.push('Le niveau de ses alertes suit le réglage en haut de la page Applis.');
    return { what: m.what, does: m.does || [], use, config };
  }
  const moduleByName = async (name) => (await catalog())?.modules?.find((m) => m.name === name);

  const css = `
.guide{position:fixed;z-index:70;width:min(380px,calc(100vw - 24px));max-height:min(74vh,600px);display:flex;flex-direction:column;background:var(--panel);color:var(--text,inherit);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow,0 12px 40px rgba(0,0,0,.25));overflow:hidden}
.guide[hidden]{display:none}
.guide-h{display:flex;align-items:center;gap:8px;padding:12px 12px 4px 16px}.guide-h b{flex:1;font-size:16px;min-width:0;overflow-wrap:anywhere}
.guide-w{padding:0 16px 6px;font-size:12px;color:var(--muted)}
.guide-x,.guide-v{flex:none;width:36px;height:36px;border-radius:10px;border:1px solid var(--line);background:transparent;color:inherit;font-size:16px;line-height:1;cursor:pointer}
.guide-v[aria-pressed="false"]{opacity:.55}
.guide-t{padding:0 16px 10px;overflow:auto;line-height:1.55;font-size:14.5px;overflow-wrap:anywhere}.guide-t ul,.guide-t ol{margin:0 0 8px;padding-left:20px}.guide-t li{margin:0 0 3px}
.guide-t h3{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:10px 0 4px}.guide-t p{margin:0 0 8px}
.guide-t .me{margin:6px 0 6px 28px;padding:7px 10px;border-radius:12px 12px 4px 12px;background:var(--accent-soft,rgba(127,127,127,.14))}
.guide-t .him{margin:6px 28px 6px 0}.guide-t .him.live{opacity:.85}
.guide-t .dt{font-size:12px;color:var(--muted)}
.guide-b{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px}.guide-b .btn{min-height:36px}
.guide-f{display:flex;gap:6px;padding:10px 12px 12px;border-top:1px solid var(--line)}.guide-f input{flex:1;min-width:0;min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--field,var(--line));background:var(--panel2,transparent);color:inherit}
.odin.roam.guide-on{cursor:pointer}
.odin.roam:focus-visible{outline:3px solid var(--accent);outline-offset:4px;border-radius:50%}
@media print{.guide{display:none!important}}`;

  // ---------- La bulle ----------
  const speaking = () => Boolean(window.OdinVoice?.on?.());
  function build() {
    const title = el('b', { id: 'guideTitle' }), here = el('div', { class: 'guide-w', id: 'guideWhere' }), text = el('div', { class: 'guide-t', id: 'guideText', role: 'log', 'aria-live': 'polite', tabindex: '0' }), acts = el('div', { class: 'guide-b' });
    const input = el('input', { id: 'guideAsk', type: 'text', autocomplete: 'off', enterkeyhint: 'send' });
    const form = el('form', { class: 'guide-f', onsubmit: (e) => { e.preventDefault(); const q = input.value.trim(); if (q) { input.value = ''; ask(q); } } }, input, el('button', { class: 'btn small primary', type: 'submit' }, 'Envoyer'));
    const voice = el('button', { class: 'guide-v', type: 'button', id: 'guideVoice', onclick: async () => { await window.OdinVoice?.set?.(!speaking()); paintVoice(); } }, '🔊');
    box = el('section', { class: 'guide', id: 'guideBox', role: 'dialog', 'aria-labelledby': 'guideTitle', hidden: true },
      el('div', { class: 'guide-h' }, title, voice, el('button', { class: 'guide-x', type: 'button', 'aria-label': 'Fermer', onclick: () => close(true) }, '×')), here, text, acts, form);
    document.body.append(box);
    paintVoice(); paintTip();
    return { title, text, acts };
  }
  function paintVoice() {
    const b = $('#guideVoice'); if (!b) return;
    const on = speaking();
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Odin répond à voix haute : couper' : 'Odin ne parle pas : le faire répondre à voix haute');
    b.title = on ? 'Réponses à voix haute (Réglages → Voix)' : 'Réponses écrites seulement (Réglages → Voix)';
  }
  const parts = () => ({ title: $('#guideTitle'), text: $('#guideText'), acts: $('.guide-b', box) });

  /** La bulle se range à côté de la mascotte, toujours entière dans l'écran. */
  function place() {
    if (!box || box.hidden) return;
    const m = anchor?.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight, pad = 12, vw = innerWidth, vh = innerHeight;
    let x = vw - w - pad, y = vh - h - pad - 70;
    if (m && m.width) {
      x = m.left - w - 10 >= pad ? m.left - w - 10 : m.right + 10 + w <= vw - pad ? m.right + 10 : Math.max(pad, Math.min(vw - w - pad, m.left + m.width / 2 - w / 2));
      y = Math.max(pad, Math.min(vh - h - pad, m.top + m.height / 2 - h / 2));
      if (!(m.left - w - 10 >= pad) && !(m.right + 10 + w <= vw - pad)) y = m.top - h - 10 >= pad ? m.top - h - 10 : Math.min(vh - h - pad, m.bottom + 10);
    }
    box.style.left = `${Math.round(Math.max(pad, x))}px`; box.style.top = `${Math.round(Math.max(pad, y))}px`;
  }

  function show(title, body, buttons = []) {
    const p = box ? parts() : build();
    p.title.textContent = title;
    $('#guideWhere').textContent = `Tu es sur : ${where()}`;
    p.text.replaceChildren(...(Array.isArray(body) ? body : rich(body)));
    p.acts.replaceChildren(...buttons.map((b) => el('button', { class: `btn small${b.primary ? ' primary' : ''}`, type: 'button', onclick: b.run }, b.label)));
    p.acts.hidden = !buttons.length;
    box.hidden = false; p.text.scrollTop = 0;
    anchor?.setAttribute('aria-expanded', 'true');
    if (box.dataset.pinned !== '1') { window.OdinCompanion?.pin?.(0); window.OdinCompanion?.sync?.('hopto'); box.dataset.pinned = '1'; }
    window.OdinCompanion?.pin?.(600_000);
    window.OdinFace?.flash?.(anchor, 'joie', 1400);
    paintVoice(); place();
  }
  function close(focusBack) {
    if (!box || box.hidden) return;
    seq++; box.hidden = true; box.dataset.pinned = ''; anchor?.setAttribute('aria-expanded', 'false'); window.OdinCompanion?.pin?.(0);
    if (focusBack) anchor?.focus?.({ preventScroll: true });
  }

  const common = () => [{ label: 'Quoi de neuf', run: news }, { label: 'Arbre d\'évolution', run: () => { close(); window.OdinEvolution?.open(); } }, { label: 'Visite guidée', run: () => { close(); window.OdinTour?.start(true); } }];
  const section = (h, list) => [el('h3', {}, h), el('ul', {}, ...list.map((x) => el('li', {}, ...rich(x).flatMap((n) => [...n.childNodes]))))];
  /** Une liste numérotée : les étapes, dans l'ordre. */
  const steps = (h, list) => [el('h3', {}, h), el('ol', {}, ...list.map((x) => el('li', {}, ...rich(x).flatMap((n) => [...n.childNodes]))))];

  /** Explique la page affichée, ou l'appli ouverte : ce qu'elle fait, puis comment s'en servir, pas à pas. */
  async function explain() {
    const v = view(), my = ++seq;
    if (v === 'app') {
      const name = appName();
      show(name || 'Appli', 'Je regarde…');
      const m = await moduleByName(name); if (my !== seq) return;
      const g = manual(m);
      if (!g) { show(name || 'Appli', 'Je n\'ai pas encore la fiche de cette appli.', common()); return; }
      show(name, [el('p', {}, g.what), ...(g.does.length ? section('Ce qu\'elle fait', g.does.slice(0, 6)) : []), ...steps('Comment l\'utiliser, pas à pas', g.use)], [
        { label: 'Comment la configurer', primary: true, run: () => show(`${name} : la configurer`, steps('Pas à pas', g.config), back()) },
        { label: 'Guide-moi pas à pas', run: () => ask(`Guide-moi pas à pas pour utiliser et configurer ${name}, en partant de ce que j'ai déjà réglé.`) },
        ...common(),
      ]);
      return;
    }
    const [title, text, use, config] = VIEWS[v] ?? ['Odin', 'Je suis Odin. Touche-moi sur n\'importe quelle page : je t\'explique ce qu\'elle fait, et tu peux me parler ici.', [], []];
    show(title, [...rich(text), ...(use?.length ? steps('Comment l\'utiliser, pas à pas', use) : [])], [
      ...(config?.length ? [{ label: 'Comment la régler', primary: true, run: () => show(`${title} : la régler`, steps('Pas à pas', config), back()) }] : []),
      ...common(),
    ]);
  }
  const plain = (s) => String(s).replace(/\*\*/g, '');
  // ---------- Ce qu'Odin dit maintenant (le moteur est dans Odin : src/valhalla/parole.ts) ----------
  // Le même pour tous les écrans : il part de la page ouverte, des alertes, du Cerveau et de la mémoire, et ne
  // répète jamais ce qu'il a déjà dit ou proposé. Ici, l'interface lui dit seulement où tu es et le mode d'emploi
  // de la page (VIEWS) ; il en donne une étape à la fois.
  let lastSaid = null;
  /** `quand` : « toucher » (on touche Odin), « spontane » (il parle tout seul), « clic » (un clic rapide). */
  async function parole(quand = 'toucher', extra = {}) {
    const v = view(), m = v === 'app' ? await moduleByName(appName()) : null;
    const page = m ? `app:${m.id}` : `${v}:${where()}`;
    // La même fenêtre redessinée tout de suite (nouvelle notification, « Tout lu ») : il ne parle pas une deuxième fois.
    if (quand === 'toucher' && lastSaid && lastSaid.page === page && Date.now() - lastSaid.at < 20_000) return lastSaid.r;
    const V = VIEWS[v];
    let r = null;
    try { r = await post('/api/valhalla/parole', { quand, vue: v, appli: m?.id || '', titre: m ? m.name : where(), pas: V ? [V[1], ...(V[2] || [])].map(plain) : [], reglage: (V?.[3] || []).map(plain), ...extra }); } catch { r = null; }
    if (!r?.ok) return null;
    if (quand === 'toucher') lastSaid = { page, at: Date.now(), r };
    return r;
  }
  /** Lance une proposition d'Odin (un bouton). Une action qui change quelque chose demande ton accord avant. */
  async function lancer(p) {
    if (!p) return;
    if (p.guide === 'expliquer') { anchor = mascot(); explain(); return; }
    if (p.guide === 'regler') { anchor = mascot(); regler(); return; }
    if (p.demander) { anchor = mascot(); ask(p.demander); return; }
    if (p.ouvrir) {
      const [k, id] = String(p.ouvrir).split(':');
      if (k === 'app') { window.OdinShow?.('apps'); setTimeout(() => window.OdinApps?.app?.(id), 150); } else if (k === 'vue') window.OdinShow?.(id);
      return;
    }
    if (!p.act) return;
    // Toujours la fenêtre au thème d'Odin ; si elle manque, rien n'est lancé sans accord.
    const ok = (t) => (window.OdinDialog?.confirm ? window.OdinDialog.confirm(t) : Promise.resolve(false));
    if (!p.act.read && !(await ok(`${p.label} ?`))) return;
    anchor = mascot(); show(p.label, 'Je m\'en occupe…');
    try {
      const body = { module: p.act.module, action: p.act.action, input: p.act.input || {} };
      let r = await post('/api/valhalla/act', body);
      if (r.confirm) { if (!(await ok(r.confirm))) { show(p.label, 'Annulé : rien n\'a été fait.'); return; } r = await post('/api/valhalla/act', { ...body, confirm: true }); }
      show(p.label, r.ok === false ? `✗ ${r.text || r.error || 'échec'}` : String(r.text || 'Fait.'));
    } catch (e) { show(p.label, (window.OdinReseau && !window.OdinReseau.enLigne()) ? '✗ Pas d\'Internet pour l\'instant : Odin continue en local, réessaie au retour.' : (/fetch|network|load failed|NetworkError|Failed/i.test(String(e.message)) ? '✗ Odin est injoignable pour l\'instant (connexion indisponible).' : `✗ ${e.message}`)); }
  }
  /** Comment régler la page affichée, pas à pas. */
  async function regler() {
    const v = view();
    if (v === 'app') { const name = appName(), g = manual(await moduleByName(name)); show(`${name} : la régler`, g ? steps('Pas à pas', g.config) : 'Rien à régler ici.', back()); return; }
    const V = VIEWS[v]; show(`${V?.[0] || where()} : la régler`, V?.[3]?.length ? steps('Pas à pas', V[3]) : 'Rien à régler ici.', back());
  }
  /** Ce qu'Odin dit quand on le touche (pour la petite fenêtre « Que veux-tu ? ») : vide s'il n'a rien de neuf. */
  async function brief() { return (await parole('toucher'))?.texte || ''; }
  const back = () => [{ label: '← Cette page', run: explain }];

  // ---------- Quoi de neuf (lu dans l'arbre d'évolution) ----------
  async function evo() { if (!tree) { try { const r = await get('/api/evolutions'); if (r.ok) tree = r; } catch { /* hors ligne */ } } return tree; }
  const fmtDate = (d) => { try { return new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return d; } };
  /** Les nouveautés : par défaut la dernière version (ou tout ce qui est arrivé depuis « since »). */
  async function news(since) {
    const my = ++seq;
    show('Quoi de neuf', 'Je regarde les dernières mises à jour…');
    const t = await evo(); if (my !== seq) return;
    if (!t || !t.evolutions.length) { show('Quoi de neuf', 'Je n\'ai pas trouvé l\'historique des mises à jour.', back()); return; }
    const list = t.evolutions;
    // Tout ce qui est arrivé depuis ta dernière visite, sinon les changements de la dernière version publiée
    let shown = since ? list.filter((e) => e.at > since) : [];
    if (!shown.length) { const i = list.findIndex((e) => e.version); const j = list.findIndex((e, k) => k > i && e.version); shown = list.slice(0, j > 0 ? j : Math.min(8, list.length)); }
    shown = shown.slice(0, 12);
    const items = shown.map((e) => el('div', {},
      el('p', {}, el('b', {}, `${e.version ? `v${e.version} — ` : ''}${e.title}`), el('br'), el('span', { class: 'dt' }, `${fmtDate(e.date)} · ${e.kind}`)),
      e.details.length ? el('ul', {}, ...e.details.slice(0, 5).map((d) => el('li', {}, d))) : null));
    show(`Quoi de neuf (Odin ${t.sun.version})`, items, [
      { label: 'Explique-moi ces nouveautés', primary: true, run: () => ask(`Explique-moi simplement les nouveautés qui viennent d'arriver et comment m'en servir : ${shown.map((e) => e.title).join(' ; ')}`) },
      { label: 'Arbre d\'évolution', run: () => { close(); window.OdinEvolution?.open(); } }, ...back(),
    ]);
  }
  /** Après une mise à jour, une seule fois : Odin présente ce qui vient d'arriver. */
  async function announce() {
    const t = await evo(); if (!t?.sun?.version) return;
    let seen = ''; try { seen = localStorage.getItem('odin.seenVersion') || ''; } catch { return; }
    if (seen === t.sun.version) return;
    let since = ''; try { since = localStorage.getItem('odin.seenAt') || ''; localStorage.setItem('odin.seenVersion', t.sun.version); localStorage.setItem('odin.seenAt', t.evolutions[0]?.at || ''); } catch { /* */ }
    if (!seen) return; // première installation : rien à annoncer
    anchor = mascot(); if (!anchor) return;
    news(since || undefined);
  }

  // ---------- Parler à Odin, de partout (la même conversation que la Discussion) ----------
  function paintThread(live) {
    const p = parts();
    const nodes = thread.slice(-6).flatMap((x) => (x.me ? [el('p', { class: 'me' }, x.text)] : [el('div', { class: 'him' }, ...rich(x.text))]));
    if (live != null) nodes.push(el('div', { class: 'him live' }, ...rich(live || 'Je réfléchis…')));
    p.text.replaceChildren(...nodes); p.text.scrollTop = p.text.scrollHeight;
  }
  async function ask(q) {
    const my = ++seq;
    const chat = window.OdinChat;
    thread.push({ me: true, text: q });
    show('Odin', [], [{ label: 'Ouvrir la Discussion', run: () => { close(); window.OdinShow?.('chat'); } }, ...back()]);
    paintThread('');
    if (!chat) {
      // Pas de discussion possible (page de connexion…) : les demandes simples aux applis, comprises sans IA.
      try { const r = await post('/api/valhalla/order', { text: q, session: 'guide' }); if (my !== seq) return; thread.push({ text: r.text || r.error || 'Fait.' }); paintThread(); } catch { thread.push({ text: 'Je n\'arrive pas à te répondre pour l\'instant.' }); paintThread(); }
      return;
    }
    waiting = { my, live: '' };
    const ok = await chat.send(q, where());
    if (!ok) { waiting = null; thread.push({ text: 'Envoi impossible : je ne réponds pas pour l\'instant.' }); paintThread(); }
  }
  addEventListener('odin:delta', (e) => { if (!waiting || !box || box.hidden) return; waiting.live += e.detail?.text || ''; paintThread(waiting.live); });
  addEventListener('odin:reply', (e) => {
    const text = String(e.detail?.text || '').replace(/\[humeur:[^\]]*\]/g, '').trim();
    if (!waiting) return;
    waiting = null; thread.push({ text });
    if (box && !box.hidden) paintThread(); else { anchor = mascot(); show('Odin', []); paintThread(); }
  });
  addEventListener('odin:approval', (e) => {
    if (!box || box.hidden) return;
    const d = e.detail || {};
    thread.push({ text: `J'ai besoin de ton accord : ${d.summary || 'une action à valider'}.` }); paintThread();
    parts().acts.replaceChildren(el('button', { class: 'btn small primary', type: 'button', onclick: () => { close(); window.OdinShow?.('chat'); } }, 'Voir et valider'), ...back().map((b) => el('button', { class: 'btn small', type: 'button', onclick: b.run }, b.label)));
    parts().acts.hidden = false; place();
  });

  // ---------- Infobulle et champ de saisie : selon la page ou l'appli ----------
  function paintTip() {
    const w = where();
    const m = $('#buddyRoam');
    // Au survol, l'infobulle vient de companion.js (plus de « title » : elle ferait doublon).
    if (m) { m.setAttribute('aria-label', `Odin — ${w} : touche-moi pour de l'aide, ou parle-moi`); m.removeAttribute('title'); }
    const i = $('#guideAsk');
    if (i) { const name = view() === 'app' ? appName() : w; i.placeholder = `Parle-moi${name ? ` de ${name}` : ''}…`; i.setAttribute('aria-label', `Parler à Odin (page ${w})`); }
  }

  function toggle(m) { anchor = m; if (box && !box.hidden) close(true); else explain(); }
  function arm(m) {
    if (!m || m.dataset.guide) return;
    m.dataset.guide = '1'; m.classList.add('guide-on');
    m.removeAttribute('aria-hidden'); m.setAttribute('role', 'button'); m.setAttribute('tabindex', '0'); m.setAttribute('aria-haspopup', 'dialog');
    paintTip();
    // Un clic sur Odin n'ouvre plus cette bulle d'aide (13/11) : il ouvre seulement « Que veux-tu ? » (notices.js).
    // L'aide reste accessible par OdinGuide.ask / news (boutons « Explique-moi », « Quoi de neuf »).
    m.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.OdinNotices?.talk?.(); } });
  }
  function start() {
    document.head.append(el('style', {}, css));
    const armAll = () => { arm($('#buddyRoam')); };
    armAll(); new MutationObserver(armAll).observe(document.body, { childList: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box && !box.hidden) { e.stopPropagation(); close(true); } }, true);
    document.addEventListener('pointerdown', (e) => { if (box && !box.hidden && !(e.target instanceof Element && (e.target.closest('#guideBox') || e.target.closest('[data-guide]')))) close(); }, true);
    addEventListener('resize', place); document.addEventListener('scroll', place, { passive: true, capture: true });
    setInterval(() => { if (box && !box.hidden) place(); }, 700);
    // En changeant de page : l'infobulle suit ; une bulle ouverte sur une explication explique la nouvelle page
    // (une conversation en cours, elle, reste affichée).
    const views = new MutationObserver(() => { paintTip(); if (box && !box.hidden && !waiting && !thread.length) { const m = mascot(); if (m) anchor = m; setTimeout(explain, 350); } });
    for (const v of document.querySelectorAll('.view')) views.observe(v, { attributes: true, attributeFilter: ['class'] });
    const t = $('#vaTitle'); if (t) new MutationObserver(paintTip).observe(t, { childList: true, characterData: true, subtree: true });
    addEventListener('odin:voice', paintVoice);
    setTimeout(announce, 4000);
  }
  window.OdinGuide = { open: () => { anchor = mascot(); explain(); }, close: () => close(), ask: (q) => { anchor = mascot(); ask(q); }, news: () => { anchor = mascot(); news(); }, views: VIEWS, manual, catalog, where, brief, parole, lancer };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 600)); else setTimeout(start, 600);
})();
