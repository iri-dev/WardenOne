# Cosmetic stylesheet ownership — 2026-10-20

The isolated bridge and the MAIN-world engine both used `wo-user-hidden`. The
bridge found its sheet by `data-wardenone-user-hidden`; the engine found it by
ID. The worker also combined hand-hidden selectors with user filter and
subscription selectors in the engine's cosmetic reply.

## Reproduction

The native Zapper browser test saves a user cosmetic filter and an enabled
subscription, then tests a page with empty and preloaded hand-hidden rules.
Before the fix:

- With no preloaded hand rule, the engine created its sheet first. Adding a
  Zapper rule created a second `wo-user-hidden` element because the first lacked
  the bridge's marker attribute. Both list targets stayed hidden, but two
  elements shared the ID.
- With a preloaded hand rule, the engine reused the bridge's sheet. Adding or
  removing another Zapper rule overwrote its contents, and both list targets
  became visible without reloading.

## Ownership

| Sheet | Writer | Input |
| --- | --- | --- |
| `wo-user-hidden` | Isolated bridge | Saved hand-hidden rules from the frame's config and `hidden-list` refreshes |
| `wo-user-filter-hidden` | MAIN engine | User filter text and enabled subscriptions from `adshield-cosmetic` |
| `rg-adshield-style` | MAIN engine | Built-in cosmetic rules |

The worker no longer reads or copies hand-hidden rules into `userSelectors`.
Renaming the engine's sheet alone would leave an old copy of those rules active
after Zapper undo. Hand-hidden rules still load independently of AdShield, and
user filter selectors retain their existing browser validation and 5,000-entry
cap. Their application still precedes the engine's allowlist/disabled reply
exit.

## Regression coverage

`tools/browser-element-zapper.js` now checks both reproduced startup cases,
actual user/subscribed hiding, unique sheet IDs, add/remove, removing a
preloaded rule, Done/Escape, post-finish Ctrl+Z, reload persistence and undo with
AdShield disabled. These checks passed in Edge 150.0.4078.48 and Brave's Chromium
155.0.8059.85.

The existing selection check now observes rendered hiding instead of counting
temporary picker markers: a refresh can remove a marker while saved stylesheet
rules continue hiding the element. Undo must restore the selected element in
place, regardless of which mechanism hid it.

`tools/test-streaming-compatibility.js` executes the cosmetic reply handler in
ordinary, player, allowlisted and disabled response modes. Only user filter and
matching subscription selectors are returned, and hand-hidden storage is not
read. The picker and frame-init suites retain selector safety, isolated loading,
stylesheet reuse and marker cleanup coverage.

The rebuilt extension passed all 292 suites in the full maintainability gate.
The engine browser smoke suite also passed, including malformed selector
isolation, imported/subscribed cosmetics and the shipped tracker-blocking check.
