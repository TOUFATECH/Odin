// Espace « Automatisations » : Talos, le moteur d'automatisations d'Odin. Liste, création en une
// phrase, modèles (dont ceux qui relient les applis), éditeur à nœuds (glisser, relier, régler),
// test pas à pas, historique des exécutions et versions.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const sv = (t, a = {}) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };

  // ---------------- Le « + » : où poser un bloc, à quoi le relier (fonctions pures, sans document).
  const NODE_W = 190, PAS_X = 280, PAS_Y = 110;
  const RAISON_GRAVE = 'Action grave : elle demande ton accord et ne part pas d\'une automatisation.';
  /** Les réglages qui ont une valeur par défaut (`sansVide` : sauf la chaîne vide). */
  const parDefaut = (params, sansVide = false) => Object.fromEntries((params ?? []).filter((p) => p.default !== undefined && !(sansVide && p.default === '')).map((p) => [p.key, p.default]));
  /** Un nom pas encore pris : « Nom », sinon « Nom 2 », « Nom 3 »… */
  function nomLibre(nodes, base) { let name = base, k = 2; while (nodes.some((n) => n.name === name)) name = `${base} ${k++}`; return name; }
  /** Une place libre : [x, y], sinon plus bas, jusqu'à ne recouvrir aucun bloc. */
  function placeLibre(nodes, x, y) {
    let yy = Math.round(y);
    for (let i = 0; i < 40 && nodes.some((n) => Math.abs((n.position?.[0] ?? 0) - x) < NODE_W + 20 && Math.abs((n.position?.[1] ?? 0) - yy) < 90); i++) yy += PAS_Y;
    return [Math.round(x), yy];
  }
  /** La sortie d'où part le « + » d'un bloc : la première qui n'a pas encore de lien, sinon la première. */
  function sortieDuPlus(wf, nom, sorties = 1) { const c = wf.connections?.[nom] ?? []; for (let i = 0; i < sorties; i++) if (!(c[i] ?? []).length) return i; return 0; }
  /** Fenêtre vide : le premier bloc dit quand l'automatisation part (un déclencheur) ; sinon, ce qu'elle fait ensuite. */
  const modeChoix = (wf) => (wf.nodes.length ? 'faire' : 'quand');
  /** Le bloc d'une fonction d'appli ; refusé si elle est grave (elle ne part pas d'une automatisation). */
  function blocFonction(appli, f) {
    if (!appli?.id || !f?.id) return { ok: false, error: 'Choisis une appli et une de ses fonctions.' };
    if (f.grave) return { ok: false, error: f.raison || RAISON_GRAVE };
    return { ok: true, bloc: { name: `${appli.nom} · ${f.label}`, type: 'module.action', params: { module: appli.id, action: f.id, entrée: JSON.stringify(parDefaut(f.params, true)) } } };
  }
  /** Le déclencheur « quand une appli signale » : ev '' = tout ce qu'elle signale, 'alerte' = ses alertes. */
  function blocSignal(appli, ev = '') {
    const name = ev === 'alerte' ? `Quand ${appli.nom} lance une alerte` : ev ? `Quand ${appli.nom} signale « ${ev} »` : `Quand ${appli.nom} signale`;
    return { ok: true, bloc: { name, type: 'déclencheur.module', trigger: true, params: { module: appli.id, événement: ev, niveau: 'haute' } } };
  }
  /** Le bloc d'un outil du catalogue de Talos (Si, Attendre, Aiguillage…). */
  const blocOutil = (c) => ({ ok: true, bloc: { name: c.label, type: c.type, trigger: Boolean(c.trigger), params: parDefaut(c.params) } });
  function relier(wf, from, out, to) {
    if (from === to) return false;
    const c = wf.connections[from] ?? (wf.connections[from] = []);
    while (c.length <= out) c.push([]);
    if (!c[out].some((l) => l.node === to)) c[out].push({ node: to });
    return true;
  }
  // ---------------- Les fils (fonctions pures) : insérer un bloc au milieu, retirer, les refus d'un lien, la cible.
  /** Pourquoi le lien de → vers (sortie `out`) est refusé ; '' s'il est permis. Les mêmes refus pour les deux touchers et le fil tiré. */
  function refusLien(wf, de, out, vers, declencheur) {
    if (de === vers) return 'Un bloc ne se relie pas à lui-même.';
    if (declencheur) return 'Un déclencheur ne reçoit pas de lien : c\'est lui qui fait partir l\'automatisation.';
    if ((wf.connections[de]?.[out] ?? []).some((l) => l?.node === vers)) return 'Ces deux blocs sont déjà reliés par cette sortie.';
    return '';
  }
  /** Retire le fil de → vers de la sortie `out` (lui seul). → true s'il existait. */
  function retirerLien(wf, de, out, vers) {
    const t = wf.connections[de]?.[out], i = (t ?? []).findIndex((l) => l?.node === vers);
    if (i < 0) return false;
    t.splice(i, 1); return true;
  }
  /**
   * « Ajouter un bloc ici » sur un fil : le bloc choisi est posé entre les deux (à mi-chemin, plus bas si la place
   * est prise) ; le fil de → vers devient de → bloc (même sortie, même place) et bloc → vers (par sa première sortie,
   * avec l'entrée d'origine). Un déclencheur ne se met pas au milieu. → { ok, name } ou { ok: false, error }.
   */
  function inserer(wf, choix, fil) {
    if (!choix?.ok) return { ok: false, error: choix?.error ?? 'Rien à ajouter.' };
    const b = choix.bloc;
    if (b.trigger) return { ok: false, error: 'Un déclencheur ne se met pas au milieu d\'un fil : c\'est lui qui fait partir l\'automatisation.' };
    const a = wf.nodes.find((n) => n.name === fil?.de), z = wf.nodes.find((n) => n.name === fil?.vers);
    const t = a && z ? wf.connections[a.name]?.[fil.out] : null, j = (t ?? []).findIndex((l) => l?.node === z?.name);
    if (j < 0) return { ok: false, error: 'Ce lien n\'existe plus.' };
    const name = nomLibre(wf.nodes, b.name);
    const pa = a.position ?? [0, 0], pz = z.position ?? [0, 0];
    const position = placeLibre(wf.nodes, ((pa[0] ?? 0) + (pz[0] ?? 0)) / 2, ((pa[1] ?? 0) + (pz[1] ?? 0)) / 2);
    wf.nodes.push({ name, type: b.type, params: b.params, position });
    const ancien = t[j];
    t[j] = { node: name };
    wf.connections[name] = [[{ ...ancien }]]; // (nom neuf : aucun lien n'en partait)
    return { ok: true, name };
  }
  /** La zone de toucher, en pixels du schéma, pour qu'elle fasse `px` pixels à l'écran au zoom `k` (jamais moins que `px`). */
  const zoneToucher = (k, px = 44) => Math.max(px, px / (k > 0 ? k : 1));
  /** Le style du rond de sortie i sur m : centré à 27 + 22 i ; entre deux sorties voisines, la zone s'arrête à mi-chemin (11 px). */
  const styleSortie = (i, m) => `top:calc(${27 + 22 * i}px - var(--dh))${i > 0 ? ';--dh:11px' : ''}${i < m - 1 ? ';--db:11px' : ''}`;
  /** Le bloc sous le point (x, y) de l'écran parmi `boites` ({ name, left, top, width, height }) : le dernier dessiné l'emporte. */
  function blocSous(boites, x, y) {
    for (let i = (boites ?? []).length - 1; i >= 0; i--) { const b = boites[i]; if (x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height) return b.name; }
    return null;
  }
  /**
   * Pose un bloc. Depuis le « + » d'un bloc (`de` : { node, out }) : à droite de lui (plus bas si la place est prise)
   * et relié à lui. Depuis le « + » central ou un double-clic (`a` : [x, y]) : posé là, sans lien.
   * → { ok: true, name, lien? } ou { ok: false, error }.
   */
  function poser(wf, choix, { de, a } = {}) {
    if (!choix?.ok) return { ok: false, error: choix?.error ?? 'Rien à ajouter.' };
    const b = choix.bloc, depart = de ? wf.nodes.find((n) => n.name === de.node) : null;
    if (de && !depart) return { ok: false, error: 'Ce bloc n\'existe plus.' };
    const name = nomLibre(wf.nodes, b.name);
    const position = depart ? placeLibre(wf.nodes, (depart.position?.[0] ?? 0) + PAS_X, depart.position?.[1] ?? 0) : placeLibre(wf.nodes, a?.[0] ?? 60, a?.[1] ?? 160);
    wf.nodes.push({ name, type: b.type, params: b.params, position });
    if (depart && !b.trigger) { const out = de.out ?? 0; relier(wf, depart.name, out, name); return { ok: true, name, lien: { de: depart.name, out } }; }
    return { ok: true, name };
  }
  // ---------------- Le bloc d'appli lisible : son appli, sa fonction et ses réglages en vrais champs (fonctions pures).
  // La forme enregistrée ne change pas : module, action, entrée (texte JSON, ou objet s'il était rangé ainsi).
  const vide = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
  const sansAccents = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  /** L'appli d'un bloc : par son identifiant, sinon par son nom ou son identifiant sans accents ni majuscules. */
  function appliDe(liste, ref) {
    if (!Array.isArray(liste) || typeof ref !== 'string' || !ref.trim()) return null;
    const n = sansAccents(ref);
    return liste.find((a) => a.id === ref) ?? liste.find((a) => sansAccents(a.id) === n || sansAccents(a.nom) === n) ?? null;
  }
  const fonctionDe = (a, id) => (typeof id === 'string' && (a?.actions ?? []).find((f) => f.id === id)) || null;
  /** Ce que dit un bloc d'appli (null : pas un bloc d'appli, ou appli ou fonction introuvable → il garde son dessin d'avant). */
  function infoAppli(n, liste) {
    const a = n && (n.type === 'module.action' || n.type === 'déclencheur.module') ? appliDe(liste, n.params?.module) : null;
    if (!a) return null;
    if (n.type === 'module.action') { const f = fonctionDe(a, n.params?.action); return f ? { a, f, titre: f.label, auto: `${a.nom} · ${f.label}` } : null; }
    const ev = n.params?.['événement'] ?? '';
    if (typeof ev !== 'string') return null;
    return { a, titre: ev === 'alerte' ? 'Quand elle lance une alerte' : ev ? `Quand elle signale « ${ev} »` : 'Quand elle signale quelque chose', auto: blocSignal(a, ev).bloc.name };
  }
  /** Les réglages rangés dans l'entrée d'un bloc : { ok, valeurs } ; ok false quand ce n'est pas un objet (expression, liste, JSON invalide). */
  function lireEntree(raw) {
    if (vide(raw)) return { ok: true, valeurs: {} };
    let v = raw;
    if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return { ok: false }; } }
    // Un entier trop grand pour être relu exactement serait abîmé en réécrivant l'entrée : il reste au JSON avancé.
    return v && typeof v === 'object' && !Array.isArray(v) && !entierAbime(v) ? { ok: true, valeurs: v } : { ok: false };
  }
  function entierAbime(v, prof = 0) {
    if (typeof v === 'number') return Number.isInteger(v) && !Number.isSafeInteger(v);
    return Boolean(v && typeof v === 'object' && prof < 50 && Object.values(v).some((x) => entierAbime(x, prof + 1)));
  }
  /** Le champ qui montre une valeur : celui de son type, en texte si c'est une expression, « avance » si aucun ne sait la montrer. */
  function sorteDe(p, v) {
    if (p.kind === 'boolean') return v === undefined || typeof v === 'boolean' ? 'ouinon' : typeof v === 'string' ? 'texte' : 'avance';
    if (p.kind === 'number') return v === undefined || typeof v === 'number' || typeof v === 'string' ? 'nombre' : 'avance';
    if (p.kind === 'select') return v === undefined || (typeof v === 'string' && (p.options ?? []).includes(v)) ? 'liste' : typeof v === 'string' ? 'texte' : 'avance';
    if (v !== undefined && typeof v !== 'string') return 'avance';
    return p.kind === 'textarea' ? 'long' : p.kind === 'password' ? 'secret' : 'texte';
  }
  /** Un champ par réglage que la fonction déclare : { p, sorte, valeur, manque } (manque : obligatoire et vide). */
  const champsDe = (f, valeurs = {}) => (f?.params ?? []).filter((p) => p && typeof p.key === 'string').map((p) => {
    const v = Object.prototype.hasOwnProperty.call(valeurs, p.key) ? valeurs[p.key] : undefined;
    return { p, sorte: sorteDe(p, v), valeur: v, manque: Boolean(p.required) && vide(v) };
  });
  /** Le texte d'un champ → la valeur rangée (undefined : le réglage est retiré, la fonction prend le sien). */
  function valeurChamp(sorte, texte) {
    const t = String(texte ?? '');
    if (sorte === 'ouinon') return t === 'oui' ? true : t === 'non' ? false : undefined;
    if (sorte === 'nombre') { const s = t.trim(); if (!s) return undefined; return /^-?\d+(?:[.,]\d+)?$/.test(s) ? Number(s.replace(',', '.')) : t; }
    return t === '' ? undefined : t;
  }
  /** L'entrée après un champ changé : même forme (texte JSON ou objet), clés dans le même ordre ; une entrée qui n'est pas un objet n'est jamais réécrite. */
  function ecrireEntree(raw, key, val) {
    const l = lireEntree(raw); if (!l.ok) return raw;
    const e = Object.entries(l.valeurs), i = e.findIndex(([k]) => k === key);
    if (val === undefined) { if (i >= 0) e.splice(i, 1); } else if (i >= 0) e[i] = [key, val]; else e.push([key, val]);
    const o = Object.fromEntries(e); // (pas d'affectation : une clé « __proto__ » reste une clé)
    return raw && typeof raw === 'object' ? o : JSON.stringify(o);
  }
  /** Les réglages obligatoires vides d'un bloc d'appli (rien quand l'entrée est une expression : on ne peut pas savoir). */
  function manquants(n, f) { const l = lireEntree(n?.params?.['entrée']); return l.ok ? champsDe(f, l.valeurs).filter((c) => c.manque).map((c) => c.p.label) : []; }
  /**
   * « Changer » : l'appli et la fonction (ou l'événement) choisies remplacent celles du bloc, à la même place et avec
   * ses liens. Une autre fonction repart de ses réglages par défaut ; un déclencheur garde son niveau. Le nom donné
   * par Odin (`ancienAuto`) suit le choix ; un nom choisi à la main reste. → { ok, change, nom? } ou { ok: false, error }.
   */
  function remplacer(wf, nom, choix, ancienAuto, liste) {
    const n = wf.nodes.find((x) => x.name === nom);
    if (!n) return { ok: false, error: 'Ce bloc n\'existe plus.' };
    if (!choix?.ok) return { ok: false, error: choix?.error ?? 'Rien à changer.' };
    const b = choix.bloc;
    if (b.type !== n.type) return { ok: false, error: 'Ce choix ne va pas dans ce bloc.' };
    const p = n.params ?? {};
    // La même appli, qu'elle soit écrite par son identifiant ou par son nom (comme appliDe la trouve).
    const memeAppli = p.module === b.params.module || appliDe(liste, p.module)?.id === b.params.module;
    if (b.type === 'module.action') {
      if (memeAppli && p.action === b.params.action) return { ok: true, change: false };
      n.params = { ...p, module: b.params.module, action: b.params.action, entrée: b.params.entrée };
    } else {
      if (memeAppli && (p['événement'] ?? '') === b.params['événement']) return { ok: true, change: false };
      n.params = { ...p, module: b.params.module, événement: b.params['événement'], ...(p.niveau === undefined ? { niveau: b.params.niveau } : {}) };
    }
    const neuf = ancienAuto && n.name === ancienAuto ? nomLibre(wf.nodes.filter((x) => x !== n), b.name) : '';
    return neuf && neuf !== n.name ? { ok: true, change: true, nom: neuf } : { ok: true, change: true };
  }
  /** La flèche du clavier dans une grille de `cols` colonnes : la nouvelle place (la même au bord). */
  function pasFleche(i, total, cols, touche) {
    const c = Math.max(1, Math.floor(cols) || 1);
    const j = touche === 'ArrowRight' ? i + 1 : touche === 'ArrowLeft' ? i - 1 : touche === 'ArrowDown' ? i + c : touche === 'ArrowUp' ? i - c : touche === 'Home' ? 0 : touche === 'End' ? total - 1 : i;
    return j < 0 || j >= total ? i : j;
  }
  /** Deux touchers (ou clics) rapprochés au même endroit : { t, x, y } chacun. */
  const estDoubleTouche = (a, b) => Boolean(a && b && b.t - a.t >= 0 && b.t - a.t < 400 && Math.hypot(b.x - a.x, b.y - a.y) < 24);
  // ---------------- Le menu d'un bloc (fonctions pures) : le nom qu'on lui donne, sa note.
  /** Le nom tapé pour le bloc `ancien` : { ok, nom } (sans les espaces autour) ou { ok: false, error } (vide, déjà pris). */
  function nomValide(wf, ancien, texte) {
    const nom = String(texte ?? '').trim();
    if (!nom) return { ok: false, error: 'Le nom est vide : un bloc a besoin d\'un nom.' };
    if (nom !== ancien && (wf?.nodes ?? []).some((x) => x.name === nom)) return { ok: false, error: `Le nom « ${nom} » est déjà pris par un autre bloc.` };
    return { ok: true, nom };
  }
  /** Pose, change ou retire (texte vide) la note d'un bloc : un texte libre, rangé dans son champ `note`. → true si elle a changé. */
  function poserNote(n, texte) {
    const t = String(texte ?? '').trim();
    if (!t) { if (!Object.prototype.hasOwnProperty.call(n, 'note')) return false; delete n.note; return true; }
    if (n.note === t) return false;
    n.note = t; return true;
  }
  const APPUI_LONG = 500; // ms : au doigt, l'appui long ouvre le menu d'un bloc
  // ---------------- Les données des blocs d'avant (fonctions pures). La pastille n'est qu'une autre façon d'écrire et de
  // montrer l'expression d'aujourd'hui, {{ $node["Bloc"].json.chemin }} : c'est elle, telle quelle, qui est enregistrée.
  // Les règles de lecture sont celles du moteur (src/draupnir/engine.ts : resolve et readPath).
  const RE_EXPR = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const RE_CLE = /^[\p{L}\p{N}_$-]+$/u;
  /** Les morceaux d'un chemin comme le moteur les lit (`$node["X"].json.a[0]` → ['$node', 'X', 'json', 'a', 0]) ; null s'il ne le lit pas. */
  function morceauxChemin(expr) {
    const m = /^\s*(\$[a-z]+)/i.exec(expr); if (!m) return null;
    const out = [m[1]]; let rest = expr.slice(m[0].length).trim();
    while (rest) {
      let mm;
      if ((mm = /^\.\s*([\p{L}\p{N}_$-]+)/u.exec(rest))) out.push(mm[1]);
      else if ((mm = /^\[\s*(["'])(.*?)\1\s*\]/.exec(rest))) out.push(mm[2]);
      else if ((mm = /^\[\s*(\d+)\s*\]/.exec(rest))) out.push(Number(mm[1]));
      else return null;
      rest = rest.slice(mm[0].length).trim();
    }
    return out;
  }
  /** Le texte d'un champ en morceaux : { texte } ou, pour une donnée d'un bloc ({{ $node["X"].json.… }}), { src, bloc, chemin }. */
  function decouper(texte) {
    const t = String(texte ?? ''), out = []; let i = 0;
    for (const m of t.matchAll(RE_EXPR)) {
      const k = morceauxChemin(m[1]);
      if (!k || k[0] !== '$node' || typeof k[1] !== 'string' || k[2] !== 'json' || k.length < 4) continue; // le reste : du texte
      if (m.index > i) out.push({ texte: t.slice(i, m.index) });
      out.push({ src: m[0], bloc: k[1], chemin: k.slice(3) }); i = m.index + m[0].length;
    }
    if (i < t.length) out.push({ texte: t.slice(i) });
    return out;
  }
  const assembler = (ms) => (ms ?? []).map((m) => m.src ?? m.texte ?? '').join('');
  /**
   * L'expression d'une donnée du bloc `bloc` : {{ $node["Bloc"].json.chemin }}. Dans des réglages rangés en texte JSON
   * (`dansJson`), les guillemets doubles seraient échappés et le moteur lirait vide : des guillemets simples.
   * → null quand le moteur ne saurait pas la relire (accolade, les deux guillemets, barre oblique inverse dans du JSON).
   */
  function exprDonnee(bloc, chemin, dansJson = false) {
    const qs = dansJson ? ['\''] : ['"', '\''];
    const entre = (k) => { if (/[{}]/.test(k) || (dansJson && /[\\\u0000-\u001f]/.test(k))) return null; const q = qs.find((x) => !k.includes(x)); return q ? `[${q}${k}${q}]` : null; };
    if (typeof bloc !== 'string' || !Array.isArray(chemin) || !chemin.length) return null;
    let s = entre(bloc); if (!s) return null;
    s = `$node${s}.json`;
    for (const k of chemin) {
      const p = typeof k === 'number' ? (Number.isInteger(k) && k >= 0 ? `[${k}]` : null) : typeof k === 'string' ? (RE_CLE.test(k) ? `.${k}` : entre(k)) : null;
      if (!p) return null; s += p;
    }
    return `{{ ${s} }}`;
  }
  const libelleChemin = (c) => (c ?? []).map((k) => (typeof k === 'number' ? `[${k}]` : k)).join(' › ');
  /** Les blocs situés avant `nom` (ceux d'où un fil mène jusqu'à lui), le plus lointain d'abord ; jamais lui-même. */
  function blocsAvant(wf, nom) {
    const parents = new Map();
    for (const [de, sorties] of Object.entries(wf?.connections ?? {})) for (const t of sorties ?? []) for (const l of t ?? []) if (l?.node) { if (!parents.has(l.node)) parents.set(l.node, []); parents.get(l.node).push(de); }
    const dist = new Map(), file = [[nom, 0]];
    while (file.length) { const [x, d] = file.shift(); for (const p of parents.get(x) ?? []) if (p !== nom && !dist.has(p)) { dist.set(p, d + 1); file.push([p, d + 1]); } }
    const ordre = new Map((wf?.nodes ?? []).map((n, i) => [n.name, i]));
    return [...dist.keys()].filter((x) => ordre.has(x)).sort((a, b) => dist.get(b) - dist.get(a) || ordre.get(a) - ordre.get(b));
  }
  /**
   * Les données vues au dernier passage d'un bloc : { chemin, exemple }, sans doublon, bornées. Seulement celles de son
   * PREMIER élément : c'est le seul que le moteur donne à $node["Bloc"].json (une clé des suivants y serait vide).
   */
  function donneesVues(items, max = 80) {
    const vus = new Map();
    const voir = (v, chemin, prof) => {
      if (vus.size >= max) return;
      if (chemin.length) { const k = JSON.stringify(chemin); if (!vus.has(k)) vus.set(k, { chemin, exemple: v }); }
      if (v && typeof v === 'object' && !Array.isArray(v) && prof < 4) for (const [k, x] of Object.entries(v)) voir(x, [...chemin, k], prof + 1);
    };
    const it = Array.isArray(items) ? items[0] : undefined;
    if (it && typeof it === 'object' && !Array.isArray(it)) voir(it, [], 0);
    return [...vus.values()];
  }
  /** Une donnée posée dans le réglage du bloc `nom` : { ok } ou { ok: false, raison } (bloc renommé, retiré, pas avant). */
  function etatDonnee(d, wf, nom, renommes, retires) {
    const existe = (x) => (wf?.nodes ?? []).some((n) => n.name === x);
    if (!existe(d.bloc)) {
      let v = d.bloc; for (let k = 0; renommes?.has(v) && k < 50; k++) v = renommes.get(v);
      if (v !== d.bloc && existe(v)) return { ok: false, raison: `« ${d.bloc} » a été renommé « ${v} » : cette donnée ne suit pas le nouveau nom.` };
      if (retires?.has(v) || retires?.has(d.bloc)) return { ok: false, raison: `« ${v} » a été retiré : cette donnée sera vide.` };
      return { ok: false, raison: `Le bloc « ${d.bloc} » n'existe pas (renommé ou retiré ?) : cette donnée sera vide.` };
    }
    if (d.bloc === nom) return { ok: false, raison: 'Cette donnée vient de ce bloc lui-même : elle n\'existe pas encore quand il part.' };
    if (!blocsAvant(wf, nom).includes(d.bloc)) return { ok: false, raison: `« ${d.bloc} » n'est pas avant ce bloc : cette donnée sera vide.` };
    return { ok: true };
  }
  // ---------------- Renommer un bloc : les données prises chez lui suivent son nouveau nom (fonctions pures). Seulement
  // dans les {{ … }} que le moteur lit en entier (resolve et readPath), et seulement le morceau qui nomme le bloc :
  // $node["X"], $node['X'], $node.X, $node[12] (un bloc nommé « 12 »). Le reste du texte ne change pas, à l'octet près.
  const NOM_ILLISIBLE = new Set(['__proto__', 'constructor', 'prototype']); // le moteur n'y lit rien (engine.ts, get)
  /** Le bloc que cite une expression (le texte entre {{ et }}) : { nom, debut, fin (du nom), sDebut, sFin (du morceau), forme, q } ou null. */
  function citation(expr) {
    const m = /^\s*(\$[a-z]+)/i.exec(expr); if (!m || m[1] !== '$node') return null;
    const k = morceauxChemin(expr); if (!k || k.length < 2) return null;
    const apres = expr.slice(m[0].length), rest = apres.trimStart(), o = m[0].length + apres.length - rest.length;
    let mm;
    if ((mm = /^\.\s*([\p{L}\p{N}_$-]+)/u.exec(rest))) return { nom: mm[1], debut: o + mm[0].length - mm[1].length, fin: o + mm[0].length, sDebut: o, sFin: o + mm[0].length, forme: '.' };
    if ((mm = /^\[\s*(["'])(.*?)\1\s*\]/.exec(rest))) { const d = o + mm[0].indexOf(mm[1]) + 1; return { nom: mm[2], debut: d, fin: d + mm[2].length, sDebut: o, sFin: o + mm[0].length, forme: '[', q: mm[1] }; }
    if ((mm = /^\[\s*(\d+)\s*\]/.exec(rest))) { const d = o + mm[0].indexOf(mm[1]); return { nom: String(Number(mm[1])), debut: d, fin: d + mm[1].length, sDebut: o, sFin: o + mm[0].length, forme: '0' }; }
    return null;
  }
  /** L'expression `expr` (qui cite `c`) réécrite pour citer `vers`, relue par le moteur à l'identique sauf le nom ; null sinon. */
  function citer(expr, c, vers, dansJson) {
    if (/[{}]/.test(vers) || NOM_ILLISIBLE.has(vers) || (dansJson && /["\\\u0000-\u001f]/.test(vers))) return null;
    const k0 = morceauxChemin(expr), attendu = JSON.stringify(k0.slice(2));
    const bon = (e) => { const k = morceauxChemin(e); return Boolean(k && k[0] === '$node' && String(k[1]) === vers && JSON.stringify(k.slice(2)) === attendu); };
    const essais = c.forme === '[' ? [] : [expr.slice(0, c.debut) + vers + expr.slice(c.fin)]; // la même écriture d'abord
    // Des crochets : le guillemet d'avant s'il ne gêne pas, sinon l'autre (dans du JSON, seulement l'apostrophe).
    const qs = [...new Set([c.q, '"', '\''].filter((q) => q && (!dansJson || q === c.q || q === '\'')))].sort((a, b) => Number(vers.includes(a)) - Number(vers.includes(b)));
    for (const q of qs) essais.push(c.forme === '[' ? expr.slice(0, c.debut - 1) + q + vers + q + expr.slice(c.fin + 1) : `${expr.slice(0, c.sDebut)}[${q}${vers}${q}]${expr.slice(c.sFin)}`);
    return essais.find(bon) ?? null;
  }
  /**
   * Un texte de réglage où le bloc `de` s'appelle maintenant `vers` : chaque {{ … }} qui le cite est réécrit, rien d'autre.
   * → le texte (le même s'il ne le cite pas) ; null si une citation ne saurait pas s'écrire avec ce nom (le texte reste tel quel).
   * `dansJson` : le réglage est un texte JSON (le moteur remplace avant de le lire) : ni guillemet double ni \ dans le nom.
   */
  function renommerDans(texte, de, vers, dansJson = false) {
    const t = String(texte ?? ''); let rate = false;
    const out = t.replace(RE_EXPR, (tout, expr) => {
      const c = citation(expr); if (!c || c.nom !== de) return tout;
      const e = citer(expr, c, vers, dansJson); if (e === null) { rate = true; return tout; }
      return tout.replace(expr, () => e);
    });
    if (rate) return null;
    // Un texte qui était un JSON le reste.
    if (out !== t) { let avant = false; try { JSON.parse(t); avant = true; } catch { /* pas un JSON */ } if (avant) { try { JSON.parse(out); } catch { return null; } } }
    return out;
  }
  const IMPOSSIBLE = Symbol('impossible');
  /** Une valeur de réglage (texte, liste, objet : comme resolve, les valeurs seulement) réécrite ; la même si rien ne change ; IMPOSSIBLE sinon. */
  function suivreValeur(v, de, vers, dansJson) {
    if (typeof v === 'string') { const r = renommerDans(v, de, vers, dansJson); return r === null ? IMPOSSIBLE : r === v ? v : r; }
    if (Array.isArray(v)) { let ch = false; const out = []; for (const x of v) { const r = suivreValeur(x, de, vers, false); if (r === IMPOSSIBLE) return r; ch ||= r !== x; out.push(r); } return ch ? out : v; }
    if (v && typeof v === 'object') { let ch = false; const out = {}; for (const [k, x] of Object.entries(v)) { const r = suivreValeur(x, de, vers, false); if (r === IMPOSSIBLE) return r; ch ||= r !== x; out[k] = r; } return ch ? out : v; }
    return v;
  }
  /** Une valeur de réglage (texte, liste, objet : les valeurs seulement, comme resolve) cite-t-elle le bloc `nom` ? */
  function citeLeBloc(v, nom) {
    if (typeof v === 'string') { for (const m of v.matchAll(RE_EXPR)) if (citation(m[1])?.nom === nom) return true; return false; }
    if (Array.isArray(v)) return v.some((x) => citeLeBloc(x, nom));
    if (v && typeof v === 'object') return Object.values(v).some((x) => citeLeBloc(x, nom));
    return false;
  }
  /**
   * Le bloc `de` renommé `vers` : les réglages de TOUS les blocs qui le citent, réécrits. → { ok, changes: [{ i, cle, valeur }] }
   * (rien n'est écrit ici) ou { ok: false, error } si une donnée ne saurait pas s'écrire avec ce nom, ou vise déjà un bloc
   * de ce nom (qui n'existe pas : nomValide refuse un nom pris). `estJson(bloc, clé)` :
   * ce réglage est-il un texte JSON ? Le code d'un bloc « Code » est lu tel quel par le moteur, jamais résolu : il ne change pas.
   */
  function suivreRenommage(wf, de, vers, estJson = () => false) {
    const changes = [], nodes = wf?.nodes ?? [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      for (const [cle, v] of Object.entries(n.params ?? {})) {
        if (n.type === 'données.code' && cle === 'code') continue;
        // Une donnée qui vise déjà un bloc « vers » (qui n'existe plus) prendrait, sans le dire, celles de « de » ; et
        // revenir à l'ancien nom l'emporterait avec elle : refusé.
        if (citeLeBloc(v, vers)) return { ok: false, error: `Une donnée de « ${n.name} » vise déjà un bloc « ${vers} » qui n'existe pas : avec ce nom, elle prendrait celles de « ${de} ». Choisis un autre nom, ou change d'abord cette donnée.` };
        const r = suivreValeur(v, de, vers, typeof v === 'string' && Boolean(estJson(n, cle)));
        if (r === IMPOSSIBLE) return { ok: false, error: `Le nom « ${vers} » ne peut pas s'écrire dans la donnée que « ${n.name} » prend chez « ${de} » (une accolade, un retour à la ligne, ou, dans des réglages en JSON, un guillemet double ou une barre oblique inverse) : choisis un autre nom.` };
        if (r !== v) changes.push({ i, cle, valeur: r });
      }
    }
    return { ok: true, changes };
  }
  // Session expirée pendant l'usage : on revient à la page de connexion. Sur la page de connexion elle-même,
  // on ne recharge rien (sinon elle se rechargerait en boucle et effacerait ce que tu tapes).
  const appShown = () => { const a = document.querySelector('#app'); return Boolean(a && !a.hidden); };
  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(body) } : { headers: { 'x-odin': '1' } });
    if (r.status === 401) { if (appShown()) location.reload(); throw new Error('session expirée'); }
    return r.json();
  }
  const css = `
.dr-top{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}.dr-top input{flex:1 1 280px;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--field);background:var(--panel)}
.dr-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin:0 0 20px}
.dr-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.dr-card .dr-h{display:flex;gap:10px;align-items:center;justify-content:space-between}.dr-card b{font-size:16px}
.dr-steps{font-size:13px;color:var(--muted);overflow-wrap:anywhere}.dr-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dr-tpl{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.dr-tpl article{border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--panel2);display:flex;flex-direction:column;gap:6px}.dr-tpl p{margin:0;font-size:14px;color:var(--muted)}
.dr-ed{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:12px;align-items:start}@media (max-width:980px){.dr-ed{grid-template-columns:1fr}}
.dr-canvas{position:relative;height:min(64vh,620px);border:1px solid var(--line);border-radius:14px;background:var(--panel2) radial-gradient(circle,var(--line) 1px,transparent 1px) 0 0/22px 22px;overflow:hidden;touch-action:none}
.dr-canvas>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.dr-world{position:absolute;left:0;top:0;transform-origin:0 0}
.dr-node{position:absolute;width:190px;background:var(--panel);border:1.5px solid var(--line);border-radius:12px;padding:8px 10px 10px;cursor:grab;user-select:none;box-shadow:var(--shadow)}
.dr-node.sel{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent)}
.dr-node.trig{border-left:5px solid var(--accent)}.dr-node.off{opacity:.5}
.dr-node.ok{border-color:var(--good)}.dr-node.err{border-color:var(--bad)}
.dr-node small{display:block;font-size:11.5px;color:var(--dim)}.dr-node b{display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dr-node .dr-cnt{font-size:11.5px;color:var(--good)}.dr-node.err .dr-cnt{color:var(--bad)}
.dr-port{--z:var(--dr-z,44px);--dh:calc(var(--z) / 2);--db:calc(var(--z) / 2);position:absolute;width:var(--z);height:calc(var(--dh) + var(--db));border:0;border-radius:0;background:none;padding:0;cursor:crosshair;touch-action:none}
.dr-port::before{content:'';position:absolute;left:calc(var(--z) / 2 - 9px);top:calc(var(--dh) - 9px);width:18px;height:18px;box-sizing:border-box;border-radius:50%;border:2px solid var(--accent);background:var(--panel)}
.dr-port.in{left:calc(-1px - var(--z) / 2);top:calc(33px - var(--z) / 2)}.dr-port.out{right:calc(-1px - var(--z) / 2)}.dr-port.armed::before{background:var(--accent)}
.dr-port:focus-visible{outline:none}.dr-port:focus-visible::before{outline:2px solid var(--accent);outline-offset:2px}
.dr-port .dr-pl{position:absolute;left:calc(var(--z) / 2 + 11px);top:calc(var(--dh) - 11px);font-size:10.5px;color:var(--dim);white-space:nowrap;pointer-events:none}
.dr-link{fill:none;stroke:var(--accent);stroke-width:2.2;opacity:.8;pointer-events:none}
.dr-fil{fill:none;stroke:transparent;stroke-width:var(--dr-zf,22px);pointer-events:stroke;cursor:pointer}.dr-fil:focus{outline:none}
.dr-fil:hover,.dr-fil:focus-visible,.dr-fil.on{stroke:color-mix(in srgb,var(--accent) 22%,transparent)}
.dr-tire{fill:none;stroke:var(--accent);stroke-width:2.2;stroke-dasharray:6 5;pointer-events:none}
.dr-node.dr-cible{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent)}
.dr-fil-menu{position:absolute;z-index:3;min-width:200px;display:flex;flex-direction:column;gap:2px;padding:6px;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);animation:dr-ch-in .12s ease-out}
.dr-fil-menu button{text-align:left;border:0;background:none;border-radius:8px;padding:0 12px;min-height:44px;color:var(--ink);font:inherit;font-size:14px;cursor:pointer}
.dr-fil-menu button:hover,.dr-fil-menu button:focus-visible{background:var(--panel2);outline:none}.dr-fil-menu button:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
.dr-side{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;max-height:min(64vh,620px);overflow:auto}
.dr-side h2{font-size:16px;margin:0}.dr-side label{font-size:13.5px;font-weight:600;display:block;margin:6px 0 4px}
.dr-side input:not([type=checkbox]),.dr-side textarea,.dr-side select{width:100%;min-height:38px;padding:7px 10px;border-radius:10px;border:1px solid var(--field);background:var(--panel2)}.dr-side textarea{min-height:80px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}
.dr-cat{display:flex;flex-direction:column;gap:4px}.dr-cat h3{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim);margin:8px 0 2px}
.dr-cat button{text-align:left;border:1px solid var(--line);background:var(--panel2);border-radius:10px;padding:7px 10px;font-size:13.5px;min-height:36px}.dr-cat button:hover{border-color:var(--accent)}
.dr-out{white-space:pre-wrap;font-size:12.5px;background:var(--panel2);border-radius:10px;padding:8px;max-height:240px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace}
.dr-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 10px}.dr-bar input.dr-name{flex:1 1 220px;min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--field);background:var(--panel);font-weight:600}
.dr-runs{font-size:13.5px}.dr-runs li{padding:4px 0}
.dr-plus{position:absolute;right:-22px;bottom:-22px;width:44px;height:44px;padding:0;border:0;background:none;display:grid;place-items:center;cursor:pointer;z-index:1}
.dr-plus span{width:26px;height:26px;border-radius:50%;background:var(--accent);color:var(--on-accent,#fff);display:grid;place-items:center;font-size:19px;font-weight:700;line-height:1;box-shadow:var(--shadow);transition:transform .15s}
.dr-plus:hover span,.dr-plus:focus-visible span{transform:scale(1.15)}.dr-plus:focus-visible{outline:2px solid var(--accent);border-radius:50%}
.dr-vide{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;text-align:center;pointer-events:none}
.dr-vide button{pointer-events:auto;width:96px;height:96px;border-radius:50%;border:2px dashed var(--accent);background:var(--panel);color:var(--accent);font-size:52px;line-height:1;cursor:pointer;box-shadow:var(--shadow)}
.dr-vide button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.dr-vide p{margin:0;color:var(--muted);font-size:14px;max-width:320px}
.dr-choix-fond{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(8,10,14,.55)}
.dr-choix{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);width:min(640px,100%);max-height:min(86vh,720px);display:flex;flex-direction:column;overflow:hidden;animation:dr-ch-in .16s ease-out}
.dr-ch-h{display:flex;align-items:center;gap:10px;padding:10px 10px 10px 16px;border-bottom:1px solid var(--line)}.dr-ch-h h2{flex:1;margin:0;font-size:17px;display:flex;align-items:center;gap:10px;min-width:0;overflow-wrap:anywhere}
.dr-ch-x{flex:none;width:44px;height:44px;border:0;border-radius:10px;background:none;color:var(--ink);font-size:24px;cursor:pointer}.dr-ch-x:hover{background:var(--panel2)}
.dr-ch-c{padding:12px 16px 16px;overflow:auto;display:flex;flex-direction:column;gap:10px;min-height:0}.dr-ch-c .li-g{max-height:none}.dr-ch-c>.btn{align-self:flex-start;min-height:44px}
.dr-ch-c h3{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim);margin:6px 0 0}.dr-ch-c h4{font-size:12.5px;color:var(--muted);margin:6px 0 0}
.dr-ch-o{display:flex;flex-direction:column;gap:6px}.dr-ch-o button{text-align:left;border:1px solid var(--line);background:var(--panel2);border-radius:10px;padding:8px 12px;min-height:44px;color:var(--ink);font:inherit;cursor:pointer}
.dr-ch-o button:hover{border-color:var(--accent)}.dr-ch-o button:focus-visible{outline:2px solid var(--accent)}.dr-ch-o b{display:block;font-size:14px}.dr-ch-o small{display:block;color:var(--muted);font-size:12.5px}
.dr-node .dr-ap{display:flex;align-items:center;gap:6px;min-width:0;margin:0 0 2px}.dr-node .dr-ap small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dr-node .dr-nn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dr-node .dr-manque{display:block;font-size:11.5px;color:var(--bad)}
.dr-app{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--panel2)}.dr-app>div{flex:1;min-width:0}
.dr-app b{display:block;font-size:13px;color:var(--muted);font-weight:600;overflow-wrap:anywhere}.dr-app span.dr-fn{display:block;font-size:15px;font-weight:700;overflow-wrap:anywhere}.dr-app .btn{flex:none;min-height:44px}
#v-flows .dr-side .dr-champs input,#v-flows .dr-side .dr-champs select,#v-flows .dr-side .dr-champs textarea{min-height:44px}.dr-side .dr-champs textarea{font-family:inherit;font-size:14px}
.dr-side .dr-manque{display:block;color:var(--bad);font-size:13px;margin-top:4px}.dr-side .dr-manque[hidden]{display:none}.dr-side .dr-champs small.sub{display:block;margin-top:4px}
.dr-av summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600}.dr-av textarea{min-height:120px}
@keyframes dr-ch-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.dr-df-l{display:flex;gap:6px;align-items:flex-start}.dr-df .btn.dr-df-b{flex:none;min-height:44px;min-width:44px}
.dr-saisie{flex:1;min-width:0;min-height:44px;box-sizing:border-box;padding:9px 10px;border-radius:10px;border:1px solid var(--field);background:var(--panel2);color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.75;font-size:14px;cursor:text}
.dr-saisie.multi{min-height:88px}.dr-saisie:focus{outline:2px solid var(--accent);outline-offset:1px}.dr-saisie:empty::before{content:attr(data-placeholder);color:var(--dim)}
.dr-pastille{display:inline-flex;align-items:center;gap:3px;max-width:100%;box-sizing:border-box;margin:0 1px;padding:0 1px 0 8px;border-radius:999px;background:color-mix(in srgb,var(--accent) 16%,var(--panel));border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);color:var(--ink);font-size:13px;line-height:22px;white-space:nowrap;vertical-align:baseline;user-select:none;cursor:default}
.dr-pastille .dr-p-t{overflow:hidden;text-overflow:ellipsis}.dr-pastille.bad{background:color-mix(in srgb,var(--bad) 14%,var(--panel));border-color:var(--bad)}.dr-p-a{font-weight:700;color:var(--bad)}
.dr-p-x{position:relative;flex:none;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:none;color:var(--muted);font-size:15px;line-height:1;cursor:pointer}
.dr-p-x::after{content:'';position:absolute;inset:-12px}.dr-p-x:hover,.dr-p-x:focus-visible{background:color-mix(in srgb,var(--ink) 14%,transparent);color:var(--ink);outline:none}
.dr-donnees{margin-top:6px;border:1px solid var(--line);border-radius:12px;background:var(--panel2);padding:8px 10px 10px;display:flex;flex-direction:column;gap:6px;max-height:360px;overflow:auto}
.dr-dn-h{display:flex;align-items:center;gap:8px}.dr-dn-h h3{flex:1;margin:0;font-size:14px}.dr-donnees .dr-dn-h .btn{min-height:44px}
.dr-donnees h4{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:6px 0 0;font-size:13.5px;overflow-wrap:anywhere}.dr-donnees h4 small{font-weight:400}
.dr-dn-l{display:flex;flex-direction:column;gap:4px}
.dr-dn-i{display:flex;flex-direction:column;align-items:flex-start;text-align:left;width:100%;min-height:44px;padding:6px 10px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);font:inherit;cursor:pointer}
.dr-dn-i b{font-size:13.5px;overflow-wrap:anywhere}.dr-dn-i small{color:var(--muted);font-size:12px;overflow-wrap:anywhere}.dr-dn-i:hover{border-color:var(--accent)}.dr-dn-i:focus-visible{outline:2px solid var(--accent)}.dr-dn-i[disabled]{opacity:.55;cursor:not-allowed}
.dr-node.dr-source{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,var(--panel));outline:3px solid var(--accent);outline-offset:3px;box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 40%,transparent);animation:dr-pulse .9s ease-in-out infinite alternate}
@keyframes dr-pulse{from{box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 30%,transparent)}to{box-shadow:0 0 0 9px color-mix(in srgb,var(--accent) 45%,transparent)}}
.dr-mb{position:absolute;width:var(--dr-z,44px);height:var(--dr-z,44px);left:calc(95px - var(--dr-z,44px) / 2);z-index:1;top:calc(10px - var(--dr-z,44px));padding:0;border:0;background:none;display:grid;place-items:end center;cursor:pointer;touch-action:none}
.dr-mb span{min-width:28px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;border:1.5px solid var(--line);background:var(--panel);color:var(--muted);font-size:15px;font-weight:700;line-height:13px;text-align:center;transition:border-color .15s,color .15s}
.dr-mb:hover span,.dr-mb:focus-visible span,.dr-mb[aria-expanded=true] span{border-color:var(--accent);color:var(--accent)}.dr-mb:focus-visible{outline:none}.dr-mb:focus-visible span{outline:2px solid var(--accent);outline-offset:1px}
.dr-node{-webkit-touch-callout:none}.dr-node .dr-nom.dr-cache{visibility:hidden}
.dr-note-m{position:absolute;left:14px;top:-10px;width:18px;height:18px;box-sizing:border-box;border-radius:5px;border:1.5px solid var(--accent);background:var(--panel);pointer-events:none}
.dr-note-m::before{content:'';position:absolute;left:3px;right:3px;top:4px;height:5px;border-top:1.5px solid var(--accent);border-bottom:1.5px solid var(--accent)}
.dr-note-bulle{position:absolute;z-index:2;max-width:260px;box-sizing:border-box;padding:8px 10px;border-radius:10px;background:var(--panel);color:var(--ink);border:1px solid var(--accent);box-shadow:var(--shadow);font-size:13px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:hidden;pointer-events:none}
.dr-renom-z{position:absolute;left:4px;width:182px;z-index:4;transform-origin:0 0;transform:scale(var(--dr-ik,1));display:flex;flex-direction:column;gap:3px}
.dr-renom{box-sizing:border-box;width:100%;min-height:30px;padding:3px 8px;border-radius:8px;border:1.5px solid var(--accent);background:var(--panel);color:var(--ink);font:inherit;font-size:14px;font-weight:600}.dr-renom:focus{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent)}
.dr-renom[aria-invalid=true]{border-color:var(--bad)}.dr-renom-e{display:block;padding:4px 8px;border-radius:8px;background:var(--panel);border:1px solid var(--bad);color:var(--bad);font-size:12px;line-height:1.35;white-space:normal}.dr-renom-e[hidden]{display:none}
.dr-note-ed label{font-size:13.5px;font-weight:600}.dr-note-ed textarea{box-sizing:border-box;width:100%;min-height:130px;padding:10px;border-radius:10px;border:1px solid var(--field);background:var(--panel2);color:var(--ink);font:inherit;font-size:14.5px;resize:vertical}
.dr-note-ed .dr-row .btn{min-height:44px}
@media (prefers-reduced-motion:reduce){.dr-node.dr-source,.dr-choix,.dr-fil-menu{animation:none}.dr-plus span,.dr-mb span{transition:none}}
`;
  let st = null, wf = null, outs = {}, sel = null, armed = null, last = null, view = { x: 40, y: 40, k: 1 }, dirty = false;
  const cat = (t) => st?.catalog.find((c) => c.type === t);
  let elems = new Map();

  // Un autre écran de Talos (« Faire un lien ») a pris la page : la liste ne revient qu'à la demande.
  let ailleurs = false, jeton = 0;
  async function openList() {
    wf = null; ailleurs = false; fermerChoix(); const j = ++jeton;
    const box = $('#v-flows .body'); if (!box) return;
    $('#v-flows .head h1').textContent = 'Automatisations';
    $('#v-flows .head .sub').textContent = 'Talos, le moteur d\'Odin : décris ce que tu veux automatiser, ou pars d\'un modèle. Tout est relié à Thot, Papyrus et tes applis.';
    st = await api('/api/draupnir/state');
    if (j !== jeton) return;
    box.replaceChildren();
    if (!st.ok) { box.append(el('p', { class: 'sub' }, st.error)); return; }
    const msg = el('p', { class: 'sub', role: 'status' });
    box.append(el('form', { class: 'dr-top', onsubmit: async (e) => { e.preventDefault(); const d = $('#drAsk').value.trim(); if (!d) return; msg.textContent = 'Odin écrit l\'automatisation…'; const r = await api('/api/draupnir/create', { description: d }); if (r.ok) ouvrirNeuve(r.flow.id); else msg.textContent = `✗ ${r.error}`; } },
      el('label', { for: 'drAsk', class: 'sr' }, 'Décris ton automatisation'), el('input', { id: 'drAsk', placeholder: 'Ex. chaque matin à 7 h, envoie-moi les tâches en retard', autocomplete: 'off' }), el('button', { class: 'btn primary', type: 'submit' }, 'Créer avec Odin'), lienBtn(), el('button', { class: 'btn', type: 'button', onclick: newFlow }, 'Partir de zéro')), msg);
    // Les dossiers de Talos (onglets Actives, Brouillons, tes dossiers, Corbeille) : pages/talos-dossiers.js ; sans lui, la grille d'avant.
    if (!window.OdinTalosDossiers?.monter(box, st, { ouvrir: openFlow, lancer, recharger: openList })) { if (st.flows.length) box.append(el('div', { class: 'dr-list' }, ...st.flows.map((w) => el('article', { class: 'dr-card' },
      el('div', { class: 'dr-h' }, el('b', {}, w.name), el('input', { type: 'checkbox', class: 'g-sw', 'aria-label': `Activer ${w.name}`, checked: w.active ? true : undefined, onchange: async (e) => { if (e.target.checked && !(await window.OdinDialog.confirm(`Activer « ${w.name} » ? Elle agira seule ensuite.`))) { e.target.checked = false; return; } const r = await api('/api/draupnir/toggle', { id: w.id, on: e.target.checked }); if (!r.ok) { e.target.checked = !e.target.checked; await window.OdinDialog.alert(r.error); } } })),
      el('div', { class: 'dr-steps' }, w.nodes.map((n) => n.label).join(' → ')),
      w.phrase || w.prochaineTexte ? el('div', { class: 'dr-steps' }, [w.phrase, w.active && w.prochaineTexte ? `Prochaine : ${w.prochaineTexte}` : ''].filter(Boolean).join(' · ')) : null,
      el('div', { class: 'dr-row' }, w.last ? el('span', { class: `pill ${w.last.status === 'succès' ? 'good' : w.last.status === 'erreur' ? 'bad' : ''}` }, `${w.last.status} · ${new Date(w.last.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`) : el('span', { class: 'pill' }, 'jamais lancée'), w.failed ? el('span', { class: 'pill bad' }, `${w.failed} échec(s)`) : null),
      el('div', { class: 'dr-row' }, el('button', { class: 'btn small primary', type: 'button', onclick: () => openFlow(w.id) }, 'Ouvrir'), el('button', { class: 'btn small', type: 'button', onclick: (e) => lancer(e.currentTarget, w) }, 'Lancer maintenant')), el('div', { class: 'dr-steps', role: 'status' }))))); else box.append(el('p', { class: 'sub' }, 'Aucune automatisation pour l\'instant.')); }
    // Tout ce qui tourne tout seul dans Odin (applis, tâches planifiées, rappels) : la même liste, sous les automatisations.
    if (window.OdinAutomatismes) { const zone = el('div', {}); box.append(zone); window.OdinAutomatismes.monter(zone); }
    box.append(el('section', { class: 'card', style: 'margin-bottom:16px' }, el('h2', { style: 'font-size:17px;margin:0 0 8px' }, 'Modèles prêts'), el('div', { class: 'dr-tpl' }, ...st.templates.map((t) => el('article', {}, el('b', {}, t.name), el('p', {}, t.what), el('button', { class: 'btn small', type: 'button', onclick: async (e) => { e.target.disabled = true; const r = await api('/api/draupnir/template', { id: t.id }); if (r.ok) ouvrirNeuve(r.flow.id); else { e.target.textContent = `✗ ${r.error}`; } } }, 'Utiliser'))))));
    box.append(el('details', { class: 'card' }, el('summary', { style: 'cursor:pointer;min-height:40px;display:flex;align-items:center;font-weight:600' }, 'Importer une automatisation n8n (JSON)'),
      el('form', { onsubmit: async (e) => { e.preventDefault(); const r = await api('/api/draupnir/import', { json: $('#drImp').value }); if (r.ok) { if (r.todo?.length) await window.OdinDialog.alert(`À revoir :\n${r.todo.join('\n')}`); ouvrirNeuve(r.flow.id); } else await window.OdinDialog.alert(r.error); } }, el('label', { for: 'drImp', class: 'sub' }, 'Colle le JSON exporté'), el('textarea', { id: 'drImp', style: 'width:100%;min-height:120px' }), el('button', { class: 'btn', type: 'submit' }, 'Importer'))));
  }
  /** « Faire un lien » : montré seulement quand Talos sait en faire (sinon la barre reste comme avant). */
  function lienBtn() {
    if (!window.OdinLien) return null;
    const b = el('button', { class: 'btn', type: 'button', hidden: true, onclick: () => window.OdinLien.ouvrir() }, 'Faire un lien');
    window.OdinLien.dispo().then((ok) => { b.hidden = !ok; });
    return b;
  }
  /** « Lancer maintenant » d'une carte : le résultat reste sous la carte (pastille, texte, durée). */
  async function lancer(btn, w) {
    const out = btn.closest('article')?.querySelector('[role=status]'); btn.disabled = true;
    const dit = (ok, texte, ms) => { if (out) out.replaceChildren(el('span', { class: `pill ${ok ? 'good' : 'bad'}` }, ok ? 'Réussi' : 'Échec'), ` ${texte ?? ''}${typeof ms === 'number' ? ` · ${ms} ms` : ''}`); };
    if (out) out.textContent = 'Lancement…';
    let r = await api('/api/draupnir/automatisme/lancer', { id: `flow:${w.id}` }).catch(() => ({}));
    if (r?.ok === undefined) {
      // Talos sans « Lancer maintenant » : on passe par le test d'avant.
      r = await api('/api/draupnir/run', { id: w.id }).catch((e) => ({ ok: false, error: e.message }));
      btn.disabled = false;
      if (r.ok) dit(r.run.status === 'succès', `${r.run.status}${r.run.error ? ` : ${r.run.error}` : ''}`, r.run.ms); else dit(false, r.error);
      return;
    }
    btn.disabled = false;
    if (r.ok) dit(r.resultat?.ok !== false, r.resultat?.texte, r.resultat?.ms); else dit(false, r.error);
  }
  function newFlow() { wf = { id: '', name: 'Nouvelle automatisation', active: false, nodes: [{ name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] }], connections: {} }; outs = {}; last = null; renommes = new Map(); retires = new Set(); dirty = true; editor(); }
  async function openFlow(id) {
    const r = await api(`/api/draupnir/flow?id=${encodeURIComponent(id)}`); if (!r.ok) { await window.OdinDialog.alert(r.error); return; }
    if (!st) st = await api('/api/draupnir/state');
    wf = r.flow; outs = r.outputs; last = r.runs[0] ?? null; renommes = new Map(); retires = new Set(); sel = null; dirty = false; editor(r);
  }
  /**
   * Une automatisation que le serveur vient de créer (« Créer avec Odin », un modèle, un import) : elle est déjà enregistrée,
   * en brouillon et sans dossier. On l'ouvre, puis on propose le même choix qu'au premier enregistrement (dossier, état) ;
   * « Annuler » la laisse telle quelle.
   */
  async function ouvrirNeuve(id) {
    await openFlow(id);
    const T = window.OdinTalosDossiers;
    if (!T || wf?.id !== id) return;
    const c = await T.choisir(wf);
    if (!c || wf?.id !== id) return;
    const s = $('#drSt');
    if (c.dossier) { const r = await api('/api/draupnir/ranger', { id, dossier: c.dossier }).catch((e) => ({ ok: false, error: e.message })); if (!r.ok) { if (s) s.textContent = `✗ ${r.error}`; return; } if (wf?.id === id) wf.dossier = c.dossier; }
    if (c.active) { const r = await api('/api/draupnir/toggle', { id, on: true }).catch((e) => ({ ok: false, error: e.message })); if (!r.ok) { if (s) s.textContent = `✗ ${r.error}`; return; } if (wf?.id === id) wf.active = true; }
    if (wf?.id !== id) return;
    $('#v-flows .dr-bar .td-barre')?.replaceWith(T.barre(wf, () => wf));
    if (s) s.textContent = c.active ? '✓ Enregistrée, active.' : '✓ Enregistrée en brouillon.';
  }
  const outputsOf = (n) => outs[n.name] ?? cat(n.type)?.outputs ?? ['sortie'];
  function editor(r) {
    const box = $('#v-flows .body');
    $('#v-flows .head h1').textContent = wf.name; $('#v-flows .head .sub').textContent = 'Glisse les étapes ; relie-les en tirant un fil d\'une sortie (rond à droite) jusqu\'à une étape, ou en touchant la sortie puis l\'entrée (rond à gauche). Touche un fil pour le retirer ou y ajouter un bloc. Clique une étape pour la régler. Le « + » d\'une étape (ou un double-clic sur la fenêtre) ajoute un bloc. Clic droit, appui long ou « ⋯ » sur une étape : la renommer, y mettre une note, la retirer (double-clic sur son nom : la renommer).';
    const canvas = el('div', { class: 'dr-canvas', id: 'drCanvas', role: 'application', 'aria-label': 'Schéma de l\'automatisation' });
    const svg = sv('svg'); const world = el('div', { class: 'dr-world' }); canvas.append(svg, world);
    const side = el('aside', { class: 'dr-side', id: 'drSide', 'aria-label': 'Réglages' });
    const status = el('span', { class: 'sub', role: 'status', id: 'drSt' });
    box.replaceChildren(
      el('div', { class: 'dr-bar' }, el('button', { class: 'btn small', type: 'button', onclick: async () => { if (!dirty || await window.OdinDialog.confirm('Quitter sans enregistrer ?')) openList(); } }, '← Automatisations'), el('label', { for: 'drName', class: 'sr' }, 'Nom'), el('input', { id: 'drName', class: 'dr-name', value: wf.name, oninput: (e) => { wf.name = e.target.value; dirty = true; } }),
        wf.id && window.OdinTalosDossiers ? window.OdinTalosDossiers.barre(wf, () => wf) : null,
        el('button', { class: 'btn small primary', type: 'button', onclick: save }, 'Enregistrer'), el('button', { class: 'btn small', type: 'button', onclick: () => test() }, 'Tester'), el('button', { class: 'btn small', type: 'button', onclick: () => { sel = null; drawSide(); } }, '+ Étape'),
        wf.id ? el('button', { class: 'btn small', type: 'button', onclick: async () => { if (!(await window.OdinDialog.confirm('Mettre cette automatisation à la corbeille ?', { danger: true }))) return; await api('/api/draupnir/trash', { id: wf.id }); openList(); } }, 'Corbeille') : null, status),
      el('div', { class: 'dr-ed' }, canvas, side),
      // (Pas d'exécution ni de version quand on part de zéro : rien, et surtout pas le mot « null ».)
      ...(r ? [el('section', { class: 'card', style: 'margin-top:12px' }, el('h2', { style: 'font-size:16px;margin:0' }, 'Dernières exécutions'), r.runs.length ? el('ul', { class: 'dr-runs' }, ...r.runs.slice(0, 10).map((x) => { const net = /attente.*internet|internet.*attente|en-attente-internet/i.test(`${x.status} ${x.error ?? ''}`); return el('li', {}, el('span', { class: `pill ${x.status === 'succès' ? 'good' : net ? '' : x.status === 'erreur' ? 'bad' : ''}` }, net ? 'en attente d\'Internet' : x.status), ` ${new Date(x.startedAt).toLocaleString('fr-FR')} · ${x.mode} · ${x.ms} ms${net ? ' · en attente du retour d\'Internet' : x.error ? ` · ${x.error}` : ''}`); })) : el('p', { class: 'sub' }, 'Jamais lancée.'),
        r.versions?.length ? el('details', {}, el('summary', { style: 'cursor:pointer;min-height:36px;display:flex;align-items:center' }, `Versions (${r.versions.length})`), el('ul', { class: 'dr-runs' }, ...r.versions.slice(0, 15).map((v) => el('li', {}, `${new Date(v.at).toLocaleString('fr-FR')} · ${v.nodes} étapes `, el('button', { class: 'btn small', type: 'button', onclick: async () => { if (!(await window.OdinDialog.confirm('Revenir à cette version ?'))) return; const x = await api('/api/draupnir/restore', { id: wf.id, at: v.at }); if (x.ok) openFlow(wf.id); } }, 'Restaurer'))))) : null)] : []));
    pan(canvas, world); draw(); drawSide();
    // Les blocs d'appli se dessinent avec l'icône et le nom de leur appli : on lit la liste des applis une fois.
    if (!applisFaite && wf.nodes.some((n) => n.type === 'module.action' || n.type === 'déclencheur.module')) { const w = wf; void chargerApplis().then(() => { if (wf === w) draw(); }); }
  }
  function nodeEl(n) {
    const c = cat(n.type), run = last?.nodes?.[n.name];
    // Un bloc d'appli : l'icône et le nom de l'appli, puis sa fonction (ou ce qu'elle signale) en clair ; son nom s'il a été changé.
    const ia = infoAppli(n, applisListe), manque = ia?.f ? manquants(n, ia.f) : [];
    // (.dr-nom : là où se lit le nom du bloc ; un double-clic dessus le renomme)
    const nomAPart = ia && n.name !== ia.auto && n.name !== ia.titre;
    const tete = ia ? [el('div', { class: 'dr-ap' }, window.OdinLien?.icone ? window.OdinLien.icone(ia.a, 22) : null, el('small', {}, ia.a.nom)), el('b', { class: nomAPart ? undefined : 'dr-nom' }, ia.titre),
      nomAPart ? el('small', { class: 'dr-nn dr-nom' }, n.name) : null,
      manque.length ? el('span', { class: 'dr-manque' }, `À remplir : ${manque.join(', ')}`) : null]
      : [el('small', {}, c?.group ?? '?', ' · ', c?.label ?? n.type), el('b', { class: 'dr-nom' }, n.name)];
    // La note : une petite marque sur le bloc ; son texte décrit le bloc (lecteur d'écran) et se lit dans une bulle (bulle()).
    const aNote = typeof n.note === 'string' && n.note !== '', idNote = aNote ? `drnote-${wf.nodes.indexOf(n)}` : undefined;
    const d = el('div', { class: `dr-node${c?.trigger ? ' trig' : ''}${n.disabled ? ' off' : ''}${sel === n.name ? ' sel' : ''}${run ? (run.error ? ' err' : ' ok') : ''}`, tabindex: '0', role: 'button', 'aria-label': ia ? `${ia.a.nom} : ${ia.titre} (${n.name})` : `${n.name} (${c?.label ?? n.type})`, 'aria-describedby': idNote, style: `left:${n.position?.[0] ?? 0}px;top:${n.position?.[1] ?? 0}px` },
      ...tete, run ? el('span', { class: 'dr-cnt' }, run.error ? `✗ ${run.error.slice(0, 40)}` : `${run.count} élément(s)`) : null,
      aNote ? el('span', { class: 'dr-note-m', 'aria-hidden': 'true' }) : null, aNote ? el('span', { class: 'sr', id: idNote }, `Note : ${n.note}`) : null);
    // Le bouton « ⋯ » : le menu du bloc. Zone de 44 px à l'écran (comme les ronds), au milieu du bord haut, loin des ronds, et au-dessus du bloc : même dézoomé, le corps du bloc reste à toucher (choisir, glisser).
    // Un toucher dessus ouvre le menu (pointerup plus bas) ; un geste parti de lui fait glisser le bloc, comme partout sur le bloc.
    const mb = el('button', { class: 'dr-mb', type: 'button', title: 'Menu du bloc', 'aria-haspopup': 'menu', 'aria-label': `Menu de ${n.name}`, onclick: (e) => {
      e.stopPropagation(); if (e.detail) return; // (souris, doigt : déjà ouvert au lever ; ici, le clavier)
      ouvrirParBouton();
    } }, el('span', { 'aria-hidden': 'true' }, '⋯'));
    const ouvrirParBouton = () => { const b = mb.getBoundingClientRect?.(), r = $('#drCanvas')?.getBoundingClientRect?.(); menuBloc(n.name, b && r && b.width ? [b.left - r.left, b.top + b.height - r.top] : coinBloc(n)); };
    d.append(mb);
    // Les ronds : la zone touchable fait 44 px à l'écran quel que soit le zoom (--dr-z) ; le rond dessiné garde ses 18 px,
    // à la même place (::before). Entrée touchée sans sortie armée : comme toucher le bloc (sa zone mord sur le bloc).
    if (!c?.trigger) d.append(el('button', { class: 'dr-port in', type: 'button', 'aria-label': `Entrée de ${n.name}`, onclick: (e) => { e.stopPropagation(); if (armed) { link(armed.node, armed.out, n.name); armed = null; draw(); } else { sel = n.name; draw(); drawSide(); } } }));
    const sorties = outputsOf(n);
    // Plusieurs sorties : le bloc est assez haut pour que la dernière ne passe pas sous le « + » ; les zones de deux
    // sorties voisines se partagent l'écart (le rond le plus proche l'emporte).
    if (sorties.length > 1) d.style.minHeight = `${58 + 22 * (sorties.length - 1)}px`;
    // Une sortie : un toucher l'arme (puis un toucher sur une entrée relie), ou on en TIRE un fil jusqu'à un bloc.
    sorties.forEach((o, i, all) => { const b = el('button', { class: `dr-port out${armed && armed.node === n.name && armed.out === i ? ' armed' : ''}`, type: 'button', style: styleSortie(i, all.length), 'aria-label': `Sortie ${o} de ${n.name}`, onclick: (e) => { e.stopPropagation(); if (e.timeStamp - tireFin < 500) return; armed = armed && armed.node === n.name && armed.out === i ? null : { node: n.name, out: i }; draw(); } }, all.length > 1 ? el('span', { class: 'dr-pl' }, o) : null); tirable(b, n, i); d.append(b); });
    // Le « + » du côté de la sortie : un bloc de plus, posé à droite et relié à celui-ci.
    d.append(el('button', { class: 'dr-plus', type: 'button', title: 'Ajouter un bloc à la suite', 'aria-label': `Ajouter un bloc après ${n.name}`, onclick: (e) => { e.stopPropagation(); void ouvrirChoix({ de: { node: n.name, out: sortieDuPlus(wf, n.name, sorties.length) } }); } }, el('span', { 'aria-hidden': 'true' }, '+')));
    let start = null, long = 0;
    const finLong = () => { if (long) clearTimeout(long); long = 0; };
    d.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.dr-port') || e.target.closest('.dr-plus') || e.target.closest('.dr-renom-z')) return;
      if (e.button > 0) return; // (le clic droit ne fait pas glisser le bloc : il ouvre son menu)
      e.stopPropagation(); d.setPointerCapture(e.pointerId); start = { x: e.clientX, y: e.clientY, p: [...(n.position ?? [0, 0])], moved: false, nom: Boolean(e.target.closest('.dr-nom')), menu: Boolean(e.target.closest('.dr-mb')) };
      // Au doigt : un appui long (sans bouger) ouvre le menu du bloc, au lieu de le choisir.
      finLong();
      if (e.pointerType === 'touch' || e.pointerType === 'pen') long = setTimeout(() => { long = 0; if (!start || start.moved) return; start = null; const r = $('#drCanvas')?.getBoundingClientRect?.() ?? { left: 0, top: 0 }; menuBloc(n.name, [e.clientX - r.left, e.clientY - r.top]); }, APPUI_LONG);
    });
    d.addEventListener('pointermove', (e) => { if (!start) return; const dx = (e.clientX - start.x) / view.k, dy = (e.clientY - start.y) / view.k; if (Math.abs(dx) + Math.abs(dy) > 3) { start.moved = true; finLong(); } n.position = [Math.round(start.p[0] + dx), Math.round(start.p[1] + dy)]; d.style.left = `${n.position[0]}px`; d.style.top = `${n.position[1]}px`; lines(); });
    // Un toucher parti d'un rond ou du « + » n'est pas un clic sur le bloc : on ne redessine pas (le bouton doit recevoir son clic).
    // Deux touchers rapprochés sur le NOM du bloc : on le renomme.
    d.addEventListener('pointerup', (e) => {
      finLong(); if (!start) return;
      if (start.moved) { dirty = true; start = null; return; }
      if (start.menu) { start = null; tapNom = null; ouvrirParBouton(); return; }
      const t = { t: e.timeStamp, x: e.clientX, y: e.clientY, bloc: n.name }, surNom = start.nom; start = null;
      if (surNom && tapNom?.bloc === n.name && estDoubleTouche(tapNom, t)) { tapNom = null; commencerRenommer(n.name); return; }
      tapNom = surNom ? t : null;
      sel = n.name; draw(); drawSide();
    });
    d.addEventListener('pointercancel', () => { finLong(); start = null; });
    // Le clic droit sur le bloc : son menu, à la place de celui du navigateur (le champ du nom garde celui du navigateur).
    d.addEventListener('contextmenu', (e) => {
      if (e.target?.closest?.('.dr-renom-z')) return;
      e.preventDefault(); e.stopPropagation?.();
      if (menuFil?.bloc === n.name) return; // (après un appui long, le navigateur du téléphone l'envoie aussi : un seul menu)
      finLong(); start = null;
      const r = $('#drCanvas')?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      menuBloc(n.name, e.clientX || e.clientY ? [e.clientX - r.left, e.clientY - r.top] : coinBloc(n));
    });
    // La bulle de la note : au survol (souris) et au focus du bloc.
    d.addEventListener('pointerenter', (e) => { if (e.pointerType && e.pointerType !== 'mouse') return; survol = n.name; bulle(); });
    d.addEventListener('pointerleave', () => { if (survol === n.name) { survol = null; bulle(); } });
    d.addEventListener('focusin', (e) => { if (e.target === d) { survol = n.name; bulle(); } });
    d.addEventListener('focusout', (e) => { if (e.target === d && survol === n.name) { survol = null; bulle(); } });
    // Entrée sur un bouton du bloc (rond, « + ») appartient à ce bouton. La touche Menu (ou Maj+F10) ouvre le menu du bloc.
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuFil?.bloc === n.name) { e.preventDefault(); fermerMenu(true); return; } // (focus resté sur le bloc, après un toucher)
      if (e.target !== d) return;
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); menuBloc(n.name, coinBloc(n)); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sel = n.name; draw(); drawSide(); } if (e.key === 'Delete') removeNode(n.name);
    });
    return d;
  }
  function link(from, out, to) { if (relier(wf, from, out, to)) dirty = true; }
  /** Le point (en coordonnées du schéma) sous le pointeur. */
  const sousPointeur = (e) => { const r = $('#drCanvas')?.getBoundingClientRect?.() ?? { left: 0, top: 0 }; return [(e.clientX - r.left - view.x) / view.k, (e.clientY - r.top - view.y) / view.k]; };
  // Fil tiré : depuis une sortie, le fil suit le pointeur ; lâché sur un bloc, le lien se pose (mêmes refus que les deux
  // touchers) ; lâché ailleurs, rien ne change. Un geste de moins de 6 px reste un toucher (il arme la sortie).
  let tireFin = -Infinity;
  function tirable(b, n, out) {
    let g = null;
    const fin = () => { g = null; $('#drCanvas svg .dr-tire')?.remove(); for (const d of elems.values()) d.classList.remove('dr-cible'); };
    const cible = (e) => {
      // (la cible : le bloc, élargi de son rond d'entrée, dont une moitié dépasse à gauche)
      const nom = blocSous([...elems].map(([name, d]) => {
        const r = d.getBoundingClientRect(), p = d.querySelector('.dr-port.in')?.getBoundingClientRect?.();
        const left = p?.width ? Math.min(r.left, p.left) : r.left, top = p?.height ? Math.min(r.top, p.top) : r.top;
        const right = p?.width ? Math.max(r.left + r.width, p.left + p.width) : r.left + r.width, bottom = p?.height ? Math.max(r.top + r.height, p.top + p.height) : r.top + r.height;
        return { name, left, top, width: right - left, height: bottom - top };
      }), e.clientX, e.clientY);
      const m = nom ? wf.nodes.find((x) => x.name === nom) : null;
      return m ? { nom, refus: refusLien(wf, n.name, out, nom, Boolean(cat(m.type)?.trigger)) } : null;
    };
    b.addEventListener('pointerdown', (e) => { if (e.button > 0) return; e.stopPropagation(); fermerMenu(); g = { x: e.clientX, y: e.clientY, moved: false }; b.setPointerCapture?.(e.pointerId); });
    b.addEventListener('pointermove', (e) => {
      if (!g) return;
      if (!g.moved && Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) < 6) return;
      g.moved = true;
      const svg = $('#drCanvas svg'); if (!svg) return;
      const x1 = (n.position?.[0] ?? 0) + NODE_W + 10, y1 = (n.position?.[1] ?? 0) + 27 + out * 22, [x2, y2] = sousPointeur(e), dx = Math.max(30, Math.abs(x2 - x1) / 2);
      let p = svg.querySelector('.dr-tire');
      if (!p) { p = sv('path', { class: 'dr-tire' }); svg.append(p); }
      p.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
      p.setAttribute('d', `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
      const c = cible(e);
      for (const [nom, d] of elems) d.classList.toggle('dr-cible', Boolean(c && !c.refus && c.nom === nom));
    });
    b.addEventListener('pointerup', (e) => {
      if (!g) return;
      const bouge = g.moved; fin();
      if (!bouge) return; // un simple toucher : le clic arme la sortie, comme avant
      tireFin = e.timeStamp;
      const c = cible(e), s = $('#drSt');
      if (!c) return; // lâché ailleurs : rien ne change
      if (c.refus) { if (s) s.textContent = `Pas de lien : ${c.refus}`; return; }
      link(n.name, out, c.nom); armed = null; draw();
      if (s) s.textContent = `✓ « ${n.name} » relié à « ${c.nom} ».`;
    });
    b.addEventListener('pointercancel', fin);
  }
  // ---------------- Le petit menu d'un fil : « Retirer ce lien », « Ajouter un bloc ici ». Échap ou un toucher ailleurs le referme.
  let menuFil = null, glisse = false; // (glisse : un glissement du schéma parti d'un fil vient de finir ; le prochain appui l'efface)
  const cleFil = (f) => JSON.stringify([f.de, f.out, f.vers]);
  function fermerMenu(rendre = false) {
    if (!menuFil) return;
    const { boite, dehors, retour } = menuFil; menuFil = null;
    boite.remove(); document.removeEventListener?.('pointerdown', dehors, true);
    $('#drCanvas svg .dr-fil.on')?.classList.remove('on');
    if (rendre) retour?.()?.focus?.();
  }
  /** Ouvre le menu du fil `fil` ({ de, out, vers }) au point [x, y] de la fenêtre du schéma. */
  function ouvrirMenu(fil, point, zone) {
    menuDe({ label: `Lien ${fil.de} → ${fil.vers}`, point, zone, retour: () => [...($('#drCanvas svg')?.querySelectorAll('.dr-fil') ?? [])].find((x) => x.getAttribute('data-cle') === cleFil(fil)), choix: [
      ['Retirer ce lien', async () => { if (!(await window.OdinDialog.confirm(`Retirer le lien ${fil.de} → ${fil.vers} ?`))) return; if (retirerLien(wf, fil.de, fil.out, fil.vers)) { dirty = true; draw(); } }],
      ['Ajouter un bloc ici', () => void ouvrirChoix({ milieu: fil })]] });
  }
  /**
   * Le menu d'un bloc (clic droit, appui long, « ⋯ », touche Menu) : Renommer, Ajouter / Modifier la note, Retirer.
   * Même dessin et mêmes gestes que celui d'un fil ; Échap rend le focus au bloc.
   */
  function menuBloc(nom, point) {
    const n = wf?.nodes.find((x) => x.name === nom); if (!n) return;
    menuDe({ label: `Bloc ${nom}`, point, bloc: nom, retour: () => elems.get(nom), choix: [
      ['Renommer', () => commencerRenommer(nom)],
      [typeof n.note === 'string' && n.note !== '' ? 'Modifier la note' : 'Ajouter une note', () => ouvrirNote(nom)],
      ['Retirer', () => removeNode(nom)]] });
  }
  /** Le point (dans la fenêtre du schéma) sous le « ⋯ » d'un bloc : où s'ouvre son menu au clavier. */
  const coinBloc = (n) => [((n.position?.[0] ?? 0) + NODE_W - 70) * view.k + view.x, ((n.position?.[1] ?? 0) + 22) * view.k + view.y];
  function menuDe({ label, point: [x, y], zone, retour, choix: items, bloc }) {
    fermerMenu();
    const canvas = $('#drCanvas'); if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const gauche = r.width ? Math.max(8, Math.min(x, r.width - 216)) : x, haut = r.height ? Math.max(8, Math.min(y, r.height - 20 - 46 * items.length)) : y;
    const action = (f) => () => { fermerMenu(true); f(); };
    const boite = el('div', { class: 'dr-fil-menu', role: 'menu', 'aria-label': label, style: `left:${Math.round(gauche)}px;top:${Math.round(haut)}px` },
      ...items.map(([t, f]) => el('button', { type: 'button', role: 'menuitem', onclick: action(f) }, t)));
    boite.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermerMenu(true); } });
    // (la touche Menu, ou un clic droit, sur le menu lui-même : pas de menu du navigateur par-dessus)
    boite.addEventListener('contextmenu', (e) => e.preventDefault());
    // Sortir du menu par Tab le referme. (Un focus perdu sans destination — un clic sur un choix, selon le navigateur — ne le ferme pas.)
    // Au doigt, le navigateur donne le focus au bloc touché (ou à son « ⋯ ») APRÈS l'ouverture du menu : ce n'est pas en sortir.
    boite.addEventListener('focusout', (e) => { const vers = e.relatedTarget; if (vers && vers.closest?.('.dr-fil-menu') !== boite && !(bloc && vers.closest?.('.dr-node') === elems.get(bloc)) && menuFil?.boite === boite) fermerMenu(); });
    fleches(boite);
    const dehors = (e) => { if (!e.target?.closest?.('.dr-fil-menu')) fermerMenu(); };
    menuFil = { boite, dehors, retour, bloc };
    zone?.classList.add('on');
    canvas.append(boite);
    document.addEventListener('pointerdown', dehors, true);
    boite.querySelector('button')?.focus?.();
  }
  // ---------------- Renommer sur place, la note d'un bloc et sa bulle.
  let tapNom = null, survol = null; // (le dernier toucher sur le nom d'un bloc ; le bloc survolé ou qui a le focus)
  const dire = (t) => { const s = $('#drSt'); if (s) s.textContent = t; };
  /** Le nom se modifie sur le bloc : Entrée valide, Échap annule, quitter le champ valide (un nom refusé ne change rien). */
  function commencerRenommer(nom) {
    const d = elems.get(nom); if (!d || !wf.nodes.some((x) => x.name === nom)) return;
    fermerMenu();
    const place = d.querySelector('.dr-nom');
    const err = el('small', { class: 'dr-renom-e', id: 'drRenomE', role: 'alert', hidden: true });
    const inp = el('input', { class: 'dr-renom', type: 'text', value: nom, 'aria-label': `Nouveau nom de l'étape « ${nom} »`, 'aria-describedby': 'drRenomE', spellcheck: 'false', autocomplete: 'off', enterkeyhint: 'done' });
    const zone = el('span', { class: 'dr-renom-z' }, inp, err);
    zone.style.top = `${Math.max(0, (place?.offsetTop ?? 22) - 4)}px`;
    place?.classList.add('dr-cache');
    let fini = false;
    const valider = (rester) => {
      if (fini) return;
      const n = wf.nodes.find((x) => x.name === nom), v = n ? nomPossible(n, inp.value) : nomValide(wf, nom, inp.value);
      if (n && !v.ok && rester) { err.textContent = v.error; err.hidden = false; inp.setAttribute('aria-invalid', 'true'); inp.focus?.(); return; }
      fini = true;
      if (!n || !v.ok) { draw(); if (v.error) dire(`Nom inchangé : ${v.error}`); return; }
      if (v.nom === nom) draw(); else { rename(n, v.nom); dire(`✓ « ${nom} » renommé « ${v.nom} ».`); }
      if (sel === v.nom) drawSide();
      if (rester) elems.get(v.nom)?.focus?.();
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation?.();
      if (e.key === 'Enter') { e.preventDefault(); valider(true); }
      else if (e.key === 'Escape') { e.preventDefault(); fini = true; draw(); elems.get(nom)?.focus?.(); }
    });
    inp.addEventListener('focusout', () => valider(false));
    d.append(zone);
    // Le champ garde une taille d'écran lisible (--dr-ik) : s'il dépasse de la fenêtre du schéma, il se décale vers l'intérieur.
    const c = $('#drCanvas')?.getBoundingClientRect?.(), z = zone.getBoundingClientRect?.();
    if (c?.width && z?.width) { const dx = z.right > c.right - 6 ? z.right - c.right + 6 : z.left < c.left + 6 ? z.left - c.left - 6 : 0; if (dx) zone.style.left = `${Math.round(4 - dx / (view.k || 1))}px`; }
    try { inp.focus?.({ preventScroll: true }); } catch { inp.focus?.(); }
    inp.select?.();
  }
  /** La note d'un bloc : une fenêtre avec son texte ; « Enregistrer la note », « Retirer la note », « Annuler » (ou Échap). */
  function ouvrirNote(nom) {
    const n = wf?.nodes.find((x) => x.name === nom); if (!n) return;
    fermerChoix(); fermerMenu();
    const avant = typeof n.note === 'string' ? n.note : '';
    const finir = (texte) => {
      fermerChoix();
      const m = wf.nodes.find((x) => x.name === nom);
      if (texte !== null && m && poserNote(m, texte)) { dirty = true; draw(); dire(m.note ? `✓ Note de « ${nom} » enregistrée.` : `✓ Note de « ${nom} » retirée.`); }
      elems.get(nom)?.focus?.();
    };
    const ta = el('textarea', { id: 'drNoteT', spellcheck: 'true' }, avant);
    const boite = el('div', { class: 'dr-choix dr-note-ed', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drNoteH' },
      el('div', { class: 'dr-ch-h' }, el('h2', { id: 'drNoteH' }, `Note de « ${nom} »`), el('button', { class: 'dr-ch-x', type: 'button', 'aria-label': 'Fermer', onclick: () => finir(null) }, '×')),
      el('div', { class: 'dr-ch-c' }, el('label', { for: 'drNoteT' }, 'Ta note sur ce bloc (elle ne change rien à ce qu\'il fait)'), ta,
        el('div', { class: 'dr-row' }, el('button', { class: 'btn primary', type: 'button', onclick: () => finir(ta.value) }, 'Enregistrer la note'),
          avant ? el('button', { class: 'btn', type: 'button', onclick: () => finir('') }, 'Retirer la note') : null,
          el('button', { class: 'btn', type: 'button', onclick: () => finir(null) }, 'Annuler'))));
    const fond = el('div', { class: 'dr-choix-fond', onclick: (e) => { if (e.target === fond) finir(null); } }, boite);
    boite.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finir(null); return; }
      if (e.key !== 'Tab') return; // Tab et Maj+Tab tournent dans la fenêtre
      const f = [...boite.querySelectorAll('button, textarea')], premier = f[0], dernier = f[f.length - 1];
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); } else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    });
    choix = { fond, retour: null };
    document.body.append(fond);
    ta.focus?.();
  }
  /** La bulle de la note du bloc survolé (ou qui a le focus, sinon du bloc choisi) : au-dessus de lui, à taille d'écran. */
  function bulle() {
    const canvas = $('#drCanvas'); if (!canvas) return;
    const aNote = (x) => { const t = wf?.nodes.find((m) => m.name === x)?.note; return typeof t === 'string' && t !== ''; };
    const nom = survol && aNote(survol) ? survol : sel, n = nom && wf ? wf.nodes.find((x) => x.name === nom) : null, d = nom ? elems.get(nom) : null;
    let b = canvas.querySelector('.dr-note-bulle');
    if (!n || !d || typeof n.note !== 'string' || !n.note) { b?.remove(); return; }
    if (!b) { b = el('div', { class: 'dr-note-bulle', 'aria-hidden': 'true' }); canvas.append(b); }
    b.textContent = n.note;
    const c = canvas.getBoundingClientRect(), r = d.getBoundingClientRect(), w = Math.min(260, Math.max(120, (c.width || 276) - 16));
    b.style.maxWidth = `${w}px`;
    const h = b.offsetHeight || 0, haut = r.top - c.top - h - 8;
    b.style.left = `${Math.round(Math.max(8, Math.min(r.left - c.left, (c.width || 0) - w - 8)))}px`;
    b.style.top = `${Math.round(haut >= 4 ? haut : r.top - c.top + r.height + 8)}px`;
  }
  /** Le point de la fenêtre (en coordonnées du schéma) où poser un bloc centré sous [px, py] (pixels dans la fenêtre). */
  const pointSchema = (px, py) => [Math.round((px - view.x) / view.k - NODE_W / 2), Math.round((py - view.y) / view.k - 30)];
  function draw() {
    const world = $('#drCanvas .dr-world'); if (!world) return;
    fermerMenu(); // (le schéma change : le fil du menu peut ne plus exister)
    survol = null; // (les blocs sont refaits : celui qui était survolé ou avait le focus n'existe plus ; la bulle suit le bloc choisi)
    elems = new Map();
    world.replaceChildren(...wf.nodes.map((n) => { const d = nodeEl(n); elems.set(n.name, d); return d; })); lines();
    // Fenêtre vide : un grand « + » au centre, pour le premier bloc.
    const canvas = $('#drCanvas'); canvas.querySelector('.dr-vide')?.remove();
    if (!wf.nodes.length) canvas.append(el('div', { class: 'dr-vide' }, el('button', { type: 'button', class: 'dr-vide-plus', 'aria-label': 'Ajouter le premier bloc', onclick: () => { const r = canvas.getBoundingClientRect(); void ouvrirChoix({ a: r.width ? pointSchema(r.width / 2, r.height / 2) : [60, 160] }); } }, '+'), el('p', {}, 'Ajoute le premier bloc : ce qui fait partir l\'automatisation.')));
  }
  function lines() {
    const svg = $('#drCanvas svg'); if (!svg) return; svg.replaceChildren();
    const g = sv('g', { transform: `translate(${view.x} ${view.y}) scale(${view.k})` }); svg.append(g);
    for (const [from, list] of Object.entries(wf.connections)) {
      const a = wf.nodes.find((n) => n.name === from); if (!a) continue;
      list.forEach((targets, i) => (targets ?? []).forEach((l) => {
        const b = wf.nodes.find((n) => n.name === l.node); if (!b) return;
        const x1 = a.position[0] + NODE_W + 10, y1 = a.position[1] + 27 + i * 22, x2 = b.position[0] - 10, y2 = b.position[1] + 33, dx = Math.max(40, Math.abs(x2 - x1) / 2);
        const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
        // Le fil dessiné, et par-dessus une zone large et invisible qui se touche (et se choisit au clavier) : elle ouvre le menu du fil.
        const fil = { de: from, out: i, vers: l.node }, so = outputsOf(a).length > 1 ? outputsOf(a)[i] ?? '' : '';
        const z = sv('path', { class: 'dr-fil', d, tabindex: '0', role: 'button', 'aria-haspopup': 'menu', 'data-de': from, 'data-vers': l.node, 'data-cle': cleFil(fil), 'aria-label': `Lien ${from} → ${l.node}${so ? ` (sortie ${so})` : ''}` });
        z.addEventListener('click', (e) => { if (glisse) return; const r = $('#drCanvas').getBoundingClientRect(); ouvrirMenu(fil, [e.clientX - r.left, e.clientY - r.top], z); });
        z.addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); ouvrirMenu(fil, [(x1 + x2) / 2 * view.k + view.x, (y1 + y2) / 2 * view.k + view.y], z); });
        g.append(sv('path', { class: 'dr-link', d }), z);
      }));
    }
    bulle(); // (le schéma a bougé : la bulle d'une note suit son bloc)
  }
  function pan(canvas, world) {
    // (--dr-z, --dr-zf : les zones de toucher des ronds et des fils gardent 44 et 22 px à l'écran, même dézoomé)
    const apply = () => { world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`; canvas.style.setProperty?.('--dr-z', `${zoneToucher(view.k)}px`); canvas.style.setProperty?.('--dr-zf', `${zoneToucher(view.k, 22)}px`); canvas.style.setProperty?.('--dr-ik', String(Math.max(1, 1 / (view.k || 1)))); lines(); };
    let s = null;
    // Cadrage : tout le schéma visible à l'ouverture.
    requestAnimationFrame(() => {
      const r = canvas.getBoundingClientRect(); if (!wf.nodes.length || !r.width) return;
      const xs = wf.nodes.map((n) => n.position[0]), ys = wf.nodes.map((n) => n.position[1]);
      const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + NODE_W + 30, y0 = Math.min(...ys) - 30, y1 = Math.max(...ys) + 90;
      view.k = Math.min(1.1, Math.max(0.4, Math.min(r.width / (x1 - x0), r.height / (y1 - y0))));
      view.x = (r.width - (x1 - x0) * view.k) / 2 - x0 * view.k; view.y = (r.height - (y1 - y0) * view.k) / 2 - y0 * view.k; apply();
    });
    // Un geste parti d'un fil fait aussi glisser le schéma, mais seulement au-delà de 6 px : en deçà, rien n'est
    // redessiné ni capturé, et le clic qui suit ouvre le menu du fil. Après un glissement, ce clic n'ouvre rien.
    canvas.addEventListener('pointerdown', (e) => {
      if (e.target !== canvas && !e.target.closest('svg')) return;
      const fil = Boolean(e.target.closest('.dr-fil'));
      s = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, fil, id: e.pointerId };
      if (fil) return;
      canvas.setPointerCapture(e.pointerId); if (armed) { armed = null; draw(); }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!s) return;
      if (Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) > 6 && !s.moved) { s.moved = true; if (s.fil) { fermerMenu(); canvas.setPointerCapture?.(s.id); } }
      if (s.fil && !s.moved) return;
      view.x = s.vx + e.clientX - s.x; view.y = s.vy + e.clientY - s.y; apply();
    });
    canvas.addEventListener('pointercancel', () => { s = null; });
    // Double-clic (ou double toucher) sur un endroit vide : la même fenêtre que le « + », le bloc se pose là.
    let tap = null;
    canvas.addEventListener('pointerup', (e) => {
      glisse = Boolean(s?.fil && s.moved);
      const t = s && !s.moved && !s.fil ? { t: e.timeStamp, x: e.clientX, y: e.clientY } : null; s = null;
      if (!t) { tap = null; return; }
      if (!estDoubleTouche(tap, t)) { tap = t; return; }
      tap = null; const r = canvas.getBoundingClientRect(); void ouvrirChoix({ a: pointSchema(t.x - r.left, t.y - r.top) });
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); fermerMenu(); const k = Math.min(1.6, Math.max(0.4, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; view.x = mx - (mx - view.x) * (k / view.k); view.y = my - (my - view.y) * (k / view.k); view.k = k; apply(); }, { passive: false });
    apply();
  }
  async function removeNode(name) {
    if (!(await window.OdinDialog.confirm(`Retirer l'étape « ${name} » ?`))) return;
    wf.nodes = wf.nodes.filter((n) => n.name !== name); delete wf.connections[name]; retires.add(name);
    for (const list of Object.values(wf.connections)) for (const t of list) for (let i = t.length - 1; i >= 0; i--) if (t[i].node === name) t.splice(i, 1);
    sel = null; dirty = true; draw(); drawSide();
  }
  function drawSide() {
    const side = $('#drSide'); if (!side) return;
    fermerDonnees(); for (const d of elems.values()) d.classList.remove('dr-source'); // (le panneau change : sa liste et ses pastilles partent)
    const n = wf.nodes.find((x) => x.name === sel);
    if (!n) {
      const groups = [...new Set(st.catalog.map((c) => c.group))];
      side.replaceChildren(el('h2', {}, 'Ajouter une étape'), el('p', { class: 'sub', style: 'margin:0' }, 'Clique une étape pour l\'ajouter, puis relie-la.'), el('div', { class: 'dr-cat' }, ...groups.flatMap((g) => [el('h3', {}, g), ...st.catalog.filter((c) => c.group === g).map((c) => el('button', { type: 'button', title: c.what, onclick: () => addNode(c) }, c.label))])));
      return;
    }
    const c = cat(n.type), run = last?.nodes?.[n.name];
    // Bloc d'appli : l'appli et sa fonction en clair (avec « Changer ») et les réglages en champs, au lieu de les taper.
    // Applis pas encore lues : on attend ; appli ou fonction introuvable : les champs d'avant restent.
    const blocAppli = n.type === 'module.action' || n.type === 'déclencheur.module';
    if (blocAppli && !applisFaite && window.OdinLien?.applis) {
      const w = wf; void chargerApplis().then(() => { if (wf === w && sel === n.name) { draw(); drawSide(); } });
      side.replaceChildren(el('h2', {}, c?.label ?? n.type), el('p', { class: 'sub', role: 'status' }, 'Chargement de l\'appli…'));
      return;
    }
    const ia = blocAppli ? infoAppli(n, applisListe) : null;
    const cache = ia ? (n.type === 'module.action' ? ['module', 'action', 'entrée'] : ['module', 'événement']) : [];
    // Planning : seul le champ du mode choisi se montre (un nœud sans mode garde son planning cron, comme avant).
    const planning = c?.type === 'déclencheur.planning' && (c.params ?? []).some((p) => p.key === 'mode'), mode = planning ? n.params.mode ?? 'cron' : undefined;
    const fields = (c?.params ?? []).filter((p) => !cache.includes(p.key)).map((p) => {
      if (planning && ((p.key === 'cron' && mode !== 'cron') || (p.key === 'minutes' && mode !== 'intervalle') || (p.kind === 'rythme' && mode !== 'simple'))) return [];
      const id = `drp-${p.key}`, v = planning && p.key === 'mode' ? mode : n.params[p.key] ?? p.default ?? '';
      const set = (val) => { n.params[p.key] = val; dirty = true; if (planning && p.key === 'mode') drawSide(); };
      if (p.kind === 'rythme') {
        // Le rythme en clair ; l'éditeur donne la valeur de départ tout de suite : ce n'est pas une modification.
        const setR = (val) => { const avant = n.params[p.key] ?? p.default; if (JSON.stringify(val) === JSON.stringify(avant)) { if (n.params[p.key] === undefined) n.params[p.key] = val; return; } set(val); };
        const input = window.OdinRythme ? window.OdinRythme.editeur({ valeur: v && typeof v === 'object' ? v : undefined, onChange: setR })
          : el('textarea', { id, spellcheck: 'false', oninput: (e) => { try { setR(JSON.parse(e.target.value)); } catch { /* pas encore un JSON */ } } }, JSON.stringify(v, null, 2));
        return [el('label', { for: id }, p.label, p.required ? ' *' : ''), input, p.help ? el('small', { class: 'sub' }, p.help) : null];
      }
      // Un texte (une ligne ou plusieurs) : un champ à pastilles, où l'on peut poser une donnée d'un bloc d'avant.
      if ((p.kind === undefined || p.kind === 'text' || p.kind === 'textarea') && typeof v === 'string') {
        const s = saisie({ id, valeur: v, multi: p.kind === 'textarea', nom: n.name, label: p.label, donnees: !c?.trigger, attrs: { 'aria-required': p.required ? 'true' : undefined }, onChange: set });
        return [el('label', { for: id, id: `${id}-lab`, onclick: () => document.getElementById(id)?.focus?.() }, p.label, p.required ? ' *' : ''), s.boite, p.help ? el('small', { class: 'sub' }, p.help) : null];
      }
      const input = p.kind === 'select' ? el('select', { id, onchange: (e) => set(e.target.value) }, ...(p.options ?? []).map((o) => el('option', { selected: o === v ? true : undefined }, o)))
        : p.kind === 'boolean' ? el('input', { id, type: 'checkbox', checked: v === true ? true : undefined, onchange: (e) => set(e.target.checked) })
        : p.kind === 'textarea' || p.kind === 'json' ? el('textarea', { id, oninput: (e) => set(e.target.value), spellcheck: 'false' }, typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v))
        : el('input', { id, type: p.kind === 'number' ? 'number' : 'text', value: String(v), oninput: (e) => set(p.kind === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value), spellcheck: 'false', autocomplete: 'off' });
      return [el('label', { for: id }, p.label, p.required ? ' *' : ''), input, p.help ? el('small', { class: 'sub' }, p.help) : null];
    });
    side.replaceChildren(el('h2', {}, c?.label ?? n.type), el('p', { class: 'sub', style: 'margin:0' }, c?.what ?? ''),
      el('label', { for: 'drNn' }, 'Nom de l\'étape'), el('input', { id: 'drNn', value: n.name, onchange: (e) => { const r = rename(n, e.target.value); if (!r.ok) { e.target.value = n.name; void window.OdinDialog.alert(r.error); } } }),
      ...(ia ? panneauAppli(n, ia) : []),
      ...fields.flat().filter(Boolean), // (un réglage sans aide donnait null, écrit « null » à l'écran)
      el('label', { class: 'va-chk', style: 'display:flex;gap:8px;align-items:center;font-weight:500' }, el('input', { type: 'checkbox', checked: n.disabled ? true : undefined, onchange: (e) => { n.disabled = e.target.checked || undefined; dirty = true; draw(); } }), 'Désactiver cette étape'),
      el('p', { class: 'sub', style: 'margin:0;font-size:13px' }, '« Données » à côté d\'un champ : y poser une donnée d\'un bloc d\'avant. Expressions : {{ $json.champ }}, {{ $node["Étape"].json.champ }}, {{ $now }}.'),
      el('div', { class: 'dr-row' }, el('button', { class: 'btn small', type: 'button', onclick: () => test(n.name) }, 'Tester jusqu\'ici'), el('button', { class: 'btn small', type: 'button', onclick: () => removeNode(n.name) }, 'Retirer'), el('button', { class: 'btn small', type: 'button', onclick: () => { sel = null; draw(); drawSide(); } }, 'Fermer')),
      ...(run ? [el('h2', { style: 'margin-top:6px' }, 'Dernier passage'), el('pre', { class: 'dr-out' }, run.error ? `✗ ${run.error}` : JSON.stringify(run.items.slice(0, 5), null, 2))] : []));
  }
  // ---------------- Le panneau d'un bloc d'appli : l'appli et sa fonction en clair, puis un champ par réglage déclaré.
  function panneauAppli(n, ia) {
    const L = window.OdinLien;
    const tete = el('div', { class: 'dr-app' }, L?.icone ? L.icone(ia.a, 32) : null, el('div', {}, el('b', {}, ia.a.nom), el('span', { class: 'dr-fn' }, ia.titre)),
      el('button', { class: 'btn small', type: 'button', 'aria-label': `Changer l'appli ou la fonction de ${n.name}`, onclick: () => void ouvrirChoix({ remplace: n.name }) }, 'Changer'));
    if (!ia.f) {
      // Déclencheur d'appli : « Changer » propose ce qu'elle déclare signaler ; tout autre événement (ou une
      // expression) se tape encore à la main, comme avant, derrière « Réglages avancés ».
      const ev = n.params['événement'] ?? '', connu = ev === '' || ev === 'alerte' || (ia.a.evenements ?? []).includes(ev);
      const inp = el('input', { id: 'drp-evenement', value: String(ev), spellcheck: 'false', autocomplete: 'off',
        oninput: (e) => { n.params['événement'] = e.target.value; dirty = true; },
        // (le panneau n'est pas redessiné : le focus reste dans le champ ; seuls le titre et le bloc suivent)
        onchange: () => { const t = infoAppli(n, applisListe)?.titre, s = tete.querySelector('.dr-fn'); if (t && s) s.textContent = t; draw(); } });
      const avE = el('details', { class: 'dr-av', open: connu ? undefined : true }, el('summary', {}, 'Réglages avancés'),
        el('label', { for: 'drp-evenement' }, 'Événement (vide : tout ce qu\'elle signale ; une expression {{ … }} est permise)'), inp);
      return [tete, avE];
    }
    const f = ia.f, zone = el('div', { class: 'dr-champs' });
    const brut = () => { const r = n.params['entrée']; return r && typeof r === 'object' ? JSON.stringify(r, null, 2) : String(r ?? ''); };
    // Le JSON d'avant, derrière « Réglages avancés » : tout ce qu'on pouvait régler reste réglable.
    const ta = el('textarea', { id: 'drp-entree', spellcheck: 'false', oninput: (e) => { n.params['entrée'] = e.target.value; dirty = true; }, onchange: () => { peindre(); draw(); } });
    const av = el('details', { class: 'dr-av' }, el('summary', {}, 'Réglages avancés'), el('label', { for: 'drp-entree' }, 'Les réglages en JSON (une expression {{ … }} est permise)'), ta);
    let manquait = manquants(n, f).length > 0;
    function peindre() {
      ta.value = brut();
      const l = lireEntree(n.params['entrée']), kids = [];
      if (!l.ok) {
        kids.push(el('p', { class: 'sub', style: 'margin:0' }, 'Ces réglages sont écrits d\'une façon que les champs ne savent pas montrer (une expression, par exemple) : ils se règlent dans « Réglages avancés ».'));
        av.setAttribute('open', '');
      } else if (!(f.params ?? []).length) kids.push(el('p', { class: 'sub', style: 'margin:0' }, 'Cette fonction ne déclare pas de réglage.'));
      else {
        champsDe(f, l.valeurs).forEach((c, i) => kids.push(...champ(c, i).filter(Boolean))); // (une aide absente donnait null, écrit « null »)
        const connus = new Set((f.params ?? []).map((p) => p.key)), plus = Object.keys(l.valeurs).filter((k) => !connus.has(k));
        if (plus.length) kids.push(el('p', { class: 'sub', style: 'margin:6px 0 0' }, `Réglages en plus, dans « Réglages avancés » : ${plus.join(', ')}.`));
      }
      zone.replaceChildren(...kids);
    }
    function champ(c, i) {
      const { p } = c, id = `drf-${i}`, aide = p.help ? `${id}-aide` : undefined;
      const manque = el('small', { class: 'dr-manque', id: `${id}-manque`, hidden: c.manque ? undefined : true }, 'Obligatoire : ce champ est vide.');
      const set = (val) => {
        n.params['entrée'] = ecrireEntree(n.params['entrée'], p.key, val); dirty = true; ta.value = brut();
        manque.hidden = !(p.required && vide(val));
        const m = manquants(n, f).length > 0; if (m !== manquait) { manquait = m; draw(); }
      };
      const lab = el('label', { for: id, id: `${id}-lab` }, p.label, p.required ? ' *' : '');
      const attrs = { id, 'aria-required': p.required ? 'true' : undefined, 'aria-describedby': [aide, `${id}-manque`].filter(Boolean).join(' ') };
      const defaut = p.default === undefined || p.default === '' ? '' : ` (par défaut : ${typeof p.default === 'boolean' ? (p.default ? 'oui' : 'non') : String(p.default)})`;
      let input;
      if (c.sorte === 'avance') return [lab, el('p', { class: 'sub', style: 'margin:0' }, 'Réglé dans « Réglages avancés ».'), p.help ? el('small', { class: 'sub', id: aide }, p.help) : null];
      if (c.sorte === 'ouinon' || c.sorte === 'liste') {
        const opts = c.sorte === 'ouinon' ? [['oui', 'Oui'], ['non', 'Non']] : (p.options ?? []).map((o) => [o, o]);
        const cur = c.sorte === 'ouinon' ? (c.valeur === true ? 'oui' : c.valeur === false ? 'non' : '') : c.valeur ?? '';
        input = el('select', { ...attrs, onchange: (e) => set(valeurChamp(c.sorte, e.target.value)) }, el('option', { value: '', selected: cur === '' ? true : undefined }, `—${defaut}`), ...opts.map(([v, t]) => el('option', { value: v, selected: v === cur ? true : undefined }, t)));
      } else if (c.sorte === 'texte' || c.sorte === 'nombre' || c.sorte === 'long') {
        // Un champ à pastilles : on y tape, ou on y pose une donnée d'un bloc d'avant (« Données »).
        lab.addEventListener('click', () => document.getElementById(id)?.focus?.());
        const s = saisie({ id, valeur: c.valeur === undefined ? '' : String(c.valeur), multi: c.sorte === 'long', nom: n.name, label: p.label, placeholder: defaut ? defaut.slice(2, -1) : undefined,
          dansJson: !(n.params['entrée'] && typeof n.params['entrée'] === 'object'), attrs: { ...attrs, inputmode: c.sorte === 'nombre' ? 'decimal' : undefined }, onChange: (t) => set(valeurChamp(c.sorte, t)) });
        return [lab, s.boite, p.help ? el('small', { class: 'sub', id: aide }, p.help) : null, manque];
      } else input = el('input', { ...attrs, type: 'password', value: c.valeur === undefined ? '' : String(c.valeur), placeholder: defaut ? defaut.slice(2, -1) : undefined, autocomplete: 'new-password', spellcheck: 'false', oninput: (e) => set(valeurChamp(c.sorte, e.target.value)) }); // (un mot de passe : sans pastille)
      return [lab, input, p.help ? el('small', { class: 'sub', id: aide }, p.help) : null, manque];
    }
    peindre();
    return [tete, zone, av];
  }
  // ---------------- Les champs à pastilles : un réglage où l'on pose une donnée d'un bloc d'avant. Le champ reste un texte
  // qu'on tape ; une donnée y est une pastille (le bloc et la donnée) qui garde, telle quelle, l'expression qu'elle montre.
  // Ce qui est enregistré : le texte et ces expressions, rien d'autre (lireSaisie).
  let renommes = new Map(), retires = new Set(), listeDn = null;
  const pointDe = new WeakMap(); // la dernière place du curseur dans chaque champ
  /** Le bloc d'origine d'une pastille s'illumine sur le schéma (au survol, au focus). */
  function allumer(bloc, on) { elems.get(bloc)?.classList.toggle('dr-source', on); }
  /** Le contenu d'un champ remis en texte : le texte tel quel, chaque pastille par son expression. */
  function lireSaisie(champ, multi) {
    let s = '';
    const kids = [...(champ.childNodes ?? [])];
    kids.forEach((k, i) => {
      if (k.nodeType === 3) s += k.nodeValue ?? '';
      else if (k.nodeType !== 1) return;
      else if (k.classList?.contains('dr-pastille')) s += k.getAttribute('data-src') ?? '';
      else if (k.tagName === 'BR') { if (multi && i < kids.length - 1) s += '\n'; } // (le dernier : celui que le navigateur ajoute)
      else { if (multi && s && !s.endsWith('\n')) s += '\n'; s += lireSaisie(k, multi); }
    });
    return s;
  }
  const apercu = (v) => { const t = v === null || v === undefined ? 'vide' : Array.isArray(v) ? `liste de ${v.length}` : typeof v === 'object' ? JSON.stringify(v) : String(v); return t.length > 60 ? `${t.slice(0, 59)}…` : t; };
  function pastilleEl(d, nom, dansJson, retiree) {
    let e = etatDonnee(d, wf, nom, renommes, retires);
    // Dans des réglages rangés en texte JSON, des guillemets doubles sont échappés : le moteur lirait vide.
    if (e.ok && dansJson && d.src.includes('"')) e = { ok: false, raison: 'Dans ces réglages, les guillemets doubles de cette donnée sont échappés : elle sera vide. Retire-la et pose-la de nouveau avec « Données ».' };
    const nomD = `${d.bloc} · ${libelleChemin(d.chemin)}`;
    const p = el('span', { class: `dr-pastille${e.ok ? '' : ' bad'}`, contenteditable: 'false', 'data-src': d.src, 'data-bloc': d.bloc, 'data-raison': e.ok ? undefined : e.raison, title: e.ok ? `Donnée de « ${d.bloc} » : ${libelleChemin(d.chemin)}` : e.raison },
      e.ok ? null : el('span', { class: 'dr-p-a', 'aria-hidden': 'true' }, '!'), el('span', { class: 'dr-p-t' }, nomD),
      el('button', { type: 'button', class: 'dr-p-x', 'aria-label': `Retirer la donnée ${nomD}${e.ok ? '' : ` (${e.raison})`}`, onmousedown: (ev) => ev.preventDefault(),
        onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); allumer(d.bloc, false); p.remove(); retiree(); } }, '×'));
    const on = () => allumer(d.bloc, true), off = () => allumer(d.bloc, false);
    p.addEventListener('pointerenter', on); p.addEventListener('pointerleave', off); p.addEventListener('focusin', on); p.addEventListener('focusout', off);
    return p;
  }
  /** Pose un nœud à la place du curseur dans le champ (jamais dans une pastille), sinon à la fin. */
  function poserNoeud(champ, k) {
    const s = window.getSelection?.(), vif = s?.rangeCount ? s.getRangeAt(0) : null, garde = pointDe.get(champ);
    let r = vif && champ.contains(vif.startContainer) ? vif : garde && champ.contains(garde.startContainer) ? garde.cloneRange() : null;
    if (!r) { champ.append(k); return; }
    const dans = (x) => (x?.nodeType === 3 ? x.parentNode : x)?.closest?.('.dr-pastille');
    const p = dans(r.startContainer) || dans(r.endContainer);
    if (p && champ.contains(p)) { r.setStartAfter(p); r.collapse(true); } else r.deleteContents();
    r.insertNode(k); r.setStartAfter(k); r.collapse(true);
    try { champ.focus?.({ preventScroll: true }); s?.removeAllRanges(); s?.addRange(r); } catch { /* rien */ }
    pointDe.set(champ, r.cloneRange());
  }
  /** La pastille juste avant (ou après) le curseur : Retour arrière (ou Suppr) la retire comme un caractère. */
  function pastilleVoisine(champ, avant) {
    const s = window.getSelection?.(); if (!s?.rangeCount || !s.isCollapsed) return null;
    const n = s.anchorNode, o = s.anchorOffset; if (!n || !champ.contains(n)) return null;
    let k;
    if (n.nodeType === 3) { if (avant ? o > 0 : o < (n.nodeValue ?? '').length) return null; k = avant ? n.previousSibling : n.nextSibling; } else k = avant ? n.childNodes[o - 1] : n.childNodes[o];
    return k?.nodeType === 1 && k.classList?.contains('dr-pastille') ? k : null;
  }
  /**
   * Un champ de réglage à pastilles : { boite, champ }. `valeur` : le texte enregistré (montré tel quel, ses données en
   * pastilles) ; `onChange(texte)` seulement quand on y touche. `dansJson` : le réglage est rangé dans un texte JSON
   * (les réglages d'une appli). `donnees` false : pas de bouton « Données » (un déclencheur n'a rien avant lui).
   */
  function saisie({ id, valeur, multi = false, nom, dansJson = false, label, attrs = {}, placeholder, donnees = true, onChange }) {
    const champ = el('div', { ...attrs, id, class: `dr-saisie${multi ? ' multi' : ''}`, role: 'textbox', contenteditable: 'plaintext-only', 'aria-multiline': multi ? 'true' : 'false', spellcheck: 'false', autocapitalize: 'off', 'data-placeholder': placeholder,
      // (un <label for> ne nomme pas un div : le nom vient du libellé par son id ; le texte d'exemple, dit aussi)
      'aria-labelledby': `${id}-lab`, 'aria-placeholder': placeholder,
      'aria-describedby': [attrs['aria-describedby'], `${id}-dn`].filter(Boolean).join(' ') });
    const alerte = el('small', { class: 'dr-manque', id: `${id}-dn`, hidden: true });
    const bouton = donnees ? el('button', { type: 'button', class: 'btn small dr-df-b', 'aria-expanded': 'false', 'aria-controls': `${id}-liste`, title: 'Prendre une donnée d\'un bloc d\'avant', 'aria-label': `Prendre une donnée d'un bloc d'avant pour « ${label} »` }, 'Données') : null;
    const zone = el('div', {});
    const boite = el('div', { class: 'dr-df' }, el('div', { class: 'dr-df-l' }, champ, bouton), alerte, zone);
    const verifier = () => { const r = [...new Set([...champ.querySelectorAll('.dr-pastille.bad')].map((x) => x.getAttribute('data-raison')))]; alerte.textContent = r.join(' '); alerte.hidden = !r.length; };
    const change = () => { onChange(lireSaisie(champ, multi)); verifier(); };
    const ctx = { champ, bouton, zone, nom, dansJson, label, change };
    ctx.pastille = (d) => pastilleEl(d, nom, dansJson, () => { change(); champ.focus?.(); });
    for (const m of decouper(valeur)) champ.append(m.src ? ctx.pastille(m) : m.texte);
    verifier();
    const garder = () => { const s = window.getSelection?.(); if (s?.rangeCount) { const r = s.getRangeAt(0); if (champ.contains(r.startContainer)) pointDe.set(champ, r.cloneRange()); } };
    for (const t of ['keyup', 'pointerup', 'focusout']) champ.addEventListener(t, garder);
    champ.addEventListener('input', () => { garder(); change(); });
    champ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !multi) { e.preventDefault(); return; }
      if (e.key === 'Escape' && listeDn?.champ === champ) { e.preventDefault(); e.stopPropagation(); fermerDonnees(); return; }
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const p = pastilleVoisine(champ, e.key === 'Backspace');
      if (p) { e.preventDefault(); allumer(p.getAttribute('data-bloc'), false); p.remove(); change(); }
    });
    // Coller : seulement du texte (et sur une ligne, pour un champ d'une ligne).
    champ.addEventListener('paste', (e) => {
      const t = e.clipboardData?.getData?.('text/plain'); if (typeof t !== 'string') return;
      e.preventDefault(); const u = multi ? t.replace(/\r\n?/g, '\n') : t.replace(/\r?\n/g, ' ');
      if (!document.execCommand?.('insertText', false, u)) { poserNoeud(champ, document.createTextNode(u)); change(); }
    });
    if (bouton) {
      bouton.addEventListener('click', () => { if (listeDn?.champ === champ) fermerDonnees(true); else ouvrirDonnees(ctx, true); });
      // Un clic dans le champ ouvre aussi la liste (sous le champ, sans prendre le focus : on peut continuer à taper).
      champ.addEventListener('click', (e) => { if (e.target?.closest?.('.dr-p-x')) return; if (listeDn?.champ !== champ && blocsAvant(wf, nom).length) ouvrirDonnees(ctx, false); });
    }
    return { boite, champ };
  }
  function fermerDonnees(rendre = false) {
    if (!listeDn) return;
    const { champ, bouton, boite } = listeDn; listeDn = null;
    boite.remove(); bouton?.setAttribute('aria-expanded', 'false');
    if (rendre) champ.focus?.();
  }
  /** La liste des données des blocs d'avant, sous le champ : rangée par bloc ; une donnée touchée s'y pose en pastille. */
  function ouvrirDonnees(ctx, focusListe) {
    fermerDonnees();
    const { champ, bouton, zone, nom, dansJson, label } = ctx, avant = blocsAvant(wf, nom);
    const p = (t) => el('p', { class: 'sub', style: 'margin:0;font-size:13px' }, t);
    const kids = [el('div', { class: 'dr-dn-h' }, el('h3', { id: `${champ.id}-liste-t` }, 'Données des blocs d\'avant'), el('button', { type: 'button', class: 'btn small', onclick: () => fermerDonnees(true) }, 'Fermer'))];
    if (!avant.length) kids.push(p('Aucun bloc n\'est relié avant celui-ci : relie un bloc à son entrée pour prendre ses données.'));
    else kids.push(p(`Touche une donnée pour la poser dans « ${label} ». Ce sont celles vues au dernier passage de chaque bloc : un bloc ne dit pas d'avance ce qu'il rend.`));
    for (const b of avant) {
      const m = wf.nodes.find((x) => x.name === b), ia = infoAppli(m, applisListe), run = last?.nodes?.[b];
      kids.push(el('h4', {}, ia && window.OdinLien?.icone ? window.OdinLien.icone(ia.a, 18) : null, b, el('small', { class: 'sub' }, ` · ${ia ? `${ia.a.nom} : ${ia.titre}` : cat(m.type)?.label ?? m.type}`)));
      if (!run) { kids.push(p('Pas encore de données connues : lance « Tester » (en haut) pour voir ce que ce bloc rend.')); continue; }
      if (run.error) { kids.push(p('Au dernier passage, ce bloc a échoué : aucune donnée.')); continue; }
      const vues = donneesVues(run.items);
      if (!vues.length) { kids.push(p('Au dernier passage, ce bloc n\'a rendu aucune donnée nommée.')); continue; }
      const l = el('div', { class: 'dr-dn-l', role: 'group', 'aria-label': `Données de ${b}` }, ...vues.map((v) => {
        const src = exprDonnee(b, v.chemin, dansJson);
        return el('button', { type: 'button', class: 'dr-dn-i', disabled: src ? undefined : true, onmousedown: (e) => e.preventDefault(),
          onclick: () => { if (!src) return; poserNoeud(champ, ctx.pastille({ src, bloc: b, chemin: v.chemin })); ctx.change(); } },
          el('b', {}, libelleChemin(v.chemin)), el('small', {}, src ? `Exemple : ${apercu(v.exemple)}` : 'Ce nom ne peut pas s\'écrire dans ces réglages.'));
      }));
      fleches(l); kids.push(l);
    }
    const boite = el('div', { class: 'dr-donnees', id: `${champ.id}-liste`, role: 'group', 'aria-labelledby': `${champ.id}-liste-t` }, ...kids);
    boite.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermerDonnees(true); } });
    zone.replaceChildren(boite); bouton?.setAttribute('aria-expanded', 'true');
    listeDn = { champ, bouton, boite };
    if (focusListe) (boite.querySelector('.dr-dn-i:not([disabled])') ?? boite.querySelector('button'))?.focus?.();
  }
  // ---------------- La fenêtre du « + » : la grille des applis (icônes, recherche), puis les fonctions de l'appli
  // choisie (les graves grisées) ; plus bas, les outils de Talos. Fenêtre vide : d'abord QUAND elle part.
  // La grille et la liste des fonctions sont celles de « Faire un lien » (pages/talos-lien.js).
  let choix = null;
  function fermerChoix() { if (!choix) return; const { fond, retour } = choix; choix = null; fond.remove(); if (retour?.isConnected) retour.focus?.(); }
  const sansAccent = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  /** Les flèches déplacent le focus parmi les boutons de `box` (`cols` : le nombre de colonnes, 1 pour une liste). */
  function fleches(box, cols = () => 1) {
    box.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const bs = [...box.querySelectorAll('button')].filter((b) => !b.disabled), i = bs.indexOf(document.activeElement); if (i < 0) return;
      const j = pasFleche(i, bs.length, cols(bs), e.key); if (j !== i) { e.preventDefault(); bs[j].focus(); }
    });
  }
  const colonnes = (bs) => { const t = bs[0]?.offsetTop; return Math.max(1, bs.filter((b) => b.offsetTop === t).length); };
  // applisChargees : la liste est lue ; applisFaite : une lecture a été tentée (réussie ou non : on ne la redemande pas en boucle).
  let applisChargees = false, applisFaite = false, applisListe = null;
  function chargerApplis() {
    const L = window.OdinLien;
    if (applisChargees || !L?.applis) { applisFaite = true; return Promise.resolve(applisListe); }
    return L.applis().then((l) => { applisChargees = Boolean(l); applisFaite = true; applisListe = Array.isArray(l) ? l : null; return applisListe; }, () => { applisFaite = true; return null; });
  }
  /** Le bloc posé hors de la fenêtre (téléphone surtout) : on fait glisser le schéma juste assez pour le voir. */
  function montrer(n) {
    const canvas = $('#drCanvas'), world = $('#drCanvas .dr-world'), r = canvas?.getBoundingClientRect?.();
    if (!n || !world || !r?.width) return;
    const x = n.position[0] * view.k + view.x, y = n.position[1] * view.k + view.y, w = NODE_W * view.k, h = 70 * view.k, m = 24;
    if (x + w + m > r.width) view.x -= x + w + m - r.width; else if (x < m) view.x += m - x;
    if (y + h + m > r.height) view.y -= y + h + m - r.height; else if (y < m) view.y += m - y;
    world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`;
  }
  async function ouvrirChoix(ou = {}) {
    fermerChoix();
    // « Changer » d'un bloc d'appli (`remplace` : son nom) : seulement les applis, puis ses fonctions (ou, pour un
    // déclencheur, ce qu'elle signale) ; le choix remplace celui du bloc, à sa place et avec ses liens.
    const cible = ou.remplace ? wf.nodes.find((n) => n.name === ou.remplace) : null;
    const quand = cible ? cible.type === 'déclencheur.module' : modeChoix(wf) === 'quand', L = window.OdinLien;
    const titre = el('h2', { id: 'drChT' }), corps = el('div', { class: 'dr-ch-c' });
    const boite = el('div', { class: 'dr-choix', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drChT' }, el('div', { class: 'dr-ch-h' }, titre, el('button', { class: 'dr-ch-x', type: 'button', 'aria-label': 'Fermer', onclick: fermerChoix }, '×')), corps);
    const fond = el('div', { class: 'dr-choix-fond', onclick: (e) => { if (e.target === fond) fermerChoix(); } }, boite);
    boite.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermerChoix(); return; }
      if (e.key !== 'Tab') return;
      const f = [...boite.querySelectorAll('button, input')].filter((x) => !x.disabled); // ordre du document = ordre de l'écran
      const premier = boite.querySelector('.dr-ch-x'), dernier = f.filter((x) => x !== premier).pop() ?? premier;
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); } else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    });
    choix = { fond, retour: document.activeElement };
    document.body.append(fond);
    const prendre = (c) => {
      if (cible) {
        const auto = infoAppli(cible, applisListe)?.auto, r = remplacer(wf, cible.name, c, auto, applisListe);
        if (!r.ok) { void window.OdinDialog?.alert(r.error); return; }
        fermerChoix(); if (r.change) dirty = true; if (r.nom) rename(cible, r.nom, { donnees: false });
        sel = cible.name; draw(); drawSide();
        const s = $('#drSt'); if (s && r.change) s.textContent = `✓ « ${cible.name} » changé.`;
        $('#drSide .dr-app button')?.focus?.();
        return;
      }
      // « Ajouter un bloc ici » sur un fil (`milieu`) : le bloc va entre les deux ; sinon, le « + ».
      const r = ou.milieu ? inserer(wf, c, ou.milieu) : poser(wf, c, ou);
      if (!r.ok) { void window.OdinDialog?.alert(r.error); return; }
      fermerChoix(); sel = r.name; dirty = true; montrer(wf.nodes.find((n) => n.name === r.name)); draw(); drawSide();
      const s = $('#drSt'); if (s) s.textContent = ou.milieu ? `✓ « ${r.name} » ajouté entre « ${ou.milieu.de} » et « ${ou.milieu.vers} ».` : r.lien ? `✓ « ${r.name} » ajouté après « ${r.lien.de} ».` : `✓ « ${r.name} » ajouté.`;
      elems.get(r.name)?.focus?.();
    };
    const outils = cible ? [] : (st?.catalog ?? []).filter((c) => (quand ? c.trigger && c.type !== 'déclencheur.module' : !c.trigger && c.type !== 'module.action'));
    const zoneOutils = el('div', { class: 'dr-ch-o', 'aria-label': quand ? 'Déclencheurs' : 'Outils de Talos' }); fleches(zoneOutils);
    function etape1() {
      titre.textContent = cible ? 'Changer l\'appli ou la fonction' : quand ? 'Quand l\'automatisation part-elle ?' : ou.milieu ? `Ajouter un bloc entre « ${ou.milieu.de} » et « ${ou.milieu.vers} »` : 'Ajouter un bloc';
      const quoi = cible ? 'Chercher une appli' : 'Chercher une appli ou un outil';
      const cherche = el('input', { class: 'li-cherche', type: 'search', placeholder: quoi, 'aria-label': quoi, autocomplete: 'off' });
      const zoneApplis = el('div', {});
      let grille = null;
      const peindreOutils = (t) => {
        const garde = outils.filter((c) => !t || sansAccent(`${c.label} ${c.group}`).includes(t));
        const groupes = quand ? [''] : [...new Set(garde.map((c) => c.group))];
        zoneOutils.replaceChildren(...(garde.length ? groupes.flatMap((g) => [g ? el('h4', {}, g) : null, ...garde.filter((c) => !g || c.group === g).map((c) => el('button', { type: 'button', title: c.what ?? '', onclick: () => prendre(blocOutil(c)) }, el('b', {}, c.label), c.what ? el('small', {}, c.what) : null))]) : [el('p', { class: 'sub', style: 'margin:0' }, 'Aucun outil de ce nom.')]).filter(Boolean));
      };
      const peindreApplis = () => {
        if (!applisListe || !L?.grilleApplis) { zoneApplis.replaceChildren(el('p', { class: 'sub', style: 'margin:0' }, 'Les applis ne sont pas disponibles ici.')); return; }
        grille = L.grilleApplis(applisListe, etape2); fleches(grille.grille, colonnes); zoneApplis.replaceChildren(grille.grille);
        const t = cherche.value.trim(); if (t) grille.remplir(t.toLowerCase());
      };
      cherche.addEventListener('input', () => { const t = cherche.value.trim(); grille?.remplir(t.toLowerCase()); peindreOutils(sansAccent(t)); });
      cherche.addEventListener('keydown', (e) => { if (e.key !== 'ArrowDown') return; const b = zoneApplis.querySelector('button') ?? zoneOutils.querySelector('button'); if (b) { e.preventDefault(); b.focus(); } });
      corps.replaceChildren(...[quand && !cible ? el('p', { class: 'sub', style: 'margin:0' }, 'Le premier bloc dit quand elle part : quand une appli signale quelque chose, ou un des déclencheurs plus bas.') : null,
        cherche, el('h3', {}, 'Applis'), zoneApplis, ...(cible ? [] : [el('h3', {}, quand ? 'Déclencheurs' : 'Outils de Talos'), zoneOutils])].filter(Boolean));
      peindreOutils('');
      if (applisChargees || !L?.applis) peindreApplis();
      else {
        zoneApplis.replaceChildren(el('p', { class: 'sub', style: 'margin:0' }, 'Chargement des applis…'));
        void chargerApplis().then(() => { if (choix?.fond === fond && zoneApplis.isConnected !== false && corps.contains?.(zoneApplis) !== false) peindreApplis(); });
      }
      cherche.focus?.();
    }
    function etape2(a) {
      titre.replaceChildren(L.icone ? L.icone(a, 28) : '', a.nom);
      const retour = el('button', { class: 'btn small', type: 'button', onclick: etape1 }, '← Applis');
      let liste;
      if (quand) {
        const ev = [...new Set(a.evenements ?? [])].filter((x) => x !== 'alerte');
        const opts = [['', 'Quand elle signale quelque chose', 'Tout ce qu\'elle signale.'], ['alerte', 'Quand elle lance une alerte', 'À partir du niveau « haute », réglable ensuite.'], ...ev.map((x) => [x, `Quand elle signale « ${x} »`, ''])];
        liste = el('div', { class: 'li-fn', role: 'list', 'aria-label': `Ce que ${a.nom} signale` }, ...opts.map(([v, b, s]) => el('button', { type: 'button', role: 'listitem', onclick: () => prendre(blocSignal(a, v)) }, el('b', {}, b), s ? el('small', {}, s) : null)));
      } else if ((a.actions ?? []).length) liste = L.listeFonctions(a, { boutons: true, choisir: (f) => prendre(blocFonction(a, f)) });
      if (liste) fleches(liste);
      corps.replaceChildren(...[retour, el('h3', {}, quand ? 'Quand ?' : 'Ses fonctions'), liste ?? el('p', { class: 'sub', style: 'margin:0' }, 'Cette appli n\'a pas de fonction à lancer.')]);
      ([...(liste?.querySelectorAll('button') ?? [])].find((b) => !b.disabled) ?? retour).focus?.();
    }
    etape1();
  }
  /** Ce réglage du bloc `n` est-il rangé en texte JSON (le moteur y remplace les {{ … }} avant de le lire) ? */
  const estJsonDe = (n, cle) => cat(n.type)?.params?.find((p) => p.key === cle)?.kind === 'json';
  /** Le nom tapé pour le bloc `n`, et les données que les autres blocs prennent chez lui savent-elles s'écrire avec ? */
  function nomPossible(n, texte) {
    const v = nomValide(wf, n.name, texte); if (!v.ok || v.nom === n.name) return v;
    const s = suivreRenommage(wf, n.name, v.nom, estJsonDe);
    return s.ok ? v : { ok: false, error: s.error };
  }
  /**
   * Renomme un bloc : les fils suivent, et les données que les blocs prennent chez lui ({{ $node["X"]… }}) aussi.
   * → { ok, nom } ou { ok: false, error } (nom vide, déjà pris, ou qu'une donnée ne saurait pas écrire : rien ne change).
   * `donnees: false` (le nom donné tout seul quand on change la fonction d'un bloc) : les données ne suivent pas, comme avant.
   */
  function rename(n, texte, { donnees = true } = {}) {
    const v = nomValide(wf, n.name, texte); if (!v.ok || v.nom === n.name) return v;
    const s = donnees ? suivreRenommage(wf, n.name, v.nom, estJsonDe) : { ok: true, changes: [] };
    if (!s.ok) return { ok: false, error: s.error };
    const from = n.name, to = v.nom; n.name = to; renommes.set(from, to); // (une pastille qui nommerait encore l'ancien nom le dira)
    for (const c of s.changes) wf.nodes[c.i].params[c.cle] = c.valeur;
    if (wf.connections[from]) { wf.connections[to] = wf.connections[from]; delete wf.connections[from]; }
    for (const list of Object.values(wf.connections)) for (const t of list) for (const l of t) if (l.node === from) l.node = to;
    if (outs[from]) { outs[to] = outs[from]; delete outs[from]; }
    if (armed?.node === from) armed = null;
    if (sel === from) sel = to;
    dirty = true; draw();
    // Le panneau ouvert montre un champ dont une donnée vient d'être réécrite : il se redessine (sinon le champ, à la
    // prochaine frappe, remettrait l'ancienne expression qu'il garde).
    if (s.changes.some((c) => wf.nodes[c.i].name === sel)) drawSide();
    return v;
  }
  function addNode(c) {
    let name = c.label, k = 2; while (wf.nodes.some((n) => n.name === name)) name = `${c.label} ${k++}`;
    const lastN = wf.nodes[wf.nodes.length - 1], params = Object.fromEntries(c.params.filter((p) => p.default !== undefined).map((p) => [p.key, p.default]));
    const n = { name, type: c.type, params, position: lastN ? [lastN.position[0] + 240, lastN.position[1]] : [60, 160] };
    wf.nodes.push(n); if (lastN && !c.trigger && !(wf.connections[lastN.name] ?? []).some((t) => t.length)) link(lastN.name, 0, name);
    sel = name; dirty = true; draw(); drawSide();
  }
  async function save() {
    for (const n of wf.nodes) for (const p of cat(n.type)?.params ?? []) if (p.kind === 'json' && typeof n.params[p.key] === 'string' && n.params[p.key].trim()) { try { JSON.parse(n.params[p.key]); } catch { if (!/\{\{/.test(n.params[p.key])) { await window.OdinDialog.alert(`« ${n.name} » : ${p.label} n'est pas un JSON valide.`); return false; } } }
    // Premier enregistrement : dans quel dossier, brouillon ou active (pages/talos-dossiers.js) ; « Annuler » n'enregistre rien.
    if (!wf.id && window.OdinTalosDossiers) { const c = await window.OdinTalosDossiers.choisir(wf); if (!c) return false; if (c.dossier) wf.dossier = c.dossier; else delete wf.dossier; wf.active = c.active; }
    const neuve = !wf.id;
    const r = await api('/api/draupnir/save', { flow: wf });
    if (!r.ok) { await window.OdinDialog.alert(r.error); return false; }
    wf = r.flow; dirty = false;
    // Elle vient d'être créée : le choix « Dossier » rejoint la barre tout de suite (sinon seulement à la réouverture).
    if (neuve && wf.id && window.OdinTalosDossiers && !$('#v-flows .dr-bar .td-barre')) $('#drName')?.insertAdjacentElement('afterend', window.OdinTalosDossiers.barre(wf, () => wf)); const s = $('#drSt'); if (s) s.textContent = '✓ Enregistré.'; return true;
  }
  async function test(stopAfter) {
    if (!(await save())) return;
    const s = $('#drSt'); if (s) s.textContent = 'Test en cours…';
    const r = await api('/api/draupnir/run', { id: wf.id, stopAfter });
    if (!r.ok) { if (s) s.textContent = `✗ ${r.error}`; return; }
    last = r.run; if (s) s.textContent = `${r.run.status === 'succès' ? '✓' : '✗'} ${r.run.status} en ${r.run.ms} ms${r.run.error ? ` : ${r.run.error}` : ''}`;
    draw(); drawSide();
  }
  function init() { document.head.append(el('style', {}, css)); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.OdinFlows = { open: () => { if (!wf && !ailleurs) openList(); }, edit: openFlow, liste: openList, prendre: () => { ailleurs = true; jeton++; wf = null; fermerChoix(); },
    logique: { NODE_W, PAS_X, PAS_Y, nomLibre, placeLibre, sortieDuPlus, modeChoix, blocFonction, blocSignal, blocOutil, poser, pasFleche, estDoubleTouche,
      appliDe, fonctionDe, infoAppli, lireEntree, champsDe, valeurChamp, ecrireEntree, manquants, remplacer, inserer, retirerLien, refusLien, blocSous, zoneToucher, styleSortie,
      decouper, assembler, exprDonnee, blocsAvant, donneesVues, etatDonnee, libelleChemin, nomValide, poserNote, renommerDans, suivreRenommage } };
})();
