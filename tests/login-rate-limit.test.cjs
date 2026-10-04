const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../ReSiRai.Api/wwwroot/js/login-ui.js'), 'utf8');

async function createLogin() {
  const elements = new Map();
  const element = () => ({ value: '', checked: false, disabled: false, events: {}, classList: { toggle() {}, add() {}, remove() {} }, addEventListener(name, handler) { this.events[name] = handler; }, focus() {}, setAttribute() {}, appendChild() {}, remove() {} });
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
  let response;
  const context = { document, window: { scrollTo() {}, dispatchEvent() {} },
    fetch: async url => {
      if (url === '/api/auth/me') return { ok: true, json: async () => ({ success: false }) };
      if (response instanceof Error) throw response;
      return response;
    },
    CustomEvent: class {}, setTimeout, console };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  document.getElementById('loginUserName').value = '1234567890';
  const state = () => ({ status: document.getElementById('loginFeedbackText').textContent,
    emoji: document.getElementById('loginFeedbackEmoji').textContent,
    emojiHidden: document.getElementById('loginFeedbackEmoji').hidden,
    password: document.getElementById('loginPassword').value, disabled: document.getElementById('loginSubmit').disabled });
  return {
    document, state,
    editPassword() { document.getElementById('loginPassword').events.input(); return state(); },
    editIdentifier() { document.getElementById('loginUserName').events.input(); return state(); },
    async submit(nextResponse) {
      response = nextResponse;
      document.getElementById('loginPassword').value = 'password';
      await document.getElementById('reSiRaiLoginForm').onsubmit({ preventDefault() {} });
      return state();
    }
  };
}

async function submitLogin(response) { return (await createLogin()).submit(response); }

test('429 shows Persian rate-limit message and wait instead of wrong-password message', async () => {
  const result = await submitLogin({ ok: false, status: 429, headers: { get: () => '900' }, json: async () => ({ success: false, message: 'تعداد تلاش‌های ورود بیش از حد مجاز است.' }) });
  assert.match(result.status, /تعداد تلاش‌های ورود/);
  assert.match(result.status, /۱۵ دقیقه/);
  assert.doesNotMatch(result.status, /رمز عبور صحیح نیست/);
  assert.equal(result.password, '');
  assert.equal(result.disabled, false);
  assert.equal(result.emoji, '😔🔒');
  assert.equal(result.emojiHidden, false);
});

test('429 can use retry duration in JSON when header is absent', async () => {
  const result = await submitLogin({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({ success: false, retryAfterSeconds: 61 }) });
  assert.match(result.status, /۲ دقیقه/);
});

test('ordinary authentication failure keeps generic credential error', async () => {
  const result = await submitLogin({ ok: false, status: 401, json: async () => ({ success: false }) });
  assert.match(result.status, /شماره موبایل\/کد ملی یا رمز عبور صحیح نیست/);
  assert.equal(result.emoji, '😕');
});

test('each failed-attempt count selects its reaction using server state', async () => {
  const ui = await createLogin();
  for (const [i, emoji] of ['😕', '😟', '😣', '😫'].entries()) {
    const result = await ui.submit({ ok: false, status: 401, json: async () => ({ success: false, failedAttempts: i + 1 }) });
    assert.equal(result.emoji, emoji);
    assert.equal(result.emojiHidden, false);
  }
  // A new window or successful login resets the server count: the same UI
  // follows count 1 again rather than retaining a browser-local counter.
  const reset = await ui.submit({ ok: false, status: 401, json: async () => ({ success: false, failedAttempts: 1 }) });
  assert.equal(reset.emoji, '😕');
});

test('correcting either field clears the visible reaction', async () => {
  const ui = await createLogin();
  for (const edit of ['editPassword', 'editIdentifier']) {
    await ui.submit({ ok: false, status: 401, json: async () => ({ success: false, failedAttempts: 3 }) });
    const result = ui[edit]();
    assert.equal(result.emojiHidden, true);
    assert.equal(result.status, '');
  }
});

test('network and server errors do not show a wrong-password reaction', async () => {
  const ui = await createLogin();
  for (const response of [new Error('network'), { ok: false, status: 500, json: async () => ({ success: false }) }]) {
    const result = await ui.submit(response);
    assert.equal(result.emojiHidden, true);
    assert.equal(result.emoji, '');
  }
});

test('invalid identifier has no wrong-password emoji', async () => {
  const ui = await createLogin();
  ui.document.getElementById('loginUserName').value = '123';
  const result = await ui.submit({ ok: false, status: 401, json: async () => ({ failedAttempts: 4 }) });
  assert.equal(result.emojiHidden, true);
  assert.match(result.status, /کد ملی ۱۰ رقمی/);
});
