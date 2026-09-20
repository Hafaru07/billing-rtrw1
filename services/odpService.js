const db = require('../config/database');

/**
 * ODP SERVICE
 * Mengelola data Optical Distribution Point (ODP)
 */

/**
 * Menerjemahkan pilihan induk dari form.
 * parent_ref berformat 'node:<id>' (ODC/OTB/tiang) atau 'odp:<id>' (ODP lain).
 * Bila form tidak mengirim parent_ref, nilai lama dipertahankan.
 */
function resolveParentRef(data, prev) {
  if (data.parent_ref !== undefined) {
    const raw = String(data.parent_ref || '').trim();
    if (!raw) return { node: null, odp: null };
    const parts = raw.split(':');
    const id = parseInt(parts[1], 10);
    if (!Number.isFinite(id) || id <= 0) return { node: null, odp: null };
    return parts[0] === 'odp' ? { node: null, odp: id } : { node: id, odp: null };
  }
  if (data.parent_node_id !== undefined) {
    return {
      node: data.parent_node_id ? parseInt(data.parent_node_id, 10) : null,
      odp: prev ? (prev.parent_odp_id || null) : null
    };
  }
  return prev ? { node: prev.parent_node_id || null, odp: prev.parent_odp_id || null } : { node: null, odp: null };
}

function getAllOdps() {
  return db.prepare(`
    SELECT o.*, olt.name as olt_name 
    FROM odps o 
    LEFT JOIN olts olt ON o.olt_id = olt.id 
    ORDER BY o.name ASC
  `).all();
}

function getOdpById(id) {
  return db.prepare('SELECT * FROM odps WHERE id = ?').get(id);
}

function createOdp(data) {
  const parentCreate = resolveParentRef(data, null);
  const stmt = db.prepare(`
    INSERT INTO odps (name, olt_id, pon_port, port_capacity, lat, lng, description, parent_node_id, parent_odp_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    data.name,
    data.olt_id ? parseInt(data.olt_id) : null,
    data.pon_port || '',
    data.port_capacity !== undefined && data.port_capacity !== null ? parseInt(data.port_capacity) : 16,
    data.lat || '',
    data.lng || '',
    data.description || '',
    parentCreate.node,
    parentCreate.odp
  );
}

function updateOdp(id, data) {
  const parentUpdate = resolveParentRef(data, getOdpById(id));
  const stmt = db.prepare(`
    UPDATE odps 
    SET name = ?, olt_id = ?, pon_port = ?, port_capacity = ?, lat = ?, lng = ?, description = ?, parent_node_id = ?, parent_odp_id = ?
    WHERE id = ?
  `);
  return stmt.run(
    data.name,
    data.olt_id ? parseInt(data.olt_id) : null,
    data.pon_port || '',
    data.port_capacity !== undefined && data.port_capacity !== null ? parseInt(data.port_capacity) : 16,
    data.lat || '',
    data.lng || '',
    data.description || '',
    parentUpdate.node,
    parentUpdate.odp,
    id
  );
}

function deleteOdp(id) {
  return db.prepare('DELETE FROM odps WHERE id = ?').run(id);
}

function getOdpPortUsage(odpId) {
  const odp = getOdpById(odpId);
  if (!odp) return null;
  const usedRaw = db.prepare("SELECT pon_port FROM customers WHERE odp_id = ? AND pon_port IS NOT NULL AND TRIM(pon_port) != ''").all(odpId);
  const usedPorts = Array.from(new Set(usedRaw.map(r => String(r.pon_port).trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id-ID', { numeric: true }));
  const capacity = Number(odp.port_capacity || 16) || 16;
  const usedCount = usedPorts.length;
  const remaining = Math.max(0, capacity - usedCount);
  return { odpId: Number(odpId), capacity, usedCount, remaining, usedPorts };
}

module.exports = {
  getAllOdps,
  getOdpById,
  createOdp,
  updateOdp,
  deleteOdp,
  getOdpPortUsage
};
