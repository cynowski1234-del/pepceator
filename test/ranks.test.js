const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ranks = require('../src/ranks');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pep-ranks-'));
const file = path.join(dir, 'rangi.js');
const write = (body, mtime) => {
  fs.writeFileSync(file, body);
  fs.utimesSync(file, mtime, mtime);
};

test('rangi z pliku i ich uprawnienia', () => {
  write(`module.exports = {
    'PEP CREATOR': ['111111111111111111'],
    'DEVELOPER': ['222222222222222222'],
    'ALPHA TESTER': ['333333333333333333'],
  };`, 1000);
  const r = ranks.create(file);
  assert.strictEqual(r.rankOf('111111111111111111').name, 'PEP CREATOR');
  assert.deepStrictEqual(r.rankOf('111111111111111111').perms, { servers: true, antispam: true, questions: true });
  assert.deepStrictEqual(r.rankOf('222222222222222222').perms, { servers: false, antispam: true, questions: true });
  assert.deepStrictEqual(r.rankOf('333333333333333333').perms, { servers: false, antispam: false, questions: false });
  assert.strictEqual(r.rankOf('444444444444444444'), null);
});

test('osoba w kilku rangach dostaje najwyższą', () => {
  write(`module.exports = { 'ALPHA TESTER': ['111111111111111111'], 'DEVELOPER': ['111111111111111111'] };`, 2000);
  assert.strictEqual(ranks.create(file).rankOf('111111111111111111').name, 'DEVELOPER');
});

test('wielkość liter w nazwie rangi nie ma znaczenia, nieznane rangi i złe ID są pomijane', () => {
  write(`module.exports = { 'developer': ['111111111111111111'], 'MODERATOR': ['222222222222222222'], 'ALPHA TESTER': ['abc'] };`, 3000);
  const r = ranks.create(file);
  assert.strictEqual(r.rankOf('111111111111111111').name, 'DEVELOPER');
  assert.strictEqual(r.rankOf('222222222222222222'), null);
  assert.deepStrictEqual(r.entries().invalid, ['nieznana ranga "MODERATOR"', 'abc']);
});

test('zmiana pliku działa bez restartu, błąd w pliku zostawia poprzednie rangi', () => {
  write(`module.exports = { 'DEVELOPER': ['111111111111111111'] };`, 4000);
  const r = ranks.create(file);
  assert.strictEqual(r.rankOf('111111111111111111').name, 'DEVELOPER');
  write(`module.exports = { 'PEP CREATOR': ['111111111111111111'] };`, 5000);
  assert.strictEqual(r.rankOf('111111111111111111').name, 'PEP CREATOR');
  write(`module.exports = { 'PEP CREATOR': ['111111111111111111' '2'] };`, 6000);
  assert.strictEqual(r.rankOf('111111111111111111').name, 'PEP CREATOR');
});

test('domyślny rangi.js w projekcie jest poprawny', () => {
  const { ranks: list, invalid } = ranks.create().entries();
  assert.deepStrictEqual(invalid, []);
  assert.deepStrictEqual(list.map((x) => x.name), ['PEP CREATOR', 'DEVELOPER', 'ALPHA TESTER']);
});
