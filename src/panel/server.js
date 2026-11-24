// Panel administracyjny "PEP Creators": logowanie przez Discord (OAuth2), dostęp tylko dla administratorów.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { PermissionFlagsBits } = require('discord.js');
const views = require('./views');
const { normalize } = require('../phrases');
const instructionsModule = require('./instructions');
const { rankInfo, RANKS } = require('../ranks');

const DISCORD_API = 'https://discord.com/api/v10';
const SESSION_COOKIE = 'pep_session';
const STATE_COOKIE = 'pep_oauth_state';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // sesja ważna 7 dni
const ADMIN_CACHE_MS = 60 * 1000; // uprawnienia sprawdzane ponownie co minutę
const CSS = fs.readFileSync(path.join(__dirname, 'panel.css'));

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Tworzy aplikację panelu.
 * @param {object} o
 * @param {import('discord.js').Client} o.client  zalogowany klient bota
 * @param {string} o.publicUrl       adres panelu, np. http://localhost:3000
 * @param {string} o.clientSecret    Client Secret aplikacji Discord (OAuth2)
 * @param {string} o.sessionSecret   klucz do podpisywania ciasteczek sesji
 * @param {string[]} [o.homeGuildIds] serwery bota (główny i developerski) - ich administratorzy edytują bazę pytań
 */
function createPanel({
  client, storage, events, knowledge, getStatus, whitelist, ranks, accessList = null, sendReport = null, beforeRequest = null, instructions = instructionsModule.create(), publicUrl, clientSecret, sessionSecret, homeGuildIds = [],
  fetchImpl = (...a) => fetch(...a),
}) {
  const app = express();
  const base = publicUrl.replace(/\/+$/, '');
  const redirectUri = `${base}/auth/callback`;
  const secureCookies = base.startsWith('https://');
  const origin = new URL(base).origin;

  // ---------- sesja: podpisane ciasteczko (bez bazy danych) ----------
  const hmac = (body) => crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  const signSession = (data) => {
    const body = Buffer.from(JSON.stringify(data)).toString('base64url');
    return `${body}.${hmac(body)}`;
  };
  const readSession = (req) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const [body, mac] = token.split('.');
    if (!body || !mac || !safeEqual(mac, hmac(body))) return null;
    try {
      const data = JSON.parse(Buffer.from(body, 'base64url').toString());
      return data.exp > Date.now() ? data : null;
    } catch {
      return null;
    }
  };
  const cookie = (name, value, maxAgeSec, extra = '') => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secureCookies ? '; Secure' : ''}${extra}`;

  // ---------- kto jest administratorem ----------
  const adminCache = new Map(); // userId -> { ids, ts }
  async function adminGuildIds(userId) {
    const hit = adminCache.get(userId);
    if (hit && Date.now() - hit.ts < ADMIN_CACHE_MS) return hit.ids;
    const ids = [];
    for (const guild of client.guilds.cache.values()) {
      if (guild.ownerId === userId) {
        ids.push(guild.id);
        continue;
      }
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member?.permissions.has(PermissionFlagsBits.Administrator)) ids.push(guild.id);
    }
    adminCache.set(userId, { ids, ts: Date.now() });
    return ids;
  }

  // Kto ma dostęp do panelu: administratorzy serwerów (do swoich serwerów)
  // oraz osoby z rangą z rangi.js (do wszystkich serwerów bota, z uprawnieniami rangi)
  async function access(userId) {
    const adminIds = await adminGuildIds(userId);
    // właściciel serwera głównego lub developerskiego zawsze ma rangę PEP CREATOR
    const homeOwner = homeGuildIds.some((id) => client.guilds.cache.get(id)?.ownerId === userId);
    const rank = homeOwner ? rankInfo('PEP CREATOR') : (ranks?.rankOf(userId) || null);
    const guildIds = rank ? [...client.guilds.cache.keys()] : adminIds;
    return { adminIds, rank, guildIds };
  }

  // ---------- zabezpieczenia ----------
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self' https://cdn.discordapp.com; form-action 'self' https://discord.com; frame-ancestors 'none'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Cache-Control': 'no-store',
    });
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  app.get('/panel.css', (req, res) => res.type('text/css').set('Cache-Control', 'max-age=3600').send(CSS));

  // Vercel: świeże dane z Supabase i Discorda przed obsłużeniem żądania (lokalnie - nic)
  if (beforeRequest) {
    app.use(async (req, res, next) => {
      await beforeRequest(req);
      next();
    });
  }
  // zapisy w bazie kończą się, zanim panel odpowie (na Vercelu funkcja może zostać zatrzymana zaraz po odpowiedzi)
  const flush = async (...stores) => {
    for (const st of stores) await st?.saved?.();
  };

  const loginError = {
    anulowano: 'Logowanie zostało anulowane.',
    stan: 'Sesja logowania wygasła – spróbuj jeszcze raz.',
    discord: 'Discord nie potwierdził logowania – spróbuj jeszcze raz.',
  };

  app.get('/', async (req, res) => {
    const session = readSession(req);
    if (session && (await access(session.uid)).guildIds.length) return res.redirect('/panel');
    return res.send(views.loginPage({ error: loginError[req.query.err], configured: Boolean(clientSecret) }));
  });

  // Start OAuth2: przekierowanie do Discorda (tylko zakres "identify" - nazwa i avatar)
  app.get('/login', (req, res) => {
    if (!clientSecret) return res.redirect('/');
    const state = crypto.randomBytes(16).toString('hex');
    res.set('Set-Cookie', cookie(STATE_COOKIE, state, 600));
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: client.application?.id || client.user.id,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'identify',
      state,
    });
    return res.redirect(url.href);
  });

  app.get('/auth/callback', async (req, res) => {
    if (req.query.error) return res.redirect('/?err=anulowano');
    const expected = parseCookies(req.headers.cookie)[STATE_COOKIE];
    res.append('Set-Cookie', cookie(STATE_COOKIE, '', 0));
    if (!expected || !req.query.state || !safeEqual(expected, req.query.state) || !req.query.code) {
      return res.redirect('/?err=stan');
    }
    try {
      const tokenRes = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.application?.id || client.user.id,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: String(req.query.code),
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
      const { access_token: accessToken } = await tokenRes.json();
      const meRes = await fetchImpl(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!meRes.ok) throw new Error(`users/@me ${meRes.status}`);
      const me = await meRes.json();
      const name = me.global_name || me.username;

      adminCache.delete(me.id); // świeże sprawdzenie przy logowaniu
      const acc = await access(me.id);
      if (!acc.guildIds.length) {
        console.log(`[panel] odmowa dostępu: ${me.username} (${me.id}) nie jest administratorem ani nie ma rangi`);
        return res.status(403).send(views.deniedPage(name));
      }
      const session = {
        uid: me.id,
        name,
        avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : '',
        csrf: crypto.randomBytes(16).toString('hex'),
        exp: Date.now() + SESSION_MS,
      };
      res.append('Set-Cookie', cookie(SESSION_COOKIE, signSession(session), SESSION_MS / 1000));
      console.log(`[panel] zalogowano: ${me.username} (${me.id})${acc.rank ? ` [${acc.rank.name}]` : ' [administrator]'}`);
      return res.redirect('/panel');
    } catch (err) {
      console.warn(`[panel] błąd logowania: ${err.message}`);
      return res.redirect('/?err=discord');
    }
  });

  // ---------- wszystko poniżej: tylko zalogowani administratorzy ----------
  async function requireAdmin(req, res, next) {
    const session = readSession(req);
    if (!session) return res.redirect('/');
    const { adminIds, rank, guildIds } = await access(session.uid);
    if (!guildIds.length) {
      res.set('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
      return res.status(403).send(views.deniedPage(session.name));
    }
    req.session = session;
    req.rank = rank;
    req.adminIds = adminIds;
    req.guilds = guildIds.map((id) => client.guilds.cache.get(id)).filter(Boolean);
    // uprawnienie do sekcji na danym serwerze: administrator tego serwera albo ranga, która na to pozwala
    req.can = (perm, guildId) => adminIds.includes(guildId) || Boolean(rank?.perms[perm]);
    // baza pytań jest wspólna - edytują ją administratorzy serwera głównego lub developerskiego
    // (albo każdy admin, gdy żaden nie jest ustawiony w .env) oraz rangi z uprawnieniem do pytań
    const homes = homeGuildIds.filter((id) => client.guilds.cache.has(id));
    const homeAdmin = homes.length ? homes.some((id) => adminIds.includes(id)) : adminIds.length > 0;
    req.canEditGlobal = homeAdmin || Boolean(rank?.perms.questions);
    if (req.method === 'POST') {
      const reqOrigin = req.headers.origin;
      if ((reqOrigin && reqOrigin !== origin) || !safeEqual(req.body?._csrf || '', session.csrf)) {
        return res.status(403).send('Nieprawidłowy formularz – odśwież stronę i spróbuj ponownie.');
      }
    }
    return next();
  }

  const render = (req, { title, active, content }) => views.layout({
    title,
    active,
    content,
    user: req.session,
    csrf: req.session.csrf,
    guilds: req.guilds,
    badge: req.rank ? { name: req.rank.name, slug: req.rank.slug } : { name: 'ADMINISTRATOR', slug: 'admin' },
    guides: instructions.list(),
    isCreator: req.rank?.name === 'PEP CREATOR',
    notice: { ok: req.query.ok, err: req.query.err },
  });
  const denied = (req) => (req.rank
    ? `Twoja ranga ${req.rank.name} (${req.rank.opis}) nie pozwala na zmiany w tej sekcji.`
    : 'Brak uprawnień do zmian w tej sekcji.');
  const back = (res, url, { ok, err } = {}) => {
    const q = new URLSearchParams();
    if (ok) q.set('ok', ok);
    if (err) q.set('err', err);
    if (!q.size) return res.redirect(url);
    return res.redirect(`${url}${url.includes('?') ? '&' : '?'}${q}`); // adres może już mieć ?serwer=...
  };

  app.post('/logout', requireAdmin, (req, res) => {
    res.set('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
    res.redirect('/');
  });

  app.get('/panel', requireAdmin, (req, res) => {
    const guildIds = req.guilds.map((g) => g.id);
    res.send(render(req, {
      title: 'Pulpit',
      active: 'pulpit',
      content: views.dashboard({ status: getStatus(), totals: events.totals(), events: events.list({ guildIds, limit: 30 }) }),
    }));
  });

  // ---------- serwery ----------
  const adminGuild = (req) => req.guilds.find((g) => g.id === req.params.id);
  const textChannels = (guild) => [...guild.channels.cache.values()]
    .filter((c) => c.isTextBased?.() && !c.isThread?.() && !c.isVoiceBased?.())
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
    .map((c) => ({ id: c.id, name: c.name }));

  app.get('/panel/serwery/:id', requireAdmin, (req, res) => {
    const guild = adminGuild(req);
    if (!guild) return res.status(404).send(render(req, { title: 'Nie znaleziono', active: '', content: '<p>Nie masz dostępu do tego serwera.</p>' }));
    const cfg = storage.get(guild.id);
    const channels = textChannels(guild);
    return res.send(render(req, {
      title: guild.name,
      active: `serwer-${guild.id}`,
      content: views.guildPage({
        guild,
        csrf: req.session.csrf,
        channels,
        logChannelId: cfg.logChannelId,
        learnedImages: cfg.imageHashes.length,
        events: events.list({ guildIds: [guild.id], limit: 30 }),
        canEdit: req.can('servers', guild.id),
      }),
    }));
  });

  app.post('/panel/serwery/:id/logi', requireAdmin, async (req, res) => {
    const guild = adminGuild(req);
    if (!guild) return res.status(404).send('Nie masz dostępu do tego serwera.');
    const url = `/panel/serwery/${guild.id}`;
    if (!req.can('servers', guild.id)) return back(res, url, { err: denied(req) });
    const channelId = String(req.body.channelId || '');
    if (!channelId) {
      storage.setLogChannel(guild.id, null);
      await flush(storage);
      return back(res, url, { ok: 'Raporty wyłączone.' });
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased?.()) return back(res, url, { err: 'Nie ma takiego kanału tekstowego.' });
    storage.setLogChannel(guild.id, channel.id);
    await flush(storage);
    console.log(`[panel] ${req.session.name}: kanał raportów na "${guild.name}" -> #${channel.name}`);
    return back(res, url, { ok: `Raporty będą wysyłane na #${channel.name}.` });
  });

  app.post('/panel/serwery/:id/raport', requireAdmin, async (req, res) => {
    const guild = adminGuild(req);
    if (!guild) return res.status(404).send('Nie masz dostępu do tego serwera.');
    const url = `/panel/serwery/${guild.id}`;
    if (!req.can('servers', guild.id)) return back(res, url, { err: denied(req) });
    if (!sendReport) return back(res, url, { err: 'Raporty są niedostępne.' });
    const result = await sendReport(guild);
    console.log(`[panel] ${req.session.name}: raport na żądanie dla "${guild.name}" -> ${result.ok ? 'wysłany' : result.error}`);
    return back(res, url, result.ok ? { ok: `Raport wysłany na #${result.channel}.` } : { err: result.error });
  });

  app.post('/panel/serwery/:id/obrazy-wyczysc', requireAdmin, async (req, res) => {
    const guild = adminGuild(req);
    if (!guild) return res.status(404).send('Nie masz dostępu do tego serwera.');
    if (!req.can('servers', guild.id)) return back(res, `/panel/serwery/${guild.id}`, { err: denied(req) });
    const n = storage.clearImageHashes(guild.id);
    await flush(storage);
    console.log(`[panel] ${req.session.name}: wyczyszczono ${n} obrazków na "${guild.name}"`);
    return back(res, `/panel/serwery/${guild.id}`, { ok: `Zapomniano ${n} obrazków scamu.` });
  });

  // ---------- pytania ----------
  app.get('/panel/pytania', requireAdmin, (req, res) => {
    res.send(render(req, {
      title: 'Pytania i odpowiedzi',
      active: 'pytania',
      content: views.questionsPage({ items: knowledge.list(), csrf: req.session.csrf, canEdit: req.canEditGlobal }),
    }));
  });

  const editQuestions = (fn, okMsg) => async (req, res) => {
    if (!req.canEditGlobal) return back(res, '/panel/pytania', { err: denied(req) });
    try {
      fn(req);
      await flush(knowledge);
      console.log(`[panel] ${req.session.name}: ${okMsg}`);
      return back(res, '/panel/pytania', { ok: okMsg });
    } catch (err) {
      return back(res, '/panel/pytania', { err: err.message });
    }
  };
  app.post('/panel/pytania/dodaj', requireAdmin, editQuestions((req) => knowledge.add(req.body.q, req.body.a), 'Dodano pytanie.'));
  app.post('/panel/pytania/:i/zapisz', requireAdmin, editQuestions((req) => knowledge.update(Number(req.params.i), req.body.q, req.body.a), 'Zapisano zmiany.'));
  app.post('/panel/pytania/:i/usun', requireAdmin, editQuestions((req) => knowledge.remove(Number(req.params.i)), 'Usunięto pytanie.'));

  app.get('/panel/zadane', requireAdmin, (req, res) => res.redirect('/panel/pytania')); // zakładka usunięta

  // ---------- Anty Spam ----------
  // serwer wybrany w zakładce (?serwer=ID); domyślnie serwer główny albo pierwszy
  const pickGuild = (req) => req.guilds.find((g) => g.id === req.query.serwer)
    || homeGuildIds.map((id) => req.guilds.find((g) => g.id === id)).find(Boolean) || req.guilds[0];

  // kanały z formularza: "all" = wszystkie (pusta lista), "selected" = zaznaczone, tylko istniejące na serwerze
  const pickedChannels = (req, guild) => {
    if (req.body.scope !== 'selected') return [];
    const valid = new Set(textChannels(guild).map((c) => c.id));
    const ids = [].concat(req.body.channels || []).map(String).filter((id) => valid.has(id));
    if (!ids.length) throw new Error('Zaznacz co najmniej jeden kanał albo wybierz „Wszystkie kanały”.');
    return ids;
  };

  app.get('/panel/antyspam/frazy', requireAdmin, (req, res) => {
    const guild = pickGuild(req);
    res.send(render(req, {
      title: 'Zablokowane frazy',
      active: 'antyspam-frazy',
      content: views.phrasesPage({
        guild, guilds: req.guilds, csrf: req.session.csrf, rules: storage.get(guild.id).blockedPhrases, channels: textChannels(guild), canEdit: req.can('antispam', guild.id),
      }),
    }));
  });

  app.post('/panel/antyspam/:id/frazy/dodaj', requireAdmin, async (req, res) => {
    const guild = adminGuild(req);
    if (!guild) return res.status(404).send('Nie masz dostępu do tego serwera.');
    const url = `/panel/antyspam/frazy?serwer=${guild.id}`;
    if (!req.can('antispam', guild.id)) return back(res, url, { err: denied(req) });
    try {
      if (!normalize(req.body.phrase)) throw new Error('Fraza musi zawierać litery lub cyfry.');
      const rule = storage.addPhrase(guild.id, req.body.phrase, pickedChannels(req, guild));
      await flush(storage);
      console.log(`[panel] ${req.session.name}: zablokowano frazę "${rule.phrase}" na "${guild.name}"`);
      return back(res, url, { ok: `Zablokowano frazę „${rule.phrase}”.` });
    } catch (err) {
      return back(res, url, { err: err.message });
    }
  });

  app.post('/panel/antyspam/:id/frazy/:ruleId/usun', requireAdmin, async (req, res) => {
    const guild = adminGuild(req);
    if (!guild) return res.status(404).send('Nie masz dostępu do tego serwera.');
    const url = `/panel/antyspam/frazy?serwer=${guild.id}`;
    if (!req.can('antispam', guild.id)) return back(res, url, { err: denied(req) });
    try {
      const rule = storage.removePhrase(guild.id, req.params.ruleId);
      await flush(storage);
      console.log(`[panel] ${req.session.name}: odblokowano frazę "${rule.phrase}" na "${guild.name}"`);
      return back(res, url, { ok: `Usunięto frazę „${rule.phrase}”.` });
    } catch (err) {
      return back(res, url, { err: err.message });
    }
  });

  app.get('/panel/antyspam/kanaly', requireAdmin, (req, res) => {
    const guild = pickGuild(req);
    res.send(render(req, {
      title: 'Kanały ochrony linków',
      active: 'antyspam-kanaly',
      content: views.channelsPage({
        guild, guilds: req.guilds, csrf: req.session.csrf, protectedChannels: storage.get(guild.id).protectedChannels, channels: textChannels(guild), canEdit: req.can('antispam', guild.id),
      }),
    }));
  });

  app.post('/panel/antyspam/:id/kanaly', requireAdmin, async (req, res) => {
    const guild = adminGuild(req);
    if (!guild) return res.status(404).send('Nie masz dostępu do tego serwera.');
    const url = `/panel/antyspam/kanaly?serwer=${guild.id}`;
    if (!req.can('antispam', guild.id)) return back(res, url, { err: denied(req) });
    try {
      const ids = pickedChannels(req, guild);
      storage.setProtectedChannels(guild.id, ids);
      await flush(storage);
      console.log(`[panel] ${req.session.name}: blokada linków na "${guild.name}" -> ${ids.length ? `${ids.length} kanałów` : 'wszystkie kanały'}`);
      return back(res, url, { ok: ids.length ? `Blokada linków działa na ${ids.length} wybranych kanałach.` : 'Blokada linków działa na wszystkich kanałach.' });
    } catch (err) {
      return back(res, url, { err: err.message });
    }
  });

  // Logi użytkownika: wszystkie usunięte wiadomości pogrupowane po osobie
  const MODERATION = new Set(['scam', 'spam', 'phrase']);
  app.get('/panel/antyspam/logi', requireAdmin, (req, res) => {
    const guildIds = req.guilds.map((g) => g.id);
    const query = String(req.query.q || '').trim().slice(0, 100);
    const byUser = new Map();
    for (const e of events.list({ guildIds, limit: 1000 })) {
      if (!MODERATION.has(e.type)) continue;
      const key = e.userId || e.user || '?';
      if (!byUser.has(key)) byUser.set(key, { user: e.user || '?', userId: e.userId, counts: {}, last: e.ts, events: [] });
      const u = byUser.get(key);
      u.counts[e.type] = (u.counts[e.type] || 0) + 1;
      u.last = Math.max(u.last, e.ts);
      const channelName = client.guilds.cache.get(e.guildId)?.channels.cache.get(e.channelId)?.name;
      u.events.push({ ...e, channelName });
    }
    let users = [...byUser.values()].sort((a, b) => b.last - a.last);
    const total = users.length;
    if (query) {
      const q = query.toLowerCase();
      users = users.filter((u) => u.user.toLowerCase().includes(q) || String(u.userId || '').includes(q));
    }
    res.send(render(req, {
      title: 'Logi użytkownika',
      active: 'antyspam-logi',
      content: views.userLogsPage({ users: users.slice(0, 100), query, total }),
    }));
  });

  // ---------- Instrukcje ----------
  app.get('/panel/instrukcje', requireAdmin, (req, res) => {
    const [first] = instructions.list();
    if (first) return res.redirect(`/panel/instrukcje/${first.slug}`);
    return res.send(render(req, { title: 'Instrukcje', active: 'instrukcje', content: views.noInstructionsPage() }));
  });
  app.get('/panel/instrukcje/:temat', requireAdmin, (req, res) => {
    const topic = instructions.find(req.params.temat);
    if (!topic) return res.redirect('/panel/instrukcje');
    return res.send(render(req, {
      title: 'Instrukcje', active: `instrukcje-${topic.slug}`, content: views.instructionsPage(topic, instructions.list()),
    }));
  });

  const userName = async (id) => {
    const user = client.users?.cache?.get(id) ?? await client.users?.fetch?.(id).catch(() => null);
    return user ? { name: user.globalName ? `${user.globalName} (${user.tag})` : user.tag, found: true } : { name: '', found: false };
  };

  app.get('/panel/rangi', requireAdmin, (req, res) => res.redirect('/panel/administracja/rangi')); // stary adres
  // Administracja (Whitelista, Rangi) - widzi tylko PEP CREATOR
  const CREATOR_ONLY = 'Tę zakładkę widzi tylko PEP CREATOR.';
  const requireCreator = (req, res, next) => (req.rank?.name === 'PEP CREATOR' ? next() : back(res, '/panel', { err: CREATOR_ONLY }));

  app.get('/panel/administracja/rangi', requireAdmin, requireCreator, async (req, res) => {
    const { ranks: list, invalid } = ranks ? ranks.entries() : { ranks: [], invalid: [] };
    const fromPanel = accessList ? accessList.list().filter((u) => u.rank) : [];
    const named = await Promise.all(list.map(async (r) => {
      const ids = [...r.users.map((id) => ({ id, source: 'plik' })), ...fromPanel.filter((u) => u.rank === r.name).map((u) => ({ id: u.id, source: 'panel' }))];
      return { ...r, users: await Promise.all(ids.map(async (u) => ({ ...u, ...(await userName(u.id)) }))) };
    }));
    res.send(render(req, { title: 'Rangi', active: 'admin-rangi', content: views.ranksPage({ ranks: named, invalid, me: req.rank }) }));
  });

  app.get('/panel/antyspam/whitelista', requireAdmin, (req, res) => res.redirect('/panel/administracja/whitelista')); // stary adres
  const isCreator = (req) => req.rank?.name === 'PEP CREATOR';
  const WL_URL = '/panel/administracja/whitelista';

  app.get(WL_URL, requireAdmin, requireCreator, async (req, res) => {
    const { users, roles, invalid } = whitelist ? whitelist.entries() : { users: [], roles: [], invalid: [] };
    const panelRows = await Promise.all((accessList ? accessList.list() : []).map(async (u) => {
      const live = await userName(u.id);
      return { ...u, name: live.found ? live.name : u.name, found: live.found || Boolean(u.name), source: 'panel' };
    }));
    const fileRows = await Promise.all(users.filter((id) => !accessList?.has(id))
      .map(async (id) => ({ id, ...(await userName(id)), source: 'plik' })));
    const roleRows = roles.map((id) => {
      const role = req.guilds.map((g) => g.roles?.cache?.get(id)).find(Boolean);
      return { id, name: role?.name || '', found: Boolean(role) };
    });
    res.send(render(req, {
      title: 'Whitelista',
      active: 'admin-whitelist',
      content: views.whitelistPage({
        people: [...panelRows, ...fileRows], roles: roleRows, invalid, canManage: isCreator(req) && Boolean(accessList), csrf: req.session.csrf, myId: req.session.uid,
      }),
    }));
  });

  app.post(`${WL_URL}/dodaj`, requireAdmin, async (req, res) => {
    if (!isCreator(req)) return back(res, WL_URL, { err: 'Tylko osoba z rangą PEP CREATOR może dodawać osoby.' });
    if (!accessList) return back(res, WL_URL, { err: 'Dodawanie osób jest niedostępne.' });
    const id = String(req.body.userId || '').replace(/[<@!>\s]/g, '');
    const rank = RANKS[req.body.rank] ? req.body.rank : null;
    try {
      if (!/^\d{17,20}$/.test(id)) throw new Error('Discord ID to 17–20 cyfr (PPM na osobę → Kopiuj ID użytkownika).');
      const user = await client.users?.fetch?.(id).catch(() => null);
      if (!user) throw new Error('Nie ma użytkownika Discord o takim ID – sprawdź, czy dobrze skopiowałeś.');
      if (user.bot) throw new Error('To jest bot, nie osoba.');
      if (id === req.session.uid && rank !== 'PEP CREATOR') throw new Error('Nie możesz odebrać sobie rangi PEP CREATOR.');
      const name = user.globalName ? `${user.globalName} (${user.tag})` : user.tag;
      const { updated } = accessList.add(id, rank, { by: req.session.name, name });
      await flush(accessList);
      adminCache.delete(id);
      console.log(`[panel] ${req.session.name}: ${updated ? 'zmieniono' : 'dodano'} ${name} (${id}) -> ${rank || 'tylko whitelista'}`);
      return back(res, WL_URL, { ok: `${updated ? 'Zmieniono' : 'Dodano'}: ${name} – ${rank || 'tylko whitelista (bez dostępu do panelu)'}.` });
    } catch (err) {
      return back(res, WL_URL, { err: err.message });
    }
  });

  app.post(`${WL_URL}/:userId/usun`, requireAdmin, async (req, res) => {
    if (!isCreator(req)) return back(res, WL_URL, { err: 'Tylko osoba z rangą PEP CREATOR może usuwać osoby.' });
    if (!accessList) return back(res, WL_URL, { err: 'Usuwanie osób jest niedostępne.' });
    if (req.params.userId === req.session.uid) return back(res, WL_URL, { err: 'Nie możesz usunąć samego siebie.' });
    try {
      const entry = accessList.remove(req.params.userId);
      await flush(accessList);
      adminCache.delete(entry.id);
      console.log(`[panel] ${req.session.name}: usunięto ${entry.name || entry.id} z whitelisty`);
      return back(res, WL_URL, { ok: `Usunięto: ${entry.name || entry.id}.` });
    } catch (err) {
      return back(res, WL_URL, { err: err.message });
    }
  });

  app.use((req, res) => res.status(404).send('Nie znaleziono.'));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error('[panel] błąd:', err.message);
    res.status(500).send('Błąd panelu – spróbuj ponownie za chwilę.');
  });
  return app;
}

// Klucz sesji: z .env albo wygenerowany raz i zapisany w data/ (żeby restart nie wylogowywał)
function loadSessionSecret(file) {
  if (process.env.PANEL_SESSION_SECRET?.trim()) return process.env.PANEL_SESSION_SECRET.trim();
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {
    /* brak - wygeneruj */
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function startPanel(options) {
  const port = Number(options.port) || 3000;
  const host = options.host || '127.0.0.1';
  const app = createPanel(options);
  const server = app.listen(port, host);
  server.on('listening', () => {
    console.log(`🌐 Panel ${views.BRAND}: ${options.publicUrl}`);
    if (!options.clientSecret) {
      console.log('⚠️  Panel: brak DISCORD_CLIENT_SECRET w .env - logowanie przez Discord nie zadziała.');
    }
  });
  server.on('error', (err) => {
    console.error(`❌ Panel nie wystartował (${err.code === 'EADDRINUSE' ? `port ${port} jest zajęty - zmień PANEL_PORT w .env` : err.message})`);
  });
  return server;
}

module.exports = { createPanel, startPanel, loadSessionSecret };
