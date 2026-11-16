// Dodone — envoyer des requêtes à tes services web et vérifier leurs réponses : collections de requêtes rangées en
// dossiers, environnements de variables {{nom}}, jetons et clés au coffre (jamais en base, jamais affichés),
// historique, tests simples (code, temps, contenu JSON), import d'une collection Postman ou d'un fichier OpenAPI,
// export, et collections lancées à leur rythme par Talos (une alerte quand un test échoue).
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Action, Module, ModCtx, RythmeAppli, Section, TacheAppli, Tone } from '../types.ts';
import { journalDe } from '../base/journal.ts';
import { tacheEnPause } from '../automatismes.ts';
import { prochaine, type Rythme } from '../../draupnir/rythme.ts';
import { etatCourant, lireEntetes, lireTests, lireVariables, METHODES, nouvelId, substituer, texteTest, variablesDe, type Collection, type Environnement, type Requete, type Version } from '../dodone/collections.ts';
import { Coffre, MASQUE, masquerSecrets } from '../dodone/coffre.ts';
import { envoyer, evaluer, RESOUDRE_SYSTEME, type Reponse, type Resoudre, type ResultatTest } from '../dodone/envoi.ts';
import { champsSecretsCorps, exporterPostman, importer, nomSecret, parametresSecretsLien, secretsHorsRequete } from '../dodone/import.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
export const MAX_COLLECTION = 200, PAUSE_MS = 100;
export interface LigneEnvoi { at: string; collection?: string; requete: string; methode: string; url: string; code?: number; ms?: number; taille?: number; tests: ResultatTest[]; erreur?: string }

let resoudre: Resoudre = RESOUDRE_SYSTEME, machine: Set<string> | undefined;
/** Les essais remplacent la résolution DNS (et les adresses de cette machine). */
export function reseauDodone(o: { resoudre?: Resoudre; machine?: Set<string> } = {}): void { resoudre = o.resoudre ?? RESOUDRE_SYSTEME; machine = o.machine; }

// ---------------------------------------------------------------- Rangement
const versions = (ctx: ModCtx) => journalDe<Version>(ctx, 'dodone', 'versions.jsonl', { garder: 20000 });
const envois = (ctx: ModCtx) => journalDe<LigneEnvoi>(ctx, 'dodone_envois', 'envois.jsonl', { garder: 3000 });
const coffre = (ctx: ModCtx) => new Coffre(ctx.dir, ctx.home);
const etat = (ctx: ModCtx) => etatCourant(versions(ctx).tout());
const sauverC = (ctx: ModCtx, c: Collection) => versions(ctx).ajouter({ at: ctx.now().toISOString(), genre: 'collection', c: { ...c, maj: ctx.now().toISOString() } });
const sauverE = (ctx: ModCtx, e: Environnement) => versions(ctx).ajouter({ at: ctx.now().toISOString(), genre: 'environnement', e: { ...e, maj: ctx.now().toISOString() } });
const trouverC = (ctx: ModCtx, x: unknown): Collection => { const t = s(x).toLowerCase(), c = etat(ctx).collections.find((y) => y.id === s(x) || y.nom.toLowerCase() === t); if (!c) throw new Error(`collection « ${s(x)} » inconnue`); return c; };
const trouverE = (ctx: ModCtx, x: unknown): Environnement | undefined => { const t = s(x).toLowerCase(); return t ? etat(ctx).environnements.find((y) => y.id === s(x) || y.nom.toLowerCase() === t) : undefined; };
const envActif = (ctx: ModCtx, x?: unknown) => trouverE(ctx, x) ?? trouverE(ctx, ctx.settings.envActif);
/** Les dernières réponses (en mémoire seulement : elles peuvent contenir des données privées). */
const reponses: Array<{ at: string; requete: string; r: Reponse }> = [];
const masquer = (ctx: ModCtx, t: string) => masquerSecrets(t, coffre(ctx).toutes());

/** Les variables d'un envoi : celles de la collection, puis de l'environnement, puis ses secrets (au coffre). */
function variables(ctx: ModCtx, c: Collection | undefined, e: Environnement | undefined): Record<string, string> {
  return { ...(c?.variables ?? {}), ...(e?.variables ?? {}), ...(e ? coffre(ctx).valeurs(e.id) : {}), ...(c ? coffre(ctx).valeurs(`collection:${c.id}`) : {}) };
}
async function envoyerUne(ctx: ModCtx, rq: Requete, c: Collection | undefined, e: Environnement | undefined): Promise<LigneEnvoi> {
  const v = variables(ctx, c, e), entetes: Record<string, string> = {};
  for (const h of rq.entetes) entetes[h.nom] = substituer(h.valeur, v);
  const url = substituer(rq.url, v), at = ctx.now().toISOString();
  const corps = rq.corps ? substituer(rq.corps, v) : undefined;
  const manque = variablesDe(url).concat(...Object.values(entetes).map(variablesDe), corps ? variablesDe(corps) : []);
  const m = masqueurEnvoi(ctx, rq, entetes, url, corps);
  const base: LigneEnvoi = { at, ...(c ? { collection: c.nom } : {}), requete: rq.nom, methode: rq.methode, url: m(masquerUrlSecrets(url)), tests: [] };
  try {
    if (manque.length) throw new Error(`variable(s) inconnue(s) : ${[...new Set(manque)].join(', ')}`);
    const r = await envoyer(ctx.fetch, { methode: rq.methode, url, entetes, ...(corps ? { corps } : {}) }, { resoudre, ...(machine ? { machine } : {}) });
    // Les tests lisent la vraie réponse ; ce qui reste en mémoire (et peut s'afficher) est masqué.
    const tests = evaluer(rq.tests, r).map((t) => ({ ...t, ...(t.detail ? { detail: m(t.detail) } : {}) }));
    reponses.push({ at, requete: rq.nom, r: { ...r, corps: m(r.corps) } }); if (reponses.length > 50) reponses.shift();
    return { ...base, code: r.code, ms: r.ms, taille: r.taille, tests };
  } catch (err) { return { ...base, erreur: m((err as Error).message).slice(0, 200) }; }
}
/**
 * Ce qu'il faut masquer pour CET envoi : les secrets du coffre, plus chaque valeur d'en-tête à nom secret une fois
 * substituée (« Basic Ym9iOmh1bnRlcjIy », son jeton, et « bob:hunter22 » décodé : masquerSecrets masque aussi son
 * base64), et les paramètres à nom secret du lien et du corps. Un service qui renvoie l'en-tête en écho ne le montre pas.
 */
function masqueurEnvoi(ctx: ModCtx, rq: Requete, entetes: Record<string, string>, url: string, corps?: string): (t: string) => string {
  const l = coffre(ctx).toutes();
  for (const h of rq.entetes) {
    if (!nomSecret(h.nom)) continue;
    const val = entetes[h.nom] ?? ''; l.push(val);
    const x = /^(\w+)\s+(.+)$/.exec(val);
    if (x) { l.push(x[2]); if (/^basic$/i.test(x[1])) l.push(Buffer.from(x[2], 'base64').toString('utf8')); }
  }
  const noter = (_n: string, v: string) => { l.push(v); try { l.push(decodeURIComponent(v)); } catch { /* laissé tel quel */ } return v; };
  parametresSecretsLien(url, noter); if (corps) champsSecretsCorps(corps, noter);
  const liste = [...new Set(l)].filter((v) => v.length >= 3);
  return (t: string) => masquerSecrets(t, liste);
}
const masquerUrlSecrets = (raw: string) => { try { const u = new URL(raw); u.username = ''; u.password = ''; for (const k of [...u.searchParams.keys()]) if (nomSecret(k)) u.searchParams.set(k, MASQUE); return u.toString().replace(/%E2%97%8F/g, '●'); } catch { return raw; } };
const ligneTexte = (l: LigneEnvoi) => `${l.requete} · ${l.methode} ${l.url} → ${l.erreur ? `erreur : ${l.erreur}` : `${l.code} (${l.ms} ms)`}${l.tests.length ? ` · tests ${l.tests.filter((t) => t.ok).length}/${l.tests.length}` : ''}`;

/** Lance une collection en séquence (200 requêtes au plus, 100 ms au moins entre deux). */
export async function lancerCollection(ctx: ModCtx, c: Collection, e: Environnement | undefined): Promise<{ lignes: LigneEnvoi[]; echecs: number }> {
  const l: LigneEnvoi[] = [];
  for (const [k, rq] of c.requetes.slice(0, MAX_COLLECTION).entries()) {
    if (k) await new Promise((w) => setTimeout(w, PAUSE_MS));
    const x = await envoyerUne(ctx, rq, c, e); envois(ctx).ajouter(x); l.push(x);
  }
  const echecs = l.filter((x) => x.erreur || x.tests.some((t) => !t.ok)).length;
  ctx.emit('collection_terminee', { collection: c.nom, requetes: l.length, echecs });
  if (echecs) {
    ctx.emit('test_echoue', { collection: c.nom, echecs });
    ctx.alert({ level: 'moyenne', title: `Dodone : ${echecs} requête(s) en échec dans « ${c.nom.slice(0, 60)} »`, detail: l.filter((x) => x.erreur || x.tests.some((t) => !t.ok)).slice(0, 5).map((x) => `${x.requete} : ${x.erreur ?? x.tests.filter((t) => !t.ok).map((t) => `${t.texte} (${t.detail ?? 'faux'})`).join(', ')}`).join('\n'), key: `dodone:echec:${c.id}` });
  }
  ctx.saveSettings({ derniers: { ...(ctx.settings.derniers as Record<string, string> | undefined), [c.id]: ctx.now().toISOString() } });
  return { lignes: l, echecs };
}

// ---------------------------------------------------------------- Programmation (Talos)
type Programme = { rythme: RythmeAppli; env?: string };
const programmes = (ctx: ModCtx): Record<string, Programme> => (ctx.settings.programmes as Record<string, Programme> | undefined) ?? {};
const RYTHMES: Record<string, RythmeAppli | null> = { 'chaque heure': { genre: 'heures', n: 1 }, 'toutes les 6 heures': { genre: 'heures', n: 6 }, 'chaque jour': { genre: 'jour', heure: '06:00' }, 'chaque semaine': { genre: 'semaine', jours: [1], heure: '06:00' }, jamais: null };
const tacheId = (id: string) => `collection-${id}`;
const verifierRythme = (r: RythmeAppli) => { if (r.genre === 'minutes' && r.n < 5) throw new Error('toutes les 5 minutes au plus souvent'); if (!['minutes', 'heures', 'jour', 'semaine', 'mois'].includes(r.genre)) throw new Error('rythme : minutes, heures, jour, semaine ou mois'); };
function taches(ctx: ModCtx): TacheAppli[] {
  const cs = etat(ctx).collections;
  return Object.entries(programmes(ctx)).flatMap(([id, p]) => {
    const c = cs.find((x) => x.id === id); if (!c) return [];
    return [{
      id: tacheId(id), nom: `Collection « ${c.nom} »`, quoi: `Lance les ${Math.min(MAX_COLLECTION, c.requetes.length)} requête(s) et leurs tests ; alerte si un test échoue.`,
      rythme: () => p.rythme, permis: ['minutes', 'heures', 'jour', 'semaine', 'mois'],
      regler: (cx, r) => { verifierRythme(r); cx.saveSettings({ programmes: { ...programmes(cx), [id]: { ...p, rythme: r } } }); },
      lancer: { action: 'lancer_collection', input: { collection: id } },
      dernier: (cx) => { const d = (cx.settings.derniers as Record<string, string> | undefined)?.[id]; return d ? { at: d } : undefined; },
    }];
  });
}

// ---------------------------------------------------------------- Actions
const P_COLL = { key: 'collection', label: 'Collection', kind: 'text' as const, required: true };
const P_ENV = { key: 'environnement', label: 'Environnement (vide : celui en cours)', kind: 'text' as const, default: '' };
const actions: Action[] = [
  { id: 'envoyer', label: 'Envoyer une requête', what: 'Une requête tout de suite, avec ses tests', external: true,
    params: [{ key: 'methode', label: 'Méthode', kind: 'select', options: METHODES, default: 'GET' }, { key: 'url', label: 'Lien (https://… ; {{variables}} permises)', kind: 'text', required: true }, { key: 'entetes', label: 'En-têtes (un par ligne, « Nom: valeur »)', kind: 'textarea', default: '' }, { key: 'corps', label: 'Corps', kind: 'textarea', default: '' }, { key: 'tests', label: 'Tests (un par ligne : code = 200, temps < 500, json data.id existe)', kind: 'textarea', default: '' }, P_ENV],
    words: ['envoie une requete', 'teste ma requete', 'requete http'],
    run: async (ctx, i) => {
      const rq: Requete = { id: nouvelId(), nom: 'requête directe', methode: s(i.methode).toUpperCase() || 'GET', url: s(i.url), entetes: lireEntetes(String(i.entetes ?? '')), ...(s(i.corps) ? { corps: String(i.corps) } : {}), tests: lireTests(String(i.tests ?? '')) };
      const l = await envoyerUne(ctx, rq, undefined, envActif(ctx, i.environnement)); envois(ctx).ajouter(l);
      const r = reponses[reponses.length - 1];
      return { ok: !l.erreur, text: `${l.erreur ? '✗' : '→'} ${ligneTexte(l)}${l.tests.map((t) => `\n${t.ok ? '✓' : '✗'} ${t.texte}${t.detail ? ` (${t.detail})` : ''}`).join('')}${!l.erreur && r ? `\n\n${masquer(ctx, r.r.corps.slice(0, 3000))}` : ''}`, data: { code: l.code, tests: l.tests } };
    } },
  { id: 'collection', label: 'Créer une collection', what: 'Une nouvelle collection de requêtes (ou renommer : collection et nouveau nom)', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'collection', label: 'Collection à renommer (vide : nouvelle)', kind: 'text', default: '' }],
    run: (ctx, i) => {
      const nom = s(i.nom).slice(0, 120);
      if (s(i.collection)) { const c = trouverC(ctx, i.collection); sauverC(ctx, { ...c, nom }); return { text: `✏ Collection renommée : ${nom}.` }; }
      if (etat(ctx).collections.some((c) => c.nom.toLowerCase() === nom.toLowerCase())) return { ok: false, text: `Une collection « ${nom} » existe déjà.` };
      const c: Collection = { id: nouvelId(), nom, requetes: [], variables: {}, maj: ctx.now().toISOString() }; sauverC(ctx, c);
      return { text: `📂 Collection « ${nom} » créée.`, data: { id: c.id } };
    } },
  { id: 'enregistrer', label: 'Enregistrer une requête', what: 'Ajoute (ou remplace, même nom) une requête dans une collection',
    params: [P_COLL, { key: 'nom', label: 'Nom de la requête', kind: 'text', required: true }, { key: 'dossier', label: 'Dossier (facultatif)', kind: 'text', default: '' }, { key: 'methode', label: 'Méthode', kind: 'select', options: METHODES, default: 'GET' }, { key: 'url', label: 'Lien ({{variables}} permises)', kind: 'text', required: true }, { key: 'entetes', label: 'En-têtes (un par ligne)', kind: 'textarea', default: '' }, { key: 'corps', label: 'Corps', kind: 'textarea', default: '' }, { key: 'tests', label: 'Tests (un par ligne)', kind: 'textarea', default: '' }],
    run: (ctx, i) => {
      const c = trouverC(ctx, i.collection), entetes = lireEntetes(String(i.entetes ?? ''));
      const enClair = entetes.find((h) => nomSecret(h.nom) && h.valeur && !/\{\{[\w.-]+\}\}/.test(h.valeur));
      if (enClair) return { ok: false, text: `L'en-tête ${enClair.nom} contient une valeur secrète en clair : range-la au coffre (action « Ranger un secret ») et écris {{NOM}} à la place.` };
      const nom = s(i.nom).slice(0, 120), ancien = c.requetes.find((r) => r.nom === nom);
      // Une clé dans le lien (?api_key=…) ou un mot de passe dans le corps : la valeur part au coffre de la collection,
      // remplacée par {{NOM}} (comme à l'import). Jamais en base, jamais affichée.
      const cf = coffre(ctx), deja = cf.valeurs(`collection:${c.id}`), secrets = { ...deja };
      const x = secretsHorsRequete({ url: s(i.url), ...(s(i.corps) ? { corps: String(i.corps) } : {}) }, secrets);
      const nouveaux = Object.keys(secrets).filter((n) => deja[n] !== secrets[n]);
      for (const n of nouveaux) cf.ranger(`collection:${c.id}`, n, secrets[n]);
      const rq: Requete = { id: ancien?.id ?? nouvelId(), nom, ...(s(i.dossier) ? { dossier: s(i.dossier).slice(0, 80) } : {}), methode: s(i.methode).toUpperCase() || 'GET', url: x.url, entetes, ...(x.corps ? { corps: x.corps } : {}), tests: lireTests(String(i.tests ?? '')) };
      sauverC(ctx, { ...c, requetes: ancien ? c.requetes.map((r) => (r.id === ancien.id ? rq : r)) : [...c.requetes, rq] });
      return { text: `💾 « ${nom} » ${ancien ? 'mise à jour' : 'ajoutée'} dans ${c.nom}.${nouveaux.length ? `\n🔐 ${nouveaux.map((n) => `{{${n}}}`).join(', ')} : valeur secrète rangée au coffre (${MASQUE}), plus jamais écrite en clair.` : ''}`, data: { coffre: nouveaux } };
    } },
  { id: 'environnement', label: 'Environnement', what: 'Crée ou met à jour un environnement de variables, et le rend actif', params: [{ key: 'nom', label: 'Nom (ex. maison, essai)', kind: 'text', required: true }, { key: 'variables', label: 'Variables non secrètes (une par ligne : nom=valeur)', kind: 'textarea', default: '' }],
    run: (ctx, i) => {
      const vars = lireVariables(String(i.variables ?? '')), secretes = Object.keys(vars).filter(nomSecret);
      if (secretes.length) return { ok: false, text: `${secretes.join(', ')} : ces noms désignent un secret. Range leur valeur au coffre (action « Ranger un secret »).` };
      const e = trouverE(ctx, i.nom), x: Environnement = e ? { ...e, variables: { ...e.variables, ...vars } } : { id: nouvelId(), nom: s(i.nom).slice(0, 80), variables: vars, maj: ctx.now().toISOString() };
      sauverE(ctx, x); ctx.saveSettings({ envActif: x.id });
      return { text: `🌐 Environnement « ${x.nom} » ${e ? 'mis à jour' : 'créé'} et actif (${Object.keys(x.variables).length} variable(s), ${coffre(ctx).noms(x.id).length} secret(s) au coffre).` };
    } },
  { id: 'secret', label: 'Ranger un secret', what: 'Un jeton, une clé ou un mot de passe, rangé chiffré au coffre ; jamais réaffiché', params: [{ key: 'environnement', label: 'Environnement', kind: 'text', required: true }, { key: 'nom', label: 'Nom de la variable (ex. JETON)', kind: 'text', required: true }, { key: 'valeur', label: 'Valeur', kind: 'password', required: true, help: 'Chiffrée avec la clé de la machine, jamais affichée ni gardée en base.' }],
    run: (ctx, i) => {
      const e = trouverE(ctx, i.environnement); if (!e) return { ok: false, text: `Environnement « ${s(i.environnement)} » inconnu : crée-le d'abord.` };
      coffre(ctx).ranger(e.id, s(i.nom), String(i.valeur ?? ''));
      if (s(i.nom) in e.variables) { const { [s(i.nom)]: _x, ...reste } = e.variables; sauverE(ctx, { ...e, variables: reste }); }
      return { text: `🔐 {{${s(i.nom)}}} est au coffre pour « ${e.nom} » (${MASQUE}).` };
    } },
  { id: 'importer', label: 'Importer', what: 'Une collection Postman v2.1, un environnement Postman, ou un fichier OpenAPI 3 (JSON ou YAML)',
    params: [{ key: 'fichier', label: 'Fichier', kind: 'text', default: '', depot: {} }, { key: 'contenu', label: 'Ou colle son contenu', kind: 'textarea', default: '' }],
    run: (ctx, i) => {
      let texte = String(i.contenu ?? '');
      if (s(i.fichier)) { const f = s(i.fichier).startsWith('depot:') ? join(ctx.dir, 'depots', basename(s(i.fichier).slice(6))) : s(i.fichier); if (!existsSync(f)) return { ok: false, text: 'Fichier introuvable.' }; texte = readFileSync(f, 'utf8'); }
      if (!texte.trim()) return { ok: false, text: 'Donne un fichier ou colle son contenu.' };
      if (texte.length > 10 * 1024 * 1024) return { ok: false, text: 'Fichier trop gros (10 Mo au plus).' };
      const r = importer(texte), cf = coffre(ctx);
      let dit = '';
      if (r.collection) {
        sauverC(ctx, r.collection);
        for (const [n, v] of Object.entries(r.secrets)) cf.ranger(`collection:${r.collection.id}`, n, v);
        dit = `📥 Collection « ${r.collection.nom} » : ${r.collection.requetes.length} requête(s)`;
      } else if (r.environnement) {
        sauverE(ctx, r.environnement);
        for (const [n, v] of Object.entries(r.secrets)) cf.ranger(r.environnement.id, n, v);
        dit = `📥 Environnement « ${r.environnement.nom} » : ${Object.keys(r.environnement.variables).length} variable(s)`;
      }
      const n = Object.keys(r.secrets).length;
      return { text: `${dit}${n ? `, ${n} secret(s) rangé(s) au coffre` : ''}.${r.signalements.length ? `\n${r.signalements.map((x) => `⚠ ${x}`).join('\n')}` : ''}`, data: { secrets: n, signalements: r.signalements } };
    } },
  { id: 'exporter', label: 'Exporter', what: 'La collection au format Postman v2.1, sans aucun secret (laissés en {{NOM}})', read: true, params: [P_COLL],
    run: (ctx, i) => {
      const c = trouverC(ctx, i.collection), d = join(ctx.dir, 'exports'); mkdirSync(d, { recursive: true, mode: 0o700 });
      const secrets: Record<string, string> = {};
      for (const e of etat(ctx).environnements) Object.assign(secrets, coffre(ctx).valeurs(e.id));
      Object.assign(secrets, coffre(ctx).valeurs(`collection:${c.id}`));
      const nom = `${c.nom.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'collection'}.postman_collection.json`;
      writeFileSync(join(d, nom), exporterPostman(c, secrets), { mode: 0o600 });
      return { text: `📤 ${c.nom} exportée (${c.requetes.length} requête(s), aucun secret).`, fichiers: [{ nom, ref: `export:${nom}` }] };
    } },
  { id: 'lancer_collection', label: 'Lancer une collection', what: 'Toutes ses requêtes en séquence (200 au plus), avec leurs tests', params: [P_COLL, P_ENV], words: ['lance la collection'],
    run: async (ctx, i) => {
      const c = trouverC(ctx, i.collection), e = envActif(ctx, i.environnement ?? programmes(ctx)[c.id]?.env);
      const r = await lancerCollection(ctx, c, e);
      return { ok: r.echecs === 0, text: `${r.echecs ? '⚠' : '✅'} ${c.nom} : ${r.lignes.length} requête(s), ${r.echecs} en échec${c.requetes.length > MAX_COLLECTION ? ` (seules les ${MAX_COLLECTION} premières)` : ''}.\n${r.lignes.map(ligneTexte).join('\n')}`, data: { echecs: r.echecs, requetes: r.lignes.length } };
    } },
  { id: 'programmer', label: 'Programmer une collection', what: 'La collection est lancée à son rythme par Talos', params: [P_COLL, { key: 'rythme', label: 'Rythme', kind: 'select', options: Object.keys(RYTHMES), default: 'chaque jour' }, P_ENV],
    run: (ctx, i) => {
      const c = trouverC(ctx, i.collection), r = RYTHMES[s(i.rythme)];
      if (r === undefined) return { ok: false, text: `Rythme : ${Object.keys(RYTHMES).join(', ')}.` };
      const { [c.id]: _x, ...reste } = programmes(ctx), e = trouverE(ctx, i.environnement);
      ctx.saveSettings({ programmes: r ? { ...reste, [c.id]: { rythme: r, ...(e ? { env: e.id } : {}) } } : reste, ...(r ? { [`prog:${c.id}`]: ctx.now().toISOString() } : {}) });
      return { text: r ? `🗓 ${c.nom} : ${s(i.rythme)} (visible et réglable dans Talos).` : `${c.nom} n'est plus programmée.` };
    } },
  { id: 'historique', label: 'Historique', what: 'Les derniers envois, secrets masqués', read: true, external: true,
    run: (ctx) => { const l = envois(ctx).tout().slice(-40).reverse(); return { text: l.length ? l.map(ligneTexte).join('\n') : 'Aucun envoi.', data: l }; } },
];

function vue(ctx: ModCtx) {
  const st = etat(ctx), e = envActif(ctx), h = envois(ctx).tout().slice(-40).reverse(), cf = coffre(ctx);
  const sections: Section[] = [
    { kind: 'form', onglet: 'Envoyer', title: 'Envoyer une requête', action: 'envoyer', submit: 'Envoyer', params: actions[0].params!, aide: e ? `Environnement en cours : ${e.nom}.` : 'Aucun environnement : crée-en un pour tes {{variables}}.' },
    ...st.collections.map((c): Section => ({ kind: 'table', onglet: 'Collections', title: `${c.nom}${programmes(ctx)[c.id] ? ' · programmée' : ''}`, columns: ['Dossier', 'Requête', 'Lien', 'Tests'], empty: 'Aucune requête.',
      rows: c.requetes.slice(0, 200).map((r) => ({ cells: [r.dossier ?? '—', `${r.methode} ${r.nom}`, masquer(ctx, parametresSecretsLien(r.url, () => MASQUE)).slice(0, 80), r.tests.map(texteTest).join(' ; ') || '—'] })) })),
    { kind: 'actions', onglet: 'Collections', title: 'Lancer', boutons: [], liste: { label: 'Collection', action: 'lancer_collection', champ: 'collection', valeurs: st.collections.map((c) => ({ valeur: c.id, label: c.nom })), bouton: 'Lancer' } },
    { kind: 'form', onglet: 'Collections', title: 'Créer une collection', action: 'collection', submit: 'Créer', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }] },
    { kind: 'form', onglet: 'Collections', title: 'Enregistrer une requête', action: 'enregistrer', submit: 'Enregistrer', params: actions.find((a) => a.id === 'enregistrer')!.params! },
    { kind: 'form', onglet: 'Collections', title: 'Programmer une collection', action: 'programmer', submit: 'Programmer', params: actions.find((a) => a.id === 'programmer')!.params! },
    { kind: 'form', onglet: 'Collections', title: 'Importer', action: 'importer', submit: 'Importer', params: actions.find((a) => a.id === 'importer')!.params!, aide: 'Les scripts JavaScript d\'une collection ne sont jamais exécutés ; les secrets vont au coffre.' },
    { kind: 'table', onglet: 'Environnements', title: 'Environnements', columns: ['Nom', 'Variables', 'Secrets au coffre'], empty: 'Aucun environnement.',
      rows: st.environnements.map((x) => ({ cells: [`${x.nom}${x.id === e?.id ? ' (en cours)' : ''}`, Object.entries(x.variables).map(([k, v]) => `${k}=${masquer(ctx, v).slice(0, 40)}`).join(', ') || '—', cf.noms(x.id).map((n) => `${n} = ${MASQUE} au coffre`).join(', ') || '—'], tone: (x.id === e?.id ? 'bon' : 'neutre') as Tone })) },
    { kind: 'form', onglet: 'Environnements', title: 'Environnement', action: 'environnement', submit: 'Enregistrer', params: actions.find((a) => a.id === 'environnement')!.params! },
    { kind: 'form', onglet: 'Environnements', title: 'Ranger un secret', action: 'secret', submit: 'Ranger au coffre', params: actions.find((a) => a.id === 'secret')!.params!, aide: 'La valeur est chiffrée et n\'est jamais réaffichée.' },
    { kind: 'table', onglet: 'Historique', title: 'Derniers envois', columns: ['Quand', 'Requête', 'Résultat', 'Tests'], empty: 'Aucun envoi.',
      rows: h.map((l) => ({ cells: [new Date(l.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }), `${l.collection ? `${l.collection} · ` : ''}${l.methode} ${l.url.slice(0, 80)}`, l.erreur ? `erreur : ${l.erreur}` : `${l.code} · ${l.ms} ms`, l.tests.length ? `${l.tests.filter((t) => t.ok).length}/${l.tests.length}` : '—'], tone: (l.erreur || l.tests.some((t) => !t.ok) ? 'mauvais' : l.tests.length ? 'bon' : 'neutre') as Tone })) },
  ];
  return {
    subtitle: 'Requêtes de tes services web', onglets: ['Envoyer', 'Collections', 'Environnements', 'Historique'],
    kpis: [
      { label: 'Collections', value: String(st.collections.length) },
      { label: 'Programmées', value: String(Object.keys(programmes(ctx)).length) },
      { label: 'Environnement', value: e?.nom ?? 'aucun' },
      { label: 'Échecs récents', value: String(h.slice(0, 20).filter((l) => l.erreur || l.tests.some((t) => !t.ok)).length), tone: (h.slice(0, 20).some((l) => l.erreur || l.tests.some((t) => !t.ok)) ? 'attention' : 'bon') as Tone },
    ],
    sections,
  };
}

export const dodone: Module = {
  id: 'dodone', name: 'Dodone', family: 'Données',
  what: 'Envoie des requêtes à tes services web et vérifie leurs réponses : collections, environnements de variables, jetons au coffre, tests, import d\'une collection Postman ou d\'un fichier OpenAPI, lancement programmé.',
  does: [
    'collections de requêtes rangées en dossiers, et environnements de variables {{nom}}',
    'jetons, clés et mots de passe au coffre (chiffrés), jamais en base ni affichés, masqués dans les réponses et l\'historique',
    'tests simples : code attendu, temps maximum, chemin JSON qui existe, est égal à ou contient',
    'import d\'une collection ou d\'un environnement Postman v2.1 (scripts signalés, jamais exécutés) et d\'un fichier OpenAPI 3 (JSON ou YAML)',
    'export en collection Postman v2.1, sans aucun secret',
    'collection lancée en séquence (200 requêtes au plus, 100 ms entre deux), programmée par Talos, alerte quand un test échoue',
    'historique des envois ; les corps des réponses restent en mémoire seulement',
  ],
  from: ['Postman', 'Insomnia', 'Bruno', 'Hoppscotch'], upstream: ['usebruno/bruno', 'hoppscotch/hoppscotch', 'Kong/insomnia'],
  words: ['dodone', 'envoie une requete', 'collection de requetes', 'tester une api', 'tester mes requetes', 'requete http'],
  actions,
  view: (ctx) => vue(ctx),
  depot: (ctx) => ({ dossier: join(ctx.dir, 'depots'), ref: (nom) => `depot:${nom}` }),
  retrait: (ctx, ref) => { const m = /^export:([\w.-]+\.postman_collection\.json)$/.exec(ref); if (!m) return undefined; const f = join(ctx.dir, 'exports', m[1]); return existsSync(f) ? f : undefined; },
  watch: { every: 60, async run(ctx) {
    const now = ctx.now(), cs = etat(ctx).collections, der = (ctx.settings.derniers as Record<string, string> | undefined) ?? {};
    for (const [id, p] of Object.entries(programmes(ctx))) {
      const c = cs.find((x) => x.id === id); if (!c || tacheEnPause('dodone', tacheId(id))) continue;
      const depuis = Date.parse(der[id] || s(ctx.settings[`prog:${id}`]) || now.toISOString());
      const n = prochaine(p.rythme as Rythme, new Date(depuis));
      if (n && n.getTime() <= now.getTime()) await lancerCollection(ctx, c, envActif(ctx, p.env));
    }
  } },
  taches,
};
