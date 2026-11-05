# Family Hub

A private, shared family calendar: work schedules, college/travel dates, out-of-town trips, holidays, chore rotations, appointments, birthdays, meals and trips, all in one place.

**Live app:** _(Vercel URL goes here)_

## What it does
- **Category-aware events.** Each type has its own behavior: work shifts and appointments don't ask for RSVPs; holidays, meals and trips do; chores rotate between people with a "mark done" button.
- **Accountability.** Every entry shows who added it; threaded replies are optional per event.
- **Views.** Month grid and 90-day agenda, filterable by person, by category, or "just me".
- **Recurrence.** Daily/weekly/monthly/yearly (birthdays, holidays, chore rotations), RSVPs tracked per occurrence.
- **Live sync** across family devices.

## Stack & design
- Zero-build front end: ES modules, no framework, hosted on Vercel.
- Supabase (Postgres, Auth, Realtime). Every table has Row Level Security; access is limited to a single shared family login, and public sign-ups are disabled.
- One data interface, two backends: Supabase for production and an in-browser demo backend (`?demo=1`) for development and tests.
- Recurrence expansion is computed client-side (`js/dates.js`) so events are stored once.

## Run locally
`python3 -m http.server` then open `http://localhost:8000/?demo=1` (demo code: `demo`).

## Roadmap
Personal iCal subscription feeds (Google/Outlook/Apple), importing external calendars, email reminders, individual accounts.

## Notifications & reminders
- Database changes live in `supabase/migrations/` (apply in filename order).
- Calendar notifications (add / time change / cancel) come from the `event_notify` trigger; each person's
  settings (More → Notification settings) are stored in `notification_prefs` and enforced inside `public.notify`.
- Day-before reminders: `public.send_due_reminders()` sends tomorrow's reminders between 5pm and 10pm Eastern and never
  repeats one. It runs daily from the Vercel cron `/api/reminders`. For hourly runs (catches events added later in
  the evening), enable pg_cron in Supabase (Database → Extensions) and run:
  `select cron.schedule('family-hub-event-reminders', '5 * * * *', 'select public.send_due_reminders()');`
