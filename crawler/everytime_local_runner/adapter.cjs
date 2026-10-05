'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const observations = new WeakMap();

function blocked(code) {
  const error = new Error('BLOCKED: ' + code);
  error.code = code;
  return error;
}

// Load the existing, unmodified parsing/batching and bounded collection functions.
// Only this local adapter translates the Computer Use boundary to Playwright.
function loadCollectors() {
  const load = name => vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../everytime_collect', name), 'utf8'));
  return {create: load('browser_collect.js'), collect: load('browser_collect_to_end.js')};
}

async function securityState(page) {
  const state = await page.evaluate(() => {
    const visible = node => !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const login = Array.from(document.querySelectorAll('input[type=password]')).some(visible) || /\/login(?:[/?#]|$)/.test(location.pathname);
    const captcha = Array.from(document.querySelectorAll('iframe[src*="captcha"], [id*="captcha"], [class*="captcha"]')).some(visible);
    // Restriction checks exclude review bodies, never return account/header text.
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let node, restricted = false;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest('div.article, script, style, input, textarea') || !visible(parent)) continue;
      if (/captcha|접근이?\s*제한|너무 많은 요청|too many requests|access denied|비정상적인 접근|잠시 후 다시/.test(node.textContent.toLowerCase())) restricted = true;
    }
    const signedIn = Array.from(document.querySelectorAll('a, button')).some(n => visible(n) && n.innerText.trim() === '로그아웃');
    return {login, restricted: captcha || restricted, captcha_visible: captcha,
      restriction_text_visible: restricted, signedIn,
      overview: Array.from(document.querySelectorAll('section.info > div.item')).some(visible)};
  });
  observations.set(page, state);
  return state;
}

async function guard(page) {
  const state = await securityState(page);
  if (state.restricted) throw blocked(state.captcha_visible ? 'captcha_visible' : 'restriction_text_visible');
  if (state.login) throw blocked('login_required_or_expired');
  return state;
}

function createAdapter(page, {check = guard, wheelSettleMs = 750} = {}) {
  if (!Number.isInteger(wheelSettleMs) || wheelSettleMs < 150 || wheelSettleMs > 750)
    throw new Error('Invalid local wheel settling interval');
  function locator(value) {
    return {
      first: () => locator(value.first()), nth: n => locator(value.nth(n)),
      async waitFor({timeoutMs, ...options}) {
        await check(page);
        try { await value.waitFor({...options, timeout: timeoutMs}); }
        catch (error) { await check(page); throw error; }
        await check(page);
      },
      count: () => value.count(), getAttribute: name => value.getAttribute(name),
      async click() { await check(page); await value.click(); await page.waitForLoadState('domcontentloaded'); await check(page); }
    };
  }
  return {
    async url() { await check(page); return page.url(); },
    async title() { await check(page); return page.title(); },
    playwright: {
      locator: selector => locator(page.locator(selector)),
      getByRole: (role, options) => locator(page.getByRole(role, options)),
      async evaluate(fn) { await check(page); const result = await page.evaluate(fn); await check(page); return result; }
    },
    async getAXState() { await check(page); return ''; },
    async scroll(point, direction, pages) {
      if (direction !== 'down' || pages !== 3) throw new Error('Unsupported scroll');
      await check(page);
      const height = await page.locator('div.article_tab > div.articles').evaluate(n => n.clientHeight);
      await page.mouse.move(point[0], point[1]);
      await page.mouse.wheel(0, height * pages);
      // Wheel returns before scrolling finishes. Allow render/load before observing.
      await page.waitForTimeout(wheelSettleMs);
      await check(page);
    }
  };
}

module.exports = {loadCollectors, securityState, guard, createAdapter, blocked,
  lastSecurityState: page => observations.get(page) || null};
