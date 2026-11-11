# WardenOne website

This folder is the source of <https://iri-dev.github.io/WardenOne/>. None of it ships inside the
extension (`site/` is left out of exports), and nothing goes live just because something was
pushed: the Pages workflow only builds and deploys the site when it's run.

## Building and previewing

From the repository root:

```powershell
& "C:\Program Files\nodejs\node.exe" site/sync-data.js
& "C:\Program Files\nodejs\node.exe" site/build.js
& "C:\Program Files\nodejs\node.exe" site/check.js
& "C:\Program Files\nodejs\node.exe" site/preview.js
```

Then open <http://127.0.0.1:4173/>, and press Ctrl+C to stop the server. It only uses what comes
with Node, so there's nothing to install. You can also open `site/dist/index.html` straight from
disk; `site.js` then points folder links at their `index.html`, and the three documents at their
GitHub copies.

## Where the facts come from

I never type the site's numbers, feature list, product captures or documents by hand, and they
aren't tracked here. `sync-data.js` copies them from the last commit (HEAD), so the site describes
what's actually published rather than whatever I'm halfway through:

- `src/data/catalogue.json`: the Features catalogue and every `{{stat:…}}` number, from
  `settings-data.js`, the feature guide in `onboarding.js`, `manifest.json` and `tools/`.
- `public/images/`: the real captures from `docs/screenshots/`.
- `public/icons/icon128.png`, plus `public/PRIVACY.md`, `CREDITS.md` and `SUPPORT.md`.

If a settings group gets renamed, the sync stops and tells you its name; add it to a category in
`sync-data.js`. (It quietly froze the site's numbers once when I missed this, so it's worth
checking after any rename.)

The sync also copies `THIRD_PARTY_NOTICES.html`, `LICENSE` and `permissions.html`, so the
acknowledgements and permissions links work locally too. Run
`node site/sync-data.js --working-tree` to preview changes you haven't committed yet; without it,
the site keeps describing the published commit.

Three images are tracked because they're made rather than copied. `make-assets.js` uses a local
Chrome or Edge to produce `public/images/hero-popup.webp` (the popup in the homepage hero) and
`public/images/og-card.png` (the 1200 × 630 card shown when the site is shared, drawn by
`src/og-card.html`). Run it again after replacing the popup capture or editing the card.
`public/images/iri-avatar.webp` is my GitHub profile picture at 144 × 144, served from the site
itself so visitors never load anything from GitHub's avatar servers.

## Where to edit

`src/pages/` holds the page bodies. Inside them, `{{root}}` is the relative path to the site root,
`{{icon:name}}` drops in an icon from the set in `build.js`, `{{stat:name}}` drops in a synced
number, and `{{catalogue}}` and `{{capabilities}}` drop in generated sections. `src/site.css` and
`src/site.js` handle the look and the interaction. `build.js` puts everything together into
`dist/`; **please don't edit `dist/`**, because the next build overwrites it.

`check.js` checks the structure, every link (including when opened from disk), accessibility
references, image sizes against the real files, placeholders left unfilled, the catalogue count
against the synced data, the share card, the GitHub Pages base path and the asset size limits.

The three documents stay as Markdown, so Jekyll renders them at `/PRIVACY`, `/CREDITS` and
`/SUPPORT`. The Web Store listing uses `/PRIVACY` as its privacy policy address, so that one has
to keep working. `build.js` writes `dist/_layouts/default.html`, the header, footer and reading
column Jekyll wraps around `{{ content }}`; Jekyll doesn't publish folders that start with `_`.
The local preview renders the documents into the same layout with its own Markdown renderer.

The notice about the fake download is published as `stolen.html`, so `/stolen` keeps working for
the README, the extension and older notices that link to it.

## Publishing

Run **Actions → Pages → Run workflow**, or `gh workflow run pages.yml`. The workflow syncs, builds
and runs `check.js`, and only deploys if every check passes. The documents it publishes are the
ones in the commit being deployed.

## Moving to a custom domain

Change `siteUrl` in `build.js` (canonical links, the share card, the sitemap and robots.txt all
follow it) and the `/WardenOne/` base path check in `check.js`. Update the address that the notice
in `src/pages/stolen.html` names as the only official page, and add the domain as `public/CNAME`.
Then set the DNS records, verify the domain in the GitHub account's Pages settings, and turn on
Enforce HTTPS. GitHub sends the old `iri-dev.github.io/WardenOne` address on to the new domain.
