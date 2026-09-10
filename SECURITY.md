# Security policy

WardenOne is a browser security extension. If you find a vulnerability in WardenOne
itself, please do not publish exploit details or put secrets, live payloads, or affected
user data in a public issue.

## Supported versions

| Version | Security support |
| --- | --- |
| Current `main` / [`latest-build`](https://github.com/iri-dev/WardenOne/releases/download/latest-build/WardenOne-latest.zip) | Supported |
| Older tagged releases | Not patched separately; reproduce against the current build first |
| Third-party forks or redistributed builds | Not maintained by this project |

The rolling `latest-build` package is rebuilt from `main` after the repository gate
passes. Security fixes land there first unless a separate versioned release is announced.

## Report a vulnerability privately

Use GitHub's **[private vulnerability reporting form](https://github.com/iri-dev/WardenOne/security/advisories/new)**.
Only the repository maintainer and people explicitly added to the private advisory can
see the report.

Please include what you can safely provide:

- the affected WardenOne version or commit;
- browser name and version;
- the security boundary you believe can be crossed;
- the smallest reliable reproduction steps;
- the likely impact and who could be affected;
- a proof of concept with tokens, credentials, personal data, and harmful live targets removed.

If the problem concerns the malicious WardenOne impersonation rather than the extension's
own code, use the [incident page](https://iri-dev.github.io/WardenOne/stolen) instead.

## Safe research

- Test only against accounts, devices, sites, and data you own or have permission to use.
- Do not access other people's data, maintain persistence, disrupt a service, or use a finding to deliver malware.
- Give the maintainer a reasonable opportunity to investigate and fix the issue before public disclosure.
- Keep technical discussion inside the private advisory until disclosure timing is agreed.

WardenOne will not treat a good-faith report as abuse merely because the finding is
serious. Clear evidence and honest limits are welcome; exaggerated severity is not needed.

## Ordinary bugs

Site breakage, false positives, feature requests, and non-sensitive defects can use the
public [issue forms](https://github.com/iri-dev/WardenOne/issues/new/choose). Never include
passwords, session tokens, API keys, private files, or another person's data in an issue.
