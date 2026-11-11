# Security policy

WardenOne is a security extension, so a hole in WardenOne itself matters a lot to me. If you
find one, please don't publish exploit details, and please don't put secrets, live payloads or
anyone's data in a public issue.

## Supported versions

| Version | Security support |
| --- | --- |
| Current `main` / [Latest build](https://github.com/iri-dev/WardenOne/releases/latest/download/WardenOne-latest.zip) | Supported |
| Older tagged releases | Not patched separately; please reproduce against the current build first |
| Forks and copies other people publish | Not maintained by me |

The Latest package is built from `main` once the repository gate passes. Security fixes land
there first, unless I announce a separate versioned release.

## Tell me privately

Please use GitHub's **[private vulnerability reporting form](https://github.com/iri-dev/WardenOne/security/advisories/new)**.
Only I, and anyone I deliberately add to the private advisory, can see what you send.

It helps a lot if you can include, where it's safe to:

- the WardenOne version or commit you tested;
- your browser and its version;
- the security boundary you think can be crossed;
- the smallest steps that reliably reproduce it;
- what you think the impact is, and who it could affect;
- a proof of concept, with tokens, passwords, personal data and harmful live targets taken out.

If you've come across the fake WardenOne that was used to spread malware, rather than a problem
in the extension's own code, the [incident page](https://iri-dev.github.io/WardenOne/stolen) is
the right place.

## Researching safely

- Only test against accounts, devices, sites and data that are yours, or that you have permission to use.
- Please don't access other people's data, stay inside a system, disrupt a service, or use what you find to deliver malware.
- Give me a fair chance to look into it and fix it before anything goes public.
- Keep the technical discussion inside the private advisory until we've agreed when to disclose.

A report made in good faith will never be treated as abuse just because the finding is serious.
Clear evidence and honest limits are always welcome. You don't need to make it sound worse
than it is for me to take it seriously.

## Ordinary bugs

Broken sites, false alarms, feature ideas and anything else that isn't sensitive can go
through the public [issue forms](https://github.com/iri-dev/WardenOne/issues/new/choose). Please
never include passwords, session tokens, API keys, private files or someone else's data in an
issue.
