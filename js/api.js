// Data layer: one interface, two backends (Supabase for production, local demo for offline/testing).
import { SUPABASE_URL, SUPABASE_KEY, FAMILY_EMAIL } from "./config.js";

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2) + Date.now());

/* ---------------- Supabase backend ---------------- */
async function supabaseBackend() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const must = (r) => { if (r.error) throw r.error; return r.data; };
  return {
    name: "supabase",
    async session() { const { data } = await sb.auth.getSession(); return !!data.session; },
    async signIn(code) {
      const { error } = await sb.auth.signInWithPassword({ email: FAMILY_EMAIL, password: code });
      if (error) throw new Error(error.status === 400 ? "That code didn't work." : error.message);
    },
    async signOut() { await sb.auth.signOut(); },
    async load() {
      const [members, events, rsvps, replies, done] = await Promise.all([
        sb.from("members").select("*").order("sort"),
        sb.from("events").select("*").order("start_at"),
        sb.from("rsvps").select("*"),
        sb.from("replies").select("*").order("created_at"),
        sb.from("chore_done").select("*"),
      ]);
      return { members: must(members), events: must(events), rsvps: must(rsvps), replies: must(replies), done: must(done) };
    },
    subscribe(cb) {
      let t;
      const ping = () => { clearTimeout(t); t = setTimeout(cb, 250); };
      const ch = sb.channel("family-hub");
      for (const table of ["events", "rsvps", "replies", "chore_done", "members"])
        ch.on("postgres_changes", { event: "*", schema: "public", table }, ping);
      ch.subscribe();
      return () => sb.removeChannel(ch);
    },
    async saveEvent(ev) { must(await sb.from("events").upsert(ev)); },
    async deleteEvent(id) { must(await sb.from("events").delete().eq("id", id)); },
    async setRsvp(event_id, member_id, on_date, status) {
      if (!status) must(await sb.from("rsvps").delete().match({ event_id, member_id, on_date }));
      else must(await sb.from("rsvps").upsert({ event_id, member_id, on_date, status }));
    },
    async addReply(event_id, member_id, body) { must(await sb.from("replies").insert({ event_id, member_id, body })); },
    async deleteReply(id) { must(await sb.from("replies").delete().eq("id", id)); },
    async setDone(event_id, on_date, member_id) {
      if (!member_id) must(await sb.from("chore_done").delete().match({ event_id, on_date }));
      else must(await sb.from("chore_done").upsert({ event_id, on_date, member_id }));
    },
  };
}

/* ---------------- Local demo backend (no server) ---------------- */
function demoBackend() {
  const KEY = "familyhub.demo.v1";
  const members = [["dad","Dad","#2f6f5e"],["mom","Mom","#b24a7a"],["anna","Anna","#3b6fb6"],["kevin","Kevin","#c07a1f"],["clara","Clara","#7a5cc0"],["fiona","Fiona","#c0503b"],["liam","Liam","#3b9aa3"]]
    .map(([id, name, color], i) => ({ id, name, color, sort: i + 1 }));
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db) db = { events: [], rsvps: [], replies: [], done: [] };
  const listeners = new Set();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} listeners.forEach((f) => f()); };
  return {
    name: "demo",
    async session() { return sessionStorage.getItem("fh.demo") === "1"; },
    async signIn(code) { if (code !== "demo") throw new Error("Demo code is “demo”."); sessionStorage.setItem("fh.demo", "1"); },
    async signOut() { sessionStorage.removeItem("fh.demo"); },
    async load() { return { members, ...JSON.parse(JSON.stringify(db)) }; },
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async saveEvent(ev) { const i = db.events.findIndex((e) => e.id === ev.id); const row = { created_at: new Date().toISOString(), ...ev }; if (i >= 0) db.events[i] = { ...db.events[i], ...ev }; else db.events.push(row); save(); },
    async deleteEvent(id) { db.events = db.events.filter((e) => e.id !== id); for (const k of ["rsvps", "replies", "done"]) db[k] = db[k].filter((r) => r.event_id !== id); save(); },
    async setRsvp(event_id, member_id, on_date, status) { db.rsvps = db.rsvps.filter((r) => !(r.event_id === event_id && r.member_id === member_id && r.on_date === on_date)); if (status) db.rsvps.push({ event_id, member_id, on_date, status }); save(); },
    async addReply(event_id, member_id, body) { db.replies.push({ id: uuid(), event_id, member_id, body, created_at: new Date().toISOString() }); save(); },
    async deleteReply(id) { db.replies = db.replies.filter((r) => r.id !== id); save(); },
    async setDone(event_id, on_date, member_id) { db.done = db.done.filter((r) => !(r.event_id === event_id && r.on_date === on_date)); if (member_id) db.done.push({ event_id, on_date, member_id }); save(); },
  };
}

export async function createApi() {
  const demo = new URLSearchParams(location.search).has("demo") || !SUPABASE_URL;
  if (demo) return demoBackend();
  return supabaseBackend(); // never silently fall back to demo data when the real server is expected
}
export { uuid };
