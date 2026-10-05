// Synthetic Playwright engine test, no website navigation or network requests.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {DialogController}=require('../dialogs.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.route('**/*',route=>route.abort());
    await page.setContent('<title>Synthetic dialog test</title>');
    const controller=new DialogController();
    page.on('dialog',dialog=>controller.handle(dialog));
    const alertAction=page.evaluate(()=>alert('합성 로그인 정보를 입력하세요.'));
    while(!controller.pending)await delay(10);
    const pending=controller.pending;
    let observed=false;
    const probe=page.evaluate(()=>document.readyState).then(()=>{observed=true;controller.userResolved(pending);});
    await delay(150);
    assert.equal(observed,false,'A pending native alert must suspend the page probe');
    assert.ok(controller.pending);
    await pending.dialog.accept(); // Simulate native user acknowledgment outside controller.
    await alertAction;await probe;
    assert.equal(controller.pending,null);
    assert.equal(observed,true);
    console.log(JSON.stringify({synthetic:true,site_requests:0,native_dialog_suspend_and_resume:'passed'}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
