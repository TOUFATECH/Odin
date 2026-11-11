// Odin, ton guide, sur toutes les pages. Un clic (ou Entrée) sur la mascotte ouvre sa bulle :
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
    home: ['Aujourd\'hui', 'Ta journée d\'un coup d\'œil : ce qui demande ton attention, ce que j\'ai fait, l\'état de tes machines. Touche une carte pour aller au détail.',
      ['Lis « À faire maintenant » de haut en bas : chaque carte a son bouton d\'action.', '« Ce que j\'ai fait » : touche une ligne pour le détail, ou « Annuler » si tu n\'es pas d\'accord.', 'Les tuiles (réseau, machines, tâches) mènent à leur page.'],
      ['Ce qui s\'affiche ici vient des autres pages : étoile un appareil dans Maison pour qu\'il apparaisse, crée une tâche planifiée pour tes rappels.', 'Le thème (clair, sombre, automatique) : bouton en haut.']],
    chat: ['Discussion', 'Ici tu me parles, par écrit ou à la voix. Dis ce que tu veux obtenir : un résumé, un fichier, une action.',
      ['Écris ta demande et appuie sur Entrée ; joins des fichiers avec le trombone ; le micro dicte.', 'Une action importante t\'est présentée avant : Oui ou Non.', 'Les conversations passées sont à gauche (renommer, épingler, supprimer).', 'Tu peux aussi me parler depuis n\'importe quelle page : touche-moi, c\'est la même conversation.'],
      ['Mon modèle d\'IA : Réglages → Modèle.', 'Ma voix et la lecture à voix haute : Réglages → Voix.', 'Mon autonomie (Prudent, Équilibré, Autonome) : Réglages → Autonomie.']],
    brain: ['Cerveau', 'Ton deuxième cerveau : tes notes, reliées entre elles, avec leur graphe. J\'y range ce que tu me confies.',
      ['« Nouvelle note » ou capture rapide ; [[un nom]] relie deux notes.', 'Le graphe montre les liens ; touche un point pour ouvrir la note.', '« Demander au cerveau » : je réponds à partir de tes notes, avec les sources.'],
      ['Les connecteurs (Telegram, mail, agenda, Notion…) remplissent le Cerveau quand ils sont configurés : chacun dit s\'il est actif ou ce qu\'il manque.', 'Les réglages du graphe (couleurs, étiquettes, forces) sont dans le panneau du graphe.']],
    net: ['Maison', 'Ta maison et ton réseau : les appareils, les pièces, les scènes.',
      ['La liste montre chaque appareil ; touche-le pour sa fiche (nom, pièce, bloquer sur la box).', 'Touche une machine : sous sa fiche, ses paquets réseau (Rán, comme Wireshark) — « En direct » pour les voir passer, l\'historique en dessous, « Enregistrer en continu » pour tout garder.', 'Carte : un graphe où chaque appareil est relié à sa famille et à la box, comme le Cerveau. Pastille rouge : un risque repéré ou un appareil surveillé tombé ; point gris : hors ligne. Touche un point pour sa fiche.', 'L\'étoile : je te préviens quand l\'appareil tombe, puis quand il revient.', 'La carte place les appareils ; la sécurité liste ce qui est exposé.'],
      ['Le réseau à surveiller et la box : Réglages → Réseau.', 'Home Assistant, Hue, WLED : Réglages → Maison connectée.', 'Proxmox : Réglages → Machines.']],
    apps: ['Applis', 'Toutes mes applis, rangées par famille. En haut : ce que j\'ai fait de moi-même (à garder ou à annuler) et l\'état de la protection.',
      ['Le graphe relie chaque appli à sa famille et aux applis avec lesquelles elle travaille ; pastille rouge ou orange = alertes, bleue = nouveautés de son projet d\'origine.', 'Touche un point pour ouvrir l\'appli : ses chiffres, ses boutons rapides, ses autres actions.', '« J\'ai besoin de… » : décris ton besoin, je choisis l\'appli.', 'Touche-moi sur une appli : je t\'explique comment l\'utiliser et la régler.'],
      ['Le niveau des alertes se règle en haut de cette page.', 'Les clés et mots de passe des applis se rangent dans le coffre (Réglages → Coffre), jamais dans une note.']],
    flows: ['Automatisations', 'Draupnir : « quand ceci arrive, fais cela », entre plusieurs applis.',
      ['« Nouvelle automatisation » : un déclencheur (heure, alerte, formulaire, webhook), puis des étapes.', 'Le journal montre chaque exécution et son résultat.'],
      ['Une action grave ne part jamais d\'une automatisation : elle attend ton accord.', 'Désactive une automatisation avec son interrupteur, sans la supprimer.']],
    runes: ['Runes', 'Tes pages et tes bases : tableaux, calendriers, fiches clients.',
      ['« Nouvelle base » : choisis les colonnes ; ajoute des lignes à la main ou par import CSV.', 'Changer de vue : tableau, calendrier, fiches.'],
      ['Les réservations et les nouveautés des applis s\'y rangent toutes seules quand l\'appli est reliée.', 'Exporter en CSV : bouton de la base.']],
    missions: ['Activité', 'Ce que je suis en train de faire et ce que j\'ai fait : missions longues, étapes, résultats.',
      ['Touche une mission pour voir ses étapes ; « Arrêter » l\'interrompt.'], ['Une mission se lance depuis la Discussion (« occupe-toi de… »).']],
    memory: ['Mémoire', 'Ce que je retiens de toi : tes préférences, tes habitudes, ce que tu m\'as corrigé.',
      ['Relis, corrige ou efface chaque souvenir.', 'Dis « retiens que… » dans la Discussion pour en ajouter un.'], ['Rien ne sort de ta machine : la mémoire est stockée chez toi.']],
    skills: ['Compétences', 'Mes savoir-faire : des recettes que je suis pas à pas.',
      ['Touche une compétence pour la lire ; les brouillons attendent ta validation.'], ['Tu peux modifier une recette ; l\'ancienne version reste récupérable.']],
    jobs: ['Tâches planifiées', 'Ce que je fais à heure fixe : rappels, rapports, vérifications.',
      ['Dis « chaque jour à 18 h… » dans la Discussion (ou dans ma bulle) pour en créer une.', 'Mets en pause ou supprime une tâche ici.'], ['L\'heure suit le fuseau de la machine d\'Odin.']],
    audit: ['Décisions', 'Le journal de mes décisions : ce que j\'ai fait, refusé ou demandé, et pourquoi.',
      ['Filtre par jour ou par outil ; touche une ligne pour le détail.'], ['Rien n\'y est effacé : c\'est ta trace de contrôle.']],
    settings: ['Réglages', 'Mon modèle d\'IA, ma voix, mon autonomie, tes accès et ton compte.',
      ['Les rubriques sont à gauche, dans l\'ordre conseillé : Modèle, Telegram, Voix, Autonomie, Droits, Réseau…', 'Chaque rubrique a un bouton « Tester » : il vérifie que tout marche.'],
      ['Commence par le Modèle (sans lui je réponds quand même, sans IA).', 'Puis Telegram pour me parler de partout, et la Voix.', 'Réglages → Plus : visite guidée et arbre d\'évolution.']],
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
  /** Où tu es, en clair : « Applis › Garmr », « Réglages › Voix »… (pour l'infobulle et pour Odin). */
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
.guide-t{padding:0 16px 10px;overflow:auto;line-height:1.55;font-size:14.5px;overflow-wrap:anywhere}.guide-t ul{margin:0 0 8px;padding-left:20px}.guide-t li{margin:0 0 3px}
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

  /** Explique la page affichée, ou l'appli ouverte. */
  async function explain() {
    const v = view(), my = ++seq;
    if (v === 'app') {
      const name = appName();
      show(name || 'Appli', 'Je regarde…');
      const m = await moduleByName(name); if (my !== seq) return;
      const g = manual(m);
      if (!g) { show(name || 'Appli', 'Je n\'ai pas encore la fiche de cette appli.', common()); return; }
      show(name, [el('p', {}, g.what), ...(g.does.length ? section('Ce qu\'elle fait', g.does.slice(0, 6)) : [])], [
        { label: 'Comment l\'utiliser', primary: true, run: () => show(`${name} : l'utiliser`, section('De A à Z', g.use), [{ label: 'La configurer', primary: true, run: () => show(`${name} : la configurer`, section('De A à Z', g.config), back()) }, ...back()]) },
        { label: 'Comment la configurer', run: () => show(`${name} : la configurer`, section('De A à Z', g.config), back()) },
        { label: 'Guide-moi pas à pas', run: () => ask(`Guide-moi pas à pas pour utiliser et configurer ${name}, en partant de ce que j'ai déjà réglé.`) },
        ...common(),
      ]);
      return;
    }
    const [title, text, use, config] = VIEWS[v] ?? ['Odin', 'Je suis Odin. Touche-moi sur n\'importe quelle page : je t\'explique ce qu\'elle fait, et tu peux me parler ici.', [], []];
    show(title, text, [
      ...(use?.length ? [{ label: 'Comment l\'utiliser', primary: true, run: () => show(`${title} : l'utiliser`, section('De A à Z', use), back()) }] : []),
      ...(config?.length ? [{ label: 'Comment la régler', run: () => show(`${title} : la régler`, section('De A à Z', config), back()) }] : []),
      ...common(),
    ]);
  }
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
    if (m) { const t = `Odin — ${w} : touche-moi pour de l'aide, ou parle-moi`; m.setAttribute('aria-label', t); m.title = t; }
    const i = $('#guideAsk');
    if (i) { const name = view() === 'app' ? appName() : w; i.placeholder = `Parle-moi${name ? ` de ${name}` : ''}…`; i.setAttribute('aria-label', `Parler à Odin (page ${w})`); }
  }

  function toggle(m) { anchor = m; if (box && !box.hidden) close(true); else explain(); }
  function arm(m) {
    if (!m || m.dataset.guide) return;
    m.dataset.guide = '1'; m.classList.add('guide-on');
    m.removeAttribute('aria-hidden'); m.setAttribute('role', 'button'); m.setAttribute('tabindex', '0'); m.setAttribute('aria-haspopup', 'dialog'); m.setAttribute('aria-expanded', 'false');
    paintTip();
    m.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
    m.addEventListener('click', (e) => { if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return; e.stopPropagation(); toggle(m); });
    m.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(m); } });
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
  window.OdinGuide = { open: () => { anchor = mascot(); explain(); }, close: () => close(), ask: (q) => { anchor = mascot(); ask(q); }, news: () => { anchor = mascot(); news(); }, views: VIEWS, manual, catalog };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 600)); else setTimeout(start, 600);
})();
