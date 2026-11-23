// Le Store commun d'Andromède (ISO) et d'Hermès (logiciels) : ce qui se télécharge depuis les dépôts OFFICIELS.
//   - le catalogue : les sources connues (sources.ts + catalogue.ts), chacune avec son système, son type, son
//     architecture, sa dernière version vue et sa taille ; filtres et recherche par nom ;
//   - la recherche en ligne, quand les index officiels répondent : Homebrew (applications macOS : adresse de
//     l'éditeur et empreinte), Flathub (applications Linux : fiche et commande d'installation), GitHub (les fichiers
//     publiés par un projet, donné sous la forme « propriétaire/projet ») ; un index en panne ne casse rien : le
//     catalogue local répond seul ;
//   - la reconnaissance d'un fichier déjà présent : de quelle ISO ou de quel logiciel du catalogue il s'agit (nom,
//     empreinte publiée par l'éditeur, étiquette lue dans l'ISO), et s'il existe une version plus récente.
// Il n'existe pas d'index de « tout ce qui existe sur Internet » : le Store propose un catalogue large et soigné de
// sources officielles, ces trois index publics, et l'ajout d'une source par son adresse officielle.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { iconeCategorie, iconeType, logoSysteme, type Fiche } from './bibliotheque.ts';
import { MOTIF_LOGICIEL } from './logiciels.ts';
import { cmpVersion, type Fetch, type Kind, type Release, type Source, type VersionCatalogue } from './sources.ts';

/** La dernière version vue d'une source (gardée dans les réglages : sert au Store, aux Disponibles et aux Surveillés). */
export interface Vue { version: string; at: number; taille?: number; sha256?: string; url?: string; erreur?: string }
export interface EntreeStore {
  id: string; nom: string; genre: Kind; famille: string; systeme: string; arch: string;
  /** ISO : bureau, serveur, utilitaire, hyperviseur, NAS, pare-feu, secours ; logiciels : la catégorie */
  type: string;
  about: string; page: string; icone: string;
  /** pas de téléchargement automatique : la raison (la page officielle est donnée) */
  manuel?: string;
  version?: string; taille?: number; vuLe?: number;
  /** les versions déjà dans le dossier */
  presents: string[];
  surveille: boolean;
  etat: 'à télécharger' | 'présent' | 'à jour' | 'nouvelle version' | 'manuel' | 'en cours';
  /** trouvé dans un index en ligne (pas encore au catalogue) */
  enLigne?: { index: 'homebrew' | 'flathub' | 'github'; ref: string; fichier?: string; url?: string; sha256?: string; verifie?: boolean };
  /** le rangement du catalogue (ISO) : windows, linux, serveur, outil, autre */
  groupe?: GroupeCatalogue;
  /** les versions publiées, déjà lues sur le site officiel (une par série) */
  versions?: VersionCatalogue[];
  /** les versions qui attendent leur tour dans la file de téléchargement */
  enFile?: string[];
  /** la version qui se télécharge en ce moment */
  telecharge?: string;
}
export type GroupeCatalogue = 'windows' | 'linux' | 'serveur' | 'outil' | 'autre';
/** Le rangement d'une ISO dans le catalogue : Windows, Linux, Serveurs (serveur, hyperviseur, NAS, pare-feu), Outils de
 *  dépannage, Autres. Pur. */
export function groupeDe(m: { systeme: string; type: string }, famille: string, nom = ''): GroupeCatalogue {
  if (famille === 'Outils' || /^(secours|utilitaire)$/.test(m.type)) return 'outil';
  // Une image d'installation par le réseau, un DVD ou un système à essayer (Debian) reste avec son système, pas avec les serveurs.
  if (famille === 'Serveur' || /^(hyperviseur|NAS|pare-feu)$/.test(m.type) || (m.type === 'serveur' && !/netinst|dvd|live/i.test(nom))) return 'serveur';
  if (m.systeme === 'Windows') return 'windows';
  if (m.systeme === 'Linux') return 'linux';
  return 'autre';
}

const plat = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Système, architecture et type d'une source (dits par elle, sinon déduits de sa famille et de ses fichiers). Pur. */
export function metaDe(src: Source): { systeme: string; arch: string; type: string } {
  const m = src.match.source, n = plat(`${src.name} ${src.about}`);
  const arch = src.arch ?? (/arm64|aarch64/i.test(m) ? 'arm64' : 'x86_64');
  if (src.kind === 'logiciel') {
    const systeme = src.systeme ?? (/\\\.(?:exe|msi|msix)|windows|win64/i.test(m) ? 'Windows' : /\\\.(?:dmg|pkg)/i.test(m) ? 'macOS' : /\\\.(?:deb|rpm|appimage)/i.test(m) ? 'Linux' : /\\\.apk/i.test(m) ? 'Android' : 'Windows');
    return { systeme, arch, type: src.family };
  }
  const systeme = src.systeme ?? (src.family === 'Windows' ? 'Windows' : src.family === 'BSD' ? 'BSD' : ['Linux', 'Serveur', 'Outils'].includes(src.family) ? 'Linux' : 'Autre');
  const type = src.type ?? (/proxmox ve|hyperviseur/.test(n) ? 'hyperviseur' : /sauvegarde|backup/.test(n) && src.family === 'Serveur' ? 'serveur' : /copie et restauration|partitionner|depannage|secours/.test(n) ? 'secours' : src.family === 'Outils' ? 'utilitaire' : /server|serveur|netinst|minimal|dvd complet|conteneurs/.test(n) ? 'serveur' : 'bureau');
  return { systeme, arch, type };
}
/** L'icône d'une entrée : un logo générique par famille de système (ISO) ou par catégorie (logiciels). Aucune marque. Pur. */
export const iconeDe = (genre: Kind, o: { systeme: string; nom: string; type: string }): string => (genre === 'iso' ? logoSysteme({ systeme: o.systeme, detail: o.nom }) : iconeCategorie(o.type));

/** Les entrées du catalogue, avec ce qu'on sait d'elles ici (présentes, surveillées, dernière version vue, en cours). Pur. */
export function entrees(o: { sources: Source[]; presents: Map<string, string[]>; suivis: Set<string>; vues: Record<string, Vue>; enCours: Set<string>; versions?: Record<string, VersionCatalogue[]>; enFile?: Map<string, string[]>; telecharge?: Record<string, string> }): EntreeStore[] {
  return o.sources.map((src) => {
    const m = metaDe(src), v = o.vues[src.id], la = [...(o.presents.get(src.id) ?? [])].sort((a, b) => cmpVersion(b, a)), derniere = v?.erreur ? undefined : v?.version;
    const etat: EntreeStore['etat'] = o.enCours.has(src.id) ? 'en cours' : la.length ? (derniere ? (cmpVersion(derniere, la[0]) > 0 ? 'nouvelle version' : 'à jour') : 'présent') : src.manual ? 'manuel' : 'à télécharger';
    return { id: src.id, nom: src.name, genre: src.kind, famille: src.family, ...m, about: src.about, page: src.page, icone: iconeDe(src.kind, { systeme: m.systeme, nom: src.name, type: m.type }), ...(src.manual ? { manuel: src.manual } : {}),
      ...(derniere ? { version: derniere, vuLe: v!.at } : {}), ...(v?.taille ? { taille: v.taille } : {}), presents: la, surveille: o.suivis.has(src.id), etat,
      ...(src.kind === 'iso' ? { groupe: groupeDe(m, src.family, src.name) } : {}), ...(o.versions?.[src.id]?.length ? { versions: o.versions[src.id] } : {}),
      ...(o.enFile?.get(src.id)?.length ? { enFile: o.enFile.get(src.id) } : {}), ...(o.telecharge?.[src.id] ? { telecharge: o.telecharge[src.id] } : {}) };
  });
}
export interface Filtre { q?: string; systeme?: string; famille?: string; arch?: string; type?: string }
const tous = (v?: string) => !v || /^(tous|toutes|tout)$/i.test(v.trim());
/** Filtre (système, famille, architecture, type ou catégorie) et recherche par nom (sans accents, mots dans le désordre). Pur. */
export function filtrer(l: EntreeStore[], f: Filtre): EntreeStore[] {
  const mots = plat(f.q ?? '').split(/\s+/).filter(Boolean), eg = (a: string, b?: string) => tous(b) || plat(a) === plat(b!.trim());
  return l.filter((e) => eg(e.systeme, f.systeme) && eg(e.famille, f.famille) && eg(e.arch, f.arch) && eg(e.type, f.type) && mots.every((m) => plat(`${e.nom} ${e.id} ${e.about} ${e.famille} ${e.type} ${e.systeme}`).includes(m)));
}
/** Les valeurs proposées par chaque filtre (celles qui existent dans la liste). Pur. */
export function valeursFiltres(l: EntreeStore[]): { systemes: string[]; familles: string[]; archs: string[]; types: string[] } {
  const u = (k: 'systeme' | 'famille' | 'arch' | 'type') => [...new Set(l.map((e) => e[k]))].sort((a, b) => a.localeCompare(b, 'fr'));
  return { systemes: u('systeme'), familles: u('famille'), archs: u('arch'), types: u('type') };
}

// ---------------------------------------------------------------- Reconnaître un fichier déjà présent
export interface Reconnu { source?: Source; version?: string; par?: 'nom' | 'empreinte' | 'étiquette'; derniere?: string; etat: 'à jour' | 'nouvelle version' | 'pas vérifié' | 'hors catalogue' }
/**
 * De quelle entrée du catalogue vient ce fichier ? Par son nom (le nom officiel du fichier), par son empreinte (celle
 * que l'éditeur publie pour la dernière version vue), ou par ce qu'Odin a lu dedans (étiquette et contenu de l'ISO,
 * nom du produit d'un installateur). Puis : à jour, ou une version plus récente existe ? Pur.
 */
export function reconnaitre(f: Pick<Fiche, 'nom' | 'sha256' | 'distribution' | 'detail' | 'version' | 'edition' | 'produit' | 'arch'>, sources: Source[], vues: Record<string, Vue>): Reconnu {
  let source = sources.find((s) => s.match.test(f.nom)), version = source ? source.match.exec(f.nom)?.[1] : undefined, par: Reconnu['par'] = source ? 'nom' : undefined;
  if (!source && f.sha256) { const id = Object.entries(vues).find(([, v]) => v.sha256 && v.sha256.toLowerCase() === f.sha256)?.[0]; source = sources.find((s) => s.id === id); if (source) { version = vues[source.id].version; par = 'empreinte'; } }
  if (!source) {
    const dit = plat(f.distribution ?? f.produit ?? f.detail ?? ''); const base = (s: Source) => plat(s.name.replace(/\s*\(.*\)\s*$/, ''));
    const l = dit.length >= 3 ? sources.filter((s) => { const b = base(s); return b.length >= 3 && (dit === b || dit.startsWith(`${b} `) || b.startsWith(`${dit} `) || dit.includes(b)); }) : [];
    // Plusieurs entrées du même nom (bureau, serveur, ARM) : celle dont le type et l'architecture collent.
    // Le nom exact d'abord, puis le plus précis (« Ubuntu Server » avant « Ubuntu »).
    l.sort((a, b) => Number(base(b) === dit) - Number(base(a) === dit) || base(b).length - base(a).length);
    source = l.find((s) => { const m = metaDe(s); return (!f.edition || plat(m.type) === plat(f.edition)) && (!f.arch || m.arch === f.arch); }) ?? l[0];
    if (source) { version = f.version; par = 'étiquette'; }
  }
  if (!source) return { etat: 'hors catalogue' };
  const v = vues[source.id], derniere = v && !v.erreur ? v.version : undefined;
  return { source, version, par, derniere, etat: !derniere || !version ? 'pas vérifié' : cmpVersion(derniere, version) > 0 ? 'nouvelle version' : 'à jour' };
}

// ---------------------------------------------------------------- Les index en ligne (officiels, publics, sans clé)
export interface IndexEtat { index: string; ok: boolean; n: number; erreur?: string }
const lire = async (f: Fetch, url: string, init: RequestInit = {}, ms = 20_000) => { const r = await f(url, { ...init, headers: { 'user-agent': 'Odin-Store/1', accept: 'application/json', ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`${new URL(url).host} répond ${r.status}`); return r; };
interface Cask { token: string; name: string[]; desc?: string; homepage?: string; url?: string; version?: string; sha256?: string }
/** L'index des applications macOS de Homebrew (formulae.brew.sh) : gardé un jour dans le dossier de l'appli, allégé. */
async function casks(f: Fetch, dir: string): Promise<Cask[]> {
  const fichier = join(dir, 'index-homebrew.json');
  try { if (existsSync(fichier) && Date.now() - statSync(fichier).mtimeMs < 86_400_000) return JSON.parse(readFileSync(fichier, 'utf8')) as Cask[]; } catch { /* cache abîmé : on le refait */ }
  try {
    const l = (await (await lire(f, 'https://formulae.brew.sh/api/cask.json', {}, 90_000)).json() as Cask[]).map((c) => ({ token: c.token, name: c.name, desc: c.desc, homepage: c.homepage, url: c.url, version: c.version, sha256: c.sha256 }));
    try { mkdirSync(dir, { recursive: true }); writeFileSync(fichier, JSON.stringify(l)); } catch { /* disque plein : on s'en passe */ }
    return l;
  } catch (e) { try { return JSON.parse(readFileSync(fichier, 'utf8')) as Cask[]; } catch { throw e; } }   // en panne : le cache d'avant, même vieux
}
const extDe = (u: string) => (/\.([a-z0-9]{2,10})(?:$|[?#])/i.exec(new URL(u).pathname)?.[1] ?? 'dmg').toLowerCase();
/**
 * Cherche dans les index officiels en ligne. Chaque index répond ou non, sans gêner les autres : `index` dit lequel
 * a répondu. Pour les ISO il n'existe pas d'index commun officiel : seul GitHub (« propriétaire/projet ») est interrogé.
 */
export async function chercherEnLigne(f: Fetch, genre: Kind, q: string, dir: string): Promise<{ resultats: EntreeStore[]; index: IndexEtat[] }> {
  const t = q.trim(), mots = plat(t).split(/\s+/).filter(Boolean), resultats: EntreeStore[] = [], index: IndexEtat[] = [];
  if (!t) return { resultats, index };
  const essai = async (nom: string, fn: () => Promise<EntreeStore[]>) => { try { const l = await fn(); resultats.push(...l); index.push({ index: nom, ok: true, n: l.length }); } catch (e) { index.push({ index: nom, ok: false, n: 0, erreur: (e as Error).message.slice(0, 140) }); } };
  const base = { genre, presents: [] as string[], surveille: false, etat: 'à télécharger' as const };
  // GitHub : les fichiers de la dernière version d'un projet (son dépôt officiel, donné par toi).
  if (/^[\w.-]+\/[\w.-]+$/.test(t)) await essai('GitHub', async () => {
    const r = await (await lire(f, `https://api.github.com/repos/${t}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } })).json() as { tag_name: string; html_url: string; assets: Array<{ name: string; browser_download_url: string; size: number; digest?: string | null }> };
    return r.assets.filter((a) => (genre === 'iso' ? /\.iso$/i : MOTIF_LOGICIEL).test(a.name)).slice(0, 30).map((a) => { const s = { systeme: genre === 'iso' ? 'Autre' : /\.(exe|msi|msix)$/i.test(a.name) ? 'Windows' : /\.(dmg|pkg)$/i.test(a.name) ? 'macOS' : /\.(deb|rpm|appimage)$/i.test(a.name) ? 'Linux' : /\.apk$/i.test(a.name) ? 'Android' : 'Autre', type: genre === 'iso' ? 'utilitaire' : 'Ajoutés par toi' };
      return { ...base, id: `github:${t}:${a.name}`, nom: a.name, famille: 'GitHub', ...s, arch: /arm64|aarch64/i.test(a.name) ? 'arm64' : 'x86_64', about: `Publié par ${t} (version ${r.tag_name})`, page: r.html_url, icone: genre === 'iso' ? logoSysteme({ systeme: 'Autre' }) : iconeType(a.name), version: r.tag_name.replace(/^v/i, ''), taille: a.size, enLigne: { index: 'github' as const, ref: t, fichier: a.name, url: a.browser_download_url, ...(a.digest?.startsWith('sha256:') ? { sha256: a.digest.slice(7) } : {}) } }; });
  });
  if (genre === 'logiciel') {
    // Homebrew : applications macOS, avec l'adresse de téléchargement de l'éditeur et son empreinte.
    await essai('Homebrew', async () => (await casks(f, dir)).filter((c) => c.url && mots.every((m) => plat(`${c.token} ${c.name.join(' ')} ${c.desc ?? ''}`).includes(m)))
      .sort((a, b) => Number(plat(b.token) === plat(t)) - Number(plat(a.token) === plat(t)) || a.token.length - b.token.length).slice(0, 25)
      .map((c) => ({ ...base, id: `homebrew:${c.token}`, nom: c.name[0] ?? c.token, famille: 'Homebrew', systeme: 'macOS', arch: /arm64|aarch64/i.test(c.url!) ? 'arm64' : /x86_64|x64|intel/i.test(c.url!) ? 'x86_64' : 'universel', type: 'macOS', about: c.desc ?? '', page: c.homepage ?? `https://formulae.brew.sh/cask/${c.token}`, icone: iconeType(`x.${extDe(c.url!)}`), version: c.version, enLigne: { index: 'homebrew' as const, ref: c.token, url: c.url, ...(c.sha256 && /^[a-f0-9]{64}$/.test(c.sha256) ? { sha256: c.sha256 } : {}) } })));
    // Flathub : applications Linux ; elles s'installent avec Flatpak (pas de fichier à ranger), Odin donne la fiche et la commande.
    await essai('Flathub', async () => {
      const r = await (await lire(f, 'https://flathub.org/api/v2/search?locale=fr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: t }) })).json() as { hits?: Array<{ app_id: string; name: string; summary?: string; main_categories?: string | string[]; verification_verified?: boolean }> };
      return (r.hits ?? []).slice(0, 20).map((h) => ({ ...base, etat: 'manuel' as const, id: `flathub:${h.app_id}`, nom: h.name, famille: 'Flathub', systeme: 'Linux', arch: 'x86_64', type: 'Linux', about: h.summary ?? '', page: `https://flathub.org/apps/${h.app_id}`, icone: iconeCategorie(String(Array.isArray(h.main_categories) ? h.main_categories[0] : h.main_categories ?? '')), manuel: `S'installe avec Flatpak, sans fichier à ranger : flatpak install flathub ${h.app_id}`, enLigne: { index: 'flathub' as const, ref: h.app_id, verifie: Boolean(h.verification_verified) } }));
    });
  }
  return { resultats, index };
}

/** Une application macOS de Homebrew mise en surveillance : gardée dans les réglages, suivie comme une source du catalogue. */
export interface SuiviHomebrew { ref: string; name: string; about?: string; page?: string }
export function sourceHomebrew(o: SuiviHomebrew): Source {
  if (!/^[a-z0-9][a-z0-9@+._-]{0,80}$/i.test(o.ref)) throw new Error('nom d\'application Homebrew invalide');
  const re = new RegExp(`^${o.ref.replace(/[.+^${}()|[\]\\]/g, '\\$&')}-(.+)\\.(?:dmg|pkg|zip)$`, 'i');
  return { id: `brew-${o.ref}`, name: o.name, kind: 'logiciel', family: 'macOS', systeme: 'macOS', about: o.about || 'Application macOS (index Homebrew : adresse de l\'éditeur)', match: re, color: '#6B7280', page: o.page ?? `https://formulae.brew.sh/cask/${o.ref}`, enLigne: 'homebrew',
    latest: async (f): Promise<Release> => {
      const c = await (await lire(f, `https://formulae.brew.sh/api/cask/${encodeURIComponent(o.ref)}.json`)).json() as Cask;
      if (!c.url || !c.version) throw new Error('cette application n\'a pas d\'adresse de téléchargement dans l\'index');
      // Le fichier est rangé sous un nom stable (« nom-version.dmg ») : c'est ainsi qu'Odin reconnaît sa version ensuite.
      return { version: c.version, url: c.url, file: `${o.ref}-${c.version.replace(/[^\w.+-]/g, '_')}.${['dmg', 'pkg', 'zip'].includes(extDe(c.url)) ? extDe(c.url) : 'dmg'}`, ...(c.sha256 && /^[a-f0-9]{64}$/.test(c.sha256) ? { sha256: c.sha256 } : {}), page: c.homepage };
    } };
}
/** Le motif d'un fichier publié sur GitHub, pour le suivre : sa version remplacée par « {version} ». Pur. */
export function motifDe(fichier: string, version: string): string | undefined {
  const v = version.replace(/^v/i, ''); if (!v) return undefined;
  for (const x of [v, v.replace(/\./g, ''), v.replace(/\./g, '_'), v.replace(/\./g, '-')]) { const i = fichier.indexOf(x); if (x.length >= 2 && i >= 0) return `${fichier.slice(0, i)}{version}${fichier.slice(i + x.length)}`; }
  return undefined;
}
