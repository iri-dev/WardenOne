# Ghostery Phase 00 baseline

Recorded 2026-10-27. This starts the separate Ghostery roadmap; it changes no
WardenOne runtime behavior, defaults, permissions, version or protection count.
Existing protections remain part of the product. No commit or push is requested.

## Frozen inputs

WardenOne is version **1.0.2**, based on commit
`273c43a0051d6c3fe12c6871944ed7e8822d8af3`, with the completed local work included
in an explicitly labelled **uncommitted Git tree**. The runtime has 136 files and
fingerprint `58da749fd6b6c6f80c402b3e8f5d59fbea0d0531900025170ff58e9060bd3d19`.
That matches the previously validated runtime. Development-source and runtime ZIPs
are retained separately; generated outputs and every shared archive member are
checked. The real Git index is untouched.

The registry has **110 protections**: 107 shield keys and three watch-only keys.
Of these, 80 are on by default and 30 are off. This is a registry count, not a
comparative effectiveness score. Full defaults and recommended settings are
captured in `snapshots.json`. Fingerprint noise is off; consent auto-rejection and
privacy signaling are on. Optional provider credentials are empty/redacted.

Ghostery is pinned to [v10.6.7](https://github.com/ghostery/ghostery-extension/releases/tag/v10.6.7),
commit `3dfc1c88ad681f181b96308436eaa2bbc9332aa3`, source tree
`d44213ebe7e3d790fe198c1adfcca18cf093bab4`. All **587 source blobs** and the
reconstructed Git tree match the pinned GitHub metadata. The normal Chromium
release package is used, with its published SHA-256 verified:
`b6a5fcaec8b9c0d07ee9a44ddf137761501569c56521e5dfa64107e54d41a5d3`.
Its 1,360 runtime files have fingerprint
`8b312cdc7e2c06b7ec021c5350c223bb3ef414d543d3336c5d841a1eb78bcd1d`.
The source ZIP SHA-256 is
`aee9cfd54219117e602e20540ee349fba79b5c8650fe9bc53e8d04d9d8cb6435`.
The vendor associates these source and release versions; a reproducible vendor
build has not been established. No Ghostery code or data is added to WardenOne.

## Environment and readiness

Windows 10 Pro N, build 10.0.19045, x64; Intel Core i5-12400F, 12 logical CPUs;
34,095,611,904 bytes OS-visible physical RAM reported by Node; Node 24.18.0. Browsers are
Chrome **121.0.6167.184** with software GL and Edge **150.0.4078.48**. Both use
fresh disposable headless profiles. Executable hashes, manifests, declared
ruleset counts/hashes, settings, vendor data-dependency revisions and native
resource checksums are recorded in the evidence files.

The fixture is a loopback HTTPS article/editor and same-site fetch. Extension-off,
WardenOne and the unmodified Ghostery package all load and preserve editing in
both browsers. Both extensions expose JavaScript GPC as true and send
`Sec-GPC: 1` on this fixture. Toggle, exception and saved-consent parity still
belong to G-03.

A strict offline fresh Ghostery profile did not initialize its filters. The
source's engine loader fetches its first engine data from the Ghostery CDN.
Final probes therefore allow only **cdn.ghostery.com** for Ghostery updates;
other remote DNS is refused and proxies are disabled. The fixture certificate
exception is restricted to its public test SPKI; CDN TLS is validated normally.
Ghostery's readiness hook returns `done`. Its default ads/tracking/annoyance/
redirect packs are enabled, with 2,170 dynamic rules in the observed state.
WardenOne uses its packaged data, with 156 dynamic and 162 session rules.

These data states are **unmatched and unscored**. This phase establishes pinned
inputs and functional readiness. G-05 must freeze comparable updated data and
repeat default/max-protection workloads before awarding a performance or
detection result. Browser rule counts alone establish neither quality nor cost.
Outbound-host observations start after worker attachment and cannot establish
a complete privacy-traffic claim.

Initial adapter failures are retained: the extension context can arrive after
the worker target, and dynamic imports are unavailable inside service workers.
The final adapter waits for the extension API, reads Ghostery's existing Options
model from its private settings page, and uses its read-only readiness hook.
No vendor files or settings are rewritten. Temporary download-signature query
strings are omitted from metadata.

## Findings and before/after contracts

- **Consent reporting — reproduced helper behavior:** WardenOne's `clickControl`
  returns true when an eligible fixture button's `.click()` throws. This is a
  confirmed reporting-contract gap, not proof that a real CMP saved consent.
  G-03 must distinguish dispatch, failure and verified opt-out while preserving
  sensitive-dialog exclusions. The observation is saved with the source hash.
- **GPC — existing coverage:** JavaScript and header surfaces both exist. The
  default-on fixture passes; state transitions and exemptions remain unverified
  under the Ghostery acceptance criteria.
- **Tracker identity — partial:** source/confidence/domain evidence exists;
  product/company/category attribution and unfamiliar identifier-value reuse
  need their own work. Attribution must not silently authorize blocking.
- **Fingerprinting — existing suite:** audio/canvas/descriptors/frames/workers,
  editing and playback coverage can be reused. Worker limitations and opt-in
  noise remain explicit; anonymity requires linkability evidence.
- **Recovery — partial:** current overrides, pause expiry and rule authority are
  foundations. A guided narrowest-first flow, safe undo and redacted preview are
  still G-07 work.
- **DNR and boundaries — existing suite:** retain atomic batches, sender/schema
  validation, owner precedence, quotas and interruption recovery. The pinned
  Ghostery [converter](https://github.com/ghostery/ghostery-extension/blob/3dfc1c88ad681f181b96308436eaa2bbc9332aa3/src/utils/dnr-converter.js)
  mutates its rule array during iteration, and its
  [custom-rule writer](https://github.com/ghostery/ghostery-extension/blob/3dfc1c88ad681f181b96308436eaa2bbc9332aa3/src/background/custom-filters/dnr.js)
  removes then adds in separate calls. These are source-supported failure
  scenarios; no installed-client exploit was demonstrated here. G-08 must test
  analogous WardenOne failures without weakening existing assertions.
- **Upgrades — gap:** build/provenance checks and migration simulations exist.
  They do not prove an actual older extension release upgrades in the same
  browser profile while preserving decisions. That remains G-09 work.

## Workstream checklist

[ghostery-roadmap-status.json](ghostery-roadmap-status.json) registers every
G-01–G-09 checklist item, accountable modules, current coverage, remaining gap,
regression files and evidence slots. No feature phase is marked complete merely
because related tests already exist. Order:
**00 → 08 → 03 → 09 → 04 → 05 → 01 → 02 → 07 → 06**.
The original roadmap is identified by SHA-256. No GitHub issue is created.

The short regression list is consent outcomes, tracker identity/unknowns,
fingerprint consistency, scoped recovery/expiry, DNR atomicity/ownership, and
real saved-profile upgrades. Existing test references live in the status file;
each completed phase must add change and passing-validation evidence.

## Reproduction

Use a new output directory; baseline preparation and probes refuse overwrites.
The vendor metadata file contains the immutable commit, tree and published
release digest. Source and release archives remain under gitignored
`tmp/ghostery-phase00/`.

```powershell
& 'C:\Program Files\nodejs\node.exe' tools/prepare-ghostery-baseline.js tmp/ghostery-new tmp/ghostery-phase00/vendor-reference.json tmp/ghostery-phase00/ghostery-source.zip tmp/ghostery-phase00/ghostery-chromium-10.6.7.zip 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:WARDENONE_HEADLESS='1'
& 'C:\Program Files\nodejs\node.exe' tools/browser-ghostery-baseline.js tmp/ghostery-new/snapshots.json 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' tmp/ghostery-edge-new.json --vendor-updates
& 'C:\Program Files\nodejs\node.exe' tools/test-ghostery-baseline.js
& 'C:\Program Files\nodejs\node.exe' tools/check-maintainability.js
```

For the full gate in this uncommitted checkout, use a temporary `GIT_INDEX_FILE`
and populate it with the local changes, as the existing release audit describes.
For Chrome 121, use its pinned executable and `WARDENONE_SOFTWARE_GL=1`.
Parallel native probes are readiness checks only; timed G-05 profiles must be
serial and separated from the gate and other workloads.

Rollback is removal of this phase's development tools and Ghostery audit/status
files plus its gate registration. No protection settings or production state
need migration or rollback. Existing protection, licensing and release checks
remain in place. Final hashes and gate results are recorded in
`ghostery-baseline.json` after validation.

## Completed validation

All **334 test suites** pass, along with syntax/generated-byte checks, package
allowlist/licensing/quota checks and the final two-browser readiness probes.
`git diff --check` passes and the real index is unchanged. Phase 00 is complete;
G-01 through G-09 remain planned with partial prior coverage, and G-08 is next.

The final provenance snapshot is `tmp/ghostery-phase00/baseline-final/snapshots.json`.
It includes the finished development tools and audit files; runtime fingerprints
must match the earlier native-tested `baseline-01` inputs. Source-only additions
can change the source-tree/ZIP identities. Browser reports retain the exact
harness hash, enabled rules, granted permissions, resolved defaults and CDN
resource checksums. Earlier failed attempts remain local evidence.
