// Called daily by a Vercel cron so the free Supabase project never idles into auto-pause.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://esgbgmchgibkstywbeox.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_NgGeFw5s8K3RtyjUy1ujJA_riBi23BR";
module.exports = async (req, res) => {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ping`, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" }, body: "{}" });
    res.statusCode = r.ok ? 200 : 502; res.end(r.ok ? "ok" : "database unreachable");
  } catch { res.statusCode = 502; res.end("database unreachable"); }
};
