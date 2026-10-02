// Pure transport adapter for ONE already observed batch. No DOM, network or disk.
// Keep the returned handle in cua_repl until the local receiver acknowledges it.
(async function createChunkTransfer(value, options) {
  const encoder = new TextEncoder();
  const bytes = text => encoder.encode(text);
  const sha = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(text))), b => b.toString(16).padStart(2, '0')).join('');
  const {run_id, course_url, batch_index, review_path, review_indices, source_kind} = options;
  const limit = options.max_payload_bytes ?? 1024;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(run_id) || !/^https:\/\/everytime\.kr\/lecture\/view\/[1-9][0-9]*(\?tab=article)?$/.test(course_url) ||
      !Number.isInteger(batch_index) || batch_index < 1 || batch_index > 20 ||
      !['batch_event', 'raw_observation', 'transport_test'].includes(source_kind) ||
      !Array.isArray(review_path) || review_path.some(k => typeof k !== 'string') ||
      !Array.isArray(review_indices) || review_indices.length > 20 ||
      review_indices.some((n, i) => !Number.isInteger(n) || n < 1 || (i && n <= review_indices[i - 1])) ||
      !Number.isInteger(limit) || limit < 256 || limit > 2048) throw new Error('Invalid bounded transport options');
  const snapshot = JSON.parse(JSON.stringify(value));
  let reviews = snapshot;
  for (const k of review_path) reviews = reviews?.[k];
  if (!Array.isArray(reviews) || reviews.length !== review_indices.length) throw new Error('Review provenance differs');
  // Record exact UTF-16 spans while serializing. Chunks use UTF-8 byte limits.
  let text = ''; const spans = [];
  const encode = (v, path) => {
    const start = text.length;
    if (Array.isArray(v)) {
      text += '['; v.forEach((x, i) => { if (i) text += ','; encode(x, [...path, i]); }); text += ']';
    } else if (v !== null && typeof v === 'object') {
      text += '{'; Object.keys(v).forEach((k, i) => { if (i) text += ','; text += JSON.stringify(k) + ':'; encode(v[k], [...path, k]); }); text += '}';
    } else text += JSON.stringify(v);
    if (path.length === review_path.length + 1 && review_path.every((k, i) => path[i] === k))
      spans.push({start, end: text.length, index: review_indices[path.at(-1)]});
  };
  encode(snapshot, []);
  if (bytes(text).length > 2 * 1024 * 1024) throw new Error('Batch exceeds existing 2 MiB limit');
  const cached = []; let fragment = '', start = 0, cost = 15; // {"fragment":""}
  const flush = () => {
    if (!fragment) return;
    const end = start + fragment.length, indices = spans.filter(s => s.start < end && s.end > start).map(s => s.index);
    cached.push({payload: JSON.stringify({fragment}), text_offset: start,
      review_index_range: indices.length ? [Math.min(...indices), Math.max(...indices)] : null});
    start = end; fragment = ''; cost = 15;
  };
  for (const cp of text) {
    const extra = bytes(JSON.stringify(cp)).length - 2;
    if (cost + extra > limit) flush();
    fragment += cp; cost += extra;
  }
  flush();
  if (cached.length > 10000) throw new Error('Chunk count limit');
  const manifest = {format: 'plain-json-chunks-v1', run_id, course_url, batch_index, source_kind,
    total_chunks: cached.length, max_payload_bytes: limit, source_byte_length: bytes(text).length,
    source_sha256: await sha(text), review_path, review_indices};
  const manifestText = JSON.stringify(manifest), manifestHash = await sha(manifestText);
  const emissions = cached.map(() => 0);
  return Object.freeze({
    async manifest() { return {payload: manifestText, payload_byte_length: bytes(manifestText).length, sha256: await sha(manifestText)}; },
    async getChunk(index) {
      if (!Number.isInteger(index) || index < 0 || index >= cached.length) throw new Error('Unknown cached chunk');
      if (emissions[index] >= 3) throw new Error('Retransmission limit: keep partial');
      const c = cached[index]; emissions[index]++;
      // Hash the immutable payload's UTF-8 bytes on EVERY emission, just before return.
      const packet = {format: manifest.format, run_id, course_url, batch_index, manifest_sha256: manifestHash,
        chunk_index: index, total_chunks: cached.length, final: index === cached.length - 1,
        review_index_range: c.review_index_range?.slice() ?? null, text_offset: c.text_offset,
        payload_byte_length: bytes(c.payload).length, browser_sha256: await sha(c.payload), payload: c.payload};
      packet.packet_sha256 = await sha(JSON.stringify(Object.values(packet)));
      return packet;
    }
  });
})
