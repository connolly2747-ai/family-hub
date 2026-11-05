-- Day-before reminders. Each occurrence that starts "tomorrow" (family time zone) sends one reminder to each
-- person it's for. Recurring events follow the same rules as js/dates.js (monthly/yearly clamp to the last day
-- of short months, so Jan 31 -> Feb 28 and Feb 29 birthdays -> Feb 28). Chore rotations remind whoever's turn
-- it is, and a covered shift reminds the person covering. A sent-log makes every run safe to repeat.

create table if not exists public.event_reminders_sent (
  event_id  uuid not null references public.events(id) on delete cascade,
  on_date   date not null,
  member_id text not null references public.members(id) on delete cascade,
  sent_at   timestamptz not null default now(),
  primary key (event_id, on_date, member_id)
);
alter table public.event_reminders_sent enable row level security;  -- internal: no policies, no client access
revoke all on public.event_reminders_sent from anon, authenticated, public;

create or replace function public.send_event_reminders(p_day date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare tz text := public.family_tz(); r record; n integer := 0; ttl text; body text;
begin
  for r in
    with ev as (
      select e.*, (e.start_at at time zone tz) as ls, (e.start_at at time zone tz)::date as d0,
             coalesce((e.end_at at time zone tz)::date, (e.start_at at time zone tz)::date) - (e.start_at at time zone tz)::date as span_days
      from public.events e
      where (e.start_at at time zone tz)::date <= p_day
    ), occ as (
      select ev.*,
        case ev.recurrence
          when 'none'    then case when d0 = p_day then 0 end
          when 'daily'   then p_day - d0
          when 'weekly'  then case when (p_day - d0) % 7 = 0 then (p_day - d0) / 7 end
          when 'monthly' then case when same_day then mdiff end
          when 'yearly'  then case when same_day and mdiff % 12 = 0 then mdiff / 12 end
        end as k
      from ev,
      lateral (select ((extract(year from p_day) - extract(year from d0)) * 12 + extract(month from p_day) - extract(month from d0))::int as mdiff,
                      extract(day from p_day) = least(extract(day from d0), extract(day from (date_trunc('month', p_day) + interval '1 month - 1 day'))) as same_day) m
    ), people as (
      select o.*, coalesce((select c.requested_by from public.chore_cover c where c.event_id = o.id and c.on_date = p_day and c.status = 'covered'), '') as cov_from,
                  (select c.covered_by from public.chore_cover c where c.event_id = o.id and c.on_date = p_day and c.status = 'covered') as cov_to,
             case when o.category = 'chore' and cardinality(o.rotation) > 0
                  then array[o.rotation[(o.k % cardinality(o.rotation)) + 1]]
                  else public.event_people(o.member_ids, o.rotation) end as base
      from occ o where o.k is not null
    )
    select p.id, p.title, p.category, p.all_day, p.ls, p.place, p.reminder_message, p.span_days, p.d0,
           (p.category = 'chore' and cardinality(p.base) = 1 and cardinality(p.rotation) > 0) as is_turn,
           case when x.who = p.cov_from and p.cov_to is not null then p.cov_to else x.who end as member
    from people p, unnest(p.base) as x(who)
  loop
    insert into public.event_reminders_sent (event_id, on_date, member_id) values (r.id, p_day, r.member) on conflict do nothing;
    if found then
      ttl  := 'Tomorrow: ' || r.title || case when r.is_turn then ' (your turn)' else '' end;
      body := coalesce(nullif(btrim(r.reminder_message), ''),
                case when r.all_day then 'All day' || case when r.span_days > 0 then ', through ' || to_char(p_day + r.span_days, 'Dy Mon FMDD') else '' end
                     else to_char(r.ls, 'FMHH12:MI AM') end
                || coalesce(' · ' || r.place, ''));
      perform public.notify(r.member, 'reminder', ttl, body, 'calendar', r.category);
      n := n + 1;
    end if;
  end loop;
  delete from public.event_reminders_sent where on_date < p_day - 60;
  return n;
end $$;
revoke all on function public.send_event_reminders(date) from public, anon, authenticated;

-- Scheduled entry point: sends tomorrow's reminders between 5pm and 10pm family time. Runs hourly (pg_cron) and/or
-- daily (Vercel cron); later runs pick up events added after the first one, and the sent-log prevents repeats.
create or replace function public.send_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare lt timestamp := now() at time zone public.family_tz();
begin
  if extract(hour from lt) < 17 or extract(hour from lt) >= 22 then return 0; end if;
  return public.send_event_reminders(lt::date + 1);
end $$;
revoke all on function public.send_due_reminders() from public, anon, authenticated;

-- For the Vercel cron (/api/reminders): authenticated by the same shared secret as /api/push.
create or replace function public.run_event_reminders(p_secret text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_secret is null or p_secret is distinct from (select value from public.app_secrets where name = 'push_secret') then return null; end if;
  return public.send_due_reminders();
end $$;
revoke all on function public.run_event_reminders(text) from public, authenticated;
grant execute on function public.run_event_reminders(text) to anon;

-- If pg_cron is enabled, schedule hourly. (If it isn't, see README: enable it and run the same cron.schedule call.)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('family-hub-event-reminders', '5 * * * *', 'select public.send_due_reminders()');
  end if;
end $$;
