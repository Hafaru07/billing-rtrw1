const db = require('../config/database');

/**
 * NETWORK MAP SERVICE
 * Mengelola objek infrastruktur di peta jaringan (Server, ODC/OTB, Tiang)
 * dan jalur kabel yang digambar manual.
 *
 * Catatan: service ini murni database. Tidak ada pemanggilan MikroTik/GenieACS,
 * supaya menambah atau menghapus objek peta tidak pernah mengubah koneksi pelanggan.
 */

const NODE_TYPES = ['server', 'odc', 'otb', 'pole'];
const LINE_TYPES = ['server', 'odc', 'pole', 'custom'];

// Warna garis per tipe (dipakai juga oleh frontend lewat data peta)
const LINE_COLORS = {
  server: '#a855f7',          // ungu   : server -> ODC
  odc: '#3b82f6',             // biru   : ODC -> ODP
  pole: '#22d3ee',            // cyan   : antar tiang
  custom: '#f59e0b',          // oranye : jalur bebas
  client_good: '#22c55e',     // hijau  : redaman -22 dBm ke atas (mis. -18)
  client_warn: '#eab308',     // kuning : redaman -23 s/d -30 dBm
  client_unknown: '#94a3b8',  // abu-abu: redaman belum diketahui
  client_down: '#ef4444'      // merah  : pelanggan isolir
};

// Ambang redaman sesuai permintaan: >= -22 hijau, <= -23 (sampai -30) kuning.
const RX_GOOD_MIN = -22;

function normalizeType(type, allowed, fallback) {
  const t = String(type || '').trim().toLowerCase();
  return allowed.includes(t) ? t : fallback;
}

function num(val) {
  // Number(null) dan Number('') menghasilkan 0, jadi nilai kosong harus
  // ditolak lebih dulu supaya redaman tak terbaca tidak dianggap 0 dBm.
  if (val === null || val === undefined || String(val).trim() === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function coordText(val) {
  const s = String(val == null ? '' : val).trim();
  if (!s) return '';
  return Number.isFinite(Number(s)) ? s : '';
}

/**
 * Menentukan warna garis pelanggan dari nilai redaman (dBm).
 * rx null/tidak valid -> abu-abu supaya tidak menyesatkan.
 */
function clientLineColor(rxPower, isActive = true) {
  if (!isActive) return LINE_COLORS.client_down;
  const rx = num(rxPower);
  if (rx === null) return LINE_COLORS.client_unknown;
  return rx >= RX_GOOD_MIN ? LINE_COLORS.client_good : LINE_COLORS.client_warn;
}

// ─── NODES (Server / ODC / OTB / Tiang) ──────────────────────────────────────

function getAllNodes(type = null) {
  if (type) {
    return db.prepare('SELECT * FROM network_nodes WHERE type = ? ORDER BY name ASC').all(
      normalizeType(type, NODE_TYPES, 'server')
    );
  }
  return db.prepare('SELECT * FROM network_nodes ORDER BY type ASC, name ASC').all();
}

function getNodeById(id) {
  return db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(id);
}

function createNode(data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Nama wajib diisi');

  return db.prepare(`
    INSERT INTO network_nodes (type, name, lat, lng, parent_kind, parent_id, capacity, description, is_active, cable_path, can_host_odp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalizeType(data.type, NODE_TYPES, 'server'),
    name,
    coordText(data.lat),
    coordText(data.lng),
    String(data.parent_kind || '').trim(),
    data.parent_id ? parseInt(data.parent_id, 10) : null,
    data.capacity ? parseInt(data.capacity, 10) : 0,
    String(data.description || '').trim(),
    data.is_active === undefined ? 1 : (Number(data.is_active) ? 1 : 0),
    data.cable_path ? String(data.cable_path) : null,
    Number(data.can_host_odp) ? 1 : 0
  );
}

function updateNode(id, data) {
  const prev = getNodeById(id);
  if (!prev) throw new Error('Objek tidak ditemukan');

  // Field yang tidak dikirim tetap memakai nilai lama, supaya update sebagian
  // (mis. hanya menggeser marker) tidak mengosongkan data lain.
  const pick = (val, fallback) => (val === undefined || val === null || String(val).trim() === '') ? fallback : val;

  // Toggle "tiang bisa dipasangi ODP". Mematikannya ditolak selama masih ada ODP
  // yang menempel, supaya relasi di peta tidak menggantung.
  const canHostOdp = data.can_host_odp === undefined
    ? (prev.can_host_odp ? 1 : 0)
    : (Number(data.can_host_odp) ? 1 : 0);

  if (prev.can_host_odp && !canHostOdp) {
    const dipakai = db.prepare('SELECT COUNT(*) c FROM odps WHERE parent_node_id = ?').get(prev.id).c;
    if (dipakai > 0) {
      throw new Error('Masih ada ' + dipakai + ' ODP yang menempel di tiang ini. Pindahkan dulu ODP-nya sebelum menonaktifkan.');
    }
  }

  return db.prepare(`
    UPDATE network_nodes
    SET type = ?, name = ?, lat = ?, lng = ?, parent_kind = ?, parent_id = ?, capacity = ?, description = ?, is_active = ?, cable_path = ?, can_host_odp = ?
    WHERE id = ?
  `).run(
    normalizeType(pick(data.type, prev.type), NODE_TYPES, prev.type),
    String(pick(data.name, prev.name)).trim(),
    coordText(pick(data.lat, prev.lat)),
    coordText(pick(data.lng, prev.lng)),
    data.parent_kind === undefined ? (prev.parent_kind || '') : String(data.parent_kind || '').trim(),
    data.parent_id === undefined ? prev.parent_id : (data.parent_id ? parseInt(data.parent_id, 10) : null),
    data.capacity === undefined ? (prev.capacity || 0) : (parseInt(data.capacity, 10) || 0),
    data.description === undefined ? (prev.description || '') : String(data.description || '').trim(),
    data.is_active === undefined ? (prev.is_active === null || prev.is_active === undefined ? 1 : prev.is_active) : (Number(data.is_active) ? 1 : 0),
    // Jalur dipertahankan bila payload tidak mengirimnya (mis. hanya menggeser marker)
    data.cable_path === undefined ? (prev.cable_path || null) : (data.cable_path ? String(data.cable_path) : null),
    canHostOdp,
    id
  );
}

/**
 * Menghapus objek peta. Hanya menyentuh database:
 * anak-anaknya dilepas (parent dikosongkan), bukan ikut dihapus.
 */
function deleteNode(id) {
  const nodeId = parseInt(id, 10);
  if (!nodeId) throw new Error('ID tidak valid');

  const tx = db.transaction(() => {
    db.prepare("UPDATE network_nodes SET parent_kind = '', parent_id = NULL WHERE parent_kind = 'node' AND parent_id = ?").run(nodeId);
    db.prepare('UPDATE odps SET parent_node_id = NULL WHERE parent_node_id = ?').run(nodeId);
    db.prepare('DELETE FROM network_lines WHERE from_node_id = ? OR to_node_id = ?').run(nodeId, nodeId);
    return db.prepare('DELETE FROM network_nodes WHERE id = ?').run(nodeId);
  });
  return tx();
}

// ─── LINES (jalur manual) ────────────────────────────────────────────────────

function parsePath(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch (e) { throw new Error('Format jalur tidak valid'); }
  }
  if (!Array.isArray(arr) || arr.length < 2) throw new Error('Jalur minimal berisi 2 titik');

  const clean = arr
    .map(p => {
      const lat = num(Array.isArray(p) ? p[0] : (p && p.lat));
      const lng = num(Array.isArray(p) ? p[1] : (p && p.lng));
      return (lat === null || lng === null) ? null : [lat, lng];
    })
    .filter(Boolean);

  if (clean.length < 2) throw new Error('Jalur minimal berisi 2 titik yang valid');
  return clean;
}

function rowToLine(row) {
  if (!row) return null;
  let path = [];
  try { path = JSON.parse(row.path || '[]'); } catch (e) { path = []; }
  return Object.assign({}, row, { path });
}

function getAllLines() {
  return db.prepare('SELECT * FROM network_lines ORDER BY id ASC').all().map(rowToLine);
}

function getLineById(id) {
  return rowToLine(db.prepare('SELECT * FROM network_lines WHERE id = ?').get(id));
}

function createLine(data) {
  const path = parsePath(data.path);
  return db.prepare(`
    INSERT INTO network_lines (name, type, path, color, from_node_id, to_node_id, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(data.name || '').trim(),
    normalizeType(data.type, LINE_TYPES, 'custom'),
    JSON.stringify(path),
    String(data.color || '').trim(),
    data.from_node_id ? parseInt(data.from_node_id, 10) : null,
    data.to_node_id ? parseInt(data.to_node_id, 10) : null,
    String(data.description || '').trim()
  );
}

function updateLine(id, data) {
  const prev = getLineById(id);
  if (!prev) throw new Error('Jalur tidak ditemukan');

  const path = data.path === undefined ? prev.path : parsePath(data.path);
  return db.prepare(`
    UPDATE network_lines
    SET name = ?, type = ?, path = ?, color = ?, from_node_id = ?, to_node_id = ?, description = ?
    WHERE id = ?
  `).run(
    data.name === undefined ? (prev.name || '') : String(data.name || '').trim(),
    normalizeType(data.type === undefined ? prev.type : data.type, LINE_TYPES, prev.type),
    JSON.stringify(path),
    data.color === undefined ? (prev.color || '') : String(data.color || '').trim(),
    data.from_node_id === undefined ? prev.from_node_id : (data.from_node_id ? parseInt(data.from_node_id, 10) : null),
    data.to_node_id === undefined ? prev.to_node_id : (data.to_node_id ? parseInt(data.to_node_id, 10) : null),
    data.description === undefined ? (prev.description || '') : String(data.description || '').trim(),
    id
  );
}

function deleteLine(id) {
  return db.prepare('DELETE FROM network_lines WHERE id = ?').run(id);
}

// ─── ODP: induk (ODC / tiang) untuk menarik garis otomatis ───────────────────

function setOdpCablePath(odpId, path) {
  return db.prepare('UPDATE odps SET cable_path = ? WHERE id = ?').run(
    path ? String(path) : null,
    parseInt(odpId, 10)
  );
}

function setOdpParent(odpId, nodeId) {
  return db.prepare('UPDATE odps SET parent_node_id = ? WHERE id = ?').run(
    nodeId ? parseInt(nodeId, 10) : null,
    parseInt(odpId, 10)
  );
}

module.exports = {
  NODE_TYPES,
  LINE_TYPES,
  LINE_COLORS,
  RX_GOOD_MIN,
  clientLineColor,
  getAllNodes,
  getNodeById,
  createNode,
  updateNode,
  deleteNode,
  getAllLines,
  getLineById,
  createLine,
  updateLine,
  deleteLine,
  setOdpParent,
  setOdpCablePath
};
