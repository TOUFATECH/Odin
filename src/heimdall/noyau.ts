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
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
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
  'src/muninn/store.ts', 'src/web/access.ts', 'src/web/pairing.ts', 'src/valhalla/keryx/auth.ts', 'src/valhalla/keryx/canal.ts', 'src/web/maison-api.ts', 'src/valhalla/modules/midgard.ts', 'src/mimir/client.ts', 'src/valhalla/mcp.ts', 'src/types.ts', 'src/cli/main.ts'] as const;
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
const norme = (rel: string): string => { const r = rel.split(sep).join('/').replace(/\\/g, '/').replace(/^\.\//, ''); return insensible ? r.toLowerCase() : r; };

/** Un chemin RELATIF (déjà résolu) est-il dans le noyau ? Pur. */
export function estNoyau(rel: string): boolean {
  const r = norme(rel);
  if (!r || r.startsWith('../') || r === '..' || isAbsolute(r)) return false;
  return NOYAU_DOSSIERS.some((d) => r.startsWith(norme(d)) || r === norme(d).replace(/\/$/, '')) || NOYAU_FICHIERS.some((f) => r === norme(f));
}

/**
 * Le chemin réel, relatif à la racine, d'un chemin quelconque : `..`, liens symboliques (sur le fichier OU un dossier
 * parent), chemin absolu, majuscules sous Windows. Le fichier peut ne pas exister encore (on résout le plus proche
 * parent existant). Rend undefined s'il est hors de la racine.
 */
export function cheminReelRelatif(chemin: string, racine = RACINE_APPLI): string | undefined {
  const abs = resolve(racine, chemin);
  let existant = abs, reste = '';
  while (!existsSync(existant)) { const p = dirname(existant); if (p === existant) break; reste = reste ? join(basename(existant), reste) : basename(existant); existant = p; }
  let reel = existant; try { reel = realpathSync(existant); } catch { /* garde le chemin tel quel */ }
  let rac = racine; try { rac = realpathSync(racine); } catch { /* idem */ }
  const final = reste ? join(reel, reste) : reel;
  const rel = relative(rac, final);
  const relI = insensible ? relative(rac.toLowerCase(), final.toLowerCase()) : rel;
  if (!relI || relI.startsWith('..') || isAbsolute(relI)) return undefined;
  return rel;
}

/** La raison « grave » si `chemin` (relatif à la racine, ou absolu) touche le noyau ; sinon undefined. */
export function graveNoyau(chemin: string, racine = RACINE_APPLI): string | undefined {
  const rel = cheminReelRelatif(chemin, racine);
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
