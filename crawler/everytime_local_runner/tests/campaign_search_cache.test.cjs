'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {campaignSearchCache,DAY}=require('../campaign_search_cache.cjs');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t){
  const temp=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(temp,'everytime_shared_cache_'));
  t.after(()=>{const resolved=fs.realpathSync(dir);assert.equal(path.dirname(resolved),temp);
    assert.ok(path.basename(resolved).startsWith('everytime_shared_cache_'));fs.rmSync(resolved,{recursive:true});});
  const master=path.join(dir,'campaign'),roots=[master+'_B_0001',master+'_B_0002'];
  const save=(f,v)=>fs.writeFileSync(f,JSON.stringify(v));
  fs.mkdirSync(master);for(const root of roots){fs.mkdirSync(root);save(path.join(root,'plan.json'),{synthetic:true});}
  save(path.join(master,'plan.json'),{authorization:'user_full_catalog_goal',shards:roots.map(root=>({root,plan_sha256:hash(path.join(root,'plan.json'))}))});
  save(path.join(master,'manifest.json'),{files:{'plan.json':hash(path.join(master,'plan.json'))}});
  let now=Date.parse('2026-10-02T10:00:00Z');
  const observation={query:'같은 강의',mode:'name',scope:{ui_end:true},observed_at:new Date(now).toISOString(),candidates:[{instructor:'A'},{instructor:'B'}]};
  const source=path.join(dir,'search.json');save(source,observation);
  return {roots,master,source,observation,cache:i=>campaignSearchCache(roots[i],{now:()=>now}),advance:n=>{now+=n;}};
}
test('validated original search survives shard boundary without changing source/time/candidates',t=>{
  const f=fixture(t);f.cache(0).remember(f.observation.query,f.source,f.observation);
  const result=f.cache(1).lookup(f.observation.query);
  assert.deepEqual(result.observation,f.observation);assert.equal(result.source,f.source);
  assert.equal(f.cache(1).lookup('different'),null);
});
test('cache expires after 24 hours and does not reuse future observations',t=>{
  const f=fixture(t);f.cache(0).remember(f.observation.query,f.source,f.observation);
  f.advance(-1);assert.equal(f.cache(1).lookup(f.observation.query),null);
  f.advance(DAY+2);assert.equal(f.cache(1).lookup(f.observation.query),null);
});
test('tampered source stops reuse',t=>{
  const f=fixture(t);f.cache(0).remember(f.observation.query,f.source,f.observation);
  fs.appendFileSync(f.source,' ');assert.throws(()=>f.cache(1).lookup(f.observation.query),/cached_search_source_changed/);
});
test('master and shard checksums are verified before cache use',t=>{
  const f=fixture(t);fs.appendFileSync(path.join(f.roots[0],'plan.json'),' ');
  assert.throws(()=>f.cache(0),/shard_plan_changed/);
  fs.appendFileSync(path.join(f.master,'plan.json'),' ');assert.throws(()=>f.cache(1),/master_plan_changed/);
});
test('incomplete/wrong-query/mismatched source cannot be cached',t=>{
  const f=fixture(t),c=f.cache(0);
  assert.throws(()=>c.remember('different',f.source,f.observation),/invalid_scope/);
  assert.throws(()=>c.remember(f.observation.query,f.source,{...f.observation,scope:{ui_end:false}}),/invalid_scope/);
  assert.throws(()=>c.remember(f.observation.query,f.source,{...f.observation,candidates:[]}),/disk_observation_differs/);
});
test('different campaigns cannot see each other and renewal never overwrites entries',t=>{
  const a=fixture(t),b=fixture(t),c=a.cache(0);
  c.remember(a.observation.query,a.source,a.observation);c.remember(a.observation.query,a.source,a.observation);
  const locations=fs.readdirSync(path.join(a.master,'search_cache'));
  assert.equal(fs.readdirSync(path.join(a.master,'search_cache',locations[0])).length,2);
  assert.equal(b.cache(0).lookup(a.observation.query),null);
});
