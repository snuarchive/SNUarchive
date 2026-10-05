# Local UI collection throughput

The full-catalog runner remains sequential in installed headed Google Chrome,
using its dedicated persistent profile and normal UI only. Original Computer Use
parsers, search orchestration, raw schema, and archive validators are unchanged.

## Policy version 1

`priority_runner.cjs` records `performance_policy.json` per execution and
`timing.json` per course. Timings contain durations and reuse flags only.

* Wheel settling: 150 ms in this runner; other adapters default to 750 ms.
* Review bottom wait: 1,000 ms, within the existing collector/validator bounds.
* Search bottom wait: still 2,000 ms, as required by the original matcher.
* Two bottom confirmations, prefix consistency, exact identity, displayed/saved
  counts, per-batch validation and checksums all remain required.
* Inter-course pacing remains 1,500 ms. No parallel site workers are introduced.

The two wheel/idle changes eliminate about 4.4 seconds of fixed delay for a
small course requiring two search scrolls and two review scrolls. Actual time
depends on DOM load, review count, additional scrolling and local validation.

## Observed search reuse

The in-memory exact-title cache still works within a browser session. The new
`campaign_search_cache.cjs` also retains validated complete UI observations
across 50-course shard boundaries, for at most 24 hours in the same immutable
full-catalog campaign. It never creates or guesses a lecture URL.

The original observation timestamp and candidate list are preserved. Source
hashes and campaign/shard plan hashes are verified; a changed source stops the
run. The original Python matcher validates every reused observation for the
current instructor. Every lecture page is visited and its identity, count and
full review list are checked afresh. Expired or future-dated observations are
not reused. Cache entries and provenance are new files under the ignored
campaign output; they contain no cookies, credentials or session state.

For the original 18,871 pending entries, per-shard caching implied 13,959 name
searches versus 10,629 unique titles. Thus up to 3,330 additional repeat searches
can be avoided; expiry and actual ordering reduce the realized saving.

## Verification

`node --test crawler/everytime_local_runner/tests/*.test.cjs` includes cache
scope/expiry/tampering tests and unchanged identity, security, count and prefix
checks. Python archive/schema tests remain applicable.

`node crawler/everytime_local_runner/tests/throughput_browser_smoke.cjs` runs a
real browser against intercepted synthetic HTML only, with zero site requests.
It delays extra cards by 1,400 ms: 37/37 completes, while 37/38 remains partial.

Live speed observations must be reported separately from those synthetic tests.
Compare completed course intervals within a shard; omit startup and boundary
intervals. Prefer matching review-count and search-reuse cohorts. Short samples
are throughput observations, not guarantees for the remaining catalog.

Live cross-shard reuse was verified on 2026-10-02 for C0207 → C0208,
across C_0003 → C_0004 and separate browser sessions. The original search
observation and hash were preserved, the new instructor was matched again,
and the freshly visited lecture archive passed identity/count/checksum checks
(one saved review). Evidence is in the master campaign's
`monitoring/cross_shard_search_reuse_C0208_01.json`. This verifies that reuse
works across a real shard boundary; it does not establish a new throughput rate.
