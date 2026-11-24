// Komendy: /antyscam status i /antyscam logi. Resztę bot robi sam.
const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, InteractionContextType, MessageFlags, ChannelType,
} = require('discord.js');
const storage = require('./storage');
const phishingLists = require('./phishingLists');
const KNOWN_SCAM_IMAGES = require('./knownScamImages');
const ai = require('./ai');

const data = new SlashCommandBuilder()
  .setName('antyscam')
  .setDescription('Ochrona przed scam linkami')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('status').setDescription('Pokaż, czy ochrona działa'))
  .addSubcommand((s) => s.setName('logi').setDescription('Kanał na raporty o usuniętych scamach (puste = wyłącz raporty)')
    .addChannelOption((o) => o.setName('kanal').setDescription('Kanał raportów')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)));

// Uprawnienia, których bot potrzebuje na kanale raportów
const LOG_PERMISSIONS = [
  [PermissionFlagsBits.ViewChannel, 'Wyświetlanie kanału'],
  [PermissionFlagsBits.SendMessages, 'Wysyłanie wiadomości'],
  [PermissionFlagsBits.EmbedLinks, 'Osadzanie linków'],
  [PermissionFlagsBits.AttachFiles, 'Załączanie plików'],
];

function statusEmbed(cfg, logChannel) {
  const updated = phishingLists.getLastUpdate();
  const listInfo = phishingLists.remoteDomains.size
    ? `${phishingLists.remoteDomains.size} domen${updated ? ` (aktualizacja <t:${Math.floor(updated / 1000)}:R>)` : ''}`
    : '⏳ pobieranie...';
  return new EmbedBuilder()
    .setTitle('🛡️ Antyscam - status')
    .setColor(0x2ecc71)
    .setDescription('Bot działa automatycznie: sam sprawdza linki, obrazki i kody QR w każdej wiadomości '
      + 'i **usuwa tylko wiadomości ze scamem**. Nikogo nie banuje ani nie wycisza.')
    .addFields(
      { name: 'Ochrona', value: '✅ działa', inline: true },
      {
        name: 'Kanał raportów',
        value: logChannel ? `${logChannel}` : 'brak – ustaw: `/antyscam logi kanal:#kanał`',
        inline: true,
      },
      { name: 'Publiczna baza phishingu', value: listInfo, inline: true },
      { name: 'Skanowanie obrazków', value: '✅ tekst, linki i kody QR', inline: true },
      { name: 'Spam na wielu kanałach', value: '✅ wykrywany', inline: true },
      {
        name: 'Odpowiedzi AI',
        value: ai.isEnabled() ? `✅ Gemini \`${ai.MODEL}\` – odpowiada na pytania na czacie` : '❌ brak klucza GEMINI_API_KEY w .env',
        inline: true,
      },
      {
        name: 'Znane obrazki scamu',
        value: `${KNOWN_SCAM_IMAGES.length} wbudowanych + ${cfg.imageHashes.length} zapamiętanych na tym serwerze`,
        inline: true,
      },
    );
}

async function handle(interaction, { findLogChannel }) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'antyscam') return;
  const reply = (payload) => interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();

  if (sub === 'logi') {
    const channel = interaction.options.getChannel('kanal');
    storage.setLogChannel(interaction.guildId, channel?.id);
    if (!channel) return reply({ content: '✅ Raporty wyłączone. Bot dalej usuwa scamy, tylko bez raportów.' });

    const me = interaction.guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    const missing = perms ? LOG_PERMISSIONS.filter(([flag]) => !perms.has(flag)).map(([, name]) => name) : [];
    return reply({
      content: `✅ Raporty o usuniętych scamach będą wysyłane na ${channel}.`
        + (missing.length ? `\n⚠️ Bot nie ma tam uprawnień: **${missing.join(', ')}** – dodaj je, inaczej raporty nie dojdą.` : ''),
    });
  }

  const cfg = storage.get(interaction.guildId);
  return reply({ embeds: [statusEmbed(cfg, findLogChannel(interaction.guild))] });
}

module.exports = { data, handle };
