// La page de Noûs, le cerveau profond du Cerveau (voir src/brain/nous/ et docs/cerveau-deux-etages.md).
// Elle montre HONNÊTEMENT : la taille réelle du réseau, ce qu'il a lu, sa courbe d'apprentissage, les trois
// étapes et leur avancement, le score des duels, les niveaux, la calibration, les habitudes, le coût, et sa
// place sur la carte. On peut l'essayer (« complète »/« réponds »), le mettre en pause et régler ses plafonds.
// Chargée toute seule par src/web/brain.js ; toute boîte de dialogue passe par window.OdinDialog.
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const api = async (path, body) => {
    try {
      const r = await fetch(`/api/brain/nous${path}`, body
        ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) }
        : { headers: { 'x-odin': '1' } });
      return await r.json();
    } catch { return { ok: false, text: 'Noûs ne répond pas.' }; }
  };
  const pct = (x) => `${Math.round((x || 0) * 100)} %`;
  const ms = (x) => `${Math.round(x || 0)} ms`;

  const CSS = `
.no{display:flex;flex-direction:column;gap:14px;min-width:0}
.no-intro{font-size:13.5px;color:var(--muted);line-height:1.5}
.no-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.no-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:12px 14px;min-width:0}
.no-card h3{margin:0 0 8px;font:600 13.5px inherit;color:var(--ink)}
.no-big{font:700 24px inherit;color:var(--ink)}
.no-sub{font-size:12.5px;color:var(--muted)}
.no-row{display:flex;justify-content:space-between;gap:8px;font-size:13px;padding:3px 0}
.no-row b{color:var(--ink)}
.no-bar{height:8px;border-radius:5px;background:var(--panel2);overflow:hidden;margin:6px 0}
.no-bar>span{display:block;height:100%;background:var(--ink)}
.no-essai{display:flex;flex-direction:column;gap:8px}
.no-essai textarea{min-height:60px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);padding:8px;font:inherit;font-size:13px}
.no-essai .bar{display:flex;gap:6px;flex-wrap:wrap}
.no-essai button,.no-bar2 button{min-height:38px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:0 12px;font:600 13px inherit;cursor:pointer}
.no-out{white-space:pre-wrap;font-size:13px;border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--panel2);min-height:24px}
.no-warn{font-size:12.5px;color:var(--muted);font-style:italic}
.no-list{display:flex;flex-direction:column;gap:6px}
.no-tag{display:inline-block;font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:1px 6px;margin-left:6px}
.no-spark{display:flex;align-items:flex-end;gap:2px;height:40px}
.no-spark>span{flex:1 1 0;background:var(--ink);border-radius:2px 2px 0 0;min-height:2px}
`;

  function style() { if (!document.getElementById('no-css')) document.head.append(el('style', { id: 'no-css' }, CSS)); }

  function carte(titre, ...kids) { return el('div', { class: 'no-card' }, el('h3', {}, titre), ...kids); }
  function ligne(k, v) { return el('div', { class: 'no-row' }, el('span', {}, k), el('b', {}, v)); }

  // Répartition réelle (part du travail) — jamais un poids forcé, une mesure.
  function carteTravail(t) {
    const p = t && t.tenus > 0 ? t.profond : 0;
    return carte('Répartition réelle',
      el('div', { class: 'no-big' }, t && t.tenus > 0 ? `réel ${p} / ${100 - p}` : 'pas encore de mesure'),
      el('div', { class: 'no-bar' }, el('span', { style: `width:${p}%` })),
      el('div', { class: 'no-sub' }, 'cible 80 / 20 — image inspirée du cerveau, pas une mesure du cerveau humain'),
    );
  }

  function carteTaille(ta) {
    const poids = ta && ta.poids ? ta.poids.toLocaleString('fr') : '—';
    return carte('Taille réelle',
      el('div', { class: 'no-big' }, `${poids} poids`),
      el('div', { class: 'no-sub' }, `vocabulaire ${ta?.vocab ?? 4096}, contexte ${ta?.contexte ?? 128} morceaux`),
      el('p', { class: 'no-warn', style: 'margin:8px 0 0' }, 'Noûs n\'égale pas un grand modèle : il apprend la langue, trie, reconnaît, propose, et s\'améliore à chaque duel.'),
    );
  }

  function carteLu(lu) {
    const sources = (lu?.parSource || []).slice(0, 6);
    return carte('Ce qu\'il a lu',
      ligne('En tout', (lu?.total ?? 0).toLocaleString('fr') + ' morceaux'),
      ligne('Cette semaine', (lu?.semaine ?? 0).toLocaleString('fr')),
      ...sources.map((s) => ligne(s.source, (s.n ?? 0).toLocaleString('fr'))),
    );
  }

  function carteCourbe(courbe) {
    const pts = (courbe || []).slice(-30);
    const max = Math.max(1e-9, ...pts.map((p) => p.perte || 0));
    return carte('Courbe d\'apprentissage',
      pts.length
        ? el('div', { class: 'no-spark' }, ...pts.map((p) => el('span', { style: `height:${Math.max(2, Math.round(100 * (p.perte || 0) / max))}%`, title: `perte ${(p.perte || 0).toFixed(3)}` })))
        : el('div', { class: 'no-sub' }, 'La courbe apparaîtra après la première nuit d\'entraînement.'),
      el('div', { class: 'no-sub' }, 'perte sur le jeu tenu à part, par nuit'),
    );
  }

  function carteEtapes(e) {
    const etat = (x) => (x ? `fait ${Math.round((x.avancement || 0) * 100)} %` : 'en attente');
    return carte('Les trois étapes',
      ligne('1 · Pré-entraînement', etat(e?.etape1)),
      ligne('2 · Ajustement', etat(e?.etape2)),
      ligne('3 · Alignement', etat(e?.etape3)),
      el('p', { class: 'no-warn', style: 'margin:8px 0 0' }, 'Au début, Noûs perd presque tous les duels. C\'est normal, c\'est ainsi qu\'il apprend.'),
    );
  }

  function carteDuels(d) {
    const joues = d?.joues ?? 0;
    return carte('Duels',
      ligne('Joués', String(joues)),
      ligne('Gagnés par Noûs', String(d?.gagnes ?? 0)),
      ligne('Égalités', String(d?.egalites ?? 0)),
      ligne('Joués après coup', String(d?.apres ?? 0)),
      el('div', { class: 'no-bar' }, el('span', { style: `width:${joues ? Math.round(100 * (d.gagnes || 0) / Math.max(1, joues - (d.egalites || 0))) : 0}%` })),
    );
  }

  function carteNiveaux(n) {
    return carte('Niveaux',
      ligne('N1 réflexe', `${n?.n1 ?? 0} · justesse ${pct(n?.justesse?.[0])}`),
      ligne('N2 vérifié', `${n?.n2 ?? 0} · justesse ${pct(n?.justesse?.[1])}`),
      ligne('N3 réfléchi', `${n?.n3 ?? 0} · justesse ${pct(n?.justesse?.[2])}`),
      el('p', { class: 'no-warn', style: 'margin:8px 0 0' }, 'Sur un sujet sensible, seul Odin répond et agit ; Noûs ne propose que du texte.'),
    );
  }

  function carteCalibration(c) {
    return carte('Calibration',
      ligne('Écart de calibration', (c?.ece ?? 0).toFixed(3)),
      ligne('Score de Brier', (c?.brier ?? 0).toFixed(3)),
      el('div', { class: 'no-sub' }, 'Un Noûs mal calibré perd la main — et c\'est affiché.'),
    );
  }

  function carteCout(c) {
    return carte('Coût',
      ligne('Temps ajouté (médiane)', ms(c?.medianeMs)),
      ligne('Temps ajouté (p95)', ms(c?.p95Ms)),
      ligne('Calcul du profond', ms(c?.profondMoyenMs)),
    );
  }

  function carteHabitudes(h) {
    const list = (h || []).slice(0, 8);
    return carte('Habitudes',
      list.length
        ? el('div', { class: 'no-list' }, ...list.map((x) => el('div', { class: 'no-row' }, el('span', {}, x.nom || x.phrase || 'habitude'), el('span', { class: 'no-tag' }, `${x.etat || 'proposée'} · vue ${x.occurrences ?? x.uses ?? 0} fois`))))
        : el('div', { class: 'no-sub' }, 'Aucune habitude proposée pour l\'instant.'),
    );
  }

  function carteCarte(m) {
    const liens = (m?.liens || []).slice(0, 8);
    return carte('Sur la carte du Cerveau',
      el('div', { class: 'no-sub' }, 'Le nœud « Noûs » et ses liens vers les sujets : la force monte quand il gagne.'),
      ...liens.map((l) => ligne(l.sujet || l.nom || '—', (l.force ?? 0).toFixed(2))),
    );
  }

  // Essai direct : « complète » (étape 1) ou « réponds » (proposition).
  function carteEssai() {
    const zone = el('textarea', { 'aria-label': 'Texte à donner à Noûs', placeholder: 'Écris un début de phrase ou une question…' });
    const sortie = el('div', { class: 'no-out', role: 'status' }, '—');
    const lancer = async (quoi) => {
      const texte = zone.value.trim();
      if (!texte) return;
      sortie.textContent = '…';
      const r = await api('/essai', { quoi, texte });
      sortie.textContent = r && r.ok ? (r.texte ?? '(vide)') : (r?.text || 'Noûs n\'est pas prêt.');
    };
    return carte('Essayer Noûs',
      el('div', { class: 'no-essai' }, zone,
        el('div', { class: 'bar' },
          el('button', { type: 'button', onclick: () => lancer('complete') }, 'Complète'),
          el('button', { type: 'button', onclick: () => lancer('repond') }, 'Réponds'),
        ), sortie),
    );
  }

  function barreHaut(etat, onChange) {
    const actif = etat?.actif !== false;
    const pause = el('button', { type: 'button', onclick: async () => { const r = await api('/pause', { actif: !actif }); if (r && r.ok) onChange(); } }, actif ? 'Mettre en pause' : 'Reprendre');
    const reglages = el('button', { type: 'button', onclick: async () => reglerPlafonds(etat, onChange) }, 'Réglages');
    return el('div', { class: 'no-bar2', style: 'display:flex;gap:8px;flex-wrap:wrap' }, pause, reglages,
      el('span', { class: 'no-sub', style: 'margin-left:auto;align-self:center' }, actif ? 'Noûs apprend et propose.' : 'Noûs est en pause.'));
  }

  async function reglerPlafonds(etat, onChange) {
    const r = etat?.reglages || {};
    const txt = await window.OdinDialog.prompt('Plafonds (heures de nuit, fils de nuit, disque Mo) séparés par des espaces :', `${r.heuresNuit ?? 8} ${r.filsNuit ?? 3} ${r.disqueMaxMo ?? 2000}`);
    if (txt == null) return;
    const [heuresNuit, filsNuit, disqueMaxMo] = txt.split(/\s+/).map(Number);
    const rep = await api('/reglages', { heuresNuit, filsNuit, disqueMaxMo });
    if (rep && rep.ok) onChange();
  }

  async function rendre(conteneur) {
    style();
    conteneur.replaceChildren(el('div', { class: 'no-sub' }, 'Chargement de Noûs…'));
    const etat = await api('/etat');
    const racine = el('div', { class: 'no' });
    racine.append(
      el('p', { class: 'no-intro' }, 'Noûs est un petit réseau de neurones entraîné sur cette machine. Il est le cerveau profond du Cerveau : il reconnaît, trie, propose et fournit les plongements. Le Cerveau d\'Odin garde le dernier mot.'),
      barreHaut(etat, () => rendre(conteneur)),
    );
    if (!etat || etat.ok === false) {
      racine.append(el('div', { class: 'no-card' }, el('p', { class: 'no-warn' }, 'Noûs n\'est pas encore prêt (aucun point de reprise en service). Il démarre dès que l\'entraînement a produit un premier réseau valable.')));
      conteneur.replaceChildren(racine);
      return;
    }
    const grille = el('div', { class: 'no-grid' },
      carteTravail(etat.travail), carteTaille(etat.taille), carteLu(etat.lu),
      carteCourbe(etat.courbe), carteEtapes(etat.etapes), carteEssai(),
      carteDuels(etat.duels), carteNiveaux(etat.niveaux), carteCalibration(etat.calibration),
      carteHabitudes(etat.habitudes), carteCout(etat.cout), carteCarte(etat.carte),
    );
    racine.append(grille,
      el('p', { class: 'no-warn' }, 'Odin raisonne par étapes à partir de sa mémoire. Il ne pense pas et ne ressent pas. Effacer un souvenir retire ses exemples du corpus ; les poids déjà appris ne l\'oublient pas exactement — tu peux « réentraîner sans ».'));
    conteneur.replaceChildren(racine);
  }

  window.OdinNous = { rendre };
})();
