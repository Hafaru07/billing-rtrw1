const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ejs = require('ejs');
const { targetWifi } = require('../services/wifiBands');

const servicePath = path.join(__dirname, '../services/customerDeviceService.js');
const serviceSource = fs.readFileSync(servicePath, 'utf8');
const root = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration';

function device(manufacturer, model, options = {}) {
  const wlan = {
    '1': {
      SSID: { _value: 'Home' },
      KeyPassphrase: { _value: 'oldpassword' },
      PreSharedKey: { '1': { KeyPassphrase: { _value: 'oldpassword' } } }
    }
  };
  if (options.five !== false) {
    wlan['5'] = {
      SSID: { _value: 'Home-5G' },
      KeyPassphrase: { _value: 'oldpassword' },
      PreSharedKey: { '1': { KeyPassphrase: { _value: 'oldpassword' } } }
    };
  }
  if (options.second) wlan['2'] = options.second;
  return {
    _id: 'onu-1',
    _deviceId: { _Manufacturer: manufacturer, _ProductClass: model },
    InternetGatewayDevice: { LANDevice: { '1': { WLANConfiguration: wlan } } }
  };
}

function serviceWithAcs(doc, responder = () => ({ status: 200, data: {} }), options = {}) {
  const calls = [];
  let fault = null;
  const instance = {
    get: async url => {
      if (url === '/devices' || url === '/devices/') return { data: [doc] };
      if (url === '/tasks/') return { data: [] };
      if (url === '/faults/') return { data: fault ? [fault] : [] };
      return { data: [] };
    },
    post: async (url, body) => {
      calls.push(body.parameterValues);
      const response = responder(body.parameterValues, calls.length);
      fault = response.fault || null;
      return response;
    },
    delete: async () => { fault = null; return { status: 200 }; }
  };
  const server = { id: options.serverId || 'legacy', name: 'Test ACS' };
  const acs = {
    getAllACSServers: () => [server],
    getACSServer: () => server,
    createAxiosInstance: () => instance
  };
  const noop = () => {};
  const mocks = {
    axios: {},
    '../config/database': {
      prepare: () => ({ get: () => options.taskRow ? options.taskRow(calls.length) : null })
    },
    '../config/settingsManager': { getSettingsWithCache: () => ({}) },
    './auditTrailService': { logAuditTrail: noop },
    '../config/logger': { logger: { debug: noop, info: noop, warn: noop, error: noop } },
    '../config/genieacs': acs,
    './mikrotikService': {},
    './wifiBands': { targetWifi }
  };
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports,
    require: name => {
      if (!(name in mocks)) throw new Error('Unexpected import: ' + name);
      return mocks[name];
    },
    Buffer, Date, Map, Set, Promise, console, setTimeout, clearTimeout
  };
  vm.runInNewContext(serviceSource, sandbox, { filename: servicePath });
  return { service: module.exports, calls };
}

test('vendor models select the correct main radios and password leaf', () => {
  const cases = [
    ['Huawei', 'HG8145V5', 'huawei', 'PreSharedKey.1.KeyPassphrase'],
    ['Huawei', 'HG8245W5-6T', 'huawei', 'PreSharedKey.1.KeyPassphrase'],
    ['FiberHome', 'HG6145D2', 'fiberhome', 'KeyPassphrase'],
    ['FiberHome', 'HG6145F1', 'fiberhome', 'KeyPassphrase'],
    ['Nokia', 'G-2425G-A', 'nokia', 'PreSharedKey.1.KeyPassphrase'],
    ['ZTE', 'F670L', 'zte', 'KeyPassphrase']
  ];
  for (const [manufacturer, model, vendor, leaf] of cases) {
    const mapped = targetWifi(device(manufacturer, model));
    assert.equal(mapped.vendor, vendor, model);
    assert.equal(mapped.bands.length, 2, model);
    assert.equal(mapped.bands[0].ssidPath, root + '.1.SSID', model);
    assert.equal(mapped.bands[1].ssidPath, root + '.5.SSID', model);
    assert.equal(mapped.bands[0].passwordPaths[0], root + '.1.' + leaf, model);
  }
  const cmcc = device('ZTE', 'F663NV3A');
  cmcc.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['1'].X_CMCC_Test = {};
  assert.equal(targetWifi(cmcc).vendor, 'zte-cmcc');
});

test('WLAN index 2 is only treated as 5 GHz when its radio metadata says so', () => {
  const guest = device('ZTE', 'F670L', { five: false, second: { SSID: { _value: 'Guest' } } });
  assert.equal(targetWifi(guest).bands.length, 1);
  guest.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['2'].Channel = { _value: 36 };
  assert.equal(targetWifi(guest).bands[1].ssidPath, root + '.2.SSID');
});

test('FiberHome HG6145F1 changes one password band with its KeyPassphrase path', async () => {
  const { service, calls } = serviceWithAcs(device('FiberHome', 'HG6145F1'));
  const result = await service.changeWifiPassword('customer', 'newpassword', null, { band: '2.4G' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'applied');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0][0], root + '.1.KeyPassphrase');
});

test('the 5 GHz password targets only the 5 GHz radio', async () => {
  const { service, calls } = serviceWithAcs(device('FiberHome', 'HG6145D2'));
  const result = await service.changeWifiPassword('customer', 'newpassword', null, { band: '5G' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0][0], root + '.5.KeyPassphrase');
});

test('an explicit 5 GHz change fails clearly on a single-band ONU', async () => {
  const { service, calls } = serviceWithAcs(device('ZTE', 'F670L', { five: false }));
  const result = await service.changeWifiPassword('customer', 'newpassword', null, { band: '5G' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unsupported');
  assert.equal(calls.length, 0);
});

test('a legacy SSID change still works when the 5 GHz SSID is not writable', async () => {
  const doc = device('ZTE', 'F670L');
  doc.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['5'].SSID._writable = false;
  const { service, calls } = serviceWithAcs(doc);
  const result = await service.changeWifiSsid('customer', 'NewHome');
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0][0], root + '.1.SSID');
});

test('a rejected FiberHome password leaf falls back without touching the other band', async () => {
  const { service, calls } = serviceWithAcs(device('FiberHome', 'HG6145F1'), (values, attempt) =>
    attempt === 1
      ? { status: 202, data: { _id: '1' }, fault: { _id: 'onu-1:task_1', code: '9007', message: 'Invalid value' } }
      : { status: 200, data: {} }
  );
  const result = await service.changeWifiPassword('customer', 'newpassword', null, { band: '2.4G' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0][0], root + '.1.KeyPassphrase');
  assert.equal(calls[1][0][0], root + '.1.PreSharedKey.1.KeyPassphrase');
});

test('built-in ACS fault is recognized before trying the next FiberHome leaf', async () => {
  const { service, calls } = serviceWithAcs(
    device('FiberHome', 'HG6145F1'),
    (_values, attempt) => ({ status: 202, data: { _id: String(attempt) } }),
    {
      serverId: 'builtin',
      taskRow: attempt => attempt === 1
        ? { status: 'failed', result: JSON.stringify({ faultCode: '9007', faultString: 'Invalid value' }) }
        : { status: 'completed', result: '{}' }
    }
  );
  const result = await service.changeWifiPassword('customer', 'newpassword', null, { band: '2.4G' });
  assert.equal(result.status, 'applied');
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0][0], root + '.1.PreSharedKey.1.KeyPassphrase');
  assert.equal(await service.statusTaskAcs({ serverId: 'builtin', deviceId: 'onu-1', taskId: '2' }), 'done');
});

test('Bandsteering synchronizes SSIDs, while an independent 5 GHz failure stays visible', async () => {
  const { service, calls } = serviceWithAcs(device('ZTE', 'F670L'), (values, attempt) =>
    attempt === 2
      ? { status: 202, data: { _id: '2' }, fault: { _id: 'onu-1:task_2', code: '9007', message: 'Rejected' } }
      : { status: 200, data: {} }
  );
  const result = await service.changeWifiSsid('customer', 'SameHome', null,
    { ssid5g: 'Different', bandSteering: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0][1], 'SameHome');
  assert.equal(calls[1][0][1], 'SameHome');
  assert.equal(result.status, 'partial');
  assert.equal(result.bands['2.4G'].status, 'applied');
  assert.equal(result.bands['5G'].status, 'failed');
});

test('customer dashboard renders both radios and valid browser JavaScript', async () => {
  const viewPath = path.join(__dirname, '../views/dashboard.ejs');
  const html = await ejs.renderFile(viewPath, {
    lang: 'id', t: (_key, fallback) => fallback,
    customerBalance: 0,
    customer: {
      id: 1, phone: '081200000000', status: 'Online', model: 'HG6145F1',
      rxPower: '-20', totalAssociations: 0, ssid: 'Home', ssid5g: 'Home-5G',
      hasWifi5g: true, pppoeUsername: 'test', syncInProgress: false
    },
    profile: { id: 1, name: 'Pelanggan', status: 'active', phone: '081200000000' },
    settings: {}, notif: null, invoices: [], tickets: [], paymentChannels: [],
    connectedUsers: [], showPPOB: false, trafficMaxDownMbps: 10, trafficMaxUpMbps: 10
  });
  assert.match(html, /id="ssid5gDisplay"/);
  assert.match(html, /id="bandSteeringToggle"/);
  assert.match(html, /name="band" id="modalPassBand"/);
  for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (script.trim()) new vm.Script(script);
  }
});
