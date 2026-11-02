// POST /api/push  (called by the database whenever a notification is created)
// Looks up the person's subscribed devices and sends a Web Push to each. Authenticated by a shared secret.
const webpush = require("web-push");
const crypto = require("crypto");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://esgbgmchgibkstywbeox.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_NgGeFw5s8K3RtyjUy1ujJA_riBi23BR"; // public by design

const same = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const rpc = (fn, args) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });

module.exports = async (req, res) => {
  const secret = process.env.PUSH_SECRET;
  if (req.method !== "POST") { res.statusCode = 405; return res.end("POST only"); }
  if (!secret || !same(req.headers["x-push-secret"], secret)) { res.statusCode = 401; return res.end("Unauthorized"); }
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) { res.statusCode = 500; return res.end("Push keys not configured"); }
  try {
    const n = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (!n.member_id || !n.title) { res.statusCode = 400; return res.end("Bad request"); }
    const r = await rpc("push_targets", { p_secret: secret, p_member: n.member_id });
    const info = r.ok ? await r.json() : null;
    if (!info) { res.statusCode = 502; return res.end("Lookup failed"); }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const payload = JSON.stringify({ title: String(n.title).slice(0, 120), body: String(n.body || "").slice(0, 200), target: n.target || "home", unread: info.unread || 0, id: n.id });
    let sent = 0, dropped = 0;
    await Promise.all(info.subs.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "high" }); sent++; }
      catch (err) { if (err.statusCode === 404 || err.statusCode === 410) { dropped++; await rpc("push_drop", { p_secret: secret, p_endpoint: s.endpoint }); } }
    }));
    res.setHeader("Content-Type", "application/json"); res.statusCode = 200; res.end(JSON.stringify({ sent, dropped, devices: info.subs.length }));
  } catch (e) { res.statusCode = 500; res.end("Push error"); }
};
