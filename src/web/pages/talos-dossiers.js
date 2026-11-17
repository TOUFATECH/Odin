// Talos : les automatisations rangées en onglets, sous le titre « Workflow ». Trois onglets fixes (Actives,
// Brouillons, Corbeille) et les dossiers du propriétaire, qu'il crée, renomme (bouton, double-clic, F2) et supprime.
// Chaque carte : interrupteur (avec la confirmation avant d'activer), menu ⋯ (déplacer, brouillon / activer,
// corbeille), glisser-déposer sur un onglet. Au premier enregistrement, « Ranger dans quel dossier ? » ; ensuite le
// dossier reste proposé dans la barre de l'éditeur. L'encart qui propose les automatisations de départ quand Odin
// avait déjà les siennes.
// Ce fichier ne touche à rien à son chargement. flows.js l'appelle :
//   OdinTalosDossiers.monter(box, st, { ouvrir, lancer, recharger }) → true quand il a dessiné la liste ;
//   OdinTalosDossiers.choisir(wf) → Promise<{ dossier, active } | null> (null : annulé) ;
//   OdinTalosDossiers.barre(wf, courant?) → élément de la barre de l'éditeur (`courant()` : l'automatisation ouverte).
(() => {
  'use strict';
  if (window.OdinTalosDossiers) return;

  // ---------------- Logique pure (sans document), éprouvée par test/talos-dossiers-web.test.ts
  const RESERVES = ['Actives', 'Brouillons', 'Corbeille'];
  const NOM_MAX = 40;
  const FIXES = ['actives', 'brouillons', 'corbeille'];
  const cleNom = (n) => String(n).normalize('NFKC').toLowerCase();
  const nettoyer = (n) => String(n ?? '').replace(/\s+/gu, ' ').trim();
  const estDossier = (id) => typeof id === 'string' && /^d-[a-z0-9]{4,24}$/.test(id);
  /** Les mêmes refus que le serveur (src/draupnir/dossiers.ts), mêmes textes. '' : le nom est bon. */
  function validerNom(nom, dossiers, sauf) {
    const n = nettoyer(nom);
    if (!n) return 'nom vide';
    if ([...n].length > NOM_MAX) return `nom trop long (${NOM_MAX} caractères au plus)`;
    // Le liant et l'antiliant sans chasse (U+200C, U+200D) restent permis : plusieurs écritures en ont besoin.
    if (/(?![‌‍])[\p{Cc}\p{Cf}]/u.test(n) || /[/\\<>]/.test(n)) return 'caractère interdit dans le nom';
    const k = cleNom(n);
    if (RESERVES.some((r) => cleNom(r) === k)) return 'nom réservé';
    if ((dossiers ?? []).some((d) => d.id !== sauf && cleNom(d.nom) === k)) return 'ce dossier existe déjà';
    return '';
  }
  /** Les onglets, dans l'ordre : Actives, Brouillons, les dossiers (ordre de création), Corbeille. */
  function onglets(st) {
    const flows = st?.flows ?? [];
    return [
      { id: 'actives', nom: 'Actives', nombre: flows.filter((w) => w.active).length, fixe: true },
      { id: 'brouillons', nom: 'Brouillons', nombre: flows.filter((w) => !w.active).length, fixe: true },
      ...(st?.dossiers ?? []).map((d) => ({ id: d.id, nom: d.nom, nombre: typeof d.nombre === 'number' ? d.nombre : flows.filter((w) => w.dossier === d.id).length, fixe: false })),
      { id: 'corbeille', nom: 'Corbeille', nombre: Number(st?.corbeille ?? 0) || 0, fixe: true },
    ];
  }
  /** Les automatisations d'un onglet (la corbeille a sa propre liste). */
  function filtrer(flows, onglet) {
    const l = flows ?? [];
    if (onglet === 'actives') return l.filter((w) => w.active);
    if (onglet === 'brouillons') return l.filter((w) => !w.active);
    if (onglet === 'corbeille') return [];
    return l.filter((w) => w.dossier === onglet);
  }
  /** Le choix proposé au premier enregistrement : le dossier ouvert juste avant (s'il existe encore), toujours en brouillon. */
  function choixParDefaut(onglet, dossiers) {
    const ok = estDossier(onglet) && (!dossiers || dossiers.some((d) => d.id === onglet));
    return { dossier: ok ? onglet : '', etat: 'brouillon' };
  }
  /** L'onglet à ouvrir : celui gardé s'il existe encore, sinon « Actives ». */
  function ongletInitial(garde, liste) { return (liste ?? []).some((o) => o.id === garde) ? garde : 'actives'; }
  /** Le texte de l'encart qui propose les automatisations de départ. */
  function texteProposition(liste) {
    const n = liste.length, a = liste.filter((x) => x.active).length;
    return `Odin propose ${n} automatisations de départ, rangées par dossier : ${a} tourneront seules (des bilans qui ne t'écrivent que si c'est utile), ${n - a} restent en brouillon.`;
  }
  const logique = { RESERVES, NOM_MAX, validerNom, onglets, filtrer, choixParDefaut, ongletInitial, texteProposition };

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
  async function api(path, body) {
    try {
      const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
      if (r.status === 401) { const app = document.querySelector('#app'); if (app && !app.hidden) location.reload(); return { ok: false, error: 'session expirée' }; }
      const j = await r.json().catch(() => null);
      return j && typeof j === 'object' ? j : { ok: false, error: `réponse illisible (${r.status})` };
    } catch (e) { return { ok: false, error: e?.message || 'Odin ne répond pas' }; }
  }
  const D = () => window.OdinDialog;
  const css = `
.td{min-width:0;margin:0 0 20px}
.td-titre{font-size:17px;margin:0 0 6px}
.td-rangee{display:flex;align-items:flex-end;gap:8px;min-width:0;border-bottom:2px solid var(--line);margin:0 0 10px}
.td-onglets{display:flex;flex-wrap:nowrap;gap:2px;overflow-x:auto;overflow-y:hidden;min-width:0;flex:1 1 auto;scrollbar-width:thin}
.td-onglets.td-suite{-webkit-mask-image:linear-gradient(to right,black calc(100% - 44px),transparent);mask-image:linear-gradient(to right,black calc(100% - 44px),transparent)}
@media (min-width:701px){.td-onglets{flex-wrap:wrap;overflow-x:visible}.td-onglets.td-suite{-webkit-mask-image:none;mask-image:none}}
#v-flows .body > p.sub[role=status]:empty{display:none}
.td-onglets button{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;max-width:180px;min-height:44px;padding:0 10px;white-space:nowrap;border:0;background:transparent;color:var(--muted);font:inherit;font-size:15px;cursor:pointer;border-radius:8px 8px 0 0}
.td-onglets button:hover{background:var(--hover)}.td-onglets .td-nom{overflow:hidden;text-overflow:ellipsis;min-width:0}.td-onglets small{flex:none;font-size:13px}
.td-onglets button[aria-selected=true]{color:var(--ink);font-weight:600;box-shadow:inset 0 -3px 0 var(--accent)}
.td-onglets button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.td-onglets button.over{background:var(--sel);outline:2px dashed var(--accent);outline-offset:-2px}
.td-plus{flex:none;min-height:44px;margin:0 0 4px}
.td-outils{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}.td-outils .btn{min-height:44px}
.td-etat{margin:0 0 10px;min-height:1em}.td-etat:empty{display:none}
.td .dr-list{margin:0}
.td .dr-card[draggable=true]{cursor:grab}.td .dr-card.td-glisse{opacity:.5}
.td .dr-h{align-items:flex-start}.td .dr-h b{min-width:0;overflow-wrap:anywhere;flex:1 1 auto;padding-top:11px}
.td-hd{display:flex;align-items:center;gap:2px;flex:none}
.td-pills{display:flex;gap:6px;flex-wrap:wrap}.td-pills:empty{display:none}.td-pills .pill{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-sw{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;cursor:pointer;border-radius:10px}
.td-sw input.g-sw{width:40px;height:24px}.td-sw .g-sw::after{width:20px;height:20px}.td-sw .g-sw:checked::after{left:18px}
.td .cmenu summary{opacity:1;display:flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0;font-size:20px;line-height:1;color:var(--muted)}
.td .cmenu summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.td .cpop{min-width:220px;max-width:min(300px,calc(100vw - 48px))}.td .cpop button{min-height:40px;overflow-wrap:anywhere}.td .cpop button:disabled{opacity:.6;cursor:default}
.td .cpop .td-mt{font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);padding:8px 10px 2px;margin:0}
.td-vide{color:var(--muted);margin:4px 0 0}
.td-corb{list-style:none;margin:0;padding:0}.td-corb li{display:flex;gap:6px 12px;flex-wrap:wrap;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}.td-corb li:last-child{border-bottom:0}
.td-corb .td-ct{flex:1 1 220px;min-width:0;overflow-wrap:anywhere}.td-corb .td-ct span{display:block;color:var(--muted);font-size:13.5px}.td-corb .btn{flex:none}
.td-encart{background:var(--panel);border:1px solid var(--accent);border-radius:14px;padding:14px 16px;margin:0 0 14px;min-width:0}
.td-encart p{margin:0 0 10px}.td-encart .td-b{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 6px}.td-encart .btn{min-height:44px}
.td-encart summary{cursor:pointer;min-height:44px;display:flex;align-items:center}.td-encart h4{margin:10px 0 4px;font-size:14px}.td-encart ul{margin:0;padding-left:18px;font-size:14px}.td-encart li{margin:2px 0;overflow-wrap:anywhere}.td-encart li span{color:var(--muted)}
.td-choix{display:flex;flex-direction:column;gap:10px;padding:12px 14px;margin:0 0 10px;border:1px solid var(--accent);border-radius:12px;background:var(--panel);max-width:560px}
.td-choix label{font-weight:600}.td-choix select,.td-barre select{min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;padding:0 10px;max-width:100%}
.td-choix fieldset{border:1px solid var(--line);border-radius:10px;margin:0;padding:6px 12px 8px}.td-choix legend{font-weight:600;padding:0 4px}
.td-choix fieldset label{display:flex;align-items:center;gap:10px;min-height:44px;font-weight:400;cursor:pointer}.td-choix input[type=radio]{width:20px;height:20px;margin:0;flex:none}
.td-choix .td-b{display:flex;gap:8px;flex-wrap:wrap}.td-choix .btn{min-height:44px}.td-choix [role=status]{margin:0;color:var(--bad)}.td-choix [role=status]:empty{display:none}
.td-barre{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%}.td-barre label{font-size:14px;color:var(--muted)}.td-barre select{min-width:0;max-width:220px}
@media (max-width:700px){
  .td-barre label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .td-outils .btn{flex:1 1 100%}
  .td .dr-list{grid-template-columns:1fr}
}
@media (max-width:700px),(pointer:coarse){.td-panneau .dr-row .btn.small,.td-corb .btn{min-height:44px}}
`;
  let styled = false;
  function style() { if (styled) return; styled = true; document.head.append(el('style', {}, css)); }

  // ---------------- État de la liste
  const CLE = 'odin.talos.onglet';
  const lireGarde = () => { try { return localStorage.getItem(CLE) || ''; } catch { return ''; } };
  const garder = (id) => { try { localStorage.setItem(CLE, id); } catch { /* stockage refusé : rien n'est gardé */ } };
  let ouvert = '';          // l'onglet ouvert (aussi le dossier proposé au premier enregistrement)
  let st = null, box = null, crochets = {}, zone = null, glisse = null, jeton = 0;

  /** Redessine la liste depuis le serveur (sans recharger le reste de la page). */
  async function actualiser() {
    const j = ++jeton, r = await api('/api/draupnir/state');
    if (j !== jeton || !zone?.isConnected) return;
    if (!r.ok) { dire(`✗ ${r.error}`); return; }
    st = r; await dessiner();
  }
  function dire(t) { const e = zone?.querySelector('#tdEtat'); if (e) e.textContent = t; }
  const nomOnglet = (id) => (onglets(st).find((o) => o.id === id)?.nom ?? '');

  function monter(b, etat, c) {
    if (!b || !etat?.ok || !Array.isArray(etat.flows)) return false;
    style(); fermerMenusAuClic();
    st = etat; box = b; crochets = c ?? {}; jeton++;
    zone = el('section', { class: 'td', 'aria-labelledby': 'tdTitre' });
    box.append(zone);
    ouvert = ongletInitial(ouvert || lireGarde(), onglets(st));
    void dessiner();
    return true;
  }

  let tour = 0;
  async function dessiner() {
    if (!zone) return;
    const liste = onglets(st);
    ouvert = ongletInitial(ouvert, liste);
    // La corbeille est lue avant de redessiner : la page ne saute pas entre « lecture… » et la liste.
    const t = ++tour, corb = ouvert === 'corbeille' ? await api('/api/draupnir/corbeille') : null;
    if (t !== tour || !zone) return;
    const ancien = zone.querySelector('#tdEtat')?.textContent ?? '';
    const tabs = liste.map((o) => ongletEl(o, liste));
    const tablist = el('div', { class: 'td-onglets', role: 'tablist', 'aria-label': 'Dossiers des automatisations' }, ...tabs);
    const choisi = liste.find((o) => o.id === ouvert);
    const outils = choisi && !choisi.fixe ? el('div', { class: 'td-outils' },
      el('button', { class: 'btn', type: 'button', onclick: () => renommer(choisi) }, 'Renommer le dossier'),
      el('button', { class: 'btn', type: 'button', onclick: () => supprimer(choisi) }, 'Supprimer le dossier')) : null;
    const panneau = el('div', { class: 'td-panneau', id: 'tdPanneau', role: 'tabpanel', 'aria-labelledby': `td-tab-${ouvert}`, tabindex: '-1' });
    const parts = [
      el('h2', { class: 'td-titre', id: 'tdTitre' }, 'Workflow'),
      el('div', { class: 'td-rangee' }, tablist, el('button', { class: 'btn td-plus', type: 'button', onclick: creer }, '+ Dossier')),
      outils,
      el('p', { class: 'sub td-etat', role: 'status', id: 'tdEtat' }, ancien),
      panneau,
    ];
    zone.replaceChildren(...parts.filter(Boolean));
    tablist.querySelector('[aria-selected=true]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    // Sur téléphone, la rangée défile : un fondu à droite dit qu'il reste des onglets (la Corbeille est au bout).
    const suite = () => tablist.classList.toggle('td-suite', tablist.scrollWidth - tablist.clientWidth - tablist.scrollLeft > 2);
    tablist.addEventListener('scroll', suite, { passive: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(suite).observe(tablist); else suite();
    if (corb) corbeille(panneau, corb); else cartes(panneau);
  }

  function ongletEl(o, liste) {
    const i = liste.indexOf(o), sel = o.id === ouvert;
    const b = el('button', { type: 'button', role: 'tab', id: `td-tab-${o.id}`, 'aria-selected': String(sel), 'aria-controls': 'tdPanneau', tabindex: sel ? '0' : '-1', title: o.fixe ? null : `${o.nom} — double-clic ou F2 pour renommer`,
      onclick: () => choisir_(o.id),
      ondblclick: () => { if (!o.fixe) void renommer(o); },
      onkeydown: (e) => {
        const k = e.key, n = liste.length, j = k === 'ArrowRight' ? (i + 1) % n : k === 'ArrowLeft' ? (i - 1 + n) % n : k === 'Home' ? 0 : k === 'End' ? n - 1 : -1;
        if (j >= 0) { e.preventDefault(); const t = zone.querySelector(`#td-tab-${liste[j].id}`); t?.focus(); return; }
        if (k === 'F2' && !o.fixe) { e.preventDefault(); void renommer(o); }
      } },
    el('span', { class: 'td-nom' }, o.nom), el('small', {}, `(${o.nombre})`));
    if (o.fixe) b.title = o.nom;
    // Glisser une carte sur un onglet : ranger, passer en brouillon, activer ou jeter.
    b.addEventListener('dragover', (e) => { if (!glisse) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; b.classList.add('over'); });
    b.addEventListener('dragleave', () => b.classList.remove('over'));
    b.addEventListener('drop', (e) => { e.preventDefault(); b.classList.remove('over'); const w = glisse; glisse = null; if (w) void deposer(w, o); });
    return b;
  }
  async function choisir_(id) { ouvert = id; garder(id); dire(''); await dessiner(); zone?.querySelector(`#td-tab-${id}`)?.focus(); }

  // ---------------- Cartes
  function cartes(panneau) {
    const flows = filtrer(st.flows, ouvert), dansDossier = estDossier(ouvert);
    const items = [];
    if (ouvert === 'actives') items.push(encartDepart());
    if (!flows.length) items.push(el('p', { class: 'td-vide' }, ouvert === 'actives' ? 'Aucune automatisation active. Active un brouillon avec son interrupteur : elle tournera seule.'
      : ouvert === 'brouillons' ? 'Aucun brouillon. « Partir de zéro » ou « Créer avec Odin » en ajoute un.'
        : 'Ce dossier est vide. Range-y une automatisation avec son menu ⋯ ou en la glissant sur cet onglet.'));
    else items.push(el('div', { class: 'dr-list' }, ...flows.map((w) => carte(w, dansDossier))));
    panneau.replaceChildren(...items.filter(Boolean));
  }
  const dateCourte = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); };
  function carte(w, dansDossier) {
    const nomD = w.dossier ? (st.dossiers ?? []).find((d) => d.id === w.dossier)?.nom : '';
    const pills = [
      dansDossier ? el('span', { class: `pill${w.active ? ' good' : ''}` }, w.active ? 'Active' : 'Brouillon') : null,
      !dansDossier && nomD ? el('span', { class: 'pill', title: `Dossier ${nomD}` }, nomD) : null,
    ].filter(Boolean);
    const sw = el('input', { type: 'checkbox', class: 'g-sw', checked: w.active ? true : undefined, onchange: async (e) => {
      const on = e.target.checked;
      if (on && !(await D().confirm(`Activer « ${w.name} » ? Elle agira seule ensuite.`))) { e.target.checked = false; return; }
      const r = await api('/api/draupnir/toggle', { id: w.id, on });
      if (!r.ok) { e.target.checked = !on; await D().alert(r.error); return; }
      dire(on ? `✓ « ${w.name} » activée.` : `✓ « ${w.name} » passée en brouillon.`); void actualiser();
    } });
    const art = el('article', { class: 'dr-card', draggable: 'true', 'data-id': w.id },
      el('div', { class: 'dr-h' }, el('b', {}, w.name),
        el('div', { class: 'td-hd' }, el('label', { class: 'td-sw', title: w.active ? 'Active' : 'Brouillon' }, sw, el('span', { class: 'sr' }, `Active : ${w.name}`)), menu(w))),
      pills.length ? el('div', { class: 'td-pills' }, ...pills) : null,
      el('div', { class: 'dr-steps' }, (w.nodes ?? []).map((n) => n.label).join(' → ')),
      w.phrase || w.prochaineTexte ? el('div', { class: 'dr-steps' }, [w.phrase, w.active && w.prochaineTexte ? `Prochaine : ${w.prochaineTexte}` : ''].filter(Boolean).join(' · ')) : null,
      el('div', { class: 'dr-row' }, w.last ? el('span', { class: `pill ${w.last.status === 'succès' ? 'good' : w.last.status === 'erreur' ? 'bad' : ''}` }, `${w.last.status} · ${dateCourte(w.last.at)}`) : el('span', { class: 'pill' }, 'jamais lancée'), w.failed ? el('span', { class: 'pill bad' }, `${w.failed} échec(s)`) : null),
      el('div', { class: 'dr-row' },
        el('button', { class: 'btn small primary', type: 'button', onclick: () => crochets.ouvrir?.(w.id) }, 'Ouvrir'),
        el('button', { class: 'btn small', type: 'button', onclick: (e) => crochets.lancer?.(e.currentTarget, w) }, 'Lancer maintenant')),
      el('div', { class: 'dr-steps', role: 'status' }));
    art.addEventListener('dragstart', (e) => { if (e.target !== art) return; glisse = w; art.classList.add('td-glisse'); try { e.dataTransfer.setData('text/plain', w.name); e.dataTransfer.effectAllowed = 'move'; } catch { /* navigateur sans données de glisser */ } });
    art.addEventListener('dragend', () => { art.classList.remove('td-glisse'); setTimeout(() => { glisse = null; }, 0); zone?.querySelectorAll('.td-onglets .over').forEach((x) => x.classList.remove('over')); });
    return art;
  }
  /** Le menu ⋯ d'une carte : le chemin au toucher et au clavier pour tout ce que fait le glisser-déposer. */
  function menu(w) {
    const fermer = (e) => e.currentTarget.closest('details')?.removeAttribute('open');
    const dossiers = st.dossiers ?? [];
    const dep = [
      el('p', { class: 'td-mt', 'aria-hidden': 'true' }, 'Déplacer vers…'),
      ...dossiers.map((d) => el('button', { type: 'button', disabled: w.dossier === d.id ? true : undefined, 'aria-label': `Déplacer vers ${d.nom}`, onclick: (e) => { fermer(e); void ranger(w, d.id); } }, `${w.dossier === d.id ? '✓ ' : ''}${d.nom}`)),
      el('button', { type: 'button', disabled: !w.dossier ? true : undefined, onclick: (e) => { fermer(e); void ranger(w, ''); } }, `${!w.dossier ? '✓ ' : ''}Aucun dossier`),
    ];
    return el('details', { class: 'cmenu' },
      el('summary', { 'aria-label': `Plus d'actions pour ${w.name}`, title: 'Plus d\'actions' }, '⋯'),
      el('div', { class: 'cpop' }, ...dep, el('hr', {}),
        w.active ? el('button', { type: 'button', onclick: (e) => { fermer(e); void etat(w, false); } }, 'Passer en brouillon')
          : el('button', { type: 'button', onclick: (e) => { fermer(e); void etat(w, true); } }, 'Activer…'),
        el('button', { type: 'button', class: 'danger', onclick: (e) => { fermer(e); void jeter(w); } }, 'Mettre à la corbeille')));
  }
  let menusBranches = false;
  function fermerMenusAuClic() {
    if (menusBranches) return; menusBranches = true;
    document.addEventListener('click', (e) => { for (const m of document.querySelectorAll('.td details.cmenu[open]')) if (!m.contains(e.target)) m.removeAttribute('open'); });
    document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; const m = document.querySelector('.td details.cmenu[open]'); if (m) { m.removeAttribute('open'); m.querySelector('summary')?.focus(); } });
  }

  // ---------------- Actions
  async function ranger(w, dossier) {
    const r = await api('/api/draupnir/ranger', { id: w.id, dossier });
    if (!r.ok) { dire(`✗ ${r.error}`); return; }
    const nom = nomOnglet(dossier);
    dire(dossier ? `✓ « ${w.name} » rangée dans « ${nom} ».` : `✓ « ${w.name} » retirée de son dossier.`); void actualiser();
  }
  async function etat(w, on) {
    if (on && !(await D().confirm(`Activer « ${w.name} » ? Elle agira seule ensuite.`))) return;
    const r = await api(on ? '/api/draupnir/activer' : '/api/draupnir/brouillon', { id: w.id });
    if (!r.ok) { dire(`✗ ${r.error}`); return; }
    dire(on ? `✓ « ${w.name} » activée.` : `✓ « ${w.name} » passée en brouillon.`); void actualiser();
  }
  async function jeter(w) {
    if (!(await D().confirm(`Mettre « ${w.name} » à la corbeille ? Tu pourras la restaurer.`, { danger: true }))) return;
    const r = await api('/api/draupnir/trash', { id: w.id });
    if (!r.ok) { dire(`✗ ${r.error}`); return; }
    dire(`✓ « ${w.name} » mise à la corbeille.`); void actualiser();
  }
  /** Une carte lâchée sur un onglet. */
  async function deposer(w, o) {
    if (o.id === 'corbeille') return jeter(w);
    if (o.id === 'actives') { if (!w.active) await etat(w, true); return; }
    if (o.id === 'brouillons') { if (w.active) await etat(w, false); return; }
    if (w.dossier !== o.id) await ranger(w, o.id);
  }

  // ---------------- Dossiers
  async function creer() {
    const nom = await D().prompt('Nom du nouveau dossier', '');
    if (nom === null || !nettoyer(nom)) return;
    const r = await api('/api/draupnir/dossier/creer', { nom });
    if (!r.ok) { await D().alert(r.error); return; }
    ouvert = r.dossier.id; garder(ouvert);
    dire(`✓ Dossier « ${r.dossier.nom} » créé.`);
    await actualiser();
    zone?.querySelector(`#td-tab-${ouvert}`)?.focus();
  }
  async function renommer(o) {
    const nom = await D().prompt('Nouveau nom du dossier', o.nom);
    if (nom === null || !nettoyer(nom) || nettoyer(nom) === o.nom) return;
    const r = await api('/api/draupnir/dossier/renommer', { id: o.id, nom });
    if (!r.ok) { await D().alert(r.error); return; }
    dire(`✓ Dossier renommé en « ${r.dossier.nom} ».`);
    await actualiser();
    zone?.querySelector(`#td-tab-${o.id}`)?.focus();
  }
  async function supprimer(o) {
    if (!(await D().confirm(`Supprimer le dossier « ${o.nom} » ? Ses ${o.nombre} automatisations sont gardées : elles restent dans Actives ou Brouillons.`, { danger: true, ok: 'Supprimer le dossier' }))) return;
    const r = await api('/api/draupnir/dossier/supprimer', { id: o.id });
    if (!r.ok) { dire(`✗ ${r.error}`); return; }
    ouvert = 'actives'; garder(ouvert);
    dire(`✓ Dossier supprimé. ${r.liberees} automatisations gardées.`);
    await actualiser();
    zone?.querySelector('#td-tab-actives')?.focus();
  }

  // ---------------- Corbeille
  function corbeille(panneau, r) {
    if (!r.ok) { panneau.replaceChildren(el('p', { class: 'td-vide' }, `✗ ${r.error}`)); return; }
    const l = r.elements ?? [];
    if (!l.length) { panneau.replaceChildren(el('p', { class: 'td-vide' }, 'La corbeille est vide. Une automatisation jetée arrive ici ; tu peux la restaurer.')); return; }
    panneau.replaceChildren(
      el('div', { class: 'td-outils' }, el('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!(await D().confirm(`Effacer définitivement les ${l.length} automatisations de la corbeille ? On ne pourra plus les restaurer.`, { titre: 'Vider la corbeille', ok: 'Tout effacer', danger: true }))) return;
        const x = await api('/api/draupnir/corbeille/vider', { confirmer: true });
        if (!x.ok) { dire(`✗ ${x.error}`); return; }
        dire('✓ Corbeille vidée.'); void actualiser();
      } }, 'Vider la corbeille')),
      el('ul', { class: 'td-corb' }, ...l.map((e) => el('li', {},
        el('div', { class: 'td-ct' }, el('b', {}, e.nom), el('span', {}, `jetée le ${new Date(e.jeteeLe).toLocaleDateString('fr-FR', { dateStyle: 'short' })}${e.dossierNom ? ` · était dans « ${e.dossierNom} »` : ''}`)),
        el('button', { class: 'btn small', type: 'button', onclick: async (ev) => {
          const bt = ev.currentTarget; bt.disabled = true;
          const x = await api('/api/draupnir/corbeille/restaurer', { cle: e.cle });
          if (!x.ok) { bt.disabled = false; dire(`✗ ${x.error}`); return; }
          dire(`✓ « ${e.nom} » restaurée en brouillon.`); void actualiser();
        } }, 'Restaurer')))));
  }

  // ---------------- Automatisations de départ proposées (Odin qui avait déjà les siennes)
  function encartDepart() {
    const zoneE = el('div', {});
    void api('/api/draupnir/depart').then((r) => {
      if (!r.ok || r.etat !== 'propose' || !Array.isArray(r.liste) || !r.liste.length || !zoneE.isConnected) return;
      const actives = r.liste.filter((x) => x.active).length;
      const parDossier = [...new Set(r.liste.map((x) => x.dossier))];
      zoneE.replaceChildren(el('section', { class: 'td-encart', 'aria-label': 'Automatisations de départ' },
        el('p', {}, texteProposition(r.liste)),
        el('div', { class: 'td-b' },
          el('button', { class: 'btn primary', type: 'button', onclick: async () => {
            if (!(await D().confirm(`Ajouter les ${r.liste.length} automatisations de départ ? ${actives} tourneront seules : des bilans qui lisent et ne t'écrivent que si c'est utile. Les autres restent en brouillon.`, { ok: 'Les ajouter' }))) return;
            const x = await api('/api/draupnir/depart/installer', {});
            if (!x.ok) { dire(`✗ ${x.error}`); return; }
            dire(`✓ ${x.installees} automatisations de départ ajoutées.`); void actualiser();
          } }, 'Les ajouter'),
          el('button', { class: 'btn', type: 'button', onclick: async () => {
            const x = await api('/api/draupnir/depart/refuser', {});
            if (!x.ok) { dire(`✗ ${x.error}`); return; }
            zoneE.replaceChildren(); dire('✓ C\'est noté : elles ne seront plus proposées.');
          } }, 'Non merci')),
        el('details', {}, el('summary', {}, 'Voir la liste'),
          ...parDossier.flatMap((d) => [el('h4', {}, d), el('ul', {}, ...r.liste.filter((x) => x.dossier === d).map((x) => el('li', {}, el('b', {}, x.nom), x.active ? ' (active)' : ' (brouillon)', el('span', {}, ` — ${x.phrase}`))))]))));
    });
    return zoneE;
  }

  // ---------------- Enregistrer : « Ranger dans quel dossier ? »
  let choixEnCours = null;
  /** Le panneau du premier enregistrement. Résout { dossier, active }, ou null si on annule. */
  function choisir(wf) {
    if (choixEnCours) { document.querySelector('#tdChoixDossier')?.focus(); return choixEnCours; }
    style();
    choixEnCours = new Promise((resolve) => {
      const fin = (v) => { panneau.remove(); choixEnCours = null; document.querySelector('#v-flows .dr-bar .btn.primary')?.focus(); resolve(v); };
      const statut = el('p', { role: 'status' });
      const sel = el('select', { id: 'tdChoixDossier' }, el('option', { value: '' }, 'Aucun dossier'));
      let avant = '';
      const remplir = (dossiers, choisi) => {
        sel.replaceChildren(el('option', { value: '' }, 'Aucun dossier'), ...dossiers.map((d) => el('option', { value: d.id }, d.nom)), el('option', { value: '__nouveau__' }, 'Nouveau dossier…'));
        sel.value = choisi; avant = sel.value;
      };
      let connus = [];
      sel.addEventListener('change', async () => {
        if (sel.value !== '__nouveau__') { avant = sel.value; return; }
        statut.textContent = '';
        const nom = await D().prompt('Nom du nouveau dossier', '');
        if (nom === null || !nettoyer(nom)) { sel.value = avant; sel.focus(); return; }
        const r = await api('/api/draupnir/dossier/creer', { nom });
        if (!r.ok) { sel.value = avant; statut.textContent = `✗ ${r.error}`; sel.focus(); return; }
        connus = [...connus, r.dossier]; remplir(connus, r.dossier.id); sel.focus();
      });
      const radio = (val, texte, coche) => el('label', {}, el('input', { type: 'radio', name: 'tdChoixEtat', value: val, checked: coche ? true : undefined }), texte);
      const panneau = el('form', { class: 'td-choix', 'aria-label': 'Enregistrer : dans quel dossier ?', onsubmit: async (e) => {
        e.preventDefault();
        if (sel.value === '__nouveau__') return;
        const active = panneau.querySelector('input[name=tdChoixEtat]:checked')?.value === 'active';
        if (active && !(await D().confirm(`Activer « ${wf.name} » ? Elle agira seule ensuite.`))) return;
        fin({ dossier: sel.value, active });
      }, onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); fin(null); } } },
      el('label', { for: 'tdChoixDossier' }, 'Ranger dans quel dossier ?'), sel,
      el('fieldset', {}, el('legend', {}, 'État'), radio('brouillon', 'Brouillon — ne tourne pas tout seul', true), radio('active', 'Active — tourne toute seule', false)),
      el('div', { class: 'td-b' }, el('button', { class: 'btn primary', type: 'submit' }, 'Enregistrer'), el('button', { class: 'btn', type: 'button', onclick: () => fin(null) }, 'Annuler')),
      statut);
      const bar = document.querySelector('#v-flows .dr-bar');
      if (bar) bar.insertAdjacentElement('afterend', panneau); else (document.querySelector('#v-flows .body') ?? document.body).prepend(panneau);
      sel.focus();
      void api('/api/draupnir/dossiers').then((r) => {
        connus = r.ok ? r.dossiers ?? [] : [];
        if (sel.value === '' && panneau.isConnected) remplir(connus, choixParDefaut(ouvert, connus).dossier);
      });
      remplir([], '');
    });
    return choixEnCours;
  }

  /** Le dossier dans la barre de l'éditeur (automatisation déjà enregistrée) : un changement range tout de suite. */
  function barre(wf, courant) {
    style();
    const cible = () => (typeof courant === 'function' ? courant() : null) ?? wf;
    const st2 = () => document.querySelector('#drSt');
    const sel = el('select', { id: 'tdBarreDossier' }, el('option', { value: wf.dossier ?? '' }, wf.dossier ? '…' : 'Aucun dossier'));
    let connus = [], avant = wf.dossier ?? '';
    const remplir = (choisi) => {
      sel.replaceChildren(el('option', { value: '' }, 'Aucun dossier'), ...connus.map((d) => el('option', { value: d.id }, d.nom)), el('option', { value: '__nouveau__' }, 'Nouveau dossier…'));
      sel.value = connus.some((d) => d.id === choisi) ? choisi : ''; avant = sel.value;
    };
    void api('/api/draupnir/dossiers').then((r) => { connus = r.ok ? r.dossiers ?? [] : []; remplir(cible().dossier ?? ''); });
    sel.addEventListener('change', async () => {
      let v = sel.value;
      if (v === '__nouveau__') {
        const nom = await D().prompt('Nom du nouveau dossier', '');
        if (nom === null || !nettoyer(nom)) { sel.value = avant; return; }
        const c = await api('/api/draupnir/dossier/creer', { nom });
        if (!c.ok) { sel.value = avant; const s = st2(); if (s) s.textContent = `✗ ${c.error}`; return; }
        connus = [...connus, c.dossier]; remplir(c.dossier.id); v = c.dossier.id;
      }
      const w = cible();
      const r = await api('/api/draupnir/ranger', { id: w.id, dossier: v });
      const s = st2();
      if (!r.ok) { sel.value = avant; if (s) s.textContent = `✗ ${r.error}`; return; }
      avant = v;
      for (const x of new Set([w, wf])) { if (v) x.dossier = v; else delete x.dossier; }
      if (s) s.textContent = v ? `✓ Rangé dans « ${connus.find((d) => d.id === v)?.nom ?? ''} ».` : '✓ Retiré du dossier.';
    });
    return el('span', { class: 'td-barre' }, el('label', { for: 'tdBarreDossier' }, 'Dossier'), sel);
  }

  window.OdinTalosDossiers = { monter, choisir, barre, logique, get onglet() { return ouvert; } };
})();
