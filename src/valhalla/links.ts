// Les liens entre les applis d'Odin : qui alimente qui (réflexes automatiques, toujours actifs),
// les usages de prédilection (« pour ce besoin, prends celle-ci, puis celle-là »), et des modèles
// d'automatisations Draupnir qui relient plusieurs applis. Sert aussi à expliquer « qui fait quoi ».

import type { Valhalla } from './service.ts';
import { horn } from './modules/bragi.ts';

export interface Link { from: string; to: string; when: string; does: string; auto: boolean }
/** Réflexes intégrés (auto) et liens d'usage (manuels, proposés). */
export const LINKS: Link[] = [
  { from: 'loki', to: 'garmr', when: 'un pirate tape un mot de passe ou une commande dans un piège', does: 'son adresse est bannie de tes vrais services', auto: true },
  { from: 'loki', to: 'ullr', when: 'un pirate fait télécharger un fichier à un piège', does: 'le fichier est gardé à l\'écart (jamais exécuté) et analysé ; le verdict part avec l\'alerte', auto: true },
  { from: 'geri', to: 'garmr', when: 'une connexion part vers une adresse malveillante connue', does: 'l\'adresse est bannie 24 h', auto: true },
  { from: 'skogul', to: 'ullr', when: 'un processus suspect tourne', does: 'son programme est analysé', auto: true },
  { from: 'ullr', to: 'forseti', when: 'une menace est trouvée', does: 'l\'alerte rejoint le fil commun et part sur ta messagerie', auto: true },
  { from: 'sindri', to: 'forseti', when: 'une sauvegarde échoue', does: 'alerte haute sur ta messagerie', auto: true },
  { from: 'eir', to: 'forseti', when: 'disque, mémoire ou processeur saturés', does: 'alerte avec la cause probable', auto: true },
  { from: 'naglfar', to: 'forseti', when: 'un conteneur s\'arrête tout seul', does: 'alerte', auto: true },
  { from: 'ymir', to: 'forseti', when: 'une machine virtuelle s\'arrête ou un nœud sature', does: 'alerte', auto: true },
  { from: 'hermod', to: 'forseti', when: 'une machine du parc disparaît du réseau', does: 'alerte', auto: true },
  { from: 'himinbjorg', to: 'midgard', when: 'mouvement détecté aux heures surveillées', does: 'la scène « Alerte intrusion » est lancée si elle existe', auto: true },
  { from: 'forseti', to: 'bragi', when: 'alerte critique', does: 'Gjallarhorn la dit à voix haute sur les enceintes (si activé)', auto: true },
  { from: 'appareils', to: 'midgard', when: 'un appareil change d\'état', does: 'le tableau de bord se met à jour ; les scènes peuvent réagir', auto: true },
  { from: 'brokkr', to: 'appareils', when: 'un module est branché sur Odin', does: 'il apparaît dans Appareils puis Midgard', auto: true },
  { from: 'frigg', to: 'runes', when: 'une réservation arrive', does: 'fiche client dans la base Clients (modèle d\'automatisation)', auto: false },
  { from: 'gjoll', to: 'brisingamen', when: 'un nouvel accès VPN est créé', does: 'sa configuration peut être rangée dans le coffre', auto: false },
  { from: 'freyja', to: 'bragi', when: 'tu demandes un film ou une chaîne à voix haute', does: 'Bragi comprend, Freyja lance sur la télé', auto: false },
  { from: 'midgard', to: 'freyja', when: 'la scène « Film » est lancée', does: 'lumières tamisées puis Freyja ouvre le titre demandé (modèle d\'automatisation)', auto: false },
  { from: 'kvasir', to: 'runes', when: 'une appli d\'origine publie une version', does: 'une fiche dans la base « Évolutions »', auto: true },
  { from: 'sindri', to: 'ymir', when: 'mode Andvari', does: 'sauvegarde des machines virtuelles', auto: false },
];

/** Usages de prédilection : besoin → chaîne d'applis. */
export const USAGES: Array<{ need: string; chain: string[]; why: string }> = [
  { need: 'protéger un serveur ouvert sur Internet', chain: ['loki', 'garmr', 'geri', 'forseti'], why: 'Loki attire et repère les pirates, Garmr les bannit, Geri surveille ce qui sort, Forseti rassemble tout.' },
  { need: 'savoir si un fichier est dangereux', chain: ['ullr'], why: 'empreintes connues, règles et heuristiques, quarantaine.' },
  { need: 'surveiller la santé d\'une machine', chain: ['eir', 'skogul', 'forseti'], why: 'Eir mesure, Skögul regarde les processus, Forseti alerte.' },
  { need: 'ne jamais perdre ses fichiers', chain: ['sindri', 'forseti'], why: 'sauvegardes chiffrées dédoublonnées, alerte si une sauvegarde échoue.' },
  { need: 'accéder à la maison de l\'extérieur', chain: ['gjoll', 'hermod'], why: 'Gjöll crée le VPN, Hermóðr réveille et pilote les machines.' },
  { need: 'piloter la maison', chain: ['brokkr', 'appareils', 'midgard', 'bragi'], why: 'Brokkr branche les modules, Appareils les connaît, Midgard les réunit en pièces et scènes, Bragi parle.' },
  { need: 'surveiller la maison', chain: ['himinbjorg', 'midgard', 'bragi'], why: 'caméras et mouvements, scène d\'alerte, annonce à voix haute.' },
  { need: 'regarder un film ou la télé', chain: ['freyja', 'midgard', 'bragi'], why: 'Freyja lance le titre sur l\'écran, Midgard règle l\'ambiance, Bragi te comprend à la voix.' },
  { need: 'gérer des rendez-vous clients', chain: ['frigg', 'runes', 'draupnir'], why: 'Frigg prend les rendez-vous, Runes garde les fiches clients, Draupnir envoie les rappels.' },
  { need: 'faire tourner des services', chain: ['naglfar', 'ymir', 'sindri'], why: 'conteneurs, machines virtuelles, et leurs sauvegardes.' },
  { need: 'garder ses mots de passe', chain: ['brisingamen'], why: 'coffre chiffré, codes à usage unique, vérification des fuites.' },
  { need: 'organiser ses idées et projets', chain: ['saga', 'runes', 'draupnir'], why: 'Saga relie les notes, Runes en fait des bases, Draupnir automatise.' },
];

/** Branche les réflexes intégrés (ceux qui ne sont pas déjà dans les modules eux-mêmes). */
export function wireReflexes(v: Valhalla): () => void {
  const onEvent = (e: { module: string; type: string; data: Record<string, unknown> }) => {
    if (e.module === 'skogul' && e.type === 'suspect' && e.data.pid) {
      void v.act('ullr', 'fichier', { chemin: `/proc/${Number(e.data.pid)}/exe` }, { auto: true }).then((r) => { if (r.ok && /⚠/.test(r.text)) v.alert('ullr', { level: 'critique', title: 'Processus suspect confirmé par Ullr', detail: r.text.slice(0, 500), key: `proc:${String(e.data.pid)}` }); });
    }
    if (e.module === 'himinbjorg' && e.type === 'mouvement') {
      const sc = ((v.ctx('midgard').settings.scenes as Array<{ name: string }> | undefined) ?? []).find((x) => /intrusion/i.test(x.name));
      if (sc && v.alerts({ module: 'himinbjorg', limit: 1 })[0]?.at.slice(0, 16) === new Date().toISOString().slice(0, 16)) void v.act('midgard', 'scene', { scene: sc.name }, { auto: true });
    }
  };
  const onAlert = (a: { level: string; title: string; module: string }) => { if (a.level === 'critique') void horn(v.ctx('bragi'), `Alerte : ${a.title}`); };
  v.events.on('event', onEvent); v.events.on('alert', onAlert);
  return () => { v.events.off('event', onEvent); v.events.off('alert', onAlert); };
}

/** Modèles d'automatisations entre applis (Draupnir). */
export function linkTemplates(): Array<{ id: string; name: string; what: string; flow: { name: string; nodes: unknown[]; connections: Record<string, Array<Array<{ node: string }>>> } }> {
  const pos = (i: number): [number, number] => [i * 260, 200];
  return [
    { id: 'mouvement-photo', name: 'Mouvement → photo sur ma messagerie', what: 'Quand Himinbjörg détecte un mouvement, une photo et un message.', flow: { name: 'Mouvement → photo', nodes: [
      { name: 'Mouvement', type: 'déclencheur.module', params: { module: 'Himinbjörg', 'événement': 'mouvement' }, position: pos(0) },
      { name: 'Photo', type: 'module.action', params: { module: 'himinbjorg', action: 'photo', 'entrée': '{"camera":"{{ $json.caméra }}"}' }, position: pos(1) },
      { name: 'Prévenir', type: 'odin.prévenir', params: { texte: '📷 Mouvement sur {{ $node["Mouvement"].json.caméra }}' }, position: pos(2) },
    ], connections: { Mouvement: [[{ node: 'Photo' }]], Photo: [[{ node: 'Prévenir' }]] } } },
    { id: 'reservation-client', name: 'Réservation → fiche client', what: 'Chaque réservation Frigg crée une fiche dans la base Clients de Runes.', flow: { name: 'Réservation → fiche client', nodes: [
      { name: 'Réservation', type: 'déclencheur.module', params: { module: 'Frigg', 'événement': 'reservation' }, position: pos(0) },
      { name: 'Fiche', type: 'runes.ajouter', params: { base: 'Clients', titre: '{{ $json.name }}', 'propriétés': '{"Contact":"{{ $json.contact }}","Dernier rendez-vous":"{{ $json.start }}"}' }, position: pos(1) },
    ], connections: { Réservation: [[{ node: 'Fiche' }]] } } },
    { id: 'sauvegarde-nuit', name: 'Chaque nuit : sauvegarde puis bilan', what: 'Lance les sauvegardes Sindri à 3 h et t\'envoie le bilan.', flow: { name: 'Sauvegarde de nuit', nodes: [
      { name: 'À 3 h', type: 'déclencheur.planning', params: { mode: 'cron', cron: '0 3 * * *' }, position: pos(0) },
      { name: 'Sauvegarder', type: 'module.action', params: { module: 'sindri', action: 'sauvegarder', 'entrée': '{}' }, position: pos(1) },
      { name: 'Bilan', type: 'odin.prévenir', params: { texte: '💾 {{ $json.texte }}' }, position: pos(2) },
    ], connections: { 'À 3 h': [[{ node: 'Sauvegarder' }]], Sauvegarder: [[{ node: 'Bilan' }]] } } },
    { id: 'je-pars', name: 'Je pars : scène + VPN + caméras', what: 'Un webhook (raccourci téléphone) lance la scène « Je pars » et active la surveillance.', flow: { name: 'Je pars', nodes: [
      { name: 'Raccourci', type: 'déclencheur.webhook', params: {}, position: pos(0) },
      { name: 'Scène', type: 'module.action', params: { module: 'midgard', action: 'scene', 'entrée': '{"scene":"Je pars"}' }, position: pos(1) },
      { name: 'Prévenir', type: 'odin.prévenir', params: { texte: '🏠 Maison en mode absence.' }, position: pos(2) },
    ], connections: { Raccourci: [[{ node: 'Scène' }]], Scène: [[{ node: 'Prévenir' }]] } } },
    { id: 'alertes-saga', name: 'Alertes hautes → notes Saga', what: 'Chaque alerte haute ou critique devient une note dans Saga.', flow: { name: 'Alertes → journal', nodes: [
      { name: 'Alerte', type: 'déclencheur.module', params: { module: 'Forseti', 'événement': 'alerte', niveau: 'haute' }, position: pos(0) },
      { name: 'Noter', type: 'saga.écrire', params: { mode: 'créer', titre: 'Alerte {{ $json.appli }} : {{ $json.title }}', type: 'capture', contenu: '{{ $json.niveau }} · {{ $json.appli }} : {{ $json.title }}\n{{ $json.detail }}' }, position: pos(1) },
    ], connections: { Alerte: [[{ node: 'Noter' }]] } } },
  ];
}
