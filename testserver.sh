#!/bin/sh
# Start de testserver (zie dev/testserver.js en het kopje "Lokaal testen" in de README).
#   sh testserver.sh            demo met voorbeeldzenders
#   sh testserver.sh --live     de echte zenderlijst van GitHub, alleen lezen
#   sh testserver.sh --help     alle opties
# Gebruikt Node.js 20 of nieuwer; als dat ontbreekt maar Docker er is, draait het in een tijdelijke Docker-container.
cd "$(dirname "$0")" || exit 1

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 1
  [ "${major:-0}" -ge 20 ]
}

if node_ok; then
  exec node dev/testserver.js "$@"
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Node.js 20 of nieuwer ontbreekt; ik gebruik Docker (de eerste keer duurt het ophalen van het Node-image even)."
  exec docker run --rm -it --network host --user "$(id -u):$(id -g)" \
    -e GITHUB_READ_TOKEN -e GITHUB_OWNER -e GITHUB_REPO -e GITHUB_REF -e PLAYLIST_PATH -e PORT \
    -v "$PWD":/app:ro -w /app node:22-alpine node dev/testserver.js "$@"
fi

cat <<'TEKST'
Node.js 20 of nieuwer ontbreekt, en Docker is niet beschikbaar.

Installeer Node.js 22 één keer met deze twee regels en start daarna opnieuw met "sh testserver.sh":

  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
TEKST
exit 1
