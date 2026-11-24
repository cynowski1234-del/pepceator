// Baza w pamięci o tym samym interfejsie co src/db (select / upsert / insert / remove) - tylko do testów.
function createMemoryDb() {
  const tables = {};
  const rowsOf = (t) => (tables[t] ||= []);
  let nextId = 1;
  const keyOf = { guild_settings: 'guild_id', panel_access: 'user_id', kv: 'key' };
  const db = {
    kind: 'memory',
    tables,
    calls: [],
    async select(table, {
      eq = {}, inList = {}, order, limit,
    } = {}) {
      db.calls.push(['select', table]);
      if (table === 'event_totals') {
        const counts = {};
        for (const r of rowsOf('events')) counts[r.type] = (counts[r.type] || 0) + 1;
        return Object.entries(counts).map(([type, count]) => ({ type, count }));
      }
      let rows = rowsOf(table).filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v)
        && Object.entries(inList).every(([k, v]) => v.includes(r[k])));
      if (order) rows = [...rows].sort((a, b) => (a[order.column] > b[order.column] ? 1 : -1) * (order.ascending ? 1 : -1));
      if (limit) rows = rows.slice(0, limit);
      return structuredClone(rows);
    },
    async upsert(table, rows, onConflict) {
      db.calls.push(['upsert', table]);
      const key = onConflict || keyOf[table];
      for (const row of [].concat(rows)) {
        const existing = rowsOf(table).find((r) => r[key] === row[key]);
        if (existing) Object.assign(existing, structuredClone(row));
        else rowsOf(table).push(structuredClone(row));
      }
      return [];
    },
    async insert(table, rows) {
      db.calls.push(['insert', table]);
      for (const row of [].concat(rows)) rowsOf(table).push({ id: nextId++, ...structuredClone(row) });
      return [];
    },
    async remove(table, eq = {}) {
      db.calls.push(['remove', table]);
      tables[table] = rowsOf(table).filter((r) => !Object.entries(eq).every(([k, v]) => r[k] === v));
      return [];
    },
    async claim(key, owner) {
      if (rowsOf('kv').some((r) => r.key === key)) return false;
      rowsOf('kv').push({ key, value: { owner, at: Date.now() }, updated_at: new Date().toISOString() });
      return true;
    },
    async removeOlderClaims(iso) {
      tables.kv = rowsOf('kv').filter((r) => !(r.key.startsWith('claim:') && r.updated_at < iso));
      return [];
    },
    async removeOlder(table, column, value) {
      tables[table] = rowsOf(table).filter((r) => !(r[column] < value));
      return [];
    },
  };
  return db;
}

module.exports = { createMemoryDb };
