const express = require('express');
const path = require('node:path');

const app = express();
const root = path.join(__dirname, '..');
app.set('views', path.join(root, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(root, 'public')));
app.use(express.static(path.join(root, 'public/landing')));

const customer = {
  id: 'preview', phone: '080000000000', status: 'Online',
  model: 'ONT / ONU', rxPower: '-19.8 dBm', pppoeUsername: 'elround-preview',
  totalAssociations: 2, ssid: 'Elround Rumah', ssid5g: 'Elround Rumah',
  hasWifi5g: true, tags: ['preview'], syncInProgress: false
};
const profile = {
  id: 1, name: 'Pelanggan Pratinjau', status: 'active',
  genieacs_tag: 'preview', phone: customer.phone
};
const invoices = [
  { id: 101, status: 'unpaid', amount: 175000, period_month: 10, period_year: 2026, package_name: 'Home Pro' },
  { id: 100, status: 'paid', amount: 175000, period_month: 9, period_year: 2026, package_name: 'Home Pro' }
];

app.get('/customer/dashboard', (_req, res) => {
  res.render('dashboard', {
    customer, profile, invoices, tickets: [], settings: {}, paymentChannels: [],
    trafficMaxDownMbps: 50, trafficMaxUpMbps: 50, connectedUsers: [],
    customerBalance: 0, isLoggedIn: true, showPPOB: false, notif: null,
    lang: 'id', t: (_key, fallback) => fallback
  });
});
app.get('/customer/api/promo-slides', (_req, res) => res.json([]));
app.get('/customer/api/pppoe-traffic', (_req, res) => res.json({ rxMbps: 12.3, txMbps: 2.1 }));
app.listen(Number(process.env.PORT) || 43180, '127.0.0.1');
