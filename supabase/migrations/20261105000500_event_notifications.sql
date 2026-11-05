-- Calendar notifications: tell the people an event is for when it's added, when its date/time changes,
-- and when it's cancelled. Whole-family events (no one picked) go to everyone. The person who made the
-- change is never notified about their own change.

alter table public.events add column if not exists updated_by text references public.members(id);
alter table public.events add column if not exists reminder_message text;
alter table public.events drop constraint if exists events_reminder_message_len;
alter table public.events add constraint events_reminder_message_len check (reminder_message is null or length(reminder_message) <= 200);

-- Who an event is for: the chore rotation (plus anyone picked), else the picked people, else everyone.
create or replace function public.event_people(p_member_ids text[], p_rotation text[])
returns text[]
language sql
stable
set search_path = public
as $$
  select case
    when cardinality(coalesce(p_rotation, '{}')) > 0
      then (select array_agg(distinct x) from unnest(p_rotation || coalesce(p_member_ids, '{}')) x)
    when cardinality(coalesce(p_member_ids, '{}')) > 0 then p_member_ids
    else (select coalesce(array_agg(id order by sort), '{}') from public.members)
  end
$$;

-- "Fri Nov 7, 6:00 PM", "Fri Nov 7" (all day), with "– Sun Nov 9" for multi-day all-day events and "· repeats weekly".
create or replace function public.event_when(p_start timestamptz, p_end timestamptz, p_all_day boolean, p_recurrence text)
returns text
language sql
stable
set search_path = public
as $$
  select case when p_all_day then
           to_char(p_start at time zone public.family_tz(), 'Dy Mon FMDD')
           || case when p_end is not null and (p_end at time zone public.family_tz())::date > (p_start at time zone public.family_tz())::date
                   then ' – ' || to_char(p_end at time zone public.family_tz(), 'Dy Mon FMDD') else '' end
         else to_char(p_start at time zone public.family_tz(), 'Dy Mon FMDD, FMHH12:MI AM') end
         || case when coalesce(p_recurrence, 'none') <> 'none' then ' · repeats ' || p_recurrence else '' end
$$;

create or replace function public.trg_event_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text; who text; old_people text[]; new_people text[]; title text; body text; moved boolean;
begin
  if tg_op = 'INSERT' then
    actor := coalesce(new.updated_by, new.added_by);
    if new.recurrence = 'none' and coalesce(new.end_at, new.start_at) < now() then return null; end if; -- logging something already over
    title := public.mname(actor) || ' added ' || new.title;
    body  := public.event_when(new.start_at, new.end_at, new.all_day, new.recurrence) || coalesce(' · ' || new.place, '');
    foreach who in array public.event_people(new.member_ids, new.rotation) loop
      if who is distinct from actor then perform public.notify(who, 'event', title, body, 'calendar', new.category); end if;
    end loop;

  elsif tg_op = 'UPDATE' then
    actor := coalesce(new.updated_by, new.added_by);
    if new.recurrence = 'none' and old.recurrence = 'none'
       and greatest(coalesce(new.end_at, new.start_at), coalesce(old.end_at, old.start_at)) < now() then return null; end if;
    old_people := public.event_people(old.member_ids, old.rotation);
    new_people := public.event_people(new.member_ids, new.rotation);
    moved := new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at
          or new.all_day is distinct from old.all_day or new.recurrence is distinct from old.recurrence;
    -- People newly added to the event hear about it as a new event.
    title := public.mname(actor) || ' added you to ' || new.title;
    body  := public.event_when(new.start_at, new.end_at, new.all_day, new.recurrence) || coalesce(' · ' || new.place, '');
    foreach who in array new_people loop
      if who is distinct from actor and not (who = any (old_people)) then
        perform public.notify(who, 'event', title, body, 'calendar', new.category);
      end if;
    end loop;
    -- Everyone else on it hears about a date/time change.
    if moved then
      title := 'Changed: ' || new.title;
      body  := 'Now ' || public.event_when(new.start_at, new.end_at, new.all_day, new.recurrence)
               || ' (was ' || public.event_when(old.start_at, old.end_at, old.all_day, old.recurrence) || ')';
      foreach who in array new_people loop
        if who is distinct from actor and who = any (old_people) then
          perform public.notify(who, 'event', title, body, 'calendar', new.category);
        end if;
      end loop;
    end if;

  else -- DELETE
    -- The app deletes through delete_event(), which records who did it for this transaction.
    actor := coalesce(nullif(current_setting('app.actor', true), ''), old.added_by);
    if old.recurrence = 'none' and coalesce(old.end_at, old.start_at) < now() then return null; end if;
    title := 'Cancelled: ' || old.title;
    body  := public.event_when(old.start_at, old.end_at, old.all_day, old.recurrence) || ' · cancelled by ' || public.mname(actor);
    foreach who in array public.event_people(old.member_ids, old.rotation) loop
      if who is distinct from actor then perform public.notify(who, 'event', title, body, 'calendar', old.category); end if;
    end loop;
  end if;
  return null;
exception when others then
  raise warning 'event notification failed: %', sqlerrm;  -- never block saving an event
  return null;
end $$;

drop trigger if exists event_notify on public.events;
create trigger event_notify after insert or update or delete on public.events
  for each row execute function public.trg_event_notify();

-- Delete an event and record who deleted it, so they aren't notified about their own cancellation.
create or replace function public.delete_event(p_id uuid, p_by text)
returns void
language plpgsql
security invoker            -- RLS still applies
set search_path = public
as $$
begin
  perform set_config('app.actor', coalesce(p_by, ''), true);
  delete from public.events where id = p_id;
end $$;
revoke all on function public.delete_event(uuid, text) from public, anon;
grant execute on function public.delete_event(uuid, text) to authenticated;
