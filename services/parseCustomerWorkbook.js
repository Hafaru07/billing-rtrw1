const path = require('path');
const { Worker } = require('worker_threads');

function parseCustomerWorkbook(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'parseCustomerWorkbookWorker.js'), {
      workerData: buffer,
      resourceLimits: { maxOldGenerationSizeMb: 128 }
    });
    let settled = false;
    const finish = (error, rows) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error);
      else resolve(rows);
    };
    const timer = setTimeout(() => finish(new Error('File Excel terlalu berat untuk diproses')), 15000);
    worker.once('message', (message) => {
      if (message?.error) finish(new Error(message.error));
      else finish(null, message.rows);
    });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (code !== 0) finish(new Error('Gagal membaca file Excel'));
    });
  });
}

module.exports = { parseCustomerWorkbook };
