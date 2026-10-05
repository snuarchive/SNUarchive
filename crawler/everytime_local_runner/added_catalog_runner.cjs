'use strict';
// Sequential additive catalog shards, using the existing guarded UI collector.
const fs=require('node:fs'),path=require('node:path');
const {executeShard,mayContinue}=require('./full_runner.cjs');
const {writeNew}=require('./runner.cjs');
const {storagePreflight}=require('./storage_preflight.cjs');
const crypto=require('node:crypto');
async function main(){
  const [python,root]=process.argv.slice(2);
  const planFile=path.join(root,'plan.json');
  const plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
  const seal=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  if(hash(planFile)!==seal.plan_sha256||plan.authorization!=='user_added_semester_collection')throw Error('Invalid plan');
  for(const s of plan.shards)if(hash(path.join(s.root,'plan.json'))!==s.plan_sha256)throw Error('Changed shard');
  const lock=path.join(root,'runner.lock');writeNew(lock,{pid:process.pid});
  let child=null,stopping=false;
  const forward=data=>{if(data.toString().split(/\r?\n/).includes('stop'))stopping=true;if(child?.stdin.writable)child.stdin.write(data);};
  process.stdin.on('data',forward);
  const log=e=>{const event={...e,at:new Date().toISOString()};fs.appendFileSync(path.join(root,'events.jsonl'),JSON.stringify(event)+'\n');console.log(JSON.stringify(event));};
  try{
    log({event:'added_catalog_started',courses:plan.added_courses,verified_reuse:plan.reuse_count,shards:plan.shards.length});
    for(const shard of plan.shards){
      if(stopping)break;
      if(fs.existsSync(path.join(root,'operator_stop_request.json'))){
        log({event:'operator_stopped',reason:'persistent_operator_stop_request'});return;
      }
      storagePreflight(path.dirname(root));
      log({event:'shard_started',root:shard.root});
      const result=await executeShard(python,shard.root,log,c=>child=c);
      if(!mayContinue(result.terminal,result.exitCode,stopping)){
        log({event:'added_catalog_halted',status:result.terminal?.status||'failed'});return;
      }
    }
    log({event:stopping?'operator_stopped':'added_catalog_queue_finished'});
  }finally{process.stdin.off('data',forward);process.stdin.pause();if(!child)fs.unlinkSync(lock);}
}
if(require.main===module)main().catch(()=>{console.error('Added catalog collection stopped: validation/runtime error.');process.exitCode=2;});
