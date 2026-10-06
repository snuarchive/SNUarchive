'use strict';
// Many small immutable evidence files require a small allocation unit.
// statfs measures the actual destination volume, not the review payload size.
const fs=require('node:fs');
const path=require('node:path');
function storagePreflight(directory,statfs=fs.statfsSync,{profile=false}={}){
  const s=statfs(directory);
  const allocation=Number(s.bsize),free=Number(s.bavail)*allocation;
  if(!Number.isSafeInteger(allocation)||allocation<=0||!Number.isSafeInteger(free)||free<0)
    throw new Error('storage_capacity_unknown');
  let reserve=5*1024**3,compact=false;
  const configured=process.env.EVERYTIME_COMPACT_ROOT;
  if(configured){
    const root=path.resolve(configured),relative=path.relative(root,path.resolve(directory));
    const policy=JSON.parse(fs.readFileSync(path.join(root,'compact_policy.json'),'utf8'));
    if(policy.version!==1||policy.minimum_free_gib!==20)throw Error('invalid_compact_policy');
    compact=profile||relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative));
    if(compact)reserve=20*1024**3;
  }
  if(allocation>65536&&!(compact&&allocation<=524288))throw new Error('storage_allocation_unit_too_large');
  if(free<reserve)throw new Error(compact?'compact_storage_free_space_below_20_gib':'storage_free_space_below_5_gib');
  return {allocation_unit_bytes:allocation,available_bytes:free};
}
module.exports={storagePreflight};
