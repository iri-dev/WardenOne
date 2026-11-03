# Update Guardian release sources

Reviewed 2026-11-01. The popup fetches public Stable release data for the detected desktop browser and operating system. It does not use a bundled version number to declare a browser current.

| Browser | Live source | Comparison |
| --- | --- | --- |
| Brave | [Public release version](https://versions.brave.com/), [desktop release notes](https://brave.com/latest/) and [official GitHub releases](https://github.com/brave/brave-browser/releases) | The version feed identifies the latest release. Compare the installed Brave version when the browser exposes it. Otherwise use Chromium information from notes for that exact release, falling back to GitHub metadata with a matching version, tag and Stable status. If neither identifies its Chromium version, leave the comparison unknown while still showing the release version. |
| Chrome | [VersionHistory API](https://developer.chrome.com/docs/web-platform/versionhistory/reference) | Use the current Stable release with `fraction=1` for the detected OS, avoiding a staged rollout that has not reached all users. |
| Edge | [Edge Stable release data](https://edgeupdates.microsoft.com/api/products/stable) | Use the newest Stable version for the detected OS. Edge Extended Stable and managed update schedules can differ, so a newer Stable release is a prompt to check, not proof that the installation is unsafe. |

The popup caches a successful result for six hours in extension session storage. **Check again** bypasses the cache. A failed or malformed version feed produces an unknown state rather than an outdated/current claim. When only the installed major version is visible, matching it does not prove the newest patch is installed. Other browsers get a link or directions to their own update controls.

On 2026-11-01 the Windows x64 feed reported `1.98.63` while the desktop notes still described `1.98.62`. The [official release](https://github.com/brave/brave-browser/releases/tag/v1.98.63) identified Chromium `156.0.8078.80`. Their publication timing must not turn a valid release-version result into a fetch failure, and the older notes cannot establish the new release's Chromium version. GitHub metadata is fetched only when the installed product version and matching website notes are both unavailable, with a 600,000-character response limit and the same timeout, origin, cookie and referrer restrictions as the primary sources. A failed fallback retains the known release version without a current/outdated claim.
