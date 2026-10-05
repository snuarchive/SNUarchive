'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {requestedStop}=require('../stop_request.cjs');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'everytime-stop-test-'));
  t.after(()=>{
    const target=fs.realpathSync(root);
    assert.equal(path.dirname(target),fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('everytime-stop-test-'));
    fs.rmSync(target,{recursive:true,force:true});
  });
  const campaign=path.join(root,'campaign');fs.mkdirSync(campaign);
  const file=path.join(campaign,'operator_stop_request.json');
  const request={version:1,action:'stop_before_next_shard',campaign:'campaign',reason:'low_disk_space'};
  return {root,file,request,shard:path.join(root,'campaign_C_0216')};
}
test('absent request preserves normal execution',t=>{
  const f=fixture(t);assert.equal(requestedStop(f.shard),null);
});
test('request belongs only to its full campaign and persists unchanged',t=>{
  const f=fixture(t);fs.writeFileSync(f.file,JSON.stringify(f.request));
  const before=fs.readFileSync(f.file);const result=requestedStop(f.shard);
  assert.equal(result.status,'stopped');assert.equal(result.reason,'operator_stop_low_disk_space');
  assert.match(result.stop_request_sha256,/^[a-f0-9]{64}$/);
  assert.equal(requestedStop(path.join(f.root,'other_C_0216')),null);
  assert.equal(requestedStop(path.join(f.root,'ordinary_campaign')),null);
  assert.deepEqual(fs.readFileSync(f.file),before);
});
test('invalid request fails closed',t=>{
  const f=fixture(t);fs.writeFileSync(f.file,JSON.stringify({...f.request,campaign:'other'}));
  assert.throws(()=>requestedStop(f.shard),/Invalid local operator stop request/);
});
test('CLI stops before Python, browser, or any shard writes',t=>{
  const f=fixture(t);fs.writeFileSync(f.file,JSON.stringify(f.request));
  const child=spawnSync(process.execPath,[path.resolve(__dirname,'../priority_runner.cjs'),
    'python-must-not-execute',f.shard],{encoding:'utf8',windowsHide:true});
  assert.equal(child.status,0,child.stderr);
  const event=JSON.parse(child.stdout.trim());assert.equal(event.status,'stopped');
  assert.equal(event.event,'execution_finished');assert.equal(fs.existsSync(f.shard),false);
  assert.deepEqual(fs.readdirSync(f.root),['campaign']);
});
