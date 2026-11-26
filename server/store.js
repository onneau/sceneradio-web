// Wat de webapp zelf bewaart (in de map /data): eigen zenders, verborgen zenders en eigen logo's.
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.logoDir = path.join(dataDir, 'logos');
    mkdirSync(this.logoDir, { recursive: true });
    // local-stations: { name, url, group, pending, logoHash }
    this.localStations = this.readJson('local-stations.json', []);
    this.hidden = new Set(this.readJson('hidden.json', []));
    // logo-meta: { [slug]: { hash, pending } }
    this.logoMeta = this.readJson('logo-meta.json', {});
  }

  readJson(file, fallback) {
    try {
      return JSON.parse(readFileSync(path.join(this.dir, file), 'utf8'));
    } catch {
      return fallback;
    }
  }

  writeJson(file, value) {
    const target = path.join(this.dir, file);
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    renameSync(temp, target);
  }

  saveStations() {
    this.writeJson('local-stations.json', this.localStations);
  }

  saveHidden() {
    this.writeJson('hidden.json', [...this.hidden].sort());
  }

  saveLogoMeta() {
    this.writeJson('logo-meta.json', this.logoMeta);
  }

  /** Zet een zender in de lokale lijst; bestaat de naam al, dan wordt die vervangen. */
  upsertStation(entry) {
    const index = this.localStations.findIndex((s) => s.name === entry.name);
    if (index >= 0) this.localStations[index] = entry;
    else this.localStations.push(entry);
    this.saveStations();
  }

  removeStation(name) {
    const before = this.localStations.length;
    this.localStations = this.localStations.filter((s) => s.name !== name);
    if (this.localStations.length !== before) this.saveStations();
  }

  setHidden(name, hidden) {
    if (hidden) this.hidden.add(name);
    else this.hidden.delete(name);
    this.saveHidden();
  }

  logoFile(slug) {
    return path.join(this.logoDir, `${slug}.jpg`);
  }

  hasLogo(slug) {
    return existsSync(this.logoFile(slug));
  }

  readLogo(slug) {
    try {
      return readFileSync(this.logoFile(slug));
    } catch {
      return null;
    }
  }

  saveLogo(slug, bytes, hash, pending) {
    writeFileSync(this.logoFile(slug), bytes);
    this.logoMeta[slug] = { hash, pending };
    this.saveLogoMeta();
  }

  removeLogo(slug) {
    try {
      unlinkSync(this.logoFile(slug));
    } catch {
      // bestond niet
    }
    if (this.logoMeta[slug]) {
      delete this.logoMeta[slug];
      this.saveLogoMeta();
    }
  }

  allLogoSlugs() {
    try {
      return readdirSync(this.logoDir).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4));
    } catch {
      return [];
    }
  }
}
