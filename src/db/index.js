// Wspólna baza danych bota i panelu (Supabase).
//  - SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY ustawione -> dane w Supabase (bot na hostingu + panel na Vercelu)
//  - brak -> null: moduły zapisują dane w plikach w folderze data/ (tryb lokalny, jak wcześniej)
//
// Moduły używają prostego interfejsu (select / upsert / insert / remove), dzięki czemu w testach
// można podstawić bazę w pamięci zamiast prawdziwego Supabase.

let db;
let resolved = false;

function createSupabaseDb(client) {
  const run = async (query) => {
    const { data, error } = await query;
    if (error) throw new Error(`Supabase: ${error.message}`);
    return data ?? [];
  };
  return {
    kind: 'supabase',
    select(table, {
      eq = {}, inList = {}, order, limit, columns = '*',
    } = {}) {
      let q = client.from(table).select(columns);
      for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
      for (const [k, v] of Object.entries(inList)) q = q.in(k, v);
      if (order) q = q.order(order.column, { ascending: Boolean(order.ascending) });
      if (limit) q = q.limit(limit);
      return run(q);
    },
    upsert: (table, rows, onConflict) => run(client.from(table).upsert(rows, { onConflict })),
    insert: (table, rows) => run(client.from(table).insert(rows)),
    remove(table, eq = {}) {
      let q = client.from(table).delete();
      for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
      return run(q);
    },
    removeOlder: (table, column, value) => run(client.from(table).delete().lt(column, value)),
  };
}

/** Baza danych albo null (tryb plików). */
function getDb() {
  if (resolved) return db;
  resolved = true;
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    db = null;
    return db;
  }
  const { createClient } = require('@supabase/supabase-js');
  db = createSupabaseDb(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
  return db;
}

/** Podstawienie bazy (testy). */
function setDb(custom) {
  db = custom;
  resolved = true;
}

// Śledzenie zapisów w tle: panel czeka na nie (saved()), zanim odpowie, żeby nic nie zginęło
function createPending(label) {
  const pending = new Set();
  return {
    track(promise) {
      const p = Promise.resolve(promise).catch((err) => {
        console.warn(`[${label}] zapis nieudany: ${err.message}`);
        throw err;
      });
      pending.add(p);
      p.finally(() => pending.delete(p)).catch(() => {});
      p.catch(() => {}); // błąd zgłaszany przez saved()
      return p;
    },
    saved: () => Promise.all([...pending]),
  };
}

module.exports = {
  getDb, setDb, createSupabaseDb, createPending,
};
