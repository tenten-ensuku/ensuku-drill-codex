alter table public.ensuku_rankings
alter column elapsed_seconds type numeric(8, 1)
using round(elapsed_seconds::numeric, 1);

drop index if exists public.ensuku_rankings_mode_score_idx;
create index ensuku_rankings_mode_score_idx
on public.ensuku_rankings (mode_id, score desc, elapsed_seconds asc, submitted_at asc);
