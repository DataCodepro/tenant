// Automated functional, integration, system and security tests.
// Run:  NODE_ENV=test node server/index.js &   then   node tests/api_tests.js
// Writes tests/results/api_results.json
const path = require('path'); const fs = require('fs');
const jwt = require('../server/node_modules/jsonwebtoken');
const db = require('../server/db');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const results = []; const RUN = Date.now().toString(36);
let seq = 0;
async function call(method, url, { token, body } = {}) {
  const r = await fetch(BASE + '/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) { }
  return { status: r.status, body: j };
}
async function test(id, group, module, input, expected, fn) {
  try { const actual = await fn(); results.push({ id, group, module, input, expected, actual, pass: true }); console.log('PASS', id, '-', actual); }
  catch (e) { results.push({ id, group, module, input, expected, actual: e.message, pass: false }); console.log('FAIL', id, '-', e.message); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
async function newUser(role, tag) {
  const n = ++seq; const email = `${tag || role.replace(' ', '').toLowerCase()}${n}.${RUN}@test.ng`;
  const phone = '080' + String(10000000 + n * 7 + Math.floor(Math.random() * 1000)).slice(0, 8);
  const reg = await call('POST', '/auth/register', { body: { name: `${role} ${n}`, email, phone, password: 'Passw0rdX', role } });
  ok(reg.status === 201, 'register failed: ' + JSON.stringify(reg.body));
  const l = await call('POST', '/auth/login', { body: { email, password: 'Passw0rdX' } });
  return { id: l.body.user.id, email, token: l.body.token, role };
}
async function setup() {
  const landlord = await newUser('Landlord'); const tenant = await newUser('Tenant'); const staff = await newUser('Maintenance Staff');
  const p = await call('POST', '/properties', { token: landlord.token, body: { address: '10 Test Close, Wuse II, Abuja', unit_details: 'Flat 1' } });
  await call('POST', `/properties/${p.body.property_id}/tenants`, { token: landlord.token, body: { email: tenant.email } });
  return { landlord, tenant, staff, propertyId: p.body.property_id };
}
const goodReq = { category: 'Plumbing', severity: 'High', description: 'Kitchen tap is leaking heavily onto the floor.' };

(async () => {
  const S = await setup();

  // ---------------- Unit tests (Table 4.3) ----------------
  await test('UT-01', 'unit', 'Authentication', 'Valid email + correct password', 'User authenticated; redirected to role dashboard', async () => {
    const r = await call('POST', '/auth/login', { body: { email: S.tenant.email, password: 'Passw0rdX' } });
    ok(r.status === 200 && r.body.token && r.body.user.role === 'Tenant', 'login failed');
    const me = await call('GET', '/me', { token: r.body.token }); ok(me.status === 200 && me.body.role === 'Tenant', 'token not accepted');
    return 'Login returned a JWT and role "Tenant"; token accepted by protected endpoint';
  });
  await test('UT-02', 'unit', 'Authentication', 'Invalid password (3rd attempt)', 'Account temporarily locked; error shown', async () => {
    const u = await newUser('Tenant', 'lock'); const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await call('POST', '/auth/login', { body: { email: u.email, password: 'Wrong1234' } })).status);
    const after = await call('POST', '/auth/login', { body: { email: u.email, password: 'Passw0rdX' } });
    ok(codes[0] === 401 && codes[1] === 401 && codes[2] === 423, 'expected 401,401,423 got ' + codes);
    ok(after.status === 423, 'correct password accepted while locked');
    return `Attempts 1-2 rejected (401); attempt 3 locked account (423); correct password refused while locked (423)`;
  });
  await test('UT-03', 'unit', 'Maintenance Request', 'All required fields completed', "Request saved with status 'Received'", async () => {
    const r = await call('POST', '/requests', { token: S.tenant.token, body: goodReq }); ok(r.status === 201, 'not created: ' + JSON.stringify(r.body));
    const g = await call('GET', '/requests/' + r.body.request_id, { token: S.tenant.token });
    ok(g.body.status === 'Received' && g.body.date_submitted, 'wrong status/timestamp');
    return `Request #${r.body.request_id} saved with status "Received" and a submission timestamp`;
  });
  await test('UT-04', 'unit', 'Maintenance Request', 'Description field left empty', 'Submission blocked; validation error shown', async () => {
    const [[b]] = await db.query('SELECT COUNT(*) n FROM MaintenanceRequests'); 
    const r = await call('POST', '/requests', { token: S.tenant.token, body: { ...goodReq, description: '' } });
    const [[a]] = await db.query('SELECT COUNT(*) n FROM MaintenanceRequests');
    ok(r.status === 400 && a.n === b.n, 'empty description accepted');
    return `Rejected with 400 ("${r.body.error}"); no record created`;
  });
  await test('UT-05', 'unit', 'Messaging', 'Message content of 1 to 1,000 characters', 'Message saved and displayed in thread', async () => {
    const rq = await call('POST', '/requests', { token: S.tenant.token, body: goodReq });
    const a = await call('POST', '/messages', { token: S.tenant.token, body: { receiver_id: S.landlord.id, request_id: rq.body.request_id, content: 'x' } });
    const b = await call('POST', '/messages', { token: S.tenant.token, body: { receiver_id: S.landlord.id, request_id: rq.body.request_id, content: 'y'.repeat(1000) } });
    const c = await call('POST', '/messages', { token: S.tenant.token, body: { receiver_id: S.landlord.id, request_id: rq.body.request_id, content: 'z'.repeat(1001) } });
    const d = await call('POST', '/messages', { token: S.tenant.token, body: { receiver_id: S.landlord.id, request_id: rq.body.request_id, content: '   ' } });
    const t = await call('GET', '/messages?request_id=' + rq.body.request_id, { token: S.landlord.token });
    ok(a.status === 201 && b.status === 201 && t.body.length === 2, 'valid messages not stored');
    ok(c.status === 400 && d.status === 400, 'boundary values not rejected');
    return '1-char and 1,000-char messages saved and visible in thread; 1,001-char and empty messages rejected';
  });
  // extra validation rules (Table 3.2)
  const V = async (id, desc, fn) => test(id, 'validation', 'Validation (Table 3.2)', desc, 'Rejected with clear error', fn);
  const reg = b => call('POST', '/auth/register', { body: { name: 'V User', email: `v${++seq}.${RUN}@test.ng`, phone: '08012345678', password: 'Passw0rd1', role: 'Tenant', ...b } });
  await V('VAL-01', 'Invalid email format', async () => { const r = await reg({ email: 'not-an-email' }); ok(r.status === 400, 'accepted'); return r.body.error; });
  await V('VAL-02', 'Duplicate email', async () => { const r = await reg({ email: S.tenant.email }); ok(r.status === 409, 'accepted'); return r.body.error; });
  await V('VAL-03', 'Weak password (no number / < 8 chars)', async () => { const a = await reg({ password: 'abcdefgh' }); const b = await reg({ password: 'a1' }); ok(a.status === 400 && b.status === 400, 'accepted'); return a.body.error; });
  await V('VAL-04', 'Phone number with 10 digits', async () => { const r = await reg({ phone: '0801234567' }); ok(r.status === 400, 'accepted'); return r.body.error; });
  await V('VAL-05', 'Request category not in list', async () => { const r = await call('POST', '/requests', { token: S.tenant.token, body: { ...goodReq, category: 'Hacking' } }); ok(r.status === 400, 'accepted'); return r.body.error; });
  await V('VAL-06', 'Severity omitted defaults to Medium', async () => { const r = await call('POST', '/requests', { token: S.tenant.token, body: { category: 'Electrical', description: 'Bedroom socket has no power at all.' } }); ok(r.status === 201, 'rejected'); const g = await call('GET', '/requests/' + r.body.request_id, { token: S.tenant.token }); ok(g.body.severity === 'Medium', 'not Medium'); return 'Saved with severity "Medium"'; });
  await V('VAL-07', 'Description of 501 characters / 9 characters', async () => { const a = await call('POST', '/requests', { token: S.tenant.token, body: { ...goodReq, description: 'a'.repeat(501) } }); const b = await call('POST', '/requests', { token: S.tenant.token, body: { ...goodReq, description: 'too short' } }); ok(a.status === 400 && b.status === 400, 'accepted'); return a.body.error; });
  await V('VAL-08', 'Photo: GIF type and >5MB PNG', async () => {
    const gif = await call('POST', '/requests', { token: S.tenant.token, body: { ...goodReq, photo: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } });
    const big = await call('POST', '/requests', { token: S.tenant.token, body: { ...goodReq, photo: 'data:image/png;base64,' + Buffer.alloc(5 * 1024 * 1024 + 10).toString('base64') } });
    const small = await call('POST', '/requests', { token: S.tenant.token, body: { ...goodReq, photo: 'data:image/png;base64,iVBORw0KGgo=' } });
    ok(gif.status === 400 && big.status === 400 && small.status === 201, `gif ${gif.status}, big ${big.status}, small ${small.status}`); return 'GIF and >5MB image rejected; small PNG accepted';
  });

  // ---------------- Integration tests (Table 4.4) ----------------
  await test('IT-01', 'integration', 'Request + Notification', 'Tenant submits request', 'Landlord notified within 5 seconds', async () => {
    const t0 = Date.now();
    const rq = await call('POST', '/requests', { token: S.tenant.token, body: { ...goodReq, category: 'Electrical' } });
    let found = null;
    while (Date.now() - t0 < 5000 && !found) {
      const n = await call('GET', '/notifications', { token: S.landlord.token });
      found = n.body.find(x => x.message.includes('#' + rq.body.request_id)); if (!found) await new Promise(r => setTimeout(r, 50));
    }
    const ms = Date.now() - t0; ok(found, 'no notification within 5 seconds');
    return `Landlord notification visible after ${ms} ms (limit 5,000 ms)`;
  });
  await test('IT-02', 'integration', 'Request + Messaging', 'Landlord replies to a request-linked message', "Reply appears in tenant's thread, linked to the correct request", async () => {
    const rq = await call('POST', '/requests', { token: S.tenant.token, body: goodReq });
    await call('POST', '/messages', { token: S.tenant.token, body: { receiver_id: S.landlord.id, request_id: rq.body.request_id, content: 'Please come today.' } });
    const rep = await call('POST', '/messages', { token: S.landlord.token, body: { receiver_id: S.tenant.id, request_id: rq.body.request_id, content: 'Plumber is on the way.' } });
    ok(rep.status === 201, 'reply failed');
    const th = await call('GET', '/messages?request_id=' + rq.body.request_id, { token: S.tenant.token });
    const m = th.body.find(x => x.content === 'Plumber is on the way.');
    ok(m && m.request_id === rq.body.request_id && m.sender_id === S.landlord.id, 'reply missing/unlinked');
    const n = await call('GET', '/notifications', { token: S.tenant.token }); ok(n.body.some(x => x.message.includes('New message')), 'no message notification');
    return `Reply appeared in tenant's thread for request #${rq.body.request_id}; tenant notified`;
  });
  await test('IT-03', 'integration', 'Authentication + RBAC', 'Maintenance staff opens the landlord-only reports page', 'Access denied; permission error shown', async () => {
    const r = await call('GET', '/reports/summary', { token: S.staff.token }); const t = await call('GET', '/reports/summary', { token: S.tenant.token });
    ok(r.status === 403 && t.status === 403, `got ${r.status}/${t.status}`);
    return `Staff and tenant tokens received 403 ("${r.body.error}")`;
  });

  // ---------------- System tests (Table 4.5) ----------------
  await test('ST-01', 'system', 'End-to-end', 'Tenant submits -> Landlord assigns -> Staff resolves -> Tenant notified', 'All status transitions reflected; tenant receives final notification', async () => {
    const rq = (await call('POST', '/requests', { token: S.tenant.token, body: goodReq })).body.request_id; const seen = [];
    const st = async () => (await call('GET', '/requests/' + rq, { token: S.tenant.token })).body.status;
    seen.push(await st());
    ok((await call('PATCH', `/requests/${rq}/assign`, { token: S.landlord.token, body: { staff_id: S.staff.id } })).status === 200, 'assign failed'); seen.push(await st());
    const sn = await call('GET', '/notifications', { token: S.staff.token }); ok(sn.body.some(x => x.message.includes('#' + rq)), 'staff not notified');
    ok((await call('PATCH', `/requests/${rq}/status`, { token: S.staff.token, body: { status: 'Resolved', note: 'Washer replaced.' } })).status === 200, 'resolve failed'); seen.push(await st());
    const g = (await call('GET', '/requests/' + rq, { token: S.tenant.token })).body;
    const tn = (await call('GET', '/notifications', { token: S.tenant.token })).body; const th = (await call('GET', '/messages?request_id=' + rq, { token: S.tenant.token })).body;
    ok(g.status === 'Resolved' && g.date_resolved, 'no resolved timestamp');
    ok(tn.some(x => x.message.includes(`#${rq}`) && x.message.includes('Resolved')), 'tenant not notified of resolution');
    ok(th.some(x => x.content === 'Washer replaced.'), 'resolution note missing');
    return `Status sequence ${seen.join(' -> ')}; resolution timestamp set; tenant notified; resolution note in thread`;
  });
  await test('ST-02', 'system', 'Concurrency', '10 tenants submit requests at the same time for the same property', 'All requests logged distinctly; no data loss or overwrite', async () => {
    const tenants = []; for (let i = 0; i < 10; i++) { const t = await newUser('Tenant', 'conc'); await call('POST', `/properties/${S.propertyId}/tenants`, { token: S.landlord.token, body: { email: t.email } }); tenants.push(t); }
    const res = await Promise.all(tenants.map((t, i) => call('POST', '/requests', { token: t.token, body: { ...goodReq, description: `Concurrent request number ${i} for testing purposes.` } })));
    ok(res.every(r => r.status === 201), 'some submissions failed');
    const ids = new Set(res.map(r => r.body.request_id)); ok(ids.size === 10, 'duplicate ids');
    const [rows] = await db.query(`SELECT description FROM MaintenanceRequests WHERE request_id IN (${[...ids].join(',')})`);
    ok(new Set(rows.map(r => r.description)).size === 10, 'overwrite detected');
    return '10 simultaneous submissions produced 10 distinct request IDs and 10 distinct stored records';
  });

  // ---------------- Security tests (Table 4.6) ----------------
  const SEC = (id, module, input, expected, fn) => test(id, 'security', module, input, expected, fn);
  await SEC('SEC-01', 'Bypass of role restrictions', 'Direct API calls with tenant/staff tokens to restricted endpoints', 'Request rejected (access denied)', async () => {
    const other = await newUser('Tenant', 'other'); const rq = (await call('POST', '/requests', { token: S.tenant.token, body: goodReq })).body.request_id;
    const checks = {
      'tenant->assign': (await call('PATCH', `/requests/${rq}/assign`, { token: S.tenant.token, body: { staff_id: S.staff.id } })).status,
      'tenant->add property': (await call('POST', '/properties', { token: S.tenant.token, body: { address: 'Some address here' } })).status,
      'staff->add property': (await call('POST', '/properties', { token: S.staff.token, body: { address: 'Some address here' } })).status,
      'tenant->update status': (await call('PATCH', `/requests/${rq}/status`, { token: S.tenant.token, body: { status: 'Closed' } })).status,
      'other tenant->read request': (await call('GET', '/requests/' + rq, { token: other.token })).status,
      'other tenant->read thread': (await call('GET', '/messages?request_id=' + rq, { token: other.token })).status,
      'unassigned staff->read request': (await call('GET', '/requests/' + rq, { token: S.staff.token })).status,
      'no token->list requests': (await call('GET', '/requests')).status,
    };
    const expect = { 'tenant->assign': 403, 'tenant->add property': 403, 'staff->add property': 403, 'tenant->update status': 403, 'other tenant->read request': 404, 'other tenant->read thread': 403, 'unassigned staff->read request': 404, 'no token->list requests': 401 };
    for (const k in expect) ok(checks[k] === expect[k], `${k} returned ${checks[k]}, expected ${expect[k]}`);
    return `${Object.keys(expect).length} of ${Object.keys(expect).length} bypass attempts refused (${Object.values(checks).join(', ')})`;
  });
  await SEC('SEC-02', 'SQL injection', "Payloads such as ' OR '1'='1 in login, search and registration fields", 'Input rejected or neutralised; no data exposed', async () => {
    const l1 = await call('POST', '/auth/login', { body: { email: "' OR '1'='1", password: "' OR '1'='1" } });
    const l2 = await call('POST', '/auth/login', { body: { email: `${S.tenant.email}' --`, password: 'x' } });
    const own = await call('GET', '/requests', { token: S.tenant.token }); const inj = await call('GET', "/requests?q=" + encodeURIComponent("' OR 1=1 --"), { token: S.tenant.token });
    const [[before]] = await db.query('SELECT COUNT(*) n FROM Users');
    const rg = await call('POST', '/auth/register', { body: { name: "Robert'); DROP TABLE Users;--", email: `sqli.${RUN}@test.ng`, phone: '08099999999', password: 'Passw0rd1', role: 'Tenant' } });
    const [[after]] = await db.query('SELECT COUNT(*) n FROM Users');
    ok(l1.status === 401 && l2.status === 401, 'login injection not refused');
    ok(inj.body.length === 0 && own.body.length > 0, 'search injection returned data');
    ok(rg.status === 201 && after.n === before.n + 1, 'users table affected');
    return 'Login injections refused (401); injected search returned 0 rows (not all data); Users table intact after "DROP TABLE" payload stored as plain text';
  });
  await SEC('SEC-03', 'Cross-site scripting', 'Script tags submitted in message and description fields', 'Script sanitised and not executed', async () => {
    const rq = await call('POST', '/requests', { token: S.tenant.token, body: { ...goodReq, description: 'Leak <script>alert(1)</script> in the kitchen' } });
    await call('POST', '/messages', { token: S.tenant.token, body: { receiver_id: S.landlord.id, request_id: rq.body.request_id, content: '<img src=x onerror=alert(1)>' } });
    const g = (await call('GET', '/requests/' + rq.body.request_id, { token: S.tenant.token })).body; const m = (await call('GET', '/messages?request_id=' + rq.body.request_id, { token: S.landlord.token })).body[0];
    ok(!/<script|<img/i.test(g.description + m.content), 'raw tags stored'); ok(g.description.includes('&lt;script&gt;'), 'not escaped');
    return 'Angle brackets were HTML-escaped on the server (&lt;script&gt;); React renders the text without executing it';
  });
  await SEC('SEC-04', 'Session expiry', 'Use of an expired JWT', 'Request rejected; re-login required', async () => {
    const expired = jwt.sign({ id: S.tenant.id, role: 'Tenant', name: 'x' }, process.env.JWT_SECRET || 'dev-secret-change-in-production', { expiresIn: -10 });
    const tampered = S.tenant.token.slice(0, -3) + 'abc';
    const a = await call('GET', '/requests', { token: expired }); const b = await call('GET', '/requests', { token: tampered });
    ok(a.status === 401 && b.status === 401, `got ${a.status}/${b.status}`); return `Expired token -> 401 ("${a.body.error}"); tampered token -> 401`;
  });
  await SEC('SEC-05', 'Password-reset token', 'Reuse or delayed use of a reset token', 'Token refused after use or expiry', async () => {
    const u = await newUser('Tenant', 'reset'); const f = await call('POST', '/auth/forgot-password', { body: { email: u.email } }); ok(f.body.token, 'no token');
    const first = await call('POST', '/auth/reset-password', { body: { token: f.body.token, password: 'NewPassw0rd' } });
    const reuse = await call('POST', '/auth/reset-password', { body: { token: f.body.token, password: 'Another1234' } });
    const f2 = await call('POST', '/auth/forgot-password', { body: { email: u.email } });
    await db.query(`UPDATE Users SET reset_expires='2020-01-01 00:00:00' WHERE user_id=?`, [u.id]);
    const late = await call('POST', '/auth/reset-password', { body: { token: f2.body.token, password: 'Another1234' } });
    const login = await call('POST', '/auth/login', { body: { email: u.email, password: 'NewPassw0rd' } });
    ok(first.status === 200 && reuse.status === 400 && late.status === 400 && login.status === 200, `${first.status}/${reuse.status}/${late.status}/${login.status}`);
    return 'First use succeeded; reuse refused (400); expired token refused (400); new password works';
  });
  await SEC('SEC-06', 'Password storage', 'Inspect stored credentials in the database', 'Passwords stored only as salted hashes', async () => {
    const [[r]] = await db.query('SELECT password_hash FROM Users WHERE user_id=?', [S.tenant.id]);
    ok(/^\$2[aby]\$10\$/.test(r.password_hash) && !r.password_hash.includes('Passw0rdX'), 'not a bcrypt hash'); return 'Stored value is a bcrypt hash (cost 10) with per-user salt; plaintext not present';
  });

  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', 'api_results.json'), JSON.stringify(results, null, 2));
  const p = results.filter(r => r.pass).length; console.log(`\n${p}/${results.length} tests passed`);
  await db.end(); process.exit(p === results.length ? 0 : 1);
})();
