# Update Guardian release sources

Reviewed 2026-10-01. The popup fetches public Stable release data for the detected desktop browser and operating system. It does not use a bundled version number to declare a browser current.

| Browser | Live source | Comparison |
| --- | --- | --- |
| Brave | [Public release version](https://versions.brave.com/) and [desktop release notes](https://brave.com/latest/) | The two sources must name the same Brave version. The notes provide its Chromium version. Compare the installed Brave version when the browser exposes it; otherwise compare the Chromium major only. |
| Chrome | [VersionHistory API](https://developer.chrome.com/docs/web-platform/versionhistory/reference) | Use the current Stable release with `fraction=1` for the detected OS, avoiding a staged rollout that has not reached all users. |
| Edge | [Edge Stable release data](https://edgeupdates.microsoft.com/api/products/stable) | Use the newest Stable version for the detected OS. Edge Extended Stable and managed update schedules can differ, so a newer Stable release is a prompt to check, not proof that the installation is unsafe. |

The popup caches a successful result for six hours in extension session storage. **Check again** bypasses the cache. A failed, malformed or inconsistent answer produces an unknown state rather than an outdated/current claim. When only the installed major version is visible, matching it does not prove the newest patch is installed. Other browsers get a link or directions to their own update controls.
