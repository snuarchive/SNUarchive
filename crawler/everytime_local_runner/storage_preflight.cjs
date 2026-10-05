'use strict';
// Many small immutable evidence files require a small allocation unit.
// statfs measures the actual destination volume, not the review payload size.
const fs=require('node:fs');
function storagePreflight(directory,statfs=fs.statfsSync){
  const s=statfs(directory);
  const allocation=Number(s.bsize),free=Number(s.bavail)*allocation;
  if(!Number.isSafeInteger(allocation)||allocation<=0||!Number.isSafeInteger(free)||free<0)
    throw new Error('storage_capacity_unknown');
  if(allocation>65536)throw new Error('storage_allocation_unit_too_large');
  if(free<5*1024**3)throw new Error('storage_free_space_below_5_gib');
  return {allocation_unit_bytes:allocation,available_bytes:free};
}
module.exports={storagePreflight};
