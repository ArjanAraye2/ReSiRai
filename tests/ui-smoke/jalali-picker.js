// Shared Persian (Jalali) date picker for ReSiRai.
//
// The picker renders a full month grid with:
//   - the Persian month name and year in the header,
//   - a today marker and a selected-day state,
//   - Friday highlighted as the weekend,
//   - quick month/year stepping plus "today"/"clear" actions,
//   - optional hour/minute inputs for date-time fields.
(() => {
 const norm=v=>String(v??"").replace(/[۰-۹]/g,d=>"۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g,d=>"٠١٢٣٤٥٦٧٨٩".indexOf(d));
 const fmt=new Intl.DateTimeFormat("en-US-u-ca-persian",{year:"numeric",month:"numeric",day:"numeric"});
 const parts=d=>{const p=fmt.formatToParts(d),g=t=>+p.find(x=>x.type===t).value;return [g("year"),g("month"),g("day")];};
 const MONTHS=["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];
 const WEEKDAYS=["ش","ی","د","س","چ","پ","ج"];
 const pad=n=>String(n).padStart(2,"0");
 function greg(jy,jm,jd){
   // Resolve a Jalali date through Intl using a deliberately wide Gregorian
   // window. This keeps the browser's Persian-calendar rules as the authority
   // and avoids the old Esfand truncation caused by too short a search window.
   const target=jy*10000+jm*100+jd;
   const start=new Date(jy+620,0,1);
   for(let i=0;i<1100;i++){
     const d=new Date(start);d.setDate(start.getDate()+i);
     const [y,m,day]=parts(d);
     if(y*10000+m*100+day===target)return d;
   }
   return null;
 }
 // Number of days in a Jalali month comes from the calendar itself rather than
 // a hard-coded 31, so Esfand is handled correctly in leap years.
 function daysInMonth(jy,jm){for(let d=31;d>=29;d--){const g=greg(jy,jm,d);if(g&&parts(g)[1]===jm&&parts(g)[0]===jy)return d;}return 30;}
 function toJalaliString(y,m,d){return `${y}/${pad(m)}/${pad(d)}`;}

 function enhance(input,withTime=false){if(!input||input.dataset.jalaliPicker)return;input.dataset.jalaliPicker="1";input.type="text";input.inputMode="numeric";input.dir="ltr";input.maxLength=withTime?16:10;
   const wrap=document.createElement("div");wrap.className="jalali-input-wrap";input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
   const b=document.createElement("button");b.type="button";b.className="jalali-calendar-button";b.title="انتخاب از تقویم شمسی";b.setAttribute("aria-label","انتخاب از تقویم شمسی");
   b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M7.5 14h2"/><path d="M14.5 14h2"/><path d="M7.5 17.5h2"/><path d="M14.5 17.5h2"/></svg>';
   wrap.appendChild(b);
   const day=document.createElement("div");day.className="jalali-weekday-name";
   day.setAttribute("aria-live","polite");
   wrap.insertAdjacentElement("afterend",day);
   const updateDay=()=>{const m=norm(input.value).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);if(!m){day.textContent="";return;}const d=greg(+m[1],+m[2],+m[3]);day.textContent=d?new Intl.DateTimeFormat("fa-IR",{weekday:"long"}).format(d):"";};
   input.addEventListener("input",updateDay);input.addEventListener("change",updateDay);
   // Setting .value from code (the app fills the Study default date and the edit
   // forms this way) does not fire an input event, which used to leave this label
   // empty. Wrapping the value setter keeps the label in sync without changing
   // any call site.
   const valueDescriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
   Object.defineProperty(input,"value",{
     configurable:true,
     get(){return valueDescriptor.get.call(this);},
     set(v){valueDescriptor.set.call(this,v);updateDay();}
   });
   updateDay();
   b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();open(input,withTime);});
 }

 function open(input,withTime){
   document.getElementById("jalaliPickerModal")?.remove();
   const today=parts(new Date());
   const parsed=norm(input.value).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
   let y=parsed?+parsed[1]:today[0], mo=parsed?+parsed[2]:today[1];
   const selected=parsed?{y:+parsed[1],m:+parsed[2],d:+parsed[3]}:null;
   const time={h:parsed&&parsed[4]!==undefined?+parsed[4]:new Date().getHours(),mi:parsed&&parsed[5]!==undefined?+parsed[5]:new Date().getMinutes()};

   const modal=document.createElement("div");modal.id="jalaliPickerModal";modal.className="jalali-picker-overlay";
   modal.innerHTML='<div class="jalali-picker-dialog" role="dialog" aria-modal="true" aria-label="انتخاب تاریخ شمسی"></div>';
   document.body.appendChild(modal);
   const box=modal.firstElementChild;

   const commit=(yy,mm,dd)=>{
     let value=toJalaliString(yy,mm,dd);
     if(withTime)value+=" "+pad(time.h)+":"+pad(time.mi);
     input.value=value;
     modal.remove();
     input.dispatchEvent(new Event("input",{bubbles:true}));
     input.dispatchEvent(new Event("change",{bubbles:true}));
   };

   const draw=()=>{
     box.replaceChildren();

     // --- header: month name + year, with month and year steppers ---------
     const head=document.createElement("div");head.className="jalali-picker-header";
     const yPrev=document.createElement("button");yPrev.type="button";yPrev.className="jalali-nav-year";yPrev.textContent="«";yPrev.title="سال قبل";yPrev.setAttribute("aria-label","سال قبل");
     const mPrev=document.createElement("button");mPrev.type="button";mPrev.className="jalali-nav";mPrev.textContent="‹";mPrev.title="ماه قبل";mPrev.setAttribute("aria-label","ماه قبل");
     const title=document.createElement("strong");title.className="jalali-picker-title";
     const monthName=document.createElement("span");monthName.textContent=MONTHS[mo-1];
     const yearText=document.createElement("select");yearText.className="jalali-picker-year";yearText.setAttribute("aria-label","سال");for(let yy=today[0]+1;yy>=today[0]-120;yy--){const o=document.createElement("option");o.value=String(yy);o.textContent=String(yy);if(yy===y)o.selected=true;yearText.appendChild(o);}yearText.addEventListener("change",()=>{y=Number(yearText.value)||y;draw();});
     title.append(monthName,yearText);
     const mNext=document.createElement("button");mNext.type="button";mNext.className="jalali-nav";mNext.textContent="›";mNext.title="ماه بعد";mNext.setAttribute("aria-label","ماه بعد");
     const yNext=document.createElement("button");yNext.type="button";yNext.className="jalali-nav-year";yNext.textContent="»";yNext.title="سال بعد";yNext.setAttribute("aria-label","سال بعد");
     head.append(yPrev,mPrev,title,mNext,yNext);
     box.appendChild(head);

     // --- weekday row -----------------------------------------------------
     const names=document.createElement("div");names.className="jalali-picker-weekdays";
     WEEKDAYS.forEach((n,i)=>{const x=document.createElement("span");x.textContent=n;if(i===6)x.classList.add("is-weekend");names.appendChild(x);});
     box.appendChild(names);

     // --- day grid --------------------------------------------------------
     const grid=document.createElement("div");grid.className="jalali-picker-grid";grid.setAttribute("role","grid");
     const first=greg(y,mo,1);
     const offset=first?(first.getDay()+1)%7:0;   // Persian week starts on Saturday
     for(let i=0;i<offset;i++){const padCell=document.createElement("span");padCell.className="jalali-pad";grid.appendChild(padCell);}
     const total=daysInMonth(y,mo);
     for(let d=1;d<=total;d++){
       const gd=greg(y,mo,d);
       const bt=document.createElement("button");bt.type="button";bt.textContent=String(d);
       // Friday is the weekly holiday in Iran.
       const isFriday=gd?gd.getDay()===5:false;
       if(isFriday)bt.classList.add("is-weekend");
       if(today[0]===y&&today[1]===mo&&today[2]===d)bt.classList.add("is-today");
       if(selected&&selected.y===y&&selected.m===mo&&selected.d===d)bt.classList.add("is-selected");
       bt.setAttribute("aria-label",`${d} ${MONTHS[mo-1]} ${y}`);
       bt.onclick=()=>commit(y,mo,d);
       grid.appendChild(bt);
     }
     box.appendChild(grid);

     // --- optional time row ----------------------------------------------
     if(withTime){
       const timeRow=document.createElement("div");timeRow.className="jalali-picker-time";
       const label=document.createElement("span");label.textContent="ساعت";
       const hh=document.createElement("input");hh.type="number";hh.min=0;hh.max=23;hh.value=pad(time.h);hh.setAttribute("aria-label","ساعت");
       const sep=document.createElement("span");sep.textContent=":";
       const mm=document.createElement("input");mm.type="number";mm.min=0;mm.max=59;mm.value=pad(time.mi);mm.setAttribute("aria-label","دقیقه");
       const clamp=(el,max,key)=>{el.addEventListener("input",()=>{let v=Math.max(0,Math.min(max,Number(norm(el.value))||0));time[key]=v;});el.addEventListener("blur",()=>{el.value=pad(time[key]);});};
       clamp(hh,23,"h");clamp(mm,59,"mi");
       timeRow.append(label,hh,sep,mm);
       box.appendChild(timeRow);
     }

     // --- footer ----------------------------------------------------------
     const foot=document.createElement("div");foot.className="jalali-picker-footer";
     const clear=document.createElement("button");clear.type="button";clear.className="jalali-clear";clear.textContent="پاک کردن";
     clear.onclick=()=>{input.value="";modal.remove();input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));};
     const todayBtn=document.createElement("button");todayBtn.type="button";todayBtn.className="jalali-today";todayBtn.textContent="امروز";
     todayBtn.onclick=()=>commit(today[0],today[1],today[2]);
     const close=document.createElement("button");close.type="button";close.className="jalali-cancel";close.textContent="انصراف";
     close.onclick=()=>modal.remove();
     foot.append(clear,close,todayBtn);
     box.appendChild(foot);

     yPrev.onclick=()=>{y--;draw();};
     yNext.onclick=()=>{y++;draw();};
     mPrev.onclick=()=>{if(--mo<1){mo=12;y--;}draw();};
     mNext.onclick=()=>{if(++mo>12){mo=1;y++;}draw();};
   };
   draw();

   modal.addEventListener("click",e=>{if(e.target===modal)modal.remove();});
   document.addEventListener("keydown",function esc(e){
     if(e.key==="Escape"){modal.remove();document.removeEventListener("keydown",esc);}
   });
   // Focus the grid so keyboard users can move with Tab immediately.
   box.querySelector(".jalali-picker-grid button")?.focus();
 }

 window.ReSiRaiJalali={enhance,enhanceAll(root=document){if(root.matches?.("[data-jalali-date]"))enhance(root,false);else if(root.matches?.("[data-jalali-datetime]"))enhance(root,true);root.querySelectorAll?.("[data-jalali-date]").forEach(x=>enhance(x,false));root.querySelectorAll?.("[data-jalali-datetime]").forEach(x=>enhance(x,true));}};
 const run=()=>window.ReSiRaiJalali.enhanceAll();if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);else run();
 // Dynamic admin forms explicitly call enhanceAll after rendering. A global DOM
 // observer is intentionally avoided because enhancing a date input wraps/moves
 // that same input, which can retrigger DOM observation and freeze the UI.
})();
