// Venus dans Odin, l'interface (lot V1). Les écrans reprennent la structure, les classes et les textes des composants du
// dépôt TOUFATECH/Venus (licence MIT) : web/components/Shell.js (coque), public/js/menu.js (menu, « Plus », « Tout »),
// pages/Home.js (accueil), Browse.js (Films, Séries, Animés, Clips, Ma liste), pages/Details.js (fiche), Palette.js
// (Ctrl+K), Search.js (recherche), Gates.js (« Qui regarde ? »), Settings.js (thème et menu). Seul ajout : « ‹ Odin » (absent quand Vénus est ouverte dans Odin).
//
// Les données sont les VRAIES de Vénus dans Odin (bibliothèque déjà scannée, reprise, ma liste) : /venus/api/* et les
// routes /venus/* d'avant. Les affiches, fonds, résumés, genres, notes et la distribution (lot V3) viennent des fiches
// gardées par Odin, ou des vignettes tirées des vidéos ; ce qui manque reste vide, et l'écran le dit : rien n'est inventé. Les textes passent par t() (dictionnaire, toutes les langues) ;
// les dates et les nombres par Intl. Les icônes et les planètes viennent de planetes.js (chargé avant ce fichier).
'use strict';
(() => {
  const W = typeof window !== 'undefined' ? window : globalThis;
  const D = typeof document !== 'undefined' ? document : null;
  // Ouverte DANS Odin (la vue « Vénus » de la page d'Odin, un cadre de la même adresse) : le menu d'Odin est déjà à côté,
  // donc pas de « ‹ Odin » ; un lien vers Odin s'ouvre dans la page d'Odin elle-même, jamais dans ce cadre.
  const DANS_ODIN = (() => { try { return Boolean(D) && Boolean(W.top) && W.top !== W && W.top.location.origin === W.location.origin; } catch { return false; } })();
  const versOdin = (u) => { (DANS_ODIN ? W.top : W).location.href = u; };

  // ---------------------------------------------------------------- textes (dictionnaire) et formats (Intl)
  // La clé est le texte français ; une langue ajoute ses traductions ici. Ce qui manque reste en français.
  const TXT = {
    en: {
      'Accueil': 'Home', 'Films': 'Movies', 'Séries': 'TV shows', 'Animés': 'Anime', 'Clips': 'Music videos', 'Ma liste': 'My list',
      'Recherche': 'Search', 'Réglages': 'Settings', 'Plus': 'More', 'Tout': 'All', 'Revenir à Odin': 'Back to Odin',
      'Qui regarde ?': 'Who’s watching?', 'Lecture': 'Play', 'Reprendre': 'Resume', 'Plus d’infos': 'More info',
      'Tout Venus': 'All of Venus', 'Au hasard': 'Shuffle', 'Filtres': 'Filters', 'Bibliothèque': 'Library', 'À venir': 'Upcoming',
      'Nouveau': 'Request', 'Nouveautés': 'New releases', 'Mes envies': 'My wishes', 'Dans Venus': 'In Venus', 'En téléchargement': 'Downloading',
      'Télécharger': 'Download', 'Favori': 'Favourite', 'En favori': 'Favourited', 'Disponible': 'Available', 'Pas disponible': 'Not available',
      'Disponibles': 'Available', 'Pas disponibles': 'Not available', 'Mes favoris': 'My favourites', 'Aujourd’hui': 'Today', 'Hier': 'Yesterday', 'Demain': 'Tomorrow',
      'Ajouter': 'Add', 'Ajouté': 'Added', 'Demander': 'Request', 'Accepter': 'Accept', 'Jeter': 'Discard', 'Annuler': 'Cancel', 'Mettre en pause': 'Pause',
      'Demandes': 'Requests', 'Demandes au nom de chacun': 'Requests on behalf of each person', 'À valider': 'To approve', 'Valider': 'Approve', 'Refuser': 'Decline',
      'Enregistrer': 'Save', 'Tester': 'Test', 'Retirer': 'Remove',
      // le lecteur (lecteur.js)
      'Retour': 'Back', 'Lecture / pause': 'Play / pause', 'Reculer de 10 secondes': 'Back 10 seconds', 'Avancer de 10 secondes': 'Forward 10 seconds',
      'Position de lecture': 'Playback position', 'Audio et sous-titres': 'Audio and subtitles', 'Vitesse de lecture': 'Playback speed', 'Chapitres': 'Chapters',
      'Épisode suivant': 'Next episode', 'Épisode précédent': 'Previous episode', 'Épisodes': 'Episodes', 'Diffuser sur un écran': 'Play on a screen', 'Plein écran': 'Full screen',
      'Image dans l’image': 'Picture in picture', 'Mode nuit (son égalisé)': 'Night mode (levelled sound)', 'Minuterie de sommeil': 'Sleep timer', 'Partager un extrait': 'Share a clip',
      'Format de l’image': 'Picture format', 'Mode Ambiance': 'Ambient mode', 'Regarder ensemble': 'Watch together', 'Ensemble': 'Together', 'Couper le son': 'Mute', 'Remettre le son': 'Unmute',
      'Volume': 'Volume', 'Passer l’intro': 'Skip intro', 'Passer le générique': 'Skip credits', 'Lecteur vidéo': 'Video player', 'Lecteur vidéo : {t}': 'Video player: {t}',
      'Lire maintenant': 'Play now', 'Épisode suivant · {e}': 'Next episode · {e}', 'Lire maintenant : {t}': 'Play now: {t}', 'S{s} É{e}': 'S{s} E{e}', 'Saison {s}, épisode {e}': 'Season {s}, episode {e}',
      'Audio': 'Audio', 'Sous-titres': 'Subtitles', 'Désactivés': 'Off', 'Forcés': 'Forced', 'Décalage': 'Offset', 'Piste {n}': 'Track {n}', 'bientôt': 'coming soon',
      'Il reste {t}': '{t} left', 'Se termine à {h}': 'Ends at {h}', 'Pendant la pause': 'While paused', 'La série': 'The show', 'La fiche': 'Details', 'Qualité': 'Quality', 'Originale': 'Original',
      // affiches, fiches et distribution (lot V3)
      'Genres': 'Genres', 'Note minimale': 'Minimum rating', 'Toutes': 'All', '{n} et plus': '{n} and up', 'Note moyenne': 'Average rating', 'Mieux notés': 'Best rated', 'Moins bien notés': 'Worst rated',
      'Critiques': 'Critics', 'Public': 'Audience', 'Note des critiques : {n} sur 10': 'Critics rating: {n} out of 10', 'Note du public : {n} sur 10': 'Audience rating: {n} out of 10', 'Distribution et équipe': 'Cast and crew',
      'Dans votre médiathèque': 'In your library', 'Rien d’autre de cette personne dans votre médiathèque.': 'Nothing else with this person in your library.', 'Plus de ce genre': 'More like this', 'Avec {n}': 'With {n}',
      'Pas encore d’informations sur la distribution de ce titre.': 'No cast information for this title yet.', 'Note {n} et plus': 'Rating {n} and up',
      'Pas de résumé : choisissez un catalogue dans Réglages → Demandes pour les affiches, résumés et distribution.': 'No summary: choose a catalogue in Settings → Requests for posters, summaries and cast.',
      'Pas encore de filtre possible : genres et notes arrivent avec les fiches des titres (Réglages → Demandes).': 'No filters yet: genres and ratings come with title details (Settings → Requests).',
      // pistes audio, qualités, sous-titres, bande-annonce (suite du lot V2)
      'Stéréo': 'Stereo', 'Mono': 'Mono', 'Audio : {l}': 'Audio: {l}', 'Qualité {q}': 'Quality {q}', 'Qualité originale': 'Original quality', 'Qualité {q} : {r}': 'Quality {q}: {r}', 'Auto': 'Auto',
      'la meilleure possible ici : l’originale': 'the best possible here: original',
      'Conversion par Odin : qualité réduite à {q}': 'Converted by Odin: quality reduced to {q}', 'Conversion par Odin : une autre piste audio est lue': 'Converted by Odin: another audio track is playing',
      'Auto choisit la meilleure qualité possible. Baissez-la si la vidéo saccade ou pour économiser vos données. La pastille en haut à droite ouvre cette fenêtre.': 'Auto picks the best possible quality. Lower it if the video stutters or to save data. The badge at the top right opens this window.',
      'Odin regarde ce que cette machine peut produire…': 'Odin is checking what this machine can produce…', 'Odin est injoignable : la lecture reste en « Originale ».': 'Odin cannot be reached: playback stays on “Original”.',
      'Odin est injoignable : la lecture reste comme elle est.': 'Odin cannot be reached: playback stays as it is.', 'Conversion impossible pour le moment.': 'Conversion is not possible right now.',
      'La conversion s’est arrêtée : retour à la piste et à la qualité d’origine.': 'The conversion stopped: back to the original track and quality.',
      'taille inconnue': 'unknown size', 'l’original n’est pas plus grand': 'the original is not larger', 'FFmpeg introuvable': 'FFmpeg not found', 'cette machine ne suit pas': 'this machine cannot keep up', 'mesure plus tard': 'measured later', 'fichier absent': 'file missing',
      'La taille de l’image de ce fichier n’est pas connue : relancez un scan.': 'The picture size of this file is unknown: run a scan again.',
      'L’original n’est pas plus grand que cette qualité : il n’y a rien à réduire.': 'The original is not larger than this quality: there is nothing to reduce.',
      'FFmpeg est introuvable pour Odin : il sert à convertir. Installez-le sur la machine d’Odin, puis redémarrez Odin.': 'Odin cannot find FFmpeg, which does the converting. Install it on Odin’s machine, then restart Odin.',
      'Cette machine ne convertit pas assez vite pour cette qualité : l’image attendrait.': 'This machine does not convert fast enough for this quality: the picture would stall.',
      'Odin convertit déjà une vidéo : il mesurera ce que la machine peut produire quand elle sera finie.': 'Odin is already converting a video: it will measure what the machine can produce when that one is done.',
      'Le fichier de ce titre n’est plus à sa place : rebranchez le disque ou relancez un scan.': 'The file for this title is no longer in place: plug the disk back in or run a scan again.',
      'Ces sous-titres sont des images, pas du texte : Odin ne sait pas les afficher.': 'These subtitles are pictures, not text: Odin cannot display them.', 'en images': 'pictures',
      'Sous-titres incomplets : cette vidéo est longue à lire, seul le début est là.': 'Incomplete subtitles: this video takes long to read, only the beginning is there.',
      'Chercher des sous-titres': 'Search for subtitles', 'Apparence des sous-titres': 'Subtitle appearance', 'Odin regarde dans la vidéo et à côté…': 'Odin is looking inside the video and next to it…',
      'Recherche impossible pour le moment.': 'Search is not possible right now.', 'Dans la vidéo et à côté': 'In the video and next to it', 'Trouvé à l’instant': 'Just found', 'En ligne': 'Online',
      'Aucun sous-titre dans cette vidéo ni à côté.': 'No subtitles in this video or next to it.',
      'Aucun service de sous-titres n’est réglé dans Odin : rien n’est cherché sur Internet.': 'No subtitle service is set up in Odin: nothing is searched on the Internet.',
      'Aucun service de sous-titres n’est réglé dans Odin : rien n’est cherché sur Internet. Posez un fichier .srt, .vtt ou .ass à côté de la vidéo, avec le même nom (par exemple « Titre.fr.srt ») : Odin le trouve ici, sans nouveau scan.': 'No subtitle service is set up in Odin: nothing is searched on the Internet. Put a .srt, .vtt or .ass file next to the video, with the same name (for example “Title.en.srt”): Odin finds it here, without a new scan.',
      'Bande-annonce': 'Trailer', 'Pas de bande-annonce.': 'No trailer.', 'Cette bande-annonce ne peut pas être lue pour le moment.': 'This trailer cannot be played right now.',
      'Pas de bande-annonce : posez-en une à côté du film (même nom, puis « -trailer », par exemple « Titre-trailer.mp4 »). Odin n’en lit aucune sur Internet : aucun réglage ne le permet.': 'No trailer: put one next to the film (same name, then “-trailer”, for example “Title-trailer.mp4”). Odin plays none from the Internet: no setting allows it.',
      'Pas de bande-annonce pour une série pour l’instant. Odin n’en lit aucune sur Internet : aucun réglage ne le permet.': 'No trailer for a show for now. Odin plays none from the Internet: no setting allows it.',
      'Réessayer': 'Try again', 'La lecture n’a pas pu démarrer': 'Playback could not start', '{quoi} : bientôt dans Odin.': '{quoi}: coming soon in Odin.', 'Chargement…': 'Loading…',
      // À venir, Mes envies, Nouveautés (Upcoming.js, Nouveautes.js) et le calendrier
      'Impossible pour le moment.': 'Not possible right now.', 'S{s}:É{e}': 'S{s}:E{e}', 'Épisode {n}': 'Episode {n}', 'Sortie': 'Release', 'Au cinéma': 'In cinemas',
      '{n} sortie': '{n} release', '{n} sorties': '{n} releases', '{n} épisode': '{n} episode', '{n} épisodes': '{n} episodes', '{n} envie': '{n} wish', '{n} envies': '{n} wishes',
      'Retirer des favoris': 'Remove from favourites', 'Favori : téléchargé automatiquement': 'Favourite: downloaded automatically',
      'Retirer « {t} » des favoris': 'Remove “{t}” from favourites', 'Mettre « {t} » en favori (téléchargement automatique)': 'Add “{t}” to favourites (automatic download)',
      'Déjà suivi par {a} : téléchargé dès sa sortie': 'Already followed by {a}: downloaded as soon as it is out', 'Télécharger avec {a}': 'Download with {a}', 'Suivi par {a}': 'Followed by {a}',
      'Impossible d’afficher les sorties': 'Cannot show the releases', 'Régler le catalogue des sorties': 'Set up the release catalogue', 'Aucun catalogue des sorties n’est réglé.': 'No release catalogue is set up.',
      'Aucun favori à venir.': 'No upcoming favourites.', 'Rien de disponible pour ces jours-ci.': 'Nothing available for these days.', 'Rien d’annoncé pour l’instant.': 'Nothing announced yet.',
      'Le catalogue ne répond pas pour l’instant : {e}': 'The catalogue is not answering right now: {e}', 'Afficher': 'Show', 'Favori = téléchargé automatiquement par {a}': 'Favourite = downloaded automatically by {a}',
      'Films à découvrir': 'Movies to discover', 'Animés à découvrir': 'Anime to discover', 'Séries à découvrir': 'TV shows to discover', 'pas encore disponibles': 'not available yet',
      'Voir les {n} jours précédents': 'Show the previous {n} days', 'Favori : le titre rejoint « Mes envies » et {a} le télécharge dès qu’il est disponible.': 'Favourite: the title joins “My wishes” and {a} downloads it as soon as it is available.',
      "Aucun catalogue des films n'est réglé : « À venir » ne lit rien sur Internet tant que tu n'en as pas choisi un (Réglages → Demandes).": 'No movie catalogue is set up: “Upcoming” reads nothing from the Internet until you choose one (Settings → Requests).',
      "Aucun programme des séries n'est réglé : « À venir » ne lit rien sur Internet tant que tu ne l'as pas activé (Réglages → Demandes).": 'No TV show schedule is set up: “Upcoming” reads nothing from the Internet until you turn it on (Settings → Requests).',
      "Aucun programme des animés n'est réglé : « À venir » ne lit rien sur Internet tant que tu ne l'as pas activé (Réglages → Demandes).": 'No anime schedule is set up: “Upcoming” reads nothing from the Internet until you turn it on (Settings → Requests).',
      'Vos envies sont visibles par les adultes de la maison, qui décident du téléchargement.': 'Your wishes are visible to the adults of the household, who decide on the download.',
      'Chaque envie est demandée à Hnoss tout de suite : le téléchargement démarre dès que le titre sort. Une fois arrivé, il passe dans « Dans Venus ».': 'Each wish is requested from Hnoss right away: the download starts as soon as the title is out. Once it arrives, it moves to “In Venus”.',
      'Aucune envie pour l’instant.': 'No wishes yet.', 'Dans Films, Séries ou Animés, onglet « À venir », le ♡ ajoute un titre ici et le fait télécharger.': 'In Movies, TV shows or Anime, “Upcoming” tab, the ♡ adds a title here and has it downloaded.',
      'Voir ce qui arrive': 'See what is coming', 'Film': 'Movie', 'Animé': 'Anime', 'Série': 'TV show', 'Retirer {t} de mes envies': 'Remove {t} from my wishes', 'Retiré de mes envies': 'Removed from my wishes',
      'Demandé, en attente de validation': 'Requested, waiting for approval', 'Demandé : téléchargé dès sa sortie': 'Requested: downloaded as soon as it is out', 'Demandé, recherche en cours': 'Requested, searching',
      'Téléchargement en cours': 'Downloading', 'Disponible, arrive dans Venus': 'Available, arriving in Venus', 'Pas trouvé': 'Not found', 'Suivi': 'Followed',
      'Hnoss actif : demandez un titre, il se télécharge tout seul': 'Hnoss is on: request a title and it downloads by itself', 'Rien pour le moment': 'Nothing for now', 'Nouveautés indisponibles': 'New releases unavailable',
      'Les sites de référence ne répondent pas pour l’instant. Réessayez dans un moment.': 'The reference sites are not answering right now. Try again in a moment.', 'Ouvrir les réglages': 'Open settings',
      "Le programme des animés n'est pas activé (Réglages → Demandes).": 'The anime schedule is not turned on (Settings → Requests).',
      'Les nouveautés des films et des séries viennent du grand catalogue : ajoute sa clé (gratuite) dans Réglages → Demandes. Les animés marchent sans clé.': 'New movie and TV show releases come from the large catalogue: add its (free) key in Settings → Requests. Anime works without a key.',
      'Au cinéma en ce moment': 'In cinemas now', 'Bientôt au cinéma': 'Coming soon to cinemas', 'Tendances de la semaine': 'Trending this week', 'Nouveaux épisodes cette semaine': 'New episodes this week',
      'Diffusés aujourd’hui': 'Airing today', 'Cette saison': 'This season', 'En diffusion, les plus suivis': 'Airing now, most followed', 'La saison prochaine': 'Next season',
      'Sortie le {d}': 'Out on {d}', 'Le {d}': 'On {d}', 'Épisode {n} le {d}': 'Episode {n} on {d}', 'Note': 'Rating', 'dans Venus': 'in Venus', 'Déjà dans Venus': 'Already in Venus',
      'Retirer de mes envies': 'Remove from my wishes', 'Ajouter à mes envies': 'Add to my wishes', 'Dans mes envies': 'In my wishes',
      'Ajouter à mes envies : demandé à Hnoss dès maintenant, téléchargé dès sa sortie': 'Add to my wishes: requested from Hnoss now, downloaded as soon as it is out',
      'Dans Venus : voir la fiche': 'In Venus: see details', 'Demande envoyée…': 'Request sent…',
      '« {t} » retiré de vos favoris': '“{t}” removed from your favourites', '« {t} » en favori : le téléchargement est lancé': '“{t}” added to favourites: the download has started',
      '« {t} » ajouté à vos favoris · {d}': '“{t}” added to your favourites · {d}', '« {t} » ajouté à {a} : le téléchargement est lancé': '“{t}” added to {a}: the download has started',
      '« {t} » ajouté : le téléchargement commence': '“{t}” added: the download is starting',
      'Ajouter à mon calendrier': 'Add to my calendar', 'Les sorties de vos séries, films et favoris dans le calendrier de votre téléphone': 'Releases of your shows, movies and favourites in your phone’s calendar',
      'Les épisodes de vos séries, les sorties de films demandées et vos favoris apparaissent dans le calendrier de votre téléphone ou de votre ordinateur, mis à jour tout seuls.': 'Episodes of your shows, requested movie releases and your favourites appear in the calendar of your phone or computer, updated automatically.',
      'S’abonner (iPhone, Mac, Outlook)': 'Subscribe (iPhone, Mac, Outlook)', 'Copier le lien': 'Copy link', 'Lien copié': 'Link copied', 'Lien du calendrier': 'Calendar link',
      'Google Agenda : Paramètres → Ajouter un agenda → À partir de l’URL, puis collez le lien. Ce lien est personnel : ne le partagez pas. Il ne fonctionne que sur le réseau de la maison (ou à distance si Venus est accessible depuis Internet).': 'Google Calendar: Settings → Add calendar → From URL, then paste the link. This link is personal: do not share it. It only works on the home network (or remotely if Venus can be reached from the Internet).',
      // la maison (lot V8) : Ce soir, vote, statistiques, rétrospective, collections, téléchargements
      'Ce soir': 'Tonight', 'Collections': 'Collections', 'Séance': 'Watch party', 'Télécommande': 'Remote', 'Statistiques': 'Statistics', 'Téléchargements': 'Downloads', 'Rétrospective': 'Year in review',
      'Trois questions, trois idées à regarder': 'Three questions, three ideas to watch', '3 idées pour vous': '3 ideas for you', 'Sagas, collections et listes de lecture': 'Sagas, collections and playlists', 'Sagas et listes': 'Sagas and lists',
      'Vos heures, genres et séries préférées': 'Your hours, genres and favourite shows', 'Vos vidéos pour regarder sans réseau': 'Your videos to watch offline',
      'Bonsoir': 'Good evening', 'Bonjour': 'Hello', 'Quelle envie ce soir ?': 'What are you in the mood for tonight?', 'Quelle envie aujourd’hui ?': 'What are you in the mood for today?', 'Combien de temps devant vous ?': 'How much time do you have?', 'Avec qui ?': 'Who with?',
      'Rire': 'Laugh', 'Une comédie, quelque chose de léger': 'A comedy, something light', 'Frissonner': 'Get chills', 'Suspense, enquête, peur': 'Suspense, mystery, fear', 'Être ému': 'Be moved', 'Une belle histoire qui touche': 'A beautiful, touching story',
      'S’évader': 'Escape', 'Ailleurs, demain, l’aventure': 'Elsewhere, tomorrow, adventure', 'Apprendre': 'Learn', 'Documentaire, histoire vraie': 'Documentary, true story', 'Surprends-moi': 'Surprise me', 'Laissez Venus choisir': 'Let Venus choose',
      'Moins de 45 min': 'Under 45 min', 'Un épisode, un clip': 'An episode, a music video', 'Environ 1 h 30': 'About 1 h 30', 'Un film court ou deux épisodes': 'A short movie or two episodes', 'Toute la soirée': 'The whole evening', 'Tout le temps qu’il faut': 'As long as it takes', 'Un grand film, une série': 'A long movie, a show',
      'Seul': 'Alone', 'Rien que pour moi': 'Just for me', 'À deux': 'Two of us', 'En couple ou entre amis proches': 'As a couple or with close friends', 'En famille': 'With family', 'Avec des enfants': 'With children', 'Entre amis': 'With friends', 'Ambiance, rires, sensations': 'Fun, laughs, thrills',
      'Question {n} sur 3': 'Question {n} of 3', 'Question précédente': 'Previous question', 'Voici nos idées pour ce soir': 'Here are our ideas for tonight', 'Voici nos idées pour aujourd’hui': 'Here are our ideas for today', 'Rien ne correspond… pour l’instant': 'Nothing matches… for now',
      'Notre choix': 'Our pick', 'Idée {n}': 'Idea {n}', 'Trois autres idées': 'Three more ideas', 'Voter en famille': 'Family vote', 'Recommencer': 'Start over',
      'Épisodes de {n} min': '{n} min episodes', '{d}, fini à {h}': '{d}, ends at {h}', 'Tous publics': 'All ages', 'Dès {n} ans': 'Ages {n}+', 'Jamais commencée': 'Never started', 'Jamais vu': 'Never watched', 'Déjà commencé': 'Already started',
      '{n} épisode à voir': '{n} episode to watch', '{n} épisodes à voir': '{n} episodes to watch', '{n} h': '{n} h', '{n} min': '{n} min',
      'Odin ne connaît pas encore l’âge permis des titres : rien n’est proposé « en famille ».': 'Odin does not know the age ratings of titles yet: nothing is suggested “with family”.',
      'Essayez une autre envie ou plus de temps : votre bibliothèque n’a rien qui colle à ces trois critères.': 'Try another mood or more time: your library has nothing matching these three answers.',
      'Qui regarde ce soir ?': 'Who’s watching tonight?', 'Film pour tout le monde': 'A movie for everyone', 'Personnes présentes': 'People here', 'enfant': 'child', 'Choisissez au moins une personne.': 'Choose at least one person.', 'Recherche…': 'Searching…',
      'Cochez les personnes présentes : Venus propose ce que personne n’a vu, permis au plus jeune, et qui plaît à chacun.': 'Tick who is here: Venus suggests what nobody has seen, allowed for the youngest, and liked by everyone.',
      'Un enfant est présent : Odin ne connaît pas encore l’âge permis des titres, rien n’est proposé.': 'A child is here: Odin does not know the age ratings of titles yet, so nothing is suggested.',
      'Rien que tout ce monde n’ait pas déjà vu : essayez les séries, ou retirez quelqu’un.': 'Nothing that all these people have not already seen: try shows, or remove someone.',
      'Vote en famille': 'Family vote', 'QR code du vote': 'Vote QR code', 'Chacun scanne ce QR code avec son téléphone, ou ouvre Venus et tape le code :': 'Everyone scans this QR code with their phone, or opens Venus and types the code:',
      'Pas encore de voix': 'No votes yet', 'Lancer « {t} »': 'Play “{t}”', 'Voir le résultat': 'See the result', 'Le vote est terminé !': 'The vote is over!', 'Le vote est terminé.': 'The vote is over.',
      'Rejoindre le vote': 'Join the vote', 'Tapez le code à 4 lettres affiché sur la TV.': 'Type the 4-letter code shown on the TV.', 'Code du vote': 'Vote code', 'Rejoindre': 'Join', 'Le code fait 4 lettres.': 'The code is 4 letters long.', 'Vote introuvable ou terminé.': 'Vote not found or over.',
      'Ce soir, ce sera': 'Tonight it will be', '{v} sur {n}': '{v} out of {n}', '{n} voix': '{n} votes', 'Voir la fiche': 'See details', 'A voté !': 'Voted!', 'Que regarder ce soir ?': 'What to watch tonight?',
      'Vous pouvez changer d’avis tant que le vote est ouvert.': 'You can change your mind while the vote is open.', 'Proposé par {n}. Touchez votre choix.': 'Suggested by {n}. Tap your choice.',
      'Mes statistiques': 'My statistics', 'Ma rétrospective {y}': 'My {y} in review', 'Année': 'Year', 'D’après la progression gardée par Odin : un titre revu compte une fois, au jour de sa dernière lecture.': 'Based on the progress Odin keeps: a title watched again counts once, on the day it was last played.',
      'Rien de regardé en {y} pour l’instant': 'Nothing watched in {y} yet', 'Lancez un film ou un épisode : vos statistiques se rempliront toutes seules.': 'Play a movie or an episode: your statistics will fill in by themselves.',
      'regardées en {y}': 'watched in {y}', 'plus de {n} jour entier': 'more than {n} full day', 'plus de {n} jours entiers': 'more than {n} full days', 'Genre préféré :': 'Favourite genre:', 'Série la plus suivie :': 'Most watched show:', 'Animé le plus suivi :': 'Most watched anime:', 'Plus gros mois :': 'Biggest month:', 'Vous avez beaucoup vu': 'You watched a lot of',
      'film vu': 'movie watched', 'films vus': 'movies watched', 'épisode vu': 'episode watched', 'épisodes vus': 'episodes watched', 'jours avec une lecture': 'days with something played', '{n} j': '{n} d', 'plus longue série de jours': 'longest streak of days', 'depuis le début': 'since the start',
      'Jour par jour': 'Day by day', '{n} jour avec une lecture': '{n} day with something played', '{n} jours avec une lecture': '{n} days with something played', 'Calendrier {y} : {n}': '{y} calendar: {n}', 'Moins': 'Less', 'rien': 'nothing', '{a} : {b}': '{a}: {b}',
      'Mois par mois': 'Month by month', 'Films, séries, animés': 'Movies, shows, anime', 'Jours de la semaine': 'Days of the week', 'Heures de la journée': 'Hours of the day', '{a} h – {b} h': '{a}:00 – {b}:00',
      'Pas encore assez de données.': 'Not enough data yet.', 'Séries les plus regardées': 'Most watched shows', 'Animés les plus regardés': 'Most watched anime', 'Derniers films vus': 'Last movies watched', 'Rien pour l’instant.': 'Nothing yet.',
      'Votre année {y}': 'Your {y}', 'Rien de regardé pour l’instant': 'Nothing watched yet', 'Lancez un film ou un épisode : votre rétrospective se remplira toute seule.': 'Play a movie or an episode: your year in review will fill in by itself.',
      '{n}, votre année {y}': '{n}, your {y}', 'devant l’écran, soit {a}, sur {b}.': 'in front of the screen, that is {a}, over {b}.', 'devant l’écran, sur {b}.': 'in front of the screen, over {b}.',
      '{n} jour différent': '{n} different day', '{n} jours différents': '{n} different days', '{n} jour entier': '{n} full day', '{n} jours entiers': '{n} full days',
      'film vu jusqu’au bout.': 'movie watched to the end.', 'films vus jusqu’au bout.': 'movies watched to the end.', 'épisode regardé.': 'episode watched.', 'épisodes regardés.': 'episodes watched.', 'votre série de l’année : {h}': 'your show of the year: {h}',
      'Votre animé de l’année : {h}, {e}.': 'Your anime of the year: {h}, {e}.', 'Votre animé de l’année : {h}.': 'Your anime of the year: {h}.', 'Votre genre préféré': 'Your favourite genre', '{h} en tout.': '{h} in all.', 'Juste derrière : {g}.': 'Close behind: {g}.',
      'La personne que vous avez le plus vue': 'The person you saw the most', 'À l’écran ou derrière la caméra, elle était dans beaucoup de vos titres.': 'On screen or behind the camera, they were in many of your titles.',
      'Votre mois le plus chargé': 'Your busiest month', '{h} de visionnage.': '{h} of watching.', 'Record : {n} jours de suite.': 'Record: {n} days in a row.', 'Terminées cette année': 'Finished this year',
      'série ou animé vu en entier.': 'show or anime watched in full.', 'séries et animés vus en entier.': 'shows and anime watched in full.', '{y}, c’était ça': 'That was {y}', 'Merci, {n} !': 'Thank you, {n}!', 'À l’année prochaine pour de nouvelles histoires.': 'See you next year for new stories.',
      'diaporama': 'slideshow', 'Rétrospective {y}': '{y} in review', 'Revoir': 'Watch again', 'Tous les détails': 'All the details', 'Écran suivant': 'Next screen',
      'Collections ({n})': 'Collections ({n})', 'Listes de lecture ({n})': 'Playlists ({n})', 'Nouvelle liste': 'New list', 'Nouvelle collection': 'New collection', 'Listes de lecture': 'Playlists', 'Listes': 'Lists',
      'Aucune liste de lecture. Sur la fiche d’un titre, touchez « Ajouter à une liste ».': 'No playlists. On a title’s details, tap “Add to a list”.', 'Aucune collection pour l’instant.': 'No collections yet.',
      'Cette collection n’existe pas (ou plus).': 'This collection does not exist (anymore).', 'Cette liste n’existe pas (ou plus).': 'This list does not exist (anymore).', 'Renommer': 'Rename', 'Supprimer la collection': 'Delete the collection', 'Supprimer la liste': 'Delete the list',
      'Retirer « {t} »': 'Remove “{t}”', 'Retirer de la collection': 'Remove from the collection', 'Collection vide : ajoutez des titres avec « Ajouter à une liste » sur leur fiche.': 'Empty collection: add titles with “Add to a list” on their details.',
      'Continuer': 'Continue', 'Tout lire': 'Play all', 'Aléatoire': 'Shuffle', 'Monter': 'Move up', 'Descendre': 'Move down', 'Vu': 'Watched', 'Liste vide : sur la fiche d’un titre, touchez « Ajouter à une liste ».': 'Empty list: on a title’s details, tap “Add to a list”.',
      'Nouvelle liste de lecture': 'New playlist', 'Ex. : Marathon du dimanche': 'E.g.: Sunday marathon', 'Créer': 'Create', 'Donnez un nom à la liste': 'Give the list a name', 'Liste « {n} » créée avec {v}': 'List “{n}” created with {v}', 'Liste « {n} » créée': 'List “{n}” created',
      'Ex. : Films de Noël': 'E.g.: Christmas movies', 'Visible par tous les profils.': 'Visible to every profile.', 'Donnez un nom à la collection': 'Give the collection a name', 'Collection « {n} » créée': 'Collection “{n}” created',
      'Ajouter à une liste': 'Add to a list', 'Ajouter « {t} »': 'Add “{t}”', '{n} titre': '{n} title', '{n} titres': '{n} titles', '{n} vidéo': '{n} video', '{n} vidéos': '{n} videos',
      'Ajouté à la collection « {n} »': 'Added to the collection “{n}”', 'Ajouté à « {n} » ({e})': 'Added to “{n}” ({e})', 'Ajouté à « {n} »': 'Added to “{n}”', 'Déjà dans « {n} »': 'Already in “{n}”',
      'Renommer la collection': 'Rename the collection', 'Renommer la liste': 'Rename the list', 'Le nom est obligatoire': 'A name is required', 'Supprimer': 'Delete',
      'Supprimer la collection « {n} » ? Les vidéos restent dans Venus.': 'Delete the collection “{n}”? The videos stay in Venus.', 'Supprimer la liste « {n} » ? Les vidéos restent dans Venus.': 'Delete the list “{n}”? The videos stay in Venus.',
      '« {t} » retiré': '“{t}” removed', '« {t} » retiré de la liste': '“{t}” removed from the list',
      'Télécharger « {t} »': 'Download “{t}”', 'Fichier d’origine': 'Original file', 'Meilleure qualité': 'Best quality', 'Version légère 720p': 'Light version 720p', 'Très légère 480p': 'Very light 480p', 'Idéale pour un téléphone ou une tablette': 'Ideal for a phone or tablet', 'Pour garder de la place': 'To save space',
      '{n} Go': '{n} GB', '{n} Mo': '{n} MB',
      'Suivant': 'Next', 'Ajouté récemment': 'Recently added', '{n} ép.': '{n} ep.', 'Type': 'Type',
      // la maison, seconde part : Séance, Télécommande, versions légères et liste des téléchargements
      'Regarder ensemble, chacun sur son écran': 'Watch together, each on your own screen', 'Piloter Venus avec votre téléphone': 'Control Venus with your phone',
      'Rejoindre une séance': 'Join a watch party', 'Code de la séance': 'Watch party code', 'Séance introuvable.': 'Watch party not found.', 'Lancer votre propre séance': 'Start your own watch party',
      'Regardez le même film au même moment que vos proches, chacun chez soi. Pause, retour en arrière, réactions et discussion sont partagés.': 'Watch the same movie at the same time as your loved ones, each at home. Pause, rewind, reactions and chat are shared.',
      'Lancez un film ou un épisode.': 'Play a movie or an episode.', 'Dans le lecteur, touchez « Ensemble ».': 'In the player, tap “Together”.', 'Partagez le code de 4 lettres ou le QR code.': 'Share the 4-letter code or the QR code.',
      'Dans Odin, « Ensemble » arrive avec le lecteur : pour l’instant, rejoindre une séance ouvre son titre, sans pause partagée.': 'In Odin, “Together” comes with the player: for now, joining a watch party opens its title, without shared pause.',
      'Choisir l’écran à piloter': 'Choose the screen to control', 'Les écrans de la maison que connaît Odin. La télécommande pilote la lecture de l’écran choisi.': 'The home screens Odin knows. The remote controls playback on the chosen screen.',
      'Aucune box domotique n’est reliée à Odin : aucun écran à piloter. Reliez-la dans Midgard, « Relier une box ».': 'No home automation box is connected to Odin: no screen to control. Connect it in Midgard, “Relier une box”.', 'Aucun écran trouvé dans la box domotique.': 'No screen found in the home automation box.',
      'En lecture': 'Playing', 'Allumé': 'On', 'Éteint': 'Off', 'Reliée à l’écran de {n}': 'Connected to the {n} screen', 'Changer': 'Change', '−30 s': '−30 s', '+30 s': '+30 s', 'Lecture / pause': 'Play / pause',
      'Odin pilote cet écran par la box domotique : lecture, pause et ±30 s. La croix, Retour, Accueil, la recherche, les chaînes et « Reprendre sur la TV » de Venus ne sont pas encore là.': 'Odin controls this screen through the home automation box: play, pause and ±30 s. Venus’s arrows, Back, Home, search, channels and “Resume on TV” are not there yet.',
      'Un autre téléphone': 'Another phone', 'Le QR code de la télécommande d’Odin : il ne pilote que cet écran, expire tout seul et se coupe depuis Odin.': 'The QR code of Odin’s remote: it only controls this screen, expires by itself and can be revoked from Odin.',
      'Afficher le QR code': 'Show the QR code', 'Télécommande pour un autre téléphone': 'Remote for another phone', 'QR code de la télécommande': 'Remote QR code', 'Scannez ce QR code avec le téléphone, ou ouvrez ce lien :': 'Scan this QR code with the phone, or open this link:',
      'Valable jusqu’à {h}.': 'Valid until {h}.', 'Lien de la télécommande': 'Remote link', 'L’écran ne répond pas.': 'The screen is not responding.',
      'Les vidéos sont enregistrées sur votre appareil : elles se regardent ensuite sans réseau. Sur iPhone, choisissez « Enregistrer dans Fichiers » puis ouvrez-les avec l’appli Fichiers ou VLC. Les versions légères restent prêtes 7 jours sur le serveur.': 'Videos are saved on your device: you can then watch them offline. On iPhone, choose “Save to Files” then open them with the Files app or VLC. Light versions stay ready on the server for 7 days.',
      'Aucun téléchargement. Sur la fiche d’un film ou d’une saison, touchez « Télécharger ».': 'No downloads. On a movie’s or a season’s details, tap “Download”.', 'Version légère {q}': 'Light version {q}',
      'Télécharger la saison': 'Download the season', '≈ {n} Go par heure': '≈ {n} GB per hour', '{n} épisodes en préparation ({q})': '{n} episodes being prepared ({q})', 'Voir': 'View',
      'En attente': 'Queued', 'Préparation': 'Preparing', 'Prêt': 'Ready', 'Échec': 'Failed', '{n} %': '{n}%',
      'Les versions légères sont préparées par le serveur, puis disponibles dans « Téléchargements ».': 'Light versions are prepared by the server, then available in “Downloads”.',
      '« {t} » en préparation ({q})': '“{t}” being prepared ({q})', 'Un profil enfant ne télécharge pas.': 'A child profile does not download.', 'Trop de téléchargements : supprimez-en un avant d’en préparer un autre.': 'Too many downloads: delete one before preparing another.',
      'Ce titre n’est pas (ou plus) dans la bibliothèque.': 'This title is not (or no longer) in the library.',
      'FFmpeg est introuvable pour Odin : la version légère ne peut pas être préparée. Installez FFmpeg sur la machine d’Odin, puis redémarrez Odin.': 'FFmpeg cannot be found by Odin: the light version cannot be prepared. Install FFmpeg on Odin’s machine, then restart Odin.',
      'Pas assez de place sur le disque d’Odin pour préparer cette version.': 'Not enough space on Odin’s disk to prepare this version.', 'Le fichier de ce titre n’est plus à sa place (disque débranché, fichier déplacé).': 'This title’s file is no longer in its place (disk unplugged, file moved).',
      'La conversion a échoué.': 'The conversion failed.', 'La conversion a pris trop de temps : elle a été arrêtée.': 'The conversion took too long: it was stopped.',
    },
  };
  const LANG = String((D && D.documentElement.lang) || (W.navigator && W.navigator.language) || 'fr');
  const t = (k, v = {}) => { const d = (TXT[LANG.slice(0, 2)] || {})[k] ?? k; return String(d).replace(/\{(\w+)\}/g, (_, x) => (v[x] ?? '')); };
  const plur = (() => { try { return new Intl.PluralRules(LANG); } catch { return { select: (n) => (n === 1 ? 'one' : 'other') }; } })();
  /** « 1 film », « 3 films » : la forme suit les règles de la langue (Intl.PluralRules). */
  const tn = (n, un, plusieurs) => t(plur.select(n) === 'one' ? un : plusieurs, { n: nombre(n) });
  const nombre = (n) => { try { return new Intl.NumberFormat(LANG).format(n); } catch { return String(n); } };
  const date = (ms, o) => { try { return new Intl.DateTimeFormat(LANG, o).format(new Date(ms)); } catch { return new Date(ms).toDateString(); } };
  const duree = (min) => { if (!min) return ''; const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? t('{h} h {m}', { h: nombre(h), m: String(m).padStart(2, '0') }) : t('{m} min', { m: nombre(m) }); };
  const reste = (p) => (p && p.duration ? t('{n} min restantes', { n: nombre(Math.max(1, Math.round((p.duration - p.position) / 60))) }) : '');

  // ---------------------------------------------------------------- menu (public/js/menu.js, recopié ; libellés par t())
  const dayPart = (d = new Date()) => { const hr = d.getHours(); return hr >= 17 || hr < 4 ? 'soir' : 'jour'; };
  const todayLabel = () => (dayPart() === 'soir' ? t('Ce soir') : t('Aujourd’hui'));
  const todayIcon = () => (dayPart() === 'soir' ? 'moon' : 'sun');
  const NAV_ITEMS = [
    { id: 'home', href: '/', label: () => t('Accueil'), icon: 'home' },
    { id: 'movies', href: '/films', label: () => t('Films'), icon: 'film', cat: 'movie' },
    { id: 'shows', href: '/series', label: () => t('Séries'), icon: 'tv', cat: 'show' },
    { id: 'anime', href: '/animes', label: () => t('Animés'), icon: 'spark', cat: 'anime' },
    { id: 'clips', href: '/clips', label: () => t('Clips'), icon: 'clip', cat: 'clip' },
    { id: 'request', href: '/nouveau', label: () => t('Nouveau'), icon: 'download', hint: () => t('Ajouter un film, une série ou un animé (téléchargé par Sirius / Pléiades)'), short: () => t('Demander un titre'), noKids: true },
    { id: 'today', href: '/cesoir', label: todayLabel, icon: todayIcon, hint: () => t('Trois questions, trois idées à regarder'), short: () => t('3 idées pour vous') },
    { id: 'new', href: '/nouveautes', label: () => t('Nouveautés'), icon: 'cal', hint: () => t('Films, séries et animés qui sortent'), short: () => t('Sorties à venir') },
    { id: 'tv', href: '/tv', label: () => t('TV'), icon: 'live', cat: 'channel' },
    { id: 'music', href: '/musique', label: () => t('Musique'), icon: 'note', cat: 'music' },
    { id: 'photos', href: '/photos', label: () => t('Photos'), icon: 'image', cat: 'photo' },
    { id: 'books', href: '/livres', label: () => t('Livres'), icon: 'book', cat: 'book' },
    { id: 'mylist', href: '/liste', label: () => t('Ma liste'), icon: 'list', hint: () => t('Gardé pour plus tard'), short: () => t('Titres gardés') },
    { id: 'collections', href: '/collections', label: () => t('Collections'), icon: 'grid4', hint: () => t('Sagas, collections et listes de lecture'), short: () => t('Sagas et listes') },
    { id: 'search', href: '/recherche', label: () => t('Recherche'), icon: 'search' },
    { id: 'seance', href: '/seance', label: () => t('Séance'), icon: 'people', hint: () => t('Regarder ensemble, chacun sur son écran') },
    { id: 'remote', href: '/telecommande', label: () => t('Télécommande'), icon: 'remote', hint: () => t('Piloter Venus avec votre téléphone') },
    { id: 'stats', href: '/stats', label: () => t('Statistiques'), icon: 'gauge', hint: () => t('Vos heures, genres et séries préférées') },
    { id: 'downloads', href: '/telechargements', label: () => t('Téléchargements'), icon: 'down', hint: () => t('Vos vidéos pour regarder sans réseau') },
    { id: 'dashboard', href: '/dashboard', label: () => t('Tableau de bord'), icon: 'gauge', admin: true, hint: () => t('Lectures en cours, appareils, code de connexion') },
  ];
  const DEFAULT_HIDDEN = ['seance', 'remote', 'dashboard', 'stats', 'downloads'];
  const RAIL_MAX = 6;
  const KIDS_HIDE = new Set(['new', 'request', 'seance', 'remote', 'dashboard', 'stats', 'downloads', 'collections', 'tv']);
  const val = (x) => (typeof x === 'function' ? x() : x);
  const COUNT_WORD = { movie: ['{n} film', '{n} films'], show: ['{n} série', '{n} séries'], anime: ['{n} animé', '{n} animés'], clip: ['{n} clip', '{n} clips'] };
  const SECTION_IDS = ['today', 'movies', 'shows', 'anime', 'tv', 'clips', 'music', 'photos', 'books', 'collections', 'mylist', 'new'];

  // ---------------------------------------------------------------- logique pure (essayée sans navigateur)
  const L = {
    /** Les comptes de chaque catégorie de la bibliothèque (une catégorie vide disparaît du menu, comme dans Venus). */
    comptes(items) { const c = { movie: 0, show: 0, anime: 0, clip: 0, channel: 0, music: 0, photo: 0, book: 0 }; for (const i of items) c[i.category] = (c[i.category] || 0) + 1; return c; },
    /** Le menu : sections montrées (dans l'ordre choisi) et rangées dans « Plus ». */
    menuItems(profile, M, cats) {
      const usable = (it) => (!it.admin || profile.isAdmin) && (!it.cat || (cats[it.cat] || 0) > 0) && !(profile.isKids && KIDS_HIDE.has(it.id));
      const byId = new Map(NAV_ITEMS.map((i) => [i.id, i]));
      const order = [...M.order.filter((id) => byId.has(id)), ...NAV_ITEMS.map((i) => i.id).filter((id) => !M.order.includes(id))];
      const list = order.map((id) => byId.get(id)).filter(usable);
      return { shown: list.filter((i) => !M.hidden.includes(i.id)), more: list.filter((i) => M.hidden.includes(i.id)) };
    },
    /** La coque : 6 sections dans le rail, le reste dans « Plus » ; 4 onglets sur le téléphone, puis « Tout ». */
    coque(profile, M, cats) {
      const { shown, more } = L.menuItems(profile, M, cats), all = [...shown, ...more];
      const pick = (id) => all.find((it) => it.id === id);
      const firstTwo = shown.filter((it) => !['home', 'today', 'search'].includes(it.id)).slice(0, 2);
      return { rail: shown.slice(0, RAIL_MAX), plus: shown.length > RAIL_MAX || more.length > 0, railMore: [...shown.slice(RAIL_MAX), ...more], tabs: [pick('home'), ...firstTwo, pick('search')].filter(Boolean) };
    },
    sections(profile, cats) {
      const byId = new Map(NAV_ITEMS.map((i) => [i.id, i]));
      return SECTION_IDS.map((id) => byId.get(id)).filter((it) => it && (!it.cat || (cats[it.cat] || 0) > 0) && (!it.admin || profile.isAdmin) && !(profile.isKids && KIDS_HIDE.has(it.id)))
        .map((it) => ({ ...it, label: val(it.label), icon: val(it.icon), sub: it.cat ? (COUNT_WORD[it.cat] ? tn(cats[it.cat], ...COUNT_WORD[it.cat]) : '') : val(it.short) || val(it.hint) || '' }));
    },
    /** Monte ou descend une section du menu (Réglages → Thème et menu). Rend un nouvel ordre. */
    deplacer(order, id, d) { const o = [...order], i = o.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= o.length) return o; [o[i], o[j]] = [o[j], o[i]]; return o; },
    /** Les titres d'une bibliothèque. */
    itemsOf(items, kind) { return kind === 'mylist' ? items.filter((x) => x.inList) : items.filter((x) => x.category === kind); },
    /** La note d'un titre, sur 10 (celle du public, sinon celle des critiques), ou rien. Pur. */
    note(i) { return i.vote || i.critics || 0; },
    /**
     * Filtre et trie (Browse.js) : statut, genres, années, note minimale, qualité ; tris par ajout, titre, sortie, note,
     * lecture, durée, hasard. Un titre sans fiche n'a ni genre ni note : il ne passe pas ces filtres-là.
     */
    shown(items, f, graine = 0) {
      const QUAL = { '4K': (i) => i.res === '4K', '1080p': (i) => i.res === '1080p', SD: (i) => i.res === 'SD' || i.res === '720p' };
      const genres = f.genres || [], min = Number(f.minScore) || 0;
      const list = items.filter((i) => (f.status === 'all' || i.status === f.status) && (!genres.length || (i.genres || []).some((g) => genres.includes(g))) && (!f.decades.length || (i.year && f.decades.includes(Math.floor(i.year / 10) * 10)))
        && (!min || L.note(i) * 10 >= min) && (!f.quality.length || f.quality.some((q) => QUAL[q] && QUAL[q](i))));
      const h = (s) => { let x = 2166136261; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
      const cmp = { added: (a, b) => b.added - a.added, az: (a, b) => a.title.localeCompare(b.title, LANG), released: (a, b) => (b.year || 0) - (a.year || 0), score: (a, b) => L.note(b) - L.note(a), played: (a, b) => (b.played || 0) - (a.played || 0), runtime: (a, b) => (a.runtime || 0) - (b.runtime || 0), random: (a, b) => h(`${a.id}${graine}`) - h(`${b.id}${graine}`), mine: null }[f.sort];
      if (cmp) list.sort(cmp);
      if (f.desc && f.sort !== 'random') list.reverse();
      return list;
    },
    /** Les résultats de Ctrl+K : pages du menu, titres, épisodes à reprendre, réglages, changer de profil. */
    palette(q, items, profile, M, cats) {
      const n = norm(q), out = [];
      const { shown, more } = L.menuItems(profile, M, cats);
      const statics = [...shown, ...more].filter((it) => it.href).map((it) => ({ kind: 'page', label: val(it.label), sub: val(it.hint) || '', icon: val(it.icon), to: it.href }));
      // Les mêmes réglages que la page : aucun pour un enfant (le rail n'en montre pas), Médiathèques pour le propriétaire seul.
      if (!profile.isKids) statics.push({ kind: 'setting', label: t('Réglages : Thème et menu'), icon: 'gear', to: '/reglages', tab: 'affichage' });
      if (!profile.isKids && profile.isAdmin) statics.push({ kind: 'setting', label: t('Réglages : Médiathèques'), icon: 'gear', to: '/reglages', tab: 'medias' });
      statics.push({ kind: 'action', label: t('Changer de profil'), icon: 'people', act: 'profiles' });
      if (!n) return statics.slice(0, 8);
      for (const i of items) if (n.split(' ').every((w) => norm(i.title).includes(w))) out.push({ kind: i.category, label: i.title, sub: [i.year, i.category === 'show' ? t('Série') : i.category === 'anime' ? t('Animé') : i.category === 'clip' ? t('Clip') : t('Film')].filter(Boolean).join(' · '), poster: i.poster, icon: i.category === 'movie' ? 'film' : i.category === 'clip' ? 'clip' : 'tv', to: `/titre/${encodeURIComponent(i.id)}` });
      for (const x of statics) if (norm(x.label).includes(n) || norm(x.sub || '').includes(n)) out.push(x);
      const top = out.slice(0, 12);
      top.push({ kind: 'action', label: t('Rechercher « {q} » partout', { q: q.trim() }), icon: 'search', to: '/recherche', q: q.trim() });
      return top;
    },
    /** L'adresse dans la page (« #/titre/… ») : le chemin et ses paramètres. */
    route(hash) { const h = String(hash || '').replace(/^#/, ''); const [p, q = ''] = h.split('?'); return { path: p || '/', q: new URLSearchParams(q) }; },
    /** Les numéros manquants d'une saison et ses épisodes, mêlés dans l'ordre (Details.js). */
    episodesSaison(s) { const l = [...s.episodes.map((e) => ({ ...e })), ...s.manquants.map((n) => ({ episode: n, missing: true }))]; return l.sort((a, b) => a.episode - b.episode); },
    /** Ce que le lecteur reçoit pour une cible, d'après le détail de son œuvre (/venus/oeuvre/…). Pur. */
    /** Les genres présents dans une bibliothèque (pour le filtre), dans l'ordre alphabétique de la langue. Pur. */
    genresDe(items) { return [...new Set(items.flatMap((i) => i.genres || []))].sort((a, b) => a.localeCompare(b, LANG)); },
    elementLecteur(detail, cibleId) {
      const o = detail && detail.oeuvre; if (!o) return null;
      if (o.id === cibleId) return { id: o.id, titre: o.titre || '', type: 'film', duree_s: o.duree, reprise_s: (detail.reprise && detail.reprise.position_s) || 0, sousTitres: o.sous_titres };
      const e = (detail.episodes || []).find((x) => x.id === cibleId); if (!e) return null;
      const sxe = `S${String(e.saison).padStart(2, '0')}E${String(e.episode ?? 0).padStart(2, '0')}`;
      return { id: e.id, titre: `${o.titre || ''} · ${sxe}`, type: 'episode', duree_s: e.duree, reprise_s: e.reprise_s || 0, sousTitres: e.sous_titres, saison: e.saison, episode: e.episode };
    },
  };
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  // ---------------------------------------------------------------- demandes et téléchargements (logique pure, lots V4-V6)
  // Chaque clic passe par une action de Vénus (/api/valhalla/act, module freyja). Un clic qui télécharge envoie
  // `confirm: true` : le clic EST la confirmation (l'IA et la parole, elles, demandent toujours).
  const GENRE = { movie: 'film', show: 'série', anime: 'animé' };
  const ETAT_FILE = { attente: 'En attente', en_cours: 'En cours', pause: 'En pause', annule: 'Annulé', termine: 'Importé', echec: 'Échec', a_part: 'Mis à part (antivirus)' };
  const pad2 = (n) => String(n).padStart(2, '0');
  Object.assign(L, {
    /** Ce que ⬇ (« Télécharger », « Demander », « Ajouter ») envoie pour un titre : toute la chaîne, confirmée par le clic. */
    obtenir(e) {
      const film = e.kind === 'movie' || e.type === 'movie';
      const input = { titre: String(e.title || '').slice(0, 200), genre: film ? 'film' : GENRE[e.kind] || 'série' };
      const an = e.year || (e.date ? Number(String(e.date).slice(0, 4)) : 0);
      if (film) { if (an) input.annee = String(an); } else { input.saisons = String(e.season != null ? e.season : 1); if (e.episode != null) input.episode = String(e.episode); }
      return { module: 'freyja', action: 'hnoss_obtenir', input, confirm: true };
    },
    /** Ce que ♡ envoie : ajouter à « Mes envies » (la chaîne part, confirmée par le clic) ou retirer. */
    envie(e, on) {
      if (on) return { module: 'freyja', action: 'hnoss_envie', input: { titre: String(e.title || '').slice(0, 200), cle: e.key, retirer: true } };
      return { module: 'freyja', action: 'hnoss_envie', input: { ...L.obtenir(e).input, cle: e.key }, confirm: true };
    },
    /** « À venir » : le filtre (tout, disponibles, pas disponibles, mes favoris), puis les sorties groupées par jour. */
    jours(entries, filtre, favs) {
      const keep = (e) => (filtre === 'nas' ? !!e.nas : filtre === 'out' ? !e.nas : filtre === 'fav' ? favs.has(e.key) : true);
      const g = new Map(); for (const e of (entries || []).filter(keep)) { if (!g.has(e.date)) g.set(e.date, []); g.get(e.date).push(e); }
      return [...g.keys()].sort().map((day) => ({ day, items: g.get(day) }));
    },
    /** La file de Comète est relue toutes les 2 s tant qu'un téléchargement est en cours ou attend. */
    fileVivante(l) { return (l || []).some((x) => x.etat === 'en_cours' || x.etat === 'attente'); },
    /** Les membres « libres » après un choix dans « Demandes au nom de chacun ». */
    libres(l, login, libre) { const s = new Set(l || []); if (libre) s.add(login); else s.delete(login); return [...s].sort(); },
    /** Une ligne de la file : le titre, l'épisode, le pourcentage, l'état et le temps restant (mm:ss). */
    ligneFile(x) {
      const c = x.cible || {}, pct = x.total ? Math.min(100, Math.round((x.fait / x.total) * 100)) : x.etat === 'termine' ? 100 : 0;
      const sec = x.etat === 'en_cours' && x.vitesse > 0 && x.total ? Math.max(0, Math.round((x.total - x.fait) / x.vitesse)) : 0;
      const reste = sec ? (sec >= 3600 ? `${Math.floor(sec / 3600)}:${pad2(Math.floor((sec % 3600) / 60))}:${pad2(sec % 60)}` : `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`) : '';
      return { titre: c.titre || x.titre || '', ep: c.genre === 'episode' && c.saison != null ? `S${c.saison}:É${c.episode}` : '', pct, etat: ETAT_FILE[x.etat] || String(x.etat || ''), reste };
    },
  });
  // ---------------------------------------------------------------- la maison (logique pure, lot V8)
  // Tonight.js : trois questions (envie, temps, avec qui), trois idées argumentées. Les mots des genres sont cherchés
  // sans accents dans les genres des fiches (français et anglais : les langues des catalogues de Venus).
  const MOODS = [
    ['rire', 'Rire', 'Une comédie, quelque chose de léger', ['comedie', 'famil', 'animation', 'comedy']],
    ['frissons', 'Frissonner', 'Suspense, enquête, peur', ['horreur', 'thriller', 'mystere', 'crime', 'policier', 'horror', 'mystery']],
    ['emotion', 'Être ému', 'Une belle histoire qui touche', ['drame', 'romance', 'drama']],
    ['evasion', 'S’évader', 'Ailleurs, demain, l’aventure', ['science', 'fantas', 'aventure', 'action', 'animation', 'adventure']],
    ['reflechir', 'Apprendre', 'Documentaire, histoire vraie', ['documentaire', 'histoire', 'guerre', 'mystere', 'documentary', 'history', 'war', 'mystery']],
    ['surprise', 'Surprends-moi', 'Laissez Venus choisir', []],
  ];
  const TIMES = (soir) => [['30', 'Moins de 45 min', 'Un épisode, un clip', 45], ['90', 'Environ 1 h 30', 'Un film court ou deux épisodes', 110], ['120', soir ? 'Toute la soirée' : 'Tout le temps qu’il faut', 'Un grand film, une série', 999]];
  const WHO = [['seul', 'Seul', 'Rien que pour moi'], ['duo', 'À deux', 'En couple ou entre amis proches'], ['famille', 'En famille', 'Avec des enfants'], ['amis', 'Entre amis', 'Ambiance, rires, sensations']];
  const WHO_BONUS = { duo: ['romance', 'drame', 'comedie', 'thriller', 'drama', 'comedy'], famille: ['animation', 'famil', 'comedie', 'aventure', 'comedy', 'adventure'], amis: ['comedie', 'action', 'horreur', 'thriller', 'comedy', 'horror'] };
  const MOIS = (m, mois = 'short') => date(new Date(2026, m, 1).getTime(), { month: mois });
  const JOURS = (w, jour = 'short') => date(new Date(2026, 1, 2 + w).getTime(), { weekday: jour }); // le 2 février 2026 est un lundi
  Object.assign(L, {
    MOODS, WHO, TIMES,
    /** La durée d'un titre en minutes : la vraie (film, épisodes d'une série en moyenne), sinon l'estimation de Venus. Pur. */
    lengthOf(i) { return i.type === 'movie' ? i.runtime || 110 : i.type === 'clip' ? Math.max(3, i.runtime || 4) : i.runtime || (i.category === 'anime' ? 24 : 45); },
    /**
     * Le score d'un titre pour les réponses (score() de Tonight.js) : null s'il ne convient pas. « En famille » demande
     * l'âge permis du titre : sans lui, le titre n'est pas proposé (jamais deviné). `alea` : le petit hasard de Venus.
     */
    tonightScore(i, a, soir, now = Date.now(), alea = Math.random) {
      if (i.type === 'clip' && a.time !== '30') return null;
      const g = (i.genres || []).map(norm).join(' '), mood = MOODS.find((m) => m[0] === a.mood), reasons = [];
      let s = 0;
      if (mood && mood[3].length) { const hits = mood[3].filter((k) => g.includes(k)).length; if (!hits) return null; s += 4 + hits * 1.5; reasons.push((i.genres || [])[0]); }
      const tm = TIMES(soir).find((x) => x[0] === a.time), len = L.lengthOf(i);
      if (tm) {
        if (len > tm[3]) return null;
        if (a.time === '120' && i.type === 'movie' && len >= 100) s += 2;
        if (a.time === '30' && i.type !== 'movie') s += 2;
        reasons.push(i.type === 'show' ? t('Épisodes de {n} min', { n: nombre(len) }) : t('{d}, fini à {h}', { d: duree(len), h: date(now + len * 60000, { hour: '2-digit', minute: '2-digit' }) }));
      }
      if (a.who === 'famille') { if (i.age == null || i.age > 10) return null; reasons.push(i.age === 0 ? t('Tous publics') : t('Dès {n} ans', { n: nombre(i.age) })); }
      s += (WHO_BONUS[a.who] || []).filter((k) => g.includes(k)).length * 1.2;
      if (i.status === 'unseen') { s += 3; reasons.push(i.type === 'show' ? t('Jamais commencée') : t('Jamais vu')); }
      else if (i.status === 'progress') { s += i.type === 'show' ? 2.5 : 1; reasons.push(i.type === 'show' && i.unseen ? tn(i.unseen, '{n} épisode à voir', '{n} épisodes à voir') : t('Déjà commencé')); }
      else s -= 4;
      const v = L.note(i); if (v) { s += (v - 6) * 0.9; if (v >= 7.8) reasons.push(`${new Intl.NumberFormat(LANG, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(v)}/10`); }
      if (i.added && now - i.added < 14 * 864e5) { s += 1; reasons.push(t('Ajouté récemment')); }
      return { item: i, score: s + alea() * 1.5, reasons: [...new Set(reasons.filter(Boolean))].slice(0, 4) };
    },
    /** Les trois idées : les mieux notées, en évitant celles déjà montrées tant qu'il en reste trois autres. Pur. */
    tonightPicks(items, a, soir, shown, now = Date.now(), alea = Math.random) {
      const ranked = items.map((i) => L.tonightScore(i, a, soir, now, alea)).filter(Boolean).sort((x, y) => y.score - x.score);
      const fresh = ranked.filter((r) => !shown.has(r.item.id));
      return (fresh.length >= 3 ? fresh : ranked).slice(0, 3);
    },
    /** Des heures lisibles (Stats.js, fh) : « 0 h », « 25 min », « 1,5 h », « 120 h ». Pur. */
    heures(x) { return !x ? t('{n} h', { n: nombre(0) }) : x < 1 ? t('{n} min', { n: nombre(Math.max(1, Math.round(x * 60))) }) : t('{n} h', { n: nombre(x >= 100 ? Math.round(x) : Math.round(x * 10) / 10) }); },
    /** Le niveau d'une case du calendrier (0 à 4, par quartiles des jours avec une lecture). Pur. */
    niveaux(data) {
      const vals = Object.values(data).filter(Boolean).sort((a, b) => a - b);
      const q = (p) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 1), st = [q(0.25), q(0.5), q(0.75)];
      return (v) => (!v ? 0 : v <= st[0] ? 1 : v <= st[1] ? 2 : v <= st[2] ? 3 : 4);
    },
    /** Le nom d'un mois et d'un jour de la semaine (0 = lundi), dans la langue de la page. Pur. */
    mois: MOIS, joursSemaine: JOURS,
    /** Le nouvel ordre d'une liste de lecture après « Monter » ou « Descendre ». Pur. */
    bouger(l, n, dir) { const j = n + dir; if (j < 0 || j >= l.length) return l; const x = [...l]; [x[n], x[j]] = [x[j], x[n]]; return x; },
  });
  W.VenusApp = { L, t, TXT, NAV_ITEMS, DEFAULT_HIDDEN, RAIL_MAX };
  if (!D || !D.getElementById || !D.getElementById('app')) return; // chargé pour les essais : rien à dessiner

  // ---------------------------------------------------------------- état
  const LAYOUT_TXT = { rail: 'Menu d’icônes à gauche', side: 'Grand menu à gauche', dock: 'Barre flottante en bas', stream: 'Menu en haut, style streaming', tv: 'Grands onglets, pour la télé', glass: 'Surfaces givrées', lagon: 'Barre en haut et bloc « Ce soir »' };
  for (const k of Object.keys(LAYOUTS)) LAYOUTS[k] = t(LAYOUT_TXT[k] || LAYOUTS[k]);
  T.auto = 'off'; // comme Venus d'origine : « Toujours Venus » tant que rien n'est choisi
  const M = { order: NAV_ITEMS.map((i) => i.id), hidden: [...DEFAULT_HIDDEN] };
  const S = { profile: { id: 'moi', name: '', isAdmin: true, avatar: 0 }, profils: [], items: [], cats: L.comptes([]), loaded: false, error: '', heroIdx: 0, lib: {}, libView: {}, season: null, epFilter: 'all', setTab: 'affichage', searchQ: '', searchKind: 'all', fiche: {}, dossiers: null,
    // demandes et téléchargements : « À venir » par genre, favoris (♡), titres lancés, en cours d'envoi, file de Comète…
    up: {}, upFilter: {}, upEarlier: {}, favs: new Set(), pris: new Set(), busy: new Set(), reg: [], envies: null, file: null, fileT: 0, demandes: null,
    req: { q: '', kind: 'movie' }, newKind: 'movie', nouv: {}, newCur: {}, dem: null };
  const AVATAR_HUES = [12, 38, 145, 190, 215, 265, 300, 340];
  const api = async (chemin, corps) => {
    const r = await fetch(chemin, corps === undefined ? { headers: { 'x-odin': '1' } } : { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(corps) });
    if (r.status === 401) { versOdin('/'); throw new Error('401'); }
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  };
  // Le profil choisi est gardé par Odin dans un témoin (chemin /venus, un an) : le lecteur et le flux le reçoivent aussi.
  const choisirProfil = (id) => { D.cookie = `venus_profil=${encodeURIComponent(id)}; path=/venus; max-age=31536000; SameSite=Strict`; };

  // ---------------------------------------------------------------- briques (Icon.js, Card.js, Row.js)
  const Avatar = (p, cls = '') => `<div class="avatar ${cls}" style="--hue:${AVATAR_HUES[(p.avatar || 0) % AVATAR_HUES.length]}">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</div>`;
  const Brand = (cls = '') => `<span class="brand ${cls}">${planetMarkup()}<span class="brand-name">${esc(brandName())}</span></span>`;
  // L'affiche (ou, en largeur, le fond) gardée par Odin ; sans image, le carré de couleur de Venus avec le titre dedans.
  const Pic = (i, wide = false) => { const src = wide ? i.backdrop || i.poster : i.poster || i.backdrop; return src ? `<img src="${esc(src)}" alt="" class="fade ok" loading="lazy" decoding="async">` : `<div class="ph" style="--h:${hueOf(i.title)}">${esc(i.title)}</div>`; };
  const note10 = (n) => new Intl.NumberFormat(LANG, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n);
  /** Le visage d'une personne : sa photo gardée par Odin, sinon ses initiales (Details.js). */
  const Face = (p) => `<div class="face${p.photo ? ' has-img' : ''}" style="--h:${hueOf(p.name)}">${esc(p.name.split(/\s+/).map((w) => w[0] || '').slice(0, 2).join(''))}${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async">` : ''}</div>`;
  const href = (path) => `#${path}`;
  const go = (path) => { location.hash = `#${path}`; };
  const titrePath = (i) => `/titre/${encodeURIComponent(i.id)}`;
  const lirePath = (id) => `/lecture/${encodeURIComponent(id)}`;
  const kindLabel = (i) => (i.category === 'anime' ? t('Animé') : i.category === 'show' ? t('Série') : i.category === 'clip' ? t('Clip') : t('Film'));
  function Card(item, { poster = false } = {}) {
    const p = item.progress, isClip = item.type === 'clip', isShow = item.type === 'show';
    const resume = !!(p && !p.watched && p.position > 0) || (isShow && item.status === 'progress' && item.play);
    let sub;
    if (isShow && item.status === 'progress' && item.play) sub = t('À suivre : saison {s}, épisode {e}', { s: nombre(item.play.season), e: nombre(item.play.episode) });
    else if (resume) sub = reste(p);
    else if (isClip) sub = t('Clip');
    else sub = [item.year, isShow ? kindLabel(item) : (item.genres || [])[0]].filter(Boolean).join(', ');
    const pct = p && p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
    const seen = item.status === 'seen';
    const target = isClip || resume ? lirePath(item.play ? item.play.id : item.id) : titrePath(item);
    return `<a class="card f${poster ? ' poster' : ''}" href="${href(target)}" aria-label="${esc([item.title, sub, seen ? t('déjà vu') : null].filter(Boolean).join(', '))}">
    <div class="shot">${Pic(item, !poster)}${pct > 0 && !(p && p.watched) ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}${seen ? `<span class="check" title="${esc(t('Déjà vu'))}">${I('check')}</span>` : ''}${isShow && item.episodes ? `<span class="ep-pill" title="${esc(tn(item.episodes, '{n} épisode', '{n} épisodes'))}">${item.status === 'progress' ? `${nombre(item.episodes - item.unseen)}/${nombre(item.episodes)}` : t('{n} ép.', { n: nombre(item.episodes) })}</span>` : ''}</div>
    <div class="cap"><b>${esc(item.title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div></a>`;
  }
  const ScrollRow = (inner, cls = 'row-scroll') => `<div class="row-body"><button type="button" class="row-arrow prev off" tabindex="-1" aria-label="${esc(t('Précédent'))}" data-act="rowby" data-v="-1">${I('back')}</button><div class="${cls}">${inner}</div><button type="button" class="row-arrow next" tabindex="-1" aria-label="${esc(t('Suivant'))}" data-act="rowby" data-v="1">${I('fwd')}</button></div>`;
  function Row(r) {
    if (!r.items.length) return '';
    const posters = r.poster !== undefined ? r.poster : r.items.filter((it) => it.type !== 'clip').length >= Math.ceil(r.items.length * 0.6);
    return `<section class="row" aria-label="${esc(r.title)}"><div class="row-head"><h2>${esc(r.title)}</h2>${r.more ? `<div class="row-tools"><a class="row-link f" href="${href(r.more)}">${esc(t('Tout voir'))}</a></div>` : ''}</div>
    ${ScrollRow(r.items.map((it) => Card(it, { poster: posters })).join(''), `row-scroll${posters ? ' posters' : ''}`)}</section>`;
  }
  const Empty = (txt, extra = '') => `<div class="grid-empty"><p>${esc(txt)}</p>${extra}</div>`;

  // ---------------------------------------------------------------- coque (Shell.js) + « ‹ Odin »
  const ODIN_MARK = '<svg class="odin-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 6 8l6 6 6-6zM12 14l-5 5 5 3 5-3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  // Une entrée est choisie sur sa page et sur les pages en dessous (« /musique/album/… ») ; jamais sur une page dont
  // le nom commence pareil (avant : « Nouveau » s'allumait aussi sur « Nouveautés », « Ma liste » sur une liste de lecture).
  const isActive = (h, path) => (h === '/' ? path === '/' : path === h || path.startsWith(`${h}/`));
  const NavLink = (h, label, icon, path, cls = '') => { const on = isActive(h, path); return `<a href="${href(h)}" class="${`${cls} f${on ? ' active' : ''}`.trim()}"${on ? ' aria-current="page"' : ''} aria-label="${esc(label)}">${icon ? I(icon) : ''}<span>${esc(label)}</span></a>`; };
  const ItemLink = (it, path, cls = '') => NavLink(it.href, val(it.label), val(it.icon), path, cls);
  function Shell(path, body) {
    const p = S.profile, layout = layoutOf(currentPlanet()), c = L.coque(p, M, S.cats);
    return `<nav class="rail" aria-label="${esc(t('Navigation principale'))}">
    ${DANS_ODIN ? '' : `<button class="rail-item f odin-back" data-act="odin" aria-label="${esc(t('Revenir à Odin'))}" title="${esc(t('Revenir à Odin'))}">${ODIN_MARK}<span>${esc(t('‹ Odin'))}</span></button>`}
    <a href="${href('/')}" class="home-link f${path === '/' ? ' active' : ''}" aria-label="${esc(t('Venus, accueil'))}">${planetMarkup()}${layout === 'lagon' ? '<span class="rail-brand">venus</span>' : ''}</a>
    ${layout === 'lagon' ? `<button class="rail-search f" aria-label="${esc(t('Rechercher partout (Ctrl+K)'))}" data-act="palette">${I('search')}<span>${esc(t('Titre, année…'))}</span><kbd>Ctrl K</kbd></button>` : ''}
    <div class="rail-scroll">${c.rail.map((it) => ItemLink(it, path)).join('')}${c.plus ? `<button class="rail-item f" aria-label="${esc(t('Plus'))}" data-more="1" data-act="all">${I('more')}<span>${esc(t('Plus'))}</span></button>` : ''}</div>
    ${p.isKids ? '' : NavLink('/reglages', t('Réglages'), 'gear', path)}
    <button class="rail-item f" aria-label="${esc(t('Changer de profil ({n})', { n: p.name }))}" data-act="profiles">${Avatar(p, 'sm')}<span>${esc(p.name)}</span></button>
  </nav>
  <header class="mobile-top">
    ${DANS_ODIN ? '' : `<button class="odin-back f" data-act="odin" aria-label="${esc(t('Revenir à Odin'))}">${I('back')}<span>Odin</span></button>`}
    <a href="${href('/')}" class="f" aria-label="${esc(t('Accueil'))}">${Brand()}</a>
    <div class="top-actions">
      <button class="icon-btn f" aria-label="${esc(t('Rechercher partout (Ctrl+K)'))}" title="${esc(t('Rechercher partout (Ctrl+K)'))}" data-act="palette">${I('search')}</button>
      ${p.isKids ? '' : `<a href="${href('/reglages')}" class="icon-btn f" aria-label="${esc(t('Réglages'))}">${I('gear')}</a>`}
      <button class="icon-btn f" aria-label="${esc(t('Changer de profil ({n})', { n: p.name }))}" data-act="profiles">${Avatar(p, 'sm')}</button>
    </div>
  </header>
  ${body}
  ${PLANETS[currentPlanet()].waves ? `<div class="waves" aria-hidden="true">${[1, 2, 3].map((n) => `<svg class="wave w${n}" viewBox="0 0 1440 100" preserveAspectRatio="none"><path d="M0 40c120-30 240-30 360 0s240 30 360 0 240-30 360 0 240 30 360 0v60H0z"/></svg>`).join('')}</div>` : ''}
  <nav class="tabbar" aria-label="${esc(t('Onglets'))}">${c.tabs.map((it) => ItemLink(it, path)).join('')}<button class="f tab-more" aria-label="${esc(t('Toutes les sections'))}" data-more="1" data-act="all">${I('apps')}<span>${esc(t('Tout'))}</span></button></nav>`;
  }

  // ---------------------------------------------------------------- pages
  const V = {};
  const PageLoading = () => '<main class="with-nav"><div class="page" aria-busy="true"><i class="sk" style="width:220px;height:48px"></i></div></main>';
  const libVide = () => Empty(t('Rien ici pour l’instant. Déclarez un dossier de films ou de séries et lancez un scan : vos titres apparaissent ici.'), `<button class="btn btn-ghost btn-small f" data-act="classique">${I('folder')}${esc(t('Médiathèques et écrans'))}</button>`);

  // Accueil (pages/Home.js)
  V.home = () => {
    const all = S.items;
    if (!all.length) return `<main class="with-nav home page-in"><div class="page"><h1 class="sr-only">${esc(t('Accueil'))}</h1>${libVide()}</div></main>`;
    const cont = all.filter((x) => x.status === 'progress').sort((a, b) => b.played - a.played);
    const recent = [...all].sort((a, b) => b.added - a.added);
    const heroes = (cont.length ? cont : recent).slice(0, 6), item = heroes[S.heroIdx % heroes.length];
    const resume = item.status === 'progress';
    const pct = item.progress && item.progress.duration && !item.progress.watched ? (item.progress.position / item.progress.duration) * 100 : 0;
    const meta = `<div class="meta">${item.year ? `<span>${esc(String(item.year))}</span>` : ''}${L.note(item) ? `<span>${esc(note10(L.note(item)))}/10</span>` : ''}${item.type === 'movie' ? (item.runtime ? `<span>${esc(duree(item.runtime))}</span>` : '') : `<span>${esc(kindLabel(item))}</span>`}${(item.genres || []).length ? `<span>${esc(item.genres.slice(0, 2).join(', '))}</span>` : ''}${item.res ? `<span>${esc(item.res)}</span>` : ''}</div>`;
    const play = item.play ? item.play.id : item.id;
    const body = resume
      ? `<div class="hero-body resume swap"><div class="hero-kicker">${I('restart')}${esc(t('Reprendre là où vous en étiez'))}</div><h1 class="hero-title">${esc(item.title)}</h1>${pct ? `<div class="hero-progress"><div class="bar"><i style="width:${pct}%"></i></div><span>${esc(reste(item.progress))}</span></div>` : ''}<div class="actions"><a class="btn btn-play f" href="${href(lirePath(play))}">${I('play')}${esc(t('Reprendre'))}</a><a class="btn btn-ghost f" aria-label="${esc(t('Plus d’infos'))}" href="${href(titrePath(item))}">${I('info')}<span class="lbl">${esc(t('Plus d’infos'))}</span></a></div></div>`
      : `<div class="hero-body swap"><div class="hero-kicker">${I('spark')}${esc(t('Ajouté récemment'))}</div><h1 class="hero-title">${esc(item.title)}</h1>${meta}<div class="actions"><a class="btn btn-play f" href="${href(lirePath(play))}">${I('play')}${esc(t('Lecture'))}</a><a class="btn btn-ghost f" aria-label="${esc(t('Plus d’infos'))}" href="${href(titrePath(item))}">${I('info')}<span class="lbl">${esc(t('Plus d’infos'))}</span></a></div></div>`;
    const hero = `<section class="hero posters"><div class="hero-bg">${item.backdrop || item.poster ? `<img src="${esc(item.backdrop || item.poster)}" alt="" class="on" decoding="async">` : `<div class="ph on" style="--h:${hueOf(item.title)}"></div>`}</div>${body}
    ${heroes.length > 1 ? `<button type="button" class="hero-arrow prev" tabindex="-1" aria-label="${esc(t('Titre précédent'))}" data-act="hero" data-v="-1">${I('back')}</button><button type="button" class="hero-arrow next" tabindex="-1" aria-label="${esc(t('Titre suivant'))}" data-act="hero" data-v="1">${I('fwd')}</button>
    <div class="hero-dots" role="tablist" aria-label="${esc(t('À la une'))}">${heroes.map((it, i) => `<button type="button" role="tab" tabindex="-1" aria-label="${esc(it.title)}" aria-selected="${i === S.heroIdx % heroes.length}" class="${i === S.heroIdx % heroes.length ? 'on' : ''}" data-act="heroto" data-v="${i}"><i></i></button>`).join('')}</div>` : ''}</section>`;
    const secs = L.sections(S.profile, S.cats);
    const list = ['today', 'new', 'mylist', 'collections', 'tv', 'clips'].map((id) => secs.find((x) => x.id === id)).filter(Boolean).slice(0, 3);
    const strip = `<nav class="home-sections" aria-label="${esc(t('Sections'))}"><div class="hs-track">${list.map((it) => `<a class="hs-tile f hs-${it.id}" href="${href(it.href)}"><span class="hs-ic">${I(it.icon)}</span><span class="hs-txt"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></a>`).join('')}<button class="hs-tile hs-all f" data-act="all"><span class="hs-ic">${I('apps')}</span><span class="hs-txt"><b>${esc(t('Tout'))}</b><small>${esc(t('Toutes les sections'))}</small></span></button></div></nav>`;
    const rows = [
      { title: t('Reprendre'), items: cont, poster: false },
      { title: t('Ajoutés récemment'), items: recent.slice(0, 12) },
      { title: t('Ma liste'), items: all.filter((x) => x.inList), more: '/liste' },
      { title: t('Films'), items: L.itemsOf(all, 'movie'), more: '/films' }, { title: t('Séries'), items: L.itemsOf(all, 'show'), more: '/series' },
      { title: t('Animés'), items: L.itemsOf(all, 'anime'), more: '/animes' }, { title: t('Clips'), items: L.itemsOf(all, 'clip'), more: '/clips' },
    ];
    return `<main class="with-nav home page-in">${hero}${strip}<div class="rows">${rows.map(Row).join('')}</div></main>`;
  };

  // Films, Séries, Animés, Clips, Ma liste (Browse.js)
  const TITLES = { movie: 'Films', show: 'Séries', anime: 'Animés', clip: 'Clips', mylist: 'Ma liste' };
  const PATHS = { movie: '/films', show: '/series', anime: '/animes', clip: '/clips', mylist: '/liste' };
  // Les tris et filtres dont la bibliothèque a la donnée (genres et notes : ceux des fiches ; popularité et âge : à venir).
  const SORTS = [['added', 'Date d’ajout', ['Plus récents', 'Plus anciens']], ['az', 'Titre', ['A → Z', 'Z → A']], ['released', 'Date de sortie', ['Plus récents', 'Plus anciens']], ['score', 'Note moyenne', ['Mieux notés', 'Moins bien notés']], ['played', 'Date de lecture', ['Vus récemment', 'Vus il y a longtemps']], ['runtime', 'Durée', ['Plus courts', 'Plus longs']], ['random', 'Aléatoire', ['Nouveau tirage', 'Nouveau tirage']]];
  const STATUS = [['all', 'Tous'], ['unseen', 'Non vus'], ['progress', 'En cours'], ['seen', 'Vus']];
  const QUALITY = [['4K', '4K', (i) => i.res === '4K'], ['1080p', 'Full HD', (i) => i.res === '1080p'], ['SD', 'Basse définition', (i) => i.res === 'SD' || i.res === '720p']];
  const VIEWS = [['poster', 'Affiches', 'grid4'], ['wide', 'Vignettes', 'film'], ['list', 'Liste', 'rows']];
  const SCORES = [['60', '6'], ['70', '7'], ['80', '8']];
  const VIDE_F = () => ({ genres: [], decades: [], quality: [], minScore: '' });
  const fOf = (kind) => (S.lib[kind] = S.lib[kind] || { sort: kind === 'mylist' ? 'mine' : 'added', desc: false, status: 'all', ...VIDE_F(), graine: 0 });
  const shownOf = (kind) => { const f = fOf(kind); return L.shown(L.itemsOf(S.items, kind), f, f.graine); };
  function ListRow(i) {
    const p = i.progress, pct = p && p.duration && !p.watched ? Math.min(100, (p.position / p.duration) * 100) : 0;
    return `<div class="lib-row"><a class="lr-main f" href="${href(i.type === 'clip' ? lirePath(i.id) : titrePath(i))}"><div class="lr-pic">${Pic(i)}</div><div class="lr-text"><b>${esc(i.title)}</b><span class="lr-meta">${esc([i.year, i.type === 'show' ? tn(i.episodes || 0, '{n} épisode', '{n} épisodes') : duree(i.runtime), (i.genres || []).slice(0, 3).join(', ')].filter(Boolean).join(' · '))}${i.res === '4K' ? '<span class="badge">4K</span>' : ''}</span>${pct ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>${L.note(i) ? `<span class="lr-score">★ ${esc(note10(L.note(i)))}</span>` : '<span></span>'}${i.status === 'seen' ? `<span class="lr-seen" title="${esc(t('Vu'))}">${I('check')}</span>` : '<span></span>'}</a><a class="btn btn-ghost btn-icon f lr-play" aria-label="${esc(t('Lire {t}', { t: i.title }))}" href="${href(lirePath(i.play ? i.play.id : i.id))}">${I('play')}</a></div>`;
  }
  V.browse = (kind, vue) => {
    const tab = (on, label, path) => `<a class="vt f${on ? ' on' : ''}" role="tab" aria-selected="${on}" href="${href(path)}">${esc(label)}</a>`;
    const upcomingTab = ['show', 'anime', 'movie'].includes(kind) && vue === 'avenir';
    const wishTab = kind === 'mylist' && vue === 'envies';
    const tabs = ['show', 'anime', 'movie'].includes(kind) ? `<div class="view-tabs" role="tablist">${tab(!upcomingTab, t('Bibliothèque'), PATHS[kind])}${tab(upcomingTab, t('À venir'), `${PATHS[kind]}?vue=avenir`)}</div>`
      : kind === 'mylist' ? `<div class="view-tabs" role="tablist">${tab(!wishTab, t('Dans Venus'), PATHS.mylist)}${tab(wishTab, t('Mes envies'), `${PATHS.mylist}?vue=envies`)}</div>` : '';
    if (upcomingTab || wishTab) return `<main class="with-nav page-in">${V.attente(kind, tabs, wishTab)}</main>`;
    const isClip = kind === 'clip', f = fOf(kind), items = L.itemsOf(S.items, kind), shown = shownOf(kind);
    const view = S.libView[kind] || (isClip ? 'wide' : 'poster');
    const s = f.sort === 'mine' ? null : SORTS.find((x) => x[0] === f.sort);
    const filtersOn = f.genres.length + f.decades.length + f.quality.length + (f.minScore ? 1 : 0);
    const tags = [...f.genres.map((g) => ['genres', g, g]), ...f.decades.map((d) => ['decades', d, t('Années {d}', { d: String(d).slice(2) })]), ...(f.minScore ? [['minScore', f.minScore, t('Note {n} et plus', { n: nombre(Number(f.minScore) / 10) })]] : []), ...f.quality.map((q) => ['quality', q, t(QUALITY.find((x) => x[0] === q)[1])])]
      .map(([k, v, l]) => `<button class="af f" aria-label="${esc(t('Retirer le filtre {f}', { f: l }))}" data-act="unfilter" data-k="${k}" data-v="${esc(v)}" data-kind="${kind}">${esc(l)}${I('close')}</button>`);
    if (tags.length > 1) tags.push(`<button class="linkish f" data-act="resetf" data-kind="${kind}">${esc(t('Tout effacer'))}</button>`);
    const word = isClip ? ['{n} clip', '{n} clips'] : ['{n} titre', '{n} titres'];
    const grid = shown.length ? shown.map((i) => (view === 'list' ? ListRow(i) : Card(i, { poster: view === 'poster' && !isClip }))).join('')
      : !items.length ? (kind === 'mylist' ? Empty(t('Votre liste est vide. Ajoutez des titres avec le bouton + sur leur fiche.')) : kind === 'anime' || kind === 'clip' ? Empty(t('Aucun titre rangé ici pour l’instant : le rangement des animés et des clips arrive avec Pléiades et Sirius.')) : libVide())
        : Empty(f.status === 'unseen' && !filtersOn ? t('Vous avez tout vu ici. Bravo.') : t('Aucun titre ne correspond à ces filtres.'), `<button class="btn btn-ghost btn-small f" data-act="resetall" data-kind="${kind}">${esc(t('Tout afficher'))}</button>`);
    const count = shown.length !== items.length ? t('{a} sur {b}', { a: nombre(shown.length), b: tn(items.length, ...word) }) : tn(items.length, ...word);
    return `<main class="with-nav page-in"><div class="page"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(t(TITLES[kind]))}</h1><p class="count" aria-live="polite">${esc(count)}</p></div>
    ${tabs || (isClip && items.length ? `<div class="actions play-all"><a class="btn btn-play btn-small f" href="${href(lirePath(shown[0] ? shown[0].id : items[0].id))}">${I('play')}${esc(t('Tout lire'))}</a></div>` : '')}</div>
    <div class="toolbar"><div class="seg" role="group" aria-label="${esc(t('Filtrer par visionnage'))}">${STATUS.map(([id, l]) => `<button class="seg-b f${f.status === id ? ' on' : ''}" aria-pressed="${f.status === id}" data-act="status" data-kind="${kind}" data-v="${id}">${esc(t(l))}</button>`).join('')}</div>
    <div class="tools"><button class="tool f" aria-haspopup="true" aria-expanded="false" aria-label="${esc(s ? t('Trier : {a}, {b}', { a: t(s[1]), b: t(s[2][f.desc ? 1 : 0]) }) : t('Trier : ordre de la liste'))}" data-act="sortmenu" data-kind="${kind}">${I('sort')}<span class="lbl">${esc(s ? t(s[1]) : t('Ordre de la liste'))}</span>${f.desc && f.sort !== 'random' ? '<small>↑</small>' : ''}</button>
    <button class="tool f${filtersOn ? ' on' : ''}" aria-haspopup="true" aria-expanded="false" aria-label="${esc(filtersOn ? t('Filtres : {n} actifs', { n: nombre(filtersOn) }) : t('Filtres'))}" data-act="filtermenu" data-kind="${kind}">${I('filter')}<span class="lbl">${esc(t('Filtres'))}</span>${filtersOn ? `<b class="tool-n">${nombre(filtersOn)}</b>` : ''}</button>
    <div class="seg icons" role="group" aria-label="${esc(t('Affichage'))}">${VIEWS.filter(([id]) => !isClip || id !== 'poster').map(([id, l, ic]) => `<button class="seg-b f${view === id ? ' on' : ''}" title="${esc(t(l))}" aria-label="${esc(t('Affichage : {v}', { v: t(l) }))}" aria-pressed="${view === id}" data-act="view" data-kind="${kind}" data-v="${id}">${I(ic)}</button>`).join('')}</div>
    <button class="tool f" title="${esc(t('Ouvrir un titre au hasard parmi ceux affichés'))}" aria-label="${esc(t('Au hasard : ouvrir un titre parmi ceux affichés'))}" data-act="random" data-kind="${kind}">${I('shuffle')}<span class="lbl">${esc(t('Au hasard'))}</span></button></div></div>
    <div class="active-filters"${tags.length ? '' : ' hidden'}>${tags.join('')}</div>
    <div class="grid view-${view}${view === 'wide' || (isClip && view !== 'list') ? ' grid-wide' : ''}">${grid}</div></div></main>`;
  };
  // « À venir » et « Mes envies » (Upcoming.js) : voir plus bas, V.upcoming et V.wishes.
  V.attente = (kind, tabs, envies) => (envies ? V.wishes(tabs) : V.upcoming(kind, tabs));

  // Fiche (pages/Details.js)
  V.details = (id) => {
    const f = S.fiche[id];
    if (!f) { chargerFiche(id); return PageLoading(); }
    if (f.erreur) return `<main class="with-nav page-in"><div class="page">${Empty(t('Ce titre n’est pas (ou plus) dans la bibliothèque.'), `<a class="btn btn-ghost btn-small f" href="${href('/')}">${esc(t('Accueil'))}</a>`)}</div></main>`;
    const d = S.items.find((x) => x.id === id) || f.titre, isShow = d.type === 'show', isClip = d.type === 'clip';
    const lib = PATHS[d.category] || '/films';
    const seen = d.status === 'seen';
    const p = d.progress, endPos = p && !p.watched ? p.position : 0;
    const total = (d.runtime || 0) * 60;
    const ends = total ? date(Date.now() + (total - endPos) * 1000, { hour: '2-digit', minute: '2-digit' }) : '';
    const next = d.play || { id: d.id, position: 0 };
    const label = isShow ? (d.status === 'progress' ? t('Reprendre S{s}:É{e}', { s: nombre(next.season), e: nombre(next.episode) }) : t('Lecture')) : endPos ? t('Reprendre') : t('Lecture');
    const nSeasons = d.seasons || 0, nEps = d.episodes || 0;
    let seasonsHtml = '';
    if (isShow && f.saisons && f.saisons.length) {
      const cur = f.saisons.find((s) => s.number === S.season) || f.saisons.find((s) => s.number === next.season) || f.saisons[0];
      const vus = cur.episodes.filter((e) => e.watched).length;
      const eps = L.episodesSaison(cur).filter((e) => S.epFilter === 'all' || (S.epFilter === 'seen' ? e.watched && !e.missing : !e.watched && !e.missing));
      const nu = d.status === 'progress' ? cur.episodes.find((e) => e.id === next.id) || f.saisons.flatMap((s) => s.episodes).find((e) => e.id === next.id) : null;
      seasonsHtml = `${nu ? `<section class="d-section next-up"><h2 class="section-title">${esc(t('Reprendre'))}</h2><div class="nu-card"><a class="nu-shot f" aria-label="${esc(t('Lire S{s}:É{e}', { s: nombre(next.season), e: nombre(next.episode) }))}" href="${href(lirePath(next.id))}">${nu.still ? `<img src="${esc(nu.still)}" alt="" loading="lazy" decoding="async">` : `<div class="ph" style="--h:${hueOf(d.title + next.id)}"></div>`}<span class="ep-play">${I('play')}</span>${nu.duration ? `<div class="bar"><i style="width:${Math.min(100, (nu.position / nu.duration) * 100)}%"></i></div>` : ''}</a><div class="nu-text"><b class="nu-link">${esc(t('S{s}:É{e}', { s: nombre(next.season), e: nombre(next.episode) }))}</b><small>${esc([t('Saison {n}', { n: nombre(next.season) }), nu.runtime ? duree(nu.runtime) : '', nu.duration ? reste(nu) : ''].filter(Boolean).join(' · '))}</small></div></div></section>` : ''}
      <section class="d-section" id="episodes"><div class="ep-head"><h2 class="section-title">${esc(f.saisons.length > 1 ? tn(f.saisons.length, '{n} saison', '{n} saisons') : t('Épisodes'))}</h2>${f.saisons.length > 1 ? `<div class="season-arrows"><button class="season-arrow f" aria-label="${esc(t('Saison précédente'))}" data-act="season" data-v="${f.saisons[Math.max(0, f.saisons.indexOf(cur) - 1)].number}">${I('back')}</button><button class="season-arrow f" aria-label="${esc(t('Saison suivante'))}" data-act="season" data-v="${f.saisons[(f.saisons.indexOf(cur) + 1) % f.saisons.length].number}">${I('fwd')}</button></div>` : ''}<div class="chips" role="group" aria-label="${esc(t('Filtrer les épisodes'))}">${[['all', 'Tous'], ['unseen', 'Non vus'], ['seen', 'Déjà vus']].map(([k, l]) => `<button class="chip small f${k === S.epFilter ? ' on' : ''}" aria-pressed="${k === S.epFilter}" data-act="epf" data-v="${k}">${esc(t(l))}</button>`).join('')}</div></div>
      ${f.saisons.length > 1 ? `<div class="season-bar" role="tablist" aria-label="${esc(t('Saisons'))}">${f.saisons.map((s) => { const v = s.episodes.filter((e) => e.watched).length, n = s.episodes.length; return `<button class="season-card f${s === cur ? ' on' : ''}${v === n ? ' done' : ''}" role="tab" aria-selected="${s === cur}" data-act="season" data-v="${s.number}"><span class="season-pic"><div class="ph" style="--h:${hueOf(`${d.title}${s.number}`)}"></div><i class="season-prog"><i style="width:${n ? Math.round((v / n) * 100) : 0}%"></i></i></span><b>${esc(t('Saison {n}', { n: nombre(s.number) }))}</b><span>${esc(v === n ? t('Vue en entier') : t('{v} / {n} vus', { v: nombre(v), n: nombre(n) }))}</span></button>`; }).join('')}</div>` : ''}
      <div class="season-head"><div class="sh-info"><b>${esc(t('Saison {n}', { n: nombre(cur.number) }))}</b><span>${esc([tn(cur.episodes.length, '{n} épisode', '{n} épisodes'), cur.manquants.length ? tn(cur.manquants.length, '{n} manquant', '{n} manquants') : '', tn(cur.episodes.length - vus, '{n} à voir', '{n} à voir')].filter(Boolean).join(' · '))}</span></div>${!S.profile.isKids && cur.episodes.length ? `<div class="sh-actions"><button class="btn btn-small btn-ghost btn-icon f" aria-label="${esc(t('Télécharger la saison'))}" title="${esc(t('Télécharger la saison'))}" data-act="dlseason" data-v="${esc(d.id)}" data-s="${esc(String(cur.number))}">${I('down')}</button></div>` : ''}</div>
      <div class="episodes">${eps.map((e) => (e.missing
        ? `<div class="episode missing" title="${esc(t('Épisode {n} : pas dans vos dossiers', { n: nombre(e.episode) }))}"><div class="thumb"><span class="miss-num">${nombre(e.episode)}</span><span class="miss-tag">${esc(t('Manquant'))}</span></div><div class="ep-line"><b>${esc(t('Épisode {n}', { n: nombre(e.episode) }))}</b>${S.profile.isAdmin ? `<button class="btn btn-ghost btn-small f ep-get" data-act="epgrab" data-v="${esc(d.id)}" data-t="${esc(d.title)}" data-s="${cur.number}" data-e="${e.episode}" aria-label="${esc(t('Faire venir l’épisode {n}', { n: nombre(e.episode) }))}"${S.pris.has(`ep|${d.id}|${cur.number}|${e.episode}`) ? ' disabled' : ''}>${I(S.pris.has(`ep|${d.id}|${cur.number}|${e.episode}`) ? 'check' : 'download')}${esc(t('Faire venir'))}</button>` : ''}</div></div>`
        : `<div class="ep-item"><a class="episode f${e.id === next.id && d.status === 'progress' ? ' is-current' : ''}${e.watched ? ' seen' : ''}" title="${esc(t('Épisode {n}', { n: nombre(e.episode) }))}" aria-label="${esc([t('Épisode {n}', { n: nombre(e.episode) }), e.runtime ? duree(e.runtime) : '', e.watched ? t('vu') : ''].filter(Boolean).join(', '))}" href="${href(lirePath(e.id))}"><div class="thumb">${e.still ? `<img src="${esc(e.still)}" alt="" loading="lazy" decoding="async">` : `<div class="ph" style="--h:${hueOf(`${d.title}${cur.number}${e.episode}`)}"></div>`}<span class="ep-play">${I('play')}</span>${e.position > 0 && !e.watched && e.duration ? `<div class="bar"><i style="width:${Math.min(100, (e.position / e.duration) * 100)}%"></i></div><span class="ep-badge now">${esc(t('En cours'))}</span>` : ''}</div><div class="ep-line"><b>${esc(t('Épisode {n}', { n: nombre(e.episode) }))}</b>${e.runtime ? `<span>${esc(duree(e.runtime))}</span>` : ''}</div></a><button class="ep-toggle f${e.watched ? ' on' : ''}" aria-pressed="${e.watched}" aria-label="${esc(e.watched ? t('Marquer l’épisode {n} comme non vu', { n: nombre(e.episode) }) : t('Marquer l’épisode {n} comme vu', { n: nombre(e.episode) }))}" data-act="epseen" data-v="${esc(e.id)}" data-d="${e.duration || (e.runtime || 0) * 60}" data-on="${e.watched ? 1 : 0}">${I('check')}</button></div>`)).join('')}</div></section>`;
    }
    const te = f.tech || {}, mt = f.meta || {}, genres = mt.genres || [], ba = f.bandeAnnonce || { local: false, raison: '' };
    const gens = [...(mt.cast || []), ...(mt.crew || [])];
    const ratings = mt.critics || mt.vote ? `<div class="ratings">${mt.critics ? `<span class="rating r-imdb" title="${esc(t('Note des critiques : {n} sur 10', { n: note10(mt.critics) }))}"><span class="r-src">${esc(t('Critiques'))}</span><b>${esc(note10(mt.critics))}</b><small>/10</small></span>` : ''}${mt.vote ? `<span class="rating r-tmdb" title="${esc(t('Note du public : {n} sur 10', { n: note10(mt.vote) }))}"><span class="r-src">${esc(t('Public'))}</span><b>${esc(nombre(Math.round(mt.vote * 10)))} %</b></span>` : ''}</div>` : '';
    const memeGenre = genres.length ? L.itemsOf(S.items, d.category).filter((x) => x.id !== d.id && (x.genres || []).some((g) => genres.includes(g))) : [];
    const similaires = memeGenre.length ? memeGenre : L.itemsOf(S.items, d.category).filter((x) => x.id !== d.id);
    return `<main class="with-nav page-in"><div class="details amb" style="--amb:hsl(${hueOf(d.title)} 60% 55%)">
    <div class="details-bg">${d.backdrop || d.poster ? `<img src="${esc(d.backdrop || d.poster)}" alt="" class="fade ok">` : ''}</div>
    <div class="details-body"><div class="details-top"><div class="details-poster${isClip ? ' wide' : ''}">${Pic(d)}</div>
      <div class="details-main"><h1 class="hero-title" tabindex="-1">${esc(d.title)}</h1>
        <div class="meta">${d.year ? `<span>${esc(String(d.year))}</span>` : ''}${!isShow && d.runtime ? `<span>${esc(duree(d.runtime))}</span>` : ''}${isShow ? `<span>${esc(`${tn(nSeasons, '{n} saison', '{n} saisons')}, ${tn(nEps, '{n} épisode', '{n} épisodes')}`)}</span>` : ''}${L.note(d) ? `<span>${esc(note10(L.note(d)))}/10</span>` : ''}${d.res ? `<span class="badge">${esc(d.res)}</span>` : ''}${ends && !isShow ? `<span class="ends-at">${esc(t('Se termine à {h}', { h: ends }))}</span>` : ''}</div>
        ${genres.length ? `<div class="genre-links">${genres.map((g) => `<a class="tag f" href="${href(`${lib}?genre=${encodeURIComponent(g)}`)}">${esc(g)}</a>`).join('')}</div>` : ''}
        ${ratings}${mt.tagline ? `<p class="tagline">${esc(mt.tagline)}</p>` : ''}
        ${mt.overview ? `<p class="hero-overview clamp">${esc(mt.overview)}</p>` : S.profile.isAdmin ? `<p class="hero-overview clamp muted">${esc(t('Pas de résumé : choisissez un catalogue dans Réglages → Demandes pour les affiches, résumés et distribution.'))}</p>` : ''}
        <div class="actions">
          <a class="btn btn-play f" href="${href(lirePath(next.id))}">${I('play')}${esc(label)}</a>
          ${endPos ? `<a class="btn btn-ghost btn-icon f" aria-label="${esc(t('Recommencer depuis le début'))}" title="${esc(t('Recommencer'))}" href="${href(`${lirePath(next.id)}?debut=1`)}">${I('restart')}</a>` : ''}
          <button class="btn btn-ghost btn-icon f" aria-label="${esc(t('Envoyer vers un autre écran'))}" title="${esc(t('Envoyer vers la télé'))}" data-act="sendto" data-v="${esc(next.id)}">${I('cast')}</button>
          <button class="btn btn-ghost btn-icon f" aria-label="${esc(d.inList ? t('Retirer de ma liste') : t('Ajouter à ma liste'))}" title="${esc(t('Ma liste'))}" aria-pressed="${d.inList}" data-act="mylist" data-v="${esc(d.id)}">${I(d.inList ? 'check' : 'plus')}</button>
          ${S.profile.isKids ? '' : `<button class="btn btn-ghost btn-icon f" aria-label="${esc(t('Ajouter à une liste'))}" title="${esc(t('Ajouter à une liste'))}" data-act="addto" data-v="${esc(d.id)}">${I('list')}</button>`}
          ${!isShow && !S.profile.isKids ? `<button class="btn btn-ghost btn-icon f" aria-label="${esc(t('Télécharger'))}" title="${esc(t('Télécharger'))}" data-act="dlsheet" data-v="${esc(d.id)}">${I('down')}</button>` : ''}
          ${!isShow ? `<button class="btn btn-ghost btn-icon f${seen ? ' is-on' : ''}" aria-label="${esc(seen ? t('Marquer comme non vu') : t('Marquer comme vu'))}" title="${esc(seen ? t('Vu : marquer comme non vu') : t('Marquer comme vu'))}" aria-pressed="${seen}" data-act="seen" data-v="${esc(d.id)}" data-d="${total}" data-on="${seen ? 1 : 0}">${I('eye')}</button>` : ''}
          ${ba.local ? `<button class="btn btn-ghost f" data-act="trailer" data-v="${esc(d.id)}">${I('film')}${esc(t('Bande-annonce'))}</button>` : `<button class="btn btn-ghost f" aria-disabled="true" title="${esc(t(ba.raison || ''))}" data-act="notrailer" data-v="${esc(t(ba.raison || ''))}">${I('film')}${esc(t('Bande-annonce'))}</button>`}
        </div>
        ${endPos ? `<p class="resume-note">${I('clock')} ${esc(t('Vu jusqu’à {m}', { m: duree(Math.round(endPos / 60)) }))}</p>` : ''}
      </div></div>
      ${seasonsHtml}
      <section class="d-section cast"><h2 class="section-title">${esc(t('Distribution et équipe'))}</h2>${gens.length ? ScrollRow(gens.map((p) => `<button class="person f" data-act="person" data-v="${esc(p.id)}" data-role="${esc(p.role)}">${Face(p)}<b>${esc(p.name)}</b>${p.role ? `<span>${esc(p.role)}</span>` : ''}</button>`).join(''), 'cast-row') : Empty(t('Pas encore d’informations sur la distribution de ce titre.'))}</section>
      <section class="d-section about"><div class="about-btns"><button class="btn btn-ghost f" data-act="about" data-v="${esc(d.id)}">${I('info')}${esc(t('À propos'))}</button>${te.fichier ? `<button class="btn btn-ghost f" data-act="tech" data-v="${esc(d.id)}">${I('film')}${esc(t('Fiche technique'))}</button>` : ''}</div></section>
      <div class="d-similar">${Row({ title: isClip ? t('Autres clips') : memeGenre.length ? t('Plus de ce genre') : t('Dans la même bibliothèque'), items: similaires.slice(0, 12), more: lib })}</div>
    </div></div></main>`;
  };

  // Recherche (Search.js)
  V.search = () => {
    const raw = S.searchQ, n = norm(raw);
    const KINDS = [['all', 'Tout'], ['movie', 'Films'], ['show', 'Séries'], ['anime', 'Animés'], ['clip', 'Clips']];
    const keep = (l) => (S.searchKind === 'all' ? l : l.filter((i) => i.category === S.searchKind));
    const Section = (title, inner) => `<section class="search-sec"><h2 class="section-title">${esc(title)}</h2>${inner}</section>`;
    const body = !n ? Section(t('Ajouts récents'), S.items.length ? `<div class="grid">${keep([...S.items].sort((a, b) => b.added - a.added)).slice(0, 18).map((i) => Card(i, { poster: true })).join('')}</div>` : libVide())
      : (() => { const hits = keep(S.items.filter((i) => n.split(' ').every((w) => norm(i.title).includes(w)) || String(i.year || '') === n)); return Section(hits.length ? t('Dans Venus · {n}', { n: nombre(hits.length) }) : t('Dans Venus'), hits.length ? `<div class="grid">${hits.map((i) => Card(i, { poster: true })).join('')}</div>` : `<p class="grid-empty">${esc(t('Rien dans votre médiathèque pour cette recherche.'))}</p>`); })();
    return `<main class="with-nav page-in"><div class="page"><h1 class="sr-only">${esc(t('Recherche'))}</h1><div class="search-box">${I('search')}<input id="srch" type="search" placeholder="${esc(t('Titre, année…'))}" aria-label="${esc(t('Rechercher'))}" autocomplete="off" enterkeyhint="search" value="${esc(raw)}"><button class="search-clear f" type="button" aria-label="${esc(t('Effacer'))}"${raw ? '' : ' hidden'} data-act="sq" data-v="">${I('close')}</button></div>
    <div class="seg search-kinds" role="group" aria-label="${esc(t('Type'))}">${KINDS.map(([k, l]) => `<button class="seg-b f${S.searchKind === k ? ' on' : ''}" aria-pressed="${S.searchKind === k}" data-act="skind" data-v="${k}">${esc(t(l))}</button>`).join('')}</div><div class="search-body">${body}</div></div></main>`;
  };

  // « Qui regarde ? » (Gates.js) : les comptes d'Odin
  V.profiles = () => `<main><div class="center-screen"><div><h1 tabindex="-1">${esc(t('Qui regarde ?'))}</h1><p class="lead">${esc(t('Chaque profil a sa liste, sa progression et ses réglages.'))}</p><div class="profiles">${S.profils.map((p) => `<button class="profile-tile f" data-act="pickprofile" data-v="${esc(p.id)}"${p.id === S.profile.id ? ' aria-current="true"' : ''}>${Avatar(p)}<span class="name">${esc(p.name)}</span></button>`).join('')}</div><p class="muted small" style="text-align:center;margin-top:32px">${esc(t('Les profils sont les comptes d’Odin.'))}</p>${DANS_ODIN ? '' : `<div style="text-align:center;margin-top:16px"><button class="btn btn-ghost btn-small f" data-act="odin">${I('exit')}${esc(t('Revenir à Odin'))}</button></div>`}</div></div></main>`;

  // Réglages (Settings.js) : Thème et menu ; Médiathèques
  const Actions = (inner) => `<div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap">${inner}</div>`;
  const BOX = {
    affichage: () => {
      const cur = T.chosen, tp = PLANETS[cur];
      const theme = `<section class="box"><h2>${esc(t('Thème'))}</h2><p>${esc(t('Choisissez votre planète : tout le site change — couleurs, logo, mais aussi la place du menu, la forme des affiches et des boutons. « Verre » est clair le jour et sombre la nuit, comme un téléphone.'))}</p><div class="theme-grid" role="radiogroup" aria-label="${esc(t('Planète'))}">${Object.entries(PLANETS).map(([id, p]) => `<button class="theme-opt f${id === cur ? ' on' : ''}" role="radio" aria-checked="${id === cur}" data-id="${id}" data-act="planet" data-v="${id}"><span class="theme-pic">${planetMarkup(id)}${id === cur ? '<span class="moon" aria-hidden="true"></span>' : ''}</span><span class="theme-name">${esc(p.name)}</span><small class="theme-layout">${esc(LAYOUTS[layoutOf(id)])}</small></button>`).join('')}</div>
      ${!tp.glass && !tp.light ? `<div class="glass-mode"><div class="seg" role="radiogroup" aria-label="${esc(t('Thème automatique'))}">${[['off', t('Toujours {p}', { p: tp.name })], ['sun', t('Clair le jour, sombre le soir')], ['system', t('Selon l’appareil')]].map(([v, l]) => `<button class="seg-b f${T.auto === v ? ' on' : ''}" role="radio" aria-checked="${T.auto === v}" data-act="autotheme" data-v="${v}">${esc(l)}</button>`).join('')}</div><small>${esc(t('Votre thème suit votre profil sur tous vos appareils.'))}</small></div>` : ''}
      ${tp.glass ? `<div class="glass-mode"><div class="seg" role="radiogroup" aria-label="${esc(t('Clair ou sombre'))}">${[['auto', t('Au rythme du soleil')], ['day', t('Toujours clair')], ['night', t('Toujours sombre')]].map(([v, l]) => `<button class="seg-b f${T.glass === v ? ' on' : ''}" role="radio" aria-checked="${T.glass === v}" data-act="glassmode" data-v="${v}">${esc(l)}</button>`).join('')}</div></div>` : ''}</section>`;
      const fluid = `<section class="box"><h2>${esc(t('Fluidité'))}</h2><p class="muted">${esc(t('Le mode léger coupe les flous et les effets lourds : utile sur une télé, une box ou un vieux téléphone.'))}</p><div class="seg" role="radiogroup" aria-label="${esc(t('Fluidité'))}">${[['auto', 'Automatique'], ['off', 'Effets complets'], ['on', 'Mode léger']].map(([k, l]) => `<button class="seg-b f${k === T.lite ? ' on' : ''}" role="radio" aria-checked="${k === T.lite}" data-act="lite" data-v="${k}">${esc(t(l))}</button>`).join('')}</div></section>`;
      const byId = new Map(NAV_ITEMS.map((i) => [i.id, i]));
      const items = M.order.map((id) => byId.get(id)).filter((it) => it && (!it.admin || S.profile.isAdmin));
      const menu = `<section class="box menu-box" id="menu"><h2>${esc(t('Menu'))}</h2><p>${esc(t('Choisissez ce qui apparaît dans le menu et dans quel ordre. Sur ordinateur, seules les 6 premières sections sont affichées ; le reste est rangé dans « Plus ». Réglages et profil restent toujours en bas.'))}</p><ol class="menu-edit">${items.map((it, i) => `<li class="${M.hidden.includes(it.id) ? 'off' : ''}"><span class="me-ic">${I(val(it.icon))}</span><b>${esc(it.id === 'today' ? t('Aujourd’hui / Ce soir') : val(it.label))}</b><button class="p-icon small f" data-act="mmove" data-v="${it.id}" data-d="-1" aria-label="${esc(t('Monter {s}', { s: val(it.label) }))}"${i === 0 ? ' disabled' : ''}>${I('up')}</button><button class="p-icon small f" data-act="mmove" data-v="${it.id}" data-d="1" aria-label="${esc(t('Descendre {s}', { s: val(it.label) }))}"${i === items.length - 1 ? ' disabled' : ''}>${I('down')}</button><label class="switch mini" title="${esc(t('Afficher dans le menu'))}"><input type="checkbox" class="f" data-act="mtoggle" data-v="${it.id}" aria-label="${esc(t('Afficher {s} dans le menu', { s: val(it.label) }))}"${M.hidden.includes(it.id) ? '' : ' checked'}></label></li>`).join('')}</ol>${Actions(`<button class="btn btn-small btn-ghost f" data-act="mreset">${esc(t('Rétablir le menu d’origine'))}</button>`)}</section>`;
      return theme + fluid + menu;
    },
    medias: () => {
      if (S.dossiers === null) { api('/venus/dossiers').then((d) => { S.dossiers = d.dossiers || []; rerender(); }).catch(() => { S.dossiers = []; rerender(); }); }
      const l = S.dossiers || [];
      return `<section class="box"><h2>${esc(t('Médiathèques'))}</h2><p>${esc(t('Les dossiers de la machine d’Odin que Venus lit. On les déclare, on lance un scan, on envoie des fichiers et on pilote les écrans depuis la page de gestion d’Odin.'))}</p>${l.length ? `<ul class="track-list">${l.map((x) => `<li><code>${esc(x.chemin)}</code> · ${esc(x.categorie)}</li>`).join('')}</ul>` : `<p class="muted">${esc(S.dossiers === null ? t('Chargement…') : t('Aucun dossier déclaré.'))}</p>`}${Actions(`<button class="btn btn-small f" data-act="classique">${I('folder')}${esc(t('Médiathèques et écrans'))}</button>`)}</section>`;
    },
  };
  V.settings = () => {
    const NAVS = [['Vous', [['affichage', 'Thème et menu', 'image']]], ...(S.profile.isAdmin ? [['Médias', [['medias', 'Médiathèques', 'folder'], ['demandes', 'Demandes', 'download']]]] : [])];
    const TABS = NAVS.flatMap(([, i]) => i), cur = TABS.find(([k]) => k === S.setTab) || TABS[0];
    return `<main class="with-nav page-in"><div class="page admin"><div class="page-head"><h1 tabindex="-1">${esc(t('Réglages'))}</h1></div>
    <div class="set-layout"><nav class="set-nav" aria-label="${esc(t('Rubriques des réglages'))}">${NAVS.map(([g, items]) => `<div class="set-group">${NAVS.length > 1 ? `<span class="set-group-t">${esc(t(g))}</span>` : ''}${items.map(([k, l, ic]) => `<button class="set-tab f${k === cur[0] ? ' on' : ''}"${k === cur[0] ? ' aria-current="page"' : ''} data-act="settab" data-v="${k}">${I(ic)}<span>${esc(t(l))}</span></button>`).join('')}</div>`).join('')}</nav>
    <div class="set-main"><div class="set-head"><h2>${esc(t(cur[1]))}</h2></div><div class="admin-grid">${BOX[cur[0]]()}</div></div></div></div></main>`;
  };
  // ---------------------------------------------------------------- demandes et téléchargements (écrans, lots V4-V6)
  // Upcoming.js (« À venir », « Mes envies »), Nouveautes.js, Request.js (« Nouveau » et sa file), SettingsAdmin.js
  // (Réglages → Demandes), branchés sur les applicatifs natifs de Vénus : Hnoss (demandes, envies), Sirius (films),
  // Pléiades (séries, animés), Delta (sources), Comète (file). Les titres venus d'un catalogue sont écrits comme du
  // texte (esc), jamais comme du code ; aucune image extérieure n'est chargée (le carré de couleur de Venus à la place).
  const agir = (action, input = {}, confirm = false) => api('/api/valhalla/act', { module: 'freyja', action, input, ...(confirm ? { confirm: true } : {}) });
  const envoyer = (corps) => api('/api/valhalla/act', corps);
  const premiere = (r, repli) => String((r && (r.text || r.error || r.confirm)) || repli || t('Impossible pour le moment.')).split('\n')[0];
  // Le registre des titres cliquables : un même titre (clé, saison, épisode, type) garde TOUJOURS le même indice, même
  // après un nouveau rendu (avant : remis à zéro à chaque rendu, une fenêtre restée ouverte pouvait viser un autre titre).
  const regIdx = new Map();
  const reg = (x) => { const id = `${x.key}|${x.season ?? ''}|${x.episode ?? ''}|${x.type || ''}`; let i = regIdx.get(id); if (i === undefined) { i = S.reg.length; regIdx.set(id, i); S.reg.push(x); } else S.reg[i] = x; return i; };
  const cleSortie = (e) => `${e.key}|${e.season ?? ''}|${e.episode ?? ''}`;
  const appDe = (kind) => (kind === 'movie' ? 'Sirius' : 'Pléiades');
  const nomDe = (e) => e.title || '';
  const epLabel = (e) => (e.kind === 'movie' ? [t(e.release || 'Sortie'), e.year].filter(Boolean).join(' · ') : `${e.season != null ? t('S{s}:É{e}', { s: nombre(e.season), e: nombre(e.episode ?? 0) }) : t('Épisode {n}', { n: nombre(e.episode ?? 0) })}${e.epTitle ? ` - ${e.epTitle}` : ''}`);
  const jourLocal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const fmtJour = (iso, an = true) => date(Date.parse(`${iso}T12:00:00`), { day: 'numeric', month: 'long', ...(an ? { year: 'numeric' } : {}) });
  const libelleJour = (iso) => {
    const dt = new Date(`${iso}T00:00:00`), t0 = new Date(`${jourLocal(Date.now())}T00:00:00`), diff = Math.round((dt - t0) / 864e5);
    if (diff === 0) return t('Aujourd’hui'); if (diff === -1) return t('Hier'); if (diff === 1) return t('Demain');
    const s = date(dt.getTime(), { weekday: 'long', day: 'numeric', month: 'short', ...(dt.getFullYear() !== t0.getFullYear() ? { year: 'numeric' } : {}) });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const UpPh = (e) => `<div class="up-ph" style="--h:${hueOf(nomDe(e))}"><span>${esc(nomDe(e))}</span></div>`;

  async function chargerAVenir(kind) {
    S.up[kind] = { chargement: true };
    try { const r = await agir('a_venir', { genre: GENRE[kind] }); if (r.ok === false) throw new Error(premiere(r)); S.up[kind] = { data: r.data }; for (const e of [...(r.data.entries || []), ...(r.data.suggestions || [])]) if (e.wanted) S.favs.add(e.key); }
    catch (err) { S.up[kind] = { erreur: String(err.message || err) }; }
    rerender();
  }
  const FavBtn = (e, wide = false) => { const on = S.favs.has(e.key), i = reg(e); return `<button type="button" class="up-act fav f${wide ? ' wide btn' : ''}${on ? ' on' : ''}" title="${esc(on ? t('Retirer des favoris') : t('Favori : téléchargé automatiquement'))}" aria-label="${esc(on ? t('Retirer « {t} » des favoris', { t: nomDe(e) }) : t('Mettre « {t} » en favori (téléchargement automatique)', { t: nomDe(e) }))}" aria-pressed="${on}" data-act="fav" data-i="${i}">${I('heart')}${wide ? esc(on ? t('En favori') : t('Favori')) : ''}</button>`; };
  const DlBtn = (e, kind, wide = false) => {
    const k = cleSortie(e), done = S.pris.has(k), busy = S.busy.has(k), app = appDe(kind), i = reg(e);
    const title = done ? t('Déjà suivi par {a} : téléchargé dès sa sortie', { a: app }) : t('Télécharger avec {a}', { a: app });
    return `<button type="button" class="up-act dl f${wide ? ' wide btn' : ''}${done ? ' done' : ''}${busy ? ' busy' : ''}"${done || busy ? ' disabled' : ''} title="${esc(title)}" aria-label="${esc(title)}" data-act="grab" data-i="${i}">${I(done ? 'check' : 'download')}${wide ? esc(done ? t('Suivi par {a}', { a: app }) : t('Télécharger')) : ''}</button>`;
  };
  V.upcoming = (kind, tabs) => {
    const st = S.up[kind];
    if (!st || st.chargement) { if (!st) void chargerAVenir(kind); return '<div class="page" aria-busy="true"><i class="sk" style="width:220px;height:48px"></i></div>'; }
    if (st.erreur) return `<div class="page"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(t(TITLES[kind]))}</h1></div>${tabs}</div><div class="empty"><h2>${esc(t('Impossible d’afficher les sorties'))}</h2><p>${esc(st.erreur)}</p></div></div>`;
    const d = st.data, kids = !!S.profile.isKids, filtre = S.upFilter[kind] || 'all', app = appDe(kind);
    const hier = jourLocal(Date.now() - 864e5), today = jourLocal(Date.now());
    const groups = L.jours(d.entries, filtre, S.favs), before = groups.filter((g) => g.day < hier), shown = S.upEarlier[kind] ? groups : groups.filter((g) => g.day >= hier);
    const sugs = (filtre === 'all' || filtre === 'out') && !kids ? d.suggestions || [] : [];
    const count = (d.entries || []).length;
    const FILTERS = [['all', 'Tout'], ['nas', 'Disponibles'], ['out', 'Pas disponibles'], ['fav', 'Mes favoris']].filter(([k]) => !(kids && (k === 'out' || k === 'fav')));
    const card = (e) => {
      // Comme Upcoming.js : la carte d'un titre déjà dans Vénus ouvre sa fiche et n'a pas de ♡ ⬇ ; « Disponible » veut dire
      // que CE film ou CET épisode est là (une série dans Vénus dont l'épisode n'est pas encore sorti : « Pas disponible »).
      const ok = !!e.nas, dispo = e.kind === 'movie' ? ok : !!e.epId;
      return `<div class="up-card${ok ? '' : ' out'}"><button type="button" class="up-pic f" aria-label="${esc(`${nomDe(e)}, ${epLabel(e)}`)}" ${ok ? `data-act="upopen" data-v="${esc(e.nas)}"` : `data-act="upsheet" data-i="${reg(e)}" data-k="${kind}"`}>${UpPh(e)}<span class="up-badge ${dispo ? 'in' : 'out'}">${esc(dispo ? t('Disponible') : t('Pas disponible'))}</span>${e.at && e.kind !== 'movie' ? `<span class="up-time">${esc(date(e.at, { hour: '2-digit', minute: '2-digit' }))}</span>` : ''}</button>
      ${!ok && !kids ? `<div class="up-acts">${FavBtn(e)}${DlBtn(e, kind)}</div>` : ''}<b>${esc(nomDe(e))}</b><span>${esc(epLabel(e))}</span></div>`;
    };
    const vide = !d.source
      ? `<div class="grid-empty"><p>${esc(t(d.texte || 'Aucun catalogue des sorties n’est réglé.'))}</p>${S.profile.isAdmin ? `<button class="btn btn-small f" data-act="godemandes">${I('gear')}${esc(t('Régler le catalogue des sorties'))}</button>` : ''}</div>`
      : `<div class="grid-empty"><p>${esc(filtre === 'fav' ? t('Aucun favori à venir.') : filtre === 'nas' ? t('Rien de disponible pour ces jours-ci.') : t('Rien d’annoncé pour l’instant.'))}</p>${(d.erreurs || []).length ? `<p class="muted">${esc(t('Le catalogue ne répond pas pour l’instant : {e}', { e: d.erreurs[0] }))}</p>` : ''}</div>`;
    return `<div class="page"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(t(TITLES[kind]))}</h1><p class="count">${esc(kind === 'movie' ? tn(count, '{n} sortie', '{n} sorties') : tn(count, '{n} épisode', '{n} épisodes'))}</p></div>${tabs}</div>
    <div class="up-bar"><div class="seg up-filter" role="radiogroup" aria-label="${esc(t('Afficher'))}">${FILTERS.map(([k, l]) => `<button class="seg-b f${k === filtre ? ' on' : ''}" role="radio" aria-checked="${k === filtre}" data-act="upfilter" data-kind="${kind}" data-v="${k}">${esc(t(l))}</button>`).join('')}</div>
    <div class="up-bar-right">${!kids ? `<span class="muted small">${I('heart')} ${esc(t('Favori = téléchargé automatiquement par {a}', { a: app }))}</span>` : ''}<button class="btn btn-small btn-ghost f" title="${esc(t('Les sorties de vos séries, films et favoris dans le calendrier de votre téléphone'))}" data-act="ical">${I('cal')}${esc(t('Ajouter à mon calendrier'))}</button></div></div>
    ${sugs.length ? `<section class="up-sugs"><h2 class="section-title">${esc(kind === 'movie' ? t('Films à découvrir') : kind === 'anime' ? t('Animés à découvrir') : t('Séries à découvrir'))}<small>${esc(t('pas encore disponibles'))}</small></h2><div class="up-sug-row">${sugs.map((e) => `<div class="up-sug"><button type="button" class="up-sug-pic f" aria-label="${esc(nomDe(e))}" data-act="upsheet" data-i="${reg(e)}" data-k="${kind}">${UpPh(e)}<span class="up-sug-date">${esc(libelleJour(e.date))}</span></button>${kids ? '' : `<div class="up-acts">${FavBtn(e)}${DlBtn(e, kind)}</div>`}<b>${esc(nomDe(e))}</b><small>${esc(e.kind === 'movie' ? [t(e.release || 'Sortie'), e.year].filter(Boolean).join(' · ') : [e.network, e.genres && e.genres[0]].filter(Boolean).join(' · ') || epLabel(e))}</small></div>`).join('')}</div></section>` : ''}
    <div class="upcoming">${before.length && !S.upEarlier[kind] ? `<button class="btn btn-small btn-ghost up-earlier f" data-act="upearlier" data-kind="${kind}">${I('up')}${esc(t('Voir les {n} jours précédents', { n: nombre(before.length) }))}</button>` : ''}
    ${shown.map((g) => `<section class="up-day${g.day < today ? ' past' : ''}${g.day === today ? ' today' : ''}"><h2 class="section-title">${esc(libelleJour(g.day))}<small>${esc(fmtJour(g.day))}</small></h2><div class="up-grid">${g.items.map(card).join('')}</div></section>`).join('')}
    ${shown.length ? '' : vide}</div></div>`;
  };
  function upSheet(e, kind) {
    const kids = !!S.profile.isKids, app = appDe(kind);
    openSheet(null, `<div class="up-sheet"><div class="up-sheet-pic">${UpPh(e)}</div><div class="up-sheet-body"><h2>${esc(nomDe(e))}</h2><p class="muted">${esc([e.kind === 'movie' ? t(e.release || 'Sortie') : epLabel(e), e.date ? fmtJour(e.date) : '', e.network].filter(Boolean).join(' · '))}</p>
      ${e.genres && e.genres.length ? `<p class="up-genres">${esc(e.genres.slice(0, 4).join(' · '))}</p>` : ''}${e.overview ? `<p class="up-over">${esc(e.overview)}</p>` : ''}
      ${kids ? '' : `<div class="up-sheet-acts">${FavBtn(e, true)}${DlBtn(e, kind, true)}</div><p class="muted small">${esc(t('Favori : le titre rejoint « Mes envies » et {a} le télécharge dès qu’il est disponible.', { a: app }))}</p>`}</div></div>`, { wide: true });
  }
  // Abonnement iCal (Upcoming.js, subscribe()) : le calendrier du téléphone affiche les épisodes et sorties du profil.
  // Le lien personnel est un secret : demandé en POST (Odin remontre le même tant qu'il vit), jamais gardé dans la page.
  async function subscribe() {
    let r; try { r = await api('/venus/hnoss/calendrier', {}); } catch { toast(t('Impossible pour le moment.')); return; }
    const url = String((r && r.url) || ''); if (!/^https?:\/\//.test(url)) { toast(t('Impossible pour le moment.')); return; }
    const webcal = url.replace(/^https?:/, 'webcal:');
    openSheet(t('Ajouter à mon calendrier'), `<div class="cal-sheet"><p>${esc(t('Les épisodes de vos séries, les sorties de films demandées et vos favoris apparaissent dans le calendrier de votre téléphone ou de votre ordinateur, mis à jour tout seuls.'))}</p>
      <div class="btn-row"><a class="btn btn-play f" href="${esc(webcal)}">${I('cal')}${esc(t('S’abonner (iPhone, Mac, Outlook)'))}</a><button class="btn f" data-act="calcopy" data-v="${esc(url)}">${I('copy')}${esc(t('Copier le lien'))}</button></div>
      <input class="input cal-link" readonly value="${esc(url)}" aria-label="${esc(t('Lien du calendrier'))}">
      <p class="muted small">${esc(t('Google Agenda : Paramètres → Ajouter un agenda → À partir de l’URL, puis collez le lien. Ce lien est personnel : ne le partagez pas. Il ne fonctionne que sur le réseau de la maison (ou à distance si Venus est accessible depuis Internet).'))}</p></div>`);
  }

  // Mes envies (Upcoming.js → Wishes)
  const ETAT_ENVIE = { 'à valider': ['pending', 'Demandé, en attente de validation'], 'en attente': ['processing', 'Demandé : téléchargé dès sa sortie'], cherchée: ['processing', 'Demandé, recherche en cours'], 'en téléchargement': ['processing', 'Téléchargement en cours'], disponible: ['available', 'Disponible, arrive dans Venus'], échec: ['error', 'Pas trouvé'] };
  V.wishes = (tabs) => {
    if (S.envies === null) { S.envies = undefined; agir('hnoss_envies').then((r) => { S.envies = (r.data && r.data.envies) || []; rerender(); }).catch(() => { S.envies = []; rerender(); }); }
    if (!S.envies) return '<div class="page" aria-busy="true"><i class="sk" style="width:220px;height:48px"></i></div>';
    const l = S.envies, n = l.length;
    return `<div class="page"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(t('Ma liste'))}</h1><p class="count">${esc(tn(n, '{n} envie', '{n} envies'))}</p></div>${tabs}</div>
    <p class="list-hint">${esc(S.profile.isKids ? t('Vos envies sont visibles par les adultes de la maison, qui décident du téléchargement.') : t('Chaque envie est demandée à Hnoss tout de suite : le téléchargement démarre dès que le titre sort. Une fois arrivé, il passe dans « Dans Venus ».'))}</p>
    <div class="wish-grid">${!n ? `<div class="grid-empty"><p>${esc(t('Aucune envie pour l’instant.'))}</p><p class="muted">${esc(t('Dans Films, Séries ou Animés, onglet « À venir », le ♡ ajoute un titre ici et le fait télécharger.'))}</p><a class="btn btn-small f" href="${href('/series?vue=avenir')}">${I('cal')}${esc(t('Voir ce qui arrive'))}</a></div>`
      : l.map((w) => { const [st, lbl] = ETAT_ENVIE[w.etat] || ['none', 'Suivi']; return `<article class="wish"><div class="wish-pic" aria-hidden="true"><div class="ph" style="--h:${hueOf(w.titre)}"><span>${esc(w.titre)}</span></div></div><div class="wish-body"><b>${esc(w.titre)}</b><span class="wish-meta">${esc([w.genre === 'film' ? t('Film') : w.anime ? t('Animé') : t('Série'), w.annee].filter(Boolean).join(' · '))}</span><span class="wish-state st-${st}">${esc(t(lbl))}</span>${w.etat === 'échec' && w.note ? `<small class="error-text">${esc(w.note)}</small>` : ''}</div><button class="btn btn-ghost btn-icon btn-mini f" aria-label="${esc(t('Retirer {t} de mes envies', { t: w.titre }))}" title="${esc(t('Retirer'))}" data-act="wishrm" data-v="${esc(w.cle || w.id)}" data-t="${esc(w.titre)}">${I('close')}</button></article>`; }).join('')}</div></div>`;
  };

  // Nouveau (Request.js) : chercher un titre et l'ajouter ; en dessous, la file de Comète.
  const RKINDS = [['movie', 'Films', 'film'], ['show', 'Séries', 'tv'], ['anime', 'Animés', 'spark']];
  async function chargerFile() {
    clearTimeout(S.fileT);
    try { const r = await agir('comete_file'); S.file = (r.data && r.data.telechargements) || []; } catch { S.file = S.file || []; }
    if (L.route(location.hash).path !== '/nouveau') return;
    const q = $('#req-queue'); if (q) q.outerHTML = FileHtml(); else rerender();
    if (L.fileVivante(S.file)) S.fileT = setTimeout(() => { void chargerFile(); }, 2000);
  }
  const QBtn = (act, ic, label, id) => `<button class="btn btn-ghost btn-icon btn-mini f" aria-label="${esc(label)}" title="${esc(label)}" data-act="${act}" data-v="${esc(id)}">${I(ic)}</button>`;
  function FileHtml() {
    const l = S.file || [];
    if (!l.length) return '<section class="req-queue" id="req-queue" hidden></section>';
    return `<section class="req-queue" id="req-queue"><h2>${esc(t('En téléchargement'))}</h2><div class="req-q-list">${l.map((x) => {
      const f = L.ligneFile(x), ouvert = x.etat === 'en_cours' || x.etat === 'attente';
      const btns = ouvert ? QBtn('qpause', 'pause', t('Mettre en pause'), x.id) + QBtn('qcancel', 'stop', t('Annuler'), x.id)
        : x.etat === 'pause' ? QBtn('qresume', 'play', t('Reprendre'), x.id) + QBtn('qcancel', 'stop', t('Annuler'), x.id)
          : x.etat === 'a_part' ? `<button class="btn btn-small f" data-act="qaccept" data-v="${esc(x.id)}">${I('check')}${esc(t('Accepter'))}</button><button class="btn btn-small btn-danger f" data-act="qdrop" data-v="${esc(x.id)}">${I('trash')}${esc(t('Jeter'))}</button>`
            : QBtn('qremove', 'close', t('Retirer de la file'), x.id);
      return `<div class="req-q${x.etat === 'a_part' ? ' a-part' : ''}"><span class="req-ph small">${esc((f.titre || '?').slice(0, 1))}</span><div class="grow"><b>${esc(f.titre)}${f.ep ? `<small>${esc(` · ${f.ep}`)}</small>` : ''}</b><div class="progress-line"><i style="width:${f.pct}%"></i></div><small>${esc([t(f.etat), `${nombre(f.pct)} %`, f.reste ? t('reste {r}', { r: f.reste }) : '', x.etat === 'a_part' || x.etat === 'echec' ? x.texte : ''].filter(Boolean).join(' · '))}</small></div><div class="req-q-acts">${btns}</div></div>`;
    }).join('')}</div></section>`;
  }
  // La recherche du titre tapé (Request.js : 350 ms après la dernière lettre ; seule la dernière réponse compte).
  let reqT = 0, reqSeq = 0;
  function chercherReq(cle, q, kind) {
    clearTimeout(reqT);
    reqT = setTimeout(async () => {
      const my = ++reqSeq;
      let data = { source: false, items: [] };
      try { const r = await agir('sorties_chercher', { q, genre: GENRE[kind] }); if (r && r.data) data = r.data; } catch { /* le titre tel quel */ }
      if (my !== reqSeq || L.route(location.hash).path !== '/nouveau') return;
      S.req.res = { cle, data };
      const i = $('#reqq'), vise = !!i && D.activeElement === i, p = vise ? i.selectionStart : null; render(true);
      const j = $('#reqq'); if (j && vise) { j.focus({ preventScroll: true }); if (p != null) j.setSelectionRange(p, p); }
    }, 350);
  }
  V.request = () => {
    if (S.file === null) { S.file = undefined; void chargerFile(); }
    if (S.demandes === null) { S.demandes = undefined; agir('hnoss_demandes').then((r) => { S.demandes = (r.data && r.data.demandes) || []; rerender('#reqq'); }).catch(() => { S.demandes = []; }); }
    const q = S.req.q.trim(), kind = S.req.kind;
    const m = /^(.*?)\s*\((\d{4})\)$/.exec(q), titre = m ? m[1] : q, annee = m ? Number(m[2]) : 0;
    const cat = kind === 'movie' ? 'movie' : kind === 'anime' ? 'anime' : 'show', n = norm(titre);
    const dans = q.length >= 2 ? S.items.filter((i) => (cat === 'movie' ? i.category === 'movie' : i.category === 'show' || i.category === 'anime') && norm(i.title) === n) : [];
    const deja = q.length >= 2 ? (S.demandes || []).filter((d) => norm(d.titre) === n && (cat === 'movie') === (d.genre === 'film')) : [];
    const cleR = `${cat}|${q}`, rech = S.req.res && S.req.res.cle === cleR ? S.req.res.data : null;
    if (q.length >= 2 && !rech) chercherReq(cleR, q, cat);
    const etatDe = (title, year, inLibrary) => {
      const nn = norm(title), k = `req|${cat}|${nn}|${year || ''}`;
      const ici = inLibrary || (S.items.some((i) => (cat === 'movie' ? i.category === 'movie' : i.category === 'show' || i.category === 'anime') && norm(i.title) === nn) ? 'oui' : '');
      const dem = (S.demandes || []).find((d) => norm(d.titre) === nn && (cat === 'movie') === (d.genre === 'film') && (!year || !d.annee || d.annee === year));
      return { etat: ici ? 'venus' : dem ? 'requested' : S.pris.has(k) ? 'added' : S.busy.has(k) ? 'busy' : 'idle', note: dem ? dem.etat : '' };
    };
    // Avec la clé du grand catalogue : ses résultats (titre, année, résumé ; l'affiche est dessinée, aucune image
    // extérieure). Sans clé : le titre tapé, tel quel.
    const res = q.length < 2 ? [] : rech && rech.source ? (rech.items || []).map((x, i) => ({ id: String(i), title: x.title, year: x.year, overview: x.overview, kind: cat, ...etatDe(x.title, x.year, x.inLibrary) }))
      : rech ? [{ id: 'q', title: titre, year: annee || undefined, kind: cat, ...etatDe(titre, annee) }] : [];
    const note = !q ? t('Cherchez un titre pour l’ajouter.') : q.length < 2 ? t('Tapez au moins deux lettres.') : !rech ? t('Recherche…')
      : rech.source ? (res.length ? tn(res.length, '{n} résultat', '{n} résultats') : t('Aucun résultat.'))
        : dans.length ? t('Déjà dans Venus') : deja.length ? t('Déjà demandé') : t('Un clic sur « Ajouter » : il est cherché dans tes sources, téléchargé par Comète et rangé dans Venus.');
    return `<main class="with-nav page-in"><div class="page req-page"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(t('Nouveau'))}</h1><p class="muted">${esc(t('Ajoutez un titre : il se télécharge tout seul et arrive dans Venus.'))}</p></div></div>
    <div class="req-bar"><div class="search-box">${I('search')}<input id="reqq" class="input" type="search" placeholder="${esc(t('Titre d’un film, d’une série ou d’un animé…'))}" autocomplete="off" aria-label="${esc(t('Rechercher un titre à ajouter'))}" enterkeyhint="search" value="${esc(S.req.q)}"></div>
    <div class="seg" role="radiogroup" aria-label="${esc(t('Type'))}">${RKINDS.map(([k, l, ic]) => `<button class="seg-b f${k === kind ? ' on' : ''}" role="radio" aria-checked="${k === kind}" data-act="reqkind" data-v="${k}">${I(ic)}${esc(t(l))}</button>`).join('')}</div></div>
    ${FileHtml()}
    <p class="muted req-note" aria-live="polite">${esc(note)}</p>
    <div class="req-grid">${res.map((r) => `<article class="req-card"><div class="req-pic"><span class="req-ph up-ph" style="--h:${hueOf(r.title)}">${esc(r.title.slice(0, 1))}</span></div><div class="req-body"><b class="req-title">${esc(r.title)}</b><small>${esc([r.year, kindLabel({ category: r.kind })].filter(Boolean).join(' · '))}</small>${r.overview ? `<p>${esc(r.overview)}</p>` : ''}
      ${r.etat === 'venus' ? `<span class="req-state ok">${I('check')}${esc(t('Déjà dans Venus'))}</span>` : r.etat === 'requested' ? `<span class="req-state">${I('check')}${esc(t('Déjà demandé'))}${r.note ? ` · ${esc(r.note)}` : ''}</span>`
        : `<button class="btn btn-small btn-play f${r.etat === 'added' ? ' done' : ''}"${r.etat !== 'idle' ? ' disabled' : ''} data-act="reqadd" data-v="${r.id}">${I(r.etat === 'busy' ? 'refresh' : r.etat === 'idle' ? 'download' : 'check')}${esc(r.etat === 'busy' ? t('Ajout…') : r.etat === 'added' ? t('Ajouté') : t('Ajouter'))}</button>`}</div></article>`).join('')}</div></div></main>`;
  };

  // Nouveautés (Nouveautes.js)
  const NKINDS = [['movie', 'Films'], ['show', 'Séries'], ['anime', 'Animés']];
  async function chargerNouveautes(kind) {
    S.nouv[kind] = { chargement: true };
    try { const r = await agir('sorties_nouveautes', { genre: GENRE[kind] }); if (r.ok === false) throw new Error(premiere(r)); S.nouv[kind] = { data: r.data }; for (const s of r.data.sections || []) for (const x of s.items) if (x.wanted) S.favs.add(x.key); }
    catch (err) { S.nouv[kind] = { erreur: String(err.message || err) }; }
    rerender();
  }
  V.nouveautes = () => {
    const kind = S.newKind, st = S.nouv[kind];
    const head = `<div class="new-head"><h1 tabindex="-1">${esc(t('Nouveautés'))}</h1><div class="chips new-tabs" role="tablist">${NKINDS.map(([k, l]) => `<button class="chip f${k === kind ? ' on' : ''}" role="tab" aria-selected="${k === kind}" data-act="newkind" data-v="${k}">${esc(t(l))}</button>`).join('')}</div>${st && st.data && st.data.source ? `<span class="auto-pill"><span class="dot"></span>${esc(t('Hnoss actif : demandez un titre, il se télécharge tout seul'))}</span>` : ''}</div>`;
    if (!st || st.chargement) { if (!st) void chargerNouveautes(kind); return `<main class="with-nav new-page page-in">${head}<div class="page" aria-busy="true"><i class="sk" style="width:220px;height:48px"></i></div></main>`; }
    if (st.erreur) return `<main class="with-nav new-page page-in">${head}<div class="empty"><h2>${esc(t('Rien pour le moment'))}</h2><p>${esc(st.erreur)}</p></div></main>`;
    const d = st.data, sections = (d.sections || []).filter((s) => s.items.length);
    if (!sections.length) return `<main class="with-nav new-page page-in">${head}<div class="rows new-rows"><div class="empty"><h2>${esc(d.source ? t('Rien pour le moment') : t('Nouveautés indisponibles'))}</h2><p>${esc(d.source ? t('Les sites de référence ne répondent pas pour l’instant. Réessayez dans un moment.') : t(d.texte))}</p>${!d.source && S.profile.isAdmin ? `<button class="btn btn-play f" data-act="godemandes">${esc(t('Ouvrir les réglages'))}</button>` : ''}</div></div></main>`;
    const all = sections.flatMap((s) => s.items), x = all.find((y) => y.key === S.newCur[kind]) || all[0];
    const when = x.date ? (Date.parse(x.date) > Date.now() ? t('Sortie le {d}', { d: fmtJour(x.date) }) : fmtJour(x.date)) : '';
    const k = `nv|${x.key}`, pris = S.pris.has(k), busy = S.busy.has(k), on = S.favs.has(x.key), ix = reg(x);
    const wish = `<button class="btn btn-ghost btn-icon f wish-btn${on ? ' is-on' : ''}" aria-pressed="${on}" aria-label="${esc(on ? t('Retirer de mes envies') : t('Ajouter à mes envies'))}" title="${esc(on ? t('Dans mes envies') : t('Ajouter à mes envies : demandé à Hnoss dès maintenant, téléchargé dès sa sortie'))}" data-act="fav" data-i="${ix}">${I('heart')}</button>`;
    const actions = x.inLibrary ? `<div class="actions"><a class="btn btn-play f" href="${href(`/titre/${encodeURIComponent(x.inLibrary)}`)}">${I('play')}${esc(t('Dans Venus : voir la fiche'))}</a></div>`
      : pris ? `<div class="actions"><span class="sp-state st-processing">${I('check')}${esc(t('Demandé, recherche en cours'))}</span>${wish}</div>`
        : `<div class="actions"><button class="btn btn-play f"${busy ? ' disabled' : ''} data-act="newreq" data-i="${ix}">${I('add')}${esc(busy ? t('Demande envoyée…') : t('Demander'))}</button>${wish}</div>`;
    const spot = `<section class="spotlight"><div class="sp-bg"><div class="sp-layer on"><div class="ph" style="--h:${hueOf(x.title)}"></div></div></div><div class="sp-body swap"><div class="sp-kicker">${x.inLibrary ? `<span class="sp-in">${I('check')}${esc(t('Dans Venus'))}</span>` : ''}${x.anime ? `<span>${esc(t('Animé'))}</span>` : ''}${when ? `<span>${esc(when)}</span>` : ''}${x.next ? `<span>${esc(t('Épisode {n} le {d}', { n: nombre(x.next.episode), d: date(x.next.at, { day: 'numeric', month: 'long' }) }))}</span>` : ''}</div>
      <h1 class="hero-title sp-title">${esc(x.title)}</h1>${x.original && x.original !== x.title ? `<p class="sp-orig">${esc(x.original)}</p>` : ''}
      ${x.score ? `<div class="ratings"><span class="rating r-tmdb"><span class="r-src">${esc(t('Note'))}</span><b>${esc(x.anime ? `${x.score} %` : new Intl.NumberFormat(LANG, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(x.score / 10))}</b>${x.anime ? '' : '<small>/10</small>'}</span></div>` : ''}
      ${x.overview ? `<p class="hero-overview">${esc(x.overview)}</p>` : ''}${actions}</div></section>`;
    const rows = sections.map((s) => `<section class="row"><div class="row-head"><h2>${esc(t(s.title))}</h2></div>${ScrollRow(s.items.map((y) => `<button class="card poster dcard f" aria-label="${esc(`${y.title}${y.inLibrary ? `, ${t('dans Venus')}` : ''}`)}" data-act="newpick" data-v="${esc(y.key)}" data-k="${kind}"><div class="shot"><div class="ph" style="--h:${hueOf(y.title)}">${esc(y.title)}</div>${y.inLibrary ? `<span class="dc-in" title="${esc(t('Déjà dans Venus'))}">${I('check')}</span>` : ''}${y.score ? `<span class="dc-score">${esc(y.anime ? `${y.score} %` : `★ ${new Intl.NumberFormat(LANG, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(y.score / 10)}`)}</span>` : ''}</div><div class="cap"><b>${esc(y.title)}</b><small>${esc(y.date ? (Date.parse(y.date) > Date.now() ? t('Le {d}', { d: fmtJour(y.date, false) }) : y.date.slice(0, 4)) : '')}</small></div></button>`).join(''))}</section>`).join('');
    return `<main class="with-nav new-page page-in">${head}${spot}<div class="rows new-rows">${rows}</div></main>`;
  };

  // Réglages → Demandes (SettingsAdmin.js : boîtes « Sirius, Pléiades », « Comète », Hnoss ; sources et catalogue ajoutés)
  const Field = (label, inner, hint = '') => { const id = (/\bid="([^"]+)"/.exec(inner) || [])[1]; return `<div class="field"><label${id ? ` for="${id}"` : ''}>${esc(label)}</label>${inner}${hint ? `<small>${esc(hint)}</small>` : ''}</div>`; };
  const Select = (id, opts, v) => `<select class="input f" id="${id}">${opts.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const Switch = (id, label, on, hint = '') => `<label class="switch"><span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span><input type="checkbox" class="f" id="${id}"${on ? ' checked' : ''}></label>`;
  /** La valeur d'un champ des réglages (case cochée ou texte), lue au moment du clic. */
  const champ = (id) => { const e = $(`#${id}`); return e ? (e.type === 'checkbox' ? !!e.checked : String(e.value ?? '')) : undefined; };
  async function chargerDemandes() {
    const sur = (p) => p.then((r) => r.data || {}).catch(() => ({}));
    const [acq, src, cat, hn, dem, dos] = await Promise.all([sur(agir('acquisition')), sur(agir('delta_sources')), sur(agir('catalogue_etat')), sur(agir('hnoss_reglages')), sur(agir('hnoss_demandes')), api('/venus/dossiers').catch(() => ({ dossiers: [] }))]);
    S.dem = { sirius: acq.sirius || {}, pleiades: acq.pleiades || {}, comete: acq.comete || {}, partage: acq.partage || {}, sources: src.sources || [], catalogue: cat.reglages || {}, libres: hn.libres || [], membres: hn.membres || [], demandes: dem.demandes || [], dossiers: dos.dossiers || [] };
    rerender();
  }
  // Le partage de fichiers de Comète : envoi aux autres limité, coupé à la fin ; aucune écoute entrante par défaut.
  const partageForm = (p) => `<h3 class="box-sub">${esc(t('Partage de fichiers'))}</h3><p class="muted">${esc(t('Liens magnet et fichiers .torrent, téléchargés par Odin lui-même : seule la vidéo voulue est gardée, chaque morceau est vérifié. L’envoi aux autres s’arrête dès que le fichier est fini.'))}</p>${Field(t('Pairs à la fois'), `<input class="input f" id="p-pairs" type="number" min="1" max="50" value="${esc(p.maxPairs || 30)}">`)}${Switch('p-envoi', t('Envoyer aux autres pendant le téléchargement'), p.envoiPendant !== false)}${Field(t('Envoi maximum (Ko/s)'), `<input class="input f" id="p-ko" type="number" min="0" max="100000" value="${esc(p.envoiKo ?? 100)}">`)}${Field(t('Ratio maximum (0 = libre)'), `<input class="input f" id="p-ratio" type="number" min="0" max="10" step="0.1" value="${esc(p.ratio ?? 1)}">`)}${Field(t('Durée maximum de l’envoi (minutes, 0 = le temps du téléchargement)'), `<input class="input f" id="p-duree" type="number" min="0" max="10080" value="${esc(p.dureeMin || 0)}">`)}${Switch('p-dht', t('Chercher aussi dans le DHT'), p.dht !== false)}${Switch('p-ecoute', t('Écoute entrante'), !!p.ecoute, t('Par défaut, Odin ne fait que des connexions sortantes. Avec l’écoute, ouvre toi-même ce port sur ta box : Odin ne l’ouvre jamais.'))}${Field(t('Port d’écoute (1024 à 65535)'), `<input class="input f" id="p-port" type="number" min="1024" max="65535" value="${esc(p.portEcoute || '')}">`)}`;
  BOX.demandes = () => {
    if (S.dem === null) { S.dem = undefined; void chargerDemandes(); }
    if (!S.dem) return `<section class="box"><p class="muted">${esc(t('Chargement…'))}</p></section>`;
    const D_ = S.dem, QUAL = [['toutes', t('Toutes les qualités')], ['720p', '720p'], ['1080p', t('1080p, VF de préférence')], ['2160p', t('4K si possible')]];
    const dos = (cat) => [['', t('Premier dossier déclaré')], ...D_.dossiers.filter((x) => x.categorie === cat).map((x) => [x.chemin, x.chemin])];
    const one = (id, name, role, dirLabel, cat, anime) => { const r = D_[id] || {}; return `<div class="arr-one"><h3 class="box-sub">${esc(name)}<small class="muted"> — ${esc(t(role))}</small></h3><div class="arr-picks"><small class="ok-text">${esc(t('{a} intégré à Venus (dans Odin)', { a: name }))}</small><div class="two-cols wide">${Field(t('Profil de qualité'), Select(`q-${id}`, QUAL, r.qualite || '1080p'))}${Field(t(dirLabel), Select(`d-${id}`, dos(cat), r.dossier || ''))}</div>${anime ? Field(t('Dossier des animés'), Select(`da-${id}`, [['', t('Même dossier que les séries')], ...dos('series').slice(1)], r.dossierAnimes || '')) : ''}${Field(t('Langue'), Select(`l-${id}`, [['vf', t('VF de préférence')], ['toutes', t('Toutes les langues')]], r.langue || 'vf'))}${Actions(`<button class="btn btn-small btn-play f" data-act="suivisave" data-v="${id}">${esc(t('Enregistrer'))}</button>`)}</div></div>`; };
    const arr = `<section class="box" id="arr"><h2>${esc(t('Sirius et Pléiades'))}</h2><p>${esc(t('Sirius (films) et Pléiades (séries et animés) sont dans Venus : dans « Nouveau » et « À venir », un clic envoie le titre au bon applicatif, qui le fait télécharger par Comète. Venus l’ajoute dès que le fichier arrive dans vos dossiers.'))}</p>${one('sirius', 'Sirius', 'films', 'Dossier des films', 'films')}${one('pleiades', 'Pléiades', 'séries et animés', 'Dossier des séries', 'series', true)}</section>`;
    const c = D_.comete || {};
    const comete = `<section class="box" id="comete"><h2>${esc(t('Comète : téléchargements'))}</h2><p>${esc(t('Le moteur de téléchargement de Venus : file d’attente, reprise après une coupure, vérification de chaque fichier (antivirus) avant de le ranger.'))}</p>${Field(t('Téléchargements en même temps'), Select('c-sim', [1, 2, 3, 4].map((n) => [n, String(n)]), c.simultanes || 2))}${Field(t('Taille maximale d’un fichier (Go)'), `<input class="input f" id="c-taille" type="number" min="1" max="500" value="${esc(c.tailleMaxGo || 60)}">`)}${Field(t('Débit maximum (Mo/s, 0 = libre)'), `<input class="input f" id="c-debit" type="number" min="0" max="10000" value="${esc(c.debitMo || 0)}">`)}${partageForm(D_.partage || {})}${Actions(`<button class="btn btn-small btn-play f" data-act="cometesave">${esc(t('Enregistrer'))}</button><a class="btn btn-small f" href="${href('/nouveau')}">${I('download')}${esc(t('Voir la file'))}</a>`)}</section>`;
    const sources = `<section class="box" id="sources"><h2>${esc(t('Sources de téléchargement (Delta)'))}</h2><p>${esc(t('Odin n’en fournit aucune : ajoutez seulement des sources que vous avez le droit d’utiliser (format de recherche standard des indexeurs). La clé est gardée chiffrée et n’est plus jamais montrée.'))}</p>
      ${D_.sources.length ? D_.sources.map((x) => `<div class="list-row"><span class="dot${x.actif ? '' : ' off'}" title="${esc(x.actif ? t('Active') : t('Inactive'))}"></span><div class="grow"><b>${esc(x.nom)}</b><small class="muted">${esc([x.type, t('priorité {n}', { n: nombre(x.priorite) }), tn(x.recherches || 0, '{n} recherche', '{n} recherches'), x.aCle ? t('clé gardée') : '', x.derniereErreur || ''].filter(Boolean).join(' · '))}</small></div><button class="btn btn-small f" data-act="srctest" data-v="${esc(x.id)}">${esc(t('Tester'))}</button><button class="btn btn-small btn-danger f" data-act="srcdel" data-v="${esc(x.id)}" aria-label="${esc(t('Retirer {s}', { s: x.nom }))}">${esc(t('Retirer'))}</button></div>`).join('') : `<p class="muted">${esc(t('Aucune source pour l’instant.'))}</p>`}
      <h3 class="box-sub">${esc(t('Ajouter une source'))}</h3><div class="two-cols wide">${Field(t('Nom'), '<input class="input f" id="s-nom" autocomplete="off" maxlength="60">')}${Field(t('Format'), Select('s-type', [['torznab', t('Recherche de torrents (format standard)')], ['newznab', t('Recherche Usenet (format standard)')]], 'torznab'))}</div>${Field(t('Adresse de l’API'), '<input class="input f" id="s-adr" type="url" placeholder="https://…/api" autocomplete="off">')}${Field(t('Clé (facultative)'), '<input class="input f" id="s-cle" type="password" autocomplete="new-password" value="">', t('Gardée chiffrée sur la machine d’Odin, jamais dans la base ni à l’écran.'))}${Actions(`<button class="btn btn-small btn-play f" data-act="srcadd">${I('plus')}${esc(t('Ajouter la source'))}</button>`)}</section>`;
    const k = D_.catalogue || {};
    const catalogue = `<section class="box" id="catalogue"><h2>${esc(t('Sorties à venir et nouveautés'))}</h2><p>${esc(t('D’où viennent les sorties de « À venir » et les Nouveautés, comme dans Venus. Par défaut, seul le catalogue public des films (sans clé) est lu ; « Aucun » pour ne rien lire. Avec la clé, « Nouveau » cherche aussi le titre tapé dans le grand catalogue.'))}</p>${Switch('cat-series', t('Programme télé des séries (public, sans clé)'), k.series)}${Switch('cat-animes', t('Programme de diffusion des animés (public, sans clé)'), k.animes)}${Field(t('Films'), Select('cat-films', [['aucun', t('Aucun')], ['public', t('Catalogue public des films (sans clé)')], ['cle', t('Grand catalogue des films et séries (avec votre clé gratuite)')]], k.films || 'public'))}${Field(t('Clé du grand catalogue'), '<input class="input f" id="cat-cle" type="password" autocomplete="new-password" value="">', k.aCle ? t('Une clé est gardée (chiffrée). Laissez vide pour la garder.') : t('Sert aussi aux Nouveautés des films et des séries. Gardée chiffrée, jamais montrée.'))}${Actions(`<button class="btn btn-small btn-play f" data-act="catsave">${esc(t('Enregistrer'))}</button>${k.aCle ? `<button class="btn btn-small btn-ghost f" data-act="catforget">${esc(t('Oublier la clé'))}</button>` : ''}`)}</section>`;
    const avalider = D_.demandes.filter((x) => x.etat === 'à valider');
    const hnoss = `<section class="box" id="hnoss"><h2>${esc(t('Hnoss : téléchargements automatiques'))}</h2><p>${esc(t('Hnoss est dans Venus. Les titres ajoutés à « Mes envies » (♡ dans À venir et Nouveautés) sont demandés tout de suite, même s’ils ne sortent que dans plusieurs mois.'))}</p><div class="auto-pill" style="margin-bottom:12px"><span class="dot"></span>${esc(t('Actif dans Venus'))}</div>
      <h3 class="box-sub">${esc(t('Demandes au nom de chacun'))}</h3><p class="muted" style="font-size:.88rem;margin:0 0 10px">${esc(t('Chaque profil fait ses demandes à son nom. Choisissez les membres dont les demandes partent tout de suite ; les autres attendent votre validation. Aucun membre ne règle les sources ni n’accepte un fichier mis à part.'))}</p>
      ${D_.membres.length ? D_.membres.map((p) => Field(p.nom, `<select class="input f" data-act="hlibre" data-v="${esc(p.login)}" aria-label="${esc(t('Demandes de {n}', { n: p.nom }))}"><option value="valider"${D_.libres.includes(p.login) ? '' : ' selected'}>${esc(t('Demandes validées par moi'))}</option><option value="libre"${D_.libres.includes(p.login) ? ' selected' : ''}>${esc(t('Demandes libres (sans validation)'))}</option></select>`)).join('') : `<p class="muted">${esc(t('Aucun membre de la famille pour l’instant.'))}</p>`}
      <h3 class="box-sub">${esc(t('À valider'))}</h3>${avalider.length ? avalider.map((x) => `<div class="list-row"><div class="grow"><b>${esc(x.titre)}${x.annee ? ` (${esc(x.annee)})` : ''}</b><small class="muted">${esc([x.genre === 'film' ? t('Film') : t('Série'), x.saisons && x.saisons.length ? t('saison(s) {s}', { s: x.saisons.join(', ') }) : '', t('demandé par {n}', { n: (x.qui && (x.qui.nom || x.qui.login)) || '' })].filter(Boolean).join(' · '))}</small></div><button class="btn btn-small btn-play f" data-act="hvalider" data-v="${esc(x.id)}">${I('check')}${esc(t('Valider'))}</button><button class="btn btn-small btn-ghost f" data-act="hrefuser" data-v="${esc(x.id)}">${esc(t('Refuser'))}</button></div>`).join('') : `<p class="muted">${esc(t('Aucune demande à valider.'))}</p>`}</section>`;
    return arr + comete + sources + catalogue + hnoss;
  };

  // Une section de Venus pas encore construite dans Odin : la place est gardée, et l'écran le dit.
  V.bientot = (path) => { const it = NAV_ITEMS.find((x) => x.href === path); return `<main class="with-nav page-in"><div class="page"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(it ? val(it.label) : 'Venus')}</h1></div></div>${Empty(t('Cette partie de Venus arrive dans Odin avec un prochain lot.'), `<a class="btn btn-ghost btn-small f" href="${href('/')}">${esc(t('Accueil'))}</a>`)}</div></main>`; };

  // ---------------------------------------------------------------- la maison (écrans, lot V8)
  // Tonight.js (« Ce soir », « Qui regarde ce soir ? »), Vote.js, Stats.js, Recap.js, Downloads.js et Collections.js du
  // dépôt Venus, réécrits sans React. Les chiffres et les listes viennent d'Odin (/venus/api/…) : rien n'est inventé.
  const M8 = { ts: { step: 0, answers: {}, picks: null, shown: new Set() }, tg: { sel: null, kind: 'movie', res: null, cle: '' }, vote: null, voteT: 0,
    vt: { code: '', st: null, msg: '', mine: null, T: 0 }, stats: {}, recap: { i: 0, held: false, T: 0, an: 0, n: 0, reduce: false, reste: 7000, fin: 0 },
    coll: undefined, collTab: 'collections', col: {}, pl: {}, nomFaire: null, confFaire: null, addItem: null,
    dl: { list: undefined, T: 0, vu: '' }, se: { code: '', msg: '', tente: '' }, rc: { ecrans: undefined, msg: '', choisi: '' } };
  // Rien n'est gardé dans le navigateur (règle de Vénus dans Odin) : l'appareil qui vote a un identifiant tiré au
  // chargement de la page, et les personnes cochées dans « Qui regarde ce soir ? » vivent le temps de la page.
  const CLIENT_VOTE = Array.from({ length: 2 }, () => Math.random().toString(36).slice(2)).join('');
  const voteClient = () => CLIENT_VOTE;
  const salutation = () => { const hr = new Date().getHours(); return hr >= 18 || hr < 4 ? t('Bonsoir') : t('Bonjour'); };
  const ph = (title) => `<div class="ph" style="--h:${hueOf(title)}"><span>${esc(title)}</span></div>`;
  const forme = (n, un, plusieurs) => t(plur.select(n) === 'one' ? un : plusieurs);
  // Un poids ne se coupe jamais en fin de ligne (« 1,4 » d'un côté, « Go » de l'autre) : espaces insécables.
  const taille = (b) => (!b ? '' : (b >= 1e9 ? t('{n} Go', { n: new Intl.NumberFormat(LANG, { maximumFractionDigits: 1 }).format(b / 1e9) }) : t('{n} Mo', { n: nombre(Math.round(b / 1e6)) })).replace(/ /g, ' '));
  // Rejoue la page en gardant le focus sur le même bouton (une réponse arrivée pendant qu'on tape au clavier).
  const refaire = () => { const a = D.activeElement, k = a && a.dataset && a.dataset.act ? (a.dataset.v != null ? sel(a.dataset.act, a.dataset.v) : `[data-act="${a.dataset.act}"]`) : a && a.id ? `#${a.id}` : null; rerender(k); };
  const siSur = (test) => { const p = L.route(location.hash).path; if (typeof test === 'string' ? p === test : test.test(p)) refaire(); };
  const playItem = (i) => { if (!i) return; if (i.type === 'show' && !i.play) { go(titrePath(i)); return; } go(lirePath(i.play ? i.play.id : i.id)); };

  // « Ce soir » (Tonight.js)
  V.tonight = () => {
    const soir = dayPart() === 'soir', st = M8.ts, TM = TIMES(soir);
    const steps = [['mood', soir ? t('Quelle envie ce soir ?') : t('Quelle envie aujourd’hui ?'), MOODS], ['time', t('Combien de temps devant vous ?'), TM], ['who', t('Avec qui ?'), WHO]];
    let body;
    if (st.picks) {
      const a = st.answers, picks = st.picks, low = (x) => x.toLocaleLowerCase(LANG);
      const head = `${t(MOODS.find((m) => m[0] === a.mood)[1])}, ${low(t(TM.find((x) => x[0] === a.time)[1]))}, ${low(t(WHO.find((w) => w[0] === a.who)[1]))}`;
      const sansAge = a.who === 'famille' && !S.items.some((i) => i.age != null);
      body = `<div class="tonight-head">${I('moon')}<span>${esc(head)}</span></div><h1 class="tonight-q" tabindex="-1">${esc(picks.length ? (soir ? t('Voici nos idées pour ce soir') : t('Voici nos idées pour aujourd’hui')) : t('Rien ne correspond… pour l’instant'))}</h1>
      ${picks.length ? `<div class="picks">${picks.map(({ item, reasons }, i) => `<article class="pick" style="animation-delay:${i * 90}ms"><div class="pick-img">${item.backdrop || item.poster ? `<img src="${esc(item.backdrop || item.poster)}" alt="" class="fade ok" loading="lazy" decoding="async">` : ph(item.title)}<span class="pick-rank">${esc(i === 0 ? t('Notre choix') : t('Idée {n}', { n: nombre(i + 1) }))}</span></div><div class="pick-body"><h2>${esc(item.title)}</h2><div class="pick-reasons">${reasons.map((r) => `<span>${esc(r)}</span>`).join('')}</div><div class="actions"><button class="btn btn-play f" data-act="tplay" data-v="${esc(item.id)}">${I('play')}${esc(item.status === 'progress' ? t('Reprendre') : t('Lecture'))}</button><a class="btn btn-ghost f" href="${href(titrePath(item))}">${esc(t('Plus d’infos'))}</a></div></div></article>`).join('')}</div>`
        : `<p class="grid-empty">${esc(sansAge ? t('Odin ne connaît pas encore l’âge permis des titres : rien n’est proposé « en famille ».') : t('Essayez une autre envie ou plus de temps : votre bibliothèque n’a rien qui colle à ces trois critères.'))}</p>`}
      <div class="actions tonight-actions">${picks.length ? `<button class="btn f" data-act="tmore">${I('shuffle')}${esc(t('Trois autres idées'))}</button>` : ''}${picks.length >= 2 ? `<button class="btn btn-ghost f" data-act="tvote">${I('people')}${esc(t('Voter en famille'))}</button>` : ''}<button class="btn btn-ghost f" data-act="treset">${esc(t('Recommencer'))}</button></div>`;
    } else {
      const [key, question, opts] = steps[st.step];
      body = `<div class="tonight-head">${I(todayIcon())}<span>${esc(`${salutation()} ${S.profile.name}`)}</span></div><div class="steps-dots" role="img" aria-label="${esc(t('Question {n} sur 3', { n: nombre(st.step + 1) }))}">${steps.map((_, i) => `<span class="${i <= st.step ? 'on' : ''}"></span>`).join('')}</div>
      <h1 class="tonight-q" tabindex="-1">${esc(question)}</h1><div class="choice-grid">${opts.map(([id, label, sub]) => `<button class="choice f" data-act="tanswer" data-k="${key}" data-v="${id}"><b>${esc(t(label))}</b><small>${esc(t(sub))}</small></button>`).join('')}</div>
      ${st.step > 0 ? `<button class="row-link f" data-act="tprev">${I('back')}${esc(t('Question précédente'))}</button>` : ''}`;
    }
    return `<main class="with-nav page-in"><div class="page tonight-page maison"><div class="tonight">${body}</div>${Together()}</div></main>`;
  };
  // « Qui regarde ce soir ? » (Together de Tonight.js) : seulement avec au moins deux profils.
  function Together() {
    const ps = S.profils, tg = M8.tg; if (ps.length < 2) return '';
    if (!tg.sel) tg.sel = [S.profile.id];
    const cle = `${tg.sel.join(',')}|${tg.kind}`;
    if (tg.sel.length && tg.cle !== cle) {
      tg.cle = cle; tg.res = null;
      api(`/venus/api/ensemble?profils=${encodeURIComponent(tg.sel.join(','))}&kind=${tg.kind}`).then((r) => { if (tg.cle === cle) tg.res = r; }).catch(() => { if (tg.cle === cle) tg.res = { results: [], erreur: true }; }).then(() => { if (tg.cle === cle) siSur('/cesoir'); });
    }
    const r = tg.res;
    const body = !tg.sel.length ? `<p class="grid-empty">${esc(t('Choisissez au moins une personne.'))}</p>`
      : !r ? `<p class="muted">${esc(t('Recherche…'))}</p>`
        : r.erreur ? `<p class="grid-empty">${esc(t('Impossible pour le moment.'))}</p>`
          : r.kidsSansAge ? `<p class="grid-empty">${esc(t('Un enfant est présent : Odin ne connaît pas encore l’âge permis des titres, rien n’est proposé.'))}</p>`
            : !r.results.length ? `<p class="grid-empty">${esc(t('Rien que tout ce monde n’ait pas déjà vu : essayez les séries, ou retirez quelqu’un.'))}</p>`
              : `<div class="together-grid">${r.results.slice(0, 12).map(({ item, why }, i) => `<article class="together-card" style="animation-delay:${i * 40}ms"><a class="together-pic f" href="${href(titrePath(item))}" aria-label="${esc(item.title)}">${item.poster ? `<img src="${esc(item.poster)}" alt="" loading="lazy" decoding="async">` : ph(item.title)}</a><div class="together-txt"><b>${esc(item.title)}</b><small>${esc([item.year, item.runtime ? t('{n} min', { n: nombre(item.runtime) }) : null].filter(Boolean).join(' · '))}</small>${why.length ? `<div class="pick-reasons">${why.map((w) => `<span>${esc(w)}</span>`).join('')}</div>` : ''}<button class="btn btn-small btn-play f" data-act="tgplay" data-v="${esc(item.id)}">${I('play')}${esc(t('Lecture'))}</button></div></article>`).join('')}</div>`;
    return `<section class="together" aria-label="${esc(t('Film pour tout le monde'))}"><h2 class="section-title">${esc(t('Qui regarde ce soir ?'))}</h2><p class="muted">${esc(t('Cochez les personnes présentes : Venus propose ce que personne n’a vu, permis au plus jeune, et qui plaît à chacun.'))}</p>
    <div class="together-who" role="group" aria-label="${esc(t('Personnes présentes'))}">${ps.map((p) => { const on = tg.sel.includes(p.id); return `<button class="together-p f${on ? ' on' : ''}" aria-pressed="${on}" data-act="tgwho" data-v="${esc(p.id)}">${Avatar(p, 'sm')}<span>${esc(p.name)}</span>${p.isKids ? `<small>${esc(t('enfant'))}</small>` : ''}</button>`; }).join('')}
    <div class="seg" role="radiogroup" aria-label="${esc(t('Type'))}">${[['movie', 'Films'], ['show', 'Séries']].map(([k, l]) => `<button class="seg-b f${tg.kind === k ? ' on' : ''}" role="radio" aria-checked="${tg.kind === k}" data-act="tgkind" data-v="${k}">${esc(t(l))}</button>`).join('')}</div></div>${body}</section>`;
  }

  // Vote en famille (Vote.js) : la fenêtre de l'écran principal, puis l'écran du téléphone (#/vote?code=ABCD).
  // Pas de flux d'événements dans Odin : l'état est relu toutes les 2 s tant que le vote est ouvert.
  function voteHostHtml(st) {
    const max = Math.max(1, ...st.items.map((i) => i.votes)), w = st.done ? st.items.find((i) => i.id === st.winner) : null;
    const qr = /^<svg[\s>]/.test(String(st.qr || '')) && !/<script|\son\w+=/i.test(st.qr) ? st.qr : ''; // le QR dessiné par Odin, rien d'autre
    return `<div class="vote-host"><div class="vote-join">${qr ? `<span role="img" aria-label="${esc(t('QR code du vote'))}">${qr}</span>` : ''}<div><p>${esc(t('Chacun scanne ce QR code avec son téléphone, ou ouvre Venus et tape le code :'))}</p><b class="big-code">${esc(st.code.split('').join(' '))}</b></div></div>
    <div class="vote-board">${st.items.map((i) => `<div class="vote-line${st.done && st.winner === i.id ? ' win' : ''}"><span class="vl-pic">${i.poster ? `<img src="${esc(i.poster)}" alt="">` : ''}</span><div class="vl-body"><b>${esc(i.title)}</b><div class="meter"><i style="width:${(i.votes / max) * 100}%"></i></div><small>${esc(i.voters.length ? i.voters.join(', ') : t('Pas encore de voix'))}</small></div><b class="vl-n">${esc(nombre(i.votes))}</b></div>`).join('')}</div>
    <div class="form-actions">${w ? `<button class="btn btn-play f" data-act="vlaunch" data-v="${esc(w.id)}">${I('play')}${esc(t('Lancer « {t} »', { t: w.title }))}</button>` : `<button class="btn btn-play f" data-act="vend">${I('play')}${esc(t('Voir le résultat'))}</button>`}</div></div>`;
  }
  function peindreVote() { const h = $('#vote-host'); if (!h) return false; const a = D.activeElement && D.activeElement.dataset ? D.activeElement.dataset.act : ''; h.innerHTML = voteHostHtml(M8.vote); if (a) { const b = h.querySelector(`[data-act="${a}"]`) || h.querySelector('.btn'); if (b) b.focus({ preventScroll: true }); } return true; }
  function suivreVote() {
    clearTimeout(M8.voteT);
    M8.voteT = setTimeout(async () => {
      if (!$('#vote-host') || !M8.vote || M8.vote.done) return;
      try { const r = await api(`/venus/api/vote/${encodeURIComponent(M8.vote.code)}`); M8.vote = { ...r, qr: M8.vote.qr }; } catch { return; }
      if (peindreVote()) suivreVote();
    }, 2000);
  }
  async function startVote(ids) {
    let v; try { v = await api('/venus/api/vote', { itemIds: ids }); } catch { toast(t('Impossible pour le moment.')); return; }
    M8.vote = v; openSheet(t('Vote en famille'), `<div id="vote-host">${voteHostHtml(v)}</div>`, { wide: true }); suivreVote();
    // La fenêtre s'ouvre par son haut (titre, QR et code) : au téléphone, le focus sur « Voir le résultat », tout en
    // bas, la ferait défiler. Le focus va sur la fenêtre elle-même, sans défilement.
    requestAnimationFrame(() => { const s = $('.sheet-wrap .sheet'); if (s) { s.focus({ preventScroll: true }); s.scrollTop = 0; } });
  }
  function suivreVoteTel() {
    const vt = M8.vt; clearTimeout(vt.T);
    vt.T = setTimeout(async () => {
      if (L.route(location.hash).path !== '/vote' || !vt.st || vt.st.done) return;
      try { vt.st = await api(`/venus/api/vote/${encodeURIComponent(vt.code)}`); } catch { /* garde l'état connu */ }
      siSur('/vote'); suivreVoteTel();
    }, 2000);
  }
  async function rejoindreVote(code) {
    const vt = M8.vt; vt.code = code; vt.st = null; vt.mine = null; vt.msg = '';
    if (!/^[A-Z0-9]{4}$/.test(code)) { vt.msg = t('Le code fait 4 lettres.'); siSur('/vote'); return; }
    try { vt.st = await api(`/venus/api/vote/${encodeURIComponent(code)}`); } catch (e) { vt.msg = String(e.message) === '404' ? t('Vote introuvable ou terminé.') : t('Impossible pour le moment.'); }
    siSur('/vote'); if (vt.st) { const h = $('main h1'); if (h) h.focus({ preventScroll: true }); suivreVoteTel(); } else { const i = $('#vote-code'); if (i) i.focus(); }
  }
  V.vote = (q) => {
    const vt = M8.vt, c = String(q.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c && c !== vt.code) void rejoindreVote(c);
    const top = `<div class="remote-top"><button class="p-icon f" aria-label="${esc(t('Retour'))}" data-act="vback">${I('back')}</button><b>${esc(t('Vote en famille'))}</b></div>`;
    let body;
    if (!vt.st) body = `<form class="remote-pair" data-form="vjoin">${I('people')}<h1 tabindex="-1">${esc(t('Rejoindre le vote'))}</h1><p>${esc(t('Tapez le code à 4 lettres affiché sur la TV.'))}</p><input id="vote-code" class="input code-input" maxlength="4" placeholder="ABCD" autocomplete="off" autocapitalize="characters" aria-label="${esc(t('Code du vote'))}" value="${esc(vt.code)}"><p class="error-text" role="alert">${esc(vt.msg)}</p><button class="btn btn-play f" type="submit">${esc(t('Rejoindre'))}</button></form>`;
    else if (vt.st.done) {
      const w = vt.st.items.find((i) => i.id === vt.st.winner) || vt.st.items[0];
      body = `<div class="vote-win">${w.backdrop || w.poster ? `<img src="${esc(w.backdrop || w.poster)}" alt="">` : ''}<div><small>${esc(t('Ce soir, ce sera'))}</small><h1 tabindex="-1">${esc(w.title)}</h1><p>${esc(t('{v} sur {n}', { v: tn(w.votes, '{n} voix', '{n} voix'), n: nombre(vt.st.voters) }))}</p><a class="btn f" href="${href(titrePath(w))}">${I('info')}${esc(t('Voir la fiche'))}</a></div></div>`;
    } else body = `<div class="vote-intro"><h1 tabindex="-1">${esc(vt.mine ? t('A voté !') : t('Que regarder ce soir ?'))}</h1><p>${esc(vt.mine ? t('Vous pouvez changer d’avis tant que le vote est ouvert.') : t('Proposé par {n}. Touchez votre choix.', { n: vt.st.host }))}</p></div><div class="vote-cards">${vt.st.items.map((i) => `<button class="vote-card f${vt.mine === i.id ? ' on' : ''}" aria-pressed="${vt.mine === i.id}" data-act="vpick" data-v="${esc(i.id)}"><span class="vc-pic">${i.poster ? `<img src="${esc(i.poster)}" alt="">` : ''}${vt.mine === i.id ? `<span class="vc-check">${I('check')}</span>` : ''}</span><span class="vc-body"><b>${esc(i.title)}</b><small>${esc([i.year, i.runtime ? t('{n} min', { n: nombre(i.runtime) }) : null].filter(Boolean).join(' · '))}</small><span class="vc-votes">${esc(tn(i.votes, '{n} voix', '{n} voix'))}</span></span></button>`).join('')}</div>`;
    return `<main><div class="vote-page">${top}${body}</div></main>`;
  };

  // Mes statistiques (Stats.js) et la rétrospective (Recap.js) : /venus/api/stats, le profil choisi seulement.
  const anneeDe = (q) => { const n = Number(q.get('annee')); return Number.isInteger(n) && n > 1970 && n <= new Date().getFullYear() + 1 ? n : new Date().getFullYear(); };
  function chargerStats(an) {
    const k = String(an); if (M8.stats[k] !== undefined) return; M8.stats[k] = null;
    api(`/venus/api/stats?annee=${an}`).then((d) => { M8.stats[k] = d; }).catch(() => { M8.stats[k] = { erreur: true }; }).then(() => siSur(/^\/(stats|retrospective)$/));
  }
  const Box = (title, inner) => `<section class="dash-box st-box"><div class="dash-title"><h2>${esc(title)}</h2></div>${inner}</section>`;
  function Columns(items, thin = false) {
    const max = Math.max(0.0001, ...items.map((x) => x.value)), peak = items.reduce((a, b) => (b.value > a.value ? b : a), items[0] || { value: 0 });
    return `<div class="st-cols${thin ? ' thin' : ''}" role="img" aria-label="${esc(items.map((x) => x.tip).join(', '))}">${items.map((x) => `<div class="st-col" title="${esc(x.tip)}"><span class="st-val">${x === peak && x.value ? esc(L.heures(x.value)) : ''}</span><i class="${x.value ? '' : 'zero'}" style="height:${x.value ? Math.max(4, Math.round((x.value / max) * 100)) : 2}%"></i><small>${esc(x.label)}</small></div>`).join('')}</div>`;
  }
  function Bars(items) {
    const max = Math.max(0.0001, ...items.map((x) => x.value));
    return `<div class="st-bars">${items.map((x) => `<div class="st-bar" title="${esc(t('{a} : {b}', { a: x.label, b: L.heures(x.value) }))}"><span>${esc(x.label)}</span><div class="meter"><i style="width:${Math.max(2, (x.value / max) * 100)}%"></i></div><b>${esc(L.heures(x.value))}</b></div>`).join('')}</div>`;
  }
  const Top = (title, list, sub) => Box(title, list && list.length ? `<div class="st-top">${list.map((x) => `<a class="st-top-row f" href="${href(`/titre/${encodeURIComponent(x.id)}`)}">${x.poster ? `<img src="${esc(x.poster)}" alt="" loading="lazy">` : '<span class="st-ph"></span>'}<b>${esc(x.title)}</b><span>${esc(sub(x))}</span></a>`).join('')}</div>` : `<p class="muted">${esc(t('Rien pour l’instant.'))}</p>`);
  function Calendrier(year, data) {
    const end = new Date(year, 11, 31), first = new Date(year, 0, 1); first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const lvl = L.niveaux(data), today = new Date(), cells = [], labels = [];
    for (let w = 0, dte = new Date(first); dte <= end; w++) {
      for (let k = 0; k < 7; k++, dte.setDate(dte.getDate() + 1)) {
        const key = `${dte.getFullYear()}-${pad2(dte.getMonth() + 1)}-${pad2(dte.getDate())}`, inYear = dte.getFullYear() === year, v = data[key] || 0;
        cells.push(`<i class="cal-c l${inYear && dte <= today ? lvl(v) : 'x'}" style="grid-column:${w + 1};grid-row:${k + 1}"${inYear ? ` title="${esc(t('{a} : {b}', { a: date(dte.getTime(), { weekday: 'long', day: 'numeric', month: 'long' }), b: v ? duree(v) : t('rien') }))}"` : ''}></i>`);
        if (inYear && dte.getDate() === 1) labels.push(`<small style="grid-column:${w + 1}">${esc(MOIS(dte.getMonth()))}</small>`);
      }
    }
    const active = Object.values(data).filter(Boolean).length, jl = tn(active, '{n} jour avec une lecture', '{n} jours avec une lecture');
    return `<section class="dash-box st-cal-box"><div class="dash-title"><h2>${esc(t('Jour par jour'))}</h2><span class="muted">${esc(jl)}</span></div><div class="st-cal-scroll" tabindex="0" aria-label="${esc(t('Calendrier {y} : {n}', { y: String(year), n: jl }))}"><div class="st-cal-months">${labels.join('')}</div><div class="st-cal" role="img" aria-label="${esc(t('Calendrier {y} : {n}', { y: String(year), n: jl }))}">${cells.join('')}</div></div><div class="st-cal-legend"><small>${esc(t('Moins'))}</small>${[0, 1, 2, 3, 4].map((l) => `<i class="cal-c l${l}"></i>`).join('')}<small>${esc(t('Plus'))}</small></div></section>`;
  }
  V.stats = (q) => {
    const year = anneeDe(q), d = M8.stats[String(year)];
    if (!d) { chargerStats(year); return PageLoading(); }
    if (d.erreur) return `<main class="with-nav page-in"><div class="page">${Empty(t('Impossible pour le moment.'))}</div></main>`;
    const years = d.years.length ? d.years : [year], fh = L.heures;
    const head = `<div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(t('Mes statistiques'))}</h1><p class="count">${esc(S.profile.name)}</p></div><a class="btn btn-small f" href="${href(`/retrospective?annee=${year}`)}">${esc(t('Ma rétrospective {y}', { y: String(year) }))}</a>${years.length > 1 ? `<div class="seg" role="radiogroup" aria-label="${esc(t('Année'))}">${years.slice(0, 5).map((y) => `<a class="seg-b f${y === year ? ' on' : ''}" role="radio" aria-checked="${y === year}" href="${href(`/stats?annee=${y}`)}">${y}</a>`).join('')}</div>` : ''}</div>
    <p class="list-hint">${esc(t('D’après la progression gardée par Odin : un titre revu compte une fois, au jour de sa dernière lecture.'))}</p>`;
    if (!d.totalHours && !d.movies && !d.episodes) return `<main class="with-nav page-in"><div class="page stats maison">${head}<div class="empty"><h2>${esc(t('Rien de regardé en {y} pour l’instant', { y: String(year) }))}</h2><p>${esc(t('Lancez un film ou un épisode : vos statistiques se rempliront toutes seules.'))}</p></div></div></main>`;
    const days = Math.floor(d.totalHours / 24);
    const story = [d.genres[0] ? [t('Genre préféré :'), d.genres[0].name] : null, d.topShows[0] && d.topShows[0].eps ? [t('Série la plus suivie :'), d.topShows[0].title] : null, d.topAnime[0] && d.topAnime[0].eps ? [t('Animé le plus suivi :'), d.topAnime[0].title] : null,
      d.bestMonth && d.bestMonth.hours ? [t('Plus gros mois :'), MOIS(d.bestMonth.m, 'long')] : null, d.person ? [t('Vous avez beaucoup vu'), d.person] : null].filter(Boolean).map(([a, b]) => `${esc(a)} <strong>${esc(b)}</strong>. `).join('');
    const Kpi = (v, label) => `<div class="st-kpi"><b>${esc(v)}</b><span>${esc(label)}</span></div>`;
    const showSub = (x) => [x.eps ? t('{n} ép.', { n: nombre(x.eps) }) : null, fh(x.hours)].filter(Boolean).join(' · ');
    const KIND = { movie: 'Films', show: 'Séries', anime: 'Animés', clip: 'Clips' };
    return `<main class="with-nav page-in"><div class="page stats maison">${head}
    <section class="st-hero"><div class="st-big"><b>${esc(fh(d.totalHours))}</b><span>${esc(t('regardées en {y}', { y: String(year) }) + (days >= 1 ? ` · ${tn(days, 'plus de {n} jour entier', 'plus de {n} jours entiers')}` : ''))}</span></div><p class="st-story">${story}</p>
    <div class="st-kpis">${Kpi(nombre(d.movies), forme(d.movies, 'film vu', 'films vus'))}${Kpi(nombre(d.episodes), forme(d.episodes, 'épisode vu', 'épisodes vus'))}${Kpi(nombre(d.days), t('jours avec une lecture'))}${Kpi(t('{n} j', { n: nombre(d.streak) }), t('plus longue série de jours'))}${Kpi(fh(d.allTimeHours), t('depuis le début'))}</div></section>
    ${Calendrier(year, d.calendar || {})}
    <div class="st-grid two">${Box(t('Mois par mois'), Columns(d.months.map((m) => ({ label: MOIS(m.m), value: m.hours, tip: t('{a} : {b}', { a: MOIS(m.m, 'long'), b: fh(m.hours) }) }))))}${Box(t('Films, séries, animés'), Bars((d.byKind || []).filter((k) => k.hours).map((k) => ({ label: t(KIND[k.kind]), value: k.hours }))))}
    ${Box(t('Jours de la semaine'), Columns((d.weekdays || []).map((w) => ({ label: JOURS(w.w), value: w.hours, tip: t('{a} : {b}', { a: JOURS(w.w, 'long'), b: fh(w.hours) }) }))))}${Box(t('Heures de la journée'), Columns((d.hoursOfDay || []).map((x) => ({ label: x.h % 6 === 0 ? t('{n} h', { n: nombre(x.h) }) : '', value: x.hours, tip: t('{a} : {b}', { a: t('{a} h – {b} h', { a: nombre(x.h), b: nombre(x.h + 1) }), b: fh(x.hours) }) })), true))}</div>
    <div class="st-grid">${Box(t('Genres'), d.genres.length ? Bars(d.genres.map((g) => ({ label: g.name, value: g.hours }))) : `<p class="muted">${esc(t('Pas encore assez de données.'))}</p>`)}${Top(t('Séries les plus regardées'), d.topShows, showSub)}${Top(t('Animés les plus regardés'), d.topAnime, showSub)}${Top(t('Derniers films vus'), d.lastMovies, (x) => date(x.at, { day: 'numeric', month: 'short' }))}</div></div></main>`;
  };
  // La rétrospective : une suite d'écrans ; à droite (ou →) on avance, à gauche on revient ; tout seul toutes les 7 s,
  // sauf doigt (ou souris) appuyé, dernier écran ou mouvement réduit.
  const SLIDE_MS = 7000;
  const hRc = (x) => (x >= 10 ? t('{n} h', { n: nombre(Math.round(x)) }) : x >= 1 ? t('{n} h', { n: nombre(Math.round(x * 10) / 10) }) : t('{n} min', { n: nombre(Math.max(1, Math.round(x * 60))) }));
  const Poster = (src, title) => (src ? `<img class="rc-poster" src="${esc(src)}" alt="${esc(title || '')}" loading="lazy">` : `<span class="rc-poster rc-ph">${esc((title || '?').slice(0, 1))}</span>`);
  function recapSlides(d, year, name) {
    const s = [], y = String(year);
    if (!d.totalHours && !d.movies && !d.episodes) return [{ k: 'empty', tone: 1, body: `<small>${esc(t('Votre année {y}', { y }))}</small><h2>${esc(t('Rien de regardé pour l’instant'))}</h2><p>${esc(t('Lancez un film ou un épisode : votre rétrospective se remplira toute seule.'))}</p>` }];
    const days = Math.floor(d.totalHours / 24), dj = tn(d.days, '{n} jour différent', '{n} jours différents');
    s.push({ k: 'intro', tone: 1, body: `<small>${esc(t('{n}, votre année {y}', { n: name, y }))}</small><h2 class="rc-big">${esc(hRc(d.totalHours))}</h2><p>${esc(days >= 1 ? t('devant l’écran, soit {a}, sur {b}.', { a: tn(days, '{n} jour entier', '{n} jours entiers'), b: dj }) : t('devant l’écran, sur {b}.', { b: dj }))}</p>` });
    if (d.movies) s.push({ k: 'movies', tone: 2, body: `<small>${esc(t('Films'))}</small><h2 class="rc-big">${esc(nombre(d.movies))}</h2><p>${esc(forme(d.movies, 'film vu jusqu’au bout.', 'films vus jusqu’au bout.'))}</p><div class="rc-row">${d.lastMovies.slice(0, 5).map((m) => Poster(m.poster, m.title)).join('')}</div>` });
    const top = d.topShows && d.topShows[0];
    if (d.episodes || top) s.push({ k: 'shows', tone: 3, body: `<small>${esc(t('Séries'))}</small><h2 class="rc-big">${esc(nombre(d.episodes))}</h2><p>${esc(forme(d.episodes, 'épisode regardé.', 'épisodes regardés.'))}</p>${top ? `<div class="rc-feature">${Poster(top.poster, top.title)}<div><b>${esc(top.title)}</b><span>${esc(t('votre série de l’année : {h}', { h: hRc(top.hours) }))}</span></div></div>` : ''}` });
    const ani = d.topAnime && d.topAnime[0];
    if (ani) s.push({ k: 'anime', tone: 4, body: `<small>${esc(t('Animés'))}</small><h2>${esc(ani.title)}</h2><p>${esc(ani.eps ? t('Votre animé de l’année : {h}, {e}.', { h: hRc(ani.hours), e: tn(ani.eps, '{n} épisode', '{n} épisodes') }) : t('Votre animé de l’année : {h}.', { h: hRc(ani.hours) }))}</p><div class="rc-row">${Poster(ani.poster, ani.title)}</div>` });
    const g = d.genres && d.genres[0];
    if (g) {
      const suite = d.genres.slice(1, 3).map((x) => x.name), liste = (() => { try { return new Intl.ListFormat(LANG, { type: 'conjunction' }).format(suite); } catch { return suite.join(', '); } })();
      s.push({ k: 'genre', tone: 5, body: `<small>${esc(t('Votre genre préféré'))}</small><h2 class="rc-word">${esc(g.name)}</h2><p>${esc(t('{h} en tout.', { h: hRc(g.hours) }) + (suite.length ? ` ${t('Juste derrière : {g}.', { g: liste })}` : ''))}</p>` });
    }
    if (d.person) s.push({ k: 'person', tone: 6, body: `<small>${esc(t('La personne que vous avez le plus vue'))}</small><h2 class="rc-word">${esc(d.person)}</h2><p>${esc(t('À l’écran ou derrière la caméra, elle était dans beaucoup de vos titres.'))}</p>` });
    if (d.bestMonth && d.bestMonth.hours) s.push({ k: 'month', tone: 2, body: `<small>${esc(t('Votre mois le plus chargé'))}</small><h2 class="rc-word">${esc(MOIS(d.bestMonth.m, 'long'))}</h2><p>${esc(t('{h} de visionnage.', { h: hRc(d.bestMonth.hours) }) + (d.streak > 1 ? ` ${t('Record : {n} jours de suite.', { n: nombre(d.streak) })}` : ''))}</p><div class="rc-bars" aria-hidden="true">${d.months.map((m) => `<i class="${m.m === d.bestMonth.m ? 'on' : ''}" style="height:${Math.max(4, (m.hours / d.bestMonth.hours) * 100)}%"></i>`).join('')}</div>` });
    if (d.completedShows && d.completedShows.length) s.push({ k: 'done', tone: 3, body: `<small>${esc(t('Terminées cette année'))}</small><h2 class="rc-big">${esc(nombre(d.completedShows.length))}</h2><p>${esc(forme(d.completedShows.length, 'série ou animé vu en entier.', 'séries et animés vus en entier.'))}</p><div class="rc-row">${d.completedShows.slice(0, 5).map((x) => Poster(x.poster, x.title)).join('')}</div>` });
    s.push({ k: 'end', tone: 1, end: true, body: `<small>${esc(t('{y}, c’était ça', { y }))}</small><h2>${esc(t('Merci, {n} !', { n: name }))}</h2><p>${esc(t('À l’année prochaine pour de nouvelles histoires.'))}</p>` });
    return s;
  }
  function planifierRecap() {
    const rc = M8.recap; clearTimeout(rc.T);
    if (rc.held || rc.reduce || rc.i >= rc.n - 1) return;
    rc.fin = Date.now() + rc.reste;
    rc.T = setTimeout(() => { if (L.route(location.hash).path === '/retrospective') recapAller(1); }, rc.reste);
  }
  function recapAller(dir) { const rc = M8.recap, j = Math.max(0, Math.min(rc.n - 1, rc.i + dir)); if (j === rc.i) return; rc.i = j; rc.reste = SLIDE_MS; rerender('.recap'); }
  function recapTenir(on) {
    const rc = M8.recap; if (rc.held === on || L.route(location.hash).path !== '/retrospective') return; rc.held = on;
    const r = $('.recap'); if (r) { r.classList.toggle('held', on); const b = r.querySelector('.rc-progress b.run'); if (b) b.style.animationPlayState = on ? 'paused' : 'running'; }
    if (on) { clearTimeout(rc.T); rc.reste = Math.max(0, rc.fin - Date.now()); } else planifierRecap();
  }
  V.recap = (q) => {
    const year = anneeDe(q), d = M8.stats[String(year)], rc = M8.recap;
    if (!d) { chargerStats(year); return PageLoading(); }
    if (d.erreur) return `<main class="with-nav page-in"><div class="page">${Empty(t('Impossible pour le moment.'))}</div></main>`;
    const slides = recapSlides(d, year, S.profile.name);
    if (rc.an !== year) { rc.an = year; rc.i = 0; rc.reste = SLIDE_MS; }
    rc.n = slides.length; rc.i = Math.min(rc.i, rc.n - 1); rc.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const i = rc.i, cur = slides[i], ecoule = SLIDE_MS - rc.reste;
    planifierRecap();
    return `<main class="with-nav page-in"><div class="page recap-page maison"><div tabindex="-1" class="recap tone-${cur.tone}${rc.held ? ' held' : ''}" role="region" aria-roledescription="${esc(t('diaporama'))}" aria-label="${esc(t('Rétrospective {y}', { y: String(year) }))}" data-act="rctap">
    <div class="rc-progress" aria-hidden="true">${slides.map((s, j) => `<i><b class="${j < i ? 'done' : j === i && !rc.reduce ? 'run' : j === i ? 'done' : ''}"${j === i ? ` style="animation-duration:${SLIDE_MS}ms;animation-delay:-${ecoule}ms;animation-play-state:${rc.held ? 'paused' : 'running'}"` : ''}></b></i>`).join('')}</div>
    <div class="rc-slide" aria-live="polite">${cur.body}</div>
    <div class="rc-foot"><span>${esc(`${nombre(i + 1)} / ${nombre(rc.n)}`)}</span>${cur.end ? `<div class="rc-actions"><button class="btn btn-ghost btn-small f" data-act="rcagain">${I('restart')}${esc(t('Revoir'))}</button><a class="btn btn-small f" href="${href(`/stats?annee=${year}`)}">${I('gauge')}${esc(t('Tous les détails'))}</a></div>` : `<button class="btn btn-ghost btn-small f" aria-label="${esc(t('Écran suivant'))}" data-act="rcnext">${I('fwd')}${esc(t('Suivant'))}</button>`}</div></div></div></main>`;
  };

  // Collections, une collection, une liste de lecture (Collections.js)
  const Cover = (x) => { const l = (x.posters || []).slice(0, 4); return `<div class="coll-cover n${l.length}">${l.length ? l.map((p) => `<img src="${esc(p)}" alt="" loading="lazy" decoding="async">`).join('') : ph(x.name)}</div>`; };
  function charger8(cible, cle, chemin, test) {
    if (cible[cle] !== undefined) return cible[cle];
    cible[cle] = null;
    api(chemin).then((r) => { cible[cle] = r; }).catch((e) => { cible[cle] = { erreur: String(e.message) }; }).then(() => siSur(test));
    return null;
  }
  const rafraichir8 = () => { M8.coll = undefined; M8.col = {}; M8.pl = {}; };
  V.collections = () => {
    const d = charger8(M8, 'coll', '/venus/api/collections', '/collections'); if (!d) return PageLoading();
    if (d.erreur) return `<main class="with-nav page-in"><div class="page">${Empty(t('Impossible pour le moment.'))}</div></main>`;
    const tab = M8.collTab, list = tab === 'collections' ? d.collections : d.playlists;
    const tools = `<div class="head-tools"><div class="seg" role="tablist" aria-label="${esc(t('Collections'))}">${[['collections', t('Collections ({n})', { n: nombre(d.collections.length) })], ['playlists', t('Listes de lecture ({n})', { n: nombre(d.playlists.length) })]].map(([k, l]) => `<button class="seg-b f${tab === k ? ' on' : ''}" role="tab" aria-selected="${tab === k}" data-act="colltab" data-v="${k}">${esc(l)}</button>`).join('')}</div>${tab === 'playlists' ? `<button class="btn btn-small f" data-act="plnew">${I('plus')}${esc(t('Nouvelle liste'))}</button>` : S.profile.isAdmin ? `<button class="btn btn-small f" data-act="colnew">${I('plus')}${esc(t('Nouvelle collection'))}</button>` : ''}</div>`;
    const grid = list.length ? `<div class="coll-grid">${list.map((x) => `<a class="coll-tile f" href="${href(tab === 'playlists' ? `/liste-lecture/${encodeURIComponent(x.id)}` : `/collection/${encodeURIComponent(x.id)}`)}">${Cover(x)}<b>${esc(x.name)}</b><small>${esc([tn(x.count, '{n} titre', '{n} titres'), x.duration ? duree(Math.round(x.duration / 60)) : null].filter(Boolean).join(' · '))}</small></a>`).join('')}</div>`
      : `<p class="grid-empty">${esc(tab === 'playlists' ? t('Aucune liste de lecture. Sur la fiche d’un titre, touchez « Ajouter à une liste ».') : t('Aucune collection pour l’instant.'))}</p>`;
    return `<main class="with-nav page-in"><div class="page maison"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(t('Collections'))}</h1></div>${tools}</div>${grid}</div></main>`;
  };
  const Absent8 = (txt, retour, label) => `<main class="with-nav page-in"><div class="page">${Empty(txt, `<a class="btn btn-ghost btn-small f" href="${href(retour)}">${I('back')}${esc(label)}</a>`)}</div></main>`;
  V.collection = (id) => {
    const d = charger8(M8.col, id, `/venus/api/collections/${encodeURIComponent(id)}`, /^\/collection\//); if (!d) return PageLoading();
    if (d.erreur) return Absent8(t('Cette collection n’existe pas (ou plus).'), '/collections', t('Collections'));
    return `<main class="with-nav page-in"><div class="page coll-page maison"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(d.name)}</h1><p class="count">${esc(tn(d.items.length, '{n} titre', '{n} titres'))}</p></div><div class="head-tools"><a class="btn btn-ghost btn-small f" href="${href('/collections')}">${I('back')}${esc(t('Collections'))}</a>${d.editable ? `<button class="btn btn-ghost btn-small f" data-act="colren" data-v="${esc(d.id)}">${I('edit')}${esc(t('Renommer'))}</button><button class="btn btn-ghost btn-small btn-del f" aria-label="${esc(t('Supprimer la collection'))}" title="${esc(t('Supprimer la collection'))}" data-act="coldel" data-v="${esc(d.id)}">${I('trash')}</button>` : ''}</div></div>
    ${d.items.length ? `<div class="grid">${d.items.map((i) => (d.editable ? `<div class="coll-item">${Card(i, { poster: true })}<button class="coll-x f" aria-label="${esc(t('Retirer « {t} »', { t: i.title }))}" title="${esc(t('Retirer de la collection'))}" data-act="colrm" data-v="${esc(i.id)}" data-c="${esc(d.id)}" data-t="${esc(i.title)}">${I('close')}</button></div>` : Card(i, { poster: true }))).join('')}</div>` : `<p class="grid-empty">${esc(t('Collection vide : ajoutez des titres avec « Ajouter à une liste » sur leur fiche.'))}</p>`}</div></main>`;
  };
  const vu8 = (i) => !!(i.progress && i.progress.watched);
  V.playlist = (id) => {
    const d = charger8(M8.pl, id, `/venus/api/listes/${encodeURIComponent(id)}`, /^\/liste-lecture\//); if (!d) return PageLoading();
    if (d.erreur) return Absent8(t('Cette liste n’existe pas (ou plus).'), '/collections?onglet=listes', t('Listes'));
    const items = d.items, first = (items.find((i) => !vu8(i)) || items[0] || {}).id;
    return `<main class="with-nav page-in"><div class="page coll-page maison"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(d.name)}</h1><p class="count">${esc(tn(items.length, '{n} vidéo', '{n} vidéos') + (d.duration ? ` · ${duree(Math.round(d.duration / 60))}` : ''))}</p></div><div class="head-tools"><a class="btn btn-ghost btn-small f" href="${href('/collections?onglet=listes')}">${I('back')}${esc(t('Listes'))}</a><button class="btn btn-ghost btn-small f" data-act="plren" data-v="${esc(d.id)}">${I('edit')}${esc(t('Renommer'))}</button><button class="btn btn-ghost btn-small btn-del f" aria-label="${esc(t('Supprimer la liste'))}" title="${esc(t('Supprimer la liste'))}" data-act="pldel" data-v="${esc(d.id)}">${I('trash')}</button></div></div>
    ${items.length ? `<div class="actions" style="margin-bottom:18px"><a class="btn btn-play f" href="${href(lirePath(first))}">${I('play')}${esc(items.some(vu8) ? t('Continuer') : t('Tout lire'))}</a><button class="btn btn-ghost f" data-act="plshuffle" data-v="${esc(d.id)}">${I('shuffle')}${esc(t('Aléatoire'))}</button></div>` : ''}
    <div class="pl-list">${items.length ? items.map((i, n) => `<div class="pl-row${vu8(i) ? ' seen' : ''}"><span class="pl-n">${esc(nombre(n + 1))}</span><a class="pl-main f" href="${href(lirePath(i.id))}"><span class="pl-thumb">${i.still || i.backdrop ? `<img src="${esc(i.still || i.backdrop)}" alt="" loading="lazy" decoding="async">` : ph(i.title)}<span class="ep-play">${I('play')}</span></span><span class="pl-txt"><b>${esc(i.showTitle ? `${i.showTitle} · ${t('S{s} É{e}', { s: nombre(i.season), e: nombre(i.episode) })}` : i.title)}</b><small>${esc([i.showTitle ? (i.title !== i.showTitle ? i.title : null) : i.year, i.duration ? t('{n} min', { n: nombre(Math.max(1, Math.round(i.duration / 60))) }) : null, vu8(i) ? t('Vu') : null].filter(Boolean).join(' · '))}</small></span></a>
      <div class="pl-tools"><button class="p-icon small f pl-up" aria-label="${esc(t('Monter'))}" data-act="plmove" data-v="${n}" data-d="-1" data-c="${esc(d.id)}"${n === 0 ? ' disabled' : ''}>${I('up')}</button><button class="p-icon small f pl-down" aria-label="${esc(t('Descendre'))}" data-act="plmove" data-v="${n}" data-d="1" data-c="${esc(d.id)}"${n === items.length - 1 ? ' disabled' : ''}>${I('down')}</button><button class="p-icon small f" aria-label="${esc(t('Retirer « {t} »', { t: i.showTitle ? `${i.showTitle} · ${t('S{s} É{e}', { s: nombre(i.season), e: nombre(i.episode) })}` : i.title }))}" data-act="plrm" data-v="${esc(i.id)}" data-c="${esc(d.id)}">${I('close')}</button></div></div>`).join('') : `<p class="grid-empty">${esc(t('Liste vide : sur la fiche d’un titre, touchez « Ajouter à une liste ».'))}</p>`}</div></div></main>`;
  };
  // Petite fenêtre « un nom » (renommer, nouvelle liste, nouvelle collection) et fenêtre de confirmation.
  function nomSheet(titre, { valeur = '', placeholder = '', bouton, note = '', faire }) {
    M8.nomFaire = faire;
    openSheet(titre, `<form data-form="nom"><input id="nom-in" class="input f" maxlength="80" value="${esc(valeur)}" placeholder="${esc(placeholder)}" aria-label="${esc(titre)}" autocomplete="off">${note ? `<p class="muted">${esc(note)}</p>` : ''}<p class="error-text" id="nom-err" role="alert"></p><div class="form-actions"><button class="btn btn-play f" type="submit">${esc(bouton)}</button></div></form>`);
    requestAnimationFrame(() => { const i = $('#nom-in'); if (i) { i.focus(); i.select(); } });
  }
  function confirmer(msg, label, faire) { M8.confFaire = faire; openSheet(label, `<div><p>${esc(msg)}</p><div class="form-actions"><button class="btn btn-ghost f" data-act="closesheet">${esc(t('Annuler'))}</button><button class="btn btn-danger-solid f" data-act="confok">${esc(label)}</button></div></div>`); }
  // Les écritures (POST, en-tête x-odin) : rend l'objet, ou un code d'erreur (« 400 », « 403 », « 404 »…).
  const ecrire8 = async (chemin, corps) => { try { return await api(chemin, corps); } catch (e) { return { erreur: String(e.message) }; } };
  function nouvelleListe(itemId) {
    nomSheet(t('Nouvelle liste de lecture'), { placeholder: t('Ex. : Marathon du dimanche'), bouton: t('Créer'), faire: async (name) => {
      if (!name) return t('Donnez un nom à la liste');
      const r = await ecrire8('/venus/api/listes', { name, ...(itemId ? { itemId } : {}) }); if (r.erreur) return t('Impossible pour le moment.');
      closeSheet(false); rafraichir8(); toast(r.added ? t('Liste « {n} » créée avec {v}', { n: name, v: tn(r.added, '{n} vidéo', '{n} vidéos') }) : t('Liste « {n} » créée', { n: name }), 'success');
      if (!itemId) go(`/liste-lecture/${encodeURIComponent(r.id)}`); return '';
    } });
  }
  function nouvelleCollection(itemId) {
    nomSheet(t('Nouvelle collection'), { placeholder: t('Ex. : Films de Noël'), bouton: t('Créer'), note: t('Visible par tous les profils.'), faire: async (name) => {
      if (!name) return t('Donnez un nom à la collection');
      const r = await ecrire8('/venus/api/collections', { name, ...(itemId ? { itemId } : {}) }); if (r.erreur) return t('Impossible pour le moment.');
      closeSheet(false); rafraichir8(); toast(t('Collection « {n} » créée', { n: name }), 'success'); go(`/collection/${encodeURIComponent(r.id)}`); return '';
    } });
  }
  // « Ajouter à… » depuis une fiche : une liste de lecture (tous les profils) ou une collection (le propriétaire).
  async function ajouterA(item) {
    let d; try { d = await api('/venus/api/collections'); } catch { toast(t('Impossible pour le moment.')); return; }
    M8.addItem = item;
    const admin = S.profile.isAdmin && ['movie', 'show', 'clip'].includes(item.type);
    openSheet(t('Ajouter « {t} »', { t: item.title }), `<div class="add-to"><h3>${esc(t('Listes de lecture'))}</h3>${d.playlists.map((pl) => `<button class="opt ic f" data-act="addpl" data-v="${esc(pl.id)}" data-n="${esc(pl.name)}">${I('list')}${esc(pl.name)}<small>${esc(tn(pl.count, '{n} vidéo', '{n} vidéos'))}</small></button>`).join('')}<button class="opt ic f" data-act="plnew" data-v="${esc(item.id)}">${I('plus')}${esc(t('Nouvelle liste de lecture'))}</button>
    ${admin ? `<h3 style="margin-top:16px">${esc(t('Collections'))}</h3>${d.collections.map((c) => `<button class="opt ic f" data-act="addcol" data-v="${esc(c.id)}" data-n="${esc(c.name)}">${I('grid4')}${esc(c.name)}<small>${esc(tn(c.count, '{n} titre', '{n} titres'))}</small></button>`).join('')}<button class="opt ic f" data-act="colnew" data-v="${esc(item.id)}">${I('plus')}${esc(t('Nouvelle collection'))}</button>` : ''}</div>`);
  }

  // Téléchargements (Downloads.js) : le fichier d'origine s'enregistre sur l'appareil ; les versions légères (720p,
  // 480p) sont préparées par Odin sur sa machine (une à la fois), puis enregistrées depuis cette liste.
  const DL_ETAT = { queued: 'En attente', working: 'Préparation', ready: 'Prêt', error: 'Échec' };
  const DL_RAISON = { ffmpeg: 'FFmpeg est introuvable pour Odin : la version légère ne peut pas être préparée. Installez FFmpeg sur la machine d’Odin, puis redémarrez Odin.', place: 'Pas assez de place sur le disque d’Odin pour préparer cette version.', fichier: 'Le fichier de ce titre n’est plus à sa place (disque débranché, fichier déplacé).', echec: 'La conversion a échoué.', delai: 'La conversion a pris trop de temps : elle a été arrêtée.' };
  const DL_REFUS = { 403: 'Un profil enfant ne télécharge pas.', 409: 'Trop de téléchargements : supprimez-en un avant d’en préparer un autre.', 404: 'Ce titre n’est pas (ou plus) dans la bibliothèque.' };
  // La liste est relue toutes les 2 s tant qu'une version se prépare, et seulement sur cette page. Seule la liste est
  // repeinte, et seulement si elle a changé : le titre, le menu et « ‹ Odin » ne bougent pas et gardent le focus.
  function chargerDl() {
    clearTimeout(M8.dl.T);
    api('/venus/api/telechargements').then((l) => { M8.dl.list = Array.isArray(l) ? l : []; M8.dl.err = false; }).catch(() => { if (!M8.dl.list) { M8.dl.list = []; M8.dl.err = true; } })
      .then(() => { peindreDl(); if ((M8.dl.list || []).some((j) => j.state === 'working' || j.state === 'queued') && L.route(location.hash).path === '/telechargements') M8.dl.T = setTimeout(chargerDl, 2000); });
  }
  const DlRow = (j) => {
    const pct = Math.max(0, Math.min(100, Math.round(Number(j.progress) || 0))), enCours = j.state === 'working' || j.state === 'queued';
    return `<div class="dl-row st-${esc(j.state)}"><span class="dl-pic">${j.poster ? `<img src="${esc(j.poster)}" alt="">` : ''}</span><div class="dl-body"><b>${esc(j.title)}</b><small>${esc([t('Version légère {q}', { q: j.quality }), DL_ETAT[j.state] ? t(DL_ETAT[j.state]) : null, j.size ? taille(j.size) : null].filter(Boolean).join(' · '))}</small>${enCours ? `<div class="meter"><i style="width:${pct}%"></i></div>` : ''}${j.state === 'error' ? `<small class="error-text">${esc(DL_RAISON[j.reason] ? t(DL_RAISON[j.reason]) : j.error || '')}</small>` : ''}</div>
    <div class="dl-actions">${j.state === 'ready' ? `<a class="btn btn-small f" data-act="dlsave" data-v="${esc(j.id)}" href="/venus/api/telechargements/${encodeURIComponent(j.id)}/fichier" download="${esc(j.name || '')}">${I('down')}${esc(t('Enregistrer'))}</a>` : j.state === 'working' ? `<span class="dl-pct">${esc(t('{n} %', { n: nombre(pct) }))}</span>` : ''}<button class="btn btn-ghost btn-icon btn-mini f" aria-label="${esc(t('Supprimer'))}" title="${esc(t('Supprimer'))}" data-act="dldel" data-v="${esc(j.id)}">${I('close')}</button></div></div>`;
  };
  const dlListe = () => { const jobs = M8.dl.list; return !jobs ? '' : jobs.length ? jobs.map(DlRow).join('') : Empty(M8.dl.err ? t('Impossible pour le moment.') : t('Aucun téléchargement. Sur la fiche d’un film ou d’une saison, touchez « Télécharger ».')); };
  const dlSignature = () => JSON.stringify([M8.dl.list, !!M8.dl.err]);
  /**
   * Repeint la liste seule, si elle a changé depuis la dernière peinture : le bouton qui avait le focus dans la liste
   * (« Enregistrer », ✕) le retrouve. Après une suppression (`rang` : la place de la ligne partie), le focus va au ✕
   * qui a pris sa place, ou au dernier, ou au titre quand la liste est vide. Sans liste à l'écran : toute la page.
   */
  function peindreDl(rang) {
    if (L.route(location.hash).path !== '/telechargements') return;
    const h = $('.dl-list'); if (!h) { refaire(); return; }
    const sig = dlSignature(); if (sig === M8.dl.vu && rang === undefined) return;
    const a = D.activeElement, cle = a && h.contains(a) && a.dataset && a.dataset.act ? sel(a.dataset.act, a.dataset.v) : null;
    h.innerHTML = dlListe(); M8.dl.vu = sig;
    if (M8.dl.list) h.removeAttribute('aria-busy');
    if (rang !== undefined) { const x = h.querySelectorAll('[data-act="dldel"]'), b = x[Math.min(rang, x.length - 1)] || $('main h1'); if (b) b.focus({ preventScroll: true }); }
    else if (cle) { const b = h.querySelector(cle); if (b) b.focus({ preventScroll: true }); }
  }
  V.downloads = () => {
    if (M8.dl.list === undefined) { M8.dl.list = null; chargerDl(); }
    M8.dl.vu = dlSignature();
    return `<main class="with-nav page-in"><div class="page maison"><div class="page-head"><div class="head-left"><h1 tabindex="-1">${esc(t('Téléchargements'))}</h1></div></div><p class="list-hint">${esc(t('Les vidéos sont enregistrées sur votre appareil : elles se regardent ensuite sans réseau. Sur iPhone, choisissez « Enregistrer dans Fichiers » puis ouvrez-les avec l’appli Fichiers ou VLC. Les versions légères restent prêtes 7 jours sur le serveur.'))}</p>
    <div class="dl-list"${M8.dl.list ? '' : ' aria-busy="true"'}>${dlListe()}</div></div></main>`;
  };
  // « Télécharger » (openDownload de Downloads.js) : un film (le fichier d'origine, ou une version légère), ou toute une
  // saison (`saison` : son numéro ; versions légères seulement, estimées par heure).
  function openDownload(d, size, saison) {
    const parSaison = saison !== undefined;
    const est = (gbh) => (parSaison ? t('≈ {n} Go par heure', { n: new Intl.NumberFormat(LANG, { maximumFractionDigits: 2 }).format(gbh) }) : d.runtime ? `≈ ${taille(gbh * 1e9 * (d.runtime / 60))}` : '');
    const leger = (q, titre, sous, gbh) => `<button class="opt f" type="button" data-act="dlprep" data-v="${q}" data-id="${esc(d.id)}"${parSaison ? ` data-s="${esc(String(saison))}"` : ''}>${I('film')}<span><b>${esc(t(titre))}</b><small>${esc([t(sous), est(gbh)].filter(Boolean).join(' · '))}</small></span></button>`;
    openSheet(parSaison ? t('Télécharger la saison') : t('Télécharger « {t} »', { t: d.title }), `<div class="dl-choices">${parSaison ? '' : `<a class="opt f" href="/venus/api/telecharger/${encodeURIComponent(d.id)}" download="" data-act="dlorig">${I('down')}<span><b>${esc(t('Fichier d’origine'))}</b><small>${esc([t('Meilleure qualité'), taille(size)].filter(Boolean).join(' · '))}</small></span></a>`}
    ${leger('720p', 'Version légère 720p', 'Idéale pour un téléphone ou une tablette', 0.9)}${leger('480p', 'Très légère 480p', 'Pour garder de la place', 0.45)}<p class="muted" style="font-size:.84rem;margin:10px 0 0">${esc(t('Les versions légères sont préparées par le serveur, puis disponibles dans « Téléchargements ».'))}</p></div>`);
  }

  // Séance (Seance.js) : rejoindre une séance avec son code de 4 lettres (ou le lien d'invitation « ?code= ») ouvre
  // son titre dans le lecteur. « Ensemble » (créer la séance, pause partagée) vit dans le lecteur : pas encore là.
  async function rejoindreSeance(code) {
    const se = M8.se; se.code = code; se.msg = '';
    if (!/^[A-Z0-9]{4}$/.test(code)) { se.msg = t('Le code fait 4 lettres.'); siSur('/seance'); return; }
    try { const r = await api(`/venus/api/seance/${encodeURIComponent(code)}`); go(`${lirePath(r.itemId)}?salle=${encodeURIComponent(r.code)}`); }
    catch (e) { se.msg = String(e.message) === '404' ? t('Séance introuvable.') : t('Impossible pour le moment.'); siSur('/seance'); const i = $('#room-code'); if (i) i.focus(); }
  }
  V.seance = (q) => {
    const se = M8.se, c = String(q.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (c && c !== se.tente) { se.tente = c; void rejoindreSeance(c); }
    // Comme Seance.js : en arrivant sans code complet, le champ du code a le focus (« data-arrivee », lu par hashchange).
    return `<main class="with-nav page-in"><div class="page maison"><div class="together"><form class="panel" data-form="sjoin">${I('people')}<h1 tabindex="-1">${esc(t('Rejoindre une séance'))}</h1><p>${esc(t('Regardez le même film au même moment que vos proches, chacun chez soi. Pause, retour en arrière, réactions et discussion sont partagés.'))}</p>
    <input id="room-code" class="input code-input" maxlength="4" placeholder="ABCD" autocomplete="off" autocapitalize="characters" aria-label="${esc(t('Code de la séance'))}" value="${esc(se.code)}"${c.length === 4 ? '' : ' data-arrivee'}><p class="error-text" role="alert">${esc(se.msg)}</p><div class="form-actions"><button class="btn btn-play f" type="submit">${esc(t('Rejoindre'))}</button></div></form>
    <div class="together-how"><h2>${esc(t('Lancer votre propre séance'))}</h2><ol><li>${esc(t('Lancez un film ou un épisode.'))}</li><li>${esc(t('Dans le lecteur, touchez « Ensemble ».'))}</li><li>${esc(t('Partagez le code de 4 lettres ou le QR code.'))}</li></ol><p class="muted small">${esc(t('Dans Odin, « Ensemble » arrive avec le lecteur : pour l’instant, rejoindre une séance ouvre son titre, sans pause partagée.'))}</p></div></div></div></main>`;
  };

  // Télécommande (Remote.js) : le téléphone pilote un écran de la maison, l'un de ceux que connaît Odin (la box
  // domotique reliée à Odin, /venus/ecrans) ; un autre téléphone reçoit le QR de la télécommande d'Odin (/t/<jeton> :
  // cet écran seul, limité dans le temps, révocable). Rien n'est gardé dans le navigateur : l'écran choisi vit le temps
  // de la page. Aucun nom de produit n'est écrit à l'écran (règle de la maquette) : « la box domotique ».
  const SANS_BOX = 'Aucune box domotique n’est reliée à Odin : aucun écran à piloter. Reliez-la dans Midgard, « Relier une box ».';
  /** Relit les écrans ; la liste arrivée, le focus perdu va à l'écran `garder` (celui d'avant « Changer »), au premier, ou au titre. */
  function chargerEcrans(garder) {
    const rc = M8.rc; rc.ecrans = null;
    api('/venus/ecrans').then((r) => { rc.ecrans = Array.isArray(r.ecrans) ? r.ecrans : []; rc.msg = r.message ? 'ha' : ''; }).catch(() => { rc.ecrans = []; rc.msg = 'err'; }).then(() => {
      if (L.route(location.hash).path !== '/telecommande') return;
      refaire();
      const a = D.activeElement; if (a && a !== D.body) return;
      const b = (garder && $(sel('rcpick', garder))) || $('[data-act="rcpick"]') || $('main h1'); if (b) b.focus({ preventScroll: true });
    });
  }
  V.remote = () => {
    const rc = M8.rc; if (rc.ecrans === undefined) chargerEcrans();
    const ec = rc.ecrans && rc.ecrans.find((x) => x.id === rc.choisi);
    const top = (inner) => `<div class="remote-top"><button class="p-icon f" aria-label="${esc(t('Retour'))}" data-act="vback">${I('back')}</button>${inner}</div>`;
    let body;
    if (!rc.ecrans) body = `${top(`<b>${esc(t('Télécommande'))}</b>`)}<div aria-busy="true"></div>`;
    else if (!ec) {
      const txt = rc.ecrans.length ? t('Les écrans de la maison que connaît Odin. La télécommande pilote la lecture de l’écran choisi.') : rc.msg === 'ha' ? t(SANS_BOX) : rc.msg === 'err' ? t('Impossible pour le moment.') : t('Aucun écran trouvé dans la box domotique.');
      body = `${top(`<b>${esc(t('Télécommande'))}</b>`)}<div class="remote-pair">${I('remote')}<h1 tabindex="-1">${esc(t('Choisir l’écran à piloter'))}</h1><p>${esc(txt)}</p></div>${rc.ecrans.length ? `<div class="launch-list rc-screens">${rc.ecrans.map((e) => `<button class="launch-item f" data-act="rcpick" data-v="${esc(e.id)}"><span class="rc-ic">${I(e.type === 'enceinte' ? 'vol' : 'tv')}</span><span><b>${esc(e.nom)}</b><small>${esc(e.enLecture ? t('En lecture') : e.actif ? t('Allumé') : t('Éteint'))}</small></span></button>`).join('')}</div>` : ''}`;
    } else {
      body = `${top(`<div><b>${esc(t('Télécommande'))}</b><small>${esc(t('Reliée à l’écran de {n}', { n: ec.nom }))}</small></div><button class="btn btn-small btn-ghost f" data-act="rcchange">${esc(t('Changer'))}</button>`)}
      <div class="remote-row media"><button class="r-btn f" data-act="rccmd" data-v="reculer">${I('r10')}<span>${esc(t('−30 s'))}</span></button><button class="r-btn big f" data-act="rccmd" data-v="lecturepause">${I('play')}<span>${esc(t('Lecture / pause'))}</span></button><button class="r-btn f" data-act="rccmd" data-v="avancer">${I('f10')}<span>${esc(t('+30 s'))}</span></button></div>
      <p class="muted small">${esc(t('Odin pilote cet écran par la box domotique : lecture, pause et ±30 s. La croix, Retour, Accueil, la recherche, les chaînes et « Reprendre sur la TV » de Venus ne sont pas encore là.'))}</p>
      <div class="remote-launch"><h2>${esc(t('Un autre téléphone'))}</h2><p class="muted small">${esc(t('Le QR code de la télécommande d’Odin : il ne pilote que cet écran, expire tout seul et se coupe depuis Odin.'))}</p><button class="btn btn-small f" data-act="rcqr">${I('remote')}${esc(t('Afficher le QR code'))}</button></div>`;
    }
    return `<main><div class="remote-page maison">${body}</div></main>`;
  };
  async function commandeEcran(action) {
    const id = M8.rc.choisi; if (!id) return false;
    const corps = action === 'reculer' || action === 'avancer' ? { action, valeur: 30 } : { action };
    try { await api(`/venus/ecran/${encodeURIComponent(id)}/commande`, corps); try { if (navigator.vibrate) navigator.vibrate(8); } catch { /* rien */ } return true; }
    catch (e) { toast(String(e.message) === '503' ? t(SANS_BOX) : t('L’écran ne répond pas.')); return false; }
  }
  async function qrEcran() {
    const id = M8.rc.choisi; if (!id) return;
    let r; try { r = await api(`/venus/ecran/${encodeURIComponent(id)}/qr`, {}); } catch { toast(t('Impossible pour le moment.')); return; }
    const qr = /^<svg[\s>]/.test(String(r.qr || '')) && !/<script|\son\w+=/i.test(r.qr) ? r.qr : ''; // le QR dessiné par Odin, rien d'autre
    const lien = String(r.lien || '');
    openSheet(t('Télécommande pour un autre téléphone'), `<div class="vote-join rc-qr">${qr ? `<span role="img" aria-label="${esc(t('QR code de la télécommande'))}">${qr}</span>` : ''}<div><p>${esc(t('Scannez ce QR code avec le téléphone, ou ouvrez ce lien :'))}</p><input class="input cal-link f" readonly value="${esc(lien)}" aria-label="${esc(t('Lien de la télécommande'))}">${r.expire ? `<p class="muted small">${esc(t('Valable jusqu’à {h}.', { h: date(Number(r.expire), { hour: '2-digit', minute: '2-digit' }) }))}</p>` : ''}</div></div>`);
  }

  // ---------------------------------------------------------------- fenêtres (ui.js), « Tout Venus » (core.js), Ctrl+K (Palette.js)
  let lastFocus = null;
  function openSheet(title, content, { wide = false } = {}) {
    closeSheet(false); lastFocus = D.activeElement;
    const wrap = D.createElement('div'); wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title || '')}" tabindex="-1"><span class="sheet-grab" aria-hidden="true"></span>${title ? `<h2>${esc(title)}</h2>` : ''}${content}</div>`;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSheet(); });
    D.body.append(wrap);
    requestAnimationFrame(() => (wrap.querySelector('.opt.on, .f, input, button') || wrap.querySelector('.sheet')).focus());
  }
  function closeSheet(refocus = true) {
    // Une vidéo dans la fenêtre (la bande-annonce) : arrêtée et lâchée, pour qu'Odin cesse de la servir tout de suite.
    D.querySelectorAll('.sheet-wrap video').forEach((x) => { try { x.pause(); x.removeAttribute('src'); x.load(); } catch { /* rien */ } });
    D.querySelectorAll('.sheet-wrap, .palette-wrap').forEach((w) => w.remove()); if (refocus && lastFocus && D.contains(lastFocus)) lastFocus.focus();
  }
  let toastT;
  // `action` (ui.js de Venus) : un bouton dans le message, { label, go: l'adresse ouverte } ; le message reste alors 6 s.
  function toast(msg, type = 'info', action) {
    let el = $('.toast'); if (!el) { el = D.createElement('div'); D.body.append(el); }
    const ms = action ? 6000 : 3400;
    el.className = `toast t-${type} enter`; el.setAttribute('role', 'status');
    el.innerHTML = `<span class="toast-ic">${I(type === 'success' ? 'check' : 'info')}</span><span class="toast-msg">${esc(msg)}</span>${action ? `<button class="toast-act f" type="button" data-act="toastgo" data-v="${esc(action.go)}">${esc(action.label)}</button>` : ''}<i class="toast-time" style="animation-duration:${ms}ms"></i>`;
    clearTimeout(toastT); toastT = setTimeout(() => { el.classList.add('leave'); setTimeout(() => el.remove(), 260); }, ms);
  }
  function openAll() {
    const p = S.profile, secs = L.sections(p, S.cats), ids = new Set(secs.map((x) => x.id)), { shown, more } = L.menuItems(p, M, S.cats);
    const tools = [...shown, ...more].filter((it) => !ids.has(it.id) && it.id !== 'home' && it.id !== 'search');
    const path = L.route(location.hash).path;
    const tile = (it) => `<a class="all-tile f${isActive(it.href, path) ? ' on' : ''}" href="${href(it.href)}"><span class="all-ic">${I(it.icon)}</span><span class="all-txt"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></a>`;
    openSheet(t('Tout Venus'), `<div class="all-sheet"><div class="all-grid">${secs.map(tile).join('')}</div>${tools.length ? `<h3 class="all-h">${esc(t('Outils'))}</h3><div class="all-tools">${tools.map((it) => tile({ ...it, label: val(it.label), icon: val(it.icon), sub: val(it.hint) || '' })).join('')}</div>` : ''}<button class="opt f more-edit" data-act="classique">${I('folder')}<span><b>${esc(t('Médiathèques et écrans'))}</b><small>${esc(t('Déclarer un dossier, scanner, envoyer des fichiers, écrans, YouTube'))}</small></span></button><a class="opt f more-edit" href="${href('/reglages')}" data-act="setmenu">${I('gear')}${esc(t('Personnaliser le menu'))}</a></div>`);
  }
  const PAL_KIND = { movie: 'Film', show: 'Série', anime: 'Animé', clip: 'Clip', page: 'Page', setting: 'Réglage', action: 'Action' };
  let palSel = 0;
  function openPalette() {
    closeSheet(false); lastFocus = D.activeElement; palSel = 0;
    const wrap = D.createElement('div'); wrap.className = 'palette-wrap'; wrap.setAttribute('role', 'presentation');
    wrap.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="${esc(t('Recherche universelle'))}"><div class="pal-top">${I('search')}<input class="pal-input" id="palq" placeholder="${esc(t('Un film, une série, une page, un réglage…'))}" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-label="${esc(t('Rechercher partout'))}" autocomplete="off" spellcheck="false"><kbd class="pal-esc" aria-hidden="true">${esc(t('Échap'))}</kbd></div><ul class="pal-list" id="pal-list" role="listbox"></ul><div class="pal-help" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> ${esc(t('choisir'))}</span><span><kbd>${esc(t('Entrée'))}</kbd> ${esc(t('ouvrir'))}</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> ${esc(t('ouvrir / fermer'))}</span></div></div>`;
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) closeSheet(); });
    D.body.append(wrap); paintPalette(''); $('#palq').focus();
  }
  function paintPalette(q) {
    const res = L.palette(q, S.items, S.profile, M, S.cats); palSel = Math.max(0, Math.min(palSel, res.length - 1));
    $('#pal-list').innerHTML = res.map((r, i) => `<li id="pal-${i}" role="option" aria-selected="${i === palSel}" class="pal-item${i === palSel ? ' on' : ''}" data-act="palgo" data-v="${i}"><span class="pal-ic">${r.poster ? `<img src="${esc(r.poster)}" alt="" loading="lazy">` : I(r.icon || 'spark')}</span><span class="pal-txt"><b>${esc(r.label)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><span class="pal-kind">${esc(t(PAL_KIND[r.kind] || ''))}</span></li>`).join('');
    $('#palq').setAttribute('aria-activedescendant', `pal-${palSel}`);
    $('#pal-list')._res = res;
  }
  function palGo(r) { closeSheet(false); if (r.act === 'profiles') { go('/qui-regarde'); return; } if (r.tab) S.setTab = r.tab; if (r.q != null) S.searchQ = r.q; go(r.to); }

  // ---------------------------------------------------------------- lecture (lot V2 : le lecteur de Venus, lecteur.js)
  async function lire(cibleId, depuisDebut) {
    const LV = W.VenusLecteur; if (!LV) { toast(t('Lecteur indisponible.')); return; }
    closeSheet(false); closeDrop();
    await LV.ouvrir(cibleId, {
      depuisDebut, profil: S.profile.id, toast, envoyerEcran,
      allerFiche: (path) => go(path),
      // À la fermeture du lecteur : la progression a changé, la bibliothèque est relue (la fiche aussi).
      surFermeture: () => { S.fiche = {}; charger().then(() => rerender()); },
    });
  }
  async function envoyerEcran(c) {
    const titre = String(c.titre || '').split(' · ')[0];
    try { const r = await api('/api/valhalla/act', { module: 'freyja', action: 'regarder', input: { quoi: titre, ...(c.saison != null ? { saison: c.saison, episode: c.episode } : {}) } }); toast(String((r && (r.text || r.error)) || t('Envoyé.'))); }
    catch { toast(t('Aucun écran joignable pour le moment.')); }
  }

  // ---------------------------------------------------------------- données
  async function charger() {
    try {
      const c = await api('/venus/api/catalogue'); S.items = c.titres || []; S.cats = L.comptes(S.items); S.error = '';
      // Des vignettes ou des fiches se préparent en fond : la bibliothèque est relue un peu plus tard (au plus 40 fois).
      const a = c.attente || {}; clearTimeout(S.attenteT);
      if ((a.vignettes || a.fiches) && (S.relectures = (S.relectures || 0) + 1) <= 40) S.attenteT = setTimeout(async () => { await charger(); const pth = L.route(location.hash).path; for (const k of Object.keys(S.fiche)) if (S.fiche[k]) S.fiche[k].vieux = true; if (!$('#drop') && !$('.sheet') && !/^\/(reglages|nouveau|qui-regarde)/.test(pth)) { if (pth.startsWith('/titre/')) { let id = pth.slice(7); try { id = decodeURIComponent(id); } catch { /* */ } await chargerFiche(id); } else render(true); } }, 6000);
    } catch { S.error = t('Bibliothèque indisponible pour le moment.'); }
    S.loaded = true;
  }
  async function chargerFiche(id) {
    if (S.fiche[id] && !S.fiche[id].vieux) return;
    S.fiche[id] = S.fiche[id] || null;
    try { S.fiche[id] = await api(`/venus/api/titre/${encodeURIComponent(id)}`); } catch { S.fiche[id] = { erreur: true }; }
    if (L.route(location.hash).path === `/titre/${encodeURIComponent(id)}` || L.route(location.hash).path === `/titre/${id}`) rerender();
  }
  const sauverPrefs = () => api('/venus/api/preferences', { planete: T.chosen, auto: T.auto, verre: T.glass, leger: T.lite, ordre: M.order, caches: M.hidden }).catch(() => undefined);
  function appliquerPrefs(p) {
    T.chosen = p.planete && PLANETS[p.planete] ? p.planete : 'venus'; T.auto = p.auto || 'off'; T.glass = p.verre || 'auto'; T.lite = p.leger || 'auto';
    M.order = p.ordre && p.ordre.length ? p.ordre : NAV_ITEMS.map((i) => i.id); M.hidden = p.caches || [...DEFAULT_HIDDEN];
  }
  async function entrerProfil(id) {
    choisirProfil(id);
    S.profile = S.profils.find((p) => p.id === id) || S.profils[0] || S.profile;
    try { appliquerPrefs((await api('/venus/api/preferences')).preferences || {}); } catch { appliquerPrefs({}); }
    S.fiche = {}; await charger();
  }

  // ---------------------------------------------------------------- navigation (adresses du dépôt, avec « # » devant)
  function route() {
    const { path, q } = L.route(location.hash); let m;
    if (!S.loaded) return [PageLoading(), true];
    if (path === '/') return [V.home(), true];
    if (path === '/films') { if (q.get('genre') && S.genreHash !== location.hash) { S.genreHash = location.hash; Object.assign(fOf('movie'), { ...VIDE_F(), genres: [q.get('genre')] }); } return [V.browse('movie', q.get('vue')), true]; }
    if (path === '/series') { if (q.get('genre') && S.genreHash !== location.hash) { S.genreHash = location.hash; Object.assign(fOf('show'), { ...VIDE_F(), genres: [q.get('genre')] }); } return [V.browse('show', q.get('vue')), true]; }
    if (path === '/animes') { if (q.get('genre') && S.genreHash !== location.hash) { S.genreHash = location.hash; Object.assign(fOf('anime'), { ...VIDE_F(), genres: [q.get('genre')] }); } return [V.browse('anime', q.get('vue')), true]; }
    if (path === '/clips') { if (q.get('genre') && S.genreHash !== location.hash) { S.genreHash = location.hash; Object.assign(fOf('clip'), { ...VIDE_F(), genres: [q.get('genre')] }); } return [V.browse('clip', q.get('vue')), true]; }
    if (path === '/liste') return [V.browse('mylist', q.get('vue')), true];
    if ((m = path.match(/^\/titre\/(.+)$/))) { let id = m[1]; try { id = decodeURIComponent(id); } catch { /* tel quel */ } return [V.details(id), true]; }
    if (path === '/recherche') { if (q.get('q') != null) S.searchQ = q.get('q'); return [V.search(), true]; }
    if (path === '/reglages') { if (q.get('tab')) S.setTab = q.get('tab'); return [V.settings(), true]; }
    if (path === '/qui-regarde') return [V.profiles(), false];
    if (path === '/nouveau') { if (q.get('type') && RKINDS.some(([k]) => k === q.get('type'))) S.req.kind = q.get('type'); if (q.get('q') != null) S.req.q = q.get('q'); return [V.request(), true]; }
    if (path === '/nouveautes') { if (q.get('type') && NKINDS.some(([k]) => k === q.get('type'))) S.newKind = q.get('type'); return [V.nouveautes(), true]; }
    // La maison (lot V8)
    if (path === '/cesoir') return [V.tonight(), true];
    if (path === '/vote') return [V.vote(q), false];
    if (path === '/stats') return [V.stats(q), true];
    if (path === '/retrospective') return [V.recap(q), true];
    if (path === '/telechargements') return [V.downloads(), true];
    if (path === '/seance') return [V.seance(q), true];
    if (path === '/telecommande') return [V.remote(), false];
    if (path === '/collections') { if (q.get('onglet')) M8.collTab = q.get('onglet') === 'listes' ? 'playlists' : 'collections'; return [V.collections(), true]; }
    if ((m = path.match(/^\/collection\/(.+)$/))) { let id = m[1]; try { id = decodeURIComponent(id); } catch { /* tel quel */ } return [V.collection(id), true]; }
    if ((m = path.match(/^\/liste-lecture\/(.+)$/))) { let id = m[1]; try { id = decodeURIComponent(id); } catch { /* tel quel */ } return [V.playlist(id), true]; }
    if (NAV_ITEMS.some((x) => x.href === path)) return [V.bientot(path), true];
    return [V.home(), true];
  }
  const TITLE_OF = { '/': '', '/films': 'Films', '/series': 'Séries', '/animes': 'Animés', '/clips': 'Clips', '/liste': 'Ma liste', '/recherche': 'Recherche', '/reglages': 'Réglages', '/qui-regarde': 'Qui regarde ?', '/nouveau': 'Nouveau', '/nouveautes': 'Nouveautés', '/stats': 'Mes statistiques', '/telechargements': 'Téléchargements', '/collections': 'Collections', '/vote': 'Vote en famille', '/retrospective': 'Rétrospective', '/seance': 'Séance', '/telecommande': 'Télécommande' };
  let precedent = '#/', dernierChemin = '';
  function render(keepScroll = false) {
    applyTheme();
    const { path, q } = L.route(location.hash);
    // « /lecture/<cible> » (adresse du dépôt) : le lecteur s'ouvre par-dessus la page d'où l'on vient.
    const ml = path.match(/^\/lecture\/(.+)$/);
    if (ml) { let id = ml[1]; try { id = decodeURIComponent(id); } catch { /* tel quel */ } history.replaceState(null, '', precedent); void lire(id, q.get('debut') === '1'); return render(true); }
    precedent = location.hash || '#/';
    const y = scrollY;
    if (path !== '/nouveau') clearTimeout(S.fileT);
    // Revenir sur « Nouveau » relit la file (et relance sa relecture toutes les 2 s si un téléchargement avance).
    if (path === '/nouveau' && dernierChemin !== '/nouveau') S.file = null;
    // La maison (lot V8) : arriver sur la page relit ses données ; la quitter arrête ce qui se relit tout seul.
    if (path !== dernierChemin) {
      if (path === '/collections') M8.coll = undefined;
      if (/^\/(collection|liste-lecture)\//.test(path)) { M8.col = {}; M8.pl = {}; }
      if ((path === '/stats' || path === '/retrospective') && !/^\/(stats|retrospective)$/.test(dernierChemin)) M8.stats = {};
      if (path === '/retrospective') { M8.recap.an = 0; M8.recap.held = false; }
      if (path === '/cesoir') M8.tg.cle = '';
      if (path === '/telechargements') M8.dl.list = undefined;
      if (path === '/telecommande') M8.rc.ecrans = undefined;
      if (path === '/seance') Object.assign(M8.se, { tente: '', msg: '' });
    }
    if (path !== '/retrospective') clearTimeout(M8.recap.T);
    if (path !== '/vote') clearTimeout(M8.vt.T);
    if (path !== '/telechargements') clearTimeout(M8.dl.T);
    dernierChemin = path;
    const [page, withNav] = route();
    $('#app').innerHTML = withNav ? Shell(path, page) : page;
    $('#app').removeAttribute('aria-busy');
    const d = path.startsWith('/titre/') ? S.items.find((x) => `/titre/${encodeURIComponent(x.id)}` === path || `/titre/${x.id}` === path) : null;
    const tt = TITLE_OF[path] != null ? t(TITLE_OF[path]) : (d ? d.title : '');
    D.title = tt ? `${tt} — ${planet().name}` : planet().name;
    if (keepScroll) scrollTo(0, y); else scrollTo(0, 0);
  }
  const rerender = (sel) => { render(true); if (sel) { const el = D.querySelector(sel); if (el) el.focus({ preventScroll: true }); } };
  // En arrivant sur une page : le champ qu'elle désigne (« data-arrivee », comme Seance.js le fait), sinon son titre.
  W.addEventListener('hashchange', () => { closeSheet(false); closeDrop(); render(); const h = $('main [data-arrivee]') || $('main h1'); if (h) h.focus({ preventScroll: true }); });
  W.addEventListener('scroll', () => { $('.mobile-top')?.classList.toggle('solid', scrollY > 40); D.documentElement.classList.toggle('scrolled', scrollY > 12); }, { passive: true });
  try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => render(true)); } catch { /* */ }

  // Menus déroulants de Browse.js (tri, filtres)
  function dropdown(anchor, kind, which) {
    closeDrop();
    const f = fOf(kind), items = L.itemsOf(S.items, kind);
    const r = anchor.getBoundingClientRect(), w = Math.min(which === 'filter' ? 560 : 300, innerWidth - 24);
    let html;
    if (which === 'sort') {
      const opts = (kind === 'mylist' ? [['mine', 'Ordre de la liste', ['Ajoutés récemment', 'Ajoutés il y a longtemps']]] : []).concat(SORTS);
      const cur = opts.find((x) => x[0] === f.sort) || opts[0];
      html = `<p class="dd-title">${esc(t('Trier par'))}</p><div class="dd-list">${opts.map(([id, l]) => `<button class="dd-opt f${id === f.sort ? ' on' : ''}" role="menuitemradio" aria-checked="${id === f.sort}" data-act="sortpick" data-kind="${kind}" data-v="${id}">${I(id === f.sort ? 'check' : 'dot')}${esc(t(l))}</button>`).join('')}</div>${cur[0] !== 'random' ? `<div class="dd-seg">${cur[2].map((l, k) => `<button class="seg-b f${(k === 1) === !!f.desc ? ' on' : ''}" data-act="sortdir" data-kind="${kind}" data-v="${k}">${esc(t(l))}</button>`).join('')}</div>` : ''}`;
    } else {
      const decades = [...new Set(items.filter((i) => i.year).map((i) => Math.floor(i.year / 10) * 10))].sort((a, b) => b - a);
      const group = (title, values, field, lab) => (values.length < 1 && !f[field].length ? '' : `<div class="dd-group"><p class="dd-title">${esc(title)}</p><div class="dd-chips">${values.map((v) => { const id = Array.isArray(v) ? v[0] : v; const on = f[field].includes(id); return `<button class="mini f${on ? ' on' : ''}" aria-pressed="${on}" data-act="fchip" data-kind="${kind}" data-k="${field}" data-v="${esc(id)}">${esc(Array.isArray(v) ? t(v[1]) : lab(v))}</button>`; }).join('')}</div></div>`);
      const notes = items.some((i) => L.note(i)) || f.minScore ? `<div class="dd-group"><p class="dd-title">${esc(t('Note minimale'))}</p><div class="dd-chips">${[['', t('Toutes')], ...SCORES.map(([id, n]) => [id, t('{n} et plus', { n: nombre(Number(n)) })])].map(([id, l]) => `<button class="mini f${f.minScore === id ? ' on' : ''}" aria-pressed="${f.minScore === id}" data-act="minscore" data-kind="${kind}" data-v="${id}">${esc(l)}</button>`).join('')}</div></div>` : '';
      const body = `${group(t('Genres'), L.genresDe(items), 'genres', (g) => g)}${group(t('Années'), decades, 'decades', (d) => t('Années {d}', { d: String(d).slice(2) }))}${notes}${group(t('Qualité'), QUALITY.filter(([, , q]) => items.some(q)), 'quality')}`;
      html = `${body || `<p class="muted">${esc(t('Pas encore de filtre possible : genres et notes arrivent avec les fiches des titres (Réglages → Demandes).'))}</p>`}<div class="dd-foot"><button class="btn btn-ghost btn-small f" data-act="freset" data-kind="${kind}">${esc(t('Réinitialiser'))}</button><button class="btn btn-small f" data-act="closedrop">${esc(t('Voir les résultats'))}</button></div>`;
    }
    const d = D.createElement('div');
    d.id = 'drop'; d.className = `dropdown${which === 'filter' ? ' wide' : ''}`; d.setAttribute('role', 'menu'); d.innerHTML = html; d._anchor = anchor;
    Object.assign(d.style, { width: `${w}px`, left: `${Math.max(12, Math.min(innerWidth - w - 12, r.right - w))}px`, top: `${r.bottom + 8}px`, maxHeight: `${Math.max(220, innerHeight - r.bottom - 24)}px` });
    anchor.setAttribute('aria-expanded', 'true');
    D.body.append(d);
    (d.querySelector('.on') || d.querySelector('button'))?.focus({ preventScroll: true });
  }
  function closeDrop() { const d = $('#drop'); if (d) { const a = d._anchor; d.remove(); if (a && D.contains(a)) { a.setAttribute('aria-expanded', 'false'); a.focus({ preventScroll: true }); } } }

  // ---------------------------------------------------------------- actions (clics)
  const sel = (a, v) => `[data-act="${a}"][data-v="${String(v).replace(/"/g, '\\"')}"]`;
  const majTitre = (id, ch) => { const i = S.items.find((x) => x.id === id); if (i) Object.assign(i, ch); };
  // Le lien du calendrier se sélectionne en entier quand on y entre (Upcoming.js : onFocus → select()).
  D.addEventListener('focusin', (e) => { const x = e.target; if (x && x.classList && x.classList.contains('cal-link') && x.select) x.select(); });
  D.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) { if ($('#drop') && !e.target.closest('#drop')) closeDrop(); return; }
    const act = el.dataset.act, v = el.dataset.v, kind = el.dataset.kind;
    switch (act) {
      case 'odin': e.preventDefault(); versOdin('/'); break;
      case 'classique': e.preventDefault(); versOdin('/?venus=gestion#app=freyja'); break;
      case 'all': e.preventDefault(); openAll(); break;
      case 'profiles': e.preventDefault(); go('/qui-regarde'); break;
      case 'pickprofile': await entrerProfil(v); toast(t('Bonjour {n}', { n: S.profile.name }), 'success'); go('/'); render(); break;
      case 'palette': e.preventDefault(); openPalette(); break;
      case 'palgo': palGo($('#pal-list')._res[Number(v)]); break;
      case 'rowby': { const sc = el.parentElement.querySelector('.row-scroll'); sc.scrollBy({ left: Number(v) * Math.max(240, sc.clientWidth * 0.82), behavior: 'smooth' }); break; }
      case 'hero': S.heroIdx = (S.heroIdx + Number(v) + 60) % 60; rerender(); break;
      case 'heroto': S.heroIdx = Number(v); rerender(); break;
      case 'status': fOf(kind).status = v; rerender(sel('status', v)); break;
      case 'view': S.libView[kind] = v; rerender(sel('view', v)); break;
      case 'random': { const l = shownOf(kind); if (l.length) { const x = l[Math.floor(Math.random() * l.length)]; go(kind === 'clip' ? lirePath(x.id) : titrePath(x)); } else toast(t('Aucun titre affiché.')); break; }
      case 'sortmenu': if ($('#drop')) closeDrop(); else dropdown(el, kind, 'sort'); break;
      case 'filtermenu': if ($('#drop')) closeDrop(); else dropdown(el, kind, 'filter'); break;
      case 'sortpick': { const f = fOf(kind); f.desc = v !== f.sort ? false : f.desc; f.sort = v; if (v === 'random') f.graine = Date.now(); closeDrop(); rerender('[data-act="sortmenu"]'); break; }
      case 'sortdir': fOf(kind).desc = v === '1'; closeDrop(); rerender('[data-act="sortmenu"]'); break;
      case 'fchip': { const f = fOf(kind), k = el.dataset.k, x = k === 'decades' ? Number(v) : v; f[k] = f[k].includes(x) ? f[k].filter((y) => y !== x) : [...f[k], x]; el.classList.toggle('on'); el.setAttribute('aria-pressed', String(f[k].includes(x))); const dd = $('#drop'); render(true); if (dd) { D.body.append(dd); dd._anchor = $('[data-act="filtermenu"]'); } break; }
      case 'freset': Object.assign(fOf(kind), VIDE_F()); closeDrop(); rerender('[data-act="filtermenu"]'); break;
      case 'minscore': { fOf(kind).minScore = v; const dd = $('#drop'); render(true); if (dd) { dd.querySelectorAll('[data-act="minscore"]').forEach((b) => { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-pressed', String(b.dataset.v === v)); }); D.body.append(dd); dd._anchor = $('[data-act="filtermenu"]'); } break; }
      case 'closedrop': closeDrop(); break;
      case 'unfilter': { const f = fOf(kind), k = el.dataset.k; if (k === 'minScore') f.minScore = ''; else f[k] = f[k].filter((x) => String(x) !== v); rerender('[data-act="filtermenu"]'); break; }
      case 'resetf': Object.assign(fOf(kind), VIDE_F()); rerender(); break;
      case 'resetall': Object.assign(fOf(kind), { ...VIDE_F(), status: 'all' }); rerender(); break;
      case 'mylist': { const i = S.items.find((x) => x.id === v), on = !!(i && i.inList); try { await api('/venus/ma-liste', { oeuvre_id: v, ...(on ? { faire: 'retirer' } : {}) }); majTitre(v, { inList: !on }); if (S.fiche[v] && S.fiche[v].titre) S.fiche[v].titre.inList = !on; toast(on ? t('Retiré de ma liste') : t('Ajouté à ma liste'), on ? 'info' : 'success'); } catch { toast(t('Impossible pour le moment.')); } rerender(sel('mylist', v)); break; }
      case 'seen': case 'epseen': {
        e.preventDefault(); const on = el.dataset.on === '1', dur = Number(el.dataset.d) || 0;
        if (!dur && !on) { toast(t('Durée inconnue : lisez le titre une fois pour le marquer.')); break; }
        try { await api('/venus/reprise', { cible: v, position_s: on ? 0 : dur, duree_s: dur, type: 'video' }); } catch { toast(t('Impossible pour le moment.')); break; }
        await charger(); const id = L.route(location.hash).path.replace(/^\/titre\//, ''); let oid = id; try { oid = decodeURIComponent(id); } catch { /* */ } if (S.fiche[oid]) S.fiche[oid].vieux = true; await chargerFiche(oid);
        toast(on ? t('Marqué non vu') : t('Marqué vu'), 'success'); rerender(sel(act, v)); break;
      }
      case 'season': S.season = Number(v); rerender(sel('season', v)); break;
      case 'epf': S.epFilter = v; rerender(sel('epf', v)); break;
      case 'sendto': void envoyerEcran({ titre: (S.items.find((x) => v.startsWith(x.id)) || {}).title || '', ...(() => { const m = /:s(\d+)e(\d+)$/.exec(v); return m ? { saison: Number(m[1]), episode: Number(m[2]) } : {}; })() }); break;
      case 'person': {
        // La fiche d'une personne (Person.js) : sa photo, son rôle ici, et ses titres dans la médiathèque.
        let p; try { p = await api(`/venus/api/personne/${encodeURIComponent(v)}`); } catch { toast(t('Impossible pour le moment.')); break; }
        const role = el.dataset.role || '';
        openSheet(p.name, `<div><div class="person-head">${p.photo ? `<img class="person-photo" src="${esc(p.photo)}" alt="">` : ''}<div>${role ? `<p class="muted">${esc(role)}</p>` : ''}</div></div><h3 class="person-sub">${esc(t('Dans votre médiathèque'))}</h3>${(p.titres || []).length ? `<div class="grid person-grid">${p.titres.map((i) => Card(i, { poster: true })).join('')}</div>` : `<p class="muted">${esc(t('Rien d’autre de cette personne dans votre médiathèque.'))}</p>`}</div>`, { wide: true });
        break;
      }
      // La bande-annonce (suite du lot V2) : un fichier posé à côté du film, servi par Odin ; sinon le bouton est grisé et dit pourquoi.
      case 'trailer': {
        openSheet(t('Bande-annonce'), `<div class="trailer-box"><video class="trailer-video" controls autoplay playsinline src="/venus/bande-annonce/${encodeURIComponent(v)}"></video></div>`, { wide: true });
        const vd = $('.trailer-video'); if (vd) vd.addEventListener('error', () => toast(t('Cette bande-annonce ne peut pas être lue pour le moment.')));
        break;
      }
      case 'notrailer': toast(v || t('Pas de bande-annonce.')); break;
      case 'about': case 'tech': {
        const f = S.fiche[v]; if (!f) break; const d = f.titre, te = f.tech || {};
        const taille = te.taille ? (te.taille >= 1024 ** 3 ? t('{n} Go', { n: new Intl.NumberFormat(LANG, { maximumFractionDigits: 1 }).format(te.taille / 1024 ** 3) }) : t('{n} Mo', { n: nombre(Math.round(te.taille / 1024 ** 2)) })) : '';
        if (act === 'about') openSheet(t('À propos'), `<div class="about-sheet"><dl class="info-list">${d.year ? `<dt>${esc(t('Sortie'))}</dt><dd>${esc(String(d.year))}</dd>` : ''}<dt>${esc(t('Bibliothèque'))}</dt><dd>${esc(t(TITLES[d.category]))}</dd><dt>${esc(t('Ajouté'))}</dt><dd>${esc(date(d.added, { day: 'numeric', month: 'long', year: 'numeric' }))}</dd>${te.fichier ? `<dt>${esc(t('Fichier'))}</dt><dd><span class="prov-file loc"><code>${esc(te.fichier)}</code><button class="btn btn-small btn-ghost f" data-act="copy" data-v="${esc(te.fichier)}">${I('copy')}${esc(t('Copier'))}</button></span></dd>` : ''}</dl></div>`);
        else openSheet(d.type === 'show' ? t('Fiche technique (premier épisode)') : t('Fiche technique'), `<div class="about-sheet"><dl class="info-list"><dt>${esc(t('Vidéo'))}</dt><dd>${esc([te.largeur && te.hauteur ? `${te.largeur}×${te.hauteur}` : '', ...(te.video || [])].filter(Boolean).join(' · ') || '—')}</dd><dt>${esc(t('Audio'))}</dt><dd>${esc((te.audio || []).join(' · ') || '—')}</dd><dt>${esc(t('Sous-titres'))}</dt><dd>${(f.sousTitres || []).length ? `<ul class="track-list">${f.sousTitres.map((x) => `<li>${esc([x.langue || t('langue inconnue'), x.titre, x.aPart ? t('fichier à part') : ''].filter(Boolean).join(' · '))}</li>`).join('')}</ul>` : '—'}</dd><dt>${esc(t('Fichier'))}</dt><dd>${esc([String(te.fichier || '').split(/[\\/]/).pop(), taille].filter(Boolean).join(' · '))}</dd></dl></div>`);
        break;
      }
      case 'copy': try { await navigator.clipboard.writeText(v); toast(t('Chemin copié'), 'success'); } catch { toast(t('Copie impossible ici.')); } break;
      case 'closesheet': closeSheet(); break;
      case 'sq': S.searchQ = v; rerender('#srch'); break;
      case 'skind': S.searchKind = v; rerender(sel('skind', v)); break;
      case 'settab': S.setTab = v; rerender(sel('settab', v)); break;
      case 'setmenu': S.setTab = 'affichage'; break;
      case 'planet': {
        T.chosen = v; const tp = PLANETS[v];
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2, R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)); const w = D.createElement('div'); w.className = 'planet-warp'; Object.assign(w.style, { left: `${x}px`, top: `${y}px`, width: `${R * 2}px`, height: `${R * 2}px`, marginLeft: `${-R}px`, marginTop: `${-R}px`, background: tp.glass ? 'radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(200,215,240,.7) 30%, transparent 70%)' : `radial-gradient(circle, ${tp.accent} 0%, ${tp.accent2} 22%, ${tp.night} 58%, transparent 70%)` }); D.body.append(w); setTimeout(() => w.remove(), 1300); }
        toast(tp.glass ? t('Thème Verre : clair le jour, sombre la nuit') : t('Bienvenue sur {p}', { p: tp.name }), 'success'); void sauverPrefs(); rerender(`[data-id="${v}"]`); break;
      }
      case 'autotheme': T.auto = v; void sauverPrefs(); rerender(sel('autotheme', v)); break;
      case 'glassmode': T.glass = v; void sauverPrefs(); rerender(sel('glassmode', v)); break;
      case 'lite': T.lite = v; void sauverPrefs(); rerender(sel('lite', v)); break;
      case 'mmove': M.order = L.deplacer(M.order, v, Number(el.dataset.d)); void sauverPrefs(); rerender(`[data-act="mmove"][data-v="${v}"][data-d="${el.dataset.d}"]`); break;
      // ---- demandes et téléchargements
      case 'godemandes': e.preventDefault(); S.setTab = 'demandes'; go('/reglages?tab=demandes'); break;
      case 'upfilter': S.upFilter[kind] = v; rerender(sel('upfilter', v)); break;
      case 'upearlier': S.upEarlier[kind] = true; rerender(); break;
      case 'ical': e.preventDefault(); await subscribe(); break;
      case 'calcopy': try { await navigator.clipboard.writeText(v); toast(t('Lien copié'), 'success'); } catch { /* comme le dépôt : rien si la copie est refusée */ } break;
      case 'upopen': go(`/titre/${encodeURIComponent(v)}`); break;
      case 'upsheet': { const x = S.reg[Number(el.dataset.i)]; if (x) upSheet(x, el.dataset.k || 'movie'); break; }
      case 'newkind': S.newKind = v; history.replaceState(null, '', `#/nouveautes?type=${v}`); rerender(sel('newkind', v)); break;
      case 'newpick': { const st = S.nouv[el.dataset.k], y = st && st.data ? (st.data.sections || []).flatMap((s) => s.items).find((z) => z.key === v) : null; if (!y) break; if (S.newCur[el.dataset.k] === v && y.inLibrary) { go(`/titre/${encodeURIComponent(y.inLibrary)}`); break; } S.newCur[el.dataset.k] = v; rerender(sel('newpick', v)); scrollTo(0, 0); break; }
      case 'fav': {
        const x = S.reg[Number(el.dataset.i)]; if (!x) break; const on = S.favs.has(x.key), kb = `fav|${x.key}`; if (S.busy.has(kb)) break; S.busy.add(kb);
        try {
          const r = await envoyer(L.envie(x, on));
          if (r.ok === false) toast(premiere(r));
          else if (on) { S.favs.delete(x.key); toast(t('« {t} » retiré de vos favoris', { t: nomDe(x) })); }
          else { S.favs.add(x.key); const et = r.data && r.data.demande && r.data.demande.etat; if (et === 'en téléchargement') S.pris.add(cleSortie(x)); toast(et === 'à valider' ? premiere(r) : et === 'en téléchargement' ? t('« {t} » en favori : le téléchargement est lancé', { t: nomDe(x) }) : t('« {t} » ajouté à vos favoris · {d}', { t: nomDe(x), d: premiere(r) }), 'success'); }
          S.envies = null;
        } catch { toast(t('Impossible pour le moment.')); }
        S.busy.delete(kb); closeSheet(false); rerender(); break;
      }
      case 'grab': case 'newreq': {
        const x = S.reg[Number(el.dataset.i)]; if (!x) break; const k = act === 'newreq' ? `nv|${x.key}` : cleSortie(x); if (S.busy.has(k)) break;
        S.busy.add(k); closeSheet(false); rerender();
        try {
          const r = await envoyer(L.obtenir(x)), et = r.data && r.data.demande && r.data.demande.etat;
          if (r.ok === false) toast(premiere(r));
          else { S.pris.add(k); S.file = null; S.envies = null; toast(et === 'en téléchargement' ? t('« {t} » ajouté à {a} : le téléchargement est lancé', { t: nomDe(x), a: appDe(x.kind === 'movie' || x.type === 'movie' ? 'movie' : 'show') }) : premiere(r), et === 'en téléchargement' ? 'success' : 'info'); }
        } catch { toast(t('Impossible pour le moment.')); }
        S.busy.delete(k); rerender(); break;
      }
      case 'wishrm': try { const r = await agir('hnoss_envie', { titre: el.dataset.t || '', cle: v, retirer: true }); toast(r.ok === false ? premiere(r) : t('Retiré de mes envies')); const w = (S.envies || []).find((y) => y.cle === v || y.id === v); if (w && w.cle) S.favs.delete(w.cle); S.envies = null; } catch { toast(t('Impossible pour le moment.')); } rerender(); break;
      case 'reqkind': S.req.kind = v; rerender(sel('reqkind', v)); break;
      case 'reqadd': {
        const q = S.req.q.trim(), m = /^(.*?)\s*\((\d{4})\)$/.exec(q), kd = S.req.kind, cat = kd === 'movie' ? 'movie' : kd === 'anime' ? 'anime' : 'show';
        const rr = S.req.res && S.req.res.cle === `${cat}|${q}` && S.req.res.data.source ? (S.req.res.data.items || [])[Number(v)] : null;
        const titre = rr ? rr.title : m ? m[1] : q, an = rr ? rr.year : m ? Number(m[2]) : 0; if (String(titre).length < 2) break;
        const k = `req|${cat}|${norm(titre)}|${an || ''}`; if (S.busy.has(k) || S.pris.has(k)) break;
        S.busy.add(k); rerender();
        try { const r = await envoyer(L.obtenir({ title: titre, kind: cat, ...(an ? { year: an } : {}) })); if (r.ok === false) toast(premiere(r)); else { S.pris.add(k); const et = r.data && r.data.demande && r.data.demande.etat; toast(et === 'en téléchargement' ? t('« {t} » ajouté : le téléchargement commence', { t: titre }) : premiere(r), et === 'en téléchargement' ? 'success' : 'info'); } } catch { toast(t('Impossible pour le moment.')); }
        S.busy.delete(k); S.demandes = null; rerender(); void chargerFile(); break;
      }
      case 'qpause': case 'qresume': case 'qcancel': case 'qremove': case 'qaccept': case 'qdrop': {
        const a = { qpause: 'comete_pause', qresume: 'comete_reprendre', qcancel: 'comete_annuler', qremove: 'comete_retirer', qaccept: 'comete_accepter', qdrop: 'comete_jeter' }[act];
        // « Accepter » un fichier dont l'antivirus doute : action grave, le clic est la confirmation.
        try { const r = await agir(a, { id: v }, act === 'qaccept'); toast(premiere(r), r.ok === false ? 'info' : 'success'); } catch { toast(t('Impossible pour le moment.')); }
        await chargerFile(); break;
      }
      case 'suivisave': {
        const r = await agir('suivi_regler', { applicatif: v, qualite: champ(`q-${v}`), dossier: champ(`d-${v}`), langue: champ(`l-${v}`), ...(v === 'pleiades' ? { dossier_animes: champ(`da-${v}`) } : {}) }).catch(() => null);
        toast(premiere(r), r && r.ok !== false ? 'success' : 'info'); S.dem = null; rerender(); break;
      }
      case 'cometesave': { const ecoute = !!champ('p-ecoute'), r = await agir('comete_regler', { simultanes: champ('c-sim'), taille_max_go: champ('c-taille'), debit_mo: champ('c-debit'), pairs_max: champ('p-pairs'), envoi_pendant: champ('p-envoi') ? 'oui' : 'non', envoi_ko: champ('p-ko'), ratio: champ('p-ratio'), duree_min: champ('p-duree'), dht: champ('p-dht') ? 'oui' : 'non', port_ecoute: ecoute ? champ('p-port') : '0', ecoute: ecoute ? 'oui' : 'non' }).catch(() => null); toast(premiere(r), r && r.ok !== false ? 'success' : 'info'); S.dem = null; rerender(); break; }
      case 'srcadd': {
        const r = await agir('delta_ajouter', { nom: champ('s-nom') || '', type: champ('s-type') || 'torznab', adresse: champ('s-adr') || '', cle: champ('s-cle') || '' }).catch(() => null);
        const ce = $('#s-cle'); if (ce) ce.value = ''; // la clé ne reste pas dans la page
        toast(premiere(r), r && r.ok !== false ? 'success' : 'info'); if (r && r.ok !== false) S.dem = null; rerender(); break;
      }
      case 'srctest': { const r = await agir('delta_tester', { id: v }).catch(() => null); toast(premiere(r), r && r.ok !== false ? 'success' : 'info'); S.dem = null; rerender(); break; }
      case 'srcdel': { const r = await agir('delta_retirer', { id: v }).catch(() => null); toast(premiere(r)); S.dem = null; rerender(); break; }
      case 'catsave': case 'catforget': {
        const r = await agir('catalogue_regler', act === 'catforget' ? { oublier_cle: true } : { series: champ('cat-series'), animes: champ('cat-animes'), films: champ('cat-films'), cle: champ('cat-cle') || '' }).catch(() => null);
        const ce = $('#cat-cle'); if (ce) ce.value = '';
        toast(premiere(r), r && r.ok !== false ? 'success' : 'info'); S.dem = null; S.up = {}; S.nouv = {}; rerender(); break;
      }
      case 'hvalider': case 'hrefuser': { const kb = `h|${v}`; if (S.busy.has(kb)) break; S.busy.add(kb); const r = await agir(act === 'hvalider' ? 'hnoss_valider' : 'hnoss_refuser', { demande: v }, act === 'hvalider').catch(() => null); S.busy.delete(kb); toast(premiere(r), r && r.ok !== false ? 'success' : 'info'); S.dem = null; S.file = null; rerender(); break; }
      case 'epgrab': { const k = `ep|${v}|${el.dataset.s}|${el.dataset.e}`; if (S.busy.has(k) || S.pris.has(k)) break; S.busy.add(k); try { const r = await envoyer(L.obtenir({ title: el.dataset.t, kind: 'show', season: Number(el.dataset.s), episode: Number(el.dataset.e) })); toast(premiere(r)); if (r.ok !== false) S.pris.add(k); } catch { toast(t('Impossible pour le moment.')); } S.busy.delete(k); rerender(); break; }
      // ---- la maison (lot V8)
      case 'tanswer': {
        const st = M8.ts; st.answers[el.dataset.k] = v;
        if (st.step < 2) { st.step++; rerender('.choice'); break; }
        st.picks = L.tonightPicks(S.items, st.answers, dayPart() === 'soir', st.shown); st.picks.forEach((x) => st.shown.add(x.item.id));
        rerender('.pick .btn-play, .tonight-actions .btn'); break;
      }
      case 'tprev': M8.ts.step = Math.max(0, M8.ts.step - 1); rerender('.choice'); break;
      case 'tmore': { const st = M8.ts; st.picks = L.tonightPicks(S.items, st.answers, dayPart() === 'soir', st.shown); st.picks.forEach((x) => st.shown.add(x.item.id)); rerender('.pick .btn-play, [data-act="tmore"]'); break; }
      case 'treset': Object.assign(M8.ts, { step: 0, answers: {}, picks: null }); M8.ts.shown.clear(); rerender('.choice'); break;
      case 'tplay': playItem(S.items.find((x) => x.id === v)); break;
      case 'tvote': await startVote((M8.ts.picks || []).map((x) => x.item.id)); break;
      case 'tgwho': { const tg = M8.tg; tg.sel = tg.sel.includes(v) ? tg.sel.filter((x) => x !== v) : [...tg.sel, v]; rerender(sel('tgwho', v)); break; }
      case 'tgkind': M8.tg.kind = v; rerender(sel('tgkind', v)); break;
      case 'tgplay': playItem(((M8.tg.res && M8.tg.res.results) || []).map((x) => x.item).find((x) => x.id === v)); break;
      case 'vend': {
        if (!M8.vote) break;
        try { M8.vote = { ...(await api(`/venus/api/vote/${encodeURIComponent(M8.vote.code)}/clore`, {})), qr: M8.vote.qr }; toast(t('Le vote est terminé !'), 'success'); } catch { toast(t('Impossible pour le moment.')); }
        peindreVote(); const b = $('#vote-host [data-act="vlaunch"]'); if (b) b.focus(); break;
      }
      case 'vlaunch': closeSheet(false); clearTimeout(M8.voteT); playItem(S.items.find((x) => x.id === v) || { id: v, type: 'movie' }); break;
      case 'vback': if (history.length > 1) history.back(); else go('/'); break;
      case 'vpick': {
        const vt = M8.vt; if (!vt.st) break; vt.mine = v;
        try { vt.st = await api(`/venus/api/vote/${encodeURIComponent(vt.code)}`, { itemId: v, client: voteClient() }); try { if (navigator.vibrate) navigator.vibrate(12); } catch { /* rien */ } }
        catch (er) { toast(String(er.message) === '409' ? t('Le vote est terminé.') : t('Impossible pour le moment.')); try { vt.st = await api(`/venus/api/vote/${encodeURIComponent(vt.code)}`); } catch { /* garde l'état connu */ } }
        rerender(sel('vpick', v)); break;
      }
      case 'rctap': { const r = el.getBoundingClientRect(); recapAller(e.clientX - r.left < r.width * 0.3 ? -1 : 1); break; }
      case 'rcnext': recapAller(1); break;
      case 'rcagain': M8.recap.i = 0; M8.recap.reste = SLIDE_MS; rerender('.recap'); break;
      case 'colltab': M8.collTab = v; history.replaceState(null, '', v === 'playlists' ? '#/collections?onglet=listes' : '#/collections'); rerender(sel('colltab', v)); break;
      case 'plnew': nouvelleListe(v || null); break;
      case 'colnew': nouvelleCollection(v || null); break;
      case 'addto': { const it = S.items.find((x) => x.id === v) || (S.fiche[v] && S.fiche[v].titre); if (it) await ajouterA(it); break; }
      case 'addpl': case 'addcol': {
        const it = M8.addItem; if (!it) break; const n = el.dataset.n || '', col = act === 'addcol';
        const r = await ecrire8(`/venus/api/${col ? 'collections' : 'listes'}/${encodeURIComponent(v)}`, { faire: 'ajouter', itemId: it.id });
        closeSheet(); rafraichir8();
        if (r.erreur) toast(t('Impossible pour le moment.'));
        else toast(col ? t('Ajouté à la collection « {n} »', { n }) : r.added ? (r.added > 1 ? t('Ajouté à « {n} » ({e})', { n, e: tn(r.added, '{n} épisode', '{n} épisodes') }) : t('Ajouté à « {n} »', { n })) : t('Déjà dans « {n} »', { n }), 'success');
        break;
      }
      case 'colren': case 'plren': {
        const col = act === 'colren', d = col ? M8.col[v] : M8.pl[v]; if (!d || d.erreur) break;
        nomSheet(col ? t('Renommer la collection') : t('Renommer la liste'), { valeur: d.name, bouton: t('Enregistrer'), faire: async (name) => {
          if (!name) return t('Le nom est obligatoire');
          const r = await ecrire8(`/venus/api/${col ? 'collections' : 'listes'}/${encodeURIComponent(v)}`, { faire: 'renommer', name }); if (r.erreur) return t('Impossible pour le moment.');
          closeSheet(false); rafraichir8(); rerender(`[data-act="${act}"]`); return '';
        } });
        break;
      }
      case 'coldel': case 'pldel': {
        const col = act === 'coldel', d = col ? M8.col[v] : M8.pl[v]; if (!d || d.erreur) break;
        confirmer(col ? t('Supprimer la collection « {n} » ? Les vidéos restent dans Venus.', { n: d.name }) : t('Supprimer la liste « {n} » ? Les vidéos restent dans Venus.', { n: d.name }), t('Supprimer'), async () => {
          const r = await ecrire8(`/venus/api/${col ? 'collections' : 'listes'}/${encodeURIComponent(v)}`, { faire: 'supprimer' });
          closeSheet(false); if (r.erreur) { toast(t('Impossible pour le moment.')); return; }
          rafraichir8(); history.replaceState(null, '', col ? '#/collections' : '#/collections?onglet=listes'); M8.collTab = col ? 'collections' : 'playlists'; render(); const h = $('main h1'); if (h) h.focus();
        });
        break;
      }
      case 'confok': { const f = M8.confFaire; M8.confFaire = null; if (f) await f(); break; }
      case 'colrm': {
        const r = await ecrire8(`/venus/api/collections/${encodeURIComponent(el.dataset.c)}`, { faire: 'retirer', itemId: v });
        if (r.erreur) { toast(t('Impossible pour le moment.')); break; }
        toast(t('« {t} » retiré', { t: el.dataset.t || '' })); rafraichir8(); rerender('.coll-x, main h1'); break;
      }
      case 'plmove': {
        const id = el.dataset.c, d = M8.pl[id], n = Number(v), dir = Number(el.dataset.d); if (!d || !d.items) break;
        const next = L.bouger(d.items, n, dir); if (next === d.items) break;
        d.items = next; const j = n + dir;
        rerender(`[data-act="plmove"][data-v="${j}"][data-d="${dir}"]:not([disabled]), [data-act="plmove"][data-v="${j}"]`);
        const r = await ecrire8(`/venus/api/listes/${encodeURIComponent(id)}`, { faire: 'ordre', order: next.map((x) => x.id) });
        if (r.erreur) { toast(t('Impossible pour le moment.')); M8.pl = {}; refaire(); }
        break;
      }
      case 'plrm': {
        const id = el.dataset.c, d = M8.pl[id]; if (!d || !d.items) break; const it = d.items.find((x) => x.id === v);
        const r = await ecrire8(`/venus/api/listes/${encodeURIComponent(id)}`, { faire: 'retirer', itemId: v });
        if (r.erreur) { toast(t('Impossible pour le moment.')); break; }
        d.items = d.items.filter((x) => x.id !== v); M8.coll = undefined; toast(t('« {t} » retiré de la liste', { t: it ? (it.showTitle || it.title) : '' })); rerender('.pl-main, main h1'); break;
      }
      case 'plshuffle': { const d = M8.pl[v]; if (d && d.items && d.items.length) go(lirePath(d.items[Math.floor(Math.random() * d.items.length)].id)); break; }
      case 'dlsheet': { const it = S.items.find((x) => x.id === v); if (!it) break; const f = S.fiche[v]; openDownload(it, f && f.tech ? f.tech.taille : 0); break; }
      case 'dlorig': setTimeout(() => closeSheet(), 300); break;
      case 'dlseason': { const it = S.items.find((x) => x.id === v); if (it) openDownload(it, 0, Number(el.dataset.s)); break; }
      case 'dlprep': {
        const id = el.dataset.id, it = S.items.find((x) => x.id === id), saison = el.dataset.s; closeSheet();
        const r = await ecrire8('/venus/api/telechargements', saison ? { itemId: id, saison: Number(saison), quality: v } : { itemId: id, quality: v });
        if (r.erreur) { toast(DL_REFUS[r.erreur] ? t(DL_REFUS[r.erreur]) : t('Impossible pour le moment.')); break; }
        // Downloads.js : une saison dit son nombre d'épisodes ; le message a son bouton « Voir » (Téléchargements).
        const l = Array.isArray(r) ? r : [r];
        M8.dl.list = undefined;
        toast(l.length > 1 ? t('{n} épisodes en préparation ({q})', { n: nombre(l.length), q: v }) : t('« {t} » en préparation ({q})', { t: it && !saison ? it.title : (l[0] && l[0].title) || '', q: v }), 'success', { label: t('Voir'), go: '/telechargements' });
        break;
      }
      case 'dldel': {
        const r = await ecrire8(`/venus/api/telechargements/${encodeURIComponent(v)}`, { faire: 'supprimer' });
        if (r.erreur && r.erreur !== '404') { toast(t('Impossible pour le moment.')); break; }
        const rang = (M8.dl.list || []).findIndex((j) => j.id === v);
        if (M8.dl.list) M8.dl.list = M8.dl.list.filter((j) => j.id !== v);
        peindreDl(Math.max(0, rang)); break;
      }
      case 'toastgo': { clearTimeout(toastT); const x = $('.toast'); if (x) x.remove(); go(v); break; }
      case 'rcpick': { if (!(M8.rc.ecrans || []).some((x) => x.id === v)) break; M8.rc.choisi = v; rerender('[data-act="rccmd"][data-v="lecturepause"]'); break; }
      case 'rcchange': { const avant = M8.rc.choisi; M8.rc.choisi = ''; chargerEcrans(avant); rerender(); break; }
      // « Lecture / pause » (Remote.js) : l'écran bascule lui-même, son état fait foi (une pause faite à la télé compte).
      case 'rccmd': await commandeEcran(v === 'lecturepause' ? 'basculer' : v); break;
      case 'rcqr': await qrEcran(); break;
      case 'mreset': M.order = NAV_ITEMS.map((i) => i.id); M.hidden = [...DEFAULT_HIDDEN]; void sauverPrefs(); toast(t('Menu d’origine rétabli')); rerender(); break;
      default: break;
    }
  });
  // Les formulaires de la maison (lot V8) : « Rejoindre le vote », et la petite fenêtre « un nom ».
  D.addEventListener('submit', async (e) => {
    const f = e.target.closest && e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    if (f.dataset.form === 'sjoin') { const c = String(($('#room-code') || {}).value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); M8.se.tente = c; await rejoindreSeance(c); return; }
    if (f.dataset.form === 'vjoin') { const c = String(($('#vote-code') || {}).value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); history.replaceState(null, '', `#/vote?code=${encodeURIComponent(c)}`); await rejoindreVote(c); return; }
    if (f.dataset.form === 'nom' && M8.nomFaire) { const i = $('#nom-in'), err = await M8.nomFaire(String((i && i.value) || '').trim()); const p = $('#nom-err'); if (p) p.textContent = err || ''; if (err && i) i.focus(); }
  });
  // La rétrospective : garder le doigt (ou la souris) appuyé met l'écran en pause.
  D.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('.recap') && !e.target.closest('button, a')) recapTenir(true); });
  for (const k of ['pointerup', 'pointercancel']) D.addEventListener(k, () => recapTenir(false));
  D.addEventListener('change', async (e) => {
    const hl = e.target.closest('[data-act="hlibre"]');
    if (hl && S.dem) {
      const l = L.libres(S.dem.libres, hl.dataset.v, hl.value === 'libre');
      try { const r = await agir('hnoss_regler_libres', { libres: l.join(',') }); S.dem.libres = (r.data && r.data.libres) || l; toast(premiere(r), r.ok === false ? 'info' : 'success'); } catch { toast(t('Impossible pour le moment.')); }
      return;
    }
    const el = e.target.closest('[data-act="mtoggle"]'); if (!el) return;
    const id = el.dataset.v; M.hidden = el.checked ? M.hidden.filter((x) => x !== id) : [...M.hidden, id];
    void sauverPrefs(); rerender(`[data-act="mtoggle"][data-v="${id}"]`);
  });
  D.addEventListener('input', (e) => {
    const tg = e.target;
    if (tg.id === 'srch') { S.searchQ = tg.value; const p = tg.selectionStart; render(true); const i = $('#srch'); i.focus(); i.setSelectionRange(p, p); }
    if (tg.id === 'palq') { palSel = 0; paintPalette(tg.value); }
    if (tg.id === 'reqq') { S.req.q = tg.value; const p = tg.selectionStart; render(true); const i = $('#reqq'); if (i) { i.focus(); i.setSelectionRange(p, p); } }
  });
  D.addEventListener('keydown', (e) => {
    if (D.querySelector('.player')) return; // le lecteur a son propre clavier
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if ($('.palette-wrap')) closeSheet(); else openPalette(); return; }
    if ($('.palette-wrap') && e.target.id === 'palq') {
      const res = $('#pal-list')._res || [];
      if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(res.length - 1, palSel + 1); paintPalette(e.target.value); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); paintPalette(e.target.value); return; }
      if (e.key === 'Enter') { e.preventDefault(); if (res[palSel]) palGo(res[palSel]); return; }
    }
    // La rétrospective au clavier (Recap.js) : → ou Espace pour avancer, ← pour revenir, Échap pour les statistiques.
    if (L.route(location.hash).path === '/retrospective' && !D.querySelector('.sheet-wrap, .palette-wrap')) {
      const champ = e.target && /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName || '');
      if (e.key === 'ArrowRight' || (e.key === ' ' && !champ)) { e.preventDefault(); recapAller(1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); recapAller(-1); return; }
      if (e.key === 'Escape') { e.preventDefault(); go(`/stats?annee=${M8.recap.an || new Date().getFullYear()}`); return; }
    }
    if (e.key === 'Escape') {
      if ($('#drop')) { closeDrop(); return; }
      if (D.querySelector('.sheet-wrap, .palette-wrap')) { e.preventDefault(); closeSheet(); return; }
    }
    if (e.key === 'Tab' && D.querySelector('.sheet-wrap, .palette-wrap')) {
      const box = D.querySelector('.sheet-wrap .sheet, .palette');
      const f = [...box.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex="0"]')];
      if (f.length) { if (e.shiftKey && D.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && D.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); } }
    }
  });
  D.addEventListener('pointerdown', (e) => { const d = $('#drop'); if (d && !d.contains(e.target) && !(d._anchor && d._anchor.contains(e.target))) closeDrop(); }, true);

  // ---------------------------------------------------------------- démarrage
  (async () => {
    if (matchMedia('(pointer: coarse)').matches) D.documentElement.classList.add('touch');
    if (!location.hash) history.replaceState(null, '', '#/');
    applyTheme(); render();
    let choisi = '';
    try { const r = await api('/venus/api/profils'); S.profils = r.profils || []; choisi = r.choisi ? r.actuel : ''; } catch { S.profils = []; }
    const connu = S.profils.find((p) => p.id === choisi);
    await entrerProfil(connu ? connu.id : (S.profils[0] ? S.profils[0].id : 'moi'));
    // Plusieurs comptes et aucun choisi sur cet appareil : « Qui regarde ? » d'abord (Gates.js).
    if (!connu && S.profils.length > 1) { go('/qui-regarde'); }
    render();
    // Ouverte directement sur une page qui désigne son champ (la Séance, par son lien) : ce champ a le focus.
    const arrivee = $('main [data-arrivee]'); if (arrivee) arrivee.focus({ preventScroll: true });
  })();
})();
