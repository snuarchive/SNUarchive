'use strict';
// Synthetic browser integration only: ALL requests are fulfilled/aborted locally.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {loadCollectors,createAdapter}=require('../adapter.cjs');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const results=[];
  try{
    for(const total of [37,38]){
      const context=await browser.newContext(),page=await context.newPage();
      const target={url:'https://everytime.kr/lecture/view/12345?tab=article',title:'합성강의',instructor:'합성교수'};
      const overview=`<title>합성강의 강의실 - 에브리타임</title>
        <section class="info"><div class="item"><label>과목명</label><a class="link">합성강의</a></div>
        <div class="item"><label>교수명</label><span class="text">합성교수</span></div></section>
        <div class="rating"><div class="title"><span class="count">(${total}개)</span></div></div>
        <a href="/lecture/view/12345?tab=article">강의평</a>`;
      const articles=`<title>합성강의 강의실 - 에브리타임</title>
        <style>.articles{height:400px;overflow:auto}.article{min-height:120px}.text{white-space:pre-wrap}</style>
        <div class="article_tab"><div class="header"><button>전체</button><button>등록순</button></div><div class="articles"></div></div>
        <script>
        const list=document.querySelector('.articles');let count=0,scheduled=false;
        function append(n){while(count<n){count++;const c=document.createElement('div');c.className='article';
          c.innerHTML='<div class="article_header"><div class="title"><div class="info"><span class="semester">26년 1학기 수강자</span></div></div></div><div class="text"></div>';
          c.querySelector('.text').innerText='합성 원문 '+count;list.append(c);}}
        append(20);list.addEventListener('scroll',()=>{if(!scheduled&&list.scrollHeight-list.clientHeight-list.scrollTop<=2){
          scheduled=true;setTimeout(()=>append(37),1400);}});
        </script>`;
      await context.route('**/*',route=>{
        const url=route.request().url();
        if(url===target.url||url===target.url.split('?')[0])return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:url===target.url?articles:overview});
        return route.abort();
      });
      await page.goto(target.url.split('?')[0]);
      const {create,collect}=loadCollectors();let report;
      for await(const event of collect(createAdapter(page,{wheelSettleMs:150}),create(target),{maxScrolls:30,maxBatches:20,idleWaitMs:1000})){
        if(event.type==='complete')report=event.report;
      }
      assert.equal(report.succeeded,37);assert.equal(report.bottom_confirmations,2);
      assert.equal(report.status,total===37?'complete':'partial');
      results.push({displayed:total,saved:report.succeeded,status:report.status,bottom_confirmations:report.bottom_confirmations});
      await context.close();
    }
    console.log(JSON.stringify({synthetic:true,site_requests:0,delayed_render_ms:1400,results}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
