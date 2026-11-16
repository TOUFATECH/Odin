// La maquette de l'interface d'Odin lui-même : Discussion, Cerveau, Applis, Plus (Automatisations, Activité,
// Compétences, Tâches planifiées, Décisions) et toutes les rubriques des Réglages.
// « Aujourd'hui » (Accueil) et « Maison » (Home Assistant) ont déjà leurs thèmes : la maquette n'y touche pas.
const F = (w, t, f, s) => [`form:${w}`, t, f, s], X = (w, t, x, tone) => [`text:${w}`, t, x, tone], K = (w, t, i) => [`kv:${w}`, t, i], L = (w, t, i) => [`list:${w}`, t, i], T = (w, t, c, r) => [`table:${w}`, t, c, r];
const R = (titre, champs, aide, bouton) => [F(8, titre, champs, bouton || "Enregistrer"), X(4, "À savoir", aide)];

export const NAV = [
  { id: "home", label: "Aujourd'hui", court: "Accueil", icon: "home", bas: true, msg: "L'Accueil a déjà son thème : cette maquette n'y touche pas." },
  { id: "chat", label: "Discussion", icon: "chat", bas: true },
  { id: "brain", label: "Cerveau", icon: "brain", bas: true },
  { id: "net", label: "Maison", icon: "net", msg: "La Maison (Home Assistant) a déjà ses thèmes : cette maquette n'y touche pas." },
  { id: "apps", label: "Applis", icon: "apps", bas: true },
  { id: "plus", label: "Plus", icon: "plus", bas: true },
  { id: "settings", label: "Réglages", icon: "regl" },
];

/** Les vues de l'interface. `applis` : [identifiant, nom, lien de la maquette] pour la grille des applis, par famille. */
export function vues(applis) {
  const fam = (f) => applis.filter((a) => a[3] === f).map((a) => [a[0], a[1], a[2]]);
  return [
    { id: "chat", name: "Discussion", what: "Odin répond ici ; les validations apparaissent dans le fil.", primary: "Nouvelle discussion", tabs: { "Fil": [
      L(4, "Conversations", [["Sauvegarde du NAS", "à l'instant"], ["Site Kana-Endabou", "hier"], ["Pare-feu de la box", "12/11"], ["Devis Garage Soula", "10/11"]]),
      ["chat:8", "Sauvegarde du NAS", [["u", "Sauvegarde le NAS ce soir et préviens-moi si ça rate."], ["o", "C'est prévu : Phénix sauvegarde le NAS à 22 h, Arche relit la copie, et je t'écris sur Telegram s'il y a une erreur.", "Plan en 3 étapes · rien n'est lancé avant ton accord"], ["o", "Je peux aussi éteindre le NAS après la sauvegarde. Tu valides ?", "Validation demandée"]], "Écris à Odin, ou maintiens le micro"],
      ["actions:12", "Validation demandée", ["Valider", "Refuser", "Voir le détail"]] ] } },
    { id: "brain", name: "Cerveau", what: "Ce qu'Odin sait : tes notes, ses souvenirs et les liens entre eux.", primary: "Nouvelle note", kpis: ["Notes|1 248", "Liens|3 902", "Neurones actifs|212|g", "À confirmer|14|w"], tabs: {
      "Graphe": [["graph:8", "Le graphe des Moires", [["Toi"], ["NAS", "g", 3], ["Sites", "", 3], ["Clients", "", 2], ["Maison", "", 2], ["Sauvegardes", "g", 1], ["Box"], ["Projets", "w", 1], ["Journal"]]], K(4, "NAS", [["Genre", "Machine"], ["Liens", "12"], ["Force", "!g forte"], ["Dernier rappel", "à l'instant"], ["Source", "balayage du réseau"]])],
      "Notes": [L(4, "Dossiers", [["Projets", "38 notes"], ["Clients", "112 notes"], ["Maison", "64 notes"], ["Journal", "410 notes"]]), ["doc:8", "Note", ["Installation du NAS", "Le NAS tourne sous Odin OS. Les disques sont en miroir, voir [[Pyramide]] et [[Phénix]].", "À faire : brancher l'onduleur et tester une coupure."]]],
      "Neurones": [["courbe:8", "Activité des liens", [["Influx", "", [12, 18, 14, 22, 30, 26, 34, 28, 22, 26, 31, 24]], ["Oubli", "w", [4, 4, 5, 5, 4, 6, 5, 5, 6, 5, 4, 5]]], ""], L(4, "Consolidation de la nuit", [["212 liens renforcés", "ceux que tu as utilisés"], ["38 liens affaiblis", "pas revus depuis 30 jours"], ["3 liens appris", "sans toucher à tes notes"]])],
      "Mémoire": [T(12, "Souvenirs", ["Souvenir", "D'où", "Confiance", "Appris le"], [["Le NAS s'appelle Nébuleuse-01", "balayage", "!g sûr", "14/11"], ["Sauvegardes le dimanche à 2 h", "dit par toi", "!g sûr", "02/11"], ["Le client Kana préfère WhatsApp", "déduit", "!w à confirmer", "10/11"]])] } },
    { id: "apps", name: "Applis", what: "Toutes les applis d'Odin, par famille. Touche une appli pour ouvrir sa maquette.", primary: "Ouvrir le store", tabs: {
      "Applications": [["apps:12", "Données", fam("Données")], ["apps:12", "Machines", fam("Machines")], ["apps:12", "Sécurité", fam("Sécurité")], ["apps:12", "Accès", fam("Accès")], ["apps:12", "Maison et médias", fam("Maison")]],
      "Carte": [["graph:12", "Les applis et leurs liens", [["Odin"], ["Données", "", 4], ["Machines", "g", 3], ["Sécurité", "b", 3], ["Accès", "w", 2], ["Maison", "", 3]]]] } },
    { id: "plus", name: "Plus", what: "Le reste d'Odin.", tabs: { "Tout": [["liens:12", "Ouvrir", [["flows", "Automatisations"], ["missions", "Activité"], ["skills", "Compétences"], ["jobs", "Tâches planifiées"], ["audit", "Décisions"], ["settings", "Réglages"]]]] } },
    { id: "flows", nav: "plus", name: "Automatisations", what: "Ce qu'Odin fait tout seul, étape par étape.", primary: "Nouvelle automatisation", tabs: { "Flux": [
      ["flow:12", "Sauvegarde du dimanche", [["Chaque dimanche 2 h", "Déclencheur", "g"], ["Phénix · sauvegarder", "NAS, sites, bases"], ["Arche · vérifier", "Relire chaque copie"], ["Si une erreur", "Condition", "w"], ["Telegram · prévenir", "Message à toi"]]],
      T(12, "Toutes", ["Nom", "Déclencheur", "Dernier passage", "État"], [["Sauvegarde du dimanche", "dim. 2 h", "09/11", "!g active"], ["Rapport des sites", "chaque matin 7 h", "aujourd'hui", "!g active"], ["Arrosage", "si pas de pluie", "—", "!w en pause"]])] } },
    { id: "missions", nav: "plus", name: "Activité", what: "Tout ce qu'Odin fait ou a fait : état, étapes, coût, sous-agents.", kpis: ["En cours|2|w", "Terminées aujourd'hui|14|g", "Coût du jour|0,42 €", "Sous-agents|3"], tabs: { "Missions": [
      ["cards:12", "En cours", [["Mettre à jour les sites", "étape 3 sur 5 · essais", "!w 60 %", 60, ["Voir", "Arrêter"]], ["Ranger les photos", "étape 1 sur 2", "!w 20 %", 20, ["Voir", "Arrêter"]]]],
      T(12, "Historique", ["Quand", "Mission", "Origine", "État", "Étapes", "Coût"], [["06:02", "Briefing du matin", "planifiée", "!g finie", "5", "0,02 €"], ["02:00", "Sauvegarde", "planifiée", "!g finie", "3", "0,00 €"], ["hier", "Audit du site Kana", "toi", "!g finie", "12", "0,31 €"], ["hier", "Mise à jour de n8n", "Odin", "!b échec", "2", "0,01 €"]])] } },
    { id: "skills", nav: "plus", name: "Compétences", what: "Ce qu'Odin sait faire, et ce qu'il propose d'apprendre.", primary: "Nouvelle compétence", tabs: { "Compétences": [
      ["cards:12", "Actives", [["Sauvegarder un site", "14 usages", "!g active"], ["Créer une VM", "9 usages", "!g active"], ["Devis PDF", "22 usages", "!g active"], ["Diagnostic Wi-Fi", "31 usages", "!g active"]]],
      L(12, "Brouillons à valider", [["Clip vertical", "appris en te regardant faire 3 fois", "!w à valider"], ["Nettoyer les journaux", "proposé après une alerte disque", "!w à valider"]])] } },
    { id: "jobs", nav: "plus", name: "Tâches planifiées", what: "Ce qui est prévu, et quand.", primary: "Nouvelle tâche", tabs: { "Tâches": [
      T(12, "Prévu", ["Tâche", "Rythme", "Prochain passage", "Dernier", "État"], [["Briefing du matin", "chaque jour 7 h", "demain 7 h", "!g fait", "active"], ["Sauvegarde", "dimanche 2 h", "22/11", "!g fait", "active"], ["Veille Pharos", "vendredi 14 h", "20/11", "!g fait", "active"], ["Mises à jour", "mercredi 9 h", "18/11", "!w partiel", "active"]])] } },
    { id: "audit", nav: "plus", name: "Décisions", what: "Pourquoi Odin a fait, demandé ou refusé chaque chose.", tabs: { "Journal": [
      T(12, "Décisions", ["Quand", "Demande", "Décision", "Pourquoi"], [["06:10", "Bannir 185.220.101.4", "!g fait seul", "règle : 5 essais ratés"], ["06:02", "Effacer devis.exe", "!w demandé", "effacer est irréversible"], ["hier", "Ouvrir le port 22", "!b refusé", "interdit par ta politique"], ["hier", "Mettre à jour n8n", "!g fait seul", "mise à jour mineure"]])] } },
    { id: "settings", name: "Réglages", what: "Tout se règle ici. Les rubriques sont toutes à la même taille.", secs: {
      "Modèle": R("Le modèle d'IA", [["Fournisseur", "s", ["Anthropic", "OpenAI", "Local (Ollama)"]], ["Modèle", "s", ["Le plus capable", "Le plus rapide", "Le moins cher"]], ["Clé", "t", "••••••••••••"], ["Mode économe", "o", true]], "Sans modèle, Odin marche quand même pour tout ce que Logos comprend."),
      "Telegram": R("Telegram", [["Jeton du bot", "t", "••••••••••••"], ["Ton identifiant", "t", "12345678"], ["Notes vocales", "o", true]], "Odin n'écoute que ton compte. Les autres messages sont ignorés."),
      "Messageries": R("Messageries", [["WhatsApp", "o", true], ["SMS (Twilio)", "o", false], ["Signal", "o", false], ["Numéro par défaut", "t", "+262 …"]], "Chaque messagerie se règle à part, avec un essai d'envoi."),
      "Mises à jour": R("Mises à jour d'Odin", [["Vérifier", "s", ["Chaque nuit", "Chaque semaine", "Jamais"]], ["Installer toute seule", "o", false], ["Canal", "s", ["Stable", "Bêta"]]], "Version 1.36 installée. Une sauvegarde est faite avant chaque mise à jour.", "Vérifier maintenant"),
      "Voix": R("Voix", [["Mot de réveil", "t", "Odin"], ["Voix", "s", ["Française 1", "Française 2"]], ["Écoute sur la machine", "o", true], ["Répondre à voix haute", "o", true]], "Rien de ce que tu dis ne quitte la machine si l'écoute locale est allumée."),
      "Écriture": R("Écriture", [["Ton", "s", ["Simple", "Soutenu", "Très court"]], ["Corriger mes fautes", "o", true], ["Tutoiement", "o", true]], "Odin écrit dans ta façon d'écrire quand il rédige à ta place."),
      "Autonomie": R("Autonomie", [["Mode", "s", ["Demander avant d'agir", "Agir seul sur le sûr", "Tout seul"]], ["Budget par jour", "t", "2,00 €"], ["Travailler la nuit", "o", true], ["Effacer sans demander", "o", false]], "Tout ce qui est irréversible ou payant demande toujours ton accord."),
      "Droits et machines": R("Droits et machines", [["Coffre des secrets", "s", ["Clé de la machine", "Mot de passe maître"]], ["Machine par défaut", "s", ["Ce PC", "NAS", "pve1"]], ["Commandes administrateur", "o", false]], "Les secrets ne sont jamais en clair sur le disque."),
      "Réseau": R("Réseau", [["Plage à balayer", "t", "192.168.1.0/24"], ["Balayage", "s", ["Toutes les heures", "Chaque nuit"]], ["Prévenir d'un nouvel appareil", "o", true]], "Horus tient l'inventaire de ce qui est branché."),
      "Surveillance": R("Surveillance", [["Appareils importants", "t", "NAS, box, caméra portail"], ["Vérifier toutes les", "s", ["5 minutes", "1 minute", "15 minutes"]], ["Alertes sur Telegram", "o", true]], "Une alerte dit toujours quoi, où, et quoi faire."),
      "Proxmox": R("Proxmox", [["Adresse", "t", "https://pve1.maison:8006"], ["Jeton", "t", "••••••••••••"], ["Lecture seule", "o", true]], "Hydre montre ensuite toutes tes machines virtuelles."),
      "Recherche": R("Recherche", [["Moteur", "s", ["SearXNG", "Brave", "DuckDuckGo"]], ["Adresse SearXNG", "t", "http://localhost:8080"], ["Citer les sources", "o", true]], "Pythie utilise ces moteurs pour répondre avec des sources."),
      "Personnes": R("Personnes", [["Qui parle à Odin", "s", ["Toi seulement", "La famille", "Les groupes choisis"]], ["Reconnaître la voix", "o", false], ["Anniversaires", "o", true]], "Chaque personne a son compte dans Persona."),
      "Sauvegarde": R("Sauvegarde d'Odin", [["Où", "t", "/sauvegardes/odin"], ["Rythme", "s", ["Chaque nuit", "Chaque semaine"]], ["Mot de passe", "t", "••••••••"], ["2e site", "o", true]], "Notée active seulement une fois enregistrée et essayée.", "Enregistrer et essayer"),
      "Entretien": R("Entretien", [["Ménage des journaux", "s", ["30 jours", "7 jours", "1 an"]], ["Essais automatiques", "o", true], ["Rapport de la semaine", "o", true]], "Odin se vérifie lui-même chaque nuit."),
      "Maison": [X(12, "Maison", "La Maison (Home Assistant) a déjà ses thèmes : cette maquette n'y touche pas.", "w")],
      "Venus": R("Vénus", [["Adresse", "t", "http://localhost:8501"], ["Langue des films", "s", ["Français d'abord", "Version originale"]], ["Sous-titres", "o", true]], "Films, séries et chaînes sur tous tes écrans."),
      "Réveil": R("Réveil", [["Heure", "t", "06:30"], ["Jours", "s", ["Lundi à vendredi", "Tous les jours"]], ["Lire le briefing", "o", true], ["Lumière douce avant", "o", true]], "Le réveil sonne sur l'enceinte de la chambre."),
      "Apparence": [["themes:12", "Les thèmes d'Odin"], F(12, "Automatique", [["Suivre l'heure et la météo", "o", true], ["Thèmes d'événements", "o", true], ["Taille du texte", "s", ["Normale", "Grande", "Très grande"]]], "Enregistrer")],
      "Mail": R("Mail", [["Adresse", "t", "toi@exemple.com"], ["Serveur", "t", "imap.exemple.com"], ["Odin peut envoyer", "o", false]], "Le contenu des mails ne passe jamais par le modèle sans ton accord."),
      "Agenda": R("Agenda", [["Adresse iCal", "t", "https://…/agenda.ics"], ["Rappels", "s", ["La veille", "1 heure avant", "Aucun"]], ["Créer des rendez-vous", "o", true]], "Chronos et le briefing du matin s'en servent."),
      "Documents": R("Documents", [["Dossier", "t", "/srv/fichiers/Documents"], ["Lire les PDF scannés", "o", true], ["Ranger tout seul", "o", false]], "Champollion lit, Nébuleuse range."),
      "Personnalité": R("Personnalité", [["Caractère", "s", ["Calme", "Joueur", "Sérieux"]], ["Humeurs visibles", "o", true], ["Sons", "o", true], ["Proactif", "o", true]], "Odin a toujours les yeux blancs, sans bouche ni sourcils."),
      "Accès": R("Accès", [["Compte Odin", "t", "toi"], ["Double vérification", "s", ["Clé d'accès", "Application", "Aucune"]], ["Accès de l'extérieur", "s", ["VPN seulement", "Tunnel Cloudflare", "Aucun"]]], "Une seule connexion ouvre toutes les applis."),
      "＋ Ajouter": [["cards:12", "Fonctions à ajouter", [["Proxmox", "voir tes machines virtuelles", "", null, ["Ajouter"]], ["Signal", "une messagerie de plus", "", null, ["Ajouter"]], ["Onduleur", "prévenir en cas de coupure", "", null, ["Ajouter"]]]]],
    } },
  ];
}
