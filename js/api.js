// Data layer: one interface, two backends (Supabase for production, local demo for offline/testing).
import { SUPABASE_URL, SUPABASE_KEY, FAMILY_EMAIL } from "./config.js";

const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
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
      const [members, events, rsvps, replies, done, items, polls, votes, tokens, covers, tickets, ticketVotes, tasks, taskAssignees, cats, catFeedings] = await Promise.all([
        sb.from("members").select("*").order("sort"),
        sb.from("events").select("*").order("start_at"),
        sb.from("rsvps").select("*"),
        sb.from("replies").select("*").order("created_at"),
        sb.from("chore_done").select("*"),
        sb.from("list_items").select("*").order("created_at"),
        sb.from("polls").select("*").order("created_at", { ascending: false }),
        sb.from("votes").select("*"),
        sb.from("feed_tokens").select("*"),
        sb.from("chore_cover").select("*"),
        sb.from("tickets").select("*").order("created_at", { ascending: false }),
        sb.from("ticket_votes").select("*"),
        sb.from("tasks").select("*").order("created_at", { ascending: false }),
        sb.from("task_assignees").select("*"),
        sb.from("cats").select("*").order("sort"),
        sb.from("cat_feedings").select("*").gte("fed_on", new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)),
      ]);
      return { members: must(members), events: must(events), rsvps: must(rsvps), replies: must(replies), done: must(done),
        items: must(items), polls: must(polls), votes: must(votes), tokens: must(tokens), covers: must(covers), tickets: must(tickets), ticketVotes: must(ticketVotes), tasks: must(tasks), taskAssignees: must(taskAssignees), cats: must(cats), catFeedings: must(catFeedings) };
    },
    subscribe(cb) {
      let t;
      const ping = () => { clearTimeout(t); t = setTimeout(cb, 250); };
      const ch = sb.channel("family-hub");
      for (const table of ["events", "rsvps", "replies", "chore_done", "members", "list_items", "polls", "votes", "chore_cover", "tickets", "ticket_votes", "tasks", "task_assignees", "cats", "cat_feedings"])
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
    async addItem(list_name, text, added_by, note, assigned_to, needed_by) { must(await sb.from("list_items").insert({ list_name, text, added_by, note: note || null, assigned_to: assigned_to || null, assigned_by: assigned_to ? added_by : null, needed_by: needed_by || null })); },
    async updateItem(id, fields) { must(await sb.from("list_items").update(fields).eq("id", id)); },
    async setItemDone(id, done, by) { must(await sb.from("list_items").update({ done, done_by: done ? by : null }).eq("id", id)); },
    async deleteItem(id) { must(await sb.from("list_items").delete().eq("id", id)); },
    async clearDone(list_name) { must(await sb.from("list_items").update({ archived: true }).match({ list_name, done: true, archived: false })); },
    async requestCover(event_id, on_date, requested_by, note) { must(await sb.from("chore_cover").insert({ event_id, on_date, requested_by, note: note || null })); },
    async takeCover(event_id, on_date, member_id) {
      const rows = must(await sb.from("chore_cover").update({ covered_by: member_id, status: "covered" }).match({ event_id, on_date, status: "open" }).select());
      if (!rows.length) throw new Error("Someone else just took that shift.");
    },
    async releaseCover(event_id, on_date) { must(await sb.from("chore_cover").update({ covered_by: null, status: "open" }).match({ event_id, on_date })); },
    async cancelCover(event_id, on_date) { must(await sb.from("chore_cover").delete().match({ event_id, on_date })); },
    async logFeeding(fed_on, slot, grp, fed_by) { const r = await sb.from("cat_feedings").insert({ fed_on, slot, grp, fed_by }); if (r.error && r.error.code === "23505") throw new Error("Someone just logged that. Refreshing."); must(r); },
    async unlogFeeding(id) { must(await sb.from("cat_feedings").delete().eq("id", id)); },
    async saveCat(c) { must(await sb.from("cats").upsert(c)); },
    async deleteCat(id) { must(await sb.from("cats").delete().eq("id", id)); },
    async createTask(task, assignees) { const row = must(await sb.from("tasks").insert(task).select().single()); must(await sb.from("task_assignees").insert(assignees.map((member_id) => ({ task_id: row.id, member_id })))); },
    async updateTask(id, fields) { must(await sb.from("tasks").update(fields).eq("id", id)); },
    async deleteTask(id) { must(await sb.from("tasks").delete().eq("id", id)); },
    async setTaskStatus(task_id, member_id, status) { const now = new Date().toISOString(); const f = { status }; if (status === "seen") f.seen_at = now; if (status === "done") { f.done_at = now; } if (status !== "done") f.done_at = null; must(await sb.from("task_assignees").update(f).match({ task_id, member_id })); },
    async requestExtension(task_id, member_id, ext_date, ext_note) { must(await sb.from("task_assignees").update({ ext_status: "pending", ext_date, ext_note: ext_note || null }).match({ task_id, member_id })); },
    async decideExtension(task_id, member_id, approve, ext_date) { const f = approve ? { ext_status: "approved", due_override: ext_date } : { ext_status: "declined" }; must(await sb.from("task_assignees").update(f).match({ task_id, member_id })); },
    async addTicket(t) { must(await sb.from("tickets").insert(t)); },
    async setTicketStatus(id, status) { must(await sb.from("tickets").update({ status }).eq("id", id)); },
    async deleteTicket(id) { must(await sb.from("tickets").delete().eq("id", id)); },
    async ticketVote(ticket_id, member_id, on) { if (on) must(await sb.from("ticket_votes").upsert({ ticket_id, member_id })); else must(await sb.from("ticket_votes").delete().match({ ticket_id, member_id })); },
    async createPoll(question, options, created_by) { must(await sb.from("polls").insert({ question, options, created_by })); },
    async vote(poll_id, member_id, idx) {
      if (idx === null) must(await sb.from("votes").delete().match({ poll_id, member_id }));
      else must(await sb.from("votes").upsert({ poll_id, member_id, option_idx: idx }));
    },
    async setPollClosed(id, closed) { must(await sb.from("polls").update({ closed }).eq("id", id)); },
    async deletePoll(id) { must(await sb.from("polls").delete().eq("id", id)); },
    async resetToken(member_id) { const token = newToken(); must(await sb.from("feed_tokens").update({ token }).eq("member_id", member_id)); },
  };
}

/* ---------------- Local demo backend (no server) ---------------- */
function demoBackend() {
  const KEY = "familyhub.demo.v1";
  const members = [["dad","Dad","#2f6f5e"],["mom","Mom","#b24a7a"],["anna","Anna","#3b6fb6"],["kevin","Kevin","#c07a1f"],["clara","Clara","#7a5cc0"],["fiona","Fiona","#c0503b"],["liam","Liam","#3b9aa3"]]
    .map(([id, name, color], i) => ({ id, name, color, sort: i + 1 }));
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db) db = {};
  for (const k of ["events", "rsvps", "replies", "done", "items", "polls", "votes", "tokens", "covers", "tickets", "ticketVotes", "tasks", "taskAssignees", "cats", "catFeedings"]) db[k] = db[k] || [];
  if (!db.cats.length) db.cats = [["Sonoma","outdoor"],["Casper","outdoor"],["Meatloaf","indoor"],["Muffin","indoor"],["Felix","indoor"],["Tabitha","indoor"],["Totoro","indoor"],["Maverick","indoor"],["Cleo","indoor"]].map(([name, kind], i) => ({ id: uuid(), name, kind, notes: null, sort: i + 1 }));
  if (!db.tokens.length) db.tokens = members.map((m) => ({ member_id: m.id, token: newToken() }));
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
    async deleteEvent(id) { db.events = db.events.filter((e) => e.id !== id); for (const k of ["rsvps", "replies", "done", "covers"]) db[k] = db[k].filter((r) => r.event_id !== id); save(); },
    async setRsvp(event_id, member_id, on_date, status) { db.rsvps = db.rsvps.filter((r) => !(r.event_id === event_id && r.member_id === member_id && r.on_date === on_date)); if (status) db.rsvps.push({ event_id, member_id, on_date, status }); save(); },
    async addReply(event_id, member_id, body) { db.replies.push({ id: uuid(), event_id, member_id, body, created_at: new Date().toISOString() }); save(); },
    async deleteReply(id) { db.replies = db.replies.filter((r) => r.id !== id); save(); },
    async setDone(event_id, on_date, member_id) { db.done = db.done.filter((r) => !(r.event_id === event_id && r.on_date === on_date)); if (member_id) db.done.push({ event_id, on_date, member_id }); save(); },
    async addItem(list_name, text, added_by, note, assigned_to, needed_by) { db.items.push({ id: uuid(), list_name, text, note: note || null, archived: false, done: false, added_by, done_by: null, assigned_to: assigned_to || null, assigned_by: assigned_to ? added_by : null, needed_by: needed_by || null, created_at: new Date().toISOString() }); save(); },
    async updateItem(id, fields) { const i = db.items.find((x) => x.id === id); if (i) Object.assign(i, fields); save(); },
    async setItemDone(id, done, by) { const i = db.items.find((x) => x.id === id); if (i) { i.done = done; i.done_by = done ? by : null; } save(); },
    async deleteItem(id) { db.items = db.items.filter((x) => x.id !== id); save(); },
    async clearDone(list_name) { db.items.forEach((x) => { if (x.list_name === list_name && x.done) x.archived = true; }); save(); },
    async requestCover(event_id, on_date, requested_by, note) { if (db.covers.some((c) => c.event_id === event_id && c.on_date === on_date)) throw new Error("Already requested."); db.covers.push({ event_id, on_date, requested_by, covered_by: null, status: "open", note: note || null, created_at: new Date().toISOString() }); save(); },
    async takeCover(event_id, on_date, member_id) { const c = db.covers.find((x) => x.event_id === event_id && x.on_date === on_date && x.status === "open"); if (!c) throw new Error("Someone else just took that shift."); c.covered_by = member_id; c.status = "covered"; save(); },
    async releaseCover(event_id, on_date) { const c = db.covers.find((x) => x.event_id === event_id && x.on_date === on_date); if (c) { c.covered_by = null; c.status = "open"; } save(); },
    async cancelCover(event_id, on_date) { db.covers = db.covers.filter((x) => !(x.event_id === event_id && x.on_date === on_date)); save(); },
    async logFeeding(fed_on, slot, grp, fed_by) { if (db.catFeedings.some((x) => x.fed_on === fed_on && x.slot === slot && x.grp === grp)) throw new Error("Someone just logged that. Refreshing."); db.catFeedings.push({ id: uuid(), fed_on, slot, grp, fed_by, created_at: new Date().toISOString() }); save(); },
    async unlogFeeding(id) { db.catFeedings = db.catFeedings.filter((x) => x.id !== id); save(); },
    async saveCat(c) { const i = db.cats.findIndex((x) => x.id === c.id); if (i >= 0) db.cats[i] = { ...db.cats[i], ...c }; else db.cats.push({ id: uuid(), sort: db.cats.length + 1, ...c }); save(); },
    async deleteCat(id) { db.cats = db.cats.filter((x) => x.id !== id); save(); },
    async createTask(task, assignees) { const id = uuid(); db.tasks.unshift({ id, created_at: new Date().toISOString(), ...task }); assignees.forEach((m) => db.taskAssignees.push({ task_id: id, member_id: m, status: "assigned", seen_at: null, done_at: null, due_override: null, ext_status: null, ext_date: null, ext_note: null })); save(); },
    async updateTask(id, fields) { const t = db.tasks.find((x) => x.id === id); if (t) Object.assign(t, fields); save(); },
    async deleteTask(id) { db.tasks = db.tasks.filter((x) => x.id !== id); db.taskAssignees = db.taskAssignees.filter((x) => x.task_id !== id); save(); },
    async setTaskStatus(task_id, member_id, status) { const a = db.taskAssignees.find((x) => x.task_id === task_id && x.member_id === member_id); if (!a) return; a.status = status; if (status === "seen") a.seen_at = new Date().toISOString(); a.done_at = status === "done" ? new Date().toISOString() : null; save(); },
    async requestExtension(task_id, member_id, ext_date, ext_note) { const a = db.taskAssignees.find((x) => x.task_id === task_id && x.member_id === member_id); if (a) Object.assign(a, { ext_status: "pending", ext_date, ext_note: ext_note || null }); save(); },
    async decideExtension(task_id, member_id, approve, ext_date) { const a = db.taskAssignees.find((x) => x.task_id === task_id && x.member_id === member_id); if (a) { if (approve) { a.ext_status = "approved"; a.due_override = ext_date; } else a.ext_status = "declined"; } save(); },
    async addTicket(t) { db.tickets.unshift({ id: uuid(), status: "new", created_at: new Date().toISOString(), ...t }); save(); },
    async setTicketStatus(id, status) { const t = db.tickets.find((x) => x.id === id); if (t) t.status = status; save(); },
    async deleteTicket(id) { db.tickets = db.tickets.filter((x) => x.id !== id); db.ticketVotes = db.ticketVotes.filter((v) => v.ticket_id !== id); save(); },
    async ticketVote(ticket_id, member_id, on) { db.ticketVotes = db.ticketVotes.filter((v) => !(v.ticket_id === ticket_id && v.member_id === member_id)); if (on) db.ticketVotes.push({ ticket_id, member_id }); save(); },
    async createPoll(question, options, created_by) { db.polls.unshift({ id: uuid(), question, options, created_by, closed: false, created_at: new Date().toISOString() }); save(); },
    async vote(poll_id, member_id, idx) { db.votes = db.votes.filter((v) => !(v.poll_id === poll_id && v.member_id === member_id)); if (idx !== null) db.votes.push({ poll_id, member_id, option_idx: idx }); save(); },
    async setPollClosed(id, closed) { const p = db.polls.find((x) => x.id === id); if (p) p.closed = closed; save(); },
    async deletePoll(id) { db.polls = db.polls.filter((x) => x.id !== id); db.votes = db.votes.filter((v) => v.poll_id !== id); save(); },
    async resetToken(member_id) { const t = db.tokens.find((x) => x.member_id === member_id); if (t) t.token = newToken(); save(); },
  };
}

export async function createApi() {
  const demo = new URLSearchParams(location.search).has("demo") || !SUPABASE_URL;
  if (demo) return demoBackend();
  return supabaseBackend(); // never silently fall back to demo data when the real server is expected
}
export { uuid };
