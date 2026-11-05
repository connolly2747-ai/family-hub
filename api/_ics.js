// Pure calendar-feed builder (no network). Expands recurrence into explicit, time-zone-correct occurrences so
// a weekly 6pm event stays at 6pm local across daylight-saving changes, then renders RFC 5545 text.
const TZ = "America/New_York";

function parts(date, tz = TZ) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  const o = {}; for (const p of f.formatToParts(date)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
}
// Wall-clock time in tz -> real instant (handles DST).
function zonedToUtc(y, m, d, h, mi, tz = TZ) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const p = parts(new Date(guess), tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  let t = guess - (asUtc - guess);
  const p2 = parts(new Date(t), tz); // second pass near transitions
  const asUtc2 = Date.UTC(p2.y, p2.m - 1, p2.d, p2.h, p2.mi, p2.s);
  if (asUtc2 !== Date.UTC(y, m - 1, d, h, mi)) t += Date.UTC(y, m - 1, d, h, mi) - asUtc2;
  return new Date(t);
}
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function shiftDate(y, m, d, rec, k) {
  if (rec === "daily") { const t = new Date(Date.UTC(y, m - 1, d + k)); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; }
  if (rec === "weekly") { const t = new Date(Date.UTC(y, m - 1, d + 7 * k)); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; }
  const add = rec === "yearly" ? 12 * k : k; // monthly
  const tm = m - 1 + add, yy = y + Math.floor(tm / 12), mm = ((tm % 12) + 12) % 12 + 1;
  return [yy, mm, Math.min(d, daysIn(yy, mm))];
}

function expand(e, winStart, winEnd, tz = TZ) {
  const rec = e.recurrence || "none";
  const s0 = parts(new Date(e.start_at), tz);
  const dur = e.end_at ? new Date(e.end_at) - new Date(e.start_at) : (e.all_day ? 0 : 36e5);
  const e0 = e.end_at ? parts(new Date(e.end_at), tz) : s0;
  const spanDays = e.all_day ? Math.round((Date.UTC(e0.y, e0.m - 1, e0.d) - Date.UTC(s0.y, s0.m - 1, s0.d)) / 864e5) : 0;
  const out = [];
  for (let k = 0; k < 800; k++) {
    const [y, m, d] = rec === "none" ? [s0.y, s0.m, s0.d] : shiftDate(s0.y, s0.m, s0.d, rec, k);
    let start, end, startDate, endDate;
    if (e.all_day) {
      startDate = [y, m, d]; const ed = new Date(Date.UTC(y, m - 1, d + spanDays + 1)); endDate = [ed.getUTCFullYear(), ed.getUTCMonth() + 1, ed.getUTCDate()];
      start = zonedToUtc(y, m, d, 0, 0, tz); end = zonedToUtc(...endDate, 0, 0, tz);
    } else { start = zonedToUtc(y, m, d, s0.h, s0.mi, tz); end = new Date(start.getTime() + dur); }
    if (start > winEnd) break;
    if (end >= winStart) out.push({ k, start, end, allDay: !!e.all_day, startDate, endDate, dateKey: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` });
    if (rec === "none") break;
  }
  return out;
}

function assignee(e, k, cover) {
  const base = e.category === "chore" && e.rotation && e.rotation.length ? [e.rotation[k % e.rotation.length]] : e.member_ids || [];
  return cover && cover.status === "covered" ? base.map((id) => (id === cover.requested_by ? cover.covered_by : id)) : base;
}
const relevant = (e, k, memberId, cover) => { const who = assignee(e, k, cover); return !who.length || who.includes(memberId); };

const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fmtUtc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const fmtDate = ([y, m, d]) => `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
function fold(line) { // 75-octet folding
  const buf = Buffer.from(line, "utf8"); if (buf.length <= 75) return line;
  const chunks = []; let i = 0, first = true;
  while (i < buf.length) { let len = first ? 75 : 74; let end = Math.min(i + len, buf.length); while (end < buf.length && (buf[end] & 0xc0) === 0x80) end--; chunks.push(buf.slice(i, end).toString("utf8")); i = end; first = false; }
  return chunks.join("\r\n ");
}
const CAT_LABEL = { general: "Event", work: "Work", school: "School", away: "Away", holiday: "Holiday", chore: "Chore", appointment: "Appointment", birthday: "Birthday", meal: "Meal", trip: "Trip", movie: "Movie" };

function buildIcs({ events, members, covers = [], memberId, memberName, scope = "mine", now = new Date(), tz = TZ }) {
  const name = (id) => (members.find((m) => m.id === id) || { name: id }).name;
  const winStart = new Date(now.getTime() - 30 * 864e5), winEnd = new Date(now.getTime() + 365 * 864e5);
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Family Hub//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(scope === "all" ? "Family Hub (everyone)" : `Family Hub (${memberName})`)}`, `X-WR-TIMEZONE:${tz}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  let count = 0;
  for (const e of events) for (const o of expand(e, winStart, winEnd, tz)) {
    const cover = covers.find((c) => c.event_id === e.id && String(c.on_date).slice(0, 10) === o.dateKey);
    if (scope !== "all" && !relevant(e, o.k, memberId, cover)) continue;
    const who = assignee(e, o.k, cover).map(name);
    const title = e.category === "chore" && who.length ? `${e.title} (${who[0]})${cover && cover.status === "open" ? " NEEDS COVER" : ""}` : e.title;
    const desc = [e.notes, who.length ? `For: ${who.join(", ")}` : "For: whole family", "Open Family Hub to RSVP or reply."].filter(Boolean).join("\n");
    L.push("BEGIN:VEVENT", `UID:${e.id}-${o.k}@familyhub`, `DTSTAMP:${fmtUtc(now)}`);
    if (o.allDay) L.push(`DTSTART;VALUE=DATE:${fmtDate(o.startDate)}`, `DTEND;VALUE=DATE:${fmtDate(o.endDate)}`);
    else L.push(`DTSTART:${fmtUtc(o.start)}`, `DTEND:${fmtUtc(o.end)}`);
    L.push(`SUMMARY:${esc(title)}`);
    if (e.place) L.push(`LOCATION:${esc(e.place)}`);
    L.push(`DESCRIPTION:${esc(desc)}`, `CATEGORIES:${esc(CAT_LABEL[e.category] || "Event")}`, "TRANSP:" + (e.category === "work" || e.category === "appointment" ? "OPAQUE" : "TRANSPARENT"));
    // Reminders delivered by the person's own calendar app.
    L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`, o.allDay ? "TRIGGER:-PT15H" : "TRIGGER:-PT1H", "END:VALARM");
    if (e.rsvp_enabled && !o.allDay) L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc("Tomorrow: " + title)}`, "TRIGGER:-P1D", "END:VALARM");
    L.push("END:VEVENT"); count++;
  }
  L.push("END:VCALENDAR");
  return { text: L.map(fold).join("\r\n") + "\r\n", count };
}
module.exports = { buildIcs, expand, zonedToUtc, parts };
