// Rán dans l'interface : les paquets réseau d'une machine, comme Wireshark. Sous la fiche d'une machine (carte
// de la Maison) et sur la page de l'appli Rán (avec un champ pour l'adresse IP) :
// - « En direct » : les paquets arrivent au fil de l'eau (de nouveau un clic : arrêt) ;
// - l'historique en dessous : les paquets gardés (7 jours), filtrables, avec les correspondants et les services ;
// - « Enregistrer en continu » : l'historique se remplit même quand la page est fermée.
(() => {
  'use strict';
  if (window.OdinPackets) return;
  const el = (t, a = {}, ...kids) => { const n = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); } for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k))); return n; };
  const get = async (p) => (await fetch(p, { headers: { 'x-odin': '1' } })).json();
  const post = async (p, b) => (await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(b) })).json();
  const time = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const day = (t) => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const size = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1).replace('.', ',')} Mo` : b >= 1e3 ? `${Math.round(b / 1e3)} ko` : `${b} o`);
  const css = `
.pk{background:var(--panel);border:1px solid var(--line);border-radius:var(--r,14px);padding:16px;margin-top:16px;box-shadow:var(--shadow)}
.pk h2{font-size:16px;margin:0 0 4px}.pk .sub{font-size:13px}
.pk-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.pk-bar input{flex:1 1 180px;min-height:38px;padding:0 12px;border-radius:10px;border:1px solid var(--field);background:var(--panel2);color:inherit}
.pk-live[aria-pressed="true"]{background:var(--bad-bg,#3a1d1d);border-color:var(--bad,#e66);color:var(--bad,#e66)}
.pk-live[aria-pressed="true"]::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;animation:pkb 1s ease-in-out infinite}
@keyframes pkb{50%{opacity:.25}}@media (prefers-reduced-motion:reduce){.pk-live::before{animation:none}}
.pk-note{font-size:13px;padding:8px 12px;border-radius:10px;background:var(--warn-bg);border:1px solid var(--warn-l);margin:6px 0}
.pk-note.ok{background:transparent;border-color:var(--good-l)}.pk-note.bad{background:var(--bad-bg);border-color:var(--bad-l)}
.pk-sum{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}.pk-sum span{font-size:12.5px;padding:3px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}.pk-sum b{color:var(--ink)}
.pk-tw{max-height:460px;overflow:auto;border:1px solid var(--line);border-radius:10px}
.pk table{width:100%;border-collapse:collapse;font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.pk th{position:sticky;top:0;background:var(--panel2);text-align:left;font-weight:600;color:var(--dim);padding:6px 8px;border-bottom:1px solid var(--line);font-family:var(--body,system-ui)}
.pk td{padding:4px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.pk td.i{white-space:normal;min-width:140px}
.pk tr.in td:nth-child(2){color:var(--good)}.pk tr.out td:nth-child(2){color:var(--accent)}.pk tr.new{animation:pkn 1.2s ease-out}
@keyframes pkn{from{background:color-mix(in srgb,var(--accent) 22%,transparent)}}
.pk tr.p-TCP td:nth-child(3){color:#6FA8DC}.pk tr.p-UDP td:nth-child(3){color:#93C47D}.pk tr.p-ARP td:nth-child(3){color:#E6C04A}.pk tr.p-ICMP td:nth-child(3){color:#E0607E}
@media (max-width:860px){.pk td:nth-child(6),.pk th:nth-child(6){display:none}}`;
  const panels = new Map(); // ip → panneau (gardé : le direct continue quand la fiche se redessine)

  function panel(ip, o = {}) {
    if (!document.getElementById('pkCss')) document.head.append(el('style', { id: 'pkCss' }, css));
    if (panels.has(ip)) return panels.get(ip).node;
    let es = null, rows = [], q = '', recording = false, liveCount = 0;
    const note = el('div', { class: 'pk-note', hidden: true, role: 'status' });
    const live = el('button', { class: 'btn small pk-live', type: 'button', 'aria-pressed': 'false', onclick: () => (es ? stop() : start()) }, 'En direct');
    const rec = el('button', { class: 'btn small', type: 'button', onclick: () => toggleRec() }, 'Enregistrer en continu');
    const filt = el('input', { type: 'search', placeholder: 'Filtrer : protocole, port, adresse, service (dns, 443, tcp…)', 'aria-label': 'Filtrer les paquets' });
    const sum = el('div', { class: 'pk-sum' }), head = el('div', { class: 'sub' }, 'Chargement…');
    const tbody = el('tbody');
    const table = el('div', { class: 'pk-tw', tabindex: '0', role: 'region', 'aria-label': `Paquets de ${ip}` }, el('table', {}, el('thead', {}, el('tr', {}, ...['Heure', 'Sens', 'Protocole', 'Source', 'Destination', 'Taille', 'Info'].map((h) => el('th', { scope: 'col' }, h)))), tbody));
    const node = el('section', { class: 'pk', 'aria-label': `Paquets réseau de ${ip}` },
      el('h2', {}, `📡 Paquets réseau — ${ip}`), head, el('div', { class: 'pk-bar' }, live, rec, filt, el('button', { class: 'btn small', type: 'button', onclick: () => load() }, 'Actualiser')), note, sum, table);
    const match = (p) => !q || `${p.proto} ${p.src} ${p.dst} ${p.sport ?? ''} ${p.dport ?? ''} ${p.info}`.toLowerCase().includes(q);
    const tr = (p, fresh) => el('tr', { class: `${p.dir === 'entrant' ? 'in' : p.dir === 'sortant' ? 'out' : ''} p-${p.proto.replace(/v6$/, '')}${fresh ? ' new' : ''}` },
      el('td', {}, time(p.at)), el('td', { title: p.dir }, p.dir === 'entrant' ? '→ reçu' : p.dir === 'sortant' ? '← envoyé' : '·'), el('td', {}, p.proto),
      el('td', {}, `${p.src}${p.sport != null ? `:${p.sport}` : ''}`), el('td', {}, `${p.dst}${p.dport != null ? `:${p.dport}` : ''}`), el('td', {}, size(p.len)), el('td', { class: 'i' }, p.info || ''));
    const paint = () => { const list = rows.filter(match).slice(0, 500); tbody.replaceChildren(...(list.length ? list.map((p) => tr(p)) : [el('tr', {}, el('td', { colspan: '7', class: 'i' }, es ? 'En attente des premiers paquets…' : 'Aucun paquet gardé. Touche « En direct » pour voir passer les paquets, ou « Enregistrer en continu ».'))])); };
    const say = (t, kind = '') => { note.hidden = !t; note.className = `pk-note ${kind}`; note.textContent = t || ''; };
    async function load() {
      const r = await get(`/api/ran/history?ip=${encodeURIComponent(ip)}&n=500&q=${encodeURIComponent(q)}`).catch(() => null);
      if (!node.isConnected && !o.keep) return;
      if (!r?.ok) { head.textContent = r?.error || 'Historique indisponible.'; return; }
      rows = r.packets; recording = r.recording;
      rec.textContent = recording ? '⏺ Enregistrement continu : arrêter' : 'Enregistrer en continu';
      head.textContent = r.total ? `Historique : ${r.total} paquet(s), du ${day(r.first)} au ${day(r.last)} (gardé 7 jours).` : 'Pas encore d\'historique pour cette machine.';
      if (!es) say(r.access ? `Capture sur la machine elle-même (accès « ${r.access.machine} ») : tout son trafic.` : 'Capture depuis la machine d\'Odin : sur un réseau avec switch ou box, seuls les échanges avec Odin et ce que la machine diffuse à tout le réseau sont visibles. Pour tout voir, donne à Odin l\'accès à cette machine (Réglages → Droits et machines).', r.access ? 'ok' : '');
      sum.replaceChildren(...r.peers.slice(0, 6).map((p) => el('span', {}, 'avec ', el('b', {}, p.host), ` · ${p.n} paquet(s) · ${size(p.bytes || 0)}`)), ...r.protos.slice(0, 6).map((p) => el('span', {}, el('b', {}, p.proto), ` ${p.n}`)));
      paint();
    }
    function start() {
      if (es) return;
      liveCount = 0; live.setAttribute('aria-pressed', 'true'); live.textContent = 'En direct · arrêter';
      es = new EventSource(`/api/ran/live?ip=${encodeURIComponent(ip)}`);
      es.addEventListener('start', (e) => { const d = JSON.parse(e.data); if (d.error) { say(d.error, 'bad'); stop(); return; } say(d.where === 'machine' ? `En direct sur ${d.machine} : tout son trafic.` : 'En direct depuis la machine d\'Odin (échanges avec Odin et diffusions sur le réseau).', 'ok'); paint(); });
      es.addEventListener('packets', (e) => {
        const list = JSON.parse(e.data).reverse(); liveCount += list.length;
        rows = [...list, ...rows].slice(0, 2000);
        const fresh = list.filter(match);
        if (fresh.length && tbody.firstChild && !tbody.firstChild.querySelector('[colspan]')) { for (const p of fresh.slice(0, 200).reverse()) tbody.prepend(tr(p, true)); while (tbody.children.length > 500) tbody.lastChild.remove(); } else paint();
        head.textContent = `En direct : ${liveCount} paquet(s) reçu(s).`;
      });
      es.addEventListener('status', (e) => { const d = JSON.parse(e.data); say(d.text, 'bad'); });
      es.onerror = () => { if (es && es.readyState === EventSource.CLOSED) stop(); };
    }
    function stop() { if (es) { es.close(); es = null; } live.setAttribute('aria-pressed', 'false'); live.textContent = 'En direct'; load(); }
    async function toggleRec() {
      rec.disabled = true;
      const r = await post('/api/valhalla/act', { module: 'ran', action: recording ? 'arreter' : 'enregistrer', input: { ip } }).catch(() => null);
      rec.disabled = false; if (r) say(r.text || r.error || '', r.ok === false ? 'bad' : 'ok'); load();
    }
    let t = 0; filt.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = filt.value.trim().toLowerCase(); if (es) paint(); else load(); }, 250); });
    // Le direct s'arrête quand on quitte la page (le panneau n'est plus affiché)
    const watch = setInterval(() => { if (!node.isConnected || !node.offsetParent) { if (es) stop(); if (!node.isConnected) { clearInterval(watch); panels.delete(ip); } } }, 2000);
    panels.set(ip, { node, stop });
    load(); if (o.live) start();
    return node;
  }
  /** Page de l'appli Rán : un champ pour l'adresse IP, puis le panneau de cette machine. */
  function finder(ipInit = '') {
    const box = el('div', {});
    const inp = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Adresse IP de la machine (ex. 192.168.1.20)', 'aria-label': 'Adresse IP de la machine', value: ipInit, style: 'flex:1 1 220px;min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--field);background:var(--panel2);color:inherit' });
    const err = el('div', { class: 'sub', role: 'alert' });
    const go = (live) => { const ip = inp.value.trim(); if (!/^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i.test(ip)) { err.textContent = 'Adresse IP invalide.'; return; } err.textContent = ''; for (const [k, p] of panels) if (k !== ip) p.stop(); slot.replaceChildren(panel(ip, { live })); };
    const slot = el('div', {});
    box.append(el('form', { class: 'pk-bar', onsubmit: (e) => { e.preventDefault(); go(false); } }, inp, el('button', { class: 'btn small primary', type: 'submit' }, 'Voir l\'historique'), el('button', { class: 'btn small', type: 'button', onclick: () => go(true) }, 'En direct')), err, slot);
    if (ipInit) go(false);
    return box;
  }
  window.OdinPackets = { panel, finder };
})();
