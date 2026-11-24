const test = require('node:test');
const assert = require('node:assert');
const { analyzeMessage, SCAM_THRESHOLD } = require('../src/detector');

const ctx = { blacklist: new Set(['steamcommunity-gift.ru']) };
const DELETE = SCAM_THRESHOLD; // scam = usunięcie wiadomości

const scams = [
  '@everyone MrBeast giveaway! Claim your $2500 here https://mrbeast-gift.xyz/claim',
  'Free nitro for everyone https://discorcl.gift/abc123',
  'https://dlscord.com/nitro free nitro 3 months',
  'hey bro i accidentally reported you, check this https://steamcommunlty.com/tradeoffer/123',
  'Free Discord Nitro https://discord-nitro-gift.click/xyz',
  'https://discord.gifts/abcdef',
  'gift for you steamcommunity-gift.ru/id/123',
  'https://stearncommunity.com/gift',
  'MrB3ast is giving away 2500$! Use promo code BEAST2500 and withdraw instantly',
  '[discord.com/gift/abc](https://evil-site.xyz/login)',
  'https://xn--dscord-6va.com/gift',
  'https://dіscord.com/gift', // cyrylickie i
  'claim free nitro https://bit.ly/3abcd',
  'Fr33 n1tr0 giveaway https://nitro-drop.live',
];

const legit = [
  'siema, ktoś gra dziś w cs2?',
  'zobacz to https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'nowy film mrbeasta https://youtu.be/abc',
  'mój projekt https://github.com/user/repo',
  'https://discord.gg/abcdef',
  'https://store.steampowered.com/app/730',
  'robimy giveaway na serwerze, zapisy na kanale #giveaway',
  'plik config.json i index.js są w folderze',
  'kupiłem na allegro.pl za 50 zł',
  'https://tenor.com/view/cat-gif-123',
  'check out https://discordjs.guide/ for bot tutorials',
  'https://top.gg/bot/123',
  'oglądałem streama na twitch.tv/xqc',
  'np. tak albo itd. itp.',
];

for (const msg of scams) {
  test(`SCAM -> usunięcie: ${msg}`, () => {
    const r = analyzeMessage(msg, ctx);
    assert.ok(r.score >= DELETE, `wynik ${r.score} < ${DELETE}: ${r.reasons.join(' | ')}`);
  });
}

for (const msg of legit) {
  test(`OK (zostaje): ${msg}`, () => {
    const r = analyzeMessage(msg, ctx);
    assert.ok(r.score < DELETE, `wynik ${r.score}: ${r.reasons.join(' | ')}`);
  });
}
