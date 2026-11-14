// Plume partout : le correcteur pendant qu'on écrit, dans chaque champ de texte (textarea, input text/search,
// contenteditable) de toutes les pages d'Odin et des pages de ses applis, y compris les champs créés après coup.
// Soulignements (rouge : orthographe et frappe ; bleu : grammaire), compteur dans le champ, petite fenêtre pointée
// sur le mot (Corriger · Modifier · Tout voir · N · Désactiver), « Tout voir », « Modifier », et Réglages → Plume.
// Maquettes validées le 14/11/2026 (Plume, PlumeTout, PlumeOff, PlumeTel). Contrat : docs/plume-protocole.md.
//
// Le même fichier sert à Pégase (pegase-plume/) : Pégase fournit alors `PLUME_HOTE` (son transport par IPC, Shadow DOM
// fermé) ; sans lui, c'est l'interface d'Odin (fetch vers /api/plume/*, session du navigateur).
// Rien n'est changé sans un clic ; jamais dans un champ de mot de passe, de code, de carte ni dans un éditeur de code.
(() => {
  'use strict';
  const CSS = "/*@PLUME_CSS@*/";
  // eslint-disable-next-line no-undef
  const HOTE = typeof PLUME_HOTE !== 'undefined' ? PLUME_HOTE : null;
  if (!HOTE && window.OdinPlume) return;

  // ---------------- Transport ----------------
  const T = HOTE || {
    ou: 'odin', ombre: false,
    async appel(chemin, corps) {
      const r = await fetch(`/api/plume/${chemin}`, corps === undefined ? { headers: { 'x-odin': '1' }, credentials: 'same-origin' } : { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, credentials: 'same-origin', body: JSON.stringify(corps) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(j.message || `Plume : ${r.status}`); e.status = r.status; throw e; }
      return j;
    },
    ouvrirReglages() { if (typeof window.openSettings === 'function') window.openSettings('plume'); else location.href = '/#plume'; },
    canal: (() => { try { return new BroadcastChannel('odin-plume'); } catch { return null; } })(),
    diffuser(e) { try { this.canal && this.canal.postMessage(e); } catch { /* */ } },
    ecouter(f) { if (this.canal) this.canal.onmessage = (m) => f(m.data); },
  };

  // ---------------- Petits outils ----------------
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt !== undefined) x.textContent = txt; return x; };
  const bouton = (cls, txt, f, titre) => { const b = el('button', `plm-b ${cls || ''}`.trim(), txt); b.type = 'button'; if (titre) b.title = titre; b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); f(e); }); return b; };
  const svgDe = (src) => { const t = document.createElementNS(NS, 'svg'); const d = new DOMParser().parseFromString(src, 'image/svg+xml').documentElement; for (const a of d.attributes) t.setAttribute(a.name, a.value); while (d.firstChild) t.appendChild(document.importNode(d.firstChild, true)); return t; };
  // L'icône de Plume (celle de app-icons.js ; recopiée ici pour Pégase et les pages sans app-icons.js).
  const ICONE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="plmbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d14bff"/><stop offset="1" stop-color="#a316e0"/></linearGradient><radialGradient id="plmha" cx="50%" cy="46%" r="62%"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="plmgl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><clipPath id="plmcl"><rect width="64" height="64" rx="15"/></clipPath></defs><g clip-path="url(#plmcl)"><rect width="64" height="64" fill="url(#plmbg)"/><rect width="64" height="64" fill="url(#plmha)"/><path d="M0 0H64V24Q32 32 0 24Z" fill="url(#plmgl)"/><g><path d="M12 8 H34 L46 20 V54 Q46 56 44 56 H14 Q12 56 12 54Z" fill="#fff"/><path d="M34 8 V20 H46" fill="#c7d2fe"/><rect x="18" y="27" width="21" height="3.6" rx="1.8" fill="#93c5fd"/><rect x="18" y="34" width="17" height="3.6" rx="1.8" fill="#93c5fd"/><rect x="18" y="41" width="11" height="3.6" rx="1.8" fill="#93c5fd"/><g transform="rotate(40 47 40)"><rect x="42" y="16" width="10" height="6" rx="2" fill="#ff6b8b"/><rect x="42" y="21.5" width="10" height="4" fill="#e2e8f0"/><rect x="42" y="25" width="10" height="20" fill="#ffb020"/><rect x="45.5" y="25" width="3" height="20" fill="#f59000"/><path d="M42 45 H52 L47 54Z" fill="#fde7c4"/><path d="M45.3 51 H48.7 L47 54Z" fill="#1f2937"/></g></g><rect x=".75" y=".75" width="62.5" height="62.5" rx="14" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1.5"/></g></svg>';
  function icone(n) {
    const s = el('span', 'plm-ic'); s.setAttribute('aria-hidden', 'true'); s.style.width = `${n}px`; s.style.height = `${n}px`;
    const I = !HOTE && window.OdinAppIcons;
    if (I && I.has('snotra')) { const t = document.createElement('template'); t.innerHTML = I.tile('snotra', 'Plume', n); if (t.content.firstElementChild) { s.appendChild(t.content.firstElementChild); return s; } }
    const g = svgDe(ICONE); g.setAttribute('width', String(n)); g.setAttribute('height', String(n)); s.appendChild(g); return s;
  }
  const svgTrait = (d, n = 15, c = 'currentColor') => svgDe(`<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`);
  const POWER = 'M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0', FLECHE = 'M5 12h14M13 6l6 6-6 6', CROIX = 'M6 6l12 12M18 6L6 18';
  const GENRES = { orthographe: 'Orthographe', frappe: 'Frappe', grammaire: 'Grammaire' };
  const tel = () => innerWidth <= 600;
  const pluriel = (n, un, plus) => `${n} ${n > 1 ? plus : un}`;

  // ---------------- La racine (Odin : dans la page ; Pégase : Shadow DOM fermé) ----------------
  let racine, docStyle;
  function monter() {
    if (racine && racine.isConnected) return;
    // La racine a été retirée (par la page) : on repart de zéro (les anciens calques ne sont plus dans le document).
    if (racine) { for (const s of suivis.values()) { s.miroir = null; s.puce = null; s.peint = null; } if (ouvert) ouvert = null; }
    const feuille = (() => { try { const f = new CSSStyleSheet(); f.replaceSync(CSS); return f; } catch { return null; } })();
    racine = el('div', 'plm-racine'); racine.setAttribute('data-plume', 'non');
    if (T.ombre) {
      const hote = document.createElement('plume-pegase'); hote.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;display:block';
      const ombre = hote.attachShadow({ mode: 'closed' });
      if (feuille) ombre.adoptedStyleSheets = [feuille]; else { const st = document.createElement('style'); st.textContent = CSS; ombre.appendChild(st); }
      ombre.appendChild(racine); document.documentElement.appendChild(hote);
    } else {
      if (!document.getElementById('plume-css')) { const st = document.createElement('style'); st.id = 'plume-css'; st.textContent = CSS; document.head.appendChild(st); }
      document.body.appendChild(racine);
    }
    // Les soulignements des zones « contenteditable » : la surbrillance du navigateur (règle au niveau du document).
    if (!docStyle && window.CSS && CSS.highlights) {
      try { docStyle = new CSSStyleSheet(); docStyle.replaceSync('::highlight(plm-rouge){text-decoration:underline wavy #DC2626;text-decoration-thickness:1.5px;text-underline-offset:4px}::highlight(plm-bleu){text-decoration:underline wavy #2563EB;text-decoration-thickness:1.5px;text-underline-offset:4px}'); document.adoptedStyleSheets = [...document.adoptedStyleSheets, docStyle]; } catch { docStyle = null; }
    }
    racine.classList.toggle('plm-tel', tel());
  }

  // ---------------- L'état (lu chez Odin, partagé avec les autres onglets) ----------------
  let etat = null;
  const actifIci = () => Boolean(etat && etat.actif && etat[T.ou]);
  async function rafraichir() {
    try { appliquer(await T.appel('etat')); } catch (e) { if (e && (e.status === 401 || e.status === 403)) appliquer(null); }
  }
  function appliquer(e, depuisAilleurs) {
    const avant = actifIci(); etat = e;
    if (!actifIci()) { toutEffacer(); }
    else if (!avant) { const s = document.activeElement && suivre(document.activeElement); if (s) { s.verifie = null; planifier(s, 50); } }
    if (!depuisAilleurs && e) T.diffuser(e);
    peindreReglages();
  }

  // ---------------- Les champs suivis ----------------
  const suivis = new Map();
  const TYPES = /^(text|search|)$/;
  const SENSIBLE = /(pass|mdp|mot.?de.?passe|passwd|pwd|\bpin\b|otp|totp|2fa|cvc|cvv|\bcb\b|carte|card|iban|\bbic\b|token|jeton|secret|\bcl[eé]s?\b|api.?key|apikey|\bcode\b|verif)/i;
  function eligible(x) {
    if (!x || x.nodeType !== 1 || (racine && racine.contains(x))) return null;
    let cible = null, champ = 'texte';
    if (x instanceof HTMLTextAreaElement) cible = x;
    else if (x instanceof HTMLInputElement) { if (!TYPES.test((x.getAttribute('type') || '').toLowerCase())) return null; cible = x; champ = x.type === 'search' || x.getAttribute('role') === 'searchbox' || /search|cherch|recherch/i.test(`${x.name} ${x.id} ${x.placeholder}`) ? 'recherche' : 'ligne'; }
    else if (x.isContentEditable) { cible = x; while (cible.parentElement && cible.parentElement.isContentEditable) cible = cible.parentElement; }
    if (!cible) return null;
    if (cible.closest('[data-plume="non"],[data-plume="off"],.CodeMirror,.cm-editor,.monaco-editor,.ace_editor')) return null;
    if (cible.readOnly || cible.disabled || cible.getAttribute('aria-readonly') === 'true') return null;
    if ((cible.getAttribute('spellcheck') || '').toLowerCase() === 'false') return null;
    const ac = (cible.getAttribute('autocomplete') || '').toLowerCase();
    if (/password|one-time-code|cc-|webauthn/.test(ac)) return null;
    if (/numeric|decimal|tel|email|url/.test(cible.getAttribute('inputmode') || '')) return null;
    if (SENSIBLE.test(`${cible.name || ''} ${cible.id || ''} ${cible.getAttribute('placeholder') || ''} ${cible.getAttribute('aria-label') || ''} ${typeof cible.className === 'string' ? cible.className : ''}`)) return null;
    if (/mono|courier|consolas|menlo/i.test(getComputedStyle(cible).fontFamily)) return null;
    return { cible, champ, ce: !(cible instanceof HTMLTextAreaElement || cible instanceof HTMLInputElement) };
  }
  function suivre(x) {
    if (!actifIci()) return null;
    const e = eligible(x); if (!e) return null;
    let s = suivis.get(e.cible);
    if (!s) { s = { el: e.cible, champ: e.champ, ce: e.ce, fautes: [], texte: lire(e.cible, e.ce), verifie: null, version: 0, minuteur: 0 }; suivis.set(e.cible, s); }
    return s;
  }
  // Le texte d'une zone « contenteditable », et où se trouve chaque morceau (pour les soulignements et les corrections).
  const BLOCS = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|TR|SECTION|ARTICLE|HEADER|FOOTER)$/;
  function texteCE(racineCE) {
    let t = ''; const segs = [];
    const marcher = (n) => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { segs.push({ n: c, d: t.length }); t += c.data; }
        else if (c.nodeType === 1) {
          if (c.tagName === 'BR') { t += '\n'; continue; }
          const bloc = BLOCS.test(c.tagName); if (bloc && t && !t.endsWith('\n')) t += '\n';
          marcher(c); if (bloc && t && !t.endsWith('\n')) t += '\n';
        }
      }
    };
    marcher(racineCE); return { t, segs };
  }
  const lire = (x, ce) => (ce ? texteCE(x).t : x.value);
  function plage(s, debut, fin) {
    const { segs } = texteCE(s.el), r = document.createRange();
    const pos = (o, finale) => { for (const g of segs) { const n = g.n.data.length; if (o >= g.d && (o < g.d + n || (finale && o === g.d + n))) return [g.n, o - g.d]; } return null; };
    const a = pos(debut, false), b = pos(fin, true); if (!a || !b) return null;
    r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]); return r;
  }

  // Le texte a changé entre deux vérifications : les fautes avant et après le changement suivent, celles touchées partent.
  function decaler(fautes, avant, apres) {
    if (avant === apres) return fautes;
    let p = 0; while (p < avant.length && p < apres.length && avant[p] === apres[p]) p++;
    let q = 0; while (q < avant.length - p && q < apres.length - p && avant[avant.length - 1 - q] === apres[apres.length - 1 - q]) q++;
    const finA = avant.length - q, delta = apres.length - avant.length;
    return fautes.filter((f) => f.fin < p || f.debut > finA).map((f) => (f.debut > finA ? { ...f, debut: f.debut + delta, fin: f.fin + delta } : f));
  }

  // ---------------- Vérifier (appels regroupés : 400 ms après la dernière touche) ----------------
  const cacheClient = new Map();
  function planifier(s, ms = 400) { clearTimeout(s.minuteur); s.minuteur = setTimeout(() => verifier(s), ms); }
  async function verifier(s) {
    if (!actifIci() || !s.el.isConnected) return;
    const texte = lire(s.el, s.ce);
    if (texte === s.verifie) return;
    if (!texte.trim() || texte.length > 20000) { s.fautes = []; s.verifie = texte; s.texte = texte; dessiner(s); return; }
    const v = ++s.version, cle = `${s.champ}|${etat && etat.maj}|${texte}`;
    let r = cacheClient.get(cle);
    if (!r) {
      try { r = await T.appel('corriger', { texte, ou: T.ou, champ: s.champ }); } catch { return; }
      if (r && r.actif !== false) { cacheClient.set(cle, r); if (cacheClient.size > 80) cacheClient.delete(cacheClient.keys().next().value); }
    }
    if (v !== s.version) return;
    if (!r || r.actif === false) { rafraichir(); return; }
    if (etat && r.maj !== etat.maj) rafraichir();
    const maintenant = lire(s.el, s.ce);
    s.fautes = decaler(r.fautes || [], texte, maintenant); s.verifie = texte; s.texte = maintenant;
    dessiner(s);
  }

  // ---------------- Dessiner : miroir (champs) ou surbrillance (contenteditable), et le compteur ----------------
  const PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant', 'letterSpacing', 'wordSpacing', 'textTransform', 'textIndent', 'textAlign', 'direction', 'tabSize', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'borderLeftWidth', 'borderRightWidth', 'borderTopWidth', 'borderBottomWidth', 'lineHeight'];
  function zoneVisible(x) {
    const r = x.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return null;
    let c = { l: 0, t: 0, r: innerWidth, b: innerHeight };
    for (let p = x.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden') return null;
      if (/(hidden|auto|scroll|clip)/.test(cs.overflowX + cs.overflowY)) { const q = p.getBoundingClientRect(); c = { l: Math.max(c.l, q.left), t: Math.max(c.t, q.top), r: Math.min(c.r, q.right), b: Math.min(c.b, q.bottom) }; }
    }
    if (c.r - c.l < 2 || c.b - c.t < 2) return null;
    // Recouvert (une fenêtre par-dessus) ? On regarde ce qui est au milieu de la partie visible.
    const cx = (Math.max(c.l, r.left) + Math.min(c.r, r.right)) / 2, cy = (Math.max(c.t, r.top) + Math.min(c.b, r.bottom)) / 2;
    const h = document.elementFromPoint(cx, cy);
    if (h && h !== x && !x.contains(h) && !(h.tagName === 'PLUME-PEGASE') && !(racine && racine.contains(h))) return null;
    return { r, c };
  }
  function dessiner(s) {
    monter();
    if (!actifIci() || !s.el.isConnected) { effacer(s); return; }
    if (s.ce) peindreSurbrillances();
    else peindreMiroir(s);
    placerPuce(s);
  }
  function peindreMiroir(s) {
    const z = s.fautes.length ? zoneVisible(s.el) : null;
    if (!z) { if (s.miroir) s.miroir.style.display = 'none'; return; }
    if (!s.miroir) { s.miroir = el('div', 'plm-miroir'); s.mi = el('div', 'plm-mi'); s.miroir.appendChild(s.mi); racine.appendChild(s.miroir); }
    const m = s.miroir, cs = getComputedStyle(s.el), r = z.r, area = s.el instanceof HTMLTextAreaElement;
    for (const k of PROPS) m.style[k] = cs[k];
    const bl = parseFloat(cs.borderLeftWidth) || 0, br = parseFloat(cs.borderRightWidth) || 0, barre = area ? Math.max(0, s.el.offsetWidth - s.el.clientWidth - bl - br) : 0;
    m.style.display = 'block'; m.style.left = `${r.left}px`; m.style.top = `${r.top}px`; m.style.width = `${r.width - barre}px`; m.style.height = `${r.height}px`;
    m.style.borderStyle = 'solid'; m.style.borderColor = 'transparent'; m.style.boxSizing = 'border-box';
    m.style.whiteSpace = area ? 'pre-wrap' : 'pre'; m.style.overflowWrap = area ? 'break-word' : 'normal'; m.style.wordBreak = cs.wordBreak;
    if (!area) { const h = r.height - (parseFloat(cs.borderTopWidth) || 0) - (parseFloat(cs.borderBottomWidth) || 0) - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0); m.style.lineHeight = `${Math.max(0, h)}px`; }
    m.style.clipPath = `inset(${Math.max(0, z.c.t - r.top)}px ${Math.max(0, r.right - z.c.r)}px ${Math.max(0, r.bottom - z.c.b)}px ${Math.max(0, z.c.l - r.left)}px)`;
    const t = s.el.value, cle = `${t}|${s.fautes.map((f) => `${f.debut}-${f.fin}-${f.genre}`).join(',')}`;
    if (s.peint !== cle) {
      s.peint = cle; s.mi.textContent = '';
      let k = 0;
      s.fautes.forEach((f, i) => {
        if (f.debut < k || f.fin > t.length) return;
        if (f.debut > k) s.mi.appendChild(document.createTextNode(t.slice(k, f.debut)));
        const sp = el('span', `plm-s ${f.genre === 'grammaire' ? 'plm-bleu' : 'plm-rouge'}`, t.slice(f.debut, f.fin)); sp.dataset.i = String(i); s.mi.appendChild(sp); k = f.fin;
      });
      s.mi.appendChild(document.createTextNode(`${t.slice(k)}​`));
    }
    s.mi.style.transform = `translate(${-s.el.scrollLeft}px, ${-s.el.scrollTop}px)`;
  }
  function peindreSurbrillances() {
    if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;
    const rouge = [], bleu = [];
    for (const s of suivis.values()) if (s.ce && s.el.isConnected && actifIci()) for (const f of s.fautes) { const r = plage(s, f.debut, f.fin); if (r) (f.genre === 'grammaire' ? bleu : rouge).push(r); }
    CSS.highlights.set('plm-rouge', new Highlight(...rouge)); CSS.highlights.set('plm-bleu', new Highlight(...bleu));
  }
  function placerPuce(s) {
    const n = s.fautes.length, z = n ? zoneVisible(s.el) : null;
    if (!z || (!s.ce && s.el instanceof HTMLInputElement && z.r.width < 140)) { if (s.puce) s.puce.style.display = 'none'; return; }
    if (!s.puce) {
      s.puce = el('button', 'plm-puce'); s.puce.type = 'button'; s.puce.appendChild(icone(22)); s.puce.appendChild(el('span'));
      s.puce.addEventListener('mousedown', (e) => e.preventDefault());
      s.puce.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); ouvrirTout(s); });
      racine.appendChild(s.puce);
    }
    s.puce.lastChild.textContent = String(n);
    s.puce.setAttribute('aria-label', `Plume : ${pluriel(n, 'correction proposée', 'corrections proposées')}, tout voir`);
    s.puce.title = 'Plume : tout voir';
    s.puce.style.display = 'inline-flex';
    const r = z.r, w = s.puce.offsetWidth || 52, h = s.puce.offsetHeight || 30, cs = getComputedStyle(s.el);
    const droite = r.right - (parseFloat(cs.borderRightWidth) || 0) - (s.el instanceof HTMLTextAreaElement ? Math.max(0, s.el.offsetWidth - s.el.clientWidth) : 0) - 6;
    const haut = s.el instanceof HTMLInputElement || r.height < h + 16 ? r.top + (r.height - h) / 2 : r.bottom - h - 6;
    const x = Math.round(droite - w), y = Math.round(haut);
    s.puce.style.left = `${x}px`; s.puce.style.top = `${y}px`;
    const c = z.c, cache = x < c.l || x + w > c.r + 1 || y < c.t - 1 || y + h > c.b + 1; if (cache) s.puce.style.display = 'none';
  }
  function effacer(s) {
    clearTimeout(s.minuteur);
    if (s.miroir) { s.miroir.remove(); s.miroir = null; s.peint = null; }
    if (s.puce) { s.puce.remove(); s.puce = null; }
  }
  function toutEffacer() {
    fermer(); for (const s of suivis.values()) { s.fautes = []; s.verifie = null; s.version++; effacer(s); }
    suivis.clear(); cacheClient.clear();
    if (window.CSS && CSS.highlights) { CSS.highlights.delete('plm-rouge'); CSS.highlights.delete('plm-bleu'); }
  }
  let trame = 0;
  function replacer() { if (trame) return; trame = requestAnimationFrame(() => { trame = 0; if (racine) racine.classList.toggle('plm-tel', tel()); for (const [k, s] of suivis) { if (!k.isConnected) { effacer(s); suivis.delete(k); continue; } if (s.fautes.length || s.miroir || s.puce) dessiner(s); } placerFenetre(); }); }

  // ---------------- La petite fenêtre ----------------
  let ouvert = null; // { s, f, boite, mode: 'faute'|'modif'|'tout'|'note' }
  function fermer() { if (ouvert && ouvert.boite) ouvert.boite.remove(); ouvert = null; }
  function rectFaute(s, f) {
    if (s.ce) { const r = plage(s, f.debut, f.fin); const b = r && r.getClientRects()[0]; return b || s.el.getBoundingClientRect(); }
    dessiner(s); const i = s.fautes.indexOf(f), sp = s.mi && s.mi.querySelector(`[data-i="${i}"]`);
    return sp ? sp.getBoundingClientRect() : s.el.getBoundingClientRect();
  }
  function placerFenetre() {
    if (!ouvert || !ouvert.boite) return;
    const b = ouvert.boite, vv = window.visualViewport, vh = vv ? vv.height : innerHeight, vt = vv ? vv.offsetTop : 0, vw = innerWidth;
    if (ouvert.mode === 'note') { const w = b.offsetWidth; b.style.left = `${tel() ? Math.round((vw - w) / 2) : 16}px`; b.style.top = `${Math.round(vt + vh - b.offsetHeight - 16)}px`; return; }
    if (ouvert.mode === 'tout') {
      const w = Math.min(560, vw - 24); b.style.width = `${w}px`; b.style.maxHeight = `${Math.round(vh * (tel() ? 0.8 : 0.72))}px`;
      b.style.left = `${Math.round((vw - w) / 2)}px`;
      b.style.top = `${Math.round(tel() ? vt + vh - b.offsetHeight - 12 : Math.max(vt + 16, vt + (vh - b.offsetHeight) / 3))}px`; return;
    }
    const s = ouvert.s; if (!s || !s.el.isConnected) { fermer(); return; }
    const champ = s.el.getBoundingClientRect(), h = b.offsetHeight;
    if (tel()) {
      // Téléphone : au-dessus du champ (donc du clavier), sur toute la largeur.
      b.style.left = '12px'; b.style.width = `${vw - 24}px`;
      b.style.top = `${Math.round(Math.max(vt + 8, Math.min(champ.top - h - 10, vt + vh - h - 8)))}px`; b.classList.remove('plm-dessous'); return;
    }
    const w = Math.min(410, vw - 16), mot = ouvert.f ? rectFaute(s, ouvert.f) : champ;
    let left = Math.round(Math.min(Math.max(8, mot.left - 28), vw - w - 8)), top = Math.round(mot.top - h - 12), dessous = false;
    if (top < vt + 8) { top = Math.round(mot.bottom + 12); dessous = true; }
    b.style.width = `${w}px`; b.style.left = `${left}px`; b.style.top = `${top}px`; b.classList.toggle('plm-dessous', dessous);
    const fl = b.querySelector('.plm-fleche'); if (fl) fl.style.left = `${Math.round(Math.min(Math.max(14, mot.left + Math.min(mot.width / 2, 18) - left - 7), w - 28))}px`;
  }
  function boite(cls, label, mode, s, f) {
    fermer(); monter();
    const b = el('div', cls); b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', label);
    b.addEventListener('mousedown', (e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); });
    racine.appendChild(b); ouvert = { s, f, boite: b, mode }; return b;
  }
  function ouvrirFaute(s, f) {
    if (!actifIci()) return;
    const b = boite('plm-pop', 'Plume propose une correction', 'faute', s, f), i = s.fautes.indexOf(f), p = f.propositions[0];
    b.appendChild(el('span', 'plm-fleche')).setAttribute('aria-hidden', 'true');
    const tete = el('div', 'plm-tete'); tete.appendChild(icone(22)); tete.appendChild(el('b', '', 'Plume'));
    tete.appendChild(el('span', `plm-genre plm-g-${f.genre}`, GENRES[f.genre] || 'À revoir')); tete.appendChild(el('span', 'plm-vide'));
    tete.appendChild(el('span', 'plm-rang', `${i + 1} sur ${s.fautes.length}`)); b.appendChild(tete);
    const ch = el('div', 'plm-change'); ch.appendChild(el('s', '', f.avant));
    if (p !== undefined) { ch.appendChild(svgTrait(FLECHE, 16, '#8A8399')); ch.appendChild(el('span', 'plm-vers', p || '(rien)')); }
    b.appendChild(ch); b.appendChild(el('p', 'plm-raison', f.raison || ''));
    const pied = el('div', 'plm-pied');
    if (p !== undefined) pied.appendChild(bouton('plm-p', 'Corriger', () => { remplacer(s, f, p); fermer(); }));
    pied.appendChild(bouton(p === undefined ? 'plm-p' : '', 'Modifier', () => ouvrirModif(s, f, ouvert && ouvert.mode)));
    pied.appendChild(bouton('plm-lien', tel() ? `Tout · ${s.fautes.length}` : `Tout voir · ${s.fautes.length}`, () => ouvrirTout(s)));
    pied.appendChild(el('span', 'plm-vide'));
    const off = bouton('plm-off', 'Désactiver', desactiver, 'Désactiver Plume partout (réactiver dans Réglages)'); if (!tel()) off.prepend(svgTrait(POWER, 15, '#6B6280')); pied.appendChild(off);
    b.appendChild(pied); placerFenetre();
  }
  function ouvrirModif(s, f, retour) {
    const b = boite('plm-pop', `Modifier « ${f.avant} »`, 'modif', s, f), m = el('div', 'plm-modif');
    b.appendChild(el('span', 'plm-fleche')).setAttribute('aria-hidden', 'true');
    const tete = el('div', 'plm-tete'); tete.appendChild(icone(22)); tete.appendChild(el('b', '', `Modifier « ${f.avant} »`)); m.appendChild(tete);
    const lab = el('label', '', 'Ton texte'), inp = el('input'); inp.type = 'text'; inp.value = f.propositions[0] ?? f.avant; inp.setAttribute('data-plume', 'non'); inp.spellcheck = false; inp.autocomplete = 'off'; lab.appendChild(inp); m.appendChild(lab);
    if (f.propositions.length) { const id = el('div', 'plm-idees'); id.appendChild(el('span', '', 'Idées :')); for (const p of f.propositions) id.appendChild(bouton('plm-idee', p, () => { inp.value = p; inp.focus(); })); m.appendChild(id); }
    if (f.genre !== 'grammaire' && !/\s/.test(f.avant)) { const g = el('button', 'plm-garder', `Garder « ${f.avant} » : l'ajouter à mon dictionnaire`); g.type = 'button'; g.addEventListener('click', () => { garderMot(s, f); fermer(); }); m.appendChild(g); }
    const fin = el('div', 'plm-fin');
    const annuler = () => { if (retour === 'tout') ouvrirTout(s); else { fermer(); focusChamp(s); } };
    const ok = () => { const v = inp.value; fermer(); remplacer(s, f, v); if (retour === 'tout' && s.fautes.length) ouvrirTout(s); };
    fin.appendChild(bouton('', 'Annuler', annuler)); fin.appendChild(bouton('plm-p', 'Remplacer', ok)); m.appendChild(fin);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } else if (e.key === 'Escape') { e.preventDefault(); annuler(); } });
    b.appendChild(m); placerFenetre(); setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }
  function ouvrirTout(s) {
    if (!actifIci()) return;
    const n = s.fautes.length, b = boite('plm-tout', 'Plume, toutes les corrections', 'tout', s, null);
    const tete = el('div', 'plm-tout-tete'); tete.appendChild(icone(28));
    const h = el('h2', '', `Plume · ${n ? pluriel(n, 'correction', 'corrections') : 'aucune correction'} dans ce texte`); h.id = 'plm-t-tout'; b.setAttribute('aria-labelledby', 'plm-t-tout'); b.removeAttribute('aria-label'); tete.appendChild(h);
    const x = el('button', 'plm-fermer'); x.type = 'button'; x.setAttribute('aria-label', 'Fermer'); x.appendChild(svgTrait(CROIX, 16)); x.addEventListener('click', () => { fermer(); focusChamp(s); }); tete.appendChild(x); b.appendChild(tete);
    const l = el('div', 'plm-liste');
    if (!n) l.appendChild(el('div', 'plm-rien', 'Rien à corriger pour l\'instant.'));
    for (const f of s.fautes) {
      const r = el('div', 'plm-rangee'); r.appendChild(el('span', `plm-point${f.genre === 'grammaire' ? ' plm-bleu-p' : ''}`)).setAttribute('aria-hidden', 'true');
      const q = el('span', 'plm-quoi'), ligne = el('span'); ligne.appendChild(el('s', '', f.avant));
      if (f.propositions[0] !== undefined) { ligne.appendChild(document.createTextNode(' → ')); ligne.appendChild(el('b', '', f.propositions[0] || '(rien)')); }
      q.appendChild(ligne); q.appendChild(el('span', 'plm-pourquoi', `${GENRES[f.genre] || 'À revoir'} · ${f.raison || ''}`)); r.appendChild(q);
      const bt = el('span', 'plm-boutons');
      if (f.propositions[0] !== undefined) bt.appendChild(bouton('plm-p', 'Corriger', () => { remplacer(s, f, f.propositions[0]); ouvrirTout(s); }));
      bt.appendChild(bouton('', 'Modifier', () => ouvrirModif(s, f, 'tout')));
      bt.appendChild(bouton('plm-doux', 'Ignorer', () => { ignorerFaute(s, f); ouvrirTout(s); }));
      r.appendChild(bt); l.appendChild(r);
    }
    b.appendChild(l);
    const pied = el('div', 'plm-tout-pied');
    const tc = bouton('plm-p', 'Tout corriger', () => { toutCorriger(s); ouvrirTout(s); }); tc.disabled = !s.fautes.some((f) => f.propositions[0] !== undefined); pied.appendChild(tc);
    const ti = bouton('', 'Tout ignorer', () => { for (const f of [...s.fautes]) ignorerFaute(s, f); fermer(); focusChamp(s); }); ti.disabled = !n; pied.appendChild(ti);
    pied.appendChild(el('span', 'plm-vide'));
    const off = bouton('plm-off', 'Désactiver', desactiver, 'Désactiver Plume partout (réactiver dans Réglages)'); off.prepend(svgTrait(POWER, 15, '#6B6280')); pied.appendChild(off);
    b.appendChild(pied); placerFenetre();
    setTimeout(() => { const p = b.querySelector('.plm-p:not([disabled])') || x; p.focus({ preventScroll: true }); }, 0);
  }
  function focusChamp(s) { try { s.el.focus({ preventScroll: true }); } catch { /* */ } }

  // ---------------- Corriger, ignorer, garder ----------------
  function remplacer(s, f, neuf) {
    if (!s.el.isConnected) return false;
    const t = lire(s.el, s.ce); let d = f.debut, fin = f.fin;
    if (t.slice(d, fin) !== f.avant) { const k = t.indexOf(f.avant, Math.max(0, d - 40)); if (k < 0) return false; d = k; fin = k + f.avant.length; }
    focusChamp(s);
    let fait = false;
    if (!s.ce) {
      s.el.setSelectionRange(d, fin);
      try { fait = document.execCommand('insertText', false, neuf); } catch { fait = false; }
      if (!fait || s.el.value.slice(d, d + neuf.length) !== neuf) { s.el.setRangeText(neuf, d, fin, 'end'); s.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: neuf })); }
    } else {
      const r = plage(s, d, fin); if (!r) return false;
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      try { fait = document.execCommand('insertText', false, neuf); } catch { fait = false; }
      if (!fait) { r.deleteContents(); r.insertNode(document.createTextNode(neuf)); s.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: neuf })); }
    }
    // L'événement « input » a déjà fait suivre les autres fautes ; celle-ci est partie.
    s.fautes = s.fautes.filter((x) => x !== f && !(x.debut === d && x.avant === f.avant));
    s.texte = lire(s.el, s.ce); dessiner(s); planifier(s, 600);
    return true;
  }
  function toutCorriger(s) {
    for (const f of [...s.fautes].sort((a, b) => b.debut - a.debut)) if (f.propositions[0] !== undefined) remplacer(s, f, f.propositions[0]);
  }
  function ignorerFaute(s, f) {
    s.fautes = s.fautes.filter((x) => x !== f); dessiner(s); cacheClient.clear();
    T.appel('ignorer', { avant: f.avant, regle: f.regle }).catch(() => {});
  }
  function garderMot(s, f) {
    for (const x of suivis.values()) { x.fautes = x.fautes.filter((y) => y.avant.toLowerCase() !== f.avant.toLowerCase()); dessiner(x); }
    cacheClient.clear(); T.appel('dictionnaire', { ajouter: f.avant }).then(() => rafraichir()).catch(() => {});
    focusChamp(s);
  }

  // ---------------- Désactiver : Plume se tait partout, tout de suite ----------------
  async function desactiver() {
    const avant = etat; appliquer({ ...(etat || {}), actif: false, depuis: Date.now() });
    try { appliquer(await T.appel('reglages', { actif: false })); } catch { /* le message reste juste : ici, Plume est coupé */ }
    note(avant);
  }
  function note() {
    const b = boite('plm-note', 'Plume est désactivé partout', 'note', null, null); b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'polite');
    const t = el('div', 'plm-note-t'); t.appendChild(icone(26)); t.appendChild(el('b', '', 'Plume est désactivé partout')); b.appendChild(t);
    b.appendChild(el('p', '', 'Plus aucune proposition, et Odin ne s\'en sert plus non plus. Tu le réactives dans Réglages → Plume.'));
    const fin = el('div', 'plm-fin');
    fin.appendChild(bouton('plm-blanc', 'Annuler', async () => { fermer(); try { appliquer(await T.appel('reglages', { actif: true })); } catch { /* */ } }));
    fin.appendChild(bouton('', 'Ouvrir les réglages', () => { fermer(); T.ouvrirReglages(); }));
    b.appendChild(fin); placerFenetre();
    const moi = ouvert; setTimeout(() => { if (ouvert === moi) fermer(); }, 12000);
  }

  // ---------------- Les gestes ----------------
  document.addEventListener('focusin', (e) => { const s = suivre(e.target); if (s && s.verifie !== lire(s.el, s.ce)) planifier(s, 150); }, true);
  document.addEventListener('input', (e) => {
    const s = suivre(e.target) || (e.target && e.target.nodeType === 1 && e.target.isContentEditable ? suivre(e.target) : null); if (!s) return;
    const t = lire(s.el, s.ce); s.fautes = decaler(s.fautes, s.texte ?? t, t); s.texte = t;
    if (ouvert && ouvert.s === s && ouvert.mode === 'faute') fermer();
    dessiner(s); planifier(s);
  }, true);
  // Clic (ou doigt) sur un mot souligné : la petite fenêtre.
  document.addEventListener('click', (e) => {
    if (!e.isTrusted || !actifIci()) return;
    const cible = e.target; if (racine && racine.contains(cible)) return;
    const s = cible && cible.nodeType === 1 ? suivis.get(cible) || [...suivis.values()].find((x) => x.ce && x.el.contains(cible)) : null;
    if (!s || !s.fautes.length) { if (ouvert && ouvert.mode !== 'note' && !(ouvert.boite && ouvert.boite.contains(cible))) fermer(); return; }
    let pos;
    if (!s.ce) { if (s.el.selectionStart !== s.el.selectionEnd) return; pos = s.el.selectionStart; }
    else { const sel = getSelection(); if (!sel.rangeCount || !sel.isCollapsed) return; const r = sel.getRangeAt(0), pre = document.createRange(); pre.selectNodeContents(s.el); pre.setEnd(r.startContainer, r.startOffset); pos = texteAvant(s, r.startContainer, r.startOffset); }
    const f = s.fautes.find((x) => pos >= x.debut && pos <= x.fin);
    if (f) ouvrirFaute(s, f); else if (ouvert && ouvert.mode !== 'note') fermer();
  }, true);
  function texteAvant(s, noeud, off) { const { segs } = texteCE(s.el); const g = segs.find((x) => x.n === noeud); return g ? g.d + off : -1; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ouvert && ouvert.mode !== 'note') { const s = ouvert.s; fermer(); if (s) focusChamp(s); } }, true);
  addEventListener('scroll', replacer, { capture: true, passive: true });
  addEventListener('resize', replacer, { passive: true });
  if (window.visualViewport) { visualViewport.addEventListener('resize', replacer); visualViewport.addEventListener('scroll', replacer); }
  document.addEventListener('scroll', replacer, { capture: true, passive: true });
  setInterval(() => { if (suivis.size) replacer(); }, 700);
  addEventListener('focus', rafraichir);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) rafraichir(); });
  setInterval(rafraichir, 60000);
  T.ecouter && T.ecouter((e) => { if (e && typeof e === 'object') appliquer(e, true); });

  // ---------------- Réglages → Plume (page des réglages d'Odin) ----------------
  let carte = null;
  function carteReglages() {
    if (HOTE || carte) return carte;
    const grille = document.querySelector('#v-settings .sgrid'), nav = document.getElementById('snav'); if (!grille || !nav) return null;
    const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'schip'; chip.dataset.sec = 'plume'; chip.setAttribute('role', 'tab'); chip.textContent = 'Plume';
    nav.insertBefore(chip, nav.querySelector('.schip.more')); chip.addEventListener('click', () => window.openSettings && window.openSettings('plume'));
    carte = document.createElement('article'); carte.className = 'card plm-reglages'; carte.dataset.sec = 'plume'; carte.hidden = true; carte.setAttribute('aria-label', 'Réglages de Plume');
    grille.appendChild(carte); peindreReglages(); return carte;
  }
  let dicoOuvert = false;
  function interrupteur(cle, titre, aide, actif, grise) {
    const l = el('label', `plm-r-ligne${grise ? ' plm-r-grise' : ''}`), t = el('span'); t.appendChild(el('b', '', titre)); t.appendChild(el('small', '', aide)); l.appendChild(t);
    const c = el('input', 'plm-inter'); c.type = 'checkbox'; c.setAttribute('role', 'switch'); c.checked = actif; c.dataset.cle = cle;
    c.addEventListener('change', async () => { try { appliquer(await T.appel('reglages', { [cle]: c.checked })); statut(c.checked ? (cle === 'actif' ? 'Plume est rallumé partout.' : 'Enregistré.') : (cle === 'actif' ? 'Plume est désactivé partout.' : 'Enregistré.')); } catch (e) { c.checked = !c.checked; statut(`Pas enregistré : ${e.message}`); } });
    l.appendChild(c); return l;
  }
  let dernierStatut = '';
  function statut(t) { dernierStatut = t; const x = carte && carte.querySelector('.plm-r-statut'); if (x) x.textContent = t; }
  let peintAvec = '';
  async function peindreReglages(forcer) {
    if (HOTE || !carte) return;
    const e = etat, sig = `${JSON.stringify(e)}|${dicoOuvert}`;
    if (!forcer && sig === peintAvec) return; peintAvec = sig;
    carte.textContent = '';
    const tete = el('div', 'plm-r-tete'); tete.appendChild(icone(40)); const tt = el('div'); tt.style.flex = '1'; tt.appendChild(el('h2', '', 'Plume'));
    const quand = e && e.depuis ? new Date(e.depuis).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
    tt.appendChild(el('span', `plm-r-etat${e && !e.actif ? ' plm-r-coupe' : ''}`, !e ? 'Connecte-toi à Odin pour régler Plume.' : e.actif ? 'Activé : il propose des corrections pendant que tu écris.' : `Désactivé partout${quand ? `, depuis ${quand}` : ''}`)); tete.appendChild(tt); carte.appendChild(tete);
    if (!e) return;
    carte.appendChild(interrupteur('actif', 'Plume', 'Proposer des corrections pendant que j\'écris, et laisser Odin s\'en servir', e.actif, false));
    carte.appendChild(el('div', 'plm-r-titre', 'Quand Plume est activé'));
    carte.appendChild(interrupteur('odin', 'Dans Odin et ses applis', 'Discussion, champs de toutes les applis', e.odin, !e.actif));
    carte.appendChild(interrupteur('pegase', 'Dans Pégase', 'Sites, formulaires, barre de recherche', e.pegase, !e.actif));
    carte.appendChild(interrupteur('ia', 'Odin se sert de Plume', 'Pour corriger un fichier ou répondre sur l\'écriture', e.ia, !e.actif));
    carte.appendChild(interrupteur('grammaire', 'Grammaire et style', 'En plus de l\'orthographe et des fautes de frappe', e.grammaire, !e.actif));
    const p = el('div', 'plm-r-pastilles');
    const lg = el('label', 'plm-r-pastille', 'Langue : '), sel = el('select'); sel.setAttribute('aria-label', 'Langue de Plume');
    for (const [v, n] of [['fr', 'français'], ['en-US', 'anglais (É.-U.)'], ['en-GB', 'anglais (R.-U.)'], ['de-DE', 'allemand'], ['es', 'espagnol'], ['it', 'italien'], ['pt-PT', 'portugais']]) { const o = el('option', '', n); o.value = v; sel.appendChild(o); }
    sel.value = e.langue; sel.addEventListener('change', async () => { try { appliquer(await T.appel('reglages', { langue: sel.value })); statut(sel.value === 'fr' || e.correcteur === 'LanguageTool' ? 'Enregistré.' : 'Enregistré. Hors du français, il faut LanguageTool (appli Plume, onglet Correcteur).'); } catch (er) { statut(`Pas enregistré : ${er.message}`); } });
    lg.appendChild(sel); p.appendChild(lg);
    const dico = el('button', 'plm-r-pastille', `Mon dictionnaire : ${pluriel(e.dictionnaire, 'mot', 'mots')}`); dico.type = 'button'; dico.setAttribute('aria-expanded', String(dicoOuvert));
    dico.addEventListener('click', () => { dicoOuvert = !dicoOuvert; peindreReglages(true); }); p.appendChild(dico);
    if (e.ignores) { const ig = el('button', 'plm-r-pastille', `Fautes ignorées : ${e.ignores} · tout oublier`); ig.type = 'button'; ig.addEventListener('click', async () => { try { await T.appel('ignorer', { oublier: true }); cacheClient.clear(); await rafraichir(); statut('Plume ne se souvient plus de ce que tu avais ignoré.'); } catch (er) { statut(er.message); } }); p.appendChild(ig); }
    p.appendChild(el('span', 'plm-r-pastille', `Correcteur : ${e.correcteur === 'LanguageTool' ? 'LanguageTool (installé à côté d\'Odin)' : 'Plume (LanguageTool si installé)'}`));
    carte.appendChild(p);
    const zone = el('div', 'plm-r-dico'); zone.hidden = !dicoOuvert; carte.appendChild(zone);
    if (dicoOuvert) {
      const mots = el('div', 'plm-r-mots'); zone.appendChild(mots);
      try {
        const r = await T.appel('dictionnaire');
        if (!r.mots.length) mots.appendChild(el('span', 'plm-r-etat', 'Aucun mot pour l\'instant : « Modifier » puis « Garder » sur un mot souligné l\'ajoute ici.'));
        for (const m of r.mots) { const c = el('span', 'plm-r-mot', m), x = el('button', '', '×'); x.type = 'button'; x.setAttribute('aria-label', `Retirer ${m}`); x.addEventListener('click', async () => { await T.appel('dictionnaire', { retirer: m }).catch(() => 0); cacheClient.clear(); await rafraichir(); peindreReglages(true); }); c.appendChild(x); mots.appendChild(c); }
      } catch { /* */ }
      const aj = el('form', 'plm-r-ajout'), inp = el('input'); inp.placeholder = 'Un mot à garder (ex. Mamoudzou)'; inp.setAttribute('aria-label', 'Mot à ajouter'); inp.setAttribute('data-plume', 'non'); inp.maxLength = 60;
      const ok = el('button', 'btn small', 'Ajouter'); ok.type = 'submit'; aj.appendChild(inp); aj.appendChild(ok);
      aj.addEventListener('submit', async (ev) => { ev.preventDefault(); const v = inp.value.trim(); if (!v) return; try { await T.appel('dictionnaire', { ajouter: v }); cacheClient.clear(); await rafraichir(); peindreReglages(true); } catch (er) { statut(er.message); } });
      zone.appendChild(aj);
    }
    carte.appendChild(el('div', 'plm-r-statut', dernierStatut)).setAttribute('role', 'status');
  }

  // ---------------- Démarrage ----------------
  const demarrer = () => {
    monter(); carteReglages();
    if (!HOTE && location.hash === '#plume' && typeof window.openSettings === 'function') setTimeout(() => window.openSettings('plume'), 300);
    rafraichir();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer, { once: true }); else demarrer();
  const api = { etat: () => etat, rafraichir, suivis: () => [...suivis.values()].map((s) => ({ champ: s.champ, fautes: s.fautes.map((f) => ({ ...f })) })) };
  if (!HOTE) window.OdinPlume = api;
  else if (typeof HOTE.essai === 'function') HOTE.essai({ ...api, racine: () => racine }); // essais de Pégase seulement (monde isolé)
})();
