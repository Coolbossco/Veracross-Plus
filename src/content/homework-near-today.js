/**
 * Pure helpers for grouping / limiting homework relative to "today".
 * Used by the homepage widget and the what's-new tour preview.
 */

/**
 * @param {Date} [date]
 * @returns {Date}
 */
export function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Stable calendar key for a local date (YYYY-MM-DD), or "undated".
 * @param {Date | null | undefined} date
 * @returns {string}
 */
export function dayKey(date) {
  if (!date || Number.isNaN(date.getTime())) return "undated";
  const day = startOfDay(date);
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Heading for a calendar day relative to today.
 * @param {Date | null | undefined} date
 * @param {Date} [today]
 * @returns {string}
 */
export function formatDayHeading(date, today = startOfDay()) {
  if (!date || Number.isNaN(date.getTime())) return "No due date";
  const day = startOfDay(date);
  const base = startOfDay(today);
  const diffDays = Math.round((day.getTime() - base.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  return day.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * @param {{ dueDate?: Date | null, forcedPastDue?: boolean }} item
 * @param {Date} [today]
 * @returns {boolean}
 */
export function isPastDue(item, today = startOfDay()) {
  if (item.forcedPastDue) return true;
  if (!item.dueDate || Number.isNaN(item.dueDate.getTime())) return false;
  return item.dueDate < today;
}

/**
 * Upcoming / open future work: soonest due date first.
 * @template {{ dueDate?: Date | null, checked?: boolean, title?: string }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function sortUpcoming(items) {
  return [...items].sort((a, b) => {
    if (!!a.checked !== !!b.checked) return a.checked ? 1 : -1;
    const aTime = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

/**
 * Past due: closest to today first (most recently overdue), then older.
 * @template {{ dueDate?: Date | null, title?: string }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function sortPastDueNearToday(items) {
  return [...items].sort((a, b) => {
    const aTime = a.dueDate ? a.dueDate.getTime() : Number.NEGATIVE_INFINITY;
    const bTime = b.dueDate ? b.dueDate.getTime() : Number.NEGATIVE_INFINITY;
    if (aTime !== bTime) return bTime - aTime;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

/**
 * Split open items into past-due / upcoming relative to today, ordered for
 * display. When `limit` is set (tour preview), prefer soonest upcoming, then
 * fill with past-due nearest today, then completed.
 *
 * @template {{ dueDate?: Date | null, checked?: boolean, title?: string, forcedPastDue?: boolean }} T
 * @param {T[]} items
 * @param {{ limit?: number | null, now?: Date }} [opts]
 * @returns {{ pastDue: T[], upcoming: T[], completed: T[] }}
 */
export function groupHomeworkNearToday(items, { limit = null, now = new Date() } = {}) {
  const today = startOfDay(now);
  const open = items.filter((item) => !item.checked);
  const completed = sortUpcoming(items.filter((item) => item.checked));
  const pastDue = sortPastDueNearToday(
    open.filter((item) => isPastDue(item, today)),
  );
  const upcoming = sortUpcoming(
    open.filter((item) => !isPastDue(item, today)),
  );

  if (limit == null || limit <= 0) {
    return { pastDue, upcoming, completed };
  }

  const cap = Math.max(1, Math.floor(limit));
  const limitedUpcoming = [];
  const limitedPastDue = [];
  const limitedCompleted = [];

  for (const item of upcoming) {
    if (limitedUpcoming.length + limitedPastDue.length >= cap) break;
    limitedUpcoming.push(item);
  }
  for (const item of pastDue) {
    if (limitedUpcoming.length + limitedPastDue.length >= cap) break;
    limitedPastDue.push(item);
  }
  const openTaken = limitedUpcoming.length + limitedPastDue.length;
  for (const item of completed) {
    if (openTaken + limitedCompleted.length >= cap) break;
    limitedCompleted.push(item);
  }

  return {
    pastDue: limitedPastDue,
    upcoming: limitedUpcoming,
    completed: limitedCompleted,
  };
}

/**
 * @typedef {{
 *   dayKey: string,
 *   label: string,
 *   kind: "past-due" | "upcoming" | "undated" | "completed",
 *   items: unknown[]
 * }} HomeworkDayGroup
 */

/**
 * Bucket near-today ordered homework into calendar-day sections.
 * Past-due days come first (oldest → closest to today), then upcoming
 * days (soonest-first), then an optional Completed section.
 *
 * @template {{ dueDate?: Date | null, checked?: boolean, title?: string, forcedPastDue?: boolean }} T
 * @param {T[]} items
 * @param {{ limit?: number | null, now?: Date, includeCompleted?: boolean }} [opts]
 * @returns {{ dayGroups: Array<{ dayKey: string, label: string, kind: "past-due" | "upcoming" | "undated", items: T[] }>, completed: T[] }}
 */
export function groupHomeworkByCalendarDay(
  items,
  { limit = null, now = new Date(), includeCompleted = false } = {},
) {
  const today = startOfDay(now);
  const { pastDue, upcoming, completed } = groupHomeworkNearToday(items, {
    limit,
    now,
  });

  // pastDue items are nearest-today-first (for limit fill); reverse day
  // buckets so headings read oldest → Yesterday (closest last).
  const pastDueDays = bucketItemsByDay(pastDue, "past-due", today);
  pastDueDays.reverse();

  /** @type {Array<{ dayKey: string, label: string, kind: "past-due" | "upcoming" | "undated", items: T[] }>} */
  const dayGroups = [
    ...pastDueDays,
    ...bucketItemsByDay(upcoming, "upcoming", today),
  ];

  return {
    dayGroups,
    completed: includeCompleted ? completed : [],
  };
}

/**
 * @template {{ dueDate?: Date | null, title?: string }} T
 * @param {T[]} items
 * @param {"past-due" | "upcoming"} kind
 * @param {Date} today
 * @returns {Array<{ dayKey: string, label: string, kind: "past-due" | "upcoming" | "undated", items: T[] }>}
 */
function bucketItemsByDay(items, kind, today) {
  /** @type {Array<{ dayKey: string, label: string, kind: "past-due" | "upcoming" | "undated", items: T[] }>} */
  const groups = [];
  /** @type {Map<string, { dayKey: string, label: string, kind: "past-due" | "upcoming" | "undated", items: T[] }>} */
  const byKey = new Map();

  for (const item of items) {
    const key = dayKey(item.dueDate);
    let group = byKey.get(key);
    if (!group) {
      const groupKind = key === "undated" ? "undated" : kind;
      group = {
        dayKey: key,
        label: formatDayHeading(item.dueDate, today),
        kind: groupKind,
        items: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }

  return groups;
}
