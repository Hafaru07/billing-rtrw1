/*!
 * escpos-rawbt.js
 * Builder ESC/POS + jembatan cetak RawBT untuk browser (Android).
 *
 * Kenapa ada file ini:
 *   window.print() memakai driver cetak bawaan browser yang hanya mengenal
 *   ukuran kertas dokumen (A4/Letter/ISO), sehingga struk thermal 58/80mm
 *   selalu keluar dengan margin & skala yang salah. Printer thermal Bluetooth
 *   sebenarnya menerima perintah ESC/POS mentah. File ini menyusun byte
 *   ESC/POS langsung di browser lalu menyerahkannya ke aplikasi RawBT
 *   (ru.a402d.rawbtprinter) lewat skema intent Android.
 *
 * Format intent RawBT:
 *   intent:base64,<BASE64>#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;
 *
 * Pemakaian singkat:
 *   var b = new EscPos.Builder({ paper: '58mm' });
 *   b.init().align('center').bold(true).size(2,2).line('TOKO SAYA');
 *   EscPos.RawBT.print(b.toUint8Array());
 */
(function (global) {
  'use strict';

  var ESC = 0x1B;
  var GS  = 0x1D;

  var PAPER = {
    '58mm': { dots: 384, cols: 32 },
    '80mm': { dots: 576, cols: 48 }
  };

  // --- Util teks -----------------------------------------------------------
  // Printer thermal murah umumnya hanya punya code page PC437, jadi karakter
  // beraksen diratakan ke ASCII supaya tidak keluar simbol acak.
  function toAscii(str) {
    var s = String(str == null ? '' : str);
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    s = s.replace(/[‘’‛]/g, "'")
         .replace(/[“”]/g, '"')
         .replace(/[–—]/g, '-')
         .replace(/…/g, '...')
         .replace(/ /g, ' ');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 10) out += '\n';
      else if (c >= 32 && c <= 126) out += s.charAt(i);
      else if (c > 126) out += '?';
    }
    return out;
  }

  function wrapText(text, cols) {
    var lines = [];
    var paragraphs = toAscii(text).split('\n');
    for (var p = 0; p < paragraphs.length; p++) {
      var words = paragraphs[p].split(/\s+/).filter(function (w) { return w.length > 0; });
      if (words.length === 0) { lines.push(''); continue; }
      var cur = '';
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        // Kata yang lebih panjang dari lebar kertas dipotong paksa.
        while (w.length > cols) {
          if (cur) { lines.push(cur); cur = ''; }
          lines.push(w.slice(0, cols));
          w = w.slice(cols);
        }
        if (!cur) cur = w;
        else if (cur.length + 1 + w.length <= cols) cur += ' ' + w;
        else { lines.push(cur); cur = w; }
      }
      if (cur) lines.push(cur);
    }
    return lines;
  }

  function bytesToBase64(bytes) {
    var chunk = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return btoa(parts.join(''));
  }

  // --- Builder ESC/POS -----------------------------------------------------
  function Builder(opts) {
    opts = opts || {};
    var spec = PAPER[opts.paper] || PAPER['58mm'];
    this.paper = PAPER[opts.paper] ? opts.paper : '58mm';
    this.dots = opts.dots || spec.dots;
    this.cols = opts.cols || spec.cols;
    this._widthMul = 1;   // pengali lebar font aktif, dipakai saat word wrap
    this._buf = [];
  }

  Builder.prototype.raw = function (arr) {
    for (var i = 0; i < arr.length; i++) this._buf.push(arr[i] & 0xFF);
    return this;
  };

  Builder.prototype.text = function (str) {
    var s = toAscii(str);
    for (var i = 0; i < s.length; i++) this._buf.push(s.charCodeAt(i) & 0xFF);
    return this;
  };

  Builder.prototype.init = function () {
    return this.raw([ESC, 0x40])        // ESC @  : reset printer
               .raw([ESC, 0x74, 0x00]); // ESC t 0: code page PC437
  };

  Builder.prototype.align = function (mode) {
    var n = mode === 'center' ? 1 : mode === 'right' ? 2 : 0;
    return this.raw([ESC, 0x61, n]);
  };

  Builder.prototype.bold = function (on) {
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  };

  Builder.prototype.underline = function (on) {
    return this.raw([ESC, 0x2D, on ? 1 : 0]);
  };

  /** GS ! n - pengali ukuran font (1..8 untuk lebar & tinggi). */
  Builder.prototype.size = function (w, h) {
    var ww = Math.max(1, Math.min(8, w || 1));
    var hh = Math.max(1, Math.min(8, h || 1));
    this._widthMul = ww;
    return this.raw([GS, 0x21, ((ww - 1) << 4) | (hh - 1)]);
  };

  Builder.prototype.feed = function (n) {
    return this.raw([ESC, 0x64, Math.max(0, Math.min(255, n == null ? 1 : n))]);
  };

  /** Satu baris teks, otomatis dibungkus sesuai lebar kertas & ukuran font. */
  Builder.prototype.line = function (str) {
    var cols = Math.max(8, Math.floor(this.cols / this._widthMul));
    var lines = wrapText(str == null ? '' : str, cols);
    for (var i = 0; i < lines.length; i++) this.text(lines[i]).raw([0x0A]);
    return this;
  };

  Builder.prototype.blank = function (n) {
    for (var i = 0; i < (n || 1); i++) this.raw([0x0A]);
    return this;
  };

  Builder.prototype.divider = function (ch) {
    var c = (ch || '-').charAt(0);
    var cols = Math.max(8, Math.floor(this.cols / this._widthMul));
    return this.text(new Array(cols + 1).join(c)).raw([0x0A]);
  };

  /** Maju kertas lalu potong (printer tanpa cutter mengabaikan perintah ini). */
  Builder.prototype.cut = function (feedLines) {
    return this.feed(feedLines == null ? 4 : feedLines).raw([GS, 0x56, 0x42, 0x00]);
  };

  Builder.prototype.image = function (bytes) {
    return this.raw(bytes);
  };

  Builder.prototype.toUint8Array = function () {
    return new Uint8Array(this._buf);
  };

  Builder.prototype.toBase64 = function () {
    return bytesToBase64(this.toUint8Array());
  };

  // --- Gambar -> raster ESC/POS (GS v 0) -----------------------------------
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Gagal memuat gambar: ' + url)); };
      img.src = url;
    });
  }

  /** Ambang hitam/putih otomatis (metode Otsu) supaya logo tetap terbaca. */
  function otsuThreshold(gray) {
    var hist = [], i;
    for (i = 0; i < 256; i++) hist[i] = 0;
    for (i = 0; i < gray.length; i++) hist[gray[i]]++;

    var total = gray.length, sum = 0;
    for (i = 0; i < 256; i++) sum += i * hist[i];

    var sumB = 0, wB = 0, best = 0, threshold = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (wB === 0) continue;
      var wF = total - wB;
      if (wF === 0) break;
      sumB += i * hist[i];
      var mB = sumB / wB;
      var mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; threshold = i; }
    }
    return threshold;
  }

  /**
   * Render gambar jadi perintah raster ESC/POS.
   * Bitmap selalu dibuat selebar kertas dengan logo diletakkan di tengah,
   * jadi hasilnya tetap center walau printer mengabaikan perintah ESC a 1.
   */
  function rasterFromImage(img, opts) {
    opts = opts || {};
    var dots = opts.dots || 384;
    var ratio = opts.widthRatio == null ? 0.8 : opts.widthRatio;
    var maxHeight = opts.maxHeight || 180;
    var mode = opts.mode || 'auto'; // 'auto' | 'dither'

    var srcW = img.naturalWidth || img.width;
    var srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) throw new Error('Dimensi gambar tidak valid');

    var w = Math.floor((dots * ratio) / 8) * 8;
    var h = Math.round((srcH / srcW) * w);
    if (h > maxHeight) {
      h = maxHeight;
      w = Math.floor(((srcW / srcH) * h) / 8) * 8;
    }
    if (w < 8) w = 8;
    if (w > dots) w = dots;
    if (h < 1) h = 1;

    var canvas = document.createElement('canvas');
    canvas.width = dots;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dots, h);
    ctx.drawImage(img, Math.floor((dots - w) / 2), 0, w, h);

    var data = ctx.getImageData(0, 0, dots, h).data;
    var gray = new Uint8ClampedArray(dots * h);
    for (var i = 0, px = 0; i < data.length; i += 4, px++) {
      // Alpha sudah tergabung dengan latar putih oleh canvas.
      gray[px] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    }

    var bytesPerRow = dots / 8;
    var bitmap = new Uint8Array(bytesPerRow * h);

    if (mode === 'dither') {
      var buf = new Float32Array(gray.length);
      for (var g = 0; g < gray.length; g++) buf[g] = gray[g];
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < dots; x++) {
          var idx = y * dots + x;
          var oldv = buf[idx];
          var newv = oldv < 128 ? 0 : 255;
          var err = oldv - newv;
          if (newv === 0) bitmap[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
          if (x + 1 < dots) buf[idx + 1] += err * 7 / 16;
          if (y + 1 < h) {
            if (x > 0) buf[idx + dots - 1] += err * 3 / 16;
            buf[idx + dots] += err * 5 / 16;
            if (x + 1 < dots) buf[idx + dots + 1] += err * 1 / 16;
          }
        }
      }
    } else {
      var th = opts.threshold == null ? otsuThreshold(gray) : opts.threshold;
      for (var yy = 0; yy < h; yy++) {
        for (var xx = 0; xx < dots; xx++) {
          if (gray[yy * dots + xx] <= th) {
            bitmap[yy * bytesPerRow + (xx >> 3)] |= (0x80 >> (xx & 7));
          }
        }
      }
    }

    // Dipecah per pita supaya buffer printer murah tidak kehabisan memori.
    var band = 128;
    var out = [];
    for (var top = 0; top < h; top += band) {
      var rows = Math.min(band, h - top);
      out.push(GS, 0x76, 0x30, 0x00,
               bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,
               rows & 0xFF, (rows >> 8) & 0xFF);
      var start = top * bytesPerRow;
      var end = start + rows * bytesPerRow;
      for (var b = start; b < end; b++) out.push(bitmap[b]);
    }
    return new Uint8Array(out);
  }

  function rasterFromUrl(url, opts) {
    return loadImage(url).then(function (img) { return rasterFromImage(img, opts); });
  }

  // --- Jembatan RawBT ------------------------------------------------------
  var RawBT = {
    PACKAGE: 'ru.a402d.rawbtprinter',

    isAndroid: function () {
      return /android/i.test(navigator.userAgent || '');
    },

    /** URL intent yang dikenali RawBT. */
    buildUrl: function (bytes) {
      var b64 = (typeof bytes === 'string') ? bytes : bytesToBase64(bytes);
      return 'intent:base64,' + b64 + '#Intent;scheme=rawbt;package=' + RawBT.PACKAGE + ';end;';
    },

    /**
     * Kirim byte ESC/POS ke RawBT.
     * Kalau RawBT belum terpasang, Chrome otomatis membuka halaman Play Store.
     */
    print: function (bytes) {
      var url = RawBT.buildUrl(bytes);
      if (url.length > 2000000) throw new Error('Data cetak terlalu besar untuk RawBT');
      global.location.href = url;
      return url;
    },

    /** Cadangan: simpan sebagai .prn untuk dibuka/di-share ke RawBT manual. */
    downloadPrn: function (bytes, filename) {
      var blob = new Blob([bytes], { type: 'application/octet-stream' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'struk.prn';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 1500);
    }
  };

  global.EscPos = {
    Builder: Builder,
    RawBT: RawBT,
    PAPER: PAPER,
    toAscii: toAscii,
    wrapText: wrapText,
    bytesToBase64: bytesToBase64,
    loadImage: loadImage,
    rasterFromImage: rasterFromImage,
    rasterFromUrl: rasterFromUrl
  };
})(window);
