-- Temporary: the previously deployed front end created a task and its assignees in two requests, which the
-- commit-time check rejects. Paused until the front end that uses create_task() is live (re-enabled in 20261105000700).
alter table public.tasks disable trigger task_needs_assignee;
