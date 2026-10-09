// ReSiRai Login UI — approved reference recreation
(function () {
  'use strict';

  const appHeader=()=>document.querySelector('.main-header');
  const appMain=()=>document.querySelector('.page-container');
  const appSidebar=()=>document.querySelector('.app-sidebar');
  // Normalize before filtering: mobile keyboards may emit Persian/Arabic
  // digits, and this listener runs before the shared language listener.
  const identifierDigits=value=>String(value??'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g,'');

  const toothSvg=(stroke='#159bb6')=>'<svg viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13.3 4.8C8.2 5.7 4.9 10 5.4 15.1c.4 4.4 3 7.3 4.8 10.8 1.9 3.6 1.9 10.6 2.9 16.5.6 3.7 2 6.2 4.7 6.2 3.3 0 3.9-5.2 4.4-9.6.5-4.2 1.2-7.1 2.8-7.1s2.3 2.9 2.8 7.1c.5 4.4 1.1 9.6 4.4 9.6 2.7 0 4.1-2.5 4.7-6.2 1-5.9 1-12.9 2.9-16.5 1.8-3.5 4.4-6.4 4.8-10.8.5-5.1-2.8-9.4-7.9-10.3-3.5-.6-6.2.8-8.1 2.2-1.4 1-2.5 1-3.9 0-1.9-1.4-4.6-2.8-8.1-2.2Z" fill="#fff" stroke="'+stroke+'" stroke-width="2.2"/></svg>';

  const iconSvg=type=>{
    if(type==='id') return '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="3.5" width="14" height="17" rx="2.5" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="9" r="2.2" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 16c1.1-2 5.9-2 7 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    if(type==='mobile') return '<svg viewBox="0 0 24 24" fill="none"><rect x="6.5" y="2.5" width="11" height="19" rx="2.2" stroke="currentColor" stroke-width="1.7"/><path d="M10 18.5h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    if(type==='lock') return '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2.2" stroke="currentColor" stroke-width="1.7"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    if(type==='eye') return '<svg viewBox="0 0 24 24" fill="none"><path d="M2.5 12s3.4-5 9.5-5 9.5 5 9.5 5-3.4 5-9.5 5-9.5-5-9.5-5Z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.4" stroke="currentColor" stroke-width="1.7"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.4-2.9 7.9-7 10-4.1-2.1-7-5.6-7-10V6l7-3Z" stroke="currentColor" stroke-width="1.7"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  };

  function setLoginMode(active){
    document.body.classList.toggle('resirai-login-active',active);
    [appHeader(),appMain(),appSidebar()].forEach(el=>el?.classList.toggle('login-app-hidden',active));
  }

  function ensureLogoutControl(user){
    const header=appHeader(); if(!header)return;
    // Re-create the logout control every time the authenticated application is shown.
    let control=document.getElementById('reSiRaiUserControl');
    if(!control){
      control=document.createElement('div');
      control.id='reSiRaiUserControl';
      control.className='header-user-control';
      control.innerHTML='<span id="reSiRaiCurrentUserName" class="header-user-name"></span><button id="reSiRaiLogoutButton" type="button" class="secondary-button header-logout-button">خروج</button>';
      const headerContent=header.querySelector('.header-content')||header;
      headerContent.appendChild(control);
      document.getElementById('reSiRaiLogoutButton').addEventListener('click',window.reSiRaiLogout);
    }
    const name=document.getElementById('reSiRaiCurrentUserName');
    if(name)name.textContent=user.isSuperAdmin?'مدیر سیستم':`${user.firstName||''} ${user.lastName||''}`.trim();
    control.classList.remove('hidden');
  }

  function showApplication(user){
    window.reSiRaiCurrentUser=user;
    // The fetch gate starts each visit as guest (the login form is shown even
    // when an old cookie exists). A successful sign-in must flip it to authed,
    // otherwise every /api request keeps returning a synthetic 401 and the
    // application never loads its data.
    const gate=window.__resiraiAuthGate; gate&&gate.authed();
    document.getElementById('reSiRaiLoginScreen')?.remove();
    setLoginMode(false);
    ensureLogoutControl(user);
    window.dispatchEvent(new CustomEvent('resirai-auth-changed',{detail:user}));
  }

  async function restoreSession(){
    setLoginMode(true);
    // Restore a real session from the auth cookie. While /api/auth/me is in
    // flight the fetch gate holds other /api requests, then releases them as
    // authed (session valid) or guest (show the login form).
    const gate=window.__resiraiAuthGate;
    try{
      const r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
      if(!r.ok){ gate&&gate.guest(); return false; }
      const d=await r.json();
      if(!d.success||!d.user){ gate&&gate.guest(); return false; }
      gate&&gate.authed();
      showApplication(d.user); return true;
    }catch(_){ gate&&gate.guest(); return false; }
  }

  function ensureLoginStyles(){
    if(document.getElementById('reSiRaiFinalLoginCss'))return;
    const l=document.createElement('link');l.id='reSiRaiFinalLoginCss';l.rel='stylesheet';l.href='/css/login-final.css?v=20261009.5';document.head.appendChild(l);
  }

  function updateLoginViewport(){
    const screen=document.getElementById('reSiRaiLoginScreen');
    if(!screen)return;
    const viewport=window.visualViewport;
    // The on-screen keyboard can reduce the visual viewport without changing
    // vh/dvh. Size the mobile scroll area to that visible space. Preserve
    // browser zoom instead of resizing the layout to a pinch-zoomed viewport.
    if(window.matchMedia('(max-width:1050px)').matches&&(!viewport||viewport.scale===1)){
      screen.style.setProperty('--login-viewport-height',`${viewport?.height||window.innerHeight}px`);
    }else screen.style.removeProperty('--login-viewport-height');
  }
  window.addEventListener('resize',updateLoginViewport);
  window.visualViewport?.addEventListener('resize',updateLoginViewport);

  function createLogin(){
    ensureLoginStyles();
    if(document.getElementById('reSiRaiLoginScreen'))return;
    setLoginMode(true);
    const control=document.getElementById('reSiRaiUserControl'); if(control)control.classList.add('hidden');

    const screen=document.createElement('div');
    screen.id='reSiRaiLoginScreen';
    screen.className='login-screen';
    screen.innerHTML=`
      <div class="login-shell">
        <section class="login-form-panel" aria-label="فرم ورود">
          <div class="login-form-logo"><img class="login-logo-img" src="/images/resirai-logo.svg?v=20261001.19" alt="ReSiRai - Medical Intelligence Platform" /></div>
          <div class="login-form-heading"><h2>به ReSiRai خوش آمدید</h2><p>ورود به پلتفرم یکپارچه اطلاعات و هوش پزشکی</p></div>
          <div class="login-id-tabs" role="tablist" aria-label="روش ورود">
            <button type="button" class="login-id-tab active" data-mode="national" role="tab">با کد ملی</button>
            <button type="button" class="login-id-tab" data-mode="mobile" role="tab">با شماره موبایل</button>
          </div>
          <form id="reSiRaiLoginForm" autocomplete="on">
            <div class="login-field">
              <label id="loginIdentifierLabel" for="loginUserName">کد ملی</label>
              <span id="loginIdentifierIcon" class="login-field-icon">${iconSvg('id')}</span>
              <input id="loginUserName" name="username" type="text" inputmode="numeric" autocomplete="username" maxlength="10" required placeholder="کد ملی خود را وارد کنید" />
            </div>
            <div class="login-field">
              <label for="loginPassword">رمز عبور</label>
              <div class="login-password-row">
                <span class="login-field-icon">${iconSvg('lock')}</span>
                <input id="loginPassword" name="password" type="password" autocomplete="current-password" required placeholder="رمز عبور خود را وارد کنید" />
                <button id="toggleLoginPassword" type="button" class="login-password-toggle" aria-label="نمایش رمز عبور">${iconSvg('eye')}</button>
              </div>
            </div>
            <div class="login-options">
              <label class="login-remember"><input id="loginRememberMe" type="checkbox" /> مرا به خاطر بسپار</label>
              <button id="forgotPasswordButton" type="button" class="login-recovery-link">رمز عبور را فراموش کرده‌ام</button>
            </div>
            <div id="loginStatus" class="login-status login-feedback" role="status" aria-live="polite" aria-atomic="true"><span id="loginFeedbackEmoji" class="login-feedback-emoji" aria-hidden="true" hidden></span><span id="loginFeedbackText" class="login-feedback-text"></span></div>
            <button id="loginSubmit" class="login-submit" type="submit"><span>ورود</span><span class="login-submit-arrow">←</span></button>
          </form>
          <p class="login-footer"><span class="login-shield">${iconSvg('shield')}</span>حساب نداری؟ <a href="/signup.html" style="color:#0f766e;font-weight:700;text-decoration:none">ثبت‌نام پزشک جدید</a></p>
        </section>

        <section class="login-brand-panel" aria-label="ReSiRai">
          <img class="login-brand-logo" src="/images/resirai-logo.svg?v=20261001.19" alt="ReSiRai - Medical Intelligence Platform" />
          <h1 class="login-brand-title">پلتفرم یکپارچه اطلاعات و هوش پزشکی</h1>
          <p class="login-brand-subtitle">از داده تا تصمیم بهتر</p>
          <div class="login-landscape" aria-hidden="true">
            <div class="login-wave"><i></i><i></i><i></i></div>
            <b class="login-sprout s1"></b><b class="login-sprout s2"></b><b class="login-sprout s3"></b>
          </div>
          <div class="login-features">
            <div class="login-feature"><strong>اطلاعات یکپارچه</strong><span>دسترسی سریع و امن به داده‌های پزشکی</span></div>
            <div class="login-feature"><strong>تحلیل هوشمند</strong><span>کمک به تشخیص و تصمیم‌گیری بهتر</span></div>
            <div class="login-feature"><strong>پشتیبانی تصمیم‌گیری</strong><span>گزارش‌های ساخت‌یافته و پیشنهادات هوشمند</span></div>
            <div class="login-feature"><strong>امن و قابل اعتماد</strong><span>حفظ محرمانگی و رعایت استانداردها</span></div>
          </div>
          <span class="login-version">نسخه 20261005.2</span>
        </section>
      </div>`;

    document.body.prepend(screen);
    updateLoginViewport();
    // Always open the authentication screen at its real top; the application may have been scrolled before login.
    window.scrollTo(0,0);
    screen.scrollTop=0;
    document.documentElement.scrollTop=0;
    document.body.scrollTop=0;
    const form=document.getElementById('reSiRaiLoginForm'),userName=document.getElementById('loginUserName'),password=document.getElementById('loginPassword');
    const toggle=document.getElementById('toggleLoginPassword'),status=document.getElementById('loginStatus'),submit=document.getElementById('loginSubmit');
    const label=document.getElementById('loginIdentifierLabel'),icon=document.getElementById('loginIdentifierIcon'),remember=document.getElementById('loginRememberMe');
    const feedbackEmoji=document.getElementById('loginFeedbackEmoji'),feedbackText=document.getElementById('loginFeedbackText');
    function setFeedback(message='',tone='',emoji=''){
      status.className=`login-status login-feedback ${tone}`.trim();
      feedbackText.textContent=message;
      feedbackEmoji.textContent=emoji;
      feedbackEmoji.hidden=!emoji;
    }
    function failureEmoji(count){
      const attempt=Number(count);
      return Number.isInteger(attempt)&&attempt>0?['😕','😟','😣','😫'][Math.min(attempt,4)-1]:'😕';
    }
    let mode='national';
    function applyMode(next){
      mode=next; document.querySelectorAll('.login-id-tab').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
      userName.value='';
      if(mode==='mobile'){label.textContent='شماره موبایل';icon.innerHTML=iconSvg('mobile');userName.inputMode='tel';userName.maxLength=11;userName.placeholder='مثال: 09123456789';}
      else{label.textContent='کد ملی';icon.innerHTML=iconSvg('id');userName.inputMode='numeric';userName.maxLength=10;userName.placeholder='کد ملی خود را وارد کنید';}
      setFeedback(); userName.focus();
    }
    document.querySelectorAll('.login-id-tab').forEach(b=>b.onclick=()=>applyMode(b.dataset.mode));
    userName.addEventListener('input',()=>{userName.value=identifierDigits(userName.value).slice(0,mode==='mobile'?11:10);setFeedback();});
    // Clear the previous reaction as the user starts correcting the password;
    // the authoritative attempt count remains on the server.
    password.addEventListener('input',()=>setFeedback());
    toggle.onclick=()=>{const show=password.type==='password';password.type=show?'text':'password';toggle.setAttribute('aria-label',show?'پنهان کردن رمز عبور':'نمایش رمز عبور');};
    form.onsubmit=async e=>{
      e.preventDefault(); if(submit.disabled)return;
      const identifier=userName.value.trim();
      if((mode==='mobile'&&!/^09\d{9}$/.test(identifier))||(mode==='national'&&!/^\d{10}$/.test(identifier))){
        setFeedback(mode==='mobile'?'شماره موبایل معتبر وارد کنید.':'کد ملی ۱۰ رقمی وارد کنید.','error');return;
      }
      setFeedback('در حال ورود...','info');submit.disabled=true;
      let reaction='';
      try{
        const r=await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({userName:identifier,password:password.value,rememberMe:remember.checked})});
        const d=await r.json();
        if(r.status===429){
          reaction='😔🔒';
          const seconds=Number(r.headers.get('Retry-After')||d.retryAfterSeconds);
          const wait=Number.isFinite(seconds)&&seconds>0?` حدود ${Math.ceil(seconds/60).toLocaleString('fa-IR')} دقیقه بعد دوباره تلاش کنید.`:'';
          throw new Error((d.message||'تعداد تلاش‌های ورود بیش از حد مجاز است.')+wait);
        }
        if(r.status===401){
          reaction=failureEmoji(d.failedAttempts);
          throw new Error('شماره موبایل/کد ملی یا رمز عبور صحیح نیست.');
        }
        if(!r.ok||!d.success)throw new Error('ورود انجام نشد. دوباره تلاش کنید.');
        password.value='';showApplication(d.user);
      }catch(err){password.value='';password.focus();setFeedback(err.message||'ورود انجام نشد.','error',reaction);}
      finally{submit.disabled=false;}
    };
    document.getElementById('forgotPasswordButton').onclick=()=>showRecovery(screen,mode==='national'?userName.value.trim():'');
    userName.focus();
  }
  function showRecovery(screen,nationalCode){
    const panel=screen.querySelector('.login-form-panel');
    panel.innerHTML=`
      <div class="login-form-logo"><span class="login-logo-tooth"><img src="/images/resirai-icon.svg?v=20260929.1" alt="" /></span><span class="login-logo-name"><strong><span style="color:#2f3e4e">Re</span><span style="color:#2b9fd6">Si</span><span style="color:#f4511e">Rai</span></strong><small>Medical Intelligence Platform</small></span></div>
      <div class="login-form-heading"><h2>بازیابی رمز عبور</h2><p>کد ملی خود را وارد کنید. اگر شماره بازیابی معتبر ثبت شده باشد، کد برای شما ارسال می‌شود.</p></div>
      <form id="recoveryRequestForm">
        <div class="login-field"><label for="recoveryNationalCode">کد ملی</label><span class="login-field-icon">${iconSvg('id')}</span><input id="recoveryNationalCode" type="text" inputmode="numeric" maxlength="10" value="${String(nationalCode).replace(/"/g,'&quot;')}" required /></div>
        <div id="recoveryStatus" class="login-status"></div>
        <button class="login-submit" type="submit"><span>ارسال کد بازیابی</span></button>
      </form>
      <button id="backToLogin" type="button" class="login-recovery-link">بازگشت به ورود</button>
      <p class="login-footer"><span class="login-shield">${iconSvg('shield')}</span>ورود شما به معنای پذیرش قوانین و مقررات ReSiRai است.</p>`;
    const input=document.getElementById('recoveryNationalCode');
    input.addEventListener('input',()=>input.value=identifierDigits(input.value).slice(0,10));
    document.getElementById('backToLogin').onclick=()=>{screen.remove();createLogin();};
    document.getElementById('recoveryRequestForm').onsubmit=async e=>{
      e.preventDefault();
      const status=document.getElementById('recoveryStatus');
      status.className='login-status info'; status.textContent='در حال ارسال...';
      try{
        const r=await fetch('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nationalCode:input.value.trim()})});
        const d=await r.json(); status.textContent=d.message||'درخواست ثبت شد.';
        setTimeout(()=>showVerify(screen,input.value.trim()),700);
      }catch(_){status.textContent='درخواست انجام نشد. دوباره امتحان کنید.';status.className='login-status error';}
    };
  }

  function showVerify(screen,nationalCode){
    const panel=screen.querySelector('.login-form-panel');
    panel.innerHTML=`
      <div class="login-form-logo"><span class="login-logo-tooth"><img src="/images/resirai-icon.svg?v=20260929.1" alt="" /></span><span class="login-logo-name"><strong><span style="color:#2f3e4e">Re</span><span style="color:#2b9fd6">Si</span><span style="color:#f4511e">Rai</span></strong><small>Medical Intelligence Platform</small></span></div>
      <div class="login-form-heading"><h2>تأیید بازیابی</h2><p>کد ۶ رقمی ارسال‌شده را وارد کنید و سپس رمز جدید را تعیین کنید.</p></div>
      <form id="verifyRecoveryForm">
        <div class="login-field"><label for="recoveryCode">کد تأیید</label><input id="recoveryCode" type="text" inputmode="numeric" maxlength="6" required /></div>
        <div class="login-field"><label for="newRecoveryPassword">رمز عبور جدید</label><input id="newRecoveryPassword" type="password" minlength="8" required /></div>
        <div class="login-field"><label for="newRecoveryPassword2">تکرار رمز عبور</label><input id="newRecoveryPassword2" type="password" minlength="8" required /></div>
        <div id="recoveryVerifyStatus" class="login-status"></div>
        <button class="login-submit" type="submit">تغییر رمز عبور</button>
      </form>`;
    document.getElementById('recoveryCode').addEventListener('input',e=>e.target.value=identifierDigits(e.target.value).slice(0,6));
    document.getElementById('verifyRecoveryForm').onsubmit=async e=>{
      e.preventDefault();
      const status=document.getElementById('recoveryVerifyStatus');
      const p1=document.getElementById('newRecoveryPassword').value,p2=document.getElementById('newRecoveryPassword2').value;
      if(p1!==p2){status.textContent='دو رمز عبور یکسان نیستند.';status.className='login-status error';return;}
      const r=await fetch('/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nationalCode,code:document.getElementById('recoveryCode').value,newPassword:p1})});
      const d=await r.json();
      if(!r.ok||!d.success){status.textContent=d.message||'کد معتبر نیست.';status.className='login-status error';return;}
      status.textContent='رمز عبور تغییر کرد. در حال بازگشت به ورود...';status.className='login-status info';
      setTimeout(()=>{screen.remove();createLogin();},1000);
    };
    document.getElementById('recoveryCode').focus();
  }

  window.reSiRaiLogout=async function(){
    try{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});}
    finally{window.reSiRaiCurrentUser=null;window.dispatchEvent(new CustomEvent('resirai-auth-changed'));createLogin();}
  };

  function loadCommunicationUi(){
    if(document.getElementById('communicationUiScript'))return;
    const s=document.createElement('script');s.id='communicationUiScript';s.src='/js/communication-ui.js?v=20260926.1';document.body.appendChild(s);
  }

  async function initialize(){
    setLoginMode(true);
    const authenticated=await restoreSession();
    if(!authenticated)createLogin();
    else loadCommunicationUi();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();

  // ---- جابجاییِ کارتِ ورود با موس (طرحِ فیش‌دستمزد) --------------------------------
  // همهٔ کارت قابل کشیدن است به‌جز فیلدها و دکمه‌ها. جای کارت در پنل ذخیره می‌شود.
  document.addEventListener("pointerdown", function (e) {
    var card = e.target.closest && e.target.closest(".login-form-panel");
    if (!card || e.button !== 0 || e.pointerType !== "mouse") return;
    if (e.target.closest("input,button,select,textarea,label,a,.login-id-tabs")) return;
    e.preventDefault();
    var r = card.getBoundingClientRect();
    var dx = e.clientX - r.left, dy = e.clientY - r.top;
    card.style.left = r.left + "px";
    card.style.top = r.top + "px";
    card.style.right = "auto"; card.style.bottom = "auto";
    card.style.transform = "none";
    card.style.cursor = "grabbing";
    var move = function (ev) {
      var x = Math.max(4, Math.min(window.innerWidth - 80, ev.clientX - dx));
      var y = Math.max(4, Math.min(window.innerHeight - 40, ev.clientY - dy));
      card.style.left = x + "px"; card.style.top = y + "px";
      try { localStorage.setItem("resiraiLoginCardPos", JSON.stringify({ x: x, y: y })); } catch (_) {}
    };
    var up = function () {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      card.style.cursor = "";
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });

  // جایِ ذخیره‌شدهٔ کارت: بعد از ساختِ صفحهٔ ورود اعمال می‌شود.
  (function restoreCardPos() {
    var apply = function () {
      var card = document.querySelector(".login-form-panel");
      if (!card) return false;
      var p = null;
      try { p = JSON.parse(localStorage.getItem("resiraiLoginCardPos") || "null"); } catch (_) {}
      if (p && typeof p.x === "number" && typeof p.y === "number") {
        card.style.left = Math.min(p.x, window.innerWidth - 80) + "px";
        card.style.top = Math.min(p.y, window.innerHeight - 40) + "px";
        card.style.right = "auto"; card.style.bottom = "auto";
        card.style.transform = "none";
        return true;
      }
      return false;
    };
    if (!apply()) {
      var obs = new MutationObserver(function () { if (apply()) obs.disconnect(); });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    }
  })();
})();
