# Performance tooling

`tools/perf-profile.js` measures a loaded copy of the extension on controlled browser pages.
`tools/browser-cold-wake.js` measures how long the background worker takes to start, and
`tools/browser-cosmetic-memory.js` checks how much the page styling keeps hold of. Please read
each command's argument checks before you run it, and keep raw traces and reports in
`.private-review/` or a temporary folder Git ignores.

For release comparisons that pin both the source and the running build, use
`tools/prepare-release-review.js`, `tools/browser-release-rematch.js` and
`tools/summarize-release-rematch.js`. Run timing measurements one at a time, never side by side.
`WARDENONE_RELEASE_REPORT` picks a private report for the optional release check in the local gate.

[`static-budget.json`](static-budget.json) holds the public limits on package size and rule
counts that `tools/check-performance-budget.js` enforces. Those limits are a floor, not a
replacement for measuring in a real browser.
