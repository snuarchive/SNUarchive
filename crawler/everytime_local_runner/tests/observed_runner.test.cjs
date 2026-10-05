const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {options,overviewUrl}=require('../observed_runner.cjs');
test('pilot limit is explicit and bounded; unknown automation flags rejected',()=>{
  assert.deepEqual(options(['--shard','--limit=3']),{shard:true,limit:3,retryFailed:false});
  assert.equal(options(['--shard','--retry-failed']).retryFailed,true);
  for(const flags of [['--limit=3'],['--shard','--limit=51'],['--shard','--limit=0'],['--stealth'],['--shard','--shard']])
    assert.throws(()=>options(flags));
});
test('canonical raw URL navigates to overview first; parser later clicks the observed article link',()=>{
  assert.equal(overviewUrl({url:'https://everytime.kr/lecture/view/12345?tab=article'}),'https://everytime.kr/lecture/view/12345');
  assert.throws(()=>overviewUrl({url:'https://everytime.kr/api/12345'}));
});
test('browser closes even when navigation and final summary both fail',async()=>{
  let closed=false;
  const source=fs.readFileSync(path.join(__dirname,'../observed_runner.cjs'),'utf8');
  const modules={
    'node:fs':{mkdtempSync:()=>'/fake/run',mkdirSync:()=>{}},'node:path':path,
    'node:child_process':{spawnSync:(_exe,args)=>args.includes('pending')?{status:0,stdout:JSON.stringify([
      {item_id:'O00001',target:{url:'https://everytime.kr/lecture/view/1?tab=article'},observed_sources:{},catalog_items:[]}
    ])}:{status:1}},
    './runner.cjs':{writeNew:()=>{},bridge:()=>{}},'./adapter.cjs':{loadCollectors:()=>({create:()=>{}})},
    './collect_extended.cjs':{},'./browser_session.cjs':{openSession:async()=>({
      phase:()=>{},check:async()=>{},page:{goto:async()=>{throw Error('synthetic navigation');}},
      failure:e=>e,close:async()=>{closed=true;}}),failure:(kind,code)=>Object.assign(Error(code),{kind,code}),delay:async()=>{}},
    './overview_diagnostic.cjs':{},'./failure_diagnostic.cjs':{safeFailureDiagnostic:()=>({category:'synthetic'})},
    './storage_preflight.cjs':{storagePreflight:()=>{}},'./full_runner.cjs':{},'./output_root.cjs':{outputRoot:()=>'/fake'}
  };
  const context={require:n=>modules[n],module:{exports:{}},__dirname:'/fake',process:{},console:{log:()=>{}}};
  vm.runInNewContext(source,context);
  await context.module.exports.runShard('python','/fake/root',3);
  assert.equal(closed,true);
});
