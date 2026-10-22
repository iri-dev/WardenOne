# Infrastructure compatibility and security feeds

The shared domain and network-option parsers retain infrastructure hosts and
resource paths from security feeds. Ad/tracker compatibility filtering runs after
source classification, before candidates enter their rule buckets. When one feed
belongs to multiple categories, the existing strongest-source classification wins.

The compatibility domain set still protects against heuristic false positives
and overbroad ad/tracker lists. It is not a safety verdict for security feeds.
Known-logger and miner lists also retain individual infrastructure hosts; bare
public suffixes and opaque platform apexes remain invalid whole-host targets.
Existing individually reviewed single-feed exceptions remain separate.

Dynamic infrastructure allowances, session login allowances and packaged
infrastructure/login allowances now use priority 1,900. Downloaded security
blocks remain at 3,000; known-logger/miner resource blocks remain at 2,000.
Compatibility uses request-specific `allow` actions and retains its existing
host, resource and initiator conditions. User decisions retain their priorities.
Existing high-priority dynamic allowances are replaced by their owning appliers.

The ordering is deliberate: Chrome gives `allow` precedence over `block` when
their priorities tie. Security needs a strictly higher priority.
[Chrome DNR rule evaluation](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#rule-evaluation)

`tools/test-infrastructure-threat-precedence.js` exercises the shipped parsers,
classification gate, rule builders and legacy allowance replacement. It covers
plain, hosts-file, ABP, JSON and sliced inputs, path-scoped security rules,
platform-apex rejection and retained ad/tracker compatibility.

`tools/browser-media-security.js`, run in both Windows browser jobs, adds harmless
HTTPS fixtures on GitHub delivery and login origins. It checks a blocked path,
a neighboring compatible resource, and that blocked requests never reach the
server. A temporary legacy allowance reproduces the equal-priority bypass before
the corrected rules restore blocking. These tests do not fetch malicious content.
