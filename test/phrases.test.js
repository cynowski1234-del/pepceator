const test = require('node:test');
const assert = require('node:assert');
const { findBlockedPhrase, isProtectedChannel, normalize } = require('../src/phrases');

const rule = (phrase, channels = []) => ({ id: phrase, phrase, channels });

test('fraza pasuje bez względu na wielkość liter, polskie znaki i interpunkcję', () => {
  const rules = [rule('free nitro'), rule('zażółć gęślą')];
  assert.ok(findBlockedPhrase('FREE NITRO!!! klikaj', rules, ['c']));
  assert.ok(findBlockedPhrase('free-nitro tutaj', rules, ['c']));
  assert.ok(findBlockedPhrase('zazolc gesla jazn', rules, ['c']));
  assert.ok(findBlockedPhrase('Free​ Nitro', rules, ['c']), 'niewidoczne znaki nie pomagają obejść blokady');
});

test('fraza pasuje tylko jako całe słowa', () => {
  const rules = [rule('ok')];
  assert.ok(!findBlockedPhrase('mam nowy token', rules, ['c']));
  assert.ok(!findBlockedPhrase('okej', rules, ['c']));
  assert.ok(findBlockedPhrase('no ok, rozumiem', rules, ['c']));
});

test('gwiazdka łapie odmiany słowa', () => {
  const rules = [rule('kup*')];
  for (const t of ['kup to', 'kupuj teraz', 'KUPCIE!']) assert.ok(findBlockedPhrase(t, rules, ['c']), t);
  assert.ok(!findBlockedPhrase('skup się', rules, ['c']), 'początek słowa musi pasować');
});

test('fraza działa tylko na wybranych kanałach (puste = wszystkie)', () => {
  const rules = [rule('reklama', ['ogolny'])];
  assert.ok(findBlockedPhrase('reklama', rules, ['ogolny']));
  assert.ok(!findBlockedPhrase('reklama', rules, ['inny']));
  assert.ok(findBlockedPhrase('reklama', rules, ['watek', 'ogolny']), 'wątek na wybranym kanale');
  assert.ok(findBlockedPhrase('reklama', [rule('reklama')], ['dowolny']));
});

test('kanały ochrony linków: pusta lista = wszystkie kanały', () => {
  assert.ok(isProtectedChannel([], ['a']));
  assert.ok(isProtectedChannel(['a', 'b'], ['b']));
  assert.ok(!isProtectedChannel(['a'], ['c']));
});

test('znaki specjalne we frazie nie psują wyszukiwania', () => {
  const rules = [rule('c++ (promo)'), rule('$$$')];
  assert.ok(findBlockedPhrase('kurs C++ promo', rules, ['c']));
  assert.strictEqual(normalize('$$$'), '');
  assert.ok(!findBlockedPhrase('zwykła wiadomość', rules, ['c']), 'fraza z samych symboli niczego nie blokuje');
});
