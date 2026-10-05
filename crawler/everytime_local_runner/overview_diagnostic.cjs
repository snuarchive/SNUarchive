'use strict';
const ERROR_LABELS=['Page changed or login expired','Wrong course or login page','Preloaded article requires',
 'Course label missing or ambiguous','Course value missing or ambiguous','Displayed review count unavailable',
 'Visible course identity differs','Unrecognized displayed count','Same-course article link missing',
 'Article page title differs','Review list unavailable','Filter or sort changed','No cards and no explicit empty-list evidence',
 'Conflicting empty-list evidence','Previously loaded physical cards changed','Timeout','timed out'];
function errorLabel(value){return ERROR_LABELS.find(label=>String(value).includes(label))||'Unclassified local collector error';}
async function overviewDiagnostic(page) {
  return page.evaluate(()=>{
    const visible=n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
    const shape=n=>({tag:n.tagName,class:n.className,visible:visible(n)});
    return {
      items:Array.from(document.querySelectorAll('section.info > div.item')).map(n=>({
        ...shape(n),label:n.querySelector(':scope > label')?.innerText??null,
        values:Array.from(n.querySelectorAll(':scope > a.link, :scope > div.multiline > a.link, :scope > span.text')).map(v=>({...shape(v),text:v.innerText})),
        children:Array.from(n.children).map(shape)
      })),
      counts:['div.rating > div.title > span.count','section.empty.review > div.title > span.count'].map(selector=>({selector,
        nodes:Array.from(document.querySelectorAll(selector)).map(n=>({...shape(n),text:n.innerText}))})),
      review_links:Array.from(document.querySelectorAll('a')).filter(n=>n.innerText==='강의평').map(n=>({...shape(n),href:n.getAttribute('href')})),
      rating_structure:Array.from(document.querySelectorAll('div.rating, section.empty.review')).map(n=>({...shape(n),children:Array.from(n.children).map(c=>({...shape(c),children:Array.from(c.children).map(shape)}))}))
    };
  });
}
module.exports={errorLabel,overviewDiagnostic};
