# Ghostery G-05: matched performance

Status: complete with qualified comparisons, 28 October 2026. The public
cohort retains three extension-off YouTube playback failures.

## Inputs and configurations

Both products run alone against the same Microsoft Edge executable and Windows
machine. Ghostery stays pinned to the verified v10.6.7 release from G-00. The
original WardenOne runtime and its failed update attempt are retained separately
from the reviewed feed-budget candidate. There is no version bump or new setting.
All work stays local.

Five arms are extension-off, WardenOne Recommended, Ghostery default, WardenOne
Maximum privacy and Ghostery maximum practical built-in privacy controls. WardenOne
uses its actual presets over fresh defaults; it does not disable unrelated
security modules for the benchmark. Ghostery keeps ads, tracking, annoyances,
Never-Consent/GPC, redirect protection and fixes enabled. Its maximum arm adds
the bundled Shorts, browser-prompt, notification and social-widget controls.
Google sign-in removal, destructive Zap mode, arbitrary custom lists and unrelated
language packs are excluded from this practical configuration. This is an
explicit configuration, not a claim that both products implement equal coverage.

Exact settings, permissions, native rule state, resource checksums and data
fingerprints are recorded in `seeds.json`. Optional account/API credentials are
absent; no personal browser profile or real login credentials are used. Seed
profiles contain only this experiment's data and remain ignored local artifacts.

## Warm-up and feed growth

The first warm-up quarantined WardenOne's whole network update because the current
AdGuard tracking source exceeded its shared 12 MiB cosmetic budget. The URLhaus
payload-URL source also exceeded its 9 MiB download-source budget. Publisher files
were downloaded over normal TLS and hashed for review: 13,152,400 bytes for the
AdGuard source and 11,435,813 for the subsequently fetched URLhaus source. Their
existing formats and source URLs remain unchanged.

Only these two exact configured URLs now receive a finite 16 MiB allowance.
Generic cosmetic sources retain 12 MiB, network sources 18 MiB, supplemental
sources 8 MiB, and split hash feeds 9 MiB. The streaming reader still cancels on
excess bytes even when Content-Length is absent or false. Redirect refusal,
credential omission, exact source authorization, format/structure limits,
source-integrity and atomic quarantine checks remain in place. No source or
security module was removed to get a successful update. The command-line feed
checker reads the same overrides, with coverage and over-limit regression tests.

The candidate warm-up accepted all 27 WardenOne network sources. Both Ghostery
profiles share matching core resource checksums. Filter payloads are frozen per
arm before timing. Mutable auxiliary-list fetch timestamps are separated from
the actual data fingerprint; source pins, cosmetic data, blocked-domain arrays,
download data and native enabled rules are recorded. Data/configuration hashes
must agree before and after each timed trial. Reindexed preparations preserve
the original warm-up reports rather than silently discarding a changed value.

## Measurement protocol

The six controlled workloads are a 150-paragraph article, nested DOM churn,
eight frames, 30 frames, real HTML5 video/offline audio, and an account application
with IndexedDB, three identity frames, trusted input and a server cookie session.
No commercial service credentials are entered. Source-body hashes record the
identical bytes served to each arm. Browser cache is cleared before a cold visit;
the immediately following warm visit uses the same URL. Cache observations are
retained rather than assuming a reload hit the cache.

Five serial blocks rotate five arm positions and rotate workload order. Each
arm therefore occupies each position once. This balances position; it is not a
complete adjacency-balanced crossover design. Each trial starts from a separate
copy of its warmed profile. No benchmark browsers run concurrently. CPU profiles,
the maintainability gate and other verification run outside scored collection.

The harness records renderer task/script/layout time, navigation DCL/load times,
long-task count/duration, trusted-input response, renderer heap after GC, native
process private/working memory, browser-process CPU counters and extension-worker
heap. Two-animation-frame response time is a fixture metric, not population INP.
Browser CPU counters can miss work in very short-lived processes between samples.
Process memory includes browser/native allocations and is distinct from JS heap.
Worker Performance-domain task time is unavailable and remains null, not zero.

Ordinary timing keeps the worker debugger attached, equally for both extensions.
Pinned idle overhead is marked accordingly. Separate diagnostics drop that
debugger for natural suspension, count worker creations, perform three forced
restarts and check that native dynamic rules survive. Restart latency includes
the extension-page message/readiness path and is not pure worker execution time.
Profiler captures attribute initialization/churn/frame work by script and function;
sampling overhead is excluded from the comparison.

Public article/media/sign-in pages are measured separately because network,
content, ads and server responses vary. Playback must advance and rejected starts
remain failures. Public sign-in checks load a page without signing into an account.
Failures and unready pages cannot earn lower-cost wins by doing less work.
The public cohort blocks configured feed hosts at browser launch, before an
automatic update can change the warmed profile, and also blocks exact feed URLs
in the worker session. Ordinary page hosts remain reachable. WardenOne's
`toastMemory` is per-site shown-warning history, which can change when a page
shows a warning; it is recorded but excluded from the public trial's
protection-settings equality check. Every protection setting remains compared.

The result retains raw values, medians, p90/ranges and paired block differences.
Bootstrap intervals at this sample size are descriptive. Protection coverage,
machine contention, background scheduling, network variability and missing
metrics prevent extrapolating a controlled result to all browsing. A benchmark
can measure higher cost without proving worse protection or establish lower cost
without proving equal protection.

## Controlled results

All 300 controlled visits completed their workload checks, with no observed
filter or setting drift. Each cell below is a median across five blocks. The
task totals sum six different pages in one cache condition, so they describe
this fixed workload mix rather than a typical web page. Peak private memory is
the largest native process private-memory observation in each block, then the
median of those five peaks.

| Arm | Cold task total, ms | Warm task total, ms | Whole-browser CPU across 12 visits, ms | Peak process private memory, MiB |
| --- | ---: | ---: | ---: | ---: |
| Extension off | 547 (547–551) | 541 (535–548) | 4,691 (4,590–4,775) | 577 (552–599) |
| WardenOne Recommended | 1,695 (1,680–1,743) | 1,682 (1,676–1,690) | 10,195 (10,154–10,579) | 785 (766–823) |
| Ghostery default | 1,135 (1,128–1,169) | 1,040 (1,023–1,061) | 9,749 (9,665–9,957) | 837 (824–878) |
| WardenOne Maximum | 1,841 (1,795–1,915) | 1,819 (1,786–1,867) | 10,768 (10,431–11,966) | 788 (771–856) |
| Ghostery maximum practical | 1,178 (1,165–1,219) | 1,104 (1,074–1,119) | 10,043 (9,918–10,128) | 836 (821–895) |

WardenOne had higher renderer task time than Ghostery in all six controlled
page types, in both cache conditions and at both compared presets. Paired
five-block total differences were +1,179 ms for Recommended versus Ghostery
default and +1,411 ms for Maximum versus Ghostery maximum across the 12 visits.
Whole-browser CPU differences were smaller and more variable: paired medians
were +419 ms and +800 ms. WardenOne's measured peak native private memory was
lower by paired medians of 55 MiB and 48 MiB. The profiles have different
coverage and resource sets, so these are cost observations, not equal-protection
claims. Full per-page distributions, paired descriptive intervals and raw runs
are in the evidence JSON.

## Diagnostic attribution and lifecycle

Separate 1 ms CPU samples point to `__woStartWhenConfigured` and
`__woStartRuntime` in the content script during article initialization. The DOM
churn profile includes `mutationNodeMayAffectConsent`,
`mutationsMayAffectConsent` and `scriptDriftBatchHasScript`. The 30-frame
profiles include frame-specific hashing/HMAC and, in Maximum, fingerprint
noise; Maximum churn also sampled `deAmpUrl`. These are sample-level leads,
not proof that removing or caching a call would preserve behavior. The worker
profiles showed smaller samples for host/PSL normalization and configuration
snapshots. There was no isolated safe CPU change with a before/after comparison
in this phase, so no protection was relaxed to improve a benchmark score.

All 12 raw CPU profiles are retained. Three forced restarts per extension arm
preserved native dynamic rules. WardenOne's measured restart path ranged
140–175 ms; Ghostery's ranged 668–790 ms. Those times include the extension
page message and readiness checks, so they are not pure worker startup times.
After each separate 40-second unpinned idle interval, the extension worker was
still observed running in both products. This run therefore establishes no
natural-suspension latency comparison. Native idle CPU was observed once per
arm and remains descriptive rather than a distribution.

## Public-site observations

All 15 profiles completed their four attempts, and both products preserved
their warmed filter data and protection settings. WardenOne Recommended and
Maximum and Ghostery default and maximum practical each passed 12 of 12 live
readiness checks. The extension-off arm passed 9 of 12: its YouTube video
became paused after a short start in all three blocks. Those failed attempts
have no scored cost and prevent a complete no-extension YouTube comparison.

The table shows median renderer task time in milliseconds for the three
successful visits per cell. Live page responses, media and ads were not frozen.

| Page | WardenOne Recommended | Ghostery default | WardenOne Maximum | Ghostery maximum practical |
| --- | ---: | ---: | ---: | ---: |
| Wikipedia article | 430 | 367 | 448 | 360 |
| YouTube playback | 8,094 | 14,782 | 7,868 | 14,118 |
| Twitch playback | 3,705 | 2,538 | 3,690 | 2,540 |
| Google sign-in shell | 447 | 427 | 456 | 424 |

This live evidence is mixed: Ghostery used less task time on the article,
Twitch and sign-in shell, while WardenOne used less on the observed YouTube
playback sessions. The three runs do not establish why YouTube differed. The
sign-in check covers the login shell only, not an authenticated session. Live
content variability, small samples and unequal protection scope rule out a
universal winner. The controlled results remain the stronger cost comparison
for identical served bytes.

## Reproduction and retained limits

Run `tools/prepare-ghostery-performance.js` against the pinned G-00 snapshots
to create warmed seeds. The accepted seed manifest is
`tmp/ghostery-phase05/seeds-03/seeds.json`. The scored controlled command was
`node tools/browser-ghostery-performance.js --seeds tmp/ghostery-phase05/seeds-03/seeds.json --out tmp/ghostery-phase05/controlled-five-runs.json --runs 5`.
The public command adds `--public-only --runs 3`, and the lifecycle command is
`node tools/browser-ghostery-performance-lifecycle.js <seeds.json> <new-dir>`.
Each tool refuses to overwrite existing reports. Native artifacts, including
failed initial attempts, remain in the ignored local `tmp/ghostery-phase05/`
directory. `docs/ghostery-performance-evidence.json` hashes the accepted and
retained artifacts and includes the exact arm settings and raw distributions.

The public feed-host freeze and notification-history handling were added after
the controlled collection. The byte-exact scored harness is archived as
`tmp/ghostery-phase05/controlled-harness.js`; its SHA-256 matches the
controlled report. The G-05 result is pinned to that package fingerprint;
later runtime changes require a new measurement to make a new performance claim.
The source-budget repair restores feed availability but is
not a demonstrated CPU optimization. No release, commit or push is part of
this phase.
