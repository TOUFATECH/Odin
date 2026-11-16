// Méduse — les règles de COMPORTEMENT au format Sigma (le standard ouvert des règles de détection).
// Une règle Sigma décrit un événement suspect : un processus lancé d'une drôle de façon, une tâche
// planifiée ou un service créés pour se réinstaller au démarrage (persistance), une clé de registre
// modifiée, une connexion vers un serveur de commande. On s'en sert pour le NON-FICHIER : ce n'est pas une
// empreinte de fichier, c'est une manière de faire.
//
// Ici : un chargeur (lit le texte d'une règle), un compilateur (en fait un objet prêt à tester) et un
// évaluateur (dit si un événement correspond). Tout est PUR : pas de réseau, pas de disque. Réutilisé
// localement par Méduse et, sans doublon, par la console EDR.
//
// On comprend un sous-ensemble net de Sigma : des « recherches » (selection, filter…) qui comparent des
// champs à des valeurs (avec |contains, |startswith, |endswith, |re, |all), une liste = « l'un de ces
// mots », une table = « tous ces champs » ; une « condition » qui les combine (and, or, not, parenthèses,
// « 1 of selection* », « all of them »). Une règle qu'on ne comprend pas est écartée et comptée, jamais
// appliquée de travers.

/** Modificateur d'un champ Sigma : comment comparer la valeur. */
export type Modif = 'equals' | 'contains' | 'startswith' | 'endswith' | 're' | 'all';
/** Un événement observé sur un poste : des champs (Image, CommandLine, DestinationIp…) et leurs valeurs. */
export type Evenement = Record<string, unknown>;

/** Une règle Sigma telle qu'écrite (après lecture du YAML), avant compilation. */
export interface RegleSigma {
  title: string; id?: string; level?: string; status?: string; description?: string;
  logsource?: { category?: string; product?: string; service?: string };
  detection: Record<string, unknown>;        // selection/filter… + condition
  tags?: string[];
}
/** Une condition d'un champ, compilée : le champ, le modificateur, et les valeurs acceptées. */
interface Comparaison { champ: string; modif: Modif; valeurs: string[]; insensible: boolean; /** quand modif = 'all' : la comparaison réelle à appliquer à chaque valeur */ modifReel?: Modif }
/** Une « recherche » compilée (selection, filter…) : des comparaisons, toutes vraies (ET) pour correspondre. */
interface Recherche { nom: string; comparaisons: Comparaison[] }
/** Une règle compilée, prête à tester un événement. */
export interface RegleCompilee { titre: string; id?: string; niveau: string; tags: string[]; recherches: Recherche[]; condition: NoeudCond }

// ---------------------------------------------------------------- Lecture du YAML (sous-ensemble Sigma)
/** Enlève un éventuel commentaire « # … » hors guillemets, et les espaces de fin. */
const sansCommentaire = (l: string) => { let q = ''; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '#' && (i === 0 || l[i - 1] === ' ' || l[i - 1] === '\t')) return l.slice(0, i); } return l; };
const deguillemet = (v: string) => { const t = v.trim(); return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t; };
/**
 * Lecture d'un sous-ensemble de YAML suffisant pour Sigma : clés « a: b », imbrication par l'indentation,
 * listes « - x », listes et objets en ligne « [a, b] », « {a: b} ». Pur. Ne gère pas les ancres ni le
 * multi-documents complexe (séparateur « --- » accepté : on garde le premier document).
 */
export function lireYaml(texte: string): unknown {
  const lignes: Array<{ indent: number; contenu: string }> = [];
  for (const brute of texte.split('\n')) {
    const sans = sansCommentaire(brute); if (!sans.trim()) continue;
    if (sans.trim() === '---') { if (lignes.length) break; else continue; }
    lignes.push({ indent: brute.length - brute.trimStart().length, contenu: sans.trim() });
  }
  let i = 0;
  const enLigne = (v: string): unknown => {
    const t = v.trim();
    if (t.startsWith('[') && t.endsWith(']')) return decouper(t.slice(1, -1)).map(enLigne);
    if (t.startsWith('{') && t.endsWith('}')) { const o: Record<string, unknown> = {}; for (const p of decouper(t.slice(1, -1))) { const j = p.indexOf(':'); if (j >= 0) o[deguillemet(p.slice(0, j))] = enLigne(p.slice(j + 1)); } return o; }
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (t === 'true' || t === 'false') return t === 'true';
    if (t === 'null' || t === '~' || t === '') return null;
    return deguillemet(t);
  };
  const decouper = (s: string): string[] => { const out: string[] = []; let cur = '', prof = 0, q = ''; for (const c of s) { if (q) { cur += c; if (c === q) q = ''; } else if (c === '"' || c === "'") { q = c; cur += c; } else if (c === '[' || c === '{') { prof++; cur += c; } else if (c === ']' || c === '}') { prof--; cur += c; } else if (c === ',' && !prof) { out.push(cur); cur = ''; } else cur += c; } if (cur.trim()) out.push(cur); return out; };
  const estItemListe = (indent: number) => i < lignes.length && lignes[i].indent === indent && (lignes[i].contenu === '-' || lignes[i].contenu.startsWith('- '));
  const bloc = (indent: number): unknown => {
    // Liste ?
    if (estItemListe(indent)) {
      const liste: unknown[] = [];
      while (estItemListe(indent)) {
        const reste = lignes[i].contenu.slice(1).trim();
        if (!reste) { i++; liste.push(i < lignes.length && lignes[i].indent > indent ? bloc(lignes[i].indent) : null); }
        else if (/^[\w.|/-]+:(\s|$)/.test(reste)) { const base = indent + 2; lignes[i] = { indent: base, contenu: reste }; liste.push(bloc(base)); }
        else { i++; liste.push(enLigne(reste)); }
      }
      return liste;
    }
    // Objet
    const obj: Record<string, unknown> = {};
    while (i < lignes.length && lignes[i].indent === indent) {
      const l = lignes[i].contenu, j = l.indexOf(':');
      if (j < 0) { i++; continue; }
      const cle = deguillemet(l.slice(0, j)), apres = l.slice(j + 1).trim();
      i++;
      if (apres) obj[cle] = enLigne(apres);
      else if (i < lignes.length && lignes[i].indent > indent) obj[cle] = bloc(lignes[i].indent);
      else obj[cle] = null;
    }
    return obj;
  };
  return lignes.length ? bloc(lignes[0].indent) : {};
}

// ---------------------------------------------------------------- Compilation d'une règle
const tableauDe = (v: unknown): string[] => v == null ? [] : Array.isArray(v) ? v.map((x) => String(x)) : [String(v)];
/** Découpe « champ|contains|all » en champ et modificateurs. */
function champEtModif(cle: string): { champ: string; modif: Modif; all: boolean } {
  const parts = cle.split('|'); const champ = parts[0]; const mods = parts.slice(1).map((m) => m.toLowerCase());
  const all = mods.includes('all');
  const modif: Modif = mods.includes('contains') ? 'contains' : mods.includes('startswith') ? 'startswith' : mods.includes('endswith') ? 'endswith' : mods.includes('re') ? 're' : 'equals';
  return { champ, modif, all };
}
function compilerRecherche(nom: string, def: unknown): Recherche {
  const comparaisons: Comparaison[] = [];
  const pousser = (cle: string, val: unknown) => { const { champ, modif, all } = champEtModif(cle); comparaisons.push({ champ, modif: all ? 'all' : modif, valeurs: tableauDe(val), insensible: true, modifReel: all ? modif : undefined }); };
  if (Array.isArray(def)) {
    // Liste de valeurs seules (« keywords ») : au moins une présente n'importe où.
    for (const item of def) { if (item && typeof item === 'object') { for (const [k, v] of Object.entries(item as Record<string, unknown>)) pousser(k, v); } else comparaisons.push({ champ: '*', modif: 'contains', valeurs: [String(item)], insensible: true }); }
  } else if (def && typeof def === 'object') {
    for (const [k, v] of Object.entries(def as Record<string, unknown>)) pousser(k, v);
  }
  return { nom, comparaisons };
}

// Condition : petit arbre et son analyseur
type NoeudCond = { type: 'id'; nom: string } | { type: 'not'; sous: NoeudCond } | { type: 'et'; sous: NoeudCond[] } | { type: 'ou'; sous: NoeudCond[] } | { type: 'quant'; combien: number | 'all'; motif: string };
/** Analyse une condition Sigma (« selection and not filter », « 1 of selection* », « all of them »). Pur. */
export function analyserCondition(texte: string): NoeudCond {
  const toks = (texte.match(/\(|\)|[\w*]+/g) ?? []).map((t) => t);
  let p = 0;
  const bas = (): NoeudCond => {
    const t = toks[p];
    if (t === '(') { p++; const n = ou(); if (toks[p] === ')') p++; return n; }
    if (/^(all|\d+)$/i.test(t) && /^of$/i.test(toks[p + 1] ?? '')) { const combien = /^all$/i.test(t) ? 'all' : Number(t); p += 2; let motif = toks[p++] ?? 'them'; return { type: 'quant', combien, motif }; }
    p++; return { type: 'id', nom: t };
  };
  const non = (): NoeudCond => { if (/^not$/i.test(toks[p] ?? '')) { p++; return { type: 'not', sous: non() }; } return bas(); };
  const et = (): NoeudCond => { const s = [non()]; while (/^and$/i.test(toks[p] ?? '')) { p++; s.push(non()); } return s.length === 1 ? s[0] : { type: 'et', sous: s }; };
  const ou = (): NoeudCond => { const s = [et()]; while (/^or$/i.test(toks[p] ?? '')) { p++; s.push(et()); } return s.length === 1 ? s[0] : { type: 'ou', sous: s }; };
  return toks.length ? ou() : { type: 'id', nom: 'selection' };
}
/** Compile une règle Sigma (objet déjà lu) en objet testable. Lève si la détection ou la condition manquent. */
export function compilerRegle(regle: RegleSigma): RegleCompilee {
  const det = regle.detection ?? {}; const cond = det.condition;
  if (!det || typeof det !== 'object') throw new Error('règle sans « detection »');
  const recherches: Recherche[] = [];
  for (const [nom, def] of Object.entries(det)) { if (nom === 'condition') continue; recherches.push(compilerRecherche(nom, def)); }
  if (!recherches.length) throw new Error('règle sans « recherche » (selection…)');
  const condition = analyserCondition(typeof cond === 'string' ? cond : Array.isArray(cond) ? cond.join(' or ') : recherches.map((r) => r.nom).join(' and '));
  return { titre: regle.title ?? regle.id ?? 'règle', id: regle.id, niveau: String(regle.level ?? 'medium'), tags: regle.tags ?? [], recherches, condition };
}
/** Lit le texte d'une règle Sigma (YAML) et la compile. */
export function chargerSigma(texte: string): RegleCompilee { return compilerRegle(lireYaml(texte) as RegleSigma); }
/** Lit un texte qui peut contenir plusieurs règles (séparées par « --- ») ; renvoie celles qui se compilent, compte le reste. */
export function chargerPlusieurs(texte: string): { regles: RegleCompilee[]; ecartees: number } {
  const docs = texte.split(/^---\s*$/m).map((d) => d.trim()).filter(Boolean);
  const regles: RegleCompilee[] = []; let ecartees = 0;
  for (const d of docs) { try { const o = lireYaml(d) as RegleSigma; if (o && o.detection) regles.push(compilerRegle(o)); else ecartees++; } catch { ecartees++; } }
  return { regles, ecartees };
}

// ---------------------------------------------------------------- Évaluation d'un événement
const txt = (v: unknown) => v == null ? '' : String(v);
function valeurCorrespond(valChamp: string, attendu: string, modif: Modif, insensible: boolean): boolean {
  if (modif === 're') { try { return new RegExp(attendu, insensible ? 'i' : '').test(valChamp); } catch { return false; } }
  const a = insensible ? valChamp.toLowerCase() : valChamp, b = insensible ? attendu.toLowerCase() : attendu;
  if (modif === 'contains') return a.includes(b);
  if (modif === 'startswith') return a.startsWith(b);
  if (modif === 'endswith') return a.endsWith(b);
  // Sigma : « * » est un joker.
  if (b.includes('*')) { const re = new RegExp('^' + b.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', insensible ? 'i' : ''); return re.test(a); }
  return a === b;
}
function comparaisonVraie(ev: Evenement, c: Comparaison): boolean {
  const valeurs = c.valeurs; const modif = c.modif === 'all' ? (c.modifReel ?? 'equals') : c.modif;
  const champs = c.champ === '*' ? Object.values(ev).map(txt) : [txt(ev[c.champ])];
  const test = (attendu: string) => champs.some((v) => valeurCorrespond(v, attendu, modif, c.insensible));
  // |all : toutes les valeurs doivent correspondre ; sinon, au moins une (OU).
  return c.modif === 'all' ? valeurs.every(test) : valeurs.some(test);
}
const rechercheVraie = (ev: Evenement, r: Recherche): boolean => r.comparaisons.every((c) => comparaisonVraie(ev, c));
function condVraie(n: NoeudCond, vraies: Map<string, boolean>, recherches: Recherche[]): boolean {
  if (n.type === 'id') return vraies.get(n.nom) ?? false;
  if (n.type === 'not') return !condVraie(n.sous, vraies, recherches);
  if (n.type === 'et') return n.sous.every((s) => condVraie(s, vraies, recherches));
  if (n.type === 'ou') return n.sous.some((s) => condVraie(s, vraies, recherches));
  // quantificateur : « 1 of selection* », « all of them »
  const motif = n.motif === 'them' ? recherches.map((r) => r.nom) : recherches.map((r) => r.nom).filter((nom) => n.motif.endsWith('*') ? nom.startsWith(n.motif.slice(0, -1)) : nom === n.motif);
  const nb = motif.filter((nom) => vraies.get(nom)).length;
  return n.combien === 'all' ? nb === motif.length && motif.length > 0 : nb >= n.combien;
}
/** Un événement correspond-il à une règle compilée ? Renvoie le titre et le niveau si oui. Pur. */
export function evaluer(ev: Evenement, r: RegleCompilee): { correspond: boolean; titre: string; niveau: string; id?: string; tags: string[] } {
  const vraies = new Map(r.recherches.map((re) => [re.nom, rechercheVraie(ev, re)] as const));
  return { correspond: condVraie(r.condition, vraies, r.recherches), titre: r.titre, niveau: r.niveau, id: r.id, tags: r.tags };
}
/** Toutes les règles qui correspondent à un événement (les plus graves d'abord). Pur. */
export function evaluerToutes(ev: Evenement, regles: RegleCompilee[]): Array<{ titre: string; niveau: string; id?: string; tags: string[] }> {
  const ordre: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, informational: 4 };
  return regles.map((r) => evaluer(ev, r)).filter((x) => x.correspond).map(({ titre, niveau, id, tags }) => ({ titre, niveau, id, tags }))
    .sort((a, b) => (ordre[a.niveau] ?? 5) - (ordre[b.niveau] ?? 5));
}
