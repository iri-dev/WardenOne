# Privacy Badger rematch: Round 10 release maturity

Review date: 28 October 2026. The supplied rematch article describes the
27 October candidate. This review uses a fresh snapshot of the current local
WardenOne 1.0.2 candidate. The product version was not bumped. The candidate
has not been committed or pushed.

## Current candidate

`tools/prepare-release-review.js` built source and runtime archives from
temporary Git tree `3dceaf807cd17652b270d83b6475b0ce240ec8eb`. The real
index remains empty. All 147 runtime members match the reviewed source bytes;
generated content and settings reproduce exactly. The archive review found no
inventory, licensing-file, path, or bounded credential-scan errors. These
checks do not prove that arbitrary secrets are absent.

| Evidence | SHA-256 |
| --- | --- |
| Runtime ZIP | `38c0bf85ebeb6935749c3cb36897f392ac6cc2ca69c41bc4975ed23ee57bf69a` |
| Source ZIP | `96f16c89de94d770d28fc4e9289a6e9db11d8f18d4782beb983c891b063665f7` |
| Extracted runtime fingerprint | `990680d25b73846fe559f589f4a60d128bde5936747b4e100b7f9b537c22254a` |

That runtime fingerprint equals the candidate that passed the three saved-profile
upgrade lanes in [the Ghostery upgrade audit](ghostery-upgrade-audit.md).
`tools/check-package-archive.js` accepted the 147-file ZIP. `git diff --check`
passed, and the configured Git author is `iri <294003935+iri-dev@users.noreply.github.com>`.

## Exact-candidate browser acceptance

The frozen corpus in `tools/browser-release-rematch.js` ran five alternating
repetitions per arm in disposable Chrome 121 profiles. Candidate WardenOne and
the preserved Privacy Badger package each blocked all four tracker fixtures in
all five repetitions. Neither blocked a benign control. The original published
WardenOne build blocked three of four. The controlled editor, OAuth, SAML and
playback fixtures and forced-worker recovery passed for both candidates.
The fixed corpus does not measure live-site coverage or field reliability.

The current candidate passed all four baseline-relative performance limits.
Its startup median was 1,346 ms against a 1,388.75 ms ceiling; this margin is
small and should remain visible in release review. The other candidate medians
were 1,062.5 ms browser CPU at readiness, 3.07 MiB renderer JS heap, and
8.07 MiB worker JS heap. The matched Privacy Badger arm had lower browser CPU
and renderer heap; WardenOne reached readiness sooner and had the smaller worker
heap. Feature scope differs, so no total performance winner follows.

The new browser report has SHA-256
`8c566614b183b866c690153e771d2e3bce6e2dd4552648d0a99fc767ba5775e1`;
its summary has SHA-256
`93cc02f4669147703442c40f32ff6c86f5dda5da702ab60dd82f6c29011c6744`.
The full maintainability gate ran with this report in
`WARDENONE_RELEASE_REPORT`: native release acceptance and all 345 suites passed.
The gate log has SHA-256
`16bc65d494ef0eca92256e9dc43de7114c2b664a1538193095f1a5e8d120787e`.
Raw evidence is retained under `tmp/round10-release-review/`.

## Deployment state

GitHub `main` and the Latest ZIP still point to commit
`273c43a0051d6c3fe12c6871944ed7e8822d8af3`, not this candidate. The
repository's rolling workflow requires the maintainability, popup, settings,
minimum-Chrome and saved-profile-upgrade jobs before publishing. GitHub reports
that `main` has no branch protection. Local verification does not run those
remote jobs for an exact commit, prove a public Store submission, or create
years of field exposure.

The next publication step is a subject-only commit with the configured author,
then GitHub checks on a temporary branch for that exact commit. Only after they
pass should it be promoted to `main`; the required checks and rolling build must
finish before reporting a new public download. The owner has not requested a
commit or push for this round. Round 10 therefore remains Privacy Badger's on
established deployment maturity, while WardenOne's local release readiness is
now verified for this candidate.
