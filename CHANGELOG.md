# Changelog

Per version a heading `## <version number>` (the same as `version` in `package.json`) with a list, in two languages under
`### English` and `### Nederlands`. The GitHub Action puts the lines under the heading of the new version in the GitHub
Release, and the web app shows them under Settings at "Update available", in the visitor's language.

Per versie een kopje `## <versienummer>` met een opsomming, in twee talen. De GitHub Action zet de regels in de GitHub
Release, en de webapp toont ze onder Instellingen bij "Update beschikbaar", in de taal van de bezoeker.

## 1.2.0
### English
- New: logging in with your own account. If you set `ADMIN_PASSWORD`, logging in is required (the administrator logs in as `admin`) and the administrator creates the accounts for others under Users. Without `ADMIN_PASSWORD` nothing changes
- New: favorites, language, visualizer settings, slogans, volume and last station belong to your account and apply on every device; logging out wipes them from the browser
- New: Users (administrator only): create an account (with a random password that is shown once), reset the password, disable and delete; Settings → My account: change password, log out and log out everywhere
- Note: with an `ADMIN_PASSWORD`, nobody can listen without an account any more. The login screen is in Dutch and English

### Nederlands
- Nieuw: inloggen met een eigen account. Stel je `ADMIN_PASSWORD` in, dan is inloggen verplicht (de beheerder logt in als `admin`) en maakt de beheerder onder Gebruikers de accounts voor anderen aan. Zonder `ADMIN_PASSWORD` verandert er niets
- Nieuw: favorieten, taal, visualizer-instellingen, slogans, volume en laatste zender horen bij je account en gelden op elk apparaat; uitloggen wist ze uit de browser
- Nieuw: Gebruikers (alleen voor de beheerder): account aanmaken (met een willekeurig wachtwoord dat één keer wordt getoond), wachtwoord opnieuw instellen, uitschakelen en verwijderen; Instellingen → Mijn account: wachtwoord wijzigen, uitloggen en overal uitloggen
- Let op: met een `ADMIN_PASSWORD` kan niemand meer luisteren zonder account. Het inlogscherm staat in het Nederlands en Engels

## 1.1.1
### English
- Fixed: the controls now always disappear after 8 seconds without movement, also when the mouse stays over the buttons, a button still has focus or the stream stalls briefly; only when paused or on an error do they stay
- New: the menus (Stations, Settings) go back to the visualizer by themselves after 10 seconds without movement, tap or key press, as long as music is playing and you are not typing; the Esc key does it right away
- Improved: choosing a station first goes to the visualizer and only then starts the music, so going back does not depend on the stream
- New: the slogans in the visualizer are typed, swing opposite to the station name and are erased again, as in the Android app

### Nederlands
- Opgelost: de bediening verdwijnt nu altijd na 8 seconden zonder beweging, ook als de muis boven de knoppen blijft staan, een knop nog de focus heeft of de stream even stokt; alleen bij pauze of een storing blijft ze staan
- Nieuw: de menu's (Zenders, Instellingen) gaan na 10 seconden zonder beweging, tik of toets vanzelf terug naar de visualizer, zolang er muziek speelt en je niet aan het typen bent; de Esc-toets doet het meteen
- Verbeterd: een zender kiezen gaat eerst naar de visualizer en start dan pas de muziek, zodat het terugkeren niet van de stream afhangt
- Nieuw: de slogans in de visualizer worden getypt, zwaaien tegengesteld aan de zendernaam en worden weer gewist, zoals in de Android-app

## 1.1.0
### English
- New: the player is now the whole screen: the visualizer fills the picture and adapts to the shape of your screen (landscape, portrait or widescreen, on a phone, tablet, laptop or TV)
- New: the controls (previous, pause, next, volume) are laid over the picture and disappear after 8 seconds while music is playing; move the mouse or tap the picture to bring them back. Keys: space bar, arrows and F for full screen
- Improved: Stations and Settings are on their own page, via the menu at the top left; "← Player" takes you back. After choosing a station you go straight back to the visualizer
- New: test server for your own computer: `sh testserver.sh` (with sample stations, or with `--live` using the real station list)

### Nederlands
- Nieuw: de speler is nu het hele scherm: de visualizer vult het beeld en past zich aan de verhouding van je scherm aan (liggend, staand of breedbeeld, op een telefoon, tablet, laptop of tv)
- Nieuw: de bediening (vorige, pauze, volgende, volume) ligt over het beeld en verdwijnt na 8 seconden terwijl er muziek speelt; beweeg de muis of tik op het beeld om haar terug te halen. Toetsen: spatiebalk, pijltjes en F voor volledig scherm
- Verbeterd: Zenders en Instellingen staan op een eigen pagina, via het menu linksboven; "← Speler" brengt je terug. Na het kiezen van een zender ga je meteen terug naar de visualizer
- Nieuw: testserver voor je eigen computer: `sh testserver.sh` (met voorbeeldzenders, of met `--live` met de echte zenderlijst)

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
