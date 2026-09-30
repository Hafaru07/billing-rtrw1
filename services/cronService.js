/**
 * Service: Penjadwalan Tugas Otomatis (Cron)
 */
const cron = require('node-cron');
const billingSvc = require('./billingService');
const { logger } = require('../config/logger');

const customerSvc = require('./customerService');
const mikrotikService = require('./mikrotikService');
const usageSvc = require('./usageService');
const { getSetting, getNowLocal, getCurrentTimeInfo } = require('../config/settingsManager');
const db = require('../config/database');
const qrisUtil = require('../utils/qrisUtil');

// Helper: Random delay generator untuk smart rate limiting
// Penanda supaya pengingat tidak dobel kirim dalam satu hari.
let sedangKirimPengingat = false;

// Diisi oleh startCronJobs(). Tombol kirim manual memakai fungsi yang sama
// dengan cron, supaya perilakunya tidak mungkin berbeda.
let runnerPengingat = null;

// Kemajuan antrean yang sedang berjalan, dibaca halaman admin.
const statusPengingat = {
  berjalan: false, total: 0, terkirim: 0, gagal: 0,
  mulai: null, selesai: null, sumber: null
};

/**
 * Menjalankan pengingat di luar jadwal (tombol manual di panel admin).
 * opsi: { hariManual: [7,5,3,1], hanyaHitung: true|false }
 */
async function jalankanPengingatSekarang(opsi = {}) {
  if (typeof runnerPengingat !== 'function') {
    throw new Error('Penjadwal belum aktif. Mulai ulang aplikasi lalu coba lagi.');
  }
  return runnerPengingat(Object.assign({ manual: true }, opsi));
}

function tanggalHariIniLokal() {
  return String(getNowLocal() || '').slice(0, 10); // YYYY-MM-DD sesuai timezone setting
}

function jamSekarangLokal() {
  return Number(String(getNowLocal() || '').slice(11, 13));
}

// ─── Kalender pengingat ──────────────────────────────────────────────────────
// "Hari ini" diambil menurut timezone di pengaturan (bawaan Asia/Jakarta),
// bukan zona jam server: server bisa berjalan di UTC, dan antara 00:00-07:00
// WIB server UTC masih berada di tanggal kemarin.
function hariIniLokal() {
  const t = getCurrentTimeInfo();
  return { y: t.year, m: t.month, d: t.day };
}

// Selisih hari kalender dari a ke b (b - a).
function selisihHari(a, b) {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

// Tanggal jatuh tempo pada bulan tertentu. Jumlah hari tiap bulan berbeda
// (28/29/30/31), jadi tanggal isolir 29-31 digeser ke hari terakhir bulan itu.
function tanggalJatuhTempo(tahun, bulan, tanggalIsolir) {
  const akhir = billingSvc.daysInMonth(tahun, bulan);
  return { y: tahun, m: bulan, d: Math.min(Math.max(1, tanggalIsolir), akhir) };
}

/**
 * Jatuh tempo terdekat yang belum lewat - bisa bulan ini atau bulan depan,
 * sehingga pengingat tetap jalan melewati pergantian bulan.
 * Contoh: hari ini 24 September, tanggal isolir 1 -> 1 Oktober, sisa 7 hari.
 */
function jatuhTempoBerikutnya(hariIni, tanggalIsolir) {
  let tempo = tanggalJatuhTempo(hariIni.y, hariIni.m, tanggalIsolir);
  if (selisihHari(hariIni, tempo) < 0) {
    const bulan = hariIni.m === 12 ? 1 : hariIni.m + 1;
    const tahun = hariIni.m === 12 ? hariIni.y + 1 : hariIni.y;
    tempo = tanggalJatuhTempo(tahun, bulan, tanggalIsolir);
  }
  return Object.assign({}, tempo, { sisaHari: selisihHari(hariIni, tempo) });
}

// Tanggal n hari dari hari ini (timezone setelan) - jatuh tempo pelanggan yang
// hari ini menerima pengingat H-n.
function tanggalDalamHari(hari) {
  const t = hariIniLokal();
  const d = new Date(Date.UTC(t.y, t.m - 1, t.d + (Number(hari) || 0)));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function tanggalLokalDari(nilai) {
  const m = String(nilai || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const t = new Date(nilai);
  return isNaN(t.getTime()) ? null : { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
}

// Timezone untuk jadwal cron; nilai tak dikenal jatuh ke Asia/Jakarta supaya
// aplikasi tidak gagal start.
function zonaWaktuJadwal() {
  const tz = String(getSetting('timezone', 'Asia/Jakarta') || 'Asia/Jakarta');
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (e) { return 'Asia/Jakarta'; }
}

function pengingatSudahJalanHariIni() {
  return String(db.getAppSetting('whatsapp_reminder_last_run', '') || '') === tanggalHariIniLokal();
}

function tandaiPengingatSudahJalan() {
  db.saveAppSetting('whatsapp_reminder_last_run', tanggalHariIniLokal());
}

/**
 * Hari-hari pengingat yang aktif. H-1 selalu ikut supaya pelanggan pasti
 * diingatkan sehari sebelum isolir, berapa pun toggle lain yang dipilih admin.
 */
function getReminderDays() {
  const raw = getSetting('whatsapp_reminder_days', [1]);
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const hasil = arr
    .map(function (v) { return parseInt(v, 10); })
    .filter(function (n) { return Number.isFinite(n) && n >= 1 && n <= 60; });
  if (!hasil.includes(1)) hasil.push(1); // H-1 wajib
  return Array.from(new Set(hasil)).sort(function (a, b) { return b - a; });
}

/**
 * Teks pengganti variabel {{h-}} pada template pesan.
 * Contoh: 7 -> '(7 Hari Sebelum)', 1 -> '(1 Hari Sebelum)'.
 */
function formatHMinus(days) {
  const n = parseInt(days, 10);
  if (!Number.isFinite(n) || n < 1) return '';
  return '(' + n + ' Hari Sebelum)';
}

/**
 * Jeda antar pesan dibuat acak dalam rentang (bawaan 45-100 detik) supaya pola
 * pengiriman tidak terlihat seperti bot dengan jarak waktu yang selalu sama.
 */
function getDynamicDelayMs() {
  let min = Number(getSetting('whatsapp_delay_min', 45) || 45);
  let max = Number(getSetting('whatsapp_delay_max', 100) || 100);
  if (!Number.isFinite(min) || min < 5) min = 45;
  if (!Number.isFinite(max) || max < min) max = Math.max(min, 100);
  const detik = Math.floor(Math.random() * (max - min + 1)) + min;
  return detik * 1000;
}

function getRandomDelay(baseDelayMs, varianceMs = 3000) {
  const minDelay = Math.max(baseDelayMs - varianceMs, 2000);
  const maxDelay = baseDelayMs + varianceMs;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
}

// Helper: Exponential backoff untuk error handling
function getBackoffDelay(attemptCount, baseDelayMs = 2000) {
  const maxDelay = 30000;
  const delay = Math.min(baseDelayMs * Math.pow(2, attemptCount), maxDelay);
  return delay + Math.floor(Math.random() * 1000);
}

// Helper: Cek apakah error adalah permanent (tidak perlu retry)
function isPermanentError(errorMessage) {
  const permanentErrorPatterns = [
    /invalid.*number/i,
    /number.*not.*found/i,
    /phone.*not.*exist/i,
    /blocked/i,
    /banned/i,
    /not.*registered/i,
    /user.*not.*found/i,
    /404/i,
    /400/i
  ];
  return permanentErrorPatterns.some(pattern => pattern.test(errorMessage));
}

// Helper: Message variation untuk menghindari spam detection
function addMessageVariation(message, index) {
  const variations = [
    '',
    '\n\n_',
    '\n\n•',
    '\n\n▪',
    '\n\n▫'
  ];
  const suffix = variations[index % variations.length];
  return message + suffix;
}

function startCronJobs() {
  // 1. Generate Tagihan Otomatis setiap tanggal 1 jam 00:01
  cron.schedule('1 0 1 * *', () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    
    logger.info(`[CRON] Menjalankan generate tagihan otomatis untuk ${month}/${year}`);
    try {
      // Cron tetap menggenerate semua pelanggan (tanpa penyaringan tanggal jatuh tempo)
      const hasil = billingSvc.generateMonthlyInvoices(month, year);
      logger.info(`[CRON] Berhasil generate ${hasil.created} tagihan otomatis.`);
    } catch (error) {
      logger.error(`[CRON] Gagal generate tagihan otomatis: ${error.message}`);
    }
  });

  // 2. Isolir Otomatis setiap hari jam 02:00
  cron.schedule('0 2 * * *', async () => {
    const now = new Date();
    const today = now.getDate();
    logger.info(`[CRON] Menjalankan pengecekan isolir otomatis harian (Tanggal ${today})`);

    let isolatedCount = 0;
    const BATCH_SIZE = 100;
    let lastId = 0;

    while (true) {
      const batch = db.prepare(
        `SELECT c.*, p.billing_type AS package_billing_type
         FROM customers c LEFT JOIN packages p ON c.package_id = p.id
         WHERE c.status = 'active' AND c.id > ?
         ORDER BY c.id ASC
         LIMIT ?`
      ).all(lastId, BATCH_SIZE);

      if (batch.length === 0) break;

      for (const c of batch) {
        lastId = c.id;
        const isAutoIsolateEnabled = c.auto_isolate !== 0;
        if (!isAutoIsolateEnabled) continue;

        const isPrepaid = c.package_billing_type === 'prepaid';

        if (isPrepaid) {
          if (c.expired_at) {
            const expDate = new Date(c.expired_at);
            if (!isNaN(expDate.getTime()) && now >= expDate) {
              try {
                logger.info(`[CRON] Isolir otomatis PRABAYAR: ${c.name} (${c.pppoe_username || c.hotspot_username || '-'}) - Berakhir: ${c.expired_at}`);
                await customerSvc.suspendCustomer(c.id);
                isolatedCount++;
              } catch (err) {
                logger.error(`[CRON] Gagal isolir prabayar ${c.name}: ${err.message}`);
              }
            }
          }
        } else {
          const customerIsolirDay = c.isolate_day || 10;
          const unpaidCount = db.prepare('SELECT COUNT(*) as cnt FROM invoices WHERE customer_id=? AND status=?').get(c.id, 'unpaid')?.cnt || 0;
          if (today >= customerIsolirDay && unpaidCount > 0) {
            try {
              logger.info(`[CRON] Isolir otomatis PASCABAYAR: ${c.name} (${c.pppoe_username || c.hotspot_username || '-'}) - Tgl Isolir: ${customerIsolirDay}`);
              await customerSvc.suspendCustomer(c.id);
              isolatedCount++;
            } catch (err) {
              logger.error(`[CRON] Gagal isolir pascabayar ${c.name}: ${err.message}`);
            }
          }
        }
      }

      if (batch.length === BATCH_SIZE) {
        await new Promise(r => setTimeout(r, 300)); // Jeda 300ms antar batch
      }
    }

    logger.info(`[CRON] Selesai pengecekan isolir. Total ${isolatedCount} pelanggan baru di-isolir.`);
  });

  // 3. Pengingat Tagihan Otomatis - mulai jam 07:00 setiap hari.
  //    Semua pelanggan yang jatuh tempo pada hari pengingat aktif (H-7/H-5/H-3/H-1)
  //    dikumpulkan dulu jadi satu antrean, lalu dikirim berurutan dengan jeda acak
  //    sampai antrean habis pada hari yang sama.
  const jalankanPengingat = async (opsi) => {
    const { susulan = false, manual = false, hariManual = null, hanyaHitung = false } =
      (opsi && typeof opsi === 'object') ? opsi : { susulan: !!opsi };

    // Kiriman manual sengaja tidak terhalang penanda harian: admin yang memutuskan.
    if (!manual && pengingatSudahJalanHariIni()) return;

    const enabled = getSetting('whatsapp_auto_billing_enabled', false);
    const waEnabled = getSetting('whatsapp_enabled', false);
    const billingEnabled = getSetting('whatsapp_billing_to_customer_enabled', true);
    // Toggle pengingat otomatis hanya mengatur jadwal; tombol manual tetap bisa dipakai.
    if (!manual && (!enabled || !waEnabled || !billingEnabled)) return;

    const gatewayType = getSetting('wa_gateway_type', 'baileys');
    const waSvc = require('./whatsappService');
    
    if (hanyaHitung) {
      // Pratinjau target: tidak mengirim apa pun, koneksi tidak perlu diperiksa.
    } else if (gatewayType === 'meta') {
      const phoneId = getSetting('meta_phone_number_id', '');
      const token = getSetting('meta_access_token', '');
      if (!phoneId || !token) {
        logger.warn('[CRON] Kredensial Meta API belum diisi, pengingat tagihan otomatis dilewati.');
        return;
      }
    } else if (gatewayType === 'fonnte') {
      const token = getSetting('fonnte_token', '');
      if (!token) {
        logger.warn('[CRON] Token Fonnte belum diisi, pengingat tagihan otomatis dilewati.');
        return;
      }
    } else {
      let whatsappStatus;
      try {
        const mod = await import('./whatsappBot.mjs');
        whatsappStatus = mod.whatsappStatus;
      } catch (e) {
        logger.error(`[CRON] Gagal load WhatsApp bot: ${e.message || e}`);
        return;
      }

      if (!whatsappStatus || whatsappStatus.connection !== 'open') {
        // Tidak ditandai selesai, supaya pengecekan susulan mencoba lagi
        // begitu bot terhubung.
        if (!susulan) logger.warn('[CRON] WhatsApp bot belum terhubung, pengingat tagihan ditunda sampai bot siap.');
        return;
      }
    }

    const resolveBaseUrl = () => {
      const explicit = String(getSetting('public_base_url', '') || '').trim();
      if (explicit) return explicit.replace(/\/+$/, '');

      const hostRaw = String(getSetting('server_host', 'localhost') || 'localhost').trim();
      const port = Number(getSetting('server_port', 3001) || 3001);
      const hasProto = /^https?:\/\//i.test(hostRaw);
      const proto = port === 443 ? 'https' : 'http';
      const host = hasProto ? hostRaw.replace(/\/+$/, '') : `${proto}://${hostRaw}`;
      const withPort = (port === 80 || port === 443) ? host : `${host}:${port}`;
      return withPort.replace(/\/+$/, '');
    };

    const loginLink = `${resolveBaseUrl()}/customer/login`;
    const baseDelayMs = (Number(getSetting('whatsapp_broadcast_delay', 5) || 5) * 1000); // Default 5 detik
    const batchSize = 15; // 15 pesan per batch (dari 20)
    const batchPauseMs = 120000; // Pause 2 menit setelah batch (dari 1 menit)

    const hariIni = hariIniLokal();
    const reminderDays = (Array.isArray(hariManual) && hariManual.length)
      ? Array.from(new Set(hariManual.map(Number).filter(n => Number.isFinite(n) && n >= 1 && n <= 60)))
          .sort((a, b) => b - a)
      : getReminderDays();
    logger.info('[CRON] Hari pengingat aktif: H-' + reminderDays.join(', H-'));

    const customers = customerSvc.getAllCustomers();
    let targetCount = 0;
    let sent = 0;
    let failed = 0;
    let batchCount = 0;

    const defaultTemplate =
      `Yth. Pelanggan {{nama}},\n\n` +
      `Ini adalah pengingat sebelum tanggal jatuh tempo/isolir.\n\n` +
      `📦 *Paket:* {{paket}}\n` +
      `💰 *Total Tagihan:* Rp {{tagihan}}\n` +
      `📅 *Periode:* {{rincian}}\n\n` +
      `Mohon segera melakukan pembayaran melalui portal pelanggan: {{link}}\n\n` +
      `Terima kasih atas kerja samanya.\n` +
      `Salam,\nAdmin ${getSetting('company_header', 'ISP')}`;
    const template = String(db.getAppSetting('whatsapp_auto_billing_message', defaultTemplate) || defaultTemplate);

    // Filter pelanggan yang perlu diingatkan
    const targetCustomers = [];
    const seenPhones = new Set();
    // Pelanggan yang pernah ditagih memakai tanggal isolir; hanya prabayar
    // murni (belum pernah punya tagihan) yang memakai masa aktif.
    const punyaTagihan = new Set(db.prepare('SELECT DISTINCT customer_id FROM invoices').all().map(r => r.customer_id));
    const tagihanPeriode = db.prepare('SELECT 1 FROM invoices WHERE customer_id=? AND period_month=? AND period_year=? LIMIT 1');
    const hitungTunggakan = db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE customer_id=? AND status='unpaid' AND (period_year * 12 + period_month) <= ?");
    for (const c of customers) {
      const phone = c.phone ? String(c.phone).trim() : '';
      if (!phone || phone.length < 9) continue;
      let digits = phone.replace(/\D/g, '');
      if (!digits) continue;
      if (digits.startsWith('0')) digits = '62' + digits.slice(1);
      if (seenPhones.has(digits)) continue;

      const tanggalIsolir = Number(c.isolate_day || 0) || Number(getSetting('isolir_day', 10) || 10) || 10;
      let hMinus = null;

      // Banyak paket ditandai "prepaid" padahal ditagih bulanan lewat tanggal
      // isolir, jadi masa aktif hanya dipakai bila pelanggan belum pernah ditagih.
      if (c.package_billing_type === 'prepaid' && !punyaTagihan.has(c.id)) {
        const habis = tanggalLokalDari(c.expired_at);
        if (habis) {
          const sisa = selisihHari(hariIni, habis);
          if (reminderDays.includes(sisa)) hMinus = sisa;
        }
      } else {
        // Jatuh tempo terdekat, boleh di bulan depan (24 September -> 1 Oktober = H-7).
        const tempo = jatuhTempoBerikutnya(hariIni, tanggalIsolir);
        if (reminderDays.includes(tempo.sisaHari)) {
          const tunggakan = hitungTunggakan.get(c.id, tempo.y * 12 + tempo.m).n;
          const akanDitagih = ['active', 'ditangguhkan'].includes(c.status) && !!c.package_id;
          if (tagihanPeriode.get(c.id, tempo.m, tempo.y)) {
            // Tagihan periode itu sudah terbit: ingatkan bila masih ada yang belum lunas.
            if (tunggakan > 0) hMinus = tempo.sisaHari;
          } else if (akanDitagih || tunggakan > 0) {
            // Belum terbit (baru dibuat tanggal 1): nominalnya diperkirakan saat kirim.
            hMinus = tempo.sisaHari;
            c._tagihanBelumTerbit = akanDitagih;
          }
          if (hMinus !== null) c._periode = { m: tempo.m, y: tempo.y };
        }
      }

      if (hMinus === null) continue;
      c._hMinus = hMinus; // dipakai untuk variabel {{h-}}

      seenPhones.add(digits);
      targetCustomers.push(c);
    }

    if (hanyaHitung) {
      const rincian = {};
      for (const t of targetCustomers) {
        const k = 'H-' + (t._hMinus || 1);
        rincian[k] = (rincian[k] || 0) + 1;
      }
      return { pratinjau: true, total: targetCustomers.length, rincian, hari: reminderDays };
    }

    if (targetCustomers.length === 0) {
      // Belum ditandai selesai: kalau tagihan baru dibuat siang hari,
      // pengecekan susulan masih bisa menjemputnya hari ini juga.
      if (!susulan) logger.info('[CRON] Tidak ada pelanggan yang perlu diingatkan hari ini.');
      return;
    }

    // Perkiraan durasi: rata-rata jeda acak per pesan + jeda antar batch.
    const jedaRata = (Number(getSetting('whatsapp_delay_min', 45) || 45) + Number(getSetting('whatsapp_delay_max', 100) || 100)) / 2;
    const perkiraanMenit = Math.ceil(
      ((targetCustomers.length - 1) * jedaRata * 1000 +
        Math.floor((targetCustomers.length - 1) / batchSize) * batchPauseMs) / 60000
    );
    // Ditandai sebelum mulai mengirim supaya tidak ada pengiriman dobel
    // kalau proses lain ikut terpicu di tengah antrean.
    tandaiPengingatSudahJalan();
    statusPengingat.berjalan = true;
    statusPengingat.total = targetCustomers.length;
    statusPengingat.terkirim = 0;
    statusPengingat.gagal = 0;
    statusPengingat.mulai = getNowLocal();
    statusPengingat.selesai = null;
    statusPengingat.sumber = manual ? 'tombol manual' : (susulan ? 'susulan' : 'jadwal 07:00');
    logger.info(
      `[CRON] Antrean pengingat tagihan: ${targetCustomers.length} pelanggan, ` +
      `jeda acak ~${Math.round(jedaRata)} detik/pesan, perkiraan selesai ${perkiraanMenit} menit lagi` +
      (susulan ? ' (jalan susulan, jadwal 07:00 terlewat).' : '.')
    );

    // Kirim pesan dengan smart rate limit
    for (let i = 0; i < targetCustomers.length; i++) {
      const c = targetCustomers[i];
      let attemptCount = 0;
      const maxAttempts = 3;

      while (attemptCount < maxAttempts) {
        try {
          // Pesan pertama langsung dikirim begitu cron jalan jam 07:00. Sisanya
          // diberi jeda acak (bawaan 45-100 detik) supaya pola kirim tidak seragam.
          if (i > 0 || attemptCount > 0) {
            const randomDelay = getDynamicDelayMs();
            await new Promise(r => setTimeout(r, randomDelay));
          }

          // Yang diingatkan: semua tunggakan sampai periode jatuh tempo ini.
          const periode = c._periode || null;
          const batasPeriode = periode ? periode.y * 12 + periode.m : Infinity;
          const unpaidInvoices = billingSvc.getUnpaidInvoicesByCustomerId(c.id)
            .filter(inv => Number(inv.period_year) * 12 + Number(inv.period_month) <= batasPeriode);
          // Tagihan periode jatuh tempo belum terbit (mis. 24 September untuk jatuh
          // tempo 1 Oktober): nominalnya diperkirakan dengan rumus generate tagihan.
          const perkiraanBelumTerbit = (periode && c._tagihanBelumTerbit)
            ? billingSvc.estimateInvoiceAmount(c, periode.m, periode.y)
            : 0;
          const totalTagihan = unpaidInvoices.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0) + perkiraanBelumTerbit;
          const daftarPeriode = unpaidInvoices.map(inv => `${inv.period_month}/${inv.period_year}`);
          if (periode && c._tagihanBelumTerbit) daftarPeriode.push(`${periode.m}/${periode.y}`);
          const rincianBulan = daftarPeriode.join(', ');

          // Process Dynamic QRIS if enabled & available
          let qrisImageBuffer = null;
          let finalTagihanStr = totalTagihan.toLocaleString('id-ID');
          // Nominal apa adanya, tanpa kode unik QRIS. Dipakai variabel
          // {{harganoqris}} untuk pesan pengingat yang tidak butuh kode bayar.
          const tagihanTanpaKodeStr = totalTagihan.toLocaleString('id-ID');

          // Kode unik QRIS hanya bila seluruh nominal berasal dari tagihan yang sudah terbit.
          if (unpaidInvoices.length > 0 && !perkiraanBelumTerbit) {
            try {
              const inv = unpaidInvoices[0];
              let code = Number(inv.qris_unique_code || 0) || 0;
              let amt = Number(inv.qris_amount_unique || 0) || 0;
              const invId = Number(inv.id);
              const baseAmount = totalTagihan > 0 ? totalTagihan : Number(inv.amount || 0);

              // Jika amt tidak ada atau amt tidak cocok dengan akumulasi total tagihan + kode, buat/perbarui nominal unik
              if ((!code || !amt || (amt - code !== baseAmount)) && invId > 0 && baseAmount > 0) {
                const exists = db.prepare('SELECT id FROM invoices WHERE status=? AND qris_amount_unique=? AND id!=? LIMIT 1');
                const custId = Number(c?.id || inv?.customer_id || 0);
                let tryCode = 0;
                let tryAmt = 0;

                if (code > 0) {
                  const pAmt = baseAmount + code;
                  if (!exists.get('unpaid', pAmt, invId)) {
                    tryCode = code;
                    tryAmt = pAmt;
                  }
                }

                if (!tryAmt && custId > 0) {
                  const prefCode = (custId % 499 === 0) ? 499 : (custId % 499);
                  const pAmt = baseAmount + prefCode;
                  if (!exists.get('unpaid', pAmt, invId)) {
                    tryCode = prefCode;
                    tryAmt = pAmt;
                  }
                }

                if (!tryAmt) {
                  for (let randCode = 1; randCode <= 499; randCode++) {
                    const pAmt = baseAmount + randCode;
                    if (!exists.get('unpaid', pAmt, invId)) {
                      tryCode = randCode;
                      tryAmt = pAmt;
                      break;
                    }
                  }
                }

                if (tryAmt > 0) {
                  code = tryCode;
                  amt = tryAmt;
                  db.prepare('UPDATE invoices SET qris_unique_code=?, qris_amount_unique=?, qris_assigned_at=(NOW_LOCAL()) WHERE id=?').run(code, amt, invId);
                }
              }

              if (amt > 0) {
                finalTagihanStr = amt.toLocaleString('id-ID');
                const qrisPayload = String(getSetting('qris_static_payload', '') || '').trim();
                const qrisEnabledRaw = getSetting('qris_static_enabled', true);
                const qrisEnabled = !(qrisEnabledRaw === false || qrisEnabledRaw === 'false' || qrisEnabledRaw === 0 || qrisEnabledRaw === '0');

                if (qrisEnabled && qrisPayload && typeof qrisUtil.buildDynamicQrisJpgBuffer === 'function') {
                  qrisImageBuffer = await qrisUtil.buildDynamicQrisJpgBuffer(qrisPayload, amt);
                }
              }
            } catch (qrisErr) {
              logger.warn(`[CRON] Gagal generate QRIS dinamis untuk ${c.name}: ${qrisErr.message}`);
            }
          }

          // Format pesan dengan Spintax & variation untuk anti-spam
          let formattedMsg = template
            .replace(/{{nama}}/gi, c.name || 'Pelanggan')
            .replace(/{{tagihan}}/gi, finalTagihanStr)
            .replace(/{{harganoqris}}/gi, tagihanTanpaKodeStr)
            .replace(/{{rincian}}/gi, rincianBulan || '-')
            .replace(/{{paket}}/gi, c.package_name || '-')
            .replace(/{{link}}/gi, loginLink)
            .replace(/{{h-}}/gi, formatHMinus(c._hMinus));

          const { parseSpintax } = await import('./whatsappBot.mjs');
          formattedMsg = parseSpintax(formattedMsg);

          // Add subtle variation untuk menghindari spam detection
          formattedMsg = addMessageVariation(formattedMsg, i);

          await waSvc.sendWhatsAppMessage(c.phone, formattedMsg);
          const ok = true;
          if (ok) {
            sent++;
            targetCount++;
            batchCount++;
            statusPengingat.terkirim = sent;
            logger.info(`[CRON] Pengingat ${sent}/${targetCustomers.length} terkirim ke ${c.name || c.phone} (H-${c._hMinus || 1}).`);
          } else {
            throw new Error('Gagal kirim pesan');
          }

          // Batch Processing: Pause setelah N pesan
          if (batchCount >= batchSize && i < targetCustomers.length - 1) {
            logger.info(`[CRON] Selesai batch ${Math.floor(i / batchSize) + 1} (${batchSize} pesan). Pause ${Math.floor(batchPauseMs / 1000)} detik...`);
            await new Promise(r => setTimeout(r, batchPauseMs));
            batchCount = 0;
          }

          break; // Sukses, keluar dari retry loop
        } catch (e) {
          attemptCount++;
          const errorMsg = e.message || e.toString();

          // Cek apakah error permanent (tidak perlu retry)
          if (isPermanentError(errorMsg)) {
            logger.warn(`[CRON] SKIP: Error permanent untuk ${c.phone} - ${errorMsg}`);
            failed++;
            break; // Skip retry langsung ke pelanggan berikutnya
          }

          // Error temporary, bisa retry
          logger.error(`[CRON] Gagal kirim ke ${c.phone} (attempt ${attemptCount}/${maxAttempts}): ${errorMsg}`);

          if (attemptCount >= maxAttempts) {
            logger.warn(`[CRON] Max attempts tercapai untuk ${c.phone}`);
            failed++;
          } else {
            // Exponential backoff untuk retry
            const backoffDelay = getBackoffDelay(attemptCount);
            logger.info(`[CRON] Retry ke ${c.phone} dalam ${Math.floor(backoffDelay / 1000)} detik...`);
            await new Promise(r => setTimeout(r, backoffDelay));
          }
        }
      }
    }

    logger.info(`[CRON] Pengingat tagihan otomatis selesai: target=${targetCount}, terkirim=${sent}, gagal=${failed}`);
    statusPengingat.berjalan = false;
    statusPengingat.terkirim = sent;
    statusPengingat.gagal = failed;
    statusPengingat.selesai = getNowLocal();
    return { total: targetCount, terkirim: sent, gagal: failed };
  };

  // Pembungkus: cegah dua antrean berjalan bersamaan.
  const jalankanPengingatAman = async (opsi) => {
    const cumaHitung = !!(opsi && opsi.hanyaHitung);
    if (!cumaHitung && sedangKirimPengingat) return { sedangBerjalan: true };
    if (!cumaHitung) sedangKirimPengingat = true;
    try {
      return await jalankanPengingat(opsi);
    } catch (e) {
      logger.error(`[CRON] Pengingat tagihan berhenti karena error: ${e.message || e}`);
      statusPengingat.berjalan = false;
      statusPengingat.selesai = getNowLocal();
      return { error: e.message || String(e) };
    } finally {
      if (!cumaHitung) sedangKirimPengingat = false;
    }
  };

  // Dibuka untuk tombol kirim manual di panel admin.
  runnerPengingat = jalankanPengingatAman;

  cron.schedule('0 7 * * *', () => jalankanPengingatAman({ susulan: false }), { timezone: zonaWaktuJadwal() });

  // 3b. Jaring pengaman. Kalau jam 07:00 server sedang mati, WhatsApp belum
  //     terhubung, atau tagihan baru dibuat siang hari, pengingat hari itu
  //     tidak hilang: dicek ulang tiap 15 menit sampai jam 20:00.
  cron.schedule('*/15 * * * *', () => {
    const jam = jamSekarangLokal();
    if (!Number.isFinite(jam) || jam < 7 || jam >= 20) return;
    if (pengingatSudahJalanHariIni()) return;
    jalankanPengingatAman({ susulan: true });
  });

  // 4. Jam Kalong (Night Speed) Start - Jam 00:00
  cron.schedule('0 0 * * *', async () => {
    logger.info('[CRON] Memulai Jam Kalong (Night Speed) - Ganti Profile...');
    try {
      let count = 0;
      const BATCH_SIZE = 100;
      let offset = 0;

      while (true) {
        const batch = db.prepare(
          `SELECT c.id, c.name, c.pppoe_username, c.router_id, c.package_id,
                  p.use_night_speed, p.night_profile_name
           FROM customers c
           JOIN packages p ON c.package_id = p.id
           WHERE c.pppoe_username IS NOT NULL AND c.pppoe_username != ''
             AND p.use_night_speed = 1 AND p.night_profile_name IS NOT NULL AND p.night_profile_name != ''
           LIMIT ? OFFSET ?`
        ).all(BATCH_SIZE, offset);

        if (batch.length === 0) break;

        for (const c of batch) {
          try {
            logger.info(`[CRON] Switching ${c.name} to Night Profile: ${c.night_profile_name}`);
            await mikrotikService.setPppoeProfile(c.pppoe_username, c.night_profile_name, c.router_id);
            count++;
          } catch (err) {
            logger.error(`[CRON] Gagal switch Jam Kalong untuk ${c.name}: ${err.message}`);
          }
        }

        offset += BATCH_SIZE;
        if (batch.length === BATCH_SIZE) await new Promise(r => setTimeout(r, 200));
      }
      logger.info(`[CRON] Jam Kalong aktif untuk ${count} pelanggan.`);
    } catch (e) {
      logger.error(`[CRON] Error Jam Kalong Start: ${e.message}`);
    }
  });

  // 5. Jam Kalong (Night Speed) End - Jam 06:00
  cron.schedule('0 6 * * *', async () => {
    logger.info('[CRON] Mengakhiri Jam Kalong (Night Speed) - Kembali ke Profile Normal...');
    try {
      let count = 0;
      const BATCH_SIZE = 100;
      let offset = 0;

      while (true) {
        const batch = db.prepare(
          `SELECT c.id, c.name, c.pppoe_username, c.router_id, c.package_id,
                  p.use_night_speed, p.name AS normal_profile
           FROM customers c
           JOIN packages p ON c.package_id = p.id
           WHERE c.pppoe_username IS NOT NULL AND c.pppoe_username != ''
             AND p.use_night_speed = 1
           LIMIT ? OFFSET ?`
        ).all(BATCH_SIZE, offset);

        if (batch.length === 0) break;

        for (const c of batch) {
          try {
            logger.info(`[CRON] Restoring ${c.name} to Normal Profile: ${c.normal_profile}`);
            await mikrotikService.setPppoeProfile(c.pppoe_username, c.normal_profile, c.router_id);
            count++;
          } catch (err) {
            logger.error(`[CRON] Gagal restore profil normal untuk ${c.name}: ${err.message}`);
          }
        }

        offset += BATCH_SIZE;
        if (batch.length === BATCH_SIZE) await new Promise(r => setTimeout(r, 200));
      }
      logger.info(`[CRON] Profil normal dikembalikan untuk ${count} pelanggan.`);
    } catch (e) {
      logger.error(`[CRON] Error Jam Kalong End: ${e.message}`);
    }
  });

  // 6. Track Usage Pelanggan (Data Traffic) - Setiap 10 Menit
  cron.schedule('*/10 * * * *', async () => {
    const enabled = getSetting('usage_tracking_enabled', true);
    if (!enabled) return;

    try {
      const routers = mikrotikService.getAllRouters();
      // Hanya load pelanggan yang punya pppoe_username (lebih efisien)
      const customers = db.prepare(
        `SELECT c.id, c.pppoe_username FROM customers c
         WHERE c.pppoe_username IS NOT NULL AND c.pppoe_username != '' AND c.status = 'active'`
      ).all();
      const customerMap = new Map();
      customers.forEach(c => customerMap.set(c.pppoe_username, c));

      for (const r of routers) {
        try {
          const actives = await mikrotikService.getPppoeActive(r.id);
          for (const s of actives) {
            const username = s.name;
            const cust = customerMap.get(username);
            if (!cust) continue;

            const totalIn = parseInt(s['bytes-in']) || 0;
            const totalOut = parseInt(s['bytes-out']) || 0;

            const now = new Date();
            const currentUsage = usageSvc.getUsage(cust.id, now.getMonth()+1, now.getFullYear());

            let deltaIn = 0;
            let deltaOut = 0;

            if (currentUsage) {
              if (totalIn < currentUsage.last_total_bytes_in || totalOut < currentUsage.last_total_bytes_out) {
                deltaIn = totalIn;
                deltaOut = totalOut;
              } else {
                deltaIn = totalIn - currentUsage.last_total_bytes_in;
                deltaOut = totalOut - currentUsage.last_total_bytes_out;
              }
            } else {
              deltaIn = totalIn;
              deltaOut = totalOut;
            }

            if (deltaIn > 0 || deltaOut > 0) {
              usageSvc.updateUsage(cust.id, deltaIn, deltaOut, totalIn, totalOut);
            }
          }
        } catch (err) {
          logger.error(`[CRON] Gagal track usage di router ${r.name}: ${err.message}`);
        }
      }
    } catch (e) {
      logger.error(`[CRON] Error Usage Tracking: ${e.message}`);
    }
  });

  // 7. FUP (Fair Usage Policy) Check - Setiap Jam
  cron.schedule('0 * * * *', async () => {
    logger.info('[CRON] Mengecek FUP Pelanggan...');
    try {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const BATCH_SIZE = 100;
      let offset = 0;
      let fupCount = 0;

      while (true) {
        // Hanya ambil pelanggan yang paketnya punya FUP aktif
        const batch = db.prepare(
          `SELECT c.id, c.name, c.pppoe_username, c.router_id,
                  p.fup_limit_gb, p.fup_profile_name
           FROM customers c
           JOIN packages p ON c.package_id = p.id
           WHERE c.pppoe_username IS NOT NULL AND c.pppoe_username != ''
             AND p.use_fup = 1 AND p.fup_limit_gb > 0
             AND p.fup_profile_name IS NOT NULL AND p.fup_profile_name != ''
           LIMIT ? OFFSET ?`
        ).all(BATCH_SIZE, offset);

        if (batch.length === 0) break;

        for (const c of batch) {
          const usage = usageSvc.getUsage(c.id, month, year);
          if (!usage) continue;

          const totalGB = (usage.bytes_in + usage.bytes_out) / (1024 * 1024 * 1024);
          if (totalGB >= c.fup_limit_gb) {
            logger.warn(`[CRON] FUP: ${c.name} (${totalGB.toFixed(2)} GB / ${c.fup_limit_gb} GB). Turunkan kecepatan...`);
            try {
              await mikrotikService.setPppoeProfile(c.pppoe_username, c.fup_profile_name, c.router_id);
              fupCount++;
            } catch (err) {
              logger.error(`[CRON] Gagal apply FUP untuk ${c.name}: ${err.message}`);
            }
          }
        }

        offset += BATCH_SIZE;
        if (batch.length === BATCH_SIZE) await new Promise(r => setTimeout(r, 200));
      }
      logger.info(`[CRON] FUP check selesai. ${fupCount} pelanggan di-throttle.`);
    } catch (e) {
      logger.error(`[CRON] Error FUP Check: ${e.message}`);
    }
  });

  // 8. Auto-Refresh ACS Devices & Sync IPs - Setiap 5 Menit
  cron.schedule('*/5 * * * *', async () => {
    const enabled = getSetting('use_builtin_acs', false) === true || getSetting('use_builtin_acs', false) === 'true';
    if (!enabled) return;

    logger.info('[CRON] Menjalankan sinkronisasi dan auto-refresh ACS Devices...');
    try {
      const activeSessionsMap = await mikrotikService.getActivePppoeSessionsMap();
      const acsDevices = db.prepare('SELECT id, ip_address, connection_request_url, params, last_inform FROM acs_devices').all();

      const acsServerService = require('./acsServerService');
      let triggeredCount = 0;
      let ipUpdatedCount = 0;

      for (const dev of acsDevices) {
        let params = {};
        try { params = JSON.parse(dev.params || '{}'); } catch (_) {}

        // Extract PPPoE user
        let pppoeUser = '';
        const pppoeUserKeys = [
          'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
          'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username',
          'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANPPPConnection.1.Username',
          'Device.PPP.Interface.1.Username',
          'VirtualParameters.pppoeUsername',
          'VirtualParameters.pppUsername'
        ];
        for (const key of pppoeUserKeys) {
          if (params[key] && params[key] !== '-') {
            pppoeUser = params[key];
            break;
          }
        }
        
        if (!pppoeUser) {
          for (const key of Object.keys(params)) {
            if (key.toLowerCase().includes('wanpppconnection') && key.toLowerCase().endsWith('.username') && params[key]) {
              pppoeUser = params[key];
              break;
            }
          }
        }

        if (!pppoeUser || pppoeUser === '-') continue;

        const activeSession = activeSessionsMap.get(pppoeUser.toLowerCase());
        if (activeSession) {
          const currentIp = activeSession.ip;
          
          if (currentIp && currentIp !== dev.ip_address) {
            logger.info(`[ACS-Sync] IP address changed for device ${dev.id} (${pppoeUser}): ${dev.ip_address} -> ${currentIp}`);
            
            let newCrUrl = dev.connection_request_url || '';
            if (newCrUrl) {
              try {
                if (newCrUrl.startsWith('http')) {
                  const urlObj = new URL(newCrUrl);
                  urlObj.hostname = currentIp;
                  newCrUrl = urlObj.toString();
                } else {
                  newCrUrl = newCrUrl.replace(/(https?:\/\/)([^:/]+)(.*)/, `$1${currentIp}$3`);
                }
              } catch (e) {
                newCrUrl = newCrUrl.replace(/(https?:\/\/)([^:/]+)(.*)/, `$1${currentIp}$3`);
              }
            } else {
              newCrUrl = `http://${currentIp}:58000/`;
            }

            const now = new Date().toISOString();
            db.prepare('UPDATE acs_devices SET ip_address = ?, connection_request_url = ?, updated_at = ? WHERE id = ?')
              .run(currentIp, newCrUrl, now, dev.id);
            
            ipUpdatedCount++;
            
            dev.ip_address = currentIp;
            dev.connection_request_url = newCrUrl;
          }

          const lastInformTime = dev.last_inform ? new Date(dev.last_inform).getTime() : 0;
          const isStale = (Date.now() - lastInformTime) > 15 * 60 * 1000;

          if (isStale) {
            logger.info(`[ACS-Sync] Device ${dev.id} (${pppoeUser}) is active on MikroTik but offline/stale in ACS. Triggering connection request to refresh data.`);
            acsServerService.triggerConnectionRequest(dev.id).catch(err => {
              logger.warn(`[ACS-Sync] Failed to trigger connection request for ${dev.id}: ${err.message}`);
            });
            triggeredCount++;
          }
        }
      }

      logger.info(`[CRON] Selesai sinkronisasi ACS. IP diperbarui: ${ipUpdatedCount}, Connection requests dipicu: ${triggeredCount}`);
    } catch (e) {
      logger.error(`[CRON] Error Auto-Refresh ACS: ${e.message}`);
    }
  });

  logger.info('[CRON] Semua tugas penjadwalan telah aktif.');
}

module.exports = {
  getReminderDays,
  formatHMinus,
  getDynamicDelayMs,
  jatuhTempoBerikutnya,
  tanggalDalamHari,
  jalankanPengingatSekarang,
  statusPengingat, startCronJobs };
