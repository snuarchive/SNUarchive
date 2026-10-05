'use strict';
// A full-campaign stop request is checked only before opening a new shard.
// It is separate from access-stop markers and never changes raw/checkpoints.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function requestedStop(root){
  const absolute=path.resolve(root), match=/^(.+)_[ABC]_\d{4}$/.exec(path.basename(absolute));
  if(!match)return null;
  const file=path.join(path.dirname(absolute),match[1],'operator_stop_request.json');
  if(!fs.existsSync(file))return null;
  const data=fs.readFileSync(file), request=JSON.parse(data);
  if(request.version!==1||request.action!=='stop_before_next_shard'||
     request.campaign!==match[1]||request.reason!=='low_disk_space')
    throw new Error('Invalid local operator stop request');
  return {event:'execution_finished',status:'stopped',reason:'operator_stop_low_disk_space',
    stop_request:file,stop_request_sha256:crypto.createHash('sha256').update(data).digest('hex')};
}
module.exports={requestedStop};
