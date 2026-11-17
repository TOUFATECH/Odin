// Demandes de tous les jours, version 2 du corpus de départ de Soul (Noûs) : beaucoup plus de façons de dire chaque
// action, d'après la campagne des tâches de tous les jours (test/taches/campagne.ts) et la grille des contextes
// (météo, maison, réseau, machines, documents, code, sécurité…). Rien de privé.
//
// Format : un bloc par action. Première ligne « appli.action » (identifiants internes, vérifiés contre la liste des
// applis par le banc) ; puis une ligne par langue « fr: une demande | une autre | … ». « aucune.pas_encore » : ce
// qu'Odin ne sait pas encore faire ; la bonne réponse apprise est « pas encore », jamais une appli au hasard.
// Les lignes « ar? » et « ja? » sont en arabe et en japonais, À RELIRE PAR UNE PERSONNE qui parle la langue.
// Le shimaoré et le kibushi : rien n'est écrit tant qu'une personne qui les parle ne l'a pas fait.
// D'autres formulations des mêmes actions sont gardées À PART (test/entrainement/demandes-v2-tenues.ts) : jamais apprises.

export interface DemandeV2 { demande: string; module: string; action: string; langue: string; relire?: boolean }

/** Lit le format « un bloc par action » (sert aussi au jeu tenu à part du banc). */
export function lireDemandesV2(texte: string): DemandeV2[] {
  const out: DemandeV2[] = [];
  let mod = '', act = '';
  for (const brut of texte.split('\n')) {
    const l = brut.trim();
    if (!l || l.startsWith('#')) continue;
    const cle = /^([a-z0-9_]+)\.([a-z0-9_]+)$/.exec(l);
    if (cle) { mod = cle[1]; act = cle[2]; continue; }
    const m = /^([a-z]{2})(\?)?:\s*(.+)$/.exec(l);
    if (!m || !mod) continue;
    for (const d of m[3].split('|').map((x) => x.trim()).filter(Boolean)) out.push({ demande: d, module: mod, action: act, langue: m[1], ...(m[2] ? { relire: true } : {}) });
  }
  return out;
}

export const DEMANDES_V2_TEXTE = `
# ------------------------------------------------------------------ météo
gladsheim.meteo
fr: quel temps fait-il ? | il va pleuvoir aujourd'hui ? | donne-moi la météo de demain | quelle température fait-il dehors ? | je prends un parapluie ou pas ? | il fait chaud cet après-midi ? | prévisions du week-end | la météo à Mamoudzou | est-ce qu'il y aura du vent ce soir ?
en: what's the weather like today? | will it rain tomorrow? | how hot is it outside?
es: ¿qué tiempo hace hoy? | ¿va a llover mañana? | ¿qué temperatura hace fuera?
ar?: كيف الطقس اليوم؟
ja?: 今日の天気はどう？
zeus.comparer
fr: compare les prévisions météo des différentes sources | quelle source météo est la plus fiable ? | mets côte à côte les prévisions | Météo-France et le centre européen disent quoi ? | compare les modèles météo pour demain | les prévisions sont-elles d'accord entre elles ? | écart entre les prévisions de pluie
en: compare the weather forecasts from different sources | which forecast is the most reliable?
es: compara las previsiones de distintas fuentes | ¿qué fuente del tiempo acierta más?
# ------------------------------------------------------------------ rendez-vous
frigg.agenda
fr: quels rendez-vous j'ai demain ? | qu'est-ce que j'ai de prévu cette semaine ? | j'ai quoi lundi ? | mes prochains rendez-vous | est-ce que je suis libre jeudi ? | liste mes rendez-vous du mois | qui vient me voir aujourd'hui ?
en: what's on my calendar tomorrow? | list my appointments this week | am I free on Thursday?
es: ¿qué citas tengo esta semana? | enséñame mi calendario | ¿estoy libre el jueves?
ar?: ما مواعيدي هذا الأسبوع؟
ja?: 今週の予定を見せて
frigg.creneaux
fr: quels créneaux sont libres demain ? | donne-moi mes disponibilités | à quelle heure je peux recevoir un client vendredi ? | trouve un créneau libre cette semaine | mes trous dans l'agenda | quand est-ce que je suis disponible ?
en: what free slots do I have tomorrow? | show my availability
es: ¿qué huecos libres tengo mañana? | muéstrame mi disponibilidad
frigg.annuler
fr: annule le rendez-vous de 15 h | supprime mon rendez-vous de demain | décommande le client de vendredi | le rendez-vous de jeudi n'a plus lieu | retire ce rendez-vous de l'agenda
en: cancel my 3pm appointment | remove tomorrow's appointment
es: cancela la cita de las tres | borra mi cita de mañana
# ------------------------------------------------------------------ films, séries, livres
freyja.regarder
fr: lance le film Le Grand Bleu | mets-moi la série Lupin | reprends la série là où je l'ai arrêtée | je veux regarder un film ce soir | mets l'épisode suivant | lance la saison 2 épisode 5 | passe le dernier épisode de ma série | mets un dessin animé pour les enfants | joue le film sur la télé du salon
en: play the next episode | put on a movie | resume my series
es: pon el siguiente episodio | quiero ver una película | sigue la serie donde la dejé
ar?: شغّل الحلقة التالية
ja?: 次のエピソードを再生して
freyja.nouveautes
fr: quoi de neuf en films ? | les nouveaux épisodes sont sortis ? | quelles nouveautés sur le serveur multimédia ? | il y a des films ajoutés récemment ? | montre les dernières séries arrivées | qu'est-ce qui est nouveau à regarder ?
en: what's new to watch? | any new episodes?
es: ¿qué hay nuevo para ver? | ¿hay episodios nuevos?
freyja.enregistrer
fr: enregistre le match de ce soir | programme l'enregistrement du journal de 20 h | enregistre ce film à la télé | garde-moi l'émission de demain | enregistre la chaîne 2 à 21 h | tu peux enregistrer le documentaire ?
en: record tonight's match | record the news at 8pm
es: graba el partido de esta noche | graba las noticias de las ocho
freyja.programme
fr: qu'est-ce qu'il y a à la télé ce soir ? | le programme télé de demain | quoi regarder à la télé maintenant ? | qu'est-ce qui passe sur la une ? | le guide des programmes
en: what's on TV tonight? | show me the TV guide
es: ¿qué echan en la tele esta noche? | enséñame la programación
freyja.livre_lire
fr: reprends mon livre | lis-moi mon livre audio | continue le livre où je m'étais arrêté | ouvre mon livre en cours | j'aimerais reprendre ma lecture
en: resume my book | continue my audiobook
es: sigue con mi libro | continúa el audiolibro
# ------------------------------------------------------------------ musique
aegir.jouer
fr: joue du jazz dans le salon | lance ma playlist | joue un morceau de Bob Marley | je veux écouter de la musique douce | mets un peu d'ambiance | joue l'album que j'écoutais hier | balance du son dans la cuisine | lance quelque chose de calme pour travailler
en: play some music | put on my playlist | play something relaxing
es: pon mi lista de reproducción | pon algo tranquilo
ar?: شغّل موسيقى هادئة
ja?: 落ち着いた音楽をかけて
aegir.stop
fr: arrête la musique | coupe le son | stop la musique du salon | silence s'il te plaît | éteins la musique | assez de musique pour aujourd'hui
en: stop the music | turn the music off
es: para la música | apaga la música
aegir.radio
fr: mets la radio | lance France Inter | je veux écouter la radio | mets une radio d'info | passe Radio Mayotte | allume la radio dans la cuisine
en: turn on the radio | play a news radio station
es: pon la radio | pon una emisora de noticias
# ------------------------------------------------------------------ maison
appareils.commander
fr: allume la lumière du salon | éteins la lampe de la chambre | ferme les volets | baisse le chauffage | allume la clim | éteins toutes les lumières | ouvre le portail | allume la prise de la machine à café | monte les volets du bureau
en: turn on the living room light | close the shutters | switch off all the lights
es: enciende la luz del salón | cierra las persianas | apaga todas las luces
ar?: أطفئ كل الأضواء
ja?: リビングの電気をつけて
appareils.lister
fr: quels appareils de la maison sont connectés ? | liste les lumières et les prises | montre tous mes objets connectés | quels capteurs j'ai ? | qu'est-ce qui est allumé dans la maison ?
en: list my smart home devices | what's switched on in the house?
es: ¿qué aparatos de casa están conectados? | ¿qué está encendido en casa?
midgard.scene
fr: lance la scène cinéma | mode soirée | active la scène nuit | ambiance repas | mets la maison en mode départ | lance la scène réveil
en: start the movie scene | set the night scene
es: activa la escena de cine | modo noche
himinbjorg.photo
fr: prends une photo avec la caméra du jardin | montre-moi ce que voit la caméra de l'entrée | fais une capture de la caméra du portail | photo de la caméra du garage | qui est devant la porte ? | regarde la caméra de la cour
en: take a picture with the garden camera | show me the front door camera
es: haz una foto con la cámara del jardín | enséñame la cámara de la entrada
himinbjorg.cameras
fr: montre-moi les caméras | quelles caméras sont en ligne ? | liste mes caméras de surveillance | les caméras marchent ? | état des caméras
en: show me the cameras | which cameras are online?
es: enséñame las cámaras | ¿qué cámaras están conectadas?
himinbjorg.enregistrer
fr: enregistre la caméra du jardin pendant une heure | filme l'entrée cette nuit | lance l'enregistrement de la caméra du garage | garde la vidéo de la cour
en: record the garden camera for an hour | record the front door tonight
es: graba la cámara del jardín una hora | graba la entrada esta noche
gladsheim.ouvrir
fr: ouvre l'écran de la maison | affiche le tableau de la maison sur la tablette | montre l'écran d'accueil de la maison | ouvre Hestia | mets l'écran mural
en: open the home screen | show the house dashboard on the tablet
es: abre la pantalla de la casa | muestra el panel de la casa en la tableta
# ------------------------------------------------------------------ réseau, VPN, Wi-Fi
gjoll.appareils
fr: qui est connecté sur le VPN ? | montre les appareils du VPN | quels téléphones sont reliés au VPN ? | liste les accès VPN | le VPN, il y a qui dessus ? | mes appareils sur le VPN | qui accède à la maison de l'extérieur ?
en: who is on the VPN? | list the VPN devices
es: ¿quién está en la VPN? | lista los dispositivos de la VPN
gjoll.ajouter
fr: ajoute mon téléphone au VPN | donne un accès VPN à mon ordinateur portable | crée un accès VPN pour ma sœur | je veux me connecter à la maison depuis mon PC | relie ma tablette au VPN
en: add my phone to the VPN | give my laptop VPN access
es: añade mi móvil a la VPN | da acceso VPN a mi portátil
gjoll.qr
fr: donne-moi le QR code du VPN | affiche le QR pour connecter mon téléphone au VPN | le code à scanner pour le VPN | montre le QR de la tablette
en: show me the VPN QR code | QR code for my phone's VPN
es: enséñame el código QR de la VPN | código QR para la VPN del móvil
svalinn.etat
fr: quelle est la note de sécurité du Wi-Fi ? | mon Wi-Fi est-il sûr ? | état du Wi-Fi | le Wi-Fi a des problèmes ? | vérifie la sécurité de ma box Wi-Fi
en: is my Wi-Fi secure? | Wi-Fi security score
es: ¿mi Wi-Fi es seguro? | estado del Wi-Fi
svalinn.invites
fr: crée un Wi-Fi pour les invités | donne le Wi-Fi invité | ouvre un réseau pour mes amis | active le réseau invités
en: create a guest Wi-Fi | turn on the guest network
es: crea un Wi-Fi para invitados | activa la red de invitados
svalinn.tester_debit
fr: teste le débit internet | ma connexion est rapide ? | mesure la vitesse du Wi-Fi | internet rame, tu peux tester ? | fais un test de vitesse
en: test my internet speed | run a speed test
es: mide la velocidad de internet | haz un test de velocidad
ar?: اختبر سرعة الإنترنت
ja?: ネットの速度を測って
vidarr.bloquer
fr: bloque ce site pour toute la maison | empêche l'accès à facebook | bloque les sites de jeux d'argent | interdis ce domaine | coupe l'accès à ce site | bloque les pubs de ce site
en: block this website for everyone | block access to this domain
es: bloquea esta web para todos | bloquea el acceso a este dominio
vidarr.autoriser
fr: débloque ce site | autorise ce domaine | ce site est bloqué par erreur, laisse-le passer | remets l'accès à ce site
en: unblock this website | allow this domain
es: desbloquea esta web | permite este dominio
vidarr.couper_machine
fr: coupe internet sur la console des enfants | coupe le réseau de la tablette de Léa | prive le PC du salon d'internet | arrête internet sur la télé
en: cut internet on the kids' console | turn off internet on the tablet
es: corta internet en la consola de los niños | quita internet a la tableta
vidarr.historique
fr: quels sites ont été visités ? | historique des requêtes DNS | montre ce que les appareils ont consulté | quels domaines ont été bloqués aujourd'hui ?
en: which sites were visited? | DNS query history
es: ¿qué sitios se han visitado? | historial de DNS
heidrun.pause
fr: mets une pause internet pour Léa | coupe internet des enfants pendant le dîner | pause sur le profil des enfants | stop internet pour les petits jusqu'à demain
en: pause internet for the kids | pause Léa's internet
es: pausa internet para los niños | corta internet a Léa un rato
heidrun.rapport
fr: montre le rapport de navigation des enfants | qu'ont fait les enfants sur internet ? | temps d'écran de Léa | rapport du contrôle parental
en: show the kids' browsing report | screen time report
es: informe de navegación de los niños | tiempo de pantalla de Léa
hlid.ouvrir_port
fr: ouvre le port 8080 | ouvre un port sur le pare-feu pour le serveur | laisse passer le port 443 | j'ai besoin du port 25565 ouvert pour le jeu
en: open port 8080 | open a firewall port for the server
es: abre el puerto 8080 | abre un puerto en el cortafuegos
hlid.etat
fr: état du pare-feu | le pare-feu est actif ? | montre les règles du pare-feu | quels ports sont filtrés ?
en: firewall status | is the firewall on?
es: estado del cortafuegos | ¿está activo el cortafuegos?
garmr.bannis
fr: qui a été banni ? | liste des adresses bannies | qui a essayé d'entrer de force ? | les attaques bloquées aujourd'hui
en: who got banned? | list banned addresses
es: ¿quién ha sido bloqueado? | lista de direcciones bloqueadas
# ------------------------------------------------------------------ la machine d'Odin
eir.etat
fr: comment va la machine ? | état du processeur et de la mémoire | le serveur est chargé ? | la RAM est pleine ? | la machine chauffe ? | santé du PC
en: how is the machine doing? | CPU and memory usage
es: ¿cómo va la máquina? | uso de CPU y memoria
ar?: كيف حال الجهاز؟
ja?: マシンの状態はどう？
eir.processus
fr: quels programmes tournent ? | quelle application consomme le plus ? | liste des processus | qui mange le processeur ? | qu'est-ce qui ralentit la machine ? | quelle appli tourne en ce moment ?
en: which programs are running? | what is using the CPU?
es: ¿qué programas están en marcha? | ¿qué consume la CPU?
eir.arreter_processus
fr: tue ce programme qui bloque | arrête le processus chrome | ferme l'application qui plante | stoppe ce processus
en: kill that frozen program | stop the chrome process
es: cierra el programa colgado | detén el proceso de chrome
gefjon.nettoyer
fr: fais le ménage sur la machine | supprime les fichiers temporaires | libère de la place | vide les caches | nettoie le disque
en: clean up the machine | free some disk space
es: limpia la máquina | libera espacio en el disco
gefjon.gros_fichiers
fr: quels sont les plus gros fichiers ? | qu'est-ce qui prend toute la place ? | trouve les fichiers énormes | où est passé mon espace disque ?
en: what are the biggest files? | what's taking up space?
es: ¿cuáles son los archivos más grandes? | ¿qué ocupa tanto espacio?
gefjon.desinstaller
fr: désinstalle ce programme | enlève ce logiciel | supprime l'application inutile | retire ce programme de la machine
en: uninstall this program | remove this software
es: desinstala este programa | quita este software
durinn.sante
fr: le disque est en bonne santé ? | état du SSD | mon disque dur va lâcher ? | vérifie la santé des disques
en: is my disk healthy? | SSD health
es: ¿el disco está bien? | salud del SSD
fensalir.disques
fr: quels disques sont branchés ? | liste des disques et leur taille | combien de place sur les disques ? | les disques du serveur
en: which disks are connected? | list the disks and their size
es: ¿qué discos hay conectados? | lista de discos y tamaño
fensalir.ajouter_partage
fr: partage le dossier Photos sur le réseau | crée un partage réseau pour les documents | rends ce dossier accessible aux autres PC | partage en Samba le dossier Musique
en: share the Photos folder on the network | create a network share
es: comparte la carpeta Fotos en la red | crea una carpeta compartida
# ------------------------------------------------------------------ sécurité
ullr.analyser
fr: lance une analyse antivirus | vérifie qu'il n'y a pas de virus | scanne mon ordinateur | analyse ma clé USB | check le virus | passe l'antivirus sur le dossier Téléchargements
en: run a virus scan | check for viruses | scan my USB stick
es: pasa el antivirus | busca virus | analiza mi memoria USB
ar?: افحص الجهاز بحثاً عن الفيروسات
ja?: ウイルスをスキャンして
ullr.adresse
fr: vérifie ce lien | ce site est-il dangereux ? | est-ce que je peux cliquer sur ce lien ? | ce lien est une arnaque ? | analyse cette adresse web
en: is this link safe? | check this URL
es: ¿este enlace es seguro? | revisa esta dirección
ullr.message
fr: ce mail est-il une arnaque ? | est-ce que ce SMS est un piège ? | analyse ce message suspect | on me demande de payer 2 euros pour un colis, c'est vrai ?
en: is this email a scam? | check this suspicious message
es: ¿este correo es una estafa? | revisa este mensaje sospechoso
ullr.quarantaine
fr: montre la quarantaine | quels fichiers ont été isolés ? | qu'est-ce que l'antivirus a mis de côté ? | liste des fichiers suspects
en: show the quarantine | which files were isolated?
es: enséñame la cuarentena | ¿qué archivos se aislaron?
forseti.alertes
fr: montre les alertes de sécurité | il y a eu des problèmes de sécurité ? | les alertes du jour | quelque chose de suspect cette nuit ?
en: show security alerts | anything suspicious last night?
es: enséñame las alertas de seguridad | ¿algo sospechoso esta noche?
geri.connexions
fr: montre les connexions sortantes | avec qui parle ma machine ? | connexions suspectes vers internet | quels programmes envoient des données dehors ?
en: show outgoing connections | which programs send data out?
es: muestra las conexiones salientes | ¿qué programas envían datos fuera?
brisingamen.generer
fr: génère un mot de passe solide | crée un mot de passe compliqué | il me faut un nouveau mot de passe | fabrique un mot de passe de 20 caractères
en: generate a strong password | make me a new password
es: genera una contraseña segura | hazme una contraseña nueva
ar?: أنشئ كلمة مرور قوية
ja?: 強力なパスワードを作って
brisingamen.chercher
fr: cherche le mot de passe de la box | quel est mon code Netflix ? | retrouve l'identifiant de la banque | donne-moi le mot de passe du Wi-Fi | j'ai oublié le mot de passe de ma messagerie
en: find the router password | what's my Netflix password?
es: busca la contraseña del router | ¿cuál es mi contraseña de Netflix?
brisingamen.fuites
fr: mes mots de passe ont fuité ? | vérifie si mes comptes sont compromis | il y a des mots de passe trop faibles ? | bilan des fuites
en: have my passwords leaked? | check for compromised accounts
es: ¿se han filtrado mis contraseñas? | revisa cuentas comprometidas
# ------------------------------------------------------------------ sauvegardes
sindri.sauvegarder
fr: sauvegarde mon dossier Documents | fais une sauvegarde maintenant | mets mes photos à l'abri | copie de sécurité de mes fichiers | sauvegarde le PC du bureau | lance la sauvegarde de ce soir tout de suite
en: back up my Documents folder | run a backup now
es: haz una copia de seguridad ahora | guarda mis documentos
ar?: احفظ نسخة احتياطية الآن
ja?: 今すぐバックアップして
sindri.restaurer
fr: restaure le fichier d'hier | récupère la version de la semaine dernière | remets mon dossier comme avant | j'ai effacé un fichier, tu peux le ressortir de la sauvegarde ?
en: restore yesterday's file | get back last week's version
es: restaura el archivo de ayer | recupera la versión de la semana pasada
sindri.instantanes
fr: quelles sauvegardes j'ai ? | liste des sauvegardes | quand date la dernière sauvegarde ? | montre les copies disponibles
en: list my backups | when was the last backup?
es: lista mis copias de seguridad | ¿cuándo fue la última copia?
hel.recuperer
fr: récupère les photos effacées de la carte SD | j'ai supprimé un fichier par erreur, récupère-le | retrouve les fichiers d'une clé formatée | sauve les données du disque abîmé
en: recover deleted photos from the SD card | recover a deleted file
es: recupera las fotos borradas de la tarjeta SD | recupera un archivo borrado
# ------------------------------------------------------------------ machines virtuelles, conteneurs, parc
ymir.creer_machine
fr: crée une machine virtuelle Debian | crée une VM avec 4 Go de mémoire | il me faut une machine de test | fais-moi une VM Windows | prépare une machine virtuelle pour essayer un logiciel
en: create a Debian virtual machine | spin up a test VM
es: crea una máquina virtual Debian | monta una VM de pruebas
ymir.machines
fr: liste mes machines virtuelles | quelles VM j'ai ? | montre les machines | état de mes VM | quelles machines tournent ?
en: list my virtual machines | which VMs are running?
es: lista mis máquinas virtuales | ¿qué VM están encendidas?
ymir.demarrer_machine
fr: démarre la VM du contrôleur de domaine | allume la machine de test | lance la VM web | démarre la machine virtuelle Debian
en: start the test VM | boot the web VM
es: arranca la VM de pruebas | enciende la máquina virtual web
ymir.arreter_machine
fr: éteins la VM | arrête la machine virtuelle web | coupe la VM de test | éteins le serveur Samba
en: shut down the VM | stop the web virtual machine
es: apaga la VM | detén la máquina virtual web
ymir.supprimer_machine
fr: supprime la machine de test | efface cette VM | je n'ai plus besoin de cette machine virtuelle, enlève-la
en: delete the test machine | remove this VM
es: borra la máquina de pruebas | elimina esta VM
ymir.ressources_machine
fr: donne plus de mémoire à la VM | ajoute des processeurs à la machine virtuelle | augmente la RAM de la VM web | améliore ma VM
en: give the VM more memory | add CPUs to the VM
es: dale más memoria a la VM | añade procesadores a la VM
ymir.instantane
fr: prends un instantané de la VM | fais un point de retour avant la mise à jour | sauvegarde l'état de la machine virtuelle
en: take a snapshot of the VM | snapshot before the update
es: haz una instantánea de la VM | guarda el estado de la máquina
ymir.installer_logiciel
fr: installe 7-Zip sur la machine du bureau | mets Firefox sur la VM | installe VLC sur ce poste | ajoute LibreOffice à la machine
en: install 7-Zip on the office machine | put Firefox on the VM
es: instala 7-Zip en el equipo de la oficina | pon Firefox en la VM
naglfar.lister
fr: liste mes conteneurs | quels conteneurs tournent ? | montre les applis en conteneur | état des conteneurs
en: list my containers | which containers are running?
es: lista mis contenedores | ¿qué contenedores están en marcha?
naglfar.lancer
fr: lance l'appli Nextcloud en conteneur | crée un conteneur pour essayer cette appli | installe Jellyfin dans un conteneur | démarre un nouveau conteneur
en: run Nextcloud in a container | start a new container
es: lanza Nextcloud en un contenedor | crea un contenedor nuevo
naglfar.redemarrer
fr: redémarre le conteneur nextcloud | relance le conteneur qui plante | redémarre l'appli en conteneur
en: restart the nextcloud container | restart the crashed container
es: reinicia el contenedor de nextcloud | reinicia el contenedor caído
naglfar.journaux
fr: montre les journaux du conteneur web | pourquoi le conteneur plante ? | les logs de nextcloud | erreurs du conteneur
en: show the container logs | why does the container crash?
es: muestra los registros del contenedor | ¿por qué falla el contenedor?
hermod.parc
fr: quels ordinateurs sont allumés ? | état du parc | liste des PC de la maison | les postes sont à jour ?
en: which computers are on? | fleet status
es: ¿qué ordenadores están encendidos? | estado del parque
hermod.reveiller
fr: réveille le PC du bureau | allume l'ordinateur à distance | démarre le PC du salon par le réseau
en: wake up the office PC | turn on the computer remotely
es: despierta el PC de la oficina | enciende el ordenador a distancia
# ------------------------------------------------------------------ ISO, clé USB, logiciels
eitri.telecharger
fr: télécharge l'ISO de Debian | récupère la dernière image d'Ubuntu | télécharge l'ISO de Windows 11 | il me faut l'image de Linux Mint
en: download the Debian ISO | get the latest Ubuntu image
es: descarga la ISO de Debian | baja la última imagen de Ubuntu
eitri.catalogue
fr: quelles ISO j'ai ? | liste des images disque | les systèmes disponibles au téléchargement | montre le catalogue des ISO
en: which ISOs do I have? | list the disk images
es: ¿qué ISO tengo? | lista las imágenes de disco
thjalfi.cle_preparer
fr: prépare une clé USB de démarrage | j'ai branché une clé USB, démarre dessus | fais une clé pour installer Windows | mets Ubuntu sur la clé USB | rends cette clé bootable | prépare une clé d'installation Linux
en: make a bootable USB stick | put Ubuntu on the USB key
es: prepara un USB de arranque | pon Ubuntu en la memoria USB
ar?: جهّز مفتاح USB للإقلاع
ja?: 起動用のUSBを作って
thjalfi.reinstaller
fr: réinstalle le poste du salon | remets le PC à neuf par le réseau | réinstalle Windows sur l'ordinateur du bureau | refais l'installation de ce poste
en: reinstall the living room PC | reinstall Windows over the network
es: reinstala el PC del salón | reinstala Windows por la red
fjalar.mettre_a_jour
fr: mets à jour l'installateur de VLC | rafraîchis les installateurs | télécharge les nouvelles versions des logiciels | les logiciels du dossier sont à jour ?
en: update the VLC installer | refresh the installers
es: actualiza el instalador de VLC | actualiza los instaladores
fjalar.catalogue
fr: quels logiciels sont dans le dossier ? | liste des installateurs | quels programmes je peux installer ? | le catalogue des logiciels
en: which installers do I have? | software catalogue
es: ¿qué instaladores tengo? | catálogo de programas
# ------------------------------------------------------------------ documents, bureautique
snotra.creer
fr: crée un document Word avec le compte rendu | écris-moi une lettre dans un document | fais un nouveau document | rédige un courrier en Word | prépare un document pour la réunion
en: create a Word document | write a letter in a document
es: crea un documento de Word | escribe una carta en un documento
snotra.chercher
fr: cherche le document qui parle de facture | retrouve mon contrat d'assurance | où est le fichier du devis ? | trouve le document sur la voiture | cherche dans mes documents le mot loyer
en: find the document about my car insurance | where is the quote file?
es: busca el documento de la factura | ¿dónde está el presupuesto?
snotra.lire
fr: lis-moi le document contrat.pdf | ouvre le rapport et lis-le | qu'est-ce qu'il y a dans ce document ? | résume ce fichier Word
en: read me the contract | what's in this document?
es: léeme el contrato | ¿qué hay en este documento?
snotra.corriger
fr: corrige ce texte | corrige les fautes : je sui aller a la plage | relis ma lettre et corrige l'orthographe | vérifie la grammaire de ce paragraphe
en: fix this text | check the spelling
es: corrige este texto | revisa la ortografía
snotra.tableur
fr: ouvre mon tableur des dépenses | crée un tableau Excel | fais un tableau des factures | range ça dans un tableur
en: open my spending spreadsheet | create an Excel sheet
es: abre mi hoja de gastos | crea una hoja de Excel
dvalinn.convertir
fr: convertis ce document en PDF | transforme ce Word en PDF | convertis photo.png en jpg | change ce fichier en mp4 | passe cette vidéo en mp3 | convertis l'image en format plus léger
en: convert this file to PDF | turn this video into mp3
es: convierte este archivo a PDF | pasa este vídeo a mp3
ar?: حوّل هذا الملف إلى PDF
ja?: このファイルをPDFに変換して
dvalinn.pdf
fr: fusionne ces deux PDF | découpe ce PDF | assemble les factures en un seul PDF | compresse ce PDF | sépare les pages du PDF
en: merge these PDFs | split this PDF
es: une estos PDF | divide este PDF
champollion.lire
fr: lis le texte de cette photo de facture | qu'est-ce qui est écrit sur ce papier ? | reconnais le texte de ce scan | relève les dates sur ce courrier photographié
en: read the text on this photo | what's written on this paper?
es: lee el texto de esta foto | ¿qué pone en este papel?
theia.voir
fr: décris cette image | qu'est-ce qu'on voit sur cette photo ? | regarde cette image et dis-moi ce que c'est | il y a quoi sur cette photo ?
en: describe this image | what's in this picture?
es: describe esta imagen | ¿qué hay en esta foto?
saga.noter
fr: note que la chaudière a été révisée | garde une note : appeler le plombier | écris dans le cerveau que le code du portail a changé | prends note de cette idée | retiens dans mes notes la recette du gâteau
en: make a note that the boiler was serviced | write this down in my notes
es: apunta que revisaron la caldera | guarda esta nota
saga.chercher
fr: cherche dans mes notes la recette | qu'est-ce que j'avais noté sur la chaudière ? | retrouve ma note sur le voyage | dans mes notes, il y a quoi sur la voiture ?
en: search my notes for the recipe | what did I note about the boiler?
es: busca en mis notas la receta | ¿qué apunté sobre la caldera?
runes.ajouter
fr: ajoute une ligne à ma base de clients | ajoute un client dans le tableau | note une nouvelle dépense dans la base | ajoute une tâche au projet
en: add a row to my customer database | add a task to the project
es: añade una fila a mi base de clientes | añade una tarea al proyecto
# ------------------------------------------------------------------ photos
sol.chercher
fr: retrouve mes photos de vacances | montre les photos de Noël | cherche les photos de la plage | les photos de l'anniversaire de Léa | mes photos de l'an dernier
en: find my holiday photos | show the Christmas pictures
es: busca mis fotos de vacaciones | enséñame las fotos de Navidad
sol.doublons
fr: trouve les photos en double | supprime les doublons de mes photos | j'ai des photos en double ? | range les photos identiques
en: find duplicate photos | any duplicate pictures?
es: busca fotos duplicadas | ¿tengo fotos repetidas?
# ------------------------------------------------------------------ recherche, apprentissage
volva.chercher
fr: cherche sur internet les panneaux solaires | fais une recherche sur la loi climat | trouve des infos sur le cyclone | recherche les horaires de la barge | regarde sur le web le prix d'une pompe à chaleur | quelles sont les actualités du jour ? | cherche des articles sur l'intelligence artificielle | vérifie sur internet cette information
en: search the web for solar panels | look up today's news | find information about the cyclone
es: busca en internet paneles solares | busca las noticias de hoy | busca información sobre el ciclón
ar?: ابحث في الإنترنت عن الألواح الشمسية
ja?: ソーラーパネルについてネットで調べて
mathesis.confier
fr: apprends tout seul ce qu'est le protocole Matter | renseigne-toi sur les pompes à chaleur | étudie le sujet des batteries | apprends-en plus sur la domotique | va te documenter sur Proxmox
en: learn about the Matter protocol | study home batteries
es: aprende sobre el protocolo Matter | infórmate sobre las bombas de calor
mathesis.absorber
fr: absorbe le site exemple.org | lis tout le site blog.exemple.net | ajoute ce site à lire en entier | apprends tout ce site
en: absorb this whole website | read the entire site
es: absorbe esta web entera | lee todo este sitio
mathesis.ou_trouver
fr: où as-tu lu ça ? | d'où vient cette information ? | sur quelle page tu as trouvé ça ? | donne-moi la source
en: where did you read that? | what's the source?
es: ¿dónde leíste eso? | ¿cuál es la fuente?
kvasir.etudier
fr: étudie ce lien GitHub | regarde ce projet sur GitHub | analyse ce dépôt et dis-moi s'il nous sert | teste cette appli GitHub
en: study this GitHub link | look at this GitHub project
es: estudia este enlace de GitHub | mira este proyecto de GitHub
# ------------------------------------------------------------------ sons, voix
syrinx.musique
fr: quelle est cette musique ? | analyse ce morceau | quel est le tempo de cette chanson ? | reconnais cette musique | c'est quoi comme style de musique ?
en: what is this song? | analyse this track
es: ¿qué canción es esta? | analiza esta pista
syrinx.sons
fr: écoute les sons de la maison | qu'est-ce que c'est comme bruit ? | quel son a été entendu ? | il y a eu un bruit de verre cassé ?
en: what was that noise? | listen to the house sounds
es: ¿qué fue ese ruido? | escucha los sonidos de la casa
syrinx.parole
fr: qu'est-ce qui est dit dans cet enregistrement ? | transcris ce message vocal | écoute ce vocal et écris-le | qui parle dans cet audio ?
en: transcribe this voice note | what is said in this recording?
es: transcribe este audio | ¿qué se dice en esta grabación?
bragi.dire
fr: dis bonjour à voix haute | lis ce texte à voix haute | parle-moi | dis-le avec ta voix
en: say hello out loud | read this aloud
es: di hola en voz alta | lee esto en voz alta
bragi.annoncer
fr: annonce le dîner sur les enceintes | préviens toute la maison que c'est l'heure | annonce aux enfants qu'il faut se coucher | fais une annonce dans toutes les pièces
en: announce dinner on the speakers | tell the whole house it's time
es: anuncia la cena por los altavoces | avisa a toda la casa
rodd.dicter
fr: je veux dicter un texte | prends ma dictée | écris ce que je dis | passe en dictée vocale
en: I want to dictate | take my dictation
es: quiero dictar un texto | escribe lo que digo
# ------------------------------------------------------------------ code, scripts, automatisations
ivaldi.depots
fr: où en sont mes dépôts git ? | état de mes projets de code | il y a du travail non enregistré ? | liste mes dépôts
en: what's the status of my git repos? | list my repositories
es: ¿cómo están mis repositorios git? | lista mis repositorios
ivaldi.cloner
fr: clone ce dépôt GitHub | récupère ce projet git | télécharge le code de ce dépôt
en: clone this GitHub repo | get this git project
es: clona este repositorio | descarga este proyecto git
ivaldi.ouvrir_terminal
fr: ouvre un terminal | donne-moi une console | ouvre une ligne de commande sur le serveur
en: open a terminal | give me a console
es: abre una terminal | dame una consola
archytas.creer
fr: écris-moi un script qui renomme mes photos | crée un script de sauvegarde tous les soirs | fais un script qui vide la corbeille | automatise le tri de mes téléchargements avec un script
en: write a script that renames my photos | create a nightly backup script
es: escribe un script que renombre mis fotos | crea un script de copia nocturna
archytas.mes_scripts
fr: quels scripts j'ai ? | liste mes scripts | montre les scripts d'Odin
en: list my scripts | which scripts do I have?
es: lista mis scripts | ¿qué scripts tengo?
draupnir.lister
fr: quelles automatisations j'ai ? | liste mes automatisations | montre ce qui se fait tout seul
en: list my automations | what runs automatically?
es: lista mis automatizaciones | ¿qué se hace solo?
draupnir.executer
fr: lance l'automatisation du matin | exécute la routine du soir | démarre l'automatisation des sauvegardes
en: run the morning automation | start the evening routine
es: ejecuta la automatización de la mañana | lanza la rutina de la noche
# ------------------------------------------------------------------ sites, surveillance, accès
idunn.sites
fr: comment vont mes sites web ? | état de mes sites | mes sites marchent ? | liste de mes sites
en: how are my websites doing? | are my sites up?
es: ¿cómo están mis webs? | ¿funcionan mis sitios?
idunn.deployer
fr: déploie mon site web | mets en ligne la nouvelle version du site | publie les changements du site
en: deploy my website | publish the new version of the site
es: despliega mi web | publica la nueva versión
vordr.ajouter
fr: surveille mon site et préviens-moi s'il tombe | ajoute une surveillance sur le serveur | vérifie toutes les minutes que le site répond
en: monitor my site and alert me if it goes down | watch the server
es: vigila mi web y avísame si se cae | vigila el servidor
var.ajouter
fr: ajoute Paul aux utilisateurs | crée un compte pour ma sœur | donne un accès à mon collègue
en: add Paul as a user | create an account for my sister
es: añade a Paul como usuario | crea una cuenta para mi hermana
skidbladnir.lien
fr: partage ce dossier avec un lien | crée un lien de partage pour ces photos | envoie-moi un lien pour télécharger le fichier
en: share this folder with a link | create a share link
es: comparte esta carpeta con un enlace | crea un enlace para compartir
atalante.ajouter
fr: télécharge ce fichier | ajoute ce lien aux téléchargements | récupère ce gros fichier en plusieurs morceaux
en: download this file | add this link to downloads
es: descarga este archivo | añade este enlace a las descargas
gna.trajets
fr: où est passé le téléphone de ma fille ? | quel trajet a fait Léa aujourd'hui ? | montre les déplacements de la famille | où était Paul cet après-midi ?
en: where has my daughter's phone been? | show the family's trips
es: ¿dónde ha estado el móvil de mi hija? | muestra los trayectos de la familia
apparence.theme
fr: change le thème d'Odin | mets le thème sombre | passe en couleurs claires | change les couleurs de l'écran
en: change Odin's theme | switch to dark mode
es: cambia el tema de Odin | pon el modo oscuro
syn.creer
fr: crée un tableau de bord de la température | fais un graphique de la consommation | ajoute un tableau de bord du réseau
en: create a temperature dashboard | make a power usage chart
es: crea un panel de temperatura | haz un gráfico del consumo
pronoia.previsions
fr: qu'est-ce que tu prévois pour demain ? | tes prévisions de la semaine | à quoi tu t'attends aujourd'hui ?
en: what do you expect tomorrow? | your forecasts for the week
es: ¿qué prevés para mañana? | tus previsiones de la semana
mimisbrunnr.chercher
fr: cherche les erreurs dans les journaux | qu'est-ce qui s'est mal passé cette nuit dans les logs ? | trouve les messages d'erreur du système
en: search the logs for errors | what went wrong last night?
es: busca errores en los registros | ¿qué falló anoche?
leikvangr.lancer
fr: lance un jeu de Super Nintendo | je veux jouer à Mario | démarre un jeu rétro
en: start a Super Nintendo game | I want to play Mario
es: inicia un juego de Super Nintendo | quiero jugar a Mario
commandes.chercher
fr: quelles commandes je peux te dire ? | montre-moi les commandes possibles | comment je te demande de bloquer un site ?
en: what commands can I use? | show me the possible commands
es: ¿qué órdenes puedo usar? | muéstrame los comandos posibles
# ------------------------------------------------------------------ ce qu'Odin ne sait pas encore faire
aucune.pas_encore
fr: réserve-moi une table au restaurant samedi | prends-moi un billet de train pour Lyon | trouve-moi le vol le moins cher pour Paris | compare les billets de bateau pour Anjouan | à quelle heure passe le prochain bus ? | dans combien de temps arrive le bus ? | où suis-je ? | achète-moi des piles sur internet | commande une pizza | postule à cette offre d'emploi | annule ma réservation d'hôtel | demande le remboursement de mon billet | prends-moi une place de cinéma ce soir | quels films passent au cinéma près de chez moi ? | crée une GPO qui bloque les clés USB | désabonne-moi de cette newsletter
en: book me a table for two tomorrow | buy me a plane ticket to Paris | when is the next bus? | where am I right now? | order me a pizza | apply for this job for me
es: resérvame una mesa para el sábado | cómprame un billete de avión | ¿cuándo pasa el próximo autobús? | ¿dónde estoy? | pídeme una pizza | envía mi candidatura a esta oferta
ar?: احجز لي طاولة في مطعم
ja?: レストランを予約して
# ------------------------------------------------------------------ d'autres langues (allemand, italien, portugais ; chinois et russe à relire)
gladsheim.meteo
de: wie wird das Wetter morgen? | regnet es heute?
it: che tempo fa oggi? | domani piove?
pt: como está o tempo hoje? | vai chover amanhã?
zh?: 今天天气怎么样？
ru?: какая сегодня погода?
frigg.agenda
de: welche Termine habe ich morgen? | zeig mir meinen Kalender
it: che appuntamenti ho domani? | mostrami l'agenda
pt: que compromissos tenho amanhã? | mostra a minha agenda
zh?: 我明天有什么安排？
ru?: какие у меня встречи завтра?
freyja.regarder
de: spiel die nächste Folge ab | ich möchte einen Film sehen
it: metti il prossimo episodio | voglio guardare un film
pt: põe o próximo episódio | quero ver um filme
zh?: 播放下一集
ru?: включи следующую серию
aegir.jouer
de: spiel etwas Musik | spiel Jazz im Wohnzimmer
it: metti un po' di musica | metti del jazz in salotto
pt: põe música | põe jazz na sala
zh?: 放点音乐
ru?: включи музыку
appareils.commander
de: mach das Licht im Wohnzimmer an | schließ die Rollläden
it: accendi la luce del soggiorno | chiudi le tapparelle
pt: acende a luz da sala | fecha as persianas
zh?: 打开客厅的灯
ru?: включи свет в гостиной
gjoll.appareils
de: wer ist mit dem VPN verbunden? | zeig die Geräte im VPN
it: chi è connesso alla VPN? | mostra i dispositivi della VPN
pt: quem está ligado à VPN? | mostra os dispositivos da VPN
zh?: 谁连接了VPN？
ru?: кто подключён к VPN?
eir.processus
de: welche Programme laufen gerade? | was verbraucht die CPU?
it: quali programmi sono in esecuzione? | cosa usa la CPU?
pt: que programas estão a correr? | o que está a usar a CPU?
zh?: 现在有哪些程序在运行？
ru?: какие программы сейчас запущены?
vidarr.bloquer
de: sperr diese Webseite für alle | blockiere diese Domain
it: blocca questo sito per tutti | blocca questo dominio
pt: bloqueia este site para todos | bloqueia este domínio
zh?: 为全家屏蔽这个网站
ru?: заблокируй этот сайт для всех
sindri.sauvegarder
de: mach jetzt eine Sicherung | sichere meinen Dokumente-Ordner
it: fai subito un backup | salva la cartella Documenti
pt: faz uma cópia de segurança agora | guarda a pasta Documentos
zh?: 现在备份我的文件
ru?: сделай резервную копию сейчас
ullr.analyser
de: such nach Viren | scanne meinen USB-Stick
it: cerca virus | scansiona la mia chiavetta USB
pt: procura vírus | analisa a minha pen USB
zh?: 扫描病毒
ru?: проверь компьютер на вирусы
brisingamen.generer
de: erstell ein sicheres Passwort | ich brauche ein neues Passwort
it: genera una password sicura | mi serve una nuova password
pt: gera uma palavra-passe segura | preciso de uma senha nova
zh?: 生成一个强密码
ru?: придумай надёжный пароль
volva.chercher
de: such im Internet nach Solaranlagen | was gibt es Neues heute?
it: cerca su internet i pannelli solari | quali sono le notizie di oggi?
pt: pesquisa na internet painéis solares | quais são as notícias de hoje?
zh?: 在网上搜索太阳能板
ru?: найди в интернете солнечные панели
ymir.creer_machine
de: erstell eine virtuelle Debian-Maschine | richte eine Test-VM ein
it: crea una macchina virtuale Debian | prepara una VM di prova
pt: cria uma máquina virtual Debian | prepara uma VM de teste
thjalfi.cle_preparer
de: mach einen bootfähigen USB-Stick | spiel Ubuntu auf den USB-Stick
it: prepara una chiavetta USB avviabile | metti Ubuntu sulla chiavetta
pt: prepara uma pen USB de arranque | põe o Ubuntu na pen
dvalinn.convertir
de: wandle diese Datei in PDF um | mach aus diesem Video ein MP3
it: converti questo file in PDF | trasforma questo video in mp3
pt: converte este ficheiro em PDF | transforma este vídeo em mp3
himinbjorg.photo
de: mach ein Foto mit der Gartenkamera | zeig mir die Kamera an der Haustür
it: scatta una foto con la telecamera del giardino | fammi vedere la telecamera dell'ingresso
pt: tira uma foto com a câmara do jardim | mostra-me a câmara da entrada
aucune.pas_encore
de: reservier mir einen Tisch im Restaurant | kauf mir ein Zugticket
it: prenotami un tavolo al ristorante | comprami un biglietto del treno
pt: reserva-me uma mesa no restaurante | compra-me um bilhete de comboio
`;

export const DEMANDES_V2: DemandeV2[] = lireDemandesV2(DEMANDES_V2_TEXTE);
