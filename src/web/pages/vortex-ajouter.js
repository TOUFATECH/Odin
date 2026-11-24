// Vortex · « Ajouter un appareil » et son QR code (maquette « Réseau » validée, lot R8) : « QR code, son interface web ».
//   1. L'appareil : son nom (vérifié pendant la frappe) et sa sorte (téléphone ou tablette : un QR code ; ordinateur : un fichier).
//   2. L'accès : « Internet par la maison », « Toute la maison » ou « Seulement certaines adresses » ; une fin d'accès possible.
//      Rien n'est créé avant « Créer l'appareil », et Odin redemande (il dit ce qu'il va ouvrir).
//   3. Le QR code ou le fichier. Le QR code est CACHÉ : il n'est demandé à Odin qu'au geste « Montrer le QR code », il est
//      masqué de nouveau quand tu quittes l'écran, quand la page passe à l'arrière-plan, ou au bout de 2 minutes. Le fichier
//      est demandé à chaque geste « Télécharger » et remis une fois : la page ne le garde pas.
// « QR code ou fichier » sur la carte d'un appareil mène ici : la page fait confirmer (elle nomme l'appareil), puis demande.
// La clé d'un appareil n'est jamais gardée par cette page : ni dans une adresse, ni dans le stockage du navigateur, ni dans
// une variable une fois l'écran quitté. Tout passe par les actions de Vortex qui existent (« ajouter », « qr »,
// « telecharger » : propriétaire seul, notées « qui a fait quoi » ; la page ne décide de rien). Le QR code est dessiné ici
// case par case à partir du tracé qu'Odin envoie (vérifié : rien d'autre que des cases), jamais posé comme du HTML.
// Un nom d'appareil est TOUJOURS posé comme du texte. Tous les textes de la page sont dans MOTS.
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    onglet: 'Ajouter',
    seul: 'Réservé au propriétaire : Odin vérifie ta session avant de créer l\'appareil, et note chaque geste dans « qui a fait quoi ».',
    'membre.titre': 'Réservé au propriétaire', 'membre.texte': 'Ajouter un appareil au VPN, montrer son QR code ou son fichier : le propriétaire seul.',
    etapes: 'Étapes', 'e.1': 'L\'appareil', 'e.1s': 'Nom et sorte', 'e.2': 'L\'accès', 'e.2s': 'Quoi et jusqu\'à quand', 'e.3q': 'Le QR code', 'e.3f': 'Le fichier', 'e.3s': 'À scanner ou à ouvrir',
    '1.titre': 'Quel appareil ?', '1.nom': 'Son nom', '1.ex': 'Téléphone 3', '1.sorte': 'Sorte d\'appareil',
    '1.tel': 'Téléphone ou tablette', '1.tel.p': 'Il scanne un QR code avec l\'appli VPN du téléphone.',
    '1.pc': 'Ordinateur', '1.pc.p': 'Il reçoit un petit fichier de réglages à ouvrir avec l\'appli VPN de l\'ordinateur.',
    'n.vide': 'Écris le nom de l\'appareil (40 caractères au plus).', 'n.faux': 'Seulement des lettres, des chiffres, des espaces et . _ \' -', 'n.long': '40 caractères au plus.', 'n.pris': 'Un appareil porte déjà ce nom.', 'n.bon': 'Ce nom est libre.',
    '1.pied': 'Odin lui donnera une adresse dans le VPN.', continuer: 'Continuer', retour: 'Retour',
    '2.titre': 'Ce qui passe par le VPN', '2.acces': 'Accès',
    'a.internet': 'Internet par la maison', 'a.internet.p': 'Tout passe par la maison : l\'appareil surfe comme s\'il y était (pubs bloquées partout, Wi-Fi public protégé).', conseil: 'Conseillé',
    'a.maison': 'Toute la maison', 'a.maison.p': 'Internet reste direct ; les machines de la maison (stockage, imprimante…) passent par le VPN.',
    'a.adresses': 'Seulement certaines adresses', 'a.adresses.p': 'Seules les adresses de la maison que tu écris passent par le VPN.',
    '2.adresses': 'Les adresses de la maison', '2.adresses.ex': '10.0.0.10, 10.0.0.20',
    'd.vide': 'Écris au moins une adresse de la maison, séparées par des virgules (12 au plus).', 'd.faux': 'Des adresses comme 10.0.0.10 ou 10.0.0.0/28, séparées par des virgules.', 'd.bon': 'Odin vérifiera qu\'elles sont bien dans le réseau de la maison.',
    '2.limite': 'Ce choix règle l\'appareil lui-même (ce qu\'il envoie dans le VPN). Odin ne filtre pas encore ce qu\'un appareil connecté peut joindre dans la maison.',
    '2.fin': 'Fin de l\'accès', 'f.jamais': 'Jamais', 'f.1j': '1 jour', 'f.7j': '7 jours', 'f.30j': '30 jours', 'f.date': 'Une date', '2.date': 'Dernier jour de l\'accès',
    'f.note': 'Pour un invité : « 1 jour » ou « 7 jours », l\'accès se coupe tout seul.', 'f.passee': 'Choisis une date à partir d\'aujourd\'hui.', 'f.le': 'Dernier jour : {j}.',
    '2.pied': 'Rien n\'est créé avant ta confirmation.', creer: 'Créer l\'appareil', 'creer.cours': 'Odin vérifie…',
    'q.creer': 'Créer « {nom} » ?', 'q.detail': 'Ce qu\'Odin va faire', 'q.ok': 'Créer l\'appareil', annuler: 'Annuler',
    '3.titre.q': 'Scanne ce QR code avec le téléphone', '3.titre.f': 'Ouvre ce fichier sur l\'ordinateur',
    '3.resume': '« {nom} » · adresse {ip} · {acces} · fin : {fin}', 'r.jamais': 'jamais',
    'r.internet': 'tout passe par la maison', 'r.maison': 'la maison seulement', 'r.adresses': 'seulement certaines adresses',
    'q.1': 'Sur le téléphone, ouvre l\'appli VPN (celle qui lit un QR code).', 'q.2': '« Ajouter » → « Scanner un QR code ».', 'q.3': 'Active le tunnel : il apparaît ici « connecté ».',
    'p.1': 'Copie le fichier sur l\'ordinateur (clé USB, ou réseau de la maison).', 'p.2': 'Dans l\'appli VPN de l\'ordinateur : « Importer un fichier ».', 'p.3': 'Active le tunnel : il apparaît ici « connecté ».',
    's.titre.q': 'Ce QR code contient la clé secrète de l\'appareil', 's.titre.f': 'Ce fichier contient la clé secrète de l\'appareil',
    's.garde': 'Ne le montre qu\'à lui. Odin le garde chiffré dans le coffre : toi seul peux le remontrer, depuis la carte de l\'appareil.',
    's.garde.f': 'Ne le donne qu\'à lui. Odin le garde chiffré dans le coffre : toi seul peux le redemander, depuis la carte de l\'appareil.',
    's.attente': 'Le coffre est fermé : sa configuration attend, chiffrée, dans les réglages de Vortex. Elle ira dans le coffre dès qu\'il sera ouvert.',
    's.adresse': 'L\'adresse de la maison n\'est pas encore connue : sans elle, pas de QR code ni de fichier. Va dans « Tunnel », puis reviens par « QR code ou fichier » sur la carte de l\'appareil.',
    'qr.cache': 'QR code caché', 'qr.montrer': 'Montrer le QR code', 'qr.cours': 'Odin relit le coffre…', 'qr.masquer': 'Masquer le QR code', 'qr.alt': 'QR code de « {nom} », à scanner avec l\'appli VPN du téléphone',
    'qr.masque': 'QR code masqué.', 'qr.faux': 'Odin a répondu, mais sans QR code lisible. Rien n\'est montré.', 'qr.temps': 'Il se masque tout seul au bout de 2 minutes, et quand tu quittes cet écran.',
    'f.nom': 'Fichier de réglages', 'f.quoi': 'réglages et clé de cet appareil', 'f.telecharger': 'Télécharger le fichier', 'f.cours': 'Odin relit le coffre…', 'f.remis': 'Fichier « {nom} » remis. La page ne le garde pas : pour l\'avoir de nouveau, redemande-le.',
    'f.faux': 'Odin a répondu, mais sans fichier. Rien n\'est remis.', 'f.plutot': 'Plutôt le fichier (ordinateur)', 'q.plutot': 'Plutôt le QR code (téléphone)',
    'v.attente': 'En attente de la première connexion de « {nom} »…', 'v.connecte': '« {nom} » est connecté.', termine: 'Terminé', tunnel: 'Aller à « Tunnel »',
    'm.titre': 'QR code ou fichier de « {nom} »', 'm.question': 'Montrer la configuration de « {nom} » ?',
    'm.texte': 'Elle contient la clé secrète de cet appareil : ne la montre qu\'à lui. Odin la relit dans le coffre, et note ce geste dans « qui a fait quoi ».',
    'm.absent': 'Cet appareil n\'est plus dans le VPN.', 'm.retour': 'Revenir aux appareils',
    silence: 'Odin ne répond pas.',
  };
  const mot = (k, v = {}) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? ''));
  const TRAITS = {
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', eyeoff: 'M3 3l18 18M10.6 5.2A9.7 9.7 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.7 8.5 2 12 2 12s4 7 10 7c1.5 0 2.9-.4 4.1-1',
    down: 'M12 4v11M7 11l5 5 5-5M5 20h14', file: 'M7 3h7l4 4v14H7zM14 3v4h4', phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2', laptop: 'M5 6h14v10H5zM3 19h18',
    left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6',
  };

  // ---------------------------------------------------------------- ce qui se vérifie sans rien demander (pur)
  /** Le nom tapé : vide, mal écrit, trop long, ou bon (la même règle qu'Odin, qui revérifie). Pur. */
  function nomTape(v) {
    const t = String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!t) return 'vide';
    if ([...t].length > 40) return 'long';
    return /^[\p{L}\p{N}\p{M} _.'-]{1,40}$/u.test(t) && /[\p{L}\p{N}]/u.test(t) && !/^\p{M}/u.test(t) ? 'bon' : 'faux';
  }
  const nomPropre = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  /** Les adresses tapées : vides, mal écrites, ou bien écrites (Odin vérifie qu'elles sont dans la maison). Pur. */
  function adressesTapees(v) {
    const l = String(v ?? '').split(/[\s,;]+/).filter(Boolean);
    if (!l.length) return 'vide';
    const une = (x) => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(x); return Boolean(m) && [m[1], m[2], m[3], m[4]].every((n) => Number(n) <= 255) && (m[5] === undefined || (Number(m[5]) >= 16 && Number(m[5]) <= 32)); };
    return l.length <= 12 && l.every(une) ? 'bon' : 'faux';
  }
  const jourDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  /** Le dernier jour de l'accès (AAAA-MM-JJ) d'après le choix ; vide : sans fin ; « ? » : une date à corriger. Pur. */
  function finChoisie(choix, date, maintenant = Date.now()) {
    const n = { '1j': 1, '7j': 7, '30j': 30 }[choix], auj = new Date(maintenant);
    if (n) return jourDe(new Date(auj.getFullYear(), auj.getMonth(), auj.getDate() + n));
    if (choix !== 'date') return '';
    return /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) && String(date) >= jourDe(auj) ? String(date) : '?';
  }
  /** Le tracé reçu d'Odin est-il bien un QR code (des cases, rien d'autre) ? Pur. */
  function dessinValide(q) {
    return Boolean(q) && Number.isInteger(q.n) && q.n >= 21 && q.n <= 240 && typeof q.d === 'string' && q.d.length > 0 && q.d.length <= 400000 && /^(M\d{1,3} \d{1,3}h1v1h-1z)*$/.test(q.d);
  }
  const frJour = (j) => String(j).split('-').reverse().join('/');

  const CSS = `
.vxa-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;list-style:none;margin:0;padding:0}
.vxa-steps li{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:8px 12px;min-height:44px;min-width:0;font-size:13px;color:var(--muted)}
.vxa-steps li i{flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-weight:700;background:color-mix(in srgb,var(--muted) 20%,transparent);color:var(--ink)}
.vxa-steps li b{display:block;color:var(--ink);font-size:13.5px;overflow-wrap:anywhere}
.vxa-steps li[aria-current="step"]{border-color:var(--accent);border-width:2px}
.vxa-steps li[aria-current="step"] i{background:var(--accent);color:var(--on-accent,var(--bg,#fff))}
.vxa-steps li.fait i{background:var(--good);color:var(--bg,#fff)}
.vxa-choix{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:10px}
.vxa-carte{position:relative;text-align:left;min-height:44px;border:1px solid var(--line);border-radius:14px;background:var(--panel2,var(--panel));color:var(--ink);padding:12px 14px;font:inherit;cursor:pointer;display:flex;flex-direction:column;gap:4px;min-width:0}
.vxa-carte b{font-size:14.5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.vxa-carte span.p{font-size:13px;color:var(--muted);line-height:1.45}
.vxa-carte[aria-checked="true"]{border-color:var(--accent);border-width:2px;padding:11px 13px}
.vxa-conseil{font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--good) 20%,transparent);color:var(--good)}
.vxa-seg{display:flex;gap:8px;flex-wrap:wrap}
.vxa-seg button{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13.5px inherit;cursor:pointer}
.vxa-seg button[aria-pressed="true"]{background:var(--ink);color:var(--bg,#fff);border-color:var(--ink)}
.vxa-pied{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.vxa-pied .g{flex:1 1 200px;font-size:13px;color:var(--muted);min-width:0}
.vxa-wrap{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:18px;align-items:start}
.vxa-qr{background:#fff;color:#111;border:1px solid var(--line);border-radius:18px;padding:12px;width:100%;max-width:340px;margin:0 auto;display:flex;flex-direction:column;gap:10px;align-items:stretch}
.vxa-qr svg.code{display:block;width:100%;height:auto;background:#fff}
.vxa-voile{aspect-ratio:1/1;border-radius:12px;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;text-align:center;background:repeating-linear-gradient(45deg,#e9ebee 0 10px,#f6f7f8 10px 20px);color:#333;font-size:13px;font-weight:600;padding:10px}
.vxa-qr .vx-btn{justify-content:center;width:100%}
.vxa-fichier{display:flex;gap:12px;align-items:center;flex-wrap:wrap;border:1px solid var(--line);border-radius:14px;background:var(--panel2,var(--panel));padding:12px 14px;min-width:0}
.vxa-fichier .n{flex:1 1 160px;min-width:0;font-size:13px;color:var(--muted)}
.vxa-fichier .n b{display:block;color:var(--ink);font-size:14px;overflow-wrap:anywhere}
.vxa-vie{display:flex;gap:8px;align-items:center;margin:0;font-size:13.5px}
.vxa-vie::before{content:"";width:10px;height:10px;border-radius:50%;background:var(--muted);flex:none}
.vxa-vie.ok::before{background:var(--good)}
.vxa-lien{background:none;border:0;color:var(--accent);font:600 13px inherit;cursor:pointer;min-height:44px;padding:0 4px;text-align:left;text-decoration:underline}
@media (max-width:720px){.vxa-wrap{grid-template-columns:minmax(0,1fr)}.vxa-steps li span small{display:none}}
`;

  // ---------------------------------------------------------------- l'écran
  function ecran(racine, quoi) {
    const V = W.OdinVortex, { el, ic, demander, traits } = V.outils;
    Object.assign(traits, TRAITS);
    if (!document.getElementById('vxa-css')) document.head.append(el('style', { id: 'vxa-css' }, CSS));
    const cible = quoi && typeof quoi.remontrer === 'string' ? quoi.remontrer : '';
    const S = { D: null, et: 1, nom: '', sorte: 'tel', acces: 'internet', adresses: '', fin: 'jamais', date: '', occupe: false, q: null, res: null, cree: null, dessin: null, finQr: 0, zone: '', pret: !cible };
    const zone = el('div', { class: 'vx-pile' }); racine.append(zone);
    const viser = (cle) => { for (const n of racine.querySelectorAll('[data-f]')) if (n.getAttribute('data-f') === cle) { n.focus(); return true; } return false; };
    const reponse = (r) => ({ ok: Boolean(r) && r.ok !== false && !r.error, text: String(r?.text ?? r?.error ?? mot('silence')), code: r?.data?.code ?? '' });
    const appareils = () => S.D?.appareils ?? [];
    const pris = (nom) => appareils().some((d) => d.nom === nom);
    /** Le nom de l'appareil dont on montre la configuration (créé à l'instant, ou choisi sur sa carte). */
    const sujet = () => (cible || S.cree?.nom || '');

    // ---- le QR code : jamais gardé au-delà de l'écran
    /** Masque le QR code et l'oublie (le tracé n'est plus nulle part dans la page). */
    function masquer(dire) { desarmer(); if (!S.dessin) return false; S.dessin = null; S.finQr = 0; if (dire) { S.res = { ok: true, text: mot('qr.masque') }; S.zone = 'secret'; } return true; }
    // Les 2 minutes ne dépendent pas d'Odin : une minuterie de la page masque le QR code même si Odin ne répond plus.
    let minuterie = 0;
    function desarmer() { if (minuterie && typeof W.clearTimeout === 'function') W.clearTimeout(minuterie); minuterie = 0; }
    function armer() { desarmer(); if (typeof W.setTimeout === 'function') minuterie = W.setTimeout(() => { minuterie = 0; echoir(); }, 120500); }
    /** Les 2 minutes sont passées : le QR code est masqué tout de suite et l'écran redessiné, sans rien attendre d'Odin. */
    function echoir() {
      if (!S.dessin || Date.now() <= S.finQr) return false;
      const cle = document.activeElement?.getAttribute?.('data-f');
      masquer(true); tout(); if (cle) viser(cle === 'masquer' ? 'montrer' : cle);
      return true;
    }
    const cacheSiCachee = () => { if (!racine.isConnected) quitter(); else if (document.hidden && masquer(true)) tout(); };
    document.addEventListener?.('visibilitychange', cacheSiCachee);
    let parti = false;
    function quitter() { parti = true; masquer(false); S.q = null; S.res = null; document.removeEventListener?.('visibilitychange', cacheSiCachee); zone.replaceChildren(); }

    async function relire(o = {}) {
      if (!racine.isConnected) { quitter(); return; }
      // Le QR code ne reste pas affiché : 2 minutes au plus. Masqué AVANT de demander quoi que ce soit à Odin (il peut ne pas répondre).
      echoir();
      const r = await demander('appareils_vus');
      if (!racine.isConnected) { quitter(); return; }
      const avant = JSON.stringify(S.D);
      if (r && r.data && Array.isArray(r.data.appareils)) S.D = r.data; else if (!S.D) S.D = { appareils: [], proprietaire: false, tunnel: null };
      // En direct : seulement l'étape 3 bouge (la première connexion). Jamais pendant une saisie ni une question.
      if (o.discret && (S.occupe || S.q || (S.et < 3 && !cible) || avant === JSON.stringify(S.D))) return;
      const cle = document.activeElement?.getAttribute?.('data-f');
      tout(); if (cle) viser(cle);
    }

    // ---- étape 1 : le nom et la sorte
    function verdictNom() { const j = nomTape(S.nom); return j === 'bon' && pris(nomPropre(S.nom)) ? ['pris', true] : [j, j === 'faux' || j === 'long']; }
    const nomBon = () => verdictNom()[0] === 'bon';
    function radios(nomGroupe, choix, courant, choisir, prefixe) {
      const bouger = (ev, k) => { const i = choix.findIndex((c) => c.k === k), j = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? (i + 1) % choix.length : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? (i + choix.length - 1) % choix.length : -1; if (j >= 0) { ev.preventDefault?.(); choisir(choix[j].k); viser(`${prefixe}:${choix[j].k}`); } };
      return el('div', { class: 'vxa-choix', role: 'radiogroup', 'aria-label': mot(nomGroupe) }, choix.map((c) => el('button', { type: 'button', class: 'vxa-carte', role: 'radio', 'aria-checked': String(courant === c.k), tabindex: courant === c.k ? '0' : '-1', 'data-f': `${prefixe}:${c.k}`, onclick: () => { choisir(c.k); viser(`${prefixe}:${c.k}`); }, onkeydown: (ev) => bouger(ev, c.k) },
        el('b', {}, c.icone ? ic(c.icone, 22) : null, mot(c.titre), c.conseil ? el('span', { class: 'vxa-conseil' }, mot('conseil')) : null), el('span', { class: 'p' }, mot(c.texte)))));
    }
    function etape1() {
      const [j, mauvais] = verdictNom();
      const champ = el('input', { type: 'text', id: 'vxa-nom', maxlength: 60, placeholder: mot('1.ex'), autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'vxa-nom-v', 'data-f': 'nom',
        oninput: (e) => { S.nom = e.target.value; const [k, m] = verdictNom(), p = zone.querySelector('#vxa-nom-v'), b = zone.querySelector('[data-f="suite"]'); if (p) { p.className = `vx-verdict${m ? ' bad' : ''}`; p.replaceChildren(document.createTextNode(mot(`n.${k}`))); } if (b) { if (k === 'bon') b.removeAttribute('disabled'); else b.setAttribute('disabled', ''); } },
        onkeydown: (e) => { if (e.key === 'Enter' && nomBon()) { e.preventDefault?.(); aller(2); } } });
      champ.value = S.nom;
      return [el('section', { class: 'vx-card vx-pile' }, el('h2', {}, mot('1.titre')),
        el('div', { class: 'vx-champ', style: 'max-width:420px' }, el('label', { for: 'vxa-nom' }, mot('1.nom')), champ),
        el('p', { id: 'vxa-nom-v', class: `vx-verdict${mauvais ? ' bad' : ''}`, role: 'status' }, mot(`n.${j}`)),
        radios('1.sorte', [{ k: 'tel', titre: '1.tel', texte: '1.tel.p', icone: 'phone' }, { k: 'pc', titre: '1.pc', texte: '1.pc.p', icone: 'laptop' }], S.sorte, (k) => { S.sorte = k; tout(); }, 'sorte')),
      el('div', { class: 'vxa-pied' }, el('span', { class: 'g' }, mot('1.pied')), el('button', { type: 'button', class: 'vx-btn pri', disabled: j !== 'bon', 'data-f': 'suite', onclick: () => aller(2) }, mot('continuer'), ic('right', 18)))];
    }

    // ---- étape 2 : l'accès et la fin
    const finJour = () => finChoisie(S.fin, S.date);
    const pretACreer = () => nomBon() && (S.acces !== 'adresses' || adressesTapees(S.adresses) === 'bon') && finJour() !== '?';
    const majCreer = () => { const b = zone.querySelector('[data-f="creer"]'); if (b) { if (pretACreer() && !S.occupe) b.removeAttribute('disabled'); else b.setAttribute('disabled', ''); } };
    function etape2() {
      const ja = adressesTapees(S.adresses), fj = finJour();
      const adr = el('input', { type: 'text', id: 'vxa-adr', maxlength: 300, placeholder: mot('2.adresses.ex'), autocomplete: 'off', spellcheck: 'false', inputmode: 'text', 'aria-describedby': 'vxa-adr-v', 'data-f': 'adresses',
        oninput: (e) => { S.adresses = e.target.value; const k = adressesTapees(S.adresses), p = zone.querySelector('#vxa-adr-v'); if (p) { p.className = `vx-verdict${k === 'faux' ? ' bad' : ''}`; p.replaceChildren(document.createTextNode(mot(`d.${k}`))); } majCreer(); } });
      adr.value = S.adresses;
      const date = el('input', { type: 'date', id: 'vxa-date', min: jourDe(new Date()), 'aria-describedby': 'vxa-date-v', 'data-f': 'date',
        oninput: (e) => { S.date = e.target.value; const f = finJour(), p = zone.querySelector('#vxa-date-v'); if (p) { p.className = `vx-verdict${f === '?' ? ' bad' : ''}`; p.replaceChildren(document.createTextNode(f === '?' ? mot('f.passee') : mot('f.le', { j: frJour(f) }))); } majCreer(); } });
      date.value = S.date;
      const q = S.q;
      return [el('section', { class: 'vx-card vx-pile' }, el('h2', {}, mot('2.titre')),
        radios('2.acces', [{ k: 'internet', titre: 'a.internet', texte: 'a.internet.p', conseil: true }, { k: 'maison', titre: 'a.maison', texte: 'a.maison.p' }, { k: 'adresses', titre: 'a.adresses', texte: 'a.adresses.p' }], S.acces, (k) => { S.acces = k; S.res = null; tout(); }, 'acces'),
        S.acces === 'adresses' ? el('div', { class: 'vx-pile' }, el('div', { class: 'vx-champ' }, el('label', { for: 'vxa-adr' }, mot('2.adresses')), adr), el('p', { id: 'vxa-adr-v', class: `vx-verdict${ja === 'faux' ? ' bad' : ''}`, role: 'status' }, mot(`d.${ja}`))) : null,
        el('p', { class: 'vx-lead', style: 'margin:0' }, mot('2.limite')),
        el('div', { class: 'vx-champ' }, el('span', { id: 'vxa-fin-l', style: 'font-weight:600' }, mot('2.fin')),
          el('div', { class: 'vxa-seg', role: 'group', 'aria-labelledby': 'vxa-fin-l' }, ['jamais', '1j', '7j', '30j', 'date'].map((k) => el('button', { type: 'button', 'aria-pressed': String(S.fin === k), 'data-f': `fin:${k}`, onclick: () => { S.fin = k; tout(); viser(k === 'date' ? 'date' : `fin:${k}`); } }, mot(`f.${k}`))))),
        S.fin === 'date' ? el('div', { class: 'vx-pile' }, el('div', { class: 'vx-champ', style: 'max-width:240px' }, el('label', { for: 'vxa-date' }, mot('2.date')), date), el('p', { id: 'vxa-date-v', class: `vx-verdict${fj === '?' ? ' bad' : ''}`, role: 'status' }, fj === '?' ? mot('f.passee') : mot('f.le', { j: frJour(fj) })))
          : el('p', { class: 'vx-verdict' }, fj ? mot('f.le', { j: frJour(fj) }) : mot('f.note')),
        q ? el('div', { class: 'vx-garde calme', role: 'alert', 'aria-live': 'assertive', onkeydown: (ev) => { if (ev.key === 'Escape') { ev.preventDefault?.(); refuser(); } } },
          el('b', { class: 'vx-gt' }, mot('q.creer', { nom: nomPropre(S.nom) })), q.avis ? el('p', { class: 'vx-fort' }, q.avis) : null,
          el('h4', {}, mot('q.detail')), el('p', { style: 'margin-top:0' }, `${q.phrase}.`),
          el('div', { class: 'vx-acts' }, el('button', { type: 'button', class: 'vx-btn pri', disabled: S.occupe, 'data-f': 'q-ok', onclick: () => creer(true) }, ic('check', 18), S.occupe ? mot('creer.cours') : mot('q.ok')), el('button', { type: 'button', class: 'vx-btn ghost', disabled: S.occupe, 'data-f': 'q-non', onclick: refuser }, mot('annuler')))) : null,
        resultat('creer')),
      q ? null : el('div', { class: 'vxa-pied' }, el('span', { class: 'g' }, mot('2.pied')),
        el('button', { type: 'button', class: 'vx-btn', disabled: S.occupe, 'data-f': 'retour', onclick: () => aller(1) }, ic('left', 18), mot('retour')),
        el('button', { type: 'button', class: 'vx-btn pri', disabled: !pretACreer() || S.occupe, 'data-f': 'creer', onclick: () => creer(false) }, ic('check', 18), S.occupe ? mot('creer.cours') : mot('creer')))];
    }
    const refuser = () => { S.q = null; tout(); viser('creer'); };
    /** Créer l'appareil : Odin redemande d'abord (rien ne part) ; la réponse ne porte aucune clé (« montrer : non »). */
    async function creer(accord) {
      if (S.occupe || !pretACreer()) return;
      const fin = finJour(), nom = nomPropre(S.nom);
      const input = { nom, acces: S.acces, ...(S.acces === 'adresses' ? { adresses: S.adresses.trim() } : {}), fin, montrer: false };
      S.occupe = true; S.res = null; tout(); viser(accord ? 'q-ok' : 'creer');
      const r = await demander('ajouter', input, accord); S.occupe = false;
      if (r && r.confirm) { S.q = V.question(r.confirm); tout(); viser('q-non'); return; }
      S.q = null; const x = reponse(r);
      if (!x.ok) { S.res = x; S.zone = 'creer'; tout(); viser('creer'); return; }
      S.cree = { nom: String(r.data?.name ?? nom), ip: String(r.data?.ip ?? ''), garde: r.data?.garde === true, adresse: r.data?.adresse !== false, acces: S.acces, fin };
      S.et = 3; S.res = null; await relire(); viser(S.sorte === 'tel' ? 'montrer' : 'fichier') || viser('termine');
    }

    // ---- étape 3, et « QR code ou fichier » depuis une carte : la configuration, sur un geste
    const resultat = (z) => (S.res && S.res.text && S.zone === z ? el('p', { class: `vx-res${S.res.ok ? '' : ' non'}`, role: 'status' }, S.res.text) : null);
    /** Le QR code, dessiné case par case à partir du tracé vérifié : noir sur blanc, avec sa marge blanche. */
    function imageQr(q, nom) {
      const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), fond = document.createElementNS(NS, 'rect'), cases = document.createElementNS(NS, 'path');
      for (const [k, v] of Object.entries({ viewBox: `0 0 ${q.n} ${q.n}`, class: 'code', role: 'img', 'aria-label': mot('qr.alt', { nom }), 'shape-rendering': 'crispEdges', focusable: 'false' })) s.setAttribute(k, String(v));
      for (const [k, v] of Object.entries({ width: q.n, height: q.n, fill: '#fff' })) fond.setAttribute(k, String(v));
      cases.setAttribute('d', q.d); cases.setAttribute('fill', '#000'); s.append(fond, cases); return s;
    }
    /** « Montrer le QR code » : le geste. Odin relit le coffre, note le geste, et envoie le tracé ; rien d'autre n'est gardé. */
    async function montrer() {
      const nom = sujet(); if (S.occupe || !nom) return;
      S.occupe = true; S.res = null; S.pret = true; tout(); viser('montrer');
      const r = await demander('qr', { nom }, true); S.occupe = false;
      // L'écran a été quitté pendant qu'Odin répondait : la réponse (elle porte la clé) est jetée, rien n'est gardé ni dessiné.
      if (parti || !racine.isConnected) return;
      const x = reponse(r), q = r?.data?.dessin;
      if (x.ok && dessinValide(q)) { S.dessin = { n: q.n, d: q.d }; S.finQr = Date.now() + 120000; armer(); S.res = x.text.includes('⚠') ? { ok: false, text: x.text.slice(x.text.indexOf('⚠')) } : null; S.zone = 'secret'; tout(); viser('masquer'); return; }
      S.res = x.ok ? { ok: false, text: mot('qr.faux') } : x; S.zone = 'secret'; tout(); (S.res.code === 'adresse' && viser('tunnel')) || viser('montrer');
    }
    /** « Télécharger le fichier » : demandé à chaque geste, remis une fois, jamais gardé par la page. */
    async function telecharger() {
      const nom = sujet(); if (S.occupe || !nom) return;
      S.occupe = true; S.res = null; S.pret = true; tout(); viser('fichier');
      const r = await demander('telecharger', { nom }, true); S.occupe = false;
      if (parti || !racine.isConnected) return;
      const x = reponse(r), conf = r?.data?.conf;
      if (x.ok && typeof conf === 'string' && conf) {
        const fichier = String(r.data.filename || 'vortex.conf').replace(/[^\w.-]/g, '_').slice(0, 60) || 'vortex.conf';
        const url = URL.createObjectURL(new Blob([conf], { type: 'application/octet-stream' })), a = el('a', { href: url, download: fichier, hidden: true });
        document.body.append(a); a.click(); a.remove();
        const liberer = () => URL.revokeObjectURL(url); if (typeof W.setTimeout === 'function') W.setTimeout(liberer, 30000); else liberer();
        S.res = { ok: true, text: mot('f.remis', { nom: fichier }) };
      } else S.res = x.ok ? { ok: false, text: mot('f.faux') } : x;
      S.zone = 'secret'; tout(); (S.res.code === 'adresse' && viser('tunnel')) || viser('fichier');
    }
    function zoneSecret(nom, sorte) {
      const sansAdresse = S.res && S.res.code === 'adresse';
      const qr = el('div', { class: 'vxa-qr' },
        S.dessin ? imageQr(S.dessin, nom) : el('div', { class: 'vxa-voile' }, ic('lock', 30), el('span', {}, mot('qr.cache'))),
        S.dessin ? el('button', { type: 'button', class: 'vx-btn', 'data-f': 'masquer', onclick: () => { masquer(true); tout(); viser('montrer'); } }, ic('eyeoff', 18), mot('qr.masquer'))
          : el('button', { type: 'button', class: 'vx-btn pri', disabled: S.occupe, 'data-f': 'montrer', onclick: montrer }, ic('eye', 18), S.occupe ? mot('qr.cours') : mot('qr.montrer')));
      const fichier = el('div', { class: 'vxa-fichier' }, el('span', { class: 'vx-lg' }, ic('file', 26)), el('span', { class: 'n' }, el('b', {}, mot('f.nom')), mot('f.quoi')),
        el('button', { type: 'button', class: 'vx-btn pri', disabled: S.occupe, 'data-f': 'fichier', onclick: telecharger }, ic('down', 18), S.occupe ? mot('f.cours') : mot('f.telecharger')));
      const tel = sorte === 'tel', d = appareils().find((x) => x.nom === nom), co = Boolean(d?.connecte);
      return el('div', { class: 'vxa-wrap' }, tel ? qr : fichier,
        el('div', { class: 'vx-pile' },
          el('ol', { class: 'vx-ol', style: 'margin-top:0' }, (tel ? ['q.1', 'q.2', 'q.3'] : ['p.1', 'p.2', 'p.3']).map((k) => el('li', {}, mot(k)))),
          el('div', { class: 'vx-note', role: 'note' }, ic('lock'), el('div', {}, el('b', {}, mot(tel ? 's.titre.q' : 's.titre.f')), el('p', {}, S.cree && !S.cree.garde && !cible ? mot('s.attente') : mot(tel ? 's.garde' : 's.garde.f')), tel ? el('p', {}, mot('qr.temps')) : null)),
          resultat('secret'),
          sansAdresse ? el('button', { type: 'button', class: 'vx-btn', 'data-f': 'tunnel', onclick: () => V.aller('tunnel') }, ic('tunnel', 18), mot('tunnel')) : null,
          el('p', { class: `vxa-vie${co ? ' ok' : ''}`, role: 'status' }, mot(co ? 'v.connecte' : 'v.attente', { nom })),
          el('button', { type: 'button', class: 'vxa-lien', 'data-f': 'plutot', onclick: () => { masquer(false); S.res = null; S.sorte = tel ? 'pc' : 'tel'; tout(); viser('plutot'); } }, mot(tel ? 'f.plutot' : 'q.plutot'))));
    }
    function etape3() {
      const c = S.cree, tel = S.sorte === 'tel';
      return [el('section', { class: 'vx-card vx-pile' }, el('h2', {}, mot(tel ? '3.titre.q' : '3.titre.f')),
        el('p', { class: 'vx-lead', style: 'margin:0' }, mot('3.resume', { nom: c.nom, ip: c.ip, acces: mot(`r.${c.acces}`), fin: c.fin ? frJour(c.fin) : mot('r.jamais') })),
        c.adresse ? null : el('p', { class: 'vx-res non', role: 'status' }, mot('s.adresse')),
        zoneSecret(c.nom, S.sorte)),
      el('div', { class: 'vxa-pied' }, el('span', { class: 'g' }), el('button', { type: 'button', class: 'vx-btn', 'data-f': 'termine', onclick: terminer }, ic('check', 18), mot('termine')))];
    }
    const terminer = () => { quitter(); V.aller('appareils'); };
    /** Venu d'une carte : la page fait confirmer (elle nomme l'appareil) avant de demander quoi que ce soit à Odin. */
    function remontrer() {
      const d = appareils().find((x) => x.nom === cible);
      if (!d) return [el('section', { class: 'vx-card vx-pile' }, el('h2', {}, mot('m.titre', { nom: cible })), el('p', { class: 'vx-res non', role: 'status' }, mot('m.absent')), el('div', { class: 'vx-acts' }, el('button', { type: 'button', class: 'vx-btn', 'data-f': 'termine', onclick: terminer }, mot('m.retour'))))];
      if (!S.pret) return [el('section', { class: 'vx-card vx-pile' }, el('h2', {}, mot('m.titre', { nom: cible })),
        el('div', { class: 'vx-garde calme', role: 'alert', 'aria-live': 'assertive', onkeydown: (ev) => { if (ev.key === 'Escape') { ev.preventDefault?.(); terminer(); } } },
          el('b', { class: 'vx-gt' }, mot('m.question', { nom: cible })), el('p', {}, mot('m.texte')),
          el('div', { class: 'vx-acts' },
            el('button', { type: 'button', class: 'vx-btn pri', disabled: S.occupe, 'data-f': 'montrer', onclick: () => { S.sorte = 'tel'; void montrer(); } }, ic('eye', 18), mot('qr.montrer')),
            el('button', { type: 'button', class: 'vx-btn', disabled: S.occupe, 'data-f': 'fichier', onclick: () => { S.sorte = 'pc'; void telecharger(); } }, ic('down', 18), mot('f.telecharger')),
            el('button', { type: 'button', class: 'vx-btn ghost', 'data-f': 'q-non', onclick: terminer }, mot('annuler')))))];
      return [el('section', { class: 'vx-card vx-pile' }, el('h2', {}, mot('m.titre', { nom: cible })), zoneSecret(cible, S.sorte)),
        el('div', { class: 'vxa-pied' }, el('span', { class: 'g' }), el('button', { type: 'button', class: 'vx-btn', 'data-f': 'termine', onclick: terminer }, ic('check', 18), mot('termine')))];
    }

    function aller(n) { if (n === 2 && !nomBon()) return; S.et = n; S.q = null; S.res = null; tout(); viser(n === 1 ? 'nom' : `acces:${S.acces}`); }
    function etapes() {
      const l = [['e.1', 'e.1s'], ['e.2', 'e.2s'], [S.sorte === 'tel' ? 'e.3q' : 'e.3f', 'e.3s']];
      return el('ol', { class: 'vxa-steps', 'aria-label': mot('etapes') }, l.map(([b, s], i) => el('li', { class: S.et > i + 1 ? 'fait' : null, 'aria-current': S.et === i + 1 ? 'step' : null },
        el('i', { 'aria-hidden': 'true' }, S.et > i + 1 ? ic('check', 14) : String(i + 1)), el('span', {}, el('b', {}, mot(b)), el('small', {}, mot(s))))));
    }
    function tout() {
      const D = S.D; if (!D) return void zone.replaceChildren();
      if (D.proprietaire !== true) return void zone.replaceChildren(el('div', { class: 'vx-note', role: 'note' }, ic('shield'), el('div', {}, el('b', {}, mot('membre.titre')), el('p', {}, mot('membre.texte')))));
      const corps = cible ? remontrer() : [etapes(), ...(S.et === 1 ? etape1() : S.et === 2 ? etape2() : etape3())];
      zone.replaceChildren(el('p', { class: 'vx-seul' }, ic('lock', 16), mot('seul')), ...corps.filter(Boolean));
    }
    return { relire, quitter, etat: S, pret: relire().then(() => { viser(cible ? 'q-non' : 'nom'); }) };
  }

  const ECRAN = { id: 'ajouter', rang: 50, titre: () => mot('onglet'), dessiner: (n, quoi) => ecran(n, quoi) };
  // vortex.js est chargé après ce fichier (ordre des noms) : l'écran attend dans OdinVortexPlus ; chargé avant, il s'ajoute tout de suite.
  if (W.OdinVortex && typeof W.OdinVortex.ajouter === 'function') W.OdinVortex.ajouter(ECRAN);
  else (W.OdinVortexPlus = W.OdinVortexPlus || []).push(ECRAN);
  W.OdinVortexAjout = { MOTS, nomTape, adressesTapees, finChoisie, dessinValide };
})();
