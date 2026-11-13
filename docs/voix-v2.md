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
