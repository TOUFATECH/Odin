#!/usr/bin/env bash
# Odin OS — image Docker : la base Ubuntu + Odin, avec Odin comme programme principal du conteneur.
# Produit os/sortie/odin-os-<version>-<arch>-docker.tar.gz (à charger avec « docker load -i »).
. "$(dirname "$0")/commun.sh"
racine_requise; besoin docker tar gzip
"$(dirname "$0")/base.sh"

ETIQUETTE="odin-os:$VERSION_OS"; [ "$ARCH" = amd64 ] || ETIQUETTE="odin-os:$VERSION_OS-$ARCH"
dire "Image Docker $ETIQUETTE"
R="$TRAVAIL/docker-$ARCH"; rm -rf "$R"; cp -a "$BASE" "$R"; rm -f "$R/.pret"
mkdir -p "$R/etc/odin-os"; echo docker > "$R/etc/odin-os/cible"
chown -R 1000:1000 "$R/home/odin"
mkdir -p "$SORTIE"
tar -C "$R" --numeric-owner -c . | docker import --platform "linux/$ARCH" \
  --change 'ENV ODIN_OS=1 ODIN_OS_CIBLE=docker HOME=/home/odin LANG=C.UTF-8' \
  --change 'USER odin' --change 'WORKDIR /home/odin' --change 'EXPOSE 7777' --change 'VOLUME /home/odin' \
  --change 'ENTRYPOINT ["/usr/local/bin/odin-os-demarrer"]' \
  --change "LABEL org.opencontainers.image.title=\"Odin OS\" org.opencontainers.image.version=\"$VERSION_OS\" org.opencontainers.image.source=\"https://github.com/TOUFATECH/Odin\"" \
  - "$ETIQUETTE" >/dev/null
rm -rf "$R"
F="$SORTIE/odin-os-$VERSION_OS-$ARCH-docker.tar.gz"
docker save "$ETIQUETTE" | gzip -9 > "$F"
dire "Image Docker prête"
empreinte "$F"
echo "  Lancer : docker load -i $(basename "$F") && docker run -d --name odin-os -p 127.0.0.1:7788:7777 -v odin-os-donnees:/home/odin $ETIQUETTE"
