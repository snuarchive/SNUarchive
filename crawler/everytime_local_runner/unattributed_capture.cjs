'use strict';
// Separate evidence archive for observed pages with NO professor field.
// This is deliberately not a legacy raw-schema document or catalog match.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {writeNew}=require('./runner.cjs');
const {openSession,delay}=require('./browser_session.cjs');
const {overviewDiagnostic}=require('./overview_diagnostic.cjs');
const {storagePreflight}=require('./storage_preflight.cjs');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function validate(state,total){
  if(JSON.stringify(state.buttons)!==JSON.stringify(['전체','등록순']))throw Error('scope_changed');
  if(!Number.isInteger(total)||total<1||total>20||state.rows.length!==total)throw Error('count_mismatch');
  if(state.rows.some(r=>r.reason||typeof r.text!=='string'||!r.text.trim()))throw Error('invalid_row');
  if(!state.at_bottom)throw Error('not_at_end');
}
async function snapshot(page){
  return page.evaluate(()=>{
    const visible=n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
    const lists=document.querySelectorAll('div.article_tab > div.articles');
    if(lists.length!==1||!visible(lists[0]))throw Error('list_missing');
    const list=lists[0];
    return {buttons:Array.from(document.querySelectorAll('div.article_tab > div.header button')).filter(visible).map(n=>n.innerText),
      at_bottom:list.scrollHeight-list.clientHeight-list.scrollTop<=2,
      rows:Array.from(list.querySelectorAll(':scope > div.article')).map((card,i)=>{
        const bodies=card.querySelectorAll(':scope > div.text'),terms=card.querySelectorAll(':scope > div.article_header > div.title > div.info > span.semester');
        const reason=bodies.length!==1||!visible(bodies[0])||!bodies[0].innerText.trim()?'body_invalid':
          terms.length>1||(terms.length&&(!visible(terms[0])||!/^\d{2}년 .+ 수강자$/.test(terms[0].innerText)))?'term_invalid':null;
        return {position:i+1,child:Array.from(list.children).indexOf(card)+1,text:bodies.length===1?bodies[0].innerText:null,term:terms.length===1?terms[0].innerText:null,reason};
      })};
  });
}
function documentFor(target,state,overview){
  validate(state,target.displayed_total);
  return {format:'everytime_unattributed_evidence_v1',status:'complete_for_observed_ui',legacy_raw_compatible:false,
    catalog_mapping_approved:false,course_title:target.title,instructor:null,source_url:target.url+'?tab=article',
    observed_at:new Date().toISOString(),displayed_total:target.displayed_total,scope:{filter:'전체',sort:'등록순'},overview,
    reviews:state.rows.map(r=>({review_id:null,written_at:null,updated_at:null,text_raw:r.text,enrollment_term_raw:r.term,
      course_title:target.title,instructor:null,source_url:target.url+'?tab=article',
      evidence:{position:r.position,body_locator:`div.article_tab > div.articles > div.article:nth-child(${r.child}) > div.text`,
        term_locator:r.term===null?null:`div.article_tab > div.articles > div.article:nth-child(${r.child}) > div.article_header > div.title > div.info > span.semester`}}))};
}
async function main(auditPath){
  const output=require('./output_root.cjs').outputRoot(path.resolve(__dirname,'../..'));storagePreflight(output);
  const audit=JSON.parse(fs.readFileSync(auditPath,'utf8'));
  if(audit.positive.length!==4||audit.positive.reduce((n,x)=>n+x.displayed_total,0)!==9)throw Error('unexpected_scope');
  for(const t of audit.positive)if(sha(t.evidence_file)!==t.evidence_sha256||!/^https:\/\/everytime\.kr\/lecture\/view\/[1-9]\d*$/.test(t.url))throw Error('invalid_source');
  const root=fs.mkdtempSync(path.join(output,'unattributed_reviews_'));
  writeNew(path.join(root,'plan.json'),{audit:auditPath,audit_sha256:sha(auditPath),targets:audit.positive});
  const records=[];let s,error;
  try{
    s=await openSession(root);
    for(const t of audit.positive){
      storagePreflight(output);s.phase('capture_'+t.url.split('/').at(-1));await s.check();
      await s.page.goto(t.url,{waitUntil:'domcontentloaded'});
      await s.page.locator('div.rating > div.title > span.count').waitFor({state:'visible',timeout:10000});await s.check();
      const d=await overviewDiagnostic(s.page),items=d.items.filter(x=>['과목명','교수명'].includes(x.label));
      const titles=items.filter(x=>x.label==='과목명').flatMap(x=>x.values.filter(v=>v.visible).map(v=>v.text));
      const counts=d.counts.flatMap(x=>x.nodes.filter(v=>v.visible));
      if(s.page.url()!==t.url||JSON.stringify(titles)!==JSON.stringify([t.title])||items.some(x=>x.label==='교수명')||counts.length!==1||counts[0].text!==`(${t.displayed_total}개)`)throw Error('identity_or_count_changed');
      const link=s.page.getByRole('link',{name:'강의평',exact:true});
      if(await link.count()!==1||await link.getAttribute('href')!==t.url.replace('https://everytime.kr','')+'?tab=article')throw Error('link_changed');
      await link.click();await s.page.locator('div.article_tab > div.articles > div.article').first().waitFor({state:'visible'});await s.check();
      if(s.page.url()!==t.url+'?tab=article'||await s.page.title()!==t.title+' 강의실 - 에브리타임')throw Error('article_changed');
      const before=await snapshot(s.page);const box=await s.page.locator('div.article_tab > div.articles').boundingBox();
      if(!box)throw Error('list_hidden');await s.page.mouse.move(box.x+box.width/2,box.y+box.height*.75);await s.page.mouse.wheel(0,box.height*3);await delay(1500);await s.check();
      const after=await snapshot(s.page);validate(after,t.displayed_total);
      if(JSON.stringify(before.rows)!==JSON.stringify(after.rows))throw Error('unstable_rows');
      const doc=documentFor(t,after,{items,counts:d.counts,source_evidence:t.evidence_file,source_sha256:t.evidence_sha256});
      const file=path.join(root,t.url.split('/').at(-1)+'.json');const hash=writeNew(file,doc);
      records.push({file,sha256:hash,reviews:doc.reviews.length});console.log(JSON.stringify({event:'unattributed_saved',reviews:doc.reviews.length,file}));
      await delay(1500);
    }
  }catch(e){error=s?s.failure(e):e;console.log(JSON.stringify({event:'capture_stopped',kind:error.kind||'failed',code:error.code||'ui_validation_failed'}));}
  finally{if(s)await s.close(error);writeNew(path.join(root,'manifest.json'),{status:error?'partial':'complete_for_observed_ui',records,legacy_raw_compatible:false,catalog_mapping_approved:false});console.log(JSON.stringify({event:'capture_finished',root,status:error?'partial':'complete_for_observed_ui',reviews:records.reduce((n,r)=>n+r.reviews,0)}));}
}
module.exports={validate,documentFor};
if(require.main===module)main(process.argv[2]).catch(()=>{console.error('Unattributed capture preflight failed');process.exitCode=1;});
