// Moteur commun des maquettes d'Odin : thèmes (mêmes calculs que src/web/themes.js), tailles d'écran,
// navigation, et le dessin des blocs d'une page. Les données arrivent dans window.MAQ (écrites par build.mjs).
(() => {
  'use strict';
  const D = window.MAQ, $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------------- Couleurs : recopié de src/web/themes.js pour donner exactement le même rendu ----------------
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (c) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, k) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v * (1 - k) + y[i] * k)); };
  const lum = (h) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /** Rapproche une couleur du texte jusqu'à ce qu'elle soit lisible sur le fond (WCAG AA : 4,5 pour du texte). */
  const lisible = (c, fond, vers, min) => { let k = 0, x = c; while (contrast(x, fond) < min && k < 1) { k += 0.05; x = mix(c, vers, Math.min(1, k)); } return x; };
  /** Les couleurs d'origine du thème (telles que dans Odin aujourd'hui). */
  function origine(t) {
    const bg = mix(t.sky[0], t.sky[1], 0.5), p = t.panel, ink = t.ink, a = t.accent;
    const onAccent = contrast('#ffffff', a) >= contrast('#111111', a) ? '#ffffff' : '#111111';
    const v = {
      '--bg': bg, '--panel': p, '--panel2': mix(p, bg, t.dark ? 0.35 : 0.45), '--line': mix(p, ink, 0.14), '--ink': ink,
      '--muted': mix(ink, p, 0.28), '--dim': mix(ink, p, 0.36), '--accent': a, '--accent-2': t.dark ? mix(a, '#ffffff', 0.18) : mix(a, '#000000', 0.15),
      '--on-accent': onAccent, '--field': mix(p, ink, 0.24), '--field-h': mix(p, ink, 0.34), '--hover': mix(p, ink, 0.06), '--sel': mix(p, a, 0.16),
      '--user': mix(p, a, 0.12), '--user-l': mix(p, a, 0.35), '--off': mix(ink, p, 0.55),
      ...(t.dark ? { '--good': '#6CCFB8', '--warn': '#F0B860', '--bad': '#EE8A70' } : { '--good': '#1D7F68', '--warn': '#8F6200', '--bad': '#B23F2A' }),
    };
    return Object.assign(v, t.fixe || {});
  }
  /** Les mêmes couleurs, corrigées là où le texte ne se lit pas assez ; `corr` dit ce qui a été corrigé. */
  function palette(t) {
    const v = origine(t), p = v['--panel'], p2 = v['--panel2'], ink = v['--ink'], corr = [];
    const fond = contrast(ink, p) < contrast(ink, p2) ? p : p2; // le fond le plus difficile des deux
    for (const k of ['--muted', '--dim', '--good', '--warn', '--bad']) { const x = lisible(v[k], fond, ink, 4.5); if (x !== v[k]) { corr.push([k, v[k], x]); v[k] = x; } }
    v['--accent-ink'] = lisible(v['--accent'], fond, ink, 4.5); if (v['--accent-ink'] !== v['--accent']) corr.push(['--accent (en texte)', v['--accent'], v['--accent-ink']]);
    const f = lisible(v['--field'], p, ink, 3); if (f !== v['--field']) { corr.push(['--field (bord des champs)', v['--field'], f]); v['--field'] = f; }
    const o = lisible(v['--off'], p2, ink, 3); if (o !== v['--off']) v['--off'] = o;
    for (const k of ['good', 'warn', 'bad']) { v[`--${k}-l`] = mix(p, v[`--${k}`], 0.45); v[`--${k}-bg`] = mix(p, v[`--${k}`], 0.1); }
    return { v, corr };
  }
  const T = D.themes;
  const cssDe = (id) => { const t = T[id], { v } = palette(t); return Object.entries({ ...v, '--sky0': t.sky[0], '--sky1': t.sky[1], '--mascot': t.mascot || v['--accent'] }).map(([k, x]) => `${k}:${x}`).join(';') + `;color-scheme:${t.dark ? 'dark' : 'light'}`; };
  const decorDe = (id) => `<svg viewBox="0 0 256 170" preserveAspectRatio="none" aria-hidden="true">${T[id].decor || ''}</svg>`;
  /** Les rapports de contraste d'un thème, avant et après correction. */
  function mesures(id) {
    const t = T[id], a = origine(t), b = palette(t).v, f = (v) => (contrast(v['--ink'], v['--panel']) < contrast(v['--ink'], v['--panel2']) ? v['--panel'] : v['--panel2']);
    const L = [['Texte', '--ink', 4.5], ['Texte secondaire', '--muted', 4.5], ['Texte discret', '--dim', 4.5], ['Accent en texte', '--accent', 4.5, '--accent-ink'], ['Vert', '--good', 4.5], ['Ambre', '--warn', 4.5], ['Rouge', '--bad', 4.5], ['Bord des champs', '--field', 3]];
    const rows = L.map(([nom, k, min, k2]) => ({ nom, min, avant: contrast(a[k], k === '--field' ? a['--panel'] : f(a)), apres: contrast(b[k2 || k], k === '--field' ? b['--panel'] : f(b)) }));
    rows.push({ nom: 'Texte sur bouton principal', min: 4.5, avant: contrast(a['--on-accent'], a['--accent']), apres: contrast(b['--on-accent'], b['--accent']) });
    return rows;
  }
  window.MAQ_OUTILS = { mesures, palette, origine, contrast };

  // ---------------- État ----------------
  const DEVS = { tel: [390, 800, 'Téléphone'], tab: [820, 1000, 'Tablette'], ordi: [1280, 800, 'Ordinateur'] };
  const garde = (k, d) => { try { return localStorage.getItem('odin.maq.' + k) || d; } catch { return d; } };
  const note = (k, v) => { try { localStorage.setItem('odin.maq.' + k, v); } catch { /* sans stockage : rien */ } };
  const S = { theme: garde('theme', 'valhalla'), dev: garde('dev', innerWidth < 700 ? 'tel' : innerWidth < 1100 ? 'tab' : 'ordi'), view: D.views[0].id, tab: 0, sec: 0, planche: false, rapport: false };
  if (!T[S.theme]) S.theme = 'valhalla'; if (!DEVS[S.dev]) S.dev = 'tel';
  // Pour les essais : « #essai-tel-mayotte-settings-3 » ouvre directement une taille, un thème, une vue, un onglet.
  { const m = location.hash.match(/^#essai-(\w+)-([\w-]+?)-(\w+)-(\d+)(-planche)?$/); if (m) { S.dev = m[1]; if (T[m[2]]) S.theme = m[2]; S.view = m[3]; S.tab = S.sec = Number(m[4]); S.planche = Boolean(m[5]); } }
  const vue = () => D.views.find((x) => x.id === S.view) || D.views[0];

  // ---------------- Petits dessins ----------------
  const I = {
    home: 'M4 11.2 12 4.5l8 6.7M6 9.8V19h4.5v-5h3v5H18V9.8', chat: 'M5 5h14v10H10l-4 4v-4H5z', brain: 'M12 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0 3 3 0 0 0 2-5 3 3 0 0 0-2-5 3 3 0 0 0-3-3zM12 4v16',
    net: 'M4 20V10l8-6 8 6v10zM9 20v-6h6v6', apps: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', plus: 'M5 12h.01M12 12h.01M19 12h.01', regl: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4 4',
    back: 'M15 5l-7 7 7 7', dots: 'M12 5h.01M12 12h.01M12 19h.01', send: 'M4 12l16-7-6 16-3-7z', mic: 'M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v3', prev: 'M7 5v14M19 5l-9 7 9 7z', play: 'M7 5l12 7-12 7z', next: 'M17 5v14M5 5l9 7-9 7z', arr: 'M5 12h14M13 6l6 6-6 6',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${I[k]}"/></svg>`;
  const CALQ = { halo: 'radial-gradient(circle at 50% 46%,rgba(255,255,255,.5),rgba(255,255,255,0) 62%),', pastille: 'radial-gradient(circle at 50% 50%,rgba(0,0,0,.22) 0 39%,rgba(0,0,0,0) 39.6%),', rayures: 'repeating-linear-gradient(135deg,rgba(255,255,255,.16) 0 3px,rgba(255,255,255,0) 3px 8px),' };
  /** La tuile d'une appli (même dessin que src/web/app-icons.js). */
  function tuile(id, nom, cls = '') {
    const i = D.icons[id], b = i ? i.b : ['#64748b', '#334155'], z = i && i.full ? '100%' : '78%';
    return `<span class="ic ${cls}" style="background:${(i && CALQ[i.v]) || ''}linear-gradient(145deg,${b[0]},${b[1]})">${i ? `<svg viewBox="0 0 64 64" width="${z}" height="${z}" aria-hidden="true">${i.g}</svg>` : esc((nom || id).slice(0, 1).toUpperCase())}</span>`;
  }
  const ton = (t) => ({ g: 'good', w: 'warn', b: 'bad', good: 'good', warn: 'warn', bad: 'bad' })[t] || '';
  /** Une cellule : « !g Texte » = pastille verte, « %72 » = barre, « ~ggwgb » = battements, « `txt » = chasse fixe. */
  function cell(c) {
    c = String(c ?? '');
    if (/^![gwbn] /.test(c)) return `<span class="pill ${ton(c[1])}">${esc(c.slice(3))}</span>`;
    if (/^%\d+$/.test(c)) return `<span class="pg"><i><b style="width:${c.slice(1)}%"></b></i><span>${c.slice(1)} %</span></span>`;
    if (/^~[gwb]+$/.test(c)) return `<span class="hb" role="img" aria-label="historique">${[...c.slice(1)].map((x) => `<i class="${x === 'g' ? '' : x}"></i>`).join('')}</span>`;
    if (c[0] === '`') return `<span class="mono">${esc(c.slice(1))}</span>`;
    return esc(c);
  }
  const teinte = (n) => `linear-gradient(135deg,hsl(${n} 55% 46%),hsl(${(n + 40) % 360} 60% 30%))`;

  // ---------------- Les blocs d'une page (mêmes genres que les « sections » des applis d'Odin, et quelques dessins en plus) ----------------
  const R = {
    table: (b) => `<table class="tbl"><thead><tr>${b[2].map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${b[3].map((r) => `<tr>${r.map((c, i) => `<td data-l="${esc(b[2][i] || '')}">${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
    sheet: (b) => `<div class="sheetw" tabindex="0"><table class="sheet"><thead><tr><th></th>${b[2].map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${b[3].map((r, n) => `<tr><td>${n + 1}</td>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
    list: (b) => `<div class="list">${b[2].map((x) => `<div class="li"><b>${cell(x[0])}</b>${x[1] ? `<small>${esc(x[1])}</small>` : ''}${x[2] ? `<span class="m">${cell(x[2])}</span>` : ''}</div>`).join('')}</div>`,
    cards: (b) => `<div class="cards">${b[2].map((x) => `<div class="it"><div class="t"><b>${esc(x[0])}</b>${x[2] ? cell(x[2]) : ''}</div>${x[1] ? `<small>${esc(x[1])}</small>` : ''}${x[3] != null ? cell('%' + x[3]) : ''}${x[4] ? `<div class="row">${x[4].map((a, i) => `<button type="button" class="btn${i ? '' : ' pri'}">${esc(a)}</button>`).join('')}</div>` : ''}</div>`).join('')}</div>`,
    log: (b) => `<pre class="log mono" tabindex="0">${esc(b[2].join('\n'))}</pre>`,
    text: (b) => `<p class="note ${ton(b[3])}">${esc(b[2])}</p>`,
    bars: (b) => `<div class="bars">${b[2].map((x) => `<div class="bar"><span>${esc(x[0])}</span><i><b style="width:${x[1]}%"></b></i><span>${esc(x[2] ?? x[1] + ' %')}</span></div>`).join('')}</div>`,
    courbe: (b) => {
      const W = 320, H = 120, all = b[2].flatMap((s) => s[2]), max = Math.max(...all) * 1.1 || 1, col = (t) => `var(--${ton(t) || 'accent'})`;
      const pts = (p) => p.map((y, i) => `${(8 + i * (W - 16) / (p.length - 1)).toFixed(1)},${(H - 18 - y / max * (H - 30)).toFixed(1)}`);
      return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(b[1])}">${[0, 1, 2, 3].map((i) => `<line x1="8" x2="${W - 8}" y1="${12 + i * (H - 30) / 3}" y2="${12 + i * (H - 30) / 3}" stroke="var(--line)"/>`).join('')}`
        + b[2].map((s, n) => { const p = pts(s[2]); return (n ? '' : `<polygon points="8,${H - 18} ${p.join(' ')} ${W - 8},${H - 18}" fill="${col(s[1])}" opacity=".14"/>`) + `<polyline points="${p.join(' ')}" fill="none" stroke="${col(s[1])}" stroke-width="2.2" stroke-linejoin="round"/><circle cx="${p.at(-1).split(',')[0]}" cy="${p.at(-1).split(',')[1]}" r="3.5" fill="${col(s[1])}"/>`; }).join('')
        + `<text x="8" y="${H - 4}">il y a 24 h</text><text x="${W - 8}" y="${H - 4}" text-anchor="end">maintenant</text></svg><div class="leg">${b[2].map((s) => `<span><i style="background:${col(s[1])}"></i>${esc(s[0])} · ${s[2].at(-1)} ${esc(b[3] || '')}</span>`).join('')}</div>`;
    },
    form: (b) => `<form class="form" onsubmit="return false">${b[2].map((f, i) => { const id = `f${Math.random().toString(36).slice(2, 8)}${i}`; return f[1] === 'o' ? `<div class="fld"><span class="lab">&nbsp;</span><button type="button" class="sw" role="switch" aria-checked="${f[2] ? 'true' : 'false'}"><span>${esc(f[0])}</span><i></i></button></div>` : `<div class="fld"><label for="${id}">${esc(f[0])}</label>${f[1] === 's' ? `<select id="${id}">${f[2].map((o) => `<option>${esc(o)}</option>`).join('')}</select>` : `<input id="${id}" value="${esc(f[2] ?? '')}">`}</div>`; }).join('')}<div class="fld"><span class="lab">&nbsp;</span><button type="submit" class="btn pri">${esc(b[3] || 'Enregistrer')}</button></div></form>`,
    depot: (b) => `<div class="drop"><span>${esc(b[2])}</span><button type="button" class="btn pri">${esc(b[3] || 'Choisir un fichier')}</button></div>`,
    actions: (b) => `<div class="row">${b[2].map((a, i) => `<button type="button" class="btn${i ? '' : ' pri'}">${esc(a)}</button>`).join('')}</div>`,
    steps: (b) => `<div class="steps">${b[2].map((x, i) => `<div class="st${x[2] ? ' done' : ''}"><span class="n">${x[2] ? '✓' : i + 1}</span><div><b>${esc(x[0])}</b><small>${esc(x[1] || '')}</small></div>${x[2] ? '<span class="pill good">Fait</span>' : '<button type="button" class="btn">Faire</button>'}</div>`).join('')}</div>`,
    graph: (b) => {
      const n = b[2], W = 320, H = 200, cx = W / 2, cy = H / 2;
      const P = n.map((x, i) => i ? [cx + Math.cos(i / (n.length - 1) * 6.283 + 0.5) * (95 + (i % 2) * 34), cy + Math.sin(i / (n.length - 1) * 6.283 + 0.5) * (58 + (i % 2) * 16)] : [cx, cy]);
      return `<svg class="gr" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(b[1])}">${P.slice(1).map((p, i) => `<line x1="${cx}" y1="${cy}" x2="${p[0]}" y2="${p[1]}" stroke="var(--field)" stroke-width="${1 + (i % 3)}"/>`).join('')}${P.slice(2).map((p, i) => i % 2 ? `<line x1="${P[i + 1][0]}" y1="${P[i + 1][1]}" x2="${p[0]}" y2="${p[1]}" stroke="var(--line)" stroke-dasharray="3 3"/>` : '').join('')}`
        + n.map((x, i) => `<circle cx="${P[i][0]}" cy="${P[i][1]}" r="${i ? 7 + (x[2] || 0) : 13}" fill="var(--${ton(x[1]) || (i ? 'accent' : 'mascot')})"/><text x="${P[i][0]}" y="${P[i][1] + (i ? 20 + (x[2] || 0) : 27)}">${esc(x[0])}</text>`).join('') + '</svg>';
    },
    gallery: (b) => `<div class="gal ${b[3] || ''}">${b[2].map((x, i) => `<figure><div class="ph" style="background:${teinte(x[2] ?? i * 47)}">${x[3] ? `<span>${cell(x[3])}</span>` : ''}</div><figcaption>${esc(x[0])}${x[1] ? `<small>${esc(x[1])}</small>` : ''}</figcaption></figure>`).join('')}</div>`,
    player: (b) => `<div class="player"><div class="cov"></div><div><b>${esc(b[2])}</b><div class="muted">${esc(b[3])}</div><div class="trk"><b></b></div></div></div><div class="row"><button type="button" class="btn ico" aria-label="Précédent">${svg('prev')}</button><button type="button" class="btn ico pri" aria-label="Lecture">${svg('play')}</button><button type="button" class="btn ico" aria-label="Suivant">${svg('next')}</button><button type="button" class="btn">${esc(b[5] || 'Salon')}</button></div><div class="list">${b[4].map((x) => `<div class="li"><b>${esc(x[0])}</b><small>${esc(x[1])}</small><span class="m">${esc(x[2])}</span></div>`).join('')}</div>`,
    calendar: (b) => {
      const J = ['Lun 16', 'Mar 17', 'Mer 18', 'Jeu 19', 'Ven 20', 'Sam 21', 'Dim 22'];
      return `<div class="cal"><div class="h"></div>${J.map((j) => `<div class="h">${j}</div>`).join('')}<div class="col hr">${[8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((h, i) => `<span style="top:${i * 33}px">${h} h</span>`).join('')}</div>${J.map((_, d) => `<div class="col">${b[2].filter((e) => e[0] === d).map((e) => `<div class="ev ${ton(e[4])}" style="top:${(e[1] - 8) * 33 + 1}px;height:${e[2] * 33 - 2}px">${esc(e[3])}</div>`).join('')}</div>`).join('')}</div>`
        + `<div class="list agenda">${b[2].map((e) => `<div class="li"><b>${esc(e[3])}</b><small>${J[e[0]]} · ${String(e[1]).replace('.5', ' h 30').replace(/^(\d+)$/, '$1 h')}</small><span class="m">${e[2] * 60} min</span></div>`).join('')}</div>`;
    },
    map: (b) => `<svg class="map" viewBox="0 0 320 190" role="img" aria-label="${esc(b[1])}"><rect width="320" height="190" fill="var(--sel)"/><path d="M96 20c30-12 62 2 70 30 14 6 34 16 30 44-4 26-30 30-38 54-10 22-44 26-58 4-12-20-34-24-34-56 0-34 8-64 30-76z" fill="var(--panel2)" stroke="var(--field)"/><path d="M232 96c12-6 24 2 22 14s-18 16-26 8-6-18 4-22z" fill="var(--panel2)" stroke="var(--field)"/><polyline points="${b[2].map((p) => `${p[1]},${p[2]}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-dasharray="1 0"/>${b[2].map((p) => `<circle cx="${p[1]}" cy="${p[2]}" r="6" fill="var(--accent)" stroke="var(--panel)" stroke-width="2"/><text x="${p[1] + 10}" y="${p[2] + 4}">${esc(p[0])}</text>`).join('')}</svg>`,
    chat: (b) => `<div class="msgs">${b[2].map((m) => `<div class="msg ${m[0]}">${esc(m[1])}${m[2] ? `<small>${esc(m[2])}</small>` : ''}</div>`).join('')}</div><div class="comp"><label class="sr" for="c${b[1].length}">Message</label><input id="c${b[1].length}" placeholder="${esc(b[3] || 'Écris à Odin…')}"><button type="button" class="btn ico" aria-label="Parler">${svg('mic')}</button><button type="button" class="btn ico pri" aria-label="Envoyer">${svg('send')}</button></div>`,
    doc: (b) => `<div class="row">${['G', 'I', 'S', '≡', '•', '1.', 'Lien'].map((x) => `<button type="button" class="btn ico" style="${x === 'Lien' ? 'width:auto;padding:0 12px' : ''}">${x}</button>`).join('')}</div><div class="doc" tabindex="0"><h3>${esc(b[2][0])}</h3>${b[2].slice(1).map((p) => `<p>${esc(p)}</p>`).join('')}</div>`,
    flow: (b) => `<div class="flow">${b[2].map((x, i) => `${i ? `<span class="ar" aria-hidden="true">${svg('arr').replace('<svg', '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"')}</span>` : ''}<div class="nd ${ton(x[2])}"><b>${esc(x[0])}</b><small>${esc(x[1])}</small></div>`).join('')}</div>`,
    score: (b) => `<div class="score"><svg viewBox="0 0 120 120" role="img" aria-label="${esc(b[1])} : ${b[2]} sur 100"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--line)" stroke-width="12"/><circle cx="60" cy="60" r="50" fill="none" stroke="var(--${b[2] >= 75 ? 'good' : b[2] >= 50 ? 'warn' : 'bad'})" stroke-width="12" stroke-linecap="round" stroke-dasharray="${b[2] * 3.14} 314" transform="rotate(-90 60 60)"/><text x="60" y="69" text-anchor="middle">${b[2]}</text></svg><div><b>${esc(b[3])}</b><dl class="kv">${b[4].map((x) => `<dt>${esc(x[0])}</dt><dd>${cell(x[1])}</dd>`).join('')}</dl></div></div>`,
    kv: (b) => `<dl class="kv">${b[2].map((x) => `<dt>${esc(x[0])}</dt><dd>${cell(x[1])}</dd>`).join('')}</dl>`,
    browser: (b) => `<div class="brw"><div class="tb">${b[3].map((t, i) => `<span class="${i ? '' : 'on'}">${esc(t)}</span>`).join('')}</div><div class="ub"><button type="button" class="btn ico" aria-label="Retour">${svg('back')}</button><button type="button" class="btn ico" aria-label="Menu">${svg('dots')}</button><input aria-label="Adresse" value="${esc(b[2])}"><span class="masc" title="Odin"><i></i><i></i></span></div><div class="pgc"><i style="width:55%;height:20px"></i><i style="width:92%"></i><i style="width:84%"></i><i style="width:70%"></i><i style="width:88%"></i><i style="width:40%"></i></div></div>`,
    themes: () => `<div class="thg" role="group" aria-label="Thèmes d'Odin">${D.ordre.map((id) => `<button type="button" data-th="${id}" aria-pressed="${id === S.theme}" style="background:linear-gradient(180deg,${T[id].sky[0]},${T[id].sky[1]})">${decorDe(id)}<span>${esc(T[id].name)}</span></button>`).join('')}</div>`,
    qr: (b) => { let h = 7; const bit = () => ((h = (h * 1103515245 + 12345) & 0x7fffffff) >> 16) & 1; let r = ''; for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) { const coin = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13); const on = coin ? (x % 7 === 0 || x % 7 === 6 || y % 7 === 0 || y % 7 === 6 || (x % 7 > 1 && x % 7 < 5 && y % 7 > 1 && y % 7 < 5)) : bit(); if (on) r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; } return `<div class="qr"><svg viewBox="0 0 21 21" fill="#111" role="img" aria-label="QR code">${r}</svg><div><b>${esc(b[2])}</b><p class="muted" style="margin:6px 0 12px">${esc(b[3] || '')}</p><button type="button" class="btn">Copier le lien</button></div></div>`; },
    apps: (b) => `<div class="apps">${b[2].map((a) => (a[2] ? `<a href="${esc(a[2])}" target="_blank" rel="noopener">` : '<button type="button">') + tuile(a[0], a[1], 's') + `<span>${esc(a[1])}</span>` + (a[2] ? '</a>' : '</button>')).join('')}</div>`,
    liens: (b) => `<div class="apps">${b[2].map((a) => `<button type="button" data-go="${esc(a[0])}"><span class="ic s" style="background:var(--sel);color:var(--ink);box-shadow:none">${esc(a[1].slice(0, 1))}</span><span>${esc(a[1])}</span></button>`).join('')}</div>`,
  };
  const bloc = (b) => { const [k, w] = b[0].split(':'); return `<section class="card surface w${w || 6}"><header><h2>${esc(b[1] || '')}</h2>${b.act ? `<button type="button" class="btn">${esc(b.act)}</button>` : ''}</header>${(R[k] || R.text)(b)}</section>`; };

  // ---------------- L'écran ----------------
  const NAV = D.nav;
  function ecran() {
    const v = vue(), cur = v.nav || v.id, noms = v.tabs ? Object.keys(v.tabs) : [], secs = v.secs ? Object.keys(v.secs) : [];
    const blocs = v.secs ? v.secs[secs[Math.min(S.sec, secs.length - 1)]] : v.tabs[noms[Math.min(S.tab, noms.length - 1)]];
    const side = `<nav class="side" aria-label="Menu d'Odin"><div class="brand"><span class="rune" aria-hidden="true">ᛟ</span><span class="brandtxt">ODIN</span></div><button type="button" class="palbtn" data-toast="Chercher ou faire : la palette s'ouvre ici (Ctrl K).">${svg('search')}<span>Chercher ou faire…</span><kbd>Ctrl K</kbd></button><div class="buddy"><span class="masc" title="Odin"><i></i><i></i></span><span class="buddy-txt">tranquille</span></div>${NAV.map((n) => `<button type="button" class="nav" data-nav="${n.id}" title="${esc(n.label)}"${n.id === cur ? ' aria-current="page"' : ''}>${svg(n.icon)}<span class="lbl">${esc(n.label)}</span></button>`).join('')}<span class="sp"></span><div class="foot">Odin 1.36 · à jour</div></nav>`;
    const bnav = `<nav class="bnav" aria-label="Menu d'Odin">${NAV.filter((n) => n.bas).map((n) => `<button type="button" data-nav="${n.id}"${n.id === cur ? ' aria-current="page"' : ''}>${svg(n.icon)}<span>${esc(n.court || n.label)}</span></button>`).join('')}</nav>`;
    const head = `<div class="head surface">${v.app ? `<button type="button" class="btn ico" data-toast="Retour à la liste des applis." aria-label="Retour aux applis">${svg('back')}</button>` : `<span class="masc" title="Odin"><i></i><i></i></span>`}<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:center">${v.app ? tuile(v.id, v.name) : '<span></span>'}<div><h1>${esc(v.name)}</h1><div class="sub">${esc(v.what || '')}</div></div></div><div class="acts">${v.primary ? `<button type="button" class="btn pri txt">${esc(v.primary)}</button>` : ''}<button type="button" class="btn ico" aria-label="Autres actions"${v.primary ? ` title="${esc(v.primary)} et autres actions"` : ''}>${svg('dots')}</button></div></div>`;
    const src = v.from && v.from.length ? `<div class="src surface"><b>Reprend</b>${v.from.map((f) => `<span class="chip">${esc(f)}</span>`).join('')}</div>` : '';
    const tabs = noms.length > 1 ? `<div class="tabs surface" role="tablist" aria-label="Onglets">${noms.map((n, i) => `<button type="button" role="tab" data-tab="${i}" aria-selected="${i === Math.min(S.tab, noms.length - 1)}">${esc(n)}</button>`).join('')}</div>` : '';
    const kpis = v.kpis && v.kpis.length && !(v.secs) && S.tab === 0 ? `<div class="kpis">${v.kpis.map((k) => { const [l, x, t] = k.split('|'); return `<div class="kpi surface ${ton(t)}"><span>${esc(l)}</span><b>${esc(x)}</b></div>`; }).join('')}</div>` : '';
    const corps = `<div class="body" tabindex="0">${kpis}<div class="grid">${blocs.map(bloc).join('')}</div></div>`;
    const milieu = v.secs ? `<div class="split"><div class="rubs surface" role="tablist" aria-label="Rubriques">${secs.map((n, i) => `<button type="button" role="tab" data-sec="${i}" aria-selected="${i === S.sec}">${esc(n)}</button>`).join('')}</div>${corps}</div>` : corps;
    return `<div class="decor">${decorDe(S.theme)}</div><div class="voile"></div><div class="shell">${side}<div class="main">${head}${src}${tabs}${milieu}</div>${bnav}</div>`;
  }

  // ---------------- Le banc d'essai ----------------
  const scene = $('#scene'), banc = $('#banc');
  function toast(t) { document.querySelector('.toast')?.remove(); const e = document.createElement('div'); e.className = 'toast'; e.setAttribute('role', 'status'); e.textContent = t; document.body.append(e); setTimeout(() => e.remove(), 2600); }
  function peindre() {
    const [W, H] = DEVS[S.dev], ok = mesures(S.theme).every((m) => m.apres >= m.min), avant = mesures(S.theme).filter((m) => m.avant < m.min).length;
    const groupes = [['Classique', D.ordre.filter((i) => i.startsWith('valhalla'))], ['Thèmes', D.ordre.filter((i) => !i.startsWith('valhalla') && !i.startsWith('ev-'))], ['Événements', D.ordre.filter((i) => i.startsWith('ev-'))]];
    banc.innerHTML = `<div class="banc-l"><h1>${esc(D.titre)}</h1><small>${D.ordre.length} thèmes</small></div><div class="banc-r"><div class="bseg" role="group" aria-label="Taille d'écran">${Object.entries(DEVS).map(([k, d]) => `<button type="button" data-dev="${k}" aria-pressed="${k === S.dev}">${d[2]}</button>`).join('')}</div><div class="bth"><button type="button" class="bbtn" data-pas="-1" aria-label="Thème précédent">‹</button><select class="bsel" id="selTheme" aria-label="Thème">${groupes.map(([g, ids]) => `<optgroup label="${g}">${ids.map((i) => `<option value="${i}"${i === S.theme ? ' selected' : ''}>${esc(T[i].name)}</option>`).join('')}</optgroup>`).join('')}</select><button type="button" class="bbtn" data-pas="1" aria-label="Thème suivant">›</button></div><button type="button" class="bbtn" id="btnPlanche" aria-pressed="${S.planche}">Planche</button><button type="button" class="bbtn ${ok ? 'ok' : 'ko'}" id="btnRapport" aria-pressed="${S.rapport}">${ok ? 'Lisible ✓' : 'À revoir'}</button><button type="button" class="bbtn" id="btnAuto" title="Fait défiler tous les thèmes">Défiler</button></div>`;
    $('#rapport').hidden = !S.rapport;
    if (S.rapport) $('#rapport').innerHTML = `<p><b>${esc(T[S.theme].name)}</b> : contraste du texte sur les panneaux (il faut 4,5 pour du texte, 3 pour un bord). ${avant ? `${avant} couleur(s) du thème d'origine étaient trop pâles : la maquette les corrige, la colonne « proposé » montre le résultat.` : 'Rien à corriger dans ce thème.'}</p><table><thead><tr><th>Couleur</th><th>Aujourd'hui</th><th>Proposé</th><th>Minimum</th></tr></thead><tbody>${mesures(S.theme).map((m) => `<tr><td>${m.nom}</td><td>${m.avant.toFixed(1)}${m.avant < m.min ? ' ✗' : ''}</td><td>${m.apres.toFixed(1)}${m.apres < m.min ? ' ✗' : ' ✓'}</td><td>${m.min}</td></tr>`).join('')}</tbody></table>`;
    if (S.planche) {
      scene.className = 'planche'; const html = ecran();
      scene.innerHTML = D.ordre.map((id) => `<figure><div class="mini" role="button" tabindex="0" data-th="${id}" aria-label="Thème ${esc(T[id].name)}"><div class="dev" data-dark="${T[id].dark ? 1 : 0}" style="${cssDe(id)};width:${W}px;height:${H}px">${html.replace(/<div class="decor">.*?<\/div><div class="voile">/s, `<div class="decor">${decorDe(id)}</div><div class="voile">`)}</div></div><figcaption>${esc(T[id].name)}</figcaption></figure>`).join('');
      for (const m of scene.querySelectorAll('.mini')) { const s = m.clientWidth / W; m.style.height = `${H * s}px`; m.firstElementChild.style.transform = `scale(${s})`; }
      return;
    }
    scene.className = 'scene';
    const dispo = scene.clientWidth - 32, s = Math.min(1, dispo / W);
    scene.innerHTML = `<div class="fit" style="width:${W * s}px;height:${H * s}px"><div class="dev" id="dev" data-dark="${T[S.theme].dark ? 1 : 0}" style="${cssDe(S.theme)};width:${W}px;height:${H}px;transform:scale(${s});transform-origin:top left">${ecran()}</div></div>`;
  }
  let defile;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button,[data-th]'); if (!b) return;
    const d = b.dataset;
    if (d.dev) { S.dev = d.dev; note('dev', S.dev); }
    else if (d.pas) { const i = D.ordre.indexOf(S.theme); S.theme = D.ordre[(i + Number(d.pas) + D.ordre.length) % D.ordre.length]; note('theme', S.theme); }
    else if (d.th) { S.theme = d.th; S.planche = false; note('theme', S.theme); }
    else if (b.id === 'btnPlanche') S.planche = !S.planche;
    else if (b.id === 'btnRapport') S.rapport = !S.rapport;
    else if (b.id === 'btnAuto') { if (defile) { clearInterval(defile); defile = 0; toast('Défilement arrêté.'); } else { toast('Un thème toutes les 2 secondes. Touche « Défiler » pour arrêter.'); defile = setInterval(() => { const i = D.ordre.indexOf(S.theme); S.theme = D.ordre[(i + 1) % D.ordre.length]; peindre(); }, 2000); } return; }
    else if (d.tab) S.tab = Number(d.tab);
    else if (d.sec) S.sec = Number(d.sec);
    else if (d.nav || d.go) { const id = d.nav || d.go, v = D.views.find((x) => x.id === id); if (v) { S.view = id; S.tab = 0; S.sec = 0; } else { const n = NAV.find((x) => x.id === id); toast(n && n.msg ? n.msg : `Cette maquette montre ${vue().name}. Le reste d'Odin est dans la maquette « Interface d'Odin ».`); return; } }
    else if (d.toast) { toast(d.toast); return; }
    else if (b.getAttribute('role') === 'switch') { b.setAttribute('aria-checked', b.getAttribute('aria-checked') === 'true' ? 'false' : 'true'); return; }
    else return;
    peindre();
  });
  document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('mini')) { e.preventDefault(); e.target.click(); } });
  document.addEventListener('change', (e) => { if (e.target.id === 'selTheme') { S.theme = e.target.value; note('theme', S.theme); peindre(); } });
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(peindre, 120); });
  peindre();

  // ---------------- Contrôle automatique (ouvert avec #controle par tools/maquettes/verifier.mjs) ----------------
  // Sur chaque taille d'écran, chaque vue, chaque onglet : rien ne dépasse en largeur, et tous les boutons,
  // onglets et champs ont la même hauteur.
  if (location.hash === '#controle') {
    const pb = [];
    for (const dev of Object.keys(DEVS)) for (const v of D.views) {
      const n = v.secs ? Object.keys(v.secs).length : Object.keys(v.tabs).length;
      for (let i = 0; i < n; i++) {
        S.dev = dev; S.view = v.id; S.tab = v.secs ? 0 : i; S.sec = v.secs ? i : 0; S.planche = false; peindre();
        const d = $('#dev'), ou = `${dev} · ${v.name} · ${i + 1}`, W = DEVS[dev][0];
        for (const el of d.querySelectorAll('.body,.main,.card,.head,.tabs,.kpis')) if (el.scrollWidth > el.clientWidth + 1) pb.push(`${ou} : dépasse en largeur (${el.className.split(' ')[0]}, ${el.scrollWidth} > ${el.clientWidth})`);
        for (const el of d.querySelectorAll('.card,.kpi,.btn,.tabs button')) { const r = el.getBoundingClientRect(), r0 = d.getBoundingClientRect(), s = r0.width / W; if ((r.right - r0.left) / s > W + 1) pb.push(`${ou} : sort de l'écran (${el.className})`); }
        const hs = new Set([...d.querySelectorAll('.btn,.tabs button,.fld input,.fld select,.sw,.comp input,.rubs button,.nav,.palbtn')].filter((el) => el.offsetParent).map((el) => el.offsetHeight));
        if (hs.size > 1) pb.push(`${ou} : hauteurs différentes (${[...hs].join(', ')} px)`);
        const lk = new Set([...d.querySelectorAll('.kpi')].map((el) => el.offsetHeight)); if (lk.size > 1) pb.push(`${ou} : chiffres clés de hauteurs différentes (${[...lk].join(', ')})`);
      }
    }
    const pre = document.createElement('pre'); pre.id = 'controle'; pre.textContent = JSON.stringify(pb); document.body.append(pre);
  }
})();
