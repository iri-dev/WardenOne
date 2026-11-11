# Design direction: true to the product, evidence first

I want the site to look like the thing it describes. Its colours come straight from the
extension's `theme.css`: violet `#783593`, pink `#a33b72`, and the deep plum stage (`#120b18` →
`#432157`) the extension's own pages use. Someone who installs WardenOne should recognise the
popup they just saw on the website.

The first screen has one job: show a real WardenOne warning at the moment a scam instruction
appears. The captures are real. Anything around them is labelled as framing for the page, and the
installation diagrams are labelled as illustrations. The claims stay as careful as the README's:
nothing is ever called "safe", and the limits are said out loud.

## Structure

- **Stage panels.** Inset, rounded panels with a soft aurora and a faint grid hold the hero, the
  principles band and each closing call to action. They're deep plum in the dark theme and a soft
  lilac in the light one.
- **Hero.** A browser window showing the real ClickFix warning, with the real popup overlapping
  it and two numbered callouts. The caption says the captures were arranged for the page.
- **Numbers.** Protections, network rules that ship with the extension, public lists, and zero
  accounts. Every figure comes from `src/data/catalogue.json`, which `sync-data.js` writes from the
  extension repository.
- **Product tour.** One set of tabs over six real captures (scam warning, download review,
  Activity Centre, Site Firewall, Element Zapper and Self Test). The Zapper tab is a slider
  between before and after. Without JavaScript, every panel is shown one after another.
- **Principles.** "Unknown does not mean safe" and the README's three rules, in a stage panel.
- **Feature catalogue.** Every feature, control and tool, grouped into six categories, with the
  extension's own descriptions and default labels. With JavaScript you can search and filter it;
  without it, everything is listed in full.
- **Verify.** Terminal cards with the exact commands from the README (`gh attestation verify`,
  `sha256sum`, PowerShell) and copy buttons.
- **A note from iri.** Short, in my own words, signed with 💜, in the same voice as the README and
  my profile.

## System

`src/site.css` owns the tokens (light and `[data-theme="dark"]`), the components and the
breakpoints at 1080, 960, 680, 420 and 340 px. Icons are 24 px line drawings, defined once in
`build.js` and inlined as a sprite on each page. System fonts (Segoe UI Variable, Inter where
installed, and the platform default) mean there's no external font request; code uses Cascadia
Code or the platform monospace. Dark is the site's default theme, and the toggle remembers what a
reader picked.

Motion is limited to entrance reveals, the floating popup in the hero, panel transitions and the
flowing wires in the architecture diagram. All of it switches off under `prefers-reduced-motion`,
and nothing is hidden when JavaScript isn't available.
