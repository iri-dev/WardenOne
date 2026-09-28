# Warning and EyeShield accessibility audit

Date: 2026-09-28. Local checkout only; no release claim.

## Design decision

Warning accessibility is automatic. It is not an EyeShield setting: someone must be able to read
and leave a warning even when EyeShield is off. EyeShield's **More reading controls** groups visual
adjustments for pages. The warning pages use ordinary document landmarks and headings; only the
in-page overlays that contain keyboard focus carry `alertdialog` and `aria-modal` semantics.

## Checks completed

Run `& "C:\Program Files\nodejs\node.exe" tools/browser-accessibility-audit.js` with Node 22+ and
Edge on Windows. It loads this
checkout as an unpacked extension in a disposable browser profile and opens the actual redirect,
certificate, Safe Browsing and Download Guard warning pages plus the popup opened in a tab. It checks browser
accessibility roles and names, keyboard focus, a 320 CSS-pixel viewport (the reflow target for
400% zoom at a 1280-pixel browser width), and Edge's forced-colors rendering. It also tests the
Safe Browsing disclosure and its delayed action. It also applies actual 400% browser zoom to
EyeShield and Safe Browsing in the disposable profile, then opens the actual toolbar popup to check
its intended width and footer layout. `& "C:\Program Files\nodejs\node.exe" tools/browser-warning-integrity.js` checks
the real in-page warning's named dialog, initial focus, Tab containment and focus after a hostile
page removes its host. These browser checks passed on this checkout.

`tools/test-warning-accessibility.js` and `tools/test-warning-dialogs.js` run in the maintainability
gate. They protect the disclosure focus and announcement, EyeShield slider values, warning dialog
semantics, keyboard containment, disabled-control exclusion and focus restoration.

## Spoken screen-reader pass still required

The browser accessibility tree exposes the roles and names that screen readers consume, but it
does not prove what Narrator or NVDA actually speaks. A human Windows assistive-technology pass is
still needed before claiming full screen-reader verification:

1. Enable Narrator or NVDA and reach each warning through a real browser flow. Confirm the title,
   reason, destination and safe action are spoken in reading order. Check both valid and expired
   warning records.
2. Use Tab and Shift+Tab on in-page alert dialogs. Confirm focus starts on a safe action, stays in
   the dialog, and returns to the initiating control when it closes. For an intentionally blocked
   action, confirm Escape does not silently continue it.
3. On Safe Browsing, open **This looks wrong** with Enter. Confirm **Before you continue** is
   announced, the report action is reachable immediately, and the continue action is announced
   only when its delay ends.
4. At 400% browser zoom and with a Windows contrast theme enabled, check the popup's EyeShield
   modes, sliders and typed values, then repeat the safe and risky warning actions. Verify visible
   focus and that no essential action needs horizontal scrolling.

The local automated checks use a narrow viewport, actual browser zoom and forced-colors CSS in
Edge. They do not toggle the user's Windows contrast theme or capture spoken screen-reader output.

Reference: [W3C WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
and [WCAG reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
