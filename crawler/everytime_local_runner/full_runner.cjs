'use strict';
// Sequential full-catalog supervisor. It reuses the tested headed shard runner;
// no site requests, cookie reads, or extractor execution happen in this file.
const fs=require('node:fs'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {writeNew}=require('./runner.cjs');
const {storagePreflight}=require('./storage_preflight.cjs');
const repo=path.resolve(__dirname,'../..'), output=require('./output_root.cjs').outputRoot(repo);
function offline(python,root,command,flags=[]){
  const r=spawnSync(python,['-X','utf8','-B','-m','crawler.everytime_local_runner.full_campaign',command,'--root',root,...flags],
    {cwd:repo,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
  if(r.status!==0)throw new Error('full_campaign_validation_failed');
  return JSON.parse(r.stdout);
}
function mayContinue(event,exitCode,stopping){
  return !stopping&&exitCode===0&&event&&['finished','campaign_complete'].includes(event.status||event.event)&&
    !(event.states?.blocked>0)&&!(event.states?.failed>0);
}
async function executeShard(python,root,onEvent,onChild,options={}){
  const script=options.observed?'observed_runner.cjs':'priority_runner.cjs';
  const flags=options.observed?['--shard']:['--viewport-height=1100','--retry-search-limits'];
  return await new Promise(resolve=>{
    const child=spawn(process.execPath,[path.join(__dirname,script),python,root,...flags],
      {cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']});
    onChild(child);let buffer='',terminal=null;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      buffer+=chunk;let end;
      while((end=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);
        try{
          const event=JSON.parse(line);
          if(['execution_finished','campaign_complete'].includes(event.event))terminal=event;
          onEvent(event);
        }catch{onEvent({event:'unparsed_child_output_suppressed'});}
      }
    });
    // Never echo unexpected child exception text or DOM fragments.
    child.stderr.on('data',()=>{});
    child.on('error',()=>resolve({terminal,exitCode:2}));
    child.on('exit',code=>{onChild(null);resolve({terminal,exitCode:code});});
  });
}
async function main(){
  const [python,givenRoot]=process.argv.slice(2);
  if(!python||!givenRoot)throw new Error('Usage: full_runner.cjs <python.exe> <full-campaign>');
  const root=path.resolve(givenRoot);
  if(path.dirname(root)!==output)throw new Error('Invalid full campaign location');
  storagePreflight(output);
  const lock=path.join(root,'runner.lock');let child=null,stopping=false,locked=false,execution;
  const forward=data=>{
    if(data.toString().split(/\r?\n/).includes('stop'))stopping=true;
    if(child?.stdin.writable)child.stdin.write(data);
  };
  process.stdin.on('data',forward);
  try{
    writeNew(lock,{pid:process.pid,started_at:new Date().toISOString()});locked=true;
    const shards=offline(python,root,'pending');
    execution=fs.mkdtempSync(path.join(output,'full_execution_'));
    writeNew(path.join(execution,'invocation.json'),{pid:process.pid,campaign:root,shards:shards.map(s=>s.root),started_at:new Date().toISOString()});
    let sequence=0,terminal=null;
    const announce=event=>{
      const metadata={...event,at:new Date().toISOString()};
      fs.appendFileSync(path.join(execution,'events.jsonl'),JSON.stringify(metadata)+'\n','utf8');
      console.log(JSON.stringify(metadata));
    };
    announce({event:'full_campaign_started',execution,remaining_shards:shards.length,catalog_count:19155});
    for(const shard of shards){
      if(stopping)break;
      storagePreflight(output);
      announce({event:'shard_started',root:shard.root,priority:shard.priority,inputs:shard.inputs});
      const result=await executeShard(python,shard.root,announce,value=>{child=value;});
      terminal=result.terminal;
      const summary=offline(python,root,'summary');
      writeNew(path.join(execution,`progress_${String(++sequence).padStart(4,'0')}.json`),summary);
      announce({event:'catalog_progress',recorded:summary.recorded,pending:summary.pending,states:summary.states,
        reviews_saved_or_reused:summary.reviews_saved_or_reused,unresolved_count:summary.unresolved_count});
      if(!mayContinue(terminal,result.exitCode,stopping)){
        announce({event:'full_campaign_halted',status:terminal?.status||'failed',reason:terminal?.reason||'shard_did_not_finish_normally'});
        break;
      }
    }
    const summary=offline(python,root,'summary');
    writeNew(path.join(execution,'result.json'),{at:new Date().toISOString(),stopping,terminal,summary});
    announce({event:'full_execution_finished',execution,collection_complete:summary.collection_complete,
      pending:summary.pending,unresolved_count:summary.unresolved_count,operator_stop:stopping});
  }finally{
    process.stdin.off('data',forward);process.stdin.pause();
    if(locked&&!child&&fs.existsSync(lock))fs.unlinkSync(lock);
  }
}
module.exports={mayContinue,executeShard};
if(require.main===module)main().catch(()=>{console.error('Full collection stopped: local validation/runtime error; no automatic restart.');process.exitCode=2;});
