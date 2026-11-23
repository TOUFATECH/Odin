// Genèse · onglet « Clé USB » : le cadre de la maquette validée « Clés USB » (lot C1).
//   - le parcours lui-même (quatre onglets, barre des 6 étapes, étape « Clé » avec son garde-fou) est dans
//     thjalfi-cle-etapes.js (window.OdinGeneseCleEtapes) ;
//   - ce fichier le greffe dans Genèse, et garde joignable tout ce que l'onglet savait déjà faire : la liste des
//     disques comme avant (externes et internes séparés, barre d'occupation, étiquettes, chiffrement), « Préparer »
//     (le composeur), le plan de double démarrage d'un disque interne et « Retirer Odin de ce disque ». Cette liste
//     vit sous « Mes clés » tant que son lot n'est pas fait.
// TOUT passe par OdinDialog, jamais une fenêtre native du navigateur. Clair / sombre, 390 et 1280 px,
// « prefers-reduced-motion » respecté. Rien n'est écrit sur un disque sans un plan affiché et ton accord.
//
// Ce fichier expose window.OdinGeneseCle = { onglets, dessiner } (même forme que thjalfi-suivi.js) : la page de
// Genèse l'ajoute à ses onglets comme elle le fait pour le suivi.
(() => {
  'use strict';
  // Les mots de la liste « comme avant » (le parcours a les siens dans thjalfi-cle-etapes.js).
  const MOTS = {
    onglet: 'Clé USB',
    externes: 'Disques externes',
    internes: 'Disques internes',
    aucunExterne: 'Aucune clé ni disque externe branché.',
    aucunInterne: 'Aucun disque interne vu.',
    systemeEnCours: 'Système en cours',
    dejaOdin: 'Déjà ODIN',
    chiffre: 'Chiffré',
    preparerCle: 'Préparer la clé ODIN',
    preparerDisque: 'Préparer ce disque (ODIN)',
    gros: 'Gros disque externe : il peut tout contenir — plusieurs systèmes installés et beaucoup d\'ISO.',
    plan: 'Voir le plan de double démarrage',
    retirer: 'Retirer Odin de ce disque',
    libre: 'Libre',
    planTaille: 'Installer Odin à côté de l\'existant sur « {nom} » (double démarrage). Taille pour Odin (Go) :',
    planCalculer: 'Calculer le plan',
    planImpossible: 'Plan impossible.',
    planTitre: 'Plan de double démarrage (rien n\'est écrit pour l\'instant)',
    planSauvegardes: 'Sauvegardes avant écriture : {liste}.',
    fait: 'Fait.',
    rien: 'Rien à faire.',
    annule: 'Annulé.',
    pasOdin: 'La clé « {nom} » ({taille}) n\'est pas une clé ODIN. Tout son contenu sera effacé. Continuer ?',
    preparerSuite: 'La préparation complète se règle dans la page (systèmes, thème, logiciels), puis Odin affiche le plan et demande ton accord avant d\'écrire.',
    secureBoot: 'Démarrage sécurisé : Odin installe ce qu\'il faut sur la clé ; au premier démarrage, inscris sa clé dans l\'écran bleu d\'inscription (expliqué à l\'écran). Pour ce qui ne démarre pas ainsi, désactive le démarrage sécurisé dans le BIOS/UEFI du PC (F2, Suppr ou F10 selon la marque).',
    chiffreInconnu: 'Chiffrement inconnu',
    chiffreInconnuDroits: 'Odin ne peut pas lire le chiffrement de ce disque sans les droits d\'administrateur : il le traite comme chiffré et n\'y crée ni n\'y réduit aucune partition. Relance Odin en administrateur, ou vérifie toi-même dans « Gérer BitLocker » (Windows).',
    chiffreInconnuSansLettre: 'Une partition de ce disque n\'a pas de lettre : Odin ne peut pas lire son chiffrement, même en administrateur. Il le traite comme chiffré et n\'y crée ni n\'y réduit aucune partition. Pour qu\'il le lise, donne-lui toi-même une lettre (Windows : « Gestion des disques »), puis relance Odin en administrateur.',
    chiffreInconnuExterne: 'Odin n\'a pas pu lire le chiffrement de ce disque. Le préparer peut effacer tout son contenu, chiffré ou non : le plan dit ce qui sera effacé, et rien n\'est écrit sans ton accord.',
    lib: { windows: 'Windows', linux: 'Linux', macos: 'macOS', efi: 'Démarrage (EFI)', recovery: 'Récupération', odin: 'Odin', donnees: 'Données' },
    chiffres: { bitlocker: 'BitLocker', luks: 'LUKS', filevault: 'FileVault' },
  };
  const mot = (t, v) => String(t).replace(/\{(\w+)\}/g, (_m, x) => (v && v[x] != null ? String(v[x]) : ''));
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  };
  const langue = () => (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || undefined;
  const taille = (o) => window.OdinGeneseCleEtapes?.logique?.taille ? window.OdinGeneseCleEtapes.logique.taille(o, langue()) : `${Math.round((Number(o) || 0) / 1024 ** 3)}`;

  // Les icônes dessinées par genre de disque (clé, disque externe, SSD, carte, interne).
  const ICONE = {
    cle: 'M7 2h6l2 2v5h2v11H5V9h2V4zM9 4v5h4V5l-1-1z',
    'disque-externe': 'M4 7h16v10H4zM7 10h2M7 13h2',
    ssd: 'M4 6h16v12H4zM8 6v12M12 6v12',
    carte: 'M5 4h10l4 4v12H5zM14 4v4h4',
    interne: 'M4 5h16v14H4zM8 9h8M8 13h5',
  };
  // Les couleurs d'occupation par système reconnu.
  const COUL = { windows: '#4f6bed', linux: '#e5783a', macos: '#8a8f98', efi: '#1f9d55', recovery: '#d97706', odin: '#0b7f7c', donnees: '#9aa0aa', libre: 'color-mix(in srgb,currentColor 12%,transparent)' };
  /** Les aides d'un disque au chiffrement inconnu (vide s'il est lisible). */
  const aidesInconnu = (d) => {
    const inc = d.partitions.filter((p) => p.chiffreInconnu);
    if (!inc.length) return [];
    if (d.externe) return [MOTS.chiffreInconnuExterne];
    return [inc.some((p) => p.montage) && MOTS.chiffreInconnuDroits, inc.some((p) => !p.montage) && MOTS.chiffreInconnuSansLettre].filter(Boolean);
  };

  const ic = (genre, s = 30) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${ICONE[genre] || ICONE.interne}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };

  const CSS = `
.cle{--ca:var(--accent,#0b7f7c);--cok:var(--good,#1f9d55);--cbad:var(--bad,#e5484d);--cwarn:#d97706;display:flex;flex-direction:column;gap:14px}
.cle-grp{border:1px solid var(--line);border-radius:18px;padding:14px 16px;background:var(--panel)}
.cle-grp>h4{margin:0 0 10px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:8px}
.cle-d{display:flex;gap:12px;align-items:flex-start;padding:12px;border-radius:14px;border:1px solid var(--line);margin-top:10px;background:color-mix(in srgb,var(--ink) 3%,transparent)}
.cle-d .lg{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;flex:none;color:var(--ca);background:color-mix(in srgb,var(--ca) 10%,transparent)}
.cle-d .in{flex:1;min-width:0}.cle-d .in b{font-size:14.5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cle-d .in .sub{font-size:12.5px;color:var(--muted);margin:2px 0 8px}
.cle-tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ink) 8%,transparent)}
.cle-tag.sys{background:color-mix(in srgb,var(--cbad) 14%,transparent);color:var(--cbad)}
.cle-tag.odin{background:color-mix(in srgb,var(--cok) 16%,transparent);color:var(--cok)}
.cle-tag.lock{background:color-mix(in srgb,var(--warn,var(--cwarn)) 10%,transparent);color:color-mix(in srgb,var(--warn,var(--cwarn)) 85%,var(--ink))}
.cle-bar{display:flex;height:16px;border-radius:6px;overflow:hidden;border:1px solid var(--line)}
.cle-bar i{display:block;height:100%}
.cle-leg{display:flex;gap:10px;flex-wrap:wrap;margin-top:7px;font-size:11.5px;color:var(--muted)}.cle-leg span{display:inline-flex;align-items:center;gap:5px}.cle-leg em{width:9px;height:9px;border-radius:3px;font-style:normal}
.cle-act{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
.cle-pill{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.cle-pill.pri{background:var(--ca);color:var(--on-accent,#fff);border-color:transparent}.cle-pill.warn{background:var(--cwarn);color:#fff;border-color:transparent}.cle-pill:disabled{opacity:.5;cursor:default}
.cle-note{font-size:12.5px;color:var(--muted);line-height:1.45;margin:8px 0 0}
.cle-empty{font-size:13px;color:var(--muted);margin:6px 0}
`;

  const postPage = async (action, input = {}, confirm = false) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'thjalfi', action, input, confirm }) })).json();
  // Une action grave (effacer, retirer) : l'accord d'abord, dans OdinDialog, avec la phrase exacte.
  const actPage = async (action, input = {}) => { let r = await postPage(action, input); if (r.confirm) { if (!(await window.OdinDialog.confirm(r.confirm, { danger: true }))) return { ok: false, text: MOTS.annule }; r = await postPage(action, input, true); } return r; };

  /** La barre d'occupation d'un disque, par partition, en couleurs. */
  function barre(d) {
    const total = Math.max(1, d.tailleOctets);
    const segs = [];
    let pris = 0;
    for (const p of d.partitions) {
      const sys = p.chiffre ? 'donnees' : (p.systeme || 'donnees');
      const pct = Math.max(1.5, (p.tailleOctets / total) * 100);
      pris += p.tailleOctets;
      segs.push(el('i', { style: `width:${pct}%;background:${COUL[sys] || COUL.donnees}`, title: `${p.label || p.nom} · ${taille(p.tailleOctets)}` }));
    }
    const libre = total - pris;
    if (libre / total > 0.02) segs.push(el('i', { style: `width:${(libre / total) * 100}%;background:${COUL.libre}`, title: `${MOTS.libre} · ${taille(libre)}` }));
    const genres = [...new Set(d.partitions.map((p) => (p.chiffre ? 'donnees' : p.systeme)).filter(Boolean))];
    const leg = el('div', { class: 'cle-leg' }, ...genres.map((g) => el('span', {}, el('em', { style: `background:${COUL[g]}` }), MOTS.lib[g] || g)), libre / total > 0.02 && el('span', {}, el('em', { style: `background:${COUL.libre}` }), MOTS.libre));
    return el('div', {}, el('div', { class: 'cle-bar' }, ...segs), leg);
  }

  /** La carte d'un disque (la liste comme avant). */
  function carteDisque(d, outils) {
    const tags = [];
    if (d.systemeEnCours) tags.push(el('span', { class: 'cle-tag sys' }, MOTS.systemeEnCours));
    if (d.estOdin) tags.push(el('span', { class: 'cle-tag odin' }, MOTS.dejaOdin));
    const chiffre = d.chiffre || d.partitions.find((p) => p.chiffre)?.chiffre;
    if (chiffre) tags.push(el('span', { class: 'cle-tag lock' }, MOTS.chiffres[chiffre] || MOTS.chiffre));
    const aides = chiffre ? [] : aidesInconnu(d);
    if (aides.length) tags.push(el('span', { class: 'cle-tag lock', title: aides.join(' ') }, MOTS.chiffreInconnu));
    const sys = [...new Set(d.partitions.map((p) => p.systeme).filter((s) => s && MOTS.lib[s]))].map((s) => MOTS.lib[s]).join(' · ');
    const acts = el('div', { class: 'cle-act' });
    if (d.externe) {
      // Clé OU disque externe : la même préparation marche sur les deux ; un gros disque externe peut tout contenir.
      // Le disque d'où tourne le système n'est jamais proposé, même branché en USB.
      const gros = d.genre === 'disque-externe' && d.tailleOctets > 130 * 1024 ** 3;
      if (!d.systemeEnCours) acts.append(el('button', { type: 'button', class: 'cle-pill pri', onclick: () => outils.preparer(d) }, gros ? MOTS.preparerDisque : MOTS.preparerCle));
      if (gros) acts.append(el('span', { class: 'cle-note', style: 'flex-basis:100%;margin-top:4px' }, MOTS.gros));
    } else {
      // append natif n'est pas el() : une valeur false/undefined y deviendrait le texte « undefined ». On n'ajoute
      // le bouton « Retirer » QUE si le disque est déjà ODIN.
      acts.append(el('button', { type: 'button', class: 'cle-pill', onclick: () => outils.plan(d) }, MOTS.plan));
      if (d.estOdin) acts.append(el('button', { class: 'cle-pill warn', type: 'button', onclick: () => outils.retirer(d) }, MOTS.retirer));
    }
    return el('div', { class: 'cle-d' },
      el('div', { class: 'lg' }, ic(d.genre)),
      el('div', { class: 'in' },
        el('b', {}, d.modele || d.chemin, ...tags),
        el('div', { class: 'sub' }, `${taille(d.tailleOctets)} · ${d.bus ? d.bus.toUpperCase() : d.genre}${sys ? ` · ${sys}` : ''}`),
        barre(d),
        ...aides.map((a) => el('p', { class: 'cle-note' }, a)),
        acts,
      ),
    );
  }

  /** La liste des disques comme avant (sous « Mes clés » tant que son lot n'est pas fait). */
  async function ancienne(wrap, hote) {
    const post = hote?.post || postPage, act = hote?.act || actPage;
    // Le style voyage avec la liste (la page de Genèse déplace ce qu'on dessine).
    const style = el('style', {}, CSS);
    const corps = el('div', { class: 'cle' });
    wrap.append(style, corps);
    const outils = {
      async plan(d) {
        const t = await window.OdinDialog.prompt(mot(MOTS.planTaille, { nom: d.modele || d.chemin }), '60', { ok: MOTS.planCalculer });
        if (t === null) return;
        const r = await post('cle_plan', { disque: d.id, taille: Number(t) || 60 });
        const p = r.data || {};
        if (!p.possible) { await window.OdinDialog.alert(p.blocage || r.text || MOTS.planImpossible); return; }
        const texte = [p.etapes.map((e) => `${e.sur ? '✓' : '•'} ${e.texte}`).join('\n'), '', mot(MOTS.planSauvegardes, { liste: (p.sauvegardes || []).join(', ') }), ...(p.avertissements || [])].join('\n');
        await window.OdinDialog.alert(texte, { title: MOTS.planTitre });
      },
      async retirer(d) {
        const r = await act('cle_retirer', { disque: d.id });
        await window.OdinDialog.alert(r.text || (r.ok ? MOTS.fait : MOTS.rien));
        void recharger();
      },
      async preparer(d) {
        // La composition complète (cible clé/disque, trois choix par système, VM d'Hydre, plan affiché, progression)
        // se fait dans le composeur ; il montre le plan et demande l'accord (phrase exacte) avant toute écriture.
        if (window.OdinGeneseCleComposer?.ouvrir) { await window.OdinGeneseCleComposer.ouvrir(d, { post, act }); void recharger(); return; }
        const efface = d.estOdin ? false : await window.OdinDialog.confirm(mot(MOTS.pasOdin, { nom: d.modele || d.chemin, taille: taille(d.tailleOctets) }), { danger: true });
        if (!d.estOdin && !efface) return;
        const r = await act('cle_preparer', { disque: d.id, effacer: !d.estOdin });
        await window.OdinDialog.alert(r.text || MOTS.preparerSuite);
      },
    };
    async function recharger() {
      const r = await post('cle_disques');
      const d = r.data || { externes: [], internes: [] };
      corps.replaceChildren(
        el('div', { class: 'cle-grp' }, el('h4', {}, MOTS.externes, el('span', { class: 'cle-tag' }, String(d.externes.length))),
          d.externes.length ? el('div', {}, ...d.externes.map((x) => carteDisque(x, outils))) : el('p', { class: 'cle-empty' }, MOTS.aucunExterne)),
        el('div', { class: 'cle-grp' }, el('h4', {}, MOTS.internes, el('span', { class: 'cle-tag' }, String(d.internes.length))),
          d.internes.length ? el('div', {}, ...d.internes.map((x) => carteDisque(x, outils))) : el('p', { class: 'cle-empty' }, MOTS.aucunInterne)),
        el('p', { class: 'cle-note' }, MOTS.secureBoot),
      );
    }
    await recharger();
  }

  async function dessiner(root, _onglet, hote) {
    // La page de Genèse déplace ce qu'on dessine dans son propre corps : on travaille dans « wrap », qui suit.
    const wrap = el('div', {});
    root.append(wrap);
    const parcours = window.OdinGeneseCleEtapes;
    const outils = { post: hote?.post || postPage, act: hote?.act || actPage };
    if (parcours && typeof parcours.monter === 'function') { await parcours.monter(wrap, { ...outils, ancienne: (n) => ancienne(n, outils) }); return; }
    await ancienne(wrap, outils);
  }

  window.OdinGeneseCle = { onglets: [['cle', MOTS.onglet]], dessiner, ancienne };
})();
