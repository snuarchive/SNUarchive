'use strict';
// Local professor-mode counterpart of everytime_match/browser_pilot.js search only.
// Original Computer Use source is unchanged; all limits and evidence checks retained.
function createProfessorSearchPilot({extended=false, mode='professor', largeNameSearch=false}={}) {
  if(typeof extended!=='boolean')throw new Error('Invalid extended search option');
  if(!['name','professor'].includes(mode))throw new Error('Invalid search mode');
  if(typeof largeNameSearch!=='boolean'||(largeNameSearch&&(!extended||mode!=='name')))throw new Error('Invalid large name search');
  const limits = Object.freeze({courses: 30, scrolls: largeNameSearch?350:extended?60:12, candidates: largeNameSearch?6000:extended?800:160,
    waitMs: 2000, readyMs: 5000, searchMs: largeNameSearch?600000:extended?180000:60000});
  const cards = 'div.lectures > a.lecture';
  const empty = 'div.lectures > div.alert > p.noresult';
  const denied = /CAPTCHA|접근.{0,10}(제한|차단)|비정상.{0,10}접근|Too Many Requests|Access Denied|보안 정책/i;
  function require(value, message) { if (!value) throw Error(message); }
  function courseUrl(value) {
    const u = new URL(value);
    require(u.protocol === 'https:' && u.host === 'everytime.kr' &&
      /^\/lecture\/view\/\d+$/.test(u.pathname) && !u.search && !u.hash,
      'Invalid observed overview URL');
    return value;
  }
  async function guard(tab, searchOnly = false) {
    const ax = await tab.getAXState({emit: false});
    const u = new URL(await tab.url());
    require(!denied.test(ax), 'Access restriction; stop without retry');
    require(u.protocol === 'https:' && u.host === 'everytime.kr' &&
      (u.pathname === '/lecture/search' || (!searchOnly && u.pathname === '/lecture')),
      'Login or unexpected search page; stop');
  }
  async function readSearch(tab) {
    return tab.playwright.evaluate(() => {
      const element = document.querySelector('div.lectures > div.alert > p.noresult');
      const visible = !!element && element.getClientRects().length > 0;
      return {page_url: location.href,
        query: document.querySelector('form.searchbar input[type=search]')?.value,
        mode: document.querySelector('div.categories input:checked')?.value,
        school: document.querySelector('h1')?.innerText,
        candidates: Array.from(document.querySelectorAll('div.lectures > a.lecture')).map((x, j) => ({
          position: j + 1, url: x.href, title: x.querySelector(':scope > div.name')?.innerText,
          instructor: x.querySelector(':scope > div.professor')?.innerText ?? null})),
        empty_text: visible ? element.innerText : null,
        empty_evidence: visible ? {text: element.innerText,
          locator: 'div.lectures > div.alert > p.noresult', visible: true} : null,
        geometry: {top: document.documentElement.scrollTop,
          height: document.documentElement.scrollHeight, client: document.documentElement.clientHeight},
        point: [innerWidth / 2, innerHeight * .75]};
    });
  }
  function verifySnapshot(s, query) {
    const u = new URL(s.page_url);
    require(u.origin === 'https://everytime.kr' && u.pathname === '/lecture/search' &&
      !u.hash && [...u.searchParams].length === 2 && u.searchParams.get('keyword') === query &&
      u.searchParams.get('condition') === mode && s.query === query && s.mode === mode,
      'Search query or mode changed');
    require(s.school?.trim().split(/\s+/).join(' ') === '에브리타임 서울대', 'Wrong school');
    require(s.candidates.length < limits.candidates, 'Search candidate limit; stop');
    const urls = new Set();
    for (const [i, c] of s.candidates.entries()) {
      courseUrl(c.url);
      require(c.position === i + 1 && typeof c.title === 'string' && c.title.length &&
        (c.instructor === null || typeof c.instructor === 'string'), 'Search card UI changed');
      require(!urls.has(c.url), 'Repeated search candidate URL');
      urls.add(c.url);
    }
    const g = s.geometry;
    require(['top','height','client'].every(k => Number.isFinite(g[k]) && g[k] >= 0) &&
      g.client > 0, 'Missing search geometry');
    if (s.candidates.length) require(!s.empty_text, 'Contradictory empty search');
    else require(s.empty_text === '검색된 강의가 없습니다' && s.empty_evidence?.visible === true &&
      s.empty_evidence.locator === empty, 'Loading failure is not not_found');
  }
  async function observeSearch(tab, query, checkpoint = () => {}) {
    const began = Date.now(), trace = [];
    let previous = null, idle = 0;
    const deadline = () => require(Date.now() - began < limits.searchMs, 'Excessive search wait; stop');
    await guard(tab);
    await tab.playwright.getByRole('searchbox').fill(query);
    await tab.playwright.getByRole('searchbox').press('Enter');
    await guard(tab, true);
    await tab.playwright.locator(cards).or(tab.playwright.locator(empty)).first()
      .waitFor({state: 'visible', timeoutMs: limits.readyMs});
    for (let scrolls = 0; scrolls <= limits.scrolls; scrolls++) {
      deadline();
      await guard(tab, true);
      const s = await readSearch(tab);
      checkpoint({snapshot: s, trace: structuredClone(trace)});
      verifySnapshot(s, query);
      require(!previous || JSON.stringify(s.candidates.slice(0, previous.length)) === JSON.stringify(previous),
        'Search prefix changed; stop');
      const bottom = s.geometry.height - s.geometry.client - s.geometry.top <= 2;
      idle = bottom && previous && s.candidates.length === previous.length ? idle + 1 : 0;
      trace.push({count: s.candidates.length, ...s.geometry, at_bottom: bottom});
      if ((!s.candidates.length && bottom) || idle >= 2) {
        deadline();
        delete s.point;
        return {...s, evidence_version: extended?3:2, observed_at: new Date().toISOString(),
          list_locator: cards, title_locator: ':scope > div.name', instructor_locator: ':scope > div.professor',
          initial_candidate_count: trace[0].count, scrolls,
          scope: {ui_end: true, bottom_confirmations: idle, trace,
            max_scrolls: limits.scrolls, max_candidates: limits.candidates, wait_ms: limits.waitMs}};
      }
      require(scrolls < limits.scrolls, 'Search scroll limit; stop');
      previous = s.candidates;
      await tab.scroll(s.point, 'down', 3);
      await guard(tab, true);
      try {
        await tab.playwright.locator(cards).nth(previous.length)
          .waitFor({state: 'attached', timeoutMs: limits.waitMs});
      } catch (e) {
        if (!/Timeout|timed out|waiting for/i.test(String(e))) throw e;
      }
    }
  }
  return {limits, observeSearch};
}
module.exports={createProfessorSearchPilot};
