#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compagnon d'Odin — le petit agent d'Odin sur un ordinateur du parc (Windows, Linux, macOS).

Installé par Satellites (à distance) ou par Genèse (à la fin d'une installation par le réseau). Il :
  - montre l'icône d'Odin près de l'horloge (Windows ; Linux avec « yad ») et les bulles d'Odin (notifications) ;
  - analyse l'ordinateur avec les signatures d'Asclépios (à la demande et chaque jour), met à l'écart ce qui est
    reconnu à coup sûr, et remonte les résultats à Odin ;
  - garde le système à jour DANS SA VERSION (jamais de changement de version majeure) : Windows Update et winget,
    apt / dnf / zypper, softwareupdate ;
  - envoie à Odin la liste des logiciels installés (nom, version) : Odin la compare aux failles connues ;
  - affiche ce qu'Odin a à dire à la personne de ce poste (conseils, étapes à suivre).

Il ne parle qu'à Odin, avec son jeton à lui ; si l'empreinte du certificat d'Odin est connue, toute connexion à un
autre serveur est refusée. Seule la bibliothèque standard de Python 3 est utilisée.

Commandes : etat · tourner (le service) · session (bulles et icône, dans la session de la personne) · rapport ·
            analyser [--chemin D …] · majs [--appliquer] · bulle TEXTE · lire-majs --gestionnaire G --fichier F
"""

import argparse
import hashlib
import http.client
import json
import os
import platform
import plistlib
import shutil
import socket
import ssl
import subprocess
import sys
import time
import uuid
from urllib.parse import urlencode, urlparse

VERSION = "1.0.0"
ICI = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(ICI, "compagnon.json")
ETAT = os.path.join(ICI, "etat")
DEMANDES = os.path.join(ICI, "demandes")
QUARANTAINE = os.path.join(ETAT, "quarantaine")
SIGNATURES = os.path.join(ETAT, "signatures.bin")
SYSTEME = platform.system()  # « Windows », « Linux », « Darwin »
EICAR = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
TAILLE_MAX = 200 * 1024 * 1024


def config():
    with open(CONFIG, "r", encoding="utf-8") as f:
        return json.load(f)


def ecrire_json(chemin, donnee, droits=0o600):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    fd = os.open(chemin + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, droits)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(donnee, f, ensure_ascii=False)
    os.replace(chemin + ".tmp", chemin)
    try:
        os.chmod(chemin, droits)
    except OSError:
        pass


def lire_json(chemin, defaut):
    try:
        with open(chemin, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return defaut


def sortie(cmd, delai=600, entree=None):
    """Lance une commande ; rend (code, texte). Jamais d'exception."""
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=delai, input=entree, env=dict(os.environ, LC_ALL="C", LANG="C", DEBIAN_FRONTEND="noninteractive"))
        return r.returncode, (r.stdout or b"").decode("utf-8", "replace") + (r.stderr or b"").decode("utf-8", "replace")
    except (OSError, subprocess.SubprocessError) as e:
        return 127, str(e)


def powershell(script, delai=1800):
    return sortie(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], delai)


# ---------------------------------------------------------------- Le système, exactement
def systeme():
    s = {"famille": {"Windows": "windows", "Linux": "linux", "Darwin": "mac"}.get(SYSTEME, "autre"), "arch": platform.machine(), "noyau": platform.release(), "nom": platform.node()[:63]}
    if SYSTEME == "Windows":
        try:
            import winreg
            k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
            def v(n):
                try:
                    return winreg.QueryValueEx(k, n)[0]
                except OSError:
                    return ""
            build, ubr = str(v("CurrentBuild")), v("UBR")
            nom = str(v("ProductName"))
            if build.isdigit() and int(build) >= 22000:
                nom = nom.replace("Windows 10", "Windows 11")
            s.update({"systeme": nom, "version": str(v("DisplayVersion")), "build": "%s.%s" % (build, ubr)})
        except Exception:
            s.update({"systeme": "Windows", "version": platform.version(), "build": platform.version()})
    elif SYSTEME == "Darwin":
        c, ver = sortie(["sw_vers", "-productVersion"])
        c2, b = sortie(["sw_vers", "-buildVersion"])
        s.update({"systeme": "macOS", "version": ver.strip(), "build": b.strip()})
    else:
        osr = {}
        try:
            with open("/etc/os-release", encoding="utf-8") as f:
                for l in f:
                    if "=" in l:
                        k, v = l.rstrip("\n").split("=", 1)
                        osr[k] = v.strip('"')
        except OSError:
            pass
        s.update({"systeme": osr.get("NAME", "Linux"), "version": osr.get("VERSION_ID", ""), "build": osr.get("VERSION", osr.get("PRETTY_NAME", "")), "id": osr.get("ID", "")})
    try:
        t, _, l = shutil.disk_usage(os.environ.get("SystemDrive", "C:") + "\\" if SYSTEME == "Windows" else "/")
        s["disque"] = round(100 * (t - l) / t)
    except OSError:
        pass
    return s


# ---------------------------------------------------------------- Les logiciels installés
def applis():
    out = []
    if SYSTEME == "Windows":
        try:
            import winreg
            for racine, chemin in ((winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"), (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")):
                try:
                    k = winreg.OpenKey(racine, chemin)
                except OSError:
                    continue
                for i in range(winreg.QueryInfoKey(k)[0]):
                    try:
                        sk = winreg.OpenKey(k, winreg.EnumKey(k, i))
                        nom = winreg.QueryValueEx(sk, "DisplayName")[0]
                        try:
                            ver = winreg.QueryValueEx(sk, "DisplayVersion")[0]
                        except OSError:
                            ver = ""
                        try:
                            ed = winreg.QueryValueEx(sk, "Publisher")[0]
                        except OSError:
                            ed = ""
                        out.append({"nom": str(nom)[:120], "version": str(ver)[:40], "editeur": str(ed)[:80]})
                    except OSError:
                        continue
        except ImportError:
            pass
    elif SYSTEME == "Darwin":
        for d in ("/Applications", "/Applications/Utilities"):
            try:
                noms = os.listdir(d)
            except OSError:
                continue
            for n in noms:
                if not n.endswith(".app"):
                    continue
                try:
                    with open(os.path.join(d, n, "Contents", "Info.plist"), "rb") as f:
                        p = plistlib.load(f)
                    out.append({"nom": str(p.get("CFBundleName") or n[:-4])[:120], "version": str(p.get("CFBundleShortVersionString", ""))[:40], "editeur": str(p.get("CFBundleIdentifier", ""))[:80]})
                except Exception:
                    continue
    else:
        if shutil.which("dpkg-query"):
            c, t = sortie(["dpkg-query", "-W", "-f", "${Package}\t${Version}\n"], 60)
        elif shutil.which("rpm"):
            c, t = sortie(["rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\n"], 60)
        else:
            c, t = 1, ""
        if c == 0:
            for l in t.splitlines():
                if "\t" in l:
                    n, v = l.split("\t", 1)
                    out.append({"nom": n.strip()[:120], "version": v.strip()[:40]})
    vus, propre = set(), []
    for a in out:
        k = (a["nom"].lower(), a["version"])
        if a["nom"] and k not in vus:
            vus.add(k)
            propre.append(a)
    return propre[:5000]


# ---------------------------------------------------------------- Mises à jour (dans la version du système)
def lire_majs(gestionnaire, texte):
    """Lit la sortie d'un gestionnaire de paquets ; rend [{nom, version, nouvelle}]. Pur (essayé par Odin)."""
    out = []
    if gestionnaire == "apt":
        for l in texte.splitlines():
            # paquet/suite 1.2-3 amd64 [upgradable from: 1.2-1]
            if "/" in l and "[upgradable from:" in l:
                nom = l.split("/", 1)[0]
                parts = l.split()
                out.append({"nom": nom, "nouvelle": parts[1] if len(parts) > 1 else "", "version": l.rsplit("from:", 1)[1].strip(" ]")})
    elif gestionnaire in ("dnf", "yum"):
        for l in texte.splitlines():
            p = l.split()
            if len(p) == 3 and "." in p[0] and not l.startswith(("Last metadata", "Obsoleting", "Security:")) and p[1][:1].isdigit():
                out.append({"nom": p[0].rsplit(".", 1)[0], "nouvelle": p[1], "version": ""})
    elif gestionnaire == "zypper":
        for l in texte.splitlines():
            p = [x.strip() for x in l.split("|")]
            if len(p) >= 6 and p[0] == "v":
                out.append({"nom": p[2], "version": p[3], "nouvelle": p[4]})
    elif gestionnaire == "softwareupdate":
        label = None
        for l in texte.splitlines():
            l = l.strip()
            if l.startswith("* Label:"):
                label = l.split(":", 1)[1].strip()
            elif l.startswith("Title:") and label:
                champs = dict((x.split(":", 1)[0].strip(), x.split(":", 1)[1].strip()) for x in l.split(",") if ":" in x)
                out.append({"nom": champs.get("Title", label), "nouvelle": champs.get("Version", ""), "version": "", "label": label, "redemarrage": champs.get("Action", "") == "restart"})
                label = None
    elif gestionnaire == "winget":
        lignes = texte.splitlines()
        tete = next((i for i, l in enumerate(lignes) if "Id" in l and ("Version" in l) and ("Available" in l or "Disponible" in l)), None)
        if tete is not None:
            h = lignes[tete]
            cols = [h.index(x) for x in ("Id", "Version")] + [h.index("Available") if "Available" in h else h.index("Disponible")]
            fin_src = h.index("Source") if "Source" in h else None
            for l in lignes[tete + 2:]:
                if not l.strip() or l.startswith("-") or len(l) < cols[2]:
                    continue
                if "upgrades available" in l or "mises à niveau disponibles" in l:
                    break
                nom = l[:cols[0]].strip()
                pid = l[cols[0]:cols[1]].strip()
                ver = l[cols[1]:cols[2]].strip()
                nouv = (l[cols[2]:fin_src] if fin_src else l[cols[2]:]).strip()
                if pid and nouv:
                    out.append({"nom": nom or pid, "id": pid, "version": ver, "nouvelle": nouv})
    elif gestionnaire == "windows-update":
        try:
            for x in json.loads(texte or "[]"):
                out.append({"nom": str(x.get("titre", ""))[:160], "nouvelle": str(x.get("kb", "")), "version": "", "securite": bool(x.get("securite"))})
        except ValueError:
            pass
    return out


def winget():
    """winget, même quand le compagnon tourne comme service (compte SYSTEM, sans winget dans le PATH)."""
    w = shutil.which("winget")
    if w:
        return w
    base = os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "WindowsApps")
    try:
        ds = sorted([d for d in os.listdir(base) if d.startswith("Microsoft.DesktopAppInstaller_") and "x64" in d], reverse=True)
        for d in ds:
            f = os.path.join(base, d, "winget.exe")
            if os.path.exists(f):
                return f
    except OSError:
        pass
    return None


# Windows Update par son interface COM : les mises à jour logicielles sans les « mises à niveau » (qui changeraient
# la version de Windows).
WU_CHERCHER = r"""$ErrorActionPreference='Stop'
$s=(New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
$r=$s.Search("IsInstalled=0 and Type='Software' and IsHidden=0")
$l=@(); foreach($u in $r.Updates){ $cat=@($u.Categories|ForEach-Object{$_.Name}); if($cat -contains 'Upgrades'){continue}; $l+=@{titre=$u.Title;kb=(@($u.KBArticleIDs) -join ',');securite=($cat -contains 'Security Updates' -or $cat -contains 'Critical Updates')} }
ConvertTo-Json -Compress -InputObject @($l)"""
WU_INSTALLER = r"""$ErrorActionPreference='Stop'
$se=New-Object -ComObject Microsoft.Update.Session; $s=$se.CreateUpdateSearcher()
$r=$s.Search("IsInstalled=0 and Type='Software' and IsHidden=0")
$c=New-Object -ComObject Microsoft.Update.UpdateColl
foreach($u in $r.Updates){ $cat=@($u.Categories|ForEach-Object{$_.Name}); if($cat -contains 'Upgrades'){continue}; if(-not $u.EulaAccepted){$u.AcceptEula()}; [void]$c.Add($u) }
if($c.Count -eq 0){ '{"installees":0,"redemarrage":false}'; exit 0 }
$d=$se.CreateUpdateDownloader(); $d.Updates=$c; [void]$d.Download()
$i=$se.CreateUpdateInstaller(); $i.Updates=$c; $x=$i.Install()
ConvertTo-Json -Compress -InputObject @{installees=$c.Count;resultat=$x.ResultCode;redemarrage=$x.RebootRequired}"""


def gestionnaires():
    if SYSTEME == "Windows":
        return [g for g, ok in (("windows-update", True), ("winget", bool(winget()))) if ok]
    if SYSTEME == "Darwin":
        return ["softwareupdate"]
    for g in ("apt", "dnf", "zypper"):
        if shutil.which("apt-get" if g == "apt" else g):
            return [g]
    return []


def redemarrage_attendu():
    if SYSTEME == "Linux":
        if os.path.exists("/var/run/reboot-required"):
            return True
        if shutil.which("needs-restarting"):
            return sortie(["needs-restarting", "-r"], 60)[0] == 1
    if SYSTEME == "Windows":
        c, t = powershell("(New-Object -ComObject Microsoft.Update.SystemInfo).RebootRequired", 60)
        return t.strip().lower() == "true"
    return False


def majs_en_attente():
    tout = []
    for g in gestionnaires():
        if g == "apt":
            sortie(["apt-get", "update", "-qq"], 900)
            c, t = sortie(["apt", "list", "--upgradable"], 120)
        elif g == "dnf":
            c, t = sortie(["dnf", "-q", "check-update"], 900)
        elif g == "zypper":
            c, t = sortie(["zypper", "-q", "-n", "lu"], 900)
        elif g == "softwareupdate":
            c, t = sortie(["softwareupdate", "-l"], 900)
        elif g == "winget":
            c, t = sortie([winget(), "upgrade", "--include-unknown", "--accept-source-agreements", "--disable-interactivity"], 300)
        else:
            c, t = powershell(WU_CHERCHER, 900)
        for x in lire_majs(g, t):
            x["gestionnaire"] = g
            tout.append(x)
    return tout


def version_majeure(v):
    return (v or "").split(".")[0]


def appliquer_majs():
    """Installe les mises à jour, sans jamais changer de version majeure du système. Rend le bilan."""
    bilan = []
    for g in gestionnaires():
        if g == "apt":
            sortie(["apt-get", "update", "-qq"], 900)
            c, t = sortie(["apt-get", "-y", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold", "upgrade"], 3600)
        elif g == "dnf":
            c, t = sortie(["dnf", "-y", "upgrade", "--refresh"], 3600)
        elif g == "zypper":
            c, t = sortie(["zypper", "-n", "up"], 3600)
        elif g == "softwareupdate":
            courante = version_majeure(systeme().get("version", ""))
            c, t = 0, ""
            for x in lire_majs("softwareupdate", sortie(["softwareupdate", "-l"], 900)[1]):
                titre = x.get("nom", "")
                if titre.startswith("macOS") and version_majeure(x.get("nouvelle", "")) not in ("", courante):
                    continue  # nouvelle version majeure de macOS : jamais toute seule
                c2, t2 = sortie(["softwareupdate", "-i", x["label"]], 3600)
                c, t = (c or c2), t + t2
        elif g == "winget":
            c, t = sortie([winget(), "upgrade", "--all", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], 3600)
        else:
            c, t = powershell(WU_INSTALLER, 7200)
        bilan.append({"gestionnaire": g, "ok": c == 0, "fin": t.strip()[-400:]})
    return {"bilan": bilan, "redemarrage": redemarrage_attendu(), "t": int(time.time() * 1000)}


# ---------------------------------------------------------------- Antivirus (signatures d'Asclépios)
class Signatures:
    """Les empreintes SHA-256 des malwares connus (32 octets chacune, triées) : recherche par dichotomie, sans tout charger en objets."""

    def __init__(self, chemin=SIGNATURES):
        try:
            with open(chemin, "rb") as f:
                self.b = f.read()
        except OSError:
            self.b = b""
        self.n = len(self.b) // 32

    def __contains__(self, h):
        lo, hi = 0, self.n
        while lo < hi:
            m = (lo + hi) // 2
            x = self.b[m * 32:(m + 1) * 32]
            if x < h:
                lo = m + 1
            elif x > h:
                hi = m
            else:
                return True
        return False


def dossiers_a_analyser(c):
    if c.get("dossiers"):
        return [d for d in c["dossiers"] if os.path.isdir(d)]
    out = []
    if SYSTEME == "Windows":
        racine = os.path.join(os.environ.get("SystemDrive", "C:") + "\\", "Users")
        try:
            for u in os.listdir(racine):
                for s in ("Downloads", "Desktop", "Documents", os.path.join("AppData", "Local", "Temp")):
                    out.append(os.path.join(racine, u, s))
        except OSError:
            pass
        out.append(os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "Temp"))
    else:
        for r in ("/home", "/Users"):
            try:
                for u in os.listdir(r):
                    for s in ("Downloads", "Téléchargements", "Desktop", "Bureau", "Documents"):
                        out.append(os.path.join(r, u, s))
            except OSError:
                pass
        out += ["/tmp", "/var/tmp"]
    return [d for d in out if os.path.isdir(d)]


def empreinte(chemin):
    h = hashlib.sha256()
    tete = b""
    with open(chemin, "rb") as f:
        while True:
            b = f.read(1024 * 1024)
            if not b:
                break
            if len(tete) < 256:
                tete += b[:256]
            h.update(b)
    return h.digest(), tete


def analyser(c, chemins=None, mettre_a_l_ecart=True):
    sig, debut, vus, trouves, illisibles = Signatures(), time.time(), 0, [], 0
    for racine in chemins or dossiers_a_analyser(c):
        for d, sous, fichiers in os.walk(racine):
            sous[:] = [x for x in sous if not os.path.islink(os.path.join(d, x)) and os.path.abspath(os.path.join(d, x)) != os.path.abspath(ICI)]
            for n in fichiers:
                f = os.path.join(d, n)
                try:
                    if os.path.islink(f) or os.path.getsize(f) > TAILLE_MAX:
                        continue
                    h, tete = empreinte(f)
                except OSError:
                    illisibles += 1
                    continue
                vus += 1
                quoi = "EICAR (fichier d'essai d'antivirus)" if tete.startswith(EICAR) else ("malware connu (signatures d'Asclépios)" if h in sig else None)
                if quoi:
                    x = {"fichier": f, "sha256": h.hex(), "quoi": quoi, "ecarte": False}
                    if mettre_a_l_ecart and c.get("quarantaine", True):
                        x["ecarte"] = ecarter(f, h.hex())
                    trouves.append(x)
    return {"t": int(time.time() * 1000), "fichiers": vus, "illisibles": illisibles, "duree": round(time.time() - debut, 1), "detections": trouves, "signatures": Signatures().n}


def ecarter(f, h):
    """Met le fichier à l'écart (déplacé, plus exécutable) ; Odin peut le remettre à sa place."""
    try:
        os.makedirs(QUARANTAINE, mode=0o700, exist_ok=True)
        dest = os.path.join(QUARANTAINE, h[:16] + "-" + uuid.uuid4().hex[:8] + ".quarantaine")
        shutil.move(f, dest)
        try:
            os.chmod(dest, 0o000)
        except OSError:
            pass
        l = lire_json(os.path.join(ETAT, "quarantaine.json"), [])
        l.append({"origine": f, "ici": dest, "sha256": h, "t": int(time.time() * 1000)})
        ecrire_json(os.path.join(ETAT, "quarantaine.json"), l[-500:])
        return True
    except OSError:
        return False


# ---------------------------------------------------------------- Parler à Odin
def connexion(c, delai=60):
    u = urlparse(c["odin"])
    hote, port = u.hostname, u.port or (443 if u.scheme == "https" else 80)
    if u.scheme != "https":
        return http.client.HTTPConnection(hote, port, timeout=delai)
    ctx = ssl.create_default_context()
    if c.get("empreinte"):
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    conn = http.client.HTTPSConnection(hote, port, timeout=delai, context=ctx)
    conn.connect()
    if c.get("empreinte"):
        vu = hashlib.sha256(conn.sock.getpeercert(binary_form=True)).hexdigest()
        if vu.lower() != c["empreinte"].lower().replace(":", ""):
            conn.close()
            raise RuntimeError("ce serveur n'est pas Odin (empreinte du certificat différente) : rien n'a été envoyé")
    return conn


def odin(c, methode, chemin, corps=None, brut=False):
    conn = connexion(c)
    entetes = {"authorization": "Bearer " + c["jeton"], "x-odin-poste": c.get("poste", "")[:60]}
    donnees = None
    if corps is not None:
        donnees = json.dumps(corps, ensure_ascii=False).encode("utf-8")
        entetes["content-type"] = "application/json"
    conn.request(methode, chemin, body=donnees, headers=entetes)
    r = conn.getresponse()
    b = r.read()
    h = dict((k.lower(), v) for k, v in r.getheaders())
    conn.close()
    if brut:
        if r.status != 200:
            raise RuntimeError("refus d'Odin (HTTP %d)" % r.status)
        return b, h
    try:
        d = json.loads(b.decode("utf-8"))
    except ValueError:
        raise RuntimeError("réponse illisible d'Odin (HTTP %d)" % r.status)
    if r.status != 200 or d.get("ok") is False:
        raise RuntimeError(d.get("message") or d.get("error") or ("refus d'Odin (HTTP %d)" % r.status))
    return d


def maj_signatures(c):
    v = lire_json(os.path.join(ETAT, "signatures.json"), {}).get("version")
    b, h = odin(c, "GET", "/api/compagnon/signatures?" + urlencode({"version": v or ""}), brut=True)
    nv = h.get("x-odin-version", "")
    if b and len(b) % 32 == 0 and nv and nv != str(v):
        if hashlib.sha256(b).hexdigest() != h.get("x-odin-empreinte", ""):
            raise RuntimeError("signatures abîmées en route")
        os.makedirs(ETAT, exist_ok=True)
        with open(SIGNATURES + ".tmp", "wb") as f:
            f.write(b)
        os.replace(SIGNATURES + ".tmp", SIGNATURES)
        ecrire_json(os.path.join(ETAT, "signatures.json"), {"version": nv, "n": len(b) // 32})
    return nv or v


def rapport(c, avec_majs=True):
    r = {"version": VERSION, "systeme": systeme(), "applis": applis(), "redemarrage": redemarrage_attendu(), "quarantaine": len(lire_json(os.path.join(ETAT, "quarantaine.json"), [])), "mode": c.get("mode", "systeme")}
    if avec_majs:
        r["majs"] = majs_en_attente()
        r["gestionnaires"] = gestionnaires()
    a = lire_json(os.path.join(ETAT, "derniere-analyse.json"), None)
    if a:
        r["analyse"] = {k: a[k] for k in ("t", "fichiers", "duree", "signatures") if k in a}
    return odin(c, "POST", "/api/compagnon/rapport", r)


def bulles_locales(nouvelles):
    """Les bulles d'Odin, lues par la session de la personne (icône, notifications)."""
    if not nouvelles:
        return
    l = lire_json(os.path.join(ETAT, "bulles.json"), [])
    vus = set(b.get("id") for b in l)
    l += [b for b in nouvelles if b.get("id") not in vus]
    ecrire_json(os.path.join(ETAT, "bulles.json"), l[-50:], 0o644)


# ---------------------------------------------------------------- Le service
def tourner(c):
    dernier = lire_json(os.path.join(ETAT, "horloge.json"), {})
    rapport_tous, analyse_tous, majs_heure = 6 * 3600, 24 * 3600, 3
    while True:
        maintenant = time.time()
        consignes = {}
        try:
            consignes = odin(c, "GET", "/api/compagnon/consignes")
            bulles_locales(consignes.get("bulles", []))
            rapport_tous = int(consignes.get("rapport_tous", rapport_tous))
            analyse_tous = int(consignes.get("analyse_tous", analyse_tous))
            majs_heure = int(consignes.get("majs_heure", majs_heure))
            c["quarantaine"] = consignes.get("quarantaine", True)
        except (OSError, RuntimeError, socket.error, ValueError) as e:
            print("Compagnon : Odin injoignable (%s)" % str(e)[:120], file=sys.stderr)
        demande_locale = os.path.exists(os.path.join(DEMANDES, "analyser"))
        try:
            if consignes.get("analyser") or demande_locale or maintenant - dernier.get("analyse", 0) > analyse_tous:
                if demande_locale:
                    os.remove(os.path.join(DEMANDES, "analyser"))
                try:
                    maj_signatures(c)
                except (OSError, RuntimeError) as e:
                    print("Compagnon : signatures non mises à jour (%s)" % str(e)[:120], file=sys.stderr)
                a = analyser(c)
                ecrire_json(os.path.join(ETAT, "derniere-analyse.json"), a)
                dernier["analyse"] = maintenant
                odin(c, "POST", "/api/compagnon/analyse", a)
            heure = time.localtime().tm_hour
            auto = consignes.get("majs") == "auto" and heure == majs_heure and maintenant - dernier.get("majs", 0) > 20 * 3600
            if (consignes.get("appliquer_majs") or auto) and c.get("mode") == "systeme":
                b = appliquer_majs()
                dernier["majs"] = maintenant
                odin(c, "POST", "/api/compagnon/majs", b)
                dernier["rapport"] = 0
            if consignes.get("rapport") or maintenant - dernier.get("rapport", 0) > rapport_tous:
                rapport(c)
                dernier["rapport"] = maintenant
        except (OSError, RuntimeError, socket.error, ValueError) as e:
            print("Compagnon : %s" % str(e)[:200], file=sys.stderr)
        ecrire_json(os.path.join(ETAT, "horloge.json"), dernier)
        for _ in range(int(consignes.get("pause", 60))):
            if os.path.exists(os.path.join(DEMANDES, "analyser")):
                break
            time.sleep(1)


# ---------------------------------------------------------------- La session de la personne (bulles, icône)
def notifier(titre, texte):
    if SYSTEME == "Darwin":
        s = 'display notification %s with title %s' % (json.dumps(texte), json.dumps(titre))
        return sortie(["osascript", "-e", s], 20)[0] == 0
    if SYSTEME == "Linux" and shutil.which("notify-send"):
        icone = os.path.join(ICI, "odin.png")
        return sortie(["notify-send", "-a", "Odin"] + (["-i", icone] if os.path.exists(icone) else []) + [titre, texte], 20)[0] == 0
    print("%s : %s" % (titre, texte))
    return False


def session(c):
    """Linux et macOS : montre les bulles d'Odin ; icône près de l'horloge avec « yad » s'il est là. (Windows : icone.ps1.)"""
    lu = os.path.join(os.path.expanduser("~"), ".odin-compagnon-lu")
    try:
        with open(lu, "r", encoding="utf-8") as f:
            vus = set(json.load(f))
    except (OSError, ValueError):
        vus = set()
    icone = None
    if SYSTEME == "Linux" and shutil.which("yad") and (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        url = c.get("odin", "")
        menu = "Ouvrir Odin!xdg-open %s|Analyser maintenant!touch %s" % (url, os.path.join(DEMANDES, "analyser"))
        try:
            icone = subprocess.Popen(["yad", "--notification", "--text=Odin", "--image=" + os.path.join(ICI, "odin.png"), "--menu=" + menu, "--command=xdg-open " + url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            icone = None
    try:
        while True:
            for b in lire_json(os.path.join(ETAT, "bulles.json"), []):
                if b.get("id") in vus:
                    continue
                notifier(b.get("titre", "Odin"), b.get("texte", ""))
                vus.add(b.get("id"))
                try:
                    with open(lu, "w", encoding="utf-8") as f:
                        json.dump(sorted(vus)[-200:], f)
                except OSError:
                    pass
            time.sleep(20)
    finally:
        if icone:
            icone.terminate()


def etat():
    c = lire_json(CONFIG, {})
    return {"ok": True, "version": VERSION, "python": platform.python_version(), "systeme": systeme(), "odin": c.get("odin", ""), "poste": c.get("poste", ""), "mode": c.get("mode", ""), "configure": bool(c.get("jeton")),
            "gestionnaires": gestionnaires(), "signatures": Signatures().n, "derniere_analyse": (lire_json(os.path.join(ETAT, "derniere-analyse.json"), {}) or {}).get("t"), "quarantaine": len(lire_json(os.path.join(ETAT, "quarantaine.json"), []))}


def main(argv=None):
    p = argparse.ArgumentParser(description="Compagnon d'Odin sur ce poste")
    sous = p.add_subparsers(dest="cmd")
    sous.add_parser("etat")
    sous.add_parser("tourner")
    sous.add_parser("session")
    r = sous.add_parser("rapport")
    r.add_argument("--sans-majs", action="store_true")
    a = sous.add_parser("analyser")
    a.add_argument("--chemin", action="append", default=[])
    a.add_argument("--sans-signatures", action="store_true")
    m = sous.add_parser("majs")
    m.add_argument("--appliquer", action="store_true")
    b = sous.add_parser("bulle")
    b.add_argument("texte")
    l = sous.add_parser("lire-majs")
    l.add_argument("--gestionnaire", required=True)
    l.add_argument("--fichier", required=True)
    x = p.parse_args(argv)
    if x.cmd == "etat":
        print(json.dumps(etat(), ensure_ascii=bool(os.environ.get("ODIN_JSON_ASCII"))))
        return 0
    if x.cmd == "lire-majs":
        with open(x.fichier, "r", encoding="utf-8") as f:
            print(json.dumps(lire_majs(x.gestionnaire, f.read()), ensure_ascii=False))
        return 0
    if x.cmd == "bulle":
        notifier("Odin", x.texte)
        return 0
    c = config()
    if x.cmd == "tourner":
        tourner(c)
        return 0
    if x.cmd == "session":
        session(c)
        return 0
    if x.cmd == "rapport":
        d = rapport(c, not x.sans_majs)
        print(json.dumps({"ok": True, "conseils": len(d.get("bulles", []))}, ensure_ascii=False))
        return 0
    if x.cmd == "analyser":
        if not x.sans_signatures:
            try:
                maj_signatures(c)
            except (OSError, RuntimeError) as e:
                print("Compagnon : signatures non mises à jour (%s)" % e, file=sys.stderr)
        res = analyser(c, x.chemin or None)
        ecrire_json(os.path.join(ETAT, "derniere-analyse.json"), res)
        odin(c, "POST", "/api/compagnon/analyse", res)
        print(json.dumps({"ok": True, "fichiers": res["fichiers"], "detections": len(res["detections"])}, ensure_ascii=False))
        return 0
    if x.cmd == "majs":
        if x.appliquer:
            res = appliquer_majs()
            odin(c, "POST", "/api/compagnon/majs", res)
        else:
            res = {"majs": majs_en_attente()}
        print(json.dumps(res, ensure_ascii=False))
        return 0
    p.print_help()
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:
        print("Compagnon d'Odin : %s" % e, file=sys.stderr)
        sys.exit(1)
