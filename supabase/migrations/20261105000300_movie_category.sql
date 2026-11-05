-- Add a "movie" event category. Existing categories are unchanged.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.events'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%category%'
  loop execute format('alter table public.events drop constraint %I', c); end loop;
end $$;
alter table public.events add constraint events_category_check check (category in
  ('general','work','school','away','holiday','chore','appointment','birthday','meal','trip','movie'));
