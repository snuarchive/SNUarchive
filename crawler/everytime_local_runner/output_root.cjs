'use strict';
const path=require('node:path');
function outputRoot(repo,env=process.env){
  const given=env.EVERYTIME_LOCAL_OUTPUT_ROOT;
  if(given&&!path.isAbsolute(given))throw new Error('Output root must be absolute');
  return given?path.resolve(given):path.join(repo,'crawler/output/everytime_local_runner');
}
module.exports={outputRoot};
