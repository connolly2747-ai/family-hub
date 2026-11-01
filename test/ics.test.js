const assert = require("assert");
const { buildIcs, expand, zonedToUtc } = require("../api/_ics");
const members = [{ id: "kevin", name: "Kevin" }, { id: "liam", name: "Liam" }, { id: "anna", name: "Anna" }, { id: "clara", name: "Clara" }];
const now = new Date("2026-11-01T18:00:00Z");

// 1. DST: a weekly 6pm New York event stays 6pm local across the Nov 1 2026 fall-back.
const weekly = { id: "w", title: "Weekly dinner", category: "meal", start_at: zonedToUtc(2026, 10, 28, 18, 0).toISOString(), end_at: null, all_day: false, member_ids: [], rotation: [], recurrence: "weekly" };
const occ = expand(weekly, new Date("2026-10-25T00:00:00Z"), new Date("2026-11-20T00:00:00Z"));
assert.strictEqual(occ[0].start.toISOString(), "2026-10-28T22:00:00.000Z"); // EDT = UTC-4
assert.strictEqual(occ[1].start.toISOString(), "2026-11-04T23:00:00.000Z"); // EST = UTC-5, still 6pm local
// 2. Chore rotation assigns in order and filters per person.
const chore = { id: "c", title: "Feed the cat", category: "chore", start_at: zonedToUtc(2026, 11, 4, 8, 0).toISOString(), end_at: null, all_day: false, member_ids: [], rotation: ["anna", "clara"], recurrence: "weekly" };
const clara = buildIcs({ events: [chore], members, memberId: "clara", memberName: "Clara", now });
assert.ok(clara.text.includes("Feed the cat (Clara)") && !clara.text.includes("Feed the cat (Anna)"));
// 3. A person only gets their own + whole-family events; scope=all gets everything.
const liamWork = { id: "l", title: "Liam work", category: "work", start_at: zonedToUtc(2026, 11, 5, 16, 0).toISOString(), end_at: zonedToUtc(2026, 11, 5, 22, 0).toISOString(), all_day: false, member_ids: ["liam"], rotation: [], recurrence: "none" };
assert.ok(!buildIcs({ events: [liamWork], members, memberId: "kevin", memberName: "Kevin", now }).text.includes("Liam work"));
assert.ok(buildIcs({ events: [liamWork], members, memberId: "kevin", memberName: "Kevin", scope: "all", now }).text.includes("Liam work"));
// 4. All-day multi-day range uses an exclusive DTEND; yearly birthday repeats; text is escaped and folded.
const trip = { id: "t", title: "Anna home, from school; yay", category: "school", start_at: zonedToUtc(2026, 12, 18, 0, 0).toISOString(), end_at: zonedToUtc(2026, 12, 22, 0, 0).toISOString(), all_day: true, member_ids: [], rotation: [], recurrence: "none", notes: "x".repeat(200) };
const out = buildIcs({ events: [trip], members, memberId: "kevin", memberName: "Kevin", now }).text;
assert.ok(out.includes("DTSTART;VALUE=DATE:20261218") && out.includes("DTEND;VALUE=DATE:20261223"));
assert.ok(out.includes("Anna home\\, from school\; yay"));
assert.ok(out.split("\r\n").every((l) => Buffer.byteLength(l) <= 75));
const bday = { id: "b", title: "Mom's birthday", category: "birthday", start_at: zonedToUtc(2020, 12, 3, 0, 0).toISOString(), end_at: null, all_day: true, member_ids: [], rotation: [], recurrence: "yearly" };
assert.ok(buildIcs({ events: [bday], members, memberId: "kevin", memberName: "Kevin", now }).text.includes("DTSTART;VALUE=DATE:20261203"));
// 5. Structure
assert.ok(out.startsWith("BEGIN:VCALENDAR") && out.trim().endsWith("END:VCALENDAR"));
console.log("ics tests passed");
