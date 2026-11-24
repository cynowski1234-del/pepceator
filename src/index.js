require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, Events, PermissionFlagsBits, EmbedBuilder, MessageFlags,
} = require('discord.js');

const storage = require('./storage');
const commands = require('./commands');
const phishingLists = require('./phishingLists');
const spamTracker = require('./spamTracker');
const imageScanner = require('./imageScanner');
const linkResolver = require('./linkResolver');
const ai = require('./ai');
const events = require('./events');
const knowledge = require('./knowledge');
const panel = require('./panel/server');
const phrases = require('./phrases');
const report = require('./report');
const { getDb } = require('./db');
const { startHeartbeat } = require('./db/status');
const { createTeam } = require('./team');
const claims = require('./claims'); // gdy działają dwie kopie bota - tylko jedna wykonuje akcję

// Dane: pliki w data/ (lokalnie) albo Supabase (gdy SUPABASE_URL jest w .env / zmiennych hostingu)
const db = getDb();
const access = require('./access').create(); // osoby dodane w panelu (Administracja -> Whitelista)
const knowledgeStore = knowledge.create(); // baza pytań (wiedza.md albo Supabase)
// whitelista i rangi = pliki whitelist.js / rangi.js + osoby dodane w panelu
const { whitelist, ranks } = createTeam({
  fileWhitelist: require('./whitelist').create(), fileRanks: require('./ranks').create(), access,
});
const { analyzeMessage, isScam, displayReasons } = require('./detector');

const DISCORD_TOKEN = (process.env.DISCORD_TOKEN || '').trim();
const GUILD_ID = (process.env.GUILD_ID || '').trim(); // serwer główny (produkcyjny)
const DEV_GUILD_ID = (process.env.DEV_GUILD_ID || '').trim(); // serwer developerski (testy)
// serwery, na których komendy pojawiają się od razu (bez czekania na rejestrację globalną)
const HOME_GUILDS = [...new Set([GUILD_ID, DEV_GUILD_ID].filter(Boolean))];
const EXIT_CONFIG_ERROR = 2; // błąd ustawień - start.bat nie restartuje wtedy bota w kółko
const INVITE_PERMISSIONS = '125952'; // wyświetlanie, pisanie, zarządzanie wiadomościami, linki, pliki, historia

if (!DISCORD_TOKEN) {
  console.error('❌ Brak tokenu bota w pliku .env');
  console.error('   Otwórz plik .env i wklej token po DISCORD_TOKEN=  (instrukcja: README.md, "Instalacja").');
  process.exit(EXIT_CONFIG_ERROR);
}
const LIST_URLS = (process.env.PHISHING_LIST_URLS
  ?? 'https://raw.githubusercontent.com/nikolaischunk/discord-phishing-links/main/domain-list.json')
  .split(',').map((s) => s.trim()).filter(Boolean);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel],
});

// ---------- pomocnicze ----------

function buildCtx(cfg) {
  return {
    safe: new Set(cfg.whitelist),
    blacklist: [phishingLists.remoteDomains, new Set(cfg.blacklist)],
  };
}

// Kogo ochrona nie sprawdza: moderatorzy oraz osoby / role z whitelist.js
function isExempt(member, userId) {
  if (whitelist.has(member, userId)) return true;
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.ManageMessages)
    || member.permissions.has(PermissionFlagsBits.Administrator);
}

// Kanał raportów ustawiony przez /antyscam logi (null = raporty wyłączone albo kanał usunięty)
function findLogChannel(guild) {
  const id = storage.get(guild.id).logChannelId;
  const channel = id ? guild.channels.cache.get(id) : null;
  return channel?.isTextBased?.() ? channel : null;
}

// Treść wiadomości + treść przekazanych (forward) wiadomości
function collectContent(message) {
  const parts = [message.content || ''];
  if (message.messageSnapshots) {
    for (const snap of message.messageSnapshots.values()) parts.push(snap.content || snap.message?.content || '');
  }
  return parts.join('\n');
}

const inviteCache = new Map(); // code -> { guildId, ts }
async function foreignInvites(codes, guildId) {
  const foreign = [];
  for (const code of codes) {
    let entry = inviteCache.get(code);
    if (!entry || Date.now() - entry.ts > 10 * 60 * 1000) {
      const invite = await client.fetchInvite(code).catch(() => null);
      entry = { guildId: invite?.guild?.id ?? null, ts: Date.now() };
      inviteCache.set(code, entry);
    }
    if (entry.guildId && entry.guildId !== guildId) foreign.push(code);
  }
  return foreign;
}

// Żeby przy spamie z przejętego konta nie wysyłać 20 raportów i 20 DM-ów
const recentlyPunished = new Map(); // `${guildId}:${userId}` -> ts
function wasRecentlyPunished(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const last = recentlyPunished.get(key);
  recentlyPunished.set(key, Date.now());
  return last && Date.now() - last < 2 * 60 * 1000;
}

function codeBlock(text) {
  const safe = (text || '(brak tekstu)').replace(/`/g, 'ˋ').slice(0, 1000);
  return `\`\`\`\n${safe}\n\`\`\``;
}

async function sendLog(guild, cfg, {
  user, channelId, title, color, action, reasons, content, attachments, images,
}) {
  const channel = findLogChannel(guild);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'Użytkownik', value: `${user} \`${user.tag}\`\nID: \`${user.id}\``, inline: true },
      { name: 'Kanał', value: `<#${channelId}>`, inline: true },
      { name: 'Akcja', value: action, inline: true },
      { name: 'Dlaczego', value: (displayReasons(reasons).map((r) => `• ${r}`).join('\n') || '-').slice(0, 1024) },
      { name: 'Treść', value: codeBlock(content) },
    )
    .setTimestamp();
  if (attachments) embed.addFields({ name: 'Załączniki', value: String(attachments), inline: true });
  // Kopia obrazków (jako spoiler) - po usunięciu wiadomości Discord kasuje oryginalne załączniki
  const files = (images || []).filter((i) => i.buffer).slice(0, 4)
    .map((i) => ({ attachment: i.buffer, name: `SPOILER_${i.name}` }));
  await channel.send({ embeds: [embed], files }).catch((e) => console.warn(`[log] ${e.message}`));
}

// Bot NIE nakłada żadnych kar (ban, wyciszenie itp.) - tylko usuwa wiadomość ze scamem.

async function dmDeleted(user, guild, reason) {
  await user.send(
    `⚠️ Twoja wiadomość na serwerze **${guild.name}** została usunięta przez ochronę antyscam.\n`
    + `Powód: ${reason}\n\n`
    + 'Jeśli to nie Ty ją wysłałeś, **Twoje konto mogło zostać przejęte**: od razu zmień hasło, '
    + 'włącz 2FA i w Ustawieniach → Urządzenia wyloguj wszystkie sesje.',
  ).catch(() => {});
}

// ---------- reakcje ----------

// Scam: usunięcie tej jednej wiadomości + raport w logach. Bez banów i wyciszeń.
async function removeScam(message, result, cfg, { images } = {}) {
  if (!(await claims.claim('mod', message.id))) return; // zajmuje się tym inna kopia bota
  const repeat = wasRecentlyPunished(message.guildId, message.author.id);
  const deleted = await message.delete().then(() => true).catch(() => false);
  if (repeat) return; // kolejna wiadomość od tej samej osoby w krótkim czasie - usuwamy bez nowego raportu

  if (cfg.dmUser) {
    await dmDeleted(message.author, message.guild, images ? 'scam na obrazku' : 'scam link');
  }

  console.log(`[scam] ${message.guild.name} | ${message.author.tag} | usunięto=${deleted} | ${result.riskyHosts?.join(', ') || ''}`);
  events.record('scam', {
    guildId: message.guildId,
    guildName: message.guild.name,
    user: message.author.tag,
    userId: message.author.id,
    channelId: message.channelId,
    summary: `${images ? 'obrazek: ' : ''}${displayReasons(result.reasons).slice(0, 2).join('; ')}`.slice(0, 300),
    content: collectContent(message).slice(0, 300),
    deleted,
  });
  await sendLog(message.guild, cfg, {
    user: message.author,
    channelId: message.channelId,
    title: images ? '🖼️ Usunięto scam na obrazku' : '🚨 Usunięto scam link',
    color: 0xe74c3c,
    action: deleted ? '🗑️ wiadomość usunięta' : '⚠️ nie udało się usunąć wiadomości (brak uprawnień?)',
    reasons: result.reasons,
    content: collectContent(message),
    attachments: message.attachments.size || null,
    images,
  });
}

// Zablokowana fraza (panel -> Anty Spam): usunięcie wiadomości + raport
async function removePhrase(message, rule, cfg) {
  if (!(await claims.claim('mod', message.id))) return; // zajmuje się tym inna kopia bota
  const repeat = wasRecentlyPunished(message.guildId, message.author.id);
  const deleted = await message.delete().then(() => true).catch(() => false);
  if (repeat) return;

  if (cfg.dmUser) {
    await message.author.send(
      `⚠️ Twoja wiadomość na serwerze **${message.guild.name}** została usunięta, bo zawierała zablokowaną frazę.`,
    ).catch(() => {});
  }
  console.log(`[fraza] ${message.guild.name} | ${message.author.tag} | "${rule.phrase}" | usunięto=${deleted}`);
  events.record('phrase', {
    guildId: message.guildId,
    guildName: message.guild.name,
    user: message.author.tag,
    userId: message.author.id,
    channelId: message.channelId,
    summary: `zablokowana fraza: „${rule.phrase}”`,
    content: collectContent(message).slice(0, 300),
    deleted,
  });
  await sendLog(message.guild, cfg, {
    user: message.author,
    channelId: message.channelId,
    title: '🚫 Usunięto wiadomość z zablokowaną frazą',
    color: 0x9b59b6,
    action: deleted ? '🗑️ wiadomość usunięta' : '⚠️ nie udało się usunąć wiadomości (brak uprawnień?)',
    reasons: [`zablokowana fraza: „${rule.phrase}”`],
    content: collectContent(message),
    attachments: message.attachments.size || null,
  });
}

// Ta sama wiadomość z linkiem / obrazkiem na wielu kanałach (przejęte konto): usunięcie tych kopii
async function removeSpam(message, entries, cfg) {
  if (!(await claims.claim('mod', message.id))) return; // zajmuje się tym inna kopia bota
  let deleted = 0;
  for (const e of entries) {
    const channel = message.guild.channels.cache.get(e.channelId);
    const ok = await channel?.messages?.delete(e.messageId).then(() => true).catch(() => false);
    if (ok) deleted++;
  }
  const channels = new Set(entries.map((e) => e.channelId)).size;
  if (wasRecentlyPunished(message.guildId, message.author.id)) return;

  if (cfg.dmUser) await dmDeleted(message.author, message.guild, 'ta sama wiadomość wysłana na wielu kanałach (spam)');

  console.log(`[spam] ${message.guild.name} | ${message.author.tag} | ${channels} kanałów`);
  events.record('spam', {
    guildId: message.guildId,
    guildName: message.guild.name,
    user: message.author.tag,
    userId: message.author.id,
    channelId: message.channelId,
    summary: `ta sama wiadomość na ${channels} kanałach, usunięto ${deleted}`,
    content: collectContent(message).slice(0, 300),
  });
  await sendLog(message.guild, cfg, {
    user: message.author,
    channelId: message.channelId,
    title: '📢 Usunięto spam na wielu kanałach (prawdopodobnie przejęte konto)',
    color: 0xe67e22,
    action: `🗑️ usunięto ${deleted}/${entries.length} wiadomości`,
    reasons: [`ta sama wiadomość na ${channels} kanałach w ${spamTracker.WINDOW_MS / 1000} s`],
    content: collectContent(message),
    attachments: message.attachments.size || null,
  });
}

// Ocena tekstu i linków (każdej linii wiadomości): domeny, zaproszenia, skrócone linki
async function evaluateText(message, cfg) {
  const content = collectContent(message);
  const ctx = buildCtx(cfg);
  let result = analyzeMessage(content, ctx);

  if (cfg.blockInvites && result.invites.length) {
    const foreign = await foreignInvites(result.invites, message.guildId);
    if (foreign.length) {
      result.score = 100;
      result.reasons.unshift(`zaproszenie na inny serwer: ${foreign.map((c) => `\`${c}\``).join(', ')} (+100)`);
    }
  }

  // bit.ly i inne skracacze: sprawdzamy, dokąd naprawdę prowadzą
  if (!isScam(result) && result.shortLinks.length) {
    const targets = (await Promise.all(result.shortLinks.slice(0, 5).map((u) => linkResolver.resolve(u))))
      .filter(Boolean);
    if (targets.length) {
      const expanded = analyzeMessage(`${content}\n${targets.join('\n')}`, ctx);
      if (expanded.score > result.score) {
        const hosts = targets.map((t) => `\`${new URL(t).hostname}\``).join(', ');
        expanded.reasons.unshift(`skrócony link prowadzi do: ${hosts}`);
        result = { ...expanded, invites: result.invites };
      }
    }
  }
  return result;
}

// Obrazki: znane obrazki scamu, kody QR, tekst i linki odczytane przez OCR
async function evaluateImages(message, cfg) {
  if (!cfg.scanImages || !imageScanner.collectImages(message).length) return null;
  const images = await imageScanner.scanMessage(message);
  const result = imageScanner.evaluate(images, collectContent(message), buildCtx(cfg), cfg.imageHashes);
  // pewny scam -> zapamiętaj obrazek, żeby następnym razem usunąć go od razu
  if (isScam(result)) {
    storage.addImageHashes(message.guildId, images.map((i) => i.hash).filter(imageScanner.isUsefulHash));
  }
  return { result, images };
}

async function getMember(message) {
  return message.member ?? message.guild.members.fetch(message.author.id).catch(() => null);
}

// Ochrona: zwraca true, jeśli wiadomość była scamem/spamem i została usunięta
async function protect(message, cfg) {
  const channelIds = phrases.channelIdsOf(message);
  const rule = phrases.findBlockedPhrase(collectContent(message), cfg.blockedPhrases, channelIds);
  if (rule) {
    await removePhrase(message, rule, cfg);
    return true;
  }
  // blokada scam linków / spamu / obrazków tylko na wybranych kanałach (pusta lista = wszędzie)
  if (!phrases.isProtectedChannel(cfg.protectedChannels, channelIds)) return false;

  const result = await evaluateText(message, cfg);
  if (isScam(result)) {
    await removeScam(message, result, cfg);
    return true;
  }

  if (cfg.crossChannelSpam) {
    const entries = spamTracker.track(message);
    if (entries) {
      await removeSpam(message, entries, cfg);
      return true;
    }
  }

  const img = await evaluateImages(message, cfg);
  if (img && isScam(img.result)) {
    await removeScam(message, img.result, cfg, { images: img.images });
    return true;
  }
  return false;
}

async function handleMessage(message) {
  if (!message.inGuild() || message.system || message.author?.bot) return;
  const cfg = storage.get(message.guildId);

  // 1. najpierw ochrona (moderatorów nie sprawdzamy) - na usunięty scam AI nie odpowiada
  const member = await getMember(message);
  if (cfg.enabled && !isExempt(member, message.author.id) && await protect(message, cfg)) return;

  // 2. AI (Gemini): oznaczenie bota / odpowiedź na jego wiadomość -> zawsze odpowiada,
  //    zwykłe pytanie na czacie (bez pingowania) -> odpowiada sam, jeśli to pytanie, na które może pomóc
  if (!client.user) return; // bot jeszcze nie w pełni zalogowany
  const direct = ai.isQuestion(message, client.user);
  if (!direct && !ai.shouldAutoAnswer(message, client.user)) return;
  if (!(await claims.claim('ai', message.id))) return; // odpowiada już inna kopia bota
  await ai.answer(message, client.user, direct ? {} : { auto: true });
}

// ---------- zdarzenia ----------

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Zalogowano jako ${c.user.tag} na ${c.guilds.cache.size} serwerach`);
  const invite = `https://discord.com/oauth2/authorize?client_id=${c.user.id}&scope=bot+applications.commands&permissions=${INVITE_PERMISSIONS}`;
  if (!c.guilds.cache.size) {
    console.log('⚠️  Bot nie jest jeszcze na żadnym serwerze. Zaproś go tym linkiem:');
  } else {
    console.log('   Link do zaproszenia na kolejny serwer:');
  }
  console.log(`   ${invite}`);
  // Bez "Zarządzania wiadomościami" bot nie usunie scamu
  for (const guild of c.guilds.cache.values()) {
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (me && !me.permissions.has(PermissionFlagsBits.ManageMessages)) {
      console.log(`⚠️  Na serwerze "${guild.name}" bot nie ma uprawnienia "Zarządzanie wiadomościami" - nie usunie scamów!`);
    }
  }
  try {
    if (HOME_GUILDS.length) {
      await c.application.commands.set([]); // czyści globalne, żeby nie było duplikatów
      for (const id of HOME_GUILDS) {
        const label = id === DEV_GUILD_ID ? 'developerski' : 'główny';
        const guild = await c.guilds.fetch(id).catch(() => null);
        if (!guild) {
          console.log(`⚠️  Bota nie ma na serwerze ${label}m (${id}). Zaproś go linkiem powyżej.`);
          continue;
        }
        await guild.commands.set([commands.data]);
        console.log(`Komendy zarejestrowane na serwerze ${label}m: ${guild.name}`);
      }
    } else {
      await c.application.commands.set([commands.data]);
      console.log('Komendy zarejestrowane globalnie');
    }
  } catch (err) {
    console.error('Nie udało się zarejestrować komend:', err.message);
  }
  console.log(ai.isEnabled()
    ? `🤖 AI włączone: Gemini ${ai.MODEL}${ai.USE_SEARCH ? ' + wyszukiwarka Google' : ''} (odpowiada na pytania na czacie, bez pingowania)`
    : '🤖 AI wyłączone - dodaj GEMINI_API_KEY do pliku .env, żeby bot odpowiadał na pytania');
  phishingLists.start(LIST_URLS, Number(process.env.PHISHING_LIST_REFRESH_HOURS) || 6);
  if (storage.get('').scanImages) imageScanner.warmup(); // pierwsze uruchomienie pobiera model OCR (~10 MB)
  else console.log('🖼️  Czytanie obrazków (OCR) wyłączone (OCR_ENABLED=false)');
  checkDailyReports();
  setInterval(checkDailyReports, 5 * 60 * 1000);
  startAdminPanel();
  if (db) {
    startHeartbeat(db, () => ({
      instance: claims.INSTANCE,
      tag: client.user?.tag,
      ping: Math.round(client.ws.ping),
      guilds: client.guilds.cache.size,
      phishing: phishingLists.remoteDomains.size,
      ai: ai.isEnabled(),
      startedAt: Date.now() - (client.uptime || 0),
    }));
  }
});

// ---------- panel administracyjny (PEP Creators) ----------

// ---------- raport serwera na kanał raportów (codziennie o REPORT_HOUR + przycisk w panelu) ----------
const REPORT_HOUR = Number(process.env.REPORT_HOUR ?? 20);

function warsawNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Wysyła raport (ostatnie 24 h) na kanał raportów serwera. Zwraca { ok, error }. */
async function sendServerReport(guild) {
  const channel = findLogChannel(guild);
  if (!channel) return { ok: false, error: 'Na tym serwerze nie ustawiono kanału raportów.' };
  await events.refresh().catch(() => {}); // Supabase: aktualne zdarzenia (lokalnie nic nie robi)
  const { embed, summary } = report.buildReport(guild, events.list({ guildIds: [guild.id], limit: 1000 }));
  try {
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    console.log(`[raport] ${guild.name}: ${summary.people.length} osób ze scam linkami -> #${channel.name}`);
    return { ok: true, channel: channel.name };
  } catch (err) {
    return { ok: false, error: `Nie udało się wysłać raportu (${err.message}).` };
  }
}

let reportRunning = false;
async function checkDailyReports() {
  if (reportRunning || !client.isReady()) return;
  reportRunning = true;
  try {
    const { day, hour } = warsawNow();
    if (hour < REPORT_HOUR) return;
    for (const guild of client.guilds.cache.values()) {
      const cfg = storage.get(guild.id);
      if (!cfg.logChannelId || cfg.lastReportDay === day) continue;
      if (!(await claims.claim('report', `${guild.id}:${day}`))) continue; // raport wysyła inna kopia bota
      const res = await sendServerReport(guild);
      if (res.ok) storage.setLastReportDay(guild.id, day);
    }
  } finally {
    reportRunning = false;
  }
}

let panelServer = null;
function formatUptime(ms) {
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m % 60} min` : `${m % 60} min`;
}

function startAdminPanel() {
  const port = Number((process.env.PANEL_PORT || (db ? '0' : '3000')).trim()); // z Supabase panel jest na Vercelu
  if (!port) return; // PANEL_PORT=0 wyłącza panel
  const publicUrl = (process.env.PANEL_URL || `http://localhost:${port}`).trim().replace(/\/+$/, '');
  panelServer = panel.startPanel({
    client,
    storage,
    events,
    knowledge: knowledgeStore,
    whitelist,
    ranks,
    accessList: access,
    sendReport: (guild) => sendServerReport(guild),
    port,
    host: (process.env.PANEL_HOST || '127.0.0.1').trim(),
    publicUrl,
    clientSecret: (process.env.DISCORD_CLIENT_SECRET || '').trim(),
    sessionSecret: panel.loadSessionSecret(require('node:path').join(__dirname, '..', 'data', 'panel-secret.txt')),
    homeGuildIds: HOME_GUILDS,
    getStatus: () => ({
      online: client.isReady(),
      tag: client.user?.tag,
      ping: Math.round(client.ws.ping),
      uptime: formatUptime(client.uptime || 0),
      guilds: client.guilds.cache.size,
      phishing: phishingLists.remoteDomains.size,
      ai: ai.isEnabled(),
    }),
  });
}

client.on(Events.MessageCreate, (m) => handleMessage(m).catch((e) => console.error('[messageCreate]', e)));

const imageEmbedCount = (m) => (m.partial ? 0 : m.embeds.filter((e) => e.data?.type === 'image').length);

// Edycje: scamerzy dopisują link do niewinnej wiadomości. Discord też "edytuje" wiadomość,
// gdy doda podgląd linku - jeśli to podgląd obrazka (np. imgur), skanujemy ten obrazek.
client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
  try {
    if (newMsg.partial) newMsg = await newMsg.fetch();
    if (!newMsg.inGuild() || newMsg.author?.bot) return;
    const contentChanged = oldMsg.partial || oldMsg.content !== newMsg.content;
    const newImagePreview = imageEmbedCount(newMsg) > imageEmbedCount(oldMsg);
    if (!contentChanged && !newImagePreview) return;

    const cfg = storage.get(newMsg.guildId);
    if (!cfg.enabled) return;
    const member = await getMember(newMsg);
    if (isExempt(member, newMsg.author.id)) return;

    const channelIds = phrases.channelIdsOf(newMsg);
    if (contentChanged) {
      const rule = phrases.findBlockedPhrase(collectContent(newMsg), cfg.blockedPhrases, channelIds);
      if (rule) {
        await removePhrase(newMsg, rule, cfg);
        return;
      }
    }
    if (!phrases.isProtectedChannel(cfg.protectedChannels, channelIds)) return;

    if (contentChanged) {
      const result = await evaluateText(newMsg, cfg);
      if (isScam(result)) {
        await removeScam(newMsg, result, cfg);
        return;
      }
    }
    if (newImagePreview) {
      const img = await evaluateImages(newMsg, cfg);
      if (img && isScam(img.result)) {
        await removeScam(newMsg, img.result, cfg, { images: img.images });
      }
    }
  } catch (e) {
    if (e.code !== 10008) console.error('[messageUpdate]', e); // 10008 = wiadomość już usunięta
  }
});

client.on(Events.InteractionCreate, (i) => {
  commands.handle(i, { findLogChannel }).catch((e) => {
    console.error('[komenda]', e);
    if (!i.isRepliable()) return;
    const msg = { content: '❌ Błąd komendy.', flags: MessageFlags.Ephemeral };
    (i.deferred || i.replied ? i.editReply('❌ Błąd komendy.') : i.reply(msg)).catch(() => {});
  });
});

client.on(Events.Error, (e) => console.error('[client]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

async function shutdown() {
  console.log('Zamykanie...');
  panelServer?.close();
  await imageScanner.shutdown().catch(() => {});
  await client.destroy();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Supabase: wczytaj dane przed startem i odświeżaj co 30 s (zmiany z panelu na Vercelu)
async function startDatabaseSync() {
  if (!db) return;
  const refreshAll = () => Promise.all([storage.refresh(), access.refresh(), knowledgeStore.refresh()])
    .catch((err) => console.warn(`[baza] odświeżenie nieudane: ${err.message}`));
  await refreshAll();
  console.log('🗄️  Supabase: dane wczytane (odświeżanie co 30 s)');
  setInterval(refreshAll, 30 * 1000);
  ai.setKnowledgeSource(() => knowledgeStore.text());
  const cleanup = () => Promise.all([events.cleanup(), claims.cleanup()])
    .catch((err) => console.warn(`[baza] czyszczenie: ${err.message}`));
  cleanup();
  setInterval(cleanup, 24 * 60 * 60 * 1000);
}

startDatabaseSync()
  .catch((err) => console.error(`❌ Supabase: ${err.message} - bot działa dalej na ostatnich znanych danych`))
  .then(() => client.login(DISCORD_TOKEN)).catch(async (err) => {
  // process.exit() w trakcie zamykania połączenia wywala Node na Windowsie - zamykamy łagodnie
  let code = EXIT_CONFIG_ERROR;
  if (err.code === 'TokenInvalid') {
    console.error('❌ Token bota jest nieprawidłowy. Wygeneruj nowy (Developer Portal → Bot → Reset Token)');
    console.error('   i wklej go do pliku .env po DISCORD_TOKEN=');
  } else if (/disallowed intents/i.test(err.message)) {
    console.error('❌ Discord odrzucił połączenie: wyłączony MESSAGE CONTENT INTENT.');
    console.error('   Developer Portal → Twoja aplikacja → Bot → włącz "MESSAGE CONTENT INTENT" → Save Changes.');
  } else {
    console.error('❌ Nie udało się połączyć z Discordem:', err.message);
    code = 1; // np. brak internetu - start.bat spróbuje ponownie
  }
  await client.destroy().catch(() => {});
  await imageScanner.shutdown().catch(() => {});
  process.exitCode = code;
});
