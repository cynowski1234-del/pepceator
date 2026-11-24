// Tryb wdrożenia: dane w "Supabase" (baza w pamięci), panel jak na Vercelu (API Discorda podstawione).
const test = require('node:test');
const assert = require('node:assert');
const { createMemoryDb } = require('./helpers/memoryDb');
const dbModule = require('../src/db');

const db = createMemoryDb();
dbModule.setDb(db); // przed wczytaniem modułów danych -> działają w trybie Supabase

const storage = require('../src/storage');
const events = require('../src/events');
const accessModule = require('../src/access');
const knowledgeModule = require('../src/knowledge');
const status = require('../src/db/status');

test('ustawienia serwera: zapis tylko zmienionych kolumn i odczyt z bazy', async () => {
  assert.ok(storage.usesDatabase());
  storage.setLogChannel('G1', 'C1');
  storage.addPhrase('G1', 'darmowe konto', []);
  await storage.saved();
  const row = db.tables.guild_settings.find((r) => r.guild_id === 'G1');
  assert.strictEqual(row.log_channel_id, 'C1');
  assert.strictEqual(row.blocked_phrases[0].phrase, 'darmowe konto');

  // panel (inny proces) zmienia kanał - bot widzi to po refresh()
  row.log_channel_id = 'C9';
  await storage.refresh();
  assert.strictEqual(storage.get('G1').logChannelId, 'C9');
  assert.strictEqual(storage.get('G1').blockedPhrases.length, 1, 'frazy zostają');
});

test('zdarzenia: zapis w bazie, odczyt z liczbami dla pulpitu', async () => {
  events.record('scam', { guildId: 'G1', user: 'scamer#1', userId: '111', summary: 'x', content: 'free nitro' });
  events.record('ai', { guildId: 'G1', question: 'kiedy pep' });
  await events.saved();
  assert.strictEqual(db.tables.events.length, 2);
  assert.strictEqual(db.tables.events[0].guild_id, 'G1');
  assert.strictEqual(db.tables.events[0].data.content, 'free nitro');
  await events.refresh();
  assert.deepStrictEqual(events.totals(), { scam: 1, ai: 1 });
  assert.strictEqual(events.list({ guildIds: ['G1'] }).find((e) => e.type === 'scam').user, 'scamer#1');
});

test('osoby z panelu: dodanie, zmiana, usunięcie w bazie', async () => {
  const access = accessModule.create();
  access.add('123456789012345678', 'DEVELOPER', { by: 'Janek', name: 'Nowy' });
  await access.saved();
  assert.strictEqual(db.tables.panel_access[0].rank, 'DEVELOPER');
  const other = accessModule.create(); // np. bot na hostingu
  await other.refresh();
  assert.strictEqual(other.get('123456789012345678').rank, 'DEVELOPER');
  access.remove('123456789012345678');
  await access.saved();
  assert.strictEqual(db.tables.panel_access.length, 0);
});

test('baza pytań: pierwsze uruchomienie kopiuje wiedza.md, potem edycja w bazie', async () => {
  const k = knowledgeModule.create();
  await k.refresh();
  const seeded = db.tables.kv.find((r) => r.key === 'wiedza');
  assert.match(seeded.value.text, /Kiedy wychodzi PEP\?/);
  const before = k.list().length;
  k.add('Gdzie pobrać PEP?', 'Na kanale #pobieranie.');
  await k.saved();
  assert.match(db.tables.kv.find((r) => r.key === 'wiedza').value.text, /Gdzie pobrać PEP\?/);
  const other = knowledgeModule.create();
  await other.refresh();
  assert.strictEqual(other.list().length, before + 1);
  assert.match(other.text(), /Na kanale #pobieranie\./);
});

test('status bota: heartbeat w bazie, panel widzi online/offline', async () => {
  const timer = status.startHeartbeat(db, () => ({
    tag: 'PEP BOT#1', ping: 40, guilds: 2, phishing: 21908, ai: true, startedAt: Date.now() - 3 * 3600 * 1000,
  }), 60 * 60 * 1000);
  clearInterval(timer);
  await new Promise((r) => setTimeout(r, 10));
  let s = await status.readStatus(db);
  assert.strictEqual(s.online, true);
  assert.strictEqual(s.uptime, '3 h 0 min');
  s = await status.readStatus(db, Date.now() + 10 * 60 * 1000);
  assert.strictEqual(s.online, false, 'brak sygnału > 3 min = offline');
});

test('migracja: dane z plików trafiają do bazy', async () => {
  const { migrate } = require('../scripts/migrate-to-supabase');
  const memory = createMemoryDb();
  const logs = [];
  await migrate(memory, (l) => logs.push(l));
  assert.ok(logs.some((l) => /Ustawienia serwerów/.test(l)));
  assert.ok(memory.tables.kv.some((r) => r.key === 'wiedza'));
});

// ---------- panel jak na Vercelu: Supabase + API Discorda ----------
test('panel (Vercel): logowanie, ustawienia, osoba, raport - wszystko przez bazę i API', async () => {
  Object.assign(process.env, {
    DISCORD_TOKEN: 'token-bota', DISCORD_CLIENT_SECRET: 'sekret', PANEL_SESSION_SECRET: 'x'.repeat(40), PANEL_URL: 'https://pep.vercel.app', GUILD_ID: 'G1',
  });
  const sent = [];
  const json = (obj, statusCode = 200) => new Response(JSON.stringify(obj), { status: statusCode, headers: { 'content-type': 'application/json' } });
  const fakeFetch = async (url, opts = {}) => {
    const u = new URL(url);
    const auth = opts.headers?.Authorization || '';
    const p = u.pathname.replace('/api/v10', '');
    if (p === '/oauth2/token') return json({ access_token: 'user-token' });
    if (p === '/users/@me' && auth.startsWith('Bearer')) return json({ id: 'OWNER', username: 'janek', global_name: 'Janek' });
    if (p === '/users/@me') return json({ id: 'BOT', username: 'PEP BOT' });
    if (p === '/users/@me/guilds') return json([{ id: 'G1' }]);
    if (p === '/guilds/G1') {
      return json({
        id: 'G1', name: 'Serwer PEP', owner_id: 'OWNER', approximate_member_count: 50, roles: [{ id: 'G1', name: '@everyone', permissions: '0' }],
      });
    }
    if (p === '/guilds/G1/channels') return json([{ id: 'C1', name: 'logi', type: 0, position: 0 }, { id: 'V1', name: 'Głosowy', type: 2, position: 1 }]);
    if (p === '/guilds/G1/members/OWNER') return json({ roles: [] });
    if (p === '/users/123456789012345678') return json({ id: '123456789012345678', username: 'nowy', global_name: 'Nowy' });
    if (p === '/channels/C1/messages' && opts.method === 'POST') {
      sent.push(JSON.parse(opts.body));
      return json({ id: 'M1' });
    }
    return json({ message: 'Unknown' }, 404);
  };

  const { createStandalonePanel } = require('../src/panel/standalone');
  const app = createStandalonePanel({ fetchImpl: fakeFetch });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const get = (path, cookie) => fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    const post = (path, cookie, form) => fetch(base + path, {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form),
    });
    const cookies = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

    // logowanie przez Discord (właściciel serwera = PEP CREATOR)
    const start = await get('/login');
    const loginUrl = new URL(start.headers.get('location'));
    assert.strictEqual(loginUrl.searchParams.get('redirect_uri'), 'https://pep.vercel.app/auth/callback');
    assert.strictEqual(loginUrl.searchParams.get('client_id'), 'BOT');
    const cb = await get(`/auth/callback?code=x&state=${loginUrl.searchParams.get('state')}`, cookies(start));
    assert.strictEqual(cb.headers.get('location'), '/panel');
    const cookie = cookies(cb).split('; ').find((c) => c.startsWith('pep_session=') && c.length > 13);
    assert.match(cb.headers.getSetCookie().join(), /Secure/, 'https -> ciasteczko Secure');

    const dash = await (await get('/panel', cookie)).text();
    assert.match(dash, /rank-creator">PEP CREATOR/);
    assert.match(dash, /PEP BOT#1/, 'status bota z bazy (heartbeat)');
    const csrf = dash.match(/name="_csrf" value="([^"]+)"/)[1];

    // kanał raportów -> zapis w bazie
    const page = await (await get('/panel/serwery/G1', cookie)).text();
    assert.match(page, /value="C1"/);
    assert.doesNotMatch(page, /value="V1"/, 'kanały głosowe pominięte');
    await post('/panel/serwery/G1/logi', cookie, { channelId: 'C1', _csrf: csrf });
    assert.strictEqual(db.tables.guild_settings.find((r) => r.guild_id === 'G1').log_channel_id, 'C1');

    // osoba dodana w panelu -> tabela panel_access
    const add = await post('/panel/administracja/whitelista/dodaj', cookie, { userId: '123456789012345678', rank: 'ALPHA TESTER', _csrf: csrf });
    assert.match(new URL(add.headers.get('location'), base).searchParams.get('ok'), /Dodano: Nowy \(nowy\)/);
    assert.strictEqual(db.tables.panel_access.find((r) => r.user_id === '123456789012345678').rank, 'ALPHA TESTER');

    // raport -> wiadomość przez API Discorda
    const rep = await post('/panel/serwery/G1/raport', cookie, { _csrf: csrf });
    assert.match(new URL(rep.headers.get('location'), base).searchParams.get('ok'), /Raport wysłany na #logi/);
    assert.match(sent[0].embeds[0].title, /Raport serwera – Serwer PEP/);
    assert.deepStrictEqual(sent[0].allowed_mentions, { parse: [] });
  } finally {
    server.close();
  }
});

test('panel (Vercel): brak konfiguracji daje czytelny komunikat zamiast awarii', () => {
  const saved = process.env.PANEL_SESSION_SECRET;
  process.env.PANEL_SESSION_SECRET = 'za-krotki';
  const { createStandalonePanel } = require('../src/panel/standalone');
  assert.throws(() => createStandalonePanel(), /brakuje zmiennych środowiskowych: PANEL_SESSION_SECRET/);
  process.env.PANEL_SESSION_SECRET = saved;
});

// ---------- dwie kopie bota na jednym tokenie: nic nie dzieje się podwójnie ----------
test('rezerwacje: tylko pierwsza kopia bota wykonuje akcję na danej wiadomości', async () => {
  const claims = require('../src/claims');
  assert.strictEqual(await claims.claim('ai', 'MSG-1'), true, 'pierwsza kopia odpowiada');
  assert.strictEqual(await db.claim('claim:ai:MSG-1', 'inna-kopia'), false, 'druga kopia - zajęte');
  assert.strictEqual(await claims.claim('ai', 'MSG-1'), false);
  assert.strictEqual(await claims.claim('mod', 'MSG-1'), true, 'inna akcja na tej samej wiadomości to osobna rezerwacja');
  assert.strictEqual(await claims.claim('ai', 'MSG-2'), true);

  // sprzątanie: stare rezerwacje znikają
  db.tables.kv.find((r) => r.key === 'claim:ai:MSG-2').updated_at = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  await claims.cleanup();
  assert.ok(!db.tables.kv.some((r) => r.key === 'claim:ai:MSG-2'));
  assert.ok(db.tables.kv.some((r) => r.key === 'claim:ai:MSG-1'), 'świeże zostają');
});

test('rezerwacje: przy awarii bazy bot działa dalej (nie milknie)', async () => {
  const claims = require('../src/claims');
  const original = db.claim;
  db.claim = async () => { throw new Error('timeout'); };
  assert.strictEqual(await claims.claim('ai', 'MSG-3'), true);
  db.claim = original;
});

test('status: wykrywa drugą kopię bota działającą na tym samym tokenie', async () => {
  const warnings = [];
  db.tables.kv = db.tables.kv.filter((r) => r.key !== 'bot_status');
  db.tables.kv.push({ key: 'bot_status', value: { instance: 'HOSTING#123#abc', at: Date.now() - 20 * 1000 } });
  const timer = status.startHeartbeat(db, () => ({ instance: 'KOMPUTER#9#def', tag: 'PEP BOT' }), 60 * 1000, { warn: (m) => warnings.push(m) });
  clearInterval(timer);
  await new Promise((r) => setTimeout(r, 20));
  assert.match(warnings[0], /DRUGA kopia bota .*komputer: HOSTING/);
});
