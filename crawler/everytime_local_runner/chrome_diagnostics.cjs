'use strict';

// Diagnostics contain only allowlisted public UI labels, booleans and sanitized URLs.
function safeUrl(raw) {
  try {
    const url = new URL(raw);
    if (!['everytime.kr', 'account.everytime.kr'].includes(url.hostname)) return '[other-origin-redacted]';
    const known = /^(?:\/|\/login\/?|\/auth\/login\/?|\/lecture\/view\/603889|\/error(?:\/\d+)?|\/blocked|\/403|\/429)$/;
    return url.origin + (known.test(url.pathname) ? url.pathname : '/[path-redacted]');
  } catch { return '[unavailable]'; }
}
function safeTitle(raw) {
  const titles = ['에브리타임', '로그인 - 에브리타임', '에브리타임 - 로그인', '프로그래밍방법론 강의실 - 에브리타임',
    'Access Denied', '403 Forbidden', 'Forbidden', 'Too Many Requests', 'Just a moment...', 'Error'];
  return titles.includes(raw) ? raw : '[unrecognized-title-redacted]';
}
function fixedSignals(text) {
  const patterns = {
    access_restricted: /접근이?\s*제한|접근할 수 없|access denied|access restricted/i,
    rate_limited: /너무 많은 요청|too many requests/i,
    abnormal_access: /비정상적인 접근/i,
    account_warning: /(?:계정|회원|아이디).{0,30}(?:경고|정지|보호\s*조치|제한)|(?:자동화|자동접속).{0,30}(?:차단|제한|금지|허용하지)/i,
    human_verification: /로봇이 아님|사람인지 확인|verify you are human/i,
    authentication_required: /로그인.{0,12}(필요|해주세요|해 주세요)|로그인 후/i,
    // These were sufficient for the old guard; they are ambiguous alone.
    old_captcha_word: /captcha/i,
    old_try_later: /잠시 후 다시/i
  };
  return Object.fromEntries(Object.entries(patterns).map(([name, re]) => [name, re.test(text)]));
}
function categorize(state) {
  if (state.signals.access_restricted || state.signals.rate_limited || state.signals.abnormal_access || state.signals.account_warning)
    return 'blocked';
  if (state.active_challenge || state.signals.human_verification) return 'challenge';
  if (state.login_form || state.login_url || state.signals.authentication_required) return 'login';
  if (state.overview_items > 0 || state.article_lists === 1) return 'lecture';
  return 'unknown';
}

async function inspect(page) {
  const state = await page.evaluate(() => {
    const visible = n => {
      if (!n.getClientRects().length) return false;
      for (let p=n; p; p=p.parentElement) {
        const s=getComputedStyle(p);
        if (s.display==='none' || s.visibility==='hidden' || Number(s.opacity)===0) return false;
      }
      return true;
    };
    const pattern = {
      access_restricted: /접근이?\s*제한|접근할 수 없|access denied|access restricted/i,
      rate_limited: /너무 많은 요청|too many requests/i,
      abnormal_access: /비정상적인 접근/i,
      account_warning: /(?:계정|회원|아이디).{0,30}(?:경고|정지|보호\s*조치|제한)|(?:자동화|자동접속).{0,30}(?:차단|제한|금지|허용하지)/i,
      human_verification: /로봇이 아님|사람인지 확인|verify you are human/i,
      authentication_required: /로그인.{0,12}(필요|해주세요|해 주세요)|로그인 후/i,
      old_captcha_word: /captcha/i, old_try_later: /잠시 후 다시/i
    };
    const signals=Object.fromEntries(Object.keys(pattern).map(k=>[k,false]));
    const walker=document.createTreeWalker(document.body || document.documentElement,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())) {
      const p=node.parentElement;
      if(!p || p.closest('div.article, input, textarea, script, style') || !visible(p)) continue;
      for(const [key,re] of Object.entries(pattern)) if(re.test(node.textContent)) signals[key]=true;
    }
    const widgets=Array.from(document.querySelectorAll('iframe[src*="captcha"], [id*="captcha"], [class*="captcha"]')).filter(visible);
    const active=widgets.some(n=>{
      const rect=n.getBoundingClientRect();
      // A reCAPTCHA privacy badge/word is not evidence of an active challenge.
      if(n.closest('.grecaptcha-badge')) return false;
      return n.tagName==='IFRAME' && rect.width>=250 && rect.height>=65;
    });
    return {signals, active_challenge:active, captcha_marker_visible:widgets.length>0,
      login_form:Array.from(document.querySelectorAll('input[type=password]')).some(visible),
      login_url:/\/login(?:[/?#]|$)/.test(location.pathname),
      signed_in_control:Array.from(document.querySelectorAll('a,button')).some(n=>visible(n)&&n.innerText.trim()==='로그아웃'),
      overview_items:Array.from(document.querySelectorAll('section.info > div.item')).filter(visible).length,
      article_lists:Array.from(document.querySelectorAll('div.article_tab > div.articles')).filter(visible).length,
      ready:document.readyState};
  });
  return {...state, url:safeUrl(page.url()), title:safeTitle(await page.title()), category:categorize(state)};
}

module.exports={safeUrl,safeTitle,fixedSignals,categorize,inspect};
