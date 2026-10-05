// Synthetic adapter tests; no browser required.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createAdapter, guard, loadCollectors} = require('../adapter.cjs');
const {writeNew, initialLogin} = require('../runner.cjs');
const {fake, target} = require('../../everytime_collect/tests/fake_browser.cjs');

test('both exact title and instructor mismatch stop before list reads', async () => {
  for (const input of [{title: '다른강의'}, {instructor: '다른교수'}]) {
    const {create, collect} = loadCollectors();
    const f = fake(input);
    const events = [];
    for await (const e of collect(f.tab, create(target))) events.push(e);
    assert.equal(events.at(-1).report.status, 'partial');
    assert.match(events.at(-1).report.stop_error, /identity differs/);
    assert.equal(f.calls.reads, 0);
  }
});

test('guard stops on login or CAPTCHA without a retry', async () => {
  for (const state of [{login: true}, {restricted: true}]) {
    let reads = 0;
    await assert.rejects(guard({evaluate: async () => {reads++; return state;}}), /BLOCKED:/);
    assert.equal(reads, 1);
  }
});

test('scroll uses mouse wheel and converts legacy wait timeout', async () => {
  const calls = [];
  const locator = {evaluate: async () => 800, waitFor: async options => calls.push(options)};
  const page = {evaluate: async () => ({}), locator: () => locator,
    mouse: {move: async (...p) => calls.push(p), wheel: async (...p) => calls.push(p)},
    waitForTimeout: async ms => calls.push(ms)};
  const tab = createAdapter(page);
  await tab.playwright.locator('synthetic').waitFor({state: 'visible', timeoutMs: 1234});
  await tab.scroll([100, 200], 'down', 3);
  assert.deepEqual(calls, [{state: 'visible', timeout: 1234}, [100, 200], [0, 2400], 750]);
});

test('local writer preserves Unicode and refuses overwrite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'everytime-synthetic-'));
  try {
    const file = path.join(dir, 'event.json'), value = {text: '😀 한글\r\n  끝  '};
    const hash = writeNew(file, value);
    assert.equal(hash.length, 64);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), value);
    assert.throws(() => writeNew(file, {}), {code: 'EEXIST'});
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), value);
  } finally { fs.rmSync(dir, {recursive: true}); }
});

test('manual initial login waits without filling credentials; challenge stops immediately', async () => {
  const base = target.url.split('?')[0];
  let states = [{login: true}, {signedIn: true}, {overview: true}], navigations = [], waiting = 0;
  const page = {goto: async url => navigations.push(url), url: () => base,
    evaluate: async () => states.shift(), waitForTimeout: async () => {}};
  await initialLogin(page, base, 60, () => waiting++);
  assert.equal(waiting, 1);
  assert.deepEqual(navigations, [base, base]);
  states = [{restricted: true, captcha_visible: true}];
  navigations = [];
  await assert.rejects(initialLogin(page, base, 60, () => {}), {code: 'captcha_visible'});
  assert.deepEqual(navigations, [base]);
});
