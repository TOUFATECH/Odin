// Dédale dans l'interface : quatre onglets.
// - Terminaux : de vrais terminaux qui durent (le shell tourne dans Odin) : on ferme la page, on revient (même depuis le
//   téléphone) et on retrouve l'écran où on en était. Écran de terminal fait maison (séquences VT100/xterm courantes :
//   couleurs, déplacements du curseur, effacements, zone de défilement, écran secondaire des éditeurs plein écran).
// - Projets : ouvrir un projet de tes dossiers de code, parcourir ses fichiers, les modifier (coloration simple),
//   enregistrer, « Lancer » (dans un terminal qui dure) et voir l'aperçu web, « Demander à l'IA ».
// - Dépôts et Réglages : la vue générique de Dédale.
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const act = async (action, input = {}, confirm = false) => {
    const r = await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'ivaldi', action, input, confirm }) });
    const j = await r.json().catch(() => ({ ok: false, text: `Odin répond ${r.status}` }));
    if (j.confirm && !confirm) return window.confirm(j.confirm) ? act(action, input, true) : { ok: false, text: 'Annulé.' };
    return j;
  };
  const CSS = `
.dd{display:flex;flex-direction:column;gap:12px;min-width:0}
.dd-tabs{display:flex;gap:6px;flex-wrap:wrap}.dd-tabs button{min-height:40px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--muted);padding:0 14px;font:600 13.5px inherit;cursor:pointer}
.dd-tabs button[aria-selected=true]{background:var(--panel2);color:var(--ink);border-color:var(--ink)}
.dd-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.dd-bar button,.dd-bar select,.dd-bar input{min-height:40px;min-width:40px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:0 10px;font:inherit;font-size:13px;cursor:pointer}
.dd-bar input{cursor:text;flex:1 1 140px;min-width:0;max-width:280px}
.dd-bar button[aria-pressed=true],.dd-bar button[aria-current=true]{background:var(--panel2);border-color:var(--ink);font-weight:600}
.dd-bar .etat{font-size:12.5px;color:var(--muted);margin-left:auto}
.dd-term{position:relative;background:#0f1115;color:#e6e6e6;border-radius:12px;border:1px solid var(--line);height:min(62vh,560px);overflow:auto;padding:8px;font:13px/1.25 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;cursor:text;overscroll-behavior:contain}
.dd-term .l{white-space:pre;min-height:1.25em}.dd-term .cur{outline:1px solid #e6e6e6;background:#e6e6e6;color:#0f1115}
.dd-term textarea{position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;resize:none}
.dd-term .fin{color:#fbbf24;white-space:pre-wrap}
.dd-keys{display:flex;gap:6px;flex-wrap:wrap}.dd-keys button{min-height:40px;min-width:44px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 12.5px ui-monospace,monospace;cursor:pointer}
.dd-proj{display:grid;grid-template-columns:240px minmax(0,1fr);gap:12px;align-items:start}
@media (max-width:820px){.dd-proj{grid-template-columns:1fr}}
.dd-files{border:1px solid var(--line);border-radius:12px;background:var(--panel);max-height:62vh;overflow:auto;padding:6px}
.dd-files button{display:block;width:100%;text-align:left;min-height:34px;border:0;background:none;color:var(--ink);font:12.5px ui-monospace,monospace;padding:4px 8px;border-radius:8px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dd-files button[aria-current=true]{background:var(--panel2);font-weight:700}.dd-files .dir{color:var(--muted);font-size:12px;padding:6px 8px 2px}
.dd-ed{position:relative;border:1px solid var(--line);border-radius:12px;background:#0f1115;height:min(58vh,520px);overflow:hidden}
.dd-ed pre,.dd-ed textarea{position:absolute;inset:0;margin:0;padding:10px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;overflow:auto;tab-size:2;box-sizing:border-box;border:0}
.dd-ed pre{color:#e6e6e6;pointer-events:none}.dd-ed textarea{background:transparent;color:transparent;caret-color:#fff;resize:none;outline:none}
.dd-ed .k{color:#c792ea}.dd-ed .s{color:#c3e88d}.dd-ed .c{color:#7f8c98;font-style:italic}.dd-ed .n{color:#f78c6c}.dd-ed .t{color:#82aaff}
.dd-ia{white-space:pre-wrap;border:1px solid var(--line);border-radius:12px;padding:10px;background:var(--panel);font-size:13.5px}
.dd-sub{font-size:13px;color:var(--muted);margin:0}
`;
  const style = () => { if (!document.getElementById('dd-css')) document.head.append(el('style', { id: 'dd-css' }, CSS)); };
  const S = { tab: 'Terminaux', term: null, projet: null, fichier: null, accords: new Set() };

  // ------------------------------------------------------------------ l'écran de terminal
  const PAL = ['#1e1e1e', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4', '#5c6370', '#ff7b86', '#b5e890', '#ffd68a', '#7cc3ff', '#de9cf0', '#7fd8e3', '#ffffff'];
  const c256 = (n) => { if (n < 16) return PAL[n]; if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; } n -= 16; const f = (x) => (x ? 55 + x * 40 : 0); return `rgb(${f(Math.floor(n / 36))},${f(Math.floor(n / 6) % 6)},${f(n % 6)})`; };
  class Ecran {
    constructor(cols, rows, repondre) { this.repondre = repondre; this.histo = []; this.reset(cols, rows); }
    reset(cols, rows) { this.cols = cols; this.rows = rows; this.st = {}; this.x = 0; this.y = 0; this.haut = 0; this.bas = rows - 1; this.grille = this.vide(rows); this.alt = null; this.etat = 0; this.seq = ''; this.wrap = true; this.voir = true; this.collage = false; this.attente = false; this.sauve = [0, 0, {}]; }
    ligne() { return Array.from({ length: this.cols }, () => [' ', this.st]); }
    vide(n) { return Array.from({ length: n }, () => this.ligne()); }
    taille(cols, rows) {
      const g = this.grille; this.cols = cols; this.rows = rows;
      this.grille = Array.from({ length: rows }, (_, i) => { const src = g[i + Math.max(0, g.length - rows)] ?? []; return Array.from({ length: cols }, (_, j) => src[j] ?? [' ', {}]); });
      this.x = Math.min(this.x, cols - 1); this.y = Math.min(this.y, rows - 1); this.haut = 0; this.bas = rows - 1;
    }
    defiler(n = 1) { for (let i = 0; i < n; i++) { const l = this.grille.splice(this.haut, 1)[0]; if (!this.alt && this.haut === 0) { this.histo.push(l); if (this.histo.length > 2000) this.histo.shift(); } this.grille.splice(this.bas, 0, this.ligne()); } }
    descendre(n = 1) { for (let i = 0; i < n; i++) { this.grille.splice(this.bas, 1); this.grille.splice(this.haut, 0, this.ligne()); } }
    nl() { if (this.y === this.bas) this.defiler(); else if (this.y < this.rows - 1) this.y++; }
    mettre(ch) { if (this.attente) { this.x = 0; this.nl(); this.attente = false; } this.grille[this.y][this.x] = [ch, this.st]; if (this.x === this.cols - 1) { if (this.wrap) this.attente = true; } else this.x++; }
    ecrire(t) {
      for (const ch of t) {
        if (this.etat === 0) {
          const c = ch.codePointAt(0);
          if (c >= 32 && c !== 127) { this.mettre(ch); continue; }
          if (ch === '\x1b') { this.etat = 1; continue; }
          if (ch === '\r') { this.x = 0; this.attente = false; } else if (ch === '\n' || ch === '\v' || ch === '\f') { this.nl(); this.attente = false; } else if (ch === '\b') { this.x = Math.max(0, this.x - 1); this.attente = false; } else if (ch === '\t') this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8);
          continue;
        }
        if (this.etat === 1) {
          if (ch === '[') { this.etat = 2; this.seq = ''; continue; }
          if (ch === ']') { this.etat = 3; this.seq = ''; continue; }
          if (ch === '(' || ch === ')' || ch === '#' || ch === '%') { this.etat = 4; continue; }
          this.etat = 0;
          if (ch === '7') this.sauve = [this.x, this.y, this.st]; else if (ch === '8') [this.x, this.y, this.st] = this.sauve;
          else if (ch === 'M') { if (this.y === this.haut) this.descendre(); else this.y = Math.max(0, this.y - 1); } else if (ch === 'D') this.nl(); else if (ch === 'E') { this.x = 0; this.nl(); } else if (ch === 'c') this.reset(this.cols, this.rows);
          continue;
        }
        if (this.etat === 4) { this.etat = 0; continue; }
        if (this.etat === 3) { if (ch === '\x07' || (ch === '\\' && this.seq.endsWith('\x1b'))) this.etat = 0; else this.seq += ch; continue; }
        // CSI
        const c = ch.codePointAt(0);
        if (c >= 0x40 && c <= 0x7e) { this.etat = 0; this.csi(this.seq, ch); } else this.seq += ch;
      }
    }
    csi(seq, f) {
      const priv = seq.startsWith('?'), p = seq.replace(/^[?>=]/, '').split(';').map((x) => (x === '' ? NaN : Number(x))), n = (i, d = 1) => (Number.isNaN(p[i]) || p[i] === undefined || p[i] === 0 ? d : p[i]);
      const borne = () => { this.x = Math.max(0, Math.min(this.cols - 1, this.x)); this.y = Math.max(0, Math.min(this.rows - 1, this.y)); this.attente = false; };
      const effacer = (l, a, b) => { for (let i = a; i < b; i++) l[i] = [' ', this.st]; };
      switch (f) {
        case 'A': this.y = Math.max(this.haut, this.y - n(0)); borne(); break;
        case 'B': this.y = Math.min(this.bas, this.y + n(0)); borne(); break;
        case 'C': this.x += n(0); borne(); break;
        case 'D': this.x -= n(0); borne(); break;
        case 'E': this.x = 0; this.y += n(0); borne(); break;
        case 'F': this.x = 0; this.y -= n(0); borne(); break;
        case 'G': case '`': this.x = n(0) - 1; borne(); break;
        case 'd': this.y = n(0) - 1; borne(); break;
        case 'H': case 'f': this.y = n(0) - 1; this.x = n(1) - 1; borne(); break;
        case 'J': { const m = Number.isNaN(p[0]) ? 0 : p[0]; if (m === 0) { effacer(this.grille[this.y], this.x, this.cols); for (let i = this.y + 1; i < this.rows; i++) this.grille[i] = this.ligne(); } else if (m === 1) { effacer(this.grille[this.y], 0, this.x + 1); for (let i = 0; i < this.y; i++) this.grille[i] = this.ligne(); } else { this.grille = this.vide(this.rows); if (m === 3) this.histo = []; } break; }
        case 'K': { const m = Number.isNaN(p[0]) ? 0 : p[0], l = this.grille[this.y]; if (m === 0) effacer(l, this.x, this.cols); else if (m === 1) effacer(l, 0, this.x + 1); else effacer(l, 0, this.cols); break; }
        case 'L': if (this.y >= this.haut && this.y <= this.bas) for (let i = 0; i < n(0); i++) { this.grille.splice(this.bas, 1); this.grille.splice(this.y, 0, this.ligne()); } break;
        case 'M': if (this.y >= this.haut && this.y <= this.bas) for (let i = 0; i < n(0); i++) { this.grille.splice(this.y, 1); this.grille.splice(this.bas, 0, this.ligne()); } break;
        case 'P': { const l = this.grille[this.y]; l.splice(this.x, n(0)); while (l.length < this.cols) l.push([' ', this.st]); break; }
        case '@': { const l = this.grille[this.y]; for (let i = 0; i < n(0); i++) l.splice(this.x, 0, [' ', this.st]); l.length = this.cols; break; }
        case 'X': effacer(this.grille[this.y], this.x, Math.min(this.cols, this.x + n(0))); break;
        case 'S': this.defiler(n(0)); break;
        case 'T': this.descendre(n(0)); break;
        case 'r': this.haut = n(0) - 1; this.bas = Math.min(this.rows - 1, (Number.isNaN(p[1]) ? this.rows : p[1]) - 1); if (this.haut >= this.bas) { this.haut = 0; this.bas = this.rows - 1; } this.x = 0; this.y = 0; break;
        case 's': this.sauve = [this.x, this.y, this.st]; break;
        case 'u': [this.x, this.y, this.st] = this.sauve; break;
        case 'm': this.sgr(p); break;
        case 'n': if (p[0] === 6) this.repondre(`\x1b[${this.y + 1};${this.x + 1}R`); else if (p[0] === 5) this.repondre('\x1b[0n'); break;
        case 'c': if (!priv) this.repondre('\x1b[?1;2c'); break;
        case 'h': case 'l': if (priv) for (const m of p) {
          const on = f === 'h';
          if (m === 25) this.voir = on; else if (m === 7) this.wrap = on; else if (m === 2004) this.collage = on;
          else if (m === 1049 || m === 47 || m === 1047) { if (on && !this.alt) { this.alt = { g: this.grille, x: this.x, y: this.y }; this.grille = this.vide(this.rows); } else if (!on && this.alt) { this.grille = this.alt.g; this.x = this.alt.x; this.y = this.alt.y; this.alt = null; } }
        } break;
        default: break;
      }
    }
    sgr(p) {
      if (!p.length || (p.length === 1 && Number.isNaN(p[0]))) { this.st = {}; return; }
      const s = { ...this.st };
      for (let i = 0; i < p.length; i++) {
        const v = Number.isNaN(p[i]) ? 0 : p[i];
        if (v === 0) { for (const k of Object.keys(s)) delete s[k]; } else if (v === 1) s.b = 1; else if (v === 2) s.d = 1; else if (v === 3) s.i = 1; else if (v === 4) s.u = 1; else if (v === 7) s.r = 1;
        else if (v === 22) { delete s.b; delete s.d; } else if (v === 23) delete s.i; else if (v === 24) delete s.u; else if (v === 27) delete s.r;
        else if (v >= 30 && v <= 37) s.f = PAL[v - 30]; else if (v >= 90 && v <= 97) s.f = PAL[v - 82]; else if (v === 39) delete s.f;
        else if (v >= 40 && v <= 47) s.g = PAL[v - 40]; else if (v >= 100 && v <= 107) s.g = PAL[v - 92]; else if (v === 49) delete s.g;
        else if (v === 38 || v === 48) { const k = v === 38 ? 'f' : 'g'; if (p[i + 1] === 5) { s[k] = c256(p[i + 2] ?? 0); i += 2; } else if (p[i + 1] === 2) { s[k] = `rgb(${p[i + 2] ?? 0},${p[i + 3] ?? 0},${p[i + 4] ?? 0})`; i += 4; } }
      }
      this.st = s;
    }
    /** Le texte affiché (pour les essais et le copier). */
    texte() { return [...this.histo, ...this.grille].map((l) => l.map((c) => c[0]).join('').replace(/\s+$/, '')).join('\n').replace(/\n+$/, ''); }
  }
  // L'écran seul (sans page), pour les essais.
  window.OdinEcranTerminal = Ecran;
  const styleCss = (s, cur) => { let f = s.f, g = s.g; if (s.r) [f, g] = [g || '#0f1115', f || '#e6e6e6']; if (cur) [f, g] = [g || '#0f1115', f || '#e6e6e6']; return `${f ? `color:${f};` : ''}${g ? `background:${g};` : ''}${s.b ? 'font-weight:700;' : ''}${s.d ? 'opacity:.7;' : ''}${s.i ? 'font-style:italic;' : ''}${s.u ? 'text-decoration:underline;' : ''}`; };
  function ligneDom(l, curX) {
    const d = el('div', { class: 'l' }); let txt = '', st = null, cle = null;
    const pousse = () => { if (txt) d.append(cle ? el('span', { style: cle }, txt) : document.createTextNode(txt)); txt = ''; };
    l.forEach((c, i) => { const k = styleCss(c[1], i === curX); if (k !== cle) { pousse(); cle = k; st = c[1]; } txt += c[0]; });
    pousse(); void st; return d;
  }

  // ------------------------------------------------------------------ un terminal branché sur une session
  async function terminal(hote, session, onFin) {
    let ec, mesure = { cw: 7.8, ch: 16.25 }, depuis = 0, vivant = true, fini = false, envoi = '', minuteur = 0, rendu = 0, ctrl = false, histoN = 0;
    const histo = el('div'), ecran = el('div'), fin = el('div', { class: 'fin', role: 'status' }), saisie = el('textarea', { 'aria-label': `Terminal ${session.nom}`, autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' });
    const zone = el('div', { class: 'dd-term', tabindex: '-1', onclick: () => saisie.focus({ preventScroll: true }) }, histo, ecran, fin, saisie);
    const envoyer = (t) => { if (fini) return; envoi += t; clearTimeout(minuteur); minuteur = setTimeout(async () => { const d = envoi; envoi = ''; if (!d) return; await fetch('/api/terminal/ecrire', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ id: session.id, data: d }) }).catch(() => {}); }, 8); };
    const peindre = () => {
      rendu = 0; if (!ec) return;
      const enBas = zone.scrollTop + zone.clientHeight >= zone.scrollHeight - 8;
      while (histoN < ec.histo.length) histo.append(ligneDom(ec.histo[histoN++], -1));
      while (histo.childNodes.length > ec.histo.length) { histo.firstChild.remove(); histoN = ec.histo.length; }
      ecran.replaceChildren(...ec.grille.map((l, i) => ligneDom(l, i === ec.y && ec.voir && !fini ? ec.x : -1)));
      if (enBas) zone.scrollTop = zone.scrollHeight;
    };
    const plus = () => { if (!rendu) rendu = requestAnimationFrame(peindre); };
    const dimensions = () => {
      // Une ligne d'essai, comme les vraies (même hauteur de ligne) : largeur d'un caractère, hauteur d'une ligne.
      const sp = el('span', {}, 'MMMMMMMMMM'), t = el('div', { class: 'l', style: 'visibility:hidden;position:absolute;left:0;top:0' }, sp); zone.append(t);
      const w = sp.getBoundingClientRect().width, h = t.getBoundingClientRect().height; t.remove();
      if (w) mesure = { cw: w / 10, ch: h || 16.25 };
      return { cols: Math.max(20, Math.floor((zone.clientWidth - 16) / mesure.cw)), rows: Math.max(5, Math.floor((zone.clientHeight - 16) / mesure.ch)) };
    };
    const ajuster = () => { const d = dimensions(); if (ec && (d.cols !== ec.cols || d.rows !== ec.rows)) { ec.taille(d.cols, d.rows); plus(); } fetch('/api/terminal/taille', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ id: session.id, ...d }) }).catch(() => {}); };
    const dec = new TextDecoder();
    const touches = { ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D', Home: '\x1b[H', End: '\x1b[F', PageUp: '\x1b[5~', PageDown: '\x1b[6~', Delete: '\x1b[3~', Insert: '\x1b[2~', Escape: '\x1b', Tab: '\t', Backspace: '\x7f', Enter: '\r', F1: '\x1bOP', F2: '\x1bOQ', F3: '\x1bOR', F4: '\x1bOS', F5: '\x1b[15~', F10: '\x1b[21~' };
    saisie.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      const k = e.key;
      if ((e.ctrlKey || ctrl) && !e.altKey && k.length === 1) { const c = k.toLowerCase().charCodeAt(0); if (c >= 97 && c <= 122) { e.preventDefault(); envoyer(String.fromCharCode(c - 96)); ctrl = false; boutCtrl.setAttribute('aria-pressed', 'false'); return; } }
      if (touches[k]) { e.preventDefault(); envoyer(e.altKey && k.length > 1 ? `\x1b${touches[k]}` : touches[k]); return; }
      if (e.altKey && k.length === 1) { e.preventDefault(); envoyer(`\x1b${k}`); }
    });
    saisie.addEventListener('input', () => { const v = saisie.value; saisie.value = ''; if (v) envoyer(ctrl && v.length === 1 && /[a-z]/i.test(v) ? String.fromCharCode(v.toLowerCase().charCodeAt(0) - 96) : v.replace(/\n/g, '\r')); if (ctrl) { ctrl = false; boutCtrl.setAttribute('aria-pressed', 'false'); } });
    saisie.addEventListener('paste', (e) => { e.preventDefault(); const t = e.clipboardData?.getData('text') ?? ''; envoyer(ec?.collage ? `\x1b[200~${t}\x1b[201~` : t.replace(/\r?\n/g, '\r')); });
    const boutCtrl = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { ctrl = !ctrl; boutCtrl.setAttribute('aria-pressed', String(ctrl)); saisie.focus({ preventScroll: true }); } }, 'Ctrl');
    const cle = (t, v) => el('button', { type: 'button', onclick: () => { envoyer(v); saisie.focus({ preventScroll: true }); } }, t);
    hote.replaceChildren(zone, el('div', { class: 'dd-keys', role: 'toolbar', 'aria-label': 'Touches' }, cle('Échap', '\x1b'), cle('Tab', '\t'), boutCtrl, cle('Ctrl-C', '\x03'), cle('Ctrl-D', '\x04'), cle('↑', '\x1b[A'), cle('↓', '\x1b[B'), cle('←', '\x1b[D'), cle('→', '\x1b[C'), el('button', { type: 'button', onclick: () => navigator.clipboard?.writeText(ec?.texte() ?? '') }, 'Copier')));
    // La page est construite avant d'être posée dans le document : on attend qu'elle y soit (mesures, boucle de lecture).
    await new Promise((r) => { const t0 = Date.now(); const f = () => (zone.isConnected || Date.now() - t0 > 10_000 ? r() : requestAnimationFrame(f)); f(); });
    const d0 = dimensions(); ec = new Ecran(d0.cols, d0.rows, (r) => envoyer(r));
    zone.__ecran = ec;
    const ro = new ResizeObserver(() => { if (!zone.isConnected) { ro.disconnect(); return; } ajuster(); }); ro.observe(zone);
    // La boucle : on lit ce qui sort, en attendant au plus 20 s ; à la reprise, l'écran est rejoué depuis le début gardé.
    (async () => {
      let premiere = true;
      while (vivant && zone.isConnected) {
        const r = await fetch(`/api/terminal/lire?id=${encodeURIComponent(session.id)}&depuis=${depuis}${premiere ? '' : '&attendre=1'}`).then((x) => x.json()).catch(() => null);
        if (!zone.isConnected) break;
        if (!r || r.ok === false) { fin.textContent = r?.error ?? 'Odin ne répond pas : nouvel essai…'; if (!r) { await new Promise((x) => setTimeout(x, 2000)); continue; } fini = true; break; }
        if (r.reprise || premiere) { ec.reset(ec.cols, ec.rows); ec.histo = []; histo.replaceChildren(); histoN = 0; }
        if (r.data) ec.ecrire(dec.decode(Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)), { stream: true }));
        depuis = r.fin; if (premiere) { premiere = false; ajuster(); }
        plus();
        if (r.ferme) { fini = true; fin.textContent = `\n[${r.ferme}]`; plus(); onFin?.(); break; }
      }
    })();
    setTimeout(() => saisie.focus({ preventScroll: true }), 50);
    return { zone, arreter: () => { vivant = false; ro.disconnect(); } };
  }

  async function onglerTerminaux(corps, generic) {
    const r = await act('terminaux'); const l = r.data ?? [];
    if (!S.term || !l.some((x) => x.id === S.term)) S.term = l.find((x) => !x.ferme)?.id ?? null;
    const nom = el('input', { type: 'text', placeholder: 'Nom (facultatif)', 'aria-label': 'Nom du terminal' }), poste = el('input', { type: 'text', placeholder: 'Poste (vide : cette machine)', 'aria-label': 'Poste' });
    const ouvrir = async () => { const x = await act('ouvrir_terminal', { nom: nom.value, poste: poste.value }); if (x.ok === false) { etat.textContent = x.text; return; } S.term = x.data.id; montrer(); };
    const etat = el('span', { class: 'etat', role: 'status' });
    const choix = l.map((x) => el('button', { type: 'button', 'aria-current': String(x.id === S.term), onclick: () => { S.term = x.id; montrer(); } }, `${x.nom}${x.ferme ? ' (fini)' : ''}`));
    const hote = el('div', { class: 'dd' });
    corps.append(el('div', { class: 'dd-bar' }, ...choix, nom, poste, el('button', { type: 'button', onclick: ouvrir }, 'Ouvrir un terminal'), etat), hote);
    const s = l.find((x) => x.id === S.term);
    if (s) { hote.append(el('div', { class: 'dd-bar' }, el('span', { class: 'dd-sub' }, `${s.nom} · ${s.nomPoste} · il continue de tourner quand tu quittes la page`), el('button', { type: 'button', onclick: async () => { await act('fermer_terminal', { id: s.id }); S.term = null; montrer(); } }, 'Fermer ce terminal'))); const t = el('div'); hote.append(t); void terminal(t, s); }
    else hote.append(el('p', { class: 'dd-sub' }, 'Aucun terminal ouvert : « Ouvrir un terminal » (ton accord est demandé).'));
    corps.append(...generic);
  }

  // ------------------------------------------------------------------ éditeur de projet
  const MOTS = new Set('const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of this null undefined true false def elif lambda pass yield with as None True False and or not is print self public private static void int string bool'.split(' '));
  const echapper = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function colorer(src, ext) {
    if (src.length > 200_000) return echapper(src);
    const html = ext === 'html' || ext === 'xml' || ext === 'svg', diese = /^(py|sh|yml|yaml|toml|rb|conf)$/.test(ext);
    const re = html ? /(<!--[\s\S]*?-->)|("[^"\n]*"|'[^'\n]*')|(<\/?[\w-]+)|([^<"']+|.)/g
      : new RegExp(`(${diese ? '#[^\\n]*' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/'})|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_$][\\w$]*)|([\\s\\S])`, 'g');
    let out = '', m;
    while ((m = re.exec(src))) {
      if (html) out += m[1] ? `<span class="c">${echapper(m[1])}</span>` : m[2] ? `<span class="s">${echapper(m[2])}</span>` : m[3] ? `<span class="t">${echapper(m[3])}</span>` : echapper(m[4]);
      else out += m[1] ? `<span class="c">${echapper(m[1])}</span>` : m[2] ? `<span class="s">${echapper(m[2])}</span>` : m[3] ? `<span class="n">${m[3]}</span>` : m[4] ? (MOTS.has(m[4]) ? `<span class="k">${m[4]}</span>` : m[4]) : echapper(m[5]);
    }
    return `${out}\n`;
  }
  async function onglerProjets(corps, generic) {
    const r = await act('projets'); const l = r.data ?? [];
    if (!S.projet || !l.some((p) => p.chemin === S.projet)) S.projet = l[0]?.chemin ?? null;
    const choix = el('select', { 'aria-label': 'Projet', onchange: (e) => { S.projet = e.target.value; S.fichier = null; montrer(); } }, ...l.map((p) => el('option', { value: p.chemin, selected: p.chemin === S.projet }, `${p.nom} (${p.genre})`)));
    const etat = el('span', { class: 'etat', role: 'status' });
    if (!S.projet) { corps.append(el('p', { class: 'dd-sub' }, 'Aucun projet : ajoute ton dossier de code dans l\'onglet « Dépôts ».'), ...generic); return; }
    const lancer = async () => { const x = await act('lancer_projet', { projet: S.projet }); etat.textContent = x.text; if (x.ok !== false) { S.lance = x.data; montrer(); } };
    corps.append(el('div', { class: 'dd-bar' }, choix, el('button', { type: 'button', onclick: lancer }, 'Lancer'), etat));
    const f = await act('fichiers', { projet: S.projet }); const fichiers = f.data?.fichiers ?? [], racine = f.data?.racine ?? S.projet;
    const liste = el('div', { class: 'dd-files', role: 'list' }), droite = el('div', { class: 'dd' });
    for (const x of fichiers) {
      if (x.dossier) { liste.append(el('div', { class: 'dir' }, `${x.chemin}/`)); continue; }
      const prof = x.chemin.split('/').length - 1;
      liste.append(el('button', { type: 'button', role: 'listitem', title: x.chemin, style: `padding-left:${8 + prof * 12}px`, 'aria-current': String(`${racine}/${x.chemin}` === S.fichier), onclick: () => { S.fichier = `${racine}/${x.chemin}`; montrer(); } }, x.chemin.split('/').pop()));
    }
    corps.append(el('div', { class: 'dd-proj' }, liste, droite));
    if (S.fichier) {
      const lu = await act('lire_fichier', { fichier: S.fichier });
      if (lu.ok === false) droite.append(el('p', { class: 'dd-sub' }, lu.text));
      else {
        const ext = (S.fichier.split('.').pop() || '').toLowerCase(), pre = el('pre', { 'aria-hidden': 'true' }), zone = el('textarea', { spellcheck: 'false', autocapitalize: 'off', 'aria-label': `Contenu de ${S.fichier.split('/').pop()}` });
        zone.value = lu.data.contenu; pre.innerHTML = colorer(zone.value, ext);
        let sale = false;
        zone.addEventListener('input', () => { pre.innerHTML = colorer(zone.value, ext); sale = true; et.textContent = 'Modifié'; });
        zone.addEventListener('scroll', () => { pre.scrollTop = zone.scrollTop; pre.scrollLeft = zone.scrollLeft; });
        zone.addEventListener('keydown', (e) => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const a = zone.selectionStart; zone.setRangeText('  ', a, zone.selectionEnd, 'end'); zone.dispatchEvent(new Event('input')); } if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); enregistrer(); } });
        const et = el('span', { class: 'etat', role: 'status' }, 'Enregistré');
        // L'accord est demandé une fois par fichier ouvert (enregistrer remplace le fichier sur le disque).
        const enregistrer = async () => { const deja = S.accords.has(S.fichier); const x = await act('enregistrer_fichier', { fichier: S.fichier, contenu: zone.value }, deja); if (x.ok !== false) { S.accords.add(S.fichier); sale = false; } et.textContent = x.ok === false ? x.text : 'Enregistré'; };
        const ia = el('div', { class: 'dd-ia', hidden: true });
        const demander = async () => { const q = window.prompt('Ta question sur ce fichier'); if (!q) return; ia.hidden = false; ia.textContent = 'L\'IA réfléchit…'; const x = await act('demander_ia', { fichier: S.fichier, question: q }); ia.textContent = x.text; };
        droite.append(el('div', { class: 'dd-bar' }, el('span', { class: 'dd-sub' }, S.fichier.slice(racine.length + 1)), el('button', { type: 'button', onclick: enregistrer }, 'Enregistrer'), el('button', { type: 'button', onclick: demander }, 'Demander à l\'IA'), et), el('div', { class: 'dd-ed' }, pre, zone), ia);
        void sale;
      }
    } else droite.append(el('p', { class: 'dd-sub' }, 'Choisis un fichier à gauche.'));
    if (S.lance) {
      const s = (await act('terminaux')).data?.find((x) => x.id === S.lance.session);
      if (s) {
        const t = el('div'); corps.append(el('h3', { style: 'margin:6px 0 0;font-size:15px' }, `Terminal : ${s.nom}`), t); void terminal(t, s);
        // L'aperçu s'ouvre dans un onglet à part (la page d'Odin n'accepte pas de cadre) ; il y tourne isolé d'Odin.
        corps.append(el('div', { class: 'dd-bar' }, el('a', { href: S.lance.apercu, target: '_blank', rel: 'noopener', class: 'btn' }, 'Ouvrir l\'aperçu du projet')));
      }
    }
    corps.append(...generic);
  }

  let montrer = () => {};
  window.OdinPages.ivaldi = async ({ host, generic, view }) => {
    style();
    const parOnglet = new Map(); let k = 0;
    for (const s of view.sections) { if (s.kind === 'graph') continue; const n = generic[k++]; if (!n) break; const o = s.onglet || 'Terminaux'; parOnglet.set(o, [...(parOnglet.get(o) ?? []), n]); }
    const onglets = view.onglets ?? ['Terminaux', 'Projets', 'Dépôts', 'Réglages'];
    if (!onglets.includes(S.tab)) S.tab = onglets[0];
    const corps = el('div', { class: 'dd' });
    const tabs = onglets.map((o) => el('button', { type: 'button', role: 'tab', 'data-o': o, onclick: () => { S.tab = o; montrer(); } }, o));
    montrer = async () => {
      tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.o === S.tab)));
      corps.replaceChildren();
      // Les tableaux génériques « Terminaux » et « Projets » font doublon avec l'écran dessiné : on garde le reste.
      const gen = (o) => (parOnglet.get(o) ?? []).filter((n) => !/^(Terminaux|Ouvrir un terminal|Projets)/.test((n.querySelector?.('h2')?.textContent ?? '').trim()));
      if (S.tab === 'Terminaux') return onglerTerminaux(corps, gen('Terminaux'));
      if (S.tab === 'Projets') return onglerProjets(corps, gen('Projets'));
      corps.append(...(parOnglet.get(S.tab) ?? []));
    };
    host.replaceChildren(el('div', { class: 'dd' }, el('div', { class: 'dd-tabs', role: 'tablist' }, ...tabs), corps));
    await montrer();
    return true;
  };
})();
