#!/bin/sh
# Zorgt dat de gegevensmap beschrijfbaar is (een map die Docker zelf aanmaakt is van root) en laat de app daarna als "node" draaien.
set -e
DATA="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  chown -R node:node "$DATA" 2>/dev/null || true
  exec su-exec node "$@"
fi
exec "$@"
