# Orphée temps réel — le service vocal en direct d'Odin

Ce dossier contient `orphee.py`, le service qui permet de **parler avec Odin en direct** : il sait quand tu parles,
quand ta phrase est finie, écrit ce que tu dis au fil de l'eau, et signale tout de suite quand tu coupes la parole
à Odin. **Odin le lance lui-même, le surveille et le relance** s'il tombe. S'il n'est pas là (pas de Python, service
en panne), Odin garde la voix habituelle : « maintenir pour parler », whisper.cpp et Piper.

## Ce qu'il fait

| Brique | Avec les modèles | Sans (mode simple, toujours disponible) |
| --- | --- | --- |
| Détection de la parole | **Silero VAD** (ONNX) | énergie du son au-dessus du bruit de fond |
| Fin de phrase | **Smart Turn v3** (ONNX) | règles sur le texte : « et », « parce que », une virgule… = pas fini |
| Texte en direct | **faster-whisper**, sinon **whisper.cpp** déjà installé par Odin | aucun : Odin transcrit l'énoncé lui-même à la fin du tour |
| Coupure d'Odin | soupçon après 150 ms de voix (volume à 30 %), coupure confirmée à 400 ms de voix ou dès un mot d'arrêt (« stop », « attends », « Odin ») | pareil |

- « Oui », « mmh », une toux : trop court pour couper, ou reconnu comme un simple acquiescement → **fausse alerte**, le volume revient.
- La voix d'Odin captée par le micro n'est jamais prise pour toi : le navigateur retire l'écho, et le texte entendu
  est comparé à ce qu'Odin est en train de dire (**écho ignoré**).
- La décision de couper se prend dans la réponse même au morceau de son qui la déclenche (quelques millisecondes de
  calcul, mesurées et rendues dans `latence_ms`) : Odin s'arrête bien en moins de 200 ms.
- Chaque réponse d'Odin est dite **segment par segment** ; quand on le coupe, Odin note le segment et le temps joué,
  et « continue » reprend au premier mot jamais dit (voir `src/voice/reprise.ts`).

## Sécurité et vie privée

- Il n'écoute que sur **127.0.0.1** (il refuse toute autre adresse) et demande un **jeton** à chaque appel ; Odin le
  tire au hasard à chaque lancement et le passe par l'environnement (`ORPHEE_JETON`), jamais en argument.
- Le navigateur ne lui parle jamais : tout passe par Odin, après la vérification de ta session.
- **Aucun audio n'est gardé** : l'énoncé en cours vit en mémoire et disparaît au suivant. Pour whisper.cpp, un WAV
  temporaire (droits 600) est écrit puis effacé dès la transcription faite. (Le réglage « Garder l'audio brut »
  d'Odin est géré côté Odin, jamais ici.)
- Aucun appel réseau, aucun téléchargement : rien ne quitte la machine.
- Rien dans les journaux : ni son, ni texte, ni jeton.

## Installation

Python **3.9 ou plus récent** suffit pour le mode simple (bibliothèque standard seulement). Pour les modèles :

```bash
pip install numpy onnxruntime            # Silero et Smart Turn
pip install faster-whisper               # facultatif : texte en direct plus rapide que whisper.cpp
```

Puis déposer les modèles dans `~/.odin/voice/orphee/` :

- `silero_vad.onnx` : dépôt `snakers4/silero-vad` (dossier `src/silero_vad/data/`) ;
- `smart-turn-v3.onnx` (ou `smart-turn-v3.2-cpu.onnx`) : dépôt `pipecat-ai/smart-turn-v3` sur Hugging Face.

Odin choisit lui-même le Python : `ODIN_PYTHON` s'il est réglé, sinon `python3` / `python` (`py -3` sous Windows).
`ODIN_ORPHEE=0` empêche le lancement automatique ; `ODIN_ORPHEE_PORT` fixe le port (sinon un port libre est pris).

## Lancer à la main (pour essayer)

```bash
ORPHEE_JETON=un-secret python3 orphee.py --port 7790 --modeles ~/.odin/voice/orphee
```

La première ligne écrite est l'état, en JSON (`{"pret": true, "port": 7790, "vad": …, "tour": …, "stt": …}`).

## L'API (réservée à Odin, en-tête `x-orphee-jeton`)

| Appel | Rôle |
| --- | --- |
| `GET /sante` | état et moteurs utilisés |
| `POST /sessions` | ouvre une conversation (réglages : `sensibilite`, `fin_ms`, `coupures`, `mots_arret`, `invite`…) |
| `POST /sessions/<id>/audio` | un morceau de son (PCM 16 bits, 16 kHz, mono) → les événements qu'il déclenche |
| `POST /sessions/<id>/controle` | `{"type":"odin_parle","segment":…,"texte":…}` ou `{"type":"odin_fin"}` |
| `GET /sessions/<id>/evenements` | flux d'événements (texte provisoire et définitif) |
| `GET /sessions/<id>/enonce` | le dernier énoncé en WAV, une seule fois (repli : Odin le transcrit lui-même) |
| `DELETE /sessions/<id>` | ferme la conversation |
| `POST /analyse` | passe un enregistrement entier (WAV) avec des contrôles horodatés : essais et diagnostic |

Événements : `parole_debut`, `parole_fin`, `soupcon`, `fausse_alerte`, `coupure`, `echo_ignore`, `partiel`, `final`,
`fin_de_tour`, `odin_parle`, `odin_fin`. Le temps `t` est celui du son reçu (en ms) : les mêmes sons donnent
toujours les mêmes décisions.

## Ce qui a été essayé

Essais : `test/voix-temps-reel.test.ts` (vrai Python, mode simple : parole, fin de tour, soupçon, fausse alerte,
coupure mesurée sous 200 ms, mot d'arrêt, écho ignoré, jeton exigé ; surveillance et relance par Odin ; repli
quand le service manque). **Silero, Smart Turn et faster-whisper n'ont pas pu être essayés ici** (numpy,
onnxruntime et les modèles ne sont pas installés sur la machine d'essai) : leurs essais sont marqués « sautés »
avec la raison.
