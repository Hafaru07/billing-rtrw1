(function () {
  var bridge = document.getElementById('hotspot-voucher-return');
  if (!bridge) return;

  var storageKey = 'elround_hotspot_voucher_return';
  var loginUrl = bridge.getAttribute('data-login-url') || '';
  if (loginUrl) {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ url: loginUrl, expires: Date.now() + 60 * 60 * 1000 }));
    } catch (error) {}
  }

  var code = bridge.getAttribute('data-voucher-code') || '';
  var password = bridge.getAttribute('data-voucher-password') || '';
  if (!code || !password) return;

  try {
    var saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (!saved || !saved.url || saved.expires < Date.now()) {
      sessionStorage.removeItem(storageKey);
      return;
    }
    var target = new URL(saved.url);
    if (!['http:', 'https:'].includes(target.protocol) || target.pathname !== '/login' || target.search || target.hash) return;
    target.hash = new URLSearchParams({ voucher: code, password: password }).toString();
    sessionStorage.removeItem(storageKey);
    window.location.replace(target.href);
  } catch (error) {
    try { sessionStorage.removeItem(storageKey); } catch (ignored) {}
  }
})();
