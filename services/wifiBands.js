const WLAN_ROOT = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration';

const PSK_FIRST = ['PreSharedKey.1.KeyPassphrase', 'KeyPassphrase', 'PreSharedKey.1.PreSharedKey'];
const KEY_FIRST = ['KeyPassphrase', 'PreSharedKey.1.KeyPassphrase', 'PreSharedKey.1.PreSharedKey'];
const FIBERHOME_PASSWORD = ['PreSharedKey.1.PreSharedKey', 'PreSharedKey.1.KeyPassphrase', 'KeyPassphrase'];

function nodeAt(doc, path) {
  return String(path).split('.').reduce((node, part) => node && typeof node === 'object' ? node[part] : null, doc) || null;
}

function writable(doc, path) {
  const node = nodeAt(doc, path);
  return !!node && typeof node === 'object' && node._writable !== false;
}

function valueAt(doc, path) {
  const node = nodeAt(doc, path);
  return node && node._value != null ? String(node._value) : '';
}

function detectVendor(doc) {
  const id = doc?._deviceId || {};
  const model = String(id._ProductClass || '').toUpperCase();
  const keys = Object.keys(nodeAt(doc, WLAN_ROOT + '.1') || {});
  const identity = [id._Manufacturer, id._OUI, model, doc?._id].join(' ').toUpperCase();
  if (/FIBERHOME|FHTT|HG6145(?:D2|F1)/.test(identity)) return 'fiberhome';
  if (keys.some(key => key.startsWith('X_CMCC_'))) return 'zte-cmcc';
  if (/HUAWEI|HWTC/.test(identity) || keys.some(key => key.startsWith('X_HW_'))) return 'huawei';
  if (/NOKIA|ALCL|ALCATEL/.test(identity) || /^G-\d/.test(model) || keys.some(key => key.startsWith('X_ALU'))) return 'nokia';
  if (/ZTE/.test(identity)) return 'zte';
  return 'lainnya';
}

function isFiveGhz(doc, base) {
  const band = [
    valueAt(doc, base + '.OperatingFrequencyBand'),
    valueAt(doc, base + '.FrequencyBand'),
    valueAt(doc, base + '.X_HW_RadioFrequency'),
    valueAt(doc, base + '.Standard')
  ].join(' ').toLowerCase();
  const channel = Number(valueAt(doc, base + '.Channel'));
  return /5\s*g(?:hz)?|802\.11a|\bac\b/.test(band) || (channel > 14 && channel <= 196);
}

function targetWifi(doc) {
  const vendor = detectVendor(doc);
  const leaves = vendor === 'fiberhome'
    ? FIBERHOME_PASSWORD
    : (['huawei', 'nokia'].includes(vendor) ? PSK_FIRST : KEY_FIRST);
  const bands = [];

  const fiveBase = WLAN_ROOT + '.5';
  const alternateFiveBase = WLAN_ROOT + '.2';
  const fiveIndex = nodeAt(doc, fiveBase) ? '5' : (nodeAt(doc, alternateFiveBase) && isFiveGhz(doc, alternateFiveBase) ? '2' : null);
  for (const [band, index] of [['2.4G', '1'], ['5G', fiveIndex]]) {
    if (!index) continue;
    const base = WLAN_ROOT + '.' + index;
    if (!nodeAt(doc, base)) continue;
    bands.push({
      band,
      ssidValue: valueAt(doc, base + '.SSID'),
      ssidPath: writable(doc, base + '.SSID') ? base + '.SSID' : null,
      passwordPaths: leaves.map(leaf => base + '.' + leaf).filter(path =>
        writable(doc, path) || (vendor === 'fiberhome' && path.endsWith('.PreSharedKey.1.PreSharedKey') &&
          !nodeAt(doc, path) && nodeAt(doc, base)?._writable !== false)
      )
    });
  }

  if (!bands.length) {
    for (const [band, index] of [['2.4G', '1'], ['5G', '2']]) {
      const base = 'Device.WiFi.SSID.' + index;
      if (!nodeAt(doc, base)) continue;
      const ssidPath = base + '.SSID';
      bands.push({
        band,
        ssidValue: valueAt(doc, ssidPath),
        ssidPath: writable(doc, ssidPath) ? ssidPath : null,
        passwordPaths: ['KeyPassphrase', 'PreSharedKey']
          .map(leaf => 'Device.WiFi.AccessPoint.' + index + '.Security.' + leaf)
          .filter(path => writable(doc, path))
      });
    }
  }

  return { vendor, bands };
}

module.exports = { targetWifi };
