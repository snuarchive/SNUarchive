const test=require('node:test'),assert=require('node:assert/strict');
const {observeBoundedSearch}=require('../search_adapter.cjs');
test('observed search cap preserves incomplete evidence without a matching observation',async()=>{
  const checkpoint={snapshot:{candidates:Array.from({length:160},(_,i)=>({position:i+1}))},trace:[]};
  const pilot={observeSearch:async(_adapter,_query,save)=>{save(checkpoint);throw new Error('Search candidate limit; stop');}};
  const result=await observeBoundedSearch(pilot,{},'synthetic');
  assert.equal(result.observation,undefined);
  assert.deepEqual(result.limited,{reason:'search_candidate_limit',checkpoint,scope:{ui_end:false}});
});
test('security, changed search and missing evidence failures still propagate',async()=>{
  for(const message of ['Access restriction; stop without retry','Search prefix changed; stop','Search candidate limit; stop']){
    const pilot={observeSearch:async()=>{throw new Error(message);}};
    await assert.rejects(observeBoundedSearch(pilot,{},'synthetic'),e=>e.message===message);
  }
});
test('normal complete search and scroll cap remain distinct',async()=>{
  const observation={scope:{ui_end:true},candidates:[]};
  assert.deepEqual(await observeBoundedSearch({observeSearch:async()=>observation},{},'synthetic'),{observation});
  const result=await observeBoundedSearch({observeSearch:async(_a,_q,save)=>{save({snapshot:{candidates:[{}]},trace:[]});throw new Error('Search scroll limit; stop');}},{},'synthetic');
  assert.equal(result.limited.reason,'search_scroll_limit');assert.equal(result.limited.scope.ui_end,false);
});
