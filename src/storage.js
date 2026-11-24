// Ustawienia ochrony są stałe. Na dysku (data/guilds.json) bot zapisuje per serwer tylko:
// - kanał raportów (/antyscam logi albo panel),
// - obrazki scamu, których sam się nauczył,
// - zablokowane frazy i kanały ochrony linków (panel -> Anty Spam).
// Tryb Supabase (SUPABASE_URL w .env): te same dane w tabeli guild_settings; odczyt z pamięci podręcznej
// odświeżanej przez refresh(), zapisy w tle (saved() czeka na ich zakończenie).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDb, createPending } = require('./db');

const FILE = path.join(__dirname, '..', 'data', 'guilds.json');

const SETTINGS = Object.freeze({
  enabled: true,
  whitelist: [], // wbudowana lista zaufanych domen jest w src/lists.js
  blacklist: [], // + publiczna baza phishingu pobierana automatycznie
  blockInvites: false,
  dmUser: true,
  crossChannelSpam: true,
  // OCR_ENABLED=false wyłącza czytanie obrazków (oszczędza ok. 300 MB RAM na słabym hostingu)
  scanImages: !/^(0|false|nie|no)$/i.test((process.env.OCR_ENABLED || '').trim()),
});

const MAX_IMAGE_HASHES = 1000;
const MAX_PHRASES = 200;
const MIN_PHRASE = 2;
const MAX_PHRASE = 100;

const db = getDb();
const writes = createPending('storage');

// nazwy pól w pamięci <-> kolumny w tabeli guild_settings
const COLUMNS = {
  logChannelId: 'log_channel_id',
  imageHashes: 'image_hashes',
  blockedPhrases: 'blocked_phrases',
  protectedChannels: 'protected_channels',
  lastReportDay: 'last_report_day',
};

let data = {};
if (!db) {
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    data = {};
  }
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

function patch(guildId, changes) {
  data[guildId] = { ...(data[guildId] || {}), ...changes };
  if (!db) {
    save();
    return;
  }
  // zapisujemy tylko zmienione kolumny - bot i panel nie nadpisują sobie nawzajem innych ustawień
  const row = { guild_id: guildId, updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(changes)) if (COLUMNS[k]) row[COLUMNS[k]] = v;
  writes.track(db.upsert('guild_settings', [row], 'guild_id'));
}

/** Supabase: wczytuje aktualne ustawienia wszystkich serwerów (w trybie plików nic nie robi). */
async function refresh() {
  if (!db) return;
  const rows = await db.select('guild_settings');
  const next = {};
  for (const r of rows) {
    next[r.guild_id] = {
      logChannelId: r.log_channel_id || null,
      imageHashes: r.image_hashes || [],
      blockedPhrases: r.blocked_phrases || [],
      protectedChannels: r.protected_channels || [],
      lastReportDay: r.last_report_day || null,
    };
  }
  data = next;
}

function get(guildId) {
  const saved = data[guildId] || {};
  return {
    ...SETTINGS,
    logChannelId: saved.logChannelId || null,
    imageHashes: saved.imageHashes || [],
    blockedPhrases: saved.blockedPhrases || [], // [{ id, phrase, channels: [] }] - puste channels = wszystkie kanały
    protectedChannels: saved.protectedChannels || [], // kanały z blokadą scam linków - pusta lista = wszystkie
    lastReportDay: saved.lastReportDay || null, // dzień (RRRR-MM-DD) ostatniego raportu dziennego
  };
}

function setLogChannel(guildId, channelId) {
  patch(guildId, { logChannelId: channelId || null });
}

// Zapamiętuje obrazki scamu (zwraca ile nowych dodano)
function addImageHashes(guildId, hashes) {
  const current = get(guildId).imageHashes;
  const fresh = hashes.filter((h) => h && !current.includes(h));
  if (fresh.length) patch(guildId, { imageHashes: [...current, ...fresh].slice(-MAX_IMAGE_HASHES) });
  return fresh.length;
}

// Zapomina wszystkie zapamiętane obrazki scamu (zwraca ile ich było)
function clearImageHashes(guildId) {
  const n = get(guildId).imageHashes.length;
  if (n) patch(guildId, { imageHashes: [] });
  return n;
}

// ---------- Anty Spam: zablokowane frazy ----------

function addPhrase(guildId, phrase, channels = []) {
  const text = String(phrase || '').replace(/\s+/g, ' ').trim();
  if (text.length < MIN_PHRASE) throw new Error(`Fraza musi mieć co najmniej ${MIN_PHRASE} znaki.`);
  if (text.length > MAX_PHRASE) throw new Error(`Fraza może mieć najwyżej ${MAX_PHRASE} znaków.`);
  const list = get(guildId).blockedPhrases;
  if (list.length >= MAX_PHRASES) throw new Error(`Maksymalnie ${MAX_PHRASES} fraz.`);
  if (list.some((p) => p.phrase.toLowerCase() === text.toLowerCase())) throw new Error('Ta fraza jest już zablokowana.');
  const rule = { id: crypto.randomBytes(6).toString('hex'), phrase: text, channels: [...new Set(channels)] };
  patch(guildId, { blockedPhrases: [...list, rule] });
  return rule;
}

function removePhrase(guildId, id) {
  const list = get(guildId).blockedPhrases;
  const rule = list.find((p) => p.id === id);
  if (!rule) throw new Error('Nie ma takiej frazy.');
  patch(guildId, { blockedPhrases: list.filter((p) => p.id !== id) });
  return rule;
}

// ---------- Anty Spam: kanały z blokadą scam linków ----------

function setProtectedChannels(guildId, channels) {
  patch(guildId, { protectedChannels: [...new Set(channels || [])] });
}

function setLastReportDay(guildId, day) {
  patch(guildId, { lastReportDay: day });
}

module.exports = {
  refresh,
  saved: () => writes.saved(),
  usesDatabase: () => Boolean(db),
  setLastReportDay,
  get, setLogChannel, addImageHashes, clearImageHashes, addPhrase, removePhrase, setProtectedChannels,
};
