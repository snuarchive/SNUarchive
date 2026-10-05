'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline');
const {spawnSync}=require('node:child_process');
const {chromium}=require('playwright');
const {loadCollectors,createAdapter}=require('./adapter.cjs');
const {writeNew,bridge}=require('./runner.cjs');
const {inspect,safeUrl}=require('./chrome_diagnostics.cjs');
const {DialogController}=require('./dialogs.cjs');
const {errorLabel,overviewDiagnostic}=require('./overview_diagnostic.cjs');
const repo=path.resolve(__dirname,'../..'),root=path.join(repo,'crawler/output/everytime_local_runner');
const profile=path.join(repo,'crawler/data/private/everytime_local_profile');
const lock=profile+'.runner.lock',stopMarker=profile+'.access_stop.json';
const targets=[
  {id:'603889',title:'프로그래밍방법론',instructor:'정교민',count:37,baseline:'everytime_three_20260930T143702Z/603889'},
  {id:'1785286',title:'특수교육학개론',instructor:'김주선',count:61,baseline:'everytime_match_20260930T161532Z/1785286'},
  {id:'2680931',title:'기업재무론',instructor:'David Schoenherr',count:55,baseline:'everytime_priority_20261002/courses/A0002'}
].map(t=>({...t,url:`https://everytime.kr/lecture/view/${t.id}?tab=article`}));
const emit=value=>console.log(JSON.stringify(value));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fault(kind,code){const error=new Error(kind+': '+code);error.kind=kind;error.code=code;return error;}

async function main() {
  const python=process.argv[2];if(!python)throw new Error('Python executable required');
  if(fs.existsSync(stopMarker))throw new Error('Prior access stop is unresolved');
  const ignore=spawnSync('git',['-c','safe.directory='+repo.replaceAll('\\','/'),'check-ignore','--quiet','crawler/data/private/everytime_local_profile/probe'],{cwd:repo,windowsHide:true});
  if(ignore.status!==0 || !fs.existsSync(profile) || fs.realpathSync(profile)!==profile)throw new Error('Experimental profile validation failed');
  const handle=fs.openSync(lock,'wx');fs.writeFileSync(handle,JSON.stringify({pid:process.pid}));fs.closeSync(handle);
  fs.mkdirSync(root,{recursive:true});const session=fs.mkdtempSync(path.join(root,'baseline_session_'));
  const sessionEvents=[],courseResults=[],diagnostics=[],navigation=[];
  let context,page,phase='launch',lastState=null,stopRequested=false,nextRequested=false,retryRequested=false,final=null,lastSignature='';
  const controller=new DialogController({onPending:evidence=>{
    emit({event:'dialog_pending',...evidence,session});
    writeNew(path.join(session,`dialog_${String(controller.records.length).padStart(3,'0')}.json`),evidence);
    // A native alert may suspend an in-flight evaluate. End the browser immediately
    // on a confirmed stop so we never depend on another DOM read to notice it.
    if(controller.terminal)context?.close().catch(()=>{});
  },onResolved:evidence=>emit({event:'dialog_acknowledged',code:evidence.code})});
  const input=readline.createInterface({input:process.stdin});
  input.on('line',line=>{
    if(line.trim()==='stop')stopRequested=true;
    if(line.trim()==='next')nextRequested=true;
    if(line.trim()==='retry')retryRequested=true;
    if(line.trim()==='ack')controller.acknowledge().catch(()=>{emit({event:'dialog_ack_error',reason:'dialog_state_needs_inspection'});});
  });
  const heartbeat=setInterval(()=>emit({event:'alive',phase,dialog_pending:!!controller.pending,session}),30000);
  async function ready() {
    while(controller.pending){
      if(controller.terminal)throw fault('blocked',controller.terminal.code);
      if(stopRequested)throw fault('stopped','operator_stop');
      const pending=controller.pending;
      // A single DOM promise stays suspended while a native alert is open. When
      // the user closes it, observing the page can clear our stale waiting state.
      if(!pending.probe)pending.probe=page.evaluate(()=>document.readyState)
        .then(()=>controller.userResolved(pending)).catch(()=>{});
      await delay(250);
    }
    if(controller.terminal)throw fault('blocked',controller.terminal.code);
    if(stopRequested)throw fault('stopped','operator_stop');
  }
  async function observe() {
    await ready();
    const state=await inspect(page);lastState=state;
    const signature=JSON.stringify(state);
    if(signature!==lastSignature){
      diagnostics.push({phase,at:new Date().toISOString(),...state});lastSignature=signature;
      writeNew(path.join(session,`ui_${String(diagnostics.length).padStart(3,'0')}.json`),diagnostics.at(-1));
    }
    if(state.category==='blocked'||state.category==='challenge')throw fault('blocked','observed_'+state.category);
    return state;
  }
  try{
    writeNew(path.join(session,'invocation.json'),{started_at:new Date().toISOString(),targets,profile,channel:'chrome',headed:true});
    context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:false,viewport:{width:1280,height:900}});
    page=context.pages()[0]||await context.newPage();
    page.on('dialog',dialog=>controller.handle(dialog));
    page.on('response',response=>{
      try{const request=response.request();if(request.isNavigationRequest()&&request.frame()===page.mainFrame())navigation.push({url:safeUrl(response.url()),status:response.status(),at:new Date().toISOString()});}catch{}
    });
    emit({event:'browser_open',session,version:context.browser().version(),persistent:true});
    phase='manual_login';
    await page.goto(targets[0].url.split('?')[0],{waitUntil:'domcontentloaded'});
    const deadline=Date.now()+30*60*1000;let announced=false,navigated=false;
    while(Date.now()<deadline){
      let state;
      try{state=await observe();}catch(error){
        if(/Execution context was destroyed|Cannot find context/.test(String(error))){await delay(250);continue;}throw error;
      }
      if(state.category==='lecture'&&[targets[0].url,targets[0].url.split('?')[0]].includes(page.url()))break;
      if(!announced){announced=true;emit({event:'manual_login_required',session,url:state.url,title:state.title});}
      if(state.signed_in_control&&!navigated){navigated=true;await page.goto(targets[0].url.split('?')[0],{waitUntil:'domcontentloaded'});continue;}
      await delay(750);
    }
    if(lastState?.category!=='lecture')throw fault('login_failed','manual_login_timeout');
    const {create,collect}=loadCollectors();
    for(let targetIndex=0;targetIndex<targets.length;){
      const item=targets[targetIndex];
      phase='collect_'+item.id;const run=fs.mkdtempSync(path.join(root,'baseline_'+item.id+'_'));
      fs.mkdirSync(path.join(run,'incoming'));
      const target={url:item.url,title:item.title,instructor:item.instructor};
      writeNew(path.join(run,'invocation.json'),{target,session,expected_count:item.count,channel:'chrome',started_at:new Date().toISOString()});
      if(page.url()!==item.url.split('?')[0]){await ready();await page.goto(item.url.split('?')[0],{waitUntil:'domcontentloaded'});}
      await observe();
      writeNew(path.join(run,'overview_diagnostic.json'),await overviewDiagnostic(page));
      const collector=create(target);let guardError=null,report=null;
      delete require.cache[require.resolve('./adapter.cjs')];
      const tab=require('./adapter.cjs').createAdapter(page,{check:async()=>{
        try{const state=await observe();if(state.category==='login')throw fault('login_failed','login_expired');}
        catch(error){guardError=error;throw error;}
      }});
      for await(const event of collect(tab,collector,{maxScrolls:12,maxBatches:20,idleWaitMs:1500})){
        if(event.type==='batch'||event.type==='failed_batch'){
          writeNew(path.join(run,'incoming',`event_${String(event.batch).padStart(3,'0')}.json`),event);
          const receipt=bridge(python,'batch',run,['--number',String(event.batch)]);emit({event:'batch_saved',id:item.id,...receipt});
        }else if(event.type==='progress')emit({event:'progress',id:item.id,loaded:event.state.count,bottom:event.state.at_bottom});
        else if(event.type==='complete')report=event.report;
      }
      if(report.stop_error)report.stop_error=guardError?`${guardError.kind}: ${guardError.code}`:errorLabel(report.stop_error);
      writeNew(path.join(run,'incoming/ui_report.json'),report);
      const archived=bridge(python,'finalize',run);
      if(guardError)throw guardError;
      if(archived.status!=='complete_for_observed_ui'||report.succeeded!==item.count){
        phase='review_required';emit({event:'collector_needs_review',run,status:archived.status,reason:report.stop_error||report.termination_reason});
        while(!retryRequested){await ready();await delay(250);}
        retryRequested=false;continue;
      }
      const baseline=path.resolve(repo,'../SNUarchive-data/crawler/output',item.baseline,'run_report.json');
      const cmp=spawnSync(python,['-X','utf8','-B','-m','crawler.everytime_local_runner','compare','--baseline',baseline,
        '--local',path.join(run,'run_report.json'),'--output',path.join(run,'comparison.json')],{cwd:repo,encoding:'utf8',windowsHide:true});
      if(cmp.status!==0)throw fault('failed','comparison_validation_failed');
      const comparison=JSON.parse(cmp.stdout);
      courseResults.push({id:item.id,run,comparison});
      writeNew(path.join(session,'course_'+item.id+'.json'),courseResults.at(-1));
      emit({event:'course_comparison',id:item.id,run,...comparison});
      if(!comparison.identical_review_collection)throw fault('needs_review','review_multiset_mismatch');
      if(item===targets[0]){
        phase='first_result_report_gate';emit({event:'first_course_pass_waiting_for_report',session});
        while(!nextRequested){await ready();await delay(250);}
      }
      targetIndex++;
    }
    final={status:'three_baselines_verified',courseResults};
  }catch(error){
    if(controller.terminal)error=fault('blocked',controller.terminal.code);
    final={status:error.kind||'failed',reason:error.code||'browser_or_local_runtime_error',phase,courseResults};
    if(error.kind==='blocked'&&!fs.existsSync(stopMarker))writeNew(stopMarker,{session,reason:final.reason,at:new Date().toISOString()});
  }finally{
    clearInterval(heartbeat);input.close();
    writeNew(path.join(session,'diagnostics.json'),{diagnostics,navigation,dialogs:controller.records});
    writeNew(path.join(session,'result.json'),final);
    const files={};for(const f of fs.readdirSync(session))if(fs.statSync(path.join(session,f)).isFile())files[f]=crypto.createHash('sha256').update(fs.readFileSync(path.join(session,f))).digest('hex');
    writeNew(path.join(session,'manifest.json'),{status:final.status,files});
    if(context)await context.close().catch(()=>{});
    fs.unlinkSync(lock);emit({event:'session_finished',session,...final});
  }
}
if(require.main===module)main().catch(()=>{emit({event:'setup_failed',reason:'profile_lock_or_access_stop_or_invalid_configuration'});process.exitCode=2;});
