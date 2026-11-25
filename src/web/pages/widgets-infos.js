// La famille « Infos » des widgets de l'accueil (maquette validée « Accueil ») : l'heure en petit chiffre, l'horloge
// (l'heure en grand, la date, la semaine), la météo en petit chiffre, le nombre d'alertes pas encore vues, et la
// grande météo aux trois styles de la maquette (« Complète », « Compacte », « Scène ») : maintenant, les 24 heures, le
// lever et le coucher, les jours, seulement ce que Hestia lit à sa source. Les heures et les jours sont ceux de là-bas
// (la source les donne déjà dans le fuseau du lieu) : ils sont écrits dans la langue de la page et sur 12 ou 24 h
// comme Odin est réglé, sans jamais passer par le fuseau de l'appareil.
// Ce fichier DÉCLARE ses sortes au registre commun (pages/widgets-rendu.js) ; l'accueil et l'écran de la maison les
// dessinent et les proposent sans rien savoir d'elles. Il ne lit rien : chaque dessin est fait de l'état que le
// serveur a rendu pour le widget (le lieu, le fuseau et 12 ou 24 h d'Odin ; la température ; le nombre d'alertes).
// - L'heure et la date sont celles du fuseau d'Odin, jamais celles de l'appareil : sans fuseau lisible, pas d'heure.
// - La langue est celle de la page ; rien n'est supposé (ni une langue, ni un fuseau, ni un lieu).
// - Un petit chiffre : une icône teintée par une couleur du thème, la valeur, son libellé. Le nombre d'alertes ne prend
//   la couleur d'alarme que s'il y en a ; zéro alerte : un état calme. Sans donnée, il garde sa taille : son état court
//   est celui du dessin commun (etatPetit), dessiné par l'hôte.
// - Tout texte venu d'une donnée (le nom du lieu) est posé par textContent ; les icônes sont dessinées ici.
// Rien n'est touché au chargement : seulement window.OdinWidgetsInfos (ses calculs, pour les essais) et sa déclaration.
(() => {
  'use strict';
  if (window.OdinWidgetsInfos) return;

  // ---------------- Dictionnaire (tous les textes de la famille)
  const TEXTES = {
    heure: { titre: 'Heure', quoi: 'l\'heure là où est Odin, toujours à jour', dit: (h, lieu) => (lieu ? `${h}, heure de ${lieu}.` : `${h}.`) },
    horloge: { titre: 'Horloge', quoi: 'l\'heure en grand, la date, la semaine', semaine: (n) => `semaine ${n}` },
    meteo: {
      // Sur la carte : « Météo ». Dans le tiroir, où l'autre widget « Météo » est aussi proposé : « Météo (petite) ».
      titre: 'Météo', nom: 'Météo (petite)', quoi: 'la température et le ciel, d\'un coup d\'œil',
      ciels: { soleil: 'ciel dégagé', eclaircie: 'éclaircies', nuage: 'ciel couvert', brume: 'brouillard', pluie: 'pluie', neige: 'neige', orage: 'orage' },
      dit: (t, lieu, ciel) => `${lieu} : ${t}${ciel ? `, ${ciel}` : ''}.`,
    },
    alertes: { titre: 'Alertes', quoi: 'les alertes que tu n\'as pas encore vues', dit: (n) => (n === 1 ? '1 alerte non vue.' : `${n} alertes non vues.`) },
    // La grande météo : ses trois styles (leurs noms dans « Régler » sont dans pages/widgets-rendu.js, STYLES ; ils n'ont
    // pas de ligne dans le tiroir). Une espace insécable garde chaque valeur avec son mot ; « Heure par heure » reste
    // juste quand la lecture est ancienne (ses heures sont alors celles d'avant).
    grande: {
      maxMin: (max, min) => `Max\u00a0${max} · min\u00a0${min}`, lever: (h) => `Lever\u00a0${h}`, coucher: (h) => `Coucher\u00a0${h}`,
      heures: 'Heure par heure', jours: 'Les prochains jours',
      jourDit: (j, ciel, min, max) => `${j}${ciel ? `, ${ciel}` : ''} : de ${min} à ${max}.`,
    },
  };
  const T = TEXTES;

  // ---------------- Calculs (sans document)
  /** Le numéro ISO de la semaine d'un jour : le jeudi de sa semaine dit de quelle année elle est. */
  function semaineDe(a, m, j) {
    const d = new Date(Date.UTC(a, m - 1, j)), rang = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - rang);
    return Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  }
  /**
   * L'heure et la date dans le fuseau d'Odin, dans la langue donnée, sur 12 ou 24 h comme Odin est réglé. `l` : ce que
   * le serveur rend ({ fuseau, heure12 }). Rend { texte, segments (le matin ou l'après-midi à part, pour l'écrire en
   * petit), jour, semaine, decalage }. Sans fuseau, ou avec un fuseau que le navigateur ne connaît pas : rien (null) ;
   * jamais l'heure de l'appareil.
   */
  function heureDe(l, d = new Date(), langue) {
    const fuseau = l && typeof l.fuseau === 'string' ? l.fuseau : '';
    if (!fuseau) return null;
    try {
      const h12 = l.heure12 === true, segments = [];
      const parts = new Intl.DateTimeFormat(langue, { timeZone: fuseau, hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', ...(h12 ? { hour12: true } : { hourCycle: 'h23' }) }).formatToParts(d);
      for (const p of parts) { const petit = p.type === 'dayPeriod', dernier = segments[segments.length - 1]; if (dernier && dernier.petit === petit) dernier.v += p.value; else segments.push({ v: p.value, petit }); }
      const jour = new Intl.DateTimeFormat(langue, { timeZone: fuseau, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
      // L'année, le mois et le jour LÀ-BAS, en chiffres (pour la semaine) : lus dans le calendrier grégorien.
      const n = {};
      for (const p of new Intl.DateTimeFormat('en', { timeZone: fuseau, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d)) n[p.type] = Number(p.value);
      let decalage = '';
      try { decalage = (new Intl.DateTimeFormat(langue, { timeZone: fuseau, timeZoneName: 'shortOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName') || {}).value || ''; } catch { decalage = ''; }
      return { texte: segments.map((s) => s.v).join(''), segments, jour, semaine: semaineDe(n.year, n.month, n.day), decalage };
    } catch { return null; }
  }
  /** Le ciel d'un code météo (les codes de l'Organisation météorologique mondiale, ceux que Hestia garde) ; un code inconnu : aucun ciel supposé. */
  function cielDe(code) {
    if (typeof code !== 'number' || !Number.isInteger(code)) return 'inconnu';
    if (code === 0) return 'soleil';
    if (code === 1 || code === 2) return 'eclaircie';
    if (code === 3) return 'nuage';
    if (code === 45 || code === 48) return 'brume';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'pluie';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'neige';
    if (code >= 95 && code <= 99) return 'orage';
    return 'inconnu';
  }

  // L'heure et le jour de là-bas sont déjà écrits par la source (« 14:00 », « 2031-03-03 ») : ils ne sont que remis en
  // mots. La date est construite avec ces chiffres puis relue aussitôt avec les mêmes, sans fuseau nommé : ce qui sort
  // est ce qui est entré, quel que soit le fuseau de l'appareil (le 1er janvier pour une heure, midi pour un jour : aucun
  // changement d'heure saisonnier n'y tombe ; s'il y en avait un, la relecture ne rendrait pas les mêmes chiffres : rien).
  /** « HH:MM » (l'heure de là-bas, donnée par la source) écrite dans la langue donnée, sur 12 ou 24 h ; illisible : ''. */
  function heureCourte(hhmm, heure12, langue) {
    const m = typeof hhmm === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm) : null;
    if (!m) return '';
    const h12 = heure12 === true, d = new Date(2001, 0, 1, Number(m[1]), Number(m[2]));
    if (d.getHours() !== Number(m[1]) || d.getMinutes() !== Number(m[2])) return '';
    try { return new Intl.DateTimeFormat(langue, { hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', ...(h12 ? { hour12: true } : { hourCycle: 'h23' }) }).format(d); } catch { return ''; }
  }
  /** « AAAA-MM-JJ » (un jour de là-bas) : le nom court du jour, dans la langue donnée ; un jour qui n'existe pas : ''. */
  function jourCourt(j, langue) {
    const m = typeof j === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(j) : null;
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return '';
    try { return new Intl.DateTimeFormat(langue, { weekday: 'short' }).format(d); } catch { return ''; }
  }

  // ---------------- Dessin (seulement quand un hôte l'appelle)
  const NUAGE = 'M7 15.5h9.5a3.5 3.5 0 0 0 .4-7 5.2 5.2 0 0 0-10-1.3A3.6 3.6 0 0 0 7 15.5z';
  const ICONES = {
    horloge: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    cloche: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 20.5a2 2 0 0 0 4 0"/>',
    soleil: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    eclaircie: '<path d="M8 3.5V5M3.4 5.4l1 1M2 10h1.5M12.6 5.4l-1 1"/><path d="M5.6 12A3.2 3.2 0 0 1 11 8.6"/><path d="M9.5 19.5H17a3.2 3.2 0 0 0 .4-6.4 4.7 4.7 0 0 0-9-1.2 3.3 3.3 0 0 0 1.1 7.6z"/>',
    nuage: `<path d="${NUAGE}" transform="translate(0 2)"/>`,
    brume: '<path d="M4 8h16M6 12h12M4 16h16M8 20h8"/>',
    pluie: `<path d="${NUAGE}"/><path d="M9 18.5l-1 2.5M13 18.5l-1 2.5M17 18.5l-1 2.5"/>`,
    neige: `<path d="${NUAGE}"/><path d="M8.5 19.5h.01M12.5 19.5h.01M16.5 19.5h.01M10.5 22h.01M14.5 22h.01"/>`,
    orage: `<path d="${NUAGE}"/><path d="M13 15.5l-2.2 3.2h2.6l-1.6 3.3"/>`,
    inconnu: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
    horizon: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 6v3M5.6 10.6l1.6 1.6M18.4 10.6l-1.6 1.6"/>',
  };
  /** Une icône dessinée ici, par son nom (jamais un texte venu d'ailleurs) ; un nom inconnu : rien. */
  const icone = (k) => (Object.prototype.hasOwnProperty.call(ICONES, k) ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[k]}</svg>` : '');
  // Les couleurs : celles du thème d'Odin (--accent, --good, --warn, --ink, --muted) ou, sur l'écran de la maison,
  // celles de son thème (--text). Aucune couleur n'est écrite ici.
  const CSS = `
/* Un petit chiffre de la maquette : une icône sur un fond de sa teinte à 18 %, la valeur, son libellé. La valeur reste
   entière : si elle ne tient pas à côté de l'icône, l'icône lui cède sa place (elle passe à la ligne, hors de la vue).
   Le libellé, lui, se coupe : il ne compte pas dans la largeur demandée. */
.wi-chiffre{--wi-c:var(--accent,currentColor);position:relative;display:flex;flex-flow:row-reverse wrap;align-items:center;align-content:flex-start;gap:0 12px;min-width:0;height:44px;overflow:hidden}
.wi-ic{flex:none;width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:color-mix(in srgb,var(--wi-c) 18%,transparent);color:var(--wi-c)}
.wi-ic svg{width:22px;height:22px}
.wi-t{order:-1;flex:1 0 auto;min-width:0;max-width:100%;min-height:44px;display:flex;flex-direction:column;justify-content:center}
.wi-v{display:block;font-size:clamp(15px,17cqi,21px);font-weight:750;letter-spacing:-.02em;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;color:var(--ink,var(--text,inherit))}
.wi-v small{font-size:.58em;font-weight:600;letter-spacing:0;color:var(--muted,inherit)}
.wi-l{display:block;width:0;min-width:100%;font-size:11.5px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted,inherit)}
/* Zéro alerte : le calme ; des alertes : l'alarme, sur l'icône et sur le chiffre ; une donnée ancienne : l'icône s'efface, son âge en ambre. */
.wi-calme{--wi-c:var(--good,currentColor)}
.wi-alarme{--wi-c:var(--warn,currentColor)}.wi-alarme .wi-v{color:var(--warn,inherit)}
.wi-ancien{--wi-c:var(--muted,currentColor)}.wi-age{font-weight:700;color:var(--warn,inherit)}
/* Carte étroite (deux colonnes sur douze, écran moins large) : l'icône rétrécit, elle reste. */
@container (max-width:135px){.wi-chiffre{column-gap:9px}.wi-ic{width:36px;height:36px;border-radius:11px}.wi-ic svg{width:19px;height:19px}}
@container (max-width:104px){.wi-chiffre{column-gap:7px}.wi-ic{width:28px;height:28px;border-radius:9px}.wi-ic svg{width:16px;height:16px}}
/* L'horloge de la maquette : l'heure en grand, puis la date et la semaine. */
.wi-horloge{display:flex;flex-direction:column;gap:4px;min-width:0}
.wi-hh{font-size:clamp(26px,24cqi,52px);font-weight:750;letter-spacing:-.04em;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--ink,var(--text,inherit))}
.wi-hh small{font-size:.36em;font-weight:650;letter-spacing:0;color:var(--muted,inherit)}
.wi-hd{font-size:12.5px;line-height:1.35;overflow-wrap:anywhere;color:var(--muted,inherit)}.wi-hd::first-letter{text-transform:uppercase}
/* La grande météo de la maquette : maintenant (le ciel, la température, le haut et le bas du jour) ; « Complète » y
   ajoute la bande des 24 heures (elle défile, au doigt comme au clavier), le soleil et les jours. */
.wm{position:relative;display:flex;flex-direction:column;gap:12px;min-width:0;width:100%;color:var(--ink,var(--text,inherit))}
.wm-maint{display:flex;align-items:center;gap:12px;min-width:0}
.wm-ic{flex:none;width:44px;height:44px;display:grid;place-items:center;color:var(--accent,currentColor)}.wm-ic svg{width:36px;height:36px}
.wm-t{flex:none;font-size:clamp(34px,13cqi,48px);font-weight:800;letter-spacing:-.04em;line-height:1;font-variant-numeric:tabular-nums}
.wm-mots{display:flex;flex-direction:column;gap:2px;min-width:0}
.wm-ciel{font-size:13.5px;font-weight:650;line-height:1.3;color:var(--muted,inherit);overflow-wrap:anywhere}.wm-ciel::first-letter{text-transform:uppercase}
.wm-mm{font-size:12px;line-height:1.3;color:var(--muted,inherit);font-variant-numeric:tabular-nums}
.wm-heures{display:flex;gap:4px;min-width:0;max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;border-radius:12px;padding:2px}
.wm-heures:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:1px}
.wm-h{flex:none;min-width:50px;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:4px 6px;border-radius:10px;background:color-mix(in srgb,var(--ink,currentColor) 6%,transparent)}
.wm-hh{font-size:11px;line-height:1.2;white-space:nowrap;color:var(--muted,inherit)}.wm-ht{font-size:14px;font-weight:700;line-height:1.2;font-variant-numeric:tabular-nums}
.wm-soleil{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;font-size:12.5px;line-height:1.3;color:var(--muted,inherit)}
.wm-soleil svg{display:block;width:18px;height:18px;color:var(--warn,currentColor)}
.wm-jours{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;min-width:0}
.wm-j{display:flex;align-items:center;gap:8px;min-width:0;font-size:13px;line-height:1.2;font-variant-numeric:tabular-nums}
.wm-jn{flex:none;width:3.4em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wm-j svg{flex:none;width:20px;height:20px;color:var(--accent,currentColor)}
.wm-jmin{flex:none;width:2.6em;text-align:right;color:var(--muted,inherit)}.wm-jmax{flex:none;width:2.6em}
.wm-barre{position:relative;flex:1;min-width:24px;height:6px;border-radius:99px;background:color-mix(in srgb,var(--ink,currentColor) 10%,transparent)}
.wm-barre i{position:absolute;top:0;bottom:0;border-radius:99px;background:linear-gradient(90deg,var(--accent,currentColor),var(--warn,currentColor))}
/* « Scène » : la température en grand, sur une teinte du ciel prise au thème (jamais une couleur écrite ici). Elle couvre
   toute la carte : la carte qui la porte range ses enfants en colonne, et la scène prend la hauteur qui reste. */
:has(>.wm-scene){display:flex;flex-direction:column}
.wm-scene{flex:1 1 auto;min-height:0;justify-content:flex-end;padding:12px;border-radius:14px}
.wm-scene::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(160deg,color-mix(in srgb,var(--accent,currentColor) 24%,transparent),transparent 75%)}
.wm-scene>*{position:relative}.wm-scene .wm-maint{flex-direction:column;align-items:flex-start;gap:4px}.wm-scene .wm-t{font-size:clamp(44px,22cqi,72px)}.wm-scene .wm-ic{position:absolute;top:0;right:0}`;
  function poserStyle() {
    const R = window.OdinWidgetsRendu;
    if (R && typeof R.poserStyle === 'function') R.poserStyle(); // la classe des textes dits aux lecteurs d'écran
    if (document.getElementById('odinWidgetsInfos')) return;
    const s = document.createElement('style'); s.id = 'odinWidgetsInfos'; s.textContent = CSS; document.head.append(s);
  }
  function el(t, cls, texte) { const n = document.createElement(t); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; }
  const langue = () => { try { return document.documentElement.lang || undefined; } catch { return undefined; } };
  const texte = (v) => (typeof v === 'string' ? v : '');
  /** L'heure en nœuds : les chiffres, et le matin ou l'après-midi en petit. */
  const noeudsHeure = (h) => h.segments.map((s) => (s.petit ? el('small', '', s.v) : document.createTextNode(s.v)));
  /**
   * Tient un nœud à l'heure : tout de suite, puis toutes les dix secondes tant qu'il est dans la page. Sorti de la
   * page (un nouveau dessin l'a remplacé), ou jamais entré au bout d'une minute : son minuteur s'arrête.
   */
  function tenir(noeud, maj) {
    maj();
    let vu = false, absent = 0;
    const t = setInterval(() => { if (noeud.isConnected) { vu = true; maj(); } else if (vu || ++absent > 6) clearInterval(t); }, 10000);
  }
  /**
   * Sans fuseau lisible : jamais l'heure de l'appareil. L'horloge l'écrit sur la ligne commune ; le petit chiffre
   * (`libelle` donné) garde sa taille : son état court, dessiné par le dessin commun.
   */
  function sansFuseau(libelle) {
    const R = window.OdinWidgetsRendu, d = R.decrire({ etat: 'vide', raison: 'fuseau_inconnu' }, {});
    return libelle === undefined ? R.corps(d) : R.etatPetit(d, { titre: libelle });
  }
  /**
   * Le petit chiffre. `o` : { icone, ton ('calme', 'alarme', 'ancien' ou rien), valeur et libelle (des nœuds ou des
   * textes), dit (la phrase entière, pour qui ne voit pas l'écran et pour l'info-bulle) }. Rend { box, v, dit }.
   */
  function chiffre(o) {
    poserStyle();
    const box = el('div', `wi-chiffre${o.ton ? ` wi-${o.ton}` : ''}`), ic = el('span', 'wi-ic'), t = el('div', 'wi-t'), v = el('b', 'wi-v'), l = el('span', 'wi-l'), dit = el('span', 'wr-sr', o.dit || '');
    ic.setAttribute('aria-hidden', 'true'); ic.innerHTML = icone(o.icone);
    v.setAttribute('aria-hidden', 'true'); l.setAttribute('aria-hidden', 'true');
    v.append(...(o.valeur || [])); l.append(...(o.libelle || []));
    t.append(v, l); box.append(ic, t, dit);
    if (o.dit) box.title = o.dit;
    return { box, v, dit };
  }

  /** L'heure en petit chiffre : l'heure d'Odin, son libellé. */
  function petiteHeure(e, o) {
    const d = e.donnee || {}, libelle = texte(o.titre) || T.heure.titre;
    if (!heureDe(d, new Date(), langue())) return sansFuseau(libelle);
    const c = chiffre({ icone: 'horloge', libelle: [libelle] });
    tenir(c.box, () => {
      const h = heureDe(d, new Date(), langue()); if (!h) return;
      const dit = T.heure.dit(h.texte, texte(d.lieu));
      c.v.replaceChildren(...noeudsHeure(h)); c.dit.textContent = dit; c.box.title = dit;
    });
    return c.box;
  }
  /** L'horloge : l'heure en grand, puis la date et la semaine, dans le fuseau d'Odin. */
  function grandeHeure(e) {
    const d = e.donnee || {};
    if (!heureDe(d, new Date(), langue())) return sansFuseau();
    poserStyle();
    const box = el('div', 'wi-horloge'), hh = el('b', 'wi-hh'), hd = el('span', 'wi-hd');
    box.append(hh, hd);
    tenir(box, () => { const h = heureDe(d, new Date(), langue()); if (!h) return; hh.replaceChildren(...noeudsHeure(h)); hd.textContent = `${h.jour} · ${T.horloge.semaine(h.semaine)}`; });
    return box;
  }
  /** Sous le titre de l'horloge : le lieu d'Odin et le décalage de son fuseau. */
  function sousHorloge(e) {
    const d = e.donnee || {}, h = heureDe(d, new Date(), langue());
    return [texte(d.lieu), h ? h.decalage : ''].filter(Boolean).join(' · ');
  }
  /** La météo en petit chiffre : le ciel (une icône), la température, le lieu ; ancienne : son âge d'abord, en ambre. */
  function petiteMeteo(e, o) {
    const R = window.OdinWidgetsRendu, d = e.donnee || {};
    if (typeof d.temp !== 'number' || !Number.isFinite(d.temp)) return null; // jamais un chiffre inventé
    const ciel = cielDe(d.code), lieu = texte(d.lieu) || texte(o.titre) || T.meteo.titre, valeur = `${Math.round(d.temp)}°`, age = texte(o.pastille);
    const dit = `${T.meteo.dit(valeur, lieu, T.meteo.ciels[ciel] || '')}${age ? ` ${R.TEXTES.depuisNom(age)}.` : ''}`;
    return chiffre({ icone: ciel, ton: age ? 'ancien' : '', valeur: [valeur], libelle: age ? [el('span', 'wi-age', age), ` · ${lieu}`] : [lieu], dit }).box;
  }
  /** Les alertes pas encore vues : leur nombre, en couleur d'alarme ; zéro (l'état « vide » du serveur) : le calme. */
  function petitesAlertes(e, o) {
    const R = window.OdinWidgetsRendu, calme = e.etat === 'vide' && e.raison === 'aucune_alerte', n = calme ? 0 : (e.donnee || {}).nombre;
    if (!Number.isInteger(n) || n < 0 || (n === 0 && !calme)) return null; // un nombre illisible : rien d'affirmé
    return chiffre({ icone: 'cloche', ton: n > 0 ? 'alarme' : 'calme', valeur: [new Intl.NumberFormat(langue()).format(n)], libelle: [texte(o.titre) || T.alertes.titre], dit: n > 0 ? T.alertes.dit(n) : R.decrire(e, {}).texte }).box;
  }

  /** La hauteur du widget, en lignes de la grille (celle de la sorte « meteo » quand elle n'est pas écrite). */
  function lignesDe(w) {
    const G = window.OdinGrille;
    try { if (G && typeof G.taille === 'function') return G.taille(w).r; } catch { /* la valeur écrite */ }
    return w && Number.isInteger(w.r) ? w.r : 3;
  }
  const nombre = (v) => typeof v === 'number' && Number.isFinite(v);
  const degres = (v) => `${Math.round(v)}°`;
  const decor = (k) => { const s = el('span'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = icone(k); return s; };
  /**
   * La grande météo, l'un de ses trois styles. `e.donnee` : ce que le serveur rend (src/valhalla/widgets/infos.ts,
   * grandeMeteo) : { lieu, temp, code, max?, min?, heure12, jours, heures, lever?, coucher? }. Chaque partie n'est
   * posée que si la source l'a donnée : jamais une ligne vide, jamais un tiret à sa place. Plus le widget a de lignes,
   * plus il en montre : dès 4 lignes, les heures, le soleil et 3 jours ; dès 5 lignes (la taille de la maquette), les 7.
   */
  function grandeMeteo(style, e, o) {
    const d = e.donnee || {};
    if (!nombre(d.temp)) return null; // jamais un chiffre inventé
    poserStyle();
    const G = T.grande, lg = langue(), ciel = cielDe(d.code), mot = T.meteo.ciels[ciel] || '', r = lignesDe(o.w);
    const box = el('div', `wm wm-${style}`); box.dataset.style = style;
    const maint = el('div', 'wm-maint'), ic = decor(ciel), mots = el('div', 'wm-mots');
    ic.className = 'wm-ic';
    if (mot) mots.append(el('span', 'wm-ciel', mot));
    if (style !== 'scene' && nombre(d.max) && nombre(d.min)) mots.append(el('span', 'wm-mm', G.maxMin(degres(d.max), degres(d.min))));
    maint.append(ic, el('b', 'wm-t', degres(d.temp)));
    if (mots.childNodes.length) maint.append(mots);
    box.append(maint);
    if (style !== 'complete') return box;
    // Les 24 heures (l'heure et la température : la source n'en dit pas plus), le soleil, puis les jours.
    const heures = (Array.isArray(d.heures) ? d.heures : []).filter((h) => h && nombre(h.temp) && heureCourte(h.h, d.heure12, lg));
    if (r >= 4 && heures.length) {
      const bande = el('div', 'wm-heures'); bande.tabIndex = 0; bande.setAttribute('role', 'group'); bande.setAttribute('aria-label', G.heures);
      for (const h of heures) { const c = el('span', 'wm-h'); c.append(el('small', 'wm-hh', heureCourte(h.h, d.heure12, lg)), el('b', 'wm-ht', degres(h.temp))); bande.append(c); }
      box.append(bande);
    }
    const lever = heureCourte(d.lever, d.heure12, lg), coucher = heureCourte(d.coucher, d.heure12, lg);
    if (r >= 4 && (lever || coucher)) {
      const sol = el('div', 'wm-soleil');
      sol.append(decor('horizon')); if (lever) sol.append(el('span', '', G.lever(lever))); if (coucher) sol.append(el('span', '', G.coucher(coucher)));
      box.append(sol);
    }
    const jours = (Array.isArray(d.jours) ? d.jours : []).filter((j) => j && nombre(j.min) && nombre(j.max) && jourCourt(j.jour, lg)).slice(0, r >= 5 ? 7 : r >= 4 ? 3 : 0);
    if (jours.length) {
      const bas = Math.min(...jours.map((j) => j.min)), haut = Math.max(...jours.map((j) => j.max)), ecart = Math.max(1, haut - bas);
      const ul = el('ul', 'wm-jours'); ul.setAttribute('aria-label', G.jours);
      for (const j of jours) {
        const nom = jourCourt(j.jour, lg), cj = cielDe(j.code), li = el('li', 'wm-j'), barre = el('span', 'wm-barre'), plage = el('i');
        plage.style.left = `${((j.min - bas) / ecart) * 100}%`; plage.style.right = `${((haut - j.max) / ecart) * 100}%`; barre.append(plage);
        const vus = [el('b', 'wm-jn', nom), decor(cj), el('small', 'wm-jmin', degres(j.min)), barre, el('b', 'wm-jmax', degres(j.max))];
        for (const n of vus) n.setAttribute('aria-hidden', 'true');
        li.append(...vus, el('span', 'wr-sr', G.jourDit(nom, T.meteo.ciels[cj] || '', degres(j.min), degres(j.max)))); ul.append(li);
      }
      box.append(ul);
    }
    return box;
  }
  /** Sous le titre de la grande météo : le lieu d'Odin (la pastille d'une donnée ancienne est celle de l'en-tête commun). */
  const sousMeteo = (e) => texte((e.donnee || {}).lieu);

  window.OdinWidgetsInfos = { TEXTES, CSS, heureDe, semaineDe, cielDe, heureCourte, jourCourt };
  // La déclaration de la famille (lue par pages/widgets-rendu.js, quel que soit l'ordre de chargement). Les tailles sont
  // celles de la maquette : 2 × 1 pour un petit chiffre (une ligne au téléphone aussi), 3 × 2 pour l'horloge.
  const PETIT = { c: 2, r: 1, pr: 1 };
  (window.OdinWidgetsFamilles = window.OdinWidgetsFamilles || []).push({ famille: 'infos', sortes: [
    { sorte: 'heure_petite', titre: T.heure.titre, quoi: T.heure.quoi, symbole: '🕒', appli: 'gladsheim', petit: true, poser: PETIT, dessiner: petiteHeure },
    { sorte: 'heure', style: 'horloge', titre: T.horloge.titre, quoi: T.horloge.quoi, symbole: '🕒', appli: 'gladsheim', poser: { c: 3, r: 2 }, sous: sousHorloge, dessiner: grandeHeure },
    { sorte: 'meteo_petite', titre: T.meteo.titre, nom: T.meteo.nom, quoi: T.meteo.quoi, symbole: '☀', appli: 'gladsheim', petit: true, poser: PETIT, dessiner: petiteMeteo },
    { sorte: 'alertes', titre: T.alertes.titre, quoi: T.alertes.quoi, symbole: '🔔', appli: 'forseti', petit: true, poser: PETIT, vides: ['aucune_alerte'], dessiner: petitesAlertes },
    // La grande météo : trois styles de la sorte « meteo » (sans style, le dessin d'hier reste celui de la fenêtre). Ce
    // sont des styles : ils se choisissent dans « Régler », sans ligne au tiroir ni taille à eux (le widget garde la sienne).
    ...['complete', 'compacte', 'scene'].map((st) => ({ sorte: 'meteo', style: st, titre: T.meteo.titre, symbole: '☀', appli: 'gladsheim', tiroir: false, sous: sousMeteo, dessiner: (e, o) => grandeMeteo(st, e, o) })),
  ] });
})();
