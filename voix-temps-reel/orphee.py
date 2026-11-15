#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Orphée temps réel — le service vocal en direct d'Odin.

Il écoute un flux audio (PCM 16 bits, 16 kHz, mono), sait quand quelqu'un parle (Silero VAD, ou à défaut
un détecteur d'énergie), quand une phrase est finie (Smart Turn, ou à défaut des règles sur le texte),
transcrit en direct (faster-whisper ou whisper.cpp, s'ils sont là), et signale tout de suite quand on coupe
la parole à Odin (soupçon après 150 ms de voix, coupure confirmée en quelques millisecondes de calcul).

Règles :
- Il n'écoute que sur la machine elle-même (127.0.0.1) et demande un jeton à chaque appel : seul Odin lui parle.
- Il ne garde jamais l'audio : l'énoncé en cours vit en mémoire et disparaît au suivant. Pour whisper.cpp, un
  fichier WAV temporaire (droits 600) est écrit puis effacé aussitôt la transcription faite.
- Rien ne sort de la machine : aucun appel réseau, aucun modèle téléchargé par le service lui-même.
- Seule la bibliothèque standard de Python est obligatoire ; numpy + onnxruntime (Silero, Smart Turn) et
  faster-whisper sont facultatifs. Sans eux, le service marche quand même, en mode simple, et le dit (/sante).

Lancement (Odin le fait lui-même) :
    python3 orphee.py --port 7790 --jeton <secret> [--modeles <dossier>] [--whisper-bin <whisper-cli> --whisper-modele <ggml.bin>]
Le jeton peut aussi venir de la variable ORPHEE_JETON (préférable : il n'apparaît pas dans la liste des processus).
"""

import argparse
import array
import io
import json
import math
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

VERSION = "1.0.0"
TAUX = 16000            # échantillons par seconde
TRAME = 512             # 32 ms par trame (taille attendue par Silero à 16 kHz)
MS_TRAME = TRAME * 1000 // TAUX

try:  # facultatif : Silero et Smart Turn
    import numpy as np  # type: ignore
    import onnxruntime as ort  # type: ignore
    ONNX = True
except Exception:  # pragma: no cover - dépend de la machine
    np = None
    ort = None
    ONNX = False


# ---------------------------------------------------------------------------------------------- textes

def plier(t):
    """Minuscules, sans accents, ponctuation en espaces."""
    t = unicodedata.normalize("NFD", (t or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9' ]+", " ", t.replace("’", "'")).strip()


def mots(t):
    return [m for m in re.split(r"[\s']+", plier(t)) if m]


ACQUIESCEMENTS = {"oui", "ouais", "mmh", "mm", "hm", "hmm", "mhm", "hum", "ok", "okay", "d'accord", "daccord", "accord", "ah", "oh", "euh", "bon", "voila", "super", "merci", "exact", "exactement", "vas y", "vas", "y", "carrement", "bien", "sur"}
SUSPENDUS = {"et", "mais", "ou", "donc", "or", "ni", "car", "de", "du", "des", "le", "la", "les", "un", "une", "a", "au", "aux", "en", "pour", "par", "avec", "sans", "sur", "dans", "que", "qui", "quoi", "dont", "si", "comme", "parce", "puis", "alors", "euh", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "ce", "cette", "ces", "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "est", "suis"}


def que_des_acquiescements(texte):
    m = mots(texte)
    return bool(m) and all(x in ACQUIESCEMENTS for x in m)


def contient_mot_arret(texte, arrets):
    t = " %s " % " ".join(mots(texte))
    for a in arrets:
        a2 = " ".join(mots(a))
        if a2 and (" %s " % a2) in t:
            return a
    return None


def phrase_suspendue(texte):
    """Une phrase qui s'arrête sur « et », « parce que », une virgule… : on attend la suite."""
    brut = (texte or "").strip()
    if not brut:
        return False
    if brut.endswith((",", "…", "-", ":")):
        return True
    m = mots(brut)
    return bool(m) and m[-1] in SUSPENDUS


def est_echo(entendu, dit):
    """Ce qu'on entend est-il la voix d'Odin elle-même (le micro capte le haut-parleur) ?"""
    e, d = mots(entendu), set(mots(dit))
    if len(e) < 2 or not d:
        return False
    return sum(1 for x in e if x in d) / len(e) >= 0.6


# ---------------------------------------------------------------------------------------------- audio

def echantillons(pcm):
    a = array.array("h")
    a.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    if sys.byteorder == "big":
        a.byteswap()
    return a


def wav_en_pcm(donnees):
    """Un fichier WAV (16 kHz, mono, 16 bits) → PCM brut. Refuse le reste avec une phrase claire."""
    with wave.open(io.BytesIO(donnees), "rb") as w:
        if w.getframerate() != TAUX or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ValueError("WAV attendu en 16 kHz, mono, 16 bits (reçu : %d Hz, %d canal(aux), %d octet(s))" % (w.getframerate(), w.getnchannels(), w.getsampwidth()))
        return w.readframes(w.getnframes())


def pcm_en_wav(pcm):
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TAUX)
        w.writeframes(pcm)
    return b.getvalue()


class VadEnergie:
    """Détecteur de parole simple : énergie au-dessus du bruit de fond (qui s'adapte lentement)."""
    nom = "énergie"

    def __init__(self, sensibilite=6):
        self.fond = None
        # sensibilité 1 (peu sensible) à 10 (très sensible) → marge au-dessus du bruit de fond, en dB
        self.marge = 24 - 1.6 * max(1, min(10, sensibilite))

    def prob(self, trame):
        a = echantillons(trame)
        if not a:
            return 0.0
        rms = math.sqrt(sum(x * x for x in a) / len(a))
        db = 20 * math.log10(max(rms, 1.0))
        if self.fond is None:
            self.fond = min(db, 40.0)
        p = max(0.0, min(1.0, (db - self.fond - self.marge) / 8 + 0.5))
        # Le fond suit le bruit (vite vers le bas, lentement vers le haut, jamais pendant la parole).
        if p < 0.5:
            self.fond += (db - self.fond) * (0.3 if db < self.fond else 0.02)
        return p


class VadSilero:
    """Silero VAD (modèle ONNX v5/v6) : 512 échantillons + 64 de contexte, état récurrent."""
    nom = "silero"

    def __init__(self, chemin):
        o = ort.SessionOptions()
        o.inter_op_num_threads = 1
        o.intra_op_num_threads = 1
        self.s = ort.InferenceSession(chemin, sess_options=o, providers=["CPUExecutionProvider"])
        self.etat = np.zeros((2, 1, 128), dtype=np.float32)
        self.contexte = np.zeros((1, 64), dtype=np.float32)
        self.sr = np.array(TAUX, dtype=np.int64)

    def prob(self, trame):
        x = np.frombuffer(trame, dtype="<i2").astype(np.float32)[None, :] / 32768.0
        if x.shape[1] != TRAME:
            return 0.0
        x2 = np.concatenate([self.contexte, x], axis=1)
        out, self.etat = self.s.run(None, {"input": x2, "state": self.etat, "sr": self.sr})
        self.contexte = x2[:, -64:]
        return float(out[0][0])


# ------------------------------------------------------------------------------- fin de tour (Smart Turn)

def _filtres_mel(n_fft=400, n_mels=80):
    """Banc de filtres mel « Slaney » (celui de Whisper)."""
    def hz_mel(f):
        f = np.asarray(f, dtype=np.float64)
        lin = f / (200.0 / 3)
        log = 15.0 + np.log(np.maximum(f, 1e-10) / 1000.0) / (np.log(6.4) / 27.0)
        return np.where(f >= 1000.0, log, lin)

    def mel_hz(m):
        m = np.asarray(m, dtype=np.float64)
        lin = (200.0 / 3) * m
        log = 1000.0 * np.exp((np.log(6.4) / 27.0) * (m - 15.0))
        return np.where(m >= 15.0, log, lin)

    freqs = np.linspace(0, TAUX / 2, n_fft // 2 + 1)
    pts = mel_hz(np.linspace(hz_mel(0.0), hz_mel(TAUX / 2), n_mels + 2))
    f = np.zeros((n_mels, n_fft // 2 + 1))
    for i in range(n_mels):
        bas, mil, haut = pts[i], pts[i + 1], pts[i + 2]
        f[i] = np.maximum(0, np.minimum((freqs - bas) / (mil - bas), (haut - freqs) / (haut - mil)))
        f[i] *= 2.0 / (haut - bas)
    return f.astype(np.float32)


def mel_whisper(audio):
    """Spectrogramme log-mel de Whisper (80 bandes, fenêtre 400, pas 160) sur 8 s → (80, 800)."""
    n_fft, pas = 400, 160
    x = np.pad(audio.astype(np.float32), (n_fft // 2, n_fft // 2), mode="reflect")
    fen = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n_fft) / n_fft)).astype(np.float32)
    n = 1 + (len(x) - n_fft) // pas
    trames = np.lib.stride_tricks.as_strided(x, shape=(n, n_fft), strides=(x.strides[0] * pas, x.strides[0]))
    spec = np.abs(np.fft.rfft(trames * fen, axis=1)) ** 2
    mel = _filtres_mel() @ spec[:-1].T
    lg = np.log10(np.maximum(mel, 1e-10))
    lg = np.maximum(lg, lg.max() - 8.0)
    return ((lg + 4.0) / 4.0).astype(np.float32)


class TourSmartTurn:
    """Smart Turn v3 (ONNX) : la phrase est-elle finie ? Lit les 8 dernières secondes de l'énoncé."""
    nom = "smart-turn"

    def __init__(self, chemin):
        self.s = ort.InferenceSession(chemin, providers=["CPUExecutionProvider"])
        self.entree = self.s.get_inputs()[0].name

    def probabilite(self, pcm, _texte):
        a = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        a = a[-8 * TAUX:]
        a = (a - a.mean()) / np.sqrt(a.var() + 1e-7)  # do_normalize, comme l'extracteur de Whisper
        if len(a) < 8 * TAUX:
            a = np.pad(a, (0, 8 * TAUX - len(a)))
        p = float(np.asarray(self.s.run(None, {self.entree: mel_whisper(a)[None, :, :]})[0]).reshape(-1)[0])
        return p if 0.0 <= p <= 1.0 else 1.0 / (1.0 + math.exp(-p))


class TourRegles:
    """Sans modèle : une phrase qui s'arrête sur « et », « parce que »… n'est pas finie."""
    nom = "règles"

    def probabilite(self, _pcm, texte):
        if not (texte or "").strip():
            return 0.4  # rien de lu : on attend le silence réglé
        return 0.15 if phrase_suspendue(texte) else 0.85


# ---------------------------------------------------------------------------------------------- transcription

class SansTranscription:
    nom = "aucune"

    def transcrire(self, _pcm, _invite=""):
        return None


class FasterWhisper:
    nom = "faster-whisper"

    def __init__(self, modele):
        from faster_whisper import WhisperModel  # type: ignore
        self.m = WhisperModel(modele, device="cpu", compute_type="int8")

    def transcrire(self, pcm, invite=""):
        a = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        segs, _ = self.m.transcribe(a, language="fr", initial_prompt=invite or None, vad_filter=False, beam_size=1)
        return " ".join(s.text.strip() for s in segs).strip()


class WhisperCpp:
    """whisper.cpp déjà installé par Odin (whisper-cli) : un WAV temporaire, effacé tout de suite."""
    nom = "whisper.cpp"

    def __init__(self, binaire, modele):
        self.binaire, self.modele = binaire, modele

    def transcrire(self, pcm, invite=""):
        fd, chemin = tempfile.mkstemp(prefix="orphee-", suffix=".wav")
        try:
            os.chmod(chemin, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(pcm_en_wav(pcm))
            args = [self.binaire, "-m", self.modele, "-f", chemin, "-l", "fr", "-nt", "-np"]
            if invite:
                args += ["--prompt", invite[:400]]
            r = subprocess.run(args, capture_output=True, timeout=60)
            texte = r.stdout.decode("utf-8", "replace")
            return re.sub(r"\s+", " ", re.sub(r"\[[^\]]*\]", " ", texte)).strip()
        finally:
            try:
                os.remove(chemin)
            except OSError:
                pass


# ---------------------------------------------------------------------------------------------- session

class Session:
    """
    Une conversation. Le temps est celui de l'audio reçu (nombre d'échantillons), pas l'horloge : les mêmes
    sons donnent toujours les mêmes décisions. Chaque trame de 32 ms passe par la machine à états :
    silence → parole → (fin de parole) → fin de tour ; et, pendant qu'Odin parle : soupçon → coupure.
    """

    def __init__(self, moteurs, config):
        c = config or {}
        self.id = uuid.uuid4().hex[:12]
        self.m = moteurs
        self.vad = VadSilero(moteurs.silero) if moteurs.silero else VadEnergie(int(c.get("sensibilite", 6)))
        self.seuil = float(c.get("seuil", 0.5))
        self.soupcon_ms = int(c.get("soupcon_ms", 150))
        self.confirmer_ms = int(c.get("confirmer_ms", 400))
        self.fin_ms = max(300, min(5000, int(c.get("fin_ms", 1500))))
        self.coupures = bool(c.get("coupures", True))
        self.ignorer_acquiescements = bool(c.get("ignorer_acquiescements", True))
        self.arrets = [str(x) for x in (c.get("mots_arret") or ["stop", "tais-toi", "attends", "Odin"])][:20]
        self.invite = str(c.get("invite", ""))[:600]
        self.verrou = threading.RLock()
        self.abonnes = []
        self.t = 0                 # ms d'audio reçu
        self.reste = b""
        self.voix_ms = 0           # voix continue (tolère une trame muette)
        self.trou = 0
        self.silence_ms = 0
        self.en_parole = False
        self.enonce = bytearray()  # l'énoncé en cours, en mémoire seulement
        self.dernier_enonce = b""
        self.partiel = ""
        self.final_attendu = False
        self.odin = None           # {"segment", "texte", "t0"} quand Odin parle
        self.soupcon = False
        self.coupe = False
        self.echo_dit = False
        self.tour_fini = False
        self.stt_occupe = False
        self.dernier_partiel_t = 0
        self.vu = time.time()

    # -- événements
    def _evt(self, sortie, type_, **donnees):
        e = {"type": type_, "t": self.t}
        e.update(donnees)
        sortie.append(e)
        return e

    def diffuser(self, evts):
        for q in list(self.abonnes):
            for e in evts:
                q.put(e)

    # -- contrôle
    def controle(self, msg):
        sortie = []
        with self.verrou:
            k = msg.get("type")
            if k == "odin_parle":
                self.odin = {"segment": str(msg.get("segment", ""))[:60], "texte": str(msg.get("texte", ""))[:4000], "t0": self.t}
                self.soupcon = self.coupe = self.echo_dit = False
                self.voix_ms = 0
                self._evt(sortie, "odin_parle", segment=self.odin["segment"])
            elif k == "odin_fin":
                if self.odin:
                    self._evt(sortie, "odin_fin", segment=self.odin["segment"])
                self.odin = None
                self.soupcon = self.coupe = False
            elif k == "config":
                if "mots_arret" in msg:
                    self.arrets = [str(x) for x in (msg.get("mots_arret") or [])][:20]
                if "fin_ms" in msg:
                    self.fin_ms = max(300, min(5000, int(msg["fin_ms"])))
                if "invite" in msg:
                    self.invite = str(msg.get("invite", ""))[:600]
                self._evt(sortie, "config")
            elif k == "texte":
                # Un texte provisoire venu d'ailleurs (essais, ou transcription faite par Odin) : mêmes règles.
                self.partiel = str(msg.get("texte", ""))[:2000]
                self._apres_texte(sortie, time.perf_counter())
            else:
                raise ValueError("type de contrôle inconnu : %s" % k)
        self.diffuser(sortie)
        return sortie

    # -- audio
    def audio(self, pcm):
        recu = time.perf_counter()
        sortie = []
        with self.verrou:
            self.vu = time.time()
            donnees = self.reste + pcm
            n = len(donnees) // (TRAME * 2)
            for i in range(n):
                self._trame(donnees[i * TRAME * 2:(i + 1) * TRAME * 2], sortie, recu)
            self.reste = donnees[n * TRAME * 2:]
        self.diffuser(sortie)
        return sortie

    def _trame(self, trame, sortie, recu):
        self.t += MS_TRAME
        voix = self.vad.prob(trame) >= self.seuil
        if voix:
            self.trou = 0
            self.voix_ms += MS_TRAME
            self.silence_ms = 0
        else:
            self.trou += 1
            self.silence_ms += MS_TRAME
            if self.trou > 1:
                self.voix_ms = 0
        if voix and not self.en_parole and self.voix_ms >= 2 * MS_TRAME:
            self.en_parole = True
            self.tour_fini = False
            self.partiel = ""
            self.enonce = bytearray()
            self._evt(sortie, "parole_debut")
        if self.en_parole or voix:
            if len(self.enonce) < 60 * TAUX * 2:  # une minute au plus en mémoire
                self.enonce += trame
        # Pendant qu'Odin parle : soupçon, puis coupure (ou fausse alerte).
        if self.odin and self.coupures and not self.coupe:
            if voix and not self.soupcon and self.voix_ms >= self.soupcon_ms:
                self.soupcon = True
                self._evt(sortie, "soupcon", segment=self.odin["segment"], volume=0.3)
            if self.soupcon and self.voix_ms >= self.confirmer_ms:
                self._decider(sortie, recu, raison="parole")
            if self.soupcon and not self.coupe and self.silence_ms >= 300:
                self.soupcon = False
                self._evt(sortie, "fausse_alerte", segment=self.odin["segment"], volume=1.0)
        # Transcription en direct (en arrière-plan : la trame n'attend jamais).
        if self.en_parole and self.m.stt.nom != "aucune" and self.t - self.dernier_partiel_t >= 700 and not self.stt_occupe:
            self.dernier_partiel_t = self.t
            self._transcrire_fond(bytes(self.enonce), final=False)
        # Fin de parole, puis fin de tour.
        if self.en_parole and self.silence_ms >= 200:
            self.en_parole = False
            self.dernier_enonce = bytes(self.enonce)
            self._evt(sortie, "parole_fin", duree_ms=len(self.enonce) * 1000 // (2 * TAUX))
        if not self.en_parole and not self.tour_fini and self.dernier_enonce and self.odin is None and self.silence_ms >= 200:
            p = self.m.tour.probabilite(self.dernier_enonce, self.partiel)
            court = min(600, self.fin_ms)
            if (p >= 0.5 and self.silence_ms >= court) or self.silence_ms >= self.fin_ms:
                self.tour_fini = True
                self._evt(sortie, "fin_de_tour", probabilite=round(p, 3), methode=self.m.tour.nom, silence_ms=self.silence_ms)
                if self.m.stt.nom != "aucune":
                    self._transcrire_fond(self.dernier_enonce, final=True)

    def _decider(self, sortie, recu, raison):
        """Coupure confirmée, sauf écho de la voix d'Odin ou simple « oui / mmh »."""
        if self.partiel and est_echo(self.partiel, self.odin["texte"]):
            if not self.echo_dit:
                self.echo_dit = True
                self._evt(sortie, "echo_ignore", segment=self.odin["segment"])
            return
        if raison == "parole" and self.ignorer_acquiescements and self.partiel and que_des_acquiescements(self.partiel):
            return
        self.coupe = True
        self._evt(sortie, "coupure", segment=self.odin["segment"], decalage_ms=max(0, self.t - self.odin["t0"]), raison=raison,
                  latence_ms=round((time.perf_counter() - recu) * 1000, 2), texte=self.partiel)

    def _apres_texte(self, sortie, recu):
        if self.odin and self.coupures and not self.coupe:
            arret = contient_mot_arret(self.partiel, self.arrets)
            if arret and not est_echo(self.partiel, self.odin["texte"]):
                self.coupe = True
                self._evt(sortie, "coupure", segment=self.odin["segment"], decalage_ms=max(0, self.t - self.odin["t0"]), raison="mot_arret", mot=arret,
                          latence_ms=round((time.perf_counter() - recu) * 1000, 2), texte=self.partiel)
            elif self.soupcon and self.voix_ms >= self.confirmer_ms:
                self._decider(sortie, recu, raison="parole")

    def _transcrire_fond(self, pcm, final):
        self.stt_occupe = not final

        def tache():
            try:
                texte = self.m.stt.transcrire(pcm, self.invite) or ""
            except Exception as e:  # le service continue, Odin se rabat sur sa propre transcription
                texte = ""
                self.diffuser([{"type": "erreur", "t": self.t, "texte": "transcription : %s" % str(e)[:200]}])
            sortie = []
            with self.verrou:
                if not final:
                    self.stt_occupe = False
                if texte:
                    self.partiel = texte
                    self._evt(sortie, "final" if final else "partiel", texte=texte)
                    if not final:
                        self._apres_texte(sortie, time.perf_counter())
            self.diffuser(sortie)

        threading.Thread(target=tache, daemon=True).start()


class Moteurs:
    def __init__(self, a):
        self.silero = None
        self.tour = TourRegles()
        self.stt = SansTranscription()
        self.raisons = []
        d = a.modeles or ""
        if ONNX and d:
            for n in ("silero_vad.onnx", "silero-vad.onnx", "silero_vad_v6.onnx"):
                if os.path.isfile(os.path.join(d, n)):
                    try:
                        VadSilero(os.path.join(d, n))
                        self.silero = os.path.join(d, n)
                    except Exception as e:
                        self.raisons.append("Silero illisible : %s" % str(e)[:120])
                    break
            for n in ("smart-turn-v3.onnx", "smart-turn-v3.2.onnx", "smart-turn-v3.2-cpu.onnx", "smart-turn.onnx"):
                if os.path.isfile(os.path.join(d, n)):
                    try:
                        self.tour = TourSmartTurn(os.path.join(d, n))
                    except Exception as e:
                        self.raisons.append("Smart Turn illisible : %s" % str(e)[:120])
                    break
        elif not ONNX:
            self.raisons.append("numpy et onnxruntime absents : détection par l'énergie et fin de tour par règles")
        if not self.silero and ONNX:
            self.raisons.append("modèle Silero absent du dossier des modèles")
        if a.faster_whisper and ONNX:
            try:
                self.stt = FasterWhisper(a.faster_whisper)
            except Exception as e:
                self.raisons.append("faster-whisper indisponible : %s" % str(e)[:120])
        if self.stt.nom == "aucune" and a.whisper_bin and a.whisper_modele and os.path.exists(a.whisper_modele):
            self.stt = WhisperCpp(a.whisper_bin, a.whisper_modele)
        if self.stt.nom == "aucune":
            self.raisons.append("pas de transcription en direct : Odin transcrit lui-même l'énoncé à la fin du tour")

    def etat(self):
        return {"vad": "silero" if self.silero else "énergie", "tour": self.tour.nom, "stt": self.stt.nom, "remarques": self.raisons}


# ---------------------------------------------------------------------------------------------- serveur HTTP

class Service:
    def __init__(self, args):
        self.args = args
        self.jeton = os.environ.get("ORPHEE_JETON") or args.jeton or ""
        self.moteurs = Moteurs(args)
        self.sessions = {}
        self.verrou = threading.Lock()
        self.debut = time.time()

    def nettoyer(self):
        """Les sessions muettes depuis 10 minutes s'en vont (et leur audio en mémoire avec elles)."""
        with self.verrou:
            for k in [k for k, s in self.sessions.items() if time.time() - s.vu > 600]:
                del self.sessions[k]


def analyser(moteurs, pcm, config, controles):
    """Passe un enregistrement entier dans une session, trame par trame, avec des contrôles horodatés (essais, diagnostic)."""
    s = Session(moteurs, config)
    evts, a_faire = [], sorted(controles or [], key=lambda c: int(c.get("a_ms", 0)))
    pas = TRAME * 2
    for i in range(0, len(pcm), pas):
        while a_faire and int(a_faire[0].get("a_ms", 0)) <= s.t:
            evts += s.controle(a_faire.pop(0))
        evts += s.audio(pcm[i:i + pas])
    for c in a_faire:
        evts += s.controle(c)
    return evts


def fabriquer_gestionnaire(svc):
    class Gestionnaire(BaseHTTPRequestHandler):
        server_version = "Orphee/" + VERSION
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):  # rien dans les journaux : ni audio, ni texte, ni jeton
            pass

        def _json(self, code, corps):
            b = json.dumps(corps, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(b)))
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(b)

        def _corps(self, maxi):
            n = int(self.headers.get("content-length") or 0)
            if n > maxi:
                raise ValueError("trop gros")
            return self.rfile.read(n) if n else b""

        def _autorise(self):
            if not svc.jeton:
                return True
            j = self.headers.get("x-orphee-jeton", "")
            import hmac
            return hmac.compare_digest(j.encode(), svc.jeton.encode())

        def _route(self, methode):
            u = urlparse(self.path)
            p = [x for x in u.path.split("/") if x]
            if not self._autorise():
                return self._json(401, {"ok": False, "erreur": "jeton refusé"})
            try:
                if methode == "GET" and p == ["sante"]:
                    svc.nettoyer()
                    return self._json(200, {"ok": True, "service": "orphee", "version": VERSION, "depuis_s": int(time.time() - svc.debut), "sessions": len(svc.sessions), **svc.moteurs.etat()})
                if methode == "POST" and p == ["sessions"]:
                    cfg = json.loads(self._corps(64 * 1024) or b"{}")
                    s = Session(svc.moteurs, cfg)
                    with svc.verrou:
                        if len(svc.sessions) >= 16:
                            return self._json(429, {"ok": False, "erreur": "trop de conversations ouvertes"})
                        svc.sessions[s.id] = s
                    return self._json(200, {"ok": True, "id": s.id, "trame_ms": MS_TRAME, "taux": TAUX})
                if methode == "POST" and p == ["analyse"]:
                    q = parse_qs(u.query)
                    corps = self._corps(50 * 1024 * 1024)
                    cfg = json.loads(q.get("config", ["{}"])[0])
                    ctl = json.loads(q.get("controles", ["[]"])[0])
                    pcm = wav_en_pcm(corps) if corps[:4] == b"RIFF" else corps
                    return self._json(200, {"ok": True, "evenements": analyser(svc.moteurs, pcm, cfg, ctl)})
                if len(p) >= 2 and p[0] == "sessions":
                    s = svc.sessions.get(p[1])
                    if not s:
                        return self._json(404, {"ok": False, "erreur": "conversation inconnue"})
                    if methode == "DELETE" and len(p) == 2:
                        with svc.verrou:
                            svc.sessions.pop(p[1], None)
                        return self._json(200, {"ok": True})
                    if methode == "POST" and p[2:] == ["audio"]:
                        return self._json(200, {"ok": True, "evenements": s.audio(self._corps(2 * 1024 * 1024)), "t": s.t})
                    if methode == "POST" and p[2:] == ["controle"]:
                        return self._json(200, {"ok": True, "evenements": s.controle(json.loads(self._corps(64 * 1024) or b"{}"))})
                    if methode == "GET" and p[2:] == ["enonce"]:
                        # Le dernier énoncé, pour qu'Odin le transcrive lui-même (puis il n'est plus gardé ici).
                        with s.verrou:
                            pcm, s.dernier_enonce = s.dernier_enonce, b""
                        b = pcm_en_wav(pcm) if pcm else b""
                        self.send_response(200 if b else 204)
                        self.send_header("content-type", "audio/wav")
                        self.send_header("content-length", str(len(b)))
                        self.send_header("cache-control", "no-store")
                        self.end_headers()
                        if b:
                            self.wfile.write(b)
                        return
                    if methode == "GET" and p[2:] == ["evenements"]:
                        return self._flux(s)
                return self._json(404, {"ok": False, "erreur": "adresse inconnue"})
            except (ValueError, json.JSONDecodeError, wave.Error) as e:
                return self._json(400, {"ok": False, "erreur": str(e)[:300]})

        def _flux(self, s):
            q = queue.Queue()
            s.abonnes.append(q)
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.send_header("cache-control", "no-store")
            self.send_header("connection", "close")
            self.end_headers()
            self.close_connection = True
            try:
                self.wfile.write(b": ok\n\n")
                self.wfile.flush()
                while s.id in svc.sessions:
                    try:
                        e = q.get(timeout=15)
                        self.wfile.write(("data: %s\n\n" % json.dumps(e, ensure_ascii=False)).encode("utf-8"))
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                if q in s.abonnes:
                    s.abonnes.remove(q)

        def do_GET(self):
            self._route("GET")

        def do_POST(self):
            self._route("POST")

        def do_DELETE(self):
            self._route("DELETE")

    return Gestionnaire


def main(argv=None):
    p = argparse.ArgumentParser(description="Orphée temps réel : service vocal en direct d'Odin")
    p.add_argument("--hote", default="127.0.0.1")
    p.add_argument("--port", type=int, default=7790)
    p.add_argument("--jeton", default="")
    p.add_argument("--modeles", default="")
    p.add_argument("--whisper-bin", dest="whisper_bin", default="")
    p.add_argument("--whisper-modele", dest="whisper_modele", default="")
    p.add_argument("--faster-whisper", dest="faster_whisper", default="")
    a = p.parse_args(argv)
    if a.hote not in ("127.0.0.1", "::1", "localhost"):
        print("Orphée n'écoute que sur la machine elle-même (127.0.0.1).", file=sys.stderr)
        return 2
    svc = Service(a)
    srv = ThreadingHTTPServer((a.hote, a.port), fabriquer_gestionnaire(svc))
    srv.daemon_threads = True
    # Une seule ligne au démarrage, lue par Odin (jamais le jeton).
    print(json.dumps({"pret": True, "port": srv.server_address[1], **svc.moteurs.etat()}, ensure_ascii=False), flush=True)
    try:
        srv.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
