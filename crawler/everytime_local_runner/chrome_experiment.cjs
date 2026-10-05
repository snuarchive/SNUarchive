'use strict';
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {chromium}=require('playwright');
const {loadCollectors,createAdapter}=require('./adapter.cjs');
const {writeNew,bridge}=require('./runner.cjs');
const {safeUrl,fixedSignals,inspect}=require('./chrome_diagnostics.cjs');
const repo=path.resolve(__dirname,'../..');
const target={url:'https://everytime.kr/lecture/view/603889?tab=article',title:'프로그래밍방법론',instructor:'정교민'};
const base=target.url.split('?')[0];

function stop(outcome,reason){const e=new Error(reason);e.outcome=outcome;e.reason=reason;return e;}
function reserveProfile() {
  const relative='crawler/data/private/everytime_local_profile';
  const profile=path.resolve(repo,relative);
  const gitArgs=['-c','safe.directory='+repo.replaceAll('\\','/')];
  const ignored=spawnSync('git',[...gitArgs,'check-ignore','--quiet',relative+'/profile_probe'],{cwd:repo,windowsHide:true});
  const tracked=spawnSync('git',[...gitArgs,'ls-files','--',relative],{cwd:repo,encoding:'utf8',windowsHide:true});
  if(ignored.status!==0 || tracked.status!==0 || tracked.stdout.trim()) throw new Error('Profile must be Git ignored and untracked');
  fs.mkdirSync(path.dirname(profile),{recursive:true});
  fs.mkdirSync(profile); // new experiment only, no existing Chrome profile is accepted
  fs.mkdirSync(path.join(profile,'Default'));
  // Disable password saving in this new experimental profile. No credential values.
  writeNew(path.join(profile,'Default/Preferences'),{credentials_enable_service:false,profile:{password_manager_enabled:false}});
  return profile;
}

async function main() {
  const python=process.argv[2];
  if(!python) throw new Error('Supply Python executable');
  const root=path.join(repo,'crawler/output/everytime_local_runner');
  fs.mkdirSync(root,{recursive:true});
  const run=fs.mkdtempSync(path.join(root,'chrome_comparison_'));
  fs.mkdirSync(path.join(run,'incoming'));
  const profile=reserveProfile();
  writeNew(path.join(run,'invocation.json'),{target,browser_channel:'chrome',headed:true,persistent_profile:profile,
    started_at:new Date().toISOString(),experiment:'single_603889_only',expected_count:37});
  let context,page,last=null,dialogState=null,result=null,phase='launch',manualLogin=false;
  let identityVerified=false,report=null,returnedToLecture=false,lastSignature='';
  const snapshots=[],navigations=[],dialogs=[],buffer=[];
  const observe=async()=>{
    const state=await inspect(page); last=state;
    const signature=JSON.stringify(state);
    if(signature!==lastSignature){snapshots.push({observed_at:new Date().toISOString(),phase,...state});lastSignature=signature;}
    return state;
  };
  const enforce=(state)=>{
    if(dialogState) throw stop(dialogState.outcome,dialogState.reason);
    if(state.category==='blocked') throw stop('blocked','explicit_access_restriction_ui');
    if(state.category==='challenge') throw stop(manualLogin?'blocked':'login_failed','visible_human_verification_challenge');
  };
  try {
    context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:false,viewport:{width:1280,height:900}});
    page=context.pages()[0] || await context.newPage();
    writeNew(path.join(run,'browser.json'),{channel:'chrome',version:context.browser().version(),
      playwright:require('playwright/package.json').version,persistent:true});
    page.on('response',response=>{
      try {
        const request=response.request();
        if(!request.isNavigationRequest() || request.frame()!==page.mainFrame()) return;
        const chain=[];let previous=request.redirectedFrom();
        while(previous){chain.unshift(safeUrl(previous.url()));previous=previous.redirectedFrom();}
        navigations.push({observed_at:new Date().toISOString(),url:safeUrl(response.url()),status:response.status(),redirected_from:chain});
      }catch{/* Detached frames have no usable metadata. */}
    });
    page.on('dialog',async dialog=>{
      const signals=fixedSignals(dialog.message());
      const record={type:dialog.type(),signals};dialogs.push(record);
      if(signals.access_restricted||signals.rate_limited||signals.abnormal_access) dialogState={outcome:'blocked',reason:'explicit_restriction_dialog'};
      else if(signals.human_verification) dialogState={outcome:manualLogin?'blocked':'login_failed',reason:'human_verification_dialog'};
      else if(!signals.authentication_required) dialogState={outcome:'unexpected_ui',reason:'unrecognized_dialog'};
      await dialog.dismiss().catch(()=>{});
    });
    console.log(JSON.stringify({event:'installed_chrome_open',run,channel:'chrome',version:context.browser().version(),persistent:true}));
    phase='manual_login';
    await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
    const deadline=Date.now()+900000;
    let notified=false,unknownSince=null;
    while(Date.now()<deadline){
      let state;
      try{state=await observe();}catch(e){
        if(/Execution context was destroyed|Cannot find context/.test(String(e))){await page.waitForTimeout(300);continue;}
        throw e;
      }
      enforce(state);
      if(state.category==='lecture' && [base,target.url].includes(page.url())){manualLogin=true;break;}
      if(!notified){notified=true;console.log(JSON.stringify({event:'manual_login_required',run,url:state.url,title:state.title}));}
      if(state.signed_in_control && state.category!=='login' && !returnedToLecture){
        manualLogin=true;returnedToLecture=true;
        await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});continue;
      }
      if(state.category==='unknown' && state.ready==='complete'){
        unknownSince??=Date.now();
        if(Date.now()-unknownSince>15000) throw stop('unexpected_ui','loaded_page_has_no_login_or_expected_lecture_structure');
      }else unknownSince=null;
      await page.waitForTimeout(750);
    }
    if(!manualLogin) throw stop('login_failed','manual_login_not_completed');
    phase='verify_and_collect';
    // Prepare expects the overview; navigate only within the single authorized lecture.
    if(page.url()===target.url) await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
    const {create,collect}=loadCollectors();
    const collector=create(target),originalPrepare=collector.prepare;
    collector.prepare=async(...args)=>{
      const value=await originalPrepare(...args);
      identityVerified=true;
      if(value.displayed_total.value!==37) throw stop('unexpected_ui','displayed_total_changed_from_37');
      return value;
    };
    const tab=createAdapter(page,{check:async()=>{
      const state=await observe();enforce(state);
      if(state.category==='login') throw stop('login_failed','login_lost_before_collection_completed');
    }});
    for await(const event of collect(tab,collector,{maxScrolls:12,maxBatches:2,idleWaitMs:1500})){
      if(['batch','failed_batch'].includes(event.type)) buffer.push(event);
      if(event.type==='progress') console.log(JSON.stringify({event:'collection_progress',loaded:event.state.count,bottom:event.state.at_bottom}));
      if(event.type==='complete') report=event.report;
    }
    const state=await observe();enforce(state);
    if(state.category==='login') throw stop('login_failed','login_lost_during_collection');
    if(!report || report.status!=='complete' || report.succeeded!==37 || report.failed!==0 || report.displayed_total?.value!==37)
      throw stop('unexpected_ui',report?.termination_reason==='interrupted'?'collector_identity_or_structure_mismatch':(report?.termination_reason||'collector_incomplete'));
    // This experiment writes review data only after confirmed access and all 37 rows.
    phase='save';
    for(const event of buffer){
      writeNew(path.join(run,'incoming',`event_${String(event.batch).padStart(3,'0')}.json`),event);
      bridge(python,'batch',run,['--number',String(event.batch)]);
    }
    writeNew(path.join(run,'incoming/ui_report.json'),report);
    const finalized=bridge(python,'finalize',run);
    if(finalized.status!=='complete_for_observed_ui') throw new Error('Finalization did not verify completion');
    phase='compare';
    const baseline=path.resolve(repo,'../SNUarchive-data/crawler/output/everytime_three_20260930T143702Z/603889/run_report.json');
    const comparison=spawnSync(python,['-X','utf8','-B','-m','crawler.everytime_local_runner','compare',
      '--baseline',baseline,'--local',path.join(run,'run_report.json'),'--output',path.join(run,'comparison.json')],
      {cwd:repo,encoding:'utf8',windowsHide:true});
    if(comparison.status!==0) throw new Error('Comparison validation failed');
    result={outcome:'normal_access',letter:'A',reviews_saved:37,comparison:JSON.parse(comparison.stdout)};
  }catch(error){
    const outcome=error.outcome || (phase==='manual_login'?'login_failed':'unexpected_ui');
    result={outcome,letter:{login_failed:'B',blocked:'C',unexpected_ui:'D'}[outcome],
      reason:error.reason || (phase==='launch'?'chrome_launch_failed':phase==='save'||phase==='compare'?'local_storage_or_comparison_failed':'browser_or_dom_observation_failed'),
      reviews_saved:fs.existsSync(path.join(run,'run_report.json'))?37:0};
  }finally{
    if(page && !page.isClosed()) {try{await observe();}catch{}}
    result={...result,phase,manual_login_confirmed:manualLogin,identity_verified:identityVerified,
      final_observation:last,finished_at:new Date().toISOString()};
    writeNew(path.join(run,'diagnostics.json'),{snapshots,navigations,dialogs});
    writeNew(path.join(run,'experiment_result.json'),result);
    const files={};
    function inventory(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
      const file=path.join(folder,entry.name);if(entry.isDirectory())inventory(file);
      else files[path.relative(run,file).replaceAll('\\','/')]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}}
    inventory(run);
    const hash=writeNew(path.join(run,'experiment_manifest.json'),{outcome:result.outcome,files});
    fs.writeFileSync(path.join(run,'experiment_manifest.sha256'),hash+'  experiment_manifest.json\n',{flag:'wx'});
    if(context) await context.close().catch(()=>{});
    console.log(JSON.stringify({event:'experiment_finished',run,...result}));
  }
}
module.exports={reserveProfile};
if(require.main===module)main().catch(()=>{console.error('Experiment setup failed before site access. Existing files/profile are never replaced.');process.exitCode=2;});
