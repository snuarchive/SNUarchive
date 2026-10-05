'use strict';
// Reopen only the authorized lecture. No collection, queue or extractor execution.
const fs = require('node:fs'), path = require('node:path'), readline = require('node:readline');
const {spawnSync} = require('node:child_process');
const {chromium} = require('playwright');
const {loadCollectors, createAdapter} = require('./adapter.cjs');
const {inspect} = require('./chrome_diagnostics.cjs');
const {DialogController} = require('./dialogs.cjs');
const {writeNew} = require('./runner.cjs');
const {errorLabel} = require('./overview_diagnostic.cjs');
const repo = path.resolve(__dirname, '../..');
const profile = path.join(repo, 'crawler/data/private/everytime_local_profile');
const target = {url:'https://everytime.kr/lecture/view/603889?tab=article', title:'프로그래밍방법론', instructor:'정교민'};
const emit = value => console.log(JSON.stringify(value));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const git = spawnSync('git', ['-c','safe.directory='+repo.replaceAll('\\','/'),'check-ignore','--quiet',
    'crawler/data/private/everytime_local_profile/probe'], {cwd:repo, windowsHide:true});
  if (git.status !== 0 || fs.realpathSync(profile) !== profile || fs.existsSync(profile+'.access_stop.json'))
    throw new Error('Profile validation or access stop');
  const run = fs.mkdtempSync(path.join(repo, 'crawler/output/everytime_local_runner/reopen_603889_'));
  const lock = profile+'.runner.lock';
  writeNew(lock, {pid:process.pid, run});
  let context, page, closed = false, stop = false;
  const input = readline.createInterface({input:process.stdin});
  input.on('line', line => { if (line.trim() === 'stop') {stop=true; context?.close().catch(()=>{});} });
  const controller = new DialogController({onPending: evidence => {
    writeNew(path.join(run, `dialog_${controller.records.length}.json`), evidence);
    emit({event:'dialog_pending', ...evidence});
    if (controller.terminal) {
      if (!fs.existsSync(profile+'.access_stop.json')) writeNew(profile+'.access_stop.json', {run,reason:evidence.code});
      context?.close().catch(()=>{});
    }
  }});
  async function check({allowLogin=false}={}) {
    while (controller.pending && !closed && !stop) {
      if (controller.terminal) throw new Error('blocked');
      const pending=controller.pending;
      if (!pending.probe) pending.probe=page.evaluate(()=>document.readyState)
        .then(()=>controller.userResolved(pending)).catch(()=>{});
      await delay(250);
    }
    if (controller.terminal) throw new Error('blocked');
    if (closed || stop) throw new Error('closed');
    const state = await inspect(page);
    if (['blocked','challenge'].includes(state.category)) {
      writeNew(path.join(run,'access_stop.json'), state);
      if (!fs.existsSync(profile+'.access_stop.json')) writeNew(profile+'.access_stop.json', {run,reason:state.category});
      await context.close(); throw new Error('blocked');
    }
    if (!allowLogin && state.category==='login') throw new Error('login_failed');
    return state;
  }
  try {
    context = await chromium.launchPersistentContext(profile, {channel:'chrome',headless:false,viewport:{width:1280,height:900}});
    context.on('close',()=>{closed=true;});
    page = context.pages()[0] || await context.newPage();
    page.on('dialog', dialog=>controller.handle(dialog));
    await page.bringToFront();
    writeNew(path.join(run,'browser.json'), {channel:'chrome',version:context.browser().version(),persistent:true,target});
    emit({event:'browser_reopened',run,version:context.browser().version(),persistent:true});
    const base=target.url.split('?')[0];
    await page.goto(base,{waitUntil:'domcontentloaded'});
    let notified=false, returned=false, state;
    const deadline=Date.now()+30*60*1000;
    while(Date.now()<deadline) {
      state=await check({allowLogin:true});
      if (state.category==='lecture' && page.url()===base) break;
      if (!notified) {emit({event:'manual_login_required',url:state.url});notified=true;}
      if (state.signed_in_control && !returned) {returned=true;await page.goto(base,{waitUntil:'domcontentloaded'});}
      await delay(750);
    }
    if (state?.category!=='lecture') throw new Error('login_failed');
    await page.locator('div.rating > div.title > span.count, section.empty.review > div.title > span.count')
      .first().waitFor({state:'visible',timeout:10000});
    const collector=loadCollectors().create(target);
    const prepared=await collector.prepare(createAdapter(page,{check:()=>check()}));
    const result={outcome:'normal_access',identity_verified:true,displayed_count:prepared.displayed_total.value,
      url:page.url(),title:target.title,instructor:target.instructor,collection_performed:false,window_left_open:true};
    writeNew(path.join(run,'result.json'),result);emit({event:'lecture_ready',...result});
  } catch(error) {
    const reason=controller.terminal?'blocked':['blocked','closed','login_failed'].includes(error.message)?error.message:'unexpected_ui';
    const result={outcome:reason,detail:errorLabel(error.message),collection_performed:false,window_left_open:!closed};
    writeNew(path.join(run,'result.json'),result);emit({event:'reopen_status',...result});
  } finally {
    // Successful reopening stays visible until the user closes the experimental window.
    while(context && !closed && !stop) await delay(500);
    input.close();
    if (context && !closed) await context.close().catch(()=>{});
    fs.unlinkSync(lock);
  }
}
if(require.main===module) main().catch(()=>{emit({event:'setup_failed',reason:'profile_lock_or_configuration'});process.exitCode=2;});
