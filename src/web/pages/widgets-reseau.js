// La famille « Réseau » des widgets de l'accueil (maquette validée « Accueil », la carte « Réseau » d'Horus) : son style
// de départ, « Liste ». Combien d'appareils en ligne sur combien de connus (le sous-titre), le débit quand Ariane le
// mesure (« Réception », « Envoi »), puis chaque appareil : son nom tel qu'Odin le connaît, en ligne ou non, son adresse,
// et pour un appareil hors ligne depuis quand Odin ne l'a plus vu ; « et N de plus » ; « Ouvrir le réseau ».
// Ce fichier DÉCLARE sa sorte au registre commun (pages/widgets-rendu.js) ; l'accueil la dessine et la propose sans rien
// savoir d'elle. Chaque dessin est fait de l'état que le serveur a rendu (src/valhalla/widgets/reseau.ts).
// - Au propriétaire seul (le serveur décide ; ce fichier ne le propose qu'à lui), jamais sur l'écran de la maison.
// - Rien d'inventé : sans débit servi (Ariane absente, en pause, ou qui ne lit pas les paquets), aucune ligne de débit,
//   ni 0 ni tiret. Aucun test de débit par appareil : il n'existe pas. Aucun balayage lancé d'ici : seulement « Ouvrir ».
// - Un débit s'écrit avec son unité, dans la langue de la page (Intl), en puissances de 1000 comme Ariane l'écrit ; « il y
//   a 3 heures » aussi, dans la langue de la page.
// - Un nom d'appareil vient de dehors (il est annoncé par l'appareil) : posé par textContent, isolé dans son sens
//   d'écriture, coupé à l'écran avec son nom entier en info-bulle ; jamais du code.
// - La carte ne s'étire pas : autant d'appareils que sa hauteur RÉELLE en tient (mesurée une fois posée, et quand elle
//   change), puis « et N de plus » ; rien n'est coupé au bord, le bas (« Ouvrir le réseau ») reste fixe.
// Rien n'est touché au chargement : seulement window.OdinWidgetsReseau (ses textes et calculs, pour les essais) et sa
// déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsReseau) return;

  // ---------------- Dictionnaire (tous les textes de la famille)
  const TEXTES = {
    titre: 'Réseau', quoi: 'Les appareils de ton réseau, en ligne ou non, et le débit quand Ariane lit les paquets',
    sous: (n, t) => `${n} en ligne sur ${t}`, recu: 'Réception', envoye: 'Envoi',
    enLigne: 'en ligne', horsLigne: 'hors ligne', vu: (t) => `vu ${t}`, balaye: (t) => `Dernier balayage : ${t}`,
    plus: (n) => `et ${n} de plus`, ouvrir: 'Ouvrir le réseau', aucun: 'Aucun appareil connu pour l\'instant : la page Réseau les découvre.',
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  const nombreLu = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  /** Un débit (octets par seconde), avec son unité, dans la langue donnée ; sans valeur lisible : ''. */
  function debit(o, langue) {
    if (!nombreLu(o)) return '';
    const [unite, base, chiffres] = o >= 1e6 ? ['megabyte-per-second', 1e6, 1] : o >= 1e3 ? ['kilobyte-per-second', 1e3, 0] : ['byte-per-second', 1, 0];
    try { return new Intl.NumberFormat(langue, { style: 'unit', unit: unite, unitDisplay: 'short', maximumFractionDigits: chiffres }).format(o / base); } catch { return ''; }
  }
  /** « il y a 3 heures », dans la langue donnée, depuis `at` (ms) jusqu'à `maintenant` ; une heure illisible ou à venir : ''. */
  function ilYa(at, maintenant, langue) {
    const d = Number(maintenant) - Number(at);
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || !Number.isFinite(d) || d < 0) return '';
    const s = d / 1000, [v, u] = s < 60 ? [0, 'second'] : s < 3600 ? [Math.floor(s / 60), 'minute'] : s < 86400 ? [Math.floor(s / 3600), 'hour'] : [Math.floor(s / 86400), 'day'];
    try { return new Intl.RelativeTimeFormat(langue, { numeric: 'auto' }).format(-v, u); } catch { return ''; }
  }
  /** Un appareil lu sans confiance : un nom (sinon : null), son adresse (sinon ''), en ligne ou non, sa dernière nouvelle (sinon 0). */
  function appareilLu(x) {
    if (!x || typeof x !== 'object' || typeof x.nom !== 'string' || !x.nom.trim()) return null;
    return { nom: x.nom, ip: typeof x.ip === 'string' ? x.ip : '', enLigne: x.enLigne === true, vuA: typeof x.vuA === 'number' && Number.isFinite(x.vuA) && x.vuA > 0 ? x.vuA : 0 };
  }
  const entier = (n, min) => (Number.isInteger(n) && n >= min ? n : min);

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const ICONES = {
    sortie: '<path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"/>',
    bas: '<path d="M12 4v13M6.5 11.5 12 17l5.5-5.5M5 20h14"/>',
    haut: '<path d="M12 20V7M6.5 12.5 12 7l5.5 5.5M5 4h14"/>',
  };
  const icone = (k) => (Object.prototype.hasOwnProperty.call(ICONES, k) ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[k]}</svg>` : '');
  // Les couleurs : celles du thème d'Odin (--ink, --muted, --line, --accent, --good). Aucune couleur écrite ici.
  const CSS = `
:has(>.wn-corps){display:flex;flex-direction:column}
.wn-corps{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:6px;color:var(--ink,var(--text,inherit))}
/* Seul le contenu défile ; le bas de la carte reste fixe, jamais coupé par son bord. */
.wn-defile{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;gap:8px;overflow:auto;overscroll-behavior:contain;padding:3px;margin:-3px}
.wn-defile>*{flex:none;min-width:0}
.wn-debit{display:flex;flex-wrap:wrap;gap:4px 16px;min-width:0}
.wn-debit>div{display:flex;align-items:center;gap:6px;min-width:0}
.wn-debit svg{flex:none;width:16px;height:16px;color:var(--muted,inherit)}
.wn-debit small{font-size:11.5px;color:var(--muted,inherit)}
.wn-debit b{font-size:18px;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap}
.wn-liste{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;min-width:0}
.wn-app{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;min-width:0;min-height:22px}
.wn-pt{flex:none;width:9px;height:9px;border-radius:50%;background:var(--good,currentColor)}
.wn-off .wn-pt{background:transparent;border:2px solid var(--muted,currentColor);width:9px;height:9px;box-sizing:border-box}
.wn-n{flex:1 1 110px;min-width:0;font-size:13px;font-weight:600;color:var(--ink,inherit);unicode-bidi:isolate;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wn-off .wn-n{font-weight:500}
.wn-m{flex:0 1 auto;margin-left:auto;font-size:11.5px;line-height:1.35;color:var(--muted,inherit);font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:anywhere}
.wn-plus,.wn-bal,.wn-calme{margin:0;font-size:11.5px;line-height:1.35;color:var(--muted,inherit)}.wn-plus:empty{display:none}
.wn-calme{font-size:13px}
.wn-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.wn-corps [hidden]{display:none!important}
.wn-bas{flex:none;display:flex;gap:6px;min-width:0}
.wn-btn{flex:0 1 auto;max-width:100%;min-height:44px;min-width:44px;padding:4px 14px;border-radius:12px;border:1px solid var(--line,currentColor);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:650;line-height:1.25;overflow-wrap:anywhere;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.wn-btn svg{flex:none;width:15px;height:15px}
.wn-btn:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:2px}
.wn-compte{display:none;margin:0;font-size:13px;font-weight:650;font-variant-numeric:tabular-nums}
/* Une carte étroite : l'adresse et l'état passent sous le nom, entiers ; le débit tient sur UNE ligne (les flèches disent
   le sens, les mots « Réception » et « Envoi » restent pour les lecteurs d'écran et dans l'info-bulle). */
@container (max-width:260px){.wn-m{flex-basis:100%;margin-left:17px;text-align:left}.wn-debit{gap:2px 12px}.wn-debit b{font-size:15px}
.wn-debit small{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}}
/* Plus étroite encore (le sous-titre de l'en-tête y est coupé) : le compte, entier, dans le corps ; tout se resserre pour
   que le compte et le débit tiennent ensemble dans la plus petite carte. */
@container (max-width:190px){.wn-compte{display:block;line-height:16px}.wn-defile{gap:2px}.wn-debit{gap:0 6px}.wn-debit>div{gap:2px;line-height:18px}.wn-debit>div>span{display:flex}
.wn-debit b{font-size:12px;font-weight:700;line-height:18px}.wn-debit svg{width:12px;height:12px}}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle();
    if (document.getElementById('odinWidgetsReseau')) return;
    // Hors téléphone, la carte a la hauteur de ses lignes : son corps ne compte pas dans cette hauteur (il défile), si
    // bien qu'une longue liste n'étire ni la carte, ni sa voisine. Au téléphone, la hauteur suit le contenu.
    const G = window.OdinGrille, tel = G && G.GRILLE && Number.isInteger(G.GRILLE.telephone) ? G.GRILLE.telephone : 700;
    const s = document.createElement('style'); s.id = 'odinWidgetsReseau'; s.textContent = `${CSS}\n@media (min-width:${tel + 1}px){.fe-w>.wn-corps{contain:size}}`; document.head.append(s);
  }
  function el(t, cls, texte) { const n = document.createElement(t); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; }
  /** Un texte venu de dehors : du texte, isolé dans son sens d'écriture, en entier dans l'info-bulle. */
  function dehors(t, cls, texte) { const n = el(t, cls, texte); n.dir = 'auto'; n.title = texte; return n; }
  const langue = () => { try { return document.documentElement.lang || undefined; } catch { return undefined; } };
  const nombre = (n, lg) => { try { return new Intl.NumberFormat(lg).format(n); } catch { return String(n); } };
  const decor = (k, cls) => { const s = el('span', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = icone(k); return s; };
  /** « Ouvrir le réseau » : la page Réseau d'Odin (celle qui découvre les appareils) ; rien en mode « Modifier », jamais sur l'écran de la maison. */
  function ouvrir(o) {
    if (o && o.ecran === 'maison') return null;
    const b = el('button', 'wn-btn'); b.type = 'button'; b.title = T.ouvrir;
    b.append(decor('sortie'), el('span', '', T.ouvrir));
    b.addEventListener('click', (ev) => { ev.stopPropagation(); if (b.closest('.fe-edit')) return; location.hash = '#net'; });
    return b;
  }
  function corps(contenu, o) {
    const c = el('div', 'wn-corps'), f = el('div', 'wn-defile'), b = ouvrir(o);
    f.append(...contenu); c.append(f);
    if (b) { const bas = el('div', 'wn-bas'); bas.append(b); c.append(bas); }
    return { c, f };
  }

  /**
   * « Réseau », style « Liste » : le débit s'il est servi, puis chaque appareil (en ligne d'abord, rangés par le serveur).
   * Aucun appareil connu : la phrase calme et « Ouvrir le réseau ». Une donnée illisible : rien (null).
   */
  function dessiner(e, o) {
    if (e && e.etat === 'vide') {
      if (e.raison !== 'aucun_appareil') return null;
      poserStyle();
      return corps([el('p', 'wn-calme', T.aucun)], o).c;
    }
    const d = e && e.donnee && typeof e.donnee === 'object' ? e.donnee : {};
    const apps = (Array.isArray(d.appareils) ? d.appareils : []).map(appareilLu).filter(Boolean);
    if (!apps.length) return null; // illisible : rien d'affirmé
    poserStyle();
    const lg = langue(), maint = Date.now(), total = entier(d.total, apps.length), contenu = [];
    // Le compte, redit dans le corps d'une carte étroite seulement (là, le sous-titre de l'en-tête est coupé) ; déjà lu dans l'en-tête.
    const compte = sous(e);
    if (compte) { const p = el('p', 'wn-compte', compte); p.setAttribute('aria-hidden', 'true'); contenu.push(p); }
    // Le débit : seulement s'il est servi, ses deux valeurs lisibles.
    const db = d.debit && typeof d.debit === 'object' ? d.debit : null, recu = db ? debit(db.recu, lg) : '', envoye = db ? debit(db.envoye, lg) : '';
    let ligneDebit = null;
    if (recu && envoye) {
      ligneDebit = el('div', 'wn-debit');
      for (const [k, mot, v] of [['bas', T.recu, recu], ['haut', T.envoye, envoye]]) { const x = el('div'); x.title = `${mot} ${v}`; x.append(decor(k), el('small', '', mot), el('b', '', v)); ligneDebit.append(x); }
      contenu.push(ligneDebit);
    }
    const ul = el('ul', 'wn-liste'), lis = [];
    for (const a of apps) {
      const li = el('li', `wn-app${a.enLigne ? '' : ' wn-off'}`), pt = el('i', 'wn-pt'); pt.setAttribute('aria-hidden', 'true');
      // L'adresse n'est pas répétée quand le nom est l'adresse ; un appareil hors ligne dit depuis quand Odin ne l'a plus vu.
      const meta = [a.ip && a.ip !== a.nom ? a.ip : '', a.enLigne ? '' : T.horsLigne, a.enLigne ? '' : (ilYa(a.vuA, maint, lg) ? T.vu(ilYa(a.vuA, maint, lg)) : '')].filter(Boolean).join(' · ');
      li.append(pt, dehors('span', 'wn-n', a.nom));
      if (a.enLigne) li.append(el('span', 'wn-sr', ` ${T.enLigne}`));
      if (meta) li.append(el('small', 'wn-m', meta));
      ul.append(li); lis.push(li);
    }
    contenu.push(ul);
    const plus = el('p', 'wn-plus'); contenu.push(plus);
    const quand = ilYa(d.balayeA, maint, lg), bal = quand ? el('p', 'wn-bal', T.balaye(quand)) : null;
    if (bal) contenu.push(bal);
    const { c, f } = corps(contenu, o);
    const a = { c, f, ul, lis, plus, total, lg, debit: ligneDebit, bal, rogne: false, tel: false, montre: Math.max(1, lignesDe(o && o.w, 4) - 2) };
    compter(a);
    // Une fois posée (et quand sa taille change) : autant d'appareils que la hauteur réelle en tient.
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => { if (!c.isConnected) { ro.disconnect(); return; } ajuster(a); });
      ro.observe(c);
    }
    return c;
  }
  /** « et N de plus » : les appareils connus qui ne sont pas montrés ; rien quand aucun ne l'est (le compte dit déjà le total). */
  function compter(a) {
    const n = a.ul.children.length, reste = a.total - n;
    a.plus.textContent = n && reste > 0 ? T.plus(nombre(reste, a.lg)) : '';
    a.ul.hidden = !n;
  }
  /** La hauteur du widget, en lignes de la grille (celle que la grille lui donne, sinon celle qui est écrite). */
  function lignesDe(w, defaut) {
    const G = window.OdinGrille;
    try { if (G && typeof G.taille === 'function') return G.taille(w).r; } catch { /* la valeur écrite */ }
    return w && Number.isInteger(w.r) ? w.r : defaut;
  }
  /** Tout remettre : chaque appareil servi, le débit, le dernier balayage. */
  function toutRemettre(a, lis) {
    a.ul.replaceChildren(...lis);
    for (const m of [a.bal, a.debit]) if (m) m.hidden = false;
    compter(a);
  }
  /**
   * Au téléphone, la carte suit son contenu (sa hauteur n'est pas tenue) : autant d'appareils que la maquette en met à sa
   * hauteur (deux lignes de moins que ses lignes de grille, un au moins), puis « et N de plus ».
   * Ailleurs, la hauteur réelle : tout remettre, puis, tant que la zone qui défile déborde, retirer la ligne du dernier
   * balayage, puis le dernier appareil (jusqu'à un) ; s'il le faut encore, comme la maquette, la plus petite carte garde
   * le débit plutôt qu'un appareil ; sans place pour le débit, un appareil s'il tient.
   */
  function ajuster(a) {
    const deborde = () => a.f.scrollHeight > a.f.clientHeight + 1;
    let tenue = false; try { tenue = /size/.test(getComputedStyle(a.c).contain || ''); } catch { /* la hauteur suit le contenu */ }
    if (!tenue) {
      if (!a.tel) { a.tel = true; a.rogne = false; toutRemettre(a, a.lis.slice(0, a.montre)); }
      return;
    }
    if (!a.tel && !a.rogne && !deborde()) return;
    a.tel = false; toutRemettre(a, a.lis); a.rogne = false;
    if (!deborde()) return;
    a.rogne = true;
    if (a.bal) a.bal.hidden = true;
    while (a.ul.children.length > 1 && deborde()) { a.ul.lastElementChild.remove(); compter(a); }
    if (!deborde()) return;
    a.ul.replaceChildren(); compter(a);
    if (!a.debit || !deborde()) return;
    a.debit.hidden = true;
    if (a.lis.length) { a.ul.replaceChildren(a.lis[0]); compter(a); if (deborde()) { a.ul.replaceChildren(); compter(a); } }
  }
  /** La fin du sous-titre : « 8 en ligne sur 11 ». */
  function sous(e) {
    const d = e && e.etat === 'ok' && e.donnee ? e.donnee : null;
    if (!d || !Number.isInteger(d.total) || d.total < 1 || !Number.isInteger(d.enLigne) || d.enLigne < 0 || d.enLigne > d.total) return '';
    const lg = langue();
    return T.sous(nombre(d.enLigne, lg), nombre(d.total, lg));
  }

  window.OdinWidgetsReseau = { TEXTES, CSS, debit, ilYa, appareilLu, dessiner, sous };
  // La déclaration de la famille (lue par pages/widgets-rendu.js, quel que soit l'ordre de chargement). La taille est celle
  // de la maquette : 4 × 4. Au propriétaire seul, rangée avec Odin dans le tiroir (comme la maquette), jamais sur l'écran
  // de la maison (la même marque que sa sorte, reseau.ts). Aucune appli de Valhalla derrière : le registre est dans Odin.
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'reseau', sortes: [
    { sorte: 'reseau', groupe: 'odin', proprio: true, jamaisALaMaison: true, titre: T.titre, quoi: T.quoi, symbole: '🖧', poser: { c: 4, r: 4, pc: 4 }, vides: ['aucun_appareil'], sous, dessiner },
  ] });
})();
