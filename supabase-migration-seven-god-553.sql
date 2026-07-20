-- Recalculate seven-tile rankings after moving the God threshold to 553pt.
update public.ensuku_rankings
set rank = case
  when score >= 553 then '神'
  when score >= 535 then 'SS'
  when score >= 520 then 'S'
  when score >= 510 then 'A+'
  when score >= 500 then 'A'
  when score >= 490 then 'A-'
  when score >= 480 then 'B+'
  when score >= 470 then 'B'
  when score >= 460 then 'B-'
  when score >= 450 then 'C'
  when score >= 440 then 'D'
  else 'E'
end
where mode_id = '7'
  and score >= 535;

select
  count(*) filter (where rank = '神' and score < 553) as invalid_god,
  count(*) filter (where score >= 553 and rank <> '神') as missing_god,
  count(*) filter (where score >= 553 and rank = '神') as valid_god
from public.ensuku_rankings
where mode_id = '7';
