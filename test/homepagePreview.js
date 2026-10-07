const express = require('express');
const path = require('node:path');

const app = express();
const root = path.join(__dirname, '..');

app.set('views', path.join(root, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(root, 'public')));

const settings = {
  company_header: 'Elround Network',
  company_phone: '081234567890',
  login_otp_enabled: false
};
const packages = [
  { name: 'Home Basic', speed_down: 30000, price: 100000 },
  { name: 'Home Pro', speed_down: 50000, price: 150000 },
  { name: 'Business', speed_down: 100000, price: 250000 },
  { name: 'Gamer Pro', speed_down: 200000, price: 400000 }
];

app.get(['/', '/customer/login'], (_req, res) => {
  res.render('login', {
    settings,
    packages,
    error: null,
    lang: 'id',
    t: (_key, fallback) => fallback
  });
});

app.listen(Number(process.env.PORT) || 43179, '127.0.0.1');
