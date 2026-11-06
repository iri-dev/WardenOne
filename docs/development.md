# Development and publication

Run the local gate with:

```powershell
& "C:\Program Files\nodejs\node.exe" tools/check-maintainability.js
```

After changing `src/content.js`, rebuild `content.min.js` with
`tools/build-content.js --build`. Both files must agree before publication.

Internal audit reports, browser measurements, investigation notes and release-review
evidence belong in the ignored `.private-review/` directory. Do not add them to Git.
`tools/publication-policy.json` lists the exact documents, source snapshots, product
images and static test contracts intended for public source distribution. New public
documents require an explicit entry. The repository gate and source-bundle builder
reject private reports even if they are force-added. Install the local commit guard with
`git config --local core.hooksPath .github/hooks`; it runs the same check before a commit.

The JSON files under `tools/contracts/` retain generated-inventory hashes and regression
test mappings. Full inventories and regression justifications stay local. Add `--report`
to an inventory generator to write its full report under `.private-review/reports/`.
Public contracts contain no raw browser measurements, internal roadmap or correspondence.

`.gitattributes` controls extension archives only. It does not make tracked files
private. Source bundles include the approved development files. Removing a file
from a future commit does not remove older public commits or existing copies.
