// Argos — le modèle des postes du parc vus par l'EDR : la dernière télémétrie reçue de chaque poste (processus et
// leur filiation, connexions sortantes, persistance) et une chronologie datée (qui a lancé quoi, ce qui est apparu).
//
// Rangé dans la base ARGOS_ODIN quand elle est prête ; en attendant, en fichiers sous
// <home>/valhalla/argos/postes/<poste>.json. La chronologie est bornée : on ne garde que les derniers événements.
// La lecture et l'écriture sont ici ; le calcul (quels événements sont nouveaux) est pur, vérifié sans poste.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { arbreProcessus, filiation, persistanceSuspecte, processusLouche, type NoeudProcessus, type Telemetrie } from '../compagnon/telemetrie.ts';

/** Un événement de la chronologie d'un poste. `genre` dit ce qui s'est passé ; `tone` colore la ligne. */
export interface EvenementPoste { t: number; genre: 'processus' | 'connexion' | 'persistance' | 'rafale' | 'telemetrie' | 'reponse'; texte: string; pid?: number; tone?: 'bon' | 'attention' | 'mauvais' | 'neutre' }
/** Ce qu'Argos garde d'un poste. */
export interface Poste { poste: string; sys?: string; vu?: number; telemetrie?: Telemetrie; chronologie: EvenementPoste[] }

const MAX_CHRONO = 300;
const propre = (poste: string) => String(poste ?? '').trim().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 60);
const fichierPoste = (home: string, poste: string) => join(home, 'valhalla', 'argos', 'postes', `${propre(poste).replace(/[^\w.-]/g, '_') || 'poste'}.json`);
function ecrire(f: string, x: unknown): void { mkdirSync(dirname(f), { recursive: true, mode: 0o700 }); writeFileSync(`${f}.tmp`, JSON.stringify(x), { mode: 0o600 }); renameSync(`${f}.tmp`, f); }

/** Le poste tel qu'Argos le connaît (vide s'il n'a jamais parlé). */
export function poste(home: string, nom: string): Poste {
  try { const p = JSON.parse(readFileSync(fichierPoste(home, nom), 'utf8')) as Poste; return { ...p, chronologie: Array.isArray(p.chronologie) ? p.chronologie : [] }; }
  catch { return { poste: propre(nom), chronologie: [] }; }
}
/** Les postes connus d'Argos. */
export function postes(home: string): Poste[] {
  const d = join(home, 'valhalla', 'argos', 'postes');
  if (!existsSync(d)) return [];
  try { return readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(join(d, f), 'utf8')) as Poste; } catch { return undefined; } }).filter((x): x is Poste => Boolean(x)).map((p) => ({ ...p, chronologie: Array.isArray(p.chronologie) ? p.chronologie : [] })); }
  catch { return []; }
}
export function sauverPoste(home: string, p: Poste): void { ecrire(fichierPoste(home, p.poste), p); }

/**
 * Enregistre la télémétrie reçue d'un poste : garde la dernière, et ajoute à la chronologie ce qui est nouveau depuis
 * la fois d'avant (nouveaux programmes, nouvelles connexions sortantes, nouvelle persistance, rafale de rançongiciel).
 * Rend le poste à jour et les événements ajoutés.
 */
export function ingererTelemetrie(home: string, t: Telemetrie): { poste: Poste; nouveaux: EvenementPoste[] } {
  const p = poste(home, t.poste);
  const nouveaux = evenementsNouveaux(p.telemetrie, t);
  p.sys = t.sys; p.vu = t.t; p.telemetrie = t;
  p.chronologie = [...p.chronologie, ...nouveaux].slice(-MAX_CHRONO);
  sauverPoste(home, p);
  return { poste: p, nouveaux };
}
/** Ajoute un événement à la chronologie d'un poste (par exemple une réponse lancée). */
export function noterEvenement(home: string, nom: string, e: EvenementPoste): void {
  const p = poste(home, nom); p.chronologie = [...p.chronologie, e].slice(-MAX_CHRONO); sauverPoste(home, p);
}

/** Les événements nouveaux entre deux télémétries (la précédente peut manquer : premier contact). Pur. */
export function evenementsNouveaux(avant: Telemetrie | undefined, apres: Telemetrie): EvenementPoste[] {
  const out: EvenementPoste[] = [], t = apres.t;
  const pidsAvant = new Set((avant?.processus ?? []).map((x) => x.pid));
  const connAvant = new Set((avant?.connexions ?? []).map((c) => `${c.rip}:${c.rport}`));
  const persAvant = new Set((avant?.persistance ?? []).map((x) => `${x.genre}|${x.nom}`));
  // Premier contact : on ne déroule pas tout l'existant, juste ce qui est louche.
  if (!avant) {
    for (const p of apres.processus) { const l = processusLouche(p); if (l) out.push({ t, genre: 'processus', pid: p.pid, tone: 'attention', texte: `${p.nom} (${p.pid}) : ${l}` }); }
    for (const x of apres.persistance) { const l = persistanceSuspecte(x); if (l) out.push({ t, genre: 'persistance', tone: 'attention', texte: `${x.nom} : ${l}` }); }
    out.push({ t, genre: 'telemetrie', tone: 'neutre', texte: `premier relevé : ${apres.processus.length} programmes, ${apres.connexions.length} connexions sortantes` });
    if (apres.rafale) out.push({ t, genre: 'rafale', tone: 'mauvais', texte: `rafale : ${apres.rafale.nombre} fichiers réécrits en ${apres.rafale.secondes} s dans ${apres.rafale.dossier}` });
    return out;
  }
  for (const p of apres.processus) {
    if (pidsAvant.has(p.pid)) continue;
    const l = processusLouche(p), fil = filiation(apres.processus, p.ppid)[0];
    out.push({ t, genre: 'processus', pid: p.pid, tone: l ? 'attention' : 'neutre', texte: `${p.nom} (${p.pid})${fil ? ` lancé par ${fil.nom}` : ''}${l ? ` — ${l}` : ''}` });
  }
  for (const c of apres.connexions) { const k = `${c.rip}:${c.rport}`; if (!connAvant.has(k)) out.push({ t, genre: 'connexion', tone: 'neutre', texte: `${c.prog ?? 'un programme'} → ${c.rip}:${c.rport}` }); }
  for (const x of apres.persistance) { const k = `${x.genre}|${x.nom}`; if (persAvant.has(k)) continue; const l = persistanceSuspecte(x); out.push({ t, genre: 'persistance', tone: l ? 'attention' : 'neutre', texte: `nouvelle persistance ${x.genre} « ${x.nom} »${l ? ` — ${l}` : ''}` }); }
  if (apres.rafale && !avant.rafale) out.push({ t, genre: 'rafale', tone: 'mauvais', texte: `rafale : ${apres.rafale.nombre} fichiers réécrits en ${apres.rafale.secondes} s dans ${apres.rafale.dossier}` });
  return out;
}

/** L'arbre des processus d'un poste (pour la fiche d'un incident). */
export function arbreDuPoste(p: Poste): NoeudProcessus[] { return arbreProcessus(p.telemetrie?.processus ?? []); }
