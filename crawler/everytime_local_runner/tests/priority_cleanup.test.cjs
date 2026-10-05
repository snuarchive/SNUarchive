// Synthetic lifecycle failures: no browser, filesystem writes or site traffic.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../priority_runner.cjs'),'utf8');
const {runOptions}=require('../priority_runner.cjs');
test('normal viewport resize is bounded; unknown automation options are rejected',()=>{
  assert.deepEqual(runOptions(['--retry-partial','--viewport-height=1100']),{retryPartial:true,retrySearchLimits:false,retryProfessorLimits:false,viewportHeight:1100});
  assert.equal(runOptions(['--retry-professor-limits']).retryProfessorLimits,true);
  assert.equal(runOptions(['--retry-search-limits']).retrySearchLimits,true);
  for(const flags of [['--viewport-height=10000'],['--viewport-height=NaN'],['--headless'],['--stealth'],
                      ['--viewport-height=900','--viewport-height=1100']])assert.throws(()=>runOptions(flags));
});

for(const scenario of ['summary_checksum_failure','summary_disk_failure','plain_browser_failure']) {
  test(`active browser is closed after ${scenario}`,async()=>{
    let closed=false;const emitted=[],written=[];
    const fault=(kind,code)=>Object.assign(new Error(code),{kind,code});
    const fakeSession={check:async()=>{throw scenario==='plain_browser_failure'?new Error('synthetic private browser details'):fault('failed','synthetic_interruption');},
      phase:()=>{},failure:e=>e,close:async()=>{closed=true;}};
    const fixtures={
      'node:fs':{mkdtempSync:p=>p+'fixture',mkdirSync:()=>{}},
      'node:path':path,'node:crypto':{},
      'node:child_process':{spawnSync:(_exe,args)=>{
        const command=args.find(x=>['pending','summary','finish'].includes(x));
        if(command==='pending')return {status:0,stdout:JSON.stringify([{item_id:'A0001',course:{title:'synthetic'}}])};
        if(command==='summary'&&scenario==='summary_checksum_failure')return {status:1};
        return {status:0,stdout:'{}'};
      }},
      './runner.cjs':{writeNew:(file,value)=>{if(scenario==='summary_disk_failure'&&file.endsWith('result.json'))throw new Error('synthetic disk full');written.push({file,value});}},
      './adapter.cjs':{loadCollectors:()=>({})},
      './browser_session.cjs':{openSession:async()=>fakeSession,failure:fault,delay:async()=>{}},
      './search_adapter.cjs':{createSearchPilot:()=>({})},
      './professor_search.cjs':require('../professor_search.cjs'),
      './campaign_search_cache.cjs':{campaignSearchCache:()=>null},
      './stop_request.cjs':{requestedStop:()=>null},
      './storage_preflight.cjs':{storagePreflight:()=>({})},
      './output_root.cjs':{outputRoot:repo=>path.join(repo,'crawler/output/everytime_local_runner')},
      './overview_diagnostic.cjs':{}
      ,'./failure_diagnostic.cjs':require('../failure_diagnostic.cjs')
    };
    const fakeRequire=name=>{assert.ok(name in fixtures,name);return fixtures[name];};
    const main=vm.runInNewContext(source+'\nmain',{
      require:fakeRequire,module:{exports:{}},__dirname:path.join(__dirname,'..'),
      process:{argv:['node','script','python','synthetic_campaign']},console:{log:v=>emitted.push(JSON.parse(v))}
    });
    await main();
    assert.equal(closed,true);
    assert.equal(emitted.at(-1).event,'execution_finished');
    assert.equal(emitted.at(-1).status,'failed');
    if(scenario==='plain_browser_failure'){
      const saved=written.find(r=>r.file.endsWith('result.json')).value;
      assert.equal(saved.status,'failed');
      assert.equal(saved.reason,'unexpected_browser_or_dom_error');
      assert.equal(emitted.at(-1).reason,saved.reason);
      assert.equal(JSON.stringify({emitted,written}).includes('synthetic private browser details'),false);
    }
  });
}
