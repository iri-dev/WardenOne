# Phishing verdict comparison around `10eced2`

The `tools/test-phishing-differential.js` corpus runs the worker functions from the
revision before `10eced2`, from `10eced2`, and from the working tree. Run the
historical comparison locally with:

```powershell
& "C:\Program Files\nodejs\node.exe" tools/test-phishing-differential.js --compare-ref
```

The normal maintainability gate checks the recorded before/after expectations
without requiring Git history in a shallow CI checkout. The corpus uses `.example`
hosts as synthetic inputs. It tests verdict behavior; it makes no claim that a
synthetic domain is active or malicious.

Of 47 focused host/path cases, 13 warned before `10eced2` and stopped warning
at that commit:

| Host and path | Reason for change | Current decision |
| --- | --- | --- |
| `disboard.org/servers`, `disboard.org/login` | Disboard is an independent Discord server directory, two edits from `discord`. | Keep allowed. |
| `discordbotlist.com/login`, `discordservers.com/login`, `discord.me/login`, `thediscordlist.com/login` | Independent bot and server directories must be able to use their own account paths. Their homepages were not flagged before or after the change. | Keep allowed. |
| `discords.example/` | A plain one-letter suffix can describe a separate site. | Keep allowed. |
| `discordservers.example/account/login` | The site's own account path does not prove it impersonates Discord. | Keep allowed. |
| `steamrip.com/account/login`, `protondb.com/login`, `applebees.com/login` | An independent name containing a brand word plus its own login path is insufficient evidence. | Keep allowed. |
| `discrod.example/login`, `dicsord.example/login` | Reducing the typo distance from two to one also dropped adjacent-letter swaps. | Restore as medium-confidence typosquats. |

The directory names above are based on the sites' own descriptions:
[Discord Bot List](https://discordbotlist.com/),
[DiscordServers](https://discordservers.com/),
[Discord Me](https://discord.me/explore), and
[TheDiscordList](https://thediscordlist.com/). The tests check hostname heuristics,
not a safety verdict or endorsement for any third-party service.

## All-brand regression matrix

The gate derives a common set of 1,485 host/path cases from every shipped brand
profile: 21 worker profiles and 100 in-page entries, including the `twitch_tv`
alias of Twitch. For every profile it checks all listed official domains and
their subdomains, unrelated `fans` and `guides` names with an account path,
`brand-login` and `login-brand` lures, bare brand subdomains, official-looking
domains nested under an attacker site, adjacent-letter swaps, repeated letters,
and digit swaps where the token has an `o`. Positive cases must name the right
brand. The historical mode runs the same worker matrix against both sides of
`10eced2` and checks that every dropped warning on a phishing-shaped case has
been restored.

That broader comparison found 49 worker warning losses at `10eced2`: 36
`fans`/`guides` cases, which should stay clear, and 13 adjacent-letter swaps,
which now warn again. The current matrix also exposed six benign names that
the worker still misread because its sign-in-word search found `password` in
`1password`, `bank` in `bankofamerica`, or `mfa` across the join in
`instagramfans` and `steamfans`. Sign-in words now have to occur outside the
matched brand token. Seven official-looking nested domains, including
`steampowered.com.attacker.example`, were missed by the page detector and now
receive a medium-confidence warning.

The regression corpus also covers `d1scord`, `disc0rd`, repeated letters,
`discord-login`, `login-discord`, `rn`/`m` and `vv`/`w` visual swaps, exact and
nested brand subdomains, and `discord.com` placed under another registrable
domain. It checks the worker login and startup verdicts and the in-page detector.
The startup check previously reduced a hostname to its registrable domain before
the brand test, so it missed subdomain spoofs despite the login check warning.
It now tests the full hostname when a subdomain also carries a sign-in cue or
nests an official-looking domain, such as `discord.com.evil.example`. Bare
brand-named subdomains remain outside startup warnings because ordinary sites
such as `apple.stackexchange.com` use them too. The login and page detectors
still warn on those at lower confidence. A hyphenated `discord-login` subdomain
is also covered by the in-page warning at medium confidence.

This is a regression corpus, not a claim that phishing detection is complete.
A warning from a domain shape is a heuristic, and the benign cases remain in
the gate to catch renewed false positives. The `.example` hosts are synthetic.

## Sign-in words in URL paths

Before `10eced2`, a brand word anywhere in a registrable hostname plus an
authentication word anywhere in the full URL caused a worker hard warning when a
visible password field appeared. The change removed that path contribution from
`brand-in-name`. Historical comparison now also checks eight examples:
`discord-help.example` and `steam-support.example` each with `/login`, `/verify`,
`/account`, and `/oauth`. All eight warned before the change and stopped warning
at that commit. Their paths alone still do not trigger a worker hard block: that
would also block independent services such as Disboard and Discord Bot List on
their own account pages. Domain typos, brand subdomains, host-based sign-in lures,
and domains younger than the configured age limit continue to warn regardless
of those paths.

The credential-form detector now uses an exact sign-in path segment as one
corroborating point when the password form itself claims to be a protected brand
on a different domain. `/login`, `/verify`, `/account`, `/oauth`, `/oauth2`, and
common script extensions count, including case or percent-encoded letters;
matching words only in a query or fragment do not. This brings a claimed-brand
form to the warning threshold without treating the URL path as proof. Discord
and Steam are included in that form-claim check. A heading for an independent
name such as “Sign in to Discord Bot List” does not count as “Sign in to
Discord.” “Continue to Google” describes an OAuth redirect, so it does not
count as a claim that the host is Google. Nor does a “Google login” button
beside a third-party site's own password form. The gate runs the actual worker
verdict and form scorer against phishing-shaped and ordinary sign-in examples
for all four requested paths.

This still has a limit: an established attacker domain with a plausible brand
word, a sign-in path, and a password form that avoids a textual brand claim can
evade these particular heuristics if the other reputation and behavior layers
find nothing. A path is attacker-controlled text and cannot safely establish
impersonation by itself. The test records that residual instead of treating a
path-only hard warning as a fix.

## Visual substitutions and internationalized names

The worker and page detector now share regression cases for additional ASCII
lookalikes: `2/z`, `6/g`, `8/b`, `9/g`, repeated `1/l`, and combinations such
as `m1cr0s0ft`. Ambiguous `1/i` remains a warning when it is one edit away;
it is not promoted to a high-confidence automatic block. The search-result
marker also checks examples with two substituted digits.

The [RFC 3492 Punycode decoder](https://www.rfc-editor.org/info/rfc3492/)
in `domain-utils.js` lets both the worker and page detector compare encoded
IDN labels with protected brands. `tools/build-idn-confusables.js` now derives
a compact table from Unicode 18.0.0's official
[UTS #39 confusable data](https://unicode.org/reports/tr39/). It retains all
1,792 non-ASCII source characters whose complete prototype is made from ASCII
letters or digits, because those are the mappings capable of becoming one of
WardenOne's protected ASCII brand names. The earlier reviewed Cyrillic and
Greek additions remain where Unicode deliberately chooses a non-ASCII
prototype. Normalisation uses NFD and removes default-ignorable characters in
the same order as the UTS #39 internal-skeleton algorithm.

The generated table is expanded only when a Punycode label is inspected. Its
version, source date, SHA-256, mapping count, ordering and cross-script sentinel
entries are checked offline by the gate; updating it fetches the current
Unicode file or accepts a reviewed local copy. The behavioural matrix compares
the decoder with the platform's IDN conversion and checks thirteen named
spoofs across Cyrillic, Greek, Latin, Armenian, Coptic, Lisu and Cherokee. It
also substitutes a confusable character in every one of the 21 worker brand
profiles. Exact matches warn as homographs, while seven ordinary IDNs remain
clear.

Previously the worker hard-blocked **every** Punycode sign-in host, and search
results marked every Punycode name suspicious. That included unrelated
internationalized domains. The warning now requires a protected-brand
lookalike, a separate domain-age signal, or another independent protection.
This remains an ASCII-brand detector rather than a general implementation of
the UTS #39 bidirectional skeleton: prototypes that cannot become an ASCII
brand are omitted, and bidirectional display reordering is not reproduced.
Those boundaries must not be described as complete Unicode confusable
detection.
