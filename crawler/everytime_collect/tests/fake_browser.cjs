// Synthetic supported-browser boundary. Never opens a browser or performs HTTP.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const load = name => vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'));
const create = load('browser_collect.js'), collect = load('browser_collect_to_end.js');
const target = {url: 'https://everytime.kr/lecture/view/12345?tab=article', title: '합성강의', instructor: '합성교수'};
const plain = x => JSON.parse(JSON.stringify(x));
function rows(n) { return Array.from({length: n}, (_, i) => ({position: i + 1, child: i + 1, text: `😀 합성 본문 ${i + 1}\r\n둘째 줄  `, term: '26년 1학기 수강자', reason: null})); }
function state(n, bottom = true) {
  return {rows: rows(n), count: n, buttons: ['전체', '등록순'], empty_text: n ? null : '첫 번째 강의평을 남겨주세요',
    scroll_top: bottom ? 1000 : 0, scroll_height: 1800, client_height: 800, at_bottom: bottom, point: [200, 400]};
}
function fake({frames = [state(3)], total = frames.at(-1).count, article = false, url, title, instructor,
               failScroll, restriction = false, readyError = false} = {}) {
  const base = target.url.split('?')[0];
  let currentUrl = url || (article ? target.url : base), index = 0;
  const calls = {scrolls: 0, reads: 0, clicks: 0, overviewReads: 0};
  const identity = {title: {text: title || target.title, locator: 'synthetic title'},
    instructor: {text: instructor || target.instructor, locator: 'synthetic instructor'}, count_text: `(${total}개)`,
    count_locator: total ? 'div.rating > div.title > span.count' : 'section.empty.review > div.title > span.count'};
  const locator = {first() {return this;}, nth() {return {waitFor: async () => {throw new Error('Timeout');}};},
    waitFor: async () => {if (readyError) throw new Error('Timeout loading page');}};
  const tab = {url: async () => currentUrl, title: async () => target.title + ' 강의실 - 에브리타임',
    getAXState: async () => restriction ? '접근 제한' : 'synthetic UI',
    scroll: async () => {calls.scrolls++; if (calls.scrolls === failScroll) throw new Error('synthetic security denial'); index = Math.min(index + 1, frames.length - 1);},
    playwright: {locator: () => locator, getByRole: () => ({count: async () => 1, getAttribute: async () => target.url.replace('https://everytime.kr', ''),
      click: async () => {calls.clicks++; currentUrl = target.url;}}),
      evaluate: async fn => {if (String(fn).includes('const items')) {calls.overviewReads++; return plain(identity);} calls.reads++; return plain(frames[index]);}}};
  const overview = {url: async () => base, playwright: {locator: () => locator, evaluate: async () => {calls.overviewReads++; return plain(identity);}}};
  return {tab, overview, calls};
}
async function run(options, limits = {}) {
  const f = fake(options), events = [];
  for await (const event of collect(f.tab, create(target), {overviewTab: f.overview, ...limits})) events.push(plain(event));
  return {...f, events, report: events.at(-1).report, batches: events.filter(e => ['batch', 'failed_batch'].includes(e.type))};
}
module.exports = {load, create, collect, target, plain, rows, state, fake, run};
if (require.main === module) {
  (async () => {
    const mid = state(25); mid.rows[22].reason = 'body_empty_or_hidden';
    const allBad = state(2); allBad.rows.forEach(r => r.reason = 'body_missing_or_ambiguous');
    const duplicate = state(25); duplicate.rows[21].text = duplicate.rows[0].text;
    const results = {};
    for (const [name, options, limits] of [
      ['small', {frames: [state(3)]}], ['multi', {frames: [state(20, false), state(40, false), state(60, false), state(61)]}],
      ['preloaded', {frames: [state(37)], article: true}], ['empty', {frames: [state(0)]}],
      ['mismatch', {frames: [state(3)], total: 4}], ['wrong', {title: '다른강의'}],
      ['interrupted', {frames: [state(20, false), state(25)], failScroll: 2}],
      ['failed_row', {frames: [mid]}], ['all_failed', {frames: [allBad]}],
      ['batch_limit', {frames: [state(37)]}, {maxBatches: 1}], ['loading_failed', {readyError: true}], ['duplicate', {frames: [duplicate]}],
    ]) results[name] = (await run(options, limits)).events;
    process.stdout.write(JSON.stringify(results));
  })();
}
