const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const whitelist = require('../src/whitelist');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pep-wl-'));
const file = path.join(dir, 'whitelist.js');
const write = (body, mtime) => {
  fs.writeFileSync(file, body);
  fs.utimesSync(file, mtime, mtime); // inna data = plik "zmieniony"
};
const member = (id, roles = []) => ({ id, roles: { cache: new Map(roles.map((r) => [r, {}])) } });

test('osoba z whitelisty i osoba z rolą z whitelisty są rozpoznawane', () => {
  write("module.exports = { users: ['111111111111111111'], roles: ['222222222222222222'] };", 1000);
  const wl = whitelist.create(file);
  assert.ok(wl.has(member('111111111111111111')));
  assert.ok(wl.has(member('333333333333333333', ['222222222222222222'])));
  assert.ok(!wl.has(member('333333333333333333', ['999999999999999999'])));
  assert.ok(!wl.has(null, '444444444444444444'));
  assert.ok(wl.has(null, '111111111111111111'), 'samo ID (gdy brak danych członka)');
});

test('zmiana pliku działa bez restartu', () => {
  write("module.exports = { users: ['111111111111111111'] };", 2000);
  const wl = whitelist.create(file);
  assert.ok(wl.has(null, '111111111111111111'));
  write("module.exports = { users: ['555555555555555555'] };", 3000);
  assert.ok(!wl.has(null, '111111111111111111'));
  assert.ok(wl.has(null, '555555555555555555'));
});

test('błąd w pliku nie psuje bota - zostaje poprzednia lista', () => {
  write("module.exports = { users: ['111111111111111111'] };", 4000);
  const wl = whitelist.create(file);
  assert.ok(wl.has(null, '111111111111111111'));
  write("module.exports = { users: ['111111111111111111' '222'] };", 5000); // brak przecinka
  assert.ok(wl.has(null, '111111111111111111'));
});

test('nieprawidłowe ID są pomijane, liczby też działają', () => {
  write("module.exports = { users: ['janek', 123, '666666666666666666'], roles: [] };", 6000);
  const wl = whitelist.create(file);
  assert.deepStrictEqual(wl.entries().users, ['666666666666666666']);
  assert.deepStrictEqual(wl.entries().invalid, ['janek', '123']);
});

test('brak pliku = pusta whitelista', () => {
  const wl = whitelist.create(path.join(dir, 'nie-ma.js'));
  assert.ok(!wl.has(null, '111111111111111111'));
});

test('domyślny whitelist.js w projekcie jest poprawny', () => {
  const wl = whitelist.create();
  const { invalid } = wl.entries();
  assert.deepStrictEqual(invalid, []);
});
