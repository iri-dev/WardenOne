# Frame injection cost

Reviewed 20 October 2026. The reported file sizes are close to the shipped files.
The cost is real: each eligible frame creates its own guard and bridge state,
listeners and initialization work. Source bytes alone do not measure renderer CPU
or retained memory. The main engine is top-frame-only, and several security
registrations have compatibility exclusions.

## Bounded change

The two optional Resource Saver modules previously loaded in every eligible frame,
even with their three controls off. Together they supplied 18,219 bytes of source
and made two `resource-saver-state` requests per document.

Their registration now follows the stored controls. Video preview or Ambient Mode
controls register `resource-saver.js`; animated-image saving registers
`animated-image-saver.js`. With all controls off, neither module loads. Enabling a
control also loads its module into already-open accessible tabs; existing modules
continue to receive the live state broadcasts that restore playback and images.
Disabling unregisters future injection. Code already running in an open document
remains until that document navigates, with its feature disabled.

Enabled modules retain `document_start`, isolated-world execution, all-frame
coverage and inherited-origin matching. Chrome supports this registration option
from version 119, below WardenOne's version 121 minimum.
[Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-RegisteredContentScript).

The anti-redirect guard, fingerprint realm bootstrap and security bridge retain
their early injection in every eligible frame. This change removes optional work;
the larger security modules still have a substantial per-frame cost.

## Verification

- The registration tests exercise disabled defaults, each optional control,
  selective module loading, registration updates, inherited-frame settings,
  failed writes, withheld host access and package omissions.
- The media browser regression checks that disabled modules are absent from
  normal, `about:blank` and `srcdoc` documents while each security bridge remains.
  Live enabling reaches those existing frames. It also checks GIF replacement and
  restoration, normal video playback, preview controls and YouTube fixture styles.
  Playback also advanced on W3Schools' real HTML video page with Resource Saver
  enabled and loaded in that document.
- `tools/perf-profile.js` now includes a 30-frame fixture. Both cold and warm-cache
  measurements begin from an empty document so navigation-reset counters are not
  reduced by the previous page's counters. A regression test models that reset.

Browser measurements use disposable profiles, the same local fixture and browser,
five runs per condition, and fourfold CPU throttling. Retained JS heap is measured
after collection; it does not include all native/browser memory. These results
describe this synthetic same-origin workload, not every site's frame/process layout.

Chromium 155.0.8059.85, Intel i5-12400F, cold-navigation medians:

| Whole 30-frame page | No extension | Before | After |
| --- | ---: | ---: | ---: |
| Renderer task time, ms | 922.93 | 2,665.76 | 2,617.57 |
| Script time, ms | 73.54 | 1,302.59 | 1,285.19 |
| JS heap after collection, MiB | 12.05 | 24.37 | 24.28 |

The task-time median fell by 48 ms (1.8%); warm-cache medians moved by 38 ms (1.4%).
Run distributions overlap, so this is a small change, not evidence of a broad
performance improvement. The remaining extension overhead on this fixture is
substantial. The deterministic saving is the optional modules and their two
requests per document: 62 startup requests avoided across the parent and 30 children.

Raw local runs, environment and readiness evidence are in
`docs/perf/frame-injection-2026-10-20.json` (gitignored, like the other browser profiles).
