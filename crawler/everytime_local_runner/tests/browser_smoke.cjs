// OPT-IN SYNTHETIC browser integration: every request is intercepted locally.
// No requests reach Everytime; these records are not real lecture reviews.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {loadCollectors} = require('../adapter.cjs');
const {consume, writeNew} = require('../runner.cjs');

(async () => {
  const python = process.argv[2];
  if (!python) throw new Error('Supply a Python executable');
  const target = {url: 'https://everytime.kr/lecture/view/12345?tab=article', title: '합성강의', instructor: '합성교수'};
  const {create, collect} = loadCollectors(), collector = create(target);
  const root = path.resolve(__dirname, '../../output/everytime_local_runner');
  fs.mkdirSync(root, {recursive: true});
  const run = fs.mkdtempSync(path.join(root, 'synthetic_browser_'));
  fs.mkdirSync(path.join(run, 'incoming'));
  writeNew(path.join(run, 'synthetic.json'), {synthetic: true, site_requests: 0, description: 'Intercepted HTML fixtures; no live Everytime data'});
  const browser = await chromium.launch({headless: true});
  try {
    const context = await browser.newContext(), page = await context.newPage();
    const overview = `<title>합성강의 강의실 - 에브리타임</title>
      <section class="info"><div class="item"><label>과목명</label><a class="link">합성강의</a></div>
      <div class="item"><label>교수명</label><span class="text">합성교수</span></div></section>
      <div class="rating"><div class="title"><span class="count">(37개)</span></div></div>
      <a href="/lecture/view/12345?tab=article">강의평</a>`;
    const articles = `<title>합성강의 강의실 - 에브리타임</title>
      <style>.articles{height:400px;overflow:auto}.article{min-height:120px}.text{white-space:pre-wrap}</style>
      <div class="article_tab"><div class="header"><button>전체</button><button>등록순</button></div><div class="articles"></div></div>
      <script>
      const list=document.querySelector('.articles'); let count=0;
      function append(n){while(count<n){count++;const card=document.createElement('div');card.className='article';
        card.innerHTML='<div class="article_header"><div class="title"><div class="info"><span class="semester">26년 1학기 수강자</span></div></div></div><div class="text"></div>';
        card.querySelector('.text').innerText='😀 합성 본문 '+count+'\\n둘째 줄  ';list.append(card);}}
      append(20);list.addEventListener('scroll',()=>{if(list.scrollHeight-list.clientHeight-list.scrollTop<=2)append(37);});
      </script>`;
    let intercepted = 0;
    await context.route('**/*', route => {
      intercepted++;
      const url = route.request().url();
      if (url === collector.base || url === collector.url) return route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: url === collector.base ? overview : articles});
      return route.abort();
    });
    await page.goto(collector.base);
    const result = await consume({page, collector, run, python, collect});
    assert.equal(result.status, 'complete_for_observed_ui');
    assert.equal(result.details.reviews_saved, 37);
    const raw = JSON.parse(fs.readFileSync(path.join(run, 'batch_001/raw.json'), 'utf8'));
    assert.equal(raw.reviews[0].text_raw, '😀 합성 본문 1\n둘째 줄  ');
    assert.equal(raw.reviews[0].source_id, null);
    console.log(JSON.stringify({synthetic: true, site_requests: 0, intercepted, run, status: result.status, saved: 37}));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; });
