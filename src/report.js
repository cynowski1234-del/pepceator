// Raport serwera na kanał raportów: podsumowanie całego serwera + osoby, które wysyłały scam linki.
const { EmbedBuilder } = require('discord.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PEOPLE = 15;
const LINK_TYPES = new Set(['scam', 'spam']); // scam linki i spam z przejętych kont

/** Liczby i lista osób z zdarzeń jednego serwera w danym okresie. */
function summarize(events, guildId, { since, until = Date.now() } = {}) {
  const from = since ?? until - DAY_MS;
  const list = events.filter((e) => e.guildId === guildId && e.ts >= from && e.ts <= until);
  const counts = {};
  for (const e of list) counts[e.type] = (counts[e.type] || 0) + 1;

  const people = new Map();
  const channels = new Map();
  for (const e of list) {
    if (!LINK_TYPES.has(e.type)) continue;
    const key = e.userId || e.user || '?';
    if (!people.has(key)) people.set(key, { userId: e.userId, user: e.user || '?', count: 0, last: 0, channels: new Set() });
    const p = people.get(key);
    p.count++;
    p.last = Math.max(p.last, e.ts);
    if (e.channelId) p.channels.add(e.channelId);
    if (e.channelId) channels.set(e.channelId, (channels.get(e.channelId) || 0) + 1);
  }
  return {
    from,
    until,
    counts,
    people: [...people.values()].sort((a, b) => b.count - a.count || b.last - a.last),
    channels: [...channels.entries()].sort((a, b) => b[1] - a[1]),
  };
}

const fmtDate = (ts) => new Date(ts).toLocaleString('pl-PL', {
  timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

function clip(lines, max = 1024) {
  let out = '';
  for (const line of lines) {
    if (out.length + line.length + 1 > max - 20) return `${out}…`;
    out += (out ? '\n' : '') + line;
  }
  return out;
}

/** Embed raportu dla serwera. */
function buildReport(guild, events, opts = {}) {
  const s = summarize(events, guild.id, opts);
  const n = (t) => s.counts[t] || 0;
  const removedLinks = n('scam') + n('spam');

  const people = s.people.slice(0, MAX_PEOPLE).map((p, i) => {
    const who = p.userId ? `<@${p.userId}> \`${p.user}\`` : `\`${p.user}\``;
    const where = [...p.channels].slice(0, 3).map((id) => `<#${id}>`).join(', ');
    return `**${i + 1}.** ${who} – **${p.count}×**${where ? ` · ${where}` : ''}`;
  });
  if (s.people.length > MAX_PEOPLE) people.push(`…i jeszcze ${s.people.length - MAX_PEOPLE} os.`);

  const embed = new EmbedBuilder()
    .setTitle(`📊 Raport serwera – ${guild.name}`)
    .setColor(removedLinks ? 0xe67e22 : 0x23a55a)
    .setDescription(`Okres: **${fmtDate(s.from)} – ${fmtDate(s.until)}**`)
    .addFields(
      { name: '🛡️ Usunięte scam linki', value: String(n('scam')), inline: true },
      { name: '📢 Spam z przejętych kont', value: String(n('spam')), inline: true },
      { name: '🚫 Zablokowane frazy', value: String(n('phrase')), inline: true },
      { name: '🤖 Odpowiedzi AI', value: String(n('ai')), inline: true },
      { name: '👥 Osoby ze scam linkami', value: String(s.people.length), inline: true },
      { name: '👤 Członkowie serwera', value: String(guild.memberCount ?? '-'), inline: true },
      {
        name: '🚨 Kto wysyłał scam linki',
        value: people.length ? clip(people) : 'Nikt – na serwerze było czysto ✅',
      },
    )
    .setFooter({ text: 'PEP BOT · raport automatyczny' })
    .setTimestamp(s.until);

  if (s.channels.length) {
    embed.addFields({
      name: '📍 Kanały z największą liczbą scamów',
      value: clip(s.channels.slice(0, 5).map(([id, c]) => `<#${id}> – ${c}×`)),
    });
  }
  return { embed, summary: s };
}

module.exports = {
  summarize, buildReport, DAY_MS,
};
