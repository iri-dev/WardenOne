# Filter compilation interfaces — 2026-10-26

Cosmetic classification, compilation and source authority now have explicit
interfaces in `background.js`. The implementation remains shared by runtime
refreshes and `tools/build-cosmetics.js`; no second grammar or extra worker import
was introduced. Network compilation keeps its existing parsers and gains a
source-level entry point. Application and DNR priority decisions remain separate.

| Stage | Interface | Result / boundary |
| --- | --- | --- |
| Download and provenance | `fetchValidatedRemoteListText`, existing integrity evaluators | Validated body, source hash, publisher and drift checks; failures keep existing protection |
| Remote network compilation | `compileRemoteNetworkSource(text, maxOptionRules)` | Ordered whole-host entries and capped option-bearing rules; no storage or DNR writes |
| Cosmetic classification | `classifyCosmeticFilterLine(line)` | Passive, procedural, scriptlet, generic-hide exception, unsupported or irrelevant record |
| Passive compilation | `compilePassiveCosmeticRule(state, rule)` | Ordinary selectors and selector exceptions; command records cannot enter this path |
| Procedural compilation | `compileProceduralCosmeticRule(state, rule)` | Existing domain-scoped procedural text and normalized AdGuard style records |
| Scriptlet compilation | `compileScriptletRule(state, rule)` | Existing canonical names, arguments, aliases and storage-mutation restrictions |
| Remote storage projection | `passiveCosmeticRules(parsed)` | Only generic/specific selectors, selector exceptions and generic-hide exclusions |
| Package compilation | `compilePackagedCosmetics(text)` | Only scriptlet and procedural buckets; builder/check still verify corresponding source |
| Application | Existing DNR reconcile and cosmetic serving functions | Source priorities, host exceptions, site controls, player safeguards and page-side execution checks |

Classification accepts the strings yielded by the shared source-line iterator.
Typed records are internal compiler inputs, not page messages or stored authority.
Each compiler returns false for a different record type, unsupported input or a
refusal within its own path. It never reroutes a rejected command into CSS.
Source order, duplicate treatment, domain expansion and established budget
admission remain unchanged. Generic-hide exceptions still have their own first
pass, so exhausting other budgets cannot hide a later document exception.

The remote refresh still hashes the complete parse result for change detection,
then projects passive fields before storage. Package builds use the command-only
projection. Serving still discards command fields in old storage and loads them
only from `cosmetic-rules.json`; the new compiler interfaces do not grant a
downloaded rule permission to execute. Network compilation still precedes the
existing source-integrity verdict, authority mapping, merging and atomic DNR write.

Unsupported `#^#`, `#@?#`, `#@$#` and `#@%#` prefixes are refused before body
separators can make them look like a different filter type. This also covers
bodies containing `##`, `#?#` or scriptlet text. Unsupported AdGuard action forms,
unknown scriptlets, storage mutators outside the existing allowlist and generic
procedural actions remain non-emitting. Network options retain their existing
unsupported-option and scoped-exception checks.

This adds no HTML or response-header filter engine. Procedural records retain
their existing text representation and page-side parser. Compiler admission does
not establish native CSS validity or full compatibility with every upstream
operator; those existing limits are unchanged.

## Verification

Before/after comparisons cover both ten-source recorded corpora from the parser
investigation, plus mixed types, separator precedence, exhausted budgets,
duplicates, CRLF and empty source chunks. Every serialized output hash matches.
The source-subset output remains
`b27058dfae877d4b164a01fcaa55dbec56dd8a2c9dab8206b10193b199aa5fa1`;
the full-source output remains
`c33c77774622bc79d170833eb794d18b3c58d9afc3850f29bc526153051a23a3`.
The new unsupported-prefix guard has no effect on those recorded lists.

`tools/test-filter-compilation.js` independently exercises all three cosmetic
compilers, wrong-path rejection, aliases, escaped arguments, source projections,
generic procedural refusal, limits and late generic-hide exceptions. It also runs
the real remote refresh twice, checking passive-only storage and unchanged-hash
handling, and exercises the source-level network compiler with unsupported rules,
public-suffix boundaries, scoped exceptions and its per-source cap. The existing
provenance suite also tests the shared projection with injected command fields.

An offline source-snapshot build keeps both `cosmetic-rules.json` and its supplied
source snapshot byte-identical. Local raw comparisons and profiles are in
`tmp/extended-filtering-2026-10-26/` and
`docs/perf/traces/extended-filtering-2026-10-26/`.

The full gate passed all 313 suites. Native Edge 150.0.4078.48 checks passed:
CSS isolation and imported/subscribed cosmetics, engine and network enforcement,
13 protected hosted-page routes and nine untouched login routes. Cosmetic storage
invalidation, two list replacements and two 30-frame navigation cycles also
passed. The cache stayed at or below 256 hosts, identical selector scopes shared
one array, the CSS probe stayed hidden, and returning from the frame fixture
restored the original document/node/listener counts.

The current working files also passed package budgets, Store-profile checks,
asset completeness and reproducible-ZIP/tamper checks through a separate temporary
Git index. The real index was unchanged. ZIP size was 2,395,151 bytes, with
28,369 packaged static rules; all reviewed limits passed.

Live YouTube playback advanced from 9.60 to 24.95 seconds; Twitch playback
advanced from 12.41 to 27.71 seconds. Both reported readyState 4, unpaused video
and no browser error. `playback.json` contains the YouTube result and
`playback-twitch.json` the successful Twitch rerun. These are short playback
checks, not a claim about every ad break or authenticated workflow.

The same fixed corpora and three-process Node methodology as phase 3 gave:

| Chunked cosmetic input | Earlier elapsed / retained heap | After elapsed / retained heap |
| --- | ---: | ---: |
| Supplied source subsets | 142 ms / 11.32 MiB | 159 ms / 11.34 MiB |
| Full cached lists | 306 ms / 11.37 MiB | 255 ms / 11.39 MiB |

Early rejection of non-cosmetic lines and local references to compiler functions
avoid repeated global lookups in the parsing loop. Recorded GC pause medians
were 7.70 ms for the subsets and 7.32 ms for the full lists after extraction.
Total process CPU medians increased in this sample (157 to 218 ms and 344 to
406 ms respectively), so the lower full-corpus elapsed time is not evidence of
a CPU improvement. These are isolated V8 results with the phase 3 high-water
sampling limits; browser performance is not inferred from them.
The Node profile preceded a comment-only edit at the storage projection. Final
native checks and output comparisons used worker SHA-256
`5d3a7761e81bf295d5688d498374d939a1c6052be048c70dbfd0354b744d64d4`.
