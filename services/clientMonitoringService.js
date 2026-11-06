const db = require('../config/database');
const mikrotikService = require('./mikrotikService');
const customerDevice = require('./customerDeviceService');
const { getSetting } = require('../config/settingsManager');
const { logger } = require('../config/logger');
const { createClientMonitoringService, POLL_MS, PERIODS } = require('./clientMonitoringCore');

const service = createClientMonitoringService({
  database: db, mikrotik: mikrotikService, devices: customerDevice,
  log: logger, timezone: () => getSetting('timezone', 'Asia/Jakarta')
});

module.exports = { ...service, POLL_MS, PERIODS };
