// Argos — la corrélation des incidents par poste du parc. On réutilise le moteur d'Asclépios (Signal, score, toSignal,
// Correlator d'ullr/incidents.ts) sans le modifier ni le dupliquer : chaque signal d'un poste porte son `poste`, si
// bien qu'il ne se mêle qu'aux signaux du même poste (la machine d'Odin, elle, reste gérée par Asclépios).
//
// Argos partage donc la même logique d'incidents : il affiche les incidents d'Asclépios (ceux de la machine d'Odin)
// et tient en plus ceux des Satellites, ici. Rangé dans la base ARGOS_ODIN quand elle est prête ; en attendant, en
// fichier <home>/valhalla/argos/incidents.json.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Correlator, type Incident, type Signal } from '../ullr/incidents.ts';
import { persistanceSuspecte, processusLouche, type Telemetrie } from '../compagnon/telemetrie.ts';

const fichier = (home: string) => join(home, 'valhalla', 'argos', 'incidents.json');
function ecrire(f: string, x: unknown): void { mkdirSync(dirname(f), { recursive: true, mode: 0o700 }); writeFileSync(`${f}.tmp`, JSON.stringify(x), { mode: 0o600 }); renameSync(`${f}.tmp`, f); }

/** Charge les incidents du parc déjà connus (vide au départ). */
export function chargerIncidentsParc(home: string): Incident[] {
  try { return existsSync(fichier(home)) ? JSON.parse(readFileSync(fichier(home), 'utf8')) as Incident[] : []; } catch { return []; }
}
export function sauverIncidentsParc(home: string, incidents: Incident[]): void { ecrire(fichier(home), incidents); }

/**
 * Les signaux de sécurité tirés de la télémétrie d'un poste : un programme lancé d'un endroit louche, une connexion
 * sortante vers une adresse malveillante, une rafale de rançongiciel, une persistance douteuse. On passe par le même
 * `toSignal` qu'Asclépios (pour garder exactement sa pondération et ses clés), puis on y attache le poste. Pur :
 * `malveillante` dit si une adresse est connue comme dangereuse (Argos l'obtient de Méduse ou du lot antivirus).
 */
export function signauxTelemetrie(t: Telemetrie, o: { malveillante?: (ip: string) => boolean } = {}): Signal[] {
  const now = t.t, out: Signal[] = [];
  const ajoute = (module: string, type: string, data: Record<string, unknown>) => { const sig = toSignalLocal({ module, type, data }, now); if (sig) out.push({ ...sig, poste: t.poste }); };
  for (const p of t.processus) { const l = processusLouche(p); if (l) ajoute('skogul', 'suspect', { règle: l, détail: p.chemin ?? p.ligne ?? p.nom, pid: p.pid }); }
  for (const c of t.connexions) if (c.rip && o.malveillante?.(c.rip)) ajoute('geri', 'malveillant', { programme: c.prog ?? '?', ip: c.rip });
  for (const x of t.persistance) { const l = persistanceSuspecte(x); if (l) ajoute('forseti', 'fichier_modifie', { fichier: x.cible || x.nom }); }
  if (t.rafale) ajoute('ullr', 'rafale', { nombre: t.rafale.nombre, secondes: t.rafale.secondes, dossier: t.rafale.dossier });
  return out;
}

// On importe `toSignal` d'Asclépios par ce petit relais pour pouvoir le remplacer dans les essais sans toucher ullr.
import { toSignal as toSignalUllr } from '../ullr/incidents.ts';
function toSignalLocal(e: { module: string; type: string; data: Record<string, unknown> }, now: number): Signal | undefined { return toSignalUllr(e, now); }

/**
 * Ajoute les signaux d'un poste au corrélateur du parc et rend les incidents qui naissent ou s'aggravent (à annoncer),
 * avec les réponses automatiques proposées par le moteur (seulement des actions annulables). Ne touche pas Asclépios.
 */
export function corrélerPoste(home: string, t: Telemetrie, apps: (id: string) => string, o: { malveillante?: (ip: string) => boolean } = {}): { incidents: Incident[]; annonces: Incident[] } {
  const corr = new Correlator(chargerIncidentsParc(home));
  const annonces: Incident[] = [];
  for (const sig of signauxTelemetrie(t, o)) { const r = corr.add(sig, apps); if (r.announce && r.incident) annonces.push(r.incident); }
  sauverIncidentsParc(home, corr.incidents);
  return { incidents: corr.incidents, annonces };
}

/** Change l'état d'un incident du parc (traité, ignoré). */
export function réglerIncidentParc(home: string, id: string, state: Incident['state']): Incident | undefined {
  const corr = new Correlator(chargerIncidentsParc(home)); const i = corr.set(id, state); sauverIncidentsParc(home, corr.incidents); return i;
}
