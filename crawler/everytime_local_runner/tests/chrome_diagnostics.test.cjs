const test=require('node:test'),assert=require('node:assert/strict');
const {safeUrl,safeTitle,fixedSignals,categorize}=require('../chrome_diagnostics.cjs');
const state=extra=>({signals:fixedSignals(''),active_challenge:false,login_form:false,login_url:false,overview_items:0,article_lists:0,...extra});

test('URL diagnostics strip queries fragments credentials and unknown paths',()=>{
  assert.equal(safeUrl('https://user:password@everytime.kr/lecture/view/603889?token=secret#secret'),'https://everytime.kr/lecture/view/603889');
  assert.equal(safeUrl('https://account.everytime.kr/login?redirect_token=private'),'https://account.everytime.kr/login');
  assert.equal(safeUrl('https://account.everytime.kr/private-user-path'),'https://account.everytime.kr/[path-redacted]');
  assert.equal(safeUrl('https://elsewhere.example/private'),'[other-origin-redacted]');
  assert.equal(safeTitle('Private account name'),'[unrecognized-title-redacted]');
});
test('login, confirmed restrictions and unknown structures are separate',()=>{
  assert.equal(categorize(state({login_form:true})),'login');
  assert.equal(categorize(state({signals:fixedSignals('접근이 제한되었습니다')})),'blocked');
  assert.equal(categorize(state({signals:fixedSignals('너무 많은 요청')})),'blocked');
  assert.equal(categorize(state({active_challenge:true})),'challenge');
  assert.equal(categorize(state()),'unknown');
  assert.equal(categorize(state({overview_items:2})),'lecture');
});
test('passive CAPTCHA mention or retry-later label alone does not prove access blocking',()=>{
  const s=state({signals:fixedSignals('This site is protected by reCAPTCHA. 잠시 후 다시'),login_form:true});
  assert.equal(s.signals.old_captcha_word,true);
  assert.equal(s.signals.old_try_later,true);
  assert.equal(categorize(s),'login');
  assert.equal(categorize(state({signals:fixedSignals('잠시 후 다시')})),'unknown');
});
test('account warnings and explicit automation denial stop before collecting',()=>{
  for(const text of ['회원님 계정에 경고가 부여되었습니다','계정 보호 조치가 적용되었습니다','자동화 접속을 허용하지 않습니다']) {
    assert.equal(categorize(state({signals:fixedSignals(text)})),'blocked');
  }
});
