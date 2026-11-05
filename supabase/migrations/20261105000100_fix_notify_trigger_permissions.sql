-- ROOT CAUSE FIX. The notification triggers ran as the signed-in role ("authenticated"), but public.notify is
-- only executable by postgres. So every insert that fires a notification failed with
-- "permission denied for function notify" and was rolled back: task assignees (leaving tasks with zero
-- assignees after "Couldn't save" made people click again), grocery assignments, cover requests, ticket statuses.
-- Trigger functions run as their owner instead. They can't be called directly over the API (they return
-- `trigger`), and notify itself stays private.
alter function public.trg_task_assignee() security definer;
alter function public.trg_grocery()       security definer;
alter function public.trg_cover()         security definer;
alter function public.trg_ticket()        security definer;
