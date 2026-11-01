const { parentPort, workerData } = require('worker_threads');
const ExcelJS = require('exceljs');

function plainValue(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return value;
  if (Object.hasOwn(value, 'result')) return plainValue(value.result);
  if (Object.hasOwn(value, 'text')) return plainValue(value.text);
  if (Array.isArray(value.richText)) return value.richText.map((part) => String(part.text || '')).join('');
  return '';
}

async function parse() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(workerData));
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Sheet pertama tidak ditemukan');
  if (sheet.rowCount > 10001) throw new Error('Maksimal 10.000 baris per impor');

  const header = sheet.getRow(1);
  if (header.cellCount > 100) throw new Error('Terlalu banyak kolom dalam file impor');
  const keys = [];
  const seen = new Map();
  for (let col = 1; col <= header.cellCount; col++) {
    const base = String(plainValue(header.getCell(col).value) || `__EMPTY${col === 1 ? '' : `_${col - 1}`}`);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    keys.push(count ? `${base}_${count}` : base);
  }

  const rows = [];
  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex++) {
    const row = sheet.getRow(rowIndex);
    const clean = Object.create(null);
    let hasValue = false;
    for (let col = 1; col <= keys.length; col++) {
      const key = keys[col - 1];
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const value = plainValue(row.getCell(col).value);
      clean[key] = value;
      if (value !== '') hasValue = true;
    }
    if (hasValue) rows.push(clean);
  }
  if (rows.length === 0) throw new Error('Tidak ada baris pelanggan dalam file impor');
  parentPort.postMessage({ rows });
}

parse().catch((error) => parentPort.postMessage({ error: String(error?.message || error) }));
