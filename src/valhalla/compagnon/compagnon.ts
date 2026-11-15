// Le compagnon d'Odin sur chaque ordinateur du parc : ce qu'Odin en garde, les scripts qui l'installent, le vérifient
// et le retirent (Linux et macOS en sh, Windows en PowerShell), et les calculs purs (failles, conseils à la personne).
//
// Comme la capsule d'Écho : chaque compagnon a son jeton à lui, tiré au hasard à l'installation ; Odin n'en garde que
// l'empreinte SHA-256, le jeton n'existe que sur le poste (fichier lisible par le seul système). Retirer le compagnon
// (ou le réinstaller) rend l'ancien jeton inutilisable. Il vérifie l'empreinte du certificat d'Odin.
//
// Rangement : ~/.odin/valhalla/hermod/compagnons.json (inscriptions) et ~/.odin/valhalla/hermod/compagnons/<poste>.json
// (dernier rapport, dernière analyse, consignes en attente, bulles à montrer).

import { createHash, randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PS_PROTEGER, PS_PYTHON, PS_SORTIR, psTexte } from '../../machines/windows.ts';

export const VERSION_COMPAGNON = '1.0.0';
export type SystemePoste = 'posix' | 'windows';
export interface Inscrit { poste: string; empreinte: string; at: string; version: string; systeme?: SystemePoste; via?: 'satellites' | 'genese'; machine?: string }
export interface Bulle { id: string; t: number; titre: string; texte: string; niveau: 'info' | 'attention' | 'haute'; cle?: string }
export interface Appli { nom: string; version: string; editeur?: string }
export interface Maj { nom: string; version?: string; nouvelle?: string; gestionnaire?: string; securite?: boolean; id?: string }
export interface Detection { fichier: string; sha256: string; quoi: string; ecarte: boolean }
export interface Rapport { t: number; version: string; systeme: Record<string, unknown>; applis: Appli[]; majs?: Maj[]; gestionnaires?: string[]; redemarrage?: boolean; quarantaine?: number; mode?: string; analyse?: Record<string, unknown> }
export interface Analyse { t: number; fichiers: number; illisibles?: number; duree: number; detections: Detection[]; signatures: number }
export interface Faille { cve: string; logiciel: string; version: string; produit: string; nom: string; rancon: boolean; majDispo?: string }
export interface Fiche {
  poste: string; vu?: number; rapport?: Rapport; analyse?: Analyse; majs?: { t: number; bilan: Array<{ gestionnaire: string; ok: boolean; fin: string }>; redemarrage: boolean };
  failles?: Faille[]; detections?: Array<Detection & { t: number }>;
  consignes: { analyser?: boolean; appliquer_majs?: boolean; rapport?: boolean; bulles: Bulle[] };
  /** les conseils déjà donnés (clé → date) : on ne répète pas la même bulle avant un jour */
  dits?: Record<string, number>;
}

const hacher = (jeton: string) => createHash('sha256').update(jeton, 'utf8').digest('hex');
/** Un nom de poste propre (lettres, chiffres, espace, . _ -). Pur. */
export const propre = (poste: string) => String(poste ?? '').trim().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 60);
const fichierInscrits = (home: string) => join(home, 'valhalla', 'hermod', 'compagnons.json');
const fichierFiche = (home: string, poste: string) => join(home, 'valhalla', 'hermod', 'compagnons', `${propre(poste).replace(/[^\w.-]/g, '_') || 'poste'}.json`);
function ecrire(f: string, x: unknown): void { mkdirSync(dirname(f), { recursive: true, mode: 0o700 }); writeFileSync(`${f}.tmp`, JSON.stringify(x), { mode: 0o600 }); renameSync(`${f}.tmp`, f); }

/** Les postes qui ont un compagnon (sans aucun jeton). */
export function inscrits(home: string): Inscrit[] {
  try { return (JSON.parse(readFileSync(fichierInscrits(home), 'utf8')) as Inscrit[]).filter((x) => x && typeof x.poste === 'string' && /^[a-f0-9]{64}$/.test(x.empreinte)); } catch { return []; }
}
/** Inscrit (ou réinscrit) le compagnon d'un poste : rend son nouveau jeton, à remettre au poste seulement. */
export function inscrire(home: string, poste: string, o: { systeme?: SystemePoste; via?: Inscrit['via']; machine?: string } = {}, now = new Date()): string {
  const p = propre(poste); if (!p) throw new Error('nom de poste invalide');
  const jeton = randomBytes(32).toString('hex');
  ecrire(fichierInscrits(home), [...inscrits(home).filter((x) => x.poste !== p), { poste: p, empreinte: hacher(jeton), at: now.toISOString(), version: VERSION_COMPAGNON, ...o }]);
  return jeton;
}
/** Retire le compagnon d'un poste (son jeton ne vaut plus rien ; sa fiche reste pour l'historique). */
export function desinscrire(home: string, poste: string): boolean {
  const l = inscrits(home), n = l.filter((x) => x.poste !== propre(poste));
  if (n.length === l.length) return false;
  ecrire(fichierInscrits(home), n); return true;
}
/** Le poste à qui appartient ce jeton (comparaison à temps constant), ou rien. */
export function posteDuJeton(home: string, jeton: string): Inscrit | undefined {
  if (!/^[a-f0-9]{64}$/.test(jeton)) return undefined;
  const h = Buffer.from(hacher(jeton), 'hex'); let trouve: Inscrit | undefined;
  for (const x of inscrits(home)) if (timingSafeEqual(Buffer.from(x.empreinte, 'hex'), h)) trouve = x;
  return trouve;
}
export function fiche(home: string, poste: string): Fiche {
  try { const f = JSON.parse(readFileSync(fichierFiche(home, poste), 'utf8')) as Fiche; return { ...f, consignes: { ...(f.consignes ?? {}), bulles: f.consignes?.bulles ?? [] } }; } catch { return { poste: propre(poste), consignes: { bulles: [] } }; }
}
export function sauverFiche(home: string, f: Fiche): void { ecrire(fichierFiche(home, f.poste), f); }
export function modifierFiche(home: string, poste: string, ch: (f: Fiche) => Fiche | void): Fiche { const f = fiche(home, poste), n = ch(f) ?? f; sauverFiche(home, n); return n; }
/** Une bulle à montrer sur le poste (une même clé n'est redite qu'après un jour). Rend true si elle part. */
export function bulle(f: Fiche, b: Omit<Bulle, 'id' | 't'>, now = Date.now()): boolean {
  f.dits ??= {};
  if (b.cle && f.dits[b.cle] && now - f.dits[b.cle] < 86_400_000) return false;
  if (b.cle) f.dits[b.cle] = now;
  f.consignes.bulles = [...f.consignes.bulles, { ...b, id: randomBytes(6).toString('hex'), t: now }].slice(-30);
  return true;
}

/** L'empreinte SHA-256 du certificat d'Odin (celle que le compagnon vérifie), s'il en a un. */
export function empreinteOdin(home: string): string {
  const f = join(home, 'tls', 'cert.pem'); if (!existsSync(f)) return '';
  try { return createHash('sha256').update(new X509Certificate(readFileSync(f)).raw).digest('hex'); } catch { return ''; }
}

// ---------------------------------------------------------------- Calculs purs
/** a < b, pour des versions « 1.2.10 » (chiffres comparés en nombres, le reste en texte). Pur. */
export function versionInferieure(a: string, b: string): boolean {
  const pa = String(a).split(/[.\-+_~:]/), pb = String(b).split(/[.\-+_~:]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0', y = pb[i] ?? '0', nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { if (Number(x) !== Number(y)) return Number(x) < Number(y); } else if (x !== y) return x < y;
  }
  return false;
}
/** Logiciels courants dont le nom installé diffère du nom du catalogue des failles : [produit du catalogue, nom installé]. */
const CORRESPONDANCES: Array<[RegExp, RegExp]> = [
  [/chrom(e|ium)/, /^(google chrome|chromium|google-chrome)/], [/\bedge\b/, /^microsoft edge/], [/firefox/, /firefox/], [/thunderbird/, /thunderbird/], [/7-zip/, /^7-zip|^p7zip/], [/winrar/, /^winrar/],
  [/acrobat|reader/, /^adobe acrobat|^adobe reader/], [/\bvlc\b|videolan/, /^vlc/], [/\bzoom\b/, /^zoom/], [/notepad\+\+/, /^notepad\+\+/], [/\bjava\b|\bjre\b|\bjdk\b/, /^java|^openjdk|^jre|^jdk/], [/putty/, /^putty/],
  [/winscp/, /^winscp/], [/\bteams\b/, /^microsoft teams/], [/\boffice\b|\bword\b|\bexcel\b|outlook|powerpoint/, /^microsoft (office|365|word|excel|outlook|powerpoint)/], [/openssh/, /^openssh/], [/openssl/, /^(openssl|libssl)/],
  [/apache http server/, /^(apache2|httpd)$/], [/\bsudo\b/, /^sudo$/], [/\bbash\b/, /^bash$/], [/glibc|gnu c library/, /^(libc6|glibc)$/], [/linux kernel/, /^linux-image|^kernel$/], [/\bsamba\b/, /^samba/], [/\bcups\b/, /^cups/],
  [/\bcurl\b/, /^(curl|libcurl)/], [/\bgit\b/, /^git$/], [/\bnginx\b/, /^nginx/], [/\bphp\b/, /^php/], [/node\.?js/, /^node(js)?\b/], [/python/, /^python3?\b/], [/teamviewer/, /^teamviewer/], [/anydesk/, /^anydesk/], [/forticlient/, /^forticlient/],
];
const plat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
/**
 * Les failles réellement exploitées (catalogue CISA KEV d'Asclépios) qui touchent un logiciel installé : rapprochement
 * par le nom (le catalogue ne donne pas de numéros de version). Si une mise à jour de ce logiciel attend, la faille est
 * très probablement ouverte : `majDispo` le dit. Pur.
 */
export function failles(applis: Appli[], kev: Array<{ cve: string; vendor: string; product: string; name: string; added: string; ransomware: boolean }>, majs: Maj[] = [], o: { jours?: number; now?: number } = {}): Faille[] {
  const now = o.now ?? Date.now(), recents = kev.filter((k) => now - Date.parse(k.added) < (o.jours ?? 730) * 86_400_000), out: Faille[] = [], vu = new Set<string>();
  for (const a of applis) {
    const nom = a.nom.toLowerCase(), pn = plat(a.nom);
    for (const k of recents) {
      const vp = `${k.vendor} ${k.product}`.toLowerCase(), pp = plat(k.product);
      const touche = CORRESPONDANCES.some(([cat, inst]) => cat.test(vp) && inst.test(nom)) || (pp.length > 4 && pn.includes(pp) && (pn.includes(plat(k.vendor)) || plat(k.vendor) === pp || pn.startsWith(pp)));
      if (!touche || vu.has(`${k.cve}|${a.nom}`)) continue;
      vu.add(`${k.cve}|${a.nom}`);
      const m = majs.find((x) => { const xn = x.nom.toLowerCase(); return xn === nom || (x.id ?? '').toLowerCase().includes(pn.slice(0, 12)) || plat(x.nom) === pn; });
      out.push({ cve: k.cve, logiciel: a.nom, version: a.version, produit: `${k.vendor} ${k.product}`, nom: k.name, rancon: k.ransomware, ...(m?.nouvelle ? { majDispo: m.nouvelle } : {}) });
    }
  }
  return out.sort((x, y) => Number(Boolean(y.majDispo)) - Number(Boolean(x.majDispo)) || Number(y.rancon) - Number(x.rancon));
}

/** Ce qu'Odin dit à la personne du poste après un rapport (conseils simples, une étape à la fois). Pur. */
export function conseils(r: Rapport, fs: Faille[], o: { majsAuto: boolean; heure: number }): Array<Omit<Bulle, 'id' | 't'>> {
  const out: Array<Omit<Bulle, 'id' | 't'>> = [], majs = r.majs ?? [], secu = majs.filter((m) => m.securite).length;
  const ouvertes = fs.filter((f) => f.majDispo);
  if (ouvertes.length) {
    const l = [...new Set(ouvertes.map((f) => f.logiciel))];
    out.push({ niveau: 'haute', cle: `failles:${l.join(',')}`, titre: 'Faille connue sur ce poste', texte: `${l.slice(0, 3).join(', ')}${l.length > 3 ? '…' : ''} : une faille utilisée par des attaquants a un correctif. ${o.majsAuto ? `Je l'installe cette nuit (${o.heure} h) ; laisse l'ordinateur allumé.` : 'Mets-le à jour dès que possible (ou demande-moi de le faire).'}` });
  }
  if (majs.length && !ouvertes.length) out.push({ niveau: secu ? 'attention' : 'info', cle: `majs:${majs.length}`, titre: 'Mises à jour', texte: `${majs.length} mise(s) à jour attend(ent)${secu ? `, dont ${secu} de sécurité` : ''}. ${o.majsAuto ? `Je m'en occupe cette nuit (${o.heure} h), sans changer de version du système.` : 'Dis-moi quand les installer.'}` });
  if (r.redemarrage) out.push({ niveau: 'attention', cle: 'redemarrage', titre: 'Redémarrage conseillé', texte: 'Des mises à jour sont installées : redémarre l\'ordinateur quand tu peux (enregistre ton travail avant).' });
  const disque = Number(r.systeme?.disque);
  if (disque >= 90) out.push({ niveau: 'attention', cle: 'disque', titre: 'Disque presque plein', texte: `Le disque est plein à ${disque} % : vide la corbeille et les téléchargements dont tu n'as plus besoin.` });
  return out;
}

// ---------------------------------------------------------------- Les scripts
const b64 = (t: string | Buffer) => Buffer.from(t).toString('base64');
/** Le programme du compagnon (Python 3, bibliothèque standard seulement). */
export const programmeCompagnon = (): string => readFileSync(new URL('./compagnon.py', import.meta.url), 'utf8');
export interface ConfInstall { odin: string; jeton: string; poste: string; empreinte: string }
function confJson(c: ConfInstall): string {
  if (!/^https?:\/\/[^\s'"`$\\]+$/.test(c.odin)) throw new Error('adresse d\'Odin invalide (https://adresse:port)');
  if (!/^[a-f0-9]{64}$/.test(c.jeton)) throw new Error('jeton invalide');
  if (c.empreinte && !/^[a-f0-9]{64}$/i.test(c.empreinte.replace(/:/g, ''))) throw new Error('empreinte du certificat invalide');
  return JSON.stringify({ odin: c.odin.replace(/\/$/, ''), jeton: c.jeton, poste: propre(c.poste), empreinte: c.empreinte, version: VERSION_COMPAGNON });
}

/** Le cœur du script Linux / macOS (lancé avec le mode en argument : « systeme » ou « utilisateur »). */
function coeurPosix(c: ConfInstall): string {
  return `MODE="$1"
if ! command -v python3 >/dev/null 2>&1; then
  if [ "$MODE" = systeme ]; then (apt-get install -y python3 || dnf install -y python3 || zypper -n in python3) >/dev/null 2>&1; fi
  command -v python3 >/dev/null 2>&1 || { echo '{"ok":false,"erreur":"python3 absent sur ce poste"}'; exit 3; }
fi
OS=$(uname -s)
if [ "$MODE" = systeme ]; then if [ "$OS" = Darwin ]; then D="/Library/Application Support/OdinCompagnon"; else D=/opt/odin-compagnon; fi; else D="$HOME/.odin-compagnon"; fi
umask 077
python3 - "$D" "$MODE" <<'COMPAGNON'
import base64, json, os, sys
d, mode = sys.argv[1], sys.argv[2]
os.makedirs(d, exist_ok=True); os.chmod(d, 0o755 if mode == "systeme" else 0o700)
for sous, droits in (("etat", 0o755 if mode == "systeme" else 0o700), ("demandes", 0o1777 if mode == "systeme" else 0o700)):
    os.makedirs(os.path.join(d, sous), exist_ok=True); os.chmod(os.path.join(d, sous), droits)
conf = json.loads(base64.b64decode("${b64(confJson(c))}")); conf["mode"] = mode
for nom, contenu, droits in (("compagnon.py", base64.b64decode("${b64(programmeCompagnon())}"), 0o755), ("compagnon.json", json.dumps(conf).encode(), 0o600)):
    f = os.path.join(d, nom)
    with open(f + ".tmp", "wb") as h:
        h.write(contenu)
    os.chmod(f + ".tmp", droits); os.replace(f + ".tmp", f)
COMPAGNON
PY=$(command -v python3)
if [ "$OS" = Darwin ]; then
  if [ "$MODE" = systeme ]; then LD=/Library/LaunchDaemons; LA=/Library/LaunchAgents; else LD="$HOME/Library/LaunchAgents"; LA="$HOME/Library/LaunchAgents"; mkdir -p "$LA"; fi
  for x in "tourner:$LD/fr.toufatech.odin.compagnon.plist" "session:$LA/fr.toufatech.odin.compagnon.session.plist"; do
    c=\${x%%:*}; f=\${x#*:}
    printf '<?xml version="1.0" encoding="UTF-8"?>\\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\\n<plist version="1.0"><dict><key>Label</key><string>%s</string><key>ProgramArguments</key><array><string>%s</string><string>%s/compagnon.py</string><string>%s</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>\\n' "$(basename "$f" .plist)" "$PY" "$D" "$c" > "$f"
    chmod 644 "$f"; launchctl unload "$f" >/dev/null 2>&1; launchctl load -w "$f" >/dev/null 2>&1 || true
  done
  DEM="launchd"
else
  UNIT="[Unit]\\nDescription=Compagnon d'Odin\\nWants=network-online.target\\nAfter=network-online.target\\n[Service]\\nExecStart=$PY $D/compagnon.py tourner\\nRestart=always\\nRestartSec=30\\n[Install]\\nWantedBy=%s\\n"
  if [ "$MODE" = systeme ]; then
    printf "$UNIT" multi-user.target > /etc/systemd/system/odin-compagnon.service && chmod 644 /etc/systemd/system/odin-compagnon.service
    systemctl daemon-reload >/dev/null 2>&1; systemctl enable --now odin-compagnon.service >/dev/null 2>&1 && DEM="systemd" || DEM="aucun"
    mkdir -p /etc/xdg/autostart; AUTO=/etc/xdg/autostart/odin-compagnon.desktop
  else
    mkdir -p "$HOME/.config/systemd/user" "$HOME/.config/autostart"
    printf "$UNIT" default.target > "$HOME/.config/systemd/user/odin-compagnon.service"
    if systemctl --user daemon-reload >/dev/null 2>&1 && systemctl --user enable --now odin-compagnon.service >/dev/null 2>&1; then DEM="systemd (utilisateur)"; else (crontab -l 2>/dev/null | grep -v odin-compagnon; echo "@reboot $PY $D/compagnon.py tourner # odin-compagnon") | crontab - && DEM="cron"; fi
    AUTO="$HOME/.config/autostart/odin-compagnon.desktop"
  fi
  printf '[Desktop Entry]\\nType=Application\\nName=Odin\\nComment=Compagnon d Odin : bulles et icone\\nExec=%s %s/compagnon.py session\\nX-GNOME-Autostart-enabled=true\\nNoDisplay=true\\n' "$PY" "$D" > "$AUTO"; chmod 644 "$AUTO"
fi
E=$("$PY" "$D/compagnon.py" etat 2>/dev/null | tail -n 1)
[ -n "$E" ] || { echo '{"ok":false,"erreur":"le compagnon ne répond pas après installation"}'; exit 4; }
printf '%s\\n' "$E" | "$PY" -c 'import json,sys; e=json.loads(sys.stdin.read()); e["demarrage"]=sys.argv[1]; e["dossier"]=sys.argv[2]; print(json.dumps(e, ensure_ascii=False))' "$DEM" "$D"
`;
}
/**
 * Le script sh (Linux, macOS) que Satellites lance sur le poste : en administrateur si possible (service du système,
 * mises à jour appliquées), sinon dans le compte de la personne (mises à jour seulement signalées). Rend l'état en JSON. Pur.
 */
export function scriptInstallationPosix(c: ConfInstall): string {
  return `DEC="base64 -d"; [ "$(uname -s)" = Darwin ] && DEC="base64 -D"
CODE="$(printf %s '${b64(coeurPosix(c))}' | $DEC)"
if [ "$(id -u)" = 0 ]; then sh -c "$CODE" sh systeme; exit $?; fi
sudo sh -c "$CODE" sh systeme; r=$?; [ $r -ne 1 ] && exit $r
sh -c "$CODE" sh utilisateur
`;
}
const RETRAIT_POSIX = `for D in /opt/odin-compagnon "/Library/Application Support/OdinCompagnon"; do [ -d "$D" ] || continue; done
systemctl disable --now odin-compagnon.service >/dev/null 2>&1; rm -f /etc/systemd/system/odin-compagnon.service /etc/xdg/autostart/odin-compagnon.desktop; systemctl daemon-reload >/dev/null 2>&1
for f in /Library/LaunchDaemons/fr.toufatech.odin.compagnon.plist /Library/LaunchAgents/fr.toufatech.odin.compagnon.session.plist; do [ -f "$f" ] && { launchctl unload "$f" >/dev/null 2>&1; rm -f "$f"; }; done
pkill -f 'odin-compagnon/compagnon.py|OdinCompagnon/compagnon.py' >/dev/null 2>&1
rm -rf /opt/odin-compagnon "/Library/Application Support/OdinCompagnon"
`;
const RETRAIT_UTILISATEUR = `systemctl --user disable --now odin-compagnon.service >/dev/null 2>&1; rm -f "$HOME/.config/systemd/user/odin-compagnon.service" "$HOME/.config/autostart/odin-compagnon.desktop"
(crontab -l 2>/dev/null | grep -v odin-compagnon) | crontab - 2>/dev/null
for f in "$HOME/Library/LaunchAgents/fr.toufatech.odin.compagnon.plist" "$HOME/Library/LaunchAgents/fr.toufatech.odin.compagnon.session.plist"; do [ -f "$f" ] && { launchctl unload "$f" >/dev/null 2>&1; rm -f "$f"; }; done
pkill -f '.odin-compagnon/compagnon.py' >/dev/null 2>&1
rm -rf "$HOME/.odin-compagnon"
`;
/** Retire le compagnon (service, démarrage, dossier) ; en administrateur si possible. Pur. */
export const scriptRetraitPosix = () => `${RETRAIT_UTILISATEUR}if [ "$(id -u)" = 0 ]; then sh -c '${RETRAIT_POSIX.replace(/'/g, `'\\''`)}'; else sudo sh -c '${RETRAIT_POSIX.replace(/'/g, `'\\''`)}' >/dev/null 2>&1; fi
if [ -d /opt/odin-compagnon ] || [ -d "/Library/Application Support/OdinCompagnon" ] || [ -d "$HOME/.odin-compagnon" ]; then echo '{"ok":false,"erreur":"dossier du compagnon encore là (droits administrateur ?)"}'; else echo '{"ok":true}'; fi
`;
/** L'état du compagnon d'un poste. Pur. */
export const scriptEtatPosix = () => `for D in /opt/odin-compagnon "/Library/Application Support/OdinCompagnon" "$HOME/.odin-compagnon"; do if [ -f "$D/compagnon.py" ]; then python3 "$D/compagnon.py" etat; exit $?; fi; done; echo '{"ok":false,"erreur":"pas de compagnon sur ce poste"}'`;

// ---------------- Windows
export const TACHE = 'Odin - Compagnon', TACHE_ICONE = 'Odin - Compagnon (icone)';
/** L'icône d'Odin près de l'horloge (zone de notification) et ses bulles, dans la session de la personne. */
export const ICONE_PS1 = String.raw`Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$d = Split-Path -Parent $PSScriptRoot
$conf = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'odin.json') | ConvertFrom-Json
$bmp = New-Object Drawing.Bitmap 32, 32; $g = [Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode = 'AntiAlias'; $g.Clear([Drawing.Color]::Transparent)
$g.FillEllipse((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(79, 157, 222))), 1, 1, 30, 30)
$sf = New-Object Drawing.StringFormat; $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
$g.DrawString('O', (New-Object Drawing.Font('Segoe UI', 15, [Drawing.FontStyle]::Bold)), [Drawing.Brushes]::White, (New-Object Drawing.RectangleF 0, 0, 32, 32), $sf)
$ni = New-Object Windows.Forms.NotifyIcon; $ni.Icon = [Drawing.Icon]::FromHandle($bmp.GetHicon()); $ni.Text = 'Odin'; $ni.Visible = $true
$m = New-Object Windows.Forms.ContextMenuStrip
[void]$m.Items.Add('Ouvrir Odin', $null, { Start-Process $conf.odin })
[void]$m.Items.Add('Analyser maintenant', $null, { New-Item -ItemType File -Force -Path (Join-Path $d 'demandes\analyser') | Out-Null; $ni.ShowBalloonTip(5000, 'Odin', 'Analyse demandée : je te dis ce que je trouve.', [Windows.Forms.ToolTipIcon]::Info) })
[void]$m.Items.Add('Masquer l''icône', $null, { $ni.Visible = $false; [Windows.Forms.Application]::Exit() })
$ni.ContextMenuStrip = $m; $ni.add_DoubleClick({ Start-Process $conf.odin })
$lu = Join-Path $env:LOCALAPPDATA 'OdinCompagnon-lu.txt'; $vus = @{}; if (Test-Path -LiteralPath $lu) { foreach ($x in Get-Content -LiteralPath $lu) { $vus[$x] = 1 } }
$t = New-Object Windows.Forms.Timer; $t.Interval = 20000
$t.add_Tick({
  try { $l = Get-Content -Raw -Encoding UTF8 (Join-Path $d 'etat\bulles.json') | ConvertFrom-Json } catch { return }
  foreach ($b in @($l)) { if ($vus.ContainsKey([string]$b.id)) { continue }; $vus[[string]$b.id] = 1; Add-Content -LiteralPath $lu -Value ([string]$b.id)
    $ic = if ($b.niveau -eq 'haute') { [Windows.Forms.ToolTipIcon]::Warning } else { [Windows.Forms.ToolTipIcon]::Info }
    $ni.ShowBalloonTip(10000, [string]$b.titre, [string]$b.texte, $ic); break }
})
$t.Start(); [Windows.Forms.Application]::Run()`;
const DEBUT_WIN = ['$ErrorActionPreference = \'Stop\'', '$ProgressPreference = \'SilentlyContinue\'', PS_SORTIR, PS_PYTHON, PS_PROTEGER,
  '$d = Join-Path $env:ProgramData \'OdinCompagnon\'', `$tache = ${psTexte(TACHE)}`, `$tacheIcone = ${psTexte(TACHE_ICONE)}`, '$env:PYTHONIOENCODING = \'utf-8\'', '$env:ODIN_JSON_ASCII = \'1\'',
  String.raw`function Arreter-Compagnon {
  foreach ($n in @($tache, $tacheIcone)) { try { Stop-ScheduledTask -TaskName $n -ErrorAction Stop } catch { } }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*OdinCompagnon*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Lire-Python { $f = Join-Path $d 'python.txt'; if (Test-Path -LiteralPath $f) { return ([IO.File]::ReadAllText($f)).Trim() } else { return $null } }`];
/**
 * Le script PowerShell d'installation (compte administrateur du poste) : Python 3 trouvé (sinon installé par winget),
 * dossier C:\ProgramData\OdinCompagnon protégé (le jeton n'est lisible que par le système et les administrateurs),
 * service (tâche planifiée du compte SYSTEM au démarrage), icône d'Odin à chaque ouverture de session, puis l'état en JSON. Pur.
 */
export function scriptInstallationWindows(c: ConfInstall): string {
  const conf = confJson(c);
  return [...DEBUT_WIN, String.raw`$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Sortir @{ ok = $false; erreur = 'il faut un compte administrateur de ce poste (service et mises à jour)' }; exit 3 }
$py = Trouver-Python
if (-not $py) {
  $w = Get-Command winget -ErrorAction SilentlyContinue
  if ($w) { & $w.Source install -e --id Python.Python.3.12 --scope machine --silent --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Null }
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + $env:Path
  $py = Trouver-Python
  if (-not $py) { $c = Get-ChildItem -Path (Join-Path $env:ProgramFiles 'Python3*\python.exe') -ErrorAction SilentlyContinue | Select-Object -Last 1; if ($c) { $py = $c.FullName } }
}
if (-not $py) { Sortir @{ ok = $false; erreur = 'Python 3 absent sur ce poste et winget n''a pas pu l''installer : installe-le (python.org, « pour tous les utilisateurs ») puis recommence' }; exit 3 }
Arreter-Compagnon
foreach ($x in @($d, (Join-Path $d 'etat'), (Join-Path $d 'demandes'), (Join-Path $d 'session'))) { New-Item -ItemType Directory -Force -Path $x | Out-Null }
Proteger $d -Systeme
& icacls.exe (Join-Path $d 'etat') /grant '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
& icacls.exe (Join-Path $d 'session') /grant '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
& icacls.exe (Join-Path $d 'demandes') /grant '*S-1-5-32-545:(OI)(CI)M' | Out-Null`,
  `Ecrire-B64 (Join-Path $d 'compagnon.py') '${b64(programmeCompagnon())}'`,
  `$conf = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(conf)}')) | ConvertFrom-Json; $conf | Add-Member -NotePropertyName mode -NotePropertyValue 'systeme' -Force`,
  `Ecrire-B64 (Join-Path $d 'session\\icone.ps1') '${b64(`\ufeff${ICONE_PS1}`)}'`,
  String.raw`[IO.File]::WriteAllText((Join-Path $d 'compagnon.json'), ($conf | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllText((Join-Path $d 'session\odin.json'), (@{ odin = $conf.odin } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllText((Join-Path $d 'python.txt'), $py)
$demarrage = 'aucun'
$a = New-ScheduledTaskAction -Execute $py -Argument ('"' + (Join-Path $d 'compagnon.py') + '" tourner') -WorkingDirectory $d
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $tache -Action $a -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal (New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest) -Settings $s -Description 'Odin : compagnon du poste (antivirus, mises à jour, failles)' -Force | Out-Null
try { Start-ScheduledTask -TaskName $tache; $demarrage = 'tâche planifiée (SYSTEM)' } catch { }
$ai = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $d 'session\icone.ps1') + '"')
Register-ScheduledTask -TaskName $tacheIcone -Action $ai -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Principal (New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited) -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew) -Description 'Odin : icône près de l''horloge et bulles' -Force | Out-Null
try { Start-ScheduledTask -TaskName $tacheIcone } catch { }
$e = & $py (Join-Path $d 'compagnon.py') etat 2>$null | Select-Object -Last 1
try { $o = $e | ConvertFrom-Json } catch { Sortir @{ ok = $false; erreur = 'le compagnon ne répond pas après installation' }; exit 4 }
$o | Add-Member -NotePropertyName demarrage -NotePropertyValue $demarrage -Force
$o | Add-Member -NotePropertyName dossier -NotePropertyValue $d -Force
Sortir $o`].join('\n');
}
/** L'état du compagnon d'un poste Windows (et de ses deux tâches). Pur. */
export function scriptEtatWindows(): string {
  return [...DEBUT_WIN, String.raw`$py = Lire-Python
if (-not $py -or -not (Test-Path -LiteralPath (Join-Path $d 'compagnon.py'))) { Sortir @{ ok = $false; erreur = 'pas de compagnon sur ce poste' }; exit 0 }
$e = & $py (Join-Path $d 'compagnon.py') etat 2>$null | Select-Object -Last 1
try { $o = $e | ConvertFrom-Json } catch { Sortir @{ ok = $false; erreur = 'le compagnon ne répond pas (Python déplacé ?)' }; exit 0 }
$t = Get-ScheduledTask -TaskName $tache -ErrorAction SilentlyContinue
$o | Add-Member -NotePropertyName service -NotePropertyValue $(if ($t) { [string]$t.State } else { 'absent' }) -Force
Sortir $o`].join('\n');
}
/** Retrait complet : tâches arrêtées et effacées, processus arrêtés, dossier effacé. Pur. */
export function scriptRetraitWindows(): string {
  return [...DEBUT_WIN, String.raw`Arreter-Compagnon
foreach ($n in @($tache, $tacheIcone)) { try { Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction Stop } catch { } }
if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force }
$reste = @(); if (Test-Path -LiteralPath $d) { $reste += $d }; foreach ($n in @($tache, $tacheIcone)) { if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) { $reste += $n } }
Sortir @{ ok = ($reste.Count -eq 0); reste = $reste }`].join('\n');
}
/** La dernière ligne JSON d'une sortie (l'état rendu par le compagnon). Pur. */
export function lireEtat(out: string): Record<string, unknown> | undefined {
  for (const l of out.trim().split(/\r?\n/).reverse()) { try { const j = JSON.parse(l) as Record<string, unknown>; if (j && typeof j === 'object' && !Array.isArray(j)) return j; } catch { /* ligne suivante */ } }
  return undefined;
}
