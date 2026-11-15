// Fenêtres de dialogue d'Odin : elles remplacent confirm, alert et prompt du navigateur.
// Elles prennent les couleurs du thème en cours (variables CSS posées sur :root).
// API : OdinDialog.confirm(texte, options) → Promise<boolean>
//       OdinDialog.alert(texte, options)   → Promise<void>
//       OdinDialog.prompt(texte, défaut, options) → Promise<string|null>
// Options : titre, ok (libellé du bouton qui valide), annuler (libellé du bouton qui annule),
//           danger (bouton rouge), mascotte (false pour cacher le petit Odin).
// Une seule fenêtre à la fois : les suivantes attendent leur tour.
(() => {
  'use strict';
  if (window.OdinDialog) return;

  const css = `
.odlg-bg{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(4,9,15,.58);animation:odlg-f .16s ease both}
.odlg{box-sizing:border-box;width:min(440px,100%);max-height:calc(100dvh - 32px);overflow:auto;display:flex;flex-direction:column;gap:14px;padding:20px;background:var(--panel,#fff);color:var(--ink,#111);border:1px solid var(--line,#ccc);border-radius:var(--r,14px);box-shadow:var(--shadow,0 8px 24px rgba(0,0,0,.3));font-family:var(--body,system-ui,sans-serif);font-size:15.5px;line-height:1.5;animation:odlg-in .18s ease both}
.odlg .odlg-odin{width:56px;height:56px;align-self:center;pointer-events:none;flex:none;cursor:default}
.odlg h2{margin:0;font:600 18px/1.3 var(--display,system-ui,sans-serif);color:var(--ink,#111)}
.odlg .odlg-t{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.odlg .odlg-in{box-sizing:border-box;width:100%;min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--field,var(--line,#ccc));background:transparent;color:inherit;font:inherit}
.odlg .odlg-in:focus{outline:none;border-color:var(--accent,#3F82F0);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#3F82F0) 22%,transparent)}
.odlg .odlg-b{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:2px}
.odlg .odlg-btn{min-height:44px;min-width:110px;padding:0 18px;border-radius:10px;border:1px solid var(--field,var(--line,#ccc));background:none;color:inherit;font:inherit;cursor:pointer;transition:border-color .15s,background .15s}
.odlg .odlg-btn:hover{border-color:var(--field-h,var(--muted,#888))}
.odlg .odlg-btn:focus-visible{outline:2px solid var(--accent,#3F82F0);outline-offset:2px}
.odlg .odlg-btn.ok{background:var(--accent,#3F82F0);border-color:var(--accent,#3F82F0);color:var(--on-accent,#fff);font-weight:600}
.odlg .odlg-btn.ok:hover{background:var(--accent-2,var(--accent,#3F82F0));border-color:var(--accent-2,var(--accent,#3F82F0))}
.odlg .odlg-btn.ok.danger{background:var(--bad,#C0392B);border-color:var(--bad,#C0392B);color:#fff}
@media (max-width:520px){.odlg{padding:18px 16px}.odlg .odlg-b .odlg-btn{flex:1 1 0;min-width:0}}
@media (prefers-reduced-motion:reduce){.odlg-bg,.odlg{animation:none}}
@keyframes odlg-f{from{opacity:0}to{opacity:1}}
@keyframes odlg-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
`;
  let styled = false;
  function addStyle() {
    if (styled) return; styled = true;
    const st = document.createElement('style'); st.textContent = css; document.head.append(st);
  }

  // Une copie du petit Odin de la discussion, avec ses propres dégradés (comme dans companion.js).
  function mascotte() {
    const src = document.getElementById('buddyChat');
    if (!src) return null;
    const b = src.cloneNode(true);
    b.removeAttribute('id'); b.removeAttribute('title'); b.className = 'odin odlg-odin'; b.setAttribute('aria-hidden', 'true');
    for (const g of b.querySelectorAll('[id]')) {
      const nid = `${g.id}-dlg`;
      for (const r of b.querySelectorAll('*')) for (const a of ['fill', 'stroke', 'filter', 'clip-path', 'mask']) { if (r.getAttribute(a) === `url(#${g.id})`) r.setAttribute(a, `url(#${nid})`); }
      g.id = nid;
    }
    return b;
  }

  const FOCUS = 'button,input,[href],select,textarea,[tabindex]:not([tabindex="-1"])';
  let file = Promise.resolve(); // la file d'attente : une fenêtre après l'autre

  function ouvrir(genre, texte, defaut, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      addStyle();
      const avant = document.activeElement;
      const n = Math.random().toString(36).slice(2, 8);
      const bg = document.createElement('div'); bg.className = 'odlg-bg';
      const box = document.createElement('div'); box.className = 'odlg';
      box.setAttribute('role', genre === 'confirm' ? 'alertdialog' : 'dialog');
      box.setAttribute('aria-modal', 'true');
      const titre = opts.titre ?? opts.title;
      if (opts.mascotte !== false) { const b = mascotte(); if (b) { box.append(b); try { window.OdinFace?.set(b, 'neutre'); } catch { /* pas grave */ } } }
      if (titre) { const h = document.createElement('h2'); h.id = `odlg-h-${n}`; h.textContent = String(titre); box.append(h); box.setAttribute('aria-labelledby', h.id); }
      const p = document.createElement('p'); p.className = 'odlg-t'; p.id = `odlg-t-${n}`; p.textContent = texte == null ? '' : String(texte); box.append(p);
      if (titre) box.setAttribute('aria-describedby', p.id); else box.setAttribute('aria-labelledby', p.id);
      let champ = null;
      if (genre === 'prompt') {
        champ = document.createElement('input'); champ.type = 'text'; champ.className = 'odlg-in'; champ.value = defaut == null ? '' : String(defaut);
        champ.setAttribute('aria-labelledby', p.id); champ.autocomplete = 'off';
        box.append(champ);
      }
      const barre = document.createElement('div'); barre.className = 'odlg-b';
      const bouton = (txt, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = `odlg-btn ${cls}`; b.textContent = txt; return b; };
      const ok = bouton(opts.ok ?? (genre === 'confirm' ? 'Confirmer' : 'OK'), opts.danger ? 'ok danger' : 'ok');
      let non = null;
      if (genre !== 'alert') { non = bouton(opts.annuler ?? 'Annuler', 'non'); barre.append(non); }
      barre.append(ok); box.append(barre); bg.append(box);

      let fini = false;
      const fermer = (valeur) => {
        if (fini) return; fini = true;
        document.removeEventListener('focusin', garde, true);
        bg.remove();
        try { if (avant && avant.isConnected && typeof avant.focus === 'function') avant.focus(); } catch { /* rien */ }
        resolve(valeur);
      };
      const valider = () => fermer(genre === 'confirm' ? true : genre === 'prompt' ? champ.value : undefined);
      const annuler = () => fermer(genre === 'confirm' ? false : genre === 'prompt' ? null : undefined);
      ok.addEventListener('click', valider);
      non?.addEventListener('click', annuler);
      // Toucher le fond sombre : annule (sauf pour un simple message, qu'on ferme avec OK).
      bg.addEventListener('mousedown', (e) => { if (e.target === bg && genre !== 'alert') annuler(); });
      bg.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); annuler(); return; }
        if (e.key === 'Enter' && !e.isComposing && e.target.tagName !== 'BUTTON') { e.preventDefault(); valider(); return; }
        if (e.key === 'Tab') { // le focus reste dans la fenêtre
          const els = [...box.querySelectorAll(FOCUS)].filter((x) => !x.disabled && x.offsetParent !== null);
          if (!els.length) { e.preventDefault(); return; }
          const i = els.indexOf(document.activeElement);
          if (e.shiftKey && i <= 0) { e.preventDefault(); els[els.length - 1].focus(); }
          else if (!e.shiftKey && i === els.length - 1) { e.preventDefault(); els[0].focus(); }
        }
      });
      // Si le focus s'échappe (clic ailleurs, script), on le ramène dans la fenêtre.
      function garde(e) { if (!box.contains(e.target)) (champ || ok).focus(); }
      document.addEventListener('focusin', garde, true);
      (document.body || document.documentElement).append(bg);
      if (champ) { champ.focus(); champ.select(); } else ok.focus();
    });
  }

  // Met chaque fenêtre dans la file : elle s'ouvre quand la précédente est fermée.
  function enFile(genre, texte, defaut, opts) {
    const tour = file.then(() => ouvrir(genre, texte, defaut, opts));
    file = tour.catch(() => {});
    return tour;
  }

  window.OdinDialog = {
    confirm: (texte, opts) => enFile('confirm', texte, null, opts),
    alert: (texte, opts) => enFile('alert', texte, null, opts),
    prompt: (texte, defaut, opts) => enFile('prompt', texte, defaut, opts),
  };
})();
