# Changelog

Per version a heading `## <version number>` (the same as `version` in `package.json`) with a list, in two languages under
`### English` and `### Nederlands`. The GitHub Action puts the lines under the heading of the new version in the GitHub
Release, and the web app shows them under Settings at "Update available", in the visitor's language.

Per versie een kopje `## <versienummer>` met een opsomming, in twee talen. De GitHub Action zet de regels in de GitHub
Release, en de webapp toont ze onder Instellingen bij "Update beschikbaar", in de taal van de bezoeker.

## 1.0.0
### English
- New: SceneRadio as a web app in one Docker container: listen to the default station list (from the public sceneradio-m3u repository) with the Amiga visualizer, on a computer, tablet or phone
- New: Dutch and English, selectable under Settings (by default the page follows your browser)
- New: the cover of the song that is playing, in the visualizer and in the player (tap for full screen); without a cover a photo of the artist (Wikimedia)
- New: copper color, sparkling stars, equalizer sensitivity, dimming after 30 seconds and your own slogans, as in the Android app
- New: backup and restore of the settings of this browser (favorites, volume, last station, language, visualizer and slogans) in one .json file
- New: notice in Settings when a newer version is available, with the two commands to update
- Note: listen-only. There is no management, no password and no tokens; the server relays the streams and does not store audio

### Nederlands
- Nieuw: SceneRadio als webapp in één Docker-container: luister naar de standaard zenderlijst (uit de publieke repository sceneradio-m3u) met de Amiga-visualizer, op een computer, tablet of telefoon
- Nieuw: Nederlands en English, te kiezen onder Instellingen (standaard volgt de pagina je browser)
- Nieuw: de hoes van het nummer dat speelt, in de visualizer en in de speler (tik voor volledig scherm); zonder hoes een foto van de artiest (Wikimedia)
- Nieuw: koperkleur, fonkelende sterren, gevoeligheid van de equalizer, dimmen na 30 seconden en eigen slogans, zoals in de Android-app
- Nieuw: back-up en terugzetten van de instellingen van deze browser (favorieten, volume, laatste zender, taal, visualizer en slogans) in één .json-bestand
- Nieuw: melding in Instellingen als er een nieuwere versie is, met de twee commando's om bij te werken
- Let op: alleen luisteren. Er is geen beheer, geen wachtwoord en geen token; de server geeft de streams door en slaat geen audio op
