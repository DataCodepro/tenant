import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

const CATS = ['Plumbing', 'Electrical', 'Structural', 'Appliance', 'Security', 'Other'];
const SEVS = ['Low', 'Medium', 'High', 'Urgent'];
const STATS = ['Received', 'In Progress', 'Resolved', 'Closed'];
const token = () => localStorage.getItem('tl_token');
async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Request failed'); e.status = r.status; throw e; }
  return j;
}
const fmt = s => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const cls = s => 's-' + s.replace(' ', '');
const Pill = ({ s, kind }) => <span className={'pill ' + (kind === 'v' ? 'v-' + s : cls(s))}>{s}</span>;

function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ role: 'Tenant' });
  const [msg, setMsg] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    setMsg(null);
    try {
      if (mode === 'login') { const r = await api('/auth/login', { method: 'POST', body: f }); localStorage.setItem('tl_token', r.token); onLogin(r.user); }
      else if (mode === 'register') { await api('/auth/register', { method: 'POST', body: f }); setMode('login'); setMsg({ ok: 'Account created. Please log in.' }); }
      else { const r = await api('/auth/forgot-password', { method: 'POST', body: f }); setMsg({ ok: r.message }); }
    } catch (e) { setMsg({ err: e.message }); }
  };
  return <div className="auth">
    <div className="logo"><div style={{ fontSize: 40 }}>🏠</div><h1>TenantConnect</h1><div className="mut">Tenant–Landlord Maintenance System · Abuja</div></div>
    <div className="card">
      <h3>{mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : 'Reset password'}</h3>
      {msg?.err && <div className="err">{msg.err}</div>}{msg?.ok && <div className="ok">{msg.ok}</div>}
      {mode === 'register' && <><label>Full name</label><input value={f.name || ''} onChange={set('name')} />
        <label>I am a</label><select value={f.role} onChange={set('role')}><option>Tenant</option><option>Landlord</option><option>Maintenance Staff</option></select>
        <label>Phone number</label><input inputMode="numeric" placeholder="08012345678" value={f.phone || ''} onChange={set('phone')} /><div className="hint">11 digits, Nigerian format</div></>}
      <label>Email</label><input type="email" value={f.email || ''} onChange={set('email')} />
      {mode !== 'forgot' && <><label>Password</label><input type="password" value={f.password || ''} onChange={set('password')} />
        {mode === 'register' && <div className="hint">At least 8 characters, with a letter and a number</div>}</>}
      <button className="btn full" onClick={submit}>{mode === 'login' ? 'Log in' : mode === 'register' ? 'Register' : 'Send reset code'}</button>
    </div>
    <div className="sw">
      {mode !== 'login' && <button onClick={() => { setMode('login'); setMsg(null); }}>Back to log in</button>}
      {mode === 'login' && <><button onClick={() => { setMode('register'); setMsg(null); }}>Create an account</button> · <button onClick={() => { setMode('forgot'); setMsg(null); }}>Forgot password?</button></>}
    </div>
  </div>;
}

function Thread({ requestId, me, otherId }) {
  const [msgs, setMsgs] = useState([]); const [text, setText] = useState(''); const [err, setErr] = useState('');
  const load = useCallback(() => api(requestId ? `/messages?request_id=${requestId}` : `/messages?with=${otherId}`).then(setMsgs).catch(() => { }), [requestId, otherId]);
  useEffect(() => { load(); }, [load]);
  const send = async recv => {
    setErr('');
    try { await api('/messages', { method: 'POST', body: { receiver_id: recv, request_id: requestId || undefined, content: text } }); setText(''); load(); } catch (e) { setErr(e.message); }
  };
  return <div>
    <div className="thread">{msgs.length === 0 && <div className="mut">No messages yet.</div>}
      {msgs.map(m => <div key={m.message_id} className={'msg ' + (m.sender_id === me.id ? 'me' : '')}><b>{m.sender_id === me.id ? 'You' : m.sender_name}</b>{m.content.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')}<br /><span>{fmt(m.timestamp)}</span></div>)}</div>
    {err && <div className="err">{err}</div>}
    <ThreadCompose text={text} setText={setText} send={send} me={me} otherId={otherId} requestId={requestId} />
  </div>;
}
function ThreadCompose({ text, setText, send, me, otherId, requestId }) {
  const [recips, setRecips] = useState([]); const [to, setTo] = useState(otherId || '');
  useEffect(() => {
    if (!requestId) return;
    api('/requests/' + requestId).then(r => {
      const list = [];
      if (me.role !== 'Tenant') list.push({ id: r.tenant_id, name: r.tenant_name + ' (Tenant)' });
      if (me.role !== 'Landlord') list.push({ id: r.landlord_id, name: r.landlord_name + ' (Landlord)' });
      if (me.role === 'Landlord' && r.assigned_to) list.push({ id: r.assigned_to, name: r.staff_name + ' (Staff)' });
      setRecips(list); setTo(list[0]?.id || '');
    }).catch(() => { });
  }, [requestId, me.role]);
  return <div>
    {requestId && recips.length > 1 && <select style={{ marginBottom: 8 }} value={to} onChange={e => setTo(e.target.value)}>{recips.map(r => <option key={r.id} value={r.id}>To: {r.name}</option>)}</select>}
    <div className="compose"><input placeholder="Type a message…" value={text} onChange={e => setText(e.target.value)} maxLength={1000} /><button className="btn" onClick={() => send(to || otherId)}>Send</button></div>
  </div>;
}

function RequestDetail({ id, me, onBack }) {
  const [r, setR] = useState(null); const [staff, setStaff] = useState([]); const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const load = useCallback(() => api('/requests/' + id).then(setR), [id]);
  useEffect(() => { load(); if (me.role === 'Landlord') api('/staff').then(setStaff); }, [load, me.role]);
  if (!r) return <div className="mut">Loading…</div>;
  const act = async (fn) => { setErr(''); try { await fn(); await load(); } catch (e) { setErr(e.message); } };
  return <div>
    <button className="back" onClick={onBack}>← Back</button>
    <div className="card">
      <div className="row"><h3>#{r.request_id} · {r.category}</h3><div><Pill s={r.severity} kind="v" /><Pill s={r.status} /></div></div>
      <div className="mut">{r.address}{r.unit_details ? ' · ' + r.unit_details : ''}</div>
      <p>{r.description.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')}</p>
      <div className="mut">Reported by {r.tenant_name} on {fmt(r.date_submitted)}{r.staff_name ? ` · Assigned to ${r.staff_name}` : ' · Not yet assigned'}{r.date_resolved ? ` · Resolved ${fmt(r.date_resolved)}` : ''}</div>
      {err && <div className="err">{err}</div>}
      {me.role === 'Landlord' && <div className="grid2" style={{ marginTop: 10 }}>
        <div><label>Assign to</label><select value={r.assigned_to || ''} onChange={e => act(() => api(`/requests/${id}/assign`, { method: 'PATCH', body: { staff_id: e.target.value } }))}><option value="">Select staff…</option>{staff.map(s => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}</select></div>
        <div><label>Status</label><select value={r.status} onChange={e => act(() => api(`/requests/${id}/status`, { method: 'PATCH', body: { status: e.target.value } }))}>{STATS.map(s => <option key={s}>{s}</option>)}</select></div>
      </div>}
      {me.role === 'Maintenance Staff' && <div style={{ marginTop: 10 }}>
        <label>Resolution note (optional)</label><input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Replaced the worn washer" />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn sm alt" onClick={() => act(() => api(`/requests/${id}/status`, { method: 'PATCH', body: { status: 'In Progress', note } }).then(() => setNote('')))}>Mark In Progress</button>
          <button className="btn sm" onClick={() => act(() => api(`/requests/${id}/status`, { method: 'PATCH', body: { status: 'Resolved', note } }).then(() => setNote('')))}>Mark Resolved</button></div></div>}
    </div>
    <div className="card"><h3>Messages</h3><Thread requestId={id} me={me} /></div>
  </div>;
}

function RequestList({ me, onOpen, refreshKey }) {
  const [list, setList] = useState([]); const [q, setQ] = useState(''); const [st, setSt] = useState('');
  useEffect(() => { api(`/requests?${st ? 'status=' + encodeURIComponent(st) + '&' : ''}${q ? 'q=' + encodeURIComponent(q) : ''}`).then(setList); }, [q, st, refreshKey]);
  return <div>
    <div className="filters"><input placeholder="Search requests…" value={q} onChange={e => setQ(e.target.value)} /><select value={st} onChange={e => setSt(e.target.value)}><option value="">All statuses</option>{STATS.map(s => <option key={s}>{s}</option>)}</select></div>
    {list.length === 0 && <div className="card mut">No requests found.</div>}
    {list.map(r => <div className="card" key={r.request_id} onClick={() => onOpen(r.request_id)} style={{ cursor: 'pointer' }}>
      <div className="row"><h3>#{r.request_id} · {r.category}</h3><div><Pill s={r.severity} kind="v" /><Pill s={r.status} /></div></div>
      <div>{r.description.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').slice(0, 90)}{r.description.length > 90 ? '…' : ''}</div>
      <div className="mut">{me.role === 'Tenant' ? r.address : `${r.tenant_name} · ${r.address}`} · {fmt(r.date_submitted)}</div>
    </div>)}
  </div>;
}

function NewRequest({ onDone }) {
  const [f, setF] = useState({ category: '', severity: '', description: '' }); const [err, setErr] = useState(''); const [photo, setPhoto] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const pick = e => { const file = e.target.files[0]; if (!file) return; if (!/^image\/(jpeg|png)$/.test(file.type)) { setErr('Photo must be a JPEG or PNG image'); return; } if (file.size > 5 * 1024 * 1024) { setErr('Photo must not exceed 5MB'); return; } const rd = new FileReader(); rd.onload = () => setPhoto(rd.result); rd.readAsDataURL(file); };
  const submit = async () => { setErr(''); try { const r = await api('/requests', { method: 'POST', body: { ...f, severity: f.severity || undefined, photo: photo || undefined } }); onDone(r.request_id); } catch (e) { setErr(e.message); } };
  return <div className="card"><h3>Report a maintenance problem</h3>
    {err && <div className="err">{err}</div>}
    <label>Category</label><select value={f.category} onChange={set('category')}><option value="">Select category…</option>{CATS.map(c => <option key={c}>{c}</option>)}</select>
    <label>How urgent is it?</label><select value={f.severity} onChange={set('severity')}><option value="">Medium (default)</option>{SEVS.map(c => <option key={c}>{c}</option>)}</select>
    <label>Describe the problem</label><textarea value={f.description} onChange={set('description')} maxLength={500} placeholder="What is wrong, and where in the flat?" /><div className="hint">{f.description.length}/500 characters (minimum 10)</div>
    <label>Photo (optional)</label><input type="file" accept="image/jpeg,image/png" onChange={pick} /><div className="hint">JPEG or PNG, maximum 5MB</div>
    <button className="btn full" onClick={submit}>Submit request</button></div>;
}

function Properties() {
  const [list, setList] = useState([]); const [a, setA] = useState(''); const [u, setU] = useState(''); const [em, setEm] = useState({}); const [msg, setMsg] = useState(null);
  const load = () => api('/properties').then(setList); useEffect(() => { load(); }, []);
  return <div>
    {msg && <div className={msg.err ? 'err' : 'ok'}>{msg.err || msg.ok}</div>}
    {list.map(p => <div className="card" key={p.property_id}><h3>{p.address}</h3><div className="mut">{p.unit_details}</div>
      <div style={{ margin: '8px 0' }}>{p.tenants.length === 0 ? <span className="mut">No tenants linked yet.</span> : p.tenants.map(t => <div key={t.tenancy_id}>👤 {t.name} <span className="mut">· {t.email}</span></div>)}</div>
      <div className="compose"><input placeholder="Tenant email to add" value={em[p.property_id] || ''} onChange={e => setEm({ ...em, [p.property_id]: e.target.value })} />
        <button className="btn sm" onClick={async () => { try { await api(`/properties/${p.property_id}/tenants`, { method: 'POST', body: { email: em[p.property_id] } }); setMsg({ ok: 'Tenant added' }); setEm({ ...em, [p.property_id]: '' }); load(); } catch (e) { setMsg({ err: e.message }); } }}>Add</button></div></div>)}
    <div className="card"><h3>Add a property</h3><label>Address</label><input value={a} onChange={e => setA(e.target.value)} /><label>Unit details (optional)</label><input value={u} onChange={e => setU(e.target.value)} />
      <button className="btn full" onClick={async () => { try { await api('/properties', { method: 'POST', body: { address: a, unit_details: u } }); setA(''); setU(''); load(); } catch (e) { setMsg({ err: e.message }); } }}>Add property</button></div>
  </div>;
}

function Messages({ me }) {
  const [c, setC] = useState([]); const [sel, setSel] = useState(null);
  useEffect(() => { api('/contacts').then(r => { setC(r); if (r[0]) setSel(r[0].user_id); }); }, []);
  return <div>{c.length === 0 ? <div className="card mut">No contacts yet.</div> : <>
    <select value={sel || ''} onChange={e => setSel(Number(e.target.value))} style={{ marginBottom: 10 }}>{c.map(x => <option key={x.user_id} value={x.user_id}>{x.name} ({x.role})</option>)}</select>
    {sel && <div className="card"><h3>General conversation</h3><Thread key={sel} me={me} otherId={sel} /></div>}</>}
    <div className="mut">Tip: messages about a specific fault are best sent from inside that request.</div></div>;
}

function Reports() {
  const [d, setD] = useState(null); useEffect(() => { api('/reports/summary').then(setD); }, []);
  if (!d) return <div className="mut">Loading…</div>; const max = Math.max(1, ...d.by_category.map(c => c.n));
  return <div>
    <div className="stat"><div><b>{d.total}</b><span>Total requests</span></div><div><b>{d.pending}</b><span>Pending</span></div><div><b>{d.completed}</b><span>Completed</span></div><div><b>{d.avg_resolution_hours ?? '—'}</b><span>Avg. hours to resolve</span></div></div>
    <div className="card"><h3>Requests by category</h3>{d.by_category.map(c => <div className="bar" key={c.category}><em>{c.category}</em><i style={{ width: `${(c.n / max) * 60}%` }} /> {c.n}</div>)}</div>
    <div className="card"><h3>Recurring faults</h3>{d.recurring.length === 0 ? <div className="mut">No recurring faults detected.</div> : d.recurring.map((r, i) => <div key={i}>🔁 <b>{r.category}</b> ×{r.n} <span className="mut">· {r.address}</span></div>)}</div>
  </div>;
}

function Notifications({ onChange }) {
  const [list, setList] = useState([]); const load = () => api('/notifications').then(setList); useEffect(() => { load(); }, []);
  return <div className="card"><div className="row"><h3>Notifications</h3><button className="btn sm alt" onClick={async () => { await api('/notifications/read-all', { method: 'PATCH' }); load(); onChange(); }}>Mark all read</button></div>
    {list.length === 0 && <div className="mut">Nothing yet.</div>}
    {list.map(n => <div key={n.notification_id} className={'notif ' + (n.is_read ? '' : 'un')} onClick={async () => { await api(`/notifications/${n.notification_id}/read`, { method: 'PATCH' }); load(); onChange(); }}><span className={'dot ' + (n.is_read ? 'rd' : '')} /><div>{n.message}<div className="mut">{fmt(n.timestamp)}</div></div></div>)}</div>;
}

function Dashboard({ me, logout }) {
  const tabsFor = { Tenant: ['requests', 'new', 'messages', 'alerts'], Landlord: ['requests', 'properties', 'messages', 'reports', 'alerts'], 'Maintenance Staff': ['requests', 'alerts'] }[me.role];
  const label = { requests: me.role === 'Tenant' ? '📋 My requests' : me.role === 'Landlord' ? '📋 Requests' : '🔧 My jobs', new: '➕ New request', messages: '💬 Messages', alerts: '🔔 Alerts', properties: '🏢 Properties', reports: '📊 Reports' };
  const [tab, setTab] = useState('requests'); const [open, setOpen] = useState(null); const [unread, setUnread] = useState(0); const [rk, setRk] = useState(0);
  const refreshCount = useCallback(() => api('/notifications').then(l => setUnread(l.filter(n => !n.is_read).length)).catch(() => { }), []);
  useEffect(() => { refreshCount(); const t = setInterval(refreshCount, 15000); return () => clearInterval(t); }, [refreshCount, tab]);
  const go = t => { setTab(t); setOpen(null); };
  return <div>
    <div className="hdr"><div><h1>TenantConnect</h1><small>{me.name} · {me.role}</small></div>
      <div className="right"><button className="bell" onClick={() => go('alerts')}>🔔{unread > 0 && <span className="badge">{unread}</span>}</button><button className="link" onClick={logout}>Log out</button></div></div>
    <div className="wrap">
      {tab === 'requests' && (open ? <RequestDetail id={open} me={me} onBack={() => { setOpen(null); setRk(rk + 1); }} /> : <RequestList me={me} onOpen={setOpen} refreshKey={rk} />)}
      {tab === 'new' && <NewRequest onDone={id => { setRk(rk + 1); setTab('requests'); setOpen(id); }} />}
      {tab === 'messages' && <Messages me={me} />}
      {tab === 'properties' && <Properties />}
      {tab === 'reports' && <Reports />}
      {tab === 'alerts' && <Notifications onChange={refreshCount} />}
    </div>
    <div className="tabs">{tabsFor.map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => go(t)}>{label[t]}</button>)}</div>
  </div>;
}

function App() {
  const [me, setMe] = useState(null); const [ready, setReady] = useState(false);
  useEffect(() => { if (token()) api('/me').then(setMe).catch(() => localStorage.removeItem('tl_token')).finally(() => setReady(true)); else setReady(true); }, []);
  const logout = () => { localStorage.removeItem('tl_token'); setMe(null); };
  if (!ready) return null;
  return me ? <Dashboard me={me} logout={logout} /> : <Auth onLogin={u => setMe({ ...u })} />;
}
createRoot(document.getElementById('root')).render(<App />);
