'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mayContinue}=require('../full_runner.cjs');
test('supervisor only advances after normal terminal evidence',()=>{
  assert.equal(mayContinue({event:'execution_finished',status:'finished',states:{complete:50}},0,false),true);
  assert.equal(mayContinue({event:'campaign_complete',states:{complete:50}},0,false),true);
  for(const status of ['blocked','failed','login_failed','stopped'])
    assert.equal(mayContinue({event:'execution_finished',status},0,false),false);
  assert.ok(!mayContinue(null,0,false));
  assert.equal(mayContinue({status:'finished'},1,false),false);
  assert.equal(mayContinue({status:'finished'},0,true),false);
  assert.equal(mayContinue({status:'finished',states:{blocked:1}},0,false),false);
  assert.equal(mayContinue({status:'finished',states:{failed:1}},0,false),false);
});
