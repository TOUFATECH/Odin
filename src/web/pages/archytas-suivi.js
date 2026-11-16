// Suivi des scripts d'Archytas (la fenêtre Script d'Odin) : la vue 2D riche, et le repli automatique du graphe 3D.
// Elle montre, sans rien d'extérieur ni aucune image lourde : les chiffres (nombre de scripts, exécutions, succès,
// temps moyen), « le plus utilisé » en barres, une frise des plus récents et des plus anciens, et deux listes
// (utilisés / jamais utilisés), le tout daté. Un bouton fabrique un export CSV dans le navigateur (aucun envoi).
// Chargée toute seule ; la page d'Archytas appelle OdinArchytasSuivi.rendre(hôte, scripts, { onOuvrir }).
// OdinArchytasSuivi.logique (sans document) : trier, agrege, versCSV — vérifiées par test/archytas-page.test.ts.
(() => {
  'use strict';
  if (window.OdinArchytasSuivi) return;

  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };

  // ---------------- Logique pure (sans document), partagée avec le graphe et la page

  const runs = (s) => (s && s.stat && Number(s.stat.runs)) || 0;
  const ok = (s) => (s && s.stat && Number(s.stat.ok)) || 0;
  const echecs = (s) => (s && s.stat && Number(s.stat.echecs)) || 0;
  const msMoyen = (s) => (s && s.stat && Number(s.stat.msMoyen)) || 0;
  const quand = (s) => (s && (Number(s.dernierUsage) || Number(s.modifie) || Number(s.cree))) || 0;

  /** Range les scripts comme le demande le contrat Suivi : les plus utilisés, les récents, les anciens, les jamais utilisés. */
  function trier(scripts) {
    const arr = (Array.isArray(scripts) ? scripts : []).filter((s) => s && typeof s.nom === 'string');
    const plusUtilises = arr.filter((s) => runs(s) > 0).sort((a, b) => runs(b) - runs(a) || quand(b) - quand(a));
    const jamais = arr.filter((s) => runs(s) === 0).sort((a, b) => (b.cree || 0) - (a.cree || 0));
    const recents = arr.slice().sort((a, b) => quand(b) - quand(a));
    const anciens = arr.slice().sort((a, b) => quand(a) - quand(b));
    return { plusUtilises, recents, anciens, jamais };
  }

  /** Les chiffres d'ensemble, mesurés (jamais inventés) : nombre, exécutions, taux de succès, temps moyen pondéré. */
  function agrege(scripts) {
    const arr = (Array.isArray(scripts) ? scripts : []).filter((s) => s && typeof s.nom === 'string');
    let exe = 0, bons = 0, mauvais = 0, poidsMs = 0;
    for (const s of arr) { exe += runs(s); bons += ok(s); mauvais += echecs(s); poidsMs += msMoyen(s) * runs(s); }
    return {
      scripts: arr.length,
      executions: exe,
      succes: exe > 0 ? Math.round((bons / exe) * 100) : null,
      echecs: mauvais,
      msMoyen: exe > 0 ? Math.round(poidsMs / exe) : null,
      utilises: arr.filter((s) => runs(s) > 0).length,
      jamais: arr.filter((s) => runs(s) === 0).length,
    };
  }

  /** Une cellule de CSV : guillemets doublés et champ entre guillemets si besoin (jamais de code ni de secret ici). */
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  /** Un export CSV fabriqué dans le navigateur, à partir des résumés (aucune donnée privée : pas de code). */
  function versCSV(scripts) {
    const arr = (Array.isArray(scripts) ? scripts : []).filter((s) => s && typeof s.nom === 'string');
    const d = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '');
    const entete = ['nom', 'mission', 'genre', 'exécutions', 'réussites', 'échecs', 'temps moyen (ms)', 'créé', 'modifié', 'dernier usage'];
    const lignes = arr.map((s) => [s.nom, s.mission || '', s.genre || '', runs(s), ok(s), echecs(s), msMoyen(s), d(s.cree), d(s.modifie), d(s.dernierUsage)].map(cell).join(';'));
    return [entete.map(cell).join(';'), ...lignes].join('\r\n');
  }

  // ---------------- Dessin

  const CSS = `
.ar-su{display:flex;flex-direction:column;gap:14px;min-width:0}
.ar-su h3{margin:0 0 8px;font:600 13.5px inherit;color:var(--ink)}
.ar-c{display:flex;gap:8px;flex-wrap:wrap}
.ar-c>div{border:1px solid var(--line);border-radius:12px;padding:8px 12px;font-size:12.5px;color:var(--muted);min-width:92px;flex:1 1 92px}
.ar-c b{display:block;font:700 19px inherit;color:var(--ink)}
.ar-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:12px 14px;min-width:0}
.ar-bar{display:flex;align-items:center;gap:10px;font-size:13px;padding:4px 0}
.ar-bar>.ar-n{flex:0 0 38%;min-width:0;overflow-wrap:anywhere;color:var(--ink)}
.ar-bar>button.ar-n{border:0;background:none;font:inherit;text-align:left;cursor:pointer;padding:0}
.ar-bar>button.ar-n:hover,.ar-bar>button.ar-n:focus-visible{text-decoration:underline;outline:none}
.ar-bar>.ar-t{flex:1 1 auto;height:9px;border-radius:5px;background:var(--panel2,color-mix(in srgb,var(--ink) 10%,transparent));overflow:hidden}
.ar-bar>.ar-t>i{display:block;height:100%;border-radius:5px;background:var(--accent,#6b8afd)}
.ar-bar>.ar-v{flex:none;color:var(--muted);font-variant-numeric:tabular-nums;min-width:52px;text-align:right}
.ar-tl{list-style:none;margin:8px 0 0 4px;padding:0;border-left:2px solid var(--line)}
.ar-tl li{position:relative;padding:3px 0 3px 14px;font-size:13px;display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}
.ar-tl li::before{content:'';position:absolute;left:-5px;top:8px;width:8px;height:8px;border-radius:50%;background:var(--accent,#6b8afd)}
.ar-tl time{color:var(--muted);font-variant-numeric:tabular-nums;font-size:12px;min-width:92px}
.ar-tl b{color:var(--ink);font-weight:600}.ar-tl span{color:var(--muted);overflow-wrap:anywhere}
.ar-tl .ar-lien{border:0;background:none;color:var(--ink);font:inherit;font-weight:600;text-align:left;padding:0;overflow-wrap:anywhere}
.ar-tl button.ar-lien{cursor:pointer}
.ar-tl button.ar-lien:hover,.ar-tl button.ar-lien:focus-visible{text-decoration:underline;outline:none}
.ar-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.ar-names{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:2px}
.ar-names button{display:flex;gap:8px;align-items:baseline;width:100%;text-align:left;border:0;background:none;color:var(--ink);font:inherit;font-size:13px;padding:5px 6px;border-radius:8px;cursor:pointer;min-height:34px}
.ar-names button:hover,.ar-names button:focus-visible{background:var(--hover,color-mix(in srgb,var(--ink) 8%,transparent));outline:none}
.ar-names small{color:var(--muted)}
.ar-su .ar-vide{color:var(--muted);font-size:13px}
.ar-su .ar-bout{min-height:38px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:0 14px;font:600 13px inherit;cursor:pointer}
`;
  function style() { if (!document.getElementById('ar-su-css')) document.head.append(el('style', { id: 'ar-su-css' }, CSS)); }

  const fmtDate = (ts) => { if (!ts) return '—'; try { return new Date(ts).toLocaleDateString('fr', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return '—'; } };
  const fmtMs = (x) => (x == null ? '—' : x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`);

  function barres(scripts, onOuvrir) {
    const top = trier(scripts).plusUtilises.slice(0, 8);
    if (!top.length) return el('p', { class: 'ar-vide' }, 'Aucun script n\'a encore été lancé.');
    const max = Math.max(1, ...top.map(runs));
    return el('div', {}, ...top.map((s) => el('div', { class: 'ar-bar' },
      boutonNom(s, onOuvrir, 'ar-n'),
      el('span', { class: 'ar-t', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.round((runs(s) / max) * 100)}%` })),
      el('span', { class: 'ar-v' }, `${runs(s)} fois`))));
  }

  function boutonNom(s, onOuvrir, cls) {
    if (typeof onOuvrir === 'function') return el('button', { class: cls, type: 'button', onclick: () => onOuvrir(s.nom), title: `Ouvrir « ${s.nom} »` }, s.nom);
    return el('span', { class: cls }, s.nom);
  }

  function frise(liste, onOuvrir, vide) {
    const items = liste.slice(0, 8);
    if (!items.length) return el('p', { class: 'ar-vide' }, vide);
    return el('ul', { class: 'ar-tl' }, ...items.map((s) => el('li', {},
      el('time', { datetime: new Date(quand(s) || s.cree || Date.now()).toISOString() }, fmtDate(quand(s) || s.cree)),
      boutonNom(s, onOuvrir, 'ar-lien'),
      el('span', {}, s.mission ? `— ${s.mission}` : ''))));
  }

  function listeNoms(liste, onOuvrir, vide) {
    if (!liste.length) return el('p', { class: 'ar-vide' }, vide);
    return el('ul', { class: 'ar-names' }, ...liste.map((s) => {
      const b = boutonNom(s, onOuvrir, '');
      b.append(el('small', {}, runs(s) > 0 ? ` · ${runs(s)} usage${runs(s) > 1 ? 's' : ''}` : ' · jamais'));
      return el('li', {}, b);
    }));
  }

  function exporter(scripts) {
    try {
      const blob = new Blob(['﻿' + versCSV(scripts)], { type: 'text/csv;charset=utf-8' });
      const u = URL.createObjectURL(blob);
      const a = el('a', { href: u, download: `scripts-archytas-${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
    } catch { /* navigateur sans Blob : rien, l'export est un plus */ }
  }

  /** Dessine le suivi dans `hote` à partir des résumés (ScriptResume[]). onOuvrir(nom) rend les noms cliquables. */
  function rendre(hote, scripts, opts = {}) {
    style();
    const onOuvrir = typeof opts.onOuvrir === 'function' ? opts.onOuvrir : null;
    const g = agrege(scripts);
    const T = trier(scripts);
    const racine = el('div', { class: 'ar-su' },
      el('div', { class: 'ar-c' },
        el('div', {}, el('b', {}, String(g.scripts)), 'scripts'),
        el('div', {}, el('b', {}, String(g.executions)), 'exécutions'),
        el('div', {}, el('b', {}, g.succes == null ? '—' : `${g.succes} %`), 'réussite'),
        el('div', {}, el('b', {}, fmtMs(g.msMoyen)), 'temps moyen')),
      el('div', { class: 'ar-card' }, el('h3', {}, 'Le plus utilisé'), barres(scripts, onOuvrir)),
      el('div', { class: 'ar-two' },
        el('div', { class: 'ar-card' }, el('h3', {}, 'Les plus récents'), frise(T.recents, onOuvrir, 'Aucun script pour l\'instant.')),
        el('div', { class: 'ar-card' }, el('h3', {}, 'Les plus anciens'), frise(T.anciens, onOuvrir, 'Aucun script pour l\'instant.'))),
      el('div', { class: 'ar-two' },
        el('div', { class: 'ar-card' }, el('h3', {}, `Utilisés (${g.utilises})`), listeNoms(T.plusUtilises, onOuvrir, 'Aucun script utilisé pour l\'instant.')),
        el('div', { class: 'ar-card' }, el('h3', {}, `Jamais utilisés (${g.jamais})`), listeNoms(T.jamais, onOuvrir, 'Tous les scripts ont déjà servi.'))),
      el('button', { class: 'ar-bout', type: 'button', onclick: () => exporter(scripts) }, 'Exporter en CSV'));
    hote.replaceChildren(racine);
    return racine;
  }

  window.OdinArchytasSuivi = { rendre, logique: { trier, agrege, versCSV } };
})();
