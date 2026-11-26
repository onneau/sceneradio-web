// Testserver: draait de webapp lokaal, om te proberen voordat je iets publiceert.
//
//   node dev/testserver.js            demo: een nep-GitHub met voorbeeldzenders (dev/seed). Geen token, geen internet naar
//                                     GitHub nodig, en er wordt niets naar een echte repository geschreven.
//   node dev/testserver.js --live     de echte zenderlijst van GitHub, alleen lezen
//
// Opties: --poort 8082  --host 0.0.0.0  --update (doet alsof er een nieuwere versie is)  --help
// Streams afspelen en hoezen opzoeken gaan ook in de demo gewoon via internet.
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { FakeGitHub } from '../test/helpers.js';

const NAME = 'SceneRadio Web';
const DEFAULT_PORT = 8081;
const here = path.dirname(fileURLToPath(import.meta.url));

const HELP = `Gebruik: sh testserver.sh [opties]

  (geen optie)   demo met voorbeeldzenders; alles blijft op deze computer
  --live         de echte zenderlijst van GitHub, alleen lezen (leest GITHUB_READ_TOKEN, GITHUB_OWNER, GITHUB_REPO,
                 GITHUB_REF en PLAYLIST_PATH uit je omgeving)
  --poort N      poort (standaard ${DEFAULT_PORT}); ook PORT=N werkt
  --host ADRES   luisteradres (standaard 127.0.0.1, alleen deze computer)
  --update       doe alsof er een nieuwere versie is, om de updatemelding te zien
  --help         deze uitleg

Stoppen: Ctrl+C.`;

/** Leest een map met voorbeeldbestanden in als { 'pad/naam': Buffer }. */
function readSeed(dir, prefix = '') {
  const files = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(files, readSeed(path.join(dir, entry.name), `${relative}/`));
    else files[relative] = readFileSync(path.join(dir, entry.name));
  }
  return files;
}

/** Start de webapp (en in de demo de nep-GitHub). Geeft alles terug wat nodig is om hem weer te stoppen. */
export async function startTestServer({ live = false, update = false, port = DEFAULT_PORT, host = '127.0.0.1', sourceEnv = process.env } = {}) {
  const github = live ? null : await new FakeGitHub(readSeed(path.join(here, 'seed'))).start();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'webapp-testserver-'));
  const env = {
    PORT: String(port),
    DATA_DIR: dataDir,
    ...(github
      ? { GITHUB_API_URL: github.url, GITHUB_RAW_URL: github.url }
      : {
          GITHUB_API_URL: sourceEnv.GITHUB_API_URL,
          GITHUB_RAW_URL: sourceEnv.GITHUB_RAW_URL,
          GITHUB_READ_TOKEN: sourceEnv.GITHUB_READ_TOKEN,
          GITHUB_OWNER: sourceEnv.GITHUB_OWNER,
          GITHUB_REPO: sourceEnv.GITHUB_REPO,
          GITHUB_REF: sourceEnv.GITHUB_REF,
          PLAYLIST_PATH: sourceEnv.PLAYLIST_PATH,
          UPDATE_CHECK: 'false'
        }),
  };
  const config = loadConfig(env);
  if (github) {
    const tag = update ? 'v99.0.0' : `v${config.version}`;
    github.release = {
      tag_name: tag,
      html_url: `https://github.com/${config.updateRepo}/releases/tag/${tag}`,
      body: update ? '### Nederlands\n- Nieuw: dit is een proefmelding van de testserver\n\n### English\n- New: this is a test notice from the test server' : ''
    };
  }
  const app = createApp(config);
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, host, resolve);
  }).catch(async (error) => {
    rmSync(dataDir, { recursive: true, force: true });
    await github?.stop();
    throw error;
  });
  const actualPort = app.server.address().port;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    app.server.close();
    app.server.closeAllConnections?.();
    await github?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { app, config, github, port: actualPort, url: `http://localhost:${actualPort}`, ready: app.warmUp(), stop };
}

function parseArgs(args) {
  const options = { live: false, update: false, port: process.env.PORT || DEFAULT_PORT, host: '127.0.0.1' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--live') options.live = true;
    else if (arg === '--update') options.update = true;
    else if (arg === '--poort' || arg === '--port') options.port = args[++i];
    else if (arg === '--host') options.host = args[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else {
      console.error(`Onbekende optie: ${arg}\n\n${HELP}`);
      process.exit(2);
    }
  }
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Ongeldige poort: ${options.port}\n\n${HELP}`);
    process.exit(2);
  }
  if (!options.host) {
    console.error(`Bij --host hoort een adres.\n\n${HELP}`);
    process.exit(2);
  }
  return { ...options, port };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let server;
  try {
    server = await startTestServer(options);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.error(`Poort ${options.port} is al in gebruik. Stop het andere programma, of kies een andere poort: sh testserver.sh --poort ${options.port + 1}`);
    } else {
      console.error(`De testserver kon niet starten: ${error.message}`);
    }
    process.exit(1);
  }
  const { config, url, github } = server;
  const lines = [
    `${NAME} ${config.version}: testserver, ${github ? 'demo met voorbeeldzenders' : 'echte zenderlijst van GitHub (alleen lezen)'}`,
    `  open in Chrome : ${url}`,
    `  stoppen        : Ctrl+C`
  ];
  if (options.host !== '127.0.0.1' && options.host !== 'localhost') {
    lines.push(`  LET OP         : luistert op ${options.host}; andere apparaten in je netwerk kunnen er ook bij`);
  }
  console.log(lines.join('\n'));
  server.ready.then(() => {
    const count = server.app.library.list().length;
    console.log(count ? `  ${count} zenders geladen` : `  Er zijn geen zenders geladen: ${JSON.stringify(server.app.library.lastError)}`);
  });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\nTestserver stopt.');
    setTimeout(() => process.exit(0), 3000).unref();
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
