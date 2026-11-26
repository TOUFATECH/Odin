// La fenêtre d'Odin (maquettes validées « Fenetre », « FenetreEdition », « FenetreTel ») : des pages de modules
// d'applis (chiffres clés ou une partie de la page d'une appli), la météo, des boutons sur mesure. Mode « Modifier » :
// glisser-déposer (souris et doigt), taille, retirer, pages (ajouter, renommer, supprimer), catalogue des modules,
// bouton sur mesure, thème. Rangée par Hestia (côté Odin) : la même sur l'ordinateur et le téléphone.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v === undefined || v === null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const api = async (path, body) => { const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } }); return r.json(); };
  // La grille de la maquette (12 colonnes, 4 au téléphone) : ses calculs sont dans pages/accueil-grille.js, chargé avant.
  const G = window.OdinGrille;
  // Les textes ajoutés au lot 15 (tirer le coin, les sept tailles), en un seul endroit.
  const TXT = {
    tailles: { petit: 'Petit', moyen: 'Moyen', large: 'Large', haut: 'Haut', grand: 'Grand', tresGrand: 'Très grand', bandeau: 'Bandeau' },
    // « Régler » d'un widget dont l'appli se choisit (le widget « appli ») : le nom du champ.
    appliMontree: 'L\'appli montrée',
    boutonTailles: 'Choisir une taille', titreTailles: 'Taille du module', aideTailles: 'Ou tire le coin du module en mode Modifier, à la case près ; au clavier, Maj + flèches sur la poignée.',
    miniTailles: (m) => `Plus petit que ${m} : refusé pour ce module.`, aucuneTaille: 'Choisis une taille.', poignee: 'Déplacer (flèches) · Maj + flèches : changer la taille',
    taille: (t) => `Taille ${t}`, remise: (t) => `Taille remise à ${t}.`, refusee: (t) => `Taille ${t} : c'est la plus petite (ou la plus grande) possible pour ce module.`,
    // Lot 16 : glisser un module.
    range: '✓ Fenêtre rangée.', enMain: 'Mode Modifier : glisse le module où tu veux, puis « Terminé » pour garder.',
    place: (n, t) => `Module posé à la place ${n} sur ${t}.`, revenu: 'Déplacement annulé : le module est revenu à sa place.',
    deplace: 'Module déplacé.', annuler: 'Annuler', annule: 'Déplacement annulé.', tropTard: 'Trop tard pour annuler ce déplacement : la fenêtre a changé depuis.',
    // Lot 22a : l'accueil en plein écran.
    sortiePlein: 'Quitter le plein écran (Échap)', enPlein: 'Plein écran : seulement les widgets. Échap, ou le ✕ en haut à droite, pour sortir.',
    // Lot 25a : le titre d'un widget quand la fenêtre n'en porte pas (jamais lu chez l'appli pour qui n'y a pas droit).
    titres: { heure: 'Heure et lieu', meteo: 'Météo', site: 'Site surveillé', a_faire: 'À faire', odin_a_fait: 'Ce qu\'Odin a fait', tu_veux: 'Tu veux sans doute', comportement: 'Comment Odin se comporte', chiffres_cles: 'Chiffres clés', surveillance: 'Surveillance', sauvegarde: 'Sauvegarde', resume_matin: 'Résumé du matin', application: 'Application', sansTitre: 'Widget' }, sousSite: 'Pulsar · site surveillé',
    // Lot 26 : la page rangée sous un code porte son nom ici (pas dans la donnée) ; les trois blocs du jour devenus widgets.
    // Lot 27 : « Comment Odin se comporte » (autonomie, disponibilité, discrétion) les rejoint, puis les cinq chiffres
    // cliquables (appareils en ligne, missions en cours, risques repérés, dépenses du mois, mode d'Odin), puis les quatre
    // tuiles d'état (surveillance, sauvegarde, résumé du matin, application), une par widget.
    pages: { aujourdhui: 'Aujourd\'hui' },
    // La page « Aujourd'hui » sur l'écran de la maison (validé le 24/11) : ses widgets ordinaires seulement.
    maisonJour: 'Montrer cette page sur l\'écran de la maison : seulement les widgets que tu y as posés. « Chiffres clés », « Tu veux sans doute », « À faire », « Ce qu\'Odin a fait », « Comment Odin se comporte », « Surveillance », « Sauvegarde », « Résumé du matin » et « Application » n\'y vont jamais.',
    jour: { sous: 'Odin', lettres: { a_faire: '✓', odin_a_fait: '⚡', tu_veux: '💡', comportement: '⚙', chiffres_cles: '📊', surveillance: '🛡', sauvegarde: '💾', resume_matin: '⏰', application: '📲' }, attente: 'Un instant…', deja: (t) => `« ${t} » est déjà dans ta fenêtre.`,
      quoi: { odin_a_fait: 'Le fil du jour : ce qu\'Odin a fait, seul ou avec ton accord, et « Annuler ».', tu_veux: 'Ce qu\'Odin te propose de faire maintenant.', a_faire: 'Ce qui t\'attend : validations, demandes d\'accès, alertes.', comportement: 'Ses trois réglages du moment : autonomie, disponibilité, discrétion.',
        chiffres_cles: 'Appareils en ligne, missions en cours, risques repérés, dépenses du mois, mode d\'Odin. Touche un chiffre pour voir le détail.',
        surveillance: 'L\'espace des disques et tes appareils importants, en ligne ou non.', sauvegarde: 'La sauvegarde automatique : si elle marche, la dernière, ses réglages.',
        resume_matin: 'Chaque matin à l\'heure choisie : météo, réseau, rappels du jour.', application: 'Installer Odin sur cet appareil, activer ses notifications.' } },
    // « Ouvrir à… » : un widget de la vie privée, ouvert à une personne précise (sa question 15, réponse b).
    ouvrir: {
      bouton: 'Ouvrir à…', nom: (t) => `Ouvrir « ${t} » à une personne`, titre: (t) => `Ouvrir « ${t} » à…`, groupe: 'Les personnes',
      aide: (a) => `${a} est une appli de la vie privée : ce widget reste fermé aux autres. Choisis à qui tu l'ouvres. Cela n'ouvre que ce widget, pas l'appli.`,
      sansDroit: (a) => `N'a pas le droit sur ${a} : le widget lui reste fermé.`,
      personne: 'Personne d\'autre que toi n\'a de compte. Ajoute une personne dans Persona.',
      dAbord: 'Appuie d\'abord sur « Terminé » pour ranger ce widget, puis ouvre-le à quelqu\'un.',
      fait: (n) => `✓ ${n} changements gardés.`, echec: 'la liste des personnes n\'a pas pu être lue',
    },
  };
  // Les calculs du glisser (appui long, rang d'insertion, défilement, « Annuler ») : pages/accueil-gestes.js, chargé avant.
  const OG = window.OdinGestes;
  // Les 12 animations de déplacement (lot 17) : pages/accueil-animations.js, chargé avant. Celle choisie joue quand un
  // module est déplacé ou agrandi ; avec « moins d'animations », rien ne bouge.
  const OA = window.OdinAnimations;
  // Le tiroir « Ajouter un widget » (lot 18) : ses textes, son style et ses calculs (familles, recherche, focus gardé)
  // sont dans pages/accueil-tiroir.js, chargé avant. Il est rempli par le catalogue d'Odin, rien n'y est écrit en dur.
  const OT = window.OdinTiroir;
  // Le dessin commun d'un widget et ses cinq états (lot 25a) : en-tête, lignes et boutons, tous leurs textes. Dans
  // pages/widgets-rendu.js, chargé avant (le même sert à l'écran de la maison).
  const R = window.OdinWidgetsRendu;
  const act = (module, action, input = {}, confirm) => api('/api/valhalla/act', { module, action, input, ...(confirm ? { confirm: true } : {}) });
  const css = `
#fenetre{margin:0 0 18px}.fe-bar{display:flex;gap:8px;align-items:center;margin:0 0 12px}.fe-bar .sp{flex:1}
.fe-tabs{display:flex;gap:8px;flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none;padding:3px;margin:-3px}.fe-tabs::-webkit-scrollbar{display:none}.fe-mod{flex:none}
.fe-tab{flex:none;white-space:nowrap;min-height:36px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 13.5px inherit;cursor:pointer}.fe-tab[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.fe-edit .fe-tab[aria-pressed=true]{background:#fff;color:#10363a}.fe-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;border-radius:16px;background:#10363a;color:#fff;margin:0 0 12px}
.fe-tools .fe-tab{background:rgba(255,255,255,.12);color:#fff;border-color:transparent}.fe-tools b{display:flex;gap:6px;align-items:center;margin:0 6px}.fe-tools .btn{min-height:36px}
.fe-wrap{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
${G.css('.fe-grid', '.fe-w')}.fe-grid{min-height:120px}.fe-w{container-type:inline-size}@container (max-width:130px){.fe-h{flex-wrap:wrap}.fe-h .fe-ic{display:none}}
.fe-w{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px 16px;min-width:0;box-shadow:0 10px 26px rgba(16,54,58,.08)}
.fe-w .va-kpi{padding:8px 10px}.fe-w .va-kpi b{font-size:20px}
.fe-w .va-sec{background:none;border:0;padding:0;margin:0}.fe-w .va-sec h2{display:none}.fe-w .va-kpis{margin:0;grid-template-columns:repeat(auto-fill,minmax(min(120px,100%),1fr))}
.fe-h{display:flex;gap:10px;align-items:center;margin:0 0 10px}
.fe-ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--field);font-weight:700;flex:none}.fe-ic-app{background:none}
.fe-open{flex:none;font-size:12.5px;color:var(--muted);background:none;border:0;cursor:pointer;min-height:44px;margin:-5px 0;padding:0 4px}
/* Lot 25b : hors du mode Modifier, un widget réagit au toucher (ce que « Régler » a choisi) ; une adresse est un vrai lien. */
#fenetre:not(.fe-edit) .fe-w.fe-touche{cursor:pointer}a.fe-open{display:inline-flex;align-items:center;text-decoration:none}a.fe-open:focus-visible,button.fe-open:focus-visible{outline:2px solid var(--accent,#0b7f7c);outline-offset:-2px;border-radius:8px}
/* Lot 25a : un état sans donnée, une ligne puis au plus un bouton. */
.fe-w>.fe-err{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin:0}
.fe-edit .fe-w{outline:2px dashed color-mix(in srgb,var(--accent,#0b7f7c) 55%,transparent);outline-offset:3px;touch-action:pan-y;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#fenetre .fe-h{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}@media (hover:hover){#fenetre:not(.fe-edit) .fe-h{cursor:grab}.fe-edit .fe-w{cursor:grab}}
body.fe-glisse,body.fe-glisse *{cursor:grabbing!important;-webkit-user-select:none!important;user-select:none!important}
.fe-chrome{display:none;position:absolute;top:-12px;right:-6px;gap:4px}.fe-edit .fe-chrome{display:flex}.fe-chrome button{width:30px;height:30px;border-radius:9px;border:1px solid var(--line);background:var(--panel);cursor:pointer;display:grid;place-items:center;font-size:14px}
.fe-grip{display:none;position:absolute;top:-12px;left:-6px;width:30px;height:30px;border-radius:9px;background:#10363a;color:#fff;border:0;cursor:grab;font-size:15px;touch-action:none}.fe-edit .fe-grip{display:grid;place-items:center}
.fe-rz{display:none}.fe-edit .fe-rz{display:block;position:absolute;right:0;bottom:0;width:44px;height:44px;z-index:5;cursor:nwse-resize;touch-action:none;border-radius:0 0 18px 0}
.fe-edit .fe-rz::before{content:"";position:absolute;right:10px;bottom:10px;width:14px;height:14px;border-right:3px solid var(--accent,#0b7f7c);border-bottom:3px solid var(--accent,#0b7f7c);border-radius:0 0 6px 0}
.fe-szb{display:none;position:absolute;right:46px;bottom:12px;z-index:5;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:7px;background:var(--accent,#0b7f7c);color:#fff;pointer-events:none;font-variant-numeric:tabular-nums}.fe-w.resizing .fe-szb{display:block}.fe-edit .fe-w.resizing{outline-style:solid}
/* Carte étroite (moins de 160 px) : boutons de 24 px et poignée en bas à gauche, rien ne se chevauche. */@container (max-width:125px){.fe-edit .fe-chrome{gap:2px}.fe-edit .fe-chrome button{width:24px;height:24px;border-radius:7px;font-size:12px}.fe-edit .fe-grip{top:auto;bottom:-12px}}
.fe-dit{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.fe-sizes{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px;margin:4px 0}.fe-form .fe-sizes label{display:flex;gap:8px;align-items:center;min-height:44px;margin:0;padding:0 10px;border:1px solid var(--line);border-radius:12px;font-weight:600;cursor:pointer}.fe-form .fe-sizes input{flex:none;width:18px;height:18px;min-height:0;margin:0;padding:0;accent-color:var(--accent,#0b7f7c)}.fe-sizes label:has(input:checked){border-color:var(--accent,#0b7f7c)}.fe-sizes small{color:var(--muted);font-weight:500;margin-left:auto;font-variant-numeric:tabular-nums}
/* Pendant le glisser : un cadre en pointillé à la place du module, une copie qui suit le pointeur. */
.fe-w.dragging{background:transparent;box-shadow:none;border:2px dashed color-mix(in srgb,var(--accent,#0b7f7c) 70%,transparent);outline:0}.fe-w.dragging>*{visibility:hidden}
.fe-ghost{position:fixed;left:0;top:0;margin:0;z-index:80;pointer-events:none;box-shadow:0 24px 60px rgba(16,54,58,.35);opacity:.95;will-change:transform;transition:none}
.fe-annuler{display:flex;gap:12px;align-items:center}.fe-annuler .btn{min-height:44px}
.fe-drop{border:2px dashed var(--line);border-radius:18px;min-height:90px;display:grid;place-items:center;color:var(--muted)}
.fe-form label{display:block;font-size:13px;font-weight:600;margin:8px 0 4px}.fe-form select,.fe-form input{width:100%;min-height:38px;border-radius:10px;border:1px solid var(--field);padding:0 10px;background:var(--panel)}
/* « Ouvrir à… » : une ligne de 44 px par personne, tout entière cliquable, avec son interrupteur. */
.fe-chrome .fe-ouvb{color:var(--ink)}.fe-chrome .fe-ouvb svg{width:16px;height:16px}
.fe-ouv-aide{margin:0 0 8px;font-size:13.5px;line-height:1.4;color:var(--muted)}
.fe-form label.fe-ouv{display:flex;align-items:center;gap:12px;min-height:44px;margin:0;padding:4px 0;font-size:14.5px;font-weight:600;cursor:pointer;border-top:1px solid var(--line)}
.fe-ouv-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;overflow-wrap:anywhere}.fe-ouv-t small{color:var(--muted);font-weight:400;font-size:12.5px}
.fe-form .fe-ouv input{-webkit-appearance:none;appearance:none;flex:none;position:relative;width:52px;height:30px;min-height:0;margin:0;padding:0;border-radius:999px;border:1px solid var(--muted);background:var(--field);cursor:pointer;transition:background .15s}
.fe-form .fe-ouv input::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:var(--ink);transition:transform .15s}
.fe-form .fe-ouv input:checked{background:var(--accent,#0b7f7c);border-color:var(--accent,#0b7f7c)}.fe-form .fe-ouv input:checked::after{transform:translateX(22px);background:var(--on-accent,#fff)}
.fe-form:has(.fe-ouv) .va-acts-bar .btn{min-height:44px}
.fe-form .fe-ouv input:focus-visible{outline:2px solid var(--accent,#0b7f7c);outline-offset:3px}
@media (prefers-reduced-motion:reduce){.fe-form .fe-ouv input,.fe-form .fe-ouv input::after{transition:none}}
.fe-btnw{display:flex;flex-direction:column;gap:8px}.fe-btnw .btn{min-height:46px;font-size:15px}
.fe-wx{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center}.fe-wx>div{min-width:0}.fe-wx b{font-size:34px}.fe-hours{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 10px;margin-top:10px;font-size:12.5px;color:var(--muted)}.fe-hours span{white-space:nowrap}
.fe-err{color:var(--muted);font-size:13.5px}
/* Lot 26 : « Tu veux sans doute », « À faire », « Ce qu'Odin a fait » en widgets. Leur contenu est posé par la page
   d'accueil (ui.html) dans .fe-auj ; ici, seulement sa place, et des cibles de 44 px au doigt comme au clavier. */
.fe-auj{min-width:0;display:flex;flex-direction:column;gap:8px}.fe-auj:empty::before{content:attr(data-attente);color:var(--muted);font-size:13.5px}
.fe-auj .auj-outils{display:flex;justify-content:flex-end}.fe-auj .ffilter button{min-height:44px;padding:0 14px}
.fe-auj .btn.small{min-height:44px}.fe-auj .gwrap .gx{width:44px;height:44px;top:0;right:0}.fe-auj .guess{padding-right:48px}
.fe-auj .titem a{display:inline-flex;align-items:center;min-height:44px}
/* Lot 27 : « Comment Odin se comporte ». Ses trois réglages côte à côte, l'un sous l'autre quand la carte est étroite ;
   plus de cadre autour de chacun (la carte du widget le porte) ; des boutons de 44 px. */
.fe-auj .ctrls{gap:12px 18px}.fe-auj .ctrl{border:0;border-radius:0;background:none;padding:0;box-shadow:none}
#fenetre .fe-auj .ctrl .seg button{min-height:44px;font-size:13.5px}#fenetre .fe-auj .ctrl .seg button:focus-visible{outline:2px solid var(--accent,#0b7f7c);outline-offset:-2px}
@container (max-width:640px){.fe-auj .ctrls{grid-template-columns:minmax(0,1fr)}}
/* En mode Modifier, ses boutons ne répondent pas (ils couvrent presque toute la carte : en voulant la prendre, on
   changeait l'autonomie d'Odin). La carte se prend alors par n'importe où ; « Terminé » leur rend la main. */
.fe-edit .fe-w[data-auj="comportement"] .fe-auj{pointer-events:none;opacity:.6}
/* Lot 27 : les cinq chiffres. Côte à côte quand la carte est large, deux par rangée quand elle est étroite. Chacun est
   un bouton, et ensemble ils couvrent presque toute la carte : en mode Modifier, ils ne répondent pas non plus (on prend
   la carte). Comme la maquette (choix du propriétaire) : chacun son icône, de sa teinte, sur un fond de sa teinte à 18 %,
   puis le chiffre et ce qu'il compte. Les teintes sont des couleurs du thème d'Odin (--good, --accent…), jamais écrites
   ici : elles suivent le clair, le sombre et le verre. L'icône est un masque : elle prend la couleur de sa teinte.
   Ailleurs (« État détaillé », un membre), pas d'icône : les chiffres restent comme avant. */
.kpi-ic{display:none}
.fe-auj .kpis{margin:0;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr))}
.fe-auj .kpi{--kc:var(--accent);display:grid;grid-template-columns:42px minmax(0,1fr);column-gap:12px;row-gap:1px;align-items:center;align-content:center;min-height:44px;padding:10px 12px}
.fe-auj .kpi .kpi-ic{display:grid;grid-row:1/3;width:42px;height:42px;border-radius:13px;background:color-mix(in srgb,var(--kc) 18%,transparent);color:var(--kc)}
.fe-auj .kpi .kpi-ic::before{content:"";margin:auto;width:22px;height:22px;background:currentColor;-webkit-mask:var(--ki) center/contain no-repeat;mask:var(--ki) center/contain no-repeat}
.fe-auj .kpi b{grid-column:2;align-self:end;font-size:21px;min-width:0;overflow-wrap:anywhere}.fe-auj .kpi span{grid-column:2;align-self:start;font-size:12px;line-height:1.3;min-width:0}
.kpi[data-ic="appareils"]{--kc:var(--good)}
.kpi[data-ic="missions"]{--kc:var(--accent)}
.kpi[data-ic="risques"]{--kc:var(--good)}
.kpi[data-ic="depenses"]{--kc:var(--warn)}
.kpi[data-ic="mode"]{--kc:var(--ink)}
.kpi.warn{--kc:var(--warn)}.kpi.bad{--kc:var(--bad)}
.kpi[data-ic="appareils"]{--ki:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='12' rx='2'/%3E%3Cpath d='M8 20h8M12 16v4'/%3E%3C/svg%3E")}
.kpi[data-ic="missions"]{--ki:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='8.5'/%3E%3Cpath d='M10 8.5l5 3.5-5 3.5z'/%3E%3C/svg%3E")}
.kpi[data-ic="risques"]{--ki:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'/%3E%3Cpath d='M12 8v5M12 16.5v.5'/%3E%3C/svg%3E")}
.kpi[data-ic="depenses"]{--ki:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='8.5'/%3E%3Cpath d='M14.5 9.5c-.5-1-1.4-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5'/%3E%3C/svg%3E")}
.kpi[data-ic="mode"]{--ki:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 7h9M17 7h3M4 17h3M11 17h9'/%3E%3Ccircle cx='15' cy='7' r='2'/%3E%3Ccircle cx='9' cy='17' r='2'/%3E%3C/svg%3E")}
.fe-auj .kpi:focus-visible{outline:2px solid var(--accent-texte,var(--accent));outline-offset:2px}
@container (max-width:420px){.fe-auj .kpis{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.fe-auj .kpis .kpi:last-child:nth-child(odd){grid-column:1/-1}}
.fe-edit .fe-w[data-auj="chiffres_cles"] .fe-auj{pointer-events:none;opacity:.6}
/* Lot 27 : les quatre tuiles d'état (surveillance, sauvegarde, résumé du matin, application), une par widget. Ce sont
   les mêmes cartes qu'avant, posées par la page d'accueil : leur titre et leur cadre sont ceux du widget, donc les leurs
   ne se voient plus ici (ailleurs, chez un membre, elles restent comme avant). Des cibles de 44 px. En mode Modifier,
   leurs boutons ne répondent pas : en voulant prendre la carte, on créait une routine ou on quittait l'accueil. */
#fenetre .fe-auj>.hcard{background:none;border:0;border-radius:0;padding:0;box-shadow:none;min-height:0}
#fenetre .fe-auj>.hcard>.hct{display:none}
.fe-auj .hcard select{min-height:44px}.fe-auj .hcard summary{display:flex;align-items:center;min-height:44px}
/* Un long chemin de disque (Surveillance) passe à la ligne au lieu de sortir de la carte. */
.fe-auj .hcard .hrow>span{min-width:0;overflow-wrap:anywhere}.fe-auj .hcard .hrow>b{flex:none;white-space:nowrap}
.fe-edit .fe-w[data-auj="surveillance"] .fe-auj,.fe-edit .fe-w[data-auj="sauvegarde"] .fe-auj,.fe-edit .fe-w[data-auj="resume_matin"] .fe-auj,.fe-edit .fe-w[data-auj="application"] .fe-auj{pointer-events:none;opacity:.6}
/* Sur une tablette, trois colonnes sur douze sont trop étroites pour une tuile (le titre se coupait) : six au moins,
   deux par rangée, comme la grille d'avant qui n'en mettait pas quatre de front. L'en-tête porte l'icône en trait de la
   tuile d'avant (posée par la page d'accueil), à la couleur du thème. */
@media (min-width:${G.GRILLE.telephone + 1}px) and (max-width:${G.GRILLE.ordinateur - 0.02}px){.fe-grid>.fe-w[data-auj="surveillance"],.fe-grid>.fe-w[data-auj="sauvegarde"],.fe-grid>.fe-w[data-auj="resume_matin"],.fe-grid>.fe-w[data-auj="application"]{grid-column:span max(var(--c,4),6)}}
.fe-w[data-auj] .fe-h>.fe-ic svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;color:var(--accent-texte,var(--accent))}
.fe-w[data-auj]:focus{outline:0}.fe-w[data-auj]:focus-visible{outline:2px solid var(--accent,#0b7f7c);outline-offset:3px}
.fe-clock{display:flex;flex-direction:column;gap:2px}.fe-clock-h{font-size:clamp(22px,24cqi,38px);line-height:1.1;font-variant-numeric:tabular-nums}.fe-clock-d{font-size:15px}.fe-clock-d::first-letter{text-transform:uppercase}.fe-clock small{color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}
.fe-site{display:flex;flex-direction:column;gap:3px;padding-left:12px;border-left:4px solid var(--line)}.fe-site b{font-size:20px}.fe-site small{color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}.fe-site.bon{border-color:var(--good)}.fe-site.mauvais{border-color:var(--bad)}.fe-site.attention{border-color:var(--warn)}
/* L'accueil en plein écran (lot 22a) : seulement les widgets, pour un écran au mur. Le bandeau, les onglets, les blocs du
   jour disparaissent (le menu et la barre du bas sont déjà sous l'accueil posé par-dessus) ; le mode Modifier garde sa barre.
   On sort par Échap ou par le rond discret en haut à droite (44 px). La mascotte n'est pas touchée. */
#v-home.pe-plein>#homeBandeau,#v-home.pe-plein #vaultBanner,#v-home.pe-plein #todayBox,#v-home.pe-plein #homeGrid,#v-home.pe-plein #fenetre>.fe-bar{display:none!important}
/* Lot 27 : « Comment Odin se comporte » était caché en plein écran (il était sous la fenêtre) ; widget, il le reste : un
   écran au mur ne laisse pas changer la conduite d'Odin. En mode Modifier, il se voit (pour le déplacer ou le retirer). */
#v-home.pe-plein #fenetre:not(.fe-edit) .fe-w[data-auj="comportement"]{display:none!important}
/* Lot 27 : les cinq chiffres étaient cachés en plein écran (dans « État détaillé », sous la fenêtre) ; widget, ils le
   restent : un écran au mur ne montre ni les dépenses ni le mode d'Odin. En mode Modifier, ils se voient. */
#v-home.pe-plein #fenetre:not(.fe-edit) .fe-w[data-auj="chiffres_cles"]{display:none!important}
/* Lot 27 : les quatre tuiles d'état étaient cachées en plein écran (dans « État détaillé ») ; widgets, elles le restent :
   un écran au mur ne règle ni la sauvegarde, ni les routines, ni cet appareil. En mode Modifier, elles se voient. */
#v-home.pe-plein #fenetre:not(.fe-edit) .fe-w[data-auj="surveillance"],#v-home.pe-plein #fenetre:not(.fe-edit) .fe-w[data-auj="sauvegarde"],#v-home.pe-plein #fenetre:not(.fe-edit) .fe-w[data-auj="resume_matin"],#v-home.pe-plein #fenetre:not(.fe-edit) .fe-w[data-auj="application"]{display:none!important}
#v-home.pe-plein>.body{padding:66px 16px calc(24px + env(safe-area-inset-bottom))}#v-home.pe-plein #fenetre{margin:0}
@media (min-width:900px){#v-home.pe-plein>.body{padding:66px 28px 28px}}
.fe-sortie{display:none}
#v-home.pe-plein>.fe-sortie{display:grid;place-items:center;position:fixed;top:calc(10px + env(safe-area-inset-top));right:10px;z-index:41;width:44px;height:44px;padding:0;border-radius:50%;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;opacity:.45;transition:opacity .3s}
#v-home.pe-plein>.fe-sortie:hover,#v-home.pe-plein>.fe-sortie:focus-visible{opacity:1}#v-home.pe-plein>.fe-sortie:focus-visible{outline:2px solid var(--accent,#0b7f7c);outline-offset:2px}
.fe-sortie svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}
@media (prefers-reduced-motion:reduce){.fe-sortie{transition:none}}`;
  document.head.append(el('style', {}, css + OA.CSS + OT.CSS));

  let L = null, cur = 0, edit = false, saved = '', cat = null, views = new Map(), timer = 0, dessin = { cur: -1, edit: false };
  // Les états des widgets rendus par le serveur (lot 25a) à qui regarde, et « est-ce le propriétaire ? » : le serveur
  // le dit (`qui`). Un membre reçoit les siens par la même route (ses droits d'appli, et ce que le propriétaire lui a
  // ouvert de la vie privée) ; sans session : 401.
  let etats = null, proprio = false, pasProprio = false;
  const host = () => $('#fenetre');
  const page = () => L.pages[Math.min(cur, L.pages.length - 1)];
  /** Le nom d'une page : celui que le propriétaire lui a donné ; une page rangée sous un code prend sinon le nom de son code. */
  const nomDe = (p) => p?.name || TXT.pages[p?.code] || '';
  const modName = (id) => cat?.modules?.find((m) => m.id === id)?.name ?? id;
  const modFam = (id) => cat?.modules?.find((m) => m.id === id)?.family ?? '';
  /** Le nom d'une appli que le catalogue de qui regarde connaît ; une appli retirée ou inconnue : rien (jamais son identifiant). */
  const nomConnu = (id) => (id ? cat?.modules?.find((m) => m.id === id)?.name ?? '' : '');
  /**
   * Le widget que pose la ligne d'une appli dans « Ajouter un widget » (ou glissée) : le widget « appli » de cette appli,
   * à la taille que sa famille a déclarée (pages/widgets-applis.js). Sans cette famille : ses chiffres clés, comme avant.
   */
  const widgetDeLAppli = (id) => { const rf = R.rendu('appli'); return rf ? { ...rf.w, module: id } : { kind: 'chiffres', module: id }; };

  async function load() {
    const [f, c] = await Promise.all([act('gladsheim', 'fenetre'), cat ? Promise.resolve(cat) : api('/api/valhalla/catalog')]);
    cat = c; if (!f.ok) throw new Error(f.text || f.error || 'fenêtre indisponible');
    L = f.data; saved = JSON.stringify(L); if ('animation' in L) OA.regler(L.animation, true); try { cur = Math.min(Number(localStorage.getItem('odin.fenetre.page') || 0), L.pages.length - 1); } catch { cur = 0; }
  }
  /** Les vues des applis de la page (une fois chacune). */
  async function fetchViews() {
    // D'abord « est-ce le propriétaire ? » (le serveur le dit), puis les vues. Rien n'est demandé pour un widget fermé à
    // qui regarde (lot 25a) : une appli qui n'est pas à lui, ou, pour tout autre que le propriétaire, une appli de la
    // vie privée (sa réponse b à la question 15) — la donnée n'arrive pas dans son navigateur.
    await lireEtats();
    // Un membre : tout ce que ses widgets montrent vient de la route des widgets (vueDe) ; jamais la vue d'une appli.
    if (!proprio) return;
    const ids = [...new Set(page().widgets.filter((w) => w.module && w.kind !== 'bouton' && !ferme(w)).map((w) => w.module))];
    await Promise.all([...ids.map(async (id) => { try { const r = await api(`/api/valhalla/view?id=${encodeURIComponent(id)}`); if (r.ok) views.set(id, r.view); } catch { /* hors ligne */ } })]);
  }
  /** Ce qu'un widget montre (sa sorte, son appli, sa partie…) : un état reçu pour un autre réglage ne compte plus. */
  const sigDe = (w) => (w ? [w.kind, w.module, w.section, w.label, w.action].join('\u0001') : '');
  /**
   * Les cinq états des widgets de la page, rendus par le serveur (la seule fonction « la donnée d'un widget ») : au
   * propriétaire, et à un membre (les siens : un widget « vie privée » lui reste fermé tant que le propriétaire ne le
   * lui a pas ouvert). Refusé (401) : la page dessine ce qu'elle sait voir, tout fermé par prudence. Hors ligne : on garde.
   */
  async function lireEtats() {
    const p = page();
    if (pasProprio) return; // déjà refusé : la session ne change pas sans recharger la page
    try {
      const r = await fetch(`/api/widgets/donnees${p.id ? `?page=${encodeURIComponent(p.id)}` : ''}`, { headers: { 'x-odin': '1' }, credentials: 'same-origin' });
      if (r.status === 401 || r.status === 403) { proprio = false; etats = null; pasProprio = true; return; }
      const j = await r.json(); if (!r.ok || !j?.ok || !Array.isArray(j.widgets)) return;
      const tous = L.pages.flatMap((x) => x.widgets);
      proprio = j.qui === 'proprietaire'; etats = new Map(j.widgets.map((x) => [x.id, { e: x, sig: sigDe(tous.find((w) => w.id === x.id)) }]));
    } catch { /* hors ligne : les derniers états restent */ }
  }
  /**
   * Le rendu que le fichier de sa famille a déclaré pour ce widget (pages/widgets-<famille>.js, registre commun de
   * pages/widgets-rendu.js) : son titre, sa phrase du tiroir, son symbole, l'appli qu'il lit, et la fonction qui dessine
   * son corps. Rien : la fenêtre garde son dessin d'aujourd'hui. Une sorte neuve s'ajoute là-bas, plus ici.
   */
  const renduDe = (w) => (w ? R.rendu(w.kind, w.style) : undefined);
  /** L'appli que lit un widget (l'heure et la météo : Hestia ; une sorte déclarée : celle que dit son rendu). */
  const appliDe = (w) => w.module || (w.kind === 'heure' || w.kind === 'meteo' ? 'gladsheim' : renduDe(w)?.appli || '');
  /** Qui regarde a-t-il le droit sur cette appli ? Son catalogue est déjà réduit à ses droits ; sans catalogue : non. */
  const aDroit = (id) => Array.isArray(cat?.modules) && cat.modules.some((m) => m.id === id);
  /**
   * L'état d'un widget : celui du serveur s'il décrit ce réglage-là (pour le propriétaire comme pour un membre : c'est
   * le serveur qui sait ce qui lui est ouvert). Sans état du serveur, pour tout autre que le propriétaire : fermé si
   * l'appli n'est pas à lui, ou si elle est de la vie privée (sa réponse b à la question 15). Pour le propriétaire (un
   * widget pas encore rangé) : fermé seulement si l'appli n'est plus là.
   * Tant que le serveur n'a pas dit « c'est le propriétaire », la page fait comme pour un membre (le plus sûr).
   */
  function etatDe(w) {
    const s = etats?.get(w.id); if (s && s.sig === sigDe(w)) return s.e;
    const a = appliDe(w);
    if (!proprio) return R.etatSansProprio(a ? [a] : [], aDroit);
    return a && Array.isArray(cat?.modules) && !aDroit(a) ? { etat: 'refuse', raison: 'appli_fermee' } : undefined;
  }
  /**
   * La vue d'appli dont un widget tire ce qu'il montre. Le propriétaire : la vue de l'appli. Un membre : seulement ce
   * que le serveur a rendu pour CE widget (ses chiffres, sa partie de page, sa sonde), remis sous la forme d'une vue ;
   * rien d'autre de l'appli n'arrive dans son navigateur.
   */
  function vueDe(w) {
    if (proprio) return views.get(w.module);
    const s = etats?.get(w.id), d = s?.e?.donnee;
    if (!s || s.sig !== sigDe(w) || !d || (s.e.etat !== 'ok' && s.e.etat !== 'ancien')) return undefined;
    if (w.kind === 'chiffres') return { kpis: Array.isArray(d.kpis) ? d.kpis : [], sections: [] };
    if (w.kind === 'section') return { sections: d.section ? [d.section] : [] };
    if (w.kind === 'site') return { sections: [{ kind: 'table', title: 'Sondes', rows: [{ cells: [w.label, '', '', d.etat ?? '', d.jour ?? '', d.mois ?? '', d.temps ?? ''], tone: d.tone }] }] };
    return undefined;
  }
  /** Les blocs du jour devenus widgets (lots 26 et 27) : leur contenu est posé par la page d'accueil, pas lu ici. */
  const JOUR = ['tu_veux', 'a_faire', 'odin_a_fait', 'comportement', 'chiffres_cles', 'surveillance', 'sauvegarde', 'resume_matin', 'application'];
  /**
   * Leur largeur quand on les repose depuis le tiroir : la moitié (comme au lot 26) ; les trois réglages et les cinq
   * chiffres, toute la largeur ; les quatre tuiles d'état, trois colonnes (comme au départ).
   */
  const LARGEUR_JOUR = { tu_veux: 6, a_faire: 6, odin_a_fait: 6, comportement: 12, chiffres_cles: 12, surveillance: 3, sauvegarde: 3, resume_matin: 3, application: 3 };
  /**
   * Ceux dont les boutons couvrent presque toute la carte, ou font un geste qu'on ne veut pas faire en voulant la prendre
   * (créer une routine, quitter l'accueil) : en mode Modifier, ils ne répondent pas (on prend la carte).
   */
  const INERTES_EN_MODIFIER = ['comportement', 'chiffres_cles', 'surveillance', 'sauvegarde', 'resume_matin', 'application'];
  /** La carte d'un bloc du jour sur la page ouverte, et la place de son contenu. */
  const carteJour = (k) => host()?.querySelector(`#feGrid > .fe-w[data-auj="${k}"]`) ?? null;
  /**
   * Ce que la fenêtre tient des blocs du jour, pour la page d'accueil (ui.html) : rien (`null`) tant qu'elle ne porte
   * pas « À faire » (pas encore lue, ou servie à un membre : les blocs restent alors à leur ancienne place). Sinon :
   * `hote(k)` : la place du contenu de ce bloc sur la page ouverte (ou rien s'il est sur une autre page, ou retiré) ;
   * `montrer(k)` : ouvre la page qui porte ce bloc et rend sa carte (pas en plein glisser ; rien si le bloc est retiré).
   */
  function aujourdhui() {
    if (!L || !L.pages.some((p) => p.widgets.some((w) => w.kind === 'a_faire'))) return null;
    return {
      hote: (k) => carteJour(k)?.querySelector('.fe-auj') ?? null,
      montrer: async (k) => {
        const i = L.pages.findIndex((p) => p.widgets.some((w) => w.kind === k)); if (i < 0) return null;
        if (i !== Math.min(cur, L.pages.length - 1) && !glisse && !appuiEnCours) { cur = i; try { localStorage.setItem('odin.fenetre.page', String(i)); } catch { /* */ } await fetchViews(); await draw(); }
        return carteJour(k);
      },
    };
  }
  /** Ce widget est-il fermé à qui regarde ? (rien n'est alors lu ni demandé pour lui) */
  const ferme = (w) => etatDe(w)?.etat === 'refuse';
  /** Le titre d'un widget, pris dans la fenêtre (jamais lu chez une appli fermée à qui regarde). */
  function titreDe(w, clos) {
    if (w.label) return w.label;
    if (w.kind === 'section' && w.section) return w.section;
    if (w.kind === 'bouton' && w.action) return w.action;
    // Une sorte déclarée dont l'appli se choisit (le widget « appli ») : le nom de son appli ; retirée, inconnue ou
    // fermée à qui regarde : le titre neutre de la sorte.
    if (w.module && renduDe(w) && !renduDe(w).appli) return (!clos && nomConnu(w.module)) || renduDe(w).titre;
    const rf = renduDe(w); if (rf) return rf.titre;
    if (TXT.titres[w.kind]) return TXT.titres[w.kind];
    return !clos && cat?.modules?.some((m) => m.id === w.module) ? modName(w.module) : TXT.titres.sansTitre;
  }
  /** Ce que le bouton d'un état sait faire ici ; sans cela, pas de bouton (jamais un bouton mort). */
  const AGIR = {
    appli_absente: (w) => { location.hash = `#app=${appliDe(w)}`; },
    appli_muette: () => { views.clear(); fetchViews().then(draw); },
    lecture_echouee: () => { views.clear(); fetchViews().then(draw); },
    lieu_non_choisi: () => { location.hash = '#app=gladsheim'; },
    partie_introuvable: (w) => regler(w), partie_non_choisie: (w) => regler(w),
  };
  const peutAgir = (w, r) => Object.hasOwn(AGIR, r) && (r.startsWith('partie_') ? w.kind === 'section' || w.kind === 'chiffres' : true);
  /**
   * « ⋯ » (le propriétaire) : la fenêtre « Régler » de la maquette (lot 25b) — titre, taille, style, « Quand je touche
   * le widget », « Copier vers l'autre écran », « Retirer » — dans le mode Modifier : rien n'est gardé avant « Terminé ».
   */
  let reglage = false; // une seule fenêtre « Régler » à la fois (deux appuis coup sur coup sur « ⋯ » n'en ouvrent pas deux)
  async function regler(w) {
    if (!proprio || ferme(w)) return; // fermé à qui regarde : rien n'est lu chez l'appli, même pour le régler
    if (reglage || $('dialog.wr-regler')) return;
    reglage = true;
    try { if (!edit) { edit = true; await draw(); } await reglerWidget(w); } finally { reglage = false; }
  }
  let meteoVue = null; // la dernière météo reçue, remontrée (marquée ancienne) quand Internet est coupé
  async function weather() { try { const r = await act('gladsheim', 'meteo', {}); if (r.ok && r.data) { meteoVue = r.data; return r.data; } return null; } catch { return null; } }
  // Météo absente : distinguer « pas d'Internet » (on remontre la dernière, marquée ancienne) de « ville non réglée ».
  function meteoRepli() {
    if (window.OdinReseau && !window.OdinReseau.enLigne() && window.OdinHorsLigne) {
      const net = window.OdinReseau.etat(), v = meteoVue;
      return window.OdinHorsLigne.message({ quoi: 'La météo n\'a pas pu être mise à jour', hote: 'api.open-meteo.com', depuis: net && net.depuis,
        ancien: v ? `${Math.round(v.temp ?? v.now?.temp ?? 0)}° ${v.text ?? v.now?.text ?? ''}${v.place || v.ville ? ` · ${v.place ?? v.ville}` : ''}`.trim() : undefined, onReessayer: () => draw() });
    }
    return el('p', { class: 'fe-err' }, ...R.contenu(R.decrire({ etat: 'vide', raison: 'meteo_pas_lue' }, {})));
  }
  /** Le lieu d'Odin (village, fuseau, heure sur 12 ou 24 h) : gardé une minute. */
  let lieuVu = null, lieuAt = 0;
  async function lieu() {
    if (lieuVu && Date.now() - lieuAt < 60_000) return lieuVu;
    try { const r = await act('gladsheim', 'region_actuelle', {}); if (r.ok && r.data) { lieuVu = { nom: r.data.ville, fuseau: r.data.fuseau, h12: r.data.region?.heure === '12h', suppose: r.data.suppose }; lieuAt = Date.now(); } } catch { /* hors ligne : dernier lieu connu */ }
    return lieuVu;
  }
  /** L'heure et la date dans le fuseau d'Odin (pas celui de l'appareil) ; rafraîchies toutes les 10 secondes. */
  const heureDe = (l, d = new Date()) => { const o = l?.fuseau ? { timeZone: l.fuseau } : {}; try { return [d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: Boolean(l?.h12), ...o }), d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', ...o })]; } catch { return [d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })]; } };
  function horloge(l) {
    const h = el('b', { class: 'fe-clock-h' }), j = el('div', { class: 'fe-clock-d' }), box = el('div', { class: 'fe-clock' }, h, j, el('small', {}, `${l?.nom || 'Lieu non réglé'}${l?.fuseau ? ` · ${l.fuseau}` : ''}${l?.suppose ? ' · supposé' : ''}`));
    const maj = () => { if (!box.isConnected && box.dataset.vu) return clearInterval(t); box.dataset.vu = '1'; [h.textContent, j.textContent] = heureDe(l); };
    const t = setInterval(maj, 10_000); maj();
    return box;
  }

  // ------------------------------------------------------------------ dessin d'un module
  async function widget(w) {
    const box = el('article', { class: 'fe-w', 'data-id': w.id, style: G.style(w) });
    const grip = el('button', { class: 'fe-grip', type: 'button', title: TXT.poignee, 'aria-label': 'Déplacer ce module', onkeydown: (e) => { if (e.shiftKey) { if (tailleClavier(w, e.key, box)) e.preventDefault(); return; } if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { move(w.id, -1); e.preventDefault(); } if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { move(w.id, 1); e.preventDefault(); } } }, '⠿');
    grip.addEventListener('pointerdown', (e) => startDrag(e, box, w.id));
    // Attraper la carte elle-même (lot 16) : à la souris, son en-tête ou son vide (tout, en mode Modifier) ; au doigt, un appui long.
    box.addEventListener('pointerdown', (e) => attraper(e, box, w.id));
    const chrome = el('div', { class: 'fe-chrome' },
      el('button', { type: 'button', title: 'Taille (4, 8 ou 12 colonnes sur 12)', 'aria-label': 'Changer la taille', onclick: () => { w.w = G.agrandir(w); draw(); } }, '↔'),
      el('button', { type: 'button', title: TXT.boutonTailles, 'aria-label': TXT.boutonTailles, onclick: () => tailles(w) }, '⤡'),
      w.kind === 'section' || w.kind === 'chiffres' ? el('button', { type: 'button', title: 'Choisir ce qu\'il montre', 'aria-label': 'Réglages du module', onclick: () => configure(w) }, '⚙') : null,
      boutonOuvrirA(w),
      // « À faire » se déplace mais ne se retire pas (constat M11) : pas de « ✕ » sur lui.
      R.retirable(w.kind) ? el('button', { type: 'button', title: 'Retirer', 'aria-label': 'Retirer ce module', onclick: () => { page().widgets = page().widgets.filter((x) => x.id !== w.id); draw(); } }, '✕') : null);
    // Le coin (44 px) : tiré à la souris ou au doigt, la taille saute de case en case ; caché aux lecteurs d'écran
    // (au clavier : Maj + flèches sur la poignée). L'étiquette « c × r » se montre pendant le geste.
    const rz = el('span', { class: 'fe-rz', 'aria-hidden': 'true' }), szb = el('b', { class: 'fe-szb', 'aria-hidden': 'true' });
    rz.addEventListener('pointerdown', (e) => startResize(e, box, w, szb));
    box.append(grip, chrome, rz, szb);
    // L'état du widget (lot 25a) : celui du serveur pour le propriétaire, sinon ce que la page sait voir. Refusé : le
    // titre de la fenêtre et la tuile grisée, une ligne, jamais la donnée ni un bouton ; ancien : la pastille.
    const d = R.decrire(etatDe(w) ?? { etat: 'ok' }, { proprio, appli: nomConnu(appliDe(w)), titre: titreDe(w), maintenant: Date.now(), peutAgir: (r) => peutAgir(w, r),
      vide: [...(vueDe(w)?.sections ?? []), ...(vueDe(w)?.side ?? [])].find((x) => x.title === w.section)?.empty });
    // L'en-tête de la maquette : la tuile de l'appli (comme sur la page Applis), sinon un symbole ; le titre, le
    // sous-titre ; « Ouvrir › » ; « ⋯ » pour le propriétaire.
    const tuileDe = (mod) => { if (!mod || !window.OdinAppIcons) return null; const sp = el('span', {}); sp.innerHTML = window.OdinAppIcons.tile(mod, modName(mod), 34); return sp.firstElementChild ?? sp; };
    // Le rendu que le fichier de sa famille a déclaré pour ce widget, s'il y en a un (plus bas : c'est lui qui dessine le corps).
    const rf = renduDe(w);
    const head = (title, small, icon, mod = w.module) => R.entete({ classe: 'fe-h', classeTuile: 'fe-ic', tuile: tuileDe(mod), lettre: icon, titre: title, sous: d.gris ? '' : small, pastille: d.pastille, gris: d.gris,
      regler: proprio && d.reglage ? () => regler(w) : null,
      extra: [d.gris ? null : boutonToucher(w, w.module ? el('button', { class: 'fe-open', type: 'button', onclick: () => { location.hash = `#app=${w.module}`; } }, 'Ouvrir ›') : null)] });
    // Lot 25b : toucher la carte (pas l'un de ses boutons) fait ce que « Régler » a choisi. Fermée à qui regarde : rien.
    if (!d.gris && R.toucherDe(w).quoi !== 'rien') { box.classList.add('fe-touche'); box.addEventListener('click', (e) => auToucher(e, box, w)); }
    const agirIci = (r) => AGIR[r]?.(w);
    // Une sorte dessinée par le rendu de sa famille (pages/widgets-<famille>.js). L'en-tête, les cinq états, « ⋯ » et
    // « Régler » sont ceux de tous ; la famille dessine le corps, à partir de l'état que le serveur a rendu pour CE
    // réglage, et de rien d'autre. Sans cet état (ou si son dessin échoue), rien n'est affirmé : en mode Modifier, le
    // widget n'est pas encore rangé ; sinon, la lecture n'a pas répondu. Un petit chiffre garde sa taille dans chaque
    // état : ni en-tête, ni « ⋯ », ni bouton ; sans donnée, son état court (l'icône de l'état, deux ou trois mots).
    if (rf) {
      const s = etats?.get(w.id), e = s && s.sig === sigDe(w) ? s.e : undefined, nomAppli = nomConnu(appliDe(w));
      const o = { w, titre: titreDe(w), nomAppli, pastille: d.pastille, ecran: 'accueil' };
      const corps = e && R.dessineElleMeme(rf, d) ? R.dessiner(rf, e, o) : null;
      const dd = corps || !d.donnee ? d : R.decrire(edit && !e ? { etat: 'vide', raison: 'pas_range' } : { etat: 'source_absente', raison: 'lecture_echouee' }, { proprio, appli: nomAppli, titre: o.titre, peutAgir: (r) => peutAgir(w, r) });
      if (rf.petit) { box.append(corps ?? R.etatPetit(dd, { titre: titreDe(w, d.gris) })); return box; }
      box.append(head(titreDe(w, d.gris), [nomAppli, corps ? R.sous(rf, e, o) : ''].filter(Boolean).join(' · '), rf.symbole, appliDe(w)), corps ?? el('p', { class: 'fe-err' }, ...R.contenu(dd, agirIci)));
      return box;
    }
    // Un état sans donnée (vide, source absente, refusé) : l'en-tête, puis sa ligne et au plus un bouton.
    if (!d.donnee) {
      const sous = w.kind === 'site' ? TXT.sousSite : w.kind === 'heure' || w.kind === 'meteo' ? modName('gladsheim') : modName(w.module);
      box.append(head(titreDe(w, d.gris), sous, w.kind === 'heure' ? '🕒' : w.kind === 'meteo' ? '☀' : w.kind === 'bouton' ? '⚡' : undefined, appliDe(w)), el('p', { class: 'fe-err' }, ...R.contenu(d, agirIci)));
      return box;
    }
    // Lots 26 et 27 : « Tu veux sans doute », « À faire », « Ce qu'Odin a fait », « Comment Odin se comporte », les cinq
    // chiffres. Leur donnée est dans l'état de la page du propriétaire (les validations, les propositions, le fil du jour,
    // ses réglages du moment, ce qu'elle en compte) : la page d'accueil la pose dans .fe-auj après chaque dessin
    // (événement « odin:fenetre »). La carte peut recevoir le focus (la cloche y mène).
    if (JOUR.includes(w.kind)) {
      box.dataset.auj = w.kind; box.tabIndex = -1; box.setAttribute('aria-label', titreDe(w));
      const corps = el('div', { class: 'fe-auj', 'data-auj': w.kind, 'data-attente': TXT.jour.attente });
      // « Comment Odin se comporte », les cinq chiffres et les quatre tuiles en mode Modifier : ni clic, ni doigt, ni
      // clavier sur leurs boutons (voir le style).
      if (edit && INERTES_EN_MODIFIER.includes(w.kind)) corps.inert = true;
      box.append(head(titreDe(w), TXT.jour.sous, TXT.jour.lettres[w.kind], ''), corps);
      return box;
    }
    /** La ligne (et le bouton) d'un état vu ici, sans le serveur : son code, comme le serveur le dirait. */
    const contenuDe = (etat, raison, vide) => R.contenu(R.decrire({ etat, raison }, { proprio, appli: modName(appliDe(w)), titre: titreDe(w), vide, peutAgir: (r) => peutAgir(w, r) }), agirIci);
    if (w.kind === 'meteo') {
      const d = await weather();
      box.append(head(w.label || TXT.titres.meteo, 'Hestia', '☀', 'gladsheim'), d ? el('div', {}, el('div', { class: 'fe-wx' }, el('b', {}, `${Math.round(d.temp ?? d.now?.temp ?? 0)}°`), el('div', {}, el('div', {}, d.text ?? d.now?.text ?? ''), el('small', { class: 'sub' }, d.place ?? d.ville ?? ''))),
        Array.isArray(d.hours) && d.hours.length ? el('div', { class: 'fe-hours' }, ...d.hours.slice(0, 5).map((h) => { const at = typeof h.t === 'string' ? h.t.replace(':00', ' h').replace(':', ' h ') : `${h.h ?? h.hour ?? ''} h`, t = Number(h.temp ?? h.t); return el('span', {}, Number.isFinite(t) ? `${at} · ${Math.round(t)}°` : at); })) : null) : meteoRepli());
      return box;
    }
    if (w.kind === 'heure') { box.append(head(w.label || TXT.titres.heure, 'Hestia', '🕒', 'gladsheim'), horloge(await lieu())); return box; }
    if (w.kind === 'site') {
      // Un site surveillé : la sonde de Pulsar qui porte ce nom (état, temps de réponse, disponibilité).
      const r = ((proprio ? views.get('vordr') : vueDe(w))?.sections ?? []).find((x) => x.kind === 'table' && x.title === 'Sondes')?.rows?.find((x) => x.cells[0] === w.label);
      box.append(head(w.label, TXT.sousSite, '🌐', 'vordr'), r
        ? el('div', { class: `fe-site ${r.tone || ''}` }, el('b', {}, r.cells[3] || '—'), el('small', {}, [r.cells[2], r.cells[6]].filter(Boolean).join(' · ')), el('small', {}, `24 h : ${r.cells[4] || '—'} · 30 jours : ${r.cells[5] || '—'}`))
        : el('p', { class: 'fe-err' }, ...contenuDe('vide', 'site_introuvable')));
      return box;
    }
    if (w.kind === 'bouton') {
      box.append(head(w.label || w.action, modName(w.module), '⚡'), el('div', { class: 'fe-btnw' }, el('button', { class: 'btn primary', type: 'button', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { let r = await act(w.module, w.action, w.input || {}); if (r.confirm) r = (await window.OdinDialog.confirm(r.confirm, { danger: true })) ? await act(w.module, w.action, w.input || {}, true) : { ok: true, text: 'Annulé.' }; say(r.ok ? r.text : `✗ ${r.text ?? r.error}`); }
        finally { b.disabled = false; }
      } }, w.label || w.action)));
      return box;
    }
    // Une sorte que cette page ne sait pas dessiner (ni elle, ni un fichier de famille) : sa carte le dit, la page continue.
    if (w.kind !== 'chiffres' && w.kind !== 'section') { box.append(head(titreDe(w), ''), el('p', { class: 'fe-err' }, ...contenuDe('source_absente', 'pas_encore_lu'))); return box; }
    const v = vueDe(w);
    box.append(head(titreDe(w), `${modName(w.module)}${modFam(w.module) ? ` · ${modFam(w.module)}` : ''}`));
    if (!v) { box.append(el('p', { class: 'fe-err' }, ...contenuDe('source_absente', 'appli_muette'))); return box; }
    if (w.kind === 'chiffres') {
      // Que des zéros, des tirets ou des mots : rien de mesuré (comme le serveur) ; jamais un chiffre inventé.
      const kpis = v.kpis?.some((k) => R.porteUneMesure(k.value)) ? v.kpis : [];
      const rien = () => el('p', { class: 'fe-err' }, ...contenuDe('vide', 'rien_mesure'));
      box.append(v.kpis?.length ? (kpis.length ? el('div', { class: 'va-kpis' }, ...kpis.slice(0, w.w * 2 + 1).map((k) => el('div', { class: `va-kpi ${k.tone ?? ''}`, title: k.hint ?? '' }, el('small', {}, k.label), el('b', {}, k.value), typeof k.pct === 'number' ? el('div', { class: 'va-bar' }, el('i', { style: `width:${Math.max(0, Math.min(100, k.pct))}%` })) : null))) : rien())
        : el('p', { class: 'fe-err' }, ...contenuDe('vide', 'rien_mesure')));
      return box;
    }
    const s = [...(v.sections ?? []), ...(v.side ?? [])].find((x) => x.title === w.section);
    box.append(s && window.OdinApps?.section ? window.OdinApps.section(w.module, s) : el('p', { class: 'fe-err' }, ...contenuDe('vide', 'partie_introuvable')));
    return box;
  }
  function say(t) { const n = el('div', { class: 'va-out', role: 'status', style: 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:96;max-width:min(560px,calc(100% - 32px))' }, t); document.body.append(n); setTimeout(() => n.remove(), 5000); }

  // ------------------------------------------------------------------ la page
  async function draw() {
    const h = host(); if (!h || !L) return;
    // Le focus du clavier survit au nouveau dessin : le même bouton du même module (« Taille », « ⚙ »…), s'il est encore là.
    const actif = document.activeElement, carteActive = actif?.closest?.('#feGrid .fe-w')?.dataset.id, nomActif = actif?.getAttribute?.('aria-label');
    // La même page, dans le même mode : les modules qui changent de place ou de taille glissent avec l'animation choisie.
    const memeVue = Boolean(h.querySelector('#feGrid')) && dessin.cur === cur && dessin.edit === edit;
    h.classList.toggle('fe-edit', edit);
    const tabs = L.pages.map((p, i) => el('button', { class: 'fe-tab', type: 'button', 'aria-pressed': String(i === cur), onclick: async () => { cur = i; try { localStorage.setItem('odin.fenetre.page', String(i)); } catch { /* */ } await fetchViews(); draw(); }, ondblclick: () => edit && rename(i) }, p.name || nomDe(p), p.maison ? ' 🏠' : ''));
    const bar = edit
      ? el('div', { class: 'fe-tools', role: 'toolbar', 'aria-label': 'Modifier la fenêtre' }, el('b', {}, '✎ Modifier'), ...tabs,
        el('button', { class: 'fe-tab', type: 'button', title: 'Ajouter une page', 'aria-label': 'Ajouter une page', onclick: async () => { const n = await window.OdinDialog.prompt('Nom de la nouvelle page', 'Ma page'); if (n) { L.pages.push({ id: '', name: n.slice(0, 24), widgets: [] }); cur = L.pages.length - 1; draw(); } } }, '+'),
        el('button', { class: 'fe-tab', type: 'button', onclick: () => rename(cur) }, 'Renommer'),
        // « À faire » ne se retire pas (constat M11) : la page qui le porte ne se supprime pas (c'est dit tout de suite).
        L.pages.length > 1 ? el('button', { class: 'fe-tab', type: 'button', onclick: async () => { if (page().widgets.some((w) => !R.retirable(w.kind))) { say(R.TEXTES.reglage.fixe); return; } if (await window.OdinDialog.confirm(`Supprimer la page « ${nomDe(page())} » ?`, { danger: true })) { L.pages.splice(cur, 1); cur = 0; draw(); } } }, 'Supprimer la page') : null,
        el('button', { class: 'fe-tab', type: 'button', 'aria-pressed': String(Boolean(page().maison)), title: page().code ? TXT.maisonJour : 'Montrer cette page sur l\'écran de la maison', onclick: () => { page().maison = !page().maison; draw(); } }, '🏠 Écran de la maison'),
        el('button', { class: 'fe-tab', type: 'button', 'aria-haspopup': 'dialog', onclick: ouvrirTiroir }, OT.TEXTES.bouton),
        el('span', { class: 'sp' }), themeBtn(),
        el('button', { class: 'btn small', type: 'button', onclick: async () => { L = JSON.parse(saved); edit = false; await fetchViews(); draw(); } }, 'Annuler'),
        el('button', { class: 'btn small primary', type: 'button', onclick: save }, 'Terminé'))
      // Les onglets restent sur une seule ligne : s'il y a beaucoup de pages, leur rangée défile, « Modifier » reste à droite.
      : el('div', { class: 'fe-bar' }, el('div', { class: 'fe-tabs', role: 'group', 'aria-label': 'Pages de la fenêtre' }, ...tabs), el('button', { class: 'btn small primary fe-mod', type: 'button', onclick: () => { edit = true; draw(); } }, '✎ Modifier'));
    const grid = el('div', { class: 'fe-grid', id: 'feGrid' });
    for (const w of page().widgets) grid.append(await widget(w));
    if (!page().widgets.length) grid.append(el('div', { class: 'fe-drop', style: 'grid-column:1/-1' }, edit ? 'Page vide : « Ajouter un widget » pour en poser un.' : 'Page vide : « Modifier » pour ajouter des modules.'));
    if (edit) { grid.addEventListener('dragover', (e) => e.preventDefault()); grid.addEventListener('drop', (e) => { e.preventDefault(); const w = OT.glisse(e.dataTransfer.getData('text/odin-module')); if (w) add(w.kind === 'appli' ? widgetDeLAppli(w.module) : w); }); }
    // En mode Modifier : la tuile « Ajouter un widget » en fin de grille, et le tiroir qu'elle ouvre (fermé).
    const tuile = edit ? el('button', { class: 'fe-ajout', type: 'button', 'aria-haspopup': 'dialog', onclick: ouvrirTiroir }, el('span', { 'aria-hidden': 'true' }, '＋'), OT.TEXTES.tuile) : null;
    ouvreur = null; if (!edit) $('#feTiroir')?.remove();
    const poserTout = () => { h.replaceChildren(bar, el('div', { class: 'fe-wrap' }, grid, tuile, edit ? catalogue() : null)); document.dispatchEvent(new CustomEvent('odin:fenetre')); };
    if (memeVue) OA.jouer(() => h.querySelectorAll('#feGrid > .fe-w'), poserTout); else poserTout();
    dessin = { cur, edit };
    if (carteActive && nomActif && !h.contains(document.activeElement)) [...grid.querySelectorAll('.fe-w')].find((n) => n.dataset.id === carteActive)?.querySelector(`[aria-label="${CSS.escape(nomActif)}"]`)?.focus();
  }
  async function rename(i) { const n = await window.OdinDialog.prompt('Nom de la page', nomDe(L.pages[i])); if (n) { L.pages[i].name = n.slice(0, 24); draw(); } }
  function themeBtn() {
    const themes = window.OdinThemes?.ORDER ?? [];
    const sel = el('select', { 'aria-label': 'Thème', style: 'min-height:36px;border-radius:999px;padding:0 10px;background:#fff;color:#10363a;border:0', onchange: async (e) => { const r = await act('apparence', 'theme', { theme: e.target.value }); say(r.ok ? r.text : `✗ ${r.text ?? r.error}`); } },
      el('option', { value: '' }, '🎨 Thème…'), el('option', { value: 'automatique' }, 'Automatique'), ...themes.map((t) => el('option', { value: t }, window.OdinThemes.THEMES[t]?.name ?? t)));
    return sel;
  }
  /**
   * Les rangements chez Hestia passent un par un, dans l'ordre : deux réponses qui se croisent n'écrasent pas la
   * fenêtre gardée (`saved`) avec une ancienne.
   */
  let fileRangement = Promise.resolve();
  function enFile(f) { const p = fileRangement.then(f); fileRangement = p.catch(() => undefined); return p; }
  /**
   * Range la fenêtre chez Hestia (« Terminé », un déplacement hors du mode Modifier, son « Annuler ») ; `dit` : ce qui
   * est annoncé. Rend vrai si c'est rangé. `o.deplacement` : la fenêtre `o.fenetre` notée au lâcher est rangée sans
   * fermer le mode Modifier ouvert depuis et sans écraser ce qui a changé à l'écran depuis, puis « Annuler » est offert.
   * `o.enFile` : déjà dans la file des rangements.
   */
  async function save(_e, dit = TXT.range, o = {}) {
    if (!o.enFile) return enFile(() => save(_e, dit, { ...o, enFile: true }));
    const avant = saved, envoye = o.fenetre ?? JSON.stringify(L);
    if (o.deplacement && envoye === avant) return true; // déjà rangé (un rangement plus récent l'a emporté)
    const r = await act('gladsheim', 'regler_fenetre', { fenetre: envoye });
    const rienDepuis = !edit && JSON.stringify(L) === envoye; // l'écran montre encore ce qui vient d'être rangé
    if (!r.ok) { say(`✗ ${r.text ?? r.error}`); if (o.deplacement && rienDepuis) { L = JSON.parse(avant); if (!glisse && !appuiEnCours) draw(); } return false; }
    saved = JSON.stringify(r.data);
    if (o.deplacement) { if (rienDepuis) L = r.data; proposerAnnuler(OG.offre(avant, saved, Date.now())); return true; }
    L = r.data; edit = false; if (dit) say(dit); await fetchViews(); draw();
    return true;
  }
  function move(id, d) { if (glisse) return; const l = page().widgets, i = l.findIndex((x) => x.id === id), j = i + d; if (i < 0 || j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; draw().then(() => { $(`.fe-w[data-id="${id}"] .fe-grip`)?.focus(); signaler('pose', document.activeElement); }); }
  /** Prévient le reste de la page (la mascotte y réagit, lot 22b) : un module pris, posé ailleurs, son coin tiré, sa taille changée. */
  function signaler(quoi, n) { try { const r = n?.getBoundingClientRect?.(); document.dispatchEvent(new CustomEvent('odin:widget-geste', { detail: { quoi, x: r ? r.left + r.width / 2 : undefined, y: r ? r.top + r.height / 2 : undefined } })); } catch { /* rien */ } }
  // ------------------------------------------------------------------ glisser un module (lot 16)
  /** Le glisser en cours (un seul geste à la fois, un seul pointeur), l'appui long qui attend, l'heure du dernier lâcher. */
  let glisse = null, appuiEnCours = null, finGlisse = 0;
  const reduit = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const idsDe = (grid) => [...grid.querySelectorAll(':scope > .fe-w')].map((n) => n.dataset.id);
  /** Ce qui défile autour de la grille (la colonne de l'accueil), sinon la page. */
  function defileur(n) {
    for (let p = n?.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p; }
    return document.scrollingElement || document.documentElement;
  }
  /**
   * Un appui sur la carte d'un module (pas sur sa poignée, ni sur son coin) : selon l'endroit, le pointeur et le mode,
   * le glisser s'arme, l'appui long attend, ou rien (un bouton, un lien, un texte à sélectionner hors du mode Modifier).
   */
  function attraper(e, box, id) {
    const t = e.target;
    if (glisse || appuiEnCours || coinEnCours || !t?.closest || t.closest('.fe-grip')) return;
    const c = t.closest(OG.CONTROLES);
    const z = OG.zone({ coin: Boolean(t.closest('.fe-rz')), controle: Boolean(c && c !== box && box.contains(c)), entete: Boolean(t.closest('.fe-h')), texte: OG.aDuTexte(t) });
    const quoi = OG.depart({ pointeur: e.pointerType, modifier: edit, zone: z, bouton: e.button, principal: e.isPrimary !== false });
    if (quoi === 'glisser') startDrag(e, box, id);
    else if (quoi === 'appuiLong') appuiLong(e, box, id);
  }
  /**
   * Au doigt : l'appui long (480 ms sans bouger). S'il bouge avant, il fait défiler la page : l'appui est oublié.
   * Tenu : hors du mode Modifier, ce mode s'ouvre ; puis le module est en main et suit le doigt.
   */
  function appuiLong(e, box, id) {
    const pid = e.pointerId, x0 = e.clientX, y0 = e.clientY, t0 = performance.now(), cible = e.target, r0 = box.getBoundingClientRect();
    const etat = { x: x0, y: y0, tenu: false, lache: false };
    appuiEnCours = etat;
    // La page ne défile plus une fois le module en main (le doigt reste sur sa cible d'origine, même redessinée).
    const bloque = (t) => { if (etat.tenu || glisse) t.preventDefault(); };
    const menu = (t) => { if (appuiEnCours || glisse) t.preventDefault(); };
    cible.addEventListener('touchmove', bloque, { passive: false }); cible.addEventListener('contextmenu', menu);
    const liberer = () => { cible.removeEventListener('touchmove', bloque); cible.removeEventListener('contextmenu', menu); };
    const POINTEUR = ['pointermove', 'pointerup', 'pointercancel'];
    const fini = () => { clearTimeout(minuteur); for (const t of POINTEUR) removeEventListener(t, ev); removeEventListener('blur', ev); if (appuiEnCours === etat) appuiEnCours = null; };
    function ev(v) {
      if (v.type === 'blur') { fini(); liberer(); return; }
      if (v.pointerId !== pid) return;
      if (v.type !== 'pointermove') { if (etat.tenu) { etat.lache = true; return; } fini(); liberer(); return; }
      etat.x = v.clientX; etat.y = v.clientY;
      if (!etat.tenu && OG.appui({ dx: etat.x - x0, dy: etat.y - y0, ecoule: performance.now() - t0 }) === 'annuler') { fini(); liberer(); }
    }
    const minuteur = setTimeout(async () => {
      if (OG.appui({ dx: etat.x - x0, dy: etat.y - y0, ecoule: performance.now() - t0 }) !== 'tenir') { fini(); liberer(); return; }
      etat.tenu = true;
      try { navigator.vibrate?.(18); } catch { /* */ }
      if (!edit) { edit = true; await draw(); say(TXT.enMain); }
      fini();
      const nb = [...document.querySelectorAll('#feGrid > .fe-w')].find((n) => n.dataset.id === id);
      if (etat.lache || !nb) { liberer(); return; }
      startDrag({ pointerId: pid, pointerType: e.pointerType, button: 0, clientX: etat.x, clientY: etat.y, preventDefault() { /* déjà tenu */ } }, nb, id,
        { tenu: true, rel: [(x0 - r0.left) / (r0.width || 1), (y0 - r0.top) / (r0.height || 1)], liberer });
    }, OG.MESURES.appuiLong);
    for (const t of POINTEUR) addEventListener(t, ev);
    addEventListener('blur', ev);
  }
  /**
   * Glisser-déposer à la souris et au doigt : la copie suit le pointeur, un cadre en pointillé reste à la place, le
   * module prend la place de celui qu'il survole (selon la moitié), la page défile près du haut ou du bas.
   * Un seul pointeur compte ; Échap, ou la fenêtre qui perd le focus, remet l'ordre d'avant.
   * Au lâcher : en mode Modifier, rien n'est gardé avant « Terminé » ; hors de ce mode, c'est rangé tout de suite et
   * « Annuler » est offert quelques secondes.
   */
  function startDrag(e, box, id, o = {}) {
    if (glisse || coinEnCours || e.button > 0) { o.liberer?.(); return; }
    e.preventDefault();
    const grid = box.parentNode, pid = e.pointerId, x0 = e.clientX, y0 = e.clientY, modifier = edit, M = OG.mouvement(reduit()), P = OA.prise(OA.actuelle(), M);
    const ordre0 = idsDe(grid), sel0 = String(window.getSelection?.() ?? ''), scr = defileur(grid);
    let ghost = null, gx = 0, gy = 0, x = x0, y = y0, lx = x0, dernier = 0, raf = 0;
    glisse = { id };
    const pose = () => { ghost.style.transform = `translate(${x - gx}px,${y - gy}px) rotate(${Math.max(-P.incline, Math.min(P.incline, (x - lx) * P.facteur))}deg) scale(${P.leve})`; lx = x; };
    const commencer = () => {
      const r = box.getBoundingClientRect();
      gx = o.rel ? Math.min(r.width, o.rel[0] * r.width) : x0 - r.left; gy = o.rel ? Math.min(r.height, o.rel[1] * r.height) : y0 - r.top;
      ghost = box.cloneNode(true); ghost.classList.add('fe-ghost'); ghost.classList.remove('resizing'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
      for (const n of ghost.querySelectorAll('[id]')) n.removeAttribute('id');
      ghost.style.width = `${r.width}px`; ghost.style.height = `${r.height}px`; if (P.classe) ghost.classList.add(P.classe);
      document.body.append(ghost); box.classList.add('dragging'); document.body.classList.add('fe-glisse');
      try { window.getSelection?.()?.removeAllRanges(); } catch { /* */ }
      pose(); signaler('prise', box);
      if (M.prise && ghost.animate) ghost.animate([{ transform: `translate(${r.left}px,${r.top}px)` }, { transform: ghost.style.transform }], { duration: M.prise, easing: 'ease-out' });
    };
    /**
     * Le module visé sous le pointeur : le nôtre prend sa place, avant ou après lui. Côte à côte, la moitié droite
     * (ou le bas) de la carte visée place après elle (la grille) ; une carte seule sur sa rangée (le téléphone) : sa
     * moitié du bas.
     */
    const viser = (ev) => {
      const now = performance.now(); if (now - dernier < OG.MESURES.echange) return;
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.fe-w');
      if (!t || t === box || t.parentNode !== grid) return;
      const cartes = [...grid.querySelectorAll(':scope > .fe-w')], a = cartes.indexOf(box), r = t.getBoundingClientRect();
      const to = OG.seule(r, grid.clientWidth) ? G.rang(a, cartes.indexOf(t), OG.apres(ev.clientX, ev.clientY, r, grid.clientWidth))
        : G.rang(a, cartes.indexOf(t), G.apres(ev.clientX, ev.clientY, t.getBoundingClientRect()));
      if (to === a) return;
      dernier = now;
      // Les autres modules glissent à leur nouvelle place avec l'animation choisie (celui qu'on tient reste un cadre).
      const reste = cartes.filter((n) => n !== box); OA.jouer(() => grid.querySelectorAll(':scope > .fe-w'), () => grid.insertBefore(box, reste[to] ?? null), { sauf: id });
    };
    const bords = () => { if (scr === document.scrollingElement || scr === document.documentElement) return [0, innerHeight]; const r = scr.getBoundingClientRect(); return [Math.max(0, r.top), Math.min(innerHeight, r.bottom)]; };
    const defiler = () => {
      raf = 0; if (!glisse || !ghost) return;
      const [h, b] = bords(), v = OG.defilement(y, h, b); if (!v) return;
      const avant = scr.scrollTop; scr.scrollTop += v; if (scr.scrollTop === avant) return;
      viser({ clientX: x, clientY: y }); raf = requestAnimationFrame(defiler);
    };
    const fin = (annule) => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); removeEventListener('keydown', touche, true); removeEventListener('blur', touche);
      if (raf) cancelAnimationFrame(raf); raf = 0; o.liberer?.(); document.body.classList.remove('fe-glisse'); glisse = null;
      if (!ghost) return; // un simple clic : rien n'a bougé
      finGlisse = Date.now();
      const order = idsDe(grid), quoi = OG.auLacher({ modifier, change: order.join('\n') !== ordre0.join('\n'), annule });
      if (quoi === 'remettre') OA.jouer(() => grid.querySelectorAll(':scope > .fe-w'), () => { for (const i of ordre0) { const n = [...grid.children].find((c) => c.dataset?.id === i); if (n) grid.append(n); } }, { sauf: id });
      const r = box.getBoundingClientRect(), g = ghost, enlever = () => { g.remove(); box.classList.remove('dragging'); };
      if (M.pose && g.animate) { const a = g.animate([{ transform: g.style.transform }, { transform: `translate(${r.left}px,${r.top}px)` }], { duration: P.pose, easing: P.poseEase }); g.style.transform = `translate(${r.left}px,${r.top}px)`; a.onfinish = enlever; a.oncancel = enlever; }
      else enlever();
      if (quoi === 'remettre') { if (order.join('\n') !== ordre0.join('\n')) dire(TXT.revenu); return; }
      if (quoi === 'rien') return;
      page().widgets.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      dire(TXT.place(order.indexOf(id) + 1, order.length)); signaler('pose', box);
      if (quoi === 'ranger') rangerDeplacement();
    };
    function geste(v) {
      const quoi = G.geste(pid, v);
      // Pendant le glisser, aucune autre touche n'agit (une flèche sur une poignée redessinerait la fenêtre sous le geste).
      if (quoi === 'ignorer') { if (ghost && v.type === 'keydown') { v.preventDefault(); v.stopPropagation(); } return; }
      if (quoi === 'suivre') {
        x = v.clientX; y = v.clientY;
        if (!ghost) {
          const s = String(window.getSelection?.() ?? ''), q = OG.suite({ dx: x - x0, dy: y - y0, selection: s !== '' && s !== sel0 });
          if (q === 'abandonner') { fin(false); return; }
          if (q === 'attendre') return;
          commencer();
        }
        if (v.cancelable) v.preventDefault();
        pose(); viser(v); if (!raf) defiler();
        return;
      }
      if (v.type === 'keydown') { if (ghost) { v.preventDefault(); v.stopPropagation(); } }
      fin(quoi === 'annuler');
    }
    const mv = (v) => geste(v), up = (v) => geste(v), touche = (v) => geste(v);
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    addEventListener('keydown', touche, true); addEventListener('blur', touche);
    if (o.tenu) commencer();
  }
  /**
   * Hors du mode Modifier : le déplacement est rangé au lâcher, et « Annuler » est offert quelques secondes. La fenêtre
   * est notée au lâcher : chaque déplacement est rangé tel qu'il était, et son « Annuler » ne défait que lui.
   */
  function rangerDeplacement() { return save(null, '', { deplacement: true, fenetre: JSON.stringify(L) }); }
  function proposerAnnuler(o) {
    $('#feAnnuler')?.remove();
    const n = el('div', { id: 'feAnnuler', class: 'va-out fe-annuler', role: 'status', style: 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:90;max-width:min(560px,calc(100% - 32px))' }, el('span', {}, TXT.deplace),
      el('button', { class: 'btn small', type: 'button', onclick: () => {
        n.remove(); const quand = Date.now();
        return enFile(async () => {
          if (glisse || !OG.peutAnnuler(o, quand, saved, edit)) { say(TXT.tropTard); return; }
          // La fenêtre a pu changer ailleurs (un autre appareil) : on ne défait que si Hestia garde encore ce déplacement.
          const f = await act('gladsheim', 'fenetre');
          if (!f.ok || JSON.stringify(f.data) !== o.apres) { if (f.ok && !edit && !glisse && JSON.stringify(L) === saved) { L = f.data; saved = JSON.stringify(L); draw(); } say(TXT.tropTard); return; }
          L = JSON.parse(o.avant); await save(null, TXT.annule, { enFile: true });
        });
      } }, TXT.annuler));
    document.body.append(n); setTimeout(() => n.remove(), OG.MESURES.annuler);
  }
  // Le clic qui suit un lâcher (sur « Ouvrir › », un lien…) ne compte pas : on déplaçait, on n'ouvrait rien.
  // Un nouvel appui est un vrai clic (« Modifier » juste après un lâcher compte).
  addEventListener('click', (e) => { if (Date.now() - finGlisse < 400 && e.target?.closest?.('#fenetre')) { e.stopPropagation(); e.preventDefault(); } }, true);
  addEventListener('pointerdown', () => { if (!glisse) finGlisse = 0; }, true);
  /** Dit une taille aux lecteurs d'écran (une zone « status » cachée, posée une fois). */
  function dire(t) { let n = $('#feDit'); if (!n) { n = el('div', { id: 'feDit', class: 'fe-dit', role: 'status', 'aria-live': 'polite' }); document.body.append(n); } n.textContent = t; }
  const auTel = () => G.appareil(innerWidth) === 'telephone';
  /**
   * Tirer le coin (souris et doigt) : la taille suit le pointeur case par case, rien n'est gardé avant « Terminé ».
   * Un seul geste à la fois, et seul le doigt (ou la souris) posé sur le coin compte : un second doigt ne tire rien.
   * Échap, ou la fenêtre qui perd le focus, remet la taille d'avant ; une souris relâchée hors de la fenêtre finit le geste.
   */
  let coinEnCours = false;
  function startResize(e, box, w, szb) {
    if (!edit || e.button > 0 || coinEnCours) return;
    if (glisse || appuiEnCours) return; // un seul geste à la fois : pas de coin pendant un glisser
    e.preventDefault(); e.stopPropagation();
    const tel = auTel(), grid = box.parentNode, dep = G.depart(w, tel, box.getBoundingClientRect().height), colonnePx = G.colonne(grid.clientWidth, tel), x0 = e.clientX, y0 = e.clientY;
    const id = e.pointerId, rz = e.currentTarget, avant = G.memo(w);
    let n = dep;
    try { rz.setPointerCapture(id); } catch { /* ancien navigateur */ }
    coinEnCours = true; box.classList.add('resizing'); szb.textContent = G.etiquette(dep); signaler('coin', box);
    const POINTEUR = ['pointermove', 'pointerup', 'pointercancel'];
    const fin = (annule) => {
      for (const t of POINTEUR) removeEventListener(t, ev); removeEventListener('keydown', ev, true); removeEventListener('blur', ev); rz.removeEventListener('lostpointercapture', ev);
      coinEnCours = false; box.classList.remove('resizing');
      const bouge = n.c !== dep.c || n.r !== dep.r;
      if (annule) { G.remettre(w, avant); box.setAttribute('style', G.style(w)); if (bouge) dire(TXT.remise(G.etiquette(dep))); return; }
      if (bouge) { dire(TXT.taille(G.etiquette(n))); signaler('taille', box); draw(); }
    };
    function ev(x) {
      const quoi = G.geste(id, x);
      if (quoi === 'ignorer') return;
      if (quoi === 'suivre') {
        const t = G.tirer(w, dep, x.clientX - x0, x.clientY - y0, colonnePx, tel);
        if (t.c === n.c && t.r === n.r) return;
        // Les autres modules s'écartent avec l'animation choisie ; celui qu'on tire suit le doigt, case par case.
        n = t; OA.jouer(() => grid.querySelectorAll(':scope > .fe-w'), () => { G.poser(w, n, tel); box.setAttribute('style', G.style(w)); szb.textContent = G.etiquette(n); }, { sauf: w.id });
        return;
      }
      if (x.type === 'keydown') { x.preventDefault(); x.stopPropagation(); }
      fin(quoi === 'annuler');
    }
    for (const t of POINTEUR) addEventListener(t, ev);
    addEventListener('keydown', ev, true); addEventListener('blur', ev); rz.addEventListener('lostpointercapture', ev);
  }
  /** Maj + flèche sur la poignée : une colonne ou une ligne de plus ou de moins. Rend vrai pour une flèche. */
  function tailleClavier(w, touche, box) {
    if (!touche.startsWith('Arrow')) return false;
    const tel = auTel(), h = box.getBoundingClientRect().height, n = G.pas(w, touche, tel, h);
    if (!n) { dire(TXT.refusee(G.etiquette(G.depart(w, tel, h)))); return true; }
    G.poser(w, n, tel); dire(TXT.taille(G.etiquette(n))); signaler('taille', box);
    draw().then(() => { const b = $(`.fe-w[data-id="${CSS.escape(w.id)}"]`); if (!b) return; b.querySelector('.fe-grip')?.focus(); const s = b.querySelector('.fe-szb'); if (s) { s.textContent = G.etiquette(n); b.classList.add('resizing'); setTimeout(() => b.classList.remove('resizing'), 1500); } });
    return true;
  }
  /** Les sept tailles toutes faites, dans une liste (celles plus petites que la mini du module n'y sont pas). */
  function tailles(w) {
    const now = G.tailleChoisie(w), m = G.bornes(w.kind), possibles = G.taillesPossibles(w.kind);
    const radios = el('div', { class: 'fe-sizes', role: 'radiogroup', 'aria-label': TXT.titreTailles }, ...possibles.map((t) => el('label', {}, el('input', { type: 'radio', name: 'feTaille', value: t.nom, checked: t.nom === now ? true : undefined }), TXT.tailles[t.nom] ?? t.nom, el('small', {}, G.etiquette(t)))));
    const retirees = possibles.length < G.TAILLES.length ? el('p', { class: 'sub', style: 'margin:6px 0 0;font-size:12.5px' }, TXT.miniTailles(G.etiquette({ c: m.c[0], r: m.r[0] }))) : null;
    dialog(TXT.titreTailles, el('div', {}, radios, retirees, el('p', { class: 'sub', style: 'margin:6px 0 0;font-size:12.5px' }, TXT.aideTailles)), () => {
      const v = radios.querySelector('input:checked')?.value; if (!v) { say(TXT.aucuneTaille); return false; }
      if (!G.choisir(w, v)) { say(TXT.refusee(G.etiquette(G.TAILLES.find((t) => t.nom === v) ?? { c: 0, r: 0 }))); return false; }
      dire(TXT.taille(G.etiquette(G.taille(w)))); draw();
    });
    // Le focus va sur la taille cochée (sinon sur la première) : une flèche ne change pas le choix sans le vouloir.
    (radios.querySelector('input:checked') ?? radios.querySelector('input'))?.focus();
  }
  /**
   * Pose un widget à la fin de la page, ferme le tiroir, puis l'écran défile jusqu'à lui et le focus s'y pose (lot 18).
   * Une appli désactivée, ou absente du catalogue de qui regarde, n'est jamais posée (même glissée d'ailleurs) : c'est
   * dit, rien ne change.
   */
  function add(w) { page().widgets.push({ w: 1, ...w, id: G.nouvelId(L.pages.flatMap((p) => p.widgets.map((x) => x.id))) });
    const n = page().widgets[page().widgets.length - 1], ok = OT.poser(cat?.modules, n.module);
    if (ok !== 'ok') { page().widgets.pop(); say(ok === 'desactivee' ? OT.TEXTES.refusee(modName(n.module)) : OT.TEXTES.inconnue); return false; }
    // Un bloc du jour (lot 26) : un seul de chaque dans toute la fenêtre (comme le serveur), et pour le propriétaire seul.
    if (JOUR.includes(n.kind) && (!proprio || L.pages.some((p) => p.widgets.some((x) => x !== n && x.kind === n.kind)))) { page().widgets.pop(); say(TXT.jour.deja(TXT.titres[n.kind])); return false; }
    fermerTiroir(false); views.delete(w.module); fetchViews().then(draw).then(() => montrerAjout(n.id)); return true; }
  /** Le widget qui vient d'être posé : l'écran défile jusqu'à lui, il apparaît, le focus va sur sa poignée, c'est dit. */
  function montrerAjout(id) {
    const b = [...document.querySelectorAll('#feGrid > .fe-w')].find((x) => x.dataset.id === id); if (!b) return;
    b.scrollIntoView({ behavior: reduit() ? 'auto' : 'smooth', block: 'center' });
    b.classList.add('fe-pop'); b.addEventListener('animationend', () => b.classList.remove('fe-pop'), { once: true });
    (b.querySelector('.fe-grip') ?? b).focus({ preventScroll: true });
    const w = page().widgets.find((x) => x.id === id), T = OT.TEXTES;
    dire(T.pose(w?.label || (w && renduDe(w) ? titreDe(w) : '') || (w?.kind === 'heure' ? T.heure : w?.kind === 'meteo' ? T.meteo : JOUR.includes(w?.kind) ? TXT.titres[w.kind] : modName(w?.module ?? ''))));
  }

  // ------------------------------------------------------------------ le tiroir « Ajouter un widget » (lot 18)
  /** Ce qui a ouvert le tiroir (le focus y revient quand il se ferme) ; la recherche et la famille, gardées d'une ouverture à l'autre. */
  let ouvreur = null;
  const etatTiroir = { q: '', famille: OT.TOUT };
  function ouvrirTiroir(e) {
    const t = $('#feTiroir'); if (!t || t.classList.contains('open')) return;
    ouvreur = e?.currentTarget instanceof HTMLElement ? e.currentTarget : document.activeElement;
    // Posé à la racine de la page : rien de ce qui l'entoure (menu, mascotte) ne passe par-dessus.
    if (t.parentNode !== document.body) document.body.append(t);
    t.classList.add('open');
    t.querySelector('input[type=search]')?.focus({ preventScroll: true });
  }
  /** Ferme le tiroir ; `rendre` : le focus revient à ce qui l'a ouvert (pas après un ajout : il va au widget posé). */
  function fermerTiroir(rendre = true) {
    const t = $('#feTiroir'); if (!t?.classList.contains('open')) return;
    t.classList.remove('open'); const o = ouvreur; ouvreur = null;
    if (rendre && o?.isConnected) o.focus();
  }
  /** Échap ferme et rend le focus ; Tab et Maj + Tab restent dans le tiroir. */
  function toucheTiroir(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermerTiroir(); return; }
    if (e.key !== 'Tab') return;
    const l = [...e.currentTarget.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((n) => n.getClientRects().length > 0);
    const j = OT.boucle(l.length, l.indexOf(document.activeElement), e.shiftKey);
    if (j >= 0) { e.preventDefault(); l[j].focus(); }
  }
  // Un appui hors du tiroir (pas dans une fenêtre de dialogue qu'il a ouverte) le ferme, sans voler le focus.
  addEventListener('pointerdown', (e) => { const t = $('#feTiroir'); if (t?.classList.contains('open') && !t.contains(e.target) && !e.target?.closest?.('dialog')) fermerTiroir(false); }, true);
  // Une autre vue d'Odin s'ouvre (menu, palette, Odin qui l'ouvre) : le tiroir, posé à la racine, ne reste pas par-dessus.
  document.addEventListener('odin:vue', (e) => { if (e.detail?.vue !== 'home') fermerTiroir(false); });
  /**
   * Le tiroir, rempli par le catalogue d'Odin (déjà filtré par les droits) : « Heure et lieu », « Météo », « Site
   * surveillé » et « Bouton sur mesure » dans « Infos », puis chaque appli dans sa famille. Une appli désactivée est
   * grisée, avec « désactivée », sans bouton. Fermé tant qu'on ne l'ouvre pas (la tuile ou « ＋ Ajouter »).
   */
  function catalogue() {
    $('#feTiroir')?.remove(); // l'ancien tiroir, s'il a été posé à la racine de la page
    const T = OT.TEXTES, list = el('div', { class: 'fe-tiroir-corps' }), statut = el('div', { class: 'fe-dit', role: 'status', 'aria-live': 'polite' });
    const q = el('input', { type: 'search', value: etatTiroir.q, placeholder: T.chercher, 'aria-label': T.chercherNom, autocomplete: 'off', oninput: () => fill(q.value) });
    const icone = (mod, nom, icon) => { if (mod && window.OdinAppIcons) { const sp = el('span', { class: 'fe-ic fe-ic-app', 'aria-hidden': 'true' }); sp.innerHTML = window.OdinAppIcons.tile(mod, nom, 40); return sp; } return el('span', { class: 'fe-ic', 'aria-hidden': 'true' }, icon ?? String(nom).slice(0, 1)); };
    // Une ligne qui pose un widget tout prêt : un clic sur « Ajouter », ou glissée sur la page.
    const item = (w, nom, quoi, icon) => ({ w, nom, quoi, icon, famille: OT.INFOS, onclick: () => add(w) });
    const vordr = (cat?.modules ?? []).find((m) => m.id === 'vordr');
    // Lot 26 : les blocs du jour que la fenêtre ne porte plus (retirés), pour le propriétaire seul.
    const jour = proprio && aujourdhui() ? JOUR.filter((k) => !L.pages.some((p) => p.widgets.some((w) => w.kind === k))).map((k) => item({ kind: k, w: LARGEUR_JOUR[k] > 8 ? 3 : LARGEUR_JOUR[k] > 4 ? 2 : 1, c: LARGEUR_JOUR[k] }, TXT.titres[k], TXT.jour.quoi[k], TXT.jour.lettres[k])) : [];
    // Les sortes déclarées par les fichiers de famille (pages/widgets-<famille>.js), pour qui a le droit : rien d'elles
    // n'est écrit ici. Celle qui lit une appli désactivée est grisée, sans bouton ; « Ajouter » la pose à sa taille.
    const declarees = R.posables({ proprio, aDroit }).map((x) => { const m = x.appli ? cat?.modules?.find((y) => y.id === x.appli) : undefined;
      return { nom: x.nom, quoi: x.quoi, icon: x.symbole, famille: x.famille === OT.INFOS || !m ? OT.INFOS : m.family, active: m ? OT.active(m) : undefined, onclick: () => add(x.w) }; });
    const lignes = [...jour, item({ kind: 'heure' }, T.heure, T.heureQuoi, '🕒'), item({ kind: 'meteo', style: 'complete', w: 1, c: 4, r: 5 }, T.meteo, T.meteoQuoi, '☀'), ...declarees,
      vordr ? { nom: T.site, quoi: T.siteQuoi, icon: '🌐', famille: OT.INFOS, active: OT.active(vordr), onclick: siteSurveille } : null,
      { nom: T.perso, quoi: T.persoQuoi, icon: '⚡', famille: OT.INFOS, creer: true, onclick: ownButton },
      ...(cat?.modules ?? []).map((m) => ({ ...item(widgetDeLAppli(m.id), m.name, String(m.what ?? '').slice(0, 90)), famille: m.family, module: m.id, active: OT.active(m) }))].filter(Boolean);
    const ligne = (x) => {
      const ic = icone(x.module, x.nom, x.icon), texte = el('div', { class: 'fe-it-t' }, el('b', {}, x.nom), el('small', {}, x.active === false ? `${x.quoi} · ${T.desactiveeAide}` : x.quoi));
      if (x.active === false) return el('div', { class: 'fe-it off' }, ic, texte, el('span', { class: 'fe-off' }, T.desactivee));
      return el('div', { class: 'fe-it', draggable: x.w ? 'true' : undefined, ondragstart: x.w ? (e) => e.dataTransfer.setData('text/odin-module', JSON.stringify(x.w)) : undefined }, ic, texte,
        el('button', { class: 'btn small', type: 'button', 'aria-label': x.creer ? T.creerNom(x.nom) : T.ajouterNom(x.nom), onclick: x.onclick }, x.creer ? T.creer : T.ajouter));
    };
    const fams = OT.familles(cat?.modules); etatTiroir.famille = OT.famille(etatTiroir.famille, fams);
    const chips = el('div', { class: 'fe-chips', role: 'group', 'aria-label': T.familles }, ...[[OT.TOUT, T.tout], [OT.INFOS, T.infos], ...fams.map((f) => [f, f])].map(([f, nom]) => el('button', { type: 'button', 'data-f': f, 'aria-pressed': String(f === etatTiroir.famille),
      onclick: () => { etatTiroir.famille = f; for (const b of chips.children) b.setAttribute('aria-pressed', String(b.dataset.f === f)); fill(q.value); } }, nom)));
    const fill = (term) => {
      etatTiroir.q = term;
      const groupes = OT.trouver(lignes, term, etatTiroir.famille), n = groupes.reduce((s, g) => s + g.lignes.length, 0);
      list.replaceChildren(...(n ? groupes.flatMap((g) => [el('h3', {}, `${g.titre} · ${g.lignes.length}`), ...g.lignes.map(ligne)]) : [el('p', { class: 'fe-tiroir-rien' }, T.rien)]));
      statut.textContent = n ? T.trouves(n) : T.rien;
    };
    fill(etatTiroir.q);
    return el('div', { id: 'feTiroir', class: 'fe-tiroir', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'feTiroirTitre', onkeydown: toucheTiroir },
      el('header', {}, el('div', { class: 'fe-tiroir-h' }, el('h2', { id: 'feTiroirTitre' }, T.titre), el('button', { class: 'fe-tiroir-x', type: 'button', 'aria-label': T.fermer, onclick: () => fermerTiroir() }, '✕')), q, chips, el('small', {}, T.aide)),
      list, statut);
  }

  // ------------------------------------------------------------------ réglages d'un module, bouton sur mesure
  function dialog(title, body, onOk) {
    const d = el('dialog', { class: 'fe-form', style: 'max-width:min(460px,calc(100% - 32px));border-radius:16px;border:1px solid var(--line);background:var(--panel);color:var(--ink)' }, el('h2', { style: 'margin:0 0 8px;font-size:17px' }, title), body,
      el('div', { class: 'va-acts-bar', style: 'margin:14px 0 0' }, el('button', { class: 'btn small', type: 'button', onclick: () => d.close() }, 'Annuler'), el('button', { class: 'btn small primary', type: 'button', onclick: () => { if (onOk() !== false) d.close(); } }, 'Valider')));
    d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal();
  }
  async function configure(w) {
    if (ferme(w)) return; // fermé à qui regarde : rien n'est lu chez l'appli, même pour le régler
    const v = views.get(w.module) ?? (await api(`/api/valhalla/view?id=${encodeURIComponent(w.module)}`)).view;
    const secs = [...(v?.sections ?? []), ...(v?.side ?? [])].filter((s) => s.kind !== 'form').map((s) => s.title);
    const sel = el('select', { id: 'feSec' }, el('option', { value: '' }, 'Les chiffres clés'), ...secs.map((t) => el('option', { value: t, selected: t === w.section ? true : undefined }, t)));
    const lab = el('input', { id: 'feLab', value: w.label ?? '', placeholder: 'Titre (facultatif)' });
    dialog(`Module ${modName(w.module)}`, el('div', {}, el('label', { for: 'feSec' }, 'Ce qu\'il montre'), sel, el('label', { for: 'feLab' }, 'Titre'), lab), () => {
      if (sel.value) { w.kind = 'section'; w.section = sel.value; } else { w.kind = 'chiffres'; delete w.section; }
      w.label = lab.value.trim() || undefined; draw();
    });
  }
  /**
   * « Ouvrir à… » (le propriétaire, en mode Modifier) : le bouton n'existe que sur un widget qui lit une appli de la vie
   * privée. Ces widgets restent fermés aux autres ; ici, un interrupteur par personne. Rien d'autre n'est ouvert.
   */
  function boutonOuvrirA(w) {
    if (!proprio || !R.VIE_PRIVEE.includes(appliDe(w))) return null;
    const b = el('button', { class: 'fe-ouvb', type: 'button', title: TXT.ouvrir.bouton, 'aria-label': TXT.ouvrir.nom(titreDe(w)), 'aria-haspopup': 'dialog', onclick: () => ouvrirA(w) });
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/></svg>';
    return b;
  }
  async function ouvrirA(w) {
    const T = TXT.ouvrir, range = JSON.parse(saved).pages.flatMap((p) => p.widgets).find((x) => x.id === w.id);
    // Un widget pas encore rangé, ou pointé depuis sur autre chose : on range d'abord (le serveur ne connaît que la fenêtre rangée).
    if (!range || sigDe(range) !== sigDe(w) || JSON.stringify(range.toucher ?? null) !== JSON.stringify(w.toucher ?? null)) { say(T.dAbord); return; }
    let r; try { r = await act('gladsheim', 'ouvertures_widget', { widget: w.id }); } catch { r = { ok: false }; }
    if (!r.ok || !r.data) { say(`✗ ${r.text ?? r.error ?? T.echec}`); return; }
    const gens = Array.isArray(r.data.personnes) ? r.data.personnes : [], appli = (r.data.applis ?? []).map((a) => a.name).join(', ') || modName(appliDe(w));
    const lignes = gens.map((g, k) => el('label', { class: 'fe-ouv', for: `feOuv${k}` },
      el('span', { class: 'fe-ouv-t' }, el('span', {}, g.name), g.droit ? null : el('small', {}, T.sansDroit(appli))),
      el('input', { id: `feOuv${k}`, type: 'checkbox', role: 'switch', 'data-k': String(k), checked: g.ouvert ? true : undefined })));
    const corps = el('div', {}, el('p', { class: 'fe-ouv-aide' }, T.aide(appli)), gens.length ? el('div', { role: 'group', 'aria-label': T.groupe }, ...lignes) : el('p', { class: 'fe-err' }, T.personne));
    dialog(T.titre(titreDe(w)), corps, () => {
      const change = [...corps.querySelectorAll('input[data-k]')].map((n) => ({ g: gens[Number(n.dataset.k)], ouvert: n.checked })).filter((x) => x.g && x.ouvert !== Boolean(x.g.ouvert));
      // Une personne après l'autre ; au premier refus, on s'arrête et on le dit.
      (async () => {
        let dernier = null;
        for (const x of change) { dernier = await act('gladsheim', 'ouvrir_widget', { widget: w.id, personne: x.g.login, ouvert: x.ouvert ? 'oui' : 'non' }); if (!dernier.ok) break; }
        if (dernier) say(dernier.ok ? (change.length > 1 ? T.fait(change.length) : dernier.text) : `✗ ${dernier.text ?? dernier.error}`);
      })().catch(() => say(`✗ ${T.echec}`));
    });
  }
  // ------------------------------------------------------------------ « Quand je touche le widget » (lot 25b)
  /**
   * Le bouton de l'en-tête dit ce que fait le widget quand on le touche (le même geste au clavier) : « Ouvrir › » pour
   * son appli (`ouvrir`, le bouton d'aujourd'hui), « Lancer › » pour une action, « Aller › » pour un écran, un vrai lien
   * « Site ↗ » pour une adresse (nouvel onglet, sans donner la main à la page ouverte). « Rien » : pas de bouton.
   */
  function boutonToucher(w, ouvrir) {
    const t = R.toucherDe(w), T = R.TEXTES.toucher;
    if (t.quoi === 'appli') return ouvrir;
    if (t.quoi === 'action') { const n = T.lancerNom(cat?.modules?.find((m) => m.id === t.appli)?.actions?.find((a) => a.id === t.action)?.label ?? t.action, modName(t.appli)); return el('button', { class: 'fe-open', type: 'button', 'aria-label': n, title: n, onclick: (e) => { if (!(e.detail > 1)) toucher(w); } }, T.lancer); }
    if (t.quoi === 'ecran') { const n = T.allerNom(R.TEXTES.reglage.ecrans[t.ecran]); return el('button', { class: 'fe-open', type: 'button', 'aria-label': n, title: n, onclick: () => toucher(w) }, T.aller); }
    if (t.quoi === 'adresse') { let h = ''; try { h = new URL(t.adresse).host; } catch { /* déjà nettoyée */ } return el('a', { class: 'fe-open', href: t.adresse, target: '_blank', rel: 'noopener noreferrer', 'aria-label': T.siteNom(h), title: t.adresse }, T.site); }
    return null;
  }
  /**
   * Un clic sur la carte : seulement hors du mode Modifier, pas sur l'un de ses boutons ou liens, pas en sélectionnant
   * un texte. Le second clic d'un double clic ne compte pas (une action ne part pas deux fois, un site ne s'ouvre pas
   * dans deux onglets).
   */
  function auToucher(e, box, w) {
    if (edit || glisse || e.defaultPrevented || e.detail > 1) return;
    const c = e.target?.closest?.(OG.CONTROLES); if (c && c !== box && box.contains(c)) return;
    if (String(window.getSelection?.() ?? '')) return;
    toucher(w);
  }
  /**
   * Fait ce que « Régler » a choisi. Une action part par le chemin de toutes les actions d'Odin, comme le bouton sur
   * mesure : si elle est grave, Odin demande l'accord à CHAQUE fois ; un membre ne lance que ce que son droit sur
   * l'appli permet (le serveur décide). Une adresse, renettoyée, s'ouvre dans un nouvel onglet qui n'a pas la main
   * sur cette page. Une action à la fois par widget ; aucune en mode Modifier (elle n'est peut-être pas encore rangée).
   */
  const lancements = new Set();
  async function toucher(w) {
    const t = R.toucherDe(w);
    if (t.quoi === 'appli') { location.hash = `#app=${t.appli}`; return; }
    if (t.quoi === 'ecran') { location.hash = t.ecran === 'maison' ? '#maison' : '#home'; return; }
    if (t.quoi === 'adresse') { window.open(t.adresse, '_blank', 'noopener,noreferrer'); return; }
    if (t.quoi !== 'action' || edit || lancements.has(w.id)) return;
    lancements.add(w.id);
    try {
      let r = await act(t.appli, t.action, t.input);
      if (r.confirm) r = (await window.OdinDialog.confirm(r.confirm, { danger: true })) ? await act(t.appli, t.action, t.input, true) : { ok: true, text: R.TEXTES.toucher.annule };
      say(r.ok ? r.text : `✗ ${r.text ?? r.error}`);
    } catch { say('✗ Odin ne répond pas.'); } finally { lancements.delete(w.id); }
  }

  // ------------------------------------------------------------------ « Régler » un widget (lot 25b)
  /**
   * À qui ce widget est ouvert, s'il lit une appli de la vie privée : { privee, connu, noms }. Pas encore rangé : à
   * personne. Ce qu'on n'a pas pu lire : `connu` faux (le plus sûr est alors retenu partout).
   */
  async function ouvertA(w) {
    if (!R.VIE_PRIVEE.includes(appliDe(w))) return { privee: false, connu: true, noms: [] };
    if (!JSON.parse(saved).pages.flatMap((p) => p.widgets).some((x) => x.id === w.id)) return { privee: true, connu: true, noms: [] };
    try { const r = await act('gladsheim', 'ouvertures_widget', { widget: w.id }); if (r.ok && Array.isArray(r.data?.personnes)) return { privee: true, connu: true, noms: r.data.personnes.filter((g) => g.ouvert).map((g) => String(g.name)) }; } catch { /* pas lu */ }
    return { privee: true, connu: false, noms: [] };
  }
  /**
   * La fenêtre « Régler » de la maquette (ses mots sont dans pages/widgets-rendu.js). Tout se fait sur la fenêtre en
   * cours de modification : rien n'est gardé avant « Terminé », et « Annuler » (la barre du mode Modifier) remet tout.
   * - une adresse est vérifiée ici, puis nettoyée par le serveur au rangement (http ou https seulement) ;
   * - changer « Quand je touche » (ou ce qu'il montre) d'un widget ouvert à quelqu'un le referme pour cette personne
   *   au rangement : c'est dit ici, avant de valider ;
   * - « Copier vers l'autre écran » : refusé pour les quatre sortes de l'accueil et pour un widget de la vie privée qui
   *   n'est ouvert à personne ; « Retirer » : absent sur « À faire ».
   */
  async function reglerWidget(w) {
    const T = R.TEXTES.reglage, titre = titreDe(w), mod = cat?.modules?.find((m) => m.id === w.module), ouv = await ouvertA(w);
    const tuile = (() => { const a = appliDe(w); if (!a || !window.OdinAppIcons) return null; const sp = el('span', {}); sp.innerHTML = window.OdinAppIcons.tile(a, modName(a), 40); return sp.firstElementChild ?? sp; })();
    // Pendant les lectures, le widget a pu quitter la fenêtre en cours (« Annuler » du mode Modifier) : plus rien à régler.
    const encoreLa = () => edit && L.pages.some((p) => p.widgets.includes(w));
    if (!encoreLa()) return;
    const corps = [];
    // Le titre. Un site surveillé porte le nom de sa sonde : il ne se change pas ici.
    const fTitre = el('input', { id: 'wrRT', type: 'text', maxlength: '40', value: w.label ?? '', placeholder: titreDe({ ...w, label: undefined }), autocomplete: 'off', disabled: w.kind === 'site' });
    corps.push(R.champ(T.champTitre, fTitre.id, fTitre, w.kind === 'site' ? el('p', { class: 'wr-aide' }, T.titreSite) : null));
    // Ce qu'il montre (un module d'appli) : ses chiffres clés, ou une partie de sa page.
    let fMontre = null; const montre0 = w.kind === 'section' ? w.section ?? '' : '';
    if (w.kind === 'section' || w.kind === 'chiffres') {
      let v = views.get(w.module); if (!v) { try { v = (await api(`/api/valhalla/view?id=${encodeURIComponent(w.module)}`)).view; } catch { v = null; } }
      const secs = [...(v?.sections ?? []), ...(v?.side ?? [])].filter((x) => x.kind !== 'form' && x.title).map((x) => x.title);
      if (!encoreLa()) return;
      if (montre0 && !secs.includes(montre0)) secs.unshift(montre0);
      fMontre = el('select', { id: 'wrRM' }, el('option', { value: '' }, T.chiffres), ...secs.map((x) => el('option', { value: x, selected: x === montre0 ? true : undefined }, x)));
      corps.push(R.champ(T.montre, fMontre.id, fMontre));
    }
    // L'appli d'un widget qui la choisit (le widget « appli ») : les applis actives du catalogue de qui regarde (déjà
    // réduit à ses droits), par leur nom ; celle de la carte reste dans la liste même coupée, et retirée sous le titre
    // neutre de la sorte (jamais son identifiant).
    let fAppli = null; const rfA = renduDe(w), appli0 = rfA && !rfA.appli && w.module ? w.module : '';
    if (appli0) {
      const mods = (cat?.modules ?? []).filter((m) => m.id === appli0 || OT.active(m));
      const opts = mods.map((m) => el('option', { value: m.id, selected: m.id === appli0 ? true : undefined }, m.name));
      if (!mods.some((m) => m.id === appli0)) opts.unshift(el('option', { value: appli0, selected: true }, rfA.titre));
      fAppli = el('select', { id: 'wrRApp' }, ...opts);
      corps.push(R.champ(TXT.appliMontree, fAppli.id, fAppli));
    }
    // La taille : les sept tailles toutes faites (celles plus petites que la mini du widget n'y sont pas).
    const now = G.tailleChoisie(w);
    const radios = el('div', { class: 'wr-sizes' }, ...G.taillesPossibles(w.kind).map((x) => el('label', {}, el('input', { type: 'radio', name: 'wrTaille', value: x.nom, checked: x.nom === now ? true : undefined }), TXT.tailles[x.nom] ?? x.nom, el('small', {}, G.etiquette(x)))));
    corps.push(R.champ(T.taille, '', radios, el('p', { class: 'wr-aide' }, T.aideTaille)));
    // Le style : seulement pour une sorte qui en a plus d'un.
    const styles = Array.isArray(R.STYLES[w.kind]) ? R.STYLES[w.kind] : [], style0 = w.style ?? styles[0]?.[0];
    const fStyle = styles.length > 1 ? el('div', { class: 'wr-sizes' }, ...styles.map(([v, n]) => el('label', {}, el('input', { type: 'radio', name: 'wrStyle', value: v, checked: v === style0 ? true : undefined }), n))) : null;
    if (fStyle) corps.push(R.champ(T.style, '', fStyle));
    // « Quand je touche le widget » : les cinq choix de la maquette. Une action : celles de l'appli du widget seulement.
    // L'appli se choisit (le widget « appli ») : le nom et les actions suivent l'appli choisie dans « L'appli montrée »
    // (retirée ou inconnue : le titre neutre de la sorte, jamais son identifiant).
    const t0 = R.toucherDe(w); let appliVue = w.module;
    const memeAppli = () => appliVue === w.module;
    const nomOuvrir = (id) => (fAppli ? nomConnu(id) || rfA.titre : modName(id));
    const actionsDe = (id) => { const m = cat?.modules?.find((x) => x.id === id); return w.kind !== 'bouton' && m && OT.active(m) ? [...(m.actions ?? [])] : []; };
    let actions = actionsDe(w.module);
    // L'action déjà choisie reste dans la liste, même si l'appli ne la propose plus (désactivée, action retirée) :
    // ouvrir « Régler » pour changer le titre ne la fait pas disparaître sans le dire.
    if (t0.quoi === 'action' && !actions.some((a) => a.id === t0.action)) actions.unshift({ id: t0.action, label: t0.action, params: Object.keys(t0.input).map((k) => ({ key: k, label: k, kind: 'text' })) });
    const choixDe = () => [w.module ? ['appli', T.choix.appli(nomOuvrir(appliVue))] : null, actions.length ? ['action', T.choix.action] : null, ['ecran', T.choix.ecran], ['adresse', T.choix.adresse], ['rien', T.choix.rien]].filter(Boolean);
    const fQuoi = el('select', { id: 'wrRQ' }, ...choixDe().map(([v, n]) => el('option', { value: v, selected: v === t0.quoi ? true : undefined }, n)));
    const sous = el('div', { class: 'wr-sous' });
    const remplir = () => {
      const q = fQuoi.value;
      if (q === 'action') {
        const fA = el('select', { id: 'wrRA' }, ...actions.map((a) => el('option', { value: a.id, selected: memeAppli() && t0.quoi === 'action' && a.id === t0.action ? true : undefined }, `${a.label}${a.grave ? ' ⚠' : ''}`)));
        const params = el('div', { class: 'wr-sous' }), aide = el('p', { class: 'wr-aide' });
        const remplirParams = () => {
          const a = actions.find((x) => x.id === fA.value), garde = memeAppli() && t0.quoi === 'action' && t0.action === fA.value ? t0.input : {};
          params.replaceChildren(...(a?.params ?? []).filter((x) => x.kind !== 'password').map((x) => { const i = `wrRP-${x.key}`, val = String(garde[x.key] ?? x.default ?? '');
            return R.champ(`${x.label}${x.required ? ' *' : ''}`, i, x.kind === 'select' ? el('select', { id: i, 'data-k': x.key }, ...(x.options ?? []).map((o) => el('option', { value: o, selected: String(o) === val ? true : undefined }, o))) : el('input', { id: i, type: 'text', 'data-k': x.key, value: val, maxlength: '300', autocomplete: 'off' })); }));
          aide.textContent = a?.grave ? T.aideGrave : '';
        };
        fA.addEventListener('change', remplirParams); remplirParams();
        sous.replaceChildren(R.champ(T.action, fA.id, fA, aide), params);
      } else if (q === 'ecran') {
        const fE = el('select', { id: 'wrRE' }, ...R.ECRANS_TOUCHER.map((x) => el('option', { value: x, selected: t0.quoi === 'ecran' && t0.ecran === x ? true : undefined }, T.ecrans[x])));
        sous.replaceChildren(R.champ(T.ecran, fE.id, fE));
      } else if (q === 'adresse') {
        const fU = el('input', { id: 'wrRU', type: 'url', inputmode: 'url', placeholder: 'https://', maxlength: String(R.ADRESSE_MAX), value: t0.quoi === 'adresse' ? t0.adresse : '', autocomplete: 'off', spellcheck: 'false' });
        sous.replaceChildren(R.champ(T.adresse, fU.id, fU, el('p', { class: 'wr-aide' }, T.adresseAide)));
      } else sous.replaceChildren();
    };
    fQuoi.addEventListener('change', remplir); remplir();
    corps.push(R.champ(T.toucher, fQuoi.id, fQuoi), sous);
    // Une autre appli choisie : l'en-tête, le titre proposé, « Ouvrir … » et les actions deviennent les siens ; un choix
    // « action » reste seulement si la nouvelle appli en a.
    fAppli?.addEventListener('change', () => {
      appliVue = fAppli.value;
      actions = memeAppli() ? actionsDe(w.module) : actionsDe(appliVue);
      if (memeAppli() && t0.quoi === 'action' && !actions.some((a) => a.id === t0.action)) actions.unshift({ id: t0.action, label: t0.action, params: Object.keys(t0.input).map((k) => ({ key: k, label: k, kind: 'text' })) });
      const avant = fQuoi.value, opts = choixDe();
      fQuoi.replaceChildren(...opts.map(([v, n]) => el('option', { value: v }, n)));
      fQuoi.value = opts.some(([v]) => v === avant) ? avant : opts[0][0];
      remplir();
      const titreVu = titreDe({ ...w, module: appliVue, label: undefined });
      fTitre.placeholder = titreVu;
      const h = f && document.getElementById(f.d.getAttribute('aria-labelledby')); if (h) h.textContent = T.titre(w.label || titreVu);
      const ic = f?.d.querySelector('.wr-ic.wr-app');
      if (ic && window.OdinAppIcons) { const sp = el('span', {}); sp.innerHTML = window.OdinAppIcons.tile(appliVue, nomConnu(appliVue) || rfA.titre, 40); ic.replaceChildren(sp.firstElementChild ?? sp); }
    });
    /** Ce que la fenêtre dit vouloir : « Quand je touche » (rien d'écrit : ouvrir l'appli) et ce qu'il montre. */
    const lire = () => {
      const q = fQuoi.value; let t;
      if (q === 'action') { const input = Object.fromEntries([...sous.querySelectorAll('[data-k]')].map((n) => [n.dataset.k, n.value]).filter(([, v]) => v !== '')); t = { quoi: 'action', action: $('#wrRA', sous)?.value ?? '', ...(Object.keys(input).length ? { input } : {}) }; }
      else if (q === 'ecran') t = { quoi: 'ecran', ecran: $('#wrRE', sous)?.value };
      else if (q === 'adresse') t = { quoi: 'adresse', adresse: ($('#wrRU', sous)?.value ?? '').trim() };
      else if (q === 'rien' && w.module) t = { quoi: 'rien' };
      return { toucher: t, section: fMontre ? fMontre.value : montre0, appli: fAppli ? fAppli.value : appli0 };
    };
    const sig = (x) => JSON.stringify([x.toucher ?? null, x.section, x.appli]), depart = sig(lire());
    // La vie privée : à qui il est ouvert, « Ouvrir à… », et ce qu'un changement refermerait (dit avant de valider).
    const alerte = el('p', { class: 'wr-note wr-att', role: 'status', 'aria-live': 'polite' }), statut = el('p', { class: 'wr-note', role: 'status', 'aria-live': 'polite' }), erreur = el('p', { class: 'wr-note wr-non', role: 'alert' });
    let f = null;
    if (ouv.privee) corps.push(el('div', { class: 'wr-rang' }, el('p', { class: 'wr-aide' }, !ouv.connu ? '' : ouv.noms.length ? T.ouvertA(ouv.noms.join(', ')) : T.ouvertAPersonne), R.bouton(T.ouvrirA, () => { f.fermer(); ouvrirA(w); })));
    const surveiller = () => { erreur.textContent = ''; alerte.textContent = !ouv.privee || sig(lire()) === depart ? '' : !ouv.connu ? T.refermeInconnu : ouv.noms.length ? T.referme(ouv.noms.join(', ')) : ''; };
    corps.push(alerte, statut, erreur);
    const rendre = () => { const c = $(`#feGrid .fe-w[data-id="${CSS.escape(w.id)}"]`); return c?.querySelector('.wr-plus') ?? c?.querySelector('.fe-grip') ?? $('#fenetre .fe-ajout') ?? $('#fenetre .fe-tab'); };
    const valider = () => {
      const x = lire(); erreur.textContent = '';
      if (x.toucher?.quoi === 'adresse') { const a = R.adresseNette(x.toucher.adresse); if (!a) { erreur.textContent = T.adresseRefusee; $('#wrRU', sous)?.focus(); return; } x.toucher.adresse = a; }
      if (x.toucher?.quoi === 'action' && !x.toucher.action) { erreur.textContent = T.aucuneAction; return; }
      const taille = radios.querySelector('input:checked')?.value;
      if (taille && taille !== now && !G.choisir(w, taille)) { erreur.textContent = T.tailleRefusee; return; }
      if (w.kind !== 'site') { const v = fTitre.value.trim().slice(0, 40); if (v) w.label = v; else delete w.label; }
      // Une autre appli : la liste des actions est déjà la sienne ; une action qui n'y serait pas n'est jamais gardée.
      if (fAppli && x.appli && x.appli !== appli0) { w.module = x.appli; if (x.toucher?.quoi === 'action' && !actions.some((a) => a.id === x.toucher.action)) x.toucher = undefined; }
      if (fMontre && x.section !== montre0) { if (x.section) { w.kind = 'section'; w.section = x.section; } else { w.kind = 'chiffres'; delete w.section; } }
      const st = fStyle?.querySelector('input:checked')?.value; if (st) { if (st === styles[0][0]) delete w.style; else w.style = st; }
      if (x.toucher) w.toucher = x.toucher; else delete w.toucher;
      f.fermer(); draw().then(() => rendre()?.focus());
    };
    // « Copier vers l'autre écran » : vers la première page de l'autre écran (créée s'il n'y en a pas), avec un nouvel identifiant.
    const versMaison = !page().maison;
    const copier = R.bouton(versMaison ? T.copier.maison : T.copier.accueil, () => {
      // Les blocs du jour ne quittent jamais l'accueil, même une sorte que le script commun ne connaît pas encore.
      if (JOUR.includes(w.kind)) { statut.textContent = T.copieReservee; return; }
      const refus = R.copieRefusee({ kind: w.kind, privee: ouv.privee, ouvert: ouv.connu && ouv.noms.length > 0 });
      if (refus) { statut.textContent = refus === 'reservee' ? T.copieReservee : T.copiePrivee; return; }
      let cible = L.pages.find((p) => Boolean(p.maison) === versMaison);
      // Huit pages au plus, sans compter une page rangée sous un code (« Aujourd'hui »), comme chez Hestia (PAGES_MAX).
      if ((!cible && L.pages.filter((p) => !p.code).length >= 8) || (cible && cible.widgets.length >= 48)) { statut.textContent = T.copiePleine; return; }
      if (!cible) { cible = { id: '', name: versMaison ? T.pages.maison : T.pages.accueil, ...(versMaison ? { maison: true } : {}), widgets: [] }; L.pages.push(cible); }
      cible.widgets.push({ ...JSON.parse(JSON.stringify(w)), id: G.nouvelId(L.pages.flatMap((p) => p.widgets.map((x) => x.id))) });
      statut.textContent = `${T.copie(nomDe(cible))}${ouv.privee ? T.copieFermee : ''} ${T.pied}`; draw();
    });
    // « Retirer » : pas sur « À faire » (il se déplace, il ne se retire pas).
    const retirer = R.retirable(w.kind) ? R.bouton(T.retirer, () => {
      page().widgets = page().widgets.filter((x) => x.id !== w.id); f.fermer();
      draw().then(() => { dire(T.retire(titre)); say(`${T.retire(titre)} ${T.pied}`); rendre()?.focus(); });
    }, 'danger') : null;
    f = R.fenetreRegler({ titre, tuile, lettre: renduDe(w)?.symbole || (w.kind === 'heure' ? '🕒' : w.kind === 'meteo' ? '☀' : TXT.jour.lettres[w.kind]), corps, rendre,
      pied: [copier, retirer, el('div', { class: 'wr-fin' }, R.bouton(T.annuler, () => f.fermer()), R.bouton(T.valider, valider, 'p')), el('p', { class: 'wr-aide' }, T.pied)] });
    f.d.addEventListener('input', surveiller); f.d.addEventListener('change', surveiller);
    // Entrée dans un champ de texte : valider (comme le bouton).
    f.d.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.target?.tagName === 'INPUT' && e.target.type !== 'radio') { e.preventDefault(); valider(); } });
  }
  /** « Site surveillé » : une sonde de Pulsar déjà là, ou un nouveau site à surveiller (Pulsar le vérifie ensuite tout seul). */
  async function siteSurveille() {
    let sondes = [];
    try { const r = await api('/api/valhalla/view?id=vordr'); sondes = ((r.view?.sections ?? []).find((x) => x.kind === 'table' && x.title === 'Sondes')?.rows ?? []).map((x) => x.cells[0]); } catch { /* Pulsar ne répond pas : on peut quand même en créer une */ }
    const sel = el('select', { id: 'feSo' }, el('option', { value: '' }, 'Un nouveau site…'), ...sondes.map((n) => el('option', { value: n }, n)));
    const nom = el('input', { id: 'feSn', placeholder: 'Nom (ex. Mon site)', maxlength: '60' }), url = el('input', { id: 'feSu', placeholder: 'Adresse (ex. https://exemple.fr)', inputmode: 'url' });
    const neuf = el('div', {}, el('label', { for: 'feSn' }, 'Nom'), nom, el('label', { for: 'feSu' }, 'Adresse du site'), url);
    sel.onchange = () => { neuf.hidden = Boolean(sel.value); };
    dialog('Site surveillé', el('div', {}, el('label', { for: 'feSo' }, 'Sonde de Pulsar'), sel, neuf), () => {
      if (sel.value) return add({ kind: 'site', module: 'vordr', label: sel.value });
      const n = nom.value.trim(), u = url.value.trim();
      if (!n || !/^https?:\/\/\S+$/i.test(u)) { say('Donne un nom et une adresse qui commence par http:// ou https://.'); return false; }
      act('vordr', 'ajouter', { nom: n, genre: 'http', cible: u }).then((r) => { say(r.ok ? `Pulsar surveille maintenant « ${n} ».` : `✗ ${r.text || r.error || 'Pulsar a refusé'}`); if (r.ok) add({ kind: 'site', module: 'vordr', label: n }); });
    });
  }
  function ownButton() {
    const mods = (cat?.modules ?? []).filter(OT.active), ms = el('select', { id: 'feM' }, ...mods.map((m) => el('option', { value: m.id }, m.name))), as = el('select', { id: 'feA' }), params = el('div', {}), lab = el('input', { id: 'feL', placeholder: 'ex. Bloquer YouTube jusqu\'à 20 h' });
    const fillA = () => { const m = mods.find((x) => x.id === ms.value); as.replaceChildren(...(m?.actions ?? []).map((a) => el('option', { value: a.id }, `${a.label}${a.grave ? ' ⚠' : ''}`))); fillP(); };
    const fillP = () => { const a = mods.find((x) => x.id === ms.value)?.actions.find((x) => x.id === as.value); params.replaceChildren(...(a?.params ?? []).filter((p) => p.kind !== 'password').map((p) => el('div', {}, el('label', { for: `feP-${p.key}` }, `${p.label}${p.required ? ' *' : ''}`), p.kind === 'select' ? el('select', { id: `feP-${p.key}`, 'data-k': p.key }, ...(p.options ?? []).map((o) => el('option', { value: o }, o))) : el('input', { id: `feP-${p.key}`, 'data-k': p.key, value: p.default ?? '' })))); };
    ms.onchange = fillA; as.onchange = fillP; fillA();
    dialog('Bouton sur mesure', el('div', {}, el('label', { for: 'feM' }, 'Appli'), ms, el('label', { for: 'feA' }, 'Action'), as, params, el('label', { for: 'feL' }, 'Texte du bouton'), lab), () => {
      const input = Object.fromEntries([...params.querySelectorAll('[data-k]')].map((n) => [n.dataset.k, n.value]).filter(([, v]) => v !== ''));
      const a = mods.find((x) => x.id === ms.value)?.actions.find((x) => x.id === as.value); if (!a) return false;
      return add({ kind: 'bouton', module: ms.value, action: as.value, input, label: lab.value.trim() || a.label });
    });
  }

  // ------------------------------------------------------------------ montage
  async function mount() {
    // Le corps de l'accueil, enfant direct de la vue : la mascotte du salut (dans le bandeau, plus haut) a elle aussi un
    // « .body » dans son dessin ; si la page charge lentement, elle est déjà là, et la fenêtre s'y poserait, invisible.
    const body = $('#v-home > .body'); if (!body || $('#fenetre')) return;
    body.prepend(el('div', { id: 'fenetre', 'aria-label': 'Ma fenêtre' }, el('p', { class: 'fe-err' }, 'Chargement de ta fenêtre…')));
    try { await load(); await fetchViews(); await draw(); } catch (e) { host().replaceChildren(el('p', { class: 'fe-err' }, `Fenêtre indisponible : ${e.message}`)); return; }
    clearInterval(timer); timer = setInterval(async () => { if (edit || glisse || appuiEnCours || document.hidden || !$('#v-home.on')) return; await fetchViews(); draw(); }, 60_000);
  }
  // ------------------------------------------------------------------ l'accueil en plein écran (lot 22a)
  // Le bouton du bandeau (#homeFull, pages/plein-ecran.js) pose `pe-plein` sur l'accueil : le style ci-dessus ne laisse
  // que les widgets. Le bandeau disparaît avec son bouton : un rond discret de 44 px, en haut à droite, sert à sortir au
  // doigt ; Échap aussi (après ce qui est ouvert par-dessus : la barre de commande, le tiroir, une boîte de dialogue).
  const SORTIE = TXT.sortiePlein;
  function sortie() {
    const v = $('#v-home'); if (!v) return null;
    let b = $('#feSortie');
    if (!b) {
      b = el('button', { id: 'feSortie', class: 'fe-sortie', type: 'button', 'aria-label': SORTIE, title: SORTIE, onclick: () => window.OdinPleinEcran?.sortir() });
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    }
    if (b.parentNode !== v) v.append(b);
    return b;
  }
  document.addEventListener('odin:plein-ecran', (e) => {
    const c = e.detail?.cible; if (!c || c.id !== 'v-home') return;
    const b = sortie(); if (!b) return;
    const a = document.activeElement;
    if (e.detail.actif) {
      // Le focus était sur le bouton du bandeau, maintenant caché : il passe au rond de sortie.
      if (!a || a === document.body || a.id === 'homeFull' || !a.getClientRects().length) b.focus({ preventScroll: true });
      say(TXT.enPlein);
    } else if (!a || a === document.body || a === b) $('#homeFull')?.focus({ preventScroll: true });
  });
  window.OdinFenetre = { mount, state: () => ({ L, cur, edit }), edit: (on = true) => { edit = on; return draw(); }, aujourdhui };
  // Après la connexion seulement (la page de connexion n'a pas de fenêtre).
  const tryMount = () => { const app = $('#app'); if (app && !app.hidden && $('#v-home > .body')) mount(); else setTimeout(tryMount, 1500); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryMount); else tryMount();
  // Le choix de l'animation (lot 17) dans Réglages → Apparence, à la place que themes.js réserve en posant ses cartes
  // (themes.js est chargé après : on attend la fin de son installation).
  const poserAnimations = () => { OA.poser({ act }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(poserAnimations, 0)); else setTimeout(poserAnimations, 0);
})();
