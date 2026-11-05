-- Per-person notification settings. No row = everything on.
create table if not exists public.notification_prefs (
  member_id        text primary key references public.members(id) on delete cascade,
  tasks            boolean not null default true,   -- new task, seen, done
  extensions       boolean not null default true,   -- deadline requests and answers
  events           boolean not null default true,   -- calendar adds, changes, cancellations
  reminders        boolean not null default true,   -- day-before event reminders
  groceries        boolean not null default true,   -- grocery items assigned to you
  covers           boolean not null default true,   -- chore cover requests
  muted_categories text[]  not null default '{}',   -- calendar categories to skip (events + reminders)
  quiet_start      time,                            -- optional quiet hours (family time zone): no lock-screen
  quiet_end        time,                            --   alerts, but notifications still land in the inbox
  updated_at       timestamptz not null default now(),
  constraint quiet_hours_pair check ((quiet_start is null) = (quiet_end is null)),
  constraint muted_categories_size check (cardinality(muted_categories) <= 20)
);
alter table public.notification_prefs enable row level security;
drop policy if exists family_all on public.notification_prefs;
create policy family_all on public.notification_prefs for all to authenticated
  using ((auth.jwt() ->> 'email') = 'family@connollyfamilyhub.com')
  with check ((auth.jwt() ->> 'email') = 'family@connollyfamilyhub.com');
revoke all on public.notification_prefs from anon, public;
grant select, insert, update, delete on public.notification_prefs to authenticated;
alter publication supabase_realtime add table public.notification_prefs;

-- The family's time zone (same as the calendar feed in api/_ics.js).
create or replace function public.family_tz() returns text language sql immutable set search_path = '' as $$ select 'America/New_York' $$;

-- notify(...) with a calendar category, honoring preferences. Never raises: a notification problem must not
-- undo the save that triggered it.
create or replace function public.notify(p_member text, p_kind text, p_title text, p_body text, p_target text, p_category text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare p public.notification_prefs;
begin
  select * into p from public.notification_prefs where member_id = p_member;
  if found then
    if (p_kind in ('task', 'task_seen', 'task_done') and not p.tasks)
       or (p_kind = 'extension' and not p.extensions)
       or (p_kind = 'event'     and not p.events)
       or (p_kind = 'reminder'  and not p.reminders)
       or (p_kind = 'grocery'   and not p.groceries)
       or (p_kind = 'cover'     and not p.covers) then
      return;
    end if;
    if p_kind in ('event', 'reminder') and p_category is not null and p_category = any (p.muted_categories) then
      return;
    end if;
  end if;
  insert into public.notifications (member_id, kind, title, body, target)
  values (p_member, p_kind, left(p_title, 160), left(p_body, 300), coalesce(p_target, 'home'));
exception when others then
  raise warning 'notify(%, %) failed: %', p_member, p_kind, sqlerrm;
end $$;
revoke all on function public.notify(text, text, text, text, text, text) from public, anon, authenticated;

-- The original 5-argument notify (used by the existing task/grocery/cover/ticket triggers) now goes through
-- the same preference checks.
create or replace function public.notify(p_member text, p_kind text, p_title text, p_body text, p_target text)
returns void
language sql
security definer
set search_path = public
as $$ select public.notify(p_member, p_kind, p_title, p_body, p_target, null::text) $$;
revoke all on function public.notify(text, text, text, text, text) from public, anon, authenticated;

-- Quiet hours: skip the lock-screen push (the notification is still saved and shows in the inbox and badge).
create or replace function public.in_quiet_hours(p_member text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when p.quiet_start < p.quiet_end then lt >= p.quiet_start and lt < p.quiet_end
                else lt >= p.quiet_start or lt < p.quiet_end end
    from public.notification_prefs p,
         lateral (select (now() at time zone public.family_tz())::time as lt) x
    where p.member_id = p_member and p.quiet_start is not null and p.quiet_start <> p.quiet_end), false)
$$;
revoke all on function public.in_quiet_hours(text) from public, anon, authenticated;

create or replace function public.notify_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare sec text;
begin
  if public.in_quiet_hours(new.member_id) then return new; end if;
  select value into sec from public.app_secrets where name = 'push_secret';
  if sec is not null then
    perform net.http_post(
      url := 'https://family-hub-gold-pi.vercel.app/api/push',
      headers := jsonb_build_object('Content-Type','application/json','x-push-secret', sec),
      body := jsonb_build_object('id', new.id, 'member_id', new.member_id, 'title', new.title, 'body', new.body, 'target', new.target));
  end if;
  return new;
exception when others then return new;  -- never block saving a notification because a push failed
end $$;
