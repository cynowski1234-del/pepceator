const test = require('node:test');
const assert = require('node:assert');
const { analyzeMessage, isScam } = require('../src/detector');
const linkResolver = require('../src/linkResolver');

test('IP-logger jest usuwany', () => {
  const r = analyzeMessage('zobacz to xd https://grabify.link/ABC123');
  assert.ok(isScam(r), r.reasons.join(' | '));
});

test('tekst scamu kasynowego MrBeast bez linku jest usuwany', () => {
  const r = analyzeMessage('MrBeast launched his own crypto casino! I am giving away $2,500 to everyone who registers. Activate code BEAST for bonus, withdraw USDT (TRC20) instantly. Withdrawal success!');
  assert.ok(isScam(r), `${r.score}: ${r.reasons.join(' | ')}`);
});

test('zwykła rozmowa o bonusie w grze nie jest scamem', () => {
  const r = analyzeMessage('dostałem bonus xp w grze i zrobiłem deposit w banku postaci');
  assert.ok(!isScam(r), `${r.score}: ${r.reasons.join(' | ')}`);
});

test('skrócony link jest rozwijany bez otwierania strony docelowej', async () => {
  const realFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    const map = {
      'https://bit.ly/abc': 'https://tinyurl.com/xyz',
      'https://tinyurl.com/xyz': 'https://discord-nitro-gift.click/claim',
    };
    return new Response(null, { status: 301, headers: { location: map[url] } });
  };
  try {
    const final = await linkResolver.resolve('https://bit.ly/abc');
    assert.strictEqual(final, 'https://discord-nitro-gift.click/claim');
    assert.deepStrictEqual(requested, ['https://bit.ly/abc', 'https://tinyurl.com/xyz']);
    const r = analyzeMessage(`free nitro https://bit.ly/abc\n${final}`);
    assert.ok(isScam(r), r.reasons.join(' | '));
  } finally {
    globalThis.fetch = realFetch;
  }
});
