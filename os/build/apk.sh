#!/usr/bin/env bash
# Odin OS — « Odin Launcher », l'écran d'accueil Odin OS pour téléphone Android (APK).
# Embarque le bureau (mode essai, hors ligne) et se relie à Odin : sur le téléphone même (base Ubuntu dans Termux) ou sur ton serveur.
# Produit os/sortie/odin-os-<version>-launcher.apk. Outils : aapt, javac, dalvik-exchange, zipalign, apksigner (paquets Debian/Ubuntu).
. "$(dirname "$0")/commun.sh"
besoin aapt javac dalvik-exchange zipalign apksigner keytool
PLATEFORME="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
[ -f "$PLATEFORME" ] || { echo "android.jar introuvable ($PLATEFORME) : installe libandroid-23-java, ou donne ANDROID_JAR=…" >&2; exit 1; }
SRC="$RACINE/os/android"; T="$TRAVAIL/apk"
rm -rf "$T"; mkdir -p "$T/gen" "$T/classes" "$T/assets/os/fonts" "$SORTIE"

dire "Odin Launcher $VERSION_OS (APK)"
# Le bureau embarqué : les fichiers du bureau, le visage d'Odin et les polices.
cp -r "$RACINE/src/os/shell/." "$T/assets/os/"
cp "$RACINE/src/web/face.js" "$T/assets/os/"
cp "$RACINE"/src/web/fonts/ibm-plex-sans-latin-{400,500,600}-normal.woff2 "$T/assets/os/fonts/"
sed "s/android:versionName=\"[^\"]*\"/android:versionName=\"$VERSION_OS\"/" "$SRC/AndroidManifest.xml" > "$T/AndroidManifest.xml"

aapt package -f -m -J "$T/gen" -M "$T/AndroidManifest.xml" -S "$SRC/res" -I "$PLATEFORME"
javac -nowarn -source 8 -target 8 -bootclasspath "$PLATEFORME" -d "$T/classes" $(find "$SRC/src" "$T/gen" -name '*.java') 2>&1 | grep -v "^warning\|^Note\|^[0-9]* warning" || true
[ -n "$(find "$T/classes" -name 'Lanceur.class')" ] || { echo "La compilation Java a échoué." >&2; exit 1; }
dalvik-exchange --dex --output="$T/classes.dex" "$T/classes"
aapt package -f -M "$T/AndroidManifest.xml" -S "$SRC/res" -A "$T/assets" -I "$PLATEFORME" -F "$T/odin.brut.apk"
( cd "$T" && aapt add odin.brut.apk classes.dex >/dev/null )
zipalign -f 4 "$T/odin.brut.apk" "$T/odin.aligne.apk"

# Clé de signature : créée une fois, à garder (une mise à jour de l'appli doit être signée avec la même clé).
# Le fichier de la clé reste sur cette machine (jamais dans le dépôt). Son mot de passe se choisit avec ODIN_OS_CLE_PASSE.
CLE="${ODIN_OS_CLE:-$HOME/.odin-os/odin-launcher.jks}"; export ODIN_OS_CLE_PASSE="${ODIN_OS_CLE_PASSE:-odin-os}"
if [ ! -f "$CLE" ]; then mkdir -p "$(dirname "$CLE")"; keytool -genkeypair -keystore "$CLE" -storepass:env ODIN_OS_CLE_PASSE -keypass:env ODIN_OS_CLE_PASSE -alias odin -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Odin OS, O=TOUFATECH" >/dev/null 2>&1; chmod 600 "$CLE"; echo "  Clé de signature créée : $CLE (garde-la)"; fi
F="$SORTIE/odin-os-$VERSION_OS-launcher.apk"
apksigner sign --ks "$CLE" --ks-pass env:ODIN_OS_CLE_PASSE --key-pass env:ODIN_OS_CLE_PASSE --ks-key-alias odin --out "$F" "$T/odin.aligne.apk"
rm -f "$F.idsig"; apksigner verify "$F" >/dev/null
rm -rf "$T"
dire "Odin Launcher prêt"
empreinte "$F"
