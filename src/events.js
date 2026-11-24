// Rejestr ostatnich zdarzeń (usunięte scamy, spam, frazy, odpowiedzi AI) - pulpit, logi użytkownika, raporty.
// Tryb plików: pamięć + data/events.json. Tryb Supabase: tabela events (bot zapisuje, panel czyta przez refresh()).
const fs = require('node:fs');
const path = require('node:path');
const { getDb, createPending } = require('./db');

const FILE = path.join(__dirname, '..', 'data', 'events.json');
const MAX_EVENTS = 1000;
const KEEP_DAYS = 180; // Supabase: starsze zdarzenia są usuwane

const db = getDb();
const writes = createPending('events');

let state = { events: [], totals: {} };
if (!db) {
  try {
    state = { events: [], totals: {}, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    /* pierwszy start */
  }
}
const startedAt = Date.now();

let saveTimer = null;
function scheduleSave() {
  if (saveTimer || process.env.NODE_TEST_CONTEXT) return; // w testach nic nie zapisujemy
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state));
      fs.renameSync(`${FILE}.tmp`, FILE);
    } catch (err) {
      console.warn(`[events] zapis nieudany: ${err.message}`);
    }
  }, 2000);
  saveTimer.unref?.();
}

/**
 * Zapisuje zdarzenie.
 * @param {'scam'|'spam'|'phrase'|'ai'|'ai-error'} type
 * @param {object} data np. { guildId, guildName, user, userId, channelId, summary, content }
 */
function record(type, data = {}) {
  const event = { type, ts: Date.now(), ...data };
  state.events.unshift(event);
  if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
  state.totals[type] = (state.totals[type] || 0) + 1;
  if (db) {
    const { guildId, ...rest } = data;
    writes.track(db.insert('events', [{ type, ts: event.ts, guild_id: guildId || null, data: rest }]));
  } else {
    scheduleSave();
  }
}

function list({ guildIds = null, limit = 100 } = {}) {
  const events = guildIds ? state.events.filter((e) => !e.guildId || guildIds.includes(e.guildId)) : state.events;
  return events.slice(0, limit);
}

function totals() {
  return { ...state.totals };
}

/** Supabase: wczytuje ostatnie zdarzenia i liczniki z bazy (w trybie plików nic nie robi). */
async function refresh() {
  if (!db) return;
  const [rows, counts] = await Promise.all([
    db.select('events', { order: { column: 'ts', ascending: false }, limit: MAX_EVENTS }),
    db.select('event_totals'),
  ]);
  state.events = rows.map((r) => ({ ...(r.data || {}), type: r.type, ts: Number(r.ts), guildId: r.guild_id || undefined }));
  state.totals = Object.fromEntries(counts.map((c) => [c.type, Number(c.count)]));
}

/** Supabase: usuwa zdarzenia starsze niż KEEP_DAYS dni. */
async function cleanup() {
  if (!db?.removeOlder) return;
  await db.removeOlder('events', 'ts', Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000);
}

module.exports = {
  record, list, totals, refresh, cleanup, saved: () => writes.saved(), startedAt,
};
