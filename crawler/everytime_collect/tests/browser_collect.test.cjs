const assert = require('node:assert/strict'), test = require('node:test');
const {create, target, fake, state, run} = require('./fake_browser.cjs');
test('strict observed HTTPS course URL and expected labels required', () => {
  for (const url of ['http://everytime.kr/lecture/view/12345', 'https://evil.test/lecture/view/12345', target.url + '#x', target.url + '&x=1', 'https://everytime.kr/login']) assert.throws(() => create({...target, url}), /Invalid/);
  assert.throws(() => create({...target, instructor: ''}), /Invalid/);
});
test('small batch preserves Unicode, whitespace, terms and null IDs/times with evidence', async () => {
  const {batches, report} = await run();
  assert.equal(report.succeeded, 3);
  const doc = batches[0].observation;
  for (let i = 0; i < doc.reviews.length; i++) {
    const r = doc.reviews[i]; assert.equal(r.text_raw, state(3).rows[i].text);
    for (const [field, ref] of Object.entries(r.field_evidence)) {
      const ev = doc.evidence.find(e => e.id === ref.evidence_id);
      assert.equal(Array.from(ev.text).slice(ref.start, ref.end).join(''), r[field]); assert.ok(ev.locator.startsWith(target.url));
    }
    for (const key of ['source_id', 'created_at_raw', 'updated_at_raw']) assert.equal(r[key], null);
  }
});
test('wrong course URL or login stops before navigation or DOM reads', async () => {
  for (const url of ['https://everytime.kr/login', target.url.replace('12345', '54321')]) {
    const {calls, report} = await run({url});
    assert.equal(report.status, 'partial'); assert.equal(report.initial_loaded, null);
    assert.equal(calls.clicks + calls.reads + calls.scrolls + calls.overviewReads, 0);
  }
});
test('both visible labels must match input', async () => {
  for (const options of [{title: '다른강의'}, {instructor: '다른교수'}]) {
    const {calls, report} = await run(options);
    assert.match(report.stop_error, /identity/); assert.equal(calls.clicks, 0); assert.equal(report.ui_end_confirmed, false);
  }
});
test('preloaded article requires companion overview and never resets article', async () => {
  const f = fake({article: true}); await assert.rejects(create(target).prepare(f.tab), /overview tab/);
  const {calls, report} = await run({frames: [state(37)], article: true});
  assert.equal(calls.clicks, 0); assert.equal(report.initial_loaded, 37); assert.equal(report.succeeded, 37);
});
test('page loading failure and absent empty message cannot become empty success', async () => {
  const missing = state(0); missing.empty_text = null;
  for (const options of [{readyError: true}, {frames: [missing]}]) {
    const {report} = await run(options);
    assert.equal(report.status, 'partial'); assert.equal(report.initial_loaded, null); assert.equal(report.ui_end_confirmed, false);
  }
});
test('optional term remains null; failed body stops with other rows preserved', async () => {
  const s = state(3); s.rows[0].reason = 'body_empty_or_hidden'; s.rows[1].term = null;
  const {batches, report} = await run({frames: [s]});
  assert.equal(report.failed, 1); assert.equal(report.succeeded, 2); assert.equal(report.status, 'partial');
  assert.equal(batches[0].observation.reviews[0].enrollment_term_raw, null);
});
