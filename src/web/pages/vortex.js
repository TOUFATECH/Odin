// Vortex · « Appareils » et « Tunnel » (maquette « Réseau » validée, lot R7) : « l'applicatif qui fait office de VPN »,
// « son interface web ».
//   - Appareils : le tunnel (allumé ou non, joignable où), 4 chiffres, puis chaque appareil du VPN en carte : son nom, son
//     adresse dans le VPN, connecté ou non, sa dernière connexion, depuis où (l'adresse vue par le tunnel : aucun service
//     de géolocalisation n'est interrogé), son trafic du jour, son accès, la fin de son accès ;
//     « Couper » (réversible : « Rouvrir l'accès ») et « Retirer » (sa clé ne vaut plus rien) avec le garde-fou DANS la
//     carte : le nom de l'appareil, ce qui sera fait, « Seulement couper », et un avertissement clair quand c'est
//     l'appareil que tu tiens ou quand Odin ne sait pas depuis quel appareil tu agis ;
//   - Tunnel : allumé ou éteint (l'éteindre est redemandé), l'adresse de la maison sur Internet et comment elle a été
//     trouvée (lue sur la box, sans aucun site extérieur ; si la box ne répond pas, c'est dit et l'adresse s'écrit à la
//     main), le port et son ouverture sur la box, les adresses du VPN, le réseau de la maison ouvert, le DNS donné.
// Tout ce qui est vrai vient du serveur (lecture « appareils_vus » : aucune clé dedans) ; les gestes passent par les
// actions de Vortex qui existent (« activer », « revoquer », « allumer », « eteindre », « detecter », « adresse »,
// « ouvrir_port », « fermer_port » : propriétaire seul, mêmes règles côté serveur, la page ne décide de rien). Un nom
// d'appareil ou une réponse de la box est TOUJOURS posé comme du texte, jamais comme du HTML. Tous les textes de la page
// sont dans MOTS. Les écrans des lots suivants (Ajouter et QR code : vortex-ajouter.js, lot R8 ; Personnes) s'ajoutent par
// window.OdinVortex.ajouter({ id, titre, dessiner, rang }) et reprennent window.OdinVortex.outils. Un écran chargé AVANT
// cette page (les fichiers sont chargés par ordre de nom) se range dans window.OdinVortexPlus : il est repris ici.
// Un écran peut rendre « quitter » : appelé quand on le quitte (il efface ce qu'il ne doit pas garder, un QR code par exemple).
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;
  W.OdinPages = W.OdinPages || {};

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    'o.appareils': 'Appareils', 'o.tunnel': 'Tunnel', 'o.tout': 'Tout', onglets: 'Écrans de Vortex',
    't.allume': 'Tunnel allumé', 't.eteint': 'Tunnel éteint', 't.switch': 'Tunnel allumé',
    't.joignable': 'Joignable sur {adresse}, port {port} (UDP).', 't.sans': 'L\'adresse de la maison n\'est pas encore connue : va dans « Tunnel ».',
    't.personne': 'Plus personne ne peut se connecter de l\'extérieur.', 't.moteur': 'Le tunnel ne peut pas s\'allumer ici : {raison}.',
    't.ajouter': 'Ajouter un appareil',
    'c.co': 'Connectés maintenant', 'c.app': 'Appareils', 'c.coupes': 'Accès coupés', 'c.trafic': 'Trafic aujourd\'hui',
    'a.seul': 'Toi seul (propriétaire) peux couper, rouvrir ou retirer un appareil. Les clés des appareils ne sont jamais montrées ici.',
    'membre.titre': 'Ce que tu vois',
    'l.titre': 'Les appareils du VPN', 'l.aucun': 'Aucun appareil pour l\'instant.', 'l.carte': 'Appareil {nom}',
    'e.connecte': 'connecté maintenant', 'e.absent': 'pas connecté', 'e.jamais': 'jamais connecté', 'e.coupe': 'accès coupé', 'e.fini': 'accès terminé',
    'g.ici': 'ton appareil',
    'f.ip': 'Adresse dans le VPN', 'f.vu': 'Dernière connexion', 'f.depuis': 'Depuis', 'f.trafic': 'Trafic aujourd\'hui', 'f.acces': 'Accès', 'f.fin': 'Fin de l\'accès',
    'v.maintenant': 'maintenant', 'v.jamais': 'jamais', 'v.rien': '—', 'v.dehors': '{ip} (hors de la maison)', 'v.maison': '{ip} (réseau de la maison)',
    'v.trafic': 'reçu {recu} · envoyé {envoye}', 'v.tout': 'tout passe par la maison', 'v.seule': 'la maison seulement', 'v.adresses': 'seulement certaines adresses', 'v.sansfin': 'jamais', 'v.le': 'le {j}',
    'b.couper': 'Couper', 'b.rouvrir': 'Rouvrir l\'accès', 'b.retirer': 'Retirer', 'b.qr': 'QR code ou fichier', 'b.fini': 'Son accès est terminé : donne-lui une nouvelle date de fin (onglet « Tout », « Modifier un appareil »).',
    'k.couper': 'Couper « {nom} » ?', 'k.retirer': 'Retirer « {nom} » du VPN ?',
    'k.couper.texte': 'Il ne pourra plus se connecter à la maison. Tu pourras rouvrir son accès à tout moment : sa clé est gardée.',
    'k.retirer.texte': 'Sa clé ne vaudra plus rien : il ne pourra plus jamais se connecter avec son QR code ni son fichier. Pour revenir, il faudra l\'ajouter de nouveau.',
    'k.ici': 'C\'est l\'appareil que tu tiens en ce moment : tu vas te couper d\'Odin, et tu ne pourras pas revenir en arrière depuis cet appareil.',
    'k.inconnu': 'Odin ne sait pas depuis quel appareil tu agis. Si « {nom} » est celui que tu tiens, tu perds Odin avec lui.',
    'k.ok.couper': 'Couper « {nom} »', 'k.ok.retirer': 'Retirer pour toujours', 'k.ok.ici.couper': 'C\'est mon appareil, couper quand même', 'k.ok.ici.retirer': 'C\'est mon appareil, retirer quand même',
    'k.plutot': 'Seulement couper', 'k.annuler': 'Annuler', 'k.demande': 'Odin vérifie…',
    'q.eteindre': 'Éteindre le tunnel ?', 'q.eteindre.texte': 'Le VPN est coupé pour tous les appareils, jusqu\'à ce que tu le rallumes.', 'q.eteindre.ok': 'Éteindre le tunnel',
    'q.allumer': 'Allumer le tunnel ?', 'q.allumer.ok': 'Allumer le tunnel',
    'q.adresse': 'Changer l\'adresse de la maison ?', 'q.adresse.ok': 'Enregistrer cette adresse',
    'q.ouvrir': 'Ouvrir le port sur la box ?', 'q.ouvrir.ok': 'Ouvrir le port', 'q.fermer': 'Fermer le port sur la box ?', 'q.fermer.ok': 'Fermer le port',
    'q.detail': 'Ce qu\'Odin va faire',
    'n.titre': 'Le tunnel', 'n.allume': 'allumé', 'n.eteint': 'éteint', 'n.lead': 'L\'éteindre coupe le VPN pour tous les appareils : Odin te le redemande.',
    'n.adresse': 'Adresse de la maison sur Internet', 'n.adresse.sans': 'pas encore connue', 'n.trouvee': 'Trouvée par',
    'n.box': 'la box (sans service extérieur)', 'n.main': 'toi (écrite à la main)', 'n.avant': 'on ne sait plus (réglée avant) : relis-la sur la box',
    'n.lecture': 'Dernière lecture sur la box', 'n.lecture.jamais': 'jamais faite',
    'n.port': 'Port', 'n.port.v': '{port} (UDP)', 'n.portbox': 'Sur la box',
    'p.odin': 'ouvert par Odin', 'p.main': 'noté ouvert (fait à la main)', 'p.non': 'pas ouvert par Odin', 'p.partage': 'ouvert, mais la box n\'a pas d\'adresse Internet à elle : de dehors, on ne joint pas la maison',
    'n.vpn': 'Adresses du VPN', 'n.maison': 'Réseau de la maison ouvert', 'n.maison.sans': 'aucun', 'n.dns': 'DNS donné aux appareils', 'n.dns.sans': 'aucun (chaque appareil garde le sien)',
    'd.titre': 'Adresse de la maison', 'd.lead': 'Odin la lit sur la box (UPnP). Aucun site extérieur n\'est interrogé. Si la box ne répond pas, écris l\'adresse à la main, ou un nom de domaine.',
    'd.lire': 'Relire l\'adresse sur la box', 'd.lire.cours': 'Odin demande à la box…', 'd.ecrire': 'L\'écrire à la main',
    'd.champ': 'Adresse ou nom de domaine', 'd.ex': '203.0.113.7 ou maison.example.org', 'd.ok': 'Enregistrer', 'd.non': 'Annuler',
    'd.vide': 'Écris une adresse (203.0.113.7) ou un nom de domaine.', 'd.faux': 'Seulement des lettres, des chiffres, des points et des tirets, sans espace.', 'd.bon': 'Les appareils joindront {adresse}, port {port}.',
    'x.titre': 'Le port sur la box', 'x.lead': 'De dehors, un seul port mène à la maison : celui du tunnel. Odin peut l\'ouvrir et le refermer lui-même si la box l\'accepte (UPnP).',
    'x.ouvrir': 'Ouvrir le port sur la box', 'x.fermer': 'Fermer le port sur la box',
    's.titre': 'Comment c\'est protégé, en mots simples',
    's.1': 'Un tunnel chiffré moderne : chaque appareil a sa propre paire de clés, plus une clé partagée avec Odin.',
    's.2': 'Sans la bonne clé, Odin ne répond même pas : de dehors, le port a l\'air fermé.',
    's.3': 'Rien à installer sur Odin : le tunnel est écrit dans Odin. Sur le téléphone, l\'appli VPN habituelle suffit.',
    's.4': 'La clé d\'un appareil ne se voit qu\'une fois, quand tu l\'ajoutes. Cette page ne la montre jamais.',
    's.4b': 'La clé d\'un appareil est gardée chiffrée dans le coffre. Son QR code ne se montre que sur ton geste (« QR code ou fichier » sur sa carte), et se masque quand tu quittes l\'écran.',
    'w.titre': 'L\'interface web du VPN', 'w.texte': 'C\'est cette page. Vortex n\'ouvre sur la box que le port du tunnel : cette page se regarde depuis la maison, ou à travers le VPN.',
    'r.silence': 'Odin ne répond pas.', 'r.lecture': 'Odin n\'a pas pu lire les appareils du VPN.', 'r.proprio': 'Le tunnel et ses réglages : le propriétaire seul.',
    'h.aujourdhui': 'à {h}', 'h.hier': 'hier à {h}', 'h.jours': 'il y a {n} jours', 'h.le': 'le {j} à {h}',
    'u.0': 'o', 'u.1': 'Ko', 'u.2': 'Mo', 'u.3': 'Go', 'u.4': 'To',
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
    app: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
    pause: 'M9 5v14M15 5v14', play: 'M8 5l11 7-11 7z', trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6', plus: 'M12 5v14M5 12h14',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z', shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z', warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
    check: 'M5 12l5 5 9-10', refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5', pen: 'M4 20h4l10-10-4-4L4 16zM13 7l4 4', x: 'M6 6l12 12M18 6L6 18',
    tunnel: 'M3 18v-4a9 9 0 0 1 18 0v4M8 18v-4a4 4 0 0 1 8 0v4M3 18h18',
  };
  function ic(nom, taille = 20) {
    const s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: taille, height: taille, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) s.setAttribute(k, String(v));
    p.setAttribute('d', TRAITS[nom] || TRAITS.app); s.append(p); return s;
  }
  /** Une heure lisible, près de maintenant (« à 14:02 », « hier à 18:02 », « il y a 3 jours »). Pur. */
  function quand(t, maintenant = Date.now()) {
    if (!t) return mot('v.jamais');
    const d = new Date(t), n = new Date(maintenant), h = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), ecart = Math.round((jour(d) - jour(n)) / 86400000);
    if (ecart === 0) return mot('h.aujourdhui', { h });
    if (ecart === -1) return mot('h.hier', { h });
    if (ecart < -1 && ecart > -31) return mot('h.jours', { n: -ecart });
    return mot('h.le', { j: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`, h });
  }
  /** Une quantité de données en mots courts (« 1,2 Go »). Pur. */
  function taille(n) {
    let x = Math.max(0, Number(n) || 0), i = 0;
    while (x >= 1024 && i < 4) { x /= 1024; i++; }
    return `${String(Math.round(x * 10) / 10).replace('.', ',')} ${mot(`u.${i}`)}`;
  }
  /** L'état d'un appareil en mots, et sa couleur (ok, off, bad). Pur. */
  function etatDe(d) { return [d.etat === 'connecte' ? 'ok' : d.etat === 'coupe' || d.etat === 'fini' ? 'bad' : 'off', mot(`e.${d.etat}`)]; }
  /** La question du serveur (« Confirmer : … ? ») : la phrase, et l'avertissement qui la suit s'il y en a un. Pur. */
  function question(confirm) {
    const t = String(confirm ?? '').replace(/^Confirmer : /, '').replace(/\s*\?\s*$/, ''), i = t.indexOf('⚠');
    const phrase = (i < 0 ? t : t.slice(0, i)).trim(), avis = i < 0 ? '' : t.slice(i + 1).trim();
    return { phrase: phrase.replace(/^./, (c) => c.toUpperCase()), avis };
  }
  /** Une adresse ou un nom de domaine écrit à la main : vide, mal écrit, ou bon. Pur. */
  function adresseTapee(v) { const t = String(v ?? '').trim(); return !t ? 'vide' : /^[A-Za-z0-9_.-]{1,200}$/.test(t) && /[A-Za-z0-9]/.test(t) ? 'bon' : 'faux'; }

  const CSS = `
.vx{display:flex;flex-direction:column;gap:14px;min-width:0;color:var(--ink)}
.vx *{box-sizing:border-box}
.vx-tabs{display:flex;gap:8px;flex-wrap:wrap}
.vx-tab{min-height:44px;padding:0 16px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 14px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:8px}
.vx-tab[aria-selected="true"]{background:var(--ink);color:var(--bg,#fff);border-color:var(--ink)}
.vx-card{border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:16px;min-width:0}
.vx-card h2{margin:0;font-size:17px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.vx-lead{margin:6px 0 0;font-size:13px;color:var(--muted);line-height:1.5}
.vx-muted{color:var(--muted)}
.vx-mono{font-family:ui-monospace,Consolas,monospace;font-size:.95em}
.vx-tun{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.vx-tun .vx-tx{flex:1 1 220px;min-width:0;font-size:13.5px;line-height:1.45;overflow-wrap:anywhere}
.vx-tun .vx-tx b{display:block;font-size:16px}
.vx-sw{flex:none;width:60px;height:44px;border:0;background:none;padding:0;cursor:pointer;position:relative;border-radius:22px}
.vx-sw::before{content:"";position:absolute;left:4px;right:4px;top:8px;bottom:8px;border-radius:14px;background:color-mix(in srgb,var(--muted) 45%,transparent)}
.vx-sw::after{content:"";position:absolute;left:8px;top:12px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.vx-sw[aria-checked="true"]::before{background:var(--good)}
.vx-sw[aria-checked="true"]::after{left:32px}
.vx-sw:disabled{opacity:.5;cursor:not-allowed}
.vx-etat{flex:none;width:14px;height:14px;border-radius:50%;background:var(--muted);margin:0 8px}
.vx-etat.ok{background:var(--good)}
.vx-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.vx-stat{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:10px 14px;min-width:0}
.vx-stat small{display:block;color:var(--muted);font-size:12.5px}
.vx-stat b{font-size:22px;font-weight:700;overflow-wrap:anywhere}
.vx-stat.ok b{color:var(--good)}.vx-stat.bad b{color:var(--bad)}
.vx-note{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);border-radius:14px;background:var(--panel2,var(--panel));padding:12px 14px;font-size:13.5px;line-height:1.5}
.vx-note b{display:block;font-size:14.5px}
.vx-note p{margin:2px 0 0;color:var(--muted)}
.vx-note svg{flex:none;color:var(--accent);margin-top:2px}
.vx-seul{display:flex;gap:8px;align-items:flex-start;margin:0;font-size:13px;color:var(--muted);line-height:1.45}
.vx-seul svg{flex:none;margin-top:1px}
.vx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:14px;align-items:start;list-style:none;margin:0;padding:0}
.vx-app{display:flex;flex-direction:column;gap:12px}
.vx-app.coupe{border-style:dashed}
.vx-top{display:flex;gap:12px;align-items:center;min-width:0}
.vx-lg{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;background:color-mix(in srgb,var(--muted) 14%,transparent);color:var(--accent);flex:none}
.vx-nm{min-width:0;flex:1}
.vx-nm h3{margin:0;font-size:16px;font-weight:700;overflow-wrap:anywhere;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.vx-tag{font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--accent) 20%,transparent);color:var(--accent);white-space:nowrap}
.vx-tag.ok{background:color-mix(in srgb,var(--good) 20%,transparent);color:var(--good)}
.vx-tag.off{background:color-mix(in srgb,var(--muted) 20%,transparent);color:var(--muted)}
.vx-co{display:inline-flex;align-items:baseline;gap:6px;font-size:12.5px;min-width:0}
.vx-co::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--good);flex:none}
.vx-co.off::before{background:var(--muted);opacity:.6}.vx-co.bad::before{background:var(--bad)}
.vx-faits{margin:0;display:grid;grid-template-columns:minmax(0,1fr)}
.vx-faits div{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line);font-size:13px}
.vx-faits dt{color:var(--muted);flex:none;max-width:55%}
.vx-faits dd{margin:0;text-align:right;font-weight:600;overflow-wrap:anywhere;min-width:0}
.vx-faits dd.bad{color:var(--bad)}
.vx-acts{display:flex;gap:8px;flex-wrap:wrap}
.vx-acts .vx-btn{flex:1 1 130px;justify-content:center}
.vx-btn{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13.5px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:8px;text-align:left;line-height:1.2}
.vx-btn:disabled{opacity:.5;cursor:not-allowed}
.vx-btn.dng{background:var(--bad);border-color:var(--bad);color:var(--bg,#fff)}
.vx-btn.pri{background:var(--accent);border-color:var(--accent);color:var(--on-accent,var(--bg,#fff))}
.vx-btn.ghost{background:none}
.vx :is(button,input,select,a):focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.vx-garde{border:2px solid var(--bad);border-radius:14px;background:color-mix(in srgb,var(--bad) 9%,var(--panel));padding:14px;font-size:13.5px;line-height:1.5;min-width:0}
.vx-garde.calme{border-color:var(--accent)}
.vx-garde b.vx-gt{display:block;font-size:15px;margin-bottom:4px;overflow-wrap:anywhere}
.vx-garde p{margin:8px 0 0;overflow-wrap:anywhere}
.vx-garde h4{margin:10px 0 2px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.vx-garde .vx-fort{font-weight:700;color:var(--bad)}
.vx-garde .vx-acts{margin-top:12px}
.vx-garde .vx-acts .vx-btn{flex:1 1 190px}
.vx-btn svg{flex:none}
.vx-res{margin:0;white-space:pre-line;font-size:13px;line-height:1.5;border-left:3px solid var(--accent);padding:2px 0 2px 10px;overflow-wrap:anywhere}
.vx-res.non{border-left-color:var(--bad)}
.vx-vide{margin:4px 0;color:var(--muted);font-size:13.5px}
.vx-pile{display:flex;flex-direction:column;gap:12px;min-width:0}
.vx-champ{display:flex;flex-direction:column;gap:6px;font-size:13px;min-width:0}
.vx-champ label{font-weight:600}
.vx-champ input{min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel2,var(--panel));color:var(--ink);padding:0 12px;font:14px inherit;min-width:0;width:100%}
.vx-verdict{margin:0;font-size:13px;color:var(--muted)}
.vx-verdict.bad{color:var(--bad);font-weight:600}
.vx-ol{margin:8px 0 0;padding-left:20px;font-size:13.5px;line-height:1.55}
.vx-ol li{padding:2px 0}
@media (max-width:720px){.vx-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.vx-faits dt{max-width:48%}.vx-tabs{gap:6px}.vx-tab{padding:0 12px}}
@media (prefers-reduced-motion:no-preference){.vx-btn,.vx-tab{transition:background .12s ease}.vx-sw::after{transition:left .12s ease}}
`;
  function style() { if (!document.getElementById('vx-css')) document.head.append(el('style', { id: 'vx-css' }, CSS)); }

  // ---------------------------------------------------------------- les demandes au serveur
  const demander = async (action, input = {}, confirm = false) => {
    try { return await (await fetch('/api/valhalla/act', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ module: 'gjoll', action, input, confirm }) })).json(); }
    catch { return { ok: false, text: mot('r.silence') }; }
  };
  const reponse = (r) => ({ ok: Boolean(r) && r.ok !== false && !r.error, text: String(r?.text ?? r?.error ?? mot('r.silence')) });

  // ---------------------------------------------------------------- ce que les deux écrans partagent
  /** L'état commun d'un écran : ce que dit le serveur, la question en cours sur le tunnel, son résultat. */
  function socle(racine, redessiner) {
    const S = { D: null, occupe: false, gt: null, rt: null, zone: 'tunnel' };
    const viser = (cle) => { for (const n of racine.querySelectorAll('[data-f]')) if (n.getAttribute('data-f') === cle) { n.focus(); return true; } return false; };
    let enVol = false;
    /** En direct : jamais pendant une question ouverte ni une saisie (rien ne bouge sous tes doigts), jamais deux relectures à la fois. */
    async function relire(o = {}) {
      const fige = () => Boolean(S.occupe || S.gt || S.fige?.());
      if (o.discret && (fige() || enVol)) return;
      let r; if (o.discret) enVol = true;
      try { r = await demander('appareils_vus'); } finally { if (o.discret) enVol = false; }
      if (o.discret && fige()) return;
      // Rien n'a changé : la page n'est pas redessinée (rien ne clignote, un lecteur d'écran ne relit pas le dernier résultat).
      if (o.discret && S.D && r && r.data && JSON.stringify(r.data) === JSON.stringify(S.D)) return;
      if (r && r.data && Array.isArray(r.data.appareils)) S.D = r.data;
      else if (!S.D) S.D = { appareils: [], chiffres: null, proprietaire: false, origineConnue: false, tunnel: null, allume: false, limite: String(r?.text ?? r?.error ?? mot('r.lecture')) };
      const cle = document.activeElement?.getAttribute?.('data-f');
      redessiner(); if (cle) viser(cle);
    }
    /** Un geste sur le tunnel : la question du serveur d'abord (rien ne part), sinon son résultat. */
    async function poser(action, input, o) {
      if (S.occupe) return; S.occupe = true; S.rt = null; S.zone = o.zone ?? 'tunnel'; redessiner();
      const r = await demander(action, input, false); S.occupe = false;
      if (r && r.confirm) { const q = question(r.confirm); S.gt = { action, input, phrase: q.phrase, avis: q.avis, ...o }; redessiner(); viser('q-non'); return; }
      S.rt = reponse(r); await relire(); viser(o.retour);
    }
    async function repondreOui() {
      const g = S.gt; if (!g || S.occupe) return; S.occupe = true; redessiner(); viser('q-ok');
      const r = await demander(g.action, g.input, true);
      S.occupe = false; S.gt = null; S.rt = reponse(r); g.apres?.(S.rt.ok);
      await relire(); viser(g.retour);
    }
    const repondreNon = () => { const g = S.gt; S.gt = null; redessiner(); if (g) viser(g.retour); };
    /** La question en cours sur le tunnel, dans la page (rouge quand elle coupe quelque chose). */
    function gardeTunnel() {
      const g = S.gt; if (!g) return null;
      return el('div', { class: `vx-garde${g.ton === 'bad' ? '' : ' calme'}`, role: 'alert', 'aria-live': 'assertive', onkeydown: (ev) => { if (ev.key === 'Escape') { ev.preventDefault?.(); repondreNon(); } } },
        el('b', { class: 'vx-gt' }, mot(g.titre)),
        g.texte ? el('p', {}, mot(g.texte)) : null,
        g.avis ? el('p', { class: 'vx-fort' }, g.avis) : null,
        el('h4', {}, mot('q.detail')), el('p', { style: 'margin-top:0' }, `${g.phrase}.`),
        el('div', { class: 'vx-acts' },
          el('button', { type: 'button', class: `vx-btn ${g.ton === 'bad' ? 'dng' : 'pri'}`, disabled: S.occupe, 'data-f': 'q-ok', onclick: repondreOui }, S.occupe ? mot('k.demande') : mot(g.ok)),
          el('button', { type: 'button', class: 'vx-btn ghost', disabled: S.occupe, 'data-f': 'q-non', onclick: repondreNon }, mot('k.annuler'))));
    }
    /** L'interrupteur du tunnel (propriétaire seul). */
    function interrupteur() {
      const on = Boolean(S.D?.allume);
      return el('button', { type: 'button', class: 'vx-sw', role: 'switch', 'aria-checked': String(on), 'aria-label': mot('t.switch'), disabled: S.occupe || Boolean(S.gt), 'data-f': 'tunnel',
        onclick: () => (on ? poser('eteindre', {}, { titre: 'q.eteindre', texte: 'q.eteindre.texte', ok: 'q.eteindre.ok', ton: 'bad', retour: 'tunnel' }) : poser('allumer', {}, { titre: 'q.allumer', ok: 'q.allumer.ok', ton: 'calme', retour: 'tunnel' })) });
    }
    const resultat = (zone = 'tunnel') => (S.rt && S.rt.text && S.zone === zone ? el('p', { class: `vx-res${S.rt.ok ? '' : ' non'}`, role: 'status' }, S.rt.text) : null);
    return { S, viser, relire, poser, gardeTunnel, interrupteur, resultat };
  }

  // ---------------------------------------------------------------- l'écran « Appareils »
  function ecranAppareils(racine) {
    const B = socle(racine, () => tout()), S = B.S;
    Object.assign(S, { garde: null, res: null });
    S.fige = () => Boolean(S.garde);
    const zone = el('div', { class: 'vx-pile' }); racine.append(zone);
    const proprio = () => S.D?.proprietaire === true;
    const appareils = () => S.D?.appareils ?? [];

    function bandeau() {
      const D = S.D, t = D?.tunnel, on = Boolean(D?.allume);
      const ligne = !on ? (t?.moteur ? mot('t.moteur', { raison: t.moteur }) : mot('t.personne')) : t ? (t.adresse ? mot('t.joignable', { adresse: t.adresse, port: t.port }) : mot('t.sans')) : '';
      const ajouter = () => { const V = W.OdinVortex; V.aller(V.ecrans.some((e) => e.id === 'ajouter') ? 'ajouter' : 'tout'); };
      return el('section', { class: 'vx-card vx-pile' },
        el('div', { class: 'vx-tun' },
          proprio() ? B.interrupteur() : el('span', { class: `vx-etat${on ? ' ok' : ''}`, 'aria-hidden': 'true' }),
          el('span', { class: 'vx-tx' }, el('b', {}, mot(on ? 't.allume' : 't.eteint')), ligne ? el('span', { class: 'vx-muted' }, ligne) : null),
          proprio() ? el('button', { type: 'button', class: 'vx-btn pri', 'data-f': 'ajouter', onclick: ajouter }, ic('plus', 18), mot('t.ajouter')) : null),
        B.gardeTunnel(), B.resultat());
    }
    function chiffres() {
      const c = S.D?.chiffres ?? { connectes: 0, appareils: 0, coupes: 0, recu: 0, envoye: 0 };
      const une = (k, v, ton) => el('div', { class: `vx-stat ${ton}` }, el('small', {}, mot(k)), el('b', {}, String(v)));
      return el('div', { class: 'vx-stats' }, une('c.co', c.connectes, 'ok'), une('c.app', c.appareils, ''), une('c.coupes', c.coupes, c.coupes ? 'bad' : ''), une('c.trafic', taille(c.recu + c.envoye), ''));
    }
    function garde(d) {
      const g = S.garde, mien = d.ici, coupe = d.etat === 'coupe' || d.etat === 'fini';
      const annuler = () => { const cle = `${g.genre}:${d.ip}`; S.garde = null; tout(); B.viser(cle) || B.viser(`retirer:${d.ip}`); };
      const plutot = () => { if (mien || !S.D?.origineConnue) { S.garde = { ip: d.ip, genre: 'couper' }; tout(); B.viser('k-non'); } else void envoyer(d, 'couper'); };
      return el('div', { class: 'vx-garde', role: 'alert', 'aria-live': 'assertive', onkeydown: (ev) => { if (ev.key === 'Escape') { ev.preventDefault?.(); annuler(); } } },
        el('b', { class: 'vx-gt' }, mot(`k.${g.genre}`, { nom: d.nom })),
        mien ? el('p', { class: 'vx-fort' }, mot('k.ici')) : !S.D?.origineConnue ? el('p', { class: 'vx-fort' }, mot('k.inconnu', { nom: d.nom })) : null,
        el('p', {}, mot(`k.${g.genre}.texte`)),
        el('div', { class: 'vx-acts' },
          el('button', { type: 'button', class: 'vx-btn dng', disabled: S.occupe, 'data-f': 'k-ok', onclick: () => envoyer(d, g.genre) }, ic(g.genre === 'retirer' ? 'trash' : 'pause', 18), S.occupe ? mot('k.demande') : mot(mien ? `k.ok.ici.${g.genre}` : `k.ok.${g.genre}`, { nom: d.nom })),
          g.genre === 'retirer' && !coupe ? el('button', { type: 'button', class: 'vx-btn', disabled: S.occupe, 'data-f': 'k-plutot', onclick: plutot }, ic('pause', 18), mot('k.plutot')) : null,
          el('button', { type: 'button', class: 'vx-btn ghost', disabled: S.occupe, 'data-f': 'k-non', onclick: annuler }, mot('k.annuler'))));
    }
    /** Le geste lui-même : parti seulement d'un bouton qui nomme l'appareil (« le_mien » : dit en clair sur sa carte). */
    async function envoyer(d, genre) {
      if (S.occupe) return; S.occupe = true; tout(); B.viser('k-ok');
      const mien = d.ici ? { le_mien: true } : {};
      const r = genre === 'retirer' ? await demander('revoquer', { nom: d.nom, ...mien }, true) : await demander('activer', { nom: d.nom, actif: false, ...mien }, true);
      S.occupe = false; S.garde = null; S.res = { ip: d.ip, ...reponse(r) };
      // Retiré : sa carte n'existe plus, le résultat se lit en haut de la liste.
      if (genre === 'retirer' && S.res.ok) S.res.ip = '';
      await B.relire(); B.viser(`rouvrir:${d.ip}`) || B.viser(`couper:${d.ip}`) || B.viser('ajouter');
    }
    /** Avant le garde-fou : le serveur dit s'il faut une confirmation (il nomme l'appareil et prévient), ou refuse. */
    async function demanderGarde(d, genre) {
      if (S.occupe) return; S.occupe = true;
      const r = genre === 'retirer' ? await demander('revoquer', { nom: d.nom }, false) : await demander('activer', { nom: d.nom, actif: false }, false);
      S.occupe = false;
      if (r && r.confirm) { S.res = null; S.garde = { ip: d.ip, genre }; tout(); B.viser('k-non'); return; }
      // Pas de question : c'est fait (couper, quand Odin sait que ce n'est pas l'appareil que tu tiens), ou refusé.
      S.res = { ip: d.ip, ...reponse(r) };
      await B.relire(); B.viser(`rouvrir:${d.ip}`) || B.viser(`${genre}:${d.ip}`);
    }
    async function rouvrir(d) {
      if (S.occupe) return; S.occupe = true;
      const r = await demander('activer', { nom: d.nom, actif: true }, true);
      S.occupe = false; S.res = { ip: d.ip, ...reponse(r) };
      await B.relire(); B.viser(`couper:${d.ip}`) || B.viser(`rouvrir:${d.ip}`);
    }
    function carte(d) {
      const [ton, texte] = etatDe(d), P = proprio(), coupe = d.etat === 'coupe' || d.etat === 'fini';
      const fait = (k, v, o = {}) => el('div', {}, el('dt', {}, mot(k)), el('dd', { class: [o.mono ? 'vx-mono' : '', o.bad ? 'bad' : ''].filter(Boolean).join(' ') || null }, v));
      const fin = d.fin ? mot('v.le', { j: d.fin.split('-').reverse().join('/') }) : mot('v.sansfin');
      const actions = !P ? null
        : S.garde && S.garde.ip === d.ip ? garde(d)
          : el('div', { class: 'vx-acts' },
            d.etat === 'coupe' ? el('button', { type: 'button', class: 'vx-btn pri', 'data-f': `rouvrir:${d.ip}`, 'aria-label': `${mot('b.rouvrir')} : ${d.nom}`, onclick: () => rouvrir(d) }, ic('play', 18), mot('b.rouvrir'))
              : d.etat === 'fini' ? null
                : el('button', { type: 'button', class: 'vx-btn', 'data-f': `couper:${d.ip}`, 'aria-label': `${mot('b.couper')} : ${d.nom}`, onclick: () => demanderGarde(d, 'couper') }, ic('pause', 18), mot('b.couper')),
            // Remontrer son QR code ou son fichier : l'écran « Ajouter » (lot R8) le fait confirmer, puis le montre. Rien n'est demandé ici.
            W.OdinVortex.ecrans.some((e) => e.id === 'ajouter') ? el('button', { type: 'button', class: 'vx-btn', 'data-f': `qr:${d.ip}`, 'aria-label': `${mot('b.qr')} : ${d.nom}`, onclick: () => W.OdinVortex.aller('ajouter', { remontrer: d.nom }) }, ic('lock', 18), mot('b.qr')) : null,
            el('button', { type: 'button', class: 'vx-btn dng', 'data-f': `retirer:${d.ip}`, 'aria-label': `${mot('b.retirer')} : ${d.nom}`, onclick: () => demanderGarde(d, 'retirer') }, ic('trash', 18), mot('b.retirer')));
      return el('li', {}, el('article', { class: `vx-card vx-app${coupe ? ' coupe' : ''}`, 'aria-label': mot('l.carte', { nom: d.nom }) },
        el('div', { class: 'vx-top' }, el('span', { class: 'vx-lg' }, ic('app', 26)),
          el('div', { class: 'vx-nm' }, el('h3', {}, d.nom, d.ici ? el('span', { class: 'vx-tag' }, mot('g.ici')) : null), el('span', { class: `vx-co ${ton}` }, texte))),
        el('dl', { class: 'vx-faits' },
          fait('f.ip', d.ip, { mono: true }),
          fait('f.vu', d.connecte ? mot('v.maintenant') : quand(d.vu)),
          fait('f.depuis', d.depuis ? mot(d.ou === 'dehors' ? 'v.dehors' : 'v.maison', { ip: d.depuis }) : mot('v.rien'), { mono: Boolean(d.depuis) }),
          fait('f.trafic', mot('v.trafic', { recu: taille(d.recu), envoye: taille(d.envoye) })),
          fait('f.acces', mot(d.acces === 'tout' ? 'v.tout' : d.acces === 'adresses' ? 'v.adresses' : 'v.seule')),
          fait('f.fin', fin, { bad: d.etat === 'fini' })),
        P && d.etat === 'fini' && !(S.garde && S.garde.ip === d.ip) ? el('p', { class: 'vx-lead', style: 'margin:0' }, mot('b.fini')) : null,
        actions,
        S.res && S.res.ip === d.ip && S.res.text ? el('p', { class: `vx-res${S.res.ok ? '' : ' non'}`, role: 'status' }, S.res.text) : null));
    }
    function tout() {
      const D = S.D, l = appareils();
      zone.replaceChildren(...[
        D && D.limite ? el('div', { class: 'vx-note', role: 'note' }, ic('shield'), el('div', {}, el('b', {}, mot('membre.titre')), el('p', {}, D.limite))) : null,
        bandeau(), chiffres(),
        proprio() ? el('p', { class: 'vx-seul' }, ic('lock', 16), mot('a.seul')) : null,
        S.res && !S.res.ip && S.res.text ? el('p', { class: `vx-res${S.res.ok ? '' : ' non'}`, role: 'status' }, S.res.text) : null,
        l.length ? el('ul', { class: 'vx-grid', 'aria-label': mot('l.titre') }, l.map(carte)) : D && !D.limite ? el('p', { class: 'vx-vide' }, mot('l.aucun')) : null,
      ].filter(Boolean));
    }
    return { relire: B.relire, etat: S };
  }

  // ---------------------------------------------------------------- l'écran « Tunnel »
  function ecranTunnel(racine) {
    const B = socle(racine, () => tout()), S = B.S;
    Object.assign(S, { saisie: null, lit: false });
    S.fige = () => S.saisie !== null || S.lit;
    const zone = el('div', { class: 'vx-pile' }); racine.append(zone);

    async function lire() {
      if (S.lit || S.occupe) return; S.lit = true; S.rt = null; S.zone = 'adresse'; tout(); B.viser('lire');
      const r = await demander('detecter', {}, true);
      S.lit = false; S.rt = reponse(r);
      // Odin n'a pas pu vérifier que c'est bien la box qui a répondu : rien n'est changé. L'adresse est proposée dans le
      // champ, à toi de l'enregistrer (le serveur te montre alors ce qui change, et attend ton accord).
      const proposee = r && r.data && r.data.code === 'a_confirmer' ? String(r.data.ip ?? '') : '';
      await B.relire();
      if (proposee && adresseTapee(proposee) === 'bon') { S.saisie = proposee; tout(); B.viser('adresse'); } else B.viser('lire');
    }
    function saisie(t) {
      const v = S.saisie ?? '', juge = adresseTapee(v);
      const champ = el('input', { type: 'text', id: 'vx-adresse', maxlength: 200, value: v, placeholder: mot('d.ex'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: 'url', 'aria-describedby': 'vx-verdict', 'data-f': 'adresse',
        oninput: (e) => { S.saisie = e.target.value; const j = adresseTapee(S.saisie), p = zone.querySelector('#vx-verdict'), b = zone.querySelector('[data-f="d-ok"]'); if (p) { p.className = `vx-verdict${j === 'faux' ? ' bad' : ''}`; p.replaceChildren(document.createTextNode(verdict(j, S.saisie, t))); } if (b) { if (j === 'bon') b.removeAttribute('disabled'); else b.setAttribute('disabled', ''); } },
        onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault?.(); fermer(); } else if (e.key === 'Enter') { e.preventDefault?.(); enregistrer(); } } });
      champ.value = v;
      return el('div', { class: 'vx-pile' },
        el('div', { class: 'vx-champ' }, el('label', { for: 'vx-adresse' }, mot('d.champ')), champ),
        el('p', { id: 'vx-verdict', class: `vx-verdict${juge === 'faux' ? ' bad' : ''}`, role: 'status' }, verdict(juge, v, t)),
        el('div', { class: 'vx-acts' },
          el('button', { type: 'button', class: 'vx-btn pri', disabled: juge !== 'bon' || S.occupe, 'data-f': 'd-ok', onclick: enregistrer }, ic('check', 18), mot('d.ok')),
          el('button', { type: 'button', class: 'vx-btn ghost', 'data-f': 'd-non', onclick: fermer }, mot('d.non'))));
    }
    const verdict = (j, v, t) => (j === 'vide' ? mot('d.vide') : j === 'faux' ? mot('d.faux') : mot('d.bon', { adresse: String(v).trim(), port: t.port }));
    const fermer = () => { S.saisie = null; tout(); B.viser('ecrire'); };
    /** Écrire l'adresse à la main : un refus ne part jamais ; le serveur redemande si elle change (avant → après). */
    async function enregistrer() {
      const t = S.D?.tunnel, v = String(S.saisie ?? '').trim(); if (!t || adresseTapee(v) !== 'bon' || S.occupe) return;
      S.saisie = null;
      await B.poser('adresse', { adresse: v, port: t.port }, { titre: 'q.adresse', ok: 'q.adresse.ok', ton: 'calme', retour: 'ecrire', zone: 'adresse' });
    }
    function tout() {
      const D = S.D, t = D?.tunnel;
      if (!D) return void zone.replaceChildren();
      if (!t) return void zone.replaceChildren(el('div', { class: 'vx-note', role: 'note' }, ic('shield'), el('div', {}, el('b', {}, mot('membre.titre')), el('p', {}, D.limite || mot('r.proprio')))));
      const on = Boolean(D.allume), fait = (k, v, o = {}) => el('div', {}, el('dt', {}, mot(k)), el('dd', { class: [o.mono ? 'vx-mono' : '', o.bad ? 'bad' : ''].filter(Boolean).join(' ') || null }, v));
      const g = S.gt, pourPort = Boolean(g) && (g.action === 'ouvrir_port' || g.action === 'fermer_port'), pourAdresse = Boolean(g) && g.action === 'adresse';
      const ouvert = t.portBox === 'odin' || t.portBox === 'partage';
      zone.replaceChildren(
        el('section', { class: 'vx-card vx-pile' },
          el('div', { class: 'vx-tun' },
            el('div', { class: 'vx-tx' }, el('h2', {}, mot('n.titre'), el('span', { class: `vx-tag ${on ? 'ok' : 'off'}` }, mot(on ? 'n.allume' : 'n.eteint'))), el('p', { class: 'vx-lead' }, !on && t.moteur ? mot('t.moteur', { raison: t.moteur }) : mot('n.lead'))),
            B.interrupteur()),
          g && !pourPort && !pourAdresse ? B.gardeTunnel() : null,
          B.resultat('tunnel'),
          el('dl', { class: 'vx-faits' },
            fait('n.adresse', t.adresse || mot('n.adresse.sans'), { mono: Boolean(t.adresse), bad: !t.adresse }),
            t.adresse ? fait('n.trouvee', mot(t.trouvee === 'box' ? 'n.box' : t.trouvee === 'main' ? 'n.main' : 'n.avant')) : null,
            fait('n.lecture', t.box ? `${quand(t.box.quand)} · ${t.box.texte}` : mot('n.lecture.jamais'), { bad: Boolean(t.box && !t.box.ok) }),
            fait('n.port', mot('n.port.v', { port: t.port })),
            fait('n.portbox', mot(`p.${t.portBox}`), { bad: t.portBox === 'partage' }),
            fait('n.vpn', t.reseau, { mono: true }),
            fait('n.maison', t.maison.length ? t.maison.join(', ') : mot('n.maison.sans'), { mono: t.maison.length > 0 }),
            fait('n.dns', t.dns || mot('n.dns.sans'), { mono: Boolean(t.dns) }))),
        el('section', { class: 'vx-card vx-pile' },
          el('div', {}, el('h2', {}, mot('d.titre')), el('p', { class: 'vx-lead' }, mot('d.lead'))),
          pourAdresse ? B.gardeTunnel()
            : S.saisie !== null ? saisie(t)
              : el('div', { class: 'vx-acts' },
                el('button', { type: 'button', class: 'vx-btn pri', disabled: S.lit || S.occupe, 'data-f': 'lire', onclick: lire }, ic('refresh', 18), S.lit ? mot('d.lire.cours') : mot('d.lire')),
                el('button', { type: 'button', class: 'vx-btn', disabled: S.lit || S.occupe, 'data-f': 'ecrire', onclick: () => { S.saisie = t.adresse || ''; S.rt = null; tout(); B.viser('adresse'); } }, ic('pen', 18), mot('d.ecrire'))),
          B.resultat('adresse')),
        el('section', { class: 'vx-card vx-pile' },
          el('div', {}, el('h2', {}, mot('x.titre')), el('p', { class: 'vx-lead' }, mot('x.lead'))),
          pourPort ? B.gardeTunnel()
            : el('div', { class: 'vx-acts' }, ouvert
              ? el('button', { type: 'button', class: 'vx-btn', disabled: S.occupe, 'data-f': 'port', onclick: () => B.poser('fermer_port', {}, { titre: 'q.fermer', ok: 'q.fermer.ok', ton: 'bad', retour: 'port', zone: 'port' }) }, ic('x', 18), mot('x.fermer'))
              : el('button', { type: 'button', class: 'vx-btn', disabled: S.occupe, 'data-f': 'port', onclick: () => B.poser('ouvrir_port', {}, { titre: 'q.ouvrir', ok: 'q.ouvrir.ok', ton: 'calme', retour: 'port', zone: 'port' }) }, ic('tunnel', 18), mot('x.ouvrir'))),
          B.resultat('port')),
        el('section', { class: 'vx-card' }, el('h2', {}, mot('s.titre')), el('ul', { class: 'vx-ol' }, ['s.1', 's.2', 's.3', W.OdinVortex.ecrans.some((e) => e.id === 'ajouter') ? 's.4b' : 's.4'].map((k) => el('li', {}, mot(k))))),
        el('section', { class: 'vx-card' }, el('h2', {}, mot('w.titre')), el('p', { class: 'vx-lead' }, mot('w.texte'))));
    }
    return { relire: B.relire, etat: S };
  }

  // ---------------------------------------------------------------- la page de Vortex : ses écrans, en onglets
  const ECRANS = [
    { id: 'appareils', rang: 10, titre: () => mot('o.appareils'), dessiner: (n) => { const e = ecranAppareils(n); return { relire: e.relire, pret: e.relire() }; } },
    { id: 'tunnel', rang: 90, titre: () => mot('o.tunnel'), dessiner: (n) => { const e = ecranTunnel(n); return { relire: e.relire, pret: e.relire() }; } },
  ];
  W.OdinVortex = W.OdinVortex || {
    ecrans: ECRANS,
    /** Un autre écran de Vortex (Ajouter un appareil, Personnes…) : { id, titre, dessiner(noeud, quoi), rang } ; « rang » le place (Appareils 10, Tunnel 90). */
    ajouter(e) { if (e && e.id && !ECRANS.some((x) => x.id === e.id)) { ECRANS.push({ rang: 50, ...e, titre: typeof e.titre === 'function' ? e.titre : () => String(e.titre ?? e.id) }); ECRANS.sort((a, b) => a.rang - b.rang); } },
    MOTS, quand, taille, etatDe, question, adresseTapee,
    /** Ce que les autres écrans reprennent : fabriquer un élément (toujours du texte, jamais du HTML), une icône, demander à Vortex. */
    outils: { el, ic, demander, traits: TRAITS },
    /** Ouvrir un écran de Vortex (posé quand la page est montée) : aller(id, quoi). « tout » : la page complète. */
    aller: () => undefined,
  };
  // Les écrans chargés avant cette page (vortex-ajouter.js) attendaient ici.
  if (Array.isArray(W.OdinVortexPlus)) { for (const e of W.OdinVortexPlus.splice(0)) W.OdinVortex.ajouter(e); }
  let minuteur = 0, sortir = null;
  W.OdinPages.gjoll = async ({ host, generic }) => {
    // La page est montée de nouveau : l'écran d'avant efface ce qu'il ne doit pas garder.
    try { sortir?.(); } catch { /* rien */ }
    style();
    const racine = el('div', { class: 'vx' }), corps = el('div', { class: 'vx', role: 'tabpanel' }), gen = el('div', {}, ...(generic ?? []));
    const tabs = el('div', { class: 'vx-tabs', role: 'tablist', 'aria-label': mot('onglets') });
    let choisi = 'appareils', vivant = null;
    const ids = () => [...ECRANS.map((e) => e.id), 'tout'];
    const aller = async (id, viser, quoi) => {
      // L'écran qu'on quitte efface ce qu'il ne doit pas garder (un QR code montré).
      try { vivant?.quitter?.(); } catch { /* l'écran suivant s'ouvre quand même */ }
      choisi = id; vivant = null;
      tabs.replaceChildren(...ids().map((k) => { const e = ECRANS.find((x) => x.id === k); return el('button', { type: 'button', role: 'tab', class: 'vx-tab', id: `vx-tab-${k}`, 'aria-selected': String(k === choisi), tabindex: k === choisi ? '0' : '-1', onclick: () => aller(k, true),
        onkeydown: (ev) => { const l = ids(), i = l.indexOf(k), j = ev.key === 'ArrowRight' ? (i + 1) % l.length : ev.key === 'ArrowLeft' ? (i + l.length - 1) % l.length : ev.key === 'Home' ? 0 : ev.key === 'End' ? l.length - 1 : -1; if (j >= 0) { ev.preventDefault?.(); aller(l[j], true); } } }, e ? e.titre() : mot('o.tout')); }));
      corps.setAttribute('aria-labelledby', `vx-tab-${id}`);
      gen.hidden = id !== 'tout'; corps.hidden = id === 'tout';
      if (viser) for (const b of tabs.children) if (b.getAttribute('aria-selected') === 'true') b.focus();
      if (id === 'tout') return;
      const n = el('div', { class: 'vx' }); corps.replaceChildren(n);
      const v = ECRANS.find((x) => x.id === id).dessiner(n, quoi); vivant = v ?? null;
      try { await v?.pret; } catch { /* l'écran dit lui-même ce qui ne va pas */ }
    };
    racine.append(tabs, corps, gen); host.append(racine);
    sortir = () => { try { vivant?.quitter?.(); } catch { /* rien */ } vivant = null; };
    W.OdinVortex.aller = (id, quoi) => (id === 'tout' || ECRANS.some((x) => x.id === id) ? aller(id, true, quoi) : undefined);
    await aller(choisi);
    // En direct : relu toutes les 5 secondes tant que la page est ouverte et visible.
    clearInterval(minuteur);
    minuteur = setInterval(() => { if (!racine.isConnected) { sortir?.(); clearInterval(minuteur); return; } if (!document.hidden && vivant?.relire) void vivant.relire({ discret: true }); }, 5000);
    return true;
  };
})();
