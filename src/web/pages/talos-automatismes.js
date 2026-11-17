// Talos : « Automatismes des applis ». Tout ce qui tourne tout seul dans Odin, au même endroit : le travail
// automatique des applis (veille continue et tâches à rythme réglable), les tâches planifiées et les routines
// d'Odin, les rappels et les rendez-vous à rappeler. Chaque ligne : dernier passage, prochain, et les boutons que
// le serveur permet (Lancer maintenant, Pause, Rythme, Décaler, Supprimer, Ouvrir, Historique).
// Ce fichier est chargé avant les autres scripts de l'interface : rien ne touche au document à son chargement.
// API : OdinAutomatismes.monter(box) ; OdinAutomatismes.ligne(l, { recharger }) → élément ; OdinAutomatismes.noms().
(() => {
  'use strict';
  if (window.OdinAutomatismes) return;

  // ---------------- Logique pure (sans document)
  const FILTRES = [
    { id: 'tout', label: 'Tout' },
    { id: 'tache', label: 'Tâches' },
    { id: 'veille', label: 'Veille' },
    { id: 'rappels', label: 'Rappels et rendez-vous' },
    { id: 'odin', label: 'Tâches d\'Odin' },
    { id: 'pause', label: 'En pause' },
    { id: 'echec', label: 'En échec' },
    { id: 'liens', label: 'Liens entre applis' },
  ];
  /** Les lignes que montre un filtre. Les automatisations ont déjà leurs cartes au-dessus : elles ne sont pas répétées ici. */
  function filtrer(lignes, filtre) {
    const l = (lignes ?? []).filter((x) => x.sorte !== 'automatisation');
    switch (filtre) {
      case 'liens': return []; // les liens écrits ont leur propre bloc (voir grouperLiens)
      case 'tache': return l.filter((x) => x.sorte === 'tache');
      case 'veille': return l.filter((x) => x.sorte === 'veille');
      case 'rappels': return l.filter((x) => x.sorte === 'rappel' || x.sorte === 'rendez_vous');
      case 'odin': return l.filter((x) => x.sorte === 'tache_odin');
      case 'pause': return l.filter((x) => x.etat === 'pause');
      case 'echec': return l.filter((x) => x.etat === 'erreur' || x.derniere?.ok === false);
      default: return l;
    }
  }
  /** « 120 ms », « 3,4 s », « 2 min ». */
  function duree(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
    return `${Math.round(ms / 60_000)} min`;
  }
  /**
   * Les liens écrits entre applis, rangés par l'appli qui signale (ordre alphabétique de son nom) ; `protege` : seulement
   * ceux qui protègent. Chaque lien reste une fois et une seule.
   */
  function grouperLiens(liens, protege = false) {
    const g = new Map();
    for (const l of liens ?? []) {
      if (protege && !l.protege) continue;
      if (!g.has(l.de)) g.set(l.de, { de: l.de, deNom: l.deNom || l.de, liens: [] });
      g.get(l.de).liens.push(l);
    }
    return [...g.values()].sort((a, b) => a.deNom.localeCompare(b.deNom, 'fr'));
  }
  const GENRES = { 'réflexe': 'Réflexe', 'donnée': 'Donnée', soin: 'Soin' };
  /** La phrase d'un lien, tirée du lien lui-même : « Quand … → … ». */
  const phraseLien = (l) => `Quand ${l.quand} → ${l.fait}`;
  /**
   * Ce que dit la déclaration « coupure » d'un lien, en lecture seule (rien ne se coupe encore) : « Pourra se couper. »,
   * ou « Ne se coupe pas (encore) : » avec la raison écrite dans le lien.
   */
  function phraseCoupure(c) {
    if (!c || typeof c !== 'object') return '';
    if (typeof c.par === 'string') return 'Pourra se couper.';
    if (typeof c.pas_encore === 'string') return `Ne se coupe pas encore : ${c.pas_encore}.`;
    if (typeof c.jamais === 'string') return `Ne se coupe pas : ${c.jamais}.`;
    return '';
  }
  /**
   * L'état d'un des 21 liens qui se coupent d'ici : « Coupé jusqu'à 11 h 00 » (un lien qui protège se rétablit seul),
   * « Coupé » (jusqu'à ce que tu le rétablisses), ou '' quand il n'est pas coupé.
   */
  function etatCoupe(l) {
    if (!l || !l.coupe) return '';
    const d = l.coupe.jusqua ? new Date(l.coupe.jusqua) : null;
    if (!d || Number.isNaN(+d)) return 'Coupé';
    // Écrit comme dans la confirmation d'Odin (« 1 h 42 »).
    const heure = `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
    return new Date().toDateString() === d.toDateString() ? `Coupé jusqu'à ${heure}` : `Coupé jusqu'à ${heure}, le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
  }

  // ---------------- Dessin
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  /** Un appel à Odin ; null quand la fonction n'existe pas (404, 403, réseau, réponse sans « ok »). */
  async function appel(path, body) {
    try {
      const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
      if (!r.ok) return null;
      const j = await r.json(); return j && typeof j === 'object' && 'ok' in j ? j : null;
    } catch { return null; }
  }
  const css = `
.au-sec{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0 0 16px;min-width:0}
.au-sec>h2{font-size:17px;margin:0 0 4px}.au-sec>.au-sub{margin:0 0 10px;color:var(--muted);font-size:14px}
.au-f{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}.au-f button{min-height:40px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font:inherit;font-size:14px;cursor:pointer}
.au-f button[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}.au-f button small{opacity:.75;margin-left:4px}
.au-list{list-style:none;margin:0;padding:0}.au-l{display:grid;grid-template-columns:36px minmax(0,1fr);gap:4px 12px;padding:12px 0;border-bottom:1px solid var(--line)}.au-list>.au-l:last-child{border-bottom:0}
.au-ic{grid-row:1/span 3;line-height:0}.au-odin{display:grid;place-items:center;width:32px;height:32px;border-radius:8px;background:var(--field);font-weight:700}
.au-t{min-width:0;overflow-wrap:anywhere}.au-t b{font-size:15px}.au-t .au-ap{color:var(--muted);font-size:13px;margin-left:6px}.au-t p{margin:2px 0 0;font-size:13.5px;color:var(--muted)}
.au-m{display:flex;gap:6px 12px;flex-wrap:wrap;align-items:center;font-size:13.5px;min-width:0}.au-m .pill{flex:none}
.au-l>*:not(.au-ic){grid-column:2;min-width:0}.au-b{display:flex;gap:6px;flex-wrap:wrap}.au-b .btn{min-height:40px}@media (max-width:700px),(pointer:coarse){.au-b .btn{min-height:44px}}
.au-r{grid-column:2;font-size:13.5px;overflow-wrap:anywhere}.au-r:empty{display:none}.au-r .pill{margin-right:6px}
.au-x{grid-column:2;display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:10px;background:var(--panel2)}.au-x:empty{display:none}
.au-x select{min-height:44px;border-radius:10px;border:1px solid var(--field,var(--line));background:var(--panel);color:var(--ink);font:inherit;padding:0 10px}
.au-ln{margin:16px 0 0;min-width:0}.au-ln>h3{font-size:16px;margin:0 0 2px}.au-ln>.au-sub{margin:0 0 10px;color:var(--muted);font-size:14px}
.au-g{border-top:1px solid var(--line);min-width:0}.au-g:last-child{border-bottom:1px solid var(--line)}
.au-g>summary{min-height:44px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer;padding:6px 0;font-size:15px;overflow-wrap:anywhere}
.au-g>summary::-webkit-details-marker{display:none}.au-g>summary::before{content:'▸';color:var(--muted);transition:transform .15s}.au-g[open]>summary::before{transform:rotate(90deg)}
.au-g>summary small{color:var(--muted);font-size:13px}.au-g>.au-list{padding-left:4px}
.au-pr{font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.au-cp{grid-column:2;display:flex;flex-direction:column;gap:6px;min-width:0}.au-cp .au-b .btn{min-height:44px}
.au-sw{display:inline-flex;align-items:center;gap:10px;min-height:44px;padding:0 14px 0 8px;border-radius:999px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font:inherit;font-size:14px;cursor:pointer}
.au-sw:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.au-sw[disabled]{opacity:.6;cursor:wait}
.au-sw-p{position:relative;flex:none;width:38px;height:22px;border-radius:999px;background:var(--muted);transition:background .15s}
.au-sw-p::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--panel);transition:transform .15s}
.au-sw[aria-checked=true] .au-sw-p{background:var(--good)}.au-sw[aria-checked=true] .au-sw-p::after{transform:translateX(16px)}
@media (prefers-reduced-motion:reduce){.au-sw-p,.au-sw-p::after{transition:none}}
.au-h{margin:0;padding-left:18px;font-size:13px}.au-al{border:1px solid var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent);border-radius:10px;padding:8px 12px;margin:0 0 10px;font-size:14px}
`;
  let styled = false;
  function style() { if (styled) return; styled = true; document.head.append(el('style', {}, css)); }

  /** Les noms affichés des applis (jamais leur identifiant interne). Gardés le temps de la visite. */
  let nomsP = null; const NOMS = new Map();
  function noms() {
    if (!nomsP) nomsP = appel('/api/valhalla/catalog').then((r) => { for (const m of r?.modules ?? []) NOMS.set(m.id, m.name); if (!r) nomsP = null; return NOMS; });
    return nomsP;
  }
  const nomDe = (id) => (id ? NOMS.get(id) ?? '' : 'Odin');

  const icone = (l) => {
    const s = el('span', { class: 'au-ic', 'aria-hidden': 'true' });
    if (l.appli && window.OdinAppIcons) s.innerHTML = window.OdinAppIcons.tile(l.appli, nomDe(l.appli), 32);
    else s.append(el('span', { class: 'au-odin' }, 'ᛟ'));
    return s;
  };
  const ETATS = { pause: ['', 'En pause'], arret: ['', 'Désactivée'], en_cours: ['', 'En cours'], erreur: ['bad', 'En échec'] };
  const quandCourt = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); };
  /** Le résultat d'un passage : pastille, texte, durée. */
  const passage = (p) => [el('span', { class: `pill ${p.ok ? 'good' : 'bad'}` }, p.ok ? 'Réussi' : 'Échec'), [p.texte, duree(p.ms), p.at ? quandCourt(p.at) : ''].filter(Boolean).join(' · ')];

  /** Ouvre ce que désigne le lien d'une ligne (l'automatisation, les tâches planifiées, la page d'une appli). */
  function ouvrir(lien) {
    if (!lien) return;
    if (lien.vue === 'flows') { window.OdinShow?.('flows'); if (lien.flow) window.OdinFlows?.edit?.(lien.flow); }
    else if (lien.vue === 'jobs') window.OdinShow?.('jobs');
    else if (lien.vue === 'app' && lien.appli) window.OdinApps?.app(lien.appli);
  }

  /** Une ligne : ce qui tourne, son rythme, son dernier et son prochain passage, et ce qu'on peut en faire. */
  function ligne(l, opts = {}) {
    style();
    const li = el('li', { class: 'au-l', 'data-id': l.id });
    const res = el('div', { class: 'au-r', role: 'status' }), extra = el('div', { class: 'au-x' });
    const remplacer = (nouvelle) => { if (nouvelle && typeof nouvelle === 'object' && nouvelle.id) li.replaceWith(ligne(nouvelle, opts)); else opts.recharger?.(); };
    const dire = (texte, ok) => res.replaceChildren(ok === undefined ? '' : el('span', { class: `pill ${ok ? 'good' : 'bad'}` }, ok ? 'Fait' : 'Refusé'), texte);
    const indispo = () => dire('Odin ne répond pas, ou ne sait pas encore le faire.', false);
    const peut = l.peut ?? {};
    const etat = ETATS[l.etat];
    const meta = [
      el('span', {}, l.phrase),
      l.quandTexte ? el('span', {}, `Rendez-vous : ${l.quandTexte}`) : null,
      l.moyen ? el('span', {}, `Part sur ${l.moyen}`) : null,
      etat ? el('span', { class: `pill ${etat[0]}` }, l.etat === 'pause' && l.pauseJusqua ? `En pause jusqu'au ${quandCourt(l.pauseJusqua)}` : etat[1]) : null,
      l.securite ? el('span', { class: 'pill', title: 'Surveillance de sécurité' }, 'Sécurité') : null,
    ];
    const suivi = [
      l.derniere ? el('span', {}, 'Dernier passage : ', ...passage(l.derniere)) : el('span', { class: 'sub' }, 'Pas encore passé'),
      l.prochaineTexte && l.etat !== 'pause' && l.etat !== 'arret' ? el('span', {}, `Prochaine : ${l.prochaineTexte}`) : null,
    ];
    const B = (label, fn, o = {}) => el('button', { class: `btn small${o.primary ? ' primary' : ''}`, type: 'button', 'aria-label': `${label} : ${l.nom}`, onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(b); } finally { b.disabled = false; } } }, label);

    async function lancer() {
      dire('Lancement…');
      const r = await appel('/api/draupnir/automatisme/lancer', { id: l.id });
      if (!r) return indispo();
      if (!r.ok) return dire(r.error ?? 'Refusé.', false);
      const x = r.resultat ?? {};
      res.replaceChildren(...passage({ ok: x.ok !== false, texte: x.texte, ms: x.ms }));
    }
    async function envoyerPause(corps) {
      let r = await appel('/api/draupnir/automatisme/pause', corps);
      if (r && !r.ok && r.code === 'accord') {
        if (!(await window.OdinDialog.confirm(r.confirm ?? 'Confirmer ?', { danger: true, ok: 'Mettre en pause' }))) return dire('Annulé : rien n\'a changé.');
        r = await appel('/api/draupnir/automatisme/pause', { ...corps, confirme: true });
      }
      if (!r) return indispo();
      if (!r.ok) return dire(r.error ?? 'Refusé.', false);
      remplacer(r.ligne);
    }
    async function pause() {
      if (l.etat === 'pause' || l.etat === 'arret') return envoyerPause({ id: l.id, pause: false });
      if (!l.securite) return envoyerPause({ id: l.id, pause: true });
      // Une veille de sécurité : en pause pour une durée choisie (1 h par défaut, 24 h au plus), avec ton accord.
      const sid = `au-d-${l.id.replace(/[^\w-]/g, '_')}`;
      const choix = el('select', { id: sid }, ...[1, 2, 4, 8, 12, 24].map((h) => el('option', { value: String(h) }, h === 1 ? '1 heure' : `${h} heures`)));
      extra.replaceChildren(el('label', { for: sid }, 'Pendant combien de temps ?'), choix,
        el('div', { class: 'au-b' },
          B('Mettre en pause', async () => {
            const h = Number(choix.value) || 1, jusqua = new Date(Date.now() + h * 3600_000);
            const ok = await window.OdinDialog.confirm(`Mettre en pause « ${l.nom} » pendant ${h === 1 ? '1 heure' : `${h} heures`} ?\n\nC'est une surveillance de sécurité : rien ne sera surveillé jusqu'à ${jusqua.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}. Elle reprendra toute seule, et une alerte restera visible en attendant.`, { danger: true, ok: 'Mettre en pause' });
            if (!ok) { extra.replaceChildren(); return; }
            await envoyerPause({ id: l.id, pause: true, jusqua: jusqua.toISOString(), confirme: true });
          }, { primary: true }),
          B('Annuler', async () => { extra.replaceChildren(); })));
      choix.focus();
    }
    function rythme() {
      if (!window.OdinRythme) return indispo();
      let choisi = null;
      const ed = window.OdinRythme.editeur({ valeur: l.rythme, permis: l.reglable, onChange: (r) => { choisi = r; } });
      extra.replaceChildren(ed, el('div', { class: 'au-b' },
        B('Enregistrer', async () => {
          const r0 = ed.lire?.() ?? choisi; if (!r0) return;
          const r = await appel('/api/draupnir/automatisme/rythme', { id: l.id, rythme: r0 });
          if (!r) return indispo(); if (!r.ok) return dire(r.error ?? 'Rythme refusé.', false);
          remplacer(r.ligne);
        }, { primary: true }),
        B('Annuler', async () => { extra.replaceChildren(); })));
    }
    async function decaler() {
      const quand = await window.OdinDialog.prompt(`Décaler « ${l.nom} » à quand ?\nEx. demain 8 h, lundi 9 h 30, 2026-11-18 15:00.`, l.prochaineTexte ?? '', { ok: 'Décaler' });
      if (quand === null || !String(quand).trim()) return;
      const r = await appel('/api/draupnir/automatisme/decaler', { id: l.id, quand: String(quand).trim() });
      if (!r) return indispo(); if (!r.ok) return dire(r.error ?? 'Date non comprise.', false);
      remplacer(r.ligne);
    }
    async function supprimer() {
      if (!(await window.OdinDialog.confirm(`Supprimer « ${l.nom} » ? Il ne partira plus.`, { danger: true, ok: 'Supprimer' }))) return;
      let r = await appel('/api/draupnir/automatisme/supprimer', { id: l.id, confirme: true });
      if (r && !r.ok && r.code === 'accord') { if (!(await window.OdinDialog.confirm(r.confirm ?? 'Confirmer ?', { danger: true }))) return; r = await appel('/api/draupnir/automatisme/supprimer', { id: l.id, confirme: true }); }
      if (!r) return indispo(); if (!r.ok) return dire(r.error ?? 'Refusé.', false);
      li.remove(); opts.recharger?.();
    }
    async function historique() {
      if (extra.dataset.h === '1') { extra.replaceChildren(); extra.dataset.h = ''; return; }
      const r = await appel(`/api/draupnir/automatisme/historique?${new URLSearchParams({ id: l.id })}`);
      if (!r || !r.ok) return dire(r?.error ?? 'Historique indisponible.', false);
      extra.dataset.h = '1';
      extra.replaceChildren(el('b', {}, 'Derniers passages'), r.passages?.length ? el('ul', { class: 'au-h' }, ...r.passages.slice(0, 20).map((p) => el('li', {}, ...passage(p)))) : el('p', { class: 'sub', style: 'margin:0' }, 'Aucun passage gardé.'));
    }

    const boutons = [
      peut.lancer ? B('Lancer maintenant', lancer, { primary: true }) : null,
      peut.pause ? B(l.etat === 'pause' || l.etat === 'arret' ? (l.sorte === 'automatisation' ? 'Activer' : 'Reprendre') : (l.sorte === 'automatisation' ? 'Désactiver' : 'Pause'), pause) : null,
      peut.rythme && Array.isArray(l.reglable) && l.reglable.length ? B('Rythme', async () => rythme()) : null,
      peut.decaler ? B('Décaler', decaler) : null,
      peut.supprimer ? B('Supprimer', supprimer) : null,
      l.lien ? B('Ouvrir', async () => ouvrir(l.lien)) : null,
      B('Historique', historique),
    ];
    li.append(icone(l),
      el('div', { class: 'au-t' }, el('b', {}, l.nom), nomDe(l.appli) ? el('span', { class: 'au-ap' }, nomDe(l.appli)) : null, l.quoi ? el('p', {}, l.quoi) : null),
      el('div', { class: 'au-m' }, ...meta), el('div', { class: 'au-m' }, ...suivi), el('div', { class: 'au-b' }, ...boutons), res, extra);
    return li;
  }

  /** Une liste de lignes (sert aussi à l'onglet « Auto » de chaque appli). */
  const liste = (lignes, opts) => el('ul', { class: 'au-list' }, ...lignes.map((l) => ligne(l, opts)));

  const titreLien = (l) => (l.de === l.vers ? `${l.deNom} (sur elle-même)` : `${l.deNom} → ${l.versNom}`);
  /**
   * Un lien écrit entre applis. Les 21 liens à point unique (`coupable`) ont un interrupteur ; les autres restent en
   * lecture seule, avec la phrase de leur déclaration « coupure ».
   */
  function ligneLien(l) {
    style();
    const ic = el('span', { class: 'au-ic', 'aria-hidden': 'true' });
    if (window.OdinAppIcons) ic.innerHTML = window.OdinAppIcons.tile(l.de, l.deNom, 32); else ic.append(el('span', { class: 'au-odin' }, 'ᛟ'));
    const p = l.protege;
    return el('li', { class: 'au-l', 'data-id': l.id },
      ic,
      el('div', { class: 'au-t' }, el('b', {}, titreLien(l)), el('p', {}, phraseLien(l))),
      el('div', { class: 'au-m' },
        el('span', { class: 'pill' }, 'Lien entre applis'),
        l.coupe ? el('span', { class: 'pill bad' }, etatCoupe(l))
          : l.etat === 'actif' ? el('span', { class: 'pill good' }, 'Actif') : el('span', { class: 'pill warn', title: l.pourquoi || '' }, `Inactif${l.pourquoi ? ` (${l.pourquoi})` : ''}`),
        GENRES[l.genre] ? el('span', {}, GENRES[l.genre]) : null,
        p ? el('span', { class: 'pill warn' }, `Protège (${p.genre})`) : null),
      p ? el('p', { class: 'au-pr', style: 'margin:0' }, `Pourquoi : ${p.raison}.`) : null,
      l.coupable ? interrupteur(l)
        : phraseCoupure(l.coupure) ? el('p', { class: 'au-pr', style: 'margin:0' }, phraseCoupure(l.coupure)) : null);
  }

  /**
   * L'interrupteur d'un lien à point unique. Couper demande toujours ta confirmation (le texte vient d'Odin et cite,
   * pour un lien qui protège, ce qui ne sera plus fait) ; un lien qui protège se coupe pour une durée choisie (1 h par
   * défaut, 24 h au plus) et se rétablit seul. « Rétablir » : un geste, sans confirmation.
   */
  function interrupteur(l) {
    const box = el('div', { class: 'au-cp' });
    const res = el('div', { class: 'au-r', role: 'status' }), extra = el('div', { class: 'au-x' });
    const titre = titreLien(l), coupe = Boolean(l.coupe);
    const dire = (texte, ok) => res.replaceChildren(ok === false ? el('span', { class: 'pill bad' }, 'Refusé') : '', texte);
    const btn = (label, fn, o = {}) => el('button', { class: `btn small${o.primary ? ' primary' : ''}`, type: 'button', 'aria-label': `${label} : ${titre}`, onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } finally { b.disabled = false; } } }, label);
    async function envoyer(corps) {
      const route = '/api/draupnir/automatisme/pause';
      let r = await appel(route, corps);
      if (r && !r.ok && r.code === 'accord') {
        if (!(await window.OdinDialog.confirm(r.confirm ?? 'Confirmer ?', { danger: true, ok: 'Couper le lien' }))) { extra.replaceChildren(); return dire('Annulé : rien n\'a changé.'); }
        r = await appel(route, { ...corps, confirme: true });
      }
      if (!r) return dire('Odin ne répond pas, ou ne sait pas encore le faire.', false);
      if (!r.ok) return dire(r.error ?? 'Refusé.', false);
      const li = box.closest('li');
      if (r.lien && li) { const n = ligneLien(r.lien); li.replaceWith(n); n.querySelector('.au-sw')?.focus(); }
    }
    const retablir = () => envoyer({ id: l.id, pause: false });
    function couper() {
      if (!l.protege) return envoyer({ id: l.id, pause: true });
      const sid = `au-c-${l.id.replace(/[^\w-]/g, '_')}`;
      const choix = el('select', { id: sid }, ...[1, 2, 4, 8, 12, 24].map((h) => el('option', { value: String(h) }, h === 1 ? '1 heure' : `${h} heures`)));
      extra.replaceChildren(el('label', { for: sid }, 'Couper pendant combien de temps ? Il se rétablira tout seul.'), choix,
        el('div', { class: 'au-b' },
          btn('Couper', () => envoyer({ id: l.id, pause: true, jusqua: new Date(Date.now() + (Number(choix.value) || 1) * 3600_000).toISOString() }), { primary: true }),
          btn('Annuler', async () => { extra.replaceChildren(); })));
      choix.focus();
    }
    const sw = el('button', { type: 'button', class: 'au-sw', role: 'switch', 'aria-checked': String(!coupe), 'aria-label': `${titre} : lien ${coupe ? 'coupé' : 'actif'}`,
      onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await (coupe ? retablir() : couper()); } finally { b.disabled = false; } } },
    el('span', { class: 'au-sw-p', 'aria-hidden': 'true' }), coupe ? 'Lien coupé' : 'Lien actif');
    box.append(el('div', { class: 'au-b' }, sw, coupe ? btn('Rétablir', retablir, { primary: true }) : null), res, extra);
    return box;
  }

  /** Le bloc « Liens entre applis » : un groupe repliable par appli qui signale, et un filtre « Qui protègent ». */
  function blocLiens(liens) {
    let seul = false;
    const box = el('div', { class: 'au-ln' });
    const groupes = el('div', {});
    const puces = el('div', { class: 'au-f', role: 'group', 'aria-label': 'Filtrer les liens' });
    const nbP = liens.filter((l) => l.protege).length;
    const peindre = () => {
      puces.replaceChildren(
        el('button', { type: 'button', 'aria-pressed': String(!seul), onclick: () => { seul = false; peindre(); } }, 'Tous', el('small', {}, String(liens.length))),
        el('button', { type: 'button', 'aria-pressed': String(seul), onclick: () => { seul = true; peindre(); } }, 'Qui protègent', el('small', {}, String(nbP))));
      groupes.replaceChildren(...grouperLiens(liens, seul).map((g) => {
        const n = g.liens.length, np = g.liens.filter((l) => l.protege).length;
        return el('details', { class: 'au-g' },
          el('summary', {}, el('b', {}, g.deNom), el('small', {}, `${n} lien${n > 1 ? 's' : ''}${!seul && np ? ` · ${np} protège${np > 1 ? 'nt' : ''}` : ''}`)),
          el('ul', { class: 'au-list' }, ...g.liens.map(ligneLien)));
      }));
    };
    box.append(el('h3', {}, 'Liens entre applis'),
      el('p', { class: 'au-sub' }, `Écrits dans Odin : quand une appli signale quelque chose, une autre agit. Ils marchent seuls dès que leurs deux applis sont là. Ceux qui ont un interrupteur se coupent d'ici.`),
      puces, groupes);
    peindre();
    return box;
  }

  /** La section « Automatismes des applis » de Talos. Rien n'est montré quand Odin ne sait pas encore la remplir. */
  async function monter(box) {
    if (!box) return;
    style();
    const [r] = await Promise.all([appel('/api/draupnir/automatismes'), noms()]);
    if (!r || !r.ok || !Array.isArray(r.lignes)) { box.replaceChildren(); return; }
    let filtre = 'tout';
    const sec = el('section', { class: 'au-sec', 'aria-labelledby': 'auTitre' });
    const corps = el('div', {});
    const recharger = () => monter(box);
    const puces = el('div', { class: 'au-f', role: 'group', 'aria-label': 'Filtrer' });
    const liens = Array.isArray(r.liens) ? r.liens : [];
    const peindre = () => {
      puces.replaceChildren(...FILTRES.map((f) => { const n = f.id === 'liens' ? liens.length : filtrer(r.lignes, f.id).length; return f.id !== 'tout' && !n ? null : el('button', { type: 'button', 'aria-pressed': String(f.id === filtre), onclick: () => { filtre = f.id; peindre(); } }, f.label, el('small', {}, String(n))); }).filter(Boolean));
      const l = filtrer(r.lignes, filtre);
      // « Tout » : les lignes puis les liens écrits ; « Liens entre applis » : les liens seuls.
      const avecLiens = liens.length > 0 && (filtre === 'tout' || filtre === 'liens');
      corps.replaceChildren(...[
        filtre === 'liens' ? null : l.length ? liste(l, { recharger }) : el('p', { class: 'sub' }, 'Rien ici.'),
        avecLiens ? blocLiens(liens) : null,
      ].filter(Boolean));
    };
    // Une surveillance de sécurité en pause se voit tout de suite, en haut.
    const enPause = r.lignes.filter((l) => l.securite && l.etat === 'pause');
    sec.append(el('h2', { id: 'auTitre' }, 'Automatismes des applis'),
      el('p', { class: 'au-sub' }, `Tout ce qui tourne tout seul dans Odin${r.ville ? `, à l'heure de ${r.ville}` : ''}${r.fuseau ? ` (${r.fuseau})` : ''}.`),
      ...enPause.map((l) => el('p', { class: 'au-al', role: 'alert' }, `${nomDe(l.appli) || l.nom} : surveillance en pause${l.pauseJusqua ? ` jusqu'au ${quandCourt(l.pauseJusqua)}` : ''}.`)),
      puces, corps);
    peindre();
    box.replaceChildren(sec);
  }

  window.OdinAutomatismes = { monter, ligne, liste, noms, ouvrir, logique: { FILTRES, filtrer, duree, grouperLiens, phraseLien, phraseCoupure, etatCoupe } };
})();
