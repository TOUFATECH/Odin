// Sphinx · « Réglages DHCP » (maquette « Réseau » validée, lot R4) : qui distribue les adresses de la maison.
//   - « Deux usages du DHCP, deux réglages » : ici les adresses de toute la maison ; dans Genèse, le serveur de démarrage
//     (un lien y mène) ; ce que Genèse fait en ce moment est dit par le serveur ;
//   - « La box » ou « Odin distribue les adresses » ; LE GARDE-FOU dans la page : avant d'allumer, ce qu'Odin va vérifier
//     et ce qu'il faut avoir fait ; « Refusé : ça casserait le réseau de la maison » tant qu'un autre serveur d'adresses
//     répond, avec « revérifier » et « Laisser la box distribuer » ; en marche, l'heure de la dernière vérification ;
//     arrêté par le garde-fou, la raison, et rien ne repart sans toi ;
//   - le filet : ce qui se passe pour la maison si Odin s'éteint (les phrases viennent du serveur, avec les heures) ;
//   - les adresses données : plage, passerelle, masque, DNS donné, DNS de secours, durée du bail, nom de la maison ;
//     Odin vérifie pendant que tu tapes et dit ce que le changement fait aux appareils déjà là ;
//   - « Toutes les machines » ou « Seulement les machines approuvées » : avant de passer au second, la liste de celles
//     qui seront approuvées d'abord (elles ont une adresse en ce moment), et à part celles qui ne le seront PAS : les
//     nouvelles (arrivées depuis moins d'un jour), qui attendront ton accord.
// Tout ce qui est vrai vient du serveur (lecture « dhcp_etat », qui vérifie aussi des réglages sans rien écrire) ; les
// gestes passent par les actions « dhcp_demarrer », « dhcp_arreter », « dhcp_reglages », « dhcp_mode » (propriétaire
// seul, mêmes règles côté serveur : la page ne décide de rien). Un nom d'appareil vient du réseau : il est TOUJOURS posé
// comme du texte, jamais comme du HTML. Tous les textes de la page sont dans MOTS. L'écran s'ajoute à la page de Sphinx
// (sphinx-appareils.js).
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;
  const SX = W.OdinSphinx;
  if (!SX || !SX.outils || typeof SX.ajouter !== 'function') return;
  const { el, ic, demander, traits } = SX.outils;
  traits.reverif = 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5';
  traits.sortie = 'M14 5h5v5M19 5l-8 8M11 7H6v11h11v-5';

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    onglet: 'Réglages DHCP',
    'membre.titre': 'Ce que tu vois', 'membre.odin': 'Odin distribue les adresses de la maison.', 'membre.box': 'La box distribue les adresses de la maison.',
    'pont.titre': 'Deux usages du DHCP, deux réglages',
    'pont.texte': 'Ici : les adresses de toute la maison (téléphones, PC, télé). Dans Genèse → Réseau : le serveur de démarrage, seulement pour les PC qui démarrent par le réseau et que tu as autorisés. Un seul serveur d\'adresses d\'Odin par carte réseau : les deux ne se marchent jamais dessus.',
    'pont.lien': 'Démarrage réseau (Genèse)',
    'qui.titre': 'Qui distribue les adresses de la maison ?', 'qui.lead': 'Un seul serveur d\'adresses à la fois sur un réseau.', 'qui.groupe': 'Qui distribue les adresses',
    'qui.box': 'La box', 'qui.box.p': 'Rien ne change. Odin regarde.', 'qui.box.1': 'Rien à régler', 'qui.box.2': 'Pas de blocage ni d\'adresse fixe par Odin',
    'qui.odin': 'Odin distribue les adresses', 'qui.odin.p': 'Pour bloquer une machine, réserver une adresse et nommer chaque machine.',
    'qui.odin.1': 'Le serveur d\'adresses de la box est coupé d\'abord', 'qui.odin.2': 'Vérifié avant d\'allumer, puis chaque minute', 'qui.odin.conseil': 'Pour bloquer et réserver',
    'qui.choisi': 'choisi',
    'g.box.titre': 'Le réseau de la maison n\'est pas touché',
    'g.box.texte': 'La box garde les adresses. Odin voit les machines qu\'il repère sur le réseau, mais ne peut ni bloquer ni réserver par le DHCP. Couper Internet à une machine reste possible, par le DNS.',
    'g.libre.titre': 'Aucun autre serveur d\'adresses : Odin distribue',
    'g.libre.texte': 'Dernière vérification {quand}, sur la carte {carte}. Odin repose la question chaque minute ; s\'il voit un autre serveur d\'adresses, il s\'arrête et te prévient. Il ne recommence jamais tout seul.',
    'g.libre.sans': 'Odin repose la question chaque minute ; s\'il voit un autre serveur d\'adresses, il s\'arrête et te prévient. Il ne recommence jamais tout seul.',
    'g.ancienne': 'La dernière vérification date de {quand} : la surveillance de Sphinx est peut-être en pause (Talos). Odin ne répond à aucune demande d\'adresse sans avoir revérifié : il le refait dès qu\'une machine demande.',
    'g.doute.titre': 'Odin distribue, mais se tait le temps de vérifier',
    'g.doute': 'Odin n\'a pas pu vérifier qu\'aucun autre serveur d\'adresses ne répond ({n} fois sur {max}). En attendant, il ne répond à aucune demande d\'adresse : les machines gardent la leur. Il réessaie chaque minute ; à la troisième fois de suite, il s\'arrête.',
    'g.essai': 'Serveur d\'essai : allumé sans vérification.',
    'g.reverifier': 'Revérifier maintenant',
    'g.coupe.titre': 'Odin ne distribue plus les adresses',
    'g.attente.titre': 'Odin ne distribue pas encore les adresses',
    'g.attente.texte': 'Depuis son démarrage, Odin n\'a pas encore pu vérifier qu\'aucun autre serveur d\'adresses ne répond. Il réessaie chaque minute, dix minutes au plus, puis s\'arrête.',
    'g.coupe.apres': 'Rien ne repart sans toi : les machines gardent leur adresse jusqu\'à la fin de leur bail (voir plus bas).',
    'g.rallumer': 'Revérifier et rallumer', 'g.laisser': 'Laisser la box distribuer',
    'g.refus.titre': 'Refusé',
    'g.refus.reverif': 'J\'ai coupé celui de la box : revérifier',
    'g.carte': 'Carte réseau d\'Odin',
    'q.allumer': 'Odin distribue les adresses de la maison ?', 'q.allumer.avant': 'Avant d\'allumer', 'q.allumer.ok': 'Vérifier, puis allumer',
    'q.arreter': 'Laisser la box distribuer les adresses ?',
    'q.arreter.texte': 'Odin arrête de donner les adresses. Rallume d\'abord le serveur d\'adresses (DHCP) de la box : sinon plus personne ne distribue.',
    'q.arreter.ensuite': 'Ce qui se passe ensuite', 'q.arreter.ok': 'Odin arrête, la box distribue',
    'q.liste': 'Seulement les machines approuvées ?',
    'q.liste.texte': 'Une machine inconnue attendra ton accord, sans adresse. Plus sûr, mais un invité devra attendre que tu l\'approuves.',
    'q.liste.pre': 'Approuvées d\'abord, parce qu\'elles ont une adresse en ce moment (sinon elles perdraient le réseau à la fin de leur bail)',
    'q.liste.aucune': 'Aucune machine approuvée d\'avance : celles qui ont une adresse en ce moment sont déjà approuvées, ont une adresse fixe, ou sont trop nouvelles.',
    'q.liste.restent': 'Rien ne change pour elles', 'q.liste.bloque': 'bloquée', 'q.liste.pause': 'en pause', 'q.liste.nouveau': 'nouvelle',
    'q.liste.inconnues': 'Si tu ne reconnais pas une machine « nouvelle », bloque-la dans « Appareils ».',
    'q.liste.avoir': 'PAS approuvées : Odin ne les connaît que depuis moins d\'un jour',
    'q.liste.avoir.texte': 'Elles gardent leur adresse jusqu\'à la fin de leur bail, puis attendent ton accord. Dans « Appareils » : « Je le connais » si tu les reconnais, sinon bloque-les.',
    'q.liste.avoir.fin': 'jusqu\'à {fin}',
    'q.liste.avoir.tenue': 'Odin ne sait pas quelle machine tu tiens en ce moment : si elle est dans cette liste, approuve-la d\'abord dans « Appareils ».',
    'q.liste.ok': 'Seulement les machines approuvées',
    'q.reglages': 'Enregistrer ces réglages ?', 'q.reglages.ok': 'Enregistrer quand même',
    'q.annuler': 'Annuler', 'q.demande': 'Odin vérifie…',
    'f.titre': 'Si Odin s\'éteint',
    'f.lead.odin': 'Odin distribue les adresses : voilà ce qui se passe pour la maison s\'il s\'arrête (panne, mise à jour, coupure du garde-fou).',
    'f.lead.box': 'Si tu choisis « Odin distribue les adresses » : voilà ce qui se passera pour la maison quand Odin s\'arrêtera (panne, mise à jour, coupure du garde-fou).',
    'f.conseils': 'Conseils',
    'r.titre': 'Les adresses données', 'r.lead': 'Ce que chaque machine reçoit avec son adresse.',
    'r.box': 'La box distribue les adresses : ces réglages sont gardés, et servent dès qu\'Odin les distribue.',
    'r.debut': 'Première adresse', 'r.fin': 'Dernière adresse', 'r.passerelle': 'Passerelle (vers Internet)', 'r.masque': 'Masque',
    'r.dns': 'DNS donné', 'r.dns.odin': 'Odin ({ip})', 'r.heures': 'Durée du bail', 'r.domaine': 'Nom de la maison', 'r.carte': 'Carte réseau',
    'r.carte.une': '{nom} · {ip}/{prefixe}', 'r.carte.aucune': 'introuvable',
    'r.secours': 'DNS de secours : la box', 'r.secours.texte': 'Si Odin ne répond plus, les machines demandent à la box. Mais alors les pubs ne sont plus bloquées.',
    'r.ok': 'Enregistrer', 'r.demande': 'Odin enregistre…', 'r.defaire': 'Annuler mes changements',
    'r.verifie': 'Odin vérifie…', 'r.intact': 'Change un réglage : Odin le vérifie avant de l\'enregistrer.',
    'r.proprio': 'Changer ces réglages : le propriétaire seul.',
    'l.titre': 'Qui reçoit une adresse ?', 'l.groupe': 'Qui reçoit une adresse', 'l.ouvert': 'Toutes les machines', 'l.liste': 'Seulement les machines approuvées',
    'l.ouvert.texte': 'Une machine inconnue reçoit une adresse et t\'est signalée tout de suite (« Nouveaux »). Tu peux la bloquer en un geste.',
    'l.liste.texte': 'Une machine inconnue attend ton accord, sans adresse. Plus sûr, mais un invité devra attendre que tu l\'approuves.',
    'l.attente.une': 'Une machine attend ton accord.', 'l.attente.n': '{n} machines attendent ton accord.', 'l.voir': 'Voir les appareils',
    'l.box': 'La box distribue les adresses : ce choix est gardé, et appliqué dès qu\'Odin les distribue.',
    'e.silence': 'Odin ne répond pas.', 'e.lecture': 'Odin n\'a pas pu lire les réglages du DHCP.',
  };
  const mot = (k, v = {}) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? ''));
  const CHAMPS = ['debut', 'fin', 'passerelle', 'masque', 'dns', 'heures', 'domaine'];

  const CSS = `
.sr-choix{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.sr-c{position:relative;text-align:left;min-height:44px;padding:14px 44px 14px 14px;border-radius:14px;border:2px solid var(--line);background:var(--panel);color:var(--ink);font:14px inherit;cursor:pointer;min-width:0}
.sr-c b{display:block;font-size:15.5px;overflow-wrap:anywhere}
.sr-c p{margin:4px 0 6px;color:var(--muted);font-size:13px;line-height:1.45}
.sr-c ul{margin:0;padding-left:18px;font-size:13px;line-height:1.5;color:var(--muted)}
.sr-c[aria-checked="true"]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 9%,var(--panel))}
.sr-c:disabled{opacity:.6;cursor:not-allowed}
.sr-tick{position:absolute;top:12px;right:12px;width:24px;height:24px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;color:var(--on-accent,var(--bg,#fff))}
.sr-c[aria-checked="true"] .sr-tick{background:var(--accent);border-color:var(--accent)}
.sr-conseil{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent);margin-bottom:6px}
.sr-vu{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.sr-garde ol,.sr-garde ul{margin:6px 0 0;padding-left:20px}
.sr-garde li{padding:2px 0}
.sr-pont{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
.sr-pont>div{flex:1 1 260px;min-width:0}
.sr-pont .sa-btn{flex:none;text-decoration:none}
.sr-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.sr-champ{display:flex;flex-direction:column;gap:4px;min-width:0}
.sr-champ label,.sr-champ .sr-lab{font-size:12.5px;color:var(--muted);font-weight:600}
.sr-champ :is(input,select){min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel2,var(--panel));color:var(--ink);padding:0 12px;font:14px inherit;min-width:0;width:100%}
.sr-champ input[aria-invalid="true"]{border-color:var(--bad);border-width:2px}
.sr-champ .sr-fixe{min-height:44px;display:flex;align-items:center;font-weight:600;overflow-wrap:anywhere}
.sr-opt{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-top:12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px}
.sr-opt .sr-tx{min-width:0;flex:1}
.sr-opt b{display:block;font-size:14px}
.sr-opt small{display:block;color:var(--muted);font-size:12.5px;line-height:1.45}
.sr-sw{flex:none;width:60px;height:44px;border:0;background:none;padding:0;cursor:pointer;display:grid;place-items:center}
.sr-sw i{display:block;width:52px;height:30px;border-radius:999px;background:color-mix(in srgb,var(--muted) 40%,transparent);position:relative}
.sr-sw i::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:var(--bg,#fff);box-shadow:0 1px 3px rgba(0,0,0,.35)}
.sr-sw[aria-checked="true"] i{background:var(--accent)}
.sr-sw[aria-checked="true"] i::after{left:25px}
.sr-sw:disabled{opacity:.5;cursor:not-allowed}
.sr-v{display:flex;gap:8px;align-items:flex-start;margin:12px 0 0;font-size:13.5px;font-weight:600;line-height:1.45;overflow-wrap:anywhere}
.sr-v svg{flex:none;margin-top:1px}
.sr-v.ok{color:var(--good)}.sr-v.bad{color:var(--bad)}.sr-v.off{color:var(--muted);font-weight:500}
.sr-avis{margin:6px 0 0;padding-left:18px;font-size:13px;color:var(--muted);line-height:1.5;overflow-wrap:anywhere}
.sr-lignes{margin:0;padding-left:18px;font-size:13.5px;line-height:1.55;overflow-wrap:anywhere}
.sr-lignes li{padding:3px 0}
.sr-h3{margin:12px 0 4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.sr-seg{display:flex;gap:8px;flex-wrap:wrap}
@media (max-width:720px){.sr-choix{grid-template-columns:minmax(0,1fr)}.sr-pont .sa-btn{flex:1 1 100%;justify-content:center}}
@media (prefers-reduced-motion:no-preference){.sr-sw i::after{transition:left .12s ease}.sr-c{transition:border-color .12s ease,background .12s ease}}
`;
  function style() { if (!document.getElementById('sr-css')) document.head.append(el('style', { id: 'sr-css' }, CSS)); }

  /** Ce qu'une réponse refusée ou muette donne à lire. */
  const texteDe = (r) => String((r && (r.text ?? r.error)) ?? mot('e.silence'));
  const reussi = (r) => Boolean(r) && r.ok !== false && !r.error && !r.confirm;
  /** Les réglages du serveur, comme le formulaire les tient (du texte partout, sauf l'interrupteur). Pur. */
  function duServeur(g) {
    const r = g || {};
    return { debut: String(r.debut ?? ''), fin: String(r.fin ?? ''), passerelle: String(r.passerelle ?? ''), masque: String(r.masque ?? ''), dns: String(r.dns ?? ''), secours: r.secours === true, heures: String(r.heures ?? ''), domaine: String(r.domaine ?? '') };
  }
  /** Ce que le formulaire envoie au serveur. Pur. */
  const entreeDe = (f) => ({ debut: f.debut.trim(), fin: f.fin.trim(), passerelle: f.passerelle.trim(), masque: f.masque.trim(), dns: f.dns.trim(), secours: f.secours === true, heures: Number(String(f.heures).replace(',', '.')), domaine: f.domaine.trim() });
  const cleDe = (f) => JSON.stringify(entreeDe(f));
  /** Un refus du serveur, coupé en titre (« Refusé : … ») et suite. Pur. */
  function refusEnDeux(t) {
    const m = /^(Refusé : [^.]*\.)\s*([\s\S]*)$/.exec(String(t ?? ''));
    return m ? { titre: m[1].replace(/\.$/, ''), suite: m[2] } : { titre: mot('g.refus.titre'), suite: String(t ?? '') };
  }

  // ---------------------------------------------------------------- l'écran
  /** Monte l'écran dans `racine`. Rend { relire, etat }. */
  function ecran(racine) {
    style();
    // q : la question ouverte (« allumer », « arreter », « liste », « reglages ») ; voulu : « odin » choisi mais pas encore
    // accordé par le serveur ; refus : le dernier refus d'allumer (la raison du serveur) et gestes : ce qu'il dit de faire ; F : le formulaire quand il a été touché ; verdict + cle :
    // la dernière vérification et ce qu'elle a vérifié ; confirme : la question que le serveur pose pour ces réglages.
    const S = { D: null, q: '', voulu: '', refus: '', gestes: [], F: null, verdict: null, cle: '', confirme: '', occupe: false, res: null };
    const zNote = el('div', {}), zPont = el('div', {}), zQui = el('div', {}), zFilet = el('div', {}), zRegl = el('div', {}), zListe = el('div', {});
    racine.append(zNote, zPont, zQui, zFilet, zRegl, zListe);
    const viser = (cle) => { for (const n of racine.querySelectorAll('[data-f]')) if (n.getAttribute('data-f') === cle) { n.focus(); return true; } return false; };
    const proprio = () => S.D?.proprietaire === true;
    const valeurs = () => S.F ?? duServeur(S.D?.reglages);
    const touche = () => Boolean(S.F) && cleDe(S.F) !== cleDe(duServeur(S.D?.reglages));
    const resultat = (zone) => (S.res && S.res.zone === zone && S.res.text ? el('p', { class: `sa-res${S.res.ok ? '' : ' non'}`, role: 'status' }, S.res.text) : null);
    const dire = (zone, r) => { S.res = { zone, ok: reussi(r), text: texteDe(r) }; };

    /** Une question dans la page : ce qui va se passer, puis « oui » ou « annuler » (Échap annule). */
    function question(o) {
      return el('div', { class: `sa-garde sr-garde${o.calme ? ' calme' : ''}`, role: 'alert', 'aria-live': 'assertive', onkeydown: (ev) => { if (ev.key === 'Escape' && !S.occupe) { ev.preventDefault?.(); o.annuler(); } } },
        el('b', { class: 'sa-gt' }, o.titre), o.corps,
        el('div', { class: 'sa-acts' },
          el('button', { type: 'button', class: `sa-btn ${o.classe || 'pri'}`, disabled: S.occupe, 'data-f': 'q-ok', onclick: o.faire }, ic(o.icone || 'check', 18), S.occupe ? mot('q.demande') : o.ok),
          el('button', { type: 'button', class: 'sa-btn ghost', disabled: S.occupe, 'data-f': 'q-non', onclick: o.annuler }, mot('q.annuler'))));
    }
    const liste = (lignes, cls = 'sr-lignes') => el('ul', { class: cls }, (lignes ?? []).map((l) => el('li', {}, l)));

    function notes() {
      const D = S.D;
      if (D && !proprio()) return void zNote.replaceChildren(el('div', { class: 'sa-note', role: 'note' }, ic('shield'), el('div', {}, el('b', {}, mot('membre.titre')), el('p', {}, D.limite || mot('r.proprio')), el('p', {}, mot(D.distribue ? 'membre.odin' : 'membre.box')))));
      zNote.replaceChildren();
    }
    function pont() {
      const D = S.D;
      if (!D || !proprio()) return void zPont.replaceChildren();
      zPont.replaceChildren(el('section', { class: 'sa-card sr-pont' },
        el('span', { class: 'sa-lg', 'aria-hidden': 'true' }, ic('pc', 22)),
        el('div', {}, el('h2', {}, mot('pont.titre')), el('p', { class: 'sa-lead' }, mot('pont.texte')), D.genese && D.genese.texte ? el('p', { class: `sa-avis${D.genese.memeCarte ? ' warn' : ''}`, style: 'margin-top:0' }, D.genese.memeCarte ? ic('warn', 18) : null, el('span', {}, D.genese.texte)) : null),
        el('a', { class: 'sa-btn', href: '#app=thjalfi', 'data-f': 'pont' }, ic('pc', 18), mot('pont.lien'), ic('sortie', 16))));
    }

    // -------------------------------------------------------------- qui distribue, et le garde-fou
    async function allumer() {
      if (S.occupe) return; S.occupe = true; S.res = null; qui(); viser('q-ok') || viser('g-reverif') || viser('g-rallumer');
      const r = await demander('dhcp_demarrer', {}, true);
      S.occupe = false; S.q = '';
      if (reussi(r)) { S.voulu = ''; S.refus = ''; dire('qui', r); await relire(); viser('m-odin'); return; }
      S.voulu = 'odin'; S.refus = String((r && r.data && r.data.raison) || texteDe(r)); S.gestes = r && r.data && Array.isArray(r.data.gestes) ? r.data.gestes.map(String) : []; await relire(); viser('g-reverif') || viser('g-rallumer') || viser('m-odin');
    }
    async function arreter() {
      if (S.occupe) return; S.occupe = true; S.res = null; qui(); viser('q-ok');
      const r = await demander('dhcp_arreter', {}, true);
      S.occupe = false; S.q = ''; if (reussi(r)) { S.voulu = ''; S.refus = ''; }
      dire('qui', r); await relire(); viser('m-box');
    }
    async function reverifier() {
      if (S.occupe) return; S.occupe = true; S.res = null; qui(); viser('g-verif');
      const r = await demander('dhcp_chercher', {});
      S.occupe = false; dire('qui', r); await relire(); viser('g-verif') || viser('g-rallumer') || viser('m-odin');
    }
    function choisir(id) {
      const D = S.D; if (!D || S.occupe) return;
      S.res = null;
      if (id === 'odin') {
        if (D.mode === 'odin' && D.distribue) { S.q = ''; S.voulu = ''; S.refus = ''; }
        else { S.voulu = 'odin'; S.refus = ''; S.q = 'allumer'; }
        qui(); viser('q-non') || viser('m-odin'); return;
      }
      if (D.mode === 'odin') { S.q = 'arreter'; qui(); viser('q-non'); return; }
      S.voulu = ''; S.refus = ''; S.q = ''; qui(); viser('m-box');
    }
    function garde() {
      const D = S.D, g = D.garde || {}, carte = D.carte ? D.carte.nom : (g.carte || '');
      if (S.q === 'allumer') return question({ titre: mot('q.allumer'), ok: mot('q.allumer.ok'), icone: 'shield', faire: allumer,
        annuler: () => { S.q = ''; if (D.mode !== 'odin') S.voulu = ''; qui(); viser(D.mode === 'odin' ? 'g-rallumer' : 'm-odin') || viser('m-odin'); },
        corps: [el('h4', {}, mot('q.allumer.avant')), liste(D.allumer, ''), el('h4', {}, mot('f.titre')), liste((D.filet?.lignes ?? []).slice(0, 3), '')] });
      if (S.q === 'arreter') return question({ titre: mot('q.arreter'), ok: mot('q.arreter.ok'), classe: 'dng', icone: 'box', faire: arreter,
        annuler: () => { S.q = ''; qui(); viser('g-laisser') || viser('m-box'); },
        corps: [el('p', {}, mot('q.arreter.texte')), D.distribue ? [el('h4', {}, mot('q.arreter.ensuite')), liste((D.filet?.lignes ?? []).slice(0, 3), '')] : null] });
      // Le serveur vient de refuser d'allumer : sa réponse, mot pour mot, et les deux gestes.
      if (S.refus) {
        const r = refusEnDeux(S.refus);
        return el('div', { class: 'sa-garde sr-garde', role: 'alert' }, el('b', { class: 'sa-gt' }, r.titre), r.suite ? el('p', {}, r.suite) : null,
          S.gestes.length ? el('ol', {}, S.gestes.map((x) => el('li', {}, x))) : null,
          el('div', { class: 'sa-acts' },
            el('button', { type: 'button', class: 'sa-btn pri', disabled: S.occupe, 'data-f': 'g-reverif', onclick: allumer }, ic('reverif', 18), S.occupe ? mot('q.demande') : mot('g.refus.reverif')),
            el('button', { type: 'button', class: 'sa-btn', disabled: S.occupe, 'data-f': 'g-laisser', onclick: () => choisir('box') }, ic('box', 18), mot('g.laisser'))));
      }
      if (D.mode !== 'odin') return el('div', { class: 'sa-garde calme sr-garde', role: 'note' }, el('b', { class: 'sa-gt' }, mot('g.box.titre')), el('p', {}, mot('g.box.texte')),
        D.carteRefus ? el('p', { class: 'sa-avis warn' }, ic('warn', 18), el('span', {}, D.carteRefus)) : null);
      if (D.distribue) return el('div', { class: 'sa-garde calme sr-garde', role: 'note' }, el('b', { class: 'sa-gt' }, mot(D.doute > 0 && !D.essai ? 'g.doute.titre' : 'g.libre.titre')),
        D.essai ? el('p', { class: 'sa-avis warn' }, ic('warn', 18), el('span', {}, mot('g.essai')))
          : el('p', {}, g.verifie ? mot('g.libre.texte', { quand: SX.quand(g.verifie), carte }) : mot('g.libre.sans')),
        D.doute > 0 ? el('p', { class: 'sa-avis warn', role: 'status' }, ic('warn', 18), el('span', {}, mot('g.doute', { n: D.doute, max: D.doutes || 3 })))
          : D.ancienne ? el('p', { class: 'sa-avis warn', role: 'status' }, ic('warn', 18), el('span', {}, mot('g.ancienne', { quand: SX.quand(g.verifie) }))) : null,
        D.essai ? null : el('div', { class: 'sa-acts' }, el('button', { type: 'button', class: 'sa-btn', disabled: S.occupe, 'data-f': 'g-verif', onclick: reverifier }, ic('reverif', 18), S.occupe ? mot('q.demande') : mot('g.reverifier'))));
      // « Odin distribue » est choisi, mais il ne distribue pas : arrêté par le garde-fou (ou pas encore vérifié depuis son démarrage).
      const coupe = g.etat === 'coupe' || Boolean(g.raison);
      return el('div', { class: 'sa-garde sr-garde', role: 'alert' }, el('b', { class: 'sa-gt' }, mot(coupe ? 'g.coupe.titre' : 'g.attente.titre')),
        el('p', {}, g.raison || mot('g.attente.texte')), el('p', {}, mot('g.coupe.apres')),
        el('div', { class: 'sa-acts' },
          el('button', { type: 'button', class: 'sa-btn pri', disabled: S.occupe, 'data-f': 'g-rallumer', onclick: () => choisir('odin') }, ic('reverif', 18), mot('g.rallumer')),
          el('button', { type: 'button', class: 'sa-btn', disabled: S.occupe, 'data-f': 'g-laisser', onclick: () => choisir('box') }, ic('box', 18), mot('g.laisser'))));
    }
    function qui() {
      const D = S.D;
      if (!D || !proprio()) return void zQui.replaceChildren();
      const choisi = S.voulu || D.mode;
      const carte = (id, conseil) => {
        const on = choisi === id;
        return el('button', { type: 'button', class: 'sr-c', role: 'radio', 'aria-checked': String(on), tabindex: on ? '0' : '-1', disabled: S.occupe, 'data-f': `m-${id}`, onclick: () => choisir(id),
          onkeydown: (ev) => { if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(ev.key)) { ev.preventDefault?.(); viser(id === 'box' ? 'm-odin' : 'm-box'); } } },
          conseil ? el('span', { class: 'sr-conseil' }, conseil) : null,
          el('b', {}, mot(`qui.${id}`)), el('p', {}, mot(`qui.${id}.p`)), el('ul', {}, el('li', {}, mot(`qui.${id}.1`)), el('li', {}, mot(`qui.${id}.2`))),
          el('span', { class: 'sr-tick', 'aria-hidden': 'true' }, on ? ic('check', 14) : null), on ? el('span', { class: 'sr-vu' }, ` (${mot('qui.choisi')})`) : null);
      };
      zQui.replaceChildren(el('section', { class: 'sa-card' },
        el('h2', {}, mot('qui.titre')), el('p', { class: 'sa-lead' }, mot('qui.lead')),
        el('div', { class: 'sr-choix', role: 'radiogroup', 'aria-label': mot('qui.groupe') }, carte('box', ''), carte('odin', mot('qui.odin.conseil'))),
        garde(), resultat('qui')));
    }
    function filet() {
      const D = S.D, f = D?.filet;
      if (!D || !proprio() || !f) return void zFilet.replaceChildren();
      zFilet.replaceChildren(el('section', { class: 'sa-card' },
        el('h2', {}, mot('f.titre')), el('p', { class: 'sa-lead' }, mot(D.mode === 'odin' ? 'f.lead.odin' : 'f.lead.box')),
        liste(f.lignes), f.conseils && f.conseils.length ? [el('h3', { class: 'sr-h3' }, mot('f.conseils')), liste(f.conseils)] : null));
    }

    // -------------------------------------------------------------- les adresses données
    let zV = el('div', {}), bOk = null, bNon = null, champs = {};
    function verdict() {
      const v = S.verdict, f = valeurs(), frais = Boolean(v) && S.cle === cleDe(f), pret = Boolean(frais && v.ok && !v.pareil && !S.occupe && touche());
      if (bOk) { if (pret) bOk.removeAttribute('disabled'); else bOk.setAttribute('disabled', ''); }
      if (bNon) { if (touche() && !S.occupe) bNon.removeAttribute('disabled'); else bNon.setAttribute('disabled', ''); }
      for (const k of CHAMPS) { const n = champs[k]; if (!n) continue; if (frais && !v.ok && v.champ === k) { n.setAttribute('aria-invalid', 'true'); n.setAttribute('aria-describedby', 'sr-verdict'); } else { n.removeAttribute('aria-invalid'); n.removeAttribute('aria-describedby'); } }
      if (!touche()) return void zV.replaceChildren(el('p', { class: 'sr-v off' }, mot('r.intact')));
      if (!frais) return void zV.replaceChildren(el('p', { class: 'sr-v off' }, mot('r.verifie')));
      zV.replaceChildren(...[el('p', { class: `sr-v ${v.ok ? 'ok' : 'bad'}` }, ic(v.ok ? 'check' : 'warn', 18), el('span', {}, v.message)),
        v.avis && v.avis.length ? liste(v.avis, 'sr-avis') : null].filter(Boolean));
    }
    let enVerif = false, aRefaire = false;
    /** Odin vérifie ce qui est tapé (une lecture : rien n'est écrit, rien n'est envoyé sur le réseau). Jamais deux à la fois. */
    async function verifier() {
      if (!touche()) { S.verdict = null; S.cle = ''; return void verdict(); }
      if (enVerif) { aRefaire = true; return; }
      const f = { ...valeurs() }, cle = cleDe(f);
      enVerif = true; verdict();
      try {
        const r = await demander('dhcp_etat', entreeDe(f)), v = r && r.data ? r.data.verdict : null;
        if (S.F && cleDe(S.F) === cle) { S.verdict = v && typeof v.message === 'string' ? v : { ok: false, champ: '', message: texteDe(r), avis: [], pareil: false }; S.cle = cle; }
      } finally { enVerif = false; }
      verdict();
      if (aRefaire) { aRefaire = false; await verifier(); }
    }
    async function enregistrer(confirme) {
      const v = S.verdict; if (S.occupe || !S.F || !v || !v.ok || S.cle !== cleDe(S.F)) return;
      S.occupe = true; S.res = null; formulaire(); viser(confirme ? 'q-ok' : 'r-ok');
      const r = await demander('dhcp_reglages', entreeDe(S.F), confirme === true);
      S.occupe = false;
      // Le serveur demande ton accord (la passerelle, le masque ou le DNS changent pendant qu'Odin distribue) : la question, dans la page.
      if (r && r.confirm && !confirme) { S.q = 'reglages'; S.confirme = `${String(r.confirm).replace(/^Confirmer : /, '').replace(/\s*\?\s*$/, '').replace(/^./, (c) => c.toUpperCase())}.`; formulaire(); viser('q-non'); return; }
      S.q = ''; S.confirme = ''; dire('regl', r);
      if (reussi(r)) { S.F = null; S.verdict = null; S.cle = ''; await relire(); viser('debut'); return; }
      S.verdict = null; S.cle = ''; formulaire(); viser('debut'); await verifier();
    }
    function formulaire() {
      const D = S.D;
      if (!D || !proprio()) { bOk = null; bNon = null; champs = {}; return void zRegl.replaceChildren(); }
      const f = valeurs(), g = D.reglages || {};
      const poser = (k, v) => { S.F = { ...valeurs(), [k]: v }; S.res = null; if (!touche()) S.F = null; verdict(); void verifier(); };
      const champ = (k, plus = {}) => {
        const n = el('input', { id: `sr-${k}`, type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-f': k, value: f[k], oninput: (e) => poser(k, String(e.target.value)), onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault?.(); void enregistrer(false); } }, ...plus });
        n.value = f[k]; champs[k] = n;
        return el('div', { class: 'sr-champ' }, el('label', { for: `sr-${k}` }, mot(`r.${k}`)), n);
      };
      champs = {};
      const adresse = { inputmode: 'decimal', maxlength: 15, class: 'sa-mono' };
      const heures = [...(D.heuresProposees ?? [])]; if (f.heures && !heures.some((h) => String(h.heures) === String(f.heures))) heures.push({ heures: f.heures, mots: `${f.heures} h` });
      const sel = el('select', { id: 'sr-heures', 'data-f': 'heures', onchange: (e) => poser('heures', String(e.target.value)) }, heures.map((h) => el('option', { value: String(h.heures), selected: String(h.heures) === String(f.heures) }, h.mots)));
      sel.value = String(f.heures); champs.heures = sel;
      const sw = el('button', { type: 'button', class: 'sr-sw', role: 'switch', 'aria-checked': String(f.secours === true), 'aria-labelledby': 'sr-l-sec', 'aria-describedby': 'sr-d-sec', 'data-f': 'secours', disabled: S.occupe, onclick: () => { poser('secours', !(valeurs().secours === true)); formulaire(); viser('secours'); } }, el('i', { 'aria-hidden': 'true' }));
      zV = el('div', { id: 'sr-verdict', role: 'status', 'aria-live': 'polite' });
      bOk = el('button', { type: 'button', class: 'sa-btn pri', 'data-f': 'r-ok', disabled: true, onclick: () => enregistrer(false) }, ic('check', 18), S.occupe && S.q !== 'reglages' ? mot('r.demande') : mot('r.ok'));
      bNon = el('button', { type: 'button', class: 'sa-btn ghost', 'data-f': 'r-non', disabled: true, onclick: () => { S.F = null; S.verdict = null; S.cle = ''; S.res = null; formulaire(); viser('debut'); } }, mot('r.defaire'));
      const v = S.verdict;
      zRegl.replaceChildren(el('section', { class: 'sa-card' },
        el('h2', {}, mot('r.titre')), el('p', { class: 'sa-lead' }, mot('r.lead'), D.mode !== 'odin' ? [' ', mot('r.box')] : null),
        el('div', { class: 'sr-form' },
          champ('debut', adresse), champ('fin', adresse), champ('passerelle', adresse), champ('masque', adresse),
          champ('dns', { class: 'sa-mono', maxlength: 60, placeholder: mot('r.dns.odin', { ip: g.odin ?? '' }) }),
          el('div', { class: 'sr-champ' }, el('label', { for: 'sr-heures' }, mot('r.heures')), sel),
          champ('domaine', { class: 'sa-mono', maxlength: 63 }),
          el('div', { class: 'sr-champ' }, el('span', { class: 'sr-lab' }, mot('r.carte')), el('span', { class: 'sr-fixe sa-mono' }, D.carte ? mot('r.carte.une', D.carte) : mot('r.carte.aucune')))),
        el('div', { class: 'sr-opt' }, el('span', { class: 'sr-tx' }, el('b', { id: 'sr-l-sec' }, mot('r.secours')), el('small', { id: 'sr-d-sec' }, mot('r.secours.texte'))), sw),
        zV,
        S.q === 'reglages' ? question({ titre: mot('q.reglages'), ok: mot('q.reglages.ok'), classe: 'dng', icone: 'warn', faire: () => enregistrer(true), annuler: () => { S.q = ''; S.confirme = ''; formulaire(); viser('r-ok') || viser('passerelle'); },
          corps: [el('p', {}, S.confirme), v && v.avis && v.avis.length ? liste(v.avis, '') : null] })
          : el('div', { class: 'sa-acts' }, bOk, bNon),
        resultat('regl')));
      verdict();
    }

    // -------------------------------------------------------------- qui reçoit une adresse
    async function mode(m, confirme) {
      if (S.occupe) return; S.occupe = true; S.res = null; listes(); viser(confirme ? 'q-ok' : `l-${m}`);
      const r = await demander('dhcp_mode', { mode: m }, confirme === true);
      S.occupe = false; S.q = ''; dire('liste', r); await relire(); viser(`l-${m}`);
    }
    function listes() {
      const D = S.D, L = D?.liste;
      if (!D || !proprio() || !L) return void zListe.replaceChildren();
      const bouton = (k) => el('button', { type: 'button', class: 'sa-chip', 'aria-pressed': String(L.mode === k), disabled: S.occupe, 'data-f': `l-${k}`,
        onclick: () => { if (L.mode === k || S.occupe) return; S.res = null; if (k === 'liste') { S.q = 'liste'; listes(); viser('q-non'); } else void mode('ouvert', false); } }, L.mode === k ? ic('check', 16) : null, mot(`l.${k}`));
      const une = (a) => el('li', {}, el('b', {}, a.nom), a.ip ? [' · ', el('span', { class: 'sa-mono' }, a.ip)] : null, ' · ', el('span', { class: 'sa-mono' }, a.mac), a.nouveau || a.fin ? [' ', el('span', { class: 'sa-tag warn' }, mot('q.liste.nouveau'))] : null, a.fin ? [' ', mot('q.liste.avoir.fin', { fin: a.fin })] : null, a.etat ? [' ', el('span', { class: 'sa-tag warn' }, mot(a.etat === 'bloque' ? 'q.liste.bloque' : 'q.liste.pause'))] : null);
      const aVoir = Array.isArray(L.aVoir) ? L.aVoir : [];
      const q = S.q === 'liste' ? question({ titre: mot('q.liste'), ok: mot('q.liste.ok'), icone: 'shield', faire: () => mode('liste', true), annuler: () => { S.q = ''; listes(); viser('l-liste'); },
        corps: [el('p', {}, mot('q.liste.texte')),
          L.aApprouver.length ? [el('h4', {}, mot('q.liste.pre')), el('ul', {}, L.aApprouver.map(une)), L.aApprouver.some((a) => a.nouveau) ? el('p', {}, mot('q.liste.inconnues')) : null] : el('p', {}, mot('q.liste.aucune')),
          aVoir.length ? [el('h4', {}, mot('q.liste.avoir')), el('ul', {}, aVoir.map(une)), el('p', {}, mot('q.liste.avoir.texte')), L.origineConnue === false ? el('p', { class: 'sa-avis warn' }, ic('warn', 18), el('span', {}, mot('q.liste.avoir.tenue'))) : null] : null,
          L.restent.length ? [el('h4', {}, mot('q.liste.restent')), el('ul', {}, L.restent.map(une))] : null] }) : null;
      zListe.replaceChildren(el('section', { class: 'sa-card' },
        el('h2', {}, mot('l.titre')),
        el('div', { class: 'sr-seg', role: 'group', 'aria-label': mot('l.groupe'), style: 'margin-top:10px' }, bouton('ouvert'), bouton('liste')),
        el('p', { class: 'sa-lead', style: 'margin-bottom:0' }, mot(L.mode === 'liste' ? 'l.liste.texte' : 'l.ouvert.texte'), D.mode !== 'odin' ? [' ', mot('l.box')] : null),
        L.mode === 'liste' && L.attente > 0 ? el('div', { class: 'sa-acts' }, el('p', { class: 'sa-avis warn', style: 'margin:0;flex:1 1 200px;align-items:center' }, ic('warn', 18), el('span', {}, L.attente === 1 ? mot('l.attente.une') : mot('l.attente.n', { n: L.attente }))),
          el('button', { type: 'button', class: 'sa-btn', 'data-f': 'l-voir', onclick: () => SX.aller('appareils') }, mot('l.voir'))) : null,
        q, resultat('liste')));
    }

    let enVol = false;
    async function relire(o = {}) {
      // En direct : pas pendant une question ouverte ni pendant un geste ; jamais deux relectures en même temps.
      const fige = () => Boolean(S.q || S.occupe);
      if (o.discret && (fige() || enVol)) return;
      let r; if (o.discret) enVol = true;
      try { r = await demander('dhcp_etat'); } finally { if (o.discret) enVol = false; }
      if (o.discret && fige()) return;
      if (r && r.data && typeof r.data.mode === 'string') S.D = r.data;
      else if (!S.D) S.D = { proprietaire: false, limite: String((r && (r.text ?? r.error)) ?? mot('e.lecture')), mode: 'box', distribue: false };
      // Ce que tu voulais est arrivé (ou n'a plus lieu d'être) : la page suit le serveur.
      if (S.D.mode === 'odin' && S.D.distribue) { S.voulu = ''; S.refus = ''; }
      const cle = document.activeElement?.getAttribute?.('data-f');
      notes(); pont(); qui(); filet(); listes();
      // Pendant que tu tapes, le formulaire ne bouge pas sous tes doigts. Le reste de la page vient d'être redessiné : si le
      // bouton que tu tenais au clavier était là, tu le retrouves (le formulaire, lui, n'a pas bougé).
      if (o.discret && (CHAMPS.includes(cle) || cle === 'secours' || touche())) { if (cle && !CHAMPS.includes(cle) && !['secours', 'r-ok', 'r-non'].includes(cle)) viser(cle); return; }
      formulaire(); if (cle) viser(cle);
    }
    return { relire, etat: S };
  }

  SX.ajouter({ id: 'dhcp', titre: () => mot('onglet'), dessiner: (n) => { const e = ecran(n); return { relire: e.relire, pret: e.relire(), etat: e.etat }; } });
  SX.reglages = { MOTS, duServeur, entreeDe, refusEnDeux };
})();
