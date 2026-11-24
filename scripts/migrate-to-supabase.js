// Przenosi dane z plików lokalnych (folder data/ i wiedza.md) do Supabase.
// Użycie: dodaj SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY do .env, potem:  npm run migrate:supabase
// Bezpieczne do ponownego uruchomienia: ustawienia i osoby są nadpisywane, zdarzenia i baza pytań
// są kopiowane tylko wtedy, gdy w bazie jeszcze ich nie ma (wymuszenie: --force).
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const fs = require('node:fs');
const path = require('node:path');
const { getDb } = require('../src/db');

const ROOT = path.join(__dirname, '..');
const FORCE = process.argv.includes('--force');
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  } catch {
    return fallback;
  }
};

async function migrate(db, log = console.log) {
  // 1. ustawienia serwerów
  const guilds = readJson('data/guilds.json', {});
  const rows = Object.entries(guilds).map(([guildId, g]) => ({
    guild_id: guildId,
    log_channel_id: g.logChannelId || null,
    image_hashes: g.imageHashes || [],
    blocked_phrases: g.blockedPhrases || [],
    protected_channels: g.protectedChannels || [],
    last_report_day: g.lastReportDay || null,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length) await db.upsert('guild_settings', rows, 'guild_id');
  log(`✅ Ustawienia serwerów: ${rows.length}`);

  // 2. osoby dodane w panelu
  const people = readJson('data/panel-access.json', { users: [] }).users || [];
  if (people.length) {
    await db.upsert('panel_access', people.map((u) => ({
      user_id: u.id, rank: u.rank || null, name: u.name || '', added_by: u.addedBy || '', added_at: u.addedAt || Date.now(),
    })), 'user_id');
  }
  log(`✅ Osoby z rangą / whitelista z panelu: ${people.length}`);

  // 3. zdarzenia (logi, pulpit) - tylko jeśli tabela jest pusta
  const events = readJson('data/events.json', { events: [] }).events || [];
  const existing = await db.select('events', { limit: 1 });
  if (existing.length && !FORCE) {
    log('ℹ️  Zdarzenia: w bazie już są – pomijam (wymuszenie: --force)');
  } else {
    const toRow = ({ type, ts, guildId, ...data }) => ({ type, ts, guild_id: guildId || null, data });
    const ordered = [...events].reverse(); // od najstarszych
    for (let i = 0; i < ordered.length; i += 500) await db.insert('events', ordered.slice(i, i + 500).map(toRow));
    log(`✅ Zdarzenia: ${events.length}`);
  }

  // 4. baza pytań (wiedza.md)
  const [kv] = await db.select('kv', { eq: { key: 'wiedza' } });
  if (kv && !FORCE) {
    log('ℹ️  Baza pytań: w bazie już jest – pomijam (wymuszenie: --force)');
  } else {
    const text = fs.readFileSync(path.join(ROOT, 'wiedza.md'), 'utf8');
    await db.upsert('kv', [{ key: 'wiedza', value: { text }, updated_at: new Date().toISOString() }], 'key');
    log(`✅ Baza pytań: ${text.length} znaków`);
  }
}

if (require.main === module) {
  const db = getDb();
  if (!db) {
    console.error('❌ Brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w pliku .env');
    process.exit(2);
  }
  migrate(db)
    .then(() => console.log('\n🎉 Gotowe – dane są w Supabase.'))
    .catch((err) => {
      console.error(`❌ ${err.message}`);
      console.error('   Czy uruchomiłeś supabase/schema.sql w Supabase (SQL Editor)?');
      process.exitCode = 1;
    });
}

module.exports = { migrate };
