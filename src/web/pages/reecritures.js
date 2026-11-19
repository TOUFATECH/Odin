// Réécritures proposées : chaque brouillon de réécriture du code d'Odin, montré EN ENTIER au propriétaire — le fichier,
// la différence complète avec les numéros de ligne d'avant et d'après, qui l'a demandé, et ses mots à part, marqués
// « texte de la demande, non vérifié ». Un seul bouton : « Refuser ». Rien ne s'applique depuis cette page.
// Tout ce qui vient d'un brouillon est posé comme du TEXTE (jamais comme du HTML) ; les caractères qui ne se voient pas
// (contrôles, formats dont le sens d'écriture et les étiquettes, largeurs nulles, remplissages, sélecteurs de variante,
// séparateurs de ligne Unicode : tout ce que Unicode dit « ignorable par défaut ») sont écrits en clair, « ⟦U+202E⟧ »,
// et une fin de ligne qui change est dite. La page garde le focus clavier tant qu'elle est ouverte.
// Les données : /api/reecritures (propriétaire seul). Aucune touche au DOM au chargement.
(() => {
  'use strict';
  if (window.OdinReecritures) return;

  // Par point de code (drapeau u) : une étiquette U+E0041 ou un U+3164 (qu'un moteur JS prend pour un nom) est montré
  // comme un seul code. Seules la tabulation et la fin de ligne restent telles quelles.
  const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;
  const visible = (t) => String(t ?? '').replace(INVISIBLE, (c) => (c === '\t' || c === '\n' ? c : `⟦U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}⟧`));
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : visible(v));
    }
    for (const c of kids.flat(9)) if (c !== null && c !== undefined && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(visible(c)));
    return n;
  };
  const quand = (d) => { try { return new Date(d).toLocaleString(document.documentElement?.lang || undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return String(d ?? ''); } };
  const FINS = { aucune: 'aucune', lf: 'LF', crlf: 'CRLF', mixte: 'mélangées (LF et CRLF)' };
  const SIGNE = { ' ': ' ', '-': '−', '+': '+' };

  const CSS = `
.rw{position:fixed;inset:0;z-index:90;background:var(--bg,#0b0d12);color:var(--ink,inherit);display:flex;flex-direction:column}
.rw *{box-sizing:border-box}
.rw-h{display:flex;align-items:flex-start;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line,#263849)}
.rw-ht{flex:1;min-width:0}.rw-h h2{margin:0;font-size:19px}
.rw-sub,.rw-meta{font-size:13px;color:var(--muted,#A9B8C4);overflow-wrap:anywhere}
.rw-x{border:0;background:none;color:inherit;font-size:26px;line-height:1;cursor:pointer;min-width:44px;min-height:44px}
.rw-b{flex:1;overflow:auto;padding:12px 16px 32px;display:flex;flex-direction:column;gap:14px}
.rw-c{border:1px solid var(--line,#263849);border-radius:var(--r,14px);background:var(--panel2,#13202C);padding:14px;display:flex;flex-direction:column;gap:8px;min-width:0}
.rw-tete{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.rw-f{font:600 14px/1.4 var(--mono,ui-monospace,monospace);overflow-wrap:anywhere}
.rw-tag{font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--bad-bg,#2a1517);color:var(--bad,#F08080)}
.rw-etat{font-size:11.5px;padding:2px 8px;border-radius:999px;background:var(--hover,#1C2D3D)}
.rw-mots{border-left:3px solid var(--warn,#F0B860);padding:6px 10px;background:var(--hover,#1C2D3D);border-radius:8px}
.rw-lab{font-size:11.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--warn,#F0B860)}
.rw-dem{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}
.rw-alerte{font-size:13px;color:var(--warn,#F0B860)}
.rw-diff{font:12.5px/1.5 var(--mono,ui-monospace,monospace);overflow:auto;max-height:70vh;border:1px solid var(--line,#263849);border-radius:10px;background:var(--bg,#0b0d12);tab-size:4}
.rw-in{width:max-content;min-width:100%}
.rw-l{display:flex;white-space:pre;min-width:100%}
.rw-g{position:sticky;left:0;z-index:1;display:flex;flex:none;background:var(--bg,#0b0d12);box-shadow:1px 0 0 var(--line,#263849)}
.rw-n{flex:none;width:calc(var(--rw-w,3ch) + 12px);padding:0 6px;text-align:right;color:var(--muted,#A9B8C4);user-select:none}
.rw-s{flex:none;width:2ch;text-align:center}
.rw-t{padding:0 12px 0 6px}
.rw-m{background:rgba(240,128,128,.14)}.rw-p{background:rgba(76,183,130,.14)}
.rw-m .rw-g{background:linear-gradient(rgba(240,128,128,.14),rgba(240,128,128,.14)),var(--bg,#0b0d12)}
.rw-p .rw-g{background:linear-gradient(rgba(76,183,130,.14),rgba(76,183,130,.14)),var(--bg,#0b0d12)}
.rw-pied{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rw-note{font-size:12.5px;color:var(--dim,#8FA0AE)}
.rw-autres summary{cursor:pointer;font-size:14px;min-height:44px;padding:11px 0;margin-bottom:10px}
.rw-autres{display:flex;flex-direction:column;gap:10px}
@media (pointer:coarse){.rw-pied .btn{min-height:44px}}`;
  const poserStyle = () => { if (!document.getElementById('rwCss')) document.head.append(el('style', { id: 'rwCss' }, CSS)); };

  /**
   * Les lignes : numéro d'avant, numéro d'après, signe (− retirée, + ajoutée), texte. Toutes, une à une. Les numéros et
   * le signe (la gouttière) restent au bord quand le code défile ; toutes les lignes ont la largeur de la plus longue.
   */
  function lignes(L) {
    const k = String(L.reduce((m, [, a, b]) => Math.max(m, Number(a) || 0, Number(b) || 0), 0)).length;
    const box = el('div', { class: 'rw-diff', role: 'region', 'aria-label': 'Avant et après, ligne à ligne', tabindex: '0', style: `--rw-w:${Math.max(2, k)}ch` });
    const dedans = el('div', { class: 'rw-in' });
    for (const [g, a, b, t] of L) dedans.append(el('div', { class: `rw-l ${g === '-' ? 'rw-m' : g === '+' ? 'rw-p' : ''}` },
      el('span', { class: 'rw-g' }, el('span', { class: 'rw-n' }, a ?? ''), el('span', { class: 'rw-n' }, b ?? ''), el('span', { class: 'rw-s' }, SIGNE[g] ?? '?')),
      el('span', { class: 'rw-t' }, t)));
    box.append(dedans);
    return box;
  }

  /** La carte d'un brouillon. Le bouton « Refuser » n'existe que pour un brouillon encore proposé. */
  function carte(b) {
    const proprio = b.demandePar?.role === 'proprietaire';
    const kids = [
      el('div', { class: 'rw-tete' }, el('code', { class: 'rw-f' }, b.fichier), ...(proprio ? b.etiquettes || [] : []).map((e) => el('span', { class: 'rw-tag' }, e)), b.etat !== 'proposé' ? el('span', { class: 'rw-etat' }, b.etat) : null),
      el('div', { class: 'rw-meta' }, `Demandé par ${b.demandePar?.nom || '?'} (${proprio ? 'toi' : 'membre de la famille'}) · ${b.demandePar?.canal || '?'} · ${quand(b.date)}`),
      el('div', { class: 'rw-mots' }, el('div', { class: 'rw-lab' }, 'Texte de la demande, non vérifié'), el('p', { class: 'rw-dem' }, b.demande?.texte ?? '')),
    ];
    if (b.change) kids.push(el('div', { class: 'rw-meta' }, `${b.etat}, le ${quand(b.change.date)} : ${b.change.pourquoi}`));
    if (b.etat === 'proposé' && Array.isArray(b.lignes)) {
      const c = b.compte || { retirees: 0, ajoutees: 0 };
      const nA = b.lignes.filter((l) => l[1] !== null).length, nB = b.lignes.filter((l) => l[2] !== null).length;
      kids.push(el('div', { class: 'rw-meta' }, `Avant : ${nA} ligne(s) · après : ${nB} ligne(s) · ${c.retirees} retirée(s), ${c.ajoutees} ajoutée(s)`));
      if (b.fins?.changees) kids.push(el('div', { class: 'rw-alerte', role: 'note' }, `Les fins de ligne changent : avant ${FINS[b.fins.avant] ?? b.fins.avant}, après ${FINS[b.fins.apres] ?? b.fins.apres}. Les lignes ci-dessous ne le montrent pas une à une.`));
      kids.push(lignes(b.lignes));
      kids.push(el('div', { class: 'rw-pied' }, el('button', { class: 'btn small', type: 'button', onclick: (e) => refuser(b, e.currentTarget) }, 'Refuser'), el('span', { class: 'rw-note' }, 'Rien ne s\'applique depuis cette page.')));
    } else if (b.etat === 'proposé') kids.push(el('div', { class: 'rw-alerte' }, 'Le fichier vient de changer : rouvre la page.'));
    return el('article', { class: 'rw-c', 'data-id': b.id, 'aria-label': `Réécriture de ${b.fichier}` }, ...kids);
  }

  let root = null, dernierFocus = null, surChangement = null, n = 0, dernier = 0, enCours = false;

  async function refuser(b, bouton) {
    const q = `Refuser la réécriture de ${visible(b.fichier)} ? Le brouillon est gardé, marqué « refusé » ; rien n'est écrit dans le code.`;
    // Seule la fenêtre d'Odin : sans elle, on ne refuse pas (jamais la fenêtre native du navigateur).
    const ok = window.OdinDialog?.confirm ? await window.OdinDialog.confirm(q, { ok: 'Refuser', danger: true }) : false;
    if (!ok) return;
    if (bouton) bouton.disabled = true;
    let r = null;
    try { r = await (await fetch('/api/reecritures/refuser', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ id: b.id }) })).json(); } catch { r = null; }
    dernier = 0;
    await charger();
    if (!root) return;
    // La page vient d'être refaite : le message d'échec se pose APRÈS, dans la carte de ce brouillon (ou en tête s'il n'y
    // est plus), et le focus revient sur un bouton de la page, jamais sur le fond.
    const corps = root.querySelector('.rw-b');
    const carteB = corps ? [...corps.querySelectorAll('.rw-c')].find((c) => c.getAttribute('data-id') === b.id) : null;
    if (!r?.ok) {
      const msg = el('p', { class: 'rw-alerte', role: 'alert' }, r?.error || 'Le refus n\'a pas pu être enregistré.');
      const pied = carteB?.querySelector('.rw-pied');
      if (pied) pied.append(msg); else if (carteB) carteB.append(msg); else corps?.prepend(msg);
    }
    const boutonDe = (x) => x?.querySelector('.rw-pied')?.querySelector('button') ?? null;
    const suivant = (!r?.ok ? boutonDe(carteB) : null) ?? boutonDe(corps) ?? root.querySelector('.rw-x');
    suivant?.focus();
  }

  /** Ce qu'on atteint au clavier dans la page (rien d'un « Déjà décidées » fermé, qui n'est pas affiché). */
  const FOCUS = 'button,summary,[tabindex]:not([tabindex="-1"])';
  const atteignables = () => (root ? [...root.querySelectorAll(FOCUS)].filter((x) => !x.disabled && x.offsetParent !== null) : []);
  /** Un focus qui s'échappe sous la page revient dedans ; la fenêtre de confirmation, par-dessus, garde le sien. */
  function garde(e) {
    if (!root || root.contains(e.target) || e.target?.closest?.('.odlg-bg, dialog[open]')) return;
    (atteignables()[0] ?? root.querySelector('.rw-x'))?.focus();
  }

  async function charger() {
    if (!root) return;
    let d = null;
    try { const r = await fetch('/api/reecritures', { headers: { 'x-odin': '1' } }); d = r.ok ? await r.json() : null; } catch { d = null; }
    const corps = root?.querySelector('.rw-b'); if (!corps) return;
    if (!d?.ok || !Array.isArray(d.list)) { corps.replaceChildren(el('p', {}, 'Je n\'ai pas pu lire les réécritures proposées.')); return; }
    const prop = d.list.filter((b) => b.etat === 'proposé'), autres = d.list.filter((b) => b.etat !== 'proposé').reverse();
    corps.replaceChildren(...[prop.length ? null : el('p', {}, 'Aucune réécriture proposée.'), ...prop.map(carte),
      autres.length ? el('details', { class: 'rw-autres' }, el('summary', {}, `Déjà décidées (${autres.length})`), ...autres.slice(0, 50).map(carte)) : null].filter(Boolean));
    if (n !== prop.length) { n = prop.length; surChangement?.(); }
  }

  /** Ouvre la page, par-dessus l'interface. `apres` : appelé quand le nombre de réécritures proposées change. */
  async function ouvrir(apres) {
    surChangement = typeof apres === 'function' ? apres : null;
    if (root) return charger();
    dernierFocus = document.activeElement;
    poserStyle();
    root = el('div', { class: 'rw', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rwTitre' },
      el('div', { class: 'rw-h' },
        el('div', { class: 'rw-ht' }, el('h2', { id: 'rwTitre' }, 'Réécritures proposées'), el('div', { class: 'rw-sub' }, 'Chaque brouillon en entier. Rien ne s\'applique depuis cette page : tu peux seulement refuser.')),
        el('button', { class: 'rw-x', type: 'button', 'aria-label': 'Fermer les réécritures proposées', onclick: fermer }, '×')),
      el('div', { class: 'rw-b', 'aria-live': 'polite' }, 'Chargement…'));
    document.body.append(root);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); fermer(); return; }
      if (e.key !== 'Tab') return;
      // Tab et Maj+Tab bouclent dans la page : l'interface cachée dessous n'est pas atteinte.
      const els = atteignables(); if (!els.length) { e.preventDefault(); return; }
      const i = els.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); els[els.length - 1].focus(); }
      else if (!e.shiftKey && i === els.length - 1) { e.preventDefault(); els[0].focus(); }
    });
    document.addEventListener('focusin', garde, true);
    root.querySelector('.rw-x')?.focus();
    await charger();
  }
  function fermer() { document.removeEventListener('focusin', garde, true); root?.remove(); root = null; dernierFocus?.focus?.({ preventScroll: true }); }

  /** Le nombre de réécritures proposées (pour l'accueil), relu au plus toutes les 30 s ; `apres` est appelé s'il change. */
  function compte(apres) {
    if (!enCours && Date.now() - dernier > 30_000) {
      enCours = true; dernier = Date.now();
      fetch('/api/reecritures?compte=1', { headers: { 'x-odin': '1' } }).then((r) => (r.ok ? r.json() : null))
        .then((d) => { const m = d?.ok && Number.isInteger(d.proposes) ? d.proposes : 0; if (m !== n) { n = m; apres?.(); } })
        .catch(() => {}).finally(() => { enCours = false; });
    }
    return n;
  }

  window.OdinReecritures = { ouvrir, fermer, compte, carte };
})();
