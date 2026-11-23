// Arche (identifiant interne naglfar) dans l'interface.
// Lot K1 (maquette « Arche et Hydre » validée le 23/11) : le tableau de bord (ce qui tourne, processeur, mémoire,
// disque, arrêtés, mises à jour connues) et la fiche d'un conteneur (journal en direct relu et borné, terminal d'une
// commande à la fois avec confirmation, réglages, ressources, redémarrer, arrêter, supprimer avec garde-fou : ses
// données gardées par défaut, son nom à taper pour les effacer). Sur un PC sans moteur (Windows aujourd'hui), la page
// le dit et dit ce qui viendra. Tout ce qui agit passe par les actions d'Arche (propriétaire seul, noté).
// En haut du tableau, chaque service mis à l'échelle (maquette validée « Mise à l'échelle automatique et base de
// données d'Odin ») — copies prêtes, visiteurs, processeur, budget de la machine, la journée en courbe, ce que le moteur
// a fait, les copies une à une, la base de données d'Odin. Dessous : le reste de l'appli (lancer, images…), comme avant.
// Tous les textes du tableau et de la fiche sont dans MOTS ; un nom, une ligne de journal ou une sortie de commande
// est toujours écrit comme du TEXTE.
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
  const act = async (module, action, input) => { let r = await post(module, action, input); if (r.confirm) { if (!(await window.OdinDialog.confirm(r.confirm, { danger: true }))) return { ok: false, text: 'Annulé.' }; r = await post(module, action, input, true); } return r; };
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

  /** Les services mis à l'échelle (s'il y en a), en haut du tableau de bord. */
  const pageServices = async ({ host, reload, nom }, list) => {
    if (!document.getElementById('ecCss')) document.head.append(el('style', { id: 'ecCss' }, CSS));
    if (!list.some((x) => x.spec.name === S.svc)) S.svc = list[0].spec.name;
    const { spec: sp, state: st, budget: bu } = list.find((x) => x.spec.name === S.svc);
    const ready = st.replicas.filter((x) => x.healthy && !x.draining).length, starting = st.replicas.filter((x) => !x.healthy && !x.draining).length;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const hToday = st.history.filter((h) => Date.parse(h.at) >= today.getTime()), peak = hToday.reduce((a, h) => (h.active > (a?.active ?? -1) ? h : a), undefined);
    const cpu = st.replicas.length ? Math.round(st.replicas.reduce((k, x) => k + x.cpu, 0) / st.replicas.length) : 0;
    const root = el('div', { class: 'ec' });
    root.append(el('div', { class: 'ec-top' }, el('div', {}, el('h2', {}, `${nom} · ${sp.name}`), el('p', {}, `Mise à l'échelle automatique : de ${sp.scale.min} à ${sp.scale.max} copies selon les visiteurs, le processeur et la mémoire${sp.ports[0] ? ` · port ${sp.ports[0].host}` : ''} · ${sp.per.cpus} cœur${Number(sp.per.cpus) > 1 ? 's' : ''} et ${sp.per.memory} par copie`)),
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
        el('div', {}, el('span', { class: 'ec-chip', style: `background:${GREEN}22;color:${GREEN}` }, 'grandit tout seul'), el('span', { class: 'ec-chip', style: `background:${BLUE}22;color:${BLUE}` }, '500 connexions au plus'), el('span', { class: 'ec-chip', style: `background:${GREEN}22;color:${GREEN}` }, 'sauvegardée chaque nuit (Amphore)')),
        el('p', { style: 'margin:4px 0 0;font-size:13.5px;line-height:1.5' }, 'Chaque appli a sa base et son compte. Mémoire +25 % si elle dépasse 85 %, +½ cœur si le processeur sature, sans arrêt ; elle redescend après 30 min de calme.'))));
    const last = st.events.at(-1);
    root.append(el('div', { class: 'ec-say' }, odinFace(), el('p', {}, `${last ? `${last.text}. ` : ''}${st.reason ? `${st.reason}. ` : ''}${bu.room > 0 ? `Il reste de la place pour ${bu.room} copie${bu.room > 1 ? 's' : ''} de plus dans le budget de la machine.` : 'Le budget de la machine est atteint : augmente-le dans « Régler » si besoin.'}`)));
    host.append(root);
  };
  // =================================================================================================================
  // Lot K1 : le tableau de bord et la fiche d'un conteneur.
  // =================================================================================================================
  const MOTS = {
    nom: 'Arche',
    erreurLecture: 'Odin n\'a pas pu lire les conteneurs : {raison}',
    // Ce PC sans moteur (Windows aujourd'hui)
    'pc.titre': 'Ce PC : {systeme}',
    'pc.windows': 'Windows', 'pc.autre': 'pas Linux ({plateforme})',
    'pc.rien': 'Rien n\'est lancé ici et rien ne plante : la page attend le moteur.',
    'pc.deja': 'Ce qui marche déjà : sur une machine Linux d\'Odin, tout ce que fait l\'appli (lancer depuis une image, ports, dossiers, variables, redémarrage, limites, base dans Alexandrie, mises à jour, nettoyage, services mis à l\'échelle).',
    // Les chiffres
    'k.marche': 'En marche', 'k.marche.sous': '{erreur} en erreur · {arretes} arrêté(s)',
    'k.cpu': 'Processeur', 'k.cpu.sous': 'de ce PC, pour les conteneurs', 'k.cpu.attente': 'mesure en cours…',
    'k.mem': 'Mémoire', 'k.mem.sous': 'sur {total} de la machine',
    'k.disque': 'Disque', 'k.disque.sous': '{n} image(s) · {libre} libres',
    // Les listes
    'l.tourne': 'Ce qui tourne', 'l.tourne.lead': 'Chaque appli a son conteneur. « Ouvrir » montre le journal en direct, le terminal, les réglages et les ressources.',
    'l.arretes': 'Arrêtés', 'l.arretes.lead': 'Ils gardent leurs réglages et leurs données : « Démarrer » les relance tels quels.',
    'l.vide': 'Aucun conteneur pour l\'instant. Lance une appli plus bas (« Lancer une appli »), ou dans la discussion : « run -d -p 8080:80 » suivi du nom de l\'image.',
    'l.rienTourne': 'Rien ne tourne en ce moment.',
    'e.marche': 'en marche', 'e.arrete': 'arrêté', 'e.erreur': 'en erreur', 'e.redemarre': 'redémarre', 'e.cree': 'créé',
    'tag.service': 'copie de {service}', 'tag.maj': 'mise à jour',
    'm.cpu': 'Processeur', 'm.mem': 'Mémoire', 'm.sans': '—', 'm.limite': ' / {limite}',
    'sous.ports': 'port {ports}', 'sous.aucunPort': 'aucun port ouvert',
    ouvrir: 'Ouvrir', 'ouvrir.nom': 'Ouvrir la fiche de {nom}', demarrer: 'Démarrer', arreter: 'Arrêter', redemarrer: 'Redémarrer',
    'demarrer.nom': 'Démarrer {nom}', 'arreter.nom': 'Arrêter {nom}',
    'alerte.titre': '{nom} ne tient pas debout', 'alerte.texte': 'Il s\'est arrêté{code}{erreur}. {relances}',
    'alerte.code': ' (code {code})', 'alerte.relances': 'Odin l\'a relancé {n} fois.', 'alerte.journal': 'Lire son journal',
    'maj.titre': 'Mises à jour connues', 'maj.lead': 'Une nouvelle image existe pour ces conteneurs. Rien n\'est mis à jour tout seul : tu décides.',
    'maj.bouton': 'Mettre à jour {nom}', 'maj.rien': 'Toutes les images connues sont à jour (vérifié toutes les 6 heures).',
    'reste.titre': 'Lancer, images et le reste',
    // La fiche
    retour: 'Tableau de bord', 'retour.nom': 'Retour au tableau de bord',
    'f.adresse': 'Adresse', 'f.reseau': 'Dans le réseau des conteneurs', 'f.depuis': 'En marche depuis', 'f.relances': 'Relances',
    'f.aucuneAdresse': 'aucun port ouvert', 'f.maj': 'Mettre à jour', 'f.ajour': 'À jour', 'f.supprimer': 'Supprimer',
    'f.journal': 'Journal en direct', 'f.terminal': 'Terminal', 'f.reglages': 'Réglages', 'f.ressources': 'Ressources',
    'f.parties': 'Fiche de {nom}', 'f.introuvable': 'Ce conteneur n\'existe plus.',
    'j.direct': 'en direct', 'j.pause': 'en pause', 'j.arrete': 'arrêté', 'j.chercher': 'Chercher dans le journal',
    'j.pauser': 'Mettre en pause', 'j.reprendre': 'Reprendre', 'j.telecharger': 'Télécharger', 'j.vide': '(journal vide)',
    'j.nom': 'Journal de {nom}', 'j.borne': 'Les {n} dernières lignes au plus, relues toutes les 2 secondes ; les secrets des variables sont masqués.',
    't.avert': 'Pas encore de terminal interactif : une commande à la fois, qui finit seule. Chacune te demande confirmation, tourne avec les droits du conteneur (pas ceux du PC), au plus 30 secondes, et reste notée dans « qui a fait quoi ».',
    't.champ': 'Commande à lancer dans {nom}', 't.lancer': 'Lancer', 't.exemple': 'ls -la, df -h, cat /etc/os-release…',
    't.arrete': 'Le conteneur est arrêté : démarre-le pour lancer une commande.', 't.attente': 'Odin attend ta confirmation…', 't.code': 'code {code}',
    'r.ports': 'Ports', 'r.aucunPort': 'Aucun port ouvert vers la maison.', 'r.dossiers': 'Dossiers', 'r.aucunDossier': 'Aucun dossier de la machine.',
    'r.lecture': 'lecture seule', 'r.ecriture': 'lecture et écriture', 'r.dedans': 'dans le conteneur : {dedans} · {mode}',
    'r.redemarrage': 'Redémarrage automatique', 'r.variables': 'Variables', 'r.aucuneVariable': 'Aucune variable.', 'r.secret': 'secret : jamais montré, ni ici ni dans le journal',
    'r.image': 'Image', 'r.cree': 'créé le {date}', 'r.reseauTitre': 'Réseau', 'r.base': 'Sa base (Alexandrie)', 'r.ouvrirPort': 'Ouvrir le port {port}',
    'r.bientot': 'Changer ces réglages recréera le conteneur avec les mêmes dossiers (bientôt) ; aujourd\'hui, la mémoire et les cœurs se changent dans « Ressources ».',
    'res.mem': 'Mémoire', 'res.mem.sous': '{utilise} sur {permis} permis', 'res.cpu': 'Processeur', 'res.cpu.sous': 'au plus {coeurs} cœur(s) permis',
    'res.libre': 'sans limite', 'res.champMem': 'Mémoire max (ex. 512m, 2g)', 'res.champCpu': 'Cœurs max (ex. 0.5, 2)', 'res.appliquer': 'Appliquer sans arrêter',
    'res.grandir': 'Grandit tout seul entre {bornes}.',
    // Supprimer
    's.titre': 'Supprimer le conteneur « {nom} » ?', 's.texte': 'Il s\'arrête et part.',
    's.part': 'Ce qui part : le conteneur et ses réglages{port}.', 's.port': ', le port {port}',
    's.reste': 'Ce qui reste : l\'image (réutilisable){base}, les dossiers qu\'il ne faisait que lire.', 's.base': ', sa base dans Alexandrie (sauvegardée)',
    's.garder': 'Les garder (conseillé)', 's.effacer': 'Les supprimer aussi',
    's.jamais': 'Toujours gardé : {dossier} ({raison}).',
    's.confirmer': 'Les données ne pourront pas revenir (sauf sauvegarde). Écris « {nom} » pour confirmer :', 's.groupe': 'Ses données',
    's.ok': 'Supprimer', 's.okDonnees': 'Supprimer avec ses données', 's.non': 'Garder', 's.sansDonnees': 'Il n\'écrit dans aucun dossier de la machine : rien d\'autre à garder.',
    annule: 'Annulé.',
  };
  const T = (k, v = {}) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_m, x) => (v[x] ?? ''));

  // ---------------------------------------------------------------- logique pure (essayée sans navigateur)
  const octets = (n) => { const x = Number(n) || 0; return x >= 1024 ** 3 ? `${(x / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : x >= 1024 ** 2 ? `${Math.round(x / 1024 ** 2)} Mo` : `${Math.round(x / 1024)} Ko`; };
  const memTexte = (s) => { const m = /^(\d+(?:\.\d+)?)([kmg])$/i.exec(String(s ?? '').trim()); return m ? octets(Number(m[1]) * { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2].toLowerCase()]) : String(s ?? ''); };
  const pct = (n) => `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
  const etatDe = (c) => (c.enErreur ? ['bad', T('e.erreur')] : c.enMarche ? ['ok', T('e.marche')] : c.etat === 'redémarre' ? ['warn', T('e.redemarre')] : c.etat === 'créé' ? ['', T('e.cree')] : ['', T('e.arrete')]);
  const COULEURS = ['#e0559b', '#7c3aed', '#0f8a66', '#b45309', '#2563eb', '#0891b2', '#dc2626', '#475569', '#16a34a', '#db2777'];
  const couleur = (nom) => COULEURS[[...String(nom)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COULEURS.length];
  const initiale = (nom) => (String(nom).match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase();
  /** L'effacement des données n'est possible qu'avec le nom tapé à l'identique. */
  const peutEffacer = (nomTape, nom) => String(nomTape ?? '').trim() === String(nom);
  const filtrer = (lignes, q) => { const w = String(q ?? '').trim().toLowerCase(); return w ? lignes.filter((l) => l.texte.toLowerCase().includes(w)) : lignes; };
  const heure = (at) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  const duree = (iso) => { if (!iso) return '—'; const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} jours`; };
  const texteJournal = (lignes) => lignes.map((l) => `${l.at} ${l.flux === 'erreur' ? '!' : ' '} ${l.texte}`).join('\n');
  const logique = { octets, memTexte, etatDe, couleur, initiale, peutEffacer, filtrer, heure, duree, texteJournal };

  // ---------------------------------------------------------------- état de la page (gardé entre deux dessins)
  const K = { fiche: '', ftab: 'journal', lignes: [], depuis: '', jPause: false, jq: '', term: [], supp: '', suppData: false, suppTxt: '', msg: '', minuteur: 0, attente: false };
  const arreterMinuteur = () => { if (K.minuteur) { clearTimeout(K.minuteur); K.minuteur = 0; } };

  const CSS_K1 = `
.ark{display:flex;flex-direction:column;gap:14px;margin:0 0 18px;min-width:0}
.ark .btn{min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.ark .btn.danger-fill{background:var(--bad);border-color:var(--bad);color:#fff;font-weight:600}
.ark .btn[disabled]{opacity:.5;cursor:not-allowed}
.ark-msg{margin:0;padding:10px 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}
.ark-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}@media (max-width:900px){.ark-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ark-stat{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:12px 14px;min-width:0}
.ark-stat small{display:block;font-size:12.5px;color:var(--muted)}.ark-stat b{display:block;font-size:24px;font-weight:800;letter-spacing:-.3px;margin:2px 0}
.ark-stat.ok b{color:var(--good)}.ark-stat.warn b{color:var(--warn)}
.ark-bar{height:6px;border-radius:3px;background:color-mix(in srgb,var(--ink) 10%,transparent);overflow:hidden;margin:6px 0 4px}.ark-bar i{display:block;height:100%;background:var(--accent);border-radius:3px}
.ark-bar i.ok{background:var(--good)}.ark-bar i.warn{background:var(--warn)}.ark-bar i.bad{background:var(--bad)}
.ark-sec{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:16px;min-width:0}
.ark-sec h2{margin:0 0 4px;font-size:17px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ark-cnt{display:inline-grid;place-items:center;min-width:24px;height:22px;padding:0 6px;border-radius:999px;background:color-mix(in srgb,var(--ink) 8%,transparent);font-size:12px}
.ark-lead{margin:0 0 6px;color:var(--muted);font-size:13.5px}
.ark-ct{display:grid;grid-template-columns:44px minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-top:8px;min-width:0}
.ark-ct.err{border-color:var(--bad)}
@media (max-width:760px){.ark-ct{grid-template-columns:44px minmax(0,1fr)}.ark-ct .ark-mt,.ark-ct .ark-acts{grid-column:1/-1}}
.ark-mono{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:18px;flex:none}
.ark-nm{min-width:0}.ark-nm b{font-size:15px;overflow-wrap:anywhere}.ark-nm small{display:block;color:var(--muted);font-size:12.5px;overflow-wrap:anywhere;margin-top:2px}
.ark-tag{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;margin:2px 0 2px 6px;background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink);vertical-align:middle}
.ark-tag.ok{background:color-mix(in srgb,var(--good) 16%,transparent);color:var(--good)}.ark-tag.warn{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}.ark-tag.bad{background:color-mix(in srgb,var(--bad) 14%,transparent);color:var(--bad)}
.ark-mt{font-size:12.5px;color:var(--muted);min-width:0}.ark-mt b{color:var(--ink)}
.ark-acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.ark-host{display:flex;gap:14px;align-items:flex-start}.ark-host .odin{width:48px;height:48px;flex:none}.ark-host ul{margin:8px 0 0;padding-left:18px;font-size:14px;line-height:1.55}.ark-host b.t{font-size:16px}
.ark-guard{border:2px solid var(--bad);background:color-mix(in srgb,var(--bad) 7%,var(--panel));border-radius:18px;padding:16px;min-width:0}
.ark-guard>b{font-size:16px;display:block;overflow-wrap:anywhere}.ark-guard p,.ark-guard li{font-size:14px;line-height:1.5;overflow-wrap:anywhere}
.ark-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ark-fhead{display:flex;gap:12px;align-items:center;margin-bottom:12px;min-width:0}.ark-fhead h2{margin:0;font-size:20px;overflow-wrap:anywhere}.ark-fhead small{color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.ark-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}@media (max-width:760px){.ark-facts{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ark-fact{border:1px solid var(--line);border-radius:12px;padding:10px 12px;min-width:0;overflow-wrap:anywhere}.ark-fact small{display:block;color:var(--muted);font-size:12px;margin-bottom:4px}
.ark-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);overflow-x:auto;margin-top:12px}
.ark-tabs button{min-height:44px;padding:0 12px;border:0;border-bottom:2px solid transparent;background:none;color:var(--muted);font:600 14px/1 inherit;cursor:pointer;white-space:nowrap}
.ark-tabs button[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--accent)}
.ark-logbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0 8px}.ark-logbar input{flex:1 1 180px;min-width:0;min-height:44px}
.ark-live{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--good)}.ark-live i{width:8px;height:8px;border-radius:50%;background:currentColor}.ark-live.off{color:var(--muted)}
.ark-term{background:#0d1117;color:#e6edf3;border-radius:12px;padding:12px 14px;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;min-height:220px;max-height:460px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.ark-term .t{color:#8b949e}.ark-term .e{color:#ff7b72}.ark-term .p{color:#7ee787}
.ark-note{margin:6px 0 0;color:var(--muted);font-size:12.5px}
.ark-warn{background:color-mix(in srgb,var(--warn) 12%,var(--panel));border:1px solid color-mix(in srgb,var(--warn) 45%,transparent);border-radius:12px;padding:10px 12px;font-size:13.5px;line-height:1.5;margin:12px 0}
.ark-tin{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.ark-tin input{flex:1 1 220px;min-width:0;min-height:44px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ark-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:12px}@media (max-width:760px){.ark-two{grid-template-columns:minmax(0,1fr)}}
.ark-h3{font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:14px 0 6px}
.ark-rule{border-bottom:1px solid var(--line);padding:8px 0;display:flex;gap:10px;align-items:center;justify-content:space-between;min-width:0}.ark-rule span{min-width:0;overflow-wrap:anywhere}.ark-rule small{display:block;color:var(--muted);font-size:12.5px}
.ark-seg{display:inline-flex;border:1px solid var(--line);border-radius:12px;overflow:hidden}@media (max-width:520px){.ark-seg{display:flex;flex-direction:column;width:100%}.ark-seg button{text-align:left}}.ark-seg button{min-height:44px;padding:0 14px;border:0;background:none;color:var(--ink);font:600 14px inherit;cursor:pointer}.ark-seg button[aria-checked="true"]{background:var(--accent);color:var(--on-accent)}
.ark-confirm{margin:12px 0;padding:12px;border-radius:12px;background:var(--panel);border:1px solid var(--line)}.ark-confirm label{display:block;font-size:14px;margin-bottom:8px}.ark-confirm input{width:100%;min-height:44px;box-sizing:border-box}
.ark-dossiers{margin:0 0 10px;padding-left:18px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere}
.ark kbd{font:600 13px ui-monospace,Menlo,Consolas,monospace;padding:1px 6px;border-radius:6px;border:1px solid var(--line);background:color-mix(in srgb,var(--ink) 6%,transparent)}
.ark-form{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:12px}.ark-form label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted);flex:1 1 160px;min-width:0}.ark-form input{min-height:44px}
`;
  const css = () => { if (!document.getElementById('arkCss')) document.head.append(el('style', { id: 'arkCss' }, CSS_K1)); if (!document.getElementById('ecCss')) document.head.append(el('style', { id: 'ecCss' }, CSS)); };
  const barre = (v, max, ton) => el('div', { class: 'ark-bar', role: 'presentation' }, el('i', { class: ton || '', style: `width:${Math.max(0, Math.min(100, max ? (v / max) * 100 : 0)).toFixed(1)}%` }));
  const mono = (nom) => el('span', { class: 'ark-mono', style: `background:${couleur(nom)}`, 'aria-hidden': 'true' }, initiale(nom));
  const tag = (ton, texte) => el('span', { class: `ark-tag ${ton}` }, texte);
  const bouton = (texte, onclick, o = {}) => el('button', { class: `btn ${o.cls ?? ''}`.trim(), type: 'button', onclick, 'aria-label': o.label, disabled: o.disabled }, texte);

  /** Lance une action d'Arche : la confirmation d'Odin si elle est grave ; le résultat est écrit en haut, comme du texte. */
  async function geste(module, action, input, apres) {
    const r = await act(module, action, input);
    K.msg = String(r.text ?? r.error ?? (r.ok === false ? '' : '✓'));
    if (apres) apres(r);
    return r;
  }

  // ---------------------------------------------------------------- Ce PC sans moteur
  function carteSansMoteur(t) {
    const sys = t.plateforme === 'win32' ? T('pc.windows') : T('pc.autre', { plateforme: t.plateforme });
    return el('section', { class: 'ark-sec ark-host', role: 'status' }, odinFace(),
      el('div', {}, el('b', { class: 't' }, T('pc.titre', { systeme: sys })),
        el('ul', {}, el('li', {}, t.raison), el('li', {}, t.avenir), el('li', {}, T('pc.rien')), el('li', {}, T('pc.deja')))));
  }

  // ---------------------------------------------------------------- le tableau de bord
  function ligneConteneur(c, o) {
    const [ton, etat] = etatDe(c), m = c.memoire ?? 0, lim = c.limiteMemoire || c.memoireMax || 0;
    const tons = lim && m / lim >= 0.95 ? 'bad' : lim && m / lim > 0.75 ? 'warn' : 'ok';
    const ports = (c.ports ?? []).map((p) => p.hote).join(', ');
    return el('div', { class: `ark-ct ${c.enErreur ? 'err' : ''}`.trim() }, mono(c.nom),
      el('span', { class: 'ark-nm' }, el('b', {}, c.nom), tag(ton, etat), c.service ? tag('', T('tag.service', { service: c.service })) : null, c.majDispo ? tag('warn', T('tag.maj')) : null,
        el('small', {}, `${c.image} · ${ports ? T('sous.ports', { ports }) : T('sous.aucunPort')}`)),
      el('span', { class: 'ark-mt' }, `${T('m.cpu')} `, el('b', {}, c.enMarche && c.cpu !== undefined ? pct(c.cpu) : T('m.sans')), barre(c.enMarche ? c.cpu ?? 0 : 0, 100)),
      el('span', { class: 'ark-mt' }, `${T('m.mem')} `, el('b', {}, c.enMarche && c.memoire ? octets(m) : T('m.sans')), lim ? T('m.limite', { limite: octets(lim) }) : '', barre(c.enMarche ? m : 0, lim || 1, tons)),
      el('span', { class: 'ark-acts' },
        c.enMarche ? bouton(T('arreter'), () => geste('naglfar', 'geste_fiche', { conteneur: c.nom, geste: 'arreter' }, o.reload), { label: T('arreter.nom', { nom: c.nom }) })
          : bouton(T('demarrer'), () => geste('naglfar', 'geste_fiche', { conteneur: c.nom, geste: 'demarrer' }, o.reload), { label: T('demarrer.nom', { nom: c.nom }) }),
        bouton(T('ouvrir'), () => { K.fiche = c.nom; K.ftab = 'journal'; K.lignes = []; K.depuis = ''; K.term = []; K.supp = ''; K.msg = ''; o.reload(); }, { cls: 'primary', label: T('ouvrir.nom', { nom: c.nom }) })));
  }
  function tableau(t, o) {
    const l = t.conteneurs, tot = t.totaux, frag = [];
    const enErr = l.filter((c) => c.enErreur);
    if (enErr.length) {
      const c = enErr[0];
      frag.push(el('div', { class: 'ark-guard', role: 'alert' }, el('b', {}, T('alerte.titre', { nom: c.nom })),
        el('p', {}, T('alerte.texte', { code: c.code !== undefined && c.code !== null ? T('alerte.code', { code: c.code }) : '', erreur: c.erreur ? ` : ${c.erreur}` : '', relances: c.relances ? T('alerte.relances', { n: c.relances }) : '' })),
        el('div', { class: 'ark-row' }, bouton(T('alerte.journal'), () => { K.fiche = c.nom; K.ftab = 'journal'; K.lignes = []; K.depuis = ''; o.reload(); }, { cls: 'primary' }),
          bouton(T('demarrer'), () => geste('naglfar', 'geste_fiche', { conteneur: c.nom, geste: 'demarrer' }, o.reload)))));
    }
    const k = (cls, label, valeur, sous, bar) => el('div', { class: `ark-stat ${cls}`.trim() }, el('small', {}, label), el('b', {}, valeur), bar ?? null, el('small', {}, sous));
    frag.push(el('div', { class: 'ark-stats' },
      k(tot.enErreur ? 'warn' : tot.enMarche ? 'ok' : '', T('k.marche'), `${tot.enMarche} / ${tot.total}`, T('k.marche.sous', { erreur: tot.enErreur, arretes: tot.arretes })),
      k('', T('k.cpu'), tot.cpu !== undefined ? pct(tot.cpu) : T('m.sans'), tot.cpu !== undefined ? T('k.cpu.sous') : tot.enMarche ? T('k.cpu.attente') : T('k.cpu.sous'), barre(tot.cpu ?? 0, 100)),
      k('', T('k.mem'), octets(tot.memoire), T('k.mem.sous', { total: octets(tot.memoireMachine) }), barre(tot.memoire, tot.memoireMachine)),
      k('', T('k.disque'), octets(t.disque.images), T('k.disque.sous', { n: t.disque.nbImages, libre: t.disque.libre !== undefined ? octets(t.disque.libre) : T('m.sans') }), t.disque.total ? barre(t.disque.total - (t.disque.libre ?? 0), t.disque.total) : null)));
    const on = l.filter((c) => c.enMarche || c.etat === 'redémarre'), off = l.filter((c) => !on.includes(c));
    frag.push(el('section', { class: 'ark-sec' }, el('h2', {}, T('l.tourne'), el('span', { class: 'ark-cnt' }, String(on.length))), el('p', { class: 'ark-lead' }, T('l.tourne.lead')),
      ...(l.length ? (on.length ? on.map((c) => ligneConteneur(c, o)) : [el('p', { class: 'ark-note' }, T('l.rienTourne'))]) : [el('p', { class: 'ark-note' }, T('l.vide'))])));
    if (off.length) frag.push(el('section', { class: 'ark-sec' }, el('h2', {}, T('l.arretes'), el('span', { class: 'ark-cnt' }, String(off.length))), el('p', { class: 'ark-lead' }, T('l.arretes.lead')), ...off.map((c) => ligneConteneur(c, o))));
    frag.push(el('section', { class: 'ark-sec' }, el('h2', {}, T('maj.titre'), el('span', { class: 'ark-cnt' }, String(t.majs.length))), el('p', { class: 'ark-lead' }, t.majs.length ? T('maj.lead') : T('maj.rien')),
      ...t.majs.map((m) => el('div', { class: 'ark-rule' }, el('span', {}, el('b', {}, m.image), el('small', {}, m.conteneurs.join(', '))),
        bouton(T('maj.bouton', { nom: m.conteneurs[0] }), () => geste('naglfar', 'mettre_a_jour', { conteneur: m.conteneurs[0] }, o.reload))))));
    return frag;
  }

  // ---------------------------------------------------------------- la fiche
  async function lireJournal(nom) {
    const r = await post('naglfar', 'journal_direct', { conteneur: nom, depuis: K.depuis, n: K.depuis ? 400 : 200 });
    const l = r.data?.lignes ?? [];
    if (l.length) { K.lignes = [...K.lignes, ...l].slice(-400); K.depuis = l.at(-1).at || K.depuis; }
    return r;
  }
  function dessinerLignes(boite) {
    const l = filtrer(K.lignes, K.jq);
    boite.replaceChildren(...(l.length ? l.map((x) => el('div', {}, el('span', { class: 't' }, heure(x.at)), ' ', el('span', { class: x.flux === 'erreur' ? 'e' : '' }, x.texte))) : [el('span', { class: 't' }, T('j.vide'))]));
    boite.scrollTop = boite.scrollHeight;
  }
  function ongletJournal(f) {
    const boite = el('div', { class: 'ark-term', role: 'log', 'aria-live': 'off', 'aria-label': T('j.nom', { nom: f.nom }), tabindex: '0' });
    const etat = el('span', { class: `ark-live ${K.jPause || !f.enMarche ? 'off' : ''}`.trim(), role: 'status' }, el('i'), !f.enMarche ? T('j.arrete') : K.jPause ? T('j.pause') : T('j.direct'));
    const q = el('input', { type: 'search', placeholder: T('j.chercher'), 'aria-label': T('j.chercher'), value: K.jq, oninput: (e) => { K.jq = e.target.value; dessinerLignes(boite); } });
    const pause = bouton(K.jPause ? T('j.reprendre') : T('j.pauser'), () => { K.jPause = !K.jPause; pause.textContent = K.jPause ? T('j.reprendre') : T('j.pauser'); etat.lastChild.textContent = !f.enMarche ? T('j.arrete') : K.jPause ? T('j.pause') : T('j.direct'); etat.classList.toggle('off', K.jPause || !f.enMarche); if (!K.jPause) suivre(); });
    const dl = bouton(T('j.telecharger'), () => { const u = URL.createObjectURL(new Blob([texteJournal(filtrer(K.lignes, K.jq))], { type: 'text/plain;charset=utf-8' })); const a = el('a', { href: u, download: `journal-${f.nom}.txt` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); });
    const suivre = async () => {
      arreterMinuteur();
      if (!boite.isConnected && K.lignes.length) return;
      if (K.fiche !== f.nom || K.ftab !== 'journal') return;
      if (document.visibilityState !== 'hidden' && !K.jPause) { await lireJournal(f.nom).catch(() => undefined); dessinerLignes(boite); }
      if (f.enMarche && !K.jPause) K.minuteur = setTimeout(() => { if (boite.isConnected) suivre(); }, 2000);
    };
    dessinerLignes(boite);
    setTimeout(suivre, 0);
    return [el('div', { class: 'ark-logbar' }, etat, q, pause, dl), boite, el('p', { class: 'ark-note' }, T('j.borne', { n: 400 }))];
  }
  function ongletTerminal(f, o) {
    const boite = el('div', { class: 'ark-term', role: 'log', 'aria-label': T('t.champ', { nom: f.nom }) },
      ...K.term.flatMap((x) => [el('div', {}, el('span', { class: 'p' }, `${f.nom} $ `), x.cmd), el('div', { class: x.ok ? '' : 'e' }, x.sortie), x.code ? el('div', { class: 't' }, T('t.code', { code: x.code })) : null]));
    const champ = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: T('t.exemple'), 'aria-label': T('t.champ', { nom: f.nom }), disabled: !f.enMarche || K.attente });
    const lancer = async () => {
      const cmd = champ.value.trim(); if (!cmd || K.attente) return;
      K.attente = true; champ.disabled = true; go.disabled = true; go.textContent = T('t.attente');
      try {
        const r = await act('naglfar', 'terminal', { conteneur: f.nom, commande: cmd });
        K.term = [...K.term, { cmd, sortie: String(r.text ?? r.error ?? ''), ok: r.ok !== false, code: r.data?.code }].slice(-20);
      } finally { K.attente = false; }
      o.reload();
    };
    champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lancer(); } if (e.key === 'ArrowUp' && K.term.length) { e.preventDefault(); champ.value = K.term.at(-1).cmd; } });
    const go = bouton(T('t.lancer'), lancer, { cls: 'primary', disabled: !f.enMarche });
    return [el('div', { class: 'ark-warn', role: 'note' }, T('t.avert')), boite, el('div', { class: 'ark-tin' }, champ, go), f.enMarche ? null : el('p', { class: 'ark-note' }, T('t.arrete'))];
  }
  function ongletReglages(f) {
    const ici = location.hostname || 'localhost';
    const ports = f.ports.length ? f.ports.map((p) => el('div', { class: 'ark-rule' }, el('span', {}, el('b', {}, `${p.hote} → ${p.dedans} (${p.proto})`), el('small', {}, `http://${ici}:${p.hote}`)),
      el('a', { class: 'btn small', href: `http://${ici}:${p.hote}`, target: '_blank', rel: 'noopener noreferrer', 'aria-label': T('r.ouvrirPort', { port: p.hote }), style: 'min-height:44px' }, T('ouvrir')))) : [el('p', { class: 'ark-note' }, T('r.aucunPort'))];
    const dossiers = f.dossiers.length ? f.dossiers.map((d) => el('div', { class: 'ark-rule' }, el('span', {}, el('b', {}, d.hote), el('small', {}, T('r.dedans', { dedans: d.dedans, mode: d.lecture ? T('r.lecture') : T('r.ecriture') }))))) : [el('p', { class: 'ark-note' }, T('r.aucunDossier'))];
    const vars = f.variables.length ? f.variables.map((v) => el('div', { class: 'ark-rule' }, el('span', {}, el('b', {}, `${v.cle} = ${v.valeur}`), v.secrete ? el('small', {}, T('r.secret')) : null))) : [el('p', { class: 'ark-note' }, T('r.aucuneVariable'))];
    return [el('div', { class: 'ark-two' },
      el('div', {}, el('div', { class: 'ark-h3' }, T('r.ports')), ...ports, el('div', { class: 'ark-h3' }, T('r.dossiers')), ...dossiers, el('div', { class: 'ark-h3' }, T('r.reseauTitre')), el('p', { style: 'margin:0;font-size:14px' }, f.reseau)),
      el('div', {}, el('div', { class: 'ark-h3' }, T('r.redemarrage')), el('p', { style: 'margin:0;font-size:14px' }, f.redemarrage), el('div', { class: 'ark-h3' }, T('r.variables')), ...vars,
        el('div', { class: 'ark-h3' }, T('r.image')), el('p', { style: 'margin:0;font-size:14px;overflow-wrap:anywhere' }, f.image, el('br'), el('span', { class: 'ark-note' }, T('r.cree', { date: new Date(f.cree).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) }))),
        f.base ? el('div', { class: 'ark-row', style: 'margin-top:10px' }, bouton(T('r.base'), () => geste('urdr', 'ouvrir', { base: f.base.id }))) : null)),
    el('p', { class: 'ark-note' }, T('r.bientot'))];
  }
  function ongletRessources(f, o) {
    const lim = f.memoireMax || 0, m = f.memoire || 0;
    const mem = el('input', { type: 'text', value: f.memoireReglee ?? '', placeholder: '512m', autocomplete: 'off' }), cpu = el('input', { type: 'text', value: f.limiteCoeurs ?? '', placeholder: '1', autocomplete: 'off' });
    return [el('div', { class: 'ark-two' },
      el('div', { class: 'ark-stat' }, el('small', {}, T('res.mem')), el('b', {}, f.enMarche && m ? octets(m) : T('m.sans')), barre(m, lim || 1, lim && m / lim >= 0.95 ? 'bad' : 'ok'), el('small', {}, T('res.mem.sous', { utilise: f.enMarche ? octets(m) : '0', permis: f.limiteMemoire ? memTexte(f.limiteMemoire) : T('res.libre') }))),
      el('div', { class: 'ark-stat' }, el('small', {}, T('res.cpu')), el('b', {}, f.enMarche && f.cpu !== undefined ? pct(f.cpu) : T('m.sans')), barre(f.cpu ?? 0, 100), el('small', {}, f.limiteCoeurs ? T('res.cpu.sous', { coeurs: f.limiteCoeurs }) : T('res.libre')))),
    f.grandir ? el('p', { class: 'ark-note' }, T('res.grandir', { bornes: f.grandir })) : null,
    el('form', { class: 'ark-form', onsubmit: (e) => { e.preventDefault(); geste('naglfar', 'ressources', { conteneur: f.nom, memoire: mem.value.trim(), coeurs: cpu.value.trim() }, o.reload); } },
      el('label', {}, T('res.champMem'), mem), el('label', {}, T('res.champCpu'), cpu), el('button', { class: 'btn primary', type: 'submit' }, T('res.appliquer')))];
  }
  function garde(f, o) {
    const donnees = f.donnees ?? [], effacables = donnees.filter((d) => d.effacable), jamais = donnees.filter((d) => !d.effacable);
    const champ = el('input', { id: 'arkNom', type: 'text', autocomplete: 'off', spellcheck: 'false', value: K.suppTxt });
    const ok = bouton(K.suppData ? T('s.okDonnees') : T('s.ok'), async () => {
      if (K.suppData && !peutEffacer(K.suppTxt, f.nom)) return;
      const r = await geste('naglfar', 'supprimer_fiche', { conteneur: f.nom, donnees: K.suppData ? 'effacer' : 'garder', nom_tape: K.suppData ? K.suppTxt : '' });
      if (r.ok !== false) { K.fiche = ''; K.supp = ''; K.suppData = false; K.suppTxt = ''; }
      o.reload();
    }, { cls: 'danger-fill', disabled: K.suppData && !peutEffacer(K.suppTxt, f.nom) });
    champ.addEventListener('input', () => { K.suppTxt = champ.value; ok.disabled = !peutEffacer(K.suppTxt, f.nom); });
    const choix = (v, texte) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(K.suppData === v), onclick: () => { K.suppData = v; o.reload(); } }, texte);
    const non = bouton(T('s.non'), () => { K.supp = ''; K.suppData = false; K.suppTxt = ''; o.reload(); });
    const boite = el('section', { class: 'ark-guard', role: 'alertdialog', 'aria-labelledby': 'arkSuppT', onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); non.click(); } } },
      el('b', { id: 'arkSuppT' }, T('s.titre', { nom: f.nom })), el('p', {}, T('s.texte')),
      el('ul', {}, el('li', {}, T('s.part', { port: f.ports[0] ? T('s.port', { port: f.ports[0].hote }) : '' })), el('li', {}, T('s.reste', { base: f.base ? T('s.base') : '' }))),
      effacables.length ? [el('div', { class: 'ark-h3' }, T('s.groupe')), el('ul', { class: 'ark-dossiers' }, ...effacables.map((d) => el('li', {}, d.dossier))),
        el('div', { class: 'ark-seg', role: 'radiogroup', 'aria-label': T('s.groupe') }, choix(false, T('s.garder')), choix(true, T('s.effacer')))] : el('p', {}, T('s.sansDonnees')),
      ...jamais.map((d) => el('p', { class: 'ark-note' }, T('s.jamais', { dossier: d.dossier, raison: d.raison ?? '' }))),
      K.suppData ? el('div', { class: 'ark-confirm' }, el('label', { for: 'arkNom' }, T('s.confirmer', { nom: f.nom })), champ) : null,
      el('div', { class: 'ark-row' }, ok, non));
    setTimeout(() => (K.suppData ? champ : non).focus?.(), 0);
    return boite;
  }
  function fiche(f, t, o) {
    const ft = [['journal', T('f.journal')], ['terminal', T('f.terminal')], ['reglages', T('f.reglages')], ['ressources', T('f.ressources')]];
    const c = t.conteneurs.find((x) => x.nom === f.nom) ?? f;
    const [ton, etat] = etatDe(c);
    const ici = location.hostname || 'localhost';
    const adresse = f.ports[0] ? el('a', { href: `http://${ici}:${f.ports[0].hote}`, target: '_blank', rel: 'noopener noreferrer' }, `http://${ici}:${f.ports[0].hote}`) : T('f.aucuneAdresse');
    const aller = (k) => { K.ftab = k; arreterMinuteur(); o.reload(); };
    const onglets = el('div', { class: 'ark-tabs', role: 'tablist', 'aria-label': T('f.parties', { nom: f.nom }) }, ...ft.map(([k, n], i) => el('button', { type: 'button', role: 'tab', id: `ark-t-${k}`, 'aria-selected': String(K.ftab === k), tabindex: K.ftab === k ? '0' : '-1', onclick: () => aller(k),
      onkeydown: (e) => { const j = e.key === 'ArrowRight' ? (i + 1) % ft.length : e.key === 'ArrowLeft' ? (i + ft.length - 1) % ft.length : e.key === 'Home' ? 0 : e.key === 'End' ? ft.length - 1 : -1; if (j >= 0) { e.preventDefault(); aller(ft[j][0]); setTimeout(() => document.getElementById(`ark-t-${ft[j][0]}`)?.focus(), 0); } } }, n)));
    const corps = K.ftab === 'terminal' ? ongletTerminal(f, o) : K.ftab === 'reglages' ? ongletReglages(f) : K.ftab === 'ressources' ? ongletRessources({ ...f, cpu: c.cpu ?? f.cpu, memoire: c.memoire ?? f.memoire, memoireReglee: f.limiteMemoire }, o) : ongletJournal(f);
    return [
      el('div', { class: 'ark-row' }, bouton(`← ${T('retour')}`, () => { K.fiche = ''; K.supp = ''; arreterMinuteur(); o.reload(); }, { label: T('retour.nom') })),
      K.supp === f.nom ? garde(f, o) : null,
      el('section', { class: 'ark-sec' },
        el('div', { class: 'ark-fhead' }, mono(f.nom), el('div', { style: 'min-width:0' }, el('h2', {}, f.nom, tag(ton, etat)), el('small', {}, f.service ? `${T('tag.service', { service: f.service })} · ${f.image}` : f.image))),
        el('div', { class: 'ark-facts' },
          el('div', { class: 'ark-fact' }, el('small', {}, T('f.adresse')), el('b', {}, adresse)),
          el('div', { class: 'ark-fact' }, el('small', {}, T('f.reseau')), el('b', {}, f.ip ?? T('m.sans'))),
          el('div', { class: 'ark-fact' }, el('small', {}, T('f.depuis')), el('b', {}, f.enMarche ? duree(f.depuis) : T('m.sans'))),
          el('div', { class: 'ark-fact' }, el('small', {}, T('f.relances')), el('b', {}, String(f.relances ?? 0)))),
        el('div', { class: 'ark-row' },
          ...(f.enMarche ? [bouton(T('redemarrer'), () => geste('naglfar', 'geste_fiche', { conteneur: f.nom, geste: 'redemarrer' }, o.reload)), bouton(T('arreter'), () => geste('naglfar', 'geste_fiche', { conteneur: f.nom, geste: 'arreter' }, o.reload))]
            : [bouton(T('demarrer'), () => geste('naglfar', 'geste_fiche', { conteneur: f.nom, geste: 'demarrer' }, o.reload), { cls: 'primary' })]),
          f.majDispo ? bouton(T('f.maj'), () => geste('naglfar', 'mettre_a_jour', { conteneur: f.nom }, o.reload)) : bouton(T('f.ajour'), null, { disabled: true }),
          bouton(T('f.supprimer'), () => { K.supp = f.nom; K.suppData = false; K.suppTxt = ''; arreterMinuteur(); o.reload(); }, { cls: 'danger' })),
        onglets, el('div', { role: 'tabpanel', 'aria-labelledby': `ark-t-${K.ftab}` }, ...corps)),
    ];
  }

  window.OdinPages.naglfar = async ({ host, generic, reload, info }) => {
    arreterMinuteur();
    const nom = info?.name || MOTS.nom;
    const r = await post('naglfar', 'tableau');
    if (!r?.data) return false; // un Odin d'avant le lot K1 : la page générique, comme avant
    css();
    const t = r.data, root = el('div', { class: 'ark' }), o = { reload, nom };
    host.append(root);
    if (K.msg) root.append(el('p', { class: 'ark-msg', role: 'status' }, K.msg));
    if (!t.moteur) { root.append(carteSansMoteur(t)); return true; }
    if (t.erreur) root.append(el('p', { class: 'ark-msg', role: 'alert' }, T('erreurLecture', { raison: t.erreur })));
    if (K.fiche) {
      const f = await post('naglfar', 'fiche', { conteneur: K.fiche });
      if (f?.data) { root.append(...fiche(f.data, t, o).filter(Boolean)); return true; }
      K.msg = T('f.introuvable'); K.fiche = ''; K.supp = '';
    }
    // Le tableau : les services mis à l'échelle d'abord (s'il y en a), puis ce qui tourne, les arrêtés, les mises à jour.
    const sv = await post('naglfar', 'services').catch(() => ({})), list = sv.data ?? [];
    if (list.length) { const h = el('div', {}); await pageServices({ host: h, reload, nom }, list); root.append(h); }
    root.append(...tableau(t, o));
    // Le reste de l'appli (lancer une appli, images, nouvelles versions…), dessous ; les conteneurs y sont déjà au-dessus.
    const reste = generic.filter((n) => !(n.querySelector?.('h2')?.textContent === 'Conteneurs'));
    if (reste.length) host.append(el('h2', { style: 'margin:8px 0 10px;font-size:17px' }, T('reste.titre')), ...reste);
    // Le tableau se relit tout seul toutes les 5 secondes quand la page est visible (et pas pendant qu'on écrit).
    K.minuteur = setTimeout(() => {
      const a = document.activeElement;
      if (!root.isConnected || K.fiche || document.visibilityState === 'hidden' || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      reload();
    }, 5000);
    return true;
  };
  window.OdinArche = { MOTS, logique, etat: K };
})();
