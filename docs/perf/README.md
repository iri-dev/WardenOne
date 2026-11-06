# Performance tooling

`tools/perf-profile.js` measures a loaded extension in controlled browser pages.
`tools/browser-cold-wake.js` measures worker startup; `tools/browser-cosmetic-memory.js`
checks cosmetic retention. Read each command's argument validation before running it
and keep raw traces and reports in `.private-review/` or an ignored temporary folder.

Use `tools/prepare-release-review.js`, `tools/browser-release-rematch.js` and
`tools/summarize-release-rematch.js` for immutable source/runtime comparisons.
Run timing measurements serially. `WARDENONE_RELEASE_REPORT` selects a private
report for optional native release acceptance in the local gate.

[`static-budget.json`](static-budget.json) contains the public package-size and
rule-count limits checked by `tools/check-performance-budget.js`. These checks
do not substitute for browser measurements.
