// Instellingen: mijn account, taal, weergave van de visualizer en de speler, slogans, back-up, verbinding, Docker en "Over".
import { h, icon, replace, toast, copyText, initials } from '../dom.js';
import { api } from '../api.js';
import { state, subscribe, update, writeJson, setVis, setSlogans, addFavorites, activeSlogans } from '../state.js';
import { sync, logout, logoutEverywhere, changePassword } from '../account.js';
import { visualizerChanged, setVolume } from '../player.js';
import { tr, locale, langSetting, setLangSetting } from '../i18n.js';
import { BRAND, composeText, TIME_TOKEN, MAX_SLOGANS, MAX_SLOGAN_LENGTH } from '../brand.js';
import { makeBackup, parseBackup, fileName } from '../backup.js';

// Wat je op de machine met docker-compose.yml typt om de container bij te werken.
const UPDATE_COMMANDS = 'docker compose pull\ndocker compose up -d';

function kv(label, value, on = true) {
  return h('div', { class: 'kv' }, h('span', {}, label), h('em', { class: on ? '' : 'off' }, value));
}

/** Een rij met een keuze uit een paar mogelijkheden (Uit / Subtiel / Alle kleuren). */
function segmented(key, label, options, value, onPick) {
  return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label },
    options.map(([id, text]) => h('button', {
      class: value === id ? 'on' : '', type: 'button', role: 'radio', 'aria-checked': String(value === id), 'data-k': `${key}-${id}`,
      onclick: () => onPick(id)
    }, text)));
}

/** Een rij met een schakelaar. */
function toggleRow(key, label, small, checked, onChange, disabled = false) {
  return h('label', { class: 'sw' },
    h('span', {}, label, small ? h('small', {}, small) : null),
    h('input', { type: 'checkbox', class: 'tg', checked, disabled, 'data-k': key, onchange: (e) => onChange(e.target.checked) }));
}

/** Een rij met een label (en uitleg) links en een bediening rechts. */
function controlRow(label, small, control) {
  return h('div', { class: 'srow' }, h('div', { class: 'l' }, label, small ? h('small', {}, small) : null), control);
}

export function createSettingsView() {
  const root = h('section', { class: 'view' });
  let updateInfo = null; // laatste antwoord van /api/update (versies en changelog van de webapp zelf)
  let pendingRestore = null; // een gelezen back-upbestand dat op bevestiging wacht

  async function loadUpdate(force = false) {
    try {
      updateInfo = force ? await api('/api/update/check', { method: 'POST', body: {} }) : await api('/api/update');
    } catch {
      updateInfo = null;
    }
    if (!root.hidden) render();
    return updateInfo;
  }

  async function checkNow() {
    const info = await loadUpdate(true);
    if (!info) toast(tr('Controleren lukt nu niet.', 'Checking is not possible right now.'), { bad: true });
    else if (info.error) toast(info.error, { bad: true });
    else toast(info.available ? tr(`Update beschikbaar: versie ${info.latest}.`, `Update available: version ${info.latest}.`) : tr('Je hebt de nieuwste versie.', 'You have the latest version.'));
  }

  /** De melding "Update beschikbaar" met wat er nieuw is en de twee commando's. Alleen als er echt een update is. */
  function updateCard() {
    const u = updateInfo;
    if (!u?.enabled || !u.available) return null;
    const commands = h('pre', { tabindex: '0', 'aria-label': tr("Commando's om bij te werken", 'Commands to update') }, UPDATE_COMMANDS);
    return h('div', { class: 'card upd' },
      h('div', { class: 't' }, tr(`Update beschikbaar: versie ${u.latest}`, `Update available: version ${u.latest}`), h('small', {}, tr(` (jij draait ${u.current})`, ` (you are running ${u.current})`))),
      u.notes.length ? h('div', { class: 's' }, h('b', {}, tr('Wat is nieuw: ', "What's new: ")), u.notes.join(' · ')) : null,
      h('div', { class: 's' }, tr('Voer op de machine waar docker-compose.yml staat uit:', 'Run this on the machine where docker-compose.yml is:')),
      commands,
      h('div', { class: 'btns' },
        h('button', {
          class: 'btn sm', type: 'button',
          onclick: async () => toast((await copyText(UPDATE_COMMANDS, commands)) ? tr('Gekopieerd.', 'Copied.') : tr('Kopiëren lukt hier niet: selecteer de tekst zelf.', 'Copying does not work here: select the text yourself.'), {})
        }, tr('Kopiëren', 'Copy')),
        u.url ? h('a', { class: 'btn sm', href: u.url, target: '_blank', rel: 'noopener noreferrer' }, tr('Wat is nieuw (GitHub)', "What's new (GitHub)")) : null));
  }

  // ------------------------------------------------------------------ mijn account

  let passwordOpen = false; // het formulier "Wachtwoord wijzigen" staat open
  let syncLine = null; // de regel met de bewaarstatus; die wordt los bijgewerkt, zonder de hele pagina te tekenen

  const syncText = () => ({
    saved: tr('Bewaard op de server', 'Saved on the server'),
    pending: tr('Wordt bewaard…', 'Saving…'),
    saving: tr('Wordt bewaard…', 'Saving…'),
    error: tr('Bewaren lukt nu niet; we proberen het straks opnieuw.', 'Saving does not work right now; we will try again shortly.')
  })[sync.state] || '';

  function paintSync() {
    if (!syncLine?.isConnected) return;
    syncLine.textContent = syncText();
    syncLine.classList.toggle('off', sync.state === 'error');
  }

  async function submitPassword(event, fields, message, button) {
    event.preventDefault();
    const [current, next, again] = fields.map((f) => f.value);
    const fail = (text) => { message.textContent = text; message.hidden = false; };
    message.hidden = true;
    if (next.length < 8) return fail(tr('Een wachtwoord heeft minstens 8 tekens.', 'A password has at least 8 characters.'));
    if (next !== again) return fail(tr('De twee nieuwe wachtwoorden zijn niet gelijk.', 'The two new passwords are not the same.'));
    button.disabled = true;
    try {
      await changePassword(current, next);
      passwordOpen = false;
      toast(tr('Je wachtwoord is gewijzigd. Op je andere apparaten moet je opnieuw inloggen.', 'Your password was changed. On your other devices you have to log in again.'));
      render();
    } catch (error) {
      button.disabled = false;
      fail(error.message);
    }
  }

  function passwordForm() {
    const field = (label, auto) => h('input', { type: 'password', autocomplete: auto, maxlength: '200', 'aria-label': label });
    const fields = [field(tr('Huidig wachtwoord', 'Current password'), 'current-password'), field(tr('Nieuw wachtwoord', 'New password'), 'new-password'), field(tr('Nieuw wachtwoord nog eens', 'New password again'), 'new-password')];
    const message = h('div', { class: 'note bad', role: 'alert', hidden: true });
    const button = h('button', { class: 'btn f sm', type: 'submit' }, tr('Wijzigen', 'Change'));
    return h('form', { class: 'pwform', novalidate: true, onsubmit: (event) => submitPassword(event, fields, message, button) },
      h('label', { class: 'field' }, h('span', {}, tr('Huidig wachtwoord', 'Current password')), fields[0]),
      h('label', { class: 'field' }, h('span', {}, tr('Nieuw wachtwoord (minstens 8 tekens)', 'New password (at least 8 characters)')), fields[1]),
      h('label', { class: 'field' }, h('span', {}, tr('Nieuw wachtwoord nog eens', 'New password again')), fields[2]),
      message,
      h('div', { class: 'btns', style: 'margin-top:0' }, button, h('button', { class: 'btn sm', type: 'button', onclick: () => { passwordOpen = false; render(); } }, tr('Annuleren', 'Cancel'))));
  }

  /** Wie ben ik, worden mijn favorieten en instellingen bewaard, wachtwoord wijzigen en uitloggen. Alleen als er is ingelogd. */
  function accountCard() {
    const user = state.user;
    if (!user) return null;
    syncLine = h('em', { class: sync.state === 'error' ? 'off' : '' }, syncText());
    return h('div', { class: 'card', id: 'account' },
      h('div', { class: 't' }, tr('Mijn account', 'My account')),
      h('div', { class: 'me' },
        h('div', { class: 'av', 'aria-hidden': 'true' }, initials(user.name).slice(0, 1)),
        h('div', { class: 'g' }, h('b', {}, user.name), h('div', { class: 's' }, user.role === 'admin' ? tr('Beheerder', 'Administrator') : tr('Gebruiker', 'User')))),
      h('div', { class: 'kv' }, h('span', {}, tr('Favorieten en instellingen', 'Favorites and settings')), syncLine),
      passwordOpen ? passwordForm() : null,
      h('div', { class: 'btns' },
        user.role === 'admin' || passwordOpen ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => { passwordOpen = true; render(); } }, icon('key', 14), tr('Wachtwoord wijzigen', 'Change password')),
        h('button', { class: 'btn sm', type: 'button', onclick: logout }, icon('logout', 14), tr('Uitloggen', 'Log out'))),
      user.role === 'admin' ? h('div', { class: 's' }, tr('Het wachtwoord van de beheerder stel je in met ADMIN_PASSWORD in docker-compose.yml.', 'The administrator password is set with ADMIN_PASSWORD in docker-compose.yml.')) : null,
      h('div', { class: 's' }, tr('Favorieten, taal, visualizer-instellingen, slogans, volume en laatste zender volgen je account op elk apparaat; na het vernieuwen van de pagina zie je wijzigingen van een ander apparaat.', 'Favorites, language, visualizer settings, slogans, volume and last station follow your account on every device; after refreshing the page you see changes from another device.')),
      h('div', { class: 'btns' },
        h('button', {
          class: 'btn sm', type: 'button',
          onclick: async () => {
            try {
              await logoutEverywhere();
            } catch (error) {
              toast(error.message, { bad: true });
            }
          }
        }, tr('Overal uitloggen', 'Log out everywhere'))));
  }

  // ------------------------------------------------------------------ taal

  function languageCard() {
    const options = [['auto', tr('Volg de browser', 'Follow the browser')], ['nl', 'Nederlands'], ['en', 'English']];
    return h('div', { class: 'card' },
      h('div', { class: 't' }, tr('Taal', 'Language'), ' / ', tr('Language', 'Taal')),
      controlRow(tr('Taal van de webapp', 'Language of the web app'), tr('De pagina past zich meteen aan. Foutmeldingen van de server ook.', 'The page changes right away, and so do the messages from the server.'),
        segmented('lang', tr('Taal', 'Language'), options, langSetting(), (value) => setLangSetting(value))));
  }

  // ------------------------------------------------------------------ weergave

  function displayCard() {
    const vis = state.vis;
    const config = state.config;
    const coversOn = Boolean(config?.covers);
    const copperHints = {
      off: tr('De koperbalken houden hun vaste kleur.', 'The copper bars keep their fixed color.'),
      subtle: tr('Subtiel laat de balken langzaam verkleuren.', 'Subtle lets the bars change color slowly.'),
      all: tr('Alle kleuren laat de balken in een minuut door de hele regenboog lopen.', 'All colors lets the bars run through the whole rainbow in a minute.')
    };
    const sensitivity = h('input', {
      type: 'range', min: '50', max: '150', step: '5', value: String(Math.round(vis.eqSensitivity * 100)), 'data-k': 'eq',
      'aria-label': tr('Gevoeligheid equalizer', 'Equalizer sensitivity'),
      oninput: (e) => { sensitivityText.textContent = `${e.target.value} %`; e.target.style.setProperty('--fill', `${(e.target.value - 50)}%`); },
      onchange: (e) => setVis({ eqSensitivity: Number(e.target.value) / 100 })
    });
    sensitivity.style.setProperty('--fill', `${Math.round(vis.eqSensitivity * 100) - 50}%`);
    const sensitivityText = h('output', { class: 'val' }, `${Math.round(vis.eqSensitivity * 100)} %`);

    const visualizer = toggleRow('vis', tr('Visualizer', 'Visualizer'), tr('Uit toont het logo van de zender; dat scheelt rekenwerk op een oud apparaat of telefoon.', 'Off shows the logo of the station; that saves processing on an old device or phone.'), state.visualizer,
      (on) => { writeJson('ew.visualizer', on); update({ visualizer: on }); visualizerChanged(); });

    return h('div', { class: 'card' },
      h('div', { class: 't' }, tr('Weergave', 'Display')),
      visualizer,
      controlRow(tr('Koperkleur', 'Copper color'), copperHints[vis.copperMode],
        segmented('copper', tr('Koperkleur', 'Copper color'), [['off', tr('Uit', 'Off')], ['subtle', tr('Subtiel', 'Subtle')], ['all', tr('Alle kleuren', 'All colors')]], vis.copperMode, (v) => setVis({ copperMode: v }))),
      toggleRow('sparkle', tr('Fonkelende sterren', 'Sparkling stars'), tr('De sterren flikkeren zacht en af en toe fonkelt er een met een kruisje.', 'The stars twinkle softly and now and then one sparkles with a cross of light.'), vis.sparkling, (on) => setVis({ sparkling: on })),
      controlRow(tr('Gevoeligheid equalizer', 'Equalizer sensitivity'), tr('Lager = rustiger: alleen de pieken komen hoog.', 'Lower = calmer: only the peaks go high.'), h('div', { class: 'sliderbox' }, sensitivity, sensitivityText)),
      toggleRow('dim', tr('Dimmen na 30 seconden', 'Dim after 30 seconds'), tr('Naar 80 %, tik of beweeg om weer helder te maken.', 'To 80 %, tap or move to brighten again.'), vis.dim, (on) => setVis({ dim: on })),
      toggleRow('cover', tr('Hoes in de visualizer', 'Cover in the visualizer'),
        coversOn ? tr('Van het nummer dat speelt (MusicBrainz), geen verzamelalbums.', 'Of the song that is playing (MusicBrainz), no compilation albums.') : tr('Staat uit op de server (COVERS=false).', 'Turned off on the server (COVERS=false).'),
        vis.cover && coversOn, (on) => setVis({ cover: on }), !coversOn),
      controlRow(tr('Hoesgrootte en plek', 'Cover size and position'), null, h('div', { class: 'segs' },
        segmented('csize', tr('Hoesgrootte', 'Cover size'), [['small', tr('Klein', 'Small')], ['medium', tr('Middel', 'Medium')], ['large', tr('Groot', 'Large')]], vis.coverSize, (v) => setVis({ coverSize: v })),
        segmented('cpos', tr('Plek van de hoes', 'Cover position'), [['default', tr('Standaard', 'Default')], ['left', tr('Links', 'Left')], ['center', tr('Midden', 'Center')], ['right', tr('Rechts', 'Right')]], vis.coverPosition, (v) => setVis({ coverPosition: v })))),
      toggleRow('pcover', tr('Hoes in de speler', 'Cover in the player'), tr('Tik op de hoes voor volledig scherm.', 'Tap the cover for full screen.'), vis.coverInPlayer && coversOn, (on) => setVis({ coverInPlayer: on }), !coversOn),
      toggleRow('photo', tr('Foto van de artiest als er geen hoes is', 'Photo of the artist if there is no cover'),
        config?.deezer ? tr('Wikimedia, daarna Deezer.', 'Wikimedia, then Deezer.') : tr('Wikimedia.', 'Wikimedia.'), vis.artistPhoto && coversOn, (on) => setVis({ artistPhoto: on }), !coversOn),
      h('div', { class: 's', style: 'margin-top:10px' }, state.user
        ? tr('Favorieten, volume en de laatst beluisterde zender bewaart de webapp bij je account op de server. De hoezen zoekt de server voor je op; je browser praat niet met MusicBrainz of Wikimedia.', 'The web app keeps favorites, volume and the last station you listened to with your account on the server. The server looks up the covers for you; your browser does not talk to MusicBrainz or Wikimedia.')
        : tr('Favorieten, volume en de laatst beluisterde zender worden in deze browser bewaard. De hoezen zoekt de server voor je op; je browser praat niet met MusicBrainz of Wikimedia.', 'Favorites, volume and the last station you listened to are kept in this browser. The server looks up the covers for you; your browser does not talk to MusicBrainz or Wikimedia.')));
  }

  // ------------------------------------------------------------------ slogans

  function slogansCard() {
    const area = h('textarea', {
      class: 'slogans', rows: '8', spellcheck: 'false', autocomplete: 'off', 'data-k': 'slogans',
      'aria-label': tr('Slogans, één per regel', 'Slogans, one per line'),
      onchange: () => setSlogans(area.value.split('\n'))
    });
    area.value = activeSlogans().join('\n');
    const insertTime = () => {
      const start = area.selectionStart ?? area.value.length;
      const end = area.selectionEnd ?? start;
      area.setRangeText(TIME_TOKEN, start, end, 'end');
      area.focus();
      setSlogans(area.value.split('\n'));
    };
    return h('div', { class: 'card' },
      h('div', { class: 't' }, tr('Slogans', 'Slogans')),
      area,
      h('div', { class: 'btns', style: 'margin-top:8px' },
        h('button', { class: 'btn sm', type: 'button', onclick: insertTime }, tr('Tijd invoegen', 'Insert time')),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { setSlogans(null); toast(tr('De standaardslogans staan weer terug.', 'The default slogans are back.')); } }, tr('Standaardslogans herstellen', 'Restore default slogans'))),
      h('div', { class: 's' }, tr(
        `Eén slogan per regel (hooguit ${MAX_SLOGANS}, elk tot ${MAX_SLOGAN_LENGTH} tekens). ${TIME_TOKEN} wordt de lokale tijd van je apparaat. Leeg laten geeft de standaardslogans.`,
        `One slogan per line (at most ${MAX_SLOGANS}, each up to ${MAX_SLOGAN_LENGTH} characters). ${TIME_TOKEN} becomes the local time of your device. Leaving it empty gives the default slogans.`)));
  }

  // ------------------------------------------------------------------ back-up

  function saveBackup() {
    const text = makeBackup(BRAND.appId, {
      language: langSetting(), visualizer: state.visualizer, vis: state.vis, slogans: state.slogans,
      volume: state.volume, favorites: [...state.favorites], last: state.currentId
    });
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = h('a', { href: url, download: fileName(BRAND.filePrefix), hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(tr('De back-up is bewaard als bestand.', 'The backup was saved as a file.'));
  }

  const BACKUP_ERRORS = () => ({
    big: tr('Dit bestand is te groot voor een back-up.', 'This file is too large for a backup.'),
    json: tr('Dit is geen geldig back-upbestand.', 'This is not a valid backup file.'),
    format: tr('Dit is geen back-up van EtherWave Radio of SceneRadio.', 'This is not a backup of EtherWave Radio or SceneRadio.'),
    'app-backup': tr('Dit is een back-up van een Android-app, niet van de webapp. Zet die terug in de app.', 'This is a backup of an Android app, not of the web app. Restore it in the app.'),
    version: tr('Deze back-up komt van een nieuwere versie. Werk de webapp eerst bij.', 'This backup comes from a newer version. Update the web app first.')
  });

  async function chooseBackup(file) {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast(BACKUP_ERRORS().big, { bad: true });
      return;
    }
    const result = parseBackup(await file.text());
    if (result.error) {
      toast(BACKUP_ERRORS()[result.error], { bad: true });
      return;
    }
    pendingRestore = result.backup;
    render();
  }

  function restoreSummary(b) {
    const lines = [];
    if (b.favorites.length) lines.push(tr(`${b.favorites.length} favorieten (komen erbij)`, `${b.favorites.length} favorites (added)`));
    if (b.volume !== null) lines.push(tr('volume', 'volume'));
    if (b.language) lines.push(tr('taal', 'language'));
    if (b.visualizer !== null || b.vis) lines.push(tr('visualizer-instellingen', 'visualizer settings'));
    if (b.hasSlogans) lines.push(tr(`slogans (${(b.slogans || []).length || 'standaard'})`, `slogans (${(b.slogans || []).length || 'default'})`));
    if (b.lastStation) lines.push(tr('laatste zender', 'last station'));
    return lines;
  }

  function applyRestore(b) {
    if (b.visualizer !== null) { writeJson('ew.visualizer', b.visualizer); update({ visualizer: b.visualizer }); visualizerChanged(); }
    if (b.vis) setVis(b.vis);
    if (b.hasSlogans) setSlogans(b.slogans);
    if (b.volume !== null) setVolume(b.volume);
    if (b.favorites.length) addFavorites(b.favorites);
    if (b.lastStation && !state.currentId && state.stations.some((s) => s.id === b.lastStation)) {
      writeJson('ew.last', b.lastStation);
      update({ currentId: b.lastStation });
    }
    setLangSetting(b.language);
    pendingRestore = null;
    toast(tr('De back-up is teruggezet.', 'The backup has been restored.'));
    render();
  }

  function backupCard() {
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => { const file = fileInput.files?.[0]; fileInput.value = ''; chooseBackup(file); } });
    const box = pendingRestore
      ? h('div', { class: 'note' },
        h('b', {}, tr('Terugzetten uit deze back-up?', 'Restore from this backup?')),
        h('div', {}, restoreSummary(pendingRestore).join(' · ') || tr('Niets om terug te zetten.', 'Nothing to restore.')),
        h('div', { class: 's' }, tr('Bestaande instellingen worden overschreven; favorieten komen erbij en er wordt niets verwijderd.', 'Existing settings are overwritten; favorites are added and nothing is deleted.')),
        h('div', { class: 'btns', style: 'margin-top:8px' },
          h('button', { class: 'btn f sm', type: 'button', onclick: () => applyRestore(pendingRestore) }, tr('Terugzetten', 'Restore')),
          h('button', { class: 'btn sm', type: 'button', onclick: () => { pendingRestore = null; render(); } }, tr('Annuleren', 'Cancel'))))
      : null;
    return h('div', { class: 'card' },
      h('div', { class: 't' }, tr('Back-up', 'Backup')),
      h('div', { class: 's' }, tr('Favorieten, volume, laatste zender, taal, visualizer-instellingen en slogans van deze browser in één bestand.', 'Favorites, volume, last station, language, visualizer settings and slogans of this browser in one file.')),
      h('div', { class: 'btns' },
        h('button', { class: 'btn f sm', type: 'button', onclick: saveBackup }, tr('Back-up bewaren (.json)', 'Save backup (.json)')),
        h('button', { class: 'btn sm', type: 'button', onclick: () => fileInput.click() }, tr('Back-up terugzetten…', 'Restore backup…')),
        fileInput),
      box,
      h('div', { class: 's' }, tr('Dit is alleen wat in deze browser staat. De zenderlijst zelf komt van de server.', 'This is only what is stored in this browser. The station list itself comes from the server.')));
  }

  // ------------------------------------------------------------------ rest

  function aboutCard(config) {
    const u = updateInfo;
    const note = !u?.enabled ? null
      : u.error ? tr(`Updatecontrole mislukt: ${u.error}`, `Update check failed: ${u.error}`)
      : u.available ? null
      : u.checkedAt ? tr('Je hebt de nieuwste versie.', 'You have the latest version.') : null;
    return h('div', { class: 'card' },
      h('div', { class: 't' }, tr('Over', 'About'), ' ', h('small', { class: 'muted' }, `${BRAND.webName} ${config ? 'v' + config.version : ''}`)),
      h('div', { class: 's' }, tr('Licentie: PolyForm Noncommercial 1.0.0. Geen verband met de zenders in de lijst.', 'License: PolyForm Noncommercial 1.0.0. No connection to the stations in the list.')),
      h('div', { class: 's' }, tr(
        `Hoezen: MusicBrainz en het Cover Art Archive. Artiestenfoto's: Wikimedia Commons${config?.deezer ? ' en Deezer' : ''}. Amiga-lettertypes uit Stone Oakvalley's ColorFonts Generator.`,
        `Covers: MusicBrainz and the Cover Art Archive. Artist photos: Wikimedia Commons${config?.deezer ? ' and Deezer' : ''}. Amiga fonts from Stone Oakvalley's ColorFonts Generator.`)),
      h('div', { class: 'btns', style: 'margin-top:8px' },
        h('a', { class: 'btn sm', href: BRAND.repoUrl, target: '_blank', rel: 'noopener noreferrer' }, 'GitHub'),
        u?.enabled ? h('button', { class: 'btn sm', type: 'button', onclick: checkNow }, tr('Nu controleren', 'Check now')) : null),
      note ? h('div', { class: 's' }, note) : null);
  }

  function render() {
    const config = state.config;
    const focused = document.activeElement?.dataset?.k;
    const updated = state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : null;
    root.setAttribute('aria-label', tr('Instellingen', 'Settings'));

    const compose = composeText();
    const code = h('pre', { tabindex: '0', 'aria-label': 'docker-compose.yml' }, compose);
    const copy = h('button', {
      class: 'btn sm', type: 'button',
      onclick: async () => toast((await copyText(compose, code)) ? tr('Gekopieerd.', 'Copied.') : tr('Kopiëren lukt hier niet: selecteer de tekst zelf.', 'Copying does not work here: select the text yourself.'), {})
    }, tr('Kopiëren', 'Copy'));

    replace(root,
      h('h1', {}, tr('Instellingen', 'Settings')),
      updateCard(),
      h('div', { class: 'two' },
        h('div', {}, accountCard(), languageCard(), displayCard(), slogansCard(), backupCard()),
        h('div', {},
          h('div', { class: 'card' },
            h('div', { class: 't' }, tr('Verbinding', 'Connection')),
            kv(tr('Zenderlijst', 'Station list'), config ? config.repo : '…'),
            kv(tr('Aantal zenders', 'Number of stations'), String(state.stations.length)),
            kv(tr('Laatst opgehaald', 'Last fetched'), updated || tr('nog niet', 'not yet'), Boolean(updated)),
            kv(tr('Inloggen', 'Logging in'), config?.loginRequired ? tr('verplicht', 'required') : tr('uit (geen ADMIN_PASSWORD)', 'off (no ADMIN_PASSWORD)'), Boolean(config?.loginRequired)),
            state.loadError ? h('div', { class: 'note bad' }, state.loadError) : null),
          h('div', { class: 'card' },
            h('div', { class: 't' }, tr('Draaien in Docker', 'Running in Docker')),
            h('div', { class: 's' }, tr('Zo draai je deze webapp zelf op een NAS of in een Proxmox-container. Zet het in docker-compose.yml en start met "docker compose up -d".', 'This is how you run this web app yourself on a NAS or in a Proxmox container. Put it in docker-compose.yml and start with "docker compose up -d".')),
            code,
            h('div', { class: 'btns', style: 'margin-top:8px' }, copy)),
          aboutCard(config))));

    if (focused) root.querySelector(`[data-k="${focused}"]`)?.focus();
  }

  subscribe(() => {
    if (root.hidden) return;
    // Niet midden in het slepen van de schuif of het typen van slogans alles opnieuw tekenen.
    const active = document.activeElement;
    if (root.contains(active) && active.matches('input[type=range], input[type=password], textarea')) return;
    render();
  });
  document.addEventListener('ew:sync', paintSync);
  document.addEventListener('ew:lang', () => { if (!root.hidden) render(); });
  return { el: root, enter() { render(); loadUpdate(); } };
}
