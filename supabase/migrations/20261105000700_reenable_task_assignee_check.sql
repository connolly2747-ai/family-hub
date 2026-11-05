-- The front end now creates tasks through create_task(), so the "every task has an assignee" check is back on.
alter table public.tasks enable trigger task_needs_assignee;
