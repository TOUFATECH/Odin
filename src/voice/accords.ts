// Les accords pour copier une voix. Une voix est une donnée personnelle : Odin ne copie que la tienne, ou celle
// d'une personne qui a dit oui — et il le note (qui, quand, pour quelle voix) AVANT que l'enregistrement parte.
// Le registre est un fichier JSON, bloqué pour les outils de fichiers (SECRET_FILES dans policy.ts).
// L'enregistrement lui-même n'est jamais gardé par Odin : seulement sa taille et son empreinte.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Accord {
  id: string;
  /** Quand l'accord a été noté (ISO). */
  at: string;
  /** À qui est la voix : « moi » (le propriétaire) ou « autre » (une personne nommée, qui a donné son accord). */
  de: 'moi' | 'autre';
  /** Le nom de la personne quand ce n'est pas la voix du propriétaire. */
  personne: string;
  /** La phrase que le propriétaire a confirmée. */
  phrase: string;
  /** Qui a confirmé (le prénom du compte ; jamais son adresse). */
  par: string;
  /** Nom donné à la voix, et son identifiant chez le service une fois copiée. */
  voiceName: string; voiceId: string;
  service: string;
  /** L'enregistrement envoyé : taille et empreinte seulement (il n'est pas gardé). */
  echantillon: { octets: number; sha256: string; type: string };
  /** Le service demande une vérification avant de laisser parler cette voix. */
  aVerifier?: boolean;
  /** Accord retiré (ISO) : Odin ne se sert plus de la voix. */
  retire?: string;
  /** La voix a bien été effacée chez le service (sinon : à effacer encore). */
  effacee?: boolean;
}

/** Le dossier des voix copiées (registre des accords ; rien d'autre n'y est gardé aujourd'hui). */
export const copiesDir = (home: string) => join(home, 'valhalla', 'bragi', 'copies');
export const accordsFile = (home: string) => join(copiesDir(home), 'accords.json');

export function accords(home: string): Accord[] {
  try { const l = JSON.parse(readFileSync(accordsFile(home), 'utf8')) as Accord[]; return Array.isArray(l) ? l.filter((a) => a && typeof a.id === 'string') : []; } catch { return []; }
}
function save(home: string, l: Accord[]): void {
  const f = accordsFile(home);
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  writeFileSync(`${f}.tmp`, JSON.stringify(l, null, 1), { mode: 0o600 });
  renameSync(`${f}.tmp`, f);
}

const clean = (x: string, n: number) => x.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Vérifie ce qui est déclaré et rend la phrase d'accord (ou lève une erreur qui dit quoi faire). Pur.
 * Sans confirmation : refus. La voix de quelqu'un d'autre : son nom est obligatoire, l'accord porte son nom.
 */
export function phraseAccord(o: { consent: boolean; de?: string; personne?: string }): { de: 'moi' | 'autre'; personne: string; phrase: string } {
  if (!o.consent) throw new Error('copie refusée : confirme que c\'est ta voix ou que la personne a donné son accord');
  const de = o.de === 'autre' ? 'autre' : 'moi', personne = clean(o.personne ?? '', 80);
  if (de === 'autre' && personne.length < 2) throw new Error('copie refusée : écris le nom de la personne dont c\'est la voix. Son accord est noté avec son nom ; sans son accord, sa voix n\'est pas copiée.');
  return de === 'moi'
    ? { de, personne: '', phrase: 'C\'est ma voix, et j\'accepte qu\'Odin la copie pour parler avec.' }
    : { de, personne, phrase: `C'est la voix de ${personne}, qui m'a donné son accord pour qu'Odin la copie et parle avec.` };
}

/** Note un accord avant l'envoi de l'enregistrement. Lève une erreur si rien ne peut être écrit : alors rien ne part. */
export function noteAccord(home: string, o: { de: 'moi' | 'autre'; personne: string; phrase: string; par: string; voiceName: string; service: string; sample: Uint8Array; type: string }, now = new Date()): Accord {
  const a: Accord = {
    id: randomBytes(6).toString('hex'), at: now.toISOString(), de: o.de, personne: clean(o.personne, 80), phrase: o.phrase, par: clean(o.par, 60) || 'le propriétaire',
    voiceName: clean(o.voiceName, 60), voiceId: '', service: o.service,
    echantillon: { octets: o.sample.byteLength, sha256: createHash('sha256').update(o.sample).digest('hex'), type: clean(o.type, 60) },
  };
  save(home, [a, ...accords(home)].slice(0, 500));
  return a;
}

/** Complète un accord (identifiant de la voix une fois copiée, retrait…). Rend l'accord à jour, ou rien s'il n'existe pas. */
export function majAccord(home: string, id: string, patch: Partial<Pick<Accord, 'voiceId' | 'aVerifier' | 'retire' | 'effacee'>>): Accord | undefined {
  const l = accords(home), a = l.find((x) => x.id === id); if (!a) return undefined;
  Object.assign(a, patch); save(home, l); return a;
}
/** Retire un accord qui n'a servi à rien (la copie a échoué : aucune voix n'existe). */
export function oublieAccord(home: string, id: string): void { const l = accords(home); if (l.some((x) => x.id === id)) save(home, l.filter((x) => x.id !== id)); }

/** L'accord en cours pour une voix copiée par Odin (noté, pas retiré), s'il y en a un. */
export const accordPour = (home: string, voiceId: string): Accord | undefined => (voiceId ? accords(home).find((a) => a.voiceId === voiceId && !a.retire) : undefined);
