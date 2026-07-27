# WardenOne Maintainability Notes

## Current Runtime Map

- `manifest.json` loads `background.js` as the MV3 service worker.
- `background.js` imports shared runtime modules with `importScripts()`:
  - `domain-utils.js`
  - `background-startup.js`
  - `background-memory.js`
  - `background-downloads.js`
- `background-startup.js` owns startup security checks, startup report storage, and login-domain risk helpers used by background message handlers.
- `background-memory.js` owns Memory Shield tab sleeping, tab-limit enforcement, RAM scoring, duplicate/zombie tab tools, and popup-facing memory actions.
- `background-downloads.js` owns Download Guard scoring, review storage/UI, trusted download sites, hash-reputation hooks, Chrome downloads listeners, and critical hard-block handling.
- `src/content.js` is the lossless readable source artifact for the shipped main-world content runtime.
- `content.min.js` is generated from `src/content.js` by `tools/build-content.js` and remains the file loaded by `manifest.json`.

## Required Check

Run this after changes that touch runtime files, rules, or manifest data:

```powershell
node tools\check-maintainability.js
```

The check verifies:

- JavaScript syntax for core runtime files.
- JSON validity for manifest/rule/data files.
- `importScripts()` targets exist.
- static rule-count constants match the checked-in rule files.
- `src/content.js` rebuilds `content.min.js` byte-for-byte.
- Memory Shield safety/performance behavior passes its focused test harness.
- Download Guard scoring and critical hard-block behavior pass focused tests.

## Content Script Source Risk

Do not pretend the generated `src/content.js` is the original authoring source. It is a lossless formatted artifact: useful for review, scanning, targeted edits, and exact rebuilds, but it cannot recover symbol names, module boundaries, comments, tests, or original build intent.

Current commands:

```powershell
node tools\build-content.js --check
node tools\build-content.js --build
node tools\build-content.js --format-from-runtime
```

The cleaner long-term fix is still:

1. Restore true original content-script modules if they exist.
2. Replace the lossless formatter with a real parser-backed bundler/minifier.
3. Add focused tests for content-script features before large edits.

Until then, make content-script changes in `src/content.js`, run `node tools\build-content.js --build`, then run `node tools\check-maintainability.js`.
