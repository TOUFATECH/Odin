// Talos : les automatisations de départ, rangées par dossier. Installées une seule fois, au premier lancement
// d'un Odin neuf (ou à la demande du propriétaire quand il a déjà les siennes) : voir Talos.installerDepart.
//
// Les ACTIVES ne font que lire et résumer : actions d'applis marquées lecture (read) et sans gravité, Thot, l'IA
// d'Odin qui répond sans agir, et un message au propriétaire lui-même. Aucune n'envoie quoi que ce soit en son nom
// à un tiers, ne dépense, n'efface, n'ouvre ni n'arrête rien. Ce sont des bilans qui se taisent quand tout va bien.
// Celles qui agissent, ou qui demandent un réglage du propriétaire (« À choisir »), restent en BROUILLON.
// Rien de privé : aucun nom, aucune adresse, aucun domaine.

import type { FlowNode, Workflow } from './engine.ts';
import type { Rythme } from './rythme.ts';

export interface Depart { dossier: string; flow: Partial<Workflow> }

/** Les noms des dossiers créés pour les automatisations de départ (réutilisés s'ils existent déjà). */
export const DOSSIERS_DEPART = ['Sécurité', 'Machines et sauvegardes', 'Réseau', 'Maison', 'Organisation', 'Liens entre applis'] as const;
/** Les identifiants de la série « Liens entre applis » commencent ainsi (proposés à part à un Odin déjà installé). */
export const PREFIXE_LIEN = 'depart-lien-';

const RIEN = 'S\'il n\'y a rien à signaler, réponds RIEN.';

type Etape = Omit<FlowNode, 'id' | 'position'>;
const planning = (name: string, rythme: Rythme): Etape => ({ name, type: 'déclencheur.planning', params: { mode: 'simple', rythme } });
const action = (name: string, module: string, act: string, entree = '{}'): Etape => ({ name, type: 'module.action', params: { module, action: act, entrée: entree } });
const demander = (consigne: string, envoyer = 'si utile', name = 'Résumer'): Etape => ({ name, type: 'odin.demander', params: { consigne, pour: 'pour tout', envoyer } });
const prevenir = (texte: string, name = 'Me prévenir'): Etape => ({ name, type: 'odin.prévenir', params: { texte, regrouper: true } });
const texte = (etape: string) => `{{ $node["${etape}"].json.texte }}`;

const lundi = (heure: string): Rythme => ({ genre: 'semaine', jours: [1], heure });
const dimanche = (heure: string): Rythme => ({ genre: 'semaine', jours: [0], heure });
const chaqueJour = (heure: string): Rythme => ({ genre: 'jour', heure });
const premierDuMois = (heure: string): Rythme => ({ genre: 'mois', jour: 1, heure });

/**
 * Une automatisation de départ : les étapes s'enchaînent dans l'ordre (sortie 0 vers l'étape suivante), sauf
 * `liens` donnés à part. Identifiant fixe `depart-<nom>`, aucune alerte d'échec envoyée chaque semaine (l'échec
 * reste visible sur la carte).
 */
function flux(id: string, name: string, description: string, active: boolean, etapes: Etape[], liens?: Workflow['connections']): Partial<Workflow> {
  const nodes = etapes.map((e, i) => ({ ...e, position: [40 + i * 220, 200] as [number, number] }));
  const connections: Workflow['connections'] = liens ?? Object.fromEntries(etapes.slice(0, -1).map((e, i) => [e.name, [[{ node: etapes[i + 1].name }]]]));
  return { id: `depart-${id}`, name, active, origin: 'depart', nodes: nodes as FlowNode[], connections, settings: { retry: 0, notifyOnError: false, description } };
}

/** Toutes les automatisations de départ : les bilans et brouillons, puis la série « Liens entre applis ». */
export function automatisationsDepart(): Depart[] { return [...bilansDepart(), ...liensEntreApplis()]; }

/**
 * La série « Liens entre applis » (demandée le 17/11) : chacune « Quand <appli A> signale <événement> → <appli B> fait
 * <une de ses fonctions> » (+ « Me prévenir » au besoin). Sa règle : un lien qui AGIT arrive en BROUILLON ; un lien
 * qui ne fait que lire et le prévenir arrive ACTIF. Aucune ne refait un réflexe de src/valhalla/links.ts, aucune ne
 * lance une action grave. Chaque événement et chaque fonction sont pris dans le code (essais talos-dossiers-depart*).
 */
export function liensEntreApplis(): Depart[] {
  const L = 'Liens entre applis';
  const quand = (name: string, module: string, evenement: string): Etape => ({ name, type: 'déclencheur.module', params: { module, événement: evenement, niveau: 'haute' } });
  return [
    // Persona émet « nouvelle_adresse » à la connexion d'une personne depuis une adresse qu'elle n'avait jamais
    // utilisée (src/valhalla/modules/var.ts:140) ; Méduse « verifier » (lecture, src/valhalla/modules/geri.ts:135).
    { dossier: L, flow: flux('lien-nouvelle-adresse', 'Connexion depuis une adresse nouvelle → Méduse vérifie', 'Quand Persona voit une personne se connecter depuis une adresse qu\'elle n\'avait jamais utilisée, Méduse regarde si cette adresse est dans ses listes de menaces, puis te prévient.', true, [
      quand('Connexion', 'var', 'nouvelle_adresse'),
      action('Vérifier l\'adresse', 'geri', 'verifier', '{"ip":"{{ $json.ip }}"}'),
      prevenir('🔑 Connexion de {{ $node["Connexion"].json.login }} depuis une adresse nouvelle ({{ $node["Connexion"].json.ip }}). Méduse : {{ $json.texte }}'),
    ]) },
    // Hydre émet « machine_creee » (src/valhalla/ymir/machines.ts:93 et :159) ; Atlas « ajouter » écrit une fiche
    // (src/valhalla/modules/askr.ts:179) : il agit, donc brouillon. L'événement ne transmet pas la MAC : Atlas, qui
    // ne reconnaît un appareil déjà vu que par sa MAC ou son numéro de série (askr.ts:181-182), peut faire une fiche
    // en double si la machine apparaît aussi sur le réseau ; la description le dit.
    // (Pas de lien « Machine créée → Pulsar » : Hydre ajoute déjà elle-même la sonde, src/valhalla/ymir/machines.ts:35.)
    { dossier: L, flow: flux('lien-machine-inventaire', 'Machine créée → fiche dans l\'inventaire', 'Quand Hydre crée une machine virtuelle ou un conteneur, Atlas lui ouvre une fiche dans l\'inventaire (nom et adresse). Attention : si Atlas voit aussi cette machine sur le réseau, il peut en faire une fiche en double (il ne connaît pas sa carte réseau).', false, [
      quand('Machine créée', 'ymir', 'machine_creee'),
      action('Fiche Atlas', 'askr', 'ajouter', '{"nom":"{{ $json.nom }}","ip":"{{ $json.ip }}"}'),
    ]) },
  ];
}

function bilansDepart(): Depart[] {
  const S = 'Sécurité', M = 'Machines et sauvegardes', R = 'Réseau', H = 'Maison', O = 'Organisation';
  return [
    // ---------------- Sécurité
    { dossier: S, flow: flux('bilan-securite', 'Bilan sécurité du lundi', 'Chaque lundi à 9 h, l\'état de la protection, les incidents et les adresses bannies, résumés seulement si quelque chose mérite un regard.', true, [
      planning('Chaque lundi', lundi('09:00')), action('Protection', 'ullr', 'etat'), action('Incidents', 'ullr', 'incidents'), action('Bannis', 'garmr', 'bannis'),
      demander(`Protection : ${texte('Protection')}\nIncidents : ${texte('Incidents')}\nBannis : ${texte('Bannis')}\nDis en 5 lignes au plus ce qui mérite mon attention. ${RIEN}`),
    ]) },
    { dossier: S, flow: flux('alertes-moyennes', 'Alertes moyennes du jour', 'Chaque soir à 20 h, les alertes moyennes du jour en un seul message (elles ne sont jamais envoyées une par une).', true, [
      planning('Chaque soir', chaqueJour('20:00')), action('Alertes', 'forseti', 'alertes', '{"gravite":"moyenne"}'),
      demander(`Voici les alertes récentes : ${texte('Alertes')}\nNe garde que celles de niveau moyenne datées des dernières 24 heures, en une ligne chacune. ${RIEN}`, 'si utile', 'Trier'),
    ]) },
    { dossier: S, flow: flux('conformite', 'Contrôle de conformité du mois', 'Le 1er de chaque mois à 10 h, le score de durcissement et les points à corriger.', true, [
      planning('Chaque mois', premierDuMois('10:00')), action('Conformité', 'forseti', 'conformite'),
      demander(`Contrôle de conformité : ${texte('Conformité')}\nDonne le score et, une ligne chacun, les points à corriger qui concernent vraiment cette machine. ${RIEN}`),
    ]) },
    // Le message ne cite aucun compte : seulement des nombres (le détail se lit dans le coffre).
    { dossier: S, flow: flux('coffre', 'Bilan du coffre de mots de passe', 'Le 1er de chaque mois à 10 h 30, le nombre de mots de passe faibles, réutilisés ou trouvés dans une fuite ; un mot seulement s\'il y en a.', true, [
      planning('Chaque mois', premierDuMois('10:30')), action('Bilan', 'brisingamen', 'bilan'),
      demander(`Bilan du coffre : ${texte('Bilan')}\nDonne seulement les nombres de mots de passe faibles, réutilisés ou trouvés dans une fuite, sans citer aucun compte, site ni identifiant. Si le coffre est vide ou s'il n'y en a aucun, réponds RIEN.`),
    ]) },
    { dossier: S, flow: flux('pare-feu', 'Pare-feu et ports de la semaine', 'Chaque lundi à 9 h 15, le pare-feu de la machine et les ports qu\'Odin a ouverts ; un mot seulement si un port inattendu est joignable.', true, [
      planning('Chaque lundi', lundi('09:15')), action('Pare-feu', 'hlid', 'etat'), action('Ports d\'Odin', 'garmr', 'ports_ouverts'),
      demander(`Pare-feu : ${texte('Pare-feu')}\nPorts ouverts par Odin : ${texte('Ports d\'Odin')}\nSignale seulement un port joignable qui n'a pas d'explication. ${RIEN}`),
    ]) },
    // Brouillon : il faut avoir relié la box (réglage du propriétaire).
    { dossier: S, flow: flux('ports-box', 'Ports ouverts sur la box', 'Chaque lundi, ce que la box laisse entrer depuis Internet.', false, [
      planning('Chaque lundi', lundi('09:20')), action('Box', 'hlid', 'box'),
      demander(`Box : ${texte('Box')}\nSignale seulement ce qui est joignable depuis Internet sans explication. ${RIEN}`),
    ]) },
    // Brouillon : il faut d'abord déclarer des domaines.
    { dossier: S, flow: flux('defauts-sites', 'Défauts de mes sites', 'Chaque lundi, les défauts relevés par la recherche passive sur mes domaines déclarés.', false, [
      planning('Chaque lundi', lundi('09:25')), action('Défauts', 'achille', 'defauts'), prevenir('🌐 {{ $json.texte }}'),
    ]) },

    // ---------------- Machines et sauvegardes
    // Sans l'étape « santé des disques » (Durinn) : elle échoue sur Windows et arrêterait tout le bilan. Un disque qui
    // passe à Mauvais est signalé par Durinn lui-même (et par le brouillon « Disque mauvais → sauvegarde »).
    { dossier: M, flow: flux('sante-machine', 'Santé de la machine du lundi', 'Chaque lundi à 8 h 30, l\'état de la machine et de ses volumes ; seulement ce qui est orange ou rouge.', true, [
      planning('Chaque lundi', lundi('08:30')), action('Machine', 'eir', 'etat'), action('Volumes', 'fensalir', 'disques'),
      demander(`Machine : ${texte('Machine')}\nVolumes : ${texte('Volumes')}\nNe parle que de ce qui est en attention ou mauvais. ${RIEN}`),
    ]) },
    { dossier: M, flow: flux('bilan-sauvegardes', 'Bilan des sauvegardes du dimanche', 'Chaque dimanche à 10 h, les plans de sauvegarde et les dernières sauvegardes des bases ; dit aussi s\'il n\'existe aucun plan.', true, [
      planning('Chaque dimanche', dimanche('10:00')), action('Plans', 'sindri', 'plans'), action('Bases', 'skuld', 'historique'),
      demander(`Plans de sauvegarde : ${texte('Plans')}\nSauvegardes des bases : ${texte('Bases')}\nSignale un plan en retard, une sauvegarde ratée, ou l'absence de tout plan. ${RIEN}`),
    ]) },
    { dossier: M, flow: flux('place', 'Place à libérer', 'Le 1er de chaque mois à 11 h, un mot seulement s\'il y a beaucoup de place à libérer (rien n\'est effacé).', true, [
      planning('Chaque mois', premierDuMois('11:00')), action('Mesurer', 'gefjon', 'analyser'), action('Gros fichiers', 'gefjon', 'gros_fichiers'),
      demander(`Place à libérer : ${texte('Mesurer')}\nPlus gros fichiers : ${texte('Gros fichiers')}\nSignale seulement s'il y a au moins un gigaoctet à libérer, en 3 lignes au plus. ${RIEN}`),
    ]) },
    { dossier: M, flow: flux('conteneurs', 'Nouvelles versions des conteneurs', 'Chaque mercredi à 9 h, les conteneurs pour lesquels une image plus récente existe.', true, [
      planning('Chaque mercredi', { genre: 'semaine', jours: [3], heure: '09:00' }), action('Versions', 'naglfar', 'nouvelles_versions'),
      demander(`Conteneurs : ${texte('Versions')}\nDonne, une ligne chacun, les conteneurs pour lesquels une image plus récente existe. ${RIEN}`),
    ]) },
    { dossier: M, flow: flux('parc', 'Parc de machines du lundi', 'Chaque lundi à 8 h 45 : machines hors ligne, disques presque pleins, mises à jour en attente.', true, [
      planning('Chaque lundi', lundi('08:45')), action('Parc', 'hermod', 'parc'),
      demander(`Parc : ${texte('Parc')}\nSignale les machines hors ligne, les disques presque pleins et les mises à jour en attente. ${RIEN}`),
    ]) },
    { dossier: M, flow: flux('vm', 'Machines virtuelles de la semaine', 'Chaque lundi à 8 h 50, l\'état des machines virtuelles et des conteneurs installés.', true, [
      planning('Chaque lundi', lundi('08:50')), action('Parc virtuel', 'ymir', 'parc'),
      demander(`Machines virtuelles et conteneurs : ${texte('Parc virtuel')}\nSignale ce qui est arrêté sans raison, en erreur ou presque plein. ${RIEN}`),
    ]) },
    // Brouillon : le nom du plan appartient au propriétaire, et lancer une sauvegarde n'est pas une lecture.
    { dossier: M, flow: flux('disque-mauvais', 'Disque mauvais → sauvegarde', 'Quand un disque passe à Mauvais, lance une sauvegarde puis me prévient.', false, [
      { name: 'Disque', type: 'déclencheur.module', params: { module: 'durinn', événement: 'etat_disque', niveau: 'haute' } },
      { name: 'Mauvais ?', type: 'logique.si', params: { valeur: '{{ $json.etat }}', opérateur: 'contient', comparer: 'mauvais' } },
      action('Sauvegarder', 'sindri', 'sauvegarder', '{"plan":"À choisir"}'),
      prevenir('💾 Disque {{ $node["Disque"].json.disque }} passé à Mauvais : {{ $json.texte }}'),
    ], { Disque: [[{ node: 'Mauvais ?' }]], 'Mauvais ?': [[{ node: 'Sauvegarder' }], []], Sauvegarder: [[{ node: 'Me prévenir' }]] }) },

    // ---------------- Réseau
    { dossier: R, flow: flux('reseau', 'Réseau : bilan du lundi', 'Chaque lundi à 9 h 30, ce qui sort de l\'ordinaire sur le réseau depuis le début du mois.', true, [
      planning('Chaque lundi', lundi('09:30')), action('Historique', 'vidarr', 'historique', '{"periode":"mois"}'),
      demander(`Réseau depuis le début du mois : ${texte('Historique')}\nDis seulement ce qui sort de l'ordinaire. ${RIEN}`),
    ]) },
    // Brouillon : le Wi-Fi n'est connu qu'après une première analyse dans l'appli.
    { dossier: R, flow: flux('wifi', 'Wi-Fi : point du mois', 'Le 1er de chaque mois à 11 h 30, ce qui cloche dans le Wi-Fi et la box (une fois le Wi-Fi analysé).', false, [
      planning('Chaque mois', premierDuMois('11:30')), action('Wi-Fi', 'svalinn', 'resume'),
      demander(`Wi-Fi : ${texte('Wi-Fi')}\nSignale seulement ce qui cloche (réseau ouvert, chiffrement faible, canal saturé). ${RIEN}`),
    ]) },
    // Brouillon : l'action écrit dans l'inventaire (elle n'est pas une lecture).
    { dossier: R, flow: flux('inventaire', 'Appareils du réseau dans l\'inventaire', 'Chaque lundi, ajoute à l\'inventaire les appareils vus sur le réseau.', false, [
      planning('Chaque lundi', lundi('10:00')), action('Inventaire', 'askr', 'synchroniser'), prevenir('🔄 {{ $json.texte }}'),
    ]) },

    // ---------------- Maison
    // Brouillon : il faut d'abord régler le lieu (sans lui, l'étape échoue).
    { dossier: H, flow: flux('meteo', 'Météo : qui avait vu juste', 'Le 1er de chaque mois à midi, le score de chaque source météo, rangé dans une note (une fois le lieu réglé).', false, [
      planning('Chaque mois', premierDuMois('12:00')), action('Score', 'zeus', 'bilan'),
      { name: 'Ranger', type: 'saga.écrire', params: { mode: 'créer', titre: 'Météo — bilan du {{ $today }}', type: 'note', note: '', contenu: '{{ $json.texte }}' } },
    ]) },
    // Brouillon : le nom de la scène appartient au propriétaire, et l'action agit sur la maison.
    { dossier: H, flow: flux('scene-coucher', 'Scène du coucher', 'Chaque soir à 22 h 30, lance une scène de la maison.', false, [
      planning('Chaque soir', chaqueJour('22:30')), action('Scène', 'midgard', 'scene', '{"scene":"À choisir"}'),
    ]) },

    // ---------------- Organisation
    { dossier: O, flow: flux('point-matin', 'Point du matin', 'Chaque jour à 7 h 30, ce qui demande attention, la météo et les rendez-vous du jour, en un message seulement si c\'est utile.', true, [
      planning('Chaque matin', chaqueJour('07:30')), { name: 'Attention', type: 'saga.attention', params: {} }, { name: 'Regrouper', type: 'données.regrouper', params: { champ: 'points' } },
      action('Météo', 'gladsheim', 'meteo'), action('Agenda', 'frigg', 'agenda'),
      { name: 'Réunir', type: 'logique.fusionner', params: { mode: 'à la suite' } },
      demander(`Points : {{ $node["Regrouper"].json.points }}\nMétéo : ${texte('Météo')}\nRendez-vous : ${texte('Agenda')}\nFais-moi un point du matin court, le plus urgent d'abord. ${RIEN}`),
    ], {
      // Deux branches qui se rejoignent : sans rien à faire dans Thot, la météo et les rendez-vous arrivent quand même.
      'Chaque matin': [[{ node: 'Attention' }, { node: 'Météo' }]], Attention: [[{ node: 'Regrouper' }]], Regrouper: [[{ node: 'Réunir', input: 0 }]],
      Météo: [[{ node: 'Agenda' }]], Agenda: [[{ node: 'Réunir', input: 1 }]], Réunir: [[{ node: 'Résumer' }]],
    }) },
    { dossier: O, flow: flux('revue-semaine', 'Revue de la semaine', 'Chaque dimanche à 18 h, une note de revue de la semaine dans Thot.', true, [
      planning('Chaque dimanche', dimanche('18:00')), { name: 'Attention', type: 'saga.attention', params: {} }, { name: 'Regrouper', type: 'données.regrouper', params: { champ: 'points' } },
      demander('Fais une revue de la semaine en 10 lignes au plus à partir de : {{ $json.points }}', 'non', 'Rédiger'),
      { name: 'Ranger', type: 'saga.écrire', params: { mode: 'créer', titre: 'Revue de la semaine du {{ $today }}', type: 'note', note: '', contenu: '{{ $json.réponse }}' } },
    ]) },
    { dossier: O, flow: flux('rdv-semaine', 'Rendez-vous de la semaine', 'Chaque lundi à 8 h, les rendez-vous à venir.', true, [
      planning('Chaque lundi', lundi('08:00')), action('Agenda', 'frigg', 'agenda'),
      demander(`Rendez-vous : ${texte('Agenda')}\nDonne les rendez-vous de la semaine à venir, un par ligne. ${RIEN}`),
    ]) },
  ];
}
