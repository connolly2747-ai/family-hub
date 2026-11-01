import { createApi, uuid } from "./api.js";
import { CATEGORIES, catOf } from "./categories.js";
import { occurrences, occursOn, dayKey, parseKey, startOfDay, endOfDay, addDays, whenText, monthLabel, dayLabel } from "./dates.js";

const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
function toast(msg, action) { const t = document.getElementById("toast"); t.innerHTML = esc(msg) + (action ? ` <button class="sm" data-a="${action.a}" style="margin-left:8px">${esc(action.label)}</button>` : ""); t.classList.add("show"); t.style.pointerEvents = action ? "auto" : "none"; clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), action ? 7000 : 2600); }

let api, data = { members: [], events: [], rsvps: [], replies: [], done: [] };
const S = {
  authed: false, loaded: false, filtersOpen: false, view: (typeof innerWidth !== "undefined" && innerWidth < 700 ? "agenda" : "month"), cursor: startOfDay(new Date()), sel: startOfDay(new Date()),
  me: lsGet("fh.me", ""), person: "", cats: new Set(), modal: null, loginErr: "",
};
const member = (id) => data.members.find((m) => m.id === id);
const mname = (id) => (member(id) || { name: id }).name;

/* ---------------- filtering ---------------- */
function assignedTo(o) { // who this occurrence is for
  const e = o.e;
  if (e.category === "chore" && e.rotation && e.rotation.length) return [e.rotation[o.k % e.rotation.length]];
  return e.member_ids || [];
}
function visible(o) {
  if (S.cats.size && !S.cats.has(o.e.category)) return false;
  if (S.person) { const who = assignedTo(o); if (who.length && !who.includes(S.person)) return false; }
  return true;
}
function occsInRange(from, to) {
  const all = [];
  for (const e of data.events) for (const o of occurrences(e, from, to)) if (visible(o)) all.push(o);
  return all.sort((a, b) => a.start - b.start || a.e.title.localeCompare(b.e.title));
}

/* ---------------- rendering ---------------- */
const isToday = (k) => k === dayKey(new Date());
const dots = (ids) => ids.map((id) => `<span class="pdot" style="background:${(member(id) || {}).color || "#999"}" title="${esc(mname(id))}"></span>`).join("");
function filterCount() { return (S.person ? 1 : 0) + S.cats.size; }
function filtersHtml() {
  return `<div class="card filters">
    <div class="muted">Person</div>
    <div class="chips" style="margin:4px 0 12px">
      <span class="chip ${S.person === "" ? "on" : ""}" data-a="person" data-id="">Everyone</span>
      <span class="chip ${S.person === S.me ? "on" : ""}" data-a="person" data-id="${esc(S.me)}">Just me</span>
      ${data.members.filter((x) => x.id !== S.me).map((x) => `<span class="chip ${S.person === x.id ? "on" : ""}" data-a="person" data-id="${x.id}"><span class="dot" style="background:${x.color}"></span>${esc(x.name)}</span>`).join("")}
    </div>
    <div class="muted">Type</div>
    <div class="chips" style="margin-top:4px">
      ${Object.entries(CATEGORIES).map(([k, c]) => `<span class="chip ${S.cats.has(k) ? "on" : ""}" data-a="cat" data-id="${k}"><span class="dot" style="background:${c.color}"></span>${c.label}</span>`).join("")}
      ${S.cats.size || S.person ? `<span class="chip" data-a="clearfilters">Clear</span>` : ""}
    </div></div>`;
}

function render() {
  if (!S.loaded) { $app.innerHTML = `<div class="login"><p class="muted">Loading…</p></div>`; return; }
  if (!S.authed) return renderLogin();
  if (!S.me) return renderWho();
  const m = member(S.me), n = filterCount();
  const keep = document.getElementById("quickIn"); const qv = keep ? keep.value : "";
  $app.innerHTML = `
  <div class="wrap">
    <header class="top">
      <div><h1>Family Hub</h1><div class="muted">Hi <b>${esc(m ? m.name : S.me)}</b> · <a href="#" data-a="switch">not you?</a>${api.name === "demo" ? " · <b>demo mode</b>" : ""}</div></div>
      <div class="row tabs">
        <button data-a="view" data-v="agenda" class="${S.view === "agenda" ? "on" : ""}">Agenda</button>
        <button data-a="view" data-v="week" class="${S.view === "week" ? "on" : ""}">Week</button>
        <button data-a="view" data-v="month" class="${S.view === "month" ? "on" : ""}">Month</button>
        <button data-a="signout" class="ghost sm">Sign out</button>
      </div>
    </header>
    <div class="layout">
      <aside class="side ${S.filtersOpen ? "open" : ""}">${filtersHtml()}</aside>
      <section class="main">
        <form id="quick" class="row quick" style="flex-wrap:nowrap"><input id="quickIn" placeholder="Quick add: “Dinner Fri 6pm”, “Liam work tomorrow 4pm”" autocomplete="off" value="${esc(qv)}"><button class="primary" type="submit">Add</button></form>
        <div class="row spread" style="margin:10px 0"><button class="filterbtn" data-a="filters">${S.filtersOpen ? "Hide filters" : "Filter" + (n ? ` (${n})` : "")}</button>
          ${n ? `<span class="muted">Showing ${S.person ? esc(mname(S.person)) + "'s" : "everyone's"} ${S.cats.size ? [...S.cats].map((k) => catOf(k).label.toLowerCase()).join(", ") : "events"}</span>` : `<span></span>`}</div>
        ${S.view === "month" ? monthView() : S.view === "week" ? weekView() : agendaView()}
      </section>
    </div>
  </div>
  <button class="primary fab" data-a="new" aria-label="Add event">+ Add</button>`;
  if (keep && qv) { const el = document.getElementById("quickIn"); el.value = qv; }
}

function renderLogin() {
  $app.innerHTML = `<form class="login card stack" id="loginForm">
    <h1>Family Hub</h1><p class="muted">Enter the family code to continue.</p>
    <input id="code" type="password" autocomplete="current-password" placeholder="Family code" required autofocus>
    <div class="err">${esc(S.loginErr)}</div>
    <button class="primary" type="submit">Enter</button>
    ${api.name === "demo" ? `<p class="muted">Demo mode: the code is “demo”.</p>` : ""}
  </form>`;
}
function renderWho() {
  $app.innerHTML = `<div class="login card stack"><h1>Who's this?</h1><p class="muted">Pick your name so events show who added them.</p>
    <div class="chips" style="justify-content:center">${data.members.map((x) => `<span class="chip big" data-a="iam" data-id="${x.id}"><span class="dot" style="background:${x.color}"></span>${esc(x.name)}</span>`).join("")}</div></div>`;
}

function chip(o) {
  const c = catOf(o.e.category), who = assignedTo(o);
  const label = o.e.category === "chore" && who.length ? `${o.e.title} · ${mname(who[0])}` : o.e.title;
  return `<span class="ev" data-a="open" data-id="${o.e.id}" data-k="${o.key}" data-n="${o.k}" style="border-color:${c.color};background:${c.color}22" title="${esc(label)}">${doneFor(o) ? "✓ " : ""}${c.icon} ${esc(label)}</span>`;
}

function monthView() {
  const first = new Date(S.cursor.getFullYear(), S.cursor.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const occs = occsInRange(gridStart, endOfDay(addDays(gridStart, 41)));
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i), k = dayKey(d);
    const list = occs.filter((o) => occursOn(o, d));
    cells += `<div class="cell ${d.getMonth() !== first.getMonth() ? "out" : ""} ${isToday(k) ? "today" : ""} ${k === dayKey(S.sel) ? "sel" : ""}" data-a="day" data-k="${k}">
      <span class="n">${d.getDate()}</span>
      <div class="evs">${list.slice(0, 3).map(chip).join("")}${list.length > 3 ? `<div class="more">+${list.length - 3} more</div>` : ""}</div>
      <div class="cdots">${list.slice(0, 4).map((o) => `<span class="pdot" style="background:${catOf(o.e.category).color}"></span>`).join("")}</div></div>`;
  }
  const dayList = occs.filter((o) => occursOn(o, S.sel));
  return `<div class="row spread" style="margin-bottom:8px">
      <div class="row"><button data-a="prev" aria-label="Previous">‹</button><button data-a="today">Today</button><button data-a="next" aria-label="Next">›</button></div><h2>${monthLabel(first)}</h2></div>
    <div class="grid">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="dow">${d}</div>`).join("")}${cells}</div>
    <div class="card" id="daylist" style="margin-top:12px"><h3>${isToday(dayKey(S.sel)) ? "Today · " : ""}${dayLabel(S.sel)}</h3>${dayList.length ? dayList.map((o) => itemRow(o)).join("") : `<p class="muted">Nothing scheduled. Tap “+ Add” to plan something.</p>`}</div>`;
}

function weekView() {
  const start = addDays(S.sel, -S.sel.getDay());
  const occs = occsInRange(start, endOfDay(addDays(start, 6)));
  const cols = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = addDays(start, i), k = dayKey(d), list = occs.filter((o) => occursOn(o, d));
    return `<div class="card daycol ${isToday(k) ? "today" : ""}"><div class="dhead"><b>${d.toLocaleDateString([], { weekday: "short" })}</b> <span class="muted">${d.toLocaleDateString([], { month: "short", day: "numeric" })}</span></div>
      ${list.length ? list.map((o) => itemRow(o, true)).join("") : `<div class="muted">—</div>`}</div>`;
  }).join("");
  return `<div class="row spread" style="margin-bottom:8px"><div class="row"><button data-a="prev" aria-label="Previous week">‹</button><button data-a="today">This week</button><button data-a="next" aria-label="Next week">›</button></div>
    <h2>${start.toLocaleDateString([], { month: "short", day: "numeric" })} – ${addDays(start, 6).toLocaleDateString([], { month: "short", day: "numeric" })}</h2></div><div class="weekgrid">${cols}</div>`;
}

function agendaView() {
  const from = startOfDay(new Date()), to = endOfDay(addDays(from, 90));
  const occs = occsInRange(from, to);
  if (!occs.length) return `<div class="card"><h3>Nothing coming up</h3><p class="muted">Tap “+ Add”, or type in the quick-add box above, to put the first thing on the calendar.</p></div>`;
  const groups = new Map();
  for (const o of occs) { const k = dayKey(o.start < from ? from : o.start); (groups.get(k) || groups.set(k, []).get(k)).push(o); }
  const tomorrow = dayKey(addDays(from, 1));
  return [...groups].slice(0, 60).map(([k, list]) => `<div class="card" style="margin-bottom:10px"><h3>${k === dayKey(from) ? "Today" : k === tomorrow ? "Tomorrow" : ""}${k === dayKey(from) || k === tomorrow ? " · " : ""}${dayLabel(parseKey(k))}</h3>${list.map((o) => itemRow(o)).join("")}</div>`).join("");
}

function itemRow(o, compact) {
  const e = o.e, c = catOf(e.category), who = assignedTo(o), rs = rsvpsFor(o);
  const time = e.all_day ? "All day" : o.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (compact) return `<div class="item sm" data-a="open" data-id="${e.id}" data-k="${o.key}" data-n="${o.k}"><div class="bar" style="background:${c.color}"></div>
    <div class="t"><b>${doneFor(o) ? "✓ " : ""}${esc(e.title)}</b><div class="muted">${time} ${dots(who)}</div></div></div>`;
  return `<div class="item" data-a="open" data-id="${e.id}" data-k="${o.key}" data-n="${o.k}">
    <div class="bar" style="background:${c.color}"></div>
    <div class="t"><b>${c.icon} ${esc(e.title)}</b> ${doneFor(o) ? `<span class="pill going">done</span>` : ""}
      <div class="muted">${esc(whenText(o))}${e.place ? " · " + esc(e.place) : ""}</div>
      <div class="muted">${who.length ? dots(who) + " " + who.map(mname).map(esc).join(", ") + " · " : "Whole family · "}added by ${esc(mname(e.added_by))}${e.rsvp_enabled ? ` · ${rs.filter((r) => r.status === "going").length} going` : ""}</div></div></div>`;
}

/* ---------------- quick add ---------------- */
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function parseQuick(text) {
  let t = " " + text.trim() + " ", date = startOfDay(new Date()), hasTime = false, h = 18, mi = 0;
  const tm = t.match(/\s(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (tm) { h = Number(tm[1]) % 12 + (tm[3].toLowerCase() === "pm" ? 12 : 0); mi = Number(tm[2] || 0); hasTime = true; t = t.replace(tm[0], " "); }
  const dm = t.match(/\s(today|tonight|tomorrow|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\b/i) || null;
  if (dm) {
    const w = dm[1].toLowerCase();
    if (w === "tomorrow") date = addDays(date, 1);
    else if (w !== "today" && w !== "tonight") { const want = DAYS.indexOf(w.slice(0, 3)); let diff = (want - date.getDay() + 7) % 7; date = addDays(date, diff === 0 ? 7 : diff); }
    t = t.replace(dm[0], " ");
  } else { const nm = t.match(/\s(\d{1,2})\/(\d{1,2})\b/); if (nm) { date = new Date(date.getFullYear(), Number(nm[1]) - 1, Number(nm[2])); t = t.replace(nm[0], " "); } }
  const title = t.replace(/\s+/g, " ").replace(/\b(on|at)\s*$/i, "").trim();
  const low = title.toLowerCase();
  const category = /work|shift/.test(low) ? "work" : /dinner|lunch|breakfast|brunch|cook/.test(low) ? "meal" : /doctor|dentist|appointment|checkup|vet/.test(low) ? "appointment"
    : /birthday|anniversary/.test(low) ? "birthday" : /trip|vacation|flight/.test(low) ? "trip" : /school|class|exam|semester|college|home from/.test(low) ? "school"
    : /feed|trash|laundry|dishes|chore/.test(low) ? "chore" : "general";
  const c = catOf(category);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, mi);
  return { title, category, start_at: start.toISOString(), all_day: !hasTime && ["school", "birthday", "trip"].includes(category),
    rsvp_enabled: c.rsvp, replies_enabled: c.replies, recurrence: c.rec,
    member_ids: (() => { const named = data.members.filter((m) => new RegExp("\\b" + m.name + "\\b", "i").test(title)).map((m) => m.id);
      return named.length ? named : ["work", "school", "away", "appointment"].includes(category) ? [S.me] : []; })() };
}

/* ---------------- RSVP / chore helpers ---------------- */
const rsvpsFor = (o) => data.rsvps.filter((r) => r.event_id === o.e.id && r.on_date === o.key);
const doneFor = (o) => data.done.find((d) => d.event_id === o.e.id && d.on_date === o.key);
const invited = (e) => (e.member_ids && e.member_ids.length ? e.member_ids : data.members.map((m) => m.id));

/* ---------------- modals ---------------- */
function closeModal() { const d = document.querySelector("dialog[open]"); if (d) d.close(); S.modal = null; document.querySelectorAll("dialog").forEach((x) => x.remove()); }
function showModal(html) {
  document.querySelectorAll("dialog").forEach((x) => x.remove());
  const d = document.createElement("dialog"); d.innerHTML = html; document.body.appendChild(d);
  d.addEventListener("close", () => { d.remove(); S.modal = null; });
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  d.showModal(); return d;
}

function openDetail(id, key, k) {
  const e = data.events.find((x) => x.id === id); if (!e) return;
  S.modal = { type: "detail", id, key, k: Number(k) }; drawDetail();
}
function drawDetail() {
  const m = S.modal; if (!m || m.type !== "detail") return;
  const e = data.events.find((x) => x.id === m.id);
  if (!e) return closeModal();
  const o = occurrences(e, parseKey(m.key), endOfDay(parseKey(m.key))).find((x) => x.k === m.k) || { e, k: m.k, key: m.key, start: new Date(e.start_at), end: new Date(e.end_at || e.start_at) };
  const c = catOf(e.category), who = assignedTo(o), rs = rsvpsFor(o), mine = rs.find((r) => r.member_id === S.me);
  const replies = data.replies.filter((r) => r.event_id === e.id);
  const done = doneFor(o);
  const body = `
    <div class="row spread"><span class="pill" style="border-color:${c.color}">${c.icon} ${c.label}</span><button class="ghost sm" data-a="close">✕</button></div>
    <h2 style="margin:6px 0 2px">${esc(e.title)}</h2>
    <div class="muted">${esc(whenText(o))}${e.place ? " · " + esc(e.place) : ""}${e.recurrence !== "none" ? " · repeats " + e.recurrence : ""}</div>
    <div class="muted">${who.length ? "For " + who.map((x) => esc(mname(x))).join(", ") + " · " : "Whole family · "}added by ${esc(mname(e.added_by))}</div>
    ${e.notes ? `<p>${esc(e.notes).replace(/\n/g, "<br>")}</p>` : ""}
    ${e.category === "chore" ? `<div class="row" style="margin:10px 0"><b>${who.length ? esc(mname(who[0])) + "'s turn" : "Chore"}</b>
       <button class="sm ${done ? "" : "primary"}" data-a="done">${done ? `✓ Done by ${esc(mname(done.member_id))} (undo)` : "Mark done"}</button></div>` : ""}
    ${e.rsvp_enabled ? `<div style="margin:12px 0"><div class="muted">Are you going?</div><div class="row">
        ${["going", "maybe", "no"].map((s) => `<button class="rs sm ${s} ${mine && mine.status === s ? "on" : ""}" data-a="rsvp" data-s="${s}">${s === "no" ? "Can't go" : s[0].toUpperCase() + s.slice(1)}</button>`).join("")}</div>
        <div style="margin-top:6px">${rs.map((r) => `<span class="pill ${r.status}">${esc(mname(r.member_id))} · ${r.status === "no" ? "can't" : r.status}</span>`).join("")}
        ${(() => { const w = invited(e).filter((i) => !rs.some((r) => r.member_id === i)); return w.length ? `<div class="muted">Waiting on: ${w.map((i) => esc(mname(i))).join(", ")}</div>` : ""; })()}</div></div>` : ""}
    ${e.replies_enabled ? `<div style="margin-top:12px"><b>Replies</b>
        ${replies.map((r) => `<div class="reply"><b>${esc(mname(r.member_id))}</b> <span class="muted">${new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
           ${r.member_id === S.me ? `<button class="ghost sm" data-a="delreply" data-id="${r.id}">delete</button>` : ""}<div>${esc(r.body)}</div></div>`).join("") || `<div class="muted">No replies yet.</div>`}
        <form id="replyForm" class="row" style="margin-top:8px;flex-wrap:nowrap"><input id="replyBody" placeholder="Write a reply…" maxlength="1000" required><button class="primary" type="submit">Send</button></form></div>` : ""}
    <div class="row" style="margin-top:16px;justify-content:flex-end"><button data-a="edit">Edit</button><button data-a="delete">Delete</button></div>`;
  const open = document.querySelector("dialog[open]");
  if (open && open.dataset.kind === "detail") { const keep = open.querySelector("#replyBody"); const v = keep ? keep.value : ""; open.innerHTML = body; const nb = open.querySelector("#replyBody"); if (nb) nb.value = v; }
  else { const d = showModal(body); d.dataset.kind = "detail"; }
}

function openForm(ev, defaults = {}) {
  const e = ev || { id: uuid(), title: "", category: "general", start_at: null, end_at: null, all_day: false, place: "", notes: "", member_ids: [], rotation: [], recurrence: "none", rsvp_enabled: true, replies_enabled: true, added_by: S.me, ...defaults };
  S.modal = { type: "form", e: JSON.parse(JSON.stringify(e)), isNew: !ev };
  const f = S.modal.e;
  const d0 = f.start_at ? new Date(f.start_at) : S.sel, d1 = f.end_at ? new Date(f.end_at) : null;
  const t = (d) => (d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "");
  const html = `<form id="evForm" class="stack"><div class="row spread"><h2>${ev ? "Edit" : "Add"} event</h2><button type="button" class="ghost sm" data-a="close">✕</button></div>
    <div><label>Title</label><input id="f_title" required maxlength="120" value="${esc(f.title)}" placeholder="e.g. Liam works 4–10, Anna home from school"></div>
    <div class="grid2"><div><label>Type</label><select id="f_cat">${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}" ${f.category === k ? "selected" : ""}>${c.icon} ${c.label}</option>`).join("")}</select></div>
      <div><label>Repeats</label><select id="f_rec">${["none", "daily", "weekly", "monthly", "yearly"].map((r) => `<option ${f.recurrence === r ? "selected" : ""}>${r}</option>`).join("")}</select></div></div>
    <div><label>Who is this for? (none = whole family)</label><div class="chips" id="f_who">${data.members.map((m) => `<span class="chip ${f.member_ids.includes(m.id) ? "on" : ""}" data-a="fwho" data-id="${m.id}">${esc(m.name)}</span>`).join("")}</div></div>
    <div id="f_rotbox" ${f.category === "chore" ? "" : "hidden"}><label>Rotation order (tap in order; repeats each time)</label><div class="chips" id="f_rot">${data.members.map((m) => `<span class="chip ${f.rotation.includes(m.id) ? "on" : ""}" data-a="frot" data-id="${m.id}">${f.rotation.includes(m.id) ? f.rotation.indexOf(m.id) + 1 + ". " : ""}${esc(m.name)}</span>`).join("")}</div></div>
    <label style="display:flex;gap:8px;align-items:center;color:var(--ink);font-size:1rem"><input type="checkbox" id="f_all" style="width:auto" ${f.all_day ? "checked" : ""}> All day</label>
    <div class="grid2"><div><label>Start date</label><input type="date" id="f_sd" required value="${dayKey(d0)}"></div><div id="f_stbox" ${f.all_day ? "hidden" : ""}><label>Start time</label><input type="time" id="f_st" value="${f.start_at ? t(d0) : "18:00"}"></div>
      <div><label>End date (optional)</label><input type="date" id="f_ed" value="${d1 ? dayKey(d1) : ""}"></div><div id="f_etbox" ${f.all_day ? "hidden" : ""}><label>End time</label><input type="time" id="f_et" value="${d1 ? t(d1) : ""}"></div></div>
    <div><label>Where</label><input id="f_place" maxlength="120" value="${esc(f.place || "")}"></div>
    <details class="more-opts" ${f.notes || (!S.modal.isNew) ? "open" : ""}><summary class="muted" style="cursor:pointer">More options (notes, RSVPs, replies)</summary><div class="stack" style="margin-top:10px">
    <div><label>Notes</label><textarea id="f_notes" rows="3" maxlength="1000">${esc(f.notes || "")}</textarea></div>
    <div class="row"><label style="display:flex;gap:6px;align-items:center;color:var(--ink);font-size:.95rem"><input type="checkbox" id="f_rsvp" style="width:auto" ${f.rsvp_enabled ? "checked" : ""}> Ask for RSVPs</label>
      <label style="display:flex;gap:6px;align-items:center;color:var(--ink);font-size:.95rem"><input type="checkbox" id="f_rep" style="width:auto" ${f.replies_enabled ? "checked" : ""}> Allow replies</label></div></div></details>
    <div class="err" id="f_err"></div>
    <div class="row" style="justify-content:flex-end"><button type="button" data-a="close">Cancel</button><button class="primary" type="submit">Save</button></div></form>`;
  const d = showModal(html); d.dataset.kind = "form";
}

/* ---------------- actions ---------------- */
async function guarded(fn) { try { await fn(); } catch (err) { console.error(err); toast("Couldn't save: " + (err.message || err)); } }
async function refresh() { data = await api.load(); render(); if (S.modal && S.modal.type === "detail") drawDetail(); }

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-a]"); if (!el) return;
  const a = el.dataset.a;
  if (el.tagName === "A") ev.preventDefault();
  switch (a) {
    case "view": S.view = el.dataset.v; render(); break;
    case "prev": case "next": { const dir = a === "prev" ? -1 : 1;
      if (S.view === "week") { S.sel = addDays(S.sel, 7 * dir); S.cursor = S.sel; }
      else { S.cursor = new Date(S.cursor.getFullYear(), S.cursor.getMonth() + dir, 1); S.sel = S.cursor; }
      render(); break; }
    case "today": S.cursor = startOfDay(new Date()); S.sel = startOfDay(new Date()); render(); break;
    case "day": S.sel = parseKey(el.dataset.k); render(); if (innerWidth < 700) document.getElementById("daylist")?.scrollIntoView({ behavior: "smooth", block: "start" }); break;
    case "filters": S.filtersOpen = !S.filtersOpen; render(); break;
    case "clearfilters": S.person = ""; S.cats.clear(); render(); break;
    case "undo": if (S.lastDeleted) { const e = S.lastDeleted; S.lastDeleted = null; guarded(async () => { await api.saveEvent(e); await refresh(); toast("Restored (RSVPs and replies weren't kept)"); }); } break;
    case "person": S.person = el.dataset.id; render(); break;
    case "cat": S.cats.has(el.dataset.id) ? S.cats.delete(el.dataset.id) : S.cats.add(el.dataset.id); render(); break;
        case "iam": S.me = el.dataset.id; lsSet("fh.me", S.me); render(); break;
    case "switch": S.me = ""; lsSet("fh.me", ""); render(); break;
    case "signout": await api.signOut(); S.authed = false; render(); break;
    case "new": openForm(null); break;
    case "open": ev.stopPropagation(); openDetail(el.dataset.id, el.dataset.key || el.dataset.k, el.dataset.n); break;
    case "close": closeModal(); break;
    case "rsvp": { const m = S.modal; const cur = data.rsvps.find((r) => r.event_id === m.id && r.member_id === S.me && r.on_date === m.key); const s = el.dataset.s;
      guarded(async () => { await api.setRsvp(m.id, S.me, m.key, cur && cur.status === s ? null : s); await refresh(); }); break; }
    case "done": { const m = S.modal; const cur = data.done.find((d) => d.event_id === m.id && d.on_date === m.key);
      guarded(async () => { await api.setDone(m.id, m.key, cur ? null : S.me); await refresh(); }); break; }
    case "delreply": guarded(async () => { await api.deleteReply(el.dataset.id); await refresh(); }); break;
    case "edit": { const e = data.events.find((x) => x.id === S.modal.id); closeModal(); openForm(e); break; }
    case "delete": { const e = data.events.find((x) => x.id === S.modal.id);
      guarded(async () => { S.lastDeleted = JSON.parse(JSON.stringify(e)); await api.deleteEvent(e.id); closeModal(); await refresh(); toast("Event deleted", { a: "undo", label: "Undo" }); }); break; }
    case "fwho": { const f = S.modal.e; const id = el.dataset.id; f.member_ids = f.member_ids.includes(id) ? f.member_ids.filter((x) => x !== id) : [...f.member_ids, id]; el.classList.toggle("on"); break; }
    case "frot": { const f = S.modal.e; const id = el.dataset.id; f.rotation = f.rotation.includes(id) ? f.rotation.filter((x) => x !== id) : [...f.rotation, id];
      document.querySelectorAll("#f_rot .chip").forEach((c) => { const i = f.rotation.indexOf(c.dataset.id); c.classList.toggle("on", i >= 0); c.textContent = (i >= 0 ? i + 1 + ". " : "") + mname(c.dataset.id); }); break; }
  }
});

document.addEventListener("change", (ev) => {
  if (ev.target.id === "f_cat") {
    const c = catOf(ev.target.value), f = S.modal.e; f.category = ev.target.value;
    f.member_ids = ["work", "school", "away", "appointment"].includes(f.category) ? [S.me] : [];
    document.querySelectorAll("#f_who .chip").forEach((x) => x.classList.toggle("on", f.member_ids.includes(x.dataset.id)));
    document.getElementById("f_rsvp").checked = c.rsvp; document.getElementById("f_rep").checked = c.replies;
    document.getElementById("f_rec").value = c.rec; document.getElementById("f_rotbox").hidden = ev.target.value !== "chore";
    if (c.range) { document.getElementById("f_all").checked = true; document.getElementById("f_all").dispatchEvent(new Event("change", { bubbles: true })); }
  }
  if (ev.target.id === "f_all") { const on = ev.target.checked; document.getElementById("f_stbox").hidden = on; document.getElementById("f_etbox").hidden = on; }
});

document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (ev.target.id === "quick") {
    const txt = document.getElementById("quickIn").value.trim(); if (!txt) return;
    document.getElementById("quickIn").value = ""; const q = parseQuick(txt); S.sel = new Date(q.start_at); openForm(null, q); return;
  }
  if (ev.target.id === "loginForm") {
    const code = document.getElementById("code").value;
    try { await api.signIn(code); S.authed = true; S.loginErr = ""; await boot2(); } catch (err) { S.loginErr = err.message; renderLogin(); }
  } else if (ev.target.id === "replyForm") {
    const inp = document.getElementById("replyBody"), body = inp.value.trim(); if (!body) return; inp.value = "";
    guarded(async () => { await api.addReply(S.modal.id, S.me, body); await refresh(); });
  } else if (ev.target.id === "evForm") {
    const f = S.modal.e, g = (id) => document.getElementById(id), all = g("f_all").checked;
    const mk = (d, t) => (d ? new Date(`${d}T${all ? "00:00" : t || "00:00"}`) : null);
    const s = mk(g("f_sd").value, g("f_st").value); let en = mk(g("f_ed").value, g("f_et").value);
    if (!all && !en && g("f_et").value) en = mk(g("f_sd").value, g("f_et").value);
    if (en && en < s) { g("f_err").textContent = "End is before the start."; return; }
    if (f.category === "chore" && !f.rotation.length && !f.member_ids.length) { /* family-wide chore is fine */ }
    const row = { id: f.id, title: g("f_title").value.trim(), category: g("f_cat").value, start_at: s.toISOString(), end_at: en ? en.toISOString() : null, all_day: all,
      place: g("f_place").value.trim() || null, notes: g("f_notes").value.trim() || null, member_ids: f.member_ids, rotation: g("f_cat").value === "chore" ? f.rotation : [],
      recurrence: g("f_rec").value, rsvp_enabled: g("f_rsvp").checked, replies_enabled: g("f_rep").checked, added_by: S.modal.isNew ? S.me : f.added_by };
    guarded(async () => { await api.saveEvent(row); closeModal(); S.sel = startOfDay(s); S.cursor = startOfDay(s); await refresh(); toast("Saved"); });
  }
});

/* ---------------- boot ---------------- */
let unsub = null;
async function boot2() {
  data = await api.load();
  if (S.me && !member(S.me)) S.me = "";
  if (unsub) unsub();
  unsub = api.subscribe(() => refresh().catch(console.error));
  render();
}
(async function boot() {
  render();
  try {
    api = await createApi();
    S.authed = await api.session();
    S.loaded = true;
    if (S.authed) await boot2(); else render();
  } catch (err) {
    console.error(err);
    $app.innerHTML = `<div class="login card"><h2>Can't reach the server</h2><p class="muted">Check your connection and reload. (${esc(err.message || err)})</p></div>`;
  }
})();
