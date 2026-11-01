import { createApi, uuid } from "./api.js";
import { ADMIN_IDS } from "./config.js";
import { CATEGORIES, catOf } from "./categories.js";
import { occurrences, occursOn, dayKey, parseKey, startOfDay, endOfDay, addDays, whenText, monthLabel, dayLabel } from "./dates.js";

const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
function toast(msg, action) { const t = document.getElementById("toast"); t.innerHTML = esc(msg) + (action ? ` <button class="sm" data-a="${action.a}" style="margin-left:8px">${esc(action.label)}</button>` : ""); t.classList.add("show"); t.style.pointerEvents = action ? "auto" : "none"; clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), action ? 7000 : 2600); }

let api, data = { members: [], events: [], rsvps: [], replies: [], done: [], items: [], polls: [], votes: [], tokens: [], covers: [], tickets: [], ticketVotes: [], tasks: [], taskAssignees: [] };
const S = {
  authed: false, loaded: false, filtersOpen: false, list: "Groceries", view: "home", cal: "month", wishKind: "wish", tasksTab: "mine", cursor: startOfDay(new Date()), sel: startOfDay(new Date()),
  me: lsGet("fh.me", ""), person: "", cats: new Set(), modal: null, loginErr: "",
};
const member = (id) => data.members.find((m) => m.id === id);
const mname = (id) => (member(id) || { name: id }).name;

/* ---------------- filtering ---------------- */
function baseWho(o) { // who the schedule says, before any cover
  const e = o.e;
  if (e.category === "chore" && e.rotation && e.rotation.length) return [e.rotation[o.k % e.rotation.length]];
  return e.member_ids || [];
}
const coverOf = (o) => data.covers.find((c) => c.event_id === o.e.id && c.on_date === o.key);
function assignedTo(o) { // who it is for right now
  const who = baseWho(o), c = coverOf(o);
  return c && c.status === "covered" ? who.map((id) => (id === c.requested_by ? c.covered_by : id)) : who;
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

function bottomNav() {
  const v = S.view, more = ["polls", "wishes"].includes(v);
  const b = (id, ic, label, on) => `<button data-a="nav" data-v="${id}" class="${on ? "on" : ""}" ${on ? 'aria-current="page"' : ""}><span class="ic">${ic}</span><span>${label}</span></button>`;
  return `<nav class="bottomnav" aria-label="Main">${b("home", "🏠", "Home", v === "home")}${b("calendar", "📅", "Calendar", v === "calendar")}
    <button class="addbtn" data-a="new" aria-label="Add event"><span class="ic">＋</span><span>Add</span></button>
    ${b("lists", "🛒", "Lists", v === "lists")}${b("tasks", "✅", "Tasks", v === "tasks")}<button data-a="menu" class="${more ? "on" : ""}"><span class="ic">⋯</span><span>More</span></button></nav>`;
}

function render() {
  if (!S.loaded) { $app.innerHTML = `<div class="login"><p class="muted">Loading…</p></div>`; return; }
  if (!S.authed) return renderLogin();
  if (!S.me) return renderWho();
  const m = member(S.me), n = filterCount();
  const keep = document.getElementById("quickIn"); const qv = keep ? keep.value : "";
  const home = S.view === "home", calv = S.view === "calendar", showQuick = home || calv;
  const body = home ? agendaView() : calv ? calToggle() + (S.cal === "week" ? weekView() : monthView()) : S.view === "lists" ? listsView() : S.view === "tasks" ? tasksView() : S.view === "polls" ? pollsView() : wishesView();
  const titles = { home: "Family Hub", calendar: "Calendar", lists: "Lists", tasks: "Tasks", polls: "Polls", wishes: "Feedback & wishes" };
  $app.innerHTML = `
  <div class="wrap">
    <header class="top">
      <div><h1>${titles[S.view] || "Family Hub"}</h1><div class="muted">Hi <b>${esc(m ? m.name : S.me)}</b> · <a href="#" data-a="switch">not you?</a>${api.name === "demo" ? " · <b>demo mode</b>" : ""}</div></div>
    </header>
    <div class="layout ${calv ? "" : "single"}">
      ${calv ? `<aside class="side ${S.filtersOpen ? "open" : ""}">${filtersHtml()}</aside>` : ""}
      <section class="main">
        ${showQuick ? `<form id="quick" class="row quick" style="flex-wrap:nowrap"><input id="quickIn" placeholder="Quick add: “Dinner Fri 6pm”, “Liam work tomorrow 4pm”" autocomplete="off" value="${esc(qv)}"><button class="primary" type="submit">Add</button></form>` : ""}
        ${calv ? `<div class="row spread" style="margin:10px 0"><button class="filterbtn" data-a="filters">${S.filtersOpen ? "Hide filters" : "Filter" + (n ? ` (${n})` : "")}</button>
          ${n ? `<span class="muted">Showing ${S.person ? esc(mname(S.person)) + "'s" : "everyone's"} ${S.cats.size ? [...S.cats].map((k) => catOf(k).label.toLowerCase()).join(", ") : "events"}</span>` : `<span></span>`}</div>`
          : home && n ? `<div class="row spread attnline"><span class="muted">Filters are on (set in Calendar)</span><button class="sm" data-a="clearfilters">Clear</button></div>` : `<div style="height:10px"></div>`}
        ${body}
      </section>
    </div>
  </div>
  ${bottomNav()}`;
  if (keep && qv) { const el = document.getElementById("quickIn"); if (el) el.value = qv; }
}
const calToggle = () => `<div class="row tabs" style="margin-bottom:10px"><button data-a="calmode" data-v="month" class="${S.cal === "month" ? "on" : ""}">Month</button><button data-a="calmode" data-v="week" class="${S.cal === "week" ? "on" : ""}">Week</button></div>`;

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
  const cv = coverOf(o);
  return `<span class="ev" data-a="open" data-id="${o.e.id}" data-k="${o.key}" data-n="${o.k}" style="border-color:${c.color};background:${c.color}22" title="${esc(label)}">${doneFor(o) ? "✓ " : ""}${cv && cv.status === "open" ? "⚠ " : ""}${c.icon} ${esc(label)}</span>`;
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

function agendaView() { return homeTasksHtml() + needsCoverHtml() + needsReplyHtml() + glanceHtml() + agendaBody(); }
function agendaBody() {
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
    <div class="t"><b>${c.icon} ${esc(e.title)}</b> ${doneFor(o) ? `<span class="pill going">done</span>` : ""}${(() => { const cv = coverOf(o); return cv ? (cv.status === "open" ? `<span class="pill no">needs cover</span>` : `<span class="pill maybe">covered by ${esc(mname(cv.covered_by))}</span>`) : ""; })()}
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

/* ---------------- "at a glance", reply-needed, lists, polls ---------------- */
const GLANCE = { work: "💼", school: "🎓", away: "✈️", trip: "🧳", appointment: "🩺" };
function occsAll(from, to) { const all = []; for (const e of data.events) all.push(...occurrences(e, from, to)); return all.sort((a, b) => a.start - b.start); }

function needsReplyHtml() {
  const from = startOfDay(new Date()), to = endOfDay(addDays(from, 30));
  const need = occsAll(from, to).filter((o) => o.e.rsvp_enabled && invited(o.e).includes(S.me) && !rsvpsFor(o).some((r) => r.member_id === S.me));
  if (!need.length) return "";
  return `<div class="card attn" style="margin-bottom:10px"><h3>${need.length} ${need.length === 1 ? "event needs" : "events need"} your reply</h3>
    ${need.slice(0, 4).map((o) => itemRow(o, true)).join("")}${need.length > 4 ? `<div class="muted">+${need.length - 4} more in the agenda</div>` : ""}</div>`;
}

function glanceHtml() {
  const from = startOfDay(new Date()), days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(from, i));
  const occs = occsAll(from, endOfDay(days[6])).filter((o) => GLANCE[o.e.category]);
  if (!occs.length) return "";
  const head = days.map((d) => `<th class="${isToday(dayKey(d)) ? "today" : ""}">${d.toLocaleDateString([], { weekday: "narrow" })}<div class="muted">${d.getDate()}</div></th>`).join("");
  const rows = data.members.map((m) => {
    const cells = days.map((d) => {
      const hit = occs.filter((o) => occursOn(o, d) && (() => { const who = assignedTo(o); return who.length ? who.includes(m.id) : ["away", "trip"].includes(o.e.category); })());
      const icons = [...new Set(hit.map((o) => GLANCE[o.e.category]))].join("");
      const tip = hit.map((o) => `${o.e.title} (${o.e.all_day ? "all day" : o.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`).join("; ");
      return `<td title="${esc(tip)}">${icons || `<span class="muted">·</span>`}</td>`;
    }).join("");
    return `<tr><th class="who"><span class="pdot" style="background:${m.color}"></span>${esc(m.name)}</th>${cells}</tr>`;
  }).join("");
  return `<div class="card" style="margin-bottom:10px"><h3>This week at a glance</h3><div class="muted" style="margin-bottom:6px">💼 work · 🎓 school · ✈️ away · 🧳 trip · 🩺 appointment</div>
    <div class="glance"><table><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

const LIST_DEFAULTS = ["Groceries", "To-do", "Packing"];
function listsView() {
  const names = [...new Set([...LIST_DEFAULTS, ...data.items.filter((i) => !i.archived).map((i) => i.list_name), S.list])];
  const chips = `<div class="chips" style="margin-bottom:10px">${names.map((n) => `<span class="chip ${n === S.list ? "on" : ""}" data-a="listsel" data-id="${esc(n)}">${esc(n)} <span class="muted">${data.items.filter((i) => i.list_name === n && !i.archived && !i.done).length || ""}</span></span>`).join("")}</div>`;
  if (S.list === "Groceries") return chips + groceryBody();
  const items = data.items.filter((i) => i.list_name === S.list && !i.archived).sort((a, b) => Number(a.done) - Number(b.done) || new Date(a.created_at) - new Date(b.created_at));
  const nd = items.filter((i) => i.done).length;
  return chips + `<div class="card"><form id="itemForm" class="row" style="flex-wrap:nowrap"><input id="itemIn" maxlength="200" placeholder="Add to ${esc(S.list)}…" autocomplete="off" required><button class="primary" type="submit">Add</button></form>
    <div style="margin-top:8px">${items.length ? items.map((i) => `<div class="item li ${i.done ? "dn" : ""}"><button class="sm ck" data-a="itemdone" data-id="${i.id}" aria-label="${i.done ? "Uncheck" : "Check"}">${i.done ? "✓" : ""}</button>
      <div class="t">${esc(i.text)}<div class="muted">${esc(mname(i.added_by))}${i.done && i.done_by ? " · done by " + esc(mname(i.done_by)) : ""}</div></div><button class="ghost sm" data-a="itemdel" data-id="${i.id}" aria-label="Remove">✕</button></div>`).join("") : `<p class="muted">Nothing here yet. Everyone sees changes instantly.</p>`}</div>
    ${nd ? `<div class="row" style="margin-top:8px"><button class="sm" data-a="clearlist">Clear ${nd} checked</button></div>` : ""}</div>
  <form id="newListForm" class="row" style="margin-top:12px;flex-wrap:nowrap"><input id="newListIn" maxlength="40" placeholder="New list (e.g. Costco, Trip to Maine)" autocomplete="off"><button type="submit">Create</button></form>`;
}

function pollsView() {
  const pollCards = data.polls.map((p) => {
    const vs = data.votes.filter((v) => v.poll_id === p.id), mine = vs.find((v) => v.member_id === S.me), total = vs.length || 1;
    return `<div class="card" style="margin-top:10px"><div class="row spread"><b>${esc(p.question)}</b>${p.closed ? `<span class="pill">closed</span>` : ""}</div>
      <div class="muted">asked by ${esc(mname(p.created_by))} · ${vs.length} ${vs.length === 1 ? "vote" : "votes"}</div>
      ${p.options.map((o, i) => { const c = vs.filter((v) => v.option_idx === i); return `<button class="opt ${mine && mine.option_idx === i ? "mine" : ""}" ${p.closed ? "disabled" : ""} data-a="vote" data-id="${p.id}" data-i="${i}">
        <span class="fill" style="width:${Math.round((c.length / total) * 100)}%"></span><span class="lbl">${esc(o)}</span><span class="cnt">${c.length}${c.length ? " · " + c.map((v) => esc(mname(v.member_id))).join(", ") : ""}</span></button>`; }).join("")}
      <div class="row" style="margin-top:8px"><button class="sm" data-a="closepoll" data-id="${p.id}">${p.closed ? "Reopen" : "Close poll"}</button><button class="sm" data-a="delpoll" data-id="${p.id}">Delete</button></div></div>`;
  }).join("");
  return `<div class="card"><h3>Ask the family</h3><form id="pollForm" class="stack" style="margin-top:8px"><input id="pq" maxlength="200" placeholder="Question, e.g. Which night for Christmas dinner?" required>
    <textarea id="po" rows="3" placeholder="One option per line (2 to 10)" required></textarea><button class="primary" type="submit">Create poll</button></form></div>${pollCards || `<p class="muted" style="margin-top:10px">No polls yet.</p>`}`;
}

/* ---------------- calendar sync, add-to-calendar, export ---------------- */
const myToken = () => (data.tokens.find((t) => t.member_id === S.me) || {}).token || "";
function feedUrls() {
  const base = location.origin + "/api/ics?token=" + myToken(), host = location.host;
  return { https: base, all: base + "&scope=all", webcal: "webcal://" + host + "/api/ics?token=" + myToken() };
}
function openSync() {
  const u = feedUrls(), demo = api.name === "demo", enc = encodeURIComponent;
  const row = (label, url, key) => `<div class="stack" style="margin-top:12px"><b>${label}</b>
    <div class="row" style="flex-wrap:nowrap"><input readonly value="${esc(url)}"><button data-a="copy" data-url="${esc(url)}">Copy</button></div>
    <div class="row"><a class="btnlink" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/r?cid=${enc(url.replace(/^https:/, "webcal:"))}">Add to Google Calendar</a>
      <a class="btnlink" target="_blank" rel="noopener" href="https://outlook.live.com/calendar/0/addfromweb?url=${enc(url)}&name=${enc(key)}">Add to Outlook</a>
      <a class="btnlink" href="${esc(url.replace(/^https:/, "webcal:"))}">Apple / other</a></div></div>`;
  const d = showModal(`<div class="row spread"><h2>Sync with your calendar</h2><button class="ghost sm" data-a="close">✕</button></div>
    <p class="muted">Your calendar app will show Family Hub events and add reminders (1 hour before, and 1 day before for dinners and trips). It's read-only: add and change events here.</p>
    ${demo ? `<p class="err">Demo mode: the calendar feed only works on the real site.</p>` : ""}
    ${row("Just my events (mine + whole-family)", u.https, "Family Hub (me)")}${row("Everyone's events", u.all, "Family Hub (everyone)")}
    <p class="muted" style="margin-top:12px">Updates take time to appear: Outlook checks every few hours, Google can take up to a day. This link is private, so don't post it publicly. If it leaks, reset it and the old link stops working.</p>
    <div class="row" style="margin-top:8px;justify-content:space-between"><button class="sm" data-a="resetlink">Reset my link</button><button data-a="close">Done</button></div>`);
  d.dataset.kind = "sync";
}
function openMenu() {
  const d = showModal(`<div class="row spread"><h2>More</h2><button class="ghost sm" data-a="close">✕</button></div>
    <div class="stack" style="margin-top:10px"><button data-a="nav" data-v="polls">📊 Polls</button><button data-a="nav" data-v="wishes">💡 Feedback &amp; wish list</button><button data-a="sync">📅 Sync with Google / Outlook / Apple calendar</button><button data-a="export">💾 Export everything (backup)</button>
    <button data-a="switch">👤 Switch person</button><button data-a="signout">Sign out</button></div>`);
  d.dataset.kind = "menu";
}
function exportData() {
  const { tokens, ...rest } = data;
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), ...rest }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `family-hub-backup-${dayKey(new Date())}.json`; document.body.appendChild(a); a.click(); a.remove();
  toast("Backup downloaded");
}
const gDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function calLinks(o) {
  const e = o.e, enc = encodeURIComponent, notes = (e.notes || "") + "\n(From Family Hub)";
  let gDates, oStart, oEnd, allday = "";
  if (e.all_day) { const ed = addDays(startOfDay(o.end), 1); gDates = `${dayKey(o.start).replace(/-/g, "")}/${dayKey(ed).replace(/-/g, "")}`; oStart = dayKey(o.start); oEnd = dayKey(ed); allday = "&allday=true"; }
  else { gDates = `${gDate(o.start)}/${gDate(o.end)}`; oStart = o.start.toISOString(); oEnd = o.end.toISOString(); }
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(e.title)}&dates=${gDates}&details=${enc(notes)}&location=${enc(e.place || "")}`;
  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=${enc(e.title)}&startdt=${enc(oStart)}&enddt=${enc(oEnd)}&body=${enc(notes)}&location=${enc(e.place || "")}${allday}`;
  return { google, outlook };
}
function downloadIcs(o) {
  const e = o.e, f = (d) => gDate(d), esc2 = (t) => String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const dt = e.all_day ? [`DTSTART;VALUE=DATE:${dayKey(o.start).replace(/-/g, "")}`, `DTEND;VALUE=DATE:${dayKey(addDays(startOfDay(o.end), 1)).replace(/-/g, "")}`] : [`DTSTART:${f(o.start)}`, `DTEND:${f(o.end)}`];
  const txt = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Family Hub//EN", "BEGIN:VEVENT", `UID:${e.id}-${o.k}@familyhub`, `DTSTAMP:${f(new Date())}`, ...dt, `SUMMARY:${esc2(e.title)}`, e.place ? `LOCATION:${esc2(e.place)}` : "", `DESCRIPTION:${esc2(e.notes)}`, "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n") + "\r\n";
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "text/calendar" })); a.download = e.title.replace(/[^\w]+/g, "-").slice(0, 40) + ".ics"; document.body.appendChild(a); a.click(); a.remove();
}


/* ---------------- chore cover ---------------- */
function needsCoverHtml() {
  const from = startOfDay(new Date()), to = endOfDay(addDays(from, 30));
  const open = occsAll(from, to).filter((o) => o.e.category === "chore" && coverOf(o) && coverOf(o).status === "open");
  if (!open.length) return "";
  const day = (o) => o.start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const row = (o) => { const c = coverOf(o), mine = c.requested_by === S.me;
    return `<div class="item sm"><div class="bar" style="background:${catOf("chore").color}"></div><div class="t" data-a="open" data-id="${o.e.id}" data-k="${o.key}" data-n="${o.k}"><b>${esc(o.e.title)}</b> · ${day(o)}
      <div class="muted">${mine ? "You asked for cover" : esc(mname(c.requested_by)) + " can't do this one"}${c.note ? ": " + esc(c.note) : ""}</div></div>
      ${mine ? `<button class="sm" data-a="covercancel" data-id="${o.e.id}" data-k="${o.key}">Cancel</button>` : `<button class="sm primary" data-a="covertake" data-id="${o.e.id}" data-k="${o.key}">I'll cover</button>`}</div>`; };
  const others = open.filter((o) => coverOf(o).requested_by !== S.me), mine = open.filter((o) => coverOf(o).requested_by === S.me);
  return `<div class="card attn" style="margin-bottom:10px"><h3>${others.length ? `${others.length} ${others.length === 1 ? "shift needs" : "shifts need"} cover` : "Your cover requests"}</h3>${others.map(row).join("")}${mine.map(row).join("")}</div>`;
}

/* ---------------- groceries ---------------- */
const AISLES = [["Produce", /apple|banana|lettuce|spinach|tomato|onion|potato|carrot|pepper|cucumber|avocado|lemon|lime|berr|grape|fruit|veg|garlic|broccoli|celery|mushroom|salad|herb|cilantro|orange|peach|melon|corn|zucchini|kale|pear|mango/],
  ["Dairy & eggs", /milk|cheese|butter|yogurt|cream|egg|creamer/], ["Meat & fish", /chicken|beef|pork|steak|bacon|sausage|turkey|ham\b|fish|salmon|shrimp|tuna|meat|burger/],
  ["Bakery", /bread|bagel|roll|bun|tortilla|muffin|cake|donut|pastry/], ["Frozen", /frozen|pizza|fries|waffle/], ["Drinks", /water|soda|juice|coffee|tea\b|beer|wine|seltzer|gatorade|lemonade/],
  ["Pantry", /rice|pasta|cereal|flour|sugar|oil|sauce|soup|bean|chip|snack|cracker|jelly|honey|spice|salt|oat|granola|cookie|nut|candy|mayo|ketchup|mustard/],
  ["Household", /paper|towel|tissue|soap|detergent|shampoo|toothpaste|trash|bag|foil|wrap|sponge|cleaner|battery|bulb|diaper|wipes/]];
function aisleOf(text) {
  const t = text.toLowerCase();
  if (/peanut butter|almond butter/.test(t)) return "Pantry";
  if (/ice cream/.test(t)) return "Frozen";
  for (const [name, re] of AISLES) if (re.test(t)) return name;
  return "Other";
}
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().replace(/s$/, "");
const openItem = (list, text) => data.items.find((i) => i.list_name === list && !i.archived && !i.done && norm(i.text) === norm(text));

function groceryBody() {
  const items = data.items.filter((i) => i.list_name === "Groceries" && !i.archived);
  const open = items.filter((i) => !i.done), done = items.filter((i) => i.done);
  const mineN = open.filter((i) => i.added_by === S.me).length;
  const counts = new Map();
  for (const i of data.items.filter((x) => x.list_name === "Groceries" && (x.archived || x.done))) { const k = norm(i.text); const c = counts.get(k) || { text: i.text, n: 0 }; c.n++; c.text = i.text; counts.set(k, c); }
  const often = [...counts.entries()].filter(([k]) => !openItem("Groceries", k)).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([, v]) => v);
  const groups = new Map(); for (const i of open) { const a = aisleOf(i.text); (groups.get(a) || groups.set(a, []).get(a)).push(i); }
  const order = [...AISLES.map((a) => a[0]), "Other"].filter((a) => groups.has(a));
  const row = (i) => `<div class="item li ${i.done ? "dn" : ""}"><button class="sm ck" data-a="itemdone" data-id="${i.id}" aria-label="${i.done ? "Put back" : "Got it"}">${i.done ? "✓" : ""}</button>
    <div class="t"><b>${esc(i.text)}</b>${i.note ? ` <span class="pill">${esc(i.note)}</span>` : ""}<div class="muted">${i.done ? "got by " + esc(mname(i.done_by || i.added_by)) + " · " : ""}requested by ${esc(mname(i.added_by))}</div></div><button class="ghost sm" data-a="itemdel" data-id="${i.id}" aria-label="Remove">✕</button></div>`;
  return `<div class="card"><div class="muted" style="margin-bottom:8px">${open.length ? `${open.length} to get · ${mineN} requested by you` : "Nothing requested right now."}</div>
    <form id="itemForm" class="row" style="flex-wrap:nowrap"><input id="itemIn" maxlength="200" placeholder="Request an item (e.g. oat milk)" autocomplete="off" required><input id="noteIn" maxlength="60" placeholder="Qty / note" style="max-width:34%" autocomplete="off"><button class="primary" type="submit">Request</button></form>
    ${often.length ? `<div class="muted" style="margin-top:10px">Often requested</div><div class="chips" style="margin-top:4px">${often.map((o) => `<span class="chip" data-a="readd" data-text="${esc(o.text)}">+ ${esc(o.text)}</span>`).join("")}</div>` : ""}</div>
    ${order.map((a) => `<div class="card" style="margin-top:10px"><h3>${a}</h3>${groups.get(a).map(row).join("")}</div>`).join("")}
    <form id="newListForm" class="row" style="margin-top:12px;flex-wrap:nowrap"><input id="newListIn" maxlength="40" placeholder="New list (e.g. Costco, Trip to Maine)" autocomplete="off"><button type="submit">Create</button></form>
    ${done.length ? `<div class="card" style="margin-top:10px"><div class="row spread"><h3>In the cart</h3><button class="sm" data-a="clearlist">Clear ${done.length} bought</button></div>${done.map(row).join("")}</div>` : ""}`;
}

/* ---------------- feedback & wish list ---------------- */
const TICKET_STATUS = { new: "New", planned: "Planned", in_progress: "In progress", done: "Done", declined: "Not planned" };
function wishesView() {
  const isAdmin = ADMIN_IDS.includes(S.me);
  const votes = (t) => data.ticketVotes.filter((v) => v.ticket_id === t.id);
  const rank = { new: 0, planned: 0, in_progress: 0, done: 1, declined: 1 };
  const list = [...data.tickets].sort((a, b) => rank[a.status] - rank[b.status] || votes(b).length - votes(a).length || new Date(b.created_at) - new Date(a.created_at));
  return `<div class="card"><h3>Tell us what's broken or what you wish it did</h3>
    <div class="chips" style="margin:8px 0"><span class="chip ${S.wishKind === "wish" ? "on" : ""}" data-a="wishkind" data-v="wish">💡 I wish it could…</span><span class="chip ${S.wishKind === "bug" ? "on" : ""}" data-a="wishkind" data-v="bug">🐞 Something's broken</span></div>
    <form id="wishForm" class="stack"><input id="wt" maxlength="120" required placeholder="${S.wishKind === "bug" ? "What went wrong? (short)" : "What should it do? (short)"}">
    <textarea id="wd" rows="3" maxlength="1000" placeholder="${S.wishKind === "bug" ? "What did you tap, what did you expect, what happened?" : "Any details that would help (optional)"}"></textarea>
    <button class="primary" type="submit">Send</button><div class="muted">We attach your screen size and browser to help fix bugs. Nothing else.</div></form></div>
    ${list.map((t) => { const vs = votes(t), mine = vs.some((v) => v.member_id === S.me), canDel = isAdmin || t.created_by === S.me;
      return `<div class="card ${t.status === "done" || t.status === "declined" ? "past" : ""}" style="margin-top:10px"><div class="row spread" style="align-items:flex-start;flex-wrap:nowrap"><div><b>${t.kind === "bug" ? "🐞" : "💡"} ${esc(t.title)}</b>
        ${t.details ? `<div style="margin:4px 0">${esc(t.details).replace(/\n/g, "<br>")}</div>` : ""}<div class="muted">${esc(mname(t.created_by))} · ${new Date(t.created_at).toLocaleDateString([], { month: "short", day: "numeric" })} · <span class="pill ${t.status === "done" ? "going" : t.status === "declined" ? "no" : "maybe"}">${TICKET_STATUS[t.status]}</span></div></div>
        <button class="sm ${mine ? "primary" : ""}" data-a="ticketvote" data-id="${t.id}">+1 · ${vs.length}</button></div>
        ${isAdmin || canDel ? `<div class="row" style="margin-top:8px">${isAdmin ? `<select data-a-change="ticketstatus" data-id="${t.id}" style="width:auto">${Object.entries(TICKET_STATUS).map(([k, v]) => `<option value="${k}" ${t.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>` : ""}${canDel ? `<button class="sm" data-a="ticketdel" data-id="${t.id}">Delete</button>` : ""}</div>` : ""}</div>`; }).join("") || `<p class="muted" style="margin-top:10px">Nothing yet. Be the first!</p>`}`;
}


/* ---------------- assigned tasks ---------------- */
const PRIO = { high: { label: "High", rank: 0, cls: "no" }, medium: { label: "Medium", rank: 1, cls: "maybe" }, low: { label: "Low", rank: 2, cls: "" } };
const todayKey = () => dayKey(new Date());
const asgOf = (t) => data.taskAssignees.filter((a) => a.task_id === t.id);
const effDue = (t, a) => (a && a.due_override) || t.due_date || "";
function dueText(due, done) {
  if (!due) return "No deadline";
  const d = parseKey(due), diff = Math.round((d - startOfDay(new Date())) / 864e5), nice = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  if (done) return `Was due ${nice}`;
  return diff < 0 ? `Overdue ${-diff}d (${nice})` : diff === 0 ? "Due today" : diff === 1 ? "Due tomorrow" : `Due ${nice}`;
}
const isOverdue = (due, done) => !done && due && due < todayKey();
function taskSort(a, b, who) {
  const aa = who ? asgOf(a).find((x) => x.member_id === who) : null, bb = who ? asgOf(b).find((x) => x.member_id === who) : null;
  return PRIO[a.priority].rank - PRIO[b.priority].rank || (effDue(a, aa) || "9999").localeCompare(effDue(b, bb) || "9999") || new Date(b.created_at) - new Date(a.created_at);
}
const taskOpen = (t) => asgOf(t).some((a) => a.status !== "done");

function homeTasksHtml() {
  const mine = data.tasks.filter((t) => asgOf(t).some((a) => a.member_id === S.me && a.status !== "done")).sort((a, b) => taskSort(a, b, S.me));
  const unseen = mine.filter((t) => asgOf(t).find((a) => a.member_id === S.me).status === "assigned").length;
  const decide = data.taskAssignees.filter((a) => a.ext_status === "pending" && (data.tasks.find((t) => t.id === a.task_id) || {}).assigned_by === S.me && a.member_id !== S.me);
  if (!mine.length && !decide.length) return "";
  const row = (t) => { const a = asgOf(t).find((x) => x.member_id === S.me), due = effDue(t, a);
    return `<div class="item sm" data-a="nav" data-v="tasks"><div class="bar" style="background:var(--${PRIO[t.priority].cls || "line"})"></div><div class="t"><b>${a.status === "assigned" ? "🆕 " : ""}${esc(t.title)}</b><div class="muted"><span class="${isOverdue(due, false) ? "overdue" : ""}">${dueText(due, false)}</span> · ${PRIO[t.priority].label} · from ${esc(mname(t.assigned_by))}</div></div></div>`; };
  return `<div class="card ${unseen || decide.length ? "attn" : ""}" style="margin-bottom:10px"><div class="row spread"><h3>Your tasks${unseen ? ` · ${unseen} new` : ""}</h3><button class="sm" data-a="nav" data-v="tasks">Open</button></div>
    ${decide.length ? `<div class="muted" style="margin:4px 0">${decide.length} deadline ${decide.length === 1 ? "request needs" : "requests need"} your answer</div>` : ""}${mine.slice(0, 3).map(row).join("")}${mine.length > 3 ? `<div class="muted">+${mine.length - 3} more</div>` : ""}</div>`;
}

function tasksView() {
  const tabs = [["mine", "To me"], ["assigned", "I assigned"], ["all", "Everyone"]];
  let list = data.tasks.filter((t) => S.tasksTab === "mine" ? asgOf(t).some((a) => a.member_id === S.me) : S.tasksTab === "assigned" ? t.assigned_by === S.me : true);
  const open = list.filter(taskOpen).sort((a, b) => taskSort(a, b, S.tasksTab === "mine" ? S.me : null)), done = list.filter((t) => !taskOpen(t)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return `<div class="row spread" style="margin-bottom:10px"><div class="row tabs">${tabs.map(([k, l]) => `<button data-a="taskstab" data-v="${k}" class="${S.tasksTab === k ? "on" : ""}">${l}</button>`).join("")}</div><button class="primary" data-a="tasknew">+ New task</button></div>
    ${open.map(taskCard).join("") || `<div class="card"><p class="muted">${S.tasksTab === "mine" ? "Nothing assigned to you. 🎉" : "No open tasks here."}</p></div>`}
    ${done.length ? `<h3 class="muted" style="margin:18px 0 0">Done</h3>${done.slice(0, 20).map(taskCard).join("")}` : ""}`;
}

function taskCard(t) {
  const asg = asgOf(t), byMe = t.assigned_by === S.me, allDone = asg.length && asg.every((a) => a.status === "done");
  const rows = asg.map((a) => { const due = effDue(t, a), mine = a.member_id === S.me, m = member(a.member_id) || { color: "#999" };
    const stat = a.status === "done" ? `<span class="pill going">done</span>` : a.status === "seen" ? `<span class="pill maybe">seen</span>` : `<span class="pill no">not seen yet</span>`;
    let acts = "";
    if (mine && a.status === "assigned") acts += `<button class="sm primary" data-a="taskseen" data-id="${t.id}" data-m="${a.member_id}">👀 I've seen this</button>`;
    if ((mine || byMe) && a.status !== "done") acts += `<button class="sm" data-a="taskdone" data-id="${t.id}" data-m="${a.member_id}">✓ ${mine ? "Done" : "Mark done"}</button>`;
    if ((mine || byMe) && a.status === "done") acts += `<button class="sm" data-a="taskreopen" data-id="${t.id}" data-m="${a.member_id}">Reopen</button>`;
    let ext = "";
    if (a.ext_status === "pending") ext = byMe && !mine
      ? `<div class="cover warn">${esc(mname(a.member_id))} asks to move this to <b>${dueText(a.ext_date, true).replace("Was due ", "")}</b>${a.ext_note ? ` — “${esc(a.ext_note)}”` : ""}<div class="row" style="margin-top:6px"><button class="sm primary" data-a="extapprove" data-id="${t.id}" data-m="${a.member_id}">Approve</button><button class="sm" data-a="extdecline" data-id="${t.id}" data-m="${a.member_id}">Decline</button></div></div>`
      : `<div class="muted">⏳ ${mine ? "Waiting for " + esc(mname(t.assigned_by)) + " to answer your request" : "Asked to move to " + dueText(a.ext_date, true).replace("Was due ", "")}</div>`;
    else if (a.ext_status === "declined" && mine) ext = `<div class="muted">${esc(mname(t.assigned_by))} kept the original deadline.</div>`;
    else if (a.ext_status === "approved" && a.due_override) ext = `<div class="muted">Deadline moved by ${esc(mname(t.assigned_by))}.</div>`;
    const ask = mine && a.status !== "done" && a.ext_status !== "pending" ? `<details class="cover"><summary>Need more time?</summary><div class="stack" style="margin-top:8px"><input type="date" id="xd-${t.id}" min="${todayKey()}"><input id="xn-${t.id}" maxlength="200" placeholder="Why? (optional)"><button class="sm primary" data-a="extreq" data-id="${t.id}" data-m="${a.member_id}">Ask for new deadline</button></div></details>` : "";
    return `<div class="arow"><div class="row"><span class="pdot" style="background:${m.color}"></span><b>${esc(mname(a.member_id))}${mine ? " (you)" : ""}</b>${stat}<span class="muted ${isOverdue(due, a.status === "done") ? "overdue" : ""}">${dueText(due, a.status === "done")}</span></div>
      ${acts ? `<div class="row" style="margin-top:6px">${acts}</div>` : ""}${ext}${ask}</div>`; }).join("");
  return `<div class="card task prio-${t.priority} ${allDone ? "past" : ""}" style="margin-top:10px"><div class="row spread" style="align-items:flex-start;flex-wrap:nowrap"><div><b>${esc(t.title)}</b>
      <div class="muted">from ${esc(mname(t.assigned_by))} · ${PRIO[t.priority].label} priority${t.due_date ? " · " + dueText(t.due_date, allDone) : ""}</div></div><span class="pill ${PRIO[t.priority].cls}">${PRIO[t.priority].label}</span></div>
    ${t.details ? `<p style="margin:6px 0">${esc(t.details).replace(/\n/g, "<br>")}</p>` : ""}${rows}
    ${byMe ? `<div class="row" style="margin-top:10px;justify-content:flex-end"><button class="sm" data-a="taskedit" data-id="${t.id}">Edit</button><button class="sm" data-a="taskdel" data-id="${t.id}">Delete</button></div>` : ""}</div>`;
}

function openTaskForm(t) {
  S.modal = { type: "task", t: t ? JSON.parse(JSON.stringify(t)) : { title: "", details: "", priority: "medium", due_date: "", assignees: [] }, isNew: !t };
  const f = S.modal.t;
  const d = showModal(`<form id="taskForm" class="stack"><div class="row spread"><h2>${t ? "Edit" : "New"} task</h2><button type="button" class="ghost sm" data-a="close">✕</button></div>
    <div><label>What needs doing?</label><input id="tf_title" required maxlength="120" value="${esc(f.title)}" placeholder="e.g. Clean the catio"></div>
    <div><label>Details (optional)</label><textarea id="tf_details" rows="3" maxlength="1000">${esc(f.details || "")}</textarea></div>
    ${t ? "" : `<div><label>Assign to</label><div class="chips" id="tf_who">${data.members.map((m) => `<span class="chip" data-a="tfwho" data-id="${m.id}"><span class="dot" style="background:${m.color}"></span>${esc(m.name)}</span>`).join("")}</div></div>`}
    <div><label>Priority</label><div class="chips" id="tf_prio">${["low", "medium", "high"].map((k) => `<span class="chip ${f.priority === k ? "on" : ""}" data-a="tfprio" data-id="${k}">${PRIO[k].label}</span>`).join("")}</div></div>
    <div><label>Deadline (optional)</label><input type="date" id="tf_due" value="${esc(f.due_date || "")}"></div>
    <div class="err" id="tf_err"></div><div class="row" style="justify-content:flex-end"><button type="button" data-a="close">Cancel</button><button class="primary" type="submit">${t ? "Save" : "Assign"}</button></div></form>`);
  d.dataset.kind = "taskform";
}

/* ---------------- RSVP / chore helpers ---------------- */
const rsvpsFor = (o) => data.rsvps.filter((r) => r.event_id === o.e.id && r.on_date === o.key);
const doneFor = (o) => data.done.find((d) => d.event_id === o.e.id && d.on_date === o.key);
const invited = (e) => (e.member_ids && e.member_ids.length ? e.member_ids : data.members.map((m) => m.id));

/* ---------------- modals ---------------- */
function closeModal() { const d = document.querySelector("dialog[open]"); S.dlg = null; if (d) d.close(); S.modal = null; document.querySelectorAll("dialog").forEach((x) => x.remove()); }
function showModal(html) {
  document.querySelectorAll("dialog").forEach((x) => x.remove());
  const d = document.createElement("dialog"); d.innerHTML = html; document.body.appendChild(d); S.dlg = d;
  // Only forget the modal state if THIS dialog is still the current one (an old dialog's late 'close' event must not wipe a newer form).
  d.addEventListener("close", () => { d.remove(); if (S.dlg === d) { S.modal = null; S.dlg = null; } });
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  d.showModal(); return d;
}

function openDetail(id, key, k) {
  const e = data.events.find((x) => x.id === id); if (!e) return;
  S.modal = { type: "detail", id, key, k: Number(k) }; drawDetail();
}
function coverBlock(o) {
  const cv = coverOf(o), base = baseWho(o), nm = (id) => esc(mname(id));
  const future = o.end >= new Date(Date.now() - 864e5);
  if (cv && cv.status === "open") return `<div class="cover warn">⚠ <b>${nm(cv.requested_by)}</b> can't do this one${cv.note ? ": " + esc(cv.note) : ""}.
    <div class="row" style="margin-top:6px">${cv.requested_by === S.me ? `<button class="sm" data-a="covercancel">Cancel request</button>` : `<button class="sm primary" data-a="covertake">I'll cover it</button>`}</div></div>`;
  if (cv) return `<div class="cover ok">✅ <b>${nm(cv.covered_by)}</b> is covering for ${nm(cv.requested_by)}.
    <div class="row" style="margin-top:6px">${cv.covered_by === S.me ? `<button class="sm" data-a="coverrelease">I can't after all</button>` : ""}${cv.requested_by === S.me ? `<button class="sm" data-a="covercancel">Take it back</button>` : ""}</div></div>`;
  if (future && base.includes(S.me)) return `<details class="cover"><summary>Can't make it? Ask for cover</summary><div class="row" style="margin-top:8px;flex-wrap:nowrap"><input id="coverNote" maxlength="100" placeholder="Optional note (e.g. out of town)"><button class="sm primary" data-a="coverreq">Ask</button></div></details>`;
  return "";
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
    ${e.category === "chore" ? coverBlock(o) : ""}
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
    <div style="margin-top:14px"><div class="muted">Add to your calendar</div><div class="row"><a class="btnlink" target="_blank" rel="noopener" href="${calLinks(o).google}">Google</a><a class="btnlink" target="_blank" rel="noopener" href="${calLinks(o).outlook}">Outlook</a><button class="sm" data-a="icsdl">Apple / .ics file</button></div></div>
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
    case "nav": closeModal(); S.view = el.dataset.v; window.scrollTo(0, 0); render(); break;
    case "calmode": S.cal = el.dataset.v; render(); break;
    case "taskstab": S.tasksTab = el.dataset.v; render(); break;
    case "tasknew": openTaskForm(null); break;
    case "taskedit": openTaskForm(data.tasks.find((x) => x.id === el.dataset.id)); break;
    case "taskdel": if (confirm("Delete this task for everyone?")) guarded(async () => { await api.deleteTask(el.dataset.id); await refresh(); toast("Task deleted"); }); break;
    case "tfwho": { const f = S.modal.t, id = el.dataset.id; f.assignees = f.assignees.includes(id) ? f.assignees.filter((x) => x !== id) : [...f.assignees, id]; el.classList.toggle("on"); break; }
    case "tfprio": S.modal.t.priority = el.dataset.id; document.querySelectorAll("#tf_prio .chip").forEach((c) => c.classList.toggle("on", c.dataset.id === el.dataset.id)); break;
    case "taskseen": case "taskdone": case "taskreopen": { const st = a === "taskseen" ? "seen" : a === "taskdone" ? "done" : "seen";
      guarded(async () => { await api.setTaskStatus(el.dataset.id, el.dataset.m, st); await refresh(); toast(a === "taskseen" ? "Got it. They'll see you've seen it." : a === "taskdone" ? "Marked done. Nice!" : "Reopened"); }); break; }
    case "extreq": { const id = el.dataset.id, m = el.dataset.m, date = (document.getElementById("xd-" + id) || {}).value, note = ((document.getElementById("xn-" + id) || {}).value || "").trim(); const t = data.tasks.find((x) => x.id === id);
      if (!date) { toast("Pick the new deadline first"); break; }
      guarded(async () => { await api.requestExtension(id, m, date, note); if (t.assigned_by === m) await api.decideExtension(id, m, true, date); await refresh(); toast(t.assigned_by === m ? "Deadline moved" : "Request sent to " + mname(t.assigned_by)); }); break; }
    case "extapprove": case "extdecline": { const a2 = data.taskAssignees.find((x) => x.task_id === el.dataset.id && x.member_id === el.dataset.m);
      guarded(async () => { await api.decideExtension(a2.task_id, a2.member_id, a === "extapprove", a2.ext_date); await refresh(); toast(a === "extapprove" ? "Deadline moved" : "Kept the original deadline"); }); break; }
    case "covertake": case "covercancel": case "coverrelease": case "coverreq": {
      const id = el.dataset.id || (S.modal && S.modal.id), key = el.dataset.k || (S.modal && S.modal.key); if (!id || !key) break;
      guarded(async () => {
        if (a === "covertake") await api.takeCover(id, key, S.me);
        else if (a === "covercancel") await api.cancelCover(id, key);
        else if (a === "coverrelease") await api.releaseCover(id, key);
        else await api.requestCover(id, key, S.me, (document.getElementById("coverNote") || {}).value ? document.getElementById("coverNote").value.trim() : "");
        await refresh(); toast(a === "covertake" ? "You're covering it. Thank you!" : a === "coverreq" ? "Cover requested. The family can see it on Home." : a === "coverrelease" ? "Released. It's open again." : "Done");
      }); break; }
    case "readd": { const t = el.dataset.text; const d = openItem("Groceries", t); if (d) { toast(`${t} is already requested by ${mname(d.added_by)}`); break; } guarded(async () => { await api.addItem("Groceries", t, S.me, ""); await refresh(); }); break; }
    case "wishkind": S.wishKind = el.dataset.v; render(); break;
    case "ticketvote": { const on = !data.ticketVotes.some((v) => v.ticket_id === el.dataset.id && v.member_id === S.me); guarded(async () => { await api.ticketVote(el.dataset.id, S.me, on); await refresh(); }); break; }
    case "ticketdel": if (confirm("Delete this?")) guarded(async () => { await api.deleteTicket(el.dataset.id); await refresh(); }); break;
    case "prev": case "next": { const dir = a === "prev" ? -1 : 1;
      if (S.cal === "week") { S.sel = addDays(S.sel, 7 * dir); S.cursor = S.sel; }
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
    case "switch": closeModal(); S.me = ""; lsSet("fh.me", ""); render(); break;
    case "signout": closeModal(); await api.signOut(); S.authed = false; render(); break;
    case "menu": openMenu(); break;
    case "sync": openSync(); break;
    case "export": exportData(); break;
    case "copy": try { await navigator.clipboard.writeText(el.dataset.url); toast("Link copied"); } catch { toast("Press and hold the link to copy it"); } break;
    case "resetlink": if (confirm("Reset your calendar link? The old link will stop working.")) guarded(async () => { await api.resetToken(S.me); await refresh(); openSync(); toast("New link created. Re-add it to your calendar."); }); break;
    case "icsdl": { const m = S.modal; const e = data.events.find((x) => x.id === m.id); const o = occurrences(e, parseKey(m.key), endOfDay(parseKey(m.key))).find((x) => x.k === m.k); if (o) downloadIcs(o); break; }
    case "listsel": S.list = el.dataset.id; render(); break;
    case "itemdone": { const it = data.items.find((x) => x.id === el.dataset.id); guarded(async () => { await api.setItemDone(it.id, !it.done, S.me); await refresh(); }); break; }
    case "itemdel": guarded(async () => { await api.deleteItem(el.dataset.id); await refresh(); }); break;
    case "clearlist": guarded(async () => { await api.clearDone(S.list); await refresh(); toast("Cleared"); }); break;
    case "vote": { const mine = data.votes.find((v) => v.poll_id === el.dataset.id && v.member_id === S.me); const i = Number(el.dataset.i); guarded(async () => { await api.vote(el.dataset.id, S.me, mine && mine.option_idx === i ? null : i); await refresh(); }); break; }
    case "closepoll": { const p = data.polls.find((x) => x.id === el.dataset.id); guarded(async () => { await api.setPollClosed(p.id, !p.closed); await refresh(); }); break; }
    case "delpoll": if (confirm("Delete this poll?")) guarded(async () => { await api.deletePoll(el.dataset.id); await refresh(); }); break;
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

document.addEventListener("focusin", (ev) => { if (ev.target.matches && ev.target.matches("input[readonly]")) ev.target.select(); });
document.addEventListener("change", (ev) => {
  const sel = ev.target.closest && ev.target.closest("[data-a-change=ticketstatus]");
  if (sel) { guarded(async () => { await api.setTicketStatus(sel.dataset.id, sel.value); await refresh(); toast("Status updated"); }); return; }
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
  if (ev.target.id === "itemForm") {
    const inp = document.getElementById("itemIn"), noteEl = document.getElementById("noteIn"), t = inp.value.trim(), note = noteEl ? noteEl.value.trim() : ""; if (!t) return;
    const d = openItem(S.list, t); if (d) { inp.value = ""; if (noteEl) noteEl.value = ""; toast(`${d.text} is already on the list (requested by ${mname(d.added_by)})`); return; }
    inp.value = ""; if (noteEl) noteEl.value = ""; guarded(async () => { await api.addItem(S.list, t, S.me, note); await refresh(); }); return; }
  if (ev.target.id === "taskForm") {
    const f = S.modal.t, title = document.getElementById("tf_title").value.trim(), details = document.getElementById("tf_details").value.trim(), due = document.getElementById("tf_due").value || null, err = document.getElementById("tf_err");
    if (!title) return; if (S.modal.isNew && !f.assignees.length) { err.textContent = "Pick at least one person."; return; }
    guarded(async () => { if (S.modal.isNew) await api.createTask({ title, details: details || null, assigned_by: S.me, priority: f.priority, due_date: due }, f.assignees);
      else await api.updateTask(f.id, { title, details: details || null, priority: f.priority, due_date: due });
      closeModal(); await refresh(); toast(S.modal === null ? "Saved" : "Saved"); }); return; }
  if (ev.target.id === "wishForm") {
    const title = document.getElementById("wt").value.trim(), details = document.getElementById("wd").value.trim(); if (!title) return;
    const context = `${S.view} · ${innerWidth}x${innerHeight} · ${navigator.userAgent}`.slice(0, 290);
    guarded(async () => { await api.addTicket({ kind: S.wishKind, title, details: details || null, context, created_by: S.me }); await refresh(); toast("Thanks! It's on the list."); }); return; }
  if (ev.target.id === "newListForm") { const n = document.getElementById("newListIn").value.trim(); if (!n) return; S.list = n; document.getElementById("newListIn").value = ""; render(); document.getElementById("itemIn")?.focus(); return; }
  if (ev.target.id === "pollForm") {
    const q = document.getElementById("pq").value.trim(), opts = document.getElementById("po").value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 10);
    if (opts.length < 2) { toast("Add at least two options, one per line"); return; }
    guarded(async () => { await api.createPoll(q, opts, S.me); await refresh(); toast("Poll created"); }); return;
  }
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
