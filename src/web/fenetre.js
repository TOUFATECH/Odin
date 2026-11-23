// La fenêtre d'Odin (maquettes validées « Fenetre », « FenetreEdition », « FenetreTel ») : des pages de modules
// d'applis (chiffres clés ou une partie de la page d'une appli), la météo, des boutons sur mesure. Mode « Modifier » :
// glisser-déposer (souris et doigt), taille, retirer, pages (ajouter, renommer, supprimer), catalogue des modules,
// bouton sur mesure, thème. Rangée par Hestia (côté Odin) : la même sur l'ordinateur et le téléphone.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v === undefined || v === null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const api = async (path, body) => { const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } }); return r.json(); };
  // La grille de la maquette (12 colonnes, 4 au téléphone) : ses calculs sont dans pages/accueil-grille.js, chargé avant.
  const G = window.OdinGrille;
  // Les textes ajoutés au lot 15 (tirer le coin, les sept tailles), en un seul endroit.
  const TXT = {
    tailles: { petit: 'Petit', moyen: 'Moyen', large: 'Large', haut: 'Haut', grand: 'Grand', tresGrand: 'Très grand', bandeau: 'Bandeau' },
    boutonTailles: 'Choisir une taille', titreTailles: 'Taille du module', aideTailles: 'Ou tire le coin du module en mode Modifier, à la case près ; au clavier, Maj + flèches sur la poignée.',
    miniTailles: (m) => `Plus petit que ${m} : refusé pour ce module.`, aucuneTaille: 'Choisis une taille.', poignee: 'Déplacer (flèches) · Maj + flèches : changer la taille',
    taille: (t) => `Taille ${t}`, remise: (t) => `Taille remise à ${t}.`, refusee: (t) => `Taille ${t} : c'est la plus petite (ou la plus grande) possible pour ce module.`,
    // Lot 16 : glisser un module.
    range: '✓ Fenêtre rangée.', enMain: 'Mode Modifier : glisse le module où tu veux, puis « Terminé » pour garder.',
    place: (n, t) => `Module posé à la place ${n} sur ${t}.`, revenu: 'Déplacement annulé : le module est revenu à sa place.',
    deplace: 'Module déplacé.', annuler: 'Annuler', annule: 'Déplacement annulé.', tropTard: 'Trop tard pour annuler ce déplacement : la fenêtre a changé depuis.',
  };
  // Les calculs du glisser (appui long, rang d'insertion, défilement, « Annuler ») : pages/accueil-gestes.js, chargé avant.
  const OG = window.OdinGestes;
  // Les 12 animations de déplacement (lot 17) : pages/accueil-animations.js, chargé avant. Celle choisie joue quand un
  // module est déplacé ou agrandi ; avec « moins d'animations », rien ne bouge.
  const OA = window.OdinAnimations;
  const act = (module, action, input = {}, confirm) => api('/api/valhalla/act', { module, action, input, ...(confirm ? { confirm: true } : {}) });
  const css = `
#fenetre{margin:0 0 18px}.fe-bar{display:flex;gap:8px;align-items:center;margin:0 0 12px}.fe-bar .sp{flex:1}
.fe-tabs{display:flex;gap:8px;flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none;padding:3px;margin:-3px}.fe-tabs::-webkit-scrollbar{display:none}.fe-mod{flex:none}
.fe-tab{flex:none;white-space:nowrap;min-height:36px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13.5px inherit;cursor:pointer}.fe-tab[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.fe-edit .fe-tab[aria-pressed=true]{background:#fff;color:#10363a}.fe-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;border-radius:16px;background:#10363a;color:#fff;margin:0 0 12px}
.fe-tools .fe-tab{background:rgba(255,255,255,.12);color:#fff;border-color:transparent}.fe-tools b{display:flex;gap:6px;align-items:center;margin:0 6px}.fe-tools .btn{min-height:36px}
.fe-wrap{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}.fe-edit .fe-wrap{grid-template-columns:minmax(0,1fr) 330px}@media (max-width:980px){.fe-edit .fe-wrap{grid-template-columns:minmax(0,1fr)}}
${G.css('.fe-grid', '.fe-w')}.fe-grid{min-height:120px}.fe-w{container-type:inline-size}@container (max-width:130px){.fe-h{flex-wrap:wrap}.fe-h .fe-ic{display:none}}
.fe-w{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px 16px;min-width:0;box-shadow:0 10px 26px rgba(16,54,58,.08)}
.fe-w .va-kpi{padding:8px 10px}.fe-w .va-kpi b{font-size:20px}
.fe-w .va-sec{background:none;border:0;padding:0;margin:0}.fe-w .va-sec h2{display:none}.fe-w .va-kpis{margin:0;grid-template-columns:repeat(auto-fill,minmax(min(120px,100%),1fr))}
.fe-h{display:flex;gap:10px;align-items:center;margin:0 0 10px}.fe-h small{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700}.fe-h b{font-size:15.5px}
.fe-ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--field);font-weight:700;flex:none}.fe-ic-app{background:none}
.fe-open{margin-left:auto;font-size:12.5px;color:var(--muted);background:none;border:0;cursor:pointer;min-height:32px}
.fe-edit .fe-w{outline:2px dashed color-mix(in srgb,var(--accent,#0b7f7c) 55%,transparent);outline-offset:3px;touch-action:pan-y;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#fenetre .fe-h{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}@media (hover:hover){#fenetre:not(.fe-edit) .fe-h{cursor:grab}.fe-edit .fe-w{cursor:grab}}
body.fe-glisse,body.fe-glisse *{cursor:grabbing!important;-webkit-user-select:none!important;user-select:none!important}
.fe-chrome{display:none;position:absolute;top:-12px;right:-6px;gap:4px}.fe-edit .fe-chrome{display:flex}.fe-chrome button{width:30px;height:30px;border-radius:9px;border:1px solid var(--line);background:var(--panel);cursor:pointer;display:grid;place-items:center;font-size:14px}
.fe-grip{display:none;position:absolute;top:-12px;left:-6px;width:30px;height:30px;border-radius:9px;background:#10363a;color:#fff;border:0;cursor:grab;font-size:15px;touch-action:none}.fe-edit .fe-grip{display:grid;place-items:center}
.fe-rz{display:none}.fe-edit .fe-rz{display:block;position:absolute;right:0;bottom:0;width:44px;height:44px;z-index:5;cursor:nwse-resize;touch-action:none;border-radius:0 0 18px 0}
.fe-edit .fe-rz::before{content:"";position:absolute;right:10px;bottom:10px;width:14px;height:14px;border-right:3px solid var(--accent,#0b7f7c);border-bottom:3px solid var(--accent,#0b7f7c);border-radius:0 0 6px 0}
.fe-szb{display:none;position:absolute;right:46px;bottom:12px;z-index:5;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:7px;background:var(--accent,#0b7f7c);color:#fff;pointer-events:none;font-variant-numeric:tabular-nums}.fe-w.resizing .fe-szb{display:block}.fe-edit .fe-w.resizing{outline-style:solid}
/* Carte étroite (moins de 160 px) : boutons de 24 px et poignée en bas à gauche, rien ne se chevauche. */@container (max-width:125px){.fe-edit .fe-chrome{gap:2px}.fe-edit .fe-chrome button{width:24px;height:24px;border-radius:7px;font-size:12px}.fe-edit .fe-grip{top:auto;bottom:-12px}}
.fe-dit{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.fe-sizes{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px;margin:4px 0}.fe-form .fe-sizes label{display:flex;gap:8px;align-items:center;min-height:44px;margin:0;padding:0 10px;border:1px solid var(--line);border-radius:12px;font-weight:600;cursor:pointer}.fe-form .fe-sizes input{flex:none;width:18px;height:18px;min-height:0;margin:0;padding:0;accent-color:var(--accent,#0b7f7c)}.fe-sizes label:has(input:checked){border-color:var(--accent,#0b7f7c)}.fe-sizes small{color:var(--muted);font-weight:500;margin-left:auto;font-variant-numeric:tabular-nums}
/* Pendant le glisser : un cadre en pointillé à la place du module, une copie qui suit le pointeur. */
.fe-w.dragging{background:transparent;box-shadow:none;border:2px dashed color-mix(in srgb,var(--accent,#0b7f7c) 70%,transparent);outline:0}.fe-w.dragging>*{visibility:hidden}
.fe-ghost{position:fixed;left:0;top:0;margin:0;z-index:80;pointer-events:none;box-shadow:0 24px 60px rgba(16,54,58,.35);opacity:.95;will-change:transform;transition:none}
.fe-annuler{display:flex;gap:12px;align-items:center}.fe-annuler .btn{min-height:44px}
.fe-drop{border:2px dashed var(--line);border-radius:18px;min-height:90px;display:grid;place-items:center;color:var(--muted)}
.fe-cat{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px;max-height:calc(100vh - 140px);overflow:auto;position:sticky;top:12px}
.fe-cat h2{font-size:17px;margin:0 0 8px}.fe-cat input{width:100%;min-height:40px;border-radius:12px;border:1px solid var(--field);background:var(--panel2);padding:0 12px;margin:0 0 10px}
.fe-cat h3{font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:12px 0 6px}
.fe-item{display:flex;gap:10px;align-items:center;width:100%;text-align:left;padding:10px;border-radius:12px;border:1px solid var(--line);background:var(--panel2);margin:0 0 6px;cursor:grab;color:var(--ink)}.fe-item small{display:block;color:var(--muted)}
.fe-own{background:#10363a;color:#fff;border-radius:14px;padding:12px;margin:12px 0 0}.fe-own .btn{margin-top:8px}
.fe-form label{display:block;font-size:13px;font-weight:600;margin:8px 0 4px}.fe-form select,.fe-form input{width:100%;min-height:38px;border-radius:10px;border:1px solid var(--field);padding:0 10px;background:var(--panel)}
.fe-btnw{display:flex;flex-direction:column;gap:8px}.fe-btnw .btn{min-height:46px;font-size:15px}
.fe-wx{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center}.fe-wx>div{min-width:0}.fe-wx b{font-size:34px}.fe-hours{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 10px;margin-top:10px;font-size:12.5px;color:var(--muted)}.fe-hours span{white-space:nowrap}
.fe-err{color:var(--muted);font-size:13.5px}
.fe-clock{display:flex;flex-direction:column;gap:2px}.fe-clock-h{font-size:clamp(22px,24cqi,38px);line-height:1.1;font-variant-numeric:tabular-nums}.fe-clock-d{font-size:15px}.fe-clock-d::first-letter{text-transform:uppercase}.fe-clock small{color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}
.fe-site{display:flex;flex-direction:column;gap:3px;padding-left:12px;border-left:4px solid var(--line)}.fe-site b{font-size:20px}.fe-site small{color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}.fe-site.bon{border-color:var(--good)}.fe-site.mauvais{border-color:var(--bad)}.fe-site.attention{border-color:var(--warn)}`;
  document.head.append(el('style', {}, css + OA.CSS));

  let L = null, cur = 0, edit = false, saved = '', cat = null, views = new Map(), timer = 0, dessin = { cur: -1, edit: false };
  const host = () => $('#fenetre');
  const page = () => L.pages[Math.min(cur, L.pages.length - 1)];
  const modName = (id) => cat?.modules?.find((m) => m.id === id)?.name ?? id;
  const modFam = (id) => cat?.modules?.find((m) => m.id === id)?.family ?? '';

  async function load() {
    const [f, c] = await Promise.all([act('gladsheim', 'fenetre'), cat ? Promise.resolve(cat) : api('/api/valhalla/catalog')]);
    cat = c; if (!f.ok) throw new Error(f.text || f.error || 'fenêtre indisponible');
    L = f.data; saved = JSON.stringify(L); if ('animation' in L) OA.regler(L.animation, true); try { cur = Math.min(Number(localStorage.getItem('odin.fenetre.page') || 0), L.pages.length - 1); } catch { cur = 0; }
  }
  /** Les vues des applis de la page (une fois chacune). */
  async function fetchViews() {
    const ids = [...new Set(page().widgets.filter((w) => w.module && w.kind !== 'bouton').map((w) => w.module))];
    await Promise.all(ids.map(async (id) => { try { const r = await api(`/api/valhalla/view?id=${encodeURIComponent(id)}`); if (r.ok) views.set(id, r.view); } catch { /* hors ligne */ } }));
  }
  let meteoVue = null; // la dernière météo reçue, remontrée (marquée ancienne) quand Internet est coupé
  async function weather() { try { const r = await act('gladsheim', 'meteo', {}); if (r.ok && r.data) { meteoVue = r.data; return r.data; } return null; } catch { return null; } }
  // Météo absente : distinguer « pas d'Internet » (on remontre la dernière, marquée ancienne) de « ville non réglée ».
  function meteoRepli() {
    if (window.OdinReseau && !window.OdinReseau.enLigne() && window.OdinHorsLigne) {
      const net = window.OdinReseau.etat(), v = meteoVue;
      return window.OdinHorsLigne.message({ quoi: 'La météo n\'a pas pu être mise à jour', hote: 'api.open-meteo.com', depuis: net && net.depuis,
        ancien: v ? `${Math.round(v.temp ?? v.now?.temp ?? 0)}° ${v.text ?? v.now?.text ?? ''}${v.place || v.ville ? ` · ${v.place ?? v.ville}` : ''}`.trim() : undefined, onReessayer: () => draw() });
    }
    return el('p', { class: 'fe-err' }, 'Météo indisponible (choisis ta ville dans Hestia).');
  }
  /** Le lieu d'Odin (village, fuseau, heure sur 12 ou 24 h) : gardé une minute. */
  let lieuVu = null, lieuAt = 0;
  async function lieu() {
    if (lieuVu && Date.now() - lieuAt < 60_000) return lieuVu;
    try { const r = await act('gladsheim', 'region_actuelle', {}); if (r.ok && r.data) { lieuVu = { nom: r.data.ville, fuseau: r.data.fuseau, h12: r.data.region?.heure === '12h', suppose: r.data.suppose }; lieuAt = Date.now(); } } catch { /* hors ligne : dernier lieu connu */ }
    return lieuVu;
  }
  /** L'heure et la date dans le fuseau d'Odin (pas celui de l'appareil) ; rafraîchies toutes les 10 secondes. */
  const heureDe = (l, d = new Date()) => { const o = l?.fuseau ? { timeZone: l.fuseau } : {}; try { return [d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: Boolean(l?.h12), ...o }), d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', ...o })]; } catch { return [d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })]; } };
  function horloge(l) {
    const h = el('b', { class: 'fe-clock-h' }), j = el('div', { class: 'fe-clock-d' }), box = el('div', { class: 'fe-clock' }, h, j, el('small', {}, `${l?.nom || 'Lieu non réglé'}${l?.fuseau ? ` · ${l.fuseau}` : ''}${l?.suppose ? ' · supposé' : ''}`));
    const maj = () => { if (!box.isConnected && box.dataset.vu) return clearInterval(t); box.dataset.vu = '1'; [h.textContent, j.textContent] = heureDe(l); };
    const t = setInterval(maj, 10_000); maj();
    return box;
  }

  // ------------------------------------------------------------------ dessin d'un module
  async function widget(w) {
    const box = el('article', { class: 'fe-w', 'data-id': w.id, style: G.style(w) });
    const grip = el('button', { class: 'fe-grip', type: 'button', title: TXT.poignee, 'aria-label': 'Déplacer ce module', onkeydown: (e) => { if (e.shiftKey) { if (tailleClavier(w, e.key, box)) e.preventDefault(); return; } if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { move(w.id, -1); e.preventDefault(); } if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { move(w.id, 1); e.preventDefault(); } } }, '⠿');
    grip.addEventListener('pointerdown', (e) => startDrag(e, box, w.id));
    // Attraper la carte elle-même (lot 16) : à la souris, son en-tête ou son vide (tout, en mode Modifier) ; au doigt, un appui long.
    box.addEventListener('pointerdown', (e) => attraper(e, box, w.id));
    const chrome = el('div', { class: 'fe-chrome' },
      el('button', { type: 'button', title: 'Taille (4, 8 ou 12 colonnes sur 12)', 'aria-label': 'Changer la taille', onclick: () => { w.w = G.agrandir(w); draw(); } }, '↔'),
      el('button', { type: 'button', title: TXT.boutonTailles, 'aria-label': TXT.boutonTailles, onclick: () => tailles(w) }, '⤡'),
      w.kind === 'section' || w.kind === 'chiffres' ? el('button', { type: 'button', title: 'Choisir ce qu\'il montre', 'aria-label': 'Réglages du module', onclick: () => configure(w) }, '⚙') : null,
      el('button', { type: 'button', title: 'Retirer', 'aria-label': 'Retirer ce module', onclick: () => { page().widgets = page().widgets.filter((x) => x.id !== w.id); draw(); } }, '✕'));
    // Le coin (44 px) : tiré à la souris ou au doigt, la taille saute de case en case ; caché aux lecteurs d'écran
    // (au clavier : Maj + flèches sur la poignée). L'étiquette « c × r » se montre pendant le geste.
    const rz = el('span', { class: 'fe-rz', 'aria-hidden': 'true' }), szb = el('b', { class: 'fe-szb', 'aria-hidden': 'true' });
    rz.addEventListener('pointerdown', (e) => startResize(e, box, w, szb));
    box.append(grip, chrome, rz, szb);
    // L'icône de l'appli (comme sur la page Applis) ; sinon un symbole ou la première lettre.
    const icOf = (mod, icon, title) => { if (mod && window.OdinAppIcons) { const sp = el('span', { class: 'fe-ic fe-ic-app', 'aria-hidden': 'true' }); sp.innerHTML = window.OdinAppIcons.tile(mod, modName(mod), 34); return sp; } return el('span', { class: 'fe-ic', 'aria-hidden': 'true' }, icon ?? (title || '?').slice(0, 1)); };
    const head = (title, small, icon, mod = w.module) => el('div', { class: 'fe-h' }, icOf(mod, icon, title), el('div', {}, el('small', {}, small), el('b', {}, title)),
      w.module ? el('button', { class: 'fe-open', type: 'button', onclick: () => { location.hash = `#app=${w.module}`; } }, 'Ouvrir ›') : null);
    if (w.kind === 'meteo') {
      const d = await weather();
      box.append(head(w.label || 'Météo', 'Hestia', '☀', 'gladsheim'), d ? el('div', {}, el('div', { class: 'fe-wx' }, el('b', {}, `${Math.round(d.temp ?? d.now?.temp ?? 0)}°`), el('div', {}, el('div', {}, d.text ?? d.now?.text ?? ''), el('small', { class: 'sub' }, d.place ?? d.ville ?? ''))),
        Array.isArray(d.hours) && d.hours.length ? el('div', { class: 'fe-hours' }, ...d.hours.slice(0, 5).map((h) => { const at = typeof h.t === 'string' ? h.t.replace(':00', ' h').replace(':', ' h ') : `${h.h ?? h.hour ?? ''} h`, t = Number(h.temp ?? h.t); return el('span', {}, Number.isFinite(t) ? `${at} · ${Math.round(t)}°` : at); })) : null) : meteoRepli());
      return box;
    }
    if (w.kind === 'heure') { box.append(head(w.label || 'Heure et lieu', 'Hestia', '🕒', 'gladsheim'), horloge(await lieu())); return box; }
    if (w.kind === 'site') {
      // Un site surveillé : la sonde de Pulsar qui porte ce nom (état, temps de réponse, disponibilité).
      const r = (views.get('vordr')?.sections ?? []).find((x) => x.kind === 'table' && x.title === 'Sondes')?.rows?.find((x) => x.cells[0] === w.label);
      box.append(head(w.label, 'Pulsar · site surveillé', '🌐', 'vordr'), r
        ? el('div', { class: `fe-site ${r.tone || ''}` }, el('b', {}, r.cells[3] || '—'), el('small', {}, [r.cells[2], r.cells[6]].filter(Boolean).join(' · ')), el('small', {}, `24 h : ${r.cells[4] || '—'} · 30 jours : ${r.cells[5] || '—'}`))
        : el('p', { class: 'fe-err' }, 'Cette sonde n\'existe pas (ou plus) dans Pulsar.'));
      return box;
    }
    if (w.kind === 'bouton') {
      box.append(head(w.label || w.action, modName(w.module), '⚡'), el('div', { class: 'fe-btnw' }, el('button', { class: 'btn primary', type: 'button', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { let r = await act(w.module, w.action, w.input || {}); if (r.confirm) r = (await window.OdinDialog.confirm(r.confirm, { danger: true })) ? await act(w.module, w.action, w.input || {}, true) : { ok: true, text: 'Annulé.' }; say(r.ok ? r.text : `✗ ${r.text ?? r.error}`); }
        finally { b.disabled = false; }
      } }, w.label || w.action)));
      return box;
    }
    const v = views.get(w.module);
    box.append(head(w.label || (w.kind === 'section' ? w.section : modName(w.module)), `${modName(w.module)}${modFam(w.module) ? ` · ${modFam(w.module)}` : ''}`));
    if (!v) { box.append(el('p', { class: 'fe-err' }, 'Appli indisponible pour l\'instant.')); return box; }
    if (w.kind === 'chiffres') {
      box.append(v.kpis?.length ? el('div', { class: 'va-kpis' }, ...v.kpis.slice(0, w.w * 2 + 1).map((k) => el('div', { class: `va-kpi ${k.tone ?? ''}`, title: k.hint ?? '' }, el('small', {}, k.label), el('b', {}, k.value), typeof k.pct === 'number' ? el('div', { class: 'va-bar' }, el('i', { style: `width:${Math.max(0, Math.min(100, k.pct))}%` })) : null)))
        : el('p', { class: 'fe-err' }, v.subtitle || 'Pas de chiffres pour cette appli : choisis une partie de sa page (⚙).'));
      return box;
    }
    const s = [...(v.sections ?? []), ...(v.side ?? [])].find((x) => x.title === w.section);
    box.append(s && window.OdinApps?.section ? window.OdinApps.section(w.module, s) : el('p', { class: 'fe-err' }, `« ${w.section} » n'est plus sur la page de ${modName(w.module)}.`));
    return box;
  }
  function say(t) { const n = el('div', { class: 'va-out', role: 'status', style: 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:90;max-width:min(560px,calc(100% - 32px))' }, t); document.body.append(n); setTimeout(() => n.remove(), 5000); }

  // ------------------------------------------------------------------ la page
  async function draw() {
    const h = host(); if (!h || !L) return;
    // Le focus du clavier survit au nouveau dessin : le même bouton du même module (« Taille », « ⚙ »…), s'il est encore là.
    const actif = document.activeElement, carteActive = actif?.closest?.('#feGrid .fe-w')?.dataset.id, nomActif = actif?.getAttribute?.('aria-label');
    // La même page, dans le même mode : les modules qui changent de place ou de taille glissent avec l'animation choisie.
    const memeVue = Boolean(h.querySelector('#feGrid')) && dessin.cur === cur && dessin.edit === edit;
    h.classList.toggle('fe-edit', edit);
    const tabs = L.pages.map((p, i) => el('button', { class: 'fe-tab', type: 'button', 'aria-pressed': String(i === cur), onclick: async () => { cur = i; try { localStorage.setItem('odin.fenetre.page', String(i)); } catch { /* */ } await fetchViews(); draw(); }, ondblclick: () => edit && rename(i) }, p.name, p.maison ? ' 🏠' : ''));
    const bar = edit
      ? el('div', { class: 'fe-tools', role: 'toolbar', 'aria-label': 'Modifier la fenêtre' }, el('b', {}, '✎ Modifier'), ...tabs,
        el('button', { class: 'fe-tab', type: 'button', title: 'Ajouter une page', 'aria-label': 'Ajouter une page', onclick: async () => { const n = await window.OdinDialog.prompt('Nom de la nouvelle page', 'Ma page'); if (n) { L.pages.push({ id: '', name: n.slice(0, 24), widgets: [] }); cur = L.pages.length - 1; draw(); } } }, '+'),
        el('button', { class: 'fe-tab', type: 'button', onclick: () => rename(cur) }, 'Renommer'),
        L.pages.length > 1 ? el('button', { class: 'fe-tab', type: 'button', onclick: async () => { if (await window.OdinDialog.confirm(`Supprimer la page « ${page().name} » ?`, { danger: true })) { L.pages.splice(cur, 1); cur = 0; draw(); } } }, 'Supprimer la page') : null,
        el('button', { class: 'fe-tab', type: 'button', 'aria-pressed': String(Boolean(page().maison)), title: 'Montrer cette page sur l\'écran de la maison', onclick: () => { page().maison = !page().maison; draw(); } }, '🏠 Écran de la maison'),
        el('span', { class: 'sp' }), themeBtn(),
        el('button', { class: 'btn small', type: 'button', onclick: async () => { L = JSON.parse(saved); edit = false; await fetchViews(); draw(); } }, 'Annuler'),
        el('button', { class: 'btn small primary', type: 'button', onclick: save }, 'Terminé'))
      // Les onglets restent sur une seule ligne : s'il y a beaucoup de pages, leur rangée défile, « Modifier » reste à droite.
      : el('div', { class: 'fe-bar' }, el('div', { class: 'fe-tabs', role: 'group', 'aria-label': 'Pages de la fenêtre' }, ...tabs), el('button', { class: 'btn small primary fe-mod', type: 'button', onclick: () => { edit = true; draw(); } }, '✎ Modifier'));
    const grid = el('div', { class: 'fe-grid', id: 'feGrid' });
    for (const w of page().widgets) grid.append(await widget(w));
    if (!page().widgets.length) grid.append(el('div', { class: 'fe-drop', style: 'grid-column:1/-1' }, edit ? 'Glisse ici un module du catalogue (ou clique dessus).' : 'Page vide : « Modifier » pour ajouter des modules.'));
    if (edit) { grid.addEventListener('dragover', (e) => e.preventDefault()); grid.addEventListener('drop', (e) => { e.preventDefault(); const d = e.dataTransfer.getData('text/odin-module'); if (d) add(JSON.parse(d)); }); }
    const poserTout = () => h.replaceChildren(bar, el('div', { class: 'fe-wrap' }, grid, edit ? catalogue() : null));
    if (memeVue) OA.jouer(() => h.querySelectorAll('#feGrid > .fe-w'), poserTout); else poserTout();
    dessin = { cur, edit };
    if (carteActive && nomActif && !h.contains(document.activeElement)) [...grid.querySelectorAll('.fe-w')].find((n) => n.dataset.id === carteActive)?.querySelector(`[aria-label="${CSS.escape(nomActif)}"]`)?.focus();
  }
  async function rename(i) { const n = await window.OdinDialog.prompt('Nom de la page', L.pages[i].name); if (n) { L.pages[i].name = n.slice(0, 24); draw(); } }
  function themeBtn() {
    const themes = window.OdinThemes?.ORDER ?? [];
    const sel = el('select', { 'aria-label': 'Thème', style: 'min-height:36px;border-radius:999px;padding:0 10px;background:#fff;color:#10363a;border:0', onchange: async (e) => { const r = await act('apparence', 'theme', { theme: e.target.value }); say(r.ok ? r.text : `✗ ${r.text ?? r.error}`); } },
      el('option', { value: '' }, '🎨 Thème…'), el('option', { value: 'automatique' }, 'Automatique'), ...themes.map((t) => el('option', { value: t }, window.OdinThemes.THEMES[t]?.name ?? t)));
    return sel;
  }
  /**
   * Les rangements chez Hestia passent un par un, dans l'ordre : deux réponses qui se croisent n'écrasent pas la
   * fenêtre gardée (`saved`) avec une ancienne.
   */
  let fileRangement = Promise.resolve();
  function enFile(f) { const p = fileRangement.then(f); fileRangement = p.catch(() => undefined); return p; }
  /**
   * Range la fenêtre chez Hestia (« Terminé », un déplacement hors du mode Modifier, son « Annuler ») ; `dit` : ce qui
   * est annoncé. Rend vrai si c'est rangé. `o.deplacement` : la fenêtre `o.fenetre` notée au lâcher est rangée sans
   * fermer le mode Modifier ouvert depuis et sans écraser ce qui a changé à l'écran depuis, puis « Annuler » est offert.
   * `o.enFile` : déjà dans la file des rangements.
   */
  async function save(_e, dit = TXT.range, o = {}) {
    if (!o.enFile) return enFile(() => save(_e, dit, { ...o, enFile: true }));
    const avant = saved, envoye = o.fenetre ?? JSON.stringify(L);
    if (o.deplacement && envoye === avant) return true; // déjà rangé (un rangement plus récent l'a emporté)
    const r = await act('gladsheim', 'regler_fenetre', { fenetre: envoye });
    const rienDepuis = !edit && JSON.stringify(L) === envoye; // l'écran montre encore ce qui vient d'être rangé
    if (!r.ok) { say(`✗ ${r.text ?? r.error}`); if (o.deplacement && rienDepuis) { L = JSON.parse(avant); if (!glisse && !appuiEnCours) draw(); } return false; }
    saved = JSON.stringify(r.data);
    if (o.deplacement) { if (rienDepuis) L = r.data; proposerAnnuler(OG.offre(avant, saved, Date.now())); return true; }
    L = r.data; edit = false; if (dit) say(dit); await fetchViews(); draw();
    return true;
  }
  function move(id, d) { if (glisse) return; const l = page().widgets, i = l.findIndex((x) => x.id === id), j = i + d; if (i < 0 || j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; draw().then(() => $(`.fe-w[data-id="${id}"] .fe-grip`)?.focus()); }
  // ------------------------------------------------------------------ glisser un module (lot 16)
  /** Le glisser en cours (un seul geste à la fois, un seul pointeur), l'appui long qui attend, l'heure du dernier lâcher. */
  let glisse = null, appuiEnCours = null, finGlisse = 0;
  const reduit = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const idsDe = (grid) => [...grid.querySelectorAll(':scope > .fe-w')].map((n) => n.dataset.id);
  /** Ce qui défile autour de la grille (la colonne de l'accueil), sinon la page. */
  function defileur(n) {
    for (let p = n?.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p; }
    return document.scrollingElement || document.documentElement;
  }
  /**
   * Un appui sur la carte d'un module (pas sur sa poignée, ni sur son coin) : selon l'endroit, le pointeur et le mode,
   * le glisser s'arme, l'appui long attend, ou rien (un bouton, un lien, un texte à sélectionner hors du mode Modifier).
   */
  function attraper(e, box, id) {
    const t = e.target;
    if (glisse || appuiEnCours || coinEnCours || !t?.closest || t.closest('.fe-grip')) return;
    const c = t.closest(OG.CONTROLES);
    const z = OG.zone({ coin: Boolean(t.closest('.fe-rz')), controle: Boolean(c && c !== box && box.contains(c)), entete: Boolean(t.closest('.fe-h')), texte: OG.aDuTexte(t) });
    const quoi = OG.depart({ pointeur: e.pointerType, modifier: edit, zone: z, bouton: e.button, principal: e.isPrimary !== false });
    if (quoi === 'glisser') startDrag(e, box, id);
    else if (quoi === 'appuiLong') appuiLong(e, box, id);
  }
  /**
   * Au doigt : l'appui long (480 ms sans bouger). S'il bouge avant, il fait défiler la page : l'appui est oublié.
   * Tenu : hors du mode Modifier, ce mode s'ouvre ; puis le module est en main et suit le doigt.
   */
  function appuiLong(e, box, id) {
    const pid = e.pointerId, x0 = e.clientX, y0 = e.clientY, t0 = performance.now(), cible = e.target, r0 = box.getBoundingClientRect();
    const etat = { x: x0, y: y0, tenu: false, lache: false };
    appuiEnCours = etat;
    // La page ne défile plus une fois le module en main (le doigt reste sur sa cible d'origine, même redessinée).
    const bloque = (t) => { if (etat.tenu || glisse) t.preventDefault(); };
    const menu = (t) => { if (appuiEnCours || glisse) t.preventDefault(); };
    cible.addEventListener('touchmove', bloque, { passive: false }); cible.addEventListener('contextmenu', menu);
    const liberer = () => { cible.removeEventListener('touchmove', bloque); cible.removeEventListener('contextmenu', menu); };
    const POINTEUR = ['pointermove', 'pointerup', 'pointercancel'];
    const fini = () => { clearTimeout(minuteur); for (const t of POINTEUR) removeEventListener(t, ev); removeEventListener('blur', ev); if (appuiEnCours === etat) appuiEnCours = null; };
    function ev(v) {
      if (v.type === 'blur') { fini(); liberer(); return; }
      if (v.pointerId !== pid) return;
      if (v.type !== 'pointermove') { if (etat.tenu) { etat.lache = true; return; } fini(); liberer(); return; }
      etat.x = v.clientX; etat.y = v.clientY;
      if (!etat.tenu && OG.appui({ dx: etat.x - x0, dy: etat.y - y0, ecoule: performance.now() - t0 }) === 'annuler') { fini(); liberer(); }
    }
    const minuteur = setTimeout(async () => {
      if (OG.appui({ dx: etat.x - x0, dy: etat.y - y0, ecoule: performance.now() - t0 }) !== 'tenir') { fini(); liberer(); return; }
      etat.tenu = true;
      try { navigator.vibrate?.(18); } catch { /* */ }
      if (!edit) { edit = true; await draw(); say(TXT.enMain); }
      fini();
      const nb = [...document.querySelectorAll('#feGrid > .fe-w')].find((n) => n.dataset.id === id);
      if (etat.lache || !nb) { liberer(); return; }
      startDrag({ pointerId: pid, pointerType: e.pointerType, button: 0, clientX: etat.x, clientY: etat.y, preventDefault() { /* déjà tenu */ } }, nb, id,
        { tenu: true, rel: [(x0 - r0.left) / (r0.width || 1), (y0 - r0.top) / (r0.height || 1)], liberer });
    }, OG.MESURES.appuiLong);
    for (const t of POINTEUR) addEventListener(t, ev);
    addEventListener('blur', ev);
  }
  /**
   * Glisser-déposer à la souris et au doigt : la copie suit le pointeur, un cadre en pointillé reste à la place, le
   * module prend la place de celui qu'il survole (selon la moitié), la page défile près du haut ou du bas.
   * Un seul pointeur compte ; Échap, ou la fenêtre qui perd le focus, remet l'ordre d'avant.
   * Au lâcher : en mode Modifier, rien n'est gardé avant « Terminé » ; hors de ce mode, c'est rangé tout de suite et
   * « Annuler » est offert quelques secondes.
   */
  function startDrag(e, box, id, o = {}) {
    if (glisse || coinEnCours || e.button > 0) { o.liberer?.(); return; }
    e.preventDefault();
    const grid = box.parentNode, pid = e.pointerId, x0 = e.clientX, y0 = e.clientY, modifier = edit, M = OG.mouvement(reduit()), P = OA.prise(OA.actuelle(), M);
    const ordre0 = idsDe(grid), sel0 = String(window.getSelection?.() ?? ''), scr = defileur(grid);
    let ghost = null, gx = 0, gy = 0, x = x0, y = y0, lx = x0, dernier = 0, raf = 0;
    glisse = { id };
    const pose = () => { ghost.style.transform = `translate(${x - gx}px,${y - gy}px) rotate(${Math.max(-P.incline, Math.min(P.incline, (x - lx) * P.facteur))}deg) scale(${P.leve})`; lx = x; };
    const commencer = () => {
      const r = box.getBoundingClientRect();
      gx = o.rel ? Math.min(r.width, o.rel[0] * r.width) : x0 - r.left; gy = o.rel ? Math.min(r.height, o.rel[1] * r.height) : y0 - r.top;
      ghost = box.cloneNode(true); ghost.classList.add('fe-ghost'); ghost.classList.remove('resizing'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
      for (const n of ghost.querySelectorAll('[id]')) n.removeAttribute('id');
      ghost.style.width = `${r.width}px`; ghost.style.height = `${r.height}px`; if (P.classe) ghost.classList.add(P.classe);
      document.body.append(ghost); box.classList.add('dragging'); document.body.classList.add('fe-glisse');
      try { window.getSelection?.()?.removeAllRanges(); } catch { /* */ }
      pose();
      if (M.prise && ghost.animate) ghost.animate([{ transform: `translate(${r.left}px,${r.top}px)` }, { transform: ghost.style.transform }], { duration: M.prise, easing: 'ease-out' });
    };
    /**
     * Le module visé sous le pointeur : le nôtre prend sa place, avant ou après lui. Côte à côte, la moitié droite
     * (ou le bas) de la carte visée place après elle (la grille) ; une carte seule sur sa rangée (le téléphone) : sa
     * moitié du bas.
     */
    const viser = (ev) => {
      const now = performance.now(); if (now - dernier < OG.MESURES.echange) return;
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.fe-w');
      if (!t || t === box || t.parentNode !== grid) return;
      const cartes = [...grid.querySelectorAll(':scope > .fe-w')], a = cartes.indexOf(box), r = t.getBoundingClientRect();
      const to = OG.seule(r, grid.clientWidth) ? G.rang(a, cartes.indexOf(t), OG.apres(ev.clientX, ev.clientY, r, grid.clientWidth))
        : G.rang(a, cartes.indexOf(t), G.apres(ev.clientX, ev.clientY, t.getBoundingClientRect()));
      if (to === a) return;
      dernier = now;
      // Les autres modules glissent à leur nouvelle place avec l'animation choisie (celui qu'on tient reste un cadre).
      const reste = cartes.filter((n) => n !== box); OA.jouer(() => grid.querySelectorAll(':scope > .fe-w'), () => grid.insertBefore(box, reste[to] ?? null), { sauf: id });
    };
    const bords = () => { if (scr === document.scrollingElement || scr === document.documentElement) return [0, innerHeight]; const r = scr.getBoundingClientRect(); return [Math.max(0, r.top), Math.min(innerHeight, r.bottom)]; };
    const defiler = () => {
      raf = 0; if (!glisse || !ghost) return;
      const [h, b] = bords(), v = OG.defilement(y, h, b); if (!v) return;
      const avant = scr.scrollTop; scr.scrollTop += v; if (scr.scrollTop === avant) return;
      viser({ clientX: x, clientY: y }); raf = requestAnimationFrame(defiler);
    };
    const fin = (annule) => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); removeEventListener('keydown', touche, true); removeEventListener('blur', touche);
      if (raf) cancelAnimationFrame(raf); raf = 0; o.liberer?.(); document.body.classList.remove('fe-glisse'); glisse = null;
      if (!ghost) return; // un simple clic : rien n'a bougé
      finGlisse = Date.now();
      const order = idsDe(grid), quoi = OG.auLacher({ modifier, change: order.join('\n') !== ordre0.join('\n'), annule });
      if (quoi === 'remettre') OA.jouer(() => grid.querySelectorAll(':scope > .fe-w'), () => { for (const i of ordre0) { const n = [...grid.children].find((c) => c.dataset?.id === i); if (n) grid.append(n); } }, { sauf: id });
      const r = box.getBoundingClientRect(), g = ghost, enlever = () => { g.remove(); box.classList.remove('dragging'); };
      if (M.pose && g.animate) { const a = g.animate([{ transform: g.style.transform }, { transform: `translate(${r.left}px,${r.top}px)` }], { duration: P.pose, easing: P.poseEase }); g.style.transform = `translate(${r.left}px,${r.top}px)`; a.onfinish = enlever; a.oncancel = enlever; }
      else enlever();
      if (quoi === 'remettre') { if (order.join('\n') !== ordre0.join('\n')) dire(TXT.revenu); return; }
      if (quoi === 'rien') return;
      page().widgets.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      dire(TXT.place(order.indexOf(id) + 1, order.length));
      if (quoi === 'ranger') rangerDeplacement();
    };
    function geste(v) {
      const quoi = G.geste(pid, v);
      // Pendant le glisser, aucune autre touche n'agit (une flèche sur une poignée redessinerait la fenêtre sous le geste).
      if (quoi === 'ignorer') { if (ghost && v.type === 'keydown') { v.preventDefault(); v.stopPropagation(); } return; }
      if (quoi === 'suivre') {
        x = v.clientX; y = v.clientY;
        if (!ghost) {
          const s = String(window.getSelection?.() ?? ''), q = OG.suite({ dx: x - x0, dy: y - y0, selection: s !== '' && s !== sel0 });
          if (q === 'abandonner') { fin(false); return; }
          if (q === 'attendre') return;
          commencer();
        }
        if (v.cancelable) v.preventDefault();
        pose(); viser(v); if (!raf) defiler();
        return;
      }
      if (v.type === 'keydown') { if (ghost) { v.preventDefault(); v.stopPropagation(); } }
      fin(quoi === 'annuler');
    }
    const mv = (v) => geste(v), up = (v) => geste(v), touche = (v) => geste(v);
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    addEventListener('keydown', touche, true); addEventListener('blur', touche);
    if (o.tenu) commencer();
  }
  /**
   * Hors du mode Modifier : le déplacement est rangé au lâcher, et « Annuler » est offert quelques secondes. La fenêtre
   * est notée au lâcher : chaque déplacement est rangé tel qu'il était, et son « Annuler » ne défait que lui.
   */
  function rangerDeplacement() { return save(null, '', { deplacement: true, fenetre: JSON.stringify(L) }); }
  function proposerAnnuler(o) {
    $('#feAnnuler')?.remove();
    const n = el('div', { id: 'feAnnuler', class: 'va-out fe-annuler', role: 'status', style: 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:90;max-width:min(560px,calc(100% - 32px))' }, el('span', {}, TXT.deplace),
      el('button', { class: 'btn small', type: 'button', onclick: () => {
        n.remove(); const quand = Date.now();
        return enFile(async () => {
          if (glisse || !OG.peutAnnuler(o, quand, saved, edit)) { say(TXT.tropTard); return; }
          // La fenêtre a pu changer ailleurs (un autre appareil) : on ne défait que si Hestia garde encore ce déplacement.
          const f = await act('gladsheim', 'fenetre');
          if (!f.ok || JSON.stringify(f.data) !== o.apres) { if (f.ok && !edit && !glisse && JSON.stringify(L) === saved) { L = f.data; saved = JSON.stringify(L); draw(); } say(TXT.tropTard); return; }
          L = JSON.parse(o.avant); await save(null, TXT.annule, { enFile: true });
        });
      } }, TXT.annuler));
    document.body.append(n); setTimeout(() => n.remove(), OG.MESURES.annuler);
  }
  // Le clic qui suit un lâcher (sur « Ouvrir › », un lien…) ne compte pas : on déplaçait, on n'ouvrait rien.
  // Un nouvel appui est un vrai clic (« Modifier » juste après un lâcher compte).
  addEventListener('click', (e) => { if (Date.now() - finGlisse < 400 && e.target?.closest?.('#fenetre')) { e.stopPropagation(); e.preventDefault(); } }, true);
  addEventListener('pointerdown', () => { if (!glisse) finGlisse = 0; }, true);
  /** Dit une taille aux lecteurs d'écran (une zone « status » cachée, posée une fois). */
  function dire(t) { let n = $('#feDit'); if (!n) { n = el('div', { id: 'feDit', class: 'fe-dit', role: 'status', 'aria-live': 'polite' }); document.body.append(n); } n.textContent = t; }
  const auTel = () => G.appareil(innerWidth) === 'telephone';
  /**
   * Tirer le coin (souris et doigt) : la taille suit le pointeur case par case, rien n'est gardé avant « Terminé ».
   * Un seul geste à la fois, et seul le doigt (ou la souris) posé sur le coin compte : un second doigt ne tire rien.
   * Échap, ou la fenêtre qui perd le focus, remet la taille d'avant ; une souris relâchée hors de la fenêtre finit le geste.
   */
  let coinEnCours = false;
  function startResize(e, box, w, szb) {
    if (!edit || e.button > 0 || coinEnCours) return;
    if (glisse || appuiEnCours) return; // un seul geste à la fois : pas de coin pendant un glisser
    e.preventDefault(); e.stopPropagation();
    const tel = auTel(), grid = box.parentNode, dep = G.depart(w, tel, box.getBoundingClientRect().height), colonnePx = G.colonne(grid.clientWidth, tel), x0 = e.clientX, y0 = e.clientY;
    const id = e.pointerId, rz = e.currentTarget, avant = G.memo(w);
    let n = dep;
    try { rz.setPointerCapture(id); } catch { /* ancien navigateur */ }
    coinEnCours = true; box.classList.add('resizing'); szb.textContent = G.etiquette(dep);
    const POINTEUR = ['pointermove', 'pointerup', 'pointercancel'];
    const fin = (annule) => {
      for (const t of POINTEUR) removeEventListener(t, ev); removeEventListener('keydown', ev, true); removeEventListener('blur', ev); rz.removeEventListener('lostpointercapture', ev);
      coinEnCours = false; box.classList.remove('resizing');
      const bouge = n.c !== dep.c || n.r !== dep.r;
      if (annule) { G.remettre(w, avant); box.setAttribute('style', G.style(w)); if (bouge) dire(TXT.remise(G.etiquette(dep))); return; }
      if (bouge) { dire(TXT.taille(G.etiquette(n))); draw(); }
    };
    function ev(x) {
      const quoi = G.geste(id, x);
      if (quoi === 'ignorer') return;
      if (quoi === 'suivre') {
        const t = G.tirer(w, dep, x.clientX - x0, x.clientY - y0, colonnePx, tel);
        if (t.c === n.c && t.r === n.r) return;
        // Les autres modules s'écartent avec l'animation choisie ; celui qu'on tire suit le doigt, case par case.
        n = t; OA.jouer(() => grid.querySelectorAll(':scope > .fe-w'), () => { G.poser(w, n, tel); box.setAttribute('style', G.style(w)); szb.textContent = G.etiquette(n); }, { sauf: w.id });
        return;
      }
      if (x.type === 'keydown') { x.preventDefault(); x.stopPropagation(); }
      fin(quoi === 'annuler');
    }
    for (const t of POINTEUR) addEventListener(t, ev);
    addEventListener('keydown', ev, true); addEventListener('blur', ev); rz.addEventListener('lostpointercapture', ev);
  }
  /** Maj + flèche sur la poignée : une colonne ou une ligne de plus ou de moins. Rend vrai pour une flèche. */
  function tailleClavier(w, touche, box) {
    if (!touche.startsWith('Arrow')) return false;
    const tel = auTel(), h = box.getBoundingClientRect().height, n = G.pas(w, touche, tel, h);
    if (!n) { dire(TXT.refusee(G.etiquette(G.depart(w, tel, h)))); return true; }
    G.poser(w, n, tel); dire(TXT.taille(G.etiquette(n)));
    draw().then(() => { const b = $(`.fe-w[data-id="${CSS.escape(w.id)}"]`); if (!b) return; b.querySelector('.fe-grip')?.focus(); const s = b.querySelector('.fe-szb'); if (s) { s.textContent = G.etiquette(n); b.classList.add('resizing'); setTimeout(() => b.classList.remove('resizing'), 1500); } });
    return true;
  }
  /** Les sept tailles toutes faites, dans une liste (celles plus petites que la mini du module n'y sont pas). */
  function tailles(w) {
    const now = G.tailleChoisie(w), m = G.bornes(w.kind), possibles = G.taillesPossibles(w.kind);
    const radios = el('div', { class: 'fe-sizes', role: 'radiogroup', 'aria-label': TXT.titreTailles }, ...possibles.map((t) => el('label', {}, el('input', { type: 'radio', name: 'feTaille', value: t.nom, checked: t.nom === now ? true : undefined }), TXT.tailles[t.nom] ?? t.nom, el('small', {}, G.etiquette(t)))));
    const retirees = possibles.length < G.TAILLES.length ? el('p', { class: 'sub', style: 'margin:6px 0 0;font-size:12.5px' }, TXT.miniTailles(G.etiquette({ c: m.c[0], r: m.r[0] }))) : null;
    dialog(TXT.titreTailles, el('div', {}, radios, retirees, el('p', { class: 'sub', style: 'margin:6px 0 0;font-size:12.5px' }, TXT.aideTailles)), () => {
      const v = radios.querySelector('input:checked')?.value; if (!v) { say(TXT.aucuneTaille); return false; }
      if (!G.choisir(w, v)) { say(TXT.refusee(G.etiquette(G.TAILLES.find((t) => t.nom === v) ?? { c: 0, r: 0 }))); return false; }
      dire(TXT.taille(G.etiquette(G.taille(w)))); draw();
    });
    // Le focus va sur la taille cochée (sinon sur la première) : une flèche ne change pas le choix sans le vouloir.
    (radios.querySelector('input:checked') ?? radios.querySelector('input'))?.focus();
  }
  function add(w) { page().widgets.push({ w: 1, ...w, id: G.nouvelId(L.pages.flatMap((p) => p.widgets.map((x) => x.id))) }); views.delete(w.module); fetchViews().then(draw); }

  // ------------------------------------------------------------------ catalogue, réglages d'un module, bouton sur mesure
  function catalogue() {
    const list = el('div', {}), q = el('input', { type: 'search', placeholder: 'Chercher un module ou une appli…', 'aria-label': 'Chercher un module', oninput: () => fill(q.value) });
    const item = (w, title, sub, icon) => { const b = el('button', { class: 'fe-item', type: 'button', draggable: 'true', onclick: () => add(w), ondragstart: (e) => e.dataTransfer.setData('text/odin-module', JSON.stringify(w)) }, el('span', { class: 'fe-ic', 'aria-hidden': 'true' }, icon), el('span', {}, el('b', {}, title), el('small', {}, sub))); return b; };
    const fill = (term) => {
      const t = term.trim().toLowerCase(), fams = new Map();
      for (const m of cat?.modules ?? []) { if (t && !`${m.name} ${m.what} ${m.family}`.toLowerCase().includes(t)) continue; if (!fams.has(m.family)) fams.set(m.family, []); fams.get(m.family).push(m); }
      list.replaceChildren(item({ kind: 'heure' }, 'Heure et lieu', 'la date et l\'heure là où est Odin', '🕒'), item({ kind: 'meteo' }, 'Météo', 'le temps, heure par heure', '☀'),
        (cat?.modules ?? []).some((m) => m.id === 'vordr') ? el('button', { class: 'fe-item', type: 'button', onclick: siteSurveille }, el('span', { class: 'fe-ic', 'aria-hidden': 'true' }, '🌐'), el('span', {}, el('b', {}, 'Site surveillé'), el('small', {}, 'un site suivi par Pulsar : en ligne ou en panne'))) : null,
        ...[...fams].flatMap(([f, ms]) => [el('h3', {}, f), ...ms.map((m) => item({ kind: 'chiffres', module: m.id }, m.name, m.what.slice(0, 70), m.name.slice(0, 1)))]));
    };
    fill('');
    return el('aside', { class: 'fe-cat', 'aria-label': 'Ajouter un module' }, el('h2', {}, 'Ajouter un module'), el('p', { class: 'sub', style: 'margin:-4px 0 10px' }, 'Glisse-le sur la page, ou clique dessus. ⚙ sur un module : choisir la partie de l\'appli à montrer.'), q, list,
      el('div', { class: 'fe-own' }, el('b', {}, '＋ Bouton sur mesure'), el('div', { style: 'font-size:13.5px;opacity:.9;margin-top:4px' }, 'N\'importe quelle action d\'une appli. Les actions graves te demandent ton accord à chaque clic.'), el('button', { class: 'btn small', type: 'button', onclick: ownButton }, 'Créer un bouton')));
  }
  function dialog(title, body, onOk) {
    const d = el('dialog', { class: 'fe-form', style: 'max-width:min(460px,calc(100% - 32px));border-radius:16px;border:1px solid var(--line);background:var(--panel);color:var(--ink)' }, el('h2', { style: 'margin:0 0 8px;font-size:17px' }, title), body,
      el('div', { class: 'va-acts-bar', style: 'margin:14px 0 0' }, el('button', { class: 'btn small', type: 'button', onclick: () => d.close() }, 'Annuler'), el('button', { class: 'btn small primary', type: 'button', onclick: () => { if (onOk() !== false) d.close(); } }, 'Valider')));
    d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal();
  }
  async function configure(w) {
    const v = views.get(w.module) ?? (await api(`/api/valhalla/view?id=${encodeURIComponent(w.module)}`)).view;
    const secs = [...(v?.sections ?? []), ...(v?.side ?? [])].filter((s) => s.kind !== 'form').map((s) => s.title);
    const sel = el('select', { id: 'feSec' }, el('option', { value: '' }, 'Les chiffres clés'), ...secs.map((t) => el('option', { value: t, selected: t === w.section ? true : undefined }, t)));
    const lab = el('input', { id: 'feLab', value: w.label ?? '', placeholder: 'Titre (facultatif)' });
    dialog(`Module ${modName(w.module)}`, el('div', {}, el('label', { for: 'feSec' }, 'Ce qu\'il montre'), sel, el('label', { for: 'feLab' }, 'Titre'), lab), () => {
      if (sel.value) { w.kind = 'section'; w.section = sel.value; } else { w.kind = 'chiffres'; delete w.section; }
      w.label = lab.value.trim() || undefined; draw();
    });
  }
  /** « Site surveillé » : une sonde de Pulsar déjà là, ou un nouveau site à surveiller (Pulsar le vérifie ensuite tout seul). */
  async function siteSurveille() {
    let sondes = [];
    try { const r = await api('/api/valhalla/view?id=vordr'); sondes = ((r.view?.sections ?? []).find((x) => x.kind === 'table' && x.title === 'Sondes')?.rows ?? []).map((x) => x.cells[0]); } catch { /* Pulsar ne répond pas : on peut quand même en créer une */ }
    const sel = el('select', { id: 'feSo' }, el('option', { value: '' }, 'Un nouveau site…'), ...sondes.map((n) => el('option', { value: n }, n)));
    const nom = el('input', { id: 'feSn', placeholder: 'Nom (ex. Mon site)', maxlength: '60' }), url = el('input', { id: 'feSu', placeholder: 'Adresse (ex. https://exemple.fr)', inputmode: 'url' });
    const neuf = el('div', {}, el('label', { for: 'feSn' }, 'Nom'), nom, el('label', { for: 'feSu' }, 'Adresse du site'), url);
    sel.onchange = () => { neuf.hidden = Boolean(sel.value); };
    dialog('Site surveillé', el('div', {}, el('label', { for: 'feSo' }, 'Sonde de Pulsar'), sel, neuf), () => {
      if (sel.value) { add({ kind: 'site', module: 'vordr', label: sel.value }); return; }
      const n = nom.value.trim(), u = url.value.trim();
      if (!n || !/^https?:\/\/\S+$/i.test(u)) { say('Donne un nom et une adresse qui commence par http:// ou https://.'); return false; }
      act('vordr', 'ajouter', { nom: n, genre: 'http', cible: u }).then((r) => { say(r.ok ? `Pulsar surveille maintenant « ${n} ».` : `✗ ${r.text || r.error || 'Pulsar a refusé'}`); if (r.ok) add({ kind: 'site', module: 'vordr', label: n }); });
    });
  }
  function ownButton() {
    const mods = cat?.modules ?? [], ms = el('select', { id: 'feM' }, ...mods.map((m) => el('option', { value: m.id }, m.name))), as = el('select', { id: 'feA' }), params = el('div', {}), lab = el('input', { id: 'feL', placeholder: 'ex. Bloquer YouTube jusqu\'à 20 h' });
    const fillA = () => { const m = mods.find((x) => x.id === ms.value); as.replaceChildren(...(m?.actions ?? []).map((a) => el('option', { value: a.id }, `${a.label}${a.grave ? ' ⚠' : ''}`))); fillP(); };
    const fillP = () => { const a = mods.find((x) => x.id === ms.value)?.actions.find((x) => x.id === as.value); params.replaceChildren(...(a?.params ?? []).filter((p) => p.kind !== 'password').map((p) => el('div', {}, el('label', { for: `feP-${p.key}` }, `${p.label}${p.required ? ' *' : ''}`), p.kind === 'select' ? el('select', { id: `feP-${p.key}`, 'data-k': p.key }, ...(p.options ?? []).map((o) => el('option', { value: o }, o))) : el('input', { id: `feP-${p.key}`, 'data-k': p.key, value: p.default ?? '' })))); };
    ms.onchange = fillA; as.onchange = fillP; fillA();
    dialog('Bouton sur mesure', el('div', {}, el('label', { for: 'feM' }, 'Appli'), ms, el('label', { for: 'feA' }, 'Action'), as, params, el('label', { for: 'feL' }, 'Texte du bouton'), lab), () => {
      const input = Object.fromEntries([...params.querySelectorAll('[data-k]')].map((n) => [n.dataset.k, n.value]).filter(([, v]) => v !== ''));
      const a = mods.find((x) => x.id === ms.value)?.actions.find((x) => x.id === as.value); if (!a) return false;
      add({ kind: 'bouton', module: ms.value, action: as.value, input, label: lab.value.trim() || a.label });
    });
  }

  // ------------------------------------------------------------------ montage
  async function mount() {
    const body = $('#v-home .body'); if (!body || $('#fenetre')) return;
    body.prepend(el('div', { id: 'fenetre', 'aria-label': 'Ma fenêtre' }, el('p', { class: 'fe-err' }, 'Chargement de ta fenêtre…')));
    try { await load(); await fetchViews(); await draw(); } catch (e) { host().replaceChildren(el('p', { class: 'fe-err' }, `Fenêtre indisponible : ${e.message}`)); return; }
    clearInterval(timer); timer = setInterval(async () => { if (edit || glisse || appuiEnCours || document.hidden || !$('#v-home.on')) return; await fetchViews(); draw(); }, 60_000);
  }
  window.OdinFenetre = { mount, state: () => ({ L, cur, edit }), edit: (on = true) => { edit = on; draw(); } };
  // Après la connexion seulement (la page de connexion n'a pas de fenêtre).
  const tryMount = () => { const app = $('#app'); if (app && !app.hidden && $('#v-home .body')) mount(); else setTimeout(tryMount, 1500); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryMount); else tryMount();
  // Le choix de l'animation (lot 17) dans Réglages → Apparence, à la place que themes.js réserve en posant ses cartes
  // (themes.js est chargé après : on attend la fin de son installation).
  const poserAnimations = () => { OA.poser({ act }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(poserAnimations, 0)); else setTimeout(poserAnimations, 0);
})();
