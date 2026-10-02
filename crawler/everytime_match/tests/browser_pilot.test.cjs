const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createEverytimePilot} = require('../browser_pilot.js');

function fakeSearch(counts, {empty=false, denial=false, wrongQuery=false, changedPrefix=false, loading=false}={}) {
  let query='', index=0, url='https://everytime.kr/lecture';
  const calls={searches:0,scrolls:0};
  const locator={or(){return this;},first(){return this;},nth(){return this;},
    async waitFor(){if(loading)throw Error('Timeout waiting for cards or empty UI');}};
  const tab={url:async()=>url,getAXState:async()=>denial?'Access Denied':'에브리타임 서울대',
    scroll:async()=>{calls.scrolls++;index++;},playwright:{
      getByRole:()=>({fill:async v=>{query=v;},press:async()=>{calls.searches++;url='https://everytime.kr/lecture/search?'+new URLSearchParams({keyword:query,condition:'name'});}}),
      locator:()=>locator,
      evaluate:async()=>{
        const n=counts[Math.min(index,counts.length-1)],height=Math.max(800,n*90),top=index?height-800:0;
        return {page_url:url,query:wrongQuery?'wrong':query,mode:'name',school:'에브리타임\n서울대',
          candidates:Array.from({length:n},(_,i)=>({position:i+1,url:`https://everytime.kr/lecture/view/${i+1}`,
            title:changedPrefix&&index&&i===0?'changed':query,instructor:`교수 ${i}`})),
          empty_text:empty?'검색된 강의가 없습니다':null,
          empty_evidence:empty?{text:'검색된 강의가 없습니다',visible:true,locator:'div.lectures > div.alert > p.noresult'}:null,
          geometry:{top,height,client:800},point:[600,600]};
      }}};
  return {tab,calls};
}
const selected=()=>Array.from({length:20},(_,i)=>({course_key:String(i),title:`합성 ${i}`,instructor:'교수'}));

test('search scrolls past twenty and preserves tail candidates',async()=>{
  const {tab,calls}=fakeSearch([20,40,45,45,45]);
  const r=await createEverytimePilot().observeSearch(tab,'합성');
  assert.equal(r.candidates.length,45);assert.equal(r.initial_candidate_count,20);
  assert.equal(r.candidates.at(-1).position,45);assert.equal(calls.scrolls,4);
});
test('already loaded 37 cards are all retained',async()=>{
  const {tab}=fakeSearch([37,37,37]);
  const r=await createEverytimePilot().observeSearch(tab,'합성');
  assert.equal(r.initial_candidate_count,37);assert.equal(r.candidates.length,37);
});
test('explicit empty succeeds but zero cards/loading do not',async()=>{
  const good=fakeSearch([0],{empty:true});
  assert.equal((await createEverytimePilot().observeSearch(good.tab,'합성')).empty_text,'검색된 강의가 없습니다');
  assert.equal(good.calls.scrolls,0);
  for(const option of [{},{loading:true}])
    await assert.rejects(createEverytimePilot().observeSearch(fakeSearch([0],option).tab,'합성'));
});
test('wrong query, denial, changed prefix, and cap stop',async()=>{
  for(const [counts,opt] of [[[1],{wrongQuery:true}],[[1],{denial:true}],[[20,40],{changedPrefix:true}],[[160],{}]])
    await assert.rejects(createEverytimePilot().observeSearch(fakeSearch(counts,opt).tab,'합성'));
});
test('scroll bound preserves a checkpoint and does not submit again',async()=>{
  const {tab,calls}=fakeSearch(Array.from({length:14},(_,i)=>i+1));
  let checkpoint;
  await assert.rejects(createEverytimePilot().observeSearch(tab,'합성',p=>checkpoint=p),/scroll limit/);
  assert.equal(calls.searches,1);assert.equal(calls.scrolls,12);assert.equal(checkpoint.snapshot.candidates.length,13);
});
test('elapsed search deadline halts without resubmitting',async()=>{
  const {tab,calls}=fakeSearch([1,1,1]);
  const original=Date.now;let tick=0;
  try {
    Date.now=()=>{tick+=30001;return tick;};
    await assert.rejects(createEverytimePilot().observeSearch(tab,'합성'),/Excessive search wait/);
    assert.equal(calls.searches,1);
  } finally { Date.now=original; }
});
test('search requires saved acknowledgement before next input',async()=>{
  const {tab,calls}=fakeSearch([1,1,1]);
  const gen=createEverytimePilot().searchSelected(tab,selected());
  assert.equal((await gen.next()).value.type,'search');
  assert.equal((await gen.next()).value.type,'stopped');
  assert.equal(calls.searches,1);assert.equal((await gen.next()).done,true);
});
test('search denial preserves unattempted queries without not_found',async()=>{
  const {tab,calls}=fakeSearch([1],{denial:true});
  const r=(await createEverytimePilot().searchSelected(tab,selected()).next()).value;
  assert.equal(r.type,'stopped');assert.equal(r.remaining_queries.length,19);assert.equal(calls.searches,0);
});

function queue() {
  return {status:'ready',input_count:20,collection_queue:[1,2].map(i=>{
    const target={url:`https://everytime.kr/lecture/view/${i}`,title:`합성 ${i}`,instructor:'교수'};
    return {course_key:String(i),state:'queued',target,match:{status:'matched',input:{course_key:String(i),...target},
      search:{candidates:[{...target,position:1}],scope:{ui_end:true}}}};
  })};
}
function fakeCollection(partial=false){
  const navigated=[];let url='https://everytime.kr/lecture';
  return {navigated,tab:{url:async()=>url,goto:async u=>{url=u;navigated.push(u);},getAXState:async()=>''},
    factory:t=>t,collector:async function*(tab,t){
      yield {type:'batch',batch:1,observation:{synthetic:true}};
      yield {type:'complete',report:{status:partial?'partial':'complete',stop_error:partial?'Course value missing or ambiguous':null}};
    }};
}
test('collector waits for each batch and complete archive acknowledgement',async()=>{
  const f=fakeCollection(),g=createEverytimePilot().collectQueued(f.tab,queue(),f.factory,f.collector);
  assert.equal((await g.next()).value.type,'batch');
  assert.equal((await g.next({saved:true,course_key:'1',type:'batch',batch:1})).value.type,'complete');
  assert.equal(f.navigated.length,1);
  assert.equal((await g.next({saved:true,course_key:'1',type:'complete'})).value.course_key,'2');
  assert.equal(f.navigated.length,2);
  assert.equal((await g.next({saved:true,course_key:'2',type:'batch',batch:1})).value.type,'complete');
  assert.equal((await g.next({saved:true,course_key:'2',type:'complete'})).value.type,'queue_complete');
});
test('collector partial is archived, halts next navigation, and preserves pending queue',async()=>{
  const f=fakeCollection(true),g=createEverytimePilot().collectQueued(f.tab,queue(),f.factory,f.collector);
  await g.next();await g.next({saved:true,course_key:'1',type:'batch',batch:1});
  const stopped=(await g.next({saved:true,course_key:'1',type:'complete'})).value;
  assert.equal(stopped.type,'stopped');assert.deepEqual(stopped.pending_course_keys,['2']);
  assert.equal(f.navigated.length,1);assert.equal((await g.next()).done,true);
});
test('missing or wrong receipt prevents another collector event',async()=>{
  for(const receipt of [undefined,{saved:true,course_key:'wrong',type:'batch',batch:1}]){
    const f=fakeCollection(),g=createEverytimePilot().collectQueued(f.tab,queue(),f.factory,f.collector);
    await g.next();assert.equal((await g.next(receipt)).value.type,'stopped');assert.equal(f.navigated.length,1);
  }
});
test('tampered and duplicated targets never navigate',async()=>{
  for(const mutate of [q=>q.collection_queue[0].target.title='changed',
    q=>q.collection_queue[1].target.url=q.collection_queue[0].target.url,
    q=>q.collection_queue[0].match.status='ambiguous']){
    const q=queue();mutate(q);const f=fakeCollection();
    await assert.rejects(createEverytimePilot().collectQueued(f.tab,q,f.factory,f.collector).next());
    assert.equal(f.navigated.length,0);
  }
});
