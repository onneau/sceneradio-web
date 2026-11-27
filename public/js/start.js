// Het begin van de webapp. Eerst vraagt de pagina de server of er ingelogd moet worden:
//   - ja en nog niet ingelogd: alleen het inlogscherm (de rest van de webapp wordt dan niet eens geladen)
//   - ingelogd: het profiel van het account wordt opgehaald en met deze browser vergeleken (account.js), dan start de webapp
//   - inloggen staat uit (geen ADMIN_PASSWORD): de webapp start zoals altijd
import { h, replace } from './dom.js';
import { lang, tr } from './i18n.js';

async function fetchConfig() {
  const response = await fetch('/api/config', { credentials: 'same-origin', headers: { 'X-Lang': lang() } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function showProblem(retry) {
  replace(document.getElementById('app'), h('main', { class: 'signin' }, h('div', { class: 'login' },
    h('h1', {}, tr('Geen verbinding met de server.', 'No connection to the server.')),
    h('p', { class: 'muted signin-sub' }, tr('Probeer het zo meteen opnieuw.', 'Try again in a moment.')),
    h('div', { class: 'btns', style: 'justify-content:center' }, h('button', { class: 'btn f', type: 'button', onclick: retry }, tr('Opnieuw proberen', 'Try again'))))));
}

async function start() {
  let config;
  try {
    config = await fetchConfig();
  } catch {
    showProblem(start);
    return;
  }
  if (config.loginRequired && !config.user) {
    (await import('./views/login.js')).showLogin();
    return;
  }
  let account = null;
  if (config.user) {
    account = await import('./account.js');
    try {
      await account.reconcile(config.user);
    } catch (error) {
      if (error.status === 401) {
        location.reload(); // de sessie is net verlopen: opnieuw beginnen geeft het inlogscherm
        return;
      }
      throw error;
    }
  }
  const { update } = await import('./state.js');
  update({ config, user: config.user ?? null });
  await import('./main.js');
  account?.startSync(config.user);
}

start();
