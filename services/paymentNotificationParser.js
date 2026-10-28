function parseRupiahAmountFromNotification(content) {
  const text = String(content || '').replace(/\u00A0/g, ' ').trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const chatOrInvoiceHints = [
    'bereaksi', 'reacted', 'membalas', 'tagihan manual', 'kode bayar qris',
    'rincian tagihan', 'portal pelanggan', 'silakan scan', 'mohon scan',
    'link login', 'pengingat tagihan', 'halo pelanggan', 'yth. pelanggan',
    'paket internet anda', 'sebelum tanggal jatuh tempo'
  ];
  if (chatOrInvoiceHints.some((hint) => lower.includes(hint))) return null;

  const incomingHints = [
    'pembayaran masuk', 'pembayaran diterima', 'uang masuk', 'transfer masuk',
    'dana masuk', 'saldo masuk', 'saldo bertambah', 'berhasil top up',
    'top up berhasil', 'topup berhasil', 'terima uang', 'telah diterima dari',
    'diterima dari', 'qris berhasil', 'qris sukses', 'qr berhasil', 'qr sukses',
    'payment received', 'kamu menerima', 'berhasil menerima', 'menambahkan',
    'telah diterima sebesar', 'uang diterima'
  ];
  const outgoingHints = [
    'mengirim', 'terkirim', 'telah dikirim', 'berhasil kirim', 'transfer ke',
    'bayar ke', 'pembayaran berhasil', 'berhasil bayar', 'pembelian',
    'belanja', 'purchase', 'kamu membayar', 'transaksi keluar', 'debit',
    'dikenakan biaya', 'potongan'
  ];
  if (!incomingHints.some((hint) => lower.includes(hint)) || outgoingHints.some((hint) => lower.includes(hint))) return null;

  const candidates = [
    /(?:\bRp\.?\s*|IDR\s*)([0-9][0-9\.\,\s]*)/i,
    /(?:sebesar|senilai|nominal|masuk|transfer|top\s*up|topup|saldo\s+masuk)\s*(?:saldo\s*)?(?:\bRp\.?\s*)?([0-9][0-9\.\,\s]*)/i
  ];
  let raw = null;
  for (const re of candidates) {
    const match = text.match(re);
    if (match?.[1]) {
      raw = String(match[1]);
      break;
    }
  }
  if (!raw) return null;

  let digits = raw.replace(/\s+/g, '');
  if (digits.includes(',')) digits = digits.split(',')[0];
  digits = digits.replace(/\./g, '').replace(/[^\d]/g, '');
  if (!digits) return null;

  const amount = Number.parseInt(digits, 10);
  return Number.isFinite(amount) ? amount : null;
}

function extractPaymentNotificationText({ body, query, rawBody, headers = {} }) {
  const values = [];
  const skipKey = /secret|token|password|authorization|cookie|^key$|^service$|^app$|^packagename$/i;
  const metadataKey = /^(timestamp|created_at|date|time|id|version|status|source)$/i;

  const collect = (value, key = '', depth = 0) => {
    if (depth > 5 || skipKey.test(key) || metadataKey.test(key)) return;
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) values.push(text);
    } else if (Array.isArray(value)) {
      value.forEach((item) => collect(item, key, depth + 1));
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([childKey, childValue]) => collect(childValue, childKey, depth + 1));
    }
  };

  collect(body);
  collect(query);
  collect(headers['x-notification-title'], 'title');
  collect(headers['x-notification-text'], 'text');
  if (typeof rawBody === 'string') {
    const raw = rawBody.trim();
    if (raw && !raw.startsWith('{') && !raw.startsWith('[')) collect(raw);
  }

  return Array.from(new Set(values)).join(' ');
}

module.exports = { parseRupiahAmountFromNotification, extractPaymentNotificationText };
