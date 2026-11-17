// Plugins des compétences : le calcul PUR de l'état (points, liens, connecteurs), à partir de données déjà lues.
// Aucun accès au disque ni au réseau ici : les essais passent de fausses sources, sources.ts passe les vraies.
//
// Règle d'or : un lien n'existe que si sa provenance est vraie au moment du calcul (déclaré par le propriétaire,
// cité dans le texte de la compétence, constaté dans les traces d'Odin, ou prouvé par la mémoire et les notes).

import { basename } from 'node:path';
import type { McpServerConf } from '../valhalla/mcp.ts';
import { toolName } from '../valhalla/modules/ratatoskr.ts';
import type { Connecteur, Constats, EtatConnecteur, Etat, IndexNote, Lien, Noeud, OutilConnecteur, Provenance, SourcesEtat } from './types.ts';

export const MAX_NOEUDS = 1500;
export const MAX_SOUS = 140;
export const MAX_DESCRIPTION = 200;
// Un nom de compétence (souple ici : seules les compétences actives sont dessinées ensuite).
const NOM_SKILL = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ORDRE: Provenance[] = ['declare', 'cite', 'constate', 'memoire', 'brain'];

/** Le même « slug » que celui de l'Interprète (déduit de toolName, seul exporté) : « GitHub Pro » → « github_pro ». */
export const slugMcp = (nom: string): string => toolName(nom, 'x').slice(4, -2);
/** Le préfixe des outils d'Odin venus de ce connecteur. */
export const prefixeMcp = (nom: string): string => `mcp_${slugMcp(nom)}_`;

/** Un texte venu d'ailleurs (serveur MCP, compétence) : une ligne, sans caractère de contrôle, coupé. */
export function nettoyer(texte: unknown, max: number): string {
  const t = String(texte ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** L'adresse affichable d'un connecteur : ni identifiants, ni requête, ni fragment ; jamais les arguments d'une commande. */
export function adresseMasquee(conf: Pick<McpServerConf, 'kind' | 'url' | 'command' | 'args'>): string {
  if (conf.kind === 'stdio') {
    const cmd = basename(String(conf.command ?? '').replace(/\\/g, '/')) || 'commande';
    const n = (conf.args ?? []).length;
    return `${nettoyer(cmd, 60)} (${n} argument(s))`;
  }
  try {
    const u = new URL(String(conf.url ?? ''));
    return nettoyer(`${u.protocol}//${u.host}${u.pathname}`, 120);
  } catch { return 'adresse illisible'; }
}

/** Une panne technique (souvent en anglais, venue du système) dite simplement ; le texte brut suit entre parenthèses. */
export function panneLisible(brut: string): string {
  const t = nettoyer(brut, 160);
  const dit = /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(t) ? 'adresse introuvable'
    : /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|fetch failed|socket hang up/i.test(t) ? 'serveur injoignable'
      : /timeout|timed out|aborted|pas de réponse/i.test(t) ? 'pas de réponse à temps'
        : /ENOENT|spawn/i.test(t) ? 'programme introuvable sur cette machine'
          : /\b401\b|jeton refusé/i.test(t) ? 'jeton refusé'
            : '';
  return dit ? `${dit} (${t})` : t;
}

/**
 * L'état d'un connecteur, lu dans la vue de l'Interprète (section « Serveurs branchés », 3e colonne). C'est l'état du
 * DERNIER contact (branchement ou reconnexion), pas une vérification faite maintenant : la page le dit.
 */
export function etatDepuisVue(view: unknown, nom: string): { etat: EtatConnecteur; detail?: string } {
  const sections = ((view as { sections?: unknown[] } | undefined)?.sections ?? []) as Array<{ title?: string; rows?: Array<{ cells?: unknown[] }> }>;
  const sec = sections.find((x) => x && x.title === 'Serveurs branchés');
  const ligne = (sec?.rows ?? []).find((r) => Array.isArray(r?.cells) && r.cells[0] === nom);
  const cell = String(ligne?.cells?.[2] ?? '');
  if (cell.startsWith('✓')) return { etat: 'relie' };
  if (cell.startsWith('✗')) return { etat: 'panne', detail: panneLisible(cell.replace(/^✗\s?/, '')) };
  return { etat: 'a-relier' };
}

/** Marque des outils d'un connecteur débranché, coupés par la route (voir plugins-api.ts) : jamais montrés. */
export const MARQUE_DEBRANCHE = '[MCP débranché]';

/** Le connecteur auquel appartient un outil « mcp_… » (le préfixe le plus long l'emporte). */
function connecteurDeLOutil(outil: string, prefixes: Array<[string, string]>): string | undefined {
  let best: [string, string] | undefined;
  for (const x of prefixes) if (outil.startsWith(x[1]) && (!best || x[1].length > best[1].length)) best = x;
  return best?.[0];
}
/** Le propriétaire d'un outil parmi des noms de connecteurs (préfixe le plus long). */
export const proprietaireOutil = (outil: string, connecteurs: string[]): string | undefined => connecteurDeLOutil(outil, connecteurs.map((n) => [n, prefixeMcp(n)] as [string, string]));

/** La description d'un outil sans ce que l'Interprète y ajoute : « [MCP …] », puis « <titre> : » (le titre n'est gardé que s'il dit autre chose que le nom). */
function descriptionOutil(brut: unknown, nom: string): string {
  const sans = String(brut ?? '').replace(/^\[MCP [^\]]*\]\s*/, '');
  const m = /^([^\n]{0,80}?) :(?: ([\s\S]*))?$/.exec(sans);
  if (!m) return nettoyer(sans, MAX_DESCRIPTION);
  const titre = nettoyer(m[1], 80), corps = nettoyer(m[2] ?? '', MAX_DESCRIPTION);
  const titreUtile = titre && titre.toLowerCase() !== nom.toLowerCase() && titre.replace(/[^A-Za-z0-9_]/g, '_') !== nom ? titre : '';
  return nettoyer(titreUtile && corps ? `${titreUtile} — ${corps}` : titreUtile || corps, MAX_DESCRIPTION);
}

/**
 * Les outils du registre d'Odin qui viennent de ce connecteur. `tous` : les noms de tous les connecteurs (un outil
 * va au préfixe le plus long : « git hub » garde les siens face à « git »). `lectureDeclaree` : vrai si le serveur
 * déclare l'outil en lecture seule (sinon, ou inconnu : « non déclaré », traité comme pouvant modifier).
 */
export function outilsDuConnecteur(nom: string, outils: Array<{ name: string; description?: string; grave?: (i: Record<string, unknown>) => string | undefined }>, o: { tous?: string[]; lectureDeclaree?: (outilOdin: string) => boolean } = {}): OutilConnecteur[] {
  const p = prefixeMcp(nom), tous = [...new Set([...(o.tous ?? []), nom])];
  return outils.filter((t) => t.name.startsWith(p) && proprietaireOutil(t.name, tous) === nom && !String(t.description ?? '').startsWith(MARQUE_DEBRANCHE)).map((t) => {
    let modif = false, lecture = false;
    try { modif = typeof t.grave === 'function' && Boolean(t.grave({})); } catch { modif = true; }
    if (!modif) { try { lecture = o.lectureDeclaree?.(t.name) === true; } catch { lecture = false; } }
    const acces: OutilConnecteur['acces'] = modif ? 'modification' : lecture ? 'lecture' : 'non-declare';
    const court = t.name.slice(p.length);
    return { nom: court, outilOdin: t.name, description: descriptionOutil(t.description, court), acces, peutModifier: acces !== 'lecture' };
  }).sort((a, b) => a.nom.localeCompare(b.nom));
}

export const constatsVides = (): Constats => ({ version: 1, vus: [], skillMcp: {}, mcpTours: {} });

/**
 * Récolte les traces des tours gardées par Muninn (« trace:<session> » → JSON). Ne lit que les NOMS d'outils et le
 * `name` de skill_read : jamais la question, la réponse ni les résultats. Un tour déjà vu n'est pas recompté.
 */
export function recolter(c: Constats, traces: Record<string, string>, connecteurs: string[]): { constats: Constats; change: boolean } {
  const out: Constats = { version: 1, vus: [], skillMcp: { ...c.skillMcp }, mcpTours: { ...c.mcpTours } };
  // Muninn ne garde qu'une trace par session : seules les clés des traces encore présentes servent. On les garde
  // TOUTES (jamais une coupe arbitraire, qui ferait recompter une trace encore là à chaque passage).
  const vus = new Set(c.vus), prefixes = connecteurs.map((n) => [n, prefixeMcp(n)] as [string, string]);
  let change = false;
  for (const [session, brut] of Object.entries(traces)) {
    let t: { at?: unknown; tools?: unknown };
    try { t = JSON.parse(brut) as typeof t; } catch { continue; }
    const at = Number(t?.at);
    if (!Number.isFinite(at) || !Array.isArray(t.tools)) continue;
    const cle = `${session}|${at}`;
    if (vus.has(cle)) { out.vus.push(cle); continue; }
    const skills = new Set<string>(), mcps = new Set<string>();
    for (const x of t.tools as Array<{ name?: unknown; input?: unknown }>) {
      const name = String(x?.name ?? '');
      if (name === 'skill_read') {
        let n: unknown;
        if (x.input && typeof x.input === 'object') n = (x.input as { name?: unknown }).name;
        else {
          try { n = (JSON.parse(String(x.input ?? '')) as { name?: unknown })?.name; } catch { n = /"name"\s*:\s*"([a-z0-9][a-z0-9-]{0,63})"/.exec(String(x.input ?? ''))?.[1]; }
        }
        if (typeof n === 'string' && NOM_SKILL.test(n)) skills.add(n);
      } else if (name.startsWith('mcp_')) {
        const m = connecteurDeLOutil(name, prefixes); if (m) mcps.add(m);
      }
    }
    for (const s of skills) for (const m of mcps) {
      const k = `${s}|${m}`, prev = out.skillMcp[k];
      out.skillMcp[k] = { n: (prev?.n ?? 0) + 1, dernier: Math.max(prev?.dernier ?? 0, at) };
    }
    for (const m of mcps) out.mcpTours[m] = (out.mcpTours[m] ?? 0) + 1;
    out.vus.push(cle); vus.add(cle); change = true;
  }
  return { constats: out, change };
}

/** Ce qu'on retient d'une note : ses liens [[…]] (sans alias ni section), ses mots [a-z0-9-], ses noms d'outils MCP. */
export function indexerNote(body: string): IndexNote {
  const liens = new Set<string>(), mots = new Set<string>(), outilsMcp: string[] = [];
  for (const m of body.matchAll(/\[\[([^\]\n]{1,200})\]\]/g)) liens.add(m[1].split('|')[0].split('#')[0].trim().toLowerCase());
  for (const m of body.toLowerCase().matchAll(/[a-z0-9-]+/g)) mots.add(m[0]);
  for (const m of body.matchAll(/mcp_[A-Za-z0-9_]+/g)) outilsMcp.push(m[0]);
  return { liens, mots, outilsMcp };
}

const cherchePrefixes = (texte: string) => [...texte.matchAll(/mcp_[A-Za-z0-9_]+/g)].map((m) => m[0]);

// « constaté » : compté sur les tours que la page a pu observer (Muninn ne garde que la dernière trace d'une session).
export const provenanceTexte = (p: Provenance, n?: number): string => ({ declare: 'relié par toi', cite: 'cité dans la compétence', constate: `vus ensemble dans ${n ?? 0} tour(s) observé(s)`, memoire: 'mémoire d\'Odin', brain: 'notes du Cerveau' })[p];

/** L'état complet : résumé, points (seuls compris), liens prouvés, connecteurs, plugins, Soul. */
export function construireEtat(src: SourcesEtat): Etat {
  const competences = [...src.competences].sort((a, b) => a.nom.localeCompare(b.nom));
  const connecteurs = [...(src.connecteurs ?? [])].sort((a, b) => a.nom.localeCompare(b.nom));
  const actives = new Set(competences.map((c) => c.nom)), branches = new Set(connecteurs.map((c) => c.nom));
  const usages = new Map(src.stats.map((s) => [s.name, Number(s.uses) || 0]));
  const plugins = [...src.fichier.plugins].sort((a, b) => a.id.localeCompare(b.id));

  // Les points à dessiner (au-delà de MAX_NOEUDS, les compétences les moins utilisées sont omises).
  const place = MAX_NOEUDS - 3 - plugins.length - connecteurs.length;
  let gardees = competences, omis = 0;
  if (competences.length > Math.max(0, place)) {
    const tri = [...competences].sort((a, b) => (usages.get(b.nom) ?? 0) - (usages.get(a.nom) ?? 0) || a.nom.localeCompare(b.nom));
    const garde = new Set(tri.slice(0, Math.max(0, place)).map((c) => c.nom));
    gardees = competences.filter((c) => garde.has(c.nom)); omis = competences.length - gardees.length;
  }
  const dessinees = new Set(gardees.map((c) => `skill:${c.nom}`));
  const dessine = (id: string) => !id.startsWith('skill:') || dessinees.has(id);

  // ---- Liens
  const liens = new Map<string, Lien>();
  const ajouter = (a: string, b: string, p: Provenance, titre: string, n?: number) => {
    if (!dessine(a) || !dessine(b)) return;
    const k = `${a}\u0000${b}`, l = liens.get(k);
    if (!l) { liens.set(k, { a, b, provenances: [p], titre, ...(n !== undefined ? { n } : {}) }); return; }
    if (!l.provenances.includes(p)) l.provenances.push(p);
    if (n !== undefined) l.n = n;
  };
  // plugin ↔ compétence, plugin ↔ connecteur (déclarés)
  for (const pl of plugins) {
    for (const s of pl.skills) if (actives.has(s)) ajouter(`plugin:${pl.id}`, `skill:${s}`, 'declare', `dans le plugin « ${pl.nom} »`);
    for (const m of pl.mcp) if (branches.has(m)) ajouter(`plugin:${pl.id}`, `mcp:${m}`, 'declare', `dans le plugin « ${pl.nom} »`);
  }
  // compétence ↔ connecteur : déclaré, cité, constaté
  for (const l of src.fichier.liens) if (actives.has(l.skill) && branches.has(l.mcp)) ajouter(`skill:${l.skill}`, `mcp:${l.mcp}`, 'declare', '');
  // Un nom d'outil cité va au SEUL connecteur qui le possède (préfixe le plus long) : « git » ne prend pas ceux de « git hub ».
  const nomsConnecteurs = connecteurs.map((c) => c.nom);
  const cites = (outils: string[]) => new Set(outils.map((o) => proprietaireOutil(o, nomsConnecteurs)).filter((x): x is string => Boolean(x)));
  for (const c of competences) {
    const outils = cherchePrefixes(`${c.description}\n${c.body}`);
    if (!outils.length) continue;
    for (const nom of cites(outils)) ajouter(`skill:${c.nom}`, `mcp:${nom}`, 'cite', '');
  }
  for (const [k, v] of Object.entries(src.constats.skillMcp)) {
    const i = k.indexOf('|'); if (i < 0 || !(v?.n > 0)) continue;
    const s = k.slice(0, i), m = k.slice(i + 1);
    if (actives.has(s) && branches.has(m)) ajouter(`skill:${s}`, `mcp:${m}`, 'constate', '', v.n);
  }
  // Mémoire ↔ compétence (usages), Mémoire ↔ connecteur (tours observés)
  for (const c of competences) { const u = usages.get(c.nom) ?? 0; if (u > 0) ajouter('memoire', `skill:${c.nom}`, 'memoire', `utilisée ${u} fois (mémoire d'Odin)`, u); }
  for (const c of connecteurs) { const n = src.constats.mcpTours[c.nom] ?? 0; if (n > 0) ajouter('memoire', `mcp:${c.nom}`, 'memoire', `appelé dans ${n} tour(s) observé(s)`, n); }
  // Brain : seulement par un lien écrit dans une note
  const notesBrain = new Set<number>();
  const compter = (test: (n: IndexNote) => boolean) => { let k = 0; src.notes.forEach((n, i) => { if (test(n)) { k++; notesBrain.add(i); } }); return k; };
  const brainSkill = new Map<string, number>();
  // [[nom]] désigne d'abord une NOTE de ce nom (lien entre notes) : il ne compte pour la compétence que si aucune note
  // ne porte ce nom ; [[skill:nom]] la désigne toujours.
  const titres = src.titresNotes ?? new Set<string>();
  for (const c of competences) {
    const nom = c.nom.toLowerCase(), tiret = nom.includes('-'), nuDisponible = !titres.has(nom);
    const n = compter((x) => x.liens.has(`skill:${nom}`) || (nuDisponible && (x.liens.has(nom) || (tiret && x.mots.has(nom)))));
    brainSkill.set(c.nom, n);
    if (n > 0) ajouter('brain', `skill:${c.nom}`, 'brain', `citée dans ${n} note(s)`, n);
  }
  for (const c of connecteurs) {
    const lien = `mcp:${c.nom.toLowerCase()}`;
    const n = compter((x) => x.liens.has(lien) || cites(x.outilsMcp).has(c.nom));
    if (n > 0) ajouter('brain', `mcp:${c.nom}`, 'brain', `cité dans ${n} note(s)`, n);
  }
  for (const pl of plugins) {
    const n = compter((x) => x.liens.has(`plugin:${pl.id}`));
    if (n > 0) ajouter('brain', `plugin:${pl.id}`, 'brain', `cité dans ${n} note(s)`, n);
  }
  // Titres des liens compétence ↔ connecteur, provenances dans l'ordre fixe
  const tous = [...liens.values()];
  for (const l of tous) {
    l.provenances.sort((x, y) => ORDRE.indexOf(x) - ORDRE.indexOf(y));
    if (l.a.startsWith('skill:') && l.b.startsWith('mcp:')) l.titre = l.provenances.map((p) => provenanceTexte(p, l.n)).join(' · ');
  }

  // ---- Points
  const relies = new Set<string>(); for (const l of tous) { relies.add(l.a); relies.add(l.b); }
  const dansPlugins = (sorte: 'skills' | 'mcp', nom: string) => plugins.filter((p) => p[sorte].includes(nom)).map((p) => p.id);
  const noeuds: Noeud[] = [];
  const pousser = (n: Omit<Noeud, 'seul'>) => noeuds.push({ ...n, sous: nettoyer(n.sous, MAX_SOUS), seul: !relies.has(n.id) });
  const usees = competences.filter((c) => (usages.get(c.nom) ?? 0) > 0).length;
  const appeles = connecteurs.filter((c) => (src.constats.mcpTours[c.nom] ?? 0) > 0).length;
  pousser({ id: 'brain', sorte: 'brain', nom: 'Brain', sous: `${notesBrain.size} note(s) citent une compétence, un connecteur ou un plugin` });
  pousser({ id: 'memoire', sorte: 'memoire', nom: 'Mémoire', sous: `${usees} compétence(s) utilisée(s) · ${appeles} connecteur(s) appelé(s)` });
  pousser({ id: 'soul', sorte: 'soul', nom: 'Soul', sous: src.soul.etat !== 'connu' ? 'état de Soul inconnu' : src.soul.extraitsCompetences > 0 ? `${src.soul.extraitsCompetences} extrait(s) des compétences dans son corpus` : 'aucun extrait des compétences dans son corpus' });
  for (const pl of plugins) pousser({ id: `plugin:${pl.id}`, sorte: 'plugin', nom: pl.nom, sous: pl.description || `${pl.skills.length} compétence(s) · ${pl.mcp.length} connecteur(s)` });
  for (const c of gardees) pousser({ id: `skill:${c.nom}`, sorte: 'skill', nom: c.nom, sous: c.description, plugins: dansPlugins('skills', c.nom) });
  const libelle: Record<EtatConnecteur, string> = { relie: 'relié au dernier contact', 'a-relier': 'à relier', panne: 'en panne au dernier contact' };
  for (const c of connecteurs) pousser({ id: `mcp:${c.nom}`, sorte: 'mcp', nom: c.nom, sous: `${libelle[c.etat]} · ${c.outils.length} outil(s)`, etat: c.etat, plugins: dansPlugins('mcp', c.nom) });

  return {
    resume: { competences: competences.length, brouillons: src.brouillons, connecteurs: connecteurs.length, plugins: plugins.length, seuls: noeuds.filter((n) => n.seul && ['skill', 'mcp', 'plugin'].includes(n.sorte)).length, mcpDisponible: src.connecteurs !== undefined, abime: src.abime, ...(omis ? { omis } : {}) },
    noeuds,
    liens: tous,
    connecteurs,
    plugins: plugins.map((p) => ({ id: p.id, nom: p.nom, description: p.description, skills: p.skills.map((nom) => ({ nom, present: actives.has(nom) })), mcp: p.mcp.map((nom) => ({ nom, present: branches.has(nom) })) })),
    liensDeclares: src.fichier.liens.map((l) => ({ skill: l.skill, mcp: l.mcp })),
    soul: src.soul,
  };
}

/** Raccourci utilisé par sources.ts : un connecteur décrit pour la page (sans jamais la valeur du jeton). */
export function decrireConnecteur(conf: McpServerConf, vue: unknown, outils: Parameters<typeof outilsDuConnecteur>[1], env: NodeJS.ProcessEnv = process.env, o: Parameters<typeof outilsDuConnecteur>[2] = {}): Connecteur {
  const e = etatDepuisVue(vue, conf.name);
  return {
    nom: conf.name,
    sorte: conf.kind === 'stdio' ? 'stdio' : 'http',
    adresse: adresseMasquee(conf),
    etat: e.etat,
    ...(e.detail ? { detail: e.detail } : {}),
    ...(conf.kind === 'stdio' ? {} : { jeton: Boolean(env[`MCP_${slugMcp(conf.name).toUpperCase()}`]) }),
    outils: outilsDuConnecteur(conf.name, outils, o),
  };
}
