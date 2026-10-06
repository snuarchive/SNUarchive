'use strict';
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {spawnSync}=require('node:child_process');
const {chromium}=require('playwright');
const {DialogController}=require('./dialogs.cjs');
const {inspect}=require('./chrome_diagnostics.cjs');
const {writeNew}=require('./runner.cjs');
const {storagePreflight}=require('./storage_preflight.cjs');
const repo=path.resolve(__dirname,'../..'),profile=path.join(repo,'crawler/data/private/everytime_local_profile');
const lock=profile+'.runner.lock',stopMarker=profile+'.access_stop.json';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function failure(kind,code){return Object.assign(new Error(kind+': '+code),{kind,code});}

async function openSession(run, {viewportHeight=900}={}) {
  // Browser cache/profile writes occur on a different volume from raw output.
  // Fail closed before launch and throughout collection on either low volume.
  storagePreflight(profile,undefined,{profile:true});
  storagePreflight(run);
  if(!Number.isInteger(viewportHeight)||viewportHeight<900||viewportHeight>1200)throw failure('failed','invalid_viewport_height');
  if(fs.existsSync(stopMarker))throw failure('blocked','prior_access_stop');
  const git=spawnSync('git',['-c','safe.directory='+repo.replaceAll('\\','/'),'check-ignore','--quiet','crawler/data/private/everytime_local_profile/probe'],{cwd:repo,windowsHide:true});
  if(git.status!==0||fs.realpathSync(profile)!==profile)throw failure('failed','unsafe_profile_path');
  writeNew(lock,{pid:process.pid,run});
  let context,page,stop=false,phase='launch',sequence=0,latest=null;
  const controller=new DialogController({onPending:evidence=>{
    writeNew(path.join(run,`dialog_${String(controller.records.length).padStart(3,'0')}.json`),evidence);
    console.log(JSON.stringify({event:'dialog_pending',...evidence}));
    if(controller.terminal)context?.close().catch(()=>{});
  }});
  const input=readline.createInterface({input:process.stdin});
  input.on('line',line=>{
    if(line.trim()==='stop')stop=true;
    if(line.trim()==='ack')controller.acknowledge().catch(()=>console.log(JSON.stringify({event:'dialog_ack_error'})));
  });
  const heartbeat=setInterval(()=>console.log(JSON.stringify({event:'alive',phase,dialog_pending:!!controller.pending})),30000);
  async function ready(){
    do{
      if(controller.terminal)throw failure('blocked',controller.terminal.code);
      if(stop)throw failure('stopped','operator_stop');
      const pending=controller.pending;
      if(!pending)return;
      if(!pending.probe)pending.probe=page.evaluate(()=>document.readyState).then(()=>controller.userResolved(pending)).catch(()=>{});
      await delay(250);
    }while(true);
  }
  async function check({allowLogin=false}={}){
    storagePreflight(profile,undefined,{profile:true});
    storagePreflight(run);
    await ready();let state;
    try{state=await inspect(page);}catch(error){if(controller.terminal)throw failure('blocked',controller.terminal.code);throw error;}
    const signature=JSON.stringify(state);
    if(signature!==latest){latest=signature;writeNew(path.join(run,`ui_${String(++sequence).padStart(4,'0')}.json`),{phase,...state});}
    if(['blocked','challenge'].includes(state.category))throw failure('blocked','observed_'+state.category);
    if(state.category==='login'&&!allowLogin)throw failure('login_failed','login_expired');
    return state;
  }
  async function close(reason){
    try {
      if(reason?.kind==='blocked'&&!fs.existsSync(stopMarker))writeNew(stopMarker,{run,reason:reason.code,at:new Date().toISOString()});
    } finally {
      clearInterval(heartbeat);input.close();
      if(context)await context.close().catch(()=>{});
      // Keep the lock as a fail-closed marker if a required security record
      // could not be written; it must not become an automatically resumable run.
      if(!(reason?.kind==='blocked'&&!fs.existsSync(stopMarker))&&fs.existsSync(lock))fs.unlinkSync(lock);
    }
  }
  try{
    context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:false,viewport:{width:1280,height:viewportHeight}});
    page=context.pages()[0]||await context.newPage();
    page.on('dialog',dialog=>controller.handle(dialog));
    writeNew(path.join(run,'browser.json'),{channel:'chrome',version:context.browser().version(),persistent_profile:profile,
      viewport:{width:1280,height:viewportHeight}});
    phase='manual_login';await page.goto('https://everytime.kr/lecture',{waitUntil:'domcontentloaded'});
    const deadline=Date.now()+1800000;let announced=false;
    while(Date.now()<deadline){
      let state;try{state=await check({allowLogin:true});}catch(error){if(/Execution context was destroyed/.test(String(error))){await delay(250);continue;}throw error;}
      if(state.category!=='login'&&await page.getByRole('searchbox').count()===1)break;
      if(!announced&&state.category==='login'){announced=true;console.log(JSON.stringify({event:'manual_login_required',url:state.url}));}
      if(state.signed_in_control)await page.goto('https://everytime.kr/lecture',{waitUntil:'domcontentloaded'});
      await delay(750);
    }
    if(await page.getByRole('searchbox').count()!==1)throw failure('failed','manual_login_timeout_or_unexpected_landing');
    return {page,check,ready,close,phase:value=>{phase=value;},failure:error=>controller.terminal?failure('blocked',controller.terminal.code):error};
  }catch(error){await close(controller.terminal?failure('blocked',controller.terminal.code):error);throw error;}
}
module.exports={openSession,failure,delay};
