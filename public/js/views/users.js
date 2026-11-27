// Gebruikers (alleen voor de beheerder): accounts aanmaken, een wachtwoord opnieuw instellen, een account uit- of
// inschakelen en verwijderen. Een gebruiker kan luisteren en bewaart favorieten en instellingen op zijn eigen account;
// beheren kan alleen de beheerder. Wachtwoorden staan op de server alleen als hash en zijn nooit terug te lezen.
import { h, icon, replace, toast, openDialog, formatRun, initials, copyText } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { tr } from '../i18n.js';

export function createUsersView() {
  const root = h('section', { class: 'view' });
  let list = null; // de accounts, of null zolang ze nog niet zijn opgehaald
  let loadError = '';

  async function load() {
    try {
      list = (await api('/api/users')).users;
      loadError = '';
    } catch (error) {
      loadError = error.message;
    }
    if (!root.hidden) render();
  }

  function lastLogin(user) {
    return user.lastLogin ? tr(`laatst ingelogd ${formatRun(user.lastLogin)}`, `last login ${formatRun(user.lastLogin)}`) : tr('nog nooit ingelogd', 'never logged in');
  }

  function details(user) {
    const parts = [];
    if (user.name === state.user?.name) parts.push(tr('Dit ben jij', 'This is you'));
    parts.push(lastLogin(user));
    parts.push(user.favorites === 1 ? tr('1 favoriet', '1 favorite') : tr(`${user.favorites} favorieten`, `${user.favorites} favorites`));
    return parts.join(' · ');
  }

  // ------------------------------------------------------------------ vensters

  /** Het wachtwoord van een nieuw of opnieuw ingesteld account: de server toont het één keer. */
  function secretView(dialog, title, user, password) {
    const code = h('pre', { class: 'pwbox', tabindex: '0', 'aria-label': tr('Wachtwoord', 'Password') }, password || '');
    dialog.set(
      h('h2', {}, title),
      password
        ? [
          h('p', { class: 's' }, tr(`Geef dit wachtwoord door aan ${user}. Het wordt maar één keer getoond.`, `Give this password to ${user}. It is shown only once.`)),
          code,
          h('div', { class: 'btns' }, h('button', {
            class: 'btn sm', type: 'button',
            onclick: async () => toast((await copyText(password, code)) ? tr('Gekopieerd.', 'Copied.') : tr('Kopiëren lukt hier niet: selecteer de tekst zelf.', 'Copying does not work here: select the text yourself.'))
          }, tr('Kopiëren', 'Copy')))
        ]
        : h('p', { class: 's' }, tr(`Het wachtwoord van ${user} is ingesteld zoals je het hebt gekozen.`, `The password of ${user} was set as you chose it.`)),
      h('p', { class: 's' }, tr('Hij of zij kan het zelf wijzigen bij Instellingen, onder Mijn account.', 'They can change it themselves under Settings, My account.')),
      h('div', { class: 'btns end' }, h('button', { class: 'btn f', type: 'button', onclick: dialog.close }, tr('Klaar', 'Done'))));
  }

  function passwordField(label) {
    return h('input', { type: 'password', autocomplete: 'new-password', maxlength: '200', 'aria-label': label, placeholder: tr('Leeg laten voor een willekeurig wachtwoord', 'Leave empty for a random password') });
  }

  function createDialog() {
    const dialog = openDialog(tr('Nieuwe gebruiker', 'New user'));
    const name = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: '32' });
    const password = passwordField(tr('Wachtwoord', 'Password'));
    const message = h('div', { class: 'note bad', role: 'alert', hidden: true });
    const submit = h('button', { class: 'btn f', type: 'submit' }, tr('Aanmaken', 'Create'));
    async function onsubmit(event) {
      event.preventDefault();
      submit.disabled = true;
      message.hidden = true;
      try {
        const result = await api('/api/users', { method: 'POST', body: { name: name.value, password: password.value } });
        secretView(dialog, tr('Gebruiker aangemaakt', 'User created'), result.user.name, result.password);
        load();
      } catch (error) {
        message.textContent = error.message;
        message.hidden = false;
        submit.disabled = false;
      }
    }
    dialog.set(h('form', { onsubmit: onsubmit, novalidate: true },
      h('h2', {}, tr('Nieuwe gebruiker', 'New user')),
      h('p', { class: 's' }, tr('Een gebruiker kan luisteren en bewaart favorieten en instellingen op zijn eigen account. Beheren kan alleen jij.', 'A user can listen and keeps favorites and settings on their own account. Only you can manage.')),
      h('label', { class: 'field' }, h('span', {}, tr('Gebruikersnaam', 'Username')), name),
      h('label', { class: 'field' }, h('span', {}, tr('Wachtwoord (minstens 8 tekens)', 'Password (at least 8 characters)')), password),
      message,
      h('div', { class: 'btns end' }, h('button', { class: 'btn', type: 'button', onclick: dialog.close }, tr('Annuleren', 'Cancel')), submit)));
    name.focus();
  }

  function resetDialog(user) {
    const dialog = openDialog(tr('Wachtwoord resetten', 'Reset password'));
    const password = passwordField(tr('Nieuw wachtwoord', 'New password'));
    const message = h('div', { class: 'note bad', role: 'alert', hidden: true });
    const submit = h('button', { class: 'btn f', type: 'submit' }, tr('Resetten', 'Reset'));
    async function onsubmit(event) {
      event.preventDefault();
      submit.disabled = true;
      message.hidden = true;
      try {
        const result = await api(`/api/users/${user.id}/password`, { method: 'POST', body: { password: password.value } });
        secretView(dialog, tr('Wachtwoord opnieuw ingesteld', 'Password reset'), user.name, result.password);
        load();
      } catch (error) {
        message.textContent = error.message;
        message.hidden = false;
        submit.disabled = false;
      }
    }
    dialog.set(h('form', { onsubmit: onsubmit, novalidate: true },
      h('h2', {}, tr(`Wachtwoord van ${user.name} resetten`, `Reset the password of ${user.name}`)),
      h('p', { class: 's' }, tr(`${user.name} wordt op alle apparaten uitgelogd en logt in met het nieuwe wachtwoord.`, `${user.name} is logged out on all devices and logs in with the new password.`)),
      h('label', { class: 'field' }, h('span', {}, tr('Nieuw wachtwoord', 'New password')), password),
      message,
      h('div', { class: 'btns end' }, h('button', { class: 'btn', type: 'button', onclick: dialog.close }, tr('Annuleren', 'Cancel')), submit)));
    password.focus();
  }

  function deleteDialog(user) {
    const dialog = openDialog(tr('Gebruiker verwijderen', 'Delete user'));
    const message = h('div', { class: 'note bad', role: 'alert', hidden: true });
    const confirm = h('button', { class: 'btn f danger-f', type: 'button' }, tr('Verwijderen', 'Delete'));
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      try {
        await api(`/api/users/${user.id}/delete`, { method: 'POST', body: {} });
        dialog.close();
        toast(tr(`${user.name} is verwijderd.`, `${user.name} was deleted.`));
        load();
      } catch (error) {
        message.textContent = error.message;
        message.hidden = false;
        confirm.disabled = false;
      }
    });
    dialog.set(
      h('h2', {}, tr(`${user.name} verwijderen?`, `Delete ${user.name}?`)),
      h('p', { class: 's' }, tr('Het account en de favorieten en instellingen die daarbij horen gaan verloren. Dit kun je niet ongedaan maken.', 'The account and its favorites and settings will be lost. This cannot be undone.')),
      message,
      h('div', { class: 'btns end' }, h('button', { class: 'btn', type: 'button', onclick: dialog.close }, tr('Annuleren', 'Cancel')), confirm));
  }

  async function toggle(user) {
    try {
      await api(`/api/users/${user.id}/disabled`, { method: 'POST', body: { disabled: !user.disabled } });
      toast(user.disabled ? tr(`${user.name} kan weer inloggen.`, `${user.name} can log in again.`) : tr(`${user.name} is uitgeschakeld en meteen uitgelogd.`, `${user.name} was disabled and logged out right away.`));
    } catch (error) {
      toast(error.message, { bad: true });
    }
    load();
  }

  // ------------------------------------------------------------------ pagina

  function row(user) {
    const admin = user.role === 'admin';
    return h('div', { class: `rowi${user.disabled ? ' dim' : ''}`, 'data-user': user.name },
      h('div', { class: 'av', 'aria-hidden': 'true' }, initials(user.name).slice(0, 1)),
      h('div', { class: 'g' },
        h('div', { class: 't' }, user.name, ' ', h('span', { class: `stat ${user.disabled ? 'bad' : 'info'}` }, admin ? tr('Beheerder', 'Administrator') : user.disabled ? tr('Uitgeschakeld', 'Disabled') : tr('Gebruiker', 'User'))),
        h('div', { class: 's' }, details(user))),
      admin
        ? h('div', { class: 's end' }, tr('Wachtwoord: ADMIN_PASSWORD', 'Password: ADMIN_PASSWORD'))
        : h('div', { class: 'acts' },
          user.disabled ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => resetDialog(user) }, icon('key', 14), tr('Wachtwoord resetten', 'Reset password')),
          h('button', { class: 'btn sm', type: 'button', onclick: () => toggle(user) }, user.disabled ? tr('Inschakelen', 'Enable') : tr('Uitschakelen', 'Disable')),
          h('button', { class: 'btn sm danger', type: 'button', onclick: () => deleteDialog(user) }, tr('Verwijderen', 'Delete'))));
  }

  function render() {
    root.setAttribute('aria-label', tr('Gebruikers', 'Users'));
    replace(root,
      h('h1', {}, tr('Gebruikers', 'Users')),
      h('div', { class: 'card' }, h('div', { class: 's', style: 'margin-top:0' }, tr(
        'Inloggen is verplicht zodra ADMIN_PASSWORD is ingesteld. Jij (admin) maakt de accounts aan; gebruikers kunnen luisteren en bewaren hun favorieten en instellingen op hun eigen account, zodat die op elk apparaat gelden.',
        'Logging in is required as soon as ADMIN_PASSWORD is set. You (admin) create the accounts; users can listen and keep their favorites and settings on their own account, so they apply on every device.'))),
      loadError ? h('div', { class: 'note bad' }, loadError) : null,
      h('div', { class: 'sec' }, tr('Accounts', 'Accounts'), list ? h('small', { class: 'muted' }, ` (${list.length})`) : null),
      list ? h('div', { class: 'card rows' }, list.map(row)) : loadError ? null : h('div', { class: 'empty' }, tr('Laden…', 'Loading…')),
      h('div', { class: 'btns' }, h('button', { class: 'btn f', type: 'button', onclick: createDialog }, icon('plus', 16), tr('Nieuwe gebruiker', 'New user'))));
  }

  document.addEventListener('ew:lang', () => { if (!root.hidden) render(); });
  return { el: root, enter() { render(); load(); } };
}
