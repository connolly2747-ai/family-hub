-- Fix: the CASE expression referenced old.task_id even when the trigger fired on public.tasks, which errors.
create or replace function public.trg_task_needs_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare tid uuid;
begin
  if tg_table_name = 'tasks' then tid := new.id; else tid := old.task_id; end if;
  if exists (select 1 from public.tasks where id = tid)
     and not exists (select 1 from public.task_assignees where task_id = tid) then
    raise exception 'A task needs at least one person assigned' using errcode = '23514';
  end if;
  return null;
end $$;
