-- Family Hub schema (already applied to the Supabase project via migrations).
-- Every table is protected by Row Level Security: only the shared family login may read or write.
create table public.members (id text primary key, name text not null, color text not null, sort int not null default 0);
create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null check (category in ('general','work','school','away','holiday','chore','appointment','birthday','meal','trip')),
  start_at timestamptz not null, end_at timestamptz, all_day boolean not null default false,
  place text, notes text,
  member_ids text[] not null default '{}', rotation text[] not null default '{}',
  recurrence text not null default 'none' check (recurrence in ('none','daily','weekly','monthly','yearly')),
  rsvp_enabled boolean not null default false, replies_enabled boolean not null default false,
  added_by text not null references public.members(id), created_at timestamptz not null default now());
create table public.rsvps (event_id uuid references public.events(id) on delete cascade, member_id text references public.members(id),
  on_date date not null, status text not null check (status in ('going','maybe','no')), primary key (event_id, member_id, on_date));
create table public.replies (id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade,
  member_id text not null references public.members(id), body text not null check (length(body) between 1 and 1000), created_at timestamptz not null default now());
create table public.chore_done (event_id uuid references public.events(id) on delete cascade, on_date date, member_id text not null references public.members(id), primary key (event_id, on_date));
-- RLS: policy "family_all" on each table limits access to the shared family account; see migrations in Supabase.

-- Phase 2 additions (applied as migrations): feed_tokens (per-person secret calendar tokens), list_items, polls, votes,
-- plus RPCs feed_events(p_token) [anon-callable, token is the only credential] and ping() [keep-alive].
-- Every new table has the same "family_all" RLS policy as above.
