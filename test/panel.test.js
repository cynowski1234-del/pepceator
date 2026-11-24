// Testy panelu administracyjnego: podstawiony Discord (klient bota + OAuth2), prawdziwe żądania HTTP.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection, PermissionFlagsBits } = require('discord.js');
const { createPanel } = require('../src/panel/server');
const knowledgeModule = require('../src/knowledge');
const ranksModule = require('../src/ranks');
const accessModule = require('../src/access');
const accessStore = accessModule.create(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pep-access-')), 'panel-access.json'));
const reportsSent = [];
const instructionsModule = require('../src/panel/instructions');
const guidesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pep-guides-'));

// ---------- podstawiony Discord ----------
const admins = new Set(['ADM']);
const channel = {
  id: 'C1', name: 'logi', rawPosition: 0, isTextBased: () => true, isThread: () => false, isVoiceBased: () => false,
};
const guild = {
  id: 'G1',
  name: 'Serwer testowy',
  ownerId: 'OWNER',
  channels: { cache: new Collection([['C1', channel], ['C2', { ...channel, id: 'C2', name: 'ogolny', rawPosition: 1 }]]) },
  members: {
    fetch: async (id) => {
      if (id === 'USR' || admins.has(id)) {
        return { permissions: { has: (flag) => flag === PermissionFlagsBits.Administrator && admins.has(id) } };
      }
      throw new Error('Unknown Member');
    },
  },
};
const client = {
  application: { id: 'APP' },
  user: { id: 'APP' },
  guilds: { cache: new Collection([['G1', guild]]) },
  users: {
    cache: new Map([['777777777777777777', { tag: 'zaufany', globalName: 'Zaufany Janek' }]]),
    fetch: async (id) => {
      const known = {
        '123456789012345678': { tag: 'nowy', globalName: 'Nowy Tester', bot: false },
        '987654321098765432': { tag: 'jakisbot', bot: true },
      };
      if (known[id]) return known[id];
      throw new Error('Unknown User');
    },
  },
};
guild.roles = { cache: new Map([['888888888888888888', { name: 'Zaufani' }]]) };
const fakeWhitelist = {
  entries: () => ({ users: ['777777777777777777', '999999999999999999'], roles: ['888888888888888888'], invalid: ['janek'] }),
};

const users = {
  'kod-admin': { id: 'ADM', username: 'admin', global_name: 'Admin' },
  'kod-user': { id: 'USR', username: 'zwykly' },
  'kod-tester': { id: 'TST', username: 'tester' },
  'kod-dev': { id: 'DEV', username: 'developer' },
  'kod-creator': { id: 'CRE', username: 'creator' },
  'kod-nowy': { id: '123456789012345678', username: 'nowy' },
  'kod-owner': { id: 'OWNER', username: 'wlasciciel' },
};
// rangi: osoby BEZ Administratora na serwerze
const rankOfUser = { TST: 'ALPHA TESTER', DEV: 'DEVELOPER', CRE: 'PEP CREATOR' };
const fakeRanks = {
  rankOf: (id) => ranksModule.rankInfo(rankOfUser[id] || accessStore.get(id)?.rank),
  entries: () => ({ ranks: Object.keys(ranksModule.RANKS).map((n) => ({ ...ranksModule.rankInfo(n), users: n === 'DEVELOPER' ? ['DEV'] : [] })), invalid: [] }),
};
const fakeDiscordFetch = async (url, opts = {}) => {
  if (url.endsWith('/oauth2/token')) {
    const code = new URLSearchParams(opts.body).get('code');
    return new Response(JSON.stringify({ access_token: `token-${code}` }), { status: users[code] ? 200 : 400 });
  }
  if (url.endsWith('/users/@me')) {
    const code = opts.headers.Authorization.replace('Bearer token-', '');
    return new Response(JSON.stringify(users[code]), { status: 200 });
  }
  throw new Error(`nieoczekiwane zapytanie: ${url}`);
};

const settings = { logChannelId: null, imageHashes: ['a', 'b'], blockedPhrases: [], protectedChannels: [] };
const storage = {
  get: () => ({ ...settings }),
  setLogChannel: (g, id) => { settings.logChannelId = id; },
  clearImageHashes: () => { const n = settings.imageHashes.length; settings.imageHashes = []; return n; },
  addPhrase: (g, phrase, channels) => {
    const r = { id: `r${settings.blockedPhrases.length}`, phrase, channels };
    settings.blockedPhrases.push(r);
    return r;
  },
  removePhrase: (g, id) => {
    const r = settings.blockedPhrases.find((x) => x.id === id);
    settings.blockedPhrases = settings.blockedPhrases.filter((x) => x.id !== id);
    return r;
  },
  setProtectedChannels: (g, ids) => { settings.protectedChannels = ids; },
};
const recorded = [
  { type: 'scam', ts: Date.now(), guildId: 'G1', guildName: 'Serwer testowy', user: 'scamer#1', userId: '111', channelId: 'C2', summary: 'literówka w domenie', content: 'free nitro https://discorcl.gift/x' },
  { type: 'phrase', ts: Date.now() - 1000, guildId: 'G1', guildName: 'Serwer testowy', user: 'scamer#1', userId: '111', channelId: 'C1', summary: 'zablokowana fraza: „kup*”', content: 'kupujcie konta <b>tanio</b>' },
  { type: 'spam', ts: Date.now() - 5000, guildId: 'G1', guildName: 'Serwer testowy', user: 'inny#2', userId: '222', channelId: 'C1', summary: 'ta sama wiadomość na 3 kanałach', content: 'promo' },
  { type: 'ai', ts: Date.now(), guildId: 'G1', guildName: 'Serwer testowy', user: 'janek', question: 'kiedy pep', answer: 'Między lutym a marcem.' },
];
const events = { list: () => recorded, totals: () => ({ scam: 1, ai: 1 }) };

const kFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pep-panel-')), 'wiedza.md');
fs.writeFileSync(kFile, '# Baza wiedzy\n\n## Kiedy PEP?\nMiędzy lutym a marcem.\n');

let base;
let server;
test.before(async () => {
  const app = createPanel({
    client,
    storage,
    events,
    knowledge: knowledgeModule.create(kFile),
    getStatus: () => ({ online: true, tag: 'PEP BOT#1', ping: 42, uptime: '5 min', guilds: 1, phishing: 21908, ai: true }),
    publicUrl: 'http://localhost:3999',
    clientSecret: 'sekret',
    sessionSecret: 'x'.repeat(64),
    fetchImpl: fakeDiscordFetch,
    whitelist: fakeWhitelist,
    ranks: fakeRanks,
    instructions: instructionsModule.create(guidesDir),
    accessList: accessStore,
    homeGuildIds: ['G1'],
    sendReport: async (g) => { reportsSent.push(g.id); return { ok: true, channel: 'logi' }; },
  });
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const get = (p, cookie) => fetch(base + p, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const post = (p, cookie, form) => fetch(base + p, {
  method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form),
});
const cookiesOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

async function login(code) {
  const start = await get('/login');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  return get(`/auth/callback?code=${code}&state=${state}`, cookiesOf(start));
}
async function adminSession(code = 'kod-admin') {
  const res = await login(code);
  const cookie = cookiesOf(res).split('; ').find((c) => c.startsWith('pep_session=') && c.length > 13);
  const html = await (await get('/panel', cookie)).text();
  return { cookie, csrf: html.match(/name="_csrf" value="([^"]+)"/)[1] };
}

test('ekran logowania: kwadrat PEP Creators z przyciskiem Discorda', async () => {
  const res = await get('/');
  const html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.match(html, /<h1>PEP Creators<\/h1>/);
  assert.match(html, /class="discord-btn" href="\/login"/);
  assert.match(html, /class="discord-logo"/);
  assert.match(html, /Zaloguj się przez Discord/);
  assert.doesNotMatch(html, /Dostęp tylko dla administratorów/, 'napis usunięty z ekranu logowania');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('bez logowania panel przekierowuje na ekran logowania', async () => {
  const res = await get('/panel');
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/');
});

test('/login kieruje do Discorda z zakresem identify i losowym "state"', async () => {
  const res = await get('/login');
  const url = new URL(res.headers.get('location'));
  assert.strictEqual(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
  assert.strictEqual(url.searchParams.get('client_id'), 'APP');
  assert.strictEqual(url.searchParams.get('scope'), 'identify');
  assert.strictEqual(url.searchParams.get('redirect_uri'), 'http://localhost:3999/auth/callback');
  assert.match(url.searchParams.get('state'), /^[a-f0-9]{32}$/);
});

test('powrót z Discorda z obcym "state" jest odrzucany', async () => {
  const start = await get('/login');
  const res = await get('/auth/callback?code=kod-admin&state=podrobiony', cookiesOf(start));
  assert.strictEqual(res.headers.get('location'), '/?err=stan');
});

test('zwykły użytkownik (bez Administratora) nie wchodzi do panelu', async () => {
  const res = await login('kod-user');
  assert.strictEqual(res.status, 403);
  assert.match(await res.text(), /tylko dla administratorów/);
  assert.ok(!cookiesOf(res).includes('pep_session=e'), 'brak sesji');
});

test('administrator loguje się i widzi pulpit z kategorią Pytania', async () => {
  const res = await login('kod-admin');
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/panel');
  const { cookie } = await adminSession();
  const html = await (await get('/panel', cookie)).text();
  assert.match(html, /Pulpit/);
  assert.match(html, /<summary><svg class="ico ico-chat"[^>]*>.*?<\/svg><span>Edycja Pytania<\/span>/);
  assert.match(html, /<span>Anty Spam<\/span>/);
  assert.match(html, /Logi użytkownika/);
  const sidebar = html.slice(html.indexOf('<nav class="sidebar">'), html.indexOf('</nav>'));
  assert.doesNotMatch(sidebar, /[\u{1F300}-\u{1FAFF}]/u, 'w menu ikony CSS zamiast emoji');
  assert.match(html, /Pytania i odpowiedzi/);
  assert.doesNotMatch(html, /Zadane pytania/, 'zakładka usunięta z menu');
  assert.match(html, /21908/);
  assert.match(html, /scamer#1/);
});

test('podrobione ciasteczko sesji nie działa', async () => {
  const { cookie } = await adminSession();
  const [body, mac] = cookie.replace('pep_session=', '').split('.');
  const forged = JSON.parse(Buffer.from(decodeURIComponent(body), 'base64url').toString());
  forged.uid = 'OWNER';
  const fakeBody = Buffer.from(JSON.stringify(forged)).toString('base64url');
  const res = await get('/panel', `pep_session=${fakeBody}.${mac}`);
  assert.strictEqual(res.status, 302);
});

test('formularz bez tokenu CSRF jest blokowany', async () => {
  const { cookie } = await adminSession();
  const res = await post('/panel/serwery/G1/logi', cookie, { channelId: 'C1' });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(settings.logChannelId, null);
});

test('ustawienie kanału raportów i czyszczenie obrazków', async () => {
  const { cookie, csrf } = await adminSession();
  let res = await post('/panel/serwery/G1/logi', cookie, { channelId: 'C1', _csrf: csrf });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(settings.logChannelId, 'C1');
  res = await post('/panel/serwery/G1/obrazy-wyczysc', cookie, { _csrf: csrf });
  assert.match(new URL(res.headers.get('location'), base).searchParams.get('ok'), /Zapomniano 2 obrazków/);
  const page = await (await get(res.headers.get('location'), cookie)).text();
  assert.match(page, /class="flash ok"><svg[^]*?<span>Zapomniano 2 obrazków scamu\./, 'komunikat (z ikoną) widoczny na stronie');
  const html = await (await get('/panel/serwery/G1', cookie)).text();
  assert.match(html, /<details class="dropdown">/, 'animowana lista zamiast <select>');
  assert.doesNotMatch(html, /<select/);
  assert.match(html, /<button class="opt selected" name="channelId" value="C1">/);
  assert.match(html, /<button class="opt" name="channelId" value="">/, 'opcja "raporty wyłączone"');
});

test('Pytania: dodawanie, edycja i usuwanie zapisuje się w wiedza.md', async () => {
  const { cookie, csrf } = await adminSession();
  await post('/panel/pytania/dodaj', cookie, { q: 'Gdzie pobrać PEP?', a: 'Link pojawi się w ogłoszeniach.', _csrf: csrf });
  assert.match(fs.readFileSync(kFile, 'utf8'), /## Gdzie pobrać PEP\?\nLink pojawi się w ogłoszeniach\./);

  await post('/panel/pytania/1/zapisz', cookie, { q: 'Gdzie pobrać PEP?', a: 'Na kanale #pobieranie.', _csrf: csrf });
  assert.match(fs.readFileSync(kFile, 'utf8'), /Na kanale #pobieranie\./);

  const html = await (await get('/panel/pytania', cookie)).text();
  assert.match(html, /<details class="qa">/);
  assert.match(html, /Gdzie pobrać PEP\?/);

  await post('/panel/pytania/1/usun', cookie, { _csrf: csrf });
  assert.doesNotMatch(fs.readFileSync(kFile, 'utf8'), /Gdzie pobrać/);
  assert.match(fs.readFileSync(kFile, 'utf8'), /## Kiedy PEP\?/, 'inne pytania zostają');
});

test('wstrzyknięty HTML/JS jest wyświetlany jako tekst, nie wykonywany', async () => {
  const { cookie, csrf } = await adminSession();
  await post('/panel/pytania/dodaj', cookie, { q: '<script>alert(1)</script>', a: '<img src=x onerror=alert(1)>', _csrf: csrf });
  const html = await (await get('/panel/pytania', cookie)).text();
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});

test('Zakładka "Zadane pytania" usunięta - stary adres prowadzi do pytań', async () => {
  const { cookie } = await adminSession();
  const res = await get('/panel/zadane', cookie);
  assert.strictEqual(res.headers.get('location'), '/panel/pytania');
  const html = await (await get('/panel/pytania', cookie)).text();
  assert.doesNotMatch(html, /Zadane pytania/);
});

test('wylogowanie kasuje sesję', async () => {
  const { cookie, csrf } = await adminSession();
  const res = await post('/logout', cookie, { _csrf: csrf });
  assert.strictEqual(res.headers.get('location'), '/');
  assert.match(res.headers.getSetCookie().join(), /pep_session=;.*Max-Age=0/);
});

const errOf = (res) => new URL(res.headers.get('location'), base).searchParams.get('err');

test('Anty Spam: dodanie frazy na wszystkie kanały i na wybrany kanał', async () => {
  const { cookie, csrf } = await adminSession();
  let res = await post('/panel/antyspam/G1/frazy/dodaj', cookie, { phrase: 'darmowe konto', scope: 'all', _csrf: csrf });
  assert.strictEqual(res.status, 302);
  assert.deepStrictEqual(settings.blockedPhrases[0], { id: 'r0', phrase: 'darmowe konto', channels: [] });

  res = await post('/panel/antyspam/G1/frazy/dodaj', cookie, { phrase: 'kup*', scope: 'selected', channels: 'C2', _csrf: csrf });
  assert.deepStrictEqual(settings.blockedPhrases[1].channels, ['C2']);

  const html = await (await get('/panel/antyspam/frazy', cookie)).text();
  assert.match(html, /<code>darmowe konto<\/code>/);
  assert.match(html, /wszystkie kanały/);
  assert.match(html, /#ogolny/);
});

test('Anty Spam: błędne dane frazy dają komunikat, a nie zapis', async () => {
  const { cookie, csrf } = await adminSession();
  const before = settings.blockedPhrases.length;
  let res = await post('/panel/antyspam/G1/frazy/dodaj', cookie, { phrase: 'reklama', scope: 'selected', _csrf: csrf });
  assert.match(errOf(res), /Zaznacz co najmniej jeden kanał/);
  res = await post('/panel/antyspam/G1/frazy/dodaj', cookie, { phrase: '$$$', scope: 'all', _csrf: csrf });
  assert.match(errOf(res), /litery lub cyfry/);
  res = await post('/panel/antyspam/G1/frazy/dodaj', cookie, { phrase: 'reklama', scope: 'selected', channels: 'OBCY', _csrf: csrf });
  assert.match(errOf(res), /Zaznacz co najmniej jeden kanał/, 'kanał spoza serwera odrzucony');
  assert.strictEqual(settings.blockedPhrases.length, before);
});

test('Anty Spam: usunięcie frazy', async () => {
  const { cookie, csrf } = await adminSession();
  const { id } = settings.blockedPhrases[0];
  await post('/panel/antyspam/G1/frazy/' + id + '/usun', cookie, { _csrf: csrf });
  assert.ok(!settings.blockedPhrases.some((r) => r.id === id));
});

test('Anty Spam: kanały ochrony linków (wybrane i z powrotem wszystkie)', async () => {
  const { cookie, csrf } = await adminSession();
  await post('/panel/antyspam/G1/kanaly', cookie, [['scope', 'selected'], ['channels', 'C1'], ['channels', 'C2'], ['_csrf', csrf]]);
  assert.deepStrictEqual(settings.protectedChannels, ['C1', 'C2']);
  let html = await (await get('/panel/antyspam/kanaly', cookie)).text();
  assert.match(html, /value="C1" checked/);
  await post('/panel/antyspam/G1/kanaly', cookie, { scope: 'all', channels: 'C1', _csrf: csrf });
  assert.deepStrictEqual(settings.protectedChannels, []);
  html = await (await get('/panel/antyspam/kanaly', cookie)).text();
  assert.match(html, /Teraz działa na: <b><span class="muted">wszystkie kanały/);
});

test('Anty Spam: nie można zmieniać serwera, na którym nie jest się administratorem', async () => {
  const { cookie, csrf } = await adminSession();
  const res = await post('/panel/antyspam/OBCY/frazy/dodaj', cookie, { phrase: 'test', scope: 'all', _csrf: csrf });
  assert.strictEqual(res.status, 404);
});

test('Logi użytkownika: osoby pogrupowane, z liczbą usunięć i treścią wiadomości', async () => {
  const { cookie } = await adminSession();
  const html = await (await get('/panel/antyspam/logi', cookie)).text();
  assert.match(html, /<span class="q">scamer#1<\/span>/);
  assert.match(html, /<span class="q">inny#2<\/span>/);
  assert.match(html, /<code>111<\/code>/);
  assert.match(html, /free nitro https:\/\/discorcl\.gift\/x/);
  assert.match(html, /#ogolny/, 'nazwa kanału zamiast ID');
  assert.match(html, /kupujcie konta &lt;b&gt;tanio&lt;\/b&gt;/, 'treść wiadomości escapowana');
  assert.doesNotMatch(html, /odpowiedź AI/, 'tylko usunięte wiadomości, bez pytań do AI');
  const scamer = html.slice(html.indexOf('scamer#1'), html.indexOf('inny#2'));
  assert.match(scamer, /badge red">scam<\/span><b>1<\/b>/);
  assert.match(scamer, /badge purple">fraza<\/span><b>1<\/b>/);
});

test('Logi użytkownika: wyszukiwanie po nazwie i po ID', async () => {
  const { cookie } = await adminSession();
  let html = await (await get('/panel/antyspam/logi?q=INNY', cookie)).text();
  assert.match(html, /inny#2/);
  assert.doesNotMatch(html, /<span class="q">scamer#1/);
  html = await (await get('/panel/antyspam/logi?q=111', cookie)).text();
  assert.match(html, /scamer#1/);
  assert.doesNotMatch(html, /<span class="q">inny#2/);
  html = await (await get('/panel/antyspam/logi?q=nikt', cookie)).text();
  assert.match(html, /Brak wyników/);
});

test('pola wyboru kanałów mają własny, animowany wygląd', async () => {
  const { cookie } = await adminSession();
  const html = await (await get('/panel/antyspam/kanaly', cookie)).text();
  assert.match(html, /<label class="radio"><input type="radio" name="scope" value="all"[^>]*><span class="mark"><\/span>Wszystkie kanały/);
  assert.match(html, /<label class="check"><input type="checkbox" name="channels" value="C1"[^>]*><span class="mark"><\/span>/);
});

test('Whitelista: podgląd osób i ról z whitelist.js', async () => {
  const { cookie } = await sessionFor('kod-creator');
  const old = await get('/panel/antyspam/whitelista', cookie);
  assert.strictEqual(old.headers.get('location'), '/panel/administracja/whitelista', 'stary adres przekierowuje');
  const html = await (await get('/panel/administracja/whitelista', cookie)).text();
  assert.match(html, /Zaufany Janek \(zaufany\)/);
  assert.match(html, /<code>777777777777777777<\/code>/);
  assert.match(html, /<code>999999999999999999<\/code>/);
  assert.match(html, /nie znaleziono/, 'nieznane ID oznaczone');
  assert.doesNotMatch(html, /Role \(/, 'sekcja Role usunięta');
  assert.match(html, /Pominięto nieprawidłowe ID w whitelist\.js: janek/);
  const adminGroup = html.slice(html.indexOf('<span>Administracja</span>'), html.indexOf('<span>Instrukcje</span>'));
  assert.match(adminGroup, /<span>Whitelista<\/span>/, 'Whitelista w kategorii Administracja');
  assert.match(html, /<details class="group" open>\s*<summary><svg class="ico ico-lock"[^>]*>.*?<span>Administracja/, 'kategoria otwarta');
  const antispam = html.slice(html.indexOf('<span>Anty Spam</span>'), html.indexOf('<span>Administracja</span>'));
  assert.doesNotMatch(antispam, /Whitelista/, 'już nie w Anty Spam');
});

// ---------- rangi ----------
const sessionFor = (code) => adminSession(code);

test('rangi: ALPHA TESTER wchodzi do panelu, ale tylko podgląd', async () => {
  const { cookie, csrf } = await sessionFor('kod-tester');
  const html = await (await get('/panel', cookie)).text();
  assert.match(html, /<span class="rank rank-tester">ALPHA TESTER<\/span>/);
  assert.match(html, /Serwer testowy/, 'widzi serwery bota mimo braku Administratora');

  const before = settings.blockedPhrases.length;
  const res = await post('/panel/antyspam/G1/frazy/dodaj', cookie, { phrase: 'test rangi', scope: 'all', _csrf: csrf });
  assert.match(errOf(res), /Twoja ranga ALPHA TESTER/);
  assert.strictEqual(settings.blockedPhrases.length, before);

  const page = await (await get('/panel/antyspam/frazy', cookie)).text();
  assert.match(page, /Tryb podglądu/);
  assert.doesNotMatch(page, /Dodaj frazę/);

  const q = await post('/panel/pytania/dodaj', cookie, { q: 'X?', a: 'Y', _csrf: csrf });
  assert.match(errOf(q), /ALPHA TESTER/);
});

test('rangi: DEVELOPER edytuje Anty Spam i pytania, ale nie ustawienia serwera', async () => {
  const { cookie, csrf } = await sessionFor('kod-dev');
  let res = await post('/panel/antyspam/G1/frazy/dodaj', cookie, { phrase: 'reklama deva', scope: 'all', _csrf: csrf });
  assert.match(new URL(res.headers.get('location'), base).searchParams.get('ok'), /Zablokowano frazę/);

  const logBefore = settings.logChannelId;
  res = await post('/panel/serwery/G1/logi', cookie, { channelId: 'C2', _csrf: csrf });
  assert.match(errOf(res), /Twoja ranga DEVELOPER/);
  assert.strictEqual(settings.logChannelId, logBefore);
  const page = await (await get('/panel/serwery/G1', cookie)).text();
  assert.match(page, /Tryb podglądu/);
  assert.doesNotMatch(page, /<details class="dropdown">/, 'bez listy wyboru w trybie podglądu');

  res = await post('/panel/pytania/dodaj', cookie, { q: 'Pytanie deva?', a: 'Odpowiedź deva.', _csrf: csrf });
  assert.match(new URL(res.headers.get('location'), base).searchParams.get('ok'), /Dodano pytanie/);
});

test('rangi: PEP CREATOR może wszystko', async () => {
  const { cookie, csrf } = await sessionFor('kod-creator');
  const res = await post('/panel/serwery/G1/logi', cookie, { channelId: 'C2', _csrf: csrf });
  assert.match(new URL(res.headers.get('location'), base).searchParams.get('ok'), /#ogolny/);
  assert.strictEqual(settings.logChannelId, 'C2');
  const html = await (await get('/panel', cookie)).text();
  assert.match(html, /<span class="rank rank-creator">PEP CREATOR<\/span>/);
});

test('rangi: administrator bez rangi ma odznakę ADMINISTRATOR i pełny dostęp', async () => {
  const { cookie } = await adminSession();
  const html = await (await get('/panel/serwery/G1', cookie)).text();
  assert.match(html, /rank-admin">ADMINISTRATOR/);
  assert.doesNotMatch(html, /Tryb podglądu/);
});

test('rangi: strona Rangi pokazuje uprawnienia i osoby', async () => {
  const { cookie } = await sessionFor('kod-creator');
  assert.strictEqual((await get('/panel/rangi', cookie)).headers.get('location'), '/panel/administracja/rangi', 'stary adres');
  const html = await (await get('/panel/administracja/rangi', cookie)).text();
  assert.match(html, /Twoja ranga: <b>PEP CREATOR<\/b>/);
  assert.match(html, /<code>DEV<\/code>/, 'lista osób z rangą DEVELOPER');
  assert.match(html, /rank-creator">PEP CREATOR/);
});

// ---------- instrukcje (pisane przez Ciebie w plikach instrukcje/*.txt) ----------
test('Instrukcje: pusty folder - pusta strona, bez dodatkowych tekstów', async () => {
  const { cookie } = await adminSession();
  const html = await (await get('/panel/instrukcje', cookie)).text();
  assert.doesNotMatch(html, /Nie ma jeszcze żadnych instrukcji/);
  assert.doesNotMatch(html, /class="panel-box"/);
  assert.match(html, /<span>Brak instrukcji<\/span>/);
});

test('Instrukcje: pliki z folderu w menu, w kolejności numerów, z formatowaniem', async () => {
  fs.writeFileSync(path.join(guidesDir, '2 Ochrona.txt'), '## Jak to działa\nPierwsza linia\ndruga linia\n\n- punkt **ważny**\n- drugi punkt');
  fs.writeFileSync(path.join(guidesDir, '1 Start.txt'), 'Witaj!');
  fs.writeFileSync(path.join(guidesDir, '10 Na koniec.md'), 'Koniec.');
  fs.writeFileSync(path.join(guidesDir, '_szkic.txt'), 'ukryty');
  const { cookie } = await adminSession();
  const res = await get('/panel/instrukcje', cookie);
  assert.strictEqual(res.headers.get('location'), '/panel/instrukcje/start');

  const html = await (await get('/panel/instrukcje/ochrona', cookie)).text();
  const menu = html.slice(html.indexOf('<span>Instrukcje</span>'), html.indexOf('</nav>'));
  assert.ok(menu.indexOf('Start') < menu.indexOf('Ochrona') && menu.indexOf('Ochrona') < menu.indexOf('Na koniec'), 'kolejność 1, 2, 10');
  assert.doesNotMatch(menu, /szkic/, 'pliki zaczynające się od _ są ukryte');
  assert.match(html, /<section class="panel-box guide-card">\s*<h2><svg class="ico ico-[a-zA-Z]+"[^>]*>.*?<\/svg><span>Jak to działa<\/span><\/h2>/, 'karta z ikoną');
  assert.match(html, /<ul class="guide-list">/);
  assert.match(html, /<p>Pierwsza linia<br>druga linia<\/p>/);
  assert.match(html, /<li>punkt <b>ważny<\/b><\/li>/);
  assert.match(html, /← Start/);
  assert.match(html, /Na koniec →/);
});

test('Instrukcje: HTML w pliku wyświetla się jako tekst, a nieznany adres wraca do listy', async () => {
  fs.writeFileSync(path.join(guidesDir, '3 Test.txt'), '<script>alert(1)</script> **<img src=x>**');
  const { cookie } = await adminSession();
  const html = await (await get('/panel/instrukcje/test', cookie)).text();
  assert.doesNotMatch(html, /<script>alert|<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const res = await get('/panel/instrukcje/..%2F..%2F.env', cookie);
  assert.strictEqual(res.headers.get('location'), '/panel/instrukcje');
});

test('Instrukcje: tytuł z pierwszej linii "# ..." (może mieć znak zapytania)', async () => {
  fs.writeFileSync(path.join(guidesDir, '4 Pytania.txt'), '﻿# Jak korzystać z pytań?\r\n- Wejdź w zakładkę pytania.\r\n');
  const { cookie } = await adminSession();
  const html = await (await get('/panel/instrukcje/jak-korzystac-z-pytan', cookie)).text();
  assert.match(html, /<span>Jak korzystać z pytań\?<\/span>/, 'tytuł w menu');
  assert.match(html, /<h1>Instrukcje<\/h1>/, 'nagłówek strony');
  assert.match(html, /<h2><svg class="ico ico-question"[^>]*>.*?<\/svg><span>Jak korzystać z pytań\?<\/span><\/h2>/, 'tytuł w pierwszej karcie, z ikoną pytania');
  assert.match(html, /<svg class="ico ico-question"[^>]*>.*?<\/svg><span>Jak korzystać z pytań\?<\/span><\/a>/, 'ikona też w menu');
  assert.match(html, /<li>Wejdź w zakładkę pytania\.<\/li>/);
});

test('Instrukcje: ikony dobierają się po tytule, "Ważna informacja" jest wyróżniona', () => {
  assert.strictEqual(instructionsModule.iconFor('Anty Spam Jak działa'), 'ban');
  assert.strictEqual(instructionsModule.iconFor('Zakładka Ochrona'), 'shield');
  assert.strictEqual(instructionsModule.iconFor('Logi Użytkownika'), 'userLog');
  assert.strictEqual(instructionsModule.iconFor('Czym jest zakładka server?'), 'server');
  assert.strictEqual(instructionsModule.iconFor('Coś innego'), 'book');
  const html = instructionsModule.render('- Discord nakłada ograniczenia', 'Ważna Informacja!');
  assert.match(html, /guide-card important/);
  assert.match(html, /ico-alert/);
});

// ---------- Administracja: Rangi + dodawanie osób przez Discord ID ----------
const okOf = (res) => new URL(res.headers.get('location'), base).searchParams.get('ok');

test('Administracja: Rangi i Whitelistę widzi tylko PEP CREATOR', async () => {
  for (const code of ['kod-admin', 'kod-dev', 'kod-tester']) {
    const { cookie: c } = await sessionFor(code);
    const dash = await (await get('/panel', c)).text();
    assert.doesNotMatch(dash, /<span>Administracja<\/span>/, `${code}: brak kategorii w menu`);
    for (const url of ['/panel/administracja/rangi', '/panel/administracja/whitelista']) {
      const res = await get(url, c);
      assert.strictEqual(res.status, 302, `${code} ${url}`);
      assert.match(new URL(res.headers.get('location'), base).searchParams.get('err'), /Tę zakładkę widzi tylko PEP CREATOR/);
    }
  }
});

test('Administracja: Whitelista i Rangi w jednej rozwijanej kategorii', async () => {
  const { cookie } = await sessionFor('kod-creator');
  const html = await (await get('/panel/administracja/rangi', cookie)).text();
  const admin = html.slice(html.indexOf('<span>Administracja</span>'), html.indexOf('<span>Instrukcje</span>'));
  assert.match(admin, /<span>Whitelista<\/span>/);
  assert.match(admin, /<span>Rangi<\/span>/);
  const top = html.slice(html.indexOf('<nav class="sidebar">'), html.indexOf('<span>Serwery</span>'));
  assert.doesNotMatch(top, /Rangi/, 'Rangi nie są już osobno u góry menu');
});

test('Whitelista: tylko PEP CREATOR może dodawać osoby', async () => {
  for (const code of ['kod-admin', 'kod-dev', 'kod-tester']) {
    const { cookie, csrf } = await sessionFor(code);
    const page = await (await get('/panel/administracja/whitelista', cookie)).text();
    assert.doesNotMatch(page, /Dodaj osobę/, code + ': bez formularza');
    const res = await post('/panel/administracja/whitelista/dodaj', cookie, { userId: '123456789012345678', rank: 'DEVELOPER', _csrf: csrf });
    assert.match(errOf(res), /Tylko osoba z rangą PEP CREATOR/, code);
  }
  assert.strictEqual(accessStore.list().length, 0);
});

test('Whitelista: PEP CREATOR dodaje osobę po Discord ID, a ona od razu loguje się z rangą', async () => {
  const { cookie, csrf } = await sessionFor('kod-creator');
  const page = await (await get('/panel/administracja/whitelista', cookie)).text();
  assert.match(page, /Dodaj osobę/);
  assert.match(page, /name="rank" value="PEP CREATOR"/);

  const res = await post('/panel/administracja/whitelista/dodaj', cookie, { userId: ' <@123456789012345678> ', rank: 'DEVELOPER', _csrf: csrf });
  assert.match(okOf(res), /Dodano: Nowy Tester \(nowy\) – DEVELOPER/);
  assert.deepStrictEqual(accessStore.get('123456789012345678').rank, 'DEVELOPER');

  const list = await (await get('/panel/administracja/whitelista', cookie)).text();
  assert.match(list, /Nowy Tester \(nowy\)/);
  assert.match(list, /dodał\(a\): creator/);

  // nowa osoba loguje się do panelu z rangą DEVELOPER (nie ma Administratora na serwerze)
  const nowy = await sessionFor('kod-nowy');
  const dash = await (await get('/panel', nowy.cookie)).text();
  assert.match(dash, /rank-developer">DEVELOPER/);
});

test('Whitelista: zmiana rangi, "tylko whitelista" i usuwanie', async () => {
  const { cookie, csrf } = await sessionFor('kod-creator');
  let res = await post('/panel/administracja/whitelista/dodaj', cookie, { userId: '123456789012345678', rank: '', _csrf: csrf });
  assert.match(okOf(res), /Zmieniono: .* tylko whitelista/);
  assert.strictEqual(accessStore.get('123456789012345678').rank, null);
  const denied = await login('kod-nowy');
  assert.strictEqual(denied.status, 403, 'bez rangi nie ma dostępu do panelu');

  res = await post('/panel/administracja/whitelista/123456789012345678/usun', cookie, { _csrf: csrf });
  assert.match(okOf(res), /Usunięto: Nowy Tester/);
  assert.strictEqual(accessStore.has('123456789012345678'), false);
});

test('Whitelista: złe ID, nieistniejący użytkownik i bot są odrzucane', async () => {
  const { cookie, csrf } = await sessionFor('kod-creator');
  const tryAdd = async (userId) => errOf(await post('/panel/administracja/whitelista/dodaj', cookie, { userId, rank: 'ALPHA TESTER', _csrf: csrf }));
  assert.match(await tryAdd('janek'), /17–20 cyfr/);
  assert.match(await tryAdd('111111111111111111'), /Nie ma użytkownika Discord/);
  assert.match(await tryAdd('987654321098765432'), /To jest bot/);
  assert.strictEqual(accessStore.list().length, 0);
});

test('Właściciel serwera jest automatycznie PEP CREATOR', async () => {
  const { cookie } = await sessionFor('kod-owner');
  const html = await (await get('/panel/administracja/whitelista', cookie)).text();
  assert.match(html, /rank-creator">PEP CREATOR<\/span>\s*<form method="post" action="\/logout"/);
  assert.match(html, /Dodaj osobę/);
});

test('Raport: przycisk "Wyślij raport teraz" (tylko z uprawnieniem do ustawień serwera)', async () => {
  const creator = await sessionFor('kod-creator');
  const page = await (await get('/panel/serwery/G1', creator.cookie)).text();
  assert.match(page, /Wyślij raport teraz/);
  let res = await post('/panel/serwery/G1/raport', creator.cookie, { _csrf: creator.csrf });
  assert.match(okOf(res), /Raport wysłany na #logi/);
  assert.deepStrictEqual(reportsSent, ['G1']);

  const dev = await sessionFor('kod-dev');
  res = await post('/panel/serwery/G1/raport', dev.cookie, { _csrf: dev.csrf });
  assert.match(errOf(res), /DEVELOPER/);
  assert.deepStrictEqual(reportsSent, ['G1'], 'DEVELOPER nie wysłał raportu');
});

test('Instrukcje: ranga w cudzysłowie -> odznaka, hasztag -> link do zakładki', () => {
  const html = instructionsModule.render('- jak posiadasz rangę "Pep Creators" możesz dodać osobę\n- wpisujesz ID w zakładkę #Whitelista, przydzielasz rangę', 'Test');
  assert.match(html, /rangę <span class="rank rank-creator">PEP CREATOR<\/span> możesz/);
  assert.doesNotMatch(html, /&quot;Pep Creators&quot;/);
  assert.match(html, /<a class="tag-chip" href="\/panel\/administracja\/whitelista"><svg[^>]*>.*?<\/svg><span>#Whitelista<\/span><\/a>,/);
});

test('Instrukcje: inne zapisy rang i hasztagów', () => {
  const html = instructionsModule.render('„developer” i "Alpha Tester" oraz PEP CREATOR, ale zwykły developer zostaje. #Zablokowane_Frazy #Logi #NieMaTakiej', 'T');
  assert.match(html, /<span class="rank rank-developer">DEVELOPER<\/span> i <span class="rank rank-tester">ALPHA TESTER<\/span>/);
  assert.match(html, /oraz <span class="rank rank-creator">PEP CREATOR<\/span>,/);
  assert.match(html, /zwykły developer zostaje/, 'słowo w zdaniu bez cudzysłowu zostaje tekstem');
  assert.match(html, /href="\/panel\/antyspam\/frazy"/);
  assert.match(html, /href="\/panel\/antyspam\/logi"/);
  assert.match(html, /<span class="tag-chip">#NieMaTakiej<\/span>/, 'nieznany hasztag bez linku');
});

test('Instrukcje: znaczniki nie otwierają drogi do wstrzyknięcia HTML', () => {
  const html = instructionsModule.render('#<script>alert(1)</script> "<b>x</b>" #Whitelista"><img src=x>', 'T');
  assert.doesNotMatch(html, /<script>|<img src=x|<b>x<\/b>/);
});

test('Whitelista: bez opisu, bez podpowiedzi o ID i bez pustej ramki "Osoby"', async () => {
  const { cookie } = await sessionFor('kod-creator');
  const html = await (await get('/panel/administracja/whitelista', cookie)).text();
  assert.doesNotMatch(html, /nigdy nie usuwa/);
  assert.doesNotMatch(html, /Kopiuj ID użytkownika/);
  assert.doesNotMatch(html, /Brak osób na whiteliście/);
  assert.match(html, /Dodaj osobę/);
});

test('Instrukcje: #EdycjaPytań prowadzi do pytań', () => {
  assert.match(instructionsModule.render('bazę #EdycjaPytań, dalej', 'T'), /<a class="tag-chip" href="\/panel\/pytania">.*?<span>#EdycjaPytań<\/span><\/a>, dalej/);
});
