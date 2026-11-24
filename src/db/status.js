// Status bota dla panelu na Vercelu: bot co minutę zapisuje w bazie (kv "bot_status"), że działa.
// Panel uznaje bota za "online", jeśli ostatni wpis jest świeższy niż 3 minuty.
const KEY = 'bot_status';
const ONLINE_MS = 3 * 60 * 1000;

function formatUptime(ms) {
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return `${d} d ${h} h`;
  return h ? `${h} h ${m % 60} min` : `${m % 60} min`;
}

/** Bot: zapisuje status teraz i potem co minutę. getInfo() -> { tag, ping, guilds, phishing, ai, startedAt } */
function startHeartbeat(db, getInfo, intervalMs = 60 * 1000) {
  const beat = () => db.upsert('kv', [{ key: KEY, value: { ...getInfo(), at: Date.now() }, updated_at: new Date().toISOString() }], 'key')
    .catch((err) => console.warn(`[status] zapis nieudany: ${err.message}`));
  beat();
  return setInterval(beat, intervalMs);
}

/** Panel: odczyt statusu z bazy w formacie pulpitu. */
async function readStatus(db, now = Date.now()) {
  const [row] = await db.select('kv', { eq: { key: KEY } });
  const s = row?.value;
  if (!s) {
    return {
      online: false, tag: 'bot jeszcze nie połączony z bazą', ping: '-', uptime: '-', guilds: '-', phishing: '-', ai: false,
    };
  }
  const online = now - s.at < ONLINE_MS;
  return {
    online,
    tag: s.tag,
    ping: online ? s.ping : '-',
    uptime: online ? formatUptime(now - s.startedAt) : `offline od ${formatUptime(now - s.at)}`,
    guilds: s.guilds,
    phishing: s.phishing,
    ai: Boolean(s.ai),
  };
}

module.exports = {
  startHeartbeat, readStatus, formatUptime, ONLINE_MS,
};
