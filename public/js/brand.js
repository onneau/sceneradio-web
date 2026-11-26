// De namen en standaardteksten die bij deze webapp horen. (De andere webapp heeft dezelfde code met een eigen brand.js.)
import { tr } from './i18n.js';

export const BRAND = {
  name: 'SceneRadio',
  webName: 'SceneRadio web',
  appId: 'sceneradio',            // in een back-upbestand
  filePrefix: 'sceneradio-web-backup-',
  repoUrl: 'https://github.com/onneau/sceneradio-web'
};

// Een kant-en-klare docker-compose.yml voor Instellingen (plakken in Container Manager of Portainer).
export const composeText = () => `services:
  sceneradio-web:
    image: ghcr.io/onneau/sceneradio-web:latest
    container_name: sceneradio-web
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      TZ: Europe/Amsterdam
      ${tr('# Optioneel: maximaal aantal gelijktijdige luisteraars', '# Optional: maximum number of simultaneous listeners')}
      MAX_LISTENERS: "40"
    volumes:
      - ./data:/data`;

/** In een slogan wordt dit de actuele lokale tijd van het apparaat. */
export const TIME_TOKEN = '{tijd}';
export const TIME_SLOGAN = `Local time ${TIME_TOKEN}`;
export const MAX_SLOGANS = 30;
export const MAX_SLOGAN_LENGTH = 32;

export const DEFAULT_SLOGANS = [
  TIME_SLOGAN,
  'SceneRadio is proud to present', 'Onno rulez', 'SceneRadio brings you the beat', 'Respect to the scene',
  'Surf the SceneRadio tonight', 'Keep the scene alive', 'SceneRadio rocks your Radio', 'Amiga forever',
  'Turn it up loud on SceneRadio', 'Hello world', 'Greetings to all SceneRadio fans', 'SceneRadio thnx Onno',
  'Music in the air by SceneRadio', 'Stay tuned SceneRadio'
];
