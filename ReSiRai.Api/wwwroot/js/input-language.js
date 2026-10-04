// Input language hints and numeric normalization for all current and dynamically-created forms.
// Browsers cannot switch the Windows keyboard layout programmatically. lang/dir/inputmode
// provide the correct language/keyboard hint, especially on mobile/touch devices.
(() => {
 const numericRx=/(nationalcode|mobile|phone|tel|serial|count|amount|price|number|date|time|year|month|day)/i;
 const persianRx=/(firstname|lastname|address|description|report|bodypart|name|title|specialty|clinic|note|reason|body|message|comment)/i;
 const numericModes=["numeric","decimal","tel"];
 const toLatin=v=>String(v??"").replace(/[۰-۹]/g,d=>"۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g,d=>"٠١٢٣٤٥٦٧٨٩".indexOf(d));
 function applyElement(el){
   if(el.type==="file"||el.type==="checkbox"||el.type==="radio"||el.type==="password"||el.type==="hidden")return;
   const key=(el.id||"")+" "+(el.name||"")+" "+(el.getAttribute("placeholder")||"")+" "+(el.getAttribute("inputmode")||"");
   // An explicit numeric keyboard takes precedence over names such as
   // loginUserName, which would otherwise be classified as Persian text.
   const explicitNumericMode=numericModes.includes(el.inputMode);
   const numeric=explicitNumericMode||el.hasAttribute("data-jalali-date")||el.hasAttribute("data-jalali-datetime")||numericRx.test(key)||el.type==="number";
   if(numeric){el.lang="en";el.dir="ltr";if(!explicitNumericMode)el.inputMode=el.hasAttribute("data-jalali-datetime")?"text":"numeric";if(!el.dataset.latinDigits){el.dataset.latinDigits="1";el.addEventListener("input",()=>{const p=el.selectionStart,v=el.value,n=toLatin(v);if(v!==n){el.value=n;try{el.setSelectionRange(p,p);}catch{}}});}}
   else if(persianRx.test(key)||el.tagName==="TEXTAREA"){el.lang="fa";el.dir="rtl";el.setAttribute("inputmode","text");el.setAttribute("spellcheck","true");}
 }
 function apply(root=document){if(root.matches?.("input,textarea"))applyElement(root);root.querySelectorAll?.("input,textarea").forEach(applyElement);}
 window.ReSiRaiInputLanguage={apply};
const run=()=>apply();
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);else run();
// Forms built later must get the same hints too.
const languageObserver=new MutationObserver(records=>{
 for(const rec of records){for(const node of rec.addedNodes){if(node.nodeType===1)apply(node);}}
});
const startLanguageObserver=()=>languageObserver.observe(document.body,{childList:true,subtree:true});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",startLanguageObserver);else startLanguageObserver();
})();
