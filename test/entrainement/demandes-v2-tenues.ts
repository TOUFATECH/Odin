// Jeu de mesure de la VERSION 2, GARDÉ À PART dès le départ : jamais appris. Mêmes actions que
// src/brain/nous/demandes-v2.ts, d'autres mots (formulations qui ne ressemblent pas à celles apprises).
// Format : celui de lireDemandesV2 (un bloc par action, une ligne par langue).
import { lireDemandesV2 } from '../../src/brain/nous/demandes-v2.ts';

export const TENUES_V2 = lireDemandesV2(`
gladsheim.meteo
fr: faut-il sortir le linge, il va faire beau ? | c'est quoi le temps prévu cet après-midi ?
en: do I need a coat today?
es: ¿hará sol el domingo?
zeus.comparer
fr: les différents services météo disent la même chose ? | confronte les sources de prévisions
en: do the weather services agree?
es: ¿coinciden los servicios meteorológicos?
frigg.agenda
fr: c'est quoi mon programme de demain ? | rappelle-moi mes engagements de la semaine
en: what's my schedule like on Monday?
es: ¿qué tengo mañana en la agenda?
frigg.creneaux
fr: quand puis-je caser un rendez-vous jeudi ? | il me reste de la place dans la journée ?
en: when can I fit a meeting on Thursday?
es: ¿cuándo tengo un hueco el jueves?
frigg.annuler
fr: je ne peux plus voir le client de 10 h, enlève-le | efface la consultation de lundi
en: drop Monday's meeting
es: quita la reunión del lunes
freyja.regarder
fr: on regarde la suite de la série ? | j'ai envie de voir un film d'action
en: let's watch the rest of the show
es: quiero ver una peli de acción
freyja.nouveautes
fr: qu'est-ce qui a été ajouté à la vidéothèque ? | des films récents dispo ?
en: anything recently added to the library?
es: ¿hay películas recientes?
freyja.enregistrer
fr: pense à garder le documentaire de ce soir | capte l'émission de 21 h
en: tape the show at nine
es: guárdame el programa de las nueve
freyja.programme
fr: ça donne quoi la télé ce soir ? | qu'est-ce qui passe en ce moment sur les chaînes ?
en: what's showing on the channels now?
es: ¿qué ponen ahora en los canales?
freyja.livre_lire
fr: où j'en étais dans mon roman ? | la suite de mon histoire à écouter
en: where was I in my novel?
es: ¿por dónde iba en mi novela?
aegir.jouer
fr: un peu de son pour cuisiner ? | envoie-moi du reggae
en: give me some reggae
es: ponme reggae
aegir.stop
fr: on arrête le son | plus de musique maintenant
en: kill the music
es: basta de música
aegir.radio
fr: branche-toi sur une station d'info | je veux écouter les infos à la radio
en: tune in to a news station
es: sintoniza una emisora
appareils.commander
fr: il fait noir dans le salon, éclaire | descends les stores de la chambre
en: it's dark in here, lights on
es: baja las persianas del dormitorio
appareils.lister
fr: c'est quoi mes équipements connectés ? | quels objets de la maison sont reliés à Odin ?
en: what connected gadgets do I have?
es: ¿qué dispositivos inteligentes tengo?
midgard.scene
fr: prépare le salon pour une séance de film | on passe en ambiance nuit
en: movie time in the living room
es: ambiente de película en el salón
himinbjorg.photo
fr: qui sonne au portail, montre-moi | capture ce que filme la caméra du jardin
en: snap what the garden camera sees
es: captura lo que ve la cámara del jardín
himinbjorg.cameras
fr: toutes les caméras fonctionnent ? | affiche la surveillance vidéo
en: are all my cameras working?
es: ¿funcionan todas las cámaras?
himinbjorg.enregistrer
fr: filme le garage jusqu'à demain matin | garde les images de l'entrée cette nuit
en: keep footage of the driveway tonight
es: graba el garaje hasta mañana
gladsheim.ouvrir
fr: mets le tableau de bord maison sur l'écran du mur | affiche l'accueil de la maison
en: put the house panel on the wall screen
es: pon el panel de casa en la pantalla
gjoll.appareils
fr: quels appareils passent par le tunnel ? | qui est relié chez moi à distance ?
en: who's connected to my home remotely?
es: ¿quién se conecta a casa desde fuera?
gjoll.ajouter
fr: je veux accéder à la maison depuis mon téléphone | inscris ma tablette au tunnel de la maison
en: let my phone reach home from anywhere
es: quiero entrar en casa desde el móvil
gjoll.qr
fr: le code à flasher pour le tunnel | montre le carré à scanner pour le téléphone
en: the code to scan for remote access
es: el código para escanear con el móvil
svalinn.etat
fr: mon réseau sans fil est bien protégé ? | il y a un souci avec la Wi-Fi ?
en: is my wireless network protected?
es: ¿mi red inalámbrica está protegida?
svalinn.invites
fr: mes amis viennent, il leur faut la Wi-Fi | un réseau à part pour les visiteurs
en: my friends are coming, they need Wi-Fi
es: vienen amigos, necesitan Wi-Fi
svalinn.tester_debit
fr: combien de mégas j'ai en ce moment ? | la connexion est lente, mesure-la
en: how fast is my connection right now?
es: ¿cuántos megas tengo ahora?
vidarr.bloquer
fr: plus personne ne doit aller sur ce site | rends ce domaine inaccessible chez moi
en: nobody should reach this site
es: que nadie pueda entrar en esta web
vidarr.autoriser
fr: laisse à nouveau passer ce site | ce domaine n'est pas dangereux, rouvre-le
en: let this site through again
es: deja pasar esta web otra vez
vidarr.couper_machine
fr: plus d'internet pour la Switch | prive la télé de réseau
en: no more internet for the Switch
es: sin internet para la Switch
vidarr.historique
fr: quels domaines ont été demandés ? | qu'a consulté la tablette ?
en: what domains were looked up?
es: ¿qué dominios se consultaron?
heidrun.pause
fr: les enfants, plus d'écran pendant une heure | suspends internet des petits
en: no screens for the kids for an hour
es: sin pantallas para los niños una hora
heidrun.rapport
fr: combien de temps les enfants ont passé en ligne ? | qu'ont regardé les petits ?
en: how long were the kids online?
es: ¿cuánto tiempo estuvieron conectados los niños?
hlid.ouvrir_port
fr: autorise le trafic entrant sur 3000 | rends le serveur joignable sur le port 443
en: let incoming traffic on 3000
es: permite el tráfico entrante en el 3000
hlid.etat
fr: le filtrage réseau est en marche ? | que laisse passer le pare-feu ?
en: what does the firewall let through?
es: ¿qué deja pasar el cortafuegos?
garmr.bannis
fr: qui a été mis dehors pour tentative d'intrusion ? | les IP rejetées
en: which IPs were kicked out?
es: ¿qué IP han sido expulsadas?
eir.etat
fr: la machine tient le coup ? | combien de mémoire reste-t-il ?
en: how much memory is left?
es: ¿cuánta memoria queda?
eir.processus
fr: qu'est-ce qui tourne en arrière-plan ? | quel logiciel est actif là ?
en: what's running in the background?
es: ¿qué se ejecuta en segundo plano?
eir.arreter_processus
fr: ce logiciel est figé, ferme-le de force | termine ce programme
en: force quit that app
es: fuerza el cierre de esa aplicación
gefjon.nettoyer
fr: le disque est encombré, range un peu | débarrasse la machine des fichiers inutiles
en: get rid of junk files
es: elimina los archivos basura
gefjon.gros_fichiers
fr: qui occupe le disque ? | montre les fichiers les plus lourds
en: show me the heaviest files
es: muéstrame los archivos más pesados
gefjon.desinstaller
fr: enlève ce logiciel dont je ne me sers plus | débarrasse-moi de ce programme
en: get rid of this app I don't use
es: quita esta aplicación que no uso
durinn.sante
fr: le SSD tient la route ? | des signes de panne sur le disque ?
en: any signs my drive is failing?
es: ¿hay señales de que falle el disco?
fensalir.disques
fr: quelle capacité ont mes disques ? | affiche les supports de stockage
en: how big are my drives?
es: ¿qué capacidad tienen mis discos?
fensalir.ajouter_partage
fr: rends le dossier Musique visible depuis les autres ordinateurs | ouvre ce répertoire aux autres machines
en: make the Music folder visible to other computers
es: haz visible la carpeta Música en otros equipos
ullr.analyser
fr: y a-t-il un logiciel malveillant sur le PC ? | contrôle ce dossier contre les virus
en: is there malware on my PC?
es: ¿hay malware en mi PC?
ullr.adresse
fr: je peux faire confiance à cette page ? | ce site sent l'arnaque, contrôle-le
en: can I trust this web page?
es: ¿me puedo fiar de esta página?
ullr.message
fr: on me réclame des frais de douane par SMS, c'est louche ? | ce courriel de la banque est vrai ?
en: is this text from my bank real?
es: ¿este SMS del banco es real?
ullr.quarantaine
fr: qu'est-ce qui a été mis de côté par l'antivirus ? | les fichiers isolés
en: what did the antivirus set aside?
es: ¿qué apartó el antivirus?
forseti.alertes
fr: des incidents de sécurité aujourd'hui ? | rien d'anormal côté sécurité ?
en: any security incidents today?
es: ¿algún incidente de seguridad hoy?
geri.connexions
fr: où se connectent mes programmes ? | à qui parle le PC sur internet ?
en: where are my programs connecting?
es: ¿a dónde se conectan mis programas?
brisingamen.generer
fr: trouve-moi un code d'accès costaud | il me faut une phrase de passe sûre
en: I need a secure passphrase
es: necesito una frase de contraseña segura
brisingamen.chercher
fr: c'était quoi déjà le code de la box ? | retrouve mon identifiant des impôts
en: what was my bank login again?
es: ¿cuál era mi usuario del banco?
brisingamen.fuites
fr: mes comptes ont été piratés ? | un de mes codes traîne sur internet ?
en: were any of my accounts hacked?
es: ¿han hackeado alguna de mis cuentas?
sindri.sauvegarder
fr: mets en sûreté mes documents tout de suite | lance une copie de secours
en: protect my documents right now
es: pon a salvo mis documentos
sindri.restaurer
fr: remets mon fichier d'avant-hier | ressors l'ancienne version du tableur
en: bring back the old version of the spreadsheet
es: devuélveme la versión anterior de la hoja
sindri.instantanes
fr: de quand date ma dernière copie ? | combien de copies de secours j'ai ?
en: how many backups do I have?
es: ¿cuántas copias tengo?
hel.recuperer
fr: la carte de l'appareil photo a été vidée, sauve les images | ressuscite le fichier effacé
en: bring back the erased pictures
es: recupera las imágenes borradas
ymir.creer_machine
fr: installe-moi un Linux dans une machine à part | j'ai besoin d'un serveur virtuel tout neuf
en: I need a brand new virtual server
es: necesito un servidor virtual nuevo
ymir.machines
fr: combien de VM j'ai en tout ? | état des serveurs virtuels
en: how many VMs do I have?
es: ¿cuántas VM tengo?
ymir.demarrer_machine
fr: mets en route le serveur virtuel de test | réveille la VM Debian
en: power on the Debian VM
es: pon en marcha la VM Debian
ymir.arreter_machine
fr: mets hors tension la machine virtuelle | stoppe le serveur virtuel
en: power off the virtual server
es: apaga el servidor virtual
ymir.supprimer_machine
fr: débarrasse-toi de la VM d'essai | je ne veux plus de ce serveur virtuel
en: get rid of the trial VM
es: deshazte de la VM de prueba
ymir.ressources_machine
fr: la VM manque de puissance, renforce-la | passe la machine virtuelle à 8 Go
en: bump the VM to 8 GB
es: sube la VM a 8 GB
ymir.instantane
fr: fige l'état de la VM avant que je bricole | photo de la machine virtuelle
en: freeze the VM state before I tinker
es: congela el estado de la VM
ymir.installer_logiciel
fr: déploie Notepad++ sur le poste | équipe la VM de Chrome
en: deploy Notepad++ on the workstation
es: instala Notepad++ en el equipo
naglfar.lister
fr: c'est quoi les applis Docker en route ? | combien de conteneurs actifs ?
en: how many containers are active?
es: ¿cuántos contenedores activos hay?
naglfar.lancer
fr: fais tourner Vaultwarden dans un conteneur | essaie cette appli isolée dans un conteneur
en: run Vaultwarden in a container
es: ejecuta Vaultwarden en un contenedor
naglfar.redemarrer
fr: le conteneur ne répond plus, relance-le | redémarre l'appli Jellyfin
en: the container is stuck, restart it
es: el contenedor no responde, reinícialo
naglfar.journaux
fr: qu'est-ce que raconte le conteneur ? | les messages d'erreur de l'appli conteneur
en: what is the container saying?
es: ¿qué dice el contenedor?
hermod.parc
fr: les ordinateurs de la maison sont allumés ? | état des postes du foyer
en: are the home computers on?
es: ¿están encendidos los ordenadores de casa?
hermod.reveiller
fr: sors de veille l'ordinateur du bureau | allume à distance le PC de Léa
en: wake Léa's PC remotely
es: despierta el PC de Léa
eitri.telecharger
fr: récupère l'image d'installation de Fedora | va chercher l'ISO de Windows
en: fetch the Fedora install image
es: consigue la imagen de Fedora
eitri.catalogue
fr: quels systèmes j'ai en réserve ? | montre les images d'installation
en: which install images are available?
es: ¿qué imágenes de instalación hay?
thjalfi.cle_preparer
fr: rends cette clé capable d'installer un système | grave Linux sur la clé
en: turn this stick into an installer
es: convierte este USB en instalador
thjalfi.reinstaller
fr: repars de zéro sur l'ordinateur du salon | remets un système propre sur ce poste
en: wipe and reinstall the lounge PC
es: reinstala de cero el PC del salón
fjalar.mettre_a_jour
fr: mes installateurs sont-ils récents ? | va chercher les dernières versions des programmes
en: fetch the latest versions of my installers
es: busca las últimas versiones de los instaladores
fjalar.catalogue
fr: qu'est-ce que j'ai comme programmes à installer ? | la liste de mes installateurs
en: what software can I install?
es: ¿qué programas puedo instalar?
snotra.creer
fr: ouvre-moi un nouveau fichier texte pour un courrier | prépare un Word pour la lettre au propriétaire
en: start a new document for a letter
es: empieza un documento nuevo para una carta
snotra.chercher
fr: dans quel fichier j'ai parlé du devis ? | déniche mon document sur la mutuelle
en: which file mentions the quote?
es: ¿qué archivo habla del presupuesto?
snotra.lire
fr: que raconte ce rapport ? | parcours ce document et dis-moi
en: go through this document for me
es: repasa este documento por mí
snotra.corriger
fr: il y a des fautes dans ma lettre ? | améliore l'orthographe de ce mail
en: are there mistakes in my letter?
es: ¿hay faltas en mi carta?
snotra.tableur
fr: fais-moi une feuille de calcul pour le budget | mets ces chiffres dans un classeur
en: put these numbers in a spreadsheet
es: pon estos números en una hoja de cálculo
dvalinn.convertir
fr: il me faut ce document au format PDF | change l'extension de cette image en png
en: I need this in PDF format
es: necesito esto en formato PDF
dvalinn.pdf
fr: regroupe ces PDF en un seul | enlève des pages à ce PDF
en: combine these PDFs into one
es: junta estos PDF en uno
champollion.lire
fr: déchiffre ce ticket de caisse photographié | recopie le texte de ce document scanné
en: copy out the text from this scan
es: copia el texto de este escaneo
theia.voir
fr: tu peux me dire ce que montre cette image ? | que représente cette photo ?
en: tell me what this picture shows
es: dime qué muestra esta foto
saga.noter
fr: retiens dans le cerveau que le contrat finit en mars | consigne cette idée
en: jot down that the contract ends in March
es: anota que el contrato termina en marzo
saga.chercher
fr: j'avais écrit quoi sur le voyage ? | ressors ma note sur la voiture
en: what did I write about the trip?
es: ¿qué escribí sobre el viaje?
runes.ajouter
fr: insère un nouveau client dans ma base | ajoute une entrée à la liste des tâches
en: insert a new customer in my database
es: inserta un cliente nuevo en mi base
sol.chercher
fr: montre-moi les clichés de l'été dernier | les images de la fête de Léa
en: show me last summer's shots
es: enséñame las fotos del verano pasado
sol.doublons
fr: des photos identiques à virer ? | repère les images en plusieurs exemplaires
en: any identical pictures to remove?
es: ¿hay imágenes idénticas que borrar?
volva.chercher
fr: renseigne-toi en ligne sur les voitures électriques | qu'en dit internet, des batteries solaires ?
en: what does the internet say about electric cars?
es: ¿qué dice internet de los coches eléctricos?
mathesis.confier
fr: deviens calé sur la fibre optique | documente-toi tout seul sur Zigbee
en: become an expert on fibre optics
es: hazte experto en fibra óptica
mathesis.absorber
fr: avale tout le contenu de ce site | lis ce site de bout en bout
en: read this site from end to end
es: lee este sitio de principio a fin
mathesis.ou_trouver
fr: tu tiens ça d'où ? | quelle page t'a appris ça ?
en: where did you get that from?
es: ¿de dónde sacaste eso?
kvasir.etudier
fr: ce projet open source vaut le coup ? | jette un œil à ce dépôt public
en: is this open source project worth it?
es: ¿merece la pena este proyecto libre?
syrinx.musique
fr: ce morceau, c'est du quoi ? | à combien de battements va cette chanson ?
en: how many beats per minute is this song?
es: ¿cuántos golpes por minuto tiene esta canción?
syrinx.sons
fr: c'était quoi ce bruit dans la cuisine ? | quelque chose a sonné ?
en: did something ring?
es: ¿ha sonado algo?
syrinx.parole
fr: mets par écrit ce message audio | que dit la personne dans ce fichier son ?
en: write down this audio message
es: pon por escrito este audio
bragi.dire
fr: lis-moi ça avec ta voix | prononce cette phrase
en: say this sentence out loud
es: pronuncia esta frase
bragi.annoncer
fr: dis à tout le monde de venir manger | fais savoir dans la maison que je pars
en: tell everyone to come and eat
es: di a todos que vengan a comer
rodd.dicter
fr: tape ce que je vais dire | je parle, toi tu écris
en: type what I say
es: escribe lo que voy a decir
ivaldi.depots
fr: mes projets git ont des changements en attente ? | où j'en suis dans mes dépôts de code ?
en: any pending changes in my repos?
es: ¿hay cambios pendientes en mis repositorios?
ivaldi.cloner
fr: fais une copie locale de ce projet GitHub | rapatrie ce dépôt
en: make a local copy of this GitHub project
es: haz una copia local de este proyecto
ivaldi.ouvrir_terminal
fr: il me faut une invite de commande | ouvre un shell
en: I need a command prompt
es: necesito una línea de comandos
archytas.creer
fr: programme un petit outil qui trie mes téléchargements | écris un script pour vider la corbeille chaque semaine
en: code a small tool that sorts my downloads
es: programa una herramienta que ordene mis descargas
archytas.mes_scripts
fr: montre ma bibliothèque de scripts | quels petits programmes Odin m'a écrits ?
en: show my script library
es: muestra mi biblioteca de scripts
draupnir.lister
fr: qu'est-ce qui est automatisé chez moi ? | mes routines automatiques
en: what's automated at home?
es: ¿qué está automatizado en casa?
draupnir.executer
fr: déclenche la routine du matin | fais tourner l'automatisation de rangement
en: trigger the morning routine
es: dispara la rutina de la mañana
idunn.sites
fr: mes sites internet sont en ligne ? | comment se portent mes pages web ?
en: are my web pages online?
es: ¿están en línea mis páginas?
idunn.deployer
fr: pousse la nouvelle version en production | mets à jour mon site en ligne
en: push the new version to production
es: sube la nueva versión a producción
vordr.ajouter
fr: avertis-moi si le serveur ne répond plus | garde un œil sur ma boutique en ligne
en: let me know if the server stops responding
es: avísame si el servidor deja de responder
var.ajouter
fr: ouvre un compte à mon fils | inscris un nouvel utilisateur
en: open an account for my son
es: abre una cuenta para mi hijo
skidbladnir.lien
fr: fais-moi une adresse pour partager ce dossier | génère un lien vers ces fichiers
en: give me a link to share this folder
es: dame un enlace para compartir esta carpeta
atalante.ajouter
fr: rapatrie ce fichier depuis ce lien | mets ce lien en téléchargement
en: grab this file from the link
es: baja este archivo del enlace
gna.trajets
fr: par où est passé mon fils aujourd'hui ? | l'historique de position de Léa
en: where did my son go today?
es: ¿por dónde pasó mi hijo hoy?
apparence.theme
fr: je veux d'autres couleurs pour Odin | passe en mode nuit
en: switch to night mode
es: cambia a modo noche
syn.creer
fr: dessine-moi une courbe des températures | un graphique de l'énergie consommée
en: draw me a temperature graph
es: dibújame una gráfica de temperatura
pronoia.previsions
fr: tu penses qu'il va se passer quoi demain ? | qu'est-ce qui est probable cette semaine ?
en: what's likely to happen this week?
es: ¿qué es probable que pase esta semana?
mimisbrunnr.chercher
fr: le système a-t-il eu des pannes cette nuit ? | fouille les logs à la recherche d'erreurs
en: dig through the logs for errors
es: revisa los registros en busca de errores
leikvangr.lancer
fr: on fait une partie de jeu rétro ? | démarre Zelda sur l'émulateur
en: let's play a retro game
es: juguemos a un juego retro
commandes.chercher
fr: comment je dois te parler pour éteindre la lumière ? | liste ce que tu sais faire comme commandes
en: how do I ask you to turn off the light?
es: ¿cómo te pido que apagues la luz?
aucune.pas_encore
fr: retiens-moi deux places pour le concert | le bus 3 est en retard ? | trouve-moi un hôtel pas cher et réserve-le | localise-moi sur une carte | achète ce livre en ligne | inscris-moi à ce cours en ligne
en: reserve two seats for the concert | is the number 3 bus late? | buy this book online
es: resérvame dos entradas para el concierto | ¿llega tarde el autobús? | compra este libro por internet
de: kauf dieses Buch online
it: compra questo libro online
pt: compra este livro na internet
gladsheim.meteo
de: brauche ich heute einen Regenschirm?
it: mi serve l'ombrello oggi?
pt: preciso de guarda-chuva hoje?
frigg.agenda
de: was steht diese Woche an?
it: cosa ho in programma questa settimana?
pt: o que tenho marcado esta semana?
freyja.regarder
de: lass uns die Serie weiterschauen
it: continuiamo la serie
pt: vamos continuar a série
aegir.jouer
de: mach ein bisschen Reggae an
it: mettimi del reggae
pt: põe-me reggae
appareils.commander
de: es ist dunkel hier, Licht an
it: è buio qui, accendi la luce
pt: está escuro aqui, liga a luz
gjoll.appareils
de: wer greift von außen auf mein Zuhause zu?
it: chi accede a casa mia da fuori?
pt: quem acede a minha casa de fora?
eir.processus
de: was läuft im Hintergrund?
it: cosa gira in background?
pt: o que está a correr em segundo plano?
vidarr.bloquer
de: niemand soll diese Seite öffnen können
it: nessuno deve poter aprire questo sito
pt: ninguém deve conseguir abrir este site
sindri.sauvegarder
de: bring meine Dokumente sofort in Sicherheit
it: metti al sicuro i miei documenti
pt: põe os meus documentos em segurança
ullr.analyser
de: ist Schadsoftware auf meinem PC?
it: c'è un malware sul mio PC?
pt: há malware no meu PC?
brisingamen.generer
de: ich brauche eine sichere Passphrase
it: mi serve una passphrase sicura
pt: preciso de uma frase-passe segura
volva.chercher
de: was sagt das Internet über Elektroautos?
it: cosa dice internet delle auto elettriche?
pt: o que diz a internet sobre carros elétricos?
`);

/** Des actions qu'AUCUNE demande apprise ne vise (ni en v1 ni en v2) : seules leurs fiches et leurs mots sont dans le
 *  corpus. Elles mesurent si Soul passe des mots d'une fiche à une demande dite autrement. */
export const INCONNUES = lireDemandesV2(`
gjoll.revoquer
fr: retire l'accès VPN du vieux téléphone
en: revoke the old phone's VPN access
svalinn.qr_invites
fr: affiche le code à scanner pour le Wi-Fi des invités
en: show the guest Wi-Fi QR code
sindri.verifier
fr: vérifie que la sauvegarde d'hier est lisible
en: check that last night's backup can be read
naglfar.nettoyer
fr: fais de la place dans les images de conteneurs inutilisées
en: clean up unused container images
hlid.fermer_port
fr: referme le port 8080
en: close port 8080
garmr.debannir
fr: laisse revenir cette adresse que tu as bannie
en: unban this address
loki.eteindre
fr: coupe les pièges à pirates
en: turn off the honeypots
sol.album
fr: crée un album avec les photos du mariage
en: make an album from the wedding photos
frigg.horaires
fr: change mes horaires d'ouverture du samedi
en: change my Saturday opening hours
aegir.indexer
fr: relis toute ma bibliothèque de musique
en: rescan my music library
freyja.annuler_enregistrement
fr: n'enregistre plus le match de ce soir
en: cancel tonight's recording
ullr.rapport
fr: donne-moi le compte rendu de l'antivirus
en: give me the antivirus report
gefjon.demarrage
fr: qu'est-ce qui se lance au démarrage de l'ordinateur ?
en: what starts when the computer boots?
durinn.banc
fr: mesure la vitesse du disque
en: benchmark the disk speed
eitri.verifier
fr: contrôle que l'ISO téléchargée n'est pas abîmée
en: verify the downloaded ISO
ymir.console_machine
fr: ouvre l'écran de la machine virtuelle
en: open the VM console
idunn.relancer
fr: relance mon site qui est tombé
en: restart my website that went down
var.double_auth
fr: active la double vérification pour mon compte
en: turn on two-factor authentication for my account
kvasir.idee
fr: note cette idée d'amélioration pour Odin
en: save this improvement idea for Odin
vordr.pause
fr: arrête un moment de surveiller le serveur
en: pause the server monitoring
`);
