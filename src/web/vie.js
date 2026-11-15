// Odin, sa vie intérieure : ce qui le pousse à agir, et pourquoi.
// Il a des besoins (énergie, curiosité, compagnie, ennui, fierté, inquiétude…), un caractère du jour (joueur, posé,
// curieux, affectueux, appliqué ou rêveur), une disposition de fond, des émotions et des comportements. Rien n'est
// tiré au sort : tout vient de l'heure, de la page, de ce qui vient de se passer et de son état ; le même scénario
// rejoué donne exactement la même chose. Chaque chose qu'il fait a une raison, qu'il sait dire.
// Ce fichier ne dessine rien et ne choisit jamais de coordonnées : il décide, puis demande une expression au visage
// (OdinFace, face.js) et un plan de gestes à la mascotte en liberté (OdinCompanion, companion.js).
// Deux parties : d'abord le cœur (des fonctions pures, l'horloge et le contexte en paramètres, essayées hors
// navigateur par test/vie.test.ts), puis le branchement à la page.
(() => {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;
  if (G.OdinVie) return;

  // =====================================================================================================
  // 1. LE CŒUR : des fonctions pures (aucun accès à la page, pas d'horloge propre, aucun hasard)
  // =====================================================================================================
  const SEC = 1000, MIN = 60 * SEC, HEURE = 60 * MIN, JAMAIS = -1e15;
  const borne = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const fini = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Empreinte d'un texte (FNV-1a, 32 bits) : sert à sa disposition du jour et aux clés courtes. */
  function hache(txt) { let h = 0x811c9dc5; const s = String(txt); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }

  // ---------- Les tables ----------
  /** Son rythme sur 24 heures (de 0 à 1), heure par heure ; entre deux heures, on interpole. */
  const RYTHME = [.25, .18, .12, .10, .12, .20, .45, .70, .85, .95, 1, .95, .85, .70, .72, .80, .85, .85, .80, .72, .65, .55, .45, .33];
  function rythme(h) { const x = ((Number(h) % 24) + 24) % 24, a = Math.floor(x) % 24, b = (a + 1) % 24; return RYTHME[a] + (RYTHME[b] - RYTHME[a]) * (x - Math.floor(x)); }

  /** Les sortes de faits qu'on peut lui noter. */
  const SORTES = ['page', 'nouveau', 'reussite', 'echec', 'appris', 'alerte', 'alerte_reglee', 'appel', 'survol', 'caresse', 'embete', 'merci', 'humeur', 'echange', 'retour', 'reveil', 'travail', 'bloque'];
  /** Les faits qui sont du nouveau pour lui (ils chassent l'ennui et l'usure de ce qu'il répétait). */
  const NEUF = new Set(['page', 'nouveau', 'echange', 'appel', 'alerte', 'reussite', 'echec']);
  /** Les faits qu'on fond en un seul quand ils se répètent coup sur coup (les autres se comptent). */
  const FUSION = new Set(['page', 'survol', 'nouveau', 'humeur', 'travail', 'retour', 'echange']);
  /** Les faits légers : nombreux et vite oubliés. Ils ont leur propre place, pour ne jamais chasser de sa mémoire ceux qui pèsent (alerte, merci, réussite, échec, secousse). */
  const LEGERS = new Set(['nouveau', 'survol', 'humeur', 'travail']);

  /** La palette, en court (famille : identifiant + degré), pour connaître la famille et le degré d'une émotion sans le visage. */
  const PALETTE = 'joie:serenite1 contentement1 joie2 rire3 euphorie3|tristesse:melancolie1 triste2 chagrin3 pleurs3|colere:agacement1 frustration2 colere2 rage3|'
    + 'peur:inquiet1 apprehension2 peur2 terreur3 panique3|surprise:etonnement1 surprise2 stupeur3|degout:moue1 degout2 mepris3|'
    + 'amour:confiance1 tendresse1 gratitude2 admiration2 amour3|fierte:satisfaction1 assurance2 fierte2 determination2|gene:timidite1 gene2 culpabilite2 honte3|'
    + 'envie:envie1 jalousie2|attente:curiosite1 interet1 espoir2 impatience2 enthousiasme2 excite3|manque:ennui1 nostalgie1 deception2 solitude2|'
    + 'fatigue:lassitude1 fatigue2 epuisement3 sommeil3|esprit:clin1 reflexion1 doute1 concentration2 confus2 malice2|calme:neutre1 calme1 soulagement2|'
    + 'dialogue:ecoute1 regarde1 parle1 cache1';
  /** Les 16 familles : humeur de base (repli sur un ancien visage) et valence (agréable 1, pénible -1). */
  const FAMILLES = { joie: ['joie', 1], tristesse: ['triste', -1], colere: ['colere', -1], peur: ['peur', -1], surprise: ['surprise', 0], degout: ['confus', -1], amour: ['amour', 1], fierte: ['fierte', 1],
    gene: ['gene', -1], envie: ['malice', -1], attente: ['excite', 1], manque: ['triste', -1], fatigue: ['fatigue', -1], esprit: ['reflexion', 0], calme: ['neutre', 1], dialogue: ['ecoute', 0] };
  const EMOTIONS = {};
  for (const bloc of PALETTE.split('|')) { const [fam, liste] = bloc.split(':'); for (const m of liste.split(' ')) EMOTIONS[m.slice(0, -1)] = { famille: fam, degre: Number(m.slice(-1)) }; }
  const ORIGINE = new Set(['neutre', 'joie', 'rire', 'amour', 'fierte', 'excite', 'clin', 'malice', 'surprise', 'reflexion', 'concentration', 'confus', 'inquiet', 'triste', 'colere', 'peur', 'gene', 'fatigue', 'ecoute', 'regarde', 'parle', 'cache']);
  /** Ce qu'on sait d'une émotion : famille, degré, valence. Inconnue : rien. */
  function emotion(id) { const m = EMOTIONS[id]; return m ? { id, famille: m.famille, degre: m.degre, valence: FAMILLES[m.famille][1] } : null; }
  /** L'humeur d'origine à montrer sur un ancien visage, et pour combien de temps. */
  function repli(id) { const m = EMOTIONS[id]; if (!m) return 'neutre'; if (ORIGINE.has(id)) return id; if (m.degre === 1 && m.famille === 'peur') return 'inquiet'; if (m.degre === 1 && m.famille === 'attente') return 'regarde'; return FAMILLES[m.famille][0]; }
  const dureeRepli = (id) => [8, 8, 20, 60][(EMOTIONS[id] || { degre: 1 }).degre] * SEC;

  /** Ses six caractères : nom, effets sur ses besoins (k…), sur son énergie (dEnergie), sur ses envies et sur sa pause entre deux gestes. */
  const CARACTERES = {
    enjoue: { nom: 'joueur', humeur: 'joueuse', socle: 0, dEnergie: .08, kCuriosite: 1.15, kEnnui: 1.1, kAgacement: .9, pause: .7, envies: { jouer: 1.5, sautiller: 1.3, promenade: 1.2 } },
    calme: { nom: 'posé', humeur: 'posée', socle: .20, kEnnui: .8, kAgacement: .8, envies: { regarder_travailler: 1.3, promenade: .6 } },
    curieux: { nom: 'curieux', humeur: 'curieuse', socle: 0, kCuriosite: 1.4, envies: { aller_voir: 1.5, observer_page: 1.2, regarder_autour: 1.2 } },
    calin: { nom: 'affectueux', humeur: 'affectueuse', socle: 0, kCompagnie: 1.4, envies: { se_rapprocher: 1.4, suivre_regard: 1.3 } },
    studieux: { nom: 'appliqué', humeur: 'appliquée', socle: 0, kEnnui: .7, envies: { regarder_travailler: 1.5, jouer: .5 } },
    reveur: { nom: 'rêveur', humeur: 'rêveuse', socle: 0, dEnergie: -.08, envies: { soupirer: 1.2, promenade: .8 } },
  };
  /** Ses dispositions de fond, dans l'ordre où elles passent devant à score égal, avec leur durée minimale. */
  const FONDS = ['endormi', 'somnolent', 'soucieux', 'boudeur', 'en_manque', 'las', 'enjoue', 'eveille'];
  const FOND_MINI = { eveille: 60 * SEC, enjoue: 60 * SEC, somnolent: 180 * SEC, endormi: 120 * SEC, soucieux: 120 * SEC, las: 120 * SEC, en_manque: 120 * SEC, boudeur: 30 * SEC };
  /** L'expression que le visage prend pour chaque disposition (jamais en couleur). */
  const FOND_VISAGE = { eveille: 'neutre', enjoue: 'contentement', somnolent: 'lassitude', endormi: 'sommeil', soucieux: 'inquiet', boudeur: 'moue', en_manque: 'solitude', las: 'ennui', alerte: 'inquiet' };
  /**
   * Le visage d'une disposition. « Attentif » est un fond comme les autres, plus un état tenu : tenu, il cachait ses
   * émotions (le réveil à l'appel, l'humeur d'une réponse). À l'écoute quand tu lui parles ; pensif quand il travaille,
   * pour que les éclats des outils (il regarde, il se concentre) passent devant.
   */
  const visageFond = (id, ctx) => (id === 'attentif' ? (ctx && ctx.occupe ? 'reflexion' : 'ecoute') : FOND_VISAGE[id] || 'neutre');

  const CONST = {
    battement: 2 * SEC, faitsMax: 60, faitsLegers: 30, faitsAge: 6 * HEURE, frais: 10 * SEC, presence: 60 * SEC, retour: 30 * MIN, reveilTrou: 4 * HEURE, reveilNuit: 90 * MIN,
    scoreMini: .45, pauseMini: 8 * SEC, entreAllers: 45 * SEC, allersParDixMin: 12, margeFond: .15, entreFonds: 60 * SEC,
    SORTES, RYTHME, CARACTERES, FONDS, FOND_MINI, FOND_VISAGE, FAMILLES, EMOTIONS,
  };

  // ---------- Dire les choses ----------
  /** Une durée dite simplement : « 45 min », « 2 h ». */
  function dureeDite(ms) { const m = Math.round(Math.max(0, ms) / MIN); return m < 1 ? 'moins d\'une minute' : m < 90 ? `${m} min` : `${Math.round(m / 60)} h`; }
  /** L'heure dite simplement : « 2 h du matin », « 15 h ». */
  function heureDite(h) { const a = Math.floor((((Number(h) || 0) % 24) + 24) % 24); return `${a} h${a < 6 ? ' du matin' : ''}`; }
  const court = (txt, n) => { const s = String(txt == null ? '' : txt).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
  const cite = (txt, n = 40) => `« ${court(txt, n)} »`;
  /** Une phrase dite par Odin : 120 caractères au plus, jamais vide. */
  const phrase = (txt) => court(txt, 120) || 'Je suis tranquille.';

  // ---------- Le caractère du jour ----------
  /** Le jour de la semaine d'une date « AAAA-MM-JJ » (0 = dimanche), sans horloge. */
  function jourSemaine(jour) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(jour || '')); if (!m) return -1;
    let y = Number(m[1]); const mo = Number(m[2]), d = Number(m[3]), T = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    if (mo < 1 || mo > 12) return -1; if (mo < 3) y -= 1;
    return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + T[mo - 1] + d) % 7;
  }
  /**
   * Son caractère du jour : une fonction pure du jour et de la fête (les deux viennent du serveur), donc le même sur
   * tous les écrans sans rien garder. Chaque caractère a un score : sa disposition du jour (tirée de la date), plus
   * ce que le jour lui apporte (samedi, lundi, fête…). Le plus haut gagne ; un jour de fête, il est joueur ou affectueux.
   */
  function caractereDuJour(o) {
    const jour = String((o && o.jour) || ''), fete = (o && o.fete) || null, js = jourSemaine(jour);
    const famille = Boolean(fete && (fete.id === 'anniversaire' || fete.id === 'famille'));
    const bonus = {
      enjoue: [[js === 6, .30, 'samedi'], [js === 0, .30, 'dimanche'], [Boolean(fete), .45, 'fete']],
      calme: [],
      curieux: [[js === 1, .30, 'lundi']],
      calin: [[js === 0, .25, 'dimanche'], [famille, .35, 'famille']],
      studieux: [[js >= 2 && js <= 4, .25, 'semaine']],
      reveur: [[js === 0, .20, 'dimanche'], [js === 5, .15, 'vendredi']],
    };
    let best = null;
    for (const id of Object.keys(CARACTERES)) {
      if (fete && id !== 'enjoue' && id !== 'calin') continue;
      let s = CARACTERES[id].socle + (hache(`${jour}:${id}`) % 1000) / 2500; const causes = [];
      for (const [vrai, v, code] of bonus[id]) if (vrai) { s += v; causes.push(code); }
      if (!best || s > best.s) best = { id, s, causes };
    }
    return { id: best.id, nom: CARACTERES[best.id].nom, causes: best.causes.length ? best.causes : ['jour'] };
  }
  /** Le nom d'une fête dans une phrase : « c'est Noël », « c'est la fête du travail », « c'est ton anniversaire ». */
  function feteDite(nom) {
    const n = String(nom || '').trim(); if (!n) return 'un jour de fête';
    if (/^Ton /.test(n)) return `t${n.slice(1)}`;
    if (/^Anniversaire/.test(n)) return `l'a${n.slice(1)}`;
    if (/^Fête/.test(n)) return `la f${n.slice(1)}`;
    if (/^Saint-/.test(n)) return `la ${n}`;
    if (/^Abolition/.test(n)) return `l'a${n.slice(1)}`;
    if (/^Aïd/.test(n)) return `l'${n}`;
    if (/^(Nouvel An|Ramadan|Carnaval)$/.test(n)) return `le ${n}`;
    return n;
  }
  /** Les causes de son caractère, en une phrase refaite à partir des codes : « c'est samedi et c'est Noël ». */
  function causesDites(causes, fete) {
    const T = { samedi: 'c\'est samedi', dimanche: 'c\'est dimanche', lundi: 'c\'est lundi', vendredi: 'c\'est vendredi', semaine: 'c\'est le milieu de la semaine', jour: 'c\'est mon humeur du jour' };
    const out = [];
    for (const c of Array.isArray(causes) && causes.length ? causes : ['jour']) {
      const t = c === 'fete' || c === 'famille' ? `c'est ${feteDite(fete && fete.nom)}` : T[c];
      if (t && !out.includes(t)) out.push(t);
    }
    return out.length ? out.join(' et ') : T.jour;
  }

  // ---------- Les faits ----------
  /** Une impulsion : chaque fait pèse son poids, qui s'efface avec le temps (tau). De 0 à 1. */
  function impulsion(faits, poids, tau, now) {
    let s = 0;
    for (const f of faits) { const w = poids[f.k]; if (w && f.t <= now) s += w * (f.p == null ? 1 : f.p) * Math.exp(-(now - f.t) / tau); }
    return Math.min(1, s);
  }
  const compte = (etat, k, ms, now, garde) => etat.faits.reduce((n, f) => n + (f.k === k && now - f.t < ms && f.t <= now && (!garde || garde(f)) ? 1 : 0), 0);
  const dernierFait = (etat, sortes) => { for (let i = etat.faits.length - 1; i >= 0; i--) if (sortes.includes(etat.faits[i].k)) return etat.faits[i]; return null; };
  const depuisFait = (etat, sortes, apres) => etat.faits.some((f) => sortes.includes(f.k) && f.t > apres);
  const quand = (etat, cle) => (fini(etat.dernier[cle]) ? etat.dernier[cle] : JAMAIS);
  const seuil = (etat, cle) => (fini(etat.seuils[cle]) ? etat.seuils[cle] : JAMAIS);
  const vu = (etat, cle, now, ms) => fini(etat.vus[cle]) && now - etat.vus[cle] < ms;
  const effets = (etat) => CARACTERES[etat.caractere && etat.caractere.id] || {};
  /** Votre dernier contact : on s'est parlé, tu l'as appelé, remercié, ou tu es resté près de lui. Un simple survol ou une page ouverte en est un petit : il compte comme un contact vieux de 40 minutes. */
  const dernierContact = (etat) => Math.max(quand(etat, 'f:echange'), quand(etat, 'f:appel'), quand(etat, 'f:merci'), quand(etat, 'f:caresse'), Math.max(quand(etat, 'f:survol'), quand(etat, 'f:page')) - 40 * MIN, etat.eveilDepuis);
  /** Depuis quand il est à la même place (au plus tôt : l'ouverture de cet écran). */
  const surPlace = (etat) => Math.max(quand(etat, 'bouge'), etat.eveilDepuis, seuil(etat, 'ouvert'));

  // ---------- Ses besoins (de 0 à 1) ----------
  /**
   * Des fonctions pures de l'heure et des faits datés : rien ne monte à chaque seconde, un onglet caché retrouve le
   * bon état à son retour.
   */
  function besoins(etat, ctx, now) {
    const car = effets(etat), F = etat.faits;
    const eveil = Math.max(0, (now - etat.eveilDepuis) / MIN), usure = borne((eveil - 360) / 840, 0, .20), effort = impulsion(F, { travail: 1 }, 20 * MIN, now);
    let energie = borne(rythme(ctx.heure) - usure - .15 * effort + (car.dEnergie || 0));
    if (ctx.sommeil) energie = Math.min(energie, .15);
    const fatigue = 1 - energie;
    // Ce qui vient d'apparaître dans la page (un message de réussite ou d'échec posé quelque part) l'intrigue comme une nouveauté.
    const vues = F.map((f) => ((f.k === 'reussite' || f.k === 'echec') && fini(f.x) ? { t: f.t, k: 'nouveau', p: 1 } : f));
    const curiosite = borne(impulsion(vues, { page: .45, nouveau: .25, alerte: .20 }, 90 * SEC, now) * (car.kCuriosite || 1));
    let compagnie = borne((now - dernierContact(etat) - 20 * MIN) / (100 * MIN)) * (car.kCompagnie || 1);
    if (fatigue >= .8) compagnie *= .3;
    if (!ctx.present) compagnie *= .5;
    compagnie = borne(compagnie);
    const neuf = Math.max(quand(etat, 'f:page'), quand(etat, 'f:nouveau'), quand(etat, 'f:echange'), quand(etat, 'f:appel'), quand(etat, 'f:alerte'), quand(etat, 'f:reussite'), quand(etat, 'f:echec'), quand(etat, 'promenade') + 3 * MIN, etat.eveilDepuis);
    const ennui = borne(borne((now - neuf - 4 * MIN) / (11 * MIN)) * (car.kEnnui || 1));
    const fierte = impulsion(F, { reussite: .4, appris: .8, merci: .5 }, 4 * MIN, now);
    // Une alerte que tu as vue ne l'inquiète plus : seules comptent celles arrivées depuis.
    const vueLe = quand(etat, 'f:alerte_reglee'), alertes = F.filter((f) => f.k === 'alerte' && f.t > vueLe);
    const inquietude = borne(Math.max(ctx.graves > 0 ? 1 : 0, impulsion(alertes, { alerte: 1 }, 3 * MIN, now), .3 * impulsion(F, { echec: 1 }, 2 * MIN, now)) * (car.kInquietude || 1));
    const soulagement = impulsion(F, { alerte_reglee: 1 }, 2 * MIN, now);
    const agacement = borne(impulsion(F, { embete: .34, echec: .2, bloque: 1 }, 5 * MIN, now) * (car.kAgacement || 1));
    const tendresse = impulsion(F, { caresse: .3, merci: .6, appel: .15 }, 6 * MIN, now);
    return { energie, fatigue, curiosite, compagnie, ennui, fierte, inquietude, soulagement, agacement, tendresse };
  }

  // ---------- Sa disposition de fond : lente, jamais en couleur ----------
  /** Le score de chaque disposition. Celle qu'il a déjà garde sa place un peu plus longtemps (seuil abaissé de 0,10). */
  function scoresFond(etat, B, ctx, now) {
    const cur = etat.fond.id, h = (id) => (cur === id ? .10 : 0), car = etat.caractere && etat.caractere.id;
    const absence = now - etat.dernierePresence, reveille = now - seuil(etat, 'reveille') < 180 * SEC, out = {};
    out.endormi = reveille ? 0 : ctx.sommeil ? 1 : (B.fatigue >= .8 - h('endormi') && absence >= 180 * SEC ? B.fatigue : 0);
    out.somnolent = B.fatigue >= .65 - h('somnolent') ? B.fatigue - .1 : 0;
    out.soucieux = B.inquietude >= .45 - h('soucieux') ? B.inquietude : 0;
    out.boudeur = B.agacement >= .55 - h('boudeur') && now >= seuil(etat, 'boudeInterdit') ? B.agacement : 0;
    // « En manque » ne dure pas des heures : au bout de 20 minutes il passe à autre chose, jusqu'au prochain contact (ou 6 heures).
    out.en_manque = B.compagnie >= .7 - h('en_manque') && ctx.present && now >= seuil(etat, 'manqueArret') ? B.compagnie - .1 : 0;
    out.las = B.ennui >= .6 - h('las') && ctx.present ? B.ennui - .15 : 0;
    const gai = Math.max(B.fierte, B.tendresse);
    out.enjoue = gai >= .5 - h('enjoue') ? gai : (car === 'enjoue' && B.energie >= .7 - h('enjoue') ? .5 : 0);
    out.eveille = .40;
    return out;
  }
  function raisonFond(id, etat, B, ctx, now) {
    switch (id) {
      case 'alerte': return 'une urgence n\'est pas vue';
      case 'attentif': return ctx.occupe ? 'je travaille sur ta demande' : ctx.fenetre ? 'tu me parles' : 'tu m\'as appelé';
      case 'endormi': return ctx.sommeil ? 'c\'est le mode sommeil' : `il est ${heureDite(ctx.heure)} et rien ne bouge depuis ${dureeDite(now - etat.dernierePresence)}`;
      case 'somnolent': return rythme(ctx.heure) <= .5 ? `il est ${heureDite(ctx.heure)}` : `je suis debout depuis ${dureeDite(now - etat.eveilDepuis)}`;
      case 'soucieux': return 'un souci n\'est pas réglé';
      case 'boudeur': { const n = compte(etat, 'embete', 5 * MIN, now); return n ? `tu m'as secoué ${n} fois` : 'ça ne marche pas comme je veux'; }
      case 'en_manque': return `on ne s'est pas parlé depuis ${dureeDite(now - Math.max(quand(etat, 'f:echange'), quand(etat, 'f:appel'), etat.eveilDepuis))}`;
      case 'las': return 'il ne se passe rien de neuf';
      case 'enjoue': return B.fierte >= .5 ? 'quelque chose vient de réussir' : B.tendresse >= .5 ? 'tu es gentil avec moi' : 'c\'est mon caractère du jour';
      default: return 'tout va bien';
    }
  }
  /**
   * La disposition suivante, ou rien s'il garde la sienne. Il change seulement si c'est forcé (urgence, tu lui parles,
   * on le réveille, la bouderie est finie), ou si une autre l'emporte nettement (0,15 de plus), que la sienne a duré
   * son temps et que le dernier changement libre date d'une minute au moins.
   */
  function fondSuivant(etat, B, ctx, now) {
    const cur = etat.fond.id, depuis = now - etat.fond.depuis;
    const va = (id, force) => (id === cur ? null : { id, force: Boolean(force), raison: raisonFond(id, etat, B, ctx, now) });
    if (ctx.graves > 0) return va('alerte', true);
    if (ctx.fenetre || ctx.occupe || now - quand(etat, 'f:appel') < 8 * SEC || now - seuil(etat, 'attentifFin') < 5 * SEC) return va('attentif', true);
    const sc = scoresFond(etat, B, ctx, now);
    const meilleur = (sauf) => { let b = null; for (const id of FONDS) { if (id === sauf) continue; if (!b || sc[id] > b.s) b = { id, s: sc[id] }; } return b; };
    if (cur === 'alerte' || cur === 'attentif' || etat.fond.neuf || !FONDS.includes(cur)) return va(meilleur().id, true);
    // Endormi : un appel ou un geste de la personne le réveille tout de suite.
    if (cur === 'endormi' && (depuisFait(etat, ['appel', 'survol', 'caresse', 'embete'], etat.t) || (ctx.present && !ctx.sommeil))) return va(meilleur('endormi').id, true);
    // Boudeur : 90 secondes au plus ; une caresse ou un appel y met fin.
    if (cur === 'boudeur' && (depuis >= 90 * SEC || depuisFait(etat, ['caresse', 'appel'], etat.t))) return va(meilleur('boudeur').id, true);
    const b = meilleur();
    // Il faut une nette différence pour changer ; sauf pour s'endormir quand il somnole déjà (c'est la suite naturelle).
    const marge = cur === 'somnolent' && b.id === 'endormi' ? 0 : CONST.margeFond;
    if (b.id === cur || b.s < (sc[cur] || 0) + marge) return null;
    if (depuis < (FOND_MINI[cur] || 0) || now - seuil(etat, 'fondLibre') < CONST.entreFonds) return null;
    return va(b.id, false);
  }

  // ---------- Ses émotions ----------
  /**
   * L'émotion qu'un fait déclenche, avec sa cause ; rien si ce fait ne lui fait rien. Le cœur ne tient pas l'émotion
   * en cours (c'est le visage qui arbitre) : il ne filtre que par ses propres délais. `cle` : à noter comme vu ;
   * `puis` : une deuxième émotion, un peu plus tard.
   */
  function emotionPour(fait, etat, B, ctx, now) {
    const car = etat.caractere && etat.caractere.id;
    switch (fait && fait.k) {
      case 'page': {
        const cle = `emo:page:${fait.id || ''}`; if (vu(etat, cle, now, 60 * SEC)) return null;
        return { id: car === 'curieux' ? 'interet' : 'curiosite', cle, raison: `tu viens d'ouvrir ${court(fait.texte || fait.id || 'une page', 40)}` };
      }
      case 'reussite': return { id: B.fierte >= .8 ? 'fierte' : B.fierte >= .5 ? 'joie' : 'contentement', raison: fait.texte ? `${cite(fait.texte)} vient de réussir` : 'quelque chose vient de réussir' };
      case 'appris': {
        const fort = (fait.p == null ? 1 : fait.p) >= .8 && !vu(etat, 'emo:euphorie', now, 10 * MIN);
        return { id: fort ? 'euphorie' : 'fierte', cle: fort ? 'emo:euphorie' : undefined, raison: 'je viens d\'apprendre quelque chose' };
      }
      case 'echec': {
        const n = compte(etat, 'echec', 5 * MIN, now);
        return { id: n >= 4 ? 'colere' : n === 3 ? 'frustration' : n === 2 ? 'triste' : 'deception', raison: n > 1 ? `${n} échecs en quelques minutes` : (fait.texte ? `${cite(fait.texte)} n'a pas marché` : 'quelque chose n\'a pas marché') };
      }
      case 'alerte': {
        const grave = (fait.p == null ? 1 : fait.p) >= 1, n = compte(etat, 'alerte', 10 * MIN, now, (f) => ((f.p == null ? 1 : f.p) >= 1) === grave);
        const quoi = fait.texte ? cite(fait.texte) : grave ? 'une urgence' : 'un souci';
        return grave ? { id: n >= 3 ? 'terreur' : 'peur', force: true, raison: `${quoi} vient d'arriver` } : { id: n >= 3 ? 'apprehension' : 'inquiet', raison: `${quoi} vient d'arriver` };
      }
      // Il dit ce qui est vrai : l'urgence a été vue (rien ne dit qu'elle est réparée).
      case 'alerte_reglee': return { id: 'soulagement', raison: 'tu as vu l\'urgence', puis: { id: 'calme', ms: 6 * SEC, dans: 12 * SEC + 200, raison: 'tu t\'en occupes' } };
      case 'embete': {
        const a = B.agacement, n = compte(etat, 'embete', 5 * MIN, now); if (a < .3) return null;
        return { id: a >= .8 ? 'colere' : a >= .55 ? 'frustration' : 'agacement', raison: `tu m'as secoué ${n} fois` };
      }
      case 'bloque': return { id: compte(etat, 'bloque', 10 * MIN, now) >= 2 ? 'rage' : 'colere', force: true, raison: 'j\'ai dû bloquer quelque chose de dangereux' };
      case 'merci': return { id: 'gratitude', raison: 'tu m\'as remercié' };
      case 'caresse': return etat.fondAvant === 'boudeur' ? { id: 'soulagement', raison: 'tu reviens vers moi' } : { id: 'tendresse', raison: 'tu restes près de moi' };
      case 'appel': {
        const n = etat.appels.length;
        if (n >= 5) return { id: 'agacement', raison: `tu m'as appelé ${n} fois en une minute` };
        if (n >= 3) return { id: 'malice', raison: `tu m'as appelé ${n} fois de suite` };
        if (etat.fondAvant === 'endormi') return { id: 'etonnement', ms: 3 * SEC, raison: 'tu me réveilles', puis: { id: 'lassitude', dans: 3 * SEC + 200, raison: 'je dormais' } };
        if (etat.fondAvant === 'boudeur') return { id: 'moue', ms: 3 * SEC, raison: 'je boudais, mais je viens quand même' };
        if (etat.fondAvant === 'en_manque') return { id: 'joie', raison: 'tu m\'appelles enfin' };
        return { id: 'contentement', raison: 'tu m\'as appelé' };
      }
      // Une émotion venue d'un autre écran : seulement le temps qui lui reste (p, en millisecondes). Sans durée : déjà montrée, rien à redemander.
      case 'humeur': return fait.p > 0 && EMOTIONS[fait.id] && fait.id !== 'neutre' ? { id: fait.id, ms: fait.p, raison: 'je viens de te répondre sur un autre écran' } : null;
      case 'reveil': return { id: 'etonnement', ms: 3 * SEC, raison: 'je viens de me réveiller' };
      default: return null;
    }
  }

  // ---------- Ses comportements ----------
  // Chaque comportement : quand il est possible, l'envie qu'il en a, sa durée, son repos, son plan de gestes et la raison dite.
  // `bouge` : il n'a de sens que s'il peut se déplacer ; `urgent` et `impose` : décidés hors du choix libre ;
  // `pose` : il laisse une pose à retirer ; `encore` : il peut revenir deux fois de suite (un état imposé par le fond).
  const ilEstTard = (ctx) => rythme(ctx.heure) <= .5;
  /** Une vraie joie en cours (degré 2 ou 3) : née du moteur ou d'une réponse, pas d'un simple éclat. */
  const vraieJoie = (ctx) => Boolean(ctx.emotion && ctx.emotion.famille === 'joie' && ctx.emotion.degre >= 2 && ctx.emotion.source !== 'flash');
  const peutBouger = (ctx) => !(ctx.ecrit || ctx.tenu || ctx.reduit || ctx.promenade === false || ctx.survol || ctx.epingle || ctx.visible === false);
  const COMPORTEMENTS = [
    { id: 'venir', urgent: true, duree: () => 2 * SEC, repos: () => 0,
      plan: (S) => { const g = { enjoue: 'joy', endormi: 'etire', somnolent: 'etire', boudeur: 'wobble' }[S.e.fondAvant] || 'tilt', src = S.appel && S.appel.id;
        // Appelé au clavier ou à la voix, il vient d'abord (la petite fenêtre qui s'ouvre ensuite le retient où il arrive) ; touché, il est déjà là.
        const geste = ['geste', g, g === 'etire' ? 1800 : 1100];
        return src === 'clavier' || src === 'voix' ? [['regarder', 'personne'], ['aller', 'personne'], geste] : [['regarder', 'personne'], geste]; },
      raison: () => 'Tu m\'as appelé.' },
    { id: 'veiller', urgent: true, duree: () => 6 * HEURE, repos: () => 0, fin: (S) => !(S.ctx.graves > 0),
      plan: () => [['aller', 'personne'], ['geste', 'tremble', 1700]], raison: () => 'Je reste en alerte : une urgence n\'est pas vue.' },
    { id: 'travailler', impose: true, duree: () => 1200, repos: () => 8 * SEC, plan: () => [['geste', 'advance', 1200]], raison: () => 'Je travaille sur ta demande.' },
    { id: 'observer_page', quand: (S) => { const f = dernierFait(S.e, ['page']); return Boolean(f && S.now - f.t < 15 * SEC && !vu(S.e, `obs:${f.id || ''}`, S.now, 30 * MIN)); },
      envie: () => .9, duree: () => 3 * SEC, repos: () => 0, debut: (S) => { const f = dernierFait(S.e, ['page']); S.e.vus[`obs:${(f && f.id) || ''}`] = S.now; },
      plan: () => [['regarder', 'autour']], raison: (S) => { const f = dernierFait(S.e, ['page']); return `Je découvre : tu viens d'ouvrir ${court((f && (f.texte || f.id)) || 'cette page', 40)}.`; } },
    { id: 'aller_voir', bouge: true, quand: (S) => Boolean(S.ctx.cible && !vu(S.e, `voir:${S.ctx.cible.cle}`, S.now, 5 * MIN) && S.ctx.inactifMs >= 2 * SEC),
      envie: (S) => .3 + .7 * S.B.curiosite, duree: () => 5 * SEC, repos: () => 20 * SEC, debut: (S) => { S.e.vus[`voir:${S.ctx.cible.cle}`] = S.now; },
      plan: (S) => { const c = S.ctx.cible; return [['aller', 'cible', { x: c.x, y: c.y }], ['regarder', { x: c.x - 80, y: c.y }], ['geste', c.sorte === 'reussite' ? 'joy' : c.sorte === 'echec' ? 'sad' : 'tilt', c.sorte === 'echec' ? 1400 : 1100]]; },
      raison: (S) => { const c = S.ctx.cible; return `Je vais voir : ${cite(c.texte || 'quelque chose')} ${c.sorte === 'attention' ? 'demande ton attention' : 'vient d\'apparaître'}.`; } },
    { id: 'saluer', quand: (S) => S.now - seuil(S.e, 'retour') < MIN || S.now - seuil(S.e, 'jourNeuf') < MIN,
      envie: () => 1, duree: () => 2500, repos: () => 30 * MIN, plan: () => [['regarder', 'personne'], ['geste', 'signe', 1200]],
      raison: (S) => (S.now - seuil(S.e, 'retour') < MIN ? `Te revoilà après ${dureeDite(S.e.absence)}.` : 'Bonjour : c\'est la première fois que je te vois aujourd\'hui.') },
    { id: 's_etirer', quand: (S) => { const f = dernierFait(S.e, ['reveil']); return Boolean(f && S.now - f.t < 10 * SEC) || S.now - seuil(S.e, 'leve') < 30 * SEC; },
      envie: (S) => { const f = dernierFait(S.e, ['reveil']); return f && S.now - f.t < 10 * SEC ? 1.2 : .8; }, duree: () => 1800, repos: () => 10 * MIN, plan: () => [['geste', 'etire', 1800]],
      raison: (S) => { const f = dernierFait(S.e, ['reveil']); return f && S.now - f.t < 30 * SEC ? 'Je m\'étire : je viens de me réveiller.' : 'Je m\'étire : je suis resté assis un bon moment.'; } },
    { id: 'bailler', quand: (S) => S.B.fatigue >= .65 && S.ctx.present, envie: (S) => S.B.fatigue, duree: () => 2400,
      repos: (S) => (360 - 270 * borne((S.B.fatigue - .65) / .35)) * SEC, plan: () => [['geste', 'baille', 2400]],
      emotion: (S) => (S.now - seuil(S.e, 'lassitude') >= 5 * MIN && S.now >= seuil(S.e, 'emoFin') ? { id: S.B.fatigue >= .85 ? 'fatigue' : 'lassitude', marque: 'lassitude', raison: ilEstTard(S.ctx) ? `il est ${heureDite(S.ctx.heure)}` : `je suis debout depuis ${dureeDite(S.now - S.e.eveilDepuis)}` } : null),
      raison: (S) => (ilEstTard(S.ctx) ? `Je bâille : il est ${heureDite(S.ctx.heure)}.` : `Je bâille : je suis debout depuis ${dureeDite(S.now - S.e.eveilDepuis)}.`) },
    { id: 'somnoler', encore: true, pose: 'dort', quand: (S) => S.e.fond.id === 'endormi', envie: () => 1, duree: () => 6 * HEURE, repos: () => 0, fin: (S) => S.e.fond.id !== 'endormi',
      plan: () => [['aller', 'coin'], ['pose', 'dort']],
      raison: (S) => (S.ctx.sommeil ? 'Je somnole : c\'est le mode sommeil.' : `Je somnole : il est ${heureDite(S.ctx.heure)} et rien ne bouge depuis ${dureeDite(S.now - S.e.dernierePresence)}.`) },
    { id: 'se_reposer', pose: 'assis', quand: (S) => S.now - S.e.dernierePresence >= 10 * MIN && S.B.fatigue < .8, envie: () => .7, duree: () => 6 * HEURE, repos: () => 0, fin: (S) => S.ctx.present,
      plan: () => [['aller', 'coin'], ['pose', 'assis']], raison: (S) => `Je me repose : personne depuis ${dureeDite(S.now - S.e.dernierePresence)}.` },
    { id: 'regarder_travailler', pose: 'assis', quand: (S) => S.ctx.ecrit && S.now - seuil(S.e, 'ecritDepuis') >= 20 * SEC, envie: (S) => .5 + .3 * S.B.compagnie,
      duree: (S) => (20 + 40 * S.B.compagnie) * SEC, repos: () => 120 * SEC, fin: (S) => S.now - seuil(S.e, 'ecritVu') > 15 * SEC,
      plan: () => [['pose', 'assis'], ['regarder', 'personne']], raison: (S) => `Je te regarde travailler : tu écris depuis ${dureeDite(S.now - seuil(S.e, 'ecritDepuis'))}.` },
    { id: 'se_rapprocher', bouge: true,
      quand: (S) => S.B.compagnie >= .7 && S.ctx.present && S.ctx.inactifMs >= 5 * SEC && S.ctx.inactifMs <= 60 * SEC && !S.ctx.ecrit && S.now >= seuil(S.e, 'rapprocheArret') && S.now >= seuil(S.e, 'manqueArret') && (S.e.rapprocher.fois || []).filter((t) => S.now - t < HEURE).length < 3,
      envie: (S) => S.B.compagnie, duree: () => 64 * SEC, repos: () => 10 * MIN, fin: (S, c) => depuisFait(S.e, ['appel', 'echange', 'caresse', 'merci', 'survol'], c.depuis),
      debut: (S) => { const r = S.e.rapprocher; r.fois = (r.fois || []).filter((t) => S.now - t < HEURE).concat(S.now); r.n = r.fois.length; r.depuis = r.fois[0]; },
      plan: () => [['aller', 'personne'], ['regarder', 'personne'], ['geste', 'signe', 1200]],
      raison: (S) => `Je me rapproche : on ne s'est pas parlé depuis ${dureeDite(S.now - Math.max(quand(S.e, 'f:echange'), quand(S.e, 'f:appel'), S.e.eveilDepuis))}.` },
    // Il sautille une fois par bonne nouvelle (une réussite, un merci, une joie qui commence), pas tant que sa fierté dure.
    // Une joie compte si elle vient du moteur ou d'une réponse, pas d'un simple éclat (une case cochée).
    { id: 'sautiller', quand: (S) => { const f = dernierFait(S.e, ['reussite', 'appris', 'merci']);
      return (S.B.fierte >= .5 && Boolean(f && f.t > quand(S.e, 'sautiller'))) || (vraieJoie(S.ctx) && S.now - quand(S.e, 'sautiller') >= 2 * MIN); },
      envie: (S) => Math.max(S.B.fierte, vraieJoie(S.ctx) ? .6 : 0), duree: () => 2200, repos: () => 30 * SEC,
      plan: () => [['geste', 'joy', 1100], ['geste', 'joy', 1100]],
      raison: (S) => { const f = dernierFait(S.e, ['reussite', 'appris', 'merci']); if (!f || S.now - f.t > 5 * MIN) return 'Je sautille : je suis joyeux.'; return f.k === 'merci' ? 'Je sautille : tu m\'as remercié.' : f.k === 'appris' ? 'Je sautille : je viens d\'apprendre quelque chose.' : f.texte ? `Je sautille : ${cite(f.texte)} vient de réussir.` : 'Je sautille : quelque chose vient de réussir.'; } },
    { id: 'pirouette', quand: (S) => Boolean(S.ctx.emotion && S.ctx.emotion.id === 'euphorie') || S.now - seuil(S.e, 'fetePresence') < MIN, envie: () => .9, duree: () => 1 * SEC, repos: () => 120 * SEC,
      plan: () => [['geste', 'spin', 950]], raison: (S) => (S.now - seuil(S.e, 'fetePresence') < MIN && S.ctx.fete ? `C'est ${feteDite(S.ctx.fete.nom)} !` : 'Je tourne sur moi-même : je suis fou de joie.') },
    { id: 'soupirer', quand: (S) => S.B.ennui >= .6 && S.ctx.present, envie: (S) => S.B.ennui - .1, duree: () => 1600, repos: () => 180 * SEC,
      plan: () => [['regarder', 'ailleurs'], ['geste', 'soupir', 1600]], raison: (S) => `Je m'ennuie un peu : rien de neuf depuis ${dureeDite(S.now - nouveaute(S.e))}.` },
    // Plus il reste à la même place (au-delà d'une minute), plus il a envie d'aller voir ailleurs : un caractère joueur bouge avant 2 minutes, un posé vers 5.
    { id: 'promenade', bouge: true, quand: (S) => S.ctx.inactifMs >= 8 * SEC && S.ctx.promenade !== false,
      envie: (S) => .25 + .5 * S.B.ennui + .2 * (S.B.energie - .5) + .5 * borne((S.now - surPlace(S.e) - MIN) / (4 * MIN)), duree: () => 6 * SEC, repos: () => 45 * SEC,
      plan: () => [['aller', 'libre_neuf']], raison: (S) => `Je me dégourdis : je n'ai pas bougé depuis ${dureeDite(S.now - surPlace(S.e))}.` },
    // Ses petits gestes d'attention, entre deux envies plus fortes : chacun a sa raison, aucun n'est tiré au sort.
    { id: 'regarder_personne', quand: (S) => S.ctx.present && !S.ctx.ecrit && S.ctx.inactifMs < 4 * SEC && S.now - seuil(S.e, 'silence') < 8 * SEC,
      envie: () => .8, duree: () => 1500, repos: () => 60 * SEC, plan: () => [['regarder', 'personne'], ['geste', 'tilt', 900]],
      raison: (S) => `Je te regarde : tu bouges de nouveau après ${dureeDite(S.e.silence || 0)} sans un geste.` },
    { id: 'suivre_regard', quand: (S) => S.ctx.present && !S.ctx.ecrit && !S.ctx.tactile && S.ctx.inactifMs >= 3 * SEC && S.ctx.inactifMs < 20 * SEC,
      envie: () => .5, duree: () => 1200, repos: () => 90 * SEC, plan: () => [['regarder', 'personne']],
      raison: () => 'Je regarde ce que tu regardes : ta souris s\'est arrêtée.' },
    { id: 'regarder_autour', quand: (S) => S.ctx.present && !S.ctx.ecrit && S.now - calmeDepuis(S.e) >= 30 * SEC, envie: () => .5, duree: () => 1800, repos: (S) => (40 + 20 * S.B.fatigue) * SEC,
      plan: () => [['regarder', 'autour']], raison: (S) => `Je regarde autour de moi : tout est calme depuis ${dureeDite(S.now - calmeDepuis(S.e))}.` },
    { id: 'jouer', quand: (S) => S.B.ennui >= .5 && S.B.energie >= .6 && !S.ctx.ecrit, envie: (S) => .2 + .5 * S.B.ennui + .2 * S.B.energie, duree: () => 2 * SEC, repos: () => 240 * SEC,
      plan: () => [['geste', 'roule', 2000], ['regarder', 'autour']], raison: (S) => `Je joue : j'ai de l'énergie et rien de neuf depuis ${dureeDite(S.now - nouveaute(S.e))}.` },
    { id: 'ronde', bouge: true, quand: (S) => S.B.inquietude >= .45 && !(S.ctx.graves > 0), envie: (S) => S.B.inquietude, duree: () => 6 * SEC, repos: () => 180 * SEC,
      plan: () => [['aller', 'attention'], ['regarder', 'autour']], raison: () => 'Je surveille : un souci n\'est pas réglé.' },
    { id: 'bouder', encore: true, pose: 'boude', quand: (S) => S.e.fond.id === 'boudeur', envie: () => 1, duree: () => 90 * SEC, repos: () => 300 * SEC, fin: (S) => S.e.fond.id !== 'boudeur',
      plan: () => [['aller', 'loin_personne'], ['pose', 'boude']],
      raison: (S) => { const n = compte(S.e, 'embete', 5 * MIN, S.now); return n ? `Je boude un instant : tu m'as secoué ${n} fois.` : 'Je boude un instant : ça ne marche pas comme je veux.'; } },
    { id: 'souffler', quand: (S) => { const f = dernierFait(S.e, ['alerte_reglee']); return Boolean(f && S.now - f.t < 30 * SEC && quand(S.e, 'souffler') < f.t); }, envie: () => 1, duree: () => 1600, repos: () => 0,
      plan: () => [['geste', 'soupir', 1600]], raison: () => 'Ouf : tu as vu l\'urgence.' },
    { id: 'repos', impose: true, envie: () => .2, duree: () => 0, repos: () => 0, plan: () => [], raison: () => 'Je suis tranquille.' },
  ];
  const PAR_ID = Object.fromEntries(COMPORTEMENTS.map((c, rang) => [c.id, Object.assign(c, { rang })]));
  CONST.COMPORTEMENTS = COMPORTEMENTS.map((c) => c.id);
  /** Quand il s'est passé quelque chose de neuf pour la dernière fois. */
  function nouveaute(etat) { return Math.max(quand(etat, 'f:page'), quand(etat, 'f:nouveau'), quand(etat, 'f:echange'), quand(etat, 'f:appel'), quand(etat, 'f:alerte'), quand(etat, 'f:reussite'), quand(etat, 'f:echec'), etat.eveilDepuis); }
  /** Depuis quand tout est calme sur cet écran (rien de neuf, et au plus tôt son ouverture). */
  function calmeDepuis(etat) { return Math.max(nouveaute(etat), seuil(etat, 'ouvert')); }
  /** Ce qui se répète sans que rien de neuf n'arrive s'espace (le repos double à chaque fois, jusqu'à 16 fois ; 4 fois pour un bâillement) : il ne soupire pas toutes les 3 minutes pendant des heures. */
  const USURE = new Map([['soupirer', 4], ['jouer', 4], ['ronde', 4], ['promenade', 4], ['ennui', 4], ['bailler', 2], ['regarder_autour', 3], ['suivre_regard', 3]]);
  /** Ses petits gestes d'attention gardent leur cadence les premières fois (2 fois), puis s'espacent comme le reste. */
  const USURE_LIBRE = { regarder_autour: 2, suivre_regard: 2 };
  const usure = (etat, id) => (USURE.has(id) ? 2 ** Math.min(USURE.get(id), Math.max(0, ((etat.usure && etat.usure[id]) || 0) - (USURE_LIBRE[id] || 0))) : 1);
  /** Ce que la disposition de fond change à ses envies ; 0 = pas maintenant. */
  function coefFond(fond, id, ctx) {
    if (fond === 'endormi') return id === 'somnoler' ? 1 : 0;
    if (fond === 'boudeur') return id === 'bouder' ? 1 : 0;
    if (fond === 'attentif' || fond === 'alerte') return 0;
    let k = 1;
    if (fond === 'somnolent') k = id === 'promenade' ? .3 : id === 'jouer' ? 0 : 1;
    else if (fond === 'soucieux') k = id === 'jouer' ? 0 : id === 'sautiller' ? .5 : id === 'ronde' ? 1.3 : 1;
    else if (fond === 'las') k = id === 'promenade' ? 1.3 : id === 'jouer' ? 1.2 : 1;
    else if (fond === 'en_manque') k = id === 'se_rapprocher' ? 1.3 : 1;
    // Une émotion pénible et forte : il n'a pas le cœur à jouer.
    const e = ctx.emotion; if (e && e.valence < 0 && e.degre >= 2 && (id === 'jouer' || id === 'sautiller' || id === 'pirouette')) k = 0;
    return k;
  }
  /** La pause entre deux comportements : plus longue s'il est fatigué, si tu écris, sur téléphone ; plus courte s'il est d'humeur joueuse. Jamais moins de 8 secondes. */
  function pause(etat, B, ctx) {
    const k = (ctx.ecrit ? 1.5 : 1) * (ctx.tactile ? 1.5 : 1) * (effets(etat).pause || 1);
    return Math.max(CONST.pauseMini, (8 * SEC + 20 * SEC * B.fatigue) * k);
  }
  /** Retire d'un plan ce que la situation interdit : aucun déplacement si tu écris, si tu le tiens, si la promenade est coupée ; ni déplacement ni geste en mouvement réduit. */
  function planPermis(plan, ctx) {
    const sansAller = !peutBouger(ctx);
    return plan.filter((p) => !(p[0] === 'aller' && sansAller) && !(p[0] === 'geste' && ctx.reduit));
  }
  /**
   * Choisit ce qu'il a le plus envie de faire maintenant, ou rien (il reste tranquille). Score = envie × caractère ×
   * disposition × fraîcheur ; interdits : repos pas écoulé, le même que son choix précédent (« tranquille » compte
   * pour un choix), condition fausse. Il faut 0,45 au moins. À score égal : le moins récemment fait, puis l'ordre du tableau.
   */
  function choisir(etat, B, ctx, now) {
    const S = { e: etat, B, ctx, now }, car = effets(etat), envies = car.envies || {}, prec = etat.histo[etat.histo.length - 1];
    const allers = etat.marche.filter((t) => now - t < 10 * MIN), budget = allers.length < CONST.allersParDixMin && (!allers.length || now - allers[allers.length - 1] >= CONST.entreAllers);
    // (Aucun chemin libre trouvé tout à l'heure : il n'essaie plus de se déplacer pendant un moment.)
    const mobile = peutBouger(ctx) && budget && now >= seuil(etat, 'sansChemin');
    let best = null;
    for (const c of COMPORTEMENTS) {
      if (c.urgent || c.impose) continue;
      const kf = coefFond(etat.fond.id, c.id, ctx); if (!kf) continue;
      if (c.id === prec && !c.encore) continue;
      if (c.bouge && !mobile) continue;
      const fait = quand(etat, c.id), repos = c.repos(S) * usure(etat, c.id);
      if (now - fait < repos) continue;
      if (!c.quand(S)) continue;
      const fraicheur = repos > 0 ? 1 - .5 * Math.exp(-(now - fait) / (3 * repos)) : 1;
      const score = c.envie(S) * (envies[c.id] || 1) * kf * fraicheur;
      if (score < CONST.scoreMini) continue;
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && fait < best.fait)) best = { id: c.id, score, fait };
    }
    return best ? { id: best.id, score: best.score } : null;
  }

  // ---------- Un battement ----------
  const CTX = { heure: 12, jour: '', vue: '', present: true, inactifMs: 0, ecrit: false, survol: false, tenu: false, occupe: false, fenetre: false, promenade: true, reduit: false, tactile: false,
    graves: 0, nonLues: 0, sommeil: false, fete: null, emotion: null, cible: null, visible: true, epingle: false };
  const copie = (o) => JSON.parse(JSON.stringify(o));
  /**
   * Avance d'un battement : range les faits nouveaux, met à jour présence, besoins, disposition, émotions et
   * comportement. Rend le nouvel état (l'ancien n'est pas touché) et les sorties : { type: 'fond' | 'emotion' |
   * 'comportement', id, raison… }. C'est le seul appel que fait le branchement.
   */
  function avancer(etat0, entree, now) {
    const e = copie(etat0), ctx = Object.assign({}, CTX, (entree && entree.ctx) || {}), sorties = [], avantT = e.t;
    const S = { e, ctx, now, B: null, appel: null };
    const emettre = (em, marque) => {
      if (!em || !EMOTIONS[em.id]) return;
      const s = { type: 'emotion', id: em.id, raison: court(em.raison || '', 100) };
      if (fini(em.ms) && em.ms > 0) s.ms = Math.round(em.ms);
      if (em.force) s.force = true;
      sorties.push(s);
      if (em.cle) e.vus[em.cle] = now;
      if (em.puis) e.apres.push({ t: now + em.puis.dans, id: em.puis.id, ms: em.puis.ms || 0, raison: em.puis.raison || '' });
      if (marque) e.seuils[marque] = now;
      // Tant qu'une émotion se montre (et 10 secondes après), celles qui viennent d'un simple seuil (ennui, solitude) attendent.
      e.seuils.emoFin = Math.max(seuil(e, 'emoFin'), now + (s.ms || [0, 15, 30, 60][EMOTIONS[em.id].degre] * SEC) + 10 * SEC);
    };

    // 1. Un nouveau jour (ou la fête du jour enfin connue) : un nouveau caractère.
    const jour = ctx.jour || e.jour || '', feteId = (ctx.fete && ctx.fete.id) || '';
    if (!e.caractere || jour !== e.jour || feteId !== e.feteId) { e.jour = jour; e.feteId = feteId; e.caractere = caractereDuJour({ jour, fete: ctx.fete }); }

    // 2. Les faits : les nouveaux rejoignent les anciens ; on fond les répétitions, on oublie ce qui a plus de 6 heures.
    const neufs = [];
    for (const f of (entree && entree.faits) || []) {
      if (!f || !SORTES.includes(f.k)) continue;
      const g = { t: fini(f.t) ? Math.min(f.t, now) : now, k: f.k };
      if (fini(f.p)) g.p = f.p; if (typeof f.id === 'string' && f.id) g.id = f.id.slice(0, 40); if (typeof f.texte === 'string' && f.texte) g.texte = court(f.texte, 60);
      if (fini(f.x) && fini(f.y)) { g.x = Math.round(f.x); g.y = Math.round(f.y); }
      neufs.push(g);
    }
    neufs.sort((a, b) => a.t - b.t);
    // Un fait frais (moins de 10 secondes) le fait réagir ; plus vieux (noté pendant que l'onglet était caché, une pause,
    // une visite guidée), il est rangé dans sa mémoire sans émotion ni geste : il ne rejoue pas le passé d'un coup.
    const frais = (g) => now - g.t <= CONST.frais, muets = new Set();
    const ranger = (g) => {
      const d = e.faits[e.faits.length - 1];
      // On fond en un seul : ce qui se répète coup sur coup (même sorte, même objet), une nouveauté qui en suit une autre,
      // et un message de la page (réussite, échec) réécrit au même endroit.
      const message = (g.k === 'reussite' || g.k === 'echec') && Boolean(g.id);
      const fondu = Boolean(d) && d.k === g.k && g.t - d.t < 1500 && (g.k === 'nouveau' || ((FUSION.has(g.k) || message) && (d.id || '') === (g.id || '')));
      if (fondu) { e.faits[e.faits.length - 1] = Object.assign({}, d, g); if (message) muets.add(g); }
      else e.faits.push(g);
      e.dernier[`f:${g.k}`] = Math.max(quand(e, `f:${g.k}`), g.t);
    };
    for (const g of neufs) {
      ranger(g);
      if (g.k === 'appel') { e.appels.push(g.t); if (frais(g)) S.appel = g; }
      if (g.k === 'appel' || g.k === 'echange') { e.rapprocher.rates = 0; delete e.seuils.rapprocheArret; }
      if (g.k === 'appel' || g.k === 'echange' || g.k === 'merci' || g.k === 'caresse') delete e.seuils.manqueArret;
      if (NEUF.has(g.k)) e.usure = {}; // du nouveau : il retrouve toute son envie
    }
    e.appels = e.appels.filter((t) => now - t < MIN);

    // 3. Présence et réveil : après un long trou (4 heures, ou 1 h 30 si la nuit est passée par là), il se réveille.
    if (ctx.present) {
      const trou = now - e.dernierePresence, debut = ctx.heure - trou / HEURE;
      if (trou >= CONST.reveilTrou || (trou >= CONST.reveilNuit && (debut < 6 || ctx.heure < 6))) { e.eveilDepuis = now; const g = { t: now, k: 'reveil' }; ranger(g); neufs.push(g); }
      if (trou >= CONST.retour) { e.absence = trou; e.seuils.retour = now; ranger({ t: now, k: 'retour' }); }
      if (e.jourSalue !== e.jour) { e.jourSalue = e.jour; e.seuils.jourNeuf = now; if (ctx.fete) e.seuils.fetePresence = now; }
      e.dernierePresence = now;
      // Tu ne bouges plus depuis 30 secondes : il le retient, pour te regarder quand tu reviens.
      if (ctx.inactifMs >= 30 * SEC) { e.seuils.silence = now; e.silence = ctx.inactifMs; }
    }
    // Sa mémoire : 6 heures, 60 faits qui pèsent et 30 faits légers au plus (une zone de la page qui change sans arrêt ne l'efface pas).
    e.faits = e.faits.filter((f) => now - f.t < CONST.faitsAge);
    for (const [leger, max] of [[true, CONST.faitsLegers], [false, CONST.faitsMax]]) {
      const lot = e.faits.filter((f) => LEGERS.has(f.k) === leger);
      if (lot.length > max) { const jeter = new Set(lot.slice(0, lot.length - max)); e.faits = e.faits.filter((f) => !jeter.has(f)); }
    }
    e.marche = e.marche.filter((t) => now - t < 10 * MIN);
    for (const k of Object.keys(e.vus)) if (now - e.vus[k] > CONST.faitsAge) delete e.vus[k];
    // Tu écris : depuis quand (une courte pause dans la frappe ne remet pas le compte à zéro).
    if (ctx.ecrit) { if (now - seuil(e, 'ecritVu') > 15 * SEC || !fini(e.seuils.ecritDepuis)) e.seuils.ecritDepuis = now; e.seuils.ecritVu = now; }

    // 4. Ses besoins.
    const B = S.B = besoins(e, ctx, now);

    // 5. Sa disposition de fond.
    e.fondAvant = e.fond.id;
    if (ctx.fenetre || ctx.occupe || now - quand(e, 'f:appel') < 8 * SEC) e.seuils.attentifFin = now;
    if (e.fond.id === 'en_manque' && now - e.fond.depuis >= 20 * MIN && now >= seuil(e, 'manqueArret')) e.seuils.manqueArret = now + 6 * HEURE;
    const f = fondSuivant(e, B, ctx, now);
    if (f) {
      if (e.fond.id === 'boudeur') e.seuils.boudeInterdit = now + 5 * MIN;
      if (e.fond.id === 'endormi') e.seuils.reveille = now;
      e.fond = { id: f.id, depuis: now };
      if (!f.force) e.seuils.fondLibre = now;
      sorties.push({ type: 'fond', id: f.id, raison: f.raison });
    } else if (e.fond.neuf) delete e.fond.neuf;

    // 6. Ses émotions : celles qui attendaient leur tour, celles des faits nouveaux, puis celles des seuils.
    const pretes = e.apres.filter((a) => a.t <= now); e.apres = e.apres.filter((a) => a.t > now);
    for (const a of pretes) if (now - a.t < 10 * SEC) emettre({ id: a.id, ms: a.ms, raison: a.raison });
    // Une rafale de faits de la même sorte dans le même battement : une seule émotion, celle du dernier (pas quarante demandes au visage).
    const aDire = new Map();
    for (const g of neufs) if (frais(g) && !muets.has(g)) aDire.set(g.k === 'humeur' ? `humeur:${g.id || ''}` : g.k, g);
    for (const g of aDire.values()) {
      // Une émotion venue d'un autre écran : le temps passé depuis est retranché de ce qui lui restait.
      emettre(emotionPour(g.k === 'humeur' && fini(g.p) ? Object.assign({}, g, { p: g.p - (now - g.t) }) : g, e, B, ctx, now));
    }
    if (fini(e.seuils.retour) && e.seuils.retour === now) emettre({ id: 'joie', raison: `te revoilà après ${dureeDite(e.absence)}` }, 'retourEmo');
    if (fini(e.seuils.fetePresence) && e.seuils.fetePresence === now) emettre({ id: 'rire', raison: `c'est ${feteDite(ctx.fete && ctx.fete.nom)}` }, 'feteEmo');
    const calme = now >= seuil(e, 'emoFin') && e.fond.id !== 'attentif' && e.fond.id !== 'alerte' && e.fond.id !== 'endormi';
    if (calme && ctx.present && B.ennui >= .6 && now - seuil(e, 'ennui') >= 3 * MIN * usure(e, 'ennui')) { emettre({ id: 'ennui', raison: `rien de neuf depuis ${dureeDite(now - nouveaute(e))}` }, 'ennui'); e.usure.ennui = (e.usure.ennui || 0) + 1; }
    // (Sa solitude, il la montre une fois, pas toutes les heures.)
    else if (calme && ctx.present && e.rapprocher.rates >= 2 && B.compagnie >= .7 && now - seuil(e, 'rate') >= 10 * MIN && now - seuil(e, 'solitude') >= 6 * HEURE) emettre({ id: 'solitude', raison: `tu es là, mais on ne s'est pas parlé depuis ${dureeDite(now - Math.max(quand(e, 'f:echange'), quand(e, 'f:appel'), e.eveilDepuis))}` }, 'solitude');

    // 7. Son comportement : l'urgent d'abord, sinon celui en cours, sinon un nouveau choix quand la pause est passée.
    const terminer = (coupe) => {
      const c = e.comportement, def = PAR_ID[c.id]; if (!def) { e.comportement = null; return; }
      e.dernier[c.id] = now; e.passe = { id: c.id, fin: now, cause: c.cause };
      // Une pose finie : il se remet droit (dit avant ce qu'il fera ensuite, pour que la pose ne reste pas).
      if (def.pose) { e.pose = null; if (now - c.depuis >= 3 * MIN) e.seuils.leve = now; sorties.push({ type: 'comportement', id: 'repos', plan: [['pose', null]], raison: 'Je suis tranquille.', duree: 0 }); }
      if (c.id === 'se_rapprocher') {
        if (depuisFait(e, ['appel', 'echange', 'caresse', 'merci', 'survol'], c.depuis)) e.rapprocher.rates = 0;
        else if (!coupe) {
          e.rapprocher.rates += 1; e.seuils.rate = now;
          if (e.rapprocher.rates >= 2 && e.rapprocher.rates % 2 === 0) {
            e.seuils.rapprocheArret = now + Math.min(4 * HEURE, 30 * MIN * 2 ** (e.rapprocher.rates / 2 - 1));
            // Sa déception, il la dit une fois (pas à chaque nouvelle tentative de la journée).
            if (now - seuil(e, 'deceptionDite') >= 6 * HEURE) { const quandDire = Math.max(now, seuil(e, 'emoFin')); e.apres.push({ t: quandDire, id: 'deception', ms: 0, raison: 'je suis venu vers toi deux fois, sans réponse' }); e.seuils.emoFin = quandDire + 35 * SEC; e.seuils.deceptionDite = now; }
          }
        }
      }
      // Il se lève (fin d'un repos ou d'un somme) : pas de pause, il peut s'étirer ou saluer tout de suite.
      e.prochain = (c.id === 'somnoler' || c.id === 'se_reposer') && !coupe ? now : now + pause(e, B, ctx);
      e.comportement = null;
    };
    const demarrer = (id) => {
      const def = PAR_ID[id], plan = planPermis(def.plan(S), ctx), raison = phrase(def.raison(S)), duree = Math.round(def.duree(S));
      if (def.debut) def.debut(S);
      e.comportement = { id, depuis: now, jusqu: now + duree, cause: raison };
      e.dernier[id] = now; e.histo.push(id); if (e.histo.length > 12) e.histo = e.histo.slice(-12);
      if (USURE.has(id)) e.usure[id] = (e.usure[id] || 0) + 1;
      // (`bougeAvant` : pour revenir en arrière si la mascotte ne trouve aucun chemin, voir marcheRatee.)
      if (plan.some((p) => p[0] === 'aller')) { e.comportement.bougeAvant = fini(e.dernier.bouge) ? e.dernier.bouge : null; e.marche.push(now); e.dernier.bouge = now; }
      e.pose = def.pose ? { id: def.pose, depuis: now } : null;
      const s = { type: 'comportement', id, plan, raison, duree }; if (def.urgent) s.urgent = true;
      sorties.push(s);
      if (def.emotion) { const em = def.emotion(S); if (em) emettre(em, em.marque); }
    };
    if (e.comportement) { const c = e.comportement, def = PAR_ID[c.id]; if (!def || now >= c.jusqu || (def.fin && def.fin(S, c))) terminer(false); }
    if (S.appel && !ctx.tenu) { if (e.comportement) terminer(true); demarrer('venir'); }
    else if (ctx.graves > 0 && !(e.comportement && (e.comportement.id === 'veiller' || e.comportement.id === 'venir'))) { if (e.comportement) terminer(true); demarrer('veiller'); }
    else if (!e.comportement && ctx.occupe) { if (now - quand(e, 'travailler') >= 8 * SEC) { demarrer('travailler'); e.comportement = null; } }
    else if (!e.comportement && now >= e.prochain) {
      const ch = choisir(e, B, ctx, now);
      if (ch) demarrer(ch.id);
      else if (e.histo[e.histo.length - 1] !== 'repos') { e.histo.push('repos'); if (e.histo.length > 12) e.histo = e.histo.slice(-12); } // rien ne lui fait assez envie : il reste tranquille
    }

    e.t = now;
    if (avantT > now) e.prochain = Math.min(e.prochain, now + 4 * SEC); // l'horloge a reculé : on ne reste pas bloqué
    return { etat: e, sorties };
  }

  /**
   * La mascotte n'a trouvé aucun chemin libre pour le déplacement qu'il venait de décider : il n'a pas bougé. On revient
   * en arrière (ce n'était pas une marche, il ne dit pas qu'il se dégourdit), et il n'essaie plus de se déplacer pendant
   * 2 minutes ; une promenade qui n'a pas eu lieu est effacée, il choisit autre chose 2 secondes plus tard.
   */
  function marcheRatee(etat0, now, id) {
    const e = copie(etat0), c = e.comportement;
    e.seuils.sansChemin = now + 2 * MIN;
    if (!c || c.bougeAvant === undefined || (id && c.id !== id)) return e;
    e.marche.pop();
    if (fini(c.bougeAvant)) e.dernier.bouge = c.bougeAvant; else delete e.dernier.bouge;
    delete c.bougeAvant;
    if (c.id === 'promenade') { e.comportement = null; e.passe = null; e.prochain = now + 2 * SEC; }
    return e;
  }

  // ---------- Garder et retrouver ----------
  const neufEtat = (now) => ({ v: 1, t: now, jour: '', feteId: '', caractere: null, faits: [], fond: { id: 'eveille', depuis: now, neuf: true }, fondAvant: 'eveille', comportement: null, passe: null,
    dernier: {}, histo: [], vus: {}, usure: {}, rapprocher: { n: 0, depuis: now, rates: 0, fois: [] }, prochain: now + 4 * SEC, marche: [], seuils: {}, eveilDepuis: now, dernierePresence: now, appels: [], apres: [],
    absence: 0, jourSalue: '', pose: null });
  /**
   * Ce qu'on garde d'un état, en petit (2000 caractères au plus) : caractère, disposition, délais, ce qu'il a vu, ses
   * 20 derniers faits, depuis quand il est éveillé. Les instants sont notés en secondes par rapport au moment gardé.
   * Sa place et le comportement en cours ne sont pas gardés.
   */
  function resumer(etat) {
    const T = etat.t, rel = (x) => Math.round((x - T) / SEC);
    const o = { v: 1, t: T, jour: etat.jour, fete: etat.feteId || '', caractere: etat.caractere, fond: [etat.fond.id, rel(etat.fond.depuis)], salue: etat.jourSalue || '',
      eveilDepuis: rel(etat.eveilDepuis), dernierePresence: rel(etat.dernierePresence), absence: Math.round((etat.absence || 0) / SEC), rapprocher: [etat.rapprocher.n, rel(etat.rapprocher.depuis), etat.rapprocher.rates],
      histo: etat.histo.slice(-12), usure: etat.usure || {}, dernier: {}, seuils: {}, vus: {}, faits: [] };
    const recents = (obj, age, n) => Object.entries(obj).filter(([, v]) => fini(v) && Math.abs(T - v) < age).sort((a, b) => b[1] - a[1]).slice(0, n);
    for (const [k, v] of recents(etat.dernier, 3 * HEURE, 40)) o.dernier[k] = rel(v);
    for (const [k, v] of recents(etat.seuils, 6 * HEURE, 24)) o.seuils[k] = rel(v);
    for (const [k, v] of recents(etat.vus, 3 * HEURE, 8)) o.vus[k.slice(0, 28)] = rel(v);
    o.faits = etat.faits.slice(-20).map((f) => (fini(f.p) ? [rel(f.t), f.k, Math.round(f.p * 100) / 100] : [rel(f.t), f.k]));
    // Trop gros : on lâche d'abord les faits les plus vieux, puis ce qu'il a vu, puis les plus vieux délais.
    const trop = () => JSON.stringify(o).length > 1900;
    while (trop() && o.faits.length > 4) o.faits.shift();
    while (trop() && Object.keys(o.vus).length) delete o.vus[Object.keys(o.vus).pop()];
    while (trop() && Object.keys(o.dernier).length > 6) delete o.dernier[Object.keys(o.dernier).pop()];
    return o;
  }
  /**
   * Un état tout neuf, ou celui qu'on avait gardé (relu avec méfiance : seul ce qui a la bonne forme est repris).
   * Gardé il y a plus de 30 minutes : la disposition est recalculée. Le caractère, lui, est refait par le premier
   * battement si le jour a changé.
   */
  function nouvelEtat(sauve, now) {
    const e = neufEtat(now), s = sauve;
    if (!s || typeof s !== 'object' || s.v !== 1 || !fini(s.t) || s.t > now + MIN) return e;
    const T = s.t, abs = (r) => T + r * SEC, age = now - T, nombre = (v, d) => (fini(v) ? v : d);
    if (typeof s.jour === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.jour)) e.jour = s.jour;
    if (typeof s.fete === 'string') e.feteId = s.fete.slice(0, 24);
    if (s.caractere && CARACTERES[s.caractere.id]) e.caractere = { id: s.caractere.id, nom: CARACTERES[s.caractere.id].nom, causes: (Array.isArray(s.caractere.causes) ? s.caractere.causes : []).filter((c) => typeof c === 'string').slice(0, 4) };
    if (typeof s.salue === 'string') e.jourSalue = s.salue.slice(0, 10);
    e.eveilDepuis = Math.min(now, abs(nombre(s.eveilDepuis, 0))); e.dernierePresence = Math.min(now, abs(nombre(s.dernierePresence, 0))); e.absence = Math.max(0, nombre(s.absence, 0)) * SEC;
    if (Array.isArray(s.rapprocher)) {
      const n = Math.max(0, Math.min(3, Math.round(nombre(s.rapprocher[0], 0)))), depuis = Math.min(now, abs(nombre(s.rapprocher[1], 0)));
      e.rapprocher = { n, depuis, rates: Math.max(0, Math.min(20, Math.round(nombre(s.rapprocher[2], 0)))), fois: Array.from({ length: n }, () => depuis) };
    }
    if (Array.isArray(s.histo)) e.histo = s.histo.filter((x) => typeof x === 'string' && PAR_ID[x]).slice(-12);
    for (const [k, v] of Object.entries(s.usure && typeof s.usure === 'object' ? s.usure : {})) if (USURE.has(k) && fini(v)) e.usure[k] = Math.max(0, Math.min(8, Math.round(v)));
    for (const [k, v] of Object.entries(s.dernier && typeof s.dernier === 'object' ? s.dernier : {})) if (fini(v) && k.length < 40) e.dernier[k] = Math.min(now, abs(v));
    for (const [k, v] of Object.entries(s.seuils && typeof s.seuils === 'object' ? s.seuils : {})) if (fini(v) && k.length < 24) e.seuils[k] = abs(v);
    for (const [k, v] of Object.entries(s.vus && typeof s.vus === 'object' ? s.vus : {})) if (fini(v) && k.length < 40) e.vus[k] = Math.min(now, abs(v));
    for (const f of Array.isArray(s.faits) ? s.faits : []) if (Array.isArray(f) && fini(f[0]) && SORTES.includes(f[1])) { const g = { t: Math.min(now, abs(f[0])), k: f[1] }; if (fini(f[2])) g.p = f[2]; if (now - g.t < CONST.faitsAge) e.faits.push(g); }
    if (age <= 30 * MIN && Array.isArray(s.fond) && (FONDS.includes(s.fond[0]) || s.fond[0] === 'attentif' || s.fond[0] === 'alerte')) e.fond = { id: s.fond[0], depuis: Math.min(now, abs(nombre(s.fond[1], 0))) };
    e.prochain = now + 4 * SEC; e.seuils.ouvert = now;
    return e;
  }

  // ---------- Dire pourquoi ----------
  /** Ce qu'il fait et pourquoi, en une phrase (120 caractères au plus, jamais vide). */
  function pourquoi(etat, ctx0, now) {
    const ctx = Object.assign({}, CTX, ctx0 || {}), c = etat.comportement, p = etat.passe;
    const rend = (fait, texte) => { const ph = phrase(texte), i = ph.indexOf(' : '); return { fait, raison: i > 0 ? ph.slice(i + 3).replace(/[.!]$/, '') : ph.replace(/[.!]$/, ''), phrase: ph }; };
    if (c && c.cause) return rend(c.id, c.cause);
    if (p && p.cause && now - p.fin < 15 * SEC) return rend(p.id, p.cause);
    const B = besoins(etat, ctx, now), r = raisonFond(etat.fond.id, etat, B, ctx, now);
    switch (etat.fond.id) {
      case 'alerte': return rend('repos', 'Je reste en alerte : une urgence n\'est pas vue.');
      case 'attentif': return rend('repos', ctx.occupe ? 'Je travaille sur ta demande.' : 'Je t\'écoute.');
      case 'endormi': return rend('repos', `Je dors : ${r}.`);
      case 'somnolent': return rend('repos', `J'ai sommeil : ${r}.`);
      case 'soucieux': return rend('repos', `Je suis soucieux : ${r}.`);
      case 'boudeur': return rend('repos', `Je boude un instant : ${r}.`);
      case 'en_manque': return rend('repos', `Tu me manques un peu : ${r}.`);
      case 'las': return rend('repos', `Je m'ennuie un peu : rien de neuf depuis ${dureeDite(now - nouveaute(etat))}.`);
      default: { const car = etat.caractere || caractereDuJour({ jour: etat.jour || ctx.jour, fete: ctx.fete }); return rend('repos', `Je suis d'humeur ${CARACTERES[car.id].humeur} aujourd'hui : ${causesDites(car.causes, ctx.fete)}.`); }
    }
  }

  // ---------- L'appel et la saisie ----------
  /** Minuscules, sans accents, caractère pour caractère (les positions restent celles du texte d'origine). */
  function plier(txt) { let out = ''; for (const ch of String(txt == null ? '' : txt)) { const b = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); out += ch.length === 1 ? (b.length === 1 ? b : ch.toLowerCase().slice(0, 1) || ' ') : ch; } return out.replace(/[’‘`]/g, '\''); }
  const SEUL = new Set(['', 'tu es la', 't\'es la', 'es-tu la', 'es tu la', 'tu m\'entends', 'tu m\'ecoutes', 'tu dors', 'reveille-toi', 'reveille toi', 'youhou']);
  /**
   * Est-ce qu'on l'appelle ? Oui si le texte commence par son nom (après « hé », « dis », « bonjour »… s'il y en a un),
   * ou s'il finit par son nom, sauf quand on parle de lui (« parle-moi d'Odin », « la page d'Odin », « pour Odin »).
   * `seul` : il n'y a rien d'autre qu'un « tu es là ? » ; `reste` : ce qu'on lui demande ; `force` : 1, 2 ou 3.
   */
  function estAppel(texte, mot = 'odin') {
    const brut = String(texte == null ? '' : texte), f = plier(brut), non = { appel: false, seul: false, reste: brut.trim(), force: 0 };
    const noms = [...new Set(['odine', 'audin', 'odin', plier(mot).trim()])].filter((n) => /^[a-z0-9]{2,20}$/.test(n)).sort((a, b) => b.length - a.length).join('|');
    if (!noms) return non;
    let reste = null, nom = '';
    const debut = new RegExp(`^\\s*(?:(?:he|hey|eh|dis(?:[ -]moi)?|ok|salut|bonjour|bonsoir|coucou|allo)[\\s,!]+)?(${noms})(?![a-z0-9])`).exec(f);
    if (debut) { nom = brut.slice(debut[0].length - debut[1].length, debut[0].length); reste = brut.slice(debut[0].length); }
    else {
      const fin = new RegExp(`(?:^|[\\s,])(${noms})[\\s!?.…]*$`).exec(f);
      if (fin) {
        const i = fin.index + fin[0].indexOf(fin[1]), avant = f.slice(0, i).replace(/[\s,]+$/, '');
        if (!/(?:^|[\s'])(?:d'|de|a|pour|avec|sur|le|l')$/.test(avant) && !/'$/.test(f.slice(0, i))) { nom = brut.slice(i, i + fin[1].length); reste = brut.slice(0, i); }
      }
    }
    if (reste === null) return non;
    const propre = reste.replace(/^[\s,;:!?.…-]+/, '').replace(/[\s,;:]+$/, '').trim();
    const nu = plier(propre).replace(/[!?.…,]/g, ' ').replace(/\s+/g, ' ').trim();
    const fois = (f.match(new RegExp(`(?<![a-z0-9])(?:${noms})(?![a-z0-9])`, 'g')) || []).length;
    const crie = nom.length > 1 && nom === nom.toUpperCase() && nom !== nom.toLowerCase() && /!\s*!/.test(brut);
    const force = crie || fois >= 2 ? 3 : /[!?]/.test(brut) ? 2 : 1;
    return { appel: true, seul: SEUL.has(nu), reste: propre, force };
  }
  /** Est-ce un merci (ou un bravo) ? */
  const estMerci = (texte) => /(?<![a-z])(?:merci|bravo|super|genial|parfait)(?![a-z])/.test(plier(texte));
  const SIGNES = { secret: 'cache', appel: 'ecoute', question: 'curiosite', ordre: 'determination', merci: 'tendresse', salut: 'contentement', souci: 'inquiet', urgent: 'apprehension', reproche: 'gene', long: 'interet', efface: 'etonnement', neutre: 'ecoute', vide: '' };
  CONST.SIGNES = SIGNES;
  /**
   * Ce qu'il comprend de ce que tu es en train d'écrire (rien ne sort de la page) : un signe et l'expression qui va
   * avec. `avant` : le texte à la lecture précédente (pour voir un grand effacement).
   */
  function lireSaisie(texte, avant = '') {
    const brut = String(texte == null ? '' : texte), f = plier(brut).trim(), rend = (signe) => ({ signe, humeur: SIGNES[signe] });
    // Une clé ou un secret : il détourne les yeux, avant toute autre lecture.
    if (/(?<![a-z0-9])sk-[a-z0-9_-]{8,}/.test(f) || /(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/.test(f)) return rend('secret');
    const efface = String(avant == null ? '' : avant).length - brut.length >= 8;
    if (!f) return rend(efface ? 'efface' : 'vide');
    // « Merci Odin » est d'abord un merci.
    const a = estAppel(brut); if (a.appel) return rend(estMerci(a.reste) ? 'merci' : 'appel');
    if (/\?\s*$/.test(f) || /^(?:qui|que|quoi|quand|ou|comment|pourquoi|combien|quel(?:le)?s?|est-ce que|peux-tu|sais-tu|c'est quoi)(?![a-z])/.test(f)) return rend('question');
    if (/^(?:allume|eteins|lance|ouvre|ferme|montre|cherche|envoie|cree|supprime|mets|arrete|redemarre|installe|verifie)(?![a-z])/.test(f)) return rend('ordre');
    if (estMerci(f)) return rend('merci');
    if (/^(?:bonjour|salut|coucou|hello|bonsoir|hey)(?![a-z])/.test(f)) return rend('salut');
    if (/marche pas|fonctionne pas|(?<![a-z])bug|(?<![a-z])plant|erreur|probleme|(?<![a-z])panne|bloqu|(?<![a-z])lent(?:e|es|s)?(?![a-z])/.test(f)) return rend('souci');
    const lettres = brut.replace(/[^\p{L}]/gu, ''), majuscules = lettres.replace(/[^\p{Lu}]/gu, '');
    if (/urgent|(?<![a-z])vite(?![a-z])|tout de suite|au secours|!\s*!/.test(f) || (lettres.length >= 12 && majuscules.length / lettres.length >= .6)) return rend('urgent');
    if (/(?<![a-z])nul(?:le)?(?![a-z])|idiot|tu sers a rien/.test(f)) return rend('reproche');
    if (brut.length >= 180 || brut.split('\n').length >= 3) return rend('long');
    if (efface) return rend('efface');
    return rend('neutre');
  }

  // ---------- Les messages de la page ----------
  /** Réussite ou échec : seulement pour un message d'état court (120 caractères au plus). Un texte long qui contient « erreur » (une réponse, une dictée, une aide) n'est qu'une nouveauté. */
  function sorteDeMessage(txt) {
    const s = String(txt == null ? '' : txt);
    if (s.length > 120) return 'nouveau';
    return /✗|erreur|échec|impossible|invalide/i.test(s) ? 'echec' : /✓|enregistr|relié|ajouté|créé|terminé|prêt/i.test(s) ? 'reussite' : 'nouveau';
  }
  /**
   * Une zone d'état de la page (aria-live, role=status) s'est calmée sur le texte `txt` : faut-il le lui noter ? `memo`
   * est la fiche de la zone, tenue par l'appelant : { fois: [instants de ses derniers changements], le, txt, k }.
   * Rend la sorte du fait ('nouveau', 'reussite', 'echec'), ou rien : la zone défile (plus de 3 changements en
   * 10 secondes : un texte qui s'écrit, un compteur), le même texte y est déjà passé il y a moins de 5 minutes, ou la
   * même sorte de message y a été notée il y a moins de 20 secondes.
   */
  function jugerZone(memo, txt, now) {
    const fois = (Array.isArray(memo.fois) ? memo.fois : []).filter((t) => now - t < 10 * SEC), le = fini(memo.le) ? memo.le : JAMAIS;
    memo.fois = fois;
    if (!txt || fois.length > 3) return null;
    const k = sorteDeMessage(txt);
    if (txt === memo.txt && now - le < 5 * MIN) return null;
    if (k === memo.k && now - le < 20 * SEC) return null;
    memo.le = now; memo.txt = txt; memo.k = k;
    return k;
  }

  // ---------- Les notifications ----------
  /** Une notification est-elle une nouvelle ? Oui si elle est datée d'après le démarrage du moteur (15 secondes de marge) et qu'il reste du non lu. */
  const notifFraiche = (at, depuis, nonLues) => Number.isFinite(at) && at >= depuis - 15000 && nonLues > 0;
  /** Le fait que donne une notification : une alerte, quelque chose d'appris, une réussite seulement si elle le dit, sinon une simple nouveauté (elle l'intrigue, sans fierté). */
  function faitDeNotification(n) {
    const texte = String((n && n.title) || '').slice(0, 60);
    if (n.level === 'grave') return { k: 'alerte', p: 1, texte };
    if (n.level === 'souci') return { k: 'alerte', p: .45, texte };
    if (n.kind === 'Décision d\'Odin') return { k: 'appris', p: .5, texte };
    if (/✓|termin|réussi|sauvegard|install|mis à jour|enregistr|prêt/i.test(texte)) return { k: 'reussite', p: .4, texte };
    return { k: 'nouveau', texte };
  }

  G.OdinVieCoeur = { CONST, hache, rythme, impulsion, caractereDuJour, causesDites, besoins, fondSuivant, visageFond, emotionPour, choisir, avancer, marcheRatee, nouvelEtat, resumer, pourquoi, estAppel, lireSaisie, sorteDeMessage, jugerZone, notifFraiche, faitDeNotification, emotion, repli, dureeRepli };
  if (typeof document === 'undefined') return;

  // =====================================================================================================
  // 2. LE BRANCHEMENT À LA PAGE : il lit ce qui se passe, fait avancer le cœur toutes les 2 secondes, et
  //    transmet ses décisions au visage (OdinFace) et à la mascotte en liberté (OdinCompanion).
  // =====================================================================================================
  const C = G.OdinVieCoeur, CLE = 'odin.vie';
  const reduire = matchMedia('(prefers-reduced-motion:reduce)'), tactile = matchMedia('(pointer:coarse)');
  let etat = null, actif = false, dernierCtx = null, attente = [], tot = 0, reprise = 0, enBattement = false;
  let monActivite = Date.now(), approbation = 0, occupeDit = null, notifVue, gravesAvant = 0, emoLocale = null, humeurVue = '', humeurNotee = '';
  let sigGardee = '', gardeLe = 0, demarreLe = Date.now(), sourceEmo = null;
  const fondPose = new WeakMap();

  const visage = () => window.OdinFace || null;
  /** Le visage sait-il arbitrer (ressent, fond, tenir) ? Sinon on se replie sur ses anciens appels. */
  const visageNeuf = () => { const f = visage(); return Boolean(f && typeof f.ressent === 'function' && typeof f.tenir === 'function'); };
  /** Les mascottes à qui il s'adresse : celle en liberté et celle de la Discussion (celles qui existent). */
  const cibles = () => ['buddyRoam', 'buddyChat'].map((id) => document.getElementById(id)).filter(Boolean);
  const cache = () => { try { return Boolean(window.OdinMascotte && window.OdinMascotte.hidden && window.OdinMascotte.hidden()); } catch { return false; } };
  const visible = (el) => Boolean(el && !el.hidden && el.getClientRects().length);
  const dire = (type, id, raison, plan) => { try { window.dispatchEvent(new CustomEvent('odin:vie', { detail: plan ? { type, id, raison, plan } : { type, id, raison } })); } catch { /* vieux navigateur */ } };
  const jourLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // ---------- Ce qu'il sait de la situation ----------
  function emotionEnCours(now) {
    const f = visage(), el = cibles()[0];
    if (f && el && typeof f.etat === 'function') {
      // (`source` : d'où vient cette émotion — 'vie', 'base' pour une réponse, 'flash' pour un simple éclat —, dit par le visage dans son événement.)
      try { const s = f.etat(el), em = s && s.emotion; if (em && em.id) { const m = C.emotion(em.id); return m ? { id: m.id, famille: m.famille, degre: m.degre, valence: m.valence, jusque: Number(em.a) || 0, source: sourceEmo && sourceEmo.id === m.id ? sourceEmo.source : '' } : null; } return null; } catch { return null; }
    }
    if (emoLocale && now < emoLocale.jusque) { const m = C.emotion(emoLocale.id); return m ? { id: m.id, famille: m.famille, degre: m.degre, valence: m.valence, jusque: emoLocale.jusque } : null; }
    return null;
  }
  function contexte(now) {
    const comp = window.OdinCompanion, st = window.OdinState || {}, d = new Date(now);
    let ce = null; try { ce = comp && typeof comp.etat === 'function' ? comp.etat() : null; } catch { ce = null; }
    let m = null; try { m = window.OdinMascotte ? window.OdinMascotte.state : null; } catch { m = null; }
    const appel = (fn, sinon) => { try { return typeof fn === 'function' ? fn() : sinon; } catch { return sinon; } };
    const inactifMs = ce && Number.isFinite(ce.inactifMs) ? ce.inactifMs : now - monActivite;
    const bud = document.getElementById('buddyRoam'), pastille = document.getElementById('odinBubble');
    const graves = (bud && bud.classList.contains('alarm')) || (pastille && pastille.classList.contains('grave') && visible(pastille)) ? 1 : 0;
    const ctx = {
      heure: d.getHours() + d.getMinutes() / 60,
      jour: m && typeof m.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.day) ? m.day : jourLocal(d),
      vue: (ce && ce.vue) || (document.querySelector('.view.on') || { id: '' }).id.replace(/^v-/, ''),
      present: !document.hidden && inactifMs < C.CONST.presence, inactifMs,
      ecrit: Boolean(ce && ce.ecrit), survol: Boolean(ce && ce.survol), tenu: Boolean(ce && ce.tenu), epingle: Boolean(ce && ce.epingle), visible: Boolean(ce && ce.visible),
      occupe: occupeDit === null ? Boolean(appel(st.busy, false)) : occupeDit,
      fenetre: visible(document.getElementById('odinTalk')) || visible(document.getElementById('guideBox')) || now < approbation,
      promenade: appel(st.roam, true) !== false, reduit: reduire.matches, tactile: tactile.matches, graves,
      nonLues: Number(appel(window.OdinNotices && window.OdinNotices.unread, 0)) || 0, sommeil: Boolean(appel(st.sommeil, false)),
      fete: m && m.event && m.event.id ? { id: String(m.event.id), nom: String(m.event.name || '') } : null,
      emotion: emotionEnCours(now), cible: null,
    };
    // Ce qu'il pourrait aller voir : ce qui vient d'apparaître dans la page, sinon ce qui y demande l'attention.
    const f = etat && etat.faits.slice().reverse().find((x) => (x.k === 'reussite' || x.k === 'echec' || x.k === 'nouveau') && Number.isFinite(x.x) && now - x.t < 20000);
    if (f) ctx.cible = { cle: f.id || `t${C.hache(f.texte || '')}`, sorte: f.k, texte: f.texte || '', x: f.x, y: f.y };
    else if (ce && ce.attention) ctx.cible = { cle: `a${C.hache(ce.attention.texte || '')}`, sorte: 'attention', texte: ce.attention.texte || '', x: ce.attention.x, y: ce.attention.y };
    return ctx;
  }
  /** Les notifications, sans toucher à leur fichier : une nouvelle en tête de liste devient un fait ; l'urgence vue aussi. */
  function notifications(now, graves) {
    let L = [], nonLues = 0;
    try { L = (window.OdinNotices && window.OdinNotices.list && window.OdinNotices.list()) || []; nonLues = Number(window.OdinNotices && window.OdinNotices.unread && window.OdinNotices.unread()) || 0; } catch { L = []; }
    const tete = L[0];
    if (tete && tete.id !== notifVue) {
      notifVue = tete.id;
      // Une vieille notification dont la liste arrive en retard (connexion lente, flux rouvert) n'est pas une nouvelle :
      // on juge sa date, pas l'ordre des relevés.
      if (C.notifFraiche(Date.parse(tete.at || ''), demarreLe, nonLues)) noter(C.faitDeNotification(tete));
    }
    // L'alarme tombe quand la notification est lue ou son panneau fermé : l'urgence est vue (rien ne dit qu'elle est réparée).
    if (gravesAvant > 0 && graves === 0) noter({ k: 'alerte_reglee' });
    gravesAvant = graves;
  }

  // ---------- Transmettre ses décisions ----------
  function montrer(s, extra) {
    const f = visage(); if (!f || cache()) return;
    const els = cibles();
    if (visageNeuf()) {
      const o = Object.assign({ raison: s.raison, source: 'vie' }, extra || {}); if (s.ms) o.ms = s.ms; if (s.force) o.force = true;
      for (const el of els) { try { f.ressent(el, s.id, o); } catch { /* le visage n'est pas prêt */ } }
    } else if (typeof f.flash === 'function') {
      const ms = s.ms || C.dureeRepli(s.id);
      for (const el of els) { try { f.flash(el, C.repli(s.id), Math.min(ms, 4000)); } catch { /* */ } }
      emoLocale = { id: s.id, jusque: Date.now() + ms };
    }
  }
  /** La disposition de fond, posée sur chaque mascotte (une fois par changement de visage). */
  function poserFond() {
    const f = visage(); if (!f || !etat) return;
    const id = etat.fond.id, vis = C.visageFond(id, dernierCtx);
    for (const el of cibles()) {
      if (fondPose.get(el) === vis) continue;
      fondPose.set(el, vis);
      try {
        if (!visageNeuf()) { if (id === 'attentif' && typeof f.flash === 'function') f.flash(el, 'ecoute', 4000); continue; }
        f.fond(el, vis);
      } catch { /* le visage n'est pas prêt : on réessaiera au prochain changement */ fondPose.delete(el); }
    }
  }
  /** Dans la Discussion, pas de mascotte en liberté : un geste de la décision va à sa copie, parmi ceux qu'elle sait faire (aucun déplacement). */
  const GESTES_DISCUSSION = { joy: 'act-joy', sad: 'act-sad', tilt: 'act-tilt', spin: 'act-spin', wobble: 'act-wobble', advance: 'act-advance', signe: 'act-tilt', roule: 'act-spin', soupir: 'act-sad', etire: 'act-advance', baille: 'act-wobble', tremble: 'act-wobble' };
  function gesteDiscussion(s) {
    const B = window.OdinBuddy, copieChat = document.getElementById('buddyChat');
    if (!B || typeof B.act !== 'function' || !visible(copieChat) || !Array.isArray(s.plan)) return;
    const g = s.plan.find((p) => p[0] === 'geste' && GESTES_DISCUSSION[p[1]]); if (!g) return;
    try { B.act(GESTES_DISCUSSION[g[1]], Math.max(600, Math.min(3000, Number(g[2]) || 1200))); } catch { /* la copie n'est pas prête */ }
  }
  function agir(s) {
    const comp = window.OdinCompanion, bud = document.getElementById('buddyRoam');
    if (cache()) return;
    if (!comp || !bud || bud.hidden) { gesteDiscussion(s); return; }
    try {
      if (s.id === 'repos') { if (typeof comp.arreter === 'function') comp.arreter(); return; }
      if (typeof comp.jouer !== 'function') return;
      if (s.urgent && typeof comp.arreter === 'function') comp.arreter();
      // S'il avait décidé d'aller quelque part et qu'aucun chemin n'était libre, il n'a pas bougé : le cœur revient en arrière (il ne dit pas qu'il se dégourdit).
      if (s.plan.length) comp.jouer(s.plan, (fin, info) => { if (info && info.refus && !info.bouge && etat) { try { etat = C.marcheRatee(etat, Date.now(), s.id); } catch { /* */ } } });
    } catch { /* la mascotte n'est pas prête */ }
  }
  function appliquer(s) {
    if (s.type === 'emotion') montrer(s);
    else if (s.type === 'comportement') agir(s);
    dire(s.type, s.id, s.raison, s.type === 'comportement' ? s.plan : undefined);
  }

  // ---------- Garder (sur cet appareil seulement) ----------
  function garder(now, force) {
    if (!etat) return;
    let emo = null;
    try { const f = visage(), el = cibles()[0], st = f && el && typeof f.etat === 'function' ? f.etat(el) : null; if (st && st.emotion && st.emotion.id) emo = { id: st.emotion.id, jusque: Number(st.emotion.a) || 0 }; } catch { emo = null; }
    if (!emo && emoLocale && now < emoLocale.jusque) emo = { id: emoLocale.id, jusque: emoLocale.jusque };
    const sig = `${etat.fond.id}|${etat.caractere ? etat.caractere.id : ''}|${emo ? emo.id : ''}`;
    if (!force && (sig === sigGardee || now - gardeLe < 10000)) return;
    try {
      const o = C.resumer(etat); if (emo) o.emo = emo; if (humeurVue) o.hv = humeurVue;
      localStorage.setItem(CLE, JSON.stringify(o)); sigGardee = sig; gardeLe = now;
    } catch { /* stockage refusé : tout reste en mémoire */ }
  }

  // ---------- Le battement ----------
  function battement() {
    if (!actif || !etat || document.hidden || document.body.classList.contains('touring') || cache()) return;
    const now = Date.now(), ctx = contexte(now);
    enBattement = true; try { notifications(now, ctx.graves); } finally { enBattement = false; }
    let r; try { r = C.avancer(etat, { faits: attente.splice(0), ctx }, now); } catch (err) { console.error('[vie]', err); return; }
    etat = r.etat; dernierCtx = ctx;
    for (const s of r.sorties) appliquer(s);
    poserFond();
    garder(now, false);
    // Une émotion attend son tour (« soulagé, puis calme ») : un battement juste à temps.
    if (etat.apres.length) { clearTimeout(reprise); reprise = setTimeout(battement, Math.max(60, Math.min(...etat.apres.map((a) => a.t)) - now + 40)); }
  }
  /** Un battement tout de suite (un fait qui ne peut pas attendre 2 secondes : un appel, une alerte, une page). */
  function bientot() { if (tot || enBattement) return; tot = setTimeout(() => { tot = 0; battement(); }, 60); }
  const VIFS = new Set(['appel', 'alerte', 'alerte_reglee', 'page', 'reussite', 'echec', 'appris', 'bloque', 'embete', 'caresse', 'merci', 'humeur']);

  /** Lui noter un fait (ce qui vient de se passer). Une sorte inconnue est ignorée. */
  function noter(fait) {
    if (!fait || typeof fait !== 'object' || !C.CONST.SORTES.includes(fait.k)) return false;
    const g = { t: Date.now(), k: fait.k };
    if (Number.isFinite(fait.p)) g.p = fait.p;
    if (typeof fait.id === 'string' && fait.id) g.id = fait.id.slice(0, 40);
    if (typeof fait.texte === 'string' && fait.texte) g.texte = fait.texte.slice(0, 60);
    if (Number.isFinite(fait.x) && Number.isFinite(fait.y)) { g.x = fait.x; g.y = fait.y; }
    if (g.k === 'page' && !g.texte) { try { g.texte = String((window.OdinGuide && window.OdinGuide.where && window.OdinGuide.where()) || '').slice(0, 60); } catch { /* */ } }
    attente.push(g); if (attente.length > 40) attente.shift();
    if (VIFS.has(g.k)) bientot();
    return true;
  }

  // ---------- « Il répond quand je l'appelle » ----------
  const SOURCES = ['toucher', 'clavier', 'message', 'voix', 'pastille'];
  /**
   * On l'appelle : il sursaute, fait « oui ? », écoute un instant et vient. Il écoute 1,5 seconde (le temps de répondre),
   * puis ce qu'il ressent se voit (content, étonné d'être réveillé…) : plus longtemps, l'écoute cachait ses émotions.
   * Caché, rien ne se voit (la petite fenêtre s'ouvre quand même). En pause, il répond mais rien n'est noté pour plus tard.
   */
  function appeler(source, detail) {
    if (!SOURCES.includes(source)) return false;
    const g = { k: 'appel', id: source }; if (detail && Number.isFinite(detail.x) && Number.isFinite(detail.y)) { g.x = detail.x; g.y = detail.y; }
    if (actif) noter(g);
    const f = visage();
    if (f && !cache()) {
      const neuf = visageNeuf();
      for (const el of cibles()) {
        try {
          // D'abord le visage, puis le sursaut : le geste demandé garde la place (le visage ne joue pas son propre geste d'arrivée par-dessus).
          if (neuf) { f.tenir(el, 'ecoute', 'appel', 1500); if (typeof f.geste === 'function' && !f.geste(el, 'sursaut') && el.id === 'buddyRoam' && window.OdinCompanion && window.OdinCompanion.act) window.OdinCompanion.act('act-tilt', 900); }
          else { if (typeof f.flash === 'function') f.flash(el, 'ecoute', 4000); if (el.id === 'buddyRoam' && window.OdinCompanion && window.OdinCompanion.act) window.OdinCompanion.act('act-tilt', 900); }
        } catch { /* */ }
      }
      try { if (typeof f.sound === 'function') f.sound(neuf ? 'appel' : 'hop'); } catch { /* */ }
    }
    dire('appel', source, 'Tu m\'as appelé.');
    bientot();
    return true;
  }
  /** Les trois champs où on lui parle (jamais un champ de travail, jamais un mot de passe). */
  function champDialogue(t) {
    if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) || t.type === 'password') return false;
    return t.id === 'input' || t.id === 'guideAsk' || Boolean(t.closest && t.closest('#odinTalk'));
  }
  /** Aucun champ en cours, aucune fenêtre ouverte, palette fermée, application affichée : « odin » tapé au clavier est bien un appel. */
  function clavierLibre() {
    const a = document.activeElement;
    if (a && a !== document.body && a !== document.documentElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable || (a.getAttribute && a.getAttribute('role') === 'textbox'))) return false;
    if (document.querySelector('dialog[open]')) return false;
    const pal = document.getElementById('palette'); if (pal && !pal.hidden) return false;
    const acces = document.getElementById('login'); if (acces && !acces.hidden) return false;
    return !document.body.classList.contains('touring');
  }
  /** Un message envoyé peut être vu deux fois (la touche Entrée, puis l'événement d'envoi) : un seul merci, un seul appel. */
  let messageLe = 0;
  function surMessage(texte, par) {
    const now = Date.now(); if (now - messageLe < 2000) return; messageLe = now;
    // « Merci Odin » est un merci (pas un appel : il ne « vient » pas).
    if (C.lireSaisie(texte, '').signe === 'merci') noter({ k: 'merci' }); else { const a = C.estAppel(texte); if (a.appel) appeler(par === 'voix' ? 'voix' : 'message', a); }
  }
  let lettres = [];
  function surTouche(e) {
    monActivite = Date.now();
    // Entrée dans un champ où on lui parle : est-ce un appel, un merci ? (lecture seule : rien n'est modifié ni retenu)
    if (e.key === 'Enter') {
      lettres = [];
      if (e.shiftKey || e.isComposing || !champDialogue(e.target)) return;
      const v = String(e.target.value || ''); if (!v.trim()) return;
      try { surMessage(v, 'clavier'); } catch { /* */ }
      return;
    }
    // « odin » tapé hors de tout champ, en moins de 1,2 seconde.
    if (e.key === 'Shift' || e.key === 'CapsLock') return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing || typeof e.key !== 'string' || !/^[a-zA-Z]$/.test(e.key)) { lettres = []; return; }
    lettres.push({ k: e.key.toLowerCase(), t: monActivite }); if (lettres.length > 4) lettres.shift();
    if (lettres.length === 4 && lettres.map((x) => x.k).join('') === 'odin' && monActivite - lettres[0].t < 1200 && clavierLibre()) {
      lettres = [];
      appeler('clavier');
      // La petite fenêtre s'ouvre 400 ms après (le curseur arrive dans son champ) ; s'il est en train de venir, dès qu'il est arrivé.
      const debut = monActivite;
      const ouvrir = () => {
        try {
          const comp = window.OdinCompanion, enRoute = comp && typeof comp.etat === 'function' && comp.etat().marche;
          if (enRoute && Date.now() - debut < 3600) { setTimeout(ouvrir, 120); return; }
          if (clavierLibre() && window.OdinNotices && window.OdinNotices.talk) window.OdinNotices.talk();
        } catch { /* */ }
      };
      setTimeout(ouvrir, 400);
    }
  }
  // Pendant la saisie dans un de ces trois champs : il lit, et son visage suit (question, ordre, merci, souci, secret…).
  const avantSaisie = new WeakMap();
  let signe = { id: '', depuis: 0, tenuLe: 0 }, lectureT = 0, lectureLe = 0;
  function tenirSaisie(humeur) {
    const f = visage(); if (!f || cache()) return;
    for (const el of cibles()) { try { if (visageNeuf()) f.tenir(el, humeur, 'saisie', 2500); else if (typeof f.flash === 'function') f.flash(el, C.repli(humeur), 2500); } catch { /* */ } }
    signe.tenuLe = Date.now();
  }
  function lacherSaisie() {
    clearTimeout(lectureT);
    if (!signe.id) return;
    signe = { id: '', depuis: 0, tenuLe: 0 };
    const f = visage(); if (f && visageNeuf()) for (const el of cibles()) { try { f.lacher(el, 'saisie'); } catch { /* */ } }
  }
  function lireChamp(t) {
    const now = Date.now(), v = String(t.value || ''), r = C.lireSaisie(v, avantSaisie.get(t) || '');
    avantSaisie.set(t, v); lectureLe = now;
    if (!v.trim() || !r.humeur) { lacherSaisie(); return; }
    if (r.signe !== signe.id) {
      // Un signe tient 1,5 seconde au moins avant de laisser la place au suivant.
      if (signe.id && now - signe.depuis < 1500) { clearTimeout(lectureT); lectureT = setTimeout(() => lireChamp(t), signe.depuis + 1500 - now + 20); return; }
      signe = { id: r.signe, depuis: now, tenuLe: 0 }; tenirSaisie(r.humeur);
    } else if (now - signe.tenuLe > 1800) tenirSaisie(r.humeur);
  }
  function surSaisie(e) {
    const t = e.target; if (!champDialogue(t)) return;
    clearTimeout(lectureT);
    lectureT = setTimeout(() => lireChamp(t), Math.max(120, 250 - (Date.now() - lectureLe)));
  }

  // ---------- Ce qu'il entend de la page ----------
  function surHumeur(e) {
    const d = e && e.detail;
    // D'où vient l'émotion qu'il montre (quand c'est bien elle qui se voit, pas un état tenu par-dessus).
    if (d && d.emotion && d.id === d.emotion && e.target === cibles()[0]) sourceEmo = { id: String(d.emotion), source: String(d.source || '') };
    if (!d || d.source === 'vie' || !d.emotion) return;
    const cle = `${d.emotion}:${d.jusque || 0}`; if (cle === humeurNotee) return; humeurNotee = cle;
    noter({ k: 'humeur', id: String(d.emotion) });
  }
  /** L'émotion de sa dernière réponse, venue du serveur avec le thème : un autre écran la montre aussi, pour le temps qui reste. */
  function surMascotte(e) {
    const d = e && e.detail, h = d && d.humeur; if (!h || typeof h.id !== 'string' || !Number.isFinite(h.depuis) || !Number.isFinite(h.reste) || !Number.isFinite(d.maintenant)) return;
    const cle = `${h.id}:${h.depuis}`; if (cle === humeurVue || h.reste < 600 || !C.emotion(h.id)) return;
    humeurVue = cle;
    const en = emotionEnCours(Date.now()); if (en && en.id === h.id) return; // déjà montrée ici
    noter({ k: 'humeur', id: h.id, p: h.reste });
  }
  function surOutil(e) {
    const d = e && e.detail; if (!d || typeof d.type !== 'string') return;
    if (d.type === 'tool_start') noter({ k: 'travail' });
    else if (d.type === 'blocked') noter({ k: 'bloque' });
    else if (d.type === 'learned') noter({ k: 'appris', p: .8 });
  }
  function surEnvoi(e) {
    const d = e && e.detail, texte = d && typeof d.texte === 'string' ? d.texte : ''; if (!texte) return;
    try { surMessage(texte, d.par); } catch { /* */ }
  }

  // ---------- Démarrer ----------
  function demarrer() {
    if (etat) return;
    const now = Date.now();
    let sauve = null; try { sauve = JSON.parse(localStorage.getItem(CLE) || 'null'); } catch { sauve = null; }
    etat = C.nouvelEtat(sauve, now); demarreLe = now;
    if (sauve && typeof sauve.hv === 'string') humeurVue = sauve.hv.slice(0, 40);
    actif = true;
    // Une émotion pas finie au rechargement reprend pour le temps qui reste (pas au-delà de 30 minutes d'absence).
    const emo = sauve && sauve.emo;
    if (emo && typeof emo.id === 'string' && C.emotion(emo.id) && Number.isFinite(emo.jusque) && Number.isFinite(sauve.t) && now - sauve.t <= 30 * 60000 && emo.jusque - now > 500 && emo.jusque - now <= 120000) {
      montrer({ id: emo.id, ms: emo.jusque - now, raison: 'je reprends où j\'en étais' }, { sansHabitude: true });
    }
    addEventListener('keydown', surTouche, { capture: true, passive: true });
    addEventListener('pointerdown', () => { monActivite = Date.now(); }, { capture: true, passive: true });
    document.addEventListener('input', surSaisie, { capture: true, passive: true });
    document.addEventListener('focusout', (e) => { if (champDialogue(e.target)) lacherSaisie(); }, true);
    document.addEventListener('odin-humeur', surHumeur);
    document.documentElement.addEventListener('odin-mascotte', surMascotte);
    addEventListener('odin:reply', () => noter({ k: 'echange' }));
    addEventListener('odin:approval', () => { approbation = Date.now() + 20000; bientot(); });
    addEventListener('odin:event', surOutil);
    addEventListener('odin:busy', (e) => { occupeDit = e && e.detail ? Boolean(e.detail.on) : null; bientot(); });
    addEventListener('odin:envoi', surEnvoi);
    document.addEventListener('visibilitychange', () => { if (document.hidden) garder(Date.now(), true); else { monActivite = Date.now(); bientot(); } });
    addEventListener('pagehide', () => garder(Date.now(), true));
    setInterval(battement, C.CONST.battement);
    battement();
  }

  let pauseT = 0;
  window.OdinVie = {
    get actif() { return actif; },
    noter, appeler,
    /** Ce qu'il comprend d'un texte en cours de saisie : { signe, humeur }. */
    lire: (texte, champ) => { const avant = champ && typeof champ === 'object' ? avantSaisie.get(champ) || '' : ''; return C.lireSaisie(texte, avant); },
    /** Où il en est : caractère du jour, disposition, émotion, comportement, besoins. */
    etat: () => {
      const now = Date.now(), e = etat || C.nouvelEtat(null, now), ctx = dernierCtx || contexte(now), em = emotionEnCours(now);
      const car = e.caractere || C.caractereDuJour({ jour: ctx.jour, fete: ctx.fete });
      return { caractere: { id: car.id, nom: car.nom, causes: car.causes.slice() }, fond: e.fond.id, emotion: em ? em.id : null, comportement: e.comportement ? e.comportement.id : null, besoins: C.besoins(e, ctx, now) };
    },
    /** Ce qu'il fait et pourquoi : { fait, raison, phrase }. */
    pourquoi: () => { const now = Date.now(); return C.pourquoi(etat || C.nouvelEtat(null, now), dernierCtx || contexte(now), now); },
    /** Le mettre en pause (pour toujours, ou pour `ms` millisecondes), puis le reprendre. */
    pause: (ms) => { actif = false; clearTimeout(pauseT); if (Number.isFinite(ms) && ms > 0) pauseT = setTimeout(() => { actif = Boolean(etat); }, ms); },
    reprendre: () => { clearTimeout(pauseT); actif = Boolean(etat); if (actif) bientot(); },
  };
  // companion.js crée la mascotte en liberté 300 ms après le chargement : on démarre juste après.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(demarrer, 400)); else setTimeout(demarrer, 400);
})();
