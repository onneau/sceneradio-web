# SceneRadio web

[Nederlandse versie](README.nl.md)

SceneRadio as a website, in one Docker container: listen to Dutch radio with the Amiga visualizer, on a computer, tablet or phone. It is the web version of the Android app [SceneRadio](https://github.com/onneau/sceneradio) and uses the same station list: [sceneradio-m3u](https://github.com/onneau/sceneradio-m3u) (public, updated daily, with logos).

- **Listening**: search and filter stations, favorites, volume, "now playing" with the cover of the song, media controls from your keyboard or phone. The sound goes through the container (stream proxy), so streams without https also work on an https page.
- **Visualizer**: the Amiga look with copper bars, stars and slogans. Copper color, sparkling stars, equalizer sensitivity, dimming and your own slogans (with `{tijd}` for the local time) are in Settings.
- **Covers and artist photos**: the server looks up the cover of the song that is playing (MusicBrainz and the Cover Art Archive) and otherwise a photo of the artist (Wikimedia Commons). Your browser does not talk to those services itself.
- **Bilingual**: Dutch and English, selectable under Settings (by default the page follows your browser).
- **Backup**: favorites, volume, last station, language, visualizer settings and slogans of your browser in one `.json` file.
- **Listen-only**: no management of the station list, no tokens. The server never writes to GitHub. Optional: with an `ADMIN_PASSWORD` you turn on logging in, with accounts that the administrator creates (see *Logging in*); favorites and settings then follow your account on every device.

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

## Logging in (optional)

By default anyone who can reach the web app can listen. If you set an `ADMIN_PASSWORD` (at least 8 characters), logging in becomes required for everyone: nobody gets in without an account, not even to listen.

- **Administrator**: log in with the name `admin` and the password from `ADMIN_PASSWORD`. That password is only in your compose file; if you change it, all sessions of the administrator become invalid. The administrator only manages the accounts: the station list and tokens are not part of it.
- **Users**: the administrator creates them under **Users**, with a name and a password or with a random password that is shown once. A user can listen and changes their own password under Settings → My account. The administrator can reset a password, disable an account (the user is logged out right away) and delete it (with the favorites and settings). Creating an account yourself is not possible, and no email is needed. At most 100 users.
- **What follows your account**: favorites, language, visualizer settings, slogans, volume and last station. They are on the server (`./data/profiles`) and are the same on every device; a change from another device shows up after refreshing the page. If you log in for the first time in a browser that already had favorites, they are merged with those of your account. Logging out wipes this data from the browser, so on a shared computer nothing of the previous user is left behind.
- **Lost password**: the administrator sets a new one. If the administrator's password is lost, change `ADMIN_PASSWORD` and restart the container.

## Using the player

- **Player**: the visualizer fills the whole screen and adapts to the shape of your screen (landscape, portrait or widescreen). That also works when you resize the window or turn the phone.
- **Controls**: previous, pause, next and volume are laid over the picture. While music is playing they disappear after 8 seconds; move the mouse or tap the picture to bring them back. When paused or on an error they stay.
- **Menus**: the menu at the top left opens Stations and Settings, each on its own page. "← Player" takes you back; after choosing a station you go back to the visualizer by itself. The menu pages have a mini player at the bottom.
- **Back to the visualizer**: the menus go back to the visualizer by themselves after 10 seconds without movement, tap or key press (only while music is playing, not while you are typing). Esc does it right away.
- **Keys**: space bar = pause, ← and → = previous or next station, F = full screen (or the button at the top right).
- On opening, the page shows the player if there is a last station, otherwise the station list.

## Settings (environment variables)

All optional.

| Variable | Default | Meaning |
|---|---|---|
| `WEB_PORT` | `8080` | Port on the machine (in `.env` or the compose file, not in the container). |
| `TZ` | `Europe/Amsterdam` | Time zone. |
| `MAX_LISTENERS` | `40` | Maximum number of simultaneous listeners. The container relays every stream, so this protects your connection. |
| `ADMIN_PASSWORD` | empty | Password of the administrator (account `admin`), at least 8 characters. With a password, logging in is required for everyone and the administrator creates the users. Empty: no login, anyone can listen. |
| `SESSION_SECRET`, `SESSION_DAYS` | automatic, `30` | Signing and duration of the login session (with "Stay logged in"; otherwise one day). Without `SESSION_SECRET` one is kept in `/data/secret`. |
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

- Nothing is written to GitHub: the server only reads the public station list and relays streams. It has no tokens and no endpoints that change the station list. Logging in is off by default; with `ADMIN_PASSWORD` it is required for everyone. Users' passwords are stored only as a scrypt hash, the session is a signed, HttpOnly, SameSite=Strict cookie that becomes invalid when the administrator disables or deletes the account or resets the password, and the message for a wrong attempt is the same for an unknown name and a wrong password. Wrong attempts are limited (5 per 5 minutes per address, 10 per 15 minutes per username); too many for one name block that name for 15 minutes, also for its real owner. Over plain http your password travels unencrypted through your network: use https through a reverse proxy.
- The server only fetches streams from the station list, and refuses addresses on its own network (unless `ALLOW_PRIVATE_STREAMS=true`). Fetched covers are checked on file type and size.
- The container does not run as root (only the start-up script changes the owner of `/data`).
- Cover lookups are limited per visitor, and the number of listeners is capped (`MAX_LISTENERS`).
- Without logging in, favorites, volume, last station, language, visualizer settings and slogans stay in your own browser. With logging in they are kept per account on the server (`./data/profiles`). The server keeps no listening history.
- Think about bandwidth before you open it to the internet: every listener costs the server one stream, both in and out.

## Known limitations

- **Old-style Shoutcast streams** (the reply starts with `ICY 200 OK`) are not accepted by Node.js.
- **Covers** are not always right: the title from a stream is no guarantee, and a compilation album is skipped. The Amiga look of a cover is deliberately coarse.
- **The visualizer** uses WebAudio. On an old iPhone or iPad that can stutter: turn it off in Settings; you then see the logo.
- Pausing with a live stream is "disconnecting"; playing picks up the live stream again.
- The backup is not encrypted. A backup of an Android app does not fit here.

## Testing locally (test server)

Before you publish anything you can try the web app on your own computer, for example in the Linux environment of a Chromebook. The test server uses a simulated GitHub with sample stations (`dev/seed`), so nothing in your repositories is touched.

```bash
sh testserver.sh            # demo with sample stations
sh testserver.sh --live     # the real station list from the public sceneradio-m3u repository
```

In the demo, logging in is on: administrator `admin` with password `test`, and a sample user `anna` with password `proefanna1`. With `--open` there is no login, as without `ADMIN_PASSWORD`.

Then open <http://localhost:8081> in Chrome. Stop with Ctrl+C.

- `--live` needs no token: the default list is public. You can point it at your own copy with `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_REF` and `PLAYLIST_PATH`.
- `--update` pretends a newer version exists (to see the update notice), `--poort 8082` picks another port.
- Playing streams and looking up covers also go over the internet in the demo. Only a few stations in the demo have a logo.
- The script uses Node.js 20 or newer; without it, it uses Docker, and otherwise it tells you how to install Node.js.

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
