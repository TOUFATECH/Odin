// « Faire un lien » dans Talos : relier « Quand [à la main / un rythme / une appli signale] » à « [appli] · [fonction] »
// (puis d'autres applis à la suite), sans connaître les nœuds. Le lien devient une automatisation ordinaire de Talos
// (déclencheur + un nœud « Action d'une appli » par étape), visible et modifiable ensuite dans l'éditeur à nœuds.
// Ici : la table des événements que chaque appli signale, la liste des fonctions qu'on peut relier, et la construction.

import { checkFlow, normalize, type FlowNode, type Link, type Workflow } from './engine.ts';
import { CATALOG } from './nodes.ts';
import { phrase, verifierRythme } from './rythme.ts';
import type { Action, Module, Param } from '../valhalla/types.ts';

/**
 * Les événements que chaque appli signale (ses `ctx.emit('…')`), pour « Quand <appli> signale ». Toute appli peut
 * aussi signaler ses alertes (« alerte »). Un essai vérifie que la table couvre les modules/<id>.ts.
 */
export const EVENEMENTS: Record<string, string[]> = {
  agora: ['ordre', 'annule', 'fin', 'store', 'retire'],
  appareils: ['disponibilite', 'etat'],
  bragi: ['ordre'],
  bru: ['publie', 'tunnel_arrete', 'tunnel_relance'],
  durinn: ['etat_disque'],
  eir: ['mesure'],
  eitri: ['passage', 'telecharge'],
  fjalar: ['passage', 'telecharge'],
  forseti: ['fichier_modifie'],
  frigg: ['rappel', 'reservation', 'reservation_confirmee', 'reservation_annulee'],
  garmr: ['banni'],
  gefjon: ['nettoyage_planifie', 'programme_desinstalle'],
  geri: ['malveillant', 'nouvelle_destination'],
  gjoll: ['vpn_connecte', 'vpn_journal'],
  hel: ['partitions_cherchees', 'recuperation_terminee'],
  hermod: ['capsule_installee', 'machine_hors_ligne', 'compagnon_installe', 'compagnon_rapport', 'compagnon_detection'],
  himinbjorg: ['clip', 'mouvement'],
  hlin: ['verification'],
  ivaldi: ['terminaux_fermes'],
  kvasir: ['depot_etudie'],
  loki: ['piege'],
  midgard: ['scene'],
  naglfar: ['conteneur_arrete'],
  pegase: ['navigation_du_jour', 'nouvel_appareil', 'telechargement_analyse'],
  sindri: ['sauvegarde_echec', 'sauvegarde_ok', 'agent_phenix_installe', 'image_remise', 'restauration_pc'],
  skidbladnir: ['essais_rates'],
  skogul: ['port_ouvert', 'suspect'],
  thjalfi: ['deploye', 'etape', 'journal'],
  ullr: ['incident', 'libere', 'menace', 'rafale', 'sentinelle', 'support_branche'],
  valgrind: ['acme', 'certificat_renouvele', 'mot_de_passe_refuse', 'scan'],
  var: ['connexion_refusee', 'nouvelle_adresse', 'verrouillage'],
  // Vénus : le fichier s'appelle venus.ts, l'appli a pour identifiant « freyja ».
  venus: ['arrivee', 'enregistrement_echoue'],
  freyja: ['arrivee', 'enregistrement_echoue'],
  vidarr: ['dhcp_bail', 'dhcp_journal', 'dhcp_nouveau', 'dns_amont_panne', 'dns_inondation', 'dns_menace', 'machine_coupee', 'reseau_anomalie'],
  volva: ['recherche'],
  vordr: ['panne', 'probleme', 'retour'],
  ymir: ['vm_arretee', 'iso_reconnue', 'logiciel_installe', 'machine_creee', 'machine_isolee', 'machine_liberee'],
};
/** Les événements d'une appli, plus ses alertes. */
export const evenementsDe = (id: string): string[] => [...(EVENEMENTS[id] ?? []), 'alerte'];

// ---------------------------------------------------------------- Les fonctions qu'on peut relier

export interface ActionLiable { id: string; label: string; what: string; params: Param[]; read: boolean; grave: boolean; raison?: string }
export const RAISON_GRAVE = 'Action grave : elle demande ton accord et ne part pas d\'une automatisation.';
/** Une action est-elle grave (avec ces réglages) ? Une vérification qui échoue compte comme grave. */
export function estGrave(a: Action, entree: Record<string, unknown> = {}): boolean {
  if (!a.grave) return false;
  try { return Boolean(a.grave(entree, undefined)); } catch { return true; }
}
export function actionLiable(a: Action): ActionLiable {
  const g = estGrave(a);
  return { id: a.id, label: a.label, what: a.what, params: a.params ?? [], read: Boolean(a.read), grave: g, ...(g ? { raison: RAISON_GRAVE } : {}) };
}

// ---------------------------------------------------------------- Construire le lien

export type Quand =
  | { sorte: 'main' }
  | { sorte: 'rythme'; rythme: unknown }
  | { sorte: 'appli'; appli: string; evenement?: string; niveau?: 'info' | 'moyenne' | 'haute' | 'critique' };
export interface EntreeLien { nom?: string; quand: Quand; etapes: Array<{ appli: string; action: string; entree?: Record<string, unknown> }>; activer?: boolean }
export type ResultatLien = { ok: true; flow: Partial<Workflow>; phrase: string } | { ok: false; code: 'invalide' | 'grave' | 'introuvable'; error: string; etape?: number };

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** L'appli par son identifiant interne (ou son nom affiché). */
export function trouverAppli(applis: Module[], ref: string): Module | undefined {
  const n = norm(String(ref ?? '').trim()); if (!n) return undefined;
  return applis.find((m) => m.id === ref) ?? applis.find((m) => norm(m.id) === n || norm(m.name) === n);
}
const vide = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim());

/** Construit l'automatisation d'un lien simple (vérifiée par checkFlow), ou dit pourquoi c'est impossible. */
export function construireLien(e: EntreeLien, applis: Module[]): ResultatLien {
  if (!e || typeof e !== 'object' || !e.quand || typeof e.quand !== 'object') return { ok: false, code: 'invalide', error: 'Dis quand le lien part (à la main, selon un rythme, ou quand une appli signale).' };
  const etapes = Array.isArray(e.etapes) ? e.etapes : [];
  if (etapes.length < 1 || etapes.length > 8) return { ok: false, code: 'invalide', error: 'Un lien a de 1 à 8 étapes.' };
  const q = e.quand;
  let declencheur: FlowNode, dit: string;
  if (q.sorte === 'main') { declencheur = { name: 'À la main', type: 'déclencheur.manuel', params: {} }; dit = 'À la main'; }
  else if (q.sorte === 'rythme') {
    const v = verifierRythme(q.rythme); if (!v.ok) return { ok: false, code: 'invalide', error: v.error };
    if (v.rythme.genre === 'secondes' || v.rythme.genre === 'libre') return { ok: false, code: 'invalide', error: 'Ce rythme ne sert qu\'à l\'affichage : choisis tous les jours, chaque semaine, chaque mois, une seule fois, toutes les N minutes ou heures.' };
    dit = phrase(v.rythme);
    declencheur = { name: dit.length > 40 ? `${dit.slice(0, 39).trimEnd()}…` : dit, type: 'déclencheur.planning', params: { mode: 'simple', rythme: v.rythme } };
  } else if (q.sorte === 'appli') {
    const m = trouverAppli(applis, q.appli); if (!m) return { ok: false, code: 'introuvable', error: `Appli introuvable : ${String(q.appli ?? '')}.` };
    const ev = String(q.evenement ?? '').trim();
    if (ev && !evenementsDe(m.id).includes(ev)) return { ok: false, code: 'invalide', error: `${m.name} ne signale pas « ${ev} ».` };
    const niveau = ['info', 'moyenne', 'haute', 'critique'].includes(String(q.niveau)) ? String(q.niveau) : 'haute';
    declencheur = { name: `Quand ${m.name} signale`, type: 'déclencheur.module', params: { module: m.id, événement: ev, niveau } };
    dit = ev === 'alerte' ? `Quand ${m.name} lance une alerte` : ev ? `Quand ${m.name} signale « ${ev} »` : `Quand ${m.name} signale`;
  } else return { ok: false, code: 'invalide', error: 'Quand : « main », « rythme » ou « appli ».' };

  const noeuds: FlowNode[] = [declencheur], pris = new Set([declencheur.name]);
  for (let i = 0; i < etapes.length; i++) {
    const s = etapes[i] ?? { appli: '', action: '' }, ou = `Étape ${i + 1}`;
    const m = trouverAppli(applis, s.appli); if (!m) return { ok: false, code: 'introuvable', error: `${ou} : appli introuvable (${String(s.appli ?? '')}).`, etape: i };
    const a = m.actions.find((x) => x.id === s.action); if (!a) return { ok: false, code: 'introuvable', error: `${ou} : ${m.name} n'a pas la fonction « ${String(s.action ?? '')} ».`, etape: i };
    const entree = s.entree && typeof s.entree === 'object' && !Array.isArray(s.entree) ? s.entree : {};
    if (estGrave(a, entree)) return { ok: false, code: 'grave', error: `${ou} : ${m.name} · ${a.label} — ${RAISON_GRAVE}`, etape: i };
    for (const p of a.params ?? []) if (p.required && vide(entree[p.key])) return { ok: false, code: 'invalide', error: `${ou} : il manque « ${p.label} » pour ${m.name} · ${a.label}.`, etape: i };
    let nom = `${m.name} · ${a.label}`;
    if (pris.has(nom)) { let k = 2; while (pris.has(`${nom} ${k}`)) k++; nom = `${nom} ${k}`; }
    pris.add(nom);
    noeuds.push({ name: nom, type: 'module.action', params: { module: m.id, action: a.id, entrée: JSON.stringify(entree) } });
  }
  noeuds.forEach((n, i) => { n.position = [60 + 240 * i, 160]; });
  const connections: Record<string, Link[][]> = {};
  for (let i = 0; i < noeuds.length - 1; i++) connections[noeuds[i].name] = [[{ node: noeuds[i + 1].name }]];
  const resume = `${dit} → ${noeuds[1].name}`;
  const nom = String(e.nom ?? '').trim().slice(0, 120) || resume;
  const flow: Partial<Workflow> = { name: nom, active: e.activer === true && q.sorte !== 'main', nodes: noeuds, connections, origin: 'lien', settings: { description: `${dit} → ${noeuds.slice(1).map((n) => n.name).join(' → ')}` } };
  const err = checkFlow(normalize(flow), CATALOG);
  if (err) return { ok: false, code: 'invalide', error: err };
  return { ok: true, flow, phrase: resume };
}
