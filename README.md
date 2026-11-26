# SceneRadio web

[Nederlandse versie](README.nl.md)

SceneRadio as a website, in one Docker container: listen to Dutch radio with the Amiga visualizer, on a computer, tablet or phone. It is the web version of the Android app [SceneRadio](https://github.com/onneau/sceneradio) and uses the same station list: [sceneradio-m3u](https://github.com/onneau/sceneradio-m3u) (public, updated daily, with logos).

- **Listening**: search and filter stations, favorites, volume, "now playing" with the cover of the song, media controls from your keyboard or phone. The sound goes through the container (stream proxy), so streams without https also work on an https page.
- **Visualizer**: the Amiga look with copper bars, stars and slogans. Copper color, sparkling stars, equalizer sensitivity, dimming and your own slogans (with `{tijd}` for the local time) are in Settings.
- **Covers and artist photos**: the server looks up the cover of the song that is playing (MusicBrainz and the Cover Art Archive) and otherwise a photo of the artist (Wikimedia Commons). Your browser does not talk to those services itself.
- **Bilingual**: Dutch and English, selectable under Settings (by default the page follows your browser).
- **Backup**: favorites, volume, last station, language, visualizer settings and slogans of your browser in one `.json` file.
- **Listen-only**: no management, no password, no tokens. The server never writes to GitHub.

No npm packages. Only Node.js 22 (included in the Docker image).

## Getting started

You need a machine with Docker (NAS, Proxmox container or VM, Raspberry Pi, any PC).

One line:

```bash
docker run -d --name sceneradio-web --restart unless-stopped -p 8080:8080 -v "$(pwd)/sceneradio-data:/data" ghcr.io/onneau/sceneradio-web:latest
```

Or with Docker Compose: put the `docker-compose.yml` from this repository on the machine and run

```bash
docker compose up -d
```

Then open `http://<ip-of-the-machine>:8080`. Under **Settings** in the web app you also find a ready-made `docker-compose.yml` to paste into Container Manager (Synology) or Portainer.

Updating: the web app tells you under Settings when there is a newer version, with the two commands:

```
docker compose pull
docker compose up -d
```

## Settings (environment variables)

All optional.

| Variable | Default | Meaning |
|---|---|---|
| `WEB_PORT` | `8080` | Port on the machine (in `.env` or the compose file, not in the container). |
| `TZ` | `Europe/Amsterdam` | Time zone. |
| `MAX_LISTENERS` | `40` | Maximum number of simultaneous listeners. The container relays every stream, so this protects your connection. |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy that sets `X-Forwarded-For` itself (see below). |
| `COVERS` | `true` | Covers and artist photos. At `false` the server looks nothing up. |
| `COVERS_RATE_PER_MINUTE` | `30` | How many cover lookups per minute one visitor may cause. |
| `PLAYLIST_TTL_SECONDS` | `300` | How often the station list is fetched again. |
| `ALLOW_PRIVATE_STREAMS` | `false` | Allow streams on your own network (192.168.x.x). Leave it off on a server that others can reach. |
| `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_REF`, `PLAYLIST_PATH` | `onneau`, `sceneradio-m3u`, `main`, `nederlandse-radio.m3u` | Where the station list comes from. You can point them at your own copy of the list. |
| `GITHUB_READ_TOKEN` | empty | Only if your own list is in a private repository (Contents: Read-only). |
| `UPDATE_CHECK` | `true` | `false` turns off the update notice in Settings. |
| `UPDATE_REPO`, `UPDATE_TTL_SECONDS` | `onneau/sceneradio-web`, `21600` | Where the latest Release comes from, and how often (seconds) the web app looks. |

## Behind a reverse proxy (https)

The container just speaks http. For https you put a reverse proxy in front (Nginx Proxy Manager, Caddy, Traefik, or the proxy of your NAS). Two things matter:

- **No buffering** of the streams, and a long time-out: radio is a connection that stays open for hours.
- Pass on `X-Forwarded-For` and set `TRUST_PROXY=true`, so the limit on cover lookups counts visitors separately. Set it only if the proxy sets the header itself and does not pass on what a visitor sends.

Caddy:

```
radio.example.com {
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
    }
}
```

Nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

## Security and privacy

- There is nothing to log in to and nothing to write to: the server only reads the public station list and relays streams. It has no password, no tokens and no endpoints that change anything.
- The server only fetches streams from the station list, and refuses addresses on its own network (unless `ALLOW_PRIVATE_STREAMS=true`). Fetched covers are checked on file type and size.
- The container does not run as root (only the start-up script changes the owner of `/data`).
- Cover lookups are limited per visitor, and the number of listeners is capped (`MAX_LISTENERS`).
- Favorites, volume, last station, language, visualizer settings and slogans stay in your own browser. The server keeps no accounts and no listening history.
- Think about bandwidth before you open it to the internet: every listener costs the server one stream, both in and out.

## Known limitations

- **Old-style Shoutcast streams** (the reply starts with `ICY 200 OK`) are not accepted by Node.js.
- **Covers** are not always right: the title from a stream is no guarantee, and a compilation album is skipped. The Amiga look of a cover is deliberately coarse.
- **The visualizer** uses WebAudio. On an old iPhone or iPad that can stutter: turn it off in Settings; you then see the logo.
- Pausing with a live stream is "disconnecting"; playing picks up the live stream again.
- The backup is not encrypted. A backup of an Android app does not fit here.

## Development

```bash
npm test          # all tests (Node.js 20 or newer)
DATA_DIR=./data PORT=8080 node server/index.js
```

The tests start the server against a simulated GitHub and simulated radio streams.

## License and disclaimer

© 2026 Onno · [PolyForm Noncommercial License 1.0.0](LICENSE)

- Using, changing, forking and sharing is allowed, for non-commercial purposes (private, hobby, research, education, charities).
- Commercial use is not allowed.
- If you pass it on, also a changed version, keep `LICENSE` and `NOTICE` with it.

SceneRadio is a hobby project and has no connection whatsoever with the radio stations, broadcasters or other rights holders whose names, logos or streams appear in the station list. Those names and logos belong to their owners. If a rights holder wants something removed, report it via GitHub ([onneau](https://github.com/onneau)). See `NOTICE` for what is not covered by this license (fonts, logos, covers and photos).
