// Wykrywa przejęte konta: ta sama wiadomość wysłana na kilku kanałach w krótkim czasie
// (tak najczęściej wyglądają scamy z obrazkiem "MrBeast rozdaje $2500").
const { cleanText } = require('./detector');

const WINDOW_MS = 60 * 1000;
const CHANNEL_LIMIT = 3;

const history = new Map(); // `${guildId}:${userId}` -> [{ fp, channelId, messageId, ts }]

function fingerprint(message) {
  const text = cleanText(message.content).toLowerCase().replace(/\s+/g, ' ').trim();
  const files = [...message.attachments.values()].map((a) => `${a.name}:${a.size}`).sort().join(',');
  const hasLink = /https?:\/\/|\.\w{2,}\//.test(text);
  // Liczy się tylko spam z linkiem albo obrazkiem/plikiem - zwykły tekst bot zostawia w spokoju
  if (!files && !hasLink) return null;
  return `${text}|${files}`;
}

/**
 * Rejestruje wiadomość. Jeśli ten sam tekst/plik pojawił się na >= CHANNEL_LIMIT kanałach
 * w ciągu WINDOW_MS, zwraca listę { channelId, messageId } do usunięcia. W przeciwnym razie null.
 */
function track(message) {
  const fp = fingerprint(message);
  if (!fp) return null;
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const list = (history.get(key) || []).filter((e) => now - e.ts < WINDOW_MS);
  list.push({ fp, channelId: message.channelId, messageId: message.id, ts: now });
  history.set(key, list);

  const same = list.filter((e) => e.fp === fp);
  const channels = new Set(same.map((e) => e.channelId));
  if (channels.size >= CHANNEL_LIMIT) {
    history.set(key, list.filter((e) => e.fp !== fp));
    return same;
  }
  return null;
}

// sprzątanie starych wpisów
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of history) {
    const fresh = list.filter((e) => now - e.ts < WINDOW_MS);
    if (fresh.length) history.set(key, fresh);
    else history.delete(key);
  }
}, WINDOW_MS).unref();

module.exports = { track, CHANNEL_LIMIT, WINDOW_MS };
