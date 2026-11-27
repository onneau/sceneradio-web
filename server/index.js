import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const app = createApp(config);

if (config.adminPassword && config.adminPassword.length < 8) console.warn('LET OP: ADMIN_PASSWORD is korter dan 8 tekens. Kies een langer wachtwoord.');

app.server.listen(config.port, () => {
  const lines = [
    `SceneRadio Web ${config.version} luistert op poort ${config.port}`,
    `  zenderlijst : ${config.owner}/${config.repo} (${config.playlistPath})`,
    `  leestoken   : ${config.readToken ? 'ingesteld' : 'geen (de lijst is openbaar)'}`,
    `  inloggen    : ${config.adminPassword ? 'verplicht (de beheerder maakt gebruikers aan)' : 'uit: iedereen kan luisteren (stel ADMIN_PASSWORD in)'}`,
    `  data        : ${config.dataDir}`
  ];
  console.log(lines.join('\n'));
  app.warmUp();
});

const shutdown = () => {
  app.server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
