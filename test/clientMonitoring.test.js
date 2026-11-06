const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createClientMonitoringService } = require('../services/clientMonitoringCore');

function setup() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, pppoe_username TEXT, router_id INTEGER,
      genieacs_tag TEXT, lat TEXT, lng TEXT, status TEXT, package_id INTEGER);
    CREATE TABLE packages (id INTEGER PRIMARY KEY, name TEXT, speed_down INTEGER, speed_up INTEGER,
      use_fup INTEGER, fup_limit_gb INTEGER);
    INSERT INTO packages VALUES (1, 'Paket 20', 20, 10, 0, 0);
    INSERT INTO customers VALUES (1, 'Client Satu', 'client1', 4, 'ONT-1', '-6.2', '106.8', 'active', 1);
  `);
  let now = new Date('2026-11-06T04:00:00.000Z');
  let sessions = [];
  const mikrotik = {
    getAllRouters: () => [{ id: 4, is_active: 1 }],
    getPppoeActive: async () => sessions
  };
  const devices = {
    listAllDevices: async () => ({ ok: true, devices: [{ username: 'client1', _lastInform: now.toISOString() }] }),
    extractPppoeUser: (device) => device.username,
    mapDeviceData: () => ({ serialNumber: 'FH123', rxPower: '-19.4', totalAssociations: 3 })
  };
  const log = { warn() {}, error() {} };
  const createService = () => createClientMonitoringService({ database, mikrotik, devices, log,
    clock: () => now, timezone: () => 'Asia/Jakarta' });
  const service = createService();
  return { database, service, createService, setTime: (value) => { now = new Date(value); }, setSessions: (value) => { sessions = value; } };
}

test('client usage persists across outage and session reset without double counting', async () => {
  const { database, service, createService, setTime, setSessions } = setup();
  try {
    setSessions([{ name: 'client1', '.id': '*A', 'bytes-in': 100, 'bytes-out': 200 }]);
    await service.collectTraffic();
    setTime('2026-11-06T04:05:00.000Z');
    setSessions([{ name: 'client1', '.id': '*A', 'bytes-in': 5_100, 'bytes-out': 10_200 }]);
    await service.collectTraffic();
    assert.equal(service.getDetail(1, 1).current.download, 10_000);
    assert.equal(service.getDetail(1, 1).current.upload, 5_000);
    assert.equal(service.getList().rows[0].download_bps, 10_000 * 8 / 300);

    setTime('2026-11-06T04:06:00.000Z');
    setSessions([]);
    await service.collectTraffic();
    assert.equal(service.getDetail(1, 7).current.download, 10_000);
    assert.equal(service.getDetail(1, 7).customer.online, false);
    assert.equal(service.getDetail(1, 7).customer.download_bps, null);
    assert.equal(createService().getDetail(1, 7).current.download, 10_000);

    setTime('2026-11-06T04:30:00.000Z');
    setSessions([{ name: 'client1', '.id': '*B', 'bytes-in': 12_000, 'bytes-out': 25_000 }]);
    await service.collectTraffic();
    assert.equal(service.getDetail(1, 1).current.download, 10_000);
    setTime('2026-11-06T04:35:00.000Z');
    setSessions([{ name: 'client1', '.id': '*B', 'bytes-in': 14_000, 'bytes-out': 29_000 }]);
    await service.collectTraffic();
    assert.equal(service.getDetail(1, 1).current.download, 14_000);
    assert.equal(service.getDetail(1, 1).current.upload, 7_000);
    assert.equal(service.getOverview().online, 1);
  } finally { database.close(); }
});

test('ONT data and coordinates stay available after the device goes offline', async () => {
  const { database, service, setTime } = setup();
  try {
    await service.collectOnt();
    let row = service.getList().rows[0];
    assert.equal(row.ont_sn, 'FH123');
    assert.equal(row.rx_power_dbm, -19.4);
    assert.equal(row.connected_count, 3);
    assert.deepEqual(row.coordinates, { lat: -6.2, lng: 106.8 });
    setTime('2026-11-07T04:00:00.000Z');
    assert.equal(service.getDetail(1, 30).customer.ont_sn, 'FH123');
    assert.equal(service.getDetail(1, 30).customer.connected_count, 3);
  } finally { database.close(); }
});
