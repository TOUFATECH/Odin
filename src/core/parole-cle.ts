// Ce que la clé d'accès obtient d'Odin EN PARLANT, sans validation : des lectures, écrites ici une à une.
//
// Décision du propriétaire (24/11) : « Validation avant d'agir » — « Sa phrase est traitée comme un appel extérieur :
// Odin répond, mais te demande avant tout geste. »
//
// Un message de la clé arrive à l'agent comme un appel de dehors (texte non fiable, conversation marquée) : Heimdall
// demande alors la validation du propriétaire pour tout outil qui écrit, exécute ou envoie. Il reste les outils classés
// « lecture » qui écrivent quand même quelque chose (une mémoire en quarantaine, le mode du moment, un index, une
// compétence proposée…) et les « consultations » d'un outil qui sait aussi agir (une action d'appli marquée « lecture »
// peut télécharger ou écrire un fichier). Pour la clé, la règle est donc « fermé sauf ce qui est écrit ici » : un outil
// absent de cette page (ou nouveau) est présenté à Heimdall comme une écriture, et attend la validation.
//
// Cette page ne décide pas d'un refus ni d'un accord : elle dit seulement ce qui est une simple lecture. Heimdall garde
// toutes ses règles (un outil d'ici qui serait classé « exécuter » demanderait quand même la validation).

import type { Tool } from '../tools/registry.ts';

/**
 * Outils qui ne font que lire ce qu'Odin sait déjà (rien n'est écrit, lancé ni envoyé à quelqu'un). Chacun a été relu
 * dans son code (relecture du 24/11). N'y sont PAS, et attendent donc la validation du propriétaire :
 *  - fs_read, fs_list, doc_read, media_info : avec l'accès complet, ils lisent n'importe quel fichier de la machine
 *    (chemin absolu, « ~/… »), pas seulement l'espace de travail ; doc_read et media_info lancent aussi un programme ;
 *  - web_fetch, web_search, web_research : une adresse ou une question choisie par la clé sort vers Internet (en mode
 *    Breaker, web_fetch atteint aussi le réseau de la maison) ; la recherche vérifiée ouvre un navigateur, archive des
 *    preuves et appelle un modèle ;
 *  - skill_read : il note l'usage de la compétence et ajoute ses scripts à la bibliothèque ;
 *  - net_blocked : il se connecte à la box ; system_updates : il lance les gestionnaires de paquets de la machine.
 */
const LECTURES: ReadonlySet<string> = new Set([
  // les fiches, la mémoire, les conversations, le Cerveau (la clé les lit déjà par les routes de lecture)
  'note_find', 'memory_search', 'memory_profile', 'session_search', 'cerveau_chercher', 'cerveau_lire', 'evidence_search',
  // ce qui est prévu, ce qu'Odin sait faire, ses réglages (aucun secret), son propre code
  'schedule_list', 'reminder_list', 'calendar_list', 'habits_list', 'script_list', 'settings_get', 'self_info', 'self_read', 'ia_historique', 'undo_recent', 'change_plan',
  // l'état de la maison et du réseau, tels qu'ils sont déjà connus (ou lus chez Home Assistant et Proxmox, déjà reliés)
  'ha_states', 'net_inventory', 'net_security', 'machine_list', 'proxmox_list', 'energy_report', 'environment_map',
]);

/** Outils qui savent lire ET agir : seules ces demandes-là sont des lectures (une action d'appli, même « lecture », n'en est pas). */
const SELON_LA_DEMANDE: Readonly<Record<string, ReadonlySet<string>>> = {
  valhalla: new Set(['lister', 'expliquer', 'conseiller', 'etat', 'alertes', 'liens', 'manips']),
  draupnir: new Set(['lister', 'executions', 'noeuds']),
};

/** Cet appel d'outil est-il une simple lecture, permise à la clé sans validation ? */
export function lectureLibre(nom: string, entree: Record<string, unknown>): boolean {
  if (Object.hasOwn(SELON_LA_DEMANDE, nom)) return typeof entree.action === 'string' && SELON_LA_DEMANDE[nom].has(entree.action);
  return LECTURES.has(nom);
}

/**
 * Le même outil, présenté à Heimdall comme un geste : toujours une action engageante (une lecture ou un accès au
 * réseau devient une écriture), jamais une « consultation ». L'agent le présente en plus comme une tâche automatique
 * (« ce n'est pas toi ») : Heimdall demande alors la validation du propriétaire quel que soit le réglage
 * `policy.taintEscalatesFrom`, et en mode Breaker rien n'est « demandé par toi ».
 */
export function enGeste(outil: Tool): Tool {
  return Object.create(outil, { risk: { value: outil.risk === 'read' || outil.risk === 'network' ? 'write' : outil.risk, enumerable: true }, lookup: { value: undefined, enumerable: true } }) as Tool;
}

/** Les caractères qui cassent une ligne ou changent le sens d'écriture, et les clés dessinées (la marque de la clé ne s'imite pas). */
const HORS_LIGNE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]|\ud83d[\udd10\udd11\udd0f\udddd]\ufe0f?/g;
/**
 * Un texte venu de la demande de la clé (le résumé de l'action, la raison), tel qu'il est montré au propriétaire dans
 * la demande de validation : une seule ligne, sans caractère caché ni clé dessinée, coupé. Il ne peut donc ni imiter
 * la ligne « Demandé par un programme… », ni la repousser hors de vue.
 */
export function pourLaCarte(texte: string, max = 300): string {
  const t = String(texte ?? '').replace(HORS_LIGNE, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Au plus tant de demandes de validation nées de la clé en attente à la fois, et tant par heure : au-delà, c'est non, sans déranger le propriétaire. */
export const LIMITE_CLE = { enAttente: 3, parHeure: 12 } as const;

/**
 * Le compte des demandes de validation nées de la clé. En mémoire vive : il repart de zéro au redémarrage d'Odin.
 * Sert aussi à reconnaître une demande née de la clé (un « oui » tout court ne la valide pas : il faut son bouton).
 */
export class QuotaCle {
  /** L'heure de chaque demande partie depuis une heure. */
  heures: number[] = [];
  /** Les demandes en attente : identifiant → échéance. */
  attente = new Map<string, number>();
  /** Quand le propriétaire a été prévenu pour la dernière fois que la limite est atteinte. */
  dit = 0;
  /** Une demande de plus : part-elle ? Sinon, `dire` est vrai une fois par heure (prévenir le propriétaire). */
  prendre(id: string, dureeMs: number, now = Date.now()): { ok: boolean; dire?: boolean } {
    this.heures = this.heures.filter((t) => now - t < 3_600_000);
    for (const [k, fin] of this.attente) if (fin <= now) this.attente.delete(k);
    if (this.attente.size >= LIMITE_CLE.enAttente || this.heures.length >= LIMITE_CLE.parHeure) { const dire = now - this.dit >= 3_600_000; if (dire) this.dit = now; return { ok: false, dire }; }
    this.heures.push(now); this.attente.set(id, now + dureeMs);
    return { ok: true };
  }
  /** Cette demande est-elle née de la clé, et encore en attente ? */
  attend(id: string | undefined, now = Date.now()): boolean { const fin = id === undefined ? undefined : this.attente.get(id); return fin !== undefined && now < fin; }
  /** La demande a reçu sa réponse. */
  rendre(id: string): void { this.attente.delete(id); }
}
