'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {safeFailureDiagnostic}=require('./failure_diagnostic.cjs');
async function selectSearchMode(page,check,mode){
  if(!['name','professor'].includes(mode))throw new Error('Unsupported search mode');
  await check();
  const control=page.locator(`div.categories input[type="radio"][value="${mode}"]`);
  const count=await control.count();
  if(count===0&&mode==='name'&&new URL(page.url()).pathname==='/lecture')return;
  if(count!==1)throw new Error('Search mode control missing or ambiguous');
  if(await control.isChecked())return;
  const label=page.locator('div.categories').getByText(mode==='name'?'과목명':'교수명',{exact:true});
  if(await label.count()!==1)throw new Error('Search mode label missing or ambiguous');
  await label.click();
  await page.waitForLoadState('domcontentloaded');await check();
  if(!await control.isChecked())throw new Error('Search mode control not selected');
}
async function observeBoundedSearch(pilot,adapter,query){
  let checkpoint=null;
  try{return {observation:await pilot.observeSearch(adapter,query,value=>{checkpoint=value;})};}
  catch(error){
    const category=safeFailureDiagnostic(error).category;
    if(!['search_candidate_limit','search_scroll_limit'].includes(category)||!checkpoint)throw error;
    // Incomplete evidence is never matched, cached, or interpreted as not_found.
    return {limited:{reason:category,checkpoint,scope:{ui_end:false}}};
  }
}
function createSearchPilot(){
  const source=fs.readFileSync(path.join(__dirname,'../everytime_match/browser_pilot.js'),'utf8');
  return vm.runInNewContext(source+'\ncreateEverytimePilot()', {URL,structuredClone});
}
function searchAdapter(page,check,{wheelSettleMs=750}={}){
  if(!Number.isInteger(wheelSettleMs)||wheelSettleMs<150||wheelSettleMs>750)
    throw new Error('Invalid local wheel settling interval');
  function wrap(value){return {
    first:()=>wrap(value.first()),nth:index=>wrap(value.nth(index)),
    or:other=>wrap(value.or(other.native)),native:value,
    async waitFor({timeoutMs,...options}){await check();try{await value.waitFor({...options,timeout:timeoutMs});}catch(error){await check();throw error;}await check();},
    async fill(text){await check();await value.fill(text);},
    async press(key){await check();await value.press(key);await page.waitForLoadState('domcontentloaded');await check();}
  };}
  return {
    async url(){await check();return page.url();},
    async getAXState(){await check();return '';},
    playwright:{getByRole:(role,options)=>wrap(page.getByRole(role,options)),locator:selector=>wrap(page.locator(selector)),
      async evaluate(fn){await check();const result=await page.evaluate(fn);await check();return result;}},
    async scroll(point,direction,pages){
      if(direction!=='down'||pages!==3)throw new Error('Unknown search scroll');
      await check();await page.mouse.move(...point);await page.mouse.wheel(0,(await page.evaluate(()=>innerHeight))*pages);
      await page.waitForTimeout(wheelSettleMs);await check();
    }
  };
}
module.exports={createSearchPilot,searchAdapter,observeBoundedSearch,selectSearchMode};
