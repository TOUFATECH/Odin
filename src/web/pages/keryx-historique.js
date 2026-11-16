// Historique de Kéryx : la trace, datée, de tout ce qui passe par l'assistant joignable de dehors —
// messages reçus (entrant), réponses (sortant) et actions tentées (action), avec leur gravité et leur sort
// (faite / refusée / en attente). Paginé (on en charge d'autres au fil du défilement) et effaçable :
// un échange (par son id) ou tout, avec un avertissement HONNÊTE que l'effacement est réel et sans retour.
// La page ne connaît ni base ni serveur : elle n'appelle que /api/keryx/historique et /historique/effacer.
// Chargée toute seule ; sert la moitié « Historique » de la page Kéryx. Confirmations par OdinDialog.
(() => {
  'use strict';
  window.OdinKeryxHistorique = window.OdinKeryxHistorique || {};
  if (window.OdinKeryxHistorique.rendre) return;

  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };

  // ---------------- Logique pure (sans document).
  const SENS = { entrant: { t: 'Reçu', f: '←' }, sortant: { t: 'Envoyé', f: '→' }, action: { t: 'Action', f: '•' } };
  const GRAV = { routine: 'routine', important: 'important', grave: 'grave' };
  const RESU = { faite: 'faite', refusee: 'refusée', en_attente: 'en attente' };
  const sensTitre = (s) => (SENS[s] || { t: s }).t;
  const sensFleche = (s) => (SENS[s] || { f: '·' }).f;
  const graviteTexte = (g) => GRAV[g] || g || '';
  const resultatTexte = (r) => RESU[r] || r || '';
  function quand(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('fr', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return String(iso); }
  }

  const CSS = `
.kxh{display:flex;flex-direction:column;gap:12px;min-width:0}
.kxh-barre{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.kxh-barre .kxh-count{font-size:12.5px;color:var(--muted);margin-right:auto}
.kxh button.kxh-b{min-height:38px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:0 12px;font:600 13px inherit;cursor:pointer}
.kxh button.kxh-b.danger{color:var(--bad,#C0392B);border-color:color-mix(in srgb,var(--bad,#C0392B) 50%,var(--line))}
.kxh button.kxh-b[disabled]{opacity:.5;cursor:default}
.kxh-liste{display:flex;flex-direction:column;gap:8px}
.kxh-item{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:10px 12px;min-width:0}
.kxh-tete{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}
.kxh-sens{font-weight:600;font-size:13px;color:var(--ink)}
.kxh-sens.entrant{color:var(--accent,#3F82F0)}
.kxh-sens.action{color:var(--ink)}
.kxh-quand{font-size:12px;color:var(--muted)}
.kxh-pair{font-size:12px;color:var(--muted);word-break:break-all}
.kxh-canal{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:0 6px}
.kxh-texte{margin:6px 0 0;font-size:13.5px;color:var(--ink);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.kxh-act{margin:8px 0 0;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:12.5px;color:var(--muted)}
.kxh-act b{color:var(--ink);font-weight:600}
.kxh-tag{font-size:11px;border-radius:6px;padding:1px 7px;border:1px solid var(--line)}
.kxh-tag.grave{color:var(--bad,#C0392B);border-color:color-mix(in srgb,var(--bad,#C0392B) 50%,var(--line))}
.kxh-tag.important{color:var(--warn,#C9972B);border-color:color-mix(in srgb,var(--warn,#C9972B) 55%,var(--line))}
.kxh-tag.faite{color:var(--good,#2F8F4E)}
.kxh-tag.refusee{color:var(--bad,#C0392B)}
.kxh-tag.en_attente{color:var(--warn,#C9972B)}
.kxh-sup{margin-left:auto}
.kxh-vide{font-size:13px;color:var(--muted);text-align:center;padding:18px 0}
.kxh-note{font-size:12px;color:var(--muted);font-style:italic}
`;
  function style() { if (!document.getElementById('kxh-css')) document.head.append(el('style', { id: 'kxh-css' }, CSS)); }

  // ---------------- Rendu. ctx = { api, toast?, recharger? }
  async function rendre(host, ctx = {}) {
    style();
    const api = ctx.api || defautApi;
    const dire = (m) => { try { if (ctx.toast) ctx.toast(m); else if (window.OdinDialog) window.OdinDialog.alert(m); } catch { /* rien */ } };
    const etat = { entrees: [], suite: undefined, fini: false, charge: false };

    const racine = el('div', { class: 'kxh' });
    const compteur = el('span', { class: 'kxh-count', role: 'status' }, '');
    const liste = el('div', { class: 'kxh-liste' });
    const plus = el('button', { type: 'button', class: 'kxh-b', hidden: true, onclick: () => charger(false) }, 'En charger d\'autres');
    const videTout = el('button', { type: 'button', class: 'kxh-b danger', onclick: effacerTout }, 'Tout effacer');
    racine.append(el('div', { class: 'kxh-barre' }, compteur, el('button', { type: 'button', class: 'kxh-b', onclick: () => charger(true) }, 'Rafraîchir'), videTout), liste, plus,
      el('p', { class: 'kxh-note' }, 'Chaque échange et chaque action est chiffré au repos et n\'apparaît jamais en clair dans les journaux. L\'effacement est réel et sans retour.'));
    host.replaceChildren(racine);

    async function charger(reset) {
      if (reset) { etat.entrees = []; etat.suite = undefined; etat.fini = false; }
      plus.disabled = true;
      const q = new URLSearchParams(); q.set('n', '50'); if (etat.suite) q.set('avant', etat.suite);
      const r = await api(`/historique?${q.toString()}`);
      plus.disabled = false; etat.charge = true;
      if (!r || r.ok === false) { if (!etat.entrees.length) liste.replaceChildren(el('p', { class: 'kxh-vide' }, 'Historique indisponible pour l\'instant.')); return; }
      const lot = Array.isArray(r.entrees) ? r.entrees : [];
      etat.entrees = etat.entrees.concat(lot);
      etat.suite = r.suite;
      etat.fini = !r.suite;
      peindre();
    }

    function peindre() {
      compteur.textContent = etat.entrees.length ? `${etat.entrees.length} échange${etat.entrees.length > 1 ? 's' : ''} affiché${etat.entrees.length > 1 ? 's' : ''}` : '';
      plus.hidden = etat.fini || !etat.entrees.length;
      videTout.disabled = !etat.entrees.length;
      if (!etat.entrees.length) { liste.replaceChildren(el('p', { class: 'kxh-vide' }, 'Rien pour l\'instant. Les messages et actions de Kéryx apparaîtront ici.')); return; }
      liste.replaceChildren(...etat.entrees.map(item));
    }

    function item(e) {
      const sens = e.sens || 'action';
      const tete = el('div', { class: 'kxh-tete' },
        el('span', { class: 'kxh-sens ' + sens }, `${sensFleche(sens)} ${sensTitre(sens)}`),
        e.canal ? el('span', { class: 'kxh-canal' }, e.canal) : null,
        e.pair ? el('span', { class: 'kxh-pair' }, e.pair) : null,
        el('span', { class: 'kxh-quand' }, quand(e.quand)));
      const corps = el('div', { class: 'kxh-item' }, tete);
      if (e.texte) corps.append(el('p', { class: 'kxh-texte' }, e.texte));
      if (e.action) {
        const a = e.action;
        corps.append(el('div', { class: 'kxh-act' },
          el('span', {}, 'Action : ', el('b', {}, a.outil || '?')),
          a.resume ? el('span', {}, a.resume) : null,
          a.gravite ? el('span', { class: 'kxh-tag ' + a.gravite }, graviteTexte(a.gravite)) : null,
          el('span', { class: 'kxh-tag' }, a.confirmee ? 'confirmée' : 'sans confirmation'),
          e.resultat ? el('span', { class: 'kxh-tag ' + e.resultat }, resultatTexte(e.resultat)) : null));
      } else if (e.resultat) {
        corps.append(el('div', { class: 'kxh-act' }, el('span', { class: 'kxh-tag ' + e.resultat }, resultatTexte(e.resultat))));
      }
      if (e.id) corps.append(el('div', { class: 'kxh-act' }, el('button', { type: 'button', class: 'kxh-b danger kxh-sup', 'aria-label': 'Effacer cet échange', onclick: () => effacerUn(e.id) }, 'Effacer')));
      return corps;
    }

    async function effacerUn(id) {
      const oui = window.OdinDialog ? await window.OdinDialog.confirm('Effacer cet échange de l\'historique ?\nL\'effacement est réel et sans retour.', { ok: 'Effacer', danger: true }) : true;
      if (!oui) return;
      const r = await api('/historique/effacer', { method: 'POST', body: { id } });
      if (r && typeof r.efface === 'number') { etat.entrees = etat.entrees.filter((x) => x.id !== id); peindre(); dire(r.efface ? 'Échange effacé.' : 'Rien à effacer.'); }
      else dire('L\'effacement a échoué.');
    }

    async function effacerTout() {
      const oui = window.OdinDialog ? await window.OdinDialog.confirm('Effacer TOUT l\'historique de Kéryx ?\nTous les messages et toutes les actions tracées seront détruits. L\'effacement est réel et sans retour.', { ok: 'Tout effacer', danger: true }) : true;
      if (!oui) return;
      const r = await api('/historique/effacer', { method: 'POST', body: { tout: true } });
      if (r && typeof r.efface === 'number') { etat.entrees = []; etat.suite = undefined; etat.fini = true; peindre(); dire(`${r.efface} entrée${r.efface > 1 ? 's effacées' : ' effacée'}.`); }
      else dire('L\'effacement a échoué.');
    }

    await charger(true);
    return { charger, effacerUn, effacerTout, etat };
  }

  async function defautApi(path, opts = {}) {
    try {
      const init = { method: opts.method || 'GET', headers: { 'x-odin': '1' } };
      if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
      const r = await fetch(`/api/keryx${path}`, init);
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, ...j };
    } catch { return { ok: false, text: 'Kéryx ne répond pas.' }; }
  }

  window.OdinKeryxHistorique = {
    rendre,
    logique: { sensTitre, sensFleche, graviteTexte, resultatTexte, quand, SENS, GRAV, RESU },
  };
})();
