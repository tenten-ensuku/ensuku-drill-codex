create table if not exists public.ensuku_rankings (
  id uuid primary key default gen_random_uuid(),
  player_name text not null check (
    char_length(player_name) between 1 and 12
    and player_name !~ '[<>"''`/\\]'
    and player_name !~ '[[:cntrl:]]'
    and lower(regexp_replace(player_name, '^[[:space:]　]+|[[:space:]　]+$', '', 'g')) not in ('にんじん', 'だいこん', 'にら', 'てんpc')
  ),
  device_id text not null check (char_length(device_id) between 4 and 64),
  mode_id text not null check (mode_id in ('6', '7', '10_20', '10_all')),
  mode_label text not null,
  variant text not null check (variant in ('normal', 'ura')),
  score integer not null check (score >= 0),
  rank text not null check (rank in ('E', 'D', 'C', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S', 'SS', '神')),
  correct_count integer not null check (correct_count >= 0),
  mistake_count integer not null check (mistake_count >= 0),
  elapsed_seconds integer not null check (elapsed_seconds >= 0),
  average_seconds numeric(6, 1) not null check (average_seconds >= 0),
  question_count integer not null check (question_count > 0),
  client_version text not null,
  submitted_at timestamptz not null default now()
);

alter table public.ensuku_rankings enable row level security;

drop policy if exists "Anyone can read ensuku rankings" on public.ensuku_rankings;
create policy "Anyone can read ensuku rankings"
on public.ensuku_rankings
for select
to anon
using (lower(regexp_replace(player_name, '^[[:space:]　]+|[[:space:]　]+$', '', 'g')) not in ('にんじん', 'だいこん', 'にら', 'てんpc'));

drop policy if exists "Anyone can submit ensuku results" on public.ensuku_rankings;
drop policy if exists "Anyone can submit A rank ensuku results" on public.ensuku_rankings;
create policy "Anyone can submit ensuku results"
on public.ensuku_rankings
for insert
to anon
with check (
  rank in ('E', 'D', 'C', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S', 'SS', '神')
  and mode_id in ('6', '7', '10_20', '10_all')
  and variant in ('normal', 'ura')
  and score >= 0
  and char_length(player_name) between 1 and 12
  and player_name !~ '[<>"''`/\\]'
  and player_name !~ '[[:cntrl:]]'
  and lower(regexp_replace(player_name, '^[[:space:]　]+|[[:space:]　]+$', '', 'g')) not in ('にんじん', 'だいこん', 'にら', 'てんpc')
  and char_length(device_id) between 4 and 64
);

create index if not exists ensuku_rankings_mode_day_score_idx
on public.ensuku_rankings (mode_id, submitted_at desc, score desc, elapsed_seconds asc);

create index if not exists ensuku_rankings_mode_score_idx
on public.ensuku_rankings (mode_id, score desc, elapsed_seconds asc);

create index if not exists ensuku_rankings_device_idx
on public.ensuku_rankings (device_id, submitted_at desc);

-- Ranking display rule:
-- The app fetches candidates ordered by score desc / elapsed_seconds asc,
-- then shows only the best visible result per player_name for each mode and period.
