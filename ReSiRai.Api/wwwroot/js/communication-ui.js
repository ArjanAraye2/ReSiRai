(() => {
    const addStyles = () => {
        if (document.getElementById("communicationUiStyles")) return;
        const style = document.createElement("style");
        style.id = "communicationUiStyles";
        style.textContent = `
            .communication-channel-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px}
            .communication-channel-card{padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#fbfdff}
            .communication-channel-card strong{display:block;margin-bottom:5px}.communication-channel-card span{color:#64748b;font-size:13px}
            .communication-settings-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}
            @media(max-width:720px){.communication-channel-grid{grid-template-columns:1fr}}
        `;
        document.head.appendChild(style);
    };
    function init() {
        addStyles();
        const nav = document.querySelector(".sidebar-nav");
        if (!nav || nav.querySelector('[data-nav="communications"]')) return;
        const link = document.createElement("a");
        link.href="#"; link.className="sidebar-link"; link.dataset.nav="communications";
        link.innerHTML='<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="m3.5 7 7.4 5.4a2 2 0 0 0 2.2 0L20.5 7"/></svg></span>ارتباطات';
        nav.insertBefore(link, nav.querySelector('[data-nav="settings"]'));

        const main = document.querySelector(".page-container");
        const section=document.createElement("section");
        section.id="communicationsSection"; section.className="card hidden shell-page";
        section.innerHTML=`
          <div class="section-header"><div><h2>ارتباطات با بیماران</h2><p>مدیریت پیامک و کانال‌های ارتباطی ReSiRai</p></div></div>
          <div class="communication-channel-grid">
            <div class="communication-channel-card"><strong>SMS</strong><span id="commSmsStatus">در حال دریافت وضعیت...</span></div>
            <div class="communication-channel-card"><strong>Push Notification</strong><span id="commPushStatus">آماده برای دستگاه‌های ثبت‌شده</span></div>
            <div class="communication-channel-card"><strong>Email</strong><span id="commEmailStatus">اختیاری</span></div>
            <div class="communication-channel-card"><strong>WhatsApp / Telegram</strong><span>اختیاری و وابسته به دسترسی سرویس</span></div>
          </div>
          <div class="section-header" style="margin-top:28px"><div><h3>تنظیمات پیامک</h3><p>کاوه‌نگار به‌صورت پیش‌فرض انتخاب شده و ارائه‌دهنده بعداً قابل تغییر است.</p></div></div>
          <div class="form-grid">
            <div class="form-field"><label>ارائه‌دهنده</label><input id="commSmsProvider" value="Kavenegar" /></div>
            <div class="form-field"><label>API URL</label><input id="commSmsApiUrl" /></div>
            <div class="form-field"><label>API Key</label><input id="commSmsApiKey" type="password" autocomplete="off" /></div>
            <div class="form-field"><label>شماره / خط ارسال</label><input id="commSmsSender" /></div>
            <div class="form-field"><label>نام الگوی OTP (اختیاری)</label><input id="commSmsOtpTemplate" /></div>
            <div class="form-field"><label>شمارهٔ موبایل مطب</label><input id="commClinicMobile" inputmode="tel" placeholder="09…" /><small class="field-hint">برای گرفتن پیامکی که بیمار به مطب فوروارد می‌کند</small></div>
          </div>
          <div class="checkbox-row"><input id="commSmsEnabled" type="checkbox"><span>ارسال پیامک فعال باشد</span></div>
          <div class="communication-settings-actions"><button id="commSaveButton" type="button">ذخیره تنظیمات</button><button id="commTestButton" type="button" class="secondary-button">تست ارسال</button></div>
          <div id="commStatus" class="status-message"></div>

          <div class="section-header" style="margin-top:28px"><div><h3>درگاه پرداخت سپ (Shaparak SEP)</h3><p>پرداخت بیماران و اشتراک‌ها از طریق درگاه سپ انجام می‌شود.</p></div></div>
          <div class="form-grid">
            <div class="form-field"><label>شناسه ترمینال سپ (Terminal ID)</label><input id="sepTerminalId" dir="ltr" placeholder="15511832" value="{{sepTerminalId}}" /></div>
          </div>
          <div class="checkbox-row"><input id="sepEnabled" type="checkbox"><span>درگاه سپ فعال باشد</span></div>
          <div class="communication-settings-actions"><button id="sepSaveButton" type="button">ذخیره درگاه</button><button id="sepTestButton" type="button" class="btn btn-info">تست اتصال درگاه</button></div>
          <div id="sepStatus" class="status-message"></div>

          <div class="section-header" style="margin-top:28px"><div><h3>شماره بازیابی رمز کارکنان</h3><p>برای هر کاربر می‌توان یک شماره تأییدشده برای بازیابی رمز ثبت کرد.</p></div></div>
          <div class="form-grid">
            <div class="form-field"><label>کد ملی کاربر</label><input id="commRecoveryNationalCode" maxlength="10" inputmode="numeric"></div>
            <div class="form-field"><label>موبایل بازیابی</label><input id="commRecoveryMobile" maxlength="30" inputmode="tel"></div>
          </div>
          <button id="commRecoverySave" type="button">ذخیره شماره بازیابی</button>
          <div id="commRecoveryStatus" class="status-message"></div>`;
        main.appendChild(section);

        async function loadSettings(){
            const r=await fetch("/api/communications/settings"); if(!r.ok){section.querySelectorAll("input,button").forEach(x=>x.disabled=true);return;}
            const d=await r.json(), s=d.settings||{};
            document.getElementById("commSmsProvider").value=s.smsProvider||"Kavenegar";
            document.getElementById("commSmsApiUrl").value=s.smsApiUrl||"https://api.kavenegar.com/v1";
            document.getElementById("commSmsApiKey").value=s.smsApiKey||"";
            document.getElementById("commSmsSender").value=s.smsSender||"";
            document.getElementById("commSmsOtpTemplate").value=s.smsOtpTemplate||"";
            document.getElementById("commClinicMobile").value=s.clinicMobile||"";
            document.getElementById("commSmsEnabled").checked=!!s.smsEnabled;
            document.getElementById("commSmsStatus").textContent=s.smsEnabled?"فعال":"غیرفعال";
            document.getElementById("sepTerminalId").value=s.sepTerminalId||"";
            document.getElementById("sepEnabled").checked=!!s.sepEnabled;
            document.getElementById("sepStatus").textContent=s.sepEnabled?"فعال":"غیرفعال";
        }
        async function saveSettings(){
            const status=document.getElementById("commStatus");
            const button=document.getElementById("commSaveButton");
            const body={smsProvider:document.getElementById("commSmsProvider").value,smsApiUrl:document.getElementById("commSmsApiUrl").value,smsApiKey:document.getElementById("commSmsApiKey").value,smsSender:document.getElementById("commSmsSender").value,smsOtpTemplate:document.getElementById("commSmsOtpTemplate").value,clinicMobile:document.getElementById("commClinicMobile").value.trim(),smsEnabled:document.getElementById("commSmsEnabled").checked,pushEnabled:true,emailEnabled:false,whatsAppEnabled:false,telegramEnabled:false};
            button.disabled=true;status.classList.remove("error");status.textContent="در حال ذخیره...";
            try{
                const r=await fetch("/api/communications/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
                let d={};try{d=await r.json();}catch{}
                if(!r.ok||d.success===false){
                    /* The server explains the real cause, for example a missing
                       write permission on the settings folder. */
                    status.textContent=d.message||`ذخیره تنظیمات ناموفق بود. (HTTP ${r.status})`;
                    status.classList.add("error");
                    return;
                }
                status.textContent=d.message||"تنظیمات ذخیره شد.";
                document.getElementById("commSmsStatus").textContent=body.smsEnabled?"فعال":"غیرفعال";
                document.getElementById("sepTerminalId").value=body.sepTerminalId||"";
                document.getElementById("sepEnabled").checked=!!body.sepEnabled;
            }catch(e){
                status.textContent="ارتباط با سرور برقرار نشد. دوباره تلاش کنید.";
                status.classList.add("error");
            }finally{button.disabled=false;}
        }
        document.getElementById("commSaveButton").onclick=saveSettings;
        document.getElementById("commTestButton").onclick=async()=>{const mobile=prompt("شماره موبایل تست را وارد کنید:");if(!mobile)return;const status=document.getElementById("commStatus");status.classList.remove("error");status.textContent="در حال ارسال پیام تست...";try{const r=await fetch("/api/communications/sms/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mobile,message:"تست اتصال ReSiRai"})});let d={};try{d=await r.json();}catch{}status.textContent=d.message||"نتیجه تست دریافت نشد.";if(!r.ok||d.success===false)status.classList.add("error");}catch(e){status.textContent="ارتباط با سرور برقرار نشد.";status.classList.add("error");}};
        document.getElementById("commRecoverySave").onclick=async()=>{const nationalCode=document.getElementById("commRecoveryNationalCode").value.trim(),mobile=document.getElementById("commRecoveryMobile").value.trim();const r=await fetch("/api/communications/recovery-mobile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({nationalCode,mobile})});const d=await r.json();document.getElementById("commRecoveryStatus").textContent=d.message||(r.ok?"شماره بازیابی ذخیره شد.":"ذخیره انجام نشد.");};
        document.getElementById("sepSaveButton").onclick=async()=>{const status=document.getElementById("sepStatus");status.textContent="در حال ذخیره...";try{const r=await fetch("/api/communications/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({sepTerminalId:document.getElementById("sepTerminalId").value.trim(),sepEnabled:document.getElementById("sepEnabled").checked})});let d={};try{d=await r.json();}catch{}status.textContent=d.message||(r.ok?"درگاه ذخیره شد.":"ذخیره نشد.");}catch(e){status.textContent="خطا در ذخیره.";status.classList.add("error");}};
        document.getElementById("sepTestButton").onclick=async()=>{const status=document.getElementById("sepStatus");status.textContent="در حال تست درگاه...";try{const r=await fetch("/api/communications/sep/test",{method:"POST",headers:{"Content-Type":"application/json"}});let d={};try{d=await r.json();}catch{}status.textContent=d.detail||"نتیجه تست دریافت نشد.";if(d.ok)status.classList.remove("error");else status.classList.add("error");}catch(e){status.textContent="خطا در تست درگاه.";status.classList.add("error");}};
        link.addEventListener("click",e=>{e.preventDefault();document.querySelectorAll(".page-container > section").forEach(x=>x.classList.add("hidden"));section.classList.remove("hidden");document.querySelectorAll(".sidebar-link").forEach(x=>x.classList.toggle("active",x===link));loadSettings();window.scrollTo(0,0);});
    }
    if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
})();