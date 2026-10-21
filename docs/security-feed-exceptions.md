# Single-feed exception review notes

These are the review notes previously kept beside `SECURITY_FEED_EXCEPTIONS` in
`background.js`. Dates describe those reviews; this comment cleanup did not
recheck the feeds.

The exception suppresses a conflicting single-feed verdict for the exact host
and its `www` form. It does not establish safety, exempt other subdomains or
override user rules and other protections.

| Host | Recorded review | Evidence recorded at that review |
| --- | --- | --- |
| `steamrip.com` | 2026-10-02 | Listed by flinteger's malicious aggregate, one of the sixteen security feeds checked. Other checked sources disagreed. This is a piracy site with associated risks, not a clean-record verdict. Listed lookalikes including `steamrip-en.pages.dev`, `steamrip.us.com` and `steamripzone.com` remain blockable. |
| `support.metamask.io` | 2026-10-17 | Consensys's MetaMask help centre. Listed by HaGeZi's medium threat-intelligence feed, with no other checked feed listing it. MetaMask's phishing configuration identified `metamask.io` as legitimate. Lookalikes such as `metamask.io-token.vip`, `app-metamask.io` and `metamask.io.in` remain separate domains. |
