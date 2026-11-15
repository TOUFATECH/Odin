#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Capsule d'Écho — la dictée d'Odin sur un PC du parc.

Installée et réglée par Satellites (l'agent du parc d'Odin) dans ~/.odin-capsule/ ; rien d'autre n'est installé.
Un raccourci clavier du bureau lance « capsule.py dicter » : la capsule écoute le micro, s'arrête quand tu te tais,
envoie le son à Odin (sur le réseau de la maison seulement), et tape le texte reçu là où se trouve le curseur
(ou le met dans le presse-papiers si la frappe n'est pas possible).

- Le son ne touche jamais le disque : il reste en mémoire le temps de l'envoi.
- La capsule ne parle qu'à Odin, avec son jeton à elle ; si l'empreinte du certificat d'Odin est connue, la
  connexion est refusée avec tout autre serveur.
- Seule la bibliothèque standard de Python 3 est utilisée ; pour le micro : arecord, parecord, ffmpeg ou sox.

Commandes :  dicter [--secondes N] [--mode M] [--fichier essai.wav]   ·   etat   ·   essai   ·   regler --mode M
"""

import argparse
import array
import hashlib
import io
import json
import math
import os
import platform
import shutil
import socket
import ssl
import subprocess
import sys
import time
import wave
from urllib.parse import urlencode, urlparse
import http.client

VERSION = "1.0.0"
ICI = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(ICI, "capsule.json")
TAUX = 16000


def config():
    with open(CONFIG, "r", encoding="utf-8") as f:
        return json.load(f)


def enregistreur():
    """La commande qui sort le son du micro en PCM 16 bits, 16 kHz, mono, sur sa sortie standard."""
    c = {}
    try:
        c = config()
    except Exception:
        pass
    if c.get("enregistreur"):
        return c["enregistreur"]
    s = platform.system()
    if s == "Linux":
        if shutil.which("parecord"):
            return ["parecord", "--raw", "--format=s16le", "--rate=16000", "--channels=1"]
        if shutil.which("arecord"):
            return ["arecord", "-q", "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw"]
    if s == "Darwin" and shutil.which("ffmpeg"):
        return ["ffmpeg", "-loglevel", "quiet", "-f", "avfoundation", "-i", ":0", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]
    if shutil.which("sox"):
        return ["sox", "-q", "-d", "-t", "raw", "-r", "16000", "-c", "1", "-b", "16", "-e", "signed-integer", "-"]
    if shutil.which("ffmpeg") and s == "Linux":
        return ["ffmpeg", "-loglevel", "quiet", "-f", "pulse", "-i", "default", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]
    return None


def frappe():
    """Comment écrire le texte : taper (wtype, xdotool, osascript, SendKeys) ou, à défaut, le presse-papiers."""
    s = platform.system()
    if s == "Linux":
        if os.environ.get("WAYLAND_DISPLAY") and shutil.which("wtype"):
            return "wtype"
        if shutil.which("xdotool"):
            return "xdotool"
        for p in ("wl-copy", "xclip", "xsel"):
            if shutil.which(p):
                return p
    if s == "Darwin":
        return "osascript"
    if s == "Windows":
        return "sendkeys"
    return "aucune"


def ecrire(texte):
    m = frappe()
    try:
        if m == "wtype":
            subprocess.run(["wtype", "--", texte], check=True)
        elif m == "xdotool":
            subprocess.run(["xdotool", "type", "--clearmodifiers", "--", texte], check=True)
        elif m in ("wl-copy",):
            subprocess.run(["wl-copy"], input=texte.encode("utf-8"), check=True)
        elif m == "xclip":
            subprocess.run(["xclip", "-selection", "clipboard"], input=texte.encode("utf-8"), check=True)
        elif m == "xsel":
            subprocess.run(["xsel", "--clipboard", "--input"], input=texte.encode("utf-8"), check=True)
        elif m == "osascript":
            subprocess.run(["pbcopy"], input=texte.encode("utf-8"), check=True)
            subprocess.run(["osascript", "-e", 'tell application "System Events" to keystroke "v" using command down'], check=True)
        elif m == "sendkeys":
            subprocess.run(["clip"], input=texte.encode("utf-16-le"), check=True)
            subprocess.run(["powershell", "-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"], check=True)
        else:
            return False
        return True
    except Exception:
        return False


def niveau(pcm):
    a = array.array("h")
    a.frombytes(pcm[: len(pcm) - len(pcm) % 2])
    if sys.byteorder == "big":
        a.byteswap()
    return 20 * math.log10(max(1.0, math.sqrt(sum(x * x for x in a) / max(1, len(a)))))


def ecouter(secondes, silence_s=1.2):
    """Écoute le micro jusqu'au silence (ou `secondes` au plus). Le son reste en mémoire."""
    cmd = enregistreur()
    if not cmd:
        raise RuntimeError("aucun programme pour le micro (installe arecord, parecord, ffmpeg ou sox)")
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    son, fond, parle, muet, debut = bytearray(), None, False, 0.0, time.time()
    try:
        while time.time() - debut < secondes:
            bloc = p.stdout.read(3200)  # 100 ms
            if not bloc:
                break
            son += bloc
            db = niveau(bloc)
            fond = db if fond is None else min(fond + 0.05, db) if not parle else fond
            if db > (fond or 0) + 12:
                parle, muet = True, 0.0
            elif parle:
                muet += 0.1
                if muet >= silence_s:
                    break
    finally:
        p.terminate()
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TAUX)
        w.writeframes(bytes(son))
    return b.getvalue(), parle


def connexion(c):
    u = urlparse(c["odin"])
    hote, port = u.hostname, u.port or (443 if u.scheme == "https" else 80)
    if u.scheme != "https":
        return http.client.HTTPConnection(hote, port, timeout=60)
    ctx = ssl.create_default_context()
    if c.get("empreinte"):
        # Certificat d'Odin auto-signé : on vérifie son empreinte nous-mêmes (pas d'autorité, pas d'autre serveur).
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    conn = http.client.HTTPSConnection(hote, port, timeout=60, context=ctx)
    conn.connect()
    if c.get("empreinte"):
        vu = hashlib.sha256(conn.sock.getpeercert(binary_form=True)).hexdigest()
        if vu.lower() != c["empreinte"].lower().replace(":", ""):
            conn.close()
            raise RuntimeError("ce serveur n'est pas Odin (empreinte du certificat différente) : rien n'a été envoyé")
    return conn


def envoyer(c, wav, mode):
    conn = connexion(c)
    q = urlencode({"mode": mode or c.get("mode", "corrigé")})
    conn.request("POST", "/api/rodd/capsule?" + q, body=wav, headers={"authorization": "Bearer " + c["jeton"], "content-type": "audio/wav", "x-odin-poste": c.get("poste", "")[:60]})
    r = conn.getresponse()
    corps = r.read()
    conn.close()
    try:
        d = json.loads(corps.decode("utf-8"))
    except Exception:
        raise RuntimeError("réponse illisible d'Odin (HTTP %d)" % r.status)
    if r.status != 200 or not d.get("ok"):
        raise RuntimeError(d.get("error") or ("refus d'Odin (HTTP %d)" % r.status))
    return d


def main(argv=None):
    p = argparse.ArgumentParser(description="Capsule d'Écho : la dictée d'Odin sur ce poste")
    sous = p.add_subparsers(dest="cmd")
    d = sous.add_parser("dicter")
    d.add_argument("--secondes", type=float, default=30)
    d.add_argument("--mode", default="")
    d.add_argument("--fichier", default="", help="envoyer ce fichier WAV au lieu d'écouter le micro (essai)")
    d.add_argument("--afficher", action="store_true", help="écrire le texte ici au lieu de le taper (essai)")
    sous.add_parser("etat")
    sous.add_parser("essai")
    r = sous.add_parser("regler")
    r.add_argument("--mode", default="")
    a = p.parse_args(argv)
    if a.cmd == "etat":
        c = {}
        try:
            c = config()
        except Exception:
            pass
        print(json.dumps({"ok": True, "version": VERSION, "python": platform.python_version(), "systeme": platform.system(), "enregistreur": (enregistreur() or [None])[0], "frappe": frappe(), "odin": c.get("odin", ""), "poste": c.get("poste", ""), "mode": c.get("mode", ""), "configuree": bool(c.get("jeton"))}, ensure_ascii=False))
        return 0
    if a.cmd == "regler":
        c = config()
        if a.mode:
            c["mode"] = a.mode[:20]
        fd = os.open(CONFIG + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(c, f, ensure_ascii=False)
        os.replace(CONFIG + ".tmp", CONFIG)
        print(json.dumps({"ok": True, "mode": c.get("mode", "")}, ensure_ascii=False))
        return 0
    if a.cmd == "essai":
        c = config()
        try:
            conn = connexion(c)
            conn.close()
            print(json.dumps({"ok": True, "odin": c["odin"]}, ensure_ascii=False))
            return 0
        except (OSError, socket.error, RuntimeError) as e:
            print(json.dumps({"ok": False, "erreur": str(e)[:200]}, ensure_ascii=False))
            return 1
    if a.cmd == "dicter":
        c = config()
        if a.fichier:
            with open(a.fichier, "rb") as f:
                wav, parle = f.read(), True
        else:
            wav, parle = ecouter(a.secondes)
        if not parle:
            print("(rien entendu)")
            return 1
        r = envoyer(c, wav, a.mode)
        texte = r.get("texte", "")
        if texte and (a.afficher or not ecrire(texte)):
            print(texte)
        return 0
    p.print_help()
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:
        print("Écho : %s" % e, file=sys.stderr)
        sys.exit(1)
