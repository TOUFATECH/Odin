// Plume · les actions ajoutées au bureau : le correcteur (maison ou LanguageTool), les tableaux blancs, les schémas
// isométriques (dont « Partir de mon réseau » avec Atlas) et Penpot relié. Branchées dans `modules/snotra.ts`.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Action, ActionResult, ModCtx, Section } from '../types.ts';
import { appliquer, corrigerLanguageTool, corrigerMaison, type Correction } from './correcteur.ts';
import { PROPRIETAIRE, changer, reglage } from './partout.ts';
import { agissant } from '../sso/acces.ts';
import { genreAppareil, GENRES_BLOC, nettoyer, schemaDepuis, STYLE_BLOC, svgDe, type Dessin } from './dessin.ts';

const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x)).trim();
const LT_IMAGE = 'erikvl87/languagetool', LT_PORT = 20126, LT_NOM = 'odin-languagetool';
const MAX_TEXTE = 50_000;

// ---------------- Le correcteur ----------------
const urlLT = (ctx: ModCtx) => s(ctx.settings.languagetool);
/** Corrige avec LanguageTool s'il est relié et répond, sinon avec le correcteur maison (on dit lequel). */
export async function corriger(ctx: ModCtx, texte: string, langue = 'fr'): Promise<Correction & { remarque?: string }> {
  const url = urlLT(ctx);
  if (url) {
    try { const fautes = await corrigerLanguageTool(ctx.fetch, url, texte, langue); return { moteur: 'LanguageTool', fautes, corrige: appliquer(texte, fautes) }; }
    catch (e) { const fautes = corrigerMaison(texte); return { moteur: 'maison', fautes, corrige: appliquer(texte, fautes), remarque: `LanguageTool ne répond pas (${(e as Error).message}) : correcteur de base utilisé.` }; }
  }
  const fautes = langue.startsWith('fr') ? corrigerMaison(texte) : [];
  return { moteur: 'maison', fautes, corrige: appliquer(texte, fautes), ...(langue.startsWith('fr') ? {} : { remarque: 'Le correcteur de base ne connaît que le français : installe LanguageTool pour les autres langues.' }) };
}

// ---------------- Tableaux et schémas ----------------
const dossierDessins = (ctx: ModCtx) => join(ctx.dir, 'tableaux');
const ID = /^[a-z0-9-]{4,40}$/;
export function dessins(ctx: ModCtx): Dessin[] {
  let n: string[] = []; try { n = readdirSync(dossierDessins(ctx)).filter((x) => x.endsWith('.json')); } catch { return []; }
  return n.flatMap((f) => { try { return [JSON.parse(readFileSync(join(dossierDessins(ctx), f), 'utf8')) as Dessin]; } catch { return []; } }).sort((a, b) => b.maj.localeCompare(a.maj));
}
export function dessin(ctx: ModCtx, id: string): Dessin | undefined {
  if (!ID.test(id)) return undefined;
  try { return JSON.parse(readFileSync(join(dossierDessins(ctx), `${id}.json`), 'utf8')) as Dessin; } catch { return undefined; }
}
/** Enregistre (la version d'avant est gardée à côté, « .avant.json », pour revenir en arrière une fois). */
function ranger(ctx: ModCtx, d: Dessin): void {
  mkdirSync(dossierDessins(ctx), { recursive: true });
  const f = join(dossierDessins(ctx), `${d.id}.json`), tmp = `${f}.tmp`;
  if (existsSync(f)) writeFileSync(join(dossierDessins(ctx), `${d.id}.avant.json.bak`), readFileSync(f));
  writeFileSync(tmp, JSON.stringify(d)); renameSync(tmp, f);
}
const nouvelId = () => `t${randomBytes(5).toString('hex')}`;
const resume = (d: Dessin) => (d.genre === 'schema' ? `${d.blocs.length} bloc(s), ${d.liens.length} lien(s)` : `${d.formes.length} forme(s)`);

/** Un fichier exporté, rangé dans les données de Plume pour être remis à l'appareil. */
function exporter(ctx: ModCtx, nom: string, contenu: Buffer | string): { nom: string; ref: string } {
  // Un sous-dossier par export : le fichier garde son vrai nom au téléchargement.
  const sous = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`, f = nom.replace(/[^\p{L}\p{N} ._-]/gu, '_').replace(/^\.+/, '_').slice(0, 80) || 'export';
  mkdirSync(join(ctx.dir, 'exports', sous), { recursive: true }); writeFileSync(join(ctx.dir, 'exports', sous, f), contenu);
  return { nom, ref: `export:${sous}/${f}` };
}
/** Le fichier exporté que la page peut remettre (seulement dans le dossier des exports). */
export function retraitExport(ctx: ModCtx, ref: string): string | undefined {
  if (!ref.startsWith('export:')) return undefined;
  const rep = join(ctx.dir, 'exports'), f = resolve(rep, ref.slice(7));
  if (!f.startsWith(resolve(rep) + sep)) return undefined;
  try { const v = realpathSync(f); return v.startsWith(realpathSync(rep) + sep) ? v : undefined; } catch { return undefined; }
}
/** Un SVG en PNG avec un programme installé (rsvg-convert, sinon ImageMagick). */
async function enPng(ctx: ModCtx, svg: string): Promise<Buffer | { erreur: string }> {
  const tmp = join(ctx.dir, 'exports', `rendu-${randomBytes(4).toString('hex')}`); mkdirSync(join(ctx.dir, 'exports'), { recursive: true });
  writeFileSync(`${tmp}.svg`, svg);
  try {
    const essais: Array<[string, string[]]> = [['rsvg-convert', ['-b', 'white', '-o', `${tmp}.png`, `${tmp}.svg`]], ['convert', [`${tmp}.svg`, `${tmp}.png`]], ['magick', [`${tmp}.svg`, `${tmp}.png`]]];
    for (const [cmd, args] of essais) {
      if (!await ctx.has(cmd)) continue;
      const r = await ctx.run(cmd, args, { timeoutMs: 60_000 });
      if (r.code === 0 && existsSync(`${tmp}.png`)) return readFileSync(`${tmp}.png`);
    }
    return { erreur: 'Aucun programme pour faire un PNG ici (rsvg-convert ou ImageMagick). Le bouton « PNG » de la page le fait dans ton navigateur, ou installe le paquet « librsvg2-bin ».' };
  } finally { rmSync(`${tmp}.svg`, { force: true }); rmSync(`${tmp}.png`, { force: true }); }
}

// ---------------- Plume partout (le réglage de la personne qui agit : un membre de Persona, sinon le propriétaire) ----------------
const cleQuiAgit = () => agissant()?.login ?? PROPRIETAIRE;
const OUI_NON = (b: boolean) => (b ? 'oui' : 'non');
function resumePartout(ctx: ModCtx): string {
  const r = reglage(ctx, cleQuiAgit());
  if (!r.actif) return `Plume est désactivé partout${r.depuis ? ` depuis le ${new Date(r.depuis).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : ''} : plus aucune proposition, et Odin ne s'en sert pas. Rallume-le ici ou dans Réglages → Plume.`;
  return `Plume est activé : dans Odin et ses applis ${OUI_NON(r.odin)}, dans Pégase ${OUI_NON(r.pegase)}, Odin s'en sert ${OUI_NON(r.ia)}, grammaire et style ${OUI_NON(r.grammaire)}. Ton dictionnaire : ${r.dico.length} mot(s) ; ${r.ignores.length} faute(s) ignorée(s).`;
}
const B = (key: string, label: string, help: string) => ({ key, label, kind: 'boolean' as const, help });

export const ACTIONS_PLUME: Action[] = [
  { id: 'partout', label: 'Plume partout', what: 'Où Plume corrige pendant que tu écris (Odin, ses applis, Pégase) et si Odin s\'en sert', read: true, quick: false, words: ['plume partout', 'correcteur pendant que j ecris'], run: (ctx) => ({ text: resumePartout(ctx) }) },
  { id: 'regler_partout', label: 'Régler Plume partout', what: 'Active ou désactive Plume partout (corrections pendant que tu écris, et l\'usage par Odin), et choisis où', quick: false,
    params: [B('actif', 'Plume', 'Proposer des corrections pendant que j\'écris, et laisser Odin s\'en servir'), B('odin', 'Dans Odin et ses applis', 'Discussion, champs de toutes les applis'), B('pegase', 'Dans Pégase', 'Sites, formulaires, barre de recherche'), B('ia', 'Odin se sert de Plume', 'Pour corriger un fichier ou répondre sur l\'écriture'), B('grammaire', 'Grammaire et style', 'En plus de l\'orthographe et des fautes de frappe')],
    words: ['desactive plume partout', 'reactive plume partout', 'rallume plume'], run: (ctx, i) => {
      const patch: Record<string, unknown> = {};
      for (const k of ['actif', 'odin', 'pegase', 'ia', 'grammaire']) if (i[k] !== undefined && i[k] !== '') patch[k] = i[k] === true || i[k] === 'true' || i[k] === 'oui' || i[k] === 'on';
      changer(ctx, cleQuiAgit(), patch); return { text: `✅ ${resumePartout(ctx)}` };
    } },

  { id: 'corriger', label: 'Corriger un texte', what: 'Orthographe, grammaire et typographie d\'un texte : les fautes, une proposition pour chacune, et le texte corrigé (LanguageTool s\'il est installé, sinon le correcteur de base)', read: true,
    params: [{ key: 'texte', label: 'Texte', kind: 'textarea', required: true }, { key: 'langue', label: 'Langue', kind: 'select', options: ['fr', 'en-US', 'en-GB', 'de-DE', 'es', 'it', 'pt-PT'], default: 'fr' }],
    words: ['corrige ce texte', 'corrige le texte', 'correcteur d orthographe'], run: async (ctx, i) => {
      const texte = typeof i.texte === 'string' ? i.texte.slice(0, MAX_TEXTE) : ''; if (!texte.trim()) return { ok: false, text: 'Donne-moi le texte à corriger.' };
      const c = await corriger(ctx, texte, s(i.langue) || 'fr');
      const tete = c.fautes.length ? `✍ ${c.fautes.length} chose(s) à corriger (correcteur ${c.moteur === 'maison' ? 'de base' : 'LanguageTool'}) :` : `✅ Rien à corriger trouvé (correcteur ${c.moteur === 'maison' ? 'de base : il ne voit pas tout' : 'LanguageTool'}).`;
      return { text: [tete, ...c.fautes.slice(0, 40).map((f) => `- « ${f.extrait} » : ${f.message}${f.suggestions.length ? ` → ${f.suggestions.slice(0, 3).map((x) => `« ${x} »`).join(' ou ')}` : ''}`), ...(c.remarque ? [`ℹ ${c.remarque}`] : []), ...(c.fautes.length ? ['', 'Texte corrigé :', c.corrige] : [])].join('\n'), data: c };
    } },
  { id: 'installer_correcteur', label: 'Installer le correcteur LanguageTool', what: 'Lance LanguageTool à côté d\'Odin (moteur de conteneurs d\'Odin, port 20126) : un correcteur plus complet, pour toutes les applis', quick: false,
    grave: () => `installer le service LanguageTool (image ${LT_IMAGE}, environ 300 Mo à télécharger, 512 Mo de mémoire) sur le port ${LT_PORT}`,
    run: async (ctx) => {
      if (!ctx.modules().some((m) => m.id === 'naglfar')) return { ok: false, text: 'Le moteur de conteneurs d\'Odin (Argo) n\'est pas là : installe LanguageTool toi-même puis « Relier un correcteur LanguageTool ».' };
      const r = await ctx.call('naglfar', 'lancer', { image: LT_IMAGE, nom: LT_NOM, ports: `${LT_PORT}:8010`, env: 'Java_Xms=256m\nJava_Xmx=512m', redemarrage: 'unless-stopped' }, 'installer le correcteur LanguageTool pour Plume', { interne: true });
      if (r.ok === false) return { ok: false, text: `LanguageTool ne s'installe pas : ${r.text}` };
      ctx.saveSettings({ languagetool: `http://127.0.0.1:${LT_PORT}`, languagetoolLocal: true });
      return { text: `🚀 LanguageTool s'installe (suis la barre dans Argo). Plume l'utilise dès qu'il répond, en attendant le correcteur de base reste en service.\n${r.text}` };
    }, undo: () => ({ action: 'retirer_correcteur', input: {}, label: 'Revenir au correcteur de base' }) },
  { id: 'relier_correcteur', label: 'Relier un correcteur LanguageTool', what: 'L\'adresse d\'un LanguageTool déjà installé (ex. http://192.168.1.10:8010) : il est essayé tout de suite', quick: false, params: [{ key: 'adresse', label: 'Adresse', kind: 'text', required: true }], run: async (ctx, i) => {
    const u = s(i.adresse).replace(/\/+$/, ''); if (!/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/.test(u)) return { ok: false, text: 'Donne une adresse comme http://192.168.1.10:8010.' };
    try { const f = await corrigerLanguageTool(ctx.fetch, u, 'Ceci est une essai.', 'fr'); ctx.saveSettings({ languagetool: u, languagetoolLocal: false }); return { text: `✅ LanguageTool répond sur ${u} (essai : ${f.length} faute(s) trouvée(s) dans « Ceci est une essai. »). Plume l'utilise maintenant.` }; }
    catch (e) { return { ok: false, text: `LanguageTool ne répond pas sur ${u} : ${(e as Error).message}. Vérifie l'adresse et que le service tourne.` }; }
  } },
  { id: 'retirer_correcteur', label: 'Revenir au correcteur de base', what: 'Plume n\'utilise plus LanguageTool (le service n\'est pas supprimé : Argo s\'en charge)', quick: false, run: (ctx) => { ctx.saveSettings({ languagetool: '', languagetoolLocal: false }); return { text: 'Plume utilise de nouveau le correcteur de base.' }; } },
  { id: 'tableaux', label: 'Tableaux et schémas', what: 'Tes tableaux blancs et tes schémas, du plus récent au plus ancien', read: true, words: ['mes tableaux blancs', 'mes schemas'], run: (ctx) => {
    const l = dessins(ctx); return { text: l.length ? l.map((d) => `- ${d.nom} (${d.genre === 'schema' ? 'schéma' : 'tableau'} · ${resume(d)}) · ${d.id}`).join('\n') : 'Aucun tableau ni schéma pour l\'instant.', data: l.map((d) => ({ id: d.id, nom: d.nom, genre: d.genre, maj: d.maj })) };
  } },
  { id: 'ouvrir_tableau', label: 'Ouvrir un tableau', what: 'Le contenu d\'un tableau blanc ou d\'un schéma (pour la page)', read: true, quick: false, quiet: true, params: [{ key: 'id', label: 'Tableau', kind: 'text', required: true }], run: (ctx, i) => {
    const d = dessin(ctx, s(i.id)); return d ? { text: `${d.nom} : ${resume(d)}`, data: d } : { ok: false, text: 'Ce tableau n\'existe pas (ou plus).' };
  } },
  { id: 'enregistrer_tableau', label: 'Enregistrer un tableau', what: 'Crée ou met à jour un tableau blanc ou un schéma (le contenu vient de la page)', quick: false, quiet: true,
    params: [{ key: 'id', label: 'Tableau (vide : un nouveau)', kind: 'text' }, { key: 'nom', label: 'Nom', kind: 'text' }, { key: 'genre', label: 'Genre', kind: 'select', options: ['tableau', 'schema'], default: 'tableau' }, { key: 'contenu', label: 'Contenu (JSON)', kind: 'textarea' }],
    run: (ctx, i) => {
      const id = s(i.id), avant = id ? dessin(ctx, id) : undefined; if (id && !avant) return { ok: false, text: 'Ce tableau n\'existe pas (ou plus) : enregistre-le comme nouveau.' };
      let brut: unknown = {}; const c = typeof i.contenu === 'string' ? i.contenu : JSON.stringify(i.contenu ?? {});
      if (c.length > 4_000_000) return { ok: false, text: 'Ce tableau est trop gros (4 Mo au plus) : partage-le en plusieurs.' };
      try { brut = c ? JSON.parse(c) : {}; } catch { return { ok: false, text: 'Le contenu du tableau est illisible (JSON attendu).' }; }
      const genre = avant?.genre ?? (s(i.genre) === 'schema' ? 'schema' : 'tableau'), nom = s(i.nom) || avant?.nom || (genre === 'schema' ? 'Schéma' : 'Tableau');
      const d = nettoyer({ ...(brut as object), nom }, { id: avant?.id ?? nouvelId(), nom, genre, maj: ctx.now().toISOString() });
      ranger(ctx, d);
      return { text: `💾 « ${d.nom} » enregistré (${resume(d)}).`, data: { id: d.id } };
    } },
  { id: 'supprimer_tableau', label: 'Supprimer un tableau', what: 'Efface un tableau blanc ou un schéma', quick: false, params: [{ key: 'id', label: 'Tableau', kind: 'text', required: true }], grave: (i, ctx) => `effacer le tableau « ${(ctx && dessin(ctx, s(i.id))?.nom) || s(i.id)} »`, run: (ctx, i) => {
    const d = dessin(ctx, s(i.id)); if (!d) return { ok: false, text: 'Ce tableau n\'existe pas (ou plus).' };
    rmSync(join(dossierDessins(ctx), `${d.id}.json`), { force: true }); rmSync(join(dossierDessins(ctx), `${d.id}.avant.json.bak`), { force: true });
    return { text: `🗑 « ${d.nom} » effacé.` };
  } },
  { id: 'exporter_tableau', label: 'Exporter un tableau', what: 'Un tableau blanc ou un schéma en image SVG ou PNG, à télécharger', read: true, quick: false, params: [{ key: 'id', label: 'Tableau', kind: 'text', required: true }, { key: 'format', label: 'Format', kind: 'select', options: ['svg', 'png'], default: 'svg' }], run: async (ctx, i): Promise<ActionResult> => {
    const d = dessin(ctx, s(i.id)); if (!d) return { ok: false, text: 'Ce tableau n\'existe pas (ou plus).' };
    const svg = svgDe(d), base = d.nom.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'tableau';
    if (s(i.format) === 'png') { const p = await enPng(ctx, svg); if (!Buffer.isBuffer(p)) return { ok: false, text: p.erreur }; return { text: `🖼 « ${d.nom} » en PNG (${Math.round(p.length / 1024)} Ko).`, fichiers: [exporter(ctx, `${base}.png`, p)] }; }
    return { text: `🖼 « ${d.nom} » en SVG.`, fichiers: [exporter(ctx, `${base}.svg`, svg)], data: { svg } };
  } },
  { id: 'schema_reseau', label: 'Schéma de mon réseau', what: 'Un schéma isométrique fait à partir des appareils de l\'inventaire (Atlas) : la box au centre, chaque appareil relié', words: ['schema de mon reseau', 'dessine mon reseau'], run: async (ctx): Promise<ActionResult> => {
    if (!ctx.modules().some((m) => m.id === 'askr')) return { ok: false, text: 'L\'inventaire (Atlas) n\'est pas là : pose les blocs toi-même dans un nouveau schéma.' };
    const r = await ctx.call('askr', 'chercher', { q: '*' }, 'dessiner le schéma du réseau dans Plume', { interne: true });
    const l = Array.isArray(r.data) ? (r.data as Array<{ nom?: string; genre?: string; ip?: string; etat?: string }>).filter((a) => a.etat !== 'retiré') : [];
    if (!l.length) return { ok: false, text: 'L\'inventaire est vide : dans Atlas, « Ajouter les appareils du réseau », puis recommence.' };
    const base = { id: nouvelId(), nom: `Mon réseau (${ctx.now().toLocaleDateString('fr-FR')})`, maj: ctx.now().toISOString() };
    const d = nettoyer(schemaDepuis(l.map((a) => ({ nom: s(a.nom) || 'Appareil', genre: genreAppareil(s(a.genre), s(a.nom)), ...(a.ip ? { ip: s(a.ip) } : {}) })), base), { ...base, genre: 'schema' });
    ranger(ctx, d);
    return { text: `🗺 Schéma « ${d.nom} » fait avec ${l.length} appareil(s) d'Atlas : ouvre l'onglet « Schémas » pour le ranger à ta façon.`, data: { id: d.id } };
  } },
  { id: 'relier_penpot', label: 'Relier Penpot', what: 'L\'adresse de ton Penpot (maquettes et design dans le navigateur) : un lien dans Plume, et la connexion Odin à faire dans Persona', quick: false, params: [{ key: 'adresse', label: 'Adresse de Penpot (ex. https://penpot.exemple.fr)', kind: 'text', required: true }], run: async (ctx, i) => {
    const u = s(i.adresse).replace(/\/+$/, ''); if (!/^https?:\/\/[^\s/]+(:\d+)?$/.test(u)) return { ok: false, text: 'Donne l\'adresse de Penpot, comme https://penpot.exemple.fr ou http://192.168.1.10:20127.' };
    let note = ''; try { const r = await ctx.fetch(`${u}/`, { signal: AbortSignal.timeout(8000) }); note = r.ok ? 'il répond' : `il répond ${r.status}`; } catch { note = 'il ne répond pas pour l\'instant'; }
    ctx.saveSettings({ penpot: u });
    return { text: `🎨 Penpot relié : ${u} (${note}). Pour s'y connecter avec son compte Odin : Persona → « Connexion Odin pour un logiciel » (Penpot), puis colle sa configuration dans Penpot.` };
  } },
];

/** Les sections des onglets Correcteur, Tableaux et Schémas. */
export function sectionsPlume(ctx: ModCtx): Section[] {
  const l = dessins(ctx), lt = urlLT(ctx), penpot = s(ctx.settings.penpot), C = 'Correcteur', T = 'Tableaux', S = 'Schémas';
  const ligne = (d: Dessin) => ({ cells: [d.nom, d.genre === 'schema' ? `${d.blocs.length} bloc(s)` : `${d.formes.length} forme(s)`, new Date(d.maj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })], actions: [{ action: 'exporter_tableau', label: 'SVG', input: { id: d.id, format: 'svg' } }, { action: 'exporter_tableau', label: 'PNG', input: { id: d.id, format: 'png' } }] });
  const r = reglage(ctx, cleQuiAgit());
  return [
    { kind: 'form', title: 'Plume partout', action: 'regler_partout', submit: 'Enregistrer', onglet: C, params: [B('actif', 'Plume', 'Proposer des corrections pendant que j\'écris, et laisser Odin s\'en servir'), B('odin', 'Dans Odin et ses applis', 'Discussion, champs de toutes les applis'), B('pegase', 'Dans Pégase', 'Sites, formulaires, barre de recherche'), B('ia', 'Odin se sert de Plume', 'Pour corriger un fichier ou répondre sur l\'écriture'), B('grammaire', 'Grammaire et style', 'En plus de l\'orthographe et des fautes de frappe')].map((p) => ({ ...p, default: r[p.key as 'actif'] })), aide: `${resumePartout(ctx)} Le même réglage est dans Réglages → Plume, et vaut sur tous tes appareils.` },
    { kind: 'form', title: 'Corriger un texte', action: 'corriger', submit: 'Corriger', onglet: C, large: true, params: [{ key: 'texte', label: 'Texte', kind: 'textarea', required: true }], aide: 'Orthographe, accords simples, majuscules, espaces et ponctuation française. Les autres applis d\'Odin s\'en servent aussi.' },
    { kind: 'steps', title: 'Correcteur', onglet: C, items: [
      { title: 'Correcteur de base', detail: 'Toujours là, sans rien installer : typographie française, majuscules, mots répétés, accords simples, fautes d\'usage courantes.', done: true },
      { title: 'LanguageTool (plus complet, plusieurs langues)', detail: lt ? `Relié : ${lt}` : `Pas installé. « Installer » le lance à côté d'Odin (port ${LT_PORT}, environ 512 Mo de mémoire) ; ou « Relier un correcteur LanguageTool » si tu en as déjà un.`, done: Boolean(lt), ...(lt ? {} : { action: 'installer_correcteur', button: 'Installer' }) },
    ] },
    { kind: 'table', title: 'Tableaux blancs', onglet: T, columns: ['Nom', 'Contenu', 'Modifié'], empty: 'Aucun tableau : la page de Plume a l\'éditeur (formes, flèches, trait libre, texte).', rows: l.filter((d) => d.genre === 'tableau').map(ligne) },
    { kind: 'table', title: 'Schémas', onglet: S, columns: ['Nom', 'Contenu', 'Modifié'], empty: 'Aucun schéma : « Schéma de mon réseau » part des appareils d\'Atlas.', rows: l.filter((d) => d.genre === 'schema').map(ligne) },
    { kind: 'actions', title: 'Partir de mon réseau', onglet: S, boutons: [{ action: 'schema_reseau', label: 'Schéma de mon réseau', primary: true }], aide: `Blocs disponibles : ${GENRES_BLOC.map((g) => STYLE_BLOC[g].nom).join(', ')}.` },
    { kind: 'text', title: 'Maquettes (Penpot)', onglet: S, text: penpot ? `Penpot est relié : ${penpot}. Connexion avec ton compte Odin : Persona → « Connexion Odin pour un logiciel ».` : 'Penpot (maquettes et design) s\'installe à part (plusieurs services) puis se relie ici : « Relier Penpot ».' },
  ];
}
