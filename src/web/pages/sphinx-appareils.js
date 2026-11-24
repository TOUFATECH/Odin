// Sphinx · « Appareils (DHCP) » (maquette « Réseau » validée, lot R2) : « voir quelle machine récupère l'adresse IP »
// et « pouvoir bloquer les machines ».
//   - 4 chiffres ; la bannière des nouveaux appareils (« Je le connais », « Bloquer », « Fiche ») ;
//   - la liste en direct : nom, type deviné, fabricant d'après l'adresse MAC, adresse MAC, adresse IP, depuis → jusqu'à,
//     connecté ou non ; recherche ; filtres Tous / Connectés / Nouveaux / Adresse fixe / Bloqués ; type ;
//   - la fiche d'un appareil (son nom se change là) ;
//   - « Bloquer », « Mettre en pause », « Débloquer », avec le garde-fou DANS la page : le nom de l'appareil, ce qui
//     sera fait, ce qu'Odin ne peut pas faire (dit par le serveur, mot pour mot), et un avertissement clair quand
//     c'est l'appareil que tu tiens. La box et Odin sont verrouillés.
// Tout ce qui est vrai vient du serveur (lecture « baux_vus ») ; les gestes passent par l'action « dhcp_mac_etat »
// (propriétaire seul, garde-fou côté serveur). Un nom d'appareil vient du réseau : il est TOUJOURS posé comme du
// texte, jamais comme du HTML. Tous les textes de la page sont dans MOTS.
// Les autres écrans de Sphinx (lots suivants) s'ajoutent par window.OdinSphinx.ajouter({ id, titre, dessiner }).
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;
  W.OdinPages = W.OdinPages || {};

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    onglet: 'Appareils (DHCP)', tout: 'Tout', onglets: 'Écrans de Sphinx', nouv: '{n} nouv.',
    'c.co': 'Connectés maintenant', 'c.connus': 'Appareils connus', 'c.neu': 'Nouveaux, inconnus', 'c.bloq': 'Bloqués ou en pause',
    'box.titre': 'La box distribue les adresses',
    'box.texte': 'Odin montre ici les appareils qu\'il a déjà servis. Tant que la box distribue les adresses, il ne peut ni retirer une adresse ni sortir un appareil du réseau : « Bloquer » est seulement noté, et appliqué dès qu\'Odin distribuera les adresses.',
    'membre.titre': 'Ce que tu vois',
    'ban.un': 'Un nouvel appareil sur le réseau de la maison', 'ban.n': '{n} nouveaux appareils sur le réseau de la maison',
    'ban.lead': 'Odin ne les connaît pas. Tu les reconnais ?', 'ban.arrive': 'arrivé {quand}', 'ban.attend': 'attend ton accord, sans adresse',
    'b.connu': 'Je le connais', 'b.bloquer': 'Bloquer', 'b.fiche': 'Fiche',
    'l.titre': 'Qui a quelle adresse', 'l.direct': 'en direct',
    'l.lead': 'Chaque appareil qui a reçu une adresse du DHCP d\'Odin : son nom, son adresse MAC, son fabricant (d\'après la MAC), depuis quand et jusqu\'à quand (le bail).',
    'l.signe': '« Connecté » : Odin a eu un signe de lui depuis moins de 10 minutes (une demande d\'adresse, ou une question au DNS d\'Odin).',
    'l.chercher': 'Chercher un appareil', 'l.chercher.ex': 'Nom, adresse IP, adresse MAC, fabricant…', 'l.type': 'Type d\'appareil', 'l.types': 'Tous les types', 'l.filtres': 'Filtres',
    'f.tout': 'Tous', 'f.co': 'Connectés', 'f.neu': 'Nouveaux', 'f.fixe': 'Adresse fixe', 'f.bloq': 'Bloqués',
    'l.col.nom': 'Appareil', 'l.col.ip': 'Adresse IP', 'l.col.bail': 'Depuis → jusqu\'à', 'l.col.etat': 'État',
    'l.vide': 'Aucun appareil ne correspond.', 'l.aucun': 'Aucun appareil pour l\'instant : ils apparaissent dès qu\'ils demandent une adresse à Odin.',
    'l.fiche': 'Fiche de {nom}', 'l.sans': 'aucune adresse',
    't.neu': 'nouveau', 't.fixe': 'fixe', 't.privee': 'privée', 't.ici': 'ton appareil',
    'e.co': 'connecté', 'e.bail': 'vu {quand}', 'e.bail0': 'pas de signe récent', 'e.absent': 'pas connecté',
    'e.bloque': 'bloqué · retiré du réseau', 'e.bloque.tient': 'bloqué · lâche son adresse au plus tard {quand}',
    'e.pause': 'en pause', 'e.pause.tient': 'en pause · perd le réseau au plus tard {quand}', 'e.attente': 'attend ton accord',
    'fi.choisir': 'Choisis un appareil pour voir sa fiche.', 'fi.retour': 'Tous les appareils', 'fi.nom': 'Nom de l\'appareil', 'fi.nom.ok': 'Enregistrer le nom',
    'fi.neu': 'Nouveau : arrivé {quand}. Donne-lui un nom si tu le connais.', 'fi.ici': 'C\'est l\'appareil que tu tiens en ce moment.',
    'fi.ip': 'Adresse IP', 'fi.mac': 'Adresse MAC', 'fi.fab': 'Fabricant (d\'après la MAC)', 'fi.fab.prive': '— (adresse MAC privée)', 'fi.fab.inconnu': 'pas dans la table d\'Odin',
    'fi.type': 'Type (deviné)', 'fi.sys': 'Système (deviné)', 'fi.reseau': 'Nom sur le réseau', 'fi.depuis': 'Adresse reçue', 'fi.jusqua': 'Jusqu\'à (bail)', 'fi.vu': 'Dernier signe', 'fi.premier': 'Vu la première fois',
    'fi.fixe': ' (fixe)', 'fi.rien': '—',
    'g.box.titre': 'C\'est la box : la passerelle de toute la maison', 'g.odin.titre': 'C\'est Odin lui-même', 'g.dns.titre': 'C\'est le serveur DNS de la maison : celui qu\'Odin donne à tous les appareils',
    'g.verrou': 'Il ne peut être ni bloqué ni mis en pause : le couper priverait tout le réseau.',
    'a.bloquer': 'Bloquer : retirer du réseau', 'a.pause': 'Mettre en pause', 'a.debloquer': 'Débloquer : il retrouve une adresse', 'a.finpause': 'Fin de la pause',
    'a.proprio': 'Bloquer, mettre en pause et débloquer : le propriétaire seul.',
    'k.bloque': 'Bloquer « {nom} » ?', 'k.pause': 'Mettre en pause « {nom} » ?',
    'k.fait': 'Ce qui sera fait', 'k.limites': 'Ce qu\'Odin ne peut pas faire',
    'k.ici': 'C\'est l\'appareil que tu tiens en ce moment : tu vas te couper d\'Odin, et tu ne pourras plus revenir en arrière depuis cet appareil.',
    'k.inconnu': 'Odin ne sait pas depuis quel appareil tu agis. Si « {nom} » est celui que tu tiens, tu perds Odin avec lui.',
    'k.apres': 'Tu peux le débloquer à tout moment (filtre « Bloqués »).',
    'k.ok.bloque': 'Bloquer « {nom} »', 'k.ok.pause': 'Mettre en pause « {nom} »', 'k.ok.ici.bloque': 'C\'est mon appareil, bloquer quand même', 'k.ok.ici.pause': 'C\'est mon appareil, mettre en pause quand même',
    'k.plutot': 'Plutôt en pause', 'k.annuler': 'Annuler', 'k.demande': 'Odin vérifie…',
    'r.silence': 'Odin ne répond pas.', 'r.lecture': 'Odin n\'a pas pu lire les appareils.',
    'q.aujourdhui': 'à {h}', 'q.hier': 'hier à {h}', 'q.jours': 'il y a {n} jours', 'q.demain': 'demain à {h}', 'q.le': 'le {j} à {h}',
  };
  const mot = (k, v = {}) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? ''));

  // ---------------------------------------------------------------- petits outils
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : String(v)); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  };
  const NS = 'http://www.w3.org/2000/svg';
  const TRAITS = {
    tel: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2', tab: 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
    pc: 'M4 5h16v11H4zM9 20h6M12 16v4', lap: 'M5 6h14v9H5zM3 18h18', tv: 'M3 6h18v11H3zM8 21h8', imp: 'M7 8V4h10v4M5 8h14v8H5zM8 14h8v6H8z',
    cam: 'M4 8h11v8H4zM15 11l5-3v8l-5-3', box: 'M4 14h16v5H4zM8 17h.01M12 8a5 5 0 0 1 5 2M12 5a8 8 0 0 1 7 3', srv: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01',
    jeu: 'M7 8h10a4 4 0 0 1 4 4v2a3 3 0 0 1-5 2l-1-1H9l-1 1a3 3 0 0 1-5-2v-2a4 4 0 0 1 4-4zM8 11v2M7 12h2M16 12h.01', obj: 'M12 4a5 5 0 0 1 3 9v2H9v-2a5 5 0 0 1 3-9zM10 19h4',
    inc: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 16.5h.01',
    ban: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM6 6l12 12', pause: 'M9 5v14M15 5v14', check: 'M5 12l5 5 9-10', left: 'M14 6l-6 6 6 6',
    shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z', warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  };
  function ic(nom, taille = 20) {
    const s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: taille, height: taille, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) s.setAttribute(k, String(v));
    p.setAttribute('d', TRAITS[nom] || TRAITS.inc); s.append(p); return s;
  }
  /** Une heure lisible, près de maintenant (« à 14:02 », « hier à 18:02 », « il y a 3 jours »). Pur. */
  function quand(t, maintenant = Date.now()) {
    if (!t) return mot('fi.rien');
    const d = new Date(t), n = new Date(maintenant), h = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), ecart = Math.round((jour(d) - jour(n)) / 86400000);
    if (ecart === 0) return mot('q.aujourdhui', { h });
    if (ecart === -1) return mot('q.hier', { h });
    if (ecart === 1) return mot('q.demain', { h });
    if (ecart < -1 && ecart > -31) return mot('q.jours', { n: -ecart });
    return mot('q.le', { j: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, h });
  }
  /** L'état d'un appareil en mots, et sa couleur (ok, off, warn, bad). Pur. */
  function etatDe(d, maintenant = Date.now()) {
    if (d.etat === 'bloque') return d.retire ? ['bad', mot('e.bloque')] : ['bad', mot('e.bloque.tient', { quand: quand(d.jusqua, maintenant) })];
    if (d.etat === 'pause') return ['warn', d.jusqua ? mot('e.pause.tient', { quand: quand(d.jusqua, maintenant) }) : mot('e.pause')];
    if (d.etat === 'attente') return ['warn', mot('e.attente')];
    if (d.connecte) return ['ok', mot('e.co')];
    if (d.presence === 'bail') return ['off', d.vu ? mot('e.bail', { quand: quand(d.vu, maintenant) }) : mot('e.bail0')];
    return ['off', mot('e.absent')];
  }
  /** Les appareils que la recherche, le filtre et le type gardent. Pur. */
  function filtrer(liste, o) {
    const q = String(o.q || '').trim().toLowerCase();
    return liste.filter((d) => {
      if (o.fil === 'co' && !(d.connecte && d.etat === 'actif')) return false;
      if (o.fil === 'neu' && !d.nouveau) return false;
      if (o.fil === 'fixe' && !d.fixe) return false;
      if (o.fil === 'bloq' && d.etat !== 'bloque' && d.etat !== 'pause') return false;
      if (o.type && o.type !== 'tout' && d.type !== o.type) return false;
      if (q && !`${d.nom} ${d.ip} ${d.mac} ${d.fabricant} ${d.typeNom} ${d.systeme}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  const CSS = `
.sa{display:flex;flex-direction:column;gap:14px;min-width:0;color:var(--ink)}
.sa *{box-sizing:border-box}
.sa-tabs{display:flex;gap:8px;flex-wrap:wrap}
.sa-tab{min-height:44px;padding:0 16px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 14px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:8px}
.sa-tab[aria-selected="true"]{background:var(--ink);color:var(--bg,#fff);border-color:var(--ink)}
.sa-pastille{font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--warn);color:var(--bg,#fff)}
.sa-card{border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:16px;min-width:0}
.sa-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.sa-stat{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:10px 14px;min-width:0}
.sa-stat small{display:block;color:var(--muted);font-size:12.5px}
.sa-stat b{font-size:22px;font-weight:700}
.sa-stat.ok b{color:var(--good)}.sa-stat.warn b{color:var(--warn)}.sa-stat.bad b{color:var(--bad)}
.sa-note{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);border-radius:14px;background:var(--panel2,var(--panel));padding:12px 14px;font-size:13.5px;line-height:1.5}
.sa-note b{display:block;font-size:14.5px}
.sa-note p{margin:2px 0 0;color:var(--muted)}
.sa-note svg{flex:none;color:var(--accent);margin-top:2px}
.sa-ban{display:flex;gap:14px;align-items:flex-start;padding:14px 16px;border-radius:16px;border:2px solid var(--warn);background:color-mix(in srgb,var(--warn) 12%,var(--panel))}
.sa-ban>div{flex:1;min-width:0}
.sa-ban .sa-t{font-size:15px;font-weight:700;display:block}
.sa-face{width:48px;height:48px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#ffe3a0,#e19b1f);display:flex;align-items:center;justify-content:center;gap:7px;flex:none}
.sa-face i{display:block;width:6px;height:14px;background:#fff;border-radius:3px}
.sa-nd{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line);margin-top:8px}
.sa-nd .sa-qui{flex:1;min-width:180px;font-size:13px;overflow-wrap:anywhere}
.sa-nd .sa-qui b{font-size:14px}
.sa-muted{color:var(--muted)}
.sa-mono{font-family:ui-monospace,Consolas,monospace;font-size:.95em}
.sa-btn{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13.5px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:8px;text-align:left;line-height:1.2}
.sa-btn:disabled{opacity:.5;cursor:not-allowed}
.sa-btn.dng{background:var(--bad);border-color:var(--bad);color:var(--bg,#fff)}
.sa-btn.pri{background:var(--accent);border-color:var(--accent);color:var(--on-accent,var(--bg,#fff))}
.sa-btn.ghost{background:none}
.sa :is(button,input,select,a):focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.sa-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px;align-items:start}
.sa-card h2{margin:0;font-size:17px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.sa-live{font-size:12.5px;font-weight:600;color:var(--bad);display:inline-flex;align-items:center;gap:6px}
.sa-live::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--bad)}
.sa-lead{margin:6px 0 12px;font-size:13px;color:var(--muted);line-height:1.5}
.sa-outils{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.sa-outils input,.sa-outils select,.sa-nomz input{min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel2,var(--panel));color:var(--ink);padding:0 12px;font:14px inherit;min-width:0}
.sa-outils input{flex:1 1 220px}
.sa-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.sa-chip{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:500 13.5px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:8px}
.sa-chip[aria-pressed="true"]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--panel));font-weight:700}
.sa-cnt{font-size:12px;font-weight:700;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--muted) 18%,transparent)}
.sa-liste{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.sa-tete,.sa-row{display:grid;grid-template-columns:40px minmax(0,1.7fr) minmax(0,.9fr) minmax(0,1fr) minmax(0,1.2fr);gap:10px;align-items:center}
.sa-tete{font-size:11.5px;color:var(--muted);font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:6px 8px}
.sa-row{width:100%;min-height:60px;border:0;border-top:1px solid var(--line);background:none;color:var(--ink);font:13px inherit;text-align:left;padding:6px 8px;cursor:pointer;border-radius:0}
.sa-row:hover{background:color-mix(in srgb,var(--muted) 8%,transparent)}
.sa-row[aria-current="true"]{background:color-mix(in srgb,var(--accent) 12%,transparent)}
.sa-row.coupe .sa-nm,.sa-row.coupe .sa-ip,.sa-row.coupe .sa-qd{opacity:.65}
.sa-lg{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--muted) 14%,transparent);color:var(--accent);flex:none}
.sa-nm{min-width:0}
.sa-nm b{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:14px;font-weight:600;overflow-wrap:anywhere}
.sa-nm small{display:block;color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.sa-ip,.sa-qd{font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.sa-qd small{display:block;color:var(--muted)}
.sa-tag{font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--muted) 18%,transparent);white-space:nowrap}
.sa-tag.warn{background:color-mix(in srgb,var(--warn) 22%,transparent);color:var(--warn)}
.sa-tag.acc{background:color-mix(in srgb,var(--accent) 20%,transparent);color:var(--accent)}
.sa-co{display:inline-flex;align-items:baseline;gap:6px;font-size:12.5px;min-width:0}
.sa-co::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--good);flex:none}
.sa-co.off::before{background:var(--muted);opacity:.6}.sa-co.bad::before{background:var(--bad)}.sa-co.warn::before{background:var(--warn)}
.sa-vide{margin:14px 0 4px;color:var(--muted);font-size:13.5px}
.sa-fiche .sa-hd{display:flex;gap:12px;align-items:center}
.sa-fiche .sa-hd .sa-lg{width:52px;height:52px;border-radius:15px}
.sa-fiche h3{margin:0;font-size:17px;overflow-wrap:anywhere}
.sa-nomz{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.sa-nomz input{flex:1 1 150px}
.sa-avis{font-size:13px;font-weight:600;margin:10px 0 0;display:flex;gap:8px;align-items:flex-start;line-height:1.4}
.sa-avis svg{flex:none}
.sa-avis.warn{color:var(--warn)}.sa-avis.bad{color:var(--bad)}
.sa-faits{margin:12px 0 0;display:grid;grid-template-columns:minmax(0,1fr)}
.sa-faits div{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:13px}
.sa-faits dt{color:var(--muted);flex:none}
.sa-faits dd{margin:0;text-align:right;font-weight:600;overflow-wrap:anywhere;min-width:0}
.sa-garde{margin:12px 0 0;border:2px solid var(--bad);border-radius:14px;background:color-mix(in srgb,var(--bad) 9%,var(--panel));padding:14px;font-size:13.5px;line-height:1.5}
.sa-garde.calme{border-color:var(--line);border-width:1px;background:var(--panel2,var(--panel))}
.sa-garde b.sa-gt{display:block;font-size:15px;margin-bottom:4px;overflow-wrap:anywhere}
.sa-garde h4{margin:10px 0 2px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.sa-garde ul{margin:0;padding-left:18px}
.sa-garde li{padding:2px 0}
.sa-garde p{margin:8px 0 0}
.sa-garde .sa-fort{font-weight:700;color:var(--bad)}
.sa-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.sa-acts .sa-btn{flex:1 1 150px;justify-content:flex-start}
.sa-res{margin:12px 0 0;white-space:pre-line;font-size:13px;line-height:1.5;border-left:3px solid var(--accent);padding:2px 0 2px 10px;overflow-wrap:anywhere}
.sa-res.non{border-left-color:var(--bad)}
.sa-retour{display:none;margin-bottom:12px}
@media (max-width:1100px){.sa-grid{grid-template-columns:minmax(0,1fr)}.sa-ecran.sa-vue-fiche .sa-cache-fiche{display:none}.sa-ecran.sa-vue-fiche .sa-retour{display:inline-flex}.sa-ecran:not(.sa-vue-fiche) .sa-fiche{display:none}}
@media (max-width:720px){
  .sa-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .sa-ban{flex-direction:column}.sa-nd .sa-btn{flex:1 1 auto;justify-content:center}
  .sa-tete{display:none}
  .sa-row{grid-template-columns:40px minmax(0,1fr);row-gap:2px;padding:10px 4px}
  .sa-row .sa-lg{grid-row:1/5;align-self:start}
  .sa-row .sa-ip,.sa-row .sa-qd,.sa-row .sa-et{grid-column:2}
  .sa-qd small{display:inline}
}
@media (prefers-reduced-motion:no-preference){.sa-row,.sa-chip,.sa-btn{transition:background .12s ease}}
`;
  function style() { if (!document.getElementById('sa-css')) document.head.append(el('style', { id: 'sa-css' }, CSS)); }

  // ---------------------------------------------------------------- les demandes au serveur
  const demander = async (action, input = {}, confirm = false) => {
    try { return await (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'vidarr', action, input, confirm }) })).json(); }
    catch { return { ok: false, text: mot('r.silence') }; }
  };

  // ---------------------------------------------------------------- l'écran « Appareils »
  const TYPES = ['tel', 'tab', 'pc', 'lap', 'tv', 'imp', 'cam', 'box', 'srv', 'jeu', 'obj', 'inc'];
  /** Monte l'écran dans `racine`. Rend { relire, arreter }. */
  function ecran(racine) {
    const S = { q: '', fil: 'tout', type: 'tout', fiche: '', vue: 'liste', garde: null, res: null, D: null, occupe: false, nom: null };
    const zNote = el('div', {}), zStats = el('div', {}), zBan = el('div', {}), zListe = el('div', {}), zFiche = el('div', {}), zChips = el('div', { class: 'sa-chips', role: 'group', 'aria-label': mot('l.filtres') });
    const typeSel = el('select', { 'aria-label': mot('l.type'), 'data-f': 'type', onchange: (e) => { S.type = e.target.value; liste(); } });
    const cherche = el('input', { type: 'search', placeholder: mot('l.chercher.ex'), 'aria-label': mot('l.chercher'), autocomplete: 'off', spellcheck: 'false', 'data-f': 'q', oninput: (e) => { S.q = e.target.value; liste(); } });
    const retour = el('button', { type: 'button', class: 'sa-btn sa-retour', 'data-f': 'retour', onclick: () => { const mac = S.fiche; S.vue = 'liste'; S.garde = null; vues(); viser(`row:${mac}`); } }, ic('left'), mot('fi.retour'));
    const carte = el('section', { class: 'sa-card sa-cache-fiche' },
      el('h2', {}, mot('l.titre'), el('span', { class: 'sa-live' }, mot('l.direct'))),
      el('p', { class: 'sa-lead' }, mot('l.lead'), ' ', mot('l.signe')),
      el('div', { class: 'sa-outils' }, cherche, typeSel), zChips, zListe);
    racine.classList.add('sa-ecran');
    racine.append(el('div', { class: 'sa-cache-fiche' }, zNote), el('div', { class: 'sa-cache-fiche' }, zStats), el('div', { class: 'sa-cache-fiche' }, zBan), retour, el('div', { class: 'sa-grid' }, carte, zFiche));

    const appareils = () => S.D?.appareils ?? [];
    const proprio = () => S.D?.proprietaire === true;
    const viser = (cle) => { for (const n of racine.querySelectorAll('[data-f]')) if (n.getAttribute('data-f') === cle) { n.focus(); return true; } return false; };
    const vues = () => { const hote = racine; if (S.vue === 'fiche' && S.fiche) hote.classList.add('sa-vue-fiche'); else hote.classList.remove('sa-vue-fiche'); };
    const ouvrir = (mac, o = {}) => { if (S.fiche !== mac) { S.res = null; S.nom = null; } S.fiche = mac; S.vue = 'fiche'; S.garde = o.garde ?? null; liste(); fiche(); vues(); if (!viser(o.viser ?? 'retour')) viser(`row:${mac}`); };

    function notes() {
      const D = S.D, n = [];
      if (D && D.limite) n.push(el('div', { class: 'sa-note', role: 'note' }, ic('shield'), el('div', {}, el('b', {}, mot('membre.titre')), el('p', {}, D.limite))));
      else if (D && !D.dhcp.allume) n.push(el('div', { class: 'sa-note', role: 'note' }, ic('shield'), el('div', {}, el('b', {}, mot('box.titre')), el('p', {}, mot('box.texte')))));
      zNote.replaceChildren(...n);
    }
    function stats() {
      const c = S.D?.chiffres ?? { connectes: 0, connus: 0, nouveaux: 0, bloques: 0 };
      const une = (k, v, ton) => el('div', { class: `sa-stat ${ton}` }, el('small', {}, mot(k)), el('b', {}, String(v)));
      zStats.replaceChildren(el('div', { class: 'sa-stats' }, une('c.co', c.connectes, 'ok'), une('c.connus', c.connus, ''), une('c.neu', c.nouveaux, c.nouveaux ? 'warn' : ''), une('c.bloq', c.bloques, c.bloques ? 'bad' : '')));
    }
    function banniere() {
      const nv = appareils().filter((d) => d.nouveau);
      if (!nv.length || !proprio()) return void zBan.replaceChildren();
      zBan.replaceChildren(el('div', { class: 'sa-ban', role: 'status' },
        el('span', { class: 'sa-face', 'aria-hidden': 'true' }, el('i'), el('i')),
        el('div', {}, el('span', { class: 'sa-t' }, nv.length === 1 ? mot('ban.un') : mot('ban.n', { n: nv.length })), el('span', { class: 'sa-muted' }, mot('ban.lead')),
          nv.map((d) => el('div', { class: 'sa-nd' },
            el('span', { class: 'sa-qui' }, el('b', {}, d.nom), d.ip ? ` · ${d.ip}` : '', ' · ', el('span', { class: 'sa-mono' }, d.mac), el('br'),
              el('span', { class: 'sa-muted' }, [d.fabricant || (d.prive ? mot('fi.fab.prive') : ''), d.systeme, d.etat === 'attente' ? mot('ban.attend') : d.premier ? mot('ban.arrive', { quand: quand(d.premier) }) : ''].filter(Boolean).join(' · '))),
            el('button', { type: 'button', class: 'sa-btn', 'data-f': `connu:${d.mac}`, onclick: () => connu(d) }, ic('check', 18), mot('b.connu')),
            el('button', { type: 'button', class: 'sa-btn dng', 'data-f': `bbloq:${d.mac}`, onclick: () => demanderGarde(d, 'bloque') }, ic('ban', 18), mot('b.bloquer')),
            el('button', { type: 'button', class: 'sa-btn ghost', 'data-f': `bfiche:${d.mac}`, onclick: () => ouvrir(d.mac) }, mot('b.fiche')))))));
    }
    function puces() {
      const l = appareils(), n = { tout: l.length, co: l.filter((d) => d.connecte && d.etat === 'actif').length, neu: l.filter((d) => d.nouveau).length, fixe: l.filter((d) => d.fixe).length, bloq: l.filter((d) => d.etat === 'bloque' || d.etat === 'pause').length };
      zChips.replaceChildren(...['tout', 'co', 'neu', 'fixe', 'bloq'].map((k) => el('button', { type: 'button', class: 'sa-chip', 'aria-pressed': String(S.fil === k), 'data-f': `fil:${k}`, onclick: () => { S.fil = k; puces(); liste(); viser(`fil:${k}`); } }, mot(`f.${k}`), el('span', { class: 'sa-cnt' }, String(n[k])))));
      const noms = new Map(l.map((d) => [d.type, d.typeNom]));
      typeSel.replaceChildren(el('option', { value: 'tout' }, mot('l.types')), ...TYPES.filter((k) => noms.has(k)).map((k) => el('option', { value: k, selected: S.type === k }, noms.get(k))));
      typeSel.value = noms.has(S.type) ? S.type : 'tout'; if (!noms.has(S.type)) S.type = 'tout';
    }
    function liste() {
      const tous = appareils(), l = filtrer(tous, S);
      if (!l.length) return void zListe.replaceChildren(el('p', { class: 'sa-vide' }, tous.length ? mot('l.vide') : mot('l.aucun')));
      const ligne = (d) => {
        const [ton, texte] = etatDe(d);
        return el('li', {}, el('button', { type: 'button', class: `sa-row${d.etat === 'bloque' || d.etat === 'pause' ? ' coupe' : ''}`, 'aria-current': S.fiche === d.mac ? 'true' : null, 'aria-label': mot('l.fiche', { nom: d.nom }), 'data-f': `row:${d.mac}`, onclick: () => ouvrir(d.mac) },
          el('span', { class: 'sa-lg' }, ic(d.type, 21)),
          el('span', { class: 'sa-nm' }, el('b', {}, d.nom, d.nouveau ? el('span', { class: 'sa-tag warn' }, mot('t.neu')) : null, d.fixe ? el('span', { class: 'sa-tag' }, mot('t.fixe')) : null, d.ici ? el('span', { class: 'sa-tag acc' }, mot('t.ici')) : null),
            el('small', {}, [d.typeNom, d.fabricant].filter(Boolean).join(' · '), ' · ', el('span', { class: 'sa-mono' }, d.mac))),
          el('span', { class: 'sa-ip sa-mono' }, d.ip || mot('l.sans')),
          el('span', { class: 'sa-qd' }, d.depuis ? quand(d.depuis) : mot('fi.rien'), ' ', el('small', {}, `→ ${d.jusqua ? quand(d.jusqua) : mot('fi.rien')}`)),
          el('span', { class: 'sa-et' }, el('span', { class: `sa-co ${ton}` }, texte))));
      };
      zListe.replaceChildren(el('div', { class: 'sa-tete', 'aria-hidden': 'true' }, el('span', {}), el('span', {}, mot('l.col.nom')), el('span', {}, mot('l.col.ip')), el('span', {}, mot('l.col.bail')), el('span', {}, mot('l.col.etat'))),
        el('ul', { class: 'sa-liste' }, l.map(ligne)));
    }
    function garde(d) {
      const g = S.garde, e = d.effets?.[g.etat] ?? { fait: [], limites: [] }, mien = d.ici || g.code === 'ici';
      const envoyer = async (etat) => {
        if (S.occupe) return; S.occupe = true; fiche(); viser('k-ok');
        const r = await demander('dhcp_mac_etat', { mac: d.mac, etat, nom: d.nom, ...(mien ? { le_mien: true } : {}) }, true);
        S.occupe = false; S.garde = null; S.res = { ok: r.ok !== false, text: String(r.text ?? r.error ?? '') };
        await relire(); viser(r.ok !== false ? 'a-debloquer' : 'a-bloquer') || viser('retour');
      };
      const annuler = () => { const cle = g.etat === 'pause' ? 'a-pause' : 'a-bloquer'; S.garde = null; fiche(); viser(cle); };
      return el('div', { class: 'sa-garde', role: 'alert', 'aria-live': 'assertive', onkeydown: (ev) => { if (ev.key === 'Escape') { ev.preventDefault?.(); annuler(); } } },
        el('b', { class: 'sa-gt' }, g.titre || mot(`k.${g.etat}`, { nom: d.nom })),
        mien ? el('p', { class: 'sa-fort' }, mot('k.ici')) : !S.D?.origineConnue ? el('p', { class: 'sa-fort' }, mot('k.inconnu', { nom: d.nom })) : null,
        e.fait.length ? [el('h4', {}, mot('k.fait')), el('ul', {}, e.fait.map((x) => el('li', {}, x)))] : null,
        e.limites.length ? [el('h4', {}, mot('k.limites')), el('ul', {}, e.limites.map((x) => el('li', {}, x)))] : null,
        el('p', {}, mot('k.apres')),
        el('div', { class: 'sa-acts' },
          el('button', { type: 'button', class: 'sa-btn dng', disabled: S.occupe, 'data-f': 'k-ok', onclick: () => envoyer(g.etat) }, ic(g.etat === 'pause' ? 'pause' : 'ban', 18), S.occupe ? mot('k.demande') : mot(mien ? `k.ok.ici.${g.etat}` : `k.ok.${g.etat}`, { nom: d.nom })),
          g.etat === 'bloque' ? el('button', { type: 'button', class: 'sa-btn', disabled: S.occupe, 'data-f': 'k-plutot', onclick: () => demanderGarde(d, 'pause') }, ic('pause', 18), mot('k.plutot')) : null,
          el('button', { type: 'button', class: 'sa-btn ghost', disabled: S.occupe, 'data-f': 'k-non', onclick: annuler }, mot('k.annuler'))));
    }
    /** Avant de montrer le garde-fou : le serveur nomme l'appareil (ou refuse : pas le propriétaire, la box, Odin). */
    async function demanderGarde(d, etat) {
      const r = await demander('dhcp_mac_etat', { mac: d.mac, etat, nom: d.nom }, false);
      if (r && r.confirm) { S.res = null; ouvrir(d.mac, { garde: { etat, titre: String(r.confirm).replace(/^Confirmer : /, '').replace(/\s*\u26a0[\s\S]*$/, '').replace(/\s*\?\s*$/, '').replace(/^./, (c) => c.toUpperCase()) + ' ?' }, viser: 'k-non' }); return; }
      // Pas de question posée : le serveur a refusé (ou, sans garde-fou côté serveur, a répondu) : on montre sa réponse telle quelle.
      S.res = { ok: r?.ok !== false && !r?.error, text: String(r?.text ?? r?.error ?? mot('r.silence')) };
      await relire(); ouvrir(d.mac, { viser: 'a-bloquer' });
    }
    async function connu(d, nom = '') {
      const r = await demander('dhcp_approuver', { mac: d.mac, nom });
      if (S.fiche === d.mac || r.ok === false) { S.res = { ok: r.ok !== false, text: String(r.text ?? r.error ?? '') }; }
      S.nom = null; await relire(); if (!viser(`row:${d.mac}`)) viser('q');
    }
    function fiche() {
      const d = appareils().find((x) => x.mac === S.fiche);
      if (!d) return void zFiche.replaceChildren(el('aside', { class: 'sa-card sa-fiche' }, el('p', { class: 'sa-vide' }, mot('fi.choisir'))));
      const [ton, texte] = etatDe(d), P = proprio();
      const fait = (k, v, mono) => el('div', {}, el('dt', {}, mot(k)), el('dd', mono ? { class: 'sa-mono' } : {}, v));
      const nomIn = P ? el('input', { type: 'text', maxlength: 63, value: S.nom ?? (d.nomDonne || d.nom !== 'Appareil sans nom' ? d.nom : ''), 'aria-label': mot('fi.nom'), autocomplete: 'off', spellcheck: 'false', 'data-f': 'nom', oninput: (e) => { S.nom = e.target.value; } }) : null;
      if (nomIn) nomIn.value = S.nom ?? (d.nomDonne || d.nom !== 'Appareil sans nom' ? d.nom : '');
      const actions = !P ? el('p', { class: 'sa-lead' }, mot('a.proprio'))
        : d.garde ? el('div', { class: 'sa-garde calme', role: 'note' }, el('b', { class: 'sa-gt' }, mot(`g.${d.garde}.titre`)), el('p', {}, mot('g.verrou')))
          : S.garde ? garde(d)
            : d.etat === 'bloque' || d.etat === 'pause'
              ? el('div', { class: 'sa-acts' }, el('button', { type: 'button', class: 'sa-btn pri', 'data-f': 'a-debloquer', onclick: async () => { const r = await demander('dhcp_mac_etat', { mac: d.mac, etat: 'actif', nom: d.nom }, true); S.res = { ok: r.ok !== false, text: String(r.text ?? r.error ?? '') }; await relire(); viser('a-bloquer') || viser('retour'); } }, ic('check', 18), mot(d.etat === 'bloque' ? 'a.debloquer' : 'a.finpause')),
                d.etat === 'pause' ? el('button', { type: 'button', class: 'sa-btn dng', 'data-f': 'a-bloquer', onclick: () => demanderGarde(d, 'bloque') }, ic('ban', 18), mot('a.bloquer')) : null)
              : el('div', { class: 'sa-acts' },
                el('button', { type: 'button', class: 'sa-btn dng', 'data-f': 'a-bloquer', onclick: () => demanderGarde(d, 'bloque') }, ic('ban', 18), mot('a.bloquer')),
                el('button', { type: 'button', class: 'sa-btn', 'data-f': 'a-pause', onclick: () => demanderGarde(d, 'pause') }, ic('pause', 18), mot('a.pause')));
      zFiche.replaceChildren(el('aside', { class: 'sa-card sa-fiche', 'aria-label': mot('l.fiche', { nom: d.nom }) },
        el('div', { class: 'sa-hd' }, el('span', { class: 'sa-lg' }, ic(d.type, 28)), el('div', { style: 'min-width:0;flex:1' }, el('h3', {}, d.nom), el('span', { class: `sa-co ${ton}` }, texte))),
        nomIn ? el('div', { class: 'sa-nomz' }, nomIn, el('button', { type: 'button', class: 'sa-btn', 'data-f': 'nom-ok', onclick: () => connu(d, nomIn.value) }, ic('check', 18), mot('fi.nom.ok'))) : null,
        d.nouveau ? el('p', { class: 'sa-avis warn' }, ic('warn', 18), d.etat === 'attente' ? mot('ban.attend') : mot('fi.neu', { quand: quand(d.premier) })) : null,
        d.ici ? el('p', { class: 'sa-avis warn' }, ic('shield', 18), mot('fi.ici')) : null,
        el('dl', { class: 'sa-faits' },
          fait('fi.ip', (d.ip || mot('fi.rien')) + (d.ip && d.fixe ? mot('fi.fixe') : ''), true),
          el('div', {}, el('dt', {}, mot('fi.mac')), el('dd', {}, el('span', { class: 'sa-mono' }, d.mac), d.prive ? [' ', el('span', { class: 'sa-tag warn' }, mot('t.privee'))] : null)),
          fait('fi.fab', d.prive ? mot('fi.fab.prive') : d.fabricant || mot('fi.fab.inconnu')),
          fait('fi.type', d.typeNom), d.systeme ? fait('fi.sys', d.systeme) : null,
          fait('fi.reseau', d.nomReseau || mot('fi.rien'), true),
          fait('fi.depuis', quand(d.depuis)), fait('fi.jusqua', quand(d.jusqua)), fait('fi.vu', quand(d.vu)), fait('fi.premier', quand(d.premier))),
        actions,
        S.res && S.res.text ? el('p', { class: `sa-res${S.res.ok ? '' : ' non'}`, role: 'status' }, S.res.text) : null));
    }
    function tout() { const cle = document.activeElement?.getAttribute?.('data-f'); notes(); stats(); banniere(); puces(); liste(); fiche(); vues(); if (cle) viser(cle); }
    let enVol = false;
    async function relire(o = {}) {
      // En direct : pas pendant un garde-fou ouvert ni pendant que tu tapes un nom (rien ne bouge sous tes doigts), et
      // jamais deux relectures en même temps (un Odin lent ne reçoit pas une pile de demandes).
      const fige = () => Boolean(S.garde || S.occupe || S.nom !== null);
      if (o.discret && (fige() || enVol)) return;
      let r; if (o.discret) enVol = true;
      try { r = await demander('baux_vus'); } finally { if (o.discret) enVol = false; }
      // La réponse arrive après coup : si tu as ouvert un garde-fou ou commencé à taper entre-temps, elle attend le tour suivant.
      if (o.discret && fige()) return;
      if (r && r.data && Array.isArray(r.data.appareils)) S.D = r.data;
      else if (!S.D) { S.D = { appareils: [], chiffres: null, dhcp: { allume: true }, proprietaire: false, limite: String(r?.text ?? r?.error ?? mot('r.lecture')) }; }
      if (S.fiche && !appareils().some((d) => d.mac === S.fiche)) { S.fiche = ''; S.vue = 'liste'; S.garde = null; }
      tout();
    }
    return { relire, etat: S };
  }

  // ---------------------------------------------------------------- la page de Sphinx : ses écrans, en onglets
  const ECRANS = [{ id: 'appareils', titre: () => mot('onglet'), dessiner: (n) => { const e = ecran(n); return { relire: e.relire, pret: e.relire() }; } }];
  W.OdinSphinx = W.OdinSphinx || {
    ecrans: ECRANS,
    /** Un autre écran de Sphinx (Adresses fixes, Réglages DHCP, Noms…) : { id, titre, dessiner(noeud) }. */
    ajouter(e) { if (e && e.id && !ECRANS.some((x) => x.id === e.id)) ECRANS.push({ ...e, titre: typeof e.titre === 'function' ? e.titre : () => String(e.titre ?? e.id) }); },
    MOTS, quand, etatDe, filtrer,
  };
  let minuteur = 0;
  W.OdinPages.vidarr = async ({ host, generic }) => {
    style();
    const racine = el('div', { class: 'sa' }), corps = el('div', { class: 'sa', role: 'tabpanel' }), gen = el('div', {}, ...(generic ?? []));
    const tabs = el('div', { class: 'sa-tabs', role: 'tablist', 'aria-label': mot('onglets') });
    let choisi = 'appareils', vivant = null;
    const ids = () => [...ECRANS.map((e) => e.id), 'tout'];
    const aller = async (id, viser) => {
      choisi = id; vivant = null;
      tabs.replaceChildren(...ids().map((k) => { const e = ECRANS.find((x) => x.id === k); return el('button', { type: 'button', role: 'tab', class: 'sa-tab', id: `sa-tab-${k}`, 'aria-selected': String(k === choisi), tabindex: k === choisi ? '0' : '-1', onclick: () => aller(k, true),
        onkeydown: (ev) => { const l = ids(), i = l.indexOf(k), j = ev.key === 'ArrowRight' ? (i + 1) % l.length : ev.key === 'ArrowLeft' ? (i + l.length - 1) % l.length : ev.key === 'Home' ? 0 : ev.key === 'End' ? l.length - 1 : -1; if (j >= 0) { ev.preventDefault?.(); aller(l[j], true); } } }, e ? e.titre() : mot('tout')); }));
      corps.setAttribute('aria-labelledby', `sa-tab-${id}`);
      gen.hidden = id !== 'tout'; corps.hidden = id === 'tout';
      if (viser) for (const b of tabs.children) if (b.getAttribute('aria-selected') === 'true') b.focus();
      if (id === 'tout') return;
      const n = el('div', { class: 'sa' }); corps.replaceChildren(n);
      const v = ECRANS.find((x) => x.id === id).dessiner(n); vivant = v ?? null;
      try { await v?.pret; } catch { /* l'écran dit lui-même ce qui ne va pas */ }
    };
    racine.append(tabs, corps, gen); host.append(racine);
    await aller(choisi);
    // En direct : relu toutes les 5 secondes tant que la page est ouverte et visible.
    clearInterval(minuteur);
    minuteur = setInterval(() => { if (!racine.isConnected) { clearInterval(minuteur); return; } if (!document.hidden && vivant?.relire) void vivant.relire({ discret: true }); }, 5000);
    return true;
  };
})();
