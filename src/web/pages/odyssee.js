// Odyssée dans la page de Vénus : le lecteur de livres (EPUB) et de bandes dessinées (CBZ).
// Il s'affiche au-dessus de la page de Vénus (qui reste entière en dessous). Le chapitre arrive déjà nettoyé par Odin
// (ni script, ni lien, ni ressource extérieure) et s'affiche en plus dans un cadre isolé sans script : un livre ne
// peut rien lancer. La progression est notée à chaque changement de chapitre ou de page, et en quittant le défilement.
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const act = async (action, input = {}) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'freyja', action, input }) })).json();
  const CSS = `
.od{border:1px solid #ffffff14;border-radius:18px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;background:linear-gradient(180deg,#1b1e27,#14161d)}
.od *{box-sizing:border-box}.od h2{margin:0;font-size:16px}.od small{color:#9aa1b2}
.od-l{display:flex;gap:8px;flex-wrap:wrap}.od-b{font:600 13px inherit;padding:8px 14px;min-height:36px;border-radius:999px;border:1px solid #ffffff1a;background:#ffffff0a;color:inherit;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.od-b[aria-pressed=true]{border-color:#e2a93b;color:#e2a93b}
.od-nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.od-nav select{max-width:100%;min-width:0;flex:1 1 160px;min-height:36px;border-radius:10px;background:#0b0d12;color:inherit;border:1px solid #ffffff1a}
.od-f{width:100%;height:70vh;border:0;border-radius:12px;background:#f7f3ea}
.od-img{max-width:100%;max-height:80vh;display:block;margin:0 auto;border-radius:8px}
@media (pointer:coarse){.od-b{min-height:44px}}`;
  const S = { livre: null, page: null };

  window.OdinPages.freyja = async ({ host }) => {
    if (!document.getElementById('odCss')) document.head.append(el('style', { id: 'odCss' }, CSS));
    const r = await act('mes_livres').catch(() => null);
    const liste = Array.isArray(r?.data) ? r.data : [];
    if (!liste.length) return false; // rien à lire : la page de Vénus reste telle quelle
    const box = el('section', { class: 'od', 'aria-label': 'Odyssée · lecteur' });
    host.append(box);
    const lire = async (livre, chapitre) => {
      const x = await act('livre_lire', { livre, ...(chapitre ? { chapitre: String(chapitre) } : {}) });
      if (!x.data) { S.page = { erreur: x.text || x.error || 'Lecture impossible.' }; } else { S.livre = livre; S.page = x.data; }
      dessiner();
    };
    const dessiner = () => {
      const p = S.page;
      const livres = el('div', { class: 'od-l' }, ...liste.map((b) => el('button', { class: 'od-b', type: 'button', 'aria-pressed': String(S.livre === b.id), title: b.titre, onclick: () => lire(b.id) }, `${b.format === 'cbz' ? '🗯' : '📖'} ${b.titre}`)));
      const kids = [el('h2', {}, 'Odyssée · lecteur'), livres];
      if (p?.erreur) kids.push(el('p', {}, p.erreur));
      else if (p) {
        const n = p.chapitre + 1, nom = p.type === 'html' ? 'Chapitre' : 'Page';
        const choix = p.type === 'html' ? el('select', { 'aria-label': 'Chapitre', onchange: (e) => lire(S.livre, Number(e.target.value)) }, ...p.chapitres.map((t, i) => { const o = el('option', { value: String(i + 1) }, `${i + 1}. ${t}`); if (i === p.chapitre) o.selected = true; return o; })) : el('small', {}, `${nom} ${n} sur ${p.total}`);
        kids.push(el('div', { class: 'od-nav' }, el('button', { class: 'od-b', type: 'button', disabled: n <= 1, onclick: () => lire(S.livre, n - 1) }, '← Précédent'), choix, el('button', { class: 'od-b', type: 'button', disabled: n >= p.total, onclick: () => lire(S.livre, n + 1) }, 'Suivant →')));
        if (p.type === 'image') kids.push(el('img', { class: 'od-img', src: p.image, alt: `${p.titre}, page ${n}` }));
        else {
          // Cadre isolé sans aucun droit (ni script, ni formulaire, ni navigation) : le livre n'est qu'à lire.
          const f = el('iframe', { class: 'od-f', sandbox: '', title: `${p.titre}, ${p.chapitres[p.chapitre]}`, referrerpolicy: 'no-referrer' });
          f.srcdoc = `<!doctype html><meta charset="utf-8"><style>body{font:18px/1.65 Georgia,serif;color:#222;max-width:720px;margin:24px auto;padding:0 16px}img{max-width:100%;height:auto}</style>${p.html}`;
          kids.push(f);
        }
      } else kids.push(el('small', {}, 'Choisis un livre : il s\'ouvre là où tu t\'étais arrêté.'));
      box.replaceChildren(...kids);
    };
    dessiner();
    return false; // la page générique de Vénus reste en dessous
  };
})();
