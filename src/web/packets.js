// Rán dans l'interface : l'analyseur de paquets, comme Wireshark, en trois étages.
// 1. La carte : les machines du réseau et les sites d'Internet, reliés par des flèches (de qui vers qui ;
//    épaisseur = volume). Touche une machine : ses communications ; touche une flèche : les paquets de ce lien.
// 2. Les communications (avec qui, dans quel sens, quelles applis, quels sites) et la liste des paquets.
// 3. Le paquet en entier : ce qui se passe en clair, chaque couche (OSI) avec tous ses champs, le contenu brut.
// « Lire les paquets » lance la lecture (et la garde en route) ; « Pause » arrête toute lecture. Odin explique
// tout ce qu'on voit (bouton 🦉) : la conversation s'ouvre dans sa bulle.
(() => {
  'use strict';
  if (window.OdinPackets) return;
  const el = (t, a = {}, ...kids) => { const n = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); } for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k))); return n; };
  const get = async (p) => (await fetch(p, { headers: { 'x-odin': '1' } })).json();
  const post = async (p, b) => (await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(b) })).json();
  const time = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const day = (t) => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const size = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1).replace('.', ',')} Mo` : b >= 1e3 ? `${Math.round(b / 1e3)} ko` : `${b} o`);
  const isPriv = (a) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fe80:|fc|fd|::1$)/i.test(a);
  const isCast = (a) => /^(224\.|239\.|255\.255\.255\.255|ff0)/i.test(a) || /\.255$/.test(a);
  const OSI = { 1: 'Physique', 2: 'Liaison', 3: 'Réseau', 4: 'Transport', 5: 'Session', 6: 'Présentation / chiffrement', 7: 'Application' };
  const PCOL = { DNS: '#E6C04A', mDNS: '#E6C04A', LLMNR: '#E6C04A', HTTP: '#57C98A', TLS: '#6FA8DC', QUIC: '#6FA8DC', HTTPS: '#6FA8DC', TCP: '#9AB0C4', UDP: '#93C47D', ARP: '#E3833F', ICMP: '#E0607E', ICMPv6: '#E0607E', DHCP: '#C46BD6', SSDP: '#5BB8B0', SSH: '#9C8CE0', NTP: '#B7C35A' };
  const css = `
.rn{display:grid;gap:14px;margin-top:14px}
.rn-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r,14px);padding:14px 16px;box-shadow:var(--shadow);min-width:0}
.rn-card h2{font-size:16px;margin:0 0 6px}.rn-card h3{font-size:14px;margin:0 0 8px}
.rn-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.rn-bar input,.rn-bar select{min-height:38px;padding:0 10px;border-radius:10px;border:1px solid var(--field);background:var(--panel2);color:inherit}.rn-bar input[type=search]{flex:1 1 220px}
.rn-go{font-weight:700}.rn-go.on{border-color:var(--good);color:var(--good)}.rn-go.on::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:currentColor;margin-right:6px;animation:rnb 1s infinite}
.rn-pause.on{background:var(--warn-bg);border-color:var(--warn-l)}
@keyframes rnb{50%{opacity:.2}}@media (prefers-reduced-motion:reduce){.rn-go.on::before{animation:none}}
.rn-note{font-size:13px;padding:8px 12px;border-radius:10px;border:1px solid var(--line);color:var(--dim);margin-top:8px}.rn-note.bad{background:var(--bad-bg);border-color:var(--bad-l);color:inherit}.rn-note[hidden]{display:none}
.rn-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.rn-chips button{font-size:12.5px;padding:3px 9px;border-radius:999px;border:1px solid var(--line);background:none;color:var(--muted);cursor:pointer}.rn-chips b{color:var(--ink)}
.rn-two{display:grid;grid-template-columns:minmax(260px,360px) minmax(0,1fr);gap:14px}
.rn-com{display:flex;flex-direction:column;gap:6px;max-height:520px;overflow:auto}
.rn-peer{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit}
.rn-peer:hover,.rn-peer.on{border-color:var(--accent)}.rn-peer .ar{font-size:18px;grid-row:span 2;align-self:center}.rn-peer small{color:var(--muted);font-size:12px;grid-column:2}
.rn-tw{max-height:520px;overflow:auto;border:1px solid var(--line);border-radius:10px}
.rn table{width:100%;border-collapse:collapse;font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.rn th{position:sticky;top:0;background:var(--panel2);text-align:left;font:600 12px var(--body,system-ui);color:var(--dim);padding:6px 8px;border-bottom:1px solid var(--line);z-index:1}
.rn td{padding:4px 8px;border-bottom:1px solid var(--line);white-space:nowrap;cursor:pointer}.rn td.i{white-space:normal;min-width:180px}
.rn tbody tr:hover{background:var(--panel2)}.rn tbody tr.on{background:color-mix(in srgb,var(--accent) 18%,transparent)}.rn tr.new{animation:rnn 1.2s ease-out}@keyframes rnn{from{background:color-mix(in srgb,var(--accent) 25%,transparent)}}
.rn .pp{font-weight:700}
.rn-det{display:grid;gap:10px}.rn-det[hidden]{display:none}.rn-story{font-size:14.5px;line-height:1.55;padding:10px 12px;border-left:4px solid var(--accent);background:var(--panel2);border-radius:0 10px 10px 0}
.rn-det details{border:1px solid var(--line);border-radius:10px;padding:0 10px}.rn-det summary{cursor:pointer;min-height:38px;display:flex;align-items:center;gap:8px;font-weight:600}
.rn-det summary .o{font:600 11px var(--body,system-ui);color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:1px 6px;flex:none}
.rn-det dl{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:3px 12px;margin:0 0 10px;font-size:13px}.rn-det dt{color:var(--muted)}.rn-det dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap;font-family:ui-monospace,monospace}
.rn-hex{font:12px/1.45 ui-monospace,monospace;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px;overflow:auto;max-height:340px;margin:0 0 10px}
@media (max-width:980px){.rn-two{grid-template-columns:1fr}.rn td:nth-child(6),.rn th:nth-child(6),.rn td:nth-child(1),.rn th:nth-child(1){display:none}}`;

  const studios = new Map();
  /** L'analyseur : ip = une machine (sa fiche), sinon tout le réseau (page de l'appli Rán). */
  function studio(o = {}) {
    if (!document.getElementById('rnCss')) document.head.append(el('style', { id: 'rnCss' }, css));
    const scope = o.ip || '';
    if (studios.has(scope)) return studios.get(scope).node;
    let es = null, period = 3600e3, q = '', sel = scope || '', peer = '', rows = [], flowsData = { flows: [], names: {} }, graph = null, paused = false, reading = false, detailId = 0, sources = [];
    const devs = () => (window.OdinDevices?.() || []).filter((d) => d.status !== 'removed');
    const nameOf = (a) => { const d = devs().find((x) => x.ip === a); return d ? (d.label || d.hostname || a) : flowsData.names[a] || (isCast(a) ? 'diffusion' : a); };
    const who = (a) => { const n = nameOf(a); return n && n !== a ? `${n} (${a})` : a; };

    // ---------- barre ----------
    const go = el('button', { class: 'btn small rn-go', type: 'button', onclick: () => startReading() }, '▶ Lire les paquets');
    const pause = el('button', { class: 'btn small rn-pause', type: 'button', onclick: () => pauseAll() }, '⏸ Pause');
    const filt = el('input', { type: 'search', placeholder: 'Filtrer : appli, site, protocole, port, adresse (dns, youtube, 443, 192.168.1.20…)', 'aria-label': 'Filtrer les paquets' });
    const per = el('select', { 'aria-label': 'Période' }, ...[[900e3, '15 dernières minutes'], [3600e3, 'Dernière heure'], [86400e3, '24 heures'], [7 * 86400e3, '7 jours']].map(([v, l]) => el('option', { value: v, selected: v === period }, l)));
    const ask = el('button', { class: 'btn small', type: 'button', onclick: () => explainAll() }, '🦉 Odin, explique');
    const all = el('button', { class: 'btn small', type: 'button', hidden: true, onclick: () => { sel = scope; peer = ''; drawMap(); paintCom(); loadPackets(); paintBack(); } }, scope ? '← Cette machine' : '← Tout le réseau');
    const paintBack = () => { all.hidden = !((sel && sel !== scope) || peer); };
    const note = el('div', { class: 'rn-note', role: 'status', hidden: true });
    const chips = el('div', { class: 'rn-chips' });
    const head = el('div', { class: 'sub' });
    const top = el('section', { class: 'rn-card' }, el('h2', {}, scope ? `📡 Paquets réseau — ${who(scope)}` : '📡 Paquets de tout le réseau'), head, el('div', { class: 'rn-bar', style: 'margin-top:8px' }, go, pause, per, ask, all), el('div', { class: 'rn-bar', style: 'margin-top:8px' }, filt), note, chips);

    // ---------- carte ----------
    const mapBox = el('div', {});
    const mapCard = el('section', { class: 'rn-card' }, el('h3', {}, 'Qui parle à qui'), el('div', { class: 'sub', style: 'margin:-4px 0 8px' }, 'Touche une machine : ses communications. Touche une flèche : les paquets de ce lien. Bleu : Internet ; vert : diffusion à tout le réseau ; gris : hors ligne.'), mapBox);

    // ---------- communications + paquets ----------
    const comTitle = el('h3', {}), com = el('div', { class: 'rn-com' });
    const tbody = el('tbody'), listTitle = el('h3', {});
    const table = el('div', { class: 'rn-tw', tabindex: '0', role: 'region', 'aria-label': 'Paquets' }, el('table', {}, el('thead', {}, el('tr', {}, ...['N°', 'Heure', 'Source', 'Destination', 'Appli · site', 'Taille', 'Ce qui se passe'].map((h) => el('th', { scope: 'col' }, h)))), tbody));
    const det = el('section', { class: 'rn-card rn-det', hidden: true, 'aria-live': 'polite' });
    const node = el('div', { class: 'rn' }, top, mapCard, el('div', { class: 'rn-two' }, el('section', { class: 'rn-card' }, comTitle, com), el('section', { class: 'rn-card' }, listTitle, table)), det);

    const say = (t, bad) => { note.textContent = t || ''; note.hidden = !t; note.className = `rn-note${bad ? ' bad' : ''}`; };
    const paintButtons = () => { const on = reading && !paused; go.classList.toggle('on', on); go.textContent = on ? 'Lecture en cours' : '▶ Lire les paquets'; pause.classList.toggle('on', paused); pause.textContent = paused ? '⏸ En pause' : '⏸ Pause'; go.setAttribute('aria-pressed', String(on)); pause.setAttribute('aria-pressed', String(paused)); };

    // ---------- carte : machines, sites et flèches ----------
    function drawMap() {
      if (!window.OdinGraph) return;
      const flows = flowsData.flows || [];
      const pairs = new Map();
      for (const f of flows) {
        const a = f.src < f.dst ? f.src : f.dst, b = a === f.src ? f.dst : f.src, k = `${a}|${b}`;
        const p = pairs.get(k) || { a, b, ab: 0, ba: 0, bytes: 0, apps: new Set(), site: '' };
        if (f.src === a) p.ab += f.n; else p.ba += f.n; p.bytes += f.bytes; f.apps.forEach((x) => p.apps.add(x)); p.site ||= f.site; pairs.set(k, p);
      }
      const hosts = new Set(); for (const p of pairs.values()) { hosts.add(p.a); hosts.add(p.b); }
      // Tout le réseau : toutes les machines connues apparaissent, même silencieuses
      if (!scope) for (const d of devs()) if (d.ip) hosts.add(d.ip);
      if (scope) hosts.add(scope);
      const traffic = new Map(); for (const f of flows) { traffic.set(f.src, (traffic.get(f.src) || 0) + f.n); traffic.set(f.dst, (traffic.get(f.dst) || 0) + f.n); }
      const nodes = [...hosts].filter(Boolean).map((h) => {
        const d = devs().find((x) => x.ip === h), net = isCast(h) ? 'cast' : isPriv(h) ? 'lan' : 'web';
        return { id: h, label: d ? (d.label || d.hostname || h) : net === 'cast' ? `📢 ${flowsData.names[h] || h}` : flowsData.names[h] || h, sub: h, search: `${flowsData.names[h] || ''} ${d?.os || ''}`,
          color: net === 'web' ? '#4F9DDE' : net === 'cast' ? '#57C98A' : d && d.status !== 'online' ? '#7d8791' : undefined, hub: h === scope, size: h === scope ? 18 : undefined, selected: !!sel && h === sel && sel !== scope,
          title: `${d ? `${d.label} · ` : ''}${h}${flowsData.names[h] ? ` · ${flowsData.names[h]}` : ''}${net === 'web' ? ' · Internet' : net === 'cast' ? ' · diffusion' : ''} · ${traffic.get(h) || 0} paquet(s)` };
      });
      const max = Math.max(1, ...[...pairs.values()].map((p) => p.ab + p.ba));
      const edges = [...pairs.values()].map((p) => ({ a: p.ab >= p.ba ? p.a : p.b, b: p.ab >= p.ba ? p.b : p.a, arrow: p.ab && p.ba ? 'both' : 'to', w: Math.round((Math.log1p(p.ab + p.ba) / Math.log1p(max)) * 5), color: PCOL[[...p.apps][0]] || '',
        title: `${nameOf(p.a)} → ${nameOf(p.b)} : ${p.ab} paquet(s) · ${nameOf(p.b)} → ${nameOf(p.a)} : ${p.ba} · ${size(p.bytes)} · ${[...p.apps].join(', ')}${p.site ? ` · ${p.site}` : ''}` }));
      const data = { legend: [['#4F9DDE', 'Internet'], ['#57C98A', 'diffusion'], ['#E8EAEC', 'réseau local'], ['#7d8791', 'hors ligne']], nodes, edges, label: 'Carte des communications', search: 'Chercher une machine, un site…', counter: () => `${nodes.length} machines et sites · ${edges.length} liens`,
        onOpen: (id) => { sel = id; peer = ''; drawMap(); paintCom(); loadPackets(); paintBack(); }, onEdge: (a, b) => { sel = a; peer = b; drawMap(); paintCom(); loadPackets(); paintBack(); } };
      if (graph && mapBox.contains(graph.el)) graph.update(data); else graph = window.OdinGraph.mount(mapBox, data);
    }
    function paintCom() {
      const me = sel || scope;
      const flows = (flowsData.flows || []).filter((f) => !me || f.src === me || f.dst === me);
      const peers = new Map();
      for (const f of flows) {
        const other = !me ? `${f.src}→${f.dst}` : f.src === me ? f.dst : f.src;
        const p = peers.get(other) || { other, out: 0, in: 0, bytes: 0, apps: new Set(), site: '', last: 0, src: f.src, dst: f.dst };
        if (!me || f.src === me) p.out += f.n; else p.in += f.n; p.bytes += f.bytes; f.apps.forEach((x) => p.apps.add(x)); p.site ||= f.site; p.last = Math.max(p.last, f.last); peers.set(other, p);
      }
      comTitle.textContent = me ? `Communications de ${who(me)}` : 'Toutes les communications';
      const list = [...peers.values()].sort((a, b) => b.in + b.out - a.in - a.out).slice(0, 80);
      com.replaceChildren(...(list.length ? list.map((p) => {
        const other = me ? p.other : p.dst, label = me ? who(p.other) : `${nameOf(p.src)} → ${nameOf(p.dst)}`;
        const arrow = !me ? '→' : p.in && p.out ? '⇄' : p.out ? '→' : '←';
        return el('button', { class: `rn-peer${peer === other ? ' on' : ''}`, type: 'button', onclick: () => { if (me) peer = other; else { sel = p.src; peer = p.dst; } drawMap(); paintCom(); loadPackets(); paintBack(); } },
          el('span', { class: 'ar', 'aria-hidden': 'true' }, arrow), el('b', {}, label), el('small', {}, `${me ? `${p.out} envoyé(s) · ${p.in} reçu(s)` : `${p.out} paquet(s)`} · ${size(p.bytes)} · ${[...p.apps].slice(0, 4).join(', ')}${p.site ? ` · ${p.site}` : ''} · ${time(p.last)}`));
      }) : [el('div', { class: 'sub' }, reading && !paused ? 'En attente des premiers paquets…' : 'Aucune communication sur cette période. Touche « Lire les paquets ».')]));
    }
    // ---------- paquets ----------
    const match = (p) => {
      const me = sel || scope;
      if (me && p.src !== me && p.dst !== me) return false;
      if (peer && p.src !== peer && p.dst !== peer) return false;
      return !q || `${p.proto} ${p.app} ${p.site} ${p.src} ${p.dst} ${p.sport ?? ''} ${p.dport ?? ''} ${p.info}`.toLowerCase().includes(q);
    };
    const tr = (p, fresh) => el('tr', { class: `${p.id === detailId ? 'on' : ''}${fresh ? ' new' : ''}`, tabindex: '0', 'data-id': p.id, onclick: () => openPacket(p.id), onkeydown: (e) => { if (e.key === 'Enter') openPacket(p.id); } },
      el('td', {}, p.id > 0 ? p.id : ''), el('td', {}, time(p.at)), el('td', { title: who(p.src) }, `${nameOf(p.src)}${p.sport != null ? `:${p.sport}` : ''}`), el('td', { title: who(p.dst) }, `${nameOf(p.dst)}${p.dport != null ? `:${p.dport}` : ''}`),
      el('td', {}, el('span', { class: 'pp', style: `color:${PCOL[p.proto] || PCOL[p.app] || 'inherit'}` }, p.app || p.proto), p.site ? ` · ${p.site}` : ''), el('td', {}, size(p.len)), el('td', { class: 'i' }, p.info));
    const paintRows = () => {
      const me = sel || scope;
      listTitle.textContent = `Paquets${me ? ` de ${nameOf(me)}` : ''}${peer ? ` avec ${nameOf(peer)}` : ''}`;
      const list = rows.filter(match).slice(0, 600);
      tbody.replaceChildren(...(list.length ? list.map((p) => tr(p)) : [el('tr', {}, el('td', { colspan: '7', class: 'i' }, reading && !paused ? 'En attente des paquets…' : 'Aucun paquet sur cette période.'))]));
    };
    async function loadPackets() {
      const me = sel || scope, since = Date.now() - period;
      const r = await get(`/api/ran/history?${new URLSearchParams({ ...(me ? { ip: me } : {}), ...(peer ? { peer } : {}), q, n: '600', since: String(since) })}`).catch(() => null);
      if (!r?.ok) return;
      rows = r.packets;
      if (me === scope) {
        sources = r.sources || [];
        head.textContent = `${r.total} paquet(s) · ${size(r.bytes)} sur la période${r.first ? ` (du ${day(r.first)} au ${day(r.last)})` : ''} · gardés 7 jours.`;
        chips.replaceChildren(...r.apps.slice(0, 8).map((a) => el('button', { type: 'button', onclick: () => { filt.value = a.app; q = a.app.toLowerCase(); refresh(); } }, el('b', {}, a.app), ` ${a.n}`)), ...r.sites.slice(0, 10).map((x) => el('button', { type: 'button', onclick: () => { filt.value = x.site; q = x.site.toLowerCase(); refresh(); } }, '🌐 ', el('b', {}, x.site), ` ${x.n}`)));
        reading = r.recording || Boolean(es); paused = Boolean(r.state?.paused); paintButtons();
        if (paused) say('⏸ En pause : Rán ne lit plus aucun paquet. Touche « Lire les paquets » pour reprendre.');
        else if (!es) say(sources.length ? `Points de capture : ${sources.map((x) => `${x.label}${x.machine ? ' (tout son trafic)' : ''}`).join(', ')}.${sources.some((x) => x.machine) ? '' : ' Sur un réseau avec switch ou box, Odin ne voit que ses propres échanges et les diffusions : donne-lui l\'accès à une machine (un hôte Proxmox, le routeur) pour voir tout son trafic.'}` : '');
      }
      paintRows();
    }
    async function loadFlows() {
      const r = await get(`/api/ran/flows?${new URLSearchParams({ ...(scope ? { ip: scope } : {}), q, since: String(Date.now() - period) })}`).catch(() => null);
      if (!r?.ok) return; flowsData = r; paused = Boolean(r.paused); paintButtons(); drawMap(); paintCom();
    }
    const refresh = () => { loadFlows(); loadPackets(); };

    // ---------- détail d'un paquet ----------
    async function openPacket(id) {
      if (!(id > 0)) return;
      detailId = id; for (const r of tbody.children) r.classList.toggle('on', r.dataset.id === String(id));
      const r = await get(`/api/ran/packet?id=${id}`).catch(() => null); if (!r?.ok) return;
      const p = r.packet; det.hidden = false;
      det.replaceChildren(
        el('div', { class: 'rn-bar' }, el('h2', { style: 'flex:1;margin:0' }, `Paquet n° ${p.id} — ${day(p.at)}`), el('button', { class: 'btn small', type: 'button', onclick: () => explainPacket(p) }, '🦉 Odin, explique ce paquet'), el('button', { class: 'btn small', type: 'button', 'aria-label': 'Fermer le détail', onclick: () => { det.hidden = true; detailId = 0; } }, '×')),
        el('div', { class: 'rn-story' }, p.story || p.info),
        el('div', { class: 'sub' }, `${who(p.src)}${p.sport != null ? `:${p.sport}` : ''} → ${who(p.dst)}${p.dport != null ? `:${p.dport}` : ''} · ${p.app || p.proto}${p.site ? ` · ${p.site}` : ''} · ${size(p.len)} · capté par ${p.origin}`),
        ...p.layers.map((l) => el('details', { open: true }, el('summary', {}, el('span', { class: 'o' }, `${l.osi} · ${OSI[l.osi] || ''}`), l.title), el('dl', {}, ...l.fields.flatMap((x) => [el('dt', {}, x.k), el('dd', {}, x.v)])))),
        el('details', {}, el('summary', {}, el('span', { class: 'o' }, 'brut'), 'Contenu brut (hexadécimal et texte)'), el('pre', { class: 'rn-hex' }, p.hex || '(vide)')));
      det.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    const askOdin = (t) => (window.OdinGuide?.ask ? window.OdinGuide.ask(t) : window.OdinShow?.('chat'));
    function explainPacket(p) {
      askOdin(`Explique-moi simplement ce paquet réseau, couche par couche, et dis-moi si c'est normal ou inquiétant : ${p.story}\n${p.layers.map((l) => `${l.osi}. ${l.title} — ${l.fields.slice(0, 10).map((x) => `${x.k}: ${String(x.v).slice(0, 120)}`).join(' ; ')}`).join('\n')}`);
    }
    function explainAll() {
      const me = sel || scope;
      const list = (flowsData.flows || []).filter((f) => !me || f.src === me || f.dst === me).slice(0, 15).map((f) => `${who(f.src)} → ${who(f.dst)} : ${f.n} paquets, ${size(f.bytes)}, ${f.apps.join('/')}${f.site ? `, ${f.site}` : ''}`);
      askOdin(`Explique-moi ce qui se passe sur ${me ? who(me) : 'mon réseau'} d'après les paquets : qui communique avec qui, vers quels sites d'Internet, avec quelles applis, et si quelque chose est anormal ou risqué.\n${list.join('\n') || 'Aucune communication lue pour l\'instant.'}`);
    }

    // ---------- lecture, pause, direct ----------
    function openLive() {
      if (es) return;
      es = new EventSource(`/api/ran/live${scope ? `?ip=${encodeURIComponent(scope)}` : ''}`);
      es.addEventListener('start', (e) => { const d = JSON.parse(e.data); if (d.error) { say(d.error, true); closeLive(); return; } sources = d.sources; say(`Lecture en direct · points de capture : ${d.sources.map((x) => `${x.label}${x.machine ? ' (tout son trafic)' : ''}${x.error ? ` — ${x.error}` : ''}`).join(', ')}`); });
      es.addEventListener('packets', (e) => {
        const list = JSON.parse(e.data).reverse();
        rows = [...list, ...rows].slice(0, 3000);
        const fresh = list.filter(match);
        if (fresh.length) { if (tbody.firstChild?.querySelector('[colspan]')) tbody.replaceChildren(); for (const p of fresh.slice(0, 200).reverse()) tbody.prepend(tr(p, true)); while (tbody.children.length > 600) tbody.lastChild.remove(); }
      });
      es.addEventListener('status', (e) => say(JSON.parse(e.data).text, true));
      es.onerror = () => { if (es?.readyState === EventSource.CLOSED) closeLive(); };
      reading = true; paintButtons();
    }
    function closeLive() { es?.close(); es = null; paintButtons(); }
    async function startReading() {
      go.disabled = true;
      const r = await post('/api/valhalla/act', { module: 'ran', action: 'lire', input: { ip: scope } }).catch(() => null);
      go.disabled = false; paused = false;
      if (!r || r.ok === false) { say(r?.text || r?.error || 'Lecture impossible.', true); return; }
      reading = true; openLive(); paintButtons(); setTimeout(refresh, 1500);
    }
    async function pauseAll() {
      pause.disabled = true; closeLive();
      await post('/api/valhalla/act', { module: 'ran', action: 'pause', input: {} }).catch(() => null);
      pause.disabled = false; paused = true; reading = false; paintButtons(); paintRows(); say('⏸ En pause : Rán ne lit plus aucun paquet. Touche « Lire les paquets » pour reprendre.');
    }
    let t = 0; filt.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = filt.value.trim().toLowerCase(); refresh(); }, 300); });
    per.addEventListener('change', () => { period = Number(per.value); refresh(); });
    // Pendant la lecture, la carte se met à jour ; le direct se ferme quand on quitte la page
    const tick = setInterval(() => {
      if (!node.isConnected) { closeLive(); clearInterval(tick); studios.delete(scope); return; }
      if (!node.offsetParent) { closeLive(); return; }
      if (es) loadFlows(); else if (reading && !paused) openLive();
    }, 4000);
    studios.set(scope, { node });
    refresh();
    return node;
  }
  window.OdinPackets = { studio, panel: (ip) => studio({ ip }), finder: () => studio({}) };
})();
