# Additional semester sources

These additive inputs come from the 23 XLS files in the user's 다전공계획 project.
`manifest.json` records source checksums, row counts, and output checksums.
Each record retains its workbook, sheet, and row for provenance.

Included: all 12 semesters of 2021–2023, summer and fall 2026,
and six spring 2026 sections absent from the original semester input.
There are 55,369 added source rows. Spring/summer/fall/winter use codes 1/2/3/4,
matching the root `schema.sql` convention. Years are read from workbook headers.

Run `npm run build:courses` to regenerate the application catalog. The builder
reads original root semester files first, then these supplements. This preserves
existing course keys and display labels. It deduplicates offerings by year,
semester, and department using the existing catalog rules.

Original semester JSONs and XLS files are not replaced. Same-section label
differences in already imported semesters remain unresolved; no professor alias
or subtitle matching is inferred. The catalog update does not imply that the
added courses have Everytime reviews, and does not change previous crawl queues,
raw files, review extraction outputs, or DB records.

The one-time converter is `scripts/import-missing-semesters.py` (xlrd 2.0.2).
It takes `--audit-dir` pointing to the source audit and refuses to overwrite these
outputs. Use the catalog builder, not the converter, for routine rebuilds.
