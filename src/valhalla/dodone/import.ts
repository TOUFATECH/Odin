// Dodone · import et export.
//   - Collection Postman v2.1 : dossiers aplatis (« Dossier / Sous-dossier »), auth bearer, basic et apikey converties
//     en en-têtes ; les scripts JavaScript NE SONT PAS exécutés (exécuter du code venu d'un fichier est un risque) :
//     ils sont signalés. Une valeur secrète écrite en clair dans la collection va au coffre, remplacée par {{NOM}}.
//   - Environnement Postman : les valeurs de type secret, ou dont le nom contient token, key, secret ou pass, vont
//     au coffre ; les autres restent des variables.
//   - OpenAPI 3 en JSON ou en YAML (lireYaml de Muse) : une requête par opération, {param} → {{param}}, {{baseUrl}}.
//   - Export en collection Postman v2.1 sans aucun secret (laissés en {{NOM}}). Pur.
import { lireYaml } from '../dvalinn/maison.ts';
import { nouvelId, type Collection, type Entete, type Environnement, type Requete } from './collections.ts';

type O = Record<string, unknown>;
const obj = (x: unknown): O => (x && typeof x === 'object' && !Array.isArray(x) ? x as O : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown) => (x === undefined || x === null ? '' : typeof x === 'string' ? x : String(x));
export const nomSecret = (n: string) => /token|key|secret|pass|auth|session|cookie/i.test(n);
const estVariable = (v: string) => /^\{\{\s*[\w.-]+\s*\}\}$/.test(v.trim());
const nomVariable = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'SECRET';

export interface Importe { collection?: Collection; environnement?: Environnement; secrets: Record<string, string>; signalements: string[] }

/** Une valeur secrète : déjà une {{variable}}, ou mise de côté pour le coffre (rendue en {{NOM}}). */
function versCoffre(v: string, nom: string, secrets: Record<string, string>): string {
  if (!v || estVariable(v)) return v;
  let n = nomVariable(nom); for (let k = 2; secrets[n] !== undefined && secrets[n] !== v; k++) n = `${nomVariable(nom)}_${k}`;
  secrets[n] = v; return `{{${n}}}`;
}
/**
 * Les paramètres « nom=valeur » d'une chaîne de lien (?a=1&b=2) ou d'un corps de formulaire dont le nom désigne un
 * secret (api_key, token, password…) : `remplacer` reçoit le nom et la valeur telle qu'écrite (encodée), et rend la
 * nouvelle valeur. Une valeur vide ou déjà en {{variable}} n'est pas touchée. Pur.
 */
export function parametresSecrets(t: string, remplacer: (nom: string, valeur: string) => string): string {
  return t.replace(/(^|[?&])([^=&#?\s]+)=([^&#\s]*)/g, (m, sep: string, k: string, v: string) => {
    let nom = k; try { nom = decodeURIComponent(k); } catch { /* nom laissé tel quel */ }
    if (!v || !nomSecret(nom) || /\{\{/.test(v)) return m;
    return `${sep}${k}=${remplacer(nom, v)}`;
  });
}
/** Pareil pour un lien : seulement ce qui suit le « ? » (jamais le chemin). Pur. */
export function parametresSecretsLien(url: string, remplacer: (nom: string, valeur: string) => string): string {
  const i = url.indexOf('?'); if (i < 0) return url;
  const j = url.indexOf('#', i), fin = j < 0 ? url.length : j;
  return url.slice(0, i) + parametresSecrets(url.slice(i, fin), remplacer) + url.slice(fin);
}
/** Les champs JSON « "password": "…" » d'un corps dont le nom désigne un secret, et les paramètres d'un formulaire. Pur. */
export function champsSecretsCorps(c: string, remplacer: (nom: string, valeur: string) => string): string {
  const x = c.replace(/("([^"\\]+)"\s*:\s*")((?:[^"\\]|\\.)*)"/g, (m, debut: string, k: string, v: string) => (v && nomSecret(k) && !/\{\{/.test(v) ? `${debut}${remplacer(k, v)}"` : m));
  return /^\s*[[{<]/.test(x) ? x : parametresSecrets(x, remplacer);
}
/**
 * Les secrets écrits en clair dans le lien ou le corps d'une requête partent dans `secrets` (pour le coffre) et sont
 * remplacés par {{NOM}}. La valeur est gardée telle qu'écrite : l'envoi refait exactement la même requête.
 */
export function secretsHorsRequete(r: { url: string; corps?: string }, secrets: Record<string, string>): { url: string; corps?: string } {
  const vers = (nom: string, v: string) => versCoffre(v, nom, secrets);
  return { url: parametresSecretsLien(r.url, vers), ...(r.corps !== undefined ? { corps: champsSecretsCorps(r.corps, vers) } : {}) };
}
const kv = (l: unknown) =>Object.fromEntries(arr(l).map((x) => [str(obj(x).key), str(obj(x).value)]));
function authVersEntetes(a: O, secrets: Record<string, string>, ou: string, sig: string[]): Entete[] {
  const t = str(a.type).toLowerCase();
  if (!t || t === 'noauth' || t === 'inherit') return [];
  const p = kv(a[t]);
  if (t === 'bearer') return [{ nom: 'Authorization', valeur: `Bearer ${versCoffre(p.token ?? '', `${ou} jeton`, secrets)}` }];
  if (t === 'basic') return [{ nom: 'Authorization', valeur: `Basic {{@base64 ${p.username ?? ''}:${versCoffre(p.password ?? '', `${ou} mot de passe`, secrets)}}}` }];
  if (t === 'apikey') {
    if ((p.in ?? 'header') === 'query') { sig.push(`${ou} : clé d'API passée dans le lien, mise en en-tête ${p.key ?? 'X-Api-Key'} à la place (vérifie que le service l'accepte)`); }
    return [{ nom: p.key || 'X-Api-Key', valeur: versCoffre(p.value ?? '', `${ou} clé`, secrets) }];
  }
  sig.push(`${ou} : authentification « ${t} » non reprise`);
  return [];
}
function corpsDe(b: O): string | undefined {
  const mode = str(b.mode);
  if (mode === 'raw') return str(b.raw) || undefined;
  if (mode === 'urlencoded') return arr(b.urlencoded).filter((x) => !obj(x).disabled).map((x) => `${encodeURIComponent(str(obj(x).key))}=${encodeURIComponent(str(obj(x).value))}`).join('&') || undefined;
  if (mode === 'graphql') return JSON.stringify({ query: str(obj(b.graphql).query), variables: obj(b.graphql).variables ?? undefined });
  return undefined;
}

/** Collection Postman v2.1 → collection Dodone. */
export function importerPostman(x: unknown): Importe {
  const c = obj(x), info = obj(c.info), sig: string[] = [], secrets: Record<string, string> = {};
  if (!Array.isArray(c.item) || !info.name) throw new Error('ce n\'est pas une collection Postman (info.name et item attendus)');
  if (info.schema && !/v2\.[01]/.test(str(info.schema))) sig.push(`format ${str(info.schema)} : lu comme une v2.1`);
  const requetes: Requete[] = [], authCollection = obj(c.auth);
  const scripts = (e: unknown, ou: string) => { for (const ev of arr(e)) { const exec = arr(obj(obj(ev).script).exec).join('\n').trim(); if (exec) sig.push(`script « ${str(obj(ev).listen) || 'script'} » de ${ou} : NON exécuté (Dodone n'exécute pas de code venu d'un fichier)`); } };
  scripts(c.event, 'la collection');
  const parcourir = (items: unknown[], dossier: string[], authParent: O) => {
    for (const it of items) {
      const i = obj(it), nom = str(i.name) || 'sans nom';
      if (Array.isArray(i.item)) { scripts(i.event, `« ${nom} »`); parcourir(i.item, [...dossier, nom], Object.keys(obj(i.auth)).length ? obj(i.auth) : authParent); continue; }
      const r = typeof i.request === 'string' ? { url: i.request } as O : obj(i.request);
      scripts(i.event, `« ${nom} »`);
      const u = r.url, url = typeof u === 'string' ? u : str(obj(u).raw);
      const entetes: Entete[] = arr(r.header).filter((h) => !obj(h).disabled).map((h) => { const n = str(obj(h).key), v = str(obj(h).value); return { nom: n, valeur: nomSecret(n) ? versCoffre(v, `${nom} ${n}`, secrets) : v }; });
      const a = Object.keys(obj(r.auth)).length ? obj(r.auth) : authParent;
      entetes.push(...authVersEntetes(a, secrets, `« ${nom} »`, sig));
      if (str(obj(r.body).mode) === 'formdata' || str(obj(r.body).mode) === 'file') sig.push(`« ${nom} » : corps « ${str(obj(r.body).mode)} » (fichiers) non repris`);
      // Une clé dans le lien (?api_key=…) ou un mot de passe dans le corps : au coffre aussi, comme les en-têtes.
      const brut = corpsDe(obj(r.body)), x = secretsHorsRequete({ url, ...(brut ? { corps: brut } : {}) }, secrets);
      requetes.push({ id: nouvelId(), nom: nom.slice(0, 120), ...(dossier.length ? { dossier: dossier.join(' / ') } : {}), methode: (str(r.method) || 'GET').toUpperCase(), url: x.url, entetes, ...(x.corps ? { corps: x.corps } : {}), tests: [] });
    }
  };
  // Les variables d'abord : une variable secrète garde son nom d'origine (les requêtes l'appellent {{api_key}}, pas
  // {{API_KEY}}), et les secrets trouvés ensuite dans les requêtes ne peuvent pas prendre son nom.
  const variables: Record<string, string> = {};
  for (const v of arr(c.variable)) { const k = str(obj(v).key), val = str(obj(v).value); if (!k) continue; if (nomSecret(k) && val && !estVariable(val)) secrets[/^[\w.-]{1,60}$/.test(k) ? k : nomVariable(k)] = val; else variables[k] = val; }
  parcourir(c.item as unknown[], [], authCollection);
  if (requetes.length > 2000) throw new Error('collection trop grosse (2000 requêtes au plus)');
  return { collection: { id: nouvelId(), nom: str(info.name).slice(0, 120), requetes, variables, maj: new Date().toISOString(), ...(sig.length ? { signalements: sig } : {}) }, secrets, signalements: sig };
}

/** Environnement Postman → environnement Dodone ; les secrets à part (pour le coffre). */
export function importerEnvironnementPostman(x: unknown): Importe {
  const e = obj(x);
  if (!Array.isArray(e.values) || !e.name) throw new Error('ce n\'est pas un environnement Postman (name et values attendus)');
  const variables: Record<string, string> = {}, secrets: Record<string, string> = {};
  for (const v of e.values as unknown[]) {
    const o = obj(v), k = str(o.key); if (!k || o.enabled === false) continue;
    if (str(o.type) === 'secret' || nomSecret(k)) secrets[k] = str(o.value); else variables[k] = str(o.value);
  }
  return { environnement: { id: nouvelId(), nom: str(e.name).slice(0, 80), variables, maj: new Date().toISOString() }, secrets, signalements: [] };
}

/** OpenAPI 3 (JSON ou YAML) → collection Dodone. */
export function importerOpenApi(texte: string): Importe {
  let d: O; const t = texte.trim();
  try { d = obj(t.startsWith('{') ? JSON.parse(t) : lireYaml(t)); } catch (e) { throw new Error(`OpenAPI illisible : ${(e as Error).message}`); }
  if (!/^3\./.test(str(d.openapi))) throw new Error('ce n\'est pas un fichier OpenAPI 3 (champ openapi: 3.x attendu)');
  const sig: string[] = [], requetes: Requete[] = [], base = str(obj(arr(d.servers)[0]).url);
  for (const [chemin, ops] of Object.entries(obj(d.paths))) {
    for (const [m, op] of Object.entries(obj(ops))) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(m)) continue;
      const o = obj(op), contenu = obj(obj(obj(o.requestBody).content)['application/json']);
      const exemple = contenu.example ?? obj(Object.values(obj(contenu.examples))[0]).value;
      const tag = str(arr(o.tags)[0]);
      requetes.push({ id: nouvelId(), nom: (str(o.operationId) || str(o.summary) || `${m.toUpperCase()} ${chemin}`).slice(0, 120), ...(tag ? { dossier: tag } : {}), methode: m.toUpperCase(), url: `{{baseUrl}}${chemin.replace(/\{([\w.-]+)\}/g, '{{$1}}')}`,
        entetes: exemple !== undefined ? [{ nom: 'Content-Type', valeur: 'application/json' }] : [], ...(exemple !== undefined ? { corps: JSON.stringify(exemple, null, 2) } : {}), tests: [] });
    }
  }
  if (Object.keys(obj(obj(d.components).securitySchemes)).length) sig.push('les schémas de sécurité ne sont pas repris : ajoute l\'en-tête d\'authentification avec une variable du coffre');
  return { collection: { id: nouvelId(), nom: (str(obj(d.info).title) || 'OpenAPI').slice(0, 120), requetes, variables: { baseUrl: base }, maj: new Date().toISOString(), ...(sig.length ? { signalements: sig } : {}) }, secrets: {}, signalements: sig };
}

/** Devine le genre du fichier et l'importe. */
export function importer(texte: string): Importe {
  const t = texte.replace(/^﻿/, '').trim();
  if (t.startsWith('{')) {
    let j: O; try { j = obj(JSON.parse(t)); } catch { throw new Error('JSON illisible'); }
    if (j.openapi) return importerOpenApi(t);
    if (j.info && Array.isArray(j.item)) return importerPostman(j);
    if (Array.isArray(j.values)) return importerEnvironnementPostman(j);
    throw new Error('format inconnu : collection Postman v2.1, environnement Postman ou OpenAPI 3');
  }
  return importerOpenApi(t);
}

/** Collection Dodone → collection Postman v2.1 (aucun secret : `secrets` sont remplacés par {{NOM}}). */
export function exporterPostman(c: Collection, secrets: Record<string, string> = {}): string {
  const cacher = (v: string) => { let x = v; for (const [n, s] of Object.entries(secrets).sort((a, b) => b[1].length - a[1].length)) if (s.length >= 3) x = x.split(s).join(`{{${n}}}`); return x; };
  // Un paramètre à nom secret encore en clair (requête d'avant cette règle) : exporté en {{NOM}}, jamais sa valeur.
  const enVariable = (nom: string) => `{{${nomVariable(nom)}}}`;
  const racine: Array<O> = [], dossiers = new Map<string, O[]>();
  for (const r of c.requetes) {
    const item: O = { name: r.nom, request: { method: r.methode, header: r.entetes.map((h) => ({ key: h.nom, value: nomSecret(h.nom) && !/\{\{/.test(h.valeur) ? `{{${nomVariable(h.nom)}}}` : cacher(h.valeur) })), url: { raw: parametresSecretsLien(cacher(r.url), enVariable) }, ...(r.corps ? { body: { mode: 'raw', raw: champsSecretsCorps(cacher(r.corps), enVariable) } } : {}) } };
    if (!r.dossier) { racine.push(item); continue; }
    if (!dossiers.has(r.dossier)) { const l: O[] = []; dossiers.set(r.dossier, l); racine.push({ name: r.dossier, item: l }); }
    dossiers.get(r.dossier)!.push(item);
  }
  return JSON.stringify({
    info: { name: c.nom, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: racine,
    variable: Object.entries(c.variables).map(([key, value]) => ({ key, value: nomSecret(key) ? '' : cacher(value) })),
  }, null, 2);
}
