/**
 * Quick fixture check for near-today homework grouping (no test runner).
 * Run: node scripts/verify-homework-near-today.mjs
 */
import {
  formatDayHeading,
  groupHomeworkByCalendarDay,
  groupHomeworkNearToday,
  isPastDue,
} from "../src/content/homework-near-today.js";

const today = new Date(2026, 10, 3); // Tue Nov 3, 2026

function d(y, m, day) {
  return new Date(y, m, day);
}

const yearList = [
  { title: "C'est la rentrée", dueDate: d(2026, 7, 19), checked: false },
  { title: "First Day of School!", dueDate: d(2026, 7, 19), checked: false },
  { title: "Faites une courte liste…", dueDate: d(2026, 7, 20), checked: false },
  { title: "What is Physics? - Essay", dueDate: d(2026, 7, 20), checked: false },
  { title: "Whirligig 'Lab'", dueDate: d(2026, 7, 21), checked: false },
  { title: "Midterm review", dueDate: d(2026, 9, 28), checked: false },
  { title: "Reading response", dueDate: d(2026, 10, 2), checked: false },
  { title: "Problem set 4", dueDate: d(2026, 10, 4), checked: false },
  { title: "Newton's Laws TEST", dueDate: d(2026, 10, 10), checked: false },
  { title: "Old quiz (done)", dueDate: d(2026, 8, 1), checked: true },
];

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  } else {
    console.log("ok:", msg);
  }
}

const limited = groupHomeworkNearToday(yearList, { limit: 5, now: today });
assert(
  limited.upcoming.map((i) => i.title).join("|") ===
    "Problem set 4|Newton's Laws TEST",
  "limit 5 prefers soonest upcoming near Nov 3, not August start-of-year",
);
assert(
  limited.pastDue.map((i) => i.title).join("|") ===
    "Reading response|Midterm review|Whirligig 'Lab'",
  "remaining slots fill with past-due nearest today (not Aug 19 first)",
);
assert(
  !limited.pastDue.some((i) => i.title.startsWith("C'est la")),
  "start-of-year August items are not selected when nearer past-due exist",
);
assert(
  limited.completed.length === 0,
  "completed not needed once open slots fill the cap",
);

const unlimited = groupHomeworkNearToday(yearList, { now: today });
assert(
  unlimited.upcoming[0].title === "Problem set 4",
  "unlimited upcoming starts at next due near today",
);
assert(
  unlimited.pastDue[0].title === "Reading response",
  "unlimited past-due nearest today first (Nov 2 before Aug)",
);
assert(
  isPastDue({ dueDate: d(2026, 7, 19) }, today) === true,
  "Aug 19 is past due on Nov 3",
);
assert(
  isPastDue({ dueDate: d(2026, 10, 3) }, today) === false,
  "due today is not past due",
);

const byDay = groupHomeworkByCalendarDay(yearList, {
  now: today,
  includeCompleted: true,
});
assert(
  byDay.sections.map((s) => s.title).join("|") === "Past due|Upcoming",
  "section labels are Past due then Upcoming",
);
assert(
  byDay.sections.map((s) => s.kind).join("|") === "past-due|upcoming",
  "section kinds are past-due then upcoming",
);
const pastDueSection = byDay.sections.find((s) => s.kind === "past-due");
const pastDueDays = pastDueSection?.days || [];
assert(
  pastDueDays.map((g) => g.dayKey).join("|") ===
    "2026-08-19|2026-08-20|2026-08-21|2026-10-28|2026-11-02",
  "past-due day groups are oldest-first, closest-to-today last",
);
assert(
  pastDueDays[0]?.dayKey === "2026-08-19" &&
    pastDueDays[0].items.map((i) => i.title).join("|") ===
      "C'est la rentrée|First Day of School!",
  "oldest past-due day leads (Aug 19)",
);
assert(
  pastDueDays.at(-1)?.label === "Yesterday" &&
    pastDueDays.at(-1).items.map((i) => i.title).join("|") ===
      "Reading response",
  "Yesterday is the last past-due day group (closest to today)",
);
assert(
  pastDueDays.some((g) => g.dayKey === "2026-08-19" && g.items.length === 2),
  "Aug 19 past-due items share one day heading",
);
assert(
  pastDueDays.some((g) => g.dayKey === "2026-08-20" && g.items.length === 2),
  "Aug 20 past-due items share one day heading",
);
const upcomingSection = byDay.sections.find((s) => s.kind === "upcoming");
const upcomingDays = upcomingSection?.days || [];
assert(
  upcomingDays[0]?.dayKey === "2026-11-04" &&
    upcomingDays[0].items[0].title === "Problem set 4",
  "upcoming day groups start with soonest due day",
);
assert(
  upcomingDays.map((g) => g.dayKey).join("|") === "2026-11-04|2026-11-10",
  "upcoming days ordered soonest-first",
);
assert(
  formatDayHeading(d(2026, 10, 3), today) === "Today",
  "formatDayHeading Today",
);
assert(
  formatDayHeading(d(2026, 10, 4), today) === "Tomorrow",
  "formatDayHeading Tomorrow",
);
assert(
  byDay.completed.length === 1 && byDay.completed[0].title === "Old quiz (done)",
  "completed section preserved when includeCompleted",
);

const limitedDays = groupHomeworkByCalendarDay(yearList, {
  limit: 5,
  now: today,
});
assert(
  limitedDays.sections.flatMap((s) => s.days.flatMap((g) => g.items)).length ===
    5,
  "day grouping respects the near-today limit",
);
// Limit prefers upcoming first, then fills with past-due nearest today;
// display still lists Past due section before Upcoming, oldest→newest days.
assert(
  limitedDays.sections[0]?.kind === "past-due" &&
    limitedDays.sections[1]?.kind === "upcoming",
  "sections still place Past due before Upcoming",
);
assert(
  (limitedDays.sections.find((s) => s.kind === "past-due")?.days || [])
    .map((g) => g.dayKey)
    .join("|") === "2026-08-21|2026-10-28|2026-11-02",
  "limited past-due days are oldest-first among the nearest filled slots",
);
assert(
  limitedDays.sections.find((s) => s.kind === "past-due")?.days.at(-1)
    ?.label === "Yesterday",
  "limited past-due days still end with closest overdue day (Yesterday)",
);
assert(
  (limitedDays.sections.find((s) => s.kind === "upcoming")?.days || [])
    .map((g) => g.dayKey)
    .join("|") === "2026-11-04|2026-11-10",
  "limited upcoming days are the soonest two",
);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed.");
