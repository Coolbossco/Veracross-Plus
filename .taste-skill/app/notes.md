# Veracross Plus UI redesign — app notes

## Inventory (only this product)
1. Homework/classwork checkboxes on Veracross timeline cells
2. Assessment checkboxes (tests, quizzes, projects) as a nested toggle
3. Homepage floating “Upcoming & past due” widget with drag + collapse chip
4. Lunch on Home card (Sage Dining / CCDS) with day nav
5. Lunch on Timeline entrée chips + day modal
6. Theme packs that restyle portal pages (Halloween, Galaxy, Aurora…)
7. Custom assignment rows + floating Add control + modal
8. What’s-new coach tour with live theme/homework/lunch demos
9. Assessment reminder notifications from cached assignments
10. Grade panel overlay on class pages
11. Shared panel chrome (Hide / Due chip) across home widgets

## Screens’ questions
- **settings (popup):** Which Veracross Plus features are on for this student?
- **home (widgets):** What is due soon, and what is lunch today?
- **overview (tour):** What shipped in this version, and can I try it here?

## Style
- Dealt: `achromatic-ledger` (seed 1910437094), kind `workspace`, light
- Why: Extension chrome is glanced at between portal tasks; colour belongs on due status and lunch entrée, not on purple toggles or glass cards.
- Face: blue-grey ground `#f2f4f7` (ledger/school portal); white surfaces; ink chrome; `#1d5fbf` only on primary data links and near-today emphasis.
- Signature element: **due strip** — past-due vs upcoming groups with a 3px ink/blue edge on items (product analogue of sell-out strip).
- Type: Geist (loaded in popup + injected content); mono unused (no ledger IDs in chrome).

## Out of scope
Theme pack skins (`themes/*`) stay as feature content; redesign is VCH chrome only.
Product behavior and feature flags unchanged.
