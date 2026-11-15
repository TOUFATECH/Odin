// Le Store d'Andromède (ISO) et d'Hermès (logiciels) dans l'interface : une seule page pour les deux applis.
// - Store : le catalogue des dépôts officiels, avec la recherche par nom, les filtres (système, type ou catégorie,
//   architecture, famille), la recherche dans les index officiels en ligne, et le bouton « Télécharger » (antivirus
//   d'abord, puis mise en surveillance). Pendant qu'Odin lit ou télécharge : la barre de chargement au centre.
// - Disponibles, Surveillés, Réglages : les sections décrites par l'appli (page générique), rangées dans leur onglet.
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const CSS = `
.st{display:flex;flex-direction:column;gap:14px}
.st-tabs{display:flex;gap:2px;border-bottom:2px solid var(--line);overflow-x:auto;scrollbar-width:thin}
.st-tabs button{flex:1 1 auto;max-width:190px;min-height:44px;padding:0 10px;white-space:nowrap;border:0;background:transparent;color:var(--muted);font:inherit;font-size:15px;cursor:pointer;border-radius:8px 8px 0 0}
.st-tabs button:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}.st-tabs button[aria-selected=true]{color:var(--ink);font-weight:700;box-shadow:inset 0 -3px 0 var(--accent)}
.st-w{background:color-mix(in srgb,var(--panel) 88%,transparent);border:1px solid var(--line);border-radius:18px;padding:14px 16px;min-width:0}
.st-f{display:grid;grid-template-columns:minmax(180px,2fr) repeat(auto-fit,minmax(130px,1fr));gap:10px;align-items:end}
.st-f label{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--muted);min-width:0}
.st-f input[type=search],.st-f select{min-height:40px;border-radius:10px;border:1px solid var(--line);background:var(--field,var(--panel));color:var(--ink);padding:0 10px;font:inherit;min-width:0;width:100%}
.st-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}.st-row .info{color:var(--muted);font-size:13px}
.st-chk{display:flex;gap:8px;align-items:center;font-size:13.5px;color:var(--ink);min-height:40px}.st-chk input{width:18px;height:18px;accent-color:var(--accent)}
.st-btn{min-height:38px;padding:0 14px;border-radius:10px;border:1px solid var(--line);background:color-mix(in srgb,var(--ink) 4%,transparent);color:var(--ink);font:600 13.5px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.st-btn:disabled{opacity:.5;cursor:default}.st-btn.pri{background:var(--accent);color:#fff;border-color:transparent}
.st-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(310px,100%),1fr));gap:12px}
.st-c{border:1px solid var(--line);border-radius:16px;padding:12px;display:flex;gap:12px;min-width:0;background:color-mix(in srgb,var(--panel) 92%,transparent)}
.st-c img{width:44px;height:44px;border-radius:11px;flex:none}.st-c .t{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}
.st-c b{font-size:14.5px;overflow-wrap:anywhere}.st-c small{color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}.st-c .a{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center}
.st-chip{font-size:11.5px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink);white-space:nowrap}
.st-chip.ok{background:color-mix(in srgb,#1f9d55 22%,transparent)}.st-chip.new{background:color-mix(in srgb,#d97706 26%,transparent)}.st-chip.web{background:color-mix(in srgb,var(--accent) 22%,transparent)}
.st-vide{color:var(--muted);font-size:14px;padding:18px 6px;text-align:center}
.st-load{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:220px;padding:26px 16px;text-align:center}
.st-load .b{position:relative;width:min(440px,88%);height:16px;border-radius:999px;background:color-mix(in srgb,var(--ink) 9%,var(--panel));border:1px solid var(--line);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.08)}
.st-load .b i{position:absolute;top:0;bottom:0;left:-42%;width:42%;border-radius:999px;background:linear-gradient(90deg,transparent,var(--accent) 28%,var(--accent) 72%,transparent);animation:stFile 1.05s cubic-bezier(.4,0,.6,1) infinite}
.st-load .b.p i{left:0;width:var(--p,0%);background:var(--accent);animation:none;transition:width .35s ease}
.st-load .b::after{content:'';position:absolute;inset:0;background:linear-gradient(110deg,transparent 0 40%,rgba(255,255,255,.5) 50%,transparent 60% 100%);background-size:240% 100%;animation:stReflet 1.5s linear infinite;pointer-events:none}
.st-load .pc{font-size:24px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums;min-height:1.2em}.st-load p{margin:0;color:var(--ink);font-size:14px;max-width:560px;overflow-wrap:anywhere}.st-load small{color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}
@keyframes stFile{from{left:-42%}to{left:100%}}@keyframes stReflet{from{background-position:130% 0}to{background-position:-130% 0}}
@media (prefers-reduced-motion:reduce){.st-load .b i,.st-load .b::after{animation:none}.st-load .b::after{display:none}.st-load .b:not(.p) i{left:0;width:100%;opacity:.4}.st-load .b.p i{transition:none}}
@media (max-width:600px){.st-f{grid-template-columns:1fr 1fr}.st-f label:first-child{grid-column:1/-1}}
`;
  /** La barre de chargement au centre (la même que dans Hydre) : bande qui file, puis pourcentage ; ce qui se passe dessous. */
  function charge(texte) {
    const bar = el('div', { class: 'b', role: 'progressbar', 'aria-label': texte, 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('i', {})), pc = el('div', { class: 'pc', 'aria-hidden': 'true' }), t = el('p', { role: 'status' }, texte), d = el('small', {});
    const n = el('div', { class: 'st-load' }, bar, pc, t, d);
    n.maj = (x = {}) => {
      if (x.texte != null) { t.textContent = x.texte; bar.setAttribute('aria-label', x.texte); }
      if (x.detail != null) d.textContent = x.detail;
      if (x.pct === null) { bar.classList.remove('p'); bar.removeAttribute('aria-valuenow'); pc.textContent = ''; }
      else if (x.pct != null) { const k = Math.max(0, Math.min(100, Math.round(x.pct))); bar.classList.add('p'); bar.style.setProperty('--p', `${k}%`); bar.setAttribute('aria-valuenow', String(k)); pc.textContent = `${k} %`; }
    };
    return n;
  }
  const octets = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} Go` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
  const plat = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const etats = {};   // par appli : onglet choisi, recherche et filtres (gardés quand la page se redessine)

  const page = (module, genre) => async ({ host, generic, view, info: appli }) => {
    const secs = (view.sections ?? []).filter((s) => s.kind !== 'graph'), noms = view.onglets ?? [];
    // La page générique a changé de forme : on la laisse faire.
    if (!noms.includes('Store') || generic.length !== secs.length) return false;
    if (!document.getElementById('stCss')) document.head.append(el('style', { id: 'stCss' }, CSS));
    const S = etats[module] ?? (etats[module] = { tab: 'Store', q: '', systeme: '', type: '', arch: '', famille: '', enligne: false });
    if (!noms.includes(S.tab)) S.tab = 'Store';
    const post = async (action, input = {}, confirm = false) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module, action, input, confirm }) })).json();
    const act = async (action, input = {}) => { let r = await post(action, input); if (r.confirm) { if (!(await window.OdinDialog.confirm(r.confirm, { danger: true }))) return { ok: false, text: 'Annulé.' }; r = await post(action, input, true); } return r; };
    const note = (x) => { if (x?.text && x.text !== 'Annulé.') window.OdinNotices?.local?.({ title: x.text.split('\n')[0].slice(0, 160), level: x.ok === false ? 'souci' : 'ok', kind: appli?.name ?? 'Store', app: appli?.name ?? module }); };

    const tabs = el('div', { class: 'st-tabs', role: 'tablist' }), corps = el('div', { class: 'st' }), racine = el('div', { class: 'st' }, tabs, corps);
    host.append(racine);
    // Les sections de la page générique, chacune dans son onglet ; dans « Store », la recherche et les cartes sont dessinées ici.
    const dansOnglet = (nom) => secs.map((s, i) => [s, generic[i]]).filter(([s]) => (s.onglet ?? noms[0]) === nom);
    let donnees = null, timer = 0;

    const cartes = (l) => l.length ? el('div', { class: 'st-grid' }, ...l.map((e) => {
      const enLigne = e.enLigne, peut = !e.manuel && e.etat !== 'en cours';
      const etat = el('span', { class: `st-chip${e.etat === 'à jour' ? ' ok' : e.etat === 'nouvelle version' || e.etat === 'en cours' ? ' new' : ''}` }, e.surveille && e.etat === 'à télécharger' ? 'surveillé' : e.etat);
      return el('div', { class: 'st-c' }, el('img', { src: e.icone, alt: '', width: '44', height: '44' }),
        el('div', { class: 't' }, el('b', {}, e.nom),
          el('small', {}, `${e.systeme} · ${e.type} · ${e.arch}${e.version ? ` · version ${e.version}` : ''}${e.taille ? ` · ${octets(e.taille)}` : ''}`),
          e.about ? el('small', {}, e.about) : null,
          e.presents?.length ? el('small', {}, `Dans ton dossier : ${e.presents.join(', ')}`) : null,
          e.manuel ? el('small', {}, e.manuel) : null,
          el('div', { class: 'a' }, etat, enLigne ? el('span', { class: 'st-chip web' }, `${e.famille}${enLigne.verifie ? ' · vérifié par l\'éditeur' : ''}`) : null, e.surveille && e.etat !== 'à télécharger' ? el('span', { class: 'st-chip' }, 'surveillé') : null),
          el('div', { class: 'a' },
            peut ? el('button', { class: 'st-btn pri', type: 'button', onclick: () => telecharger(e) }, e.presents?.length ? 'Retélécharger' : 'Télécharger') : null,
            e.page ? el('a', { class: 'st-btn', href: e.page, target: '_blank', rel: 'noopener noreferrer' }, 'Page officielle') : null)));
    })) : el('p', { class: 'st-vide' }, 'Rien ne correspond. Essaie un autre mot, retire un filtre, ou cherche aussi dans les index en ligne.');

    const filtres = () => { const mots = plat(S.q).split(/\s+/).filter(Boolean), eg = (a, b) => !b || plat(a) === plat(b); return (donnees?.entrees ?? []).filter((e) => eg(e.systeme, S.systeme) && eg(e.type, S.type) && eg(e.arch, S.arch) && eg(e.famille, S.famille) && (e.enLigne || mots.every((m) => plat(`${e.nom} ${e.id} ${e.about} ${e.famille} ${e.type} ${e.systeme}`).includes(m)))); };
    const liste = el('div', {}), info = el('span', { class: 'info', role: 'status' });
    const montrer = () => { const l = filtres(); liste.replaceChildren(cartes(l)); const idx = (donnees?.index ?? []).map((x) => (x.ok ? `${x.index} : ${x.n} résultat${x.n > 1 ? 's' : ''}` : `${x.index} : en panne, le catalogue répond seul`)).join(' · '); info.textContent = `${l.length} sur ${donnees?.total ?? 0} au catalogue${idx ? ` · ${idx}` : ''}`; };
    /** Relit le Store chez Odin (en ligne et versions à la demande) : la barre au centre pendant ce temps. */
    const lire = async (o = {}) => {
      liste.replaceChildren(el('div', { class: 'st-w' }, charge(o.actualiser ? 'Je relis les versions sur les sites officiels…' : o.enligne ? 'Je cherche dans les index officiels en ligne…' : 'Je consulte le Store…')));
      const r = await post('store', { q: o.enligne ? S.q : '', enligne: Boolean(o.enligne), actualiser: Boolean(o.actualiser) });
      // La recherche en ligne ne rend que ce qui correspond : on garde le catalogue entier à côté, pour les filtres.
      if (o.enligne && donnees) donnees = { ...donnees, index: r.data?.index ?? [], entrees: [...donnees.entrees.filter((e) => !e.enLigne), ...(r.data?.entrees ?? []).filter((e) => e.enLigne)] };
      else donnees = r.data ?? { entrees: [], total: 0, filtres: {}, index: [] };
      if (r.ok === false) note(r);
      montrer();
    };
    /** Télécharge une entrée : la barre au centre, avec l'avancement lu dans « Surveillés ». */
    async function telecharger(e) {
      const c = charge(`Je télécharge ${e.nom}…`); c.maj({ detail: 'depuis le dépôt officiel · antivirus d\'abord, puis rangé et surveillé' });
      liste.replaceChildren(el('div', { class: 'st-w' }, c)); c.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      const t0 = performance.now(); let d0 = -1;
      const suivi = setInterval(async () => {
        const s = (await post('surveilles').catch(() => null))?.data?.surveilles?.find((x) => x.enCours); if (!s?.enCours) return;
        const { recu, total, pct } = s.enCours; if (d0 < 0) d0 = recu;
        const v = (recu - d0) / Math.max(1, (performance.now() - t0) / 1000), reste = total && v > 0 ? Math.round((total - recu) / v) : null;
        c.maj({ pct: pct ?? null, detail: `${octets(recu)}${total ? ` / ${octets(total)}` : ''}${v > 0 ? ` · ${octets(v)}/s` : ''}${reste != null ? ` · reste ${reste >= 60 ? `${Math.floor(reste / 60)} min ${reste % 60} s` : `${Math.max(1, reste)} s`}` : ''}` });
      }, 1200);
      const r = e.enLigne ? await act('telecharger_en_ligne', { index: e.enLigne.index, ref: e.enLigne.ref, fichier: e.enLigne.fichier ?? '', version: e.version ?? '', nom: e.enLigne.index === 'github' ? '' : e.nom }) : await act('telecharger', { nom: e.id });
      clearInterval(suivi); note(r);
      await lire();
    }

    const dessiner = () => {
      tabs.replaceChildren(...noms.map((n) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(n === S.tab), onclick: () => { S.tab = n; dessiner(); } }, n)));
      if (S.tab !== 'Store') { corps.replaceChildren(...dansOnglet(S.tab).map(([, n]) => n)); return; }
      const F = donnees?.filtres ?? {}, sel = (cle, label, valeurs) => { const s = el('select', { 'aria-label': label, onchange: (ev) => { S[cle] = ev.target.value; montrer(); } }, el('option', { value: '' }, 'tous'), ...(valeurs ?? []).map((v) => el('option', { value: v, selected: S[cle] === v }, v))); return el('label', {}, label, s); };
      const q = el('input', { type: 'search', placeholder: genre === 'iso' ? 'ex. ubuntu, debian live, pare-feu…' : 'ex. firefox, vlc, coffre…', value: S.q, 'aria-label': 'Chercher par nom', oninput: (ev) => { S.q = ev.target.value; clearTimeout(timer); timer = setTimeout(montrer, 180); }, onkeydown: (ev) => { if (ev.key === 'Enter' && S.enligne && S.q.trim()) void lire({ enligne: true }); } });
      const enligne = el('input', { type: 'checkbox', checked: S.enligne, onchange: (ev) => { S.enligne = ev.target.checked; } });
      const autres = dansOnglet('Store').filter(([s]) => !(s.kind === 'cards' && /^Store \(/.test(s.title)) && s.title !== 'Chercher dans le Store').map(([, n]) => n);
      corps.replaceChildren(
        el('div', { class: 'st-w' },
          el('div', { class: 'st-f' }, el('label', {}, 'Chercher par nom', q), sel('systeme', 'Système', F.systemes), sel('type', genre === 'iso' ? 'Type' : 'Catégorie', F.types), sel('arch', 'Architecture', F.archs), sel('famille', 'Famille', F.familles)),
          el('div', { class: 'st-row' },
            el('label', { class: 'st-chk' }, enligne, genre === 'iso' ? 'Chercher aussi en ligne (GitHub : « propriétaire/projet »)' : 'Chercher aussi en ligne (Homebrew, Flathub, GitHub)'),
            el('button', { class: 'st-btn pri', type: 'button', onclick: () => (S.enligne && S.q.trim() ? lire({ enligne: true }) : montrer()) }, 'Chercher'),
            el('button', { class: 'st-btn', type: 'button', onclick: () => lire({ actualiser: true }) }, 'Relire les versions'), info)),
        liste, ...autres);
      if (donnees) montrer(); else void lire();
    };
    dessiner();
    return true;
  };
  window.OdinPages.eitri = page('eitri', 'iso');
  window.OdinPages.fjalar = page('fjalar', 'logiciel');
})();
