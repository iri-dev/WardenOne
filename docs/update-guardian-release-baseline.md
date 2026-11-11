# Update Guardian release sources

The popup looks up the public Stable release for the desktop browser and operating system it
finds itself in. It never decides your browser is current from a version number built into the
extension.

| Browser | Live source | Comparison |
| --- | --- | --- |
| Brave | [Public release version](https://versions.brave.com/), [desktop release notes](https://brave.com/latest/) and [official GitHub releases](https://github.com/brave/brave-browser/releases) | The version feed says which release is newest. When the browser shares its installed Brave version, that is what gets compared. Otherwise the Chromium version comes from the notes for that exact release, then from GitHub, as long as the version, tag and Stable status all match. If neither names a Chromium version, the comparison stays unknown and the release version is still shown. |
| Chrome | [VersionHistory API](https://developer.chrome.com/docs/web-platform/versionhistory/reference) | Uses the current Stable release with `fraction=1` for your operating system, so a rollout that hasn't reached everyone yet isn't treated as the latest. |
| Edge | [Edge Stable release data](https://edgeupdates.microsoft.com/api/products/stable) | Uses the newest Stable version for your operating system. Extended Stable and managed update schedules can run behind it, so a newer Stable release is a nudge to check, not proof that your browser is unsafe. |

A successful answer is remembered for six hours in the extension's session storage, and
**Check again** asks afresh. If a version feed fails or comes back malformed, the popup says it
doesn't know rather than calling your browser outdated or current. When only the major version
is visible, a match there doesn't prove the newest patch is installed. For any other browser you
get a link, or directions to its own update settings.
