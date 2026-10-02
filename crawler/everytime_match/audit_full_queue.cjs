// Offline audit. Runs the actual builder with file writes captured in memory.
// Never opens a browser, starts a campaign, changes raw, or writes public/courses.json.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = p => sha(fs.readFileSync(p));
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const canonical = v => JSON.stringify(sortObject(v));
function sortObject(v) {
  if (Array.isArray(v)) return v.map(sortObject);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortObject(v[k])]));
  return v;
}
function counter(values) {
  const result = {};
  for (const v of values) result[v] = (result[v] || 0) + 1;
  return result;
}
function runBuilder(repo) {
  repo = path.resolve(repo);
  const script = path.join(repo, 'scripts/build-courses.js');
  const output = path.join(repo, 'public/courses.json');
  let captured, writes = 0;
  const inputFiles = new Map();
  const fakeFs = {
    readdirSync(p) { assert.equal(path.resolve(p), repo); return fs.readdirSync(p); },
    readFileSync(p, encoding) {
      p = path.resolve(p);
      assert.equal(path.dirname(p), repo);
      assert.match(path.basename(p), /^20\d{2}-[1-4]\.json$/);
      const bytes = fs.readFileSync(p);
      inputFiles.set(path.basename(p), {path:p, sha256:sha(bytes), records:JSON.parse(bytes.toString('utf8'))});
      return encoding ? bytes.toString(encoding) : bytes;
    },
    mkdirSync(p) { assert.equal(path.resolve(p), path.dirname(output)); },
    writeFileSync(p, data) { assert.equal(path.resolve(p), output); captured = String(data); writes++; }
  };
  const context = vm.createContext({__dirname:path.dirname(script), console:{log(){}},
    require(name) { return ({fs:fakeFs,path,crypto})[name] || (()=>{throw Error('Unexpected builder dependency: '+name);})(); }});
  vm.runInContext(fs.readFileSync(script,'utf8'),context,{filename:script,timeout:120000});
  assert.equal(writes,1);
  const functions = vm.runInContext('({clean,courseKey})',context);
  return {courses:JSON.parse(captured),serialized:captured,inputFiles,functions,script,script_sha256:fileSha(script)};
}
function inspectSources(build) {
  const rawPairs = new Set(), validPairs = new Set(), normalized = new Set();
  const tuplesByKey = new Map(), groups = new Map(), perFile = [];
  let invalid=0, literalUnknown=0, effectiveUnknown=0, missingOrBlank=0;
  for (const [file,source] of build.inputFiles) {
    let valid=0;
    for (const [index,r] of source.records.entries()) {
      // Missing fields remain distinguishable from null and from empty strings.
      const pair=JSON.stringify(['course_title','instructor'].map(k=>Object.hasOwn(r,k)?[true,r[k]]:[false]));
      rawPairs.add(pair);
      if(r.instructor==='미정') literalUnknown++;
      if(!build.functions.clean(r.instructor)) missingOrBlank++;
      const c={title:build.functions.clean(r.course_title),instructor:build.functions.clean(r.instructor)||'미정',
        department:build.functions.clean(r.department)||'미분류',year:Number(r.year),semester:Number(r.semester)};
      if(!c.title||!c.year||!c.semester){invalid++;continue;}
      valid++;validPairs.add(pair);
      if(c.instructor==='미정') effectiveUnknown++;
      const key=build.functions.courseKey(c);normalized.add(key);
      const tuple=JSON.stringify([c.title,c.instructor].map(v=>String(v??'').replace(/\s+/g,'').trim().toLowerCase()));
      if(!tuplesByKey.has(key))tuplesByKey.set(key,new Set());tuplesByKey.get(key).add(tuple);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push({file,row:index+1,raw_title:r.course_title??null,raw_instructor:r.instructor??null,
        offering:{year:c.year,semester:c.semester,department:c.department}});
    }
    perFile.push({file,source_rows:source.records.length,valid_rows:valid,sha256:source.sha256});
  }
  assert.equal(normalized.size,build.courses.length);
  const collisions=[...tuplesByKey].filter(([,v])=>v.size>1).map(([course_key,v])=>({course_key,normalized_tuples:[...v]}));
  assert.equal(collisions.length,0,'Different normalized tuples share one builder key');
  for(const c of build.courses){
    const expected=new Set(groups.get(c.course_key).map(r=>canonical(r.offering)));
    assert.equal(expected.size,c.offerings.length);
    for(const o of c.offerings)assert(expected.has(canonical(o)));
  }
  return {groups,stats:{per_file:perFile,source_rows:perFile.reduce((s,r)=>s+r.source_rows,0),invalid_rows:invalid,
    exact_raw_title_instructor_pairs:rawPairs.size,exact_valid_raw_pairs:validPairs.size,normalized_course_keys:normalized.size,
    source_literal_unknown_instructor:literalUnknown,source_missing_or_blank_instructor:missingOrBlank,
    source_effective_unknown_instructor:effectiveUnknown,unique_unknown_instructor:build.courses.filter(c=>c.instructor==='미정').length,
    courses_with_multiple_offerings:build.courses.filter(c=>c.offerings.length>=2).length,
    unique_offerings:build.courses.reduce((s,c)=>s+c.offerings.length,0),normalized_tuple_key_collisions:collisions}};
}
function audit(repo, campaignPath) {
  repo=path.resolve(repo);campaignPath=path.resolve(campaignPath);
  const manifest=read(path.join(campaignPath,'manifest.json'));
  assert.equal(path.resolve(manifest.catalog_path),path.join(repo,'public/courses.json'));
  assert.equal(fileSha(manifest.catalog_path),manifest.catalog_sha256);
  const build=runBuilder(repo),sources=inspectSources(build),catalog=read(manifest.catalog_path);
  assert.equal(canonical(build.courses),canonical(catalog),'Current source rebuild differs from catalog');
  const courses=new Map(catalog.map(c=>[c.course_key,c]));
  assert.equal(courses.size,catalog.length);
  const queue=[],checkedFiles=new Map(),results=[],matches=[];
  function checked(p,expected){const actual=fileSha(p);if(expected)assert.equal(actual,expected,p);checkedFiles.set(path.resolve(p),actual);return read(p);}
  checked(path.join(campaignPath,'manifest.json'));
  for(const b of manifest.batches){
    const shard=checked(b.path,b.sha256);assert.equal(shard.entries.length,b.input_count);
    for(const entry of shard.entries){
      assert.equal(entry.position,queue.length+1);
      assert.equal(canonical(entry.course),canonical(catalog[entry.position-1]));
      assert.equal(build.functions.courseKey(entry.course),entry.course.course_key);
      const folder=path.join(campaignPath,'batches',String(b.number).padStart(4,'0'),'entries',String(entry.position).padStart(5,'0'));
      const resultPath=path.join(folder,'result.json'),matchPath=path.join(folder,'match.json');
      const result=fs.existsSync(resultPath)?checked(resultPath):null,match=fs.existsSync(matchPath)?checked(matchPath):null;
      if(match){
        assert.equal(match.course_key,entry.course.course_key);assert.equal(match.position,entry.position);
        checked(match.search_path,match.search_sha256);matches.push(match);
      }
      if(result){
        assert.equal(result.position,entry.position);assert.equal(canonical(result.input),canonical(entry.course));
        if(result.run_report){
          const report=checked(result.run_report,result.report_sha256);
          assert.equal(report.reviews_saved,result.stored_reviews);
          assert.equal(report.ui_observation.target.title,entry.course.title);
          assert.equal(report.ui_observation.target.instructor,entry.course.instructor);
          assert.equal(report.ui_observation.target.url,result.url+'?tab=article');
          assert.equal(report.ui_observation.status,result.collection_status);
        }
        for(const raw of result.raw_files)checked(raw.path,raw.sha256);
        assert.equal(result.raw_files.reduce((s,r)=>s+r.reviews,0),result.stored_reviews);
        results.push(result);
      }
      queue.push({position:entry.position,course:entry.course,
        course_key_role:'queue_dedup_and_matching_candidate_only_not_database_id',
        state:result?(result.collection_status==='complete'?'completed':result.status):(match?'matched_pending_collection':'pending_search'),
        original_batch:b.number,original_inputs_path:b.path,original_result_path:result?resultPath:null,
        original_result_sha256:result?fileSha(resultPath):null,original_match_path:match?matchPath:null,
        original_match_sha256:match?fileSha(matchPath):null,everytime_url:result?.url||match?.target?.url||null,
        completed_reuse:result?.collection_status==='complete',stored_reviews:result?.stored_reviews||0,
        raw_references:result?.raw_files||[],original_status:result?.status||null,match_status:match?.status||null});
    }
  }
  assert.equal(queue.length,manifest.input_count);assert.equal(new Set(queue.map(e=>e.course.course_key)).size,queue.length);
  const owners=matches.filter(m=>m.status==='matched').map(m=>m.target.url);
  assert.equal(new Set(owners).size,owners.length,'Duplicate matched URL');
  const completed=queue.filter(e=>e.completed_reuse).length;
  const stats={...sources.stats,queue_inputs:queue.length,unique_courses:catalog.length,
    duplicate_course_keys_in_queue:0,duplicate_matched_urls:0,queue_reduction_count:queue.length-catalog.length,
    queue_reduction_percent:(1-catalog.length/queue.length)*100,
    source_to_unique_reduction_percent:(1-catalog.length/sources.stats.source_rows)*100,
    exact_rebuild_matches_catalog:true,exact_rebuild_byte_hash:sha(build.serialized),catalog_sha256:manifest.catalog_sha256,
    offerings_preserved_for_all_queue_entries:true,completed_unique_courses:completed,
    not_completed_unique_courses:queue.length-completed,terminal_results_reusable:results.length,
    terminal_unprocessed_unique_courses:queue.length-results.length,queue_states:counter(queue.map(e=>e.state)),
    old_result_states:counter(results.map(r=>r.status)),stored_reviews_referenced:results.reduce((s,r)=>s+r.stored_reviews,0)};
  const selectedTitles=['프로그래밍방법론','특수교육학개론','21세기 한국소설의 이해'];
  const selected=catalog.filter(c=>selectedTitles.includes(c.title)&&['정교민','김주선','이지은'].includes(c.instructor));
  const variants=catalog.filter(c=>new Set(sources.groups.get(c.course_key).map(r=>JSON.stringify([r.raw_title,r.raw_instructor]))).size>1).slice(0,3);
  const examples=[...new Map([...selected,...variants].map(c=>[c.course_key,c])).values()].map(c=>({course:c,source_rows:sources.groups.get(c.course_key)}));
  return {audit_version:1,created_at:new Date().toISOString(),browser_used:false,execution_enabled:false,
    queue_rebuild_needed:false,queue_view_purpose:'read_only_audited_unique_view_no_execution',
    builder:{path:build.script,sha256:build.script_sha256,writes_intercepted:true},original_campaign:campaignPath,
    original_manifest_sha256:fileSha(path.join(campaignPath,'manifest.json')),stats,examples,queue,
    checked_files:[...checkedFiles].map(([path,sha256])=>({path,sha256}))};
}
function writeAudit(data,destination){
  destination=path.resolve(destination);
  assert(!fs.existsSync(destination),'Audit destination already exists');
  fs.mkdirSync(destination,{recursive:true});
  const write=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});};
  const shards=[];
  for(let i=0;i<data.queue.length;i+=50){const p=path.join(destination,'unique_queue_view',String(i/50+1).padStart(4,'0')+'.json');write(p,{execution_enabled:false,entries:data.queue.slice(i,i+50)});shards.push({path:p,sha256:fileSha(p)});}
  const {queue,...summary}=data;
  write(path.join(destination,'audit.json'),{...summary,unique_queue_shards:shards});
  write(path.join(destination,'result_mapping.json'),queue.filter(e=>e.original_result_path));
  write(path.join(destination,'review_queues.json'),Object.fromEntries(['ambiguous','not_found','partial','failed'].map(s=>[s,queue.filter(e=>e.state===s)])));
  return summary;
}
module.exports={runBuilder,inspectSources,audit,writeAudit};
if(require.main===module){
  const [repo,campaign,destination]=process.argv.slice(2);
  assert(repo&&campaign&&destination,'Usage: node audit_full_queue.cjs REPO CAMPAIGN NEW_AUDIT_DIRECTORY');
  const result=writeAudit(audit(repo,campaign),destination);console.log(JSON.stringify(result.stats,null,2));
}
