// Date helpers and recurrence expansion.
const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const DAY = 864e5;

function shift(base, rec, k) {
  if (k === 0 || rec === "none") return new Date(base);
  if (rec === "daily") return addDays(base, k);
  if (rec === "weekly") return addDays(base, 7 * k);
  const months = rec === "yearly" ? 12 * k : k;
  const y = base.getFullYear(), m = base.getMonth() + months;
  const last = new Date(y, m + 1, 0).getDate(); // clamp Feb 29 / day 31
  return new Date(y, m, Math.min(base.getDate(), last), base.getHours(), base.getMinutes());
}

// Expand an event into occurrences intersecting [from, to].
export function occurrences(e, from, to) {
  const base = new Date(e.start_at);
  const rec = e.recurrence || "none";
  let span = 0; // ms length
  if (e.end_at) span = new Date(e.end_at) - base;
  const out = [];
  let k0 = 0;
  if (rec !== "none" && from > base) {
    const gap = from - base - span;
    if (rec === "daily") k0 = Math.floor(gap / DAY);
    else if (rec === "weekly") k0 = Math.floor(gap / (7 * DAY));
    else if (rec === "monthly") k0 = Math.floor(gap / (31 * DAY));
    else k0 = Math.floor(gap / (366 * DAY));
    k0 = Math.max(0, k0 - 1);
  }
  for (let k = k0; k < k0 + 800; k++) {
    const start = shift(base, rec, k);
    if (start > to) break;
    let end = new Date(start.getTime() + span);
    if (e.all_day) end = endOfDay(end); else if (!e.end_at) end = new Date(start.getTime() + 36e5);
    if (end >= from) out.push({ e, k, start, end, key: dayKey(start) });
    if (rec === "none") break;
  }
  return out;
}

export function occursOn(o, day) {
  return o.start <= endOfDay(day) && o.end >= startOfDay(day);
}

const fDay = (d) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const fTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export function whenText(o) {
  const { start, end, e } = o;
  if (e.all_day) return dayKey(start) === dayKey(end) ? fDay(start) : `${fDay(start)} – ${fDay(end)}`;
  if (dayKey(start) === dayKey(end)) return `${fDay(start)}, ${fTime(start)}${e.end_at ? " – " + fTime(end) : ""}`;
  return `${fDay(start)} ${fTime(start)} – ${fDay(end)} ${fTime(end)}`;
}
export const monthLabel = (d) => d.toLocaleDateString([], { month: "long", year: "numeric" });
export const dayLabel = (d) => d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
