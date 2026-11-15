// Mnémosyne · Projet actif — Odin connaît le projet sur lequel tu travailles : il range ses fichiers en passages
// (une dizaine de lignes, ou une section d'un texte), les indexe en mémoire (plein texte, BM25), et répond à une
// question SANS IA en citant le passage trouvé et sa source (fichier et lignes). Aucune base de données :
// ~/.odin/memoire/projets/actif.json (le projet choisi) et ~/.odin/memoire/projets/<id>/ (fiche + passages en JSONL).
//
// Prudence :
// - les fichiers de secrets (.env, clés, mots de passe, fichiers protégés par Heimdall) ne sont jamais lus ;
// - une ligne qui ressemble à un secret (« token = … », « password: … ») est masquée dans l'index ;
// - le contenu des fichiers est une DONNÉE : il est cité, jamais suivi comme un ordre.

import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, relative, resolve } from 'node:path';
import { isSecretFile } from '../heimdall/policy.ts';
import { TextIndex, queryWords } from './fulltext.ts';

export interface Passage { f: string; l: number; l2: number; titre?: string; t: string }
export interface FicheProjet { id: string; nom: string; racine: string; at: string; fichiers: number; passages: number; ignores: number; masques: number }
export interface Source { fichier: string; lignes: string; extrait: string; score: number }
export interface ReponseProjet { trouve: boolean; texte: string; sources: Source[]; projet?: string }

const racineOdin = (home?: string) => home ?? process.env.ODIN_HOME ?? join(homedir(), '.odin');
export const dossierProjets = (home?: string) => join(racineOdin(home), 'memoire', 'projets');
export const idProjet = (racine: string) => createHash('sha256').update(resolve(racine).toLowerCase()).digest('hex').slice(0, 12);

const TEXTE = new Set(['.md', '.markdown', '.txt', '.rst', '.adoc', '.org', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh', '.ps1', '.bat', '.sql', '.html', '.htm', '.css', '.scss', '.vue', '.svelte', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.xml', '.csv', '.tex', '.lua', '.swift', '.dart', '.r', '.pl', '.dockerfile', '']);
const IGNORES = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.cache', '.idea', '.vscode', 'coverage', 'vendor', '.terraform', '.gradle']);
const SECRET_NOM = /^(\.env(\..*)?|.*\.(pem|key|p12|pfx|kdbx|enc|crt)|id_(rsa|ed25519|ecdsa)(\.pub)?|.*secret.*|.*password.*|credentials.*|\.npmrc|\.pypirc|\.netrc)$/i;
const SECRET_LIGNE = /\b(api[_-]?key|secret|token|password|passwd|mot[_ -]de[_ -]passe|private[_-]?key|access[_-]?key|bearer)\b\s*["']?\s*[:=]/i;

/** Range un texte en passages : par section (titres Markdown), sinon par blocs de 12 lignes. Pur. */
export function passages(fichier: string, texte: string, taille = 12): { liste: Passage[]; masques: number } {
  const lignes = texte.replace(/\r/g, '').split('\n'), liste: Passage[] = [];
  let masques = 0;
  const propre = (l: string) => { if (SECRET_LIGNE.test(l)) { masques++; return l.replace(/([:=]\s*["']?).*/, '$1[masqué]'); } return l; };
  const md = /\.(md|markdown|rst|adoc|org|txt)$/i.test(fichier);
  let debut = 0, titre: string | undefined;
  const pousse = (fin: number) => {
    const t = lignes.slice(debut, fin).map(propre).join('\n').trim();
    if (t) liste.push({ f: fichier, l: debut + 1, l2: fin, ...(titre ? { titre } : {}), t: t.slice(0, 4000) });
    debut = fin;
  };
  for (let i = 0; i < lignes.length; i++) {
    const h = md ? /^#{1,6}\s+(.+)$/.exec(lignes[i]) : null;
    if (h && i > debut) pousse(i);
    if (h) titre = h[1].trim().slice(0, 120);
    if (i + 1 - debut >= (md ? taille * 3 : taille)) pousse(i + 1);
  }
  pousse(lignes.length);
  return { liste, masques };
}

function debutBinaire(f: string): boolean {
  const b = Buffer.alloc(512); let fd: number | undefined;
  try { fd = openSync(f, 'r'); const n = readSync(fd, b, 0, 512, 0); return b.subarray(0, n).includes(0); } catch { return true; } finally { if (fd !== undefined) closeSync(fd); }
}

/** Le projet actif (s'il y en a un). */
export function projetActif(home?: string): FicheProjet | undefined {
  try { const a = JSON.parse(readFileSync(join(dossierProjets(home), 'actif.json'), 'utf8')) as { id: string }; return JSON.parse(readFileSync(join(dossierProjets(home), a.id, 'projet.json'), 'utf8')) as FicheProjet; } catch { return undefined; }
}

/** Choisit le projet actif et l'indexe (fichiers texte du dossier, 4 000 au plus, 512 ko chacun au plus). */
export function indexerProjet(racine: string, o: { home?: string; nom?: string; maxFichiers?: number; now?: Date } = {}): FicheProjet {
  const r = resolve(racine);
  if (!existsSync(r) || !statSync(r).isDirectory()) throw new Error(`dossier introuvable : ${racine}`);
  const odin = resolve(racineOdin(o.home)); // les données d'Odin ne font jamais partie d'un projet
  const max = o.maxFichiers ?? 4000, tous: Passage[] = [];
  let fichiers = 0, ignores = 0, masques = 0;
  const pile = [r];
  while (pile.length) {
    const d = pile.pop()!;
    let noms: string[] = []; try { noms = readdirSync(d); } catch { continue; }
    for (const n of noms.sort()) {
      const f = join(d, n); let st; try { st = statSync(f); } catch { continue; }
      if (st.isDirectory()) { if (resolve(f) !== odin && !IGNORES.has(n) && !(n.startsWith('.') && n !== '.github')) pile.push(f); continue; }
      const ext = extname(n).toLowerCase(), rel = relative(r, f).split('\\').join('/');
      if (!st.isFile() || SECRET_NOM.test(n) || isSecretFile(f) || !(TEXTE.has(ext) || /^(readme|makefile|dockerfile|license|changelog)$/i.test(n)) || st.size > 512 * 1024 || debutBinaire(f)) { ignores++; continue; }
      if (fichiers >= max) { ignores++; continue; }
      fichiers++;
      const p = passages(rel, readFileSync(f, 'utf8')); tous.push(...p.liste); masques += p.masques;
    }
  }
  const id = idProjet(r), dir = join(dossierProjets(o.home), id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fiche: FicheProjet = { id, nom: (o.nom ?? basename(r)).slice(0, 80), racine: r, at: (o.now ?? new Date()).toISOString(), fichiers, passages: tous.length, ignores, masques };
  writeFileSync(join(dir, 'passages.jsonl.tmp'), tous.map((x) => JSON.stringify(x)).join('\n') + (tous.length ? '\n' : ''), { mode: 0o600 });
  renameSync(join(dir, 'passages.jsonl.tmp'), join(dir, 'passages.jsonl'));
  writeFileSync(join(dir, 'projet.json'), JSON.stringify(fiche, null, 1), { mode: 0o600 });
  writeFileSync(join(dossierProjets(o.home), 'actif.json'), JSON.stringify({ id }), { mode: 0o600 });
  cache.delete(id);
  return fiche;
}

const cache = new Map<string, { at: string; idx: TextIndex; liste: Passage[] }>();
function charger(home: string | undefined, fiche: FicheProjet): { idx: TextIndex; liste: Passage[] } {
  const c = cache.get(fiche.id); if (c && c.at === fiche.at) return c;
  const liste = readFileSync(join(dossierProjets(home), fiche.id, 'passages.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Passage);
  const idx = new TextIndex(); liste.forEach((p, i) => idx.add(i, `${p.f} ${p.titre ?? ''} ${p.t}`));
  const v = { at: fiche.at, idx, liste }; cache.set(fiche.id, v); return v;
}

const VIDES = new Set('le la les un une des de du d l et ou est sont a au aux en dans sur pour par avec sans ce cette ces que qui quoi quel quelle quels quelles comment pourquoi combien ou quand est-ce il elle on je tu nous vous mon ma mes ton ta tes son sa ses projet fichier dis moi me explique trouve cherche faut fait faire peux peut'.split(' '));
const plier = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Répond à une question à partir du projet actif, sans IA : les passages qui en parlent le plus, la phrase (ou la
 * ligne) la plus parlante de chacun, et leur source. Rend `trouve: false` (et le dit) quand rien ne correspond.
 */
export function repondreProjet(question: string, o: { home?: string; max?: number } = {}): ReponseProjet {
  const fiche = projetActif(o.home);
  if (!fiche) return { trouve: false, texte: 'Aucun projet actif : choisis d\'abord le dossier du projet (« projet actif <dossier> »).', sources: [] };
  const mots = queryWords(question).filter((w) => !VIDES.has(w));
  if (!mots.length) return { trouve: false, texte: 'Pose une question avec au moins un mot précis (un nom, une fonction, un sujet).', sources: [], projet: fiche.nom };
  const { idx, liste } = charger(o.home, fiche);
  const hits = idx.search(mots.join(' '), () => true, 20);
  // Un passage doit contenir au moins la moitié des mots cherchés (sinon c'est du bruit).
  const couvre = (p: Passage) => { const t = plier(`${p.f} ${p.titre ?? ''} ${p.t}`); return mots.filter((w) => t.includes(w)).length; };
  const bons = hits.map((h) => ({ p: liste[h.id], score: h.score, n: couvre(liste[h.id]) })).filter((x) => x.n >= Math.ceil(mots.length / 2)).sort((a, b) => b.n - a.n || b.score - a.score).slice(0, o.max ?? 3);
  if (!bons.length) return { trouve: false, texte: `Je n'ai rien trouvé dans le projet « ${fiche.nom} » sur « ${question.trim().slice(0, 80)} ».`, sources: [], projet: fiche.nom };
  const sources: Source[] = bons.map(({ p, score }) => {
    // La phrase (ou la ligne) qui contient le plus de mots cherchés.
    const morceaux = p.t.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 2);
    const meilleur = morceaux.map((m) => ({ m, n: mots.filter((w) => plier(m).includes(w)).length })).sort((a, b) => b.n - a.n)[0]?.m ?? p.t;
    return { fichier: p.f, lignes: p.l === p.l2 ? `${p.l}` : `${p.l}-${p.l2}`, extrait: meilleur.slice(0, 400), score: Math.round(score * 100) / 100 };
  });
  const texte = [`D'après le projet « ${fiche.nom} » :`, ...sources.map((s) => `- « ${s.extrait} » (${s.fichier}, ligne${s.lignes.includes('-') ? 's' : ''} ${s.lignes})`)].join('\n');
  return { trouve: true, texte, sources, projet: fiche.nom };
}
