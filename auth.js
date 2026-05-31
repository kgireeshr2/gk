/* =============================================================
   auth.js – Login / Register / Session management
   - Master admin: username gireeshkamasani  /  #123Gkkg
   - Registered users stored in localStorage (passwords SHA-256 hashed)
   - Each user has their own AES-GCM encryption passphrase
   - Session stored in localStorage (remember-me) or sessionStorage
   ============================================================= */

'use strict';

// ──────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────
const AUTH_USERS_KEY   = 'acctMgr_users';
const AUTH_SESSION_KEY = 'acctMgr_session';

const ADMIN = {
  email:    'gireeshkamasani',
  name:     'Gireesh Kamasani',
  role:     'admin',
  password: '#123Gkkg',
  encKey:   '#123Gkkg',
};

// In-memory session state (set after successful login, never persisted)
window.currentUserEmail = null;
window.currentCryptoKey = null;

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
  const data = JSON.stringify({ email: user.email, name: user.name, role: user.role || 'user', encSalt: user.encSalt || null });
  if (remember) localStorage.setItem(AUTH_SESSION_KEY, data);
  else          sessionStorage.setItem(AUTH_SESSION_KEY, data);
}

function clearSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  window.currentUserEmail = null;
  window.currentCryptoKey = null;
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
  const pill = document.getElementById('headerUser');
  if (pill) {
    const roleLabel = session.role === 'admin' ? ' 👑' : ' 🔐';
    pill.textContent = `${session.name}${roleLabel}`;
  }
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  document.dispatchEvent(new CustomEvent('authReady'));
}

function setLoading(btnId, loading, label) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Please wait…' : label;
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

  const identifier = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password   = document.getElementById('loginPassword').value;
  const encPass    = document.getElementById('loginEncKey').value;
  const remember   = document.getElementById('rememberMe').checked;

  let valid = true;
  if (!identifier) { setAuthError('loginEmail',   'errLoginEmail',  'Enter your username or email.'); valid = false; }
  else if (identifier !== ADMIN.email && !/\S+@\S+\.\S+/.test(identifier)) {
                   { setAuthError('loginEmail',   'errLoginEmail',  'Enter a valid email address.'); valid = false; } }
  if (!password)   { setAuthError('loginPassword','errLoginPwd',    'Password is required.');         valid = false; }
  if (!encPass)    { setAuthError('loginEncKey',  'errLoginEncKey', 'Encryption key is required.');   valid = false; }
  if (!valid) return;

  setLoading('btnLogin', true, 'Sign In');
  try {
    const pwdHash = await sha256(password);

    // ── ADMIN ──
    if (identifier === ADMIN.email) {
      const adminHash = await sha256(ADMIN.password);
      if (pwdHash !== adminHash) { setAuthError('loginPassword','errLoginPwd','Incorrect password.'); return; }
      if (encPass !== ADMIN.encKey) { setAuthError('loginEncKey','errLoginEncKey','Wrong encryption key.'); return; }

      let users  = getUsers();
      let adminU = users.find(u => u.email === ADMIN.email);

      if (!adminU) {
        // User entry missing — try to recover salt from encrypted blob in encStore
        const encStore   = JSON.parse(localStorage.getItem('acctMgr_encStore') || '{}');
        const existingBlob = encStore[ADMIN.email];
        console.log('[Auth] Admin user entry missing. Existing blob:', existingBlob ? 'found (salt=' + existingBlob.salt?.slice(0,8) + '...)' : 'none');

        if (existingBlob && existingBlob.salt) {
          // Data exists — derive key from blob salt and attempt decryption
          const key    = await deriveKey(encPass, existingBlob.salt);
          const result = await loadUserRecords(ADMIN.email, key).catch(() => 'WRONG_KEY');
          if (result === 'WRONG_KEY') { setAuthError('loginEncKey','errLoginEncKey','Wrong encryption key.'); return; }
          // Restore the admin user entry so future logins work
          adminU = { email: ADMIN.email, name: ADMIN.name, role: 'admin', hash: adminHash, encSalt: existingBlob.salt };
          users.push(adminU); saveUsers(users);
          window.currentCryptoKey = key;
          console.log('[Auth] Admin salt recovered from encrypted blob.');
        } else {
          // Truly first login — generate fresh salt
          const { salt, cryptoKey } = await initEncryption(encPass);
          adminU = { email: ADMIN.email, name: ADMIN.name, role: 'admin', hash: adminHash, encSalt: salt };
          users.push(adminU); saveUsers(users);
          window.currentCryptoKey = cryptoKey;
          console.log('[Auth] Admin first login — new salt generated.');
        }
      } else {
        console.log('[Auth] Admin user found with encSalt:', adminU.encSalt?.slice(0,8) + '...');
        const key    = await deriveKey(encPass, adminU.encSalt);
        const result = await loadUserRecords(adminU.email, key).catch(() => 'WRONG_KEY');
        if (result === 'WRONG_KEY') { setAuthError('loginEncKey','errLoginEncKey','Wrong encryption key.'); return; }
        window.currentCryptoKey = key;
      }
      window.currentUserEmail = ADMIN.email;
      setSession({ ...ADMIN, encSalt: adminU.encSalt }, remember);
      launchApp({ ...ADMIN, encSalt: adminU.encSalt });
      authToast(`Welcome back, ${ADMIN.name}! 👑`);
      return;
    }

    // ── REGISTERED USER ──
    const users = getUsers();
    let user  = users.find(u => u.email === identifier);
    if (!user) {
      // Check if encrypted blob exists — user entry may be missing after fresh device load
      const encStore = JSON.parse(localStorage.getItem('acctMgr_encStore') || '{}');
      if (encStore[identifier]) {
        setAuthError('loginEmail', 'errLoginEmail', 'Account data found but profile is missing. Please re-register or push data from your original device.');
      } else {
        setAuthError('loginEmail', 'errLoginEmail', 'No account found with this email.');
      }
      return;
    }

    // If encSalt missing (partial restore), try to recover from blob
    if (user.hash !== pwdHash) { setAuthError('loginPassword','errLoginPwd', 'Incorrect password.'); return; }

    if (!user.encSalt) {
      const encStore = JSON.parse(localStorage.getItem('acctMgr_encStore') || '{}');
      if (encStore[identifier] && encStore[identifier].salt) {
        user.encSalt = encStore[identifier].salt;
        // Update stored entry
        const updatedUsers = users.map(u => u.email === identifier ? { ...u, encSalt: user.encSalt } : u);
        saveUsers(updatedUsers);
        console.log('[Auth] Recovered encSalt from blob for:', identifier);
      } else {
        setAuthError('loginEncKey', 'errLoginEncKey', 'Encryption salt missing. Push data from original device first.');
        return;
      }
    }

    const key = await deriveKey(encPass, user.encSalt);
    const result = await loadUserRecords(user.email, key).catch(() => 'WRONG_KEY');
    if (result === 'WRONG_KEY') { setAuthError('loginEncKey','errLoginEncKey','Wrong encryption key.'); return; }

    window.currentUserEmail = user.email;
    window.currentCryptoKey = key;
    setSession(user, remember);
    launchApp(user);
    authToast(`Welcome back, ${user.name}!`);

  } finally {
    setLoading('btnLogin', false, 'Sign In');
  }
}

// ──────────────────────────────────────────────
// VALIDATE & SUBMIT – REGISTER
// ──────────────────────────────────────────────
async function handleRegister(e) {
  e.preventDefault();
  clearAuthErrors('register');

  const name       = document.getElementById('regName').value.trim();
  const email      = document.getElementById('regEmail').value.trim().toLowerCase();
  const password   = document.getElementById('regPassword').value;
  const confirm    = document.getElementById('regConfirm').value;
  const encPass    = document.getElementById('regEncKey').value;
  const encConfirm = document.getElementById('regEncKeyConfirm').value;

  let valid = true;
  if (!name)    { setAuthError('regName',          'errRegName',          'Full name is required.'); valid = false; }
  if (!email || !/\S+@\S+\.\S+/.test(email))
               { setAuthError('regEmail',          'errRegEmail',         'Enter a valid email.'); valid = false; }
  if (password.length < 8)
               { setAuthError('regPassword',       'errRegPwd',           'Min 8 characters required.'); valid = false; }
  else if (!/[A-Z]/.test(password) || !/[0-9]/.test(password))
               { setAuthError('regPassword',       'errRegPwd',           'Need at least 1 uppercase & 1 number.'); valid = false; }
  if (password !== confirm)
               { setAuthError('regConfirm',        'errRegConfirm',       'Passwords do not match.'); valid = false; }
  if (encPass.length < 6)
               { setAuthError('regEncKey',         'errRegEncKey',        'Encryption key must be at least 6 chars.'); valid = false; }
  if (encPass !== encConfirm)
               { setAuthError('regEncKeyConfirm',  'errRegEncKeyConfirm', 'Encryption keys do not match.'); valid = false; }
  if (!valid) return;

  if (email === ADMIN.email) { setAuthError('regEmail','errRegEmail','This email is reserved.'); return; }
  const users = getUsers();
  if (users.find(u => u.email === email)) {
    setAuthError('regEmail','errRegEmail','An account with this email already exists.'); return;
  }

  setLoading('btnRegister', true, 'Create Account');
  try {
    const [pwdHash, { salt }] = await Promise.all([sha256(password), initEncryption(encPass)]);
    const newUser = { email, name, hash: pwdHash, role: 'user', encSalt: salt, createdAt: new Date().toISOString() };
    users.push(newUser);
    saveUsers(users);
    authToast(`Account created! Welcome, ${name} 🎉`);
    switchTab('login');
    document.getElementById('loginEmail').value    = email;
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginEncKey').value   = '';
  } finally {
    setLoading('btnRegister', false, 'Create Account');
  }
}

// ──────────────────────────────────────────────
// LOGOUT
// ──────────────────────────────────────────────
function handleLogout() {
  clearSession();
  showLogin();
  document.getElementById('loginForm').reset();
  document.getElementById('registerForm').reset();
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
  const map = scope === 'login'
    ? [['loginEmail','errLoginEmail'],['loginPassword','errLoginPwd'],['loginEncKey','errLoginEncKey']]
    : [['regName','errRegName'],['regEmail','errRegEmail'],['regPassword','errRegPwd'],
       ['regConfirm','errRegConfirm'],['regEncKey','errRegEncKey'],['regEncKeyConfirm','errRegEncKeyConfirm']];
  map.forEach(([fid, eid]) => {
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
document.addEventListener('DOMContentLoaded', async () => {
  // Show loading state while pulling remote store
  const loginBtn = document.getElementById('btnLogin');
  const authCard = document.querySelector('.auth-card');
  const hint     = document.createElement('p');
  hint.id = 'syncHint';
  hint.style.cssText = 'text-align:center;font-size:.75rem;color:var(--clr-muted);margin-top:-.25rem';
  hint.textContent = '⏳ Syncing remote data…';
  if (loginBtn) loginBtn.disabled = true;
  if (authCard) authCard.appendChild(hint);

  // Pull remote store BEFORE showing login so encSalt is available for key derivation
  if (typeof githubLoad === 'function') {
    try {
      await githubLoad();
      hint.textContent = '✅ Ready';
      setTimeout(() => hint.remove(), 1500);
    } catch {
      hint.textContent = '';
    }
  } else {
    hint.remove();
  }
  if (loginBtn) loginBtn.disabled = false;

  // CryptoKey cannot be persisted, always require fresh login
  clearSession();
  showLogin();

  document.querySelectorAll('.auth-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('registerForm').addEventListener('submit', handleRegister);
  document.getElementById('btnLogout').addEventListener('click', handleLogout);
  bindTogglePwd();
});
