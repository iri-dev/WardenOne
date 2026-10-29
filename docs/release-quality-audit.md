# Phase 09 release quality

Review date: 2026-10-27. Changes remain local, based on commit
`273c43a0051d6c3fe12c6871944ed7e8822d8af3`; the candidate is an uncommitted
Git tree. Version and permissions are unchanged.

## Ownership and contracts

[protection-contracts.json](protection-contracts.json) assigns 110 protections
an enforcement owner, behavior contract, default, override scope and source
references. It includes the complete generated configuration schema, DNR
allocation constants, manifest registration/permissions, and a lexical log-type
census. Shared consumers remain visible; ownership does not imply a permission
belongs exclusively to one feature. No production file was split for this phase.

[protection-regressions.json](protection-regressions.json) indexes the ten required
dimensions for phases 01–08: success, false positive, compatibility exception,
disabled setting, site override, restart, rule capacity, migration, invalid input
and erasure. Shared lifecycle coverage and inapplicable dimensions are explicit.
A test reference identifies relevant executable coverage; native browser results
remain separate evidence. The gate rejects stale inventory, missing owners,
missing defaults and regression references that are absent from the gate.

## Changes and rollback

Tracker-cookie installation now participates in the existing session DNR batch.
Policy is certified only after the batch commits. Rejection preserves installed
rules and permits retry; the batch's existing per-owner fallback remains intact.
CNAME validation and rule compilation reuse a maximum of 4,000 public mapping
site identities per worker. Compatibility decisions are cached only within a
single compilation, so changed policy is rechecked. No visited-host lookup or
external DNS service is added. Unknown aliases still fail open.

To roll back these optimizations, restore the direct tracker-cookie session write
and direct site-boundary calculations, preserving the policy, priority and
failure assertions. Rebuild and run the gate. This changes scheduling and repeated
work, not the intended protected hosts. Do not weaken quota, trust or compatibility
tests to obtain a green result.

For earlier phases, rollback means restoring the corresponding source and
generated files together from a reviewed source archive. CNAME data has its pinned
source snapshot; the existing CNAME toggle/site exceptions are immediate escape
paths. Cookie isolation uses the existing cookie switch. Learner decisions keep
explicit approval. Fingerprint noise remains opt-in. Restoring old history code
requires preserving the user's retention choice and completing erasure first;
do not restore deleted journals. Feed/message rollback must retain durable repair
and sender validation. Individual phase audits hold the detailed evidence.

## Archive review

`tools/prepare-release-review.js` creates a temporary index, a committed HEAD
source/runtime pair, and a separately labelled candidate-tree pair. It does not
stage the real index or create a commit. Source ZIPs include development files
that release ZIPs deliberately omit. Every runtime member must match the source
ZIP byte for byte. Both extracted source trees pass content/fingerprint/domain
and settings generation checks. Rulesets, license/notices hashes, archive hashes,
tree identities and browser hashes are retained in `snapshots.json`.

The review rejects local/hidden state, credential filenames, selected token
formats and private-key headers. The public throwaway loopback TLS fixture key
is explicitly allowed only in its existing test module. This bounded scan does
not establish the absence of every possible secret. Existing source licensing,
package allowlist, completeness, rule quota and integrity gates still apply.

The committed archive contains 129 runtime files and 643 source files. The tested
candidate contains 136 runtime files, 11,243,371 unpacked bytes and 28,369 static
rules across its manifest-declared packs, including disabled packs. Review
identities and final gate/smoke results are recorded below after verification.

## Reproduction and budgets

Use Node 24 from `.node-version`. In PowerShell, call the Node executable by its
full path. Prepare a new gitignored review directory with:

```text
node tools/prepare-release-review.js tmp/new-review browser.exe privacybadger-directory official.crx
node tools/browser-release-rematch.js tmp/new-review/snapshots.json tmp/new-rematch.json 5
node tools/summarize-release-rematch.js tmp/new-rematch.json tmp/new-summary.json
```

Use disposable headless profiles with `WARDENONE_HEADLESS=1` and software GL for
the pinned Chrome 121 build. Run timing serially, without the gate or another
benchmark. Set `WARDENONE_RELEASE_REPORT` to the successful rematch report when
running the full maintainability gate: release acceptance then runs inside it.
Archive readers reject traversal, case collisions, device names, encryption,
symlinks, corrupt CRCs, inconsistent headers and decompression/size excesses.

For each metric the ceiling is the observed original-build median multiplied by
`1 + max(0.25, 2 * (reference p90 - reference median) / reference median)`.
Five fresh-profile samples per build are required. This policy was fixed before
measurement; its fractions were not raised after failures. Original static byte
and rule budgets remain unchanged. Browser-process CPU, renderer JS heap and
worker JS heap are distinct metrics; no total browser RAM claim follows.

The first timing protocol exposed unequal readiness polling and mixed lazy-cache
states. Its raw report is retained as `rematch-01.json`, with the failed budget.
Protocol 2 polls both workers every 100 ms and explicitly warms WardenOne's
packaged cosmetic cache before GC. `rematch-02.json` still failed startup after
batching. The CNAME reuse change then passed `rematch-03.json`; the corpus and
budget remained unchanged. These are a documented sequence of checks, not a
pooled statistical speedup claim. See [privacy-rematch.md](privacy-rematch.md).

## Release limits

Controlled fixtures establish their stated behavior only. Real account sign-in,
payment transactions and the entire live web are not covered. Live media checks
must show actual advancing playback before shipping; network errors, consent,
login requirements or unavailable videos are recorded as unverified, not passes.
Raw profiles and local ZIPs remain gitignored. No commit, push or release was
requested for this phase.

## Native smoke results

Chrome 121.0.6167.184 and Edge 150.0.4078.48 passed controlled media
compatibility/security, forced downloads, intentional direct/CDN/export downloads,
reputation-warning bypass scope and the actual popup/utility/settings checks.
Both browsers passed native tracker-cookie sent/stored header tests, exemptions,
site/global controls, priorities and rejected-update recovery. Chrome also passed
the native privileged-message and fingerprint/audio/graphics/frame/worker/editor
suites. These checks use the frozen candidate runtime fingerprint listed in
[privacy-rematch-identities.json](privacy-rematch-identities.json).

Live Edge playback advanced on both pinned public pages during a ten-second
observation: youtube 0.77 → 11.15 seconds; twitch 2.38 → 12.95 seconds.
This is a playback smoke check, not an ad-removal or long-session stability claim.
The initial Chrome download fixture exposed a transfer/pause timing race under
parallel load. Its harmless response now remains open for four seconds; the
native pause and quiet intentional-download assertions remain required. Completed
small-download handling retains its existing unit coverage.

## Final local gate

All **333 suites** passed, including the native release-report acceptance,
source and generated-build parity, DNR quotas/precedence/atomic replacement,
malicious and benign download verdicts, compatibility and storage/erasure
coverage. Every shipped script and tools script passed syntax checks.
`git diff --check` passed. The real Git index remains unchanged.

The review archive builder is rerun into `tmp/release-phase09/review-final/`
after these audit documents are complete. Its `snapshots.json` holds the final
source-tree and ZIP hashes. Runtime file hashes must equal the tested candidate
fingerprint; documentation and tool additions may change the source tree.
The evidence index records raw report and successful smoke/gate log hashes.
No candidate commit or release identity is implied.
