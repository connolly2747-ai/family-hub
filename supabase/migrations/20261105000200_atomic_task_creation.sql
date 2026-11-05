-- A task and its assignees are saved in one transaction, and a task can never be left without assignees.

create or replace function public.create_task(
  p_id uuid, p_title text, p_details text, p_assigned_by text, p_priority text, p_due_date date, p_assignees text[])
returns uuid
language plpgsql
security invoker            -- runs as the caller, so RLS still applies
set search_path = public
as $$
declare who text[];
begin
  select coalesce(array_agg(distinct x), '{}') into who from unnest(coalesce(p_assignees, '{}')) x where x is not null and x <> '';
  if cardinality(who) = 0 then
    raise exception 'A task needs at least one person assigned' using errcode = '23514';
  end if;
  -- Idempotent: the form sends its own id, so a repeated submit of the same form can never create a second task.
  insert into public.tasks (id, title, details, assigned_by, priority, due_date)
  values (p_id, p_title, nullif(btrim(p_details), ''), p_assigned_by, coalesce(p_priority, 'medium'), p_due_date)
  on conflict (id) do nothing;
  if not found then return p_id; end if;
  insert into public.task_assignees (task_id, member_id) select p_id, unnest(who);
  return p_id;
end $$;
revoke all on function public.create_task(uuid, text, text, text, text, date, text[]) from public, anon;
grant execute on function public.create_task(uuid, text, text, text, text, date, text[]) to authenticated;

-- Safety net checked at COMMIT: a new task must have an assignee, and the last assignee can't be removed
-- from a task that still exists. (Deleting the whole task still works: its assignees cascade away with it.)
create or replace function public.trg_task_needs_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare tid uuid := case when tg_table_name = 'tasks' then new.id else old.task_id end;
begin
  if exists (select 1 from public.tasks where id = tid)
     and not exists (select 1 from public.task_assignees where task_id = tid) then
    raise exception 'A task needs at least one person assigned' using errcode = '23514';
  end if;
  return null;
end $$;

drop trigger if exists task_needs_assignee on public.tasks;
create constraint trigger task_needs_assignee after insert on public.tasks
  deferrable initially deferred for each row execute function public.trg_task_needs_assignee();
drop trigger if exists task_keeps_assignee on public.task_assignees;
create constraint trigger task_keeps_assignee after delete on public.task_assignees
  deferrable initially deferred for each row execute function public.trg_task_needs_assignee();
