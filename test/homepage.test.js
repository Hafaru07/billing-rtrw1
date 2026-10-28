const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const template = path.join(__dirname, '../views/login.ejs');
const landingDir = path.join(__dirname, '../public/landing');

function render(overrides = {}) {
  return ejs.renderFile(template, {
    settings: {
      company_header: 'Elround Network',
      company_phone: '081234567890',
      login_otp_enabled: false,
      ...overrides.settings
    },
    error: overrides.error ?? null,
    lang: 'id',
    t: (_key, fallback) => fallback
  });
}

test('landing page includes the customer sign-in link and built assets', () => {
  const html = fs.readFileSync(path.join(landingDir, 'index.html'), 'utf8');
  assert.match(html, /Internet<br>tanpa FUP\./);
  assert.match(html, /class="login-link" href="\/customer\/signin"/);
  assert.match(html, /id="paket"/);
  assert.match(html, /id="cakupan"/);

  const assets = [...html.matchAll(/(?:href|src|component-url|renderer-url)="(\/(?:_astro|mascots)\/[^\"]+)"/g)]
    .map((match) => match[1]);
  assert.ok(assets.length > 0);
  for (const asset of assets) {
    assert.ok(fs.existsSync(path.join(landingDir, asset.slice(1))), `${asset} is missing`);
  }
});

test('customer sign-in contains only the login flow', async () => {
  const html = await render();
  assert.match(html, /method="POST" action="\/customer\/signin"/);
  assert.match(html, /name="phone"[^>]*required/);
  assert.match(html, /name="password"[^>]*required/);
  assert.match(html, /id="password-visibility"/);
  assert.match(html, /id="remember-phone"/);
  assert.match(html, /href="\/">Kembali ke beranda<\/a>/);
  assert.match(html, /href="https:\/\/wa\.me\/6281234567890\?text=/);
  assert.equal((html.match(/<section\b/g) || []).length, 1);
  assert.doesNotMatch(html, /Paket & Tarif|Beli Voucher|Cek Tagihan|Daftar Pemasangan Baru/);
});

test('customer sign-in renders optional states and local fallback links', async () => {
  const html = await render({
    settings: { company_phone: '', login_otp_enabled: true },
    error: 'Login gagal'
  });
  assert.match(html, /href="\/customer\/contact">Lupa kata sandi\?<\/a>/);
  assert.match(html, /Kode OTP akan dikirim via WhatsApp/);
  assert.match(html, /role="alert">Login gagal<\/p>/);
});
