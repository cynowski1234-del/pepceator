-- =====================================================================
--  PEP BOT – schemat bazy Supabase
--  Supabase -> SQL Editor -> New query -> wklej całość -> Run.
--  Można uruchomić ponownie (nic nie usuwa, tylko tworzy brakujące rzeczy).
-- =====================================================================

-- Ustawienia każdego serwera (kanał raportów, frazy, kanały ochrony, obrazki scamu, ostatni raport)
create table if not exists public.guild_settings (
  guild_id           text primary key,
  log_channel_id     text,
  image_hashes       jsonb not null default '[]'::jsonb,
  blocked_phrases    jsonb not null default '[]'::jsonb,
  protected_channels jsonb not null default '[]'::jsonb,
  last_report_day    text,
  updated_at         timestamptz not null default now()
);

-- Zdarzenia: usunięte scamy, spam, frazy, odpowiedzi AI (pulpit, logi użytkownika, raporty)
create table if not exists public.events (
  id       bigint generated always as identity primary key,
  type     text   not null,
  ts       bigint not null,               -- czas w milisekundach
  guild_id text,
  data     jsonb  not null default '{}'::jsonb
);
create index if not exists events_ts_idx    on public.events (ts desc);
create index if not exists events_guild_idx on public.events (guild_id, ts desc);

-- Liczniki zdarzeń dla pulpitu
create or replace view public.event_totals
  with (security_invoker = true) as
  select type, count(*)::int as count from public.events group by type;

-- Osoby dodane w panelu (Administracja -> Whitelista) z rangą
create table if not exists public.panel_access (
  user_id  text primary key,
  rank     text,            -- PEP CREATOR / DEVELOPER / ALPHA TESTER albo null = tylko whitelista
  name     text,
  added_by text,
  added_at bigint
);

-- Różne wartości: baza pytań (wiedza), status bota dla panelu
create table if not exists public.kv (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now()
);

-- Bezpieczeństwo: bez polityk RLS nikt z zewnątrz (klucz anon) nie ma dostępu.
-- Bot i panel używają klucza service_role, który omija RLS – trzymaj go tylko w zmiennych środowiskowych.
alter table public.guild_settings enable row level security;
alter table public.events         enable row level security;
alter table public.panel_access   enable row level security;
alter table public.kv             enable row level security;
