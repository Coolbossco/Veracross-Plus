# Veracross Plus - Cross-Browser Development Guide

Veracross Plus uses one Manifest V3 codebase and one build for both Chrome and
Firefox 140+. Firefox-specific settings are nested under
`browser_specific_settings`, which Chrome ignores.

## Build

Install dependencies and generate the shared unpacked extension:

```bash
npm install
npm run build
```

The generated extension is in `dist/`. The `build:chrome` and `build:firefox`
commands are aliases for the same build; they exist for convenience.

To build and launch the extension in a temporary browser profile, run:

```bash
npm run dev:chrome
npm run dev:firefox
```

The Firefox command targets Firefox Developer Edition. Close the temporary
browser to stop the command.

Run Firefox's extension validator with:

```bash
npm run lint:firefox
```

## Load as a developer extension

### Chrome

For an isolated test profile, run `npm run dev:chrome`. To load it in your
regular Chrome profile instead:

1. Run `npm run build`.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this project's `dist/` directory.

After rebuilding, click the extension's reload button on
`chrome://extensions/`.

### Firefox

For an isolated test profile, run `npm run dev:firefox`. To load it in your
regular Firefox Developer Edition profile instead:

1. Run `npm run build`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on**.
4. Select `dist/manifest.json`.
5. Allow optional technical and interaction data if you want analytics enabled
   during the test. The extension works without it.

Firefox removes temporary add-ons when the browser closes. After rebuilding,
click **Reload** for Veracross Plus on the debugging page.

## Browser compatibility

The source imports `webextension-polyfill` and uses APIs available in both
browsers: `storage`, `runtime`, `tabs`, `alarms`, and `notifications`. Firefox's
add-on ID keeps `storage.sync` stable, while its built-in optional data
permission controls analytics. Chrome retains the existing analytics behavior
because it does not implement Firefox's `data_collection` permission field.

## Project structure

```text
manifest.json                 Shared Chrome/Firefox Manifest V3 definition
docs/staged-rollout.md        CWS + Worker staged rollout runbook
rollout-worker/               Cloudflare Worker (read-only GET + KV)
src/content/content.js        Boot, observers, and feature flags
src/content/rollout.js        Worker beta-channel client
src/content/checklist.js      Homework / assessment checkboxes
src/content/custom-assignments.js  Custom rows, chips, and modals
src/content/homepage.js       Student home assignment widget
src/content/lunch.js          Sage Dining fetch + week cache
src/content/lunch-home.js     Draggable home lunch card
src/content/lunch-timeline.js Planner date-header lunch chips
src/content/theme.js          Theme apply + storage listener
src/content/theme-boot.js     Early theme boot (document_start)
src/content/storage.js        Sync storage defaults and helpers
src/content/styles.css        Content-script styles
src/themes/                   Curated theme packs + shared skin.css
src/popup/                    Conventional toolbar popup settings UI
src/options.html              Short note pointing at the toolbar popup
public/icons/                 Extension icons
dist/                         Generated unpacked extension (not committed)
```

## Development workflow

1. Edit files under `src/` or the shared `manifest.json`.
2. Run `npm run build`.
3. Reload the extension in each browser.
4. Run `npm run lint:firefox` before sharing a Firefox test build.

Keep the versions in `package.json` and `manifest.json` synchronized. For
Chrome Web Store releases, follow [docs/staged-rollout.md](docs/staged-rollout.md)
(Worker allowlist + CWS gradual %).

## Settings

Feature toggles and the theme picker live in the conventional toolbar popup (click the extension icon). Feature toggles default to off. Theme defaults to stock Veracross.

- **Homework Checkboxes**: adds checkboxes to homework, classwork, labs, participation, and papers
- **Tests & Projects**: also adds checkboxes to tests, quizzes, exams, and projects (requires Homework Checkboxes)
- **Homepage Widget**: on the student home page, lists past-due and upcoming school and custom assignments
- **Show completed**: optional homepage control that keeps checked items in a Completed group at the bottom of the widget (off by default)
- **Assessment reminders**: browser notifications for unchecked tests, quizzes, exams, and projects due within 24 hours (uses a cache refreshed when you visit Veracross)
- **Lunch on Home**: draggable lunch card on the student home page, with day switching (Sage Dining)
- **Lunch on Timeline**: lunch chips above each day’s assignments-due count
- **Theme**: restyles every matched Veracross page (including embed iframes). Default plus curated Light, Dark, Seasonal, and Fun packs
- **Custom Assignments**: adds user-owned timeline rows and a floating button to create assignments

After an extension update, the next Veracross visit starts a one-time tour: changelog, then a lighter overlay with the coach in the top left and live previews (themes, homepage homework, lunch) in front of it. Skip ends the tour.

On the timeline, checked items stay visible with strikethrough. The homepage widget hides checked items by default so it works as a reminder list; turn on **Show completed** to keep them in a Completed group. The extension does not hide completed, past, or far-future work on the timeline.

## Custom assignments and rows

Enable **Custom Assignments**, then use the floating button on the Veracross page to add an assignment. Click a custom row name in the sidebar to rename, recolor, or delete that row. **Add row** creates extras such as Home.

Each assignment can have:

- **Title** and **due date** (required)
- **Description** and **class/subject** (optional)
- **Row** to appear on
- **Color** for the left accent on the timeline chip (defaults to the row color, or `#1976d2`)

Timeline chips use the same markup as native Veracross assignments so collapsed and expanded states match.

Deleting a row asks what to do with its assignments: delete them, or move them to a specific remaining row. The last custom row cannot be deleted.

**Storage** (`chrome.storage.sync`):

- `customRows`: `[{ id, name, color }]`, default one row named Custom Assignments
- `customAssignments`: items with `rowId` (older items migrate onto the default row)
- `vc_checked_assignments`: checkbox state for school and custom items

## Checkboxes

Checkboxes appear on the timeline, daily schedule, and upcoming-assignments pages. Completed items get a strikethrough and reduced opacity. State is keyed by assignment id or a text hash and stored in `vc_checked_assignments`.

Type colors:

- **Homework**: green
- **Classwork / labs / participation**: black
- **Paper / essay**: orange
- **Quiz**: `#F90`
- **Test / exam**: red
- **Project**: indigo

Tests, quizzes, exams, and projects only get checkboxes when **Tests & Projects** is on.

## Homepage widget

Enable **Homepage Widget** to pin a draggable overlay on the Veracross student home / Student Overview page. It sits to the left of the main portal when there is room, and remembers where you drag it. Each time that page loads, a background script fetches the class list from the student portal and each class’s assignments from `portals-embed.veracross.com` (same endpoints as the grade snapshot). Custom assignments are merged in. A spinner shows while those requests run.

Checked items are hidden from the widget by default so it stays a reminder list. Enable **Show completed** to keep them in a Completed group at the bottom with the usual strikethrough styling. Checking a box writes the same `vc_checked_assignments` keys used on the timeline. School titles open the Veracross assignment; custom titles open the existing details popup. If the fetch fails, the card shows an error and a Retry button instead of disappearing.

Assessment items from that fetch are also written to `chrome.storage.local` (`vch_assessment_cache`) so the background worker can send reminder notifications without scraping Veracross in the background.

## Lunch menus

Enable **Lunch on Home** and/or **Lunch on Timeline**. Menus come from Cincinnati Country Day’s Sage Dining feed (`menuId` 137389). The extension caches each school week in `chrome.storage.local` for about 12 hours. Lunch chips are not checkable.

## Themes

Pick a theme in settings. **Default (Veracross)** leaves the stock portal look. Curated packs set CSS variables on `html` and restyle portal chrome through a shared skin:

- **Light**: Soft Light, Lilac, Matcha (dark text on pale surfaces)
- **Dark**: Dark, Ocean, Forest, Ember
- **Seasonal**: Halloween
- **Fun**: Galaxy, Aurora (Galaxy/Aurora include extras.css backgrounds)

Themes apply on every matched Veracross host and frame, even when other features are off. School-branded inline colors on Home widgets may not all change.

Storage: `selectedTheme` (`"none"` | theme id).

## What’s new popup

On `runtime.onInstalled` with `reason === "update"`, the background script sets `storage.local.vch_whats_new` to `{ version, pending: true }`. The top-frame content script runs a short tour once for that version (changelog from [`src/whats-new/changelog.js`](src/whats-new/changelog.js)): intro, then a lighter overlay with the coach in the top left and previews for themes (including Default and Dark), homepage homework, and lunch. Skip or Done clears `pending`.

## Assessment reminders

Enable **Assessment reminders** in the toolbar popup. About once an hour, the background script reads `vch_assessment_cache`, skips checked items (`vc_checked_assignments`), and notifies once per assessment on the local calendar day before it is due and throughout the due day. Clicking a notification focuses an open Veracross tab or opens the portals host. Reminders only stay accurate if students visit Veracross often enough to refresh the cache — there is no background CSRF scrape.

### Adding a theme

1. Create `src/themes/<id>/theme.json` with `id`, `name`, optional `description`, optional `group` (`light` | `dark` | `seasonal` | `fun`), and a `tokens` object using the keys in `src/themes/registry.js` (`bg`, `surface`, `text`, `accent`, …).
2. Import the JSON in [`src/themes/registry.js`](src/themes/registry.js) and add it to the `THEMES` array.
3. Optional: add `src/themes/<id>/extras.css` scoped under `html[data-vch-theme="<id>"]`, and import it from [`src/content/theme.js`](src/content/theme.js) and [`src/content/theme-boot.js`](src/content/theme-boot.js).
4. Run `npm run build` and reload the extension. The settings picker fills from the registry automatically (grouped by `group`).

Do not copy Veracross selectors into each pack — put durable overrides in [`src/themes/skin.css`](src/themes/skin.css) so every theme inherits them.

---

**Happy cross-browser development! 🚀**
