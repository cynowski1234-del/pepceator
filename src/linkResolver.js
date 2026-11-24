// Rozwija skrócone linki (bit.ly, tinyurl...) żeby zobaczyć, dokąd naprawdę prowadzą.
// Bezpieczeństwo: bot pyta TYLKO serwisy skracające i czyta tylko nagłówek przekierowania (Location).
// Nigdy nie otwiera docelowej strony, więc nie pobiera scamu ani nie łączy się z obcymi serwerami.
const { isShortener } = require('./detector');

const MAX_HOPS = 5;
const cache = new Map(); // url -> { final, ts }
const CACHE_MS = 60 * 60 * 1000;

async function nextHop(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: { 'user-agent': 'Mozilla/5.0 (link check)' },
      });
      res.body?.cancel().catch(() => {});
      const location = res.headers.get('location');
      if (location) return new URL(location, url).href;
      if (method === 'GET' || res.status < 400) return null; // brak przekierowania
    } catch {
      /* spróbuj GET albo poddaj się */
    }
  }
  return null;
}

/** Zwraca docelowy adres skróconego linku albo null, gdy nie udało się ustalić. */
async function resolve(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.final;

  let current = url;
  let final = null;
  for (let i = 0; i < MAX_HOPS; i++) {
    const host = new URL(current).hostname.replace(/^www\./, '');
    if (!isShortener(host)) {
      final = current; // dotarliśmy do celu - NIE otwieramy go
      break;
    }
    const next = await nextHop(current);
    if (!next || !/^https?:/i.test(next)) break;
    current = next;
  }
  cache.set(url, { final, ts: Date.now() });
  if (cache.size > 1000) cache.delete(cache.keys().next().value);
  return final;
}

module.exports = { resolve };
