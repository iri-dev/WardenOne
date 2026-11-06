# Protection source usage

WardenOne downloads configured feeds directly to each browser and processes them locally.
Runtime raw feeds are not bundled or mirrored by the extension.

The [source inventory](source-inventory.json) records exact URLs, applicable terms,
written grants, attribution and build provenance. Its maintained input is
[source-licensing.json](source-licensing.json). [Packaged notices](../THIRD_PARTY_NOTICES.html)
include upstream credits and the required licence texts.

Published licences and recorded written grants supply the basis for current use.
Conditions such as attribution, share-alike terms and the requested direct OpenPhish
GitHub download remain in effect. Permission records do not grant unrelated API access
or rights to mirror raw upstream feeds.

## Unresolved source scope

The current inventory records PA-1 for urlscan-derived data in Phishing Army and
flinteger. Those feeds remain configured. Store submission remains blocked on that
source-scope question; the other recorded grants and conditions remain in force.

## Rebuilding the inventory

```powershell
& "C:\Program Files\nodejs\node.exe" tools/build-source-inventory.js
& "C:\Program Files\nodejs\node.exe" tools/build-source-inventory.js --check
& "C:\Program Files\nodejs\node.exe" tools/check-store-rights.js
```
