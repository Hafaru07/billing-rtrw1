const POLL_MS = 5 * 60 * 1000;
const ONLINE_MS = 12 * 60 * 1000;
const PERIODS = [1, 7, 15, 30];

function localDay(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDay(day, offset) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function counter(row, names) {
  for (const name of names) {
    const value = row[name];
    if (value === undefined || value === null || value === '') continue;
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function validCoordinates(lat, lng) {
  if (String(lat ?? '').trim() === '' || String(lng ?? '').trim() === '') return null;
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { lat: latitude, lng: longitude };
}

function createClientMonitoringService({ database, mikrotik, devices, log, clock = () => new Date(), timezone = () => 'Asia/Jakarta' }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS client_monitor_state (
      customer_id INTEGER PRIMARY KEY,
      router_id INTEGER,
      pppoe_username TEXT,
      session_key TEXT,
      last_down_counter INTEGER,
      last_up_counter INTEGER,
      last_observed_ms INTEGER,
      last_seen_at TEXT,
      session_active INTEGER NOT NULL DEFAULT 0,
      download_bps REAL,
      upload_bps REAL,
      ont_sn TEXT,
      rx_power_dbm REAL,
      connected_count INTEGER,
      ont_last_inform TEXT,
      ont_synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS client_usage_daily (
      customer_id INTEGER NOT NULL,
      usage_date TEXT NOT NULL,
      download_bytes INTEGER NOT NULL DEFAULT 0,
      upload_bytes INTEGER NOT NULL DEFAULT 0,
      sample_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (customer_id, usage_date)
    );
    CREATE INDEX IF NOT EXISTS idx_client_monitor_state_router ON client_monitor_state(router_id);
    CREATE INDEX IF NOT EXISTS idx_client_usage_daily_date ON client_usage_daily(usage_date);
  `);

  const getState = database.prepare('SELECT * FROM client_monitor_state WHERE customer_id=?');
  const saveSample = database.prepare(`
    INSERT INTO client_monitor_state
      (customer_id, router_id, pppoe_username, session_key, last_down_counter, last_up_counter,
       last_observed_ms, last_seen_at, session_active, download_bps, upload_bps)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET
      router_id=excluded.router_id, pppoe_username=excluded.pppoe_username,
      session_key=excluded.session_key, last_down_counter=excluded.last_down_counter,
      last_up_counter=excluded.last_up_counter, last_observed_ms=excluded.last_observed_ms,
      last_seen_at=excluded.last_seen_at, session_active=1, download_bps=excluded.download_bps,
      upload_bps=excluded.upload_bps
  `);
  const addDaily = database.prepare(`
    INSERT INTO client_usage_daily(customer_id, usage_date, download_bytes, upload_bytes, sample_count)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(customer_id, usage_date) DO UPDATE SET
      download_bytes=client_usage_daily.download_bytes+excluded.download_bytes,
      upload_bytes=client_usage_daily.upload_bytes+excluded.upload_bytes,
      sample_count=client_usage_daily.sample_count+1
  `);
  const saveOnt = database.prepare(`
    INSERT INTO client_monitor_state
      (customer_id, ont_sn, rx_power_dbm, connected_count, ont_last_inform, ont_synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET
      ont_sn=COALESCE(excluded.ont_sn, client_monitor_state.ont_sn),
      rx_power_dbm=COALESCE(excluded.rx_power_dbm, client_monitor_state.rx_power_dbm),
      connected_count=COALESCE(excluded.connected_count, client_monitor_state.connected_count),
      ont_last_inform=COALESCE(excluded.ont_last_inform, client_monitor_state.ont_last_inform),
      ont_synced_at=excluded.ont_synced_at
  `);
  const markDisconnected = database.prepare(`
    UPDATE client_monitor_state SET session_active=0, download_bps=NULL, upload_bps=NULL
    WHERE router_id=? AND last_observed_ms<? AND session_active=1
  `);

  function recordSample(customer, row, routerId, observedAt = clock()) {
    const down = counter(row, ['bytes-out', 'bytesOut', 'bytes_out', 'tx-byte', 'txByte']);
    const up = counter(row, ['bytes-in', 'bytesIn', 'bytes_in', 'rx-byte', 'rxByte']);
    const key = String(row['.id'] || row.id || row['session-id'] || `${row.name || row.user}:${row['caller-id'] || row.address || ''}`);
    const nowMs = observedAt.getTime();
    const day = localDay(observedAt, timezone());
    return database.transaction(() => {
      const previous = getState.get(customer.id);
      let downDelta = 0;
      let upDelta = 0;
      let downBps = null;
      let upBps = null;
      const elapsed = nowMs - Number(previous?.last_observed_ms || 0);
      if (previous && previous.session_active === 1 && previous.router_id === routerId &&
          previous.pppoe_username === customer.pppoe_username && previous.session_key === key &&
          down !== null && up !== null &&
          previous.last_down_counter !== null && previous.last_up_counter !== null &&
          down >= previous.last_down_counter && up >= previous.last_up_counter && elapsed >= 1000) {
        downDelta = down - previous.last_down_counter;
        upDelta = up - previous.last_up_counter;
        downBps = downDelta * 8 * 1000 / elapsed;
        upBps = upDelta * 8 * 1000 / elapsed;
        if (downBps > 10_000_000_000 || upBps > 10_000_000_000) {
          downDelta = 0;
          upDelta = 0;
          downBps = null;
          upBps = null;
        } else {
          addDaily.run(customer.id, day, downDelta, upDelta);
        }
      }
      saveSample.run(customer.id, routerId, customer.pppoe_username, key, down, up,
        nowMs, observedAt.toISOString(), downBps, upBps);
      return { downDelta, upDelta, warmup: downBps === null };
    })();
  }

  function customerIndex(customers) {
    const exact = new Map();
    const unassigned = new Map();
    for (const customer of customers) {
      const username = String(customer.pppoe_username || '').trim().toLowerCase();
      if (!username) continue;
      if (customer.router_id) {
        const key = `${customer.router_id}:${username}`;
        if (!exact.has(key)) exact.set(key, customer);
        else exact.set(key, null);
      }
      else if (!unassigned.has(username)) unassigned.set(username, customer);
      else unassigned.set(username, null);
    }
    return { exact, unassigned };
  }

  function allCustomers() {
    return database.prepare("SELECT id, name, pppoe_username, router_id, genieacs_tag FROM customers WHERE TRIM(COALESCE(pppoe_username, '')) != ''").all();
  }

  async function collectTraffic(customers = allCustomers()) {
    const index = customerIndex(customers);
    const routers = mikrotik.getAllRouters().filter((router) => router.is_active === 1 || router.is_active === '1' || router.is_active === true);
    let recorded = 0;
    let failedRouters = 0;
    for (const router of routers) {
      try {
        const sessions = await mikrotik.getPppoeActive(router.id, { fresh: true });
        const observedAt = clock();
        for (const row of sessions) {
          const username = String(row.name || row.user || '').trim().toLowerCase();
          const key = `${router.id}:${username}`;
          const customer = index.exact.has(key) ? index.exact.get(key) : index.unassigned.get(username);
          if (!customer) continue;
          recordSample(customer, row, router.id, observedAt);
          recorded++;
        }
        markDisconnected.run(router.id, observedAt.getTime());
      } catch (error) {
        failedRouters++;
        log.warn(`[Client Monitor] Router ${router.id} tidak dapat dibaca: ${error.message}`);
      }
    }
    return { recorded, failedRouters };
  }

  async function collectOnt(customers = allCustomers()) {
    const result = await devices.listAllDevices(5000);
    if (!result.ok) throw new Error(result.message || 'ACS tidak tersedia');
    const byUser = new Map();
    const byTag = new Map();
    for (const customer of customers) {
      const user = String(customer.pppoe_username || '').trim().toLowerCase();
      const tag = String(customer.genieacs_tag || '').trim().toLowerCase();
      if (user) byUser.set(user, byUser.has(user) ? null : customer);
      if (tag) byTag.set(tag, byTag.has(tag) ? null : customer);
    }
    let matched = 0;
    const now = clock();
    for (const device of result.devices) {
      const user = String(devices.extractPppoeUser(device) || '').trim().toLowerCase();
      let customer = byUser.get(user);
      if (!customer) {
        const tags = Array.isArray(device._tags) ? device._tags : [];
        customer = tags.map((tag) => byTag.get(String(tag).toLowerCase())).find(Boolean);
      }
      if (!customer) continue;
      try {
        const mapped = devices.mapDeviceData(device, customer.genieacs_tag || customer.pppoe_username, false);
        const serial = String(mapped?.serialNumber || '').trim();
        const power = Number(mapped?.rxPower);
        const inform = device._lastInform ? new Date(device._lastInform) : null;
        const freshInform = inform && Number.isFinite(inform.getTime()) && now.getTime() - inform.getTime() < 20 * 60 * 1000;
        const count = Number(mapped?.totalAssociations);
        saveOnt.run(customer.id,
          serial && serial !== '-' && serial !== 'N/A' ? serial : null,
          Number.isFinite(power) && power < 0 && power > -60 ? power : null,
          freshInform && Number.isSafeInteger(count) && count >= 0 ? count : null,
          inform && Number.isFinite(inform.getTime()) ? inform.toISOString() : null,
          now.toISOString());
        matched++;
      } catch (error) {
        log.warn(`[Client Monitor] ONT pelanggan ${customer.id} tidak terbaca: ${error.message}`);
      }
    }
    return matched;
  }

  let running = null;
  let lastTrafficRun = 0;
  let lastOntRun = 0;
  function collectNow({ force = false } = {}) {
    if (running) return running;
    const now = clock().getTime();
    if (now - lastTrafficRun < (force ? 60_000 : POLL_MS - 10_000)) return Promise.resolve({ skipped: true });
    running = (async () => {
      const customers = allCustomers();
      const traffic = await collectTraffic(customers);
      lastTrafficRun = clock().getTime();
      let ontMatched = null;
      if (force || now - lastOntRun >= 15 * 60 * 1000) {
        try {
          ontMatched = await collectOnt(customers);
          lastOntRun = clock().getTime();
        } catch (error) {
          log.warn(`[Client Monitor] Data ACS belum tersedia: ${error.message}`);
        }
      }
      return { ...traffic, ontMatched };
    })().finally(() => { running = null; });
    return running;
  }

  function start() {
    const first = setTimeout(() => collectNow().catch((error) => log.error(`[Client Monitor] ${error.message}`)), 15_000);
    first.unref();
    const timer = setInterval(() => collectNow().catch((error) => log.error(`[Client Monitor] ${error.message}`)), POLL_MS);
    timer.unref();
    return () => { clearTimeout(first); clearInterval(timer); };
  }

  function getList({ search = '', page = 1, limit = 30 } = {}) {
    const query = String(search).trim().slice(0, 100);
    const pattern = `%${query}%`;
    const requestedPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const today = localDay(clock(), timezone());
    const startDay = shiftDay(today, -29);
    const where = "TRIM(COALESCE(c.pppoe_username, '')) != '' AND (? = '' OR c.name LIKE ? OR c.pppoe_username LIKE ?)";
    const total = database.prepare(`SELECT COUNT(*) AS n FROM customers c WHERE ${where}`).get(query, pattern, pattern).n;
    const pages = Math.max(1, Math.ceil(total / limit));
    const pageNumber = Math.min(requestedPage, pages);
    const rows = database.prepare(`
      SELECT c.id, c.name, c.pppoe_username, c.router_id, c.status, c.lat, c.lng,
        s.last_seen_at, s.last_observed_ms, s.session_active, s.download_bps, s.upload_bps,
        s.ont_sn, s.rx_power_dbm, s.connected_count, s.ont_last_inform, s.ont_synced_at,
        COALESCE(u.download_bytes, 0) AS download_30d,
        COALESCE(u.upload_bytes, 0) AS upload_30d
      FROM customers c
      LEFT JOIN client_monitor_state s ON s.customer_id=c.id
      LEFT JOIN (
        SELECT customer_id, SUM(download_bytes) AS download_bytes, SUM(upload_bytes) AS upload_bytes
        FROM client_usage_daily WHERE usage_date>=? GROUP BY customer_id
      ) u ON u.customer_id=c.id
      WHERE ${where}
      ORDER BY c.name COLLATE NOCASE, c.id
      LIMIT ? OFFSET ?
    `).all(startDay, query, pattern, pattern, limit, (pageNumber - 1) * limit);
    const onlineAfter = clock().getTime() - ONLINE_MS;
    return {
      rows: rows.map((row) => ({ ...row, online: row.session_active === 1 && Number(row.last_observed_ms || 0) >= onlineAfter,
        coordinates: validCoordinates(row.lat, row.lng) })),
      total, page: pageNumber, pages, search: query
    };
  }

  function getOverview() {
    const today = localDay(clock(), timezone());
    const startDay = shiftDay(today, -29);
    const onlineAfter = clock().getTime() - ONLINE_MS;
    const counts = database.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN s.session_active=1 AND s.last_observed_ms>=? THEN 1 ELSE 0 END) AS online,
        SUM(CASE WHEN s.ont_sn IS NOT NULL THEN 1 ELSE 0 END) AS with_ont
      FROM customers c LEFT JOIN client_monitor_state s ON s.customer_id=c.id
      WHERE TRIM(COALESCE(c.pppoe_username, '')) != ''
    `).get(onlineAfter);
    const usage = database.prepare(`
      SELECT COALESCE(SUM(u.download_bytes),0) AS download, COALESCE(SUM(u.upload_bytes),0) AS upload
      FROM client_usage_daily u JOIN customers c ON c.id=u.customer_id
      WHERE u.usage_date>=? AND TRIM(COALESCE(c.pppoe_username, '')) != ''
    `).get(startDay);
    return { total: counts.total || 0, online: counts.online || 0, withOnt: counts.with_ont || 0,
      download30d: usage.download, upload30d: usage.upload };
  }

  function getDetail(customerId, days = 7) {
    const period = PERIODS.includes(Number(days)) ? Number(days) : 7;
    const customer = database.prepare(`
      SELECT c.*, p.name AS package_name, p.speed_down, p.speed_up, p.use_fup, p.fup_limit_gb,
        s.session_key, s.last_seen_at, s.last_observed_ms, s.session_active, s.download_bps, s.upload_bps,
        s.ont_sn, s.rx_power_dbm, s.connected_count, s.ont_last_inform, s.ont_synced_at
      FROM customers c LEFT JOIN packages p ON p.id=c.package_id
      LEFT JOIN client_monitor_state s ON s.customer_id=c.id
      WHERE c.id=? AND TRIM(COALESCE(c.pppoe_username, '')) != ''
    `).get(customerId);
    if (!customer) return null;
    const today = localDay(clock(), timezone());
    const start = shiftDay(today, -(period - 1));
    const previousStart = shiftDay(start, -period);
    const usage = database.prepare(`
      SELECT usage_date, download_bytes, upload_bytes, sample_count FROM client_usage_daily
      WHERE customer_id=? AND usage_date>=? AND usage_date<=? ORDER BY usage_date
    `).all(customerId, previousStart, today);
    const byDay = new Map(usage.map((row) => [row.usage_date, row]));
    const current = { download: 0, upload: 0, daysObserved: 0, sampleCount: 0 };
    const previous = { download: 0, upload: 0, daysObserved: 0, sampleCount: 0 };
    for (const row of usage) {
      const target = row.usage_date >= start ? current : previous;
      target.download += row.download_bytes;
      target.upload += row.upload_bytes;
      target.daysObserved++;
      target.sampleCount += row.sample_count;
    }
    const daily = Array.from({ length: period }, (_, index) => {
      const day = shiftDay(start, index);
      const row = byDay.get(day);
      return { day, download: row?.download_bytes || 0, upload: row?.upload_bytes || 0, observed: Boolean(row) };
    });
    let assessment = { tone: 'neutral', label: 'Data pembanding belum cukup' };
    const enoughDays = period === 1 ? 1 : Math.ceil(period / 2);
    if (current.daysObserved >= enoughDays && previous.daysObserved >= enoughDays &&
        current.sampleCount >= enoughDays * 12 && previous.sampleCount >= enoughDays * 12) {
      const currentDaily = (current.download + current.upload) / current.daysObserved;
      const previousDaily = (previous.download + previous.upload) / previous.daysObserved;
      if (previousDaily > 0 && currentDaily >= previousDaily * 2 && currentDaily - previousDaily >= 1024 ** 3) {
        assessment = { tone: 'warning', label: 'Lebih tinggi dari kebiasaan' };
      } else {
        assessment = { tone: 'normal', label: 'Tidak ada lonjakan pemakaian' };
      }
    }
    return { customer: { ...customer, online: customer.session_active === 1 && Number(customer.last_observed_ms || 0) >= clock().getTime() - ONLINE_MS,
      coordinates: validCoordinates(customer.lat, customer.lng) }, period, current, previous, daily, assessment };
  }

  return { recordSample, collectTraffic, collectOnt, collectNow, start, getList, getOverview, getDetail };
}

module.exports = { createClientMonitoringService, POLL_MS, PERIODS };
