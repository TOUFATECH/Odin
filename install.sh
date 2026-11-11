#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Installateur d'Odin pour macOS et Linux
#
#    curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Odin/main/install.sh | bash
#
#  Ce que fait ce script (rien d'autre) :
#    1. vérifie Node.js ≥ 22.18, sinon télécharge Node 22 officiel (somme SHA-256 vérifiée)
#       dans ~/.odin/node, sans toucher au Node du système ;
#    2. télécharge Odin dans ~/.odin/app ;
#    3. crée la commande « odin » dans ~/.local/bin ;
#    4. initialise ~/.odin (configuration, persona, mémoire) ;
#    5. te propose : inventaire du réseau local, démarrage automatique ;
#    6. ouvre l'interface web : tu y choisis le modèle et tes clés (onglet Réglages).
#
#  Variables utiles : ODIN_YES=1 (tout accepter), ODIN_NO_SERVICE=1, ODIN_NO_SCAN=1,
#  ODIN_REPO=<url git>, ODIN_HOME=<dossier>.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ODIN_REPO="${ODIN_REPO:-https://github.com/TOUFATECH/Odin}"
ODIN_HOME="${ODIN_HOME:-$HOME/.odin}"
APP_DIR="$ODIN_HOME/app"
NODE_DIR="$ODIN_HOME/node"
BIN_DIR="$HOME/.local/bin"

gold() { printf '\033[33m%s\033[0m\n' "$*"; }
info() { printf '  \033[2m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\033[31mErreur : %s\033[0m\n' "$*" >&2; exit 1; }

# Questions : lues sur le terminal même quand le script arrive par « curl | bash ».
ask() {  # ask "Question ?" défaut(o/n)
  local q="$1" def="${2:-o}" a=""
  if [ "${ODIN_YES:-}" = "1" ] || [ ! -r /dev/tty ]; then [ "$def" = "o" ]; return; fi
  printf '  %s [%s] ' "$q" "$([ "$def" = o ] && echo O/n || echo o/N)" > /dev/tty
  read -r a < /dev/tty || true
  a="${a:-$def}"; case "$a" in o|O|oui|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

gold "ᛟ  Installation d'Odin"

# ---------- 1. Système et architecture ----------
case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux)  OS=linux ;;
  *) die "système non pris en charge : $(uname -s). Sous Windows, utilise install.ps1." ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) die "processeur non pris en charge : $(uname -m)" ;;
esac
command -v curl >/dev/null || die "curl est requis"
command -v tar  >/dev/null || die "tar est requis"

# ---------- 2. Node.js ----------
node_ok() {  # vrai si $1 est un Node ≥ 22.18
  local v; v="$("$1" -p 'process.versions.node' 2>/dev/null)" || return 1
  local maj="${v%%.*}" rest="${v#*.}"; local min="${rest%%.*}"
  [ "$maj" -gt 22 ] || { [ "$maj" -eq 22 ] && [ "$min" -ge 18 ]; }
}

NODE_BIN=""
if command -v node >/dev/null && node_ok "$(command -v node)"; then
  NODE_BIN="$(command -v node)"; ok "Node $("$NODE_BIN" -v) déjà présent"
elif [ -x "$NODE_DIR/bin/node" ] && node_ok "$NODE_DIR/bin/node"; then
  NODE_BIN="$NODE_DIR/bin/node"; ok "Node $("$NODE_BIN" -v) (installé par Odin)"
else
  info "Téléchargement de Node.js 22 (officiel, nodejs.org)…"
  BASE="https://nodejs.org/dist/latest-v22.x"
  SUMS="$(curl -fsSL "$BASE/SHASUMS256.txt")" || die "impossible de joindre nodejs.org"
  LINE="$(printf '%s\n' "$SUMS" | grep -E "node-v[0-9.]+-$OS-$ARCH\.tar\.gz$" | head -n1)"
  [ -n "$LINE" ] || die "aucune version de Node pour $OS-$ARCH"
  SHA="${LINE%% *}"; FILE="${LINE##* }"
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
  if command -v sha256sum >/dev/null; then GOT="$(sha256sum "$TMP/$FILE" | cut -d' ' -f1)"; else GOT="$(shasum -a 256 "$TMP/$FILE" | cut -d' ' -f1)"; fi
  [ "$GOT" = "$SHA" ] || die "somme de contrôle de Node invalide (téléchargement corrompu ?)"
  rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"
  tar -xzf "$TMP/$FILE" -C "$NODE_DIR" --strip-components=1
  NODE_BIN="$NODE_DIR/bin/node"
  ok "Node $("$NODE_BIN" -v) installé dans $NODE_DIR (somme SHA-256 vérifiée)"
fi

# ---------- 3. Odin ----------
mkdir -p "$ODIN_HOME"
if [ -d "$APP_DIR/.git" ] && command -v git >/dev/null; then
  info "Mise à jour d'Odin…"
  if git -C "$APP_DIR" pull --ff-only --quiet; then ok "Odin mis à jour"; else
    echo "  Mise à jour impossible (modifications locales dans $APP_DIR ?). Déplace ce dossier puis relance." >&2; exit 1; fi
elif command -v git >/dev/null; then
  rm -rf "$APP_DIR"; git clone --depth 1 --quiet "$ODIN_REPO" "$APP_DIR"; ok "Odin téléchargé"
else
  rm -rf "$APP_DIR"; mkdir -p "$APP_DIR"
  curl -fsSL "$ODIN_REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$APP_DIR" --strip-components=1
  ok "Odin téléchargé (archive)"
fi

# ---------- 4. Commande « odin » ----------
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/odin" <<EOF
#!/bin/sh
# Lanceur d'Odin (généré par install.sh). Les clés éventuelles sont dans ~/.odin/env (droits 600).
[ -f "$ODIN_HOME/env" ] && { set -a; . "$ODIN_HOME/env"; set +a; }
export ODIN_HOME="$ODIN_HOME"
# Node : celui vu à l'installation ; sinon (nvm mis à jour…) celui du PATH, sinon celui installé par Odin.
NODE="$NODE_BIN"
[ -x "\$NODE" ] || NODE="\$(command -v node 2>/dev/null)"
[ -x "\$NODE" ] || NODE="$NODE_DIR/bin/node"
[ -x "\$NODE" ] || { echo "Node.js introuvable : relance l'installateur d'Odin." >&2; exit 1; }
exec "\$NODE" --disable-warning=ExperimentalWarning "$APP_DIR/bin/odin.mjs" "\$@"
EOF
chmod +x "$BIN_DIR/odin"
ok "Commande installée : $BIN_DIR/odin"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
      if [ -f "$rc" ] && ! grep -q 'odin-installer' "$rc"; then
        printf '\nexport PATH="$HOME/.local/bin:$PATH"  # odin-installer\n' >> "$rc"
        info "$BIN_DIR ajouté au PATH dans $rc"
      fi
    done
    export PATH="$BIN_DIR:$PATH" ;;
esac

"$BIN_DIR/odin" init >/dev/null
ok "Configuration créée dans $ODIN_HOME"

# ---------- 5. Choix ----------
echo
gold "Réglages"
info "Le modèle, les clés et Telegram se règlent ensuite dans l'interface web (onglet Réglages)."

# Qui peut ouvrir l'interface web ? (modifiable plus tard : Réglages → Accès, ou « odin web access »)
ACCESS="${ODIN_WEB_ACCESS:-}"
if [ -z "$ACCESS" ] && [ "${ODIN_YES:-}" != "1" ] && [ -r /dev/tty ]; then
  printf '  Accès à l'"'"'interface web :\n    1) ton réseau local, en HTTPS (recommandé : téléphone, tablette…)\n    2) cette machine seulement\n    3) Internet aussi (HTTPS obligatoire, port à ouvrir sur ta box)\n  Ton choix [1] : ' > /dev/tty
  read -r CH < /dev/tty || CH=""
  case "${CH:-1}" in 2) ACCESS=local ;; 3) ACCESS=wan ;; *) ACCESS=lan ;; esac
fi
ACCESS="${ACCESS:-lan}"
case "$ACCESS" in local|lan|wan) ;; *) ACCESS=lan ;; esac
"$BIN_DIR/odin" web access "$ACCESS" >/dev/null && ok "Interface web : $( [ "$ACCESS" = local ] && echo 'cette machine seulement' || { [ "$ACCESS" = lan ] && echo 'réseau local en HTTPS' || echo 'réseau local et Internet en HTTPS'; } )"
if [ "$ACCESS" != local ] && command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  info "Pare-feu ufw actif : autorise le port avec « sudo ufw allow 7777/tcp »."
fi

if [ "${ODIN_NO_SCAN:-}" != "1" ] && ask "Inventorier les appareils de ton réseau local (et suivre leurs changements) ?" o; then
  "$BIN_DIR/odin" net enable >/dev/null
  info "Balayage du réseau local en cours (environ 30 secondes)…"
  "$BIN_DIR/odin" net scan --full || info "Balayage impossible pour l'instant ; Odin réessaiera automatiquement."
fi

SERVICE=""
if [ "${ODIN_NO_SERVICE:-}" != "1" ] && ask "Lancer Odin automatiquement au démarrage (interface web + Telegram + tâches) ?" o; then
  if [ "$OS" = darwin ]; then
    PLIST="$HOME/Library/LaunchAgents/ai.odin.gateway.plist"
    mkdir -p "$(dirname "$PLIST")" "$ODIN_HOME/logs"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.odin.gateway</string>
  <key>ProgramArguments</key><array><string>$BIN_DIR/odin</string><string>gateway</string></array>
  <key>EnvironmentVariables</key><dict><key>ODIN_SERVICE</key><string>1</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ODIN_HOME/logs/gateway.log</string>
  <key>StandardErrorPath</key><string>$ODIN_HOME/logs/gateway.log</string>
</dict></plist>
EOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST" && SERVICE=1 && ok "Service macOS installé (launchd)"
  elif command -v systemctl >/dev/null && [ "$(id -u)" = "0" ]; then
    # Installé en root (conteneur LXC, serveur) : service du système. Odin y tourne en root, donc
    # administrateur, et aucun réglage du service ne l'empêche d'agir (pas de NoNewPrivileges).
    UNIT=/etc/systemd/system/odin.service
    cat > "$UNIT" <<EOF
[Unit]
Description=Odin, agent IA personnel
After=network-online.target
Wants=network-online.target

[Service]
ExecStart="$BIN_DIR/odin" gateway
Environment=ODIN_SERVICE=1
Environment=HOME=$HOME
Restart=always
RestartSec=5
# Fichiers créés par Odin lisibles par lui seul
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload && systemctl enable --now odin.service >/dev/null 2>&1 && SERVICE=1 && ok "Service Linux installé (systemd) : Odin est administrateur de cette machine"
    [ -n "$SERVICE" ] || info "Le service n'a pas démarré : lance « odin gateway » toi-même, ou regarde « systemctl status odin »."
  elif command -v systemctl >/dev/null; then
    UNIT="$HOME/.config/systemd/user/odin.service"
    mkdir -p "$(dirname "$UNIT")"
    cat > "$UNIT" <<EOF
[Unit]
Description=Odin, agent IA personnel
After=network-online.target

[Service]
ExecStart="$BIN_DIR/odin" gateway
Environment=ODIN_SERVICE=1
Restart=always
RestartSec=5
# Fichiers créés par Odin lisibles par lui seul
UMask=0077

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload && systemctl --user enable --now odin.service >/dev/null 2>&1 && SERVICE=1 && ok "Service Linux installé (systemd --user)"
    if command -v loginctl >/dev/null && ! loginctl enable-linger "$USER" >/dev/null 2>&1; then
      info "Pour qu'Odin continue après ta déconnexion : sudo loginctl enable-linger $USER"
    fi
  else
    info "Pas de systemd : lance « odin gateway » toi-même (ou via cron @reboot)."
  fi
fi

# ---------- Droits administrateur ----------
# Odin est administrateur de la machine où il est installé : il peut tout y faire (Heimdall reste juge).
# En root (conteneur LXC…), rien à faire. Sinon : règle sudo sans mot de passe, vérifiée par visudo.
# Pour refuser : ODIN_NO_ADMIN=1 (ou répondre « n »).
if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null && [ "${ODIN_NO_ADMIN:-}" != "1" ]; then
  if sudo -n true 2>/dev/null; then
    "$BIN_DIR/odin" admin nopasswd </dev/null >/dev/null 2>&1 && ok "Odin est administrateur de cette machine" || true
  elif [ -r /dev/tty ] && [ "${ODIN_YES:-}" != "1" ]; then
    if ask "Odin doit être administrateur de cette machine pour tout pouvoir y faire. Donner les droits (sudo te demande ton mot de passe une fois) ?" o; then
      "$BIN_DIR/odin" admin nopasswd < /dev/tty && ok "Odin est administrateur de cette machine" || echo "  (plus tard : dis à Odin « le mot de passe admin de ce poste est … », ou : odin admin nopasswd)"
    fi
  else
    info "Droits administrateur : dis à Odin « le mot de passe admin de ce poste est … » (ou lance : odin admin nopasswd)."
  fi
elif [ "$(id -u)" = "0" ]; then ok "Odin est administrateur de cette machine (installé en root)"
elif command -v sudo >/dev/null 2>&1; then :
else
  info "sudo est absent : pour qu'Odin soit administrateur, lance une fois en root : $BIN_DIR/odin admin fix --user $(id -un)"
fi
# À tout moment : « odin admin » dit où en sont les droits, et quoi faire s'il en manque.

# ---------- Fin : configuration dans le navigateur ----------
open_url() {
  if [ "$OS" = darwin ]; then open "$1" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null; then xdg-open "$1" >/dev/null 2>&1 || true; fi
}
echo
gold "ᛟ  Odin est installé"
echo "  Dernière étape : choisis ton modèle dans l'interface web, onglet Réglages."
MISSING=""
for t in ffmpeg yt-dlp pdftotext smbclient tesseract tcpdump; do command -v "$t" >/dev/null || MISSING="$MISSING $t"; done
if [ -n "$MISSING" ]; then
  echo "  Facultatif (vidéos, PDF, partages réseau, lecture d'images, paquets réseau) : il manque$MISSING."
  if command -v apt-get >/dev/null; then echo "    sudo apt install ffmpeg yt-dlp poppler-utils smbclient nfs-common tesseract-ocr tesseract-ocr-fra tcpdump"
  elif [ "$OS" = darwin ]; then echo "    brew install ffmpeg yt-dlp poppler samba tesseract tesseract-lang"; fi
  echo "    (Odin peut aussi les installer lui-même si tu lui donnes les droits administrateur.)"
fi
lan_ip() {
  if [ "$OS" = darwin ]; then ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null
  else hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(10|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.' | head -n1; fi
}
SCHEME=https; [ "$ACCESS" = local ] && SCHEME=http
if [ -n "$SERVICE" ]; then
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$ODIN_HOME/web-token" ] && break; sleep 1; done
  TOKEN="$(cat "$ODIN_HOME/web-token" 2>/dev/null || true)"
  URL="$SCHEME://127.0.0.1:7777/?token=$TOKEN"
  echo "  Interface web : $URL"
  IP="$(lan_ip || true)"
  [ "$ACCESS" != local ] && [ -n "$IP" ] && echo "  Depuis ton téléphone ou un autre appareil du réseau : $SCHEME://$IP:7777/?token=$TOKEN"
  [ "$SCHEME" = https ] && echo "  (certificat créé par Odin : le navigateur demandera de l'accepter une fois)"
  open_url "$URL"
  echo "  Première fois : le premier navigateur de ton réseau qui ouvre Odin devient le tien (bouton Commencer)."
  echo "  Plus tard     : odin link (affiche ce lien) · odin doctor (diagnostic)"
  echo "  (ouvre un nouveau terminal si la commande « odin » est introuvable)"
else
  echo "  Ton lien personnel (avec jeton) :"
  "$BIN_DIR/odin" web link || true
  echo "  Plus tard     : odin link (affiche ce lien) · odin web (rouvre l'interface) · odin gateway (tout en arrière-plan)"
  echo "  (ouvre un nouveau terminal si la commande « odin » est introuvable)"
  if [ "${ODIN_YES:-}" != "1" ] && ask "Ouvrir l'interface web maintenant ? (Ctrl+C pour l'arrêter)" o; then
    exec "$BIN_DIR/odin" web
  fi
fi
