const test=require('node:test'),assert=require('node:assert/strict');
const {validate,documentFor}=require('../unattributed_capture.cjs');
const state=()=>({buttons:['전체','등록순'],at_bottom:true,rows:[{position:1,child:1,text:'원문\n보존',term:'24년 1학기 수강자',reason:null}]});
test('unknown instructor stays null; text and term preserved outside legacy schema',()=>{
 const d=documentFor({title:'강의',url:'https://everytime.kr/lecture/view/1',displayed_total:1},state(),{});
 assert.equal(d.instructor,null);assert.equal(d.reviews[0].instructor,null);assert.equal(d.reviews[0].text_raw,'원문\n보존');assert.equal(d.reviews[0].enrollment_term_raw,'24년 1학기 수강자');assert.equal(d.legacy_raw_compatible,false);assert.equal(d.catalog_mapping_approved,false);
});
test('count mismatch and nonterminal list cannot be complete',()=>{assert.throws(()=>validate(state(),2));assert.throws(()=>validate({...state(),at_bottom:false},1));});
test('invalid scope or failed review cannot be complete',()=>{assert.throws(()=>validate({...state(),buttons:['전체','추천순']},1));const s=state();s.rows[0].reason='term_invalid';assert.throws(()=>validate(s,1));});
