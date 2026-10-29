# Extension security assessment

Reviewed locally on 2026-10-29.

Permission exposure describes available Chrome capabilities. Exact-ID reputation
describes the local evidence. The change ledger records permission, identity,
installation and enabled-state changes. A permission score alone cannot establish
malicious behavior, and a missing catalogue entry is informational.

Bundled purpose mismatches, unusual installation sources and material unreviewed
changes ask for security review. A saved decision acknowledges its access,
identity, installation and reputation snapshot. Version-only updates retain that
decision. Capability-policy changes and new adverse evidence invalidate it.
Documented incident verdicts take priority even for disabled or reviewed entries;
the review API still refuses known-harmful exact matches.

Ordinary enabling and normal-source installation are informational events.
Legacy permission-only enable/install alerts are normalized without deleting
their timeline entries. Concurrent permission, source and identity changes keep
their findings, and a newer quiet event cannot bury an older pending change.

## Publisher evidence

- Buster's [official README](https://github.com/dessant/buster#client-app) links
  Chrome ID `mpbjkejclgfgadiemmefgebjfooflfhl` and describes its optional client.
  The [Chrome manifest](https://github.com/dessant/buster/blob/main/src/assets/manifest/chrome.json)
  declares native messaging, scripting, network observation and all-site access.
  Those capabilities belong to Buster's exact bundled identity profile. Debugger
  access remains outside that profile. Another ID cannot inherit it by name.
- Anthropic's [installation permission table](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)
  documents debugger, scripting, native messaging, declarative network control and
  other browser-assistant capabilities. It does not list `identity` in the table
  reviewed here. No account-identity allowance was added to Claude or to its
  shared profile. That capability asks for publisher verification, with the
  advisory acknowledged only for the unchanged snapshot.
- Chrome's [identity API documentation](https://developer.chrome.com/docs/extensions/reference/api/identity)
  describes OAuth token access. The permission does not establish token theft.

## Validation

- `tools/test-extension-verdicts.js`: real assessment cases for official Buster,
  Claude's documented and undocumented capabilities, unknown ordinary and powerful
  access, changed permissions/hosts/identity/source, matching reviews, old alerts
  and adverse evidence with both enabled states.
- `tools/test-extension-change-watch.js`: notification and badge behavior,
  information-only re-enabling, legacy alert normalization and concurrent changes.
- `tools/test-extension-reputation.js`: local review persistence, import boundaries,
  affected versions and protection against acknowledging later change events.
- `tools/browser-extension-security.js`: the shipped page and worker in a disposable
  Edge profile with fixture inventory. Exercises real message handling, saved review,
  version-only updates, proxy gains, disabled Buster, re-enabling, incident priority,
  change filtering and narrow viewport layout. No third-party extensions are installed.

Result: 283 verdict checks, watcher and reputation suites, the Edge browser
regression and the full maintainability gate passed. The full gate ran against
an isolated snapshot with a temporary Git index because concurrent popup edits
invalidated generated inventories during the shared-checkout run. The nine
extension-security source and test files matched that snapshot. Regenerated
message, storage and protection inventories also passed in the shared checkout.
The real staging area was unchanged; no commit or push was made.

These checks establish assessment and UI behavior, not that any installed
extension is safe. Chrome's management inventory does not expose an extension's
complete runtime behavior or prove publisher identity cryptographically.
