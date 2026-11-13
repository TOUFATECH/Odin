# Odin en conteneur : la passerelle tourne sous le compte « odin », qui est administrateur DU CONTENEUR
# (sudo sans mot de passe : Odin peut y installer ce dont il a besoin ; le conteneur reste la limite).
# L'état (mémoire, compétences, espace de travail) vit dans le volume /data.
# Ne lance pas le conteneur avec « no-new-privileges » : sudo n'y marcherait plus (Odin te le dirait).
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
# Outils dont les applis ont besoin (sans eux : fausses pannes de Pulsar, réseau et processus illisibles) :
# ip et ss (iproute2), ping (iputils-ping), ps et kill (procps), pare-feu de Cerbère (nftables).
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends sudo ca-certificates curl git tcpdump openssh-client iproute2 iputils-ping procps nftables >/dev/null \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m odin && mkdir -p /data && chown odin /data \
 && printf 'odin ALL=(ALL:ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/odin && chmod 0440 /etc/sudoers.d/odin && visudo -cf /etc/sudoers.d/odin
USER odin
# TZ : les heures des tâches planifiées et d'Odin Breaker sont en heure locale du conteneur.
ENV ODIN_HOME=/data NODE_ENV=production TZ=Europe/Paris
VOLUME ["/data"]
# Pour qu'Odin voie les appareils de la maison (balayage, identification, démarrage réseau, DNS, VPN), lance le
# conteneur sur le réseau de la machine : docker run --network host --cap-add NET_ADMIN --cap-add NET_RAW …
# Sur un réseau « bridge » (par défaut), il ne voit que le réseau du conteneur et te le dit.
# Pour exposer l'API HTTP hors du conteneur : "http": { "host": "0.0.0.0", … } dans /data/config.json
EXPOSE 7777
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:7777/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "bin/odin.mjs", "gateway"]
