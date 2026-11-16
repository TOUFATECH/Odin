// La mise en forme des réponses d'Odin, une seule pour toute l'interface : la Discussion, l'infobulle d'Odin (sa
// bulle) et ses notifications s'en servent (window.OdinRendu). C'est du Markdown sûr : le texte du modèle ou d'une
// source n'est JAMAIS mis en HTML, chaque élément est construit un par un (createElement, textContent).
//   - liens : http(s) ou une page d'Odin (« /recherche ») seulement, jamais « javascript: » ni « data: » ;
//   - images : http(s) passées par Odin (/api/recherche/vignette : la page n'appelle jamais un autre site), ou une
//     image « data: » (png, jpeg, gif, webp, avif) ; taille maîtrisée, zoom au clic ;
//   - son : un lecteur ; vidéo : une miniature, la lecture au clic seulement, et « Ouvrir dans le navigateur »,
//     « Copier le lien », « Partager » ;
//   - tableaux : de vrais tableaux alignés (colonnes :--- :---: ---:), qui défilent de côté sur téléphone ;
//   - le logo d'une appli d'Odin à côté de son nom (OdinAppIcons) ;
//   - les résultats de recherche de Pythie : un bloc ```resultats [cartes|tableau|liste|grille] [pages|videos|images|audios]
//     dont chaque ligne est « - [Titre](adresse) ![](image) — texte » (lisible tel quel sur Telegram).
// Ce fichier est aussi chargé par les essais (test/reponses-odin.test.ts) avec un faux document.
(() => {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.OdinRendu) return;
  const doc = () => root.document;
  const reduit = () => { try { return Boolean(root.matchMedia?.('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };

  function el(tag, attrs = {}, ...kids) {
    const n = doc().createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false && c !== '') n.append(typeof c === 'object' && c.nodeType ? c : doc().createTextNode(String(c)));
    return n;
  }

  // ---------- Adresses permises ----------
  /** Un lien qu'on peut ouvrir : http(s), ou une page d'Odin (« /recherche »). Sinon null. */
  function safeHref(u) {
    const s = String(u ?? '').trim();
    if (/^https?:\/\/[^\s"'<>`\\]+$/i.test(s)) { try { const x = new URL(s); return /^https?:$/.test(x.protocol) && x.hostname ? s : null; } catch { return null; } }
    if (/^\/(?![/\\])[^\s"'<>`\\]*$/.test(s)) return s;
    return null;
  }
  const RASTER = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i;
  /** L'adresse d'une image à afficher : http(s) passée par Odin, image « data: » de type sûr, ou une page d'Odin. */
  function imgSrc(u) {
    const s = String(u ?? '').trim();
    if (RASTER.test(s) && s.length < 3_000_000) return s;
    const h = safeHref(s); if (!h) return null;
    return h.startsWith('/') ? h : `/api/recherche/vignette?u=${encodeURIComponent(h)}`;
  }
  const AUDIO = new Set(['mp3', 'ogg', 'oga', 'opus', 'wav', 'm4a', 'aac', 'flac', 'weba']);
  const VIDEO = new Set(['mp4', 'webm', 'm4v', 'mov', 'ogv']);
  /**
   * Ce qu'est un lien quand c'est un son ou une vidéo : { kind: 'audio' | 'video', url, site?, embed?, thumb?, file? }.
   * YouTube, Vimeo, Dailymotion : lecteur intégré (sans pisteurs pour YouTube) ; un fichier : lecteur du navigateur.
   */
  function mediaOf(u) {
    const s = safeHref(u); if (!s) return null;
    let x; try { x = new URL(s, 'https://odin.invalid'); } catch { return null; }
    const host = x.hostname.replace(/^(?:www|m|music)\./, ''), path = x.pathname;
    let id = '';
    if (host === 'youtu.be') id = path.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = x.searchParams.get('v') || (/^\/(?:shorts|embed|live)\/([\w-]+)/.exec(path) || [])[1] || '';
    if (/^[\w-]{6,20}$/.test(id)) return { kind: 'video', site: 'YouTube', url: s, embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
    const vimeo = host === 'vimeo.com' ? /^\/(\d{5,12})(?:\/|$)/.exec(path) : null;
    if (vimeo) return { kind: 'video', site: 'Vimeo', url: s, embed: `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1` };
    const dm = host === 'dailymotion.com' ? /^\/video\/([a-z0-9]{4,20})/i.exec(path) : host === 'dai.ly' ? /^\/([a-z0-9]{4,20})/i.exec(path) : null;
    if (dm) return { kind: 'video', site: 'Dailymotion', url: s, embed: `https://www.dailymotion.com/embed/video/${dm[1]}?autoplay=1`, thumb: `https://www.dailymotion.com/thumbnail/video/${dm[1]}` };
    const ext = ((/\.([a-z0-9]{2,4})$/i.exec(path) || [])[1] || '').toLowerCase();
    if (AUDIO.has(ext)) return { kind: 'audio', url: s, file: true };
    if (VIDEO.has(ext)) return { kind: 'video', url: s, file: true };
    return null;
  }
  const domainOf = (u) => { try { return new URL(u, 'https://odin.invalid').hostname.replace(/^www\./, ''); } catch { return ''; } };
  const fileName = (u) => { try { return decodeURIComponent(new URL(u, 'https://odin.invalid').pathname.split('/').pop() || '') || u; } catch { return u; } };

  // ---------- Les applis d'Odin : leur logo à côté de leur nom ----------
  let apps = [], appRe = null, appsAsked = false;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** La liste des applis ({ id, name }) dont le nom reçoit son logo. */
  function setApps(list) {
    apps = (Array.isArray(list) ? list : []).filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string' && a.name.length >= 3).map((a) => ({ id: a.id, name: a.name }));
    const names = apps.map((a) => a.name).sort((a, b) => b.length - a.length).map(esc);
    appRe = names.length ? new RegExp(`(^|[^\\p{L}\\p{N}_])(${names.join('|')})(?![\\p{L}\\p{N}_])`, 'u') : null;
  }
  const appNamed = (s) => { const k = String(s).trim().toLocaleLowerCase('fr'); return apps.find((a) => a.name.toLocaleLowerCase('fr') === k); };
  /** Le logo d'une appli (image construite par app-icons.js, sans HTML : une image « data: » en SVG). */
  function logo(a, size = 18) {
    const I = root.OdinAppIcons; if (!I?.svg) return null;
    return el('img', { class: 'md-app-ic', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(I.svg(a.id, a.name))}`, alt: '', width: size, height: size, 'aria-hidden': 'true' });
  }
  const appTag = (a, kids, strong) => el(strong ? 'strong' : 'span', { class: 'md-app', 'data-appli': a.id, title: a.name }, logo(a), ...kids);
  /** Les applis de ta session, demandées une fois (la page de connexion n'en a pas besoin). */
  function needApps() {
    if (appsAsked || apps.length || typeof root.fetch !== 'function' || !root.location) return;
    appsAsked = true;
    root.fetch('/api/valhalla/catalog', { headers: { 'x-odin': '1' } }).then((r) => r.json()).then((j) => { if (j?.ok) setApps(j.modules); else setTimeout(() => { appsAsked = false; }, 30_000); }).catch(() => setTimeout(() => { appsAsked = false; }, 30_000));
  }

  // ---------- Petites actions : copier, partager, zoomer ----------
  function flash(b, t) { if (!b) return; const old = b.textContent; b.textContent = t; setTimeout(() => { b.textContent = old; }, 1300); }
  async function copier(t, b) { try { await root.navigator.clipboard.writeText(t); flash(b, 'Copié'); } catch { flash(b, 'Copie impossible'); } }
  async function partager(url, title, b) {
    const n = root.navigator;
    if (n?.share) { try { await n.share({ title, url }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
    copier(url, b);
  }
  /** Ouvrir · Copier le lien · Partager (et Convertir avec Alchimie pour un fichier son ou vidéo). */
  function actions(url, label, convertible) {
    const b = (t, f) => el('button', { type: 'button', onclick: (e) => f(e.currentTarget) }, t);
    return el('div', { class: 'md-acts' },
      el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Ouvrir dans le navigateur'),
      b('Copier le lien', (x) => copier(url, x)),
      b('Partager', (x) => partager(url, label, x)),
      convertible && typeof api.onAsk === 'function' ? b('Convertir (Alchimie)', () => api.onAsk(`convertis ce lien ${url}`)) : null);
  }
  /** L'image en grand, par-dessus la page : × , Échap ou un toucher à côté la ferment. */
  function zoom(src, alt) {
    const d = doc(); d.getElementById('mdZoom')?.remove();
    const before = d.activeElement;
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const close = () => { d.removeEventListener('keydown', key, true); box.classList.add('out'); setTimeout(() => box.remove(), reduit() ? 0 : 160); before?.focus?.({ preventScroll: true }); };
    const x = el('button', { type: 'button', class: 'mdz-x', 'aria-label': 'Fermer' }, '×'); x.addEventListener('click', () => close());
    const box = el('div', { id: 'mdZoom', role: 'dialog', 'aria-modal': 'true', 'aria-label': alt || 'Image en grand' }, el('img', { src, alt: alt || '' }), x);
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    d.body.append(box); d.addEventListener('keydown', key, true); x.focus?.({ preventScroll: true });
  }

  // ---------- Images, son, vidéo ----------
  const missing = (alt) => el('span', { class: 'md-alt' }, alt ? `[image indisponible : ${alt}]` : '[image indisponible]');
  function image(url, alt, small) {
    const src = imgSrc(url); if (!src) return el('span', { class: 'md-alt' }, alt ? `[image : ${alt}]` : '[image]');
    const im = el('img', { src, alt: alt || '', loading: 'lazy', decoding: 'async', class: small ? 'md-img-s' : 'md-img', onerror: (e) => e.currentTarget.replaceWith(missing(alt)) });
    if (small) return im;
    return el('figure', { class: 'md-fig' }, el('button', { type: 'button', class: 'md-zoom', 'aria-label': alt ? `Agrandir l'image : ${alt}` : 'Agrandir l\'image', onclick: () => zoom(src, alt) }, im), alt ? el('figcaption', {}, alt) : null);
  }
  /** Une vidéo : miniature, lecture au clic (rien n'est chargé avant), et ses boutons. */
  function video(m, title) {
    const label = title || m.site || fileName(m.url) || 'Vidéo';
    const frame = el('div', { class: 'md-vframe' }), thumb = m.thumb ? imgSrc(m.thumb) : null;
    const hoteDe = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return m.site || ''; } };
    // Repli propre quand la vidéo (intégrée depuis un autre site) ne peut pas charger : jamais la page d'erreur du navigateur.
    const horsLigne = () => {
      if (!window.OdinHorsLigne) return el('div', { class: 'md-alt' }, `[vidéo indisponible : ${label} — connexion indisponible]`);
      const net = window.OdinReseau && window.OdinReseau.etat && window.OdinReseau.etat();
      return window.OdinHorsLigne.message({ quoi: `La vidéo « ${label} » n'a pas pu être chargée`, hote: hoteDe(m.embed || m.url), depuis: net && net.depuis, onReessayer: lire });
    };
    function lire() {
      if (m.embed && window.OdinReseau && !window.OdinReseau.enLigne()) { frame.replaceChildren(horsLigne()); return; }
      if (m.embed) {
        const ifr = el('iframe', { src: m.embed, title: label, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups' });
        let charge = false; ifr.addEventListener('load', () => { charge = true; });
        frame.replaceChildren(ifr);
        // Délai maximal : si l'intégration n'a pas chargé, on explique au lieu de laisser une page d'erreur.
        setTimeout(() => { if (!charge && frame.contains && frame.contains(ifr)) frame.replaceChildren(horsLigne()); }, 12000);
      } else {
        frame.replaceChildren(el('video', { src: m.url, controls: true, autoplay: true, playsinline: true, preload: 'metadata', onerror: () => frame.replaceChildren(horsLigne()) }));
      }
    }
    const play = el('button', { type: 'button', class: 'md-vplay', 'aria-label': `Lire la vidéo : ${label}`, onclick: lire },
      thumb ? el('img', { src: thumb, alt: '', loading: 'lazy', onerror: (e) => e.currentTarget.remove() }) : null, el('span', { class: 'md-vic', 'aria-hidden': 'true' }, '▶'), m.site ? el('span', { class: 'md-vsite' }, m.site) : null);
    frame.append(play);
    return el('div', { class: 'md-video' }, frame, el('div', { class: 'md-mt' }, label), actions(m.url, label, m.file));
  }
  function audio(m, title) {
    const label = title || fileName(m.url);
    return el('div', { class: 'md-audio' }, el('div', { class: 'md-mt' }, '♪ ', label), el('audio', { controls: true, preload: 'none', src: m.url }), actions(m.url, label, true));
  }
  const media = (m, title) => (m.kind === 'audio' ? audio(m, title) : video(m, title));

  // ---------- En ligne : gras, italique, code, liens, images, [[notes]], applis ----------
  const INLINE = /(`[^`\n]+`)|(!\[[^\]\n]*\]\([^)\s]+\))|(\[\[[^\]\n]+\]\])|(\*\*[^*\n]+?\*\*)|(__[^_\n]+?__)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|((?:^|(?<=[\s(]))\*[^*\s][^*\n]*?\*(?=[\s.,;:!?)]|$))/g;
  /** Le texte simple : la première mention d'une appli dans la réponse reçoit son logo. */
  function plain(s, ctx) {
    if (!appRe || !ctx) return [s];
    const out = []; let rest = s, m;
    while (rest && (m = appRe.exec(rest))) {
      const a = appNamed(m[2]), at = m.index + m[1].length;
      if (!a || ctx.seen.has(a.id)) { out.push(rest.slice(0, at + m[2].length)); rest = rest.slice(at + m[2].length); continue; }
      ctx.seen.add(a.id); out.push(rest.slice(0, at), appTag(a, [m[2]])); rest = rest.slice(at + m[2].length);
    }
    if (rest) out.push(rest);
    return out;
  }
  function inline(s, ctx) {
    const out = []; let i = 0, m; const re = new RegExp(INLINE.source, 'g'); s = String(s ?? '');
    while ((m = re.exec(s))) {
      if (m.index > i) out.push(...plain(s.slice(i, m.index), ctx));
      const x = m[0];
      if (m[1]) out.push(el('code', {}, x.slice(1, -1)));
      else if (m[2]) { const k = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(x); out.push(image(k[2], k[1], true)); }
      else if (m[3]) { const t = x.slice(2, -2).split('|'), title = t[0].trim(), shown = (t[1] || t[0]).trim(); out.push(typeof api.onNote === 'function' ? el('a', { href: '#', class: 'md-wiki', title: `Ouvrir la note « ${title} »`, onclick: (e) => { e.preventDefault(); api.onNote(title); } }, shown) : el('span', { class: 'md-wiki' }, shown)); }
      else if (m[4] || m[5]) { const inner = x.slice(2, -2), a = appNamed(inner); if (a && ctx) ctx.seen.add(a.id); out.push(a ? appTag(a, inline(inner), true) : el('strong', {}, ...inline(inner, ctx))); }
      else if (m[6]) { const k = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(x), href = safeHref(k[2]); out.push(href ? el('a', { href, target: href.startsWith('/') ? null : '_blank', rel: 'noopener noreferrer' }, ...inline(k[1])) : k[1]); }
      else if (m[7]) { const href = safeHref(x); out.push(href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, x.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)) : x); }
      else out.push(el('em', {}, ...inline(x.slice(1, -1), ctx)));
      i = m.index + x.length;
    }
    if (i < s.length) out.push(...plain(s.slice(i), ctx));
    return out;
  }

  // ---------- Résultats de recherche (Pythie) ----------
  /** Une ligne de résultat : « - [Titre](adresse) ![](image) — texte ». */
  function parseResult(line) {
    const m = /^\s*(?:[-*•]|\d+[.)])?\s*\[([^\]\n]+)\]\(([^)\s]+)\)\s*(?:!\[[^\]\n]*\]\(([^)\s]*)\))?\s*(?:[—–:-]\s*(.*))?$/.exec(String(line));
    if (!m) return null;
    const url = safeHref(m[2]); if (!url) return null;
    return { title: m[1].trim(), url, thumb: m[3] || '', text: (m[4] || '').trim(), domain: domainOf(url) };
  }
  /** L'image d'un résultat : sa vignette, sinon l'icône du site, sinon la première lettre du site. */
  function resultImg(r, cls) {
    const letter = () => el('span', { class: `${cls} md-rmono`, 'aria-hidden': 'true' }, (r.domain || r.title || '?').slice(0, 1).toUpperCase());
    const ico = r.domain ? imgSrc(`https://${r.domain}/favicon.ico`) : null;
    const first = (r.thumb && imgSrc(r.thumb)) || ico;
    if (!first) return letter();
    return el('img', { class: `${cls}${first === ico ? ' md-rico' : ''}`, src: first, alt: '', loading: 'lazy', decoding: 'async', onerror: (e) => {
      const im = e.currentTarget;
      if (ico && im.getAttribute('src') !== ico) { im.setAttribute('src', ico); im.classList.add('md-rico'); } else im.replaceWith(letter());
    } });
  }
  function resultats(lines, info) {
    const words = String(info || '').toLowerCase().split(/\s+/);
    const kind = words.find((w) => /^(pages|videos|vidéos|images|audios|sons)$/.test(w))?.replace('vidéos', 'videos').replace('sons', 'audios') || 'pages';
    const mode = words.find((w) => /^(cartes|tableau|liste|texte|grille)$/.test(w)) || (kind === 'images' ? 'grille' : 'cartes');
    const items = lines.map(parseResult).filter(Boolean);
    if (!items.length) return null;
    // Le nombre est dit dans la phrase qui précède le bloc (« **5 résultats** pour … ») : pas d'en-tête en double.
    const head = null;
    const title = (r) => el('a', { class: 'md-rt', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.title);
    if (mode === 'tableau') {
      return el('div', { class: 'md-res' }, head, el('div', { class: 'tblw' }, el('table', { class: 'md-rtab' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Image'), el('th', {}, 'Titre'), el('th', {}, 'Description'), el('th', {}, 'Site'))),
        el('tbody', {}, ...items.map((r) => el('tr', {}, el('td', {}, resultImg(r, 'md-rimg-s')), el('td', {}, title(r)), el('td', {}, r.text), el('td', {}, r.domain)))))));
    }
    if (mode === 'grille' || kind === 'images') {
      return el('div', { class: 'md-res' }, head, el('div', { class: 'md-rgrid' }, ...items.map((r) => {
        const src = imgSrc(r.thumb || r.url);
        return el('figure', { class: 'md-rgi' }, src ? el('button', { type: 'button', class: 'md-zoom', 'aria-label': `Agrandir : ${r.title}`, onclick: () => zoom(src, r.title) }, el('img', { src, alt: r.title, loading: 'lazy', onerror: (e) => e.currentTarget.replaceWith(missing(r.title)) })) : missing(r.title), el('figcaption', {}, title(r)));
      })));
    }
    if (kind === 'videos' || kind === 'audios') {
      return el('div', { class: 'md-res' }, head, el('div', { class: `md-rcards md-r${kind}` }, ...items.map((r) => {
        const m = mediaOf(r.url) || (kind === 'videos' ? { kind: 'video', url: r.url, thumb: r.thumb } : null);
        if (m && kind === 'videos' && !m.embed && !m.file) {
          // Une vidéo qu'on ne peut pas lire ici : sa miniature ouvre la page du site.
          return el('article', { class: 'md-rc' }, el('a', { class: 'md-rc-img md-vlink', href: r.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Regarder sur ${r.domain} : ${r.title}` }, resultImg(r, 'md-rimg'), el('span', { class: 'md-vic', 'aria-hidden': 'true' }, '▶')), el('div', { class: 'md-rc-b' }, title(r), r.text ? el('p', {}, r.text) : null, el('small', {}, r.domain)), actions(r.url, r.title, false));
        }
        if (m) { if (!m.thumb && r.thumb) m.thumb = r.thumb; const card = media(m, r.title); if (r.text) card.append(el('p', { class: 'md-rtx' }, r.text)); return card; }
        return el('article', { class: 'md-rc' }, el('div', { class: 'md-rc-b' }, title(r), r.text ? el('p', {}, r.text) : null, el('small', {}, r.domain)), actions(r.url, r.title, false));
      })));
    }
    if (mode === 'liste' || mode === 'texte') {
      return el('div', { class: 'md-res' }, head, el('ol', { class: 'md-rlist' }, ...items.map((r) => el('li', {}, resultImg(r, 'md-rimg-s'), el('div', {}, title(r), r.text ? el('p', {}, r.text) : null, el('small', {}, r.domain))))));
    }
    return el('div', { class: 'md-res' }, head, el('div', { class: 'md-rcards' }, ...items.map((r) => el('article', { class: 'md-rc' },
      el('a', { class: 'md-rc-img', href: r.url, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', 'aria-hidden': 'true' }, resultImg(r, 'md-rimg')),
      el('div', { class: 'md-rc-b' }, title(r), r.text ? el('p', {}, r.text) : null, el('small', {}, r.domain))))));
  }

  // ---------- Les blocs ----------
  const cellsOf = (r) => r.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  const alignOf = (c) => { const t = c.trim(); return /^:-+:$/.test(t) ? 'center' : /^-+:$/.test(t) ? 'right' : /^:-+$/.test(t) ? 'left' : null; };
  /**
   * Le Markdown d'une réponse, en éléments. `o.compact` : titres plus petits (bulle, notification).
   */
  function md(text, o = {}) {
    css(); needApps();
    const ctx = { seen: new Set() };
    const box = el('div', { class: `md${o.compact ? ' md-compact' : ''}` }), lines = String(text ?? '').replace(/\r/g, '').split('\n');
    let list = null, para = [];
    const flush = () => { if (para.length) { box.append(el('p', {}, ...inline(para.join('\n'), ctx))); para = []; } };
    const endList = () => { list = null; };
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k];
      const fence = /^\s*```\s*([\w+-]*)([^`]*)$/.exec(l);
      if (fence) {
        flush(); endList(); const code = []; k++;
        while (k < lines.length && !/^\s*```\s*$/.test(lines[k])) code.push(lines[k++]);
        if (fence[1] === 'resultats') { const r = resultats(code, fence[2]); if (r) { box.append(r); continue; } }
        const pre = el('pre', { class: 'code' }, el('code', {}, code.join('\n')));
        pre.append(el('button', { class: 'copy', type: 'button', title: 'Copier', onclick: (e) => { root.navigator?.clipboard?.writeText(code.join('\n')); flash(e.currentTarget, 'Copié'); } }, 'Copier'));
        if (fence[1]) pre.setAttribute('data-lang', fence[1]);
        box.append(pre); continue;
      }
      if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[k + 1] || '')) {
        flush(); endList();
        const head = cellsOf(l), al = cellsOf(lines[k + 1]).map(alignOf); k += 2;
        const body = []; while (k < lines.length && /^\s*\|.*\|\s*$/.test(lines[k])) body.push(cellsOf(lines[k++])); k--;
        const st = (i) => (al[i] ? `text-align:${al[i]}` : null);
        box.append(el('div', { class: 'tblw', role: 'region', tabindex: '0', 'aria-label': 'Tableau (défile de côté)' }, el('table', {},
          el('thead', {}, el('tr', {}, ...head.map((h, i) => el('th', { scope: 'col', style: st(i) }, ...inline(h, ctx))))),
          el('tbody', {}, ...body.map((r) => el('tr', {}, ...head.map((_, i) => el('td', { style: st(i) }, ...inline(r[i] ?? '', ctx)))))))));
        continue;
      }
      const h = /^\s*(#{1,4})\s+(.+?)\s*#*\s*$/.exec(l);
      if (h) { flush(); endList(); box.append(el(h[1].length <= 2 ? 'h3' : 'h4', {}, ...inline(h[2], ctx))); continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(l)) { flush(); endList(); box.append(el('hr')); continue; }
      // Une image, un son ou une vidéo seuls sur leur ligne : affichés en grand, pas en lien.
      const im = /^\s*!\[([^\]\n]*)\]\(([^)\s]+)\)\s*$/.exec(l);
      if (im) { flush(); endList(); const m = mediaOf(im[2]); box.append(m ? media(m, im[1]) : image(im[2], im[1])); continue; }
      const lone = /^\s*(?:\[([^\]\n]+)\]\(([^)\s]+)\)|<?(https?:\/\/[^\s<>]+?)>?)\s*$/.exec(l), lm = lone && mediaOf(lone[2] || lone[3]);
      if (lm) { flush(); endList(); box.append(media(lm, lone[1])); continue; }
      const q = /^\s*>\s?(.*)$/.exec(l);
      if (q) { flush(); endList(); const last = box.lastElementChild; if (last?.tagName === 'BLOCKQUOTE') last.append(el('br'), ...inline(q[1], ctx)); else box.append(el('blockquote', {}, ...inline(q[1], ctx))); continue; }
      const li = /^(\s*)([-*•]|\d+[.)])\s+(.+)$/.exec(l);
      if (li) {
        flush(); const tag = /\d/.test(li[2]) ? 'ol' : 'ul', sub = li[1].length >= 2;
        if (sub && list?.lastElementChild) { const p = list.lastElementChild; const host = p.querySelector?.(':scope > ul, :scope > ol') || p.appendChild(el(tag)); host.append(el('li', {}, ...inline(li[3], ctx))); continue; }
        if (!list || list.tagName.toLowerCase() !== tag) { list = el(tag); if (tag === 'ol' && li[2] !== '1.' && li[2] !== '1)') list.setAttribute('start', String(parseInt(li[2], 10))); box.append(list); }
        list.append(el('li', {}, ...inline(li[3], ctx))); continue;
      }
      if (!l.trim()) { flush(); endList(); continue; }
      if (list && /^\s{2,}\S/.test(l)) { list.lastElementChild?.append(' ', ...inline(l.trim(), ctx)); continue; }
      endList(); para.push(l);
    }
    flush();
    return box;
  }

  // ---------- Le style (une fois) ----------
  const CSS = `
  .md .tblw{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch;border:1px solid var(--line,#3a3f47);border-radius:10px;overscroll-behavior-x:contain}
  .md .tblw:focus-visible{outline:2px solid var(--accent,#7aa2ff);outline-offset:2px}
  .md .tblw table{border:0;border-collapse:collapse;width:max-content;min-width:100%;font-size:13.5px}
  .md .tblw th,.md .tblw td{border:0;border-bottom:1px solid var(--line,#3a3f47);padding:6px 10px;vertical-align:top;text-align:left}
  .md .tblw th{white-space:nowrap;font-weight:650;background:rgba(127,127,127,.1)}
  .md .tblw td{max-width:28em;overflow-wrap:break-word}
  .md .tblw tbody tr:last-child td{border-bottom:0}
  .md .tblw tbody tr:nth-child(even){background:rgba(127,127,127,.05)}
  .md-compact h3{font-size:14.5px;margin:2px 0 0}.md-compact h4{font-size:13px;margin:2px 0 0}
  .md .md-app{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;vertical-align:bottom}
  .md .md-app-ic{width:18px;height:18px;border-radius:5px;flex:none}
  .md .md-wiki{color:var(--accent,#7aa2ff);background:rgba(127,127,127,.12);border-radius:6px;padding:0 5px;text-decoration:none}
  .md .md-alt{color:var(--muted,#9aa1b2);font-style:italic}
  .md .md-fig{margin:0;display:flex;flex-direction:column;gap:4px;max-width:100%}
  .md .md-zoom{all:unset;cursor:zoom-in;display:block;max-width:100%;border-radius:10px;overflow:hidden;line-height:0}
  .md .md-zoom:focus-visible,.md .md-vplay:focus-visible{outline:2px solid var(--accent,#7aa2ff);outline-offset:2px}
  .md .md-img{display:block;max-width:100%;max-height:min(360px,50vh);width:auto;height:auto;object-fit:contain;border-radius:10px;background:rgba(127,127,127,.08)}
  .md .md-img-s{max-height:1.6em;max-width:6em;vertical-align:middle;border-radius:4px}
  .md td .md-img-s{max-height:48px}
  .md figcaption{font-size:12px;color:var(--muted,#9aa1b2)}
  #mdZoom{position:fixed;inset:0;z-index:300;background:rgba(5,8,12,.86);display:grid;place-items:center;padding:16px;animation:mdzIn .16s ease-out}
  #mdZoom img{max-width:94vw;max-height:88vh;object-fit:contain;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.5);cursor:zoom-out}
  #mdZoom .mdz-x{position:absolute;top:12px;right:12px;width:44px;height:44px;border-radius:12px;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:24px;cursor:pointer}
  #mdZoom.out{animation:mdzOut .16s ease-in forwards}
  @keyframes mdzIn{from{opacity:0}to{opacity:1}}@keyframes mdzOut{to{opacity:0}}
  .md .md-video,.md .md-audio{display:flex;flex-direction:column;gap:6px;width:100%;max-width:560px}
  .md .md-vframe{position:relative;width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#000}
  .md .md-vframe iframe,.md .md-vframe video{position:absolute;inset:0;width:100%;height:100%;border:0}
  .md .md-vplay{all:unset;position:absolute;inset:0;cursor:pointer;display:grid;place-items:center}
  .md .md-vplay img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .md .md-vic{position:relative;width:54px;height:54px;border-radius:50%;background:rgba(0,0,0,.62);color:#fff;display:grid;place-items:center;font-size:21px;box-shadow:0 0 0 2px rgba(255,255,255,.85);transition:transform .15s}
  .md .md-vplay:hover .md-vic,.md .md-vplay:focus-visible .md-vic,.md .md-vlink:hover .md-vic{background:var(--accent,#7aa2ff);color:var(--on-accent,#000);transform:scale(1.06)}
  .md .md-vsite{position:absolute;left:8px;bottom:8px;font-family:inherit;font-weight:600;font-size:11px;line-height:1;color:#fff;background:rgba(0,0,0,.6);padding:4px 7px;border-radius:6px}
  .md .md-mt{font-weight:600;font-size:13.5px;overflow-wrap:anywhere}
  .md .md-audio audio{width:100%;height:40px}
  .md .md-acts{display:flex;flex-wrap:wrap;gap:6px}
  .md .md-acts a,.md .md-acts button{display:inline-flex;align-items:center;min-height:32px;padding:0 10px;border-radius:9px;border:1px solid var(--line,#3a3f47);background:transparent;color:inherit;font-family:inherit;font-weight:500;font-size:12.5px;line-height:1.2;text-decoration:none;cursor:pointer}
  .md .md-acts a:hover,.md .md-acts button:hover{background:rgba(127,127,127,.12)}
  .md .md-res{display:flex;flex-direction:column;gap:8px;min-width:0}
  .md .md-rh{font-size:12px;color:var(--muted,#9aa1b2);font-weight:600}
  .md .md-rcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:10px}
  .md .md-rc{display:flex;flex-direction:column;gap:6px;border:1px solid var(--line,#3a3f47);border-radius:12px;overflow:hidden;background:rgba(127,127,127,.05);min-width:0}
  .md .md-rc > .md-acts{padding:0 10px 10px}
  .md .md-rc-img{position:relative;display:grid;place-items:center;aspect-ratio:16/9;background:rgba(127,127,127,.1);overflow:hidden}
  .md .md-rimg{width:100%;height:100%;object-fit:cover}
  .md .md-rimg.md-rico,.md .md-rc-img .md-rmono{width:40px;height:40px;object-fit:contain}
  .md .md-rmono{display:grid;place-items:center;border-radius:10px;background:var(--accent,#7aa2ff);color:var(--on-accent,#000);font-family:inherit;font-weight:700;font-size:18px;line-height:1}
  .md .md-rc-b{display:flex;flex-direction:column;gap:4px;padding:0 10px 10px;min-width:0}
  .md .md-rc-img + .md-rc-b{padding-top:0}
  .md .md-rc-b:first-child{padding-top:10px}
  .md .md-rt{font-weight:650;color:var(--text,inherit);text-decoration:none;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .md .md-rt:hover{text-decoration:underline}
  .md .md-rc-b p,.md .md-rlist p,.md .md-rtx{margin:0;font-size:13px;color:var(--muted,#b9c0cf);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:normal}
  .md .md-rc-b small,.md .md-rlist small{font-size:11.5px;color:var(--dim,#9aa1b2)}
  .md .md-rimg-s{width:40px;height:40px;object-fit:cover;border-radius:8px;flex:none}
  .md .md-rimg-s.md-rico{object-fit:contain;padding:6px;box-sizing:border-box;background:rgba(127,127,127,.1)}
  .md .md-rlist{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px}
  .md .md-rlist li{display:flex;gap:10px;align-items:flex-start;min-width:0}.md .md-rlist li > div{min-width:0;display:flex;flex-direction:column;gap:2px}
  .md .md-rgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(46%,140px),1fr));gap:8px}
  .md .md-rgi{margin:0;display:flex;flex-direction:column;gap:4px;min-width:0}
  .md .md-rgi .md-zoom{aspect-ratio:1;border-radius:10px;background:rgba(127,127,127,.1)}
  .md .md-rgi img{width:100%;height:100%;object-fit:cover}
  .md .md-rgi figcaption .md-rt{font-size:12px;font-weight:500;-webkit-line-clamp:1}
  .md .md-rcards.md-rvideos,.md .md-rcards.md-raudios{grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))}
  .md .md-rtx{font-size:12.5px}
  @media (prefers-reduced-motion:reduce){#mdZoom,#mdZoom.out{animation:none}.md .md-vic{transition:none}}`;
  function css() {
    const d = doc(); if (!d?.head || d.getElementById?.('odinRenduCss')) return;
    const s = d.createElement('style'); s.id = 'odinRenduCss'; s.textContent = CSS; d.head.append(s);
  }

  const api = { md, inline: (s) => inline(s, null), setApps, mediaOf, safeHref, imgSrc, parseResult, onNote: null,
    /** Un bouton qui demande quelque chose à Odin (« Convertir (Alchimie) ») : envoyé dans la discussion. */
    onAsk: (t) => root.OdinChat?.send?.(t) };
  root.OdinRendu = api;
})();
