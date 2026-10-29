# Independent CNAME control — 2026-10-26

The later [default policy audit](cname-default-policy-audit.md) supersedes this
snapshot's default-off behavior. Its measurements below remain historical.

**Block CNAME-cloaked trackers** is an independent protection in the popup and
Settings → Privacy → Tracking. The canonical health registry now contains
106 protection switches and three watch-only guards, giving **109 protections**.
Settings, onboarding and website source counts derive from that registry;
the README and onboarding fallback text agree with it.

`blockCnameTrackers` defaults to false. Existing first-party tracker choices do
not migrate into it. Recommended and Maximum privacy do not enable it;
Settings presets and the popup's Enable everything preserve the user's current
explicit CNAME choice. Existing first-party tracker URL heuristics retain their
own switch and behavior.

CNAME enforcement now requires only the master switch and its own explicit
setting. Turning off general tracker lists or the first-party URL heuristic
does not disable an explicitly enabled CNAME policy. Its per-site exception is
`siteOverrides[host].blockCnameTrackers = false`, available through both site
exception editors. Full site pauses and the master switch continue to apply.

The scope registry identifies CNAME as a supported network owner. This exposes
its exception without offering unsupported exceptions for other worker-only
protections or changing the meaning of page-only and mixed overrides.

The licensed mapping, exact-host compiler, rule band, 20 installed rules,
authentication/media exclusions and failure handling are unchanged from the
[Phase 01 implementation](cname-protection-audit.md). Its original immutable
resource profiles remain historical evidence for that implementation.

Regression coverage exercises legacy-choice nonactivation, default-off behavior,
presets and Enable everything from both saved states, independent enforcement,
data/write failures and retry. The native fixture clicks the actual checkbox in
the popup and the switch in Settings, then observes server delivery and native
rules for both states. It also checks the health denominator and the separate
per-site exception alongside the existing alias/authentication controls.

Changes remain local, with no version or permission change.

## Verification

The full maintainability gate passed all **315 suites**. The final browser lab
passed five fresh Chrome 121.0.6167.184 profiles for the candidate and five for
the Phase 00 reference. Each candidate run clicked both real UI controls off/on,
confirmed the 109 denominator, observed 0/20 native CNAME rules, and verified
server outcomes. Legacy first-party opt-in alone left CNAME off. CNAME remained
effective with the other tracker controls off, and its own site exception worked.
Authentication cookie flow, unknown/child/lookalike hosts, WebSocket enforcement,
master pause and rejected-write recovery also passed.

The uncommitted candidate is Git tree
`f7840c746b9483e0819ea1bcf91182be883d97f9`, based on commit
`273c43a0051d6c3fe12c6871944ed7e8822d8af3`. Its 133-file runtime fingerprint is
`f10673594c5062a9e6c4a057d81fd954734fc07100f7ea5b7b02d76cd9246aec`;
ZIP SHA-256 is
`cf03ddb864f9026a87b86e4a05b7f5e2bce867a4d667bc2603cf881e52ac2a9d`.
The final working runtime files match that snapshot.

Native results are retained locally at
`docs/perf/traces/cname-toggle-2026-10-26/network.json`, SHA-256
`cc8cccc05a228fb51de254a9a8309c99bbdbe4468f8d4ad384b673d1e0a8fb2c`.
Snapshots and gate logs are in `tmp/cname-toggle-2026-10-26/`.

The profiler's new `--cname-trackers` option was checked independently of
`--first-party-trackers`. Its one-run article fixture confirmed 20 rules on the
candidate and explicitly unsupported CNAME coverage on the older reference;
this validates option selection, not a performance improvement. Package budgets
passed at 2,378,213 ZIP bytes and 11,126,455 unpacked bytes. The Store profile
passed 74 checks. The real Git index remains unstaged.
