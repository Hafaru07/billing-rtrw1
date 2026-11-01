const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { notFoundHandler, errorHandler } = require('../middleware/errorHandler');

test('unknown browser URL renders a 404 page while API requests keep JSON', async (t) => {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));
  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await fetch(`${base}/hahfwae`, {
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
  });
  assert.equal(browser.status, 404);
  assert.match(browser.headers.get('content-type'), /^text\/html/);
  const html = await browser.text();
  assert.match(html, /Halaman ini tidak ditemukan/);
  assert.match(html, /href="\/"/);
  assert.doesNotMatch(html, /NotFoundError/);

  const api = await fetch(`${base}/api/hahfwae`, { headers: { Accept: 'text/html' } });
  assert.equal(api.status, 404);
  assert.match(api.headers.get('content-type'), /^application\/json/);
  assert.equal((await api.json()).error.path, '/api/hahfwae');

  const jsonClient = await fetch(`${base}/hahfwae`, { headers: { Accept: 'application/json' } });
  assert.equal(jsonClient.status, 404);
  assert.match(jsonClient.headers.get('content-type'), /^application\/json/);
});
