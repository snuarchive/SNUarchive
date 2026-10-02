# Browser-to-local transport

Priority A remains stopped. This adapter changes transport only: it does not
search, navigate, scroll, collect, match, run the extractor, or update a campaign.
The existing collector, raw schemas, legacy decoder and archive validators remain
in place. Do not resume collection based on offline tests alone.

## Previous path and observed failure boundary

1. The approved browser adapter returns an observed batch event (normally at most
   20 reviews) to persistent `cua_repl` memory. The old path already operated per
   batch, not as a single whole-course string.
2. `browser_pack.js` calls `JSON.stringify(event)`, converts the JSON to UTF-8
   bytes, computes FNV-1a-64 over the original JavaScript UTF-16 code units, applies its
   bounded LZ77 codec, then base64-encodes the compressed bytes.
3. `nodeRepl.write` returns the encoded string through tool output. Previous runs
   emitted 4,000-character slices with additional per-slice FNV hashes. The agent
   copied these strings into a separate local tool call. There is no verified
   direct binary/file bridge between these two tools.
4. The local handoff recomputed slice hashes, joined matching slices and wrote a
   new private `.pack.json`. `unpack-transfer` strictly decoded base64, decompressed
   with bounds, checked UTF-8 length and the original UTF-16 FNV, and only then
   wrote decoded JSON with exclusive creation.
5. `save-batch-event` validated event/raw schema, course identity and evidence
   before archiving raw. Archive/finalization recorded and checked file SHA-256.

Priority A's two incidents occurred between returned tool text and constructed
local transfer arguments: A0003 batch 1 contained one substituted base64 character
(`4` → `5`, index 7077); batch 7 contained an extra `P8z+` unit (four characters,
index 9297). The former recovered from the same cached output; the latter remained
unsaved. The preserved audit identifies this boundary, not the exact internal
component responsible for the alteration. Do not alter or recompute expected
hashes to make corrupted data pass. The 120 saved / 13 missing state is unchanged.

## Plain JSON chunks v1

`browser_chunks.js` is a pure async factory. Pass one existing batch event and
explicit provenance; it snapshots that value once. There are no site APIs in it.
The default payload cap is **1,024 UTF-8 bytes**, configurable only between 256 and
2,048. The existing 20-review and 2 MiB batch bounds remain. The adapter additionally
caps chunk count at 10,000. A long review may occupy multiple chunks.

Each payload is independently valid plain JSON: `{"fragment":"..."}`. The fragment
is an exact consecutive portion of the serialized event, split at Unicode code
point boundaries. It is not a standalone raw review. Only a fully reassembled,
validated event may enter the unchanged archive procedure.

Every packet contains:

| Field | Meaning |
|---|---|
| `format`, `run_id`, `course_url`, `batch_index` | Protocol and explicit run/course/batch identity |
| `manifest_sha256` | Binds the packet to the pinned manifest |
| `chunk_index`, `total_chunks`, `final` | Zero-based sequence and declared last chunk |
| `review_index_range` | Inclusive original card indices whose serialized review objects intersect this fragment; `null` outside the reviews array |
| `text_offset` | Exact UTF-16 offset for continuity checking; byte sizes remain UTF-8 |
| `payload_byte_length` | Byte length of the payload string encoded as UTF-8 |
| `browser_sha256`, `payload` | SHA-256 of those exact UTF-8 bytes and the payload string |
| `packet_sha256` | SHA-256 of the fixed-order field-value JSON array, binding metadata as well as payload |

Evidence/body copies outside the reviews array can be in `null`-range chunks; no
review association is invented for them. Normal fragments can intersect several
reviews. Duplicate review texts are never merged or removed.

The small manifest records original batch SHA-256/length, total chunks, bounds,
source type, review path and original card indices. Its payload also has a byte
length and SHA-256. It does not contain the whole batch or a large list of hashes.
SHA-256 here detects transmission corruption; it is not an authentication signature.

## Emission, receipt and storage

Keep the returned factory handle in `cua_repl` memory. Emit exactly **one chunk per
tool return**, as strict JSON (`nodeRepl.write(JSON.stringify(await handle.getChunk(i)))`).
Do not return an array of every chunk, summarize the body, normalize strings, or
manually repair corrupted text. `getChunk` hashes the immutable payload's UTF-8
bytes again immediately before every return, using Web Crypto SHA-256.

The local receiver uses Python UTF-8 encoding and `hashlib.sha256` on the received
payload string after parsing the outer JSON. It checks length, payload SHA-256,
packet SHA-256, manifest identity, index, final marker, range and contiguous offset
**before any packet file is created**. Invalid payloads are never written, including
to logs. Rejection checkpoints contain only reason, lengths and digest diagnostics.

The standalone receiver CLI reads untrusted envelopes from **stdin**, not a file
that already contains unverified data:

```text
python -m crawler.everytime_collect.chunk_transfer start --directory NEW_PRIVATE_DIR --run-id RUN --course-url OBSERVED_URL
python -m crawler.everytime_collect.chunk_transfer accept --directory NEW_PRIVATE_DIR
python -m crawler.everytime_collect.chunk_transfer finalize --directory NEW_PRIVATE_DIR
python -m crawler.everytime_collect.chunk_transfer cache-lost --directory NEW_PRIVATE_DIR
```

`start` receives a manifest; `accept` receives one packet. Output roots are fixed
to the repository's private data/output directories. Files use exclusive creation
and fsync. Checkpoints are append-only. This is a **single-writer** receiver; do not
run parallel writers for one directory. Restart revalidates saved packets before
continuing. Disk write failures leave the course partial and require inspection;
an incomplete packet file is never silently trusted or overwritten.

All chunks plus whole-batch SHA-256/length and existing event/raw validation must
pass before `assembled.json` is created. This means **transport_complete**, not
course complete. For production, pass this event into the existing
`save-batch-event`; only its successful receipt may acknowledge the collector's
pending batch. The adapter does not automatically reconnect the stopped campaign.

## Recovery and failure policy

- On the first mismatch, keep earlier verified chunks and request only the expected
  missing index from the **same cached handle**. Do not advance the collector.
- Each handle emits an index at most three times (initial + two retries). Two
  integrity/sequence failures in a receiver stop the batch even if retry allowance
  remains. Current campaign-level repeated-failure guards remain unchanged.
- A valid duplicate packet is explicitly detected and ACKed without rewriting its
  file. A conflicting duplicate, out-of-order packet or missing predecessor is
  rejected. A missing last chunk leaves `partial`; no assembly file is created.
- If the handle is lost/reset, use `cache-lost`: verified chunks remain, the state
  is partial/stopped and `requires_recollection=true`. Do not reread the site or
  reconstruct the missing text without separate authorization.
- Policy denials are a stop condition. Recollection does not fix a blocked tool
  handoff; do not switch tools or encoding to evade the denial.

## What was actually verified on 2026-10-02

The live `cua_repl` confirmed persistent prior cache variables and Web Crypto/
TextEncoder availability. The new factory was instantiated in that same REPL with
one previously saved review, without any DOM read. Its manifest source SHA-256
matched the locally prepared review bytes. Before a chunk could reach the receiver,
automatic policy review rejected the local manifest-handoff command with
`blocked by policy`. No retry or alternative handoff was attempted.

Thus same-handle retransmission, immutability and retry limits are verified in the
offline JS/Python harness. **End-to-end retransmission through actual tool output
and local receipt is not yet verified.** The blocked handoff is not a checksum
mismatch or a successful repeat. Priority A must remain stopped.

Offline repetitions use the already archived 10 batches / 195 reviews. Results,
size comparisons, corruption cases, preservation hashes and the explicit blocked
status are in the new private `everytime_transport_20261002` test folder. Test
assemblies are copies for verification, not new raw collection or queue completions.

Plain chunks increase wire size and tool-call count relative to base64 compression.
They remove decompression from per-chunk verification and isolate recovery to small,
readable pieces. They still traverse the text handoff that previously failed; local
zero-mismatch tests do not establish a real-tool or environment-wide error rate.
