-- Recalculate ten-tile rankings after moving God thresholds.
-- 10_20: God starts at 578pt.
-- 10_all: God starts at 2291pt.
update public.ensuku_rankings
set rank = case
  when mode_id = '10_20' then case
    when score >= 578 then '神'
    when score >= 530 then 'SS'
    when score >= 500 then 'S'
    when score >= 460 then 'A+'
    when score >= 420 then 'A'
    when score >= 385 then 'A-'
    when score >= 350 then 'B+'
    when score >= 315 then 'B'
    when score >= 280 then 'B-'
    when score >= 230 then 'C'
    when score >= 170 then 'D'
    else 'E'
  end
  when mode_id = '10_all' then case
    when score >= 2291 then '神'
    when score >= 2120 then 'SS'
    when score >= 2000 then 'S'
    when score >= 1800 then 'A+'
    when score >= 1600 then 'A'
    when score >= 1400 then 'A-'
    when score >= 1200 then 'B+'
    when score >= 1000 then 'B'
    when score >= 800 then 'B-'
    when score >= 600 then 'C'
    when score >= 400 then 'D'
    else 'E'
  end
  else rank
end
where (mode_id = '10_20' and (score >= 530 or rank = '神'))
   or (mode_id = '10_all' and (score >= 2120 or rank = '神'));

select
  count(*) filter (where mode_id = '10_20' and rank = '神' and score < 578) as invalid_10_20_god,
  count(*) filter (where mode_id = '10_20' and score >= 578 and rank <> '神') as missing_10_20_god,
  count(*) filter (where mode_id = '10_20' and score >= 578 and rank = '神') as valid_10_20_god,
  count(*) filter (where mode_id = '10_all' and rank = '神' and score < 2291) as invalid_10_all_god,
  count(*) filter (where mode_id = '10_all' and score >= 2291 and rank <> '神') as missing_10_all_god,
  count(*) filter (where mode_id = '10_all' and score >= 2291 and rank = '神') as valid_10_all_god
from public.ensuku_rankings
where mode_id in ('10_20', '10_all');
