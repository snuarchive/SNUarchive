// Offline test driver: accepts saved/synthetic JSON only; no browser or network.
const fs = require('node:fs');
const path = require('node:path');
const factory = eval(fs.readFileSync(path.join(__dirname, '../browser_chunks.js'), 'utf8'));
const pack = eval(fs.readFileSync(path.join(__dirname, '../browser_pack.js'), 'utf8'));
(async () => {
  const {value, options} = JSON.parse(fs.readFileSync(0, 'utf8'));
  const transfer = await factory(value, options);
  const manifest = await transfer.manifest(), chunks = [];
  for (let i = 0; i < JSON.parse(manifest.payload).total_chunks; i++) chunks.push(await transfer.getChunk(i));
  const original = JSON.stringify(chunks[0]);
  chunks[0].payload += 'intentional caller mutation';
  if (chunks[0].review_index_range) chunks[0].review_index_range[0] += 100;
  const retransmissions = [await transfer.getChunk(0), await transfer.getChunk(0)];
  const cacheImmutable = JSON.stringify(retransmissions[0]) === original;
  chunks[0] = JSON.parse(original);
  let limitDetected = false;
  try { await transfer.getChunk(0); } catch { limitDetected = true; }
  process.stdout.write(JSON.stringify({manifest, chunks, retransmissions, limitDetected, cacheImmutable, legacy: pack(value)}));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
