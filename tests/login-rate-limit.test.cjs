const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../ReSiRai.Api/wwwroot/js/login-ui.js'), 'utf8');

async function submitLogin(response) {
  const elements = new Map();
  const element = () => ({ value: '', checked: false, disabled: false, classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, focus() {}, setAttribute() {}, appendChild() {}, remove() {} });
  const document = {
    readyState: 'complete',
    body: { ...element(), prepend(screen) { elements.set(screen.id, screen); } },
    head: element(), documentElement: element(),
    querySelector() { return null; }, querySelectorAll() { return []; },
    getElementById(id) {
      if (id === 'reSiRaiLoginScreen' || id === 'reSiRaiUserControl' || id === 'reSiRaiFinalLoginCss') return elements.get(id);
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element
  };
  const context = { document, window: { scrollTo() {}, dispatchEvent() {} },
    fetch: async url => url === '/api/auth/me' ? { ok: true, json: async () => ({ success: false }) } : response,
    CustomEvent: class {}, setTimeout, console };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  document.getElementById('loginUserName').value = '09123456789';
  document.getElementById('loginPassword').value = 'password';
  await document.getElementById('reSiRaiLoginForm').onsubmit({ preventDefault() {} });
  return { status: document.getElementById('loginStatus').textContent, password: document.getElementById('loginPassword').value, disabled: document.getElementById('loginSubmit').disabled };
}

test('429 shows Persian rate-limit message and wait instead of wrong-password message', async () => {
  const result = await submitLogin({ ok: false, status: 429, headers: { get: () => '900' }, json: async () => ({ success: false, message: 'تعداد تلاش‌های ورود بیش از حد مجاز است.' }) });
  assert.match(result.status, /تعداد تلاش‌های ورود/);
  assert.match(result.status, /۱۵ دقیقه/);
  assert.doesNotMatch(result.status, /رمز عبور صحیح نیست/);
  assert.equal(result.password, '');
  assert.equal(result.disabled, false);
});

test('429 can use retry duration in JSON when header is absent', async () => {
  const result = await submitLogin({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({ success: false, retryAfterSeconds: 61 }) });
  assert.match(result.status, /۲ دقیقه/);
});

test('ordinary authentication failure keeps generic credential error', async () => {
  const result = await submitLogin({ ok: false, status: 401, json: async () => ({ success: false }) });
  assert.match(result.status, /شماره موبایل\/کد ملی یا رمز عبور صحیح نیست/);
});
