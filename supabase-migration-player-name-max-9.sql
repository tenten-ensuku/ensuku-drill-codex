alter policy "Anyone can submit ensuku results"
on public.ensuku_rankings
with check (
  rank in ('E', 'D', 'C', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S', 'SS', '神')
  and mode_id in ('6', '7', '10_20', '10_all')
  and variant in ('normal', 'ura')
  and score >= 0
  and char_length(player_name) between 1 and 9
  and player_name !~ '[<>"''`/\\]'
  and player_name !~ '[[:cntrl:]]'
  and lower(regexp_replace(player_name, '^[[:space:]　]+|[[:space:]　]+$', '', 'g')) not in ('にんじん', 'だいこん', 'にら', 'てんpc')
  and char_length(device_id) between 4 and 64
  and device_id <> 'd_59d2ba0e542024381b0b018b'
);
