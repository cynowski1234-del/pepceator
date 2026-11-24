// Wczytuje whitelist.js (główny folder bota) i odświeża go po każdej zmianie pliku - bez restartu bota.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FILE = path.join(__dirname, '..', 'whitelist.js');
const ID = /^\d{17,20}$/;

function create(file = DEFAULT_FILE) {
  let cache = { mtime: -1, users: new Set(), roles: new Set(), invalid: [] };

  function load() {
    let mtime;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      cache = { mtime: -1, users: new Set(), roles: new Set(), invalid: [] };
      return cache;
    }
    if (mtime === cache.mtime) return cache;
    try {
      delete require.cache[require.resolve(file)];
      const data = require(file);
      const invalid = [];
      const clean = (list) => [].concat(list || []).map((v) => String(v).trim()).filter((v) => {
        if (ID.test(v)) return true;
        invalid.push(v);
        return false;
      });
      cache = { mtime, users: new Set(clean(data.users)), roles: new Set(clean(data.roles)), invalid };
      console.log(`[whitelist] wczytano: ${cache.users.size} osób, ${cache.roles.size} ról`);
      if (invalid.length) console.warn(`[whitelist] pominięto nieprawidłowe ID: ${invalid.join(', ')}`);
    } catch (err) {
      // błąd w pliku (np. brak przecinka) - zostaje poprzednia wersja listy
      cache = { ...cache, mtime };
      console.warn(`[whitelist] błąd w pliku whitelist.js - zostaje poprzednia lista: ${err.message}`);
    }
    return cache;
  }

  return {
    /** Czy ta osoba (member albo user) jest na whiteliście. */
    has(member, userId = member?.id ?? member?.user?.id) {
      const wl = load();
      if (userId && wl.users.has(userId)) return true;
      const roles = member?.roles?.cache;
      return Boolean(roles && [...wl.roles].some((r) => roles.has(r)));
    },
    entries() {
      const wl = load();
      return { users: [...wl.users], roles: [...wl.roles], invalid: wl.invalid };
    },
  };
}

module.exports = { create, DEFAULT_FILE };
