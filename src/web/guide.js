// Odin, ton guide. Un clic (ou Entrée) sur la mascotte ouvre une bulle qui explique la page où tu es :
// la vue, ou l'appli ouverte (à quoi elle sert, ce qu'elle fait, ses liens avec les autres, comment lui
// parler). Tu peux aussi lui demander quelque chose : la demande est comprise sans IA (Huginn), et une
// action grave attend ta confirmation. « Quoi de neuf » liste les dernières améliorations.
// La bulle ne s'ouvre jamais toute seule et ne cache rien de façon durable : Échap, un clic ailleurs ou
// son bouton la ferment.
(() => {
  'use strict';
  if (window.OdinGuide) return;
  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, a = {}, ...kids) => { const n = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (v === undefined || v === null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); } for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k))); return n; };
  const post = async (path, body) => { const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) }); return r.json(); };

  // Ce que fait chaque page, en deux phrases.
  const VIEWS = {
    home: ['Aujourd\'hui', 'Ta journée d\'un coup d\'œil : ce qui demande ton attention, ce que j\'ai fait, l\'état de tes machines. Touche une carte pour aller au détail.'],
    chat: ['Discussion', 'Ici tu me parles, par écrit ou à la voix. Dis ce que tu veux obtenir : un résumé, un fichier, une action. Sans IA connectée, je comprends quand même les demandes qui visent mes applis (« analyse mes téléchargements », « bannis 203.0.113.9 », « les alertes »).'],
    brain: ['Cerveau', 'Ton deuxième cerveau : tes notes, reliées entre elles, avec leur graphe. J\'y range ce que tu me confies. Le dossier « Odin » contient une fiche par appli, leurs liens et mon mode de fonctionnement ; ce que tu écris sous « Mes notes » y reste.'],
    net: ['Maison', 'Ta maison et ton réseau : les appareils, les pièces, les scènes. Marque d\'une étoile ce qui compte : je te préviens quand un appareil tombe, puis quand il revient.'],
    apps: ['Applis', 'Toutes mes applis, rangées par famille. En haut : ce que j\'ai fait de moi-même (à garder ou à annuler) et l\'état de la protection. Écris ton besoin dans « J\'ai besoin de… » : je choisis l\'appli et je t\'explique pourquoi.'],
    flows: ['Automatisations', 'Draupnir : « quand ceci arrive, fais cela », entre plusieurs applis. Un déclencheur, des étapes, et c\'est tout. Une action grave ne part jamais d\'une automatisation.'],
    runes: ['Runes', 'Tes pages et tes bases : tableaux, calendriers, fiches clients. Les réservations et les nouveautés des applis s\'y rangent toutes seules.'],
    missions: ['Activité', 'Ce que je suis en train de faire et ce que j\'ai fait : missions longues, étapes, résultats.'],
    memory: ['Mémoire', 'Ce que je retiens de toi : tes préférences, tes habitudes, ce que tu m\'as corrigé. Tu peux tout relire et tout effacer.'],
    skills: ['Compétences', 'Mes savoir-faire : des recettes que je suis pas à pas. J\'en apprends de nouvelles quand une tâche revient.'],
    jobs: ['Tâches planifiées', 'Ce que je fais à heure fixe : rappels, rapports, vérifications. Dis « chaque jour à 18 h… » dans la discussion pour en créer une.'],
    audit: ['Décisions', 'Le journal de mes décisions : ce que j\'ai fait, refusé ou demandé, et pourquoi. Rien n\'y est effacé.'],
    settings: ['Réglages', 'Mon modèle d\'IA, ma voix, mon autonomie, tes accès et ton compte. La rubrique « Accès » montre les appareils connectés et permet de les déconnecter.'],
  };
  // Les dernières améliorations (les plus récentes en premier).
  const NEWS = [
    ['Sans IA d\'abord', 'Ce que je sais faire seul, je ne le confie plus à une IA : c\'est plus rapide et ça ne coûte rien. Sous chaque réponse, je dis si une IA a servi et pourquoi. Quand une IA règle une demande par une seule action, je l\'apprends et je la refais ensuite sans elle. Réglages → Modèle → Économies.'],
    ['Droits', 'Je suis administrateur de ma machine partout (Linux, conteneur, Mac, Windows). S\'il me manque des droits, je te dis la vraie cause et la commande à lancer une fois, au lieu de réclamer un mot de passe. Réglages → Droits et machines.'],
    ['Antivirus', 'Ullr, mon antivirus fait maison : fichiers, archives, liens et messages. Il se met à jour seul, met en quarantaine ce qui est sûr (annulable) et relie les signaux de toutes les applis en incidents.'],
    ['Sites web', 'Idunn surveille tes sites, les essaie, les relance et applique leurs mises à jour, sans IA. Tu me demandes les événements que tu veux : « les erreurs du site … depuis 2 jours ». Ce qui touche la production attend ton accord.'],
    ['Cerveau', 'Une fiche par appli dans le Cerveau, avec leurs liens. Il est prêt dès l\'installation et se remet à jour à chaque lancement. Aucun de tes réglages n\'y est écrit.'],
    ['Sans IA', 'Je comprends les demandes qui visent mes applis même sans IA connectée. Je ne devine pas : si je ne suis pas sûr, je ne fais rien.'],
    ['Manips', 'Quand j\'agis de moi-même, je te préviens : tu gardes ou tu annules. En mode Odin Breaker, je garde seul.'],
    ['Liens', 'Tous les liens entre applis sont automatiques, et chacun est vérifié par un test.'],
    ['Compte', 'Un compte protège l\'accès : prénom, nom, adresse et mot de passe à la première connexion, puis des sessions par appareil.'],
    ['Guide', 'Touche-moi sur n\'importe quelle page : je t\'explique ce qu\'elle fait.'],
  ];

  let box = null, anchor = null, seq = 0, downAt = null;
  /** Texte d'Odin → paragraphes, listes et gras (jamais de HTML brut : tout passe par des nœuds de texte). */
  function rich(text) {
    const out = []; let ul = null;
    const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) => (/^\*\*[^*]+\*\*$/.test(p) ? el('b', {}, p.slice(2, -2)) : p));
    for (const line of String(text ?? '').split('\n')) {
      const li = /^\s*[-•]\s+(.*)$/.exec(line);
      if (li) { if (!ul) { ul = el('ul', {}); out.push(ul); } ul.append(el('li', {}, ...inline(li[1]))); continue; }
      ul = null;
      if (line.trim()) out.push(el('p', {}, ...inline(line)));
    }
    return out;
  }
  const view = () => document.querySelector('.view.on')?.id?.replace(/^v-/, '') || 'home';
  /** La mascotte visible : celle qui se promène, ou celle de la discussion. */
  const mascot = () => { const r = $('#buddyRoam'); return r && !r.hidden ? r : $('#buddyChat') || r; };

  const css = `
.guide{position:fixed;z-index:70;width:min(360px,calc(100vw - 24px));max-height:min(70vh,560px);display:flex;flex-direction:column;background:var(--panel);color:var(--text,inherit);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow,0 12px 40px rgba(0,0,0,.25));overflow:hidden}
.guide[hidden]{display:none}
.guide-h{display:flex;align-items:center;gap:8px;padding:12px 12px 8px 16px}.guide-h b{flex:1;font-size:16px;min-width:0;overflow-wrap:anywhere}
.guide-x{flex:none;width:36px;height:36px;border-radius:10px;border:1px solid var(--line);background:transparent;color:inherit;font-size:18px;line-height:1;cursor:pointer}
.guide-t{padding:0 16px 10px;overflow:auto;line-height:1.55;font-size:14.5px;overflow-wrap:anywhere}.guide-t ul{margin:0 0 8px;padding-left:20px}.guide-t li{margin:0 0 3px}
.guide-t h3{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:10px 0 4px}.guide-t p{margin:0 0 8px}
.guide-b{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px}.guide-b .btn{min-height:36px}
.guide-f{display:flex;gap:6px;padding:10px 12px 12px;border-top:1px solid var(--line)}.guide-f input{flex:1;min-width:0;min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--field,var(--line));background:var(--panel2,transparent);color:inherit}
.odin.roam.guide-on{cursor:pointer}
.odin.roam:focus-visible{outline:3px solid var(--accent);outline-offset:4px;border-radius:50%}
@media print{.guide{display:none!important}}`;

  function build() {
    const title = el('b', { id: 'guideTitle' }), text = el('div', { class: 'guide-t', id: 'guideText', role: 'status', 'aria-live': 'polite', tabindex: '0' }), acts = el('div', { class: 'guide-b' });
    const input = el('input', { id: 'guideAsk', type: 'text', placeholder: 'Demande-moi… (« les alertes », « à quoi sert Garmr »)', autocomplete: 'off', 'aria-label': 'Demander quelque chose à Odin' });
    const form = el('form', { class: 'guide-f', onsubmit: (e) => { e.preventDefault(); const q = input.value.trim(); if (q) { input.value = ''; ask(q); } } }, input, el('button', { class: 'btn small primary', type: 'submit' }, 'Demander'));
    box = el('section', { class: 'guide', id: 'guideBox', role: 'dialog', 'aria-labelledby': 'guideTitle', hidden: true },
      el('div', { class: 'guide-h' }, title, el('button', { class: 'guide-x', type: 'button', 'aria-label': 'Fermer', onclick: () => close(true) }, '×')), text, acts, form);
    document.body.append(box);
    return { title, text, acts };
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
      // Ni à gauche ni à droite : au-dessus (ou au-dessous) de lui, sans le recouvrir.
      if (!(m.left - w - 10 >= pad) && !(m.right + 10 + w <= vw - pad)) y = m.top - h - 10 >= pad ? m.top - h - 10 : Math.min(vh - h - pad, m.bottom + 10);
    }
    box.style.left = `${Math.round(Math.max(pad, x))}px`; box.style.top = `${Math.round(Math.max(pad, y))}px`;
  }

  function show(title, body, buttons = []) {
    const p = box ? parts() : build();
    p.title.textContent = title;
    p.text.replaceChildren(...(Array.isArray(body) ? body : rich(body)));
    p.acts.replaceChildren(...buttons.map((b) => el('button', { class: `btn small${b.primary ? ' primary' : ''}`, type: 'button', onclick: b.run }, b.label)));
    p.acts.hidden = !buttons.length;
    box.hidden = false; p.text.scrollTop = 0;
    anchor?.setAttribute('aria-expanded', 'true');
    // Il se pose d'abord dans un coin libre (jamais sur un texte ou un bouton), puis reste en place tant qu'il parle.
    if (box.dataset.pinned !== '1') { window.OdinCompanion?.pin?.(0); window.OdinCompanion?.sync?.('hopto'); box.dataset.pinned = '1'; }
    window.OdinCompanion?.pin?.(600_000);
    window.OdinFace?.flash?.(anchor, 'joie', 1400);
    place();
  }
  function close(focusBack) {
    if (!box || box.hidden) return;
    seq++; box.hidden = true; box.dataset.pinned = ''; anchor?.setAttribute('aria-expanded', 'false'); window.OdinCompanion?.pin?.(0);
    if (focusBack) anchor?.focus?.({ preventScroll: true });
  }

  const common = () => [{ label: 'Quoi de neuf', run: news }, { label: 'Les applis', run: () => { window.OdinShow?.('apps'); setTimeout(explain, 500); } }, { label: 'Visite guidée', run: () => { close(); window.OdinTour?.start(true); } }];

  /** Explique la page affichée. Pour une appli : sa fiche (rôle, fonctions, liens, exemples), demandée à Odin. */
  async function explain() {
    const v = view(), my = ++seq;
    if (v === 'app') {
      const name = $('#vaTitle')?.textContent?.trim();
      show(name || 'Appli', 'Je regarde…', common());
      try {
        const r = await post('/api/valhalla/order', { text: `à quoi sert ${name}`, session: 'guide' });
        if (my !== seq) return;
        show(name, r.text || 'Je n\'ai pas d\'explication pour cette appli.', [{ label: 'Sa fiche dans le Cerveau', run: () => { close(); window.OdinShow?.('brain'); } }, ...common()]);
      } catch { if (my === seq) show(name || 'Appli', 'Je n\'arrive pas à joindre mes applis pour l\'instant.', common()); }
      return;
    }
    const [title, text] = VIEWS[v] ?? ['Odin', 'Je suis Odin. Touche-moi sur n\'importe quelle page : je t\'explique ce qu\'elle fait.'];
    show(title, text, common());
  }
  function news() {
    seq++;
    show('Quoi de neuf', NEWS.map(([t, x]) => el('p', {}, el('b', {}, `${t} — `), x)), [{ label: 'Cette page', primary: true, run: explain }, { label: 'Visite guidée', run: () => { close(); window.OdinTour?.start(true); } }]);
  }
  /** Une demande libre : comprise sans IA. Une action grave attend ta confirmation. */
  async function ask(q, confirmed) {
    const my = ++seq;
    show('Odin', `« ${q} »\n\nJe regarde…`);
    try {
      const r = await post('/api/valhalla/order', { text: q, session: 'guide', confirm: confirmed === true });
      if (my !== seq) return;
      if (r.confirm) { show('Confirmer ?', `${r.text}`, [{ label: 'Oui, fais-le', primary: true, run: () => ask(q, true) }, { label: 'Non', run: explain }]); return; }
      const none = r.kind === 'rien' || (!r.ok && /pas compris/.test(r.text ?? ''));
      show('Odin', none ? `Je n'ai pas compris « ${q} » sans IA. Dis-le avec le nom de l'appli ou de la chose (« arrête le conteneur web », « les alertes », « à quoi sert Sindri »), ou pose ta question dans la Discussion.` : (r.text || r.error || 'Fait.'),
        [...(none ? [{ label: 'Ouvrir la Discussion', primary: true, run: () => { close(); window.OdinShow?.('chat'); const i = $('#input'); if (i) { i.value = q; i.focus(); } } }] : []), { label: 'Cette page', run: explain }]);
    } catch { if (my === seq) show('Odin', 'Je n\'arrive pas à joindre mes applis pour l\'instant.', [{ label: 'Cette page', run: explain }]); }
  }

  function toggle(m) { anchor = m; if (box && !box.hidden) close(true); else explain(); }
  /** Rend la mascotte utilisable au doigt, à la souris et au clavier (elle n'est plus un simple décor). */
  function arm(m) {
    if (!m || m.dataset.guide) return;
    m.dataset.guide = '1'; m.classList.add('guide-on');
    m.removeAttribute('aria-hidden'); m.setAttribute('role', 'button'); m.setAttribute('tabindex', '0'); m.setAttribute('aria-haspopup', 'dialog'); m.setAttribute('aria-expanded', 'false');
    m.setAttribute('aria-label', 'Odin, ton guide : explique cette page'); m.removeAttribute('title');
    m.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
    // Un glisser déplace la mascotte ; seul un vrai clic ouvre le guide.
    m.addEventListener('click', (e) => { if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return; e.stopPropagation(); toggle(m); });
    m.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(m); } });
  }
  function start() {
    document.head.append(el('style', {}, css));
    // Dans la Discussion, la mascotte a déjà son propre menu : le guide s'accroche à celle qui se promène sur les autres pages.
    const armAll = () => { arm($('#buddyRoam')); };
    armAll(); new MutationObserver(armAll).observe(document.body, { childList: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box && !box.hidden) { e.stopPropagation(); close(true); } }, true);
    document.addEventListener('pointerdown', (e) => { if (box && !box.hidden && !(e.target instanceof Element && (e.target.closest('#guideBox') || e.target.closest('[data-guide]')))) close(); }, true);
    addEventListener('resize', place); document.addEventListener('scroll', place, { passive: true, capture: true });
    setInterval(() => { if (box && !box.hidden) place(); }, 700);
    // En changeant de page, la bulle ouverte explique la nouvelle page.
    const views = new MutationObserver(() => { if (box && !box.hidden) { const m = mascot(); if (m) anchor = m; setTimeout(explain, 350); } });
    for (const v of document.querySelectorAll('.view')) views.observe(v, { attributes: true, attributeFilter: ['class'] });
  }
  window.OdinGuide = { open: () => { anchor = mascot(); explain(); }, close: () => close(), ask: (q) => { anchor = mascot(); ask(q); }, news: () => { anchor = mascot(); news(); }, views: VIEWS, newsList: NEWS };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 600)); else setTimeout(start, 600);
})();
