// Panel jako osobna aplikacja (Vercel): bot działa na hostingu, a panel czyta i zapisuje dane w Supabase
// oraz pobiera serwery / kanały / role z API Discorda (tokenem bota). Konfiguracja ze zmiennych środowiskowych.
const { getDb } = require('../db');
const { readStatus } = require('../db/status');
const { createTeam } = require('../team');
const { buildReport } = require('../report');
const { createDiscordRest } = require('./discordRest');
const { createPanel } = require('./server');

const env = (name) => (process.env[name] || '').trim();

function createStandalonePanel({ fetchImpl } = {}) {
  const db = getDb();
  const missing = [
    ['DISCORD_TOKEN', env('DISCORD_TOKEN')],
    ['DISCORD_CLIENT_SECRET', env('DISCORD_CLIENT_SECRET')],
    ['PANEL_SESSION_SECRET', env('PANEL_SESSION_SECRET').length >= 32],
    ['SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY', db],
  ].filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length) throw new Error(`brakuje zmiennych środowiskowych: ${missing.join(', ')}`);

  // moduły danych (po getDb() - działają w trybie Supabase)
  const storage = require('../storage');
  const events = require('../events');
  const knowledge = require('../knowledge').create();
  const access = require('../access').create();
  const team = createTeam({
    fileWhitelist: require('../whitelist').create(), fileRanks: require('../ranks').create(), access,
  });
  const discord = createDiscordRest({ token: env('DISCORD_TOKEN'), ...(fetchImpl ? { fetchImpl } : {}) });

  // adres panelu: PANEL_URL albo domena Vercela
  const publicUrl = (env('PANEL_URL') || (env('VERCEL_PROJECT_PRODUCTION_URL') && `https://${env('VERCEL_PROJECT_PRODUCTION_URL')}`)
    || (env('VERCEL_URL') && `https://${env('VERCEL_URL')}`) || 'http://localhost:3000').replace(/\/+$/, '');

  let status = {};
  async function beforeRequest() {
    await Promise.all([
      discord.refresh(),
      storage.refresh(),
      events.refresh(),
      knowledge.refresh(),
      access.refresh(),
      readStatus(db).then((s) => { status = s; }),
    ]);
  }

  // "Wyślij raport teraz" - przez API Discorda (bot jest na innym serwerze)
  async function sendReport(guild) {
    const cfg = storage.get(guild.id);
    const channel = cfg.logChannelId && guild.channels.cache.get(cfg.logChannelId);
    if (!channel) return { ok: false, error: 'Na tym serwerze nie ustawiono kanału raportów.' };
    const { embed } = buildReport(guild, events.list({ guildIds: [guild.id], limit: 1000 }));
    try {
      await discord.sendMessage(channel.id, { embeds: [embed.toJSON()], allowed_mentions: { parse: [] } });
      return { ok: true, channel: channel.name };
    } catch (err) {
      return { ok: false, error: `Nie udało się wysłać raportu (${err.message}).` };
    }
  }

  return createPanel({
    client: discord.client,
    storage,
    events,
    knowledge,
    accessList: access,
    whitelist: team.whitelist,
    ranks: team.ranks,
    getStatus: () => status,
    sendReport,
    beforeRequest,
    publicUrl,
    clientSecret: env('DISCORD_CLIENT_SECRET'),
    sessionSecret: env('PANEL_SESSION_SECRET'),
    homeGuildIds: [env('GUILD_ID'), env('DEV_GUILD_ID')].filter(Boolean),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

module.exports = { createStandalonePanel };
