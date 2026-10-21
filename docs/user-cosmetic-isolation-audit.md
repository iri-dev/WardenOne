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

## Hand-hidden selectors in the bridge

The bridge had a separate weakness: incomplete attribute selectors could absorb
subsequent individual CSS rules. Before the fix, the native Edge Zapper fixture
stored `#first`, `a[href=`, a valid quoted-attribute selector and `#second`.
Only the first element was hidden, and the sheet contained one parsed rule.

The bridge now validates each selector in an unattached native stylesheet and
requires the hide declaration to survive parsing before using its serialized
selector. Individual rules also have newline separators. The existing length,
injection-character, whole-document and rule-count boundaries remain in place.

The browser fixture covers an incomplete bracket, unfinished single/double
quotes, an unclosed function and an unsupported pseudo-class between valid
selectors. It checks actual visibility and CSS rule counts, then exercises
Zapper finishing, undo, reload and hiding with AdShield disabled. Unit coverage
also rejects a recovered CSS rule that lost its declaration.

The updated native fixture passed in Edge 150.0.4078.48 and Brave's Chromium
155.0.8059.85. Brave's first run passed selector isolation but timed out during
the later automated Undo click; a repeat passed the complete workflow.
