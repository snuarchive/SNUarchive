'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {sessionSearchCache}=require('../priority_runner.cjs');
function fixture(t){
  const temporaryRoot=fs.realpathSync(os.tmpdir());
  const directory=fs.mkdtempSync(path.join(temporaryRoot,'everytime_search_cache_test_'));
  t.after(()=>{
    const resolved=fs.realpathSync(directory);
    assert.equal(path.dirname(resolved),temporaryRoot);
    assert.ok(path.basename(resolved).startsWith('everytime_search_cache_test_'));
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  const file=path.join(directory,'search.json');
  const observation={query:'same title',mode:'name',scope:{ui_end:true},observed_at:'2026-10-02T00:00:00Z',
    candidates:[{title:'same title',instructor:'A'},{title:'same title',instructor:'B'}]};
  fs.writeFileSync(file,JSON.stringify(observation));
  return {file,observation};
}
test('same-session cache preserves complete candidates and original observation time',t=>{
  const {file,observation}=fixture(t),cache=sessionSearchCache();
  cache.remember('same title',file,observation);
  assert.deepEqual(cache.lookup('same title').observation,observation);
  assert.equal(cache.lookup('different title'),null);
  assert.equal(sessionSearchCache().lookup('same title'),null);
});
test('changed saved observation stops reuse instead of silently using memory',t=>{
  const {file,observation}=fixture(t),cache=sessionSearchCache();
  cache.remember('same title',file,observation);fs.appendFileSync(file,' ');
  assert.throws(()=>cache.lookup('same title'),/cached_search_source_changed/);
});
test('wrong query, wrong scope and disk/memory mismatch cannot enter cache',t=>{
  const {file,observation}=fixture(t),cache=sessionSearchCache();
  assert.throws(()=>cache.remember('another title',file,observation),/invalid_search_reuse_scope/);
  assert.throws(()=>cache.remember('same title',file,{...observation,scope:{ui_end:false}}),/invalid_search_reuse_scope/);
  assert.throws(()=>cache.remember('same title',file,{...observation,candidates:[]}),/cached_search_source_differs/);
});
