// Pobiera publiczne listy domen phishingowych i trzyma je w pamięci.
const { normalizeDomain } = require('./detector');

const remoteDomains = new Set();
let lastUpdate = null;

function parseList(body) {
  const text = body.trim();
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json)) return json;
    if (Array.isArray(json.domains)) return json.domains;
  } catch {
    /* nie JSON - tekst */
  }
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

async function refresh(urls) {
  const fresh = new Set();
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = parseList(await res.text());
      for (const d of list) {
        const n = normalizeDomain(typeof d === 'string' ? d : d?.domain);
        if (n && n.includes('.')) fresh.add(n);
      }
      console.log(`[listy] ${url} -> ${list.length} domen`);
    } catch (err) {
      console.warn(`[listy] Nie udało się pobrać ${url}: ${err.message}`);
    }
  }
  // Podmieniamy tylko gdy coś się udało pobrać (nie kasujemy starej listy przy awarii sieci)
  if (fresh.size) {
    remoteDomains.clear();
    for (const d of fresh) remoteDomains.add(d);
    lastUpdate = new Date();
  }
  return remoteDomains.size;
}

function start(urls, refreshHours) {
  if (!urls.length) return;
  refresh(urls);
  setInterval(() => refresh(urls), Math.max(1, refreshHours) * 3600 * 1000).unref();
}

module.exports = {
  remoteDomains,
  start,
  refresh,
  getLastUpdate: () => lastUpdate,
};
