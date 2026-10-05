// Synthetic professor search; no live browser or network.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createProfessorSearchPilot} = require('../professor_search.cjs');
const {selectSearchMode}=require('../search_adapter.cjs');
test('professor and name modes use observed radio controls and security checks',async()=>{
  let selected='name',checks=0;const selectors=[];
  const page={url:()=> 'https://everytime.kr/lecture/search',waitForLoadState:async()=>{},
    locator:selector=>{selectors.push(selector);
      if(selector==='div.categories')return {getByText:label=>({count:async()=>1,click:async()=>{selected=label==='교수명'?'professor':'name';}})};
      const mode=selector.includes('"professor"')?'professor':'name';
      return {count:async()=>1,isChecked:async()=>selected===mode};}};
  await selectSearchMode(page,async()=>{checks++;},'professor');assert.equal(selected,'professor');
  await selectSearchMode(page,async()=>{checks++;},'name');assert.equal(selected,'name');
  assert.equal(checks,4);assert.equal(selectors.length,4);
  await assert.rejects(selectSearchMode(page,async()=>{throw new Error('blocked');},'professor'),/blocked/);
});
test('wrong actual search mode cannot be accepted as professor evidence',async()=>{
  const {tab}=fakeSearch([1,1,1]);const evaluate=tab.playwright.evaluate;
  tab.playwright.evaluate=async()=>({...await evaluate(),mode:'name'});
  await assert.rejects(createProfessorSearchPilot().observeSearch(tab,'합성'),/Search query or mode changed/);
});

function fakeSearch(counts, {empty=false, denial=false, wrongQuery=false, changedPrefix=false, loading=false,mode='professor'}={}) {
  let query='', index=0, url='https://everytime.kr/lecture';
  const calls={searches:0,scrolls:0};
  const locator={or(){return this;},first(){return this;},nth(){return this;},
    async waitFor(){if(loading)throw Error('Timeout waiting for cards or empty UI');}};
  const tab={url:async()=>url,getAXState:async()=>denial?'Access Denied':'에브리타임 서울대',
    scroll:async()=>{calls.scrolls++;index++;},playwright:{
      getByRole:()=>({fill:async v=>{query=v;},press:async()=>{calls.searches++;url='https://everytime.kr/lecture/search?'+new URLSearchParams({keyword:query,condition:mode});}}),
      locator:()=>locator,
      evaluate:async()=>{
        const n=counts[Math.min(index,counts.length-1)],height=Math.max(800,n*90),top=index?height-800:0;
        return {page_url:url,query:wrongQuery?'wrong':query,mode,school:'에브리타임\n서울대',
          candidates:Array.from({length:n},(_,i)=>({position:i+1,url:`https://everytime.kr/lecture/view/${i+1}`,
            title:changedPrefix&&index&&i===0?'changed':query,instructor:`교수 ${i}`})),
          empty_text:empty?'검색된 강의가 없습니다':null,
          empty_evidence:empty?{text:'검색된 강의가 없습니다',visible:true,locator:'div.lectures > div.alert > p.noresult'}:null,
          geometry:{top,height,client:800},point:[600,600]};
      }}};
  return {tab,calls};
}
const selected=()=>Array.from({length:20},(_,i)=>({course_key:String(i),title:`합성 ${i}`,instructor:'교수'}));

test('large name search requires explicit name mode, keeps prefix and finite cap',async()=>{
 const p=createProfessorSearchPilot({extended:true,mode:'name',largeNameSearch:true});
 const r=await p.observeSearch(fakeSearch([20,800,900,900,900],{mode:'name'}).tab,'합성');
 assert.equal(r.candidates.length,900);assert.equal(r.scope.max_candidates,6000);assert.equal(r.scope.max_scrolls,350);
 await assert.rejects(p.observeSearch(fakeSearch([6000],{mode:'name'}).tab,'합성'),/candidate limit/);
 await assert.rejects(p.observeSearch(fakeSearch([20,800],{mode:'name',changedPrefix:true}).tab,'합성'),/prefix changed/);
 assert.throws(()=>createProfessorSearchPilot({extended:true,largeNameSearch:true}));
 assert.throws(()=>createProfessorSearchPilot({mode:'name',largeNameSearch:true}));
});

test('explicit name search keeps bounds, exact mode and query checks',async()=>{
 const pilot=createProfessorSearchPilot({extended:true,mode:'name'});
 const r=await pilot.observeSearch(fakeSearch([20,160,180,180,180],{mode:'name'}).tab,'합성');
 assert.equal(r.mode,'name');assert.equal(r.candidates.length,180);assert.equal(r.scope.ui_end,true);
 await assert.rejects(pilot.observeSearch(fakeSearch([1,1,1]).tab,'합성'),/mode changed/);
 await assert.rejects(pilot.observeSearch(fakeSearch([800],{mode:'name'}).tab,'합성'),/candidate limit/);
 assert.throws(()=>createProfessorSearchPilot({mode:'invalid'}));
});

test('search scrolls past twenty and preserves tail candidates',async()=>{
  const {tab,calls}=fakeSearch([20,40,45,45,45]);
  const r=await createProfessorSearchPilot().observeSearch(tab,'합성');
  assert.equal(r.candidates.length,45);assert.equal(r.initial_candidate_count,20);
  assert.equal(r.candidates.at(-1).position,45);assert.equal(calls.scrolls,4);
});
test('already loaded 37 cards are all retained',async()=>{
  const {tab}=fakeSearch([37,37,37]);
  const r=await createProfessorSearchPilot().observeSearch(tab,'합성');
  assert.equal(r.initial_candidate_count,37);assert.equal(r.candidates.length,37);
});
test('explicit empty succeeds but zero cards/loading do not',async()=>{
  const good=fakeSearch([0],{empty:true});
  assert.equal((await createProfessorSearchPilot().observeSearch(good.tab,'합성')).empty_text,'검색된 강의가 없습니다');
  assert.equal(good.calls.scrolls,0);
  for(const option of [{},{loading:true}])
    await assert.rejects(createProfessorSearchPilot().observeSearch(fakeSearch([0],option).tab,'합성'));
});
test('wrong query, denial, changed prefix, and cap stop',async()=>{
  for(const [counts,opt] of [[[1],{wrongQuery:true}],[[1],{denial:true}],[[20,40],{changedPrefix:true}],[[160],{}]])
    await assert.rejects(createProfessorSearchPilot().observeSearch(fakeSearch(counts,opt).tab,'합성'));
});
test('scroll bound preserves a checkpoint and does not submit again',async()=>{
  const {tab,calls}=fakeSearch(Array.from({length:14},(_,i)=>i+1));
  let checkpoint;
  await assert.rejects(createProfessorSearchPilot().observeSearch(tab,'합성',p=>checkpoint=p),/scroll limit/);
  assert.equal(calls.searches,1);assert.equal(calls.scrolls,12);assert.equal(checkpoint.snapshot.candidates.length,13);
});
test('elapsed search deadline halts without resubmitting',async()=>{
  const {tab,calls}=fakeSearch([1,1,1]);
  const original=Date.now;let tick=0;
  try {
    Date.now=()=>{tick+=30001;return tick;};
    await assert.rejects(createProfessorSearchPilot().observeSearch(tab,'합성'),/Excessive search wait/);
    assert.equal(calls.searches,1);
  } finally { Date.now=original; }
});

test('explicit extended professor search passes 160 but remains bounded and checks prefix',async()=>{
  const counts=[20,80,160,180,180,180];
  const pilot=createProfessorSearchPilot({extended:true});
  const result=await pilot.observeSearch(fakeSearch(counts).tab,'합성');
  assert.equal(result.evidence_version,3);assert.equal(result.candidates.length,180);
  assert.equal(result.scope.max_candidates,800);assert.equal(result.scope.max_scrolls,60);
  await assert.rejects(pilot.observeSearch(fakeSearch([800]).tab,'합성'),/candidate limit/);
  await assert.rejects(pilot.observeSearch(fakeSearch(counts,{changedPrefix:true}).tab,'합성'),/prefix changed/);
  await assert.rejects(pilot.observeSearch(fakeSearch(counts,{denial:true}).tab,'합성'),/restriction/);
});
