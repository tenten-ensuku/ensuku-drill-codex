alter table public.ensuku_rankings
drop constraint if exists ensuku_rankings_rank_check;

alter table public.ensuku_rankings
add constraint ensuku_rankings_rank_check
check (rank in ('E', 'D', 'C', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S', 'SS', '神'));

drop policy if exists "Anyone can submit A rank ensuku results" on public.ensuku_rankings;
drop policy if exists "Anyone can submit ensuku results" on public.ensuku_rankings;

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
);
