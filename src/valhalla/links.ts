// Les liens entre les applis d'Odin : qui alimente qui (réflexes automatiques, toujours actifs),
// les usages de prédilection (« pour ce besoin, prends celle-ci, puis celle-là »), et des modèles
// d'automatisations Draupnir qui relient plusieurs applis. Sert aussi à expliquer « qui fait quoi ».

import type { Valhalla } from './service.ts';
import { horn } from './modules/bragi.ts';
import { observe } from './modules/ullr.ts';
import { SENSORS } from './ullr/incidents.ts';

/**
 * Un lien entre deux applis. Tous sont automatiques : rien à activer.
 * `kind` : « réflexe » (une appli en déclenche une autre), « soin » (Odin répare tout seul ; au niveau
 * « prudent » il propose seulement), « donnée » (une appli alimente l'autre en continu).
 */
export interface Link { from: string; to: string; when: string; does: string; auto: true; kind: 'réflexe' | 'soin' | 'donnée' }
export const LINKS: Link[] = [
  { from: 'loki', to: 'garmr', when: 'un pirate tape un mot de passe ou une commande dans un piège', does: 'son adresse est bannie de tes vrais services', auto: true, kind: 'réflexe' },
  { from: 'loki', to: 'ullr', when: 'un pirate fait télécharger un fichier à un piège', does: 'le fichier est gardé à l\'écart (jamais exécuté) et analysé ; le verdict part avec l\'alerte, et l\'attaque rejoint les incidents', auto: true, kind: 'réflexe' },
  { from: 'geri', to: 'garmr', when: 'une connexion part vers une adresse malveillante connue', does: 'l\'adresse est bannie 24 h', auto: true, kind: 'réflexe' },
  { from: 'skogul', to: 'ullr', when: 'un processus suspect tourne', does: 'son programme est analysé ; alerte critique si Ullr confirme, et le signal rejoint les incidents', auto: true, kind: 'réflexe' },
  { from: 'ullr', to: 'forseti', when: 'une menace est trouvée', does: 'l\'alerte rejoint le fil commun et part sur ta messagerie', auto: true, kind: 'donnée' },
  { from: 'sindri', to: 'forseti', when: 'une sauvegarde échoue', does: 'alerte haute sur ta messagerie', auto: true, kind: 'donnée' },
  { from: 'eir', to: 'forseti', when: 'disque, mémoire ou processeur saturés', does: 'alerte avec la cause probable', auto: true, kind: 'donnée' },
  { from: 'naglfar', to: 'forseti', when: 'un conteneur s\'arrête tout seul', does: 'alerte', auto: true, kind: 'donnée' },
  { from: 'ymir', to: 'forseti', when: 'une machine virtuelle s\'arrête ou un nœud sature', does: 'alerte', auto: true, kind: 'donnée' },
  { from: 'hermod', to: 'forseti', when: 'une machine du parc disparaît du réseau', does: 'alerte', auto: true, kind: 'donnée' },
  { from: 'himinbjorg', to: 'midgard', when: 'mouvement détecté aux heures surveillées', does: 'la scène « Alerte intrusion » est lancée si elle existe', auto: true, kind: 'réflexe' },
  { from: 'forseti', to: 'bragi', when: 'alerte critique', does: 'Gjallarhorn la dit à voix haute sur les enceintes (si activé)', auto: true, kind: 'réflexe' },
  { from: 'appareils', to: 'midgard', when: 'un appareil change d\'état', does: 'le tableau de bord de la maison est à jour ; les scènes le commandent', auto: true, kind: 'donnée' },
  { from: 'brokkr', to: 'appareils', when: 'un module est branché sur Odin', does: 'il apparaît dans Appareils puis Midgard', auto: true, kind: 'donnée' },
  { from: 'frigg', to: 'runes', when: 'une réservation arrive', does: 'la fiche du client est créée ou mise à jour dans la base « Clients »', auto: true, kind: 'réflexe' },
  { from: 'gjoll', to: 'brisingamen', when: 'un nouvel accès VPN est créé', does: 'sa configuration est rangée dans le coffre chiffré', auto: true, kind: 'réflexe' },
  { from: 'gjoll', to: 'vidarr', when: 'un appareil du VPN coche « DNS d\'Odin »', does: 'il résout par Víðarr, qui le connaît sous son nom : pubs et sites dangereux bloqués aussi hors de la maison, ses requêtes au journal', auto: true, kind: 'réflexe' },
  { from: 'vidarr', to: 'forseti', when: 'un appareil demande un site dangereux (virus, hameçonnage)', does: 'la demande est bloquée et une alerte haute part sur ta messagerie, avec le conseil d\'analyser l\'appareil', auto: true, kind: 'donnée' },
  { from: 'vidarr', to: 'forseti', when: 'une machine inonde le DNS (boucle, virus, attaque)', does: 'ses requêtes sont ignorées un moment et tu es prévenu', auto: true, kind: 'donnée' },
  { from: 'vidarr', to: 'forseti', when: 'le DNS n\'arrive plus à joindre Internet (box ou serveurs amont en panne)', does: 'alerte haute avec les serveurs en cause ; Víðarr bascule seul sur ses serveurs de secours', auto: true, kind: 'donnée' },
  { from: 'vidarr', to: 'forseti', when: 'un appareil jamais vu reçoit une adresse du DHCP d\'Odin', does: 'tu es prévenu avec son nom, son adresse et sa MAC ; son nom répond aussitôt dans le DNS', auto: true, kind: 'donnée' },
  { from: 'gjoll', to: 'forseti', when: 'un accès VPN arrive à sa date de fin', does: 'l\'appareil est coupé du tunnel tout seul et tu es prévenu', auto: true, kind: 'donnée' },
  { from: 'bragi', to: 'freyja', when: 'tu dis « mets … sur la télé » (ordre à la voix)', does: 'Bragi transcrit, Huginn comprend sans IA, Freyja lance le titre', auto: true, kind: 'réflexe' },
  { from: 'midgard', to: 'freyja', when: 'une scène contient l\'étape « freyja.regarder = titre »', does: 'les lumières se règlent puis Freyja ouvre le titre', auto: true, kind: 'réflexe' },
  { from: 'kvasir', to: 'runes', when: 'une appli d\'origine publie une version', does: 'une fiche dans la base « Évolutions »', auto: true, kind: 'réflexe' },
  { from: 'sindri', to: 'ymir', when: 'un plan de sauvegarde couvre des machines virtuelles (mode Andvari)', does: 'Ymir prend un instantané de chaque machine juste avant la sauvegarde', auto: true, kind: 'réflexe' },
  { from: 'naglfar', to: 'naglfar', when: 'un conteneur s\'arrête tout seul', does: 'Odin le relance (une fois par heure au plus) et te prévient : « garde » ou « annule »', auto: true, kind: 'soin' },
  { from: 'ymir', to: 'ymir', when: 'une machine virtuelle s\'arrête toute seule', does: 'Odin la relance (une fois par heure au plus) et te prévient', auto: true, kind: 'soin' },
  { from: 'sindri', to: 'sindri', when: 'une sauvegarde échoue', does: 'Odin la relance une fois, dix minutes plus tard', auto: true, kind: 'soin' },
  // Ullr relie ce que voient toutes les applis : un signal seul ne dit rien, plusieurs qui se recoupent font un incident.
  ...SENSORS.filter((q) => !['loki', 'skogul'].includes(q.app)).map((q): Link => ({ from: q.app, to: 'ullr', when: q.when, does: 'le signal rejoint les incidents d\'Ullr : s\'il recoupe ceux d\'une autre appli, un incident est ouvert avec son score et sa chronologie', auto: true, kind: 'donnée' })),
  { from: 'idunn', to: 'forseti', when: 'un site tombe, un déploiement ou des tests échouent, un certificat arrive à sa fin', does: 'alerte sur ta messagerie, avec le lien pour aller voir', auto: true, kind: 'donnée' },
  { from: 'idunn', to: 'idunn', when: 'un déploiement arrive en production', does: 'Odin essaie le site (pages, liens, erreurs affichées) ; si quelque chose casse, tu es prévenu et il te propose de revenir en arrière', auto: true, kind: 'soin' },
  { from: 'ullr', to: 'garmr', when: 'un incident sérieux implique une adresse extérieure', does: 'l\'adresse est bannie 24 h au pare-feu (manip annulable)', auto: true, kind: 'réflexe' },
  { from: 'ullr', to: 'saga', when: 'un incident sérieux est ouvert, s\'aggrave ou est classé', does: 'une note datée dans le Cerveau raconte l\'incident : chronologie, score, ce qui a été fait', auto: true, kind: 'réflexe' },
];

/** Usages de prédilection : besoin → chaîne d'applis. */
export const USAGES: Array<{ need: string; chain: string[]; why: string }> = [
  { need: 'protéger un serveur ouvert sur Internet', chain: ['loki', 'garmr', 'geri', 'forseti'], why: 'Loki attire et repère les pirates, Garmr les bannit, Geri surveille ce qui sort, Forseti rassemble tout.' },
  { need: 'savoir si un fichier est dangereux', chain: ['ullr'], why: 'empreintes connues, règles et heuristiques, quarantaine.' },
  { need: 'surveiller la santé d\'une machine', chain: ['eir', 'skogul', 'forseti'], why: 'Eir mesure, Skögul regarde les processus, Forseti alerte.' },
  { need: 'ne jamais perdre ses fichiers', chain: ['sindri', 'forseti'], why: 'sauvegardes chiffrées dédoublonnées, alerte si une sauvegarde échoue.' },
  { need: 'accéder à la maison de l\'extérieur', chain: ['gjoll', 'hermod'], why: 'Gjöll crée le VPN, Hermóðr réveille et pilote les machines.' },
  { need: 'bloquer les pubs et les sites dangereux pour toute la maison', chain: ['vidarr', 'gjoll', 'forseti'], why: 'Víðarr filtre le DNS de la maison, Gjöll l\'étend aux appareils en déplacement, Forseti alerte si un appareil cherche un site dangereux.' },
  { need: 'piloter la maison', chain: ['brokkr', 'appareils', 'midgard', 'bragi'], why: 'Brokkr branche les modules, Appareils les connaît, Midgard les réunit en pièces et scènes, Bragi parle.' },
  { need: 'surveiller la maison', chain: ['himinbjorg', 'midgard', 'bragi'], why: 'caméras et mouvements, scène d\'alerte, annonce à voix haute.' },
  { need: 'regarder un film ou la télé', chain: ['freyja', 'midgard', 'bragi'], why: 'Freyja lance le titre sur l\'écran, Midgard règle l\'ambiance, Bragi te comprend à la voix.' },
  { need: 'gérer des rendez-vous clients', chain: ['frigg', 'runes', 'draupnir'], why: 'Frigg prend les rendez-vous, Runes garde les fiches clients, Draupnir envoie les rappels.' },
  { need: 'faire tourner des services', chain: ['naglfar', 'ymir', 'sindri'], why: 'conteneurs, machines virtuelles, et leurs sauvegardes.' },
  { need: 'gérer un site web', chain: ['idunn', 'forseti', 'ullr'], why: 'Idunn surveille, essaie, déploie et met à jour ; Forseti t\'alerte ; Ullr relie un changement de DNS, de certificat ou de page d\'accueil pour reconnaître un détournement.' },
  { need: 'garder ses mots de passe', chain: ['brisingamen'], why: 'coffre chiffré, codes à usage unique, vérification des fuites.' },
  { need: 'organiser ses idées et projets', chain: ['saga', 'runes', 'draupnir'], why: 'Saga relie les notes, Runes en fait des bases, Draupnir automatise.' },
];

/** Branche les réflexes intégrés (ceux qui ne sont pas déjà dans les modules eux-mêmes). */
export function wireReflexes(v: Valhalla, o: { retryMs?: number } = {}): () => void {
  const lastCare = new Map<string, number>(), timers = new Set<ReturnType<typeof setTimeout>>();
  /**
   * Un « soin » : Odin répare lui-même (action simple et annulable), au plus une fois par heure pour la même chose.
   * Niveau « prudent » : il ne touche à rien et te dit seulement ce qu'il ferait.
   */
  const care = (key: string, module: string, action: string, input: Record<string, unknown>, why: string, say: string): void => {
    const now = Date.now(); if (now - (lastCare.get(key) ?? 0) < 3600_000) return;
    lastCare.set(key, now);
    if (v.autonomy() === 'prudent') { v.alert(module, { level: 'moyenne', title: `Je peux réparer : ${say}`, detail: `${why}. En niveau « Me demander », je ne fais rien seul : dis-le-moi (« ${say} ») ou passe en « Équilibré ».`, key: `soin:${key}` }); return; }
    void v.act(module, action, input, { auto: true, by: 'odin', why });
  };
  const hasUllr = v.modules().some((m) => m.id === 'ullr');
  const onEvent = (e: { module: string; type: string; data: Record<string, unknown> }) => {
    // Ullr relie les signaux de toutes les applis en incidents (jamais bloquant pour le reste).
    if (hasUllr) try { observe(v.ctx('ullr'), e); } catch (err) { console.error(`[ullr] incident : ${(err as Error).message}`); }
    if (e.module === 'skogul' && e.type === 'suspect' && e.data.pid) {
      void v.act('ullr', 'fichier', { chemin: `/proc/${Number(e.data.pid)}/exe` }, { auto: true, by: 'réflexe' }).then((r) => { if (r.ok && /⚠/.test(r.text)) v.alert('ullr', { level: 'critique', title: 'Processus suspect confirmé par Ullr', detail: r.text.slice(0, 500), key: `proc:${String(e.data.pid)}` }); });
    }
    if (e.module === 'himinbjorg' && e.type === 'mouvement' && e.data['surveillé'] !== false) {
      const sc = ((v.ctx('midgard').settings.scenes as Array<{ name: string }> | undefined) ?? []).find((x) => /intrusion/i.test(x.name));
      if (sc) void v.act('midgard', 'scene', { scene: sc.name }, { auto: true, by: 'réflexe', why: `mouvement sur la caméra ${String(e.data['caméra'] ?? '')} aux heures surveillées` });
    }
    // Frigg → Runes : chaque réservation crée ou met à jour la fiche du client.
    if (e.module === 'frigg' && e.type === 'reservation' && e.data.name) void v.act('runes', 'client', { nom: String(e.data.name), contact: String(e.data.contact ?? ''), rendez_vous: String(e.data.start ?? ''), prestation: String(e.data.service ?? '') }, { auto: true, by: 'réflexe', why: 'nouvelle réservation' });
    // Idunn : chaque mise en production est essayée ; un essai raté propose le retour en arrière (action grave : jamais lancée seule).
    if (e.module === 'idunn' && e.type === 'deploiement_ok' && e.data.production === true && e.data.site) {
      const name = String(e.data.site);
      void v.act('idunn', 'tester', { site: name }, { auto: true, by: 'réflexe', why: 'nouveau déploiement en production' }).then((r) => { if (r.ok && (r.data as { ok?: boolean } | undefined)?.ok === false) v.alert('idunn', { level: 'haute', title: `${name} : le nouveau déploiement casse quelque chose`, detail: `${r.text.slice(0, 600)}\nPour revenir à la version d'avant : « reviens à la version précédente du site ${name} ».`, key: `essai:${name}` }); });
    }
    // Soins : ce qu'Odin répare tout seul.
    if (e.module === 'naglfar' && e.type === 'conteneur_arrete' && e.data.conteneur) care(`ct:${String(e.data.conteneur)}`, 'naglfar', 'demarrer', { conteneur: String(e.data.conteneur) }, `le conteneur ${String(e.data.conteneur)} s'est arrêté tout seul`, `démarre le conteneur ${String(e.data.conteneur)}`);
    if (e.module === 'ymir' && e.type === 'vm_arretee' && e.data.vmid) care(`vm:${String(e.data.vmid)}`, 'ymir', 'demarrer', { vmid: Number(e.data.vmid) }, `la machine virtuelle ${String(e.data.nom ?? e.data.vmid)} s'est arrêtée toute seule`, `démarre la machine virtuelle ${String(e.data.vmid)}`);
    if (e.module === 'sindri' && e.type === 'sauvegarde_echec' && e.data.plan) {
      const key = `sv:${String(e.data.plan)}`, now = Date.now(); if (now - (lastCare.get(key) ?? 0) < 6 * 3600_000 || v.autonomy() === 'prudent') return;
      lastCare.set(key, now);
      const t = setTimeout(() => { timers.delete(t); void v.act('sindri', 'sauvegarder', { plan: String(e.data.plan) }, { auto: true, by: 'odin', why: `la sauvegarde « ${String(e.data.plan)} » avait échoué (${String(e.data.erreur ?? '').slice(0, 80)})` }); }, o.retryMs ?? 600_000);
      (t as { unref?: () => void }).unref?.(); timers.add(t);
    }
  };
  const onAlert = (a: { level: string; title: string; module: string }) => { if (a.level === 'critique') void horn(v.ctx('bragi'), `Alerte : ${a.title}`); };
  v.events.on('event', onEvent); v.events.on('alert', onAlert);
  return () => { v.events.off('event', onEvent); v.events.off('alert', onAlert); for (const t of timers) clearTimeout(t); timers.clear(); };
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
