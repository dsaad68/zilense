# Archive

Reference / source material that the working extension no longer depends on at
build or runtime. Kept for provenance, safe to ignore.

- **`my-dict/`** — the original Claude Design handoff bundle (React/HTML prototype
  the extension was built from). Nothing in the build reads it.
- **`my-dict-handoff.zip`** — the raw handoff archive; its contents are already
  extracted in `my-dict/`.
- **`convert-hsk.mjs`** — the one-off script that derived
  `assets/hsk-vocab/hsk-data.json` from the HSK 3.0 `.xls` spreadsheets. The
  spreadsheets were deleted (the derived JSON is committed and final), so this is
  kept only as a record of how that data was produced. To re-run it, re-add the
  `.xls` files to `assets/hsk-vocab/` and point its `srcDir` there.

The active project lives at the repo root (`src/`, `scripts/`, `hsk-vocab/`,
`char-data/`, etc.).
