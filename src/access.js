// Osoby dodane w panelu (Administracja -> Whitelista): Discord ID + ranga.
// Każda z nich jest na whiteliście (bot nie usuwa jej wiadomości); ranga daje dostęp do panelu.
// Zapis: data/panel-access.json albo (gdy jest Supabase) tabela panel_access.
// Osoby z plików whitelist.js / rangi.js działają niezależnie od tej listy.
const fs = require('node:fs');
const path = require('node:path');
const { RANKS } = require('./ranks');
const { getDb, createPending } = require('./db');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'panel-access.json');
const ID = /^\d{17,20}$/;
const MAX_USERS = 500;

/**
 * @param {string} [file] plik JSON (tryb lokalny). Bez pliku i z Supabase w .env -> tabela panel_access.
 * @param {{ db?: object }} [opts] baza do użycia (testy)
 */
function create(file, { db = file ? null : getDb() } = {}) {
  const target = file || DEFAULT_FILE;
  const writes = createPending('access');
  let users = [];
  if (!db) {
    try {
      users = JSON.parse(fs.readFileSync(target, 'utf8')).users || [];
    } catch {
      users = [];
    }
  }
  const toRow = (u) => ({
    user_id: u.id, rank: u.rank, name: u.name, added_by: u.addedBy, added_at: u.addedAt,
  });
  // zapis: cały plik albo jeden wiersz w bazie
  const save = (changed, removedId) => {
    if (db) {
      if (removedId) writes.track(db.remove('panel_access', { user_id: removedId }));
      else writes.track(db.upsert('panel_access', [toRow(changed)], 'user_id'));
      return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify({ users }, null, 2));
    fs.renameSync(`${target}.tmp`, target);
  };

  return {
    /** Supabase: wczytuje aktualną listę z bazy (w trybie plików nic nie robi). */
    async refresh() {
      if (!db) return;
      const rows = await db.select('panel_access');
      users = rows.map((r) => ({
        id: r.user_id, rank: r.rank || null, name: r.name || '', addedBy: r.added_by || '', addedAt: Number(r.added_at) || 0,
      }));
    },
    saved: () => writes.saved(),
    list: () => users.map((u) => ({ ...u })),
    get: (id) => users.find((u) => u.id === String(id)) || null,
    has: (id) => users.some((u) => u.id === String(id)),
    /** Dodaje osobę (albo zmienia jej rangę). rank = nazwa rangi albo null = tylko whitelista. */
    add(id, rank, { by, name } = {}) {
      const userId = String(id || '').trim();
      if (!ID.test(userId)) throw new Error('Discord ID to 17–20 cyfr (PPM na osobę → Kopiuj ID użytkownika).');
      if (rank && !RANKS[rank]) throw new Error('Nieznana ranga.');
      const existing = users.find((u) => u.id === userId);
      if (!existing && users.length >= MAX_USERS) throw new Error(`Maksymalnie ${MAX_USERS} osób.`);
      const entry = {
        id: userId, rank: rank || null, name: name || existing?.name || '', addedBy: by || '', addedAt: Date.now(),
      };
      users = existing ? users.map((u) => (u.id === userId ? entry : u)) : [...users, entry];
      save(entry);
      return { entry, updated: Boolean(existing) };
    },
    remove(id) {
      const entry = users.find((u) => u.id === String(id));
      if (!entry) throw new Error('Tej osoby nie ma na liście.');
      users = users.filter((u) => u.id !== String(id));
      save(null, entry.id);
      return entry;
    },
  };
}

module.exports = { create, DEFAULT_FILE };
