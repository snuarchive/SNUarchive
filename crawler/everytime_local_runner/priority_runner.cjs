'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {writeNew,bridge}=require('./runner.cjs');
const {loadCollectors,createAdapter}=require('./adapter.cjs');
const {openSession,failure,delay}=require('./browser_session.cjs');
const {createSearchPilot,searchAdapter,observeBoundedSearch,selectSearchMode}=require('./search_adapter.cjs');
const {createProfessorSearchPilot}=require('./professor_search.cjs');
const {errorLabel}=require('./overview_diagnostic.cjs');
const {safeFailureDiagnostic}=require('./failure_diagnostic.cjs');
const {campaignSearchCache}=require('./campaign_search_cache.cjs');
const {requestedStop}=require('./stop_request.cjs');
const {storagePreflight}=require('./storage_preflight.cjs');
const performancePolicy=Object.freeze({version:1,wheel_settle_ms:150,review_idle_wait_ms:1000,
  search_idle_wait_ms:2000,between_courses_ms:1500});
const repo=path.resolve(__dirname,'../..'),output=require('./output_root.cjs').outputRoot(repo);
function offline(python,root,command,extra=[]){
  const r=spawnSync(python,['-X','utf8','-B','-m','crawler.everytime_local_runner.campaign',command,'--root',root,...extra],
    {cwd:repo,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
  if(r.status!==0)throw failure('failed','campaign_validation_or_storage_error');return JSON.parse(r.stdout);
}
function runOptions(flags){
  let viewportHeight=900,retryPartial=false,retrySearchLimits=false,retryProfessorLimits=false;const seen=new Set();
  for(const flag of flags){
    const name=flag.split('=')[0];if(seen.has(name))throw new Error('Duplicate option');seen.add(name);
    if(flag==='--retry-partial')retryPartial=true;
    else if(flag==='--retry-search-limits')retrySearchLimits=true;
    else if(flag==='--retry-professor-limits')retryProfessorLimits=true;
    else if(/^--viewport-height=\d+$/.test(flag))viewportHeight=Number(flag.split('=')[1]);
    else throw new Error('Unknown option');
  }
  if(viewportHeight<900||viewportHeight>1200)throw new Error('Viewport height outside normal headed bounds');
  return {viewportHeight,retryPartial,retrySearchLimits,retryProfessorLimits};
}
function sessionSearchCache(){
  const entries=new Map();
  return {
    lookup(query){
      const prior=entries.get(query);
      if(prior&&crypto.createHash('sha256').update(fs.readFileSync(prior.source)).digest('hex')!==prior.sha256)
        throw failure('failed','cached_search_source_changed');
      return prior||null;
    },
    remember(query,source,observation){
      // Called only after Python match_course has validated full search scope.
      if(observation.query!==query||observation.mode!=='name'||observation.scope?.ui_end!==true)
        throw failure('failed','invalid_search_reuse_scope');
      const data=fs.readFileSync(source);
      if(JSON.stringify(JSON.parse(data))!==JSON.stringify(observation))throw failure('failed','cached_search_source_differs');
      entries.set(query,{source,sha256:crypto.createHash('sha256').update(data).digest('hex'),observation});
    }
  };
}
async function main(){
  const [python,campaign,...flags]=process.argv.slice(2);
  if(!python||!campaign)throw new Error('Usage: priority_runner.cjs <python.exe> <campaign> [--retry-partial] [--viewport-height=900..1200]');
  const options=runOptions(flags);
  const root=path.resolve(campaign);
  const stop=requestedStop(root);
  if(stop){console.log(JSON.stringify(stop));return;}
  storagePreflight(output);
  const entries=offline(python,root,'pending',[...(options.retryPartial?['--retry-partial']:[]),...(options.retrySearchLimits?['--retry-search-limits']:[]),...(options.retryProfessorLimits?['--retry-professor-limits']:[])]);
  if(!entries.length){console.log(JSON.stringify({event:'campaign_complete',...offline(python,root,'summary')}));return;}
  const execution=fs.mkdtempSync(path.join(output,'priority_execution_'));
  writeNew(path.join(execution,'invocation.json'),{campaign:root,items:entries.map(e=>e.item_id),options,started_at:new Date().toISOString()});
  let session,current=null,currentRecorded=false,finalError=null,searchControlsRecorded=false;
  try{
    session=await openSession(execution,options);
    const pilot=createSearchPilot(),{create,collect:standardCollect}=loadCollectors(),searches=sessionSearchCache();
    // Only explicit partial retries use the local extended orchestration.
    // Browser guard, shared DOM parser and physical batch size stay unchanged.
    const extendedLocal=options.retryPartial||options.retryProfessorLimits;
    const collect=extendedLocal?require('./collect_extended.cjs'):standardCollect;
    const collectionLimits=extendedLocal?{maxScrolls:300,maxBatches:200}:{maxScrolls:30,maxBatches:20};
    writeNew(path.join(execution,'collection_limits.json'),{...collectionLimits,extended_local:extendedLocal});
    const sharedSearches=campaignSearchCache(root);
    writeNew(path.join(execution,'performance_policy.json'),performancePolicy);
    for(const entry of entries){
      storagePreflight(output);
      const began=Date.now(),timing={policy:performancePolicy};let phaseBegan=began;
      current=entry;currentRecorded=false;session.phase('search_'+entry.item_id);
      const step=fs.mkdtempSync(path.join(output,'priority_'+entry.item_id+'_'));
      fs.mkdirSync(path.join(step,'incoming'));
      writeNew(path.join(step,'invocation.json'),{item_id:entry.item_id,course:entry.course,campaign:root});
      await session.check();
      const reused=searches.lookup(entry.course.title)||sharedSearches?.lookup(entry.course.title);
      let search;const fallbackEvidence={};
      if(reused){
        search=reused.observation;
        writeNew(path.join(step,'search_reuse.json'),{source:reused.source,source_sha256:reused.sha256,
          scope:reused.scope||'same_live_browser_session_exact_name_query',execution,observed_at:search.observed_at,
          cache_record:reused.cache_record||null});
        console.log(JSON.stringify({event:'search_reused',item:entry.item_id}));
      }else{
        if(!['https://everytime.kr/lecture','https://everytime.kr/lecture/search'].includes(session.page.url().split('?')[0]))
          await session.page.goto('https://everytime.kr/lecture',{waitUntil:'domcontentloaded'});
        await selectSearchMode(session.page,session.check,'name');
        let observed=await observeBoundedSearch(pilot,searchAdapter(session.page,session.check,{wheelSettleMs:performancePolicy.wheel_settle_ms}),entry.course.title);
        await session.check();
        if(!searchControlsRecorded){
          const controls=await session.page.locator('div.categories input').evaluateAll(nodes=>nodes.map(n=>({
            type:n.type==='radio'?'radio':'other',
            value:['name','professor'].includes(n.value)?n.value:'[redacted]',
            label:Array.from(n.labels||[]).map(l=>l.innerText.trim()).map(t=>['과목명','교수명'].includes(t)?t:'[redacted]'),
            checked:n.checked
          })));
          if(controls.length){writeNew(path.join(execution,'search_controls.json'),{selector:'div.categories input',controls});searchControlsRecorded=true;}
        }
        if(observed.limited&&typeof entry.course.instructor==='string'&&
            !['','미정','담당교수','-','Staff','STAFF'].includes(entry.course.instructor.trim())){
          const firstEvidence=path.join(step,'name_bounded_search.json');
          writeNew(firstEvidence,{input:entry.course,...observed.limited});
          fallbackEvidence[firstEvidence]=crypto.createHash('sha256').update(fs.readFileSync(firstEvidence)).digest('hex');
          await selectSearchMode(session.page,session.check,'professor');
          observed=await observeBoundedSearch(createProfessorSearchPilot({extended:options.retryProfessorLimits}),
            searchAdapter(session.page,session.check,{wheelSettleMs:performancePolicy.wheel_settle_ms}),entry.course.instructor);
          await session.check();
          console.log(JSON.stringify({event:'professor_search_fallback',item:entry.item_id,complete_scope:!!observed.observation}));
        }
        if(observed.limited){
          const evidence=path.join(step,'bounded_search.json');
          writeNew(evidence,{input:entry.course,...observed.limited});
          const receipt=path.join(step,'decision_receipt.json');
          writeNew(receipt,{status:'needs_review',match_status:'incomplete_search',reason:observed.limited.reason,
            retry_policy:options.retryProfessorLimits?'extended_professor_800_v1':null,
            reviews_saved:0,files:{...fallbackEvidence,[evidence]:crypto.createHash('sha256').update(fs.readFileSync(evidence)).digest('hex')}});
          offline(python,root,'finish',['--item',entry.item_id,'--input',receipt]);
          currentRecorded=true;
          console.log(JSON.stringify({event:'course_finished',item:entry.item_id,status:'needs_review',reason:observed.limited.reason,reviews:0}));
          await delay(performancePolicy.between_courses_ms);
          continue;
        }
        search=observed.observation;
      }
      timing.search_ms=Date.now()-phaseBegan;timing.search_reused=!!reused;phaseBegan=Date.now();
      const searchPath=path.join(step,'search.json');writeNew(searchPath,search);
      const decisionPath=path.join(step,'match.json');
      const decision=offline(python,root,'match',['--item',entry.item_id,'--search',searchPath,'--output',decisionPath]);
      if(!reused&&search.mode==='name'){searches.remember(entry.course.title,searchPath,search);sharedSearches?.remember(entry.course.title,searchPath,search);}
      timing.match_ms=Date.now()-phaseBegan;phaseBegan=Date.now();
      if(decision.status!=='matched'){
        const result={status:decision.status==='not_found'?'not_found':'needs_review',match_status:decision.status,
          reason:'verified_normal_search_result',reviews_saved:0,files:{...fallbackEvidence,[searchPath]:crypto.createHash('sha256').update(fs.readFileSync(searchPath)).digest('hex'),[decisionPath]:decision.decision_sha256}};
        const receipt=path.join(step,'decision_receipt.json');writeNew(receipt,result);
        offline(python,root,'finish',['--item',entry.item_id,'--input',receipt]);
        currentRecorded=true;
        timing.total_ms=Date.now()-began;writeNew(path.join(step,'timing.json'),timing);
        console.log(JSON.stringify({event:'course_finished',item:entry.item_id,status:result.status,reviews:0}));
        continue;
      }
      const target=decision.target;
      session.phase('collect_'+entry.item_id);
      await session.page.goto(target.url,{waitUntil:'domcontentloaded'});await session.check();
      // Wait for the observed count block as well as identity before parsing.
      await session.page.locator('div.rating > div.title > span.count, section.empty.review > div.title > span.count').first().waitFor({state:'visible',timeout:10000});
      timing.navigation_ms=Date.now()-phaseBegan;phaseBegan=Date.now();
      const collector=create(target);let report=null,guardError=null;
      const tab=createAdapter(session.page,{wheelSettleMs:performancePolicy.wheel_settle_ms,
        check:async()=>{try{await session.check();}catch(error){guardError=session.failure(error);throw error;}}});
      for await(const event of collect(tab,collector,{...collectionLimits,idleWaitMs:performancePolicy.review_idle_wait_ms})){
        if(event.type==='batch'||event.type==='failed_batch'){
          writeNew(path.join(step,'incoming',`event_${String(event.batch).padStart(3,'0')}.json`),event);
          bridge(python,'batch',step,['--number',String(event.batch)]);
        }else if(event.type==='complete')report=event.report;
      }
      timing.collect_and_batch_save_ms=Date.now()-phaseBegan;phaseBegan=Date.now();
      if(report.stop_error)report.stop_error=guardError?`${guardError.kind}: ${guardError.code}`:errorLabel(report.stop_error);
      writeNew(path.join(step,'incoming/ui_report.json'),report);bridge(python,'finalize',step);
      const result=offline(python,root,'record',['--item',entry.item_id,'--run',step,'--decision',decisionPath]);
      currentRecorded=true;
      timing.finalize_and_record_ms=Date.now()-phaseBegan;timing.total_ms=Date.now()-began;
      writeNew(path.join(step,'timing.json'),timing);
      console.log(JSON.stringify({event:'course_finished',item:entry.item_id,status:result.status,reviews:result.reviews_saved}));
      if(guardError)throw guardError;
      if(result.status==='blocked')throw failure('blocked','collector_access_stop');
      await delay(performancePolicy.between_courses_ms);
    }
  }catch(error){
    finalError=session?session.failure(error):error;
    writeNew(path.join(execution,'failure_diagnostic.json'),safeFailureDiagnostic(finalError));
    if(current&&!currentRecorded){
      const receipt=path.join(execution,'interruption.json');
      writeNew(receipt,{status:finalError.kind==='blocked'?'blocked':finalError.kind==='stopped'?'partial':'failed',
        match_status:'interrupted',reason:finalError.code||'unexpected_browser_or_dom_error',reviews_saved:0});
      // A failure receipt must not replace an already saved course result.
      try{offline(python,root,'finish',['--item',current.item_id,'--input',receipt]);}catch{}
    }
  }finally{
    let finalSummary=null;
    try {
      finalSummary=offline(python,root,'summary');
      writeNew(path.join(execution,'result.json'),{status:finalError?finalError.kind||'failed':'finished',reason:finalError?(finalError.code||'unexpected_browser_or_dom_error'):null,
        summary:finalSummary,finished_at:new Date().toISOString()});
    } catch {
      finalError=finalError||failure('failed','execution_summary_save_failed');
    } finally {
      // A disk/checksum failure must not strand a headed session or its lock.
      if(session)await session.close(finalError);
    }
    console.log(JSON.stringify({event:'execution_finished',execution,status:finalError?finalError.kind||'failed':'finished',reason:finalError?(finalError.code||'unexpected_browser_or_dom_error'):null,
      ...(finalSummary||{summary_unavailable:true})}));
  }
}
module.exports={offline,runOptions,sessionSearchCache};
if(require.main===module)main().catch(()=>{console.error('Priority runner setup failed; no automatic restart.');process.exitCode=2;});
