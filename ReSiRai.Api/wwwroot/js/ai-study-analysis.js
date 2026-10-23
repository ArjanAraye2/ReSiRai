// ============================================================
// ReSiRai - تحلیلِ همهٔ تصاویرِ یک مراجعه، داخلِ همان کارت
// ============================================================
// تصاویرِ مراجعه از مسیرِ مشترکِ چندتصویری می‌روند
// (/api/ai/images/analyze-many)؛ بنابراین تأییدِ حریم خصوصی روی سرور اجرا
// می‌شود و نتیجه برای همان مجموعه ذخیره می‌شود؛ کلیکِ دوباره آنی و بی‌هزینه است.
// «کارت سابقه» سند است نه تصویرِ رادیولوژی و در تحلیل شرکت نمی‌کند.
(function(){
'use strict';

function esc(value){const d=document.createElement('div');d.textContent=value??'';return d.innerHTML;}
const isDocument=im=>String(im?.imageTypeName||"").trim()==="کارت سابقه";

async function analyze(card,button){
 const studyID=Number(card.dataset.studyId);if(!studyID)return;
 // The Study body is built on first open, so the result has a home whether or not
 // the row has been opened yet.
 let host=card.querySelector('.ai-study-analysis');
 if(!host){host=document.createElement('div');host.className='ai-study-analysis';(card.querySelector('.study-scroll-body')||card).appendChild(host);}
 button.disabled=true;
 host.innerHTML='<p>در حال دریافت تصاویر این مراجعه...</p>';
 try{
  const r=await fetch(`/api/radiologyimages/study/${studyID}`);
  let x={};try{x=await r.json();}catch{}
  if(!r.ok||x.success===false)throw new Error(x.message||'تصاویر این مراجعه دریافت نشد.');
  const images=(x.images||[]).filter(im=>String(im.contentType||'').toLowerCase().startsWith('image/')&&!isDocument(im));
  if(!images.length)throw new Error('برای تحلیل، حداقل یک تصویر رادیولوژی لازم است.');
  // تک‌تصویر مسیرِ خودش را دارد (ذخیرهٔ جداگانه و پنجرهٔ تک‌تصویر)؛ دو تصویر به بالا مشترک.
  if(images.length===1){host.innerHTML='';if(window.ReSiRaiImageAI)window.ReSiRaiImageAI.analyze(images[0]);return;}
  if(!window.ReSiRaiImageAI||!window.ReSiRaiImageAI.analyzeMany)throw new Error('ماژول تحلیل هنوز آماده نیست؛ صفحه را تازه‌سازی کنید.');
  await window.ReSiRaiImageAI.analyzeMany(images.map(im=>im.imageID),{host});
 }catch(error){host.innerHTML=`<p class="error">${esc(error.message||'تحلیل هوش مصنوعی انجام نشد.')}</p>`;}
 finally{button.disabled=false;}
}

// Attach to the current collapsible row markup. The header no longer shows the
// analyse button (owner request): the element stays in the actions container but
// hidden, so the in-card «تحلیلِ همهٔ تصاویر با AI» can still trigger the same
// flow with a programmatic click.
function enhance(){document.querySelectorAll('.study-scroll-card').forEach(card=>{if(card.querySelector('.ai-analyze-button'))return;const actions=card.querySelector('.study-scroll-actions');if(!actions)return;const button=document.createElement('button');button.type='button';button.className='secondary-button ai-analyze-button hidden';button.textContent='تحلیل با هوش مصنوعی';button.addEventListener('click',e=>{e.stopPropagation();analyze(card,button);});actions.appendChild(button);});}
const container=document.getElementById('studiesContainer');if(container){new MutationObserver(enhance).observe(container,{childList:true,subtree:true});enhance();}
})();
