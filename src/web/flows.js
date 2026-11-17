// Espace « Automatisations » : Talos, le moteur d'automatisations d'Odin. Liste, création en une
// phrase, modèles (dont ceux qui relient les applis), éditeur à nœuds (glisser, relier, régler),
// test pas à pas, historique des exécutions et versions.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const sv = (t, a = {}) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };

  // ---------------- Le « + » : où poser un bloc, à quoi le relier (fonctions pures, sans document).
  const NODE_W = 190, PAS_X = 280, PAS_Y = 110;
  const RAISON_GRAVE = 'Action grave : elle demande ton accord et ne part pas d\'une automatisation.';
  /** Les réglages qui ont une valeur par défaut (`sansVide` : sauf la chaîne vide). */
  const parDefaut = (params, sansVide = false) => Object.fromEntries((params ?? []).filter((p) => p.default !== undefined && !(sansVide && p.default === '')).map((p) => [p.key, p.default]));
  /** Un nom pas encore pris : « Nom », sinon « Nom 2 », « Nom 3 »… */
  function nomLibre(nodes, base) { let name = base, k = 2; while (nodes.some((n) => n.name === name)) name = `${base} ${k++}`; return name; }
  /** Une place libre : [x, y], sinon plus bas, jusqu'à ne recouvrir aucun bloc. */
  function placeLibre(nodes, x, y) {
    let yy = Math.round(y);
    for (let i = 0; i < 40 && nodes.some((n) => Math.abs((n.position?.[0] ?? 0) - x) < NODE_W + 20 && Math.abs((n.position?.[1] ?? 0) - yy) < 90); i++) yy += PAS_Y;
    return [Math.round(x), yy];
  }
  /** La sortie d'où part le « + » d'un bloc : la première qui n'a pas encore de lien, sinon la première. */
  function sortieDuPlus(wf, nom, sorties = 1) { const c = wf.connections?.[nom] ?? []; for (let i = 0; i < sorties; i++) if (!(c[i] ?? []).length) return i; return 0; }
  /** Fenêtre vide : le premier bloc dit quand l'automatisation part (un déclencheur) ; sinon, ce qu'elle fait ensuite. */
  const modeChoix = (wf) => (wf.nodes.length ? 'faire' : 'quand');
  /** Le bloc d'une fonction d'appli ; refusé si elle est grave (elle ne part pas d'une automatisation). */
  function blocFonction(appli, f) {
    if (!appli?.id || !f?.id) return { ok: false, error: 'Choisis une appli et une de ses fonctions.' };
    if (f.grave) return { ok: false, error: f.raison || RAISON_GRAVE };
    return { ok: true, bloc: { name: `${appli.nom} · ${f.label}`, type: 'module.action', params: { module: appli.id, action: f.id, entrée: JSON.stringify(parDefaut(f.params, true)) } } };
  }
  /** Le déclencheur « quand une appli signale » : ev '' = tout ce qu'elle signale, 'alerte' = ses alertes. */
  function blocSignal(appli, ev = '') {
    const name = ev === 'alerte' ? `Quand ${appli.nom} lance une alerte` : ev ? `Quand ${appli.nom} signale « ${ev} »` : `Quand ${appli.nom} signale`;
    return { ok: true, bloc: { name, type: 'déclencheur.module', trigger: true, params: { module: appli.id, événement: ev, niveau: 'haute' } } };
  }
  /** Le bloc d'un outil du catalogue de Talos (Si, Attendre, Aiguillage…). */
  const blocOutil = (c) => ({ ok: true, bloc: { name: c.label, type: c.type, trigger: Boolean(c.trigger), params: parDefaut(c.params) } });
  function relier(wf, from, out, to) {
    if (from === to) return false;
    const c = wf.connections[from] ?? (wf.connections[from] = []);
    while (c.length <= out) c.push([]);
    if (!c[out].some((l) => l.node === to)) c[out].push({ node: to });
    return true;
  }
  /**
   * Pose un bloc. Depuis le « + » d'un bloc (`de` : { node, out }) : à droite de lui (plus bas si la place est prise)
   * et relié à lui. Depuis le « + » central ou un double-clic (`a` : [x, y]) : posé là, sans lien.
   * → { ok: true, name, lien? } ou { ok: false, error }.
   */
  function poser(wf, choix, { de, a } = {}) {
    if (!choix?.ok) return { ok: false, error: choix?.error ?? 'Rien à ajouter.' };
    const b = choix.bloc, depart = de ? wf.nodes.find((n) => n.name === de.node) : null;
    if (de && !depart) return { ok: false, error: 'Ce bloc n\'existe plus.' };
    const name = nomLibre(wf.nodes, b.name);
    const position = depart ? placeLibre(wf.nodes, (depart.position?.[0] ?? 0) + PAS_X, depart.position?.[1] ?? 0) : placeLibre(wf.nodes, a?.[0] ?? 60, a?.[1] ?? 160);
    wf.nodes.push({ name, type: b.type, params: b.params, position });
    if (depart && !b.trigger) { const out = de.out ?? 0; relier(wf, depart.name, out, name); return { ok: true, name, lien: { de: depart.name, out } }; }
    return { ok: true, name };
  }
  /** La flèche du clavier dans une grille de `cols` colonnes : la nouvelle place (la même au bord). */
  function pasFleche(i, total, cols, touche) {
    const c = Math.max(1, Math.floor(cols) || 1);
    const j = touche === 'ArrowRight' ? i + 1 : touche === 'ArrowLeft' ? i - 1 : touche === 'ArrowDown' ? i + c : touche === 'ArrowUp' ? i - c : touche === 'Home' ? 0 : touche === 'End' ? total - 1 : i;
    return j < 0 || j >= total ? i : j;
  }
  /** Deux touchers (ou clics) rapprochés au même endroit : { t, x, y } chacun. */
  const estDoubleTouche = (a, b) => Boolean(a && b && b.t - a.t >= 0 && b.t - a.t < 400 && Math.hypot(b.x - a.x, b.y - a.y) < 24);
  // Session expirée pendant l'usage : on revient à la page de connexion. Sur la page de connexion elle-même,
  // on ne recharge rien (sinon elle se rechargerait en boucle et effacerait ce que tu tapes).
  const appShown = () => { const a = document.querySelector('#app'); return Boolean(a && !a.hidden); };
  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
    if (r.status === 401) { if (appShown()) location.reload(); throw new Error('session expirée'); }
    return r.json();
  }
  const css = `
.dr-top{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}.dr-top input{flex:1 1 280px;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--field);background:var(--panel)}
.dr-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin:0 0 20px}
.dr-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.dr-card .dr-h{display:flex;gap:10px;align-items:center;justify-content:space-between}.dr-card b{font-size:16px}
.dr-steps{font-size:13px;color:var(--muted);overflow-wrap:anywhere}.dr-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dr-tpl{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.dr-tpl article{border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--panel2);display:flex;flex-direction:column;gap:6px}.dr-tpl p{margin:0;font-size:14px;color:var(--muted)}
.dr-ed{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:12px;align-items:start}@media (max-width:980px){.dr-ed{grid-template-columns:1fr}}
.dr-canvas{position:relative;height:min(64vh,620px);border:1px solid var(--line);border-radius:14px;background:var(--panel2) radial-gradient(circle,var(--line) 1px,transparent 1px) 0 0/22px 22px;overflow:hidden;touch-action:none}
.dr-canvas svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.dr-world{position:absolute;left:0;top:0;transform-origin:0 0}
.dr-node{position:absolute;width:190px;background:var(--panel);border:1.5px solid var(--line);border-radius:12px;padding:8px 10px 10px;cursor:grab;user-select:none;box-shadow:var(--shadow)}
.dr-node.sel{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent)}
.dr-node.trig{border-left:5px solid var(--accent)}.dr-node.off{opacity:.5}
.dr-node.ok{border-color:var(--good)}.dr-node.err{border-color:var(--bad)}
.dr-node small{display:block;font-size:11.5px;color:var(--dim)}.dr-node b{display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dr-node .dr-cnt{font-size:11.5px;color:var(--good)}.dr-node.err .dr-cnt{color:var(--bad)}
.dr-port{position:absolute;width:18px;height:18px;border-radius:50%;border:2px solid var(--accent);background:var(--panel);padding:0;cursor:crosshair}
.dr-port.in{left:-10px;top:24px}.dr-port.out{right:-10px}.dr-port.armed{background:var(--accent)}
.dr-port .dr-pl{position:absolute;left:20px;top:-2px;font-size:10.5px;color:var(--dim);white-space:nowrap;pointer-events:none}
.dr-link{fill:none;stroke:var(--accent);stroke-width:2.2;opacity:.8;pointer-events:stroke;cursor:pointer}
.dr-side{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;max-height:min(64vh,620px);overflow:auto}
.dr-side h2{font-size:16px;margin:0}.dr-side label{font-size:13.5px;font-weight:600;display:block;margin:6px 0 4px}
.dr-side input:not([type=checkbox]),.dr-side textarea,.dr-side select{width:100%;min-height:38px;padding:7px 10px;border-radius:10px;border:1px solid var(--field);background:var(--panel2)}.dr-side textarea{min-height:80px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}
.dr-cat{display:flex;flex-direction:column;gap:4px}.dr-cat h3{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim);margin:8px 0 2px}
.dr-cat button{text-align:left;border:1px solid var(--line);background:var(--panel2);border-radius:10px;padding:7px 10px;font-size:13.5px;min-height:36px}.dr-cat button:hover{border-color:var(--accent)}
.dr-out{white-space:pre-wrap;font-size:12.5px;background:var(--panel2);border-radius:10px;padding:8px;max-height:240px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace}
.dr-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 10px}.dr-bar input.dr-name{flex:1 1 220px;min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--field);background:var(--panel);font-weight:600}
.dr-runs{font-size:13.5px}.dr-runs li{padding:4px 0}
.dr-plus{position:absolute;right:-22px;bottom:-22px;width:44px;height:44px;padding:0;border:0;background:none;display:grid;place-items:center;cursor:pointer;z-index:1}
.dr-plus span{width:26px;height:26px;border-radius:50%;background:var(--accent);color:var(--on-accent,#fff);display:grid;place-items:center;font-size:19px;font-weight:700;line-height:1;box-shadow:var(--shadow);transition:transform .15s}
.dr-plus:hover span,.dr-plus:focus-visible span{transform:scale(1.15)}.dr-plus:focus-visible{outline:2px solid var(--accent);border-radius:50%}
.dr-vide{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;text-align:center;pointer-events:none}
.dr-vide button{pointer-events:auto;width:96px;height:96px;border-radius:50%;border:2px dashed var(--accent);background:var(--panel);color:var(--accent);font-size:52px;line-height:1;cursor:pointer;box-shadow:var(--shadow)}
.dr-vide button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.dr-vide p{margin:0;color:var(--muted);font-size:14px;max-width:320px}
.dr-choix-fond{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(8,10,14,.55)}
.dr-choix{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);width:min(640px,100%);max-height:min(86vh,720px);display:flex;flex-direction:column;overflow:hidden;animation:dr-ch-in .16s ease-out}
.dr-ch-h{display:flex;align-items:center;gap:10px;padding:10px 10px 10px 16px;border-bottom:1px solid var(--line)}.dr-ch-h h2{flex:1;margin:0;font-size:17px;display:flex;align-items:center;gap:10px;min-width:0;overflow-wrap:anywhere}
.dr-ch-x{flex:none;width:44px;height:44px;border:0;border-radius:10px;background:none;color:var(--ink);font-size:24px;cursor:pointer}.dr-ch-x:hover{background:var(--panel2)}
.dr-ch-c{padding:12px 16px 16px;overflow:auto;display:flex;flex-direction:column;gap:10px;min-height:0}.dr-ch-c .li-g{max-height:none}.dr-ch-c>.btn{align-self:flex-start;min-height:44px}
.dr-ch-c h3{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim);margin:6px 0 0}.dr-ch-c h4{font-size:12.5px;color:var(--muted);margin:6px 0 0}
.dr-ch-o{display:flex;flex-direction:column;gap:6px}.dr-ch-o button{text-align:left;border:1px solid var(--line);background:var(--panel2);border-radius:10px;padding:8px 12px;min-height:44px;color:var(--ink);font:inherit;cursor:pointer}
.dr-ch-o button:hover{border-color:var(--accent)}.dr-ch-o button:focus-visible{outline:2px solid var(--accent)}.dr-ch-o b{display:block;font-size:14px}.dr-ch-o small{display:block;color:var(--muted);font-size:12.5px}
@keyframes dr-ch-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.dr-choix{animation:none}.dr-plus span{transition:none}}
`;
  let st = null, wf = null, outs = {}, sel = null, armed = null, last = null, view = { x: 40, y: 40, k: 1 }, dirty = false;
  const cat = (t) => st?.catalog.find((c) => c.type === t);
  let elems = new Map();

  // Un autre écran de Talos (« Faire un lien ») a pris la page : la liste ne revient qu'à la demande.
  let ailleurs = false, jeton = 0;
  async function openList() {
    wf = null; ailleurs = false; fermerChoix(); const j = ++jeton;
    const box = $('#v-flows .body'); if (!box) return;
    $('#v-flows .head h1').textContent = 'Automatisations';
    $('#v-flows .head .sub').textContent = 'Talos, le moteur d\'Odin : décris ce que tu veux automatiser, ou pars d\'un modèle. Tout est relié à Thot, Papyrus et tes applis.';
    st = await api('/api/draupnir/state');
    if (j !== jeton) return;
    box.replaceChildren();
    if (!st.ok) { box.append(el('p', { class: 'sub' }, st.error)); return; }
    const msg = el('p', { class: 'sub', role: 'status' });
    box.append(el('form', { class: 'dr-top', onsubmit: async (e) => { e.preventDefault(); const d = $('#drAsk').value.trim(); if (!d) return; msg.textContent = 'Odin écrit l\'automatisation…'; const r = await api('/api/draupnir/create', { description: d }); if (r.ok) ouvrirNeuve(r.flow.id); else msg.textContent = `✗ ${r.error}`; } },
      el('label', { for: 'drAsk', class: 'sr' }, 'Décris ton automatisation'), el('input', { id: 'drAsk', placeholder: 'Ex. chaque matin à 7 h, envoie-moi les tâches en retard', autocomplete: 'off' }), el('button', { class: 'btn primary', type: 'submit' }, 'Créer avec Odin'), lienBtn(), el('button', { class: 'btn', type: 'button', onclick: newFlow }, 'Partir de zéro')), msg);
    // Les dossiers de Talos (onglets Actives, Brouillons, tes dossiers, Corbeille) : pages/talos-dossiers.js ; sans lui, la grille d'avant.
    if (!window.OdinTalosDossiers?.monter(box, st, { ouvrir: openFlow, lancer, recharger: openList })) { if (st.flows.length) box.append(el('div', { class: 'dr-list' }, ...st.flows.map((w) => el('article', { class: 'dr-card' },
      el('div', { class: 'dr-h' }, el('b', {}, w.name), el('input', { type: 'checkbox', class: 'g-sw', 'aria-label': `Activer ${w.name}`, checked: w.active ? true : undefined, onchange: async (e) => { if (e.target.checked && !(await window.OdinDialog.confirm(`Activer « ${w.name} » ? Elle agira seule ensuite.`))) { e.target.checked = false; return; } const r = await api('/api/draupnir/toggle', { id: w.id, on: e.target.checked }); if (!r.ok) { e.target.checked = !e.target.checked; await window.OdinDialog.alert(r.error); } } })),
      el('div', { class: 'dr-steps' }, w.nodes.map((n) => n.label).join(' → ')),
      w.phrase || w.prochaineTexte ? el('div', { class: 'dr-steps' }, [w.phrase, w.active && w.prochaineTexte ? `Prochaine : ${w.prochaineTexte}` : ''].filter(Boolean).join(' · ')) : null,
      el('div', { class: 'dr-row' }, w.last ? el('span', { class: `pill ${w.last.status === 'succès' ? 'good' : w.last.status === 'erreur' ? 'bad' : ''}` }, `${w.last.status} · ${new Date(w.last.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`) : el('span', { class: 'pill' }, 'jamais lancée'), w.failed ? el('span', { class: 'pill bad' }, `${w.failed} échec(s)`) : null),
      el('div', { class: 'dr-row' }, el('button', { class: 'btn small primary', type: 'button', onclick: () => openFlow(w.id) }, 'Ouvrir'), el('button', { class: 'btn small', type: 'button', onclick: (e) => lancer(e.currentTarget, w) }, 'Lancer maintenant')), el('div', { class: 'dr-steps', role: 'status' }))))); else box.append(el('p', { class: 'sub' }, 'Aucune automatisation pour l\'instant.')); }
    // Tout ce qui tourne tout seul dans Odin (applis, tâches planifiées, rappels) : la même liste, sous les automatisations.
    if (window.OdinAutomatismes) { const zone = el('div', {}); box.append(zone); window.OdinAutomatismes.monter(zone); }
    box.append(el('section', { class: 'card', style: 'margin-bottom:16px' }, el('h2', { style: 'font-size:17px;margin:0 0 8px' }, 'Modèles prêts'), el('div', { class: 'dr-tpl' }, ...st.templates.map((t) => el('article', {}, el('b', {}, t.name), el('p', {}, t.what), el('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; const r = await api('/api/draupnir/template', { id: t.id }); if (r.ok) ouvrirNeuve(r.flow.id); else { e.target.textContent = `✗ ${r.error}`; } } }, 'Utiliser'))))));
    box.append(el('details', { class: 'card' }, el('summary', { style: 'cursor:pointer;min-height:40px;display:flex;align-items:center;font-weight:600' }, 'Importer une automatisation n8n (JSON)'),
      el('form', { onsubmit: async (e) => { e.preventDefault(); const r = await api('/api/draupnir/import', { json: $('#drImp').value }); if (r.ok) { if (r.todo?.length) await window.OdinDialog.alert(`À revoir :\n${r.todo.join('\n')}`); ouvrirNeuve(r.flow.id); } else await window.OdinDialog.alert(r.error); } }, el('label', { for: 'drImp', class: 'sub' }, 'Colle le JSON exporté'), el('textarea', { id: 'drImp', style: 'width:100%;min-height:120px' }), el('button', { class: 'btn', type: 'submit' }, 'Importer'))));
  }
  /** « Faire un lien » : montré seulement quand Talos sait en faire (sinon la barre reste comme avant). */
  function lienBtn() {
    if (!window.OdinLien) return null;
    const b = el('button', { class: 'btn', type: 'button', hidden: true, onclick: () => window.OdinLien.ouvrir() }, 'Faire un lien');
    window.OdinLien.dispo().then((ok) => { b.hidden = !ok; });
    return b;
  }
  /** « Lancer maintenant » d'une carte : le résultat reste sous la carte (pastille, texte, durée). */
  async function lancer(btn, w) {
    const out = btn.closest('article')?.querySelector('[role=status]'); btn.disabled = true;
    const dit = (ok, texte, ms) => { if (out) out.replaceChildren(el('span', { class: `pill ${ok ? 'good' : 'bad'}` }, ok ? 'Réussi' : 'Échec'), ` ${texte ?? ''}${typeof ms === 'number' ? ` · ${ms} ms` : ''}`); };
    if (out) out.textContent = 'Lancement…';
    let r = await api('/api/draupnir/automatisme/lancer', { id: `flow:${w.id}` }).catch(() => ({}));
    if (r?.ok === undefined) {
      // Talos sans « Lancer maintenant » : on passe par le test d'avant.
      r = await api('/api/draupnir/run', { id: w.id }).catch((e) => ({ ok: false, error: e.message }));
      btn.disabled = false;
      if (r.ok) dit(r.run.status === 'succès', `${r.run.status}${r.run.error ? ` : ${r.run.error}` : ''}`, r.run.ms); else dit(false, r.error);
      return;
    }
    btn.disabled = false;
    if (r.ok) dit(r.resultat?.ok !== false, r.resultat?.texte, r.resultat?.ms); else dit(false, r.error);
  }
  function newFlow() { wf = { id: '', name: 'Nouvelle automatisation', active: false, nodes: [{ name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] }], connections: {} }; outs = {}; dirty = true; editor(); }
  async function openFlow(id) {
    const r = await api(`/api/draupnir/flow?id=${encodeURIComponent(id)}`); if (!r.ok) { await window.OdinDialog.alert(r.error); return; }
    if (!st) st = await api('/api/draupnir/state');
    wf = r.flow; outs = r.outputs; last = r.runs[0] ?? null; sel = null; dirty = false; editor(r);
  }
  /**
   * Une automatisation que le serveur vient de créer (« Créer avec Odin », un modèle, un import) : elle est déjà enregistrée,
   * en brouillon et sans dossier. On l'ouvre, puis on propose le même choix qu'au premier enregistrement (dossier, état) ;
   * « Annuler » la laisse telle quelle.
   */
  async function ouvrirNeuve(id) {
    await openFlow(id);
    const T = window.OdinTalosDossiers;
    if (!T || wf?.id !== id) return;
    const c = await T.choisir(wf);
    if (!c || wf?.id !== id) return;
    const s = $('#drSt');
    if (c.dossier) { const r = await api('/api/draupnir/ranger', { id, dossier: c.dossier }).catch((e) => ({ ok: false, error: e.message })); if (!r.ok) { if (s) s.textContent = `✗ ${r.error}`; return; } if (wf?.id === id) wf.dossier = c.dossier; }
    if (c.active) { const r = await api('/api/draupnir/toggle', { id, on: true }).catch((e) => ({ ok: false, error: e.message })); if (!r.ok) { if (s) s.textContent = `✗ ${r.error}`; return; } if (wf?.id === id) wf.active = true; }
    if (wf?.id !== id) return;
    $('#v-flows .dr-bar .td-barre')?.replaceWith(T.barre(wf, () => wf));
    if (s) s.textContent = c.active ? '✓ Enregistrée, active.' : '✓ Enregistrée en brouillon.';
  }
  const outputsOf = (n) => outs[n.name] ?? cat(n.type)?.outputs ?? ['sortie'];
  function editor(r) {
    const box = $('#v-flows .body');
    $('#v-flows .head h1').textContent = wf.name; $('#v-flows .head .sub').textContent = 'Glisse les étapes, relie une sortie (rond à droite) à une entrée (rond à gauche), clique une étape pour la régler. Le « + » d\'une étape (ou un double-clic sur la fenêtre) ajoute un bloc.';
    const canvas = el('div', { class: 'dr-canvas', id: 'drCanvas', role: 'application', 'aria-label': 'Schéma de l\'automatisation' });
    const svg = sv('svg'); const world = el('div', { class: 'dr-world' }); canvas.append(svg, world);
    const side = el('aside', { class: 'dr-side', id: 'drSide', 'aria-label': 'Réglages' });
    const status = el('span', { class: 'sub', role: 'status', id: 'drSt' });
    box.replaceChildren(
      el('div', { class: 'dr-bar' }, el('button', { class: 'btn small', type: 'button', onclick: async () => { if (!dirty || await window.OdinDialog.confirm('Quitter sans enregistrer ?')) openList(); } }, '← Automatisations'), el('label', { for: 'drName', class: 'sr' }, 'Nom'), el('input', { id: 'drName', class: 'dr-name', value: wf.name, oninput: (e) => { wf.name = e.target.value; dirty = true; } }),
        wf.id && window.OdinTalosDossiers ? window.OdinTalosDossiers.barre(wf, () => wf) : null,
        el('button', { class: 'btn small primary', type: 'button', onclick: save }, 'Enregistrer'), el('button', { class: 'btn small', type: 'button', onclick: () => test() }, 'Tester'), el('button', { class: 'btn small', type: 'button', onclick: () => { sel = null; drawSide(); } }, '+ Étape'),
        wf.id ? el('button', { class: 'btn small', type: 'button', onclick: async () => { if (!(await window.OdinDialog.confirm('Mettre cette automatisation à la corbeille ?', { danger: true }))) return; await api('/api/draupnir/trash', { id: wf.id }); openList(); } }, 'Corbeille') : null, status),
      el('div', { class: 'dr-ed' }, canvas, side),
      // (Pas d'exécution ni de version quand on part de zéro : rien, et surtout pas le mot « null ».)
      ...(r ? [el('section', { class: 'card', style: 'margin-top:12px' }, el('h2', { style: 'font-size:16px;margin:0' }, 'Dernières exécutions'), r.runs.length ? el('ul', { class: 'dr-runs' }, ...r.runs.slice(0, 10).map((x) => { const net = /attente.*internet|internet.*attente|en-attente-internet/i.test(`${x.status} ${x.error ?? ''}`); return el('li', {}, el('span', { class: `pill ${x.status === 'succès' ? 'good' : net ? '' : x.status === 'erreur' ? 'bad' : ''}` }, net ? 'en attente d\'Internet' : x.status), ` ${new Date(x.startedAt).toLocaleString('fr-FR')} · ${x.mode} · ${x.ms} ms${net ? ' · en attente du retour d\'Internet' : x.error ? ` · ${x.error}` : ''}`); })) : el('p', { class: 'sub' }, 'Jamais lancée.'),
        r.versions?.length ? el('details', {}, el('summary', { style: 'cursor:pointer;min-height:36px;display:flex;align-items:center' }, `Versions (${r.versions.length})`), el('ul', { class: 'dr-runs' }, ...r.versions.slice(0, 15).map((v) => el('li', {}, `${new Date(v.at).toLocaleString('fr-FR')} · ${v.nodes} étapes `, el('button', { class: 'btn small', type: 'button', onclick: async () => { if (!(await window.OdinDialog.confirm('Revenir à cette version ?'))) return; const x = await api('/api/draupnir/restore', { id: wf.id, at: v.at }); if (x.ok) openFlow(wf.id); } }, 'Restaurer'))))) : null)] : []));
    pan(canvas, world); draw(); drawSide();
  }
  function nodeEl(n) {
    const c = cat(n.type), run = last?.nodes?.[n.name];
    const d = el('div', { class: `dr-node${c?.trigger ? ' trig' : ''}${n.disabled ? ' off' : ''}${sel === n.name ? ' sel' : ''}${run ? (run.error ? ' err' : ' ok') : ''}`, tabindex: '0', role: 'button', 'aria-label': `${n.name} (${c?.label ?? n.type})`, style: `left:${n.position?.[0] ?? 0}px;top:${n.position?.[1] ?? 0}px` },
      el('small', {}, c?.group ?? '?', ' · ', c?.label ?? n.type), el('b', {}, n.name), run ? el('span', { class: 'dr-cnt' }, run.error ? `✗ ${run.error.slice(0, 40)}` : `${run.count} élément(s)`) : null);
    if (!c?.trigger) d.append(el('button', { class: 'dr-port in', type: 'button', 'aria-label': `Entrée de ${n.name}`, onclick: (e) => { e.stopPropagation(); if (armed) { link(armed.node, armed.out, n.name); armed = null; draw(); } } }));
    const sorties = outputsOf(n);
    sorties.forEach((o, i, all) => d.append(el('button', { class: `dr-port out${armed && armed.node === n.name && armed.out === i ? ' armed' : ''}`, type: 'button', style: `top:${18 + i * 22}px`, 'aria-label': `Sortie ${o} de ${n.name}`, onclick: (e) => { e.stopPropagation(); armed = armed && armed.node === n.name && armed.out === i ? null : { node: n.name, out: i }; draw(); } }, all.length > 1 ? el('span', { class: 'dr-pl' }, o) : null)));
    // Le « + » du côté de la sortie : un bloc de plus, posé à droite et relié à celui-ci.
    d.append(el('button', { class: 'dr-plus', type: 'button', title: 'Ajouter un bloc à la suite', 'aria-label': `Ajouter un bloc après ${n.name}`, onclick: (e) => { e.stopPropagation(); void ouvrirChoix({ de: { node: n.name, out: sortieDuPlus(wf, n.name, sorties.length) } }); } }, el('span', { 'aria-hidden': 'true' }, '+')));
    let start = null;
    d.addEventListener('pointerdown', (e) => { if (e.target.closest('.dr-port') || e.target.closest('.dr-plus')) return; e.stopPropagation(); d.setPointerCapture(e.pointerId); start = { x: e.clientX, y: e.clientY, p: [...(n.position ?? [0, 0])], moved: false }; });
    d.addEventListener('pointermove', (e) => { if (!start) return; const dx = (e.clientX - start.x) / view.k, dy = (e.clientY - start.y) / view.k; if (Math.abs(dx) + Math.abs(dy) > 3) start.moved = true; n.position = [Math.round(start.p[0] + dx), Math.round(start.p[1] + dy)]; d.style.left = `${n.position[0]}px`; d.style.top = `${n.position[1]}px`; lines(); });
    // Un toucher parti d'un rond ou du « + » n'est pas un clic sur le bloc : on ne redessine pas (le bouton doit recevoir son clic).
    d.addEventListener('pointerup', () => { if (!start) return; if (start.moved) dirty = true; else { sel = n.name; draw(); drawSide(); } start = null; });
    // Entrée sur un bouton du bloc (rond, « + ») appartient à ce bouton.
    d.addEventListener('keydown', (e) => { if (e.target !== d) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sel = n.name; draw(); drawSide(); } if (e.key === 'Delete') removeNode(n.name); });
    return d;
  }
  function link(from, out, to) { if (relier(wf, from, out, to)) dirty = true; }
  /** Le point de la fenêtre (en coordonnées du schéma) où poser un bloc centré sous [px, py] (pixels dans la fenêtre). */
  const pointSchema = (px, py) => [Math.round((px - view.x) / view.k - NODE_W / 2), Math.round((py - view.y) / view.k - 30)];
  function draw() {
    const world = $('#drCanvas .dr-world'); if (!world) return;
    elems = new Map();
    world.replaceChildren(...wf.nodes.map((n) => { const d = nodeEl(n); elems.set(n.name, d); return d; })); lines();
    // Fenêtre vide : un grand « + » au centre, pour le premier bloc.
    const canvas = $('#drCanvas'); canvas.querySelector('.dr-vide')?.remove();
    if (!wf.nodes.length) canvas.append(el('div', { class: 'dr-vide' }, el('button', { type: 'button', class: 'dr-vide-plus', 'aria-label': 'Ajouter le premier bloc', onclick: () => { const r = canvas.getBoundingClientRect(); void ouvrirChoix({ a: r.width ? pointSchema(r.width / 2, r.height / 2) : [60, 160] }); } }, '+'), el('p', {}, 'Ajoute le premier bloc : ce qui fait partir l\'automatisation.')));
  }
  function lines() {
    const svg = $('#drCanvas svg'); if (!svg) return; svg.replaceChildren();
    const g = sv('g', { transform: `translate(${view.x} ${view.y}) scale(${view.k})` }); svg.append(g);
    for (const [from, list] of Object.entries(wf.connections)) {
      const a = wf.nodes.find((n) => n.name === from); if (!a) continue;
      list.forEach((targets, i) => (targets ?? []).forEach((l) => {
        const b = wf.nodes.find((n) => n.name === l.node); if (!b) return;
        const x1 = a.position[0] + NODE_W + 10, y1 = a.position[1] + 27 + i * 22, x2 = b.position[0] - 10, y2 = b.position[1] + 33, dx = Math.max(40, Math.abs(x2 - x1) / 2);
        const p = sv('path', { class: 'dr-link', d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` });
        p.addEventListener('click', async () => { if (await window.OdinDialog.confirm(`Retirer le lien ${from} → ${l.node} ?`)) { targets.splice(targets.indexOf(l), 1); dirty = true; draw(); } });
        g.append(p);
      }));
    }
  }
  function pan(canvas, world) {
    const apply = () => { world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`; lines(); };
    let s = null;
    // Cadrage : tout le schéma visible à l'ouverture.
    requestAnimationFrame(() => {
      const r = canvas.getBoundingClientRect(); if (!wf.nodes.length || !r.width) return;
      const xs = wf.nodes.map((n) => n.position[0]), ys = wf.nodes.map((n) => n.position[1]);
      const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + NODE_W + 30, y0 = Math.min(...ys) - 30, y1 = Math.max(...ys) + 90;
      view.k = Math.min(1.1, Math.max(0.4, Math.min(r.width / (x1 - x0), r.height / (y1 - y0))));
      view.x = (r.width - (x1 - x0) * view.k) / 2 - x0 * view.k; view.y = (r.height - (y1 - y0) * view.k) / 2 - y0 * view.k; apply();
    });
    canvas.addEventListener('pointerdown', (e) => { if (e.target !== canvas && !e.target.closest('svg')) return; s = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; canvas.setPointerCapture(e.pointerId); if (armed) { armed = null; draw(); } });
    canvas.addEventListener('pointermove', (e) => { if (!s) return; if (Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) > 6) s.moved = true; view.x = s.vx + e.clientX - s.x; view.y = s.vy + e.clientY - s.y; apply(); });
    // Double-clic (ou double toucher) sur un endroit vide : la même fenêtre que le « + », le bloc se pose là.
    let tap = null;
    canvas.addEventListener('pointerup', (e) => {
      const t = s && !s.moved ? { t: e.timeStamp, x: e.clientX, y: e.clientY } : null; s = null;
      if (!t) { tap = null; return; }
      if (!estDoubleTouche(tap, t)) { tap = t; return; }
      tap = null; const r = canvas.getBoundingClientRect(); void ouvrirChoix({ a: pointSchema(t.x - r.left, t.y - r.top) });
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); const k = Math.min(1.6, Math.max(0.4, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; view.x = mx - (mx - view.x) * (k / view.k); view.y = my - (my - view.y) * (k / view.k); view.k = k; apply(); }, { passive: false });
    apply();
  }
  async function removeNode(name) {
    if (!(await window.OdinDialog.confirm(`Retirer l'étape « ${name} » ?`))) return;
    wf.nodes = wf.nodes.filter((n) => n.name !== name); delete wf.connections[name];
    for (const list of Object.values(wf.connections)) for (const t of list) for (let i = t.length - 1; i >= 0; i--) if (t[i].node === name) t.splice(i, 1);
    sel = null; dirty = true; draw(); drawSide();
  }
  function drawSide() {
    const side = $('#drSide'); if (!side) return;
    const n = wf.nodes.find((x) => x.name === sel);
    if (!n) {
      const groups = [...new Set(st.catalog.map((c) => c.group))];
      side.replaceChildren(el('h2', {}, 'Ajouter une étape'), el('p', { class: 'sub', style: 'margin:0' }, 'Clique une étape pour l\'ajouter, puis relie-la.'), el('div', { class: 'dr-cat' }, ...groups.flatMap((g) => [el('h3', {}, g), ...st.catalog.filter((c) => c.group === g).map((c) => el('button', { type: 'button', title: c.what, onclick: () => addNode(c) }, c.label))])));
      return;
    }
    const c = cat(n.type), run = last?.nodes?.[n.name];
    // Planning : seul le champ du mode choisi se montre (un nœud sans mode garde son planning cron, comme avant).
    const planning = c?.type === 'déclencheur.planning' && (c.params ?? []).some((p) => p.key === 'mode'), mode = planning ? n.params.mode ?? 'cron' : undefined;
    const fields = (c?.params ?? []).map((p) => {
      if (planning && ((p.key === 'cron' && mode !== 'cron') || (p.key === 'minutes' && mode !== 'intervalle') || (p.kind === 'rythme' && mode !== 'simple'))) return [];
      const id = `drp-${p.key}`, v = planning && p.key === 'mode' ? mode : n.params[p.key] ?? p.default ?? '';
      const set = (val) => { n.params[p.key] = val; dirty = true; if (planning && p.key === 'mode') drawSide(); };
      if (p.kind === 'rythme') {
        // Le rythme en clair ; l'éditeur donne la valeur de départ tout de suite : ce n'est pas une modification.
        const setR = (val) => { const avant = n.params[p.key] ?? p.default; if (JSON.stringify(val) === JSON.stringify(avant)) { if (n.params[p.key] === undefined) n.params[p.key] = val; return; } set(val); };
        const input = window.OdinRythme ? window.OdinRythme.editeur({ valeur: v && typeof v === 'object' ? v : undefined, onChange: setR })
          : el('textarea', { id, spellcheck: 'false', oninput: (e) => { try { setR(JSON.parse(e.target.value)); } catch { /* pas encore un JSON */ } } }, JSON.stringify(v, null, 2));
        return [el('label', { for: id }, p.label, p.required ? ' *' : ''), input, p.help ? el('small', { class: 'sub' }, p.help) : null];
      }
      const input = p.kind === 'select' ? el('select', { id, onchange: (e) => set(e.target.value) }, ...(p.options ?? []).map((o) => el('option', { selected: o === v ? true : undefined }, o)))
        : p.kind === 'boolean' ? el('input', { id, type: 'checkbox', checked: v === true ? true : undefined, onchange: (e) => set(e.target.checked) })
        : p.kind === 'textarea' || p.kind === 'json' ? el('textarea', { id, oninput: (e) => set(e.target.value), spellcheck: 'false' }, typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v))
        : el('input', { id, type: p.kind === 'number' ? 'number' : 'text', value: String(v), oninput: (e) => set(p.kind === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value), spellcheck: 'false', autocomplete: 'off' });
      return [el('label', { for: id }, p.label, p.required ? ' *' : ''), input, p.help ? el('small', { class: 'sub' }, p.help) : null];
    });
    side.replaceChildren(el('h2', {}, c?.label ?? n.type), el('p', { class: 'sub', style: 'margin:0' }, c?.what ?? ''),
      el('label', { for: 'drNn' }, 'Nom de l\'étape'), el('input', { id: 'drNn', value: n.name, onchange: (e) => rename(n, e.target.value.trim()) }),
      ...fields.flat().filter(Boolean), // (un réglage sans aide donnait null, écrit « null » à l'écran)
      el('label', { class: 'va-chk', style: 'display:flex;gap:8px;align-items:center;font-weight:500' }, el('input', { type: 'checkbox', checked: n.disabled ? true : undefined, onchange: (e) => { n.disabled = e.target.checked || undefined; dirty = true; draw(); } }), 'Désactiver cette étape'),
      el('p', { class: 'sub', style: 'margin:0;font-size:13px' }, 'Expressions : {{ $json.champ }}, {{ $node["Étape"].json.champ }}, {{ $now }}.'),
      el('div', { class: 'dr-row' }, el('button', { class: 'btn small', type: 'button', onclick: () => test(n.name) }, 'Tester jusqu\'ici'), el('button', { class: 'btn small', type: 'button', onclick: () => removeNode(n.name) }, 'Retirer'), el('button', { class: 'btn small', type: 'button', onclick: () => { sel = null; draw(); drawSide(); } }, 'Fermer')),
      ...(run ? [el('h2', { style: 'margin-top:6px' }, 'Dernier passage'), el('pre', { class: 'dr-out' }, run.error ? `✗ ${run.error}` : JSON.stringify(run.items.slice(0, 5), null, 2))] : []));
  }
  // ---------------- La fenêtre du « + » : la grille des applis (icônes, recherche), puis les fonctions de l'appli
  // choisie (les graves grisées) ; plus bas, les outils de Talos. Fenêtre vide : d'abord QUAND elle part.
  // La grille et la liste des fonctions sont celles de « Faire un lien » (pages/talos-lien.js).
  let choix = null;
  function fermerChoix() { if (!choix) return; const { fond, retour } = choix; choix = null; fond.remove(); if (retour?.isConnected) retour.focus?.(); }
  const sansAccent = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  /** Les flèches déplacent le focus parmi les boutons de `box` (`cols` : le nombre de colonnes, 1 pour une liste). */
  function fleches(box, cols = () => 1) {
    box.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const bs = [...box.querySelectorAll('button')].filter((b) => !b.disabled), i = bs.indexOf(document.activeElement); if (i < 0) return;
      const j = pasFleche(i, bs.length, cols(bs), e.key); if (j !== i) { e.preventDefault(); bs[j].focus(); }
    });
  }
  const colonnes = (bs) => { const t = bs[0]?.offsetTop; return Math.max(1, bs.filter((b) => b.offsetTop === t).length); };
  let applisChargees = false, applisListe = null;
  /** Le bloc posé hors de la fenêtre (téléphone surtout) : on fait glisser le schéma juste assez pour le voir. */
  function montrer(n) {
    const canvas = $('#drCanvas'), world = $('#drCanvas .dr-world'), r = canvas?.getBoundingClientRect?.();
    if (!n || !world || !r?.width) return;
    const x = n.position[0] * view.k + view.x, y = n.position[1] * view.k + view.y, w = NODE_W * view.k, h = 70 * view.k, m = 24;
    if (x + w + m > r.width) view.x -= x + w + m - r.width; else if (x < m) view.x += m - x;
    if (y + h + m > r.height) view.y -= y + h + m - r.height; else if (y < m) view.y += m - y;
    world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`;
  }
  async function ouvrirChoix(ou = {}) {
    fermerChoix();
    const quand = modeChoix(wf) === 'quand', L = window.OdinLien;
    const titre = el('h2', { id: 'drChT' }), corps = el('div', { class: 'dr-ch-c' });
    const boite = el('div', { class: 'dr-choix', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drChT' }, el('div', { class: 'dr-ch-h' }, titre, el('button', { class: 'dr-ch-x', type: 'button', 'aria-label': 'Fermer', onclick: fermerChoix }, '×')), corps);
    const fond = el('div', { class: 'dr-choix-fond', onclick: (e) => { if (e.target === fond) fermerChoix(); } }, boite);
    boite.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermerChoix(); return; }
      if (e.key !== 'Tab') return;
      const f = [...boite.querySelectorAll('button, input')].filter((x) => !x.disabled); // ordre du document = ordre de l'écran
      const premier = boite.querySelector('.dr-ch-x'), dernier = f.filter((x) => x !== premier).pop() ?? premier;
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); } else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    });
    choix = { fond, retour: document.activeElement };
    document.body.append(fond);
    const prendre = (c) => {
      const r = poser(wf, c, ou);
      if (!r.ok) { void window.OdinDialog?.alert(r.error); return; }
      fermerChoix(); sel = r.name; dirty = true; montrer(wf.nodes.find((n) => n.name === r.name)); draw(); drawSide();
      const s = $('#drSt'); if (s) s.textContent = r.lien ? `✓ « ${r.name} » ajouté après « ${r.lien.de} ».` : `✓ « ${r.name} » ajouté.`;
      elems.get(r.name)?.focus?.();
    };
    const outils = (st?.catalog ?? []).filter((c) => (quand ? c.trigger && c.type !== 'déclencheur.module' : !c.trigger && c.type !== 'module.action'));
    const zoneOutils = el('div', { class: 'dr-ch-o', 'aria-label': quand ? 'Déclencheurs' : 'Outils de Talos' }); fleches(zoneOutils);
    function etape1() {
      titre.textContent = quand ? 'Quand l\'automatisation part-elle ?' : 'Ajouter un bloc';
      const cherche = el('input', { class: 'li-cherche', type: 'search', placeholder: 'Chercher une appli ou un outil', 'aria-label': 'Chercher une appli ou un outil', autocomplete: 'off' });
      const zoneApplis = el('div', {});
      let grille = null;
      const peindreOutils = (t) => {
        const garde = outils.filter((c) => !t || sansAccent(`${c.label} ${c.group}`).includes(t));
        const groupes = quand ? [''] : [...new Set(garde.map((c) => c.group))];
        zoneOutils.replaceChildren(...(garde.length ? groupes.flatMap((g) => [g ? el('h4', {}, g) : null, ...garde.filter((c) => !g || c.group === g).map((c) => el('button', { type: 'button', title: c.what ?? '', onclick: () => prendre(blocOutil(c)) }, el('b', {}, c.label), c.what ? el('small', {}, c.what) : null))]) : [el('p', { class: 'sub', style: 'margin:0' }, 'Aucun outil de ce nom.')]).filter(Boolean));
      };
      const peindreApplis = () => {
        if (!applisListe || !L?.grilleApplis) { zoneApplis.replaceChildren(el('p', { class: 'sub', style: 'margin:0' }, 'Les applis ne sont pas disponibles ici.')); return; }
        grille = L.grilleApplis(applisListe, etape2); fleches(grille.grille, colonnes); zoneApplis.replaceChildren(grille.grille);
        const t = cherche.value.trim(); if (t) grille.remplir(t.toLowerCase());
      };
      cherche.addEventListener('input', () => { const t = cherche.value.trim(); grille?.remplir(t.toLowerCase()); peindreOutils(sansAccent(t)); });
      cherche.addEventListener('keydown', (e) => { if (e.key !== 'ArrowDown') return; const b = zoneApplis.querySelector('button') ?? zoneOutils.querySelector('button'); if (b) { e.preventDefault(); b.focus(); } });
      corps.replaceChildren(...[quand ? el('p', { class: 'sub', style: 'margin:0' }, 'Le premier bloc dit quand elle part : quand une appli signale quelque chose, ou un des déclencheurs plus bas.') : null,
        cherche, el('h3', {}, 'Applis'), zoneApplis, el('h3', {}, quand ? 'Déclencheurs' : 'Outils de Talos'), zoneOutils].filter(Boolean));
      peindreOutils('');
      if (applisChargees || !L?.applis) peindreApplis();
      else {
        zoneApplis.replaceChildren(el('p', { class: 'sub', style: 'margin:0' }, 'Chargement des applis…'));
        void L.applis().then((l) => { applisChargees = Boolean(l); applisListe = Array.isArray(l) ? l : null; if (choix?.fond === fond && zoneApplis.isConnected !== false && corps.contains?.(zoneApplis) !== false) peindreApplis(); });
      }
      cherche.focus?.();
    }
    function etape2(a) {
      titre.replaceChildren(L.icone ? L.icone(a, 28) : '', a.nom);
      const retour = el('button', { class: 'btn small', type: 'button', onclick: etape1 }, '← Applis');
      let liste;
      if (quand) {
        const ev = [...new Set(a.evenements ?? [])].filter((x) => x !== 'alerte');
        const opts = [['', 'Quand elle signale quelque chose', 'Tout ce qu\'elle signale.'], ['alerte', 'Quand elle lance une alerte', 'À partir du niveau « haute », réglable ensuite.'], ...ev.map((x) => [x, `Quand elle signale « ${x} »`, ''])];
        liste = el('div', { class: 'li-fn', role: 'list', 'aria-label': `Ce que ${a.nom} signale` }, ...opts.map(([v, b, s]) => el('button', { type: 'button', role: 'listitem', onclick: () => prendre(blocSignal(a, v)) }, el('b', {}, b), s ? el('small', {}, s) : null)));
      } else if ((a.actions ?? []).length) liste = L.listeFonctions(a, { boutons: true, choisir: (f) => prendre(blocFonction(a, f)) });
      if (liste) fleches(liste);
      corps.replaceChildren(...[retour, el('h3', {}, quand ? 'Quand ?' : 'Ses fonctions'), liste ?? el('p', { class: 'sub', style: 'margin:0' }, 'Cette appli n\'a pas de fonction à lancer.')]);
      ([...(liste?.querySelectorAll('button') ?? [])].find((b) => !b.disabled) ?? retour).focus?.();
    }
    etape1();
  }
  function rename(n, to) {
    if (!to || to === n.name) return; if (wf.nodes.some((x) => x.name === to)) { void window.OdinDialog.alert('Ce nom est déjà pris.'); return; }
    const from = n.name; n.name = to;
    if (wf.connections[from]) { wf.connections[to] = wf.connections[from]; delete wf.connections[from]; }
    for (const list of Object.values(wf.connections)) for (const t of list) for (const l of t) if (l.node === from) l.node = to;
    if (outs[from]) { outs[to] = outs[from]; delete outs[from]; }
    sel = to; dirty = true; draw();
  }
  function addNode(c) {
    let name = c.label, k = 2; while (wf.nodes.some((n) => n.name === name)) name = `${c.label} ${k++}`;
    const lastN = wf.nodes[wf.nodes.length - 1], params = Object.fromEntries(c.params.filter((p) => p.default !== undefined).map((p) => [p.key, p.default]));
    const n = { name, type: c.type, params, position: lastN ? [lastN.position[0] + 240, lastN.position[1]] : [60, 160] };
    wf.nodes.push(n); if (lastN && !c.trigger && !(wf.connections[lastN.name] ?? []).some((t) => t.length)) link(lastN.name, 0, name);
    sel = name; dirty = true; draw(); drawSide();
  }
  async function save() {
    for (const n of wf.nodes) for (const p of cat(n.type)?.params ?? []) if (p.kind === 'json' && typeof n.params[p.key] === 'string' && n.params[p.key].trim()) { try { JSON.parse(n.params[p.key]); } catch { if (!/\{\{/.test(n.params[p.key])) { await window.OdinDialog.alert(`« ${n.name} » : ${p.label} n'est pas un JSON valide.`); return false; } } }
    // Premier enregistrement : dans quel dossier, brouillon ou active (pages/talos-dossiers.js) ; « Annuler » n'enregistre rien.
    if (!wf.id && window.OdinTalosDossiers) { const c = await window.OdinTalosDossiers.choisir(wf); if (!c) return false; if (c.dossier) wf.dossier = c.dossier; else delete wf.dossier; wf.active = c.active; }
    const neuve = !wf.id;
    const r = await api('/api/draupnir/save', { flow: wf });
    if (!r.ok) { await window.OdinDialog.alert(r.error); return false; }
    wf = r.flow; dirty = false;
    // Elle vient d'être créée : le choix « Dossier » rejoint la barre tout de suite (sinon seulement à la réouverture).
    if (neuve && wf.id && window.OdinTalosDossiers && !$('#v-flows .dr-bar .td-barre')) $('#drName')?.insertAdjacentElement('afterend', window.OdinTalosDossiers.barre(wf, () => wf)); const s = $('#drSt'); if (s) s.textContent = '✓ Enregistré.'; return true;
  }
  async function test(stopAfter) {
    if (!(await save())) return;
    const s = $('#drSt'); if (s) s.textContent = 'Test en cours…';
    const r = await api('/api/draupnir/run', { id: wf.id, stopAfter });
    if (!r.ok) { if (s) s.textContent = `✗ ${r.error}`; return; }
    last = r.run; if (s) s.textContent = `${r.run.status === 'succès' ? '✓' : '✗'} ${r.run.status} en ${r.run.ms} ms${r.run.error ? ` : ${r.run.error}` : ''}`;
    draw(); drawSide();
  }
  function init() { document.head.append(el('style', {}, css)); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.OdinFlows = { open: () => { if (!wf && !ailleurs) openList(); }, edit: openFlow, liste: openList, prendre: () => { ailleurs = true; jeton++; wf = null; fermerChoix(); },
    logique: { NODE_W, PAS_X, PAS_Y, nomLibre, placeLibre, sortieDuPlus, modeChoix, blocFonction, blocSignal, blocOutil, poser, pasFleche, estDoubleTouche } };
})();
