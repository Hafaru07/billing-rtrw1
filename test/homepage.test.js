const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const template = path.join(__dirname, '../views/login.ejs');
const stylesheet = path.join(__dirname, '../public/css/homepage.css');

function render(overrides = {}) {
  return ejs.renderFile(template, {
    settings: {
      company_header: 'Elround Network',
      company_phone: '081234567890',
      login_otp_enabled: false,
      ...overrides.settings
    },
    packages: overrides.packages ?? [
      { name: 'Home Pro', speed_down: 50000, price: 150000 },
      { name: 'Home Basic', speed_down: 30000, price: 100000 }
    ],
    error: overrides.error ?? null,
    lang: 'id',
    t: (_key, fallback) => fallback
  });
}

test('homepage renders the portal form and customer routes', async () => {
  const html = await render();
  assert.match(html, /method="POST" action="\/customer\/login"/);
  assert.match(html, /name="phone"[^>]*required/);
  assert.match(html, /name="password"[^>]*required/);
  assert.match(html, /id="password-visibility"/);
  assert.match(html, /id="remember-phone"/);
  assert.match(html, /href="\/customer\/register"/);
  assert.match(html, /href="\/customer\/check-billing"/);
  assert.match(html, /href="\/customer\/voucher"/);
  assert.match(html, /href="https:\/\/wa\.me\/6281234567890\?text=/);
  assert.ok(html.indexOf('Home Basic') < html.indexOf('Home Pro'));
});

test('homepage renders optional states and local fallback links', async () => {
  const html = await render({
    settings: { company_phone: '', login_otp_enabled: true },
    packages: [],
    error: 'Login gagal'
  });
  assert.match(html, /href="\/customer\/contact">Lupa password\?<\/a>/);
  assert.match(html, /Kode OTP akan dikirim via WhatsApp/);
  assert.match(html, /Belum Ada Paket Dipublikasikan/);
  assert.match(html, /Login gagal/);
});

test('homepage stylesheet references an available hero image', () => {
  const css = fs.readFileSync(stylesheet, 'utf8');
  const image = css.match(/url\('\/img\/(elround-fiber-home-v2\.[^']+)'\)/);
  assert.ok(image);
  assert.ok(fs.statSync(path.join(__dirname, '../public/img', image[1])).size > 0);
});
