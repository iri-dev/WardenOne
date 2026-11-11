# Development and publication

To run the same checks the repository runs before anything is published:

```powershell
& "C:\Program Files\nodejs\node.exe" tools/check-maintainability.js
```

If you change `src/content.js`, rebuild `content.min.js` with `tools/build-content.js --build`
afterwards. The two files have to agree before anything is published.

Internal audits, browser measurements, investigation notes and release review evidence live in
the `.private-review/` folder, which Git ignores. Please never add them to Git.

`tools/publication-policy.json` lists exactly which documents, source snapshots, product images
and test contracts are meant to be public. A new public document needs its own entry there. The
repository gate and the source bundle builder both refuse private reports, even ones added with
`--force`. You can install the same check as a local commit guard with
`git config --local core.hooksPath .github/hooks`.

The JSON files in `tools/contracts/` keep the hashes of the generated inventories and the
mapping from each regression test to what it protects. The full inventories and the reasoning
behind them stay local. Add `--report` to an inventory generator to write its full report into
`.private-review/reports/`. The public contracts never contain raw browser measurements, my
internal plans or anyone's correspondence.

`.gitattributes` only decides what goes into extension archives; it doesn't make a tracked file
private. Source bundles include the approved development files. And removing a file from a future
commit doesn't remove it from older public commits, or from copies people already have.
