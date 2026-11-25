// Sphinx · « Noms (DNS) » (maquette « Réseau » validée, écran « DNS · Noms ») : « l'interface DNS pour voir les DNS, les
// IP, les noms des machines ».
//   - « Les machines » : chaque nom ↔ son adresse ; d'où vient le nom (DHCP automatique, adresse fixe, à la main, Odin) ;
//     la dernière fois qu'un appareil l'a demandé ; recherche ;
//   - « Enregistrements » : les sortes d'enregistrements dites en mots (nom → adresse, adresse longue, alias, joker,
//     inverse, texte), les noms ajoutés à la main (changer, retirer ; celui d'Odin est verrouillé), et « Ajouter un nom »,
//     vérifié par Odin pendant la frappe (nom dans n'importe quelle langue, adresse valable, pas de doublon, pas de conflit
//     avec un nom automatique ni avec celui d'Odin).
// Tout ce qui est vrai vient du serveur (lecture « noms_vus », qui vérifie aussi un nom sans rien écrire) ; les gestes
// passent par « nom_local » et « retirer_nom » (propriétaire seul, mêmes règles côté serveur : la page ne décide de rien).
// Quand le serveur pose une question (changer, retirer, répondre à la place d'Internet), elle s'affiche DANS la page, avec
// ses mots à lui, et rien ne part sans « oui ». Un nom vient parfois du réseau (un appareil annonce le sien) : il est
// TOUJOURS posé comme du texte, jamais comme du HTML. Tous les textes de la page sont dans MOTS. L'écran s'ajoute à la
// page de Sphinx (sphinx-appareils.js), après les écrans du DHCP.
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;
  const SX = W.OdinSphinx;
  if (!SX || !SX.outils || typeof SX.ajouter !== 'function') return;
  const { el, ic, demander, traits } = SX.outils;
  if (!traits.crayon) traits.crayon = 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4';
  if (!traits.corbeille) traits.corbeille = 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6';
  traits.plus = 'M12 5v14M5 12h14';
  traits.etiquette = 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01';

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    onglet: 'Noms (DNS)', 'st.aria': 'Noms', 'st.machines': 'Les machines', 'st.enreg': 'Enregistrements',
    'membre.titre': 'Ce que tu vois',
    'dns.titre': 'Le DNS d\'Odin est éteint', 'dns.texte': 'Ces noms seront servis dès qu\'il répondra aux appareils de la maison.',
    'm.titre': 'Les noms des machines',
    'm.lead': 'Chaque machine se joint par son nom (par exemple « serveur.{d} ») au lieu de son adresse. Les noms automatiques viennent du DHCP : renomme l\'appareil dans « Appareils », son nom change ici.',
    'm.chercher': 'Chercher un nom', 'm.chercher.ex': 'Nom ou adresse…', 'm.ajouter': 'Ajouter un nom',
    'm.col.nom': 'Nom', 'm.col.ip': 'Adresse IP', 'm.col.origine': 'D\'où vient le nom', 'm.col.derniere': 'Dernière question', 'm.lq': 'Dernière question : ',
    'm.vide': 'Aucun nom ne correspond.', 'm.aucun': 'Aucun nom pour l\'instant : un appareil reçoit le sien dès qu\'il demande une adresse à Odin.',
    'o.main': 'à la main', 'o.dhcp': 'DHCP · automatique', 'o.fixe': 'DHCP · adresse fixe', 'o.odin': 'Odin',
    't.remplace': 'remplacé par un nom à la main', 't.verrou': 'verrouillé', 't.ascii': 'écrit pour le DNS : {a}', rien: '—',
    's.titre': 'Les sortes d\'enregistrements, en mots simples', 's.lead': 'Ce que le DNS d\'Odin sait répondre pour la maison.',
    's.a': 'Nom → adresse', 's.aaaa': 'Nom → adresse longue (IPv6)', 's.alias': 'Autre nom (alias)', 's.joker': 'Tous les noms d\'un groupe',
    's.inverse': 'Adresse → nom (inverse)', 's.texte': 'Texte', 's.autre': 'Autres (courrier, service…)',
    'c.a': 'A', 'c.aaaa': 'AAAA', 'c.alias': 'CNAME', 'c.joker': 'joker', 'c.inverse': 'PTR', 'c.texte': 'TXT', 'c.autre': 'MX, SRV…',
    'x.a': 'serveur.{d} → une adresse', 'x.aaaa': 'serveur.{d} → une adresse IPv6', 'x.alias': 'galerie.{d} → serveur.{d}', 'x.joker': '*.atelier.{d} → une adresse',
    'x.inverse': 'une adresse de la maison → son nom · automatique', 'x.texte': 'une note lue par une machine', 'x.autre': 'courrier, service, serveur de noms',
    'x.de': '{n} → {v}', 'x.inv': '{a} → {n} · automatique',
    'h.titre': 'Ajoutés à la main', 'h.vide': 'Aucun nom ajouté à la main.', 'h.modifier': 'Changer {nom}', 'h.retirer': 'Retirer {nom}',
    'h.proprio': 'Ajouter, changer et retirer un nom : le propriétaire seul.',
    'f.titre': 'Ajouter un nom', 'f.titre.modif': 'Changer « {nom} »', 'f.sorte': 'Sorte', 'f.nom': 'Nom', 'f.nom.ex': 'serveur.{d}', 'f.nom.joker': '*.atelier.{d}',
    'f.so.a': 'Nom → adresse', 'f.so.alias': 'Autre nom (alias)', 'f.so.joker': 'Tous les noms d\'un groupe', 'f.so.texte': 'Texte',
    'v.a': 'Adresse IP', 'v.alias': 'Le vrai nom', 'v.joker': 'Adresse IP', 'v.texte': 'Texte',
    'v.a.ex': 'adresse IPv4 ou IPv6', 'v.alias.ex': 'serveur.{d}', 'v.joker.ex': 'adresse IPv4 ou IPv6', 'v.texte.ex': 'une note',
    'f.note': 'Un nom en « .{d} » ne sort jamais de la maison. Un nom qui existe sur Internet n\'est remplacé que pour la maison, et Odin te le dit avant.',
    'f.ok': 'Ajouter', 'f.ok.modif': 'Enregistrer', 'f.annuler': 'Annuler', 'f.demande': 'Odin enregistre…',
    'f.attend': 'Écris un nom et sa valeur : Odin les vérifie avant de rien ajouter.', 'f.attend.modif': 'Écris la nouvelle valeur : Odin la vérifie avant de rien changer.', 'f.verifie': 'Odin vérifie…',
    'q.ok': 'Oui, le faire', 'q.ok.retirer': 'Retirer', 'q.non': 'Annuler', 'q.demande': 'Odin fait le changement…',
    'e.silence': 'Odin ne répond pas.', 'e.lecture': 'Odin n\'a pas pu lire les noms.',
  };
  const mot = (k, v = {}) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? ''));
  const SORTES = ['a', 'aaaa', 'alias', 'joker', 'inverse', 'texte', 'autre'];
  const SORTES_FORM = ['a', 'alias', 'joker', 'texte'];

  const CSS = `
.sn-st{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:0 0 12px;overflow-x:auto}
.sn-st button{min-height:44px;padding:0 14px;border:0;border-bottom:3px solid transparent;background:none;color:var(--muted);font:600 14px inherit;cursor:pointer;white-space:nowrap}
.sn-st button[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--accent)}
.sn-liste{list-style:none;margin:0;padding:0}
.sn-tete,.sn-ligne{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1.1fr) minmax(0,1.2fr) minmax(0,1fr);gap:4px 12px;align-items:center;padding:10px 6px;font-size:13.5px}
.sn-tete{font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding-top:4px;padding-bottom:6px}
.sn-ligne{border-top:1px solid var(--line)}
.sn-nm{min-width:0;overflow-wrap:anywhere}
.sn-nm b{font-weight:600;display:inline-flex;flex-wrap:wrap;gap:0 6px;align-items:center}
.sn-nm small,.sn-q{display:block;color:var(--muted);font-size:12px}
.sn-lq{display:none}
.sn-sortes{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.sn-sorte{border:1px solid var(--line);border-radius:14px;padding:12px;min-width:0}
.sn-sorte b{display:flex;gap:8px;align-items:flex-start;font-size:14px}
.sn-sorte b .sn-tt{flex:1 1 auto;min-width:0;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}
.sn-sorte b .sa-cnt{margin-left:auto;flex:none}
.sn-sorte p{margin:6px 0 0;color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}
.sn-mains{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.sn-main{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;border:1px solid var(--line);flex-wrap:wrap;min-width:0}
.sn-main .sn-nm{flex:1 1 160px}
.sn-main .sa-garde{flex:1 1 100%;margin:4px 0 0}
.sn-ibtn{min-width:44px;min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);display:inline-grid;place-items:center;cursor:pointer;flex:none;padding:0}
.sn-seg{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px}
.sn-seg button{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13.5px inherit;cursor:pointer}
.sn-seg button[aria-pressed="true"]{background:var(--ink);color:var(--bg,#fff);border-color:var(--ink)}
.sn-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.sn-champ{display:flex;flex-direction:column;gap:4px;min-width:0}
.sn-champ label,.sn-champ .sn-lab{font-size:12.5px;color:var(--muted);font-weight:600}
.sn-champ input{min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel2,var(--panel));color:var(--ink);padding:0 12px;font:14px inherit;min-width:0;width:100%}
.sn-champ .sn-fixe{min-height:44px;display:flex;align-items:center;font-weight:600;overflow-wrap:anywhere}
.sn-v p{display:flex;gap:8px;align-items:flex-start;margin:12px 0 0;font-size:13.5px;font-weight:600;line-height:1.45;overflow-wrap:anywhere}
.sn-v p svg{flex:none;margin-top:1px}
.sn-v p.ok{color:var(--good)}.sn-v p.warn{color:var(--warn)}.sn-v p.bad{color:var(--bad)}.sn-v p.off{color:var(--muted);font-weight:500}
.sn-v ul{margin:6px 0 0;padding-left:18px;font-size:13px;color:var(--muted);line-height:1.5}
.sn-note{margin:10px 0 0;font-size:12.5px;color:var(--muted);line-height:1.5}
@media (max-width:720px){
  .sn-tete{display:none}
  .sn-ligne{grid-template-columns:minmax(0,1fr) auto;row-gap:2px}
  .sn-ligne .sn-ip,.sn-ligne .sn-q{grid-column:1}
  .sn-ligne .sn-or{grid-column:2;grid-row:1}
  .sn-ligne .sn-q .sn-lq{display:inline}
  .sn-ligne .sn-q.vide{display:none}
}
`;
  function style() { if (!document.getElementById('sn-css')) document.head.append(el('style', { id: 'sn-css' }, CSS)); }

  /** Ce qu'une réponse refusée ou muette donne à lire. */
  const texteDe = (r) => String((r && (r.text ?? r.error)) ?? mot('e.silence'));
  /** La question posée par le serveur (« Confirmer : … ? ») en une phrase. Pur. */
  const questionDe = (c) => { const t = String(c).replace(/^Confirmer : /, '').replace(/\s*\?\s*$/, '').trim(); return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)} ?` : ''; };
  /** La couleur d'une vérification : refus, accepté avec un avertissement (un nom d'Internet), accepté. Pur. */
  const tonDe = (v) => (!v.ok ? 'bad' : v.horsMaison ? 'warn' : 'ok');
  /** Les lignes de « Les machines » : les noms qui donnent une adresse, filtrés par la recherche. Pur. */
  function machines(noms, q) {
    const t = String(q || '').trim().toLowerCase();
    return (noms || []).filter((x) => (x.sorte === 'a' || x.sorte === 'aaaa') && !x.ascii.startsWith('*.') && (!t || `${x.nom} ${x.ascii} ${x.valeur}`.toLowerCase().includes(t)));
  }
  /** La sorte du formulaire pour changer un nom qui existe. Pur. */
  const sorteForm = (s) => (s === 'aaaa' ? 'a' : SORTES_FORM.includes(s) ? s : '');

  // ---------------------------------------------------------------- l'écran
  /** Monte l'écran dans `racine`. Rend { relire, etat }. */
  function ecran(racine) {
    style();
    // st : le sous-onglet ; nq : la recherche ; sorte, nom, val : ce qui est tapé ; modif : le nom (ASCII) que l'on change ;
    // verdict + cle : la dernière vérification et ce qu'elle a vérifié ; q : la question ouverte (ajout ou retrait).
    const S = { D: null, st: 'machines', nq: '', sorte: 'a', nom: '', val: '', modif: '', verdict: null, cle: '', q: null, occupe: false, res: null };
    const zNote = el('div', {}), zSt = el('div', { class: 'sn-st', role: 'tablist', 'aria-label': mot('st.aria') }), zCorps = el('div', {});
    racine.append(zNote, zSt, zCorps);
    const viser = (cle) => { for (const n of racine.querySelectorAll('[data-f]')) if (n.getAttribute('data-f') === cle) { n.focus(); return true; } return false; };
    const proprio = () => S.D?.proprietaire === true;
    const dom = () => S.D?.domaine || 'maison';
    const noms = () => S.D?.noms ?? [];
    const cleDe = () => `${S.sorte}|${S.modif || S.nom.trim()}|${S.val.trim()}|${S.modif ? 1 : 0}`;
    const ligneDe = (ascii) => noms().find((x) => x.ascii === ascii && x.origine === 'main');

    function notes() {
      const D = S.D, n = [];
      if (D && D.limite) n.push(el('div', { class: 'sa-note', role: 'note' }, ic('shield'), el('div', {}, el('b', {}, mot('membre.titre')), el('p', {}, D.limite))));
      if (D && D.dns && D.dns.allume === false) n.push(el('div', { class: 'sa-note', role: 'note' }, ic('warn'), el('div', {}, el('b', {}, mot('dns.titre')), el('p', {}, mot('dns.texte')))));
      zNote.replaceChildren(...n);
    }
    function onglets() {
      const ids = ['machines', 'enreg'];
      zSt.replaceChildren(...ids.map((k) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(S.st === k), tabindex: S.st === k ? '0' : '-1', 'data-f': `st:${k}`,
        onclick: () => aller(k, `st:${k}`),
        onkeydown: (ev) => { const i = ids.indexOf(k), j = ev.key === 'ArrowRight' ? (i + 1) % ids.length : ev.key === 'ArrowLeft' ? (i + ids.length - 1) % ids.length : ev.key === 'Home' ? 0 : ev.key === 'End' ? ids.length - 1 : -1; if (j >= 0) { ev.preventDefault?.(); aller(ids[j], `st:${ids[j]}`); } } }, mot(`st.${k}`))));
    }
    function aller(k, cible) { S.st = k; S.q = null; onglets(); corps(); if (cible) viser(cible); }

    // ------------------------------------------------ « Les machines »
    function vueMachines() {
      const tous = machines(noms(), ''), P = proprio();
      const cherche = el('input', { type: 'search', placeholder: mot('m.chercher.ex'), 'aria-label': mot('m.chercher'), autocomplete: 'off', spellcheck: 'false', 'data-f': 'nq', value: S.nq, oninput: (e) => { S.nq = String(e.target.value); liste(); } });
      cherche.value = S.nq;
      const zL = el('div', {});
      const ligne = (x) => el('li', { class: 'sn-ligne' },
        el('span', { class: 'sn-nm' }, el('b', { class: 'sa-mono' }, x.nom, x.remplace ? el('span', { class: 'sa-tag warn' }, mot('t.remplace')) : null), x.nom !== x.ascii ? el('small', { class: 'sa-mono' }, mot('t.ascii', { a: x.ascii })) : null),
        el('span', { class: 'sn-ip sa-mono' }, x.valeur),
        el('span', { class: 'sn-or' }, el('span', { class: `sa-tag${x.origine === 'dhcp' || x.origine === 'fixe' ? ' acc' : ''}` }, mot(`o.${x.origine}`))),
        el('span', { class: `sn-q${x.derniereMots ? '' : ' vide'}` }, el('span', { class: 'sn-lq' }, mot('m.lq')), x.derniereMots || mot('rien')));
      function liste() {
        const m = machines(noms(), S.nq);
        zL.replaceChildren(m.length ? el('ul', { class: 'sn-liste' }, m.map(ligne)) : el('p', { class: 'sa-vide' }, tous.length ? mot('m.vide') : mot('m.aucun')));
      }
      liste();
      return el('section', { class: 'sa-card' },
        el('h2', {}, mot('m.titre'), el('span', { class: 'sa-cnt' }, String(tous.length))), el('p', { class: 'sa-lead' }, mot('m.lead', { d: dom() })),
        el('div', { class: 'sa-outils' }, cherche, P ? el('button', { type: 'button', class: 'sa-btn pri', 'data-f': 'aller-ajout', onclick: () => { vider(); aller('enreg', 'n-nom'); } }, ic('plus', 18), mot('m.ajouter')) : null),
        el('div', { class: 'sn-tete', 'aria-hidden': 'true' }, el('span', {}, mot('m.col.nom')), el('span', {}, mot('m.col.ip')), el('span', {}, mot('m.col.origine')), el('span', {}, mot('m.col.derniere'))),
        zL);
    }

    // ------------------------------------------------ « Enregistrements »
    function exemple(s) {
      if (s === 'inverse') { const i = S.D?.inverses?.[0]; return i ? mot('x.inv', { a: i.adresse, n: i.nom }) : mot('x.inverse'); }
      const x = noms().find((y) => y.sorte === s && !y.remplace);
      return x ? mot('x.de', { n: x.nom, v: x.valeur }) : mot(`x.${s}`, { d: dom() });
    }
    function vueSortes() {
      const c = S.D?.comptes ?? {};
      return el('section', { class: 'sa-card' }, el('h2', {}, mot('s.titre')), el('p', { class: 'sa-lead' }, mot('s.lead')),
        el('ul', { class: 'sn-sortes' }, SORTES.filter((s) => s !== 'autre' || c.autre).map((s) => el('li', { class: 'sn-sorte' },
          el('b', {}, el('span', { class: 'sn-tt' }, mot(`s.${s}`), el('span', { class: 'sa-tag' }, mot(`c.${s}`))), el('span', { class: 'sa-cnt' }, String(c[s] || 0))),
          el('p', { class: 'sa-mono' }, exemple(s))))));
    }
    function question(retour) {
      const q = S.q;
      const annuler = () => { S.q = null; corps(); viser(retour); };
      const oui = async () => { if (S.occupe) return; S.occupe = true; corps(); viser('q-ok'); try { await q.faire(); } finally { S.occupe = false; } };
      return el('div', { class: 'sa-garde', role: 'alert', 'aria-live': 'assertive', onkeydown: (ev) => { if (ev.key === 'Escape') { ev.preventDefault?.(); annuler(); } } },
        el('b', { class: 'sa-gt' }, q.texte),
        el('div', { class: 'sa-acts' },
          el('button', { type: 'button', class: `sa-btn ${q.retirer ? 'dng' : 'pri'}`, disabled: S.occupe, 'data-f': 'q-ok', onclick: oui }, ic(q.retirer ? 'corbeille' : 'check', 18), S.occupe ? mot('q.demande') : mot(q.retirer ? 'q.ok.retirer' : 'q.ok')),
          el('button', { type: 'button', class: 'sa-btn ghost', disabled: S.occupe, 'data-f': 'q-non', onclick: annuler }, mot('q.non'))));
    }
    function vueMains() {
      const P = proprio(), l = noms().filter((x) => x.origine === 'main' || x.origine === 'odin');
      const ligne = (x) => el('li', { class: 'sn-main' },
        el('span', { class: 'sn-nm' }, el('b', {}, el('span', { class: 'sa-mono' }, x.nom), ' → ', el('span', { class: 'sa-mono' }, x.valeur)), el('small', {}, `${mot(`s.${x.sorte}`)} · ${mot(`o.${x.origine}`)}`), x.nom !== x.ascii ? el('small', { class: 'sa-mono' }, mot('t.ascii', { a: x.ascii })) : null),
        x.origine === 'odin' ? el('span', { class: 'sa-tag' }, mot('t.verrou'))
          : P ? [sorteForm(x.sorte) ? el('button', { type: 'button', class: 'sn-ibtn', 'aria-label': mot('h.modifier', { nom: x.nom }), title: mot('h.modifier', { nom: x.nom }), 'data-f': `mod:${x.ascii}`, onclick: () => modifier(x) }, ic('crayon')) : null,
            el('button', { type: 'button', class: 'sn-ibtn', 'aria-label': mot('h.retirer', { nom: x.nom }), title: mot('h.retirer', { nom: x.nom }), 'data-f': `ret:${x.ascii}`, onclick: () => demanderRetrait(x) }, ic('corbeille'))] : null,
        S.q && S.q.retirer === x.ascii ? question(`ret:${x.ascii}`) : null);
      return el('section', { class: 'sa-card' }, el('h2', {}, mot('h.titre'), el('span', { class: 'sa-cnt' }, String(l.length))),
        l.length ? el('ul', { class: 'sn-mains' }, l.map(ligne)) : el('p', { class: 'sa-vide' }, mot('h.vide')),
        !P ? el('p', { class: 'sa-lead', style: 'margin-bottom:0' }, mot('h.proprio')) : null);
    }
    let zV = el('div', {}), bOk = null;
    function verdict() {
      const v = S.verdict, frais = v && S.cle === cleDe(), pret = Boolean(frais && v.ok && !S.occupe && !S.q);
      if (bOk) { if (pret) bOk.removeAttribute('disabled'); else bOk.setAttribute('disabled', ''); }
      if (!(S.modif || S.nom.trim()) || !S.val.trim()) return void zV.replaceChildren(el('p', { class: 'off' }, mot(S.modif ? 'f.attend.modif' : 'f.attend')));
      if (!frais) return void zV.replaceChildren(el('p', { class: 'off' }, mot('f.verifie')));
      const ton = tonDe(v);
      zV.replaceChildren(...[el('p', { class: ton }, ic(ton === 'ok' ? 'check' : 'warn', 18), el('span', {}, v.message)), v.avis && v.avis.length ? el('ul', {}, v.avis.map((x) => el('li', {}, x))) : null].filter(Boolean));
    }
    let enVerif = false, aRefaire = false;
    /** Odin vérifie le nom et la valeur tapés (une lecture : rien n'est écrit). Jamais deux vérifications en même temps. */
    async function verifier() {
      const cle = cleDe(), nom = S.modif || S.nom.trim(), val = S.val.trim();
      if (!nom || !val) { S.verdict = null; S.cle = ''; return void verdict(); }
      if (enVerif) { aRefaire = true; return; }
      enVerif = true; verdict();
      try {
        const r = await demander('noms_vus', { nom, sorte: S.sorte, valeur: val, remplacer: Boolean(S.modif) }), v = r && r.data ? r.data.verdict : null;
        if (cleDe() === cle) { S.verdict = v && typeof v.message === 'string' ? v : { ok: false, code: '', message: texteDe(r), avis: [] }; S.cle = cle; }
      } finally { enVerif = false; }
      verdict();
      if (aRefaire) { aRefaire = false; await verifier(); }
    }
    function vider() { S.nom = ''; S.val = ''; S.modif = ''; S.verdict = null; S.cle = ''; S.q = null; }
    function modifier(x) {
      S.modif = x.ascii; S.sorte = sorteForm(x.sorte) || 'a'; S.nom = ''; S.val = x.valeur; S.verdict = null; S.cle = ''; S.q = null; S.res = null;
      corps(); viser('n-val'); void verifier();
    }
    /** Ajouter (ou changer) : d'abord sans « oui » ; si le serveur pose une question, elle s'affiche, et « oui » la renvoie. */
    async function ajouter(confirme) {
      // Avec « oui » (la question l'a déjà marqué occupé) : on va au bout ; sans : jamais deux envois à la fois.
      const v = S.verdict; if ((S.occupe && !confirme) || !v || !v.ok || S.cle !== cleDe()) return;
      const modif = S.modif, input = { nom: S.modif || S.nom.trim(), valeur: S.val.trim(), sorte: S.sorte, remplacer: Boolean(modif) };
      if (!confirme) { S.occupe = true; formulaireSeul(); }
      const r = await demander('nom_local', input, Boolean(confirme));
      S.occupe = false;
      if (r && r.confirm && !confirme) { S.q = { texte: questionDe(r.confirm), faire: () => ajouter(true) }; S.res = null; corps(); viser('q-non'); return; }
      const ok = r.ok !== false && !r.error; S.q = null; S.res = { ok, text: texteDe(r) };
      if (ok) { vider(); await relire(); viser(modif ? `mod:${modif}` : 'n-nom') || viser('n-nom'); return; }
      S.verdict = null; S.cle = ''; corps(); viser(modif ? 'n-val' : 'n-nom'); await verifier();
    }
    /** Retirer : le serveur nomme ce qui sera retiré (sa question), « oui » le retire. */
    async function demanderRetrait(x) {
      const r = await demander('retirer_nom', { nom: x.ascii }, false);
      if (r && r.confirm) { S.q = { retirer: x.ascii, texte: questionDe(r.confirm), faire: () => retirer(x) }; S.res = null; corps(); viser('q-non'); return; }
      S.res = { ok: r.ok !== false && !r.error, text: texteDe(r) }; await relire(); viser(`ret:${x.ascii}`);
    }
    async function retirer(x) {
      const r = await demander('retirer_nom', { nom: x.ascii }, true);
      S.q = null; S.res = { ok: r.ok !== false && !r.error, text: texteDe(r) };
      if (S.modif === x.ascii) vider();
      await relire(); viser('n-nom') || viser('st:enreg');
    }
    // Le formulaire a sa propre place : il se redessine seul (choix d'une sorte, envoi) sans toucher au reste de l'écran.
    const zForm = el('div', {});
    function formulaireSeul() { zForm.replaceChildren(vueForm()); }
    function vueForm() {
      if (!S.D || !proprio()) { bOk = null; return el('div', {}); }
      const d = dom(), modif = S.modif ? ligneDe(S.modif) : null;
      const seg = el('div', { class: 'sn-seg', role: 'group', 'aria-labelledby': 'sn-l-sorte' }, SORTES_FORM.map((k) => el('button', { type: 'button', 'aria-pressed': String(S.sorte === k), 'data-f': `so:${k}`, onclick: () => { S.sorte = k; S.res = null; S.verdict = null; S.cle = ''; formulaireSeul(); viser(`so:${k}`); void verifier(); } }, mot(`f.so.${k}`))));
      const nomIn = S.modif ? null : el('input', { id: 'sn-nom', type: 'text', maxlength: 253, class: 'sa-mono', autocomplete: 'off', spellcheck: 'false', 'data-f': 'n-nom', placeholder: mot(S.sorte === 'joker' ? 'f.nom.joker' : 'f.nom.ex', { d }), value: S.nom,
        oninput: (e) => { S.nom = String(e.target.value); S.res = null; verdict(); void verifier(); }, onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault?.(); void ajouter(false); } } });
      if (nomIn) nomIn.value = S.nom;
      const valIn = el('input', { id: 'sn-val', type: 'text', maxlength: S.sorte === 'texte' ? 255 : 400, class: S.sorte === 'texte' ? '' : 'sa-mono', autocomplete: 'off', spellcheck: 'false', 'data-f': 'n-val', placeholder: mot(`v.${S.sorte}.ex`, { d }), value: S.val,
        oninput: (e) => { S.val = String(e.target.value); S.res = null; verdict(); void verifier(); }, onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault?.(); void ajouter(false); } } });
      valIn.value = S.val;
      zV = el('div', { class: 'sn-v', role: 'status', 'aria-live': 'polite' });
      bOk = el('button', { type: 'button', class: 'sa-btn pri', 'data-f': 'n-ok', disabled: true, onclick: () => ajouter(false) }, ic(S.modif ? 'check' : 'plus', 18), S.occupe ? mot('f.demande') : mot(S.modif ? 'f.ok.modif' : 'f.ok'));
      const n = el('section', { class: 'sa-card' },
        el('h2', {}, S.modif ? mot('f.titre.modif', { nom: modif ? modif.nom : S.modif }) : mot('f.titre')),
        el('div', { class: 'sn-champ' }, el('span', { class: 'sn-lab', id: 'sn-l-sorte' }, mot('f.sorte')), seg),
        el('div', { class: 'sn-form' },
          S.modif ? el('div', { class: 'sn-champ' }, el('span', { class: 'sn-lab' }, mot('f.nom')), el('span', { class: 'sn-fixe sa-mono' }, modif ? modif.nom : S.modif))
            : el('div', { class: 'sn-champ' }, el('label', { for: 'sn-nom' }, mot('f.nom')), nomIn),
          el('div', { class: 'sn-champ' }, el('label', { for: 'sn-val' }, mot(`v.${S.sorte}`)), valIn)),
        zV,
        el('p', { class: 'sn-note' }, mot('f.note', { d })),
        S.q && !S.q.retirer ? question(S.modif ? 'n-val' : 'n-ok') : null,
        el('div', { class: 'sa-acts' }, bOk,
          S.modif ? el('button', { type: 'button', class: 'sa-btn ghost', 'data-f': 'n-non', disabled: S.occupe, onclick: () => { const m = S.modif; vider(); corps(); viser(`mod:${m}`); } }, mot('f.annuler')) : null),
        S.res && S.res.text ? el('p', { class: `sa-res${S.res.ok ? '' : ' non'}`, role: 'status' }, S.res.text) : null);
      verdict();
      return n;
    }
    function corps() {
      if (!S.D) return void zCorps.replaceChildren();
      if (S.st === 'machines') return void zCorps.replaceChildren(vueMachines());
      zForm.replaceChildren(vueForm());
      zCorps.replaceChildren(vueSortes(), vueMains(), zForm);
    }
    let enVol = false;
    async function relire(o = {}) {
      // En direct : pas pendant une question ouverte ni pendant un geste ; jamais deux relectures en même temps.
      const fige = () => Boolean(S.q || S.occupe);
      if (o.discret && (fige() || enVol)) return;
      let r; if (o.discret) enVol = true;
      try { r = await demander('noms_vus'); } finally { if (o.discret) enVol = false; }
      if (o.discret && fige()) return;
      if (r && r.data && Array.isArray(r.data.noms)) S.D = r.data;
      else if (!S.D) S.D = { proprietaire: false, limite: String((r && (r.text ?? r.error)) ?? mot('e.lecture')), domaine: 'maison', dns: { allume: true }, noms: [], inverses: [], comptes: {}, verdict: null };
      // Le nom que l'on change n'existe plus (retiré ailleurs) : le formulaire repart de zéro.
      if (S.modif && !ligneDe(S.modif)) vider();
      const cle = document.activeElement?.getAttribute?.('data-f');
      notes(); onglets();
      // Pendant que tu tapes, ce qui est sous tes doigts ne bouge pas.
      if (o.discret && (cle === 'n-nom' || cle === 'n-val' || cle === 'nq')) return;
      corps(); if (cle) viser(cle);
    }
    return { relire, etat: S };
  }

  SX.ajouter({ id: 'noms', rang: 40, titre: () => mot('onglet'), dessiner: (n) => { const e = ecran(n); return { relire: e.relire, pret: e.relire(), etat: e.etat }; } });
  SX.noms = { MOTS, machines, questionDe, tonDe, sorteForm };
})();
