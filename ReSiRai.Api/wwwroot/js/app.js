// ReSiRai Frontend
// Patient/Study forms plus patient-owned radiology image workflow.

function byId(id) { return document.getElementById(id); }
let selectedPatientID=null, selectedPatient=null, selectedStudyID=null, selectedStudy=null;
// A fast second click must cancel/obsolete the first patient request. Otherwise a
// slower response for the previous row can overwrite the newly selected patient.
let patientOpenRequestVersion=0,patientOpenAbortController=null;
function beginPatientOpenRequest(){patientOpenAbortController?.abort();patientOpenAbortController=new AbortController();return{version:++patientOpenRequestVersion,signal:patientOpenAbortController.signal};}
function isCurrentPatientOpenRequest(version,id){return version===patientOpenRequestVersion&&Number(selectedPatientID)===Number(id);}
function showPatientLoadingState(){selectedPatient=null;publishSelectedPatient(null);selectedStudyID=null;selectedStudy=null;E.patientFullName.textContent="در حال دریافت پرونده...";E.patientDisplayCode.textContent="";E.patientNationalCode.textContent="";E.studiesContainer.textContent="در حال دریافت اطلاعات...";E.recentStudiesSummary.replaceChildren();E.studyCount.textContent="—";E.totalImageCount.textContent="—";E.lastStudyDateSummary.textContent="—";if(E.patientProfilePhoto){E.patientProfilePhoto.onerror=null;E.patientProfilePhoto.removeAttribute("src");E.patientProfilePhoto.classList.add("empty");}}
let pendingCameraFile=null, cameraPreviewUrl=null;
// Lookups used by the study panel. Fetched once and reused; the doctor list is
// needed to suggest a waiting stage from the doctor's specialty.
let doctorsCache=null, waitStagesCache=null;
let studyDetailsSaveInProgress=false;
// فرمِ واحدِ مراجعه دو حالت دارد: «new» (ثبتِ مراجعهٔ تازه، بدون StudyID) و
// «view»/«edit» (مراجعهٔ موجود). کلاسِ study-mode-new رویِ بخش، حالت را برای CSS
// (دکمه‌های تصویر، فیلدِ اسکنِ کارت) هم اعلام می‌کند.
let studyFormMode="view";
// فازِ پزشکِ عمومی: نمودارِ دندان در کارتِ مراجعه دیده نشود. فیلدهایِ دندانی
// «تعلیق» است — کد پابرجاست؛ برایِ برگرداندن فقط کافی است true شود.
// مرجعِ تصمیم: docs/visit-fields.md (بخشِ ⏸ تعلیق).
const SHOW_TEETH_CHART=false;
function setStudyFormMode(mode){studyFormMode=mode;E.studyDetailsSection?.classList.toggle("study-mode-new",mode==="new");E.studyDetailsWorkEndButton?.classList.toggle("hidden",mode==="new");}

const ids=["openStudiesOnly","dueFollowUpOnly","statPatientsWithOpenStudies","studyDetailsStatus2","studyDetailsWaitBox","studyDetailsWaitStage","studyDetailsFollowUpBox","studyDetailsFollowUpDate","studyDetailsFollowUpNote","studyDetailsDoctor","studyDetailsStatusBadge","patientsSection","patientStatistics","statTotalPatients","statActivePatients","statInactivePatients","statPatientsWithStudies","patientSearch","searchButton","clearSearchButton","includeInactivePatients","newPatientButton","patientsTableBody","statusMessage","patientDetailsSection","studyDetailsSection","studyImagesSection","backToPatientDetailsButton","backToStudyDetailsButton","studyDetailsTitle","studyDetailsDate","studyCreateActions","newStudySubmitButton","studyDetailsTeethChart","studyDetailsUploadButton","studyDetailsEditButton","studyDetailsImagesButton","studyDetailsSaveButton","studyDetailsCancelButton","studyImagesTitle","studyDetailsImagesStatus","studyDetailsImagesGrid","backToPatientsButton","editPatientButton","newStudyButton","printPatientButton","mergePatientButton","deactivatePatientButton","patientFullName","patientDisplayCode","patientNationalCode","patientStatusBadge","patientProfilePhoto","patientPhotoInput","patientPhotoButton","detailPatientCode","detailFirstName","detailLastName","detailNationalCode","detailMobile","detailBirthDate","detailGender","detailIsActive","detailAddress","detailDescription","studyCount","totalImageCount","studiesContainer","newPatientSection","newPatientForm","cancelNewPatientButton","cancelNewPatientButtonBottom","newFirstName","newLastName","newNationalCode","newMobile","newBirthDate","newGender","newAddress","newDescription","newPatientStatus","editPatientSection","editPatientForm","cancelEditPatientButton","cancelEditPatientButtonBottom","editFirstName","editLastName","editNationalCode","editMobile","editBirthDate","editGender","editAddress","editDescription","editPatientStatus","newStudyForm","cancelNewStudyButtonBottom","newStudyType","newBodyPart","newStudyDate","newStudyDescription","newStudyDiagnosis","studyDetailsWorkEndDate","studyDetailsWorkEndButton","uploadImageSection","uploadImageForm","cancelUploadImageButton","cancelUploadImageButtonBottom","uploadImageStudyInfo","uploadImageType","imageFileInput","cameraFileInput","cameraPreviewPanel","cameraPreviewImage","confirmCameraButton","retakeCameraButton","uploadImageStatus","mergePatientSection","mergePatientForm","cancelMergePatientButton","cancelMergePatientButtonBottom","mergeTargetNationalCode","mergePatientStatus","imageModal","closeImageModalButton","zoomOutImageButton","zoomInImageButton","rotateLeftImageButton","rotateRightImageButton","flipHorizontalImageButton","resetImageViewButton","largeImage","largeImageCaption","confirmModal","confirmTitle","confirmMessage","confirmYesButton","confirmNoButton","toastContainer"];
const E={}; ids.forEach(id=>E[id]=byId(id));
E.lastStudyDateSummary=byId("lastStudyDateSummary");
E.recentStudiesSummary=byId("recentStudiesSummary");
// فیلدهای «اطلاعات تکمیلی» بیمار (کشو و ورودی) — به‌صورت صریح به E اضافه می‌شوند
// چون فهرست ids فقط شناسه‌های موجود در نسخه‌های قدیمی را پوشش می‌دهد.
["newPatientExtraDetails","editPatientExtraDetails","newBloodType","editBloodType","newMobile2","editMobile2","newFileNumber","editFileNumber","newContactPreference","editContactPreference","newEmergencyContactName","editEmergencyContactName","newEmergencyContactRelation","editEmergencyContactRelation","newEmergencyContactPhone","editEmergencyContactPhone","newBaseInsuranceType","editBaseInsuranceType","newBaseInsuranceNo","editBaseInsuranceNo","newSupp1InsuranceType","editSupp1InsuranceType","newSupp1InsuranceNo","editSupp1InsuranceNo","newSupp2InsuranceType","editSupp2InsuranceType","newSupp2InsuranceNo","editSupp2InsuranceNo","detailBloodType","detailMobile2","detailBaseInsurance","detailSuppInsurance","detailEmergencyContact","detailFileNumber","detailContactPreference","detailPregnancyStatus","detailAge","deletePatientButton"].forEach(id=>E[id]=byId(id));
// اجزایِ باکسِ autocompleteِ «نوعِ مراجعه» (index.html + study-type-ui.js).
["newStudyTypeList","newStudyTypeID","newStudyTypeHint","studyTypeOtherBox","studyTypeNote"].forEach(id=>E[id]=byId(id));

function hideMainSections(){[E.patientsSection,E.patientDetailsSection,E.studyDetailsSection,E.studyImagesSection].forEach(x=>x?.classList.add("hidden"));E.newPatientSection?.classList.add("hidden");E.editPatientSection?.classList.add("hidden");}
function showPatientsScreen(){hideMainSections();E.patientsSection.classList.remove("hidden");window.ReSiRaiPatientDraft&&window.ReSiRaiPatientDraft.mount();window.scrollTo(0,0);}
function showToast(message,type="success",title=""){const t=document.createElement("div");t.className=`toast ${type}`;t.innerHTML=`<div class="toast-title"></div><div class="toast-message"></div>`;t.children[0].textContent=title||(type==="success"?"انجام شد":type==="error"?"خطا":"توجه");t.children[1].textContent=message;E.toastContainer.appendChild(t);setTimeout(()=>t.remove(),4300);}
function askConfirmation({title="تأیید عملیات",message,confirmText="تأیید",danger=true}){return new Promise(resolve=>{E.confirmTitle.textContent=title;E.confirmMessage.textContent=message;E.confirmYesButton.textContent=confirmText;E.confirmYesButton.classList.toggle("danger-button",danger);E.confirmModal.classList.remove("hidden");const done=v=>{E.confirmModal.classList.add("hidden");E.confirmYesButton.onclick=E.confirmNoButton.onclick=null;resolve(v);};E.confirmYesButton.onclick=()=>done(true);E.confirmNoButton.onclick=()=>done(false);});}
function getApiError(r,f){const m=r?.message||r?.messageEn||r?.error;if(!m)return f;const translations={"A patient with this NationalCode already exists.":"بیماری با این کد ملی قبلاً ثبت شده است.","NationalCode must contain only digits.":"کد ملی فقط باید شامل عدد باشد.","PatientID must be greater than zero.":"شناسه بیمار معتبر نیست.","Patient not found.":"بیمار پیدا نشد.","StudyType is required.":"دلیل مراجعه را وارد کنید.","StudyType cannot be longer than 50 characters.":"دلیل مراجعه نمی‌تواند بیشتر از ۵۰ نویسه باشد.","BodyPart cannot be longer than 100 characters.":"ناحیه نمی‌تواند بیشتر از ۱۰۰ نویسه باشد.","Description cannot be longer than 1000 characters.":"توضیحات نمی‌تواند بیشتر از ۱۰۰۰ نویسه باشد.","Study creation failed.":"ثبت مراجعه انجام نشد.","StudyDate is required.":"تاریخ مراجعه الزامی است.","Study not found.":"مراجعه پیدا نشد."};return translations[m]||m;}
// A 401 from the API has an EMPTY body, so a plain r.json() throws the cryptic
// "JSON.parse: unexpected character at line 1 column 1" and the user sees a
// technical English error instead of a Persian one. Read the body safely: an
// unparsable or missing body becomes {}, and the HTTP status decides the message.
// A 401/403 without a body always means the login session is gone, and a session
// that ends while the page is open should tell the user to log in again rather
// than look like a broken patient form.
async function readApiJson(r){let x={};try{x=await r.json();}catch{x={};}return x;}
function apiErrorMessage(r,x,fallback){if(r.status===401||r.status===403){const m=x?.message||x?.messageEn||x?.error;if(m)return getApiError(x,fallback);return"نشست ورود شما پایان یافته است. لطفاً از سیستم خارج شده و دوباره وارد شوید.";}return getApiError(x,fallback);}
function setFormStatus(el,msg,error){if(!el)return;el.textContent=msg;el.classList.toggle("error",!!error);}
function normalizeDigits(v){const p="۰۱۲۳۴۵۶۷۸۹",a="٠١٢٣٤٥٦٧٨٩";return String(v??"").replace(/[۰-۹]/g,d=>p.indexOf(d)).replace(/[٠-٩]/g,d=>a.indexOf(d));}
function normalizePhone(v){const s=normalizeDigits(v).replace(/\s+/g,"").trim();return s||null;}
function emptyToNull(v){const s=v.trim();return s||null;}
function createCell(v){const td=document.createElement("td");td.textContent=v??"";return td;}
function createInfoLine(l,v){const d=document.createElement("div"),b=document.createElement("strong"),s=document.createElement("span");b.textContent=`${l}: `;s.textContent=v;d.append(b,s);return d;}
function formatPersianDate(v){if(!v)return "-";try{return new Intl.DateTimeFormat("fa-IR-u-ca-persian",{year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(v));}catch{return v;}}
function formatPersianDateTime(v){if(!v)return "-";try{return new Intl.DateTimeFormat("fa-IR-u-ca-persian",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(v));}catch{return v;}}
// Design D shows a friendly code (P-001), while PatientID remains the real database key.
function formatPatientCode(patientID){const id=Number(patientID);return Number.isInteger(id)&&id>0?`P-${String(id).padStart(3,"0")}`:"-";}
function formatPatientGender(gender){const value=Number(gender);if(value===1)return "مرد";if(value===2)return "زن";return "-";}
 // ترجیح اطلاع‌رسانی فقط در پرونده نمایش داده می‌شود؛ منطقِ ارسال (پیامک/تماس) فازِ بعد است.
 function contactPreferenceLabel(pref){if(pref==="sms")return "پیامک";if(pref==="call")return "تماس تلفنی";if(pref==="none")return "بدون اطلاع‌رسانی";return "-";}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[char]);}
function formatJalaliDateInput(value){const d=normalizeDigits(value).replace(/\D/g,"").slice(0,8);if(d.length<=4)return d;if(d.length<=6)return `${d.slice(0,4)}/${d.slice(4)}`;return `${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6)}`;}
function enableJalaliDateMask(input){input?.addEventListener("input",()=>{input.value=formatJalaliDateInput(input.value);});}
// Study date/time mask: user types digits; ReSiRai inserts /, space and : automatically.
function formatJalaliDateTimeInput(value){const d=normalizeDigits(value).replace(/\D/g,"").slice(0,12);if(d.length<=4)return d;if(d.length<=6)return `${d.slice(0,4)}/${d.slice(4)}`;if(d.length<=8)return `${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6)}`;if(d.length<=10)return `${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6,8)} ${d.slice(8)}`;return `${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6,8)} ${d.slice(8,10)}:${d.slice(10)}`;}
function enableJalaliDateTimeMask(input){input?.addEventListener("input",()=>{input.value=formatJalaliDateTimeInput(input.value);});}
function toEnglishJalaliInput(date=new Date(),withTime=false){const parts=new Intl.DateTimeFormat("en-US-u-ca-persian",{year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);const val=t=>parts.find(x=>x.type===t)?.value;let r=`${val("year")}/${val("month")}/${val("day")}`;if(withTime)r+=` ${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;return r;}
function parsePersianDateForBackend(value,includeTime){const s=normalizeDigits(value).trim();if(!s)return null;const m=s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?$/);if(!m)throw new Error("فرمت تاریخ شمسی معتبر نیست.");const jy=+m[1],jm=+m[2],jd=+m[3],hh=+(m[4]||0),mm=+(m[5]||0);if(jm<1||jm>12||jd<1||jd>31||hh>23||mm>59)throw new Error("تاریخ یا ساعت معتبر نیست.");const target=`${jy}-${String(jm).padStart(2,"0")}-${String(jd).padStart(2,"0")}`;let start=new Date(jy+621,2,1);for(let i=0;i<370;i++){const d=new Date(start);d.setDate(start.getDate()+i);const p=new Intl.DateTimeFormat("en-US-u-ca-persian",{year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);const get=t=>p.find(x=>x.type===t)?.value;if(`${get("year")}-${get("month")}-${get("day")}`===target){const y=d.getFullYear(),mo=String(d.getMonth()+1).padStart(2,"0"),da=String(d.getDate()).padStart(2,"0");return includeTime?`${y}-${mo}-${da}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00`:`${y}-${mo}-${da}`;}}throw new Error("تاریخ شمسی خارج از محدوده معتبر است.");}
function formatPersianDateForInput(v){return v?toEnglishJalaliInput(new Date(v),false):"";}
function formatPersianDateTimeForInput(v){return v?toEnglishJalaliInput(new Date(v),true):"";}
// Shared by dynamically-created forms such as Staff management.
window.toEnglishJalaliInput=toEnglishJalaliInput;
window.parsePersianDateForBackend=parsePersianDateForBackend;
window.formatPersianDateForInput=formatPersianDateForInput;
window.formatPersianDateTimeForInput=formatPersianDateTimeForInput;
// Navigation's global search opens a patient record directly.
window.openPatientInline=openPatientInline;
// The dashboard reuses the application image viewer instead of opening a bare URL.
window.openLargeImage=openLargeImage;
function validatePatientFields(f,l,n,m,g){if(!f)throw new Error("نام بیمار را وارد کنید.");if(!l)throw new Error("نام خانوادگی بیمار را وارد کنید.");if(!/^\d{10}$/.test(n))throw new Error("کد ملی باید دقیقاً ۱۰ رقم باشد.");if(m&&!/^\+?\d+$/.test(m))throw new Error("شماره موبایل معتبر نیست.");if(g===""||g===null||g===undefined)throw new Error("جنسیت را انتخاب کنید.");}

function createPatientIdentityCell(patient){
 const td=document.createElement("td");td.className="patient-identity-cell";
 const avatar=document.createElement("span");avatar.className="patient-row-avatar";
 const img=document.createElement("img");img.alt=`تصویر ${patient.firstName||""} ${patient.lastName||""}`;img.loading="lazy";img.src=`/api/patients/${patient.patientID}/photo`;
 img.onerror=()=>{img.remove();avatar.classList.add("patient-row-avatar-empty");avatar.textContent="👤";};
 avatar.appendChild(img);
 const text=document.createElement("span");text.className="patient-row-name";
 const name=document.createElement("strong");name.textContent=`${patient.firstName||""} ${patient.lastName||""}`.trim()||"-";
 const meta=document.createElement("small");meta.textContent=patientAgeText(patient.birthDate);
 text.append(name,meta);td.append(avatar,text);return td;
}
// سن از تاریخ تولد محاسبه می‌شود؛ اگر تاریخ نباشد، کد پرونده نمایش داده می‌شود.
function patientAgeText(birthDate){
 if(!birthDate)return "";
 // تاریخ تولد در پرونده رشتهٔ شمسی است (۱۳۷۰-۰۳-۱۵)؛ سال شمسی باید به میلادی
 // برگردد وگرنه سن به сот‌ها سال محاسبه می‌شود. فقط سال کافی است (±۱ سال).
 try{
  const s=String(birthDate);const m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let b;if(m&&+m[1]>1200&&+m[1]<1600){b=new Date(Date.UTC(+m[1]+621,+m[2]-1,+m[3]));}
  else{b=new Date(s);}
  if(isNaN(b.getTime()))return "";
  let age=Math.floor((Date.now()-b.getTime())/(365.25*24*3600*1000));
  if(age<0)return "";let extra="";if(age<2){const months=Math.floor((Date.now()-b.getTime())/(30.44*24*3600*1000));extra=`${months} ماهه`;}return extra?`${extra}`:`${age} ساله`;}catch{return "";}
}
// «۳ روز پیش» با فارسی‌سازی؛ صریح‌تر از تاریخ خالی برای نگاه سریع پذیرش.
function relativeDayText(value){
 if(!value)return "-";
 const d=new Date(value);if(isNaN(d.getTime()))return formatPersianDate(value);
 const days=Math.floor((Date.now()-d.getTime())/(24*3600*1000));
 if(days<=0)return "امروز";
 if(days===1)return "دیروز";
 if(days<30)return `${days.toLocaleString("fa-IR")} روز پیش`;
 if(days<365)return `${Math.floor(days/30).toLocaleString("fa-IR")} ماه پیش`;
 return `${Math.floor(days/365).toLocaleString("fa-IR")} سال پیش`;
}
// سلول تماس: موبایل درشت و کد ملی ریز زیرش.
function createPatientContactCell(p){
 const td=document.createElement("td");td.className="patient-contact-cell";
 const m=document.createElement("span");m.textContent=p.mobile||"—";td.appendChild(m);
 const n=document.createElement("small");n.textContent=p.nationalCode||"";td.appendChild(n);return td;
}
// سلول مراجعات: تعداد کل + بجِ باز.
function createStudyCountCell(total,open){
 const td=document.createElement("td");td.className="patient-studies-cell";
 const t=document.createElement("strong");t.textContent=String(Number(total||0));td.appendChild(t);
 const o=Number(open||0);
 if(o>0){const badge=document.createElement("span");badge.className="study-count-open";badge.textContent=`${o} باز`;badge.title=`${o} مطالعه باز`;td.appendChild(badge);}
 return [td];
}
function createPatientStatusCell(patient){
 const td=document.createElement("td"),badge=document.createElement("span");
 badge.className=`status-badge ${patient.isActive?"active":"inactive"}`;badge.textContent=patient.isActive?"فعال":"غیرفعال";td.appendChild(badge);return td;
}
// وضعیت فهرست بیماران: صفحه، سورت و جستجوی زنده — بین فراخوانی‌ها حفظ می‌شود.
const patientListState={offset:0,sortBy:"",sortDir:"asc",searchToken:0};
async function loadPatients(search="",{append=false}={}){
 try{
  if(!append)setFormStatus(E.statusMessage,"در حال دریافت اطلاعات...",false);
  const q=new URLSearchParams();if(search.trim())q.set("search",search.trim());q.set("includeInactive",E.includeInactivePatients.checked);
  // Reminder filters: patients with work outstanding, and follow-ups that are due.
  if(E.openStudiesOnly?.checked)q.set("openOnly","true");
  if(E.dueFollowUpOnly?.checked)q.set("dueOnly","true");
  if(patientListState.sortBy){q.set("sortBy",patientListState.sortBy);q.set("sortDir",patientListState.sortDir);}
  // «بیشتر»: صفحهٔ بعد از offsetِ قبلی ادامه می‌دهد؛ هر فراخوانیِ تازه از صفر می‌آید.
  if(append)q.set("offset",String(patientListState.offset));
  else patientListState.offset=0;
  const myToken=++patientListState.searchToken;
  const r=await fetch(`/api/patients?${q}`),x=await readApiJson(r);if(!r.ok)throw new Error(apiErrorMessage(r,x,"خطا در دریافت بیماران."));
  if(myToken!==patientListState.searchToken)return; // پاسخِ یک درخواست قدیمی؛ نادیده.
  const s=x.statistics||{};E.statTotalPatients.textContent=s.totalPatients??0;E.statActivePatients.textContent=s.activePatients??0;E.statInactivePatients.textContent=s.inactivePatients??0;E.statPatientsWithStudies.textContent=s.patientsWithStudies??0;E.statPatientsWithOpenStudies.textContent=s.patientsWithOpenStudies??0;
  if(!append)E.patientsTableBody.replaceChildren();
  document.getElementById("patientsLoadMoreBox")?.remove();
  (x.patients||x||[]).forEach(p=>{
   const tr=document.createElement("tr");tr.tabIndex=0;tr.className="patient-list-row";tr.title="نمایش پرونده و مطالعات بیمار";tr.dataset.patientId=String(p.patientID);;
   const insurance = p.baseInsuranceName ? p.baseInsuranceName : (p.baseInsuranceTypeID ? "دارد" : "—");
   const insCell=createCell(insurance);
   const followCell=document.createElement("td");
   if(Number(p.dueFollowUpCount||0)>0){followCell.innerHTML='<span class="followup-due-badge">سررسیده</span>';}
   else { followCell.textContent = p.nextFollowUpDate ? formatPersianDate(p.nextFollowUpDate) : "—"; }
   tr.append(
    createPatientIdentityCell(p),
    createPatientContactCell(p),
    insCell,
    ...createStudyCountCell(p.studyCount,p.openStudyCount),
    createCell(p.lastStudyDate ? `${formatPersianDate(p.lastStudyDate)} — ${relativeDayText(p.lastStudyDate)}` : "—"),
    followCell,
    createPatientStatusCell(p)
   );
   const td=document.createElement("td");td.className="patient-row-actions";
   const open=document.createElement("button");open.type="button";open.className="patient-open-button secondary-button";open.textContent="پرونده";
   const edit=document.createElement("button");edit.type="button";edit.className="patient-edit-button secondary-button";edit.textContent="ویرایش";
   edit.addEventListener("click",async e=>{e.stopPropagation();try{if(await openPatientInline(p.patientID,tr))openEditPatientForm();}catch(err){showToast(err.message||"پرونده بیمار دریافت نشد.","error");}});
   open.addEventListener("click",async e=>{e.stopPropagation();try{await openPatientInline(p.patientID,tr);}catch(err){showToast(err.message||"پرونده بیمار دریافت نشد.","error");}});
   td.append(open,edit);tr.appendChild(td);
   const select=async()=>{try{await openPatientInline(p.patientID,tr);}catch(e){showToast(e.message||"پرونده بیمار دریافت نشد.","error");}};
   tr.onclick=e=>{if(e.target.closest("button"))return;select();};tr.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();select();}};
   E.patientsTableBody.appendChild(tr);
  });
  patientListState.offset=(x.offset||0)+(x.count||0);
  // سقفِ پنهانِ ۱۰۰ تایی دیگر پنهان نیست: شمارِ کل و دکمهٔ «بیشتر».
  const total=x.totalCount??(x.patients||[]).length;
  if(x.hasMore){
   const box=document.createElement("div");box.id="patientsLoadMoreBox";box.className="patients-load-more";
   const more=document.createElement("button");more.type="button";more.className="secondary-button";
   more.textContent=`نمایش بیشتر (${(total-patientListState.offset).toLocaleString("fa-IR")} بیمار دیگر — کل ${(total).toLocaleString("fa-IR")})`;
   more.addEventListener("click",()=>loadPatients(search,{append:true}));
   box.appendChild(more);
   E.patientsTableBody.parentElement.appendChild(box);
  }
  if(!append)setFormStatus(E.statusMessage,total>0?`${total.toLocaleString("fa-IR")} بیمار در فهرست`:"",false);
 }catch(e){if(!append)setFormStatus(E.statusMessage,e.message,true);}
}
async function deletePatient(patient){
 const fullName=`${patient.firstName||""} ${patient.lastName||""}`.trim();
 if(!await askConfirmation({title:"حذف دائمی بیمار",message:`آیا بیمار «${fullName}» برای همیشه حذف شود؟ این عملیات قابل بازگشت نیست.`,confirmText:"حذف بیمار"}))return;
 try{const r=await fetch(`/api/patients/${patient.patientID}`,{method:"DELETE"});let x={};try{x=await r.json();}catch{}if(!r.ok||!x.success)throw new Error(getApiError(x,"حذف بیمار انجام نشد."));
  showPatientsScreen();
  if(selectedPatientID===patient.patientID){selectedPatientID=null;selectedPatient=null;selectedStudyID=null;selectedStudy=null;}
  await loadPatients(E.patientSearch.value);showToast("بیمار با موفقیت حذف شد.","success");
 }catch(e){showToast(e.message||"حذف بیمار انجام نشد.","error");}
}
async function openPatientInline(id,row){
 selectedPatientID=id;
 const request=beginPatientOpenRequest();
 document.querySelectorAll(".patient-list-row.selected").forEach(x=>x.classList.remove("selected"));
 row?.classList.add("selected");
 E.patientDetailsSection.classList.remove("hidden");
 showPatientLoadingState();
 try{
  const r=await fetch(`/api/patients/${id}/details`,{cache:"no-store",signal:request.signal});let x={};try{x=await r.json();}catch{}
  if(!isCurrentPatientOpenRequest(request.version,id))return false;
  if(!r.ok||!x.success)throw new Error(getApiError(x,`پرونده بیمار دریافت نشد. (HTTP ${r.status})`));
  selectedPatient=x.patient;publishSelectedPatient(x.patient);renderPatientDetails(x);
  E.patientDetailsSection.scrollIntoView({behavior:"smooth",block:"start"});
  return true;
 }catch(err){
  if(err?.name==="AbortError"||!isCurrentPatientOpenRequest(request.version,id))return false;
  console.error("Patient inline record error:",err);E.patientFullName.textContent="خطا در دریافت پرونده";
  E.studiesContainer.textContent=err.message||"پرونده بیمار دریافت نشد.";throw err;
 }
}
async function openPatient(id){selectedPatientID=id;const request=beginPatientOpenRequest();hideMainSections();E.patientDetailsSection.classList.remove("hidden");showPatientLoadingState();window.scrollTo(0,0);try{const r=await fetch(`/api/patients/${id}/details`,{cache:"no-store",signal:request.signal});let x={};try{x=await r.json();}catch{}if(!isCurrentPatientOpenRequest(request.version,id))return false;if(!r.ok||!x.success)throw new Error(getApiError(x,`پرونده بیمار دریافت نشد. (HTTP ${r.status})`));selectedPatient=x.patient;publishSelectedPatient(x.patient);renderPatientDetails(x);return true;}catch(err){if(err?.name==="AbortError"||!isCurrentPatientOpenRequest(request.version,id))return false;console.error("Patient record error:",err);E.patientFullName.textContent="خطا در دریافت پرونده";E.studiesContainer.textContent=err.message||"پرونده بیمار دریافت نشد.";showToast(err.message||"پرونده بیمار دریافت نشد.","error");return false;}}
// Other modules (patient messaging, printing helpers) need the open patient.
// Publishing it here keeps one source of truth: whenever the record renders,
// window.selectedPatient matches what is on screen.
function publishSelectedPatient(p){window.selectedPatient=p||null;window.selectedPatientID=Number(p?.patientID)||null;try{selectedPatient=p||null;if(p)selectedPatientID=Number(p.patientID);}catch{}window.openPatient=openPatient;window.openPatientInline=openPatientInline;}
function renderPatientDetails(x){const p=x.patient,patientCode=formatPatientCode(p.patientID),studies=x.studies||[];E.patientFullName.textContent=`${p.firstName} ${p.lastName}`;E.patientDisplayCode.textContent=`شناسه پرونده: ${patientCode}`;E.patientNationalCode.textContent=`کد ملی: ${p.nationalCode}`;E.detailPatientCode.textContent=patientCode;E.detailFirstName.textContent=p.firstName||"-";E.detailLastName.textContent=p.lastName||"-";E.detailNationalCode.textContent=p.nationalCode||"-";E.detailMobile.textContent=p.mobile||"-";E.detailBirthDate.textContent=formatPersianDate(p.birthDate);if(E.detailAge)E.detailAge.textContent=patientAgeText(p.birthDate);E.detailGender.textContent=formatPatientGender(p.gender);E.detailIsActive.textContent=p.isActive?"فعال":"غیرفعال";E.detailAddress.textContent=p.address||"-";E.detailDescription.textContent=p.description||"-";if(E.detailBloodType)E.detailBloodType.textContent=p.bloodType||"ثبت نشده";if(E.detailMobile2)E.detailMobile2.textContent=p.mobile2||"-";if(E.detailBaseInsurance)E.detailBaseInsurance.textContent=p.baseInsuranceName?(p.baseInsuranceName+(p.baseInsuranceNo?` — ${p.baseInsuranceNo}`:"")):"ثبت نشده";if(E.detailSuppInsurance){const supp=[p.supp1InsuranceName,p.supp2InsuranceName].filter(Boolean);E.detailSuppInsurance.textContent=supp.length?supp.join(" ، "):"ثبت نشده";}if(E.detailEmergencyContact)E.detailEmergencyContact.textContent=(p.emergencyContactName||p.emergencyContactPhone)?`${p.emergencyContactName||""}${p.emergencyContactRelation?` (${p.emergencyContactRelation})`:""}${p.emergencyContactPhone?` — ${p.emergencyContactPhone}`:""}`.trim():"ثبت نشده";if(E.detailFileNumber)E.detailFileNumber.textContent=p.fileNumber||"-";if(E.detailContactPreference)E.detailContactPreference.textContent=contactPreferenceLabel(p.contactPreference);
 // بارداری/شیردهی: نما از آخرین مراجعهٔ قابل‌دیدنِ همین کاربر، با تاریخِ ثبتِ واقعی.
 // سطر در index.html مخفی به دنیا می‌آید و فقط با جنسیتِ «زن» (۲) باز می‌شود؛
// مرد، جنسیتِ ناشناخته و کلاینتِ کهنه همان مخفی‌مانده را می‌بینند.
 if(E.detailPregnancyStatus){
     E.detailPregnancyStatus.textContent=p.pregnancyStatus?`${p.pregnancyStatus}${p.pregnancyObservedAt?` — ثبت در ${formatPersianDate(p.pregnancyObservedAt)}`:""}`:"—";
     const pregRow=E.detailPregnancyStatus.closest(".info-item");
     if(pregRow)pregRow.style.display=Number(p.gender)===2?"":"none";
 }
 // بنر ایمنی: گروه خونیِ ثبت‌شده در بالای پرونده؛ نامعلوم بودن هم صادقانه گفته می‌شود.
 const safetyBanner=byId("patientSafetyBanner"),safetyBlood=byId("patientSafetyBloodType"),safetyHint=byId("patientSafetyHint");
 if(safetyBanner&&safetyBlood&&safetyHint){
  if(p.bloodType){safetyBanner.classList.remove("hidden");safetyBlood.textContent=`گروه خونی: ${p.bloodType}`;safetyHint.textContent="گروه خونی ثبت‌شدهٔ بیمار — پیش از هر اقدام تهاجمی تأیید شود.";}
  else{safetyBanner.classList.remove("hidden");safetyBlood.textContent="گروه خونی: نامعلوم";safetyHint.textContent="برای ایمنی بیمار، در فرصت مناسب تکمیل شود.";safetyBanner.classList.add("unknown");}
 }E.studyCount.textContent=x.studyCount;E.totalImageCount.textContent=x.totalImageCount;applyAttachAvailability(Number(x.totalImageCount)||0>0);E.lastStudyDateSummary.textContent=studies.length?formatPersianDate(studies[0].studyDate):"-";E.patientStatusBadge.textContent=p.isActive?"فعال":"غیرفعال";E.patientStatusBadge.className=`status-badge ${p.isActive?"active":"inactive"}`;E.deactivatePatientButton.textContent=p.isActive?"غیرفعال کردن":"فعال کردن";if(E.patientProfilePhoto){E.patientProfilePhoto.src=`/api/patients/${p.patientID}/photo?v=${Date.now()}`;E.patientProfilePhoto.onerror=()=>{E.patientProfilePhoto.removeAttribute("src");E.patientProfilePhoto.classList.add("empty");};E.patientProfilePhoto.classList.remove("empty");}renderRecentStudiesSummary(studies);renderStudiesSafe(studies);
// بعد از ساخت کارت‌ها، چون خودِ کارت‌ها هم دکمهٔ «الصاق» دارند.
applyAttachAvailability(Number(x.totalImageCount)||0>0);}

async function renderRecentStudiesSummary(studies){
 E.recentStudiesSummary.replaceChildren();const recent=(studies||[]).slice(0,3);
 if(!recent.length){E.recentStudiesSummary.textContent="هنوز مطالعه‌ای ثبت نشده است.";return;}
 for(const study of recent){const row=document.createElement("button");row.type="button";row.className="recent-study-row";const thumb=document.createElement("span");thumb.className="recent-study-thumb";thumb.textContent="🦷";const text=document.createElement("span");text.className="recent-study-text";const name=document.createElement("strong");name.textContent=study.studyTypeName||study.studyType||`مطالعه ${study.studyID}`;const date=document.createElement("small");date.textContent=formatPersianDate(study.studyDate);text.append(name,date);row.append(thumb,text);row.onclick=()=>document.querySelector(`.study-scroll-card[data-study-id="${study.studyID}"]`)?.scrollIntoView({behavior:"smooth",block:"start"});E.recentStudiesSummary.appendChild(row);
  try{const r=await fetch(`/api/radiologyimages/study/${study.studyID}`),image=undefined;let x=await readApiJson(r);(x.images||[]).find(i=>i.contentType!=="application/pdf"&&!isCardDocumentImage(i));if(r.ok&&x.success&&image){const img=document.createElement("img");img.src=`/api/radiologyimages/${image.imageID}`;img.alt="";img.loading="lazy";thumb.replaceChildren(img);}}catch{}
 }
}
async function loadStudyDetailsImages(study){
 E.studyDetailsImagesGrid.replaceChildren();setFormStatus(E.studyDetailsImagesStatus,"در حال دریافت فایل‌ها...",false);
 try{const r=await fetch(`/api/radiologyimages/study/${study.studyID}`),x=await readApiJson(r);if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"فایل‌های مراجعه دریافت نشد."));
  const all=x.images||[],docs=all.filter(isCardDocumentImage),xrays=all.filter(im=>!isCardDocumentImage(im));
  renderImagesInGrid(xrays,E.studyDetailsImagesGrid);
  setFormStatus(E.studyDetailsImagesStatus,xrays.length?"":(docs.length?"برای این مراجعه فقط کارت سابقه ثبت شده است.":"هنوز فایلی به این مراجعه متصل نشده است."),false);
 }catch(e){setFormStatus(E.studyDetailsImagesStatus,e.message||"فایل‌های مراجعه دریافت نشد.",true);}
}
function openStudyImages(study){selectedStudyID=study.studyID;selectedStudy=study;window.selectedStudy=study;hideMainSections();E.studyImagesSection.classList.remove("hidden");E.studyImagesTitle.textContent="تصاویر — "+(study.studyTypeName||("مراجعهٔ "+study.studyID));loadStudyDetailsImages(study);window.scrollTo(0,0);}
// Doctors with their specialty, fetched once.
async function loadDoctors(){
 if(doctorsCache)return doctorsCache;
 try{const r=await fetch("/api/staff/doctors",{cache:"no-store"}),x=await readApiJson(r);
  doctorsCache=r.ok&&x.success?(x.doctors||[]):[];
 }catch{doctorsCache=[];}
 return doctorsCache;
}
// Waiting stages, optionally narrowed to a specialty. The unfiltered list is
// cached; a specialty filter is cheap because the response is small.
async function loadWaitStages(specialtyID){
 if(!specialtyID&&waitStagesCache)return waitStagesCache;
 try{
  const url=specialtyID?`/api/waitstages?specialtyID=${specialtyID}`:"/api/waitstages";
  const r=await fetch(url,{cache:"no-store"}),x=await readApiJson(r);
  const rows=r.ok&&x.success?(x.waitStages||[]):[];
  if(!specialtyID)waitStagesCache=rows;
  return rows;
 }catch{return [];}
}
// Fills the doctor dropdown and keeps the current value selectable even if that
// doctor is no longer in the active list.
function fillDoctorSelect(selectedID){
 const sel=E.studyDetailsDoctor;if(!sel)return;
 sel.replaceChildren();
 const none=document.createElement("option");none.value="";none.textContent="انتخاب نشده";sel.appendChild(none);
 (doctorsCache||[]).forEach(d=>{
  const o=document.createElement("option");o.value=String(d.staffID);
  o.textContent=`${d.firstName||""} ${d.lastName||""}`.trim()+((d.specialtyName)?` — ${d.specialtyName}`:"");
  sel.appendChild(o);
 });
 const value=selectedID?String(selectedID):"";
 if(value&&!Array.from(sel.options).some(o=>o.value===value)){
  const cur=document.createElement("option");cur.value=value;cur.textContent=`${selectedStudy?.doctorName||"دندانپزشک فعلی"} (غیرفعال)`;
  sel.appendChild(cur);
 }
 sel.value=value;
}
// Fills the waiting-stage dropdown for the selected doctor's specialty.
async function fillWaitStageSelect(selectedStageID){
 const sel=E.studyDetailsWaitStage;if(!sel)return;
 const doctorID=Number(E.studyDetailsDoctor?.value)||0;
 const specialtyID=(doctorsCache||[]).find(d=>Number(d.staffID)===doctorID)?.specialtyID||null;
 const rows=await loadWaitStages(specialtyID);
 sel.replaceChildren();
 const none=document.createElement("option");none.value="";none.textContent="انتخاب نشده";sel.appendChild(none);
 rows.forEach(w=>{const o=document.createElement("option");o.value=String(w.waitStageID);o.textContent=w.name;sel.appendChild(o);});
 const value=selectedStageID?String(selectedStageID):"";
 if(value&&!Array.from(sel.options).some(o=>o.value===value)){
  const cur=document.createElement("option");cur.value=value;cur.textContent=(selectedStudy?.waitStageName||"مرحله فعلی")+" (غیرفعال)";
  sel.appendChild(cur);
 }
 sel.value=value;
}
// The status and waiting fields only apply together, so they are shown together.
function syncStudyDetailsStatusFields(){
 const status=Number(E.studyDetailsStatus2?.value)||2;
 const waiting=status===3;
 E.studyDetailsWaitBox?.classList.toggle("hidden",!waiting);
 E.studyDetailsFollowUpBox?.classList.toggle("hidden",!waiting);
}
// ---- نوعِ مراجعه: فهرستِ فیلترشده بر اساسِ تخصصِ پزشکِ مراجعه ---------------
// سلسله‌مراتبِ تخصص: ۱) پزشکِ انتخابیِ مراجعه (فهرستِ پرسنل SpecialtyID دارد)
// ۲) تخصصِ کاربرِ واردشده اگر نشست آن را داشته باشد ۳) بدونِ فیلتر (همه).
// نبودِ پزشک یا نبودِ دسترسی خطا نیست: فهرستِ کامل همان رفتارِ قبلی است.
function studyTypeSpecialtyID(){
 const doctorID=Number(E.studyDetailsDoctor?.value)||0;
 const fromDoctor=Number((doctorsCache||[]).find(d=>Number(d.staffID)===doctorID)?.specialtyID)||0;
 if(fromDoctor)return fromDoctor;
 const mine=Number(window.reSiRaiCurrentUser?.specialtyID)||0;
 return mine>0?mine:0;
}
// خروجیِ سرور = نوع‌هایِ همان تخصص ∪ مشترک‌ها ∪ سایر (StudyTypesController).
// نوعِ در حالِ نمایش همیشه نگه داشته می‌شود: مراجعهٔ قدیمی نباید فقط چون
// فیلتر شده نامرئی شود (نامِ آن به فهرست افزوده می‌شود).
async function ensureStudyDetailsTypes(selectedID,selectedName){
 const specialtyID=studyTypeSpecialtyID();
 const url=specialtyID?`/api/studytypes?specialtyID=${specialtyID}`:"/api/studytypes";
 const name=selectedName||selectedStudy?.studyTypeName||"";
 try{
  const r=await fetch(url,{cache:"no-store"}),x=await readApiJson(r);
  if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"دلایل مراجعه دریافت نشد."));
  window.ReSiRaiStudyTypeUI?.setTypes(x.studyTypes||[],selectedID,name);
 }catch(e){
  const ui=window.ReSiRaiStudyTypeUI;
  if(ui?.count()){
   // فهرستِ قبلی سالم است؛ فقط نوعِ بازشده را دوباره انتخاب کن.
   ui.setTypes(ui.types(),selectedID,name);
  }else{
   // فهرستی نرسیده: دست‌کم نوعِ خودِ مراجعه را بگذار تا فرم قابلِ کار بماند.
   ui?.setTypes(selectedID?[{studyTypeID:selectedID,studyTypeName:name||"نوع فعلی"}]:[],selectedID,name);
   setFormStatus(E.studyDetailsStatus,e.message||"دلایل مراجعه دریافت نشد.",true);
  }
 }
}
// انتخابِ فعلیِ باکس (شناسه + نام + توضیحِ «سایر») برایِ payload و نمایش.
function currentStudyTypeSelection(){return window.ReSiRaiStudyTypeUI?.selection()||{id:0,name:"",note:null};}
// پزشکِ مراجعه عوض شد ← فهرستِ نوع‌ها باید برایِ تخصصِ تازه ساخته شود؛ نوعِ
// انتخاب‌شده حفظ می‌شود (اگر برایِ این تخصص نبود، همچنان نمایش داده می‌شود).
function refilterStudyTypes(){
 if(studyFormMode==="view")return;
 const sel=currentStudyTypeSelection();
 ensureStudyDetailsTypes(sel.id,sel.name);
}
// تیترِ بالایِ فرم: نوع و توضیحِ «سایر» کنارِ هم دیده می‌شوند.
function setStudyDetailsTitle(name,note){
 if(!E.studyDetailsTitle)return;
 E.studyDetailsTitle.textContent=name||(`مراجعهٔ ${selectedStudyID||""}`);
 if(note){const s=document.createElement("span");s.className="study-type-note";s.textContent=` — ${note}`;E.studyDetailsTitle.appendChild(s);}
}
// Marks a study complete straight from its card, without opening the panel.
//
// It reuses the update endpoint with the fields the API requires, keeping the
// study's own values so nothing is overwritten. The confirm step exists because
// completing a study also clears its waiting stage and follow-up date.
async function completeStudyFromCard(study,button){
 const wasWaiting=Number(study.status)===3;
 const message=wasWaiting
  ?"این مطالعه «تمام‌شده» شود؟\nمرحله انتظار و تاریخ پیگیری آن پاک می‌شود."
  :"این مطالعه «تمام‌شده» شود؟";
 if(!await askConfirmation({title:"تمام شدن مطالعه",message,confirmText:"بله، تمام شد",danger:false}))return;
 const original=button.textContent;button.disabled=true;button.textContent="در حال ثبت...";
 try{
  const body={
   studyDate:study.studyDate,
   studyTypeID:study.studyTypeID,
   bodyPart:study.bodyPart||null,
   description:study.description||null,
   diagnosis:study.diagnosis||null,
   workEndDate:study.workEndDate||null,
   toothNumbers:[],
   status:2,
   waitStageID:null,
   followUpDate:null,
   followUpNote:null,
   doctorStaffID:study.doctorStaffID??null
  };
  const r=await fetch(`/api/radiologystudies/${study.studyID}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  let x={};try{x=await r.json();}catch{}
  if(!r.ok||!x.success)throw new Error(getApiError(x,"تغییر وضعیت مطالعه انجام نشد."));
  showToast("مطالعه تمام‌شده شد.");
  // Re-render from the server so the badge, counts and any waiting date update.
  await openPatient(selectedPatientID);
  // A finished study with an outstanding balance is the moment to remind the
  // patient, so the offer is made here with the real balance.
  try{
   const fr=await fetch(`/api/patients/${selectedPatientID}/finance`,{cache:"no-store"}),fx=await fr.json();
   if(fr.ok&&fx.success&&Number(fx.balanceAmount)>0){
    offerPatientMessage(selectedPatientID,"این بیمار مانده حساب دارد. یادآوری مانده فرستاده شود؟","balance-due");
   }
  }catch{/* the finance lookup is optional */}
 }catch(e){
  showToast(e.message||"تغییر وضعیت مطالعه انجام نشد.","error");
  button.disabled=false;button.textContent=original;
 }
}
async function openStudyDetails(study){
 selectedStudyID=study.studyID;selectedStudy=study;window.selectedStudy=study;setStudyFormMode("view");hideMainSections();E.studyDetailsSection.classList.remove("hidden");
 setStudyDetailsTitle(study.studyTypeName,study.studyTypeNote);E.studyDetailsDate.textContent=formatPersianDateTime(study.studyDate);
 // Status badge so the state is visible without entering edit mode.
 const badge=createStudyStatusBadge(study);
 if(E.studyDetailsStatusBadge){E.studyDetailsStatusBadge.replaceChildren();if(badge)E.studyDetailsStatusBadge.appendChild(badge);}
 E.newBodyPart.value=study.bodyPart||"";E.newStudyDate.value=formatPersianDateTimeForInput(study.studyDate);
 E.newStudyDescription.value=study.description||"";E.newStudyDiagnosis.value=study.diagnosis||"";E.studyDetailsWorkEndDate.value=study.workEndDate?formatPersianDateTimeForInput(study.workEndDate):"";
 // Doctor and status, then the waiting stage narrowed to that doctor's specialty.
 await loadDoctors();
 fillDoctorSelect(study.doctorStaffID);
 // فهرستِ نوع‌ها بعد از پزشک ساخته می‌شود تا فیلتر از تخصصِ همان پزشک بیاید؛
 // نوعِ قدیمیِ خارج از این فهرست همچنان نمایش داده می‌شود و توضیحِ «سایر»
 // کنارِ نوع می‌نشیند.
 await ensureStudyDetailsTypes(study.studyTypeID,study.studyTypeName);
 window.ReSiRaiStudyTypeUI?.setNote(study.studyTypeNote||"");
 E.studyDetailsStatus2.value=String(Number(study.status)||2);
 await fillWaitStageSelect(study.waitStageID);
 E.studyDetailsFollowUpDate.value=study.followUpDate?formatPersianDateForInput(study.followUpDate):"";
 E.studyDetailsFollowUpNote.value=study.followUpNote||"";
 syncStudyDetailsStatusFields();
 setStudyDetailsEditing(false);setFormStatus(E.studyDetailsStatus,"",false);
 // پنلِ فاکتورها: اگر observer آن را برای همین مراجعه رندر کرده باشد دوباره ساخته نمی‌شود.
 const factorsHost=document.getElementById("studyFactorsPanel");
 if(!factorsHost||factorsHost.dataset.renderedFor!==String(Number(study.studyID)||0))window.ReSiRaiFactors?.render(study);
 // بخش‌هایِ مراجعه (تیک‌محور) هم باید برایِ همین مراجعه از سرور خوانده شوند؛
 // هم برایِ مراجعهٔ بازشده و هم برایِ مراجعهٔ تازه ثبت‌شده (بعد از openStudyDetails).
 window.ReSiRaiStudySections?.render(study);
 try{const r=await fetch(`/api/radiologystudies/${study.studyID}`,{cache:"no-store"}),x=await readApiJson(r);if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"اطلاعات Study دریافت نشد."));const teeth=x.toothNumbers||x.study?.toothNumbers||[];if(window.ReSiRaiTeethChart)window.ReSiRaiTeethChart.render(E.studyDetailsTeethChart,teeth);}catch{if(window.ReSiRaiTeethChart)window.ReSiRaiTeethChart.render(E.studyDetailsTeethChart,[]);}finally{E.studyDetailsTeethChart?.classList.add("study-chart-readonly");}
 window.scrollTo(0,0);
}
function setStudyDetailsEditing(editing){
 // «new» یعنی ثبتِ مراجعهٔ تازه: همهٔ فیلدها بازند و دکمهٔ ثبت دیده می‌شود.
 const creating=studyFormMode==="new",on=editing||creating;
 [E.newBodyPart,E.newStudyDate,E.newStudyDescription,E.newStudyDiagnosis,
  E.studyDetailsWorkEndDate,E.studyDetailsFollowUpDate,E.studyDetailsFollowUpNote].forEach(x=>{if(x)x.readOnly=!on;});
 // باکسِ نوع، autocomplete است: در حالتِ نمایش فقط‌خواندنی می‌شود (هم فیلدِ متن
 // هم فیلدِ توضیحِ «سایر» و هم دکمه‌های میکروفون/✕).
 window.ReSiRaiStudyTypeUI?.setEditable(on);
 if(!window.ReSiRaiStudyTypeUI){E.newStudyType.readOnly=!on;if(E.studyTypeNote)E.studyTypeNote.readOnly=!on;}
 // The doctor and the status are part of the record, so they unlock with the rest.
 if(E.studyDetailsDoctor)E.studyDetailsDoctor.disabled=!on;
 if(E.studyDetailsStatus2)E.studyDetailsStatus2.disabled=!on;
 if(E.studyDetailsWaitStage)E.studyDetailsWaitStage.disabled=!on;
 E.studyDetailsTeethChart?.classList.toggle("study-chart-readonly",!on);
 E.studyDetailsEditButton.classList.toggle("hidden",editing||creating);
 E.studyDetailsImagesButton.classList.toggle("hidden",editing||creating);
 E.studyDetailsSaveButton.classList.toggle("hidden",!editing||creating);
 E.studyDetailsCancelButton.classList.toggle("hidden",!editing&&!creating);
 // در حالتِ جدید هنوز مراجعه‌ای نیست: «بازگشت» جای خود را به «انصراف» می‌دهد
 // و دکمه‌های تصویر (که به StudyID نیاز دارند) پنهان می‌مانند.
 E.backToPatientDetailsButton?.classList.toggle("hidden",creating);
 E.studyCreateActions?.classList.toggle("hidden",!creating);
}
async function saveStudyDetails(){
 if(studyDetailsSaveInProgress)return;
 const studyID=Number(selectedStudyID);
 if(!Number.isInteger(studyID)||studyID<=0){setFormStatus(E.studyDetailsStatus,"مطالعه معتبر انتخاب نشده است.",true);return;}
 try{
  studyDetailsSaveInProgress=true;E.studyDetailsSaveButton.disabled=true;E.studyDetailsSaveButton.textContent="در حال ذخیره...";setFormStatus(E.studyDetailsStatus,"در حال ذخیره تغییرات...",false);
  const stSel=currentStudyTypeSelection();
  const studyTypeID=stSel.id;if(!Number.isInteger(studyTypeID)||studyTypeID<=0)throw new Error("دلیل مراجعه را انتخاب کنید.");
  const studyDate=parsePersianDateForBackend(E.newStudyDate.value,true);if(!studyDate)throw new Error("تاریخ مطالعه را وارد کنید.");
  const status=Number(E.studyDetailsStatus2?.value)||2;
  // شمای دندان مخفی است؛ اگر از خودِ چارت چیزی خوانده نشود، دندان‌های ثبت‌شدهٔ
  // همین مراجعه نگه داشته می‌شوند تا ذخیره، آن‌ها را پاک نکند.
  const chartTeeth=window.ReSiRaiTeethChart?.getSelected(E.studyDetailsTeethChart)||[];
  const body={studyDate,studyTypeID,studyTypeNote:stSel.note,bodyPart:emptyToNull(E.newBodyPart.value),description:emptyToNull(E.newStudyDescription.value),diagnosis:emptyToNull(E.newStudyDiagnosis.value),workEndDate:parsePersianDateForBackend(E.studyDetailsWorkEndDate.value,true)||null,
   toothNumbers:chartTeeth.length?chartTeeth:(Array.isArray(selectedStudy?.toothNumbers)?selectedStudy.toothNumbers:[]),
   status,
   waitStageID:status===3?(Number(E.studyDetailsWaitStage?.value)||null):null,
   followUpDate:status===3?parsePersianDateForBackend(E.studyDetailsFollowUpDate.value,false):null,
   followUpNote:status===3?emptyToNull(E.studyDetailsFollowUpNote.value):null,
   doctorStaffID:Number(E.studyDetailsDoctor?.value)||null};
  const r=await fetch(`/api/radiologystudies/${studyID}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});let x={};try{x=await r.json();}catch{}if(!r.ok||!x.success)throw new Error(getApiError(x,`ویرایش Study انجام نشد. (HTTP ${r.status})`));
  const updated={...selectedStudy,...(x.study||{}),studyID,studyTypeID,studyTypeName:stSel.name||selectedStudy?.studyTypeName,studyTypeNote:body.studyTypeNote,studyDate,bodyPart:body.bodyPart,description:body.description,diagnosis:body.diagnosis,workEndDate:body.workEndDate,status:body.status,waitStageID:body.waitStageID,followUpDate:body.followUpDate,followUpNote:body.followUpNote,doctorStaffID:body.doctorStaffID,doctorName:E.studyDetailsDoctor?.options[E.studyDetailsDoctor.selectedIndex]?.text||selectedStudy?.doctorName,waitStageName:E.studyDetailsWaitStage?.options[E.studyDetailsWaitStage.selectedIndex]?.text||selectedStudy?.waitStageName};selectedStudy=updated;
  setStudyFormMode("view");setStudyDetailsEditing(false);setStudyDetailsTitle(updated.studyTypeName,updated.studyTypeNote);E.studyDetailsDate.textContent=formatPersianDateTime(studyDate);setFormStatus(E.studyDetailsStatus,"تغییرات مطالعه با موفقیت ذخیره شد.",false);showToast("مطالعه با موفقیت ویرایش شد.");
  try{const pr=await fetch(`/api/patients/${selectedPatientID}/details`,{cache:"no-store"}),pd=await pr.json();if(pr.ok&&pd.success){const fresh=(pd.studies||[]).find(s=>s.studyID===studyID);if(fresh)selectedStudy=fresh;}}catch(refreshError){console.warn("Study saved, but patient workspace refresh failed:",refreshError);}
 }catch(e){setFormStatus(E.studyDetailsStatus,e.message||"ویرایش Study انجام نشد.",true);
 }finally{studyDetailsSaveInProgress=false;E.studyDetailsSaveButton.disabled=false;E.studyDetailsSaveButton.textContent="ذخیره تغییرات";}
}
window.ReSiRaiSaveStudyDetails=event=>{event?.preventDefault?.();return saveStudyDetails();};

// «پایانِ کار»: یک کلیک، بدونِ تایپ — ساعتِ همین حالا رویِ همین مراجعه ثبت
// می‌شود و بلافاصله در فیلدِ «پایانِ کار» دیده می‌شود؛ بعداً از راهِ ویرایش
// مراجعه قابلِ اصلاح یا پاک‌کردن است. مدتِ کار = پایانِ کار − تاریخِ مراجعه.
async function markWorkEnd(){
 const studyID=Number(selectedStudyID);
 if(!Number.isInteger(studyID)||studyID<=0){showToast("ابتدا یک مراجعه را باز کنید.","error");return;}
 const button=E.studyDetailsWorkEndButton,original=button?.textContent;
 if(button){button.disabled=true;button.textContent="در حال ثبت...";}
 try{
  const r=await fetch(`/api/radiologystudies/${studyID}/work-end`,{method:"PUT",headers:{"Content-Type":"application/json"},body:"{}"});
  let x={};try{x=await r.json();}catch{}
  if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"پایانِ کار ثبت نشد."));
  const value=x.workEndDate||x.study?.workEndDate||null;
  if(E.studyDetailsWorkEndDate)E.studyDetailsWorkEndDate.value=value?formatPersianDateTimeForInput(value):"";
  if(selectedStudy)selectedStudy={...selectedStudy,workEndDate:value};
  showToast("پایانِ کار ثبت شد.");
 }catch(e){showToast(e.message||"پایانِ کار ثبت نشد.","error");}
 finally{if(button){button.disabled=false;button.textContent=original;}}
}
window.ReSiRaiMarkWorkEnd=event=>{event?.preventDefault?.();return markWorkEnd();};

let sectionsHome=null;
// Studies as collapsible rows.
 //
 // A study card used to render everything at once - details, a full odontogram and
 // an image grid - which made each row tall enough to need its own scrolling. Now
 // the header carries a one-line summary and the body opens on demand, so a patient
 // with several studies stays readable.
 // خلاصهٔ دندان‌ها برای سطرِ بستهٔ نمودار: «دندان‌ها: ۱۱، ۱۶، ۳۶»
 function toothLineText(teeth){
  if(!Array.isArray(teeth)||!teeth.length)return "دندانی انتخاب نشده";
  return "دندان‌ها: "+teeth.map(n=>{const v=Number(n);return Number.isFinite(v)?v.toLocaleString("fa-IR"):String(n);}).join("، ");
 }
 // «کارت سابقه» سند است نه تصویرِ رادیولوژی: در گرید دیده نمی‌شود و شمرده هم نمی‌شود.
 function isCardDocumentImage(image){return String(image?.imageTypeName||"").trim()==="کارت سابقه";}
 function studySummary(study){
  const parts=[];
  if(study.bodyPart)parts.push(study.bodyPart);
  // توضیحِ «سایر» هم بخشی از همان مراجعه است و در خلاصه دیده می‌شود.
  if(study.studyTypeNote)parts.push(`سایر: ${study.studyTypeNote}`);
  const toothCount=Array.isArray(study.toothNumbers)?study.toothNumbers.length:0;
  if(SHOW_TEETH_CHART&&toothCount)parts.push(`${toothCount} دندان`);
  if(study.imageCount)parts.push(`${study.imageCount} تصویر`);
  if(study.documentCount)parts.push(`${study.documentCount} سند`);
  if(study.diagnosis&&String(study.diagnosis).trim())parts.push("دارای تشخیص");
  if(Number(study.status)===3&&study.followUpDate)parts.push(`پیگیری ${formatPersianDate(study.followUpDate)}`);
  return parts.join(" · ")||"بدون جزئیات";
 }
 function restoreSectionsPanel(){
  // پنلِ تیک‌محور «تکی» است و به داخلِ کارتِ باز منتقل می‌شود؛ پیش از هر رندرِ
  // تازه باید به خانه‌اش برگردد تا با پاک‌شدنِ لیست از بین نرود.
  const p=document.getElementById("studySectionsPanel");
  if(p&&sectionsHome&&p.parentNode!==sectionsHome.parent){
   if(sectionsHome.next&&sectionsHome.next.parentNode===sectionsHome.parent)sectionsHome.parent.insertBefore(p,sectionsHome.next);
   else sectionsHome.parent.appendChild(p);
  }
 }
 function ReSiRaiMoveSections(host){
  const p=document.getElementById("studySectionsPanel");
  if(!p||!host)return;
  if(!sectionsHome)sectionsHome={parent:p.parentNode,next:p.nextElementSibling};
  if(p.parentNode!==host)host.appendChild(p);
 }
 function scrollToStudyCard(studyID){
  const id=Number(studyID)||0;
  const card=id?document.querySelector(`.study-scroll-card[data-study-id="${id}"]`):null;
  if(card)card.scrollIntoView({behavior:"smooth",block:"center"});
 }
 function renderStudiesSafe(studies){
  restoreSectionsPanel();
  E.studiesContainer.replaceChildren();
  selectedStudyID=null;selectedStudy=null;
  // ناحیهٔ «مراجعه» بالایِ لیست: پیش‌نویسِ محفوظ یا (در صورت نیاز) کارتِ تازه.
  window.ReSiRaiVisitDraft&&window.ReSiRaiVisitDraft.mount();
  if(!studies?.length){E.studiesContainer.textContent="برای این بیمار هنوز مطالعه‌ای ثبت نشده است.";return;}
  const ordered=[...studies].sort((a,b)=>new Date(b.studyDate||0)-new Date(a.studyDate||0));
  // شمارهٔ سریالِ مراجعه: قدیمی‌ترین =۱، چون «مراجعهٔ ۱» یعنی اولین ویزیت بیمار.
  const serialOf=new Map(ordered.map((s,i)=>[s,ordered.length-i]));
  ordered.forEach(study=>{
   const card=document.createElement("article");
   card.className="study-scroll-card";
   card.dataset.studyId=String(study.studyID);
    // For the delete button: a visit with images, actions or payments is never deletable.
    card.dataset.imageCount=String(study.imageCount||0);
    card.dataset.documentCount=String(study.documentCount||0);
    card.dataset.actionCount=String(study.actionCount||0);
    card.dataset.paymentCount=String(study.paymentCount||0);

   // --- header: a clickable summary row -------------------------------------
   const header=document.createElement("header");
   header.className="study-scroll-header study-collapsible-header";
   header.tabIndex=0;
   header.setAttribute("role","button");
   header.setAttribute("aria-expanded","false");

   const heading=document.createElement("div");
   heading.className="study-header-main";
   const title=document.createElement("h4");
   const serial=document.createElement("span");
   serial.className="study-visit-serial";
   serial.textContent=`${(serialOf.get(study)||1).toLocaleString("fa-IR")}-مراجعه`;
   serial.title="شمارهٔ ترتیبی این مراجعه (قدیمی‌ترین = ۱)";
   title.append(serial," ",study.studyTypeName||study.studyType||`مطالعه ${study.studyID}`);
   const date=document.createElement("time");
   date.textContent=formatPersianDateTime(study.studyDate);
   title.append(" ", date);
   heading.appendChild(title);
   const statusBadge=createStudyStatusBadge(study);
   if(statusBadge)heading.appendChild(statusBadge);
   // The one-line summary is what makes a collapsed list useful.
   const summaryLine=document.createElement("p");
   summaryLine.className="study-summary-line";
   summaryLine.textContent=studySummary(study);
   heading.appendChild(summaryLine);

   const actions=document.createElement("div");
   actions.className="study-scroll-actions";
   const toggle=document.createElement("button");
   toggle.type="button";toggle.className="study-toggle-button secondary-button";toggle.textContent="نمایش";
   toggle.setAttribute("aria-label","نمایش جزئیات مطالعه");
   if(Number(study.status)!==2){
    const complete=document.createElement("button");complete.type="button";complete.className="study-complete-button";complete.textContent="✓ تمام شد";
    complete.title="علامت‌گذاری این مطالعه به‌عنوان تمام‌شده";complete.onclick=e=>{e.stopPropagation();completeStudyFromCard(study,complete);};
    actions.appendChild(complete);
   }
   // دکمهٔ «ویرایش» حذف شد: فیلدهایِ ثابت در خودِ کارت مستقیم‌ویرایش‌اند.
   // --- کارهای تصویر زیر یک منوی «تصویر ▾» تا ردیف اکشن شلوغ نشود -----
   const imageMenuButton=document.createElement("button");
   imageMenuButton.type="button";imageMenuButton.className="secondary-button study-image-menu-button";
   imageMenuButton.textContent="تصویر ▾";
   imageMenuButton.setAttribute("aria-haspopup","true");imageMenuButton.setAttribute("aria-expanded","false");
   const imageMenuBox=document.createElement("div");
   imageMenuBox.className="study-image-menu-box hidden";
   [["عکس/فایل جدید (دوربین یا کامپیوتر)",()=>openUploadImageForm(study),false],
    ["الصاق تصویر موجود از پرونده",()=>{selectVisit(study);window.ReSiRaiImagePickup.open();},true],
    ["دریافت از بیمار با لینک/کیوآرکد",()=>{selectVisit(study);window.ReSiRaiReceive&&window.ReSiRaiReceive.open();},false],
    ["ارسال لینک تصویر با پیامک",()=>{selectVisit(study);window.ReSiRaiShareImages&&window.ReSiRaiShareImages.open();},false]]
   .forEach(([label,run,needsImages])=>{
     const item=document.createElement("button");item.type="button";item.className="study-image-menu-item";item.textContent=label;
     // اگر بیمار هیچ تصویری نداشته باشد، «الصاق» معنا ندارد و مخفی می‌ماند.
     if(needsImages)item.setAttribute("data-needs-images","1");
     item.onclick=ev=>{ev.stopPropagation();closeStudyImageMenus();run();};
     imageMenuBox.appendChild(item);
   });
   imageMenuButton.onclick=ev=>{
     ev.stopPropagation();
     const willOpen=imageMenuBox.classList.contains("hidden");
     closeStudyImageMenus();
     if(willOpen){imageMenuBox.classList.remove("hidden");imageMenuButton.setAttribute("aria-expanded","true");}
   };
   actions.append(toggle,imageMenuButton,imageMenuBox);

   // --- body: built on first open, so a closed study costs nothing ----------
   const body=document.createElement("div");
   body.className="study-scroll-body hidden";
   let hydrated=false;

   const setOpen=open=>{
    body.classList.toggle("hidden",!open);
    header.setAttribute("aria-expanded",open?"true":"false");
    toggle.textContent=open?"بستن":"نمایش";
    card.classList.toggle("study-open",open);
    if(open&&!hydrated){
     hydrated=true;
     // فیلدهایِ ثابتِ مراجعه به‌صورتِ مستقیم‌ویرایش؛ «ثبت» کنارِ همان فیلدِ
     // تغییرکرده ظاهر می‌شود و کلِ همین کارت را ذخیره می‌کند (visit-draft.js).
     const fields=window.ReSiRaiVisitDraft?window.ReSiRaiVisitDraft.buildFields(study):null;
     const sectionsHost=document.createElement("div");sectionsHost.className="study-card-sections";
     // کارتِ سابقه: سندِ اسکن‌شدهٔ همین مراجعه — جدا از تصاویر رادیولوژی نشان داده می‌شود.
     const docsSection=document.createElement("section");docsSection.className="study-scroll-docs";
     docsSection.innerHTML='<div class="study-scroll-images-title">کارت سابقه</div><div class="images-grid docs-grid"></div>';
     let chartSection=null,chart=null;
     if(SHOW_TEETH_CHART){
     chartSection=document.createElement("section");chartSection.className="study-scroll-chart is-collapsed";
     // نمودار حدود ۲۸۵px جا می‌گیرد؛ پیش‌فرض بسته است و خلاصهٔ دندان‌ها در همان
     // یک سطر دیده می‌شود تا هنگام بستن چیزی از دست نرود؛ با کلیک باز می‌شود.
     const chartToggle=document.createElement("button");
     chartToggle.type="button";chartToggle.className="study-chart-toggle";
     chartToggle.setAttribute("aria-expanded","false");
     const chartArrow=document.createElement("span");chartArrow.className="study-chart-arrow";chartArrow.setAttribute("aria-hidden","true");chartArrow.textContent="⌄";
     const chartTeeth=document.createElement("span");chartTeeth.className="study-chart-teeth";
     chartTeeth.textContent=toothLineText(study.toothNumbers);chartTeeth.title=chartTeeth.textContent;
     const chartTitle=document.createElement("strong");chartTitle.textContent="نمودار دندان‌های این مطالعه";
     chart=document.createElement("div");chart.className="study-card-teeth-chart study-chart-readonly";
     chartToggle.append(chartArrow,chartTitle,chartTeeth);
     chartSection.append(chartToggle,chart);
     const setChartOpen=open=>{chartSection.classList.toggle("is-collapsed",!open);chartToggle.setAttribute("aria-expanded",open?"true":"false");chartArrow.textContent=open?"⌃":"⌄";};
     chartToggle.addEventListener("click",()=>setChartOpen(chartSection.classList.contains("is-collapsed")));
     }
     body.append(fields,sectionsHost,docsSection);if(chartSection)body.append(chartSection);
     // بخش‌هایِ تیک‌محور (تکی) به داخلِ همین کارت می‌آیند تا هیچ صفحه‌ای باز نشود.
     if(window.ReSiRaiMoveSections)window.ReSiRaiMoveSections(sectionsHost);
     if(window.ReSiRaiStudySections&&window.ReSiRaiStudySections.render)window.ReSiRaiStudySections.render(study);
     window.ReSiRaiFactors?.renderCard(study, body);
     const imagesSection=document.createElement("section");imagesSection.className="study-scroll-images";
     const imagesTitle=document.createElement("div");imagesTitle.className="study-scroll-images-title";imagesTitle.textContent="تصاویر مطالعه";
     // همان چهار کار تصویر، کنار خودِ لیست تصاویر — چون کاربر بعد از «نمایش»
     // دقیقاً همین‌جاست و نباید برای آپلود/الصاق برگردد به جای دیگر.
     const imageActions=document.createElement("div");
     imageActions.className="study-card-image-actions";
     [["عکس/فایل جدید (دوربین یا کامپیوتر)",()=>openUploadImageForm(study),false],
      ["الصاق تصویر موجود از پرونده",()=>{selectVisit(study);window.ReSiRaiImagePickup.open();},true],
      ["دریافت از بیمار با لینک/کیوآرکد",()=>{selectVisit(study);window.ReSiRaiReceive&&window.ReSiRaiReceive.open();},false],
      ["ارسال لینک تصویر با پیامک",()=>{selectVisit(study);window.ReSiRaiShareImages&&window.ReSiRaiShareImages.open();},false]]
     .forEach(([label,run,needsImages],i)=>{
       const b=document.createElement("button");
       b.type="button";b.className="secondary-button"+(i===3?" is-out":"");b.textContent=label;
       if(needsImages){
         b.setAttribute("data-needs-images","1");
         // این ردیف هنگام باز شدن کارت ساخته می‌شود؛ وضعیت را از پرچم فعلی می‌خوانیم.
         if(!patientHasImages)b.classList.add("hidden");
       }
       b.onclick=ev=>{ev.stopPropagation();run();};
       imageActions.appendChild(b);
     });
     const aiAll=document.createElement("button");aiAll.type="button";aiAll.className="secondary-button";aiAll.title="همهٔ تصاویرِ این مراجعه یک‌جا به هوش مصنوعی می‌رود تا با دیدنِ همهٔ جوانب تحلیل کند";aiAll.textContent="تحلیلِ همهٔ تصاویر با AI";aiAll.onclick=ev=>{ev.stopPropagation();const b=card.querySelector(".ai-analyze-button");if(!b){showToast("کمی صبر کنید تا دکمهٔ تحلیل آماده شود.","error");return;}b.click();setTimeout(()=>{const r=card.querySelector(".ai-study-analysis");if(r)r.scrollIntoView({behavior:"smooth",block:"center"});},400);};
imageActions.appendChild(aiAll);
const status=document.createElement("div");status.className="status-message";status.textContent="در حال دریافت تصاویر...";
     const grid=document.createElement("div");grid.className="images-grid";
     // --- انتخابِ چند تصویرِ مرتبط و تحلیلِ مشترکِ آنها ---------------------
     // کاربر تصویرها را خودش انتخاب می‌کند (حالتِ انتخاب در همین گرید) تا فقط
     // همان‌ها با هم به سرور برود؛ نتیجه هم مثلِ تک‌تصویر ذخیره می‌شود.
     const pickBtn=document.createElement("button");
     pickBtn.type="button";pickBtn.className="secondary-button";pickBtn.textContent="انتخاب تصاویر برای تحلیل";
     pickBtn.title="چند تصویرِ مرتبط را انتخاب کنید تا یک‌جا و با هم تحلیل شوند";
     const pickBar=document.createElement("div");
     pickBar.className="image-select-bar hidden";
     pickBar.innerHTML='<span class="image-select-count">۰ تصویر انتخاب شد</span><button type="button" class="image-select-run">تحلیل انتخاب‌شده‌ها با هم</button><button type="button" class="secondary-button image-select-cancel">انصراف</button>';
     imageActions.appendChild(pickBtn);
     const selectedIds=()=>Array.from(grid.querySelectorAll(".image-pick input:checked")).map(b=>Number(b.value)).filter(Boolean);
     function updateSelectBar(){
       const n=selectedIds().length;
       pickBar.querySelector(".image-select-count").textContent=`${n.toLocaleString("fa-IR")} تصویر انتخاب شد`;
       pickBar.querySelector(".image-select-run").disabled=n<2;
     }
     const exitSelect=()=>{grid.classList.remove("is-selecting");pickBar.classList.add("hidden");pickBtn.textContent="انتخاب تصاویر برای تحلیل";pickBtn.classList.remove("is-on");grid.querySelectorAll(".image-pick input:checked").forEach(b=>{b.checked=false;});updateSelectBar();};
     const enterSelect=()=>{
       if(grid.querySelectorAll("[data-ai-image]").length<2){showToast("برای تحلیلِ با هم، حداقل ۲ تصویر لازم است.","error");return;}
       grid.classList.add("is-selecting");pickBar.classList.remove("hidden");pickBtn.textContent="پایان انتخاب";pickBtn.classList.add("is-on");updateSelectBar();
     };
     pickBtn.onclick=ev=>{ev.stopPropagation();grid.classList.contains("is-selecting")?exitSelect():enterSelect();};
     pickBar.querySelector(".image-select-cancel").onclick=ev=>{ev.stopPropagation();exitSelect();};
     pickBar.querySelector(".image-select-run").onclick=async ev=>{
       ev.stopPropagation();
       const ids=selectedIds();
       if(ids.length<2){showToast("حداقل ۲ تصویر را انتخاب کنید.","error");return;}
       const run=window.ReSiRaiImageAI&&window.ReSiRaiImageAI.analyzeMany;
       if(!run){showToast("کمی صبر کنید تا ماژول تحلیل آماده شود.","error");return;}
       if(await run(ids))exitSelect();
     };
     // در حالتِ انتخاب، کلیک روی خودِ تصویر به‌جای بزرگ‌نمایی، انتخاب را عوض می‌کند.
     // (شنود روی گرید با capture اجرا می‌شود تا قبلِ onclickِ تصویر برسد.)
     grid.addEventListener("click",e=>{
       if(!grid.classList.contains("is-selecting"))return;
       if(e.target.closest("button")||e.target.closest("input")||e.target.closest("a"))return;
       const box=(e.target.closest(".image-card")||{querySelector:()=>null}).querySelector(".image-pick input");
       if(!box)return;
       e.preventDefault();e.stopPropagation();
       box.checked=!box.checked;updateSelectBar();
     },true);
     // چک‌باکسِ انتخاب روی هر تصویرِ قابلِ تحلیل؛ بعد از رندرِ دوباره (آپلود/حذف) هم ساخته می‌شود.
     const addPicks=()=>{grid.querySelectorAll(".image-card").forEach(c=>{const ai=c.querySelector("[data-ai-image]");if(!ai||c.querySelector(".image-pick"))return;const pick=document.createElement("label");pick.className="image-pick";pick.title="انتخاب این تصویر برای تحلیل با هم";const box=document.createElement("input");box.type="checkbox";box.value=ai.dataset.aiImage;box.addEventListener("change",updateSelectBar);pick.append(box,"انتخاب");c.appendChild(pick);});};
     new MutationObserver(addPicks).observe(grid,{childList:true});
     addPicks();
     imagesSection.append(imagesTitle,imageActions,status,grid,pickBar);
     body.appendChild(imagesSection);
     hydrateStudyCard(study,chart,status,grid,docsSection);
    }
   };
   toggle.onclick=e=>{e.stopPropagation();setOpen(body.classList.contains("hidden"));};
   header.addEventListener("click",()=>setOpen(body.classList.contains("hidden")));
   header.addEventListener("keydown",e=>{
    if(e.key==="Enter"||e.key===" "){e.preventDefault();setOpen(body.classList.contains("hidden"));}
   });

   header.append(heading,actions);
   card.append(header,body);
   E.studiesContainer.appendChild(card);
  });
 }
async function hydrateStudyCard(study,chart,status,grid,docsSection){
 const [imagesResult,studyResult]=await Promise.allSettled([fetch(`/api/radiologyimages/study/${study.studyID}`).then(async r=>({r,x:await readApiJson(r)})),fetch(`/api/radiologystudies/${study.studyID}`).then(async r=>({r,x:await readApiJson(r)}))]);
 let teeth=[];
 if(studyResult.status==="fulfilled"&&studyResult.value.r.ok){const x=studyResult.value.x;teeth=x.toothNumbers||x.study?.toothNumbers||[];}
 if(window.ReSiRaiTeethChart&&chart)window.ReSiRaiTeethChart.render(chart,teeth);
 // نمودار بسته است؛ خلاصهٔ دندان‌ها باید از همان سطر خوانده شود (در صورت خطا هم
 // همان render بالا با لیست خالی انجام شده است).
 const teethLine=chart?chart.closest(".study-scroll-chart")?.querySelector(".study-chart-teeth"):null;
 if(teethLine){teethLine.textContent=toothLineText(teeth);teethLine.title=teethLine.textContent;}
 if(imagesResult.status==="fulfilled"){const {r,x}=imagesResult.value;if(r.ok&&x.success){const all=x.images||[],docs=all.filter(isCardDocumentImage),xrays=all.filter(im=>!isCardDocumentImage(im));renderImagesInGrid(xrays,grid);if(docsSection){docsSection.classList.toggle("hidden",!docs.length);renderImagesInGrid(docs,docsSection.querySelector(".images-grid"),{docs:true});}const parts=[];if(xrays.length)parts.push(`${xrays.length} تصویر / فایل`);if(docs.length)parts.push(`${docs.length} سند`);status.textContent=parts.length?parts.join(" · "):"برای این مراجعه هنوز تصویری ثبت نشده است.";return;}status.textContent=getApiError(x,"تصاویر مطالعه دریافت نشد.");}
 else status.textContent="تصاویر مطالعه دریافت نشد.";status.classList.toggle("error",!imagesResult.value?.r?.ok);
}

function renderImagesInGrid(images,grid,opts){
 // تصاویر به تفکیکِ نوعِ تشخیص‌داده‌شده توسطِ رسیرای نمایش داده می‌شوند؛ بخش‌های
 // بازشونده با شمارنده تا گالری شلوغ نشود. بزرگ‌ترین گروه باز می‌ماند.
 if(!opts?._flat){
  grid.innerHTML="";
  const groups=new Map();
  (images||[]).forEach(im=>{const t=String(im.imageTypeName||"").trim()||"بدونِ نوع";if(!groups.has(t))groups.set(t,[]);groups.get(t).push(im);});
  const names=[...groups.keys()].sort((a,b)=>groups.get(b).length-groups.get(a).length);
  names.forEach((name,idx)=>{
   const box=document.createElement("details");box.className="image-type-group";box.open=idx===0;
   const head=document.createElement("summary");head.textContent=`${name} — ${groups.get(name).length} مورد`;
   if(name==="بدونِ نوع"){
    const b=document.createElement("button");b.type="button";b.className="secondary-button";b.style.marginInlineStart="10px";
    b.textContent="تشخیص نوع با رسیرای";
    b.onclick=async ev=>{ev.preventDefault();ev.stopPropagation();b.disabled=true;b.textContent="در حال تشخیص...";
     try{
      for(const im of groups.get(name)){
       const r=await fetch(`/api/ai/images/${im.imageID}/classify`,{method:"POST"});const x=await readApiJson(r);
       if(r.ok&&x.success&&x.imageTypeName)im.imageTypeName=x.imageTypeName;
      }
      renderImagesInGrid(images,grid,opts);
     }catch(e){showToast(e.message||"تشخیص نوع انجام نشد.","error");b.disabled=false;b.textContent="تشخیص نوع با رسیرای";}
    };
    head.appendChild(b);
   }
   box.appendChild(head);
   const sub=document.createElement("div");sub.className="image-type-grid";box.appendChild(sub);
   renderImagesInGrid(groups.get(name),sub,{...opts,_flat:true});
   grid.appendChild(box);
  });
  return;
 }
 grid.innerHTML="";(images||[]).forEach(image=>{const card=document.createElement("div");card.className="image-card";let media;if(image.contentType==="application/pdf"){media=document.createElement("div");media.className="pdf-thumbnail";media.textContent="PDF";}else{media=document.createElement("img");media.src=`/api/radiologyimages/${image.imageID}`;media.alt=image.fileName;media.loading="lazy";}media.onclick=()=>openLargeImage(image);const title=document.createElement("div");title.className="image-card-title";title.textContent=image.fileName;const type=document.createElement("div");type.className="field-hint";type.textContent=image.imageTypeName?`نوع تصویر: ${image.imageTypeName}`:"نوع تصویر: تعیین نشده";card.append(media,title,type);
if(image.contentType?.startsWith("image/")){const re=document.createElement("button");re.type="button";re.className="secondary-button";re.textContent="تشخیص نوع با رسیرای";re.onclick=async ev=>{ev.stopPropagation();re.disabled=true;re.textContent="در حال تشخیص...";try{const r=await fetch(`/api/ai/images/${image.imageID}/classify`,{method:"POST"});const x=await readApiJson(r);if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"تشخیص نوع انجام نشد."));image.imageTypeName=x.imageTypeName||image.imageTypeName;type.textContent=image.imageTypeName?`نوع تصویر: ${image.imageTypeName}`:"نوع تصویر: تعیین نشده";}catch(e){showToast(e.message||"تشخیص نوع انجام نشد.","error");}re.disabled=false;re.textContent="تشخیص نوع با رسیرای";};card.appendChild(re);}if(!opts?.docs&&image.contentType?.startsWith("image/")){const ai=document.createElement("button"),isDocument=/(کارت|سند|مدرک|مدارک)/i.test(image.imageTypeName||"");ai.dataset.aiImage=image.imageID;ai.type="button";ai.className="card-extraction-button"+(image.hasAnalysis?" is-cached":"");ai.textContent=isDocument?"استخراج اطلاعات از کارت":(image.hasAnalysis?"نمایش تحلیل تصویر":"تحلیل تصویر");ai.onclick=ev=>{ev.stopPropagation();isDocument?window.ReSiRaiImageAI?.open(image):window.ReSiRaiImageAI?.analyze(image);};card.appendChild(ai);}if(!image.imageTypeName){const classify=document.createElement("button");classify.type="button";classify.className="secondary-button";classify.textContent="تعیین نوع تصویر";classify.onclick=async ev=>{ev.stopPropagation();try{const r=await fetch("/api/imagetypes"),x=await readApiJson(r);if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"انواع تصویر دریافت نشد."));const types=x.imageTypes||[];if(!types.length){showToast("هنوز نوع تصویری ثبت نشده است.","error");return;}const box=document.createElement("span");box.style.cssText="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px";const sel=document.createElement("select");sel.style.cssText="min-height:34px;border:1px solid var(--border);border-radius:8px;padding:4px 8px;font:inherit;font-size:13px;background:#fff";types.forEach(t=>{const o=document.createElement("option");o.value=t.imageTypeID;o.textContent=t.imageTypeName;sel.appendChild(o);});const ok=document.createElement("button");ok.type="button";ok.className="secondary-button";ok.textContent="ثبت";const cancel=document.createElement("button");cancel.type="button";cancel.className="secondary-button";cancel.textContent="انصراف";box.append(sel,ok,cancel);classify.replaceWith(box);cancel.onclick=ce=>{ce.stopPropagation();box.replaceWith(classify);};ok.onclick=async ce=>{ce.stopPropagation();const imageTypeID=Number(sel.value);try{const u=await fetch(`/api/radiologyimages/${image.imageID}/type`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({imageTypeID})}),y=await u.json();if(!u.ok||!y.success)throw new Error(getApiError(y,"تعیین نوع تصویر انجام نشد."));image.imageTypeID=y.imageTypeID;image.imageTypeName=y.imageTypeName;type.textContent=`نوع تصویر: ${y.imageTypeName}`;box.remove();if(typeof selectedStudy==="object"&&selectedStudy)openStudyImages(selectedStudy);showToast("نوع تصویر تعیین شد.");}catch(e2){showToast(e2.message||"تعیین نوع تصویر انجام نشد.","error");}};}catch(e){showToast(e.message||"انواع تصویر دریافت نشد.","error");}};card.appendChild(classify);}
const del=document.createElement("button");
del.type="button";
del.className="secondary-button image-delete-button";
// تصویرِ متصل به چند مراجعه حذف نمی‌شود؛ فقط از همین مراجعه جدا می‌شود.
// حذف فقط برای تصویری مجاز است که حداکثر به یک مراجعه متصل است.
const detachOnly=(image.linkCount||1)>1;
if(detachOnly)del.textContent="جدا کردن از این مراجعه";else del.textContent="حذف تصویر";
del.onclick=async ev=>{
  ev.stopPropagation();
  if(detachOnly){
    const yes=await askConfirmation({title:"جدا کردن تصویر",message:"تصویر فقط از این مراجعه جدا شود و در پرونده بماند؟",confirmText:"جدا شود",danger:false});
    if(!yes)return;
    try{
      const r=await fetch(`/api/radiologyimages/study/${selectedStudyID}/detach`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify([image.imageID])});
      let x={};
      try{x=await r.json();
}catch{}
      if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"جدا کردن تصویر انجام نشد."));
      showToast("تصویر از این مراجعه جدا شد.");
      if(typeof selectedStudy==="object"&&selectedStudy)openStudyImages(selectedStudy);
      else if(selectedPatientID)openPatient(selectedPatientID);
    }catch(e){showToast(e.message||"جدا کردن تصویر انجام نشد.","error");}
    return;
  }
  const yes=await askConfirmation({title:"حذف تصویر",message:"این تصویر از پرونده حذف شود؟ پس از حذف قابل بازگشت نیست.",confirmText:"حذف شود",danger:true});
  if(!yes)return;
  try{
    const r=await fetch(`/api/radiologyimages/${image.imageID}`,{method:"DELETE"});
    let x={};
    try{x=await r.json();
}catch{}
    if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"حذف تصویر انجام نشد."));
    showToast("تصویر حذف شد.");
    if(typeof selectedStudy==="object"&&selectedStudy)openStudyImages(selectedStudy);
    else if(selectedPatientID)openPatient(selectedPatientID);
  }catch(e){showToast(e.message||"حذف تصویر انجام نشد.","error");}
};
card.appendChild(del);
grid.appendChild(card);});}
let imageViewScale=1,imageViewRotation=0,imageViewFlipX=1,imageViewX=0,imageViewY=0,imageDragging=false,imageDragStartX=0,imageDragStartY=0;
function applyImageView(){E.largeImage.style.transform=`translate(${imageViewX}px,${imageViewY}px) scale(${imageViewScale}) rotate(${imageViewRotation}deg) scaleX(${imageViewFlipX})`;}
function resetImageView(){imageViewScale=1;imageViewRotation=0;imageViewFlipX=1;imageViewX=0;imageViewY=0;applyImageView();}
function openLargeImage(image){if(image.contentType==="application/pdf"){window.open(`/api/radiologyimages/${image.imageID}`,"_blank","noopener");return;}resetImageView();E.largeImage.src=`/api/radiologyimages/${image.imageID}`;E.largeImageCaption.textContent=image.imageTypeName?`${image.fileName} — ${image.imageTypeName}`:image.fileName;E.imageModal.classList.remove("hidden");}
function closeLargeImage(){E.imageModal.classList.add("hidden");E.largeImage.src="";resetImageView();}

function resetCameraCapture(){pendingCameraFile=null;if(cameraPreviewUrl){URL.revokeObjectURL(cameraPreviewUrl);cameraPreviewUrl=null;}E.cameraFileInput.value="";E.cameraPreviewImage.removeAttribute("src");E.cameraPreviewPanel.classList.add("hidden");E.imageFileInput.required=true;syncFilePickerNames();}
async function loadImageTypes(){if(!E.uploadImageType)return;E.uploadImageType.innerHTML=`<option value="">انتخاب نوع تصویر...</option>`;const r=await fetch("/api/imagetypes"),x=await readApiJson(r);if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"انواع تصویر دریافت نشد."));const types=x.imageTypes||[];types.forEach(t=>{const o=document.createElement("option");o.value=t.imageTypeID;o.textContent=t.imageTypeName;E.uploadImageType.appendChild(o);});/* The placeholder must stop looking like a loader, otherwise nobody notices that a choice is required and the Save button silently refuses to run. */const placeholder=E.uploadImageType.querySelector('option[value=""]');if(placeholder)placeholder.textContent=types.length?"نوع تصویر را انتخاب کنید...":"هنوز نوع تصویری ثبت نشده است.";}
// زمینهٔ مراجعه را قبل از باز کردن پنجره‌های تصویر تنظیم می‌کنیم؛ پنجره‌های
// «الصاق»، «دریافت» و «ارسال لینک» مراجعهٔ فعلی را از selectedStudy می‌خوانند.
function selectVisit(study){
 if(!study)return;
 selectedStudyID=study.studyID;selectedStudy=study;window.selectedStudy=study;
}
function closeStudyImageMenus(){
 document.querySelectorAll(".study-image-menu-box").forEach(m=>m.classList.add("hidden"));
 document.querySelectorAll(".study-image-menu-button").forEach(b=>b.setAttribute("aria-expanded","false"));
}
document.addEventListener("click",closeStudyImageMenus);

// اگر بیمار هیچ تصویری نداشته باشد، «الصاق تصویر موجود از پرونده» معنا ندارد.
let patientHasImages = true;
function applyAttachAvailability(hasImages){
 patientHasImages = hasImages;
 document.querySelectorAll("[data-needs-images]").forEach(el=>el.classList.toggle("hidden",!hasImages));
}

// مبدأ را قبل از عوض شدن صفحه ثبت می‌کنیم تا «بازگشت به مراجعه» دقیقاً به
// همان‌جایی برگردد که آپلود از آنجا صدا زده شده (مراجعه، صفحهٔ تصاویر، یا پرونده).
let uploadReturnTo = null;
async function openUploadImageForm(study){
 uploadReturnTo = !E.studyImagesSection.classList.contains("hidden") ? {kind:"images",study}
   : !E.studyDetailsSection.classList.contains("hidden") ? {kind:"details",study}
   : {kind:"record",patientID:selectedPatientID};
 selectVisit(study);
 E.imageFileInput.value="";if(E.uploadImageType)E.uploadImageType.value="";resetCameraCapture();setFormStatus(E.uploadImageStatus,"",false);E.uploadImageStudyInfo.textContent=`مراجعهٔ شمارهٔ ${study.studyID} — ${study.studyType||""}`;hideMainSections();E.uploadImageSection.classList.remove("hidden");try{await loadImageTypes();}catch(e){setFormStatus(E.uploadImageStatus,e.message,true);}window.scrollTo(0,0);}
E.cameraFileInput?.addEventListener("change",()=>{const f=E.cameraFileInput.files?.[0];if(!f)return;pendingCameraFile=f;if(cameraPreviewUrl)URL.revokeObjectURL(cameraPreviewUrl);cameraPreviewUrl=URL.createObjectURL(f);E.cameraPreviewImage.src=cameraPreviewUrl;E.cameraPreviewPanel.classList.remove("hidden");setFormStatus(E.uploadImageStatus,"پیش‌نمایش را بررسی و سپس «تأیید تصویر» را انتخاب کنید.",false);});
E.confirmCameraButton?.addEventListener("click",()=>{if(!pendingCameraFile)return;E.imageFileInput.value="";syncFilePickerNames();setFormStatus(E.uploadImageStatus,"تصویر تأیید شد و آماده ذخیره است؛ «ذخیره و اتصال به Study» را بزنید.",false);});
E.uploadImageType?.addEventListener("change",()=>E.uploadImageType.classList.remove("field-missing"));
// The browser's own file control reads "Choose File". The Persian button is the
// visible face of .file-picker and the input stays transparent on top of it, so a
// tap anywhere on the row opens the picker and no English text is ever shown.
function syncFilePickerNames(){[["imageFileInput","فایلی انتخاب نشده"],["cameraFileInput","عکسی گرفته نشده"]].forEach(([id,emptyText])=>{const input=byId(id);const name=input?.closest(".file-picker")?.querySelector(".file-picker-name");if(name)name.textContent=input?.files?.[0]?.name||emptyText;});}
["imageFileInput","cameraFileInput"].forEach(id=>byId(id)?.addEventListener("change",syncFilePickerNames));
syncFilePickerNames();
E.retakeCameraButton?.addEventListener("click",()=>{resetCameraCapture();E.cameraFileInput.click();});
async function uploadImage(){try{if(!selectedStudyID)throw new Error("مراجعه انتخاب نشده است.");/* نوع تصویر را هوش مصنوعی پس از آپلود تعیین می‌کند */const file=pendingCameraFile||E.imageFileInput.files?.[0];if(!file)throw new Error("یک فایل یا تصویر دوربین انتخاب کنید.");const isImage=(file.type||"").toLowerCase().startsWith("image/"),isPdf=(file.type||"").toLowerCase()==="application/pdf"||(file.name||"").toLowerCase().endsWith(".pdf");if(!isImage&&!isPdf)throw new Error("فایل انتخاب‌شده باید تصویر یا PDF باشد.");const send=(allowDuplicate)=>{const fd=new FormData();fd.append("file",file);return fetch(`/api/radiologyimages?studyID=${selectedStudyID}${allowDuplicate?"&allowDuplicate=true":""}`,{method:"POST",body:fd});};setFormStatus(E.uploadImageStatus,"در حال ذخیره و اتصال فایل...",false);let r=await send(false),x=await readApiJson(r);if(r.status===409&&x&&x.duplicate){/* The same picture was already stored for this patient. The server stopped before saving; only the operator can decide it is not a mistake. */const when=x.existing?.createdDate?new Date(x.existing.createdDate).toLocaleDateString("fa-IR"):"";const go=await askConfirmation({title:"تصویر تکراری",message:`${x.message}${when?` تاریخ ثبت قبلی: ${when}.`: ""} آیا می‌خواهید با این حال ذخیره شود؟`,confirmText:"ذخیره شود",danger:false});if(!go){setFormStatus(E.uploadImageStatus,"ذخیره لغو شد؛ تصویر تکراری ثبت نشد.",false);return;}r=await send(true);x=await readApiJson(r);}if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"ذخیره فایل انجام نشد."));resetCameraCapture();if(x.imageID&&!x.converted){setFormStatus(E.uploadImageStatus,"در حال تشخیص نوع تصویر با هوش مصنوعی...",false);try{const cr=await fetch(`/api/ai/images/${x.imageID}/classify`,{method:"POST"}),cx=await readApiJson(cr);if(cr.ok&&cx.success&&cx.imageTypeName)x.aiTypeName=cx.imageTypeName;}catch{/* تشخیصِ نوع اختیاری است؛ تصویر بدونِ نوع هم ذخیره می‌ماند */}}if(selectedStudy){selectedStudy.imageCount=(selectedStudy.imageCount||0)+1;applyAttachAvailability(true);openStudyImages(selectedStudy);}else await openPatient(selectedPatientID);showToast(x.converted?`PDF به ${x.imageCount} تصویر تبدیل و ذخیره شد.`:`فایل با موفقیت ذخیره شد: ${x.fileName}`);}catch(e){setFormStatus(E.uploadImageStatus,e.message,true);/* The status line sits above the buttons and is easy to miss on a phone, so failures are repeated as a toast. */showToast(e.message,"error");}}

function patientExtraPayload(prefix){
 const val=key=>{const el=byId(prefix+key);return el?el.value:"";};
 const insType=key=>{const v=val(key);return v===""?null:Number(v);};
 const base=insType("BaseInsuranceType"),s1=insType("Supp1InsuranceType"),s2=insType("Supp2InsuranceType");
 // بیمهٔ تکمیلی تکراری ممنوع است (فقط وقتی هر دو پرشدهاند).
 const supp1=byId(prefix+"Supp1InsuranceType"),supp2=byId(prefix+"Supp2InsuranceType");
 supp1?.setCustomValidity("");supp2?.setCustomValidity("");
 if(s1&&s2&&s1===s2){supp1?.setCustomValidity("بیمهٔ تکمیلی تکراری است.");throw new Error("بیمهٔ تکمیلی ۱ و ۲ نباید یکسان باشند.");}
 return{
  bloodType:emptyToNull(val("BloodType")),
  mobile2:normalizePhone(val("Mobile2")),
  emergencyContactName:emptyToNull(val("EmergencyContactName")),
  emergencyContactRelation:emptyToNull(val("EmergencyContactRelation")),
  emergencyContactPhone:normalizePhone(val("EmergencyContactPhone")),
  baseInsuranceTypeID:base,baseInsuranceNo:emptyToNull(val("BaseInsuranceNo")),
  supp1InsuranceTypeID:s1,supp1InsuranceNo:emptyToNull(val("Supp1InsuranceNo")),
  supp2InsuranceTypeID:s2,supp2InsuranceNo:emptyToNull(val("Supp2InsuranceNo")),
  fileNumber:emptyToNull(val("FileNumber")),
  contactPreference:emptyToNull(val("ContactPreference"))
 };
}
function patientPayload(prefix){const f=E[`${prefix}FirstName`].value.trim(),l=E[`${prefix}LastName`].value.trim(),n=normalizeDigits(E[`${prefix}NationalCode`].value.trim()),m=normalizePhone(E[`${prefix}Mobile`].value);validatePatientFields(f,l,n,m,E[`${prefix}Gender`].value);return{nationalCode:n,firstName:f,lastName:l,birthDate:parsePersianDateForBackend(E[`${prefix}BirthDate`].value,false),gender:E[`${prefix}Gender`].value===""?null:+E[`${prefix}Gender`].value,mobile:m,address:emptyToNull(E[`${prefix}Address`].value),description:emptyToNull(E[`${prefix}Description`].value),...patientExtraPayload(prefix)};}

// ---- دیکشنری بیمه (کشوها) -------------------------------------------------
// پایه و تکمیلی از یک دیکشنری می‌آیند ولی در کشوهای جدا نشان داده می‌شوند.
// تکمیلی‌ها نامزدِ دیگری را حذف می‌کنند تا یک نوع دو بار انتخاب نشود.
let insuranceCache={base:[],supplementary:[]};
async function loadInsuranceOptions(){
 try{
  const r=await fetch("/api/insurances",{cache:"no-store"}),x=await readApiJson(r);
  if(r.ok&&x.success){insuranceCache={base:x.baseInsurances||[],supplementary:x.supplementaryInsurances||[]};}
 }catch(_){/* کشو خالی می‌ماند؛ بیمه اختیاری است */}
 ["new","edit"].forEach(prefix=>{
  const base=E[prefix+"BaseInsuranceType"];if(base){const cur=base.value;base.replaceChildren(new Option("ثبت نشده",""));insuranceCache.base.forEach(i=>base.appendChild(new Option(i.insuranceTypeName,String(i.insuranceTypeID))));if(cur&&[...base.options].some(o=>o.value===cur))base.value=cur;}
  ["Supp1","Supp2"].forEach((slot,idx)=>{
   const sel=E[prefix+slot+"InsuranceType"];if(!sel)return;
   const other=E[prefix+(idx===0?"Supp2":"Supp1")+"InsuranceType"];
   const cur=sel.value,otherVal=other?other.value:"";
   sel.replaceChildren(new Option("ثبت نشده",""));
   insuranceCache.supplementary.forEach(i=>{if(String(i.insuranceTypeID)===otherVal)return;sel.appendChild(new Option(i.insuranceTypeName,String(i.insuranceTypeID)));});
   if(cur&&[...sel.options].some(o=>o.value===cur))sel.value=cur;else sel.value="";
  });
 });
 ["new","edit"].forEach(prefix=>{
  ["Supp1","Supp2"].forEach(slot=>{
   const sel=E[prefix+slot+"InsuranceType"];if(!sel||sel.dataset.bound==="1")return;sel.dataset.bound="1";
   sel.addEventListener("change",()=>loadInsuranceOptions());
  });
 });
}
function fillPatientExtras(prefix,p){const set=(key,value)=>{const el=E[prefix+key];if(el)el.value=value??"";};const setSel=(key,value)=>{const el=E[prefix+key];if(el)el.value=value==null?"":String(value);};setSel("BloodType",p.bloodType);set("Mobile2",p.mobile2);set("EmergencyContactName",p.emergencyContactName);set("EmergencyContactRelation",p.emergencyContactRelation);set("EmergencyContactPhone",p.emergencyContactPhone);setSel("BaseInsuranceType",p.baseInsuranceTypeID);set("BaseInsuranceNo",p.baseInsuranceNo);setSel("Supp1InsuranceType",p.supp1InsuranceTypeID);set("Supp1InsuranceNo",p.supp1InsuranceNo);setSel("Supp2InsuranceType",p.supp2InsuranceTypeID);set("Supp2InsuranceNo",p.supp2InsuranceNo);set("FileNumber",p.fileNumber);setSel("ContactPreference",p.contactPreference);const details=E[prefix+"PatientExtraDetails"];if(details)details.open=!!(p.bloodType||p.mobile2||p.emergencyContactName||p.emergencyContactPhone||p.baseInsuranceTypeID||p.supp1InsuranceTypeID||p.supp2InsuranceTypeID||p.fileNumber||p.contactPreference);}

function openNewPatientForm(){window.ReSiRaiPatientDraft&&window.ReSiRaiPatientDraft.mount();window.scrollTo(0,0);}
async function createPatient(){try{const r=await fetch("/api/patients",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(patientPayload("new"))}),x=await readApiJson(r);
 // بازشناسی: کد ملی از قبل هست. به‌جای خطای خشک، پروندهٔ موجود را نشان می‌دهیم.
 if(r.status===409&&x.duplicate){const ex=x.existing||{};const name=`${ex.firstName||""} ${ex.lastName||""}`.trim()||"این بیمار";const go=await askConfirmation({title:"بیمار موجود است",message:`بیمار «${name}» با این کد ملی از قبل در سامانه ثبت شده است. آیا پروندهٔ موجود باز شود؟ (برای ثبت مراجعهٔ جدید همین پرونده را باز کنید.)`,confirmText:"باز کردن پرونده",danger:false});if(go&&ex.patientID){await loadPatients();await openPatient(ex.patientID);}return;}
 if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"ثبت بیمار انجام نشد."));await loadPatients();E.newPatientSection.classList.add("hidden");E.patientsSection.classList.remove("hidden");await loadPatients();showToast("بیمار ثبت شد.");}catch(e){setFormStatus(E.newPatientStatus,e.message,true);}}
function openEditPatientForm(){if(!selectedPatient)return;window.ReSiRaiVisitDraft&&window.ReSiRaiVisitDraft.hideDraft();E.patientsSection.classList.add("hidden");const p=selectedPatient;E.editFirstName.value=p.firstName||"";E.editLastName.value=p.lastName||"";E.editNationalCode.value=p.nationalCode||"";E.editMobile.value=p.mobile||"";E.editBirthDate.value=formatPersianDateForInput(p.birthDate);E.editGender.value=p.gender??"";E.editAddress.value=p.address||"";E.editDescription.value=p.description||"";fillPatientExtras("edit",p);loadInsuranceOptions().then(()=>fillPatientExtras("edit",p));E.editPatientSection.classList.remove("hidden");E.editPatientSection.scrollIntoView({behavior:"smooth",block:"start"});E.editFirstName.focus();window.ReSiRaiDictation&&window.ReSiRaiDictation.remount&&window.ReSiRaiDictation.remount();}
async function updatePatient(){try{const r=await fetch(`/api/patients/${selectedPatientID}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(patientPayload("edit"))}),x=await readApiJson(r);if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"ویرایش بیمار انجام نشد."));E.editPatientSection.classList.add("hidden");E.patientsSection.classList.remove("hidden");await openPatient(selectedPatientID);showToast("اطلاعات بیمار ذخیره شد.");}catch(e){setFormStatus(E.editPatientStatus,e.message,true);}}
function printPatientInformation(){
 if(!selectedPatient){showToast("ابتدا یک بیمار را انتخاب کنید.","error");return;}
 // A separate, escaped document keeps the printed page clean and prevents patient text from becoming HTML.
 const p=selectedPatient,patientCode=formatPatientCode(p.patientID),printWindow=window.open("","_blank");
 if(!printWindow){showToast("مرورگر پنجره چاپ را مسدود کرده است.","error");return;}
 printWindow.opener=null;
 const rows=[
  ["شناسه پرونده",patientCode],["نام و نام خانوادگی",`${p.firstName||""} ${p.lastName||""}`.trim()||"-"],
  ["کد ملی",p.nationalCode||"-"],["موبایل",p.mobile||"-"],["موبایل دوم",p.mobile2||"-"],
  ["تاریخ تولد",(formatPersianDate(p.birthDate)+(patientAgeText(p.birthDate)?` (${patientAgeText(p.birthDate)})`:""))],["جنسیت",formatPatientGender(p.gender)],
   ["گروه خونی",p.bloodType||"نامعلوم"],
   ["بیمهٔ پایه",p.baseInsuranceName?(p.baseInsuranceName+(p.baseInsuranceNo?` — ${p.baseInsuranceNo}`:"")):"ثبت نشده"],
   ["بیمهٔ تکمیلی",[p.supp1InsuranceName,p.supp2InsuranceName].filter(Boolean).join(" ، ")||"ثبت نشده"],
   ["تماس اضطراری",(p.emergencyContactName||p.emergencyContactPhone)?`${p.emergencyContactName||""}${p.emergencyContactRelation?` (${p.emergencyContactRelation})`:""}${p.emergencyContactPhone?` — ${p.emergencyContactPhone}`:""}`.trim():"ثبت نشده"],
   ["شماره پروندهٔ مطب",p.fileNumber||"-"],["ترجیح اطلاع‌رسانی",contactPreferenceLabel(p.contactPreference)],
    ...(Number(p.gender)===2?[["بارداری/شیردهی",p.pregnancyStatus?`${p.pregnancyStatus}${p.pregnancyObservedAt?` — ثبت در ${formatPersianDate(p.pregnancyObservedAt)}`:""}`:"—"]]:[]),
   ["وضعیت",p.isActive?"فعال":"غیرفعال"],["آدرس",p.address||"-"],
  ["توضیحات",p.description||"-"],["تعداد مطالعات",E.studyCount.textContent||"0"],["تعداد تصاویر",E.totalImageCount.textContent||"0"]
 ];
 printWindow.document.write(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>اطلاعات بیمار - ${escapeHtml(patientCode)}</title><style>body{font-family:Tahoma,Arial,sans-serif;margin:28px;color:#17365d}h1{font-size:22px;margin:0 0 6px}.subtitle{color:#60758c;margin-bottom:22px}.sheet{border:1px solid #cfe0ee;border-radius:12px;padding:18px}.row{display:grid;grid-template-columns:150px 1fr;gap:14px;padding:9px 4px;border-bottom:1px solid #e7eff6}.row:last-child{border-bottom:0}.label{font-weight:700;color:#285b8f}.footer{margin-top:20px;font-size:11px;color:#718397}@media print{body{margin:12mm}.sheet{break-inside:avoid}}</style></head><body><img src=\"/images/resirai-logo.svg\" alt=\"رسیرای\" style=\"width:36mm;height:auto;object-fit:contain;display:block;margin-bottom:6mm\"><h1>اطلاعات بیمار</h1><div class="subtitle">${escapeHtml(patientCode)}</div><div class="sheet">${rows.map(([label,value])=>`<div class="row"><div class="label">${escapeHtml(label)}</div><div>${escapeHtml(value)}</div></div>`).join("")}</div><div class="footer"><img src=\"/images/resirai-logo.svg" alt="" style="width:20mm;height:auto;object-fit:contain;display:block;margin-bottom:3mm">چاپ‌شده از سامانه رسیرای</div><script>window.addEventListener("load",()=>window.print());<\/script></body></html>`);
 printWindow.document.close();
}
async function togglePatientActiveStatus(){
 if(!selectedPatient)return;
 const isDeactivating=selectedPatient.isActive;
 if(isDeactivating&&!await askConfirmation({title:"غیرفعال کردن بیمار",message:`آیا پرونده ${selectedPatient.firstName} ${selectedPatient.lastName} غیرفعال شود؟ اطلاعات و مطالعات بیمار حذف نخواهند شد.`,confirmText:"غیرفعال کردن"}))return;
 // Both corresponding controller actions use HttpPut; matching that verb prevents an HTTP 405 response.
 try{const action=isDeactivating?"deactivate":"activate";const r=await fetch(`/api/patients/${selectedPatientID}/${action}`,{method:"PUT"}),x=await readApiJson(r);if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"عملیات انجام نشد."));await openPatient(selectedPatientID);showToast(isDeactivating?"بیمار غیرفعال شد.":"بیمار فعال شد.");}catch(e){showToast(e.message||"عملیات انجام نشد.","error");}
}
async function openNewStudyForm(){
 // بدونِ ناوبری: اول پیش‌نویسِ کارتِ مراجعه (بالایِ لیست) ساخته می‌شود؛
 // اگر ماژول در دسترس نباشد (دودهای قدیمی) به فرمِ قدیمی برمی‌گردیم.
 if(window.ReSiRaiVisitDraft&&window.ReSiRaiVisitDraft.showNew())return;
 if(!Number.isInteger(Number(selectedPatientID))||Number(selectedPatientID)<=0){
  showToast("ابتدا یک بیمار را انتخاب کنید.","error");
  return;
 }
 // فرمِ واحدِ مراجعه: همان #studyDetailsSection، این‌بار در حالتِ «جدید» (بدون StudyID).
 selectedStudyID=null;selectedStudy=null;window.selectedStudy=null;
 setStudyFormMode("new");
 hideMainSections();
 E.studyDetailsSection.classList.remove("hidden");
 E.studyDetailsSection.scrollIntoView({behavior:"smooth",block:"start"});
 E.studyDetailsTitle.textContent="ثبت مراجعهٔ جدید";
 E.studyDetailsDate.textContent="تاریخ و زمان پیش‌فرض، زمان فعلی است.";
 if(E.studyDetailsStatusBadge)E.studyDetailsStatusBadge.replaceChildren();
 setFormStatus(E.studyDetailsStatus,"",false);
 E.newStudyForm.reset();
 // تاریخِ پیش‌فرض همین حالاست و مراجعهٔ تازه «باز» است (کار هنوز انجام نشده).
 E.newStudyDate.value=toEnglishJalaliInput(new Date(),true);
 E.studyDetailsStatus2.value="1";
 E.studyDetailsFollowUpDate.value="";E.studyDetailsFollowUpNote.value="";
 syncStudyDetailsStatusFields();
 // فیلدِ اسکنِ کارتِ سابقه (ماژولِ study-card-scan) به همین فرم اضافه می‌شود.
 window.ReSiRaiStudyCardScan?.mount();
 // دندان‌هایِ انتخاب‌شده در اسکنِ قبل نباید به مراجعهٔ تازه سرایز کنند.
 const draftChart=byId("newStudyTeethChart");
 if(draftChart&&window.ReSiRaiTeethChart)window.ReSiRaiTeethChart.render(draftChart,[]);
 setStudyDetailsEditing(true);
 // فاکتورها در همین حالت «پیش‌نویس» رندر می‌شوند (بدون StudyID) و بخش‌هایِ مراجعه
 // تا لحظهٔ ثبت فقط در حافظه بافر می‌شوند. پیش‌نویسِ مراجعهٔ انصرافی هم پاک می‌شود.
 const factorsHost=document.getElementById("studyFactorsPanel");
 window.ReSiRaiFactors?.resetDraft?.();
 window.ReSiRaiFactors?.render({studyID:0},factorsHost||undefined);
 window.ReSiRaiStudySections?.resetDraft();
 await window.ReSiRaiStudySections?.render(0);
 E.newStudyType.placeholder="در حال دریافت دلایل مراجعه...";
 E.newStudyType.readOnly=true;
 // فهرستِ پرسنل هم باید تازه باشد: پزشکِ انتخاب‌نشده یعنی بدونِ فیلتر، ولی
 // به‌محضِ انتخابِ پزشک باید فهرستِ نوع‌ها برایِ تخصصِ او ساخته شود.
 await loadDoctors();
 fillDoctorSelect(null);
 await ensureStudyDetailsTypes(0,"");
 // توضیحِ «سایر»ِ مراجعهٔ قبلی نباید به فرمِ تازه سرایز کند (باکس هم پنهان است).
 window.ReSiRaiStudyTypeUI?.setNote("");
 if(window.ReSiRaiStudyTypeUI?.count())E.newStudyType.placeholder="تایپ کنید؛ فهرست با تخصصِ پزشک فیلتر می‌شود…";
 window.ReSiRaiStudyTypeUI?.setEditable(true);
 E.newStudyType.focus();
}
// Public entry point keeps this primary action independent from later optional bindings.
window.ReSiRaiOpenNewStudy=event=>{event?.preventDefault?.();return openNewStudyForm();};
// Study status helpers. The follow-up fields only make sense for "needs another
// study", so they are shown and hidden with the status choice.
function studyStatusLabel(status){return({1:"باز",2:"تمام‌شده",3:"در انتظار"})[Number(status)]||"-";}
function createStudyStatusBadge(study){
 const status=Number(study?.status)||2;
 // Completed is the normal case and needs no badge; only work still outstanding
 // is worth flagging.
 if(status===2)return null;
 const wrap=document.createElement("span");
 wrap.className=`study-status-badge status-${status}`;
 wrap.textContent=studyStatusLabel(status);
 if(status===3&&study.followUpDate){
  const due=new Date(study.followUpDate);
  const overdue=due<=new Date(new Date().toDateString());
  wrap.textContent=`${studyStatusLabel(status)} — ${formatPersianDate(study.followUpDate)}`;
  if(overdue)wrap.classList.add("overdue");
 }
 if(study?.followUpNote)wrap.title=study.followUpNote;
 return wrap;
}
function syncFollowUpVisibility(prefix){
 const sel=E[`${prefix}Status`],box=E[`${prefix}FollowUpBox`];
 if(!sel||!box)return;
 box.classList.toggle("hidden",sel.value!=="3");
}
function setStudyStatusFields(prefix,status,followUpDate,followUpNote){
 const sel=E[`${prefix}Status`];
 if(sel)sel.value=String(status||2);
 if(E[`${prefix}FollowUpDate`])E[`${prefix}FollowUpDate`].value=followUpDate?formatPersianDateForInput(followUpDate):"";
 if(E[`${prefix}FollowUpNote`])E[`${prefix}FollowUpNote`].value=followUpNote||"";
 syncFollowUpVisibility(prefix);
}
function attachStatusToggle(prefix){E[`${prefix}Status`]?.addEventListener("change",()=>syncFollowUpVisibility(prefix));}

// payloadِ مراجعه از فرمِ واحد خوانده می‌شود — هم برایِ ثبتِ مراجعهٔ جدید و هم
// (با شناسه) برایِ ویرایش. فیلدها یکی‌اند؛ فقط حالتِ فرم فرق دارد.
function studyPayload(){
 const stSel=currentStudyTypeSelection();
 const studyTypeID=stSel.id;
 if(!Number.isInteger(studyTypeID)||studyTypeID<=0)throw new Error("دلیل مراجعه را انتخاب کنید.");
 const chart=byId("newStudyTeethChart");
 const status=Number(E.studyDetailsStatus2?.value)||2;
 return{
  studyDate:parsePersianDateForBackend(E.newStudyDate.value,true),
  studyTypeID,
  // توضیحِ «سایر» فقط وقتی همان نوع انتخاب شده باشد می‌رود؛ وگرنه null تا
  // متنِ مراجعهٔ دیگری از این راه پاک نشود.
  studyTypeNote:stSel.note,
  bodyPart:emptyToNull(E.newBodyPart.value),
  description:emptyToNull(E.newStudyDescription.value),
  diagnosis:emptyToNull(E.newStudyDiagnosis.value),
  workEndDate:parsePersianDateForBackend(E.studyDetailsWorkEndDate.value,true)||null,
  toothNumbers:window.ReSiRaiTeethChart?.getSelected(chart)||[],
  status,
  waitStageID:status===3?(Number(E.studyDetailsWaitStage?.value)||null):null,
  followUpDate:status===3?parsePersianDateForBackend(E.studyDetailsFollowUpDate.value,false):null,
  followUpNote:status===3?emptyToNull(E.studyDetailsFollowUpNote.value):null,
  doctorStaffID:Number(E.studyDetailsDoctor?.value)||null
 };
}
// Offers to message the patient after something worth telling them about.
//
// It is a bar under the form, not a dialog, so it never blocks the user: they can
// ignore it and it simply disappears on the next action. Nothing is sent without
// an explicit click, which keeps the clinic in control of every message.
function offerPatientMessage(patientID,reason,preferredTemplate){
 const host=document.querySelector(".page-container");
 if(!host||!patientID)return;
 document.getElementById("patientMessageOffer")?.remove();

 const bar=document.createElement("div");
 bar.id="patientMessageOffer";
 bar.className="message-offer";
 bar.innerHTML='<span class="message-offer-text"></span><button type="button" class="message-offer-send">ارسال پیامک</button><button type="button" class="secondary-button message-offer-dismiss">بعداً</button>';
 bar.querySelector(".message-offer-text").textContent=reason;
 host.prepend(bar);

 const close=()=>bar.remove();
 bar.querySelector(".message-offer-dismiss").onclick=close;
 bar.querySelector(".message-offer-send").onclick=()=>{
  close();
  const study=null;
  const patient=window.selectedPatient;
  if(!patient){
   // The patient record is the anchor the messaging dialog needs.
   openPatient(patientID).then(()=>{
    window.dispatchEvent(new CustomEvent("resirai-offer-message",{detail:{patientID,templateKey:preferredTemplate}}));
   });
   return;
  }
  window.dispatchEvent(new CustomEvent("resirai-offer-message",{detail:{patientID,templateKey:preferredTemplate}}));
 };
}
// ثبتِ مراجعهٔ جدید: POST و سپس همان فرم درجا به حالتِ «مشاهده» می‌رود — پرشی به
// فهرستِ بیمار نیست. پیش‌نویس‌ها (اسکنِ کارت، فاکتورها، بخش‌هایِ مراجعه) پیش از
// بازخوانیِ فرم تسویه می‌شوند تا همان‌جا دیده شوند.
let createStudyInProgress=false;
async function createStudy(){
 if(studyFormMode!=="new"||createStudyInProgress)return;
 const submit=E.newStudySubmitButton;
 createStudyInProgress=true;
 if(submit){submit.disabled=true;submit.textContent="در حال ثبت...";}
 try{
  const body={...studyPayload(),patientID:selectedPatientID};
  const r=await fetch("/api/radiologystudies",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const x=await readApiJson(r);
  if(!r.ok||x.success===false)throw new Error(apiErrorMessage(r,x,"ثبت مراجعه انجام نشد."));
  const savedStudyID=(x.study&&x.study.studyID)||0;
  if(!savedStudyID)throw new Error("مراجعه ثبت شد، ولی شناسهٔ آن برنگشت.");
  await window.ReSiRaiStudyCardScan?.uploadPending(savedStudyID);
  if(window.ReSiRaiFactors?.commitPending){
   try{await window.ReSiRaiFactors.commitPending(savedStudyID);}catch(fe){showToast(fe.message||"ثبت مقادیر شرایط فعلی ناموفق بود.","error");}
  }
  // بخش‌هایِ مراجعه که پیش از ثبت در حافظه بافر شده بودند همین‌جا ذخیره می‌شوند.
  if(window.ReSiRaiStudySections?.flushPending){
   try{await window.ReSiRaiStudySections.flushPending(savedStudyID);}catch(se){showToast(se.message||"بخش‌های مراجعه ذخیره نشدند.","error");}
  }
  // اگر لیستِ پرونده تازه نشد، همانِ دادهٔ پاسخِ ثبت پایهٔ نمایش است.
  const saved={
   ...(x.study||{}),studyID:savedStudyID,
   studyTypeName:currentStudyTypeSelection().name||x.study?.studyTypeName,studyTypeNote:body.studyTypeNote,
   studyDate:body.studyDate,status:body.status,followUpDate:body.followUpDate,followUpNote:body.followUpNote,
   bodyPart:body.bodyPart,description:body.description,diagnosis:body.diagnosis,workEndDate:body.workEndDate,
   doctorStaffID:body.doctorStaffID,waitStageID:body.waitStageID,toothNumbers:body.toothNumbers,
   imageCount:x.study?.imageCount||0,documentCount:x.study?.documentCount||0
  };
  const fresh=await fetchStudyFromWorkspace(savedStudyID);
  // بدونِ ناوبری: پیش‌نویس جمع می‌شود و همین مراجعه در لیستِ همان صفحه دیده می‌شود.
  if(window.ReSiRaiVisitDraft){window.ReSiRaiVisitDraft.forget();window.ReSiRaiVisitDraft.suppress();}
  await openPatient(selectedPatientID);
  scrollToStudyCard(savedStudyID);
  showToast("مراجعه ثبت شد.");
  // A study recorded for a future date is a booked visit, so a reminder makes sense.
  const shown=fresh||saved;
  if(Number(shown.status)===3&&shown.followUpDate){
   offerPatientMessage(selectedPatientID,"برای نوبت پیگیری این مطالعه، به بیمار یادآوری بفرستیم؟","appointment-reminder");
  }else if(Number(shown.status)===1){
   offerPatientMessage(selectedPatientID,"برای این مطالعه جدید به بیمار اطلاع بفرستیم؟","images-ready");
  }
 }catch(e){setFormStatus(E.studyDetailsStatus,getApiError({message:e.message},"ثبت مراجعه انجام نشد."),true);
 }finally{createStudyInProgress=false;if(submit){submit.disabled=false;submit.textContent="ثبت مراجعه";}}
}
// مراجعهٔ تازه از سرور خوانده می‌شود تا فرم همان داده‌ای را نشان دهد که لیستِ پرونده نشان می‌دهد.
async function fetchStudyFromWorkspace(studyID){
 try{
  const pr=await fetch(`/api/patients/${selectedPatientID}/details`,{cache:"no-store"}),pd=await pr.json();
  if(pr.ok&&pd.success){const fresh=(pd.studies||[]).find(s=>s.studyID===studyID);if(fresh)return fresh;}
 }catch{/* تازه‌سازیِ لیستِ پرونده اختیاری است */}
 return null;
}
function openMergePatientForm(){E.mergePatientForm.reset();setFormStatus(E.mergePatientStatus,`مبدأ: ${selectedPatient.firstName} ${selectedPatient.lastName} — ${selectedPatient.nationalCode}`,false);hideMainSections();E.mergePatientSection.classList.remove("hidden");}
async function mergePatient(){try{const code=normalizeDigits(E.mergeTargetNationalCode.value.trim());const tr=await fetch(`/api/patients/${encodeURIComponent(code)}`),target=await readApiJson(tr);if(!tr.ok)throw new Error(apiErrorMessage(tr,target,"بیمار مقصد پیدا نشد."));if(!await askConfirmation({title:"تأیید ادغام بیمار",message:`مبدأ: ${selectedPatient.nationalCode}\nمقصد: ${target.nationalCode}\nتمام مراجعه‌ها و تصاویر منتقل می‌شوند.`,confirmText:"انجام ادغام"}))return;const r=await fetch("/api/patients/merge",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sourcePatientID:selectedPatientID,targetPatientID:target.patientID})}),x=await readApiJson(r);if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"ادغام انجام نشد."));await loadPatients();await openPatient(target.patientID);showToast("ادغام با موفقیت انجام شد.");}catch(e){setFormStatus(E.mergePatientStatus,e.message,true);}}

enableJalaliDateMask(E.newBirthDate);enableJalaliDateMask(E.editBirthDate);enableJalaliDateTimeMask(E.newStudyDate);enableJalaliDateMask(E.studyDetailsFollowUpDate);window.ReSiRaiJalali?.enhanceAll(document);
// ---- فهرست بیماران: جستجوی زنده، سورت کلیکی و صفحابندی ---------------------
// هر تغییر فیلتر/جستجو/سورت، صفحۀ فعلی را صفر می‌کند تا نتیجه‌ها جابه‌جا نشوند.
function resetPatientList(){patientListState.offset=0;}
E.searchButton.onclick=()=>{resetPatientList();loadPatients(E.patientSearch.value);};E.clearSearchButton.onclick=()=>{resetPatientList();E.patientSearch.value="";loadPatients();};E.patientSearch.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();resetPatientList();loadPatients(E.patientSearch.value);}};
// جستجوی زنده: ۳۵۰ میلی‌ثانیه بعد از آخرین تایپ؛ درخواست‌های قدیمی با توکن رها می‌شوند.
let patientSearchTimer=null;
E.patientSearch.oninput=()=>{clearTimeout(patientSearchTimer);patientSearchTimer=setTimeout(()=>{resetPatientList();loadPatients(E.patientSearch.value);},350);};
E.includeInactivePatients.onchange=()=>{resetPatientList();loadPatients(E.patientSearch.value);};
// ---- سورتِ کلیکی سرستون‌های فهرست بیماران ----------------------------------
// ستون‌های قابلِ سورت با data-sort مشخص می‌شوند؛ کلیک مجدد جهت را برمی‌گرداند.
(function setupPatientSort(){
 const table=document.querySelector(".patient-table-compact");if(!table)return;
 const sortable=[["0","firstname"],["1","nationalcode"],["3","studies"],["4","lastvisit"]];
 sortable.forEach(([colIndex,key])=>{
  const th=table.querySelector(`thead th:nth-child(${Number(colIndex)+1})`);if(!th)return;
  th.dataset.sort=key;th.classList.add("patient-sortable");th.title="برای مرتب‌سازی کلیک کنید";
  th.addEventListener("click",()=>{
   if(patientListState.sortBy===key)patientListState.sortDir=patientListState.sortDir==="asc"?"desc":"asc";
   else{patientListState.sortBy=key;patientListState.sortDir="asc";}
   resetPatientList();
   table.querySelectorAll("thead th").forEach(x=>{x.classList.remove("sort-asc","sort-desc");delete x.dataset.arrow;});
   th.classList.add(patientListState.sortDir==="asc"?"sort-asc":"sort-desc");
   loadPatients(E.patientSearch.value);
  });
 });
})();
E.openStudiesOnly.onchange=()=>{resetPatientList();loadPatients(E.patientSearch.value);};
E.dueFollowUpOnly.onchange=()=>{E.openStudiesOnly.checked=E.dueFollowUpOnly.checked||E.openStudiesOnly.checked;resetPatientList();loadPatients(E.patientSearch.value);};
 if(E.newPatientButton)E.newPatientButton.onclick=openNewPatientForm; // دکمه حذف شد؛ فقط نگهداری برای فرمهای دیگر
 window.ReSiRaiPatientDraft&&window.ReSiRaiPatientDraft.mount(); // ناحیهٔ معرفی بیمار همیشه بالای فهرست
 if(E.newPatientForm)E.newPatientForm.onsubmit=e=>{e.preventDefault();createPatient();}; // فرمِ یادمانده بدونِ ناوبری (if removed in future versions, keep optional)E.backToPatientsButton.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();showPatientsScreen();});
E.backToPatientDetailsButton?.addEventListener("click",()=>openPatient(selectedPatientID));
E.backToStudyDetailsButton?.addEventListener("click",()=>{if(selectedStudy)openStudyDetails(selectedStudy);});
E.studyDetailsImagesButton?.addEventListener("click",()=>{if(selectedStudy)openStudyImages(selectedStudy);});
E.studyDetailsEditButton?.addEventListener("click",()=>{setStudyFormMode("edit");setStudyDetailsEditing(true);});
E.studyDetailsCancelButton?.addEventListener("click",()=>{
 // در حالتِ جدید «انصراف» یعنی برگشت به پروندهٔ بیمار؛ در حالتِ ویرایش یعنی بازگشت به نمای مراجعه.
 if(studyFormMode==="new")openPatient(selectedPatientID);
 else if(selectedStudy)openStudyDetails(selectedStudy);
});
// فرمِ واحد: submit فقط در حالتِ جدید «ثبت مراجعه» است و در حالتِ ویرایش «ذخیره»؛
// در حالتِ نمایش (Enter روی فیلدهای فقط‌خواندنی) هیچ کاری نمی‌کند.
E.newStudyForm?.addEventListener("submit",e=>{e.preventDefault();
 if(studyFormMode==="new")createStudy();
 else if(studyFormMode==="edit")saveStudyDetails();
});
E.studyDetailsSaveButton?.addEventListener("click",e=>{e.preventDefault();saveStudyDetails();});
E.studyDetailsWorkEndButton?.addEventListener("click",()=>{markWorkEnd();});
// The status decides whether the waiting fields apply, and the doctor decides
// which waiting stages are offered.
E.studyDetailsStatus2?.addEventListener("change",syncStudyDetailsStatusFields);
E.studyDetailsDoctor?.addEventListener("change",()=>{fillWaitStageSelect(null);refilterStudyTypes();});
E.newStudyButton?.addEventListener("click",e=>{e.preventDefault();openNewStudyForm();});
// ثبتِ درجاییِ کارتِ مراجعه (بدونِ ناوبری): رکوردِ تازه کلِ لیست را تازه می‌کند و
// اسکرول به همان مراجعه می‌رود؛ به‌روزرسانیِ یک کارتِ موجود فقط همان کارت را
// اصلاح می‌کند تا بخش‌هایِ بازِ آن (تیک‌محور/فاکتورها) از بین نروند.
window.addEventListener("resirai-visit-created",async e=>{
 const d=e.detail||{},studyID=Number(d.studyID)||0,study=d.study||{};
 try{await openPatient(selectedPatientID);}catch(err){console.warn("Patient workspace refresh failed:",err);}
 scrollToStudyCard(studyID);
 if(Number(study.status)===3&&study.followUpDate)offerPatientMessage(selectedPatientID,"برای نوبت پیگیری این مطالعه، به بیمار یادآوری بفرستیم؟","appointment-reminder");
 else if(Number(study.status)===1)offerPatientMessage(selectedPatientID,"برای این مراجعه جدید به بیمار اطلاع بدهیم؟","images-ready");
});
window.addEventListener("resirai-visit-saved",e=>{
 const s=(e.detail||{}).study||{};
 if(!s.studyID)return;
 const card=document.querySelector(`.study-scroll-card[data-study-id="${s.studyID}"]`);
 if(!card)return;
 const time=card.querySelector(".study-header-main time");
 if(time)time.textContent=formatPersianDateTime(s.studyDate);
 const sum=card.querySelector(".study-summary-line");
 if(sum)sum.textContent=studySummary({imageCount:Number(card.dataset.imageCount)||0,documentCount:Number(card.dataset.documentCount)||0,...s});
});
E.studyDetailsUploadButton?.addEventListener("click",()=>{if(selectedStudy)openUploadImageForm(selectedStudy);});
E.editPatientButton?.addEventListener("click",openEditPatientForm);
E.printPatientButton?.addEventListener("click",printPatientInformation);
E.deactivatePatientButton?.addEventListener("click",togglePatientActiveStatus);
E.deletePatientButton?.addEventListener("click",()=>{if(selectedPatient)deletePatient(selectedPatient);});
E.mergePatientButton?.addEventListener("click",openMergePatientForm);
E.editPatientForm?.addEventListener("submit",e=>{e.preventDefault();updatePatient();});
E.uploadImageForm?.addEventListener("submit",e=>{e.preventDefault();uploadImage();});
E.mergePatientForm?.addEventListener("submit",e=>{e.preventDefault();mergePatient();});
[[E.cancelNewPatientButton,E.cancelNewPatientButtonBottom]].flat().forEach(b=>b.onclick=()=>{E.newPatientSection?.classList.add("hidden");E.patientsSection?.classList.remove("hidden");showPatientsScreen();});[E.cancelEditPatientButton,E.cancelEditPatientButtonBottom,E.cancelNewStudyButtonBottom,E.cancelMergePatientButton,E.cancelMergePatientButtonBottom].forEach(b=>b&&(b.onclick=()=>{E.editPatientSection?.classList.add("hidden");E.patientsSection?.classList.remove("hidden");openPatient(selectedPatientID);}));// بازگشت از فرم آپلود به همان‌جایی که فراخوانده شده (برچسب: «بازگشت به مراجعه»).
function goBackFromUpload(){
 const r = uploadReturnTo;
 if (r && r.kind === "images" && r.study) return openStudyImages(r.study);
 if (r && r.kind === "details" && r.study) return openStudyDetails(r.study);
 openPatient((r && r.patientID) || selectedPatientID);
}
[E.cancelUploadImageButton,E.cancelUploadImageButtonBottom].forEach(b=>b.onclick=goBackFromUpload);
// دکمهٔ «عکس/فایل جدید» در هدر مراجعه (کنار بقیهٔ کارهای تصویر)
document.getElementById("visitHeaderUploadButton")?.addEventListener("click",()=>{if(selectedStudy)openUploadImageForm(selectedStudy);});
E.patientPhotoButton?.addEventListener("click",()=>E.patientPhotoInput?.click());
E.patientPhotoInput?.addEventListener("change",async()=>{const file=E.patientPhotoInput.files?.[0];if(!file||!selectedPatientID)return;try{const fd=new FormData();fd.append("file",file);const r=await fetch(`/api/patients/${selectedPatientID}/photo`,{method:"POST",body:fd}),x=await readApiJson(r);if(!r.ok||!x.success)throw new Error(apiErrorMessage(r,x,"ذخیره تصویر بیمار انجام نشد."));E.patientProfilePhoto.src=`/api/patients/${selectedPatientID}/photo?v=${Date.now()}`;E.patientProfilePhoto.classList.remove("empty");showToast("تصویر بیمار ذخیره شد.");}catch(e){showToast(e.message||"ذخیره تصویر بیمار انجام نشد.","error");}finally{E.patientPhotoInput.value="";}});
E.zoomInImageButton.onclick=()=>{imageViewScale=Math.min(5,imageViewScale+0.25);applyImageView();};E.zoomOutImageButton.onclick=()=>{imageViewScale=Math.max(0.25,imageViewScale-0.25);applyImageView();};E.rotateLeftImageButton.onclick=()=>{imageViewRotation-=90;applyImageView();};E.rotateRightImageButton.onclick=()=>{imageViewRotation+=90;applyImageView();};E.flipHorizontalImageButton.onclick=()=>{imageViewFlipX*=-1;applyImageView();};E.resetImageViewButton.onclick=resetImageView;E.imageModal.addEventListener("pointerdown",e=>{if(e.target!==E.largeImage)return;e.preventDefault();imageDragging=true;imageDragStartX=e.clientX-imageViewX;imageDragStartY=e.clientY-imageViewY;try{E.imageModal.setPointerCapture(e.pointerId);}catch{}});E.imageModal.addEventListener("pointermove",e=>{if(!imageDragging)return;e.preventDefault();imageViewX=e.clientX-imageDragStartX;imageViewY=e.clientY-imageDragStartY;applyImageView();});const endImageDrag=e=>{if(!imageDragging)return;imageDragging=false;try{E.imageModal.releasePointerCapture(e.pointerId);}catch{}};E.imageModal.addEventListener("pointerup",endImageDrag);E.imageModal.addEventListener("pointercancel",endImageDrag);E.imageModal.addEventListener("lostpointercapture",()=>{imageDragging=false;});E.closeImageModalButton.onclick=closeLargeImage;E.imageModal.onclick=e=>{if(imageDragging){e.preventDefault();e.stopPropagation();return;}/* The viewer closes only with the explicit close button or Escape. This prevents a completed image drag from being interpreted as a backdrop click. */};document.addEventListener("keydown",e=>{if(e.key==="Escape")closeLargeImage();});
// Initial load. On first paint the login form is shown, so these requests are
// intentionally blocked by the auth gate; running them then would leave the
// patient list empty forever. Load now when already authenticated, and reload
// after a successful sign-in (the gate flips to authed and this event fires).
function loadApplicationData(){
  try{ loadPatients(); }catch(_){}
  window.ReSiRaiPatientDraft&&window.ReSiRaiPatientDraft.mount(); // ناحیهٔ معرفیِ بیمار پس از ورود هم آماده باشد
  // If the dashboard is the visible page (the default after login), refresh it;
  // its own startup fetch ran while the gate was still guest.
  const dashboard=document.getElementById("dashboardSection");
  if(dashboard&&!dashboard.classList.contains("hidden")){ try{ window.ReSiRaiNavigation?.navigate("dashboard"); }catch(_){} }
}
window.addEventListener("resirai-auth-changed",e=>{ if(e.detail) loadApplicationData(); });
if(window.reSiRaiCurrentUser) loadApplicationData();
// ← for patient-draft.js (بدونِ ناوبری) و ابزارهای دیگر
window.openPatient=openPatient;window.openPatientInline=openPatientInline;window.openEditPatientForm=openEditPatientForm;window.loadPatients=loadPatients;
