# SceneRadio als webapp. Geen npm-pakketten nodig: alleen Node.js zelf.
FROM node:22-alpine

LABEL org.opencontainers.image.title="SceneRadio Web" \
      org.opencontainers.image.source="https://github.com/onneau/sceneradio-web" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080

# su-exec: de container start als root om /data netjes van de juiste eigenaar te voorzien en draait daarna als gebruiker "node".
# tzdata: zodat TZ=Europe/Amsterdam klopt.
RUN apk add --no-cache su-exec tzdata

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY LICENSE NOTICE ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /data \
    && chown node:node /data

VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/config" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
