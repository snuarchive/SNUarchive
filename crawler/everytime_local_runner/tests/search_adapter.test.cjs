const assert=require('node:assert/strict'),test=require('node:test');
const {createSearchPilot,searchAdapter}=require('../search_adapter.cjs');
test('reuse original bounded search factory unchanged',()=>{
  const pilot=createSearchPilot();assert.equal(pilot.limits.scrolls,12);assert.equal(pilot.limits.candidates,160);
});
test('search controls use normal fill, Enter and mouse wheel',async()=>{
  const calls=[];
  const node={fill:async q=>calls.push(['fill',q]),press:async k=>calls.push(['press',k])};
  const page={getByRole:()=>node,waitForLoadState:async()=>{},evaluate:async()=>900,
    mouse:{move:async(...p)=>calls.push(['move',...p]),wheel:async(...p)=>calls.push(['wheel',...p])},waitForTimeout:async()=>{}};
  const tab=searchAdapter(page,async()=>{});
  await tab.playwright.getByRole('searchbox').fill('합성');await tab.playwright.getByRole('searchbox').press('Enter');
  await tab.scroll([200,400],'down',3);
  assert.deepEqual(calls,[['fill','합성'],['press','Enter'],['move',200,400],['wheel',0,2700]]);
});
