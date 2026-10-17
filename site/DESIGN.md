# Design direction — brand-true, evidence first

The site now looks like the product it describes. Its colours come straight from the extension's `theme.css`: violet `#783593`, pink `#a33b72`, and the deep plum stage (`#120b18` → `#432157`) that the extension's own pages use. Someone who installs WardenOne should recognise the popup they just saw on the website.

The first screen has one job: show a real WardenOne warning at the moment a scam instruction appears. Captures are genuine; anything around them is labelled as website framing, and installation diagrams are labelled as illustrations. Claims stay as careful as the README's: nothing is called "safe", and limits are stated.

## Structure

- **Stage panels.** Inset, rounded dark panels with a soft aurora and faint grid carry the hero, the principles band and each closing call to action. They are deep plum in the dark theme and a soft lilac in the light one.
- **Hero.** A browser window holding the real ClickFix warning, with the real popup overlapping it, and two numbered callouts. The caption says the captures are arranged for the page.
- **Numbers.** Protections, built-in network rules, public lists and zero accounts. Every figure comes from `src/data/catalogue.json`, which `sync-data.js` writes from the extension repository.
- **Product tour.** One tablist of six real captures (scam warning, download review, Activity Centre, Site Firewall, Element Zapper and Self-Test). The Zapper tab is a before/after slider. Without JavaScript, every panel is shown in turn.
- **Principles.** "Unknown does not mean safe" and the README's three rules, in a stage panel.
- **Feature catalogue.** Every feature, control and tool, grouped into six categories, with the extension's own descriptions and default labels. It is searchable and filterable with JavaScript, and fully listed without it.
- **Verify.** Terminal cards with the exact commands from the README (`gh attestation verify`, `sha256sum`, PowerShell) and copy buttons.
- **A note from iri.** First person, short, signed with 💜, in the voice of the README and profile.

## System

`src/site.css` owns the tokens (light and `[data-theme="dark"]`), components and breakpoints at 1080, 960, 680, 420 and 340 px. Icons are 24 px stroke drawings, defined once in `build.js` and inlined as a sprite on each page. System fonts (Segoe UI Variable, Inter where installed, and the platform default) avoid an external font request; code uses Cascadia Code or the platform monospace. Dark is the site's default theme; the toggle remembers a reader's choice.

Motion is limited to entrance reveals, the floating popup in the hero, panel transitions and the flowing wires in the architecture diagram. All of it is off under `prefers-reduced-motion`, and nothing is hidden when JavaScript is unavailable.
