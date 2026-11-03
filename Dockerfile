# Odin en conteneur : la passerelle tourne en utilisateur non privilégié,
# l'état (mémoire, compétences, espace de travail) vit dans le volume /data.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
RUN useradd -m odin && mkdir -p /data && chown odin /data
USER odin
ENV ODIN_HOME=/data NODE_ENV=production
VOLUME ["/data"]
# Pour exposer l'API HTTP hors du conteneur : "http": { "host": "0.0.0.0", … } dans /data/config.json
EXPOSE 7777
CMD ["node", "bin/odin.mjs", "gateway"]
