// Talos : « Faire un lien » entre des applis, sans connaître les nœuds. On choisit QUAND (à la main, selon un
// rythme, quand une appli signale quelque chose), puis QUOI FAIRE : une appli (avec son icône) et une de ses vraies
// fonctions, avec ses réglages ; puis, si on veut, une autre appli à la suite (8 au plus). Talos crée l'automatisation
// (POST /api/draupnir/lien) et l'ouvre dans l'éditeur à nœuds, où elle reste modifiable.
// Ce fichier est chargé avant les autres scripts de l'interface : rien ne touche au document à son chargement.
// API : OdinLien.ouvrir({ appli? }) ; OdinLien.dispo() → Promise<boolean> ; OdinLien.logique (fonctions pures).
(() => {
  'use strict';
  if (window.OdinLien) return;

  // ---------------- Logique pure (sans document)
  const MAX_ETAPES = 8;
  const NIVEAUX = ['info', 'moyenne', 'haute', 'critique'];
  const plein = (v) => !(v === undefined || v === null || (typeof v === 'string' && !v.trim()));
  /** Le corps exact de POST /api/draupnir/lien d'après l'état du formulaire. */
  function versRequete(etat) {
    const q = etat?.quand ?? { sorte: 'main' };
    let quand;
    if (q.sorte === 'rythme') quand = { sorte: 'rythme', rythme: q.rythme };
    else if (q.sorte === 'appli') { quand = { sorte: 'appli', appli: q.appli, evenement: q.evenement ?? '' }; if (NIVEAUX.includes(q.niveau)) quand.niveau = q.niveau; }
    else quand = { sorte: 'main' };
    const etapes = (etat?.etapes ?? []).map((e) => {
      const entree = Object.fromEntries(Object.entries(e.entree ?? {}).filter(([, v]) => plein(v)));
      return Object.keys(entree).length ? { appli: e.appli, action: e.action, entree } : { appli: e.appli, action: e.action };
    });
    const corps = { quand, etapes, activer: Boolean(etat?.activer) };
    if (plein(etat?.nom)) corps.nom = String(etat.nom).trim();
    return corps;
  }
  /** '' quand l'étape peut partir, sinon ce qui manque. `appli` : l'appli choisie, telle que la donne /api/draupnir/applis. */
  function etapeValide(etape, appli) {
    if (!etape?.appli) return 'Choisis une appli.';
    if (!appli || appli.id !== etape.appli) return 'Appli inconnue.';
    if (!etape.action) return 'Choisis ce qu\'elle doit faire.';
    const a = (appli.actions ?? []).find((x) => x.id === etape.action);
    if (!a) return 'Fonction inconnue.';
    if (a.grave) return a.raison || 'Action grave : elle demande ton accord et ne part pas d\'une automatisation.';
    for (const p of a.params ?? []) {
      if (!p.required) continue;
      const v = etape.entree?.[p.key];
      if (!plein(v) && !/\{\{.*\}\}/.test(String(v ?? ''))) return `« ${p.label} » est obligatoire.`;
    }
    return '';
  }
  /** Tout le formulaire : { ok, error?, etape? } (etape : la place de l'étape fautive, à partir de 0). */
  function valideTout(etat, applis) {
    const q = etat?.quand ?? {};
    if (q.sorte === 'rythme' && !q.rythme) return { ok: false, error: 'Choisis le rythme.' };
    if (q.sorte === 'appli' && !q.appli) return { ok: false, error: 'Choisis l\'appli qui signale.' };
    const e = etat?.etapes ?? [];
    if (!e.length) return { ok: false, error: 'Ajoute au moins une appli à faire agir.' };
    if (e.length > MAX_ETAPES) return { ok: false, error: `${MAX_ETAPES} applis au plus à la suite.`, etape: MAX_ETAPES };
    for (let i = 0; i < e.length; i++) { const m = etapeValide(e[i], (applis ?? []).find((a) => a.id === e[i].appli)); if (m) return { ok: false, error: m, etape: i }; }
    return { ok: true };
  }
  /** Ajoute une étape vide ; false quand il y en a déjà 8. */
  function ajouter(etat, appli = '') {
    if ((etat.etapes ?? (etat.etapes = [])).length >= MAX_ETAPES) return false;
    etat.etapes.push({ appli, action: '', entree: {} }); return true;
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
.li-f{max-width:980px;display:flex;flex-direction:column;gap:16px}
.li-b{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}
.li-b>h2{margin:0;font-size:18px;display:flex;align-items:center;gap:10px}.li-n{flex:none;width:30px;height:30px;border-radius:50%;background:var(--accent);color:var(--on-accent,#fff);display:grid;place-items:center;font-size:15px;font-weight:700}
.li-q{display:flex;flex-wrap:wrap;gap:8px}.li-q label{flex:1 1 200px;min-height:52px;display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:12px;border:1px solid var(--field,var(--line));cursor:pointer}
.li-q label:has(input:checked){border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}.li-q input{width:20px;height:20px;accent-color:var(--accent)}
.li-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));grid-auto-rows:max-content;align-content:start;gap:8px;max-height:320px;overflow:auto;padding:2px}
.li-g button{display:grid;justify-items:center;gap:4px;padding:8px 4px;border-radius:12px;border:1px solid transparent;background:none;color:var(--ink);font:inherit;font-size:12.5px;cursor:pointer;min-height:44px}.li-g button:hover{background:var(--panel2)}.li-g button:focus-visible{outline:2px solid var(--accent)}.li-g span.li-nm{overflow-wrap:anywhere;text-align:center}
.li-e{border:1px solid var(--line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--panel2)}
.li-eh{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.li-eh b{flex:1 1 160px;font-size:16px}
.li-fn{display:flex;flex-direction:column;gap:6px}.li-fn label{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:var(--panel);cursor:pointer;min-height:44px}
.li-fn label:has(input:checked){border-color:var(--accent)}.li-fn label.li-gr{opacity:.55;cursor:not-allowed}.li-fn small{display:block;color:var(--muted)}.li-fn input{margin-top:3px;accent-color:var(--accent)}
.li-p label{display:block;font-size:14px;font-weight:600;margin:6px 0 4px}.li-p input:not([type=checkbox]),.li-p textarea,.li-p select,.li-s select,.li-s input,.li-nom{box-sizing:border-box;width:100%;min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--field,var(--line));background:var(--panel);color:var(--ink);font:inherit}
.li-p textarea{min-height:80px;padding:8px 12px}.li-s{display:flex;flex-wrap:wrap;gap:10px}.li-s>div{flex:1 1 200px;min-width:0}.li-s label{display:block;font-size:14px;font-weight:600;margin:0 0 4px}
.li-err{color:var(--bad);margin:0;font-size:14px}.li-err:empty{display:none}.li-cherche{min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--field,var(--line));background:var(--panel);color:var(--ink);font:inherit}
.li-fin{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.li-fin .li-chk{display:flex;gap:8px;align-items:center;min-height:44px}
`;
  let styled = false;
  function style() { if (styled) return; styled = true; document.head.append(el('style', {}, css)); }

  let applisP = null;
  /** Les applis qu'on peut relier, avec leurs fonctions (null : Talos ne sait pas encore faire de lien). */
  function applis() {
    if (!applisP) applisP = appel('/api/draupnir/applis').then((r) => { if (!r?.ok || !Array.isArray(r.applis)) { applisP = null; return null; } return r.applis; });
    return applisP;
  }
  const dispo = async () => Boolean(await applis());

  const icone = (a, taille) => { const s = el('span', { 'aria-hidden': 'true', style: 'line-height:0' }); if (window.OdinAppIcons) s.innerHTML = window.OdinAppIcons.tile(a.id, a.nom, taille); return s; };
  /** Un champ de réglage, comme dans la page des applis (texte, nombre, liste, case, texte long). */
  function champ(p, id, valeur, set) {
    const v = valeur ?? p.default ?? '';
    if (p.kind === 'select') return el('select', { id, onchange: (e) => set(e.target.value) }, ...(p.options ?? []).map((o) => el('option', { selected: o === v ? true : undefined }, o)));
    if (p.kind === 'boolean') return el('input', { id, type: 'checkbox', checked: v === true ? true : undefined, onchange: (e) => set(e.target.checked) });
    if (p.kind === 'textarea') return el('textarea', { id, oninput: (e) => set(e.target.value), spellcheck: 'false' }, String(v));
    return el('input', { id, type: p.kind === 'number' ? 'number' : p.kind === 'password' ? 'password' : 'text', value: String(v), autocomplete: 'off', spellcheck: 'false', oninput: (e) => set(p.kind === 'number' && e.target.value !== '' && !/\{\{/.test(e.target.value) ? Number(e.target.value) : e.target.value) });
  }

  /** Affiche le formulaire « Faire un lien » dans la page des automatisations. `appli` : déjà choisie pour la première étape. */
  async function ouvrir({ appli } = {}) {
    style();
    window.OdinFlows?.prendre?.();
    window.OdinShow?.('flows');
    const box = document.querySelector('#v-flows .body'); if (!box) return;
    const h1 = document.querySelector('#v-flows .head h1'), sub = document.querySelector('#v-flows .head .sub');
    if (h1) h1.textContent = 'Faire un lien';
    if (sub) sub.textContent = 'Relie tes applis : quand quelque chose arrive, une appli fait une de ses fonctions, puis une autre si tu veux. Tu retrouveras le lien dans l\'éditeur à nœuds.';
    box.replaceChildren(el('p', { class: 'sub' }, 'Chargement des applis…'));
    const liste = await applis();
    const retour = el('button', { class: 'btn small', type: 'button', onclick: () => (window.OdinFlows?.liste ? window.OdinFlows.liste() : window.OdinShow?.('flows')) }, '← Automatisations');
    if (!liste) { box.replaceChildren(retour, el('p', { class: 'sub' }, 'Talos ne sait pas encore faire de lien sur ce serveur.')); return; }
    const parId = new Map(liste.map((a) => [a.id, a]));
    const etat = { quand: { sorte: 'main', rythme: null, appli: '', evenement: '', niveau: '' }, etapes: [], nom: '', activer: false };
    ajouter(etat, parId.has(appli) ? appli : '');
    let erreurs = {};

    const zoneQuand = el('div', { class: 'li-b' }), zoneFaire = el('div', { class: 'li-b' }), zoneFin = el('div', { class: 'li-b' });
    const statut = el('p', { class: 'li-err', role: 'alert' });
    // Le refus du serveur qui porte sur « Quand » (date déjà passée, planning qui ne tombe jamais) s'affiche ici.
    const errQuand = el('p', { class: 'li-err', role: 'alert' });

    function peindreQuand() {
      errQuand.textContent = '';
      const q = etat.quand;
      const radio = (val, label) => el('label', {}, el('input', { type: 'radio', name: 'li-quand', value: val, checked: q.sorte === val ? true : undefined, onchange: () => { q.sorte = val; peindreQuand(); } }), label);
      const kids = [el('h2', {}, el('span', { class: 'li-n', 'aria-hidden': 'true' }, '1'), 'Quand ?'),
        el('div', { class: 'li-q', role: 'radiogroup', 'aria-label': 'Quand' }, radio('main', 'À la main'), radio('rythme', 'Selon un rythme'), radio('appli', 'Quand une appli signale'))];
      if (q.sorte === 'main') kids.push(el('p', { class: 'sub', style: 'margin:0' }, 'Elle part quand tu cliques « Lancer maintenant », ou quand tu le demandes à Odin.'));
      if (q.sorte === 'rythme' && window.OdinRythme) kids.push(window.OdinRythme.editeur({ valeur: q.rythme ?? { genre: 'jour', heure: '07:30' }, onChange: (r) => { q.rythme = r; errQuand.textContent = ''; } }), errQuand);
      if (q.sorte === 'appli') {
        const a = parId.get(q.appli);
        const ev = a ? [...new Set(a.evenements ?? [])].filter((x) => x !== 'alerte') : [];
        kids.push(el('div', { class: 'li-s' },
          el('div', {}, el('label', { for: 'li-qa' }, 'Quelle appli ?'), el('select', { id: 'li-qa', onchange: (e) => { q.appli = e.target.value; q.evenement = ''; peindreQuand(); } }, el('option', { value: '' }, 'Choisis…'), ...liste.map((x) => el('option', { value: x.id, selected: x.id === q.appli ? true : undefined }, x.nom)))),
          a ? el('div', {}, el('label', { for: 'li-qe' }, 'Quand elle signale'), el('select', { id: 'li-qe', onchange: (e) => { q.evenement = e.target.value; } }, el('option', { value: '' }, 'N\'importe quoi'), el('option', { value: 'alerte', selected: q.evenement === 'alerte' ? true : undefined }, 'Ses alertes'), ...ev.map((x) => el('option', { value: x, selected: x === q.evenement ? true : undefined }, x)))) : null,
          a ? el('div', {}, el('label', { for: 'li-qn' }, 'À partir du niveau'), el('select', { id: 'li-qn', onchange: (e) => { q.niveau = e.target.value; } }, el('option', { value: '' }, 'Tous'), ...NIVEAUX.map((n) => el('option', { value: n, selected: n === q.niveau ? true : undefined }, n)))) : null));
      }
      zoneQuand.replaceChildren(...kids.filter(Boolean));
    }

    function etapeEl(e, i) {
      const a = parId.get(e.appli), err = el('p', { class: 'li-err', role: 'alert' }, erreurs[i] ?? '');
      const retirer = etat.etapes.length > 1 ? el('button', { class: 'btn small', type: 'button', onclick: () => { etat.etapes.splice(i, 1); erreurs = {}; peindreFaire(); } }, 'Retirer') : null;
      if (!a) {
        const grille = el('div', { class: 'li-g', role: 'list', 'aria-label': 'Applis' });
        const remplir = (t) => grille.replaceChildren(...liste.filter((x) => !t || x.nom.toLowerCase().includes(t)).map((x) => el('button', { type: 'button', role: 'listitem', title: x.nom, onclick: () => { e.appli = x.id; e.action = ''; e.entree = {}; peindreFaire(); document.getElementById(`li-e${i}`)?.focus(); } }, icone(x, 40), el('span', { class: 'li-nm' }, x.nom))));
        remplir('');
        return el('div', { class: 'li-e' }, el('div', { class: 'li-eh' }, el('b', {}, i ? `Puis (${i + 1})` : 'Quelle appli ?'), el('input', { class: 'li-cherche', type: 'search', placeholder: 'Chercher une appli', 'aria-label': 'Chercher une appli', oninput: (ev) => remplir(ev.target.value.trim().toLowerCase()) }), retirer), grille, err);
      }
      const fonctions = el('div', { class: 'li-fn', role: 'radiogroup', 'aria-label': `Fonctions de ${a.nom}` }, ...(a.actions ?? []).map((x) => el('label', { class: x.grave ? 'li-gr' : '', title: x.grave ? x.raison ?? '' : x.what ?? '' },
        el('input', { type: 'radio', name: `li-fn${i}`, value: x.id, disabled: x.grave ? true : undefined, checked: e.action === x.id ? true : undefined, onchange: () => { e.action = x.id; e.entree = Object.fromEntries((x.params ?? []).filter((p) => p.default !== undefined && p.default !== '').map((p) => [p.key, p.default])); delete erreurs[i]; peindreFaire(); } }),
        el('span', {}, el('b', {}, x.label), el('small', {}, x.grave ? x.raison || 'Action grave : elle demande ton accord et ne part pas d\'une automatisation.' : x.what ?? '')))));
      const action = (a.actions ?? []).find((x) => x.id === e.action);
      const reglages = action?.params?.length ? el('div', { class: 'li-p' }, el('b', {}, 'Réglages'), ...action.params.map((p) => {
        const id = `li-p${i}-${p.key}`, set = (v) => { e.entree[p.key] = v; };
        return p.kind === 'boolean' ? el('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:500' }, champ(p, id, e.entree[p.key], set), p.label)
          : [el('label', { for: id }, p.label, p.required ? ' *' : ''), champ(p, id, e.entree[p.key], set), p.help ? el('small', { class: 'sub' }, p.help) : null];
      }), el('small', { class: 'sub' }, 'Tu peux reprendre ce qu\'a donné l\'étape d\'avant : {{ $json.champ }}.')) : null;
      return el('div', { class: 'li-e', id: `li-e${i}`, tabindex: '-1' }, el('div', { class: 'li-eh' }, icone(a, 32), el('b', {}, a.nom), el('button', { class: 'btn small', type: 'button', onclick: () => { e.appli = ''; e.action = ''; e.entree = {}; peindreFaire(); } }, 'Changer d\'appli'), retirer), fonctions, reglages, err);
    }
    function peindreFaire() {
      const plus = el('button', { class: 'btn', type: 'button', disabled: etat.etapes.length >= MAX_ETAPES ? true : undefined, onclick: () => { if (ajouter(etat)) peindreFaire(); } }, '+ Puis une autre appli');
      zoneFaire.replaceChildren(...[el('h2', {}, el('span', { class: 'li-n', 'aria-hidden': 'true' }, '2'), 'Que faire ?'), ...etat.etapes.map(etapeEl), plus,
        etat.etapes.length >= MAX_ETAPES ? el('p', { class: 'sub', style: 'margin:0' }, `${MAX_ETAPES} applis au plus à la suite.`) : null].filter(Boolean));
    }
    const nom = el('input', { class: 'li-nom', id: 'li-nom', placeholder: 'Nom (sinon Talos en choisit un)', autocomplete: 'off', oninput: (e) => { etat.nom = e.target.value; } });
    const activer = el('input', { type: 'checkbox', id: 'li-act', onchange: async (e) => { if (e.target.checked && !(await window.OdinDialog.confirm('Activer ce lien tout de suite ? Il agira seul ensuite.'))) { e.target.checked = false; return; } etat.activer = e.target.checked; } });
    const creer = el('button', { class: 'btn primary', type: 'submit' }, 'Créer le lien');
    zoneFin.append(el('h2', {}, el('span', { class: 'li-n', 'aria-hidden': 'true' }, '3'), 'Enregistrer'), el('label', { for: 'li-nom', class: 'sr' }, 'Nom du lien'), nom,
      el('div', { class: 'li-fin' }, el('label', { class: 'li-chk', for: 'li-act' }, activer, 'Activer maintenant'), creer), statut);
    const f = el('form', { class: 'li-f', onsubmit: async (ev) => {
      ev.preventDefault(); statut.textContent = ''; erreurs = {};
      const v = valideTout(etat, liste);
      if (!v.ok) { if (Number.isInteger(v.etape) && v.etape < etat.etapes.length) { erreurs[v.etape] = v.error; peindreFaire(); } else statut.textContent = v.error; return; }
      creer.disabled = true;
      const r = await appel('/api/draupnir/lien', versRequete(etat));
      creer.disabled = false;
      if (!r) { statut.textContent = 'Talos ne répond pas : rien n\'a été créé.'; return; }
      if (!r.ok) {
        // etape : la place de l'étape fautive, à partir de 0.
        if (Number.isInteger(r.etape) && r.etape >= 0 && r.etape < etat.etapes.length) { erreurs[r.etape] = r.error; peindreFaire(); document.getElementById(`li-e${r.etape}`)?.focus(); }
        else if (!Number.isInteger(r.etape) && etat.quand.sorte === 'rythme' && r.code === 'invalide') { errQuand.textContent = r.error ?? 'Ce rythme est refusé.'; errQuand.scrollIntoView?.({ block: 'center' }); }
        else statut.textContent = r.error ?? 'Refusé.';
        return;
      }
      if (r.flow?.id) window.OdinFlows?.edit?.(r.flow.id);
    } }, zoneQuand, zoneFaire, zoneFin);
    peindreQuand(); peindreFaire();
    box.replaceChildren(el('div', { class: 'dr-bar' }, retour), f);
    box.scrollTop = 0;
  }

  window.OdinLien = { ouvrir, dispo, logique: { MAX_ETAPES, versRequete, etapeValide, valideTout, ajouter } };
})();
