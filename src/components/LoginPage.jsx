/**
 * components/LoginPage.jsx
 * Authentication form. Uses the mock auth system — swap login() for an API
 * call to make it production-ready.
 */

import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useT } from '../theme.jsx';
import { DEMO_CREDENTIALS } from '../auth/mockDb.js';
import { ROLE_LABELS } from '../auth/roles.js';

const DEPTS = { MATH: 'Mathematics', PHYS: 'Physics', CS: 'Computer Science', CHEM: 'Chemistry' };

export default function LoginPage() {
  const { login, authError } = useAuth();
  const { T, theme, toggleTheme } = useT();

  const [username,   setUsername]   = useState('');
  const [password,   setPassword]   = useState('');
  const [showPass,   setShowPass]   = useState(false);
  const [busy,       setBusy]       = useState(false);
  const [localError, setLocalError] = useState('');

  const error = localError || authError;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');
    if (!username.trim()) { setLocalError('Please enter your username.'); return; }
    if (!password)        { setLocalError('Please enter your password.'); return; }
    setBusy(true);
    // Small artificial delay to simulate network round-trip
    await new Promise(r => setTimeout(r, 280));
    login(username.trim(), password);
    setBusy(false);
  };

  const fillDemo = (cred) => {
    setUsername(cred.username);
    setPassword(cred.password);
    setLocalError('');
  };

  const mono = { fontFamily: "'DM Mono',monospace" };
  const inp  = {
    width: '100%', padding: '9px 12px',
    background: T.inputBg, border: `1px solid ${error ? '#ef4444' : T.inputBdr}`,
    borderRadius: 7, color: T.txt, fontSize: 13, outline: 'none',
    transition: 'border-color .15s',
  };

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", background: T.bg, color: T.txt,
                  minHeight: '100vh', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', padding: '24px 16px', position: 'relative' }}>

      {/* Theme toggle */}
      <button onClick={toggleTheme}
        style={{ position: 'absolute', top: 16, right: 20, padding: '5px 12px',
                 background: T.surface, border: `1px solid ${T.bdr2}`, borderRadius: 6,
                 color: T.muted, fontSize: 11, boxShadow: T.shadowSm, cursor: 'pointer' }}>
        {theme === 'light' ? '🌙 Dark' : '☀ Light'}
      </button>

      <div style={{ width: '100%', maxWidth: 900, display: 'flex', gap: 0,
                    borderRadius: 14, overflow: 'hidden', boxShadow: T.shadowMd,
                    border: `1px solid ${T.bdr}` }}>

        {/* ── Left panel: branding ── */}
        <div style={{ width: 300, flexShrink: 0, background: theme === 'light' ? '#1e293b' : '#060c18',
                      padding: '40px 28px', display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div style={{ ...mono, fontSize: 9, letterSpacing: 4, color: '#64748b',
                        textTransform: 'uppercase', marginBottom: 20 }}>
            Westmore University
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.25, marginBottom: 8 }}>
            Classroom Allocation System
          </div>
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginBottom: 32 }}>
            Centralised room scheduling and cross-department coordination for academic staff.
          </div>

          {/* Role hierarchy summary */}
          <div style={{ ...mono, fontSize: 8, color: '#475569', textTransform: 'uppercase',
                        letterSpacing: 1, marginBottom: 10 }}>Access Levels</div>
          {[
            ['System Admin',   'Full platform control',     '#60a5fa'],
            ['Director',       'All departments, read/write','#a78bfa'],
            ['Dept. Head',     'Own dept full control',     '#34d399'],
            ['Coordinator',    'Allocations for own dept',  '#fbbf24'],
            ['Faculty',        'Read-only view',            '#94a3b8'],
          ].map(([label, desc, clr]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 3, height: 14, borderRadius: 1, background: clr, marginTop: 2, flexShrink: 0 }}/>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1' }}>{label}</div>
                <div style={{ fontSize: 10, color: '#475569' }}>{desc}</div>
              </div>
            </div>
          ))}

          <div style={{ flex: 1 }}/>
          <div style={{ ...mono, fontSize: 9, color: '#334155', marginTop: 24 }}>
            Fall Semester 2025–26
          </div>
        </div>

        {/* ── Right panel: form + demo creds ── */}
        <div style={{ flex: 1, background: T.surface, padding: '40px 36px', display: 'flex',
                      flexDirection: 'column', overflow: 'auto' }}>

          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Sign in</div>
            <div style={{ fontSize: 13, color: T.muted }}>Enter your university credentials to continue.</div>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
            <div>
              <label style={{ ...mono, fontSize: 9, color: T.dim, textTransform: 'uppercase',
                              letterSpacing: 1, display: 'block', marginBottom: 5 }}>Username</label>
              <input
                type="text" value={username} autoComplete="username"
                onChange={e => { setUsername(e.target.value); setLocalError(''); }}
                placeholder="e.g. math.head"
                style={inp}
                onFocus={e => e.target.style.borderColor = '#60a5fa'}
                onBlur={e  => e.target.style.borderColor = error ? '#ef4444' : T.inputBdr}
              />
            </div>

            <div>
              <label style={{ ...mono, fontSize: 9, color: T.dim, textTransform: 'uppercase',
                              letterSpacing: 1, display: 'block', marginBottom: 5 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'} value={password}
                  autoComplete="current-password"
                  onChange={e => { setPassword(e.target.value); setLocalError(''); }}
                  placeholder="••••••••"
                  style={{ ...inp, paddingRight: 44 }}
                  onFocus={e => e.target.style.borderColor = '#60a5fa'}
                  onBlur={e  => e.target.style.borderColor = error ? '#ef4444' : T.inputBdr}
                />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                           background: 'none', border: 'none', color: T.dim, cursor: 'pointer',
                           fontSize: 11, padding: '2px 4px' }}>
                  {showPass ? 'hide' : 'show'}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ padding: '8px 12px', background: theme === 'light' ? '#fef2f2' : '#2a0a0a',
                            border: `1px solid ${theme === 'light' ? '#fca5a5' : '#ef444444'}`,
                            borderRadius: 6, fontSize: 12,
                            color: theme === 'light' ? '#b91c1c' : '#ef4444' }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={busy}
              style={{ padding: '10px', background: '#3b82f6', border: 'none', borderRadius: 7,
                       color: '#fff', fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
                       opacity: busy ? 0.7 : 1, transition: 'opacity .15s, filter .15s', marginTop: 4 }}
              onMouseEnter={e => { if (!busy) e.currentTarget.style.filter = 'brightness(1.1)'; }}
              onMouseLeave={e => e.currentTarget.style.filter = 'none'}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Demo credentials table */}
          <div style={{ borderTop: `1px solid ${T.bdr}`, paddingTop: 20 }}>
            <div style={{ ...mono, fontSize: 8, color: T.dim, textTransform: 'uppercase',
                          letterSpacing: 1, marginBottom: 10 }}>
              Demo Credentials — click to fill
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {DEMO_CREDENTIALS.map(cred => (
                <button key={cred.username} onClick={() => fillDemo(cred)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
                           background: 'transparent', border: `1px solid ${T.bdr}`,
                           borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                           transition: 'background .1s, border-color .1s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = T.hover;
                                       e.currentTarget.style.borderColor = T.bdr2; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent';
                                       e.currentTarget.style.borderColor = T.bdr; }}>
                  <span style={{ ...mono, fontSize: 10, color: T.txt, fontWeight: 500, minWidth: 110 }}>
                    {cred.username}
                  </span>
                  <span style={{ ...mono, fontSize: 10, color: T.muted, minWidth: 70 }}>
                    {cred.password}
                  </span>
                  <span style={{ fontSize: 10, color: T.dim, flex: 1 }}>
                    {ROLE_LABELS[cred.role]}{cred.deptId ? ` · ${DEPTS[cred.deptId] ?? cred.deptId}` : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
