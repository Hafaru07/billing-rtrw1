const ExcelJS = require('exceljs');

async function exportRowsToXlsx(rows, sheetName) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  const columns = Object.keys(rows[0] || {});
  sheet.addRow(columns);
  for (const row of rows) sheet.addRow(columns.map((column) => row[column] ?? ''));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { exportRowsToXlsx };
