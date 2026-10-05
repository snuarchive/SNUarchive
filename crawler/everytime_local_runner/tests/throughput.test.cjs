'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAdapter}=require('../adapter.cjs');
const {searchAdapter}=require('../search_adapter.cjs');
const {run,state}=require('../../everytime_collect/tests/fake_browser.cjs');
test('fast settling is opt-in, bounded, and still uses normal mouse wheel',async()=>{
  for(const factory of [(p,o)=>createAdapter(p,{check:async()=>{},...o}),(p,o)=>searchAdapter(p,async()=>{},o)]){
    const calls=[],page={locator:()=>({evaluate:async()=>900}),evaluate:async()=>900,
      mouse:{move:async()=>{},wheel:async(...a)=>calls.push(a)},waitForTimeout:async n=>calls.push(n)};
    const tab=factory(page,{wheelSettleMs:150});await tab.scroll([100,200],'down',3);
    assert.deepEqual(calls,[[0,2700],150]);
    for(const value of [0,149,751,NaN])assert.throws(()=>factory(page,{wheelSettleMs:value}));
  }
});
test('one-second review waits retain two bottom confirmations and delayed-card prefix checks',async()=>{
  const result=await run({frames:[state(20,false),state(20),state(37)]},{idleWaitMs:1000});
  assert.equal(result.report.status,'complete');assert.equal(result.report.succeeded,37);
  assert.equal(result.report.bottom_confirmations,2);assert.equal(result.report.limits.idle_wait_ms,1000);
});
test('shorter waits never promote missing reviews to complete',async()=>{
  const result=await run({frames:[state(3)],total:4},{idleWaitMs:1000});
  assert.equal(result.report.status,'partial');assert.equal(result.report.ui_end_confirmed,false);
});
test('shorter waits preserve identity/security/changed-card stop rules',async()=>{
  assert.equal((await run({title:'different'},{idleWaitMs:1000})).report.status,'partial');
  assert.equal((await run({restriction:true},{idleWaitMs:1000})).report.status,'partial');
  const changed=state(4);changed.rows[0].text='changed';
  const r=await run({frames:[state(3,false),changed]},{idleWaitMs:1000});
  assert.equal(r.report.status,'partial');assert.match(r.report.stop_error,/cards changed/);
});
