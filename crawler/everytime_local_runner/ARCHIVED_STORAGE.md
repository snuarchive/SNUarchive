# Preserved legacy output

The old `crawler/output/everytime_local_runner` tree is preserved byte-for-byte in
the verified ZIP selected by `EVERYTIME_LEGACY_ARCHIVE` or the ignored
`.local-data/archive-config.json` file (`{"archive":"<absolute ZIP path>"}`).
The recovery directory holds `files.json` (member sizes and SHA-256),
`verified.json` (full source/archive comparison), and the recovery result.

The local runner's `archived_files.read_bytes`, `storage.sha`, `storage.load_archive`,
campaign JSON readers and statistics raw reader fall back to that archive when a
legacy source file is absent. Original provenance paths and raw checksums remain
unchanged. Live files take precedence. Reads do not unpack files onto C: or D:.

The archive is read-only. Do not resume a legacy archived campaign in place.
Directory enumeration with ordinary `Path.glob` does not enumerate ZIP members;
use `ZipFile.namelist()` for offline inventory. Tools outside these local readers
still need explicit archive support or a deliberate restore to a suitable volume.
Computer Use code and its own original data have not been modified.

The new collection campaign remains stopped. Neither this archive transition nor
the recovery script authorizes automatic browser restart. No cookies or browser
profile files are included in this archive.
