// Tenant-to-Landlord Communication and Maintenance Request System - API server
const express = require('express');
const compression = require('compression');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';
const CATEGORIES = ['Plumbing', 'Electrical', 'Structural', 'Appliance', 'Security', 'Other'];
const SEVERITIES = ['Low', 'Medium', 'High', 'Urgent'];
const STATUSES = ['Received', 'In Progress', 'Resolved', 'Closed'];
const ROLES = ['Tenant', 'Landlord', 'Maintenance Staff'];
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(compression());
app.use(express.json({ limit: '8mb' }));

// ---------- helpers ----------
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const clean = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').trim();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });
async function notify(userId, message) {
  await db.query('INSERT INTO Notifications (user_id, message, is_read, timestamp) VALUES (?,?,FALSE,?)', [userId, String(message).slice(0, 255), now()]);
}
function auth(...roles) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return bad(res, 'Authentication required', 401);
    try { req.user = jwt.verify(h.slice(7), JWT_SECRET); }
    catch (e) { return bad(res, e.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid token', 401); }
    if (roles.length && !roles.includes(req.user.role)) return bad(res, 'Access denied for your role', 403);
    next();
  };
}
// ---------- validation (Table 3.2) ----------
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
const validPassword = p => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const validPhone = p => /^\d{11}$/.test(p || '');

// ---------- authentication ----------
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || String(name).trim().length < 2) return bad(res, 'Name is required');
  if (!validEmail(email)) return bad(res, 'Enter a valid email address');
  if (!validPhone(phone)) return bad(res, 'Phone number must be 11 digits (e.g. 08012345678)');
  if (!validPassword(password)) return bad(res, 'Password must be at least 8 characters with a letter and a number');
  if (!ROLES.includes(role)) return bad(res, 'Choose a valid role');
  const [ex] = await db.query('SELECT user_id FROM Users WHERE email=?', [email.toLowerCase()]);
  if (ex.length) return bad(res, 'An account with this email already exists', 409);
  const hash = await bcrypt.hash(password, 10);
  const [r] = await db.query('INSERT INTO Users (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)', [clean(name), email.toLowerCase(), phone, hash, role]);
  res.status(201).json({ user_id: r.insertId, role });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await db.query('SELECT * FROM Users WHERE email=?', [String(email || '').toLowerCase()]);
  const u = rows[0];
  if (!u) return bad(res, 'Invalid email or password', 401);
  if (u.locked_until && new Date(u.locked_until.replace(' ', 'T') + 'Z') > new Date())
    return bad(res, 'Account temporarily locked after repeated failed attempts. Try again in 15 minutes.', 423);
  const ok = await bcrypt.compare(String(password || ''), u.password_hash);
  if (!ok) {
    const attempts = u.failed_attempts + 1;
    if (attempts >= 3) {
      const until = new Date(Date.now() + 15 * 60000).toISOString().slice(0, 19).replace('T', ' ');
      await db.query('UPDATE Users SET failed_attempts=0, locked_until=? WHERE user_id=?', [until, u.user_id]);
      return bad(res, 'Account temporarily locked after repeated failed attempts. Try again in 15 minutes.', 423);
    }
    await db.query('UPDATE Users SET failed_attempts=? WHERE user_id=?', [attempts, u.user_id]);
    return bad(res, `Invalid email or password (${3 - attempts} attempt(s) left)`, 401);
  }
  await db.query('UPDATE Users SET failed_attempts=0, locked_until=NULL WHERE user_id=?', [u.user_id]);
  const token = jwt.sign({ id: u.user_id, role: u.role, name: u.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ token, user: { id: u.user_id, name: u.name, email: u.email, role: u.role } });
}));

app.post('/api/auth/forgot-password', wrap(async (req, res) => {
  const [rows] = await db.query('SELECT user_id FROM Users WHERE email=?', [String(req.body.email || '').toLowerCase()]);
  const out = { message: 'If the account exists, a reset code has been sent.' };
  if (rows.length) {
    const token = crypto.randomBytes(16).toString('hex');
    const exp = new Date(Date.now() + 30 * 60000).toISOString().slice(0, 19).replace('T', ' ');
    await db.query('UPDATE Users SET reset_token=?, reset_expires=? WHERE user_id=?', [token, exp, rows[0].user_id]);
    // In production the token is emailed/SMSed. It is returned only when running in test mode.
    if (process.env.NODE_ENV === 'test') out.token = token;
  }
  res.json(out);
}));

app.post('/api/auth/reset-password', wrap(async (req, res) => {
  const { token, password } = req.body;
  if (!validPassword(password)) return bad(res, 'Password must be at least 8 characters with a letter and a number');
  const [rows] = await db.query('SELECT user_id, reset_expires FROM Users WHERE reset_token=?', [String(token || '')]);
  if (!rows.length || new Date(rows[0].reset_expires.replace(' ', 'T') + 'Z') < new Date()) return bad(res, 'Reset code is invalid or has expired');
  await db.query('UPDATE Users SET password_hash=?, reset_token=NULL, reset_expires=NULL, failed_attempts=0, locked_until=NULL WHERE user_id=?', [await bcrypt.hash(password, 10), rows[0].user_id]);
  res.json({ message: 'Password updated' });
}));

app.get('/api/me', auth(), wrap(async (req, res) => {
  const [r] = await db.query('SELECT user_id AS id, name, email, phone, role FROM Users WHERE user_id=?', [req.user.id]);
  res.json(r[0]);
}));

// ---------- properties & tenancies ----------
app.get('/api/properties', auth(), wrap(async (req, res) => {
  let sql, p = [req.user.id];
  if (req.user.role === 'Landlord') sql = 'SELECT * FROM Properties WHERE landlord_id=?';
  else if (req.user.role === 'Tenant') sql = `SELECT p.* FROM Properties p JOIN Tenancies t ON t.property_id=p.property_id WHERE t.tenant_id=? AND t.status='Active'`;
  else sql = `SELECT DISTINCT p.* FROM Properties p JOIN Tenancies t ON t.property_id=p.property_id JOIN MaintenanceRequests m ON m.tenancy_id=t.tenancy_id WHERE m.assigned_to=?`;
  const [r] = await db.query(sql, p);
  if (req.user.role === 'Landlord') {
    for (const pr of r) {
      const [t] = await db.query(`SELECT u.user_id, u.name, u.email, t.tenancy_id, t.status FROM Tenancies t JOIN Users u ON u.user_id=t.tenant_id WHERE t.property_id=?`, [pr.property_id]);
      pr.tenants = t;
    }
  }
  res.json(r);
}));
app.post('/api/properties', auth('Landlord'), wrap(async (req, res) => {
  const { address, unit_details } = req.body;
  if (!address || String(address).trim().length < 5) return bad(res, 'Address is required');
  const [r] = await db.query('INSERT INTO Properties (landlord_id,address,unit_details) VALUES (?,?,?)', [req.user.id, clean(address), unit_details ? clean(unit_details) : null]);
  res.status(201).json({ property_id: r.insertId });
}));
app.post('/api/properties/:id/tenants', auth('Landlord'), wrap(async (req, res) => {
  const [pr] = await db.query('SELECT * FROM Properties WHERE property_id=? AND landlord_id=?', [req.params.id, req.user.id]);
  if (!pr.length) return bad(res, 'Property not found', 404);
  const [u] = await db.query(`SELECT user_id FROM Users WHERE email=? AND role='Tenant'`, [String(req.body.email || '').toLowerCase()]);
  if (!u.length) return bad(res, 'No tenant account with that email', 404);
  const [r] = await db.query(`INSERT INTO Tenancies (tenant_id,property_id,start_date,status) VALUES (?,?,?, 'Active')`, [u[0].user_id, pr[0].property_id, req.body.start_date || now().slice(0, 10)]);
  await notify(u[0].user_id, `You have been added to ${pr[0].address}. You can now submit maintenance requests.`);
  res.status(201).json({ tenancy_id: r.insertId });
}));
app.get('/api/staff', auth('Landlord'), wrap(async (req, res) => {
  const [r] = await db.query(`SELECT user_id, name, phone FROM Users WHERE role='Maintenance Staff' ORDER BY name`);
  res.json(r);
}));

// ---------- maintenance requests ----------
const REQ_SELECT = `SELECT m.request_id, m.category, m.description, m.severity, m.status, m.date_submitted, m.date_resolved, m.assigned_to, m.photo_path,
  p.address, p.unit_details, p.landlord_id, t.tenant_id, tu.name AS tenant_name, su.name AS staff_name, lu.name AS landlord_name
  FROM MaintenanceRequests m JOIN Tenancies t ON t.tenancy_id=m.tenancy_id JOIN Properties p ON p.property_id=t.property_id
  JOIN Users tu ON tu.user_id=t.tenant_id JOIN Users lu ON lu.user_id=p.landlord_id LEFT JOIN Users su ON su.user_id=m.assigned_to`;
function scope(user) {
  if (user.role === 'Tenant') return ['t.tenant_id=?', [user.id]];
  if (user.role === 'Landlord') return ['p.landlord_id=?', [user.id]];
  return ['m.assigned_to=?', [user.id]];
}
async function getRequest(user, id) {
  const [w, p] = scope(user);
  const [r] = await db.query(`${REQ_SELECT} WHERE m.request_id=? AND ${w}`, [id, ...p]);
  return r[0];
}

app.post('/api/requests', auth('Tenant'), wrap(async (req, res) => {
  const { category, description, photo } = req.body;
  let severity = req.body.severity;
  if (!CATEGORIES.includes(category)) return bad(res, 'Select a category from the list');
  if (!severity) severity = 'Medium';
  if (!SEVERITIES.includes(severity)) return bad(res, 'Severity must be Low, Medium, High or Urgent');
  const d = String(description || '').trim();
  if (d.length < 10 || d.length > 500) return bad(res, 'Description must be 10 to 500 characters');
  let photoPath = null;
  if (photo) {
    const m = /^data:(image\/(jpeg|png));base64,(.+)$/.exec(photo);
    if (!m) return bad(res, 'Photo must be a JPEG or PNG image');
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 5 * 1024 * 1024) return bad(res, 'Photo must not exceed 5MB');
    photoPath = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${m[2] === 'png' ? 'png' : 'jpg'}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, photoPath), buf);
  }
  const [t] = await db.query(`SELECT t.tenancy_id, p.address, p.landlord_id FROM Tenancies t JOIN Properties p ON p.property_id=t.property_id WHERE t.tenant_id=? AND t.status='Active' ORDER BY t.tenancy_id DESC LIMIT 1`, [req.user.id]);
  if (!t.length) return bad(res, 'You are not linked to a property yet. Ask your landlord to add you.', 409);
  const [r] = await db.query(`INSERT INTO MaintenanceRequests (tenancy_id,category,description,severity,status,date_submitted,photo_path) VALUES (?,?,?,?, 'Received', ?, ?)`, [t[0].tenancy_id, category, clean(d), severity, now(), photoPath]);
  await notify(t[0].landlord_id, `New ${severity} ${category} request #${r.insertId} at ${t[0].address}`);
  res.status(201).json({ request_id: r.insertId, status: 'Received' });
}));

app.get('/api/requests', auth(), wrap(async (req, res) => {
  const [w, p] = scope(req.user);
  const extra = []; const ep = [];
  if (req.query.status && STATUSES.includes(req.query.status)) { extra.push('m.status=?'); ep.push(req.query.status); }
  if (req.query.q) { extra.push('(m.description LIKE ? OR m.category LIKE ? OR p.address LIKE ?)'); const q = `%${req.query.q}%`; ep.push(q, q, q); }
  const [r] = await db.query(`${REQ_SELECT} WHERE ${w} ${extra.length ? 'AND ' + extra.join(' AND ') : ''} ORDER BY m.date_submitted DESC, m.request_id DESC`, [...p, ...ep]);
  res.json(r);
}));
app.get('/api/requests/:id', auth(), wrap(async (req, res) => {
  const r = await getRequest(req.user, req.params.id);
  if (!r) return bad(res, 'Request not found', 404);
  res.json(r);
}));
app.get('/api/uploads/:file', auth(), wrap(async (req, res) => {
  const f = path.basename(req.params.file);
  const [w, p] = scope(req.user);
  const [r] = await db.query(`${REQ_SELECT} WHERE m.photo_path=? AND ${w}`, [f, ...p]);
  if (!r.length) return bad(res, 'Not found', 404);
  res.sendFile(path.join(UPLOAD_DIR, f));
}));

app.patch('/api/requests/:id/assign', auth('Landlord'), wrap(async (req, res) => {
  const r = await getRequest(req.user, req.params.id);
  if (!r) return bad(res, 'Request not found', 404);
  const [s] = await db.query(`SELECT user_id, name FROM Users WHERE user_id=? AND role='Maintenance Staff'`, [req.body.staff_id]);
  if (!s.length) return bad(res, 'Select a valid maintenance staff member');
  await db.query(`UPDATE MaintenanceRequests SET assigned_to=?, status=IF(status='Received','In Progress',status) WHERE request_id=?`, [s[0].user_id, r.request_id]);
  await notify(r.tenant_id, `Your request #${r.request_id} has been assigned to ${s[0].name}.`);
  await notify(s[0].user_id, `You have been assigned request #${r.request_id} (${r.category}) at ${r.address}.`);
  res.json({ ok: true });
}));

app.patch('/api/requests/:id/status', auth('Landlord', 'Maintenance Staff'), wrap(async (req, res) => {
  const r = await getRequest(req.user, req.params.id);
  if (!r) return bad(res, 'Request not found', 404);
  const { status, note } = req.body;
  if (!STATUSES.includes(status)) return bad(res, 'Invalid status');
  if (req.user.role === 'Maintenance Staff' && status === 'Closed') return bad(res, 'Only the landlord can close a request', 403);
  await db.query('UPDATE MaintenanceRequests SET status=?, date_resolved=? WHERE request_id=?', [status, status === 'Resolved' || status === 'Closed' ? (r.date_resolved || now()) : null, r.request_id]);
  await notify(r.tenant_id, `Request #${r.request_id} is now "${status}".`);
  if (req.user.role === 'Maintenance Staff') await notify(r.landlord_id, `Request #${r.request_id} was marked "${status}" by ${r.staff_name}.`);
  if (note && String(note).trim()) {
    await db.query('INSERT INTO Messages (request_id,sender_id,receiver_id,content,timestamp) VALUES (?,?,?,?,?)', [r.request_id, req.user.id, r.tenant_id, clean(String(note).slice(0, 1000)), now()]);
  }
  res.json({ ok: true, status });
}));

// ---------- messaging ----------
async function participants(requestId) {
  const [r] = await db.query(`SELECT t.tenant_id, p.landlord_id, m.assigned_to FROM MaintenanceRequests m JOIN Tenancies t ON t.tenancy_id=m.tenancy_id JOIN Properties p ON p.property_id=t.property_id WHERE m.request_id=?`, [requestId]);
  return r[0] ? [r[0].tenant_id, r[0].landlord_id, r[0].assigned_to].filter(Boolean) : null;
}
app.get('/api/contacts', auth('Tenant', 'Landlord'), wrap(async (req, res) => {
  const sql = req.user.role === 'Tenant'
    ? `SELECT DISTINCT u.user_id, u.name, 'Landlord' AS role FROM Tenancies t JOIN Properties p ON p.property_id=t.property_id JOIN Users u ON u.user_id=p.landlord_id WHERE t.tenant_id=? AND t.status='Active'`
    : `SELECT DISTINCT u.user_id, u.name, 'Tenant' AS role FROM Properties p JOIN Tenancies t ON t.property_id=p.property_id JOIN Users u ON u.user_id=t.tenant_id WHERE p.landlord_id=? AND t.status='Active'`;
  const [r] = await db.query(sql, [req.user.id]);
  res.json(r);
}));
app.get('/api/messages', auth(), wrap(async (req, res) => {
  if (req.query.request_id) {
    const parts = await participants(req.query.request_id);
    if (!parts || !parts.includes(req.user.id)) return bad(res, 'Not allowed', 403);
    const [r] = await db.query(`SELECT m.*, u.name AS sender_name FROM Messages m JOIN Users u ON u.user_id=m.sender_id WHERE m.request_id=? ORDER BY m.timestamp, m.message_id`, [req.query.request_id]);
    return res.json(r);
  }
  const other = Number(req.query.with);
  if (!other) return bad(res, 'Specify request_id or with');
  const [r] = await db.query(`SELECT m.*, u.name AS sender_name FROM Messages m JOIN Users u ON u.user_id=m.sender_id WHERE m.request_id IS NULL AND ((m.sender_id=? AND m.receiver_id=?) OR (m.sender_id=? AND m.receiver_id=?)) ORDER BY m.timestamp, m.message_id`, [req.user.id, other, other, req.user.id]);
  res.json(r);
}));
app.post('/api/messages', auth(), wrap(async (req, res) => {
  const { receiver_id, request_id } = req.body;
  const content = String(req.body.content || '').trim();
  if (content.length < 1 || content.length > 1000) return bad(res, 'Message must be 1 to 1000 characters');
  let allowed = false;
  if (request_id) {
    const parts = await participants(request_id);
    allowed = !!parts && parts.includes(req.user.id) && parts.includes(Number(receiver_id)) && Number(receiver_id) !== req.user.id;
  } else if (req.user.role !== 'Maintenance Staff') {
    const [c] = await db.query(req.user.role === 'Tenant'
      ? `SELECT 1 FROM Tenancies t JOIN Properties p ON p.property_id=t.property_id WHERE t.tenant_id=? AND p.landlord_id=?`
      : `SELECT 1 FROM Tenancies t JOIN Properties p ON p.property_id=t.property_id WHERE p.landlord_id=? AND t.tenant_id=?`, [req.user.id, receiver_id]);
    allowed = c.length > 0;
  }
  if (!allowed) return bad(res, 'You cannot message this user', 403);
  const [r] = await db.query('INSERT INTO Messages (request_id,sender_id,receiver_id,content,timestamp) VALUES (?,?,?,?,?)', [request_id || null, req.user.id, receiver_id, clean(content), now()]);
  await notify(receiver_id, `New message from ${req.user.name}${request_id ? ` on request #${request_id}` : ''}.`);
  res.status(201).json({ message_id: r.insertId });
}));

// ---------- notifications ----------
app.get('/api/notifications', auth(), wrap(async (req, res) => {
  const [r] = await db.query('SELECT * FROM Notifications WHERE user_id=? ORDER BY timestamp DESC, notification_id DESC LIMIT 50', [req.user.id]);
  res.json(r);
}));
app.patch('/api/notifications/:id/read', auth(), wrap(async (req, res) => {
  await db.query('UPDATE Notifications SET is_read=TRUE WHERE notification_id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
}));
app.patch('/api/notifications/read-all', auth(), wrap(async (req, res) => {
  await db.query('UPDATE Notifications SET is_read=TRUE WHERE user_id=?', [req.user.id]);
  res.json({ ok: true });
}));

// ---------- reports ----------
app.get('/api/reports/summary', auth('Landlord'), wrap(async (req, res) => {
  const base = `FROM MaintenanceRequests m JOIN Tenancies t ON t.tenancy_id=m.tenancy_id JOIN Properties p ON p.property_id=t.property_id WHERE p.landlord_id=?`;
  const [byCat] = await db.query(`SELECT m.category, COUNT(*) AS n ${base} GROUP BY m.category ORDER BY n DESC`, [req.user.id]);
  const [byStatus] = await db.query(`SELECT m.status, COUNT(*) AS n ${base} GROUP BY m.status`, [req.user.id]);
  const [[avg]] = await db.query(`SELECT AVG(TIMESTAMPDIFF(MINUTE, m.date_submitted, m.date_resolved))/60 AS avg_hours, COUNT(m.date_resolved) AS resolved ${base}`, [req.user.id]);
  const [recurring] = await db.query(`SELECT p.address, m.category, COUNT(*) AS n ${base} GROUP BY p.address, m.category HAVING n>=2 ORDER BY n DESC`, [req.user.id]);
  const total = byStatus.reduce((a, b) => a + b.n, 0);
  const pending = byStatus.filter(s => s.status === 'Received' || s.status === 'In Progress').reduce((a, b) => a + b.n, 0);
  res.json({ total, pending, completed: total - pending, avg_resolution_hours: avg.avg_hours === null ? null : Number(Number(avg.avg_hours).toFixed(2)), by_category: byCat, by_status: byStatus, recurring });
}));

// ---------- static client ----------
const DIST = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(DIST, { maxAge: '1d' }));
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
}
module.exports = app;
