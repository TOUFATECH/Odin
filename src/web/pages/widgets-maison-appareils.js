// La famille « Maison » des widgets de l'accueil, ses appareils (maquette validée « Accueil ») : la tuile d'un appareil,
// la lumière, le capteur, les pièces (en liste et en tuiles). Rangée à part de widgets-maison.js : la même famille.
// Ce fichier DÉCLARE ses sortes au registre commun (pages/widgets-rendu.js) ; chaque dessin est fait de l'état que le
// serveur a rendu pour le widget (src/valhalla/widgets/maison-appareils.ts) et de rien d'autre.
// - Les commandes sont celles que le serveur a servies (le modèle de la carte d'aujourd'hui) : allumer et éteindre,
//   l'intensité d'une lumière (sans nombre de départ : Odin ne la lit pas), monter-arrêter-descendre un volet, la clim
//   (moins, plus, marche, arrêt ; moins et plus seulement si sa consigne est lue), le lecteur, l'aspirateur, la serrure à
//   glisser. Elles partent par la route qui existe (POST /api/maison/appareil) ; ce qui doit l'être demande l'accord à
//   chaque fois (la réponse du serveur), et sans accord rien ne part. Le résultat est écrit ; l'état montré ensuite est
//   celui que le serveur rend (relu juste après) ; rien n'est retourné d'avance.
// - En mode « Modifier », rien ne part. Le focus revient à la même commande quand la page se redessine.
// - Tout texte venu d'une donnée (un nom d'appareil, de pièce, un état) est posé par textContent ; seules les icônes
//   dessinées ici ne le sont pas. Les nombres dans la langue de la page. Aucune langue écrite.
// Rien n'est touché au chargement : seulement window.OdinWidgetsMaisonAppareils (ses textes, pour les essais) et sa déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsMaisonAppareils) return;

  // ---------------- Dictionnaire (tous les textes de cette part de la famille)
  const TEXTES = {
    appareil: { titre: 'Appareil', quoi: 'Un appareil de la maison, avec toutes les commandes de sa carte.' },
    lumiere: { titre: 'Lumière', quoi: 'Une lumière : l\'allumer, l\'éteindre, régler son intensité.' },
    capteur: { titre: 'Capteur', quoi: 'Une mesure de la maison, sa pièce et son âge.' },
    pieces: { titre: 'Pièces', quoi: 'Chaque pièce, ce qui y est allumé ; allumer ou éteindre ses lumières d\'un geste.', tuiles: 'Pièces en tuiles' },
    etats: { on: 'Allumé', off: 'Éteint', open: 'Ouvert', closed: 'Fermé', opening: 'S\'ouvre', closing: 'Se ferme', playing: 'En lecture', paused: 'En pause', idle: 'En veille', standby: 'En veille', locked: 'Verrouillée', unlocked: 'Ouverte', locking: 'Se verrouille', unlocking: 'S\'ouvre', jammed: 'Bloquée', heat: 'Chauffe', cool: 'Refroidit', auto: 'Auto', dry: 'Déshumidifie', fan_only: 'Ventile', cleaning: 'Nettoie', docked: 'Sur sa base', returning: 'Rentre', true: 'Allumé', false: 'Éteint' },
    allume: 'Allumé', eteint: 'Éteint', horsLigne: 'Hors ligne', muet: 'Sans nouvelles depuis plus de 24 h', inconnu: 'État inconnu',
    c: {
      allumer: 'Allumer', eteindre: 'Éteindre', intensite: (nom) => `Intensité de ${nom}`, nonMesuree: 'Intensité non mesurée',
      monter: 'Monter', arreter: 'Arrêter', descendre: 'Descendre', moins: 'Moins chaud', plus: 'Plus chaud', sansConsigne: 'Consigne non lue',
      marche: 'Marche', arret: 'Arrêt', precedent: 'Précédent', lecture: 'Lecture', pause: 'Pause', suivant: 'Suivant', nettoyer: 'Nettoyer', base: 'Base',
      glisser: 'Glisser pour ouvrir ›', ouvrir: (nom) => `Glisser pour ouvrir ${nom}`, verrouiller: 'Verrouiller',
      demande: (t) => `Demandé : ${t}`,
    },
    accord: { oui: 'Confirmer', non: 'Annuler' },
    envoi: 'Envoi…', fait: 'Fait.', sansAccord: 'Rien n\'est parti : pas d\'accord.', modification: 'En mode « Modifier », rien ne part.', injoignable: 'Odin ne répond pas : rien n\'est parti.', refus: (n) => `Refusé (${n}).`,
    sansPiece: 'Sans pièce', appareils: (n) => `${n} ${n === 1 ? 'appareil' : 'appareils'}`, toutEteint: 'Tout est éteint', enPlus: (n) => `et ${n} de plus`,
    nPieces: (n) => `${n} ${n === 1 ? 'pièce' : 'pièces'}`, nAllumes: (n) => `${n} ${n === 1 ? 'allumé' : 'allumés'}`,
    lumieres: (p, on) => `Lumières de ${p} : ${on ? 'éteindre' : 'allumer'}`, aucuneLumiere: 'Aucune lumière à commander',
    vides: { appareil_non_choisi: 'Aucun appareil choisi.', appareil_absent: 'Cet appareil n\'existe plus.', appareil_autre_sorte: 'L\'appareil choisi n\'est pas de cette sorte.', aucun_appareil: 'Aucun appareil relié à Odin.' },
    // Pas encore choisi, et aucun appareil de ce genre dans la maison : dits selon la sorte du widget.
    nonChoisi: { appareil: 'Aucun appareil choisi.', lumiere: 'Aucune lumière choisie.', capteur: 'Aucun capteur choisi.' },
    aucun: { appareil: 'Aucun appareil dans la maison.', lumiere: 'Aucune lumière dans la maison.', capteur: 'Aucun capteur dans la maison.', mesure: 'Aucun capteur de cette mesure dans la maison.' },
    boutons: { choisir: 'Choisir', ajouter: 'Ajouter un appareil' },
    // Le bouton d'un widget pas encore choisi dit ce qu'il fait choisir (la pose depuis le tiroir, choix annulé).
    choisirQuoi: { appareil: 'Choisir un appareil', lumiere: 'Choisir une lumière', capteur: 'Choisir un capteur' },
    // La pose depuis le tiroir, quand Odin ne peut pas lire les appareils de la maison : rien n'est posé.
    poseIllisible: 'Odin ne lit pas les appareils de la maison en ce moment : rien n\'est posé.',
    // Le champ du choix dans « Régler » (la fenêtre commune le pose ; ses autres mots sont dans pages/widgets-rendu.js).
    regler: {
      libelles: { appareil: 'L\'appareil montré', lumiere: 'La lumière montrée', capteur: 'Le capteur montré', mesure: 'Ce qu\'il mesure' },
      choisir: 'Choisir…', tous: 'Tous les capteurs (la moyenne)', retire: 'Appareil retiré', groupes: { pieces: 'Pièces', capteurs: 'Capteurs' },
      aRanger: 'Appuie sur « Terminé », puis rouvre « Régler » pour choisir.', aucun: null,
    },
    lu: (age) => `lu ${age}`,
  };
  TEXTES.regler.aucun = TEXTES.aucun;
  const T = TEXTES;
  /** Les codes de commande que cette page sait dessiner (ceux du modèle du serveur ; un essai compare les deux). */
  const CODES = ['interrupteur', 'intensite', 'monter', 'arreter', 'descendre', 'consigne', 'marche_arret', 'precedent', 'lecture_pause', 'suivant', 'nettoyer', 'base', 'ouvrir', 'verrouiller'];

  // ---------------- Calculs (sans document)
  const texte = (v) => (typeof v === 'string' ? v : '');
  const langue = () => { try { return document.documentElement.lang || undefined; } catch { return undefined; } };
  function nombre(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '';
    try { return new Intl.NumberFormat(langue(), { maximumFractionDigits: 1 }).format(v); } catch { return String(v); }
  }
  /** L'état dit en mots (un état connu), sinon tel quel (une donnée). */
  const etatDit = (d) => { const e = texte(d.etat), k = e.trim().toLowerCase(); return Object.prototype.hasOwnProperty.call(T.etats, k) ? T.etats[k] : e; };

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const ICONES = {
    ampoule: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    prise: '<path d="M12 3v5M8.5 5.5a7 7 0 1 0 7 0"/>',
    thermo: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
    maison: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-5h4v5"/>',
    haut: '<path d="M6 15l6-6 6 6"/>', bas: '<path d="M6 9l6 6 6-6"/>', stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
    moins: '<path d="M6 12h12"/>', plus: '<path d="M12 6v12M6 12h12"/>',
    avant: '<path d="M18 6l-8 6 8 6zM7 6v12"/>', apres: '<path d="M6 6l8 6-8 6zM17 6v12"/>', lire: '<path d="M8 5l11 7-11 7z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
    cadenas: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  };
  const ICONE_SORTE = { 'lumière': 'ampoule', capteur: 'thermo', 'détecteur': 'thermo', serrure: 'cadenas' };
  const icone = (k) => (Object.prototype.hasOwnProperty.call(ICONES, k) ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[k]}</svg>` : '');
  // Les couleurs : celles du thème d'Odin (--accent, --good, --warn, --ink, --muted, --line) ou, sur l'écran de la maison,
  // celles de son thème (--text). Aucune couleur n'est écrite ici. Toute cible fait 44 px.
  const CSS = `
.wma{display:flex;flex-direction:column;gap:6px;min-width:0;min-height:0;flex:1;overflow:hidden;color:inherit}
.wma-l1{display:flex;align-items:center;gap:8px;min-width:0}
.wma-ic{flex:none;width:30px;height:30px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent,currentColor) 16%,transparent);color:var(--accent,currentColor)}
.wma-ic svg{width:18px;height:18px}.wma[data-on="1"] .wma-ic{background:color-mix(in srgb,var(--warn,currentColor) 22%,transparent);color:var(--warn,currentColor)}
.wma-t{flex:1;min-width:0;display:flex;flex-direction:column}
.wma-nom{font-weight:650;font-size:14px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink,var(--text,inherit))}
.wma-s{font-size:12px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted,inherit)}
.wma-s[data-ton="alarme"]{color:var(--warn,inherit);font-weight:650}
.wma-cmd{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.wma-b{box-sizing:border-box;min-width:44px;min-height:44px;height:44px;padding:0 10px;border-radius:12px;border:1px solid var(--line,currentColor);background:color-mix(in srgb,var(--ink,var(--text,currentColor)) 6%,transparent);color:inherit;font:inherit;font-size:13px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:4px;cursor:pointer;white-space:nowrap}
.wma-b svg{width:18px;height:18px}.wma-b.wma-i{padding:0;width:44px}
.wma-b:disabled{opacity:.45;cursor:default}
.wma-b:focus-visible,.wma-r:focus-visible,.wma-sw:focus-visible,.wma-tu:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
.wma-sw{box-sizing:border-box;flex:none;width:56px;height:44px;padding:0;border:0;background:none;cursor:pointer;position:relative}
.wma-sw::before{content:'';position:absolute;left:4px;right:4px;top:10px;bottom:10px;border-radius:12px;background:color-mix(in srgb,var(--muted,currentColor) 35%,transparent)}
.wma-sw::after{content:'';position:absolute;left:8px;top:14px;width:16px;height:16px;border-radius:50%;background:var(--panel,var(--card2,#fff));box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}
.wma-sw[aria-checked="true"]::before{background:var(--accent,currentColor)}.wma-sw[aria-checked="true"]::after{transform:translateX(16px)}
.wma-r{box-sizing:border-box;flex:1 1 90px;min-width:90px;height:44px;margin:0;padding:0;cursor:pointer;-webkit-appearance:none;appearance:none;background:none;color:inherit}
.wma-r::-webkit-slider-runnable-track{height:8px;border-radius:4px;background:color-mix(in srgb,var(--muted,currentColor) 35%,transparent)}
.wma-r::-moz-range-track{height:8px;border-radius:4px;background:color-mix(in srgb,var(--muted,currentColor) 35%,transparent)}
.wma-r::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:22px;height:22px;margin-top:-7px;border:0;border-radius:50%;background:var(--accent,currentColor);box-shadow:0 1px 3px rgba(0,0,0,.3)}
.wma-r::-moz-range-thumb{width:22px;height:22px;border:0;border-radius:50%;background:var(--accent,currentColor);box-shadow:0 1px 3px rgba(0,0,0,.3)}
.wma-r:not([data-pose])::-webkit-slider-thumb{opacity:0}
.wma-r:not([data-pose])::-moz-range-thumb{opacity:0}
.wma-gl{position:relative;flex:1 1 150px;min-width:120px;display:flex}
.wma-gl>span{position:absolute;inset:0;display:block;line-height:44px;padding:0 10px 0 40px;font-size:12px;font-weight:600;color:var(--muted,inherit);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wma-gl .wma-r{position:relative}
.wma-gl .wma-r::-webkit-slider-runnable-track{height:36px;border-radius:18px}.wma-gl .wma-r::-moz-range-track{height:36px;border-radius:18px}
.wma-gl .wma-r::-webkit-slider-thumb{width:30px;height:30px;margin-top:3px}.wma-gl .wma-r::-moz-range-thumb{width:30px;height:30px}
.wma-msg:empty{display:none}
.wma-b.wma-grave{border-color:var(--warn,currentColor);background:color-mix(in srgb,var(--warn,currentColor) 18%,transparent)}
@container (max-width:220px){.wma-pi .wma-ic{display:none}}
.wma-n{min-width:3ch;font-size:13px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--ink,var(--text,inherit))}
.wma-deg{min-width:4ch;text-align:center;font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ink,var(--text,inherit))}
.wma-v{font-size:clamp(20px,9cqi,30px);font-weight:750;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink,var(--text,inherit))}
.wma-v small{font-size:.55em;font-weight:600;color:var(--muted,inherit)}
.wma-vide{margin:0;font-size:13px;color:var(--muted,inherit)}
.wma-vide-b{align-self:flex-start;flex:none}
.wma-li{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;min-height:0}
.wma-li li{display:flex;align-items:center;gap:8px;min-height:44px;min-width:0}
.wma-tus{display:grid;grid-template-columns:repeat(var(--wma-col,2),minmax(0,1fr));gap:6px;min-height:0}
.wma-tu{box-sizing:border-box;min-height:52px;min-width:44px;padding:6px 8px;border-radius:12px;border:1px solid var(--line,currentColor);background:color-mix(in srgb,var(--ink,var(--text,currentColor)) 5%,transparent);color:inherit;font:inherit;text-align:start;display:flex;flex-direction:column;justify-content:center;cursor:pointer;min-width:0}
.wma-tu b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wma-tu small{font-size:11.5px;color:var(--muted,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wma-tu[aria-pressed="true"]{border-color:var(--warn,currentColor);background:color-mix(in srgb,var(--warn,currentColor) 16%,transparent)}
.wma-tu:disabled{cursor:default;opacity:.6}
.wma-plus{font-size:12px;color:var(--muted,inherit)}
/* En mode « Modifier », les commandes ne réagissent pas ; « Choisir » (aucune commande : il ouvre « Régler ») oui. */
.fe-edit .wma button:not([data-action=choisir]),.fe-edit .wma input{pointer-events:none}
dialog.wma-accord{box-sizing:border-box;width:min(420px,calc(100% - 24px));padding:18px;border-radius:16px;border:1px solid var(--line,#D9DCE2);background:var(--panel,var(--card2,#FFF));color:var(--ink,var(--text,#14171C))}
dialog.wma-accord::backdrop{background:rgba(8,12,18,.55)}
dialog.wma-accord p{margin:0 0 14px;overflow-wrap:anywhere}dialog.wma-accord div{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle();
    if (document.getElementById('odinWidgetsMaisonAppareils')) return;
    const s = document.createElement('style'); s.id = 'odinWidgetsMaisonAppareils'; s.textContent = CSS; document.head.append(s);
  }
  function el(t, cls, txt) { const n = document.createElement(t); if (cls) n.className = cls; if (txt !== undefined) n.textContent = txt; return n; }
  function ic(k, cls = 'wma-ic') { const s = el('span', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = icone(k); return s; }

  // ---------------- Les ordres : la route d'aujourd'hui, l'accord quand le serveur le demande
  /** L'accord, dans une vraie fenêtre de dialogue (Échap ou « Annuler » : non). Le texte est celui du serveur. */
  function accord(phrase) {
    return new Promise((fin) => {
      poserStyle();
      const d = el('dialog', 'wma-accord'), p = el('p', '', phrase), bas = el('div'), ouvreur = document.activeElement;
      const non = el('button', 'wma-b', T.accord.non), oui = el('button', 'wma-b wma-grave', T.accord.oui);
      non.type = 'button'; oui.type = 'button'; non.dataset.choix = 'non'; oui.dataset.choix = 'oui';
      let rendu = false;
      non.addEventListener('click', () => d.close('non')); oui.addEventListener('click', () => d.close('oui'));
      d.addEventListener('close', () => { d.remove(); if (ouvreur && ouvreur.isConnected && typeof ouvreur.focus === 'function') ouvreur.focus(); if (!rendu) { rendu = true; fin(d.returnValue === 'oui'); } });
      p.id = `wmaAccord${Date.now().toString(36)}`; d.setAttribute('aria-labelledby', p.id);
      bas.append(non, oui); d.append(p, bas); document.body.append(d); d.showModal(); non.focus();
    });
  }
  async function poster(corps) {
    const r = await fetch('/api/maison/appareil', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(corps) });
    let j = {}; try { j = await r.json(); } catch { j = {}; }
    if (!r.ok) return { ok: false, text: texte(j.text) || texte(j.error) || T.refus(r.status) };
    return j && typeof j === 'object' ? j : {};
  }
  /** Un ordre à un appareil : rien en mode « Modifier » ; l'accord quand le serveur le demande ; sans accord, rien de plus. */
  async function ordonner(noeud, appareil, valeur) {
    if (noeud && noeud.closest && noeud.closest('.fe-edit')) return { ok: false, text: T.modification };
    try {
      let r = await poster({ appareil, valeur });
      if (r.confirm) { if (!(await accord(texte(r.confirm)))) return { ok: false, text: T.sansAccord }; r = await poster({ appareil, valeur, confirm: true }); }
      return { ok: r.ok !== false, text: texte(r.text).split('\n')[0] || (r.ok === false ? T.injoignable : T.fait) };
    } catch { return { ok: false, text: T.injoignable }; }
  }
  /** L'état frais d'un widget, relu après un ordre (gardé une minute : la page le préfère à une lecture plus ancienne). */
  const FRAIS = new Map(), RESULTATS = new Map();
  async function relire(wid) {
    try {
      const r = await fetch('/api/widgets/donnees', { headers: { 'x-odin': '1' }, credentials: 'same-origin' }), j = await r.json();
      const x = (Array.isArray(j && j.widgets) ? j.widgets : []).find((y) => y && y.id === wid);
      if (x) garderFrais(wid, x);
    } catch { /* la prochaine lecture de la page le dira */ }
  }
  const garderFrais = (wid, e) => { FRAIS.set(wid, { e, recu: Date.now() }); };
  /** L'état relu, s'il a moins d'une minute et n'est pas plus ancien que celui de la page (comparés par leur `at`). */
  const fraisDe = (wid, e) => {
    const f = FRAIS.get(wid); if (!f || Date.now() - f.recu >= 60_000) return e;
    const a = Number(e && e.at), b = Number(f.e && f.e.at);
    return Number.isFinite(a) && Number.isFinite(b) && a > b ? e : f.e;
  };
  /** L'intensité demandée depuis cette page (jamais mesurée : Odin ne la lit pas), par widget. */
  const DEMANDES = new Map();

  // ---------------- Le focus qui tient quand la page se redessine
  let focusVoulu = null;
  function suivreFocus(n, wid, cle) {
    n.dataset.cle = cle;
    n.addEventListener('focus', () => { focusVoulu = { wid, cle }; });
    n.addEventListener('blur', () => setTimeout(() => { if (n.isConnected && focusVoulu && focusVoulu.wid === wid && focusVoulu.cle === cle) focusVoulu = null; }, 0));
  }
  function rendreFocus(box, wid) {
    if (!focusVoulu || focusVoulu.wid !== wid) return;
    const essai = (k) => { const a = document.activeElement; if (!box.isConnected) { if (k < 5) setTimeout(() => essai(k + 1), 30); return; } if (a && a !== document.body && box.contains(a)) return; if (a && a !== document.body && a.isConnected && a.closest && !a.closest('.wma')) return;
      const n = [...box.querySelectorAll('[data-cle]')].find((x) => x.dataset.cle === focusVoulu.cle); if (n && typeof n.focus === 'function') n.focus({ preventScroll: true }); };
    queueMicrotask(() => essai(0));
  }

  // ---------------- Les commandes d'un appareil
  function bouton(code, libelle, faire, o = {}) {
    const b = el('button', `wma-b${o.icone ? ' wma-i' : ''}`); b.type = 'button'; b.dataset.code = code;
    if (o.icone) { b.append(ic(o.icone, '')); b.setAttribute('aria-label', libelle); b.title = libelle; } else b.textContent = libelle;
    if (o.pas) b.dataset.pas = String(o.pas);
    if (o.off) b.disabled = true; else b.addEventListener('click', faire);
    return b;
  }
  /** Les commandes servies, dessinées une par une ; `envoyer(valeur)` part par la route. */
  function commandes(d, envoyer, wid) {
    const out = [], nom = texte(d.nom), on = d.allume === true ? true : d.allume === false ? false : undefined;
    const suivre = (n, cle) => { suivreFocus(n, wid, cle); return n; };
    for (const c of Array.isArray(d.commandes) ? d.commandes : []) {
      if (!c || typeof c !== 'object' || !CODES.includes(c.code)) continue;
      const o = Array.isArray(c.ordres) ? c.ordres.filter((x) => typeof x === 'string') : [];
      if (c.code === 'interrupteur' || c.code === 'marche_arret') {
        const [m, a] = c.code === 'interrupteur' ? [T.c.allumer, T.c.eteindre] : [T.c.marche, T.c.arret];
        if (o.length < 2) continue;
        if (on === undefined) { out.push(suivre(bouton(c.code, m, () => envoyer(o[0])), `${c.code}:0`), suivre(bouton(c.code, a, () => envoyer(o[1])), `${c.code}:1`)); continue; }
        if (c.code === 'interrupteur') {
          const s = el('button', 'wma-sw'); s.type = 'button'; s.dataset.code = c.code; s.setAttribute('role', 'switch'); s.setAttribute('aria-checked', String(on));
          s.setAttribute('aria-label', `${nom} : ${on ? a : m}`); s.title = on ? a : m; s.addEventListener('click', () => envoyer(on ? o[1] : o[0]));
          out.push(suivre(s, c.code));
        } else out.push(suivre(bouton(c.code, on ? a : m, () => envoyer(on ? o[1] : o[0])), c.code));
      } else if (c.code === 'intensite' && c.nombre && typeof c.nombre.ordre === 'string') {
        // Sans mesure, aucune position ni aucun nombre de départ : ni pouce ni remplissage (le style), et une flèche ne
        // part de rien. Une valeur se choisit en absolu (le point touché, Début, Fin) ; ensuite les flèches partent de la
        // valeur DEMANDÉE depuis cette page (dite « demandée », jamais « mesurée »). Un échec revient à l'état d'avant.
        const r = el('input', 'wma-r'), n = el('output', 'wma-n'); r.type = 'range'; r.dataset.code = c.code;
        r.min = String(Number.isFinite(c.nombre.min) ? c.nombre.min : 0); r.max = String(Number.isFinite(c.nombre.max) ? c.nombre.max : 100); r.step = String(Number.isFinite(c.nombre.pas) ? c.nombre.pas : 1);
        r.setAttribute('aria-label', T.c.intensite(nom)); n.setAttribute('aria-hidden', 'true');
        const dire = () => { const t = c.nombre.ordre.replace('{n}', nombre(Number(r.value))); r.dataset.pose = '1'; r.setAttribute('aria-valuetext', T.c.demande(t)); n.textContent = t; };
        const vierge = () => { r.removeAttribute('data-pose'); r.setAttribute('aria-valuetext', T.c.nonMesuree); n.textContent = ''; };
        const avant = DEMANDES.get(wid);
        if (typeof avant === 'number') { r.value = String(avant); dire(); } else vierge();
        r.addEventListener('keydown', (ev) => { if (!r.hasAttribute('data-pose') && /^(Arrow|Page)/.test(ev.key)) ev.preventDefault(); });
        r.addEventListener('input', dire);
        r.addEventListener('change', async () => {
          const v = Number(r.value), ancien = DEMANDES.get(wid); dire(); DEMANDES.set(wid, v);
          const res = await envoyer(c.nombre.ordre.replace('{n}', String(v)));
          if (res && res.ok) return;
          if (typeof ancien === 'number') DEMANDES.set(wid, ancien); else DEMANDES.delete(wid);
          if (typeof ancien === 'number') { r.value = String(ancien); dire(); } else vierge();
        });
        out.push(suivre(r, c.code), n);
      } else if (c.code === 'consigne' && c.nombre && typeof c.nombre.ordre === 'string') {
        // Moins et plus partent de la consigne LUE ; sans elle, ils ne peuvent rien envoyer (aucun degré inventé).
        const lue = typeof d.consigne === 'number' && Number.isFinite(d.consigne) ? d.consigne : undefined, pas = Number.isFinite(c.nombre.pas) ? c.nombre.pas : 1;
        const vers = (k) => () => envoyer(c.nombre.ordre.replace('{n}', String(Math.round((lue + k * pas) * 10) / 10)));
        out.push(suivre(bouton(c.code, lue === undefined ? `${T.c.moins} · ${T.c.sansConsigne}` : T.c.moins, vers(-1), { icone: 'moins', pas: -1, off: lue === undefined }), 'consigne:-1'));
        if (lue !== undefined) out.push(el('b', 'wma-deg', `${nombre(lue)}\u00a0°`));
        out.push(suivre(bouton(c.code, lue === undefined ? `${T.c.plus} · ${T.c.sansConsigne}` : T.c.plus, vers(1), { icone: 'plus', pas: 1, off: lue === undefined }), 'consigne:1'));
      } else if (c.code === 'ouvrir' && c.geste === 'glisser') {
        // La piste dit « Glisser pour ouvrir › » (comme la carte d'aujourd'hui) ; le départ (0) est une vraie position.
        const g = el('span', 'wma-gl'), lab = el('span', '', T.c.glisser), r = el('input', 'wma-r'); r.type = 'range'; r.min = '0'; r.max = '100'; r.step = '1'; r.value = '0'; r.dataset.code = c.code; r.dataset.pose = '1';
        r.setAttribute('aria-label', T.c.ouvrir(nom)); r.setAttribute('aria-valuetext', T.c.glisser); r.title = T.c.glisser; lab.setAttribute('aria-hidden', 'true');
        r.addEventListener('change', () => { const v = Number(r.value); r.value = '0'; if (v > 90) envoyer(o[0]); });
        suivre(r, c.code); g.append(lab, r); out.push(g);
      } else if (c.code === 'lecture_pause') {
        if (o.length < 2) continue;
        if (on === undefined) out.push(suivre(bouton(c.code, T.c.lecture, () => envoyer(o[0]), { icone: 'lire' }), `${c.code}:0`), suivre(bouton(c.code, T.c.pause, () => envoyer(o[1]), { icone: 'pause' }), `${c.code}:1`));
        else out.push(suivre(bouton(c.code, on ? T.c.pause : T.c.lecture, () => envoyer(on ? o[1] : o[0]), { icone: on ? 'pause' : 'lire' }), c.code));
      } else if (o.length) {
        const lib = { monter: [T.c.monter, 'haut'], arreter: [T.c.arreter, 'stop'], descendre: [T.c.descendre, 'bas'], precedent: [T.c.precedent, 'avant'], suivant: [T.c.suivant, 'apres'], nettoyer: [T.c.nettoyer], base: [T.c.base], verrouiller: [T.c.verrouiller] }[c.code];
        if (lib) out.push(suivre(bouton(c.code, lib[0], () => envoyer(o[0]), lib[1] ? { icone: lib[1] } : {}), c.code));
      }
    }
    return out;
  }

  /** L'état court d'un appareil : hors ligne, sans nouvelles, ou son état vrai (avec son unité). */
  function etatCourt(d) {
    if (d.horsLigne === true) return { t: T.horsLigne, ton: 'alarme' };
    if (d.muet === true) return { t: T.muet, ton: 'alarme' };
    if (typeof d.valeur === 'number' && Number.isFinite(d.valeur)) return { t: `${nombre(d.valeur)}${texte(d.unite) ? `\u00a0${texte(d.unite)}` : ''}` };
    const e = etatDit(d);
    return { t: e || (d.allume === true ? T.allume : d.allume === false ? T.eteint : T.inconnu) };
  }
  /** Le nom d'un appareil sans nom : sa sorte (jamais son identifiant). */
  const nomDeSorte = (k) => (k === 'lumière' ? T.lumiere.titre : k === 'capteur' || k === 'détecteur' ? T.capteur.titre : T.appareil.titre);

  // ---------------- Le choix de ce que le widget montre (« Régler »)
  /** Le genre du choix de chaque sorte qui en a un (la tuile, la lumière, le capteur ; la pièce ou le capteur d'une mesure). */
  const GENRES = { maison_appareil: 'appareil', maison_lumiere: 'lumiere', maison_capteur: 'capteur', maison_temperature: 'mesure', maison_humidite: 'mesure' };
  const genreDe = (kind) => (typeof kind === 'string' && Object.prototype.hasOwnProperty.call(GENRES, kind) ? GENRES[kind] : '');
  const CIBLE = /^(appareil|piece):(.+)$/s;
  /** La liste des choix rendue par le serveur (au propriétaire seul), relue sans confiance ; rien : pas de liste. */
  function choixLus(e) {
    if (!e || !Array.isArray(e.choix)) return null;
    return e.choix.filter((c) => c && typeof c === 'object' && typeof c.cible === 'string' && c.cible.length <= 210 && CIBLE.test(c.cible)).slice(0, 300);
  }
  /** Le texte d'un choix : le nom et la pièce d'un appareil (sans nom : sa sorte), « hors ligne » s'il l'est ; une pièce : son nom. */
  function texteChoix(c) {
    if (c.cible.startsWith('piece:')) return texte(c.nom) || T.sansPiece;
    return [texte(c.nom) || nomDeSorte(texte(c.sorte)), texte(c.piece) || T.sansPiece, c.horsLigne === true ? T.horsLigne : ''].filter(Boolean).join(' · ');
  }
  /**
   * Le champ du choix de « Régler » pour ce widget, ou rien (une sorte sans choix). `e` : l'état que le serveur a rendu
   * pour CE widget (sa liste n'y est que pour le propriétaire, sur l'accueil). Rend { libelle, options: [{ v, texte,
   * groupe? }], depart, sansListe, aide, titre(v) } : jamais un identifiant dans un texte. Le choix d'avant reste dans la
   * liste ; retiré d'Odin, il y est sous un mot neutre. `titre(v)` : le titre proposé pour ce choix (vide : celui de la sorte).
   */
  function champChoix(w, e) {
    const g = genreDe(w && w.kind); if (!g) return null;
    const mesure = g === 'mesure', depart = typeof w.cible === 'string' && CIBLE.test(w.cible) ? w.cible : '';
    const lus = choixLus(e), liste = (lus ?? []).filter((c) => mesure || c.cible.startsWith('appareil:'));
    const options = [];
    if (mesure) options.push({ v: '', texte: T.regler.tous });
    else if (!depart) options.push({ v: '', texte: T.regler.choisir });
    if (depart && !liste.some((c) => c.cible === depart)) options.push({ v: depart, texte: T.regler.retire });
    for (const c of liste) options.push({ v: c.cible, texte: texteChoix(c), ...(mesure ? { groupe: c.cible.startsWith('piece:') ? T.regler.groupes.pieces : T.regler.groupes.capteurs } : {}) });
    const R = window.OdinWidgetsRendu, base = mesure && R && typeof R.rendu === 'function' ? texte((R.rendu(w.kind) || {}).titre) : '';
    const titre = (v) => {
      const c = liste.find((x) => x.cible === v); if (!c) return '';
      const nom = c.cible.startsWith('piece:') ? texte(c.nom) : texte(c.nom) || nomDeSorte(texte(c.sorte));
      // Une aide (le titre du champ, l'en-tête de la fenêtre), jamais rangée : un nom long finit par « … », jamais coupé net.
      const t = mesure ? [base, nom].filter(Boolean).join(' · ') : nom;
      return t.length > 40 ? `${t.slice(0, 39).trimEnd()}…` : t;
    };
    return { libelle: T.regler.libelles[g], options, depart, sansListe: lus === null, aide: lus === null ? T.regler.aRanger : !liste.length ? T.aucun[g] : '', titre };
  }
  /**
   * L'état « vide » d'un appareil : sa phrase, selon la sorte ; et, pour le propriétaire sur l'accueil (le serveur ne
   * sert la liste des choix qu'à lui), le seul bouton qui y remédie : « Choisir » ouvre « Régler » sur ce choix ;
   * aucun appareil de ce genre : « Ajouter un appareil » mène à la maison (Midgard), où l'on relie une box.
   */
  function videDe(e, o) {
    const w = (o && o.w) || {}, g = genreDe(w.kind), raison = e && typeof e.raison === 'string' ? e.raison : '';
    const phrase = raison === 'appareil_non_choisi' ? T.nonChoisi[g] : raison === 'aucun_appareil' ? T.aucun[g] : '';
    const out = [el('p', 'wma-vide', phrase || T.vides[raison] || T.vides.appareil_absent)];
    if (!e || !Array.isArray(e.choix) || (o && o.ecran === 'maison')) return out;
    // Le choix d'avant retiré dans une maison qui n'a plus aucun appareil de ce genre : « Choisir » n'offrirait que lui ;
    // « Ajouter un appareil » est le seul geste utile.
    const aucunDuGenre = raison === 'aucun_appareil' || (raison !== 'appareil_non_choisi' && !e.choix.some((c) => c && typeof c.cible === 'string' && c.cible.startsWith('appareil:')));
    if (aucunDuGenre) {
      const b = el('button', 'wma-b wma-vide-b', T.boutons.ajouter); b.type = 'button'; b.dataset.action = 'ajouter';
      b.addEventListener('click', (ev) => { ev.stopPropagation(); location.hash = '#app=midgard'; });
      out.push(b);
    } else if (raison === 'appareil_non_choisi' || raison === 'appareil_absent' || raison === 'appareil_autre_sorte') {
      const b = el('button', 'wma-b wma-vide-b', (raison === 'appareil_non_choisi' && T.choisirQuoi[g]) || T.boutons.choisir); b.type = 'button'; b.dataset.action = 'choisir';
      // « Régler » de la carte : le bouton « ⋯ » de son en-tête (celui de tous les widgets).
      b.addEventListener('click', (ev) => { ev.stopPropagation(); const r = b.closest && b.closest('.fe-w'), plus = r && r.querySelector('.wr-plus'); if (plus) plus.click(); });
      out.push(b);
    }
    return out;
  }
  /** Un appareil choisi (tuile, lumière) : son nom, sa pièce, son état vrai, ses commandes ; le résultat du dernier ordre. */
  function dessinerAppareil(e, o) {
    poserStyle();
    const w = (o && o.w) || {}, wid = texte(w.id), x = fraisDe(wid, e), d = (x && x.donnee) || {};
    const box = el('div', 'wma wma-ap'); box.dataset.sorte = texte(d.sorte);
    if (d.allume === true) box.dataset.on = '1';
    if (x.etat !== 'ok' && x.etat !== 'ancien') { box.append(...videDe(x, o)); return box; }
    // La pièce est écrite ici, avec l'état (l'en-tête ne la redit pas : à 768 px son sous-titre serait coupé). L'état vrai
    // reste sur sa ligne ; le résultat d'un ordre s'écrit à part, dessous.
    const l1 = el('div', 'wma-l1'), t = el('div', 'wma-t'), nom = el('b', 'wma-nom', texte(d.nom) || nomDeSorte(d.sorte)), s = el('span', 'wma-s'), msg = el('span', 'wma-s wma-msg');
    const ec = etatCourt(d), res = RESULTATS.get(wid), dit = res && Date.now() - res.at < 8000 ? res : null;
    s.textContent = [ec.t, texte(d.piece)].filter(Boolean).join(' · '); if (ec.ton) s.dataset.ton = ec.ton; s.title = s.textContent; nom.title = nom.textContent;
    msg.setAttribute('role', 'status'); if (dit) { msg.textContent = dit.t; msg.title = dit.t; if (dit.ok === false) msg.dataset.ton = 'alarme'; }
    t.append(nom, s, msg); l1.append(ic(ICONE_SORTE[d.sorte] || 'prise'), t);
    let occupe = false;
    const envoyer = async (valeur) => {
      if (occupe) return undefined; occupe = true; msg.textContent = T.envoi; msg.removeAttribute('data-ton');
      const r = await ordonner(box, texte(d.id), valeur);
      RESULTATS.set(wid, { t: r.text, ok: r.ok, at: Date.now() }); msg.textContent = r.text; msg.title = r.text; if (!r.ok) msg.dataset.ton = 'alarme';
      occupe = false;
      if (r.ok && !(box.closest && box.closest('.fe-edit'))) { await relire(wid); const neuf = dessinerAppareil(e, o); if (box.isConnected) { const avait = focusVoulu; box.replaceWith(neuf); if (avait) rendreFocus(neuf, wid); } }
      return r;
    };
    const cmd = el('div', 'wma-cmd'); cmd.append(...commandes(d, envoyer, wid));
    box.append(l1); if (cmd.childNodes.length) box.append(cmd);
    rendreFocus(box, wid);
    return box;
  }
  /** Un capteur : sa valeur (dans la langue de la page), son nom, sa pièce, l'âge vrai de la mesure. */
  function dessinerCapteur(e, o) {
    poserStyle();
    const d = (e && e.donnee) || {}, R = window.OdinWidgetsRendu, box = el('div', 'wma wma-cap');
    if (!e || (e.etat !== 'ok' && e.etat !== 'ancien')) { box.append(...videDe(e, o)); return box; }
    const v = el('div', 'wma-v'), ec = etatCourt(d);
    if (typeof d.valeur === 'number' && Number.isFinite(d.valeur) && !d.horsLigne && !d.muet) { v.append(nombre(d.valeur)); if (texte(d.unite)) v.append(el('small', '', `\u00a0${texte(d.unite)}`)); }
    else v.textContent = ec.t;
    const age = d.ageInconnu !== true && !d.horsLigne && R && typeof R.depuis === 'function' ? R.depuis(e.at) : '';
    const s = el('span', 'wma-s', [texte(d.nom) || nomDeSorte(d.sorte), texte(d.piece), d.horsLigne || d.muet ? ec.t : '', age ? T.lu(age) : ''].filter(Boolean).join(' · '));
    if (ec.ton && (d.horsLigne || d.muet)) s.dataset.ton = ec.ton;
    s.title = s.textContent; v.title = v.textContent;
    // Sa courbe des dernières 24 h, à côté de la valeur, quand le serveur l'a rendue (au propriétaire seul, sur son
    // accueil : pages/widgets-maison-courbes.js la dessine). Sans elle, la valeur seule, comme avant.
    const C = window.OdinWidgetsMaisonCourbes, g = d.courbe && C && typeof C.courbeCapteur === 'function' ? C.courbeCapteur(d.courbe, texte(d.unite)) : null;
    if (g) { C.poserStyle(); const l = el('div', 'wmc-l'); l.append(v, g); box.append(l, s); } else box.append(v, s);
    return box;
  }
  /** Les pièces : en liste (chaque pièce, ses appareils, ce qui est allumé, l'interrupteur de ses lumières) ou en tuiles. */
  function dessinerPieces(tuiles) {
    return (e, o) => {
      poserStyle();
      const w = (o && o.w) || {}, wid = texte(w.id), x = fraisDe(wid, e), d = (x && x.donnee) || {}, box = el('div', 'wma wma-pi');
      const pieces = (Array.isArray(d.pieces) ? d.pieces : []).filter((p) => p && typeof p === 'object');
      const r = Number.isInteger(w.r) ? w.r : 4, c = Number.isInteger(w.c) ? w.c : 3;
      const cols = c >= 4 ? 3 : 2, place = tuiles ? Math.max(cols, (Math.max(1, r - 1)) * cols) : Math.max(2, r + 1);
      const montrees = pieces.length > place ? pieces.slice(0, place - (tuiles ? cols : 1)) : pieces;
      let occupe = false;
      const basculer = async (p, n) => {
        if (occupe) return; occupe = true;
        const lum = (Array.isArray(p.lumieres) ? p.lumieres : []).filter((l) => l && typeof l.id === 'string' && l.horsLigne !== true), on = lum.some((l) => l.allume === true);
        let dernier = { ok: true, text: T.fait };
        for (const l of lum) { const res = await ordonner(n, l.id, on ? 'off' : 'on'); if (!res.ok) { dernier = res; break; } dernier = res; }
        RESULTATS.set(wid, { t: dernier.text, ok: dernier.ok, at: Date.now() }); occupe = false;
        if (!(box.closest && box.closest('.fe-edit'))) { await relire(wid); const neuf = dessinerPieces(tuiles)(e, o); if (box.isConnected) { box.replaceWith(neuf); rendreFocus(neuf, wid); } }
      };
      const ligne = (p) => {
        const nom = texte(p.nom) || T.sansPiece, lum = (Array.isArray(p.lumieres) ? p.lumieres : []).filter((l) => l && typeof l.id === 'string' && l.horsLigne !== true);
        const on = lum.some((l) => l.allume === true), allumes = (Array.isArray(p.allumes) ? p.allumes : []).filter((y) => typeof y === 'string');
        const plus = Number.isInteger(p.enPlus) && p.enPlus > 0 ? p.enPlus : 0;
        const resume = allumes.length ? `${allumes.join(', ')}${plus ? ` ${T.enPlus(plus)}` : ''}` : plus ? T.nAllumes(plus) : T.toutEteint;
        const n = Number.isInteger(p.appareils) ? p.appareils : 0;
        if (tuiles) {
          const b = el('button', 'wma-tu'); b.type = 'button'; b.setAttribute('aria-pressed', String(on)); b.setAttribute('data-piece', texte(p.nom));
          b.append(el('b', '', nom), el('small', '', resume)); b.title = `${nom} · ${T.appareils(n)} · ${resume}`;
          if (!lum.length) { b.disabled = true; b.title = `${b.title} · ${T.aucuneLumiere}`; } else b.addEventListener('click', () => basculer(p, b));
          suivreFocus(b, wid, `piece:${texte(p.nom)}`);
          return b;
        }
        const li = el('li'), t = el('div', 'wma-t'), b = el('b', 'wma-nom', nom), s = el('span', 'wma-s', `${T.appareils(n)} · ${resume}`);
        b.title = nom; s.title = s.textContent; t.append(b, s); li.append(ic('maison'), t);
        if (lum.length) {
          const sw = el('button', 'wma-sw'); sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', String(on)); sw.setAttribute('data-piece', texte(p.nom));
          sw.setAttribute('aria-label', T.lumieres(nom, on)); sw.title = T.lumieres(nom, on); sw.addEventListener('click', () => basculer(p, sw));
          suivreFocus(sw, wid, `piece:${texte(p.nom)}`); li.append(sw);
        }
        return li;
      };
      const liste = tuiles ? el('div', 'wma-tus') : el('ul', 'wma-li');
      if (tuiles) liste.style.setProperty('--wma-col', String(cols));
      liste.append(...montrees.map(ligne)); box.append(liste);
      if (montrees.length < pieces.length) box.append(el('span', 'wma-plus', T.enPlus(pieces.length - montrees.length)));
      const res = RESULTATS.get(wid);
      if (res && Date.now() - res.at < 8000) { const s = el('span', 'wma-s', res.t); s.setAttribute('role', 'status'); if (!res.ok) s.dataset.ton = 'alarme'; box.append(s); }
      rendreFocus(box, wid);
      return box;
    };
  }

  // ---------------- La pose depuis le tiroir « Ajouter un widget »
  /**
   * Les appareils que le serveur garde pour chaque genre : la règle de src/valhalla/widgets/maison-appareils.ts (la
   * lumière : « lumière » ; le capteur : « capteur » ou « détecteur » ; l'appareil : tous). Un essai compare les deux
   * listes sur les mêmes appareils.
   */
  const DU_GENRE = { appareil: () => true, lumiere: (k) => k === 'lumière', capteur: (k) => k === 'capteur' || k === 'détecteur' };
  const RESERVES = ['__proto__', 'constructor', 'prototype'];
  /** Le genre d'une sorte qui montre UN appareil choisi (la tuile, la lumière, le capteur) ; une autre : '' (rien à choisir à la pose). */
  const genrePose = (kind) => { const g = genreDe(kind); return g && g !== 'mesure' ? g : ''; };
  /**
   * Les choix d'une pose, tirés des pièces que l'écran de la maison reçoit déjà (etat.rooms de /api/maison/etat, lu par
   * le propriétaire) : les appareils du genre, sous la forme des choix du serveur ({ cible, nom, piece, sorte }), 300 au
   * plus ; un identifiant vide, réservé ou trop long n'est pas un choix (comme au serveur). Rien de lisible : null.
   */
  function choixDePose(kind, rooms) {
    const g = genrePose(kind); if (!g || !Array.isArray(rooms)) return null;
    const out = [];
    for (const r of rooms) {
      for (const d of r && typeof r === 'object' && Array.isArray(r.devices) ? r.devices : []) {
        const id = d && typeof d.id === 'string' ? d.id : '';
        if (!id.trim() || RESERVES.includes(id.trim()) || `appareil:${id}`.length > 200 || !DU_GENRE[g](texte(d.kind))) continue;
        out.push({ cible: `appareil:${id}`, nom: texte(d.name), piece: texte(r.name), sorte: texte(d.kind) });
      }
    }
    return out.slice(0, 300);
  }

  // `commandes` et `poserStyle` : aussi pour l'écran de la maison (maison.js), qui dessine ainsi l'intensité d'une lumière
  // comme le widget (sans pouce ni nombre de départ), sans la recopier.
  // `champChoix` : le champ du choix de ce que le widget montre, pour « Régler » (fenetre.js).
  // `genrePose`, `choixDePose` : la pose depuis le tiroir (fenetre.js), qui prend d'office l'unique appareil du genre.
  window.OdinWidgetsMaisonAppareils = { TEXTES, CODES, CSS, nombre, garderFrais, fraisDe, commandes, poserStyle, champChoix, genrePose, choixDePose };
  // La déclaration (lue par pages/widgets-rendu.js). L'appli lue : Midgard (celle de la maison), dont la famille range
  // ces widgets dans le tiroir (la maquette : « Maison »). Un appareil, une lumière, un capteur y sont : à la pose,
  // l'unique appareil du genre est pris d'office ; plusieurs : « Régler » s'ouvre sur le choix ; aucun : rien n'est posé
  // (sa réponse du 25/11 : rien n'est montré tant qu'Odin n'a pas la vraie donnée). Le style « Tuiles » : pas de ligne.
  const VIDES = ['appareil_non_choisi', 'appareil_absent', 'appareil_autre_sorte', 'aucun_appareil'];
  const sousPieces = (e) => { const p = e && e.donnee && Array.isArray(e.donnee.pieces) ? e.donnee.pieces : null; return p ? T.nPieces(p.length) : ''; };
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'maison', sortes: [
    { sorte: 'maison_appareil', titre: T.appareil.titre, quoi: T.appareil.quoi, symbole: '⏻', appli: 'midgard', poser: { c: 3, r: 2, pr: 2 }, vides: VIDES, dessiner: dessinerAppareil },
    { sorte: 'maison_lumiere', titre: T.lumiere.titre, quoi: T.lumiere.quoi, symbole: '💡', appli: 'midgard', poser: { c: 3, r: 2, pr: 2 }, vides: VIDES, dessiner: dessinerAppareil },
    { sorte: 'maison_capteur', titre: T.capteur.titre, quoi: T.capteur.quoi, symbole: '🌡', appli: 'midgard', poser: { c: 3, r: 2, pr: 2 }, vides: VIDES, dessiner: dessinerCapteur },
    { sorte: 'maison_pieces', titre: T.pieces.titre, quoi: T.pieces.quoi, symbole: '🏠', appli: 'midgard', poser: { c: 3, r: 4, pr: 4 }, vides: ['aucun_appareil'], sous: sousPieces, dessiner: dessinerPieces(false) },
    // Le style « Tuiles » : dessiné, prêt ; il se choisira dans « Régler » quand la table des styles (widgets-rendu.js) et
    // le serveur l'auront (pas de ligne à lui dans le tiroir).
    { sorte: 'maison_pieces', style: 'tuiles', titre: T.pieces.titre, nom: T.pieces.tuiles, quoi: T.pieces.quoi, symbole: '🏠', appli: 'midgard', tiroir: false, poser: { c: 3, r: 4, pr: 4 }, vides: ['aucun_appareil'], sous: sousPieces, dessiner: dessinerPieces(true) },
  ] });
})();
