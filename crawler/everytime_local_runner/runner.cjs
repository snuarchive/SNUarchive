'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {parseArgs} = require('node:util');
const {loadCollectors, securityState, guard, createAdapter, blocked, lastSecurityState} = require('./adapter.cjs');

const repo = path.resolve(__dirname, '../..');
const outputRoot = require('./output_root.cjs').outputRoot(repo);
function writeNew(file, value) {
  const data = Buffer.from(JSON.stringify(value), 'utf8');
  const fd = fs.openSync(file, 'wx');
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return crypto.createHash('sha256').update(data).digest('hex');
}
function bridge(python, command, run, extra = []) {
  const result = spawnSync(python, ['-X', 'utf8', '-B', '-m', 'crawler.everytime_local_runner', command, '--run', run, ...extra],
    {cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024});
  // Do not forward exception logs/source strings to tool output.
  if (result.status !== 0) throw new Error('Local validation/storage bridge failed');
  return JSON.parse(result.stdout);
}
async function initialLogin(page, base, timeoutSeconds, onWaiting) {
  await page.goto(base, {waitUntil: 'domcontentloaded', timeout: 30000});
  const deadline = Date.now() + timeoutSeconds * 1000;
  let announced = false;
  while (true) {
    const state = await securityState(page);
    if (state.restricted) throw blocked(state.captcha_visible ? 'captcha_visible' : 'restriction_text_visible');
    if (!state.login && state.overview && page.url() === base) return;
    if (!state.login && state.signedIn) {
      // One authorized same-course navigation after the user's manual initial login.
      await page.goto(base, {waitUntil: 'domcontentloaded', timeout: 30000});
      await guard(page);
      return;
    }
    if (Date.now() >= deadline) throw blocked('initial_login_timeout');
    if (!announced) { announced = true; onWaiting(); }
    await page.waitForTimeout(1000);
  }
}

async function consume({page, collector, run, python, collect}) {
  const tab = createAdapter(page);
  for await (const event of collect(tab, collector, {maxScrolls: 12, maxBatches: 20, idleWaitMs: 1500})) {
    if (event.type === 'batch' || event.type === 'failed_batch') {
      // Review text never crosses stdout, the LLM, a tool result, or command arguments.
      writeNew(path.join(run, 'incoming', `event_${String(event.batch).padStart(3, '0')}.json`), event);
      const saved = bridge(python, 'batch', run, ['--number', String(event.batch)]);
      process.stdout.write(JSON.stringify({event: 'batch_saved', ...saved}) + '\n');
    } else if (event.type === 'progress') {
      writeNew(path.join(run, 'incoming', `progress_${String(event.state.scroll).padStart(3, '0')}.json`), event.state);
      process.stdout.write(JSON.stringify({event: 'progress', count: event.state.count, bottom: event.state.at_bottom}) + '\n');
    } else if (event.type === 'complete') {
      // Retain only known error categories; Playwright error call logs may include DOM snippets.
      if (event.report.stop_error) {
        const error = event.report.stop_error;
        event.report.stop_error = /BLOCKED:|login|restriction|captcha/i.test(error) ? 'BLOCKED: login or access restriction' :
          /identity|course label|course value|title differs|wrong course|filter or sort|cards changed/i.test(error) ? 'Visible identity or scope changed' :
          /timeout|timed out/i.test(error) ? 'UI timeout; stopped without retry' : 'UI collection interrupted; stopped without retry';
      }
      writeNew(path.join(run, 'incoming/ui_report.json'), event.report);
      writeNew(path.join(run, 'security_observation.json'), lastSecurityState(page));
      return bridge(python, 'finalize', run);
    }
  }
  throw new Error('Missing terminal collection event');
}

async function main() {
  const {values: args} = parseArgs({options: {
    url: {type: 'string'}, title: {type: 'string'}, instructor: {type: 'string'},
    python: {type: 'string', default: 'python'}, 'run-name': {type: 'string'},
    'login-timeout-seconds': {type: 'string', default: '600'}, help: {type: 'boolean'}
  }});
  if (args.help) {
    console.log('node runner.cjs --url <observed lecture URL> --title <exact title> --instructor <exact instructor> [--python <python.exe>] [--run-name <new name>] [--login-timeout-seconds 600]');
    return;
  }
  const {create, collect} = loadCollectors();
  const collector = create({url: args.url, title: args.title, instructor: args.instructor});
  const loginSeconds = Number(args['login-timeout-seconds']);
  if (!Number.isInteger(loginSeconds) || loginSeconds < 0 || loginSeconds > 1800) throw new Error('Invalid login timeout');
  const name = args['run-name'] || new Date().toISOString().replace(/[:.]/g, '-') + '_' + crypto.randomBytes(4).toString('hex');
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid run name');
  const run = path.join(outputRoot, name);
  fs.mkdirSync(outputRoot, {recursive: true});
  fs.mkdirSync(run); // exclusive reservation: no existing output can be reused
  fs.mkdirSync(path.join(run, 'incoming'));
  writeNew(path.join(run, 'invocation.json'), {target: collector.target, started_at: new Date().toISOString(),
    headed: true, browser: 'playwright_chromium', login: 'manual_initial_login_ephemeral_context',
    adapter_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../everytime_collect/browser_collect.js'))).digest('hex')});
  let browser, page;
  try {
    const {chromium} = require('playwright');
    browser = await chromium.launch({headless: false});
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    page = await context.newPage();
    // Dialog text is never printed or archived. Unexpected dialogs stop this run.
    let dialogBlocked = false;
    page.on('dialog', async dialog => { dialogBlocked = true; await dialog.dismiss(); });
    writeNew(path.join(run, 'browser.json'), {version: browser.version(), executable: chromium.executablePath(),
      playwright: require('playwright/package.json').version});
    console.log(JSON.stringify({event: 'browser_open', run, browser: browser.version()}));
    await initialLogin(page, collector.base, loginSeconds, () => {
      console.log(JSON.stringify({event: 'manual_login_required', timeout_seconds: loginSeconds, run}));
    });
    if (dialogBlocked) throw blocked('unexpected_website_dialog');
    const originalGuard = page.evaluate.bind(page);
    // Include dialog stop in every subsequent DOM operation, including guard calls.
    page.evaluate = async (...values) => {
      if (dialogBlocked) throw blocked('unexpected_website_dialog');
      return originalGuard(...values);
    };
    const result = await consume({page, collector, run, python: args.python, collect});
    console.log(JSON.stringify({event: 'finished', run, ...result}));
    if (!['complete_for_observed_ui', 'empty'].includes(result.status)) process.exitCode = 2;
  } catch (error) {
    const status = /BLOCKED:/.test(String(error)) ? 'blocked' : 'failed';
    writeNew(path.join(run, 'interruption.json'), {status,
      reason_code: /^[a-z_]+$/.test(error.code || '') ? error.code : 'local_runtime_error',
      security_observation: page ? lastSecurityState(page) : null,
      reason: status === 'blocked' ? 'Login/access/challenge/dialog stop; no retry' : 'Local browser, validation or storage failure; inspect checkpoints',
      finished_at: new Date().toISOString()});
    try { bridge(args.python, 'abort', run, ['--status', status]); } catch { /* A disk failure must not trigger more browser actions. */ }
    console.log(JSON.stringify({event: 'stopped', run, status}));
    process.exitCode = 2;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = {writeNew, bridge, initialLogin, consume};
if (require.main === module) main().catch(() => { console.error('Runner setup failed; no collection started. Check arguments/output/dependencies.'); process.exitCode = 2; });
