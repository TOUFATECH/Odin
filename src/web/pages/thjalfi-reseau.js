// Genèse · onglet « Réseau » (maquette validée « Genèse · Systèmes », lot S8) : le serveur de démarrage (DHCP).
//   - allumé ou éteint (un interrupteur ; allumer lance des services sur le réseau : Odin montre lesquels et attend ton
//     accord) ;
//   - quelle carte réseau : le câble (conseillé), le Wi-Fi (déconseillé : un PC ne démarre pas par le Wi-Fi), un réseau à
//     part (carte virtuelle, câble direct) ;
//   - les adresses : « À côté de la box » (conseillé : la box garde les adresses, Odin ajoute seulement « où démarrer »),
//     « Odin distribue les adresses » (seulement sur un réseau à part : plage, passerelle, bail), « Ma box s'en charge »
//     (les lignes exactes à recopier) ;
//   - LE GARDE-FOU : « Refusé : ça casserait le réseau de la maison » quand un autre serveur d'adresses répond sur la carte,
//     avec « Rester à côté de la box » ; sinon, en vert, ce qu'Odin a vérifié (et qu'il revérifie chaque minute) ;
//   - quels PC ont le droit de démarrer (seulement les autorisés, ou tous au menu seulement), la liste des autorisés
//     (retirer = il ne démarre plus par le réseau d'Odin), l'ajout par adresse MAC ;
//   - en direct : chaque PC qui demande à démarrer ; un inconnu → « Autoriser ».
// Tout ce qui est vrai vient du serveur (lecture « reseau ») ; la vérification de la carte, de la plage et l'absence d'un
// autre serveur d'adresses sont faites par le serveur (action « mode », propriétaire seul, avec ton accord pour
// distribuer). Une adresse MAC ou un nom de PC est toujours écrit comme du texte. Tous les textes sont dans MOTS.
// Expose window.OdinGeneseReseau = { onglets, dessiner(root, onglet, hote), MOTS }.
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    onglet: 'Réseau',
    'srv.titre': 'Serveur de démarrage', 'srv.allume': 'allumé', 'srv.eteint': 'éteint',
    'srv.lead': 'Répond aux PC qui démarrent par le réseau (PXE, BIOS et UEFI). Un PC inconnu démarre sur son propre disque.',
    'srv.note': 'Allumer lance des services sur le réseau de la maison : Odin te montre lesquels et attend ton accord.',
    'srv.nom': 'Serveur de démarrage allumé',
    'carte.titre': 'Quelle carte réseau ?', 'carte.lead': 'Celle par où les PC démarrent.', 'carte.groupe': 'Carte réseau',
    'carte.conseillee': 'conseillée', 'carte.deconseillee': 'déconseillée', 'carte.apart': 'réseau à part',
    'carte.cable': 'câble', 'carte.wifi': 'un PC ne démarre pas par le Wi-Fi', 'carte.virtuelle': 'carte virtuelle',
    'carte.auto': 'Aucune carte choisie : Odin prend celle de la maison (le câble d\'abord).',
    'carte.aucune': 'Aucune carte réseau lisible sur ce PC.',
    'adr.titre': 'Les adresses du réseau', 'adr.lead': 'Qui donne une adresse aux PC qui démarrent ?', 'adr.groupe': 'Mode DHCP',
    'adr.conseil': 'Conseillé',
    'adr.proxy': 'À côté de la box', 'adr.proxy.texte': 'La box garde les adresses ; Odin ajoute seulement « où démarrer ».',
    'adr.proxy.p1': 'Rien à changer sur la box', 'adr.proxy.p2': 'Sans risque pour le réseau de la maison',
    'adr.complet': 'Odin distribue les adresses', 'adr.complet.texte': 'Pour un réseau à part : câble direct entre Odin et les PC, ou réseau virtuel.',
    'adr.complet.p1': 'Une plage d\'adresses à choisir', 'adr.complet.p2': 'Refusé s\'il y a déjà une box sur la carte',
    'adr.aucun': 'Ma box s\'en charge', 'adr.aucun.texte': 'Tu règles toi-même la box (ou ton serveur d\'adresses) : Odin te donne les lignes exactes.',
    'adr.aucun.p1': 'Le bon fichier selon le PC (BIOS ou UEFI)', 'adr.aucun.p2': 'Pour un autre réseau, derrière un relais',
    'adr.odin': 'Le serveur d\'adresses d\'Odin', 'adr.odin.texte': 'Sphinx donne déjà les adresses de la maison et ajoute le démarrage.',
    'g.refus.titre': 'Refusé : ça casserait le réseau de la maison',
    'g.refus.texte': 'Un autre serveur d\'adresses ({qui}) répond déjà sur cette carte. Deux serveurs à la fois : les téléphones, la télé et les PC n\'auraient plus Internet.',
    'g.refus.l1': 'Garde « À côté de la box » : la box continue, Odin n\'ajoute que le démarrage.',
    'g.refus.l2': 'Ou choisis un réseau à part (câble direct, carte virtuelle) pour qu\'Odin distribue les adresses.',
    'g.coupe.titre': 'Odin a arrêté de distribuer les adresses',
    'g.nonverif.titre': 'Pas vérifié : Odin ne distribue rien',
    'g.carte.titre': 'Pas sur cette carte',
    'g.rester': 'Rester à côté de la box',
    'g.libre.titre': 'Aucun autre serveur d\'adresses sur ce réseau à part',
    'g.libre.texte': 'Odin l\'a vérifié{quand} et revérifie toutes les minutes : s\'il en voit un, il s\'arrête et te prévient.',
    'g.libre.arrete': 'Odin a vérifié la carte{quand}. Allume le serveur de démarrage pour commencer : il revérifiera avant.',
    'g.maison.titre': 'Le réseau de la maison n\'est pas touché',
    'g.maison.texte': 'Odin ne distribue aucune adresse : la box garde ce rôle. Il répond seulement aux PC qui demandent à démarrer par le réseau.',
    'g.odin.texte': 'Sphinx, le serveur d\'adresses d\'Odin, donne les adresses de la maison et y ajoute le démarrage par le réseau.',
    'p.debut': 'Première adresse', 'p.fin': 'Dernière adresse', 'p.passerelle': 'Passerelle', 'p.bail': 'Bail',
    'p.bail.2': '2 heures', 'p.bail.24': '1 jour', 'p.go': 'Distribuer sur ce réseau à part', 'p.verif': 'Odin vérifie la carte…',
    'box.titre': 'À mettre dans ta box',
    'box.dhcpd': 'Serveur d\'adresses sous Linux (dhcpd.conf)', 'box.dnsmasq': 'Routeur ou box avancée (dnsmasq.conf)',
    'box.note': 'Un PC en UEFI qui reçoit le fichier du BIOS ne démarre pas : quand ta box le permet, mets la règle selon le micrologiciel (option 93).',
    'qui.titre': 'Quels PC ont le droit de démarrer ?', 'qui.groupe': 'Qui',
    'qui.liste': 'Seulement les PC autorisés', 'qui.tous': 'Tous les PC : menu seulement',
    'qui.liste.note': 'Un PC autorisé est reconnu à son adresse matérielle (MAC). Retiré, il ne démarre plus par le réseau d\'Odin. Pour une vraie barrière, ajoute un mot de passe d\'installation (Protection).',
    'qui.tous.note': 'Un PC inconnu voit le menu ; rien ne s\'installe sans ton accord (« Installer pour moi »).',
    'qui.vide': 'Aucun PC autorisé pour l\'instant.', 'qui.retirer': 'Retirer {nom}',
    'qui.retirer.question': 'Retirer {nom} ({mac}) ? Il ne démarrera plus par le réseau d\'Odin{apart}. Rien n\'est effacé sur le PC.',
    'qui.retirer.apart': ' et ne recevra plus d\'adresse du réseau à part',
    'qui.auto': 'une fois, efface le disque', 'qui.fait': 'installation faite', 'qui.menu': 'menu seulement',
    'mac.label': 'Autoriser un PC par son adresse MAC', 'mac.ph': '52:54:00:12:34:56', 'mac.go': 'Autoriser',
    'mac.ko': 'Adresse MAC refusée : six paires de chiffres hexadécimaux (ex. 52:54:00:12:34:56).',
    'direct.titre': 'En direct', 'direct.live': 'en direct', 'direct.lead': 'Chaque PC qui demande à démarrer par le réseau.',
    'direct.vide': 'Aucun PC n\'a demandé à démarrer ces dernières heures.', 'direct.inconnu': 'Inconnu', 'direct.autoriser': 'Autoriser',
    'direct.groupe': 'PC qui démarrent',
    'e.démarrage réseau': 'demande de démarrage', 'e.chargeur': 'chargeur envoyé', 'e.menu': 'au menu', 'e.chargement': 'système en chargement',
    'e.installation': 'installation', 'e.logiciels': 'logiciels', 'e.fini': 'fini', 'e.sans nouvelles': 'sans nouvelles', 'e.échec': 'échec',
    charge: 'Odin lit le serveur de démarrage…', erreur: 'Le serveur de démarrage ne peut pas être lu : {raison}',
    annule: 'Annulé.',
  };
  const mot = (k, v = {}) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => (v[x] == null ? '' : String(v[x])));

  // ---------------------------------------------------------------- le dessin
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  };
  const P = {
    check: 'M5 12l5 5L20 7', plus: 'M12 5v14M5 12h14', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    pc: 'M3 5h18v11H3zM9 20h6M12 16v4', warn: 'M12 4l9 16H3zM12 10v4M12 17h.01', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    net: 'M3 6h18v5H3zM3 13h18v5H3zM7 8.5h.01M7 15.5h.01', wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
    vm: 'M3 4h18v12H3zM8 20h8M12 16v4M7 8h10v4H7z',
  };
  const svg = (inner, s) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = inner; return v; };
  const ic = (n, s = 18, w = 2) => svg(`<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`, s);

  const CSS = `
.rz{display:flex;flex-direction:column;gap:14px;min-width:0}
.rz-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow,none);padding:18px;min-width:0}
.rz-card>h4{margin:0 0 4px;font-size:17px;letter-spacing:-.01em;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rz-lead{margin:0 0 14px;color:var(--muted);font-size:13px}.rz-note{margin:8px 0 0;color:var(--muted);font-size:12.5px}
.rz-top{display:flex;gap:14px;align-items:center}.rz-top>div{flex:1;min-width:0}.rz-top .rz-lead{margin:2px 0 0}
.rz-tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink);white-space:nowrap}
.rz-tag.ok{background:color-mix(in srgb,var(--good) 16%,transparent);color:var(--good)}
.rz-tag.warn{background:color-mix(in srgb,var(--warn,#b45309) 16%,transparent);color:var(--warn,#b45309)}
.rz-tag.info{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--ink)}
.rz-sw{flex:none;position:relative;width:60px;min-height:44px;border:0;background:none;padding:0;cursor:pointer;color:inherit}
.rz-sw::before{content:"";position:absolute;left:2px;right:2px;top:6px;bottom:6px;border-radius:999px;border:1px solid var(--line);background:color-mix(in srgb,var(--ink) 14%,var(--panel))}
.rz-sw span{position:absolute;top:10px;left:7px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .15s}
.rz-sw[aria-checked=true]::before{background:var(--good);border-color:var(--good)}.rz-sw[aria-checked=true] span{left:29px}
.rz-sw:disabled{opacity:.5;cursor:wait}
.rz-cartes{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.rz-carte{position:relative;text-align:left;border:1.5px solid var(--line);background:var(--panel);color:var(--ink);border-radius:16px;padding:14px 44px 14px 14px;display:flex;gap:12px;align-items:flex-start;font:inherit;cursor:pointer;min-height:44px;min-width:0}
.rz-carte[aria-checked=true]{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.rz-carte.wifi{opacity:.75}
.rz-carte .lg{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--accent);flex:none}
.rz-carte .nm{flex:1;min-width:0}.rz-carte b{font-size:15px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;overflow-wrap:anywhere}
.rz-carte small{display:block;font-size:12.5px;color:var(--muted);overflow-wrap:anywhere;margin-top:2px}
.rz-tick{position:absolute;top:12px;right:12px;width:24px;height:24px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;background:var(--panel)}
[aria-checked=true]>.rz-tick{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}
.rz-choix{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:12px}
.rz-c{position:relative;text-align:left;border:1.5px solid var(--line);background:var(--panel);color:var(--ink);border-radius:16px;padding:16px 44px 16px 16px;display:flex;flex-direction:column;gap:6px;font:inherit;cursor:pointer;min-height:44px;min-width:0}
.rz-c[aria-checked=true]{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
.rz-c b{font-size:16px}.rz-c p{margin:0;font-size:13px;color:var(--muted)}.rz-c ul{margin:4px 0 0;padding-left:18px;font-size:12.5px;color:var(--muted)}
.rz-conseil{position:absolute;top:-11px;left:16px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:var(--accent);color:var(--on-accent,#fff)}
.rz-guard{display:flex;gap:14px;align-items:flex-start;padding:16px;border-radius:16px;border:2px solid var(--bad);background:var(--bad-bg,color-mix(in srgb,var(--bad) 10%,var(--panel)));color:var(--ink);margin-top:14px}
.rz-guard.calm{border-color:var(--good);background:color-mix(in srgb,var(--good) 10%,var(--panel))}
.rz-guard .gi{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:var(--bad);color:#fff;flex:none}
.rz-guard.calm .gi{background:var(--good)}
.rz-guard>div{min-width:0;flex:1}.rz-guard b{font-size:15px;display:block}.rz-guard p{margin:4px 0 0;font-size:13px;overflow-wrap:anywhere}
.rz-guard ul{margin:6px 0 0;padding-left:18px;font-size:13px;overflow-wrap:anywhere}
.rz-row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-top:12px}
.rz-plage{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:14px}
.rz-field{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
.rz-field label{font-size:13px;font-weight:600}
.rz-in{min-height:44px;border:1px solid var(--line);border-radius:12px;padding:0 12px;background:var(--panel);color:var(--ink);font:inherit;font-size:14px;min-width:0;width:100%;box-sizing:border-box}
.rz-in[aria-invalid=true]{border-color:var(--bad)}
.rz-btn{min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;font-weight:600;font-size:14px;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer}
.rz-btn.pri{background:var(--accent);color:var(--on-accent,#fff);border-color:transparent}.rz-btn:disabled{opacity:.45;cursor:not-allowed}
.rz-btn.sm{min-height:44px;padding:0 12px;font-size:13px}
.rz-seg{display:flex;gap:6px;flex-wrap:wrap}
.rz-seg button{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;font-weight:600;font-size:13.5px;cursor:pointer}
.rz-seg button[aria-pressed=true]{background:color-mix(in srgb,var(--accent) 14%,var(--panel));border-color:var(--accent)}
.rz-list{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
.rz-list li{display:flex;gap:12px;align-items:center;padding:8px 8px 8px 12px;border:1px solid var(--line);border-radius:12px;min-width:0}
.rz-list .lg{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--accent);flex:none}
.rz-list .nm{flex:1;min-width:0}.rz-list b{display:block;font-size:14px;overflow-wrap:anywhere}.rz-list small{display:block;font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.rz-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;font-weight:500}
.rz-ib{width:44px;height:44px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--muted);display:grid;place-items:center;cursor:pointer;flex:none}
.rz-live{font-size:12px;font-weight:700;color:var(--bad);display:inline-flex;align-items:center;gap:5px}.rz-live::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--bad);opacity:.8}
.rz-tl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.rz-tl li{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line);font-size:13px;min-width:0}
.rz-tl li:first-child{border-top:0}.rz-tl time{color:var(--muted);font-variant-numeric:tabular-nums;min-width:62px}
.rz-tl .tx{flex:1;min-width:160px;overflow-wrap:anywhere}.rz-tl b{font-weight:700}
.rz-tl li.ok b{color:var(--ink)}.rz-tl li.inc b{color:var(--warn,#b45309)}
.rz-pre{margin:6px 0 0;max-height:260px;overflow:auto;padding:12px;border-radius:12px;background:color-mix(in srgb,var(--ink) 6%,var(--panel));border:1px solid var(--line);font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;color:var(--ink)}
.rz-h5{font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:16px 0 4px}
.rz-msg{margin:0;font-size:13px;color:var(--muted);min-height:1em}.rz-msg.ko{color:var(--bad);font-weight:600}.rz-msg.ok{color:var(--good);font-weight:600}
@media (max-width:640px){.rz-plage{grid-template-columns:repeat(2,minmax(0,1fr))}.rz-card{padding:14px}.rz-tl time{min-width:0}}
@media (prefers-reduced-motion:reduce){.rz-sw span{transition:none}}
`;

  // ---------------------------------------------------------------- l'état de l'onglet
  const Z = { wrap: null, d: null, etat: 'rien', raison: '', choix: '', msg: '', msgGenre: '', occupe: false, minuteur: 0, plage: null };
  let H = null;
  const MAC = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
  const heure = (t) => { try { return new Date(t).toLocaleTimeString((typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'fr', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; } };
  const montrer = (texte, genre = '') => { Z.msg = texte || ''; Z.msgGenre = genre; const m = Z.wrap && Z.wrap.querySelector('[data-f="rz-msg"]'); if (m) { m.textContent = Z.msg; m.className = `rz-msg${genre ? ` ${genre}` : ''}`; } };

  async function lire() {
    try {
      const r = await H.post('reseau', {});
      if (r && r.ok !== false && r.data) { Z.d = r.data; Z.etat = 'ok'; } else { Z.etat = 'erreur'; Z.raison = (r && r.text) || '?'; }
    } catch (e) { Z.etat = 'erreur'; Z.raison = (e && e.message) || '?'; }
  }
  /** Une demande qui change quelque chose : l'accord d'abord si Odin le demande (act), puis on relit tout. */
  async function changer(action, input) {
    if (Z.occupe) return;
    Z.occupe = true; montrer(action === 'mode' && input.mode === 'complet' ? mot('p.verif') : '');
    let r;
    try { r = await (H.act || H.post)(action, input); } catch (e) { r = { ok: false, text: (e && e.message) || '?' }; }
    Z.occupe = false;
    await lire();
    if (r && r.ok === false && r.text === 'Annulé.') montrer(mot('annule'));
    else montrer((r && r.text) || '', r && r.ok === false ? 'ko' : 'ok');
    dessinerTout();
  }
  const modeActuel = () => (Z.d && Z.d.mode) || 'proxy';
  const choixAffiche = () => Z.choix || modeActuel();

  // ---------------------------------------------------------------- les sections
  function serveur(d) {
    const sw = el('button', { type: 'button', class: 'rz-sw', role: 'switch', 'aria-checked': String(Boolean(d.allume)), 'aria-label': mot('srv.nom'), 'data-f': 'interrupteur', disabled: Z.occupe,
      onclick: () => changer(d.allume ? 'eteindre' : 'allumer', {}) }, el('span'));
    return el('section', { class: 'rz-card', 'data-f': 'rz-serveur' },
      el('div', { class: 'rz-top' }, el('div', {}, el('h4', {}, mot('srv.titre'), el('span', { class: `rz-tag${d.allume ? ' ok' : ''}`, 'data-f': 'etat' }, mot(d.allume ? 'srv.allume' : 'srv.eteint'))), el('p', { class: 'rz-lead' }, mot('srv.lead'))), sw),
      el('p', { class: 'rz-note' }, mot('srv.note')));
  }
  /** Un groupe de boutons « radio » : flèches pour passer de l'un à l'autre (le focus suit), Entrée ou Espace pour choisir. */
  function roving(groupe, sel) {
    groupe.addEventListener('keydown', (e) => {
      const l = [...groupe.querySelectorAll(sel)], i = l.indexOf(e.target); if (i < 0) return;
      const k = e.key, j = k === 'ArrowRight' || k === 'ArrowDown' ? (i + 1) % l.length : k === 'ArrowLeft' || k === 'ArrowUp' ? (i - 1 + l.length) % l.length : k === 'Home' ? 0 : k === 'End' ? l.length - 1 : -1;
      if (j < 0) return; e.preventDefault && e.preventDefault();
      for (const b of l) b.setAttribute('tabindex', '-1'); l[j].setAttribute('tabindex', '0'); l[j].focus();
    });
    return groupe;
  }
  function cartes(d) {
    const l = Array.isArray(d.cartes) ? d.cartes : [];
    const sec = el('section', { class: 'rz-card', 'data-f': 'rz-cartes' }, el('h4', {}, mot('carte.titre')), el('p', { class: 'rz-lead' }, mot('carte.lead')));
    if (!l.length) { sec.append(el('p', { class: 'rz-note' }, mot('carte.aucune'))); return sec; }
    const conseillee = (l.find((c) => c.genre === 'cable') || {}).nom;
    const choisie = d.carte || '';
    const g = roving(el('div', { class: 'rz-cartes', role: 'radiogroup', 'aria-label': mot('carte.groupe') }), '[data-carte]');
    l.forEach((c, i) => {
      const on = c.nom === choisie, focusable = choisie ? on : i === 0;
      const sous = `${c.ip} / ${c.prefixe} · ${mot(`carte.${c.genre}`)}`;
      g.append(el('button', { type: 'button', class: `rz-carte${c.genre === 'wifi' ? ' wifi' : ''}`, role: 'radio', 'aria-checked': String(on), tabindex: focusable ? '0' : '-1', 'data-carte': c.nom, disabled: Z.occupe,
        onclick: () => {
          if (on) return;
          if (modeActuel() === 'complet') { const p = d.plage || c.plage || {}; void changer('mode', { mode: 'complet', carte: c.nom, ...(c.plage ? { debut: c.plage.debut, fin: c.plage.fin } : {}), bail: p.bail || 7200 }); }
          else void changer('mode', { mode: modeActuel(), carte: c.nom });
        } },
        el('span', { class: 'lg' }, ic(c.genre === 'wifi' ? 'wifi' : c.genre === 'virtuelle' ? 'vm' : 'net', 24)),
        el('span', { class: 'nm' }, el('b', {}, c.nom, c.nom === conseillee ? el('span', { class: 'rz-tag ok' }, mot('carte.conseillee')) : null, c.genre === 'wifi' ? el('span', { class: 'rz-tag warn' }, mot('carte.deconseillee')) : null, c.genre === 'virtuelle' ? el('span', { class: 'rz-tag info' }, mot('carte.apart')) : null), el('small', {}, sous)),
        el('span', { class: 'rz-tick', 'aria-hidden': 'true' }, on ? ic('check', 14, 3) : null)));
    });
    sec.append(g);
    if (!choisie) sec.append(el('p', { class: 'rz-note' }, mot('carte.auto')));
    return sec;
  }
  function choix(id, cons, avecListe = true) {
    const on = choixAffiche() === id;
    return el('button', { type: 'button', class: 'rz-c', role: 'radio', 'aria-checked': String(on), tabindex: on ? '0' : '-1', 'data-dmode': id, disabled: Z.occupe,
      onclick: () => {
        if (id === 'complet') { Z.choix = 'complet'; dessinerTout(); const f = Z.wrap && Z.wrap.querySelector('#rz-debut'); if (f && f.focus) f.focus(); return; }
        Z.choix = ''; if (modeActuel() !== id) void changer('mode', { mode: id }); else dessinerTout();
      } },
      cons ? el('span', { class: 'rz-conseil' }, mot('adr.conseil')) : null,
      el('b', {}, mot(`adr.${id}`)), el('p', {}, mot(`adr.${id}.texte`)),
      avecListe ? el('ul', {}, el('li', {}, mot(`adr.${id}.p1`)), el('li', {}, mot(`adr.${id}.p2`))) : null,
      el('span', { class: 'rz-tick', 'aria-hidden': 'true' }, on ? ic('check', 14, 3) : null));
  }
  function garde(d) {
    const g = d.garde || { etat: 'non_verifie', autres: [] }, vu = choixAffiche();
    const carte = (d.cartes || []).find((c) => c.nom === d.carte);
    const rouge = (titre, texte, liste) => el('div', { class: 'rz-guard', role: 'alert', 'data-f': 'garde-refus' },
      el('span', { class: 'gi' }, ic('warn', 24)),
      el('div', {}, el('b', {}, titre), el('p', {}, texte), liste ? el('ul', {}, el('li', {}, mot('g.refus.l1')), el('li', {}, mot('g.refus.l2'))) : null,
        el('div', { class: 'rz-row' }, el('button', { type: 'button', class: 'rz-btn pri', 'data-f': 'rester-box', disabled: Z.occupe, onclick: () => { Z.choix = ''; void changer('mode', { mode: 'proxy' }); } }, ic('shield'), mot('g.rester')))));
    const vert = (titre, texte) => el('div', { class: 'rz-guard calm', 'data-f': 'garde-ok' }, el('span', { class: 'gi' }, ic('shield', 24)), el('div', {}, el('b', {}, titre), el('p', {}, texte)));
    if (g.etat === 'coupe') return rouge(mot('g.coupe.titre'), g.raison || '', true);
    if (vu === 'complet') {
      if (g.etat === 'occupe' && (!g.carte || !carte || g.carte === carte.nom || Z.choix === 'complet')) return rouge(mot('g.refus.titre'), mot('g.refus.texte', { qui: (g.autres || []).join(', ') || '?' }), true);
      if (g.etat === 'non_verifie' && g.raison) return rouge(mot('g.nonverif.titre'), g.raison, false);
      if (carte && carte.complet === false && carte.refus) return rouge(mot('g.carte.titre'), carte.refus, false);
      if (modeActuel() === 'complet' && g.etat === 'libre') { const quand = g.verifie ? ` à ${heure(g.verifie)}` : ''; return vert(mot('g.libre.titre'), mot(d.distribue ? 'g.libre.texte' : 'g.libre.arrete', { quand })); }
      return null;
    }
    if (vu === 'proxy') return vert(mot('g.maison.titre'), mot('g.maison.texte'));
    if (vu === 'odin') return vert(mot('g.maison.titre'), mot('g.odin.texte'));
    return null;
  }
  function plage(d) {
    const carte = (d.cartes || []).find((c) => c.nom === d.carte), base = (modeActuel() === 'complet' && d.plage) || (carte && carte.plage) || { debut: '', fin: '', passerelle: '', bail: 7200 };
    // La plage proposée suit la carte : une autre carte, une autre plage (jamais celle de la carte d'avant).
    const v = Z.plage && Z.plage.carte === (d.carte || '') ? Z.plage : { carte: d.carte || '', debut: base.debut, fin: base.fin, passerelle: base.passerelle, bail: base.bail >= 86_400 ? 86_400 : 7200 };
    Z.plage = v;
    const champ = (k, id) => el('div', { class: 'rz-field' }, el('label', { for: id }, mot(`p.${k}`)),
      el('input', { id, class: 'rz-in rz-mono', value: v[k] || '', autocomplete: 'off', spellcheck: 'false', inputmode: 'decimal', 'data-f': `p-${k}`, oninput: (e) => { v[k] = e.target.value; } }));
    const bail = el('select', { id: 'rz-bail', class: 'rz-in', 'data-f': 'p-bail', onchange: (e) => { v.bail = Number(e.target.value) || 7200; } },
      el('option', { value: '7200', selected: v.bail !== 86_400 }, mot('p.bail.2')), el('option', { value: '86400', selected: v.bail === 86_400 }, mot('p.bail.24')));
    const pret = Boolean(d.carte && carte && carte.complet !== false);
    return el('div', { 'data-f': 'rz-plage' },
      el('div', { class: 'rz-plage' }, champ('debut', 'rz-debut'), champ('fin', 'rz-fin'), champ('passerelle', 'rz-passerelle'), el('div', { class: 'rz-field' }, el('label', { for: 'rz-bail' }, mot('p.bail')), bail)),
      el('div', { class: 'rz-row' }, el('button', { type: 'button', class: 'rz-btn pri', 'data-f': 'distribuer', disabled: Z.occupe || !pret,
        onclick: () => changer('mode', { mode: 'complet', carte: d.carte, debut: String(v.debut || '').trim(), fin: String(v.fin || '').trim(), passerelle: String(v.passerelle || '').trim(), bail: v.bail }) }, ic('shield'), mot('p.go'))));
  }
  function box(d) {
    const l = d.lignes || { simple: [], dhcpd: '', dnsmasq: '' };
    return el('div', { 'data-f': 'rz-box' },
      el('p', { class: 'rz-h5' }, mot('box.titre')),
      el('ul', { class: 'rz-lead', style: 'margin:0;padding-left:18px' }, ...(l.simple || []).map((x) => el('li', {}, x))),
      el('p', { class: 'rz-h5' }, mot('box.dhcpd')), el('pre', { class: 'rz-pre', tabindex: '0', 'data-f': 'box-dhcpd' }, l.dhcpd || ''),
      el('p', { class: 'rz-h5' }, mot('box.dnsmasq')), el('pre', { class: 'rz-pre', tabindex: '0', 'data-f': 'box-dnsmasq' }, l.dnsmasq || ''),
      el('p', { class: 'rz-note' }, mot('box.note')));
  }
  function adresses(d) {
    const modes = ['proxy', 'complet', 'aucun'].concat(modeActuel() === 'odin' ? ['odin'] : []);
    const g = roving(el('div', { class: 'rz-choix', role: 'radiogroup', 'aria-label': mot('adr.groupe') }, ...modes.map((m) => choix(m, m === 'proxy', m !== 'odin'))), '[data-dmode]');
    if (!g.querySelector('[tabindex="0"]')) { const f = g.querySelector('[data-dmode]'); if (f) f.setAttribute('tabindex', '0'); }
    const vu = choixAffiche(), gf = garde(d);
    // Après une coupure, Odin ne redistribue pas tout seul : rechoisir « Odin distribue » remontre la plage (et le bouton,
    // qui revérifie la carte avec ton accord), sous l'avertissement rouge.
    const rechoix = Boolean(d.garde && d.garde.etat === 'coupe' && Z.choix === 'complet');
    return el('section', { class: 'rz-card', 'data-f': 'rz-adresses' }, el('h4', {}, mot('adr.titre')), el('p', { class: 'rz-lead' }, mot('adr.lead')), g,
      gf, vu === 'complet' && (rechoix || !(gf && gf.getAttribute('data-f') === 'garde-refus')) ? plage(d) : null, vu === 'aucun' ? box(d) : null);
  }
  function quiPeut(d) {
    const filtre = d.filtre === 'liste' ? 'liste' : 'tous', l = Array.isArray(d.autorises) ? d.autorises : [], apart = modeActuel() === 'complet';
    const seg = el('div', { class: 'rz-seg', role: 'group', 'aria-label': mot('qui.groupe') }, ...['liste', 'tous'].map((k) => el('button', { type: 'button', 'aria-pressed': String(filtre === k), 'data-filtre': k, disabled: Z.occupe, onclick: () => { if (filtre !== k) void changer('mode', { mode: modeActuel(), filtre: k }); } }, mot(`qui.${k}`))));
    const liste = el('ul', { class: 'rz-list', 'data-f': 'autorises' }, ...l.map((r) => {
      const nom = r.nom || r.mac;
      return el('li', {}, el('span', { class: 'lg' }, ic('pc', 18)),
        el('span', { class: 'nm' }, el('b', {}, nom, ' · ', el('span', { class: 'rz-mono' }, r.mac)), el('small', {}, [r.iso || '', r.auto ? mot(r.fait ? 'qui.fait' : 'qui.auto') : mot('qui.menu')].filter(Boolean).join(' · '))),
        el('button', { type: 'button', class: 'rz-ib', 'aria-label': mot('qui.retirer', { nom }), 'data-retirer': r.mac, disabled: Z.occupe, onclick: async () => {
          const q = mot('qui.retirer.question', { nom, mac: r.mac, apart: apart && filtre === 'liste' ? mot('qui.retirer.apart') : '' });
          const oui = W.OdinDialog && W.OdinDialog.confirm ? await W.OdinDialog.confirm(q, { danger: false }) : true;
          if (oui) void changer('retirer_machine', { mac: r.mac });
        } }, ic('trash')));
    }));
    const champ = el('input', { id: 'rz-mac', class: 'rz-in rz-mono', placeholder: mot('mac.ph'), autocomplete: 'off', spellcheck: 'false', 'data-f': 'mac' });
    const ajouter = () => { const v = String(champ.value || '').trim(); if (!MAC.test(v)) { champ.setAttribute('aria-invalid', 'true'); montrer(mot('mac.ko'), 'ko'); return; } champ.removeAttribute('aria-invalid'); void changer('autoriser', { mac: v.toLowerCase().replace(/-/g, ':') }); };
    champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') ajouter(); });
    return el('section', { class: 'rz-card', 'data-f': 'rz-qui' }, el('h4', {}, mot('qui.titre')), seg,
      el('p', { class: 'rz-note' }, mot(filtre === 'tous' ? 'qui.tous.note' : 'qui.liste.note')),
      l.length ? liste : el('p', { class: 'rz-note', 'data-f': 'autorises' }, mot('qui.vide')),
      el('div', { class: 'rz-row' }, el('div', { class: 'rz-field', style: 'margin:0;min-width:220px' }, el('label', { for: 'rz-mac' }, mot('mac.label')), champ),
        el('button', { type: 'button', class: 'rz-btn', 'data-f': 'autoriser', disabled: Z.occupe, onclick: ajouter }, ic('plus'), mot('mac.go'))));
  }
  function ligneDirect(e) {
    const nom = e.nom || (e.connu ? e.mac : mot('direct.inconnu'));
    const quoi = [mot(`e.${e.etape}`), e.detail && e.detail !== e.etape ? e.detail : ''].filter(Boolean).join(' · ');
    return el('li', { class: e.connu ? 'ok' : 'inc' }, el('time', {}, heure(e.at)), el('b', {}, nom), el('span', { class: 'rz-mono' }, e.mac), el('span', { class: 'tx' }, quoi),
      e.connu ? null : el('button', { type: 'button', class: 'rz-btn sm', 'data-autoriser': e.mac, disabled: Z.occupe, onclick: () => changer('autoriser', { mac: e.mac }) }, mot('direct.autoriser')));
  }
  function direct(d) {
    const l = Array.isArray(d.direct) ? d.direct : [];
    return el('section', { class: 'rz-card', 'data-f': 'rz-direct' }, el('h4', {}, mot('direct.titre'), el('span', { class: 'rz-live' }, mot('direct.live'))), el('p', { class: 'rz-lead' }, mot('direct.lead')),
      l.length ? el('ol', { class: 'rz-tl', 'aria-label': mot('direct.groupe'), 'aria-live': 'polite' }, ...l.map(ligneDirect)) : el('p', { class: 'rz-note' }, mot('direct.vide')));
  }

  function dessinerTout() {
    const w = Z.wrap; if (!w) return;
    const msg = el('p', { class: `rz-msg${Z.msgGenre ? ` ${Z.msgGenre}` : ''}`, 'data-f': 'rz-msg', role: 'status', 'aria-live': 'polite' }, Z.msg);
    if (Z.etat === 'rien') { w.replaceChildren(el('p', { class: 'rz-note' }, mot('charge'))); return; }
    if (Z.etat === 'erreur') { w.replaceChildren(el('p', { class: 'rz-msg ko', role: 'alert', 'data-f': 'rz-erreur' }, mot('erreur', { raison: Z.raison }))); return; }
    const d = Z.d || {};
    w.replaceChildren(msg, serveur(d), cartes(d), adresses(d), quiPeut(d), direct(d));
  }
  /** En direct : on relit toutes les 5 s tant que l'onglet est à l'écran ; seule la liste « En direct » et l'état changent. */
  function suivre() {
    clearTimeout(Z.minuteur);
    const wrap = Z.wrap;
    const tic = async () => {
      if (!wrap || !wrap.isConnected || Z.wrap !== wrap) return;
      if (!(typeof document !== 'undefined' && document.hidden) && !Z.occupe) {
        const avant = Z.d ? `${(Z.d.garde || {}).etat}|${Boolean(Z.d.distribue)}` : '';
        await lire();
        // Le garde-fou a coupé (ou l'état des adresses a changé) : la section des adresses est redessinée tout de suite.
        const sect = wrap.querySelector('[data-f="rz-adresses"]');
        if (Z.etat === 'ok' && sect && Z.wrap === wrap && avant !== `${(Z.d.garde || {}).etat}|${Boolean(Z.d.distribue)}` && sect.replaceWith) { Z.choix = ''; sect.replaceWith(adresses(Z.d)); }
        if (Z.wrap !== wrap || !wrap.isConnected) return;
        const ancien = wrap.querySelector('[data-f="rz-direct"]');
        if (Z.etat === 'ok' && ancien) {
          ancien.replaceWith ? ancien.replaceWith(direct(Z.d)) : null;
          const etat = wrap.querySelector('[data-f="etat"]'), sw = wrap.querySelector('[data-f="interrupteur"]');
          if (etat) { etat.textContent = mot(Z.d.allume ? 'srv.allume' : 'srv.eteint'); etat.className = `rz-tag${Z.d.allume ? ' ok' : ''}`; }
          if (sw) sw.setAttribute('aria-checked', String(Boolean(Z.d.allume)));
        }
      }
      if (Z.wrap === wrap && wrap.isConnected) Z.minuteur = setTimeout(tic, 5000);
    };
    Z.minuteur = setTimeout(tic, 5000);
  }

  /** Monte l'onglet dans root. hote : { post, act, aller(onglet) } (la page de Genèse). */
  async function dessiner(root, _onglet, hote) {
    if (typeof document !== 'undefined' && document.head && !(document.getElementById && document.getElementById('rzCss'))) document.head.append(el('style', { id: 'rzCss' }, CSS));
    H = { post: hote && hote.post, act: hote && hote.act, aller: hote && hote.aller };
    const wrap = el('div', { class: 'rz', 'data-f': 'reseau' });
    root.append(wrap);
    Z.wrap = wrap; Z.etat = 'rien'; Z.choix = ''; Z.plage = null; Z.msg = ''; Z.msgGenre = '';
    dessinerTout();
    await lire();
    if (Z.wrap === wrap) { dessinerTout(); suivre(); }
  }

  W.OdinGeneseReseau = { onglets: [['reseau', MOTS.onglet]], dessiner, MOTS, etat: Z };
})();
