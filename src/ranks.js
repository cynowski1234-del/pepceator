// Rangi panelu (rangi.js w głównym folderze bota) - odświeżane po każdej zmianie pliku, bez restartu.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FILE = path.join(__dirname, '..', 'rangi.js');
const ID = /^\d{17,20}$/;

// Co może każda ranga. servers = ustawienia serwerów, antispam = Anty Spam, questions = Edycja Pytania
const RANKS = {
  'PEP CREATOR': {
    level: 3, slug: 'creator', opis: 'pełny dostęp', perms: { servers: true, antispam: true, questions: true },
  },
  DEVELOPER: {
    level: 2, slug: 'developer', opis: 'edycja pytań i Anty Spam', perms: { servers: false, antispam: true, questions: true },
  },
  'ALPHA TESTER': {
    level: 1, slug: 'tester', opis: 'tylko podgląd', perms: { servers: false, antispam: false, questions: false },
  },
};

const rankInfo = (name) => (RANKS[name] ? { name, ...RANKS[name] } : null);

function create(file = DEFAULT_FILE) {
  let cache = { mtime: -1, byUser: new Map(), lists: {}, invalid: [] };

  function load() {
    let mtime;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      cache = { mtime: -1, byUser: new Map(), lists: {}, invalid: [] };
      return cache;
    }
    if (mtime === cache.mtime) return cache;
    try {
      delete require.cache[require.resolve(file)];
      const data = require(file);
      const byUser = new Map();
      const lists = {};
      const invalid = [];
      for (const [rawName, ids] of Object.entries(data || {})) {
        const name = String(rawName).trim().toUpperCase();
        if (!RANKS[name]) {
          invalid.push(`nieznana ranga "${rawName}"`);
          continue;
        }
        lists[name] = [];
        for (const v of [].concat(ids || [])) {
          const id = String(v).trim();
          if (!ID.test(id)) {
            invalid.push(id);
            continue;
          }
          lists[name].push(id);
          const current = byUser.get(id);
          if (!current || RANKS[name].level > RANKS[current].level) byUser.set(id, name); // liczy się najwyższa
        }
      }
      cache = { mtime, byUser, lists, invalid };
      console.log(`[rangi] wczytano: ${byUser.size} osób z rangą`);
      if (invalid.length) console.warn(`[rangi] pominięto: ${invalid.join(', ')}`);
    } catch (err) {
      cache = { ...cache, mtime };
      console.warn(`[rangi] błąd w pliku rangi.js - zostają poprzednie rangi: ${err.message}`);
    }
    return cache;
  }

  return {
    /** Ranga osoby: { name, level, slug, opis, perms } albo null. */
    rankOf(userId) {
      return rankInfo(load().byUser.get(String(userId)));
    },
    /** Lista rang z przypisanymi osobami (do podglądu w panelu). */
    entries() {
      const { lists, invalid } = load();
      return {
        ranks: Object.keys(RANKS).map((name) => ({ ...rankInfo(name), users: lists[name] || [] })),
        invalid,
      };
    },
  };
}

module.exports = { create, RANKS, rankInfo, DEFAULT_FILE };
