/**
 * LeopardWatch authentication entry point.
 * Only renders the existing dashboard after FastAPI confirms the session.
 * Credentials are never stored in browser localStorage.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Leaf, LockKeyhole, Mail, ScanSearch, ShieldCheck, UserRound } from 'lucide-react';
import App from './App.jsx';
import leopardLoginPhoto from './assets/leopard-login.jpg';

// Change this through frontend/.env.local on each student's laptop.
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'yourname@example.com';

// The Vite dev proxy forwards /api to FastAPI, keeping auth cookies same-origin.
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...options });
  } catch (error) {
    throw new Error('Cannot connect to the server. Start FastAPI on port 8000.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    const reason = typeof detail === 'string' ? detail :
      Array.isArray(detail) ? detail.map(item => item.msg).join('; ') :
      `Request failed (${response.status}).`;
    const error = new Error(reason);
    error.status = response.status;
    throw error;
  }
  return data;
}

export default function AuthGate() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let active = true;
    request('/api/auth/me').then(data => {
      if (active) setUser(data.user);
    }).catch(() => {}).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (working) return;
    setError('');
    if (mode === 'register') {
      if (name.trim().length < 2) return setError('Please enter your full name.');
      if (password.length < 10) return setError('Use a password with at least 10 characters.');
      if (password !== confirm) return setError('Passwords do not match.');
    }
    setWorking(true);
    try {
      const payload = mode === 'register'
        ? { name: name.trim(), email: email.trim(), password }
        : { email: email.trim(), password };
      const data = await request(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setPassword('');
      setConfirm('');
      setUser(data.user);
    } catch (err) { setError(err.message); }
    finally { setWorking(false); }
  }

  async function logout() {
    try {
      await request('/api/auth/logout', { method: 'POST' });
      setUser(null);
      setMode('login');
      setPassword('');
      setConfirm('');
      setError('');
    } catch (err) { setError(err.message); }
  }

  if (checking) return <main className="lw-auth-loading" role="status">
    <span className="lw-auth-logo"><ScanSearch size={26}/></span>
    <strong>Leopard<span>Watch</span></strong>
    <p>Checking your session…</p>
  </main>;

  if (user) return <App user={user} onLogout={logout} />;

  // Login page only: clean split layout based on the provided reference.
  // Registration keeps the existing UI until its separate changes are specified.
  if (mode === 'login') return <main className="lw-login-page">
    <div className="lw-login-card">
      <section className="lw-login-form-side" aria-label="Sign in to LeopardWatch">
        <div className="lw-login-content">
          <header className="lw-login-heading">
            <h1>Welcome back!</h1>
            <p>Sign in to your account to access LeopardWatch.</p>
          </header>
          <form className="lw-login-form" onSubmit={submit}>
            <label htmlFor="lw-login-email">Email address</label>
            <div className="lw-login-control">
              <Mail size={18} aria-hidden="true" />
              <input id="lw-login-email" type="email" name="email" autoComplete="email" required maxLength={254}
                value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter your email address" />
            </div>
            <label htmlFor="lw-login-password">Password</label>
            <div className="lw-login-control">
              <LockKeyhole size={18} aria-hidden="true" />
              <input id="lw-login-password" type={visible ? 'text' : 'password'} name="password"
                autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password" />
              <button type="button" className="lw-login-eye" onClick={() => setVisible(v => !v)}
                aria-label={visible ? 'Hide password' : 'Show password'}>
                {visible ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
            {error && <p className="lw-login-error" role="alert">{error}</p>}
            <button className="lw-login-submit" type="submit" disabled={working}>
              {working ? 'Signing in…' : 'Login'}
            </button>
          </form>
          <p className="lw-login-switch">New to LeopardWatch?{' '}
            <button type="button" onClick={() => {
              setMode('register'); setError(''); setPassword(''); setConfirm(''); setVisible(false);
            }}>Create an account</button>
          </p>
          <p className="lw-login-support">Need help? Email us at{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
        </div>
      </section>
      <div className="lw-login-image-side" aria-label="Leopard in its natural forest habitat">
        <img src={leopardLoginPhoto} alt="Leopard in a forest" />
      </div>
    </div>
  </main>;

  // Registration screen only: no Facebook sign-in, social icons, or forest background.
  // The existing email/password registration API and login screen are preserved.
  return <main className="lw-register-page">
    <div className="lw-register-shell">
      <header className="lw-register-nav">
        <div className="lw-register-brand">
          <span className="lw-register-brand-icon" aria-hidden="true"><ScanSearch size={21} /></span>
          <span>Leopard<strong>Watch</strong></span>
        </div>
        <div className="lw-register-top-login">
          <span>Already have an account?</span>
          <button type="button" onClick={() => {
            setMode('login'); setError(''); setPassword(''); setConfirm(''); setVisible(false);
          }}>Login</button>
        </div>
      </header>

      <div className="lw-register-main">
        <section className="lw-register-form-column" aria-labelledby="lw-register-title">
          <p className="lw-register-overline">JOIN THE WILDLIFE MONITORING WORKSPACE</p>
          <h1 id="lw-register-title">Create an account</h1>
          <p className="lw-register-description">
            Get started with secure, video-based leopard detection.
          </p>

          <form className="lw-register-form" onSubmit={submit}>
            <label className="lw-register-field" htmlFor="lw-register-name">
              <span>Full name</span>
              <div className="lw-register-input-wrap">
                <UserRound size={17} aria-hidden="true" />
                <input id="lw-register-name" type="text" name="name" required minLength={2} maxLength={80}
                  autoComplete="name" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Enter your full name" />
              </div>
            </label>
            <label className="lw-register-field" htmlFor="lw-register-email">
              <span>Email address</span>
              <div className="lw-register-input-wrap">
                <Mail size={17} aria-hidden="true" />
                <input id="lw-register-email" type="email" name="email" required maxLength={254}
                  autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" />
              </div>
            </label>
            <label className="lw-register-field" htmlFor="lw-register-password">
              <span>Password</span>
              <div className="lw-register-input-wrap">
                <LockKeyhole size={17} aria-hidden="true" />
                <input id="lw-register-password" name="password" required minLength={10}
                  type={visible ? 'text' : 'password'} autoComplete="new-password"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Minimum 10 characters" />
                <button type="button" className="lw-register-visibility"
                  onClick={() => setVisible(v => !v)} aria-label={visible ? 'Hide password' : 'Show password'}>
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            <label className="lw-register-field" htmlFor="lw-register-confirm">
              <span>Confirm password</span>
              <div className="lw-register-input-wrap">
                <LockKeyhole size={17} aria-hidden="true" />
                <input id="lw-register-confirm" name="confirm" required type="password"
                  autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)}
                  placeholder="Re-enter your password" />
              </div>
            </label>
            {error && <p className="lw-register-error" role="alert">{error}</p>}
            <button className="lw-register-submit" type="submit" disabled={working}>
              {working ? 'Creating your account…' : 'Create account'}
              {!working && <ArrowRight size={17} aria-hidden="true" />}
            </button>
          </form>
          <p className="lw-register-signin">
            Already have an account?{' '}
            <button type="button" onClick={() => {
              setMode('login'); setError(''); setPassword(''); setConfirm(''); setVisible(false);
            }}>Sign in</button>
          </p>
        </section>

        <aside className="lw-register-photo" aria-label="Leopard in its natural habitat">
          <img src={leopardLoginPhoto} alt="Leopard in a green forest" />
        </aside>
      </div>

      <footer className="lw-register-help">
        <div>
          <strong>Need help getting started?</strong>
          <p>For setup or account questions, contact the project support email.</p>
        </div>
        <a href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL} <ArrowRight size={16} aria-hidden="true" />
        </a>
      </footer>
    </div>
  </main>;
}
