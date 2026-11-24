// Panel na Vercelu nie ma połączonego bota (bot działa na hostingu). Ten moduł udaje tę część klienta
// discord.js, której używa panel (serwery, kanały, role, członkowie, użytkownicy), pobierając dane
// z API Discorda tokenem bota. Dane są trzymane w pamięci przez minutę, żeby nie przekroczyć limitów.
const API = 'https://discord.com/api/v10';
const ADMINISTRATOR = 1n << 3n;
const TEXT_TYPES = new Set([0, 5, 2, 13, 10, 11, 12]); // tekstowe, ogłoszenia, głosowe (czat), wątki
const THREAD_TYPES = new Set([10, 11, 12]);
const VOICE_TYPES = new Set([2, 13]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createDiscordRest({ token, fetchImpl = (...a) => fetch(...a), cacheMs = 60 * 1000 }) {
  async function call(method, path, body, attempt = 0) {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 2) { // limit zapytań - poczekaj, ile każe Discord
      const info = await res.json().catch(() => ({}));
      await sleep(Math.min(5000, (Number(info.retry_after) || 1) * 1000));
      return call(method, path, body, attempt + 1);
    }
    if (!res.ok) {
      const err = new Error(`Discord API ${res.status} (${method} ${path})`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  const guilds = new Map();
  const users = new Map(); // id -> { user, ts }
  const client = {
    application: { id: null },
    user: { id: null },
    guilds: { cache: guilds },
    isReady: () => true,
    users: {
      cache: { get: (id) => users.get(id)?.user },
      async fetch(id) {
        const hit = users.get(id);
        if (hit && Date.now() - hit.ts < cacheMs * 10) return hit.user;
        const u = await call('GET', `/users/${encodeURIComponent(id)}`);
        const user = {
          id: u.id,
          tag: u.discriminator && u.discriminator !== '0' ? `${u.username}#${u.discriminator}` : u.username,
          globalName: u.global_name || null,
          bot: Boolean(u.bot),
        };
        users.set(id, { user, ts: Date.now() });
        return user;
      },
    },
  };

  const channelOf = (c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    rawPosition: c.position ?? 0,
    parentId: c.parent_id || null,
    isTextBased: () => TEXT_TYPES.has(c.type),
    isThread: () => THREAD_TYPES.has(c.type),
    isVoiceBased: () => VOICE_TYPES.has(c.type),
  });

  function guildOf(g, channels) {
    const roles = new Map(g.roles.map((r) => [r.id, { id: r.id, name: r.name, permissions: BigInt(r.permissions) }]));
    const members = new Map(); // userId -> { member, ts }
    return {
      id: g.id,
      name: g.name,
      ownerId: g.owner_id,
      memberCount: g.approximate_member_count,
      roles: { cache: roles },
      channels: { cache: new Map(channels.map((c) => [c.id, channelOf(c)])) },
      members: {
        async fetch(userId) {
          const hit = members.get(userId);
          if (hit && Date.now() - hit.ts < cacheMs) return hit.member;
          const m = await call('GET', `/guilds/${g.id}/members/${encodeURIComponent(userId)}`);
          // uprawnienia = rola @everyone + role członka (właściciel ma wszystko)
          let perms = roles.get(g.id)?.permissions ?? 0n;
          for (const id of m.roles) perms |= roles.get(id)?.permissions ?? 0n;
          const isOwner = userId === g.owner_id;
          const member = {
            id: userId,
            roles: { cache: new Map(m.roles.map((id) => [id, roles.get(id) || { id }])) },
            permissions: {
              has: (flag) => isOwner || (perms & ADMINISTRATOR) === ADMINISTRATOR || (perms & BigInt(flag)) === BigInt(flag),
            },
          };
          members.set(userId, { member, ts: Date.now() });
          return member;
        },
      },
    };
  }

  let loadedAt = 0;
  let loading = null;
  /** Wczytuje serwery bota z kanałami i rolami (co najwyżej raz na minutę, chyba że force). */
  function refresh(force = false) {
    if (!force && Date.now() - loadedAt < cacheMs) return Promise.resolve();
    loading ||= (async () => {
      try {
        const me = await call('GET', '/users/@me');
        client.user.id = me.id;
        client.application.id = me.id; // u botów ID aplikacji = ID użytkownika bota
        const list = await call('GET', '/users/@me/guilds');
        const fresh = await Promise.all(list.map(async ({ id }) => {
          const [g, channels] = await Promise.all([
            call('GET', `/guilds/${id}?with_counts=true`),
            call('GET', `/guilds/${id}/channels`),
          ]);
          return guildOf(g, channels);
        }));
        guilds.clear();
        for (const g of fresh) guilds.set(g.id, g);
        loadedAt = Date.now();
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  /** Wysyła wiadomość na kanał (np. raport). */
  const sendMessage = (channelId, payload) => call('POST', `/channels/${encodeURIComponent(channelId)}/messages`, payload);

  return { client, refresh, sendMessage };
}

module.exports = { createDiscordRest };
