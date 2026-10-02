const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runBuilder,inspectSources,audit}=require('../audit_full_queue.cjs');
const outputRoot=path.resolve('crawler/output');
function fixture(t){
  const root=fs.mkdtempSync(path.join(outputRoot,'queue_audit_test_'));
  t.after(()=>{
    const resolved=path.resolve(root);
    assert.equal(path.dirname(resolved),outputRoot);assert(path.basename(resolved).startsWith('queue_audit_test_'));
    fs.rmSync(resolved,{recursive:true});
  });
  fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'public'));
  fs.copyFileSync('scripts/build-courses.js',path.join(root,'scripts/build-courses.js'));
  const row=(course_title,instructor,year,department='D')=>({course_title,instructor,year,semester:1,department});
  fs.writeFileSync(path.join(root,'2024-1.json'),JSON.stringify([row(' A  Course ',' Prof A ',2024),row('A Course','Prof A',2024),row('B','',2024,'')]));
  fs.writeFileSync(path.join(root,'2025-1.json'),JSON.stringify([row('aCourse','profa',2025),row('B',null,2025,''),row('','',2025)]));
  return root;
}
test('actual builder is read-only; raw pairs, blank fallback and unique offerings are counted separately',t=>{
  const root=fixture(t),p=path.join(root,'public/courses.json');fs.writeFileSync(p,'sentinel');
  const build=runBuilder(root),{stats}=inspectSources(build);
  assert.equal(fs.readFileSync(p,'utf8'),'sentinel');
  assert.equal(stats.source_rows,6);assert.equal(stats.invalid_rows,1);
  assert.equal(stats.exact_raw_title_instructor_pairs,6);assert.equal(stats.exact_valid_raw_pairs,5);
  assert.equal(stats.normalized_course_keys,2);assert.equal(stats.unique_offerings,4);
  assert.equal(stats.courses_with_multiple_offerings,2);assert.equal(stats.unique_unknown_instructor,1);
  assert.equal(stats.source_literal_unknown_instructor,0);assert.equal(stats.source_missing_or_blank_instructor,3);
  assert.equal(stats.source_effective_unknown_instructor,2);
});
test('audit checks complete offering objects, not just existing course keys',t=>{
  const root=fixture(t),build=runBuilder(root),catalog=path.join(root,'public/courses.json');
  fs.writeFileSync(catalog,build.serialized);
  const campaign=path.join(root,'campaign');fs.mkdirSync(campaign);
  const shard=path.join(campaign,'inputs.json');
  const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const entries=build.courses.map((course,i)=>({position:i+1,course}));
  fs.writeFileSync(shard,JSON.stringify({entries}));
  const manifest={catalog_path:catalog,catalog_sha256:sha(catalog),input_count:entries.length,
    batches:[{number:1,path:shard,sha256:sha(shard),input_count:entries.length}]};
  fs.writeFileSync(path.join(campaign,'manifest.json'),JSON.stringify(manifest));
  const result=audit(root,campaign);assert.equal(result.execution_enabled,false);
  assert.equal(result.stats.unique_courses,2);assert.equal(result.stats.terminal_results_reusable,0);
  entries[0].course.offerings.pop();fs.writeFileSync(shard,JSON.stringify({entries}));
  manifest.batches[0].sha256=sha(shard);fs.writeFileSync(path.join(campaign,'manifest.json'),JSON.stringify(manifest));
  assert.throws(()=>audit(root,campaign),/AssertionError/);
});
