// La fenêtre Script d'Odin (appli « Archytas ») : tous les scripts et automatisations qu'Odin fabrique, avec leur
// trace datée. Trois onglets :
//   - Scripts : à gauche, la petite fenêtre latérale qui liste tous les NOMS (cliquables) ; à droite, le script
//     choisi (ce qu'il fait, ses déclencheurs, ses dates, son usage, et son contenu) avec un bouton « Éditer » pour
//     le modifier à la main. À l'enregistrement, Odin le range de partout (mémoire, Cerveau, Noûs) — côté serveur.
//   - Suivi : la vue 2D riche (OdinArchytasSuivi) — le plus utilisé, les récents, les anciens, utilisés / jamais.
//   - Graphe : le graphe 3D léger (OdinGraphe3D), avec repli 2D automatique sur une petite machine.
// La page ne connaît ni la base ni aucun serveur : elle n'appelle que les routes /api/archytas/* d'Odin (connexion
// exigée ; le code n'est servi qu'au propriétaire). Toute confirmation passe par OdinDialog. Lisible à 1280 px comme
// à 390 px. HONNÊTE : le code libre est une « barrière fortement renforcée, PAS une prison parfaite ».
// Chargée toute seule. window.OdinArchytas.logique (sans document) est vérifiée par test/archytas-page.test.ts.
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  if (window.OdinArchytas) return;

  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };

  // ---------------- Logique pure (sans document)

  const AVERT_CODE = 'Barrière fortement renforcée, PAS une prison parfaite. À n\'activer que pour du code que TU as relu.';
  const NOTE_NOUS = 'L\'apprentissage profond (Noûs) s\'activera quand son moteur sera branché ; pour l\'instant le script est relié à la mémoire et au Cerveau.';
  const NOTE_AMELIO = 'Une version améliorée ne remplace l\'ancienne que si elle garde le même comportement et passe les mêmes vérifications.';

  const dateCourte = (ts) => { if (!ts) return '—'; try { return new Date(ts).toLocaleString('fr', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };
  const duree = (ms) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
  const genreLabel = (g) => (g === 'code' ? 'Code libre' : 'Déclaratif');

  /** Le propriétaire reçoit le contenu du script ; un autre compte reçoit un résumé sans code ni étapes. */
  const peutEditer = (detail) => !!detail && (typeof detail.code === 'string' || Array.isArray(detail.etapes));

  /** Ce qu'on montre dans la visionneuse : le contenu pour le propriétaire, sinon un message clair. */
  function apercu(detail) {
    if (!detail) return { montre: false, texte: '' };
    const aCode = typeof detail.code === 'string';
    const aEtapes = Array.isArray(detail.etapes);
    if (!aCode && !aEtapes) return { montre: false, texte: 'Le contenu du script n\'est montré qu\'au propriétaire d\'Odin.' };
    if (detail.genre === 'code' && aCode) return { montre: true, genre: 'code', texte: detail.code };
    if (aEtapes) return { montre: true, genre: 'declaratif', etapes: detail.etapes };
    return { montre: true, genre: 'code', texte: aCode ? detail.code : '' };
  }

  function declencheurTexte(d) {
    if (!d || typeof d !== 'object') return '';
    if (d.genre === 'manuel') return 'à la main';
    if (d.genre === 'horaire') return `horaire (${d.rythme || '?'})`;
    if (d.genre === 'evenement') return `sur événement ${d.module || '?'} · ${d.type || '?'}`;
    return String(d.genre || '?');
  }

  function etapeTexte(e, prof = 0) {
    const pad = '  '.repeat(prof);
    if (!e || typeof e !== 'object') return `${pad}• ?`;
    if (e.faire === 'action') return `${pad}• ${e.module || '?'} → ${e.action || '?'}${e.entree ? ' ' + JSON.stringify(e.entree) : ''}`;
    if (e.faire === 'poser') return `${pad}• poser ${e.variable || '?'} = ${e.valeur ?? ''}`;
    if (e.faire === 'si') return [`${pad}• si ${e.cond || '?'}`, ...(Array.isArray(e.alors) ? e.alors : []).map((x) => etapeTexte(x, prof + 1)), ...(Array.isArray(e.sinon) && e.sinon.length ? [`${pad}  sinon`, ...e.sinon.map((x) => etapeTexte(x, prof + 1))] : [])].join('\n');
    return `${pad}• ${JSON.stringify(e)}`;
  }
  const etapesTexte = (etapes) => (Array.isArray(etapes) ? etapes.map((e) => etapeTexte(e)).join('\n') : '');

  const logique = { dateCourte, duree, genreLabel, peutEditer, apercu, declencheurTexte, etapeTexte, etapesTexte, AVERT_CODE, NOTE_NOUS, NOTE_AMELIO };

  // ---------------- Réseau (routes /api/archytas/*)

  async function demander(chemin, corps) {
    try {
      const r = await fetch(`/api/archytas${chemin}`, corps
        ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(corps) }
        : { headers: { 'x-odin': '1' } });
      const j = await r.json().catch(() => null);
      return { status: r.status, ok: r.ok, j };
    } catch { return { status: 0, ok: false, j: null }; }
  }

  // ---------------- Dessin

  const CSS = `
.ar{display:flex;flex-direction:column;gap:12px;min-width:0;color:var(--ink)}
.ar *{box-sizing:border-box}
.ar-intro{font-size:13px;color:var(--muted);line-height:1.5}
.ar-tabs{display:inline-flex;gap:4px;padding:4px;border-radius:12px;background:var(--panel2,color-mix(in srgb,var(--ink) 6%,transparent));border:1px solid var(--line);flex-wrap:wrap;align-self:flex-start}
.ar-tabs button{font:600 13px inherit;padding:7px 14px;min-height:36px;border-radius:9px;color:var(--muted);background:none;border:0;cursor:pointer}
.ar-tabs button[aria-selected=true]{background:var(--panel);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.ar-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ar-b{min-height:38px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:0 14px;font:600 13px inherit;cursor:pointer}
.ar-b.prim{background:var(--accent,#6b8afd);border-color:transparent;color:var(--on-accent,#fff)}
.ar-b.dan{color:var(--bad,#e05555);border-color:color-mix(in srgb,var(--bad,#e05555) 40%,var(--line))}
.ar-b:disabled{opacity:.5;cursor:default}
.ar-split{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
.ar-aside{flex:1 1 170px;min-width:160px;max-width:260px;border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:8px;align-self:stretch}
.ar-aside input{width:100%;min-height:36px;border-radius:9px;border:1px solid var(--line);background:var(--field,var(--panel2));color:var(--ink);padding:0 10px;font:inherit;font-size:13px;margin-bottom:6px}
.ar-aside h3{margin:2px 4px 6px;font:600 11.5px inherit;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.ar-noms{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;max-height:52vh;overflow:auto}
.ar-noms button{display:flex;flex-direction:column;gap:1px;width:100%;text-align:left;border:0;background:none;color:var(--ink);font:inherit;padding:6px 8px;border-radius:8px;cursor:pointer;min-height:40px}
.ar-noms button:hover,.ar-noms button:focus-visible{background:var(--hover,color-mix(in srgb,var(--ink) 8%,transparent));outline:none}
.ar-noms button[aria-current=true]{background:color-mix(in srgb,var(--accent,#6b8afd) 16%,transparent)}
.ar-noms b{font-size:13.5px;overflow-wrap:anywhere}
.ar-noms small{color:var(--muted);font-size:11.5px;overflow-wrap:anywhere}
.ar-main{flex:3 1 280px;min-width:260px;border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:14px;min-height:160px}
.ar-main h2{margin:0 0 2px;font:700 18px inherit;overflow-wrap:anywhere}
.ar-tag{display:inline-block;font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:1px 7px;margin-left:8px;vertical-align:middle}
.ar-desc{color:var(--muted);font-size:13.5px;margin:6px 0 10px;overflow-wrap:anywhere}
.ar-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:0 0 10px}
.ar-grid div{border:1px solid var(--line);border-radius:10px;padding:7px 10px;font-size:12px;color:var(--muted)}
.ar-grid b{display:block;font-size:14px;color:var(--ink);font-variant-numeric:tabular-nums}
.ar-trace{font-size:12.5px;color:var(--muted);margin:0 0 10px;overflow-wrap:anywhere}
.ar-code{white-space:pre-wrap;font:12.5px/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--field,color-mix(in srgb,var(--ink) 7%,transparent));border:1px solid var(--line);border-radius:10px;padding:10px;overflow:auto;max-height:46vh;overflow-wrap:anywhere}
.ar-ed textarea{width:100%;min-height:200px;border-radius:10px;border:1px solid var(--line);background:var(--field,var(--panel2));color:var(--ink);padding:10px;font:12.5px/1.5 ui-monospace,Menlo,Consolas,monospace;resize:vertical}
.ar-ed label{display:block;font-size:12px;color:var(--muted);margin:8px 0 3px}
.ar-ed input{width:100%;min-height:38px;border-radius:9px;border:1px solid var(--line);background:var(--field,var(--panel2));color:var(--ink);padding:0 10px;font:inherit;font-size:13px}
.ar-warn{font-size:12px;color:var(--warn,#c98a2a);background:color-mix(in srgb,var(--warn,#c98a2a) 10%,transparent);border:1px solid color-mix(in srgb,var(--warn,#c98a2a) 30%,transparent);border-radius:9px;padding:7px 10px;margin:8px 0}
.ar-note{font-size:12px;color:var(--muted);font-style:italic;margin-top:10px}
.ar-st{font-size:13px;color:var(--muted);min-height:18px;margin-top:8px}
.ar-st.ko{color:var(--bad,#e05555)}
.ar-vide{color:var(--muted);font-size:14px}
.ar-propo{border:1px solid color-mix(in srgb,var(--accent,#6b8afd) 40%,var(--line));border-radius:10px;padding:10px 12px;margin-top:10px;background:color-mix(in srgb,var(--accent,#6b8afd) 7%,transparent)}
.ar-propo b{display:block;margin-bottom:4px}
`;
  function style() { if (!document.getElementById('ar-css')) document.head.append(el('style', { id: 'ar-css' }, CSS)); }

  function ligneUsage(s) {
    const st = (s && s.stat) || {};
    const runs = Number(st.runs) || 0;
    return runs > 0 ? `${runs} usage${runs > 1 ? 's' : ''} · ${Math.round(((Number(st.ok) || 0) / runs) * 100)} % ok` : 'jamais lancé';
  }

  // ---------------- Le pilote (testable sans simuler des clics)

  function monter(host, ctx = {}) {
    style();
    const etat = { scripts: [], selection: null, detail: null, proprietaire: false, onglet: 'scripts', editeur: false, chargement: false };
    const direToast = typeof ctx.toast === 'function' ? ctx.toast : () => {};

    const intro = el('p', { class: 'ar-intro' }, 'Les scripts qu\'Odin fabrique, avec leur trace datée. Ils sont rangés dans sa base, et reliés à sa mémoire et à son Cerveau. ', el('span', { class: 'ar-sub' }));
    const tabs = el('div', { class: 'ar-tabs', role: 'tablist', 'aria-label': 'Vues des scripts' });
    const corps = el('div', { class: 'ar-corps' });
    const racine = el('div', { class: 'ar' }, intro, tabs, corps);
    host.replaceChildren(racine);

    const ONGLETS = [['scripts', 'Scripts'], ['suivi', 'Suivi'], ['graphe', 'Graphe 3D']];
    function peindreTabs() {
      tabs.replaceChildren(...ONGLETS.map(([id, lab]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(etat.onglet === id), onclick: () => onglet(id) }, lab)));
    }

    // ----- Onglet Scripts (maître-détail)
    function peindreScripts() {
      const q = (etat.recherche || '').trim().toLowerCase();
      const noms = etat.scripts.filter((s) => !q || s.nom.toLowerCase().includes(q) || (s.mission || '').toLowerCase().includes(q));
      const aside = el('aside', { class: 'ar-aside' },
        el('input', { type: 'search', 'aria-label': 'Chercher un script', placeholder: 'Chercher…', value: etat.recherche || '', oninput: (e) => { etat.recherche = e.target.value; peindre(); } }),
        el('h3', {}, `Scripts (${etat.scripts.length})`),
        noms.length
          ? el('ul', { class: 'ar-noms' }, ...noms.map((s) => el('li', {}, el('button', { type: 'button', 'aria-current': String(etat.selection === s.nom), onclick: () => choisir(s.nom) }, el('b', {}, s.nom), el('small', {}, `${s.mission || 'sans mission'} · ${ligneUsage(s)}`)))))
          : el('p', { class: 'ar-vide', style: 'padding:6px' }, 'Aucun script.'));

      const main = el('div', { class: 'ar-main' });
      main.append(viseur());
      const split = el('div', { class: 'ar-split' }, aside, main);
      const barre = el('div', { class: 'ar-bar' },
        etat.proprietaire || !etat.scripts.length ? el('button', { class: 'ar-b prim', type: 'button', onclick: creer }, 'Créer un script') : null);
      corps.replaceChildren(el('div', {}, barre, split));
    }

    function viseur() {
      if (etat.chargement && !etat.detail) return el('p', { class: 'ar-vide' }, 'Chargement…');
      if (!etat.selection) return el('p', { class: 'ar-vide' }, etat.scripts.length ? 'Choisis un script à gauche pour voir ce qu\'il fait.' : 'Aucun script pour l\'instant. Odin en fabrique au fil de ses automatisations.');
      const d = etat.detail;
      if (!d) return el('p', { class: 'ar-vide' }, 'Script introuvable.');
      if (etat.editeur) return editeur(d);
      const ap = apercu(d);
      const stat = d.stat || {};
      const decls = (Array.isArray(d.declencheurs) ? d.declencheurs : []).map(declencheurTexte).filter(Boolean).join(' · ') || 'à la main';
      return el('div', {},
        el('div', { class: 'ar-bar', style: 'justify-content:space-between' },
          el('h2', {}, d.nom, el('span', { class: 'ar-tag' }, genreLabel(d.genre)), d.actif === false ? el('span', { class: 'ar-tag' }, 'en pause') : null),
          el('div', { class: 'ar-bar' },
            el('button', { class: 'ar-b', type: 'button', onclick: lancer }, 'Lancer'),
            peutEditer(d) ? el('button', { class: 'ar-b', type: 'button', onclick: ouvrirEditeur }, 'Éditer') : null,
            peutEditer(d) ? el('button', { class: 'ar-b dan', type: 'button', onclick: supprimer }, 'Supprimer') : null)),
        el('p', { class: 'ar-desc' }, d.mission ? `${d.mission}. ` : '', d.description || ''),
        el('div', { class: 'ar-grid' },
          el('div', {}, el('b', {}, String(stat.runs || 0)), 'exécutions'),
          el('div', {}, el('b', {}, stat.runs ? `${Math.round(((stat.ok || 0) / stat.runs) * 100)} %` : '—'), 'réussite'),
          el('div', {}, el('b', {}, duree(stat.msMoyen)), 'temps moyen'),
          el('div', {}, el('b', {}, `v${d.version || 1}`), 'version')),
        el('p', { class: 'ar-trace' }, `Déclencheurs : ${decls}. Créé le ${dateCourte(d.cree)} · modifié le ${dateCourte(d.modifie)} · dernier usage ${dateCourte(d.dernierUsage)}.`),
        ap.montre
          ? (ap.genre === 'code'
            ? el('div', {}, el('div', { class: 'ar-warn' }, AVERT_CODE), el('pre', { class: 'ar-code' }, ap.texte || '(vide)'))
            : el('pre', { class: 'ar-code' }, etapesTexte(ap.etapes) || '(aucune étape)'))
          : el('p', { class: 'ar-vide' }, ap.texte),
        etat.proprietaire ? el('button', { class: 'ar-b', type: 'button', style: 'margin-top:10px', onclick: proposer }, 'Proposer une amélioration') : null,
        el('div', { class: 'ar-propo-zone' }),
        el('p', { class: 'ar-note' }, NOTE_NOUS),
        el('p', { class: 'ar-st', role: 'status' }, etat.statut || ''));
    }

    function editeur(d) {
      const estCode = d.genre === 'code';
      const champMission = el('input', { type: 'text', value: d.mission || '', 'aria-label': 'Mission' });
      const champDesc = el('input', { type: 'text', value: d.description || '', 'aria-label': 'Description' });
      const contenu = estCode ? (d.code || '') : JSON.stringify(Array.isArray(d.etapes) ? d.etapes : [], null, 2);
      const champContenu = el('textarea', { 'aria-label': estCode ? 'Code du script' : 'Étapes (JSON)', spellcheck: 'false' }, contenu);
      const st = el('p', { class: 'ar-st', role: 'status' });
      const enregistrer = async () => {
        const patch = { mission: champMission.value.trim(), description: champDesc.value.trim() };
        if (estCode) patch.code = champContenu.value;
        else {
          let etapes; try { etapes = JSON.parse(champContenu.value || '[]'); } catch { st.textContent = 'Les étapes ne sont pas un JSON valide : rien n\'est enregistré.'; st.classList.add('ko'); return; }
          if (!Array.isArray(etapes)) { st.textContent = 'Les étapes doivent être une liste.'; st.classList.add('ko'); return; }
          patch.etapes = etapes;
        }
        await ctrl.enregistrer(patch, st);
      };
      return el('div', { class: 'ar-ed' },
        el('div', { class: 'ar-bar', style: 'justify-content:space-between' }, el('h2', {}, `Éditer « ${d.nom} »`), el('span', { class: 'ar-tag' }, genreLabel(d.genre))),
        estCode ? el('div', { class: 'ar-warn' }, AVERT_CODE) : null,
        el('label', {}, 'Mission'), champMission,
        el('label', {}, 'Description'), champDesc,
        el('label', {}, estCode ? 'Code' : 'Étapes (JSON)'), champContenu,
        el('p', { class: 'ar-note' }, 'En enregistrant, Odin range le script de partout : sa base, sa mémoire et son Cerveau. Une trace datée est gardée.'),
        el('div', { class: 'ar-bar', style: 'margin-top:8px' },
          el('button', { class: 'ar-b prim', type: 'button', onclick: enregistrer }, 'Enregistrer partout'),
          el('button', { class: 'ar-b', type: 'button', onclick: () => fermerEditeur() }, 'Annuler')),
        st);
    }

    function peindre() {
      peindreTabs();
      if (etat.onglet === 'scripts') { peindreScripts(); return; }
      if (etat.onglet === 'suivi') { rendreSuivi(); return; }
      if (etat.onglet === 'graphe') { rendreGraphe(); return; }
    }

    function rendreSuivi() {
      if (window.OdinArchytasSuivi) window.OdinArchytasSuivi.rendre(corps, etat.scripts, { onOuvrir: (nom) => { etat.onglet = 'scripts'; choisir(nom); } });
      else corps.replaceChildren(el('p', { class: 'ar-vide' }, 'Suivi indisponible.'));
    }

    async function rendreGraphe() {
      corps.replaceChildren(el('p', { class: 'ar-vide' }, 'Chargement du graphe…'));
      const r = await demander('/graphe');
      const data = r.j && Array.isArray(r.j.nodes) ? r.j : { nodes: etat.scripts.map(versNoeud), edges: [] };
      const boite = el('div');
      corps.replaceChildren(boite);
      if (!window.OdinGraphe3D) { replierSuivi(); return; }
      grapheCtrl = window.OdinGraphe3D.mount(boite, data, {
        onOpen: (nom) => { etat.onglet = 'scripts'; choisir(nom); },
        onReplier: () => replierSuivi(),
      });
    }
    function replierSuivi() {
      if (window.OdinArchytasSuivi) { const avis = el('p', { class: 'ar-note', style: 'margin:0 0 8px' }, 'Vue 3D trop lourde pour cette machine : voici la vue 2D riche.'); const zone = el('div'); corps.replaceChildren(el('div', {}, avis, zone)); window.OdinArchytasSuivi.rendre(zone, etat.scripts, { onOuvrir: (nom) => { etat.onglet = 'scripts'; choisir(nom); } }); }
      else corps.replaceChildren(el('p', { class: 'ar-vide' }, 'Graphe indisponible.'));
    }
    const versNoeud = (s) => { const st = s.stat || {}; const runs = Number(st.runs) || 0; const age = s.dernierUsage || s.modifie || s.cree || 0; return { id: s.nom, label: s.nom, sub: s.mission || '', usage: Math.min(1, runs / 20), frais: age ? Math.max(0, Math.min(1, 1 - (Date.now() - age) / (90 * 864e5))) : 0 }; };

    // ----- Actions
    let grapheCtrl = null;
    function onglet(id) { if (etat.onglet === id) return; if (grapheCtrl) { try { grapheCtrl.detacher(); } catch { /* rien */ } grapheCtrl = null; } etat.onglet = id; etat.editeur = false; peindre(); }

    async function recharger() {
      etat.chargement = true;
      const r = await demander('/scripts');
      etat.scripts = (r.j && Array.isArray(r.j.scripts)) ? r.j.scripts : [];
      etat.chargement = false;
      // Établir le propriétaire discrètement à partir d'un détail (le code n'est servi qu'à lui).
      if (etat.selection && etat.scripts.some((s) => s.nom === etat.selection)) await chargerDetail(etat.selection);
      else if (!etat.detail && etat.scripts.length && etat.proprietaire === false) await sonderProprietaire();
      peindre();
      return etat.scripts;
    }
    async function sonderProprietaire() {
      const r = await demander(`/script?nom=${encodeURIComponent(etat.scripts[0].nom)}`);
      if (r.j) etat.proprietaire = peutEditer(r.j);
    }
    async function chargerDetail(nom) {
      const r = await demander(`/script?nom=${encodeURIComponent(nom)}`);
      etat.detail = r.j || null;
      if (etat.detail) etat.proprietaire = etat.proprietaire || peutEditer(etat.detail);
    }
    async function choisir(nom) {
      etat.selection = nom; etat.editeur = false; etat.statut = ''; etat.chargement = true;
      if (etat.onglet !== 'scripts') etat.onglet = 'scripts';
      peindre();
      await chargerDetail(nom);
      etat.chargement = false;
      peindre();
      return etat.detail;
    }
    function ouvrirEditeur() { if (!peutEditer(etat.detail)) return; etat.editeur = true; peindre(); }
    function fermerEditeur() { etat.editeur = false; peindre(); }

    async function enregistrer(patch, st) {
      const nom = etat.selection;
      const r = await demander('/editer', { nom, patch });
      if (!r.ok || !r.j) { const m = (r.j && r.j.error) || (r.status === 403 ? 'Réservé au propriétaire d\'Odin.' : 'Enregistrement refusé.'); if (st) { st.textContent = m; st.classList.add('ko'); } direToast(m); return false; }
      etat.editeur = false; etat.statut = `Enregistré partout le ${dateCourte(Date.now())} : base, mémoire, Cerveau.`;
      await recharger(); await chargerDetail(nom); peindre();
      direToast('Script enregistré partout.');
      return true;
    }

    async function creer() {
      const nom = await (window.OdinDialog ? window.OdinDialog.prompt('Nom du nouveau script (tiré de sa mission) :', '') : Promise.resolve(null));
      if (!nom) return;
      const mission = await (window.OdinDialog ? window.OdinDialog.prompt('Que doit faire ce script (sa mission) ?', '') : Promise.resolve(''));
      const r = await demander('/creer', { nom: String(nom).trim(), mission: String(mission || '').trim(), description: '', genre: 'declaratif', etapes: [], declencheurs: [{ genre: 'manuel' }] });
      if (!r.ok || !r.j) { direToast((r.j && r.j.error) || (r.status === 403 ? 'Réservé au propriétaire d\'Odin.' : 'Création refusée.')); return; }
      etat.proprietaire = true;
      await recharger(); await choisir(r.j.nom);
    }

    async function supprimer() {
      const nom = etat.selection;
      const oui = window.OdinDialog ? await window.OdinDialog.confirm(`Supprimer le script « ${nom} » ? Son historique de versions part aussi. Cette action est définitive.`, { danger: true }) : false;
      if (!oui) return;
      const r = await demander('/supprimer', { nom });
      if (!r.ok) { direToast((r.j && r.j.error) || 'Suppression refusée.'); return; }
      etat.selection = null; etat.detail = null;
      await recharger();
      direToast('Script supprimé partout.');
    }

    async function lancer() {
      etat.statut = 'Lancement…'; peindre();
      const r = await demander('/lancer', { nom: etat.selection });
      etat.statut = r.j && typeof r.j.texte === 'string' ? `${r.j.ok ? '✓' : '✗'} ${r.j.texte}${r.j.ms != null ? ` (${duree(r.j.ms)})` : ''}` : 'Odin n\'a pas pu lancer le script.';
      await recharger(); await chargerDetail(etat.selection); peindre();
    }

    async function proposer() {
      etat.statut = 'Odin réfléchit à une amélioration…'; peindre();
      const r = await demander(`/amelioration?nom=${encodeURIComponent(etat.selection)}`);
      const zone = corps.querySelector ? corps.querySelector('.ar-propo-zone') : null;
      if (!r.j || !r.j.nom) { etat.statut = 'Aucune amélioration proposée pour l\'instant.'; peindre(); return; }
      etat.statut = '';
      const p = r.j;
      const carte = el('div', { class: 'ar-propo' }, el('b', {}, p.nom || 'Proposition'), el('p', { style: 'margin:0 0 6px' }, p.pourquoi || ''), p.apercuChange ? el('pre', { class: 'ar-code' }, p.apercuChange) : null,
        el('p', { class: 'ar-note', style: 'margin:6px 0' }, NOTE_AMELIO),
        el('div', { class: 'ar-bar' }, el('button', { class: 'ar-b prim', type: 'button', onclick: () => appliquer() }, 'Appliquer'), el('button', { class: 'ar-b', type: 'button', onclick: () => peindre() }, 'Garder l\'ancienne')));
      if (zone) zone.replaceChildren(carte); else peindre();
    }
    async function appliquer() {
      const oui = window.OdinDialog ? await window.OdinDialog.confirm('Appliquer la version améliorée ? L\'ancienne est gardée ; tu pourras revenir en arrière.', {}) : true;
      if (!oui) return;
      const r = await demander('/amelioration', { nom: etat.selection, accord: true });
      if (!r.ok) { direToast((r.j && r.j.error) || 'Amélioration refusée.'); return; }
      etat.statut = 'Version améliorée appliquée. L\'ancienne reste disponible.';
      await recharger(); await chargerDetail(etat.selection); peindre();
    }

    const ctrl = { etat, recharger, choisir, ouvrirEditeur, fermerEditeur, enregistrer, onglet, creer, supprimer, lancer, logique };
    peindre();
    recharger();
    return ctrl;
  }

  window.OdinArchytas = { monter, logique };
  window.OdinPages.archytas = async ({ host, toast }) => { monter(host, { toast }); return true; };
})();
