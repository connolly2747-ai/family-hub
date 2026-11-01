// GET /api/ics?token=SECRET[&scope=all]  ->  iCalendar feed. The secret token is the only credential.
const { buildIcs } = require("./_ics");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://esgbgmchgibkstywbeox.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_NgGeFw5s8K3RtyjUy1ujJA_riBi23BR"; // public by design

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const token = (url.searchParams.get("token") || "").replace(/[^a-f0-9]/gi, "");
    if (token.length < 32) { res.statusCode = 400; return res.end("Missing or malformed token"); }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/feed_events`, {
      method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token }),
    });
    if (!r.ok) { res.statusCode = 502; return res.end("Calendar source unavailable"); }
    const data = await r.json();
    if (!data) { res.statusCode = 404; return res.end("Unknown or revoked calendar link"); }
    const { text } = buildIcs({ events: data.events, members: data.members, memberId: data.member_id, memberName: data.member_name, scope: url.searchParams.get("scope") === "all" ? "all" : "mine" });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="family-hub.ics"');
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    res.statusCode = 200; res.end(text);
  } catch (err) { res.statusCode = 500; res.end("Error building calendar"); }
};
