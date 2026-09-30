const assert = require('node:assert/strict'), test = require('node:test');
const {run, state, collect, create, fake, target} = require('./fake_browser.cjs');
test('61 reviews use four batches and total/scope/bottom confirmation', async () => {
  const {batches, report} = await run({frames: [state(20, false), state(40, false), state(60, false), state(61)]});
  assert.deepEqual(batches.map(e => e.observation.reviews.length), [20, 20, 20, 1]);
  assert.equal(report.status, 'complete'); assert.equal(report.initial_loaded, 20); assert.equal(report.final_loaded, 61);
  assert.equal(report.bottom_confirmations, 2); assert.ok(report.trace.every(s => s.filter === '전체' && s.sort === '등록순'));
});
test('initially 61 loaded chunked before scroll; identical separate cards retained', async () => {
  const s = state(61); s.rows[21].text = s.rows[0].text;
  const f = fake({frames: [s], article: true}), it = collect(f.tab, create(target), {overviewTab: f.overview}), batches = [];
  for (let i = 0; i < 4; i++) {batches.push((await it.next()).value); assert.equal(f.calls.scrolls, 0);}
  assert.deepEqual(batches.map(e => e.window.start_position), [1, 21, 41, 61]);
  assert.equal(batches[1].observation.reviews[1].text_raw, batches[0].observation.reviews[0].text_raw);
});
test('verified zero is complete with zero batches, total mismatch is partial', async () => {
  for (const total of [0, 5]) {
    const {report, calls} = await run({frames: [state(0)], total});
    assert.equal(report.status, total === 0 ? 'complete' : 'partial'); assert.equal(report.batches, 0); assert.equal(calls.scrolls, 0);
  }
});
test('two idle bottoms alone do not establish completeness', async () => {
  const {report} = await run({frames: [state(3)], total: 4});
  assert.equal(report.termination_reason, 'bottom_stable_total_mismatch'); assert.equal(report.status, 'partial');
});
test('bounded scroll and batch limits retain partial result', async () => {
  const a = await run({frames: [state(3, false)]}, {maxScrolls: 1}); assert.equal(a.report.termination_reason, 'scroll_limit_reached');
  const b = await run({frames: [state(37)]}, {maxBatches: 1});
  assert.equal(b.report.termination_reason, 'batch_limit_reached'); assert.equal(b.report.unattempted_loaded, 17); assert.equal(b.report.succeeded, 20);
});
test('mid-run denial retains yielded batches and does not retry', async () => {
  const {report, calls, batches} = await run({frames: [state(20, false), state(25)], failScroll: 2});
  assert.equal(report.status, 'partial'); assert.equal(report.succeeded, 25); assert.equal(batches.length, 2);
  assert.equal(calls.scrolls, 2); assert.match(report.stop_error, /security denial/);
});
test('restriction, changed filter, or changed prefix stops without merging', async () => {
  const filter = state(20); filter.buttons = ['일부', '등록순']; const changed = state(21); changed.rows[0].text = 'changed';
  for (const options of [{restriction: true}, {frames: [state(20, false), filter]}, {frames: [state(20, false), changed]}]) {
    const {report, calls} = await run(options); assert.equal(report.status, 'partial'); assert.equal(calls.scrolls, 1);
  }
});
test('all failed cards return failure event, never empty raw', async () => {
  const s = state(2); s.rows.forEach(r => r.reason = 'body_missing_or_ambiguous'); const {batches, report} = await run({frames: [s]});
  assert.equal(batches[0].type, 'failed_batch'); assert.equal(batches[0].observation, null); assert.equal(report.failed, 2); assert.equal(report.status, 'partial');
});
test('invalid upper bounds reject before browser action', async () => {
  for (const limits of [{maxScrolls: 31}, {maxBatches: 21}, {idleWaitMs: 0}]) {
    const f = fake(); await assert.rejects(collect(f.tab, create(target), limits).next(), /bounded/); assert.equal(f.calls.scrolls, 0);
  }
});
