'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {storagePreflight}=require('../storage_preflight.cjs');

test('compact output requires explicit policy and retains a 20 GiB reserve',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'compact-preflight-'));
  const prior=process.env.EVERYTIME_COMPACT_ROOT;
  t.after(()=>{
    if(prior===undefined)delete process.env.EVERYTIME_COMPACT_ROOT;
    else process.env.EVERYTIME_COMPACT_ROOT=prior;
    fs.rmSync(root,{recursive:true,force:true});
  });
  process.env.EVERYTIME_COMPACT_ROOT=root;
  const enough=()=>({bsize:524288,bavail:50000});
  assert.throws(()=>storagePreflight(root,enough),/ENOENT/);
  const policy=path.join(root,'compact_policy.json');
  fs.writeFileSync(policy,JSON.stringify({version:1,minimum_free_gib:20}));
  assert.equal(storagePreflight(root,enough).allocation_unit_bytes,524288);
  assert.throws(()=>storagePreflight(root,()=>({bsize:524288,bavail:40000})),/below_20_gib/);
  assert.throws(()=>storagePreflight(root,()=>({bsize:1048576,bavail:50000})),/allocation_unit_too_large/);
  assert.throws(()=>storagePreflight(path.dirname(root),enough),/allocation_unit_too_large/);
  assert.equal(storagePreflight(path.dirname(root),enough,{profile:true}).allocation_unit_bytes,524288);
  fs.writeFileSync(policy,JSON.stringify({version:1,minimum_free_gib:1}));
  assert.throws(()=>storagePreflight(root,enough),/invalid_compact_policy/);
});
