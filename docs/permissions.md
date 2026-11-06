# Browser permissions

The [permissions page](../permissions.html) explains browser access in user-facing terms.
This table maps each manifest permission to its feature and code dependency.

| Permission | Feature using it |
| --- | --- |
| `declarativeNetRequest` | `background.js` updates static, dynamic and session blocking rules for network shields. |
| `declarativeNetRequestFeedback` | `background.js` reads matched rules for `logger.js`; no blocking decision depends on the feedback. |
| `storage` | `background.js`, `popup.js` and other pages hold configuration, list state, local history, and extension review state. |
| `activeTab` | Popup tools such as Element Zapper call `chrome.scripting.executeScript`; popup and command actions also read current-tab metadata. Broad host access already covers these operations on matching pages. |
| `scripting` | `background.js` registers and repairs page shields; `popup.js` injects user-invoked tools. |
| `webRequest` | `background.js` observes request, redirect and failure signals and captures Logger rows while its page is open. |
| `webNavigation` | `background.js` follows navigation and redirect chains, tab changes and on-leave cleanup. |
| `alarms` | `background.js` and worker modules schedule feed refresh, retries, reconciliation and Memory Shield work. |
| `browsingData` | `background.js` powers manual privacy clearing, Forget Me's opted-in storage wipe, service-worker cleanup and cache cleanup after blocking a site. |
| `cookies` | `background.js` powers manual cookie inspection/cleanup, Forget Me and opted-in on-leave consent-cookie cleanup. |
| `history` | `background.js` uses `chrome.history.search/deleteUrl` only for Forget Me's separate “Also clear the site's browser history” switch. |
| `management` | `background-extension-watch.js` and `background-extension-reputation.js` watch installed-extension changes; `extensions.js` handles requested disable/uninstall. |
| `contentSettings` | `background.js` controls Script Shield lockdown and site exceptions and implements the site-permission scanner and reset. |
| `contextMenus` | `background.js` installs right-click checks and page tools. |
| `downloads` | `background-downloads.js` watches new downloads and drives Download Guard review. |
| `notifications` | `notification-manager.js` and extension-change code show local threat and security notices. |
| `offscreen` | Opens `offscreen.html` for enabled alert sounds and user-requested link copying, then closes it after a short idle period. |
| `clipboardWrite` | Copies a requested clean link from the extension's document so page scripts cannot replace it. Does not read the clipboard. |
| `tabs` | `chrome.tabs.query/get` supply URLs and titles to Memory Shield and `findDuplicateTabs()` even when the tab is outside a current host grant. |
| `activeTab` | Works |
| `tabs` | Works |

## Website access

`<all_urls>` supports automatic protection, cross-origin threat feeds and user-invoked page tools.
Chrome can withhold site access; coverage depends on the browser grant for each site.
The separate `history` permission is requested only when its history-cleanup feature is enabled.
