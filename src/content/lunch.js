import browser from "webextension-polyfill";

export const SAGE_MENU_ID = "137389";
export const SAGE_MEAL = "Lunch";
export const SAGE_MENU_URL =
  "https://www.sagedining.com/sites/cincinnaticountryday/menu";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const SKIP_CATEGORIES = new Set([
  "exclude",
  "daily",
  "snack",
  "events",
  "today's menu features",
]);

/**
 * Shared in-memory week cache so home, timeline, and tour demos
 * reuse the same Sage payload without waiting on storage/network.
 * @type {Map<string, {
 *   monday: string,
 *   days: Record<string, ReturnType<typeof normalizeSageDay>>,
 *   fetchedAt: number,
 *   error?: string
 * }>}
 */
const memoryWeekCache = new Map();

/** @type {Map<string, Promise<{
 *   monday: string,
 *   days: Record<string, ReturnType<typeof normalizeSageDay>>,
 *   error?: string
 * }>>} */
const inflightWeekLoads = new Map();

/**
 * @param {Date} date
 */
export function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * @param {Date} date
 */
export function toSageDate(date) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const y = date.getFullYear();
  return `${m}/${d}/${y}`;
}

/**
 * Monday of the week containing `date` (local).
 * @param {Date} date
 */
export function weekMonday(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 Sun … 6 Sat
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d;
}

/**
 * @param {Date} monday
 */
export function weekdaysFromMonday(monday) {
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
    d.setDate(d.getDate() + i);
    return d;
  });
}

function cacheKey(mondayIso) {
  // v4: rotating concept stations (Craft BBQ, Uncharted, Trattoria, …)
  return `vch_lunch_week_v4_${mondayIso}`;
}

/**
 * Always-on stations that are not the main By Concept / special line.
 */
const SUPPORT_STATION = new RegExp(
  [
    "free style",
    "improvisations",
    "classic cuts",
    "ladle",
    "p\\.s\\.",
    "splashes",
    "seasonings",
    "daily offering",
    "main ingredient",
  ].join("|"),
  "i",
);

/**
 * @param {unknown} item
 */
function itemStations(item) {
  if (!item || typeof item !== "object") return [];
  const names = [];
  const display = String(item.displayStation || "").trim();
  if (display) names.push(display);
  for (const station of item.stations || []) {
    const name = String(station?.name || "").trim();
    if (name) names.push(name);
  }
  return names;
}

/**
 * @param {string} stationName
 */
function isSupportStation(stationName) {
  return SUPPORT_STATION.test(String(stationName || ""));
}

/**
 * Featured concept station from Sage "Today's Menu Features" (e.g. Craft BBQ).
 * @param {Record<string, unknown>} raw
 * @returns {string[]}
 */
function featuredStationNames(raw) {
  const list = raw["Today's Menu Features"];
  if (!Array.isArray(list)) return [];
  /** @type {string[]} */
  const names = [];
  for (const item of list) {
    for (const name of itemStations(item)) {
      if (name && !isSupportStation(name) && !names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * @param {Record<string, unknown>} raw
 */
function collectAllStationMenus(raw) {
  /** @type {Map<string, { station: string, categories: { name: string, items: string[] }[], entrees: string[] }>} */
  const byStation = new Map();

  for (const [category, list] of Object.entries(raw)) {
    if (!Array.isArray(list) || !list.length) continue;
    if (SKIP_CATEGORIES.has(String(category).toLowerCase())) continue;

    for (const item of list) {
      const title = String(item?.name || "").trim();
      if (!title) continue;
      const stations = itemStations(item);
      if (!stations.length) continue;

      for (const stationName of stations) {
        let menu = byStation.get(stationName);
        if (!menu) {
          menu = { station: stationName, categories: [], entrees: [] };
          byStation.set(stationName, menu);
        }
        let cat = menu.categories.find((entry) => entry.name === category);
        if (!cat) {
          cat = { name: category, items: [] };
          menu.categories.push(cat);
        }
        if (!cat.items.includes(title)) cat.items.push(title);
        if (/entr/i.test(category) && !menu.entrees.includes(title)) {
          menu.entrees.push(title);
        }
      }
    }
  }

  return [...byStation.values()];
}

/**
 * Prefer Crossroads when it has entrées; else a featured rotating concept
 * (Craft BBQ, Uncharted); else Trattoria / any other non-support station
 * with entrées. Never headline Free Style just because it sorts first.
 * @param {Record<string, unknown>} raw
 * @param {string} isoDate
 */
export function normalizeSageDay(raw, isoDate) {
  if (!raw || typeof raw !== "object") {
    return {
      date: isoDate,
      entrees: [],
      categories: [],
      primary: "",
      station: "",
    };
  }

  const featured = featuredStationNames(raw);
  const allMenus = collectAllStationMenus(raw);
  const conceptMenus = allMenus.filter(
    (menu) =>
      menu.categories.some((cat) => cat.items.length) &&
      !isSupportStation(menu.station),
  );
  const withEntrees = conceptMenus.filter((menu) => menu.entrees.length);

  const crossroads = withEntrees.find((menu) =>
    /crossroads/i.test(menu.station),
  );
  const featuredMenu = withEntrees.find((menu) =>
    featured.some((name) => name.toLowerCase() === menu.station.toLowerCase()),
  );
  const trattoria = withEntrees.find((menu) => /trattoria/i.test(menu.station));

  const chosen =
    crossroads ||
    featuredMenu ||
    trattoria ||
    withEntrees[0] ||
    conceptMenus.find((menu) => /crossroads/i.test(menu.station)) ||
    conceptMenus[0] ||
    null;

  if (!chosen) {
    /** @type {{ name: string, items: string[] }[]} */
    const categories = [];
    /** @type {string[]} */
    let entrees = [];
    for (const [name, list] of Object.entries(raw)) {
      if (!Array.isArray(list) || !list.length) continue;
      if (SKIP_CATEGORIES.has(String(name).toLowerCase())) continue;
      const items = list
        .map((item) => String(item?.name || "").trim())
        .filter(Boolean);
      if (!items.length) continue;
      categories.push({ name, items });
      if (/entr/i.test(name)) entrees = items;
    }
    return {
      date: isoDate,
      entrees,
      categories,
      primary: entrees[0] || categories[0]?.items[0] || "",
      station: "",
    };
  }

  let primary = chosen.entrees[0] || "";
  if (!primary) {
    const ranked = [...chosen.categories].sort((a, b) => {
      const score = (cat) =>
        /entr/i.test(cat.name) ? 0 : /special/i.test(cat.name) ? 1 : 2;
      return score(a) - score(b);
    });
    primary = ranked.find((cat) => cat.items[0])?.items[0] || "";
  }

  // Keep Crossroads condiments alongside Trattoria / other concept days.
  let categories = chosen.categories;
  if (!/crossroads/i.test(chosen.station)) {
    const crossroadsMenu = conceptMenus.find((menu) =>
      /crossroads/i.test(menu.station),
    );
    if (crossroadsMenu?.categories?.length) {
      const seen = new Set(
        categories.flatMap((cat) =>
          cat.items.map((item) => item.toLowerCase()),
        ),
      );
      const extras = crossroadsMenu.categories
        .map((cat) => ({
          name: cat.name,
          items: cat.items.filter((item) => !seen.has(item.toLowerCase())),
        }))
        .filter((cat) => cat.items.length);
      if (extras.length) categories = [...categories, ...extras];
    }
  }

  return {
    date: isoDate,
    entrees: chosen.entrees,
    categories,
    primary,
    station: chosen.station,
  };
}

async function fetchSageDay(date) {
  const url =
    `https://www.sagedining.com/microsites/getMenuItems` +
    `?menuId=${encodeURIComponent(SAGE_MENU_ID)}` +
    `&date=${encodeURIComponent(toSageDate(date))}` +
    `&meal=${encodeURIComponent(SAGE_MEAL)}`;

  const result = await browser.runtime.sendMessage({
    type: "VCH_FETCH",
    url,
    as: "json",
    credentials: "omit",
  });

  if (!result?.ok) {
    throw new Error(result?.error || "Sage request failed");
  }
  return normalizeSageDay(result.data, toIsoDate(date));
}

/**
 * Sync peek at the shared memory cache (no storage/network).
 * @param {Date} [anchor]
 * @returns {{
 *   monday: string,
 *   days: Record<string, ReturnType<typeof normalizeSageDay>>,
 *   fetchedAt: number,
 *   error?: string
 * } | null}
 */
export function peekLunchWeek(anchor = new Date()) {
  const mondayIso = toIsoDate(weekMonday(anchor));
  const cached = memoryWeekCache.get(mondayIso);
  if (!cached) return null;
  return cached;
}

/**
 * Load Mon–Fri menus for the week containing `anchor`.
 * Memory → local storage → network, with in-flight dedupe so home/timeline/tour
 * share one fetch.
 * @param {Date} [anchor]
 * @returns {Promise<{
 *   monday: string,
 *   days: Record<string, ReturnType<typeof normalizeSageDay>>,
 *   error?: string
 * }>}
 */
export async function loadLunchWeek(anchor = new Date()) {
  const monday = weekMonday(anchor);
  const mondayIso = toIsoDate(monday);
  const key = cacheKey(mondayIso);

  const mem = memoryWeekCache.get(mondayIso);
  if (mem && Date.now() - mem.fetchedAt < CACHE_TTL_MS) {
    return { monday: mem.monday, days: mem.days, error: mem.error };
  }

  const pending = inflightWeekLoads.get(mondayIso);
  if (pending) return pending;

  const loadPromise = (async () => {
    try {
      const stored = await browser.storage.local.get(key);
      const cached = stored[key];
      if (
        cached &&
        cached.fetchedAt &&
        Date.now() - cached.fetchedAt < CACHE_TTL_MS &&
        cached.days &&
        typeof cached.days === "object"
      ) {
        const payload = {
          monday: mondayIso,
          days: cached.days,
          fetchedAt: cached.fetchedAt,
          error: cached.error,
        };
        memoryWeekCache.set(mondayIso, payload);
        return {
          monday: payload.monday,
          days: payload.days,
          error: payload.error,
        };
      }
    } catch {
      // ignore cache read errors
    }

    /** @type {Record<string, ReturnType<typeof normalizeSageDay>>} */
    const days = {};
    const errors = [];

    await Promise.all(
      weekdaysFromMonday(monday).map(async (date) => {
        const iso = toIsoDate(date);
        try {
          days[iso] = await fetchSageDay(date);
        } catch (error) {
          errors.push(error?.message || "fetch failed");
          days[iso] = {
            date: iso,
            entrees: [],
            categories: [],
            primary: "",
            station: "",
          };
        }
      }),
    );

    const payload = {
      monday: mondayIso,
      days,
      fetchedAt: Date.now(),
      error: errors.length ? errors[0] : undefined,
    };

    memoryWeekCache.set(mondayIso, payload);

    try {
      await browser.storage.local.set({ [key]: payload });
    } catch {
      // ignore cache write errors
    }

    return {
      monday: payload.monday,
      days: payload.days,
      error: payload.error,
    };
  })();

  inflightWeekLoads.set(mondayIso, loadPromise);
  try {
    return await loadPromise;
  } finally {
    inflightWeekLoads.delete(mondayIso);
  }
}

/**
 * @param {string} isoDate YYYY-MM-DD
 */
export function parseIsoDate(isoDate) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * @param {Date} date
 */
export function formatLunchDayLabel(date) {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
