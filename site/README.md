# WardenOne website

The source of <https://iri-dev.github.io/WardenOne/>. Nothing here ships in the extension package (`site/` is export-ignored), and nothing publishes on push: the Pages workflow builds and deploys the site when it is run.

## Build and preview

From the repository root:

```powershell
& "C:\Program Files\nodejs\node.exe" site/sync-data.js
& "C:\Program Files\nodejs\node.exe" site/build.js
& "C:\Program Files\nodejs\node.exe" site/check.js
& "C:\Program Files\nodejs\node.exe" site/preview.js
```

Open <http://127.0.0.1:4173/> and stop the server with Ctrl+C. Everything uses Node's built-in modules, so there is no install step. You can also open `site/dist/index.html` straight from disk; `site.js` then points folder links at their `index.html` and the four documents at their GitHub copies.

## Where the facts come from

The site's numbers, its feature list, its product captures and its documents are not typed by hand or tracked here. `sync-data.js` copies them from the last commit (HEAD), so the site describes what is published rather than uncommitted work:

- `src/data/catalogue.json`: the Features catalogue and every `{{stat:…}}` number, from `settings-data.js`, the onboarding feature guide in `onboarding.js`, `manifest.json` and `tools/`.
- `public/images/`: the real captures from `docs/screenshots/`.
- `public/icons/icon128.png` and `public/PRIVACY.md`, `CHANGELOG.md`, `CREDITS.md` and `SUPPORT.md`.

If a settings group is renamed, the sync stops and names it; add it to a category in `sync-data.js`.

The sync also copies `THIRD_PARTY_NOTICES.html`, `LICENSE` and `permissions.html`
so the website’s source acknowledgments and permissions links work locally.
Use `node site/sync-data.js --working-tree` to preview uncommitted edits; the
default continues to describe the published commit.

Three images are tracked because they are made, not copied. `make-assets.js` uses a local Chrome or Edge to derive `public/images/hero-popup.webp` (the popup in the homepage hero) and `public/images/og-card.png` (the 1200 × 630 social card drawn by `src/og-card.html`); run it again after replacing the popup capture or editing the card. `public/images/iri-avatar.webp` is iri's GitHub profile picture at 144 × 144, served from the site so visitors never load anything from GitHub's avatar host.

## Where to edit

`src/pages/` holds the page bodies. Inside them, `{{root}}` is the relative path to the site root, `{{icon:name}}` inserts an icon from the set in `build.js`, `{{stat:name}}` inserts a synced number, and `{{catalogue}}` and `{{capabilities}}` insert generated sections. `src/site.css` and `src/site.js` control presentation and interaction. `build.js` assembles everything into `dist/`; **do not edit `dist/`**.

`check.js` validates structure, links (including from disk), accessibility references, image width/height against the real files, unfilled placeholders, the catalogue count against the synced data, the social card, the GitHub Pages base path and asset budgets.

The four documents stay Markdown, so Jekyll renders them at `/PRIVACY`, `/CHANGELOG`, `/CREDITS` and `/SUPPORT`. `/PRIVACY` is the privacy-policy address the Web Store listing uses, so it must keep working. `build.js` writes `dist/_layouts/default.html`, the site's header, footer and reading column around Jekyll's `{{ content }}`; Jekyll does not publish folders that start with `_`. The local preview renders the documents into the same layout with its own Markdown renderer.

The fake-download notice is published as `stolen.html`, so `/stolen` keeps working for the README, the extension and past notices.

## Publishing

Run **Actions → Pages → Run workflow**, or `gh workflow run pages.yml`. The workflow syncs, builds and runs `check.js`, and deploys only if every check passes. The documents it publishes are the ones in the commit being deployed.

## Moving to a custom domain

Change `siteUrl` in `build.js` (canonical links, the social card, the sitemap and robots.txt all follow it) and the `/WardenOne/` base-path check in `check.js`, update the address the notice in `src/pages/stolen.html` names as the only official page, and add the domain as `public/CNAME`. Then set the DNS records, verify the domain in the GitHub account's Pages settings, and turn on Enforce HTTPS. GitHub redirects the old `iri-dev.github.io/WardenOne` address to the domain.
