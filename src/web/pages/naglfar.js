// Argo dans l'interface : en haut, chaque service mis à l'échelle (maquette validée « Mise à l'échelle automatique
// et base de données d'Odin ») — copies prêtes, visiteurs, processeur, budget de la machine, la journée en courbe
// (visiteurs et copies), ce que le moteur a fait, les copies une à une, la base de données d'Odin. Dessous : le reste
// de Argo (conteneurs, images…), comme avant. Régler et Arrêter passent par les actions de Argo (Arrêter = accord).
(() => {
  'use strict';
  window.OdinPages = window.OdinPages || {};
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const post = async (module, action, input = {}, confirm = false) => (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module, action, input, confirm }) })).json();
  const act = async (module, action, input) => { let r = await post(module, action, input); if (r.confirm) { if (!confirm(r.confirm)) return { ok: false, text: 'Annulé.' }; r = await post(module, action, input, true); } return r; };
  const BLUE = '#5b8def', GREEN = '#34c77b', ORANGE = '#f0a020';
  const CSS = `
.ec{display:flex;flex-direction:column;gap:14px;margin:0 0 18px}
.ec-top{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}.ec-top h2{margin:0;font-size:24px;font-weight:800;letter-spacing:-.3px}.ec-top p{margin:3px 0 0;color:var(--muted);font-size:13.5px}
.ec-top .acts{margin-left:auto;display:flex;gap:8px}
.ec-svcs{display:flex;gap:6px;flex-wrap:wrap}.ec-svcs button{min-height:34px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13px inherit;cursor:pointer}.ec-svcs button[aria-pressed=true]{background:var(--ink);color:var(--bg)}
.ec-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}@media (max-width:1000px){.ec-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ec-k{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:12px 14px}.ec-k small{display:block;font-size:12.5px;color:var(--muted)}.ec-k b{display:block;font-size:26px;letter-spacing:-.4px;margin:2px 0}.ec-k span{font-size:12px;color:var(--muted)}
.ec-row{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:14px;align-items:start}@media (max-width:1100px){.ec-row{grid-template-columns:minmax(0,1fr)}}
.ec-c{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px 16px;min-width:0}.ec-c h3{margin:0 0 8px;font-size:15px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ec-c h3 .lg{margin-left:auto;display:flex;gap:14px;font-size:12px;font-weight:500;color:var(--muted)}.ec-c h3 .lg i{display:inline-block;width:14px;height:3px;border-radius:2px;vertical-align:middle;margin-right:5px}
.ec-ev{display:flex;gap:12px;padding:8px 0;border-top:1px solid var(--line);font-size:13px}.ec-ev:first-of-type{border-top:0}.ec-ev time{color:var(--muted);font-variant-numeric:tabular-nums;flex:none}
.ec-t{width:100%;border-collapse:collapse}.ec-t th{text-align:left;font-size:12px;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line)}.ec-t td{padding:9px 10px;border-bottom:1px solid var(--line);font-size:13px;font-variant-numeric:tabular-nums}
.ec-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.ec-chip{display:inline-flex;align-items:center;min-height:26px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;margin:0 6px 6px 0}
.ec-say{display:flex;align-items:center;gap:12px}.ec-say p{margin:0;background:color-mix(in srgb,${BLUE} 14%,var(--panel));border:1px solid color-mix(in srgb,${BLUE} 30%,transparent);border-radius:14px;padding:10px 14px;font-size:13.5px}
.ec-say .odin{width:40px;height:40px;flex:none}
`;
  const S = { svc: '' };
  const fmt = (n) => Number(n).toLocaleString('fr-FR');
  const hm = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const gb = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : `${Math.round(b / 1024 ** 2)} Mo`);
  /** La journée : visiteurs en même temps (courbe bleue) et copies (marches vertes), de minuit à maintenant. */
  function chart(hist, max) {
    const W = 900, H = 230, P = { l: 6, r: 6, t: 18, b: 22 }, day = new Date(); day.setHours(0, 0, 0, 0);
    const pts = hist.filter((h) => Date.parse(h.at) >= day.getTime());
    const x = (t) => P.l + ((t - day.getTime()) / 864e5) * (W - P.l - P.r), vmax = Math.max(10, ...pts.map((p) => p.active)) * 1.15;
    const yv = (v) => H - P.b - (v / vmax) * (H - P.t - P.b), yc = (c) => H - P.b - (c / Math.max(1, max)) * (H - P.t - P.b) * 0.8;
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', '100%'); svg.setAttribute('role', 'img');
    const peak = pts.reduce((a, p) => (p.active > (a?.active ?? -1) ? p : a), undefined);
    svg.setAttribute('aria-label', `Aujourd'hui : ${pts.length ? `au plus ${peak.active} visiteurs en même temps à ${hm(peak.at)}` : 'pas encore de mesure'}`);
    let g = '';
    for (let i = 1; i < 4; i++) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${P.t + i * (H - P.t - P.b) / 4}" y2="${P.t + i * (H - P.t - P.b) / 4}" stroke="currentColor" stroke-opacity=".08"/>`;
    for (let hh = 0; hh <= 24; hh += 3) g += `<text x="${x(day.getTime() + hh * 36e5)}" y="${H - 5}" font-size="11" fill="currentColor" fill-opacity=".55" text-anchor="${hh === 0 ? 'start' : hh === 24 ? 'end' : 'middle'}">${String(hh).padStart(2, '0')} h</text>`;
    if (pts.length > 1) {
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(Date.parse(p.at)).toFixed(1)} ${yv(p.active).toFixed(1)}`).join(' ');
      g += `<path d="${line} L${x(Date.parse(pts.at(-1).at)).toFixed(1)} ${H - P.b} L${x(Date.parse(pts[0].at)).toFixed(1)} ${H - P.b}Z" fill="${BLUE}" fill-opacity=".14"/><path d="${line}" fill="none" stroke="${BLUE}" stroke-width="2.5" stroke-linejoin="round"/>`;
      const steps = pts.map((p, i) => { const X = x(Date.parse(p.at)).toFixed(1), Y = yc(p.copies).toFixed(1); return i ? `H${X} V${Y}` : `M${X} ${Y}`; }).join(' ');
      g += `<path d="${steps}" fill="none" stroke="${GREEN}" stroke-width="2.5"/>`;
      if (peak) { const X = x(Date.parse(peak.at)); g += `<line x1="${X}" x2="${X}" y1="${P.t}" y2="${H - P.b}" stroke="${ORANGE}" stroke-dasharray="3 4"/><text x="${Math.min(X + 6, W - 170)}" y="${P.t - 4}" font-size="12" font-weight="700" fill="${ORANGE}">pic ${hm(peak.at)} · ${fmt(peak.active)} visiteurs</text>`; }
    } else g += `<text x="${W / 2}" y="${H / 2}" font-size="13" fill="currentColor" fill-opacity=".55" text-anchor="middle">La courbe se remplit au fil de la journée.</text>`;
    svg.innerHTML = g; return svg;
  }
  const odinFace = () => { const t = document.querySelector('#buddy svg'); const s = el('span', { class: 'odin', 'aria-hidden': 'true' }); if (t) { const c = t.cloneNode(true); c.querySelectorAll('[id]').forEach((e) => { const o = e.id; e.id = `${o}-ec`; c.querySelectorAll('*').forEach((x) => { for (const a of ['fill', 'filter']) if (x.getAttribute(a) === `url(#${o})`) x.setAttribute(a, `url(#${o}-ec)`); }); }); s.append(c); } return s; };

  window.OdinPages.naglfar = async ({ host, generic, reload }) => {
    const r = await post('naglfar', 'services'); const list = r.data ?? [];
    if (!list.length) return false; // pas de service mis à l'échelle : la page de Argo comme avant
    if (!document.getElementById('ecCss')) document.head.append(el('style', { id: 'ecCss' }, CSS));
    if (!list.some((x) => x.spec.name === S.svc)) S.svc = list[0].spec.name;
    const { spec: sp, state: st, budget: bu } = list.find((x) => x.spec.name === S.svc);
    const ready = st.replicas.filter((x) => x.healthy && !x.draining).length, starting = st.replicas.filter((x) => !x.healthy && !x.draining).length;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const hToday = st.history.filter((h) => Date.parse(h.at) >= today.getTime()), peak = hToday.reduce((a, h) => (h.active > (a?.active ?? -1) ? h : a), undefined);
    const cpu = st.replicas.length ? Math.round(st.replicas.reduce((k, x) => k + x.cpu, 0) / st.replicas.length) : 0;
    const root = el('div', { class: 'ec' });
    root.append(el('div', { class: 'ec-top' }, el('div', {}, el('h2', {}, `Argo · ${sp.name}`), el('p', {}, `Mise à l'échelle automatique : de ${sp.scale.min} à ${sp.scale.max} copies selon les visiteurs, le processeur et la mémoire${sp.ports[0] ? ` · port ${sp.ports[0].host}` : ''} · ${sp.per.cpus} cœur${Number(sp.per.cpus) > 1 ? 's' : ''} et ${sp.per.memory} par copie`)),
      el('div', { class: 'acts' }, el('button', { class: 'btn small', type: 'button', onclick: () => { const d = document.querySelector('#v-app details summary'); const det = [...document.querySelectorAll('#v-app details')].find((x) => /Régler la mise à l'échelle/.test(x.textContent)); if (det) { det.open = true; det.scrollIntoView({ behavior: 'smooth', block: 'center' }); const f = det.querySelector('input'); if (f) { f.value = sp.name; f.focus(); } } void d; } }, 'Régler'),
        el('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; const x = await act('naglfar', 'arreter_service', { service: sp.name }); if (x.ok !== false) reload(); else e.currentTarget.disabled = false; } }, 'Arrêter'))));
    if (list.length > 1) root.append(el('div', { class: 'ec-svcs', role: 'group', 'aria-label': 'Services' }, ...list.map((x) => el('button', { type: 'button', 'aria-pressed': String(x.spec.name === S.svc), onclick: () => { S.svc = x.spec.name; reload(); } }, x.spec.name))));
    const k = (label, value, sub, color) => el('div', { class: 'ec-k' }, el('small', {}, label), el('b', { style: color ? `color:${color}` : '' }, value), el('span', {}, sub));
    const over = bu.usedCpus / bu.cpus > 0.85;
    root.append(el('div', { class: 'ec-kpis' }, k('Copies prêtes', `${ready} / ${st.want}`, starting ? `${starting} démarre` : st.status, GREEN), k('Visiteurs en ce moment', fmt(st.active), `${fmt(Math.round(st.rate))} nouveaux / s`),
      k('Visiteurs aujourd\'hui', fmt(st.total), peak ? `pic ${fmt(peak.active)} à ${hm(peak.at)}` : '—'), k('Processeur moyen', `${cpu} %`, `visé : ${sp.scale.cpu ?? 70} %`),
      k('Budget machine', `${bu.usedCpus.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} / ${bu.cpus.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} cœurs`, `${sp.budgetPct} % de la machine au plus · ${gb(bu.usedMemory)} / ${gb(bu.memory)}`, over ? '#e5484d' : ORANGE)));
    root.append(el('div', { class: 'ec-row' },
      el('div', { class: 'ec-c' }, el('h3', {}, 'Aujourd\'hui · visiteurs et copies', el('span', { class: 'lg' }, el('span', {}, el('i', { style: `background:${BLUE}` }), 'visiteurs en même temps'), el('span', {}, el('i', { style: `background:${GREEN}` }), `copies (${sp.scale.min} à ${sp.scale.max})`))), chart(st.history, sp.scale.max)),
      el('div', { class: 'ec-c' }, el('h3', {}, 'Ce que le moteur a fait'), ...st.events.slice(-8).reverse().map((e) => el('div', { class: 'ec-ev' }, el('time', {}, hm(e.at)), el('span', {}, e.text))), st.events.length ? null : el('p', { class: 'sub' }, 'Rien encore.'))));
    const stateOf = (x) => (x.draining ? ['se retire', '#94a3b8'] : x.healthy ? ['prête', GREEN] : ['démarre', ORANGE]);
    const pg = await post('urdr', 'bases').catch(() => ({})), base = (pg.data ?? []).find((b) => b.conteneur === 'odin-pg');
    root.append(el('div', { class: 'ec-row' },
      el('div', { class: 'ec-c' }, el('h3', {}, 'Les copies'), el('table', { class: 'ec-t' }, el('thead', {}, el('tr', {}, ...['Copie', 'Adresse', 'État', 'Processeur', 'Mémoire', 'Visiteurs'].map((h) => el('th', {}, h)))),
        el('tbody', {}, ...st.replicas.map((x) => { const [t, c] = stateOf(x); return el('tr', {}, el('td', {}, el('b', {}, x.name)), el('td', {}, x.ip ?? '—'), el('td', { style: `color:${c}` }, el('span', { class: 'ec-dot', style: `background:${c}` }), t), el('td', {}, `${Math.round(x.cpu)} %`), el('td', {}, `${Math.round(x.mem)} %`), el('td', {}, fmt(x.conns))); })))),
      el('div', { class: 'ec-c' }, el('h3', {}, 'Base de données d\'Odin'), el('p', { class: 'sub', style: 'margin:0 0 8px' }, base ? `odin-pg · PostgreSQL${base.version ? ` ${base.version}` : ''} · adresse fixe, jamais publiée dehors` : 'odin-pg · créée à la première appli qui a besoin d\'une base'),
        el('div', {}, el('span', { class: 'ec-chip', style: `background:${GREEN}22;color:${GREEN}` }, 'grandit tout seul'), el('span', { class: 'ec-chip', style: `background:${BLUE}22;color:${BLUE}` }, '500 connexions au plus'), el('span', { class: 'ec-chip', style: `background:${GREEN}22;color:${GREEN}` }, 'sauvegardée chaque nuit (Arche)')),
        el('p', { style: 'margin:4px 0 0;font-size:13.5px;line-height:1.5' }, 'Chaque appli a sa base et son compte. Mémoire +25 % si elle dépasse 85 %, +½ cœur si le processeur sature, sans arrêt ; elle redescend après 30 min de calme.'))));
    const last = st.events.at(-1);
    root.append(el('div', { class: 'ec-say' }, odinFace(), el('p', {}, `${last ? `${last.text}. ` : ''}${st.reason ? `${st.reason}. ` : ''}${bu.room > 0 ? `Il reste de la place pour ${bu.room} copie${bu.room > 1 ? 's' : ''} de plus dans le budget de la machine.` : 'Le budget de la machine est atteint : augmente-le dans « Régler » si besoin.'}`)));
    host.append(root);
    // Le reste de Argo, dessous.
    host.append(...generic);
  };
})();
