# Penerapan perbaikan keamanan

Perubahan ini memisahkan konfigurasi dan database dari Git. Pada pembaruan **pertama** dari versi lama, cadangkan `settings.json`, `.env`, `database/`, `public/uploads/`, dan `data/wa-lid-map.json` di luar folder proyek sebelum `git pull`. `update.sh` versi lama belum memiliki langkah pemulihan untuk transisi ini. Setelah kode baru terpasang, salin kembali file tersebut sebelum aplikasi dijalankan. Pembaruan berikutnya dapat memakai `update.sh` yang baru.

## Konfigurasi wajib

1. Isi `ADMIN_PASSWORD` dengan password baru yang kuat dan `SESSION_SECRET` dengan nilai acak panjang di `.env` server. Password bawaan `admin123` kini ditolak. Perubahan session secret mengakhiri sesi login lama.
2. Jika memakai Fonnte, atur secret webhook pada perangkat Fonnte dan isi nilai yang sama di `FONNTE_WEBHOOK_SECRET`. Jika memakai Meta WhatsApp, isi `META_APP_SECRET` dan `META_VERIFY_TOKEN` dari konfigurasi aplikasi Meta. Webhook tanpa secret yang valid akan ditolak.
3. Ubah MacroDroid agar mengirim secret pembayaran melalui header `x-webhook-token`. Setelah notifikasi uji berhasil, set `PAYMENT_WEBHOOK_HEADER_ONLY=1` dan hilangkan secret dari URL. Mode lama tetap tersedia selama migrasi agar notifikasi yang sedang berjalan tidak terputus.
4. Rotasi `admin_api_key`, secret webhook pembayaran, password MikroTik/ACS, dan token gateway yang pernah disimpan di `settings.json` terlacak Git. Perbarui perangkat dan layanan terkait pada saat yang sama. Menghapus file dari pelacakan Git tidak menghapus nilainya dari riwayat commit lama.
5. Pastikan port Node hanya dapat diakses oleh reverse proxy yang tepercaya. Pembatas laju hanya memakai `X-Forwarded-For` bila koneksi datang dari loopback atau IP dalam `TRUSTED_PROXY_IPS`. Isi variabel itu bila proxy berada di mesin/container lain. Bila `trust_proxy` diatur `false`, aplikasi tidak akan menerima IP klien dari header proxy.
6. Jalankan aplikasi di bawah pengawas proses seperti PM2. Exception yang tidak tertangani sekarang mengakhiri proses agar pengawas memulai proses bersih.
7. Gunakan Node.js 20, 22, 24, atau 26 untuk `npm install`/`npm ci`. Modul `better-sqlite3` diperbarui ke 12.10.0; instalasi bersih dan tes telah lulus pada Node 26/npm 11 di Windows. Uji juga pada runtime server sebelum restart produksi.

## Pemeriksaan setelah restart

- Login admin dengan password baru; password bawaan harus ditolak.
- Login kasir, agen, teknisi, dan kolektor dengan password lama mereka. Migrasi ke hash berjalan otomatis saat server memulai.
- Cek pembelian voucher, status QRIS, callback gateway, dan notifikasi pembayaran memakai transaksi uji yang tidak cocok dengan tagihan sungguhan.
- Jika dua pembayaran sah menghasilkan teks notifikasi yang benar-benar identik, notifikasi kedua sengaja tidak diproses otomatis. Cocokkan dengan mutasi penyedia pembayaran lalu selesaikan secara manual.
- Pastikan request webhook Fonnte/Meta tanpa secret atau tanda tangan ditolak, lalu uji pesan valid dari penyedia.
- Cek bahwa kasir tidak dapat membuka settings, backup, atau konfigurasi router.

`package-lock.json` sudah diperbarui untuk patch dependensi yang kompatibel. Pemrosesan gambar QRIS memakai Sharp dan impor/ekspor Excel memakai ExcelJS. Impor Excel tetap berjalan dalam worker dengan batas waktu, memori, ukuran file, baris, dan kolom. `npm audit --omit=dev` masih melaporkan 15 temuan moderate yang berasal dari EJS, ExcelJS/arsip ZIP, dan Telegram SDK. Pembaruan versi utama paket tersebut perlu diuji tersendiri sebelum diterapkan.
