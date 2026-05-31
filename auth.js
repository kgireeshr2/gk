/* =============================================================
   auth.js – Login / Register / Session management
   - Master admin: admin@site.com  /  Admin@123
   - Registered users stored in localStorage (passwords SHA-256 hashed)
   - Session stored in localStorage (remember-me) or sessionStorage
   ============================================================= */

'use strict';

// ──────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────
const AUTH_USERS_KEY   = 'acctMgr_users';
const AUTH_SESSION_KEY = 'acctMgr_session';

// Master admin credentials (password is hashed at runtime for comparison)
const ADMIN = {
  email:    'gireeshkamasani',
  name:     'Gireesh Kamasani',
  role:     'admin',
  password: '#123Gkkg',   // used only for runtime hash comparison, never stored
};

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function getUsers() {
  const raw = localStorage.getItem(AUTH_USERS_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveUsers(users) {
  localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
}

function getSession() {
  const ls = localStorage.getItem(AUTH_SESSION_KEY);
  const ss = sessionStorage.getItem(AUTH_SESSION_KEY);
  return ls ? JSON.parse(ls) : (ss ? JSON.parse(ss) : null);
}

function setSession(user, remember) {
  const data = JSON.stringify({ email: user.email, name: user.name, role: user.role || 'user' });
  if (remember) localStorage.setItem(AUTH_SESSION_KEY, data);
  else          sessionStorage.setItem(AUTH_SESSION_KEY, data);
}

function clearSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  sessionStorage.removeItem(AUTH_SESSION_KEY);
}

// ──────────────────────────────────────────────
// SHOW TOAST (works before app.js loads too)
// ──────────────────────────────────────────────
function authToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type}`;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2800);
}

// ──────────────────────────────────────────────
// APP GATE – show/hide login vs. app shell
// ──────────────────────────────────────────────
function launchApp(session) {
  // Populate header user pill
  const pill = document.getElementById('headerUser');
  if (pill) {
    const roleLabel = session.role === 'admin' ? ' 👑' : '';
    pill.textContent = `${session.name}${roleLabel}`;
  }
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  // Signal app.js that auth is done
  document.dispatchEvent(new CustomEvent('authReady'));
}

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appShell').classList.add('hidden');
}

// ──────────────────────────────────────────────
// VALIDATE & SUBMIT – LOGIN
// ──────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  clearAuthErrors('login');

  const email    = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  const remember = document.getElementById('rememberMe').checked;

  let valid = true;
  // Allow plain username (admin) OR a valid email for regular users
  if (!email) {
    setAuthError('loginEmail', 'errLoginEmail', 'Enter your username or email.'); valid = false;
  } else if (email !== ADMIN.email && !/\S+@\S+\.\S+/.test(email)) {
    setAuthError('loginEmail', 'errLoginEmail', 'Enter a valid email address.'); valid = false;
  }
  if (!password) {
    setAuthError('loginPassword', 'errLoginPwd', 'Password is required.'); valid = false;
  }
  if (!valid) return;

  const hash = await sha256(password);

  // Check master admin
  if (email === ADMIN.email) {
    const adminHash = await sha256(ADMIN.password);
    if (hash !== adminHash) {
      setAuthError('loginPassword', 'errLoginPwd', 'Incorrect password.');
      return;
    }
    setSession(ADMIN, remember);
    launchApp(ADMIN);
    authToast(`Welcome back, ${ADMIN.name}! 👑`);
    return;
  }

  // Check registered users
  const users = getUsers();
  const user  = users.find(u => u.email === email);
  if (!user) {
    setAuthError('loginEmail', 'errLoginEmail', 'No account found with this email.');
    return;
  }
  if (user.hash !== hash) {
    setAuthError('loginPassword', 'errLoginPwd', 'Incorrect password.');
    return;
  }

  setSession(user, remember);
  launchApp(user);
  authToast(`Welcome back, ${user.name}!`);
}

// ──────────────────────────────────────────────
// VALIDATE & SUBMIT – REGISTER
// ──────────────────────────────────────────────
async function handleRegister(e) {
  e.preventDefault();
  clearAuthErrors('register');

  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim().toLowerCase();
  const password = document.getElementById('regPassword').value;
  const confirm  = document.getElementById('regConfirm').value;

  let valid = true;
  if (!name) {
    setAuthError('regName', 'errRegName', 'Full name is required.'); valid = false;
  }
  if (!email || !/\S+@\S+\.\S+/.test(email)) {
    setAuthError('regEmail', 'errRegEmail', 'Enter a valid email.'); valid = false;
  }
  if (password.length < 8) {
    setAuthError('regPassword', 'errRegPwd', 'Password must be at least 8 characters.'); valid = false;
  } else if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    setAuthError('regPassword', 'errRegPwd', 'Must include at least one uppercase letter and one number.'); valid = false;
  }
  if (password !== confirm) {
    setAuthError('regConfirm', 'errRegConfirm', 'Passwords do not match.'); valid = false;
  }
  if (!valid) return;

  // Block admin email
  if (email === ADMIN.email) {
    setAuthError('regEmail', 'errRegEmail', 'This email is reserved.'); return;
  }

  // Check duplicate
  const users = getUsers();
  if (users.find(u => u.email === email)) {
    setAuthError('regEmail', 'errRegEmail', 'An account with this email already exists.'); return;
  }

  const hash = await sha256(password);
  const newUser = { email, name, hash, role: 'user', createdAt: new Date().toISOString() };
  users.push(newUser);
  saveUsers(users);

  authToast(`Account created! Welcome, ${name} 🎉`);
  // Auto-switch to login tab
  switchTab('login');
  document.getElementById('loginEmail').value = email;
  document.getElementById('loginPassword').value = '';
}

// ──────────────────────────────────────────────
// LOGOUT
// ──────────────────────────────────────────────
function handleLogout() {
  clearSession();
  showLogin();
  document.getElementById('loginForm').reset();
  authToast('Signed out.', 'error');
}

// ──────────────────────────────────────────────
// TAB SWITCHING
// ──────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.getElementById('panelLogin').classList.toggle('hidden', tab !== 'login');
  document.getElementById('panelRegister').classList.toggle('hidden', tab !== 'register');
  clearAuthErrors('login');
  clearAuthErrors('register');
}

// ──────────────────────────────────────────────
// ERROR HELPERS
// ──────────────────────────────────────────────
function setAuthError(fieldId, errId, msg) {
  const el = document.getElementById(fieldId);
  if (el) el.classList.add('invalid');
  const err = document.getElementById(errId);
  if (err) err.textContent = msg;
}

function clearAuthErrors(scope) {
  const ids = scope === 'login'
    ? [['loginEmail','errLoginEmail'], ['loginPassword','errLoginPwd']]
    : [['regName','errRegName'], ['regEmail','errRegEmail'], ['regPassword','errRegPwd'], ['regConfirm','errRegConfirm']];
  ids.forEach(([fid, eid]) => {
    const f = document.getElementById(fid); if (f) f.classList.remove('invalid');
    const e = document.getElementById(eid); if (e) e.textContent = '';
  });
}

// ──────────────────────────────────────────────
// PASSWORD TOGGLE VISIBILITY
// ──────────────────────────────────────────────
function bindTogglePwd() {
  document.querySelectorAll('.toggle-pwd').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁' : '🙈';
    });
  });
}

// ──────────────────────────────────────────────
// BOOT
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Check existing session
  const session = getSession();
  if (session) {
    launchApp(session);
  } else {
    showLogin();
  }

  // Tab switching
  document.querySelectorAll('.auth-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Form submissions
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('registerForm').addEventListener('submit', handleRegister);

  // Logout button (wired here; app.js also binds it but this fires first)
  document.getElementById('btnLogout').addEventListener('click', handleLogout);

  // Password visibility toggles
  bindTogglePwd();
});
