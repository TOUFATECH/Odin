# Odin OS — image Docker construite depuis le dépôt d'Odin, sans droits root ni debootstrap :
#   docker build -t odin-os:0.1.0 -f os/docker/Dockerfile .
#   docker run -d --name odin-os -p 127.0.0.1:7788:7777 -v odin-os-donnees:/home/odin odin-os:0.1.0
# Puis ouvre http://localhost:7788/os/ (« odin os installer --docker » fait tout cela pour toi).
# Node.js officiel (celui du dépôt Ubuntu est compilé sans la lecture directe du TypeScript, dont Odin a besoin).
FROM node:22-bookworm-slim AS node

FROM ubuntu:26.04
COPY --from=node /usr/local/bin/node /opt/node/bin/node

ENV DEBIAN_FRONTEND=noninteractive
# Système léger : pas de paquets « recommandés », pas de documentation.
RUN printf 'APT::Install-Recommends "false";\nAPT::Install-Suggests "false";\nAcquire::Languages "none";\n' > /etc/apt/apt.conf.d/90odin \
 && printf 'path-exclude=/usr/share/doc/*\npath-include=/usr/share/doc/*/copyright\npath-exclude=/usr/share/man/*\npath-exclude=/usr/share/info/*\n' > /etc/dpkg/dpkg.cfg.d/odin-leger \
 && apt-get update -q \
 && apt-get install -y ca-certificates sudo iproute2 procps tzdata \
 && ln -s /opt/node/bin/node /usr/local/bin/node \
 && rm -rf /var/lib/apt/lists/* \
 # Le compte « odin » fait tourner Odin ; l'image officielle a déjà un compte « ubuntu » avec le même numéro.
 && (userdel -r ubuntu 2>/dev/null || true) \
 && useradd -m -u 1000 -s /bin/bash -c "Odin" odin \
 && printf 'odin ALL=(ALL:ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/odin && chmod 0440 /etc/sudoers.d/odin

COPY package.json LICENSE /opt/odin/
COPY bin /opt/odin/bin
COPY src /opt/odin/src
COPY os/rootfs/commun/ /
RUN chmod +x /usr/local/bin/odin /usr/local/bin/odin-os-demarrer /usr/local/lib/odin-os/pont \
 && mkdir -p /etc/odin-os && echo docker > /etc/odin-os/cible \
 && sed -i -e 's/^NAME=.*/NAME="Odin OS"/' -e 's/^ID=.*/ID=odin-os/' -e 's/^ID_LIKE=.*/ID_LIKE="ubuntu debian"/' -e 's/^PRETTY_NAME=.*/PRETTY_NAME="Odin OS"/' /etc/os-release

ENV ODIN_OS=1 ODIN_OS_CIBLE=docker HOME=/home/odin LANG=C.UTF-8
USER odin
WORKDIR /home/odin
EXPOSE 7777
VOLUME /home/odin
ENTRYPOINT ["/usr/local/bin/odin-os-demarrer"]
