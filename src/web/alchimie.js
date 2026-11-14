// Alchimie près d'Odin (maquette « Alchimie : convertir en 4 clics sur Odin », validée le 14/11/2026) :
//   - 4 clics (ou 4 touchers) rapides sur Odin, partout : une notification de la couleur d'Odin au-dessus de lui
//     (« 4 clics : Alchimie est ouverte ») et le panneau d'Alchimie juste au-dessus de lui (feuille du bas au téléphone) ;
//   - le panneau : déposer ou choisir des fichiers, 6 sortes, les conversions récentes (« Refaire ») ; puis les formats
//     possibles en tuiles (taille estimée), les autres, la qualité, « Garder la date de prise », « Rogner avant » ;
//     puis le suivi près d'Odin (fichier par fichier, Ouvrir le dossier, Annuler, place gagnée) ;
//   - le clic droit n'importe où dans les pages d'Odin : Copier, Coller, Demander à Odin, Convertir avec Alchimie ›,
//     Corriger avec Plume, Actualiser. Dans un champ de saisie, sur un lien ou une image, et avec Maj, le menu du
//     navigateur reste (Plume garde ses règles dans les champs).
// Chaque fichier passe d'abord par l'antivirus d'Odin (Asclépios) : c'est l'appli (dvalinn.ts) qui s'en charge.
// Le dessin suit le thème d'Odin (ses variables de couleurs) ; rien ne bouge si l'appareil demande moins d'animations.
(() => {
  'use strict';
  if (window.OdinAlchimie) return;
  const MOD = 'dvalinn';
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const phone = () => innerWidth < 600;
  const NS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------- petits outils
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'on') for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f);
      else if (k === 'style') e.style.cssText = v;
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v !== undefined && v !== null) e.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c !== undefined && c !== null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return e;
  };
  /** Remplace le contenu d'un élément (les « rien » — null, false — sont ignorés). */
  const remplir = (e, ...k) => e.replaceChildren(...k.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
  const ico = (d, n = 18, extra = '') => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', n); s.setAttribute('height', n); s.setAttribute('aria-hidden', 'true'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.innerHTML = `<path d="${d}"/>${extra}`; return s; };
  const P = {
    x: 'M6 6l12 12M18 6L6 18', up: 'M12 16V4M7 9l5-5 5 5M5 20h14', img: 'M4 6h16v12H4zM8 14l3-3 4 4 2-2 3 3', doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6',
    pdf: 'M6 3h8l4 4v14H6zM14 3v4h4M8 15h2.5a1.5 1.5 0 0 0 0-3H8v5', vid: 'M4 6h12v12H4zM16 10l4-2v8l-4-2', aud: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    tab: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14', ok: 'M5 12l5 5L20 7', copy: 'M9 9h11v11H9zM5 15V4h11', paste: 'M8 4h8v3H8zM6 6H5v15h14V6h-1', chat: 'M4 5h16v11H9l-5 4z',
    reload: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5', folder: 'M3 7h6l2 2h10v10H3z', chev: 'M9 6l6 6-6 6', warn: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  };
  const appIcon = (id, n, lettre) => (window.OdinAppIcons?.tile ? (() => { const t = document.createElement('span'); t.innerHTML = window.OdinAppIcons.tile(id, lettre, n); return t.firstElementChild || t; })() : h('span', { class: 'al-ic', style: `width:${n}px;height:${n}px` }, lettre.slice(0, 1)));
  const taille = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1).replace('.', ',')} Go` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1e3))} ko`);
  const COUL = { jpg: '#2563EB', png: '#7C3AED', webp: '#0891B2', pdf: '#DC2626', avif: '#0D9488', gif: '#DB2777', docx: '#2B579A', odt: '#1D4ED8', txt: '#64748B', mp4: '#EA580C', webm: '#C2410C', mp3: '#DB2777', m4a: '#BE185D', flac: '#9333EA', wav: '#6D28D9', xlsx: '#16A34A', csv: '#15803D', ods: '#166534' };
  const badge = (fmt, petit) => h('span', { class: `al-fic${petit ? ' p' : ''}`, 'aria-hidden': 'true', style: `background:${COUL[fmt] || '#475569'}` }, fmt.toUpperCase().slice(0, 4));
  const SORTES = [
    { id: 'image', label: 'Images', i: P.img, accept: 'image/*,.heic,.heif,.avif' },
    { id: 'document', label: 'Documents', i: P.doc, accept: '.doc,.docx,.odt,.rtf,.txt,.md,.html,.htm,.epub,.ppt,.pptx,.odp' },
    { id: 'pdf', label: 'PDF', i: P.pdf, accept: '.pdf,application/pdf' },
    { id: 'video', label: 'Vidéos', i: P.vid, accept: 'video/*,.mkv,.mov,.avi' },
    { id: 'audio', label: 'Audio', i: P.aud, accept: 'audio/*,.flac,.opus,.m4a' },
    { id: 'tableur', label: 'Tableaux', i: P.tab, accept: '.xls,.xlsx,.ods,.csv,.tsv,.json' },
  ];
  const sorteDe = (famille) => SORTES.find((x) => x.id === famille) || (famille === 'presentation' || famille === 'texte' || famille === 'livre' ? SORTES[1] : null);

  // ---------------------------------------------------------------- Odin (où il est, sa couleur)
  function odin() {
    const c = [document.getElementById('buddyRoam'), document.querySelector('.pet'), document.querySelector('.view.on #buddyChat')];
    return c.find((b) => b && !b.hidden && b.getClientRects().length && b.getBoundingClientRect().width > 0) || null;
  }
  function placeOdin() {
    const b = odin(); if (b) return b.getBoundingClientRect();
    return { left: innerWidth - 90, top: innerHeight - 100, right: innerWidth - 24, bottom: innerHeight - 34, width: 66, height: 66 };
  }
  /** La couleur d'Odin en ce moment (celle de son humeur), lue sur son dessin ; sinon celle du thème. */
  function couleurOdin(b = odin()) {
    const stop = b?.querySelector('[id^="odinBody"] stop:nth-of-type(2), radialGradient stop:nth-of-type(2)');
    let c = stop ? getComputedStyle(stop).stopColor : '';
    if (!c || c === 'rgba(0, 0, 0, 0)') c = getComputedStyle(document.documentElement).getPropertyValue('--odin-tint').trim() || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4F7FF0';
    return c;
  }
  function clair(c) {
    const p = document.createElement('span'); p.style.color = c; document.body.append(p); const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(getComputedStyle(p).color); p.remove();
    if (!m) return false; const [r, g, b] = m.slice(1).map((x) => { const v = Number(x) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42;
  }
  const visage = (humeur, ms = 2000) => { const b = odin(); if (b) window.OdinFace?.flash?.(b.classList.contains('odin') ? b : b.querySelector('.odin') || b, humeur, ms); };

  // ---------------------------------------------------------------- styles (variables du thème d'Odin)
  const CSS = `
.al-root{--al-bg:var(--panel,var(--card,#1E2646));--al-ink:var(--ink,var(--text,#EEF2FF));--al-mut:var(--muted,#AEB9DA);--al-line:var(--line,rgba(255,255,255,.14));--al-acc:var(--accent,#4F7FF0);--al-on:var(--on-accent,var(--on,var(--al-on-calc,#fff)));
  --al-soft:color-mix(in srgb,var(--al-acc) 16%,transparent);--al-field:color-mix(in srgb,var(--al-ink) 6%,transparent);color:var(--al-ink);font:14px/1.4 var(--body,system-ui,sans-serif);box-sizing:border-box}
.al-root *{box-sizing:border-box}:where(.al-root) button{font:inherit;color:inherit;cursor:pointer}.al-root :focus-visible{outline:2px solid var(--al-acc);outline-offset:2px}
.al-pan{position:fixed;z-index:70;width:min(480px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;border-radius:20px;background:color-mix(in srgb,var(--al-bg) 94%,transparent);border:1px solid var(--al-line);box-shadow:0 24px 60px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.08);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.al-pan.tel{left:0;right:0;bottom:0;width:auto;max-height:86vh;border-radius:24px 24px 0 0;border-width:1px 0 0;padding-bottom:env(safe-area-inset-bottom)}
.al-anim{animation:al-in .22s cubic-bezier(.2,.8,.3,1)}.al-pan.tel.al-anim{animation:al-up .26s cubic-bezier(.2,.8,.3,1)}
@keyframes al-in{from{opacity:0;transform:translateY(10px) scale(.98)}}@keyframes al-up{from{transform:translateY(100%)}}
.al-scrim{position:fixed;inset:0;z-index:69;background:rgba(0,0,0,.35)}html.al-ouvert .odin.roam{z-index:71}
.al-poignee{display:block;width:40px;height:5px;margin:10px auto 0;border-radius:3px;background:color-mix(in srgb,var(--al-ink) 30%,transparent)}
.al-tete{display:flex;align-items:center;gap:12px;padding:16px 18px 14px;border-bottom:1px solid var(--al-line)}.al-pan.tel .al-tete{padding:10px 16px 12px;border:0}
.al-tete b{display:block;font-size:17px;line-height:1.2}.al-tete small{display:block;font-size:13px;color:var(--al-mut)}
.al-x{width:36px;height:36px;border:0;border-radius:10px;background:var(--al-field);color:var(--al-mut);display:grid;place-items:center;flex:none}
.al-zone{margin:16px 18px 0;min-height:148px;border-radius:16px;border:2px dashed color-mix(in srgb,var(--al-acc) 55%,transparent);background:linear-gradient(180deg,var(--al-field),var(--al-soft));display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:14px;text-align:center}
.al-zone.sur{border-style:solid;background:var(--al-soft)}.al-zone .al-rond{width:46px;height:46px;border-radius:23px;background:var(--al-bg);box-shadow:0 4px 12px rgba(0,0,0,.1);display:grid;place-items:center;color:var(--al-acc)}
.al-zone small{font-size:13.5px;color:var(--al-mut)}.al-lien{border:0;background:none;padding:0;color:var(--al-acc);text-decoration:underline;font-size:13.5px}
.al-sortes{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;padding:14px 18px}.al-sortes button{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 0;border-radius:12px;border:1px solid var(--al-line);background:var(--al-field);font-size:12.5px;letter-spacing:-.01em;min-width:0}
.al-sortes svg{color:var(--al-acc)}.al-sortes span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.al-titre{padding:2px 18px 6px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--al-mut)}
.al-rec{padding:0 12px 10px}.al-rec>div{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 6px;border-top:1px solid color-mix(in srgb,var(--al-line) 60%,transparent)}
.al-rec .al-mini{width:32px;height:32px;border-radius:9px;background:var(--al-soft);color:var(--al-acc);display:grid;place-items:center;flex:none}.al-rec span.t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.al-rec time{font-size:13px;color:var(--al-mut)}
.al-b{height:32px;padding:0 12px;border-radius:9px;border:1px solid var(--al-line);background:var(--al-bg);font-size:13px;white-space:nowrap}.al-b.p{border:0;background:var(--al-acc);color:var(--al-on);font-weight:600}
.al-vide{padding:6px 18px 16px;color:var(--al-mut);font-size:13px}
.al-sel{display:flex;align-items:center;gap:14px;padding:14px 18px}.al-pile{display:flex}.al-pile>span{width:44px;height:44px;border-radius:10px;margin-left:-14px;box-shadow:0 0 0 3px var(--al-bg);background:linear-gradient(140deg,#8DB3C9,#34505F) center/cover;display:grid;place-items:center;font:700 10px system-ui;color:#fff}.al-pile>span:first-child{margin-left:0}
.al-sel .q{flex:1;min-width:0}.al-sel .q b{display:block}.al-sel .q small{display:block;font-size:13px;color:var(--al-mut);overflow-wrap:anywhere}
.al-tuiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0 18px}.al-tuiles button{display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;border:1px solid var(--al-line);background:var(--al-field);text-align:left;min-width:0}
.al-tuiles button[aria-pressed=true]{border:2px solid var(--al-acc);background:var(--al-soft);padding:11px}.al-tuiles .t{display:flex;flex-direction:column;min-width:0}.al-tuiles b{font-size:15px}.al-tuiles small{font-size:12.5px;color:var(--al-mut)}.al-tuiles em{font-style:normal;font-size:12px;color:var(--al-mut)}.al-tuiles button[aria-pressed=true] em{color:var(--al-acc)}
.al-fic{width:34px;height:40px;flex:none;border-radius:6px 12px 6px 6px;color:#fff;font:700 9px/1 system-ui,sans-serif;display:flex;align-items:flex-end;justify-content:center;padding-bottom:5px;box-shadow:inset 0 -3px 0 rgba(0,0,0,.12)}.al-fic.p{width:28px;height:33px;font-size:7px}
.al-pastilles{display:flex;flex-wrap:wrap;gap:6px;padding:12px 18px}.al-pastilles button{height:32px;padding:0 12px;border-radius:99px;border:1px solid var(--al-line);background:var(--al-bg);font-size:13px;font-weight:500}.al-pastilles button[aria-pressed=true]{border-color:var(--al-acc);background:var(--al-soft)}
.al-reg{margin:0 18px;padding:12px 14px;border-radius:14px;background:var(--al-field);display:flex;flex-direction:column;gap:10px}
.al-q{display:flex;align-items:center;gap:12px}.al-q label{width:60px;font-size:13.5px;color:var(--al-mut)}.al-q input{flex:1;accent-color:var(--al-acc);min-width:0}.al-q output{width:44px;text-align:right;font-weight:700}
.al-coches{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13.5px}.al-coches label{display:flex;align-items:center;gap:8px;cursor:pointer}.al-coches input{width:18px;height:18px;accent-color:var(--al-acc);margin:0}
.al-coches select{height:30px;border-radius:8px;border:1px solid var(--al-line);background:var(--al-bg);color:var(--al-ink);font:inherit;font-size:13px}
.al-pied{display:flex;align-items:center;gap:10px;padding:14px 18px 16px;flex-wrap:wrap}.al-pied small{font-size:13px;color:var(--al-mut);flex:1;min-width:150px}
.al-go{height:44px;padding:0 20px;border-radius:12px;border:0;background:var(--al-acc);color:var(--al-on);font-weight:600;font-size:15px}.al-pan.tel .al-go{width:100%;height:52px;border-radius:14px;font-size:16px}
.al-go:disabled{opacity:.55;cursor:default}
.al-msg{margin:12px 18px 0;padding:10px 12px;border-radius:12px;font-size:13.5px;background:var(--al-field)}.al-msg.mal{background:color-mix(in srgb,var(--bad,#EF4F43) 18%,transparent)}
.al-envoi{padding:4px 18px 16px}.al-envoi>div{display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13.5px}.al-envoi span.t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.al-barre{width:70px;height:6px;border-radius:3px;background:color-mix(in srgb,var(--al-ink) 16%,transparent);overflow:hidden;flex:none}.al-barre>i{display:block;height:6px;border-radius:3px;background:var(--al-acc);width:0;transition:width .3s}
.al-barre.indet>i{width:40%;animation:al-indet 1.2s ease-in-out infinite}@keyframes al-indet{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}
.al-suivi{position:fixed;z-index:70;width:min(360px,calc(100vw - 24px));padding:14px 18px;border-radius:20px;background:color-mix(in srgb,var(--al-bg) 94%,transparent);border:1px solid var(--al-line);box-shadow:0 24px 60px rgba(0,0,0,.28);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.al-suivi .h{display:flex;align-items:center;gap:10px}.al-suivi .h b{flex:1}.al-suivi .h span{font-size:13px;color:var(--al-acc);font-weight:600}
.al-lignes{padding-top:6px;max-height:min(50vh,320px);overflow:auto}.al-lignes>div{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid color-mix(in srgb,var(--al-line) 60%,transparent)}
.al-lignes .v{width:38px;height:38px;border-radius:9px;flex:none;background:linear-gradient(140deg,#8DB3C9,#34505F) center/cover;display:grid;place-items:center;font:700 9px system-ui;color:#fff}
.al-lignes .n{flex:1;min-width:0;display:flex;flex-direction:column}.al-lignes .n>*{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.al-lignes .n small{font-size:12.5px;color:var(--al-mut)}.al-lignes a{color:inherit;font-weight:500;text-decoration:none}.al-lignes a:hover{text-decoration:underline}
.al-lignes .ok{color:var(--al-acc)}.al-lignes .ko{color:var(--bad,#EF4F43)}
.al-suivi .f{display:flex;align-items:center;gap:8px;padding-top:10px;flex-wrap:wrap}.al-suivi .f .al-b{height:38px;padding:0 14px;border-radius:10px}.al-suivi .f small{flex:1;text-align:right;font-size:13px;color:var(--al-mut);min-width:70px}
.al-notif{position:fixed;z-index:72;display:flex;align-items:center;gap:8px;padding:9px 14px 9px 10px;border-radius:14px;font:600 14px/1.2 var(--body,system-ui,sans-serif);white-space:nowrap;max-width:calc(100vw - 24px);pointer-events:none}
.al-notif .n4{min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:rgba(255,255,255,.95);font-size:12px;font-weight:700;display:grid;place-items:center}
.al-notif .pt{position:absolute;bottom:-6px;width:12px;height:12px;transform:translateX(-50%) rotate(45deg);border-radius:2px}
.al-menu{position:fixed;z-index:75;width:290px;max-width:calc(100vw - 16px);padding:6px;border-radius:14px;background:color-mix(in srgb,var(--al-bg) 96%,transparent);border:1px solid var(--al-line);box-shadow:0 20px 50px rgba(0,0,0,.28);display:flex;flex-direction:column;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.al-menu.sous{width:240px}.al-menu [role=menuitem]{height:38px;display:flex;align-items:center;gap:10px;padding:0 10px;border:0;border-radius:9px;background:transparent;font-size:14px;text-align:left;width:100%}
.al-menu [role=menuitem]:hover,.al-menu [role=menuitem]:focus,.al-menu [role=menuitem][aria-expanded=true]{background:var(--al-soft);outline:none}.al-menu [role=menuitem][aria-disabled=true]{opacity:.45;cursor:default}
.al-menu [role=menuitem] span.t{flex:1}.al-menu kbd{font:12px system-ui;color:var(--al-mut)}.al-menu hr{height:1px;border:0;background:var(--al-line);margin:4px 8px}.al-menu .g{padding:6px 10px 2px;font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--al-mut)}
.al-menu svg{flex:none;color:var(--al-mut)}.al-menu .odin-app-ic{width:20px!important;height:20px!important;border-radius:5px!important}
.al-ic{display:inline-grid;place-items:center;border-radius:8px;background:linear-gradient(145deg,#2dd4bf,#0e7490);color:#fff;font-weight:700;flex:none}
@media (max-width:599px){.al-sortes{grid-template-columns:repeat(3,minmax(0,1fr))}.al-tuiles button{gap:10px;padding:10px;min-height:64px}.al-tuiles button[aria-pressed=true]{padding:9px}.al-zone{margin:6px 16px 0;min-height:120px}.al-sortes,.al-pastilles,.al-tuiles,.al-titre,.al-sel,.al-envoi{padding-left:16px;padding-right:16px}.al-reg{margin:0 16px}.al-pied{padding:14px 16px 20px}.al-pied small{display:none}}
@media (prefers-reduced-motion:reduce){.al-root,.al-root *{animation:none!important;transition:none!important}}`;
  let styled = false;
  function style() { if (styled) return; styled = true; const s = document.createElement('style'); s.id = 'alchimieCss'; s.textContent = CSS; document.head.append(s); }

  // ---------------------------------------------------------------- serveur
  async function act(action, input = {}) {
    const post = (b) => fetch('/api/valhalla/act', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(b) });
    let r = await post({ module: MOD, action, input });
    if (r.status === 401 || r.status === 403) throw new Error('Alchimie a besoin de ta session Odin (ou du droit sur Alchimie) : connecte-toi à Odin sur cet écran.');
    let j = await r.json().catch(() => ({ ok: false, error: `réponse illisible (${r.status})` }));
    // Le bouton sur lequel tu viens de cliquer vaut accord (ex. : un dossier de la maison) ; Heimdall revérifie.
    if (j.confirm) { r = await post({ module: MOD, action, input, confirm: true }); j = await r.json().catch(() => ({ ok: false })); }
    return j;
  }
  function envoyer(file, suivi) {
    return new Promise((ok, ko) => {
      const x = new XMLHttpRequest(); x.open('POST', `/api/valhalla/depot?module=${MOD}`);
      x.setRequestHeader('x-odin', '1'); x.setRequestHeader('x-filename', encodeURIComponent(file.name)); x.setRequestHeader('content-type', 'application/octet-stream');
      x.upload.onprogress = (e) => { if (e.lengthComputable) suivi?.(Math.round((100 * e.loaded) / e.total)); };
      x.onload = () => { let r = {}; try { r = JSON.parse(x.responseText); } catch { /* */ } if (x.status === 401 || x.status === 403) ko(new Error('Alchimie a besoin de ta session Odin : connecte-toi à Odin sur cet écran.')); else if (r.ok) ok(r); else ko(new Error(r.error || `envoi refusé (${x.status})`)); };
      x.onerror = () => ko(new Error('La connexion a été coupée pendant l\'envoi : réessaie.')); x.send(file);
    });
  }
  let recentes = null;
  async function chargerRecentes() { try { const r = await act('recentes'); recentes = Array.isArray(r.data) ? r.data : []; } catch { recentes = recentes || []; } return recentes; }
  const quand = (iso) => {
    const d = new Date(iso), j = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
    return j <= 0 ? 'aujourd\'hui' : j === 1 ? 'hier' : j < 7 ? d.toLocaleDateString('fr-FR', { weekday: 'long' }) : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  // ---------------------------------------------------------------- le panneau
  let racine = null, pan = null, scrim = null, avant = null, etat = null, picker = null;
  function root() { style(); if (!racine) { racine = h('div', { class: 'al-root', id: 'alchimie' }); document.body.append(racine); } contraste(); return racine; }
  /** Le texte posé sur la couleur du thème : foncé sur une couleur claire (thème jaune), blanc sinon. */
  function contraste() { const a = getComputedStyle(racine || document.body).getPropertyValue('--accent').trim(); document.documentElement.style.setProperty('--al-on-calc', a && clair(a) ? '#14100A' : '#FFFFFF'); }
  function fichierInput(accept, multiple = true) {
    picker?.remove();
    picker = h('input', { type: 'file', ...(multiple ? { multiple: true } : {}), ...(accept ? { accept } : {}), style: 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0', 'aria-hidden': 'true', tabindex: '-1' });
    picker.addEventListener('change', () => { const l = [...picker.files]; if (l.length) void deposer(l); });
    root().append(picker); return picker;
  }
  /** Ouvre le sélecteur de fichiers de l'appareil (sorte : filtre ; recette : format choisi d'avance). */
  function choisir(sorte, recette) { if (!pan) ouvrir({ silencieux: true }); if (recette !== undefined) etat.recette = recette; fichierInput(sorte?.accept || '').click(); }

  function ouvrir(o = {}) {
    if (pan) { if (o.recette) etat.recette = o.recette; pan.querySelector('button,input')?.focus(); return; }
    avant = document.activeElement; etat = { vue: 'accueil', fichiers: [], choix: null, format: '', qualite: 85, date: true, rogner: '', recette: o.recette || null };
    const r = root(), tel = phone();
    if (tel) { scrim = h('div', { class: 'al-scrim', on: { click: fermer } }); r.append(scrim); }
    pan = h('section', { class: `al-pan${tel ? ' tel' : ''}${still() ? '' : ' al-anim'}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'alTitre' });
    pan.addEventListener('keydown', clavier); pan.addEventListener('pointerdown', sansNotif);
    pan.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); pan.querySelector('.al-zone')?.classList.add('sur'); } });
    pan.addEventListener('dragleave', (e) => { if (!pan.contains(e.relatedTarget)) pan.querySelector('.al-zone')?.classList.remove('sur'); });
    pan.addEventListener('drop', (e) => { e.preventDefault(); const l = [...(e.dataTransfer?.files || [])]; if (l.length) void deposer(l); });
    r.append(pan); document.documentElement.classList.add('al-ouvert'); dessiner(); placer();
    // Le focus va dans le panneau (après le geste en cours : le dernier clic sur Odin ne doit pas le reprendre).
    if (!o.silencieux) { const f = () => pan?.querySelector('.al-zone .al-lien, .al-x')?.focus({ preventScroll: true }); f(); setTimeout(f, 80); }
    void chargerRecentes().then(() => { if (pan && etat.vue === 'accueil') dessiner(); });
    return pan;
  }
  function fermer() {
    if (!pan) return; sansNotif(); document.documentElement.classList.remove('al-ouvert'); pan.remove(); scrim?.remove(); pan = null; scrim = null;
    for (const u of etat?.apercus || []) URL.revokeObjectURL(u);
    window.OdinCompanion?.pin?.(0);
    // Odin reprend sa liberté depuis là où il est (au téléphone, il était posé au-dessus de la feuille).
    { const b = document.getElementById('buddyRoam'); if (b && !b.hidden && phone()) { const r = b.getBoundingClientRect(); window.OdinCompanion?.go?.(r.left + r.width / 2, r.top + r.height / 2); } }
    try { avant?.focus?.({ preventScroll: true }); } catch { /* */ }
  }
  /** Juste au-dessus d'Odin (ordinateur), aligné sur lui ; dessous s'il n'y a pas la place. */
  function placer() {
    if (pan?.classList.contains('tel')) { odinTel(); return; }
    if (!pan) return;
    const o = placeOdin(), w = pan.offsetWidth, ht = pan.offsetHeight, m = 12;
    const left = Math.min(Math.max(m, o.right + 8 - w), innerWidth - w - m);
    let top = o.top - 34 - ht; if (top < m) top = Math.min(innerHeight - ht - m, o.bottom + 12); top = Math.max(m, top);
    pan.style.left = `${Math.round(left)}px`; pan.style.top = `${Math.round(top)}px`;
  }
  /** Téléphone : Odin se tient juste au-dessus de la feuille, à droite (comme sur la maquette). */
  function odinTel() {
    const b = document.getElementById('buddyRoam'); if (!b || b.hidden || !pan) return;
    window.OdinCompanion?.pin?.(30 * 60e3); const s = b.offsetWidth || 46;
    const t = `${Math.round(innerWidth - s - 16)}px ${Math.round(innerHeight - pan.offsetHeight - s - 10)}px`;
    if (b.style.translate !== t) { b.classList.add('hopto'); clearTimeout(odinTel.t); odinTel.t = setTimeout(() => b.classList.remove('hopto'), 800); b.style.translate = t; }
  }
  function clavier(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); return; }
    if (e.key !== 'Tab') return;
    const f = [...pan.querySelectorAll('button:not([disabled]),input:not([disabled]):not([type=file]),select,a[href],[tabindex="0"]')].filter((x) => x.offsetParent !== null);
    if (!f.length) return; const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
  const tete = (sous) => [phone() ? h('span', { class: 'al-poignee', 'aria-hidden': 'true' }) : null,
    h('div', { class: 'al-tete' }, appIcon(MOD, 36, 'Alchimie'), h('div', { style: 'flex:1;min-width:0' }, h('b', { id: 'alTitre' }, 'Alchimie'), h('small', {}, sous)),
      h('button', { type: 'button', class: 'al-x', 'aria-label': 'Fermer Alchimie', on: { click: fermer } }, ico(P.x, 16)))];

  function dessiner() {
    if (!pan) return;
    const v = etat.vue, garde = pan.contains(document.activeElement) ? document.activeElement.dataset?.k : '';
    if (v === 'accueil') {
      const rec = recentes === null ? [h('div', { class: 'al-vide' }, 'Chargement…')] : recentes.length ? [h('div', { class: 'al-rec' }, recentes.slice(0, 3).map((r) => h('div', {},
        h('span', { class: 'al-mini' }, ico(sorteDe(r.famille)?.i || P.doc, 16)), h('span', { class: 't' }, r.titre), h('time', { datetime: r.at }, quand(r.at)),
        h('button', { type: 'button', class: 'al-b', 'data-k': `r${r.id}`, 'aria-label': `Refaire : ${r.titre}`, on: { click: () => choisir(sorteDe(r.famille), r) } }, 'Refaire'))))]
        : [h('div', { class: 'al-vide' }, 'Rien encore : dépose un fichier, Alchimie s\'en souviendra.')];
      remplir(pan, ...tete(etat.recette ? `Refaire : ${etat.recette.titre}` : 'Convertir un fichier'),
        h('div', { class: 'al-zone' }, h('span', { class: 'al-rond' }, ico(P.up, 22)), h('b', {}, 'Dépose tes fichiers ici'),
          h('small', {}, 'ou ', h('button', { type: 'button', class: 'al-lien', 'data-k': 'choisir', on: { click: () => choisir(etat.recette ? sorteDe(etat.recette.famille) : null) } }, 'choisis-les sur cet appareil'))),
        h('div', { class: 'al-sortes', role: 'group', 'aria-label': 'Choisir une sorte de fichiers' }, SORTES.map((x) => h('button', { type: 'button', 'data-k': `s${x.id}`, on: { click: () => choisir(x) } }, ico(x.i, 20), h('span', {}, x.label)))),
        h('div', { class: 'al-titre' }, 'Tes conversions récentes'), ...rec);
    } else if (v === 'envoi') {
      remplir(pan, ...tete('Envoi et vérification par Asclépios…'), h('div', { class: 'al-envoi', role: 'status', 'aria-live': 'polite' },
        etat.fichiers.map((f) => h('div', {}, h('span', { class: 't' }, f.file.name), h('small', { style: 'color:var(--al-mut)' }, f.ref ? 'envoyé' : `${f.pct || 0} %`), h('span', { class: `al-barre${f.ref ? '' : ' indet'}` }, h('i', { style: f.ref ? 'width:100%' : '' }))))),
        etat.erreur ? h('div', { class: 'al-msg mal', role: 'alert' }, etat.erreur) : null, etat.erreur ? h('div', { class: 'al-pied' }, h('span', { style: 'flex:1' }), h('button', { type: 'button', class: 'al-b', on: { click: () => { etat = { ...etat, vue: 'accueil', fichiers: [], erreur: '' }; dessiner(); } } }, 'Recommencer')) : null);
    } else if (v === 'formats') dessinerFormats();
    placer();
    if (garde) pan.querySelector(`[data-k="${garde}"]`)?.focus({ preventScroll: true });
  }

  function dessinerFormats() {
    const c = etat.choix, n = etat.fichiers.length, fmt = etat.format, tel = phone();
    const apercus = etat.fichiers.slice(0, 3).map((f, i) => h('span', { style: f.url ? `background-image:url("${f.url}")` : `background:linear-gradient(140deg,${['#8DB3C9,#34505F', '#E2B98C,#7A5232', '#A8C59F,#45603F'][i]})` }, f.url ? '' : (f.file.name.split('.').pop() || '').toUpperCase().slice(0, 4)));
    const photos = c.famille === 'image', quoi = n > 1 ? `${n} ${photos ? 'photos' : 'fichiers'}` : etat.fichiers[0].file.name;
    const av = c.antivirus === 'absent' ? 'antivirus absent' : 'vérifiés par Asclépios';
    const tuile = (t) => h('button', { type: 'button', 'aria-pressed': String(t.format === fmt), 'data-k': `t${t.format}`, on: { click: () => { etat.format = t.format; dessiner(); } } },
      badge(t.format, tel), h('span', { class: 't' }, h('b', {}, t.label), h('small', {}, t.desc), tel ? null : h('em', {}, t.estim)));
    const tuiles = tel ? c.tuiles : c.tuiles, autre = c.autres.find((x) => x.format === fmt);
    const lab = autre ? autre.label : (c.tuiles.find((t) => t.format === fmt)?.label || fmt.toUpperCase());
    remplir(pan, ...tete(tel ? `${quoi} · ${c.exts}` : 'Convertir un fichier'),
      tel ? null : h('div', { class: 'al-sel' }, h('span', { class: 'al-pile', 'aria-hidden': 'true' }, apercus), h('span', { class: 'q' }, h('b', {}, quoi), h('small', {}, `${c.exts} · ${c.totalTexte} · ${av}`)),
        c.antivirus === 'absent' ? null : appIcon('ullr', 22, 'Asclépios')),
      tel ? null : h('div', { class: 'al-titre' }, 'Convertir en'),
      h('div', { class: 'al-tuiles', role: 'group', 'aria-label': 'Convertir en' }, tuiles.map(tuile)),
      !tel && c.autres.length ? h('div', { class: 'al-pastilles', role: 'group', 'aria-label': 'Autres formats' }, c.autres.slice(0, 5).map((x) => h('button', { type: 'button', 'aria-pressed': String(x.format === fmt), 'data-k': `a${x.format}`, on: { click: () => { etat.format = x.format; dessiner(); } } }, x.label)),
        h('button', { type: 'button', 'data-k': 'tous', on: { click: tousLesFormats } }, 'Tous les formats…')) : (tel ? null : h('div', { style: 'height:12px' })),
      !tel && (c.options.qualite || c.options.date || c.options.rogner) ? h('div', { class: 'al-reg' },
        c.options.qualite ? h('div', { class: 'al-q' }, h('label', { for: 'alQ' }, 'Qualité'), h('input', { id: 'alQ', type: 'range', min: '30', max: '100', step: '1', value: String(etat.qualite), 'data-k': 'q', on: { input: (e) => { etat.qualite = Number(e.target.value); pan.querySelector('#alQo').textContent = `${etat.qualite} %`; }, change: () => void reestimer() } }), h('output', { id: 'alQo', for: 'alQ' }, `${etat.qualite} %`)) : null,
        c.options.date || c.options.rogner ? h('div', { class: 'al-coches' },
          c.options.date ? h('label', {}, h('input', { type: 'checkbox', 'data-k': 'd', ...(etat.date ? { checked: true } : {}), on: { change: (e) => { etat.date = e.target.checked; } } }), 'Garder la date de prise') : null,
          c.options.rogner ? h('label', {}, h('input', { type: 'checkbox', 'data-k': 'r', ...(etat.rogner ? { checked: true } : {}), on: { change: (e) => { etat.rogner = e.target.checked ? 'carre' : ''; dessiner(); } } }), 'Rogner avant') : null,
          etat.rogner ? h('select', { 'aria-label': 'Forme du cadre', 'data-k': 'rr', on: { change: (e) => { etat.rogner = e.target.value; } } }, [['carre', 'Carré'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9']].map(([k, t]) => h('option', { value: k, ...(etat.rogner === k ? { selected: true } : {}) }, t))) : null) : null) : null,
      etat.erreur ? h('div', { class: 'al-msg mal', role: 'alert' }, etat.erreur) : null,
      h('div', { class: 'al-pied' }, h('small', {}, 'Enregistrer à côté des originaux'), h('button', { type: 'button', class: 'al-go', 'data-k': 'go', ...(fmt ? {} : { disabled: true }), on: { click: () => void convertir() } }, `Convertir en ${lab}`)));
  }
  async function reestimer() {
    try { const r = await act('preparer', { fichiers: etat.fichiers.map((f) => f.ref).join(','), qualite: etat.qualite }); if (r.ok !== false && r.data?.tuiles && pan) { etat.choix = { ...etat.choix, tuiles: r.data.tuiles }; dessiner(); } } catch { /* l'estimation reste l'ancienne */ }
  }
  function tousLesFormats() { fermer(); ouvrirAppli(); }
  function ouvrirAppli() { if (window.OdinApps?.app) { window.OdinShow?.('apps'); setTimeout(() => window.OdinApps.app(MOD), 120); } else location.href = '/'; }

  /** Fichiers déposés : envoyés à Odin (atelier d'Alchimie), vérifiés par l'antivirus, puis les formats possibles. */
  async function deposer(liste) {
    if (!pan) ouvrir({ silencieux: true });
    const fichiers = liste.slice(0, 50).map((file) => ({ file, pct: 0, ref: '', url: /^image\/(png|jpe?g|webp|gif|avif|bmp)$/.test(file.type) ? URL.createObjectURL(file) : '' }));
    sansNotif(); etat = { ...etat, vue: 'envoi', fichiers, erreur: '', apercus: fichiers.map((f) => f.url).filter(Boolean) }; dessiner();
    visage('ecoute', 2500);
    try {
      for (const f of fichiers) { const r = await envoyer(f.file, (p) => { f.pct = p; const s = pan?.querySelectorAll('.al-envoi small')[fichiers.indexOf(f)]; if (s) s.textContent = `${p} %`; }); f.ref = r.ref; f.taille = r.size; dessiner(); }
      const r = await act('preparer', { fichiers: fichiers.map((f) => f.ref).join(','), qualite: etat.qualite });
      if (r.ok === false || !r.data?.tuiles) throw new Error(r.text || r.error || 'Je ne sais pas convertir ces fichiers.');
      etat.choix = r.data; etat.vue = 'formats';
      const voulu = etat.recette?.vers; const tous = [...r.data.tuiles, ...r.data.autres].map((x) => x.format);
      etat.format = voulu && tous.includes(voulu) ? voulu : r.data.defaut || '';
      if (etat.recette) { if (etat.recette.qualite) etat.qualite = etat.recette.qualite; etat.date = etat.recette.garder_date ?? etat.date; etat.rogner = etat.recette.rogner || ''; }
      // Formats vus du serveur (vérifiés par l'antivirus) : on reprend les noms qu'Odin a donnés.
      for (const [i, f] of fichiers.entries()) f.nom = r.data.fichiers?.[i]?.nom || f.file.name;
      dessiner(); visage('joie', 1500);
      pan?.querySelector('.al-go')?.focus({ preventScroll: true });
    } catch (e) { etat.erreur = e.message; etat.vue = 'envoi'; dessiner(); visage('inquiet', 2500); }
  }

  // ---------------------------------------------------------------- le suivi près d'Odin
  let suivi = null;
  async function convertir() {
    const c = etat.choix, fmt = etat.format, fichiers = etat.fichiers.slice(), lab = [...c.tuiles, ...c.autres].find((x) => x.format === fmt)?.label || fmt.toUpperCase();
    const enUn = fmt === 'pdf' && c.famille === 'image' && fichiers.length > 1;
    const opt = { ...(c.options.qualite ? { qualite: etat.qualite } : {}), ...(c.options.date && etat.date ? { garder_date: true } : {}), ...(c.options.rogner && etat.rogner ? { rogner: etat.rogner } : {}) };
    const apercus = fichiers.map((f) => f.url); etat.apercus = []; // gardés pour le suivi
    fermer();
    const lignes = enUn ? [{ nom: `${fichiers.length} images → 1 PDF`, url: apercus[0], etat: 'attente' }] : fichiers.map((f, i) => ({ nom: f.nom, url: apercus[i], etat: 'attente' }));
    const titre = `${fichiers.length > 1 ? `${fichiers.length} ${c.famille === 'image' ? 'photos' : 'fichiers'}` : fichiers[0].nom} en ${lab}`;
    suivi?.el.remove();
    suivi = { lignes, annule: false, fini: false, avant: 0, apres: 0, titre, apercus };
    const el = h('section', { class: 'al-suivi', role: 'status', 'aria-live': 'polite', 'aria-label': `Alchimie : ${titre}` });
    suivi.el = el; root().append(el); dessinerSuivi();
    visage('reflexion', 3000);
    const une = async (k, input, action) => {
      const l = lignes[k]; l.etat = 'cours'; dessinerSuivi();
      try {
        const r = await act(action, input);
        if (r.ok === false) { l.etat = 'erreur'; l.texte = String(r.text || r.error || 'échec').split('\n')[0]; }
        else { l.etat = 'fait'; l.fichiers = r.fichiers || []; const d = r.data || {}; l.avant = d.avant || fichiers[k]?.taille || 0; l.apres = d.apres || 0; if (l.fichiers[0]) l.nom = l.fichiers[0].nom; suivi.avant += l.avant; suivi.apres += l.apres; }
      } catch (e) { l.etat = 'erreur'; l.texte = e.message; }
      dessinerSuivi();
    };
    if (enUn) await une(0, { operation: 'images_en_pdf', fichiers: fichiers.map((f) => f.ref).join(',') }, 'pdf');
    else for (let k = 0; k < fichiers.length; k++) { if (suivi.annule) { for (const l of lignes.slice(k)) l.etat = 'annule'; break; } await une(k, { fichier: fichiers[k].ref, format: fmt, ...opt }, 'convertir'); }
    suivi.fini = true; dessinerSuivi();
    const ko = lignes.some((l) => l.etat === 'erreur');
    visage(ko ? 'triste' : 'joie', 2600); window.OdinCompanion?.act?.(ko ? 'act-sad' : 'act-joy', 1200);
    void chargerRecentes();
  }
  function dessinerSuivi() {
    if (!suivi) return; const s = suivi, faits = s.lignes.filter((l) => l.etat === 'fait').length, gain = s.avant - s.apres;
    const ligne = (l) => h('div', {},
      h('span', { class: 'v', 'aria-hidden': 'true', style: l.url ? `background-image:url("${l.url}")` : '' }, l.url ? '' : (l.nom.split('.').pop() || '').toUpperCase().slice(0, 4)),
      h('span', { class: 'n' }, l.fichiers?.[0] ? h('a', { href: `/api/valhalla/fichier?module=${MOD}&ref=${encodeURIComponent(l.fichiers[0].ref)}`, download: l.fichiers[0].nom, title: 'Télécharger sur cet appareil' }, l.nom) : h('span', { style: 'font-weight:500' }, l.nom),
        h('small', {}, l.etat === 'fait' ? (l.avant && l.apres ? `${taille(l.avant)} → ${taille(l.apres)}` : l.fichiers?.length > 1 ? `${l.fichiers.length} fichiers` : 'fait') : l.etat === 'cours' ? 'conversion…' : l.etat === 'erreur' ? l.texte : l.etat === 'annule' ? 'annulé' : 'en attente')),
      l.etat === 'fait' ? h('span', { class: 'ok', 'aria-label': 'fait' }, ico(P.ok, 18)) : l.etat === 'erreur' ? h('span', { class: 'ko', 'aria-label': 'échec' }, ico(P.warn, 18)) : l.etat === 'cours' ? h('span', { class: 'al-barre indet', 'aria-hidden': 'true' }, h('i')) : null);
    remplir(s.el, 
      h('div', { class: 'h' }, appIcon(MOD, 28, 'Alchimie'), h('b', {}, s.titre), h('span', {}, s.fini && faits === s.lignes.length ? 'terminé' : `${faits} sur ${s.lignes.length}`)),
      h('div', { class: 'al-lignes' }, s.lignes.map(ligne)),
      h('div', { class: 'f' },
        h('button', { type: 'button', class: 'al-b p', on: { click: () => { fermerSuivi(); ouvrirAppli(); } } }, 'Ouvrir le dossier'),
        h('button', { type: 'button', class: 'al-b', on: { click: () => { if (s.fini) fermerSuivi(); else { s.annule = true; dessinerSuivi(); } } } }, s.fini ? 'Fermer' : s.annule ? 'J\'arrête après celui-ci…' : 'Annuler'),
        h('small', {}, s.apres ? (gain >= 0 ? `${taille(gain)} gagnés` : `${taille(-gain)} de plus`) : '')));
    placerSuivi();
  }
  function fermerSuivi() { if (!suivi) return; suivi.el.remove(); for (const u of suivi.apercus || []) if (u) URL.revokeObjectURL(u); suivi = null; }
  function placerSuivi() {
    const e = suivi?.el; if (!e) return; const o = placeOdin(), w = e.offsetWidth, ht = e.offsetHeight, m = 12;
    if (phone()) { e.style.left = `${m}px`; e.style.right = `${m}px`; e.style.width = 'auto'; e.style.top = `${Math.max(m, Math.min(innerHeight - ht - m, o.top - ht - 16))}px`; return; }
    e.style.left = `${Math.round(Math.min(Math.max(m, o.left - w - 16), innerWidth - w - m))}px`;
    e.style.top = `${Math.round(Math.max(m, Math.min(innerHeight - ht - m, o.top - ht * 0.75)))}px`;
  }
  addEventListener('resize', () => { placer(); placerSuivi(); });

  // ---------------------------------------------------------------- 4 clics : la notification de la couleur d'Odin
  let notifT = 0;
  function notifier(n = 4) {
    style(); document.getElementById('alNotif')?.remove(); clearTimeout(notifT);
    const b = odin(), c = couleurOdin(b), fonce = clair(c), sheet = pan?.classList.contains('tel') ? { top: innerHeight - pan.offsetHeight } : null;
    // Téléphone : la feuille couvre le bas de l'écran ; la notification se pose juste au-dessus d'elle, à droite (là où Odin vient se mettre).
    const o = sheet ? (() => { const s = b?.offsetWidth || 46; return { left: innerWidth - s - 16, right: innerWidth - 16, width: s, height: s, top: sheet.top - s - 10, bottom: sheet.top - 10 }; })() : placeOdin();
    const pt = h('span', { class: 'pt', 'aria-hidden': 'true', style: `background:${c}` });
    const e = h('div', { id: 'alNotif', class: 'al-root al-notif', role: 'status', 'aria-live': 'polite',
      style: `background:linear-gradient(180deg,color-mix(in srgb,${c} 78%,#fff),${c});color:${fonce ? '#14100A' : '#fff'};box-shadow:0 10px 24px color-mix(in srgb,${c} 45%,transparent),inset 0 1px 0 rgba(255,255,255,.3)` },
    h('span', { class: 'n4', style: `color:${c}` }, String(n)), `${n} clics : Alchimie est ouverte`, pt);
    document.body.append(e);
    const w = e.offsetWidth, ht = e.offsetHeight, cx = o.left + o.width / 2, m = 8;
    if (o.top - ht - 14 >= m) {
      const left = Math.min(Math.max(m, cx - w * 0.62), innerWidth - w - m);
      e.style.left = `${Math.round(left)}px`; e.style.top = `${Math.round(o.top - ht - 14)}px`; pt.style.left = `${Math.round(Math.min(Math.max(14, cx - left), w - 14))}px`;
    } else {
      // Odin tout en haut de l'écran : la notification se pose à côté de lui (à gauche, ou à droite s'il n'y a pas la place).
      const gauche = o.left - w - 14 >= m, left = gauche ? o.left - w - 14 : Math.min(o.right + 14, innerWidth - w - m), top = Math.max(m, o.top + o.height / 2 - ht / 2);
      e.style.left = `${Math.round(left)}px`; e.style.top = `${Math.round(top)}px`;
      pt.style.bottom = 'auto'; pt.style.top = `${Math.round(ht / 2 - 6)}px`; pt.style.left = gauche ? `${w}px` : '0px';
    }
    if (!still()) e.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
    notifT = setTimeout(() => e.remove(), 4000);
  }
  const sansNotif = () => { clearTimeout(notifT); document.getElementById('alNotif')?.remove(); };
  /** Ce que font 4 clics (ou 4 touchers) rapides sur Odin. */
  function quatre(_b, n = 4) {
    if (pan) { notifier(n); pan.querySelector('.al-zone .al-lien, .al-x')?.focus({ preventScroll: true }); return; }
    ouvrir(); notifier(n); visage('joie', 1500);
  }

  // ---------------------------------------------------------------- le clic droit d'Odin
  let menu = null, sous = null, dernierChamp = null, origine = null;
  const champ = (x) => x instanceof Element && (x.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]),textarea,select') || x.isContentEditable);
  document.addEventListener('focusin', (e) => { if (champ(e.target) && !e.target.closest('.al-root')) dernierChamp = e.target; });
  function fermerMenu(rendre = true) { sous?.remove(); sous = null; if (menu) { menu.remove(); menu = null; if (rendre) try { origine?.focus?.({ preventScroll: true }); } catch { /* */ } } }
  const item = (label, i, run, o = {}) => h('button', { type: 'button', role: 'menuitem', tabindex: '-1', ...(o.off ? { 'aria-disabled': 'true', title: o.off } : {}), ...(o.sous ? { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } : {}), on: { click: (e) => { e.preventDefault(); if (o.off) return; if (o.sous) { o.sous(e.currentTarget); return; } fermerMenu(false); run(); } } },
    i instanceof Node ? i : i ? ico(i, 16) : h('span', { style: 'width:16px;flex:none' }), h('span', { class: 't', style: o.fort ? 'font-weight:600' : '' }, label), o.kbd ? h('kbd', {}, o.kbd) : null, o.sous ? ico(P.chev, 14) : null);
  function poser(m, x, y) {
    document.body.append(m); const w = m.offsetWidth, ht = m.offsetHeight;
    m.style.left = `${Math.round(Math.max(8, Math.min(x, innerWidth - w - 8)))}px`; m.style.top = `${Math.round(Math.max(8, Math.min(y, innerHeight - ht - 8)))}px`;
  }
  function navigation(m, retour) {
    m.addEventListener('keydown', (e) => {
      const l = [...m.querySelectorAll('[role=menuitem]')], k = l.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); l[(k + (e.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length]?.focus(); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); (e.key === 'Home' ? l[0] : l[l.length - 1])?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (retour) retour(); else fermerMenu(); }
      else if (e.key === 'ArrowRight' && document.activeElement?.getAttribute('aria-haspopup')) { e.preventDefault(); document.activeElement.click(); }
      else if (e.key === 'ArrowLeft' && retour) { e.preventDefault(); retour(); }
      else if (e.key === 'Tab') { e.preventDefault(); fermerMenu(); }
    });
  }
  function sousMenu(depuis) {
    sous?.remove(); depuis.setAttribute('aria-expanded', 'true');
    const r = depuis.getBoundingClientRect(), rec = (recentes || []).slice(0, 3);
    sous = h('div', { class: 'al-root al-menu sous', role: 'menu', 'aria-label': 'Convertir avec Alchimie' },
      item('Ouvrir Alchimie', appIcon(MOD, 20, 'Alchimie'), () => ouvrir()),
      item('Choisir des fichiers…', P.folder, () => { ouvrir({ silencieux: true }); choisir(null); }),
      rec.length ? h('hr') : null, rec.length ? h('div', { class: 'g', 'aria-hidden': 'true' }, 'Récentes') : null,
      rec.map((x) => item(x.titre, null, () => { ouvrir({ recette: x }); choisir(sorteDe(x.famille), x); })));
    const retour = () => { sous?.remove(); sous = null; depuis.setAttribute('aria-expanded', 'false'); depuis.focus(); };
    navigation(sous, retour); document.body.append(sous);
    const w = sous.offsetWidth, x = r.right + 4 + w > innerWidth - 8 ? r.left - w - 4 : r.right + 4;
    poser(sous, x, r.top - 6); sous.querySelector('[role=menuitem]')?.focus();
  }
  function ouvrirMenu(x, y, texte) {
    fermerMenu(false); style(); origine = document.activeElement;
    const peutParler = Boolean(window.OdinNotices?.talk), plume = window.OdinPlume?.etat?.(), plumeOk = peutParler && plume?.actif !== false;
    const champOk = dernierChamp?.isConnected && dernierChamp.offsetParent !== null && !dernierChamp.disabled && !dernierChamp.readOnly;
    menu = h('div', { class: 'al-root al-menu', role: 'menu', 'aria-label': 'Menu d\'Odin' },
      item('Copier', P.copy, () => copier(texte), { kbd: 'Ctrl C', ...(texte ? {} : { off: 'Sélectionne d\'abord un texte' }) }),
      item('Coller', P.paste, () => void coller(), { kbd: 'Ctrl V', ...(champOk ? {} : { off: 'Clique d\'abord dans un champ de saisie' }) }),
      h('hr'),
      peutParler ? item('Demander à Odin', P.chat, () => parler(texte ? `« ${texte.slice(0, 400)} » ` : '')) : null,
      item('Convertir avec Alchimie', appIcon(MOD, 20, 'Alchimie'), null, { fort: true, sous: sousMenu }),
      plumeOk ? item('Corriger avec Plume', window.OdinAppIcons?.has?.('snotra') ? appIcon('snotra', 20, 'Plume') : P.doc, () => parler(`Corrige ce texte : « ${texte.slice(0, 2000)} »`, true), texte ? {} : { off: 'Sélectionne d\'abord un texte à corriger' }) : null,
      h('hr'),
      item('Actualiser', P.reload, () => location.reload(), { kbd: 'F5' }));
    navigation(menu); poser(menu, x, y);
    menu.querySelector('[role=menuitem]:not([aria-disabled])')?.focus({ preventScroll: true });
    void chargerRecentes();
  }
  function copier(t) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).catch(() => document.execCommand('copy')); else document.execCommand('copy');
  }
  async function coller() {
    const c = dernierChamp; if (!c) return; let t = '';
    try { t = await navigator.clipboard.readText(); } catch { c.focus(); return; }
    c.focus();
    if (c.isContentEditable) document.execCommand('insertText', false, t);
    else if (typeof c.setRangeText === 'function') { try { c.setRangeText(t, c.selectionStart ?? c.value.length, c.selectionEnd ?? c.value.length, 'end'); } catch { c.value += t; } c.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  function parler(debut, envoyer) {
    window.OdinNotices?.talk?.();
    setTimeout(() => {
      const i = document.querySelector('#odinTalk input'); if (!i) return;
      i.value = debut; i.focus(); i.setSelectionRange?.(i.value.length, i.value.length);
      if (envoyer && debut) i.form?.requestSubmit?.();
    }, 60);
  }
  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    // Le menu du navigateur reste : Maj + clic droit, champs de saisie (Plume y a ses règles), liens, images et vidéos,
    // terminaux, et tout ce qui a déjà son propre clic droit.
    if (e.defaultPrevented || e.shiftKey || !(t instanceof Element)) return;
    if (champ(t) || t.closest('input,textarea,select,[contenteditable=""],[contenteditable=true],a[href],img,video,audio,iframe,.xterm,.al-root,[data-menu-navigateur]')) return;
    const lg = document.getElementById('login'); if (lg && !lg.hidden && lg.getClientRects().length) return;
    e.preventDefault();
    ouvrirMenu(e.clientX, e.clientY, String(getSelection?.() || '').trim());
  });
  document.addEventListener('pointerdown', (e) => { if (menu && !e.target.closest?.('.al-menu')) fermerMenu(false); }, true);
  addEventListener('blur', () => fermerMenu(false)); addEventListener('resize', () => fermerMenu(false));
  document.addEventListener('scroll', () => fermerMenu(false), { passive: true, capture: true });
  // Échap ferme aussi le panneau quand le focus est ailleurs (après un dépôt depuis le bureau, par exemple).
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pan && !pan.contains(document.activeElement) && !menu) fermer(); });

  // Déposer des fichiers sur Odin lui-même ouvre Alchimie avec eux.
  document.addEventListener('dragover', (e) => { const b = odin(); if (b && e.target instanceof Element && b.contains(e.target) && [...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => { const b = odin(); if (b && e.target instanceof Element && b.contains(e.target) && e.dataTransfer?.files?.length) { e.preventDefault(); ouvrir({ silencieux: true }); void deposer([...e.dataTransfer.files]); } });

  window.OdinAlchimie = { ouvrir, fermer, quatre, notifier, choisir: (sorte) => choisir(SORTES.find((x) => x.id === sorte) || null), deposer: (l) => deposer([...l]), menu: ouvrirMenu, get ouvert() { return Boolean(pan); } };
})();
