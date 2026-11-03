/**
 * Quick fixture check for near-today homework grouping (no test runner).
 * Run: node scripts/verify-homework-near-today.mjs
 */
import {
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

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed.");
