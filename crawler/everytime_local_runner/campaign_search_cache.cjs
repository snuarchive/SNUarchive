'use strict';
// Reuse only complete, observed UI searches within the same immutable campaign.
// Lecture identity/count/list validation still runs for every catalog entry.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const DAY=24*60*60*1000;
function requireValue(value,code){if(!value)throw new Error('Search cache: '+code);}
function writeExclusive(file,value){
  const fd=fs.openSync(file,'wx');
  try{fs.writeFileSync(fd,JSON.stringify(value),'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function campaignSearchCache(root,{now=Date.now}={}){
  root=path.resolve(root);
  if(!/_[BC]_\d{4}$/.test(root))return null;
  const master=root.replace(/_[BC]_\d{4}$/,'');
  const planFile=path.join(master,'plan.json');
  if(!fs.existsSync(planFile))return null;
  const planBytes=fs.readFileSync(planFile),plan=JSON.parse(planBytes);
  const masterHash=hash(planBytes),manifest=read(path.join(master,'manifest.json'));
  requireValue(plan.authorization==='user_full_catalog_goal'&&manifest.files['plan.json']===masterHash,'master_plan_changed');
  const shard=plan.shards.find(s=>path.resolve(s.root)===root);
  requireValue(shard&&hash(fs.readFileSync(path.join(root,'plan.json')))===shard.plan_sha256,'shard_plan_changed');
  const directory=path.join(master,'search_cache');
  fs.mkdirSync(directory,{recursive:true});
  function folder(query){return path.join(directory,hash(query));}
  function validScope(observation,query){
    requireValue(observation.query===query&&observation.mode==='name'&&observation.scope?.ui_end===true,'invalid_scope');
    requireValue(Number.isFinite(Date.parse(observation.observed_at)),'invalid_observation_time');
  }
  return {
    lookup(query){
      const location=folder(query);
      if(!fs.existsSync(location))return null;
      const names=fs.readdirSync(location).filter(n=>n.endsWith('.json')).sort().reverse();
      for(const name of names){
        const record=read(path.join(location,name));
        requireValue(record.campaign_plan_sha256===masterHash&&record.query===query,'cache_scope_changed');
        const age=now()-Date.parse(record.observed_at);
        requireValue(Number.isFinite(age),'invalid_cache_time');
        if(age<0||age>DAY)continue;
        const bytes=fs.readFileSync(record.source);
        requireValue(hash(bytes)===record.source_sha256,'cached_search_source_changed');
        const observation=JSON.parse(bytes);validScope(observation,query);
        requireValue(observation.observed_at===record.observed_at,'observation_time_changed');
        return {source:record.source,sha256:record.source_sha256,observation,
          scope:'same_campaign_exact_name_query_within_24_hours',cache_record:path.join(location,name)};
      }
      return null;
    },
    remember(query,source,observation){
      // Caller invokes this only AFTER the original Python matcher validates it.
      validScope(observation,query);
      const bytes=fs.readFileSync(source);
      requireValue(JSON.stringify(JSON.parse(bytes))===JSON.stringify(observation),'disk_observation_differs');
      const age=now()-Date.parse(observation.observed_at);
      requireValue(age>=0&&age<=DAY,'observation_not_current');
      const location=folder(query);fs.mkdirSync(location,{recursive:true});
      writeExclusive(path.join(location,String(now()).padStart(16,'0')+'_'+crypto.randomUUID()+'.json'),{
        campaign_plan_sha256:masterHash,query,source:path.resolve(source),source_sha256:hash(bytes),
        observed_at:observation.observed_at,max_age_ms:DAY});
    }
  };
}
module.exports={campaignSearchCache,DAY};
