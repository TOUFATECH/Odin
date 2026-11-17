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
.no-essai button,.no-bar2 button{min-height:40px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:0 12px;font:600 13px inherit;cursor:pointer}
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
    const mesure = t && t.tenus > 0;
    const p = mesure ? t.profond : 0;
    return carte('Part du travail de Noûs',
      el('div', { class: 'no-big' }, mesure ? `${p} % des réponses` : 'pas encore mesurée'),
      mesure ? el('div', { class: 'no-bar' }, el('span', { style: `width:${p}%` })) : null,
      el('div', { class: 'no-sub' }, mesure ? `mesurée sur ${t.tenus} réponse(s) réelles` : "Noûs ne répond encore à rien : aucune part n'est affichée tant qu'elle n'est pas mesurée."),
    );
  }

  const SOURCES = { odin: "Ce qu'Odin est", memoire: 'Tes notes et ta mémoire', mathesis: 'Mathésis', pronoia: 'Prónoia', archytas: 'Archytas' };
  // Ce que Noûs a lu pour de vrai : son corpus (chiffré sur cette machine) et ce qui attend dans la file.
  function carteCorpus(lu) {
    const mo = (lu?.octets ?? 0) / 1048576;
    return carte('Son corpus',
      ligne('Exemples rangés', (lu?.total ?? 0).toLocaleString('fr')),
      ligne('Place sur le disque', mo >= 1 ? `${mo.toFixed(1).replace('.', ',')} Mo` : `${Math.round((lu?.octets ?? 0) / 1024)} Ko`),
      ligne('En attente dans la file', String(lu?.enFile ?? 0)),
      ...(lu?.parSource || []).slice(0, 6).map((x) => ligne(SOURCES[x.source] || x.source, (x.n ?? 0).toLocaleString('fr'))),
      el('div', { class: 'no-sub' }, 'Chiffré avec la clé de cette machine ; jamais en mode privé ; borné par le réglage « disque ».'),
    );
  }

  // Le premier corpus : d'où Noûs part (réglage « corpus de départ »), et le changer.
  function carteDepart(d, onChange) {
    const choix = el('select', { 'aria-label': 'Corpus de départ', style: 'min-height:40px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);padding:0 8px;max-width:100%' },
      ...(d?.choix_possibles || []).map((c) => el('option', { value: c.id, selected: c.id === d.choix }, c.id === 'odin' ? "Ce qu'Odin est" : c.id === 'memoire' ? 'Ma mémoire seulement' : c.id === 'web' ? 'Textes du web' : 'Me demander')));
    const enregistrer = el('button', { type: 'button', onclick: async () => { const r = await api('/reglages', { corpusDepart: choix.value }); if (r && r.ok) onChange(); } }, 'Enregistrer');
    return carte('Premier corpus',
      el('div', { class: 'no-sub' }, d?.texte || ''),
      ligne('Fait', d?.fait ? `oui (${d.textes ?? 0} textes, ${d.paires ?? 0} paires)${d.incomplet ? ` — incomplet : ${d.incomplet}` : ''}` : 'pas encore'),
      el('div', { class: 'no-bar2', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, choix, enregistrer),
    );
  }

  // L'entraînement, dit vrai : en train d'apprendre ou non (et pourquoi), depuis quand, combien de pas, la perte,
  // la dernière amélioration gardée ou refusée, et la puissance (réglable).
  function carteEntrainement(e, onChange) {
    e = e || {};
    const depuis = e.depuis ? new Date(e.depuis).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const d = e.derniere;
    const choix = el('select', { 'aria-label': "Puissance de l'entraînement", style: 'min-height:40px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);padding:0 8px;max-width:100%' },
      ...(e.puissances || []).map((p) => el('option', { value: p.id, selected: p.id === e.puissance }, `${p.id === 'douce' ? 'Douce' : p.id === 'normale' ? 'Normale' : 'Pleine'} (${p.fils} fil${p.fils > 1 ? 's' : ''})`)));
    const enregistrer = el('button', { type: 'button', onclick: async () => { const r = await api('/reglages', { puissance: choix.value }); if (r && r.ok) onChange(); } }, 'Enregistrer');
    const heures = (x) => { const m = Math.round((x || 0) / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
    return carte('Entraînement',
      el('div', { class: 'no-big' }, e.apprend ? 'en train d\'apprendre' : 'n\'apprend pas en ce moment'),
      el('div', { class: 'no-sub' }, e.apprend ? `depuis ${depuis}${e.phase && e.phase !== 'apprend' ? ` — ${e.phase}` : ''}` : (e.arret ? `Raison : ${e.arret}.` : 'Il apprend dès qu\'Odin est libre, de jour comme de nuit.')),
      ligne('Pas d\'apprentissage', (e.pas ?? 0).toLocaleString('fr')),
      ligne('Temps de calcul', heures(e.tempsMs)),
      ligne('Perte (entraînement)', e.perte != null ? String(e.perte).replace('.', ',') : '—'),
      ligne('Perte en service (banc)', e.perteBanc != null ? (Math.round(e.perteBanc * 1000) / 1000).toString().replace('.', ',') : '—'),
      ligne('Dernière amélioration', d ? `${d.gardee ? 'gardée' : 'refusée'} (${(Math.round(d.perteAvant * 1000) / 1000).toString().replace('.', ',')} → ${(Math.round(d.perteApres * 1000) / 1000).toString().replace('.', ',')})` : 'pas encore'),
      d ? el('div', { class: 'no-sub' }, `${d.raison} — ${new Date(d.quand).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`) : null,
      e.dernierArretMs != null ? ligne('Arrêt quand Odin répond', ms(e.dernierArretMs)) : null,
      el('div', { class: 'no-bar2', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, choix, enregistrer),
      el('div', { class: 'no-sub' }, `Puissance : ${(e.puissances || []).find((p) => p.id === e.puissance)?.texte || ''}. La machine a ${e.filsMachine ?? '?'} fils.`),
    );
  }

  function carteCoutNous(c) {
    const v = c?.vidage, d = c?.depart;
    return carte('Ce que ça coûte à Odin',
      ligne('Dernier rangement', v ? `${v.ecrits} exemple(s) en ${ms(v.ms)}` : 'pas encore'),
      ligne('Premier corpus', d ? `${d.textes} textes, ${d.paires} paires : fait en ${ms(d.ms)}, rangé en ${ms(d.rangeMs)}` : 'pas encore'),
      d?.nonResolues?.length ? el('div', { class: 'no-sub' }, `Demandes sans action réelle trouvée : ${d.nonResolues.join(' ; ')}`) : null,
      el('div', { class: 'no-sub' }, "Mesuré sur cette machine ; jamais pendant une réponse d'Odin."),
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
    const etat = (x) => (x ? (x.texte || `fait ${Math.round((x.avancement || 0) * 100)} %`) : 'en attente');
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
      el('span', { class: 'no-sub', style: 'margin-left:auto;align-self:center' }, !actif ? "Noûs est en pause : rien n'est appris." : etat?.prive ? "Mode privé : rien n'est appris." : etat?.entrainement?.apprend ? 'Noûs apprend en ce moment.' : "Noûs apprend dès qu'Odin est libre."));
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
    if (!etat.entraine || !etat.taille) {
      racine.append(
        el('div', { class: 'no-card' }, el('p', { class: 'no-warn', style: 'margin:0' }, etat.message || "Noûs n'a pas encore été entraîné."), etat.prive ? el('p', { class: 'no-sub' }, "Mode privé : rien n'est appris.") : null,
          etat.entrainement?.decoupageAncien ? el('p', { class: 'no-sub' }, `Découpage : ${etat.entrainement.decoupageAncien}.`) : null,
          etat.modeleDepart ? el('p', { class: 'no-sub' }, `Modèle de départ : ${etat.modeleDepart.texte}.`) : null,
          etat.oubli ? el('p', { class: 'no-sub' }, etat.oubli) : null),
        el('div', { class: 'no-grid' },
          carteEntrainement(etat.entrainement, () => rendre(conteneur)), carteCorpus(etat.lu), carteDepart(etat.depart, () => rendre(conteneur)), carteTravail(etat.travail),
          carteEtapes(etat.etapes), carteDuels(etat.duels), carteEssai(), carteCoutNous(etat.cout)),
      );
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
