const express = require('express');
const path = require('node:path');

const app = express();
const root = path.join(__dirname, '..');

app.set('views', path.join(root, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(root, 'public')));
app.use(express.static(path.join(root, 'public/landing')));

const settings = {
  company_header: 'Elround Network',
  company_phone: '081234567890',
  login_otp_enabled: false
};
app.get(['/', '/customer/login'], (_req, res) => {
  res.sendFile(path.join(root, 'public/landing/index.html'));
});

app.get('/customer/signin', (_req, res) => {
  res.render('login', {
    settings,
    error: null,
    lang: 'id',
    t: (_key, fallback) => fallback
  });
});

app.listen(Number(process.env.PORT) || 43179, '127.0.0.1');
