#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Agent de Phénix — la sauvegarde d'un PC du foyer vers Odin.

Installé par Satellites (l'agent du parc d'Odin) dans ~/.odin-phenix/ (Windows : %USERPROFILE%\\.odin-phenix, ou
C:\\ProgramData\\Odin\\phenix quand il tourne avec le compte système). Toutes les heures :
- il relit les dossiers choisis et ne lit que les fichiers qui ont changé (taille, date) ;
- il découpe chaque fichier en morceaux de 1 Mo, demande à Odin ceux qu'il n'a pas encore, et n'envoie que ceux-là ;
- Odin les compresse, les chiffre, les range dans la destination de Phénix et garde les versions (rotation).
Sous Windows, avec les droits administrateur (compte système) : un instantané VSS du disque d'abord, pour lire aussi
les fichiers ouverts tels qu'ils étaient à cet instant ; sans ces droits, un fichier verrouillé est sauté (et compté).
Une restauration demandée dans le navigateur (Phénix → « Restaurer sur le PC ») est faite au passage suivant.

L'agent ne parle qu'à Odin, avec son jeton à lui ; si l'empreinte du certificat d'Odin est connue, il refuse tout
autre serveur. Seule la bibliothèque standard de Python 3 est utilisée.

Commandes :  sauvegarder [--complete]   ·   etat   ·   regler [--profil P] [--dossier D ...]   ·   veiller
"""

import argparse
import hashlib
import http.client
import json
import os
import platform
import re
import ssl
import subprocess
import sys
import time
from urllib.parse import quote, urlparse

VERSION = "1.0.0"
ICI = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(ICI, "agent.json")
ETAT = os.path.join(ICI, "etat.json")
MORCEAU = 1024 * 1024
ASCII = bool(os.environ.get("ODIN_JSON_ASCII"))
# Ce qui ne mérite pas d'être sauvegardé (fichiers provisoires, caches, corbeille).
EXCLUS = [
    r"(^|[\\/])(node_modules|__pycache__|\.cache|\$RECYCLE\.BIN|System Volume Information|\.odin-phenix)([\\/]|$)",
    r"\.(tmp|part|crdownload|odin-part)$",
    r"(^|[\\/])~\$[^\\/]*$",
    r"(^|[\\/])(desktop\.ini|Thumbs\.db|\.DS_Store)$",
]
DOSSIERS_PERSO = ["Documents", "Desktop", "Bureau", "Pictures", "Images", "Music", "Musique", "Videos", "Vidéos", "Movies"]


def dire(o):
    print(json.dumps(o, ensure_ascii=ASCII))
    sys.stdout.flush()


def lire_json(f, defaut):
    try:
        with open(f, "r", encoding="utf-8") as h:
            return json.load(h)
    except (OSError, ValueError):
        return defaut


def ecrire_json(f, o):
    fd = os.open(f + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as h:
        json.dump(o, h, ensure_ascii=False)
    os.replace(f + ".tmp", f)


def journal(texte):
    try:
        f = os.path.join(ICI, "agent.log")
        if os.path.exists(f) and os.path.getsize(f) > 200000:
            os.replace(f, f + ".1")
        with open(f, "a", encoding="utf-8") as h:
            h.write(time.strftime("%Y-%m-%d %H:%M:%S ") + str(texte)[:800] + "\n")
    except OSError:
        pass


def sans_fenetre():
    return {"creationflags": 0x08000000} if platform.system() == "Windows" else {}


def config():
    c = lire_json(CONFIG, None)
    if not c or not c.get("jeton"):
        raise RuntimeError("agent non configuré : réinstalle-le depuis Satellites")
    return c


def dossiers(c):
    if c.get("dossiers"):
        return [os.path.abspath(os.path.expanduser(d)) for d in c["dossiers"]]
    p = c.get("profil") or os.path.expanduser("~")
    return [os.path.join(p, n) for n in DOSSIERS_PERSO if os.path.isdir(os.path.join(p, n))]


def est_admin():
    if platform.system() != "Windows":
        return hasattr(os, "geteuid") and os.geteuid() == 0
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


class Odin:
    """La liaison avec Odin : une connexion gardée ouverte, certificat vérifié par son empreinte."""

    def __init__(self, c):
        self.c, self.conn = c, None

    def ouvrir(self):
        u = urlparse(self.c["odin"])
        hote, port = u.hostname, u.port or (443 if u.scheme == "https" else 80)
        if u.scheme != "https":
            return http.client.HTTPConnection(hote, port, timeout=3600)
        ctx = ssl.create_default_context()
        if self.c.get("empreinte"):
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        conn = http.client.HTTPSConnection(hote, port, timeout=3600, context=ctx)
        conn.connect()
        if self.c.get("empreinte"):
            vu = hashlib.sha256(conn.sock.getpeercert(binary_form=True)).hexdigest()
            if vu.lower() != self.c["empreinte"].lower().replace(":", ""):
                conn.close()
                raise RuntimeError("ce serveur n'est pas Odin (empreinte du certificat différente) : rien n'a été envoyé")
        return conn

    def fermer(self):
        try:
            if self.conn:
                self.conn.close()
        except Exception:
            pass
        self.conn = None

    def appel(self, methode, chemin, corps=b"", entetes=None):
        for essai in range(3):
            try:
                if self.conn is None:
                    self.conn = self.ouvrir()
                h = {"authorization": "Bearer " + self.c["jeton"]}
                h.update(entetes or {})
                self.conn.request(methode, chemin, body=corps, headers=h)
                r = self.conn.getresponse()
                return r.status, r.read()
            except (OSError, http.client.HTTPException) as e:
                self.fermer()
                if essai == 2:
                    raise RuntimeError("Odin injoignable (%s)" % e)
                time.sleep(2 * (essai + 1))

    def json(self, methode, chemin, o=None):
        corps = json.dumps(o, ensure_ascii=False).encode("utf-8") if o is not None else b""
        st, d = self.appel(methode, chemin, corps, {"content-type": "application/json"} if o is not None else {})
        try:
            r = json.loads(d.decode("utf-8"))
        except ValueError:
            raise RuntimeError("réponse illisible d'Odin (HTTP %d)" % st)
        if st != 200 or not r.get("ok"):
            raise RuntimeError(r.get("error") or ("refus d'Odin (HTTP %d)" % st))
        return r


# ---------------- Instantané VSS (Windows) ----------------

def powershell(script, delai=300):
    return subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True, timeout=delai, **sans_fenetre())


def instantane_vss(lecteur):
    """Un instantané VSS du lecteur (« C: ») : (chemin de l'instantané, identifiant), ou None si refusé."""
    r = powershell("$r = Invoke-CimMethod -ClassName Win32_ShadowCopy -MethodName Create -Arguments @{ Volume = '%s\\'; Context = 'ClientAccessible' }; "
                   "if ($r.ReturnValue -ne 0) { exit 5 }; $s = Get-CimInstance Win32_ShadowCopy | Where-Object { $_.ID -eq $r.ShadowID }; "
                   "Write-Output ($s.ID + '|' + $s.DeviceObject)" % lecteur)
    lignes = (r.stdout or "").strip().splitlines()
    if r.returncode != 0 or not lignes or "|" not in lignes[-1]:
        journal("VSS refusé pour %s : %s" % (lecteur, (r.stderr or "").strip()[-300:]))
        return None
    ident, _, dev = lignes[-1].partition("|")
    return dev.strip().rstrip("\\") + "\\", ident.strip()


def supprimer_vss(ident):
    if re.match(r"^\{[0-9A-Fa-f-]{36}\}$", ident):
        powershell("Get-CimInstance Win32_ShadowCopy | Where-Object { $_.ID -eq '%s' } | Remove-CimInstance" % ident, 120)


# ---------------- Chemins longs (Windows) ----------------

def long_ok(p):
    """Sous Windows, un chemin de plus de 260 caractères ne se lit ni ne s'écrit sans le préfixe des chemins longs (chemin absolu).
    Sert seulement aux appels au disque : le chemin noté dans la sauvegarde reste celui de toujours, sans préfixe."""
    if os.name != "nt" or not p or p.startswith("\\\\?\\"):
        return p
    p = os.path.abspath(p)
    return "\\\\?\\UNC\\" + p[2:] if p.startswith("\\\\") else "\\\\?\\" + p


# ---------------- Sauvegarde ----------------

def parcourir(racines, exclus):
    for r in racines:
        # Parcouru avec le préfixe (les dossiers profonds ne sont plus sautés en silence) ; rendu avec le chemin d'origine.
        lr = long_ok(r)
        for base, dirs, fichiers in os.walk(lr):
            base = os.path.join(r, base[len(lr):].lstrip("\\/")) if base != lr else r
            dirs[:] = [d for d in dirs if not any(x.search(os.path.join(base, d)) for x in exclus)]
            for n in fichiers:
                f = os.path.join(base, n)
                if not any(x.search(f) for x in exclus):
                    yield f


def empreintes(chemin):
    shas = []
    with open(long_ok(chemin), "rb") as h:
        while True:
            b = h.read(MORCEAU)
            if not b:
                break
            shas.append(hashlib.sha256(b).hexdigest())
    return shas


def sauvegarder(complete=False):
    c = config()
    e = lire_json(ETAT, {})
    connus = e.get("fichiers") or {}
    o = Odin(c)
    d = o.json("POST", "/api/sindri/agent/debut", {"dernier": e.get("dernier", ""), "version": VERSION, "systeme": platform.system(), "complete": bool(complete), "admin": est_admin()})
    session = quote(d["session"])
    restauration = None
    if d.get("restauration"):
        restauration = restaurer(o, c, d["restauration"])
    entiere = d.get("sorte") == "complète"
    racines = dossiers(c)
    exclus = [re.compile(x, re.I) for x in list(c.get("exclure") or []) + EXCLUS]
    ombres = {}
    if platform.system() == "Windows" and est_admin():
        for r in racines:
            lecteur = os.path.splitdrive(os.path.abspath(r))[0].upper()
            if re.match(r"^[A-Z]:$", lecteur) and lecteur not in ombres:
                v = instantane_vss(lecteur)
                if v:
                    ombres[lecteur] = v

    def lu(f):
        lecteur, reste = os.path.splitdrive(f)
        v = ombres.get(lecteur.upper())
        return v[0] + reste.lstrip("\\/") if v else f

    try:
        present, changes, nouveaux, ouverts = [], [], {}, []
        for f in parcourir(racines, exclus):
            try:
                st = os.stat(long_ok(f))
            except OSError:
                continue
            mt, avant = st.st_mtime_ns / 1e6, connus.get(f)
            if avant and avant[0] == st.st_size and avant[1] == mt:
                present.append(f)
                nouveaux[f] = avant
                if entiere:
                    changes.append(f)
                continue
            try:
                shas = empreintes(lu(f))
            except OSError:
                ouverts.append(f)
                if avant:  # verrouillé : la version d'avant reste la bonne
                    present.append(f)
                    nouveaux[f] = avant
                    if entiere:
                        changes.append(f)
                continue
            present.append(f)
            nouveaux[f] = [st.st_size, mt, shas, st.st_mode & 0o777]
            changes.append(f)
        # Les morceaux qu'Odin n'a pas encore : relus et envoyés un par un (vérifiés, le fichier a pu changer entre-temps).
        ou = {}
        for f in changes:
            for k, s in enumerate(nouveaux[f][2]):
                ou.setdefault(s, (f, k))
        shas, manque = list(ou), []
        for i in range(0, len(shas), 5000):
            manque += o.json("POST", "/api/sindri/agent/manque?session=" + session, {"sha": shas[i:i + 5000]})["manque"]
        abimes, envoyes, octets = set(), 0, 0
        for s in manque:
            f, k = ou[s]
            if f in abimes:
                continue
            try:
                with open(long_ok(lu(f)), "rb") as h:
                    h.seek(k * MORCEAU)
                    b = h.read(MORCEAU)
            except OSError:
                b = b""
            if hashlib.sha256(b).hexdigest() != s:
                abimes.add(f)
                continue
            st, rep = o.appel("POST", "/api/sindri/agent/morceau?session=" + session, b, {"content-type": "application/octet-stream", "x-sha256": s})
            if st != 200:
                raise RuntimeError("morceau refusé par Odin (HTTP %d) : %s" % (st, rep[:200].decode("utf-8", "replace")))
            envoyes += 1
            octets += len(b)
        for f in abimes:  # changé pendant la sauvegarde : la version d'avant, s'il y en a une
            changes.remove(f)
            if f in connus:
                nouveaux[f] = connus[f]
                if entiere:
                    changes.append(f)
            else:
                present.remove(f)
                del nouveaux[f]
        fichiers = [{"path": f, "size": nouveaux[f][0], "mtime": nouveaux[f][1], "mode": nouveaux[f][3] if len(nouveaux[f]) > 3 else 0o644, "sha": nouveaux[f][2]} for f in changes]
        r = o.json("POST", "/api/sindri/agent/fin?session=" + session, {"fichiers": fichiers, "present": present, "racines": racines, "vss": bool(ombres), "sautes": len(ouverts), "ouverts": ouverts[:50], "changes": len(abimes)})
        ecrire_json(ETAT, {"dernier": r["instantane"], "fichiers": nouveaux, "at": time.time()})
    finally:
        for v in ombres.values():
            supprimer_vss(v[1])
        o.fermer()
    res = {"ok": True, "instantane": r["instantane"], "sorte": d.get("sorte"), "fichiers": len(present), "lus": len(fichiers), "envoyes": envoyes, "octets": octets, "vss": bool(ombres), "sautes": len(ouverts)}
    if restauration:
        res["restauration"] = restauration
    journal("sauvegarde %s : %d fichiers, %d morceaux envoyés" % (res["instantane"], len(present), envoyes))
    return res


# ---------------- Restauration ----------------

def dans(chemin, racine):
    a, b = os.path.normcase(os.path.abspath(chemin)), os.path.normcase(os.path.abspath(racine))
    return a == b or a.startswith(b.rstrip("\\/") + os.sep)


def restaurer(o, c, tache):
    """Une restauration demandée dans le navigateur : chaque morceau vient d'Odin et est vérifié avant d'écrire."""
    t = quote(str(tache.get("tache", "")))
    d = o.json("GET", "/api/sindri/agent/restauration?tache=" + t)
    vers = d.get("vers") or ""
    if vers and (re.search(r"[\\/:]|\.\.", vers) or len(vers) > 120):
        raise RuntimeError("dossier de restauration refusé")
    base = os.path.join(c.get("profil") or os.path.expanduser("~"), vers) if vers else ""
    racines = dossiers(c)
    n, erreurs = 0, []
    for f in d.get("fichiers", []):
        p = f["path"]
        if base:
            cible = os.path.join(base, re.sub(r"^([A-Za-z]):", r"\1", p).lstrip("\\/"))
        elif any(dans(p, r) for r in racines):
            cible = p
        else:
            erreurs.append("%s : hors des dossiers sauvegardés" % p)
            continue
        part = cible + ".odin-part"
        try:
            os.makedirs(long_ok(os.path.dirname(cible)), exist_ok=True)
            with open(long_ok(part), "wb") as h:
                for m in f["morceaux"]:
                    st, b = o.appel("GET", "/api/sindri/agent/morceau?tache=%s&id=%s" % (t, quote(m["id"])))
                    if st != 200 or (m.get("sha") and hashlib.sha256(b).hexdigest() != m["sha"]):
                        raise RuntimeError("morceau abîmé ou refusé")
                    h.write(b)
            os.replace(long_ok(part), long_ok(cible))
            ns = int(float(f["mtime"]) * 1e6)
            os.utime(long_ok(cible), ns=(ns, ns))
            n += 1
        except (OSError, RuntimeError) as e:
            erreurs.append("%s : %s" % (p, e))
            try:
                os.remove(long_ok(part))
            except OSError:
                pass
    o.json("POST", "/api/sindri/agent/restauration?tache=" + t, {"fait": n, "erreurs": erreurs[:50]})
    journal("restauration %s : %d fichier(s), %d erreur(s)" % (tache.get("tache"), n, len(erreurs)))
    return {"fichiers": n, "erreurs": len(erreurs), "vers": base or "à leur place"}


# ---------------- Commandes ----------------

def main(argv=None):
    p = argparse.ArgumentParser(description="Agent de Phénix : la sauvegarde de ce PC vers Odin")
    sous = p.add_subparsers(dest="cmd")
    s = sous.add_parser("sauvegarder")
    s.add_argument("--complete", action="store_true")
    e = sous.add_parser("etat")
    e.add_argument("--planification", default="")
    r = sous.add_parser("regler")
    r.add_argument("--profil", default="")
    r.add_argument("--dossier", action="append", default=[])
    sous.add_parser("veiller")
    a = p.parse_args(argv)
    if a.cmd == "sauvegarder":
        dire(sauvegarder(a.complete))
        return 0
    if a.cmd == "etat":
        c = lire_json(CONFIG, {}) or {}
        x = lire_json(ETAT, {})
        dire({"ok": True, "version": VERSION, "python": platform.python_version(), "systeme": platform.system(), "poste": c.get("poste", ""), "odin": c.get("odin", ""),
              "configure": bool(c.get("jeton")), "dossiers": dossiers(c) if c else [], "derniere": x.get("dernier", ""), "fichiers": len(x.get("fichiers") or {}),
              "admin": est_admin(), "vss": platform.system() == "Windows" and est_admin(), "dossier": ICI, **({"planification": a.planification} if a.planification else {})})
        return 0
    if a.cmd == "regler":
        c = lire_json(CONFIG, {}) or {}
        if a.profil:
            c["profil"] = a.profil
        if a.dossier:
            c["dossiers"] = [d for d in a.dossier if d.strip()]
        ecrire_json(CONFIG, c)
        dire({"ok": True, "dossiers": dossiers(c)})
        return 0
    if a.cmd == "veiller":
        # Sans tâche planifiée (ni crontab) : l'agent reste lancé et sauvegarde toutes les heures.
        while True:
            try:
                sauvegarder()
            except Exception as ex:  # on recommence l'heure suivante
                journal("échec : %s" % ex)
            time.sleep(3600)
    p.print_help()
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:
        journal(e)
        if sys.stdout:
            dire({"ok": False, "erreur": str(e)[:300]})
        sys.exit(1)
