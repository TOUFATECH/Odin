# Voix d'Odin v2 — cahier des charges et état

Cahier des charges complet (document partagé) : https://claude.ai/artifact/T49BVq9Bxdgamm3B939GuQ
Maquette de l'interface (à valider) : https://claude.ai/artifact/GHdMzEkoDqg9UVcRDzeTsj

Odin tient une conversation vocale en français, **100 % locale**, qu'on peut couper à tout moment et reprendre au mot près.
Il fonctionne **en autonomie, sans aucune IA** (règles, mémoire, fichiers du projet en question) ; une IA locale (Ollama)
ou externe (option) s'ajoute en renfort, jamais comme une condition. **Aucune base de données** : tout est rangé en
fichiers sur Odin (`~/.odin/memoire/`) et dans son cerveau Mnémosyne, qui fait les liens.

## Les briques

| Brique | Rôle | Choix |
| --- | --- | --- |
| Capture + annulation d'écho | Micro propre, sans la voix d'Odin | WebRTC Audio Processing ou SpeexDSP |
| Détection de parole | Début et fin de parole, soupçon d'interruption | Silero VAD v6 |
| Transcription | Texte provisoire, stable, définitif | whisper.cpp (installé), puis Kyutai STT / Parakeet / faster-whisper |
| Fin de tour | Phrase finie ou en suspens | Smart Turn v3.2 |
| Logos | Correction des mots mal transcrits, références, type de phrase, décision | Règles seules, ou règles + IA |
| Cerveau | Réponse à partir du projet et de Mnémosyne | Sans IA, Ollama, IA externe (option) |
| Synthèse | Voix française, phrase par phrase | Piper (voix « tom » / « siwis ») |
| Mémoire | Conversations, souvenirs, liens | Fichiers JSONL, jamais de SQLite |

## Règles clés

- **Interruption** : soupçon (voix > 150 ms) → volume à 30 % en moins de 100 ms ; confirmation → arrêt complet en
  moins de 200 ms, génération annulée. « Oui », « mmh », toux ou télé : Odin continue. « Stop », « attends », « Odin » :
  arrêt immédiat. Jamais déclenché par sa propre voix (écho retiré, texte entendu comparé à ce qu'il dit).
- **Reprise** : chaque réponse = un plan + des segments horodatés. Une question intermédiaire s'empile ; « continue »
  revient au premier point jamais dit, sans recommencer.
- **Compréhension** : comme Claude avec une dictée imparfaite, Odin lit l'intention (« nase » → NAS, « SIO » → SEO),
  s'appuie sur le contexte et son lexique, prend le sens le plus probable et le dit en une ligne s'il doute ; pour une
  action risquée, il demande toujours.
- **Réponse en voix ou en texte** : au choix (bouton, réglages, ou à l'oral). En texte seul, il écrit même quand on lui parle.

## Fait dans cette version (branche voix-v2, fusionnée sur main)

- [x] **Zéro SQLite dans tout Odin** : Mnémosyne, inventaire du réseau, index des documents et capture réseau en fichiers ;
  recherche plein texte en mémoire (sans accents, par début de mot, BM25) ; conversion unique de l'ancienne `odin.db` ;
  un test interdit tout retour de SQLite. Mesure : 50 000 messages cherchés en 11 ms, redémarrage en 0,5 s.
- [x] **Voix 100 % locale par défaut**, y compris sur une installation existante (aucun service en ligne utilisé).
- [x] **Configurations vocales** : réponse voix ou texte, texte en direct, écho, sensibilité, attente en fin de phrase,
  mot de réveil, maintenir pour parler, interruptions, mots d'arrêt, vitesse, volume, prononciations, cerveau
  (auto / sans IA), mode privé. Vérifiées côté serveur (`voice_options`).
- [x] **Commandes à l'oral** : « réponds par écrit », « parle-moi », « supprime cette conversation » (avec confirmation).
- [x] **Conversations** : suppression (corbeille 7 jours, annulable, puis effacement réel), export Markdown / JSON / texte.

## Reste à faire

- [x] Interface selon la maquette validée (v1.13.0) : barre « Maintenez pour parler » (+, micro, carré stop), choix « Voix + texte / Texte seul », menu Exporter / Supprimer avec corbeille et Annuler, page Réglages → Voix.
- [ ] Service vocal temps réel Orphée (Python) : Silero, Smart Turn, transcription en direct, coupure < 200 ms, reprise par segments.
- [ ] Logos pour la voix : lexique appris, corrections par prononciation.
- [ ] Projet actif : index des fichiers d'un projet et réponses sourcées sans IA.
- [ ] Conserver l'audio brut (réglage prévu, non encore utilisé : aujourd'hui l'audio n'est jamais gardé).

## Revérifié en novembre 2026 (voix d'homme ou de femme, Piper, ElevenLabs, copie de voix, réponses en audio)

Chaque fonction a été réessayée, pas seulement relue. Essais : `test/voix.test.ts` (et `test/voice.test.ts`).
Pour les lancer avec le **vrai Piper** : `npm run banc:outils -- voix` (programme, deux voix françaises, serveur HTTP),
puis `node --test test/voix.test.ts`. Sans cela, les essais prennent un faux Piper et le disent dans leur nom.

| Fonction | Comment elle a été essayée | Ce qui a été corrigé |
| --- | --- | --- |
| Voix d'homme ou de femme (Réglages → Voix) | vrai navigateur, vrai Piper | le choix sert à la phrase suivante sans relancer Odin ; « parle avec une voix de femme » marche aussi sans IA |
| Piper sur la machine, sans clé | vrai Piper (fichier WAV lu par ffprobe, converti par ffmpeg) | — |
| Serveur Piper lancé à part | vrai serveur `piper-tts[http]` 1.8.0 | Odin parlait à la mauvaise adresse : le serveur actuel synthétise sur `POST /synthesize`, l'ancien veut le texte brut sur `POST /` |
| ElevenLabs avec ta clé | faux serveur (pas de clé ici), d'après la documentation de l'API | liste des voix par `/v2/voices` (l'ancien `/v1/voices` est déprécié) ; une clé suffit (voix prêtes à l'emploi) ; la clé retirée de tout message d'erreur |
| Copie de ta voix avec ton accord | faux serveur ElevenLabs, vrai navigateur | l'accord n'était pas gardé : il est maintenant noté avant l'envoi (`valhalla/bragi/copies/accords.json`, fermé aux outils de fichiers), avec le nom de la personne si ce n'est pas ta voix ; l'accord se retire (la voix est effacée chez ElevenLabs) ; refus en mode 100 % local |
| Réponses en audio sur Telegram | faux serveur Telegram, vrai ffmpeg (Ogg/Opus, un canal) | « à voix haute » (avec l'accent) n'était pas reconnu ; un refus de Telegram n'était pas signalé |
| Réponses en audio sur le web | vrai navigateur (le son est joué jusqu'au bout) | les erreurs de la voix s'affichent sous les boutons « Écouter » |
| Réponse de Pythie en audio | vrai navigateur (page de Pythie), faux Telegram, action « Écouter une réponse » | action et lien Pythie → Orphée ajoutés |

Ce qui n'a pas pu être essayé ici : le vrai service ElevenLabs (pas de clé), la vraie voix « tom » et les voix des
autres langues (elles viennent de HuggingFace, fermé sur la machine d'essai : deux voix françaises publiées sur GitHub
ont tenu leur place), un vrai téléphone.

## OpenVoice : pas branché (décision de novembre 2026)

**Ce que c'est** : `myshell-ai/OpenVoice`, copie instantanée du timbre d'une voix, sous licence MIT (V1 et V2 ; la V2,
d'avril 2024, parle français). Le projet se présente lui-même comme « une technologie, pas un produit », pour
développeurs et chercheurs. Il ne copie que le timbre : l'accent et l'émotion viennent d'une voix de base (MeloTTS).

**Comment on le lance** : il n'y a ni programme en ligne de commande ni serveur officiel, seulement une bibliothèque
Python et des carnets de démonstration (`demo_part3.ipynb`). Il lui faut Python 3.9, PyTorch, des versions anciennes et
figées de ses dépendances (numpy 1.22, librosa 0.9.1…), MeloTTS installé depuis GitHub, et ses modèles à télécharger
(plusieurs Go en tout). Un serveur fait par la communauté existe (`ValyrianTech/OpenVoice_server`), non vérifié.

**Pourquoi il n'est pas branché** :
1. Pas de dépendance lourde dans Odin : PyTorch et ces modèles n'ont pas leur place dans un agent qui se lance sans build.
2. Rien à appeler proprement : sans serveur ni commande officiels, il faudrait écrire et maintenir un pont en Python.
3. Impossible à essayer sur la machine d'essai (ses modèles, PyTorch et HuggingFace y sont fermés, et Python y est en
   3.13) : un branchement jamais essayé serait exactement ce que cette revérification voulait supprimer.

**Ce qu'il faudrait pour le faire** : une machine où il s'installe (idéalement avec une carte graphique) ; un petit
pont HTTP local, écrit et essayé là-bas, avec deux appels (« apprends cette voix à partir d'un enregistrement »,
« convertis ce son vers cette voix ») ; côté Odin, Piper continuerait de parler et son WAV passerait par ce pont.
Le reste est déjà prêt : le registre des accords a un champ `service`, et le dossier `valhalla/bragi/copies/` (où
iraient l'enregistrement et l'empreinte de la voix) est déjà fermé aux outils de fichiers.

**En attendant, sans ElevenLabs** : tout serveur local qui parle comme OpenAI (`/v1/audio/speech`) et sait copier une
voix se règle déjà dans Réglages → Voix → « OpenAI ou serveur local compatible », avec le nom de la voix copiée.
Essayé avec un faux serveur compatible seulement.
