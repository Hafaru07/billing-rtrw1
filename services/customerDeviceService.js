/**
 * Logika GenieACS yang dipakai portal web dan bot WhatsApp.
 * Updated to support multi-server GenieACS setup.
 */
const axios = require('axios');
const db = require('../config/database');
const { getSettingsWithCache } = require('../config/settingsManager');
const auditTrail = require('./auditTrailService');
const { logger } = require('../config/logger');
const genieacsApi = require('../config/genieacs');
const mikrotikService = require('./mikrotikService');

// Helper: Search device across all servers (always get full data)
async function searchDeviceAcrossServers(query, fullData = true) {
  try {
    const servers = genieacsApi.getAllACSServers();
    
    for (const server of servers) {
      try {
        const instance = genieacsApi.createAxiosInstance(server);
        const params = {
          query: JSON.stringify(query)
        };
        
        // Only add projection if explicitly requesting minimal data
        if (!fullData) {
          params.projection = '_id,_tags';
        }

        let response;
        try {
          response = await instance.get('/devices', {
            params,
            timeout: 2000
          });
        } catch (e) {
          response = await instance.get('/api/devices', {
            params,
            timeout: 2000
          });
        }
        
        if (response.data && response.data.length > 0) {
          const device = response.data[0];
          device._acs_server_id = server.id;
          device._acs_server_name = server.name;
          logger.debug(`[CustomerDevice] Device found on ${server.name}`);
          return device;
        }
      } catch (error) {
        logger.debug(`[CustomerDevice] Device not found on ${server.name}: ${error.message}`);
      }
    }
    
    return null;
  } catch (error) {
    logger.error(`[CustomerDevice] Error searching device: ${error.message}`);
    return null;
  }
}

async function findDeviceByTag(tag) {
  try {
    const query = { $or: [{ _id: tag }, { _tags: tag }] };
    // Get full data by default
    return await searchDeviceAcrossServers(query, true);
  } catch (e) {
    logger.error(`[CustomerDevice] Error finding device by tag: ${e.message}`);
    return null;
  }
}

async function findDeviceByPppoe(pppoeUser) {
  try {
    const user = String(pppoeUser || '').trim();
    if (!user) return null;
    const keys = [
      'VirtualParameters.pppoeUsername',
      'VirtualParameters.pppUsername',
      ...PPPOE_USER_KEYS
    ];
    const query = { $or: keys.map(k => ({ [k]: user })) };
    // Get full data by default
    return await searchDeviceAcrossServers(query, true);
  } catch (e) {
    logger.error(`[CustomerDevice] Error finding device by PPPoE: ${e.message}`);
    return null;
  }
}

async function fetchFullDevice(tag) {
  try {
    const query = { $or: [{ _id: tag }, { _tags: tag }] };
    // Always get full data
    return await searchDeviceAcrossServers(query, true);
  } catch (e) {
    logger.error(`[CustomerDevice] Error fetching full device: ${e.message}`);
    return null;
  }
}

async function resolveDeviceToken(input) {
  const token = String(input ?? '').replace(/[\r\n\t]+/g, '').trim();
  if (!token) return null;

  const direct = await findDeviceByTag(token);
  if (direct && direct._id) return direct;

  const byPppoe = await findDeviceByPppoe(token);
  if (byPppoe && byPppoe._id) return byPppoe;

  const found = await findDeviceWithTagVariants(token);
  if (found && found.device && found.device._id) return found.device;

  return null;
}

const parameterPaths = {
  serialNumber: [
    'DeviceID.SerialNumber',
    'InternetGatewayDevice.DeviceInfo.SerialNumber',
    'Device.DeviceInfo.SerialNumber'
  ],
  model: [
    'DeviceID.ProductClass',
    'InternetGatewayDevice.DeviceInfo.ModelName',
    'Device.DeviceInfo.ModelName',
    'ModelName'
  ],
  softwareVersion: [
    'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
    'Device.DeviceInfo.SoftwareVersion'
  ],
  ssid: [
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
    'Device.WiFi.SSID.1.SSID',
    'Device.WiFi.SSID.2.SSID'
  ],
  rxPower: [
    'VirtualParameters.RXPower',
    'VirtualParameters.redaman',
    'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANOAM.RXPower',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_HW_OpticalSignal.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.RxPower',
    'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RxPower',
    'InternetGatewayDevice.WANDevice.1.X_ZTE_GponInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_ZTE_GponInterfaceConfig.RxPower',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_ZTE_OpticalSignal.RXPower',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_ZTE_OpticalSignal.RxPower',
    'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig.RxPower',
    'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_FH_GponInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_CU_WANEPONInterfaceConfig.OpticalTransceiver.RXPower',
    'Device.Optical.Interface.1.OpticalSignalLevel',
    'Device.XPON.Interface.1.Stats.RXPower',
    // Nokia / Alcatel-Lucent
    'InternetGatewayDevice.WANDevice.1.X_ALU-COM_GponInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_ALU-COM_GponInterfaceConfig.RxPower',
    'InternetGatewayDevice.WANDevice.1.X_ALU_COM_GponInterfaceConfig.RXPower',
    'Device.Optical.Interface.1.CurrentStatus.RXPower',
    'Device.Optical.Interface.1.RXPower',
    // FiberHome
    'InternetGatewayDevice.WANDevice.1.X_FH_GponInterfaceConfig.RxPower',
    'InternetGatewayDevice.WANDevice.1.X_FH_EponInterfaceConfig.RXPower',
    // ZTE / CMCC varian huruf kecil
    'InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.RxPower',
    'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.RxPower',
    'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RxPower',
    // Huawei varian
    'InternetGatewayDevice.WANDevice.1.X_HW_WANPONInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RxPower'
  ],

  // Cabang induk yang ikut diminta ke GenieACS. Memakai node induk (bukan daun)
  // supaya varian penamaan RXPower/RxPower milik tiap merek tetap ikut terambil.
  // Username PPPoE: banyak ONU (Huawei/ZTE) menaruhnya di WANConnectionDevice ke-2
  // atau lebih. Tanpa diminta di projection, nilainya tidak pernah dikirim GenieACS.
  pppoeBranches: [
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.2.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.2.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANPPPConnection.1.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANPPPConnection.2.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.4.WANPPPConnection.1.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.5.WANPPPConnection.1.Username',
    'Device.PPP.Interface.1.Username',
    'Device.PPP.Interface.2.Username',
    'Device.PPP.Interface.3.Username'
  ],

  rxPowerBranches: [
    'VirtualParameters',
    'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig',
    'InternetGatewayDevice.WANDevice.1.X_HW_GponInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_HW_WANPONInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_ZTE_GponInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_ALU-COM_GponInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_ALU_COM_GponInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_FH_GponInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_FH_EponInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig',
    'InternetGatewayDevice.WANDevice.1.X_CU_WANEPONInterfaceConfig.OpticalTransceiver',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_HW_OpticalSignal',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_ZTE_OpticalSignal',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANOAM',
    'Device.Optical.Interface.1',
    'Device.XPON.Interface.1.Stats'
  ],
  pppoeIP: [
    'VirtualParameters.pppoeIP',
    'VirtualParameters.pppIP',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.ExternalIPAddress',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANIPConnection.1.ExternalIPAddress',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANPPPConnection.1.ExternalIPAddress',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANIPConnection.1.ExternalIPAddress',
    'Device.PPP.Interface.1.ExternalIPAddress',
    'Device.IP.Interface.1.IPv4Address.1.IPAddress'
  ],
  pppUsername: [
    'VirtualParameters.pppoeUsername',
    'VirtualParameters.pppUsername',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.2.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.3.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.2.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANPPPConnection.1.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANPPPConnection.2.Username',
    'Device.PPP.Interface.1.Username',
    'Device.PPP.Interface.2.Username',
    'Device.PPP.Interface.3.Username'
  ],
  uptime: [
    'VirtualParameters.getdeviceuptime',
    'InternetGatewayDevice.DeviceInfo.UpTime',
    'Device.DeviceInfo.UpTime'
  ],
  userConnected: [
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.TotalAssociations',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDeviceNumberOfEntries',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDeviceNumberOfEntries',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Associations',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Associations',
    'InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries',
    'Device.WiFi.AccessPoint.1.AssociatedDeviceNumberOfEntries',
    'Device.WiFi.AccessPoint.2.AssociatedDeviceNumberOfEntries',
    'Device.Hosts.HostNumberOfEntries'
  ]
};

// PPPoE IP search keys matching user's template
const PPPOE_IP_KEYS = [
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress',
  'InternetGatewayDevice.WANDevice.*.WANConnectionDevice.1.WANPPPConnection.2.ExternalIPAddress',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.ExternalIPAddress',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.2.ExternalIPAddress',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANPPPConnection.1.ExternalIPAddress',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.4.WANPPPConnection.1.ExternalIPAddress',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.5.WANPPPConnection.1.ExternalIPAddress',
  'InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.ExternalIPAddress',
  'Device.PPP.Interface.1.ExternalIPAddress',
  'Device.IP.Interface.1.IPv4Address.1.IPAddress'
];

// PPPoE Username search keys matching user's template
const PPPOE_USER_KEYS = [
  // VirtualParameters didahulukan: selalu ikut terambil dan sudah dinormalkan ACS
  'VirtualParameters.pppoeUsername',
  'VirtualParameters.pppoeUsername2',
  'VirtualParameters.pppUsername',
  'VirtualParameters.PPPoEUsername',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
  'InternetGatewayDevice.WANDevice.*.WANConnectionDevice.1.WANPPPConnection.2.Username',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.2.Username',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANPPPConnection.1.Username',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANPPPConnection.2.Username',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.4.WANPPPConnection.1.Username',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.4.WANPPPConnection.2.Username',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.5.WANPPPConnection.1.Username',
  'InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.Username',
  'Device.PPP.Interface.1.Username',
  'Device.PPP.Interface.2.Username',
  'Device.PPP.Interface.3.Username'
];

function getNestedValue(obj, path) {
  try {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (!current) return null;
      current = current[part];
    }
    if (current && typeof current === 'object' && '_value' in current) {
      return current._value;
    }
    if (current && typeof current === 'object' && current.hasOwnProperty('_value')) {
      return current._value;
    }
    return current;
  } catch (e) {
    return null;
  }
}

function getWildcardMatches(device, path) {
  const parts = path.split('.');
  const results = [];

  function recurse(current, index, currentPathParts) {
    if (current === undefined || current === null) return;
    
    if (index === parts.length) {
      let val = current;
      if (typeof current === 'object' && '_value' in current) {
        val = current._value;
      }
      results.push({
        path: currentPathParts.join('.'),
        value: val
      });
      return;
    }

    const part = parts[index];
    if (part === '*') {
      if (typeof current === 'object') {
        for (const key of Object.keys(current)) {
          if (!key.startsWith('_')) {
            recurse(current[key], index + 1, [...currentPathParts, key]);
          }
        }
      }
    } else {
      if (typeof current === 'object') {
        const targetLower = part.toLowerCase();
        for (const key of Object.keys(current)) {
          if (key.toLowerCase() === targetLower) {
            recurse(current[key], index + 1, [...currentPathParts, key]);
          }
        }
      }
    }
  }

  recurse(device, 0, []);
  return results;
}

function getDeviceParameterValue(device, keys, filterFn) {
  for (const key of keys) {
    const matches = getWildcardMatches(device, key);
    for (const match of matches) {
      if (filterFn) {
        if (filterFn(match.path, match.value, device)) {
          return match.value;
        }
      } else if (match.value !== undefined && match.value !== null && match.value !== '') {
        return match.value;
      }
    }
  }
  return '';
}

function extractPppoeIp(d) {
  const ip = getDeviceParameterValue(d, PPPOE_IP_KEYS, (matchedPath, value, device) => {
    if (!value || value === '0.0.0.0' || value === '-') return false;
    
    if (matchedPath.includes('WANPPPConnection.')) {
      const connectionTypePath = matchedPath.replace('ExternalIPAddress', 'ConnectionType');
      const connTypeMatches = getWildcardMatches(device, connectionTypePath);
      if (connTypeMatches.length > 0 && connTypeMatches[0].value === 'bridge') {
        return false;
      }
    }
    return true;
  });
  
  if (ip) return ip;
  if (d._ip && d._ip !== '-' && d._ip !== '0.0.0.0') return d._ip;
  return 'N/A';
}

function extractPppoeUser(d) {
  const user = getDeviceParameterValue(d, PPPOE_USER_KEYS, (matchedPath, value, device) => {
    if (!value || value === '-') return false;
    
    if (matchedPath.includes('WANPPPConnection.')) {
      const connectionTypePath = matchedPath.replace('Username', 'ConnectionType');
      const connTypeMatches = getWildcardMatches(device, connectionTypePath);
      if (connTypeMatches.length > 0 && connTypeMatches[0].value === 'PPPoE_Bridged') {
        return false;
      }
    }
    return true;
  });
  
  return user || 'N/A';
}

function formatUptime(seconds) {
  if (!seconds || seconds === 'N/A' || seconds === '-') return seconds || 'N/A';
  if (typeof seconds === 'string' && (seconds.includes('d') || seconds.includes(':')) && isNaN(seconds)) {
    return seconds;
  }
  const totalSecs = parseInt(seconds, 10);
  if (isNaN(totalSecs)) return seconds || 'N/A';
  const days = Math.floor(totalSecs / 86400);
  const rem = totalSecs % 86400;
  let hrs = Math.floor(rem / 3600);
  if (hrs < 10) hrs = "0" + hrs;
  const rem2 = rem % 3600;
  let mins = Math.floor(rem2 / 60);
  if (mins < 10) mins = "0" + mins;
  let secs = rem2 % 60;
  if (secs < 10) secs = "0" + secs;
  return days + "d " + hrs + ":" + mins + ":" + secs;
}

function formatDeviceTimestamp(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID');
}

function formatRelativeTime(value) {
  if (!value) return '-';
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return '-';
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return 'baru saja';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec} detik lalu`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} menit lalu`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} jam lalu`;
  const day = Math.floor(hour / 24);
  return `${day} hari lalu`;
}

function collectRefreshObjects(device) {
  const objects = [];
  const isTr181 = !!device?.Device;

  if (isTr181) {
    // TR-181 Device - validate before pushing
    if (device?.Device?.Hosts?.Host) {
      objects.push('Device.Hosts.Host');
    }
    if (device?.Device?.WiFi?.AccessPoint?.['1']) {
      objects.push('Device.WiFi.AccessPoint.1.AssociatedDevice');
    }
    if (device?.Device?.WiFi?.AccessPoint?.['2']) {
      objects.push('Device.WiFi.AccessPoint.2.AssociatedDevice');
    }
  } else {
    // TR-098 Device (InternetGatewayDevice) - validate before pushing
    // FIX for Error 9005: Only query objects that exist in device cache
    // Some devices (e.g. ZTE GM220-S XPON) don't have LANDevice/WiFi support
    if (device?.InternetGatewayDevice?.LANDevice?.['1']?.Hosts?.Host) {
      objects.push('InternetGatewayDevice.LANDevice.1.Hosts.Host');
    }
    if (device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.AssociatedDevice) {
      objects.push('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice');
    }
    if (device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['5']) {
      objects.push('InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice');
    }
  }

  return Array.from(new Set(objects));
}

function getBuiltinSyncState(deviceId) {
  const empty = {
    syncInProgress: false,
    syncPendingCount: 0,
    syncLastQueueAt: '',
    syncLastQueueLabel: '-',
    syncStatusLabel: 'Idle'
  };
  if (!deviceId) return empty;

  try {
    const pending = db.prepare(
      `SELECT COUNT(*) AS count, MAX(created_at) AS last_queue_at
       FROM acs_tasks
       WHERE device_id = ?
         AND name IN ('refreshObject', 'getParameterValues', 'getParameterNames')
         AND status IN ('pending', 'in_progress')`
    ).get(deviceId);

    const count = Number(pending?.count || 0);
    const lastQueueAt = String(pending?.last_queue_at || '');
    return {
      syncInProgress: count > 0,
      syncPendingCount: count,
      syncLastQueueAt: lastQueueAt,
      syncLastQueueLabel: formatDeviceTimestamp(lastQueueAt),
      syncStatusLabel: count > 0 ? `Sinkronisasi berjalan (${count})` : 'Idle'
    };
  } catch (e) {
    logger.debug(`[CustomerDevice] Failed reading ACS sync state for ${deviceId}: ${e.message}`);
    return empty;
  }
}

const PPPOE_UPTIME_KEYS = [
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Uptime',
  'InternetGatewayDevice.WANDevice.*.WANConnectionDevice.1.WANPPPConnection.2.Uptime',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Uptime',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.2.Uptime',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANPPPConnection.1.Uptime',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.4.WANPPPConnection.1.Uptime',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.5.WANPPPConnection.1.Uptime',
  'InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.Uptime',
  'Device.PPP.Interface.1.UpTime'
];

function extractPppoeUptime(d) {
  let uptimeVal = getDeviceParameterValue(d, PPPOE_UPTIME_KEYS, (matchedPath, value, device) => {
    if (value === undefined || value === null || value === '' || value === '-') return false;
    
    if (matchedPath.toLowerCase().includes('wanpppconnection')) {
      const connTypePath = matchedPath.substring(0, matchedPath.toLowerCase().lastIndexOf('.uptime')) + '.ConnectionType';
      const connTypeMatches = getWildcardMatches(device, connTypePath);
      if (connTypeMatches.length > 0 && connTypeMatches[0].value === 'PPPoE_Bridged') {
        return false;
      }
    }
    return true;
  });

  if (!uptimeVal || uptimeVal === '-') {
    const UPTIME_PATHS = [
      'VirtualParameters.getdeviceuptime',
      'InternetGatewayDevice.DeviceInfo.UpTime',
      'Device.DeviceInfo.UpTime'
    ];
    for (const path of UPTIME_PATHS) {
      const val = getNestedValue(d, path);
      if (val && val !== '-' && val !== '') {
        uptimeVal = val;
        break;
      }
    }
  }

  if (uptimeVal) {
    return formatUptime(uptimeVal);
  }
  return 'N/A';
}

/**
 * Cadangan terakhir: telusuri objek perangkat untuk kunci apa pun yang berbau
 * RXPower / OpticalSignalLevel. Dipakai bila merek ONU memakai penamaan yang
 * belum terdaftar di parameterPaths.rxPower.
 */
function findRxPowerDeep(node, depth) {
  depth = depth || 0;
  if (!node || typeof node !== 'object' || depth > 8) return null;

  for (const key of Object.keys(node)) {
    const lower = key.toLowerCase();
    const cocok = (lower.includes('rxpower') || lower.includes('opticalsignallevel') || lower === 'rx_power');
    if (cocok && !lower.includes('tx')) {
      let val = node[key];
      if (val && typeof val === 'object' && val._value !== undefined) val = val._value;
      if (val !== undefined && val !== null && String(val).trim() !== '' && String(val) !== 'N/A') {
        const num = parseFloat(val);
        if (Number.isFinite(num)) return val;
      }
    }
  }

  for (const key of Object.keys(node)) {
    if (key.startsWith('_')) continue;
    const hasil = findRxPowerDeep(node[key], depth + 1);
    if (hasil !== null) return hasil;
  }
  return null;
}

function getParameterWithPaths(device, paths) {
  let values = [];
  for (const p of paths) {
    const parts = p.split('.');
    let value = device;
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
        if (value && value._value !== undefined) value = value._value;
      } else {
        value = undefined;
        break;
      }
    }
    if (value !== undefined && value !== null && value !== '' && value !== 'N/A') {
      const isIpPath = p.toLowerCase().includes('ipaddress') || p.toLowerCase().includes('pppoeip') || p.toLowerCase().includes('pppip') || p.toLowerCase().includes('pppusername') || p.toLowerCase().includes('pppoeusername');
      if (isIpPath && String(value) === '0.0.0.0') {
        continue;
      }
      const isCountParam = p.includes('TotalAssociations') || 
                           p.includes('AssociatedDeviceNumberOfEntries') || 
                           p.includes('HostNumberOfEntries');
                           
      if (isCountParam) {
        // Ensure we push a number
        const val = (typeof value === 'object' && value._value !== undefined) ? value._value : value;
        values.push(parseInt(val) || 0);
      } else {
        // If it's still an object, try to get _value or stringify it
        if (typeof value === 'object') {
          if (value._value !== undefined) return String(value._value);
          return 'N/A'; // Don't return raw object
        }
        return String(value);
      }
    }
  }
  
  if (values.length > 0) {
    // If it's a count parameter, sum them up (for dual band)
    return values.reduce((a, b) => a + b, 0);
  }
  
  return 'N/A';
}

function expandTagCandidates(input) {
  const t = String(input || '').trim();
  if (!t) return [];
  if (/^\d+$/.test(t)) {
    const d = t.replace(/\D/g, '');
    const set = new Set([d]);
    if (d.startsWith('62') && d.length > 2) set.add('0' + d.slice(2));
    if (d.startsWith('0')) set.add('62' + d.slice(1));
    return [...set];
  }
  return [t];
}

/** Coba beberapa varian tag (62/0 untuk nomor) sampai device ketemu */
async function findDeviceWithTagVariants(input) {
  for (const c of expandTagCandidates(input)) {
    const dev = await findDeviceByTag(c);
    if (dev) return { device: dev, canonicalTag: c };
  }
  return null;
}

/** Nomor dari JID WhatsApp @s.whatsapp.net */
function phoneFromPnJid(jid) {
  if (!jid || typeof jid !== 'string') return null;
  const [user, host] = jid.split('@');
  if (!user || host !== 's.whatsapp.net') return null;
  return user.replace(/\D/g, '') || null;
}

function mapDeviceData(device, tag, isPppoeActive = false) {
  if (!device) return null;

  const ssid = getParameterWithPaths(device, parameterPaths.ssid);
  const ssidDisplay = ssid === 'N/A' ? '-' : ssid;

  const lastInformRaw =
    device?._lastInform ||
    device?.Events?.Inform ||
    device?.InternetGatewayDevice?.DeviceInfo?.['1']?.LastInform?._value ||
    '';
  const lastInform = formatDeviceTimestamp(lastInformRaw);
  const lastSyncRaw = device?._updatedAt || lastInformRaw || '';
  const lastSync = formatDeviceTimestamp(lastSyncRaw);
  const syncState = getBuiltinSyncState(device?._id);

  let status = 'Unknown';
  if (device?._lastInform) {
    const diffMs = Date.now() - new Date(device._lastInform).getTime();
    status = diffMs < 15 * 60 * 1000 ? 'Online' : 'Offline';
  } else if (device?.Events?.Inform) {
    const diffMs = Date.now() - new Date(device.Events.Inform).getTime();
    status = diffMs < 15 * 60 * 1000 ? 'Online' : 'Offline';
  }

  if (status !== 'Online' && isPppoeActive) {
    status = 'Online';
  }

  let connectedUsers = [];
  try {
    const hosts = device?.InternetGatewayDevice?.LANDevice?.['1']?.Hosts?.Host || device?.Device?.Hosts?.Host;
    if (hosts && typeof hosts === 'object') {
      for (const key in hosts) {
        if (!isNaN(key)) {
          const entry = hosts[key];
          connectedUsers.push({
            hostname: typeof entry?.HostName === 'object' ? entry?.HostName?._value || '-' : entry?.HostName || '-',
            ip: typeof entry?.IPAddress === 'object' ? entry?.IPAddress?._value || '-' : entry?.IPAddress || '-',
            mac: typeof entry?.MACAddress === 'object' ? entry?.MACAddress?._value || '-' : entry?.MACAddress || '-',
            iface: typeof entry?.InterfaceType === 'object' ? entry?.InterfaceType?._value || '-' : entry?.InterfaceType || entry?.Interface || '-',
            status: (
              entry?.Active?._value === 'true' || 
              entry?.Active?._value === '1' || 
              entry?.Active?._value === 1 || 
              entry?.Active === true || 
              entry?.Active === '1' || 
              entry?.Active === 1 || 
              String(entry?.Active || '').toLowerCase() === 'online'
            ) ? 'Online' : 'Offline'
          });
        }
      }
    }

    const assocCandidates = [
      device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.AssociatedDevice,
      device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['5']?.AssociatedDevice,
      device?.Device?.WiFi?.AccessPoint?.['1']?.AssociatedDevice,
      device?.Device?.WiFi?.AccessPoint?.['2']?.AssociatedDevice
    ];
    for (const assoc of assocCandidates) {
      if (!assoc || typeof assoc !== 'object') continue;
      for (const key in assoc) {
        if (key === '_value' || key === '_type' || key === '_timestamp') continue;
        if (isNaN(key)) continue;
        const entry = assoc[key];
        const mac =
          (typeof entry?.MACAddress === 'object' ? entry?.MACAddress?._value : entry?.MACAddress) ||
          (typeof entry?.AssociatedDeviceMACAddress === 'object' ? entry?.AssociatedDeviceMACAddress?._value : entry?.AssociatedDeviceMACAddress) ||
          '-';
        const ip =
          (typeof entry?.IPAddress === 'object' ? entry?.IPAddress?._value : entry?.IPAddress) ||
          (typeof entry?.IP === 'object' ? entry?.IP?._value : entry?.IP) ||
          '-';
        const hostname =
          (typeof entry?.HostName === 'object' ? entry?.HostName?._value : entry?.HostName) ||
          (typeof entry?.DeviceName === 'object' ? entry?.DeviceName?._value : entry?.DeviceName) ||
          '-';
        const ssidName =
          (typeof entry?.SSID === 'object' ? entry?.SSID?._value : entry?.SSID) ||
          (typeof entry?.WLANConfiguration === 'object' ? entry?.WLANConfiguration?._value : entry?.WLANConfiguration) ||
          '';
        if (!mac || mac === '-') continue;
        connectedUsers.push({
          hostname: hostname || '-',
          ip: ip || '-',
          mac: mac || '-',
          iface: ssidName ? `WiFi ${ssidName}` : 'WiFi',
          status: 'Online'
        });
      }
    }
  } catch (e) {}

  try {
    const seen = new Set();
    connectedUsers = connectedUsers.filter((u) => {
      const mac = String(u?.mac || '').toUpperCase();
      const ip = String(u?.ip || '');
      const key = mac ? `${mac}|${ip}` : ip;
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {}

  let rxPower = getParameterWithPaths(device, parameterPaths.rxPower);
  if (rxPower === 'N/A' || rxPower === '-' || rxPower === '' || rxPower === undefined || rxPower === null) {
    const cadangan = findRxPowerDeep(device);
    if (cadangan !== null) rxPower = cadangan;
  }
  if (rxPower !== 'N/A' && rxPower !== '-' && rxPower !== '') {
    const num = parseFloat(rxPower);
    if (!isNaN(num) && num > 0) {
      const dbVal = 30 + (Math.log10(num * Math.pow(10, -7)) * 10);
      rxPower = (Math.ceil(dbVal * 100) / 100).toFixed(2);
    }
  }
  const pppoeIP = extractPppoeIp(device);
  const pppoeUsername = extractPppoeUser(device);
  const uptimeRaw = getParameterWithPaths(device, parameterPaths.uptime);
  let totalAssociations = getParameterWithPaths(device, parameterPaths.userConnected);

  // Fallback: If N/A or 0, count from connectedUsers list (LAN + WLAN)
  if ((totalAssociations === 'N/A' || totalAssociations === 0 || totalAssociations === '0') && connectedUsers.length > 0) {
    totalAssociations = connectedUsers.filter(u => u.status === 'Online').length;
  }
  if (totalAssociations === 'N/A' || totalAssociations === '-' || totalAssociations === '' || totalAssociations === null || totalAssociations === undefined) {
    totalAssociations = 0;
  }
  if (typeof totalAssociations === 'string' && /^\d+$/.test(totalAssociations)) {
    totalAssociations = parseInt(totalAssociations, 10);
  }

  function formatUptime(seconds) {
    if (!seconds || seconds === 'N/A' || seconds === '-') return seconds || 'N/A';
    if (typeof seconds === 'string' && (seconds.includes('d') || seconds.includes(':')) && isNaN(seconds)) {
      return seconds;
    }
    const totalSecs = parseInt(seconds, 10);
    if (isNaN(totalSecs)) return seconds || 'N/A';
    const days = Math.floor(totalSecs / 86400);
    const rem = totalSecs % 86400;
    
    let hrs = Math.floor(rem / 3600);
    if (hrs < 10) hrs = "0" + hrs;
    
    const rem2 = rem % 3600;
    let mins = Math.floor(rem2 / 60);
    if (mins < 10) mins = "0" + mins;
    
    let secs = rem2 % 60;
    if (secs < 10) secs = "0" + secs;
    
    return days + "d " + hrs + ":" + mins + ":" + secs;
  }
  const uptime = formatUptime(uptimeRaw);
  const pppoeUptime = extractPppoeUptime(device);

  const serialNumber = getParameterWithPaths(device, parameterPaths.serialNumber);
  const productClass = getParameterWithPaths(device, parameterPaths.model);
  const softwareVersion = getParameterWithPaths(device, parameterPaths.softwareVersion);
  const model = productClass;

  let lokasi = device?._tags || '-';
  if (Array.isArray(lokasi)) lokasi = lokasi.join(', ');

  return {
    phone: tag,
    ssid: ssidDisplay,
    status,
    lastInform,
    lastInformRaw: lastInformRaw || '',
    lastInformAgo: formatRelativeTime(lastInformRaw),
    lastSync,
    lastSyncRaw: lastSyncRaw || '',
    lastSyncAgo: formatRelativeTime(lastSyncRaw),
    syncInProgress: !!syncState.syncInProgress,
    syncPendingCount: Number(syncState.syncPendingCount || 0),
    syncLastQueueAt: syncState.syncLastQueueAt || '',
    syncLastQueueLabel: syncState.syncLastQueueLabel || '-',
    syncStatusLabel: syncState.syncStatusLabel || 'Idle',
    connectedUsers,
    rxPower: rxPower === 'N/A' ? '-' : rxPower,
    pppoeIP: pppoeIP === 'N/A' ? '-' : pppoeIP,
    pppoeUsername: pppoeUsername === 'N/A' ? '-' : pppoeUsername,
    pppoeUptime: pppoeUptime === 'N/A' ? '-' : pppoeUptime,
    serialNumber: serialNumber === 'N/A' ? '-' : serialNumber,
    productClass: productClass === 'N/A' ? '-' : productClass,
    lokasi,
    softwareVersion: softwareVersion === 'N/A' ? '-' : softwareVersion,
    model: model === 'N/A' ? '-' : model,
    uptime: uptime === 'N/A' ? '-' : uptime,
    totalAssociations
  };
}

async function getCustomerDeviceData(tag) {
  const base = await resolveDeviceToken(tag);
  if (!base || !base._id) return null;
  const device = await fetchFullDevice(base._id);
  
  let isPppoeActive = false;
  try {
    const pppoeUser = extractPppoeUser(device);
    if (pppoeUser && pppoeUser !== 'N/A' && pppoeUser !== '-') {
      const activeSessionsMap = await mikrotikService.getActivePppoeSessionsMap().catch(() => new Map());
      if (activeSessionsMap.has(pppoeUser.toLowerCase())) {
        isPppoeActive = true;
      }
    }
  } catch (e) {}

  return mapDeviceData(device, tag, isPppoeActive);
}

function fallbackCustomer(tag) {
  return {
    phone: tag,
    ssid: '-',
    status: 'Tidak ditemukan',
    lastInform: '-',
    lastInformAgo: '-',
    lastSync: '-',
    lastSyncAgo: '-',
    syncInProgress: false,
    syncPendingCount: 0,
    syncLastQueueLabel: '-',
    syncStatusLabel: 'Idle',
    connectedUsers: [],
    rxPower: '-',
    pppoeIP: '-',
    pppoeUsername: '-',
    pppoeUptime: '-',
    serialNumber: '-',
    productClass: '-',
    lokasi: '-',
    softwareVersion: '-',
    model: '-',
    uptime: '-',
    totalAssociations: '-'
  };
}

// ─── Ganti SSID / password WiFi ──────────────────────────────────────────────
// Dipetakan dari GenieACS produksi (226 ONU: Huawei HG8145V5/HG8245W5-6T,
// FiberHome HG6145D2, Nokia G-2425G-A, ZTE F670L, ZTE-CMCC F663NV3A). Semuanya
// memakai model TR-098; 2.4 GHz utama ada di WLANConfiguration.1 dan 5 GHz
// utama di WLANConfiguration.5. Indeks lain adalah SSID sekunder/tamu dan
// sengaja tidak disentuh.
//
// setParameterValues bersifat atomik: satu path yang tidak dikenal ONU (fault
// 9005) atau nilai yang ditolak (9007) membatalkan seluruh perintah. Karena itu
// path diambil dari pohon parameter ONU itu sendiri, dan password dicoba satu
// leaf per percobaan dengan urutan yang benar untuk vendornya.
const WLAN_ROOT = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration';

// Huawei menolak KeyPassphrase level atas (fault 9007, forum GenieACS #1478 dan
// #4685) dan menyimpan passphrase di PreSharedKey.1.KeyPassphrase; Nokia dan
// FiberHome juga mengisi leaf itu. ZTE memakai KeyPassphrase.
// PreSharedKey.1.PreSharedKey paling akhir karena banyak ONU mengharapkan 64
// digit hex di sana, bukan passphrase biasa.
// Parameter X_HW_WPSKeyWord / X_CMCC_WPSKeyWord adalah kunci WPS, bukan
// password WiFi, jadi tidak dipakai.
const LEAF_PSK_DULU = ['PreSharedKey.1.KeyPassphrase', 'KeyPassphrase', 'PreSharedKey.1.PreSharedKey'];
const LEAF_KEY_DULU = ['KeyPassphrase', 'PreSharedKey.1.KeyPassphrase', 'PreSharedKey.1.PreSharedKey'];
const URUTAN_LEAF_PASSWORD = {
  huawei: LEAF_PSK_DULU,
  nokia: LEAF_PSK_DULU,
  fiberhome: LEAF_PSK_DULU,
  'zte-cmcc': LEAF_KEY_DULU,
  zte: LEAF_KEY_DULU,
  lainnya: LEAF_KEY_DULU
};

// Fault yang berarti "path/nilai ini tidak cocok untuk ONU ini", sehingga aman
// dicoba lagi dengan leaf berikutnya.
const FAULT_COBA_LEAF_LAIN = /900[357]/;

// Hanya satu perubahan WiFi per perangkat dalam satu waktu.
const wifiSedangDiproses = new Map(); // deviceId -> waktu mulai (ms)
const BATAS_KUNCI_WIFI_MS = 3 * 60 * 1000;

function ambilNodeWifi(obj, jalur) {
  let cur = obj;
  for (const k of String(jalur).split('.')) {
    if (!cur || typeof cur !== 'object') return null;
    cur = cur[k];
  }
  return cur && typeof cur === 'object' ? cur : null;
}

function leafBisaDitulis(doc, jalur) {
  const node = ambilNodeWifi(doc, jalur);
  return !!node && node._writable !== false;
}

function deteksiVendorWifi(doc) {
  const d = (doc && doc._deviceId) || {};
  const kunciWlan1 = Object.keys(ambilNodeWifi(doc, WLAN_ROOT + '.1') || {});
  if (kunciWlan1.some(k => k.startsWith('X_CMCC_'))) return 'zte-cmcc';
  const teks = [d._Manufacturer, d._OUI, d._ProductClass].join(' ').toUpperCase();
  if (/HUAWEI|HWTC/.test(teks) || kunciWlan1.some(k => k.startsWith('X_HW_'))) return 'huawei';
  if (/FIBERHOME|FHTT/.test(teks)) return 'fiberhome';
  if (/NOKIA|ALCL|ALCATEL/.test(teks) || kunciWlan1.some(k => k.startsWith('X_ALU'))) return 'nokia';
  if (/ZTE/.test(teks)) return 'zte';
  return 'lainnya';
}

// SSID dan kandidat leaf password untuk WiFi utama 2.4 GHz dan (bila ada) 5 GHz.
function targetWifi(doc) {
  const vendor = deteksiVendorWifi(doc);
  const urutan = URUTAN_LEAF_PASSWORD[vendor] || URUTAN_LEAF_PASSWORD.lainnya;
  const target = [];

  for (const [pita, idx] of [['2.4G', '1'], ['5G', '5']]) {
    const base = WLAN_ROOT + '.' + idx;
    if (!ambilNodeWifi(doc, base)) continue;
    target.push({
      pita,
      ssid: leafBisaDitulis(doc, base + '.SSID') ? base + '.SSID' : null,
      password: urutan.map(leaf => base + '.' + leaf).filter(p => leafBisaDitulis(doc, p))
    });
  }

  // Cadangan untuk ONU bermodel TR-181 (tidak ada di jaringan saat ini).
  if (!target.length) {
    for (const [pita, idx] of [['2.4G', '1'], ['5G', '2']]) {
      if (!ambilNodeWifi(doc, 'Device.WiFi.SSID.' + idx)) continue;
      const jalurSsid = 'Device.WiFi.SSID.' + idx + '.SSID';
      target.push({
        pita,
        ssid: leafBisaDitulis(doc, jalurSsid) ? jalurSsid : null,
        password: ['KeyPassphrase', 'PreSharedKey']
          .map(leaf => 'Device.WiFi.AccessPoint.' + idx + '.Security.' + leaf)
          .filter(p => leafBisaDitulis(doc, p))
      });
    }
  }

  return { vendor, target };
}

async function ambilPohonWifi(instance, deviceId) {
  const res = await instance.get('/devices/', {
    params: {
      query: JSON.stringify({ _id: deviceId }),
      projection: '_id,_deviceId,' + WLAN_ROOT + ',Device.WiFi.SSID,Device.WiFi.AccessPoint'
    },
    timeout: 20000
  });
  const list = Array.isArray(res && res.data) ? res.data : [];
  return list.find(x => x && x._id === deviceId) || null;
}

// Task setParameterValues WiFi yang pernah gagal di perangkat ini (misalnya
// tinggalan versi lama yang ikut mengirim path Device.WiFi) terus diulang
// GenieACS di setiap inform. Bersihkan sebelum mengirim perintah baru.
async function bersihkanTaskWifiGagal(instance, deviceId) {
  try {
    const q = { params: { query: JSON.stringify({ device: deviceId }) }, timeout: 15000, validateStatus: () => true };
    const tasks = await instance.get('/tasks/', q);
    const faults = await instance.get('/faults/', q);
    const daftarTask = Array.isArray(tasks && tasks.data) ? tasks.data : [];
    const daftarFault = Array.isArray(faults && faults.data) ? faults.data : [];
    let dibersihkan = 0;
    for (const t of daftarTask) {
      if (t.name !== 'setParameterValues') continue;
      const jalur = (t.parameterValues || []).map(v => String(v[0] || ''));
      const khususWifi = jalur.length > 0 && jalur.every(p => /WLANConfiguration|Device\.WiFi/.test(p) && /SSID|KeyPassphrase|PreSharedKey/.test(p));
      if (!khususWifi) continue;
      const fault = daftarFault.find(f => String(f._id || '') === deviceId + ':task_' + t._id);
      if (!fault) continue;
      await instance.delete('/tasks/' + encodeURIComponent(t._id), { timeout: 10000, validateStatus: () => true });
      await instance.delete('/faults/' + encodeURIComponent(fault._id), { timeout: 10000, validateStatus: () => true });
      dibersihkan++;
    }
    if (dibersihkan) logger.info('[WiFi] ' + dibersihkan + ' task WiFi gagal lama dibersihkan dari ' + deviceId);
  } catch (e) {
    logger.debug('[WiFi] Pembersihan task lama dilewati: ' + e.message);
  }
}

// Kirim setParameterValues dan minta ONU langsung tersambung (connection
// request) supaya dieksekusi sekarang, bukan menunggu inform berkala.
// Hasil: 'applied' (HTTP 200, ONU sudah menerapkan), 'queued' (202, ONU belum
// merespons dan akan menerapkan saat tersambung), 'fault', atau 'error'.
async function kirimSetParameter(instance, deviceId, parameterValues) {
  const url = '/devices/' + encodeURIComponent(deviceId) + '/tasks';
  let res;
  try {
    res = await instance.post(url, { name: 'setParameterValues', parameterValues }, {
      // Lewat params, bukan ditempel di URL: proxy ACS bawaan mencocokkan URL persis.
      params: { timeout: 15000, connection_request: '' },
      timeout: 30000,
      validateStatus: () => true
    });
  } catch (e) {
    return { hasil: 'error', pesan: e.message };
  }

  const status = Number(res && res.status);
  if (status === 200) return { hasil: 'applied' };
  if (status !== 202) return { hasil: 'error', pesan: 'HTTP ' + status };

  // 202 bisa berarti ONU belum merespons, atau ONU menolak perintah (fault).
  const taskId = res.data && res.data._id ? String(res.data._id) : '';
  if (!taskId) return { hasil: 'queued' };
  try {
    const f = await instance.get('/faults/', {
      params: { query: JSON.stringify({ device: deviceId }) },
      timeout: 15000,
      validateStatus: () => true
    });
    const daftar = Array.isArray(f && f.data) ? f.data : [];
    const fault = daftar.find(x => String(x._id || '') === deviceId + ':task_' + taskId);
    if (fault) {
      // Hapus task & fault milik permintaan ini sendiri supaya tidak diulang
      // terus oleh GenieACS.
      await instance.delete('/tasks/' + encodeURIComponent(taskId), { timeout: 10000, validateStatus: () => true });
      await instance.delete('/faults/' + encodeURIComponent(fault._id), { timeout: 10000, validateStatus: () => true });
      return { hasil: 'fault', kode: String(fault.code || ''), pesan: String(fault.message || '') };
    }
  } catch (e) {
    // Fault tidak terbaca: anggap masih antre.
  }
  return { hasil: 'queued' };
}

function validateWifiSsid(ssid) {
  const s = String(ssid ?? '').replace(/[\r\n\t]+/g, '').trim();
  if (!s) return { error: 'Nama WiFi tidak boleh kosong.' };
  if (Buffer.byteLength(s, 'utf8') > 32) return { error: 'Nama WiFi maksimal 32 karakter.' };
  if (!/^[\x20-\x7E]+$/.test(s)) return { error: 'Nama WiFi hanya boleh huruf, angka, spasi, dan simbol standar (tanpa emoji).' };
  if (/['"\\<>`]/.test(s)) return { error: 'Nama WiFi tidak boleh memuat tanda kutip, garis miring terbalik, atau tanda < >.' };
  return { value: s };
}

function validateWifiPassword(password) {
  const p = String(password ?? '').replace(/[\r\n\t]+/g, '').trim();
  if (p.length < 8) return { error: 'Password WiFi minimal 8 karakter.' };
  if (p.length > 63) return { error: 'Password WiFi maksimal 63 karakter.' };
  if (!/^[\x20-\x7E]+$/.test(p)) return { error: 'Password WiFi hanya boleh huruf, angka, dan simbol standar (tanpa emoji).' };
  return { value: p };
}

async function ubahWifi(tag, jenis, nilai, actor) {
  const device = await resolveDeviceToken(tag);
  if (!device || !device._id) {
    return { ok: false, status: 'notfound', message: 'Perangkat tidak ditemukan di ACS.' };
  }

  const deviceId = device._id;
  const mulai = wifiSedangDiproses.get(deviceId);
  if (mulai && Date.now() - mulai < BATAS_KUNCI_WIFI_MS) {
    return { ok: false, status: 'busy', message: 'Permintaan sebelumnya masih diproses ACS. Mohon tunggu sampai selesai.' };
  }
  wifiSedangDiproses.set(deviceId, Date.now());

  try {
    const server = device._acs_server_id
      ? genieacsApi.getACSServer(device._acs_server_id)
      : genieacsApi.getACSServer('legacy');
    if (!server) return { ok: false, status: 'failed', message: 'Server ACS tidak ditemukan.' };
    const instance = genieacsApi.createAxiosInstance(server);

    let doc = null;
    try {
      doc = await ambilPohonWifi(instance, deviceId);
    } catch (e) {
      logger.warn('[WiFi] Gagal membaca parameter WiFi ' + deviceId + ': ' + e.message);
    }
    if (!doc) {
      return { ok: false, status: 'failed', message: 'Data WiFi modem belum terbaca di ACS. Tekan "Poll ONU Sekarang", tunggu sebentar, lalu coba lagi.' };
    }

    const { vendor, target } = targetWifi(doc);
    const percobaan = [];

    if (jenis === 'ssid') {
      const nama5g = (Buffer.byteLength(nilai, 'utf8') > 29 ? nilai.slice(0, 29) : nilai) + '-5G';
      const semua = target.filter(t => t.ssid)
        .map(t => [t.ssid, t.pita === '5G' ? nama5g : nilai, 'xsd:string']);
      if (semua.length) percobaan.push(semua);
      // Kalau SSID 5 GHz ditolak, setidaknya 2.4 GHz tetap berubah.
      const utama = target.find(t => t.pita === '2.4G' && t.ssid);
      if (utama && semua.length > 1) percobaan.push([[utama.ssid, nilai, 'xsd:string']]);
    } else {
      const maks = Math.max(0, ...target.map(t => t.password.length));
      for (let k = 0; k < maks; k++) {
        const pv = target.filter(t => t.password[k]).map(t => [t.password[k], nilai, 'xsd:string']);
        if (pv.length) percobaan.push(pv);
      }
    }

    if (!percobaan.length) {
      return { ok: false, status: 'failed', vendor, message: 'Modem ini tidak menyediakan parameter WiFi yang bisa diubah lewat ACS. Hubungi admin.' };
    }

    await bersihkanTaskWifiGagal(instance, deviceId);

    let terakhir = null;
    for (const pv of percobaan) {
      const jalur = pv.map(x => x[0]);
      const r = await kirimSetParameter(instance, deviceId, pv);
      terakhir = r;

      if (r.hasil === 'applied' || r.hasil === 'queued') {
        logger.info('[WiFi] ' + jenis + ' ' + r.hasil + ' di ' + deviceId + ' (' + vendor + ') lewat ' + jalur.join(', '));
        if (actor) {
          auditTrail.logAuditTrail({
            action: jenis === 'ssid' ? 'UPDATE_SSID' : 'UPDATE_PASSWORD',
            entity_type: 'device',
            entity_id: tag,
            actor_type: actor.type || 'unknown',
            actor_id: actor.id || null,
            actor_name: actor.name || null,
            details: jenis === 'ssid'
              ? { newSSID: nilai, status: r.hasil, vendor, paths: jalur }
              : { status: r.hasil, vendor, paths: jalur },
            ip_address: actor.ip || null,
            user_agent: actor.userAgent || null
          });
        }

        const pesan = jenis === 'ssid'
          ? (r.hasil === 'applied'
            ? 'Nama WiFi berhasil diubah menjadi "' + nilai + '" dan sudah diterapkan di modem. Sambungkan ulang perangkat Anda ke nama WiFi baru.'
            : 'Perintah sudah dikirim, tetapi modem belum merespons ACS. Nama WiFi akan berubah otomatis begitu modem tersambung.')
          : (r.hasil === 'applied'
            ? 'Password WiFi berhasil diubah dan sudah diterapkan di modem. Sambungkan ulang perangkat Anda memakai password baru.'
            : 'Perintah sudah dikirim, tetapi modem belum merespons ACS. Password akan berubah otomatis begitu modem tersambung.');
        return { ok: true, status: r.hasil, vendor, paths: jalur, message: pesan };
      }

      logger.warn('[WiFi] ' + jenis + ' ditolak ' + deviceId + ' (' + vendor + ') lewat ' + jalur.join(', ') +
        ': ' + (r.kode || '') + ' ' + (r.pesan || ''));
      if (r.hasil === 'fault' && FAULT_COBA_LEAF_LAIN.test(r.kode)) continue;
      break;
    }

    return {
      ok: false,
      status: 'failed',
      vendor,
      message: 'Modem menolak perubahan' + (terakhir && terakhir.kode ? ' (kode ' + terakhir.kode + ')' : '') + '. Silakan hubungi admin.'
    };
  } finally {
    wifiSedangDiproses.delete(deviceId);
  }
}

async function changeWifiSsid(tag, ssid, actor = null) {
  const cek = validateWifiSsid(ssid);
  if (cek.error) return { ok: false, status: 'invalid', message: cek.error };
  return ubahWifi(tag, 'ssid', cek.value, actor);
}

async function changeWifiPassword(tag, password, actor = null) {
  const cek = validateWifiPassword(password);
  if (cek.error) return { ok: false, status: 'invalid', message: cek.error };
  return ubahWifi(tag, 'password', cek.value, actor);
}

// Dipertahankan untuk pemanggil lama (admin, teknisi, API aplikasi) yang hanya
// butuh true/false. 'queued' dihitung berhasil: perintah sudah diterima ACS.
async function updateSSID(tag, newSSID, actor = null) {
  const r = await changeWifiSsid(tag, newSSID, actor);
  return r.ok;
}

async function updatePassword(tag, newPassword, actor = null) {
  const r = await changeWifiPassword(tag, newPassword, actor);
  return r.ok;
}

async function requestRefresh(tag, actor = null) {
  try {
    const device = await resolveDeviceToken(tag);
    if (!device || !device._id) {
      return { ok: false, message: 'Perangkat tidak ditemukan.' };
    }

    const server = device._acs_server_id
      ? genieacsApi.getACSServer(device._acs_server_id)
      : genieacsApi.getACSServer('legacy');
    if (!server) {
      return { ok: false, message: 'Server ACS tidak ditemukan.' };
    }

    if (server.id === 'builtin') {
      try {
        const pending = db.prepare(
          `SELECT COUNT(*) AS c
           FROM acs_tasks
           WHERE device_id = ?
             AND name IN ('refreshObject', 'getParameterValues', 'getParameterNames')
             AND status IN ('pending', 'in_progress')`
        ).get(device._id);
        if (pending && pending.c > 0) {
          return { ok: true, message: 'Sinkronisasi ONU masih berjalan. Mohon tunggu sebentar.' };
        }
      } catch (e) {
        logger.debug(`[CustomerDevice] Unable to check pending ACS tasks for ${device._id}: ${e.message}`);
      }
    }

    const instance = genieacsApi.createAxiosInstance(server);
    const tasksUrl = `/devices/${encodeURIComponent(device._id)}/tasks`;
    const refreshObjects = collectRefreshObjects(device);

    for (const objectName of refreshObjects) {
      await instance.post(tasksUrl, { name: 'refreshObject', objectName }, { timeout: 15000 });
    }

    if (actor) {
      auditTrail.logAuditTrail({
        action: 'REFRESH_DEVICE',
        entity_type: 'device',
        entity_id: tag,
        actor_type: actor.type || 'unknown',
        actor_id: actor.id || null,
        actor_name: actor.name || null,
        details: {
          device_id: device._id,
          refreshObjects
        },
        ip_address: actor.ip || null,
        user_agent: actor.userAgent || null
      });
    }

    return {
      ok: true,
      message: `Sinkronisasi ONU dimulai. ${refreshObjects.length} jalur TR-069 dipoll.`,
      deviceId: device._id,
      acsServerId: server.id
    };
  } catch (e) {
    logger.error(`[CustomerDevice] Error requesting refresh for ${tag}: ${e.message}`);
    return { ok: false, message: 'Gagal memulai sinkronisasi ONU.' };
  }
}

async function requestReboot(tag, actor = null) {
  const device = await resolveDeviceToken(tag);
  if (!device || !device._id) return { ok: false, message: 'Perangkat tidak ditemukan.' };
  
  const server = device._acs_server_id ? genieacsApi.getACSServer(device._acs_server_id) : genieacsApi.getACSServer('legacy');
  if (!server) return { ok: false, message: 'Server ACS tidak ditemukan.' };
  
  const instance = genieacsApi.createAxiosInstance(server);
  
  try {
    await instance.post(
      `/devices/${encodeURIComponent(device._id)}/tasks`,
      { name: 'reboot', timestamp: new Date().toISOString() }
    );

    // Catat audit trail jika berhasil
    if (actor) {
      auditTrail.logAuditTrail({
        action: 'REBOOT_DEVICE',
        entity_type: 'device',
        entity_id: tag,
        actor_type: actor.type || 'unknown',
        actor_id: actor.id || null,
        actor_name: actor.name || null,
        details: {
          device_id: device._id
        },
        ip_address: actor.ip || null,
        user_agent: actor.userAgent || null
      });
    }

    return { ok: true, message: 'Perintah reboot terkirim. Tunggu beberapa menit hingga ONU online.' };
  } catch (e) {
    return { ok: false, message: 'Gagal mengirim reboot ke GenieACS.' };
  }
}

/** Daftar perangkat yang punya minimal satu tag (untuk admin WA). */
async function listDevicesWithTags(limit = 250) {
  const servers = genieacsApi.getAllACSServers();
  const queries = [
    { _tags: { $exists: true, $ne: [] } },
    { _tags: { $exists: true, $not: { $size: 0 } } },
    { '_tags.0': { $exists: true } }
  ];
  const projection = [
    '_id',
    '_tags',
    '_lastInform',
    'DeviceID.SerialNumber',
    'VirtualParameters.pppoeUsername',
    'VirtualParameters.pppUsername',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username._value'
  ].join(',');

  let allDevices = [];
  const maxLimit = Math.max(1, Math.min(parseInt(limit, 10) || 250, 500));

  for (const server of servers) {
    let found = false;
    for (const query of queries) {
      try {
        const instance = genieacsApi.createAxiosInstance(server);
        let response;
        try {
          response = await instance.get(`/devices`, {
            params: {
              query: JSON.stringify(query),
              limit: maxLimit,
              projection
            },
            timeout: 45000
          });
        } catch (e) {
          response = await instance.get(`/api/devices`, {
            params: {
              query: JSON.stringify(query),
              limit: maxLimit,
              projection
            },
            timeout: 45000
          });
        }
        const rows = Array.isArray(response.data) ? response.data : [];
        if (rows.length > 0) {
          rows.forEach(d => {
            d._acs_server_id = server.id;
            d._acs_server_name = server.name;
          });
          allDevices.push(...rows);
          found = true;
          break;
        }
      } catch (e) {
        /* coba query alternatif */
      }
    }
  }
  
  if (allDevices.length > 0) {
    return { ok: true, devices: allDevices.slice(0, limit) };
  }
  
  return { ok: false, devices: [], message: 'Gagal mengambil daftar dari GenieACS.' };
}

/** Mengambil semua perangkat tanpa melihat tag. */
async function listAllDevices(limit = 999999, acsId = null) {
  let servers = genieacsApi.getAllACSServers();
  if (acsId && acsId !== 'all') {
    servers = servers.filter(s => String(s.id) === String(acsId));
  }
  
  let allDevices = [];
  let lastError = null;

  // Query servers in parallel using Promise.allSettled
  const promises = servers.map(async (server) => {
    try {
      const instance = genieacsApi.createAxiosInstance(server);
      const params = {
        limit,
        // Cabang RX power tiap merek ikut diminta; tanpa ini GenieACS tidak
        // mengirim nilainya dan redaman selalu kosong untuk Huawei/Nokia/FH/ZTE.
        projection: [parameterPaths.rxPowerBranches.join(','), parameterPaths.pppoeBranches.join(','), '_id,_tags,_lastInform,DeviceID.SerialNumber,VirtualParameters,InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username,InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.2.Username,InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress,Device.PPP.Interface.1.Username,Device.PPP.Interface.1.ExternalIPAddress,InternetGatewayDevice.DeviceInfo.ModelName,InternetGatewayDevice.DeviceInfo.SoftwareVersion,InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID,InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations,InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.TotalAssociations,InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries,Device.WiFi.AccessPoint.1.AssociatedDeviceNumberOfEntries,Device.Hosts.HostNumberOfEntries,InternetGatewayDevice.LANDevice.1.Hosts.Host,Device.Hosts.Host'].join(',')
      };
      let response;
      try {
        response = await instance.get(`/devices`, { params, timeout: 8000 });
      } catch (e) {
        response = await instance.get(`/api/devices`, { params, timeout: 8000 });
      }
      const rows = Array.isArray(response.data) ? response.data : [];
      rows.forEach(d => {
        d._acs_server_id = server.id;
        d._acs_server_name = server.name;
      });
      return rows;
    } catch (e) {
      logger.error(`[CustomerDevice] Error listing devices on ${server.name}: ${e.message}`);
      throw e;
    }
  });

  const results = await Promise.allSettled(promises);
  results.forEach((r) => {
    if (r.status === 'fulfilled') {
      allDevices.push(...r.value);
    } else {
      lastError = r.reason;
    }
  });
  
  if (allDevices.length > 0 || !lastError) {
    return { ok: true, devices: allDevices.slice(0, limit) };
  }
  
  return { ok: false, devices: [], message: 'Gagal mengambil daftar dari GenieACS: ' + (lastError ? lastError.message : 'Unknown error') };
}

async function updateCustomerTag(oldTag, newTag) {
  const device = await findDeviceByTag(oldTag);
  if (!device || !device._id) return { ok: false, message: 'Perangkat tidak ditemukan.' };
  
  const server = device._acs_server_id ? genieacsApi.getACSServer(device._acs_server_id) : genieacsApi.getACSServer('legacy');
  if (!server) return { ok: false, message: 'Server ACS tidak ditemukan.' };
  
  const instance = genieacsApi.createAxiosInstance(server);
  
  try {
    const tags = Array.isArray(device._tags) ? device._tags.filter((t) => t !== oldTag) : [];
    tags.push(newTag);
    await instance.put(
      `/devices/${encodeURIComponent(device._id)}`,
      { _id: device._id, _tags: tags }
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, message: 'Gagal mengubah tag.' };
  }
}

module.exports = {
  findDeviceByTag,
  findDeviceByPppoe,
  fetchFullDevice,
  resolveDeviceToken,
  mapDeviceData,
  extractPppoeUser,
  getCustomerDeviceData,
  fallbackCustomer,
  requestRefresh,
  updateSSID,
  updatePassword,
  changeWifiSsid,
  changeWifiPassword,
  validateWifiSsid,
  validateWifiPassword,
  requestReboot,
  updateCustomerTag,
  listDevicesWithTags,
  listAllDevices,
  expandTagCandidates,
  findDeviceWithTagVariants,
  phoneFromPnJid,
  findRxPowerDeep,
  parameterPaths
};
