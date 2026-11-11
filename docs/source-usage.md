# Protection source usage

WardenOne downloads the feeds you have switched on straight into your own browser and works
through them there. The extension never bundles or mirrors those raw feeds.

The [source inventory](source-inventory.json) records each feed's exact address, the terms that
apply to it, any written permission, its attribution and where it came from at build time. I
keep its input in [source-licensing.json](source-licensing.json), and the
[packaged notices](../THIRD_PARTY_NOTICES.html) carry the upstream credits and the licence texts
they require.

WardenOne relies on published licences and the written permissions I have on record. Their
conditions still apply: attribution, share alike terms, and OpenPhish's request that its feed is
downloaded directly from GitHub. None of these permissions grant access to anyone's API, and none
of them allow mirroring a raw feed.

## An open question about one source

The inventory records PA-1 for data that Phishing Army and flinteger derive from urlscan. Those
feeds stay configured. Until that question about scope is settled, the store submission stays
blocked; every other permission and condition on record remains in force.

## Rebuilding the inventory

```powershell
& "C:\Program Files\nodejs\node.exe" tools/build-source-inventory.js
& "C:\Program Files\nodejs\node.exe" tools/build-source-inventory.js --check
& "C:\Program Files\nodejs\node.exe" tools/check-store-rights.js
```
