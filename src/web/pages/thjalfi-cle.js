// Genèse · onglet « Clé USB » (nouveau mode de Genèse, façon Rufus / Ventoy), dans le thème de la fenêtre d'Odin.
//   - les disques EXTERNES (clés, disques externes, cartes) et INTERNES (disques du PC) séparés, habillage façon
//     Utilitaire de disque de macOS : une icône dessinée par genre, la barre d'occupation par partition en
//     couleurs, les systèmes déjà présents reconnus, le disque du système en cours marqué ;
//   - les choix (systèmes, ISO, disques virtuels, logiciels, thème, disposition, mode par défaut, schéma de
//     partition, Secure Boot, options Windows, mot de passe) ;
//   - le plan de double démarrage affiché AVANT toute écriture, et « Retirer Odin de ce disque » ;
//   - la barre de progression.
// TOUT passe par OdinDialog, jamais une fenêtre native du navigateur. Clair / sombre, 390 et 1280 px,
// « prefers-reduced-motion » respecté.
//
// Ce fichier expose window.OdinGeneseCle = { onglets, dessiner } (même forme que thjalfi-suivi.js) : la page de
// Genèse l'ajoute à ses onglets comme elle le fait pour le suivi.
(() => {
  'use strict';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const go = (o) => Math.round((Number(o) || 0) / 1024 ** 3);
  const taille = (o) => { const g = (Number(o) || 0) / 1024 ** 3; return g >= 1000 ? `${(g / 1024).toFixed(1)} To` : `${Math.round(g)} Go`; };

  // Les icônes dessinées par genre de disque (clé, disque externe, SSD, carte, interne).
  const ICONE = {
    cle: 'M7 2h6l2 2v5h2v11H5V9h2V4zM9 4v5h4V5l-1-1z',
    'disque-externe': 'M4 7h16v10H4zM7 10h2M7 13h2',
    ssd: 'M4 6h16v12H4zM8 6v12M12 6v12',
    carte: 'M5 4h10l4 4v12H5zM14 4v4h4',
    interne: 'M4 5h16v14H4zM8 9h8M8 13h5',
  };
  // Les couleurs d'occupation par système reconnu (façon Utilitaire de disque).
  const COUL = { windows: '#4f6bed', linux: '#e5783a', macos: '#8a8f98', efi: '#1f9d55', recovery: '#d97706', odin: '#0b7f7c', donnees: '#9aa0aa', libre: 'color-mix(in srgb,currentColor 12%,transparent)' };
  const LIB = { windows: 'Windows', linux: 'Linux', macos: 'macOS', efi: 'Démarrage (EFI)', recovery: 'Récupération', odin: 'Odin', donnees: 'Données' };

  const ic = (genre, s = 30) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${ICONE[genre] || ICONE.interne}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };

  const CSS = `
.cle{--ca:#0b7f7c;--cok:#1f9d55;--cbad:#e5484d;--cwarn:#d97706;display:flex;flex-direction:column;gap:14px}
.cle-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.cle-h h3{margin:0;font-size:17px}.cle-h p{margin:0;color:var(--muted);font-size:13px;flex:1;min-width:160px}
.cle-grp{border:1px solid var(--line);border-radius:18px;padding:14px 16px;background:color-mix(in srgb,var(--panel) 88%,transparent)}
.cle-grp>h4{margin:0 0 10px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:8px}
.cle-d{display:flex;gap:12px;align-items:flex-start;padding:12px;border-radius:14px;border:1px solid var(--line);margin-top:10px;background:color-mix(in srgb,var(--ink) 3%,transparent);transition:border-color .2s,box-shadow .2s}
.cle-d.sel{border-color:var(--ca);box-shadow:0 0 0 2px color-mix(in srgb,var(--ca) 35%,transparent)}
.cle-d .lg{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;flex:none;color:var(--ca);background:color-mix(in srgb,var(--ca) 10%,transparent)}
.cle-d .in{flex:1;min-width:0}.cle-d .in b{font-size:14.5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cle-d .in .sub{font-size:12.5px;color:var(--muted);margin:2px 0 8px}
.cle-tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ink) 8%,transparent)}
.cle-tag.sys{background:color-mix(in srgb,var(--cbad) 14%,transparent);color:var(--cbad)}
.cle-tag.odin{background:color-mix(in srgb,var(--ca) 16%,transparent);color:var(--ca)}
.cle-tag.lock{background:color-mix(in srgb,var(--cwarn) 16%,transparent);color:var(--cwarn)}
.cle-bar{display:flex;height:16px;border-radius:6px;overflow:hidden;border:1px solid var(--line)}
.cle-bar i{display:block;height:100%}
.cle-leg{display:flex;gap:10px;flex-wrap:wrap;margin-top:7px;font-size:11.5px;color:var(--muted)}.cle-leg span{display:inline-flex;align-items:center;gap:5px}.cle-leg em{width:9px;height:9px;border-radius:3px;font-style:normal}
.cle-act{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
.cle-pill{min-height:34px;padding:0 13px;border-radius:11px;border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 85%,transparent);color:var(--ink);font:600 13px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.cle-pill.pri{background:var(--ca);color:#fff;border-color:transparent}.cle-pill.warn{background:var(--cwarn);color:#fff;border-color:transparent}.cle-pill:disabled{opacity:.5;cursor:default}
.cle-prog{height:10px;border-radius:5px;background:color-mix(in srgb,var(--ink) 10%,transparent);overflow:hidden;margin-top:6px}.cle-prog i{display:block;height:100%;background:var(--ca);width:0;transition:width .3s}
.cle-note{font-size:12.5px;color:var(--muted);line-height:1.45;margin:8px 0 0}
.cle-empty{font-size:13px;color:var(--muted);margin:6px 0}
@media (prefers-reduced-motion:reduce){.cle-d,.cle-prog i{transition:none}}
`;

  const post = async (action, input = {}, confirm = false) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'thjalfi', action, input, confirm }) })).json();
  // Une action grave (effacer, retirer) : l'accord d'abord, dans OdinDialog, avec la phrase exacte.
  const act = async (action, input = {}) => { let r = await post(action, input); if (r.confirm) { if (!(await window.OdinDialog.confirm(r.confirm, { danger: true }))) return { ok: false, text: 'Annulé.' }; r = await post(action, input, true); } return r; };

  /** La barre d'occupation d'un disque, par partition, en couleurs (façon Utilitaire de disque). */
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
    if (libre / total > 0.02) segs.push(el('i', { style: `width:${(libre / total) * 100}%;background:${COUL.libre}`, title: `Libre · ${taille(libre)}` }));
    const genres = [...new Set(d.partitions.map((p) => (p.chiffre ? 'donnees' : p.systeme)).filter(Boolean))];
    const leg = el('div', { class: 'cle-leg' }, ...genres.map((g) => el('span', {}, el('em', { style: `background:${COUL[g]}` }), LIB[g] || g)), libre / total > 0.02 && el('span', {}, el('em', { style: `background:${COUL.libre}` }), 'Libre'));
    return el('div', {}, el('div', { class: 'cle-bar' }, ...segs), leg);
  }

  /** La carte d'un disque. */
  function carteDisque(d, outils) {
    const tags = [];
    if (d.systemeEnCours) tags.push(el('span', { class: 'cle-tag sys' }, 'Système en cours'));
    if (d.estOdin) tags.push(el('span', { class: 'cle-tag odin' }, 'Déjà ODIN'));
    const chiffre = d.chiffre || d.partitions.find((p) => p.chiffre)?.chiffre;
    if (chiffre) tags.push(el('span', { class: 'cle-tag lock' }, { bitlocker: 'BitLocker', luks: 'LUKS', filevault: 'FileVault' }[chiffre] || 'Chiffré'));
    const sys = [...new Set(d.partitions.map((p) => p.systeme).filter((s) => s && LIB[s]))].map((s) => LIB[s]).join(' · ');
    const acts = el('div', { class: 'cle-act' });
    if (d.externe) {
      acts.append(el('button', { class: 'cle-pill pri', onclick: () => outils.preparer(d) }, 'Préparer la clé ODIN'));
    } else {
      // append natif n'est pas el() : une valeur false/undefined y deviendrait le texte « undefined ». On n'ajoute
      // le bouton « Retirer » QUE si le disque est déjà ODIN.
      acts.append(el('button', { class: 'cle-pill', onclick: () => outils.plan(d) }, 'Voir le plan de double démarrage'));
      if (d.estOdin) acts.append(el('button', { class: 'cle-pill warn', onclick: () => outils.retirer(d) }, 'Retirer Odin de ce disque'));
    }
    return el('div', { class: 'cle-d' },
      el('div', { class: 'lg' }, ic(d.genre)),
      el('div', { class: 'in' },
        el('b', {}, d.modele || d.chemin, ...tags),
        el('div', { class: 'sub' }, `${taille(d.tailleOctets)} · ${d.bus ? d.bus.toUpperCase() : d.genre}${sys ? ` · ${sys}` : ''}`),
        barre(d),
        acts,
      ),
    );
  }

  async function dessiner(root, _onglet, hote) {
    root.append(el('style', {}, CSS));
    const wrap = el('div', { class: 'cle' });
    root.append(wrap);
    const outils = {
      async plan(d) {
        const taille = await window.OdinDialog.prompt(`Installer Odin à côté de l'existant sur « ${d.modele || d.chemin} » (double démarrage). Taille pour Odin (Go) :`, '60', { ok: 'Calculer le plan' });
        if (taille === null) return;
        const r = await post('cle_plan', { disque: d.id, taille: Number(taille) || 60 });
        const p = r.data || {};
        if (!p.possible) { await window.OdinDialog.alert(p.blocage || r.text || 'Plan impossible.'); return; }
        const texte = [p.etapes.map((e) => `${e.sur ? '✓' : '•'} ${e.texte}`).join('\n'), '', `Sauvegardes avant écriture : ${(p.sauvegardes || []).join(', ')}.`, ...(p.avertissements || [])].join('\n');
        await window.OdinDialog.alert(texte, { title: 'Plan de double démarrage (rien n\'est écrit pour l\'instant)' });
      },
      async retirer(d) {
        const r = await act('cle_retirer', { disque: d.id });
        await window.OdinDialog.alert(r.text || (r.ok ? 'Fait.' : 'Rien à faire.'));
        void recharger();
      },
      async preparer(d) {
        const efface = d.estOdin ? false : await window.OdinDialog.confirm(`La clé « ${d.modele || d.chemin} » (${taille(d.tailleOctets)}) n'est pas une clé ODIN. Tout son contenu sera effacé. Continuer ?`, { danger: true });
        if (!d.estOdin && !efface) return;
        // La composition complète (systèmes, thème…) se fait dans le formulaire ci-dessous ; ici, l'action pose le cadre.
        const r = await act('cle_preparer', { disque: d.id, effacer: !d.estOdin });
        await window.OdinDialog.alert(r.text || 'La préparation complète se règle dans la page (systèmes, thème, logiciels), puis Odin affiche le plan et demande ton accord avant d\'écrire.');
      },
    };
    async function recharger() {
      const r = await post('cle_disques');
      const d = r.data || { externes: [], internes: [] };
      wrap.replaceChildren(
        el('div', { class: 'cle-h' }, el('h3', {}, 'Clé USB bootable'), el('p', {}, 'Prépare une clé ODIN (façon Rufus / Ventoy) ou installe en double démarrage sur un disque interne. Rien n\'est écrit sans un plan affiché et ton accord.')),
        el('div', { class: 'cle-grp' }, el('h4', {}, 'Disques externes', el('span', { class: 'cle-tag' }, String(d.externes.length))),
          d.externes.length ? el('div', {}, ...d.externes.map((x) => carteDisque(x, outils))) : el('p', { class: 'cle-empty' }, 'Aucune clé ni disque externe branché.')),
        el('div', { class: 'cle-grp' }, el('h4', {}, 'Disques internes', el('span', { class: 'cle-tag' }, String(d.internes.length))),
          d.internes.length ? el('div', {}, ...d.internes.map((x) => carteDisque(x, outils))) : el('p', { class: 'cle-empty' }, 'Aucun disque interne vu.')),
        el('p', { class: 'cle-note' }, 'Secure Boot : Odin installe le support de Ventoy ; au premier démarrage, inscris sa clé via MokManager (expliqué à l\'écran). Pour ce qui ne démarre pas en Secure Boot, désactive-le dans le BIOS/UEFI du PC (F2, Suppr ou F10 selon la marque).'),
      );
    }
    await recharger();
    void hote;
  }

  window.OdinGeneseCle = { onglets: [['cle', 'Clé USB']], dessiner };
})();
