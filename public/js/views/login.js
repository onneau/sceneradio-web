// Het inlogscherm: één scherm voor iedereen, de beheerder (naam "admin") en de gebruikers die de beheerder heeft aangemaakt.
// Zelf een account maken kan niet. Na het inloggen laadt de pagina opnieuw en komt de rest van de webapp in beeld.
import { h, icon, replace } from '../dom.js';
import { api } from '../api.js';
import { tr, lang, setLangSetting } from '../i18n.js';
import { BRAND } from '../brand.js';

export function showLogin() {
  const app = document.getElementById('app');
  const typed = { name: '', password: '', remember: true };
  let busy = false;
  let reveal = false;

  function draw(message = '') {
    document.title = BRAND.name;
    const name = h('input', {
      type: 'text', id: 'login-name', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: '64',
      value: typed.name, oninput: (e) => { typed.name = e.target.value; }
    });
    const password = h('input', {
      type: reveal ? 'text' : 'password', id: 'login-password', autocomplete: 'current-password', maxlength: '200',
      value: typed.password, oninput: (e) => { typed.password = e.target.value; }
    });
    const remember = h('input', { type: 'checkbox', class: 'cb', id: 'login-remember', checked: typed.remember, onchange: (e) => { typed.remember = e.target.checked; } });
    const note = h('div', { class: 'note bad', role: 'alert', id: 'login-error', hidden: !message }, message);
    const button = h('button', { class: 'btn f', type: 'submit', id: 'login-submit' }, icon('lock', 16), tr('Inloggen', 'Log in'));

    const show = (text) => { note.textContent = text; note.hidden = !text; };
    async function submit(event) {
      event.preventDefault();
      if (busy) return;
      if (!typed.name.trim() || !typed.password) {
        show(tr('Vul je gebruikersnaam en wachtwoord in.', 'Enter your username and password.'));
        (typed.name.trim() ? password : name).focus();
        return;
      }
      busy = true;
      button.disabled = true;
      show('');
      try {
        await api('/api/login', { method: 'POST', body: { name: typed.name.trim(), password: typed.password, remember: typed.remember } });
        location.reload();
      } catch (error) {
        busy = false;
        button.disabled = false;
        typed.password = '';
        password.value = '';
        show(error.message);
        password.focus();
      }
    }

    const language = (code, label) => h('button', { type: 'button', class: lang() === code ? 'on' : '', 'aria-pressed': String(lang() === code), onclick: () => setLangSetting(code) }, label);

    replace(app, h('main', { class: 'signin' },
      h('form', { class: 'login', onsubmit: submit, novalidate: true, 'aria-labelledby': 'login-title' },
        h('img', { class: 'signin-logo', src: '/icons/icon-192.png', width: '72', height: '72', alt: '' }),
        h('h1', { id: 'login-title' }, BRAND.name),
        h('p', { class: 'muted signin-sub' }, tr('Log in om te luisteren.', 'Log in to listen.')),
        h('label', { class: 'field' }, h('span', {}, tr('Gebruikersnaam', 'Username')), name),
        h('label', { class: 'field' }, h('span', {}, tr('Wachtwoord', 'Password')), password,
          h('button', {
            class: 'eye', type: 'button', 'aria-label': reveal ? tr('Wachtwoord verbergen', 'Hide password') : tr('Wachtwoord tonen', 'Show password'), 'aria-pressed': String(reveal),
            onclick: () => { reveal = !reveal; draw(note.hidden ? '' : note.textContent); document.getElementById('login-password')?.focus(); }
          }, icon(reveal ? 'eyeoff' : 'eye', 20))),
        note,
        h('label', { class: 'check' }, remember, h('span', {}, tr('Ingelogd blijven op dit apparaat', 'Stay logged in on this device'))),
        h('div', { class: 'btns', style: 'justify-content:center' }, button),
        h('p', { class: 'small muted signin-help' }, tr('Nog geen account? Vraag de beheerder om er een voor je aan te maken.', 'No account yet? Ask the administrator to create one for you.')),
        h('p', { class: 'small muted signin-help' }, tr('De beheerder logt in met de naam admin.', 'The administrator logs in with the name admin.')),
        h('div', { class: 'signin-lang', role: 'group', 'aria-label': tr('Taal', 'Language') }, language('nl', 'Nederlands'), language('en', 'English')))));
    (typed.name ? document.getElementById('login-password') : document.getElementById('login-name'))?.focus();
  }

  document.addEventListener('ew:lang', () => draw());
  draw();
}
