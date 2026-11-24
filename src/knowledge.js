// Odczyt i zapis bazy pytań (wiedza.md) w formie listy pytanie -> odpowiedź.
// Format pliku: wstęp, potem sekcje "## Pytanie" z odpowiedzią pod spodem. Asystent AI czyta cały plik.
// Z Supabase: ten sam tekst w tabeli kv (klucz "wiedza"); przy pierwszym uruchomieniu kopiowany z wiedza.md.
const fs = require('node:fs');
const path = require('node:path');
const { getDb, createPending } = require('./db');

const KV_KEY = 'wiedza';

const DEFAULT_FILE = path.join(__dirname, '..', 'wiedza.md');
const MAX_QUESTION = 300;
const MAX_ANSWER = 4000;
const MAX_ITEMS = 200;

function parse(text) {
  const lines = String(text || '').split(/\r?\n/);
  const intro = [];
  const items = [];
  let current = null;
  for (const line of lines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      current = { q: h[1], a: [] };
      items.push(current);
    } else if (current) {
      current.a.push(line);
    } else {
      intro.push(line);
    }
  }
  return {
    intro: intro.join('\n').trim(),
    items: items.map((i) => ({ q: i.q.trim(), a: i.a.join('\n').trim() })),
  };
}

function serialize({ intro, items }) {
  const parts = [intro.trim()];
  for (const { q, a } of items) parts.push(`## ${q.trim()}\n${a.trim()}`);
  return `${parts.filter(Boolean).join('\n\n')}\n`;
}

// Pytanie musi być jedną linią (inaczej rozbiłoby format pliku)
function clean(q, a) {
  const question = String(q || '').replace(/[\r\n]+/g, ' ').replace(/^#+\s*/, '').trim().slice(0, MAX_QUESTION);
  const answer = String(a || '').replace(/\r\n/g, '\n').replace(/^##\s/gm, '').trim().slice(0, MAX_ANSWER);
  return { q: question, a: answer };
}

/**
 * @param {string} [file] plik wiedza.md (tryb lokalny). Bez pliku i z Supabase w .env -> tabela kv.
 * @param {{ db?: object }} [opts] baza do użycia (testy)
 */
function create(file, { db = file ? null : getDb() } = {}) {
  const target = file || DEFAULT_FILE;
  const writes = createPending('knowledge');
  const fileText = () => {
    try {
      return fs.readFileSync(target, 'utf8');
    } catch {
      return '# Baza wiedzy serwera\n';
    }
  };
  let cached = db ? null : undefined; // tekst z bazy (Supabase)
  const text = () => (db ? (cached ?? fileText()) : fileText());
  const read = () => parse(text());
  const write = (data) => {
    const body = serialize(data);
    if (db) {
      cached = body;
      writes.track(db.upsert('kv', [{ key: KV_KEY, value: { text: body }, updated_at: new Date().toISOString() }], 'key'));
      return;
    }
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, target);
  };
  return {
    /** Supabase: wczytuje bazę pytań z bazy; jeśli jeszcze jej tam nie ma - kopiuje z wiedza.md. */
    async refresh() {
      if (!db) return;
      const [row] = await db.select('kv', { eq: { key: KV_KEY } });
      if (row?.value?.text != null) {
        cached = row.value.text;
      } else {
        cached = fileText();
        await db.upsert('kv', [{ key: KV_KEY, value: { text: cached }, updated_at: new Date().toISOString() }], 'key');
      }
    },
    saved: () => writes.saved(),
    /** Cały tekst bazy wiedzy (dla asystenta AI). */
    text,
    list: () => read().items,
    add(q, a) {
      const item = clean(q, a);
      if (!item.q || !item.a) throw new Error('Pytanie i odpowiedź nie mogą być puste.');
      const data = read();
      if (data.items.length >= MAX_ITEMS) throw new Error(`Maksymalnie ${MAX_ITEMS} pytań.`);
      data.items.push(item);
      write(data);
    },
    update(index, q, a) {
      const item = clean(q, a);
      if (!item.q || !item.a) throw new Error('Pytanie i odpowiedź nie mogą być puste.');
      const data = read();
      if (!data.items[index]) throw new Error('Nie ma takiego pytania (ktoś mógł je właśnie usunąć).');
      data.items[index] = item;
      write(data);
    },
    remove(index) {
      const data = read();
      if (!data.items[index]) throw new Error('Nie ma takiego pytania.');
      data.items.splice(index, 1);
      write(data);
    },
  };
}

module.exports = {
  create, parse, serialize, DEFAULT_FILE,
};
