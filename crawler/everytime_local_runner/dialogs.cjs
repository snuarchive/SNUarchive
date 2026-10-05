'use strict';
const {fixedSignals}=require('./chrome_diagnostics.cjs');

// A fixed vocabulary reveals only generic UI meaning, never arbitrary dialog text.
const WORDS=['로그인','로그아웃','아이디','비밀번호','성공','실패','일치','확인','다시','오류','서버','서비스',
  '일시','잠시','이용','사용','불가','접근','제한','차단','자동화','비정상','요청','많','인증','보안','캡차','캡챠','자동입력',
  '네트워크','네트웍','인터넷','연결','회원','정보','문자','숫자','필수','입력','누락','올바르','만료','중복','기기','브라우저'];
function dialogEvidence(message,type='alert') {
  const signals=fixedSignals(message),compact=message.replace(/\s+/g,'');
  const explicit=signals.access_restricted||signals.rate_limited||signals.abnormal_access||signals.account_warning||
    /(?:자동화|자동접속|비정상).{0,30}(?:차단|제한|금지|허용하지)|(?:접근|로그인|이용|요청).{0,15}(?:차단되|제한되)/.test(compact);
  const challenge=/캡[차챠]|자동입력방지|captcha/i.test(message) && /실패|인증|오류|입력|확인|해결/.test(message);
  const authenticationError=/(?:아이디|비밀번호).{0,30}(?:확인|일치하지|올바르지|틀|잘못)|(?:로그인).{0,15}(?:실패|오류)/.test(compact);
  const code=explicit?'explicit_access_block':challenge?'human_verification_required':
    authenticationError?'authentication_error':signals.authentication_required?'authentication_required':
    /로그인.{0,15}성공|로그인되었습니다/.test(compact)?'login_success_notice':'unrecognized_dialog';
  return {type,code,signals,known_words:WORDS.filter(word=>message.includes(word))};
}

class DialogController {
  constructor({onPending=()=>{},onResolved=()=>{}}={}) {
    this.pending=null;this.terminal=null;this.onPending=onPending;this.onResolved=onResolved;this.records=[];
  }
  handle(dialog) {
    const evidence=dialogEvidence(dialog.message(),dialog.type());
    this.records.push({observed_at:new Date().toISOString(),...evidence});
    if(['explicit_access_block','human_verification_required'].includes(evidence.code)) this.terminal=evidence;
    this.pending={dialog,evidence};
    this.onPending(evidence);
    // Deliberately leave the original alert open until it has been read.
  }
  async acknowledge() {
    if(!this.pending) return false;
    const {dialog,evidence}=this.pending;
    // Never accept a confirm or supply a prompt value as part of authentication.
    if(evidence.type!=='alert' || this.terminal) return false;
    try { await dialog.accept(); }
    catch(error) {
      // A user can close the native alert directly. This is not an operator stop.
      if(!/No dialog is showing|already handled|No dialog is present/i.test(String(error)))throw error;
    }
    this.pending=null;this.onResolved(evidence);
    return true;
  }
  userResolved(pending) {
    if(this.pending!==pending || this.terminal || pending.evidence.type!=='alert')return false;
    this.pending=null;this.onResolved({...pending.evidence,resolved_by:'native_user_action'});return true;
  }
}
module.exports={dialogEvidence,DialogController};
