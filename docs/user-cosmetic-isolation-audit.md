# User cosmetic selector isolation — 2026-10-20

The engine joined all user selectors into one CSS selector list. A malformed
attribute selector or an unsupported pseudo-class invalidated the entire rule,
including unrelated valid selectors. Native browser checks reproduce this with
`a:-abp-contains(x)` alongside two ordinary ID selectors.

Each user selector now goes through an unattached `CSSStyleSheet` separately.
Only the browser's serialized selector is admitted to the final batch, and only
if the appended `display:none!important` declaration survived parsing. That last
check prevents an unterminated comment from consuming the declaration and being
reinterpreted as a broader hide rule. The scratch sheet holds at most one rule;
the active document still receives one batched style rule. Empty user lists do
not allocate a parser sheet. The existing 5,000-selector, 400-character and CSS
injection-character boundaries remain in place.

The worker rejects known unsupported procedural operators, including
`:-abp-contains`, `:-abp-has`, `:contains` and extended matching/action operators.
Quoted attribute values, CSS escapes and comments do not trigger that check.
Native `:has` remains supported. Final CSS validity is decided by the page's
browser parser; the service worker does not emulate the CSS grammar.

The parser also rejects unsupported `#?#` and `#@?#` forms before network
classification. Previously they became `urlFilter` rules and consumed network
slots. Delimiter order matters: quoted `##` inside one of those rules does not
make it supported, and a literal unsupported marker inside a normal `##` CSS
selector does not invalidate that selector. Parser/allocation tests cover counts,
contiguous IDs and a subscription using the last available network slot; write
handler tests verify that reapplying editor/import text removes legacy misfiled
rules from the network band.

## Regression evidence

The parser suite checks skipped-line reasons, mixed lists, native `:has`, quoted
operator text and escaped selectors. Browser smoke checks compare the failing
raw selector-list control with the shipped compiler for malformed attributes,
unknown/unsupported pseudo-classes, unclosed functions, strings and comments.
They also check comma-containing valid selectors, pseudo-elements, 5,000-selector
batch parsing, injection-character rejection and empty input.

The end-to-end browser check saves imported cosmetic text and loads a cached
subscription through the real worker bundle. Four valid user/list selectors
continue hiding their target elements around malformed selectors. Unsupported
operators appear in the import response's skipped-line errors.

Validation passed in Edge 150.0.4078.48 and Chrome 121.0.6167.184, alongside all
292 suites in the maintainability gate. The generated engine was rebuilt.

The parsing/serialization boundary follows the [CSSOM insertRule algorithm](https://drafts.csswg.org/cssom/#dom-cssstylesheet-insertrule)
and [selector-list validity rules](https://drafts.csswg.org/selectors/#grouping).
