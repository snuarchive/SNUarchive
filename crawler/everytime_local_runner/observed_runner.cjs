'use strict';
// Normal UI only; explicit previously observed URLs, never guessed IDs or APIs.
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {writeNew,bridge}=require('./runner.cjs');
const {loadCollectors,createAdapter}=require('./adapter.cjs');
const collect=require('./collect_extended.cjs');
const {openSession,failure,delay}=require('./browser_session.cjs');
const {errorLabel}=require('./overview_diagnostic.cjs');
const {safeFailureDiagnostic}=require('./failure_diagnostic.cjs');
const {storagePreflight}=require('./storage_preflight.cjs');
const {executeShard,mayContinue}=require('./full_runner.cjs');
const repo=path.resolve(__dirname,'../..'),output=require('./output_root.cjs').outputRoot(repo);
function offline(python,root,command,extra=[]){
  const r=spawnSync(python,['-X','utf8','-B','-m','crawler.everytime_local_runner.observed_campaign',command,'--root',root,...extra],
    {cwd:repo,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
  if(r.status!==0)throw failure('failed','observed_campaign_validation_failed');
  return JSON.parse(r.stdout);
}
function options(flags){
  let shard=false,limit=50,retryFailed=false;const seen=new Set();
  for(const flag of flags){
    const name=flag.split('=')[0];if(seen.has(name))throw Error('Duplicate option');seen.add(name);
    if(flag==='--shard')shard=true;
    else if(flag==='--retry-failed')retryFailed=true;
    else if(/^--limit=\d+$/.test(flag))limit=Number(flag.split('=')[1]);
    else throw Error('Unknown option');
  }
  if(!Number.isInteger(limit)||limit<1||limit>50||(!shard&&(seen.has('--limit')||retryFailed)))throw Error('Invalid bounded limit');
  return {shard,limit,retryFailed};
}
function overviewUrl(target){
  if(!/^https:\/\/everytime\.kr\/lecture\/view\/[1-9]\d*\?tab=article$/.test(target.url))throw Error('Invalid canonical target');
  return target.url.split('?')[0];
}
async function runShard(python,root,limit,retryFailed=false){
  storagePreflight(output);
  const entries=offline(python,root,'pending',retryFailed?['--retry-failed']:[]).slice(0,limit);
  if(!entries.length){console.log(JSON.stringify({event:'campaign_complete',...offline(python,root,'summary')}));return;}
  const execution=fs.mkdtempSync(path.join(output,'observed_execution_'));
  writeNew(path.join(execution,'invocation.json'),{campaign:root,items:entries.map(e=>e.item_id),
    limits:{maxScrolls:300,maxBatches:200},retry_failed:retryFailed,catalog_mapping_approved:false,at:new Date().toISOString()});
  let session,current=null,recorded=false,finalError=null;
  try{
    session=await openSession(execution,{viewportHeight:1100});const {create}=loadCollectors();
    for(const entry of entries){
      storagePreflight(output);current=entry;recorded=false;
      const step=fs.mkdtempSync(path.join(output,'observed_'+entry.item_id+'_'));fs.mkdirSync(path.join(step,'incoming'));
      writeNew(path.join(step,'invocation.json'),{target:entry.target,observed_sources:entry.observed_sources,
        catalog_items:entry.catalog_items,catalog_mapping_approved:false});
      session.phase('collect_'+entry.item_id);await session.check();
      await session.page.goto(overviewUrl(entry.target),{waitUntil:'domcontentloaded'});await session.check();
      await session.page.locator('div.rating > div.title > span.count, section.empty.review > div.title > span.count')
        .first().waitFor({state:'visible',timeout:10000});
      let report=null,guardError=null;
      const adapter=createAdapter(session.page,{wheelSettleMs:150,check:async()=>{
        try{await session.check();}catch(error){guardError=session.failure(error);throw error;}
      }});
      for await(const event of collect(adapter,create(entry.target),{maxScrolls:300,maxBatches:200,idleWaitMs:1000})){
        if(['batch','failed_batch'].includes(event.type)){
          writeNew(path.join(step,'incoming',`event_${String(event.batch).padStart(3,'0')}.json`),event);
          bridge(python,'batch',step,['--number',String(event.batch)]);
        }else if(event.type==='complete')report=event.report;
      }
      if(!report)throw failure('failed','missing_terminal_report');
      if(report.stop_error)report.stop_error=guardError?`${guardError.kind}: ${guardError.code}`:errorLabel(report.stop_error);
      writeNew(path.join(step,'incoming/ui_report.json'),report);bridge(python,'finalize',step);
      const result=offline(python,root,'record',['--item',entry.item_id,'--run',step]);recorded=true;
      console.log(JSON.stringify({event:'course_finished',item:entry.item_id,status:result.status,reviews:result.reviews_saved}));
      if(guardError)throw guardError;
      if(['blocked','failed'].includes(result.status))throw failure(result.status,'collector_terminal_failure');
      await delay(1500);
    }
  }catch(error){
    finalError=session?session.failure(error):error;
    writeNew(path.join(execution,'failure_diagnostic.json'),safeFailureDiagnostic(finalError));
    if(current&&!recorded){
      const receipt=path.join(execution,'interruption.json');
      writeNew(receipt,{status:finalError.kind==='blocked'?'blocked':finalError.kind==='stopped'?'partial':'failed',
        reason:finalError.code||'unexpected_browser_or_dom_error',reviews_saved:0,catalog_mapping_approved:false});
      try{offline(python,root,'finish',['--item',current.item_id,'--input',receipt]);}catch{}
    }
  }finally{
    let summary=null;
    try{summary=offline(python,root,'summary');writeNew(path.join(execution,'result.json'),{
      status:finalError?finalError.kind||'failed':'finished',reason:finalError?.code||null,summary});}
    catch{finalError=finalError||failure('failed','summary_save_failed');}
    finally{if(session)await session.close(finalError);}
    console.log(JSON.stringify({event:'execution_finished',execution,status:finalError?finalError.kind||'failed':'finished',
      reason:finalError?.code||null,...summary}));
  }
}
async function runMaster(python,root){
  storagePreflight(output);let child=null,stopping=false,locked=false,execution;
  const lock=path.join(root,'runner.lock');
  const forward=data=>{if(data.toString().split(/\r?\n/).includes('stop'))stopping=true;if(child?.stdin.writable)child.stdin.write(data);};
  process.stdin.on('data',forward);
  try{
    writeNew(lock,{pid:process.pid,at:new Date().toISOString()});locked=true;
    const initial=offline(python,root,'master-summary');
    if(initial.states.blocked||initial.states.failed)throw failure('failed','prior_terminal_failure_requires_review');
    execution=fs.mkdtempSync(path.join(output,'observed_supervisor_'));
    writeNew(path.join(execution,'invocation.json'),{root,at:new Date().toISOString(),inputs:initial.inputs});
    const announce=e=>{fs.appendFileSync(path.join(execution,'events.jsonl'),JSON.stringify(e)+'\n');console.log(JSON.stringify(e));};
    for(const [i,shard] of initial.pending_shards.entries()){
      if(stopping)break;storagePreflight(output);
      announce({event:'shard_started',root:shard.root});
      const result=await executeShard(python,shard.root,announce,value=>{child=value;},{observed:true});
      if(!mayContinue(result.terminal,result.exitCode,stopping)){announce({event:'supervisor_halted'});break;}
      const audit=offline(python,shard.root,'audit',['--output',path.join(execution,`audit_${String(i+1).padStart(4,'0')}.json`)]);
      announce({event:'shard_verified',...audit});
      const progress=offline(python,root,'master-summary');
      writeNew(path.join(execution,`progress_${String(i+1).padStart(4,'0')}.json`),progress);
      announce({event:'observed_progress',recorded:progress.recorded,pending:progress.pending,reviews:progress.reviews_saved,states:progress.states});
    }
    const summary=offline(python,root,'master-summary');writeNew(path.join(execution,'result.json'),summary);
    announce({event:'observed_supervisor_finished',execution,recorded:summary.recorded,pending:summary.pending,states:summary.states});
  }finally{process.stdin.off('data',forward);process.stdin.pause();if(locked&&!child&&fs.existsSync(lock))fs.unlinkSync(lock);}
}
module.exports={options,runShard,overviewUrl};
if(require.main===module){
  const [python,given,...flags]=process.argv.slice(2);
  Promise.resolve().then(()=>{
    if(!python||!given)throw Error('Missing inputs');const root=path.resolve(given),o=options(flags);
    if(path.dirname(root)!==output)throw Error('Invalid campaign root');
    return o.shard?runShard(python,root,o.limit,o.retryFailed):runMaster(python,root);
  }).catch(()=>{console.error('Observed collection stopped: validation/runtime failure; no automatic restart.');process.exitCode=2;});
}
