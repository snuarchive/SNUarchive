// Synthetic only. No browser or network; reuse original DOM parser fixture.
const {create,target,fake,state}=require('../../everytime_collect/tests/fake_browser.cjs');
const collect=require('../collect_extended.cjs');
async function scenario(options={},limits={}) {
  const frames=Array.from({length:68},(_,i)=>state(Math.min((i+1)*20,1348),i===67));
  // A duplicate across batches must remain saved and flagged.
  for(const frame of frames) if(frame.count>420)frame.rows[420].text=frame.rows[0].text;
  const f=fake({frames,...options}),events=[];
  for await(const event of collect(f.tab,create(target),{maxScrolls:300,maxBatches:200,idleWaitMs:1000,...limits}))events.push(event);
  return events;
}
module.exports={scenario};
if(require.main===module) scenario().then(events=>process.stdout.write(JSON.stringify(events)));
