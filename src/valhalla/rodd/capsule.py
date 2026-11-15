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
- Seule la bibliothèque standard de Python 3 est utilisée ; pour le micro : arecord, parecord, ffmpeg ou sox
  (sous Windows, le micro du système directement, sans rien installer).
- Sous Windows, « capsule.py veiller » (lancé à l'ouverture de session) attend Ctrl+Espace et lance la dictée.

Commandes :  dicter [--secondes N] [--mode M] [--fichier essai.wav]   ·   etat   ·   essai   ·   regler --mode M   ·   veiller
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

VERSION = "1.1.0"
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
    if s == "Windows":
        return ["winmm"]  # le micro de Windows, lu directement (voir micro_windows)
    return None


def sans_fenetre():
    """Sous Windows, les programmes lancés par la capsule n'ouvrent pas de fenêtre noire."""
    return {"creationflags": 0x08000000} if platform.system() == "Windows" else {}


def journal(texte):
    """Une ligne dans capsule.log (la veille n'a pas de console) ; le fichier reste petit."""
    try:
        f = os.path.join(ICI, "capsule.log")
        if os.path.exists(f) and os.path.getsize(f) > 100000:
            os.replace(f, f + ".1")
        with open(f, "a", encoding="utf-8") as h:
            h.write(time.strftime("%Y-%m-%d %H:%M:%S ") + str(texte)[:500] + "\n")
    except OSError:
        pass


def micro_windows():
    """Le micro de Windows (winmm, rien à installer) : des blocs de 100 ms en PCM 16 bits, 16 kHz, mono."""
    import ctypes
    from ctypes import wintypes

    class FORMAT(ctypes.Structure):
        _fields_ = [("wFormatTag", wintypes.WORD), ("nChannels", wintypes.WORD), ("nSamplesPerSec", wintypes.DWORD), ("nAvgBytesPerSec", wintypes.DWORD), ("nBlockAlign", wintypes.WORD), ("wBitsPerSample", wintypes.WORD), ("cbSize", wintypes.WORD)]

    class ENTETE(ctypes.Structure):
        _fields_ = [("lpData", ctypes.c_void_p), ("dwBufferLength", wintypes.DWORD), ("dwBytesRecorded", wintypes.DWORD), ("dwUser", ctypes.c_size_t), ("dwFlags", wintypes.DWORD), ("dwLoops", wintypes.DWORD), ("lpNext", ctypes.c_void_p), ("reserved", ctypes.c_size_t)]

    w = ctypes.windll.winmm
    P = ctypes.POINTER(ENTETE)
    w.waveInOpen.argtypes = [ctypes.POINTER(ctypes.c_void_p), wintypes.UINT, ctypes.POINTER(FORMAT), ctypes.c_size_t, ctypes.c_size_t, wintypes.DWORD]
    for nom in ("waveInPrepareHeader", "waveInUnprepareHeader", "waveInAddBuffer"):
        getattr(w, nom).argtypes = [ctypes.c_void_p, P, wintypes.UINT]
    for nom in ("waveInStart", "waveInReset", "waveInClose"):
        getattr(w, nom).argtypes = [ctypes.c_void_p]
    fmt = FORMAT(1, 1, TAUX, TAUX * 2, 2, 16, 0)
    h = ctypes.c_void_p()
    if w.waveInOpen(ctypes.byref(h), 0xFFFFFFFF, ctypes.byref(fmt), 0, 0, 0) != 0:
        raise RuntimeError("micro introuvable ou refusé (Paramètres → Confidentialité → Microphone)")
    taille, n = 3200, 8
    tampons = [ctypes.create_string_buffer(taille) for _ in range(n)]
    entetes = [ENTETE(ctypes.cast(t, ctypes.c_void_p), taille, 0, 0, 0, 0, None, 0) for t in tampons]
    t = ctypes.sizeof(ENTETE)
    try:
        for e in entetes:
            w.waveInPrepareHeader(h, ctypes.byref(e), t)
            w.waveInAddBuffer(h, ctypes.byref(e), t)
        w.waveInStart(h)
        i = 0
        while True:
            e = entetes[i]
            attente = time.time()
            while not (e.dwFlags & 1):  # WHDR_DONE
                if time.time() - attente > 3:
                    raise RuntimeError("le micro ne donne plus de son")
                time.sleep(0.01)
            bloc = tampons[i].raw[: e.dwBytesRecorded]
            e.dwFlags &= ~1
            w.waveInAddBuffer(h, ctypes.byref(e), t)
            i = (i + 1) % n
            yield bloc
    finally:
        w.waveInReset(h)
        for e in entetes:
            w.waveInUnprepareHeader(h, ctypes.byref(e), t)
        w.waveInClose(h)


def blocs_micro():
    """Le son du micro, bloc par bloc (100 ms)."""
    cmd = enregistreur()
    if not cmd:
        raise RuntimeError("aucun programme pour le micro (installe arecord, parecord, ffmpeg ou sox)")
    if cmd == ["winmm"]:
        yield from micro_windows()
        return
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, **sans_fenetre())
    try:
        while True:
            bloc = p.stdout.read(3200)
            if not bloc:
                break
            yield bloc
    finally:
        p.terminate()


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
            # La marque d'ordre des octets dit à « clip » que le texte est en UTF-16 (les accents restent justes).
            subprocess.run(["clip"], input=b"\xff\xfe" + texte.encode("utf-16-le"), check=True, **sans_fenetre())
            subprocess.run(["powershell", "-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"], check=True, **sans_fenetre())
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
    son, fond, parle, muet, debut = bytearray(), None, False, 0.0, time.time()
    flux = blocs_micro()
    try:
        for bloc in flux:  # 100 ms
            if time.time() - debut >= secondes:
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
        flux.close()
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


def bip(debut):
    """Un petit son au début et à la fin de l'écoute (Windows)."""
    try:
        import winsound
        winsound.MessageBeep(winsound.MB_OK if debut else winsound.MB_ICONASTERISK)
    except Exception:
        pass


def veiller():
    """Windows : attend Ctrl+Espace (toute la session) et lance une dictée à chaque pression."""
    if platform.system() != "Windows":
        print(json.dumps({"ok": False, "erreur": "la veille sur Ctrl+Espace n'existe que sous Windows (ailleurs : un raccourci du bureau lance « dicter »)"}, ensure_ascii=bool(os.environ.get("ODIN_JSON_ASCII"))))
        return 2
    import ctypes
    from ctypes import wintypes
    k32, u32 = ctypes.windll.kernel32, ctypes.windll.user32
    k32.CreateMutexW.restype = wintypes.HANDLE
    garde = k32.CreateMutexW(None, False, "Local\\OdinEchoCapsule")
    if k32.GetLastError() == 183:  # déjà en veille dans cette session
        return 0
    with open(os.path.join(ICI, "veille.pid"), "w", encoding="utf-8") as f:
        f.write(str(os.getpid()))
    MOD_CONTROL, MOD_NOREPEAT, VK_SPACE, WM_HOTKEY = 0x0002, 0x4000, 0x20, 0x0312
    if not u32.RegisterHotKey(None, 1, MOD_CONTROL | MOD_NOREPEAT, VK_SPACE):
        journal("Ctrl+Espace est déjà pris par un autre programme : veille impossible")
        return 1
    journal("veille sur Ctrl+Espace")
    en_cours, msg = None, wintypes.MSG()
    try:
        while u32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if msg.message == WM_HOTKEY and (en_cours is None or en_cours.poll() is not None):
                en_cours = subprocess.Popen([sys.executable, os.path.abspath(__file__), "dicter"], cwd=ICI, **sans_fenetre())
    finally:
        u32.UnregisterHotKey(None, 1)
        k32.CloseHandle(garde)
    return 0


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
    sous.add_parser("veiller")
    r = sous.add_parser("regler")
    r.add_argument("--mode", default="")
    a = p.parse_args(argv)
    if a.cmd == "etat":
        c = {}
        try:
            c = config()
        except Exception:
            pass
        print(json.dumps({"ok": True, "version": VERSION, "python": platform.python_version(), "systeme": platform.system(), "enregistreur": (enregistreur() or [None])[0], "frappe": frappe(), "odin": c.get("odin", ""), "poste": c.get("poste", ""), "mode": c.get("mode", ""), "configuree": bool(c.get("jeton"))}, ensure_ascii=bool(os.environ.get("ODIN_JSON_ASCII"))))
        return 0
    if a.cmd == "veiller":
        return veiller()
    if a.cmd == "regler":
        c = config()
        if a.mode:
            c["mode"] = a.mode[:20]
        fd = os.open(CONFIG + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(c, f, ensure_ascii=False)
        os.replace(CONFIG + ".tmp", CONFIG)
        print(json.dumps({"ok": True, "mode": c.get("mode", "")}, ensure_ascii=bool(os.environ.get("ODIN_JSON_ASCII"))))
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
            bip(True)
            wav, parle = ecouter(a.secondes)
            bip(False)
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
        journal(e)
        if sys.stderr:
            print("Écho : %s" % e, file=sys.stderr)
        sys.exit(1)
