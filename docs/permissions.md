# Browser permissions

The [permissions page](../permissions.html) explains, in plain terms, what WardenOne can reach in
your browser and why. This table goes one step further for anyone reading the code: it maps each
permission in the manifest to the feature that needs it and the file that uses it.

| Permission | Feature using it |
| --- | --- |
| `declarativeNetRequest` | `background.js` updates the static, dynamic and session blocking rules behind the network shields. |
| `declarativeNetRequestFeedback` | `background.js` reads which rules matched, for `logger.js`; no blocking decision depends on that feedback. |
| `storage` | `background.js`, `popup.js` and the other pages keep your settings, list state, local history and extension review state. |
| `activeTab` | Popup tools such as Element Zapper call `chrome.scripting.executeScript`, and popup and keyboard actions read details of the tab you're on. Broad site access already covers this on matching pages. |
| `scripting` | `background.js` registers and repairs the page shields; `popup.js` injects tools you ask for. |
| `webRequest` | `background.js` watches request, redirect and failure signals, and records Logger rows while that page is open. |
| `webNavigation` | `background.js` follows navigations and redirect chains, tab changes and the cleanup that runs when you leave a site. |
| `alarms` | `background.js` and the worker modules schedule feed refreshes, retries, reconciliation and Memory Shield work. |
| `browsingData` | `background.js` powers manual privacy clearing, Forget Me's storage wipe when you turn it on, service worker cleanup, and clearing the cache after a site is blocked. |
| `cookies` | `background.js` powers looking at and clearing cookies by hand, Forget Me, and clearing consent cookies when you leave a site, if you turn that on. |
| `history` | `background.js` uses `chrome.history.search/deleteUrl` only for Forget Me's separate “Also clear the site's browser history” switch. |
| `management` | `background-extension-watch.js` and `background-extension-reputation.js` watch for changes to your installed extensions; `extensions.js` disables or removes one when you ask it to. |
| `contentSettings` | `background.js` runs Script Shield lockdown and its site exceptions, and the scanner and reset for site permissions. |
| `contextMenus` | `background.js` adds the right click checks and page tools. |
| `downloads` | `background-downloads.js` watches new downloads and runs the Download Guard review. |
| `notifications` | `notification-manager.js` and the extension change code show local threat and security notices. |
| `offscreen` | Opens `offscreen.html` for alert sounds you've turned on and for copying a clean link you asked for, then closes it after a short idle period. |
| `clipboardWrite` | Copies a clean link you asked for from the extension's own document, so page scripts can't swap it. It never reads your clipboard. |
| `tabs` | `chrome.tabs.query/get` give Memory Shield and `findDuplicateTabs()` the addresses and titles of your tabs, even for a tab outside a current site grant. |

## Website access

`<all_urls>` makes automatic protection possible, along with threat feeds from other sites and
the page tools you start yourself. Your browser can hold back access to any site, so how much
WardenOne covers depends on what you allow for each one.
The separate `history` permission is only requested when you turn on the history cleanup it's
for.
