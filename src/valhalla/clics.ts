// Les clics rapides sur Odin (fiche « Clics sur Odin » validée le 13/11/2026) : 1 clic = « Que veux-tu ? »,
// 2 et 3 = rien, de 4 à 100 = une action. C'est toi qui choisis le nombre de chaque action (Réglages → Apparence) ;
// un nombre ne sert qu'à une seule action. Odin pose toujours la question avant de faire (« Je redémarre tout le
// serveur ? ») ; les actions graves passent en plus par Heimdall. Rien ici ne supprime de données.
//   run.act : une action d'appli (module, action) ; run.say : une demande à Odin, avec la page où tu es ;
//   run.fn : un geste d'Odin dans l'interface (se cacher, rire, ouvrir une page, redémarrer…).

export interface ClickAction { id: string; label: string; app: string; ask: string; grave: boolean; def: number | null; run: { act?: [string, string]; say?: string; fn?: string } }
export const CLICK_MIN = 4, CLICK_MAX = 100;

export const CLICK_CATALOG: ClickAction[] = [
  // 4 clics : Alchimie (maquette validée le 14/11/2026) ; le redémarrage du serveur n'a plus de nombre au départ (à choisir).
  { id: 'alchimie', label: 'Ouvrir Alchimie (convertir des fichiers)', app: 'Alchimie', ask: '', grave: false, def: 4, run: { fn: 'alchimie' } },
  { id: 'serveur_redemarrer', label: 'Redémarrer tout le serveur', app: 'Odin', ask: 'Je redémarre tout le serveur ? Tout s\'arrête 1 à 2 minutes.', grave: true, def: null, run: { fn: 'redemarrer_serveur' } },
  { id: 'odin_redemarrer', label: 'Redémarrer Odin seulement', app: 'Odin', ask: 'Je me redémarre (le serveur reste allumé) ?', grave: false, def: 5, run: { fn: 'redemarrer_odin' } },
  { id: 'faire_le_point_sante_du_serveur', label: 'Faire le point santé du serveur', app: 'Hygie', ask: 'Je regarde processeur, mémoire, disques et je te dis ?', grave: false, def: 6, run: { act: ['eir', 'etat'] } },
  { id: 'annuler_ma_derniere_manip', label: 'Annuler ma dernière manip', app: 'Odin', ask: 'J\'annule ce que j\'ai fait seul en dernier ?', grave: false, def: null, run: { say: 'Annule ta dernière manip.' } },
  { id: 'sauvegarder_maintenant', label: 'Sauvegarder maintenant', app: 'Arche', ask: 'Je lance une sauvegarde des bases maintenant ?', grave: false, def: null, run: { say: 'Sauvegarde les bases maintenant.' } },
  { id: 'analyse_antivirus_rapide', label: 'Analyse antivirus rapide', app: 'Asclépios', ask: 'J\'analyse tes téléchargements et ton bureau ?', grave: false, def: 9, run: { act: ['ullr', 'analyser'] } },
  { id: 'cacher', label: 'Me cacher sur tous tes écrans', app: 'Aurore', ask: 'Je me cache partout ? (Réglages → Apparence pour me rappeler)', grave: false, def: 10, run: { fn: 'cacher' } },
  { id: 'muet', label: 'Mode silence', app: 'Orphée', ask: 'Je coupe ma voix et les annonces ?', grave: false, def: 11, run: { fn: 'muet' } },
  { id: 'mode_nuit', label: 'Mode nuit', app: 'Midgard', ask: 'Je lance la scène « Bonne nuit » (lumières, volets, alarme) ?', grave: false, def: 12, run: { say: 'Lance la scène Bonne nuit.' } },
  { id: 'je_pars', label: 'Je pars', app: 'Midgard', ask: 'Je lance la scène « Je pars » ?', grave: false, def: 13, run: { say: 'Lance la scène Je pars.' } },
  { id: 'je_rentre', label: 'Je rentre', app: 'Midgard', ask: 'Je lance la scène « Je rentre » ?', grave: false, def: 14, run: { say: 'Lance la scène Je rentre.' } },
  { id: 'eteindre_toutes_les_lumieres', label: 'Éteindre toutes les lumières', app: 'Constellation', ask: 'J\'éteins toutes les lumières ?', grave: false, def: 15, run: { say: 'Éteins toutes les lumières.' } },
  { id: 'tester_le_debit_internet', label: 'Tester le débit Internet', app: 'Zéphyr', ask: 'Je mesure le débit Internet ?', grave: false, def: 16, run: { act: ['svalinn', 'tester_debit'] } },
  { id: 'redemarrer_la_box_internet', label: 'Redémarrer la box Internet', app: 'Zéphyr', ask: 'Je redémarre la box ? Internet coupe 2 à 3 minutes.', grave: true, def: 17, run: { say: 'Redémarre la box Internet.' } },
  { id: 'wi_fi_invites_afficher_le_qr_code', label: 'Wi-Fi invités : afficher le QR code', app: 'Zéphyr', ask: 'J\'affiche le QR code du Wi-Fi invités ?', grave: false, def: 18, run: { act: ['svalinn', 'qr_invites'] } },
  { id: 'couper_internet_des_enfants', label: 'Couper Internet des enfants', app: 'Sphinx', ask: 'Je coupe Internet sur les appareils des enfants ?', grave: false, def: 19, run: { say: 'Coupe Internet sur les appareils des enfants.' } },
  { id: 'rendre_internet_aux_enfants', label: 'Rendre Internet aux enfants', app: 'Sphinx', ask: 'Je rends Internet aux appareils des enfants ?', grave: false, def: 20, run: { say: 'Rends Internet aux appareils des enfants.' } },
  { id: 'relancer_les_conteneurs_arretes', label: 'Relancer les conteneurs arrêtés', app: 'Argo', ask: 'Je relance les applis arrêtées toutes seules ?', grave: false, def: 21, run: { say: 'Relance les conteneurs arrêtés.' } },
  { id: 'essayer_mes_sites', label: 'Essayer mes sites', app: 'Arachné', ask: 'Je teste tous tes sites (pages, formulaires) ?', grave: false, def: 22, run: { act: ['idunn', 'tester'] } },
  { id: 'rapport_de_securite', label: 'Rapport de sécurité', app: 'Forseti', ask: 'Je te fais le rapport de sécurité du jour ?', grave: false, def: 23, run: { say: 'Fais-moi le rapport de sécurité du jour.' } },
  { id: 'qui_est_banni_en_ce_moment', label: 'Qui est banni en ce moment', app: 'Cerbère', ask: 'Je te montre les adresses bannies ?', grave: false, def: 24, run: { act: ['garmr', 'bannis'] } },
  { id: 'connexions_suspectes', label: 'Connexions suspectes', app: 'Méduse', ask: 'Je vérifie les connexions suspectes ?', grave: false, def: 25, run: { act: ['geri', 'connexions'] } },
  { id: 'appareils_inconnus_sur_le_reseau', label: 'Appareils inconnus sur le réseau', app: 'Atlas', ask: 'Je liste les appareils que je ne connais pas ?', grave: false, def: 26, run: { say: 'Liste les appareils inconnus sur le réseau.' } },
  { id: 'briefing_du_jour', label: 'Briefing du jour', app: 'Iris', ask: 'Je t\'envoie le briefing du jour ?', grave: false, def: 27, run: { say: 'Envoie-moi le briefing du jour.' } },
  { id: 'mon_agenda_d_aujourd_hui', label: 'Mon agenda d\'aujourd\'hui', app: 'Chronos', ask: 'Je te lis ton agenda du jour ?', grave: false, def: 28, run: { act: ['frigg', 'agenda'] } },
  { id: 'prendre_une_note_vocale', label: 'Prendre une note vocale', app: 'Écho', ask: 'J\'écoute et je note ce que tu dis ?', grave: false, def: 29, run: { say: 'Prends une note vocale.' } },
  { id: 'lancer_la_radio', label: 'Lancer la radio', app: 'Apollon', ask: 'Je lance ta radio préférée ?', grave: false, def: 30, run: { say: 'Lance la radio.' } },
  { id: 'couper_la_musique', label: 'Couper la musique', app: 'Apollon', ask: 'J\'arrête la musique ?', grave: false, def: 31, run: { act: ['aegir', 'stop'] } },
  { id: 'reprendre_ma_serie', label: 'Reprendre ma série', app: 'Vénus', ask: 'Je reprends ta série là où tu t\'es arrêté ?', grave: false, def: 32, run: { say: 'Reprends ma série.' } },
  { id: 'annonce_sur_les_enceintes', label: 'Annonce sur les enceintes', app: 'Stentor', ask: 'Qu\'est-ce que j\'annonce sur les enceintes ?', grave: false, def: 33, run: { say: 'Fais une annonce sur les enceintes.' } },
  { id: 'ouvrir_le_tableau_de_bord', label: 'Ouvrir le tableau de bord', app: 'Zénith', ask: 'J\'ouvre le tableau de bord ?', grave: false, def: 34, run: { fn: 'app:syn' } },
  { id: 'reveiller_le_pc_du_bureau', label: 'Réveiller le PC du bureau', app: 'Satellites', ask: 'J\'allume le PC du bureau à distance ?', grave: false, def: 35, run: { say: 'Allume le PC du bureau à distance.' } },
  { id: 'verrouiller_les_ordinateurs', label: 'Verrouiller les ordinateurs', app: 'Satellites', ask: 'Je verrouille tous les ordinateurs du parc ?', grave: false, def: 36, run: { say: 'Verrouille tous les ordinateurs du parc.' } },
  { id: 'mettre_les_ordinateurs_en_veille', label: 'Mettre les ordinateurs en veille', app: 'Satellites', ask: 'Je mets les ordinateurs en veille ?', grave: false, def: 37, run: { say: 'Mets les ordinateurs en veille.' } },
  { id: 'synchroniser_mes_fichiers', label: 'Synchroniser mes fichiers', app: 'Nébuleuse', ask: 'Je synchronise tes fichiers maintenant ?', grave: false, def: 38, run: { act: ['skidbladnir', 'synchroniser'] } },
  { id: 'liberer_de_l_espace_disque', label: 'Libérer de l\'espace disque', app: 'Héraclès', ask: 'Je nettoie les fichiers inutiles (rien de personnel) ?', grave: false, def: 39, run: { say: 'Libère de l\'espace disque.' } },
  { id: 'verifier_les_disques', label: 'Vérifier les disques', app: 'Pyramide', ask: 'Je vérifie la santé des disques ?', grave: false, def: 40, run: { say: 'Vérifie la santé des disques.' } },
  { id: 'verifier_l_acces_depuis_internet', label: 'Vérifier l\'accès depuis Internet', app: 'Bifröst', ask: 'Je vérifie que tes services sont joignables depuis Internet ?', grave: false, def: 41, run: { act: ['bru', 'verifier'] } },
  { id: 'couper_l_acces_depuis_internet', label: 'Couper l\'accès depuis Internet', app: 'Bifröst', ask: 'Je coupe l\'accès depuis Internet ? Plus rien ne sera joignable de dehors.', grave: true, def: 42, run: { act: ['bru', 'arreter'] } },
  { id: 'retablir_l_acces_depuis_internet', label: 'Rétablir l\'accès depuis Internet', app: 'Bifröst', ask: 'Je rétablis l\'accès depuis Internet ?', grave: false, def: 43, run: { act: ['bru', 'demarrer'] } },
  { id: 'mode_attaque', label: 'Mode attaque', app: 'Arachné', ask: 'Je passe tes sites en mode attaque (protection maximale) ?', grave: true, def: 44, run: { act: ['idunn', 'mode_attaque'] } },
  { id: 'fermer_tous_les_ports_ouverts', label: 'Fermer tous les ports ouverts', app: 'Valgrind', ask: 'Je ferme les ports ouverts (sauf ceux d\'Odin) ?', grave: true, def: 45, run: { act: ['valgrind', 'fermer_ports'] } },
  { id: 'theme', label: 'Changer de thème au hasard', app: 'Aurore', ask: 'Je change de thème ?', grave: false, def: 46, run: { fn: 'theme' } },
  { id: 'changer_ma_couleur', label: 'Changer ma couleur', app: 'Aurore', ask: 'Je prends une autre couleur ?', grave: false, def: 47, run: { say: 'Change de couleur.' } },
  { id: 'pouvoir', label: 'Lancer un pouvoir', app: 'Odin', ask: 'Je lance un pouvoir sur la page ?', grave: false, def: 48, run: { fn: 'pouvoir' } },
  { id: 'rire', label: 'Rire', app: 'Odin', ask: 'Tu veux me faire rire ?', grave: false, def: 49, run: { fn: 'rire' } },
  { id: 'lire_la_page_a_voix_haute', label: 'Lire la page à voix haute', app: 'Orphée', ask: 'Je te lis cette page ?', grave: false, def: 50, run: { say: 'Lis-moi cette page à voix haute.' } },
  { id: 'resumer_la_page', label: 'Résumer la page', app: 'Odin', ask: 'Je te résume cette page ?', grave: false, def: 51, run: { say: 'Résume-moi cette page.' } },
  { id: 'traduire_la_page', label: 'Traduire la page', app: 'Interprète', ask: 'Je traduis cette page ?', grave: false, def: 52, run: { say: 'Traduis cette page.' } },
  { id: 'chercher_sur_le_web', label: 'Chercher sur le web', app: 'Pythie', ask: 'Qu\'est-ce que je cherche ?', grave: false, def: 53, run: { fn: 'app:volva' } },
  { id: 'ouvrir_la_discussion', label: 'Ouvrir la Discussion', app: 'Odin', ask: 'J\'ouvre la Discussion ?', grave: false, def: 54, run: { fn: 'vue:chat' } },
  { id: 'ouvrir_les_reglages', label: 'Ouvrir les Réglages', app: 'Odin', ask: 'J\'ouvre les Réglages ?', grave: false, def: 55, run: { fn: 'vue:settings' } },
  { id: 'visite_guidee', label: 'Visite guidée', app: 'Odin', ask: 'Je te fais visiter Odin ?', grave: false, def: 56, run: { say: 'Fais-moi la visite guidée.' } },
  { id: 'quoi_de_neuf', label: 'Quoi de neuf', app: 'Odin', ask: 'Je te montre les dernières nouveautés ?', grave: false, def: 57, run: { fn: 'nouveautes' } },
  { id: 'arbre_d_evolution', label: 'Arbre d\'évolution', app: 'Odin', ask: 'J\'ouvre l\'histoire d\'Odin ?', grave: false, def: 58, run: { say: 'Montre-moi l\'arbre d\'évolution.' } },
  { id: 'exporter_la_conversation', label: 'Exporter la conversation', app: 'Odin', ask: 'J\'exporte la conversation en cours ?', grave: false, def: 59, run: { say: 'Exporte la conversation en cours.' } },
  { id: 'nouvelle_conversation', label: 'Nouvelle conversation', app: 'Odin', ask: 'Je commence une nouvelle conversation ?', grave: false, def: 60, run: { say: 'Commence une nouvelle conversation.' } },
  { id: 'instantane_des_machines', label: 'Instantané des machines', app: 'Hydre', ask: 'Je prends un instantané de tes machines virtuelles ?', grave: false, def: 61, run: { say: 'Prends un instantané de mes machines virtuelles.' } },
  { id: 'etat_des_machines_virtuelles', label: 'État des machines virtuelles', app: 'Hydre', ask: 'Je te montre l\'état de tes machines ?', grave: false, def: 62, run: { act: ['ymir', 'machines'] } },
  { id: 'mettre_a_jour_les_iso', label: 'Mettre à jour les ISO', app: 'Andromède', ask: 'Je vérifie et télécharge les nouvelles ISO ?', grave: false, def: 63, run: { act: ['eitri', 'mettre_a_jour'] } },
  { id: 'lancer_les_automatisations_du_matin', label: 'Lancer les automatisations du matin', app: 'Talos', ask: 'Je lance les automatisations du matin ?', grave: false, def: 64, run: { say: 'Lance les automatisations du matin.' } },
  { id: 'mettre_les_automatisations_en_pause', label: 'Mettre les automatisations en pause', app: 'Talos', ask: 'Je mets toutes les automatisations en pause ?', grave: false, def: 65, run: { say: 'Mets toutes les automatisations en pause.' } },
  { id: 'reprendre_les_automatisations', label: 'Reprendre les automatisations', app: 'Talos', ask: 'Je reprends les automatisations ?', grave: false, def: 66, run: { say: 'Reprends les automatisations.' } },
  { id: 'journal_de_mes_decisions', label: 'Journal de mes décisions', app: 'Odin', ask: 'Je t\'ouvre ce que j\'ai fait et pourquoi ?', grave: false, def: 67, run: { fn: 'vue:audit' } },
  { id: 'garder_toutes_mes_manips', label: 'Garder toutes mes manips', app: 'Odin', ask: 'Je garde toutes les manips en attente ?', grave: false, def: 68, run: { say: 'Garde toutes les manips en attente.' } },
  { id: 'mode_prudent', label: 'Mode Prudent', app: 'Odin', ask: 'Je passe en mode Prudent (je demande avant tout) ?', grave: false, def: 69, run: { say: 'Passe en mode Prudent.' } },
  { id: 'mode_autonome', label: 'Mode Autonome', app: 'Odin', ask: 'Je passe en mode Autonome ?', grave: true, def: 70, run: { say: 'Passe en mode Autonome.' } },
  { id: 'rapport_du_jour_sur_telegram', label: 'Rapport du jour sur Telegram', app: 'Iris', ask: 'Je t\'envoie le rapport du jour sur Telegram ?', grave: false, def: 71, run: { say: 'Envoie-moi le rapport du jour sur Telegram.' } },
  { id: 'prevenir_la_famille', label: 'Prévenir la famille', app: 'Iris', ask: 'J\'envoie un message à la famille ? (tu choisis le texte)', grave: false, def: 72, run: { say: 'Envoie un message à la famille.' } },
  { id: 'chercher_une_mise_a_jour_d_odin', label: 'Chercher une mise à jour d\'Odin', app: 'Odin', ask: 'Je regarde s\'il y a une nouvelle version ?', grave: false, def: 73, run: { fn: 'maj_chercher' } },
  { id: 'installer_la_mise_a_jour_d_odin', label: 'Installer la mise à jour d\'Odin', app: 'Odin', ask: 'J\'installe la nouvelle version et je redémarre ?', grave: true, def: 74, run: { fn: 'maj_installer' } },
  { id: 'sauvegarder_mes_reglages', label: 'Sauvegarder mes réglages', app: 'Odin', ask: 'Je sauvegarde tous mes réglages ?', grave: false, def: 75, run: { say: 'Sauvegarde tous tes réglages.' } },
  { id: 'tester_toutes_les_applis', label: 'Tester toutes les applis', app: 'Odin', ask: 'Je teste toutes mes applis et je te dis ce qui ne va pas ?', grave: false, def: 76, run: { say: 'Teste toutes tes applis et dis-moi ce qui ne va pas.' } },
  { id: 'vider_le_cache_dns', label: 'Vider le cache DNS', app: 'Sphinx', ask: 'Je vide le cache DNS ?', grave: false, def: 77, run: { say: 'Vide le cache DNS.' } },
  { id: 'pause_du_bloqueur_de_pubs_10_min', label: 'Pause du bloqueur de pubs (10 min)', app: 'Sphinx', ask: 'Je mets le bloqueur de pubs en pause 10 minutes ?', grave: false, def: 78, run: { say: 'Mets le bloqueur de pubs en pause 10 minutes.' } },
  { id: 'reactiver_le_bloqueur_de_pubs', label: 'Réactiver le bloqueur de pubs', app: 'Sphinx', ask: 'Je réactive le bloqueur de pubs ?', grave: false, def: 79, run: { say: 'Réactive le bloqueur de pubs.' } },
  { id: 'analyse_antivirus_complete', label: 'Analyse antivirus complète', app: 'Asclépios', ask: 'Je lance une analyse complète (ça peut être long) ?', grave: false, def: 80, run: { say: 'Lance une analyse antivirus complète.' } },
  { id: 'mettre_a_jour_l_antivirus', label: 'Mettre à jour l\'antivirus', app: 'Asclépios', ask: 'Je mets à jour les signatures de l\'antivirus ?', grave: false, def: 81, run: { act: ['ullr', 'mettre_a_jour'] } },
  { id: 'couper_le_wi_fi_invites', label: 'Couper le Wi-Fi invités', app: 'Zéphyr', ask: 'Je coupe le Wi-Fi invités ?', grave: false, def: 82, run: { say: 'Coupe le Wi-Fi invités.' } },
  { id: 'mode_cinema', label: 'Mode cinéma', app: 'Midgard', ask: 'Je lance la scène « Film » ?', grave: false, def: 83, run: { say: 'Lance la scène Film.' } },
  { id: 'ne_pas_deranger', label: 'Ne pas déranger', app: 'Odin', ask: 'Je passe en « Ne pas déranger » (seulement l\'urgent) ?', grave: false, def: 84, run: { say: 'Passe en Ne pas déranger.' } },
  { id: 'mode_jeux', label: 'Mode jeux', app: 'Olympie', ask: 'Je lance le mode jeux rétro ?', grave: false, def: 85, run: { say: 'Lance le mode jeux rétro.' } },
  { id: 'allumer_toutes_les_cameras', label: 'Allumer toutes les caméras', app: 'Cyclope', ask: 'J\'allume la surveillance des caméras ?', grave: false, def: 86, run: { act: ['himinbjorg', 'cameras'] } },
  { id: 'photo_de_toutes_les_cameras', label: 'Photo de toutes les caméras', app: 'Cyclope', ask: 'Je prends une photo de chaque caméra ?', grave: false, def: 87, run: { say: 'Prends une photo de chaque caméra.' } },
  { id: 'reveiller_toutes_les_machines', label: 'Réveiller toutes les machines', app: 'Satellites', ask: 'J\'allume toutes les machines du parc ?', grave: false, def: 88, run: { say: 'Allume toutes les machines du parc.' } },
  { id: 'eteindre_tout_le_parc_sauf_le_serveur', label: 'Éteindre tout le parc (sauf le serveur)', app: 'Satellites', ask: 'J\'éteins tous les ordinateurs, sauf le serveur ?', grave: true, def: 89, run: { say: 'Éteins tous les ordinateurs, sauf le serveur.' } },
  { id: 'verifier_les_certificats', label: 'Vérifier les certificats', app: 'Valgrind', ask: 'Je vérifie les certificats de tes sites ?', grave: false, def: 90, run: { say: 'Vérifie les certificats de mes sites.' } },
  { id: 'bilan_des_mots_de_passe', label: 'Bilan des mots de passe', app: 'Thésauros', ask: 'Je vérifie tes mots de passe faibles ou fuités ?', grave: false, def: 91, run: { act: ['brisingamen', 'bilan'] } },
  { id: 'couper_toutes_les_sessions', label: 'Couper toutes les sessions', app: 'Persona', ask: 'Je déconnecte tout le monde de partout ?', grave: true, def: 92, run: { act: ['var', 'couper_sessions'] } },
  { id: 'verifier_les_sauvegardes', label: 'Vérifier les sauvegardes', app: 'Phénix', ask: 'Je vérifie que les sauvegardes se restaurent bien ?', grave: false, def: 93, run: { act: ['sindri', 'verifier'] } },
  { id: 'rapport_d_activite_de_la_semaine', label: 'Rapport d\'activité de la semaine', app: 'Odin', ask: 'Je te fais le bilan de la semaine ?', grave: false, def: 94, run: { say: 'Fais-moi le bilan de la semaine.' } },
  { id: 'faire_le_menage_dans_mes_notes', label: 'Faire le ménage dans mes notes', app: 'Thot', ask: 'Je range et relie tes notes ?', grave: false, def: 95, run: { say: 'Range et relie mes notes.' } },
  { id: 'mode_economie_d_energie', label: 'Mode économie d\'énergie', app: 'Midgard', ask: 'Je baisse le chauffage, éteins ce qui ne sert pas ?', grave: false, def: 96, run: { say: 'Passe la maison en mode économie d\'énergie.' } },
  { id: 'mode_vacances', label: 'Mode vacances', app: 'Midgard', ask: 'Je passe la maison en mode vacances (simulation de présence) ?', grave: false, def: 97, run: { say: 'Passe la maison en mode vacances.' } },
  { id: 'mode_panique_tout_proteger', label: 'Mode panique : tout protéger', app: 'Cerbère', ask: 'Je bloque tout ce qui vient de dehors et je te préviens ?', grave: true, def: 98, run: { say: 'Mode panique : bloque tout ce qui vient de dehors et préviens-moi.' } },
  { id: 'maintenance_complete', label: 'Maintenance complète', app: 'Odin', ask: 'Sauvegarde, mises à jour puis redémarrage du serveur ?', grave: true, def: 99, run: { say: 'Fais une maintenance complète : sauvegarde, mises à jour, puis redémarre le serveur.' } },
  { id: 'surprise', label: 'Surprise', app: 'Odin', ask: 'Tu as cliqué 100 fois ! Je te fais une surprise ?', grave: false, def: 100, run: { fn: 'surprise' } },
  { id: 'phrase', label: 'Une phrase drôle', app: 'Odin', ask: '', grave: false, def: null, run: { fn: 'phrase' } },
  { id: 'avertir', label: 'Il prévient avant de se cacher', app: 'Odin', ask: '', grave: false, def: null, run: { fn: 'avertir' } },
];
const BY_ID = new Map(CLICK_CATALOG.map((a) => [a.id, a]));
/** Les nombres proposés au départ (les actions que tu as retirées n'en ont pas). */
export const DEFAULT_CLICKS2: Record<string, string> = Object.fromEntries(CLICK_CATALOG.filter((a) => a.def).map((a) => [String(a.def), a.id]));
/** Nettoie le choix venu de l'écran admin : nombres de 4 à 100, actions connues, un nombre = une action, une action = un nombre. Pur. */
export function cleanClicks2(c: unknown): Record<string, string> {
  if (!c || typeof c !== 'object') return { ...DEFAULT_CLICKS2 };
  const out: Record<string, string> = {}, used = new Set<string>();
  for (const [k, v] of Object.entries(c as Record<string, unknown>).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < CLICK_MIN || n > CLICK_MAX || typeof v !== 'string' || !BY_ID.has(v) || used.has(v)) continue;
    out[String(n)] = v; used.add(v);
  }
  return out;
}
