# Onboarding feature coverage

Audited 16 October 2026 against `0f45d311ca0220faa38bee5665cf19d7f3180ea2` and the onboarding changes in this revision.

## Coverage

The guide has 173 entries in 22 expandable groups. The first-run flow remains Welcome, Pin, Protection and Explore. The full guide is optional, searchable and collapsed until opened.

| Inventory | Coverage |
| --- | --- |
| 105 protection switches | Shared names and descriptions from `settings-data.js` |
| 3 watch-only protections | Separate descriptions of what they record and their limits |
| 33 other popup controls | Shared Settings data, including tools, comfort, presentation, compatibility and second-level controls |
| 21 Settings mode/value controls | Grouped descriptions for memory timing, tab limits, WebGL, appearance, site card, EyeShield and notification settings |
| 23 Settings pages/subviews | Direct links validated against `settings.js` |

The detailed control keys are the same 141 registry/popup entries and 21 Settings entries inventoried in [the README audit](readme-control-audit.md). The onboarding coverage test compares the exact sets, rejects duplicate control coverage and checks every local destination and Settings inspector key. Four Memory Shield exception switches have no standalone description in the shared data, so the guide supplies short explanations for them.

## Additional tools and workflows

The guide also explains:

- Element Zapper selection, repeated removals, Done/Escape, page-lifetime undo and saved hidden-element restoration.
- YouTube, Twitch and Spotify AdShield; both Twitch rewind controls are in the shared inventory.
- Right-click tools, clean links, image/frame inspection, sleeping/closing tabs, site blocks and the Command Palette.
- Settings search, favorites, recent changes, comparison with Recommended and compatibility review.
- Section arrangement, site-card views, site pauses, per-site overrides, allowlists and exceptions.
- Memory profiles, never-sleep sites, tab limits and the separate Resource Saver controls, including GIF pausing, video previews, Ambient Mode and WebGL modes/site lists.
- EyeShield modes, adjustments and per-site profiles.
- Activity Centre, Notification Centre, display/sound choices, Protection Health, diagnostics, Verify and Repair, and Privacy Self-Test.
- Network Logger, Site Firewall, My Rules, Custom Lists and list freshness.
- Download Review, explicit local-file analysis in File Shield, and the manual VirusTotal URL scanner.
- Extension Security Centre, pre-install checks, Site Permission Scanner, browser update warnings and GitHub build notices.
- Seven optional reputation providers, their independently enabled checks, keys and data disclosures.
- Privacy Cleaner, WardenOne data erasure, settings backup/import, Session Security Grade and Emergency Logout.
- Network/DNS guidance, help, privacy, permissions, source, credits and licences.

## Corrections

- Replaced “40+ always-on” with the registry total and its switch/watch-only split. Available totals and fresh-install defaults are not presented as proof of live protection.
- Replaced eight threat feeds with seven optional reputation providers.
- Distinguished browser-download context checks from explicit local-file analysis.
- Distinguished IP lookup blocking from optional WebRTC hardening, with call/screen-sharing warnings.
- Disclosed all stronger-preset additions, including fraud/bot-check script blocking and the sign-in/purchase tradeoff.
- Explained that Recommended preserves existing advanced choices.
- Removed unconditional protection claims from welcome and completion, including when setup is reopened with the master switch disabled.

## Verification

The new gate suite checks inventory coverage, links, counts, stronger-preset disclosures, rendered entries and search behaviour. Existing onboarding bundle, site-card and pin-guidance suites pass.

The actual unpacked extension was checked in disposable Edge 150.0.4078.48 profiles: all 173 entries rendered without onboarding exceptions; GIF and WebGL searches worked; a guide link opened the GIF control in Settings; Maximum privacy followed by Recommended preserved WebRTC hardening; completing setup with `enabled: false` left it false. The 390 CSS-pixel layout had no horizontal overflow. Light and dark guide views were inspected.

Four screenshots were recaptured directly from the extension at a 1280×900 CSS-pixel viewport and 1.5× resolution. Welcome, Protection and Explore include complete cards; the guide capture includes the complete GIF search result. Lossless WebP copies retain the captured pixels. New dated paths avoid reusing the old onboarding images in the README.
