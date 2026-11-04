---
name: design-taste-frontend
description: >-
  tasteskill v2, the anti-slop frontend skill. Art direction for websites, distilled from a study of
  247 curated gallery sites (One Page Love, Awwwards Sites of the Day). Deals researched directions
  (idea, composition, type, palette, photographs, section blueprints) from a library, enforces a strict
  no-slop house style with a real-browser inspector, and runs a look-and-feel loop on screenshots. Use
  this whenever you build, design, redesign, restyle, polish or review a landing page, marketing site,
  portfolio, product page, one-pager, hero or any public-facing web page, in any stack (HTML/CSS, React,
  Next.js, Vue, Svelte, Astro, Tailwind) — also when the user says a page looks generic, templated,
  "AI-made", sloppy, or asks to make it look designed, premium, award-level or less like every other
  site. Also for app screens: dashboards, admin and analytics views, settings, inboxes and other screens
  people work in, with their own run and rules.
---

# tasteskill v2

A page built by a model usually looks like the average of every page the model has seen: centred
headline, icon cards, soft gradient, thin rules. Nothing wrong; nothing decided.

This skill replaces defaults with decisions:

1. **`scripts/draw.mjs` deals researched directions** — you choose among them; do not invent the look.
2. **The idea comes from the subject** — inventory what only this client has; not category styling.
3. **House style with no ornaments**, measured by `scripts/inspect.mjs` in a real browser.
4. **Look at what you made** — screenshots, juror's rubric, fix, look again.

Taking ornaments away is only half the job. Fill with substance: larger type, fields of colour, real
pictures of this subject's world, full section content. Do not trade substance for empty restraint.

In commands below, `<skill>` is this skill's folder. Run from the project root (working files →
`.taste-skill/`). Scripts need Node 22+ and Chrome/Edge/Chromium; they install nothing. `assets.mjs`
needs network; no API keys.

## Page or app screen

Decide first:

- **Page** (read/scrolled: landing, marketing, portfolio, one-pager) → **the run** below /
  `references/run.md`.
- **App screen** (worked in: dashboard, admin, settings, inbox, editor) → read
  **`references/app-screens.md` whole** before starting (`draw.mjs --app`, `inspect.mjs --app`). The
  page run does not apply.

A product site that shows its app is a page; fragments follow app-screen rules inside. Deal the app
style once, keeping page palette/type:

```bash
node <skill>/scripts/draw.mjs --app --kind <kind> --brief "<the product>" --keep palette,type --out .taste-skill/app
```

Build every shown fragment as a real piece of that app (`assets/app.css`, `assets/charts.js`, real
data). When a request mixes landing + dashboard, use each run with one shared palette and typeface.

## The run (checklist)

Do in order. Full detail for every step: **`references/run.md`**.

1. **Brief + inventory** — subject, audience, CTA, stack, brand, real imagery; 8–12 things only this
   client has.
2. **Argument** — claims with proof per section (`references/copy.md` §1); drop claimless sections.
3. **Draw** — three options, choose for the subject, then full sheet:
   ```bash
   node <skill>/scripts/draw.mjs --sector <sector> --brief "<subject>" --sections <roles> --options 3
   node <skill>/scripts/draw.mjs <same args> --direction <id>
   ```
   Adopt the sheet; redraw only for a stated reason. Flags/detail in `references/run.md` §3.
4. **Idea** — fill: *On this page, **[subject-only thing]** becomes **[direction's device]**.* Pass
   the competitor test. One live interactive thing from the idea.
5. **Copy deck** — full words before markup (`references/copy.md`); headlines ≤2 lines everywhere.
6. **Build still** — tokens → hero → sections → imagery (`scripts/assets.mjs`) → live thing →
   scroll scenes → fullness → frame → states. See `references/run.md` §6, `references/imagery.md`,
   `references/scenes.md`.
7. **Gate** —
   ```bash
   node <skill>/scripts/lint.mjs <sources>
   node <skill>/scripts/inspect.mjs <url or html>
   node <skill>/scripts/scenes.mjs <url or html>   # if scroll scenes
   ```
   Fix every `FAIL`; defend or fix every `WARN`. Re-run on the production build when there is one.
8. **Look** — critique screenshots with `references/critique.md`; fix top three; ≤3 rounds.
9. **Move** — required motion layer (`references/motion.md`); re-inspect.
10. **Report** — only after 0 FAIL, all screenshots opened, critique written; see `references/run.md` §10.

## Rules & craft (load on demand)

| Topic | File |
| --- | --- |
| House rules (banned ornaments; inspector-measured) | `references/house-style.md` |
| Dated tell registry | `references/tells.md` |
| Laws of type / space / colour / imagery / components | `references/craft.md` |
| Type detail | `references/type.md` |
| Colour detail | `references/colour.md` |
| Layout detail | `references/layout.md` |
| Copy & two-line arithmetic | `references/copy.md` |
| Imagery search, credits, drawing | `references/imagery.md` |
| Motion budget & recipes | `references/motion.md` |
| Scroll scenes | `references/scenes.md` |
| Critique rubric | `references/critique.md` |
| Brand / redesign / offline / no Chrome | `references/special-cases.md` |
| Study numbers | `references/research.md` |
| App screens | `references/app-screens.md` |

## Scripts & assets

| Path | Use |
| --- | --- |
| `scripts/draw.mjs` | Deal/reprint direction; `--app`, `--photos`, `--site`, `--show`, `--redraw` |
| `scripts/assets.mjs` | Open-collection search; `--get`, `--credits`, `--video` |
| `scripts/lint.mjs` · `scripts/inspect.mjs` | Gate |
| `scripts/scenes.mjs` | Scroll-scene gate |
| `assets/base.css` · `assets/base.js` | Optional neutral foundation |
| `assets/scenes/` | Scroll scene stage + demos |
| `assets/app.css` · `assets/charts.js` | App shell / charts |
| `library/` | Draw data — do not read whole; use the script |
