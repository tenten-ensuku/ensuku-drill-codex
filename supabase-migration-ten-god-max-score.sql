update public.ensuku_rankings
set rank = case
  when mode_id = '10_20' then case
    when score >= 600 then '神'
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
    when score >= 2400 then '神'
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
where mode_id in ('10_20', '10_all')
  and rank = '神';
