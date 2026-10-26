// ReSiRai Study finance: multiple billable actions and multiple payments per Study.
//
// The panel is collapsible, like the rest of a Study, and a compact summary is
// published to the Study header so the money state is visible without opening
// anything. The full detail (forms and rows) stays one click away.
(() => {
 "use strict";
 const money=value=>Number(value||0).toLocaleString("fa-IR",{maximumFractionDigits:2});
 const api=async(url,options)=>{const r=await fetch(url,options);let x={};try{x=await r.json();}catch{}if(!r.ok||x.success===false)throw new Error(x.message||`خطای مالی (HTTP ${r.status})`);return x;};
 const field=(placeholder,type="text")=>{const i=document.createElement("input");i.type=type;i.placeholder=placeholder;if(type==="number"){i.min="0";i.step="0.01";i.inputMode="decimal";}return i;};
 const paymentMethodSelect=()=>{const s=document.createElement("select");s.innerHTML='<option value="">نوع دریافت</option><option value="1">پوز</option><option value="2">کارت به کارت</option><option value="3">نقدی</option>';return s;};
 const paymentMethodName=value=>({1:"پوز",2:"کارت به کارت",3:"نقدی"})[Number(value)]||"تعیین نشده";
 const button=(text,className="")=>{const b=document.createElement("button");b.type="button";b.textContent=text;if(className)b.className=className;return b;};

 // What the money adds up to, in one phrase. "No charge" and "settled" are different
 // states from "owes money", and the header chip should say which one applies.
 function summaryState(s){
  const gross=Number(s?.grossAmount||0),net=Number(s?.netAmount||0),received=Number(s?.receivedAmount||0),balance=Number(s?.balanceAmount||0);
  if(!gross&&!net&&!received&&!balance)return {kind:"none",text:"بدون هزینه"};
  if(balance>0)return {kind:"due",text:`مانده ${money(balance)}`};
  if(received>0)return {kind:"settled",text:"تسویه شده"};
  return {kind:"ok",text:`خالص ${money(net)}`};
 }

 function createPanel(studyID){
  const root=document.createElement("section");root.className="study-finance";root.dataset.studyId=studyID;
  // A collapsible head carries the summary, so the panel reads without opening it.
  root.innerHTML='<header class="study-finance-head"><button type="button" class="study-finance-toggle" aria-expanded="false"><span class="study-finance-arrow" aria-hidden="true">⌄</span><span class="study-finance-head-text"><strong>امور مالی مطالعه</strong><span class="study-finance-head-summary" data-head-summary>بدون هزینه</span></span></button></header>'
   +'<div class="study-finance-body hidden">'
   +'<div class="study-finance-summary"><div><span>جمع هزینه</span><strong data-s="gross">۰</strong></div><div><span>جمع تخفیف</span><strong data-s="discount">۰</strong></div><div><span>مبلغ خالص</span><strong data-s="net">۰</strong></div><div><span>دریافتی</span><strong data-s="received">۰</strong></div><div class="finance-balance"><span>مانده</span><strong data-s="balance">۰</strong></div></div>'
   +'<div class="study-finance-columns"></div><div class="study-finance-status"></div></div>';
  const cols=root.querySelector(".study-finance-columns");
  // ثبت اقدام کارِ حسابداری نیست؛ پس در پنل جداگانهٔ بالای تصاویر می‌نشیند
  // (createActionPanel) و این پنل فقط سمتِ پول را نگه می‌دارد.
  cols.append(createPaymentBox(root));

  // Open/close. The whole head is the hit area, with the keyboard covered too.
  const toggle=root.querySelector(".study-finance-toggle");
  const body=root.querySelector(".study-finance-body");
  const setOpen=open=>{
    body.classList.toggle("hidden",!open);
    root.classList.toggle("is-open",open);
    toggle.setAttribute("aria-expanded",open?"true":"false");
    root.querySelector(".study-finance-arrow").textContent=open?"⌃":"⌄";
  };
  toggle.addEventListener("click",()=>{root.__userToggled=true;setOpen(body.classList.contains("hidden"));});
  // «دریافت‌ها» فقط وقتی مانده‌ای هست باز می‌شود (طلب باید دیده شود)؛ اگر کاربر
  // خودش باز/بستش کرد، تصمیم او تا آخرِ این نشست می‌ماند.
  root.__setOpen=setOpen;
  return root;
 }
 // پنل اقدامات: فشرده، همیشه باز، بالای تصاویر — جایی که دست است. شرح + مبلغ
 // در یک خط تایپ می‌شود و هر اقدام فقط یک ردیف کوتاه است. (دیکتهٔ صوتی بعداً
 // به همین ردیف اضافه می‌شود.) داده از همان یک فراخوانی «مالی» می‌آید.
 function createActionPanel(financeRoot){
  const root=document.createElement("section");
  root.className="study-actions";
  root.dataset.studyId=String(financeRoot.dataset.studyId);

  // سرِ هدر دکمهٔ باز/بسته است: فلش + عنوان + خلاصهٔ شرح‌ها + چیپ. خلاصهٔ شرح‌ها
  // هنگامِ بستن هم می‌ماند تا بدانید چه داخلِ این پنل است.
  const head=document.createElement("button");
  head.type="button";head.className="study-actions-head";
  head.setAttribute("aria-expanded","true");
  const arrow=document.createElement("span");arrow.className="study-actions-arrow";arrow.setAttribute("aria-hidden","true");arrow.textContent="⌃";
  const title=document.createElement("strong");title.textContent="اقدامات این مراجعه";
  const descLine=document.createElement("span");descLine.className="study-actions-desc";
  descLine.dataset.actionsDesc="";descLine.textContent="";
  const chip=document.createElement("span");chip.className="study-actions-chip";
  chip.dataset.actionsSummary="";chip.textContent="بدون اقدام";
  head.append(arrow,title,descLine,chip);

  const body=document.createElement("div");body.className="study-actions-body";
  const form=document.createElement("div");form.className="study-actions-form";
  const desc=field("شرح اقدام"),amount=field("هزینه","number"),discount=field("تخفیف","number"),add=button("+ ثبت");
  discount.value="0";
  // «خالص» یک ستونِ نمایشی است: ورودی ندارد، ولی جایِ خالی‌اش نگه داشته
  // می‌شود تا شرح/هزینه/تخفیف درست زیرِ عنوان‌هایشان بنشینند و «+ ثبت» آخر.
  const netSpacer=document.createElement("span");netSpacer.className="study-actions-net-spacer";
  form.append(desc,amount,discount,netSpacer,add);

  const list=document.createElement("div");list.className="study-actions-list";
  // برچسب‌ها یک بار در بالای فهرست، نه در هر سطر: ده اقدام هم یک صفحه می‌ماند
  // و سطرها فقط عدد و شرح‌اند.
  list.innerHTML='<div class="study-actions-list-head"><span>شرح اقدام</span><span>هزینه</span><span>تخفیف</span><span>خالص</span><span></span></div>'
    +'<div class="study-actions-rows" data-list="actions"></div>';
  const status=document.createElement("div");status.className="study-actions-status";

  body.append(form,list,status);
  root.append(head,body);
  // باز/بسته: پیش‌فرض باز (محلِ کارِ روزمره) و تصمیمِ دستیِ کاربر تا آخرِ نشست می‌ماند.
  const setOpen=open=>{body.classList.toggle("hidden",!open);root.classList.toggle("is-collapsed",!open);head.setAttribute("aria-expanded",open?"true":"false");arrow.textContent=open?"⌃":"⌄";};
  head.addEventListener("click",()=>setOpen(body.classList.contains("hidden")));
  // ذخیرهٔ موفق، نشانگر را به اولین فیلد برمی‌گرداند تا اقدام بعدی سریع ثبت شود.
  add.onclick=()=>saveAction(financeRoot,{description:desc.value,amount:num(amount),discountAmount:num(discount)},
    ()=>{desc.value="";amount.value="";discount.value="0";desc.focus();});
  return root;
 }
 function createPaymentBox(root){
  const box=document.createElement("section");box.className="study-finance-box";box.innerHTML="<h6>دریافت‌های Study</h6>";
  const form=document.createElement("div");form.className="study-finance-form payment";
  const date=field("تاریخ شمسی"),method=paymentMethodSelect(),amount=field("مبلغ دریافت","number"),desc=field("شرح دریافت");
  const isRefund=document.createElement("label");isRefund.className="finance-refund-toggle";
  isRefund.innerHTML='<input type="checkbox" /> <span>بازپرداخت</span>';
  const refundBox=isRefund.querySelector("input");
  const add=button("+ دریافت");
  date.dataset.jalaliDatetime="";date.value=window.toEnglishJalaliInput?.(new Date(),true)||"";
  // کلاس‌های جای‌گذاری: ویجتِ تاریخ یک div و یک برچسبِ روزِ هفته کنارِ فیلد
  // می‌سازد؛ بدون این کلاس‌ها ستون‌ها یکی به‌راست می‌رفتند و «شرح دریافت»
  // در ستونِ باریکِ آخر می‌نشست.
  date.classList.add("f-date");method.classList.add("f-method");amount.classList.add("f-amount");
  desc.classList.add("f-desc");isRefund.classList.add("f-refund");add.classList.add("f-add");
  form.append(date,method,amount,desc,isRefund,add);
  window.ReSiRaiJalali?.enhanceAll(date);
  const wrap=date.closest(".jalali-input-wrap");if(wrap)wrap.classList.add("f-date");
  form.querySelector(":scope > .jalali-weekday-name")?.classList.add("f-date-note");

  // A refund reverses money, so the wording and the button change with it.
  const applyRefundMode=()=>{
    const on=refundBox.checked;
    amount.placeholder=on?"مبلغ بازپرداخت":"مبلغ دریافت";
    desc.placeholder=on?"دلیل بازپرداخت (الزامی)":"شرح دریافت";
    add.textContent=on?"− بازپرداخت":"+ دریافت";
    add.classList.toggle("danger-button",on);
    box.classList.toggle("is-refund-mode",on);
  };
  refundBox.addEventListener("change",applyRefundMode);applyRefundMode();

  const list=document.createElement("div");list.className="study-finance-list";list.dataset.list="payments";box.append(form,list);
  add.onclick=()=>{let paymentDate;try{paymentDate=window.parsePersianDateForBackend(date.value,true);}catch(e){setStatus(root,e.message,true);return;}
    savePayment(root,{paymentDate,paymentMethod:Number(method.value),amount:num(amount),description:desc.value,isRefund:refundBox.checked},
      ()=>{method.value="";amount.value="";desc.value="";refundBox.checked=false;applyRefundMode();});};
  return box;
 }
 // پیام وضعیت در هر دو جا دیده می‌شود: پنل مالی (که ممکن است بسته باشد) و پنل
 // اقدامات — چون این پیام معمولاً برای همان اقدام است.
 function setStatus(root,message,error=false){
  const paint=el=>{if(!el)return;el.textContent=message||"";el.classList.toggle("error",!!error);};
  paint(root.querySelector(".study-finance-status"));
  paint(root.__actions&&root.__actions.querySelector(".study-actions-status"));
 }
 // Empty input must become 0, not NaN: Number("") is 0 but Number(" ") is also 0,
 // while Number("abc") is NaN which would be sent to the API.
 const num=el=>{const v=Number(String(el.value).replace(/[^\d.\-]/g,""));return Number.isFinite(v)?v:0;};
 async function saveAction(root,data,done,id){try{if(!data.description.trim())throw new Error("شرح اقدام را وارد کنید.");setStatus(root,"در حال ذخیره...");const base=`/api/studies/${root.dataset.studyId}/finance/actions`;await api(id?`${base}/${id}`:base,{method:id?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});done?.();await load(root);}catch(e){setStatus(root,e.message,true);}}
 async function savePayment(root,data,done,id){try{if(!(data.amount>0))throw new Error(data.isRefund?"مبلغ بازپرداخت را وارد کنید.":"مبلغ دریافت را وارد کنید.");setStatus(root,"در حال ذخیره...");const base=`/api/studies/${root.dataset.studyId}/finance/payments`;await api(id?`${base}/${id}`:base,{method:id?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});done?.();await load(root);}catch(e){setStatus(root,e.message,true);}}
 function renderActions(root,items){
  // فهرست اقدامات در پنل جداگانه است؛ اگر جایی نبود (هنوز ساخته نشده) خودِ پنل مالی.
  const host=root.__actions||root;
  const list=host.querySelector('[data-list="actions"]');
  if(!list)return;
  const chip=host.querySelector("[data-actions-summary]");
  const netOf=x=>Number(x.amount||0)-Number(x.discountAmount||0);
  if(chip)chip.textContent=items.length?`${items.length.toLocaleString("fa-IR")} اقدام · خالص ${money(items.reduce((s,x)=>s+netOf(x),0))}`:"بدون اقدام";
  // خلاصهٔ شرح‌ها در هدر: با « · » از هم جدا می‌شود و کلِ متن در تولتیپ است.
  const descEl=host.querySelector("[data-actions-desc]");
  if(descEl){const text=items.map(x=>x.description||"-").join(" · ");descEl.textContent=text;descEl.title=text;}
  list.replaceChildren();
  if(!items.length){list.innerHTML='<div class="study-finance-empty">اقدامی ثبت نشده است.</div>';return;}
  items.forEach(x=>{
    const row=document.createElement("div");row.className="study-actions-row";
    // بدون برچسب در سطر (برچسب در بالای فهرست است) تا سطر کوتاه بماند.
    [x.description,money(x.amount),money(x.discountAmount),money(netOf(x))].forEach(v=>{const s=document.createElement("span");s.textContent=v;row.appendChild(s);});
    const actions=document.createElement("span");actions.className="row-actions";
    const edit=button("ویرایش","secondary-button"),del=button("حذف","danger-button");
    edit.onclick=()=>{const description=prompt("شرح اقدام",x.description);if(description===null)return;const amount=prompt("مبلغ هزینه",x.amount);if(amount===null)return;const discountAmount=prompt("مبلغ تخفیف",x.discountAmount);if(discountAmount===null)return;saveAction(root,{description,amount:Number(amount)||0,discountAmount:Number(discountAmount)||0},null,x.studyActionID);};
    del.onclick=()=>remove(root,`actions/${x.studyActionID}`);
    actions.append(edit,del);row.append(actions);list.append(row);
  });
 }
 function renderPayments(root,items){
  const list=root.querySelector('[data-list="payments"]');list.replaceChildren();
  if(!items.length){list.innerHTML='<div class="study-finance-empty">دریافتی ثبت نشده است.</div>';return;}
  items.forEach(x=>{
    const isRefund=!!x.isRefund;
    const row=document.createElement("div");
    row.className="study-finance-row payment"+(isRefund?" is-refund":"");

    // Date, kind, amount and description. A refund is labelled, not shown as a
    // negative number, so the stored amount always stays positive.
    const cells=[
      window.formatPersianDateTime?.(x.paymentDate)||x.paymentDate,
      isRefund?"بازپرداخت":`نوع: ${paymentMethodName(x.paymentMethod)}`,
      `${isRefund?"−":"+"} ${money(x.amount)}`,
      isRefund?`دلیل: ${x.description||"-"}`:(x.description||"-")
    ];
    cells.forEach(v=>{const s=document.createElement("span");s.textContent=v;row.appendChild(s);});

    // POS dispatch state, so a failed send can be retried.
    if(x.posSentAt){
      const state=document.createElement("span");
      state.className="finance-pos-state "+(x.posSuccess?"ok":"err");
      state.textContent=x.posSuccess?"پوز: تأیید شد":"پوز: ناموفق";
      state.title=`${window.formatPersianDateTime?.(x.posSentAt)||x.posSentAt}${x.posMessage?" — "+x.posMessage:""}`;
      row.appendChild(state);
    }

    const actions=document.createElement("span");actions.className="row-actions";
    if(!isRefund){
      const send=button(x.posSentAt?"ارسال مجدد":"ارسال به پوز","secondary-button");
      send.onclick=()=>sendToPos(root,x,send);
      actions.appendChild(send);
    }
    const edit=button("ویرایش","secondary-button"),del=button("حذف","danger-button");
    edit.onclick=()=>openEditPayment(root,row,x);
    del.onclick=()=>remove(root,`payments/${x.studyPaymentID}`);
    actions.append(edit,del);
    row.append(actions);list.append(row);
  });
 }

 // Inline edit of an existing payment, including the refund flag.
 function openEditPayment(root,row,x){
  const form=document.createElement("div");
  form.className="study-finance-row payment edit-row"+(x.isRefund?" is-refund":"");
  const date=field("تاریخ شمسی");date.dataset.jalaliDatetime="";
  date.value=window.toEnglishJalaliInput?.(new Date(x.paymentDate),true)||"";
  const method=paymentMethodSelect();method.value=String(x.paymentMethod||1);
  const amount=field("مبلغ","number");amount.value=x.amount;
  const desc=field("شرح");desc.value=x.description||"";
  const refundLabel=document.createElement("label");refundLabel.className="finance-refund-toggle";
  refundLabel.innerHTML='<input type="checkbox" /> <span>بازپرداخت</span>';
  const refundBox=refundLabel.querySelector("input");refundBox.checked=!!x.isRefund;
  const save=button("ذخیره"),cancel=button("انصراف","secondary-button");
  // همان جای‌گذاریِ صریح (ویجتِ تاریخ دو جایگاه اضافه می‌کند).
  date.classList.add("f-date");method.classList.add("f-method");amount.classList.add("f-amount");
  desc.classList.add("f-desc");refundLabel.classList.add("f-refund");save.classList.add("f-save");cancel.classList.add("f-cancel");
  form.append(date,method,amount,desc,refundLabel,save,cancel);
  row.replaceWith(form);
  window.ReSiRaiJalali?.enhanceAll(form);
  const wrap=date.closest(".jalali-input-wrap");if(wrap)wrap.classList.add("f-date");
  form.querySelector(":scope > .jalali-weekday-name")?.classList.add("f-date-note");
  save.onclick=()=>{let paymentDate;try{paymentDate=window.parsePersianDateForBackend(date.value,true);}catch(e){setStatus(root,e.message,true);return;}
    savePayment(root,{paymentDate,paymentMethod:Number(method.value),amount:num(amount),description:desc.value,isRefund:refundBox.checked},null,x.studyPaymentID);};
  cancel.onclick=()=>form.replaceWith(row);
 }

 // Sends a recorded payment to the card reader. The payment is already stored,
 // so a failure here never loses the money - it is offered again as a retry.
 async function sendToPos(root,payment,buttonEl){
  const original=buttonEl.textContent;
  buttonEl.disabled=true;buttonEl.textContent="در حال ارسال...";
  setStatus(root,"در حال ارسال مبلغ به پوز...",false);
  try{
    const x=await api(`/api/studies/${root.dataset.studyId}/finance/payments/${payment.studyPaymentID}/send-to-pos`,{method:"POST"});
    setStatus(root,x.ok?`پوز «${x.posName}» مبلغ را تأیید کرد.`:`پوز پاسخ داد: ${x.message}${x.raw?" — "+x.raw:""}`,!x.ok);
    await load(root);
  }catch(e){setStatus(root,e.message,true);}
  finally{buttonEl.disabled=false;buttonEl.textContent=original;}
 }
 async function remove(root,path){if(!confirm("این رکورد مالی حذف شود؟"))return;try{await api(`/api/studies/${root.dataset.studyId}/finance/${path}`,{method:"DELETE"});await load(root);}catch(e){setStatus(root,e.message,true);}}

 // The chip in the Study header. It is the whole point of the panel being collapsed:
 // the balance is readable from the closed row.
 function paintHeaderChip(card,state){
  const host=card.querySelector(".study-header-main")||card.querySelector(".study-scroll-header");
  if(!host)return;
  let chip=host.querySelector(".study-finance-chip");
  if(!chip){
    chip=document.createElement("span");chip.className="study-finance-chip";
    // Put the chip on the first header line, next to the status badge. The summary
    // line below it takes a full row (flex 1 0 100%), so appending the chip would
    // give every collapsed Study an extra line.
    const summary=host.querySelector(".study-summary-line");
    if(summary)host.insertBefore(chip,summary);else host.appendChild(chip);
  }
  chip.classList.remove("is-due","is-settled","is-ok","is-none");
  chip.classList.add("is-"+state.kind);
  chip.textContent=state.text;
  chip.title="خلاصه مالی این مطالعه";
 }

 async function load(root){
  try{
    setStatus(root,"در حال دریافت اطلاعات مالی...");
    const x=await api(`/api/studies/${root.dataset.studyId}/finance`),s=x.summary||{};
    root.querySelector('[data-s="gross"]').textContent=money(s.grossAmount);
    root.querySelector('[data-s="discount"]').textContent=money(s.discountAmount);
    root.querySelector('[data-s="net"]').textContent=money(s.netAmount);
    root.querySelector('[data-s="received"]').textContent=money(s.receivedAmount);
    root.querySelector('[data-s="balance"]').textContent=money(s.balanceAmount);
    const state=summaryState(s);
    root.querySelector("[data-head-summary]").textContent=state.text;
    root.classList.remove("is-due","is-settled","is-ok","is-none");
    root.classList.add("is-"+state.kind);
    // ماندهٔ باز ⇒ باز شود؛ تسویه‌شده ⇒ بسته بماند (سرِ بسته هم مانده را نشان می‌دهد).
    if(!root.__userToggled)root.__setOpen?.(state.kind==="due");
    const card=root.closest(".study-scroll-card");
    if(card)paintHeaderChip(card,state);
    renderActions(root,x.actions||[]);
    renderPayments(root,x.payments||[]);
    setStatus(root,"");
  }catch(e){setStatus(root,e.message,true);}
 }

 function enhance(){
  document.querySelectorAll(".study-scroll-card").forEach(card=>{
    if(card.dataset.financeReady)return;
    card.dataset.financeReady="1";
    const root=createPanel(Number(card.dataset.studyId));
    // اقدامات از پنل مالی جدا شد: بالای تصاویر می‌نشیند (جایی که دست است) و
    // مالی همیشه آخرِ کارت می‌ماند. app.js هر دو بخش را موقع «نمایش» می‌سازد،
    // پس جای‌گذاری با هر تغییرِ فرزندانِ بدنه دوباره انجام می‌شود.
    const actions=createActionPanel(root);
    root.__actions=actions;
    const body=card.querySelector(".study-scroll-body");
    if(body){
      // ترتیب نهایی: نمودار ← اقدامات ← دریافت‌ها ← تصاویر. هر دو پنلِ پول بالای
      // تصاویر و تمام‌عرض می‌نشینند؛ تصاویر که بلند است می‌ماند آخر.
      const place=()=>{
        const imgs=body.querySelector(".study-scroll-images");
        if(imgs){if(root.parentElement!==body||root.nextElementSibling!==imgs)body.insertBefore(root,imgs);}
        else if(root.parentElement!==body||body.lastElementChild!==root)body.appendChild(root);
        const anchor=(root.parentElement===body)?root:imgs;
        if(anchor){if(actions.parentElement!==body||actions.nextElementSibling!==anchor)body.insertBefore(actions,anchor);}
        else if(actions.parentElement!==body||body.lastElementChild!==actions)body.appendChild(actions);
      };
      place();
      new MutationObserver(place).observe(body,{childList:true});
    }else{
      card.append(actions,root);
    }
    load(root);
  });
 }
 const observer=new MutationObserver(enhance);const host=document.getElementById("studiesContainer");if(host)observer.observe(host,{childList:true,subtree:true});enhance();
})();
