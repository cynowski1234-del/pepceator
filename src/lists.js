// Wbudowane listy używane przez detektor.

// Domeny zawsze uznawane za bezpieczne (wraz z subdomenami).
const SAFE_DOMAINS = [
  // Discord
  'discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media',
  'discord.gift', 'discord.new', 'discord.dev', 'discord.co', 'discordstatus.com',
  'discordmerch.com', 'dis.gd', 'discord.js.org', 'discordjs.guide',
  // Popularne katalogi serwerów / botów
  'top.gg', 'disboard.org', 'discordbotlist.com', 'discord.me', 'discords.com', 'discordservers.com',
  // Steam / gry
  'steamcommunity.com', 'steampowered.com', 'steamstatic.com', 'steamgifts.com', 'steamdb.info',
  'epicgames.com', 'roblox.com', 'minecraft.net', 'riotgames.com', 'leagueoflegends.com',
  'ea.com', 'ubisoft.com', 'xbox.com', 'playstation.com', 'nintendo.com', 'battle.net', 'gog.com',
  // Media / social
  'youtube.com', 'youtu.be', 'twitch.tv', 'twitter.com', 'x.com', 'reddit.com', 'redd.it',
  'instagram.com', 'facebook.com', 'tiktok.com', 'spotify.com', 'soundcloud.com',
  'tenor.com', 'giphy.com', 'imgur.com', 'gyazo.com', 'prnt.sc', 'medal.tv', 'streamable.com',
  'shopmrbeast.com', 'mrbeast.store', 'feastables.com', 'beastphilanthropy.org',
  // Inne
  'google.com', 'github.com', 'githubusercontent.com', 'gitlab.com', 'wikipedia.org',
  'microsoft.com', 'apple.com', 'amazon.com', 'paypal.com', 'paypal.me', 'allegro.pl',
  'wykop.pl', 'onet.pl', 'wp.pl', 'interia.pl', 'gov.pl',
];

// Marki, pod które scamerzy najczęściej się podszywają (literówki w domenie).
// minLen chroni przed fałszywymi alarmami przy krótkich nazwach.
const LOOKALIKE_BRANDS = [
  'discord', 'discordapp', 'discordnitro', 'steamcommunity', 'steampowered',
  'roblox', 'paypal', 'coinbase', 'metamask', 'mrbeast', 'epicgames', 'youtube',
];

// Gdy domena to dokładnie <marka>.<inna końcówka>, np. discord.gifts, steamcommunity.ru
const EXACT_BRAND_ABUSE = ['discord', 'discordapp', 'discordnitro', 'steamcommunity', 'steampowered', 'mrbeast'];

// Marki, których obecność w nazwie domeny jest podejrzana (np. discord-nitro-gift.xyz)
const BRANDS_IN_DOMAIN = [
  'discord', 'steamcommunity', 'steampowered', 'mrbeast', 'metamask', 'binance',
  'coinbase', 'paypal', 'roblox', 'epicgames', 'csgo', 'cs2',
];

// Słowa w nazwie domeny typowe dla scamów
const SCAM_WORDS_IN_DOMAIN = [
  'gift', 'nitro', 'giveaway', 'free', 'airdrop', 'claim', 'promo', 'drop', 'bonus',
  'reward', 'event', 'trade', 'skins', 'verify', 'login', 'auth', 'wallet', 'crypto', 'casino',
];

// Skracacze linków - ukrywają prawdziwy adres
const URL_SHORTENERS = [
  'bit.ly', 'tinyurl.com', 'cutt.ly', 't.ly', 'is.gd', 'rb.gy', 'shorturl.at', 'goo.su',
  'tiny.cc', 'ow.ly', 'v.gd', 'shorturl.asia', 'clck.ru', 'u.to', 'qr.ae', 'rebrand.ly',
  'bl.ink', 's.id', 'short.gy', 'gg.gg', 'linkr.it', 'shorturl.gg', 'surl.li', 'tinyurl.mobi',
];

// IP-loggery: link zapisuje adres IP osoby, która go kliknie (często udają zwykłe strony)
const IP_LOGGERS = [
  'grabify.link', 'iplogger.org', 'iplogger.com', 'iplogger.ru', 'iplogger.co', 'iplogger.info',
  '2no.co', 'yip.su', 'iplis.ru', 'blasze.com', 'bmwforum.co', 'leancoding.co', 'spottyfly.com',
  'stopify.co', 'catsnthings.com', 'curiouscat.club', 'joinmy.site', 'screenshare.host',
  'headshot.monster', 'gamingfun.me', 'quickmessage.us',
];

// Końcówki domen często używane przez scamerów
const SUSPICIOUS_TLDS = [
  'xyz', 'top', 'click', 'gift', 'gifts', 'tk', 'ml', 'ga', 'cf', 'gq', 'icu', 'live', 'shop',
  'monster', 'rest', 'cfd', 'sbs', 'buzz', 'fun', 'site', 'online', 'store', 'cyou', 'bond',
  'vip', 'win', 'bet', 'lol', 'pw', 'best', 'link', 'su', 'ru', 'cn', 'asia', 'quest', 'world',
];

// Końcówki, przy których rozpoznajemy domenę bez http:// (np. "discorcl.gift/abc")
const BARE_DOMAIN_TLDS = new Set([
  ...SUSPICIOUS_TLDS,
  'com', 'net', 'org', 'pl', 'io', 'gg', 'co', 'me', 'info', 'biz', 'app', 'dev', 'cc', 'tv',
  'us', 'uk', 'de', 'eu', 'pro', 'ly', 'ws', 'one', 'today', 'space', 'website', 'store', 'to',
]);

// Sufiksy dwuczłonowe (żeby z "abc.com.pl" wyciągnąć domenę "abc.com.pl", a nie "com.pl")
const MULTI_PART_SUFFIXES = new Set([
  'com.pl', 'net.pl', 'org.pl', 'co.uk', 'org.uk', 'com.br', 'com.au', 'co.jp', 'com.tr',
  'com.ru', 'com.ua', 'co.in', 'com.mx', 'com.ar', 'co.za', 'com.cn', 'com.de', 'ru.com',
]);

// Frazy w treści wiadomości (sprawdzane po normalizacji: małe litery, bez polskich znaków, leet -> litery)
// [regex, punkty, opis]
const TEXT_RULES = [
  [/\bfree\s*nitro\b|\bnitro\s*(for\s*)?free\b|\bdarmow\w*\s*nitro\b|\bnitro\s*za\s*darmo\b/, 30, 'darmowe Nitro'],
  [/\bsteam\s*gift\b|\bgift\s*(for\s*)?steam\b|\$?\s*50\s*\$?\s*steam\b/, 25, 'prezent Steam'],
  [/\bgive\s*away\b|\bgiveaway\b|\bgiving\s*away\b|\brozdani\w*\b|\brozdaj\w*\b/, 20, 'giveaway / rozdanie'],
  [/\bair\s*drop\b|\bairdrop\b/, 20, 'airdrop'],
  [/\bclaim\w*\b|\bodbierz\w*\b|\bodebra\w*\b/, 15, 'zachęta do odebrania nagrody'],
  [/\bpromo\s*code\b|\bpromokod\w*\b|\bkod\w*\s*promocyjn\w*\b|\bbonus\s*code\b|\buse\s*code\b/, 20, 'kod promocyjny'],
  [/\bwithdraw\w*\b|\bwyplac\w*\b|\bwyplat\w*\b/, 15, 'wypłata pieniędzy'],
  [/\bcasino\b|\bkasyn\w*\b|\bbetting\b/, 15, 'kasyno'],
  [/\bcrypto\w*\b|\bbitcoin\b|\bbtc\b|\busdt\b|\btether\b|\bethereum\b|\beth\b|\bsolana\b/, 15, 'kryptowaluty'],
  // Scamy "kasyno krypto MrBeasta": screeny panelu kasyna z kodem bonusowym i "udaną wypłatą"
  [/activat\w*\s*(the\s*)?code|enter\s*(the\s*)?(promo\s*)?code|aktywuj\w*\s*kod/, 20, 'aktywacja kodu bonusowego'],
  [/rake\s*back/, 20, 'rakeback (kasyno)'],
  [/ithdra\w*\s*(was\s*)?succes|wyplat\w*\s*(zakonczon|udan)/, 25, 'screen „udanej wypłaty” (typowy „dowód” w scamie)'],
  [/bonus/, 10, 'bonus'],
  [/\bdeposit\w*\b|\bdepozyt\w*/, 10, 'depozyt'],
  [/\b(erc|trc|bep)\s*-?\s*20\b/, 15, 'sieć krypto (ERC20 / TRC20 / BEP20)'],
  [/\beveryone\s*who\s*(registers|signs?\s*up|joins)\b|\bzarejestruj\w*\b/, 15, 'zachęta do rejestracji'],
  [/\b(i\s*am|i'?m)\s*(leaving|quitting)\b|\baccidental+y\s*report\w*\b|\bprzypadkowo\s*zglosil\w*\b/, 25, 'typowy tekst scamu (accidentally reported / leaving)'],
  [/\byou\s*(have\s*)?won\b|\bwygral\w*\b|\bwygraj\w*\b|\bwinner\b|\bzwyciezc\w*\b/, 15, 'wygrana'],
  [/\bfirst\s*come\b|\bkto\s*pierwszy\b|\blimited\s*time\b|\bonly\s*today\b|\btylko\s*dzis\b/, 10, 'presja czasu'],
  [/\bgift\b|\bprezent\w*\b/, 10, 'prezent'],
  [/\b(verify|weryfik\w*)\b.*\b(account|konto|wallet|portfel)\b/, 15, 'fałszywa weryfikacja konta'],
];

module.exports = {
  SAFE_DOMAINS,
  LOOKALIKE_BRANDS,
  EXACT_BRAND_ABUSE,
  BRANDS_IN_DOMAIN,
  SCAM_WORDS_IN_DOMAIN,
  URL_SHORTENERS,
  IP_LOGGERS,
  SUSPICIOUS_TLDS,
  BARE_DOMAIN_TLDS,
  MULTI_PART_SUFFIXES,
  TEXT_RULES,
};
