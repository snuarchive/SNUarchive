const test=require('node:test'),assert=require('node:assert/strict');
const {scenario}=require('./extended_fixture.cjs');
test('1348 reviews exceed old caps, preserve duplicate and finish only at stable bottom',async()=>{
  const events=await scenario(),r=events.at(-1).report;
  assert.equal(r.status,'complete');assert.equal(r.succeeded,1348);assert.equal(r.batches,68);
  assert.ok(r.trace.length>31);assert.equal(r.bottom_confirmations,2);
  assert.equal(r.limits.comparison_files,200);
});
test('extended local limits remain finite and restriction stops immediately',async()=>{
  await assert.rejects(scenario({},{maxBatches:201}),/bounded UI limits/);
  await assert.rejects(scenario({},{maxScrolls:301}),/bounded UI limits/);
  const stopped=(await scenario({restriction:true})).at(-1).report;
  assert.equal(stopped.status,'partial');assert.match(stopped.stop_error,/restriction/);
  const capped=(await scenario({},{maxBatches:21})).at(-1).report;
  assert.equal(capped.termination_reason,'batch_limit_reached');assert.equal(capped.succeeded,420);
});
