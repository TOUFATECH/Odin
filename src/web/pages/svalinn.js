// Svalinn dans l'interface (maquettes validées « Svalinn · Wi-Fi de la maison » et « Régler la box »), dans le thème
// de la fenêtre d'Odin : cartes en verre, carte principale turquoise, onglets Wi-Fi · Box · Appareils.
// Tout ce qui change la box passe par ton accord (une boîte de confirmation dit exactement quoi) ; la box est
// sauvegardée avant, et le retour automatique remet l'ancien réglage si le Wi-Fi ne revient pas.
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const post = async (action, input = {}, confirm = false) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'svalinn', action, input, confirm }) })).json();
  /** Une action : si elle est grave, ton accord d'abord (la phrase dit exactement ce qui va changer). */
  const act = async (action, input = {}) => { let r = await post(action, input); if (r.confirm) { if (!confirm(`${r.confirm}\n\nLa box est sauvegardée juste avant ; si le Wi-Fi ne revient pas, l'ancien réglage revient tout seul.`)) return { ok: false, text: 'Annulé.' }; r = await post(action, input, true); } return r; };
  const P = {
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', wifi: 'M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01', router: 'M4 14h16v6H4zM8 17h.01M12 17h.01M7 14l3-6M17 14l-3-6',
    speed: 'M12 14l4-4M4 18a9 9 0 1 1 16 0', alert: 'M12 3 2 20h20zM12 10v4M12 17h.01', users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
    flow: 'M3 12h4l3-8 4 16 3-8h4', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', key: 'M14 10a4 4 0 1 0-4 4l-7 7M7 17l2 2M10 14l2 2', undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
    qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3z', check: 'M5 12l5 5L20 7', phone: 'M7 2h10v20H7zM11 18h2', pc: 'M3 4h18v12H3zM8 20h8M12 16v4', tv: 'M3 5h18v12H3zM8 21h8',
    print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z', plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4', save: 'M5 3h11l3 3v15H5zM8 3v6h8M8 21v-7h8v7', arrow: 'M5 12h14M13 6l6 6-6 6', refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  };
  const ic = (n, s = 16) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };
  const CSS = `
.sv{--sa:#0b7f7c;--sok:#1f9d55;--sbad:#e5484d;--swarn:#d97706;display:flex;flex-direction:column;gap:14px}
.sv-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.sv-top h2{margin:0;font-size:24px;font-weight:800;letter-spacing:-.3px}.sv-top p{margin:2px 0 0;color:var(--muted);font-size:13.5px}
.sv-tabs{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap}.sv-tabs button{min-height:36px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 85%,transparent);color:var(--ink);font:600 13.5px inherit;display:inline-flex;align-items:center;gap:7px;cursor:pointer}
.sv-tabs button[aria-selected=true]{background:var(--sa);color:#fff;border-color:transparent}
.sv-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}@media (max-width:1100px){.sv-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (max-width:700px){.sv-grid{grid-template-columns:minmax(0,1fr)}.sv-w{grid-column:auto!important}}
.sv-w{background:color-mix(in srgb,var(--panel) 88%,transparent);backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:22px;padding:16px 18px;min-width:0;box-shadow:0 10px 26px rgba(16,54,58,.08)}
.sv-w.hero{background:linear-gradient(135deg,#0b7f7c,#0f9a8f);color:#fff;border-color:transparent}
.sv-h{display:flex;align-items:center;gap:10px;margin:0 0 10px}.sv-h .ib{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:color-mix(in srgb,var(--sa) 12%,transparent);color:var(--sa);flex:none}
.sv-w.hero .sv-h .ib{background:rgba(255,255,255,.22);color:#fff}
.sv-h small{display:block;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--sa);font-weight:700}.sv-w.hero .sv-h small{color:#fff;opacity:.9}.sv-h b{font-size:15px}.sv-h .x{margin-left:auto;font-size:12.5px;color:var(--muted)}
.sv-big{display:flex;align-items:baseline;gap:8px}.sv-big b{font-size:34px;letter-spacing:-.5px}.sv-big span{opacity:.75;font-size:13.5px}
.sv-bar{height:7px;border-radius:4px;background:rgba(255,255,255,.3);margin-top:12px;overflow:hidden}.sv-bar i{display:block;height:100%;background:#fff;border-radius:4px}
.sv-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line);min-height:44px}.sv-row:first-of-type{border-top:0}
.sv-row .t{display:flex;flex-direction:column;min-width:0;flex:1}.sv-row .t b{font-size:13.5px;font-weight:600}.sv-row .t span{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sv-dot{width:9px;height:9px;border-radius:50%;flex:none}
.sv-lv{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;flex:none}
.sv-pill{min-height:34px;padding:0 14px;border-radius:999px;border:0;font:600 13px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.sv-pill.pri{background:var(--sa);color:#fff}.sv-pill.bad{background:var(--sbad);color:#fff}.sv-pill.soft{background:color-mix(in srgb,var(--sa) 12%,transparent);color:var(--sa)}.sv-pill.n{background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink)}
.sv-sw{position:relative;width:44px;height:26px;border-radius:13px;border:0;background:color-mix(in srgb,var(--ink) 18%,transparent);cursor:pointer;flex:none;padding:0}.sv-sw::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.sv-sw[aria-checked=true]{background:var(--sa)}.sv-sw[aria-checked=true]::after{left:21px}.sv-sw:disabled{opacity:.5;cursor:default}
.sv-bars{display:flex;gap:4px;height:96px;align-items:flex-end}.sv-bars i{flex:1;border-radius:4px 4px 2px 2px;background:linear-gradient(180deg,#0f9a8f,#0b7f7c);min-height:3px}
.sv-axis{display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-top:6px}
.sv-ch{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin:4px 0}.sv-ch span{padding:9px 11px;border-radius:10px;font-size:13px;background:color-mix(in srgb,var(--ink) 6%,transparent)}.sv-ch span.new{background:color-mix(in srgb,var(--sok) 14%,transparent);color:var(--sok);font-weight:600}
.sv-form{display:flex;flex-direction:column;gap:8px}.sv-form label{font-size:12.5px;color:var(--muted)}.sv-form input,.sv-form select{min-height:38px;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 10px;font:inherit}
.sv-out{font-size:13px;white-space:pre-wrap;color:var(--muted);margin:8px 0 0}
.sv-tips{display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:1.45}.sv-tips div{display:flex;gap:8px}.sv-tips i{width:7px;height:7px;border-radius:50%;background:var(--sa);margin-top:6px;flex:none}
`;
  const S = { tab: 'wifi', busy: false };
  const LV = { urgent: ['#e5484d', 'alert'], important: ['#d97706', 'lock'], conseil: ['#0b7f7c', 'wifi'], 'à vérifier': ['#64748b', 'shield'] };
  const head = (icon, app, title, extra) => el('div', { class: 'sv-h' }, el('span', { class: 'ib' }, ic(icon, 17)), el('div', {}, el('small', {}, app), el('b', {}, title)), extra ?? null);
  const sw = (on, label, onchange, disabled) => el('button', { class: 'sv-sw', type: 'button', role: 'switch', 'aria-checked': String(Boolean(on)), 'aria-label': label, disabled: Boolean(disabled), onclick: (e) => onchange(!on, e.currentTarget) });
  const devIcon = (d) => (/phone|iphone|android|galaxy|pixel|tél/i.test(d.name) ? 'phone' : /tv|télé|tele|chromecast/i.test(d.name) ? 'tv' : /print|imprim|hp\b|epson|canon/i.test(d.name) ? 'print' : /prise|plug|tasmota|shelly/i.test(d.name) ? 'plug' : 'pc');
  const quality = (s) => (s === undefined ? ['', ''] : s >= -55 ? ['excellent', '#1f9d55'] : s >= -67 ? ['bon', '#1f9d55'] : s >= -75 ? ['faible', '#d97706'] : ['à placer', '#e5484d']);
  const when = (iso) => { if (!iso) return '—'; const d = new Date(iso.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, 'T$1:$2:$3.$4Z')); return isNaN(d) ? iso : d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

  async function draw(root, redraw) {
    const r = await post('resume'); const D = r.data ?? {}; const e = D.etat, box = e?.box, devs = (D.devices ?? []).filter((d) => d.active);
    const run = async (btn, action, input) => { if (btn) btn.disabled = true; const x = await act(action, input); if (btn) btn.disabled = false; if (x.text && x.text !== 'Annulé.') window.OdinNotices?.local?.({ title: x.text.split('\n')[0].slice(0, 160), level: x.ok === false ? 'souci' : 'ok', kind: 'Svalinn', app: 'Svalinn' }); if (x.ok !== false) await redraw(); return x; };
    const urgent = (e?.fixes ?? []).filter((f) => f.level === 'urgent').length;
    root.append(el('div', { class: 'sv-top' }, el('div', {}, el('h2', {}, S.tab === 'box' ? 'Régler la box' : S.tab === 'appareils' ? 'Appareils de la maison' : 'Wi-Fi de la maison'),
      el('p', {}, S.tab === 'box' ? 'chaque changement est sauvegardé avant et annulable' : `${devs.length} appareil${devs.length > 1 ? 's' : ''}${e ? ` · ${urgent} urgent${urgent > 1 ? 's' : ''}` : ''} · rien ne change sans ton accord`)),
      el('div', { class: 'sv-tabs', role: 'tablist' }, ...[['wifi', 'wifi', 'Wi-Fi'], ['box', 'router', 'Box'], ['appareils', 'users', 'Appareils']].map(([id, i, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(S.tab === id), onclick: () => { S.tab = id; redraw(); } }, ic(i, 15), t)),
        el('button', { type: 'button', title: 'Relire le Wi-Fi et la box', onclick: async (ev) => { ev.currentTarget.disabled = true; await post('etat'); await redraw(); } }, ic('refresh', 15), 'Analyser'))));
    const grid = el('div', { class: 'sv-grid' }); root.append(grid);
    if (!e && S.tab !== 'box') { grid.append(el('div', { class: 'sv-w', style: 'grid-column:1/-1' }, head('shield', 'Svalinn · sécurité', 'Pas encore analysé'), el('p', { style: 'margin:0 0 10px;color:var(--muted);font-size:13.5px' }, 'Odin regarde le Wi-Fi autour, la box et ce qui est ouvert, puis te donne une note et ce qu\'il faut corriger. Rien n\'est changé.'), el('button', { class: 'sv-pill pri', type: 'button', onclick: async (ev) => { ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Analyse…'; await post('etat'); await redraw(); } }, ic('shield', 14), 'Analyser le Wi-Fi'))); return; }

    if (S.tab === 'wifi') {
      grid.append(el('div', { class: 'sv-w hero' }, head('shield', 'Svalinn · sécurité', 'Note du Wi-Fi'), el('div', { class: 'sv-big' }, el('b', {}, String(e.note)), el('span', {}, `/100 · ${e.verdict}`)), el('div', { class: 'sv-bar', role: 'progressbar', 'aria-valuenow': String(e.note), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Note du Wi-Fi' }, el('i', { style: `width:${e.note}%` })), el('p', { style: 'margin:10px 0 0;font-size:12px;opacity:.85' }, e.source)));
      const vaps = (box?.vaps ?? []).filter((v) => !v.guest), nets = vaps.length ? [...new Set(vaps.map((v) => v.ssid))].map((ssid) => ({ ssid, bands: vaps.filter((v) => v.ssid === ssid).map((v) => v.band).filter(Boolean).join(' · '), on: vaps.some((v) => v.ssid === ssid && v.enabled !== false) })) : e.mine ? [{ ssid: e.mine.ssid, bands: `canal ${e.mine.chan}`, on: true }] : [];
      grid.append(el('div', { class: 'sv-w' }, head('wifi', 'Svalinn · Wi-Fi', 'Réseaux'),
        ...nets.map((n) => el('div', { class: 'sv-row' }, el('span', { class: 'sv-dot', style: 'background:var(--sa)' }), el('div', { class: 't' }, el('b', {}, n.ssid || '(caché)'), el('span', {}, `${n.bands}${devs.filter((d) => d.wifi).length ? ` · ${devs.filter((d) => d.wifi).length} appareils` : ''}`)), sw(n.on, `Wi-Fi ${n.ssid}`, () => {}, true))),
        box ? el('div', { class: 'sv-row' }, el('span', { class: 'sv-dot', style: 'background:var(--sok)' }), el('div', { class: 't' }, el('b', {}, D.invites?.ssid || 'Invités'), el('span', {}, 'Internet seulement')), sw(box.guest, 'Wi-Fi invités', (v, b) => run(b, 'invites', { allume: v }))) : null,
        nets.length ? null : el('p', { style: 'margin:0;color:var(--muted);font-size:13px' }, 'Relie la box (onglet Box) pour voir et régler tes réseaux.')));
      const sp = el('div', { class: 'sv-w' }, head('speed', 'Svalinn · box', 'Débit'), el('div', { class: 'sv-big' }, el('b', {}, e.debit ? String(e.debit.mbps) : '—'), el('span', {}, `Mb/s${e.debit ? ` · ${when(e.debit.at)}` : ''}`)),
        el('button', { class: 'sv-pill soft', type: 'button', style: 'margin-top:10px', onclick: async (ev) => { const b = ev.currentTarget; b.disabled = true; b.textContent = 'Mesure…'; await post('tester_debit'); await redraw(); } }, ic('speed', 14), 'Tester la vitesse'));
      grid.append(sp);
      const fixes = e.fixes ?? [];
      grid.append(el('div', { class: 'sv-w', style: 'grid-column:span 2' }, head('alert', 'Svalinn · sécurité', 'À corriger', el('span', { class: 'x' }, 'le plus urgent en premier')),
        ...fixes.map((f) => { const [c, i] = LV[f.level] ?? LV.conseil; return el('div', { class: 'sv-row' }, el('span', { class: 'sv-lv', style: `background:${c}1f;color:${c}` }, ic(i, 15)), el('div', { class: 't' }, el('b', {}, f.title), el('span', {}, f.detail)),
          f.change ? el('button', { class: `sv-pill ${f.level === 'urgent' ? 'bad' : 'soft'}`, type: 'button', onclick: (ev) => run(ev.currentTarget, 'corriger', { correction: f.id }) }, f.button) : el('span', { style: `font-size:12px;color:${c};font-weight:600` }, f.level)); }),
        fixes.length ? null : el('p', { style: 'margin:0;color:var(--sok);font-weight:600;font-size:13.5px' }, '✓ Rien à corriger.'),
        fixes.some((f) => f.change && f.change.kind !== 'mot_de_passe') ? el('button', { class: 'sv-pill pri', type: 'button', style: 'margin-top:10px', onclick: (ev) => run(ev.currentTarget, 'tout_corriger') }, ic('shield', 14), 'Tout corriger avec Odin') : null));
      grid.append(devCard(devs.slice(0, 6), devs.length));
      const h = D.heures ?? [], mx = Math.max(1, ...h);
      grid.append(el('div', { class: 'sv-w', style: 'grid-column:span 2' }, head('flow', 'Svalinn · historique', 'Appareils sur 24 h'), el('div', { class: 'sv-bars', role: 'img', 'aria-label': `Appareils connectés par heure, au plus ${Math.max(0, ...h)}` }, ...h.map((n) => el('i', { style: `height:${Math.round((n / mx) * 100)}%`, title: `${n} appareil${n > 1 ? 's' : ''}` }))),
        el('div', { class: 'sv-axis' }, el('span', {}, '−24 h'), el('span', {}, '−18 h'), el('span', {}, '−12 h'), el('span', {}, '−6 h'), el('span', {}, 'maintenant'))));
      const ch = e.facts?.channel;
      grid.append(el('div', { class: 'sv-w' }, head('wifi', 'Odin', 'Conseils'), el('div', { class: 'sv-tips' }, ...[ch ? `Canal ${ch.now} : ${ch.voisins} voisin${ch.voisins > 1 ? 's' : ''} dessus ; le ${ch.best} est le plus libre.` : null, 'Box en hauteur, au centre, loin du micro-ondes.', 'Wi-Fi invités pour les visiteurs.', 'Change le mot de passe si quelqu\'un part.'].filter(Boolean).map((t) => el('div', {}, el('i'), el('span', {}, t))))));
    } else if (S.tab === 'appareils') {
      grid.append(devCard(devs, devs.length, true));
    } else {
      const b = D.box;
      grid.append(el('div', { class: 'sv-w hero' }, head('router', 'Svalinn · box', box ? (box.model && box.model.toLowerCase().includes(box.brand.toLowerCase()) ? box.model : `${box.brand}${box.model ? ` · ${box.model}` : ''}`) : b ? 'Box' : 'Box non reliée'),
        el('div', { class: 'sv-big' }, el('b', { style: 'font-size:28px' }, b?.host ?? e?.gateway ?? '—')), el('p', { style: 'margin:8px 0 0;font-size:13px;opacity:.9' }, box ? `${box.firmware ? `logiciel ${box.firmware}` : 'à jour'}${D.sauvegarde ? ` · sauvegardée ${when(D.sauvegarde)}` : ''}` : b ? (b.marque === 'livebox' ? 'mot de passe à donner pour la piloter' : 'Odin te guide écran par écran') : 'donne son adresse et son mot de passe ci-dessous')));
      if (box) {
        grid.append(el('div', { class: 'sv-w' }, head('wifi', 'Svalinn · box', 'Radios'), ...box.radios.map((r) => el('div', { class: 'sv-row' }, el('div', { class: 't' }, el('b', {}, r.band), el('span', {}, `canal ${r.channel ?? '?'}${r.auto ? ' (automatique)' : ''}`)), sw(true, `Radio ${r.band}`, () => {}, true))),
          el('div', { class: 'sv-row' }, el('div', { class: 't' }, el('b', {}, 'UPnP'), el('span', {}, box.upnp ? 'ouvert' : 'coupé, plus sûr')), sw(box.upnp, 'UPnP', (v, bt) => run(bt, 'corriger', { correction: 'upnp' }), !box.upnp))));
      }
      grid.append(el('div', { class: 'sv-w' }, head('undo', 'Svalinn · sécurité', 'Retour automatique'), el('div', { style: 'display:flex;align-items:center;gap:10px' }, el('span', { style: 'font-size:13px;line-height:1.45;flex:1' }, 'Si tes appareils en Wi-Fi ne reviennent pas 3 minutes après un changement, l\'ancien réglage revient tout seul.'), sw(D.retour, 'Retour automatique', (v, bt) => run(bt, 'regler', { retour: v }))),
        D.annulable ? el('button', { class: 'sv-pill n', type: 'button', style: 'margin-top:10px', onclick: (ev) => run(ev.currentTarget, 'annuler') }, ic('undo', 14), `Annuler : ${D.annulable}`) : null));
      const f = (e?.fixes ?? []).find((x) => x.change && x.change.kind !== 'mot_de_passe');
      if (f) {
        const c = f.change, before = c.kind === 'wps' ? ['WPS activé', 'désactivé'] : c.kind === 'securite' ? [`Chiffrement ${e.facts.security ?? '?'}`, c.mode === 'WPA3' ? 'WPA3' : 'WPA2/WPA3 mixte'] : c.kind === 'canal' ? [`Canal 2,4 GHz : ${e.facts.channel?.now ?? '?'}`, String(c.chan)] : c.kind === 'upnp' ? ['UPnP ouvert', 'coupé'] : c.kind === 'distance' ? ['Accès à distance ouvert', 'fermé'] : [f.title, f.button];
        grid.append(el('div', { class: 'sv-w', style: 'grid-column:span 2' }, head('lock', 'Svalinn · changement proposé', f.title),
          el('div', { class: 'sv-ch' }, el('span', {}, before[0]), ic('arrow', 14), el('span', { class: 'new' }, before[1])),
          el('p', { style: 'font-size:13px;line-height:1.45;color:var(--muted);margin:10px 0' }, box ? `Le Wi-Fi peut couper environ 1 minute. Tes ${devs.filter((d) => d.wifi).length || ''} appareils reviennent seuls ; sinon, retour automatique.` : 'Ta box n\'est pas pilotée par Odin : il te donne les étapes, puis revérifie.'),
          el('div', { style: 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap' }, el('button', { class: 'sv-pill n', type: 'button', onclick: () => { S.tab = 'wifi'; redraw(); } }, 'Plus tard'), el('button', { class: 'sv-pill pri', type: 'button', onclick: (ev) => run(ev.currentTarget, 'corriger', { correction: f.id }) }, ic('check', 14), box ? 'Appliquer avec mon accord' : 'Me guider'))));
      }
      const host = el('input', { id: 'svHost', value: b?.host ?? e?.gateway ?? '192.168.1.1' }), brand = el('select', { id: 'svBrand' }, el('option', { value: 'livebox', selected: (b?.marque ?? 'livebox') === 'livebox' }, 'Livebox (Orange)'), el('option', { value: 'autre', selected: b?.marque === 'autre' }, 'Autre box (guidée)')), user = el('input', { id: 'svUser', value: b?.utilisateur ?? 'admin' }), pw = el('input', { id: 'svPw', type: 'password', autocomplete: 'off', placeholder: b?.motDePasse ? '•••••••• (dans le coffre)' : 'mot de passe d\'administration' });
      const out = el('p', { class: 'sv-out', role: 'status' });
      grid.append(el('div', { class: 'sv-w' }, head('key', 'Svalinn · coffre', 'Accès à la box'),
        b ? el('div', {}, el('div', { class: 'sv-row' }, ic('router', 15), el('div', { class: 't' }, el('b', {}, 'Adresse')), el('b', { style: 'font-size:13px' }, b.host)), el('div', { class: 'sv-row' }, ic('key', 15), el('div', { class: 't' }, el('b', {}, 'Mot de passe')), el('b', { style: 'font-size:13px' }, b.motDePasse ? '••••••••' : 'non donné')), el('div', { class: 'sv-row' }, ic('save', 15), el('div', { class: 't' }, el('b', {}, 'Sauvegarde')), el('b', { style: 'font-size:13px;color:var(--sok)' }, D.sauvegarde ? when(D.sauvegarde) : '—'))) : null,
        el('details', { open: !b }, el('summary', { style: 'cursor:pointer;min-height:36px;font-size:13px;color:var(--sa);font-weight:600' }, b ? 'Changer' : 'Relier la box'),
          el('form', { class: 'sv-form', onsubmit: async (ev) => { ev.preventDefault(); out.textContent = 'Connexion…'; const x = await post('relier_box', { adresse: host.value, marque: brand.value, utilisateur: user.value, mot_de_passe: pw.value }); pw.value = ''; out.textContent = x.text; if (x.ok !== false) { await post('etat'); await redraw(); } } },
            el('label', { for: 'svHost' }, 'Adresse'), host, el('label', { for: 'svBrand' }, 'Marque'), brand, el('label', { for: 'svUser' }, 'Utilisateur'), user, el('label', { for: 'svPw' }, 'Mot de passe'), pw, el('button', { class: 'sv-pill pri', type: 'submit' }, 'Relier'))), out,
        el('p', { style: 'font-size:12.5px;color:var(--muted);line-height:1.45;margin:8px 0 0' }, 'Mot de passe dans le coffre, jamais affiché. Sans lui, Odin ne force rien : il te guide écran par écran.')));
      const qrBox = el('div', {}), gname = el('input', { id: 'svGn', value: D.invites?.ssid ?? '', placeholder: 'Maison-Invités' }), gpw = el('input', { id: 'svGp', type: 'password', autocomplete: 'off', placeholder: D.invites?.motDePasse ? '•••••••• (gardé)' : 'mot de passe du Wi-Fi invités' });
      grid.append(el('div', { class: 'sv-w', style: 'grid-column:span 2' }, head('qr', 'Svalinn · invités', 'Wi-Fi invités', box ? el('span', { style: 'margin-left:auto' }, sw(box.guest, 'Wi-Fi invités', (v, bt) => run(bt, 'invites', { allume: v }))) : null),
        el('div', { style: 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap' }, qrBox,
          el('div', { style: 'display:flex;flex-direction:column;gap:6px;flex:1;min-width:220px' }, el('b', {}, D.invites?.ssid || 'Pas encore réglé'), el('span', { style: 'font-size:12.5px;color:var(--muted)' }, 'Internet seulement : ni tes PC, ni tes caméras.'),
            el('form', { class: 'sv-form', onsubmit: async (ev) => { ev.preventDefault(); await post('regler', { invites_nom: gname.value, invites_mdp: gpw.value, retour: D.retour }); gpw.value = ''; await redraw(); } }, el('label', { for: 'svGn' }, 'Nom'), gname, el('label', { for: 'svGp' }, 'Mot de passe'), gpw, el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, el('button', { class: 'sv-pill soft', type: 'submit' }, 'Enregistrer'),
              D.invites?.ssid ? el('button', { class: 'sv-pill n', type: 'button', onclick: async () => { const x = await post('qr_invites'); if (x.data?.svg) { const img = el('img', { src: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(x.data.svg)))}`, alt: x.data.alt, width: '132', height: '132', style: 'border-radius:12px;background:#fff;padding:6px' }); qrBox.replaceChildren(img); } } }, ic('qr', 14), 'Montrer le QR code') : null))))));
    }
  }
  function devCard(list, total, all) {
    return el('div', { class: 'sv-w', style: all ? 'grid-column:1/-1' : '' }, el('div', { class: 'sv-h' }, el('span', { class: 'ib' }, ic('users', 17)), el('div', {}, el('small', {}, 'Svalinn · appareils'), el('b', {}, 'Connectés')), el('span', { class: 'x' }, String(total))),
      ...list.map((d) => { const [q, c] = quality(d.signal); return el('div', { class: 'sv-row' }, el('span', { class: 'sv-lv', style: 'background:color-mix(in srgb,var(--ink) 6%,transparent)' }, ic(devIcon(d), 15)), el('div', { class: 't' }, el('b', {}, d.name), el('span', {}, [d.ip, d.band ?? (d.wifi ? 'Wi-Fi' : 'câble')].filter(Boolean).join(' · '))), q ? el('span', { style: `font-size:12.5px;font-weight:600;color:${c}` }, q) : null); }),
      list.length ? null : el('p', { style: 'margin:0;color:var(--muted);font-size:13px' }, 'Aucun appareil vu pour l\'instant.'));
  }

  window.OdinPages.svalinn = async ({ host }) => {
    if (!document.getElementById('svCss')) document.head.append(el('style', { id: 'svCss' }, CSS));
    const root = el('div', { class: 'sv' }); host.append(root);
    const redraw = async () => { const n = el('div', { class: 'sv' }); await draw(n, redraw); root.replaceChildren(...n.childNodes); };
    await redraw();
  };
})();
