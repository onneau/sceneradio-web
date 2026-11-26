# SceneRadio web

[English version](README.md)

SceneRadio als website, in één Docker-container: luister naar Nederlandse radio met de Amiga-visualizer, op een computer, tablet of telefoon. Het is de webversie van de Android-app [SceneRadio](https://github.com/onneau/sceneradio) en gebruikt dezelfde zenderlijst: [sceneradio-m3u](https://github.com/onneau/sceneradio-m3u) (publiek, elke dag bijgewerkt, met logo's).

- **Luisteren**: zenders zoeken en filteren, favorieten, volume, "nu speelt" met de hoes van het nummer, mediabediening van je toetsenbord of telefoon. Het geluid loopt via de container (stream-proxy), zodat streams zonder https ook op een https-pagina werken.
- **Visualizer**: de Amiga-look met koperbalken, sterren en slogans. Koperkleur, fonkelende sterren, gevoeligheid van de equalizer, dimmen en eigen slogans (met `{tijd}` voor de lokale tijd) staan onder Instellingen.
- **Hoezen en artiestenfoto's**: de server zoekt de hoes van het nummer dat speelt (MusicBrainz en het Cover Art Archive) en anders een foto van de artiest (Wikimedia Commons). Je browser praat zelf niet met die diensten.
- **Tweetalig**: Nederlands en English, te kiezen onder Instellingen (standaard volgt de pagina je browser).
- **Back-up**: favorieten, volume, laatste zender, taal, visualizer-instellingen en slogans van je browser in één `.json`-bestand.
- **Alleen luisteren**: geen beheer, geen wachtwoord, geen tokens. De server schrijft nooit naar GitHub.

Geen npm-pakketten. Alleen Node.js 22 (zit in het Docker-image).

## Aan de slag

Je hebt een machine met Docker nodig (NAS, Proxmox-container of VM, Raspberry Pi, elke pc).

In één regel:

```bash
docker run -d --name sceneradio-web --restart unless-stopped -p 8080:8080 -v "$(pwd)/sceneradio-data:/data" ghcr.io/onneau/sceneradio-web:latest
```

Of met Docker Compose: zet de `docker-compose.yml` uit deze repository op de machine en voer uit

```bash
docker compose up -d
```

Open daarna `http://<ip-van-de-machine>:8080`. Onder **Instellingen** in de webapp staat ook een kant-en-klare `docker-compose.yml` om te plakken in Container Manager (Synology) of Portainer.

Bijwerken: de webapp meldt onder Instellingen dat er een nieuwere versie is, met de twee commando's:

```
docker compose pull
docker compose up -d
```

## Bediening

- **Speler**: de visualizer vult het hele scherm en past zich aan de verhouding van je scherm aan (liggend, staand of breedbeeld). Dat werkt ook als je het venster verkleint of de telefoon draait.
- **Bediening**: vorige, pauze, volgende en volume liggen over het beeld. Terwijl er muziek speelt verdwijnen ze na 8 seconden; beweeg de muis of tik op het beeld om ze terug te halen. Bij pauze of een storing blijven ze staan.
- **Menu's**: het menu linksboven opent Zenders en Instellingen, elk op een eigen pagina. Met "← Speler" ga je terug; na het kiezen van een zender ga je vanzelf terug naar de visualizer. Onderaan de menupagina's staat een mini-speler.
- **Terug naar de visualizer**: de menu's gaan na 10 seconden zonder beweging, tik of toets vanzelf terug naar de visualizer (alleen terwijl er muziek speelt, niet tijdens het typen). Esc doet het meteen.
- **Toetsen**: spatiebalk = pauze, ← en → = vorige of volgende zender, F = volledig scherm (of de knop rechtsboven).
- Bij het openen toont de pagina de speler als er al een laatste zender is, anders de zenderlijst.

## Instellingen (omgevingsvariabelen)

Allemaal optioneel.

| Variabele | Standaard | Betekenis |
|---|---|---|
| `WEB_PORT` | `8080` | Poort op de machine (in `.env` of het compose-bestand, niet in de container). |
| `TZ` | `Europe/Amsterdam` | Tijdzone. |
| `MAX_LISTENERS` | `40` | Maximum aantal gelijktijdige luisteraars. De container geeft elke stream door, dit beschermt je verbinding. |
| `TRUST_PROXY` | `false` | `true` achter een reverse proxy die zelf `X-Forwarded-For` zet (zie hieronder). |
| `COVERS` | `true` | Hoezen en artiestenfoto's. Op `false` zoekt de server niets op. |
| `COVERS_RATE_PER_MINUTE` | `30` | Hoeveel hoeslookups per minuut één bezoeker mag laten doen. |
| `PLAYLIST_TTL_SECONDS` | `300` | Hoe vaak de zenderlijst opnieuw wordt opgehaald. |
| `ALLOW_PRIVATE_STREAMS` | `false` | Streams in je eigen netwerk toestaan (192.168.x.x). Laat dit uit op een server die anderen kunnen bereiken. |
| `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_REF`, `PLAYLIST_PATH` | `onneau`, `sceneradio-m3u`, `main`, `nederlandse-radio.m3u` | Waar de zenderlijst vandaan komt. Je kunt ze naar je eigen kopie van de lijst laten wijzen. |
| `GITHUB_READ_TOKEN` | leeg | Alleen als je eigen lijst in een privé-repository staat (Contents: Read-only). |
| `UPDATE_CHECK` | `true` | `false` zet de updatemelding onder Instellingen uit. |
| `UPDATE_REPO`, `UPDATE_TTL_SECONDS` | `onneau/sceneradio-web`, `21600` | Waar de nieuwste Release vandaan komt, en hoe vaak (seconden) de webapp kijkt. |

## Achter een reverse proxy (https)

De container spreekt gewoon http. Voor https zet je een reverse proxy ervoor (Nginx Proxy Manager, Caddy, Traefik of de proxy van je NAS). Twee dingen tellen:

- **Geen buffering** van de streams, en een lange time-out: radio is een verbinding die uren openstaat.
- Geef `X-Forwarded-For` door en zet `TRUST_PROXY=true`, zodat de limiet op hoeslookups bezoekers apart telt. Zet het alleen aan als de proxy de header zelf zet en niet doorgeeft wat een bezoeker meestuurt.

Voorbeelden (Caddy en Nginx) staan in de Engelse README.

## Veiligheid en privacy

- Er is niets om in te loggen en niets om naartoe te schrijven: de server leest alleen de publieke zenderlijst en geeft streams door. Hij heeft geen wachtwoord, geen tokens en geen endpoints die iets wijzigen.
- De server haalt alleen streams op uit de zenderlijst en weigert adressen in zijn eigen netwerk (tenzij `ALLOW_PRIVATE_STREAMS=true`). Opgehaalde hoezen worden op bestandstype en grootte gecontroleerd.
- De container draait niet als root (alleen het startscript geeft `/data` de juiste eigenaar).
- Hoeslookups zijn per bezoeker begrensd en het aantal luisteraars heeft een plafond (`MAX_LISTENERS`).
- Favorieten, volume, laatste zender, taal, visualizer-instellingen en slogans blijven in je eigen browser. De server houdt geen accounts en geen luistergeschiedenis bij.
- Denk aan bandbreedte voordat je hem voor het internet openzet: elke luisteraar kost de server één stream, zowel in als uit.

## Bekende beperkingen

- **Oude Shoutcast-streams** (het antwoord begint met `ICY 200 OK`) accepteert Node.js niet.
- **Hoezen** kloppen niet altijd: de titel uit een stream is geen garantie, en een verzamelalbum wordt overgeslagen. De Amiga-weergave van een hoes is bewust grof.
- **De visualizer** gebruikt WebAudio. Op een oude iPhone of iPad kan dat haperen: zet hem uit onder Instellingen; je ziet dan het logo.
- Pauzeren bij een live stream is "verbinding verbreken"; afspelen pakt de live stream weer op.
- De back-up is niet versleuteld. Een back-up van een Android-app past hier niet.

## Lokaal testen (testserver)

Voordat je iets publiceert kun je de webapp op je eigen computer proberen, bijvoorbeeld in de Linux-omgeving van een Chromebook. De testserver gebruikt een nagebootste GitHub met voorbeeldzenders (`dev/seed`), dus er wordt niets in je repositories aangeraakt.

```bash
sh testserver.sh            # demo met voorbeeldzenders
sh testserver.sh --live     # de echte zenderlijst uit de publieke repository sceneradio-m3u
```

Open daarna <http://localhost:8081> in Chrome. Stoppen met Ctrl+C.

- `--live` heeft geen token nodig: de standaardlijst is openbaar. Met `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_REF` en `PLAYLIST_PATH` wijs je naar een eigen kopie.
- `--update` doet alsof er een nieuwere versie is (voor de updatemelding), `--poort 8082` kiest een andere poort.
- Streams afspelen en hoezen opzoeken gaan ook in de demo via internet. Alleen enkele zenders in de demo hebben een logo.
- Het script gebruikt Node.js 20 of nieuwer; ontbreekt dat, dan gebruikt het Docker, en anders vertelt het hoe je Node.js installeert.

## Ontwikkelen

```bash
npm test          # alle tests (Node.js 20 of nieuwer)
DATA_DIR=./data PORT=8080 node server/index.js
```

De tests starten de server tegen een nagebootst GitHub en nagebootste radiostreams.

## Licentie en disclaimer

© 2026 Onno · [PolyForm Noncommercial License 1.0.0](LICENSE)

- Gebruiken, aanpassen, forken en delen mag, voor niet-commerciële doeleinden (privé, hobby, onderzoek, onderwijs, goede doelen).
- Commercieel gebruik is niet toegestaan.
- Geef je het door, ook een aangepaste versie, geef dan `LICENSE` en `NOTICE` mee.

SceneRadio is een hobbyproject en heeft op geen enkele manier verband met de radiozenders, omroepen of andere rechthebbenden wier namen, logo's of streams in de zenderlijst staan. Die namen en logo's zijn van hun eigenaren. Wil een rechthebbende iets laten verwijderen, meld het dan via GitHub ([onneau](https://github.com/onneau)). Zie `NOTICE` voor wat niet onder deze licentie valt (lettertypes, logo's, hoezen en foto's).
