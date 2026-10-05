'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {outputRoot}=require('../output_root.cjs');
test('explicit absolute destination is shared with child Python environment',()=>{
  const repo=path.resolve('.'),destination=path.resolve('synthetic-output');
  assert.equal(outputRoot(repo,{EVERYTIME_LOCAL_OUTPUT_ROOT:destination}),destination);
  assert.equal(outputRoot(repo,{}),path.join(repo,'crawler/output/everytime_local_runner'));
  assert.throws(()=>outputRoot(repo,{EVERYTIME_LOCAL_OUTPUT_ROOT:'relative'}),/absolute/);
});
