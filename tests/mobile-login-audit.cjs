const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const root = path.resolve('ReSiRai.Api/wwwroot');
const output = path.resolve('mobile-login-audit');
fs.mkdirSync(output, { recursive: true });
const program = fs.readFileSync(path.join(root, '../Program.cs'), 'utf8');
const extra = [...program.matchAll(/src=\\"(\/js\/[^\\]+)\\"/g)]
  .map(x => `<script src="${x[1]}"></script>`).join('\n');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/' || pathname === '/index.html') {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
      .replace('</head>', '<link rel="stylesheet" href="/css/login.css"><link rel="stylesheet" href="/css/card-extraction.css"></head>')
      .replace('</body>', extra + '</body>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html); return;
  }
  const file = path.join(root, pathname);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', ({ '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
async function measure(page) {
  return page.evaluate(() => {
    const selectors = ['#reSiRaiLoginScreen', '.login-shell', '.login-form-panel', '.login-form-logo', '.login-form-heading', '.login-id-tabs', '#loginUserName', '#loginPassword', '#toggleLoginPassword', '.login-options', '#forgotPasswordButton', '#loginStatus', '#loginFeedbackEmoji', '#loginSubmit', '.login-footer', '#recoveryNationalCode', '#recoveryCode', '#newRecoveryPassword', '#newRecoveryPassword2', '.login-submit'];
    const elements = {};
    for (const selector of selectors) {
      const e = document.querySelector(selector);
      if (!e) continue;
      const r = e.getBoundingClientRect(), c = getComputedStyle(e);
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      elements[selector] = {
        x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom,
        fullyInViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
        centerHit: !!hit && (hit === e || e.contains(hit)),
        fontSize: c.fontSize, lineHeight: c.lineHeight, overflowY: c.overflowY,
        flexShrink: c.flexShrink, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight,
        scrollTop: e.scrollTop, text: selector.includes('Status') || selector.includes('Emoji') ? e.textContent : undefined,
      };
    }
    return { width: innerWidth, height: innerHeight, visualHeight: visualViewport.height, pageScroll: scrollY, documentHeight: document.documentElement.scrollHeight, active: document.activeElement.id, elements };
  });
}
async function capture(page, name) {
  await page.screenshot({ path: path.join(output, name + '.png') });
  return measure(page);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  const viewports = [[320,568], [360,640], [390,844], [430,932], [844,390], [390,360], [768,1024], [1366,768]];
  for (const [width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width <= 1050, hasTouch: width <= 1050, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let scenario = 401;
    await page.route('**/api/**', async route => {
      const url = route.request().url();
      if (url.includes('/api/auth/login')) {
        await route.fulfill({ status: scenario, contentType: 'application/json', headers: scenario === 429 ? { 'Retry-After': '900' } : {}, body: JSON.stringify({ success: false, failedAttempts: scenario === 429 ? 5 : 1, retryAfterSeconds: 900, message: scenario === 429 ? 'تعداد تلاش‌های ورود بیش از حد مجاز است.' : 'Invalid username or password.' }) });
      } else if (url.includes('/api/auth/forgot-password')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: 'درخواست ثبت شد.' }) });
      } else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, authenticated: false }) });
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForSelector('#loginPassword');
    await page.waitForFunction(() => [...document.styleSheets].some(x => x.href?.includes('login-final.css')));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const name = width + 'x' + height;
    const initial = await capture(page, name + '-initial');
    await page.evaluate(() => {
      document.getElementById('loginUserName').value = '1234567890';
      document.getElementById('loginPassword').value = 'wrong';
      document.getElementById('reSiRaiLoginForm').requestSubmit();
    });
    await page.waitForFunction(() => document.getElementById('loginFeedbackEmoji').textContent === '😕');
    const wrong = await capture(page, name + '-wrong');
    scenario = 429;
    await page.evaluate(() => {
      document.getElementById('loginPassword').value = 'wrong';
      document.getElementById('reSiRaiLoginForm').requestSubmit();
    });
    await page.waitForFunction(() => document.getElementById('loginFeedbackEmoji').textContent === '😔🔒');
    const blocked = await capture(page, name + '-blocked');
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(150);
    const afterWheel = await measure(page);
    await page.evaluate(() => document.getElementById('forgotPasswordButton').click());
    const recovery = await capture(page, name + '-recovery');
    await page.evaluate(() => document.getElementById('recoveryRequestForm').requestSubmit());
    await page.waitForSelector('#recoveryCode');
    await page.evaluate(() => document.fonts.ready);
    const verify = await capture(page, name + '-verify');
    results.push({ viewport: { width, height }, initial, wrong, blocked, afterWheel, recovery, verify, errors });
    await context.close();
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(r => ({ viewport: r.viewport, states: Object.fromEntries(['initial', 'wrong', 'blocked', 'verify'].map(k => [k, { panel: r[k].elements['.login-form-panel'], submit: r[k].elements['.login-submit'] }])), errors: r.errors }))));
  await browser.close();
  server.close();
})().catch(e => { console.error(e); server.close(); process.exit(1); });
