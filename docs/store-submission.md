# Chrome Web Store submission record

Status: **blocked pending upstream rights review (CWS-06)**. The rolling `latest-build`
download is for GitHub users; it is not the Store upload candidate.

## Listing source text

- **Name:** WardenOne
- **Single purpose:** Protect web browsing from malicious sites, trackers and unsafe
  requests, while giving the reader local controls and warnings.
- **Short description:** Browser protection for malicious sites, trackers, risky
  downloads and privacy threats, with local controls and clear warnings.
- **Detailed description:** WardenOne checks pages, links, redirects and downloads
  with built-in lists and on-device signals. Optional external reputation providers
  require the reader's own API key and separate consent for automatic lookups.
  The Store package omits EyeShield, Memory Shield, Tab Limit and Twitch Rewind;
  see [the package purpose record](store-single-purpose.md).
- **Privacy policy:** `PRIVACY.md` at the candidate commit. Its provider and
  retention disclosures must match the Dashboard's data-use answers.
- **Permission explanations:** `permissions.html` at the candidate commit.
  Compare every declared permission in `manifest.json` to the text submitted
  in the Dashboard; do not infer approval from the presence of this file.

The publisher must compare this record with the live Dashboard fields immediately
before submission and record any differences here. The repository cannot read
unpublished Dashboard settings.

## Release procedure

1. Finish and commit the change. Run `node tools/check-maintainability.js` on a
   clean checkout of that exact commit.
2. Run `node tools/build-store-candidate.js`. It builds the Store profile from
   `HEAD` into ignored `.store-candidates/`, with a commit-and-digest filename.
   The sibling JSON records the exact ZIP SHA-256, byte length and every file
   hash. Run `node tools/build-store-candidate.js --verify <attestation.json>`.
3. Before publishing or uploading that candidate, run `node tools/check-store-rights.js`.
   It must pass. Each runtime list and redistributed ruleset needs a release-owner
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
4. Enable GitHub release immutability for future releases in repository Settings.
   Create a **draft** release at a new `store-candidate-<commit>` tag, attach the
   ZIP and JSON, then publish the release. Confirm GitHub marks it Immutable.
   Never attach the Store ZIP to the mutable `latest-build` release.
5. Download the candidate from its release URL and compare its SHA-256 with the
   JSON record. Upload that same ZIP to the Chrome Web Store without repacking.
   Compare the local upload file's digest again immediately before the upload.
6. Record the candidate tag, commit, ZIP digest, Store submission date, Dashboard
   listing/privacy comparison and reviewer outcome below. A new build requires
   a new tag, digest and review entry.

GitHub documents that [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
lock the tag and assets after publication; the setting applies to future
releases. A draft lets all assets be attached before publication.

| Candidate tag | Commit | ZIP SHA-256 | Submitted UTC | Dashboard comparison | Outcome |
| --- | --- | --- | --- | --- | --- |
| _none yet_ | | | | | |
