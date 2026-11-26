// Een eenvoudige begrenzing per adres: hooguit `max` verzoeken per `windowMs`. Het geheugen blijft klein: oude adressen
// worden opgeruimd en er worden nooit meer dan `maxKeys` adressen bijgehouden.
export class RateLimiter {
  constructor(max, windowMs, now = Date.now, maxKeys = 5000) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.maxKeys = maxKeys;
    this.hits = new Map(); // adres -> tijdstempels
  }

  /** true als dit verzoek mag; anders false (en het telt niet mee). */
  take(key) {
    const now = this.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.delete(key);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value);
    return true;
  }
}
