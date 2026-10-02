// Executes the actual DOM callback against a small DOM double (no network).
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {create,collect,target,fake,state,plain}=require('./fake_browser.cjs');
const node=(text,visible=true)=>({innerText:text,getClientRects:()=>visible?[{}]:[]});
function documentFor({shape='text',text=target.instructor,visible=true,dual=false,multiple=false,hiddenLabel=false,missing=false}={}){
  const title=node(target.title),value=node(text,visible),label=node('교수명',!hiddenLabel);
  const titleItem={querySelector:()=>node('과목명'),querySelectorAll:()=>[title]};
  const instructorItem={querySelector:()=>label,querySelectorAll:selector=>{
    const requested=selector===':scope > span.text'?'text':'link';
    if(missing||(!dual&&requested!==shape))return [];
    return multiple?[value,node('다른교수')]:[value];
  }};
  return {querySelector:()=>null,querySelectorAll:selector=>selector==='section.info > div.item'?
    [titleItem,instructorItem]:[node('(0개)')]};
}
async function execute(options={}){
  const f=fake({frames:[state(0)]}),original=f.tab.playwright.evaluate;
  f.tab.playwright.evaluate=async fn=>String(fn).includes('const items')?
    plain(vm.runInNewContext('('+fn.toString()+')()', {document:documentFor(options)})):original(fn);
  const events=[];for await(const event of collect(f.tab,create(target)))events.push(event);
  return {report:events.at(-1).report,calls:f.calls};
}
test('both observed professor DOM shapes preserve exact label and specific evidence',async()=>{
  for(const shape of ['text','link']){
    const {report}=await execute({shape});
    assert.equal(report.status,'complete');assert.equal(report.termination_reason,'explicit_empty_list');
    assert.equal(report.succeeded,0);assert.equal(report.identity_evidence.instructor.text,target.instructor);
    assert.ok(report.identity_evidence.instructor.locator.endsWith(shape==='text'?':scope > span.text':':scope > div.multiline > a.link'));
  }
});
test('missing hidden blank duplicate and mixed professor structures remain partial',async()=>{
  for(const options of [{missing:true},{visible:false},{text:'  '},{multiple:true},{dual:true},{hiddenLabel:true}]){
    const {report,calls}=await execute(options);
    assert.equal(report.status,'partial');assert.equal(report.initial_loaded,null);assert.equal(calls.clicks,0);
  }
});
test('plain-text professor mismatch and whitespace difference stop before article navigation',async()=>{
  for(const text of ['다른교수',target.instructor+' ']){
    const {report,calls}=await execute({text});assert.match(report.stop_error,/identity differs/);
    assert.equal(report.status,'partial');assert.equal(calls.clicks,0);
  }
});
