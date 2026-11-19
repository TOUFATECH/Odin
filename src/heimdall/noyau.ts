// Le NOYAU d'Odin : les fichiers de ses garde-fous. Odin ne peut pas les modifier seul (COMP-09) ; s'ils changent hors
// de la version de référence, il le dit (REP-08). La liste est fermée et écrite ICI, dans le code (jamais dans un
// réglage) ; ce fichier en fait lui-même partie.
//
// Délimité au plus juste (note « Réécrire son code », § 2.2 B) :
//   - src/heimdall/**        policy.ts (chaque décision, le verrou « grave », toolPath), injection.ts et redact.ts
//                            (contenus extérieurs, secrets), executer.ts (le seul chemin vers l'exécution d'un outil),
//                            approbations.ts (les réponses aux validations), noyau.ts et noyau-empreintes.json ;
//   - src/mimir/decisions.ts, src/mimir/questions.ts : la table « argent → grave » et la question posée au juge ;
//   - src/tools/self.ts      la porte des réécritures (réglage, sauvegardes, retour arrière) ;
//   - src/tools/reglages.ts  qui peut changer l'autonomie et le réglage du code, et à quel prix ;
//   - src/vault.ts           le coffre.
// Tout le reste (applis, interface, Brain, Soul, la boucle de l'agent hors executer.ts) suit le réglage code.validation.
// Les DONNÉES du noyau (configuration, journal d'audit, coffre) sont protégées en écriture par toolPath (policy.ts).
// Les commandes système (shell, python) ne sont pas couvertes ici : c'est l'intégrité (ci-dessous) qui les rattrape.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Le dossier de l'application (là où se trouve ce code). */
export const RACINE_APPLI = (() => { const r = fileURLToPath(new URL('../../', import.meta.url)); try { return realpathSync(r); } catch { return r; } })();

/** Les dossiers (tout leur contenu) et les fichiers du noyau, relatifs à la racine, en « / ». */
export const NOYAU_DOSSIERS = ['src/heimdall/'] as const;
// L'épingle du modèle de départ de Soul (version et SHA-256 de son manifeste) : sans elle protégée, quiconque modifie
// modeles/soul-depart/ ferait installer ses poids. ABSENTE tant qu'aucun modèle n'est exporté : absente dans la référence
// et sur le disque = pas d'écart ; apparue, modifiée ou retirée hors référence = écart.
export const NOYAU_FICHIERS = ['src/vault.ts', 'src/tools/self.ts', 'src/tools/reglages.ts', 'src/mimir/decisions.ts', 'src/mimir/questions.ts', 'src/brain/nous/modele-depart-epingle.json'] as const;

/**
 * Le CODE SENSIBLE (relecture du lot S, constat 2) : ce qui fait tenir les validations sans être dans le noyau —
 * l'approbateur et « qui est le propriétaire » (passerelle), les drapeaux donnés à Heimdall (boucle de l'agent), le
 * branchement de l'intégrité (runtime), le risque et le « grave » déclarés par chaque outil, la garde des membres de
 * l'interface. Toujours validé, MÊME avec « ne plus me demander » (sans être dans l'intégrité, qui reste au noyau).
 */
export const SENSIBLE_DOSSIERS = ['src/tools/'] as const;
export const SENSIBLE_FICHIERS = ['src/core/agent.ts', 'src/bifrost/gateway.ts', 'src/runtime.ts', 'src/config.ts', 'src/valhalla/service.ts', 'src/web/server.ts', 'src/valhalla/sso/garde.ts', 'src/web/valhalla-api.ts', 'package.json', 'tools/noyau-empreintes.ts',
  // qui est le propriétaire, un membre, un invité ; l'appairage ; les rôles rangés ; le juge ; les autres portes d'entrée
  'src/muninn/store.ts', 'src/web/access.ts', 'src/web/pairing.ts', 'src/valhalla/keryx/auth.ts', 'src/valhalla/keryx/canal.ts', 'src/web/maison-api.ts', 'src/valhalla/modules/midgard.ts', 'src/mimir/client.ts', 'src/valhalla/mcp.ts', 'src/types.ts', 'src/cli/main.ts',
  // la fenêtre Profil : qui est appairé, sur quel canal (userFor, pairingStatus)
  'src/muninn/personnes.ts',
  // Vénus : qui peut déclarer un dossier de médias et lire les médias (estMembre)
  'src/valhalla/venus/routes.ts'] as const;
/** Une commande système qui touche au code d'Odin (son dossier, son noyau) ou à sa référence. Pur sur le texte. */
export function commandeSurLeCode(texte: string, dossiers: string[], racine = RACINE_APPLI, contenants: string[] = []): 'reference' | 'code' | undefined {
  const t = texte.replace(/\\/g, '/').toLowerCase();
  if (/noyau[-:_]?empreintes|noyau-reference|reference-connue|ecrirereference|figerreference|noterreferenceconnue/.test(t)) return 'reference';
  const r = racine.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
  // Ce qui se reconnaît sans faux positifs gênants : la racine écrite, un chemin vers src/<dossier du code> (aussi par
  // « ../ »), le mot « heimdall » (le dossier des garde-fous), un dossier de travail DANS la racine ou qui la CONTIENT.
  if (t.includes(r) || /(^|[\s"'`(=/])(\.{1,2}\/)*src\/(heimdall|tools|core|bifrost|valhalla|brain|web|mimir|muninn|runtime|config)\b/.test(t) || /heimdall/.test(t)) return 'code';
  // Un dossier de travail DANS la racine ; pour un agent de code qui écrit partout sous son dossier (Codex), aussi un dossier
  // qui la CONTIENT (pas pour une simple commande lancée depuis le dossier personnel : faux positif à chaque commande).
  for (const d of dossiers) { const x = d.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, ''); if (x === r || x.startsWith(`${r}/`) || (contenants.includes(d) && r.startsWith(`${x}/`))) return 'code'; }
  return undefined;
}

/** Les deux décisions sur un écart du noyau : jamais après un contenu extérieur, jamais sans toi. */
export const GRAVE_ACCEPTER = 'accepter la version actuelle des garde-fous d\'Odin comme référence';
export const GRAVE_RESTAURER = 'restaurer les garde-fous d\'Odin depuis la version de référence';

export const GRAVE_SENSIBLE = 'modifier du code sensible d\'Odin (ce qui fait tenir ses validations)';
/** Un chemin RELATIF (déjà résolu) est-il du code sensible ? Pur. */
export function estSensible(rel: string): boolean {
  const r = norme(rel);
  return SENSIBLE_DOSSIERS.some((d) => r.startsWith(norme(d))) || SENSIBLE_FICHIERS.some((f) => r === norme(f));
}

/** Le début de la raison « grave » d'une écriture sur le noyau (reconnue par Heimdall). */
export const GRAVE_NOYAU = 'modifier un garde-fou d\'Odin';

const insensible = process.platform === 'win32' || process.platform === 'darwin';
const WINDOWS = process.platform === 'win32';
const CONTROLE = /[\u0000-\u001F\u007F]/;

/**
 * Le nom que Windows lit dans un chemin écrit (pur ; ailleurs qu'en `win32`, rendu tel quel) : dans chaque segment, ce
 * qui suit le premier « : » est un flux NTFS (« vault.ts::$DATA », « heimdall:$I30:$INDEX_ALLOCATION ») et désigne le
 * fichier ou le dossier lui-même ; un point ou une espace en fin de segment est retiré par Windows. La lettre du lecteur
 * est gardée ; « . », « .. » et un segment qui ne serait plus rien sont laissés tels quels.
 */
export function nomVuParWindows(chemin: string, plateforme: string = process.platform): string {
  if (plateforme !== 'win32') return chemin;
  const lecteur = /^(?:[\\/]{2}[?.][\\/])?[A-Za-z]:/.exec(chemin)?.[0] ?? '';
  return lecteur + chemin.slice(lecteur.length).split(/([\\/]+)/).map((s, i) => {
    if (i % 2 || /^\.{1,2}$/.test(s)) return s;
    const n = s.split(':')[0].replace(/[. ]+$/, '');
    return n || s;
  }).join('');
}

const norme = (rel: string): string => { const r = nomVuParWindows(rel).split(sep).join('/').replace(/\\/g, '/').replace(/^\.\//, ''); return insensible ? r.toLowerCase() : r; };

/** Un chemin RELATIF (déjà résolu) est-il dans le noyau ? Pur. Sous Windows, un caractère de contrôle (jamais le vrai nom d'un fichier) : traité comme le noyau. */
export function estNoyau(rel: string): boolean {
  const r = norme(rel);
  if (WINDOWS && CONTROLE.test(r) && !r.startsWith('../') && !isAbsolute(r)) return true;
  if (!r || r.startsWith('../') || r === '..' || isAbsolute(r)) return false;
  return NOYAU_DOSSIERS.some((d) => r.startsWith(norme(d)) || r === norme(d).replace(/\/$/, '')) || NOYAU_FICHIERS.some((f) => r === norme(f));
}

/**
 * Le chemin réel, relatif à la racine, d'un chemin quelconque : `..`, liens symboliques (sur le fichier OU un dossier
 * parent), chemin absolu, majuscules sous Windows. Le fichier peut ne pas exister encore (on résout le plus proche
 * parent existant). Rend undefined s'il est hors de la racine. Le nom écrit est gardé tel quel (un flux NTFS ou un nom
 * court y reste visible, pour qui veut le refuser) : pour le fichier que Windows touchera vraiment, cheminVraiRelatif.
 */
export function cheminReelRelatif(chemin: string, racine = RACINE_APPLI): string | undefined { return cheminRelatif(chemin, racine, false); }

/**
 * Comme cheminReelRelatif, mais sous Windows le VRAI nom du fichier que l'écriture touchera : sans flux NTFS ni point ou
 * espace final (nomVuParWindows), et le nom que rend le système (realpathSync.native : un nom court 8.3 « DECISI~1.TS »
 * devient « decisions.ts »). C'est ce chemin que la règle de réécriture juge. Ailleurs qu'en Windows : cheminReelRelatif.
 */
export function cheminVraiRelatif(chemin: string, racine = RACINE_APPLI): string | undefined { return cheminRelatif(chemin, racine, WINDOWS); }

// Les dossiers qui mènent au noyau et au code sensible (la racine comprise), relatifs, en « / » : les repères d'identité.
const REPERES = [...new Set(['', ...[...NOYAU_DOSSIERS, ...NOYAU_FICHIERS, ...SENSIBLE_DOSSIERS, ...SENSIBLE_FICHIERS].flatMap((f) => {
  const s = f.replace(/\/$/, '').split('/'), n = f.endsWith('/') ? s.length : s.length - 1;
  return Array.from({ length: n }, (_, i) => s.slice(0, i + 1).join('/'));
})])];

/**
 * Sous Windows, un chemin dont le TEXTE sort de la racine peut quand même y mener : un partage (« \\localhost\C$\… »,
 * « \\?\UNC\… », « \\?\GLOBALROOT\Device\Mup\… »), un autre lecteur sur le même disque. On compare l'identité (volume et
 * numéro de fichier) de chacun de ses dossiers existants avec celle de la racine et des dossiers qui mènent au noyau ou au
 * code sensible ; trouvé : le chemin est refait depuis la racine (puis jugé comme tout chemin local). Sinon undefined.
 */
function parIdentite(abs: string, racine: string): string | undefined {
  const id = (p: string): string | undefined => { try { const s = statSync(p, { bigint: true }); return s.ino ? `${s.dev}:${s.ino}` : undefined; } catch { return undefined; } };
  const reperes = new Map<string, string>();
  for (const d of REPERES) { const i = id(join(racine, d)); if (i && !reperes.has(i)) reperes.set(i, d); }
  let p = abs, reste = '';
  for (;;) {
    const i = id(p);
    if (i && reperes.has(i)) return cheminRelatif(join(racine, reperes.get(i)!, reste), racine, true, false);
    const parent = dirname(p); if (parent === p) return undefined;
    reste = reste ? join(basename(p), reste) : basename(p); p = parent;
  }
}

function cheminRelatif(chemin: string, racine: string, vraiNom: boolean, identite = vraiNom): string | undefined {
  const abs = vraiNom ? nomVuParWindows(resolve(racine, chemin), 'win32') : resolve(racine, chemin);
  let existant = abs, reste = '';
  while (!existsSync(existant)) { const p = dirname(existant); if (p === existant) break; reste = reste ? join(basename(existant), reste) : basename(existant); existant = p; }
  let reel = existant; try { reel = realpathSync(existant); } catch { /* garde le chemin tel quel */ }
  let rac = racine; try { rac = realpathSync(racine); } catch { /* idem */ }
  if (vraiNom) { try { const n = realpathSync.native(existant), nr = realpathSync.native(racine); reel = n; rac = nr; } catch { /* garde les précédents */ } }
  const final = reste ? join(reel, reste) : reel;
  const rel = relative(rac, final);
  const relI = insensible ? relative(rac.toLowerCase(), final.toLowerCase()) : rel;
  if (!relI) return undefined;
  if (relI.startsWith('..') || isAbsolute(relI)) return identite ? parIdentite(abs, racine) : undefined;
  return rel;
}

/** La raison « grave » si `chemin` (relatif à la racine, ou absolu) touche le noyau ; sinon undefined. */
export function graveNoyau(chemin: string, racine = RACINE_APPLI): string | undefined {
  const rel = cheminVraiRelatif(chemin, racine);
  return rel !== undefined && estNoyau(rel) ? `${GRAVE_NOYAU} : ${norme(rel)}` : undefined;
}

// ----------------------------------------------------------------------------------------------------------------
// La version de référence : une empreinte SHA-256 de chaque fichier du noyau, rangée dans le dépôt
// (src/heimdall/noyau-empreintes.json) par le script de construction `npm run noyau:empreintes` — jamais par Odin.
export const FICHIER_EMPREINTES = 'src/heimdall/noyau-empreintes.json';

/** Les fichiers du noyau présents (relatifs, en « / », triés). Le fichier des empreintes lui-même est exclu. */
export function fichiersNoyau(racine = RACINE_APPLI): string[] {
  const out: string[] = [];
  const parcourir = (relDir: string) => {
    let noms: string[] = []; try { noms = readdirSync(join(racine, relDir)); } catch { return; }
    for (const n of noms) {
      const rel = `${relDir}${n}`;
      try { if (statSync(join(racine, rel)).isDirectory()) parcourir(`${rel}/`); else out.push(rel); } catch { /* disparu */ }
    }
  };
  for (const d of NOYAU_DOSSIERS) parcourir(d);
  for (const f of NOYAU_FICHIERS) if (existsSync(join(racine, f))) out.push(f);
  return out.filter((f) => f !== FICHIER_EMPREINTES).sort();
}

/** Empreinte d'un fichier (fins de ligne ramenées à « \n » : un clone Windows ne crée pas d'écart). */
export function empreinteFichier(chemin: string): string {
  return createHash('sha256').update(readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

/** Les empreintes actuelles du noyau. */
export function calculerEmpreintes(racine = RACINE_APPLI): Record<string, string> {
  const o: Record<string, string> = {};
  for (const f of fichiersNoyau(racine)) o[f] = empreinteFichier(join(racine, f));
  return o;
}

export interface EcartNoyau { fichier: string; etat: 'modifié' | 'ajouté' | 'absent' }
export interface VerifNoyau { reference: boolean; ecarts: EcartNoyau[] }

// La référence LUE AU DÉMARRAGE est gardée en mémoire (relecture du lot S, constat 3) : réécrire le fichier de
// référence en service (par une commande) ne la change pas — c'est un écart. Seules une réécriture validée, une
// acceptation ou une mise à jour d'Odin la refont (ecrireReference).
let figee: { racine: string; fichiers: Record<string, string>; empreinte: string } | undefined;
const empreinteTexte = (t: string): string => createHash('sha256').update(t.replace(/\r\n/g, '\n')).digest('hex');
/** Fige la référence lue maintenant (au démarrage d'Odin). */
export function figerReference(racine = RACINE_APPLI): void {
  try { const t = readFileSync(join(racine, FICHIER_EMPREINTES), 'utf8'); figee = { racine, fichiers: (JSON.parse(t) as { fichiers: Record<string, string> }).fichiers, empreinte: empreinteTexte(t) }; } catch { figee = undefined; }
}
/** L'empreinte du fichier de référence actuel (pour la « dernière connue » rangée hors du dossier du code). */
export function empreinteReference(racine = RACINE_APPLI): string | undefined { try { return empreinteTexte(readFileSync(join(racine, FICHIER_EMPREINTES), 'utf8')); } catch { return undefined; } }

/** La référence a-t-elle été refaite hors d'une mise à jour, d'une réécriture validée ou d'une acceptation ? */
let refChangee = false;
export function referenceChangee(v?: boolean): boolean { if (v !== undefined) refChangee = v; return refChangee; }
/** Note la référence actuelle comme « connue » (hors du dossier du code) : après une acceptation, une réécriture validée, une mise à jour. */
export function noterReferenceConnue(home: string, racine = RACINE_APPLI): void {
  const e = empreinteReference(racine); if (!e) return;
  try { writeFileSync(join(home, 'noyau-reference-connue.txt'), e, { mode: 0o600 }); refChangee = false; } catch { /* rien */ }
}

/** Compare le noyau à la version de référence. Ne lève jamais (une alerte ne bloque jamais le démarrage). */
export function verifierNoyau(racine = RACINE_APPLI): VerifNoyau {
  let ref: Record<string, string>;
  const ecarts: EcartNoyau[] = [];
  if (figee && figee.racine === racine) {
    ref = figee.fichiers;
    if (empreinteReference(racine) !== figee.empreinte) ecarts.push({ fichier: FICHIER_EMPREINTES, etat: 'modifié' });
  } else {
    try { ref = (JSON.parse(readFileSync(join(racine, FICHIER_EMPREINTES), 'utf8')) as { fichiers: Record<string, string> }).fichiers; } catch { return { reference: false, ecarts: [] }; }
  }
  let actuel: Record<string, string> = {};
  try { actuel = calculerEmpreintes(racine); } catch { /* rien */ }
  for (const [f, h] of Object.entries(ref)) { if (!(f in actuel)) ecarts.push({ fichier: f, etat: 'absent' }); else if (actuel[f] !== h) ecarts.push({ fichier: f, etat: 'modifié' }); }
  for (const f of Object.keys(actuel)) if (!(f in ref)) ecarts.push({ fichier: f, etat: 'ajouté' });
  if (refChangee && racine === RACINE_APPLI && !ecarts.some((e) => e.fichier === FICHIER_EMPREINTES)) ecarts.push({ fichier: FICHIER_EMPREINTES, etat: 'modifié' });
  // L'état montré (alerte, Réglages) suit chaque vérification, pas seulement celle du démarrage (constat 10).
  if (racine === RACINE_APPLI && dernier) { const avant = JSON.stringify(dernier.ecarts); dernier = { ...dernier, reference: true, ecarts, quand: new Date().toISOString(), ...(JSON.stringify(ecarts) !== avant ? { signale: false } : {}) }; }
  return { reference: true, ecarts };
}

/** Écrit la référence (chaîne de construction, self_update, ou une réécriture du noyau que TU as validée). */
export function ecrireReference(racine = RACINE_APPLI): number {
  const fichiers = calculerEmpreintes(racine);
  writeFileSync(join(racine, FICHIER_EMPREINTES), JSON.stringify({ note: 'Version de référence du noyau d\'Odin : écrite à la publication, par self_update, ou par une réécriture du noyau validée par le propriétaire.', fichiers }, null, 2) + '\n');
  if (figee && figee.racine === racine) figerReference(racine);
  return Object.keys(fichiers).length;
}

// L'intégrité AVANT chaque action engageante : recalculée à chaque fois (une douzaine de petits fichiers, ~1 ms) —
// une date de fichier ne suffit pas (même taille, même milliseconde).
export function integriteNoyau(racine = RACINE_APPLI): VerifNoyau { return verifierNoyau(racine); }

// L'état vérifié au démarrage (pour l'alerte au propriétaire et la page Réglages).
let dernier: (VerifNoyau & { quand: string; signale?: boolean }) | undefined;
export function noterVerifNoyau(v: VerifNoyau): void { dernier = { ...v, quand: new Date().toISOString() }; }
export function etatNoyau(): (VerifNoyau & { quand: string; signale?: boolean }) | undefined { return dernier; }
/** L'alerte n'est donnée qu'UNE fois par démarrage : rend le texte la première fois, undefined ensuite. */
export function alerteNoyauUneFois(): string | undefined {
  if (!dernier || !dernier.ecarts.length || dernier.signale) return undefined;
  dernier.signale = true;
  return `🛡 Garde-fou modifié hors de la version de référence : ${dernier.ecarts.map((e) => `${e.fichier} (${e.etat})`).join(', ')}. Toutes mes actions engageantes sont bloquées jusqu'à ta décision : « restaurer le noyau » (version de référence) ou « accepter cette version ».`;
}

// ----------------------------------------------------------------------------------------------------------------
// La mise à jour OFFICIELLE (réglage « Mises à jour d'Odin ») : une nouvelle version des garde-fous qui vient de la vraie
// mise à jour — le dépôt officiel écrit ICI, empreintes vérifiées — est acceptée par le seul clic « Mettre à jour » du
// propriétaire, sans second clic ; seule, sans son clic, jamais (il faudrait SA signature, pas encore construite) ; en
// mode « ne pas vérifier », jamais. Tout autre changement des
// garde-fous (à la main, par un programme, par Odin qui se recode, une copie qui n'est pas un clone propre, un commit qui
// n'est pas publié) garde l'alerte jusqu'au clic du propriétaire. L'adresse officielle est dans le code, jamais lue dans
// un fichier modifiable sans lui être comparée.
export const DEPOT_OFFICIEL = 'https://github.com/TOUFATECH/Odin.git';
export const BRANCHE_OFFICIELLE = 'main';

/** La même adresse que l'officielle, à « .git » final près (rien d'autre n'est toléré). Pur. */
export function memeDepot(adresse: string, officiel = DEPOT_OFFICIEL): boolean {
  const s = (u: string) => u.trim().replace(/\.git$/, '');
  return adresse.trim() !== '' && s(adresse) === s(officiel);
}

/** Les chemins du noyau tels que git les attend (relatifs, en « / »). */
const CHEMINS_NOYAU = (): string[] => [...NOYAU_DOSSIERS, ...NOYAU_FICHIERS];
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const sha = (s: unknown): string | undefined => typeof s === 'string' && SHA.test(s) ? s : undefined;

/**
 * L'environnement de git pour les garde-fous : aucune variable GIT_* héritée (dépôt, objets, remplacements, réglages,
 * certificats passés par l'environnement), ni certificats imposés à OpenSSL ; jamais d'objet de remplacement, jamais
 * d'objet récupéré en douce, jamais de question.
 */
function envGit(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(GIT_|SSL_CERT_|CURL_CA_BUNDLE$)/i.test(k)) e[k] = v;
  return { ...e, GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}

interface OptGit { delaiMs?: number; env?: Record<string, string>; crochets?: string }
/** git en lecture, sans bloquer Odin, avec un délai ; sans objet de remplacement ni fsmonitor (ni crochet : `crochets`). Ne lève jamais. */
function gitBrut(racine: string, args: string[], o: OptGit = {}): Promise<{ status: number; stdout: Buffer }> {
  const avant = ['--no-replace-objects', '-c', 'core.fsmonitor=false', ...(o.crochets ? ['-c', `core.hooksPath=${o.crochets}`] : []), '-C', racine];
  return new Promise((res) => {
    execFile('git', [...avant, ...args], { encoding: 'buffer', timeout: o.delaiMs ?? 15_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: envGit(o.env) }, (e, stdout) => res({ status: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? '')) }));
  });
}
async function gitNoyau(racine: string, args: string[], o: OptGit = {}): Promise<{ status: number; stdout: string }> {
  const r = await gitBrut(racine, args, o); return { status: r.status, stdout: r.stdout.toString('utf8') };
}

/** Un objet git du dépôt, SEULEMENT si son contenu redonne son empreinte (calculée ici, pas par git) : un objet réécrit ne passe pas. */
async function objetVerifie(racine: string, type: 'commit' | 'tree' | 'blob', id: string): Promise<Buffer | undefined> {
  const r = await gitBrut(racine, ['cat-file', type, id]);
  if (r.status !== 0) return undefined;
  const h = createHash(id.length === 64 ? 'sha256' : 'sha1').update(`${type} ${r.stdout.length}\0`).update(r.stdout).digest('hex');
  return h === id ? r.stdout : undefined;
}

/** Les entrées d'un arbre git brut (mode, nom, empreinte de `n` octets). */
function entreesArbre(b: Buffer, n: number): Array<{ mode: string; nom: string; id: string }> {
  const out: Array<{ mode: string; nom: string; id: string }> = [];
  for (let i = 0; i < b.length;) {
    const sp = b.indexOf(0x20, i), nul = sp < 0 ? -1 : b.indexOf(0, sp);
    if (sp < 0 || nul < 0 || nul + 1 + n > b.length) throw new Error('un arbre du commit est illisible');
    out.push({ mode: b.toString('latin1', i, sp), nom: b.toString('utf8', sp + 1, nul), id: b.toString('hex', nul + 1, nul + 1 + n) });
    i = nul + 1 + n;
  }
  return out;
}

/** Ce qu'un commit dit des garde-fous : l'empreinte de chaque fichier du noyau, et le texte de sa référence. */
interface NoyauCommit { fichiers: Record<string, string>; json?: string }
const memesEmpreintes = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return JSON.stringify(ka) === JSON.stringify(kb) && ka.every((k) => a[k] === b[k]);
};

/**
 * Les fichiers du noyau du commit `commit`, lus objet par objet et VÉRIFIÉS ici (commit → arbre → fichier : chaque
 * contenu doit redonner son empreinte). Un objet de remplacement, une greffe ou un objet réécrit dans le dépôt ne
 * passent donc pas : seul compte ce que l'empreinte du commit désigne. Un lien ou un sous-module dans le noyau : refusé.
 * Rend la raison d'un refus en texte.
 */
async function noyauDuCommit(racine: string, commit: string): Promise<NoyauCommit | string> {
  const n = commit.length / 2;
  const c = await objetVerifie(racine, 'commit', commit);
  if (!c) return 'commit illisible ou altéré dans le dépôt';
  const racineArbre = /^tree ([0-9a-f]+)\n/.exec(c.toString('utf8'))?.[1];
  if (!racineArbre || racineArbre.length !== commit.length) return 'commit illisible';
  const arbre = async (id: string) => { const b = await objetVerifie(racine, 'tree', id); if (!b) throw new Error('un arbre du commit est illisible ou altéré dans le dépôt'); return entreesArbre(b, n); };
  const texte = async (chemin: string, id: string) => { const b = await objetVerifie(racine, 'blob', id); if (!b) throw new Error(`${chemin} illisible ou altéré dans le dépôt`); return b.toString('utf8'); };
  const fichier = (mode: string) => mode === '100644' || mode === '100755';
  const trouver = async (chemin: string) => {
    const s = chemin.replace(/\/$/, '').split('/'); let id = racineArbre;
    for (let i = 0; i < s.length; i++) {
      const e = (await arbre(id)).find((x) => x.nom === s[i]);
      if (!e || i === s.length - 1) return e;
      if (e.mode !== '40000') return undefined;
      id = e.id;
    }
    return undefined;
  };
  const out: NoyauCommit = { fichiers: {} };
  const parcourir = async (id: string, prefixe: string): Promise<void> => {
    for (const e of await arbre(id)) {
      const chemin = `${prefixe}${e.nom}`;
      if (e.mode === '40000') await parcourir(e.id, `${chemin}/`);
      else if (!fichier(e.mode)) throw new Error(`${chemin} : un lien ou un sous-module dans le noyau`);
      else if (chemin === FICHIER_EMPREINTES) out.json = await texte(chemin, e.id);
      else out.fichiers[chemin] = empreinteTexte(await texte(chemin, e.id));
    }
  };
  try {
    for (const d of NOYAU_DOSSIERS) { const e = await trouver(d); if (!e) continue; if (e.mode !== '40000') throw new Error(`${d} n'est pas un dossier dans le commit`); await parcourir(e.id, d); }
    for (const f of NOYAU_FICHIERS) { const e = await trouver(f); if (!e) continue; if (!fichier(e.mode)) throw new Error(`${f} : un lien ou un sous-module dans le noyau`); out.fichiers[f] = empreinteTexte(await texte(f, e.id)); }
  } catch (err) { return (err as Error).message; }
  return out;
}

/** Le noyau du commit installé, cohérent avec sa propre référence (sinon : la raison). */
async function attenduDuCommit(racine: string, commit: string): Promise<Required<NoyauCommit> | string> {
  const a = await noyauDuCommit(racine, commit);
  if (typeof a === 'string') return a;
  if (a.json === undefined) return 'le commit installé n\'a pas de référence des garde-fous';
  let ref: Record<string, string>;
  try { ref = (JSON.parse(a.json) as { fichiers: Record<string, string> }).fichiers ?? {}; } catch { return 'référence des garde-fous illisible dans le commit installé'; }
  if (!memesEmpreintes(ref, a.fichiers)) return 'la référence du commit installé ne correspond pas à ses fichiers du noyau';
  return { fichiers: a.fichiers, json: a.json };
}

/**
 * Le disque, MAINTENANT, est-il exactement le noyau attendu ? (Synchrone : rien ne s'intercale dans Odin entre cette
 * vérification et ce qui la suit.) `texteRef` : la référence du disque doit aussi avoir le même texte que celle du commit.
 * Un fichier « mis de côté » pour git (assume-unchanged) n'échappe pas à la comparaison.
 */
function conformeAuDisque(racine: string, a: Required<NoyauCommit>, texteRef = true): string | undefined {
  let disque: string; try { disque = readFileSync(join(racine, FICHIER_EMPREINTES), 'utf8'); } catch { return 'référence des garde-fous absente du disque'; }
  if (texteRef && empreinteTexte(disque) !== empreinteTexte(a.json)) return 'la référence des garde-fous du disque n\'est pas celle du commit installé';
  let ref: Record<string, string>; try { ref = (JSON.parse(disque) as { fichiers: Record<string, string> }).fichiers ?? {}; } catch { return 'référence des garde-fous illisible sur le disque'; }
  if (!memesEmpreintes(ref, a.fichiers)) return 'la référence des garde-fous du disque ne correspond pas au commit installé';
  let actuel: Record<string, string>; try { actuel = calculerEmpreintes(racine); } catch { return 'garde-fous illisibles sur le disque'; }
  const ka = Object.keys(actuel).sort(), kf = Object.keys(a.fichiers).sort();
  if (JSON.stringify(ka) !== JSON.stringify(kf)) return 'un fichier du noyau est ajouté ou retiré par rapport au commit installé';
  for (const f of kf) if (actuel[f] !== a.fichiers[f]) return `${f} ne correspond pas aux empreintes du commit installé`;
  return undefined;
}

export interface VersionOfficielle { ok: boolean; raison: string; commit?: string }
type Verifiee = { ok: false; raison: string } | { ok: true; raison: string; commit: string; attendu: Required<NoyauCommit> };

/**
 * Vrai SEULEMENT si : (a) `racine` est la racine d'un dépôt git, sans greffe ni objet de remplacement ; (b) la branche est
 * la branche officielle, elle suit origin/<branche officielle>, et l'adresse effective d'origin (réécritures de git
 * comprises) est EXACTEMENT l'adresse officielle (avec ou sans « .git ») ; (d) aucun fichier du noyau n'est modifié par
 * rapport au commit installé (git status, non suivis et ignorés compris) ; (e) les fichiers du noyau du disque sont ceux
 * du commit installé — lus objet par objet et vérifiés ici, pas crus sur parole de git — et sa référence d'empreintes leur
 * correspond ; (c) après une récupération fraîche DEPUIS l'adresse officielle, dans un dépôt NEUF hors d'Odin (ni la
 * configuration, ni les crochets, ni les objets du dépôt d'Odin ; délai limité), le commit installé est sur la branche
 * officielle (égal à son sommet ou son ancêtre). Les vérifications locales passent avant le réseau ; (d) et (e) sont
 * refaites après. Sans réseau : faux. `officiel` n'est changé que par les essais (un faux dépôt officiel local).
 */
export async function versionOfficielle(racine = RACINE_APPLI, o: { officiel?: string; delaiMs?: number } = {}): Promise<VersionOfficielle> {
  const v = await verifierOfficielle(racine, o);
  return v.ok ? { ok: true, raison: v.raison, commit: v.commit } : { ok: false, raison: v.raison };
}

async function verifierOfficielle(racine: string, o: { officiel?: string; delaiMs?: number; depuis?: string }): Promise<Verifiee> {
  const officiel = o.officiel ?? DEPOT_OFFICIEL, non = (raison: string): Verifiee => ({ ok: false, raison });
  // (a) un dépôt git, dont la racine est celle d'Odin (pas un dossier pris dans un dépôt plus grand)
  if (!existsSync(join(racine, '.git'))) return non('pas un dépôt git (copie sans git)');
  const top = await gitNoyau(racine, ['rev-parse', '--show-toplevel']);
  const vrai = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
  const memeChemin = (a: string, b: string) => insensible ? vrai(a).toLowerCase() === vrai(b).toLowerCase() : vrai(a) === vrai(b);
  if (top.status !== 0 || !memeChemin(top.stdout.trim(), racine)) return non('pas un dépôt git à la racine d\'Odin');
  // Une greffe ou un objet de remplacement réécrit l'histoire que git montre : refusé d'emblée.
  const greffes = (await gitNoyau(racine, ['rev-parse', '--git-path', 'info/grafts'])).stdout.trim();
  if (!greffes || existsSync(resolve(racine, greffes))) return non('une greffe (info/grafts) change l\'histoire du dépôt');
  if ((await gitNoyau(racine, ['for-each-ref', '--count=1', '--format=%(refname)', 'refs/replace/'])).stdout.trim()) return non('un objet de remplacement (git replace) est posé dans le dépôt');
  const head = sha((await gitNoyau(racine, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])).stdout.trim());
  if (!head) return non('aucun commit installé');
  // (b) la branche suivie et l'adresse officielle
  if ((await gitNoyau(racine, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim() !== BRANCHE_OFFICIELLE) return non(`pas sur la branche ${BRANCHE_OFFICIELLE}`);
  if ((await gitNoyau(racine, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).stdout.trim() !== `origin/${BRANCHE_OFFICIELLE}`) return non(`la branche ne suit pas origin/${BRANCHE_OFFICIELLE}`);
  if (!memeDepot((await gitNoyau(racine, ['ls-remote', '--get-url', 'origin'])).stdout, officiel)) return non('l\'adresse du dépôt suivi n\'est pas l\'adresse officielle');
  // L'adresse officielle elle-même ne doit pas être réécrite (« url.<autre>.insteadOf ») vers un autre dépôt.
  if ((await gitNoyau(racine, ['ls-remote', '--get-url', officiel])).stdout.trim() !== officiel.trim()) return non('l\'adresse officielle est réécrite par la configuration de git');
  // (d) aucun fichier du noyau modifié par rapport au commit installé (git status sur ces chemins, non suivis compris)
  const statut = async (): Promise<string | undefined> => {
    const st = await gitNoyau(racine, ['status', '--porcelain', '--untracked-files=all', '--ignored=matching', '--', ...CHEMINS_NOYAU()]);
    return st.status !== 0 ? 'état du dépôt illisible' : st.stdout.trim() ? 'un fichier du noyau est modifié par rapport au commit installé' : undefined;
  };
  { const r = await statut(); if (r) return non(r); }
  // (e) les fichiers du noyau du disque sont ceux du commit installé (objets vérifiés ici) et de sa référence
  const attendu = await attenduDuCommit(racine, head);
  if (typeof attendu === 'string') return non(attendu);
  { const r = conformeAuDisque(racine, attendu); if (r) return non(r); }
  if (o.depuis !== undefined && o.depuis === head) return non('pas une mise à jour vers une version plus récente');
  // (c) récupération fraîche depuis l'adresse officielle, dans un dépôt NEUF hors d'Odin : configuration globale vide,
  // aucun crochet, aucun modèle ; seulement les commits (pas les fichiers) de la branche officielle.
  const tmp = mkdtempSync(join(tmpdir(), 'odin-officiel-'));
  try {
    const vide = join(tmp, 'vide'), cfg = join(tmp, 'config-vide'), depot = join(tmp, 'depot.git');
    mkdirSync(vide); writeFileSync(cfg, '');
    const g: OptGit = { env: { GIT_CONFIG_GLOBAL: cfg }, crochets: vide.split(sep).join('/') };
    const cl = await gitNoyau(tmp, ['-c', 'http.sslVerify=true', 'clone', '--bare', '--quiet', '--no-local', '--no-tags', '--single-branch', '--branch', BRANCHE_OFFICIELLE, '--filter=tree:0', `--template=${g.crochets}`, '--', officiel, depot], { ...g, delaiMs: o.delaiMs ?? 60_000 });
    if (cl.status !== 0) return non('dépôt officiel injoignable (pas de réseau ?) : on attend');
    const sommet = sha((await gitNoyau(depot, ['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCHE_OFFICIELLE}^{commit}`], g)).stdout.trim());
    if (!sommet) return non('branche officielle introuvable');
    if (head !== sommet && (await gitNoyau(depot, ['merge-base', '--is-ancestor', head, sommet], g)).status !== 0) return non('le commit installé n\'est pas publié sur la branche officielle');
    // L'ancien commit (celui d'avant la mise à jour) : lui aussi sur la branche officielle, et plus ancien.
    if (o.depuis !== undefined && (!sha(o.depuis) || (await gitNoyau(depot, ['merge-base', '--is-ancestor', o.depuis, head], g)).status !== 0)) return non('pas une mise à jour vers une version plus récente');
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* le dossier temporaire partira plus tard */ } }
  // Après le réseau : le même commit installé, et (d) et (e) refaites (rien n'a glissé pendant la récupération).
  if ((await gitNoyau(racine, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])).stdout.trim() !== head) return non('le commit installé a changé pendant la vérification');
  { const r = await statut(); if (r) return non(r); }
  { const r = conformeAuDisque(racine, attendu); if (r) return non(r); }
  return { ok: true, raison: 'mise à jour officielle', commit: head, attendu };
}

/** La trace d'une mise à jour faite par Odin : les deux commits, et si elle a été lancée par le clic du propriétaire. */
export interface TraceMaj { de: string; vers: string; parClic: boolean; quand?: string }

export interface AcceptationMaj { accepte: boolean; raison: string; de?: string; vers?: string; fichiers?: string[] }

/**
 * Au démarrage qui suit une mise à jour : les garde-fous en écart sont-ils ceux de la mise à jour officielle, et le
 * propriétaire a-t-il lui-même lancé cette mise à jour ? Si oui, `accepter` (LA fonction du clic « Accepter cette
 * version ») est appelée, puis le journal le note. Sinon rien ne change : l'alerte reste jusqu'au clic.
 *  - « off » (ou un mode inconnu) : jamais. « notify » et « auto » : seulement si la mise à jour a été lancée par SON
 *    clic (trace `parClic` dont le second commit est le commit installé). Une nouvelle version des garde-fous ne
 *    s'installe seule que si elle porte SA signature (son choix « Signée par ma clé ») ; tant que cette signature
 *    n'existe pas, le mode « auto » n'accepte rien seul : la version attend son clic.
 *  - L'ancien commit (celui de la trace) doit être, sur la branche officielle, un ancêtre du nouveau (jamais un retour à
 *    une version plus ancienne) : il sert à montrer ce qui a changé et le code.
 *  - Le disque est revérifié juste avant l'acceptation, et juste après : si ce qui a été accepté n'est pas exactement le
 *    commit officiel (un fichier écrit pendant l'acceptation), la référence OFFICIELLE est remise sur le disque — l'alerte
 *    revient tout de suite ET au prochain démarrage — et le journal le note.
 */
export async function accepterMiseAJourOfficielle(o: {
  mode: string | undefined; trace?: TraceMaj; racine?: string; officiel?: string; delaiMs?: number;
  ecarts?: () => EcartNoyau[]; accepter: () => unknown; noter: (e: Record<string, unknown>) => void;
}): Promise<AcceptationMaj> {
  const racine = o.racine ?? RACINE_APPLI, mode = o.mode ?? 'notify', non = (raison: string): AcceptationMaj => ({ accepte: false, raison });
  const ecarts = o.ecarts ?? (() => verifierNoyau(racine).ecarts);
  if (mode !== 'auto' && mode !== 'notify') return non('mises à jour coupées : les garde-fous attendent ton clic');
  if (!ecarts().length) return non('aucun écart des garde-fous');
  const t = o.trace && sha(o.trace.de) && sha(o.trace.vers) ? o.trace : undefined;
  if (t?.parClic !== true) return non(mode === 'auto' ? 'sans ta signature, une nouvelle version des garde-fous attend ton clic' : 'mise à jour non lancée par ton clic : les garde-fous attendent ton clic');
  const installe = await commitInstalle(racine);
  if (!installe) return non(existsSync(join(racine, '.git')) ? 'aucun commit installé' : 'pas un dépôt git (copie sans git)');
  // L'ancien commit : celui de la trace, si elle mène bien au commit installé.
  const de = t.vers === installe ? t.de : undefined;
  if (!de) return non('ton clic ne portait pas sur la version installée');
  const v = await verifierOfficielle(racine, { officiel: o.officiel, delaiMs: o.delaiMs, depuis: de });
  if (!v.ok) return non(v.raison);
  const vers = v.commit;
  if (vers !== installe) return non('le commit installé a changé pendant la vérification');
  // Les fichiers du noyau qui changent (lus et vérifiés dans les deux commits ; à défaut, git diff), pour le message.
  const ancien = await noyauDuCommit(racine, de);
  const fichiers = typeof ancien !== 'string'
    ? [...new Set([...Object.keys(ancien.fichiers), ...Object.keys(v.attendu.fichiers)])].filter((f) => ancien.fichiers[f] !== v.attendu.fichiers[f])
      .concat(ancien.json !== undefined && empreinteTexte(ancien.json) === empreinteTexte(v.attendu.json) ? [] : [FICHIER_EMPREINTES]).sort()
    : (await gitNoyau(racine, ['diff', '--name-only', '--no-renames', de, vers, '--', ...CHEMINS_NOYAU()])).stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  // Juste avant : le disque est encore exactement le commit officiel (synchrone, et l'acceptation tout de suite après).
  { const r = conformeAuDisque(racine, v.attendu); if (r) return non(r); }
  await o.accepter();
  // Juste après : la référence écrite et les fichiers sont-ils toujours exactement ceux du commit officiel ?
  const apres = conformeAuDisque(racine, v.attendu, false) ?? (ecarts().length ? 'écart restant après l\'acceptation' : undefined);
  if (apres) {
    // La référence OFFICIELLE remise sur le disque : un fichier écrit pendant l'acceptation redevient un écart, maintenant
    // et au prochain démarrage (la « dernière connue » notée par l'acceptation ne lui correspond plus).
    let remise = false;
    try { writeFileSync(join(racine, FICHIER_EMPREINTES), v.attendu.json); remise = true; } catch { /* l'écart reste signalé en mémoire */ }
    if (figee && figee.racine === racine) figerReference(racine);
    if (racine === RACINE_APPLI) referenceChangee(true);
    verifierNoyau(racine);
    o.noter({ evenement: 'noyau-maj-refusee', raison: apres, de, vers, referenceOfficielleRemise: remise });
    return non(apres);
  }
  o.noter({ evenement: 'noyau-accepte-maj', texte: `garde-fous acceptés : mise à jour officielle, de ${de.slice(0, 12)} à ${vers.slice(0, 12)}`, mode, de, vers, fichiers });
  return { accepte: true, raison: 'mise à jour officielle', de, vers, fichiers };
}

/** Le commit installé (le dernier dont les garde-fous sont acceptés, quand il n'y a aucun écart), ou undefined. */
export async function commitInstalle(racine = RACINE_APPLI): Promise<string | undefined> {
  if (!existsSync(join(racine, '.git'))) return undefined;
  return sha((await gitNoyau(racine, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])).stdout.trim());
}

/** Les fichiers du noyau qui changeraient en passant du commit installé à `cible` (dit AVANT le clic « Mettre à jour »). */
export async function noyauChangeVers(cible: string, racine = RACINE_APPLI): Promise<string[]> {
  if (!/^[\w./@{}^~-]+$/.test(cible) || cible.startsWith('-')) return [];
  const r = await gitNoyau(racine, ['diff', '--name-only', '--no-renames', `HEAD..${cible}`, '--', ...CHEMINS_NOYAU()]);
  return r.status === 0 ? r.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : [];
}

/**
 * « Voir le code » : la différence COMPLÈTE des fichiers du noyau entre l'ancien et le nouveau commit (git diff, texte
 * brut, sans filtre, toujours en texte même si le dépôt marque un fichier comme binaire, sans objet de remplacement).
 * Les deux commits doivent être des empreintes git ; rien d'autre n'est passé à git.
 */
export async function codeMajNoyau(de: string, vers: string, racine = RACINE_APPLI): Promise<{ ok: boolean; texte: string }> {
  if (!sha(de) || !sha(vers)) return { ok: false, texte: '' };
  const r = await gitNoyau(racine, ['-c', 'core.quotepath=false', '-c', 'diff.noprefix=false', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--text', '--no-renames', de, vers, '--', ...CHEMINS_NOYAU()]);
  return r.status === 0 ? { ok: true, texte: r.stdout } : { ok: false, texte: '' };
}
