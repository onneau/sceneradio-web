import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const app = createApp(config);

app.server.listen(config.port, () => {
  const lines = [
    `SceneRadio Web ${config.version} luistert op poort ${config.port}`,
    `  zenderlijst : ${config.owner}/${config.repo} (${config.playlistPath})`,
    `  leestoken   : ${config.readToken ? 'ingesteld' : 'geen (de lijst is openbaar)'}`,
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
