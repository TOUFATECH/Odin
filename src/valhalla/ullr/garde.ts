// Asclépios · « quarantaine d'abord » : le point de passage unique de tout ce qui vient de l'extérieur.
// Une ISO importée dans Hydre, une couche d'image Docker tirée par Argo, un fichier téléchargé par Odin, une pièce
// jointe, un fichier déposé dans une appli, un téléchargement envoyé par Pégase : AVANT d'être utilisé, installé ou
// lancé, il passe ici. S'il est dangereux, il part en quarantaine (consultable dans Asclépios), il n'est ni utilisé
// ni lancé, et le propriétaire reçoit une notification claire : quoi, pourquoi, ce qui a été fait, quoi faire.
//
// Asclépios branche son propre gardien au démarrage (sa base de signatures, ses exceptions, sa quarantaine).
// Sans lui (Odin en essai, appli arrêtée), un gardien de secours analyse quand même avec les règles de base : rien
// n'entre sans analyse.

import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { BASE_RULES, combine, compileGaldr, flat, RuleSet, scanBuffer, type Finding, type Knowledge, type Level, type Verdict } from './engine.ts';

/** Ce qui arrive de l'extérieur. Il faut `fichier` (déjà sur le disque) ou `donnees` (pas encore écrit). */
export interface Arrivee {
  /** d'où ça vient, en clair : « Hydre · ISO importée », « Argo · image Docker », « Téléchargement d'Odin »… */
  origine: string;
  /** l'adresse ou le nom d'origine (lien, image, expéditeur, profil Pégase…) */
  source?: string;
  /** le fichier sur le disque : s'il est bloqué, il quitte sa place (quarantaine) */
  fichier?: string;
  /** ou son contenu, gardé en mémoire tant qu'il n'est pas jugé sûr */
  donnees?: Buffer;
  /** le nom affiché (par défaut : le nom du fichier) */
  nom?: string;
  /** où le fichier irait s'il était libéré (pour un contenu en mémoire) */
  destination?: string;
  /** à quoi il allait servir (« créer une machine virtuelle », « lancer un conteneur ») : dit dans la notification */
  usage?: string;
  /** des morceaux de l'intérieur à analyser aussi (fichiers de démarrage d'une ISO…) : un seul dangereux bloque le tout */
  interieur?: () => Promise<Array<{ nom: string; donnees: Buffer }>>;
  /** pas de notification (l'appelant prévient lui-même) ; la quarantaine et le registre restent faits */
  silencieux?: boolean;
}

/** Le verdict du passage : utilisable ou bloqué, et pourquoi, en clair. */
export interface Passage {
  /** utilisable tel quel */
  ok: boolean;
  bloque: boolean;
  /** vraiment analysé (sinon : moteur indisponible, le passage est refusé par prudence) */
  analyse: boolean;
  sha256: string; taille: number;
  menace?: string; niveau?: Level; score: number;
  /** comment c'est trouvé : empreinte, règle, heuristique… (plusieurs possibles) */
  par?: string;
  /** les raisons, une par trouvaille (« empreinte : dans la base de MalwareBazaar ») */
  pourquoi: string[];
  /** son identifiant dans la quarantaine d'Asclépios (s'il est bloqué) */
  quarantaine?: string;
  /** une phrase claire pour l'appelant */
  texte: string;
  /** le gardien qui a jugé : Asclépios, ou le gardien de secours (règles de base seulement) */
  gardien: 'asclepios' | 'secours';
}

/** Lever cette erreur arrête ce qui allait se faire (installer, lancer, ouvrir) : le passage est joint. */
export class Bloque extends Error {
  readonly passage: Passage;
  constructor(p: Passage) { super(p.texte); this.name = 'Bloque'; this.passage = p; }
}

/** Faut-il bloquer ? Une empreinte connue ou une règle sûre (y compris le fichier d'essai des antivirus), ou un risque critique. Pur. */
export function aBloquer(v: Pick<Verdict, 'findings' | 'inside' | 'score' | 'file'> & Partial<Verdict>): boolean {
  const all = flat(v as Verdict);
  if (!all.length) return false;
  // Le fichier d'essai des antivirus (EICAR) est inoffensif, mais il sert justement à vérifier qu'on bloque : bloqué.
  return all.some((f) => f.sure || f.by === 'empreinte' || (f.klass === 'test' && f.by === 'règle' && f.score >= 40)) || v.score >= 85;
}
/** Les raisons d'un verdict, en clair (« empreinte : … », « règle : … »). Pur. */
export function raisons(v: Verdict): string[] {
  return [...flat(v)].sort((a, b) => b.score - a.score).slice(0, 6).map((f: Finding & { file: string }) => `${f.by} — ${f.threat} : ${f.why}${f.file !== v.file ? ` (dans ${f.file.split('!').slice(1).join(' › ')})` : ''}`);
}
/** La menace principale d'un verdict. Pur. */
export const menaceDe = (v: Verdict): Finding | undefined => [...flat(v)].sort((a, b) => b.score - a.score)[0];

// ---------------------------------------------------------------- Le gardien en service
type Gardien = (a: Arrivee) => Promise<Passage>;
/** Le contexte d'une appli (pour réveiller Asclépios s'il n'a pas encore servi). */
type Reveil = { call(module: string, action: string, input?: Record<string, unknown>, why?: string, o?: { interne?: boolean }): Promise<unknown> };
let gardien: Gardien | undefined;
/** Asclépios se branche ici au démarrage (et se débranche à l'arrêt). */
export function brancherGarde(g: Gardien | undefined): void { gardien = g; }
export const gardeBranchee = (): boolean => Boolean(gardien);

/**
 * Le point de passage commun : analyse ce qui arrive AVANT tout usage. Rend le verdict ; s'il est bloqué, le fichier
 * est déjà en quarantaine (il n'est plus à sa place) et le propriétaire est prévenu. Ne lève pas d'erreur pour un
 * fichier dangereux : voir `exigerSain` pour arrêter net.
 */
export async function quarantaineDabord(a: Arrivee, ctx?: Reveil): Promise<Passage> {
  if (!a.fichier && !a.donnees) throw new Error('quarantaine d\'abord : ni fichier ni contenu à analyser');
  // Asclépios pas encore réveillé (Odin vient de démarrer) : une appli qui passe son contexte le réveille.
  if (!gardien && ctx) await ctx.call('ullr', 'etat', {}, 'réveiller l\'antivirus avant une analyse à l\'arrivée', { interne: true }).catch(() => undefined);
  if (gardien) return gardien(a);
  return secours(a);
}
/** Comme `quarantaineDabord`, mais lève `Bloque` si c'est dangereux : ce qui suit (installer, lancer) n'a pas lieu. */
export async function exigerSain(a: Arrivee, ctx?: Reveil): Promise<Passage> {
  const p = await quarantaineDabord(a, ctx);
  if (p.bloque) throw new Bloque(p);
  return p;
}

// ---------------------------------------------------------------- Lecture et analyse (communes aux deux gardiens)
const sha256Fichier = (f: string) => new Promise<string>((ok, ko) => { const h = createHash('sha256'); createReadStream(f).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', ko); });
/**
 * Analyse un fichier ou un contenu avec une connaissance donnée. Jusqu'à 48 Mo : lu en entier ; au-delà (une ISO,
 * une couche d'image) : empreinte complète + contenu analysé sur les 8 premiers Mo + morceaux de l'intérieur.
 */
export async function analyser(a: Arrivee, k: Knowledge): Promise<{ verdict: Verdict; taille: number }> {
  const nom = a.nom ?? a.fichier?.split(/[\\/]/).pop() ?? 'fichier';
  let v: Verdict, taille: number;
  if (a.donnees) { v = scanBuffer(nom, a.donnees, k); taille = a.donnees.length; }
  else {
    const f = a.fichier!, st = statSync(f); taille = st.size;
    if (st.size <= 48 * 1024 * 1024) v = scanBuffer(nom, readFileSync(f), k);
    else {
      const fd = openSync(f, 'r'); let head: Buffer; try { const b = Buffer.alloc(8 * 1024 * 1024); head = b.subarray(0, readSync(fd, b, 0, b.length, 0)); } finally { closeSync(fd); }
      v = scanBuffer(nom, head, k, { depth: 3 });
      const full = await sha256Fichier(f), known = k.allowHash?.(full) ? undefined : k.hash?.(full);
      v = { ...v, sha256: full, size: st.size, note: 'gros fichier : empreinte complète, contenu analysé sur les 8 premiers Mo' };
      if (k.allowHash?.(full)) v = { ...v, findings: [], inside: undefined };
      if (known) v.findings.unshift({ threat: known.family ? `Malware connu : ${known.family}` : 'Malware connu', by: 'empreinte', level: 'critique', klass: 'malware', score: 100, why: `son empreinte est dans la base de ${known.source}`, source: known.source, family: known.family, sure: true });
    }
  }
  if (a.interieur && !k.allowHash?.(v.sha256)) {
    const parts = await a.interieur().catch(() => [] as Array<{ nom: string; donnees: Buffer }>);
    for (const p of parts) { const w = scanBuffer(`${nom}!${p.nom}`, p.donnees, k, { depth: 1 }); if (w.findings.length || w.inside?.length) v = { ...v, inside: [...(v.inside ?? []), w] }; }
  }
  const c = combine(flat(v));
  return { verdict: { ...v, score: c.score, level: c.level }, taille };
}

// ---------------------------------------------------------------- Gardien de secours (Asclépios absent)
let regles: RuleSet | undefined;
async function secours(a: Arrivee): Promise<Passage> {
  regles ??= new RuleSet(BASE_RULES.map(compileGaldr));
  const { verdict: v, taille } = await analyser(a, { rules: regles });
  const bloque = aBloquer(v), top = menaceDe(v);
  // Sans Asclépios, pas de quarantaine rangée : le fichier est rendu inoffensif sur place (renommé, octets brouillés).
  if (bloque && a.fichier && existsSync(a.fichier)) {
    const b = readFileSync(a.fichier); for (let i = 0; i < b.length; i++) b[i] ^= 0xa5;
    writeFileSync(a.fichier, b); renameSync(a.fichier, `${a.fichier}.bloque-odin`);
  }
  const nom = a.nom ?? a.fichier?.split(/[\\/]/).pop() ?? 'fichier';
  return { ok: !bloque, bloque, analyse: true, sha256: v.sha256, taille, menace: top?.threat, niveau: v.level, score: v.score, par: top ? [...new Set(flat(v).map((f) => f.by))].join(' + ') : undefined, pourquoi: raisons(v), gardien: 'secours',
    texte: bloque ? `🚫 ${nom} est bloqué (${top?.threat ?? 'menace'}) : il ne sera ni utilisé ni lancé.` : `✓ ${nom} : rien de dangereux trouvé.` };
}
