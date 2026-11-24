const test = require('node:test');
const assert = require('node:assert');
const { buildReport, summarize } = require('../src/report');

const now = Date.UTC(2026, 10, 24, 19, 0);
const h = 60 * 60 * 1000;
const events = [
  { type: 'scam', ts: now - 1 * h, guildId: 'G', user: 'scamer#1', userId: '111111111111111111', channelId: 'C1' },
  { type: 'scam', ts: now - 2 * h, guildId: 'G', user: 'scamer#1', userId: '111111111111111111', channelId: 'C2' },
  { type: 'spam', ts: now - 3 * h, guildId: 'G', user: 'przejete#2', userId: '222222222222222222', channelId: 'C1' },
  { type: 'phrase', ts: now - 4 * h, guildId: 'G', user: 'ktos#3', userId: '333333333333333333', channelId: 'C1' },
  { type: 'ai', ts: now - 5 * h, guildId: 'G', user: 'pytajacy' },
  { type: 'scam', ts: now - 30 * h, guildId: 'G', user: 'stary#4', userId: '444444444444444444', channelId: 'C1' }, // starsze niż 24 h
  { type: 'scam', ts: now - 1 * h, guildId: 'INNY', user: 'obcy#5', userId: '555555555555555555', channelId: 'X' }, // inny serwer
];

test('podsumowanie: tylko ten serwer i ostatnie 24 godziny', () => {
  const s = summarize(events, 'G', { until: now });
  assert.deepStrictEqual(s.counts, { scam: 2, spam: 1, phrase: 1, ai: 1 });
  assert.deepStrictEqual(s.people.map((p) => [p.user, p.count]), [['scamer#1', 2], ['przejete#2', 1]], 'frazy i stare wpisy nie liczą się jako scam linki');
  assert.deepStrictEqual(s.channels[0], ['C1', 2]);
});

test('raport: cały serwer + osoby ze scam linkami', () => {
  const { embed } = buildReport({ id: 'G', name: 'Serwer PEP', memberCount: 1234 }, events, { until: now });
  const json = embed.toJSON();
  assert.match(json.title, /Raport serwera – Serwer PEP/);
  const field = (name) => json.fields.find((f) => f.name.includes(name)).value;
  assert.strictEqual(field('Usunięte scam linki'), '2');
  assert.strictEqual(field('Spam z przejętych kont'), '1');
  assert.strictEqual(field('Zablokowane frazy'), '1');
  assert.strictEqual(field('Członkowie serwera'), '1234');
  assert.match(field('Kto wysyłał scam linki'), /\*\*1\.\*\* <@111111111111111111> `scamer#1` – \*\*2×\*\* · <#C1>, <#C2>/);
  assert.match(field('Kto wysyłał scam linki'), /<@222222222222222222>/);
  assert.doesNotMatch(field('Kto wysyłał scam linki'), /stary#4|obcy#5|ktos#3/);
  assert.match(field('Kanały'), /<#C1> – 2×/);
});

test('raport: czysty dzień', () => {
  const { embed } = buildReport({ id: 'PUSTY', name: 'Pusty' }, events, { until: now });
  assert.match(embed.toJSON().fields.find((f) => f.name.includes('Kto')).value, /Nikt – na serwerze było czysto/);
});
