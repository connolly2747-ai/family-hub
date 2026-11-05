// GET /api/reminders  (Vercel cron, daily at 22:00 UTC = 5pm EST / 6pm EDT)
// Asks the database to send tomorrow's day-before event reminders. The database only sends between 5pm and 10pm
// Eastern and keeps a sent-log, so this is safe to call any number of times (and alongside pg_cron).
const SUPABASE_URL = process.env.SUPABASE_URL || "https://esgbgmchgibkstywbeox.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_NgGeFw5s8K3RtyjUy1ujJA_riBi23BR"; // public by design
module.exports = async (req, res) => {
  const secret = process.env.PUSH_SECRET;
  if (!secret) { res.statusCode = 500; return res.end("PUSH_SECRET not configured"); }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/run_event_reminders`, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_secret: secret }) });
    const sent = r.ok ? await r.json() : null;
    res.setHeader("Content-Type", "application/json");
    res.statusCode = r.ok && sent !== null ? 200 : 502; res.end(JSON.stringify({ sent }));
  } catch { res.statusCode = 502; res.end("database unreachable"); }
};
