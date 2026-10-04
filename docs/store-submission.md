# Chrome Web Store submission record

Status: **blocked pending upstream rights review (CWS-06)**. The Latest GitHub build
download is for GitHub users; it is not the Store upload candidate.
There is no Chrome Web Store Dashboard draft or submitted listing yet (30 September 2026).
The proposed copy below must be compared with the saved Dashboard fields before submission.

The [source-by-source research record](store-rights-research.md) tracks evidence for each input.
Unresolved sources remain in both builds and block Store submission.

## Listing source text

- **Name:** WardenOne
- **Single purpose:** WardenOne helps readers browse with more control: it blocks threats and
  trackers, defends privacy, warns about risky actions, offers optional page display controls
  for readability, and releases resources held by eligible idle tabs.
- **Short description:** Browser protection with privacy, readability and idle-tab resource controls.
- **Detailed description:** WardenOne checks pages, links, redirects and downloads
  with built-in lists and on-device signals. Optional external reputation providers
  require the reader's own API key and separate consent for automatic lookups.
  EyeShield offers optional brightness, contrast, warmth, saturation and grayscale
  adjustments for page readability and visual comfort. Memory Shield can discard eligible
  inactive tabs to release RAM while preserving active work and media; Tab Limit is an optional
  part of that resource control, with tab closing separately opt-in.
- **Privacy policy:** `PRIVACY.md` at the candidate commit. Its provider and
  retention disclosures must match the Dashboard's data-use answers.
- **Permission explanations:** `permissions.html` at the candidate commit.
  Compare every declared permission in `manifest.json` to the text submitted
  in the Dashboard.

The [package purpose record](store-single-purpose.md) explains the excluded feature.
Record the Dashboard comparison and any differences here once a draft exists. Chrome reviewers
decide whether this combination meets the single-purpose policy.

## Release procedure

1. Finish and commit the change. From a clean checkout of that exact commit, run
   `node tools/check-store-release.js` with Node 24. This single command runs the
   maintainability gate (syntax, tests, security and generated-file checks), the
   rights gate, builds the Store ZIP, audits every ZIP entry against the commit,
   and writes a sibling SHA-256 file. A green run names the exact ZIP to upload.
   It currently stops at the unresolved rights gate; do not bypass that failure.
2. Each runtime list and redistributed ruleset needs a release-owner
   decision in `docs/source-inventory.json`. Set `licenceVerified` only after
   reviewing the terms, and record `rightsReview` with `reviewer`, `reviewedAt`
   (YYYY-MM-DD), an HTTPS `evidenceUrl` for the terms, `termsRevision`, and
   `approvedUse` (`runtime-fetch` or `redistribution`). Set `noticeDisposition`
   to `not-required` or `included`; for `included`, list the shipped notice
   files in `noticeFiles` (`NOTICE`, `CREDITS.md`, `LICENSE`). For redistributed
   files, also record the exact `artifactSha256`. The gate rejects a changed
   artifact and incomplete decisions. Regenerating the inventory preserves
   decisions for unchanged source URLs and file names, but a new URL begins
   unreviewed. Review any changed generated artifact again before updating its
   digest. Current unresolved inputs remain in place and block submission.
3. Enable GitHub release immutability for future releases in repository Settings.
   Create a **draft** release at a new `store-candidate-<commit>` tag, attach the
   ZIP and JSON, then publish the release. Confirm GitHub marks it Immutable.
   Never attach the Store ZIP to a GitHub build release.
4. Download the candidate from its release URL and compare its SHA-256 with the
   JSON record. Upload that same ZIP to the Chrome Web Store without repacking.
   Compare the local upload file's digest again immediately before the upload.
5. Record the candidate tag, commit, ZIP digest, Store submission date, Dashboard
   listing/privacy comparison and reviewer outcome below. A new build requires
   a new tag, digest and review entry.

GitHub documents that [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
lock the tag and assets after publication; the setting applies to future
releases. A draft lets all assets be attached before publication.

| Candidate tag | Commit | ZIP SHA-256 | Submitted UTC | Dashboard comparison | Outcome |
| --- | --- | --- | --- | --- | --- |
| _none yet_ | | | | | |
