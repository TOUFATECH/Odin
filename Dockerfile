# Odin en conteneur : la passerelle tourne en utilisateur non privilégié,
# l'état (mémoire, compétences, espace de travail) vit dans le volume /data.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
RUN useradd -m odin && mkdir -p /data && chown odin /data
USER odin
# TZ : les heures des tâches planifiées et d'Odin Breaker sont en heure locale du conteneur.
ENV ODIN_HOME=/data NODE_ENV=production TZ=Europe/Paris
VOLUME ["/data"]
# Pour exposer l'API HTTP hors du conteneur : "http": { "host": "0.0.0.0", … } dans /data/config.json
EXPOSE 7777
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:7777/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "bin/odin.mjs", "gateway"]
