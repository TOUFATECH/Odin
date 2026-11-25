// Sphinx · « Journal », « Blocage » et « Serveurs DNS » (maquette « Réseau » validée, écrans « DNS · Journal »,
// « DNS · Blocage » et « DNS · Serveurs » ; sa réponse pour le serveur amont : « racine ») :
//   - Journal : qui demande quoi en direct, la réponse, le temps ; 4 chiffres du jour ; filtres Tout / Bloqués / Noms de la
//     maison et une machine ; toucher une ligne → autoriser ou bloquer ce nom, voir la machine (pour un site dangereux,
//     « Voir la machine » d'abord, et « Autoriser quand même » pose la question du serveur) ;
//   - Blocage : tester un nom (ce que répond Odin, et pourquoi) ; les listes en interrupteurs, la pause ; tes règles
//     (bloqués, autorisés, à horaires), en ajouter, en retirer ;
//   - Serveurs DNS : où Odin cherche les noms d'Internet (« Tout seul, depuis la racine » conseillé ; des serveurs
//     chiffrés ; ceux de la box), les temps de réponse, le DNS chiffré des téléphones, les réponses gardées.
// Tout ce qui est vrai vient du serveur (lecture « dns_vu », et « tester ») ; le geste proposé pour une ligne est décidé
// par le serveur ; les gestes passent par les actions existantes de Sphinx (propriétaire seul, mêmes règles côté serveur :
// la page ne décide de rien). Quand le serveur pose une question, elle s'affiche DANS la page, avec ses mots, et rien ne
// part sans « oui ». Un nom vient du réseau : il est TOUJOURS posé comme du texte, jamais comme du HTML. Tous les textes
// de la page sont dans MOTS. Les écrans s'ajoutent à la page de Sphinx (sphinx-appareils.js), après « Noms (DNS) ».
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;
  const SX = W.OdinSphinx;
  if (!SX || !SX.outils || typeof SX.ajouter !== 'function') return;
  const { el, ic, demander, traits } = SX.outils;
  if (!traits.corbeille) traits.corbeille = 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6';
  if (!traits.plus) traits.plus = 'M12 5v14M5 12h14';
  traits.lecture = 'M8 5l11 7-11 7z';
  traits.cadenas = 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3';
  traits.loupe = 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l4 4';

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    'o.journal': 'Journal', 'o.blocage': 'Blocage', 'o.amont': 'Serveurs DNS',
    'membre.titre': 'Ce que tu vois', 'dns.titre': 'Le DNS d\'Odin est éteint', 'dns.texte': 'Rien n\'arrive dans le journal tant qu\'il ne répond pas aux appareils de la maison.',
    'e.silence': 'Odin ne répond pas.', 'e.lecture': 'Odin n\'a pas pu lire le DNS.',
    'q.ok': 'Oui, le faire', 'q.non': 'Annuler', 'q.demande': 'Odin fait le changement…',
    // Journal
    'c.questions': 'Questions aujourd\'hui', 'c.bloquees': 'Bloquées', 'c.machines': 'Machines qui demandent', 'c.moyenne': 'Réponse moyenne', 'c.ms': '{n} ms', 'c.pct': '{n} ({p} %)', 'c.depuis': 'depuis {h}',
    'j.titre': 'Qui demande quoi', 'j.direct': 'en direct',
    'j.lead': 'Chaque nom demandé par une machine de la maison ou du VPN, et ce qu\'Odin a répondu. Touche une ligne pour autoriser ou bloquer ce nom.',
    'j.lead.membre': 'Chaque nom demandé par l\'appareil que tu tiens, et ce qu\'Odin a répondu.',
    'j.filtres': 'Filtres', 'f.tout': 'Tout', 'f.bloque': 'Bloqués', 'f.maison': 'Noms de la maison', 'j.machine': 'Une machine', 'j.toutes': 'Toutes les machines',
    'j.col.heure': 'Heure', 'j.col.machine': 'Machine', 'j.col.nom': 'Nom demandé', 'j.col.rep': 'Réponse', 'j.col.temps': 'Temps',
    'j.vide': 'Rien pour ce filtre.', 'j.aucun': 'Aucune question pour l\'instant : elles arrivent dès qu\'un appareil passe par le DNS d\'Odin.',
    'j.ligne': '{nom}, demandé par {qui} à {h}', 'j.vpn': '{nom} (VPN)', 'j.ascii': 'écrit pour le DNS : {a}',
    'r.bloque': 'bloqué · {l}', 'r.bloque0': 'bloqué', 'r.maison': 'maison', 'r.nx': 'n\'existe pas', 'r.servfail': 'pas de réponse', 'r.refuse': 'refusé', 'r.vide': 'aucune adresse', 'r.cache': 'gardé en mémoire', 'j.cache': 'cache',
    'a.par': 'demandé par {qui}', 'a.autoriser': 'Autoriser ce nom', 'a.autoriser.danger': 'Autoriser quand même', 'a.bloquer': 'Bloquer ce nom', 'a.voir': 'Voir la machine',
    'a.danger': 'Site dangereux : la liste « {l} » le bloque. Regarde d\'abord la machine qui l\'a demandé.', 'a.inconnue': 'Odin ne connaît pas cette machine ({ip}) : elle n\'a pas de fiche à ouvrir.',
    'a.maison': 'Nom de la maison : il se change dans « Noms (DNS) ».', 'a.rien': 'Rien à autoriser ou bloquer pour cette ligne ({r}).',
    'j.garde': 'Gardé sur Odin : les {max} dernières questions en mémoire{disque}. La page lit ce journal sur Odin, elle ne l\'envoie nulle part. Une machine qui demande un site dangereux déclenche une alerte.',
    'j.disque': ', et {j} jours sur son disque',
    // Blocage
    't.titre': 'Tester un nom', 't.lead': 'Est-ce qu\'il est bloqué, et pourquoi ? Odin pose vraiment la question et dit ce qu\'il répond.', 't.nom': 'Nom à tester', 't.ex': 'site.example', 't.ok': 'Tester', 't.demande': 'Odin teste…',
    't.bloque': '{nom} est bloqué', 't.passe': '{nom} passe', 't.maison': '{nom} : nom de la maison', 't.reecrit': '{nom} est remplacé', 't.rep': 'Odin répond : {r}',
    't.autoriser': 'L\'autoriser pour la maison', 't.autoriser.danger': 'L\'autoriser quand même', 't.bloquer': 'Le bloquer',
    'l.titre': 'Les listes de blocage', 'l.lead': 'Pour toutes les machines de la maison et du VPN.', 'l.pause': 'Pause 5 min', 'l.reprendre': 'Reprendre',
    'l.enpause': 'Blocage en pause jusqu\'à {h}. Les sites dangereux restent bloqués.', 'l.noms': '{n} noms', 'l.nom1': '1 nom', 'l.erreur': 'Le dernier téléchargement n\'a pas abouti.', 'l.pas': 'pas encore téléchargée', 'l.coupee': 'coupée', 'l.maj': 'mise à jour {q}', 'l.de': 'de {s}',
    'l.s.blocage': 'pubs et pisteurs', 'l.s.menace': 'sites dangereux', 'l.s.parental': 'contrôle parental', 'l.s.autorisation': 'liste d\'autorisation',
    'l.telecharger': 'Télécharger les listes', 'l.atelecharger': 'Une liste active n\'est pas encore téléchargée : elle ne bloque rien.', 'l.social': 'Pubs des réseaux sociaux', 'l.social.p': 'Les vidéos passent, la pub et le pistage non.',
    'l.note': 'Les listes viennent de sites publics : c\'est la seule chose que Sphinx télécharge. Tu peux les couper et garder seulement tes règles.',
    'g.titre': 'Tes règles', 'g.bloques': 'Bloqués par toi', 'g.autorises': 'Autorisés par toi', 'g.vide': 'Aucune.', 'g.etait': 'était dans « {l} »',
    'g.s.domaine': 'le nom et ce qu\'il y a dessous', 'g.s.exact': 'ce nom seulement', 'g.s.joker': 'tout ce qu\'il y a dessous', 'g.s.expression': 'expression', 'g.s.autre': 'règle', 'g.horaire': '{mots}', 'g.pour': ' · pour {qui}',
    'g.retirer': 'Retirer {nom}', 'g.nom': 'Nom à bloquer ou autoriser', 'g.ex': 'site.example', 'g.bloquer': 'Bloquer', 'g.autoriser': 'Autoriser',
    'g.proprio': 'Bloquer, autoriser, les listes et la pause : le propriétaire seul.',
    // Serveurs
    's.titre': 'Où Odin cherche les noms d\'Internet', 's.lead': 'Pour un nom qui n\'est pas de la maison et pas bloqué.', 's.groupe': 'Serveurs en amont', 's.conseil': 'Conseillé', 's.choisi': 'choisi',
    's.racine': 'Tout seul, depuis la racine d\'Internet', 's.racine.p': 'Odin demande lui-même aux serveurs de chaque domaine.', 's.racine.1': 'Aucun service extérieur entre toi et le site tant que la racine répond', 's.racine.2': 'Un peu plus lent la première fois (puis gardé)',
    's.chiffre': 'Des serveurs chiffrés que tu choisis', 's.chiffre.p': 'Les questions partent chiffrées vers ces serveurs.', 's.chiffre.1': 'Tu donnes leurs adresses (https://… ou tls://…)', 's.chiffre.2': 'Ces serveurs voient chaque question',
    's.box': 'Ceux de la box', 's.box.p': 'La box demande à ton fournisseur d\'accès.', 's.box.1': 'Rien à régler', 's.box.2': 'Ton fournisseur voit chaque question',
    's.autre': 'Réglé à la main : {l}.', 's.secours': 'Si ceux-là ne répondent pas, Odin demande aussi à : {l}.',
    // Le secours (choix du propriétaire, 25/11 : « La racine d'abord. Si elle ne répond pas, Odin demande à un serveur public »).
    's.sec.racine': 'La racine d\'abord ; si elle ne répond pas, Odin demande à {l}.', 's.sec.pourquoi': 'Pour que la maison ne reste jamais sans Internet. Ce serveur voit alors les noms demandés pendant la panne ; jamais un nom de la maison.',
    's.sec.seule': 'Racine seule (sans secours)', 's.sec.sans': 'Racine seule : si la racine ne répond pas, la maison n\'a plus Internet jusqu\'à son retour.', 's.sec.remettre': 'Remettre le secours ({l})',
    's.sec.jour0': 'Le secours n\'a pas servi aujourd\'hui.', 's.sec.jour1': 'Le secours a servi 1 fois aujourd\'hui (à {h}).', 's.sec.jour': 'Le secours a servi {n} fois aujourd\'hui (dernière fois à {h}).',
    's.liste': 'Serveurs chiffrés (séparés par des virgules)', 's.utiliser': 'Utiliser ces serveurs', 's.strat': 'Comment les utiliser', 's.st.rapide': 'Le plus rapide', 's.st.ordre': 'L\'un après l\'autre', 's.st.parallele': 'Tous à la fois',
    'tp.titre': 'Temps de réponse', 'tp.source': 'Source', 'tp.moyenne': 'Moyenne', 'tp.part': 'Dernières 24 h', 'tp.cache': 'Gardé en mémoire (cache)', 'tp.racine': 'Racine d\'Internet', 'tp.vide': 'Pas encore de réponse ces dernières 24 heures.', 'tp.ms': '{n} ms', 'tp.pct': '{n} %',
    'rg.titre': 'Réglages', 'rg.dot': 'DNS chiffré pour les téléphones', 'rg.dot.p': 'Les téléphones qui savent le faire chiffrent leurs questions jusqu\'à Odin (port {p}).', 'rg.dot.non': 'Il faut d\'abord le HTTPS de l\'interface (Réglages → Accès) : son certificat sert aussi au DNS chiffré.',
    'rg.cache': 'Garder les réponses', 'rg.cache.p': '{n} réponses en mémoire : plus rapide.', 'rg.vider': 'Vider', 'rg.maison': 'Les noms « .{d} » ne sortent jamais', 'rg.maison.p': 'Toujours vrai, on ne peut pas le couper.', 'rg.toujours': 'toujours',
    's.proprio': 'Les serveurs du DNS : le propriétaire seul.',
  };
  const mot = (k, v = {}) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? ''));

  const CSS = `
.sd-tete,.sd-row{display:grid;grid-template-columns:76px minmax(0,1.1fr) minmax(0,1.7fr) minmax(0,1.3fr) 64px;gap:10px;align-items:center}
.sd-tete{font-size:11.5px;color:var(--muted);font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:6px 8px}
.sd-liste{list-style:none;margin:0;padding:0}
.sd-row{width:100%;min-height:52px;border:0;border-top:1px solid var(--line);background:none;color:var(--ink);font:inherit;font-size:13px;text-align:left;padding:6px 8px;cursor:pointer}
.sd-row:hover{background:color-mix(in srgb,var(--muted) 8%,transparent)}
.sd-row[aria-expanded="true"]{background:color-mix(in srgb,var(--accent) 12%,transparent)}
.sd-row time,.sd-row .sd-ms{font-variant-numeric:tabular-nums;color:var(--muted)}
.sd-row .sd-ms{text-align:right}
.sd-row .sd-q,.sd-row .sd-w,.sd-row .sd-r{min-width:0;overflow-wrap:anywhere}
.sd-row .sd-q b{font-weight:600}
.sd-row .sd-q small{color:var(--muted);font-size:11.5px;margin-left:6px}
.sd-tag{font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;white-space:normal;display:inline-block}
.sd-tag.bad{background:color-mix(in srgb,var(--bad) 18%,transparent);color:color-mix(in srgb,var(--bad) 78%,var(--ink))}
.sd-tag.mai{background:color-mix(in srgb,var(--accent) 18%,transparent);color:color-mix(in srgb,var(--accent) 78%,var(--ink))}
.sd-tag.off{background:color-mix(in srgb,var(--muted) 18%,transparent);color:var(--muted)}
.sd-act{border-top:1px solid var(--line);padding:10px 8px 12px;background:color-mix(in srgb,var(--accent) 5%,transparent)}
.sd-act>b{display:block;font-size:14px;overflow-wrap:anywhere}
.sd-act>b span{color:var(--muted);font-weight:500}
.sd-act p{margin:6px 0 0;font-size:13px;color:var(--muted)}
.sd-act p.bad{color:var(--bad);font-weight:600}
.sd-outils{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.sd-outils .sa-chips{margin:0}
.sd-outils select,.sd-champ input,.sd-ligne input{min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel2,var(--panel));color:var(--ink);padding:0 12px;font:inherit;font-size:14px;min-width:0}
.sd-ligne{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.sd-ligne input{flex:1 1 220px}
.sd-note{margin:10px 0 0;font-size:12.5px;color:var(--muted);line-height:1.5}
.sd-teste{display:flex;gap:10px;align-items:flex-start;margin-top:12px;border-radius:14px;padding:12px 14px;border:1px solid var(--line);font-size:13.5px;line-height:1.5;overflow-wrap:anywhere}
.sd-teste svg{flex:none;margin-top:2px}
.sd-teste b{display:block;font-size:14.5px}
.sd-teste.bad{border-color:var(--bad);background:color-mix(in srgb,var(--bad) 8%,var(--panel))}.sd-teste.bad>svg{color:var(--bad)}
.sd-teste.ok{border-color:var(--good);background:color-mix(in srgb,var(--good) 8%,var(--panel))}.sd-teste.ok>svg{color:var(--good)}
.sd-teste.mai>svg{color:var(--accent)}
.sd-opt{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line)}
.sd-opt .sd-tx{flex:1;min-width:0}
.sd-opt .sd-tx b{display:block;font-size:14px}
.sd-opt .sd-tx small{display:block;color:var(--muted);font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}
.sd-opt .sd-tx small.bad{color:var(--bad)}
.sd-sw{width:56px;min-width:56px;height:44px;border:0;background:none;padding:0;cursor:pointer;display:inline-grid;place-items:center}
.sd-sw i{display:block;width:48px;height:28px;border-radius:999px;background:color-mix(in srgb,var(--muted) 35%,transparent);position:relative}
.sd-sw i::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.sd-sw[aria-checked="true"] i{background:var(--accent)}
.sd-sw[aria-checked="true"] i::after{left:23px}
.sd-sw:disabled{opacity:.5;cursor:not-allowed}
.sd-deux{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.sd-h3{margin:0 0 6px;font-size:13px;font-weight:700;display:flex;gap:8px;align-items:center}
.sd-regles{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.sd-regle{display:flex;align-items:center;gap:10px;padding:6px 6px 6px 12px;border:1px solid var(--line);border-radius:12px;min-width:0}
.sd-regle .sd-tx{flex:1;min-width:0;overflow-wrap:anywhere}
.sd-regle .sd-tx small{display:block;color:var(--muted);font-size:12px}
.sd-ibtn{min-width:44px;min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);display:inline-grid;place-items:center;cursor:pointer;flex:none;padding:0}
.sd-sec .sd-tx{display:flex;flex-direction:column;gap:4px;align-items:flex-start;min-width:0;overflow-wrap:anywhere}
.sd-sec .sd-tx small{color:var(--muted);font-size:12.5px;line-height:1.45}
.sd-sec .sa-btn{margin-top:4px}
.sd-choix{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.sd-c{position:relative;text-align:left;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;min-height:44px;padding:14px 44px 14px 14px;border-radius:14px;border:2px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;font-size:14px;cursor:pointer;min-width:0}
.sd-c b{display:block;font-size:15px;overflow-wrap:anywhere}
.sd-c p{margin:4px 0 6px;color:var(--muted);font-size:13px;line-height:1.45}
.sd-c ul{margin:0;padding-left:18px;font-size:13px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}
.sd-c[aria-checked="true"]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 9%,var(--panel))}
.sd-c:disabled{opacity:.6;cursor:not-allowed}
.sd-conseil{display:inline-block;align-self:flex-start;font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;background:var(--accent);color:var(--bg,#fff);margin-bottom:6px}
.sd-tick{position:absolute;top:12px;right:12px;width:22px;height:22px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;color:var(--bg,#fff)}
.sd-c[aria-checked="true"] .sd-tick{background:var(--accent);border-color:var(--accent)}
.sd-seg{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 0}
.sd-seg button{min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;font-weight:600;font-size:13.5px;cursor:pointer}
.sd-seg button[aria-pressed="true"]{background:var(--ink);color:var(--bg,#fff);border-color:var(--ink)}
.sd-champ{display:flex;flex-direction:column;gap:4px;margin-top:12px;min-width:0}
.sd-champ label,.sd-champ .sd-lab{font-size:12.5px;color:var(--muted);font-weight:600}
.sd-tbl{width:100%;border-collapse:collapse;font-size:13.5px}
.sd-tbl th{text-align:left;white-space:nowrap;font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;padding:6px 8px}
.sd-tbl td{padding:12px 8px;border-top:1px solid var(--line);overflow-wrap:anywhere}
.sd-tbl td.num,.sd-tbl th.num{text-align:right;font-variant-numeric:tabular-nums}
.sd-ghost{min-height:44px;padding:0 8px;border:0;background:none;color:var(--accent);font:inherit;font-weight:600;font-size:13px;cursor:pointer}
@media (max-width:720px){
  .sd-tete{display:none}
  .sd-row{grid-template-columns:minmax(0,1fr) auto;row-gap:2px;padding:10px 4px}
  .sd-row time{grid-column:2;grid-row:1}
  .sd-row .sd-q{grid-column:1;grid-row:1}
  .sd-row .sd-w,.sd-row .sd-r{grid-column:1}
  .sd-row .sd-ms{grid-column:2;grid-row:2}
}
@media (prefers-reduced-motion:no-preference){.sd-sw i::after{transition:left .12s ease}.sd-row,.sd-c{transition:background .12s ease}}
`;
  function style() { if (!document.getElementById('sd-css')) document.head.append(el('style', { id: 'sd-css' }, CSS)); }

  /** Ce qu'une réponse refusée ou muette donne à lire. */
  const texteDe = (r) => String((r && (r.text ?? r.error)) ?? mot('e.silence'));
  /** La question posée par le serveur (« Confirmer : … ? ») en une phrase. Pur. */
  const questionDe = (c) => { const t = String(c).replace(/^Confirmer : /, '').replace(/\s*\?\s*$/, '').trim(); return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)} ?` : ''; };
  /** Une heure du journal : « 14:06:02 » (« 14:06 » au téléphone). Pur. */
  const heure = (t, court = false) => { const d = new Date(t), p = (x) => String(x).padStart(2, '0'); return court ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  /** La réponse d'une ligne en mots : [ton, texte]. Pur. */
  function reponseDe(l) {
    if (l.statut === 'bloqué') return ['bad', l.liste ? mot('r.bloque', { l: l.liste }) : mot('r.bloque0')];
    if (l.statut === 'refusé') return ['off', l.code === 'NXDOMAIN' ? mot('r.nx') : mot('r.refuse')];
    if (l.statut === 'erreur') return ['off', mot('r.servfail')];
    if (l.reponse) return [l.maison ? 'mai' : '', l.reponse];
    return ['off', l.code === 'NXDOMAIN' ? mot('r.nx') : mot('r.vide')];
  }
  /** Le temps d'une ligne : « maison » pour un nom de la maison, sinon « N ms ». Pur. */
  const tempsDe = (l) => (l.maison && l.statut === 'réécrit' ? mot('r.maison') : l.statut === 'cache' ? mot('j.cache') : mot('c.ms', { n: l.ms }));
  /** Un nombre écrit à la façon de la langue de l'appareil (« 50 000 », « 36,4 »). Pur. */
  const nombre = (n) => { const x = Number(n) || 0; try { return x.toLocaleString(); } catch { return String(x); } };
  /** La clé d'une ligne du journal (elle reste la même d'une relecture à l'autre). Pur. */
  const cleLigne = (l) => `${l.t}|${l.ip}|${l.type}|${l.ascii}`;
  const estTel = () => { try { return Boolean(W.matchMedia && W.matchMedia('(max-width:720px)').matches); } catch { return false; } };
  const ecrit = () => { const c = document.activeElement?.getAttribute?.('data-f'); return c && /^(t-nom|g-nom|s-liste)$/.test(c) ? c : ''; };

  /** La question du serveur, dans la page : le texte, « oui » (qui renvoie le geste confirmé), « annuler ». */
  function question(S, redessiner, viser, retour) {
    const q = S.q;
    const annuler = () => { S.q = null; redessiner(); viser(retour); };
    const oui = async () => { if (S.occupe) return; S.occupe = true; redessiner(); viser('q-ok'); try { await q.faire(); } finally { if (S.occupe) { S.occupe = false; redessiner(); } } };
    return el('div', { class: 'sa-garde', role: 'alert', 'aria-live': 'assertive', onkeydown: (ev) => { if (ev.key === 'Escape') { ev.preventDefault?.(); annuler(); } } },
      el('b', { class: 'sa-gt' }, q.texte),
      el('div', { class: 'sa-acts' },
        el('button', { type: 'button', class: 'sa-btn pri', disabled: S.occupe, 'data-f': 'q-ok', onclick: oui }, ic('check', 18), S.occupe ? mot('q.demande') : mot('q.ok')),
        el('button', { type: 'button', class: 'sa-btn ghost', disabled: S.occupe, 'data-f': 'q-non', onclick: annuler }, mot('q.non'))));
  }
  /**
   * Un geste vers le serveur : d'abord sans « oui » ; s'il pose une question, elle s'affiche et « oui » la renvoie.
   * `apres(r)` reçoit la réponse finale. Jamais deux gestes en même temps.
   */
  async function geste(S, redessiner, viser, action, input, apres, retour) {
    if (S.occupe) return;
    S.occupe = true; S.res = null; redessiner();
    let r; try { r = await demander(action, input, false); } finally { S.occupe = false; }
    if (r && r.confirm) {
      S.q = { texte: questionDe(r.confirm), faire: async () => { const r2 = await demander(action, input, true); S.q = null; S.occupe = false; await apres(r2); if (retour) viser(retour); } };
      redessiner(); viser('q-non'); return;
    }
    await apres(r);
    if (retour) viser(retour);
  }
  const resultat = (S) => (S.res && S.res.text ? el('p', { class: `sa-res${S.res.ok ? '' : ' non'}`, role: 'status' }, S.res.text) : null);
  const reussi = (r) => Boolean(r) && r.ok !== false && !r.error;
  /** Les notes du haut : la limite d'un membre, le DNS éteint. */
  function notes(D) {
    const n = [];
    if (D && D.limite) n.push(el('div', { class: 'sa-note', role: 'note' }, ic('shield'), el('div', {}, el('b', {}, mot('membre.titre')), el('p', {}, D.limite))));
    if (D && D.dns && D.dns.allume === false) n.push(el('div', { class: 'sa-note', role: 'note' }, ic('warn'), el('div', {}, el('b', {}, mot('dns.titre')), el('p', {}, mot('dns.texte')))));
    return n;
  }
  /** Monte un écran : `lire()` demande ses données, `dessiner()` le pose ; rend { relire, etat }. */
  function monter(racine, S, lire, dessiner) {
    style();
    const zNote = el('div', {}), zCorps = el('div', { class: 'sa' });
    racine.append(zNote, zCorps);
    let enVol = false;
    async function relire(o = {}) {
      // En direct : pas pendant une question ouverte, un geste ou une frappe ; jamais deux relectures en même temps.
      const fige = () => Boolean(S.q || S.occupe);
      if (o.discret && (fige() || enVol || ecrit())) return;
      if (o.discret) enVol = true;
      let r; try { r = await lire(); } finally { if (o.discret) enVol = false; }
      if (o.discret && (fige() || ecrit())) return;
      if (r && r.data && r.data.vue) S.D = r.data;
      else if (!S.D) S.D = { proprietaire: false, limite: texteDe(r) || mot('e.lecture') };
      const cle = document.activeElement?.getAttribute?.('data-f');
      zNote.replaceChildren(...notes(S.D));
      zCorps.replaceChildren(...dessiner());
      if (cle) viser(cle);
    }
    const viser = (cle) => { for (const n of racine.querySelectorAll('[data-f]')) if (n.getAttribute('data-f') === cle) { n.focus(); return true; } return false; };
    const redessiner = () => { const cle = document.activeElement?.getAttribute?.('data-f'); zNote.replaceChildren(...notes(S.D)); zCorps.replaceChildren(...dessiner()); if (cle) viser(cle); };
    return { relire, viser, redessiner };
  }

  // ---------------------------------------------------------------- Journal
  function ecranJournal(racine) {
    const S = { D: null, filtre: 'tout', machine: '', sel: '', q: null, occupe: false, res: null };
    const m = monter(racine, S, () => demander('dns_vu', { vue: 'journal', filtre: S.filtre, machine: S.machine, n: 200 }), dessiner);
    const { viser, redessiner, relire } = m;
    const P = () => S.D?.proprietaire === true;
    async function voirMachine(l) {
      // L'écran « Appareils » s'ouvre, puis la fiche de la machine (sa ligne dans la liste).
      await SX.aller('appareils', { mac: l.mac });
      const b = document.body && document.body.querySelector ? document.body.querySelector(`[data-f="row:${l.mac}"]`) : null;
      if (b && typeof b.click === 'function') b.click();
    }
    function faire(l, action) {
      void geste(S, redessiner, viser, action, { domaine: l.ascii }, async (r) => { S.res = { ok: reussi(r), text: texteDe(r) }; await relire(); }, `l:${cleLigne(l)}`);
    }
    function actions(l) {
      const voir = l.mac ? el('button', { type: 'button', class: `sa-btn${l.danger ? ' pri' : ''}`, 'data-f': 'a-voir', disabled: S.occupe, onclick: () => voirMachine(l) }, ic('pc', 18), mot('a.voir')) : null;
      const qui = l.vpn ? mot('j.vpn', { nom: l.machine }) : l.machine;
      let boutons = [], aide = null;
      if (P() && l.geste === 'autoriser' && l.danger) { aide = [el('p', { class: 'bad' }, mot('a.danger', { l: l.liste })), l.mac ? null : el('p', {}, mot('a.inconnue', { ip: l.ip }))]; boutons = [voir, el('button', { type: 'button', class: 'sa-btn', 'data-f': 'a-autoriser', disabled: S.occupe, onclick: () => faire(l, 'autoriser') }, ic('check', 18), mot('a.autoriser.danger'))]; }
      else if (P() && l.geste === 'autoriser') boutons = [el('button', { type: 'button', class: 'sa-btn pri', 'data-f': 'a-autoriser', disabled: S.occupe, onclick: () => faire(l, 'autoriser') }, ic('check', 18), mot('a.autoriser')), voir];
      else if (P() && l.geste === 'bloquer') boutons = [el('button', { type: 'button', class: 'sa-btn dng', 'data-f': 'a-bloquer', disabled: S.occupe, onclick: () => faire(l, 'bloquer') }, ic('ban', 18), mot('a.bloquer')), voir];
      else if (P()) { aide = el('p', {}, l.maison ? mot('a.maison') : mot('a.rien', { r: reponseDe(l)[1] })); boutons = [voir]; }
      return el('div', { class: 'sd-act' },
        el('b', {}, l.nom, ' ', el('span', {}, mot('a.par', { qui }))),
        l.nom !== l.ascii ? el('p', { class: 'sa-mono' }, mot('j.ascii', { a: l.ascii })) : null,
        aide, boutons.some(Boolean) ? el('div', { class: 'sa-acts' }, boutons) : null,
        S.q ? question(S, redessiner, viser, `l:${cleLigne(l)}`) : null, resultat(S));
    }
    function ligne(l) {
      const k = cleLigne(l), [ton, rep] = reponseDe(l), ouvert = S.sel === k, qui = l.vpn ? mot('j.vpn', { nom: l.machine }) : l.machine;
      return el('li', {},
        el('button', { type: 'button', class: 'sd-row', 'aria-expanded': String(ouvert), 'data-f': `l:${k}`, 'aria-label': mot('j.ligne', { nom: l.nom, qui, h: heure(l.t) }),
          onclick: () => { S.sel = ouvert ? '' : k; S.q = null; S.res = null; redessiner(); viser(`l:${k}`); } },
          el('time', {}, heure(l.t, estTel())), el('span', { class: 'sd-w' }, qui),
          el('span', { class: 'sd-q' }, el('b', { class: 'sa-mono' }, l.nom), el('small', {}, l.type)),
          el('span', { class: 'sd-r' }, ton ? el('span', { class: `sd-tag ${ton}` }, rep) : el('span', { class: 'sa-mono' }, rep)),
          el('span', { class: 'sd-ms' }, tempsDe(l))),
        ouvert ? actions(l) : null);
    }
    function dessiner() {
      const D = S.D; if (!D || !Array.isArray(D.lignes)) return [];
      const c = D.chiffres || {}, minuit = new Date(); minuit.setHours(0, 0, 0, 0);
      const depuis = c.depuis && c.depuis - minuit.getTime() > 60_000 ? mot('c.depuis', { h: heure(c.depuis, true) }) : '';
      const stat = (cls, t, v, plus) => el('div', { class: `sa-stat${cls ? ` ${cls}` : ''}` }, el('small', {}, t), el('b', {}, v), plus ? el('small', {}, plus) : null);
      if (S.sel && !D.lignes.some((l) => cleLigne(l) === S.sel)) S.sel = '';
      const chips = el('div', { class: 'sa-chips', role: 'group', 'aria-label': mot('j.filtres') }, ['tout', 'bloque', 'maison'].map((f) => el('button', { type: 'button', class: 'sa-chip', 'aria-pressed': String(S.filtre === f), 'data-f': `f:${f}`,
        onclick: async () => { S.filtre = f; S.sel = ''; S.res = null; await relire(); viser(`f:${f}`); } }, mot(`f.${f}`))));
      const choix = el('select', { 'aria-label': mot('j.machine'), 'data-f': 'j-machine', onchange: async (e) => { S.machine = String(e.target.value); S.sel = ''; await relire(); viser('j-machine'); } },
        el('option', { value: '' }, mot('j.toutes')), (D.machines || []).map((x) => el('option', { value: x.ip, ...(S.machine === x.ip ? { selected: true } : {}) }, x.nom === x.ip ? x.ip : `${x.nom} · ${x.ip}`)));
      choix.value = S.machine;
      const g = D.garde || {};
      return [
        el('div', { class: 'sa-stats' }, stat('', mot('c.questions'), String(c.questions ?? 0), depuis), stat('bad', mot('c.bloquees'), mot('c.pct', { n: nombre(c.bloquees), p: nombre(c.pct) })), stat('', mot('c.machines'), String(c.machines ?? 0)), stat('ok', mot('c.moyenne'), mot('c.ms', { n: c.moyenne ?? 0 }))),
        el('section', { class: 'sa-card' },
          el('h2', {}, mot('j.titre'), el('span', { class: 'sa-live' }, mot('j.direct'))), el('p', { class: 'sa-lead' }, mot(P() ? 'j.lead' : 'j.lead.membre')),
          el('div', { class: 'sd-outils' }, chips, (D.machines || []).length > 1 || S.machine ? choix : null),
          el('div', { class: 'sd-tete', 'aria-hidden': 'true' }, el('span', {}, mot('j.col.heure')), el('span', {}, mot('j.col.machine')), el('span', {}, mot('j.col.nom')), el('span', {}, mot('j.col.rep')), el('span', { style: 'text-align:right' }, mot('j.col.temps'))),
          D.lignes.length ? el('ul', { class: 'sd-liste' }, D.lignes.map(ligne)) : el('p', { class: 'sa-vide' }, S.filtre === 'tout' && !S.machine ? mot('j.aucun') : mot('j.vide')),
          el('p', { class: 'sd-note' }, mot('j.garde', { max: nombre(g.max), disque: g.disque ? mot('j.disque', { j: g.jours }) : '' }))),
      ];
    }
    return { relire, etat: S };
  }

  // ---------------------------------------------------------------- Blocage
  function ecranBlocage(racine) {
    const S = { D: null, test: '', T: null, nom: '', q: null, occupe: false, res: null, ou: '' };
    const m = monter(racine, S, () => demander('dns_vu', { vue: 'blocage' }), dessiner);
    const { viser, redessiner, relire } = m;
    const P = () => S.D?.proprietaire === true;
    async function tester(o = {}) {
      const n = S.test.trim(); if (!n || S.occupe) return;
      S.occupe = true; S.ou = 'test'; if (!o.garder) S.res = null; redessiner();
      let r; try { r = await demander('tester', { domaine: n }); } finally { S.occupe = false; }
      S.T = r && r.data && r.data.verdict ? r.data : { erreur: texteDe(r) };
      redessiner(); viser('t-nom');
    }
    const apres = (ou, retour) => async (r) => { S.ou = ou; S.res = { ok: reussi(r), text: texteDe(r) }; if (ou === 'regles' && reussi(r)) S.nom = ''; if (ou === 'test' && reussi(r)) await tester({ garder: true }); await relire(); if (retour) viser(retour); };
    const faire = (ou, action, input, retour) => { S.ou = ou; void geste(S, redessiner, viser, action, input, apres(ou, retour), retour); };
    function vueTest() {
      const T = S.T;
      const champ = el('input', { type: 'text', class: 'sa-mono', maxlength: 253, autocomplete: 'off', spellcheck: 'false', 'aria-label': mot('t.nom'), placeholder: mot('t.ex'), 'data-f': 't-nom', value: S.test,
        oninput: (e) => { S.test = String(e.target.value); }, onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault?.(); void tester(); } } });
      champ.value = S.test;
      let res = null;
      if (T && T.erreur) res = el('p', { class: 'sa-res non', role: 'status' }, T.erreur);
      else if (T) {
        const ton = T.verdict === 'bloque' ? 'bad' : T.verdict === 'maison' ? 'mai' : 'ok', titre = mot(T.verdict === 'bloque' ? 't.bloque' : T.verdict === 'maison' ? 't.maison' : T.verdict === 'reecrit' ? 't.reecrit' : 't.passe', { nom: T.nom });
        // Un site dangereux : « L'autoriser quand même » n'est jamais le bouton mis en avant (comme dans le journal).
        const b = P() && T.geste === 'autoriser' ? el('button', { type: 'button', class: T.danger ? 'sa-btn' : 'sa-btn pri', 'data-f': 't-autoriser', disabled: S.occupe, onclick: () => faire('test', 'autoriser', { domaine: T.ascii }, 't-nom') }, ic('check', 18), mot(T.danger ? 't.autoriser.danger' : 't.autoriser'))
          : P() && T.geste === 'bloquer' ? el('button', { type: 'button', class: 'sa-btn dng', 'data-f': 't-bloquer', disabled: S.occupe, onclick: () => faire('test', 'bloquer', { domaine: T.ascii }, 't-nom') }, ic('ban', 18), mot('t.bloquer')) : null;
        res = el('div', { class: `sd-teste ${ton}`, role: 'status' }, ic(ton === 'bad' ? 'ban' : 'check', 20),
          el('span', {}, el('b', {}, titre), T.nom !== T.ascii ? el('span', { class: 'sa-mono' }, mot('j.ascii', { a: T.ascii })) : null, el('span', { style: 'display:block' }, T.raison), T.reponse ? el('span', { class: 'sa-mono', style: 'display:block' }, mot('t.rep', { r: T.reponse })) : null,
            b ? el('span', { class: 'sa-acts' }, b) : null));
      }
      return el('section', { class: 'sa-card' }, el('h2', {}, mot('t.titre')), el('p', { class: 'sa-lead' }, mot('t.lead')),
        el('div', { class: 'sd-ligne' }, champ, el('button', { type: 'button', class: 'sa-btn', 'data-f': 't-ok', disabled: S.occupe, onclick: tester }, ic('loupe', 18), S.occupe && S.ou === 'test' && !S.q ? mot('t.demande') : mot('t.ok'))),
        res, S.ou === 'test' && S.q ? question(S, redessiner, viser, 't-nom') : null, S.ou === 'test' ? resultat(S) : null);
    }
    function vueListes() {
      const D = S.D, pause = D.pause;
      const ligne = (l) => {
        const etat = !l.active ? mot('l.coupee') : Number(l.compte) === 1 ? mot('l.nom1') : l.compte ? mot('l.noms', { n: nombre(l.compte) }) : mot('l.pas');
        const plus = [mot(`l.s.${l.sorte}`), etat, l.active && l.maj ? mot('l.maj', { q: SX.quand(l.maj) }) : '', l.source ? mot('l.de', { s: l.source }) : ''].filter(Boolean).join(' · ');
        return el('div', { class: 'sd-opt' }, el('span', { class: 'sd-tx' }, el('b', { id: `sd-l-${l.id}` }, l.nom), el('small', {}, plus), l.erreur ? el('small', { class: 'bad', title: l.erreur }, mot('l.erreur')) : null),
          el('button', { type: 'button', class: 'sd-sw', role: 'switch', 'aria-checked': String(Boolean(l.active)), 'aria-labelledby': `sd-l-${l.id}`, 'data-f': `sw:${l.id}`, disabled: S.occupe,
            onclick: () => faire('listes', 'activer_liste', { id: l.id, active: !l.active }, `sw:${l.id}`) }, el('i', { 'aria-hidden': 'true' })));
      };
      return el('section', { class: 'sa-card' },
        el('div', { class: 'sd-ligne' }, el('div', { style: 'flex:1;min-width:0' }, el('h2', {}, mot('l.titre')), el('p', { class: 'sa-lead', style: 'margin-bottom:4px' }, mot('l.lead'))),
          el('button', { type: 'button', class: 'sa-btn', 'data-f': 'l-pause', disabled: S.occupe, onclick: () => faire('listes', pause ? 'reprendre' : 'pause', pause ? {} : { minutes: 5 }, 'l-pause') }, ic(pause ? 'lecture' : 'pause', 18), mot(pause ? 'l.reprendre' : 'l.pause'))),
        pause ? el('p', { class: 'sa-avis warn', role: 'status' }, ic('warn', 18), el('span', {}, mot('l.enpause', { h: heure(pause.jusqua, true) }))) : null,
        (D.listes || []).map(ligne),
        // Les pubs des réseaux sociaux (écran de la maquette) : l'action existante « pubs_reseaux », en gardant les
        // plateformes que le propriétaire a laissées de côté.
        D.pubsReseaux ? el('div', { class: 'sd-opt' }, el('span', { class: 'sd-tx' }, el('b', { id: 'sd-l-pubs-reseaux' }, mot('l.social')), el('small', {}, mot('l.social.p'))),
          el('button', { type: 'button', class: 'sd-sw', role: 'switch', 'aria-checked': String(Boolean(D.pubsReseaux.actif)), 'aria-labelledby': 'sd-l-pubs-reseaux', 'data-f': 'sw:pubs-reseaux', disabled: S.occupe,
            onclick: () => faire('listes', 'pubs_reseaux', { actif: !D.pubsReseaux.actif, sauf: (D.pubsReseaux.sauf || []).join(',') }, 'sw:pubs-reseaux') }, el('i', { 'aria-hidden': 'true' }))) : null,
        D.aTelecharger ? el('div', { class: 'sd-ligne', style: 'margin-top:10px' }, el('p', { class: 'sd-note', style: 'flex:1;margin:0' }, mot('l.atelecharger')), el('button', { type: 'button', class: 'sa-btn', 'data-f': 'l-maj', disabled: S.occupe, onclick: () => faire('listes', 'mettre_a_jour', {}, 'l-maj') }, mot('l.telecharger'))) : null,
        el('p', { class: 'sd-note' }, mot('l.note')), S.ou === 'listes' && S.q ? question(S, redessiner, viser, 'l-pause') : null, S.ou === 'listes' ? resultat(S) : null);
    }
    function vueRegles() {
      const R = S.D.regles || { bloques: [], autorises: [], horaires: [] };
      const regle = (x) => el('li', { class: 'sd-regle' }, el('span', { class: 'sd-tx' }, el('b', { class: 'sa-mono' }, x.nom), el('small', {}, mot(`g.s.${x.sorte}`)), x.etait ? el('small', {}, mot('g.etait', { l: x.etait })) : null),
        el('button', { type: 'button', class: 'sd-ibtn', 'aria-label': mot('g.retirer', { nom: x.nom }), title: mot('g.retirer', { nom: x.nom }), 'data-f': `r:${x.regle}`, disabled: S.occupe, onclick: () => faire('regles', 'retirer_regle', { regle: x.regle }, 'g-nom') }, ic('corbeille')));
      const horaire = (x) => el('li', { class: 'sd-regle' }, el('span', { class: 'sd-tx' }, el('b', { class: 'sa-mono' }, x.nom), el('small', {}, mot('g.horaire', { mots: x.mots }) + (x.pour && x.pour.length ? mot('g.pour', { qui: x.pour.join(', ') }) : ''))),
        el('button', { type: 'button', class: 'sd-ibtn', 'aria-label': mot('g.retirer', { nom: x.nom }), title: mot('g.retirer', { nom: x.nom }), 'data-f': `h:${x.domaine}`, disabled: S.occupe, onclick: () => faire('regles', 'retirer_horaire', { domaine: x.domaine }, 'g-nom') }, ic('corbeille')));
      const nb = R.bloques.length + R.horaires.length;
      const champ = el('input', { type: 'text', class: 'sa-mono', maxlength: 253, autocomplete: 'off', spellcheck: 'false', 'aria-label': mot('g.nom'), placeholder: mot('g.ex'), 'data-f': 'g-nom', value: S.nom, oninput: (e) => { S.nom = String(e.target.value); } });
      champ.value = S.nom;
      const ajout = (action) => { const n = S.nom.trim(); if (!n) return viser('g-nom'); faire('regles', action, { domaine: n }, 'g-nom'); };
      return el('section', { class: 'sa-card' }, el('h2', {}, mot('g.titre')),
        el('div', { class: 'sd-deux' },
          el('div', {}, el('div', { class: 'sd-h3' }, mot('g.bloques'), el('span', { class: 'sa-cnt' }, String(nb))), nb ? el('ul', { class: 'sd-regles' }, R.bloques.map(regle), R.horaires.map(horaire)) : el('p', { class: 'sa-vide' }, mot('g.vide'))),
          el('div', {}, el('div', { class: 'sd-h3' }, mot('g.autorises'), el('span', { class: 'sa-cnt' }, String(R.autorises.length))), R.autorises.length ? el('ul', { class: 'sd-regles' }, R.autorises.map(regle)) : el('p', { class: 'sa-vide' }, mot('g.vide')))),
        el('div', { class: 'sd-ligne', style: 'margin-top:12px' }, champ,
          el('button', { type: 'button', class: 'sa-btn dng', 'data-f': 'g-bloquer', disabled: S.occupe, onclick: () => ajout('bloquer') }, ic('ban', 18), mot('g.bloquer')),
          el('button', { type: 'button', class: 'sa-btn', 'data-f': 'g-autoriser', disabled: S.occupe, onclick: () => ajout('autoriser') }, ic('check', 18), mot('g.autoriser'))),
        S.ou === 'regles' && S.q ? question(S, redessiner, viser, 'g-nom') : null, S.ou === 'regles' ? resultat(S) : null);
    }
    function dessiner() {
      const D = S.D; if (!D) return [];
      if (!P()) return [vueTest()];
      return [vueTest(), vueListes(), vueRegles()];
    }
    return { relire, etat: S };
  }

  // ---------------------------------------------------------------- Serveurs DNS
  function ecranServeurs(racine) {
    const S = { D: null, ouvrir: false, liste: null, q: null, occupe: false, res: null, ou: '' };
    const m = monter(racine, S, () => demander('dns_vu', { vue: 'serveurs' }), dessiner);
    const { viser, redessiner, relire } = m;
    const faire = (ou, action, input, retour) => { S.ou = ou; void geste(S, redessiner, viser, action, input, async (r) => { S.ou = ou; S.res = { ok: reussi(r), text: texteDe(r) }; if (reussi(r) && ou === 'amont') { S.ouvrir = false; S.liste = null; } await relire(); if (retour) viser(retour); }, retour); };
    const IDS = ['racine', 'chiffre', 'box'];
    function choisir(id) {
      const D = S.D;
      if (id === 'chiffre') { S.ouvrir = true; if (S.liste === null) S.liste = D.choix === 'chiffre' ? D.amont.map((u) => u.label).join(', ') : ''; S.res = null; redessiner(); viser('s-liste'); return; }
      S.ouvrir = false;
      if (D.choix === id) return;
      faire('amont', 'reglages', { amont: id === 'racine' ? 'récursif' : D.box }, `c:${id}`);
    }
    function vueChoix() {
      const D = S.D, choisi = S.ouvrir ? 'chiffre' : D.choix;
      const carte = (id) => {
        const on = choisi === id;
        const puces = id === 'chiffre' && D.choix === 'chiffre' ? D.amont.map((u) => u.label) : id === 'box' ? [mot('s.box.1'), mot('s.box.2'), D.box] : [mot(`s.${id}.1`), mot(`s.${id}.2`)];
        return el('button', { type: 'button', class: 'sd-c', role: 'radio', 'aria-checked': String(on), tabindex: on ? '0' : '-1', disabled: S.occupe, 'data-f': `c:${id}`, onclick: () => choisir(id),
          onkeydown: (ev) => { const i = IDS.indexOf(id), j = ['ArrowRight', 'ArrowDown'].includes(ev.key) ? (i + 1) % 3 : ['ArrowLeft', 'ArrowUp'].includes(ev.key) ? (i + 2) % 3 : -1; if (j >= 0) { ev.preventDefault?.(); viser(`c:${IDS[j]}`); } } },
          D.conseille === id ? el('span', { class: 'sd-conseil' }, mot('s.conseil')) : null,
          el('b', {}, mot(`s.${id}`)), el('p', {}, mot(`s.${id}.p`)), el('ul', {}, puces.filter(Boolean).map((x) => el('li', {}, x))),
          el('span', { class: 'sd-tick', 'aria-hidden': 'true' }, on ? ic('check', 14) : null));
      };
      const strat = D.choix === 'chiffre' && !S.ouvrir ? el('div', { class: 'sd-champ' }, el('span', { class: 'sd-lab', id: 'sd-l-st' }, mot('s.strat')),
        el('div', { class: 'sd-seg', role: 'group', 'aria-labelledby': 'sd-l-st' }, ['rapide', 'ordre', 'parallele'].map((k) => el('button', { type: 'button', 'aria-pressed': String(D.strategie === k), 'data-f': `st:${k}`, disabled: S.occupe, onclick: () => { if (D.strategie !== k) faire('amont', 'reglages', { strategie: k }, `st:${k}`); } }, mot(`s.st.${k}`))))) : null;
      let liste = null;
      if (S.ouvrir) {
        const champ = el('input', { id: 'sd-liste', type: 'text', class: 'sa-mono', autocomplete: 'off', spellcheck: 'false', 'data-f': 's-liste', value: S.liste ?? '', oninput: (e) => { S.liste = String(e.target.value); }, onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault?.(); envoyer(); } } });
        champ.value = S.liste ?? '';
        const envoyer = () => { const v = String(S.liste ?? '').trim(); if (!v) return viser('s-liste'); faire('amont', 'reglages', { amont: v }, 's-liste'); };
        liste = el('div', { class: 'sd-champ' }, el('label', { for: 'sd-liste' }, mot('s.liste')), el('div', { class: 'sd-ligne' }, champ, el('button', { type: 'button', class: 'sa-btn pri', 'data-f': 's-ok', disabled: S.occupe, onclick: envoyer }, ic('check', 18), mot('s.utiliser'))));
      }
      return el('section', { class: 'sa-card' }, el('h2', {}, mot('s.titre')), el('p', { class: 'sa-lead' }, mot('s.lead')),
        el('div', { class: 'sd-choix', role: 'radiogroup', 'aria-label': mot('s.groupe') }, IDS.map(carte)),
        D.choix === 'autre' ? el('p', { class: 'sa-avis warn' }, ic('warn', 18), el('span', {}, mot('s.autre', { l: D.amont.map((u) => u.label).join(', ') }))) : null,
        vueSecours(D),
        strat, liste, S.ou === 'amont' && S.q ? question(S, redessiner, viser, 'c:racine') : null, S.ou === 'amont' ? resultat(S) : null);
    }
    /** Le secours : ce qu'il fait (en clair), combien de fois il a servi aujourd'hui, et « Racine seule » pour le retirer. */
    function vueSecours(D) {
      const sec = D.secours || [], jour = D.secoursAujourdhui || { n: 0, dernier: null }, n = Number(jour.n) || 0;
      const compte = n ? (n === 1 ? mot('s.sec.jour1', { h: heure(jour.dernier, true) }) : mot('s.sec.jour', { n: nombre(n), h: heure(jour.dernier, true) })) : sec.length ? mot('s.sec.jour0') : '';
      const ligneCompte = compte ? el('small', { class: 'sd-sec-n', role: 'status' }, compte) : null;
      if (D.choix === 'racine' && sec.length) {
        return el('div', { class: 'sa-avis sd-sec' }, ic('shield', 18), el('span', { class: 'sd-tx' }, el('b', {}, mot('s.sec.racine', { l: sec.join(', ') })), el('small', {}, mot('s.sec.pourquoi')), ligneCompte,
          el('button', { type: 'button', class: 'sa-btn', 'data-f': 's-seule', disabled: S.occupe, onclick: () => faire('amont', 'reglages', { secours: false }, 's-seule') }, mot('s.sec.seule'))));
      }
      if (D.choix === 'racine') {
        const l = (D.secoursPossibles || []).join(', ');
        return el('div', { class: 'sa-avis warn sd-sec' }, ic('warn', 18), el('span', { class: 'sd-tx' }, el('b', {}, mot('s.sec.sans')), ligneCompte,
          el('button', { type: 'button', class: 'sa-btn', 'data-f': 's-secours', disabled: S.occupe, onclick: () => faire('amont', 'reglages', { secours: true }, 's-secours') }, mot('s.sec.remettre', { l }))));
      }
      return sec.length ? el('div', { class: 'sa-avis warn sd-sec' }, ic('warn', 18), el('span', { class: 'sd-tx' }, el('span', {}, mot('s.secours', { l: sec.join(', ') })), ligneCompte)) : null;
    }
    function vueTemps() {
      const T = S.D.temps || [];
      const nom = (t) => (t.source === 'cache' ? mot('tp.cache') : /^r[ée]cursif/.test(t.label) ? mot('tp.racine') : t.label);
      return el('section', { class: 'sa-card' }, el('h2', {}, mot('tp.titre')),
        T.length ? el('table', { class: 'sd-tbl' }, el('thead', {}, el('tr', {}, el('th', {}, mot('tp.source')), el('th', { class: 'num' }, mot('tp.moyenne')), el('th', { class: 'num' }, mot('tp.part')))),
          el('tbody', {}, T.map((t) => el('tr', {}, el('td', {}, nom(t)), el('td', { class: 'num' }, mot('tp.ms', { n: t.moyenne })), el('td', { class: 'num' }, mot('tp.pct', { n: t.part }))))))
          : el('p', { class: 'sa-vide' }, mot('tp.vide')));
    }
    function vueReglages() {
      const D = S.D, dot = D.dot || {}, peut = dot.actif || dot.possible;
      return el('section', { class: 'sa-card' }, el('h2', {}, mot('rg.titre')),
        el('div', { class: 'sd-opt' }, el('span', { class: 'sd-tx' }, el('b', { id: 'sd-l-dot' }, mot('rg.dot')), el('small', {}, mot('rg.dot.p', { p: dot.port || 853 })), !peut ? el('small', {}, mot('rg.dot.non')) : null),
          el('button', { type: 'button', class: 'sd-sw', role: 'switch', 'aria-checked': String(Boolean(dot.actif)), 'aria-labelledby': 'sd-l-dot', 'data-f': 'sw:dot', disabled: S.occupe || !peut, onclick: () => faire('reglages', 'dns_chiffre', { actif: !dot.actif }, 'sw:dot') }, el('i', { 'aria-hidden': 'true' }))),
        el('div', { class: 'sd-opt' }, el('span', { class: 'sd-tx' }, el('b', {}, mot('rg.cache')), el('small', {}, mot('rg.cache.p', { n: nombre(D.cache?.reponses) }))),
          el('button', { type: 'button', class: 'sa-btn', 'data-f': 'rg-vider', disabled: S.occupe, onclick: () => faire('reglages', 'vider_cache', {}, 'rg-vider') }, mot('rg.vider'))),
        // Seulement quand le nom de la maison est un nom privé (le serveur ne le garde chez soi que dans ce cas).
        D.domaine ? el('div', { class: 'sd-opt' }, el('span', { class: 'sd-tx' }, el('b', {}, mot('rg.maison', { d: D.domaine })), el('small', {}, mot('rg.maison.p'))), el('span', { class: 'sa-tag' }, ic('cadenas', 14), ' ', mot('rg.toujours'))) : null,
        S.ou === 'reglages' && S.q ? question(S, redessiner, viser, 'rg-vider') : null, S.ou === 'reglages' ? resultat(S) : null);
    }
    function dessiner() {
      const D = S.D; if (!D || !D.proprietaire) return [];
      return [vueChoix(), vueTemps(), vueReglages()];
    }
    return { relire, etat: S };
  }

  const ecran = (f) => (n) => { const e = f(n); return { relire: e.relire, pret: e.relire(), etat: e.etat }; };
  SX.ajouter({ id: 'journal', rang: 50, titre: () => mot('o.journal'), dessiner: ecran(ecranJournal) });
  SX.ajouter({ id: 'blocage', rang: 60, titre: () => mot('o.blocage'), dessiner: ecran(ecranBlocage) });
  SX.ajouter({ id: 'amont', rang: 70, titre: () => mot('o.amont'), dessiner: ecran(ecranServeurs) });
  SX.dns = { MOTS, heure, reponseDe, tempsDe, cleLigne, questionDe };
})();
