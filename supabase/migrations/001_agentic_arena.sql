-- Agentic Arena schema (Supabase / Postgres)
-- Run via Supabase SQL editor or: supabase db push

create extension if not exists "pgcrypto";

-- ── Bots ─────────────────────────────────────────────────────────────────────
create table if not exists public.bots (
  bot_address   text primary key,
  owner_address text not null,
  metadata_uri  text,
  config_uri    text,
  created_at    timestamptz not null default now()
);

create index if not exists bots_owner_idx on public.bots (owner_address);

-- ── Arena games ────────────────────────────────────────────────────────────
create table if not exists public.arena_games (
  id               uuid primary key default gen_random_uuid(),
  on_chain_game_id bigint,
  table_id         text not null unique,
  tier             smallint not null check (tier between 0 and 2),
  settings_hash    text,
  status           text not null default 'open'
    check (status in ('open', 'in_progress', 'settled', 'cancelled')),
  hand_count       integer not null default 0,
  result_hash      text,
  created_at       timestamptz not null default now(),
  settled_at       timestamptz
);

create index if not exists arena_games_tier_status_idx
  on public.arena_games (tier, status);

create index if not exists arena_games_on_chain_idx
  on public.arena_games (on_chain_game_id);

-- ── Participants ─────────────────────────────────────────────────────────────
create table if not exists public.game_participants (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.arena_games (id) on delete cascade,
  bot_address  text not null references public.bots (bot_address),
  chips_start  integer not null default 1000,
  chips_end    integer,
  hands_won    integer not null default 0,
  placement    smallint,
  is_winner    boolean not null default false,
  joined_at    timestamptz not null default now(),
  unique (game_id, bot_address)
);

create index if not exists game_participants_bot_idx
  on public.game_participants (bot_address);

-- ── Per-hand summaries (optional, capped by app) ─────────────────────────────
create table if not exists public.hand_summaries (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.arena_games (id) on delete cascade,
  hand_number integer not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  unique (game_id, hand_number)
);

-- ── Ranking / audit events ───────────────────────────────────────────────────
create table if not exists public.ranking_events (
  id           uuid primary key default gen_random_uuid(),
  bot_address  text not null,
  game_id      uuid references public.arena_games (id) on delete set null,
  event_type   text not null,
  payload      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index if not exists ranking_events_bot_idx
  on public.ranking_events (bot_address, created_at desc);

-- ── Materialized bot profile snapshot ────────────────────────────────────────
create table if not exists public.bot_stats_snapshots (
  bot_address          text primary key references public.bots (bot_address) on delete cascade,
  games_played         integer not null default 0,
  games_won            integer not null default 0,
  hands_won            integer not null default 0,
  chips_net            bigint not null default 0,
  ranked_games         integer not null default 0,
  elite_games          integer not null default 0,
  ranked_wins          integer not null default 0,
  elite_wins           integer not null default 0,
  composite_score      bigint not null default 0,
  assassin_score       bigint not null default 0,
  sociopath_score      bigint not null default 0,
  consistency_score    bigint not null default 0,
  recency_score        bigint not null default 0,
  rank_position        integer,
  updated_at           timestamptz not null default now()
);

create index if not exists bot_stats_rank_idx
  on public.bot_stats_snapshots (rank_position);

-- ── Portable history blobs (ZIP export cache) ────────────────────────────────
create table if not exists public.bot_history_exports (
  id          uuid primary key default gen_random_uuid(),
  bot_address text not null references public.bots (bot_address) on delete cascade,
  version     integer not null default 1,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists bot_history_exports_bot_idx
  on public.bot_history_exports (bot_address, created_at desc);

-- RLS: service role bypasses; enable when adding anon/authenticated clients
alter table public.bots enable row level security;
alter table public.arena_games enable row level security;
alter table public.game_participants enable row level security;
alter table public.hand_summaries enable row level security;
alter table public.ranking_events enable row level security;
alter table public.bot_stats_snapshots enable row level security;
alter table public.bot_history_exports enable row level security;
