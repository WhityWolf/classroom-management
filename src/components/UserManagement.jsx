/**
 * components/UserManagement.jsx
 * Admin panel for viewing, creating, editing, and deactivating users.
 *
 * Access is gated by permissions — components render only what the current user
 * is allowed to see and do. The actual enforcement mirrors what a backend would do.
 */

import { useState, useMemo } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useT, dtc, dbg } from '../theme.jsx';
import { getUsers, createUser, updateUser, deactivateUser } from '../auth/mockDb.js';
import { ROLES, ROLE_LABELS, DEPT_SCOPED_ROLES, canAssignRole, ASSIGNABLE_BY } from '../auth/roles.js';
import { PERMS } from '../auth/permissions.js';
import { formatDate, formatDateTime } from '../auth/utils.js';

const DEPTS_LIST = [
  { id: 'MATH', name: 'Mathematics',      clr: '#60A5FA', textClr: '#1d4ed8', lightBg: '#eff6ff', bg: '#0d1f3d' },
  { id: 'PHYS', name: 'Physics',          clr: '#FBBF24', textClr: '#92400e', lightBg: '#fffbeb', bg: '#2c1f06' },
  { id: 'CS',   name: 'Computer Science', clr: '#34D399', textClr: '#065f46', lightBg: '#ecfdf5', bg: '#062c1d' },
  { id: 'CHEM', name: 'Chemistry',        clr: '#A78BFA', textClr: '#5b21b6', lightBg: '#f5f3ff', bg: '#1c0d3d' },
];
const DEPT_MAP = Object.fromEntries(DEPTS_LIST.map(d => [d.id, d]));

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function UserManagement({ onClose }) {
  const { currentUser, can, refreshUser } = useAuth();
  const { T, theme } = useT();
  const mono = { fontFamily: "'DM Mono',monospace" };

  const [users,     setUsers]     = useState(() => getUsers());
  const [search,    setSearch]    = useState('');
  const [editUser,  setEditUser]  = useState(null);    // user being edited, or null
  const [creating,  setCreating]  = useState(false);   // show create form
  const [deactConf, setDeactConf] = useState(null);    // user pending deactivation confirm
  const [feedback,  setFeedback]  = useState(null);    // { type:'ok'|'err', msg }

  const reload = () => setUsers(getUsers());

  const flash = (type, msg) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 3000);
  };

  // Filter: DEPT_HEAD can only see users in their own dept
  const visibleUsers = useMemo(() => {
    let list = users;
    if (currentUser.role === ROLES.DEPT_HEAD) {
      list = list.filter(u => u.deptId === currentUser.deptId);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        ROLE_LABELS[u.role]?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, search, currentUser]);

  const handleDeactivate = (user) => {
    try {
      deactivateUser(user.id);
      reload();
      if (user.id === currentUser.id) { /* unlikely, but handle gracefully */ }
      flash('ok', `${user.name} has been deactivated.`);
    } catch (e) {
      flash('err', e.message);
    }
    setDeactConf(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px',
                    borderBottom: `1px solid ${T.bdr}`, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>User Management</div>
          <div style={{ ...mono, fontSize: 9, color: T.dim }}>
            {visibleUsers.length} user{visibleUsers.length !== 1 ? 's' : ''} visible
          </div>
        </div>
        <div style={{ flex: 1 }}/>
        {can(PERMS.CREATE_OWN_DEPT_USER) && (
          <button onClick={() => { setCreating(true); setEditUser(null); }}
            style={{ padding: '6px 14px', background: '#3b82f6', border: 'none', borderRadius: 6,
                     color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            + New User
          </button>
        )}
        <button onClick={onClose}
          style={{ padding: '6px 10px', background: 'transparent', border: `1px solid ${T.bdr2}`,
                   borderRadius: 6, color: T.muted, fontSize: 11, cursor: 'pointer' }}>
          ✕ Close
        </button>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div style={{ margin: '10px 20px 0', padding: '8px 12px', borderRadius: 6, fontSize: 12,
                      background: feedback.type === 'ok'
                        ? (theme==='light'?'#f0fdf4':'#0a2a0a')
                        : (theme==='light'?'#fef2f2':'#2a0a0a'),
                      border: `1px solid ${feedback.type==='ok'
                        ? (theme==='light'?'#86efac':'#34d39944')
                        : (theme==='light'?'#fca5a5':'#ef444444')}`,
                      color: feedback.type === 'ok'
                        ? (theme==='light'?'#15803d':'#34d399')
                        : (theme==='light'?'#b91c1c':'#ef4444') }}>
          {feedback.msg}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* User list */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 20px', borderBottom: `1px solid ${T.bdr}` }}>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, username, or role…"
              style={{ width: '100%', padding: '6px 10px', background: T.inputBg,
                       border: `1px solid ${T.inputBdr}`, borderRadius: 6,
                       color: T.txt, fontSize: 12, outline: 'none' }}/>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: T.surface,
                             borderBottom: `1px solid ${T.bdr}`, zIndex: 2 }}>
                  {['Name','Username','Role','Department','Last Login','Status',''].map(h => (
                    <th key={h} style={{ padding: '8px 16px', textAlign: 'left', ...mono,
                                         fontSize: 8, color: T.dim, fontWeight: 400,
                                         textTransform: 'uppercase', letterSpacing: 1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map(user => {
                  const dept  = DEPT_MAP[user.deptId];
                  const isSelf = user.id === currentUser.id;
                  const canEdit = can(PERMS.EDIT_ANY_USER) ||
                    (can(PERMS.EDIT_OWN_DEPT_USER) && user.deptId === currentUser.deptId);
                  const canDeact = can(PERMS.DEACTIVATE_USER) && !isSelf;

                  return (
                    <tr key={user.id}
                      style={{ borderBottom: `1px solid ${T.bdr}`,
                               background: !user.isActive ? T.faint : 'transparent',
                               opacity: user.isActive ? 1 : 0.5 }}>
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{ fontWeight: 500 }}>{user.name}</div>
                        <div style={{ ...mono, fontSize: 9, color: T.dim }}>{user.email}</div>
                      </td>
                      <td style={{ padding: '10px 16px', ...mono, fontSize: 11, color: T.muted }}>
                        {user.username}
                        {isSelf && <span style={{ marginLeft: 6, fontSize: 8, color: '#3b82f6',
                          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 3,
                          padding: '1px 4px' }}>you</span>}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <RoleBadge role={user.role} theme={theme}/>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        {dept ? (
                          <span style={{ ...mono, fontSize: 10,
                                         color: dtc(dept, theme),
                                         background: dbg(dept, theme),
                                         border: `1px solid ${dept.clr}44`,
                                         borderRadius: 4, padding: '2px 7px' }}>
                            {dept.id}
                          </span>
                        ) : <span style={{ color: T.dim, fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 16px', ...mono, fontSize: 10, color: T.dim }}>
                        {formatDateTime(user.lastLogin)}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{ ...mono, fontSize: 9, borderRadius: 4, padding: '2px 7px',
                                       background: user.isActive
                                         ? (theme==='light'?'#f0fdf4':'#0a2a0a')
                                         : T.faint,
                                       border: `1px solid ${user.isActive
                                         ? (theme==='light'?'#86efac':'#34d39933')
                                         : T.bdr}`,
                                       color: user.isActive
                                         ? (theme==='light'?'#15803d':'#34d399')
                                         : T.dim }}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {canEdit && user.isActive && (
                            <button onClick={() => { setEditUser(user); setCreating(false); }}
                              style={{ padding: '3px 10px', background: 'transparent',
                                       border: `1px solid ${T.bdr2}`, borderRadius: 4,
                                       color: T.muted, fontSize: 10, cursor: 'pointer' }}
                              onMouseEnter={e => e.currentTarget.style.borderColor = T.muted}
                              onMouseLeave={e => e.currentTarget.style.borderColor = T.bdr2}>
                              Edit
                            </button>
                          )}
                          {canDeact && user.isActive && (
                            <button onClick={() => setDeactConf(user)}
                              style={{ padding: '3px 10px', background: 'transparent',
                                       border: '1px solid #ef444455', borderRadius: 4,
                                       color: theme==='light'?'#b91c1c':'#ef4444',
                                       fontSize: 10, cursor: 'pointer' }}
                              onMouseEnter={e => e.currentTarget.style.borderColor = '#ef4444'}
                              onMouseLeave={e => e.currentTarget.style.borderColor = '#ef444455'}>
                              Deactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Side form: create or edit */}
        {(creating || editUser) && (
          <div style={{ width: 340, borderLeft: `1px solid ${T.bdr}`, overflow: 'auto',
                        background: T.card, flexShrink: 0 }}>
            <UserForm
              T={T} theme={theme} mono={mono}
              existing={editUser}
              currentUser={currentUser}
              onSave={(data) => {
                try {
                  if (editUser) {
                    updateUser(editUser.id, data);
                    if (editUser.id === currentUser.id) refreshUser();
                    flash('ok', 'User updated successfully.');
                  } else {
                    createUser(data, currentUser.id);
                    flash('ok', `User "${data.username}" created.`);
                  }
                  reload();
                  setEditUser(null);
                  setCreating(false);
                } catch (e) {
                  flash('err', e.message);
                }
              }}
              onCancel={() => { setEditUser(null); setCreating(false); }}
            />
          </div>
        )}
      </div>

      {/* Deactivation confirm */}
      {deactConf && (
        <div onClick={() => setDeactConf(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
                   display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.surface, border: `1px solid ${T.bdr}`, borderRadius: 12,
                     padding: 24, width: 340, boxShadow: T.shadowMd }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Deactivate user?</div>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 20 }}>
              <strong>{deactConf.name}</strong> will lose all access immediately.
              Their data is preserved and the account can be reactivated later.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeactConf(null)}
                style={{ padding: '7px 16px', background: 'transparent',
                         border: `1px solid ${T.bdr2}`, borderRadius: 6,
                         color: T.muted, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => handleDeactivate(deactConf)}
                style={{ padding: '7px 16px', background: '#ef4444', border: 'none',
                         borderRadius: 6, color: '#fff', fontSize: 11,
                         fontWeight: 600, cursor: 'pointer' }}>
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── User form (create / edit) ────────────────────────────────────────────────

function UserForm({ T, theme, mono, existing, currentUser, onSave, onCancel }) {
  const assignable = ASSIGNABLE_BY[currentUser.role] || [];

  const [form, setForm] = useState({
    name:     existing?.name     ?? '',
    username: existing?.username ?? '',
    email:    existing?.email    ?? '',
    role:     existing?.role     ?? (assignable[0] || ''),
    deptId:   existing?.deptId   ?? (currentUser.deptId ?? ''),
    password: '',
    isActive: existing?.isActive ?? true,
  });
  const [errors, setErrors] = useState({});

  const needsDept = DEPT_SCOPED_ROLES.has(form.role);
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: null })); };

  const validate = () => {
    const e = {};
    if (!form.name.trim())                        e.name     = 'Required';
    if (!form.username.trim())                    e.username = 'Required';
    if (!form.email.trim() || !form.email.includes('@')) e.email = 'Valid email required';
    if (!existing && !form.password)              e.password = 'Required for new users';
    if (form.password && form.password.length < 6) e.password = 'Min 6 characters';
    if (!form.role)                               e.role     = 'Required';
    if (needsDept && !form.deptId)                e.deptId   = 'Required for this role';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    const payload = { ...form };
    if (!payload.password) delete payload.password; // don't overwrite on edit
    if (!needsDept) payload.deptId = null;
    onSave(payload);
  };

  const field = (label, key, type = 'text', placeholder = '') => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ ...mono, fontSize: 8, color: T.dim, textTransform: 'uppercase',
                      letterSpacing: 1, display: 'block', marginBottom: 4 }}>{label}</label>
      <input type={type} value={form[key]} placeholder={placeholder}
        onChange={e => set(key, e.target.value)}
        readOnly={key === 'username' && !!existing}
        style={{ width: '100%', padding: '7px 10px', background: T.inputBg,
                 border: `1px solid ${errors[key] ? '#ef4444' : T.inputBdr}`,
                 borderRadius: 6, color: T.txt, fontSize: 12, outline: 'none',
                 opacity: key === 'username' && !!existing ? 0.6 : 1 }}/>
      {errors[key] && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 3 }}>{errors[key]}</div>}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} style={{ padding: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: T.txt }}>
        {existing ? 'Edit User' : 'New User'}
      </div>

      {field('Full Name',   'name',     'text', 'Dr. Jane Smith')}
      {field('Username',    'username', 'text', 'jane.smith')}
      {field('Email',       'email',    'email','jane.smith@westmore.edu')}
      {field(existing ? 'New Password (leave blank to keep)' : 'Password',
             'password', 'password', existing ? '(unchanged)' : 'min 6 characters')}

      {/* Role selector */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ ...mono, fontSize: 8, color: T.dim, textTransform: 'uppercase',
                        letterSpacing: 1, display: 'block', marginBottom: 4 }}>Role</label>
        <select value={form.role} onChange={e => set('role', e.target.value)}
          style={{ width: '100%', padding: '7px 10px', background: T.inputBg,
                   border: `1px solid ${errors.role ? '#ef4444' : T.inputBdr}`,
                   borderRadius: 6, color: T.txt, fontSize: 12, outline: 'none' }}>
          <option value="">— Select role —</option>
          {assignable.map(r => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        {errors.role && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 3 }}>{errors.role}</div>}
      </div>

      {/* Department selector (only for dept-scoped roles) */}
      {needsDept && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ ...mono, fontSize: 8, color: T.dim, textTransform: 'uppercase',
                          letterSpacing: 1, display: 'block', marginBottom: 4 }}>Department</label>
          <select value={form.deptId} onChange={e => set('deptId', e.target.value)}
            disabled={currentUser.role === ROLES.DEPT_HEAD} // Heads can only create for own dept
            style={{ width: '100%', padding: '7px 10px', background: T.inputBg,
                     border: `1px solid ${errors.deptId ? '#ef4444' : T.inputBdr}`,
                     borderRadius: 6, color: T.txt, fontSize: 12, outline: 'none',
                     opacity: currentUser.role === ROLES.DEPT_HEAD ? 0.6 : 1 }}>
            <option value="">— Select department —</option>
            {DEPTS_LIST.map(d => (
              <option key={d.id} value={d.id}
                disabled={currentUser.role === ROLES.DEPT_HEAD && d.id !== currentUser.deptId}>
                {d.name}
              </option>
            ))}
          </select>
          {errors.deptId && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 3 }}>{errors.deptId}</div>}
        </div>
      )}

      {/* Active toggle (edit only) */}
      {existing && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
                        cursor: 'pointer', fontSize: 12, color: T.txt }}>
          <input type="checkbox" checked={form.isActive}
            onChange={e => set('isActive', e.target.checked)}
            style={{ accentColor: '#3b82f6', width: 14, height: 14 }}/>
          Account active
        </label>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button type="button" onClick={onCancel}
          style={{ flex: 1, padding: '8px', background: 'transparent',
                   border: `1px solid ${T.bdr2}`, borderRadius: 6,
                   color: T.muted, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
        <button type="submit"
          style={{ flex: 2, padding: '8px', background: '#3b82f6', border: 'none',
                   borderRadius: 6, color: '#fff', fontSize: 11,
                   fontWeight: 600, cursor: 'pointer' }}>
          {existing ? 'Save Changes' : 'Create User'}
        </button>
      </div>
    </form>
  );
}

// ─── Role badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role, theme }) {
  const colors = {
    [ROLES.SYSTEM_ADMIN]:     { bg: theme==='light'?'#eff6ff':'#0d1f3d', clr: theme==='light'?'#1d4ed8':'#60a5fa', bdr: '#60a5fa44' },
    [ROLES.DIRECTOR]:         { bg: theme==='light'?'#f5f3ff':'#1c0d3d', clr: theme==='light'?'#5b21b6':'#a78bfa', bdr: '#a78bfa44' },
    [ROLES.DEPT_HEAD]:        { bg: theme==='light'?'#ecfdf5':'#062c1d', clr: theme==='light'?'#065f46':'#34d399', bdr: '#34d39944' },
    [ROLES.DEPT_COORDINATOR]: { bg: theme==='light'?'#fffbeb':'#2c1f06', clr: theme==='light'?'#92400e':'#fbbf24', bdr: '#fbbf2444' },
    [ROLES.FACULTY]:          { bg: 'transparent',                        clr: theme==='light'?'#64748b':'#94a3b8', bdr: '#94a3b844' },
  };
  const c = colors[role] || colors[ROLES.FACULTY];
  return (
    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, padding: '2px 7px',
                   borderRadius: 4, background: c.bg, color: c.clr, border: `1px solid ${c.bdr}` }}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}
