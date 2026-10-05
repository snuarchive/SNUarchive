'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {storagePreflight}=require('../storage_preflight.cjs');
test('reject 512 KiB exFAT allocation even when nominal free space is sufficient',()=>{
  assert.throws(()=>storagePreflight('synthetic',()=>({bsize:524288,bavail:200000})),/allocation_unit_too_large/);
});
test('accept 4 KiB destination with sufficient space',()=>{
  assert.deepEqual(storagePreflight('synthetic',()=>({bsize:4096,bavail:2000000})),
    {allocation_unit_bytes:4096,available_bytes:8192000000});
});
test('reject low disk space on a small allocation volume',()=>{
  assert.throws(()=>storagePreflight('synthetic',()=>({bsize:4096,bavail:1000})),/below_5_gib/);
});
test('unknown storage metadata and inaccessible volumes fail closed',()=>{
  assert.throws(()=>storagePreflight('synthetic',()=>({bsize:0,bavail:100})),/capacity_unknown/);
  assert.throws(()=>storagePreflight('synthetic',()=>{throw new Error('unavailable');}),/unavailable/);
});
