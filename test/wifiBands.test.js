const test = require('node:test');
const assert = require('node:assert/strict');
const { targetWifi } = require('../services/wifiBands');

function device(manufacturer, productClass, wlan) {
  return {
    _id: `${manufacturer}-${productClass}`,
    _deviceId: { _Manufacturer: manufacturer, _ProductClass: productClass },
    InternetGatewayDevice: { LANDevice: { '1': { WLANConfiguration: wlan } } }
  };
}

test('Fiberhome and FHTT models try WPA2 PreSharedKey first on both bands', () => {
  for (const [manufacturer, productClass] of [
    ['Fiberhome', 'HG6145F1'], ['FHTT', 'AN5506'], ['Fiberhome', 'HG6145D2']
  ]) {
    const doc = device(manufacturer, productClass, {
      '1': { SSID: { _value: 'Rumah', _writable: true }, KeyPassphrase: { _writable: true }, X_CMCC_Wlan: {} },
      '5': { SSID: { _value: 'Rumah', _writable: true }, KeyPassphrase: { _writable: true } }
    });
    const result = targetWifi(doc);
    assert.equal(result.vendor, 'fiberhome');
    assert.deepEqual(result.bands.map(b => b.passwordPaths[0]), [
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey'
    ]);
  }
});

test('explicitly read-only Fiberhome PreSharedKey is never sent', () => {
  const doc = device('FHTT', 'AN5506', {
    '1': {
      SSID: { _value: 'Rumah', _writable: true },
      PreSharedKey: { '1': { PreSharedKey: { _writable: false } } },
      KeyPassphrase: { _writable: true }
    }
  });
  assert.deepEqual(targetWifi(doc).bands[0].passwordPaths, [
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase'
  ]);
});

test('other vendors keep their existing password preference', () => {
  const doc = device('ZTE', 'F670', {
    '1': {
      SSID: { _value: 'Rumah', _writable: true },
      KeyPassphrase: { _writable: true },
      PreSharedKey: { '1': { PreSharedKey: { _writable: true } } }
    }
  });
  assert.equal(targetWifi(doc).bands[0].passwordPaths[0],
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase');
});
