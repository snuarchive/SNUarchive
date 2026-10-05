const test=require('node:test'),assert=require('node:assert/strict');
const {dialogEvidence,DialogController}=require('../dialogs.cjs');

test('dialog evidence retains fixed public vocabulary without arbitrary credentials',()=>{
  const evidence=dialogEvidence('example@example.com 사용자 비밀번호가 일치하지 않습니다. abcSecret123');
  assert.equal(evidence.code,'authentication_error');
  assert.ok(!JSON.stringify(evidence).includes('example'));
  assert.ok(!JSON.stringify(evidence).includes('abcSecret123'));
});
test('Korean captcha and explicit automation denial are stop conditions',()=>{
  assert.equal(dialogEvidence('캡챠 인증에 실패했습니다.').code,'human_verification_required');
  assert.equal(dialogEvidence('자동화된 접근은 허용하지 않습니다. 접근이 제한되었습니다.').code,'explicit_access_block');
});
test('unrecognized alert remains open until explicit acknowledgment; no automatic dismiss',async()=>{
  let accepted=0,dismissed=0;
  const controller=new DialogController();
  controller.handle({type:()=> 'alert',message:()=> '알 수 없는 안내입니다.',accept:async()=>accepted++,dismiss:async()=>dismissed++});
  assert.equal(accepted,0);assert.equal(dismissed,0);assert.ok(controller.pending);
  assert.equal(await controller.acknowledge(),true);assert.equal(accepted,1);assert.equal(controller.pending,null);
});
test('block and prompt dialogs are never acknowledged by the controller',async()=>{
  for(const [type,message]of[['alert','캡차 인증 오류입니다.'],['prompt','입력해주세요']]){
    const controller=new DialogController();let accepted=0;
    controller.handle({type:()=>type,message:()=>message,accept:async()=>accepted++});
    assert.equal(await controller.acknowledge(),false);assert.equal(accepted,0);
  }
});
test('already closed native alert does not become an operator stop',async()=>{
  const controller=new DialogController();
  controller.handle({type:()=> 'alert',message:()=> '로그인 정보를 입력하세요.',accept:async()=>{throw new Error('Protocol error: No dialog is showing');}});
  assert.equal(await controller.acknowledge(),true);assert.equal(controller.pending,null);
});
test('verified page activity can resolve only the same pending informational alert',()=>{
  const controller=new DialogController();
  controller.handle({type:()=> 'alert',message:()=> '로그인 정보를 입력하세요.'});
  assert.equal(controller.userResolved(controller.pending),true);
  controller.handle({type:()=> 'alert',message:()=> '캡챠 인증 실패'});
  assert.equal(controller.userResolved(controller.pending),false);
});
