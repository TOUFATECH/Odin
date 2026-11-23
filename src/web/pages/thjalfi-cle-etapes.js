// Genèse · Clés USB — le parcours par étapes de la maquette validée « Clés USB » (lot C1) :
//   - les quatre onglets (Déployer, Mes clés, Démarrage, Par la parole), au clavier (flèches, Début, Fin) ;
//   - la barre des 6 étapes (Clé, Façon, Systèmes, Logiciels, Windows, Vérifier), aria-current="step" ;
//   - l'étape 1 « Clé » : une carte par clé branchée (taille, bus, numéro de série, occupation), une seule choisie,
//     le garde-fou JUSTE SOUS la clé choisie (rouge : « sera entièrement effacée » ; vert : déjà ODIN ou vide),
//     les disques internes et le disque du système montrés VERROUILLÉS et jamais proposés, et « Vérifier en la
//     débranchant » (attendre qu'elle disparaisse, puis que le MÊME numéro de série revienne ; une autre clé est refusée).
// Rien ici n'écrit sur un disque : on ne fait que LIRE la liste (cle_disques). Choisir une clé n'écrit rien.
// « Copier son contenu dans Odin d'abord » : aucune action d'Odin ne copie encore le contenu d'une clé, le bouton
// n'est donc pas montré (COPIE_POSSIBLE plus bas) ; il viendra avec l'action qui le fait vraiment.
// Les étapes 2 « Façon » et 3 « Systèmes » (lot C2) sont dans thjalfi-cle-systemes.js (window.OdinGeneseCleSystemes) :
// les étapes 4 à 6 ne s'ouvrent que si l'étape 3 est juste (au moins un système, et tout tient sur la clé).
// Les étapes 4 « Logiciels et scripts » et 5 « Options Windows » (lot C3) sont dans thjalfi-cle-logiciels.js
// (window.OdinGeneseCleLogiciels) ; l'étape 5 ne s'ouvre que si un Windows est choisi (sinon on passe de 4 à 6).
// L'étape 6 et les trois autres onglets arrivent avec leurs lots : en attendant, ils disent « bientôt » et
// gardent joignable tout ce que l'appli sait déjà faire (le composeur, qui reçoit les systèmes déjà choisis,
// l'aperçu du menu, les disques comme avant).
//
// Tous les textes sont dans MOTS (aucune phrase écrite dans une donnée) ; tailles et nombres selon la langue de la page.
// Expose window.OdinGeneseCleEtapes = { MOTS, logique, monter(wrap, outils) } ; « logique » est pure (essais sans page).
(() => {
  'use strict';
  const W = typeof window !== 'undefined' ? window : globalThis;

  // ---------------------------------------------------------------- les mots
  const MOTS = {
    'tete.titre': 'Clés USB',
    'tete.sous': 'Prépare une clé ODIN qui démarre plusieurs systèmes, change-la ensuite, et vois son écran de démarrage.',
    'onglets.nom': 'Clés USB',
    'onglet.deployer': 'Déployer', 'onglet.mescles': 'Mes clés', 'onglet.demarrage': 'Démarrage', 'onglet.parole': 'Par la parole',
    'etapes.nom': 'Étapes',
    'etape.1': 'Clé', 'etape.1.sous': 'Choisir la clé',
    'etape.2': 'Façon', 'etape.2.sous': 'Démarrage ou installés',
    'etape.3': 'Systèmes', 'etape.3.sous': 'ISO et systèmes',
    'etape.4': 'Logiciels', 'etape.4.sous': 'et scripts',
    'etape.5': 'Windows', 'etape.5.sous': 'Options',
    'etape.6': 'Vérifier', 'etape.6.sous': 'Avant d\'écrire',
    'etape.position': 'Étape {n} sur {total}',
    'etape.fermee': 'Choisis d\'abord une clé.',
    'cle.titre': 'Quelle clé ou quel disque ?',
    'cle.lead': 'Branche la clé ou le disque (disque USB, SSD externe, carte mémoire). Odin le voit arriver tout seul ; il s\'appellera {nom}.',
    'cle.nom': 'ODIN',
    'cle.groupe': 'Clés et disques branchés',
    'cle.charge': 'Odin regarde les disques branchés…',
    'cle.aucune': 'Aucune clé ni disque externe branché pour l\'instant. Branche-le : il apparaît ici tout seul.',
    'cle.erreur': 'Odin n\'a pas pu lire les disques : {raison}',
    'cle.partie': 'La clé choisie a été débranchée : choisis-la de nouveau quand elle est rebranchée.',
    'cle.partie.disque': 'Le disque choisi a été débranché : choisis-le de nouveau quand il est rebranché.',
    'cle.refus': 'Ce disque ne peut pas devenir une clé ODIN.',
    'cle.sous': '{taille} · {bus} · n° {serie}',
    'cle.serieInconnue': 'inconnu',
    'cle.tag.odin': 'Déjà ODIN',
    'cle.contenu.odin': 'Déjà une clé ODIN',
    'cle.contenu.vide': 'Vide',
    'cle.contenu.utilise': '{t} de fichiers',
    'cle.contenu.parts.one': '{n} partition',
    'cle.contenu.parts.other': '{n} partitions',
    'cle.contenu.noms': '{parts} : {noms}',
    'part.odin': 'ODIN', 'part.donnees': 'Données', 'part.efi': 'Démarrage', 'part.systeme': 'Système', 'part.libre': 'Libre',
    'part.legende': '{nom} {t}',
    'bus.usb': 'USB', 'bus.sd': 'Carte mémoire', 'bus.autre': 'Branché',
    'garde.efface.titre': 'Cette clé sera entièrement effacée',
    'garde.efface.titre.disque': 'Ce disque sera entièrement effacé',
    'garde.efface.detail': '{bus} · n° {serie} — {contenu}.',
    'garde.efface.serie': 'Odin revérifie le numéro de série juste avant d\'écrire : si une autre clé ou un autre disque est branché à sa place, il s\'arrête.',
    'garde.efface.sansSerie': 'Cette clé ne donne pas de numéro de série lisible : regarde bien son nom et sa taille avant de continuer.',
    'garde.efface.sansSerie.disque': 'Ce disque ne donne pas de numéro de série lisible : regarde bien son nom et sa taille avant de continuer.',
    'garde.efface.internes': 'Les disques internes ne sont jamais proposés.',
    'garde.odin.titre': 'Déjà une clé ODIN : rien ne sera effacé',
    'garde.odin.texte': 'Odin ajoute ce que tu choisis à côté de ce qui y est. Pour la changer plus tard, passe par « Mes clés ».',
    'garde.vide.titre': 'Clé vide',
    'garde.vide.texte': 'Rien à perdre dessus.',
    'verif.bouton': 'Vérifier en la débranchant',
    'verif.bouton.disque': 'Vérifier en le débranchant',
    'verif.arreter': 'Arrêter la vérification',
    'verif.depart': 'Débranche maintenant « {nom} » (n° {serie})…',
    'verif.retour': 'Elle a bien disparu. Rebranche-la…',
    'verif.retour.disque': 'Il a bien disparu. Rebranche-le…',
    'verif.autre': 'Ce n\'est pas la même clé (n° {autre}) : rebranche « {nom} ».',
    'verif.autre.disque': 'Ce n\'est pas le même disque (n° {autre}) : rebranche « {nom} ».',
    'verif.ok': 'C\'est bien elle : même numéro de série ({serie}).',
    'verif.ok.disque': 'C\'est bien lui : même numéro de série ({serie}).',
    'verif.delai': 'Rien vu pendant {min} minutes : vérification arrêtée. Rien n\'a été écrit.',
    'verif.erreur': 'Odin n\'arrive plus à lire les disques : vérification arrêtée.',
    'internes.titre': 'Disques internes · protégés',
    'internes.tag.systeme': 'Système en cours',
    'internes.tag.interne': 'Disque interne',
    'internes.jamais': 'Jamais proposé ici : Odin ne prépare une clé que sur un disque branché de l\'extérieur.',
    'verrou.sous': '{taille} · {bus}',
    'internes.jamaisSysteme': 'Jamais proposé : le système tourne depuis ce disque.',
    'pied.continuer': 'Continuer',
    'pied.retour': 'Retour',
    'pied.choisir': 'Choisis une clé ou un disque pour continuer.',
    'bientot.etape': 'Cette étape arrive bientôt dans ce parcours.',
    'bientot.composeur': 'En attendant, tout se règle dans le composeur actuel : systèmes, logiciels, thème, plan de la place, puis ton accord avant d\'écrire.',
    'bientot.ouvrir': 'Ouvrir le composeur pour « {nom} »',
    'bientot.mescles': 'Bientôt : tes clés ODIN, leur contenu et l\'ordre du menu, changés sans rien effacer.',
    'bientot.mescles.avant': 'En attendant, tes disques comme avant : préparer une clé, le plan de double démarrage d\'un disque interne, retirer Odin d\'un disque.',
    'bientot.demarrage': 'Bientôt : l\'arrivée d\'Odin et le menu de la clé, en mode graphique (par défaut) ou en mode texte.',
    'bientot.demarrage.apercu': 'Voir l\'aperçu du menu actuel',
    'bientot.parole': 'Bientôt : « J\'ai branché une clé, prépare-la » — Odin te propose d\'abord, puis attend ta confirmation avant d\'écrire.',
    'bientot.titre': 'Bientôt',
  };
  const mot = (k, v) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_m, x) => (v && v[x] != null ? String(v[x]) : ''));

  // ---------------------------------------------------------------- la logique (pure)
  const GIO = 1024 ** 3;
  const ETAPES = 6;
  const ONGLETS = ['deployer', 'mescles', 'demarrage', 'parole'];
  /** Pas encore d'action qui copie le contenu d'une clé dans Odin : le bouton n'est pas montré. */
  const COPIE_POSSIBLE = false;
  /** La vérification en la débranchant s'arrête seule au bout de ce temps. */
  const VERIF_MAX_MS = 2 * 60 * 1000;

  const langue = () => { try { return (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || undefined; } catch { return undefined; } };
  /** Une taille en Go ou To, écrite selon la langue de la page (Intl). */
  function taille(octets, lang) {
    const g = (Number(octets) || 0) / GIO;
    const [v, u] = g >= 1000 ? [g / 1024, 'terabyte'] : g > 0 && g < 1 ? [g * 1024, 'megabyte'] : [g, 'gigabyte'];
    const chiffres = v >= 100 ? 0 : 1;
    try { return new Intl.NumberFormat(lang, { style: 'unit', unit: u, unitDisplay: 'short', maximumFractionDigits: chiffres }).format(v); } catch { return `${Math.round(v)}`; }
  }
  const nombre = (n, lang) => { try { return new Intl.NumberFormat(lang).format(n); } catch { return String(n); } };
  const pluriel = (n, lang) => { try { return new Intl.PluralRules(lang).select(n) === 'one' ? 'one' : 'other'; } catch { return n === 1 ? 'one' : 'other'; } };

  /** Même règle que le serveur (disques.ts, choisissable) : externe, retirable, et pas le disque du système. */
  const choisissable = (d) => Boolean(d && d.externe === true && d.amovible === true && !d.systemeEnCours);
  /** Un texte venu d'un disque, sans caractères de contrôle ni invisibles (sens d'écriture, largeur nulle). */
  const propre = (x) => String(x == null ? '' : x).replace(/[\p{Cc}\p{Cf}]+/gu, '').trim();
  /** Le numéro de série nettoyé (ou rien). */
  const serieBrute = (d) => { const s = d && typeof d.serie === 'string' ? propre(d.serie) : ''; return s.length >= 4 ? s : ''; };
  /** Les numéros de série portés par plusieurs disques branchés : ils ne prouvent rien. */
  const enDouble = (liste) => { const vus = new Map(); for (const d of liste) { const s = serieBrute(d).toUpperCase(); if (s) vus.set(s, (vus.get(s) || 0) + 1); } return new Set([...vus].filter(([, n]) => n > 1).map(([s]) => s)); };
  /** Le numéro de série d'un disque, s'il est lisible ET unique parmi ceux de la liste (sinon rien). */
  const serieDe = (d, doubles) => { const s = serieBrute(d); return s && !(doubles && doubles.has(s.toUpperCase())) ? s : ''; };
  /** La fin d'un numéro de série, assez longue pour ne ressembler à aucune autre clé branchée (4 caractères au moins). */
  function queue(serie, autres) {
    if (!serie) return '';
    for (let n = 4; n < serie.length; n++) {
      const fin = serie.slice(-n);
      if (!(autres || []).some((a) => a && a !== serie && a.slice(-n) === fin)) return `…${fin}`;
    }
    return serie;
  }
  const busDe = (d) => { const b = String(d && d.bus || '').toLowerCase(); return b === 'usb' ? mot('bus.usb') : b === 'sd' || b === 'mmc' ? mot('bus.sd') : b ? b.toUpperCase() : mot('bus.autre'); };
  const genrePart = (p) => (p.systeme === 'odin' || String(p.label || '').toUpperCase() === 'ODIN' ? 'odin' : p.systeme === 'efi' ? 'efi' : p.systeme && p.systeme !== 'donnees' ? 'systeme' : 'donnees');

  /** L'occupation d'un disque : morceaux (genre, octets) et légende, le libre à la fin. */
  function occupation(d, lang) {
    const total = Math.max(1, Number(d.tailleOctets) || 0), somme = new Map();
    let pris = 0;
    for (const p of d.partitions || []) {
      const o = Math.max(0, Number(p.utiliseOctets ?? p.tailleOctets) || 0), g = genrePart(p);
      somme.set(g, (somme.get(g) || 0) + o); pris += o;
    }
    const morceaux = [...somme].filter(([, o]) => o > 0).map(([genre, octets]) => ({ genre, octets, pct: Math.min(100, (octets / total) * 100) }));
    const libre = Math.max(0, total - pris);
    if (libre / total > 0.005) morceaux.push({ genre: 'libre', octets: libre, pct: (libre / total) * 100 });
    return morceaux.map((m) => ({ ...m, legende: mot('part.legende', { nom: mot(`part.${m.genre}`), t: taille(m.octets, lang) }) }));
  }
  /** Ce que la clé contient, en une ligne. */
  function contenu(d, etat, lang) {
    if (etat === 'odin') return mot('cle.contenu.odin');
    if (etat === 'vide') return mot('cle.contenu.vide');
    const parts = d.partitions || [];
    const utilise = parts.reduce((s, p) => s + (p.utiliseOctets != null ? Number(p.utiliseOctets) || 0 : 0), 0);
    if (parts.some((p) => p.utiliseOctets != null) && utilise > 0) return mot('cle.contenu.utilise', { t: taille(utilise, lang) });
    const n = parts.length, nb = mot(`cle.contenu.parts.${pluriel(n, lang)}`, { n: nombre(n, lang) });
    const noms = parts.map((p) => p.label).filter(Boolean);
    return noms.length ? mot('cle.contenu.noms', { parts: nb, noms: noms.map((x) => `« ${x} »`).join(', ') }) : nb;
  }
  /** L'état d'une clé : déjà ODIN (rien n'est effacé), vide, ou avec des données (tout sera effacé). */
  function etatDe(d) {
    if (d.estOdin) return 'odin';
    const parts = d.partitions || [];
    if (!parts.length) return 'vide';
    if (parts.every((p) => p.utiliseOctets != null && Number(p.utiliseOctets) === 0 && !p.label)) return 'vide';
    return 'donnees';
  }

  /** La vue de l'étape « Clé » : les clés à choisir, et les disques verrouillés (jamais proposés). */
  function vueDisques(data, lang) {
    const tous = [...((data && data.externes) || []), ...((data && data.internes) || [])].filter((d) => d && typeof d === 'object');
    const doubles = enDouble(tous);
    const series = tous.map((d) => serieDe(d, doubles)).filter(Boolean);
    const cles = [], verrous = [];
    for (const d of tous) {
      if (!d || typeof d !== 'object') continue;
      const nom = propre(d.modele || d.chemin || d.id || '');
      if (choisissable(d)) {
        const etat = etatDe(d), serie = serieDe(d, doubles);
        cles.push({ id: String(d.id), nom, sorte: d.genre === 'cle' ? 'cle' : 'disque', taille: taille(d.tailleOctets, lang), bus: busDe(d), serie, serieCourte: serie ? queue(serie, series) : mot('cle.serieInconnue'), etat, contenu: contenu(d, etat, lang), morceaux: occupation(d, lang), brut: d });
      } else {
        verrous.push({ id: String(d.id), nom, taille: taille(d.tailleOctets, lang), bus: busDe(d), systeme: Boolean(d.systemeEnCours) });
      }
    }
    return { cles, verrous };
  }
  /** Choisir une clé : SEULEMENT une clé de la liste choisissable ; tout autre identifiant est refusé. N'écrit rien. */
  function choisir(vue, id) {
    const c = ((vue && vue.cles) || []).find((x) => x.id === String(id));
    return c ? { ok: true, cle: c.id } : { ok: false, raison: mot('cle.refus') };
  }
  /** Le garde-fou de la clé choisie. */
  function garde(c) {
    if (!c) return null;
    if (c.etat === 'odin') return { genre: 'odin', titre: mot('garde.odin.titre'), texte: mot('garde.odin.texte'), points: [], verifier: false };
    if (c.etat === 'vide') return { genre: 'vide', titre: mot('garde.vide.titre'), texte: mot('garde.vide.texte'), points: [], verifier: false };
    return {
      genre: 'efface', titre: mot(c.sorte === 'disque' ? 'garde.efface.titre.disque' : 'garde.efface.titre'), nom: c.nom,
      texte: mot('garde.efface.detail', { bus: c.bus, serie: c.serieCourte, contenu: c.contenu }),
      points: [c.serie ? mot('garde.efface.serie') : mot(c.sorte === 'disque' ? 'garde.efface.sansSerie.disque' : 'garde.efface.sansSerie'), mot('garde.efface.internes')],
      verifier: Boolean(c.serie), bouton: mot(c.sorte === 'disque' ? 'verif.bouton.disque' : 'verif.bouton'), copier: COPIE_POSSIBLE,
    };
  }

  // La vérification en la débranchant : une petite machine à états, nourrie par chaque relecture de la liste.
  //   depart → (la clé n'est plus là) → retour → (le MÊME numéro revient) → ok ; une autre clé → autre (on attend encore).
  const presents = (data) => [...((data && data.externes) || []), ...((data && data.internes) || [])].filter((d) => d && typeof d === 'object');
  const marque = (d) => `${d.id}|${serieBrute(d)}`;
  function debutVerif(c, data, maintenant) {
    if (!c || !c.serie) return null;
    const taille = c.brut ? Number(c.brut.tailleOctets) || 0 : 0;
    return { serie: c.serie, nom: c.nom, sorte: c.sorte, taille, serieCourte: c.serieCourte, id: c.id, phase: 'depart', t0: maintenant, avant: presents(data).map(marque) };
  }
  function suivreVerif(v, data, maintenant) {
    if (!v || v.phase === 'ok' || v.phase === 'delai') return v;
    if (maintenant - v.t0 > VERIF_MAX_MS) return { ...v, phase: 'delai' };
    const liste = presents(data), memes = liste.filter((d) => serieBrute(d) === v.serie);
    if (v.phase === 'depart') {
      if (memes.length) return v;
      // Une lecture ratée rend une liste vide : si TOUS les autres disques ont disparu avec elle, ce n'est pas
      // « elle a été débranchée », on attend la lecture suivante.
      const autres = v.avant.filter((k) => !k.endsWith(`|${v.serie}`)), ici = new Set(liste.map(marque));
      if (autres.length && !autres.some((k) => ici.has(k))) return v;
      return { ...v, phase: 'retour', avant: liste.map(marque) };
    }
    // retour ou autre : le même numéro de série sur UN SEUL disque, qui peut être choisi, et de la même taille.
    const meme = memes.length === 1 ? memes[0] : null;
    if (meme && choisissable(meme) && (!v.taille || Number(meme.tailleOctets) === v.taille)) return { ...v, phase: 'ok', id: String(meme.id) };
    const nouveau = liste.find((d) => !v.avant.includes(marque(d)));
    if (nouveau) { const s = serieBrute(nouveau); return { ...v, phase: 'autre', autre: s && s !== v.serie ? queue(s, [v.serie]) : mot('cle.serieInconnue') }; }
    return v;
  }
  function texteVerif(v) {
    if (!v) return '';
    const sfx = v.sorte === 'disque' ? '.disque' : '';
    if (v.phase === 'depart') return mot('verif.depart', { nom: v.nom, serie: v.serieCourte });
    if (v.phase === 'retour') return mot(`verif.retour${sfx}`);
    if (v.phase === 'autre') return mot(`verif.autre${sfx}`, { autre: v.autre, nom: v.nom });
    if (v.phase === 'ok') return mot(`verif.ok${sfx}`, { serie: v.serieCourte });
    if (v.phase === 'delai') return mot('verif.delai', { min: nombre(Math.round(VERIF_MAX_MS / 60000)) });
    if (v.phase === 'erreur') return mot('verif.erreur');
    return '';
  }
  /** Une étape s'ouvre : la 1 toujours ; la 2 et la 3 une fois la clé choisie ; les suivantes si l'étape 3 est juste ;
   *  la 5 (Options Windows) seulement si un Windows est choisi. */
  const etapeOuverte = (n, cle, systemesPrets = true, avecWindows = true) => n === 1 || (n >= 2 && n <= ETAPES && Boolean(cle) && (n <= 3 || systemesPrets !== false) && (n !== 5 || avecWindows !== false));
  /** Le prochain élément (flèches, Début, Fin) dans une liste, en sautant ceux qui sont fermés. */
  function suivant(i, n, touche, ouvert = () => true) {
    const pas = touche === 'ArrowRight' || touche === 'ArrowDown' ? 1 : touche === 'ArrowLeft' || touche === 'ArrowUp' ? -1 : 0;
    const essais = touche === 'Home' ? [...Array(n).keys()] : touche === 'End' ? [...Array(n).keys()].reverse() : pas ? Array.from({ length: n - 1 }, (_, k) => (i + pas * (k + 1) + n * n) % n) : [];
    return essais.find((j) => ouvert(j)) ?? -1;
  }

  const logique = { MOTS, mot, taille, queue, choisissable, vueDisques, choisir, garde, debutVerif, suivreVerif, texteVerif, etapeOuverte, suivant, ONGLETS, ETAPES, COPIE_POSSIBLE, VERIF_MAX_MS };

  // ---------------------------------------------------------------- la page
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
    return n;
  };
  const P = {
    plus: 'M12 5v14M5 12h14', key: 'M8 2h8v6h-8zM6 8h12v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM10 4v2M14 4v2',
    monitor: 'M3 5h18v11H3zM9 20h6M12 16v4', mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
    disk: 'M4 7h16v10H4zM7 13h3', lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3', warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    check: 'M5 12l5 5L20 7', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6', stop: 'M7 7h10v10H7z', open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  };
  const ic = (n, s = 18, w = 2) => { const v = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('width', s); v.setAttribute('height', s); v.setAttribute('aria-hidden', 'true'); v.innerHTML = `<path d="${P[n]}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`; return v; };
  /** La mascotte : le dessin officiel de la page (deux yeux blancs, sans bouche), copié et animé par face.js. */
  let uid = 0;
  const mascotte = () => {
    const s = el('span', { class: 'ck-odin', 'aria-hidden': 'true' });
    const t = typeof document.querySelector === 'function' ? (document.querySelector('#buddy svg') || document.querySelector('.odin svg')) : null;
    if (!t || typeof t.cloneNode !== 'function') return s;
    const n = ++uid, c = t.cloneNode(true);
    c.querySelectorAll('[id]').forEach((e) => { const o = e.id; e.id = `${o}-ck${n}`; c.querySelectorAll('*').forEach((x) => { for (const a of ['fill', 'filter', 'stroke']) if (x.getAttribute(a) === `url(#${o})`) x.setAttribute(a, `url(#${o}-ck${n})`); }); });
    s.append(c); try { W.OdinFace?.own?.(c); } catch { /* le dessin figé reste */ }
    return s;
  };

  const CSS = `
.ck{display:flex;flex-direction:column;gap:14px;min-width:0}
.ck-h{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.ck-h .ic{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:var(--accent);color:var(--on-accent,#fff);flex:none}
.ck-h h3{margin:0;font-size:20px;letter-spacing:-.01em}.ck-h p{margin:2px 0 0;color:var(--muted);font-size:13px}
.ck-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px;margin:0}.ck-tabs::-webkit-scrollbar{display:none}
.ck-tabs button{border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:999px;padding:0 16px;white-space:nowrap;min-height:44px;font:600 14px inherit;display:inline-flex;align-items:center;gap:8px;cursor:pointer;flex:none}
.ck-tabs button[aria-selected=true]{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.ck-steps{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px;margin:0;list-style:none}.ck-steps::-webkit-scrollbar{display:none}
.ck-steps li{flex:1;min-width:0;display:flex}
.ck-steps button{flex:1;min-width:120px;border:1px solid var(--line);background:var(--panel);border-radius:12px;min-height:52px;padding:6px 12px;text-align:left;display:flex;align-items:center;gap:10px;color:var(--muted);cursor:pointer;font:inherit}
.ck-steps i{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-weight:700;font-size:12px;background:color-mix(in srgb,var(--ink) 7%,transparent);flex:none}
.ck-steps b{display:block;font-size:13px;color:var(--ink);font-weight:600;white-space:nowrap}
.ck-steps span{min-width:0}.ck-steps small{display:block;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ck-steps button[aria-current=step]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.ck-steps button[aria-current=step] i{background:var(--accent);color:var(--on-accent,#fff)}
.ck-steps button.fait i{background:var(--good);color:#fff}
.ck-steps button:disabled{opacity:.5;cursor:default}
.ck-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow,none);padding:18px}
.ck-card>h4{margin:0 0 4px;font-size:17px;letter-spacing:-.01em}.ck-lead{margin:0 0 14px;color:var(--muted);font-size:13px}
.ck-h5{font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:18px 0 8px;display:flex;align-items:center;gap:8px}
.ck-cnt{font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink);letter-spacing:0;text-transform:none}
.ck-disks{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px}
.ck-disk{position:relative;text-align:left;border:1.5px solid var(--line);background:var(--panel);color:var(--ink);border-radius:16px;padding:14px;display:flex;gap:12px;align-items:flex-start;width:100%;font:inherit;cursor:pointer;min-height:44px}
.ck-disk[aria-checked=true]{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
.ck-disk .lg{width:48px;height:48px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--accent);flex:none}
.ck-disk .in{flex:1;min-width:0;padding-right:28px}
.ck-disk b{font-size:15px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ck-sub{display:block;font-size:12.5px;color:var(--muted);margin:2px 0 8px;overflow-wrap:anywhere}
.ck-disk .tick{position:absolute;top:12px;right:12px;width:24px;height:24px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center}
.ck-disk[aria-checked=true] .tick{background:var(--accent);border-color:var(--accent);color:var(--on-accent,#fff)}
.ck-disk.lock{opacity:.7;border-style:dashed;cursor:not-allowed;background:none;box-shadow:none}
.ck-disk.lock .lg{color:var(--muted)}
.ck-tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink);white-space:nowrap}
.ck-tag.ok{background:color-mix(in srgb,var(--good) 16%,transparent);color:var(--good)}
.ck-bar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:color-mix(in srgb,var(--ink) 9%,transparent)}
.ck-bar i{display:block;height:100%}
.ck-s-odin{background:var(--good)}.ck-s-donnees{background:color-mix(in srgb,var(--ink) 38%,transparent)}.ck-s-efi{background:color-mix(in srgb,var(--ink) 22%,transparent)}.ck-s-systeme{background:color-mix(in srgb,var(--accent) 60%,transparent)}.ck-s-libre{background:transparent}
.ck-leg{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;font-size:11.5px;color:var(--muted)}.ck-leg span{display:inline-flex;align-items:center;gap:5px}.ck-leg em{width:9px;height:9px;border-radius:3px}
.ck-leg .ck-s-libre{background:color-mix(in srgb,var(--ink) 9%,transparent)}
.ck-guard{grid-column:1/-1;display:flex;gap:14px;align-items:flex-start;padding:16px;border-radius:16px;border:2px solid var(--bad);background:var(--bad-bg,color-mix(in srgb,var(--bad) 10%,var(--panel)));color:var(--ink)}
.ck-guard.calm{border-color:var(--good);background:color-mix(in srgb,var(--good) 10%,var(--panel))}
.ck-guard .gi{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:var(--bad);color:#fff;flex:none}
.ck-guard.calm .gi{background:var(--good)}
.ck-guard>div{min-width:0;flex:1}.ck-guard b{font-size:15px;display:block}.ck-guard p{margin:4px 0 0;font-size:13px;overflow-wrap:anywhere}
.ck-guard ul{margin:6px 0 0;padding-left:18px;font-size:13px}
.ck-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
.ck-btn{min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:600 14px inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;text-align:left}
.ck-btn.pri{background:var(--accent);color:var(--on-accent,#fff);border-color:transparent}
.ck-btn:disabled{opacity:.45;cursor:not-allowed}
.ck-verif{margin:10px 0 0;padding:10px 12px;border-radius:12px;background:var(--panel);border:1px solid var(--line);font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ck-verif.ok{border-color:var(--good);color:var(--good);font-weight:600}.ck-verif.ko{border-color:var(--bad);color:var(--bad);font-weight:600}
.ck-verif span{flex:1;min-width:160px}
.ck-msg{margin:0 0 12px;font-size:13px;color:var(--muted)}.ck-msg.ko{color:var(--bad);font-weight:600}
.ck-foot{position:sticky;bottom:0;display:flex;gap:10px;align-items:center;justify-content:flex-end;padding:12px 0 4px;background:linear-gradient(transparent,var(--bg) 30%);z-index:3;flex-wrap:wrap}
.ck-foot .grow{flex:1;min-width:140px;font-size:12.5px;color:var(--muted)}
.ck-soon{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.ck-soon>div{flex:1;min-width:220px}.ck-soon p{margin:4px 0 0;font-size:13.5px}.ck-soon .m{color:var(--muted);font-size:13px}
.ck-odin{width:64px;height:64px;flex:none;display:inline-block;border-radius:50%;background:var(--accent)}
.ck-odin svg{width:100%;height:100%;display:block}
.ck-odin:has(svg){background:none}
.ck-avant{margin-top:4px}
@media (max-width:640px){
  .ck-card{padding:14px}.ck-h h3{font-size:18px}
  .ck-disks{grid-template-columns:1fr}
  .ck-steps li{flex:none}
  .ck-steps button{min-width:auto;flex:none;padding:6px 10px}
  .ck-steps button span{display:none}.ck-steps button[aria-current=step] span{display:block}
  .ck-steps small{max-width:110px}
  .ck-guard{flex-direction:column}
  .ck-foot{flex-wrap:nowrap}.ck-foot .grow{display:none}.ck-foot .ck-btn{flex:1}
}
@media (prefers-reduced-motion:reduce){.ck *{transition:none!important;animation:none!important}}
`;

  // L'état du parcours, gardé quand on change d'onglet de Genèse.
  const S = { onglet: 'deployer', etape: 1, cle: null, choix: null, data: null, vue: { cles: [], verrous: [] }, charge: true, erreur: '', msg: '', verif: null, signature: '' };
  let C = null; // { wrap, outils, minuteur, verifMinuteur }
  /** Les étapes 2 et 3 (lot C2), si elles sont chargées. */
  const SYS = () => (W.OdinGeneseCleSystemes && typeof W.OdinGeneseCleSystemes.rendre === 'function' ? W.OdinGeneseCleSystemes : null);
  /** Les étapes 4 et 5 (lot C3), si elles sont chargées. */
  const LOG = () => (W.OdinGeneseCleLogiciels && typeof W.OdinGeneseCleLogiciels.rendre === 'function' ? W.OdinGeneseCleLogiciels : null);
  /** Un Windows est-il choisi ? (sans le lot C3 chargé : l'étape 5 reste ouverte, comme avant) */
  const avecWindows = () => { const l = LOG(); return !l || typeof l.aWindows !== 'function' || l.aWindows(); };
  /** L'étape n peut-elle s'ouvrir maintenant ? */
  const ouverte = (n) => etapeOuverte(n, S.cle, prets(), avecWindows());
  /** L'étape 3 est-elle juste POUR LA CLÉ CHOISIE MAINTENANT ? (sans le lot C2 chargé : rien ne bloque, comme avant) */
  const prets = () => {
    const s = SYS();
    if (!s || typeof s.pret !== 'function') return true;
    const c = S.vue.cles.find((x) => x.id === S.cle);
    return Boolean(c) && s.pret(c.brut);
  };
  /** L'empreinte de la clé choisie : si un AUTRE disque prend son identifiant (/dev/sdb, PhysicalDrive2 réutilisés), ce n'est pas elle. */
  const empreinte = (c) => ({ serie: c.serie, taille: c.brut ? Number(c.brut.tailleOctets) || 0 : 0, nom: c.nom, sorte: c.sorte });
  const memeCle = (a, c) => { const b = empreinte(c); return a.serie === b.serie && a.taille === b.taille && a.nom === b.nom; };
  const verifEnCours = () => Boolean(S.verif && ['depart', 'retour', 'autre'].includes(S.verif.phase));

  const signature = (data) => JSON.stringify(presents(data).map((d) => [d.id, serieBrute(d), d.modele, d.tailleOctets, Boolean(d.estOdin), d.externe, d.systemeEnCours, (d.partitions || []).map((p) => [p.label, p.tailleOctets, p.utiliseOctets])]));

  /** Une seule lecture de la liste à la fois (une lecture lance plusieurs commandes du système : jamais empilées). */
  let vol = null;
  async function lireUnique() {
    if (vol) return null;
    vol = lire();
    try { return await vol; } finally { vol = null; }
  }
  async function lire() {
    let r;
    try { r = await C.outils.post('cle_disques'); } catch (e) { r = { ok: false, text: String(e && e.message || e) }; }
    if (!r || r.ok === false || !r.data) return { erreur: (r && r.text) || '?' };
    return { data: r.data };
  }
  function appliquer(data) {
    S.data = data; S.vue = vueDisques(data, langue()); S.charge = false; S.erreur = '';
    if (!S.cle || verifEnCours()) return;
    const c = S.vue.cles.find((x) => x.id === S.cle);
    if (!c || (S.choix && !memeCle(S.choix, c))) { S.msg = mot(S.choix && S.choix.sorte === 'disque' ? 'cle.partie.disque' : 'cle.partie'); S.cle = null; S.choix = null; if (S.etape > 1) S.etape = 1; return; }
    if (!S.choix) S.choix = empreinte(c);
  }
  async function relire(force) {
    if (vol) { if (!force) return; try { await vol; } catch { /* la suivante dira */ } }
    const r = await lireUnique();
    if (!r) return;
    if (r.erreur) { if (S.charge || force) { S.charge = false; S.erreur = mot('cle.erreur', { raison: r.erreur }); dessiner(); } return; }
    const sig = signature(r.data);
    if (!force && sig === S.signature) return;
    S.signature = sig; appliquer(r.data); dessiner();
  }

  // ------------------------------------------------ dessins
  function onglets() {
    const ICON = { deployer: 'plus', mescles: 'key', demarrage: 'monitor', parole: 'mic' };
    const liste = el('div', { class: 'ck-tabs', role: 'tablist', 'aria-label': mot('onglets.nom') });
    ONGLETS.forEach((id, i) => liste.append(el('button', {
      type: 'button', role: 'tab', id: `ck-tab-${id}`, 'data-f': `tab-${id}`, 'aria-selected': String(S.onglet === id), 'aria-controls': 'ck-panneau', tabindex: S.onglet === id ? '0' : '-1',
      onclick: () => { S.onglet = id; dessiner(`tab-${id}`); },
      onkeydown: (e) => { const j = suivant(i, ONGLETS.length, e.key); if (j < 0) return; e.preventDefault(); S.onglet = ONGLETS[j]; dessiner(`tab-${ONGLETS[j]}`); },
    }, ic(ICON[id]), mot(`onglet.${id}`))));
    return liste;
  }
  function etapes() {
    const ol = el('ol', { class: 'ck-steps', 'aria-label': mot('etapes.nom') });
    for (let n = 1; n <= ETAPES; n++) {
      const ouv = ouverte(n), courante = n === S.etape, faite = n < S.etape && ouv;
      const sorte = (S.vue.cles.find((x) => x.id === S.cle) || {}).sorte;
      const fermee = !S.cle || !SYS() ? mot('etape.fermee') : SYS().MOTS[sorte === 'disque' ? 'etape.fermee.disque' : 'etape.fermee'] || SYS().MOTS['etape.fermee'];
      ol.append(el('li', {}, el('button', {
        type: 'button', 'data-f': `etape-${n}`, 'data-etape': String(n), 'aria-current': courante ? 'step' : null, class: faite ? 'fait' : null, disabled: !ouv,
        title: ouv ? null : fermee, 'aria-label': `${mot(`etape.${n}`)} · ${mot('etape.position', { n: nombre(n, langue()), total: nombre(ETAPES, langue()) })}`,
        onclick: () => { if (!ouverte(n)) return; S.etape = n; dessiner(`etape-${n}`); },
        onkeydown: (e) => { const j = suivant(n - 1, ETAPES, e.key, (k) => ouverte(k + 1)); if (j < 0) return; e.preventDefault(); focaliser(`etape-${j + 1}`); },
      }, el('i', {}, faite ? ic('check', 14, 3) : nombre(n, langue())), el('span', {}, el('b', {}, mot(`etape.${n}`)), el('small', {}, mot(`etape.${n}.sous`))))));
    }
    return ol;
  }
  function barre(c) {
    return [el('span', { class: 'ck-bar', 'aria-hidden': 'true' }, ...c.morceaux.map((m) => el('i', { class: `ck-s-${m.genre}`, style: `width:${m.pct.toFixed(2)}%` }))),
      el('span', { class: 'ck-leg' }, ...c.morceaux.map((m) => el('span', {}, el('em', { class: `ck-s-${m.genre}` }), m.legende)))];
  }
  function carte(c, i, cles) {
    const choisie = S.cle === c.id, focusable = choisie || (!S.cle && i === 0);
    return el('button', {
      type: 'button', class: 'ck-disk', role: 'radio', 'aria-checked': String(choisie), 'data-f': `cle-${c.id}`, 'data-cle': c.id, tabindex: focusable ? '0' : '-1',
      onclick: () => prendre(c.id),
      onkeydown: (e) => { const j = suivant(i, cles.length, e.key); if (j < 0) return; e.preventDefault(); prendre(cles[j].id); },
    }, el('span', { class: 'lg' }, ic(c.brut && c.brut.genre === 'cle' ? 'key' : 'disk', 28)),
    el('span', { class: 'in' },
      el('b', {}, c.nom, c.etat === 'odin' ? el('span', { class: 'ck-tag ok' }, mot('cle.tag.odin')) : null),
      el('span', { class: 'ck-sub' }, mot('cle.sous', { taille: c.taille, bus: c.bus, serie: c.serieCourte })),
      ...barre(c),
      el('span', { class: 'ck-sub', style: 'margin:6px 0 0' }, c.contenu)),
    el('span', { class: 'tick' }, choisie ? ic('check', 14, 3) : null));
  }
  function gardeFou(c) {
    const g = garde(c);
    if (!g) return null;
    const verif = S.verif && S.verif.serie === c.serie ? S.verif : null;
    const ligneVerif = verif ? el('div', { class: `ck-verif${verif.phase === 'ok' ? ' ok' : verif.phase === 'autre' || verif.phase === 'delai' || verif.phase === 'erreur' ? ' ko' : ''}`, role: 'status', 'aria-live': 'polite' },
      el('span', {}, texteVerif(verif)),
      verif.phase === 'ok' || verif.phase === 'delai' || verif.phase === 'erreur' ? null : el('button', { type: 'button', class: 'ck-btn', 'data-f': 'verif-stop', onclick: () => arreterVerif() }, ic('stop'), mot('verif.arreter'))) : null;
    if (g.genre !== 'efface') {
      return el('div', { class: 'ck-guard calm', role: 'status' }, el('span', { class: 'gi' }, ic('shield', 24)), el('div', {}, el('b', {}, g.titre), el('p', {}, g.texte)));
    }
    return el('div', { class: 'ck-guard', role: 'alert' }, el('span', { class: 'gi' }, ic('warn', 24)), el('div', {},
      el('b', {}, g.titre), el('p', {}, el('strong', {}, g.nom), ' · ', g.texte),
      el('ul', {}, ...g.points.map((p) => el('li', {}, p))),
      el('div', { class: 'ck-row' },
        g.verifier ? el('button', { type: 'button', class: 'ck-btn', 'data-f': 'verif', disabled: Boolean(verif && verif.phase !== 'ok' && verif.phase !== 'delai' && verif.phase !== 'erreur'), onclick: () => lancerVerif(c) }, ic('eye'), g.bouton) : null),
      ligneVerif));
  }
  function etapeCle() {
    const sec = el('section', { class: 'ck-card' }, el('h4', {}, mot('cle.titre')), el('p', { class: 'ck-lead' }, ...mot('cle.lead', { nom: '|ODIN|' }).split('|ODIN|').flatMap((x, i) => (i ? [el('strong', {}, mot('cle.nom')), x] : [x]))));
    if (S.msg) sec.append(el('p', { class: 'ck-msg ko', role: 'status' }, S.msg));
    if (S.erreur) sec.append(el('p', { class: 'ck-msg ko', role: 'alert' }, S.erreur));
    else if (S.charge) sec.append(el('p', { class: 'ck-msg', role: 'status' }, mot('cle.charge')));
    const cles = S.vue.cles;
    if (!S.charge && !S.erreur && !cles.length) sec.append(el('p', { class: 'ck-msg', role: 'status' }, mot('cle.aucune')));
    if (cles.length) {
      const groupe = el('div', { class: 'ck-disks', role: 'radiogroup', 'aria-label': mot('cle.groupe') });
      cles.forEach((c, i) => { groupe.append(carte(c, i, cles)); if (c.id === S.cle) groupe.append(gardeFou(c)); });
      sec.append(groupe);
    }
    if (S.vue.verrous.length) {
      sec.append(el('div', { class: 'ck-h5' }, mot('internes.titre'), el('span', { class: 'ck-cnt' }, nombre(S.vue.verrous.length, langue()))),
        el('div', { class: 'ck-disks' }, ...S.vue.verrous.map((v) => el('div', { class: 'ck-disk lock', 'aria-disabled': 'true', 'data-verrou': v.id },
          el('span', { class: 'lg' }, ic('lock', 26)),
          el('span', { class: 'in', style: 'padding-right:0' }, el('b', {}, v.nom, el('span', { class: 'ck-tag' }, mot(v.systeme ? 'internes.tag.systeme' : 'internes.tag.interne'))),
            el('span', { class: 'ck-sub' }, mot('verrou.sous', { taille: v.taille, bus: v.bus })),
            el('span', { class: 'ck-sub', style: 'margin:0' }, mot(v.systeme ? 'internes.jamaisSysteme' : 'internes.jamais')))))));
    }
    return [sec, pied(0, 2, !S.cle, S.cle ? '' : mot('pied.choisir'))];
  }
  function pied(avant, apres, ferme, aide) {
    return el('div', { class: 'ck-foot' }, el('span', { class: 'grow' }, aide || ''),
      avant ? el('button', { type: 'button', class: 'ck-btn', 'data-f': 'retour', onclick: () => { S.etape = avant; dessiner(`etape-${avant}`); } }, ic('left'), mot('pied.retour')) : null,
      apres ? el('button', { type: 'button', class: 'ck-btn pri', 'data-f': 'continuer', disabled: ferme, onclick: (e) => { const b = e && (e.currentTarget || e.target); if (b && b.getAttribute && b.getAttribute('disabled') != null) return; if (!ouverte(apres)) return; S.etape = apres; dessiner(`etape-${apres}`); } }, mot('pied.continuer'), ic('right')) : null);
  }
  function bientot(texte, ...plus) {
    return el('section', { class: 'ck-card ck-soon' }, mascotte(), el('div', {}, el('b', {}, mot('bientot.titre')), el('p', {}, texte), ...plus));
  }
  function etapeBientot(n) {
    const c = S.vue.cles.find((x) => x.id === S.cle), comp = W.OdinGeneseCleComposer;
    const ouvrir = c && comp && typeof comp.ouvrir === 'function'
      ? el('div', { class: 'ck-row' }, el('button', { type: 'button', class: 'ck-btn pri', 'data-f': 'composeur', onclick: async () => {
        // Juste avant d'ouvrir : la liste est relue ; si la clé n'est plus là, ou qu'un autre disque a pris sa place, on s'arrête.
        await relire(true);
        const ici = S.vue.cles.find((x) => x.id === S.cle);
        if (!ici) { dessiner(); return; }
        // Les systèmes déjà choisis aux étapes 2 et 3 sont repris dans le composeur, avec les logiciels cochés pour
        // chacun à l'étape 4 ; tes scripts acceptés et les options Windows (étapes 4 et 5) l'accompagnent.
        const composes = SYS() ? SYS().composes() : undefined;
        const suite = composes && LOG() ? LOG().pourComposeur(composes) : null;
        await comp.ouvrir(ici.brut, { post: C.outils.post, act: C.outils.act, systemes: suite ? suite.systemes : composes, ...(suite ? { scripts: suite.scripts, windows: suite.windows } : {}) }); void relire(true);
      } }, ic('open'), mot('bientot.ouvrir', { nom: c.nom })))
      : null;
    return [el('section', { class: 'ck-card' }, el('h4', {}, mot(`etape.${n}`)), el('p', { class: 'ck-lead', style: 'margin:0' }, mot(`etape.${n}.sous`))),
      bientot(mot('bientot.etape'), el('p', { class: 'm' }, mot('bientot.composeur')), ouvrir),
      pied(n - 1, n < ETAPES ? n + 1 : 0, false, '')];
  }
  function panneau() {
    if (S.onglet === 'deployer') {
      const c = S.vue.cles.find((x) => x.id === S.cle);
      if ((S.etape === 2 || S.etape === 3) && SYS() && c) {
        return [etapes(), ...SYS().rendre(S.etape, { cle: c.brut, sorte: c.sorte, post: C.outils.post, redessiner: (f) => dessiner(f), pied, wrap: C.wrap })];
      }
      if ((S.etape === 4 || S.etape === 5) && LOG() && c) {
        // Plus de Windows choisi (retiré à l'étape 3) : l'étape 5 n'a plus lieu d'être, on revient à l'étape 4.
        if (S.etape === 5 && !avecWindows()) S.etape = 4;
        return [etapes(), ...LOG().rendre(S.etape, { cle: c.brut, sorte: c.sorte, post: C.outils.post, redessiner: (f) => dessiner(f), pied, wrap: C.wrap })];
      }
      return [etapes(), ...(S.etape === 1 ? etapeCle() : etapeBientot(S.etape))];
    }
    if (S.onglet === 'mescles') {
      const avant = el('div', { class: 'ck-avant' });
      if (C.outils.ancienne) void C.outils.ancienne(avant);
      return [bientot(mot('bientot.mescles'), el('p', { class: 'm' }, mot('bientot.mescles.avant'))), avant];
    }
    if (S.onglet === 'demarrage') {
      const menu = W.OdinGeneseCleMenu;
      return [bientot(mot('bientot.demarrage'), menu && typeof menu.ouvrir === 'function' ? el('div', { class: 'ck-row' }, el('button', { type: 'button', class: 'ck-btn', 'data-f': 'apercu', onclick: () => menu.ouvrir([], { demo: 8, mascotteAccueil: true }) }, ic('eye'), mot('bientot.demarrage.apercu'))) : null)];
    }
    return [bientot(mot('bientot.parole'))];
  }
  function focaliser(f) {
    if (!f || !C) return;
    const sel = typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function' ? CSS.escape(f) : String(f).replace(/["\\]/g, '\\$&');
    let n = null;
    try { n = C.wrap.querySelector(`[data-f="${sel}"]`); } catch { n = null; }
    if (n && typeof n.focus === 'function') n.focus();
  }
  function dessiner(focus) {
    if (!C) return;
    const actif = focus || (typeof document !== 'undefined' && document.activeElement && C.wrap.contains?.(document.activeElement) ? document.activeElement.getAttribute?.('data-f') : null);
    C.wrap.replaceChildren(
      el('div', { class: 'ck-h' }, el('span', { class: 'ic' }, ic('key', 26)), el('div', { style: 'flex:1;min-width:200px' }, el('h3', {}, mot('tete.titre')), el('p', {}, mot('tete.sous')))),
      onglets(),
      el('div', { id: 'ck-panneau', role: 'tabpanel', 'aria-labelledby': `ck-tab-${S.onglet}`, class: 'ck' }, ...panneau()),
    );
    if (actif) focaliser(actif);
  }

  // ------------------------------------------------ actions
  function prendre(id) {
    const r = choisir(S.vue, id);
    if (!r.ok) { S.msg = r.raison; dessiner(); return r; }
    if (S.cle !== r.cle) { S.cle = r.cle; S.msg = ''; if (S.verif && S.verif.id !== r.cle) arreterVerif(true); }
    const c = S.vue.cles.find((x) => x.id === r.cle);
    if (c) S.choix = empreinte(c);
    dessiner(`cle-${r.cle}`);
    return r;
  }
  function arreterVerif(sansDessin) {
    if (C && C.verifMinuteur) { clearInterval(C.verifMinuteur); C.verifMinuteur = 0; }
    S.verif = null;
    if (!sansDessin) dessiner('verif');
  }
  async function tourVerif() {
    if (!C || !S.verif) return;
    if (!C.wrap.isConnected) { arreterVerif(true); return; }
    const r = await lireUnique();
    if (!r || !S.verif) return;
    if (r.erreur) { S.verif = { ...S.verif, phase: 'erreur' }; }
    else {
      S.signature = signature(r.data);
      const v = suivreVerif(S.verif, r.data, Date.now());
      S.verif = v;
      // Pendant la vérification, la page garde la carte et son garde-fou tels quels (la clé peut être partie) ; la
      // liste n'est reprise qu'une fois la même clé revenue.
      if (v.phase === 'ok') { S.cle = v.id; S.choix = null; appliquer(r.data); S.msg = ''; }
    }
    if (['ok', 'delai', 'erreur'].includes(S.verif.phase) && C.verifMinuteur) { clearInterval(C.verifMinuteur); C.verifMinuteur = 0; }
    dessiner();
  }
  function lancerVerif(c) {
    const v = debutVerif(c, S.data, Date.now());
    if (!v) return;
    if (C.verifMinuteur) clearInterval(C.verifMinuteur);
    S.verif = v; dessiner('verif-stop');
    C.verifMinuteur = setInterval(() => { void tourVerif(); }, 1000);
  }

  /** Monte le parcours dans « wrap ». outils : { post, act, ancienne(noeud) } (ancienne : les disques comme avant). */
  async function monter(wrap, outils) {
    if (typeof document !== 'undefined' && document.head && !document.getElementById?.('ckCss')) document.head.append(el('style', { id: 'ckCss' }, CSS));
    if (C && C.minuteur) clearInterval(C.minuteur);
    if (C && C.verifMinuteur) clearInterval(C.verifMinuteur);
    const moi = { wrap, outils, minuteur: 0, verifMinuteur: 0 };
    C = moi;
    wrap.classList?.add('ck');
    S.signature = ''; S.verif = null;
    if (!S.data) S.charge = true;
    dessiner();
    await relire(true);
    // Genèse a redessiné l'onglet pendant la lecture : c'est le nouveau montage qui relit, pas celui-ci.
    if (C !== moi) return;
    // Odin voit la clé arriver toute seule : on relit la liste (lecture seule) toutes les 3 s, tant que la page est là,
    // aux étapes 1 à 3 (une clé débranchée pendant le choix des systèmes est vue : retour à l'étape 1). La page n'est
    // redessinée que si la liste a changé.
    const h = setInterval(() => {
      if (C !== moi || !wrap.isConnected) { clearInterval(h); if (C === moi && moi.verifMinuteur) { clearInterval(moi.verifMinuteur); moi.verifMinuteur = 0; } return; }
      if ((typeof document !== 'undefined' && document.hidden) || verifEnCours() || S.onglet !== 'deployer' || S.etape > 3) return;
      void relire(false);
    }, 3000);
    moi.minuteur = h;
  }

  // « choisir » : la même porte que le clic sur une carte (une demande directe pour un disque interne est refusée).
  W.OdinGeneseCleEtapes = { MOTS, logique, monter, choisir: prendre, etat: S };
})();
